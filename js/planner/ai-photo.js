// ============================================================
// R2: 사진으로 만들기 — ai-photo.js (구조 페이지 · 디테일 모드 전용)
//
// 방 사진 한 장을 올리고 버튼을 누르면, **지금 플래너에 그려 둔 도면 그대로**를
// 그 방에 설치한 사진을 만든다 (docs/01-plan/photo-composite.plan.md §5 R2).
//
// 사람이 맞추는 단계는 없다 — 사각형도, 화각도, 그림자·빛·톤 조절도 없다.
// 그것들은 #682 에서 일부러 지웠고 다시 만들지 않는다 (계획 §1 · §4.3).
// 이 파일에 있는 것은 셋뿐이다: **사진 올리기 · 도면 요약 만들기 · 생성 요청/폴링**.
//
// ── 도면 요약(design_spec) ────────────────────────────────
// 계약 정본은 **워커 문서**다: docs/02-design/features/design-spec-prompt.md.
// 필드 이름·자르는 범위·400 조건이 전부 거기 적혀 있고 이 파일은 그것을 따른다.
// 프롬프트 문장은 여기서 만들지 않는다 — 정본은 workers/generate-api/src/prompts.js
// 한 파일이다 (계획 §4.1-1). 우리는 **구조화 JSON 만** 보낸다.
//
//   보내는 것   : { category, wallRunMm, sections:{lower,upper,tall}, appliances[], finishes{door,body,top}, notes }
//   만드는 재료 : modules(구조 단계) · structures(getStructure) · 마감 모델(dadam_detail_v1) · 카탈로그(materials)
//   만드는 함수 : plannerAiPhotoBuildSpec(input) — **순수 함수**다. DOM·fetch·저장소를 모른다.
//
// buildPlannerPayload 는 건드리지 않는다 (계획 §4.2). 그 함수는 상세설계 브리지의
// 정본이고 골든 바이트 불변 시험이 지킨다 — 요약은 같은 모델에서 **따로** 만든다.
//
// ── 계약이 원하지만 플래너에 없는 것 ──────────────────────
//   · cooktop      플래너에 쿡탑 섹션이 없다 (가전 표시는 분배기·후드뿐). 보내지 않는다.
//   · 세로 축      계약의 modules[] 는 **좌→우 한 줄**이다. "위 도어 + 아래 서랍" 같은
//                  세로 구성은 표현할 자리가 없어, 그런 모듈은 칸으로 쪼개지 않고
//                  한 덩이로 보낸다 (kind=drawer · doorCount=위 도어 수 · drawerCount=서랍 단수).
//   · drawerFront  마감 슬롯이 door/body/top 셋뿐이다. 서랍 앞판 마감은 싣지 못한다.
//   · 회전         ㄱ자 배치의 90° 구간은 x 축에 눌러 펴서 보낸다 — AI 가 받는 벽은 하나다.
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_AI_PHOTO_ / plannerAiPhoto / PlannerAiPhoto 접두.
// 브라우저: window.PlannerAiPhoto (+ 개별 함수) / Jest: module.exports
// ============================================================

/** 업로드 전 축소 — 긴 변 px. ai-design.html 의 MAX_EDGE 와 같은 값이다(같은 워커가 받는다). */
const PLANNER_AI_PHOTO_MAX_EDGE = 1600;
/** 원본 파일 크기 한계 (ai-design.html 과 같다) */
const PLANNER_AI_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
/** 받는 형식 (ai-design.html 의 accept 와 같다) */
const PLANNER_AI_PHOTO_MIME_RE = /^image\/(jpeg|png)$/;
/**
 * 1회 비용. `credit_costs` 의 `generate` 행이 정본이고(database/credit-amounts.sql:23-25)
 * 연출컷과 같은 20 이다 (2026-09-17 결정 — 새 action 을 만들지 않는다).
 * 여기 숫자는 **누르기 전에 보여 주기 위한 표시용 사본**이다. 차감은 서버가 한다.
 */
const PLANNER_AI_PHOTO_CREDIT = 20;
/** 상태 폴링 간격 (ai-design.html POLL_MS 와 같다) */
const PLANNER_AI_PHOTO_POLL_MS = 3000;
/** 마지막 잡 id 를 담는 저장 키의 밑동. 스코프(scopedKey)가 붙는다. */
const PLANNER_AI_PHOTO_JOB_KEY = 'dadam_aiphoto_job_v1';

/**
 * 잡 단계 라벨 — **정본은 워커다** (workers/generate-api/src/job.js 의 `STEP`).
 * 브라우저가 워커 파일을 import 할 수 없어 옮겨 적었다 (layout.js 가 APPLIANCE_W 를
 * 옮겨 적은 것과 같은 규율, 계획 §2.4). 실제 표시는 서버가 준 `step_label` 이 먼저이고
 * 이 표는 그것이 비었을 때만 쓴다 — 두 벌이 갈라져도 화면은 서버를 따른다.
 */
const PLANNER_AI_PHOTO_STEP = {
  queued: { progress: 0, label: '대기 중' },
  analyzing: { progress: 10, label: '공간을 읽는 중' },
  rendering: { progress: 30, label: '기본안을 그리는 중' },
  qc: { progress: 60, label: '품질을 확인하는 중' },
  variants: { progress: 70, label: '추천안을 그리는 중' },
  done: { progress: 100, label: '완료' },
  failed: { progress: 100, label: '실패' },
};

/** 아직 도는 상태 — 이 동안 폴링한다 (worker.js ACTIVE_STATUSES 와 같은 목록). */
const PLANNER_AI_PHOTO_ACTIVE = ['queued', 'analyzing', 'rendering', 'qc', 'variants'];

/**
 * 플래너 섹션 → 계약의 구간 칸 (`sections.lower|upper|tall`).
 * 그 밖의 키는 계약이 무시하므로 보내지 않는다.
 *   키큰장·냉장고장·붙박이장은 바닥에서 천장까지 서므로 `tall` 이다.
 *   분배기·후드는 **장이 아니라 자리 표시**라 구간이 아니라 `appliances` 로 간다
 *   (PLANNER_MARKER_SECTIONS, planner-sections.js 의 2026-09-15 결정).
 */
const PLANNER_AI_PHOTO_BUCKET = {
  lower: 'lower',
  upper: 'upper',
  tall: 'tall',
  fridge: 'tall',
  wardrobe: 'tall',
  dishwasher: 'lower',
  refrigerator: 'tall',
};

/** 계약의 구간 순서 (sections 키). */
const PLANNER_AI_PHOTO_BUCKETS = ['lower', 'upper', 'tall'];

/**
 * 플래너 섹션 → 계약의 `appliances[].kind`.
 * 계약이 아는 것은 sink·hood·cooktop·fridge·dishwasher 다. 플래너에 **쿡탑은 없다**.
 *   sink(분배기) = 씽크볼이 앉는 자리 · hood = 후드 자리 · refrigerator = 냉장고 본체.
 */
const PLANNER_AI_PHOTO_APPLIANCE = {
  sink: 'sink',
  hood: 'hood',
  refrigerator: 'fridge',
  dishwasher: 'dishwasher',
};

/** 마감재 섹션 — 장이 아니라 장 바깥을 막는 판이다. 모듈 목록에 넣지 않는다 (폭은 런 계산에만 쓴다). */
const PLANNER_AI_PHOTO_FINISHING = ['ep', 'molding', 'filler', 'gap'];

/** 마감재 섹션 → 노트에 적을 한국어 이름 */
const PLANNER_AI_PHOTO_FINISHING_LABEL = { ep: 'EP', molding: '몰딩', filler: '휠라', gap: '비움' };

