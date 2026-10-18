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
// ── 2026-10-18: 플래너 모드로 교체 (계획 planner-render-realize.plan.md §9 P5) ──
//   버튼 하나 → 도면을 스스로 찍는다 (PlannerCapture.capture, clean) → mode:'planner' 로 보낸다.
//     입면(front) 긴 변 1536 PNG — 필수. 못 찍으면 요청하지 않는다(크레딧 안 씀).
//     3/4(massing) 긴 변 1024 → JPEG 0.9 — 선택. 못 찍거나 못 바꾸면 입면만 보낸다.
//   결과 비율(aspect)은 방 사진에 가장 가까운 허용 비율이다 (사장님 결정 2026-10-18 —
//   세로 사진은 사진 비율을 따른다). 계획서의 "16:9 로 자르기" 는 이 결정으로 대신한다.
//   실사화 체크박스·구조 조건 드롭존은 화면에서 뺐다. 코드 삭제는 P6 (계획 §8).
//   결과는 대조가 ok 일 때만 ✓. 그 밖은 "내부 확인용 — 고객 공유 불가" + 입면을 옆에 (§6.3).
//   2026-10-18: eval=1 이면 이미지 모델(Gemini/GPT)을 고른다 — GPT 면 본문에 image_provider:'openai'.
//     결과 아래에 누가 그렸는지 한 줄 (GPT 실패 → Gemini 대신 포함).
//
// ── 2026-10-19: 번호 붙인 입면 · design_spec 선택 필드 · 작은 사진 알림 ──
//   입면 캡처에 annotate(번호·치수선 plan)를 얹는다. plan 은 보내는 design_spec 과 같은 요약에서 만든다
//   (plannerAiPhotoSpecTrace → plannerAiPhotoElevationLabels) — 워커 프롬프트의 L1·U1·T1·W1 과 같은 번호다.
//   design_spec 에 layout{shape,walls} · sections.*.fromFloorMm · ceilingMm 을 더한다 (모르면 넣지 않는다).
//   방 사진 긴 변이 1024px 미만이면 한 줄 알린다 (막지 않는다).
//
// ── 2026-10-19 (오후): 입면 두 장 · 기본 모델 GPT ──
//   입면을 두 번 찍는다 — 번호 없음(clean) → renders 의 elevation(필수), 번호 있음(annotate) → elevation_labeled(선택).
//   워커는 GPT 로 그릴 때만 번호 입면을 쓰고, Gemini(기본이든 GPT 실패 대체든)에는 번호 없는 입면을 준다
//   (실측: Gemini 는 번호 라벨을 도어 위에 글자로 그려 넣었다). 번호 입면을 못 찍으면 빼고 보낸다.
//   기본 모델은 워커가 정한다(PLANNER_IMAGE_PROVIDER = GPT) — 손님 화면은 image_provider 를 싣지 않는다.
//   eval=1 토글은 기본 GPT, 고른 값을 그대로 싣는다 (Gemini 면 'gemini').
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

/**
 * 결과 비율 — 워커가 받는 값 (prompts.js PLANNER_ASPECTS, 그 밖은 16:9 로 떨어진다).
 * 2026-10-18: 방 사진에 가장 가까운 것을 고른다. 가로·세로 사진 모두 사진 비율을 따른다.
 */
const PLANNER_AI_PHOTO_ASPECTS = [
  { key: '16:9', r: 16 / 9 },
  { key: '4:3', r: 4 / 3 },
  { key: '1:1', r: 1 },
  { key: '3:4', r: 3 / 4 },
  { key: '9:16', r: 9 / 16 },
];

/**
 * 도면 렌더 캡처 (계획 §5) — 입면은 PNG 그대로, 3/4 는 JPEG 로 바꿔 보낸다.
 * 2026-10-19: 입면은 번호 없음(elevation)·번호 있음(elevation_labeled) 두 장 — 같은 크기로 찍는다.
 */
const PLANNER_AI_PHOTO_RENDER = {
  elevation: { kind: 'front', longEdge: 1536 },
  massing: { kind: 'massing', longEdge: 1024, quality: 0.9 },
};

/**
 * 이미지 모델 고르기 (2026-10-18, 사장님 비교용) — 주소에 eval=1 일 때만 보인다.
 * 워커 계약 (2026-10-19): 요청 본문 image_provider 'gemini' | 'openai', 없으면 워커 기본값(PLANNER_IMAGE_PROVIDER = GPT)
 *   (design-spec-prompt.md "플래너 모드"). 토글이 없으면(손님 화면) 키를 싣지 않는다.
 * 고른 값은 이 브라우저에 기억한다 (스코프와 상관없이 한 값). 기억한 값이 없으면 GPT.
 */
const PLANNER_AI_PHOTO_PROVIDER_KEY = 'dadam_aiphoto_provider_v1';
const PLANNER_AI_PHOTO_PROVIDERS = [
  { key: 'gemini', label: 'Gemini' },
  { key: 'openai', label: 'GPT' },
];

/** 결과 옆 문구 — 도면과 맞는다고 확인되지 않은 결과 (계획 §6.3, design-spec-prompt.md "내부 확인용"). */
const PLANNER_AI_PHOTO_INTERNAL_LABEL = '내부 확인용 — 고객 공유 불가';

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
  // 색을 못 찾아도 색 자리를 비우지 않는다 — 자재만 적힌 문장은 모델에게 아무 색도 주지 않는다.
  const color = plannerAiPhotoColorEn(entry, c) || 'neutral';
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
 * @param {Function} [input.resolve]   마감 해석기. 기본은 전역 plannerFinishResolve (시험 주입용)
 * @param {(m:object)=>number} [input.baseYOf]  2026-10-19: 모듈 아랫면의 바닥 기준 높이 (mm, 3D 와 같은 값).
 *   주면 구간마다 `fromFloorMm` (그 줄에서 가장 낮은 값). 없으면 넣지 않는다
 * @param {number} [input.ceilingMm]   2026-10-19: 플래너가 아는 천장 높이 (mm). 주면 최상위 `ceilingMm`
 * @returns {{category:string, wallRunMm:number, sections:object, appliances:Array, finishes:object, notes?:string,
 *   layout?:{shape:string, walls:number}, ceilingMm?:number}|null}
 *   보낼 내용이 하나도 없으면 null (계약은 빈 객체를 400 으로 돌려준다)
 */
