// ============================================================
// 조립 명세 → 3D 판재 — planner-assembly-mesh.js (구조 페이지, 다담 CAD 베타 PR12)
//
// 몸통(측판·지판·천판·밴드·뒷판) · 처짐방지목 · 선반을 플래너가 따로 셈하지 않고 조립 명세(bom-assembly.js)
// 판재 그대로 그린다 — BOM 재단 치수 · 명세 자리. 그래서 3D 와 BOM 이 같은 목록이 된다 (원장 시험).
//
// 규칙을 새로 두지 않는다. 판재 하나 = frame { o, u, v, n } 에서 u 로 cut.w, v 로 cut.h, n 으로 t.
//   따내기(notch, 관통)는 판 윤곽에서 뺀다 — plannerPanelOutline (planner-cutout.js) 과 같은 윤곽.
//   홈(groove)은 깊이가 미정(D5)이라 그리지 않는다.
//
// 어느 모듈을 명세로 그리나 (plannerAssemblyModuleFor) — 아래를 모두 만족할 때만, 아니면 예전 그리기:
//   · 플래너 모듈이 명세 모듈 **하나**로만 간다 (다칸 모듈은 결정 D1 전까지 예전 그대로)
//   · 명세가 그 모듈의 몸통 · 처짐방지목 · 선반 행을 **전부** 놓았다 (unplaced 가 하나라도 있으면 예전 그대로 —
//     자리를 모르는 부재를 지어내지 않는다)
//   · 부르는 쪽이 따로 거르는 것: 마감재 · 가전 자리 · 오픈장 · 밥솥장 · 붙박이장 통 · 멍장 · 기둥 따내기
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_ASM_ / plannerAssembly / PlannerAssembly 접두.
// ============================================================

/** 이 단계(PR12)에서 명세로 그리는 부재 종류 (BOM partKey 의 `#` 앞). 도어·서랍·목찬넬·서랍 박스는 PR13. */
const PLANNER_ASM_FAMILIES = ['body:side', 'body:bottom', 'body:top', 'body:band', 'back', 'body:brace', 'shelf'];
const PLANNER_ASM_SHELF_COLOR = '#e8d8b8';

const PLANNER_ASM_AXIS = { x: 0, y: 1, z: 2 };

/** 명세 행 partId `${moduleKey}-${partKey}-${n}` → { partKey, family, n } */
function plannerAssemblyKeyOf(rowPartId, moduleKey) {
  const s = String(rowPartId || '');
  const head = String(moduleKey || '') + '-';
  if (s.indexOf(head) !== 0) return null;
  const m = s.slice(head.length).match(/^(.*)-(\d+)$/);
  if (!m) return null;
  return { partKey: m[1], family: m[1].split('#')[0], n: Number(m[2]) };
}

/** 이 단계에서 그리는 판재인가 — 종류가 몸통·처짐방지목·선반이고, 서랍 박스 판(tags.box)이 아니다. */
function plannerAssemblyInScope(part, moduleKey) {
  const k = plannerAssemblyKeyOf(part && part.rowPartId, moduleKey);
  if (!k || PLANNER_ASM_FAMILIES.indexOf(k.family) < 0) return false;
  return !(part.tags && part.tags.box != null);
}

/**
 * 플래너 모듈 → 명세 모듈 (명세로 그릴 수 있을 때만).
 * @param {{spec:object, cells:Object<string,{plannerId:string,dx:number}>}} asm  plannerExportCadSpec 결과
 * @param {string} plannerId
 * @returns {{module:object, dx:number, parts:Array}|null}
 */
