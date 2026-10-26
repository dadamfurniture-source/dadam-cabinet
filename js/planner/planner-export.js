// ============================================================
// 관리자 근사 GLB 내보내기 — planner-export.js (구조 페이지 + 상세설계 부모 창)
//
// CAD 베타 1주차 T4 · PR1b (docs/01-plan/planner-cad.plan.md 단계 0, 개정 #11).
// 지금 플래너 3D 장면(three.moduleGroup)을 그대로 GLB 로 내려받는다. **근사**다 — 조립 명세
// (bom-assembly.js, PR6~)가 생기기 전이라 판재 위치는 3D 빌더가 그린 그대로이고, BOM 과 184건
// 다르다(test-utils/ledger-baseline.json). 그래서 루트 노드 이름과 extras 에 "근사"를 박는다.
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
// 만든 쪽 버전 — design_cad_artifacts.generator_version (PR16). GLB 노드 · extras 모양이 바뀌면 올린다.
//   /2 (2026-10-24): 외관 GLB 는 고객용 — 노드 이름 · extras 에 partId · moduleKey 가 없다 (고객 확인서 3D 보기)
const PLANNER_EXPORT_CAD_VERSION = 'planner-export-cad/2';
const PLANNER_EXPORT_CAD_COLORS = { PB: 0xd9c4a3, MDF: 0xbdb5a8, hardware: 0x6b6b6b };
// 칸 모듈 `planner-<id>-<칸>` · 상자 하나짜리 모듈 `-open` · `-rice` · `-homecafe` · `-el` (ui-step1.js _convertPlannerModules)
const PLANNER_EXPORT_CELL_RE = /^planner-(.+)-(\d+|open|rice|homecafe|el)$/;

/**
 * 조립 명세와 모듈별 자리 단서를 만든다.
 * @param {Window} P  부모 창 — _currentStep2Item · _convertPlannerModules · MaterialExtractor · selectedItems
 * @param {{ payload: object, structureOf: Function, Assembly: object, lines?: Function }} deps
 *   lines() → [{ key, D, modules: [{ plannerId, x, back? }] }] 벽(같은 각·같은 뒷선의 배치 공간 묶음)마다 플래너 모듈 왼쪽 끝 x (벽 시작 기준),
 *     back = 몸통 뒷면 → 벽 (mm) — 명세 상판 뒤 = 벽 (2026-10-24 D3).
 *   라인 부재(상판·상몰딩·목찬넬 EP)를 호스트 모듈 좌표로 놓는 데 쓴다 — 없으면 라인 부재는 자리 미정.
 * @returns {{ spec: object, cells: Object<string, {plannerId: string, dx: number}>, moldingJoined: string[] }}
 *   moldingJoined = 상부 라인 상몰딩이 이어 덮은 키큰장 단의 명세 모듈 키 (아래, 2026-10-26)
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
  // 라인(벽)마다 변환 모듈의 왼쪽 끝 x0 — 플래너 모듈 x 에 칸 오프셋(mod._x − pm.x)을 더한다
  const lineOf = new Map();
  const lineDefs = typeof deps.lines === 'function' ? (deps.lines() || []) : [];
  lineDefs.forEach((ln) => (ln.modules || []).forEach((e) => lineOf.set(String(e.plannerId), { ln, x: Number(e.x) || 0, back: Number(e.back) || 0 })));
  const lines = lineDefs.map((ln) => ({ key: ln.key, D: ln.D, modules: [] }));
  conv.modules.forEach((mod) => {
    // 멍장 corner-blind-{pos}[-k] 은 id 에 플래너 id 가 없다 — 브리지가 실은 출처(_plannerId)로 잇는다 (2026-10-25). 상자 하나
    const hit = String(mod.id).match(PLANNER_EXPORT_CELL_RE)
      || (/^corner-blind-/.test(String(mod.id)) && mod._plannerId != null ? [mod.id, String(mod._plannerId), 'blind'] : null);
    if (!hit) return;
    const pm = byId.get(hit[1]);
    if (!pm) return;
    const mk = `${itemIdx}-${mod.id}`;
    const box = !/^\d+$/.test(hit[2]);   // 상자 하나짜리 — 플래너 모듈 그대로
    const dx = box ? 0
      : ((Number(mod._x) || 0) + (Number(mod.w) || 0) / 2) - ((Number(pm.x) || 0) + (Number(pm.W) || 0) / 2);
    cells[mk] = { plannerId: hit[1], dx };
    const s = typeof deps.structureOf === 'function' ? deps.structureOf(pm.id) : null;
    if (s && Array.isArray(s.shelves)) shelfY[mk] = s.shelves.map(Number).filter(Number.isFinite);
    const at = lineOf.get(hit[1]);
    if (at) lines[lineDefs.indexOf(at.ln)].modules.push({ moduleKey: mk, x0: at.x + (box ? 0 : (Number(mod._x) || 0) - (Number(pm.x) || 0)), back: at.back });
  });
  // 서랍장 레이아웃도 BOM 과 같은 추출기로 (부모 창 전역 — iframe 에는 없다)
  const opts = { materials, shelfY, MaterialExtractor: P.MaterialExtractor };
  // 철물 자리 (다리발·레일·경첩) — 같은 부모 창 추출기. 없으면 명세 hardware[] 는 빈다
  if (typeof P.HardwareExtractor === 'function') opts.hardware = new P.HardwareExtractor().extract(design).hardware;
  if (lines.length) opts.lines = { [itemIdx]: lines };
  // 2026-10-26 사장님 확정 "깊이가 다르면 따로 함." · "잇는다." (줄 끝) — 상부 라인 상몰딩이 이어 덮은 키큰장 단. BOM (extract → addTallMoldingPart) ·
  //   명세 (runsOf 'molding') 와 같은 계획을 같은 품목으로 다시 묻는다 (MaterialExtractor sinkMoldingPlanOf joinedTalls — 규칙을 따로 두지 않는다).
  //   플래너 3D 가 그 단의 예전 상몰딩(addCrownMolding)을 끈다 — 명세 띠가 그 위를 지난다 (plannerAssemblyRunsFor groups.molding.joined)
  const ex = new P.MaterialExtractor();
  const moldingPlan = typeof ex.sinkMoldingPlanOf === 'function' ? ex.sinkMoldingPlanOf(items[itemIdx]) : null;
  const moldingJoined = (moldingPlan ? moldingPlan.joinedTalls : []).map((id) => `${itemIdx}-${id}`);
  return { spec: deps.Assembly.of(design, opts), cells, moldingJoined };
}

/** 키 정렬 직렬화 — 같은 명세면 같은 문자열 (planner-capture.js plannerCaptureStableJson 과 같은 규칙). */
function plannerExportStableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : plannerExportStableJson(x))).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + plannerExportStableJson(v[k])).join(',') + '}';
}

