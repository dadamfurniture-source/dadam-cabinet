/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, global */
/**
 * C1a: 3D 씬 부재 목록 — 플래너(mockup-structure)가 **실제로 그린** mesh 를 순회해 정규화한다.
 * (docs/01-plan/detail-bom-deepening.plan.md §4.5 · §5 C1a)
 *
 * 왜 필요한가:
 *   3D 빌더(createModuleMesh 계열)와 BOM(extractors.js)이 **각자** 부재를 만든다. 둘이 어긋나면
 *   "도면과 다른 BOM" 이 된다. 이 파일은 그 대조의 3D 쪽 절반이다 — BOM 쪽은 `bom-parts.js`.
 *
 * 어떻게 3D 를 jsdom 에서 켜는가:
 *   플래너는 `if (three || !window.THREE) return;` 으로 three 가 없으면 3D 를 건너뛴다. 여기서는
 *   `require('three')`(CJS 빌드)를 window 에 올리되 WebGL 이 필요한 `WebGLRenderer` 와 addons 의
 *   `OrbitControls` 만 스텁으로 바꾼다. 기하·userData 를 만드는 코드는 renderer 를 쓰지 않으므로
 *   **부재 목록은 브라우저와 같다.** 그리기(render)만 안 한다.
 *
 * 무엇을 부재로 세는가 (계획 §4.2 · planner-finish.js PLANNER_FINISH_PAINT_SKIP):
 *   `edge`(테두리선) · `reveal`(도어 뒤 그림자판) · `doorEdge`(테두리 막대) · `carcass-line`(서랍 분할선)
 *   · `pick`(선택 상자) · `area`(배치 공간 상자) · `module`(그룹) · `leg`(다리발 — 플라스틱 부속, 철물)
 *   은 **표시용이거나 자재가 아니라** 뺀다. `open` 칸의 와이어프레임 틀도 부재가 아니다
 *   (plannerFinishPartKeyOf 가 null 을 준다). 나머지 mesh 는 전부 센다 — 먹장(blank)·멍판·목찬넬·좌대 포함.
 *
 * 정규화 행:
 *   { moduleId, section, entityKind, slot, partKey, family, x, y, z, a, b, t, qty }
 *     x·y·z  기하 크기(mm, 반올림) — X 가로 · Y 세로 · Z 깊이 (모듈 로컬)
 *     a ≥ b  판의 두 변 (t 를 뺀 나머지 둘, 큰 순). BOM 이 w/h 를 어느 쪽으로 적든 비교되게 순서 없는 쌍으로 둔다
 *     t      가장 짧은 변 = 판 두께
 *     family partKey 에서 순번(`#…`)을 뗀 종류 이름. BOM 의 BOM_PART_DEFS key 와 같은 이름을 쓴다
 *   같은 (moduleId, family, a, b, t) 는 qty 로 합친다.
 */
const { bootPlanner } = require('./planner-harness');
const { seedFor } = require('./planner-golden');
const finish = require('../js/planner/planner-finish.js');

/** WebGL 없이 넘어가는 renderer — 플래너가 부르는 메서드만 있다. */
class StubWebGLRenderer {
  constructor(opts) {
    this.domElement = (opts && opts.canvas) || { clientWidth: 0, clientHeight: 0 };
    this.shadowMap = { enabled: false, type: 0 };
  }
  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
  render() {}
  dispose() {}
}

/** three/addons 의 OrbitControls 자리 — target 과 update 만 쓰인다. */
function makeStubOrbitControls(THREE) {
  return class StubOrbitControls {
    constructor() {
      this.target = new THREE.Vector3();
      this.enableDamping = false;
      this.dampingFactor = 0;
    }
    update() {}
    addEventListener() {}
    removeEventListener() {}
    dispose() {}
  };
}

let shim = null;
/** three CJS 빌드 + renderer 스텁. 한 번만 만든다. */
function threeShim() {
  if (shim) return shim;
  const THREE = require('three');
  shim = Object.assign({}, THREE, { WebGLRenderer: StubWebGLRenderer });
  return shim;
}

/**
 * 3D 가 켜진 플래너를 부팅한다.
 *
 * @param {object} layout  `dadam_layout_v1` 배치 JSON (planner-golden.js FIXTURES 모양)
 * @param {{ autoCalc?: boolean, design?: string, item?: string }} [opts]
 *   autoCalc  기본 true — 전체 자동계산(autoCalcAllAreas) 뒤 renderAll3D 를 **직접** 부른다.
 *             (autoCalcAllAreas 안의 renderAll3D 는 try/catch 로 삼키므로 오류가 숨는다)
 * @returns 플래너 하네스 객체 + `three`
 */
