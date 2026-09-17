/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 붙박이장 통 내부 구조 규칙 (docs/design-rules/wardrobe.md §1.1 기본 구조 샘플).
 *
 * 지키는 계약:
 *   1) 프리셋 앞 네 개가 사장님 기본형 1~4번 통이다 — 순서가 곧 통 배정이다
 *   2) **통 하나가 몸통 여럿이다** — 2단은 상·하 독립 캐비닛, 외부 서랍은 별도 몸통 (2026-09-17)
 *   3) 칸막이는 **칸 경계에서 도출**되고 **몸통 안에서만** 나온다 — 몸통 사이는 천판·지판이다
 *   4) 4번 통(상단 통째 + 하부 옆 분할)의 세로 칸막이는 **하부 몸통 높이만** 차지한다
 *   5) 긴옷 서랍은 **기본 1단이고 0 도 된다**. 서랍은 외부(몸통 따로)·내부(몸통 안) 두 가지
 *   6) 옷봉은 **최상단 선반 바로 아래**에 걸린다 — 선반이 없으면 칸 상단에서 75
 *   6) 옷봉이 철물로 나온다 — 예전엔 도면에만 있어 발주에서 빠졌다
 *   7) 상수는 정본과 같다 (깊이 620 · 상몰딩 20 · 좌대 60)
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

  test('프리셋마다 몸통 스택을 선언한다 — 2단은 둘, 통장은 하나', () => {
    const stackOf = (k) => WR.presetOf(k).stack.map((st) => st.key);
    expect(stackOf('short2')).toEqual(['lower', 'upper']);
    expect(stackOf('rodTopSplitBottom')).toEqual(['lower', 'upper']);
    expect(stackOf('shelf22')).toEqual(['lower', 'upper']);
    expect(stackOf('halfSplit')).toEqual(['body']);
    expect(stackOf('longDrawer')).toEqual(['body']);
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

describe('몸통 스택 — 통 하나가 몸통 여럿', () => {
  test('높이 합이 몸통 높이와 정확히 같다 (모든 프리셋)', () => {
    WR.PRESET_KEYS.filter((k) => k !== 'custom').forEach((k) => {
      const L = layout({ preset: k });
      expect(L.carcasses.reduce((s, c) => s + c.h, 0)).toBe(L.fullBodyH);
      // 아래에서 위로, 틈 없이 쌓인다
      let y = 0;
      L.carcasses.forEach((c) => { expect(c.y0).toBe(y); y += c.h; });
    });
  });

  test('직접 편집한 칸을 주면 캐비닛 몸통 하나로 본다', () => {
    const L = layout({ preset: 'custom', cells: [
      { x0: 0, y0: 0, w: 870, h: 1000, kind: 'shelf', shelves: 1 },
    ] });
    expect(WR.cabinetsOf(L)).toHaveLength(1);
    expect(L.cells).toHaveLength(1);
  });

  test('망가진 칸은 버린다', () => {
    const L = layout({ preset: 'custom', cells: [
      null, { w: 0, h: 100 }, { w: 870, h: 2200, kind: '없는종류' },
    ] });
    expect(L.cells).toHaveLength(1);
    expect(L.cells[0].kind).toBe('open');
  });
});

describe('1번 통 — 짧은옷 2단', () => {
  const L = layout({ preset: 'short2' });
  const [lower, upper] = L.carcasses;

  test('상부장·하부장이 각각 독립 몸통이다 — 칸막이가 아니라 몸통 둘', () => {
    expect(L.carcasses).toHaveLength(2);
    expect(L.carcasses.map((c) => [c.key, c.kind])).toEqual([['lower', 'cabinet'], ['upper', 'cabinet']]);
    expect(lower.h).toBe(upper.h);              // 2230 이 짝수로 나뉜다
    // 몸통 사이에 칸막이는 없다 — 하부 천판 + 상부 지판이 대신한다
    expect(L.dividers).toHaveLength(0);
  });

  test('몸통마다 옷봉 하나, 그 몸통 내경 폭으로', () => {
    expect(L.rods).toHaveLength(2);
    expect(L.shelves).toHaveLength(0);
    expect(lower.rods).toHaveLength(1);
    expect(upper.rods).toHaveLength(1);
    L.rods.forEach((r) => { expect(r.clearW).toBe(L.Wi); expect(r.length).toBe(L.Wi - R.ROD_LENGTH_MINUS); });
  });

  test('칸 y 는 통 좌표다 — 상부 칸이 하부 몸통 위에 앉는다', () => {
    expect(L.cells).toHaveLength(2);
    expect(L.cells[0].y0).toBe(R.PANEL_T);                    // 하부 몸통 지판 위
    expect(L.cells[1].y0).toBe(lower.h + R.PANEL_T);          // 상부 몸통 지판 위
    expect(L.cells[0].h).toBe(lower.h - 2 * R.PANEL_T);
  });
});

describe('2번 통 — 긴옷 + 하부 서랍', () => {
  const L = layout({ preset: 'longDrawer' });

  test('서랍 기본 2단, 외부라서 몸통이 맨 아래에 따로 선다 (§7 별도 제작)', () => {
    expect(L.drawers).toBe(2);
    expect(L.external).toBe(true);
    expect(L.carcasses.map((c) => c.kind)).toEqual(['drawer', 'cabinet']);
    expect(L.carcasses[0]).toMatchObject({ key: 'drawer', y0: 0, h: 2 * R.DRAWER_MOD_H, drawers: 2 });
    expect(L.drawerModH).toBe(700);
    expect(L.fullBodyH).toBe(2230);
    expect(L.cabinetH).toBe(2230 - 700);
    expect(WR.cabinetsOf(L)).toHaveLength(1);
  });

  test('서랍 0 도 된다 — 최소를 걸지 않는다', () => {
    const zero = layout({ preset: 'longDrawer', drawers: 0 });
    expect(zero.drawers).toBe(0);
    expect(zero.warnings).toEqual([]);
    expect(zero.carcasses.map((c) => c.kind)).toEqual(['cabinet']);
    expect(zero.cabinetH).toBe(2230);
  });

  test('미지정은 프리셋 기본값 2단 (기본형 사진 그대로)', () => {
    expect(layout({ preset: 'longDrawer', drawers: null }).drawers).toBe(2);
    expect(layout({ preset: 'longDrawer', drawers: undefined }).drawers).toBe(2);
  });

  test('긴옷 칸 하나 — 선반은 칸 상단에서 315, 옷봉은 그 선반 아래 75', () => {
    expect(L.cells).toHaveLength(1);
    expect(L.dividers).toHaveLength(0);
    const cell = L.cells[0];
    const shelfY = cell.y0 + cell.h - R.LONG_FIRST_SHELF;
    expect(L.shelves[0].y).toBe(shelfY);
    // 옷봉이 선반 **아래**다 — 예전엔 칸 상단에서 75 라 선반 위에 걸렸다 (옷이 안 걸리는 자리)
    expect(L.rods[0].y).toBe(shelfY - R.ROD_OFFSET);
    expect(L.rods[0].y).toBeLessThan(L.shelves[0].y);
  });

  test('외부 서랍은 단수만큼 캐비닛을 줄인다', () => {
    const three = layout({ preset: 'longDrawer', drawers: 3 });
    expect(three.drawerModH).toBe(1050);
    expect(WR.cabinetsOf(three)[0].h).toBe(2230 - 1050);
    // 통 높이를 다 먹으면 경고하고 칸을 내지 않는다
    const over = layout({ preset: 'longDrawer', drawers: 5, totalH: 1500 });
    expect(over.cells).toHaveLength(0);
    expect(over.warnings.join()).toMatch(/남지 않는다/);
  });
});

describe('서랍 종류 — 외부 · 내부 (§7)', () => {
  const ext = layout({ preset: 'longDrawer', drawers: 2, externalDrawer: true });
  const int = layout({ preset: 'longDrawer', drawers: 2, externalDrawer: false });

  test('외부는 몸통을 따로 세워 캐비닛 높이를 줄인다', () => {
    expect(ext.carcasses.map((c) => c.kind)).toEqual(['drawer', 'cabinet']);
    expect(ext.cabinetH).toBe(2230 - 700);
    expect(WR.cabinetsOf(ext)[0].drawerZone).toBeUndefined();
  });

  test('내부는 몸통 높이를 그대로 두고 맨 아래 캐비닛 안에서 자리를 뺀다', () => {
    expect(int.carcasses.map((c) => c.kind)).toEqual(['cabinet']);
    expect(int.cabinetH).toBe(2230);
    expect(int.carcasses[0].h).toBe(2230);
    expect(int.carcasses[0].drawerZone).toEqual({ y0: R.PANEL_T, h: 700, drawers: 2 });
    // 칸은 서랍 구역 위에서 시작한다
    expect(int.cells[0].y0).toBe(R.PANEL_T + 700);
    expect(int.cells[0].h).toBe(2230 - 2 * R.PANEL_T - 700);
  });

  test('둘의 칸 높이는 같다 — 서랍이 먹는 자리가 같기 때문', () => {
    expect(int.cells[0].h).toBe(ext.cells[0].h);
  });

  test('미지정이면 외부다 (기본형 사진이 외부 서랍)', () => {
    expect(layout({ preset: 'longDrawer' }).external).toBe(true);
    expect(WR.normalizeBlock({}).externalDrawer).toBeNull();
    expect(WR.normalizeBlock({ externalDrawer: false }).externalDrawer).toBe(false);
  });

  test('2단 구조에 내부 서랍을 넣으면 하부장 안에만 들어간다', () => {
    const L = layout({ preset: 'short2', drawers: 1, externalDrawer: false });
    expect(L.carcasses.map((c) => c.kind)).toEqual(['cabinet', 'cabinet']);
    expect(L.carcasses[0].drawerZone).toMatchObject({ drawers: 1, h: R.DRAWER_MOD_H });
    expect(L.carcasses[1].drawerZone).toBeUndefined();
  });
});

describe('상몰딩 부재 (§11 · 2026-09-17)', () => {
  const part = (o) => WR.moldingPartFor(o);

  test('60 이상은 몰딩 폭 그대로 EP 한 장 (기존 규칙)', () => {
    expect(part({ moldingH: 60, totalW: 2000 }))
      .toMatchObject({ part: '상몰딩', material: 'MDF', t: 18, w: 60, h: R.EP_LENGTH, qty: 1 });
    expect(part({ moldingH: 100, totalW: 2000 }).w).toBe(100);
  });

  test('60 미만은 스위치를 켤 때만 60×18T MDF 마감재로 나온다', () => {
    // 붙박이장 기본 상몰딩 20 — 여태 아무 부재도 안 나왔다
    expect(part({ moldingH: R.MOLDING_H, totalW: 3600 })).toBeNull();
    const row = part({ moldingH: R.MOLDING_H, totalW: 3600, finish: true });
    expect(row).toMatchObject({
      part: '상몰딩', material: 'MDF', t: R.MOLDING_FINISH_T, w: R.MOLDING_FINISH_W, h: R.EP_LENGTH,
    });
    expect(row.note).toMatch(/60×18T MDF 마감재/);
  });

  test('런이 2440 보다 길면 2장', () => {
    expect(part({ moldingH: 20, totalW: 2440, finish: true }).qty).toBe(1);
    expect(part({ moldingH: 20, totalW: 2441, finish: true }).qty).toBe(2);
  });

  test('상몰딩이 없거나 런 폭이 0 이면 부재도 없다', () => {
    expect(part({ moldingH: 0, totalW: 3600, finish: true })).toBeNull();
    expect(part({ moldingH: 20, totalW: 0, finish: true })).toBeNull();
    expect(part()).toBeNull();
  });

  test('스위치 값 — none·0·빈값은 꺼짐, 나머지는 켜짐', () => {
    expect(['ep60', '1', true, 1].map(WR.moldingFinishOn)).toEqual([true, true, true, true]);
    expect(['none', '0', 0, '', false, null, undefined].map(WR.moldingFinishOn))
      .toEqual([false, false, false, false, false, false, false]);
  });
});

describe('옷봉 자리 — 최상단 선반 아래', () => {
  test('선반이 없으면 칸 상단에서 75 (짧은옷)', () => {
    const L = layout({ preset: 'short2' });
    L.cells.forEach((c, i) => expect(L.rods[i].y).toBe(c.y0 + c.h - R.ROD_OFFSET));
  });

  test('선반이 여러 장이면 가장 위 선반 밑면에서 75', () => {
    const L = layout({ preset: 'custom', cells: [
      { x0: 0, y0: 0, w: 870, h: 2000, kind: 'rod', rods: 1, shelves: 3 },
    ] });
    const cell = L.cells[0];
    const ys = L.shelves.map((s) => s.y);
    expect(Math.max(...ys)).toBe(cell.y0 + cell.h - R.LONG_FIRST_SHELF);
    expect(L.rods[0].y).toBe(Math.max(...ys) - R.ROD_OFFSET);
  });
});

describe('3번 통 — 중간 칸막이 반 분할', () => {
  const L = layout({ preset: 'halfSplit' });
  const body = WR.cabinetsOf(L)[0];

  test('몸통은 하나다 — 통 전체 높이', () => {
    expect(L.carcasses).toHaveLength(1);
    expect(body.h).toBe(L.fullBodyH);
  });

  test('세로 칸막이 하나로 좌우 두 칸, 두 칸은 같은 폭', () => {
    expect(L.cells).toHaveLength(2);
    expect(L.cells[0].w).toBe(L.cells[1].w);
    expect(L.cells[0].w).toBe(Math.floor((L.Wi - R.PANEL_T) / 2));
    const used = L.cells[0].w + R.PANEL_T + L.cells[1].w;
    expect(L.Wi - used).toBeGreaterThanOrEqual(0);
    expect(L.Wi - used).toBeLessThanOrEqual(1);              // 남는 1mm 는 조립 여유
  });

  test('칸막이는 세로 한 장 — 측판 관례로 가로 = 깊이, 세로 = 칸 높이', () => {
    expect(L.dividers).toHaveLength(1);
    expect(L.dividers[0]).toMatchObject({ axis: 'v', part: '세로칸막이', cutW: L.innerDepth });
    expect(L.dividers[0].cutH).toBe(body.h - 2 * R.PANEL_T);
    expect(L.dividers[0].y0).toBe(R.PANEL_T);                // 통 좌표 — 지판 위에서 시작
  });

  test('각 칸에 선반 1 + 옷봉 1, 폭은 그 칸 폭이다', () => {
    expect(L.shelves).toHaveLength(2);
    expect(L.rods).toHaveLength(2);
    expect(L.shelves.map((s) => s.cutW)).toEqual(L.cells.map((c) => c.w));
    expect(L.rods.map((r) => r.clearW)).toEqual(L.cells.map((c) => c.w));
  });
});

describe('4번 통 — 상단 옷봉 + 하부 옆 분할', () => {
  const L = layout({ preset: 'rodTopSplitBottom' });
  const [lower, upper] = L.carcasses;

  test('몸통 둘 — 하부만 옆으로 갈린다', () => {
    expect(L.carcasses).toHaveLength(2);
    expect(lower.cells).toHaveLength(2);
    expect(upper.cells).toHaveLength(1);
    expect(upper.cells[0].w).toBe(L.Wi);                     // 상부는 통째
    const [a, b] = lower.cells;
    expect([a.kind, a.shelves]).toEqual(['shelf', 3]);
    expect([b.kind, b.rods]).toEqual(['rod', 1]);
  });

  test('세로 칸막이는 하부 몸통 안에만 — 통을 위까지 가르지 않는다', () => {
    expect(L.dividers).toHaveLength(1);
    const v = L.dividers[0];
    expect(v.axis).toBe('v');
    expect(v.carcass).toBe(0);
    expect(v.cutH).toBe(lower.h - 2 * R.PANEL_T);
    expect(v.cutH).toBeLessThan(L.fullBodyH / 2);
    expect(upper.dividers).toHaveLength(0);
  });

  test('옷봉 둘 — 하부 짧은옷은 그 칸 폭, 상부는 통 내경 폭', () => {
    expect(L.rods.map((r) => r.clearW).sort((x, y) => x - y))
      .toEqual([lower.cells[1].w, L.Wi].sort((x, y) => x - y));
  });
});

describe('5번 — 선반형', () => {
  test('몸통 둘, 각 선반 2. 위치는 판 두께를 뺀 균등 분배 (§6)', () => {
    const L = layout({ preset: 'shelf22' });
    expect(L.carcasses).toHaveLength(2);
    expect(L.shelves).toHaveLength(4);
    expect(L.rods).toHaveLength(0);
    const lower = L.carcasses[0];
    const cell = lower.cells[0];
    const usable = cell.h - 2 * R.PANEL_T;
    const gap = usable / 3;
    expect(lower.shelves.map((s) => s.y - cell.y0)).toEqual([Math.round(gap), Math.round(2 * gap + R.PANEL_T)]);
  });
});

describe('만들 수 없는 것', () => {
  test('최소 폭 미만 칸이 나오면 세로 분할을 접고 경고한다', () => {
    const L = layout({ preset: 'halfSplit', W: 400 });   // 내경 370 → 반 177
    expect(L.warnings.join()).toMatch(new RegExp(`최소 ${R.MIN_CELL_W} 미만`));
    expect(L.cells).toHaveLength(1);
    expect(L.cells[0].w).toBe(L.Wi);
    expect(L.dividers).toHaveLength(0);
  });

  test('몸통 높이가 판 두께보다 얕으면 칸을 내지 않는다', () => {
    const L = layout({ preset: 'short2', totalH: 100 });
    expect(L.cells).toHaveLength(0);
    expect(L.warnings.length).toBeGreaterThan(0);
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

  test('옷봉이 철물로 나온다 — 크롬 25파이 파이프 + 원형소켓 2EA (2026-09-17 확정)', () => {
    const L = layout({ preset: 'short2' });
    const hw = WR.rodHardwareOf(L);
    const pipe = hw.find((h) => h.name === '옷봉');
    const socket = hw.find((h) => h.name === '옷봉 원형소켓');
    expect(pipe).toMatchObject({ qty: 2, unit: 'EA' });
    // 길이 = 칸 내경 폭 − 5
    expect(pipe.spec).toBe(`${R.ROD_SPEC} ${L.Wi - R.ROD_LENGTH_MINUS}mm`);
    expect(pipe.note).not.toMatch(/\[확인 필요\]/);   // 규격을 받았다
    expect(socket.qty).toBe(2 * R.ROD_SOCKETS_PER_ROD);
    expect(socket.spec).toBe(R.ROD_SPEC);
  });

  test('길이만 넘겨도 같은 줄이 나온다 — 칸 구조가 없는 옛 설계용', () => {
    expect(WR.rodLengthFor(870)).toBe(865);
    expect(WR.rodLengthFor(0)).toBe(0);
    const hw = WR.rodHardwareFor([865, 865, 422]);
    expect(hw.map((h) => [h.name, h.spec, h.qty])).toEqual([
      ['옷봉', `${R.ROD_SPEC} 422mm`, 1],
      ['옷봉', `${R.ROD_SPEC} 865mm`, 2],
      ['옷봉 원형소켓', R.ROD_SPEC, 6],
    ]);
    expect(WR.rodHardwareFor([])).toEqual([]);
    expect(WR.rodHardwareFor([0, -3])).toEqual([]);
  });

  test('옷봉 없는 구성은 철물도 없다', () => {
    expect(WR.rodHardwareOf(layout({ preset: 'shelf22' }))).toEqual([]);
  });

  test('길이가 다른 옷봉은 줄을 나눈다 (4번 통)', () => {
    const hw = WR.rodHardwareOf(layout({ preset: 'rodTopSplitBottom' }));
    expect(hw.filter((h) => h.name === '옷봉')).toHaveLength(2);
    expect(hw.find((h) => h.name === '옷봉 원형소켓').qty).toBe(4);
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