function plannerAiPhotoBuildSpec(input) {
  const r = plannerAiPhotoSpecTrace(input);
  return r ? r.spec : null;
}

/** 2026-10-19: 천장 높이로 받는 범위 (mm) — 밖이면 모르는 값으로 본다. 워커 계약(1500–4000 으로 자름)과 같은 범위. */
const PLANNER_AI_PHOTO_CEILING_RANGE = [1500, 4000];

/**
 * 2026-10-19: 배치 모양 — 모듈 회전(0·90·180·270)으로 정면 벽 수를 센다. 순수.
 *   회전이 한 가지 → straight (1벽) · 이웃한 두 가지(90° 차) → corner (ㄱ자, 2벽) · 세 가지 → u (ㄷ자, 3벽).
 *   마주 보는 두 가지(0·180, 11자)·네 가지·90° 배수가 아닌 회전은 모른다 → null (보내지 않는다).
 *   마감재(EP·몰딩·휠라·비움)는 판이라 세지 않는다. mockup-structure.html buildSets 와 같은 묶음 (회전 = 정면 세트).
 * @returns {{shape:'straight'|'corner'|'u', walls:number}|null}
 */
function plannerAiPhotoLayoutOf(modules) {
  const rots = [];
  for (const m of (Array.isArray(modules) ? modules : [])) {
    if (!m || plannerAiPhotoIsFinishing(m.section)) continue;
    const r = ((plannerAiPhotoNum(m.rotation) % 360) + 360) % 360;
    if (r % 90 !== 0) return null;
    if (rots.indexOf(r) < 0) rots.push(r);
  }
  if (rots.length === 1) return { shape: 'straight', walls: 1 };
  if (rots.length === 2) {
    const d = Math.abs(rots[0] - rots[1]);
    return (d === 90 || d === 270) ? { shape: 'corner', walls: 2 } : null;
  }
  if (rots.length === 3) return { shape: 'u', walls: 3 };
  return null;
}

/**
 * 2026-10-19: 도면 요약 + **번호 자취**. 순수. plannerAiPhotoBuildSpec 은 이것의 spec 만 돌려준다.
 *   trace[slot][i] = spec.sections[slot].modules[i] 가 어느 플래너 모듈의 어느 몫인지 — { moduleId, from, to }
 *   (모듈 폭 안의 비율 0~1. 칸마다 쪼갠 모듈은 칸 폭 비율, 한 덩이·가전은 0~1). 정면 입면 번호(annotate)가 쓴다.
 * @returns {{spec:object, trace:Object<string,{moduleId:string, from:number, to:number}[]>}|null}
 */
function plannerAiPhotoSpecTrace(input) {
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

  const trace = {};
  PLANNER_AI_PHOTO_BUCKETS.forEach((slot) => {
    const list = (bySlot[slot] || []).slice().sort((a, b) => a.b.x - b.b.x);
    if (!list.length) return;
    const x0 = Math.min.apply(null, list.map((x) => x.b.x));
    const x1 = Math.max.apply(null, list.map((x) => x.b.x + x.b.w));
    let mods = [];
    const tr = [];
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
        tr.push({ moduleId: String(m.id), from: 0, to: 1 });
        return;
      }
      const part = plannerAiPhotoModulesOf(m, s, wardrobeFrontOf(m, s));
      // 2026-10-19: 칸마다 쪼갠 모듈은 칸 폭 비율로 자취를 남긴다 (좌→우)
      const sum = part.reduce((n, p) => n + plannerAiPhotoNum(p.widthMm), 0);
      let acc = 0;
      part.forEach((p) => {
        const w = plannerAiPhotoNum(p.widthMm);
        const one = part.length === 1 || !(sum > 0);
        tr.push({ moduleId: String(m.id), from: one ? 0 : acc / sum, to: one ? 1 : (acc + w) / sum });
        acc += w;
      });
      mods = mods.concat(part);
    });
    trace[slot] = tr.slice(0, PLANNER_AI_PHOTO_MAX_MODULES);
    // 폭은 **자리(x 범위)와 모듈 폭 합** 중 큰 쪽이다.
    //   · 보통은 둘이 같다 (모듈이 자리를 채운다).
    //   · ㄱ자에서 90° 로 꺾인 구간은 x 로 눌리면 깊이만큼(650)으로 보여 실제 1500 런을 잃는다.
    //     눌러 편 도면이라도 "가구가 이만큼 있다" 는 잃지 않아야 한다.
    const sumW = mods.reduce((n, m) => n + plannerAiPhotoNum(m.widthMm), 0);
    sections[slot] = {
      widthMm: plannerAiPhotoMm(Math.max(x1 - x0, sumW)),
      heightMm: plannerAiPhotoMm(Math.max.apply(null, list.map((x) => plannerAiPhotoNum(x.m.H)))),
      depthMm: plannerAiPhotoMm(Math.max.apply(null, list.map((x) => plannerAiPhotoNum(x.m.D)))),
      fromLeftMm: plannerAiPhotoMm(x0 - left),
      modules: mods.slice(0, PLANNER_AI_PHOTO_MAX_MODULES),
    };
    // 2026-10-19: 줄 아랫면의 바닥 기준 높이 — 페이지가 3D 와 같은 baseYOf 를 줄 때만 (상부장 설치 높이 등)
    if (typeof o.baseYOf === 'function') {
      const ys = [];
      list.forEach((x) => {
        let v = null;
        try { v = Number(o.baseYOf(x.m)); } catch (e) { v = null; }
        if (Number.isFinite(v) && v >= 0) ys.push(v);
      });
      if (ys.length) sections[slot].fromFloorMm = plannerAiPhotoMm(Math.min.apply(null, ys));
    }
  });

  appliances.sort((a, b) => a._x - b._x);
  const apps = appliances.slice(0, PLANNER_AI_PHOTO_MAX_APPLIANCES)
    .map((a) => ({ kind: a.kind, fromLeftMm: a.fromLeftMm, widthMm: a.widthMm }));

  // 마감 — 도어·몸통·상판. 모듈마다 해석해(부재>모듈>섹션>품목) 가장 많이 나온 코드를 대표로 삼는다.
  const finishes = {};
  const detail = o.detail || null;
  const resolve = (typeof o.resolve === 'function') ? o.resolve
    : (typeof plannerFinishResolve === 'function') ? plannerFinishResolve
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

  // 런 폭 — 모든 모듈의 좌우 끝. 구간이 그보다 길어졌으면(위 sumW) 그쪽을 따른다.
  let runMm = right - left;
  PLANNER_AI_PHOTO_BUCKETS.forEach((slot) => {
    const s = sections[slot];
    if (s) runMm = Math.max(runMm, s.fromLeftMm + s.widthMm);
  });

  const spec = {
    category: o.category || plannerAiPhotoCategoryOf(all),
    wallRunMm: plannerAiPhotoMm(runMm),
    sections,
    appliances: apps,
    finishes,
  };
  if (notes.length) spec.notes = plannerAiPhotoCut(notes.join(' · '), PLANNER_AI_PHOTO_MAX_NOTES);
  // 계약: wallRunMm·sections·appliances·finishes 중 적어도 하나는 내용이 있어야 한다.
  if (!spec.wallRunMm && !Object.keys(sections).length && !apps.length && !Object.keys(finishes).length) {
    return null;
  }
  // 2026-10-19: 선택 필드 — 기존 필드 뒤에 붙인다. 모르면 넣지 않는다.
  const layout = plannerAiPhotoLayoutOf(all);
  if (layout) spec.layout = layout;
  const ceil = Number(o.ceilingMm);
  if (Number.isFinite(ceil) && ceil >= PLANNER_AI_PHOTO_CEILING_RANGE[0] && ceil <= PLANNER_AI_PHOTO_CEILING_RANGE[1]) {
    spec.ceilingMm = plannerAiPhotoMm(ceil);
  }
  return { spec, trace };
}

