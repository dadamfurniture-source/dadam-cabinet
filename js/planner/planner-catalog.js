// ============================================================
// D2: 마감 카탈로그 — planner-catalog.js (구조 페이지 · 디테일 모드 전용)
//
// D0 의 팔레트는 js/detaildesign/bom-finish-color.js 의 7 마감 × 7 색(PET-OAK-M …)을
// 그 자리에서 조합했다. 정본은 그때도 `materials` 표 하나였지만(계획 §4.3) 플래너는
// DB 를 읽지 않았다. C0(#634)·예림 LUX 시드(#636)로 표에 **실제 자재 144종**이 들어왔으니
// 이제 팔레트는 그 표를 읽는다.
//
//   팔레트 정본 = materials 의 vendor='yerim' 행 (door_material 117 + body_material 27),
//                series → finish 순으로 묶는다 (Supreme → PET Matt …).
//   상판(top)   = category='countertop' 행 (TOP-SNW …, C0).
//   구 7×7      = bom-finish-color.js 의 PET-OAK-M 코드. **호환 그룹**으로만 남긴다 — 맨 뒤,
//                접힌 채. 코드는 과거 문서·가격에 박혀 있으니 지우지 않는다 (I6).
//   호환 코드   = C2b(designui-catalog-select.md) 의 `{COLOR}-M` / `{COLOR}-G` (WHT-G …). 부모 셀렉트가 옛 색을
//                무광·유광으로 고를 때 쓰는 합성 코드 — materials.code 가 아니라 여기서 색 목록으로 만들어
//                같은 호환 그룹에 넣는다 (plannerCatalogCompatToneEntries). 없으면 그 부재는 색을 못 받는다.
//
// 읽는 길: PlannerStore 가 쓰는 것과 같은 Supabase 클라이언트 → sessionStorage 캐시(1시간)
//   → 둘 다 안 되면 plannerFinishCatalog(window.DadamBomFinishColor) (fallback:true).
//   DB 는 **덤**이다 — 못 읽어도 팔레트는 뜬다 (planner-store.js 와 같은 원칙).
//
// 돌려주는 것 (PlannerCatalog.build / load):
//   {
//     entries: [{ code, label, hex, tone, roughness, metalness, clearcoat, grain, slots[],
//                 group, series, finish, finishLabel, colorLabel, vendor, vendorCode,
//                 textureUrl, tileMm, category, sort, color }],
//     groups:  [{ key, label, codes[], slots[], count, compat, collapsed }],
//     byCode:  { [code]: entry },
//     finishes: plannerFinishCatalog 의 finishes (D0 시험 호환),
//     source:  'db' | 'local' | 'builtin',
//     fallback: source !== 'db',
//     yerim:   예림 행 수,
//   }
//   entries 의 D0 필드(code·label·hex·finish·finishLabel·tone·color·colorLabel)는 그대로 두고
//   **더하기만** 했다 — plannerFinishLookup / plannerFinishHex 가 그대로 읽는다.
//
// 텍스처: texture_url·tile_mm·grain 을 그대로 실어 나른다. 2026-09-16 부터 예림 144종에는
//   저장소 안의 타일(assets/materials/yerim/<code>.jpg)이 들어 있다 — planner-materials.js 가
//   그 값으로 map 을 건다. 비어 있는 항목(구 7×7 호환 코드 등)은 null 이라 아무것도 하지 않는다.
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_CATALOG_ / plannerCatalog / PlannerCatalog 접두.
// ============================================================

/** sessionStorage 캐시 키. 행 원본을 담는다 — 묶는 규칙이 바뀌어도 캐시는 유효하다. */
const PLANNER_CATALOG_CACHE_KEY = 'dadam_catalog_v1';
const PLANNER_CATALOG_TTL_MS = 60 * 60 * 1000;

/** materials 에서 읽는 열. texture_url·tile_mm 은 예림 144종에 채워져 있다 (2026-09-16). */
const PLANNER_CATALOG_SELECT = 'code, vendor, vendor_code, series, finish, tone, color_name, color_hex, '
  + 'roughness, metalness, clearcoat, grain, texture_url, tile_mm, slot, category, sort';

