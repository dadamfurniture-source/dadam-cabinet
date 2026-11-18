/**
 * 가공 구분(외주 · 내수) · 재단기 화면 방향 · 재단기 파일 이름 · 도어재 원장 그림
 *   — src/work-order-data.js (processingOf · rowRouteOf) · src/templates/work-order.js · src/snapshots.js (cutPlan.cnc) · src/util/hash.js
 *
 *   2026-11-19 사장님 「외주, 내수가공 선택할 수 있게 도어는 외주를 기본값으로 나머지는 내수가공을 기본값으로」
 *   기본이면 지시서 출력이 한 글자도 바뀌지 않는다 (work-order-golden.test.js 가 지킨다) — 여기서는 바꿨을 때를 본다.
 * 시험 데이터는 모두 지어낸 값이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROCESSING, processingOf, rowRouteOf, processingKeyOfClass } from '../src/work-order-data.js';
import { renderWorkOrder, labelGroups, labelNumbers, uncoveredInHouse, screenSheetOf, outsourceCounts } from '../src/templates/work-order.js';
import { autoNotesOf } from '../src/work/special-notes.js';
import { validateCutPlan } from '../src/snapshots.js';
import { cutDigestOf } from '../src/util/hash.js';
import { ValidationError } from '../src/supabase.js';
import * as fx from './fixtures/work-order-v2.js';

const strip = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const snapshotWith = (processing, extra = {}) => fx.snapshot({ design_payload: { ...fx.design(), source: 'planner-lite', ...(processing ? { processing } : {}) }, ...extra });
const docWith = (rp = {}) => fx.doc({ render_payload: { ...fx.doc().render_payload, label_order: 'cut', ...rp } });
const cut = (snapshot, doc = docWith()) => renderWorkOrder(doc, snapshot, { toolbar: false, pack: 'cut' });
/** 밥솥장 MDF 18T 몸통 (재단 외주) 한 줄 */
const BOX_ROW = { partId: '0-rice-side-0', slot: 'body', itemLabel: '싱크대', module: '밥솥장', part: '측판', material: 'MDF', thickness: 18, w: 550, h: 708, qty: 2, edge: '-', edges: {}, edgeT: 0.6 };

test('가공 구분 — 기본은 도어재 외주 · 몸통 · 뒷판 내수, 설계에 실린 칸만 바뀐다 (모르는 값은 기본)', () => {
  assert.deepEqual(DEFAULT_PROCESSING, { door: 'out', body: 'in', back: 'in' });
  assert.deepEqual(processingOf(null), DEFAULT_PROCESSING);
  assert.deepEqual(processingOf({ processing: { door: 'in' } }), { door: 'in', body: 'in', back: 'in' });
  assert.deepEqual(processingOf({ processing: { door: 'x', body: 'out', back: null, top: 'in' } }), { door: 'out', body: 'out', back: 'in' });
  assert.deepEqual(processingOf({ processing: ['in'] }), DEFAULT_PROCESSING);
  assert.deepEqual(['도어', '본체', '뒷판', undefined].map(processingKeyOfClass), ['door', 'body', 'back', 'body']);
});

test('자재 행이 가는 곳 — 사내 · 도어재 발주 · 재단 외주 · 상판 업체', () => {
  const [side, , door, , back] = fx.materials();
  const top = { part: '상판', slot: 'top', material: '인조대리석', thickness: 12, w: 2400, h: 600, qty: 1 };
  const molding = { part: '상몰딩', material: 'MDF', thickness: 18, w: 2400, h: 60, qty: 1 };
  const route = (row, proc) => rowRouteOf(row, proc);
  // 기본 — 예전 가름과 같다
  assert.deepEqual([side, door, back, BOX_ROW, top, molding].map((r) => route(r)), ['in', 'door', 'in', 'cut', 'top', 'door']);
  // 도어재 내수 — 도어재와 그 MDF 18T 상자가 사내로
  assert.deepEqual([side, door, back, BOX_ROW, top, molding].map((r) => route(r, { door: 'in', body: 'in', back: 'in' })), ['in', 'in', 'in', 'in', 'top', 'in']);
  // 몸통 외주 — 몸통만 재단 외주로 (뒷판은 따로)
  assert.deepEqual([side, door, back, BOX_ROW].map((r) => route(r, { door: 'out', body: 'out', back: 'in' })), ['cut', 'door', 'in', 'cut']);
  assert.deepEqual([side, back].map((r) => route(r, { door: 'out', body: 'in', back: 'out' })), ['in', 'cut']);
  // 18T 뒷판은 몸통 원장이다
  assert.equal(route({ part: '뒷판', material: 'MDF', thickness: 18, w: 500, h: 700, qty: 1 }, { door: 'out', body: 'out', back: 'in' }), 'cut');
});

