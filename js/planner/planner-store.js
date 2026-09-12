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
    // 2026-09-13: 새 품목의 uniqueId 는 Date.now()+Math.random() 이라 **소수**로 온다
    //   (ui-step1.js incrementCategory → iframe 의 item=1789….5123). 정수만 받던 예전 판정은
    //   설계를 저장한 뒤에도 no-scope 를 돌려줘 도면 저장이 조용히 실패했다.
    //   DB(item_unique_id BIGINT)·design_items.unique_id 와 같은 규칙으로 내림한다.
    if (item && item !== 'bootstrap' && /^\d+(\.\d+)?$/.test(item)) out.itemId = Math.floor(Number(item));
    // 품목이 하나도 없을 때 뜨는 부트스트랩 플래너 — 설계 저장으로도 풀리지 않는다 (품목이 먼저다)
    if (item === 'bootstrap') out.bootstrap = true;
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
/**
 * 스냅샷의 출처 표시 — 지금 스코프면 빈 문자열, 다른 설계·품목이면 "설계명 · 품목명".
 * listAll 이 붙인 design_name / item_name 을 쓴다.
 */
function plannerSnapshotOrigin(row, ids) {
  if (!row) return '';
  const same = ids && ids.designId && row.design_id === ids.designId
    && Number(row.item_unique_id) === Number(ids.itemId);
  if (same) return '';
  const d = row.design_name || '다른 설계';
  const it = row.item_name || (row.item_unique_id != null ? '품목 ' + row.item_unique_id : '');
  return it ? `${d} · ${it}` : d;
}

