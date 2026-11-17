/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach, __dirname, document, window, jest, setTimeout, Event */
/**
 * SEGAN 「생산 설정」 아래 — 자재 가격표 (segan/price-list.js)
 *
 *   파일 → 줄: 첫 줄의 칸 이름으로 분류 · 제품군 · 사양 · 색상명 · 코드 · 규격 · 단가를 찾는다
 *   제품군마다 용도 (처음 값은 짐작 — 사람이 고친다) · 같은 색에 값이 둘이면 올리기 전에 알린다
 *   서버: GET /planner/price-lists · POST /planner/price-lists · GET /planner/price-lists/items
 *   DB 0070 전(409 db_pending)이면 올리는 칸을 내지 않는다 · 403 이면 칸째 감춘다
 *   색 · 값은 모두 지어낸 것이다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WORK = 'https://work.example.workers.dev';
const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});

const load = () => {
  delete window.SeganPriceList;
  delete window.XLSX;
  delete window.__seganXlsxLoading;
  (0, eval)(read('segan/price-list.js'));
  return window.SeganPriceList;
};
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// 공급처 가격표의 꼴
const HEAD = ['번호', '대분류', '제품군', '사양·소재', '색상명', '코드', '규격', '단가(원)'];
const ROWS = [
  [1, '보드', 'PB(국산)', '15T 솔리드', '화이트엠보', 'BS-01', '15*1220*2440', 32000],
  [2, '보드', 'PB(국산)', '18T 솔리드', '화이트엠보', 'BS-01', '18*1220*2440', 34000],
  [3, '보드', 'PB(수입)', '15T 솔리드', '화이트엠보', 'BS-01', '15*1220*2440', 30000],
  [4, '보드', '슈프림', 'PET(SM)', '매트 화이트', 'SM-01', '18*1220*2440', '67,000'],
  [5, 'MDF·합판', 'MDF 2.7T', '솔리드 PVC', '화이트엠보', 'BS-01', '2.7*1220*2440', 19500],
  [6, '에지', '에지 18mm 0.6T', 'PVC', '화이트엠보', 'BS-01', '0.6*18*100', '16,500원'],
  [7, '핫멜트', '핫멜트', '-', '', 'JK-702', '0*0*0', 83000],
  ['', '', '', '', '', '', '', ''],
  [8, '보드', '슈프림', 'PET(SM)', '값 없는 줄', 'SM-99', '18*1220*2440', '문의'],
  [9, '보드', '슈프림', 'PET(SM)', '', '', '18*1220*2440', 70000],
];
const AOA = [HEAD, ...ROWS];

describe('순수 — 파일 → 줄 · 제품군 · 용도 짐작 · 값이 둘인 색', () => {
  test('칸 이름 줄 — 빈칸 · 가운뎃점을 빼고 견준다, 단가와 (색상명이나 코드)가 있어야 한다', () => {
    const P = load();
    expect(P.headerMapOf(HEAD)).toEqual({
      category: 1,
      product: 2,
      spec: 3,
      color_name: 4,
      code: 5,
      size_text: 6,
      unit_price: 7,
    });
    expect(P.headerMapOf([' 색 상 ', '단 가'])).toEqual({ color_name: 0, unit_price: 1 });
    expect(P.headerMapOf(['코드', '가격'])).toEqual({ code: 0, unit_price: 1 });
    expect(P.headerMapOf(['색상명', '코드'])).toBeNull();
    expect(P.headerMapOf(['제품군', '단가'])).toBeNull();
    expect(P.headerMapOf(null)).toBeNull();
  });

  test('단가 · 두께 읽기', () => {
    const P = load();
    expect([P.priceOf(98000), P.priceOf('98,000'), P.priceOf(' 16,500원 '), P.priceOf(0)]).toEqual([
      98000, 98000, 16500, 0,
    ]);
    expect([
      P.priceOf('문의'),
      P.priceOf(''),
      P.priceOf(-1),
      P.priceOf(1.5),
      P.priceOf(null),
    ]).toEqual([null, null, null, null, null]);
    expect([
      P.thicknessOf('18*1220*2440'),
      P.thicknessOf('2.7*1220*2440'),
      P.thicknessOf('0.6*18*100'),
      P.thicknessOf('18 x 1220'),
    ]).toEqual([18, 2.7, 0.6, 18]);
    expect([
      P.thicknessOf('0*0*0'),
      P.thicknessOf('규격 없음'),
      P.thicknessOf(''),
      P.thicknessOf(null),
    ]).toEqual([null, null, null, null]);
  });

  test('표 → 줄 — 빈 줄은 건너뛰고, 단가를 못 읽었거나 이름이 없는 줄은 뺀 수로 센다', () => {
    const P = load();
    const r = P.itemsOfRows(AOA);
    expect(r.items.length).toBe(7);
    expect(r.skipped).toBe(2);
    expect(r.items[0]).toEqual({
      category: '보드',
      product: 'PB(국산)',
      spec: '15T 솔리드',
      color_name: '화이트엠보',
      code: 'BS-01',
      size_text: '15*1220*2440',
      thickness: 15,
      unit_price: 32000,
    });
    expect(r.items[3].unit_price).toBe(67000);
    expect(r.items[6]).toMatchObject({
      color_name: '',
      code: 'JK-702',
      thickness: null,
      unit_price: 83000,
    });
    // 칸 이름 줄이 맨 위가 아니어도 (앞 스무 줄 안) 찾는다 · 없으면 null
    expect(P.itemsOfRows([['예림 가격표'], [], HEAD, ROWS[0]]).items.length).toBe(1);
    expect(P.itemsOfRows([['메모'], ['출처: …']])).toBeNull();
    expect(P.itemsOfRows(null)).toBeNull();
    // 긴 글은 서버 한도까지만
    const long = P.itemsOfRows([
      HEAD,
      [1, '보드', '가'.repeat(80), '', '나'.repeat(50), 'C'.repeat(50), '', 1000],
    ]).items[0];
    expect([long.product.length, long.color_name.length, long.code.length]).toEqual([60, 40, 40]);
  });

  test('제품군 묶음 · 용도의 처음 값 (짐작)', () => {
    const P = load();
    const items = P.itemsOfRows(AOA).items;
    const groups = P.groupsOf(items);
    expect(groups.map((g) => [g.category, g.product, g.n, g.min, g.max, g.kind])).toEqual([
      ['보드', 'PB(국산)', 2, 32000, 34000, 'body'],
      ['보드', 'PB(수입)', 1, 30000, 30000, 'body'],
      ['보드', '슈프림', 1, 67000, 67000, 'door'],
      ['MDF·합판', 'MDF 2.7T', 1, 19500, 19500, 'back'],
      ['에지', '에지 18mm 0.6T', 1, 16500, 16500, 'edge'],
      ['핫멜트', '핫멜트', 1, 83000, 83000, 'other'],
    ]);
    expect(P.KINDS).toEqual(['body', 'back', 'door', 'edge', 'other']);
    expect(P.KIND_LABELS).toEqual({
      body: '몸통',
      back: '우라',
      door: '도어',
      edge: '엣지',
      other: '그 밖',
    });
    // 두께가 섞인 묶음(15 미만과 이상) · 규격을 못 읽은 묶음은 그 밖
    expect(P.guessKind({ category: '보드', product: 'X', thicknesses: [9, 18], sheet: true })).toBe(
      'other'
    );
    expect(P.guessKind({ category: '필름', product: 'X', thicknesses: [], sheet: false })).toBe(
      'other'
    );
  });

  test('용도를 줄에 입힌다 · 같은 색에 값이 둘인 곳을 찾는다', () => {
    const P = load();
    const items = P.itemsOfRows(AOA).items;
    const groups = P.groupsOf(items);
    const withKinds = P.withKinds(items, groups);
    expect(withKinds.map((x) => x.kind)).toEqual([
      'body',
      'body',
      'body',
      'door',
      'back',
      'edge',
      'other',
    ]);
    expect(Object.keys(withKinds[0])[0]).toBe('kind');
    // 국산 · 수입을 둘 다 몸통으로 → 화이트엠보 BS-01 15T 가 32,000 · 30,000
    expect(P.conflictsOf(withKinds)).toEqual([
      { kind: 'body', color: '화이트엠보 BS-01', thickness: 15, prices: [32000, 30000] },
    ]);
    // 수입을 그 밖으로 바꾸면 없다
    groups[1].kind = 'other';
    expect(P.conflictsOf(P.withKinds(items, groups))).toEqual([]);
    // 우라는 두께를 가리지 않는다 · 도어는 코드로 · 엣지 · 그 밖은 보지 않는다
    const more = [
      { kind: 'back', color_name: '화이트', code: 'W', thickness: 2.7, unit_price: 19500 },
      { kind: 'back', color_name: '화이트', code: 'W', thickness: 3, unit_price: 21000 },
      { kind: 'door', color_name: '가', code: 'D-1', thickness: 18, unit_price: 60000 },
      { kind: 'door', color_name: '나', code: 'D-1', thickness: 18, unit_price: 61000 },
      { kind: 'edge', color_name: '화이트', code: 'W', thickness: 0.6, unit_price: 1 },
      { kind: 'edge', color_name: '화이트', code: 'W', thickness: 0.6, unit_price: 2 },
    ];
    expect(P.conflictsOf(more)).toEqual([
      { kind: 'back', color: '화이트 W', thickness: null, prices: [19500, 21000] },
      { kind: 'door', color: 'D-1', thickness: 18, prices: [60000, 61000] },
    ]);
    // 모르는 용도는 그 밖으로
    expect(P.withKinds([items[0]], [{ key: '보드|PB(국산)', kind: 'top' }])[0].kind).toBe('other');
  });

  test('같은 색에 값이 둘 이상인 제품군은 사양마다 나눈다 — 쓰는 사양만 도어로 남길 수 있다', () => {
    const P = load();
    const items = P.itemsOfRows([
      HEAD,
      [1, '보드', '슈프림', 'PET(SM)', '매트 화이트', 'SM-01', '18*1220*2440', 67000],
      [2, '보드', '슈프림', 'PET(SM)', '매트 캐시미어', 'SM-03', '18*1220*2440', 69000],
      [3, '보드', '슈프림', 'PET(SM)후면강화', '매트 화이트', 'SM-01', '18*1220*2440', 70000],
      [4, '보드', '슈프림', 'PET(SM)후면강화', '매트 캐시미어', 'SM-03', '18*1220*2440', 72000],
      [5, '보드', '슈프림 4*9', 'PET(SM)후면강화', '매트 화이트', 'SM-01', '18*1220*2440', 100000],
      [6, '보드', '프라임', 'MFB', '오크', 'PM-01', '18*1220*2440', 60000],
      [7, '보드', '프라임', '-', '월넛', 'PM-02', '18*1220*2440', 61000],
      [8, '에지', '에지 1T', 'PET', '매트 화이트', 'SM-01', '1*21*100', 29000],
      [9, '에지', '에지 1T', 'PP', '매트 화이트', 'SM-01', '1*21*100', 33000],
    ]).items;
    const groups = P.groupsOf(items);
    // 슈프림만 나뉜다 — 프라임(같은 색에 값이 하나) · 에지(판재가 아니다)는 제품군 하나 그대로
    expect(
      groups.map((g) => [g.key, g.base, g.product, g.spec, g.n, g.min, g.max, g.kind])
    ).toEqual([
      ['보드|슈프림|PET(SM)', '보드|슈프림', '슈프림', 'PET(SM)', 2, 67000, 69000, 'door'],
      [
        '보드|슈프림|PET(SM)후면강화',
        '보드|슈프림',
        '슈프림',
        'PET(SM)후면강화',
        2,
        70000,
        72000,
        'door',
      ],
      ['보드|슈프림 4*9', '보드|슈프림 4*9', '슈프림 4*9', null, 1, 100000, 100000, 'door'],
      ['보드|프라임', '보드|프라임', '프라임', null, 2, 60000, 61000, 'door'],
      ['에지|에지 1T', '에지|에지 1T', '에지 1T', null, 2, 29000, 33000, 'edge'],
    ]);
    expect(groups.every((g) => !('rows' in g))).toBe(true);
    // 처음에는 셋 다 도어 → SM-01 · SM-03 의 값이 둘 이상
    expect(P.conflictsOf(P.withKinds(items, groups)).map((c) => [c.color, c.prices])).toEqual([
      ['SM-01', [67000, 70000, 100000]],
      ['SM-03', [69000, 72000]],
    ]);
    // 후면강화 · 4*9 를 그 밖으로 → 값이 하나로 정해진다
    groups[1].kind = 'other';
    groups[2].kind = 'other';
    const rows = P.withKinds(items, groups);
    expect(rows.map((x) => x.kind)).toEqual([
      'door',
      'door',
      'other',
      'other',
      'other',
      'door',
      'door',
      'edge',
      'edge',
    ]);
    expect(P.conflictsOf(rows)).toEqual([]);
  });
});

describe('화면', () => {
  let P;
  let el;
  let calls;
  let server;
  const mount = async () => {
    P.mount(el, { base: WORK, token: async () => 'tok-1' });
    await flush();
  };
  const fakeXlsx = (sheets) => {
    window.XLSX = {
      read: jest.fn(() => ({ SheetNames: Object.keys(sheets), Sheets: sheets })),
      utils: { sheet_to_json: jest.fn((ws) => ws) },
    };
  };
  const file = (name = '가격표.xlsx') => ({ name, arrayBuffer: async () => new ArrayBuffer(8) });
  const q = (sel) => el.querySelector(sel);
  const msg = () => text(q('[data-pl="msg"]'));

  beforeEach(() => {
    P = load();
    P.reset();
    document.body.innerHTML = '<div id="slot"></div>';
    el = document.getElementById('slot');
    calls = [];
    server = {
      lists: () => ok({ lists: [] }),
      post: (body) => ok({ list: { row_count: body.items.length } }, 201),
      items: () => ok({ total: 0, items: [] }),
    };
    window.fetch = jest.fn(async (url, init = {}) => {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      const method = init.method || 'GET';
      calls.push({ url, method, auth: (init.headers || {}).Authorization, body });
      const r = url.startsWith(WORK + '/planner/price-lists/items')
        ? server.items(url)
        : method === 'POST'
          ? server.post(body)
          : server.lists();
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    });
  });

  test('처음 — 지금 가격표를 읽는다 (없으면 「없습니다」), 올리는 칸은 공급처 이름 · 파일', async () => {
    await mount();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([`GET ${WORK}/planner/price-lists`]);
    expect(calls[0].auth).toBe('Bearer tok-1');
    expect(text(q('h4.od-h'))).toBe('자재 가격표');
    expect(text(q('[data-pl="none"]'))).toBe('올린 가격표가 없습니다.');
    expect(q('#pl-supplier').getAttribute('maxlength')).toBe('40');
    expect(q('#pl-file').getAttribute('accept')).toBe('.xlsx,.xls,.csv');
    expect(q('[data-pl="draft"]')).toBeNull();
    expect(q('#pl-q')).toBeNull(); // 가격표가 없으면 찾는 칸도 없다
  });

  test('지금 가격표 — 공급처 · 파일 · 줄 수 · 용도마다 수 · 올린 날', async () => {
    server.lists = () =>
      ok({
        lists: [
          {
            id: 'l1',
            supplier: '가나 보드',
            source_name: 'a.xlsx',
            row_count: 850,
            created_at: '2026-11-18T03:00:00Z',
            counts: { body: 100, back: 40, door: 104, edge: 254, other: 352 },
          },
        ],
      });
    await mount();
    const cells = [...q('[data-pl="lists"] tbody tr').children].map(text);
    expect(cells).toEqual([
      '가나 보드',
      'a.xlsx',
      '850',
      '몸통 100 · 우라 40 · 도어 104 · 엣지 254 · 그 밖 352',
      '2026-11-18',
    ]);
    expect(q('#pl-q')).not.toBeNull();
  });

  test('DB 0070 적용 전 — 그 글만 보이고 올리는 칸이 없다 · 403 이면 칸째 감춘다', async () => {
    server.lists = () => fail(409, 'db_pending', 'DB 0070 적용 전입니다');
    await mount();
    expect(text(q('[data-pl="pending"]'))).toBe(
      'DB 0070 적용 전입니다 — 자재 가격표는 적용 뒤에 올릴 수 있습니다.'
    );
    expect(q('#pl-file')).toBeNull();
    P.reset();
    server.lists = () => fail(403, 'not_manager', '대표 · 실장만');
    await mount();
    expect(el.innerHTML).toBe('');
  });

  test('파일을 고르면 — 줄 수 · 뺀 줄 수 · 제품군마다 용도 · 값이 둘인 색 알림', async () => {
    await mount();
    fakeXlsx({ 참고: [['메모'], ['출처']], '전체 목록': AOA });
    await P.pick(file('예림 가격표.xlsx'));
    expect(window.XLSX.read).toHaveBeenCalledTimes(1);
    const notes = [...el.querySelectorAll('[data-pl="draft"] > p.mk-note')].map(text);
    expect(notes[0]).toBe('예림 가격표.xlsx — 7줄 (단가나 이름을 읽지 못한 2줄은 뺍니다)');
    expect(notes[1]).toBe(P.TEXT.guess);
    const rows = [...el.querySelectorAll('[data-pl="groups"] tbody tr')];
    expect(rows.map((r) => [...r.children].slice(0, 4).map(text))).toEqual([
      ['보드', 'PB(국산)', '2', '32,000 ~ 34,000'],
      ['보드', 'PB(수입)', '1', '30,000'],
      ['보드', '슈프림', '1', '67,000'],
      ['MDF·합판', 'MDF 2.7T', '1', '19,500'],
      ['에지', '에지 18mm 0.6T', '1', '16,500'],
      ['핫멜트', '핫멜트', '1', '83,000'],
    ]);
    expect(rows.map((r) => r.querySelector('select').value)).toEqual([
      'body',
      'body',
      'door',
      'back',
      'edge',
      'other',
    ]);
    expect(rows[0].querySelector('select').getAttribute('aria-label')).toBe('PB(국산) 용도');
    expect(text(q('[data-pl="conflicts"]'))).toBe(
      '같은 색에 값이 둘인 색이 1개 있습니다 — 플래너가 그 색의 값을 고르지 못합니다. 쓰지 않는 쪽 묶음을 「그 밖」으로 바꿔 주세요. 예: 몸통 화이트엠보 BS-01 15T (32,000 · 30,000)'
    );
    // 수입을 「그 밖」으로 → 알림이 사라진다
    const sel = rows[1].querySelector('select');
    sel.value = 'other';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(q('[data-pl="conflicts"]')).toBeNull();
    expect(
      el.querySelectorAll('[data-pl="groups"] tbody tr')[1].querySelector('select').value
    ).toBe('other');
    expect(calls.filter((c) => c.method === 'POST').length).toBe(0); // 고르기만 해서는 올리지 않는다
  });

  test('칸을 못 찾는 파일 · 읽기 도구를 못 불러온 경우 — 알리고 올리는 줄이 없다', async () => {
    await mount();
    fakeXlsx({ 참고: [['메모'], ['출처']] });
    await P.pick(file());
    expect(msg()).toBe(P.TEXT.noColumns);
    expect(q('[data-pl="draft"]')).toBeNull();
    // 줄이 너무 많다
    fakeXlsx({
      표: [
        HEAD,
        ...Array.from({ length: 5001 }, (_, i) => [
          i,
          '보드',
          'PB',
          '',
          `색${i}`,
          `C-${i}`,
          '15*1220*2440',
          1000,
        ]),
      ],
    });
    await P.pick(file());
    expect(msg()).toBe(P.TEXT.tooMany);
    // 도구를 못 불러옴 — 스크립트가 오류로 끝난다
    delete window.XLSX;
    const append = document.head.appendChild.bind(document.head);
    jest.spyOn(document.head, 'appendChild').mockImplementation((s) => {
      setTimeout(() => s.onerror && s.onerror(new Event('error')), 0);
      return s;
    });
    await P.pick(file());
    expect(msg()).toBe(P.TEXT.noTool);
    document.head.appendChild.mockRestore();
    expect(typeof append).toBe('function');
    expect(P.XLSX_URL).toBe('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  });

  test('올리기 — 공급처 이름이 있어야 한다, 고른 용도대로 보낸 뒤 지금 가격표를 다시 읽는다', async () => {
    await mount();
    fakeXlsx({ 표: AOA });
    await P.pick(file('a.xlsx'));
    q('[data-act="pl-upload"]').click();
    await flush();
    expect(msg()).toBe(P.TEXT.needSupplier);
    expect(calls.filter((c) => c.method === 'POST').length).toBe(0);
    const name = q('#pl-supplier');
    name.value = '  가나   보드 ';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const sel = el.querySelectorAll('[data-pl="groups"] tbody tr')[1].querySelector('select');
    sel.value = 'other';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(q('#pl-supplier').value).toBe('  가나   보드 '); // 다시 그려도 적던 글이 남는다
    server.lists = () =>
      ok({
        lists: [
          {
            id: 'l1',
            supplier: '가나 보드',
            source_name: 'a.xlsx',
            row_count: 7,
            created_at: '2026-11-18T03:00:00Z',
            counts: { body: 2, back: 1, door: 1, edge: 1, other: 2 },
          },
        ],
      });
    q('[data-act="pl-upload"]').click();
    await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe(WORK + '/planner/price-lists');
    expect(post.auth).toBe('Bearer tok-1');
    expect([post.body.supplier, post.body.source_name, post.body.items.length]).toEqual([
      '가나 보드',
      'a.xlsx',
      7,
    ]);
    expect(post.body.items.map((x) => x.kind)).toEqual([
      'body',
      'body',
      'other',
      'door',
      'back',
      'edge',
      'other',
    ]);
    expect(post.body.items[0]).toEqual({
      kind: 'body',
      category: '보드',
      product: 'PB(국산)',
      spec: '15T 솔리드',
      color_name: '화이트엠보',
      code: 'BS-01',
      size_text: '15*1220*2440',
      thickness: 15,
      unit_price: 32000,
    });
    expect(msg()).toBe('가격표를 올렸습니다 — 7줄.');
    expect(q('[data-pl="draft"]')).toBeNull();
    expect(text(q('[data-pl="lists"] tbody th'))).toBe('가나 보드');
    expect(
      calls.filter((c) => c.method === 'GET' && c.url === WORK + '/planner/price-lists').length
    ).toBe(2);
  });

  test('올리기 실패 — 서버 글을 보이고 읽은 가격표는 그대로 둔다 · 취소하면 지운다', async () => {
    await mount();
    fakeXlsx({ 표: AOA });
    await P.pick(file());
    const name = q('#pl-supplier');
    name.value = '가나 보드';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    server.post = () =>
      fail(422, 'validation', '3번째 줄: 단가는 0 ~ 100000000 사이 정수(원)여야 합니다');
    q('[data-act="pl-upload"]').click();
    await flush();
    expect(msg()).toBe('3번째 줄: 단가는 0 ~ 100000000 사이 정수(원)여야 합니다');
    expect(q('[data-pl="draft"]')).not.toBeNull();
    expect(q('[data-act="pl-upload"]').disabled).toBe(false);
    q('[data-act="pl-cancel"]').click();
    expect(q('[data-pl="draft"]')).toBeNull();
    expect(msg()).toBe('');
  });

  test('찾기 — 글 · 용도로 서버에 묻고 줄을 보인다', async () => {
    server.lists = () =>
      ok({
        lists: [
          {
            id: 'l1',
            supplier: '가나 보드',
            source_name: 'a.xlsx',
            row_count: 7,
            created_at: '2026-11-18T03:00:00Z',
            counts: { door: 1 },
          },
        ],
      });
    server.items = () =>
      ok({
        total: 120,
        items: [
          {
            supplier: '가나 보드',
            seq: 4,
            kind: 'door',
            category: '보드',
            product: '슈프림',
            spec: 'PET(SM)',
            color_name: '매트 화이트',
            code: 'SM-01',
            size_text: '18*1220*2440',
            thickness: 18,
            unit_price: 67000,
          },
        ],
      });
    await mount();
    const box = q('#pl-q');
    box.value = ' 매트  화이트 ';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    const kind = q('#pl-fkind');
    kind.value = 'door';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    q('[data-act="pl-find"]').click();
    await flush();
    expect(calls[calls.length - 1].url).toBe(
      `${WORK}/planner/price-lists/items?limit=50&q=${encodeURIComponent('매트 화이트')}&kind=door`
    );
    expect(text(q('[data-pl="found"]'))).toBe('120줄 가운데 앞 1줄');
    expect([...q('[data-pl="items"] tbody tr').children].map(text)).toEqual([
      '도어',
      '매트 화이트',
      'SM-01',
      '슈프림 · PET(SM)',
      '18*1220*2440',
      '67,000',
    ]);
    server.items = () => ok({ total: 0, items: [] });
    q('[data-act="pl-find"]').click();
    await flush();
    expect(text(q('[data-pl="found"]'))).toBe('맞는 줄이 없습니다.');
  });

  test('글자는 글자로만 — 가격표의 글이 태그가 되지 않는다', async () => {
    server.lists = () =>
      ok({
        lists: [
          {
            id: 'l1',
            supplier: '<img src=x onerror=1>',
            source_name: '<b>a</b>',
            row_count: 1,
            created_at: '',
            counts: {},
          },
        ],
      });
    await mount();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[data-pl="lists"] b')).toBeNull();
    fakeXlsx({
      표: [
        HEAD,
        [1, '<i>보드</i>', '<script>x</script>', '', '<b>색</b>', 'C-1', '15*1220*2440', 1000],
      ],
    });
    await P.pick(file('<u>f</u>.xlsx'));
    expect(el.querySelector('[data-pl="groups"] script')).toBeNull();
    expect(el.querySelector('[data-pl="draft"] u')).toBeNull();
    expect(text(el.querySelector('[data-pl="groups"] tbody th'))).toBe('<script>x</script>');
  });
});

describe('붙는 곳', () => {
  test('생산 설정이 아래 저장 줄 밑에 자리를 주고 부른다 · 스크립트 차례 · 서비스 워커 · 새 창 없이', () => {
    const settings = read('segan/production-settings.js');
    expect(settings).toContain(
      "barHtml(false) +\n      '<div data-ps-pricelist></div>';"
        .split('\n')
        .join(settings.includes('\r\n') ? '\r\n' : '\n')
    );
    expect(settings).toContain('PL.mount(slot, { base: J.base, token: token });');
    const html = read('segan/me.html');
    const at = (name) => html.indexOf(`<script src="${name}?v=`);
    expect(at('price-list.js')).toBeGreaterThan(0);
    expect(at('price-list.js')).toBeLessThan(at('production-settings.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'price-list.js'),");
    const src = read('segan/price-list.js');
    expect(src).not.toMatch(/\balert\(|\bconfirm\(|\bprompt\(/);
    expect(src).not.toContain('innerHTML +=');
  });
});
