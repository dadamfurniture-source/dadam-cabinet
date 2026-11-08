/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, jest */
/**
 * SEGAN 알리는 화면 — 구독(segan/plans.html + plans.js) · AI 시스템 소개(about.html) · 매거진(blog.html).
 *
 *   - 구독: 등급 넷(Standard 무료 · Manager · Expert · Agent), 도구는 아래 등급에 더해 늘어난다.
 *     이름 · 월 금액은 payments-api GET /plans, 월 크레딧은 credit_plans, 연출컷 횟수는 credit_costs(generate) 로 나눈다.
 *     /plans 를 못 읽으면 금액 없이 표만 + 알림 (숫자를 지어내지 않는다). 가입 단추는 모두 me.html#partner
 *   - 소개: 흐름 상자(그림 없이) · 강점 · 「AI 연출컷 시작」 · 「구독 보기」
 *   - 소개 · 구독 위 [소개 | 구독] (폰 · 태블릿만 — PC 는 위 메뉴에 둘 다), 폰 탭 SEGAN 이 두 화면에서 켜진다
 *   - 매거진: 분류 넷 · 「글을 준비하고 있습니다」 · 검색에 내지 않는다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAY = 'https://pay.example.workers.dev';

const PLANS = {
  success: true,
  data: {
    client_key: 'ck',
    plans: [
      { id: 'manager', name: 'Manager', price_krw: 99000, order_name: 'x' },
      { id: 'expert', name: 'Expert', price_krw: 199000, order_name: 'x' },
      { id: 'agent', name: 'Agent', price_krw: 299000, order_name: 'x' },
    ],
  },
};
const CREDITS = [
  { tier: 'standard', monthly_credits: 100 },
  { tier: 'manager', monthly_credits: 500 },
  { tier: 'expert', monthly_credits: 1000 },
  { tier: 'agent', monthly_credits: 3000 },
];

/** 페이지를 올리고 셸 · 페이지 스크립트를 돌린다. opts: plans(응답 본문 | 'fail' | 상태 숫자) · credits · cost · noSupabase */
async function load(page, options = {}) {
  const opts = { plans: PLANS, credits: CREDITS, cost: 20, noSupabase: false, ...options };
  const doc = new DOMParser().parseFromString(read(`segan/${page}`), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  for (const k of ['SeganShell', 'SeganPlans']) delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    paymentsApi: { url: PAY },
  };
  const calls = { fetch: [], tables: [] };
  const client = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    from: (table) => {
      calls.tables.push(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          table === 'credit_costs'
            ? { data: opts.cost == null ? null : { credits: opts.cost }, error: null }
            : { data: null, error: null },
        then: (resolve, reject) => {
          if (table === 'credit_plans' && opts.credits === 'fail') return reject(new Error('down'));
          return resolve({ data: table === 'credit_plans' ? opts.credits : null, error: null });
        },
      };
      return chain;
    },
  };
  window.supabase = opts.noSupabase ? undefined : { createClient: () => client };
  window.fetch = jest.fn(async (url) => {
    calls.fetch.push(String(url));
    if (String(url) !== `${PAY}/plans`) throw new Error('예상하지 못한 요청: ' + url);
    if (opts.plans === 'fail') throw new TypeError('Failed to fetch');
    if (typeof opts.plans === 'number')
      return { ok: false, status: opts.plans, json: async () => ({ success: false }) };
    return { ok: true, status: 200, json: async () => opts.plans };
  });
  (0, eval)(read('segan/shell.js'));
  const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  if (scripts.some((s) => s.startsWith('plans.js'))) (0, eval)(read('segan/plans.js'));
  await window.SeganShell.ready;
  const result = window.SeganPlans ? await window.SeganPlans.ready : null;
  return { calls, result, scripts };
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const tier = (id) => $(`.pl-tier[data-tier="${id}"]`);
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const feats = (id) => [...tier(id).querySelectorAll('.pl-feats li')].map(text);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('구독 (plans.html) — 등급 넷', () => {
  test('Standard 무료 · Manager · Expert · Agent 차례, 도구는 아래 등급에 더해 (누적)', async () => {
    await load('plans.html');
    expect($$('.pl-tier').map((t) => t.getAttribute('data-tier'))).toEqual([
      'standard',
      'manager',
      'expert',
      'agent',
    ]);
    expect(feats('standard')).toEqual([
      'AI 연출컷 (월 횟수 제한)',
      '예상 견적',
      '상담 신청',
      '업체 추천',
    ]);
    expect(feats('manager')).toEqual([
      '플래너',
      '프로젝트 관리',
      '렌더링',
      '가구제작 업체 매칭 (본사 추천 중 선택)',
      '상세 견적',
    ]);
    expect(feats('expert')).toEqual([
      '플래너 AI 학습',
      '설계 제안',
      'BOM 산출',
      '발주서',
      '작업지시서',
      '재고 관리',
      '고객 상담 배분',
    ]);
    expect(feats('agent')).toEqual([
      '업무 일정 AI',
      '작업자 분배 AI',
      '회계 관리',
      '인력 관리',
      '작업자 대시보드',
      'AI 비서 업무 모드',
    ]);
    expect(text(tier('manager').querySelector('.pl-inherit'))).toBe('Standard 의 모든 것에 더해');
    expect(text(tier('expert').querySelector('.pl-inherit'))).toBe('Manager 의 모든 것에 더해');
    expect(text(tier('agent').querySelector('.pl-inherit'))).toBe('Expert 의 모든 것에 더해');
    expect(text(tier('standard').querySelector('.pl-price'))).toBe('무료');
  });

  test('이름 · 월 금액은 GET /plans, 월 크레딧은 credit_plans, 연출컷 횟수는 credit_costs 로 나눈다', async () => {
    const renamed = JSON.parse(JSON.stringify(PLANS));
    renamed.data.plans[0].name = 'Manager+';
    const { calls, result } = await load('plans.html', { plans: renamed });
    expect(calls.fetch).toEqual([`${PAY}/plans`]);
    expect(calls.tables).toEqual(expect.arrayContaining(['credit_plans', 'credit_costs']));
    expect(result).toEqual({ missing: false });
    expect(text($('[data-name="manager"]'))).toBe('Manager+'); // 서버 이름 그대로
    expect(text($('[data-name="expert"]'))).toBe('Expert');
    expect(['manager', 'expert', 'agent'].map((t) => text($(`[data-price="${t}"]`)))).toEqual([
      '월 99,000원',
      '월 199,000원',
      '월 299,000원',
    ]);
    expect(
      ['standard', 'manager', 'expert', 'agent'].map((t) => text($(`[data-credit="${t}"]`)))
    ).toEqual([
      '월 100 크레딧 · 연출컷 5회',
      '월 500 크레딧 · 연출컷 25회',
      '월 1,000 크레딧 · 연출컷 50회',
      '월 3,000 크레딧 · 연출컷 150회',
    ]);
    expect($('#plState').textContent).toBe('');
    expect($('#plState').getAttribute('role')).toBe('status');
  });

  test.each([
    ['끊김', 'fail'],
    ['500', 500],
    ['모양이 다름', { success: true, data: {} }],
  ])(
    '/plans 를 못 읽으면 (%s) 금액 없이 표만 + 알림 — 숫자를 지어내지 않는다',
    async (_name, plans) => {
      const { result } = await load('plans.html', { plans });
      expect(result).toEqual({ missing: true });
      for (const t of ['manager', 'expert', 'agent'])
        expect($(`[data-price="${t}"]`).textContent).toBe('');
      expect($('#plTiers').textContent).not.toMatch(/\d원/);
      expect($('#plState').textContent).toBe(
        '가격을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.'
      );
      expect(visible($('#plState'))).toBe(true);
      // 표 · 크레딧 · 단추는 그대로
      expect($$('.pl-tier')).toHaveLength(4);
      expect(feats('agent')).toHaveLength(6);
      expect(text($('[data-credit="manager"]'))).toBe('월 500 크레딧 · 연출컷 25회');
      expect($$('[data-signup]').map((a) => a.getAttribute('href'))).toEqual([
        'me.html#partner',
        'me.html#partner',
        'me.html#partner',
      ]);
    }
  );

  test('/plans 에 없는 등급(예: Manager 가 아직 없을 때)은 그 금액만 비우고 알린다', async () => {
    const partial = JSON.parse(JSON.stringify(PLANS));
    partial.data.plans = partial.data.plans.filter((p) => p.id !== 'manager');
    await load('plans.html', { plans: partial });
    expect($('[data-price="manager"]').textContent).toBe('');
    expect(text($('[data-price="expert"]'))).toBe('월 199,000원');
    expect($('#plState').textContent).toBe(window.SeganPlans.PRICE_FAIL);
  });

  test('크레딧 · 1회 크레딧을 못 읽으면 — 크레딧 줄만 비우거나 횟수만 뺀다', async () => {
    await load('plans.html', { credits: 'fail' });
    expect($$('.pl-credit').map((c) => c.textContent)).toEqual(['', '', '', '']);
    expect(text($('[data-price="agent"]'))).toBe('월 299,000원');
    await load('plans.html', { cost: null });
    expect(text($('[data-credit="manager"]'))).toBe('월 500 크레딧');
    await load('plans.html', { noSupabase: true });
    expect($$('.pl-credit').map((c) => c.textContent)).toEqual(['', '', '', '']);
  });

  test('가입 단추 — Manager · Expert 「결제하고 시작」, Agent 「신청하기」, 모두 me.html#partner (로그인 전이면 그곳 로그인 안내가 #partner 로 돌아온다)', async () => {
    await load('plans.html');
    expect(
      $$('[data-signup]').map((a) => [
        a.getAttribute('data-signup'),
        text(a),
        a.getAttribute('href'),
      ])
    ).toEqual([
      ['manager', '결제하고 시작', 'me.html#partner'],
      ['expert', '결제하고 시작', 'me.html#partner'],
      ['agent', '신청하기', 'me.html#partner'],
    ]);
    expect(window.SeganPlans.SIGNUP).toBe('me.html#partner');
    // 로그인 없이 me.html#partner 를 열면 로그인 안내가 돌아올 곳에 #partner 를 붙인다 (segan/me.js keepHashOnGate —
    // 마이페이지 하위 화면 주소 모두, 동작은 __tests__/segan-partner.test.js)
    expect(read('segan/me.js')).toContain("encodeURIComponent('segan/me.html#' + name)");
    // Standard 는 무료 — 결제 단추 없이 AI 연출컷으로
    expect(tier('standard').querySelector('[data-signup]')).toBeNull();
    expect(tier('standard').querySelector('a').getAttribute('href')).toBe('./');
  });

  test('금액 · 크레딧 숫자를 화면 · 스크립트에 적어 두지 않는다', () => {
    const html = read('segan/plans.html');
    const js = read('segan/plans.js');
    for (const src of [html, js]) {
      expect(src).not.toMatch(/\d{1,3},\d{3}\s*원/);
      expect(src).not.toMatch(/\b(?:99000|199000|299000)\b/);
      expect(src).not.toMatch(/\d\s*크레딧|연출컷 \d|\d\s*회 /);
    }
  });

  test('payments-api 주소 · 표는 partner.js 와 같은 곳 (DADAM_CONFIG.paymentsApi.url · credit_plans)', () => {
    const js = read('segan/plans.js');
    expect(js).toContain("fetch(base + '/plans')");
    expect(js).toContain('config().paymentsApi && config().paymentsApi.url');
    expect(js).toContain(".from('credit_plans').select('tier, monthly_credits')");
    expect(read('segan/partner.js')).toContain("fetch(P.pay + '/plans')");
    expect(read('segan/partner.js')).toContain(
      "from('credit_plans').select('tier, monthly_credits')"
    );
  });
});

