/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, __dirname, global */
/**
 * 붙박이장: 플래너 → 브리지 → 자재표 한 줄기 (docs/design-rules/wardrobe.md §1.3).
 *
 * 2026-09-17 까지 붙박이장은 플래너 결과를 **받지 못했다** (ui-step1 CD-3 차단). 그래서 구조 단계에서
 * 통 구조를 골라도 도면·3D 까지만 가고 자재표에 닿지 않았다. 이 시험이 그 줄기를 끝까지 지킨다.
 *
 * 지키는 계약:
 *   1) 붙박이장 통은 `pos: 'wardrobe'` 로 간다 — 'lower' 로 가면 싱크 하부장 규칙으로 산출된다
 *   2) 통 구조가 옛 필드로 옮겨진다 — moduleType 과 몸통 수가 **반드시** 맞아야 한다
 *      (extractWardrobe 가 `isDivided = moduleType === 'short'|'shelf'` 로 상·하 두 벌을 낸다)
 *   3) 칸막이·선반은 **칸에서** 나온다 (옛 선반수 필드는 블록이 있으면 쓰지 않는다 — 두 벌 방지)
 *   4) 차단을 풀면서 그 차단이 막던 사고(자재표 0건)를 새 안전장치가 막는다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
const WR = require('../js/detaildesign/bom-wardrobe-rules.js');
const { snapshotOf } = require('../test-utils/bom-golden/golden');

/** ui-step1.js 는 전역 스크립트라 import 할 수 없다 — 변환 블록만 잘라 실제 코드를 평가한다. */
function loadConverter() {
  const start = SRC.indexOf('const PLANNER_CABINET_SECTIONS');
  const end = SRC.indexOf('function _applyPlannerResult');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('변환 함수 블록을 찾지 못했습니다 — ui-step1.js 구조가 바뀌었는지 확인하세요.');
  }
  // eslint-disable-next-line no-new-func
  return new Function(`${SRC.slice(start, end)}; return { _convertPlannerModules, _wardrobeFieldsOf };`)();
}

let convert;
beforeAll(() => {
  // 브리지는 규칙 파일을 전역으로 읽는다 (브라우저에서 detaildesign.html 이 먼저 싣는다).
  global.DadamWardrobeRules = WR;
  if (typeof window !== 'undefined') window.DadamWardrobeRules = WR;
  const raw = loadConverter();
  convert = (p, specs) => raw._convertPlannerModules(p, specs || SPECS);
});

const SPECS = { bodyThickness: 15, wardrobePedestal: 60, wardrobeMoldingH: 20, handleType: 'push' };

/** 자동계산이 끝난 붙박이장 — 3600 이 900 네 통으로 섰다. 구조는 고르지 않았다(기본형 배정). */
function payload(structures) {
  const mods = [0, 1, 2, 3].map((i) => ({
    id: `wardrobe-${i}`, section: 'wardrobe', W: 900, H: 2310, D: 620, x: i * 900, y: 0,
  }));
  const st = {};
  mods.forEach((m) => {
    st[m.id] = Object.assign({
      horizontalLayout: 'doorOnly', areaTypes: ['door'], areaWidths: [900],
      areaIs2D: [true], shelves: [],
    }, (structures || {})[m.id] || {});
  });
  return { modules: mods, structures: st };
}

const wardrobeOf = (out) => out.modules.filter((m) => m.pos === 'wardrobe');

