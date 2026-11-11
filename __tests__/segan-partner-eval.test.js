/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「플랫폼 › 팩토리 평가」 (segan/partner-eval.js + segan/me.html #partnerEval)
 *
 *   누가    사이트 관리자(is_admin)만. 관리자가 아니면 묻지도 않는다
 *   데이터  workflow-api GET /admin/companies?pool=1 · GET|PUT /admin/companies/:id/evaluation
 *   화면    팩토리 줄 → 누르면 평가표(설비 · 인력 · 마감 · 자재 · 설계 · 가격대 · 품질 · 서류 · 본사 소통 · 등급 · 메모) · 이력
 *   못 읽으면 칸째 감춘다 — 관리자에게는 PC 화면 줄 하나가 남는다
 *   팩토리 이름 · 메모 · 이메일은 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'admin@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const A1 = 'aaaaaaa1-0000-4000-8000-000000000001';
const A2 = 'aaaaaaa2-0000-4000-8000-000000000002';
const NOW = Date.parse('2026-11-11T03:00:00Z'); // 한국 시간 2026-11-11 (수) 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const PLATFORM = ok({
  company: null,
  application: null,
  members: [],
  invites: [],
  platform_member: true,
});
const NOBODY = ok({ company: null, application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganPartnerEval;
  (0, eval)(read('segan/partner-eval.js'));
  return window.SeganPartnerEval;
};

/** 서버 evaluationCatalog 와 같은 꼴 (줄여서) */
const CATALOG = () => ({
  equipment: [
    { key: 'table_saw', name: '테이블쏘' },
    { key: 'boring', name: '보링' },
  ],
  staff_roles: [
    { key: 'design', name: '설계' },
    { key: 'assembly', name: '조립' },
  ],
  staff_total: [{ key: 'total', name: '전체 인원 (실제 사람 수)' }],
  staff_dedicated: [{ key: 'dedicated', name: '전담' }],
  suppliers: [
    {
      key: 'door',
      name: '도어',
      companies: [
        { key: 'ex_a', name: '예시 도어 가', kind: 'PET' },
        { key: 'ex_b', name: '예시 도어 나', kind: '' },
      ],
    },
    { key: 'hw', name: '하드웨어', companies: [{ key: 'ex_h', name: '예시 철물', kind: '경첩' }] },
  ],
  finish_notes: [{ key: 'door', name: '도어' }],
  design: [
    { key: 'cad', name: 'CAD' },
    { key: 'sketchup', name: '스케치업' },
  ],
  docs: [
    { key: 'insurance', name: '배상 책임 보험' },
    { key: 'contract', name: '표준 계약서' },
  ],
  limits: { supplier_rows: 3, supplier_name: 40, finish_note: 500, hq_comm: 10 },
});

const POOL = () => [
  {
    id: A1,
    name: '다담 공장',
    kind: 'hq',
    plan: null,
    status: 'active',
    sido: '대구광역시',
    gugun: '북구',
    grade: 'A',
    evaluated_at: '2026-11-03T02:10:00Z',
    docs_ok: true,
    settings_ok: true,
  },
  {
    id: A2,
    name: '예시 가온 팩토리',
    kind: 'partner',
    plan: 'agent',
    status: 'active',
    sido: '대구광역시',
    gugun: '수성구',
    grade: null,
    evaluated_at: null,
    docs_ok: false,
    settings_ok: false,
  },
];

const EVAL1 = () => ({
  company_id: A1,
  grade: 'A',
  equipment: { table_saw: 'have' },
  staff: { total: 5, design: 2, assembly: 1, dedicated: ['design'] },
  finishes: {
    door: [
      { key: 'ex_a', main: true },
      { name: '예시 공방', main: false },
    ],
    notes: { door: '무광 위주' },
  },
  design: { cad: true },
  install: {},
  hq_comm: { score: 8 },
  price_tier: 'mid',
  docs: { insurance: { checked_at: '2026-10-20', checked_by: 'user-9' } },
  as_months: 24,
  warranty_months: 12,
  note: '예시 메모',
  evaluated_at: '2026-11-03T02:10:00Z',
  evaluated_by: 'user-9',
});
const EMPTY = (id) => ({
  company_id: id,
  grade: null,
  equipment: {},
  staff: {},
  finishes: {},
  design: {},
  install: {},
  hq_comm: {},
  price_tier: null,
  docs: {},
  as_months: null,
  warranty_months: null,
  note: null,
  evaluated_at: null,
  evaluated_by: null,
});
const SCORE = () => ({
  areas: [
    { key: 'equipment', name: '설비', points: 12.5, max: 20 },
    { key: 'staff', name: '인력', points: 10, max: 20 },
  ],
  total: 22.5,
  max: 40,
  grade: 'A',
});
const DETAIL = (id) =>
  id === A1
    ? {
        company: { id: A1, name: '다담 공장', kind: 'hq', plan: null, status: 'active' },
        evaluation: EVAL1(),
        score: SCORE(),
        catalog: CATALOG(),
        metrics: { satisfaction: 4.56, response_rate: 0.92, rework_free_rate: null },
        history: [
          {
            evaluated_at: '2026-11-03T02:10:00Z',
            evaluated_by_email: 'admin@example.com',
            grade: 'A',
          },
          { evaluated_at: '2026-09-14T06:00:00Z', evaluated_by_email: null, grade: null },
        ],
      }
    : {
        company: { id, name: '예시 가온 팩토리', kind: 'partner', plan: 'agent', status: 'active' },
        evaluation: EMPTY(id),
        score: null,
        catalog: CATALOG(),
        metrics: {},
        history: [],
      };

/**
 * 마이페이지를 띄운다 (기본 = 사이트 관리자인 본사 구성원, 팩토리 평가 화면)
 * opts.list(n) · opts.get(id, n) · opts.put(id, body) 로 답을 바꾼다 · opts.gate = 저장 답을 붙잡아 둘 약속
 */
async function load(options = {}) {
  const store = { lists: 0, gets: 0 };
  const opts = {
    session: SESSION,
    partner: PLATFORM,
    hash: '#partner-eval',
    isAdmin: true,
    list: null,
    get: null,
    put: null,
    gate: null,
    work: WORK,
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  localStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerEval',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.work },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [], store };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: opts.isAdmin, error: null } : { data: [], error: null },
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const method = init.method || 'GET';
    calls.fetch.push({
      url,
      method,
      auth: (init.headers || {}).Authorization,
      type: (init.headers || {})['Content-Type'],
      cache: init.cache,
      body,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/admin/companies?pool=1') {
      store.lists += 1;
      return reply(opts.list ? await opts.list(store.lists) : ok({ items: POOL() }));
    }
    if (url.startsWith(WORK + '/admin/companies/')) {
      const id = decodeURIComponent(url.slice((WORK + '/admin/companies/').length).split('/')[0]);
      if (method === 'GET') {
        store.gets += 1;
        return reply(opts.get ? await opts.get(id, store.gets) : ok(DETAIL(id)));
      }
      if (opts.gate) await opts.gate;
      return reply(opts.put ? await opts.put(id, body) : ok({ evaluation: {}, score: SCORE() }));
    }
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/work/me') return reply(ok({ ready: true, worker: null }));
    return reply(fail(404, 'not_found', 'x'));
  });
  Element.prototype.scrollIntoView = jest.fn();
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/partner-eval.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const box = () => $('partnerEvalBody');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const part = (name) => q(`[data-pe="${name}"]`);
const act = (name) => q(`[data-act="${name}"]`);
const grp = (key) => q(`section[data-group="${key}"]`);
const menu = (key) => document.querySelector(`#meHub li[data-me-item="${key}"]`);
const press = async (el) => {
  el.click();
  await flush();
};
const open = async (id) => press(q(`[data-co="${id}"]`));
const change = (el, value) => {
  if (value !== undefined) el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
};
const typeIn = (el, value) => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const tick = (el, on = true) => {
  el.checked = on;
  change(el);
};
const asked = (calls) =>
  calls.fetch
    .filter((c) => c.url.startsWith(WORK + '/admin/companies'))
    .map((c) => c.method + ' ' + c.url.slice(WORK.length));
const puts = (calls) => calls.fetch.filter((c) => c.method === 'PUT');
const EVAL_PATH = (id) => `/admin/companies/${id}/evaluation`;

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 등록 업체 다음의 제 칸 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('partnerEval');
    expect(el).not.toBeNull();
    expect(el.tagName).toBe('SECTION');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.classList.contains('me-screen')).toBe(true);
    expect(el.previousElementSibling.id).toBe('hqCompanies');
    expect(el.getAttribute('aria-labelledby')).toBe('partnerEvalTitle');
    expect(text(doc.getElementById('partnerEvalTitle'))).toBe('팩토리 평가');
    expect(doc.getElementById('partnerEvalBody').parentElement).toBe(el);
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['partner-eval.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('partner-eval.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'partner-eval.js')");
  });

  test('메뉴 — 플랫폼 아래 앱 화면 줄, 바로 다음에 관리자 PC 화면 줄 (둘 다 처음엔 감춘다)', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const li = doc.querySelector('li[data-me-item="partner-eval"]');
    expect(li).not.toBeNull();
    expect(li.closest('ul').id).toBe('meSubPlatform');
    expect(li.hasAttribute('hidden')).toBe(true);
    const a = li.querySelector('a');
    expect(a.getAttribute('href')).toBe('#partner-eval');
    expect(a.getAttribute('data-me-go')).toBe('partner-eval');
    expect(text(a)).toBe('팩토리 평가');
    const pc = li.nextElementSibling;
    expect(pc.getAttribute('data-me-item')).toBe('hq-eval');
    expect(pc.hasAttribute('hidden')).toBe(true);
    // 관리자 줄 판정은 me.js rowOn 이 한다 — data-need 로는 앱 화면이 있는지 모른다
    expect(pc.hasAttribute('data-need')).toBe(false);
    expect(pc.querySelector('a').getAttribute('href')).toBe('../admin/partner-eval.html');
    expect(pc.querySelector('a').hasAttribute('data-desktop-tab')).toBe(true);
  });

  test('고르는 값 · 지표 이름 · 알림 글은 PC 화면(admin/partner-eval.html)과 같다', () => {
    const P = mod();
    const pc = read('admin/partner-eval.html');
    expect(P.EQUIP_CHOICES).toEqual([
      ['have', '있음'],
      ['outsource', '외주'],
      ['none', '없음'],
    ]);
    expect(P.PRICE_TIERS).toEqual([
      ['basic', '보급'],
      ['mid', '중급'],
      ['high', '고급'],
    ]);
    for (const [key, name] of [...P.EQUIP_CHOICES, ...P.PRICE_TIERS]) {
      expect(pc).toContain(`['${key}', '${name}']`);
    }
    for (const [key, name] of Object.entries(P.METRIC_LABEL)) {
      expect(pc).toContain(`${key}: '${name}'`);
    }
    for (const d of P.DOC_ITEMS) expect(pc).toContain(`{ key: '${d.key}', name: '${d.name}' }`);
    for (const key of [
      'lead',
      'empty',
      'notGraded',
      'noCatalog',
      'saved',
      'saving',
      'dirty',
      'keep',
      'noHistory',
      'addCompany',
      'pickCompany',
      'custom',
    ]) {
      expect(P.TEXT[key].length).toBeGreaterThan(2);
      expect(pc).toContain(P.TEXT[key]);
    }
    for (const g of Object.values(P.GROUP)) {
      expect(pc).toContain(g[0]);
      if (g[1]) expect(pc).toContain(g[1]);
    }
  });

  test('평가 · 메모를 기기에 남기지 않는다 — 저장소 · 알림을 쓰지 않고, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/partner-eval.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
    expect(code).not.toMatch(/partner-eval\.html['"]/); // PC 화면으로 보내지 않는다
    expect(code).not.toMatch(/<form\b/); // 폼 제출로 화면이 넘어가지 않는다
  });

  test('폰 — 긴 팩토리 이름은 줄을 바꾼다 · 그림자 · 둥근 모서리 없음', () => {
    const css = read('segan/shell.css');
    const name = /\.pe-rowbtn \.me-c-main b,\s*\.pe-rowbtn \.me-c-main small\s*\{[^}]*\}/.exec(css);
    expect(name).not.toBeNull();
    expect(name[0]).toMatch(/white-space:\s*normal/);
    expect(name[0]).toMatch(/overflow-wrap:\s*anywhere/);
    const rules = css.match(/(^|\n)\.pe[-\s][^{]*\{[^}]*\}/g) || [];
    expect(rules.length).toBeGreaterThanOrEqual(30);
    expect(rules.join('\n')).not.toMatch(/box-shadow|border-radius/);
  });
});

