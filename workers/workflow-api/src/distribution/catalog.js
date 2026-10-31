/**
 * 상담 분배 — 항목 목록 (키 · 한국어 이름) 과 본사 평가표 검사.
 *
 * 평가표(company_evaluations — database/migrations/0018 · 0022)는 jsonb 칸이라 항목을 더해도 DB 를 바꾸지 않는다.
 * 어떤 키를 받는지는 이 파일이 정한다 — 목록 밖 키는 422.
 *
 * 품목 키는 고객 · 업체 공통: 상담의 furniture_categories 와 같은 키 (consult-notify.js FURNITURE_LABELS 가 정본).
 */

import { ValidationError } from '../supabase.js';
import { FURNITURE_LABELS, SIDO } from '../consult-notify.js';
import {
  PRICE_TIERS,
  REQUIRED_DOCS,
  GRADE_POINTS,
  LEAD_DAYS_MIN,
  LEAD_DAYS_MAX,
  EVAL_WEIGHTS,
} from './rules.js';

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

/** 직무별 인원 (정수) — 한 사람이 여러 일을 하면(겸직) 직무마다 센다 */
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
/** 전체 인원 (실제 사람 수) — staff.total. 점수는 직무별 인원만 본다 (grade.js · score.js) */
export const STAFF_TOTAL_KEY = 'total';
export const STAFF_TOTAL = Object.freeze({ [STAFF_TOTAL_KEY]: '전체 인원 (실제 사람 수)' });

/**
 * 마감 · 자재 — 분야(도어 · 몸통 · 하드웨어 · 상판)마다 거래하는 회사와 주력 (등급 · 상담 분배 점수에 쓰지 않는다 —
 * 우선순위를 정하면 그때 차등을 둔다, 대표 확인 2026-10-31).
 *   finishes: { door: [{ key: 'cratech', main: true }, { name: '직접 적은 회사', main: false }], …, notes: { door: '…' } }
 *   key 는 SUPPLIERS[분야] 의 키, 목록에 없는 회사는 name(글)으로 직접 적는다. main 은 주력.
 *   분야마다 SUPPLIER_ROWS_MAX 줄까지, 같은 회사(같은 key · 같은 name)는 한 번만.
 */
export const SUPPLIER_GROUPS = Object.freeze({
  door: '도어',
  body: '몸통',
  hw: '하드웨어',
  top: '상판',
});
export const SUPPLIER_ROWS_MAX = 20;
export const SUPPLIER_NAME_MAX = 50;

const supplier = (name, kind) => Object.freeze({ name, kind });
/**
 * 거래 회사 목록 — kind 는 화면에 보이는 짧은 설명. 도어는 만드는 마감으로, 2026-10-31 조사에서 본 것만 적었다
 * (안 적힌 마감도 만들 수 있다). 회사를 더하거나 고칠 때는 키를 바꾸지 않는다 (평가표에 키로 남는다).
 */
