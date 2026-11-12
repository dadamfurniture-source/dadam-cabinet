/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Event */
/**
 * SEGAN 「관리 › 작업 보고」 (segan/admin-reports.js + segan/admin.html#reports)
 *
 *   들어오기  오늘 할 일 「결정할 생산 제안」 = #reports
 *   서버      workflow-api GET /reports/summary · GET /reports?kind=&page= · GET /reports/:id · PATCH /reports/:id
 *   화면      숫자 넷 · 종류 고르기 · 보고 줄 · 더 보기 → 누르면 기간 · 요약 · 메모 · 고정 · 보관 · 입고 처리 · 발주 취소
 *             (can_edit 일 때만, 되묻기는 화면 안에서). 이름 · 숫자 요약은 PC admin/work-reports.html 과 같다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'admin-1', email: 'admin@example.com' } };
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const R1 = 'r1111111-1111-4111-8111-111111111111';
const R2 = 'r2222222-2222-4222-8222-222222222222';
const R3 = 'r3333333-3333-4333-8333-333333333333';

const ok = (data) => ({ ok: true, status: 200, body: { success: true, data } });
const fail = (status, message) => ({ ok: false, status, body: { success: false, message } });
const rep = (id, extra = {}) => ({
  id,
  kind: 'production_plan',
  title: '11/2 생산 계획 제안',
  status: 'pending',
  pinned: false,
  archived_at: null,
  created_at: '2026-11-01T23:30:00Z', // 한국 시간 11-02 (월)
  metrics: { jobs: 4, lateBefore: 2, lateAfter: 0, extraCost: 350000, suggestions: 3 },
  note: null,
  ...extra,
});
const LIST = [
  rep(R1, { pinned: true }),
  rep(R2, {
    kind: 'outsource_order',
    title: '도어재 발주 — 가나 도어',
    status: 'ordered',
    metrics: { vendor: '가나 도어', qty: '도어 12장', expected: '2026-11-05' },
  }),
];

/** admin.html#reports 를 올린다 */
async function load(options = {}) {
  const opts = {
    hash: '#reports',
    summary: () =>
      ok({
        weekAssignments: 5,
        pendingProposals: 1,
        lateOrders: 2,
        lateAsOf: '2026-11-02',
        monthExtraCost: 1230000,
      }),
    list: (q) =>
      q.get('page') === '2'
        ? ok({
            items: [
              rep(R3, { kind: 'note', title: '메모', status: null, metrics: {}, note: '전화 옴' }),
            ],
            hasMore: false,
          })
        : ok({ items: LIST, hasMore: true }),
    detail: (id) =>
      ok({
        ...LIST.concat([]).find((r) => r.id === id),
        source_id: 'p-1',
        can_edit: true,
        period_start: '2026-11-02',
        period_end: '2026-11-08',
      }),
    patch: (id, body) => ok({ id, ...body }),
    ...options,
  };
  window.history.replaceState(null, '', '/segan/admin.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/admin.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'SeganShell',
    'SeganAdmin',
    'SeganAdminApplications',
    'SeganAdminConsults',
    'SeganAdminReports',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: SESSION } }) },
      rpc: async (name) => ({ data: name === 'is_admin', error: null }),
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.fetch.push({ url, method, body, auth: (init.headers || {}).Authorization });
    const u = new URL(url);
    let r;
    if (u.pathname === '/reports/summary') r = await opts.summary();
    else if (u.pathname === '/reports') r = await opts.list(u.searchParams);
    else if (/^\/reports\/[^/]+$/.test(u.pathname) && method === 'PATCH')
      r = await opts.patch(decodeURIComponent(u.pathname.split('/')[2]), body);
    else if (/^\/reports\/[^/]+$/.test(u.pathname))
      r = await opts.detail(decodeURIComponent(u.pathname.split('/')[2]));
    else if (u.pathname === '/admin/consult-inbox') r = ok({ items: [] });
    else if (url.startsWith(ACC)) r = ok([]);
    else r = fail(404, 'Not found');
    if (r instanceof Error) throw r;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/shell.js',
    'segan/admin-applications.js',
    'segan/admin-consults.js',
    'segan/admin-reports.js',
    'segan/admin.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganAdmin.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const body = () => $('adReportsBody');