function bootPlanner3D(layout, opts = {}) {
  const win = global.window;
  const THREE = threeShim();
  win.THREE = THREE;
  win.OrbitControls = makeStubOrbitControls(THREE);
  // init3D 의 animate() 가 requestAnimationFrame 으로 무한 루프를 돈다 — 시험에서는 한 프레임도 필요 없다.
  win.requestAnimationFrame = () => 0;
  win.cancelAnimationFrame = () => {};

  const seed = seedFor(layout, { design: opts.design || 'ledger', item: opts.item || '1', modules: false });
  const search = seed._search;
  delete seed._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  const three = p.g('three');
  if (!three || !three.moduleGroup) throw new Error('3D 가 초기화되지 않았습니다 — window.THREE 주입이 실패했습니다');
  if (opts.autoCalc !== false) p.g('autoCalcAllAreas')();
  p.g('renderAll3D')({ fit: false });
  p.three = three;
  return p;
}

/** partKey 에서 순번을 떼고 BOM 쪽 이름으로 맞춘다. 두 이름 체계는 bom-protocol.md §7-1 표가 정본. */
function familyOfPartKey(partKey) {
  if (!partKey) return null;
  const base = String(partKey).split('#')[0];
  switch (base) {
    case 'body:left':
    case 'body:right': return 'body:side';                // BOM 측판은 좌·우 한 행 (qty 2)
    case 'body:back': return 'back';                      // BOM 뒷판 (slot back, 2.7T)
    case 'channel:channelFace': return 'channel:front';   // 목찬넬 전면판 (BOM '목찬넬(전면)')
    case 'channel:channelBase': return 'channel:back';    // 목찬넬 지면판 (BOM '목찬넬(지면)')
    case 'brace': return 'body:brace';                    // 양문 가운데 처짐방지목 (BOM '밴드(처짐방지)')
    default: return base;
  }
}

/** mesh 기하의 크기(mm). BoxGeometry 는 parameters 그대로, 따낸 판(ExtrudeGeometry)은 바운딩 박스로. */
function geometrySize(THREE, geometry) {
  const prm = geometry.parameters || {};
  if (Number.isFinite(prm.width) && Number.isFinite(prm.height) && Number.isFinite(prm.depth)) {
    return { x: prm.width, y: prm.height, z: prm.depth };
  }
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const s = new THREE.Vector3();
  geometry.boundingBox.getSize(s);
  return { x: s.x, y: s.y, z: s.z };
}

function normalizeDims(size) {
  const x = Math.round(size.x), y = Math.round(size.y), z = Math.round(size.z);
  const sorted = [x, y, z].sort((p, q) => q - p);
  return { x, y, z, a: sorted[0], b: sorted[1], t: sorted[2] };
}

/**
 * 부팅된 플래너의 `three.moduleGroup` 을 순회해 정규화 부재 목록을 낸다.
 * @param {ReturnType<typeof bootPlanner3D>} p
 * @returns {Array<object>} 합쳐진 행 (qty)
 */
function collectSceneParts(p) {
  const three = p.three || p.g('three');
  const THREE = threeShim();
  const win = global.window;
  const partKeyOf = win.plannerFinishPartKeyOf || finish.plannerFinishPartKeyOf;
  const slotOf = win.plannerFinishSlotOf || finish.plannerFinishSlotOf;
  const SKIP = finish.PLANNER_FINISH_PAINT_SKIP;
  const sectionOf = {};
  (p.g('modules') || []).forEach((m) => { sectionOf[m.id] = m.section; });

  const merged = new Map();
  const order = [];
  three.moduleGroup.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const ud = o.userData || {};
    if (!ud.entityKind || SKIP.indexOf(ud.entityKind) >= 0) return;
    const partKey = partKeyOf(ud);
    if (partKey == null) return;                     // open 칸 와이어프레임 틀 — 부재가 아니다
    const d = normalizeDims(geometrySize(THREE, o.geometry));
    const family = familyOfPartKey(partKey);
    const moduleId = ud.moduleId == null ? '?' : String(ud.moduleId);
    const key = `${moduleId}|${family}|${d.a}|${d.b}|${d.t}`;
    if (merged.has(key)) { merged.get(key).qty += 1; merged.get(key).partKeys.push(partKey); return; }
    const row = {
      moduleId,
      section: sectionOf[moduleId] || null,
      entityKind: ud.entityKind,
      slot: slotOf(ud),
      partKey,
      partKeys: [partKey],
      family,
      x: d.x, y: d.y, z: d.z,
      a: d.a, b: d.b, t: d.t,
      qty: 1,
    };
    merged.set(key, row);
    order.push(row);
  });
  return order;
}

/** 부팅 + 순회 한 번에. */
function scenePartsOf(layout, opts) {
  const p = bootPlanner3D(layout, opts);
  return { planner: p, parts: collectSceneParts(p) };
}

module.exports = {
  bootPlanner3D,
  collectSceneParts,
  scenePartsOf,
  familyOfPartKey,
  normalizeDims,
  threeShim,
  StubWebGLRenderer,
};
