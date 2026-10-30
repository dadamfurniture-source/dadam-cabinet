/**
 * 상담 분배 — 항목 목록 (키 · 한국어 이름) 과 본사 평가표 검사.
 *
 * 평가표(company_evaluations — database/migrations/0018)는 jsonb 칸이라 항목을 더해도 DB 를 바꾸지 않는다.
 * 어떤 키를 받는지는 이 파일이 정한다 — 목록 밖 키는 422.
 *
 * 품목 키는 고객 · 업체 공통: 상담의 furniture_categories 와 같은 키 (consult-notify.js FURNITURE_LABELS 가 정본).
 */

import { ValidationError } from '../supabase.js';
import { FURNITURE_LABELS, SIDO } from '../consult-notify.js';
import { PRICE_TIERS, REQUIRED_DOCS, GRADE_POINTS, LEAD_DAYS_MIN, LEAD_DAYS_MAX } from './rules.js';

const entries = (obj) =>
  Object.freeze(Object.entries(obj).map(([key, name]) => Object.freeze({ key, name })));

/** 설비 — have(있음) | outsource(외주) | none(없음) */
export const EQUIPMENT = Object.freeze({
  table_saw: '테이블쏘',
  cnc_cut: 'CNC 재단',
  edge_bander_body: '엣지밴더(몸통용)',
  edge_bander_door: '엣지밴더(도어용)',
  curved_edge_bander: '곡면 엣지밴딩기',
  special_door_edge_bander: '특수도어 엣지밴딩기',
  boring: '보링',
  nesting: '네스팅',
  conveyor: '컨베이어 시스템',
  packing: '포장기',
  forklift: '지게차',
  panel_lifter: '합판 양중기',
  assembly_space: '조립 · 검수 공간',
});
export const EQUIPMENT_VALUES = Object.freeze(['have', 'outsource', 'none']);

/** 직무별 인원 (정수) */
export const STAFF_ROLES = Object.freeze({
  design: '설계',
  measure: '실측',
  cutting: '재단',
  edge: '엣지',
  assembly: '조립',
  packing: '포장',
  inspection: '검수',
  install: '시공',
  sales: '영업',
  as: 'A/S',
});
export const STAFF_MAX = 999;

/** 마감 · 자재 취급 — yes | no */
export const FINISHES = Object.freeze({
  door_pet: '도어 PET',
  door_highgloss: '도어 하이그로시',
  door_paint: '도어 도장',
  door_veneer: '도어 무늬목',
  door_ceramic: '도어 세라믹',
  body_pb: '몸통 PB',
  body_mdf: '몸통 MDF',
  body_eco: '몸통 친환경 자재',
  hw_domestic: '하드웨어 국산',
  hw_blum: '하드웨어 블룸',
  hw_hettich: '하드웨어 헤티히',
  top_resin: '상판 인조대리석',
  top_ceramic: '상판 세라믹',
  top_engineered: '상판 엔지니어드 스톤',
});
export const FINISH_VALUES = Object.freeze(['yes', 'no']);
/** 마감 · 자재 분야별 메모 — finishes.notes { 분야: 글 } (점수에 쓰지 않는다). 분야 키는 FINISHES 키 앞머리 */
export const FINISH_NOTE_GROUPS = Object.freeze({
  door: '도어',
  body: '몸통',
  hw: '하드웨어',
  top: '상판',
});
export const FINISH_NOTES_KEY = 'notes';
export const FINISH_NOTE_MAX = 500;

/** 설계 — true | false. planner(가구 전문 플래너)는 상담 분배 「상세 설계」 점수가 본다 (score.js designPoints) */
export const DESIGN = Object.freeze({
  hand_drawing: '손도면',
  cad: 'CAD',
  sketchup: '스케치업',
  planner: '가구 전문 플래너',
});

/** 시공 묶음은 평가표에서 뺐다 — 칸(0018 install)은 남고 저장할 때 늘 비운다 */

/** 서류 — 본사 확인 (checked_at · by 는 서버가 찍는다) */
export const DOCS = Object.freeze({
  insurance: '배상 책임 보험',
  contract: '표준 계약서',
});