const row = (id) => document.querySelector(`[data-report="${id}"]`);
const act = async (sel) => {
  body().querySelector(sel).click();
  await flush();
};
const open = (id) => act(`[data-report="${id}"] [data-act="open"]`);
const listCalls = (calls) => calls.fetch.filter((f) => new URL(f.url).pathname === '/reports');

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('들어오기 · 목록', () => {
  test('오늘 할 일 「결정할 생산 제안」 = #reports', async () => {
    await load({ hash: '' });
    expect(document.querySelector('[data-today="proposals"] a').getAttribute('href')).toBe(
      '#reports'
    );
  });

  test('숫자 넷 · 보고 줄(고정 · 제목 · 날 · 종류 · 요약 · 상태) · 더 보기 · PC 줄', async () => {
    const calls = await load();
    expect($('adReports').hidden).toBe(false);
    expect([...body().querySelectorAll('.ad-kpis div')].map((d) => d.textContent)).toEqual([
      '이번 주 지시5',
      '결정 안 한 제안1',
      '지연 예상 주문2 (11/2(월) 아침)',
      '이번 달 추가 인건비123만',
    ]);
    expect(listCalls(calls).map((f) => new URL(f.url).search)).toEqual(['?page=1']);
    expect(listCalls(calls)[0].auth).toBe('Bearer tok-1');
    const text = (id) => [
      row(id).querySelector('b').textContent,
      row(id).querySelector('small').textContent,
      row(id).querySelector('.ad-status').textContent,
    ];
    expect(text(R1)).toEqual([
      '📌 11/2 생산 계획 제안',
      '11/2(월) · 생산 계획 · 주문 4 · 지연 2→0 · 추가 35만 · 추천 3',
      '결정 전',
    ]);
    expect(text(R2)).toEqual([
      '도어재 발주 — 가나 도어',
      '11/2(월) · 외주 발주 · 가나 도어 · 도어 12장 · 입고 예정 11/5(목)',
      '발주',
    ]);
    await act('[data-act="more"]');
    expect(listCalls(calls).map((f) => new URL(f.url).search)).toEqual(['?page=1', '?page=2']);
    expect(row(R3).querySelector('small').textContent).toBe('11/2(월) · 메모 · 전화 옴');
    expect(body().querySelector('[data-act="more"]')).toBeNull();
    expect(document.querySelector('#adReports .ad-more a').getAttribute('href')).toBe(
      '../admin/work-reports.html'
    );
  });

  test('종류를 고르면 그 종류로 첫 쪽을 다시 읽는다, 비면 · 못 읽으면 안내', async () => {
    const calls = await load({
      list: (q) =>
        q.get('kind') ? ok({ items: [], hasMore: false }) : ok({ items: LIST, hasMore: false }),
    });
    const sel = body().querySelector('select[name="kind"]');
    sel.value = 'outsource_order';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(listCalls(calls).map((f) => new URL(f.url).search)).toEqual([
      '?page=1',
      '?kind=outsource_order&page=1',
    ]);
    expect(body().textContent).toContain('보고가 없습니다.');
    await load({ list: () => fail(500, 'x') });
    expect(body().textContent).toContain('보고를 불러오지 못했습니다.');
  });
});