/** DB slot 값 → 플래너 슬롯 (PLANNER_FINISH_SLOTS). drawer_front 만 이름이 다르다. */
const PLANNER_CATALOG_DB_SLOT = {
  door: 'door', drawer_front: 'drawerFront', drawerFront: 'drawerFront', body: 'body', top: 'top',
  handle: 'handle', finishing: 'finishing', kick: 'kick',
};

/** slot 열이 비었을 때 category 로 정하는 기본 슬롯. */
const PLANNER_CATALOG_CATEGORY_SLOTS = {
  door_material: ['door', 'drawerFront'],
  body_material: ['body'],
  countertop: ['top'],
};

/**
 * 호환 그룹 — 구 7×7(PET-OAK-M …) + C2b 호환 코드({COLOR}-M/G) + vendor 없는 DB 행.
 * 슬롯 필터에 걸리지 않게 슬롯 전부를 갖는다 — 손잡이·마감재·걸레받이는 이 그룹뿐이다.
 * 라벨은 부모 셀렉트(config-constants.js COMPAT_GROUP_LABEL)와 같은 '기타(호환)' — 같은 코드를 같은 이름으로.
 */
const PLANNER_CATALOG_COMPAT_KEY = 'compat';
const PLANNER_CATALOG_COMPAT_LABEL = '기타(호환)';
const PLANNER_CATALOG_TOP_KEY = 'countertop';
const PLANNER_CATALOG_TOP_LABEL = '상판';

/** 예림 series 의 표시 순서. 표에 없는 series 는 뒤에 이름순. */
const PLANNER_CATALOG_SERIES_ORDER = ['Prestige', 'Supreme', 'Deco', 'Prime', 'Body'];

function plannerCatalogNum(v, dflt) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return (typeof n === 'number' && Number.isFinite(n)) ? n : dflt;
}

/** '#FAFAFA' → '#fafafa'. 6자리 hex 가 아니면 null. */
function plannerCatalogHex(v) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(v == null ? '' : v).trim());
  return m ? '#' + m[1].toLowerCase() : null;
}

/** tone 열 → 'matte' | 'gloss' | 'single'. 모르는 값·null 은 single (3D 에서는 무광으로 본다). */
function plannerCatalogTone(v) {
  return (v === 'matte' || v === 'gloss' || v === 'single') ? v : 'single';
}

/** DB slot[] (+category) → 플래너 슬롯 목록. 모르는 값은 버린다. */
function plannerCatalogSlots(row) {
  const out = [];
  const raw = Array.isArray(row && row.slot) ? row.slot : [];
  raw.forEach((s) => { const k = PLANNER_CATALOG_DB_SLOT[s]; if (k && out.indexOf(k) < 0) out.push(k); });
  if (!out.length && row && PLANNER_CATALOG_CATEGORY_SLOTS[row.category]) return PLANNER_CATALOG_CATEGORY_SLOTS[row.category].slice();
  return out;
}

/** 'Supreme PET Matt' 에서 series 'Supreme' 을 떼면 'PET Matt' — 그룹 제목이 "Supreme · PET Matt" 가 된다. */
function plannerCatalogFinishShort(series, finish) {
  const f = String(finish || '').trim();
  const s = String(series || '').trim();
  if (s && f.toLowerCase().indexOf(s.toLowerCase() + ' ') === 0) return f.slice(s.length + 1).trim() || f;
  return f;
}

/** 그룹 키 — series·finish 로. 상판·호환은 고정 키. */
function plannerCatalogGroupKeyOf(row) {
  if (row.category === 'countertop') return PLANNER_CATALOG_TOP_KEY;
  if (row.vendor !== 'yerim') return PLANNER_CATALOG_COMPAT_KEY;
  const s = String(row.series || '').trim() || '기타';
  const f = plannerCatalogFinishShort(s, row.finish) || '기타';
  return (row.vendor + ':' + s + ':' + f).toLowerCase().replace(/\s+/g, '-');
}

