/**
 * 본사 등급 — 평가표 영역별 점수를 더해(100점) S · A · B · C 를 매긴다. 숫자는 rules.js (EVAL_WEIGHTS · GRADE_CUTS).
 *
 *   설비          항목마다 있음 1 · 외주 0.5 · 없음 0 → 합 ÷ 항목 수 × 배율
 *   인력          1명 이상인 직무 수 ÷ 직무 수 × 배율
 *   마감 · 자재    「취급함」 수 ÷ 항목 수 × 배율 (분야별 메모는 셈에 넣지 않는다)
 *   설계          가진 것 합 (DESIGN_SCORE — 최대가 배율)
 *   품질 · 서비스  A/S 기간 · 하자 보증 기간 각각 SERVICE_MONTH_SCORE
 *   신뢰 · 서류    확인한 서류마다 DOC_SCORE
 *   가격대는 넣지 않는다 — 고객 가격대와 맞추는 데만 쓴다.
 *
 * 영역 점수는 소수 첫째 자리로 맞추고, 합은 그 영역 점수를 더한 값 — 화면의 숫자가 그대로 맞아떨어진다.
 * 저장할 때 서버가 매긴다 (admin.js putCompanyEvaluation) — 손으로 고르지 않는다.
 */

import * as R from './rules.js';
import { EQUIPMENT, STAFF_ROLES, FINISHES, DOCS } from './catalog.js';

const r1 = (v) => Math.round(v * 10) / 10;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

/** 영역 이름 (화면이 그대로 쓴다) — EVAL_WEIGHTS 와 같은 차례 */
export const EVAL_AREAS = Object.freeze({
  equipment: '설비',
  staff: '인력',
  finishes: '마감 · 자재',
  design: '설계',
  quality: '품질 · 서비스',
  docs: '신뢰 · 서류',
});

/** 개월 → 점수 (없음 · 0 · 틀린 값 0) */
function monthsScore(m) {
  if (!Number.isInteger(m)) return 0;
  const hit = R.SERVICE_MONTH_SCORE.find(([min]) => m >= min);
  return hit ? hit[1] : 0;
}

/** 영역별 0~1 이 아닌 「배율 안의 점수」 (반올림 전) */
function rawAreas(ev) {
  const eq = isObj(ev.equipment) ? ev.equipment : {};
  const st = isObj(ev.staff) ? ev.staff : {};
  const fi = isObj(ev.finishes) ? ev.finishes : {};
  const ds = isObj(ev.design) ? ev.design : {};
  const dc = isObj(ev.docs) ? ev.docs : {};
  const W = R.EVAL_WEIGHTS;

  const eqKeys = Object.keys(EQUIPMENT);
  const eqSum = eqKeys.reduce(
    (s, k) => s + (own(R.EQUIPMENT_SCORE, eq[k]) ? R.EQUIPMENT_SCORE[eq[k]] : 0),
    0
  );
  const roles = Object.keys(STAFF_ROLES);
  const filled = roles.filter((k) => Number.isInteger(st[k]) && st[k] >= 1).length;
  const finishKeys = Object.keys(FINISHES);
  const handled = finishKeys.filter((k) => fi[k] === 'yes').length;
  const design = Object.keys(R.DESIGN_SCORE).reduce(
    (s, k) => s + (ds[k] === true ? R.DESIGN_SCORE[k] : 0),
    0
  );
  const quality = monthsScore(ev.as_months) + monthsScore(ev.warranty_months);
  const docs = Object.keys(DOCS).filter((k) => isObj(dc[k]) && Boolean(dc[k].checked_at)).length;

  return {
    equipment: (eqSum / eqKeys.length) * W.equipment,
    staff: (filled / roles.length) * W.staff,
    finishes: (handled / finishKeys.length) * W.finishes,
    design: Math.min(design, W.design),
    quality: Math.min(quality, W.quality),
    docs: Math.min(docs * R.DOC_SCORE, W.docs),
  };
}

/** 합 → 등급 (GRADE_CUTS 위에서부터 처음 닿는 것) */
export function gradeOf(total) {
  const hit = R.GRADE_CUTS.find(([, min]) => total >= min);
  return hit ? hit[0] : R.GRADE_CUTS[R.GRADE_CUTS.length - 1][0];
}

/**
 * 평가표 → { areas: [{ key, name, points, max }], total, max, grade }
 *   points · total 은 소수 첫째 자리. 빈 평가표는 0점 C.
 */
export function evaluationScore(evaluation) {
  const ev = isObj(evaluation) ? evaluation : {};
  const raw = rawAreas(ev);
  const areas = Object.keys(EVAL_AREAS).map((key) => ({
    key,
    name: EVAL_AREAS[key],
    points: r1(raw[key]),
    max: R.EVAL_WEIGHTS[key],
  }));
  const total = r1(areas.reduce((s, a) => s + a.points, 0));
  const max = Object.values(R.EVAL_WEIGHTS).reduce((s, v) => s + v, 0);
  return { areas, total, max, grade: gradeOf(total) };
}
