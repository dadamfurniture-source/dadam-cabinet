// ============================================================
// 관리자 근사 GLB 내보내기 — planner-export.js (구조 페이지 + 상세설계 부모 창)
//
// CAD 베타 1주차 T4 · PR1b (docs/01-plan/planner-cad.plan.md 단계 0, 개정 #11).
// 지금 플래너 3D 장면(three.moduleGroup)을 그대로 GLB 로 내려받는다. **근사**다 — 조립 명세
// (bom-assembly.js, PR6~)가 생기기 전이라 판재 위치는 3D 빌더가 그린 그대로이고, BOM 과 184건
// 다르다(test-utils/ledger-allowlist.json). 그래서 루트 노드 이름과 extras 에 "근사"를 박는다.
//
// 무엇을 넣는가 — T1 겹침 목록(test-utils/scene-parts.js collectScenePieces)과 **같은 부재**:
//   · 화면용 메시는 뺀다: PLANNER_FINISH_PAINT_SKIP(테두리·그림자판·선택 상자·배치 상자·다리발·가전 표시)
//     + 'preflight'(검사 테두리) + 'measure'(내경 선). 바닥·그리드·조명은 moduleGroup 밖이라 처음부터 없다.
//   · 숨긴 메시, 와이어프레임(open 칸 틀), open 칸의 앞 carcass 는 뺀다. 선(LineSegments)은 메시가 아니다.
//   · partKey 가 없는 부재(서랍 박스 외피·붙박이장 내부)는 넣는다.
// 노드: 루트(배율 0.001 — mm → m) ▸ 모듈 `module·<moduleId>` ▸ 부재 `<entityKind>[:<side>]·<moduleId>`.
//   extras = { moduleId, entityKind, side, partKey, section }. 재질은 색·불투명도만 (근사 — 텍스처 없음).
//
// 누가 보는가 — 관리자만 (D6: 상세설계 화면 밖의 CAD 기능은 관리자 전용).
//   구조 페이지는 AdminAccess 를 싣지 않는다. 부모 창(detaildesign.html)이 역할을 알려 준다:
//     자식 → 부모  { type: 'DADAM_PLANNER_ROLE_REQUEST' }
//     부모 → 자식  { type: 'DADAM_PLANNER_ROLE', admin: true|false }
//   같은 오리진만 주고받는다. 부모 없이 단독으로 연 구조 페이지에서는 버튼이 나오지 않는다.
//   ⚠ 클라이언트 확인이라 숨김일 뿐이다 — GLB 는 이 브라우저에 이미 있는 장면에서 만든다.
//
// GLTFExporter 는 쓸 때만 받는다 — HTML 의 모듈 스크립트가 importmap(three@0.183.0)으로
//   window.dadamLoadGLTFExporter 를 걸어 둔다. 시험은 opts.GLTFExporter 로 넣는다.
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_EXPORT_ / plannerExport / PlannerExport 접두.
// ============================================================

/** 장면에 있지만 부재가 아닌 것 — PLANNER_FINISH_PAINT_SKIP 에 더해 뺀다. */
const PLANNER_EXPORT_EXTRA_SKIP = ['preflight', 'measure'];
const PLANNER_EXPORT_SCALE = 0.001;
const PLANNER_EXPORT_ROOT_NAME = 'dadam-planner-approx';
const PLANNER_EXPORT_ROLE_REQUEST = 'DADAM_PLANNER_ROLE_REQUEST';
const PLANNER_EXPORT_ROLE = 'DADAM_PLANNER_ROLE';

function plannerExportSkipKinds() {
  // 브라우저: planner-finish.js 가 먼저 실린 전역 상수. Node(시험): 같은 파일을 require
  const base = typeof PLANNER_FINISH_PAINT_SKIP !== 'undefined' ? PLANNER_FINISH_PAINT_SKIP
    : typeof window !== 'undefined' && Array.isArray(window.PLANNER_FINISH_PAINT_SKIP) ? window.PLANNER_FINISH_PAINT_SKIP
      : typeof require === 'function' ? require('./planner-finish.js').PLANNER_FINISH_PAINT_SKIP : null;
  if (!Array.isArray(base)) throw new Error('planner-finish.js 가 planner-export.js 보다 먼저 실려야 합니다');
  return base.concat(PLANNER_EXPORT_EXTRA_SKIP);
}