export const SUPPLIERS = Object.freeze({
  door: Object.freeze({
    hansol_homedeco: supplier('한솔홈데코(스토리보드)', 'PET · LPM · PP'),
    yerim: supplier('예림(예림보드 럭스)', 'PET · 도장(UV) · 아크릴 · PP · 유리'),
    dongwha: supplier('동화기업(디하임 도어)', '아크릴 계열(ACP) · LPM · 멜라민'),
    lx_zin: supplier('LX하우시스(Z:IN 보르떼)', 'PET'),
    unid_btplus: supplier(
      '유니드비티플러스(GLOSSPAN · ECOPAN)',
      'PET · 하이그로시 · 도장(UV) · LPM'
    ),
    cratech: supplier('크라텍', 'PET · 하이그로시 · 도장(UV)'),
    moklim_sangsa: supplier('목림상사(썬에타쉬)', 'PET · 도장(UV) · LPM · PP'),
    kobiko: supplier('코비코', 'PET · 하이그로시 · 도장(UV)'),
    homegreen: supplier('홈그린', 'PET · 도장 · 무늬목 · LPM'),
    certi: supplier('체르티(체르티도어)', '도장 · 무늬목 · 원목 · 유리'),
    dots: supplier('더 닷츠(닷츠도어)', 'PET · 도장'),
    daon: supplier('다온가구', 'PET · 하이그로시'),
    modern_ds: supplier('모던디에스(리도어홈즈)', 'PET · 아크릴 계열(PMMA)'),
    doorbank: supplier('도어뱅크', 'PET'),
    board48: supplier('보드48', 'PET'),
    jeil_diy: supplier('제일DIY', 'PET · 하이그로시'),
    leader_tnd: supplier('리더티앤디', 'PET · 도장(분체) · LPM · HPM'),
    inmok: supplier('인목', '도장 · 무늬목'),
    hyundai_living: supplier('현대리빙디자인(3B 도어)', 'PET · 하이그로시'),
    lx_lonchel: supplier('LX하우시스(론첼 ARKO 도어)', '수입 도어'),
  }),
  body: Object.freeze({
    dongwha: supplier('동화기업', 'PB · MDF · 멜라민 보드 · 내수 보드'),
    sungchang: supplier('성창보드', 'PB (E0)'),
    unid_btplus: supplier('유니드비티플러스', 'MDF'),
    hansol_homedeco: supplier('한솔홈데코', 'MDF · LPM · PET 표면보드'),
    foresco: supplier('포레스코', 'MDF · 방염 MDF · 컬러 MDF'),
    moklim: supplier('(주)목림(멜라보드)', 'LPM · 멜라민 보드'),
    hanwha_with: supplier('(주)한화위드(Ottimo)', '멜라민 보드(MFB)'),
    printech: supplier('(주)프린테크엘피엠', 'LPM · 멜라민 보드'),
    yerim: supplier('예림', '멜라민 보드(MFB)'),
    gyeongbuk_plywood: supplier('(주)경북합판', '합판 · 적층판 (대구)'),
  }),
  hw: Object.freeze({
    blum: supplier('블룸 Blum', '해외 · 경첩 · 레일 · 서랍 · 리프트'),
    hettich: supplier('헤티히 Hettich', '해외 · 경첩 · 레일 · 서랍 · 슬라이딩'),
    grass: supplier('그라스 Grass', '해외 · 경첩 · 레일 · 서랍 · 리프트'),
    salice: supplier('살리체 Salice', '해외 · 경첩 · 레일 · 리프트 · 슬라이딩'),
    hafele: supplier('헤펠레 Häfele', '해외 · 경첩 · 서랍 · 리프트 · 슬라이딩 · 손잡이 · 조명'),
    kesseboehmer: supplier('케세보머 Kesseböhmer', '해외 · 팬트리 · 코너장 · 인출'),
    sugatsune: supplier('스가츠네 Sugatsune', '해외 · 경첩 · 레일 · 플랩 스테이 · 손잡이'),
    fgv: supplier('FGV', '해외 · 경첩 · 서랍 · 레일 · 슬라이딩'),
    king_slide: supplier('킹슬라이드 King Slide', '해외 · 레일 · 경첩'),
    dtc: supplier('DTC', '해외 · 경첩 · 레일 · 서랍 · 리프트'),
    hawa: supplier('하바 Hawa', '해외 · 슬라이딩 도어 장치'),
    irex: supplier('삼성정밀공업(IREX)', '국산 · 경첩 · 댐퍼 · 서랍 · 레일 · 가스 스프링'),
    moonju: supplier('문주하드웨어', '국산 · 경첩 · 댐퍼 · 서랍 · 레일'),
    seil: supplier('세일하드웨어', '국산 · 경첩 · 레일 · 서랍'),
    jeonhan: supplier('전한슬라이드', '국산 · 레일'),
    the_mj: supplier('더엠제이', '국산 · 팬트리 · 인출망 · 코너 · 붙박이장 인출'),
    kofa: supplier('코파(MICHELLAN)', '국산 · 슬라이딩 도어 장치'),
    hansan_gs: supplier('한산지에스', '국산 · 리프트업 · 가스 스프링 · 댐퍼'),
    kgs: supplier('케이지에스(KOREA GAS SPRING)', '국산 · 가스 스프링'),
    gns_korea: supplier('지앤에스코리아', '국산 · 가스 스프링'),
    haatz: supplier('하츠 HAATZ', '국산 · 리프트업 · 주방 수납'),
    ilkwang: supplier('일광산업(AURORA)', '국산 · 수납 액세서리 · 가구 조명'),
  }),
  top: Object.freeze({
    lx_himacs: supplier('LX하우시스 하이막스', '인조대리석'),
    hanex: supplier('현대L&C 하넥스', '인조대리석'),
    staron: supplier('롯데케미칼 스타론', '인조대리석'),
    kcc_sensestone_plus: supplier('KCC글라스 센스톤 플러스', '인조대리석'),
    corian: supplier('듀폰 코리안', '인조대리석'),
    tristone: supplier('라이온켐텍 트라이스톤', '인조대리석'),
    brown_upe: supplier('브라운스톤 브라운 UPE', '인조대리석'),
    viatera: supplier('LX하우시스 비아테라', '엔지니어드 스톤'),
    kanstone: supplier('현대L&C 칸스톤', '엔지니어드 스톤'),
    miraton: supplier('현대L&C 미라톤', '엔지니어드 스톤'),
    radianz: supplier('롯데케미칼 래디언스', '엔지니어드 스톤'),
    kcc_sensestone_quartz: supplier('KCC글라스 센스톤 쿼츠', '엔지니어드 스톤'),
    kalrion: supplier('브라운스톤 칼리온', '엔지니어드 스톤'),
    silestone: supplier('코센티노 실레스톤', '엔지니어드 스톤'),
    caesarstone: supplier('시저스톤', '엔지니어드 스톤'),
    teracanto: supplier('LX하우시스 테라칸토', '세라믹'),
    ceraton: supplier('현대L&C 세라톤', '세라믹'),
    locelain: supplier('롯데케미칼 로셀린', '세라믹'),
    kcc_sensestone_ultra: supplier('KCC글라스 센스톤 울트라', '세라믹'),
    dekton: supplier('코센티노 덱톤', '세라믹'),
    neolith: supplier('네오리스', '세라믹'),
    laminam: supplier('라미남', '세라믹'),
    inalco: supplier('이날코', '세라믹'),
    atlas_plan: supplier('아틀라스플랜', '세라믹'),
    florim: supplier('플로림', '세라믹'),
  }),
});