/** DB 행 하나 → 팔레트 항목. code·hex 가 없으면 null (팔레트에 놓을 수 없다). */
function plannerCatalogEntryOf(row) {
  if (!row || typeof row.code !== 'string' || !row.code.trim()) return null;
  const hex = plannerCatalogHex(row.color_hex);
  if (!hex) return null;
  const code = row.code.trim();
  const series = String(row.series || '').trim();
  const finishLabel = row.category === 'countertop' ? PLANNER_CATALOG_TOP_LABEL
    : (plannerCatalogFinishShort(series, row.finish) || String(row.finish || '').trim() || '');
  const colorLabel = String(row.color_name || '').trim() || code;
  const tone = plannerCatalogTone(row.tone);
  return {
    code,
    label: finishLabel ? finishLabel + ' · ' + colorLabel : colorLabel,
    hex,
    tone,
    roughness: plannerCatalogNum(row.roughness, null),
    metalness: plannerCatalogNum(row.metalness, null),
    clearcoat: plannerCatalogNum(row.clearcoat, null),
    grain: (row.grain === 'h' || row.grain === 'v') ? row.grain : 'none',
    slots: plannerCatalogSlots(row),
    group: plannerCatalogGroupKeyOf(row),
    series,
    finish: String(row.finish || '').trim(),
    finishLabel,
    color: colorLabel,
    colorLabel,
    vendor: row.vendor || null,
    vendorCode: (row.vendor_code && String(row.vendor_code).trim()) || (code.indexOf('YR-') === 0 ? code.slice(3) : code),
    textureUrl: (typeof row.texture_url === 'string' && row.texture_url.trim()) ? row.texture_url.trim() : null,
    tileMm: plannerCatalogNum(row.tile_mm, null),
    category: row.category || null,
    sort: plannerCatalogNum(row.sort, 0),
  };
}

/**
 * C2b 호환 코드 `{COLOR}-M` / `{COLOR}-G` (designui-catalog-select.md "기타(호환) 그룹").
 *
 * 부모(상세설계 도어 셀렉트)는 옛 색 행(WHT …)을 무광·유광 두 옵션으로 내고 `specs.doorMaterial*` 과
 * `item.detail…door.code` 에 합성 코드(`WHT-G`)를 그대로 싣는다. 이 코드는 `materials.code` 가 아니라
 * DB 에도 로컬 정본(7 마감 × 색)에도 없다 — plannerFinishLookup 이 정확 일치라 못 찾고, 그 부재는 색을
 * 잃었다 (구조 단계 색 그대로). 여기서 색 목록(bom-finish-color DOOR_COLOR_CATALOG: 옛 7색 + GRY BGE NVY)
 * 으로 같은 코드를 만들어 호환 그룹에 넣는다 — 색은 그 색 행의 hex, 톤은 접미사, 라벨 `{색} · 무광/유광`.
 *
 * @param {Array<{value,code,label,hex}>} colors  plannerFinishCatalog(api).colors
 * @param {number} startSort  호환 그룹 안에서 구 7×7 뒤에 서게 하는 정렬 시작값
 */
const PLANNER_CATALOG_COMPAT_TONES = [
  { suffix: 'M', tone: 'matte', label: '무광' },
  { suffix: 'G', tone: 'gloss', label: '유광' },
];
function plannerCatalogCompatToneEntries(colors, startSort) {
  const out = [];
  (Array.isArray(colors) ? colors : []).forEach((c) => {
    const hex = plannerCatalogHex(c && c.hex);
    const code = c && typeof c.code === 'string' ? c.code.trim() : '';
    if (!code || !hex) return;
    PLANNER_CATALOG_COMPAT_TONES.forEach((t) => {
      out.push({
        code: code + '-' + t.suffix,
        label: c.label + ' · ' + t.label,
        hex,
        tone: t.tone,
        roughness: null, metalness: null, clearcoat: null, grain: 'none',
        slots: PLANNER_FINISH_SLOTS.slice(),
        group: PLANNER_CATALOG_COMPAT_KEY,
        series: '', finish: '', finishLabel: t.label,
        color: c.value || code, colorLabel: c.label,
        vendor: null, vendorCode: code,
        textureUrl: null, tileMm: null, category: 'door_material',
        sort: startSort + out.length,
        compatTone: true,
      });
    });
  });
  return out;
}

