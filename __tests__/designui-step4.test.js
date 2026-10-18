/**
 * 4단계 작업지시서 화면 (docs/01-plan/work-order-stage.plan.md §4.1 · §4.2).
 *
 * workflow-client.js 를 jsdom 에 그대로 올리고 워커는 가짜 fetch 로 대신한다.
 *   - [발행] 한 번 = 저장 확인 → 동결 → 제작(+현장 정보 있으면 설치) 발행
 *   - 같은 스냅샷이면 다시 발행하지 않는다
 *   - 고객 승인 전이면 사유를 받아 특기사항(instructions)에 남기고, 취소하면 발행하지 않는다
 *   - 꾸러미 카드 [인쇄] = /documents/:id/print?pack=
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF_SRC = fs.readFileSync(path.join(ROOT, 'js/detaildesign/workflow-client.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');

const API = 'https://api.test';

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

async function settle() {
  for (let i = 0; i < 12; i++) await flush();
}

/** 가짜 워커 — 문서 목록을 기억한다. */
function fakeWorker({ docs = [], site = null, reused = false } = {}) {
  const calls = [];
  let n = 0;
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ success: true, data }), text: async () => '' });
  const fetchFn = jest.fn(async (url, init = {}) => {
    const u = String(url).replace(API, '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, u, body });
    if (method === 'POST' && /\/designs\/D1\/snapshots$/.test(u)) {
      return ok({ snapshot_id: 'S1', rev: 2, reused, item_count: 1, panel_count: 10 });
    }
    if (method === 'GET' && /\/designs\/D1\/documents$/.test(u)) return ok({ items: docs.slice() });
    if (method === 'GET' && /\/schedules$/.test(u)) return ok({ items: [] });
    if (method === 'GET' && /\/site-info$/.test(u)) return ok(site);
    if (method === 'POST' && /\/snapshots\/S1\/documents$/.test(u)) {
      n += 1;
      const code = body.doc_type === 'work_order' ? 'WO' : 'IO';
      const doc = { id: `${code}${n}`, doc_type: body.doc_type, snapshot_id: 'S1', status: 'issued', rev: n, doc_no: `DD-${code}-r${n}`, stale: false };
      docs.unshift(doc);
      return ok({ ...doc, superseded_count: 0 });
    }
    if (method === 'GET' && /\/print/.test(u)) return { ok: true, status: 200, text: async () => '<html>print</html>', json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({ success: false, message: 'nope' }) };
  });
  return { fetchFn, calls, docs };
}

function boot(worker, { designId = 'D1' } = {}) {
  document.body.innerHTML = '<div id="workflowPanel"></div><div id="step4-content"><div id="workOrderPanel"></div></div>';
  window.history.replaceState({}, '', designId ? `/detaildesign.html?id=${designId}` : '/detaildesign.html');
  window.DADAM_CONFIG = { workflowApi: { url: API } };
  global.SupabaseUtils = { client: { auth: { getSession: async () => ({ data: { session: { access_token: 'T' } } }) } } };
  global.fetch = worker.fetchFn;
  window._reportData = { design: { items: [{ uniqueId: 1, modules: [] }] }, materials: { materials: [{ part: '측판', w: 1, h: 1, qty: 1, material: 'PB' }] }, hardware: { hardware: [] } };
  window.NestingEngine = undefined;
  (0, eval)(WF_SRC);
}

const posts = (worker, type) => worker.calls.filter((c) => c.method === 'POST' && /\/documents$/.test(c.u) && (!type || c.body.doc_type === type));

beforeEach(() => {
  jest.restoreAllMocks();
  window.prompt = jest.fn(() => '급한 현장');
  window.open = jest.fn(() => ({ document: { write: jest.fn(), open: jest.fn(), close: jest.fn() }, close: jest.fn() }));
});