/** 계약 상한 (design-spec-prompt.md "배열이 너무 김") */
const PLANNER_AI_PHOTO_MAX_MODULES = 40;
const PLANNER_AI_PHOTO_MAX_APPLIANCES = 12;
const PLANNER_AI_PHOTO_MAX_NOTES = 300;

// ────────────────────────────────────────────────────────────
// 순수 — 숫자·자리
// ────────────────────────────────────────────────────────────

function plannerAiPhotoNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 소수점을 버린 mm. 계약의 숫자는 전부 mm 정수로 보낸다. */
function plannerAiPhotoMm(v) {
  return Math.round(plannerAiPhotoNum(v));
}

/**
 * 평면도에서 이 모듈이 차지하는 **좌우 범위**. 회전 90/270 이면 폭과 깊이를 맞바꾼다 —
 * mockup-structure 의 planeBoxOf 와 같은 규약이다(피벗 없는 판). 페이지는 영역 피벗까지
 * 반영한 modulePlaneBox 를 boxOf 로 넘겨 준다.
 */
function plannerAiPhotoBoxOf(m) {
  const rot = ((plannerAiPhotoNum(m && m.rotation) % 360) + 360) % 360;
  const W = plannerAiPhotoNum(m && m.W);
  const D = plannerAiPhotoNum(m && m.D);
  const swap = rot === 90 || rot === 270;
  const w = swap ? D : W;
  const cx = plannerAiPhotoNum(m && m.x) + W / 2;
  return { x: cx - w / 2, w };
}

function plannerAiPhotoIsFinishing(section) {
  return PLANNER_AI_PHOTO_FINISHING.indexOf(String(section)) >= 0;
}

// ────────────────────────────────────────────────────────────
// 순수 — 모듈 하나 → 계약 모듈 목록
// ────────────────────────────────────────────────────────────

/** 칸 타입 → 계약 kind. 모르는 값은 계약과 같게 door 로 떨어진다. */
function plannerAiPhotoKindOfCell(type) {
  if (type === 'drawer') return 'drawer';
  if (type === 'open') return 'open';
  return 'door';           // door · blank(먹장) · blind(멍장) · 그 밖
}

/** 칸 하나의 한국어 이름 — 계약의 `label` (프롬프트에 […] 로 붙는다). */
function plannerAiPhotoCellLabel(type, doors, drawers) {
  if (drawers > 0 && doors > 0) return `도어 ${doors} + 서랍 ${drawers}단`;
  if (drawers > 0) return `서랍 ${drawers}단`;
  if (type === 'open') return '오픈';
  if (type === 'blank') return '먹장';
  if (type === 'blind') return '멍장';
  return doors >= 2 ? '양문' : '도어';
}

/**
 * 붙박이장 통의 **바깥 서랍** 단수. 통 안 서랍(drawerZone)은 문 뒤라 사진에 보이지 않으므로 세지 않는다.
 * 기본 프리셋까지 풀어 주는 것은 페이지 쪽이다 — wardrobeFrontOf 로 wardrobeLayoutFor 결과를 받는다
 * (bom-wardrobe-rules.js `layoutWardrobeModule` → {drawers, external}).
 */
function plannerAiPhotoWardrobeDrawers(layout) {
  if (!layout || !layout.external) return 0;
  const n = plannerAiPhotoNum(layout.drawers);
  return n > 0 ? Math.min(12, Math.round(n)) : 0;
}

/**
 * 모듈 하나 → 계약 모듈 배열 (좌→우).
 *
 * 세로가 없는 모듈은 **칸마다 한 개**로 쪼갠다 — 그것이 사진에 보이는 전면 순서다.
 * 아래 단(하부 서랍줄·붙박이장 바깥 서랍)이 있으면 쪼개지 않고 **한 덩이**로 보낸다:
 * 계약의 modules[] 에는 세로 축이 없어서, 쪼개면 "서랍 3단이 칸마다" 로 읽힌다.
 *
 * @param {object} m 모듈 {id, section, W, ...}
 * @param {object} s getStructure(m.id) 결과
 * @param {object} [wardrobeLayout] wardrobeLayoutFor(m, s) 결과 (붙박이장만)
 * @returns {Array<{widthMm:number, kind:string, doorCount:number, drawerCount:number, label:string}>}
 */
function plannerAiPhotoModulesOf(m, s, wardrobeLayout) {
  const W = plannerAiPhotoNum(m && m.W);
  if (!s) return [{ widthMm: plannerAiPhotoMm(W), kind: 'door', doorCount: 1, label: '도어' }];

  const n = Math.max(1, Math.round(plannerAiPhotoNum(s.verticalCount)) || 1);
  const types = Array.isArray(s.areaTypes) ? s.areaTypes : [];
  const is2D = Array.isArray(s.areaIs2D) ? s.areaIs2D : [];
  const rawW = Array.isArray(s.areaWidths) ? s.areaWidths : [];
  const widths = rawW.length === n && rawW.every((v) => plannerAiPhotoNum(v) > 0)
    ? rawW.map(plannerAiPhotoNum)
    : null;

  const bottom = s.horizontalLayout === 'doorTopDrawerBottom' ? (s.bottomType || 'drawer') : null;
  const bottomDrawers = bottom === 'drawer' ? Math.max(1, Math.round(plannerAiPhotoNum(s.drawerCount)) || 1) : 0;
  const wardrobeDrawers = plannerAiPhotoWardrobeDrawers(wardrobeLayout);
  const stacked = bottom !== null || wardrobeDrawers > 0;

  // 위 칸들을 먼저 센다 — 쪼개든 합치든 같은 숫자를 쓴다.
  const cells = [];
  for (let i = 0; i < n; i++) {
    const t = types[i] || 'door';
    const kind = plannerAiPhotoKindOfCell(t);
    const doors = kind === 'door' ? (is2D[i] ? 2 : 1) : 0;
    cells.push({
      w: widths ? widths[i] : W / n,
      type: t,
      kind,
      doors,
      drawers: kind === 'drawer' ? 1 : 0,
    });
  }

  if (!stacked) {
    return cells.map((c) => ({
      widthMm: plannerAiPhotoMm(c.w),
      kind: c.kind,
      doorCount: c.doors,
      drawerCount: c.drawers,
      label: plannerAiPhotoCellLabel(c.type, c.doors, c.drawers),
    }));
  }

  // 세로가 있는 모듈 — 한 덩이. 서랍이 있으면 서랍이 주인공이다 (사진에서 제일 먼저 보인다).
  let doors = 0;
  let drawers = 0;
  cells.forEach((c) => { doors += c.doors; drawers += c.drawers; });
  if (bottom === 'drawer') drawers += bottomDrawers;
  else if (bottom === 'door' || bottom === 'blank') doors += 1;
  drawers += wardrobeDrawers;

  const kind = drawers > 0 ? 'drawer' : (doors > 0 ? 'door' : 'open');
  return [{
    widthMm: plannerAiPhotoMm(W),
    kind,
    doorCount: Math.min(12, doors),
    drawerCount: Math.min(12, drawers),
    label: plannerAiPhotoCellLabel(bottom === 'open' ? 'open' : 'door', doors, drawers),
  }];
}

// ────────────────────────────────────────────────────────────
// 순수 — 마감 (코드 → 계약의 finishes 한 칸)
// ────────────────────────────────────────────────────────────