/** plannerFinishCatalog 의 항목(구 7×7) → 이 파일의 항목 모양. 슬롯은 전부. */
function plannerCatalogCompatEntry(e, i) {
  return Object.assign({}, e, {
    tone: plannerCatalogTone(e.tone),
    roughness: null, metalness: null, clearcoat: null, grain: 'none',
    slots: PLANNER_FINISH_SLOTS.slice(),
    group: PLANNER_CATALOG_COMPAT_KEY,
    series: '', finishLabel: e.finishLabel || '', colorLabel: e.colorLabel || e.label,
    vendor: null, vendorCode: e.code,
    textureUrl: null, tileMm: null, category: 'door_material', sort: i,
  });
}

function plannerCatalogSeriesRank(series) {
  const i = PLANNER_CATALOG_SERIES_ORDER.indexOf(series);
  return i < 0 ? PLANNER_CATALOG_SERIES_ORDER.length : i;
}

/**
 * 행 목록 + 로컬 정본(api) → 카탈로그. 순수 함수 — DB 도 저장소도 모른다.
 *
 * 순서: 예림(series 순 → sort 순) → 상판 → 호환. 같은 코드가 두 번 오면 앞의 것이 이긴다.
 * 예림 행이 0 이면 source 는 DB 를 읽었더라도 'local'(api 있음) / 'builtin'(api 없음) 이다 —
 * 시드가 안 들어간 DB 는 "정본 없음" 이지 정본이 아니다.
 *
 * @param {Array<object>} rows  materials 행 (active=true)
 * @param {object} [api] window.DadamBomFinishColor
 */
function plannerCatalogBuild(rows, api) {
  const local = plannerFinishCatalog(api);
  const list = Array.isArray(rows) ? rows : [];
  const yerim = [], top = [], other = [];
  list.forEach((r) => {
    const e = plannerCatalogEntryOf(r);
    if (!e) return;
    if (e.vendor === 'yerim') yerim.push(e);
    else if (e.category === 'countertop') top.push(e);
    else other.push(e);
  });
  const bySort = (a, b) => (a.sort - b.sort) || a.code.localeCompare(b.code);
  yerim.sort((a, b) => (plannerCatalogSeriesRank(a.series) - plannerCatalogSeriesRank(b.series)) || bySort(a, b));
  top.sort(bySort);
  other.sort(bySort);
  const compat = local.entries.map(plannerCatalogCompatEntry);
  // C2b 호환 코드 {COLOR}-M/G — 구 7×7 뒤에. 부모 셀렉트가 고른 WHT-G 가 여기서 풀려 부재에 색이 든다.
  const compatTones = plannerCatalogCompatToneEntries(local.colors, compat.length);

  const entries = [];
  const byCode = {};
  const push = (e) => { if (byCode[e.code]) return; byCode[e.code] = e; entries.push(e); };
  yerim.forEach(push);
  top.forEach(push);
  compat.forEach(push);
  compatTones.forEach(push);
  // DB 에만 있는 그 밖의 행(vendor 없음·상판 아님)도 호환 그룹 뒤에 붙인다 — 잃지 않는다.
  other.forEach((e) => push(Object.assign(e, { group: PLANNER_CATALOG_COMPAT_KEY, slots: e.slots.length ? e.slots : PLANNER_FINISH_SLOTS.slice() })));

  const hasDb = yerim.length > 0;
  const groups = [];
  const gmap = {};
  entries.forEach((e) => {
    let g = gmap[e.group];
    if (!g) {
      const isCompat = e.group === PLANNER_CATALOG_COMPAT_KEY;
      const isTop = e.group === PLANNER_CATALOG_TOP_KEY;
      g = {
        key: e.group,
        label: isCompat ? PLANNER_CATALOG_COMPAT_LABEL : isTop ? PLANNER_CATALOG_TOP_LABEL
          : ((e.series ? e.series + ' · ' : '') + (e.finishLabel || '기타')),
        codes: [], slots: [], count: 0,
        compat: isCompat,
        // 호환 그룹은 예림이 있을 때만 접는다 — 폴백 화면에서 유일한 그룹이 접혀 있으면 빈 팔레트로 보인다.
        collapsed: isCompat && hasDb,
      };
      gmap[e.group] = g;
      groups.push(g);
    }
    g.codes.push(e.code);
    g.count++;
    e.slots.forEach((s) => { if (g.slots.indexOf(s) < 0) g.slots.push(s); });
  });
  // 호환 그룹은 언제나 맨 뒤
  groups.sort((a, b) => (a.compat ? 1 : 0) - (b.compat ? 1 : 0));

  return {
    entries,
    groups,
    byCode,
    finishes: local.finishes,
    source: hasDb ? 'db' : (local.fallback ? 'builtin' : 'local'),
    fallback: !hasDb,
    yerim: yerim.length,
  };
}

