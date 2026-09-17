/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 붙박이장 통 내부 구조 규칙 (docs/design-rules/wardrobe.md §1.1 기본 구조 샘플).
 *
 * 지키는 계약:
 *   1) 프리셋 앞 네 개가 사장님 기본형 1~4번 통이다 — 순서가 곧 통 배정이다
 *   2) 칸막이는 **칸 경계에서 도출**된다 — 저장하지 않으므로 칸과 어긋날 수 없다
 *   3) 4번 통(상단 통째 + 하부 옆 분할)의 세로 칸막이는 **하부 높이만** 차지한다
 *   4) 옷봉이 자재·철물로 나온다 — 예전엔 도면에만 있어 발주에서 빠졌다
 *   5) 상수는 정본과 같다 (깊이 620 · 상몰딩 20 · 좌대 60)
 */
const fs = require('fs');
const path = require('path');
const WR = require('../js/detaildesign/bom-wardrobe-rules.js');

const R = WR.WARDROBE_RULES;
const ROOT = path.join(__dirname, '..');
const layout = (o) => WR.layoutWardrobeModule(Object.assign({ W: 900, totalH: 2310 }, o));

describe('상수 정본', () => {
  test('깊이 620 · 상몰딩 20 · 좌대 60 은 detaildesign 정본과 같다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/data-constants.js'), 'utf8');
    const cat = src.match(/id:\s*'wardrobe'[^}]*defaultD:\s*(\d+)[^}]*defaultH:\s*(\d+)/);
    expect(cat).toBeTruthy();
    expect(R.DEFAULT_D).toBe(Number(cat[1]));
    expect(R.DEFAULT_H).toBe(Number(cat[2]));
    expect(src).toMatch(new RegExp(`wardrobeMoldingH:\\s*${R.MOLDING_H}\\b`));
    expect(src).toMatch(new RegExp(`wardrobePedestal:\\s*${R.PEDESTAL_H}\\b`));
  });

  test('몸통 높이 = 전체 − 좌대 − 상몰딩 (§2)', () => {
    expect(WR.bodyHeightOf({ totalH: 2310 })).toBe(2310 - 60 - 20);
    expect(WR.bodyHeightOf({ totalH: 2310, pedestalH: 0, moldingH: 0 })).toBe(2310);
    expect(WR.bodyHeightOf({ bodyH: 2000, totalH: 2310 })).toBe(2000);   // 직접 준 값이 이긴다
  });

  test('선반 깊이 = (D − 18) − 70 (§6)', () => {
    expect(WR.innerDepthOf({ D: 620 })).toBe(620 - 18);
    expect(WR.shelfDepthOf({ D: 620 })).toBe(620 - 18 - 70);
  });
});

describe('프리셋', () => {
  test('기본형 1~4번 통이 앞 네 개다', () => {
    expect(WR.PRESET_KEYS.slice(0, 4)).toEqual(['short2', 'longDrawer', 'halfSplit', 'rodTopSplitBottom']);
    expect(WR.SAMPLE_PRESETS).toEqual(WR.PRESET_KEYS.slice(0, 4));
    expect(WR.PRESET_KEYS).toContain('custom');
  });

  test('통 번호로 기본형 프리셋을 배정한다 — 4통이면 그대로', () => {
    expect([0, 1, 2, 3].map((i) => WR.samplePresetFor(i, 4)))
      .toEqual(['short2', 'longDrawer', 'halfSplit', 'rodTopSplitBottom']);
    // 통이 더 많으면 마지막 프리셋을 되쓴다 (지어낸 구조를 넣지 않는다)
    expect(WR.samplePresetFor(5, 6)).toBe('rodTopSplitBottom');
    // 통이 적으면 앞에서부터
    expect([0, 1].map((i) => WR.samplePresetFor(i, 2))).toEqual(['short2', 'longDrawer']);
  });

  test('모르는 프리셋은 기본값으로 떨어진다', () => {
    expect(WR.presetKeyOf('없는것')).toBe(WR.PRESET_DEFAULT);
    expect(WR.presetKeyOf(undefined)).toBe(WR.PRESET_DEFAULT);
    expect(WR.presetLabel('halfSplit')).toBe('반 분할 (중간 칸막이)');
  });

  test('프리셋을 옛 moduleType 으로 되읽을 수 있다 — 옛 BOM 경로 판정용', () => {
    expect(WR.moduleTypeOf('short2')).toBe('short');
    expect(WR.moduleTypeOf('longDrawer')).toBe('long');
    expect(WR.moduleTypeOf('halfSplit')).toBe('long');
    expect(WR.moduleTypeOf('rodTopSplitBottom')).toBe('short');
    expect(WR.moduleTypeOf('shelf22')).toBe('shelf');
    expect(WR.moduleTypeOf('custom')).toBeNull();
  });
});