describe('화면 배선', () => {
  test('스테퍼 4번 · Step 4 영역 · BOM 아래 [작업지시서 →]', () => {
    expect(HTML).toMatch(/id="step-dot-4"/);
    expect(HTML).toMatch(/<div id="step4-content">/);
    expect(HTML).toMatch(/<div id="workOrderPanel"><\/div>/);
    expect(HTML).toMatch(/onclick="goToStep4\(\)"/);
    expect(HTML).toMatch(/onclick="backToStep3\(\)"/);
  });

  test('다른 단계로 갈 때 Step 4 를 끈다 (설계 수정 · 재산출 · BOM 으로)', () => {
    expect(UI).toMatch(/function goToStep4\(\)/);
    expect(UI).toMatch(/function backToStep3\(\)/);
    for (const fn of ['goToStep2', 'goToStep3', 'backToStep2', 'backToStep3']) {
      const body = UI.slice(UI.indexOf(`function ${fn}()`), UI.indexOf(`function ${fn}()`) + 400);
      expect(body).toMatch(/_hideStep4\(\)/);
    }
    expect(UI).toMatch(/window\.DadamWorkflow\.enterStep4\(\)/);
  });

  test('3단계 패널에는 제작·설치 발행 버튼이 없고 4단계로 가는 버튼이 있다', async () => {
    const w = fakeWorker();
    boot(w);
    await settle();
    const p3 = document.getElementById('workflowPanel').innerHTML;
    expect(p3).not.toMatch(/wfIssueWO|wfIssueIO/);
    expect(p3).toMatch(/id="wfGoStep4"/);
    expect(p3).toMatch(/2\. 고객확인서 발행/);
  });
});

