/**
 * D1 상세설계 왕복 — 플래너 디테일(마감) 모델이 부모(detaildesign)와 오가는 배선.
 *
 *   플래너 → 부모   PLANNER_DETAIL_CHANGE {detail}  → item.detail + specs.doorColorUpper/Lower · doorFinishUpper/Lower 미러
 *   부모 → 플래너   DADAM_DETAIL_SET {detail}       → iframe load 마다 (배치 → 구조 이동에도)
 *   저장/불러오기   design_items.detail              → persistence-init.js
 *   내보내기        DadamAgent.exportDesign().items[].detail 그대로 (BOM 추출기 B1 이 읽는다)
 *
 * ui-step1.js / persistence-init.js / config-constants.js 는 전역 스크립트라 import 할 수 없으므로
 * planner-to-bom.test.js 처럼 소스에서 블록을 잘라 new Function 으로 실제 코드를 평가한다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const UI = read('js/detaildesign/ui-step1.js');
const PERSIST = read('js/detaildesign/persistence-init.js');
const CONFIG = read('js/detaildesign/config-constants.js');

// 정본 해석 함수·카탈로그 (planner-finish.js 는 CommonJS 로도 나온다)
const PF = require('../js/planner/planner-finish.js');
require('../js/detaildesign/bom-finish-color.js');   // window.DadamBomFinishColor

function sliceBetween(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  const e = src.indexOf(endMarker, s + 1);
  if (s < 0 || e < 0) throw new Error(`마커를 찾지 못했습니다: ${startMarker}`);
  return src.slice(s, e);
}

/** 여는 중괄호부터 짝이 맞는 닫는 중괄호까지 */
function sliceBalanced(src, startIdx) {
  const open = src.indexOf('{', startIdx);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(startIdx, i + 1); }
  }
  throw new Error('중괄호 짝을 찾지 못했습니다');
}

/** config-constants.js 를 그대로 평가해 FurnitureOptionCatalog(내장 폴백) + DadamAgent 를 얻는다 */
function loadConfig(selectedItems) {
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'document', 'selectedItems', 'SupabaseUtils', 'CATEGORIES', 'DEFAULT_SPECS', 'updateUI',
    CONFIG + '\nreturn { FurnitureOptionCatalog, DadamAgent: window.DadamAgent };'
  );
  return factory(window, document, selectedItems, undefined, [], {}, () => {});
}

/**
 * ui-step1.js 의 D1 블록만 잘라 평가한다. hasUnsavedChanges 는 persistence-init.js 의 전역이라
 * 여기서 let 으로 선언해 두고 게터로 읽는다.
 */
function loadSync(state) {
  const block = sliceBetween(UI, '// D1: 플래너 디테일(마감) 모델 왕복', 'function _loadPlannerEmbed');
  const src = `
    let hasUnsavedChanges = false;
    ${block}
    return {
      dirty: () => hasUnsavedChanges,
      _plannerDetailStable, _isPlannerDetail, _plannerDetailDoorOf, _plannerDetailCodeToSpec,
      _mirrorPlannerDetailToSpecs, _applyPlannerDetailChange, _plannerFrameOfSource, _plannerItemOfFrame,
      _plannerDetailSynced,
      _sendPlannerDetail: typeof _sendPlannerDetail === 'function' ? _sendPlannerDetail : null,
      _attachPlannerDetailSender: typeof _attachPlannerDetailSender === 'function' ? _attachPlannerDetailSender : null,
    };`;
  // eslint-disable-next-line no-new-func
  const factory = new Function('window', 'document', 'location', 'selectedItems', 'updateSaveStatus', 'setTimeout', src);
  return factory(window, document, window.location, state.selectedItems, state.updateSaveStatus || (() => {}), state.setTimeout || setTimeout);
}

function makeItem(over = {}) {
  return {
    uniqueId: 42, categoryId: 'sink', name: '싱크대', labelName: '싱크대 #1', w: 3000, h: 2310, d: 650,
    specs: { doorColorUpper: '화이트', doorFinishUpper: '무광', doorColorLower: '화이트', doorFinishLower: '무광', topColor: '스노우' },
    modules: [],
    ...over,
  };
}

