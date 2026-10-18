/**
 * PR 4 (B4) — 경첩 보링 구조화 · 철물 모듈 키. 실제 BOM 추출기(js/detaildesign/extractors.js)를 BOM 골든 픽스처로 돌려
 * 경첩 행 ↔ 도어 자재 행이 **모듈 키로** 정확히 맞물리는지 본다 (이름이 같은 "하부장" 여럿이어도 섞이지 않게).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { doorRowsForHinge, parseBoringNote, doorHeightFromBoring, partIdOf } from '../src/work-order-data.js';
import { boringRows, groupByItemModule, renderWorkOrder, isMaidaRow } from '../src/templates/work-order.js';
import * as fx from './fixtures/work-order-v2.js';

const require = createRequire(import.meta.url);
if (typeof globalThis.dlog !== 'function') globalThis.dlog = () => {};
const { MaterialExtractor, HardwareExtractor } = require('../../../js/detaildesign/extractors.js');
const { FIXTURES, designOf } = require('../../../test-utils/bom-golden/fixtures.js');

function bomOf(name) {
  const design = designOf(FIXTURES[name]);
  return {
    materials: new MaterialExtractor().extract(design).materials,
    hardware: new HardwareExtractor().extract(design).hardware,
  };
}

const NAMES = Object.keys(FIXTURES);

test('경첩 행 — 구조화 boring 이 비고의 보링과 같고, 모듈 이름·키가 있다', () => {
  let hinges = 0;
  for (const name of NAMES) {
    for (const h of bomOf(name).hardware.filter((x) => x.category === '경첩')) {
      hinges++;
      assert.ok(Array.isArray(h.boring) && h.boring.length >= 2, `${name} ${h.note}`);
      const fromNote = h.note.match(/보링:\s*([^)]*)\)/)[1].split(',').map((v) => Number(v.trim()));
      assert.deepEqual(h.boring, fromNote, `${name} ${h.note}`);
      assert.equal(typeof h.module, 'string');
      assert.deepEqual(parseBoringNote(h).positions, h.boring, '파서는 구조화 값을 먼저 읽는다');
    }
  }
  assert.ok(hinges > 10, `경첩 행 ${hinges}`);
});

test('경첩 ↔ 도어 — 모듈 키가 있으면 키로만 맞고, 도어 높이가 보링 끝(110 · H−110)과 같다', () => {
  let matched = 0;
  for (const name of NAMES) {
    const { materials, hardware } = bomOf(name);
    for (const h of hardware.filter((x) => x.category === '경첩' && x.moduleKey && x.boringSide !== 'top')) {
      const doors = doorRowsForHinge(materials, h);
      assert.ok(doors.length >= 1, `${name}: ${h.moduleKey} 도어 행 없음`);
      for (const { row } of doors) {
        assert.equal(row.moduleKey, h.moduleKey);
        assert.equal(row.h, doorHeightFromBoring(h.boring), `${name} ${row.partId} 도어 H`);
        matched++;
      }
    }
  }
  assert.ok(matched > 10, `맞은 도어 행 ${matched}`);
});

test('이름이 같은 모듈 — 이름으로 맞추면 섞이고, 키로 맞추면 제 도어만', () => {
  // 하부장 두 칸이 같은 이름 '하부장' (플래너 칸은 늘 이렇게 이름이 겹친다)
  const mats = [
    { part: '도어', slot: 'door', module: '하부장-하부장', moduleKey: '0-a', h: 678, qty: 2, itemLabel: '싱크대' },
    { part: '도어', slot: 'door', module: '하부장-하부장', moduleKey: '0-b', h: 400, qty: 1, itemLabel: '싱크대' },
  ];
  const hinge = { category: '경첩', module: '하부장', moduleKey: '0-b', boring: [110, 290], note: '하부장 (보링: 110, 290)', itemLabel: '싱크대' };
  assert.deepEqual(doorRowsForHinge(mats, hinge).map(({ row }) => row.moduleKey), ['0-b']);
  const legacy = { ...hinge, moduleKey: undefined, boring: undefined };
  assert.equal(doorRowsForHinge(mats.map(({ moduleKey, ...r }) => r), legacy).length, 2, '키가 없으면 이름으로 — 두 모듈이 섞인다');
});

test('서랍장 = 마이다 — 서랍장 모듈은 맨 위 칸 전면까지 경첩·보링이 없고, 발주서에 "마이다 — 보링 없음"', () => {
  // 2026-10-18 사장님: "서랍 도어는 마이다라고 해서 보링을 하지 않음" · 서랍장 전면은 전부 마이다
  const { materials, hardware } = bomOf('sink15');
  const drawerKeys = new Set(materials.filter((m) => m.slot === 'drawerFront').map((m) => m.moduleKey));
  assert.ok(drawerKeys.size > 0);
  assert.ok(hardware.filter((h) => h.category === '경첩').every((h) => !drawerKeys.has(h.moduleKey)), '서랍장 모듈에 경첩 없음');
  const topFront = materials.find((m) => m.slot === 'door' && drawerKeys.has(m.moduleKey));
  assert.equal(topFront.h, 244, '서랍 2단 위 244 전면 — 예전엔 [110, 568] 로 보링했다');
  assert.equal(isMaidaRow(materials, topFront), true);
  assert.equal(isMaidaRow(materials, materials.find((m) => m.slot === 'drawerFront')), true);
  assert.equal(isMaidaRow(materials, materials.find((m) => m.slot === 'door' && !drawerKeys.has(m.moduleKey))), false);

  const mats = materials.map((m) => ({ ...m, itemLabel: '싱크대' }));
  const hw = hardware.map((h) => ({ ...h, itemLabel: '싱크대' }));
  const snap = fx.snapshot({ bom_payload: { materials: mats }, hardware_payload: { hardware: hw }, cut_plan_payload: null });
  const html = renderWorkOrder(fx.doc({ render_payload: { ...fx.doc().render_payload, cut_plan: null } }), snap, { toolbar: false, pack: 'door' });
  assert.ok(html.includes('마이다 — 보링 없음'));
  assert.ok(!html.includes('확인 필요'));
});

test('짧은 여닫이 도어 — 컵 간격이 100 미만이면 경첩 비고의 [확인 필요] 가 발주서에 보인다', () => {
  const mats = [{ part: '도어', slot: 'door', module: '상부장-작은장', moduleKey: '0-s', w: 400, h: 250, qty: 1, itemLabel: '싱크대' }];
  const hinge = { category: '경첩', module: '작은장', moduleKey: '0-s', boring: [110, 140], qty: 2, note: '작은장 (보링: 110, 140) [확인 필요] 도어 H 250 — 컵 간격 30', itemLabel: '싱크대' };
  const rows = boringRows(mats, [hinge]);
  assert.equal(rows[0].warn, '[확인 필요] 도어 H 250 — 컵 간격 30');
});

test('레일 행에도 모듈 키 — 키팅에서 "기타 철물" 로 내려가지 않는다', () => {
  const { materials, hardware } = bomOf('sink15');
  const rails = hardware.filter((h) => h.category === '레일');
  assert.ok(rails.length > 0);
  assert.ok(rails.every((r) => r.moduleKey && r.module));
  const keys = new Set(materials.map((m) => m.moduleKey));
  assert.ok(rails.every((r) => keys.has(r.moduleKey)), '레일의 모듈 키가 자재 행에 있다');
  const groups = groupByItemModule(materials);
  assert.ok(groups[0].modules.every((g) => g.moduleKey), '키로 묶는다');
});

test('작업지시서 — 실제 BOM 으로 도어재 발주서의 모든 여닫이 도어(마이다 제외)에 컵 위치가 붙는다', () => {
  const { materials, hardware } = bomOf('sink15');
  const itemLabel = '싱크대';
  const mats = materials.map((m) => ({ ...m, itemLabel: m.itemLabel || itemLabel }));
  const hw = hardware.map((h) => ({ ...h, itemLabel: h.itemLabel || itemLabel }));
  const rows = boringRows(mats, hw);
  const doorIds = new Set(mats.map((m, i) => [m, i]).filter(([m]) => m.slot === 'door' && !isMaidaRow(mats, m)).map(([m, i]) => partIdOf(m, i)));
  const withBoring = new Set(rows.filter((r) => r.partId).map((r) => r.partId));
  for (const id of doorIds) assert.ok(withBoring.has(id), `${id} 컵 위치 없음`);
  assert.ok(rows.every((r) => r.partId), '도어 행을 못 찾은 경첩 없음');

  const snap = fx.snapshot({ bom_payload: { materials: mats }, hardware_payload: { hardware: hw }, cut_plan_payload: null });
  const html = renderWorkOrder(fx.doc({ render_payload: { ...fx.doc().render_payload, cut_plan: null } }), snap, { toolbar: false, pack: 'door' });
  assert.ok(!html.includes('도어 행을 못 찾은 경첩'));
  assert.ok(html.includes('구 · 110, '));
});

test('모든 BOM 골든 설계 — 여닫이 도어 행마다(마이다 제외) 경첩 컵 위치가 있고, 마이다에는 없다', () => {
  const missing = [];
  for (const name of NAMES) {
    const { materials, hardware } = bomOf(name);
    const rows = boringRows(materials, hardware);
    const covered = new Set(rows.filter((r) => r.partId).map((r) => r.partId));
    // 제 철물(리프트업·슬라이딩)을 내는 모듈의 도어는 경첩이 없다
    const special = new Set(hardware.filter((h) => ['리프트업', '슬라이딩'].includes(h.category)).map((h) => h.moduleKey));
    materials.forEach((m, i) => {
      if (m.slot !== 'door' || special.has(m.moduleKey)) return;
      const id = partIdOf(m, i);
      if (isMaidaRow(materials, m)) {
        if (covered.has(id)) missing.push(`${name} ${id} 마이다인데 보링이 있다`);
        return;
      }
      if (!covered.has(id)) missing.push(`${name} ${id} (${m.module} ${m.w}×${m.h})`);
    });
  }
  assert.deepEqual(missing, []);
});