/** 자재 종류 → 영어. `finish` 열(예 'Supreme PET Matt')에서 찾는다. 앞에서부터 처음 걸리는 것. */
const PLANNER_AI_PHOTO_MATERIAL_EN = [
  [/acryl/i, 'acrylic panel'],
  [/glass/i, 'glass panel'],
  [/\bpet\b/i, 'PET laminate'],
  [/\bpp\b/i, 'PP laminate'],
  [/mfb|mfc|melamin/i, 'melamine board'],
  [/\buv\b/i, 'UV-coated panel'],
  [/pvc/i, 'PVC foil panel'],
  [/veneer|무늬목/i, 'wood veneer'],
  [/lpm|laminat/i, 'laminate panel'],
  [/paint|도장/i, 'painted MDF'],
];

/** 구 7×7 코드(`PET-OAK-M`)의 마감 조각 → 영어. bom-finish-color.js 의 코드 규칙과 같다. */
const PLANNER_AI_PHOTO_CODE_MATERIAL = {
  PET: 'PET laminate',
  MFB: 'melamine board',
  LPM: 'laminate panel',
  PNT: 'painted MDF',
  VNR: 'wood veneer',
  TOP: 'engineered stone',
};

/** 구 7×7 코드의 색 조각 → 영어. */
const PLANNER_AI_PHOTO_CODE_COLOR = {
  CRM: 'cream', OAK: 'oak', WNT: 'walnut', GRP: 'graphite', WHT: 'white',
  BLK: 'black', SAG: 'sage', BGE: 'beige', GRY: 'grey', IVY: 'ivory',
  SNW: 'snow white', MOC: 'mocha',
};

/**
 * 한국어 색 이름 → 영어. **긴 것부터** 본다 ('라이트그레이' 가 '그레이' 보다 먼저).
 * Gemini 에게 `모시베이지` 는 색이 아니다 — 이 표가 그것을 색으로 바꾼다
 * (design-spec-prompt.md "영어 묘사를 꼭 채워 보낼 것").
 */
const PLANNER_AI_PHOTO_COLOR_EN = [
  ['아라베스카토', 'arabescato marble'],
  ['라임스톤', 'limestone'],
  ['콘크리트', 'concrete'],
  ['그라파이트', 'graphite'],
  ['캐시미어', 'cashmere'],
  ['체스넛', 'chestnut'],
  ['퓨어코튼', 'cotton white'],
  ['세라믹', 'ceramic'],
  ['메이플', 'maple'],
  ['월넛', 'walnut'],
  ['누아르', 'noir black'],
  ['아이보리', 'ivory'],
  ['인디고', 'indigo'],
  ['올리브', 'olive'],
  ['네이비', 'navy'],
  ['실버', 'silver'],
  ['코퍼', 'copper'],
  ['헤이즈', 'hazy'],
  ['베이지', 'beige'],
  ['화이트', 'white'],
  ['그레이', 'grey'],
  ['브라운', 'brown'],
  ['블랙', 'black'],
  ['블루', 'blue'],
  ['그린', 'green'],
  ['핑크', 'pink'],
  ['크림', 'cream'],
  ['모카', 'mocha'],
  ['샌드', 'sand'],
  ['스톤', 'stone'],
  ['엘름', 'elm'],
  ['오크', 'oak'],
  ['밤부', 'bamboo'],
  ['코튼', 'cotton'],
  ['민트', 'mint'],
  ['세이지', 'sage'],
  ['레드', 'red'],
];

/** 색 앞에 붙는 한국어 꾸밈말 → 영어. */
const PLANNER_AI_PHOTO_MOD_EN = [
  ['라이트', 'light'],
  ['다크', 'dark'],
  ['스모키', 'smoky'],
  ['미드나잇', 'midnight'],
  ['딥', 'deep'],
  ['웜', 'warm'],
  ['쿨', 'cool'],
  ['펄', 'pearlescent'],
  ['연', 'light'],
];

/** '#rrggbb' → {h,s,l} (0~1). 색 이름을 못 찾았을 때의 마지막 근거. */
function plannerAiPhotoHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex == null ? '' : hex).trim());
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

/** hex 만으로 짜낸 영어 색 이름. 이름표에 없는 색(HW1077 같은 코드명)도 색으로 말하게 한다. */
function plannerAiPhotoColorFromHex(hex) {
  const c = plannerAiPhotoHsl(hex);
  if (!c) return null;
  if (c.s < 0.1) {
    if (c.l > 0.88) return 'white';
    if (c.l > 0.65) return 'light grey';
    if (c.l > 0.38) return 'grey';
    if (c.l > 0.15) return 'dark grey';
    return 'near-black';
  }
  const deg = c.h * 360;
  let name;
  if (deg < 15 || deg >= 345) name = 'red';
  else if (deg < 45) name = c.l < 0.5 ? 'brown' : 'warm beige';
  else if (deg < 70) name = 'yellow';
  else if (deg < 160) name = 'green';
  else if (deg < 200) name = 'teal';
  else if (deg < 255) name = 'blue';
  else if (deg < 290) name = 'purple';
  else name = 'pink';
  if (c.l > 0.78) return 'light ' + name;
  if (c.l < 0.3) return 'deep ' + name;
  return name;
}

/** 카탈로그 tone → 계약 tone. 'single' 은 계약에 없다 — 나뭇결이면 woodgrain, 아니면 싣지 않는다. */
function plannerAiPhotoTone(entry) {
  const t = entry && entry.tone;
  if (t === 'matte' || t === 'gloss') return t;
  if (entry && (entry.grain === 'h' || entry.grain === 'v')) return 'woodgrain';
  return null;
}

/** 자재 종류 영어 — finish 열 → 코드 앞조각 → 기본값. */
function plannerAiPhotoMaterialEn(entry, code) {
  const text = [entry && entry.finish, entry && entry.finishLabel, entry && entry.label]
    .filter(Boolean).join(' ');
  for (let i = 0; i < PLANNER_AI_PHOTO_MATERIAL_EN.length; i++) {
    if (PLANNER_AI_PHOTO_MATERIAL_EN[i][0].test(text)) return PLANNER_AI_PHOTO_MATERIAL_EN[i][1];
  }
  const head = String(code || '').split('-')[0].toUpperCase();
  return PLANNER_AI_PHOTO_CODE_MATERIAL[head] || 'laminate panel';
}

/** 색 영어 — 한국어 이름표 → 코드 가운데 조각 → hex. 셋 다 실패하면 null. */
function plannerAiPhotoColorEn(entry, code) {
  const ko = String((entry && (entry.colorLabel || entry.color)) || '');
  let mod = '';
  for (let i = 0; i < PLANNER_AI_PHOTO_MOD_EN.length; i++) {
    if (ko.indexOf(PLANNER_AI_PHOTO_MOD_EN[i][0]) >= 0) { mod = PLANNER_AI_PHOTO_MOD_EN[i][1]; break; }
  }
  for (let i = 0; i < PLANNER_AI_PHOTO_COLOR_EN.length; i++) {
    if (ko.indexOf(PLANNER_AI_PHOTO_COLOR_EN[i][0]) >= 0) {
      return (mod ? mod + ' ' : '') + PLANNER_AI_PHOTO_COLOR_EN[i][1];
    }
  }
  const mid = String(code || '').split('-')[1];
  if (mid && PLANNER_AI_PHOTO_CODE_COLOR[String(mid).toUpperCase()]) {
    return (mod ? mod + ' ' : '') + PLANNER_AI_PHOTO_CODE_COLOR[String(mid).toUpperCase()];
  }
  return plannerAiPhotoColorFromHex(entry && entry.hex);
}

function plannerAiPhotoCut(s, n) {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) : t;
}