/** 플래너가 보내는 모델 — planner-finish.js 로 만든 진짜 형식 */
function makeDetail() {
  const d = PF.plannerFinishEmpty();
  PF.plannerFinishSet(d, 'item', 'door', 'PET-OAK-M');                                 // 품목: PET 매트 오크
  PF.plannerFinishSet(d, 'section', 'door', 'PNT-WHT-G', { section: 'upper' });        // 상부만 도장 유광 화이트
  PF.plannerFinishSet(d, 'module', 'door', 'MFB-BLK', { moduleId: 'lower-0' });        // 모듈 재정의 (미러 대상 아님)
  PF.plannerFinishSet(d, 'part', 'door', 'PNT-BLK-G', { moduleId: 'lower-0', partKey: 'door#1' });
  return d;
}

/** 품목 오버레이 안의 플래너 iframe 을 만든다 (ui-step1 _loadPlannerEmbed 와 같은 모양) */
function mountFrame(itemParam, design = 'local') {
  const overlay = document.createElement('div');
  overlay.id = '__planner-overlay-' + itemParam;
  const iframe = document.createElement('iframe');
  iframe.dataset.planner = 'true';
  iframe.src = '/mockup-shell?preset=sink&itemId=' + itemParam + '&design=' + design + '&item=' + itemParam;
  overlay.appendChild(iframe);
  document.body.appendChild(overlay);
  return iframe;
}

/** 모든 깊이의 키를 거꾸로 정렬해 다시 만든다 — JSONB 왕복으로 키 순서가 바뀐 모양 */
function reorderKeys(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reorderKeys);
  const out = {};
  Object.keys(v).sort().reverse().forEach((k) => { out[k] = reorderKeys(v[k]); });
  return out;
}

