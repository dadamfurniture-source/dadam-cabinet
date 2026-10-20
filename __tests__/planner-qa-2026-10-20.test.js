/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-20 플래너 점검 — 사용자처럼 품목 11종을 처음부터 BOM 까지 만들어 보다가 나온 버그 셋.
 *
 * 1) 품목 깊이가 배치에 안 들어갔다.
 *    품목 드롭다운은 iframe 에 `?preset=shoerack&d=350` 처럼 깊이를 넘기는데 배치 사각형은
 *    늘 섹션 기본값(하부 650·키큰 650)이었다. 그래서 신발장·수납장·창고장 측판이 620,
 *    TV장 측판이 550 으로 나왔다(TV장 결정은 400). 아일랜드도 싱크대 규칙의 자리 800 이 아니었다.
 *    고친 방식(2026-10-20 카드 "몸통 깊이"): 단순 품목은 품목 깊이 = 몸통 깊이,
 *    배치 자리 = 몸통 + 물끊기 + 도어 자리(구조 단계 seatModuleDepth 가 빼는 값과 같다).
 *    아일랜드는 sink.md 대로 자리 깊이 800 을 그대로 쓴다.
 *
 * 2) 오른쪽 패널의 '도어 / 손잡이'·'마감 / 조명'·'BOM 미리보기' 는 어디에도 연결되지 않은 목업이었다.
 *    "14 개 / 22 장 / 2,840,000원" 이 품목과 상관없이 늘 같은 값으로 떠 사용자를 속였다.
 *
 * 3) 개별 모듈 패널에서 값을 바꾸고 '적용' 없이 다른 모듈을 고르거나 빈 곳을 누르면
 *    바꾼 값이 말없이 사라졌다. 떠나기 전에 초안을 적용한다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const sections = require('../js/planner/planner-sections');
const engine = require('../js/planner/planner-engine');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8');
const FRONT_RESERVE = engine.MASTER_RULES.CORNER_DRIP + engine.MASTER_RULES.DOOR_SEAT_D;

function bootShell(search) {
  return bootPlanner('mockup-shell.html', { search });
}

describe('품목 깊이 → 배치 깊이', () => {
  test('applyItemDepthToSections — 단순 품목은 몸통 깊이 + 앞 여유', () => {
    const cfg = sections.buildSectionConfig(undefined, undefined, 'tvcabinet');
    sections.applyItemDepthToSections(cfg, 'tvcabinet', '400', FRONT_RESERVE);
    expect(cfg.lower.h).toBe(400 + FRONT_RESERVE);
    expect(cfg.tall.h).toBe(400 + FRONT_RESERVE);
    expect(cfg.upper.h).toBe(sections.PLANNER_SECTIONS.upper.h); // 상부장은 그대로
  });

  test('아일랜드는 자리 깊이 그대로', () => {
    const cfg = sections.buildSectionConfig(undefined, undefined, 'island');
    sections.applyItemDepthToSections(cfg, 'island', 800, FRONT_RESERVE);
    expect(cfg.lower.h).toBe(800);
  });

  test('싱크대·붙박이장·값 없음은 건드리지 않는다', () => {
    const base = sections.buildSectionConfig(undefined, undefined, 'sink');
    const cfg = sections.buildSectionConfig(undefined, undefined, 'sink');
    sections.applyItemDepthToSections(cfg, 'sink', 600, FRONT_RESERVE);
    expect(cfg.lower.h).toBe(base.lower.h);
    const cfg2 = sections.buildSectionConfig(undefined, undefined, 'shoerack');
    sections.applyItemDepthToSections(cfg2, 'shoerack', null, FRONT_RESERVE);
    sections.applyItemDepthToSections(cfg2, 'shoerack', 'abc', FRONT_RESERVE);
    expect(cfg2.tall.h).toBe(base.tall.h);
  });

  test('배치 화면이 URL d 로 섹션 깊이를 잡는다 (신발장 350 → 자리 380)', () => {
    const p = bootShell('?design=t&item=1&preset=shoerack&w=1200&h=2300&d=350');
    expect(p.g('SECTION_CONFIG').tall.h).toBe(350 + FRONT_RESERVE);
  });

  test('배치 화면은 구조 단계와 같은 앞 여유 값을 쓴다 (planner-engine 을 싣는다)', () => {
    expect(SHELL).toMatch(/<script src="js\/planner\/planner-engine\.js\?v=[\d.]+"><\/script>/);
  });
});

