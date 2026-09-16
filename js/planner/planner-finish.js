// ============================================================
// D0: 디테일 마감 모델 — planner-finish.js
//
// 플래너에는 여태 **색·마감 필드가 하나도 없었다** (계획 §1.1). 배치·구조는
// 치수와 분할만 다루고, 마감은 상세설계(detaildesign)의 specs.doorColorUpper/Lower
// 두 값이 전부였다 — 모듈 하나·부재 하나만 다른 색으로 하고 싶어도 자리가 없었다.
//
// 이 파일은 그 자리를 만든다. **순수 모델**이다 — DOM 도, three.js 도, 저장소도 모른다.
// 화면(planner-detail.js)과 나중의 BOM 이 **같은 해석 함수**를 써야 하기 때문이다
// (계획 §4.2: "3D 와 BOM 이 같은 함수를 쓴다").
//
// 데이터 (계획 §4.2 그대로, 저장 키 dadam_detail_v1):
//
//   {
//     version: 1,
//     item:     { door:{code}, drawerFront:{code}, body:{code}, top:{code}, handle:{code}, finishing:{code}, kick:{code} },
//     sections: { upper:{ door:{code} … }, lower:{ … } },     // 상/하 재정의 (specs 상/하 값과 호환)
//     modules:  { [moduleId]: { door:{code}, body:{code} … } },
//     parts:    { [moduleId]: { [partKey]: {code} } },          // 예: door#1 만 다른 색
//   }
//
// 해석 순서는 **부재 > 모듈 > 섹션 > 품목 > 없음** 한 가지뿐이다 (plannerFinishResolve).
// code 는 카탈로그 정본 코드(`PET-OAK-M`, js/detaildesign/bom-finish-color.js)다.
// 표시명·hex 는 코드로 카탈로그에서 찾는다 — 모델에는 코드만 둔다 (불변조건 I6:
// 코드는 과거 문서·가격에 박혀 있으므로 이름을 바꾸지 않는다).
//
// 슬롯(어느 부재 묶음인가) 7종: door · drawerFront · body · top · handle · finishing · kick.
// 3D 의 userData.entityKind 를 슬롯으로 바꾸는 표(plannerFinishSlotOfKind)와
// 부재 하나를 가리키는 안정된 키(plannerFinishPartKeyOf)도 여기 둔다 —
// 3D 가 mesh 를 어떻게 만들든 "그 도어" 를 같은 이름으로 부르기 위해서다.
//
// ⚠ 클래식 스크립트다. 최상위 이름이 전역 렉시컬 스코프에 들어가므로 전부
//   PLANNER_FINISH_ / plannerFinish / PlannerFinish 접두를 쓴다. 인라인에서 재선언 금지
//   (planner-assets.test.js 가 지킨다).
//
// 브라우저: window.PlannerFinish (+ 개별 함수) / Jest: module.exports
// ============================================================

/** 모델 버전. 형식을 바꾸면 올리고 plannerFinishNormalize 가 옛 판을 읽게 한다. */
const PLANNER_FINISH_VERSION = 1;

/** 슬롯 7종 — 순서는 팔레트 표시 순서다. */
const PLANNER_FINISH_SLOTS = ['door', 'drawerFront', 'body', 'top', 'handle', 'finishing', 'kick'];

const PLANNER_FINISH_SLOT_LABEL = {
  door: '도어',
  drawerFront: '서랍 앞판',
  body: '몸통',
  top: '상판',
  handle: '손잡이',
  finishing: '마감재',
  kick: '걸레받이·좌대',
};

/** 해석 단계. 앞이 우선이다. */
const PLANNER_FINISH_LEVELS = ['part', 'module', 'section', 'item'];

const PLANNER_FINISH_LEVEL_LABEL = { part: '부재', module: '모듈', section: '섹션', item: '품목' };

/** 섹션 재정의는 상/하 두 묶음뿐이다 — 상세설계의 doorColorUpper/Lower 와 같은 구분. */
const PLANNER_FINISH_SECTION_GROUPS = ['upper', 'lower'];