describe('[발행]', () => {
  test('승인 전 — 사유를 받아 동결 → 제작 발행, 꾸러미 카드가 그 문서로 켜진다', async () => {
    const w = fakeWorker();
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    const p4 = () => document.getElementById('workOrderPanel');
    expect(p4().innerHTML).toMatch(/작업지시서 없음/);
    expect(p4().querySelectorAll('[data-wo-print][disabled]').length).toBe(7);

    p4().querySelector('#wo4Issue').click();
    await settle();

    expect(w.calls.some((c) => c.method === 'POST' && c.u === '/designs/D1/snapshots')).toBe(true);
    const wo = posts(w, 'work_order');
    expect(wo).toHaveLength(1);
    expect(wo[0].body.instructions).toBe('고객 승인 전 발행 — 사유: 급한 현장');
    expect(posts(w, 'installation_order')).toHaveLength(0);
    expect(p4().querySelector('#wo4Status').textContent).toMatch(/DD-WO-r1 발행 완료/);
    // 제작 꾸러미 6장이 켜지고, 설치 카드는 현장 정보가 없어 꺼진 채
    const live = [...p4().querySelectorAll('[data-wo-print]')].filter((b) => !b.disabled);
    expect(live.map((b) => b.getAttribute('data-wo-pack'))).toEqual(['cut', 'cut-vendor', 'assembly', 'door', 'labels', 'all']);
    expect(live.every((b) => b.getAttribute('data-wo-print') === 'WO1')).toBe(true);
  });

  test('같은 스냅샷이면 다시 눌러도 새로 발행하지 않는다', async () => {
    const w = fakeWorker({ reused: true });
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    const p4 = () => document.getElementById('workOrderPanel');
    p4().querySelector('#wo4Issue').click();
    await settle();
    p4().querySelector('#wo4Issue').click();
    await settle();
    expect(posts(w, 'work_order')).toHaveLength(1);
    expect(p4().querySelector('#wo4Status').textContent).toMatch(/기존 작업지시서를 씁니다/);
    expect(p4().querySelector('#wo4Issue').textContent).toBe('작업지시서 다시 확인');
  });

  test('사유를 비우거나 취소하면 발행하지 않는다', async () => {
    const w = fakeWorker();
    boot(w);
    window.prompt = jest.fn(() => null);
    await window.DadamWorkflow.enterStep4();
    await settle();
    document.querySelector('#wo4Issue').click();
    await settle();
    expect(posts(w)).toHaveLength(0);
    expect(document.querySelector('#wo4Status').textContent).toMatch(/발행하지 않았습니다/);
  });

  test('고객이 승인했으면 사유를 묻지 않고, 현장 정보가 있으면 설치 지시서도 함께', async () => {
    const w = fakeWorker({
      docs: [{ id: 'CC1', doc_type: 'customer_confirmation', decision: 'approved', status: 'approved', snapshot_id: 'S0', rev: 1, doc_no: 'DD-CC-r1' }],
      site: { address: '서울시 어딘가', floor: '12층' },
    });
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    document.querySelector('#wo4Issue').click();
    await settle();
    expect(window.prompt).not.toHaveBeenCalled();
    const wo = posts(w, 'work_order');
    expect(wo).toHaveLength(1);
    expect(wo[0].body.instructions).toBeUndefined();
    expect(posts(w, 'installation_order')).toHaveLength(1);
    const io = document.querySelector('[data-wo-print="IO2"]');
    expect(io).not.toBeNull();
    expect(io.disabled).toBe(false);
  });

  test('설계가 저장 전이면 저장부터 — 취소하면 멈춘다', async () => {
    const w = fakeWorker();
    boot(w, { designId: null });
    window.saveDesign = jest.fn(async () => {});
    await window.DadamWorkflow.enterStep4();
    await settle();
    expect(document.querySelector('#workOrderPanel').innerHTML).toMatch(/설계 저장 전/);
    document.querySelector('#wo4Issue').click();
    await settle();
    expect(window.saveDesign).toHaveBeenCalled();
    expect(w.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(document.querySelector('#workflowPanel #wfStatus').textContent).toMatch(/저장이 취소되어/);
  });
});

describe('꾸러미 인쇄', () => {
  test('카드의 [인쇄] 는 그 꾸러미 주소로 열고, 창은 클릭 직후에 연다', async () => {
    const w = fakeWorker({ docs: [{ id: 'WO9', doc_type: 'work_order', snapshot_id: 'S1', status: 'issued', rev: 3, doc_no: 'DD-WO-r3', stale: false }] });
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    const btn = document.querySelector('[data-wo-pack="cut"]');
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(window.open).toHaveBeenCalledTimes(1); // await 전에 열었다 — 팝업 차단 회피
    await settle();
    const print = w.calls.find((c) => /\/print/.test(c.u));
    expect(print.u).toBe('/documents/WO9/print?pack=cut');
    // 이력 표의 인쇄는 꾸러미 없이 문서 전체
    document.querySelector('#workOrderPanel [data-wf-print="WO9"]').click();
    await settle();
    expect(w.calls.filter((c) => /\/print/.test(c.u)).pop().u).toBe('/documents/WO9/print');
  });

  test('설계가 바뀐(stale) 지시서는 칩으로 알리고 버튼이 새 발행을 권한다', async () => {
    const w = fakeWorker({ docs: [{ id: 'WO9', doc_type: 'work_order', snapshot_id: 'S0', snapshot_rev: 7, status: 'issued', rev: 3, doc_no: 'DD-WO-r3', stale: true }] });
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    const html = document.querySelector('#workOrderPanel').innerHTML;
    expect(html).toMatch(/작업지시서 r3 · 설계 변경됨/);
    expect(html).toMatch(/동결 rev 7/);
    expect(html).toMatch(/그 뒤로 설계가 바뀌었습니다/);
    expect(document.querySelector('#wo4Issue').textContent).toBe('설계 변경 반영해 새로 발행');
  });
});

describe('[발주 처리] — 외주 발주 내역 (work-reports-archive.plan.md §2.1)', () => {
  const WO = { id: 'WO1', doc_type: 'work_order', snapshot_id: 'S1', status: 'issued', rev: 1, doc_no: 'DD-WO-r1', stale: false };

  /** fakeWorker 위에 외주 발주 경로를 얹는다. conflictOnce: 첫 POST 를 409 로 */
  function withOutsource(w, { items = [], conflictOnce = false } = {}) {
    const inner = w.fetchFn;
    let conflicted = false;
    const ok = (data, status = 200) => ({ ok: true, status, json: async () => ({ success: true, data }) });
    w.fetchFn = jest.fn(async (url, init = {}) => {
      const u = String(url).replace(API, '');
      const method = init.method || 'GET';
      if (/\/documents\/WO1\/outsource-orders$/.test(u)) {
        const body = init.body ? JSON.parse(init.body) : null;
        w.calls.push({ method, u, body });
        if (method === 'GET') return ok({ items: items.slice() });
        if (conflictOnce && !conflicted) {
          conflicted = true;
          return { ok: false, status: 409, json: async () => ({ success: false, message: '이미 발주 처리했습니다 — 2026-10-17 상일 (발주).' }) };
        }
        items.unshift({ id: 'R' + items.length, pack: body.pack, vendor: body.vendor || '상일', status: 'ordered', ordered_on: '2026-10-19', expected_on: body.expected_on || '2026-10-22', qty: '도어 4짝' });
        return ok({ id: 'new' }, 201);
      }
      return inner(url, init);
    });
    return w;
  }
  const p4 = () => document.getElementById('workOrderPanel');
  const orderPosts = (w) => w.calls.filter((c) => c.method === 'POST' && /outsource-orders$/.test(c.u));

  test('도어재 · 재단 의뢰 카드에만 [발주 처리], 지난 발주 상태가 보인다', async () => {
    const w = withOutsource(fakeWorker({ docs: [WO] }), { items: [{ id: 'R0', pack: 'door', vendor: '상일', status: 'ordered', ordered_on: '2026-10-17', expected_on: '2026-10-22', qty: '도어 4짝' }] });
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    const btns = [...p4().querySelectorAll('[data-wo-order]')].map((b) => b.getAttribute('data-wo-order'));
    expect(btns).toEqual(['cut-vendor', 'door']);
    const doorCard = p4().querySelector('[data-wo-order="door"]').closest('.wo4-pack');
    expect(doorCard.textContent).toMatch(/발주함 10\/17 · 상일 · 입고 예정 10\/22/);
    expect(doorCard.textContent).toMatch(/도어 4짝/);
    const cutCard = p4().querySelector('[data-wo-order="cut-vendor"]').closest('.wo4-pack');
    expect(cutCard.textContent).toMatch(/아직 발주 처리 안 함/);
  });

  test('업체 · 입고일을 받아 남기고, 비우면 서버 기본값에 맡긴다 · 취소하면 안 남긴다', async () => {
    const w = withOutsource(fakeWorker({ docs: [WO] }));
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    window.prompt = jest.fn().mockReturnValueOnce(' 우드원 ').mockReturnValueOnce('2026-10-24');
    p4().querySelector('[data-wo-order="door"]').click();
    await settle();
    expect(orderPosts(w)[0].body).toEqual({ pack: 'door', vendor: '우드원', expected_on: '2026-10-24' });
    expect(p4().querySelector('[data-wo-order="door"]').closest('.wo4-pack').textContent).toMatch(/발주함 10\/19 · 우드원/);

    window.prompt = jest.fn().mockReturnValueOnce('').mockReturnValueOnce('');
    p4().querySelector('[data-wo-order="cut-vendor"]').click();
    await settle();
    expect(orderPosts(w)[1].body).toEqual({ pack: 'cut-vendor' });

    window.prompt = jest.fn(() => null);
    p4().querySelector('[data-wo-order="door"]').click();
    await settle();
    expect(orderPosts(w)).toHaveLength(2);
  });

  test('이미 발주된 꾸러미 — 409 를 보여 주고, 확인하면 force 로 한 번 더', async () => {
    const w = withOutsource(fakeWorker({ docs: [WO] }), { conflictOnce: true });
    boot(w);
    await window.DadamWorkflow.enterStep4();
    await settle();
    window.prompt = jest.fn(() => '');
    window.confirm = jest.fn(() => true);
    p4().querySelector('[data-wo-order="door"]').click();
    await settle();
    expect(window.confirm.mock.calls[0][0]).toMatch(/이미 발주 처리했습니다[\s\S]*그래도 다시/);
    expect(orderPosts(w).map((c) => Boolean(c.body.force))).toEqual([false, true]);
  });
});