describe('순수 함수', () => {
  test('entries — { key, name } · { key, label } · [key, name] · 글자 모두 받고 키 없는 것은 버린다', () => {
    const P = mod();
    expect(
      P.entries([
        { key: 'a', name: '가' },
        { id: 'b', label: '나' },
        ['c', '다'],
        'd',
        { name: 'x' },
        null,
      ])
    ).toEqual([
      { key: 'a', name: '가', group: undefined },
      { key: 'b', name: '나', group: undefined },
      { key: 'c', name: '다', group: undefined },
      { key: 'd', name: 'd' },
    ]);
    expect(P.entries(null)).toEqual([]);
  });

  test('rowOf · listOf — id 없는 줄은 버린다. 목록이 배열이 아니면 null', () => {
    const P = mod();
    expect(P.rowOf({ name: 'x' })).toBeNull();
    expect(P.rowOf({ id: A1, name: 3, docs_ok: 'yes', settings_ok: true })).toEqual({
      id: A1,
      name: '',
      kind: '',
      plan: '',
      sido: '',
      gugun: '',
      grade: '',
      evaluated_at: '',
      docs_ok: false,
      settings_ok: true,
    });
    expect(P.listOf({ items: [{ id: A1 }, null, {}] }).length).toBe(1);
    expect(P.listOf({ items: 'x' })).toBeNull();
    expect(P.listOf(null)).toBeNull();
  });

  test('kindText · subOf · metricText · docDay', () => {
    const P = mod();
    expect(P.kindText({ kind: 'hq' })).toBe('다담 공장');
    expect(P.kindText({ kind: 'partner', plan: 'expert' })).toBe('Expert');
    expect(P.kindText({ kind: 'partner', plan: 'toString' })).toBe('toString');
    expect(P.kindText({})).toBe('-');
    expect(P.subOf(P.rowOf(POOL()[1]))).toBe('Agent · 대구광역시 수성구 · 평가 전');
    expect(P.subOf(P.rowOf(POOL()[0]))).toMatch(/^다담 공장 · 대구광역시 북구 · 평가 2026-11-03$/);
    expect(P.metricText('response_rate', 0.916)).toBe('92%');
    expect(P.metricText('satisfaction', 4.56)).toBe('4.6 / 5');
    expect(P.metricText('orders_done', 7)).toBe('7');
    expect(P.metricText('satisfaction', null)).toBe('자료 없음');
    expect(P.docDay('2026-10-20')).toBe('2026-10-20');
    expect(P.docDay('')).toBe('');
    expect(P.docDay('엉뚱')).toBe('');
  });
});