function post(iframe, data, origin = window.location.origin) {
  window.dispatchEvent(new window.MessageEvent('message', { data, origin, source: iframe.contentWindow }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete window.plannerFinishResolve;
  delete window.selectedItems;
});

describe('수신 — PLANNER_DETAIL_CHANGE → item.detail + 상/하 도어 사양 미러', () => {
  test('같은 오리진 iframe 의 detail 을 스코프(?item=) 품목에 받고, 수정됨으로 표시한다', () => {
    const items = [makeItem({ uniqueId: 7 }), makeItem({ uniqueId: 42 })];
    loadConfig(items);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const statuses = [];
    const S = loadSync({ selectedItems: items, updateSaveStatus: (a, b) => statuses.push([a, b]) });
    const frame = mountFrame('42');
    const detail = makeDetail();

    post(frame, { type: 'PLANNER_DETAIL_CHANGE', source: 'mockup-structure', detail });

    expect(items[1].detail).toEqual(detail);
    expect(items[0].detail).toBeUndefined();                       // 다른 품목은 건드리지 않는다
    expect(S.dirty()).toBe(true);
    expect(statuses).toEqual([['saving', '수정됨']]);
    // 상부: 섹션 재정의 PNT-WHT-G → 화이트 · 유광 / 하부: 품목 PET-OAK-M → 오크 · 무광
    expect(items[1].specs.doorColorUpper).toBe('화이트');
    expect(items[1].specs.doorFinishUpper).toBe('유광');
    expect(items[1].specs.doorColorLower).toBe('오크');
    expect(items[1].specs.doorFinishLower).toBe('무광');
    expect(items[1].specs.topColor).toBe('스노우');                  // 다른 사양은 그대로
  });

  test('모듈·부재 재정의는 미러하지 않는다 (품목/섹션 단계만)', () => {
    const item = makeItem();
    loadConfig([item]);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const S = loadSync({ selectedItems: [item] });
    const d = PF.plannerFinishEmpty();
    PF.plannerFinishSet(d, 'module', 'door', 'MFB-BLK', { moduleId: 'lower-0' });
    PF.plannerFinishSet(d, 'part', 'door', 'PNT-BLK-G', { moduleId: 'lower-0', partKey: 'door#1' });
    const r = S._applyPlannerDetailChange(item, d);
    expect(r).toEqual({ changed: true, mirrored: [] });
    expect(item.detail).toBe(d);
    expect(item.specs.doorColorLower).toBe('화이트');
    expect(item.specs.doorFinishLower).toBe('무광');
  });

  test('한글 대응이 없는 코드는 그 키를 건드리지 않는다 — 단톤(MFB) 은 색만, 모르는 코드는 둘 다 그대로', () => {
    const item = makeItem();
    loadConfig([item]);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const S = loadSync({ selectedItems: [item] });
    expect(S._plannerDetailCodeToSpec('MFB-BLK')).toEqual({ color: '블랙', finish: null });
    expect(S._plannerDetailCodeToSpec('PET-SAG-M')).toEqual({ color: '세이지', finish: '무광' });   // 셀렉트엔 없지만 라벨은 있다
    expect(S._plannerDetailCodeToSpec('XXX-YYY-M')).toEqual({ color: null, finish: null });
    expect(S._plannerDetailCodeToSpec('')).toEqual({ color: null, finish: null });

    const d = PF.plannerFinishEmpty();
    PF.plannerFinishSet(d, 'item', 'door', 'MFB-BLK');
    expect(S._mirrorPlannerDetailToSpecs(item, d)).toEqual(['doorColorUpper', 'doorColorLower']);
    expect(item.specs.doorFinishUpper).toBe('무광');
    expect(item.specs.doorFinishLower).toBe('무광');
  });

  test('planner-finish.js 가 없어도 같은 순서(섹션 > 품목)로 직접 해석한다', () => {
    const item = makeItem();
    loadConfig([item]);
    expect(window.plannerFinishResolve).toBeUndefined();
    const S = loadSync({ selectedItems: [item] });
    const d = makeDetail();
    expect(S._plannerDetailDoorOf(d, 'upper')).toEqual({ code: 'PNT-WHT-G', level: 'section' });
    expect(S._plannerDetailDoorOf(d, 'lower')).toEqual({ code: 'PET-OAK-M', level: 'item' });
    expect(S._plannerDetailDoorOf(PF.plannerFinishEmpty(), 'lower')).toBeNull();
    // 정본 함수와 같은 답
    expect(S._plannerDetailDoorOf(d, 'upper')).toEqual(PF.plannerFinishResolve(d, 'door', null, 'upper'));
    expect(S._plannerDetailDoorOf(d, 'lower')).toEqual(PF.plannerFinishResolve(d, 'door', null, 'lower'));
  });

  test('다른 오리진 · 모델이 아닌 detail · 부트스트랩/모르는 스코프는 무시한다', () => {
    const item = makeItem();
    loadConfig([item]);
    const S = loadSync({ selectedItems: [item] });
    const frame = mountFrame('42');
    const boot = mountFrame('bootstrap');
    const stranger = mountFrame('999');
    const detail = makeDetail();

    post(frame, { type: 'PLANNER_DETAIL_CHANGE', detail }, 'https://evil.example');
    post(frame, { type: 'PLANNER_DETAIL_CHANGE', detail: { item: {} } });           // version 없음
    post(frame, { type: 'PLANNER_DETAIL_CHANGE', detail: [1, 2] });
    post(frame, { type: 'PLANNER_DETAIL_CHANGE', detail: 'PET-OAK-M' });
    post(boot, { type: 'PLANNER_DETAIL_CHANGE', detail });
    post(stranger, { type: 'PLANNER_DETAIL_CHANGE', detail });
    window.dispatchEvent(new window.MessageEvent('message', { data: { type: 'PLANNER_DETAIL_CHANGE', detail }, origin: window.location.origin, source: null }));

    expect(item.detail).toBeUndefined();
    expect(S.dirty()).toBe(false);
    expect(item.specs.doorColorLower).toBe('화이트');
  });

  test('우리가 보낸 모델의 메아리(키 순서만 다른 같은 모델)는 수정됨으로 표시하지 않는다', () => {
    const detail = makeDetail();
    // DB(JSONB) 를 다녀오면 키 순서가 바뀐다 — 그 모양으로 품목에 실려 있다고 치자
    const fromDb = reorderKeys(detail);
    expect(Object.keys(fromDb)).not.toEqual(Object.keys(detail));
    const item = makeItem({ detail: fromDb, specs: { doorColorUpper: '화이트', doorFinishUpper: '유광', doorColorLower: '오크', doorFinishLower: '무광' } });
    loadConfig([item]);
    window.plannerFinishResolve = PF.plannerFinishResolve;
    const S = loadSync({ selectedItems: [item] });
    const frame = mountFrame('42');
    expect(S._plannerDetailStable(fromDb)).toBe(S._plannerDetailStable(detail));

    post(frame, { type: 'PLANNER_DETAIL_CHANGE', detail });
    expect(S.dirty()).toBe(false);
    expect(item.detail).toBe(fromDb);                                 // 바꿀 것이 없으니 그대로

    // 실제로 다른 모델이 오면 수정됨
    const changed = JSON.parse(JSON.stringify(detail));
    PF.plannerFinishSet(changed, 'item', 'body', 'MFB-WHT');
    post(frame, { type: 'PLANNER_DETAIL_CHANGE', detail: changed });
    expect(S.dirty()).toBe(true);
    expect(item.detail).toEqual(changed);
  });
});

describe('송신 — iframe 이 문서를 열 때마다 DADAM_DETAIL_SET, 메아리가 없으면 한 번 더', () => {
  function armed(item, over = {}) {
    const timers = [];
    loadConfig([item]);
    const S = loadSync({ selectedItems: [item], setTimeout: (fn, ms) => timers.push({ fn, ms }), ...over });
    const frame = mountFrame(String(item.uniqueId));
    const sent = [];
    frame.contentWindow.postMessage = (msg, origin) => sent.push({ msg, origin });
    S._attachPlannerDetailSender(frame, item.uniqueId);
    return { S, frame, sent, timers };
  }

  test('load → 같은 오리진으로 detail 을 보내고, 메아리가 오면 재전송하지 않는다', () => {
    const detail = makeDetail();
    const item = makeItem({ detail });
    const { frame, sent, timers } = armed(item);

    frame.dispatchEvent(new window.Event('load'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ msg: { type: 'DADAM_DETAIL_SET', detail }, origin: window.location.origin });
    expect(timers).toHaveLength(1);

    // 플래너가 replace → save → PLANNER_DETAIL_CHANGE 로 답한다
    post(frame, { type: 'PLANNER_DETAIL_CHANGE', detail });
    timers[0].fn();
    expect(sent).toHaveLength(1);
  });

  test('메아리가 없으면(배치 페이지가 열린 경우 등) 한 번 더 보내고, 다음 문서(load)에서 또 보낸다', () => {
    const item = makeItem({ detail: makeDetail() });
    const { frame, sent, timers } = armed(item);

    frame.dispatchEvent(new window.Event('load'));      // 배치 페이지 — 듣는 쪽이 없다
    timers[0].fn();
    expect(sent).toHaveLength(2);
    frame.dispatchEvent(new window.Event('load'));      // 구조 페이지로 이동
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => s.msg.type === 'DADAM_DETAIL_SET' && s.origin === window.location.origin)).toBe(true);
  });

  test('detail 이 없는 품목은 아무것도 보내지 않는다 (플래너는 자기 localStorage 로 시작한다)', () => {
    const item = makeItem();
    const { frame, sent, timers } = armed(item);
    frame.dispatchEvent(new window.Event('load'));
    expect(sent).toHaveLength(0);
    expect(timers).toHaveLength(0);
  });

  test('품목 전환 재전송은 품목 쪽 detail 이 달라졌을 때만 간다 (같은 모델은 되돌리기 이력을 더럽히지 않는다)', () => {
    const detail = makeDetail();
    const item = makeItem({ detail });
    const { S, frame, sent } = armed(item);
    frame.dispatchEvent(new window.Event('load'));
    expect(sent).toHaveLength(1);

    expect(S._sendPlannerDetail(frame, item)).toBe(false);          // 이미 맞춰 둔 모델
    expect(sent).toHaveLength(1);

    item.detail = reorderKeys(detail);                               // 키 순서만 다른 같은 모델 (불러오기 뒤)
    expect(S._sendPlannerDetail(frame, item)).toBe(false);

    const other = JSON.parse(JSON.stringify(detail));
    PF.plannerFinishSet(other, 'item', 'top', 'TOP-SNW');            // 되쓰기 등으로 실제로 달라짐
    item.detail = other;
    expect(S._sendPlannerDetail(frame, item)).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1].msg.detail).toBe(other);
    expect(S._sendPlannerDetail(frame, item, true)).toBe(true);       // force 는 언제나
    expect(S._sendPlannerDetail(null, item)).toBe(false);
  });

  test('불러오기가 품목 객체를 갈아 끼워도 보낼 때 새 품목 객체를 찾는다', () => {
    const items = [makeItem()];
    loadConfig(items);
    const S = loadSync({ selectedItems: items, setTimeout: () => {} });
    const frame = mountFrame('42');
    const sent = [];
    frame.contentWindow.postMessage = (msg, origin) => sent.push({ msg, origin });
    S._attachPlannerDetailSender(frame, 42);

    frame.dispatchEvent(new window.Event('load'));                   // 아직 detail 없음 → 안 보낸다
    expect(sent).toHaveLength(0);
    const reloaded = makeItem({ detail: makeDetail() });
    items.splice(0, 1, reloaded);                                     // loadDesign 이 같은 uniqueId 의 새 객체를 넣는다
    frame.dispatchEvent(new window.Event('load'));
    expect(sent).toHaveLength(1);
    expect(sent[0].msg.detail).toBe(reloaded.detail);
  });
});