describe('오른쪽 가짜 패널 제거', () => {
  test('고정 숫자 BOM 미리보기·도어/손잡이·마감/조명 칸이 없다', () => {
    const p = bootShell('?design=t&item=1');
    const text = p.document.body.textContent;
    expect(text).not.toContain('BOM 미리보기');
    expect(text).not.toContain('2,840,000');
    const titles = [...p.document.querySelectorAll('.section-title, h3, h4')].map((n) => n.textContent.trim());
    expect(titles.some((t) => /도어\s*\/\s*손잡이|마감\s*\/\s*조명/.test(t))).toBe(false);
  });
});

describe('적용 안 한 모듈 변경을 잃지 않는다', () => {
  function setField(p, selector, value) {
    const inp = p.document.querySelector(selector);
    inp.value = String(value);
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
  }
  function twoLowers() {
    const p = bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
    const area = p.g('areas').find((a) => a.section === 'lower');
    const a = p.g('addModuleToArea')(area.id);
    const b = p.g('addModuleToArea')(area.id);
    return { p, a, b };
  }

  test('다른 모듈을 고르면 바꾼 값이 적용된다', () => {
    const { p, a, b } = twoLowers();
    p.g('setActiveModule')(a.id);
    setField(p, '#inpVCount', 3);
    expect(p.g('getStructure')(a.id).verticalCount).not.toBe(3); // 아직 초안
    p.g('setActiveModule')(b.id);
    expect(p.g('getStructure')(a.id).verticalCount).toBe(3);
  });

  test('선택을 풀어도 바꾼 값이 적용된다', () => {
    const { p, a } = twoLowers();
    p.g('setActiveModule')(a.id);
    setField(p, '#inpVCount', 3);
    p.g('setActiveModule')(null);
    expect(p.g('getStructure')(a.id).verticalCount).toBe(3);
  });

  test('되돌리기는 여전히 버린다', () => {
    const { p, a, b } = twoLowers();
    p.g('setActiveModule')(a.id);
    const before = p.g('getStructure')(a.id).verticalCount;
    setField(p, '#inpVCount', 3);
    p.g('revertModuleDraft')();
    p.g('setActiveModule')(b.id);
    expect(p.g('getStructure')(a.id).verticalCount).toBe(before);
  });
});

describe('칸 타입 서랍 — 서랍장으로 바꾼다 (BOM 브리지가 읽는 모양)', () => {
  function pick() {
    const p = bootPlanner('mockup-structure.html', { search: '?design=t&item=1' });
    const area = p.g('areas').find((a) => a.section === 'lower');
    const m = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(m.id);
    return { p, m };
  }
  const typeSel = (p) => p.document.querySelector('#areasBody .area-row[data-idx="0"] .a-type');

  test('칸 하나에서 서랍을 고르면 하부 서랍 모듈이 된다', () => {
    const { p, m } = pick();
    const sel = typeSel(p);
    sel.value = 'drawer';
    sel.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    p.g('applyModuleDraft')();
    const s = p.g('getStructure')(m.id);
    expect(s.horizontalLayout).toBe('doorTopDrawerBottom');
    expect(s.bottomType).toBe('drawer');
    expect(s.areaTypes[0]).toBe('door');
  });

  test('칸이 여럿이면 서랍 고르기가 없다', () => {
    const { p } = pick();
    const inp = p.document.querySelector('#inpVCount');
    inp.value = '2';
    inp.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    const opts = [...typeSel(p).options].map((o) => o.value);
    expect(opts).not.toContain('drawer');
    expect(opts).toContain('door');
  });
});

describe('아일랜드 BOM — 싱크대 규칙으로 산출한다 (sink.md categoryId sink / island)', () => {
  const { snapshotOf } = require('../test-utils/bom-golden/golden');
  const design = {
    items: [{
      categoryId: 'island', w: 2400, h: 870, d: 800,
      specs: { bodyThickness: 15, lowerH: 870, sinkLegHeight: 150, topThickness: 12 },
      modules: [
        { id: 'l1', type: 'storage', name: '하부장', pos: 'lower', w: 1200, h: 708, d: 770, doorCount: 2, is2door: true, isDrawer: false },
        { id: 'l2', type: 'storage', name: '하부장', pos: 'lower', w: 1200, h: 708, d: 770, doorCount: 2, is2door: true, isDrawer: false },
      ],
    }],
  };

  test('몸통·도어 부재가 나온다 (전에는 0 개)', () => {
    const r = snapshotOf(design);
    const parts = r.materials.map((m) => m.part);
    expect(parts).toContain('측판');
    expect(parts).toContain('도어');
    expect(r.materials.find((m) => m.part === '측판').w).toBe(770);
    expect(r.materials[0].itemLabel).toBe('아일랜드');
  });

  test('다리발이 나온다', () => {
    const r = snapshotOf(design);
    expect(r.hardware.some((h) => /다리/.test(h.category + h.item))).toBe(true);
  });
});