/**
 * 명세 해시 — SHA-256(키 정렬 직렬화) 16진수. GLB 루트 extras.assemblyHash.
 *   워커가 동결 스냅샷 bom_payload.assembly 로 같은 값을 내 맞춰 본다 (PR16 — 맞아야 동결본으로 인정).
 * @param {object} spec
 * @param {SubtleCrypto} [subtle]  없으면 window.crypto.subtle
 */
async function plannerExportAssemblyHash(spec, subtle) {
  const sc = subtle || (typeof crypto !== 'undefined' && crypto.subtle);
  if (!sc) throw new Error('이 브라우저는 SHA-256 을 계산하지 못합니다');
  const bytes = new TextEncoder().encode(plannerExportStableJson(spec));
  const digest = new Uint8Array(await sc.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 명세 → three 장면.
 * @param {object} THREE
 * @param {object} spec        dadam.assembly/1
 * @param {(module) => object|null} frameOf  모듈 → 몸통 바닥 가운데의 월드 행렬(mm, THREE.Matrix4). null 이면 뺀다
 * @param {{ solidsOf: Function, exportedAt?: string, vis?: 'exterior', assemblyHash?: string }} opts
 *   vis: 'exterior' 면 명세 vis 가 exterior 인 판재만 (외관 GLB — 철물 · 속 판재 없음). 판재가 하나도 없는 모듈은 노드도 없다.
 *     외관 GLB 는 고객 확인서에 싣는다 — 노드 이름은 `module-N` · `part-N`, 판재 · 모듈 extras 는 비운다
 *     (고객 화면에 partId 를 보이지 않는다). 따낸 판의 모양은 그대로 (사장님 2026-10-24).
 *   finishOf(p) → { code, hex, roughness?, metalness? } | null: 마감 색 (BOM 행 finishCode → 플래너 카탈로그).
 *     null 이면 자재 기본색 (PB · MDF). 재질 이름은 마감 코드 — 같은 코드는 재질 하나를 나눠 쓴다. 텍스처는 싣지 않는다 (외관 1MB).
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
  const finishMats = {};
  const finishMatOf = (p) => {
    const f = typeof o.finishOf === 'function' ? o.finishOf(p) : null;
    if (!f || !f.code || !/^#[0-9a-f]{6}$/i.test(String(f.hex || ''))) return matOf(p.material);
    if (!finishMats[f.code]) {
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(f.hex),
        roughness: Number.isFinite(f.roughness) ? f.roughness : 0.8,
        metalness: Number.isFinite(f.metalness) ? f.metalness : 0,
      });
      m.name = f.code;
      finishMats[f.code] = m;
    }
    return finishMats[f.code];
  };
  let parts = 0, modules = 0, skipped = 0, runs = 0, hardware = 0;
  const keep = o.vis ? (p) => p.vis === o.vis : () => true;
  const anon = o.vis === 'exterior';
  // 철물 — 자리(at)와 치수(size)가 둘 다 있는 것만 상자로 싣는다 (다리발: at = 밑면 가운데, size = [가로, 높이, 깊이]).
  //   레일·경첩은 자리만 있거나 치수가 규칙에 없어(언더레일 두께 0, 경첩 컵 자리 미정) 싣지 않는다 — 명세(hardware[])에는 그대로 있다.
  const hardwareNodeOf = (h, k, moduleKey) => {
    const geo = new THREE.BoxGeometry(h.size[0], h.size[1], h.size[2]);
    const mesh = new THREE.Mesh(geo, matOf('hardware'));
    mesh.position.set(h.at[0], h.at[1] + h.size[1] / 2, h.at[2]);
    mesh.name = `${moduleKey}·${h.kind}#${k}`;
    mesh.userData = { hardware: h.kind, category: h.category, item: h.item, spec: h.spec, hwIdx: h.hwIdx, moduleKey, tags: h.tags || null };
    return mesh;
  };
  const partNodeOf = (p, moduleKey) => {
    const solids = o.solidsOf(p);
    const meshOf = (b, name) => {
      const geo = new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      const mesh = new THREE.Mesh(geo, finishMatOf(p));
      mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      mesh.name = name;
      return mesh;
    };
    const name = anon ? `part-${parts + 1}` : p.id;
    let part;
    if (solids.length === 1) {
      part = meshOf(solids[0], name);
    } else {
      part = new THREE.Group();
      part.name = name;
      solids.forEach((b, i) => part.add(meshOf(b, `${name}/${i}`)));
    }
    part.userData = anon ? {} : {
      rowPartId: p.rowPartId, part: p.part, material: p.material, t: p.t,
      cutW: p.cut.w, cutH: p.cut.h, moduleKey, vis: p.vis,
    };
    return part;
  };
  (spec.items || []).forEach((it) => {
    if (!it) return;
    const nodeOf = new Map();
    it.modules.forEach((m) => {
      const mat = frameOf(m);
      if (!mat) { skipped++; return; }
      const node = new THREE.Group();
      node.name = anon ? `module-${nodeOf.size + 1}` : `module·${m.moduleKey}`;
      node.userData = anon ? {} : { moduleKey: m.moduleKey, moduleId: m.moduleId, kind: m.kind, box: m.box };
      mat.decompose(node.position, node.quaternion, node.scale);
      m.parts.filter(keep).forEach((p) => { node.add(partNodeOf(p, m.moduleKey)); parts++; });
      if (!o.vis) (m.hardware || []).forEach((h, k) => { if (h.at && h.size) { node.add(hardwareNodeOf(h, k, m.moduleKey)); hardware++; } });
      nodeOf.set(m.moduleKey, node);
      if (!node.children.length && o.vis) return;
      root.add(node);
      modules++;
    });
    // 라인 부재(상판·상몰딩·목찬넬 EP) — 호스트 모듈 좌표라 그 모듈 노드 아래에 싣는다 (extras.run 에 라인 키)
    (it.runs || []).forEach((r) => {
      const host = nodeOf.get(r.hostModuleKey);
      if (!host) { skipped++; return; }
      const kept = r.parts.filter(keep);
      if (!kept.length) return;
      kept.forEach((p) => {
        const part = partNodeOf(p, `${it.itemIdx}-ep`);
        if (!anon) part.userData.run = r.lineKey;
        host.add(part);
        parts++;
      });
      // 외관 GLB 에서 판재가 없어 빠졌던 호스트 모듈도 라인 판재가 붙으면 싣는다
      if (!host.parent) { root.add(host); modules++; }
      runs++;
    });
  });
  root.userData = anon ? {
    schema: spec.schema,
    units: 'mm (root scale 0.001 → m)',
    source: 'dadam.assembly',
    generator: PLANNER_EXPORT_CAD_VERSION,
    vis: o.vis,
    assemblyHash: o.assemblyHash || null,
    exportedAt: o.exportedAt || new Date().toISOString(),
  } : {
    schema: spec.schema,
    rulesVersion: spec.rulesVersion,
    units: 'mm (root scale 0.001 → m)',
    unplaced: (spec.unplaced || []).length,
    skippedModules: skipped,
    hardware,
    source: 'dadam.assembly',
    generator: PLANNER_EXPORT_CAD_VERSION,
    vis: o.vis || 'all',
    assemblyHash: o.assemblyHash || null,
    exportedAt: o.exportedAt || new Date().toISOString(),
  };
  return { root, parts, modules, runs, hardware, skipped, unplaced: (spec.unplaced || []).length };
}