describe('저장·불러오기 — design_items.detail (persistence-init.js)', () => {
  function fakeSupabase({ design, rows } = {}) {
    const inserted = [];
    const from = (table) => {
      const chain = {
        insert(payload) {
          inserted.push({ table, payload });
          return { select: async () => ({ data: payload.map((_, i) => ({ id: i + 1 })), error: null }) };
        },
        select() { return chain; },
        eq() { return chain; },
        order: async () => ({ data: rows, error: null }),
        single: async () => ({ data: design, error: null }),
      };
      return chain;
    };
    return { from, inserted };
  }

  function loadPersist(items, sb) {
    const saveBlock = sliceBetween(PERSIST, 'async function saveDesignItems', '// 설계 불러오기');
    const loadBlock = sliceBalanced(PERSIST, PERSIST.indexOf('async function loadDesign'));
    const src = `
      let selectedItems = items;
      let currentDesignId = null;
      ${saveBlock}
      ${loadBlock}
      return { saveDesignItems, loadDesign, items: () => selectedItems, designId: () => currentDesignId };`;
    // eslint-disable-next-line no-new-func
    const factory = new Function('items', 'supabaseClient', 'currentUser', 'DEFAULT_SPECS', 'updateUI', 'updateSaveStatus', 'alert', src);
    return factory(items, sb, { id: 'u1' }, { doorColorUpper: '화이트' }, () => {}, () => {}, () => {});
  }

  test('저장 payload 는 detail 이 있는 품목에만 detail 컬럼을 싣는다', async () => {
    const detail = makeDetail();
    const items = [makeItem({ uniqueId: 1, detail }), makeItem({ uniqueId: 2 }), makeItem({ uniqueId: 3, detail: null })];
    const sb = fakeSupabase();
    const P = loadPersist(items, sb);
    await P.saveDesignItems('d-1');
    expect(sb.inserted).toHaveLength(1);
    expect(sb.inserted[0].table).toBe('design_items');
    const rows = sb.inserted[0].payload;
    expect(rows).toHaveLength(3);
    expect(rows[0].detail).toBe(detail);
    expect(rows[0]).toMatchObject({ design_id: 'd-1', unique_id: 1, item_order: 0, modules: [] });
    expect(rows[0].specs).toMatchObject({ doorColorUpper: '화이트' });
    expect('detail' in rows[1]).toBe(false);                          // 컬럼이 없는 DB 에서도 저장된다
    expect('detail' in rows[2]).toBe(false);
  });

  test('불러오기는 행의 detail 을 item.detail 로 되돌리고, NULL 이면 키를 두지 않는다', async () => {
    const detail = reorderKeys(makeDetail());                         // JSONB 에서 온 모양
    const sb = fakeSupabase({
      design: { id: 'd-1', name: '설계', total_items: 2 },
      rows: [
        { unique_id: 1, category: 'sink', name: '싱크대', width: 3000, height: 2310, depth: 650, specs: { doorColorUpper: '오크' }, modules: [], detail, item_order: 0 },
        { unique_id: 2, category: 'sink', name: '싱크대', width: 3000, height: 2310, depth: 650, specs: {}, modules: [], detail: null, item_order: 1 },
      ],
    });
    const P = loadPersist([], sb);
    await P.loadDesign('d-1');
    const items = P.items();
    expect(P.designId()).toBe('d-1');
    expect(items).toHaveLength(2);
    expect(items[0].detail).toEqual(detail);
    expect(items[0].specs.doorColorUpper).toBe('오크');
    expect('detail' in items[1]).toBe(false);
  });

  test('저장 → 불러오기 왕복 뒤 플래너에 되돌려 주는 모델이 같다', async () => {
    const detail = makeDetail();
    const sb = fakeSupabase();
    const P = loadPersist([makeItem({ uniqueId: 42, detail })], sb);
    await P.saveDesignItems('d-1');
    const row = JSON.parse(JSON.stringify(sb.inserted[0].payload[0]));
    const sb2 = fakeSupabase({ design: { id: 'd-1', total_items: 1 }, rows: [reorderKeys(row)] });
    const P2 = loadPersist([], sb2);
    await P2.loadDesign('d-1');
    const back = P2.items()[0];
    expect(PF.plannerFinishNormalize(back.detail)).toEqual(PF.plannerFinishNormalize(detail));
    expect(PF.plannerFinishResolve(back.detail, 'door', 'lower-0', 'lower', 'door#1')).toEqual({ code: 'PNT-BLK-G', level: 'part' });
  });
});

