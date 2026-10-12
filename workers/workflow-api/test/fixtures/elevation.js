/**
 * 치수 정면도 시험 픽스처 — 플래너 브리지(ui-step1.js _convertPlannerModules)가 내는 모양의 표준 3종.
 *   sink3000      싱크대 일자 3m — 하부 4통(서랍장·개수대·일반·2도어) + 상부 4통(후드장 포함)
 *   wardrobe3600  붙박이장 3600×2310 — 900 네 통 (좌대 60 · 상몰딩 20)
 *   fridge        냉장고장 — 냉장고 자리 틈 + 키큰장 + 냉장고 위 상부장
 */

const lower = (id, x, w, extra = {}) => ({
  id: `planner-${id}`, type: 'storage', name: '하부장', pos: 'lower', w, h: 688, totalH: 850,
  heightParts: { legH: 150, topT: 12 }, d: 580, doorCount: w >= 800 ? 2 : 1, is2door: w >= 800,
  isDrawer: false, drawerCount: 0, isOpen: false, shelfCount: 1, _x: x, ...extra,
});

const upper = (id, x, w, extra = {}) => ({
  id: `planner-${id}`, type: 'storage', name: '상부장', pos: 'upper', w, h: 720, totalH: 780,
  heightParts: { moldingH: 60 }, d: 320, doorCount: w >= 800 ? 2 : 1, is2door: w >= 800,
  isDrawer: false, drawerCount: 0, isOpen: false, shelfCount: 2, _x: x, ...extra,
});

export function sink3000() {
  return {
    uniqueId: 1, categoryId: 'sink', labelName: '싱크대', w: 3000, h: 2300, d: 600,
    modules: [
      upper('u1', 0, 600),
      upper('u2', 600, 800, { name: '후드장' }),
      upper('u3', 1400, 600),
      upper('u4', 2000, 1000),
      lower('l1', 0, 600, { isDrawer: true, drawerCount: 3, doorCount: 0 }),
      lower('l2', 600, 800, { name: '개수대' }),
      lower('l3', 1400, 600),
      lower('l4', 2000, 1000),
    ],
  };
}

export function wardrobe3600() {
  const tong = (i) => ({
    id: `planner-w${i}`, type: 'wardrobe', name: `${i}번`, pos: 'wardrobe', w: 900, h: 2230, totalH: 2310,
    heightParts: { moldingH: 20, pedestalH: 60 }, d: 620, doorCount: 2, is2door: true,
    isDrawer: false, drawerCount: 0, isOpen: false, shelfCount: 0, _x: (i - 1) * 900,
  });
  return {
    uniqueId: 2, categoryId: 'wardrobe', labelName: '붙박이장', w: 3600, h: 2310, d: 620,
    modules: [tong(1), tong(2), tong(3), tong(4)],
  };
}

export function fridge() {
  return {
    uniqueId: 3, categoryId: 'fridge', labelName: '냉장고장', w: 1600, h: 2300, d: 650,
    modules: [
      upper('f1', 0, 950, { name: '냉장고상부장', h: 340, totalH: 400, d: 650 }),
      {
        id: 'planner-t1', type: 'tall', name: '키큰장', pos: 'lower', w: 650, h: 2180, totalH: 2300,
        heightParts: { moldingH: 60, pedestalH: 60 }, d: 650, doorCount: 1, is2door: false,
        isDrawer: false, drawerCount: 0, isOpen: false, shelfCount: 4, _x: 950,
      },
    ],
  };
}

/**
 * ㄱ자 싱크 — 브리지가 `_place` 를 실은 모양 (플래너 회전 규약: 0° 진행 +x · 앞 +y, 90° 진행 +y · 앞 −x).
 *   뒷벽(0°): 하부 600 · 개수대 800 · 코너 멍장 1000 (x 0~2400, 깊이 600) + 상부 600 · 후드장 800
 *   오른벽(90°): 하부 600 · 800 (y 600~2000, x 1800~2400) + 키큰장 600 (y 2000~2600)
 */
export function lShape() {
  const back = (x, w) => ({ cx: x + w / 2, cy: 300, w, d: 600, run: [1, 0], front: [0, 1], z0: 0, h: 850, ceil: 2300 });
  const right = (y, w, extra = {}) => ({ cx: 2100, cy: y + w / 2, w, d: 600, run: [0, 1], front: [-1, 0], z0: 0, h: 850, ceil: 2300, ...extra });
  return {
    uniqueId: 4, categoryId: 'sink', labelName: 'ㄱ자 싱크대', w: 2400, h: 2300, d: 600,
    modules: [
      { ...upper('u1', 0, 600), _place: { cx: 300, cy: 160, w: 600, d: 320, run: [1, 0], front: [0, 1], z0: 1520, h: 780, ceil: 2300 } },
      { ...upper('u2', 600, 800, { name: '후드장' }), _place: { cx: 1000, cy: 160, w: 800, d: 320, run: [1, 0], front: [0, 1], z0: 1520, h: 780, ceil: 2300 } },
      { ...lower('l1', 0, 600, { isDrawer: true, drawerCount: 3, doorCount: 0 }), _place: back(0, 600) },
      { ...lower('l2', 600, 800, { name: '개수대' }), _place: back(600, 800) },
      { ...lower('l3', 1400, 1000, { name: 'LT망장', doorCount: 1, blindZoneW: 400 }), _place: back(1400, 1000) },
      { ...lower('l4', 2700, 600), _place: right(600, 600) },
      { ...lower('l5', 3300, 800), _place: right(1200, 800) },
      {
        id: 'planner-t1', type: 'tall', name: '키큰장', pos: 'lower', w: 600, h: 2180, totalH: 2300,
        heightParts: { moldingH: 60, pedestalH: 60 }, d: 600, doorCount: 1, isDrawer: false, isOpen: false, _x: 4100,
        _place: right(2000, 600, { h: 2300 }),
      },
    ],
  };
}