/** 메시가 실제로 보이는가 — 자신과 조상 중 하나라도 visible=false 면 그려지지 않는다. */
function plannerExportIsShown(o) {
  for (let n = o; n; n = n.parent) if (n.visible === false) return false;
  return true;
}

/** GLB 에 넣을 부재인가. scene-parts.js collectScenePieces 와 같은 거름망 (시험이 둘을 맞춰 본다). */
function plannerExportIsPart(o, skip) {
  if (!o || !o.isMesh || !o.geometry) return false;
  const ud = o.userData || {};
  if (!ud.entityKind || (skip || plannerExportSkipKinds()).indexOf(ud.entityKind) >= 0) return false;
  if (!plannerExportIsShown(o)) return false;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (mats.every((mt) => mt && mt.wireframe)) return false;
  if (ud.entityKind === 'carcass' && ud.side === 'front' && ud.areaType === 'open') return false;
  return true;
}

function plannerExportModuleOf(o) {
  let g = o.parent;
  while (g && !(g.userData && g.userData.entityKind === 'module')) g = g.parent;
  return g || null;
}

function plannerExportNodeName(ud) {
  const id = ud.moduleId == null ? '?' : String(ud.moduleId);
  return `${ud.entityKind}${ud.side ? ':' + ud.side : ''}·${id}`;
}

/**
 * 내보낼 장면을 새로 짠다. 원래 장면은 건드리지 않는다 (기하는 같이 쓰고, 노드·재질만 새로).
 *
 * @param {object} THREE
 * @param {object} moduleGroup  three.moduleGroup
 * @param {{ partKeyOf?: Function, sectionOf?: Function, exportedAt?: string }} [opts]
 * @returns {{ root: object, parts: number, modules: number }}
 */
function plannerExportBuildScene(THREE, moduleGroup, opts) {
  const o = opts || {};
  const partKeyOf = o.partKeyOf || (typeof plannerFinishPartKeyOf === 'function' ? plannerFinishPartKeyOf
    : (typeof window !== 'undefined' && window.plannerFinishPartKeyOf) || null);
  const skip = plannerExportSkipKinds();
  const root = new THREE.Group();
  root.name = PLANNER_EXPORT_ROOT_NAME;
  root.scale.setScalar(PLANNER_EXPORT_SCALE);
  root.userData = {
    approx: true,
    note: '근사 — 지금 플래너 3D 장면 그대로 (조립 명세 전). BOM 과 다를 수 있다',
    units: 'mm (root scale 0.001 → m)',
    source: 'mockup-structure',
    exportedAt: o.exportedAt || new Date().toISOString(),
  };
  if (!moduleGroup) return { root, parts: 0, modules: 0 };
  moduleGroup.updateMatrixWorld(true);

  const matCache = new Map();
  const materialOf = (src) => {
    const m0 = Array.isArray(src) ? src.find(Boolean) : src;
    const color = m0 && m0.color ? m0.color.getHex() : 0xcccccc;
    const opacity = m0 && Number.isFinite(m0.opacity) ? m0.opacity : 1;
    const key = `${color}|${opacity}`;
    if (!matCache.has(key)) {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0 });
      if (opacity < 1) { mat.transparent = true; mat.opacity = opacity; }
      mat.name = '#' + color.toString(16).padStart(6, '0');
      matCache.set(key, mat);
    }
    return matCache.get(key);
  };

  const moduleNodes = new Map();
  const nodeForModule = (g) => {
    if (!g) return root;
    if (moduleNodes.has(g)) return moduleNodes.get(g).node;
    const node = new THREE.Group();
    const id = g.userData.moduleId == null ? '?' : String(g.userData.moduleId);
    node.name = `module·${id}`;
    node.userData = { moduleId: id, entityKind: 'module' };
    if (o.sectionOf) { const s = o.sectionOf(id); if (s) node.userData.section = s; }
    g.matrixWorld.decompose(node.position, node.quaternion, node.scale);
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    moduleNodes.set(g, { node, inv });
    root.add(node);
    return node;
  };

  let parts = 0;
  const local = new THREE.Matrix4();
  moduleGroup.traverse((mesh) => {
    if (!plannerExportIsPart(mesh, skip)) return;
    const ud = mesh.userData;
    const g = plannerExportModuleOf(mesh);
    const parent = nodeForModule(g);
    if (g) local.multiplyMatrices(moduleNodes.get(g).inv, mesh.matrixWorld);
    else local.copy(mesh.matrixWorld);
    const node = new THREE.Mesh(mesh.geometry, materialOf(mesh.material));
    node.name = plannerExportNodeName(ud);
    local.decompose(node.position, node.quaternion, node.scale);
    const extras = { moduleId: ud.moduleId == null ? null : String(ud.moduleId), entityKind: ud.entityKind };
    if (ud.side) extras.side = ud.side;
    const pk = partKeyOf ? partKeyOf(ud) : null;
    if (pk) extras.partKey = pk;
    if (o.sectionOf && extras.moduleId != null) { const s = o.sectionOf(extras.moduleId); if (s) extras.section = s; }
    node.userData = extras;
    parent.add(node);
    parts++;
  });
  return { root, parts, modules: moduleNodes.size };
}

