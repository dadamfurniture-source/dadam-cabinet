// ============================================================
// gen-to-planner: 연출컷 → 플래너 배치 가져오기 — gen-import.js (2026-09-11)
//
// ai-design.html 의 "상세설계로 가져오기" 가 detaildesign.html?gen=<generationId> 로 보낸다.
// 여기서 하는 일은 넷이다.
//   1. 생성 행을 읽는다 (워커 GET /api/generate/:id). layout 이 없으면 POST …/layout 으로
//      Claude 구성 분석을 받는다 (workers/generate-api/src/layout.js 형식).
//   2. 품목을 하나 만든다 — 기존 incrementCategory 를 그대로 쓴다 (품목 규칙을 두 벌 두지 않는다).
//   3. 구성 → 플래너 배치 payload 로 바꿔 그 품목의 스코프 키에 **그대로** 써 둔다
//      (mockup-shell 의 serializeLayout 형식). 셸이 fromStructure 토큰을 보고 복원한다.
//   4. 구조 단계용 1회 토큰(dadam_gen_autocalc_v1::scope)을 둔다 — 구조 단계가 첫 진입에서
//      전체 자동계산을 한 번 돌린다 (mockup-structure.html P11 훅).
//
// mm 는 여기서도 만들지 않는다. 영역 폭은 layout 의 세그먼트 mm(벽 폭 × %), 깊이·높이·가전 폭은
// js/planner/planner-sections.js PLANNER_SECTIONS. 모듈 분할은 구조 단계 엔진이 한다.
//
// ⚠ 클래식 스크립트 — 최상위 이름이 전역 렉시컬 스코프에 들어간다. 전부 GEN_IMPORT_/genImport
//   접두를 붙여 다른 파일과 겹치지 않게 했다. DOM 은 genImportRun 안에서만 만진다.
// 로드 순서: planner-sections.js · ui-step1.js 뒤, persistence-init.js 앞.
// Jest: module.exports 이중 노출 (__tests__/gen-import.test.js)
// ============================================================

/** 생성 품목(generations.category) → detaildesign 품목(CATEGORIES.id). 없는 것은 가져올 수 없다. */
const GEN_IMPORT_CATEGORY_TO_ITEM = {
  sink: 'sink',
  island: 'island',
  wardrobe: 'wardrobe',
  fridge: 'fridge',
  storage: 'storage',
};

/** 구조 단계가 1회 자동계산에 쓰는 sessionStorage 토큰 base (mockup-structure.html 과 같은 값). */
const GEN_IMPORT_AUTOCALC_BASE = 'dadam_gen_autocalc_v1';

/** 배치 단계가 저장 직후 열 때 쓰는 자동 복원 토큰 (mockup-shell.html autoRestore). */
const GEN_IMPORT_RESTORE_TOKEN = 'fromStructure';

/** 사람 원 기본 y — mockup-shell PERSON_DEFAULT.cy 와 같다 (가구 앞에 서 있어야 정면이 정해진다). */
const GEN_IMPORT_PERSON_CY = 1500;

/** 세그먼트 kind → 배치 영역 섹션. 'open' 은 비움, 'refrigerator' 는 가전만(장 없음). */
const GEN_IMPORT_AREA_OF = {
  lower: 'lower',
  dishwasher: 'lower',
  tall: 'tall',
  fridge: 'fridge',
  wardrobe: 'wardrobe',
};
const GEN_IMPORT_RUN_KINDS = ['lower', 'dishwasher'];
const GEN_IMPORT_APPLIANCES = ['sink', 'hood', 'dishwasher', 'refrigerator'];

function genImportSections(sections) {
  if (sections) return sections;
  if (typeof PLANNER_SECTIONS !== 'undefined') return PLANNER_SECTIONS;
  if (typeof window !== 'undefined' && window.PLANNER_SECTIONS) return window.PLANNER_SECTIONS;
  throw new Error(
    'PLANNER_SECTIONS 가 없습니다 — js/planner/planner-sections.js 를 먼저 로드해야 합니다'
  );
}

/**
 * 구성 분석(generations.layout) → 플래너 배치 payload.
 *
 * @param {object} layout        workers/generate-api/src/layout.js normalizeLayout 결과
 * @param {object} [wallAnalysis] generations.wall_analysis (layout.wall 이 없을 때 폴백)
 * @param {string} [category]    generations.category (layout.category 폴백)
 * @param {object} [sections]    PLANNER_SECTIONS (기본 전역)
 * @param {string} [now]         savedAt ISO
 * @returns {{layout: object, origin: {x:number,y:number,ceiling:number}}}
 */