/** 슬롯에 맞는 그룹만. slot 이 없으면 전부. */
function plannerCatalogGroupsForSlot(catalog, slot) {
  if (!catalog || !Array.isArray(catalog.groups)) return [];
  if (!slot) return catalog.groups.slice();
  return catalog.groups.filter((g) => g.slots.indexOf(slot) >= 0);
}

/** 이름·코드 부분 일치 (대소문자 무시). q 가 비면 전부. */
function plannerCatalogSearch(catalog, q) {
  if (!catalog || !Array.isArray(catalog.entries)) return [];
  const s = String(q == null ? '' : q).trim().toLowerCase();
  if (!s) return catalog.entries.slice();
  return catalog.entries.filter((e) =>
    e.code.toLowerCase().indexOf(s) >= 0
    || String(e.colorLabel || '').toLowerCase().indexOf(s) >= 0
    || String(e.label || '').toLowerCase().indexOf(s) >= 0
    || String(e.vendorCode || '').toLowerCase().indexOf(s) >= 0);
}

const PlannerCatalog = {
  CACHE_KEY: PLANNER_CATALOG_CACHE_KEY,
  TTL_MS: PLANNER_CATALOG_TTL_MS,
  SELECT: PLANNER_CATALOG_SELECT,
  COMPAT_KEY: PLANNER_CATALOG_COMPAT_KEY,
  TOP_KEY: PLANNER_CATALOG_TOP_KEY,
  /** 마지막으로 만든 카탈로그. load() 가 채운다. */
  current: null,
  _loading: null,

  build: plannerCatalogBuild,
  entryOf: plannerCatalogEntryOf,
  groupsForSlot: plannerCatalogGroupsForSlot,
  search: plannerCatalogSearch,

  api() { return (typeof window !== 'undefined') ? window.DadamBomFinishColor : null; },

  storage(opt) {
    if (opt && opt.storage) return opt.storage;
    try { return (typeof sessionStorage !== 'undefined') ? sessionStorage : null; } catch (e) { return null; }
  },

  /** PlannerStore 와 같은 클라이언트. 없으면 같은 방식으로 만든다. */
  client(opt) {
    if (opt && opt.client) return opt.client;
    try {
      if (typeof PlannerStore !== 'undefined' && PlannerStore && typeof PlannerStore.client === 'function') {
        const c = PlannerStore.client();
        if (c) return c;
      }
      const cfg = typeof window !== 'undefined' && window.DADAM_CONFIG;
      const sdk = typeof window !== 'undefined' && window.supabase;
      if (!cfg || !cfg.supabase || !sdk || !sdk.createClient) return null;
      return sdk.createClient(cfg.supabase.url, cfg.supabase.anonKey);
    } catch (e) { return null; }
  },

  /** 캐시에서 행을 읽는다. { rows, fresh } — 없거나 깨졌으면 null. */
  readCache(opt) {
    const st = this.storage(opt);
    if (!st) return null;
    try {
      const raw = st.getItem(PLANNER_CATALOG_CACHE_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !Array.isArray(o.rows) || typeof o.at !== 'number') return null;
      const now = (opt && typeof opt.now === 'number') ? opt.now : Date.now();
      return { rows: o.rows, fresh: (now - o.at) >= 0 && (now - o.at) < PLANNER_CATALOG_TTL_MS };
    } catch (e) { return null; }
  },

  writeCache(rows, opt) {
    const st = this.storage(opt);
    if (!st) return false;
    try {
      const now = (opt && typeof opt.now === 'number') ? opt.now : Date.now();
      st.setItem(PLANNER_CATALOG_CACHE_KEY, JSON.stringify({ at: now, rows }));
      return true;
    } catch (e) { return false; }
  },

  clearCache(opt) {
    const st = this.storage(opt);
    try { if (st) st.removeItem(PLANNER_CATALOG_CACHE_KEY); } catch (e) { /* 저장소 막힘 */ }
  },

  /**
   * 네트워크 없이 지금 당장 쓸 카탈로그 — 신선한 캐시가 있으면 그것, 없으면 로컬 정본.
   * mount 가 동기로 팔레트를 그릴 때 쓴다. load() 가 나중에 갈아 끼운다.
   */
  sync(opt) {
    const c = this.readCache(opt);
    const cat = plannerCatalogBuild(c && c.fresh ? c.rows : [], this.api());
    this.current = cat;
    return cat;
  },

  /** DB 에서 행을 읽는다. 실패하면 null (던지지 않는다). */
  async fetchRows(opt) {
    const client = this.client(opt);
    if (!client) return null;
    try {
      const { data, error } = await client
        .from('materials')
        .select(PLANNER_CATALOG_SELECT)
        .eq('active', true)
        .order('sort', { ascending: true });
      if (error || !Array.isArray(data)) return null;
      return data;
    } catch (e) { return null; }
  },

  /**
   * 캐시(1시간) → DB → 낡은 캐시 → 로컬 정본 순으로 카탈로그를 만든다. 언제나 resolve 한다.
   * @param {{force?:boolean, client?:object, storage?:object, now?:number}} [opt] force 면 캐시를 건너뛴다
   */
  async load(opt) {
    const o = opt || {};
    const cached = this.readCache(o);
    if (!o.force && cached && cached.fresh) {
      this.current = plannerCatalogBuild(cached.rows, this.api());
      return this.current;
    }
    let rows = await this.fetchRows(o);
    if (rows) {
      // 예림 행이 하나도 없는 DB 는 캐시하지 않는다 — 시드가 들어온 뒤 바로 보이게.
      if (rows.some((r) => r && r.vendor === 'yerim')) this.writeCache(rows, o);
    } else if (cached) {
      rows = cached.rows;   // 낡았어도 없는 것보다 낫다
    }
    this.current = plannerCatalogBuild(rows || [], this.api());
    return this.current;
  },
};

