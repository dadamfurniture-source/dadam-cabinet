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

/**
 * T1 (PR1): makeNotchedPanel 이 기하에 건 변환 — translate(0, 0, −T/2) 뒤 rotateY(−90°).
 * 운영 코드는 그대로 두고, 여기서 같은 변환을 다시 걸어 **실제 꼭짓점과 같은지** 확인한 뒤에만 쓴다.
 * 다르면 makeNotchedPanel 이 바뀐 것이다 — 조용히 틀린 윤곽을 쓰지 않고 멈춘다.
 */
function notchedPanelFrame(THREE, geometry) {
  const prm = geometry.parameters || {};
  const shapes = Array.isArray(prm.shapes) ? prm.shapes : [prm.shapes];
  const T = prm.options && prm.options.depth;
  if (shapes.length !== 1 || !shapes[0] || !Number.isFinite(T)) return null;
  const M = new THREE.Matrix4().makeRotationY(-Math.PI / 2)
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, -T / 2));
  const fresh = new THREE.ExtrudeGeometry(shapes[0], prm.options);
  fresh.applyMatrix4(M);
  const a = fresh.attributes.position.array, b = geometry.attributes.position.array;
  let same = a.length === b.length;
  for (let i = 0; same && i < a.length; i++) same = Math.abs(a[i] - b[i]) < 1e-6;
  fresh.dispose();
  if (!same) return null;
  return { M, T, outline: shapes[0].getPoints().map((v) => [v.x, v.y]) };
}

/** 메시가 실제로 보이는가 — 자신과 조상 중 하나라도 visible=false 면 그려지지 않는다. */
function isShown(o) {
  for (let n = o; n; n = n.parent) if (n.visible === false) return false;
  return true;
}

/** partKey 가 없는 부재(서랍 박스·붙박이장 내부 등)의 이름 — entityKind 와 userData 의 순번. */
function pieceKeyOf(ud, partKey) {
  if (partKey) return partKey;
  const bits = ['carcassIdx', 'cellIdx', 'drawerIdx', 'dividerIdx', 'shelfIdx', 'rodIdx', 'areaIdx']
    .filter((k) => ud[k] != null).map((k) => `${k.replace(/Idx$/, '')}${ud[k]}`);
  return [ud.entityKind].concat(bits).join('#');
}

/**
 * T1 (PR1): 겹침 검사용 부재 목록 — `collectSceneParts` 와 달리 **합치지 않고** 메시 하나가 한 행이다.
 *
 * 행 { id, moduleId, section, entityKind, partKey, family, side, ud, matrixWorld, moduleAabb, solids, outline }
 *   matrixWorld  메시 로컬 → 월드 (three Matrix4.elements, 열 우선)
 *   solids       box-overlap.js 의 상자 목록 — 상자는 그 자체로 하나, 따낸 판은 단면을 직사각형으로 쪼갠 여럿
 *   moduleAabb   모듈 그룹 로컬 축의 바운딩 박스 {min, max} (mm) — 보고·명세 AABB 대조(개정 #7)용
 *   outline      따낸 판 단면 고리 [[x, y]…] (makeNotchedPanel 의 Shape, 기하 변환 전 좌표). 상자면 null
 *
 * 빼는 것: 화면용 메시(PLANNER_FINISH_PAINT_SKIP — 테두리·그림자판·선택 상자·배치 상자·다리발·표시)와
 *   와이어프레임(open 칸 틀), 숨긴 메시. partKey 가 없는 부재(drawerBox · 붙박이장 내부)는 **넣는다** —
 *   원장(collectSceneParts)은 BOM 행이 없어 빼지만, 겹침은 그것들이 가장 궁금한 곳이다.
 */