/** 마감 · 자재 분야별 메모 — finishes.notes { 분야: 글 } (점수에 쓰지 않는다). 분야 키는 SUPPLIER_GROUPS 와 같다 */
export const FINISH_NOTE_GROUPS = SUPPLIER_GROUPS;
export const FINISH_NOTES_KEY = 'notes';
export const FINISH_NOTE_MAX = 500;

/** 본사 소통 — hq_comm { score } (0022). 지금은 본사가 0 ~ 배율(EVAL_WEIGHTS.hq_comm) 정수로 직접 넣는다 */
export const HQ_COMM_MAX = EVAL_WEIGHTS.hq_comm;

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

/** 품목 키 (고객 · 업체 공통) */
export const ITEM_KEYS = Object.freeze(Object.keys(FURNITURE_LABELS));

/**
 * GET /admin/companies/:id/evaluation 의 catalog — 묶음마다 [{ key, name }].
 * finish_notes 는 마감 · 자재 분야별 메모 칸 (finishes.notes 의 키). staff_total 은 전체 인원 칸 (staff.total).
 * suppliers 는 마감 · 자재 분야마다 [{ key, name, companies: [{ key, name, kind }] }], limits 는 입력 한도.
 */
export function evaluationCatalog() {
  return {
    equipment: entries(EQUIPMENT),
    staff_roles: entries(STAFF_ROLES),
    staff_total: entries(STAFF_TOTAL),
    suppliers: Object.entries(SUPPLIER_GROUPS).map(([key, name]) => ({
      key,
      name,
      companies: Object.entries(SUPPLIERS[key]).map(([k, s]) => ({
        key: k,
        name: s.name,
        kind: s.kind,
      })),
    })),
    finish_notes: entries(FINISH_NOTE_GROUPS),
    design: entries(DESIGN),
    docs: entries(DOCS),
    grades: Object.keys(GRADE_POINTS),
    price_tiers: [...PRICE_TIERS],
    limits: {
      supplier_rows: SUPPLIER_ROWS_MAX,
      supplier_name: SUPPLIER_NAME_MAX,
      finish_note: FINISH_NOTE_MAX,
      hq_comm: HQ_COMM_MAX,
    },
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
    hq_comm: {},
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

/** 본사 소통 칸 (hq_comm) — 지금은 점수 하나 */
const HQ_COMM_FIELDS = Object.freeze({ score: '본사 소통 점수' });

/**
 * 마감 · 자재 한 분야의 줄 → 저장할 줄 [{ key, main } | { name, main }].
 * 목록 밖 회사 키는 bad(finishes.<분야>.<키>), 모양 · 글자 수 · 같은 회사 두 번은 wrong(finishes.<분야>.<차례>).
 */
function supplierRows(group, rows, bad, wrong) {
  if (rows === undefined || rows === null) return [];
  if (!Array.isArray(rows) || rows.length > SUPPLIER_ROWS_MAX) {
    wrong.push(`finishes.${group}`);
    return [];
  }
  const out = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    const at = `finishes.${group}.${i}`;
    const shapeOk =
      isPlainObject(r) &&
      Object.keys(r).every((k) => k === 'key' || k === 'name' || k === 'main') &&
      (r.main === undefined || typeof r.main === 'boolean') &&
      (r.key === undefined) !== (r.name === undefined);
    if (!shapeOk) {
      wrong.push(at);
      return;
    }
    let row;
    if (r.key !== undefined) {
      if (typeof r.key !== 'string') {
        wrong.push(at);
        return;
      }
      if (!has(SUPPLIERS[group], r.key)) {
        bad.push(`finishes.${group}.${r.key}`);
        return;
      }
      row = { key: r.key, main: r.main === true };
    } else {
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      if (!name || name.length > SUPPLIER_NAME_MAX) {
        wrong.push(at);
        return;
      }
      row = { name, main: r.main === true };
    }
    const id = row.key !== undefined ? `key:${row.key}` : `name:${row.name}`;
    if (seen.has(id)) {
      wrong.push(at);
      return;
    }
    seen.add(id);
    out.push(row);
  });
  return out;
}

