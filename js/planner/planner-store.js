// ============================================================
// W12-71: 도면 스냅샷 저장소 — planner-store.js
//
// 배치·구조 단계의 결과물이 여태 브라우저 localStorage 에만 있었다.
// 캐시를 지우면 사라지고, 다른 PC 에서는 보이지 않았다.
// 이 파일이 그 값을 **계정에 귀속된 표**(planner_snapshots)로 올리고 되가져온다.
//
// 두 가지를 지킨다.
//
//   ① localStorage 쓰기는 그대로 둔다.
//      DB 는 **덤**이다. 네트워크가 죽거나 로그인이 없어도 작업이 멈추면 안 된다.
//      그래서 이 파일의 모든 함수는 던지지 않고 { ok:false, reason } 을 돌려준다.
//
//   ② payload 를 변환하지 않는다.
//      저장 키의 값을 **그대로** 담고, 불러올 때 **그대로** 되쓴다. 변환을 두면
//      그 변환이 새 버그 표면이 되고, 페이지의 기존 load 경로와 두 벌이 된다.
//
// 스코프는 이미 planner-scope.js 가 URL 에서 뽑아 둔 (design, item) 이다.
// design 이 'local'(설계 저장 전)이면 소유자를 태울 designs 행이 없으므로
// **DB 에 올리지 않는다** — localStorage 에만 둔다.
//
// ⚠ 클래식 스크립트다. 최상위 const 가 전역 렉시컬 스코프에 들어가므로
//   두 HTML 인라인에서 같은 이름을 다시 선언하면 SyntaxError 로 흰 화면이 된다.
//   (planner-assets.test.js 가 그 사고를 지킨다.)
//
// 로드 순서: planner-scope.js → (config.js · supabase-js) → 이 파일 → 인라인
// ============================================================

/** 단계 3종. DB 의 stage CHECK 제약과 같은 값이어야 한다. */
const PLANNER_STAGES = ['layout', 'structure', 'detail'];

/** 단계 → 사람이 읽는 이름 */
const PLANNER_STAGE_LABEL = { layout: '배치', structure: '구조', detail: '디테일' };

/**
 * 단계 → payload 필드 이름 → 저장 키 base.
 *
 * detail 은 비어 있다. 디테일 데이터의 정본은 design_items 이고 localStorage 에
 * 대응하는 키가 없다 — 스냅샷은 되돌리기용 사본으로만 쌓인다.
 */
const PLANNER_STAGE_KEYS = {
  layout: { layout: 'dadam_layout_v1', origin: 'dadam_origin_v1' },
  structure: { modules: 'dadam_struct_modules_v1', structures: 'dadam_structure_v1' },
  detail: {},
};

/**
 * URL 의 저장 스코프를 DB 키로 바꾼다.
 *
 * `design` 은 detaildesign 의 currentDesignId — 설계를 아직 저장하지 않았으면
 * 'local' 이다. 그 경우 designId 를 null 로 돌려 **DB 경로를 막는다**.
 * (designs 행이 없으면 RLS 를 태울 소유자가 없다.)
 *
 * @param {string} [search] 기본값은 location.search
 */
function plannerScopeIds(search) {
  const out = { designId: null, itemId: null };
  try {
    const s = typeof search === 'string'
      ? search
      : (typeof location !== 'undefined' ? location.search : '');
    const q = new URLSearchParams(s);
    const design = q.get('design') || '';
    const item = q.get('item') || '';
    // 'local' · 'bootstrap' 은 "아직 저장 안 된 설계" 의 표식이다 (ui-step1.js).
    if (design && design !== 'local') out.designId = design;
    if (item && item !== 'bootstrap' && /^\d+$/.test(item)) out.itemId = Number(item);
  } catch (e) { /* URL 이 없으면 스코프도 없다 */ }
  return out;
}

/** DB 에 올릴 수 있는 스코프인가 — 설계 id 와 품목 번호가 둘 다 있어야 한다. */
function plannerScopeIsRemote(ids) {
  return !!(ids && ids.designId && ids.itemId != null);
}

/**
 * 이 단계의 현재 값을 payload 로 모은다.
 *
 * @param {string} stage
 * @param {(key:string)=>(string|null)} read  스코프 붙은 키를 읽는 함수 (테스트 주입용)
 * @returns {object|null} 담을 것이 하나도 없으면 null
 */