describe('목록', () => {
  test('관리자 — 한 번 읽어 팩토리 줄을 그린다 (본인 토큰 · 캐시 없이)', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET /admin/companies?pool=1']);
    const c = calls.fetch.find((x) => x.url.startsWith(WORK + '/admin/companies'));
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(seen('partnerEval')).toBe(true);
    expect(text(part('count'))).toBe('팩토리 2곳');
    const rows = qa('button[data-co]');
    expect(rows.map((b) => text(b.querySelector('b')))).toEqual(['다담 공장', '예시 가온 팩토리']);
    expect([...rows[0].querySelectorAll('.pe-badge')].map(text)).toEqual([
      '등급 A',
      '서류 확인됨',
      '상담 설정 마침',
    ]);
    expect([...rows[1].querySelectorAll('.pe-badge')].map(text)).toEqual([
      '등급 없음',
      '서류 미확인',
      '상담 설정 안 함',
    ]);
    expect(menu('partner-eval').hidden).toBe(false);
    expect(menu('hq-eval').hidden).toBe(true);
  });

  test('풀이 비었으면 — 0곳과 안내 글', async () => {
    await load({ list: () => ok({ items: [] }) });
    expect(seen('partnerEval')).toBe(true);
    expect(text(part('count'))).toBe('팩토리 0곳');
    expect(text(q('.me-empty'))).toBe('팩토리 풀이 비었습니다.');
  });

  test('이름은 글자 그대로 그린다', async () => {
    const pool = POOL();
    pool[1].name = '<img src=x onerror=1>';
    await load({ list: () => ok({ items: pool }) });
    expect(q('img')).toBeNull();
    expect(text(qa('button[data-co] b')[1])).toBe('<img src=x onerror=1>');
  });

  test('팩토리 평가 화면에서만 보인다 — 메뉴 줄을 눌러 들어온다', async () => {
    await load({ hash: '' });
    expect(seen('partnerEval')).toBe(false);
    await press(menu('partner-eval').querySelector('a'));
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(seen('partnerEval')).toBe(true);
  });
});

