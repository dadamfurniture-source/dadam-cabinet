/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global, __dirname */
/**
 * 기둥·배관 따내기 (ArchiWood 영상 분석 D, 2026-10-19).
 *
 *   · 판 윤곽 — 사각형 빼기, 구석·변 가운데·한가운데(구멍)
 *   · 3D 판 — 따낸 자리로 광선이 지나간다, 방향은 측판·천지판 규칙대로
 *   · 플래너 패널 입력 → 초안 → 적용 → 3D
 *   · 브리지 → BOM 비고 (치수·수량은 그대로)
 */
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const C = require('../js/planner/planner-cutout.js');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const outline = (A, B, cuts) =>
  C.plannerPanelOutline(
    A,
    B,
    cuts.map((c) => C.plannerCutoutRect(c, A, B))
  );

describe('판 윤곽', () => {
  test('따내기 없으면 사각형 그대로', () => {
    expect(outline(600, 700, [])).toEqual({
      outer: [
        [0, 0],
        [600, 0],
        [600, 700],
        [0, 700],
      ],
      holes: [],
    });
  });

  test('구석 (뒤·아래) 80 × 350 — ㄴ자 여섯 꼭짓점', () => {
    const o = outline(600, 700, [{ row: 0, col: 0, w: 80, h: 350 }]);
    expect(o.holes).toEqual([]);
    expect(o.outer).toHaveLength(6);
    expect(o.outer).toContainEqual([80, 350]);
    expect(o.outer).not.toContainEqual([0, 0]);
  });

  test('변 가운데 (가운데·위) — 홈 여덟 꼭짓점', () => {
    const o = outline(600, 700, [{ row: 2, col: 1, w: 80, h: 100 }]);
    expect(o.outer).toHaveLength(8);
    expect(o.outer).toContainEqual([260, 600]);
    expect(o.outer).toContainEqual([340, 600]);
  });

  test('한가운데는 구멍', () => {
    const o = outline(600, 700, [{ row: 1, col: 1, w: 80, h: 100 }]);
    expect(o.outer).toHaveLength(4);
    expect(o.holes).toHaveLength(1);
    expect(o.holes[0]).toContainEqual([260, 300]);
  });

  test('판보다 큰 따내기는 들어가지 않는다', () => {
    expect(C.plannerCutoutFits({ w: 80, h: 350 }, 600, 700)).toBe(true);
    expect(C.plannerCutoutFits({ w: 600, h: 100 }, 600, 700)).toBe(false);
  });
});

describe('저장값 · 글', () => {
  test('판·격자·치수가 틀린 줄은 버린다', () => {
    const s = {
      cutouts: [
        { panel: 'left', row: 0, col: 0, w: 80, h: 350 },
        { panel: 'back', row: 0, col: 0, w: 80, h: 350 },
        { panel: 'bottom', row: 3, col: 0, w: 80, h: 350 },
        { panel: 'bottom', row: '2', col: '1', w: '100', h: 0 },
        { panel: 'bottom', row: '2', col: '1', w: '100', h: '120' },
      ],
    };
    expect(C.plannerCutoutsOf(s)).toEqual([
      { panel: 'left', row: 0, col: 0, w: 80, h: 350 },
      { panel: 'bottom', row: 2, col: 1, w: 100, h: 120 },
    ]);
    expect(C.plannerCutoutsOf({})).toEqual([]);
  });

  test('글 — 판 · 가로×세로 · 열·행', () => {
    expect(C.plannerCutoutLabel({ panel: 'left', row: 0, col: 0, w: 80, h: 350 })).toBe(
      '좌측판 80×350 뒤·아래'
    );
    expect(C.plannerCutoutLabel({ panel: 'bottom', row: 0, col: 2, w: 100, h: 120 })).toBe(
      '지판 100×120 우·뒤'
    );
  });
});