/**
 * 2026-10-19: 정면 입면에 얹을 번호 plan — PlannerCapture.capture({ annotate }) 가 받는 모양. 순수.
 *
 * 번호는 **워커 프롬프트와 같은 규칙**이다 (workers/generate-api/src/prompts.js `plannerRows` · `buildPlannerPrompt`):
 *   · 줄 = design_spec.sections 의 lower → upper → tall 순서 (DESIGN_SECTIONS), modules 가 있는 칸만.
 *     머리 L(하부) · U(상부) · T(키큰장), 번호는 줄 안 modules[] 순서(왼→오) 1부터. 칸마다 쪼갠 모듈은 칸마다 번호.
 *     가전 칸(냉장고·식기세척기, kind 'appliance')도 번호를 받는다.
 *   · 붙박이장(category 'wardrobe')은 한 줄 W — 구간을 fromLeftMm 순서(같으면 lower·upper·tall)로 이어 붙인다.
 *     줄 높이 = 구간 높이 중 최대, 줄 폭 = 구간들의 왼쪽 끝~오른쪽 끝.
 *   · 워커는 modules 를 40 개까지만 읽는다 — spec 이 이미 40 개로 잘랐다.
 * @param {object} spec  plannerAiPhotoSpecTrace().spec
 * @param {object} trace plannerAiPhotoSpecTrace().trace
 * @returns {{rows:{key:string, prefix:string, widthMm:number|null, heightMm:number|null,
 *   items:{id:string, moduleId:string, from:number, to:number, widthMm:number}[]}[]}|null}
 */
function plannerAiPhotoElevationLabels(spec, trace) {
  const secs = (spec && spec.sections) || {};
  const tr = trace || {};
  const keys = PLANNER_AI_PHOTO_BUCKETS.filter((k) => secs[k] && Array.isArray(secs[k].modules) && secs[k].modules.length);
  if (!keys.length) return null;
  const widthOf = (sec) => sec.widthMm || sec.modules.reduce((n, m) => n + (m.widthMm || 0), 0) || null;
  const itemsOf = (k) => secs[k].modules.map((m, i) => {
    const t = (tr[k] || [])[i] || {};
    return { moduleId: t.moduleId, from: t.from, to: t.to, widthMm: m.widthMm };
  });
  const number = (prefix, list) => list
    .map((it, i) => ({ id: prefix + (i + 1), moduleId: it.moduleId, from: it.from, to: it.to, widthMm: it.widthMm }))
    .filter((it) => it.moduleId != null);
  let rows;
  if (spec.category === 'wardrobe') {
    const ordered = keys.slice().sort((a, b) => (secs[a].fromLeftMm || 0) - (secs[b].fromLeftMm || 0));
    const heights = ordered.map((k) => secs[k].heightMm).filter(Boolean);
    const x0 = Math.min.apply(null, ordered.map((k) => secs[k].fromLeftMm || 0));
    const x1 = Math.max.apply(null, ordered.map((k) => (secs[k].fromLeftMm || 0) + (widthOf(secs[k]) || 0)));
    rows = [{
      key: 'wardrobe',
      prefix: 'W',
      widthMm: (x1 - x0) || null,
      heightMm: heights.length ? Math.max.apply(null, heights) : null,
      items: number('W', [].concat.apply([], ordered.map(itemsOf))),
    }];
  } else {
    const PREFIX = { lower: 'L', upper: 'U', tall: 'T' };
    rows = keys.map((k) => ({
      key: k,
      prefix: PREFIX[k],
      widthMm: widthOf(secs[k]),
      heightMm: secs[k].heightMm || null,
      items: number(PREFIX[k], itemsOf(k)),
    }));
  }
  rows = rows.filter((r) => r.items.length);
  return rows.length ? { rows } : null;
}

/** 2026-10-19: 방 사진이 이보다 작으면(긴 변 px) 알린다 — 막지는 않는다. */
const PLANNER_AI_PHOTO_SMALL_EDGE = 1024;
const PLANNER_AI_PHOTO_SMALL_TEXT = '사진이 작아 방이 바뀔 수 있습니다 — 더 큰 사진을 권합니다';