describe('평가표', () => {
  test('줄을 누르면 — 그 팩토리의 평가표를 읽어 칸을 채운다', async () => {
    const calls = await load();
    await open(A1);
    expect(asked(calls)).toEqual(['GET /admin/companies?pool=1', 'GET ' + EVAL_PATH(A1)]);
    expect(text($('partnerEvalName'))).toBe('다담 공장');
    expect(text(part('sub'))).toMatch(/^다담 공장 · 마지막 평가 2026-11-03 \d\d:\d\d$/);
    expect(part('report')).toBeNull(); // 다담 공장에는 장부 보고서 링크가 없다
    // 설비 — 항목마다 셋 중 하나
    expect(qa('input[name="pe-eq-0"]').map((n) => [n.value, n.checked])).toEqual([
      ['have', true],
      ['outsource', false],
      ['none', false],
    ]);
    expect(qa('input[name="pe-eq-1"]:checked').length).toBe(0);
    // 인력
    expect(q('input[data-staff-total="total"]').value).toBe('5');
    expect(q('input[data-staff="design"]').value).toBe('2');
    expect(q('input[data-staff-ded="design"]').checked).toBe(true);
    expect(q('input[data-staff-ded="assembly"]').checked).toBe(false);
    // 마감 · 자재 — 고른 회사 · 직접 적은 회사 · 빈 분야에는 빈 줄 하나
    const door = qa('[data-sup-group="door"] [data-sup-row]');
    expect(door.length).toBe(2);
    expect(door[0].querySelector('select').value).toBe('key:ex_a');
    expect(door[0].querySelector('[data-sup-main]').checked).toBe(true);
    expect(door[1].querySelector('select').value).toBe('custom');
    expect(door[1].querySelector('[data-sup-name]').value).toBe('예시 공방');
    expect(door[1].querySelector('[data-sup-name]').hidden).toBe(false);
    expect(door[0].querySelector('[data-sup-name]').hidden).toBe(true);
    expect(qa('[data-sup-group="hw"] [data-sup-row]').length).toBe(1);
    expect(q('textarea[data-finish-note="door"]').value).toBe('무광 위주');
    expect(q('textarea[data-finish-note="hw"]')).toBeNull(); // catalog finish_notes 에 없는 분야
    // 설계 · 가격대 · 품질 · 서류 · 본사 소통 · 메모
    expect(q('input[data-design="cad"]').checked).toBe(true);
    expect(q('input[data-design="sketchup"]').checked).toBe(false);
    expect(q('input[name="pe-price"]:checked').value).toBe('mid');
    expect($('peAsMonths').value).toBe('24');
    expect($('peWarrantyMonths').value).toBe('12');
    expect(q('input[data-doc="insurance"]').checked).toBe(true);
    expect(q('input[data-doc-date="insurance"]').value).toBe('2026-10-20');
    expect(q('input[data-doc="contract"]').checked).toBe(false);
    expect($('peHqComm').value).toBe('8');
    expect($('peHqComm').getAttribute('max')).toBe('10');
    expect($('peNote').value).toBe('예시 메모');
  });

  test('자동 지표 · 본사 등급 · 평가 이력을 보여 준다 (등급은 고르는 칸이 없다)', async () => {
    await load();
    await open(A1);
    expect(text(part('metrics'))).toBe(
      '고객 만족 4.6 / 524시간 안 받기 92%재작업 없는 수주 자료 없음'
    );
    expect(text(part('grade'))).toBe('A 합계 22.5 / 40점설비12.5 / 20인력10 / 20');
    expect(grp('grade').querySelector('input, select, textarea')).toBeNull();
    const hist = qa('.pe-history li').map(text);
    expect(hist.length).toBe(2);
    expect(hist[0]).toMatch(/^2026-11-03 \d\d:\d\d등급 Aadmin@example\.com$/);
    expect(hist[1]).toMatch(/^2026-09-14 \d\d:\d\d등급 없음$/);
  });

  test('아직 평가하지 않은 협력 팩토리 — 빈 칸 · 안내 글 · 장부 보고서 링크', async () => {
    await load();
    await open(A2);
    expect(text(part('sub'))).toBe('Agent · 마지막 평가 없음');
    const a = part('report');
    expect(a.getAttribute('href')).toBe('ledger-report.html?company=' + A2);
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener');
    expect(text(part('grade'))).toBe('아직 평가하지 않았습니다. 저장하면 등급이 매겨집니다.');
    expect(part('metrics')).toBeNull();
    expect(text(grp('history').querySelector('.me-empty'))).toBe('이력이 없습니다.');
    expect(qa('input[type="radio"]:checked').length).toBe(0);
  });

  test('칸마다 이름이 붙는다 — 고르기 묶음 · 숫자 · 회사 · 날짜', async () => {
    await load();
    await open(A1);
    expect(qa('[role="radiogroup"]').map((n) => n.getAttribute('aria-label'))).toEqual([
      '테이블쏘',
      '보링',
      '가격대',
    ]);
    for (const el of qa(
      'input[type="number"], input[type="date"], select, textarea, input[type="text"]'
    )) {
      expect(el.getAttribute('aria-label')).toBeTruthy();
    }
    for (const el of qa('input[type="checkbox"], input[type="radio"]')) {
      expect(el.closest('label')).not.toBeNull();
    }
  });

  test('catalog 가 비면 — 묶음마다 안내 글, 서류는 기본 두 가지, 본사 소통 칸은 없다', async () => {
    await load({ get: (id) => ok({ ...DETAIL(id), catalog: {} }) });
    await open(A2);
    for (const key of ['equipment', 'staff', 'finishes', 'design']) {
      expect(text(grp(key))).toContain('서버가 항목 목록을 주지 않았습니다.');
    }
    expect(qa('input[data-doc]').map((n) => n.getAttribute('data-doc'))).toEqual([
      'insurance',
      'contract',
    ]);
    expect(grp('hq_comm')).toBeNull();
  });

  test('메모 · 회사 이름은 글자 그대로 그린다', async () => {
    const d = DETAIL(A1);
    d.evaluation.note = '</textarea><img src=x>';
    d.evaluation.finishes.door[1].name = '"><img src=x>';
    await load({ get: () => ok(d) });
    await open(A1);
    expect(q('img')).toBeNull();
    expect($('peNote').value).toBe('</textarea><img src=x>');
    expect(qa('[data-sup-group="door"] [data-sup-name]')[1].value).toBe('"><img src=x>');
  });

  test('평가표를 못 읽으면 — 서버 글을 적고 「‹ 팩토리 평가」로 돌아간다', async () => {
    await load({ get: () => fail(404, 'not_found', '팩토리를 찾을 수 없습니다') });
    await open(A1);
    expect(text(part('failed'))).toBe('팩토리를 찾을 수 없습니다');
    expect(part('form')).toBeNull();
    await press(act('back'));
    expect(qa('button[data-co]').length).toBe(2);
  });

  test('「‹ 팩토리 평가」 — 고치지 않았으면 묻지 않고 목록으로', async () => {
    const calls = await load();
    await open(A1);
    await press(act('back'));
    expect(qa('button[data-co]').length).toBe(2);
    expect(part('form')).toBeNull();
    expect(asked(calls).length).toBe(2); // 목록을 다시 읽지 않는다
  });
});

