// ============================================================
// 조립 명세 → 3D 판재 — planner-assembly-mesh.js (구조 페이지, 다담 CAD 베타 PR12)
//
// 몸통(측판·지판·천판·밴드·뒷판) · 처짐방지목 · 선반 (PR12), 앞판(도어·서랍 전면) · 서랍장 중간 목찬넬 ·
// 서랍 박스 판 (PR13) 을 플래너가 따로 셈하지 않고 조립 명세(bom-assembly.js) 판재 그대로 그린다 —
// BOM 재단 치수 · 명세 자리. 그래서 3D 와 BOM 이 같은 목록이 된다 (원장 시험).
//
// 규칙을 새로 두지 않는다. 판재 하나 = frame { o, u, v, n } 에서 u 로 cut.w, v 로 cut.h, n 으로 t.
//   따내기(notch, 관통)는 판 윤곽에서 뺀다 — plannerPanelOutline (planner-cutout.js) 과 같은 윤곽.
//   홈(groove)은 깊이가 미정(D5)이라 그리지 않는다.
//
// 어느 모듈을 명세로 그리나 (plannerAssemblyModuleFor):
//   · 플래너 모듈이 명세 모듈 **하나**로만 간다 (다칸 모듈은 결정 D1 전까지 예전 그대로)
//   · 부재 묶음(PLANNER_ASM_GROUPS)마다 따로 — 그 묶음의 행이 **전부** 놓였을 때만 그 묶음을 명세로 그린다.
//     하나라도 unplaced 면 그 묶음은 예전 그리기 (자리를 모르는 부재를 지어내지 않는다. 예: 서랍장 처짐방지목 D2)
//   · 몸통(shell)이 예전 그리기면 나머지 묶음도 예전 그리기 (예전 몸통이 목찬넬·서랍 박스를 같이 그린다)
//   · 부르는 쪽이 따로 거르는 것: 마감재 · 가전 자리 · 오픈장 · 밥솥장 · 붙박이장 통 · 멍장 · 기둥 따내기
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_ASM_ / plannerAssembly / PlannerAssembly 접두.
// ============================================================

/**
 * 명세로 그리는 부재 묶음 — BOM partKey 의 `#` 앞(family). 서랍 박스 판은 family `drawerbox:*` (tags.box).
 * 라인 부재(상판·걸레받이·상단 목찬넬·마감재, items[].runs)는 PR14.
 */
const PLANNER_ASM_GROUPS = {
  shell: ['body:side', 'body:bottom', 'body:top', 'body:band', 'back'],
  brace: ['body:brace'],
  shelf: ['shelf'],
  front: ['door', 'drawer'],
  drawer: ['channel:mid-front', 'channel:mid-back', 'drawerbox:fb', 'drawerbox:side', 'drawerbox:bottom', 'drawerbox:brace'],
};
const PLANNER_ASM_FAMILIES = Object.keys(PLANNER_ASM_GROUPS).reduce((a, k) => a.concat(PLANNER_ASM_GROUPS[k]), []);
const PLANNER_ASM_SHELF_COLOR = '#e8d8b8';

/** family → 묶음 이름 (모르는 family 는 null) */
function plannerAssemblyGroupOf(family) {
  const ks = Object.keys(PLANNER_ASM_GROUPS);
  for (let i = 0; i < ks.length; i++) if (PLANNER_ASM_GROUPS[ks[i]].indexOf(family) >= 0) return ks[i];
  return null;
}

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

/** 판재의 묶음 — 서랍 박스 판(tags.box)은 family 와 상관없이 'drawer'. 그리지 않는 판재면 null. */
function plannerAssemblyPartGroup(part, moduleKey) {
  if (part && part.tags && part.tags.box != null) return 'drawer';
  const k = plannerAssemblyKeyOf(part && part.rowPartId, moduleKey);
  return k ? plannerAssemblyGroupOf(k.family) : null;
}

/** 이 단계에서 그리는 판재인가 */
function plannerAssemblyInScope(part, moduleKey) {
  return plannerAssemblyPartGroup(part, moduleKey) != null;
}