function plannerAssemblyModuleFor(asm, plannerId) {
  if (!asm || !asm.spec || !asm.cells) return null;
  const id = String(plannerId);
  const keys = Object.keys(asm.cells).filter((mk) => String(asm.cells[mk].plannerId) === id);
  if (keys.length !== 1) return null;                       // 다칸 · 못 찾음
  const mk = keys[0];
  let mod = null;
  (asm.spec.items || []).forEach((it) => (it.modules || []).forEach((m) => { if (m.moduleKey === mk) mod = m; }));
  if (!mod) return null;
  // 그 모듈의 몸통·처짐방지목·선반 행이 하나라도 자리 미정이면 예전 그리기
  const pending = (asm.spec.unplaced || []).some((u) => {
    if (u.moduleKey !== mk) return false;
    const k = plannerAssemblyKeyOf(u.rowPartId, mk);
    return !k || PLANNER_ASM_FAMILIES.indexOf(k.family) >= 0;
  });
  if (pending) return null;
  const parts = (mod.parts || []).filter((p) => plannerAssemblyInScope(p, mk));
  if (!parts.length) return null;
  return { module: mod, dx: Number(asm.cells[mk].dx) || 0, parts };
}

/** 부호 있는 축 '+x' → 단위 벡터 [1,0,0] */
function plannerAssemblyAxis(a) {
  const v = [0, 0, 0];
  v[PLANNER_ASM_AXIS[a[1]]] = a[0] === '-' ? -1 : 1;
  return v;
}

/**
 * 판재 userData — 원장·마감 칠하기(planner-finish.js plannerFinishPartKeyOf)가 BOM 과 같은 이름을 읽게.
 *   몸통 판 → entityKind 'carcass' + side (측판은 left/right, 그 밖은 partKey 의 'body:' 뒤 · 뒷판 'back')
 *   처짐방지목 → 'brace' (braceIdx) · 선반 → 'shelf' (shelfIdx)
 */
function plannerAssemblyUserData(part, moduleKey, plannerId) {
  const k = plannerAssemblyKeyOf(part.rowPartId, moduleKey) || { partKey: '', family: '', n: 0 };
  const k3 = Number(String(part.id).split('#').pop()) || 0;
  const base = { moduleId: plannerId, partId: part.id, rowPartId: part.rowPartId, key3d: moduleKey + '|' + part.id, assembly: true };
  if (k.family === 'body:brace') return Object.assign({ entityKind: 'brace', braceIdx: k3 }, base);
  if (k.family === 'shelf') return Object.assign({ entityKind: 'shelf', shelfIdx: k3, cellIdx: 0 }, base);
  let side;
  if (k.family === 'body:side') side = (part.tags && part.tags.side) || 'side';
  else if (k.family === 'back') side = 'back';
  else side = k.partKey.replace(/^body:/, '');
  return Object.assign({ entityKind: 'carcass', side }, base);
}

/**
 * 판재 하나 → THREE.Mesh (모듈 로컬 = 명세 좌표, mm).
 *   따내기가 없으면 box 크기의 BoxGeometry 를 box 가운데에 둔다 (기하 크기 = 재단 치수).
 *   따내기가 있으면 (u, v) 윤곽을 n 으로 t 만큼 누른 뒤 frame 으로 옮긴다 (기하에 굽는다).
 * @param {object} THREE
 * @param {object} part   명세 판재
 * @param {string} color
 * @param {(u0,u1,v0,v1)=>any} [outlineOf]  plannerPanelOutline (A, B, rects) — 없으면 전역
 */
function plannerAssemblyMeshOf(THREE, part, color, outlineOf) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), metalness: 0.05, roughness: 0.65,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });
  const notches = (part.features || []).filter((f) => f.type === 'notch');
  const bmin = part.box.min, bmax = part.box.max;
  if (!notches.length) {
    const geo = new THREE.BoxGeometry(bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((bmin[0] + bmax[0]) / 2, (bmin[1] + bmax[1]) / 2, (bmin[2] + bmax[2]) / 2);
    return mesh;
  }
  const outline = outlineOf || (typeof plannerPanelOutline === 'function' ? plannerPanelOutline : null);
  if (!outline) throw new Error('plannerPanelOutline(planner-cutout.js) 이 없습니다');
  const A = part.cut.w, B = part.cut.h;
  const ol = outline(A, B, notches.map((f) => ({ u0: f.u0, u1: f.u1, v0: f.v0, v1: f.v1 })));
  const pt = (p) => new THREE.Vector2(p[0], p[1]);
  const shape = new THREE.Shape(ol.outer.map(pt));
  ol.holes.forEach((h) => shape.holes.push(new THREE.Path(h.map(pt))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: part.t, bevelEnabled: false });
  const U = plannerAssemblyAxis(part.frame.u), V = plannerAssemblyAxis(part.frame.v), N = plannerAssemblyAxis(part.frame.n);
  const o = part.frame.o;
  const M = new THREE.Matrix4().set(
    U[0], V[0], N[0], o[0],
    U[1], V[1], N[1], o[1],
    U[2], V[2], N[2], o[2],
    0, 0, 0, 1);
  geo.applyMatrix4(M);
  // 거울 변환(행렬식 < 0)이면 면이 뒤집힌다 — 삼각형 꼭짓점 순서를 바꿔 바깥을 향하게
  if (M.determinant() < 0) plannerAssemblyFlipWinding(geo);
  return new THREE.Mesh(geo, mat);
}