/** 2026-10-19: 작은 사진인가 — 긴 변 < 1024px. 크기를 모르면 false (알리지 않는다). */
function plannerAiPhotoIsSmallPhoto(w, h) {
  const W = plannerAiPhotoNum(w), H = plannerAiPhotoNum(h);
  if (!(W > 0) || !(H > 0)) return false;
  return Math.max(W, H) < PLANNER_AI_PHOTO_SMALL_EDGE;
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
          const url = cv.toDataURL(o.mime || 'image/jpeg', 0.9);   // 구조 조건은 PNG 로 (선이 뭉개지면 안 된다)
          resolve({
            base64: String(url).split(',')[1] || '',
            mime: o.mime || 'image/jpeg',
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

/**
 * 방 사진 크기 → 결과 비율 (워커의 `aspect`).
 * 2026-10-18 사장님 결정: 세로 사진은 사진 비율을 따른다. 가로는 보통 16:9 · 4:3 으로 떨어진다.
 * 비율은 **로그 거리**로 잰다 — 가로·세로가 대칭이다 (4:3 과 3:4 가 1:1 에서 같은 거리).
 * 크기를 모르면 16:9 (워커 기본값과 같다).
 */
function plannerAiPhotoAspectOf(w, h) {
  const W = plannerAiPhotoNum(w);
  const H = plannerAiPhotoNum(h);
  if (!(W > 0) || !(H > 0)) return '16:9';
  const lr = Math.log(W / H);
  let best = PLANNER_AI_PHOTO_ASPECTS[0];
  let bestD = Infinity;
  PLANNER_AI_PHOTO_ASPECTS.forEach((a) => {
    const d = Math.abs(lr - Math.log(a.r));
    if (d < bestD - 1e-9) { best = a; bestD = d; }
  });
  return best.key;
}

/** 화면 한 줄 — "세로 사진 · 3:4". */
function plannerAiPhotoAspectLabel(w, h) {
  const key = plannerAiPhotoAspectOf(w, h);
  const W = plannerAiPhotoNum(w);
  const H = plannerAiPhotoNum(h);
  const kind = key === '1:1' ? '정사각 사진' : (H > W ? '세로 사진' : '가로 사진');
  return `${kind} · ${key}`;
}

/** Blob → base64 (머리 없이). FileReader 가 없으면 arrayBuffer 로. */
function plannerAiPhotoBlobToBase64(blob, opt) {
  const o = opt || {};
  return new Promise((resolve, reject) => {
    if (!blob) return reject(new Error('그림이 비어 있습니다'));
    const Reader = o.FileReader || (typeof FileReader !== 'undefined' ? FileReader : null);
    if (Reader) {
      const fr = new Reader();
      fr.onerror = () => reject(new Error('그림을 읽지 못했습니다'));
      fr.onload = () => resolve(String(fr.result || '').split(',')[1] || '');
      fr.readAsDataURL(blob);
      return;
    }
    if (typeof blob.arrayBuffer !== 'function' || typeof btoa !== 'function') {
      return reject(new Error('이 화면에서는 그림을 읽을 수 없습니다'));
    }
    blob.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      resolve(btoa(s));
    }, reject);
  });
}

/**
 * PNG Blob → JPEG base64 (계획 §5 — 3/4 뷰는 JPEG). 흰 바탕 위에 얹는다(알파가 남아도 검게 안 된다).
 * 브라우저가 JPEG 를 못 만들면(toDataURL 이 PNG 로 떨어지면) 실패로 돌려준다.
 */
async function plannerAiPhotoBlobToJpeg(blob, opt) {
  const o = opt || {};
  const quality = o.quality != null ? o.quality : PLANNER_AI_PHOTO_RENDER.massing.quality;
  if (!blob) throw new Error('그림이 비어 있습니다');
  let src = null;
  let revoke = null;
  if (typeof createImageBitmap === 'function') {
    src = await createImageBitmap(blob);
  } else {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      throw new Error('이 화면에서는 그림을 바꿀 수 없습니다');
    }
    const url = URL.createObjectURL(blob);
    revoke = () => URL.revokeObjectURL(url);
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('그림을 열지 못했습니다'));
      img.src = url;
    });
  }
  try {
    const w = src.naturalWidth || src.width;
    const h = src.naturalHeight || src.height;
    const cv = o.canvas || document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('canvas 2D 를 만들 수 없습니다');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    const url = String(cv.toDataURL('image/jpeg', quality));
    if (url.indexOf('data:image/jpeg') !== 0) throw new Error('JPEG 로 바꾸지 못했습니다');
    return { base64: url.split(',')[1] || '', mime: 'image/jpeg', width: w, height: h };
  } finally {
    if (src && typeof src.close === 'function') { try { src.close(); } catch (e) { /* 무해 */ } }
    if (revoke) { try { revoke(); } catch (e) { /* 무해 */ } }
  }
}

/**
 * 끝난 결과 → 대조 판정 (계획 §6.3).
 *   ok       — 대조 ok 이고 internal_only 가 아니다. ✓ 와 점수.
 *   internal — internal_only · 불일치 · 대조 실패 · 플래너 결과인데 대조가 없음. ⚠ 사유 + 공유 불가.
 *   none     — 플래너 모드가 아닌 예전 결과 (대조도 표시도 없다).
 * 워커 필드: generation.layout.verify {ok, score, max, issues, error} · generation.options.internal_only.
 * @returns {{state:'ok'|'internal'|'none', score?:number, max?:number, reasons:string[]}}
 */