/**
 * GLB 바이트를 만든다.
 * @returns {Promise<{ glb: ArrayBuffer, parts: number, modules: number }>}
 */
async function plannerExportGlb(THREE, GLTFExporter, moduleGroup, opts) {
  const built = plannerExportBuildScene(THREE, moduleGroup, opts);
  const exporter = new GLTFExporter();
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(built.root, resolve, reject, { binary: true, onlyVisible: true, trs: true });
  });
  return { glb, parts: built.parts, modules: built.modules };
}

function plannerExportFileName(now, kind) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `dadam-${kind || 'approx'}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.glb`;
}

// ============================================================
// CAD GLB — 조립 명세(bom-assembly.js, dadam.assembly/1)에서 바로 짓는다 (CAD 베타, 사장님 2026-10-19 "바로 GLB 로").
//
// 근사 GLB 와 달리 3D 장면을 베끼지 않는다. 판재 하나 = BOM 행 하나의 조각 하나이고, 재단 치수는 BOM 그대로다.
//   흐름 (구조 페이지 안):  buildPlannerPayload → 부모 창 _convertPlannerModules(ui-step1.js) → 부모 MaterialExtractor
//                           → DadamAssembly.of → 모듈마다 3D 모듈 그룹의 자리 + 칸 오프셋 + 몸통 바닥(다리발·좌대) 위에 판재
//   노드: 루트(배율 0.001) ▸ `module·<moduleKey>` ▸ 판재 `<partId#k>` (따낸 판은 상자 여럿을 자식으로).
//   extras: { rowPartId, part, material, t, cutW, cutH, moduleKey, vis }.
//   명세가 아직 자리를 못 정한 행(도어·서랍·밴드 …)은 GLB 에 없다 — 루트 extras.unplaced 에 개수, 토스트에 개수.
// 부모 창이 상세설계(detaildesign.html)일 때만 된다 — 변환·BOM 이 그쪽에 있다.
// ============================================================
const PLANNER_EXPORT_CAD_ROOT_NAME = 'dadam-planner-cad';
const PLANNER_EXPORT_CAD_COLORS = { PB: 0xd9c4a3, MDF: 0xbdb5a8 };
const PLANNER_EXPORT_CELL_RE = /^planner-(.+)-(\d+|open)$/;

/**
 * 조립 명세와 모듈별 자리 단서를 만든다.
 * @param {Window} P  부모 창 — _currentStep2Item · _convertPlannerModules · MaterialExtractor · selectedItems
 * @param {{ payload: object, structureOf: Function, Assembly: object }} deps
 * @returns {{ spec: object, cells: Object<string, {plannerId: string, dx: number}> }}
 */