function plannerSnapshotWhen(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return sameDay ? `오늘 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  } catch (e) { return ''; }
}

/**
 * 자동 저장 on/off (W12-75).
 *
 * 브라우저 하나의 취향이라 스코프를 붙이지 않는다 — 설계·품목이 바뀌어도
 * "나는 자동 저장을 쓴다/안 쓴다" 는 그대로여야 한다.
 * 기본은 켜짐. 저장소를 못 읽어도(사생활 모드 등) 켜진 것으로 본다.
 */
const PLANNER_AUTOSAVE_KEY = 'dadam_planner_autosave_v1';

function plannerAutosaveEnabled() {
  try { return localStorage.getItem(PLANNER_AUTOSAVE_KEY) !== 'off'; }
  catch (e) { return true; }
}

function setPlannerAutosave(on) {
  try { localStorage.setItem(PLANNER_AUTOSAVE_KEY, on ? 'on' : 'off'); } catch (e) {}
  return !!on;
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
    // 2026-09-13: 품목이 없으면(bootstrap) 'no-item' — 설계 저장을 부탁해도 "저장할 설계 내용이 없습니다" 로
    //   막히므로 그 길로 보내지 않고 "품목을 먼저 추가" 를 말해야 한다.
    if (!plannerScopeIsRemote(ids)) return { ok: false, reason: ids.bootstrap ? 'no-item' : 'no-scope', ids };
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
   * 로그인만 확인한다 — 스코프(설계 저장 여부)는 보지 않는다.
   * 계정 전체 목록(listAll)과 되쓰기(loadAny)는 설계를 아직 저장하지 않은 품목에서도 되어야 한다:
   * "예전에 저장해 둔 배치를 새 설계에 불러오기" 가 그 경우다 (2026-09-13).
   */
  async session() {
    const c = this.client();
    if (!c) return { ok: false, reason: 'no-sdk' };
    try {
      const { data } = await c.auth.getSession();
      if (!data || !data.session) return { ok: false, reason: 'no-session' };
      return { ok: true, client: c };
    } catch (e) {
      return { ok: false, reason: 'no-session' };
    }
  },

  /**
   * 2026-09-13: 내 계정의 **모든 설계·품목**에서 이 단계의 스냅샷을 모은다 — 파일 불러오기처럼.
   * 어느 설계·어느 품목 것인지 알 수 있게 designs.name 과 design_items.name 을 붙인다.
   * 소유권은 RLS(designs.user_id)가 거른다. 다른 벽 치수의 배치를 들여오는 판단은 사람 몫이라
   * 메뉴가 출처를 보여 주고 확인을 받는다.
   */
  async listAll(stage, limit) {
    const r = await this.session();
    if (!r.ok) return Object.assign({ rows: [] }, r);
    try {
      const { data, error } = await r.client
        .from('planner_snapshots')
        .select('id, stage, name, is_autosave, created_at, updated_at, payload, design_id, item_unique_id, designs(name)')
        .eq('stage', stage)
        .order('updated_at', { ascending: false })
        .limit(limit || 50);
      if (error) throw error;
      const rows = data || [];
      const designIds = Array.from(new Set(rows.map((x) => x.design_id).filter(Boolean)));
      let items = [];
      if (designIds.length) {
        const q = await r.client
          .from('design_items')
          .select('design_id, unique_id, name, category')
          .in('design_id', designIds);
        items = (q && q.data) || [];
      }
      const itemName = (row) => {
        const it = items.find((i) => i.design_id === row.design_id
          && Number(i.unique_id) === Number(row.item_unique_id));
        return it ? (it.name || it.category || null) : null;
      };
      return {
        ok: true,
        rows: rows.map((row) => Object.assign({}, row, {
          design_name: (row.designs && row.designs.name) || null,
          item_name: itemName(row),
        })),
      };
    } catch (e) {
      return { ok: false, reason: 'error', message: e && e.message, rows: [] };
    }
  },

  /**
   * 어느 설계·품목의 스냅샷이든 **지금 스코프**의 localStorage 로 되쓴다 (2026-09-13).
   * loadInto 와 달리 설계가 저장돼 있지 않아도 된다 — 되쓸 곳은 이 브라우저의 키다.
   *
   * @param {string} [stage] 지금 화면의 단계. 넘기면 **그 단계 저장본만** 받는다 —
   *   배치 저장본은 배치 단계에서만, 구조는 구조에서만, 디테일은 디테일에서만 불러온다.
   *   목록이 이미 단계로 걸러져 있지만, id 하나로 들어오는 길(수정된 DOM·옛 링크)까지 막는다.
   */
  async loadAny(id, stage) {
    const r = await this.session();
    if (!r.ok) return r;
    try {
      const { data, error } = await r.client
        .from('planner_snapshots')
        .select('id, stage, name, payload, created_at, design_id, item_unique_id')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (stage && data.stage !== stage) {
        const want = PLANNER_STAGE_LABEL[stage] || stage, got = PLANNER_STAGE_LABEL[data.stage] || data.stage;
        return { ok: false, reason: 'stage-mismatch', row: data,
          message: `${got} 도면은 ${got} 단계에서만 불러올 수 있습니다 (지금은 ${want} 단계)` };
      }
      const applied = applyPlannerSnapshot(data.stage, data.payload, (base, val) => {
        const key = (typeof scopedKey === 'function') ? scopedKey(base) : base;
        localStorage.setItem(key, val);
      });
      return { ok: true, row: data, applied };
    } catch (e) {
      return { ok: false, reason: 'error', message: e && e.message };
    }
  },

  /**
   * 이 품목·이 단계의 스냅샷 목록. 다른 품목·다른 설계는 보여주지 않는다 —
   * 다른 벽 치수의 배치가 들어오면 트리밍·코너가 어긋나기 때문이다(계획 Q3).
   * 계정 전체는 listAll (사람이 출처를 보고 고른다).
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
  // W12-75: 꺼 두면 계정에 올리지 않는다. localStorage 저장은 그대로 돈다 —
  //   자동 저장 토글은 "계정에 올릴지" 를 정하는 것이지 작업을 잃는 스위치가 아니다.
  if (!plannerAutosaveEnabled()) return false;
  const wait = delayMs == null ? 1500 : delayMs;
  clearTimeout(_plannerAutosaveTimers[stage]);
  _plannerAutosaveTimers[stage] = setTimeout(() => {
    PlannerStore.save(stage, { autosave: true });
  }, wait);
  return true;
}

// ────────────────────────────────────────────────────────────
// 2026-09-13: 플래너에서 저장을 눌렀는데 설계가 아직 저장되지 않은 경우(no-scope).
//   예전엔 "상세설계에서 설계를 저장하세요" 로 끝났다. 사용자는 왜 두 번 저장해야 하는지
//   알 수 없다. 이제 플래너가 부모(detaildesign)에 설계 저장을 부탁하고, 끝나면
//   이 iframe 의 스코프를 새 설계 id 로 갈아탄 뒤 미뤄 둔 저장을 이어서 한다.
//
//   플래너  → 부모   DADAM_REQUEST_SAVE_DESIGN { itemUniqueId, itemParam }
//   부모    → 플래너 DADAM_DESIGN_SAVED { designId }  /  DADAM_DESIGN_SAVE_CANCELED
//
//   스코프 키(LAYOUT_STORAGE_KEY 등)는 페이지가 뜰 때 한 번 굳으므로 제자리에서 못 바꾼다 —
//   local 키를 새 스코프로 옮기고 URL 의 design= 만 바꿔 **같은 단계**를 다시 연다.
// ────────────────────────────────────────────────────────────
const PLANNER_PENDING_SAVE_KEY = 'dadam_planner_pending_save_v1';

/** 이 iframe 이 URL 에 쓰는 item 문자열 그대로 (float 일 수 있다 — 저장 키가 그 문자열로 돼 있다). */
function plannerItemParam() {
  try { return new URLSearchParams(location.search).get('item') || ''; } catch (e) { return ''; }
}

/**
 * 부모에게 설계 저장을 부탁한다. 미룬 저장(stage·name)은 sessionStorage 에 남겨
 * 스코프를 갈아탄 뒤 plannerRunPendingSave 가 이어서 한다.
 * @returns {boolean} 부탁을 보냈으면 true (부모가 없는 단독 화면이면 false)
 */
function plannerRequestDesignSave(pending) {
  try { if (typeof window === 'undefined' || window.parent === window) return false; } catch (e) { return false; }
  if (plannerItemParam() === 'bootstrap') return false;   // 품목이 없으면 설계 저장으로 풀리지 않는다
  try { sessionStorage.setItem(PLANNER_PENDING_SAVE_KEY, JSON.stringify(pending || {})); } catch (e) {}
  try {
    window.parent.postMessage({
      type: 'DADAM_REQUEST_SAVE_DESIGN',
      // plannerScopeIds 는 design=local 이면 itemId 도 null 로 돌려준다 — 여기선 품목 번호가 꼭 필요하다
      itemUniqueId: Number.isFinite(Number(plannerItemParam())) ? Number(plannerItemParam()) : null,
      itemParam: plannerItemParam(),
    }, location.origin);
    return true;
  } catch (e) { return false; }
}

/** 부모가 설계를 저장했다 — local 키를 새 스코프로 옮기고 같은 단계를 새 스코프로 다시 연다. */
function plannerOnDesignSaved(designId) {
  if (!designId) return false;
  const item = plannerItemParam();
  if (item) migratePlannerLocalScope(designId, item);
  try { sessionStorage.setItem('fromStructure', '1'); } catch (e) {}   // 배치 단계 autoRestore 용
  try {
    const q = new URLSearchParams(location.search);
    q.set('design', String(designId));
    location.replace(location.pathname + '?' + q.toString());
  } catch (e) { return false; }
  return true;
}

/** 스코프를 갈아탄 뒤 미뤄 둔 이름 저장을 이어서 한다. 토큰은 1회용. */
async function plannerRunPendingSave(toast) {
  let pending = null;
  try {
    const raw = sessionStorage.getItem(PLANNER_PENDING_SAVE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PLANNER_PENDING_SAVE_KEY);
    pending = JSON.parse(raw);
  } catch (e) { return null; }
  if (!pending || !pending.stage) return null;
  const label = PLANNER_STAGE_LABEL[pending.stage] || pending.stage;
  const ready = await PlannerStore.ready();
  if (!ready.ok) {
    // 조용히 삼키면 "저장이 왜 안 되지" 가 된다 — 이유를 말한다.
    if (typeof toast === 'function') {
      toast(`⚠ ${label} 도면 저장 실패: ` + (typeof plannerDrawingExcuse === 'function' ? plannerDrawingExcuse(ready.reason) : ready.reason));
    }
    return { ok: false, reason: ready.reason };
  }
  const r = await PlannerStore.save(pending.stage, pending.name ? { name: pending.name } : { autosave: true });
  if (typeof toast === 'function') {
    toast(r.ok ? `💾 설계 저장 후 ${label} 도면을 계정에 저장했습니다${pending.name ? ' — ' + pending.name : ''}`
               : `⚠ ${label} 도면 저장 실패: ${r.message || r.reason}`);
  }
  return r;
}

/** 부모의 답을 듣는다. 페이지마다 한 번 건다. */
function plannerListenDesignSaved(toast) {
  if (typeof window === 'undefined') return;
  window.addEventListener('message', (e) => {
    if (!e.data || e.origin !== location.origin) return;
    if (e.data.type === 'DADAM_DESIGN_SAVED' && e.data.designId) plannerOnDesignSaved(e.data.designId);
    else if (e.data.type === 'DADAM_DESIGN_SAVE_CANCELED') {
      try { sessionStorage.removeItem(PLANNER_PENDING_SAVE_KEY); } catch (err) {}
      if (typeof toast === 'function') {
        toast(e.data.reason === 'no-items'
          ? "⚠ 품목이 아직 없습니다 — 좌측 '품목' 아이콘으로 품목을 먼저 추가한 뒤 도면 저장을 누르세요"
          : '설계 저장을 취소해 도면은 이 브라우저에만 남았습니다');
      }
    }
  });
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
  window.plannerSnapshotOrigin = plannerSnapshotOrigin;
  window.PLANNER_PENDING_SAVE_KEY = PLANNER_PENDING_SAVE_KEY;
  window.plannerRequestDesignSave = plannerRequestDesignSave;
  window.plannerOnDesignSaved = plannerOnDesignSaved;
  window.plannerRunPendingSave = plannerRunPendingSave;
  window.plannerListenDesignSaved = plannerListenDesignSaved;
  window.PlannerStore = PlannerStore;
  window.plannerAutosave = plannerAutosave;
  window.plannerAutosaveEnabled = plannerAutosaveEnabled;
  window.setPlannerAutosave = setPlannerAutosave;
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
    plannerSnapshotWhen, plannerSnapshotOrigin,
    PLANNER_PENDING_SAVE_KEY, plannerRequestDesignSave, plannerOnDesignSaved, plannerRunPendingSave, plannerListenDesignSaved,
    PlannerStore,
    plannerAutosave,
    plannerAutosaveEnabled,
    setPlannerAutosave,
    PLANNER_AUTOSAVE_KEY,
    migratePlannerLocalScope,
  };
}