/**
 * 마감 코드 하나 → 계약의 `finishes.*` 한 칸.
 *
 * **`nameEn` 은 언제나 채운다.** 카탈로그에 없는 코드여도 코드 조각과 hex 로 짜내고,
 * 그것마저 없으면 중립 문장으로 떨어진다 — 비어 보내면 워커가 그 칸을 통째로 버려
 * 옛 door_color 로 돌아가기 때문이다 (design-spec-prompt.md `finishes` 절).
 *
 * @param {string} code 카탈로그 코드 (PET-OAK-M · YR-YPA-01 …)
 * @param {object} [catalog] PlannerCatalog.current — byCode 를 본다
 * @returns {{name?:string, nameEn:string, colorHex?:string, tone?:string, vendorCode?:string}|null}
 */
function plannerAiPhotoFinishOf(code, catalog) {
  const c = String(code == null ? '' : code).trim();
  if (!c) return null;
  const entry = (catalog && catalog.byCode && catalog.byCode[c]) || null;

  const material = plannerAiPhotoMaterialEn(entry, c);
  const color = plannerAiPhotoColorEn(entry, c);
  const tone = plannerAiPhotoTone(entry);
  const toneWord = tone === 'gloss' ? 'high-gloss' : tone === 'matte' ? 'matte' : '';
  const nameEn = plannerAiPhotoCut(
    [toneWord, color, material].filter(Boolean).join(' ') || 'neutral matte laminate', 60);

  const out = { nameEn };
  const koName = entry
    ? ((entry.vendor === 'yerim' ? '예림 LUX ' : '') + (entry.label || c))
    : c;
  const name = plannerAiPhotoCut(koName, 60);
  if (name) out.name = name;
  if (entry && entry.hex) out.colorHex = entry.hex;
  if (tone) out.tone = tone;
  const vendorCode = plannerAiPhotoCut(entry && entry.vendorCode, 24);
  if (vendorCode) out.vendorCode = vendorCode;
  return out;
}

// ────────────────────────────────────────────────────────────
// 순수 — 품목 판정
// ────────────────────────────────────────────────────────────

/**
 * 도면이 어떤 품목인가. 플래너 URL 에는 품목 종류가 없어(스코프는 design·item 번호뿐)
 * **섹션으로 판정한다.** 워커 CATEGORIES 의 키로만 답한다 (prompts.js `resolveCategory`).
 */
function plannerAiPhotoCategoryOf(modules) {
  const list = Array.isArray(modules) ? modules : [];
  const has = (sec) => list.some((m) => m && m.section === sec);
  if (has('wardrobe')) return 'wardrobe';
  if (has('fridge')) return 'fridge';
  if (has('lower') || has('upper') || has('sink') || has('hood') || has('dishwasher')) return 'sink';
  if (has('tall')) return 'storage';
  return 'storage';
}

/** 화면에 보여 줄 품목 이름. */
const PLANNER_AI_PHOTO_CATEGORY_LABEL = {
  sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장', storage: '수납장',
};

// ────────────────────────────────────────────────────────────
// 순수 — 도면 요약 만들기
// ────────────────────────────────────────────────────────────

/**
 * 플래너 상태 → `design_spec` (docs/02-design/features/design-spec-prompt.md).
 *
 * **순수 함수다.** DOM·저장소·fetch 를 모른다 — 시험이 그대로 부른다.
 *
 * @param {object} input
 * @param {Array}  input.modules       구조 단계 modules (마감재 포함 — 폭 계산에 쓴다)
 * @param {(id:string)=>object} input.structureOf  getStructure
 * @param {(m:object)=>{x:number,w:number}} [input.boxOf]  평면 좌우 범위. 기본은 회전만 반영
 * @param {(m:object,s:object)=>object} [input.wardrobeFrontOf] wardrobeLayoutFor — 바깥 서랍 단수
 * @param {object} [input.detail]      마감 모델 (plannerFinishNormalize 를 거친 것)
 * @param {object} [input.catalog]     PlannerCatalog.current
 * @param {string} [input.category]    강제 지정. 없으면 섹션으로 판정한다
 * @returns {{category:string, wallRunMm:number, sections:object, appliances:Array, finishes:object, notes?:string}|null}
 *   보낼 내용이 하나도 없으면 null (계약은 빈 객체를 400 으로 돌려준다)
 */
function plannerAiPhotoBuildSpec(input) {
  const o = input || {};
  const all = (Array.isArray(o.modules) ? o.modules : []).filter(Boolean);
  if (!all.length) return null;
  const structureOf = typeof o.structureOf === 'function' ? o.structureOf : () => null;
  const boxOf = typeof o.boxOf === 'function' ? o.boxOf : plannerAiPhotoBoxOf;
  const wardrobeFrontOf = typeof o.wardrobeFrontOf === 'function' ? o.wardrobeFrontOf : () => null;

  // 런의 왼쪽 끝 — 마감재·가전 표시까지 **전부** 센다. 계약의 fromLeftMm 가 여기서부터 잰 값이다.
  const boxes = all.map((m) => ({ m, b: boxOf(m) }));
  const left = Math.min.apply(null, boxes.map((x) => x.b.x));
  const right = Math.max.apply(null, boxes.map((x) => x.b.x + x.b.w));

  const sections = {};
  const appliances = [];
  const notes = [];
  let rotated = false;

  // 구간 — 섹션 칸마다 폭·높이·깊이·왼쪽 끝을 모으고, 그 안의 모듈을 좌→우로 늘어놓는다.
  const bySlot = {};
  boxes.forEach((x) => {
    const m = x.m;
    if (((plannerAiPhotoNum(m.rotation) % 360) + 360) % 360) rotated = true;
    if (plannerAiPhotoIsFinishing(m.section)) return;                  // 판 한 장 — 모듈이 아니다
    const kind = PLANNER_AI_PHOTO_APPLIANCE[m.section];
    if (kind) {
      appliances.push({
        kind,
        fromLeftMm: plannerAiPhotoMm(x.b.x - left),
        widthMm: plannerAiPhotoMm(x.b.w),
        _x: x.b.x,
      });
    }
    const slot = PLANNER_AI_PHOTO_BUCKET[m.section];
    if (!slot) return;                                                  // 분배기·후드는 자리 표시뿐
    (bySlot[slot] || (bySlot[slot] = [])).push(x);
  });

  PLANNER_AI_PHOTO_BUCKETS.forEach((slot) => {
    const list = (bySlot[slot] || []).slice().sort((a, b) => a.b.x - b.b.x);
    if (!list.length) return;
    const x0 = Math.min.apply(null, list.map((x) => x.b.x));
    const x1 = Math.max.apply(null, list.map((x) => x.b.x + x.b.w));
    let mods = [];
    list.forEach((x) => {
      const m = x.m;
      const s = structureOf(m.id);
      if (PLANNER_AI_PHOTO_APPLIANCE[m.section]) {
        // 가전 본체(냉장고·식기세척기)는 장이 아니라 **구멍**이다.
        mods.push({
          widthMm: plannerAiPhotoMm(x.b.w),
          kind: 'appliance',
          doorCount: 0,
          drawerCount: 0,
          label: (m.section === 'refrigerator') ? '냉장고' : '식기세척기',
        });
        return;
      }
      mods = mods.concat(plannerAiPhotoModulesOf(m, s, wardrobeFrontOf(m, s)));
    });
    sections[slot] = {
      widthMm: plannerAiPhotoMm(x1 - x0),
      heightMm: plannerAiPhotoMm(Math.max.apply(null, list.map((x) => plannerAiPhotoNum(x.m.H)))),
      depthMm: plannerAiPhotoMm(Math.max.apply(null, list.map((x) => plannerAiPhotoNum(x.m.D)))),
      fromLeftMm: plannerAiPhotoMm(x0 - left),
      modules: mods.slice(0, PLANNER_AI_PHOTO_MAX_MODULES),
    };
  });

  appliances.sort((a, b) => a._x - b._x);
  const apps = appliances.slice(0, PLANNER_AI_PHOTO_MAX_APPLIANCES)
    .map((a) => ({ kind: a.kind, fromLeftMm: a.fromLeftMm, widthMm: a.widthMm }));

  // 마감 — 도어·몸통·상판. 모듈마다 해석해(부재>모듈>섹션>품목) 가장 많이 나온 코드를 대표로 삼는다.
  const finishes = {};
  const detail = o.detail || null;
  const resolve = (typeof plannerFinishResolve === 'function')
    ? plannerFinishResolve
    : (typeof window !== 'undefined' && window.plannerFinishResolve) || null;
  if (detail && resolve) {
    const real = all.filter((m) => !plannerAiPhotoIsFinishing(m.section) && PLANNER_AI_PHOTO_BUCKET[m.section]);
    ['door', 'body', 'top'].forEach((slot) => {
      const tally = [];
      const bump = (code) => {
        if (!code) return;
        const hit = tally.find((t) => t.code === code);
        if (hit) hit.n++;
        else tally.push({ code, n: 1 });
      };
      if (real.length) real.forEach((m) => { const r = resolve(detail, slot, m.id, m.section); bump(r && r.code); });
      else { const r = resolve(detail, slot); bump(r && r.code); }
      if (!tally.length) return;
      tally.sort((a, b) => b.n - a.n);
      const fin = plannerAiPhotoFinishOf(tally[0].code, o.catalog);
      if (fin) finishes[slot] = fin;
    });
  }

  // 노트 — 프롬프트가 달리 알 수 없는 것만. 손잡이(매립형)는 워커가 이미 못박는다.
  const fins = all.filter((m) => plannerAiPhotoIsFinishing(m.section));
  if (fins.length) {
    const names = [];
    fins.forEach((m) => {
      const label = PLANNER_AI_PHOTO_FINISHING_LABEL[m.section] || m.section;
      if (names.indexOf(label) < 0) names.push(label);
    });
    notes.push(`양 끝 마감재: ${names.join('·')} ${fins.length}장`);
  }
  if (rotated) notes.push('ㄱ자 배치라 꺾인 구간을 한 벽으로 폈습니다');

  const spec = {
    category: o.category || plannerAiPhotoCategoryOf(all),
    wallRunMm: plannerAiPhotoMm(right - left),
    sections,
    appliances: apps,
    finishes,
  };
  if (notes.length) spec.notes = plannerAiPhotoCut(notes.join(' · '), PLANNER_AI_PHOTO_MAX_NOTES);
  // 계약: wallRunMm·sections·appliances·finishes 중 적어도 하나는 내용이 있어야 한다.
  if (!spec.wallRunMm && !Object.keys(sections).length && !apps.length && !Object.keys(finishes).length) {
    return null;
  }
  return spec;
}