describe('빠른 배치 — 일자·ㄱ자·ㄷ자', () => {
  const P = require('../js/planner/planner-presets');
  const cfg = sections.buildSectionConfig(undefined, undefined, 'sink');

  /** alignToPerson 과 같은 셈 — 회전 후 앞(W 변) 중심 */
  function frontOf(m) {
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    const r = m.rotation;
    const sin = r === 90 ? 1 : r === 270 ? -1 : 0;
    const cos = r === 0 ? 1 : r === 180 ? -1 : 0;
    return { x: cx - (m.h / 2) * sin, y: cy + (m.h / 2) * cos };
  }
  /** 회전 후 화면 상자 */
  function boxOf(m) {
    const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
    const vert = m.rotation === 90 || m.rotation === 270;
    const w = vert ? m.h : m.w, h = vert ? m.w : m.h;
    return { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 };
  }

  test('품목별 모양 — 붙박이장·TV장·아일랜드는 일자만, 냉장고장은 없다', () => {
    expect(P.plannerPresetPlanOf('sink').kinds).toEqual(['I', 'L', 'U']);
    expect(P.plannerPresetPlanOf('wardrobe')).toEqual({ kinds: ['I'], sections: ['wardrobe'] });
    expect(P.plannerPresetPlanOf('tvcabinet')).toEqual({ kinds: ['I'], sections: ['lower'] });
    expect(P.plannerPresetPlanOf('island').kinds).toEqual(['I']);
    expect(P.plannerPresetPlanOf('fridge')).toBeNull();
    expect(P.plannerPresetLayout('L', { config: cfg, categoryId: 'tvcabinet' })).toBeNull();
  });

  test('본 줄 길이 = 품목 폭, 깊이 = 섹션 정본', () => {
    const L = P.plannerPresetLayout('I', { config: cfg, categoryId: 'sink', itemW: '3000' });
    const lower = L.modules.filter((m) => m.section === 'lower');
    expect(lower).toHaveLength(1);
    expect(lower[0]).toMatchObject({ w: 3000, h: cfg.lower.h, moduleH: cfg.lower.moduleH, rotation: 0 });
    expect(L.modules.find((m) => m.section === 'upper')).toMatchObject({ w: 3000, h: cfg.upper.h });
  });

  test.each(['L', 'U'])('%s — 옆 줄은 본 줄 깊이 아래에 붙고, 모든 앞이 사람 쪽이다', (kind) => {
    const L = P.plannerPresetLayout(kind, { config: cfg, categoryId: 'sink', itemW: 3000 });
    const lower = L.modules.filter((m) => m.section === 'lower');
    expect(lower).toHaveLength(kind === 'L' ? 2 : 3);
    const main = boxOf(lower[0]);
    lower.slice(1).forEach((m) => {
      const b = boxOf(m);
      expect(b.y0).toBe(main.y1);                       // 본 줄 바로 아래에서 시작
      expect(b.y1 - b.y0).toBe(cfg.lower.w);            // 옆 줄 길이 = 섹션 기본 폭
      expect(b.x0 === main.x0 || b.x1 === main.x1).toBe(true); // 벽 쪽 끝을 맞춘다
    });
    // 앞 중심이 사람과 가장 가까운 회전이어야 다음 사람 끌기에도 그대로 남는다
    lower.forEach((m) => {
      const f = frontOf(m);
      const back = frontOf({ ...m, rotation: (m.rotation + 180) % 360 });
      const d = (p) => Math.hypot(p.x - L.person.cx, p.y - L.person.cy);
      expect(d(f)).toBeLessThan(d(back));
    });
  });

  test('ㄱ자는 예전에 손으로 만들던 배치와 같은 모양이다 (회전 90, 앞이 왼쪽)', () => {
    const L = P.plannerPresetLayout('L', { config: cfg, categoryId: 'sink', itemW: 2400 });
    // 2026-10-20 점검에서 손으로 넣어 구조 단계가 ㄱ자(멍장)로 읽은 배치: x 1175, y 1225, 1800×650, 90°
    //   (옆 줄 길이만 1800 → 섹션 기본 폭으로 다르다)
    const side = L.modules[1];
    const b = boxOf(side);
    expect(side.rotation).toBe(90);
    expect([b.x0, b.x1, b.y0]).toEqual([2400 - 650, 2400, 650]);
  });

  test('배치 화면 — 빈 캔버스에 안내가 뜨고, 고르면 놓이고 안내가 사라진다', () => {
    const p = bootShell('?design=t&item=1&preset=sink&w=3000&d=650');
    expect(p.document.getElementById('presetHint').hidden).toBe(false);
    expect([...p.document.querySelectorAll('#presetHintRow button')].map((b) => b.textContent)).toEqual(['일자', 'ㄱ자', 'ㄷ자']);
    expect(p.g('applyPreset')('U')).toBe(true);
    const mods = p.g('serializeLayout')().modules;
    expect(mods.filter((m) => m.section === 'lower').map((m) => m.rotation)).toEqual([0, 90, 270]);
    expect(p.document.getElementById('presetHint').hidden).toBe(true);
  });

  test('붙박이장 화면은 일자 버튼만 보인다', () => {
    const p = bootShell('?design=t&item=1&preset=wardrobe');
    const shown = [...p.document.querySelectorAll('.preset-btn')].filter((b) => b.style.display !== 'none').map((b) => b.dataset.preset);
    expect(shown).toEqual(['I']);
  });
});