/** 색인 없는 기하의 삼각형마다 둘째·셋째 꼭짓점을 맞바꾼다 (위치·법선·uv). */
function plannerAssemblyFlipWinding(geo) {
  if (geo.index) {
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    geo.index.needsUpdate = true;
    return;
  }
  Object.keys(geo.attributes).forEach((name) => {
    const at = geo.attributes[name];
    const n = at.itemSize, a = at.array;
    for (let i = 0; i + 3 * n <= a.length; i += 3 * n) {
      for (let c = 0; c < n; c++) { const t = a[i + n + c]; a[i + n + c] = a[i + 2 * n + c]; a[i + 2 * n + c] = t; }
    }
    at.needsUpdate = true;
  });
}

/**
 * 모듈 그룹에 명세 판재를 넣는다.
 * @param {object} THREE
 * @param {THREE.Group} parent  플래너 모듈 그룹 (로컬: x 가운데 · y 모듈 바닥 · z 깊이 가운데)
 * @param {{module, dx, parts}} hit  plannerAssemblyModuleFor 결과
 * @param {{ plannerId, baseY:number, color:string, braceColor?:string, outline?:Function, onEdge?:Function }} o
 *   baseY  몸통 바닥 높이 (다리발·좌대, baseOffsetOf) — 명세 y = 0 이 몸통 바닥이다
 *   onEdge (mesh, holder) — 테두리 선을 그리는 쪽 (플래너 addEdgeOutline)
 * @returns {number} 넣은 판재 수
 */
function plannerAssemblyAddParts(THREE, parent, hit, o) {
  const holder = new THREE.Group();
  holder.name = 'assembly:' + hit.module.moduleKey;
  holder.position.set(hit.dx, o.baseY || 0, 0);
  holder.userData = { entityKind: 'assembly-holder', moduleId: o.plannerId, display: true };
  parent.add(holder);
  hit.parts.forEach((p) => {
    const ud = plannerAssemblyUserData(p, hit.module.moduleKey, o.plannerId);
    const color = ud.entityKind === 'shelf' ? PLANNER_ASM_SHELF_COLOR
      : ud.entityKind === 'brace' ? (o.braceColor || o.color) : o.color;
    const mesh = plannerAssemblyMeshOf(THREE, p, color, o.outline);
    mesh.userData = ud;
    holder.add(mesh);
    if (typeof o.onEdge === 'function') o.onEdge(mesh, holder);
  });
  return hit.parts.length;
}

if (typeof window !== 'undefined') {
  window.PLANNER_ASM_FAMILIES = PLANNER_ASM_FAMILIES;
  window.plannerAssemblyKeyOf = plannerAssemblyKeyOf;
  window.plannerAssemblyModuleFor = plannerAssemblyModuleFor;
  window.plannerAssemblyMeshOf = plannerAssemblyMeshOf;
  window.plannerAssemblyAddParts = plannerAssemblyAddParts;
  window.plannerAssemblyUserData = plannerAssemblyUserData;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_ASM_FAMILIES,
    plannerAssemblyKeyOf,
    plannerAssemblyInScope,
    plannerAssemblyModuleFor,
    plannerAssemblyUserData,
    plannerAssemblyMeshOf,
    plannerAssemblyAddParts,
    plannerAssemblyFlipWinding,
  };
}