describe('소개 · 구독 — [소개 | 구독] · 폰 탭 SEGAN', () => {
  test.each([
    ['about.html', '소개'],
    ['plans.html', '구독'],
  ])('%s — 위에 [소개 | 구독], 지금 화면이 켜진다 · 폰 탭은 SEGAN', async (page, on) => {
    await load(page);
    const seg = $('nav.in-seg');
    expect(seg.getAttribute('aria-label')).toBe('SEGAN');
    expect([...seg.querySelectorAll('a')].map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['소개', 'about.html'],
      ['구독', 'plans.html'],
    ]);
    expect(text(seg.querySelector('[aria-current="page"]'))).toBe(on);
    expect(
      seg.compareDocumentPosition($('h1')) & window.Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy(); // 맨 위
    expect(text($('.sg-tabbar a[aria-current="page"]'))).toBe('SEGAN');
    expect($('.sg-nav a[aria-current="page"]').getAttribute('href')).toBe(page);
  });

  test('[소개 | 구독] 은 폰 · 태블릿만 — PC(1024px~)는 위 메뉴에 둘 다 있어 감춘다, 누르는 곳 44px', () => {
    const css = read('segan/info.css');
    const wide = css.split('@media (min-width: 1024px)')[1];
    expect(wide).toMatch(/\.in-seg\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/\.in-seg a\s*\{[^}]*min-height:\s*44px;/);
    expect(css).toMatch(/\.in-btn\s*\{[^}]*min-height:\s*48px;/);
    expect(css).toMatch(/word-break:\s*keep-all/);
    // v5 — 라운드 · 섀도 없음
    expect(css).not.toMatch(/box-shadow\s*:/);
    expect(css).not.toMatch(/border-radius\s*:\s*(?!0[;\s])/);
  });
});