describe('1번 통 — 짧은옷 2단', () => {
  const L = layout({ preset: 'short2' });

  test('칸 둘이 수평 칸막이 하나를 끼고 내경을 채운다', () => {
    expect(L.Wi).toBe(900 - 2 * R.PANEL_T);
    expect(L.Hi).toBe(2230 - 2 * R.PANEL_T);
    expect(L.cells).toHaveLength(2);
    L.cells.forEach((c) => expect(c.w).toBe(L.Wi));
    // 칸 + 칸막이 = 내경 높이 (틈 없음)
    expect(L.cells[0].h + R.PANEL_T + L.cells[1].h).toBe(L.Hi);
    expect(L.cells[1].y0).toBe(L.cells[0].h + R.PANEL_T);
  });

  test('칸막이는 수평 한 장 — 천지판 관례로 가로 = 폭, 세로 = 깊이', () => {
    expect(L.dividers).toHaveLength(1);
    expect(L.dividers[0]).toMatchObject({ axis: 'h', part: '중간칸막이', cutW: L.Wi, cutH: L.innerDepth });
  });

  test('옷봉 둘, 각 칸 상단에서 75 아래 · 선반 없음', () => {
    expect(L.rods).toHaveLength(2);
    expect(L.shelves).toHaveLength(0);
    L.cells.forEach((c, i) => expect(L.rods[i].y).toBe(c.y0 + c.h - R.ROD_OFFSET));
    L.rods.forEach((r) => expect(r.length).toBe(L.Wi));
  });
});

describe('2번 통 — 긴옷 + 하부 외부 서랍', () => {
  const L = layout({ preset: 'longDrawer' });

  test('서랍 2단이 기본이고 그만큼 몸통이 줄어든다 (§7)', () => {
    expect(L.drawers).toBe(2);
    expect(L.drawerModH).toBe(2 * R.DRAWER_MOD_H);
    expect(L.fullBodyH).toBe(2230);
    expect(L.bodyH).toBe(2230 - 700);
    expect(L.Hi).toBe(L.bodyH - 2 * R.PANEL_T);
  });

  test('칸 하나, 칸막이 없음 — 선반 1 은 상단에서 315, 옷봉은 75', () => {
    expect(L.cells).toHaveLength(1);
    expect(L.dividers).toHaveLength(0);
    expect(L.shelves).toHaveLength(1);
    expect(L.shelves[0].y).toBe(L.Hi - R.LONG_FIRST_SHELF);
    expect(L.rods[0].y).toBe(L.Hi - R.ROD_OFFSET);
  });

  test('서랍 단수를 주면 그 값이 이긴다 — 미지정은 프리셋 기본값', () => {
    // null·undefined 를 0 으로 접으면 프리셋 기본 단수가 조용히 사라진다
    expect(layout({ preset: 'longDrawer', drawers: null }).drawers).toBe(2);
    expect(layout({ preset: 'longDrawer', drawers: undefined }).drawers).toBe(2);
    expect(layout({ preset: 'longDrawer', drawers: 0 }).drawers).toBe(0);   // 0 은 "서랍 없음" 지정
    expect(layout({ preset: 'longDrawer', drawers: 0 }).bodyH).toBe(2230);
    expect(layout({ preset: 'longDrawer', drawers: 3 }).drawerModH).toBe(1050);
    // 통 높이를 다 먹으면 경고하고 칸을 내지 않는다
    const over = layout({ preset: 'longDrawer', drawers: 5, totalH: 1500 });
    expect(over.cells).toHaveLength(0);
    expect(over.warnings.join()).toMatch(/남지 않는다/);
  });
});

