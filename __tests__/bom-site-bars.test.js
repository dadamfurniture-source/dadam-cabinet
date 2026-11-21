/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-11-21 사장님: 목찬넬 100 막대(40 + 52 + 여유, 엣지 뒤 공장에서 켬) · 중간 목찬넬 120 · 목찬넬 · 걸레받이 · 상몰딩은 현장 재단 막대 (2440),
 * 레일 품명 = 회사 + 종류 (기본 문주) · 플래너에서 고른 카탈로그 레일 (railItem).
 */
const B = require('../js/detaildesign/bom-site-bar-rules.js');
const DR = require('../js/detaildesign/bom-drawer-rules.js');
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const { loadExtractors } = require('../test-utils/bom-golden/golden');

const ex = loadExtractors();
const barsOf = (key) => B.siteBarsOf(new ex.MaterialExtractor().extract(designOf(FIXTURES[key])).materials);
const short = (b) => [b.part, b.w, b.h, b.qty, b.edge, b.edgeLen];

describe('현장 재단 막대 (bom-site-bar-rules siteBarsOf)', () => {
  test('막대 폭 — 목찬넬 100 · 중간 120 (CHANNEL_BAR_W), 길이 2440', () => {
    expect(DR.DRAWER_RULES.CHANNEL_BAR_W).toEqual({ top: 100, mid: 120 });
    expect(B.SITE_BAR_RULES.LEN).toBe(2440);
  });

  test('싱크 15T — 조각 행이 막대로: 목찬넬 100 × 2 · 걸레받이 145 × 2 · 상몰딩 60 × 2 · 중간 목찬넬 120 × 1, 엣지 2면(장)', () => {
    const r = barsOf('sink15');
    expect(r.bars.map(short)).toEqual([
      ['중간 목찬넬 막대', 120, 2440, 1, '2면(장)', 4880],
      ['상몰딩', 60, 2440, 2, '2면(장)', 4880],
      ['걸레받이', 145, 2440, 2, '2면(장)', 4880],
      ['목찬넬 막대', 100, 2440, 2, '2면(장)', 4880],
    ]);
    // 지면 40 행도 막대로 들어가 BOM 에 남지 않는다 (전면과 한 막대에서 켠다)
    expect(r.rows.filter((x) => !x.siteBar && /^목찬넬\(|^걸레받이$|^상몰딩$/.test(x.part))).toEqual([]);
    expect(r.pieces.map((x) => x.part)).toContain('목찬넬(지면)');
    const ch = r.bars.find((b) => b.part === '목찬넬 막대');
    expect(ch.note).toMatch(/엣지 뒤 공장에서 전면 52 · 지면 40 으로 켬/);
    expect(ch.siteBar.layout).toEqual([[1800], [1700]]);
  });

  test('조각은 2440 에 큰 것부터 채운다 (톱날 4) — 1800 + 600 은 한 막대', () => {
    expect(B.packBars([600, 1800], 2440, 4).bars).toEqual([[1800, 600]]);
    expect(B.packBars([1800, 640], 2440, 4).bars).toEqual([[1800], [640]]);
    expect(B.packBars([2440, 2440], 2440, 4).bars).toEqual([[2440], [2440]]);
    expect(B.packBars([2500], 2440, 4)).toEqual({ bars: [], over: [2500] });
  });

  test('모듈 안 것도 막대 — 키큰장 단 목찬넬 · 좌대 걸레받이 · 상몰딩 (storage)', () => {
    const r = barsOf('storage');
    expect(r.bars.map(short)).toEqual([
      ['목찬넬 막대', 100, 2440, 1, '2면(장)', 4880],
      ['좌대 걸레받이', 60, 2440, 1, '2면(장)', 4880],
      ['상몰딩', 60, 2440, 1, '2면(장)', 4880],
      ['걸레받이', 145, 2440, 1, '2면(장)', 4880],
    ]);
  });

  test('막대 길이 = 원장 2440 − 여백 × 2 (opts.barLen) — 재단 배치의 원장 쓸 자리에 든다, 넘는 조각은 [확인 필요]', () => {
    const rows = [{ part: '상몰딩', material: 'MDF', thickness: 18, w: 60, h: 2400, qty: 1 }, { part: '상몰딩', material: 'MDF', thickness: 18, w: 60, h: 2430, qty: 1 }];
    const r = B.siteBarsOf(rows, { barLen: 2420, kerf: 3.6 });
    expect([r.bars[0].h, r.bars[0].qty, r.bars[0].edgeLen, r.bars[0].siteBar.barLen, r.bars[0].siteBar.kerf]).toEqual([2420, 2, 4840, 2420, 3.6]);
    expect(r.bars[0].note).toMatch(/\[확인 필요\] 2420 보다 긴 조각 2430/);
  });

  test('색이 다르면 다른 막대', () => {
    const row = (color) => ({ part: '상몰딩', material: 'MDF', thickness: 18, w: 60, h: 1000, qty: 1, color });
    expect(B.siteBarsOf([row('A'), row('A'), row('B')]).bars.map((b) => [b.color, b.qty, b.siteBar.layout])).toEqual([
      ['A', 1, [[1000, 1000]]], ['B', 1, [[1000]]],
    ]);
  });

  test('막대가 아닌 행은 그대로 (자리 · 순서)', () => {
    const rows = [{ part: '측판', material: 'PB', thickness: 15, w: 550, h: 720, qty: 2 }, { part: '도어', material: 'MDF', thickness: 18, w: 400, h: 690, qty: 1 }];
    expect(B.siteBarsOf(rows)).toEqual({ rows, pieces: [], bars: [] });
  });
});

describe('레일 품명 — 회사 + 종류 (bom-drawer-rules railHardwareOf)', () => {
  test('기본 문주 · 고른 카탈로그 레일은 종류가 같을 때만', () => {
    expect(DR.railHardwareOf('under')).toEqual({ item: '문주 댐핑 언더레일', manufacturer: '문주' });
    expect(DR.railHardwareOf('ball')).toEqual({ item: '문주 댐핑 볼레일', manufacturer: '문주' });
    expect(DR.railHardwareOf('ball', { brand: '블룸', name: '탄뎀 볼레일', type: 'ball' })).toEqual({ item: '블룸 탄뎀 볼레일', manufacturer: '블룸' });
    expect(DR.railHardwareOf('ball', { brand: '블룸', name: '블룸 탄뎀', type: 'ball' }).item).toBe('블룸 탄뎀');
    expect(DR.railHardwareOf('under', { brand: '블룸', name: '탄뎀', type: 'ball' }).item).toBe('문주 댐핑 언더레일');
  });

  test('싱크 서랍장 · 속서랍 · 단순장 레일이 모두 「문주 댐핑 언더레일」 한 이름 (예전 댐핑 언더레일 · 문주 언더레일 · 소프트클로즈)', () => {
    ['sink15', 'storage', 'wardrobe'].forEach((k) => {
      const hw = new ex.HardwareExtractor().extract(designOf(FIXTURES[k])).hardware.filter((h) => h.category === '레일');
      expect(hw.length).toBeGreaterThan(0);
      hw.forEach((h) => expect(['문주 댐핑 언더레일', '문주 댐핑 볼레일']).toContain(h.item));
      hw.forEach((h) => expect(h.manufacturer).toBe('문주'));
    });
  });

  test('서랍장 모듈의 railItem — 품명 · 회사 · 종류(박스 여유)가 고른 레일을 따른다', () => {
    const design = designOf(FIXTURES.sink15);
    const mod = design.items[0].modules.find((m) => m.isDrawer);
    mod.drawer = Object.assign({}, mod.drawer, { railItem: { brand: '블룸', name: '탄뎀 볼레일', type: 'ball' } });
    const hw = new ex.HardwareExtractor().extract(design).hardware.filter((h) => h.category === '레일' && h.moduleKey === `0-${mod.id}`);
    expect(hw.map((h) => [h.item, h.manufacturer, h.railType])).toEqual([['블룸 탄뎀 볼레일', '블룸', 'ball']]);
    const side = new ex.MaterialExtractor().extract(design).materials.find((r) => r.moduleKey === `0-${mod.id}` && r.part === '서랍측판');
    expect(side.note).toMatch(/댐핑 볼레일/);
  });
});