function plannerExportCadSpec(P, deps) {
  if (!P || typeof P._convertPlannerModules !== 'function' || typeof P.MaterialExtractor !== 'function') {
    throw new Error('상세설계 화면에서 연 플래너에서만 CAD GLB 를 만들 수 있습니다');
  }
  if (!deps || !deps.Assembly) throw new Error('조립 명세(bom-assembly.js)가 실리지 않았습니다');
  const item = typeof P._currentStep2Item === 'function' ? P._currentStep2Item() : null;
  if (!item) throw new Error('품목이 없습니다 — 자재표는 품목에 붙습니다');
  const payload = deps.payload;
  // 변환기가 specs 에 커튼박스를 적는다 — 부모 품목을 건드리지 않게 사본으로
  const specs = JSON.parse(JSON.stringify(item.specs || {}));
  const conv = P._convertPlannerModules(payload, specs);
  const list = Array.isArray(P.selectedItems) ? P.selectedItems : [item];
  const itemIdx = Math.max(0, list.indexOf(item));
  // partId 의 품목 번호를 BOM 과 맞춘다 — 다른 품목 자리는 비워 둔 성긴 배열 (forEach 가 건너뛴다)
  const items = [];
  items[itemIdx] = Object.assign({}, item, { specs, modules: conv.modules });
  const design = { items };
  const materials = new P.MaterialExtractor().extract(design).materials;

  const byId = new Map((payload.modules || []).map((m) => [String(m.id), m]));
  const cells = {};
  const shelfY = {};
  conv.modules.forEach((mod) => {
    const hit = String(mod.id).match(PLANNER_EXPORT_CELL_RE);
    if (!hit) return;
    const pm = byId.get(hit[1]);
    if (!pm) return;
    const mk = `${itemIdx}-${mod.id}`;
    const dx = hit[2] === 'open' ? 0
      : ((Number(mod._x) || 0) + (Number(mod.w) || 0) / 2) - ((Number(pm.x) || 0) + (Number(pm.W) || 0) / 2);
    cells[mk] = { plannerId: hit[1], dx };
    const s = typeof deps.structureOf === 'function' ? deps.structureOf(pm.id) : null;
    if (s && Array.isArray(s.shelves)) shelfY[mk] = s.shelves.map(Number).filter(Number.isFinite);
  });
  return { spec: deps.Assembly.of(design, { materials, shelfY }), cells };
}

/**
 * 명세 → three 장면.
 * @param {object} THREE
 * @param {object} spec        dadam.assembly/1
 * @param {(module) => object|null} frameOf  모듈 → 몸통 바닥 가운데의 월드 행렬(mm, THREE.Matrix4). null 이면 뺀다
 * @param {{ solidsOf: Function, exportedAt?: string }} opts
 */
function plannerExportCadScene(THREE, spec, frameOf, opts) {
  const o = opts || {};
  const root = new THREE.Group();
  root.name = PLANNER_EXPORT_CAD_ROOT_NAME;
  root.scale.setScalar(PLANNER_EXPORT_SCALE);
  const mats = {};
  const matOf = (name) => {
    const key = PLANNER_EXPORT_CAD_COLORS[name] ? name : 'PB';
    if (!mats[key]) {
      mats[key] = new THREE.MeshStandardMaterial({ color: PLANNER_EXPORT_CAD_COLORS[key], roughness: 0.8, metalness: 0 });
      mats[key].name = key;
    }
    return mats[key];
  };
  let parts = 0, modules = 0, skipped = 0;
  (spec.items || []).forEach((it) => {
    if (!it) return;
    it.modules.forEach((m) => {
      const mat = frameOf(m);
      if (!mat) { skipped++; return; }
      const node = new THREE.Group();
      node.name = `module·${m.moduleKey}`;
      node.userData = { moduleKey: m.moduleKey, moduleId: m.moduleId, kind: m.kind, box: m.box };
      mat.decompose(node.position, node.quaternion, node.scale);
      m.parts.forEach((p) => {
        const solids = o.solidsOf(p);
        const meshOf = (b, name) => {
          const geo = new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
          const mesh = new THREE.Mesh(geo, matOf(p.material));
          mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
          mesh.name = name;
          return mesh;
        };
        let part;
        if (solids.length === 1) {
          part = meshOf(solids[0], p.id);
        } else {
          part = new THREE.Group();
          part.name = p.id;
          solids.forEach((b, i) => part.add(meshOf(b, `${p.id}/${i}`)));
        }
        part.userData = {
          rowPartId: p.rowPartId, part: p.part, material: p.material, t: p.t,
          cutW: p.cut.w, cutH: p.cut.h, moduleKey: m.moduleKey, vis: p.vis,
        };
        node.add(part);
        parts++;
      });
      root.add(node);
      modules++;
    });
  });
  root.userData = {
    schema: spec.schema,
    rulesVersion: spec.rulesVersion,
    units: 'mm (root scale 0.001 → m)',
    unplaced: (spec.unplaced || []).length,
    skippedModules: skipped,
    source: 'dadam.assembly',
    exportedAt: o.exportedAt || new Date().toISOString(),
  };
  return { root, parts, modules, skipped, unplaced: (spec.unplaced || []).length };
}