test('재단 지시서 — 도어재를 내수로 하면 도어재 원장이 사내 원장 · 라벨 재단 차례에 들어가고 「외주」 글이 빠진다', () => {
  const base = strip(cut(snapshotWith(null)));
  assert.match(base, /사내 원판 1장/);
  assert.match(base, /도어재 4장 \(원장 1장\) 은 외주/);
  const html = cut(snapshotWith({ door: 'in' }));
  const text = strip(html);
  assert.match(text, /사내 원판 2장/);
  assert.doesNotMatch(text, /은 외주 — ⑩ 도어재 발주서/);
  assert.match(text, /PET 18T · 도어 원장 1장 · 조각 4/);
  // 라벨 — 도어재도 재단 차례로 사내 묶음에
  const mats = fx.materials();
  const groups = labelGroups(mats, fx.cutPlan(), { door: 'in', body: 'in', back: 'in' });
  assert.deepEqual([groups.inHouse.length, groups.door.length, groups.outsourced.length], [8, 0, 0]);
  assert.deepEqual(groups.inHouse.slice(0, 7).map((u) => u.id), fx.cutPlan().sheets.flatMap((s) => s.parts.map((p) => p.partId)));
  const dflt = labelGroups(mats, fx.cutPlan());
  assert.deepEqual([dflt.inHouse.length, dflt.door.length], [4, 4]);
  assert.equal(labelNumbers(mats, fx.cutPlan(), { door: 'in', body: 'in', back: 'in' }).get('0-l1-door#0-0#0'), 4, '원장 2 의 첫 조각');
  const labels = strip(renderWorkOrder(docWith(), snapshotWith({ door: 'in' }), { toolbar: false, pack: 'labels' }));
  assert.doesNotMatch(labels, /도어재 \(입고 시 부착\)/);
  // 도어재 발주서 — 발주 없음
  assert.match(strip(renderWorkOrder(docWith(), snapshotWith({ door: 'in' }), { toolbar: false, pack: 'door' })), /도어재 발주 없음 — 내수가공/);
  // 외주 수량 — 도어재 발주가 없다
  assert.deepEqual(outsourceCounts(docWith(), snapshotWith({ door: 'in' }), 'door').doorParts, 0);
  assert.equal(outsourceCounts(docWith(), snapshotWith(null), 'door').doorParts, 4);
});

test('재단 지시서 — 몸통을 외주로 하면 몸통 원장이 빠지고 「재단 외주」 목록으로 간다 (뒷판은 그대로 사내)', () => {
  const snapshot = snapshotWith({ body: 'out' });
  const text = strip(cut(snapshot));
  assert.match(text, /사내 원판 0장/);
  assert.match(text, /재단 외주 3장 — 사내에서 자르지 않는다/);
  assert.doesNotMatch(text, /MDF 18T 재단 외주/);
  const groups = labelGroups(fx.materials(), fx.cutPlan(), processingOf(snapshot.design_payload));
  assert.deepEqual([groups.inHouse.map((u) => u.row.part), groups.outsourced.length, groups.door.length], [['뒷판'], 3, 4]);
  assert.match(strip(renderWorkOrder(docWith(), snapshot, { toolbar: false, pack: 'labels' })), /재단 외주 \(입고 시 부착\)/);
  // 배치에 없는 사내 부재 — 외주로 간 몸통은 세지 않는다
  assert.deepEqual(uncoveredInHouse(fx.materials(), { ...fx.cutPlan(), sheets: [] }, processingOf(snapshot.design_payload)).map((x) => x.row.part), ['뒷판']);
  assert.deepEqual(uncoveredInHouse(fx.materials(), { ...fx.cutPlan(), sheets: [] }).map((x) => x.row.part), ['측판', '지판', '뒷판']);
  // 밥솥장 MDF 18T 상자만 외주인 기본 설계는 묶음 이름이 그대로
  const withBox = fx.snapshot({ bom_payload: { materials: [...fx.materials(), BOX_ROW] } });
  assert.match(strip(cut(withBox)), /MDF 18T 재단 외주 밥솥장·홈카페장·오픈장 몸통 2장/);
  // 자동 특별 지시도 그 설계의 가공 구분으로 사내 판을 가린다
  const colored = fx.materials().map((m) => (m.part === '측판' ? { ...m, finishCode: 'BODY-GRAY' } : m));
  const notes = (processing) => autoNotesOf(snapshotWith(processing, { bom_payload: { materials: colored } })).cut.join(' ');
  assert.match(notes(null), /BODY-GRAY/);
  assert.doesNotMatch(notes({ body: 'out' }), /BODY-GRAY/);
});