describe('칸 고치기', () => {
  test('회사 더하기 · 빼기 — 한도(catalog limits.supplier_rows)를 넘으면 글만', async () => {
    await load();
    await open(A1);
    const add = q('[data-act="sup-add"][data-key="door"]');
    await press(add);
    expect(qa('[data-sup-group="door"] [data-sup-row]').length).toBe(3);
    expect(part('err').hidden).toBe(true);
    await press(add);
    expect(qa('[data-sup-group="door"] [data-sup-row]').length).toBe(3);
    expect(text(part('err'))).toBe('도어: 회사는 3곳까지 넣을 수 있습니다.');
    await press(q('[data-sup-group="door"] [data-act="sup-del"]'));
    expect(qa('[data-sup-group="door"] [data-sup-row]').length).toBe(2);
  });

  test('「직접 적기」를 고르면 이름 칸이 나온다 (글자 수는 catalog limits.supplier_name)', async () => {
    await load();
    await open(A2);
    const row = q('[data-sup-group="door"] [data-sup-row]');
    const name = row.querySelector('[data-sup-name]');
    expect(name.hidden).toBe(true);
    expect(name.getAttribute('maxlength')).toBe('40');
    change(row.querySelector('select'), 'custom');
    expect(name.hidden).toBe(false);
    change(row.querySelector('select'), 'key:ex_a');
    expect(name.hidden).toBe(true);
  });

  test('서류 — 확인을 켜면 빈 날짜에 오늘, 날짜를 넣으면 확인이 켜진다', async () => {
    await load();
    await open(A2);
    const P = window.SeganPartnerEval;
    const todayText = P.docDay(new Date(NOW).toISOString());
    tick(q('input[data-doc="insurance"]'));
    expect(q('input[data-doc-date="insurance"]').value).toBe(todayText);
    change(q('input[data-doc-date="contract"]'), '2026-11-01');
    expect(q('input[data-doc="contract"]').checked).toBe(true);
  });
});