describe('3번 통 — 중간 칸막이 반 분할', () => {
  const L = layout({ preset: 'halfSplit' });

  test('세로 칸막이 하나로 좌우 두 칸, 각 칸이 통 높이 전체', () => {
    expect(L.cells).toHaveLength(2);
    L.cells.forEach((c) => { expect(c.y0).toBe(0); expect(c.h).toBe(L.Hi); });
    // 두 칸은 **같은 폭**이다 — 나머지를 한쪽에 몰면 선반·옷봉이 두 치수로 갈린다
    expect(L.cells[0].w).toBe(L.cells[1].w);
    // 사장님이 말한 450 은 **통 기준** 반이고, 판을 뺀 내경은 이 값이다
    expect(L.cells[0].w).toBe(Math.floor((L.Wi - R.PANEL_T) / 2));
    // 남는 1mm 는 조립 여유로 둔다
    const used = L.cells[0].w + R.PANEL_T + L.cells[1].w;
    expect(L.Wi - used).toBeGreaterThanOrEqual(0);
    expect(L.Wi - used).toBeLessThanOrEqual(1);
  });

  test('칸막이는 세로 한 장 — 측판 관례로 가로 = 깊이, 세로 = 칸 높이', () => {
    expect(L.dividers).toHaveLength(1);
    expect(L.dividers[0]).toMatchObject({ axis: 'v', part: '세로칸막이', cutW: L.innerDepth, cutH: L.Hi });
  });

  test('각 칸에 선반 1 + 옷봉 1, 폭은 그 칸 폭이다', () => {
    expect(L.shelves).toHaveLength(2);
    expect(L.rods).toHaveLength(2);
    expect(L.shelves.map((s) => s.cutW)).toEqual(L.cells.map((c) => c.w));
    expect(L.rods.map((r) => r.length)).toEqual(L.cells.map((c) => c.w));
  });
});

describe('4번 통 — 상단 옷봉 + 하부 옆 분할', () => {
  const L = layout({ preset: 'rodTopSplitBottom' });

  test('칸 셋 — 하부 좌(선반 3) · 하부 우(옷봉) · 상부 통째', () => {
    expect(L.cells).toHaveLength(3);
    const [a, b, c] = L.cells;
    expect([a.kind, a.shelves]).toEqual(['shelf', 3]);
    expect([b.kind, b.rods]).toEqual(['rod', 1]);
    expect(c.w).toBe(L.Wi);                 // 상부는 통째
    expect(a.h).toBe(b.h);
    expect(a.h + R.PANEL_T + c.h).toBe(L.Hi);
  });

  test('세로 칸막이는 하부 높이만 — 통을 위까지 가르지 않는다', () => {
    const v = L.dividers.filter((d) => d.axis === 'v');
    const h = L.dividers.filter((d) => d.axis === 'h');
    expect(v).toHaveLength(1);
    expect(h).toHaveLength(1);
    expect(v[0].cutH).toBe(L.cells[0].h);   // 하부 칸 높이
    expect(v[0].cutH).toBeLessThan(L.Hi);
    expect(h[0].cutW).toBe(L.Wi);           // 수평 판은 통 전체 폭
  });

  test('옷봉 둘 — 하부 짧은옷은 그 칸 폭, 상부는 통 내경 폭', () => {
    expect(L.rods.map((r) => r.length).sort((x, y) => x - y))
      .toEqual([L.cells[1].w, L.Wi].sort((x, y) => x - y));
  });
});

describe('5번 — 선반형', () => {
  test('상 2 · 하 2, 옷봉 없음. 위치는 판 두께를 뺀 균등 분배 (§6)', () => {
    const L = layout({ preset: 'shelf22' });
    expect(L.shelves).toHaveLength(4);
    expect(L.rods).toHaveLength(0);
    const lower = L.cells[0];
    const ys = L.shelves.filter((s) => s.y < lower.h).map((s) => s.y);
    const usable = lower.h - 2 * R.PANEL_T;
    const gap = usable / 3;
    expect(ys).toEqual([Math.round(gap), Math.round(2 * gap + R.PANEL_T)]);
  });
});