/**
 * 플래너 모듈 → 명세 모듈 (명세로 그릴 수 있을 때만).
 * @param {{spec:object, cells:Object<string,{plannerId:string,dx:number}>}} asm  plannerExportCadSpec 결과
 * @param {string} plannerId
 * @returns {{module:object, dx:number, parts:Array, groups:Object<string,Array|null>}|null}
 *   groups[이름] — 그 묶음의 판재 (명세로 그린다, 빈 배열이면 BOM 에 그 부재가 없다) 또는 null (예전 그리기).
 *   몸통(shell)이 null 이면 모듈 전체가 null.
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
  // 묶음마다 — 그 묶음 행이 하나라도 자리 미정이면 그 묶음은 예전 그리기. 이름을 못 읽는 행은 모듈 전체를 예전 그리기로.
  const pending = {};
  let unknown = false;
  (asm.spec.unplaced || []).forEach((u) => {
    if (u.moduleKey !== mk) return;
    const k = plannerAssemblyKeyOf(u.rowPartId, mk);
    if (!k) { unknown = true; return; }
    const g = plannerAssemblyGroupOf(k.family);
    if (g) pending[g] = true;
  });
  if (unknown || pending.shell) return null;
  const groups = {};
  Object.keys(PLANNER_ASM_GROUPS).forEach((g) => { groups[g] = pending[g] ? null : []; });
  (mod.parts || []).forEach((p) => {
    const g = plannerAssemblyPartGroup(p, mk);
    if (g && groups[g]) groups[g].push(p);
  });
  if (!groups.shell.length) return null;
  const parts = Object.keys(groups).reduce((a, g) => a.concat(groups[g] || []), []);
  return { module: mod, dx: Number(asm.cells[mk].dx) || 0, parts, groups };
}

/** 부호 있는 축 '+x' → 단위 벡터 [1,0,0] */
function plannerAssemblyAxis(a) {
  const v = [0, 0, 0];
  v[PLANNER_ASM_AXIS[a[1]]] = a[0] === '-' ? -1 : 1;
  return v;
}

/**
 * 판재 userData — 원장·마감 칠하기(planner-finish.js plannerFinishPartKeyOf)가 예전 그리기와 같은 이름을 읽게.
 *   몸통 판 → entityKind 'carcass' + side (측판은 left/right, 그 밖은 partKey 의 'body:' 뒤 · 뒷판 'back')
 *   처짐방지목 → 'brace' (braceIdx) · 선반 → 'shelf' (shelfIdx)
 *   도어 → carcass front door (areaIdx 0 · 'top', 도어가 둘 이상이면 doorIdx — 예전 양문과 같다)
 *   서랍 전면 → carcass front drawer (areaIdx −1 · 'bottom' · cellIdx 0 · drawerIdx = 명세 drawerIdx − 1)
 *   중간 목찬넬 → carcass channelFace(전면) · channelBase(지면) + mid
 *   서랍 박스 판 → 'drawerBox' (drawerIdx = 박스 번호 + 1, 예전 박스 덩어리와 같은 번호) + 판 이름(boxPart)
 * @param {{doorCount?:number}} [ctx]
 */