function genLayoutToPlanner(layout, wallAnalysis, category, sections, now) {
  const sec = genImportSections(sections);
  const L = layout && typeof layout === 'object' ? layout : {};
  const wa = wallAnalysis || {};
  const W = Math.round(Number((L.wall && L.wall.W) || wa.wallW) || 3000);
  const H = Math.round(Number((L.wall && L.wall.H) || wa.wallH) || 2400);
  const cat = L.category || category || 'storage';
  const modules = [];
  const mod = (section, x, w) => ({
    section,
    x: Math.round(x),
    y: 0,
    w: Math.round(w),
    h: sec[section].h,
    moduleH: sec[section].moduleH,
    rotation: 0,
    finishings: [],
  });

  // 바닥 영역 — 하부장 런은 이어진 lower/dishwasher 를 하나로 합친다
  const segs = Array.isArray(L.segments) ? L.segments : [];
  let run = null;
  const flush = () => {
    if (run && run.w > 0) modules.push(mod('lower', run.x, run.w));
    run = null;
  };
  segs.forEach((s) => {
    if (!s || !(s.w > 0)) return;
    if (GEN_IMPORT_RUN_KINDS.includes(s.kind)) {
      if (run && run.x + run.w === s.x) run.w += s.w;
      else {
        flush();
        run = { x: s.x, w: s.w };
      }
      return;
    }
    flush();
    const area = GEN_IMPORT_AREA_OF[s.kind];
    if (area && sec[area]) modules.push(mod(area, s.x, s.w));
  });
  flush();
  if (!modules.length) {
    // 세그먼트가 하나도 없으면 품목 기본 영역 하나 — 빈 도면으로 보내지 않는다
    const fallback =
      cat === 'wardrobe'
        ? 'wardrobe'
        : cat === 'storage'
          ? 'tall'
          : cat === 'fridge'
            ? 'fridge'
            : 'lower';
    modules.push(mod(fallback, 0, W));
  }

  // 상부 영역
  (Array.isArray(L.uppers) ? L.uppers : []).forEach((u) => {
    if (u && u.w > 0 && sec.upper) modules.push(mod('upper', u.x, u.w));
  });

  // 가전 — 폭은 정본, x 는 layout 이 벽 안으로 이미 클램프했다
  const ap = L.appliances && typeof L.appliances === 'object' ? L.appliances : {};
  GEN_IMPORT_APPLIANCES.forEach((k) => {
    const a = ap[k];
    if (!a || !sec[k] || !Number.isFinite(Number(a.x))) return;
    modules.push(mod(k, a.x, sec[k].w));
  });

  return {
    layout: {
      version: 1,
      savedAt: now || new Date().toISOString(),
      person: { cx: Math.round(W / 2), cy: GEN_IMPORT_PERSON_CY },
      modules,
      genId: L.genId || null,
    },
    origin: { x: 0, y: 0, ceiling: H },
  };
}

/** 스코프 키 base — planner-store.js 정본이 있으면 그것을, 없으면 같은 문자열을 쓴다. */
function genImportKeyBases() {
  const K = typeof PLANNER_STAGE_KEYS !== 'undefined' ? PLANNER_STAGE_KEYS : null;
  return {
    layout: (K && K.layout && K.layout.layout) || 'dadam_layout_v1',
    origin: (K && K.layout && K.layout.origin) || 'dadam_origin_v1',
  };
}

/**
 * 배치 payload 를 품목 스코프에 써 두고 셸·구조 단계 토큰을 둔다.
 * 스코프는 iframe URL 과 **같은 문자열**이어야 한다 — ui-step1 _plannerScopeParams 가
 * design='local', item=String(item.uniqueId) 를 쓴다.
 * @param {string} scope  `local:<uniqueId>` 형태
 */
function genImportSeedScope(scope, seed, storage, session) {
  const ls = storage || localStorage;
  const ss = session || sessionStorage;
  const bases = genImportKeyBases();
  ls.setItem(`${bases.layout}::${scope}`, JSON.stringify(seed.layout));
  ls.setItem(`${bases.origin}::${scope}`, JSON.stringify(seed.origin));
  ss.setItem(GEN_IMPORT_RESTORE_TOKEN, '1');
  ss.setItem(`${GEN_IMPORT_AUTOCALC_BASE}::${scope}`, '1');
}

function genImportApiBase() {
  const cfg =
    typeof window !== 'undefined' && window.DADAM_CONFIG && window.DADAM_CONFIG.generateApi;
  const api =
    (cfg && cfg.url) || 'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate';
  return api.replace(/\/api\/generate\/?$/, '');
}

