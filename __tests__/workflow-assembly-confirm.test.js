/**
 * 결정 D8 (2026-10-20): 조립 검사에 오류가 있으면 작업지시서 발행 전에 확인창을 띄우고, 확인을 눌러야 발행한다.
 *   workflow-client.js 의 동결 흐름이 조립 명세(DadamAssembly.of)를 BomPreflight.check 에 넘기는지,
 *   확인창에서 취소하면 (앞서 동결한 스냅샷이 있어도) 작업지시서를 발행하지 않는지 본다.
 *   합성 데이터만 쓴다 — 검사기·명세는 가짜로 바꿔 끼운다.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'workflow-client.js'), 'utf8');

const SPEC = { schema: 'dadam.assembly/1', items: [], unplaced: [] };
const MATERIALS = [{ partId: 'p1', moduleKey: '0-m1', part: '측판', qty: 2 }];

function flush() {
  return new Promise((r) => setTimeout(r, 0));
}

function setup() {
  document.body.innerHTML = '<div id="workflowPanel"></div><div id="workOrderPanel"></div>';
  window.DADAM_CONFIG = { workflowApi: { url: 'https://wf.test' } };
  window.history.replaceState(null, '', '/detaildesign.html?id=design-1');
  window._reportData = {
    design: { items: [{ modules: [] }] },
    materials: { materials: MATERIALS },
    hardware: [],
  };
  window.SupabaseUtils = {
    client: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
  };
  global.SupabaseUtils = window.SupabaseUtils;

  const posts = [];
  window.fetch = global.fetch = jest.fn(async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    if (method === 'POST') posts.push(String(url));
    let data = { items: [] };
    if (/\/snapshots$/.test(url)) data = { snapshot_id: 'snap-' + posts.length, rev: posts.length, reused: false };
    if (/\/documents$/.test(url) && method === 'POST') data = { doc_no: 'WO-1' };
    if (/site-info$/.test(url)) data = null;
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  });

  const calls = [];
  let result = { ok: true, counts: { error: 0, warning: 0, info: 0 }, issues: [] };
  window.BomPreflight = {
    check: jest.fn((materials, hardware, opts) => {
      calls.push(opts);
      return result;
    }),
    summaryOf: (r) => '오류 ' + r.counts.error + '건',
  };
  window.DadamAssembly = { of: jest.fn(() => SPEC) };
  window.confirm = jest.fn(() => false);
  window.prompt = jest.fn(() => '시험 사유');

  // eslint-disable-next-line no-new-func
  new Function(SRC)();
  return {
    posts,
    calls,
    fail() {
      result = {
        ok: false,
        counts: { error: 1, warning: 0, info: 0 },
        issues: [{ level: 'error', code: 'part-overlap', message: '판재가 겹칩니다' }],
      };
    },
  };
}

async function click(id) {
  document.getElementById(id).click();
  for (let i = 0; i < 10; i++) await flush();
}

describe('workflow-client — 조립 검사를 발행 확인창에 잇는다 (D8)', () => {
  test('동결할 때 조립 명세를 BomPreflight.check 의 opts.assembly 로 넘긴다', async () => {
    const t = setup();
    await flush();
    await click('wfSnapshot');
    expect(window.DadamAssembly.of).toHaveBeenCalledWith(window._reportData.design, { materials: MATERIALS });
    expect(t.calls[0].assembly).toBe(SPEC);
    expect(t.posts.some((u) => /\/snapshots$/.test(u))).toBe(true);
  });

  test('조립 명세가 없으면(옛 캐시) assembly 없이 검사한다', async () => {
    const t = setup();
    delete window.DadamAssembly;
    await flush();
    await click('wfSnapshot');
    expect(t.calls[0].assembly).toBeNull();
  });

  test('검사 오류 확인창에서 취소하면, 앞서 동결한 스냅샷이 있어도 작업지시서를 발행하지 않는다', async () => {
    const t = setup();
    await flush();
    await click('wfSnapshot'); // rev 1 동결 (오류 없음)
    t.fail();
    window.DadamWorkflow.enterStep4();
    for (let i = 0; i < 10; i++) await flush();
    await click('wo4Issue');
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(t.posts.filter((u) => /\/documents$/.test(u))).toEqual([]);
    expect(document.getElementById('wo4Status').textContent).toMatch(/발행하지 않았습니다/);
  });

  test('확인을 누르면 발행한다', async () => {
    const t = setup();
    t.fail();
    window.confirm = jest.fn(() => true);
    await flush();
    window.DadamWorkflow.enterStep4();
    for (let i = 0; i < 10; i++) await flush();
    await click('wo4Issue');
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(t.posts.filter((u) => /\/documents$/.test(u)).length).toBe(1);
  });
});