describe('내보내기 — DadamAgent.exportDesign() 은 item.detail 을 그대로 싣는다 (BOM 추출기 B1 계약)', () => {
  test('detail 이 있는 품목은 그대로, 없는 품목은 없음', () => {
    const detail = makeDetail();
    const items = [makeItem({ uniqueId: 1, detail }), makeItem({ uniqueId: 2 })];
    const { DadamAgent } = loadConfig(items);
    const out = DadamAgent.exportDesign();
    expect(out.items).toHaveLength(2);
    expect(out.items[0].detail).toEqual(detail);
    expect(out.items[0].detail.version).toBe(1);
    expect('detail' in out.items[1]).toBe(false);
    // specs·modules 는 사본이지만 detail 은 바꾸지 않고 넘긴다
    expect(out.items[0].specs).not.toBe(items[0].specs);
    expect(out.items[0].detail).toBe(items[0].detail);
  });
});

describe('소스 규약', () => {
  test('플래너 쪽 메시지 이름과 같다 (planner-detail.js)', () => {
    const PD = read('js/planner/planner-detail.js');
    expect(PD).toContain("type: 'PLANNER_DETAIL_CHANGE'");
    expect(PD).toContain("e.data.type !== 'DADAM_DETAIL_SET'");
    expect(UI).toContain("e.data.type !== 'PLANNER_DETAIL_CHANGE'");
    expect(UI).toContain("type: 'DADAM_DETAIL_SET'");
  });

  test('새 iframe 과 기존 iframe 양쪽에 송신이 걸려 있다', () => {
    expect(UI).toContain('_attachPlannerDetailSender(iframe, item.uniqueId)');
    expect(UI).toContain('_sendPlannerDetail(existing, item)');
    expect(UI).toContain('_sendPlannerDetail(savedIframe, item)');
  });

  test('옛 형식 스냅샷 되쓰기(DADAM_RESTORE_DETAIL)는 그대로 남아 있다', () => {
    expect(UI).toContain("e.data.type === 'DADAM_RESTORE_DETAIL'");
    expect(UI).toContain('applyDetailSnapshotToItem(item, e.data.specs, e.data.modules)');
  });

  test('저장·불러오기가 같은 컬럼 이름(detail)을 쓴다 — database/design-items-detail.sql', () => {
    const SQL = read('database/design-items-detail.sql');
    expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS detail JSONB/);
    expect((PERSIST.match(/\{ detail: item\.detail \}/g) || []).length).toBe(2);   // saveDesignItems + loadDesign
  });

  test('부모 페이지에 planner-finish.js 가 없어도 동작한다 — 싣는 것은 B1 몫이라 폴백 해석기를 둔다', () => {
    expect(UI).toContain("typeof window.plannerFinishResolve === 'function'");
  });
});