function plannerAiPhotoVerdict(gen) {
  const g = gen || {};
  const opts = (g.options && typeof g.options === 'object') ? g.options : {};
  const v = (g.layout && g.layout.verify) || null;
  const score = v && v.score != null ? v.score : undefined;
  const max = v && v.max != null ? v.max : undefined;
  const pts = score != null && max != null ? ` (${score}/${max})` : '';
  if (v && v.ok === true && opts.internal_only !== true) return { state: 'ok', score, max, reasons: [] };
  const planner = opts.mode === 'planner' || opts.internal_only === true;
  if (!v && !planner) return { state: 'none', reasons: [] };
  const reasons = [];
  if (v && v.ok === false) {
    reasons.push('도면과 어긋남' + pts);
    (Array.isArray(v.issues) ? v.issues : []).slice(0, 3).forEach((s) => reasons.push(String(s)));
  } else if (v && v.ok === true) {
    reasons.push('대조는 맞았지만 서버가 내부 확인용으로 표시했습니다' + pts);
  } else if (v) {
    reasons.push('도면과 대조하지 못했습니다' + (v.error ? ' — ' + String(v.error) : ''));
  } else {
    reasons.push('도면과 대조한 기록이 없습니다');
  }
  return { state: 'internal', score, max, reasons };
}

/**
 * 끝난 결과 → 누가 그렸나 한 줄 (2026-10-18).
 * 워커 필드: generation.images[base].{provider, model, fallback, fallback_reason} · generation.model.
 *   GPT 가 그렸으면 칸에 provider:'openai'. GPT 가 실패해 Gemini 가 대신 그렸으면 fallback:true.
 *   Gemini 가 정상으로 그리면 칸에 표시가 없다 — 그때는 행의 model 만 있다.
 * @returns {{kind:'openai'|'gemini'|'fallback', model:string, text:string}|null}
 */