describe('3D 판', () => {
  const hit = (mesh, origin, dir) => {
    mesh.updateMatrixWorld(true);
    return new THREE.Raycaster(origin, dir).intersectObject(mesh).length > 0;
  };

  test('측판 — 두께 X, 깊이 Z(앞 +), 높이 Y. 뒤·아래 따낸 자리로 광선이 지나간다', () => {
    const A = 560;
    const B = 700;
    const rects = [C.plannerCutoutRect({ row: 0, col: 0, w: 80, h: 350 }, A, B)];
    const m = C.plannerCutPanelMesh(THREE, { A, B, T: 18, rects, orient: 'side', color: 0xcccccc });
    m.geometry.computeBoundingBox();
    const size = m.geometry.boundingBox.getSize(new THREE.Vector3());
    expect([size.x, size.y, size.z].map(Math.round)).toEqual([18, 700, 560]);
    const x = new THREE.Vector3(1, 0, 0);
    expect(hit(m, new THREE.Vector3(-100, -350 + 100, -280 + 40), x)).toBe(false); // 뒤·아래 = 따낸 자리
    expect(hit(m, new THREE.Vector3(-100, -350 + 100, 280 - 40), x)).toBe(true); // 앞·아래 = 판
  });

  test('천·지판 — 두께 Y, 폭 X, 깊이 Z(앞 +). 우·뒤 따낸 자리로 광선이 지나간다', () => {
    const A = 564;
    const B = 550;
    const rects = [C.plannerCutoutRect({ row: 0, col: 2, w: 100, h: 120 }, A, B)];
    const m = C.plannerCutPanelMesh(THREE, { A, B, T: 18, rects, orient: 'flat', color: 0xcccccc });
    m.geometry.computeBoundingBox();
    const size = m.geometry.boundingBox.getSize(new THREE.Vector3());
    expect([size.x, size.y, size.z].map(Math.round)).toEqual([564, 18, 550]);
    const y = new THREE.Vector3(0, -1, 0);
    expect(hit(m, new THREE.Vector3(282 - 50, 100, -275 + 60), y)).toBe(false);
    expect(hit(m, new THREE.Vector3(-282 + 50, 100, -275 + 60), y)).toBe(true);
    expect(hit(m, new THREE.Vector3(282 - 50, 100, 275 - 60), y)).toBe(true);
  });
});

describe('플래너', () => {
  function pickLower(p) {
    const area = p.g('areas').find((a) => a.section === 'lower') || p.g('areas')[0];
    const m = p.g('addModuleToArea')(area.id);
    p.g('setActiveModule')(m.id);
    return { m, s: p.g('getStructure')(m.id) };
  }

  test('따내기 추가 → 초안 → 적용, 하부장은 천판을 고를 수 없다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ct1&item=1', storage: {} });
    const { s } = pickLower(p);
    p.g('renderRightPanel')();
    p.document.getElementById('btnAddCutout').click();
    const row = p.document.querySelector('#cutoutBody [data-cut-idx="0"]');
    expect(row).not.toBeNull();
    const panelSel = row.querySelector('[data-cut="panel"]');
    expect([...panelSel.options].map((o) => o.value)).toEqual(['left', 'right', 'bottom']);
    const w = row.querySelector('[data-cut="w"]');
    w.value = '80';
    w.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    expect(s.cutouts).toBeUndefined(); // 적용 전엔 초안만
    p.g('applyModuleDraft')();
    expect(s.cutouts).toEqual([{ panel: 'bottom', row: 0, col: 0, w: 80, h: 100 }]);
    expect(p.errors).toEqual([]);
  });

  test('판보다 큰 따내기는 경고만 하고 그리지 않는다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ct2&item=1', storage: {} });
    const { m } = pickLower(p);
    p.g('getStructure')(m.id).cutouts = [{ panel: 'left', row: 0, col: 0, w: 5000, h: 100 }];
    p.g('renderRightPanel')();
    expect(p.document.getElementById('cutoutBody').textContent).toContain('판(');
    expect(p.document.getElementById('cutoutBody').textContent).toContain('그리지 않습니다');
  });

  test('3D — 따낸 판은 ExtrudeGeometry, 나머지는 그대로', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=ct3&item=1', storage: {} });
    const { m } = pickLower(p);
    const s = p.g('getStructure')(m.id);
    s.cutouts = [
      { panel: 'bottom', row: 0, col: 0, w: 80, h: 200 },
      { panel: 'right', row: 0, col: 0, w: 60, h: 300 },
    ];
    global.THREE = THREE; // 하네스는 three.js 를 싣지 않는다 — 모듈 그림만 그려 본다
    p.window.THREE = THREE;
    const g = p.g('createModuleMesh')(m, s);
    const bySide = {};
    g.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.entityKind === 'carcass' && o.userData.side) {
        bySide[o.userData.side] = o.geometry.type;
      }
    });
    expect(bySide.bottom).toBe('ExtrudeGeometry');
    expect(bySide.right).toBe('ExtrudeGeometry');
    expect(bySide.top).toBe('BoxGeometry');
    expect(p.errors).toEqual([]);
  });

  test('HTML 배선', () => {
    const html = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(html).toMatch(/<script src="js\/planner\/planner-cutout\.js\?v=[\d.]+"><\/script>/);
    expect(html).toContain('data-mp="cutout"');
    expect(html).toContain('cutouts: plannerCutoutsOf(s)');
  });
});

