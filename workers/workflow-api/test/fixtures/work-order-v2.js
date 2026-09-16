/**
 * 작업지시서 v2 시험 픽스처 — B1 필드(partId·slot·edges…)가 있는 자재 행, 경첩 비고(보링), B4 재단 배치,
 * 그리고 v2 render_payload(renders·swatches·cut_plan·parts_digest·prev_rev).
 */

export function materials() {
  return [
    {
      partId: '0-l1-body:side-0', slot: 'body', itemLabel: '싱크대', module: '하부장-개수대', part: '측판',
      material: 'PB', thickness: 15, w: 550, h: 720, qty: 2, edge: '3면',
      edges: { L: true, R: false, T: true, B: true }, edgeLen: 1820, edgeT: 0.6, edgeCode: null, finishCode: '', note: '',
    },
    {
      partId: '0-l1-body:bottom-0', slot: 'body', itemLabel: '싱크대', module: '하부장-개수대', part: '지판',
      material: 'PB', thickness: 15, w: 970, h: 550, qty: 1, edge: '1면(전)',
      edges: { L: false, R: false, T: true, B: false }, edgeLen: 970, edgeT: 0.6, edgeCode: null, finishCode: '', note: '',
    },
    {
      partId: '0-l1-door#0-0', slot: 'door', itemLabel: '싱크대', module: '하부장-개수대', part: '도어',
      material: 'PET', thickness: 18, w: 496, h: 716, qty: 2, edge: '4면',
      edges: { L: true, R: true, T: true, B: true }, edgeLen: 2424, edgeT: 1.0, edgeCode: 'PET-OAK-M', finishCode: 'PET-OAK-M', note: 'PET 오크 무광',
    },
    {
      partId: '0-u1-door#0-0', slot: 'door', itemLabel: '싱크대', module: '상부장-후드장', part: '도어',
      material: 'PET', thickness: 18, w: 396, h: 735, qty: 2, edge: '4면',
      edges: { L: true, R: true, T: true, B: true }, edgeLen: 2262, edgeT: 1.0, edgeCode: 'YR-YPA-02', finishCode: 'YR-YPA-02', note: '',
    },
    {
      partId: '0-l1-back-0', slot: 'back', itemLabel: '싱크대', module: '하부장-개수대', part: '뒷판',
      material: 'MDF', thickness: 2.7, w: 970, h: 705, qty: 1, edge: '-',
      edges: { L: false, R: false, T: false, B: false }, edgeLen: 0, edgeT: 0.6, edgeCode: null, finishCode: '', note: '',
    },
  ];
}

export function hardware() {
  return [
    { category: '경첩', item: '문주 110도 약음 경첩', manufacturer: '문주', spec: '3구', qty: 6, unit: 'EA', note: '개수대 (보링: 110, 358, 606)', itemLabel: '싱크대' },
    { category: '경첩', item: '문주 110도 약음 경첩', manufacturer: '문주', spec: '3구', qty: 6, unit: 'EA', note: '후드장 (보링: 110, 368, 625)', itemLabel: '싱크대' },
    { category: '레일', item: '문주 언더레일', manufacturer: '문주', spec: '450mm', qty: 1, unit: 'SET', note: '', itemLabel: '싱크대' },
    { category: '다리', item: '싱크다리', manufacturer: '', spec: '150mm', qty: 4, unit: 'EA', note: '', itemLabel: '싱크대' },
  ];
}

export function cutPlan() {
  return {
    version: 1,
    sheetSize: { w: 1220, h: 2440 },
    kerf: 4,
    trim: 10,
    sheets: [
      {
        no: 1, material: 'PB', thickness: 15, partClass: '본체', size: { w: 1220, h: 2440 }, trim: 10,
        layout: { no: 1, stack: 1, index: 1, dir: 'H', rotated: false },
        strips: [{ no: 1, offset: 10, size: 720, used: 1104, remain: 96 }],
        parts: [
          { partId: '0-l1-body:side-0#0', part: '측판', w: 550, h: 720, x: 10, y: 10, rot: false, grain: 'none', strip: 1 },
          { partId: '0-l1-body:side-0#1', part: '측판', w: 550, h: 720, x: 564, y: 10, rot: false, grain: 'none', strip: 1 },
          { partId: '0-l1-body:bottom-0#0', part: '지판', w: 970, h: 550, x: 10, y: 734, rot: false, grain: 'none', strip: 2 },
        ],
        usedArea: 1325500, yield: 0.4453,
      },
      {
        no: 2, material: 'PET', thickness: 18, partClass: '도어', size: { w: 1220, h: 2440 }, trim: 10,
        layout: { no: 1, stack: 1, index: 1, dir: 'H', rotated: false },
        strips: [],
        parts: [
          { partId: '0-l1-door#0-0#0', part: '도어', w: 496, h: 716, x: 10, y: 10, rot: false, grain: 'v', strip: 1 },
          { partId: '0-l1-door#0-0#1', part: '도어', w: 496, h: 716, x: 510, y: 10, rot: false, grain: 'v', strip: 1 },
          { partId: '0-u1-door#0-0#0', part: '도어', w: 396, h: 735, x: 10, y: 730, rot: false, grain: 'v', strip: 2 },
          { partId: '0-u1-door#0-0#1', part: '도어', w: 396, h: 735, x: 410, y: 730, rot: false, grain: 'v', strip: 2 },
        ],
        usedArea: 1292512, yield: 0.4342,
      },
    ],
    offcuts: [{ sheetNo: 1, kind: 'sheet', x: 10, y: 1288, w: 1200, h: 1142, free: 1142 }],
    groups: [],
    smallParts: [],
    unallocated: [],
    summary: { sheetsByMaterial: { PB_15: 1, PET_18: 1 }, sheetCount: 2, totalYield: 0.44, partsTotal: 7, partsPlaced: 7, smallCount: 0, unallocatedCount: 0 },
  };
}