function collectScenePieces(p) {
  const three = p.three || p.g('three');
  const THREE = threeShim();
  const { rectilinearRects } = require('./box-overlap');
  const win = global.window;
  const partKeyOf = win.plannerFinishPartKeyOf || finish.plannerFinishPartKeyOf;
  const SKIP = finish.PLANNER_FINISH_PAINT_SKIP;
  const sectionOf = {};
  (p.g('modules') || []).forEach((m) => { sectionOf[m.id] = m.section; });
  three.moduleGroup.updateMatrixWorld(true);

  const out = [];
  const seen = {};
  three.moduleGroup.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const ud = o.userData || {};
    if (!ud.entityKind || SKIP.indexOf(ud.entityKind) >= 0) return;
    if (!isShown(o)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.every((mt) => mt && mt.wireframe)) return;          // open 칸 틀 — 선이지 판이 아니다
    if (ud.entityKind === 'carcass' && ud.side === 'front' && ud.areaType === 'open') return;

    // 모듈 그룹 — 모듈 로컬 AABB 의 기준
    let group = o.parent;
    while (group && !(group.userData && group.userData.entityKind === 'module')) group = group.parent;
    const toModule = new THREE.Matrix4();
    if (group) toModule.copy(group.matrixWorld).invert();
    toModule.multiply(o.matrixWorld);

    const geo = o.geometry;
    let solids, outline = null;
    const frame = geo.type === 'ExtrudeGeometry' ? notchedPanelFrame(THREE, geo) : null;
    if (geo.type === 'ExtrudeGeometry' && !frame) {
      throw new Error(`${ud.moduleId} ${ud.entityKind}/${ud.side}: makeNotchedPanel 과 다른 ExtrudeGeometry — 윤곽을 읽는 법을 scene-parts.js 에 더하세요`);
    }
    if (frame) {
      outline = frame.outline;
      const m = new THREE.Matrix4().multiplyMatrices(o.matrixWorld, frame.M).elements.slice();
      solids = rectilinearRects(outline).map((r) => ({ min: [r.x0, r.y0, 0], max: [r.x1, r.y1, frame.T], m }));
    } else {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const bb = geo.boundingBox;
      solids = [{ min: bb.min.toArray(), max: bb.max.toArray(), m: o.matrixWorld.elements.slice() }];
    }
    // 모듈 로컬 AABB — 상자마다 꼭짓점을 옮겨 모은다
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const local = frame ? new THREE.Matrix4().multiplyMatrices(toModule, frame.M) : toModule;
    const v = new THREE.Vector3();
    solids.forEach((s) => {
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? s.max[0] : s.min[0], i & 2 ? s.max[1] : s.min[1], i & 4 ? s.max[2] : s.min[2]).applyMatrix4(local);
        const a = v.toArray();
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[k]); hi[k] = Math.max(hi[k], a[k]); }
      }
    });
    const round = (a) => a.map((x) => Math.round(x * 10) / 10);

    const partKey = partKeyOf(ud);
    const key = pieceKeyOf(ud, partKey);
    const moduleId = ud.moduleId == null ? '?' : String(ud.moduleId);
    const base = `${moduleId}|${key}`;
    seen[base] = (seen[base] || 0) + 1;
    out.push({
      id: seen[base] > 1 ? `${base}~${seen[base]}` : base,
      moduleId,
      section: sectionOf[moduleId] || null,
      entityKind: ud.entityKind,
      partKey: partKey || null,
      key,
      family: partKey ? familyOfPartKey(partKey) : ud.entityKind,
      side: ud.side || null,
      ud,
      matrixWorld: o.matrixWorld.elements.slice(),
      moduleAabb: { min: round(lo), max: round(hi) },
      solids,
      outline,
    });
  });
  // 같은 이름이 둘 이상이면 첫째에도 ~1 을 붙인다 — 어느 것이 어느 것인지 보고에서 헷갈리지 않게
  out.forEach((r) => { if (seen[r.id] > 1) r.id = `${r.id}~1`; });
  return out;
}

/** 부팅 + 순회 한 번에. */
function scenePartsOf(layout, opts) {
  const p = bootPlanner3D(layout, opts);
  return { planner: p, parts: collectSceneParts(p) };
}

module.exports = {
  bootPlanner3D,
  collectSceneParts,
  collectScenePieces,
  scenePartsOf,
  familyOfPartKey,
  normalizeDims,
  threeShim,
  StubWebGLRenderer,
};