/**
 * 모듈 섹션 → 섹션 묶음.
 * 상부장·후드는 '상부', 나머지(하부·키큰·냉장고장·붙박이장·가전)는 '하부'로 본다.
 * 키큰장은 바닥에서 서므로 하부 묶음이다 — 상세설계도 키큰장 도어를 doorColorLower 로 읽는다.
 */
function plannerFinishSectionGroup(section) {
  return (section === 'upper' || section === 'hood') ? 'upper' : 'lower';
}

/** 빈 모델. 언제나 새 객체다. */
function plannerFinishEmpty() {
  const sections = {};
  PLANNER_FINISH_SECTION_GROUPS.forEach((g) => { sections[g] = {}; });
  return { version: PLANNER_FINISH_VERSION, item: {}, sections, modules: {}, parts: {} };
}

/** `{code}` 항목만 남긴다 — 코드가 빈 문자열이거나 문자열이 아니면 없는 것으로 본다. */
function plannerFinishEntry(v) {
  if (!v) return null;
  const code = typeof v === 'string' ? v : v.code;
  if (typeof code !== 'string' || !code.trim()) return null;
  return { code: code.trim() };
}

/** 슬롯 → {code} 사전에서 아는 슬롯만 남긴다. */
function plannerFinishSlotMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  PLANNER_FINISH_SLOTS.forEach((slot) => {
    const e = plannerFinishEntry(raw[slot]);
    if (e) out[slot] = e;
  });
  return out;
}

/**
 * 어떤 값이 와도 잘 생긴 모델로 만든다 — 저장소에서 읽은 것, 부모가 보낸 것,
 * 옛 판 모두 여기를 지난다. 모르는 슬롯·빈 코드는 조용히 버린다.
 * 원본을 바꾸지 않고 새 객체를 돌려준다.
 */
function plannerFinishNormalize(raw) {
  const out = plannerFinishEmpty();
  let src = raw;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch (e) { src = null; }
  }
  if (!src || typeof src !== 'object') return out;
  out.item = plannerFinishSlotMap(src.item);
  PLANNER_FINISH_SECTION_GROUPS.forEach((g) => {
    out.sections[g] = plannerFinishSlotMap(src.sections && src.sections[g]);
  });
  if (src.modules && typeof src.modules === 'object') {
    Object.keys(src.modules).forEach((id) => {
      if (!id) return;
      const map = plannerFinishSlotMap(src.modules[id]);
      if (Object.keys(map).length) out.modules[id] = map;
    });
  }
  if (src.parts && typeof src.parts === 'object') {
    Object.keys(src.parts).forEach((id) => {
      const partsRaw = src.parts[id];
      if (!id || !partsRaw || typeof partsRaw !== 'object') return;
      const map = {};
      Object.keys(partsRaw).forEach((partKey) => {
        if (!partKey) return;
        const e = plannerFinishEntry(partsRaw[partKey]);
        if (e) map[partKey] = e;
      });
      if (Object.keys(map).length) out.parts[id] = map;
    });
  }
  return out;
}

/** 지정된 항목 수 — 목록 요약("마감 지정 N건")과 "비어 있는가" 판정에 쓴다. */
function plannerFinishCount(detail) {
  const d = detail || {};
  let n = Object.keys(d.item || {}).length;
  Object.keys(d.sections || {}).forEach((g) => { n += Object.keys(d.sections[g] || {}).length; });
  Object.keys(d.modules || {}).forEach((id) => { n += Object.keys(d.modules[id] || {}).length; });
  Object.keys(d.parts || {}).forEach((id) => { n += Object.keys(d.parts[id] || {}).length; });
  return n;
}

// ────────────────────────────────────────────────────────────
// 해석 — 부재 > 모듈 > 섹션 > 품목
// ────────────────────────────────────────────────────────────

/**
 * 한 부재(또는 묶음)의 마감 코드를 정한다.
 *
 * @param {object} detail    plannerFinishNormalize 를 거친 모델
 * @param {string} slot      PLANNER_FINISH_SLOTS 중 하나
 * @param {string} [moduleId]
 * @param {string} [section] 모듈 섹션('lower'…) 또는 섹션 묶음('upper'|'lower')
 * @param {string} [partKey] plannerFinishPartKeyOf 가 준 키
 * @returns {{code:string, level:string}|null} 어느 단계에서 정해졌는지도 돌려준다 — 우측 카드가 보여 준다.
 */
