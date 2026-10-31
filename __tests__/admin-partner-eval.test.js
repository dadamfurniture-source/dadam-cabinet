/**
 * 관리자 「업체 평가」 (admin/partner-eval.html).
 *   업체 풀 GET /admin/companies?pool=1 → 업체를 고르면 GET /admin/companies/:id/evaluation
 *   → 평가표 10묶음(항목 이름은 서버 catalog) → 저장 PUT /admin/companies/:id/evaluation
 * 페이지 스크립트를 jsdom 에 올리고 업무 서버(workflow-api)는 가짜 fetch 로 대신한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs
  .readFileSync(path.join(ROOT, 'admin/partner-eval.html'), 'utf8')
  .split('\r\n')
  .join('\n');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.lastIndexOf('<script>')).replace(
  /<script src="\.\.\/js\/admin-shell\.js(\?v=[\d.]+)?"><\/script>/,
  ''
);
const API = 'https://api.test';
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const POOL = [
  {
    id: 'f1',
    name: '다담 공장',
    kind: 'hq',
    plan: null,
    status: 'active',
    sido: '경기도',
    gugun: '김포시',
    grade: 'A',
    evaluated_at: '2026-10-20T03:00:00Z',
    docs_ok: true,
    settings_ok: true,
  },
  {
    id: 'p1',
    name: '한빛가구',
    kind: 'partner',
    plan: 'agent',
    status: 'active',
    sido: '서울특별시',
    gugun: '강남구',
    grade: null,
    evaluated_at: null,
    docs_ok: false,
    settings_ok: false,
  },
];
// 이름은 일부러 서버 쪽 이름 — 화면이 이름을 지어내지 않고 catalog 를 그대로 쓰는지 본다
const CATALOG = {
  equipment: [
    { key: 'panel_saw', name: '패널쏘(서버)' },
    { key: 'cnc_cut', name: 'CNC 재단(서버)' },
    { key: 'edge_bander', name: '엣지밴더(서버)' },
  ],
  staff_roles: [
    { key: 'design', name: '설계 담당(서버)' },
    { key: 'install', name: '시공 담당(서버)' },
  ],
  staff_total: [{ key: 'total', name: '전체 인원(서버)' }],
  staff_dedicated: [{ key: 'dedicated', name: '전담(서버)' }],
  suppliers: [
    {
      key: 'door',
      name: '도어(서버)',
      companies: [
        { key: 'cratech', name: '크라텍(서버)', kind: 'PET · 도장' },
        { key: 'homegreen', name: '홈그린(서버)', kind: '' },
      ],
    },
    {
      key: 'body',
      name: '몸통(서버)',
      companies: [{ key: 'dongwha', name: '동화(서버)', kind: 'PB' }],
    },
    {
      key: 'hw',
      name: '하드웨어(서버)',
      companies: [{ key: 'blum', name: '블룸(서버)', kind: '해외' }],
    },
    {
      key: 'top',
      name: '상판(서버)',
      companies: [{ key: 'hanex', name: '하넥스(서버)', kind: '인조대리석' }],
    },
  ],
  finish_notes: [
    { key: 'door', name: '도어(서버)' },
    { key: 'body', name: '몸통(서버)' },
    { key: 'hw', name: '하드웨어(서버)' },
    { key: 'top', name: '상판(서버)' },
  ],
  design: [
    { key: 'cad', name: 'CAD(서버)' },
    { key: 'planner', name: '가구 전문 플래너(서버)' },
  ],
  limits: { supplier_rows: 3, supplier_name: 50, finish_note: 500, hq_comm: 20 },
};
const EVAL = {
  company_id: 'p1',
  grade: 'B',
  equipment: { panel_saw: 'have', cnc_cut: 'outsource' },
  staff: { design: 2, total: 5, dedicated: ['design'] },
  finishes: {
    door: [
      { key: 'cratech', main: true },
      { name: '동네 도어', main: false },
    ],
    notes: { door: 'PET 는 외주' },
  },
  hq_comm: { score: 12 },
  design: { cad: true, planner: false },
  price_tier: 'mid',
  docs: { insurance: { checked_at: '2026-10-01T12:00:00Z', by: 'u1' } },
  as_months: 12,
  warranty_months: 24,
  note: '첫 미팅 메모',
  evaluated_at: '2026-10-25T02:00:00Z',
};
// 서버가 매긴 점수 — 화면은 계산하지 않고 그대로 보인다
const SCORE = {
  areas: [
    { key: 'equipment', name: '설비(서버)', points: 3.5, max: 30 },
    { key: 'docs', name: '신뢰 · 서류(서버)', points: 2.5, max: 5 },
  ],
  total: 6,
  max: 100,
  grade: 'B',
};
const HISTORY = [
  { evaluated_at: '2026-10-25T02:00:00Z', evaluated_by_email: 'boss@example.test', grade: 'B' },
  { evaluated_at: '2026-09-01T02:00:00Z', grade: 'C' },
];

const ok = (data, status = 200) => ({ status, body: { success: true, data } });
const fail = (status, message, code) => ({ status, body: { success: false, message, code } });

function defaultHandler(
  over = {},
  evalData = { evaluation: EVAL, score: SCORE, catalog: CATALOG, history: HISTORY }
) {
  return (call) => {
    for (const [re, fn] of Object.entries(over)) {
      if (new RegExp(re).test(`${call.method} ${call.path}`)) return fn(call);
    }
    if (call.method === 'GET' && call.path === '/admin/companies?pool=1')
      return ok({ items: POOL });
    if (call.method === 'GET' && /\/evaluation$/.test(call.path)) return ok(evalData);
    if (call.method === 'PUT' && /\/evaluation$/.test(call.path))
      return ok({ evaluation: call.body });
    return { status: 404, body: { success: false, message: 'Not found' } };
  };
}

function boot({ admin = true, handler = defaultHandler(), hash = '' } = {}) {
  document.body.innerHTML = BODY;
  window.history.replaceState(null, '', `/admin/partner-eval.html${hash}`);
  window.DADAM_CONFIG = {
    supabase: { url: 'https://sb', anonKey: 'k' },
    workflowApi: { url: API },
  };
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'T', user: { email: 'a@b.c' } } },
        }),
      },
    }),
  };
  window.AdminAccess = { isAdmin: async () => admin };
  window.__PARTNER_EVAL_NO_AUTOSTART = true;
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const call = {
      path: String(url).replace(API, ''),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : null,
      auth: init.headers && init.headers.Authorization,
    };
    calls.push(call);
    const r = handler(call);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  });
  (0, eval)(SCRIPT);
  return calls;
}

const $ = (id) => document.getElementById(id);
async function start(opts) {
  const calls = boot(opts);
  await window.PartnerEval.init();
  await settle();
  return calls;
}
async function open(id) {
  [...document.querySelectorAll('#poolTable button[data-open]')]
    .find((b) => b.getAttribute('data-open') === id)
    .click();
  await settle();
}
const rowsOf = (groupKey) =>
  [...document.querySelectorAll(`#evForm .group[data-group="${groupKey}"] .row`)].map((r) =>
    r.textContent.replace(/\s+/g, ' ').trim()
  );
const checkedIn = (groupKey) =>
  [...document.querySelectorAll(`#evForm .group[data-group="${groupKey}"] input:checked`)].map(
    (n) =>
      n.type === 'radio' ? n.value : n.getAttribute('data-design') || n.getAttribute('data-doc')
  );
function setRadio(name, value) {
  const n = document.querySelector(`#evForm input[name="${name}"][value="${value}"]`);
  n.checked = true;
  n.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function setValue(sel, value) {
  const n = document.querySelector(sel);
  n.value = value;
  n.dispatchEvent(new window.Event('input', { bubbles: true }));
  n.dispatchEvent(new window.Event('change', { bubbles: true }));
}
function setCheck(sel, on) {
  const n = document.querySelector(sel);
  n.checked = on;
  n.dispatchEvent(new window.Event('change', { bubbles: true }));
}

describe('들어오기 · 업체 풀', () => {
  test('관리자가 아니면 막고 서버를 부르지 않는다', async () => {
    const calls = await start({ admin: false });
    expect($('accessDenied').style.display).toBe('block');
    expect(calls).toHaveLength(0);
  });

  test('GET /admin/companies?pool=1 — 이름 · 종류(다담 공장 / Agent) · 지역 · 등급 · 평가일 · 서류 · 상담 설정', async () => {
    const calls = await start();
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: '/admin/companies?pool=1',
      auth: 'Bearer T',
    });
    const rows = [...document.querySelectorAll('#poolTable tbody tr')].map((tr) =>
      [...tr.cells].map((c) => c.textContent.trim())
    );
    expect(rows).toEqual([
      ['다담 공장', '다담 공장', '경기도 김포시', 'A', '2026-10-20', '확인됨', '마침'],
      ['한빛가구', 'Agent', '서울특별시 강남구', '없음', '-', '미확인', '안 함'],
    ]);
    expect($('statusLine').textContent).toBe('업체 2곳');
    expect($('editor').hidden).toBe(true);
  });
});

describe('평가표 — 10묶음, 항목은 서버 catalog', () => {
  test('업체를 고르면 GET /admin/companies/p1/evaluation, 묶음 차례', async () => {
    const calls = await start();
    await open('p1');
    expect(calls[calls.length - 1]).toMatchObject({
      method: 'GET',
      path: '/admin/companies/p1/evaluation',
    });
    expect($('editor').hidden).toBe(false);
    expect($('evTitle').textContent).toBe('한빛가구');
    expect(document.querySelector('#poolTable tr[data-id="p1"]').className).toBe('active');
    const groups = [...document.querySelectorAll('#evForm .group')].map((g) =>
      g.getAttribute('data-group')
    );
    expect(groups).toEqual([
      'equipment',
      'staff',
      'finishes',
      'design',
      'price',
      'quality',
      'docs',
      'hq_comm',
      'grade',
      'note',
    ]);
    const titles = [...document.querySelectorAll('#evForm .group h4')].map(
      (h) => h.firstChild.textContent
    );
    expect(titles).toEqual([
      '설비',
      '인력',
      '마감 · 자재',
      '설계',
      '가격대',
      '품질 · 서비스',
      '신뢰 · 서류',
      '본사 소통',
      '본사 등급',
      '메모',
    ]);
  });

  test('항목 이름은 catalog 그대로 · 지금 값이 채워진다', async () => {
    await start();
    await open('p1');
    expect(rowsOf('equipment')).toEqual([
      '패널쏘(서버)있음외주없음',
      'CNC 재단(서버)있음외주없음',
      '엣지밴더(서버)있음외주없음',
    ]);
    expect(checkedIn('equipment')).toEqual(['have', 'outsource']);
    expect(rowsOf('staff')).toEqual([
      '전체 인원(서버) 명',
      '설계 담당(서버) 명 전담(서버)',
      '시공 담당(서버) 명 전담(서버)',
    ]);
    expect(document.querySelector('input[data-staff-total="total"]').value).toBe('5');
    expect(document.querySelector('#evForm .group[data-group="staff"] .sub').textContent).toBe(
      '직무별 (겸직이면 직무마다 셉니다 · 그 일만 하는 사람이 있으면 전담)'
    );
    expect(document.querySelector('input[data-staff-ded="design"]').checked).toBe(true);
    expect(document.querySelector('input[data-staff-ded="install"]').checked).toBe(false);
    expect(document.querySelector('input[data-staff="design"]').value).toBe('2');
    expect(document.querySelector('input[data-staff="install"]').value).toBe('');
    // 마감 · 자재 — 지금 거래 회사 줄 [고른 값, 직접 적은 이름(칸이 보일 때), 주력], 없으면 빈 줄 하나
    const sup = (g) =>
      [...document.querySelectorAll(`[data-sup-group="${g}"] [data-sup-row]`)].map((r) => {
        const name = r.querySelector('input[data-sup-name]');
        return [
          r.querySelector('select[data-sup-pick]').value,
          name.hidden ? null : name.value,
          r.querySelector('input[data-sup-main]').checked,
        ];
      });
    expect(sup('door')).toEqual([
      ['key:cratech', null, true],
      ['custom', '동네 도어', false],
    ]);
    expect(sup('body')).toEqual([['', null, false]]);
    expect(
      [...document.querySelector('[data-sup-group="door"] select').options].map(
        (o) => o.textContent
      )
    ).toEqual(['회사 고르기', '크라텍(서버) — PET · 도장', '홈그린(서버)', '직접 적기']);
    expect($('fHqComm').value).toBe('12');
    expect($('fHqComm').max).toBe('20');
    expect(checkedIn('design')).toEqual(['cad']);
    expect(
      [...document.querySelectorAll('#evForm .group[data-group="design"] label')].map((l) =>
        l.textContent.trim()
      )
    ).toEqual(['CAD(서버)', '가구 전문 플래너(서버)']);
    expect($('fInstallYears')).toBeNull();
    expect(document.querySelector('[data-install]')).toBeNull();
    expect(checkedIn('price')).toEqual(['mid']);
    expect(document.querySelector('#evForm .group[data-group="price"]').textContent).toContain(
      '보급중급고급'
    );
    expect($('fAsMonths').value).toBe('12');
    expect($('fWarrantyMonths').value).toBe('24');
    expect(checkedIn('docs')).toEqual(['insurance']);
    expect(document.querySelector('input[data-doc-date="insurance"]').value).toBe('2026-10-01');
    expect(document.querySelector('input[data-doc-date="contract"]').value).toBe('');
    expect(document.querySelector('#evGrade .grade-line').textContent).toBe('B 합계 6 / 100점');
    expect(rowsOf('grade')).toEqual(['설비(서버)3.5 / 30', '신뢰 · 서류(서버)2.5 / 5']);
    expect(document.querySelector('#evForm input[name="grade"]')).toBeNull();
    expect(document.querySelector('#evForm .group[data-group="grade"] h4 small').textContent).toBe(
      '저장할 때 평가표 점수로 매깁니다'
    );
    expect($('fNote').value).toBe('첫 미팅 메모');
  });

  test('마감 · 자재는 catalog suppliers 분야 차례 — 분야마다 회사 줄 · 더하기 단추 (취급함 · 안 함 없음)', async () => {
    await start();
    await open('p1');
    const fin = document.querySelector('#evForm .group[data-group="finishes"]');
    expect([...fin.querySelectorAll('.sub')].map((s) => s.textContent)).toEqual([
      '도어(서버)',
      '몸통(서버)',
      '하드웨어(서버)',
      '상판(서버)',
    ]);
    expect(
      [...fin.querySelectorAll('button[data-sup-add]')].map((b) => b.getAttribute('data-sup-add'))
    ).toEqual(['door', 'body', 'hw', 'top']);
    expect(fin.querySelector('h4 small').textContent).toBe(
      '거래 회사 · 주력 (점수에 쓰지 않습니다)'
    );
    expect(fin.textContent).not.toContain('취급함');
    expect(fin.querySelector('input[type="radio"]')).toBeNull();
  });

  test('회사 더하기 · 빼기 · 직접 적기 — 분야마다 catalog limits.supplier_rows 줄까지', async () => {
    await start();
    await open('p1');
    const rowsIn = (g) => document.querySelectorAll(`[data-sup-group="${g}"] [data-sup-row]`);
    const add = (g) => document.querySelector(`button[data-sup-add="${g}"]`).click();
    add('door');
    expect(rowsIn('door')).toHaveLength(3);
    add('door');
    expect(rowsIn('door')).toHaveLength(3);
    expect($('evStatus').textContent).toBe('도어(서버): 회사는 3곳까지 넣을 수 있습니다.');
    // 직접 적기를 고르면 이름 칸이 보인다
    const last = rowsIn('door')[2];
    const pick = last.querySelector('select[data-sup-pick]');
    const name = last.querySelector('input[data-sup-name]');
    expect(name.hidden).toBe(true);
    expect(name.maxLength).toBe(50);
    pick.value = 'custom';
    pick.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(name.hidden).toBe(false);
    pick.value = 'key:homegreen';
    pick.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(name.hidden).toBe(true);
    // 빼기
    rowsIn('door')[0].querySelector('button[data-sup-del]').click();
    expect(rowsIn('door')).toHaveLength(2);
    expect(rowsIn('door')[0].querySelector('select').value).toBe('custom');
  });

  test('마감 · 자재 분야마다 메모 칸 — 묶음 아래, 지금 메모가 채워진다 (catalog finish_notes 에 있는 분야만)', async () => {
    await start();
    await open('p1');
    const boxes = () =>
      [
        ...document.querySelectorAll(
          '#evForm .group[data-group="finishes"] textarea[data-finish-note]'
        ),
      ].map((t) => [t.getAttribute('data-finish-note'), t.placeholder, t.value, t.maxLength]);
    expect(boxes()).toEqual([
      ['door', '도어(서버) 메모', 'PET 는 외주', 500],
      ['body', '몸통(서버) 메모', '', 500],
      ['hw', '하드웨어(서버) 메모', '', 500],
      ['top', '상판(서버) 메모', '', 500],
    ]);
    // 분야 회사 줄 · 더하기 단추 바로 아래
    expect(
      document
        .querySelector('textarea[data-finish-note="door"]')
        .previousElementSibling.getAttribute('data-sup-add')
    ).toBe('door');
    // catalog 에 분야 메모가 없으면 칸도 없다
    await start({
      handler: defaultHandler(
        {},
        {
          evaluation: EVAL,
          catalog: { ...CATALOG, finish_notes: [{ key: 'top', name: '상판' }] },
          history: [],
        }
      ),
    });
    await open('p1');
    expect(boxes()).toEqual([['top', '상판 메모', '', 500]]);
  });

  test('catalog 항목이 [키, 이름] 꼴이어도 받는다', () => {
    boot();
    const { entries } = window.PartnerEval;
    expect(
      entries([
        ['panel_saw', '패널쏘'],
        { key: 'nesting', label: '네스팅' },
        'boring',
        { name: '키 없음' },
      ])
    ).toEqual([
      { key: 'panel_saw', name: '패널쏘', group: undefined },
      { key: 'nesting', name: '네스팅', group: undefined },
      { key: 'boring', name: 'boring' },
    ]);
  });

  test('평가 이력 · 평가가 없을 때', async () => {
    await start();
    await open('p1');
    const items = [...document.querySelectorAll('#historyList li')].map((li) =>
      li.textContent.replace(/\s+/g, ' ').trim()
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('등급 B');
    expect(items[0]).toContain('boss@example.test');
    expect(items[1]).toContain('등급 C');
    await start({ handler: defaultHandler({}, { evaluation: {}, catalog: CATALOG, history: [] }) });
    await open('f1');
    expect($('historyList').textContent).toContain('이력이 없습니다');
    expect(checkedIn('grade')).toEqual([]);
    expect($('evSub').textContent).toContain('마지막 평가 없음');
  });

  test('자동 지표는 서버가 줄 때만 읽기 전용으로', async () => {
    await start();
    await open('p1');
    expect($('evMetrics')).toBeNull();
    await start({
      handler: defaultHandler(
        {},
        {
          evaluation: EVAL,
          catalog: CATALOG,
          history: [],
          metrics: { satisfaction: 4.36, response_rate: 0.8, rework_free_rate: null },
        }
      ),
    });
    await open('p1');
    const m = $('evMetrics').textContent.replace(/\s+/g, ' ');
    expect(m).toContain('고객 만족 4.4 / 5');
    expect(m).toContain('24시간 안 받기 80%');
    expect(m).toContain('재작업 없는 수주 자료 없음');
    expect($('evMetrics').querySelector('input')).toBeNull();
  });
});

describe('저장 — PUT /admin/companies/:id/evaluation', () => {
  test('고친 값으로 본문을 만든다 (catalog 키만 · 서류는 날짜 그대로면 확인 기록 유지)', async () => {
    const calls = await start();
    await open('p1');
    setRadio('eq-2', 'none');
    // 하드웨어 — 블룸 고르고 주력, 상판 — 직접 적기
    const hw = document.querySelector('[data-sup-group="hw"] [data-sup-row]');
    setValue('[data-sup-group="hw"] select[data-sup-pick]', 'key:blum');
    setCheck('[data-sup-group="hw"] input[data-sup-main]', true);
    setValue('[data-sup-group="top"] select[data-sup-pick]', 'custom');
    setValue('[data-sup-group="top"] input[data-sup-name]', '  동네 상판  ');
    expect(hw.querySelector('input[data-sup-name]').hidden).toBe(true);
    setValue('#fHqComm', '15');
    setValue('input[data-staff="install"]', '3');
    setValue('input[data-staff-total="total"]', '4');
    setCheck('input[data-staff-ded="install"]', true);
    setCheck('input[data-design="planner"]', true);
    setValue('textarea[data-finish-note="top"]', '  세라믹은 외주  ');
    setRadio('price_tier', 'high');
    setValue('#fAsMonths', '18');
    setValue('input[data-doc-date="contract"]', '2026-10-28');
    setValue('#fNote', '  서류 다 받음  ');
    $('btnSave').click();
    await settle();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.path).toBe('/admin/companies/p1/evaluation');
    expect(put.body).toEqual({
      equipment: { panel_saw: 'have', cnc_cut: 'outsource', edge_bander: 'none' },
      staff: { design: 2, install: 3, total: 4, dedicated: ['design', 'install'] },
      finishes: {
        door: [
          { key: 'cratech', main: true },
          { name: '동네 도어', main: false },
        ],
        hw: [{ key: 'blum', main: true }],
        top: [{ name: '동네 상판', main: false }],
        notes: { door: 'PET 는 외주', top: '세라믹은 외주' },
      },
      design: { cad: true, planner: true },
      hq_comm: { score: 15 },
      price_tier: 'high',
      docs: {
        insurance: { checked_at: '2026-10-01T12:00:00Z', by: 'u1' },
        contract: { checked_at: '2026-10-28' },
      },
      as_months: 18,
      warranty_months: 24,
      note: '서류 다 받음',
    });
    // 저장 뒤 풀 · 평가표를 다시 읽는다
    const after = calls.slice(calls.indexOf(put) + 1).map((c) => c.path);
    expect(after).toEqual(['/admin/companies?pool=1', '/admin/companies/p1/evaluation']);
    expect($('evStatus').textContent).toBe('저장했습니다.');
  });

  test('서류 확인을 끄면 빠지고, 날짜를 바꾸면 새 날짜만 보낸다', async () => {
    const calls = await start();
    await open('p1');
    setValue('input[data-doc-date="insurance"]', '2026-10-15');
    $('btnSave').click();
    await settle();
    expect(calls.find((c) => c.method === 'PUT').body.docs).toEqual({
      insurance: { checked_at: '2026-10-15' },
    });
    await start();
    await open('p1');
    setCheck('input[data-doc="insurance"]', false);
    $('btnSave').click();
    await settle();
    const puts = global.fetch.mock.calls.filter(([, init]) => init && init.method === 'PUT');
    expect(JSON.parse(puts[0][1].body).docs).toEqual({});
  });

  test('확인을 켜면 빈 날짜에 오늘이 들어간다', async () => {
    await start();
    await open('p1');
    setCheck('input[data-doc="contract"]', true);
    const v = document.querySelector('input[data-doc-date="contract"]').value;
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('평가가 비어 있으면 null · 빈 묶음으로 보낸다', async () => {
    const calls = await start({
      handler: defaultHandler({}, { evaluation: {}, catalog: CATALOG, history: [] }),
    });
    await open('f1');
    $('btnSave').click();
    await settle();
    expect($('evGrade').textContent).toBe('아직 평가하지 않았습니다. 저장하면 등급이 매겨집니다.');
    expect(calls.find((c) => c.method === 'PUT').body).toEqual({
      equipment: {},
      staff: {},
      finishes: {},
      design: { cad: false, planner: false },
      hq_comm: {},
      price_tier: null,
      docs: {},
      as_months: null,
      warranty_months: null,
      note: null,
    });
  });

  test('숫자 칸이 정수가 아니면 보내지 않고 알린다', async () => {
    const calls = await start();
    await open('p1');
    setValue('#fWarrantyMonths', '1.5');
    $('btnSave').click();
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('evStatus').textContent).toBe('하자 보증 기간: 0 이상의 정수로 넣어 주세요.');
    setValue('#fWarrantyMonths', '24');
    setValue('input[data-staff="design"]', '-1');
    $('btnSave').click();
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('evStatus').textContent).toBe('인력 설계 담당(서버): 0 이상의 정수로 넣어 주세요.');
    setValue('input[data-staff="design"]', '2');
    setValue('input[data-staff-total="total"]', '2.5');
    $('btnSave').click();
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('evStatus').textContent).toBe('전체 인원(서버): 0 이상의 정수로 넣어 주세요.');
    setValue('input[data-staff-total="total"]', '4');
    setValue('#fHqComm', '21');
    $('btnSave').click();
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('evStatus').textContent).toBe('본사 소통: 0~20점으로 넣어 주세요.');
    setValue('#fHqComm', '1.5');
    $('btnSave').click();
    await settle();
    expect($('evStatus').textContent).toBe('본사 소통: 0 이상의 정수로 넣어 주세요.');
  });

  test('같은 분야에 같은 회사를 두 번 넣으면 보내지 않고 알린다', async () => {
    const calls = await start();
    await open('p1');
    document.querySelector('button[data-sup-add="body"]').click();
    const picks = document.querySelectorAll('[data-sup-group="body"] select[data-sup-pick]');
    for (const p of picks) p.value = 'key:dongwha';
    $('btnSave').click();
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('evStatus').textContent).toBe('몸통(서버): 같은 회사를 두 번 넣었습니다.');
  });

  test('전담 — 인원이 없거나 전담 직무가 전체 인원보다 많으면 보내지 않고 알린다', async () => {
    const calls = await start();
    await open('p1');
    setCheck('input[data-staff-ded="install"]', true);
    $('btnSave').click();
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('evStatus').textContent).toBe(
      '인력 시공 담당(서버): 전담이면 인원을 1명 이상 넣어 주세요.'
    );
    setValue('input[data-staff="install"]', '1');
    setValue('input[data-staff-total="total"]', '1');
    $('btnSave').click();
    await settle();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect($('evStatus').textContent).toBe('인력: 전담 직무(2개)가 전체 인원(1명)보다 많습니다.');
    setValue('input[data-staff-total="total"]', '2');
    $('btnSave').click();
    await settle();
    expect(calls.find((c) => c.method === 'PUT').body.staff).toEqual({
      design: 2,
      install: 1,
      total: 2,
      dedicated: ['design', 'install'],
    });
  });

  test('catalog 에 전담 칸이 없으면(옛 서버) 체크도 없고 dedicated 를 보내지 않는다', async () => {
    const { staff_dedicated, ...noDed } = CATALOG;
    expect(staff_dedicated).toHaveLength(1);
    const calls = await start({
      handler: defaultHandler({}, { evaluation: EVAL, catalog: noDed, history: [] }),
    });
    await open('p1');
    expect(document.querySelector('input[data-staff-ded]')).toBeNull();
    $('btnSave').click();
    await settle();
    expect(calls.find((c) => c.method === 'PUT').body.staff).toEqual({ design: 2, total: 5 });
  });

  test('catalog 에 본사 소통 한도가 없으면 칸도 없고 보내지 않는다', async () => {
    const { limits, ...noLimits } = CATALOG;
    expect(limits.hq_comm).toBe(20);
    const calls = await start({
      handler: defaultHandler({}, { evaluation: EVAL, catalog: noLimits, history: [] }),
    });
    await open('p1');
    expect($('fHqComm')).toBeNull();
    expect(document.querySelector('#evForm .group[data-group="hq_comm"]')).toBeNull();
    $('btnSave').click();
    await settle();
    expect('hq_comm' in calls.find((c) => c.method === 'PUT').body).toBe(false);
  });

  test('422 (catalog 밖 키 등) — 서버 글을 그대로', async () => {
    await start({
      handler: defaultHandler({
        '^PUT ': () => fail(422, '평가표에 없는 항목입니다: foo', 'invalid'),
      }),
    });
    await open('p1');
    $('btnSave').click();
    await settle();
    expect($('evStatus').textContent).toBe('평가표에 없는 항목입니다: foo');
    expect($('btnSave').disabled).toBe(false);
  });
});

describe('그 밖', () => {
  test('저장하지 않고 다른 업체를 누르면 묻는다 — 버리고 열기 · 계속 고치기', async () => {
    const calls = await start();
    await open('p1');
    setValue('#fNote', '쓰던 메모');
    await open('f1');
    expect($('dirtyBar').hidden).toBe(false);
    expect($('evTitle').textContent).toBe('한빛가구');
    $('dirtyKeep').click();
    expect($('dirtyBar').hidden).toBe(true);
    expect($('fNote').value).toBe('쓰던 메모');
    await open('f1');
    $('dirtyDiscard').click();
    await settle();
    expect($('dirtyBar').hidden).toBe(true);
    expect($('evTitle').textContent).toBe('다담 공장');
    expect(calls.filter((c) => /evaluation$/.test(c.path)).map((c) => c.path)).toEqual([
      '/admin/companies/p1/evaluation',
      '/admin/companies/f1/evaluation',
    ]);
  });

  test('#company=<id> 로 오면 그 업체를 바로 연다 (상담 분배의 「평가 보기」)', async () => {
    const calls = await start({ hash: '#company=p1' });
    expect(calls.map((c) => c.path)).toEqual([
      '/admin/companies?pool=1',
      '/admin/companies/p1/evaluation',
    ]);
    expect($('evTitle').textContent).toBe('한빛가구');
  });

  test("라우터 404 'Not found' — 배포 안내", async () => {
    await start({
      handler: () => ({ status: 404, body: { success: false, message: 'Not found' } }),
    });
    expect($('setupNotice').hidden).toBe(false);
    expect($('setupNotice').textContent).toContain('아직 배포되지 않았습니다');
    expect(document.querySelector('#poolTable tbody').textContent).toContain(
      '업체 풀이 비었습니다'
    );
  });

  test('평가표 경로만 없으면 편집 칸 자리에 안내', async () => {
    await start({
      handler: defaultHandler({
        '/evaluation$': () => ({ status: 404, body: { success: false, message: 'Not found' } }),
      }),
    });
    await open('p1');
    expect($('editor').hidden).toBe(true);
    expect($('editorEmpty').textContent).toContain('아직 배포되지 않았습니다');
  });

  test('넣는 값은 모두 esc — 업체 이름 · catalog 이름 · 이력', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    POOL.push({ id: 'x"><i>', name: evil, kind: 'partner', plan: evil, sido: evil });
    try {
      await start({
        handler: defaultHandler(
          {},
          {
            evaluation: { note: evil, finishes: { door: [{ name: evil }, { key: evil }] } },
            catalog: {
              ...CATALOG,
              equipment: [{ key: '"><i>k', name: evil }],
              suppliers: [
                { key: 'door', name: evil, companies: [{ key: '"><i>', name: evil, kind: evil }] },
              ],
            },
            history: [{ evaluated_at: 'x', grade: evil, evaluated_by_email: evil }],
            metrics: { [evil]: 1 },
          }
        ),
      });
      await open('x"><i>');
      expect(document.querySelector('#pageContent img')).toBeNull();
      expect(document.querySelector('#pageContent i')).toBeNull();
      expect($('evTitle').textContent).toBe(evil);
      expect($('fNote').value).toBe(evil);
    } finally {
      POOL.pop();
    }
  });
});