/** 고객이 고르는 도어 마감 (consultations.door_finish) — 평가표의 마감 키는 'door_' + 값 */
export const DOOR_FINISHES = Object.freeze([
  'pet',
  'highgloss',
  'paint',
  'veneer',
  'ceramic',
  'unknown',
]);
export const DOOR_FINISH_UNKNOWN = 'unknown';
export const doorFinishKey = (v) => `door_${v}`;

/** 품목 키 (고객 · 업체 공통) */
export const ITEM_KEYS = Object.freeze(Object.keys(FURNITURE_LABELS));

/**
 * GET /admin/companies/:id/evaluation 의 catalog — 묶음마다 [{ key, name }].
 * finish_notes 는 마감 · 자재 분야별 메모 칸 (finishes.notes 의 키).
 */
export function evaluationCatalog() {
  return {
    equipment: entries(EQUIPMENT),
    staff_roles: entries(STAFF_ROLES),
    finishes: entries(FINISHES),
    finish_notes: entries(FINISH_NOTE_GROUPS),
    design: entries(DESIGN),
    docs: entries(DOCS),
    grades: Object.keys(GRADE_POINTS),
    price_tiers: [...PRICE_TIERS],
  };
}

/** 평가표 빈 값 (아직 매기지 않은 업체) */
export function emptyEvaluation(companyId) {
  return {
    company_id: companyId,
    grade: null,
    equipment: {},
    staff: {},
    finishes: {},
    design: {},
    install: {},
    price_tier: null,
    docs: {},
    as_months: null,
    warranty_months: null,
    note: null,
    evaluated_at: null,
    evaluated_by: null,
  };
}

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function objectOf(body, field) {
  const v = body[field];
  if (v === undefined || v === null) return {};
  if (!isPlainObject(v)) throw new ValidationError(`${field} 는 객체여야 합니다`, { field });
  return v;
}

/** 서류 확인한 날 — 'YYYY-MM-DD' (있는 날짜) 또는 저장된 ISO 시각 */
function isCheckedAt(v) {
  if (typeof v !== 'string') return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v))
    return new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  return /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
}

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !has(allowed, k));
}

function intOrNull(body, field, min, max) {
  const v = body[field];
  if (v === undefined || v === null || v === '') return null;
  if (!Number.isInteger(v) || v < min || v > max) {
    throw new ValidationError(`${field} 는 ${min}~${max} 정수여야 합니다`, { field });
  }
  return v;
}

/**
 * PUT /admin/companies/:id/evaluation 본문 → 저장할 칸. 목록 밖 키 · 틀린 값은 422 (어느 칸 · 키인지 details).
 * 본문이 다시 정하는 표 전체다 (빠진 칸은 비운다). 위쪽 칸 중 모르는 이름(company_id 등)은 읽지 않는다.
 *   finishes.notes: { door · body · hw · top: 글 } — 마감 · 자재 분야별 메모 (앞뒤 빈칸 지움, 빈 글은 뺀다, 500자까지).
 *   install: 시공 묶음은 뺐다 — 키가 있으면 422, 저장은 늘 {}.
 *   docs: { insurance: { checked_at: 'YYYY-MM-DD' }, contract: … } — 확인한 날. 확인한 사람(by)은 서버가 호출자로 채운다.
 *         날이 저장된 것과 같으면 저장된 기록(by 포함)을 그대로 둔다. true 는 오늘(today) 확인, false · null 은 확인 안 됨.
 */