function plannerFinishResolve(detail, slot, moduleId, section, partKey) {
  if (!detail || !slot) return null;
  if (moduleId && partKey && detail.parts && detail.parts[moduleId]) {
    const e = plannerFinishEntry(detail.parts[moduleId][partKey]);
    if (e) return { code: e.code, level: 'part' };
  }
  if (moduleId && detail.modules && detail.modules[moduleId]) {
    const e = plannerFinishEntry(detail.modules[moduleId][slot]);
    if (e) return { code: e.code, level: 'module' };
  }
  if (section && detail.sections) {
    const g = plannerFinishSectionGroup(section);
    const e = plannerFinishEntry(detail.sections[g] && detail.sections[g][slot]);
    if (e) return { code: e.code, level: 'section' };
  }
  if (detail.item) {
    const e = plannerFinishEntry(detail.item[slot]);
    if (e) return { code: e.code, level: 'item' };
  }
  return null;
}

/**
 * 한 단계에 코드를 적는다. **제자리에서** 고치고 같은 객체를 돌려준다 —
 * 되돌리기는 부르는 쪽이 JSON 사본으로 한다 (planner-detail.js).
 *
 * @param {string} level 'item' | 'section' | 'module' | 'part'
 * @param {string} slot
 * @param {string} code  카탈로그 코드. 비면 아무것도 하지 않는다 (지우기는 plannerFinishClear).
 * @param {{moduleId?:string, section?:string, partKey?:string}} [ctx]
 * @returns {object|null} 적었으면 detail, 인자가 모자라면 null
 */
function plannerFinishSet(detail, level, slot, code, ctx) {
  const e = plannerFinishEntry(code);
  if (!detail || !e || PLANNER_FINISH_SLOTS.indexOf(slot) < 0) return null;
  const c = ctx || {};
  if (level === 'item') {
    detail.item = detail.item || {};
    detail.item[slot] = e;
    return detail;
  }
  if (level === 'section') {
    if (!c.section) return null;
    const g = plannerFinishSectionGroup(c.section);
    detail.sections = detail.sections || {};
    detail.sections[g] = detail.sections[g] || {};
    detail.sections[g][slot] = e;
    return detail;
  }
  if (level === 'module') {
    if (!c.moduleId) return null;
    detail.modules = detail.modules || {};
    detail.modules[c.moduleId] = detail.modules[c.moduleId] || {};
    detail.modules[c.moduleId][slot] = e;
    return detail;
  }
  if (level === 'part') {
    if (!c.moduleId || !c.partKey) return null;
    detail.parts = detail.parts || {};
    detail.parts[c.moduleId] = detail.parts[c.moduleId] || {};
    detail.parts[c.moduleId][c.partKey] = e;
    return detail;
  }
  return null;
}

/**
 * 한 단계의 지정을 지운다. 빈 사전이 남으면 그 키도 지워 저장본이 자라지 않게 한다.
 * @returns {boolean} 실제로 지운 것이 있으면 true
 */
function plannerFinishClear(detail, level, slot, ctx) {
  if (!detail) return false;
  const c = ctx || {};
  let map = null, key = slot, parent = null, parentKey = null;
  if (level === 'item') { map = detail.item; }
  else if (level === 'section' && c.section) {
    const g = plannerFinishSectionGroup(c.section);
    map = detail.sections && detail.sections[g];
  } else if (level === 'module' && c.moduleId) {
    parent = detail.modules; parentKey = c.moduleId;
    map = parent && parent[parentKey];
  } else if (level === 'part' && c.moduleId && c.partKey) {
    parent = detail.parts; parentKey = c.moduleId;
    map = parent && parent[parentKey];
    key = c.partKey;
  }
  if (!map || !(key in map)) return false;
  delete map[key];
  if (parent && parentKey && !Object.keys(map).length) delete parent[parentKey];
  return true;
}

// ────────────────────────────────────────────────────────────
// 3D 부재 ↔ 슬롯 · 부재 키
// ────────────────────────────────────────────────────────────

