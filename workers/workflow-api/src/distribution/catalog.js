/**
 * 상담 분배 — 항목 목록 (키 · 한국어 이름) 과 본사 평가표 검사.
 *
 * 평가표(company_evaluations — database/migrations/0018)는 jsonb 칸이라 항목을 더해도 DB 를 바꾸지 않는다.
 * 어떤 키를 받는지는 이 파일이 정한다 — 목록 밖 키는 422.
 *
 * 품목 키는 고객 · 업체 공통: 상담의 furniture_categories 와 같은 키 (consult-notify.js FURNITURE_LABELS 가 정본).
 */

import { ValidationError } from '../supabase.js';
import { FURNITURE_LABELS } from '../consult-notify.js';
import { PRICE_TIERS, REQUIRED_DOCS, GRADE_POINTS } from './rules.js';

const entries = (obj) =>
  Object.freeze(Object.entries(obj).map(([key, name]) => Object.freeze({ key, name })));

/** 설비 — have(있음) | outsource(외주) | none(없음) */
export const EQUIPMENT = Object.freeze({
  panel_saw: '패널쏘',
  cnc_cut: 'CNC 재단',
  edge_bander: '엣지밴더',
  curved_edge_bander: '곡면 엣지밴딩기',
  special_door_edge_bander: '특수도어 엣지밴딩기',
  boring: '보링',
  cnc_router: 'CNC 가공',
  nesting: '네스팅',
  conveyor: '컨베이어 시스템',
  packing: '포장기',
  forklift: '지게차',
  panel_lifter: '합판 양중기',
  assembly_space: '조립 · 검수 공간',
  install_vehicle: '시공 차량',
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

/** 설계 — true | false */
export const DESIGN = Object.freeze({
  measure: '실측',
  drawing_2d: '도면',
  planner: '플래너',
  render_3d: '3D',
});

/** 시공 — true | false, 그리고 경력 연수(INSTALL_YEARS_KEY, 정수) */
export const INSTALL = Object.freeze({
  demolition: '철거',
  utility_connect: '설비 연결',
  high_floor: '높은 층 운반',
});
export const INSTALL_YEARS_KEY = 'install_years';
export const INSTALL_YEARS_NAME = '시공 경력(년)';
export const INSTALL_YEARS_MAX = 100;

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
 * 앱 연출컷 품목(generations.category) 중 품목 키와 이름이 같은 것 — 앱 상담은 furniture_categories 를 넣지 않아
 * 연출컷 품목을 고객 품목으로 쓴다 (consult-notify.js APP_KIND_LABELS · FURNITURE_LABELS 의 같은 이름).
 * 이름이 다른 앱 품목(사무실 · 서재 · 침실)은 품목 키가 없다.
 */
export const APP_KIND_TO_ITEM = Object.freeze({
  sink: 'sink',
  island: 'island',
  wardrobe: 'wardrobe',
  storage: 'storage',
  fridge: 'fridge',
  vanity: 'vanity',
  shoe: 'shoerack',
});

/** GET /admin/companies/:id/evaluation 의 catalog */
export function evaluationCatalog() {
  return {
    equipment: entries(EQUIPMENT),
    staff_roles: entries(STAFF_ROLES),
    finishes: entries(FINISHES),
    design: entries(DESIGN),
    install: [
      ...entries(INSTALL),
      { key: INSTALL_YEARS_KEY, name: INSTALL_YEARS_NAME, type: 'number' },
    ],
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
 *   docs: { insurance: true|false, contract: … } — true 면 본사 확인. 이미 확인된 서류는 처음 확인 기록을 그대로 둔다.
 *         GET 이 돌려준 모양({ checked_at, by })을 그대로 보내도 확인으로 본다.
 */
export function parseEvaluation(body, { existing = null, userId, nowIso }) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');

  const bad = [];
  const equipment = objectOf(body, 'equipment');
  const staff = objectOf(body, 'staff');
  const finishes = objectOf(body, 'finishes');
  const design = objectOf(body, 'design');
  const install = objectOf(body, 'install');
  const docsIn = objectOf(body, 'docs');

  for (const k of unknownKeys(equipment, EQUIPMENT)) bad.push(`equipment.${k}`);
  for (const k of unknownKeys(staff, STAFF_ROLES)) bad.push(`staff.${k}`);
  for (const k of unknownKeys(finishes, FINISHES)) bad.push(`finishes.${k}`);
  for (const k of unknownKeys(design, DESIGN)) bad.push(`design.${k}`);
  for (const k of Object.keys(install))
    if (!has(INSTALL, k) && k !== INSTALL_YEARS_KEY) bad.push(`install.${k}`);
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
  for (const [k, v] of Object.entries(install)) {
    if (k === INSTALL_YEARS_KEY) {
      if (v !== null && (!Number.isInteger(v) || v < 0 || v > INSTALL_YEARS_MAX))
        wrong.push(`install.${k}`);
    } else if (typeof v !== 'boolean') {
      wrong.push(`install.${k}`);
    }
  }
  const docs = {};
  const before = (existing && isPlainObject(existing.docs) && existing.docs) || {};
  for (const [k, v] of Object.entries(docsIn)) {
    const checked =
      v === true || (isPlainObject(v) && typeof v.checked_at === 'string' && v.checked_at);
    if (v !== false && v !== null && !checked) {
      wrong.push(`docs.${k}`);
      continue;
    }
    if (!checked) continue;
    const prev = before[k];
    docs[k] = isPlainObject(prev) && prev.checked_at ? prev : { checked_at: nowIso, by: userId };
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
    finishes: { ...finishes },
    design: { ...design },
    install: { ...install },
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