async function genImportAuthHeaders() {
  const h = { 'Content-Type': 'application/json' };
  try {
    const client = typeof SupabaseUtils !== 'undefined' ? SupabaseUtils.client : null;
    if (client) {
      const r = await client.auth.getSession();
      const t = r && r.data && r.data.session && r.data.session.access_token;
      if (t) h.Authorization = 'Bearer ' + t;
    }
  } catch (e) {
    /* 세션 없음 — 워커가 401 로 답한다 */
  }
  return h;
}

function genImportNotify(msg) {
  if (typeof showToast === 'function') showToast(msg);
  else if (typeof alert === 'function') alert(msg);
  else console.warn('[GenImport]', msg);
}

/** 생성 행 + 구성 분석을 받아 온다. 분석이 없으면 워커가 그 자리에서 만든다 (5~15초). */
async function genImportFetch(genId) {
  const base = genImportApiBase();
  const headers = await genImportAuthHeaders();
  const res = await fetch(`${base}/api/generate/${encodeURIComponent(genId)}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || '연출컷을 불러오지 못했습니다');
  const g = data.generation;
  if (!g.layout) {
    genImportNotify('연출컷 구성을 분석하는 중입니다 (10초 안팎)…');
    const r2 = await fetch(`${base}/api/generate/${encodeURIComponent(genId)}/layout`, {
      method: 'POST',
      headers,
    });
    const d2 = await r2.json().catch(() => ({}));
    if (!r2.ok || !d2.success) throw new Error(d2.error || '구성 분석에 실패했습니다');
    g.layout = d2.layout;
  }
  return g;
}

/**
 * detaildesign.html?gen=<id> 진입점. persistence-init 의 initAuth 가 로그인 확인 뒤 부른다.
 * 실패해도 던지지 않는다 — 페이지는 평소처럼 열려야 한다.
 */
async function genImportRun(genId) {
  if (!genId) return null;
  // 같은 연출컷을 두 번 가져오지 않는다 — 있으면 그 품목으로 간다
  const dup = (typeof selectedItems !== 'undefined' ? selectedItems : []).find(
    (i) => i.genId === genId
  );
  if (dup) {
    if (typeof goToStep2 === 'function') goToStep2();
    if (typeof switchStep2Item === 'function') switchStep2Item(dup.uniqueId);
    return dup;
  }
  let g;
  try {
    g = await genImportFetch(genId);
  } catch (e) {
    genImportNotify(e.message);
    return null;
  }
  const catId = GEN_IMPORT_CATEGORY_TO_ITEM[g.category];
  if (!catId) {
    genImportNotify('이 품목은 아직 플래너로 가져올 수 없습니다: ' + g.category);
    return null;
  }
  if (typeof _removeBootstrapPlanner === 'function') _removeBootstrapPlanner();
  incrementCategory(catId);
  const item = selectedItems[selectedItems.length - 1];
  if (!item || item.categoryId !== catId) {
    genImportNotify('품목을 만들지 못했습니다');
    return null;
  }
  const seed = genLayoutToPlanner(Object.assign({ genId }, g.layout), g.wall_analysis, g.category);
  item.genId = genId;
  item.w = seed.layout.modules.reduce((m, x) => Math.max(m, x.x + x.w), 0) || item.w;
  item.h = seed.origin.ceiling || item.h;
  if (g.title) item.customerNotes = item.customerNotes || `연출컷: ${g.title}`;
  try {
    genImportSeedScope(`local:${String(item.uniqueId)}`, seed);
  } catch (e) {
    genImportNotify('브라우저 저장소에 쓸 수 없어 배치를 채우지 못했습니다');
  }
  if (typeof updateUI === 'function') updateUI();
  if (typeof goToStep2 === 'function') goToStep2();
  if (typeof switchStep2Item === 'function') switchStep2Item(item.uniqueId);
  genImportNotify(
    `연출컷 배치를 가져왔습니다 — 영역 ${seed.layout.modules.length}개. "다음" 을 누르면 모듈이 자동으로 나뉩니다`
  );
  return item;
}

if (typeof window !== 'undefined') {
  window.GEN_IMPORT_CATEGORY_TO_ITEM = GEN_IMPORT_CATEGORY_TO_ITEM;
  window.GEN_IMPORT_AUTOCALC_BASE = GEN_IMPORT_AUTOCALC_BASE;
  window.genLayoutToPlanner = genLayoutToPlanner;
  window.genImportSeedScope = genImportSeedScope;
  window.genImportRun = genImportRun;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GEN_IMPORT_CATEGORY_TO_ITEM,
    GEN_IMPORT_AUTOCALC_BASE,
    GEN_IMPORT_RESTORE_TOKEN,
    GEN_IMPORT_PERSON_CY,
    genLayoutToPlanner,
    genImportSeedScope,
    genImportKeyBases,
  };
}
