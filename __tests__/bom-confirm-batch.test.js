/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global */
/**
 * 2026-10-13 사장님 결정 (확인표 남은 항목).
 *   경첩      여닫이 도어 폭 600 초과면 +1 (보링 끝 110 확정)
 *   선반 핀   자재 선반 수 × 4
 *   걸레받이카바  한 개 2400mm, 걸레받이 전체 길이 ÷ 2400 올림
 *   서랍 밑판  우라 3T
 *   신발장 선반 간격  150~300 — 플래너와 BOM 이 같은 수
 */
const fs = require('fs');
const path = require('path');
global.dlog = global.dlog || (() => {});
const X = require('../js/detaildesign/extractors.js');
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');

const sinkWith = (mods, specs) => ({
  items: [{ categoryId: 'sink', w: 3000, h: 2310, d: 650, specs: Object.assign({ bodyThickness: 15, sinkLegHeight: 150, topThickness: 12, handle: '찬넬 (목찬넬)' }, specs || {}), modules: mods }],
});
const hw = (design) => new X.HardwareExtractor().extract(design).hardware;
const mats = (design) => new X.MaterialExtractor().extract(design).materials;

describe('경첩 — 여닫이 도어 폭 600 초과면 +1', () => {
  test('폭 650 단문 상부장: 높이로 2구 + 1 = 3구, 보링 끝 110', () => {
    const rows = hw(sinkWith([{ id: 'u', type: 'storage', name: '상부장', pos: 'upper', w: 654, h: 720, d: 320, doorCount: 1 }]));
    const h = rows.find((r) => r.category === '경첩');
    expect(h).toMatchObject({ spec: '3구', qty: 3 });
    expect(h.note).toMatch(/보링: 110, 368, 625/);
  });
  test('폭 600 이하는 예전 그대로', () => {
    const rows = hw(sinkWith([{ id: 'u', type: 'storage', name: '상부장', pos: 'upper', w: 600, h: 720, d: 320, doorCount: 1 }]));
    expect(rows.find((r) => r.category === '경첩')).toMatchObject({ spec: '2구', qty: 2 });
  });
});

describe('선반 핀 = 자재 선반 수 × 4', () => {
  test.each(['sink15', 'shoerack', 'storage', 'warehouse', 'wardrobe', 'fridge'])('%s', (name) => {
    const d = designOf(FIXTURES[name]);
    const shelves = mats(d).filter((r) => r.part === '선반').reduce((n, r) => n + r.qty, 0);
    const br = hw(d).find((r) => r.category === '브라켓');
    if (shelves === 0) expect(br).toBeUndefined();
    else expect(br.qty).toBe(shelves * 4);
  });
});

describe('걸레받이카바 — 걸레받이 전체 길이 ÷ 2400 올림', () => {
  test.each(['sink15', 'shoerack', 'storage', 'wardrobe'])('%s', (name) => {
    const d = designOf(FIXTURES[name]);
    const len = mats(d).filter((r) => r.part === '걸레받이' || r.part === '좌대 걸레받이')
      .reduce((n, r) => n + Math.max(r.w, r.h) * r.qty, 0);
    const cover = hw(d).find((r) => r.category === '걸레받이카바');
    expect(cover).toMatchObject({ item: '걸레받이카바(18T) 투명', spec: '2400mm', qty: Math.ceil(len / 2400) });
  });
  test('걸레받이가 없으면 안 낸다 (냉장고장)', () => {
    expect(hw(designOf(FIXTURES.fridge)).find((r) => r.category === '걸레받이카바')).toBeUndefined();
  });
});

describe('서랍 밑판 — 우라 3T', () => {
  test.each(['sink15', 'shoerack', 'vanity', 'storage'])('%s', (name) => {
    const bottoms = mats(designOf(FIXTURES[name])).filter((r) => r.part === '서랍밑판');
    expect(bottoms.length).toBeGreaterThan(0);
    bottoms.forEach((r) => expect(r.thickness).toBe(3));
  });
});

describe('신발장 선반 간격 150~300 — 플래너와 BOM 이 같다', () => {
  test('planner-engine.js MASTER_RULES 와 BOM 규칙표가 같은 수', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'planner', 'planner-engine.js'), 'utf8');
    const min = Number((src.match(/SHELF_SPACE_MIN_SHOE:\s*(\d+)/) || [])[1]);
    const max = Number((src.match(/SHELF_SPACE_MAX_SHOE:\s*(\d+)/) || [])[1]);
    expect({ min, max }).toEqual({ min: 150, max: 300 });
    expect(X.BOM_SIMPLE_CATEGORY_RULES.shoerack.shelfSpace).toEqual({ min, max });
  });
});