async function plannerExportCadGlb(THREE, GLTFExporter, spec, frameOf, opts) {
  const built = plannerExportCadScene(THREE, spec, frameOf, opts);
  const exporter = new GLTFExporter();
  const glb = await new Promise((resolve, reject) => {
    exporter.parse(built.root, resolve, reject, { binary: true, onlyVisible: true, trs: true });
  });
  return Object.assign({ glb }, built);
}

function plannerExportDownload(buf, name) {
  const blob = new Blob([buf], { type: 'model/gltf-binary' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const PlannerExport = {
  admin: false,
  _o: null,

  /**
   * 구조 페이지 쪽. 버튼은 처음에 숨겨 두고, 부모가 관리자라고 답하면 보인다.
   * @param {{ three: Function, button?: HTMLElement, toast?: Function, sectionOf?: Function }} o
   */
  mount(o) {
    this._o = o || {};
    const btn = this._o.button;
    if (btn) {
      btn.hidden = true;
      btn.onclick = () => this.download();
    }
    const cadBtn = this._o.cadButton;
    if (cadBtn) {
      cadBtn.hidden = true;
      cadBtn.onclick = () => this.downloadCad();
    }
    try {
      window.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== PLANNER_EXPORT_ROLE) return;
        if (e.origin !== location.origin || e.source !== window.parent) return;
        this.setAdmin(e.data.admin === true);
      });
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: PLANNER_EXPORT_ROLE_REQUEST }, location.origin);
      }
    } catch (e) {
      /* window 가 없으면 메시지도 없다 */
    }
    return this;
  },

  setAdmin(on) {
    this.admin = !!on;
    const btn = this._o && this._o.button;
    if (btn) btn.hidden = !this.admin;
    const cadBtn = this._o && this._o.cadButton;
    if (cadBtn) cadBtn.hidden = !this.admin;
  },

  async loadExporter() {
    if (this._o && this._o.GLTFExporter) return this._o.GLTFExporter;
    if (typeof window.dadamLoadGLTFExporter !== 'function') throw new Error('GLTFExporter 를 불러올 수 없습니다');
    return window.dadamLoadGLTFExporter();
  },

  async download() {
    const o = this._o || {};
    const toast = typeof o.toast === 'function' ? o.toast : () => {};
    if (!this.admin) return null;
    const three = typeof o.three === 'function' ? o.three() : null;
    if (!three || !three.moduleGroup || !window.THREE) { toast('3D 장면이 아직 없습니다'); return null; }
    try {
      const GLTFExporter = await this.loadExporter();
      const r = await plannerExportGlb(window.THREE, GLTFExporter, three.moduleGroup, { sectionOf: o.sectionOf });
      if (!r.parts) { toast('내보낼 부재가 없습니다'); return r; }
      plannerExportDownload(r.glb, plannerExportFileName());
      toast(`근사 GLB 저장 — 모듈 ${r.modules} · 부재 ${r.parts}`);
      return r;
    } catch (e) {
      toast('GLB 내보내기 실패: ' + ((e && e.message) || e));
      return null;
    }
  },

  /** CAD GLB — 조립 명세에서. o.cad() 가 { spec, frameOf } 를 낸다 (구조 페이지가 부모 창으로 계산). */
  async downloadCad() {
    const o = this._o || {};
    const toast = typeof o.toast === 'function' ? o.toast : () => {};
    if (!this.admin) return null;
    if (!window.THREE || typeof o.cad !== 'function') { toast('3D 장면이 아직 없습니다'); return null; }
    try {
      const { spec, frameOf, solidsOf } = o.cad();
      const GLTFExporter = await this.loadExporter();
      const r = await plannerExportCadGlb(window.THREE, GLTFExporter, spec, frameOf, { solidsOf });
      if (!r.parts) { toast('조립 명세에 자리가 정해진 판재가 없습니다'); return r; }
      plannerExportDownload(r.glb, plannerExportFileName(null, 'cad'));
      toast(`CAD GLB 저장 — 모듈 ${r.modules} · 판재 ${r.parts} · 아직 자리 미정 행 ${r.unplaced}`);
      return r;
    } catch (e) {
      toast('CAD GLB 내보내기 실패: ' + ((e && e.message) || e));
      return null;
    }
  },
};