describe('브리지 → BOM', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');
  const block = SRC.slice(
    SRC.indexOf('const PLANNER_CABINET_SECTIONS'),
    SRC.indexOf('function _applyPlannerResult')
  );
  const { _convertPlannerModules } = new Function(`${block}; return { _convertPlannerModules };`)();

  const payload = () => ({
    modules: [{ id: 'lower-0', section: 'lower', W: 1500, H: 870, D: 650, x: 0, y: 0 }],
    structures: {
      'lower-0': {
        horizontalLayout: 'doorOnly',
        areaTypes: ['door', 'door', 'door'],
        areaWidths: [450, 600, 450],
        areaIs2D: [false, false, false],
        cutouts: [
          { panel: 'left', row: 0, col: 0, w: 80, h: 350 },
          { panel: 'right', row: 0, col: 2, w: 60, h: 100 },
          { panel: 'bottom', row: 0, col: 1, w: 100, h: 120 },
          { panel: 'top', row: 0, col: 0, w: 50, h: 50 },
        ],
      },
    },
  });

  test('좌측판 → 첫 셀, 우측판 → 끝 셀, 지판 가운데 → 가운데 셀', () => {
    const mods = _convertPlannerModules(payload()).modules;
    expect(mods).toHaveLength(3);
    expect(mods[0].cutouts.map((c) => c.panel)).toEqual(['left', 'top']);
    expect(mods[1].cutouts.map((c) => c.panel)).toEqual(['bottom']);
    expect(mods[2].cutouts.map((c) => c.panel)).toEqual(['right']);
  });

  test('BOM — 그 모듈의 판 비고에 적고 치수·수량은 그대로, 하부장 천판은 행이 없어 건너뛴다', () => {
    global.dlog = () => {};
    const { MaterialExtractor } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
    const mods = _convertPlannerModules(payload()).modules;
    const specs = {
      layoutShape: 'I',
      bodyThickness: 15,
      lowerH: 870,
      upperH: 720,
      sinkLegHeight: 150,
      topThickness: 12,
    };
    const item = {
      uniqueId: 1,
      categoryId: 'sink',
      name: '싱크대',
      w: 1500,
      h: 2310,
      d: 650,
      specs,
      modules: mods,
    };
    const rows = new MaterialExtractor().extract({ items: [item] }).materials;
    const of = (id, part) => rows.find((r) => r.moduleKey === `0-${id}` && r.part === part);
    expect(of(mods[0].id, '측판').note).toBe('따내기 좌측판 80×350 뒤·아래');
    expect(of(mods[0].id, '측판').qty).toBe(2);
    expect(of(mods[2].id, '측판').note).toBe('따내기 우측판 60×100 앞·아래');
    expect(of(mods[1].id, '지판').note).toBe('따내기 지판 100×120 가운데·뒤');
    expect(of(mods[1].id, '지판').w).toBe(600 - 30);
    expect(rows.some((r) => /따내기 천판/.test(r.note || ''))).toBe(false);
  });
});