describe('AI 시스템 소개 (about.html)', () => {
  test('흐름 — 연출컷 · 상담 → 본사 배분 → 팩토리(설계 · BOM · 작업지시서) → 생산 · 시공 → A/S → 학습 (그림 없이 상자로)', async () => {
    await load('about.html');
    const flows = $$('ol.ab-flow');
    expect(flows).toHaveLength(2);
    const steps = (ol) => [...ol.querySelectorAll('.ab-step b')].map(text);
    expect(steps(flows[0])).toEqual([
      '연출컷 · 상담',
      '다담 본사 배분',
      '팩토리 — 설계 · BOM · 작업지시서',
      '생산 · 시공',
      'A/S',
      '학습',
    ]);
    expect(steps(flows[1])).toEqual(['제작 의뢰', '본사 추천', '선택']);
    expect(text($('#abMakerTitle'))).toBe('Manager 업체의 제작 의뢰');
    expect($$('main img')).toHaveLength(0);
    expect($$('.ab-points b').map(text)).toEqual([
      '실제 시공 사진 기반 연출컷',
      '설계부터 작업지시서까지 한 앱',
      '상담을 가까운 팩토리로',
      '등급별 도구',
    ]);
  });

  test('「AI 연출컷 시작」(./) · 「구독 보기」(plans.html) · 셸 + SEGAN 비서만 싣는다 (로그인 · 데이터를 묻지 않는다)', async () => {
    const { calls, scripts } = await load('about.html');
    expect($$('.in-acts a').map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['AI 연출컷 시작', './'],
      ['구독 보기', 'plans.html'],
    ]);
    // 설정 · Supabase 는 SEGAN 비서가 열릴 때만 로그인을 본다 (segan/guide.js) — 화면은 아무것도 묻지 않는다
    expect(scripts.map((s) => s.split('?')[0])).toEqual([
      '../js/config.js',
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45',
      'shell.js',
      'guide.js',
    ]);
    expect(calls.fetch).toEqual([]);
  });
});