/**
 * 부모 창 쪽 (detaildesign.html). 자식 플래너가 묻으면 관리자인지 답한다. 같은 오리진만.
 * @param {Window} win
 * @param {() => Promise<boolean>} isAdmin
 */
function plannerExportServeRole(win, isAdmin) {
  if (!win || typeof win.addEventListener !== 'function' || win.__plannerExportRoleServed) return false;
  win.__plannerExportRoleServed = true;
  win.addEventListener('message', async (e) => {
    if (!e.data || e.data.type !== PLANNER_EXPORT_ROLE_REQUEST) return;
    if (e.origin !== win.location.origin) return;
    const src = e.source;
    if (!src || typeof src.postMessage !== 'function') return;
    let admin = false;
    try { admin = (await isAdmin()) === true; } catch (err) { admin = false; }
    src.postMessage({ type: PLANNER_EXPORT_ROLE, admin }, win.location.origin);
  });
  return true;
}

/** detaildesign 의 AdminAccess 로 묻는다. 클라이언트는 SupabaseUtils 것을 쓰고, 없으면 하나 만든다. */
function plannerExportAdminCheck(win) {
  let own = null;
  return async () => {
    if (!win.AdminAccess) return false;
    let client = win.SupabaseUtils && win.SupabaseUtils.client;
    if (!client) {
      const cfg = win.DADAM_CONFIG && win.DADAM_CONFIG.supabase;
      if (!own && win.supabase && cfg) own = win.supabase.createClient(cfg.url, cfg.anonKey);
      client = own;
    }
    return win.AdminAccess.isAdmin(client);
  };
}

if (typeof window !== 'undefined') {
  window.PlannerExport = PlannerExport;
  window.plannerExportBuildScene = plannerExportBuildScene;
  window.plannerExportGlb = plannerExportGlb;
  window.plannerExportIsPart = plannerExportIsPart;
  window.plannerExportServeRole = plannerExportServeRole;
  window.plannerExportCadSpec = plannerExportCadSpec;
  window.plannerExportCadScene = plannerExportCadScene;
  // 부모 창(AdminAccess 를 싣는 페이지)에서만 역할을 답한다. 구조 페이지는 AdminAccess 를 싣지 않는다.
  if (window.AdminAccess) plannerExportServeRole(window, plannerExportAdminCheck(window));
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PlannerExport,
    plannerExportBuildScene,
    plannerExportGlb,
    plannerExportIsPart,
    plannerExportServeRole,
    plannerExportAdminCheck,
    plannerExportFileName,
    plannerExportCadSpec,
    plannerExportCadScene,
    plannerExportCadGlb,
    PLANNER_EXPORT_SCALE,
    PLANNER_EXPORT_CAD_ROOT_NAME,
    PLANNER_EXPORT_ROOT_NAME,
  };
}