function plannerSnapshotPayload(stage, read) {
  const map = PLANNER_STAGE_KEYS[stage];
  if (!map) return null;
  const payload = {};
  let any = false;
  Object.keys(map).forEach((field) => {
    const raw = read(map[field]);
    if (raw == null || raw === '') return;
    try {
      payload[field] = JSON.parse(raw);
      any = true;
    } catch (e) { /* 깨진 값은 담지 않는다 — 담으면 불러올 때 다시 깨진다 */ }
  });
  return any ? payload : null;
}

/**
 * payload 를 저장 키로 되쓴다. 불러오기의 전부다 —
 * 그 다음은 페이지의 기존 load 경로(loadModules · restoreLayout)가 처리한다.
 *
 * payload 에 없는 필드는 **건드리지 않는다**. 배치 스냅샷에 origin 이 없다고
 * 지금 원점을 지우면, 되돌릴 수 없는 값을 스냅샷이 조용히 없애는 셈이다.
 *
 * @returns {string[]} 실제로 되쓴 필드 이름
 */
function applyPlannerSnapshot(stage, payload, write) {
  const map = PLANNER_STAGE_KEYS[stage];
  if (!map || !payload) return [];
  const done = [];
  Object.keys(map).forEach((field) => {
    if (payload[field] === undefined) return;
    write(map[field], JSON.stringify(payload[field]));
    done.push(field);
  });
  return done;
}

/**
 * 목록에 한 줄로 적을 요약. "무엇이 담겼는지" 를 열어 보지 않고 알 수 있어야
 * 여러 스냅샷 중에서 고를 수 있다.
 */
function plannerSnapshotSummary(stage, payload) {
  if (!payload) return '';
  try {
    if (stage === 'layout') {
      const n = (payload.layout && payload.layout.modules || []).length;
      return `배치 공간 ${n}개`;
    }
    if (stage === 'structure') {
      const n = (payload.modules && payload.modules.modules || []).length;
      const s = Object.keys(payload.structures || {}).length;
      return `모듈 ${n}개 · 구조 ${s}건`;
    }
    if (stage === 'detail') {
      const n = (payload.modules || []).length;
      return `모듈 ${n}개`;
    }
  } catch (e) { /* 요약은 못 만들어도 불러오기는 되어야 한다 */ }
  return '';
}