/**
 * PUT /admin/companies/:id/evaluation 본문 → 저장할 칸. 목록 밖 키 · 틀린 값은 422 (어느 칸 · 키인지 details).
 * 본문이 다시 정하는 표 전체다 (빠진 칸은 비운다). 위쪽 칸 중 모르는 이름(company_id 등)은 읽지 않는다.
 *   staff.total: 전체 인원 (실제 사람 수, 0~999 정수). 직무별 인원은 겸직이면 직무마다 센다.
 *   finishes: { door · body · hw · top: [{ key, main } | { name, main }] } — 분야마다 거래 회사 (SUPPLIERS 키 또는
 *            직접 적은 이름 50자까지, 주력 main). 분야마다 20줄까지, 같은 회사는 한 번. 빈 분야는 뺀다.
 *   finishes.notes: { door · body · hw · top: 글 } — 마감 · 자재 분야별 메모 (앞뒤 빈칸 지움, 빈 글은 뺀다, 500자까지).
 *   hq_comm: { score } — 본사 소통 점수 0 ~ HQ_COMM_MAX 정수. 비우면 {} (0점).
 *   install: 시공 묶음은 뺐다 — 키가 있으면 422, 저장은 늘 {}.
 *   grade: 받지 않는다 — 저장할 때 서버가 평가표 점수로 매긴다 (grade.js · admin.js putCompanyEvaluation).
 *   docs: { insurance: { checked_at: 'YYYY-MM-DD' }, contract: … } — 확인한 날. 확인한 사람(by)은 서버가 호출자로 채운다.
 *         날이 저장된 것과 같으면 저장된 기록(by 포함)을 그대로 둔다. true 는 오늘(today) 확인, false · null 은 확인 안 됨.
 */