describe('브리지 — 통이 pos wardrobe 로 간다', () => {
  test('네 통이 순서대로, 이름은 옛 화면과 같은 N번', () => {
    const ws = wardrobeOf(convert(payload()));
    expect(ws).toHaveLength(4);
    expect(ws.map((m) => m.name)).toEqual(['1번', '2번', '3번', '4번']);
    ws.forEach((m) => {
      expect(m.pos).toBe('wardrobe');          // 'lower' 로 가면 싱크 규칙으로 산출된다
      expect(m.type).toBe('wardrobe');
      expect(m.w).toBe(900);
      expect(m.d).toBe(620);
      expect(m.doorCount).toBe(2);             // 양문 (areaIs2D)
    });
  });

  test('몸통 높이는 전체높이 − 좌대 60 − 상몰딩 20', () => {
    const ws = wardrobeOf(convert(payload()));
    // 붙박이장 상몰딩은 20 이다. 일반 상몰딩 기본 60 으로 떨어지면 몸통이 40 짧아진다
    ws.forEach((m) => expect(m.h).toBe(2310 - 60 - 20));
    ws.forEach((m) => expect(m.heightParts).toEqual({ moldingH: 20, pedestalH: 60 }));
  });

  test('스펙에 상몰딩이 없어도 붙박이장 기본 20 으로 떨어진다', () => {
    const ws = wardrobeOf(convert(payload(), { bodyThickness: 15 }));
    ws.forEach((m) => expect(m.h).toBe(2310 - 60 - 20));
  });

  test('구조를 고르지 않으면 통 번호가 기본형 프리셋을 정한다 — 플래너와 같은 규칙', () => {
    const ws = wardrobeOf(convert(payload()));
    expect(ws.map((m) => m.wardrobe.preset)).toEqual(WR.SAMPLE_PRESETS);
  });
});

describe('브리지 — 통 구조를 옛 필드로', () => {
  const ws = () => wardrobeOf(convert(payload()));

  test('2단 구조는 moduleType short + 상·하 높이 (몸통 수와 맞아야 한다)', () => {
    const m = ws()[0];                          // short2
    expect(m.moduleType).toBe('short');
    expect(m.isDivided).toBe(true);
    expect(m.lowerH + m.upperH).toBe(2310 - 60 - 20);
    expect(m.rodCountLower).toBe(1);
    expect(m.rodCountUpper).toBe(1);
    expect(m.shelfCountUpper).toBe(0);
    expect(m.shelfCountLower).toBe(0);
  });

  test('긴옷은 moduleType long + **내부** 서랍 2단, 상·하 높이 없음 (2026-09-18)', () => {
    const m = ws()[1];                          // longDrawer
    expect(m.moduleType).toBe('long');
    expect(m.isDivided).toBe(false);
    expect(m.upperH).toBeUndefined();
    expect(m.drawerCount).toBe(2);
    expect(m.isExternalDrawer).toBe(false);     // 긴옷 기본은 내부 서랍
    expect(m.shelfCount).toBe(1);
    expect(m.rodCountUpper).toBe(1);
  });

  test('반 분할은 몸통 하나 — moduleType long, 선반 2 (칸마다 1)', () => {
    const m = ws()[2];                          // halfSplit
    expect(m.moduleType).toBe('long');
    expect(m.isDivided).toBe(false);
    expect(m.shelfCount).toBe(2);
    expect(m.rodCountUpper).toBe(2);
  });

  test('moduleType 과 isDivided 는 언제나 같은 말을 한다', () => {
    // extractWardrobe 가 moduleType 으로 isDivided 를 되계산한다 — 어긋나면 몸통 수가 틀어진다
    ws().forEach((m) => {
      const dividedByType = m.moduleType === 'short' || m.moduleType === 'shelf';
      expect(m.isDivided).toBe(dividedByType);
      expect(dividedByType).toBe(m.upperH != null);
    });
  });

  test('구조를 고른 통은 그 프리셋을 쓴다', () => {
    const out = convert(payload({ 'wardrobe-0': { wardrobe: { preset: 'shelf22' } } }));
    const m = wardrobeOf(out)[0];
    expect(m.wardrobe.preset).toBe('shelf22');
    expect(m.moduleType).toBe('shelf');
    expect(m.shelfCountUpper).toBe(2);
    expect(m.shelfCountLower).toBe(2);
  });

  test('내부 서랍을 고르면 그대로 넘어간다', () => {
    const out = convert(payload({
      'wardrobe-1': { wardrobe: { preset: 'longDrawer', drawers: 2, externalDrawer: false } },
    }));
    const m = wardrobeOf(out)[1];
    expect(m.isExternalDrawer).toBe(false);
    expect(m.drawerCount).toBe(2);
    expect(m.wardrobe.externalDrawer).toBe(false);
  });
});