/** 목록의 시각 표기 — 오늘이면 시:분, 아니면 월/일 시:분. */
function plannerSnapshotWhen(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return sameDay ? `오늘 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  } catch (e) { return ''; }
}

// ────────────────────────────────────────────────────────────
// Supabase 경로
// ────────────────────────────────────────────────────────────

/**
 * 도면 스냅샷 저장소.
 *
 * 모든 메서드가 `{ ok, ... }` 를 돌려준다. 던지지 않는다 — 저장 실패가
 * 사용자의 작업을 끊으면 안 되기 때문이다. 실패 이유는 reason 으로 알린다:
 *
 *   'no-sdk'     supabase-js 나 config 가 없다 (플래너를 단독으로 연 경우 등)
 *   'no-session' 로그인하지 않았다
 *   'no-scope'   설계를 아직 저장하지 않았다 (design=local)
 *   'empty'      담을 값이 없다
 *   'error'      DB 가 거절했다 (message 동봉)
 */
const PlannerStore = {
  _client: null,

  /** 지연 생성. 같은 오리진이라 부모(detaildesign)의 세션을 그대로 본다. */
  client() {
    if (this._client) return this._client;
    try {
      const cfg = typeof window !== 'undefined' && window.DADAM_CONFIG;
      const sdk = typeof window !== 'undefined' && window.supabase;
      if (!cfg || !cfg.supabase || !sdk || !sdk.createClient) return null;
      this._client = sdk.createClient(cfg.supabase.url, cfg.supabase.anonKey);
      return this._client;
    } catch (e) { return null; }
  },

  /**
   * DB 를 쓸 수 있는 상태인지. UI 가 "로그인하면 계정에 저장됩니다" 를 띄우는 근거.
   *
   * @param {{designId:string,itemId:number}} [override] URL 대신 쓸 스코프.
   *   detaildesign 은 자기 URL 이 `?id=<designId>` 라 URL 에서 뽑을 수 없다.
   */
  async ready(override) {
    const ids = override || plannerScopeIds();
    if (!plannerScopeIsRemote(ids)) return { ok: false, reason: 'no-scope', ids };
    const c = this.client();
    if (!c) return { ok: false, reason: 'no-sdk', ids };
    try {
      const { data } = await c.auth.getSession();
      if (!data || !data.session) return { ok: false, reason: 'no-session', ids };
      return { ok: true, ids, client: c };
    } catch (e) {
      return { ok: false, reason: 'no-session', ids };
    }
  },

  /**
   * 현재 localStorage 값을 한 벌 올린다.
   *
   * 자동 저장은 스코프당 한 행을 덮어쓴다(upsert). 안 그러면 자동 저장이 목록을
   * 가득 채워, 이름 붙여 저장한 것을 밀어낸다.
   *
   * @param {string} stage
   * @param {{name?:string, autosave?:boolean, payload?:object}} [opt]
   */
  async save(stage, opt) {
    opt = opt || {};
    const r = await this.ready(opt.ids);
    if (!r.ok) return r;
    const payload = opt.payload !== undefined
      ? opt.payload
      : plannerSnapshotPayload(stage, (base) => {
          // scopedKey 는 planner-scope.js 의 전역이다. detaildesign 은 그 파일을
          // 싣지 않고 payload 를 직접 넘기므로, 없을 때도 죽지 않게 둔다.
          const key = (typeof scopedKey === 'function') ? scopedKey(base) : base;
          try { return localStorage.getItem(key); } catch (e) { return null; }
        });
    // detail 은 대응하는 localStorage 키가 없다 — 부르는 쪽이 payload 를 넘긴다.
    if (!payload) return { ok: false, reason: 'empty' };

    const row = {
      design_id: r.ids.designId,
      item_unique_id: r.ids.itemId,
      stage,
      name: opt.autosave ? null : (opt.name || null),
      payload,
      is_autosave: !!opt.autosave,
    };
    try {
      if (opt.autosave) {
        // upsert 를 쓰지 않는다. 자동 저장 행의 유일성은 **부분** 유니크 인덱스
        // (`WHERE is_autosave`)로 걸려 있는데, PostgREST 의 on_conflict 는
        // 인덱스 술어를 함께 보낼 수 없어 그 인덱스를 집지 못한다.
        // 그래서 있으면 갱신, 없으면 삽입을 손으로 한다.
        const { data: cur } = await r.client
          .from('planner_snapshots')
          .select('id')
          .eq('design_id', r.ids.designId)
          .eq('item_unique_id', r.ids.itemId)
          .eq('stage', stage)
          .eq('is_autosave', true)
          .maybeSingle();
        if (cur && cur.id) {
          const { error } = await r.client
            .from('planner_snapshots').update({ payload }).eq('id', cur.id);
          if (error) throw error;
          return { ok: true, id: cur.id, autosave: true };
        }
        const { data, error } = await r.client
          .from('planner_snapshots').insert(row).select('id').single();
        if (error) throw error;
        return { ok: true, id: data && data.id, autosave: true };
      }
      const { data, error } = await r.client
        .from('planner_snapshots').insert(row).select('id').single();
      if (error) throw error;
      return { ok: true, id: data && data.id, autosave: false };
    } catch (e) {
      return { ok: false, reason: 'error', message: e && e.message };
    }
  },

  /**
   * 이 품목·이 단계의 스냅샷 목록. 다른 품목·다른 설계는 보여주지 않는다 —
   * 다른 벽 치수의 배치가 들어오면 트리밍·코너가 어긋나기 때문이다(계획 Q3).
   */
  async list(stage, limit, ids) {
    const r = await this.ready(ids);
    if (!r.ok) return Object.assign({ rows: [] }, r);
    try {
      const { data, error } = await r.client
        .from('planner_snapshots')
        .select('id, stage, name, is_autosave, created_at, updated_at, payload')
        .eq('design_id', r.ids.designId)
        .eq('item_unique_id', r.ids.itemId)
        .eq('stage', stage)
        .order('updated_at', { ascending: false })
        .limit(limit || 20);
      if (error) throw error;
      return { ok: true, rows: data || [] };
    } catch (e) {
      return { ok: false, reason: 'error', message: e && e.message, rows: [] };
    }
  },

  /** 한 벌을 localStorage 로 되쓴다. 화면 갱신은 부르는 쪽이 한다. */
  async loadInto(id, ids) {
    const r = await this.ready(ids);
    if (!r.ok) return r;
    try {
      const { data, error } = await r.client
        .from('planner_snapshots')
        .select('id, stage, name, payload, created_at')
        .eq('id', id)
        .single();
      if (error) throw error;
      const applied = applyPlannerSnapshot(data.stage, data.payload, (base, val) => {
        const key = (typeof scopedKey === 'function') ? scopedKey(base) : base;
        localStorage.setItem(key, val);
      });
      return { ok: true, row: data, applied };
    } catch (e) {
      return { ok: false, reason: 'error', message: e && e.message };
    }
  },

  async remove(id, ids) {
    const r = await this.ready(ids);
    if (!r.ok) return r;
    try {
      const { error } = await r.client.from('planner_snapshots').delete().eq('id', id);
      if (error) throw error;
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'error', message: e && e.message };
    }
  },
};

/**
 * 자동 저장 — 잦은 호출을 묶는다.
 *
 * 눈금자 드래그 한 번에 저장이 수십 번 불릴 수 있다. 그대로 보내면 DB 를 두들기고
 * 사용자에겐 아무 이득이 없다. 마지막 것 하나만 보낸다.
 */
const _plannerAutosaveTimers = {};
function plannerAutosave(stage, delayMs) {
  const wait = delayMs == null ? 1500 : delayMs;
  clearTimeout(_plannerAutosaveTimers[stage]);
  _plannerAutosaveTimers[stage] = setTimeout(() => {
    PlannerStore.save(stage, { autosave: true });
  }, wait);
}

/**
 * 설계를 처음 저장하면 스코프가 `::local:<item>` → `::<designId>:<item>` 으로 바뀐다.
 * 그때 이관하지 않으면 저장 전에 그린 배치가 **사라진 것처럼** 보인다.
 * planner-scope.js 의 migrateLegacyScope 와 같은 방식 — 값을 옮기고 옛 키를 지운다.
 *
 * @returns {string[]} 옮긴 키 base 목록
 */
function migratePlannerLocalScope(designId, itemUniqueId) {
  const moved = [];
  if (!designId || itemUniqueId == null) return moved;
  const bases = [];
  PLANNER_STAGES.forEach((st) => {
    Object.keys(PLANNER_STAGE_KEYS[st] || {}).forEach((f) => bases.push(PLANNER_STAGE_KEYS[st][f]));
  });
  try {
    bases.forEach((base) => {
      const from = `${base}::local:${itemUniqueId}`;
      const to = `${base}::${designId}:${itemUniqueId}`;
      const val = localStorage.getItem(from);
      // 이미 그 스코프에 값이 있으면 덮지 않는다 — 그쪽이 더 최신이다.
      if (val == null || localStorage.getItem(to) != null) return;
      localStorage.setItem(to, val);
      localStorage.removeItem(from);
      moved.push(base);
    });
  } catch (e) { /* 저장소가 막혀 있으면 이관도 못 한다 — 조용히 넘어간다 */ }
  return moved;
}

if (typeof window !== 'undefined') {
  window.PLANNER_STAGES = PLANNER_STAGES;
  window.PLANNER_STAGE_LABEL = PLANNER_STAGE_LABEL;
  window.PLANNER_STAGE_KEYS = PLANNER_STAGE_KEYS;
  window.plannerScopeIds = plannerScopeIds;
  window.plannerScopeIsRemote = plannerScopeIsRemote;
  window.plannerSnapshotPayload = plannerSnapshotPayload;
  window.applyPlannerSnapshot = applyPlannerSnapshot;
  window.plannerSnapshotSummary = plannerSnapshotSummary;
  window.plannerSnapshotWhen = plannerSnapshotWhen;
  window.PlannerStore = PlannerStore;
  window.plannerAutosave = plannerAutosave;
  window.migratePlannerLocalScope = migratePlannerLocalScope;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_STAGES,
    PLANNER_STAGE_LABEL,
    PLANNER_STAGE_KEYS,
    plannerScopeIds,
    plannerScopeIsRemote,
    plannerSnapshotPayload,
    applyPlannerSnapshot,
    plannerSnapshotSummary,
    plannerSnapshotWhen,
    PlannerStore,
    plannerAutosave,
    migratePlannerLocalScope,
  };
}