/**
 * userData.entityKind → 슬롯. **왜 그렇게 묶는지**를 적어 둔다:
 *
 *   door · doorEdge · blank → door     : 전면 판재. 먹장(blank)은 도어와 같은 마감의 막힌 판이다.
 *                                        doorEdge(테두리 막대)는 도어의 일부로 **골라지지만** 칠하지는
 *                                        않는다 — 그 어두운 띠가 도어 사이 갭이다 (PLANNER_FINISH_PAINT_SKIP).
 *   carcass · shelf · brace → body     : 몸통(측판·뒤판·지판·천판·칸막이)·선반·처짐방지목은 한 자재(PB/MDF).
 *                                        단, carcass 중 side='front' 는 도어/서랍 앞판이고 side='finish' 는
 *                                        마감재 한 장이라 plannerFinishSlotOf 가 userData 를 보고 다시 가른다.
 *   top-panel → top                    : 상판은 런 한 장. 몸통과 자재가 다르다 (인조대리석 등).
 *   handle → handle                    : 알루미늄 찬넬. 목찬넬 판(channelBase/Face)도 손잡이 자리라 같은 슬롯.
 *   finishing · blind · blindfin · molding → finishing
 *                                      : EP·몰딩·휠라·멍판·멍판 마감재 — 모두 "장 바깥을 마감하는 판".
 *                                        상몰딩(molding)도 마감재다.
 *   toe-kick · pedestal → kick         : 바닥 마감. 걸레받이(하부장)와 좌대(키큰·냉장고장)는 같은 자리.
 *   leg · area · module · pick · edge · reveal · carcass-line · marker → null
 *                                      : 다리발은 플라스틱 부속이고, 나머지는 표시용 선·그림자·상자다.
 *                                        marker 는 가전 자리 표시(분배기·후드 — PLANNER_MARKER_SECTIONS)의
 *                                        반투명 상자다. 장이 아니므로 부재도 아니다 (2026-09-15 결정).
 */
const PLANNER_FINISH_KIND_SLOT = {
  door: 'door', doorEdge: 'door', blank: 'door',
  carcass: 'body', shelf: 'body', brace: 'body',
  'top-panel': 'top',
  handle: 'handle',
  finishing: 'finishing', blind: 'finishing', blindfin: 'finishing', molding: 'finishing',
  'toe-kick': 'kick', pedestal: 'kick',
};

/** 슬롯은 있지만 색을 **칠하지 않는** 종류 — 갭·그림자·테두리·선택 상자. 칠하면 그 표시가 사라진다. */
const PLANNER_FINISH_PAINT_SKIP = ['edge', 'reveal', 'doorEdge', 'carcass-line', 'pick', 'area', 'module', 'leg', 'marker'];

/** entityKind 문자열만으로 슬롯을 정한다. 모르는 종류는 null. */
function plannerFinishSlotOfKind(kind) {
  return (kind && PLANNER_FINISH_KIND_SLOT[kind]) || null;
}

/**
 * userData 전체를 보고 슬롯을 정한다 — carcass 는 side/areaType 로 갈린다.
 *   side='front' + areaType 'drawer' → drawerFront, 'door' → door, 'open' → null (틀만 있는 칸)
 *   side='finish'                    → finishing (EP·몰딩·휠라 모듈의 판 한 장, buildFinishingMesh)
 *   side='channelBase'|'channelFace' → handle (목찬넬)
 *   그 밖의 side                      → body
 */
function plannerFinishSlotOf(ud) {
  if (!ud || !ud.entityKind) return null;
  if (ud.entityKind === 'carcass') {
    if (ud.side === 'front') {
      if (ud.areaType === 'drawer') return 'drawerFront';
      if (ud.areaType === 'open') return null;
      return 'door';
    }
    if (ud.side === 'finish') return 'finishing';
    if (ud.side === 'channelBase' || ud.side === 'channelFace') return 'handle';
    return 'body';
  }
  return plannerFinishSlotOfKind(ud.entityKind);
}