export function parseEvaluation(body, { existing = null, userId, today }) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');

  const bad = [];
  const equipment = objectOf(body, 'equipment');
  const staff = objectOf(body, 'staff');
  const { [FINISH_NOTES_KEY]: notesIn, ...finishes } = objectOf(body, 'finishes');
  const design = objectOf(body, 'design');
  const install = objectOf(body, 'install');
  const docsIn = objectOf(body, 'docs');

  for (const k of unknownKeys(equipment, EQUIPMENT)) bad.push(`equipment.${k}`);
  for (const k of unknownKeys(staff, STAFF_ROLES)) bad.push(`staff.${k}`);
  for (const k of unknownKeys(finishes, FINISHES)) bad.push(`finishes.${k}`);
  for (const k of unknownKeys(design, DESIGN)) bad.push(`design.${k}`);
  for (const k of Object.keys(install)) bad.push(`install.${k}`);
  const notes = notesIn === undefined || notesIn === null ? {} : notesIn;
  if (!isPlainObject(notes))
    throw new ValidationError('finishes.notes 는 객체여야 합니다', { field: 'finishes.notes' });
  for (const k of unknownKeys(notes, FINISH_NOTE_GROUPS)) bad.push(`finishes.notes.${k}`);
  for (const k of unknownKeys(docsIn, DOCS)) bad.push(`docs.${k}`);
  if (bad.length) throw new ValidationError('평가표 목록에 없는 항목입니다', { unknown_keys: bad });

  const wrong = [];
  for (const [k, v] of Object.entries(equipment))
    if (!EQUIPMENT_VALUES.includes(v)) wrong.push(`equipment.${k}`);
  for (const [k, v] of Object.entries(staff))
    if (!Number.isInteger(v) || v < 0 || v > STAFF_MAX) wrong.push(`staff.${k}`);
  for (const [k, v] of Object.entries(finishes))
    if (!FINISH_VALUES.includes(v)) wrong.push(`finishes.${k}`);
  for (const [k, v] of Object.entries(design))
    if (typeof v !== 'boolean') wrong.push(`design.${k}`);
  const finishNotes = {};
  for (const [k, v] of Object.entries(notes)) {
    const text = typeof v === 'string' ? v.trim() : null;
    if (text === null || text.length > FINISH_NOTE_MAX) wrong.push(`finishes.notes.${k}`);
    else if (text) finishNotes[k] = text;
  }
  const docs = {};
  const before = (existing && isPlainObject(existing.docs) && existing.docs) || {};
  for (const [k, v] of Object.entries(docsIn)) {
    if (v === false || v === null) continue;
    const at = v === true ? today : isPlainObject(v) ? v.checked_at : undefined;
    if (!isCheckedAt(at)) {
      wrong.push(`docs.${k}`);
      continue;
    }
    const prev = before[k];
    docs[k] = isPlainObject(prev) && prev.checked_at === at ? prev : { checked_at: at, by: userId };
  }
  if (wrong.length) throw new ValidationError('평가표 값이 올바르지 않습니다', { invalid: wrong });

  const grade =
    body.grade === undefined || body.grade === null || body.grade === '' ? null : body.grade;
  if (grade !== null && !has(GRADE_POINTS, grade))
    throw new ValidationError('grade 는 S · A · B · C 중 하나여야 합니다', { field: 'grade' });
  const priceTier =
    body.price_tier === undefined || body.price_tier === null || body.price_tier === ''
      ? null
      : body.price_tier;
  if (priceTier !== null && !PRICE_TIERS.includes(priceTier)) {
    throw new ValidationError(`price_tier 는 ${PRICE_TIERS.join(' · ')} 중 하나여야 합니다`, {
      field: 'price_tier',
    });
  }
  let note = body.note === undefined || body.note === null ? null : body.note;
  if (note !== null) {
    if (typeof note !== 'string')
      throw new ValidationError('note 는 글이어야 합니다', { field: 'note' });
    note = note.trim() || null;
    if (note && note.length > 2000)
      throw new ValidationError('note 는 2000자까지입니다', { field: 'note' });
  }

  return {
    grade,
    equipment: { ...equipment },
    staff: { ...staff },
    finishes: Object.keys(finishNotes).length
      ? { ...finishes, [FINISH_NOTES_KEY]: finishNotes }
      : { ...finishes },
    design: { ...design },
    install: {},
    price_tier: priceTier,
    docs,
    as_months: intOrNull(body, 'as_months', 0, 240),
    warranty_months: intOrNull(body, 'warranty_months', 0, 240),
    note,
  };
}