describe('매거진 (blog.html)', () => {
  test('분류 넷(자재 · 설치 · 하드웨어 · 주방기기) · 「글을 준비하고 있습니다」 · 검색에 내지 않는다', async () => {
    await load('blog.html');
    expect($$('.bl-cat h2').map(text)).toEqual(['자재', '설치', '하드웨어', '주방기기']);
    expect(document.body.textContent).toContain('글을 준비하고 있습니다');
    const html = read('segan/blog.html');
    expect(html).toMatch(/<meta name="robots" content="noindex,nofollow" \/>/);
    expect(html).not.toMatch(/rel="canonical"/);
    expect(read('sitemap.xml')).not.toContain('/segan/blog');
    expect(text($('.sg-tabbar a[aria-current="page"]'))).toBe('매거진');
  });
});

describe('주소 — 옛 /pricing 은 구독 화면으로, 서비스 워커가 새 화면을 담는다', () => {
  test('_redirects — /pricing · /pricing.html → /segan/plans (pricing.html 파일은 남긴다)', () => {
    const lines = read('_redirects')
      .split(/\r?\n/)
      .filter((l) => /^\/pricing/.test(l))
      .map((l) => l.trim().split(/\s+/));
    expect(lines).toEqual([
      ['/pricing', '/segan/plans', '301'],
      ['/pricing.html', '/segan/plans', '301'],
    ]);
    expect(fs.existsSync(path.join(ROOT, 'pricing.html'))).toBe(true);
  });

  test('sw.js — 새 화면 · 스크립트 · 스타일을 미리 담는다', () => {
    const sw = read('segan/sw.js');
    for (const page of ['about.html', 'plans.html', 'blog.html'])
      expect(sw).toContain(`SCOPE + '${page}'`);
    for (const asset of ['plans.js', 'info.css'])
      expect(sw).toContain(`versioned(SCOPE + '${asset}')`);
  });
});