async function plannerExportCadGlb(THREE, GLTFExporter, spec, frameOf, opts) {
  const o = Object.assign({}, opts);
  if (!o.assemblyHash) o.assemblyHash = await plannerExportAssemblyHash(spec, o.subtle);
  const built = plannerExportCadScene(THREE, spec, frameOf, o);
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
    const frozenBtn = this._o.frozenButton;
    if (frozenBtn) {
      frozenBtn.hidden = true;
      frozenBtn.onclick = () => this.uploadFrozen();
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
    const frozenBtn = this._o && this._o.frozenButton;
    if (frozenBtn) frozenBtn.hidden = !this.admin;
    // PR11: 같은 역할을 조립 검사 배지(planner-cad-check.js)도 쓴다
    if (this._o && typeof this._o.onAdmin === 'function') this._o.onAdmin(this.admin);
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

  /**
   * PR16b 동결본 GLB 올리기 — 최신 동결 스냅샷의 명세 **그대로**에 플래너 자리(frameOf)만 입혀 전체 · 외관 두 벌을 짓고
   *   워커(부모 창 DadamWorkflow.cad)에 보낸다. 워커는 명세 해시가 동결본과 같을 때만 버킷 `cad` 에 보관한다.
   *   동결 명세에는 플래너 선반 높이 · 벽 라인이 없어 라인 부재(상판 · 몰딩 · 걸레받이)와 자리 못 받은 선반은 빠진다.
   */
  async uploadFrozen() {
    const o = this._o || {};
    const toast = typeof o.toast === 'function' ? o.toast : () => {};
    if (!this.admin) return null;
    let W = null;
    try { W = o.workflow || (window.parent && window.parent.DadamWorkflow && window.parent.DadamWorkflow.cad) || null; } catch (e) { W = null; }
    if (!W || typeof W.frozenAssembly !== 'function') { toast('상세설계 화면에서 연 플래너에서만 동결본 GLB 를 올릴 수 있습니다'); return null; }
    if (!window.THREE || typeof o.cad !== 'function') { toast('3D 장면이 아직 없습니다'); return null; }
    try {
      const frozen = await W.frozenAssembly();
      const { frameOf, solidsOf } = o.cad();
      const GLTFExporter = await this.loadExporter();
      // 마감 색 — 동결 BOM 행의 finishCode(워커 finish_codes) → 플래너 카탈로그(PlannerCatalog, 디테일 모드와 같은 표)
      const catalog = typeof o.finishCatalog === 'function' ? await o.finishCatalog() : null;
      const byCode = (catalog && catalog.byCode) || {};
      const codes = frozen.finish_codes || {};
      const finishOf = (p) => {
        const code = codes[p.rowPartId];
        const e = code ? byCode[code] : null;
        return e && e.hex ? { code, hex: e.hex, roughness: e.roughness, metalness: e.metalness } : null;
      };
      const out = {};
      for (const kind of ['cad', 'exterior']) {
        const r = await plannerExportCadGlb(window.THREE, GLTFExporter, frozen.assembly, frameOf, { solidsOf, finishOf, vis: kind === 'exterior' ? 'exterior' : undefined, subtle: o.subtle });
        if (r.root.userData.assemblyHash !== frozen.assembly_hash) throw new Error('명세 해시가 동결본과 다릅니다 — 새로 고친 뒤 다시 시도해 주세요');
        if (!r.parts) throw new Error('동결 명세에서 플래너 자리를 찾은 판재가 없습니다 — 이 품목을 동결했는지 확인해 주세요');
        const up = await W.upload(frozen.snapshot_id, kind, r.glb);
        out[kind] = { parts: r.parts, skipped: r.skipped, reused: !!(up && up.reused), artifact: up && up.artifact };
      }
      const skip = out.cad.skipped ? ` · 자리 못 찾은 모듈 ${out.cad.skipped}` : '';
      toast(`동결본 GLB 보관 — rev ${frozen.rev} · 판재 ${out.cad.parts} (외관 ${out.exterior.parts})${skip}${out.cad.reused ? ' · 이미 있던 파일' : ''}`);
      return Object.assign({ frozen }, out);
    } catch (e) {
      toast('동결본 GLB 올리기 실패: ' + ((e && e.message) || e));
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
    plannerExportStableJson,
    plannerExportAssemblyHash,
    PLANNER_EXPORT_CAD_VERSION,
    PLANNER_EXPORT_SCALE,
    PLANNER_EXPORT_CAD_ROOT_NAME,
    PLANNER_EXPORT_ROOT_NAME,
  };
}