export function design() {
  return {
    appVersion: '3.2.0',
    items: [
      {
        uniqueId: 1757900000123.45,
        categoryId: 'sink',
        labelName: '싱크대',
        w: 2400, h: 2300, d: 650,
        specs: { doorFinishLower: 'pet-matte', doorColorLower: 'oak' },
        modules: [
          { id: 'l1', pos: 'lower', type: 'sink', name: '개수대', w: 1000, h: 870, d: 600, doorCount: 2 },
          { id: 'u1', pos: 'upper', type: 'hood', name: '후드장', w: 800, h: 720, d: 295, doorCount: 2 },
        ],
      },
    ],
  };
}

export function snapshot(overrides = {}) {
  const mats = materials();
  return {
    id: 'S2',
    design_id: 'D1',
    rev: 3,
    content_hash: 'abcdef0123456789abcdef',
    design_title: '김OO님 주방',
    item_count: 1,
    module_count: 2,
    panel_count: mats.reduce((s, m) => s + m.qty, 0),
    design_payload: design(),
    bom_payload: { materials: mats },
    hardware_payload: { hardware: hardware() },
    quote_payload: { subtotal: 480000, vat: 48000, total: 528000, items: [] },
    cut_plan_payload: cutPlan(),
    sheet_count: 2,
    created_at: '2026-09-16T01:00:00.000Z',
    ...overrides,
  };
}

export function swatches() {
  return [
    { code: 'PET-OAK-M', known: true, color_name: '오크 무광', color_hex: '#c9a877', vendor_code: null, series: null, finish: 'PET', tone: 'matte' },
    { code: 'YR-YPA-02', known: true, color_name: '아크 퓨어코튼', color_hex: '#f6efe7', vendor_code: 'YPA-02', series: 'Prestige Acryl', finish: 'ACR', tone: 'matte' },
  ];
}

export function renders() {
  return [
    { item_index: 0, item_unique_id: 1757900000123, path: 'D1/1757900000123/front-20260916010000.png', width: 2048, height: 1536, created_at: '2026-09-16T01:00:00.000Z' },
  ];
}

/** v2 문서 (rev 2, 이전 rev 와의 차이 포함). */
export function doc(overrides = {}) {
  return {
    id: 'DOC2',
    doc_no: 'DD-20260916-D1D1-WO-r2',
    doc_type: 'work_order',
    rev: 2,
    title: '김OO님 주방',
    customer_name: '홍길동',
    customer_name_masked: '홍*동',
    created_at: '2026-09-16T02:00:00.000Z',
    totals: { subtotal: 480000, vat: 48000, total: 528000, sheet_count: 2, label_count: 8 },
    render_payload: {
      quote: { subtotal: 480000, vat: 48000, total: 528000 },
      instructions: '도어 결 방향 세로 유지',
      issued_by: 'hong@example.com',
      work_order_version: 2,
      renders: renders(),
      swatches: swatches(),
      cut_plan: cutPlan(),
      parts_digest: [],
      prev_rev: {
        document_id: 'DOC1',
        rev: 1,
        doc_no: 'DD-20260910-D1D1-WO-r1',
        snapshot_rev: 2,
        diff: {
          added: [{ key: '0-u1-door#0-0', partId: '0-u1-door#0-0', itemLabel: '싱크대', module: '상부장-후드장', part: '도어', w: 396, h: 735, thickness: 18, qty: 2, finishCode: 'YR-YPA-02', material: 'PET' }],
          removed: [{ key: '0-l1-shelf#0-0', partId: '0-l1-shelf#0-0', itemLabel: '싱크대', module: '하부장-개수대', part: '선반', w: 970, h: 500, thickness: 15, qty: 1, finishCode: '', material: 'PB' }],
          changed: [{ key: '0-l1-door#0-0', partId: '0-l1-door#0-0', module: '하부장-개수대', part: '도어', changes: [{ field: 'finishCode', from: 'PET-WHITE-M', to: 'PET-OAK-M' }, { field: 'qty', from: 1, to: 2 }] }],
        },
      },
    },
    ...overrides,
  };
}

/** v1 문서 — render_payload 에 v2 필드가 없다. */
export function docV1(overrides = {}) {
  return {
    id: 'DOC0',
    doc_no: 'DD-20260801-D1D1-WO-r1',
    doc_type: 'work_order',
    rev: 1,
    title: '김OO님 주방',
    customer_name: '홍길동',
    customer_name_masked: '홍*동',
    created_at: '2026-08-01T02:00:00.000Z',
    totals: { subtotal: 480000, vat: 48000, total: 528000 },
    render_payload: { quote: { subtotal: 480000 }, instructions: '', issued_by: null },
    ...overrides,
  };
}

/** v1 스냅샷 — partId·edges·cut_plan_payload 가 없다. */
export function snapshotV1() {
  const mats = materials().map(({ partId, slot, edges, edgeLen, edgeT, edgeCode, ...rest }) => rest);
  const s = snapshot({ id: 'S1', rev: 1, bom_payload: { materials: mats } });
  delete s.cut_plan_payload;
  delete s.sheet_count;
  return s;
}