/** 화면 한 줄 요약 — "붙박이장 · 3600mm · 모듈 5 · 가전 1". */
function plannerAiPhotoSpecSummary(spec) {
  if (!spec) return '도면이 비어 있습니다';
  let n = 0;
  PLANNER_AI_PHOTO_BUCKETS.forEach((k) => {
    if (spec.sections && spec.sections[k]) n += (spec.sections[k].modules || []).length;
  });
  const label = PLANNER_AI_PHOTO_CATEGORY_LABEL[spec.category] || spec.category;
  const parts = [label, `${spec.wallRunMm}mm`, `모듈 ${n}`];
  if (spec.appliances && spec.appliances.length) parts.push(`가전 ${spec.appliances.length}`);
  return parts.join(' · ');
}

// ────────────────────────────────────────────────────────────
// 순수 — 사진 준비
// ────────────────────────────────────────────────────────────

/** 긴 변을 maxEdge 로 맞춘 정수 크기. 원본이 더 작으면 그대로 둔다 (늘리지 않는다). */
function plannerAiPhotoFitSize(w, h, maxEdge) {
  const W = Math.max(1, Math.round(plannerAiPhotoNum(w)));
  const H = Math.max(1, Math.round(plannerAiPhotoNum(h)));
  const L = Math.max(1, Math.round(plannerAiPhotoNum(maxEdge) || PLANNER_AI_PHOTO_MAX_EDGE));
  const scale = Math.min(1, L / Math.max(W, H));
  return { width: Math.max(1, Math.round(W * scale)), height: Math.max(1, Math.round(H * scale)), scale };
}

/** 받을 수 있는 파일인가. 안 되면 **한국어 이유**, 되면 null. */
function plannerAiPhotoFileError(file) {
  if (!file) return '사진을 먼저 올려 주세요';
  if (!PLANNER_AI_PHOTO_MIME_RE.test(String(file.type || ''))) return 'JPG · PNG 만 올릴 수 있습니다';
  if (plannerAiPhotoNum(file.size) > PLANNER_AI_PHOTO_MAX_BYTES) return '20MB 이하만 올릴 수 있습니다';
  return null;
}

/**
 * 파일 → 축소한 base64 JPEG.
 *
 * ai-design.html 의 `readImage`(:480-512) 와 **같은 규칙**이다 — 긴 변 1600px, JPEG 0.9.
 * 같은 워커가 받으므로 규칙이 갈라지면 한쪽만 큰 본문을 보내게 된다. 그 페이지에서
 * 가져오지 않고 여기에 다시 적은 이유: ai-design.html 은 이 도메인이 손대지 않는 파일이다.
 */