/** 서류 둘 다 본사 확인됨 */
export function docsOk(evaluation) {
  const docs = evaluation && isPlainObject(evaluation.docs) ? evaluation.docs : {};
  return REQUIRED_DOCS.every((k) => isPlainObject(docs[k]) && Boolean(docs[k].checked_at));
}

// ── 업체 상담 설정 (company_service_settings — 업체 대표 · 실장이 고친다) ──────────────

/** 하는 품목 값 — 함 · 외주 · 안 함 */
export const SETTINGS_ITEM_VALUES = Object.freeze(['do', 'outsource', 'no']);
/** 상담 받는 지역 수 상한 (DB company_service_settings_shape_check 와 같다) */
export const REGIONS_MAX = 300;
/** 한 달 한도 상한 (DB company_service_settings_limit_check 와 같다) */
export const MONTHLY_LIMIT_MAX = 1000;
/** 시/군/구 모양 (consult-notify.js 와 같다 — 목록 값은 한글 한 낱말 + 시 · 군 · 구) */
const GUGUN_RE = /^[가-힣]{1,10}(?:시|군|구)$/;

/** 아직 설정하지 않은 업체 */
export function emptySettings() {
  return {
    regions: [],
    items: {},
    monthly_limit: null,
    lead_days: null,
    updated_at: null,
  };
}

/**
 * PUT /company/service-settings 본문 → 저장할 칸. 본문이 다시 정하는 설정 전체다 (빠진 칸은 비운다).
 *   regions              [{ sido, gugun }] — 시/도 목록 · 시/군/구 모양만, 같은 곳은 한 번. 비우면 업체 주소의 시/군/구 하나로 본다
 *   items                { 품목 키: do | outsource | no } — 목록 밖 품목은 422
 *   monthly_limit        0~1000 정수 또는 null (null 이면 배정받지 않는다 — rules.js REQUIRE_MONTHLY_LIMIT)
 *   lead_days            고객 확정 ~ 시공 완료 기간(최소 제작 기간) 1~14 정수 또는 null (null 이면 배정받지 않는다 — rules.js REQUIRE_LEAD_DAYS)
 */
export function parseServiceSettings(body) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const rawRegions = body.regions === undefined || body.regions === null ? [] : body.regions;
  if (!Array.isArray(rawRegions))
    throw new ValidationError('regions 는 배열이어야 합니다', { field: 'regions' });
  if (rawRegions.length > REGIONS_MAX)
    throw new ValidationError(`regions 는 ${REGIONS_MAX}곳까지입니다`, { field: 'regions' });
  const regions = [];
  const seen = new Set();
  const badRegions = [];
  rawRegions.forEach((r, i) => {
    if (
      !isPlainObject(r) ||
      !SIDO.includes(r.sido) ||
      typeof r.gugun !== 'string' ||
      !GUGUN_RE.test(r.gugun)
    ) {
      badRegions.push(i);
      return;
    }
    const key = `${r.sido}|${r.gugun}`;
    if (seen.has(key)) return;
    seen.add(key);
    regions.push({ sido: r.sido, gugun: r.gugun });
  });
  if (badRegions.length)
    throw new ValidationError('지역 값이 올바르지 않습니다', { invalid_regions: badRegions });

  const items = objectOf(body, 'items');
  const unknown = Object.keys(items).filter((k) => !ITEM_KEYS.includes(k));
  if (unknown.length)
    throw new ValidationError('품목 목록에 없는 항목입니다', {
      unknown_keys: unknown.map((k) => `items.${k}`),
    });
  const wrong = Object.entries(items)
    .filter(([, v]) => !SETTINGS_ITEM_VALUES.includes(v))
    .map(([k]) => `items.${k}`);
  if (wrong.length)
    throw new ValidationError('품목 값은 do · outsource · no 중 하나여야 합니다', {
      invalid: wrong,
    });

  return {
    regions,
    items: { ...items },
    monthly_limit: intOrNull(body, 'monthly_limit', 0, MONTHLY_LIMIT_MAX),
    lead_days: intOrNull(body, 'lead_days', LEAD_DAYS_MIN, LEAD_DAYS_MAX),
  };
}