function plannerAiPhotoDrawnBy(gen) {
  const g = gen || {};
  const images = Array.isArray(g.images) ? g.images : [];
  const base = images.find((im) => im && im.slot === 'base') || images[0] || null;
  if (!base) return null;
  const model = String(base.model || g.model || '');
  const tail = model ? ` (${model})` : '';
  if (base.fallback === true && base.provider !== 'openai') {
    const why = base.fallback_reason ? ` — ${plannerAiPhotoCut(String(base.fallback_reason), 80)}` : '';
    return { kind: 'fallback', model, text: `GPT 실패 → Gemini 대신${tail}${why}` };
  }
  if (base.provider === 'openai') return { kind: 'openai', model, text: `그린 모델: GPT${tail}` };
  if (base.provider === 'gemini' || /^gemini/i.test(model)) return { kind: 'gemini', model, text: `그린 모델: Gemini${tail}` };
  return model ? { kind: 'gemini', model, text: `그린 모델: ${model}` } : null;
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
  if (code === 'missing_render') {
    return '도면 입면 그림을 서버가 받지 못했습니다 — 크레딧은 차감되지 않았습니다';
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
.ap-opt{display:flex;gap:5px;align-items:flex-start;font-size:10.5px;color:var(--text-dim,#7a7062);line-height:1.4;cursor:pointer}
.ap-opt input{margin:1px 0 0}
.ap-drop.ap-ctrl{min-height:46px;border-style:dotted}
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
.ap-verify-ok{color:#2f6f3e}
.ap-verify-bad{color:#a33}
.ap-ratio{font-size:10px;color:var(--text-dim,#7a7062);text-align:center}
.ap-internal{border:1px solid #d9a99a;background:#fbf0ec;border-radius:6px;padding:5px 7px;font-size:10px;line-height:1.5;color:#a3402a}
.ap-internal b{display:block;font-size:10.5px}
.ap-pair .ap-thumb img{aspect-ratio:auto;object-fit:contain;max-height:160px}
.ap-eval{font-size:9.5px;color:var(--text-faint,#a89c84);display:flex;gap:4px;align-items:center;cursor:pointer}
.ap-eval input{margin:0}
.ap-provider{gap:8px;cursor:default}
.ap-provider label{display:flex;gap:3px;align-items:center;cursor:pointer}
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
 *   baseYOf(m)       2026-10-19: 모듈 아랫면 바닥 기준 높이 (3D 와 같은 값) → 구간 fromFloorMm
 *   ceilingMm()      2026-10-19: 천장 높이 → 최상위 ceilingMm
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
  // 2026-10-18: 화면에서 뺐다(P5). 본문에도 안 싣는다. 필드·setControl 은 P6 가 지운다 (계획 §8).
  realize: false,
  control: null,
  /** 방금 보낸 입면 — 결과가 내부 확인용일 때 옆에 놓는 비교 그림 {url, width, height}. 이 탭에서만 산다. */
  elevation: null,
  /** 평가 스위치 (주소에 eval=1 일 때만 보인다) — 켜면 3/4 뷰를 안 보낸다. */
  noMassing: false,
  /** 이미지 모델 (eval=1 일 때만 고른다) — 'gemini' | 'openai'. null 이면 저장된 값을 읽는다. */
  imageProvider: null,
  gen: null,
  genId: null,
  message: '',
  bad: false,
  _seq: 0,
  /** 시험이 갈아 끼운다. 기본은 전역 fetch. */
  _fetch: null,
  /** 시험이 갈아 끼운다. 기본은 전역 PlannerCapture. */
  _capture: null,
  /** 시험이 갈아 끼운다 — PNG Blob → {base64, mime}. 기본은 plannerAiPhotoBlobToJpeg. */
  _toJpeg: null,

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
    const r = this.specTrace();
    return r ? r.spec : null;
  },

  /** 2026-10-19: 플래너가 아는 천장 높이 (mm) — mount 의 ceilingMm(). 모르면 null. */
  ceilingMm() {
    if (this._o && typeof this._o.ceilingMm === 'function') {
      try { const v = Number(this._o.ceilingMm()); return Number.isFinite(v) ? v : null; } catch (e) { return null; }
    }
    return null;
  },

  /** 2026-10-19: 요약 + 번호 자취 (plannerAiPhotoSpecTrace). 못 만들면 null. */
  specTrace() {
    const o = this._o || {};
    return plannerAiPhotoSpecTrace({
      modules: this.modules(),
      structureOf: (id) => (typeof o.structureOf === 'function' ? o.structureOf(id) : null),
      boxOf: o.boxOf || undefined,
      wardrobeFrontOf: o.wardrobeFrontOf || undefined,
      resolve: o.resolve || undefined,
      baseYOf: typeof o.baseYOf === 'function' ? o.baseYOf : undefined,
      ceilingMm: this.ceilingMm(),
      detail: this.detail(),
      catalog: this.catalog(),
    });
  },

  /** 2026-10-19: 정면 입면 번호 plan (plannerAiPhotoElevationLabels) — 지금 도면에서. 없으면 null. */
  labelPlan() {
    const r = this.specTrace();
    return r ? plannerAiPhotoElevationLabels(r.spec, r.trace) : null;
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

  /** 도면 렌더를 찍는 것 — PlannerCapture 의 공개 API capture() 만 쓴다. */
  capturer() {
    if (this._capture) return this._capture;
    if (this._o && this._o.capturer) return this._o.capturer;
    return (typeof PlannerCapture !== 'undefined' && PlannerCapture) ? PlannerCapture : null;
  },

  /** 평가용 주소인가 (`?eval=1`). 평소에는 스위치가 안 보이고 본문도 그대로다. */
  evalMode() {
    let search = '';
    if (this._o && typeof this._o.search === 'string') search = this._o.search;
    else if (typeof location !== 'undefined' && location) search = location.search || '';
    try { return new URLSearchParams(search).get('eval') === '1'; } catch (e) { return false; }
  },

  /** 고른 이미지 모델 — 화면에서 고른 값 → 저장된 값 → 'openai' (2026-10-19 기본 GPT). */
  pickedProvider() {
    if (this.imageProvider === 'openai' || this.imageProvider === 'gemini') return this.imageProvider;
    let v = null;
    try { v = localStorage.getItem(PLANNER_AI_PHOTO_PROVIDER_KEY); } catch (e) { v = null; }
    return v === 'gemini' ? 'gemini' : 'openai';
  },

  /** 고르기 — 기억해 둔다 (못 해도 이번 판은 고른 값으로 간다). */
  setProvider(v) {
    this.imageProvider = v === 'openai' ? 'openai' : 'gemini';
    try { localStorage.setItem(PLANNER_AI_PHOTO_PROVIDER_KEY, this.imageProvider); } catch (e) { /* 무해 */ }
    return this.imageProvider;
  },

  /**
   * 요청에 실을 공급자 — eval=1 이면 고른 값('gemini' | 'openai'), 아니면 null (본문에 키를 넣지 않는다 →
   * 워커 기본값 PLANNER_IMAGE_PROVIDER, 2026-10-19 GPT).
   */
  provider() {
    return this.evalMode() ? this.pickedProvider() : null;
  },

  /** 이 탭에서 만든 blob URL 을 놓는다. */
  _dropElevation() {
    const el = this.elevation;
    this.elevation = null;
    if (el && el.revoke && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(el.url); } catch (e) { /* 무해 */ }
    }
  },

  /**
   * 도면 렌더 (계획 §5 · §6.1).
   *   입면(번호 없음, clean) — 필수 → elevation. 못 찍으면 {ok:false, message} 로 멈춘다 (요청 전이라 크레딧을 안 쓴다).
   *   입면(번호 있음, annotate) — 선택 → elevation_labeled (2026-10-19). plan 은 design_spec 에서
   *     (plannerAiPhotoElevationLabels), 안 주면 지금 도면에서 만든다. 그릴 칸이 없거나 못 찍으면 빼고 보낸다.
   *     워커는 GPT 로 그릴 때만 이것을 쓴다 — Gemini 는 번호를 글자로 그려 넣는다.
   *   3/4  — 선택. 못 찍거나 JPEG 로 못 바꾸면 빼고 보낸다. 평가 스위치를 켜도 뺀다.
   *   비교용 그림(elevation)은 번호 입면이 있으면 그것, 없으면 번호 없는 입면.
   * @param {object} [plan] 번호 plan
   * @returns {Promise<{ok:true, renders:Array, elevation:object, labeled:boolean, labeledError?:string, massing:boolean, massingError?:string}|{ok:false, message:string}>}
   */
  async renders(plan) {
    const cap = this.capturer();
    if (!cap || typeof cap.capture !== 'function') {
      return { ok: false, message: '도면을 찍을 수 없습니다 — 3D 화면이 아직 준비되지 않았습니다 · 크레딧은 쓰지 않았습니다' };
    }
    const E = PLANNER_AI_PHOTO_RENDER.elevation;
    const labels = plan === undefined ? this.labelPlan() : plan;
    let front;
    try { front = await cap.capture({ kind: E.kind, longEdge: E.longEdge, clean: true }); }
    catch (e) { front = { ok: false, message: (e && e.message) || String(e) }; }
    if (!front || !front.ok || !front.blob) {
      const why = (front && front.message) || '알 수 없는 이유';
      return { ok: false, message: `도면 입면을 찍지 못했습니다 (${why}) — 크레딧은 쓰지 않았습니다` };
    }
    let frontB64;
    try { frontB64 = await plannerAiPhotoBlobToBase64(front.blob); }
    catch (e) { return { ok: false, message: '도면 입면을 읽지 못했습니다 — 크레딧은 쓰지 않았습니다' }; }
    if (!frontB64) return { ok: false, message: '도면 입면이 비어 있습니다 — 크레딧은 쓰지 않았습니다' };

    const renders = [{ role: 'elevation', base64: frontB64, mime: 'image/png' }];

    // 번호 입면 (2026-10-19) — 선택. 못 찍으면 빼고 간다 (번호 없는 입면만으로도 워커는 그린다).
    let shown = { shot: front, b64: frontB64 };
    let labeledError = null;
    if (labels && Array.isArray(labels.rows) && labels.rows.length) {
      try {
        const lb = await cap.capture({ kind: E.kind, longEdge: E.longEdge, clean: true, annotate: labels });
        if (!lb || !lb.ok || !lb.blob) {
          labeledError = (lb && lb.message) || '번호 입면을 찍지 못했습니다';
        } else {
          const lbB64 = await plannerAiPhotoBlobToBase64(lb.blob);
          if (lbB64) {
            renders.push({ role: 'elevation_labeled', base64: lbB64, mime: 'image/png' });
            shown = { shot: lb, b64: lbB64 };
          } else labeledError = '번호 입면이 비어 있습니다';
        }
      } catch (e) {
        labeledError = (e && e.message) || String(e);
      }
    } else {
      labeledError = 'no-labels';
    }
    const lab = labeledError ? { labeled: false, labeledError } : { labeled: true };

    // 비교용 그림 — blob URL 이 되면 그것을, 아니면 data URL (jsdom 은 createObjectURL 이 없다)
    let elevation;
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      try { elevation = { url: URL.createObjectURL(shown.shot.blob), revoke: true }; } catch (e) { elevation = null; }
    }
    if (!elevation) elevation = { url: 'data:image/png;base64,' + shown.b64, revoke: false };
    elevation.width = shown.shot.width;
    elevation.height = shown.shot.height;

    if (this.evalMode() && this.noMassing) return { ok: true, renders, elevation, ...lab, massing: false, massingError: 'eval' };

    const M = PLANNER_AI_PHOTO_RENDER.massing;
    let massingError = null;
    try {
      const shot = await cap.capture({ kind: M.kind, longEdge: M.longEdge, clean: true });
      if (!shot || !shot.ok || !shot.blob) {
        massingError = (shot && shot.message) || '3/4 뷰를 찍지 못했습니다';
      } else {
        const toJpeg = this._toJpeg || plannerAiPhotoBlobToJpeg;
        const jpg = await toJpeg(shot.blob, { quality: M.quality });
        if (jpg && jpg.base64) renders.push({ role: 'massing', base64: jpg.base64, mime: 'image/jpeg' });
        else massingError = '3/4 뷰를 JPEG 로 바꾸지 못했습니다';
      }
    } catch (e) {
      massingError = (e && e.message) || String(e);
    }
    return massingError
      ? { ok: true, renders, elevation, ...lab, massing: false, massingError }
      : { ok: true, renders, elevation, ...lab, massing: true };
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

    // 2026-10-18 (P5): 실사화 체크박스·구조 조건 드롭존은 그리지 않는다 — 도면은 플래너가 스스로 찍는다.
    //   결과 비율은 사진을 따른다 (사장님 결정 2026-10-18). 누르기 전에 보여 준다.
    if (this.img) {
      parts.push(`<div class="ap-ratio" id="aiPhotoRatio">결과 비율: ${esc(plannerAiPhotoAspectLabel(this.img.width, this.img.height))}</div>`);
      // 2026-10-19: 작은 사진 알림 — 막지는 않는다 (긴 변 1024px 미만)
      if (plannerAiPhotoIsSmallPhoto(this.img.width, this.img.height)) {
        parts.push(`<div class="ap-msg ap-small" id="aiPhotoSmall">${esc(PLANNER_AI_PHOTO_SMALL_TEXT)}</div>`);
      }
    }

    // 평가 스위치 — 주소에 eval=1 일 때만 (계획 §7.2 R1 팔). 평소에는 없다.
    if (this.evalMode()) {
      parts.push(
        `<label class="ap-eval"><input type="checkbox" id="aiPhotoNoMassing"${this.noMassing ? ' checked' : ''}> `
        + '평가: 3/4 뷰 빼기(입면만)</label>'
      );
      // 이미지 모델 (2026-10-18) — 같은 사진·도면을 두 모델로 돌려 비교한다. 2026-10-19 기본 GPT.
      const picked = this.pickedProvider();
      parts.push(
        '<div class="ap-eval ap-provider" id="aiPhotoProvider" role="radiogroup" aria-label="이미지 모델">평가: 이미지 모델'
        + PLANNER_AI_PHOTO_PROVIDERS.map((p) => `<label><input type="radio" name="aiPhotoProvider" value="${p.key}"`
          + `${picked === p.key ? ' checked' : ''}${busy ? ' disabled' : ''}> ${esc(p.label)}</label>`).join('')
        + '</div>'
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
      // 역판독 대조 (계획 §6.3): ok 면 ✓ 와 점수. 아니면 ⚠ 사유 + 내부 확인용 + 방금 찍은 입면을 옆에.
      //   워커 필드 — generation.layout.verify · generation.options.internal_only (design-spec-prompt.md).
      const verdict = plannerAiPhotoVerdict(this.gen);
      const thumb = (url, cap, extra) => (url
        ? `<a class="ap-thumb${extra || ''}" href="${esc(url)}" target="_blank" rel="noopener" title="${esc(cap)}">`
          + `<img src="${esc(url)}" alt="${esc(cap)}" loading="lazy"><span class="ap-cap">${esc(cap)}</span></a>`
        : `<div class="ap-thumb${extra || ''}"><span class="ap-cap">${esc(cap)}</span></div>`);
      const internal = verdict.state === 'internal';
      parts.push(`<div class="ap-thumbs${internal ? ' ap-pair' : ''}">`);
      images.forEach((im) => { parts.push(thumb(im.url, im.label || im.slot || '')); });
      if (internal && this.elevation && this.elevation.url) {
        parts.push(thumb(this.elevation.url, '도면 입면 (비교용)', ' ap-elev'));
      }
      parts.push('</div>');
      if (verdict.state === 'ok') {
        parts.push(`<div class="ap-note ap-verify-ok">✓ 역판독 대조: 도면의 순서·개수와 일치 (${esc(String(verdict.score))}/${esc(String(verdict.max))})</div>`);
      } else if (internal) {
        parts.push(
          `<div class="ap-internal" id="aiPhotoInternal"><b>⚠ ${esc(PLANNER_AI_PHOTO_INTERNAL_LABEL)}</b>`
          + verdict.reasons.map((r) => esc(r)).join('<br>')
          + (this.elevation ? '' : '<br>도면 입면은 이 탭에서 만든 결과일 때만 옆에 놓입니다')
          + '</div>'
        );
      }
      // 누가 그렸나 (2026-10-18) — GPT 이거나 대신 그렸으면 늘, Gemini 정상은 eval=1 일 때만 (평소 화면 그대로)
      const drawn = plannerAiPhotoDrawnBy(this.gen);
      if (drawn && (drawn.kind !== 'gemini' || this.evalMode())) {
        parts.push(`<div class="ap-note ap-drawn${drawn.kind === 'fallback' ? ' ap-verify-bad' : ''}" id="aiPhotoDrawnBy">${esc(drawn.text)}</div>`);
      }
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
    const nm = host.querySelector('#aiPhotoNoMassing');
    if (nm) nm.onchange = () => { this.noMassing = !!nm.checked; };
    host.querySelectorAll('input[name="aiPhotoProvider"]').forEach((r) => {
      r.onchange = () => { if (r.checked) this.setProvider(r.value); };
    });
    // 아래 둘은 2026-10-18 부터 그리지 않아 걸리지 않는다 — P6 가 지운다.
    const rz = host.querySelector('#aiPhotoRealize');
    if (rz) rz.onchange = () => { this.realize = !!rz.checked; this.render(); };
    const cdrop = host.querySelector('#aiPhotoControlDrop');
    if (cdrop) {
      cdrop.onclick = () => this.pickControl();
      ['dragenter', 'dragover'].forEach((t) => cdrop.addEventListener(t, (e) => { e.preventDefault(); cdrop.classList.add('ap-over'); }));
      ['dragleave', 'drop'].forEach((t) => cdrop.addEventListener(t, (e) => { e.preventDefault(); cdrop.classList.remove('ap-over'); }));
      cdrop.addEventListener('drop', (e) => { const files = (e.dataTransfer && e.dataTransfer.files) || []; if (files.length) this.setControl(files[0]); });
    }
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

  /** 구조 조건 이미지 고르기 창. */
  pickControl() {
    if (typeof document === 'undefined') return false;
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/png,image/jpeg';
    inp.onchange = () => { if (inp.files && inp.files[0]) this.setControl(inp.files[0]); };
    inp.click();
    return true;
  },

  /** 구조 조건 이미지 — 사진과 같은 규칙으로 줄이되 PNG 로 둔다 (같은 원본 크기면 같은 화소 크기가 된다). */
  async setControl(file) {
    try {
      this.control = await plannerAiPhotoReadImage(file, { mime: 'image/png' });
      this.message = '';
      this.bad = false;
    } catch (e) {
      this.control = null;
      this.message = (e && e.message) || '구조 조건 이미지를 읽지 못했습니다';
      this.bad = true;
    }
    this.render();
    return !!this.control;
  },

  /** 사진 한 장을 받아 축소·인코딩해서 들고 있는다. */
  async setFile(file) {
    try {
      this.img = await plannerAiPhotoReadImage(file);
      this.message = '';
      this.bad = false;
      if (this.phase === 'done') { this.phase = 'idle'; this.gen = null; this._dropElevation(); }
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
    const st = this.specTrace();
    const spec = st ? st.spec : null;
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
    this._dropElevation();
    this.message = '도면을 찍는 중…';
    this.render();

    // 2026-10-18 (P5): 도면 렌더를 스스로 찍는다. 입면을 못 찍으면 여기서 멈춘다 — 요청 전이라 크레딧을 안 쓴다.
    // 2026-10-19: 입면 번호는 보내는 design_spec 과 같은 요약에서 — 글과 그림의 번호가 어긋나지 않는다
    const shots = await this.renders(plannerAiPhotoElevationLabels(st.spec, st.trace));
    if (!shots.ok) return this._fail(shots.message);
    this.elevation = shots.elevation;
    if (shots.massingError && shots.massingError !== 'eval' && typeof console !== 'undefined') {
      console.warn('[사진으로 만들기] 3/4 뷰 없이 입면만 보냅니다:', shots.massingError);
    }
    if (shots.labeledError && shots.labeledError !== 'no-labels' && typeof console !== 'undefined') {
      console.warn('[사진으로 만들기] 번호 입면 없이 보냅니다:', shots.labeledError);
    }
    this.message = '생성을 요청하는 중…';
    this.render();

    const provider = this.provider();
    let res;
    try {
      // 계약: design-spec-prompt.md "플래너 모드". realize·engine·control_*·variants 는 싣지 않는다
      //   (워커가 variants 를 false 로 강제한다).
      res = await f(this.api(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          mode: 'planner',
          room_image: this.img.base64,
          image_type: this.img.mime,
          category: spec.category,
          design_spec: spec,
          renders: shots.renders,
          aspect: plannerAiPhotoAspectOf(this.img.width, this.img.height),
          // 2026-10-19: eval=1 이면 고른 값('gemini' | 'openai')을 싣는다. 평소(손님 화면)는 키 없음 → 워커 기본값(GPT)
          ...(provider ? { image_provider: provider } : {}),
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
      await new Promise((r) => setTimeout(r, this.POLL_MS));
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
  window.plannerAiPhotoAspectOf = plannerAiPhotoAspectOf;
  window.plannerAiPhotoVerdict = plannerAiPhotoVerdict;
  window.plannerAiPhotoDrawnBy = plannerAiPhotoDrawnBy;
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
    plannerAiPhotoSpecTrace,
    plannerAiPhotoLayoutOf,
    plannerAiPhotoElevationLabels,
    PLANNER_AI_PHOTO_CEILING_RANGE,
    PLANNER_AI_PHOTO_SMALL_EDGE,
    PLANNER_AI_PHOTO_SMALL_TEXT,
    plannerAiPhotoIsSmallPhoto,
    plannerAiPhotoSpecSummary,
    plannerAiPhotoFitSize,
    plannerAiPhotoFileError,
    plannerAiPhotoReadImage,
    plannerAiPhotoErrorMessage,
    plannerAiPhotoScopeMessage,
    plannerAiPhotoStepLabel,
    plannerAiPhotoIsActive,
    PLANNER_AI_PHOTO_ASPECTS,
    PLANNER_AI_PHOTO_RENDER,
    PLANNER_AI_PHOTO_INTERNAL_LABEL,
    plannerAiPhotoAspectOf,
    plannerAiPhotoAspectLabel,
    plannerAiPhotoBlobToBase64,
    plannerAiPhotoBlobToJpeg,
    plannerAiPhotoVerdict,
    PLANNER_AI_PHOTO_PROVIDER_KEY,
    PLANNER_AI_PHOTO_PROVIDERS,
    plannerAiPhotoDrawnBy,
    PlannerAiPhoto,
  };
}