describe('칸을 직접 준 경우', () => {
  test('cells 를 주면 프리셋 대신 그 칸을 쓴다', () => {
    const L = layout({ preset: 'custom', cells: [
      { x0: 0, y0: 0, w: 870, h: 1000, kind: 'shelf', shelves: 1 },
      { x0: 0, y0: 1015, w: 870, h: 1185, kind: 'rod', rods: 1 },
    ] });
    expect(L.cells).toHaveLength(2);
    expect(L.dividers).toHaveLength(1);
    expect(L.dividers[0].axis).toBe('h');
  });

  test('망가진 칸은 버린다', () => {
    const L = layout({ preset: 'custom', cells: [
      null, { w: 0, h: 100 }, { w: 870, h: 2200, kind: '없는종류' },
    ] });
    expect(L.cells).toHaveLength(1);
    expect(L.cells[0].kind).toBe('open');
  });

  test('최소 폭 미만 칸이 나오면 세로 분할을 접고 경고한다', () => {
    const L = layout({ preset: 'halfSplit', W: 400 });   // 내경 370 → 반 177
    expect(L.warnings.join()).toMatch(new RegExp(`최소 ${R.MIN_CELL_W} 미만`));
    expect(L.cells).toHaveLength(1);
    expect(L.cells[0].w).toBe(L.Wi);
    expect(L.dividers).toHaveLength(0);
  });
});

describe('BOM 으로 넘기는 것', () => {
  test('부재는 칸막이·선반만 — 몸통·도어·서랍은 기존 추출이 낸다', () => {
    const rows = WR.partsOf(layout({ preset: 'halfSplit' }));
    expect(rows.map((r) => r.part).sort()).toEqual(['선반', '세로칸막이']);
    rows.forEach((r) => {
      expect(r.material).toBe('PB');
      expect(r.t).toBe(R.PANEL_T);
      expect(r.qty).toBeGreaterThan(0);
    });
    expect(rows.find((r) => r.part === '선반').qty).toBe(2);   // 같은 치수는 한 줄로 묶는다
  });

  test('옷봉이 철물로 나온다 — 파이프와 소켓 2EA, 규격 미확정은 비고에', () => {
    const hw = WR.rodHardwareOf(layout({ preset: 'short2' }));
    const pipe = hw.find((h) => h.name === '옷봉');
    const socket = hw.find((h) => h.name === '옷봉 소켓');
    expect(pipe).toMatchObject({ qty: 2, unit: 'EA' });
    expect(pipe.spec).toBe('870mm');
    expect(pipe.note).toMatch(/\[확인 필요\]/);
    expect(socket.qty).toBe(2 * R.ROD_SOCKETS_PER_ROD);
  });

  test('옷봉 없는 구성은 철물도 없다', () => {
    expect(WR.rodHardwareOf(layout({ preset: 'shelf22' }))).toEqual([]);
  });

  test('길이가 다른 옷봉은 줄을 나눈다 (4번 통)', () => {
    const hw = WR.rodHardwareOf(layout({ preset: 'rodTopSplitBottom' }));
    expect(hw.filter((h) => h.name === '옷봉')).toHaveLength(2);
    expect(hw.find((h) => h.name === '옷봉 소켓').qty).toBe(4);
  });
});

describe('브리지가 주고받는 블록', () => {
  test('모르는 값은 버리고 없는 값은 null 로 둔다 — 기본값을 지어내지 않는다', () => {
    expect(WR.normalizeBlock(undefined)).toEqual({ preset: null, cells: null, drawers: null, externalDrawer: null });
    expect(WR.normalizeBlock({ preset: '없는것' }).preset).toBeNull();
    expect(WR.normalizeBlock({ preset: 'halfSplit' }).preset).toBe('halfSplit');
    expect(WR.normalizeBlock({ drawers: 99 }).drawers).toBe(R.MAX_DRAWER_COUNT);
    expect(WR.normalizeBlock({ drawers: -3 }).drawers).toBe(0);
    expect(WR.normalizeBlock({ drawers: null }).drawers).toBeNull();   // 미지정 ≠ 0
    expect(WR.normalizeBlock({ drawers: 0 }).drawers).toBe(0);
    expect(WR.normalizeBlock({ externalDrawer: 1 }).externalDrawer).toBe(true);
  });

  test('칸 목록도 같은 다듬기를 거친다', () => {
    const b = WR.normalizeBlock({ cells: [{ w: 400, h: 1000, kind: 'rod', rods: 5 }, { w: -1, h: 5 }] });
    expect(b.cells).toHaveLength(1);
    expect(b.cells[0].rods).toBe(1);   // §8 옷봉은 최대 1개
  });
});

describe('브라우저·Node 양쪽에서 읽힌다', () => {
  test('전역 DadamWardrobeRules 와 module.exports 가 같은 API 다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/detaildesign/bom-wardrobe-rules.js'), 'utf8');
    expect(src).toContain('root.DadamWardrobeRules = api');
    expect(src).toContain('module.exports = api');
    expect(typeof WR.layoutWardrobeModule).toBe('function');
  });
});