test('도어재 원장 그림 — 외주여도 그림 묶음 판이 있는 문서의 재단 지시서 끝에 참고로 싣는다 (옛 문서 · 외주처 종이에는 없다)', () => {
  const snapshot = snapshotWith(null);
  const html = cut(snapshot, docWith({ drawing_version: 1 }));
  assert.match(strip(html), /도어재 원장 외주 · 참고 — 원장 1장 · 사내에서 자르지 않는다/);
  assert.match(html, /id="cut-group-door"/);
  const ref = html.slice(html.indexOf('id="cut-group-door"'));
  assert.match(strip(ref), /시트 #2 PET 18T · 도어/);
  assert.doesNotMatch(ref.slice(0, ref.indexOf('</table>')), /class="checks"/, '참고 그림에는 체크 칸이 없다');
  assert.doesNotMatch(cut(snapshot), /cut-group-door/, '그림 묶음 판이 없는 옛 문서');
  assert.doesNotMatch(renderWorkOrder(docWith({ drawing_version: 1 }), snapshot, { toolbar: false, pack: 'cut-vendor' }), /cut-group-door/);
  // 내수로 하면 참고 묶음이 아니라 사내 묶음이다
  assert.doesNotMatch(cut(snapshotWith({ door: 'in' }), docWith({ drawing_version: 1 })), /cut-group-door/);
});

const CNC = {
  files: [{ name: '01-PB15-B-x1.qk', sheetNos: [1], count: 1, length: 2440, width: 1220, lead: 10 }],
  problems: [{ sheetNo: 2, reason: '한 칸에 스무 가지를 넘음' }],
};

test('재단기 화면 방향 · 파일 이름 — 길이가 원장의 세로 변이면 가로 · 세로를 맞바꿔 그리고, 원장 머리에 파일 이름 · 길이 × 넓이 · 선재단을 적는다', () => {
  const sheet = fx.cutPlan().sheets[0];
  // 길이 = 원장의 가로 변 → 그대로
  assert.equal(screenSheetOf(sheet, { length: 1220, width: 2440 }), sheet);
  assert.equal(screenSheetOf(sheet, null), sheet);
  const turned = screenSheetOf(sheet, { length: 2440, width: 1220 });
  assert.deepEqual(turned.size, { w: 2440, h: 1220 });
  assert.deepEqual(turned.parts.map((p) => [p.x, p.y, p.rot]), [[10, 10, true], [10, 564, true], [734, 10, true]]);
  assert.deepEqual(turned.parts.map((p) => [p.w, p.h]), sheet.parts.map((p) => [p.w, p.h]), '부재 치수는 그대로');

  const plan = { ...fx.cutPlan(), strategy: 'material', cnc: CNC };
  const html = cut(snapshotWith({ door: 'in' }), docWith({ drawing_version: 1, cut_plan: plan }));
  const text = strip(html);
  assert.match(text, /재단기 파일 01-PB15-B-x1\.qk · 길이 2,440 × 넓이 1,220 · 선재단 10/);
  assert.match(text, /원판 2,440 × 1,220 · 조각 3/, '화면대로 놓은 원장');
  assert.match(text, /재단기 파일 없음 — 한 칸에 스무 가지를 넘음/);
  // 같은 파일을 쓰는 다른 원장
  const shared = { ...plan, cnc: { files: [{ ...CNC.files[0], sheetNos: [1, 2], count: 2, length: 1220, width: 2440 }], problems: [] } };
  assert.match(strip(cut(snapshotWith({ door: 'in' }), docWith({ drawing_version: 1, cut_plan: shared }))), /길이 1,220 × 넓이 2,440 · 선재단 10 · 같은 파일 — 시트 #2/);
  // 파일 이름이 안 온 플래너 설계 — 까닭 한 줄 / 플래너 설계가 아니면 글이 없다 / 옛 문서는 그대로
  assert.match(strip(cut(snapshotWith(null), docWith({ drawing_version: 1 }))), /재단기 파일 이름 없음 — 플래너에서 다시 보내고 지시서를 다시 내 주세요/);
  assert.doesNotMatch(strip(cut(fx.snapshot(), docWith({ drawing_version: 1 }))), /재단기 파일/);
  assert.doesNotMatch(strip(cut(snapshotWith(null), docWith({ cut_plan: plan }))), /재단기 파일/);
});

test('재단기 파일 — 받을 때 모양을 본다 (이름 꼴 · 있는 원장 · 한 파일에만 · 길이 · 넓이 = 원장의 두 변), 판정에도 넣는다', () => {
  const bom = { materials: fx.materials() };
  const plan = (cnc) => ({ ...fx.cutPlan(), strategy: 'standard', ...(cnc === undefined ? {} : { cnc }) });
  assert.equal(validateCutPlan(plan(CNC), bom).cutPlan.cnc, CNC);
  assert.equal(validateCutPlan(plan(), bom).sheetCount, 2);
  const bad = [
    'x',
    { files: 'x' },
    { files: [{ ...CNC.files[0], name: '../etc.qk' }] },
    { files: [{ ...CNC.files[0], name: '01-PB15-B-x1.exe' }] },
    { files: [{ ...CNC.files[0], sheetNos: [] }] },
    { files: [{ ...CNC.files[0], sheetNos: [9] }] },
    { files: [CNC.files[0], { ...CNC.files[0], name: '02-PB15-B-x1.qk' }] },
    { files: [{ ...CNC.files[0], length: 2000 }] },
    { files: [{ ...CNC.files[0], lead: 'x' }] },
    { files: [CNC.files[0]], problems: 'x' },
    { files: [CNC.files[0]], problems: [{ sheetNo: 9, reason: 'x' }] },
  ];
  for (const cnc of bad) assert.throws(() => validateCutPlan(plan(cnc), bom), ValidationError, JSON.stringify(cnc).slice(0, 70));
  // 판정 — 파일 값이 있으면 다른 판, 없으면 예전과 같은 값
  const a = cutDigestOf(plan());
  const b = cutDigestOf(plan(CNC));
  assert.equal('cnc' in a, false);
  assert.deepEqual(b.cnc.files[0], { name: '01-PB15-B-x1.qk', sheetNos: [1], length: 2440, width: 1220, lead: 10 });
  assert.notDeepEqual(a, b);
  assert.deepEqual({ ...b, cnc: undefined }, { ...a, cnc: undefined });
  assert.equal(cutDigestOf({ ...fx.cutPlan(), cnc: CNC }), null, '재단 방식이 없는 배치는 판정에 넣지 않는다');
});

// ── 엣지 그림 쪽 · 조립 카드 (그림 묶음 판이 있는 문서만) ─────────

test('재단 꾸러미 끝의 엣지 그림 — 사내 부재마다 엣지 붙일 변, 번호는 재단 그림과 같은 라벨 번호 (옛 문서 · 외주처 종이에는 없다)', () => {
  const snapshot = snapshotWith(null);
  const html = cut(snapshot, docWith({ drawing_version: 1 }));
  const text = strip(html);
  assert.match(text, /엣지 — 부재마다 붙일 변/);
  assert.match(text, /PB 15T · 본체 엣지 붙일 부재 2종/);
  assert.match(text, /MDF 2\.7T · 뒷판 엣지 붙일 부재 0종 · 엣지 없음 1종/);
  const edge = html.slice(html.lastIndexOf('엣지 — 부재마다 붙일 변'));
  assert.equal(edge.split('class="door-drawing"').length - 1, 2, '엣지가 있는 사내 부재 둘 (측판 · 지판) — 도어재는 외주라 없다');
  assert.match(strip(edge), /1–2 측판 × 2 · 개수대 0\.6 · 720×1 · 550×2/, '라벨 번호 · 부재 · 엣지');
  // 도어재를 내수로 하면 도어도 엣지 그림에
  const inHouse = cut(snapshotWith({ door: 'in' }), docWith({ drawing_version: 1 }));
  assert.match(strip(inHouse.slice(inHouse.lastIndexOf('엣지 — 부재마다 붙일 변'))), /PET 18T · 도어 엣지 붙일 부재 2종/);
  // 옛 문서 · 외주처 종이 · 꾸러미 목록은 그대로
  assert.doesNotMatch(cut(snapshot), /엣지 — 부재마다 붙일 변/);
  assert.doesNotMatch(renderWorkOrder(docWith({ drawing_version: 1 }), snapshot, { toolbar: false, pack: 'cut-vendor' }), /엣지 — 부재마다 붙일 변/);
  assert.match(renderWorkOrder(docWith({ drawing_version: 1 }), snapshot, { toolbar: false, pack: 'all' }), /엣지 — 부재마다 붙일 변/);
});

test('조립 지시서 — 모듈 카드에 속 구조(벽 그림에서 그 모듈 자리)와 도어 앞모습 · 경첩 컵 (그림 묶음 판이 있는 문서만)', () => {
  // 플래너 설계 — 판재 행의 모듈 이름이 「#n …」, 품목 이름 = 벽 이름
  const mats = fx.materials().map((m) => ({ ...m, itemLabel: '싱크대', module: /상부장/.test(m.module) ? '#2 후드장 800' : '#1 개수대 1000', moduleKey: /상부장/.test(m.module) ? 'm2' : 'm1' }));
  // 경첩 행도 플래너처럼 모듈 키로 짝을 짓는다
  const hardware = fx.hardware().map((h) => (h.category === '경첩' ? { ...h, moduleKey: /후드장/.test(h.note) ? 'm2' : 'm1' } : h));
  const snapshot = snapshotWith(null, { bom_payload: { materials: mats }, hardware_payload: { hardware } });
  const inside = [{ item_index: 0, item_unique_id: 1757900000123, path: 'D1/1/inside.svg', view: { w: 900, h: 400 }, boxes: [{ nos: [1], x: 90, y: 100, w: 300, h: 240 }] }];
  const urls = new Map([['D1/1/inside.svg', 'https://x.supabase.co/sign/inside.svg?token=T']]);
  const html = renderWorkOrder(docWith({ drawing_version: 1, inside_renders: inside }), snapshot, { toolbar: false, pack: 'assembly', renderUrls: urls });
  // 모듈 1 — 자리만 잘라 보인다 (폭 = 그림 ÷ 상자, 여백 = 상자 자리 ÷ 상자 폭)
  assert.match(html, /class="mc-inside" style="aspect-ratio:1\.2500;width:min\(100%, 87\.5mm\)"><img src="https:\/\/x\.supabase\.co\/sign\/inside\.svg\?token=T" alt="싱크대 1 속 구조" style="width:300\.000%;margin-left:-30\.000%;margin-top:-33\.333%">/);
  assert.equal(html.split('class="mc-inside"').length - 1, 1, '상자 자리가 없는 모듈 2 는 치수도만');
  // 도어 앞모습 — 모듈마다 그 모듈의 도어, 경첩 컵 수
  assert.equal(html.split('class="mc-door"').length - 1, 2);
  assert.match(strip(html), /도어 × 2 · 컵 3구/);
  assert.match(html, /\.module-card \.mc-inside\{overflow:hidden/);
  assert.match(strip(html), /속 구조 = 플래너 도면 · 도어 = 굵은 변 엣지/);
  // 그림이 없으면 까닭 한 줄
  assert.match(strip(renderWorkOrder(docWith({ drawing_version: 1 }), snapshot, { toolbar: false, pack: 'assembly' })), /싱크대 속 구조 정면도 없음 — 플래너에서 다시 보내고 지시서를 다시 내 주세요/);
  assert.match(strip(renderWorkOrder(docWith({ drawing_version: 1, inside_renders: [{ item_index: 0, path: null, stale: true }] }), snapshot, { toolbar: false, pack: 'assembly' })), /싱크대 속 구조 정면도 — 이 설계 판의 그림이 아님/);
  assert.match(strip(renderWorkOrder(docWith({ drawing_version: 1, inside_renders: inside }), snapshot, { toolbar: false, pack: 'assembly' })), /싱크대 속 구조 정면도 — 그림을 불러올 수 없음/);
  // 옛 문서 — 카드가 그대로 · 플래너에서 오지 않은 설계 — 번호를 짐작하지 않는다 (도어 앞모습 없음 · 까닭 글 없음)
  const old = renderWorkOrder(docWith({ inside_renders: inside }), snapshot, { toolbar: false, pack: 'assembly', renderUrls: urls });
  assert.doesNotMatch(old, /mc-inside|mc-door|속 구조/);
  const app = renderWorkOrder(docWith({ drawing_version: 1 }), fx.snapshot({ bom_payload: { materials: mats } }), { toolbar: false, pack: 'assembly' });
  assert.doesNotMatch(app, /class="mc-door"|속 구조 정면도 없음/);
});