/** 칠할 슬롯 — 표시용 종류는 null. renderAll3D 뒤의 후처리(paintScene)가 쓴다. */
function plannerFinishPaintSlotOf(ud) {
  if (!ud || PLANNER_FINISH_PAINT_SKIP.indexOf(ud.entityKind) >= 0) return null;
  return plannerFinishSlotOf(ud);
}

/**
 * 부재 하나를 가리키는 **안정된 키**. 같은 모듈을 다시 그려도 같은 부재는 같은 키다.
 * 3D 가 userData 에 남긴 순번을 쓴다 (areaIdx·cellIdx·doorIdx·shelfIdx·finishingIdx …).
 *
 *   door#1        칸 1 의 도어          door#1-0 / door#1-1   양문의 왼쪽·오른쪽
 *   drawer#0      칸 0 의 서랍(상단)     drawer#b0            하단 서랍줄의 칸 0 (areaPos='bottom')
 *   blank#2       칸 2 의 먹장
 *   body:left     측판 (left/right/back/bottom/top)   body:divider#1   칸막이   body:batten-side  ㄱ자 목대
 *   channel:channelFace   목찬넬 전면판
 *   shelf#0-2     칸 0 의 세 번째 선반
 *   top · kick · pedestal · molding · handle · finish(마감재 모듈의 판)
 *   leg#3 · blind#0 · blindfin#0 · brace#1 · finishing#0(모듈에 붙은 마감재)
 *
 * 순번이 없는 종류(doorEdge 등)는 null — 부재로 지목할 수 없다.
 */
function plannerFinishPartKeyOf(ud) {
  if (!ud || !ud.entityKind) return null;
  const idx = (v) => (v == null ? '' : String(v));
  switch (ud.entityKind) {
    case 'carcass': {
      if (ud.side === 'front') {
        if (ud.areaType === 'open') return null;
        const type = ud.areaType === 'drawer' ? 'drawer' : 'door';
        const cell = ud.areaPos === 'bottom' ? 'b' + idx(ud.cellIdx) : idx(ud.areaIdx);
        if (cell === '' || cell === 'b') return null;
        return type + '#' + cell + (ud.doorIdx != null ? '-' + ud.doorIdx : '');
      }
      if (ud.side === 'finish') return 'finish';
      if (ud.side === 'divider') return 'body:divider#' + idx(ud.cellIdx);
      if (ud.side === 'batten') return 'body:batten-' + idx(ud.leg);
      if (ud.side === 'channelBase' || ud.side === 'channelFace') return 'channel:' + ud.side;
      return 'body:' + (ud.side || 'panel');
    }
    case 'shelf': return 'shelf#' + idx(ud.cellIdx) + '-' + idx(ud.shelfIdx);
    case 'top-panel': return 'top';
    case 'toe-kick': return 'kick';
    case 'pedestal': return 'pedestal';
    case 'molding': return 'molding';
    case 'handle': return 'handle';
    case 'leg': return 'leg#' + idx(ud.legIdx);
    case 'blind': return 'blind#' + idx(ud.areaIdx);
    case 'blindfin': return 'blindfin#' + idx(ud.areaIdx);
    case 'blank': return 'blank#' + idx(ud.areaIdx);
    // P2-6: 처짐방지목은 모듈 단위 부재라 braceIdx(0·1)로 센다. areaIdx 는 예전(양문 칸마다 한 장) userData 호환.
    case 'brace': return 'brace#' + idx(ud.braceIdx != null ? ud.braceIdx : ud.areaIdx);
    case 'finishing': return 'finishing#' + idx(ud.finishingIdx);
    default: return null;
  }
}

// ────────────────────────────────────────────────────────────
// 카탈로그 — 정본은 js/detaildesign/bom-finish-color.js (window.DadamBomFinishColor)
// ────────────────────────────────────────────────────────────

/**
 * 오프라인 폴백 — bom-finish-color.js 의 7 마감 × 7 색 **그대로**다.
 * 그 파일이 실리지 않은 화면(플래너 단독 접속 등)에서만 쓴다. 코드가 정본과
 * 같아야 하므로 planner-finish.test.js 가 buildFullMatrix() 와 대조한다.
 * 값을 더할 땐 정본에 먼저 더하고 여기에 복사한다 (I6: 더하기만).
 */
