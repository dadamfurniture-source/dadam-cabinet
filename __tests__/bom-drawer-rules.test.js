/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global, __dirname */
/**
 * 2026-09-15: 서랍장·목찬넬·레일 규칙 (js/detaildesign/bom-drawer-rules.js) 와 BOM 적용 (extractors.js).
 *
 * 기대값은 도면 "서랍장 목찬넬 구조 도면" (몸통 758, 균등 배분) 과 같다 — 도면과 코드가 같은 숫자를 낸다.
 *   · 중간 따내기 90×40 = 전면판 72 + 지면판 18, 위 전면 20 내려옴, 슬롯 30
 *   · 목찬넬 최소 수: 상단 1 + 중간 (2단 1 · 3단 1 · 4단 2)
 *   · 박스 소 60 · 중 120 · 대 180, 레일 여유 언더 +40 (30/10) · 볼 +20 (10/10)
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { DRAWER_RULES, layoutDrawerModule, assignChannels, pickBox } = require(path.join(ROOT, 'js/detaildesign/bom-drawer-rules.js'));

const drawers = (n) => Array.from({ length: n }, () => ({ kind: 'drawer' }));
const lay = (n, rail = 'under', H = 758) => layoutDrawerModule({ H, T: 15, fronts: drawers(n), rail });

describe('목찬넬 최소 배치', () => {
  test('상단은 항상, 중간은 아래에서 위로 짝지어 최소 수', () => {
    expect(assignChannels(1)).toEqual([]);
    expect(assignChannels(2)).toEqual([true]);
    expect(assignChannels(3)).toEqual([false, true]);
    expect(assignChannels(4)).toEqual([true, false, true]);
  });

  test('단수별 목찬넬 수 1 · 2 · 2 · 3 (상단 포함)', () => {
    expect([1, 2, 3, 4].map((n) => lay(n).channels.length)).toEqual([1, 2, 2, 3]);
  });

  test('중간 따내기는 90×40, 전면판 72 · 상단은 70×40, 전면판 52', () => {
    const L = lay(2);
    expect(L.channels[0]).toMatchObject({ kind: 'top', y: 0, notchH: 70, notchD: 40, faceH: 52, baseW: 40 });
    expect(L.channels[1]).toMatchObject({ kind: 'mid', notchH: 90, notchD: 40, faceH: 72, baseW: 40 });
    expect(DRAWER_RULES.CHANNEL_MID_NOTCH_H).toBe(DRAWER_RULES.CHANNEL_MID_FACE_H + DRAWER_RULES.CHANNEL_T);
    expect(DRAWER_RULES.CHANNEL_TOP_NOTCH_H).toBe(DRAWER_RULES.CHANNEL_TOP_FACE_H + DRAWER_RULES.CHANNEL_T);
  });

  test('위 전면은 중간 따내기 윗선보다 20 내려오고, 아래 전면은 그 30 아래에서 시작한다', () => {
    const L = lay(2);
    const mid = L.channels[1];
    expect(L.fronts[0].y1).toBe(mid.y + DRAWER_RULES.UPPER_DROP);
    expect(L.fronts[1].y0).toBe(mid.y + DRAWER_RULES.UPPER_DROP + DRAWER_RULES.MID_SLOT);
  });
});

describe('전면 높이 · 존 · 박스 (도면과 같은 숫자)', () => {
  test('균등 배분 전면: 728 · 349/349 · 231/231/232 · 166×4, 합이 몸통을 닫는다', () => {
    const fronts = (n) => lay(n).fronts.map((f) => f.h);
    expect(fronts(1)).toEqual([728]);
    expect(fronts(2)).toEqual([349, 349]);
    expect(fronts(3)).toEqual([231, 231, 232]);
    expect(fronts(4)).toEqual([166, 166, 166, 166]);
    [1, 2, 3, 4].forEach((n) => {
      const L = lay(n);
      const last = L.fronts[L.fronts.length - 1];
      expect(last.y1).toBe(758);
    });
  });

  test('존 높이: 673 · 289/294 · 193/213/177 · 106/128/148/111', () => {
    const zones = (n) => lay(n).fronts.map((f) => f.zone.h);
    expect(zones(1)).toEqual([673]);
    expect(zones(2)).toEqual([289, 294]);
    expect(zones(3)).toEqual([193, 213, 177]);
    expect(zones(4)).toEqual([106, 128, 148, 111]);
  });

  test('언더레일(+40) 박스: 대 · 대대 · 중중중 · 소소소소', () => {
    const boxes = (n) => lay(n, 'under').boxes.map((b) => b.h);
    expect(boxes(1)).toEqual([180]);
    expect(boxes(2)).toEqual([180, 180]);
    expect(boxes(3)).toEqual([120, 120, 120]);
    expect(boxes(4)).toEqual([60, 60, 60, 60]);
  });

  test('볼레일(+20) 박스: 3단 가운데가 대, 4단 셋째가 중', () => {
    expect(lay(3, 'ball').boxes.map((b) => b.h)).toEqual([120, 180, 120]);
    expect(lay(4, 'ball').boxes.map((b) => b.h)).toEqual([60, 60, 120, 60]);
  });

  test('pickBox 는 존에 박스+여유가 들어가는 가장 큰 것, 없으면 소 + fits:false', () => {
    expect(pickBox(220, 'under')).toMatchObject({ size: 'large', fits: true });
    expect(pickBox(219, 'under')).toMatchObject({ size: 'medium', fits: true });
    expect(pickBox(200, 'ball')).toMatchObject({ size: 'large', fits: true });
    expect(pickBox(99, 'under')).toMatchObject({ size: 'small', fits: false });
    expect(pickBox(100, 'under')).toMatchObject({ size: 'small', fits: true });
  });

  test('모르는 레일 값은 기본(언더레일)', () => {
    expect(layoutDrawerModule({ H: 758, T: 15, fronts: drawers(1), rail: 'x' }).rail).toBe('under');
  });
});

describe('도어 + 하부 서랍 (플래너 doorTopDrawerBottom 기본형)', () => {
  test('도어가 남는 높이를 갖고, 도어–서랍 사이에 중간 목찬넬 하나', () => {
    const L = layoutDrawerModule({ H: 758, T: 15, fronts: [{ kind: 'door' }, { kind: 'drawer', h: 200 }], rail: 'under' });
    expect(L.fronts.map((f) => [f.kind, f.h])).toEqual([['door', 498], ['drawer', 200]]);
    expect(L.midCount).toBe(1);
    // 존 = 중간 따내기 바닥(S+90) ~ 지판 윗면(743): S = 528−20 = 508 → 598..743 = 145 → 언더 소 / 볼 중
    expect(L.fronts[1].zone).toEqual({ top: 598, bottom: 743, h: 145 });
    expect(L.boxes[0]).toMatchObject({ size: 'small', h: 60, fits: true });
    const B = layoutDrawerModule({ H: 758, T: 15, fronts: [{ kind: 'door' }, { kind: 'drawer', h: 200 }], rail: 'ball' });
    expect(B.boxes[0]).toMatchObject({ size: 'medium', h: 120 });
  });

  test('서랍이 4단을 넘으면 4단으로 자르고 경고한다', () => {
    const L = lay(6);
    expect(L.fronts).toHaveLength(4);
    expect(L.warnings.some((w) => /최대 4단/.test(w))).toBe(true);
  });

  test('고정 전면이 몸통을 넘치면 경고한다', () => {
    const L = layoutDrawerModule({ H: 758, T: 15, fronts: [{ kind: 'door' }, ...Array.from({ length: 4 }, () => ({ kind: 'drawer', h: 200 }))] });
    expect(L.warnings.some((w) => /부족/.test(w))).toBe(true);
  });
});

describe('BOM 적용 (extractors.js)', () => {
  global.dlog = () => {};
  const { MaterialExtractor, HardwareExtractor, BOM_PART_DEFS } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
  const specs = {
    layoutShape: 'I', bodyThickness: 15, lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15, handle: '찬넬 (목찬넬)', topSizes: [{ w: '2400', d: '650' }],
  };
  const itemOf = (modules) => ({ uniqueId: 1, categoryId: 'sink', name: '싱크대', w: 2400, h: 2310, d: 650, specs, modules });
  const rowsOf = (modules, label) => new MaterialExtractor().extract({ items: [itemOf(modules)] }).materials.filter((m) => m.module === label);

  test('도어 1 + 서랍 2단 (W800·H708): 전면 3장, 박스 중·소, 중간 목찬넬 1, 하단보강', () => {
    const rows = rowsOf([{ id: 'l2', type: 'storage', name: '서랍장', pos: 'lower', w: 800, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 2 }], '하부장-서랍장');
    const pick = (part) => rows.filter((r) => r.part === part).map((r) => [r.w, r.h, r.qty]);
    // 전면: 도어 244 (708 − 30 − 200 − 30 − 200 − 4), 서랍도어 200 × 2 → 합 = 몸통
    expect(pick('도어')).toEqual([[796, 244, 1]]);
    expect(pick('서랍도어')).toEqual([[796, 200, 2]]); // 같은 높이는 한 행
    expect(30 + 244 + 4 + 200 + 30 + 200).toBe(708);
    // 박스: 서랍 1 은 존 (경계~중간 따내기 윗선) 중 120, 서랍 2 는 존 (따내기 바닥~지판) 소 60
    expect(pick('서랍전후판')).toEqual([[728, 120, 2], [728, 60, 2]]);
    expect(pick('서랍측판')).toEqual([[440, 120, 2], [440, 60, 2]]);
    expect(pick('서랍밑판')).toEqual([[757, 449, 2]]);
    expect(pick('서랍 하단보강')).toEqual([[440, 60, 2]]);
    // 중간 목찬넬 (서랍 1–2 사이) — 전면판 72 · 지면판 40, 모듈 폭
    expect(pick('목찬넬(중간 전면)')).toEqual([[72, 800, 1]]);
    expect(pick('목찬넬(중간 지면)')).toEqual([[40, 800, 1]]);
    expect(rows.some((r) => r.part === '목찬넬')).toBe(false);
    // 측판 비고에 따내기 가공
    expect(rows.find((r) => r.part === '측판').note).toBe('목찬넬 따내기 상단 70×40 + 중간 90×40 ×1');
  });

  test('서랍만 4단 (doorCount 0): 서랍도어 4, 중간 목찬넬 2, 소 박스 8장', () => {
    const rows = rowsOf([{ id: 'l3', type: 'storage', name: '서랍장4', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 0, isDrawer: true, drawerCount: 4 }], '하부장-서랍장4');
    expect(rows.filter((r) => r.part === '서랍도어').reduce((n, r) => n + r.qty, 0)).toBe(4);
    expect(rows.some((r) => r.part === '도어')).toBe(false);
    expect(rows.find((r) => r.part === '목찬넬(중간 전면)').qty).toBe(2);
    expect(rows.find((r) => r.part === '서랍전후판')).toMatchObject({ h: 60, qty: 8 });
    expect(rows.find((r) => r.part === '측판').note).toMatch(/중간 90×40 ×2/);
  });

  test('drawerFronts 로 전면 높이를 지정하면 그대로 쓴다', () => {
    const rows = rowsOf([{ id: 'l4', type: 'storage', name: '서랍장F', pos: 'lower', w: 600, h: 758, d: 550, doorCount: 0, isDrawer: true, drawerCount: 2, drawerFronts: [241, 483] }], '하부장-서랍장F');
    expect(rows.filter((r) => r.part === '서랍도어').map((r) => r.h)).toEqual([241, 483]);
  });

  test('중간 목찬넬 부재는 손잡이 슬롯으로 식별된다', () => {
    expect(BOM_PART_DEFS['목찬넬(중간 전면)']).toEqual({ key: 'channel:mid-front', slot: 'handle' });
    expect(BOM_PART_DEFS['목찬넬(중간 지면)']).toEqual({ key: 'channel:mid-back', slot: 'handle' });
  });

  test('레일: 단수만큼, 종류는 drawerRail (기본 댐핑 언더레일 · ball → 댐핑 볼레일), 길이는 깊이별', () => {
    const hw = new HardwareExtractor().extract({ items: [itemOf([
      { id: 'a', type: 'storage', name: 'A', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 3 },
      { id: 'b', type: 'storage', name: 'B', pos: 'lower', w: 600, h: 708, d: 450, doorCount: 0, isDrawer: true, drawerCount: 2, drawerRail: 'ball' },
      { id: 'c', type: 'storage', name: 'C', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 7 },
    ])] }).hardware.filter((h) => h.category === '레일');
    expect(hw.map((h) => [h.item, h.spec, h.qty, h.note])).toEqual([
      ['댐핑 언더레일', '500mm', 3, 'A'],
      ['댐핑 볼레일', '450mm', 2, 'B'],
      ['댐핑 언더레일', '500mm', 4, 'C'],
    ]);
  });
});