describe('저장', () => {
  test('고친 칸을 PUT 으로 보내고(등급은 싣지 않는다), 목록 · 평가표를 다시 읽는다', async () => {
    const calls = await load();
    await open(A1);
    q('input[name="pe-eq-1"][value="outsource"]').checked = true;
    typeIn(q('input[data-staff="assembly"]'), '3');
    tick(q('input[data-staff-ded="assembly"]'));
    tick(q('input[data-design="sketchup"]'));
    typeIn($('peNote'), '  고친 메모  ');
    await press(act('save'));
    const put = puts(calls);
    expect(put.length).toBe(1);
    expect(put[0].url).toBe(WORK + EVAL_PATH(A1));
    expect(put[0].auth).toBe('Bearer tok-1');
    expect(put[0].type).toBe('application/json');
    expect(put[0].body).toEqual({
      equipment: { table_saw: 'have', boring: 'outsource' },
      staff: { design: 2, assembly: 3, total: 5, dedicated: ['design', 'assembly'] },
      finishes: {
        door: [
          { key: 'ex_a', main: true },
          { name: '예시 공방', main: false },
        ],
        notes: { door: '무광 위주' },
      },
      design: { cad: true, sketchup: true },
      hq_comm: { score: 8 },
      price_tier: 'mid',
      // 날짜를 그대로 두면 확인한 사람까지 그대로 보낸다
      docs: { insurance: { checked_at: '2026-10-20', checked_by: 'user-9' } },
      as_months: 24,
      warranty_months: 12,
      note: '고친 메모',
    });
    expect(put[0].body).not.toHaveProperty('grade');
    expect(asked(calls).slice(2)).toEqual([
      'PUT ' + EVAL_PATH(A1),
      'GET /admin/companies?pool=1',
      'GET ' + EVAL_PATH(A1),
    ]);
    expect(text(part('msg'))).toBe('저장했습니다.');
    expect(part('err').hidden).toBe(true);
    expect(act('save').disabled).toBe(false);
  });

  test('빈 평가표 — 고른 것만 보낸다. 서류 날짜를 바꾸면 날짜만 보낸다', async () => {
    const calls = await load();
    await open(A2);
    q('input[name="pe-price"][value="basic"]').checked = true;
    change(q('input[data-doc-date="insurance"]'), '2026-11-05');
    const row = q('[data-sup-group="door"] [data-sup-row]');
    change(row.querySelector('select'), 'custom');
    row.querySelector('[data-sup-name]').value = '   '; // 이름을 안 적은 직접 적기는 보내지 않는다
    await press(act('save'));
    expect(puts(calls)[0].body).toEqual({
      equipment: {},
      staff: {},
      finishes: {},
      design: { cad: false, sketchup: false },
      hq_comm: {},
      price_tier: 'basic',
      docs: { insurance: { checked_at: '2026-11-05' } },
      as_months: null,
      warranty_months: null,
      note: null,
    });
  });

  test('틀린 칸 — 보내지 않고 까닭을 적는다 (정수 · 전담 인원 · 전담 수 · 같은 회사 · 본사 소통 한도)', async () => {
    const calls = await load();
    await open(A1);
    const errOf = async () => {
      await press(act('save'));
      return text(part('err'));
    };
    typeIn($('peAsMonths'), '1.5');
    expect(await errOf()).toBe('A/S 기간: 0 이상의 정수로 넣어 주세요.');
    typeIn($('peAsMonths'), '24');
    tick(q('input[data-staff-ded="assembly"]'));
    typeIn(q('input[data-staff="assembly"]'), '');
    expect(await errOf()).toBe('인력 조립: 전담이면 인원을 1명 이상 넣어 주세요.');
    typeIn(q('input[data-staff="assembly"]'), '1');
    typeIn(q('input[data-staff-total="total"]'), '1');
    expect(await errOf()).toBe('인력: 전담 직무(2개)가 전체 인원(1명)보다 많습니다.');
    typeIn(q('input[data-staff-total="total"]'), '5');
    await press(q('[data-act="sup-add"][data-key="door"]'));
    change(qa('[data-sup-group="door"] select')[2], 'key:ex_a');
    expect(await errOf()).toBe('도어: 같은 회사를 두 번 넣었습니다.');
    await press(qa('[data-sup-group="door"] [data-act="sup-del"]')[2]);
    typeIn($('peHqComm'), '11');
    expect(await errOf()).toBe('본사 소통: 0~10점으로 넣어 주세요.');
    expect(puts(calls).length).toBe(0);
    typeIn($('peHqComm'), '10');
    await press(act('save'));
    expect(puts(calls).length).toBe(1);
  });

  test('서버가 막으면 — 서버 글을 적고 적던 것은 그대로 둔다', async () => {
    const calls = await load({
      put: () => fail(422, 'invalid', '목록에 없는 항목입니다: equipment.x'),
    });
    await open(A1);
    typeIn($('peNote'), '적던 글');
    await press(act('save'));
    expect(text(part('err'))).toBe('목록에 없는 항목입니다: equipment.x');
    expect(text(part('msg'))).toBe('');
    expect($('peNote').value).toBe('적던 글');
    expect(act('save').disabled).toBe(false);
    expect(asked(calls).slice(2)).toEqual(['PUT ' + EVAL_PATH(A1)]); // 다시 읽지 않는다
  });

  test('끊기거나 글 없는 오류 — 기본 글', async () => {
    await load({ put: () => new Error('offline') });
    await open(A1);
    await press(act('save'));
    expect(text(part('err'))).toBe('처리하지 못했습니다. 잠시 뒤 다시 해 주세요.');
  });

  test('저장한 뒤 평가표를 다시 못 읽으면 — 적은 칸은 그대로 두고 저장했다고 적는다', async () => {
    await load({ get: (id, n) => (n === 1 ? ok(DETAIL(id)) : fail(500, 'x', '')) });
    await open(A1);
    typeIn($('peNote'), '새 메모');
    await press(act('save'));
    expect(text(part('msg'))).toBe('저장했습니다.');
    expect($('peNote').value).toBe('새 메모');
    expect(act('save').disabled).toBe(false);
    // 저장했으니 묻지 않고 목록으로 간다
    await press(act('back'));
    expect(qa('button[data-co]').length).toBe(2);
  });

  test('보내는 동안 — 단추를 잠그고 다시 눌러도 한 번만 보낸다', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const calls = await load({ gate });
    await open(A1);
    await press(act('save'));
    expect(act('save').disabled).toBe(true);
    expect(box().getAttribute('aria-busy')).toBe('true');
    expect(text(part('msg'))).toBe('저장하는 중…');
    await press(act('save'));
    await press(act('back')); // 보내는 동안에는 나가지 않는다
    expect(part('form')).not.toBeNull();
    release();
    await flush();
    await flush();
    expect(puts(calls).length).toBe(1);
    expect(box().hasAttribute('aria-busy')).toBe(false);
    expect(text(part('msg'))).toBe('저장했습니다.');
  });
});