function plannerAiPhotoReadImage(file, opt) {
  const o = opt || {};
  return new Promise((resolve, reject) => {
    const bad = plannerAiPhotoFileError(file);
    if (bad) return reject(new Error(bad));
    const Reader = o.FileReader || (typeof FileReader !== 'undefined' ? FileReader : null);
    if (!Reader) return reject(new Error('이 화면에서는 사진을 읽을 수 없습니다'));
    const fr = new Reader();
    fr.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    fr.onload = () => {
      const img = o.Image ? new o.Image() : new Image();
      img.onerror = () => reject(new Error('이미지를 열지 못했습니다'));
      img.onload = () => {
        try {
          const size = plannerAiPhotoFitSize(img.naturalWidth || img.width, img.naturalHeight || img.height,
            o.maxEdge || PLANNER_AI_PHOTO_MAX_EDGE);
          const cv = (o.canvas || document.createElement('canvas'));
          cv.width = size.width;
          cv.height = size.height;
          cv.getContext('2d').drawImage(img, 0, 0, size.width, size.height);
          const url = cv.toDataURL('image/jpeg', 0.9);
          resolve({
            base64: String(url).split(',')[1] || '',
            mime: 'image/jpeg',
            preview: url,
            name: file.name || 'room.jpg',
            width: size.width,
            height: size.height,
          });
        } catch (e) {
          reject(new Error('사진을 줄이지 못했습니다'));
        }
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

// ────────────────────────────────────────────────────────────
// 순수 — 오류 문구
// ────────────────────────────────────────────────────────────

/**
 * HTTP 상태·본문 → 사용자에게 보일 한국어 한 줄.
 * 문서에 적힌 실패만 따로 말한다 (design-spec-prompt.md "검증", worker.js createGeneration).
 */
function plannerAiPhotoErrorMessage(status, data) {
  const code = (data && data.code) || '';
  const server = (data && data.error) || '';
  if (status === 401 || code === 'auth') return '로그인이 풀렸습니다 — 다시 로그인한 뒤 눌러 주세요';
  if (status === 402 || code === 'insufficient_credit') {
    return `크레딧이 부족합니다 (1회 ${PLANNER_AI_PHOTO_CREDIT} 크레딧) — 구독을 올리면 더 만들 수 있습니다`;
  }
  if (status === 409) return '이미 생성 중인 작업이 있습니다 — 끝난 뒤 다시 눌러 주세요';
  if (code === 'bad_design_spec') {
    return '도면 요약을 서버가 받지 못했습니다 — 크레딧은 차감되지 않았습니다' + (server ? ` (${server})` : '');
  }
  if (status === 404) return '생성 결과를 찾을 수 없습니다';
  if (status === 400) return '요청이 올바르지 않습니다' + (server ? ` — ${server}` : '');
  if (status >= 500) return '생성 서버가 응답하지 않습니다 — 잠시 뒤 다시 시도해 주세요';
  return server || '생성에 실패했습니다 — 다시 시도해 주세요';
}

/** 스코프가 없을 때의 이유 (PlannerStore.ready 의 reason) → 한국어. */
function plannerAiPhotoScopeMessage(reason) {
  if (reason === 'no-scope') return '설계를 먼저 저장하면 사진으로 만들 수 있습니다';
  if (reason === 'no-item') return '품목을 먼저 추가하세요';
  if (reason === 'no-session') return '로그인하면 사진으로 만들 수 있습니다';
  if (reason === 'no-sdk') return '이 화면에서는 사진 생성을 쓸 수 없습니다';
  return '지금은 사진으로 만들 수 없습니다';
}

/** 진행 라벨 — 서버가 준 step_label 이 먼저, 없으면 옮겨 적은 표. */
function plannerAiPhotoStepLabel(gen) {
  const g = gen || {};
  const fromServer = g.step_label && String(g.step_label).trim();
  const step = PLANNER_AI_PHOTO_STEP[g.status] || null;
  const label = fromServer || (step && step.label) || '생성 중';
  const pct = g.progress != null ? plannerAiPhotoMm(g.progress) : (step ? step.progress : 0);
  return `${label} · ${pct}%`;
}

function plannerAiPhotoIsActive(status) {
  return PLANNER_AI_PHOTO_ACTIVE.indexOf(String(status)) >= 0;
}

// ────────────────────────────────────────────────────────────
// 화면
// ────────────────────────────────────────────────────────────

const PLANNER_AI_PHOTO_CSS = `
.ap-wrap{display:flex;flex-direction:column;gap:7px;font-size:11px;color:var(--text,#2b2620)}
.ap-cost{display:flex;align-items:baseline;justify-content:space-between;gap:6px;padding:5px 8px;border:1px solid var(--brand-mid,#c8ab86);border-radius:6px;background:var(--brand-soft,#f6efe4)}
.ap-cost b{color:var(--brand-deep,#6a4b2a)}
.ap-cost .ap-sum{font-size:10px;color:var(--text-dim,#7a7062);text-align:right;line-height:1.4}
.ap-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:74px;border:1px dashed var(--brand-mid,#c8ab86);border-radius:6px;background:#fff;cursor:pointer;padding:6px;text-align:center}
.ap-drop:hover,.ap-drop.ap-over{border-color:var(--brand-deep,#6a4b2a);background:var(--brand-soft,#f6efe4)}
.ap-drop .ap-drop-text{font-size:10.5px;color:var(--text-dim,#7a7062);line-height:1.5}
.ap-drop img{display:block;max-width:100%;max-height:120px;border-radius:5px}
.ap-drop .ap-file{font-size:9.5px;color:var(--text-faint,#a89c84);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.ap-go{border:1px solid var(--brand-deep,#6a4b2a);background:var(--brand-deep,#6a4b2a);color:#fff;border-radius:6px;padding:7px 10px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit}
.ap-go:disabled{opacity:.45;cursor:not-allowed}
.ap-again{border:1px solid var(--line,#e5e0d4);background:#fff;color:var(--text,#2b2620);border-radius:999px;padding:3px 10px;font-size:10.5px;cursor:pointer;font-family:inherit}
.ap-msg{font-size:10px;line-height:1.5;color:var(--text-dim,#7a7062)}
.ap-msg.ap-bad{color:#a3402a}
.ap-bar{height:4px;border-radius:999px;background:var(--line,#e5e0d4);overflow:hidden}
.ap-bar i{display:block;height:100%;background:var(--brand-deep,#6a4b2a);transition:width .3s}
.ap-thumbs{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.ap-thumb{display:flex;flex-direction:column;gap:2px;border:1px solid var(--line,#e5e0d4);border-radius:6px;background:#fff;padding:3px;text-decoration:none;color:var(--text,#2b2620);min-width:0}
.ap-thumb img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;border-radius:4px;background:#f4efe7}
.ap-thumb .ap-cap{font-size:9.5px;color:var(--text-dim,#7a7062);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
a.ap-thumb:hover{border-color:var(--brand-mid,#b8956c)}
.ap-note{font-size:9.5px;color:var(--text-faint,#a89c84);line-height:1.5}
`;

function plannerAiPhotoInjectCss() {
  if (typeof document === 'undefined' || document.getElementById('planner-ai-photo-css')) return;
  const st = document.createElement('style');
  st.id = 'planner-ai-photo-css';
  st.textContent = PLANNER_AI_PHOTO_CSS;
  document.head.appendChild(st);
}

function plannerAiPhotoEsc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 「사진으로 만들기」 — 디테일 모드 우측 섹션(#aiPhotoBody).
 *
 * 페이지가 넘기는 것 (PlannerAiPhoto.mount(o)):
 *   modules()        구조 단계 modules
 *   structureOf(id)  getStructure
 *   boxOf(m)         modulePlaneBox — 회전·영역 피벗까지 반영한 평면 좌우 범위
 *   wardrobeFrontOf(m, s)  wardrobeLayoutFor — 붙박이장 바깥 서랍 단수
 *   detail()         마감 모델. 기본 PlannerDetail.detail
 *   toast(text)      알림
 *   ids()            스코프. 기본 plannerScopeIds()
 */
const PlannerAiPhoto = {
  CREDIT: PLANNER_AI_PHOTO_CREDIT,
  MAX_EDGE: PLANNER_AI_PHOTO_MAX_EDGE,
  POLL_MS: PLANNER_AI_PHOTO_POLL_MS,
  buildSpec: plannerAiPhotoBuildSpec,
  readImage: plannerAiPhotoReadImage,
  errorMessage: plannerAiPhotoErrorMessage,

  _o: null,
  /** 'idle' | 'sending' | 'running' | 'done' */
  phase: 'idle',
  img: null,
  gen: null,
  genId: null,
  message: '',
  bad: false,
  _seq: 0,
  /** 시험이 갈아 끼운다. 기본은 전역 fetch. */
  _fetch: null,

  mount(o) {
    this._o = o || {};
    return this;
  },

  toast(t) {
    if (this._o && typeof this._o.toast === 'function') { try { this._o.toast(t); } catch (e) { /* 무해 */ } }
  },

  ids() {
    if (this._o && typeof this._o.ids === 'function') { try { return this._o.ids(); } catch (e) { /* 아래로 */ } }
    return (typeof plannerScopeIds === 'function') ? plannerScopeIds() : { designId: null, itemId: null };
  },

  modules() {
    if (this._o && typeof this._o.modules === 'function') { try { return this._o.modules() || []; } catch (e) { /* 무해 */ } }
    return [];
  },

  detail() {
    if (this._o && typeof this._o.detail === 'function') { try { return this._o.detail(); } catch (e) { /* 무해 */ } }
    return (typeof PlannerDetail !== 'undefined' && PlannerDetail) ? PlannerDetail.detail : null;
  },

  catalog() {
    if (this._o && this._o.catalog) return this._o.catalog;
    return (typeof PlannerCatalog !== 'undefined' && PlannerCatalog) ? PlannerCatalog.current : null;
  },

  /** 지금 도면의 요약. 못 만들면 null. */
  spec() {
    return plannerAiPhotoBuildSpec({
      modules: this.modules(),
      structureOf: (id) => {
        const o = this._o || {};
        return typeof o.structureOf === 'function' ? o.structureOf(id) : null;
      },
      boxOf: (this._o && this._o.boxOf) || undefined,
      wardrobeFrontOf: (this._o && this._o.wardrobeFrontOf) || undefined,
      detail: this.detail(),
      catalog: this.catalog(),
    });
  },

  // ── 잡 id 기억 ────────────────────────────────────────────
  _key() {
    return (typeof scopedKey === 'function') ? scopedKey(PLANNER_AI_PHOTO_JOB_KEY) : PLANNER_AI_PHOTO_JOB_KEY;
  },
  rememberJob(id) {
    try {
      if (id) localStorage.setItem(this._key(), JSON.stringify({ id, at: new Date().toISOString() }));
      else localStorage.removeItem(this._key());
    } catch (e) { /* 저장 못 해도 이번 판은 돈다 */ }
  },
  lastJob() {
    try {
      const raw = localStorage.getItem(this._key());
      const v = raw ? JSON.parse(raw) : null;
      return (v && typeof v.id === 'string' && v.id) ? v.id : null;
    } catch (e) { return null; }
  },

  // ── 배관 ─────────────────────────────────────────────────
  api() {
    const cfg = (typeof window !== 'undefined' && window.DADAM_CONFIG) || null;
    return (cfg && cfg.generateApi && cfg.generateApi.url)
      || 'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate';
  },
  apiBase() {
    return this.api().replace(/\/api\/generate\/?$/, '');
  },
  fetch() {
    if (this._fetch) return this._fetch;
    return (typeof fetch === 'function') ? fetch.bind(null) : null;
  },

  /** 로그인 토큰. PlannerStore 와 같은 클라이언트를 본다 (부모 세션 그대로). */
  async token() {
    if (this._o && typeof this._o.token === 'function') return await this._o.token();
    if (typeof PlannerStore === 'undefined' || !PlannerStore) return null;
    try {
      const c = PlannerStore.client();
      if (!c) return null;
      const { data } = await c.auth.getSession();
      return (data && data.session && data.session.access_token) || null;
    } catch (e) { return null; }
  },

  /** 쓸 수 있는 상태인가 — 설계 저장·로그인. 이유는 한국어로 돌려준다. */
  async ready() {
    if (typeof PlannerStore === 'undefined' || !PlannerStore) return { ok: false, reason: 'no-sdk' };
    return await PlannerStore.ready(this._o && this._o.ids ? this.ids() : undefined);
  },

  // ── 화면 ─────────────────────────────────────────────────
  host() {
    return (typeof document !== 'undefined') ? document.getElementById('aiPhotoBody') : null;
  },

  /** 디테일 모드에 들어올 때 PlannerDetail.enter 가 부른다. */
  onDetailEnter() {
    plannerAiPhotoInjectCss();
    this.render();
    return this.reattach();
  },

  render() {
    const host = this.host();
    if (!host) return false;
    plannerAiPhotoInjectCss();
    const spec = this.spec();
    const busy = this.phase === 'sending' || this.phase === 'running';
    const esc = plannerAiPhotoEsc;
    const parts = ['<div class="ap-wrap">'];

    // 크레딧은 **누르기 전에** 보인다.
    parts.push(
      `<div class="ap-cost"><span><b>${PLANNER_AI_PHOTO_CREDIT} 크레딧</b> / 1장</span>`
      + `<span class="ap-sum">${esc(plannerAiPhotoSpecSummary(spec))}</span></div>`
    );

    // 사진
    if (this.img) {
      parts.push(
        `<div class="ap-drop" id="aiPhotoDrop" title="다른 사진으로 바꾸기">`
        + `<img src="${esc(this.img.preview)}" alt="방 사진">`
        + `<span class="ap-file">${esc(this.img.name)} · ${this.img.width}×${this.img.height}</span></div>`
      );
    } else {
      parts.push(
        '<div class="ap-drop" id="aiPhotoDrop">'
        + '<span class="ap-drop-text">📷 방 사진을 올려 주세요<br>끌어놓거나 눌러서 고르기 · JPG · PNG · 20MB 이하</span></div>'
      );
    }

    // 버튼
    const label = this.phase === 'done' ? '다시 만들기' : '사진으로 만들기';
    const off = busy || !spec || (this.phase !== 'done' && !this.img);
    parts.push(`<button type="button" class="ap-go" id="aiPhotoGo"${off ? ' disabled' : ''}>${esc(label)}</button>`);

    if (busy && this.gen) {
      const pct = Math.max(0, Math.min(100, plannerAiPhotoNum(this.gen.progress)));
      parts.push(`<div class="ap-bar"><i style="width:${pct}%"></i></div>`);
    }
    if (this.message) {
      parts.push(`<div class="ap-msg${this.bad ? ' ap-bad' : ''}">${esc(this.message)}</div>`);
    }

    // 결과
    const images = (this.gen && Array.isArray(this.gen.images)) ? this.gen.images : [];
    if (this.phase === 'done' && images.length) {
      parts.push('<div class="ap-thumbs">');
      images.forEach((im) => {
        const cap = im.label || im.slot || '';
        parts.push(im.url
          ? `<a class="ap-thumb" href="${esc(im.url)}" target="_blank" rel="noopener" title="${esc(cap)}">`
            + `<img src="${esc(im.url)}" alt="${esc(cap)}" loading="lazy"><span class="ap-cap">${esc(cap)}</span></a>`
          : `<div class="ap-thumb"><span class="ap-cap">${esc(cap)}</span></div>`);
      });
      parts.push('</div>');
      parts.push('<div class="ap-note">치수는 참고이고 구성(순서·개수)이 구속입니다 — 실제 제작 도면과 다를 수 있습니다.</div>');
    }

    parts.push('</div>');
    host.innerHTML = parts.join('');
    this._bind(host);
    return true;
  },

  _bind(host) {
    const drop = host.querySelector('#aiPhotoDrop');
    const go = host.querySelector('#aiPhotoGo');
    if (go) go.onclick = () => { this.submit(); };
    if (!drop) return;
    drop.onclick = () => this.pick();
    ['dragenter', 'dragover'].forEach((t) => {
      drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('ap-over'); });
    });
    ['dragleave', 'drop'].forEach((t) => {
      drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('ap-over'); });
    });
    drop.addEventListener('drop', (e) => {
      const files = (e.dataTransfer && e.dataTransfer.files) || [];
      if (files.length) this.setFile(files[0]);
    });
  },

  /** 파일 고르기 창. */
  pick() {
    if (typeof document === 'undefined') return false;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/jpeg,image/png';
    inp.onchange = () => { if (inp.files && inp.files[0]) this.setFile(inp.files[0]); };
    inp.click();
    return true;
  },

  /** 사진 한 장을 받아 축소·인코딩해서 들고 있는다. */
  async setFile(file) {
    try {
      this.img = await plannerAiPhotoReadImage(file);
      this.message = '';
      this.bad = false;
      if (this.phase === 'done') { this.phase = 'idle'; this.gen = null; }
    } catch (e) {
      this.img = null;
      this.message = e.message;
      this.bad = true;
    }
    this.render();
    return this.img;
  },

  // ── 생성 ─────────────────────────────────────────────────

  /** 「사진으로 만들기」. 성공하면 폴링까지 이어 간다. */
  async submit() {
    if (this.phase === 'sending' || this.phase === 'running') return { ok: false, reason: 'busy' };
    const spec = this.spec();
    if (!spec) return this._fail('도면이 비어 있습니다 — 모듈을 먼저 넣어 주세요');
    if (!this.img) return this._fail('사진을 먼저 올려 주세요');

    const ready = await this.ready();
    if (!ready.ok) return this._fail(plannerAiPhotoScopeMessage(ready.reason));
    const token = await this.token();
    if (!token) return this._fail(plannerAiPhotoScopeMessage('no-session'));

    const f = this.fetch();
    if (!f) return this._fail('이 화면에서는 사진 생성을 쓸 수 없습니다');

    this.phase = 'sending';
    this.gen = null;
    this.bad = false;
    this.message = '생성을 요청하는 중…';
    this.render();

    let res;
    try {
      res = await f(this.api(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          room_image: this.img.base64,
          image_type: this.img.mime,
          category: spec.category,
          design_spec: spec,
        }),
      });
    } catch (e) {
      return this._fail('생성 서버에 닿지 못했습니다 — 잠시 뒤 다시 시도해 주세요');
    }
    const data = await this._json(res);
    if (!res.ok || !data || data.success === false) {
      return this._fail(plannerAiPhotoErrorMessage(res.status, data));
    }
    if (!data.id) return this._fail('생성 번호를 받지 못했습니다');

    this.genId = data.id;
    this.rememberJob(data.id);
    this.phase = 'running';
    this.gen = { id: data.id, status: 'queued', progress: 0 };
    this.message = plannerAiPhotoStepLabel(this.gen);
    this.render();
    this.toast(`🖼 사진으로 만드는 중 — ${PLANNER_AI_PHOTO_CREDIT} 크레딧을 썼습니다`);
    return await this.poll(data.id);
  },

  /** 새로고침 뒤 돌아왔을 때 — 기억해 둔 잡에 다시 붙는다. */
  async reattach() {
    if (this.phase === 'sending' || this.phase === 'running') return { ok: false, reason: 'busy' };
    const id = this.lastJob();
    if (!id) return { ok: false, reason: 'none' };
    const got = await this._get(id);
    if (!got.ok) { this.rememberJob(null); return got; }
    this.genId = id;
    this._apply(got.generation);
    if (plannerAiPhotoIsActive(got.generation.status)) {
      this.phase = 'running';
      this.render();
      return await this.poll(id);
    }
    this.render();
    return got;
  },

  /** 3초마다 상태를 읽는다. 끝나면 결과를 그린다. */
  async poll(id) {
    const seq = (this._seq = this._seq + 1);
    for (;;) {
      await new Promise((r) => setTimeout(r, PLANNER_AI_PHOTO_POLL_MS));
      if (seq !== this._seq) return { ok: false, reason: 'superseded' };
      const got = await this._get(id);
      if (seq !== this._seq) return { ok: false, reason: 'superseded' };
      if (!got.ok) return this._fail(got.message);
      const g = got.generation;
      this._apply(g);
      this.render();
      if (g.status === 'done') {
        this.toast('🖼 사진이 완성됐습니다');
        return got;
      }
      if (g.status === 'failed') {
        this.rememberJob(null);
        return this._fail(g.error || '생성에 실패했습니다 — 크레딧은 돌려드렸습니다');
      }
    }
  },

  async _get(id) {
    const f = this.fetch();
    if (!f) return { ok: false, message: '이 화면에서는 사진 생성을 쓸 수 없습니다' };
    const token = await this.token();
    if (!token) return { ok: false, message: plannerAiPhotoScopeMessage('no-session') };
    let res;
    try {
      res = await f(this.apiBase() + '/api/generate/' + id, {
        headers: { Authorization: 'Bearer ' + token },
      });
    } catch (e) {
      return { ok: false, message: '생성 서버에 닿지 못했습니다 — 잠시 뒤 다시 시도해 주세요' };
    }
    const data = await this._json(res);
    if (!res.ok || !data || data.success === false || !data.generation) {
      return { ok: false, message: plannerAiPhotoErrorMessage(res.status, data) };
    }
    return { ok: true, generation: data.generation };
  },

  async _json(res) {
    try { return await res.json(); } catch (e) { return null; }
  },

  _apply(g) {
    this.gen = g || null;
    if (!g) return;
    if (g.status === 'done') {
      this.phase = 'done';
      this.bad = false;
      const n = (g.images || []).length;
      this.message = n ? `완성 — ${n}장` : '완성됐지만 이미지가 없습니다';
    } else if (g.status === 'failed') {
      this.phase = 'idle';
    } else {
      this.phase = 'running';
      this.bad = false;
      this.message = plannerAiPhotoStepLabel(g);
    }
  },

  _fail(message) {
    this.phase = this.phase === 'done' ? 'done' : 'idle';
    this.message = message;
    this.bad = true;
    this.render();
    return { ok: false, message };
  },
};

