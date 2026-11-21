/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, jest */
/**
 * SEGAN 알리는 화면 — 구독(segan/plans.html + plans.js) · AI 시스템 소개(about.html) · 매거진(blog.html).
 *
 *   - 구독: 등급 넷(Standard 무료 · Manager · Expert · Agent), 도구는 아래 등급에 더해 늘어난다.
 *     이름 · 월 금액은 payments-api GET /plans, 월 크레딧은 credit_plans, 연출컷 횟수는 credit_costs(generate) 로 나눈다.
 *     /plans 를 못 읽으면 금액 없이 표만 + 알림 (숫자를 지어내지 않는다). 가입 단추는 모두 me.html#partner
 *   - 소개: 흐름 상자(그림 없이) · 강점 · 「AI 연출컷 시작」 · 「구독 보기」
 *   - 소개 · 구독 위 [소개 | 구독] (폰 · 태블릿만 — PC 는 위 메뉴에 둘 다), 폰 탭은 두 화면에서 「홈」이 켜진다 (홈 안의 줄로 들어온다)
 *   - 매거진: 책장 — 선반 한 줄에 글마다 책 하나 (표지 · 분류 · 제목 · 읽는 시간 → blog-<이름>.html).
 *     표지 = 위 호수 · 분류, 가운데 사진, 아래 영문 제호. 책 아래에 한 줄 소개는 두지 않는다 (2026-11-20 대표님).
 *     끌기 · 움직임(blog.js)은 segan-magazine.test.js
 *   - 매거진 글: 매거진 탭이 켜진다 · 「‹ 매거진」 · 검토용 표시(확인 필요 · 메모 · 그림 제안)가 없다 · 표는 칸마다 옆으로 넘긴다
 *     · 끝에 「고객이 확인할 것」 · 다른 글 링크. 목록도 글도 아직 검색에 내지 않는다 (noindex · 사이트맵 없음)
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

describe('구독 (plans.html) — 사업자등록증 첫 달 무료 안내 (2026-11-21 대표님 계획 승인)', () => {
  test('첫 글 아래 한 줄 — 누가 · 얼마 동안 · 그 전에 해지하면 결제 없음 · 번호마다 한 번', () => {
    const html = read('segan/plans.html').replace(/\s+/g, ' ');
    const m = /<p class="in-note pl-trial" id="plTrial">(.*?)<\/p>/.exec(html);
    expect(m).not.toBeNull();
    const text = m[1].trim();
    expect(text).toBe(
      '팩토리를 처음 시작할 때 사업자등록증을 등록하면 첫 달은 무료입니다. 카드를 등록해도 30일 동안 결제되지 않고, 그 전에 해지하면 결제되지 않습니다. 사업자등록번호마다 한 번, 계속사업자만 받을 수 있습니다.'
    );
    // 30일 = 결제 서버의 무료 기간 (payments-api src/trial.js TRIAL_DAYS)
    expect(read('workers/payments-api/src/trial.js')).toMatch(/export const TRIAL_DAYS = 30;/);
    // 첫 글(.in-lead)과 금액 안내 줄(#plState) 사이
    expect(html).toMatch(/class="in-lead"[sS]*id="plTrial"[sS]*id="plState"/);
  });
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
      '플래너 (설계 · 저장)',
      '철물 · 부속 카탈로그',
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
    expect(tier('standard').querySelector('a').getAttribute('href')).toBe('make.html');
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

describe('소개 · 구독 — [소개 | 구독] · 폰 탭 홈', () => {
  test.each([
    ['about.html', '소개'],
    ['plans.html', '구독'],
  ])('%s — 위에 [소개 | 구독], 지금 화면이 켜진다 · 폰 탭은 홈', async (page, on) => {
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
    expect(text($('.sg-tabbar a[aria-current="page"]'))).toBe('홈'); // 폰은 홈 안의 줄로 들어온다
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
  test('흐름 — 연출컷 · 상담 → 상담 배분 → 팩토리(설계 · BOM · 작업지시서) → 생산 · 시공 → A/S → 학습', async () => {
    await load('about.html');
    const flows = $$('ol.ab-flow');
    expect(flows).toHaveLength(1);
    const steps = (ol) => [...ol.querySelectorAll('.ab-step b')].map(text);
    expect(steps(flows[0])).toEqual([
      '연출컷 · 상담',
      '상담 배분',
      '팩토리 — 설계 · BOM · 작업지시서',
      '생산 · 시공',
      'A/S',
      '학습',
    ]);
    // 「Manager 업체의 제작 의뢰」 칸은 지웠다 (2026-11-21 대표님 「매니저 업체 제작 의뢰는 삭제 해줘」)
    expect($('#abMakerTitle')).toBeNull();
    expect($$('.in-h2').map(text)).toEqual(['일이 흐르는 길', 'SEGAN 이 잘하는 것']);
    expect(text($('main'))).not.toMatch(/제작 의뢰|제작을 의뢰/);
    // 「다담 본사」라는 말은 쓰지 않는다 (2026-11-21 대표님 「다담 본사라는 말은 빼줘」)
    expect(text($('main'))).not.toMatch(/본사/);
    expect($$('.ab-points b').map(text)).toEqual([
      '실제 시공 사진 기반 연출컷',
      '설계부터 작업지시서까지 한 앱',
      '상담을 가까운 팩토리로',
      '등급별 도구',
    ]);
  });

  test('사진 — 맨 위 한 장 + 「일이 흐르는 길」 여섯 칸 (2026-11-21 대표님 「시각자료 힉스필드로」)', async () => {
    await load('about.html');
    const imgs = $$('main img');
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      'about/hero.jpg',
      'about/step-1.jpg',
      'about/step-2.jpg',
      'about/step-3.jpg',
      'about/step-4.jpg',
      'about/step-5.jpg',
      'about/step-6.jpg',
    ]);
    for (const img of imgs) {
      const src = img.getAttribute('src');
      // 가벼운 webp 먼저, jpg 는 못 읽는 브라우저용 — 두 파일 다 있다
      const source = img.parentNode.querySelector('source');
      expect(img.parentNode.tagName).toBe('PICTURE');
      expect(source.getAttribute('type')).toBe('image/webp');
      expect(source.getAttribute('srcset')).toBe(src.replace(/\.jpg$/, '.webp'));
      for (const f of [src, source.getAttribute('srcset')]) {
        const file = path.join(ROOT, 'segan', f);
        expect([f, fs.existsSync(file)]).toEqual([f, true]);
        expect(fs.statSync(file).size).toBeLessThan(160 * 1024); // 화면용 크기로 줄인 것
      }
      // 자리를 먼저 잡는다 (밀림 없음) · 무엇의 사진인지 글로도
      expect(img.getAttribute('width')).toMatch(/^\d+$/);
      expect(img.getAttribute('height')).toMatch(/^\d+$/);
      expect(img.getAttribute('alt').length).toBeGreaterThan(5);
      expect(img.getAttribute('decoding')).toBe('async');
    }
    // 맨 위 사진은 바로, 흐름 칸 사진은 보일 때 받는다
    expect(imgs[0].hasAttribute('loading')).toBe(false);
    expect(imgs[0].getAttribute('fetchpriority')).toBe('high');
    expect([imgs[0].getAttribute('width'), imgs[0].getAttribute('height')]).toEqual([
      '1600',
      '900',
    ]);
    expect(imgs.slice(1).every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
    // 흐름 여섯 칸 — 사진 · 글(번호는 글 칸에) 차례
    const flows = $$('ol.ab-flow');
    const first = [...flows[0].children];
    expect(first).toHaveLength(6);
    for (const li of first) {
      expect(li.className).toBe('ab-step ab-step--shot');
      expect([...li.children].map((c) => c.className)).toEqual(['ab-shot', 'ab-text']);
      expect(li.querySelectorAll('.ab-text b, .ab-text span')).toHaveLength(2);
    }
    // AI 로 만든 사진임을 밝힌다
    expect(text($('.ab-note'))).toBe('이 화면의 사진은 AI 로 연출한 이미지입니다.');
    // 사진 칸 모습 — 잘리지 않게 꽉 채움, 폰은 16:9 · PC 는 4:3, 받기 전에는 사진 바탕색
    const css = read('segan/info.css');
    expect(css).toMatch(/\.ab-hero img,\s*\.ab-shot img \{[^}]*object-fit:\s*cover;/);
    expect(css).toMatch(
      /\n\.ab-shot \{[^}]*aspect-ratio:\s*16 \/ 9;[^}]*background:\s*var\(--v5-photo\);/
    );
    expect(css).toMatch(/\n {2}\.ab-shot \{\s*aspect-ratio:\s*4 \/ 3;/);
    expect(css).toMatch(/\n\.ab-hero \{[^}]*aspect-ratio:\s*16 \/ 9;/);
  });

  test('「AI 연출컷 시작」(make.html) · 「구독 보기」(plans.html) · 셸 + SEGAN 비서만 싣는다 (로그인 · 데이터를 묻지 않는다)', async () => {
    const { calls, scripts } = await load('about.html');
    expect($$('.in-acts a').map((a) => [text(a), a.getAttribute('href')])).toEqual([
      ['AI 연출컷 시작', 'make.html'],
      ['구독 보기', 'plans.html'],
    ]);
    // 설정 · Supabase 는 SEGAN 비서가 열릴 때만 로그인을 본다 (segan/guide.js) — 화면은 아무것도 묻지 않는다
    expect(scripts.map((s) => s.split('?')[0])).toEqual([
      '../js/config.js',
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45',
      'motion.js', // 움직임 한 벌 — 화면 바꾸기
      'shell.js',
      'guide.js',
    ]);
    expect(calls.fetch).toEqual([]);
  });
});

/** 매거진 글 — [이름, 분류, 제목, 읽는 시간(분), 표지 제호] (책장 차례). 글 화면은 segan/blog-<이름>.html */
const ARTICLES = [
  ['materials', '자재', '보드부터 엣지까지, 가구 자재 읽는 법', 5, 'MATERIAL'],
  ['edge-finish', '설치', '몰딩 · 휠라 · 쫄 · 무몰딩, 가구 끝 마감 구분하기', 4, 'INSTALL'],
  ['hardware', '하드웨어', '서랍레일 · 망장 · 쇼바 · 리프트업, 여닫는 철물 고르기', 5, 'HARDWARE'],
  [
    'kitchen-appliances',
    '주방기기',
    '싱크볼 · 수전 · 후드 · 쿡탑, 가구보다 먼저 정하는 이유',
    5,
    'KITCHEN',
  ],
  ['drawer-rails', '하드웨어', '서랍레일, 볼레일 · 언더레일 · 박스 시스템 읽기', 6, 'RAIL'],
  ['hinges', '하드웨어', '경첩, 덮음 방식 · 열림 각도 · 댐핑 읽기', 7, 'HINGE'],
];
/** 표지 하나 — [글 이름(클래스), 제호, 호수, 아래 글] */
const coverOf = (el) => [
  [...el.classList].find((c) => c.startsWith('bk-cover--')).replace('bk-cover--', ''),
  text(el.querySelector('.bk-mast')),
  text(el.querySelector('.bk-no')),
  text(el.querySelector('.bk-tag')),
];
const articlePage = (slug) => `blog-${slug}.html`;
/** 표 하나 — 캡션 글로 찾는다 */
const tableOf = (caption) =>
  $$('article table').find((t) => text(t.querySelector('caption')) === caption);