describe('도어교체·비규격장 BOM (2026-10-20 카드 "도어만·싱크대 규칙")', () => {
  const { snapshotOf } = require('../test-utils/bom-golden/golden');
  const designOf = (categoryId) => ({
    items: [{
      categoryId, w: 2400, h: 870, d: 650,
      specs: { bodyThickness: 15, lowerH: 870, sinkLegHeight: 150, topThickness: 12 },
      modules: [
        { id: 'l1', type: 'storage', name: '하부장', pos: 'lower', w: 900, h: 708, d: 550, doorCount: 2, is2door: true, isDrawer: false },
        { id: 'l2', type: 'storage', name: '서랍장', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 2 },
      ],
    }],
  });

  test('도어교체 — 도어·서랍 전면 판만, 철물은 경첩만', () => {
    const s = snapshotOf(designOf('door'));
    expect(s.materials.length).toBeGreaterThan(0);
    expect([...new Set(s.materials.map((m) => m.slot))].sort()).toEqual(['door', 'drawerFront']);
    expect(s.materials.every((m) => m.itemLabel === '도어교체')).toBe(true);
    expect(s.hardware.length).toBeGreaterThan(0);
    expect([...new Set(s.hardware.map((h) => h.category))]).toEqual(['경첩']);
  });

  test('도어교체 도어 판은 싱크대 규칙과 같은 치수다', () => {
    const door = snapshotOf(designOf('door')).materials.filter((m) => m.slot === 'door').map((m) => [m.w, m.h, m.qty]);
    const sink = snapshotOf(designOf('sink')).materials.filter((m) => m.slot === 'door').map((m) => [m.w, m.h, m.qty]);
    expect(door).toEqual(sink);
  });

  test('비규격장 — 싱크대 규칙 그대로 (몸통·도어·다리발)', () => {
    const custom = snapshotOf(designOf('custom'));
    const sink = snapshotOf(designOf('sink'));
    expect(custom.materials.map((m) => [m.part, m.w, m.h, m.qty])).toEqual(sink.materials.map((m) => [m.part, m.w, m.h, m.qty]));
    expect(custom.hardware.map((h) => [h.category, h.item, h.qty])).toEqual(sink.hardware.map((h) => [h.category, h.item, h.qty]));
    expect(custom.materials[0].itemLabel).toBe('비규격장');
  });

  test('아일랜드 측판 비고에 몸통 깊이 [확인 필요]', () => {
    const d = designOf('island');
    d.items[0].d = 800;
    const sides = snapshotOf(d).materials.filter((m) => m.part === '측판');
    expect(sides.length).toBeGreaterThan(0);
    sides.forEach((m) => expect(m.note).toContain('[확인 필요] 아일랜드 몸통 깊이'));
  });
});