const PLANNER_FINISH_FALLBACK = {
  finishes: [
    { value: 'pet-matte',   code: 'PET', tone: 'matte',  label: 'PET 매트' },
    { value: 'pet-gloss',   code: 'PET', tone: 'gloss',  label: 'PET 광택' },
    { value: 'mfb',         code: 'MFB', tone: 'single', label: 'MFB 멜라민' },
    { value: 'lpm',         code: 'LPM', tone: 'single', label: 'LPM 라미네이트' },
    { value: 'paint-matte', code: 'PNT', tone: 'matte',  label: '도장 무광' },
    { value: 'paint-gloss', code: 'PNT', tone: 'gloss',  label: '도장 유광' },
    { value: 'veneer',      code: 'VNR', tone: 'single', label: '무늬목' },
  ],
  colors: [
    { value: 'cream',    code: 'CRM', label: '크림',       hex: '#f1ede3' },
    { value: 'oak',      code: 'OAK', label: '오크',       hex: '#d1b089' },
    { value: 'walnut',   code: 'WNT', label: '월넛',       hex: '#8b6447' },
    { value: 'graphite', code: 'GRP', label: '그라파이트', hex: '#696a6b' },
    { value: 'white',    code: 'WHT', label: '화이트',     hex: '#ffffff' },
    { value: 'black',    code: 'BLK', label: '블랙',       hex: '#1a1a1a' },
    { value: 'sage',     code: 'SAG', label: '세이지',     hex: '#b2bba5' },
  ],
  toneSuffix: { matte: 'M', gloss: 'G', single: '' },
};

/**
 * 팔레트가 쓰는 평평한 목록을 만든다.
 *
 * @param {object} [api] window.DadamBomFinishColor. 없으면 폴백을 쓰고 fallback:true 로 표시한다.
 * @returns {{entries: Array<{code,label,hex,finish,finishLabel,tone,color,colorLabel}>,
 *            finishes: Array<{value,label,code,tone}>, fallback: boolean}}
 */
function plannerFinishCatalog(api) {
  const ok = api && Array.isArray(api.DOOR_FINISH_CATALOG) && Array.isArray(api.DOOR_COLOR_CATALOG);
  const finishes = ok ? api.DOOR_FINISH_CATALOG : PLANNER_FINISH_FALLBACK.finishes;
  const colors = ok ? api.DOOR_COLOR_CATALOG : PLANNER_FINISH_FALLBACK.colors;
  const suffix = (ok && api.TONE_SUFFIX) || PLANNER_FINISH_FALLBACK.toneSuffix;
  // 코드 조합은 정본 함수가 있으면 그것을 쓴다 — 규칙이 바뀌어도 여기가 따라간다.
  const codeOf = (ok && typeof api.getFinishColorCode === 'function')
    ? (f, c) => api.getFinishColorCode(f.value, c.value)
    : (f, c) => { const s = suffix[f.tone] || ''; return s ? `${f.code}-${c.code}-${s}` : `${f.code}-${c.code}`; };
  const entries = [];
  finishes.forEach((f) => {
    colors.forEach((c) => {
      const code = codeOf(f, c);
      if (!code) return;
      entries.push({
        code,
        label: `${f.label} · ${c.label}`,
        hex: c.hex,
        finish: f.value, finishLabel: f.label, tone: f.tone,
        color: c.value, colorLabel: c.label,
      });
    });
  });
  return {
    entries,
    finishes: finishes.map((f) => ({ value: f.value, label: f.label, code: f.code, tone: f.tone })),
    // 색 목록도 실어 보낸다 — planner-catalog.js 가 호환 코드 {COLOR}-M/G 를 만드는 데 쓴다 (더하기만).
    colors: colors.map((c) => ({ value: c.value, code: c.code, label: c.label, hex: c.hex })),
    fallback: !ok,
  };
}

/** 코드 → 카탈로그 항목. 없으면 null. */
function plannerFinishLookup(catalog, code) {
  if (!catalog || !code) return null;
  const list = Array.isArray(catalog) ? catalog : catalog.entries;
  if (!Array.isArray(list)) return null;
  return list.find((e) => e.code === code) || null;
}