describe('자재표 — 칸막이·선반·옷봉이 끝까지 간다', () => {
  const snap = () => {
    const mods = wardrobeOf(convert(payload()));
    return snapshotOf({ appVersion: 'p2', items: [{
      categoryId: 'wardrobe', labelName: '붙박이장',
      w: 3600, h: 2310, d: 620, specs: SPECS, modules: mods,
    }] });
  };
  const parts = (s, mod) => s.materials.filter((m) => m.module === mod).map((m) => m.part);

  test('자재가 0건이 아니다 — 차단을 풀기 전엔 붙박이장에 플래너 결과가 못 들어왔다', () => {
    expect(snap().materials.length).toBeGreaterThan(20);
  });

  test('2단 통은 상부장·하부장 두 벌로 나온다', () => {
    const s = snap();
    expect(parts(s, '1번-상부장')).toContain('측판');
    expect(parts(s, '1번-하부장')).toContain('측판');
    // 몸통이 둘이니 천판·지판도 두 벌
    expect(parts(s, '1번-상부장')).toContain('천판');
    expect(parts(s, '1번-하부장')).toContain('천판');
  });

  test('반 분할 통에 세로칸막이가 나온다 — 예전 모델로는 낼 수 없던 부재', () => {
    const s = snap();
    const div = s.materials.filter((m) => m.part === '세로칸막이');
    // 3번 통(반 분할)은 통 전체 높이로 한 장, 4번 통(하부 옆 분할)은 하부 몸통 높이로 한 장
    expect(div.map((d) => d.module)).toEqual(['3번', '4번-하부장']);
    div.forEach((d) => {
      expect(d.material).toBe('PB');
      expect(d.w).toBe(620 - 18);               // 가로 = 천저판 깊이 (측판 관례)
      expect(d.thickness).toBe(15);
    });
    // 4번 통 칸막이는 하부 몸통 높이만 — 통을 위까지 가르지 않는다
    expect(div[1].h).toBeLessThan(div[0].h)
  });

  test('선반은 칸에서 나온다 — 옛 선반수 필드로 두 벌 나오지 않는다', () => {
    const s = snap();
    // 3번 통(반 분할)은 칸마다 선반 1 → 같은 치수 두 장 한 줄
    const sh3 = s.materials.filter((m) => m.module === '3번' && m.part === '선반');
    expect(sh3).toHaveLength(1);
    expect(sh3[0].qty).toBe(2);
    expect(sh3[0].h).toBe(620 - 18 - 70);       // §6 선반 깊이
    // 1번 통(짧은옷 2단)은 선반이 없다
    expect(s.materials.filter((m) => /^1번/.test(m.module) && m.part === '선반')).toHaveLength(0);
  });

  test('옷봉이 철물로 나온다 — 통마다 칸 수만큼', () => {
    const s = snap();
    const rods = s.hardware.filter((h) => h.item === '옷봉');
    const socket = s.hardware.find((h) => h.item === `옷봉 ${WR.WARDROBE_RULES.ROD_SOCKET_NAME}`);
    expect(rods.length).toBeGreaterThan(0);
    rods.forEach((r) => expect(r.spec).toMatch(WR.WARDROBE_RULES.ROD_SPEC));
    // 1번 2 + 2번 1 + 3번 2 + 4번 2 = 7 개
    const total = rods.reduce((n, r) => n + r.qty, 0);
    expect(total).toBe(7);
    expect(socket.qty).toBe(total * WR.WARDROBE_RULES.ROD_SOCKETS_PER_ROD);
  });

  test('긴옷 기본은 내부 서랍 — 서랍모듈 몸통이 아니라 통 안 부재로 나온다 (§7)', () => {
    const s = snap();
    // 내부 서랍은 별도 몸통이 없다
    expect(s.materials.filter((m) => m.module === '2번-서랍모듈')).toHaveLength(0);
    // 문서 §7 '내부 서랍' 표의 부재가 통 이름으로 나온다
    const p2 = parts(s, '2번');
    ['내부서랍 상판', '내부서랍 측판', '내부서랍 지판', '내부서랍 밴드',
      '내부서랍 좌우몰딩', '내부서랍 전면판', '서랍전후판', '서랍측판', '서랍밑판']
      .forEach((name) => expect(p2).toContain(name));
  });

  test('외부로 바꾸면 서랍모듈 몸통이 따로 나온다 (§7)', () => {
    const mods = wardrobeOf(convert(payload({
      'wardrobe-1': { wardrobe: { preset: 'longDrawer', drawers: 2, externalDrawer: true } },
    })));
    const s = snapshotOf({ appVersion: 'p2x', items: [{
      categoryId: 'wardrobe', labelName: '붙박이장',
      w: 3600, h: 2310, d: 620, specs: SPECS, modules: mods,
    }] });
    const drawerMod = s.materials.filter((m) => m.module === '2번-서랍모듈').map((m) => m.part);
    expect(drawerMod).toContain('측판');
    expect(drawerMod).toContain('천판');
    expect(drawerMod).toContain('서랍전후판');
    // 내부 서랍 부재는 그때 나오지 않는다
    expect(parts(s, '2번')).not.toContain('내부서랍 상판');
  });
});