function plannerAssemblyUserData(part, moduleKey, plannerId, ctx) {
  const k = plannerAssemblyKeyOf(part.rowPartId, moduleKey) || { partKey: '', family: '', n: 0 };
  const k3 = Number(String(part.id).split('#').pop()) || 0;
  const tags = part.tags || {};
  const base = { moduleId: plannerId, partId: part.id, rowPartId: part.rowPartId, key3d: moduleKey + '|' + part.id, assembly: true };
  if (k.family === 'body:brace') return Object.assign({ entityKind: 'brace', braceIdx: k3 }, base);
  if (k.family === 'shelf') return Object.assign({ entityKind: 'shelf', shelfIdx: k3, cellIdx: 0 }, base);
  if (tags.box != null) {
    return Object.assign({ entityKind: 'drawerBox', drawerIdx: Number(tags.box) + 1, boxPart: k.family.replace(/^drawerbox:/, ''),
      side: tags.side || null, end: tags.end || null }, base);
  }
  if (k.family === 'door') {
    const ud = { entityKind: 'carcass', side: 'front', areaType: 'door', areaIdx: 0, areaPos: 'top' };
    if (ctx && ctx.doorCount > 1) ud.doorIdx = tags.doorIdx != null ? tags.doorIdx : k3;
    return Object.assign(ud, base);
  }
  if (k.family === 'drawer') {
    return Object.assign({ entityKind: 'carcass', side: 'front', areaType: 'drawer', areaIdx: -1, areaPos: 'bottom', cellIdx: 0,
      drawerIdx: (tags.drawerIdx != null ? Number(tags.drawerIdx) : k3 + 1) - 1 }, base);
  }
  if (k.family === 'channel:mid-front' || k.family === 'channel:mid-back') {
    return Object.assign({ entityKind: 'carcass', side: k.family === 'channel:mid-front' ? 'channelFace' : 'channelBase',
      mid: tags.mid != null ? tags.mid : 0 }, base);
  }
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
function plannerAssemblyMeshOf(THREE, part, color, outlineOf, look) {
  const lk = look || {};
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), metalness: lk.metalness != null ? lk.metalness : 0.05,
    roughness: lk.roughness != null ? lk.roughness : 0.65,
    transparent: !!lk.transparent, opacity: lk.opacity != null ? lk.opacity : 1,
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
 * @param {{module, dx}} hit  plannerAssemblyModuleFor 결과
 * @param {Array} parts      그릴 판재 (hit.groups 에서 고른 것)
 * @param {{ plannerId, baseY:number, color:string, colors?:object, looks?:object, outline?:Function,
 *           onEdge?:Function, onFront?:Function, holder?:THREE.Group }} o
 *   baseY   몸통 바닥 높이 (다리발·좌대, baseOffsetOf) — 명세 y = 0 이 몸통 바닥이다
 *   colors  { body, shelf, brace, door, drawer, channel, drawerBox } — 없으면 color (선반은 PLANNER_ASM_SHELF_COLOR)
 *   looks   { drawerBox: { transparent, opacity, roughness } } — 재질 모양
 *   onEdge  (mesh, holder, ud) — 테두리 선 (플래너 addEdgeOutline). 앞판에는 onFront 를 부른다
 *   onFront (mesh, holder, ud, box) — 앞판 장식 (그림자판 · 테두리 · 서랍 분할선). box = 홀더 로컬 { min, max }
 *   holder  같은 모듈에 두 번째로 부를 때 — 첫 부름이 돌려준 홀더
 * @returns {THREE.Group} 홀더
 */
function plannerAssemblyAddParts(THREE, parent, hit, parts, o) {
  let holder = o.holder;
  if (!holder) {
    holder = new THREE.Group();
    holder.name = 'assembly:' + hit.module.moduleKey;
    holder.position.set(hit.dx, o.baseY || 0, 0);
    holder.userData = { entityKind: 'assembly-holder', moduleId: o.plannerId, display: true };
    parent.add(holder);
  }
  const colors = o.colors || {};
  const looks = o.looks || {};
  const doorCount = parts.filter((p) => (plannerAssemblyKeyOf(p.rowPartId, hit.module.moduleKey) || {}).family === 'door').length;
  parts.forEach((p) => {
    const ud = plannerAssemblyUserData(p, hit.module.moduleKey, o.plannerId, { doorCount });
    const front = ud.side === 'front';
    const key = ud.entityKind === 'shelf' ? 'shelf' : ud.entityKind === 'brace' ? 'brace'
      : ud.entityKind === 'drawerBox' ? 'drawerBox' : front ? ud.areaType
        : (ud.side === 'channelFace' || ud.side === 'channelBase') ? 'channel' : 'body';
    const color = colors[key] || (key === 'shelf' ? PLANNER_ASM_SHELF_COLOR : o.color);
    const mesh = plannerAssemblyMeshOf(THREE, p, color, o.outline, looks[key]);
    mesh.userData = ud;
    holder.add(mesh);
    if (front && typeof o.onFront === 'function') o.onFront(mesh, holder, ud, p.box);
    else if (typeof o.onEdge === 'function') o.onEdge(mesh, holder, ud);
  });
  return holder;
}

if (typeof window !== 'undefined') {
  window.PLANNER_ASM_FAMILIES = PLANNER_ASM_FAMILIES;
  window.PLANNER_ASM_GROUPS = PLANNER_ASM_GROUPS;
  window.plannerAssemblyKeyOf = plannerAssemblyKeyOf;
  window.plannerAssemblyModuleFor = plannerAssemblyModuleFor;
  window.plannerAssemblyMeshOf = plannerAssemblyMeshOf;
  window.plannerAssemblyAddParts = plannerAssemblyAddParts;
  window.plannerAssemblyUserData = plannerAssemblyUserData;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_ASM_FAMILIES,
    PLANNER_ASM_GROUPS,
    plannerAssemblyGroupOf,
    plannerAssemblyPartGroup,
    plannerAssemblyKeyOf,
    plannerAssemblyInScope,
    plannerAssemblyModuleFor,
    plannerAssemblyUserData,
    plannerAssemblyMeshOf,
    plannerAssemblyAddParts,
    plannerAssemblyFlipWinding,
  };
}