describe('저장하지 않고 나가기', () => {
  test('고친 뒤 「‹ 팩토리 평가」 — 그 자리에서 묻는다. 「계속 고치기」는 그대로 둔다', async () => {
    await load();
    await open(A1);
    expect(part('ask').hidden).toBe(true);
    typeIn($('peNote'), '고치는 중');
    await press(act('back'));
    expect(part('ask').hidden).toBe(false);
    expect(text(part('ask').querySelector('span'))).toBe('저장하지 않은 내용이 있습니다.');
    expect([...part('ask').querySelectorAll('button')].map(text)).toEqual([
      '버리고 나가기',
      '계속 고치기',
    ]);
    expect(part('form')).not.toBeNull();
    await press(act('keep'));
    expect(part('ask').hidden).toBe(true);
    expect($('peNote').value).toBe('고치는 중');
  });

  test('「버리고 나가기」 — 보내지 않고 목록으로. 다시 열면 서버 값', async () => {
    const calls = await load();
    await open(A1);
    tick(q('input[data-design="sketchup"]'));
    await press(act('back'));
    await press(act('discard'));
    expect(qa('button[data-co]').length).toBe(2);
    expect(puts(calls).length).toBe(0);
    await open(A1);
    expect(q('input[data-design="sketchup"]').checked).toBe(false);
    expect(part('ask').hidden).toBe(true);
  });

  test('회사 줄을 더하거나 빼기만 해도 묻는다', async () => {
    await load();
    await open(A1);
    await press(q('[data-sup-group="door"] [data-act="sup-del"]'));
    await press(act('back'));
    expect(part('ask').hidden).toBe(false);
  });
});