if (typeof window !== 'undefined') {
  window.PlannerAiPhoto = PlannerAiPhoto;
  window.plannerAiPhotoBuildSpec = plannerAiPhotoBuildSpec;
  window.plannerAiPhotoReadImage = plannerAiPhotoReadImage;
  window.plannerAiPhotoErrorMessage = plannerAiPhotoErrorMessage;
  window.plannerAiPhotoFitSize = plannerAiPhotoFitSize;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_AI_PHOTO_MAX_EDGE,
    PLANNER_AI_PHOTO_MAX_BYTES,
    PLANNER_AI_PHOTO_CREDIT,
    PLANNER_AI_PHOTO_POLL_MS,
    PLANNER_AI_PHOTO_JOB_KEY,
    PLANNER_AI_PHOTO_STEP,
    PLANNER_AI_PHOTO_ACTIVE,
    PLANNER_AI_PHOTO_BUCKET,
    PLANNER_AI_PHOTO_BUCKETS,
    PLANNER_AI_PHOTO_APPLIANCE,
    PLANNER_AI_PHOTO_FINISHING,
    PLANNER_AI_PHOTO_CSS,
    plannerAiPhotoBoxOf,
    plannerAiPhotoKindOfCell,
    plannerAiPhotoCellLabel,
    plannerAiPhotoWardrobeDrawers,
    plannerAiPhotoModulesOf,
    plannerAiPhotoHsl,
    plannerAiPhotoColorFromHex,
    plannerAiPhotoTone,
    plannerAiPhotoMaterialEn,
    plannerAiPhotoColorEn,
    plannerAiPhotoFinishOf,
    plannerAiPhotoCategoryOf,
    plannerAiPhotoBuildSpec,
    plannerAiPhotoSpecSummary,
    plannerAiPhotoFitSize,
    plannerAiPhotoFileError,
    plannerAiPhotoReadImage,
    plannerAiPhotoErrorMessage,
    plannerAiPhotoScopeMessage,
    plannerAiPhotoStepLabel,
    plannerAiPhotoIsActive,
    PlannerAiPhoto,
  };
}