describe('거울 · 커튼박스 — 값이 상세설계까지', () => {
  test('거울은 통 모듈에 남는다', () => {
    const p = payload();
    p.modules[0].hasMirror = true;
    const ws = wardrobeOf(convert(p));
    expect(ws[0].hasMirror).toBe(true);
    expect(ws[1].hasMirror).toBeUndefined();
  });

  test('커튼박스는 품목 스펙으로 간다 — 배치 공간 값이라 통마다가 아니다', () => {
    const p = payload();
    p.modules.forEach((m) => { m.curtainBoxW = 3600; m.curtainBoxH = 250; });
    const specs = Object.assign({}, SPECS);
    convert(p, specs);
    expect(specs.curtainBoxW).toBe(3600);
    expect(specs.curtainBoxH).toBe(250);
  });

  test('커튼박스가 없으면 스펙을 건드리지 않는다', () => {
    const specs = Object.assign({}, SPECS);
    convert(payload(), specs);
    expect(specs.curtainBoxW).toBeUndefined();
    expect(specs.curtainBoxH).toBeUndefined();
  });
});

describe('차단(CD-3) — 풀었지만 사고는 막는다', () => {
  test('결과를 못 받는 카테고리는 냉장고장만 남았다', () => {
    expect(SRC).toContain("const PLANNER_RESULT_BLOCKED = ['fridge'];");
    expect(SRC).toContain('function _plannerResultBlocked(item)');
    // 2026-09-17: 화면도 플래너로 옮겼다 — 예외 목록에 냉장고장만 남았다
    expect(SRC).toContain("const NATIVE_ONLY_CATEGORIES = ['fridge'];");
  });

  test('붙박이장 통이 없는 결과는 거부한다 — 옛 사고(자재표 0건)를 막는 새 안전장치', () => {
    const apply = SRC.slice(SRC.indexOf('function _applyPlannerResult'),
      SRC.indexOf('function _applyPlannerResult') + 3000);
    expect(apply).toContain("item.categoryId === 'wardrobe' && !modules.some((x) => x.pos === 'wardrobe')");
    expect(apply).toContain('플래너 결과에 붙박이장 통이 없습니다');
  });
});