describe('관리자 PC 화면 줄', () => {
  test('목록을 못 읽은 관리자 — 앱 화면은 감추고 PC 화면 줄이 남는다', async () => {
    await load({ list: () => fail(404, 'not_found', 'Not found') });
    expect(seen('partnerEval')).toBe(false);
    expect(menu('partner-eval').hidden).toBe(true);
    expect(menu('hq-eval').hidden).toBe(false);
  });

  test('관리자가 아니면 — 두 줄 다 없다', async () => {
    await load({ isAdmin: false });
    expect(menu('partner-eval').hidden).toBe(true);
    expect(menu('hq-eval').hidden).toBe(true);
  });
});

describe('안 보이는 때', () => {
  test('관리자가 아닌 사람(본사 구성원 · 업체 없는 사람) · 로그인하지 않은 사람 — 묻지 않는다', async () => {
    for (const o of [{ isAdmin: false }, { isAdmin: false, partner: NOBODY }, { session: null }]) {
      const calls = await load(o);
      expect(asked(calls)).toEqual([]);
      expect(seen('partnerEval')).toBe(false);
      expect(box().innerHTML).toBe('');
    }
  }, 20000);

  test('목록을 못 읽으면(403 · 오류 · 끊김 · 목록 없는 답) — 칸째 감춘다', async () => {
    for (const list of [
      () => fail(403, 'forbidden', '관리자만 볼 수 있습니다'),
      () => ({ ok: false, status: 500, body: {} }),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
      () => ok(null),
    ]) {
      const calls = await load({ list });
      expect(asked(calls)).toEqual(['GET /admin/companies?pool=1']);
      expect(seen('partnerEval')).toBe(false);
      expect($('partnerEval').hidden).toBe(true);
      expect(box().innerHTML).toBe('');
      expect(menu('partner-eval').hidden).toBe(true);
    }
  }, 20000);

  test('워커 주소가 없으면 묻지 않는다', async () => {
    const calls = await load({ work: '' });
    expect(asked(calls)).toEqual([]);
    expect(seen('partnerEval')).toBe(false);
  });
});