/** 아직 검색에 내지 않는다 — noindex · canonical 없음 · 사이트맵에 없음 */
const expectHidden = (page) => {
  const html = read(`segan/${page}`);
  expect(html).toMatch(/<meta name="robots" content="noindex,nofollow" \/>/);
  expect(html).not.toMatch(/rel="canonical"/);
  expect(read('sitemap.xml')).not.toContain(`/segan/${page.replace(/\.html$/, '')}`);
};

describe('매거진 (blog.html) — 책장', () => {
  test('선반 한 줄에 글마다 책 하나 — 분류 · 제목 · 읽는 시간 → 글 화면 (책 차례 = 자재 · 설치 · 하드웨어 · 주방기기)', async () => {
    await load('blog.html');
    expect($$('.bk-case')).toHaveLength(1);
    expect($$('ul.bk-shelf')).toHaveLength(1);
    // 칸마다 책 하나 — 칸 전체가 링크
    expect($$('ul.bk-shelf > li.bk-cell')).toHaveLength(ARTICLES.length);
    expect($$('ul.bk-shelf > li.bk-cell > a.bk-book')).toHaveLength(ARTICLES.length);
    const listed = $$('a.bk-book').map((a) => [
      a.getAttribute('href'),
      text(a.querySelector('.bk-cat')),
      text(a.querySelector('.bk-title')),
      text(a.querySelector('.bk-time')),
    ]);
    expect(listed).toEqual(
      ARTICLES.map(([slug, cat, title, min]) => [
        articlePage(slug),
        cat,
        title,
        `읽는 시간 약 ${min}분`,
      ])
    );
    for (const a of $$('a.bk-book')) {
      // 책 아래에는 분류 · 제목 · 읽는 시간만 — 한 줄 소개는 글 화면에서 읽는다
      expect([...a.querySelector('.bk-info').children].map((c) => c.className)).toEqual([
        'bk-cat',
        'bk-title',
        'bk-time',
      ]);
      expect(fs.existsSync(path.join(ROOT, 'segan', a.getAttribute('href')))).toBe(true);
      expect(a.getAttribute('draggable')).toBe('false'); // 링크를 집어 끄는 대신 책장을 끈다
    }
    // 옛 분류 칸 목록은 남지 않는다
    expect($$('.bl-cats, .bl-cat, a.bl-post')).toHaveLength(0);
    expect(read('segan/info.css')).not.toMatch(/\.bl-cats?\b/);
    // 빈 목록 때의 글은 남지 않는다
    expect(document.body.textContent).not.toMatch(/글을 준비하고 있습니다|글 준비 중/);
    expect(text($('.sg-tabbar a[aria-current="page"]'))).toBe('매거진');
    expect($('.sg-nav a[aria-current="page"]').getAttribute('href')).toBe('blog.html');
  });

  test('책 = 칸(조명) 안에 선 표지 — 위 호수 · 분류, 가운데 사진, 아래 영문 제호. 표지 글은 꾸밈이라 읽어 주지 않는다', async () => {
    const { scripts } = await load('blog.html');
    const covers = $$('a.bk-book').map((a) => {
      // 칸 → 조명 + 책이 서는 자리 → 표지
      expect(a.querySelectorAll('.bk-niche > .bk-glow')).toHaveLength(1);
      expect(a.querySelectorAll('.bk-niche > .bk-stand > .bk-cover')).toHaveLength(1);
      const cover = a.querySelector('.bk-cover');
      expect(cover.getAttribute('aria-hidden')).toBe('true');
      // 표지 안 차례 — 사진, 위(호수 · 분류), 아래(영문 제호)
      expect([...cover.children].map((c) => c.className)).toEqual(['bk-art', 'bk-head', 'bk-mast']);
      expect([...cover.querySelector('.bk-head').children].map((c) => c.className)).toEqual([
        'bk-no',
        'bk-tag',
      ]);
      // 사진 — 글 이름의 파일(webp + jpg), 글자 없는 꾸밈 그림
      const slug = a.getAttribute('href').replace(/^blog-|\.html$/g, '');
      const img = cover.querySelector('picture.bk-art > img');
      expect(img.getAttribute('src')).toBe(`magazine/cover-${slug}.jpg`);
      expect(img.getAttribute('alt')).toBe('');
      expect(cover.querySelector('picture.bk-art > source').getAttribute('srcset')).toBe(
        `magazine/cover-${slug}.webp`
      );
      for (const ext of ['jpg', 'webp'])
        expect(fs.existsSync(path.join(ROOT, 'segan/magazine', `cover-${slug}.${ext}`))).toBe(true);
      return coverOf(cover);
    });
    // 칸 사진 — 조명 든 나무 칸 (magazine.css 가 칸 · 빈 칸에 깐다)
    for (const ext of ['jpg', 'webp'])
      expect(fs.existsSync(path.join(ROOT, 'segan/magazine', `niche.${ext}`))).toBe(true);
    expect(read('segan/magazine.css')).toContain("url('magazine/niche.jpg')");
    expect(covers).toEqual(
      ARTICLES.map(([slug, cat, , , mast], i) => [
        slug,
        mast,
        String(i + 1).padStart(2, '0'),
        `MAGAZINE · ${cat}`,
      ])
    );
    // ‹ › 는 처음에 감춰 둔다 — 책이 화면보다 많을 때 blog.js 가 켠다
    expect(
      $$('.bk-case > button.bk-nav').map((b) => [b.hidden, b.getAttribute('aria-label')])
    ).toEqual([
      [true, '앞 책 보기'],
      [true, '다음 책 보기'],
    ]);
    // 책장 스크립트는 셸 · 비서 다음, 첫 그림 전에 (표지 이름을 붙여야 화면 바꾸기가 이어진다)
    expect(scripts.map((s) => s.split('?')[0])).toEqual([
      '../js/config.js',
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45',
      'motion.js',
      'shell.js',
      'guide.js',
      'blog.js',
    ]);
    const html = read('segan/blog.html');
    expect(html).toMatch(/<script src="blog\.js\?v=\d+" defer blocking="render"><\/script>/);
    expect(html).toMatch(/<link rel="stylesheet" href="magazine\.css\?v=\d+" \/>/);
  });

  test('아직 검색에 내지 않는다 — noindex · canonical 없음 · 사이트맵에 없음 (글 화면도)', () => {
    expectHidden('blog.html');
    expect(read('sitemap.xml')).not.toContain('/segan/blog');
  });
});