describe('한 건', () => {
  test('누르면 기간 · 기록 · 상태 · 요약 · 메모 · 단추, 생산 계획 결정 전이면 PC 생산 계획 줄', async () => {
    await load();
    await open(R1);
    const facts = [...row(R1).querySelectorAll('.ad-detail .me-facts div')].map((d) => [
      d.querySelector('dt').textContent,
      d.querySelector('dd').textContent,
    ]);
    expect(facts).toEqual([
      ['기간', '11/2(월) ~ 11/8(일)'],
      ['기록', '2026-11-02'],
      ['상태', '결정 전'],
      ['요약', '주문 4 · 지연 2→0 · 추가 35만 · 추천 3'],
    ]);
    expect(row(R1).querySelector('a[href="../production.html?p=p-1"]').textContent).toBe(
      '생산 계획 화면에서 승인 · 무시 (PC)'
    );
    expect([...row(R1).querySelectorAll('[data-act]')].map((b) => b.textContent).slice(1)).toEqual([
      '메모 저장',
      '고정 해제',
      '보관 처리',
    ]);
    await open(R1);
    expect(row(R1).querySelector('.ad-detail')).toBeNull();
  });

  test('can_edit 이 아니면 읽기만 (단추 · 메모 칸 없이 안내)', async () => {
    await load({ detail: (id) => ok({ ...LIST[0], id, can_edit: false, note: '본사 메모' }) });
    await open(R1);
    expect(row(R1).querySelector('textarea')).toBeNull();
    expect(row(R1).querySelector('[data-act="pin"]')).toBeNull();
    expect(row(R1).textContent).toContain('본사 메모');
    expect(row(R1).textContent).toContain('읽기만 할 수 있습니다 (admin 이상이 바꿉니다)');
  });

  test('메모 저장 · 고정 · 보관 — PATCH 를 보내고 목록을 다시 읽어 알린다', async () => {
    const sent = [];
    const calls = await load({
      patch: (id, b) => {
        sent.push([id, b]);
        return ok({ id, ...b });
      },
    });
    await open(R1);
    row(R1).querySelector('textarea[name="note"]').value = '수요일 확인';
    await act('[data-act="note"]');
    expect(body().querySelector('.me-pt-msg').textContent).toBe('메모를 저장했습니다.');
    await act('[data-act="pin"]');
    await act('[data-act="archive"]');
    expect(sent).toEqual([
      [R1, { note: '수요일 확인' }],
      [R1, { pinned: false }],
      [R1, { archived: true }],
    ]);
    expect(body().querySelector('.me-pt-msg').textContent).toBe(
      '보관 처리했습니다 (목록에서 숨김 — 지우지 않습니다).'
    );
    expect(listCalls(calls)).toHaveLength(4);
  });

  test('외주 발주(발주) — 입고 처리, 발주 취소는 화면 안에서 되묻는다', async () => {
    const sent = [];
    await load({
      patch: (id, b) => {
        sent.push([id, b]);
        return ok({ id, ...b });
      },
    });
    await open(R2);
    expect(row(R2).querySelector('[data-act="received"]')).not.toBeNull();
    await act('[data-act="cancel"]');
    expect(row(R2).querySelector('.ad-panel .mk-note').textContent).toBe(
      '이 외주 발주를 취소로 바꿀까요? (기록은 남습니다)'
    );
    await act('[data-act="cancel-no"]');
    expect(sent).toEqual([]);
    await act('[data-act="received"]');
    expect(sent).toEqual([[R2, { status: 'received' }]]);
    expect(body().querySelector('.me-pt-msg').textContent).toBe('입고 처리했습니다.');
  });

  test('서버가 막으면 서버 글을 그 자리에, 적던 메모는 남는다', async () => {
    await load({ patch: () => fail(403, '관리자(admin 이상)만 바꿀 수 있습니다') });
    await open(R1);
    row(R1).querySelector('textarea[name="note"]').value = '적던 메모';
    await act('[data-act="note"]');
    expect(row(R1).querySelector('[data-err]').textContent).toBe(
      '관리자(admin 이상)만 바꿀 수 있습니다'
    );
    expect(row(R1).querySelector('textarea[name="note"]').value).toBe('적던 메모');
  });
});

describe('이름 · 숫자 요약 = PC 작업 지시 보고', () => {
  test('종류 · 상태 이름이 admin/work-reports.html 과 같다', async () => {
    await load();
    const pc = read('admin/work-reports.html');
    const A = window.SeganAdminReports;
    for (const [k, v] of A.KINDS) expect(pc).toContain(`['${k}', '${v}']`);
    for (const [k, v] of Object.entries(A.STATUS_NAME)) expect(pc).toContain(`${k}: '${v}'`);
    expect(A.dayLabel('2026-11-02')).toBe('11/2(월)');
  });
});