/** 코드 → hex. 모르는 코드면 null — 그 부재는 구조 단계 색 그대로 둔다. */
function plannerFinishHex(catalog, code) {
  const e = plannerFinishLookup(catalog, code);
  return e ? e.hex : null;
}

const PlannerFinish = {
  VERSION: PLANNER_FINISH_VERSION,
  SLOTS: PLANNER_FINISH_SLOTS,
  SLOT_LABEL: PLANNER_FINISH_SLOT_LABEL,
  LEVELS: PLANNER_FINISH_LEVELS,
  LEVEL_LABEL: PLANNER_FINISH_LEVEL_LABEL,
  SECTION_GROUPS: PLANNER_FINISH_SECTION_GROUPS,
  KIND_SLOT: PLANNER_FINISH_KIND_SLOT,
  PAINT_SKIP: PLANNER_FINISH_PAINT_SKIP,
  FALLBACK: PLANNER_FINISH_FALLBACK,
  sectionGroup: plannerFinishSectionGroup,
  empty: plannerFinishEmpty,
  normalize: plannerFinishNormalize,
  count: plannerFinishCount,
  resolve: plannerFinishResolve,
  set: plannerFinishSet,
  clear: plannerFinishClear,
  slotOfKind: plannerFinishSlotOfKind,
  slotOf: plannerFinishSlotOf,
  paintSlotOf: plannerFinishPaintSlotOf,
  partKeyOf: plannerFinishPartKeyOf,
  catalog: plannerFinishCatalog,
  lookup: plannerFinishLookup,
  hex: plannerFinishHex,
};

if (typeof window !== 'undefined') {
  window.PlannerFinish = PlannerFinish;
  window.PLANNER_FINISH_SLOTS = PLANNER_FINISH_SLOTS;
  window.PLANNER_FINISH_SLOT_LABEL = PLANNER_FINISH_SLOT_LABEL;
  window.PLANNER_FINISH_LEVEL_LABEL = PLANNER_FINISH_LEVEL_LABEL;
  // 범위 칠하기(planner-detail.js)가 섹션 두 묶음을 지울 때 쓴다 — 클래식 스크립트끼리는 window 로만 이어진다.
  window.PLANNER_FINISH_SECTION_GROUPS = PLANNER_FINISH_SECTION_GROUPS;
  window.plannerFinishSectionGroup = plannerFinishSectionGroup;
  window.plannerFinishEmpty = plannerFinishEmpty;
  window.plannerFinishNormalize = plannerFinishNormalize;
  window.plannerFinishCount = plannerFinishCount;
  window.plannerFinishResolve = plannerFinishResolve;
  window.plannerFinishSet = plannerFinishSet;
  window.plannerFinishClear = plannerFinishClear;
  window.plannerFinishSlotOfKind = plannerFinishSlotOfKind;
  window.plannerFinishSlotOf = plannerFinishSlotOf;
  window.plannerFinishPaintSlotOf = plannerFinishPaintSlotOf;
  window.plannerFinishPartKeyOf = plannerFinishPartKeyOf;
  window.plannerFinishCatalog = plannerFinishCatalog;
  window.plannerFinishLookup = plannerFinishLookup;
  window.plannerFinishHex = plannerFinishHex;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_FINISH_VERSION,
    PLANNER_FINISH_SLOTS,
    PLANNER_FINISH_SLOT_LABEL,
    PLANNER_FINISH_LEVELS,
    PLANNER_FINISH_LEVEL_LABEL,
    PLANNER_FINISH_SECTION_GROUPS,
    PLANNER_FINISH_KIND_SLOT,
    PLANNER_FINISH_PAINT_SKIP,
    PLANNER_FINISH_FALLBACK,
    plannerFinishSectionGroup,
    plannerFinishEmpty,
    plannerFinishNormalize,
    plannerFinishCount,
    plannerFinishResolve,
    plannerFinishSet,
    plannerFinishClear,
    plannerFinishSlotOfKind,
    plannerFinishSlotOf,
    plannerFinishPaintSlotOf,
    plannerFinishPartKeyOf,
    plannerFinishCatalog,
    plannerFinishLookup,
    plannerFinishHex,
    PlannerFinish,
  };
}
