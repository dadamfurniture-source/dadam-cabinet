/**
 * 관리자 「작업 지시 보고」 (admin/work-reports.html, docs/01-plan/work-reports-archive.plan.md §5).
 * 페이지 스크립트를 jsdom 에 그대로 올리고 workflow-api 는 가짜 fetch 로 대신한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin/work-reports.html'), 'utf8');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n      (function'));
const API = 'https://api.test';
const R1 = '66666666-6666-4666-8666-666666666666';
const P1 = '33333333-3333-4333-8333-333333333333';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 15; i++) await flush(); }

const PLAN_ROW = {
  id: R1, owner_id: 'u1', kind: 'production_plan', title: '생산 계획 — <img src=x onerror=alert(1)>', status: 'pending', source_id: P1,
  period_start: '2026-10-19', period_end: '2026-10-21', created_at: '2026-10-18T23:00:00Z', pinned: true,
  metrics: { jobs: 3, lateBefore: 2, lateAfter: 0, extraCost: 220000, suggestions: 2 },
};
const PLAN_FULL = {
  ...PLAN_ROW, can_edit: true, note: '', live: null,
  body: { plan: {
    summary: { jobs: 3, lateBefore: 2, lateAfter: 0, extraCost: 220000 },
    suggestions: [{ type: 'asm_extra', text: '10/21 조립 일당 +1', cost: 200000 }],
    days: [{ date: '2026-10-19', cut: { load: 3600, cap: 28800 }, edge: { load: 30000, cap: 28800 }, asm: { load: 0, cap: 28800, people: 0 } }],
    jobs: [{ label: '김OO', due: '2026-10-23', finish: '2026-10-21', late: false }],
  } },
};
const WO_FULL = {
  id: 'w1', owner_id: 'u2', kind: 'work_order', title: '작업지시서 DD-1-WO-r2 — 김OO', status: 'issued', can_edit: false,
  created_at: '2026-10-18T05:00:00Z', metrics: { rev: 2, sheets: 6, labels: 38 },
  body: { document_id: 'doc-1', doc_no: 'DD-1-WO-r2', rev: 2 },
};

function fakeApi({ admin = true } = {}) {
  const calls = [];
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ success: true, data }), text: async () => '<html>print</html>' });
  const fetchFn = jest.fn(async (url, init = {}) => {
    const u = String(url).replace(API, '');
    const method = init.method || 'GET';
    calls.push({ u, method, body: init.body ? JSON.parse(init.body) : null });
    if (u.startsWith('/reports/summary')) return ok({ weekAssignments: 14, pendingProposals: 1, lateOrders: 2, lateAsOf: '2026-10-19', monthExtraCost: 600000, scope: 'all' });
    if (u.startsWith('/reports?')) return ok({ items: [PLAN_ROW, { ...WO_FULL, body: undefined }], page: 1, hasMore: false, scope: 'all' });
    if (u === `/reports/${R1}` && method === 'GET') return ok(PLAN_FULL);
    if (u === '/reports/w1' && method === 'GET') return ok(WO_FULL);
    if (u === `/reports/${R1}` && method === 'PATCH') return ok({ ...PLAN_FULL, ...JSON.parse(init.body) });
    if (u === '/reports' && method === 'POST') return ok({ id: 'n1' });
    if (u.includes('/print')) return ok(null);
    return { ok: false, status: 404, json: async () => ({ success: false, message: 'nope' }) };
  });
  return { fetchFn, calls, admin };
}

function boot(api) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb', anonKey: 'k' }, workflowApi: { url: API } };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'T', user: { email: 'a@b.c' } } } }) } }) };
  window.AdminAccess = { isAdmin: async () => api.admin };
  window.__WORK_REPORTS_NO_AUTOSTART = true;
  global.fetch = api.fetchFn;
  window.open = jest.fn(() => ({ document: { write: jest.fn(), open: jest.fn(), close: jest.fn() }, close: jest.fn() }));
  window.confirm = jest.fn(() => true);
  (0, eval)(SCRIPT);
}

describe('관리자 사이드바', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'admin')).filter((f) => f.endsWith('.html'));
  test.each(pages)('%s — 「작업 지시 보고」 1개 · 「시공사례 관리」 1개', (f) => {
    const html = fs.readFileSync(path.join(ROOT, 'admin', f), 'utf8');
    const menu = html.slice(html.indexOf('<ul class="nav-menu">'), html.indexOf('</ul>', html.indexOf('<ul class="nav-menu">')));
    expect(menu.split('href="work-reports.html"').length - 1).toBe(1);
    expect(menu.split('href="gallery.html"').length - 1).toBe(1);
    // 활동 로그 바로 앞
    expect(menu.indexOf('href="work-reports.html"')).toBeLessThan(menu.indexOf('href="logs.html"'));
  });

  test('새 페이지는 정본 게이트(AdminAccess)를 쓴다 — 하드코딩 이메일 없음', () => {
    expect(HTML).toMatch(/<script src="\.\.\/js\/admin-access\.js"><\/script>/);
    expect(HTML).toMatch(/window\.AdminAccess\.isAdmin\(state\.sb\)/);
    expect(HTML).not.toMatch(/ADMIN_EMAILS/);
  });
});

describe('작업 지시 보고 화면', () => {
  test('관리자가 아니면 접근 거부', async () => {
    const api = fakeApi({ admin: false });
    boot(api);
    await window.WorkReports.init();
    expect(document.getElementById('accessDenied').style.display).toBe('block');
    expect(api.calls).toHaveLength(0);
  });

  test('숫자 4칸 · 목록(이스케이프 · 고정 · 상태) · 종류 탭은 kind 로 다시 부른다', async () => {
    const api = fakeApi();
    boot(api);
    await window.WorkReports.init();
    await settle();
    expect(document.getElementById('kpiWeek').textContent).toBe('14');
    expect(document.getElementById('kpiPending').textContent).toBe('1');
    expect(document.getElementById('kpiLateLabel').textContent).toBe('지연 예상 주문 (10/19(월) 아침)');
    expect(document.getElementById('kpiCost').textContent).toBe('60만');
    const list = document.getElementById('reportList');
    expect(list.querySelectorAll('.report-row')).toHaveLength(2);
    expect(list.innerHTML).not.toMatch(/<img/);
    expect(list.textContent).toMatch(/<img src=x onerror=alert\(1\)>/);
    expect(list.textContent).toMatch(/📌/);
    expect(list.textContent).toMatch(/주문 3 · 지연 2→0 · 추가 22만 · 추천 2/);
    expect(list.querySelector('.badge.pending').textContent).toBe('결정 전');
    const first = api.calls.find((c) => c.u.startsWith('/reports?'));
    expect(first.u).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&page=1/);
    document.querySelector('.tab[data-kind="daily_brief"]').click();
    await settle();
    expect(api.calls.filter((c) => c.u.startsWith('/reports?')).pop().u).toMatch(/^\/reports\?kind=daily_brief&/);
  });

  test('생산 계획 상세 — 추천 · 부하 · 승인 링크 · 메모 저장은 note 만 PATCH', async () => {
    const api = fakeApi();
    boot(api);
    await window.WorkReports.init();
    await settle();
    document.querySelector(`.report-row[data-id="${R1}"]`).click();
    await settle();
    const body = document.getElementById('detailBody');
    expect(document.getElementById('detailModal').classList.contains('active')).toBe(true);
    expect(body.textContent).toMatch(/10\/21 조립 일당 \+1/);
    expect(body.querySelectorAll('.bar i.over')).toHaveLength(1);
    expect(body.querySelector('a[href^="../production.html?p="]').getAttribute('href')).toBe(`../production.html?p=${P1}`);
    document.getElementById('detailNote').value = '대표 확인 완료';
    document.getElementById('btnSaveNote').click();
    await settle();
    const patch = api.calls.find((c) => c.method === 'PATCH');
    expect(patch.u).toBe(`/reports/${R1}`);
    expect(patch.body).toEqual({ note: '대표 확인 완료' });
    document.getElementById('btnPrint').click();
    expect(window.open).toHaveBeenCalledTimes(1);
    await settle();
    expect(api.calls.some((c) => c.u === `/reports/${R1}/print`)).toBe(true);
  });

  test('작업지시서 상세 — 꾸러미 인쇄는 문서 인쇄 경로, 읽기 전용이면 메모·고정·보관이 잠긴다', async () => {
    const api = fakeApi();
    boot(api);
    await window.WorkReports.init();
    await settle();
    document.querySelector('.report-row[data-id="w1"]').click();
    await settle();
    expect(document.getElementById('btnSaveNote').disabled).toBe(true);
    expect(document.getElementById('btnArchive').disabled).toBe(true);
    expect(document.getElementById('btnPrint').style.display).toBe('none');
    const packs = [...document.querySelectorAll('[data-doc-print]')].map((b) => b.getAttribute('data-pack'));
    expect(packs).toEqual(['cut', 'cut-vendor', 'assembly', 'door', 'labels', 'all']);
    document.querySelector('[data-pack="door"]').click();
    await settle();
    expect(api.calls.some((c) => c.u === '/documents/doc-1/print?pack=door')).toBe(true);
  });

  test('메모 보고 추가 — 제목이 없으면 막고, 있으면 POST /reports', async () => {
    const api = fakeApi();
    boot(api);
    await window.WorkReports.init();
    await settle();
    document.getElementById('btnNewNote').click();
    document.getElementById('btnCreateNote').click();
    await settle();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
    document.getElementById('newNoteTitle').value = '10월 외주 단가 협의';
    document.getElementById('newNoteBody').value = '일성합판 장당 12,000';
    document.getElementById('btnCreateNote').click();
    await settle();
    expect(api.calls.find((c) => c.method === 'POST').body).toEqual({ title: '10월 외주 단가 협의', note: '일성합판 장당 12,000' });
  });
});

describe('?order= — ERP 수주 상세에서 넘어온 경우', () => {
  const O1 = '44444444-4444-4444-8444-444444444444';
  afterEach(() => window.history.replaceState(null, '', '/'));

  test('그 주문의 보고만, 기간 제한 없이 · ✕ 로 해제하면 기본 30일로', async () => {
    window.history.replaceState(null, '', `/admin/work-reports.html?order=${O1}`);
    const api = fakeApi();
    boot(api);
    await window.WorkReports.init();
    await settle();
    const first = api.calls.find((c) => c.u.startsWith('/reports?')).u;
    expect(first).toContain(`order=${O1}`);
    expect(first).not.toContain('from=');
    expect(document.getElementById('orderChip').hidden).toBe(false);

    document.getElementById('btnClearOrder').click();
    await settle();
    const last = api.calls.filter((c) => c.u.startsWith('/reports?')).pop().u;
    expect(last).not.toContain('order=');
    expect(last).toContain('from=');
    expect(document.getElementById('orderChip').hidden).toBe(true);
  });

  test('uuid 가 아니면 무시', async () => {
    window.history.replaceState(null, '', '/admin/work-reports.html?order=1;drop');
    const api = fakeApi();
    boot(api);
    await window.WorkReports.init();
    await settle();
    expect(api.calls.find((c) => c.u.startsWith('/reports?')).u).not.toContain('order=');
  });
});

describe('ERP · 생산 계획 화면 → 보관함 연결', () => {
  test('erp.html 수주 상세에 ?order= 링크', () => {
    const html = fs.readFileSync(path.join(ROOT, 'erp.html'), 'utf8');
    expect(html).toContain('id="lnkReports"');
    expect(html).toContain("'admin/work-reports.html?order=' + encodeURIComponent(d.order.id)");
  });
  test('production.html 지난 제안 카드 + 보관함 링크', () => {
    const html = fs.readFileSync(path.join(ROOT, 'production.html'), 'utf8');
    expect(html).toContain('id="histRows"');
    expect(html).toContain("'/production/proposals?from='");
    expect(html.split('href="admin/work-reports.html"').length - 1).toBeGreaterThanOrEqual(2);
  });
});