export function parseEvaluation(body, { existing = null, userId, today }) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');

  const bad = [];
  const wrong = [];
  const equipment = objectOf(body, 'equipment');
  const { [STAFF_TOTAL_KEY]: totalIn, ...staff } = objectOf(body, 'staff');
  const { [FINISH_NOTES_KEY]: notesIn, ...groupsIn } = objectOf(body, 'finishes');
  const design = objectOf(body, 'design');
  const install = objectOf(body, 'install');
  const hqIn = objectOf(body, 'hq_comm');
  const docsIn = objectOf(body, 'docs');

  for (const k of unknownKeys(equipment, EQUIPMENT)) bad.push(`equipment.${k}`);
  for (const k of unknownKeys(staff, STAFF_ROLES)) bad.push(`staff.${k}`);
  for (const k of unknownKeys(groupsIn, SUPPLIER_GROUPS)) bad.push(`finishes.${k}`);
  const suppliers = {};
  for (const g of Object.keys(SUPPLIER_GROUPS)) {
    const rows = supplierRows(g, groupsIn[g], bad, wrong);
    if (rows.length) suppliers[g] = rows;
  }
  for (const k of unknownKeys(design, DESIGN)) bad.push(`design.${k}`);
  for (const k of Object.keys(install)) bad.push(`install.${k}`);
  const notes = notesIn === undefined || notesIn === null ? {} : notesIn;
  if (!isPlainObject(notes))
    throw new ValidationError('finishes.notes 는 객체여야 합니다', { field: 'finishes.notes' });
  for (const k of unknownKeys(notes, FINISH_NOTE_GROUPS)) bad.push(`finishes.notes.${k}`);
  for (const k of unknownKeys(hqIn, HQ_COMM_FIELDS)) bad.push(`hq_comm.${k}`);
  for (const k of unknownKeys(docsIn, DOCS)) bad.push(`docs.${k}`);
  if (bad.length) throw new ValidationError('평가표 목록에 없는 항목입니다', { unknown_keys: bad });

  for (const [k, v] of Object.entries(equipment))
    if (!EQUIPMENT_VALUES.includes(v)) wrong.push(`equipment.${k}`);
  for (const [k, v] of Object.entries(staff))
    if (!Number.isInteger(v) || v < 0 || v > STAFF_MAX) wrong.push(`staff.${k}`);
  const total = totalIn === undefined || totalIn === null || totalIn === '' ? null : totalIn;
  if (total !== null && (!Number.isInteger(total) || total < 0 || total > STAFF_MAX))
    wrong.push(`staff.${STAFF_TOTAL_KEY}`);
  for (const [k, v] of Object.entries(design))
    if (typeof v !== 'boolean') wrong.push(`design.${k}`);
  const finishNotes = {};
  for (const [k, v] of Object.entries(notes)) {
    const text = typeof v === 'string' ? v.trim() : null;
    if (text === null || text.length > FINISH_NOTE_MAX) wrong.push(`finishes.notes.${k}`);
    else if (text) finishNotes[k] = text;
  }
  const hqScore =
    hqIn.score === undefined || hqIn.score === null || hqIn.score === '' ? null : hqIn.score;
  if (hqScore !== null && (!Number.isInteger(hqScore) || hqScore < 0 || hqScore > HQ_COMM_MAX))
    wrong.push('hq_comm.score');
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
    equipment: { ...equipment },
    staff: total === null ? { ...staff } : { ...staff, [STAFF_TOTAL_KEY]: total },
    finishes: Object.keys(finishNotes).length
      ? { ...suppliers, [FINISH_NOTES_KEY]: finishNotes }
      : { ...suppliers },
    design: { ...design },
    install: {},
    hq_comm: hqScore === null ? {} : { score: hqScore },
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