if (typeof window !== 'undefined') {
  window.PlannerCatalog = PlannerCatalog;
  window.PLANNER_CATALOG_CACHE_KEY = PLANNER_CATALOG_CACHE_KEY;
  window.plannerCatalogBuild = plannerCatalogBuild;
  window.plannerCatalogEntryOf = plannerCatalogEntryOf;
  window.plannerCatalogGroupsForSlot = plannerCatalogGroupsForSlot;
  window.plannerCatalogSearch = plannerCatalogSearch;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_CATALOG_CACHE_KEY,
    PLANNER_CATALOG_TTL_MS,
    PLANNER_CATALOG_SELECT,
    PLANNER_CATALOG_DB_SLOT,
    PLANNER_CATALOG_CATEGORY_SLOTS,
    PLANNER_CATALOG_COMPAT_KEY,
    PLANNER_CATALOG_COMPAT_LABEL,
    PLANNER_CATALOG_TOP_KEY,
    PLANNER_CATALOG_TOP_LABEL,
    plannerCatalogHex,
    plannerCatalogTone,
    plannerCatalogSlots,
    plannerCatalogFinishShort,
    plannerCatalogEntryOf,
    plannerCatalogCompatToneEntries,
    PLANNER_CATALOG_COMPAT_TONES,
    plannerCatalogBuild,
    plannerCatalogGroupsForSlot,
    plannerCatalogSearch,
    PlannerCatalog,
  };
}