describe.each(ARTICLES)('매거진 글 (blog-%s.html)', (slug, cat, title, min, mast) => {
  const page = articlePage(slug);

  test('매거진 탭이 켜진다 · 머리(분류 · 제목 · 읽는 시간) · 「‹ 매거진」 · 셸 + SEGAN 비서만 싣는다', async () => {
    const { calls, scripts } = await load(page);
    expect(document.body.getAttribute('data-tab')).toBe('blog');
    expect(text($('.sg-tabbar a[aria-current="page"]'))).toBe('매거진');
    expect($('.sg-nav a[aria-current="page"]').getAttribute('href')).toBe('blog.html');
    expect($$('h1').map(text)).toEqual([title]);
    expect(text($('.ma-cat'))).toBe(cat);
    expect(text($('.ma-meta'))).toBe(`읽는 시간 약 ${min}분`);
    const back = $('a.ma-back');
    expect([text(back), back.getAttribute('href')]).toEqual(['‹ 매거진', 'blog.html']);
    expect(read(`segan/${page}`)).toContain(`<title>${title} · 매거진 · SEGAN</title>`);
    // 읽기만 하는 화면 — 로그인 · 데이터를 묻지 않는다
    expect(scripts.map((s) => s.split('?')[0])).toEqual([
      '../js/config.js',
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45',
      'motion.js', // 움직임 한 벌 — 화면 바꾸기
      'shell.js',
      'guide.js',
      'blog.js', // 책 ↔ 글 — 표지 이름 붙이기
    ]);
    expect(calls.fetch).toEqual([]);
  });

  test('글 머리에 책장의 그 표지 — 같은 제호 · 호수 (표지가 커지며 닿는 자리)', async () => {
    await load('blog.html');
    const onShelf = coverOf($(`a.bk-book[href="${page}"] .bk-cover`));
    await load(page);
    const covers = $$('.ma-head > .ma-cover > .bk-cover');
    expect(covers).toHaveLength(1);
    expect(covers[0].getAttribute('aria-hidden')).toBe('true');
    expect(coverOf(covers[0])).toEqual(onShelf);
    expect(coverOf(covers[0]).slice(0, 2)).toEqual([slug, mast]);
    expect(read(`segan/${page}`)).toMatch(/<link rel="stylesheet" href="magazine\.css\?v=\d+" \/>/);
  });

  test('검토용 표시가 없다 — 확인 필요 · mark · 메모 상자 · 그림 제안 (HTML 주석까지)', async () => {
    const html = read(`segan/${page}`);
    expect(html).not.toMatch(/<mark\b/);
    expect(html).not.toMatch(/<aside\b/);
    expect(html).not.toMatch(/class="[^"]*\b(?:memo|cn|fig-idea|review)\b/);
    for (const word of ['확인 필요', '그림 제안', '검토 메모', '싣지 않음'])
      expect([word, html.includes(word)]).toEqual([word, false]);
    await load(page);
    expect($$('mark, .memo, aside, a.cn')).toHaveLength(0);
  });

  test('글 안에는 회사 · 앱 알림이 없고, 링크는 다른 매거진 글로만', async () => {
    await load(page);
    const article = $('article.ma-article');
    expect(article.getAttribute('data-slug')).toBe(slug);
    expect(text(article)).not.toMatch(/다담|SEGAN|저희|상담 신청|연출컷/);
    // 같은 글 안의 차례(#절)도 된다 — 시리즈 글
    for (const a of article.querySelectorAll('a'))
      expect(a.getAttribute('href')).toMatch(/^(?:blog-[a-z-]+\.html|#[a-z0-9-]+)$/);
  });

  test('표는 칸마다 옆으로 넘기는 상자 안 · 끝에 「고객이 확인할 것」 · 아래에 다른 글 셋', async () => {
    await load(page);
    const tables = $$('article table');
    expect(tables.length).toBeGreaterThan(1);
    for (const t of tables) {
      const box = t.parentElement;
      expect(box.classList.contains('ma-table')).toBe(true);
      expect(box.getAttribute('tabindex')).toBe('0'); // 키보드로도 넘긴다
      expect(box.getAttribute('role')).toBe('region');
      expect(box.getAttribute('aria-label')).toBe(text(t.querySelector('caption')));
      const cols = t.querySelectorAll('thead th[scope="col"]').length;
      if (cols >= 4) expect(t.classList.contains(`ma-cols-${cols}`)).toBe(true);
    }
    const sections = $$('article.ma-article > section');
    const last = sections[sections.length - 1];
    expect(last.classList.contains('ma-final')).toBe(true);
    expect(text(last.querySelector('h2'))).toBe('고객이 확인할 것');
    expect(last.querySelectorAll('ul.ma-check > li').length).toBeGreaterThanOrEqual(5);
    expect($$('.ma-final')).toHaveLength(1);
    expect($$('.ma-more a.bl-post').map((a) => a.getAttribute('href'))).toEqual(
      ARTICLES.filter(([s]) => s !== slug).map(([s]) => articlePage(s))
    );
  });

  test('아직 검색에 내지 않는다 — noindex · canonical 없음 · 사이트맵에 없음', () => {
    expectHidden(page);
  });
});

describe('매거진 글 — 실을 때 고친 곳', () => {
  test('자재 — 몸통 15T 문장은 그대로, 가구 안전기준 1.5 mg/L 문장은 뺀다 (등급 표 · SE0 끝 글자 문장은 남긴다)', async () => {
    await load('blog-materials.html');
    const body = text($('article'));
    expect(body).toContain(
      '몸통 판은 보통 15T를 씁니다. 더 두꺼운 판을 쓰는 업체도 있으니, 견적서에 몸통 · 도어 · 뒷판의 보드와 두께가 따로 적혀 있는지 봅니다.'
    );
    expect(body).not.toContain('가구 안전기준');
    expect(body).not.toContain('E1이 이 선에 있고');
    expect(body).toContain('SE0의 끝 글자는 숫자 0입니다. Super E0를 줄인 말입니다.');
    const grades = tableOf('포름알데히드 방출 등급');
    expect([...grades.querySelectorAll('tbody tr')].map((tr) => text(tr))).toEqual([
      'SE0 0.3 mg/L 이하 0.4 mg/L 이하 세 등급 가운데 방출량이 가장 적습니다.',
      'E0 0.5 mg/L 이하 0.7 mg/L 이하 SE0 다음으로 적습니다.',
      'E1 1.5 mg/L 이하 2.1 mg/L 이하 세 등급 가운데 방출량이 가장 많습니다.',
    ]);
  });

  test('하드웨어 — 리프트업 움직임 이름은 그대로, Grass 는 Kinvaro 이름만 (모델 기호 · 카탈로그 문장 없음)', async () => {
    await load('blog-hardware.html');
    const lift = tableOf('리프트업 움직임과 브랜드별 제품');
    expect([...lift.querySelectorAll('tbody th')].map(text)).toEqual([
      '고정식',
      '평행 리프트',
      '스윙 업',
      '이중 접이',
    ]);
    expect([...lift.querySelectorAll('tbody tr')].map((tr) => text(tr.lastElementChild))).toEqual([
      '—',
      'Kinvaro',
      'Kinvaro',
      'Kinvaro',
    ]);
    const grass = [...tableOf('국내에서 볼 수 있는 철물 브랜드').querySelectorAll('tbody tr')].find(
      (tr) => text(tr.querySelector('th')).startsWith('Grass')
    );
    expect(text(grass.lastElementChild)).toBe('Kinvaro');
    const body = text($('article'));
    expect(body).toContain(
      '움직임 이름은 이 글에서 설명하려고 붙인 말이라 업체마다 부르는 말이 다를 수 있습니다.'
    );
    expect(body).not.toMatch(/L-80|S-35|F-20/);
    expect(body).not.toContain('카탈로그 기준');
  });

  test('설치 — 엣지 이야기는 자재 글로 잇는다', async () => {
    await load('blog-edge-finish.html');
    const link = $$('article a').find((a) => text(a) === '보드부터 엣지까지, 가구 자재 읽는 법');
    expect(link.getAttribute('href')).toBe('blog-materials.html');
  });

  test('info.css — 표 상자만 옆으로 넘긴다 (본문은 390px 에서도 옆으로 밀리지 않는다)', () => {
    const css = read('segan/info.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.ma-table\s*\{[^}]*overflow-x:\s*auto;/);
    expect(css).toMatch(/\.ma-table\s*\{[^}]*max-width:\s*100%;/);
    // 최소 폭은 표 상자 안(표 · 줄 머리)에만 — 상자 · 본문에는 없다
    const mins = [...css.matchAll(/([^{}]+)\{[^}]*min-width:[^}]*\}/g)].map((m) => m[1].trim());
    expect(mins).toEqual([
      '.ma-table .ma-cols-4',
      '.ma-table .ma-cols-5',
      '.ma-table .ma-cols-6',
      '.ma-table tbody th',
    ]);
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
    for (const page of [
      'about.html',
      'plans.html',
      'blog.html',
      ...ARTICLES.map(([s]) => articlePage(s)),
    ])
      expect(sw).toContain(`SCOPE + '${page}'`);
    for (const asset of ['plans.js', 'info.css', 'magazine.css', 'blog.js'])
      expect(sw).toContain(`versioned(SCOPE + '${asset}')`);
  });
});
