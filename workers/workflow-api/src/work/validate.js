/**
 * 작업자 포털 — 입력 검사 (순수). 글자 수 상한은 database/work-jobs.sql 의 CHECK 와 같다.
 * 형식이 틀리면 422 (ValidationError). 사업 규칙(금액 · 기간 · 정원 상한)은 여기서 정하지 않는다.
 */

import { ValidationError } from '../supabase.js';
import { isUuid } from '../reports/record.js';

export const WORK_KINDS = Object.freeze(['install', 'as', 'assembly']);
export const KIND_LABEL = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립' });

/** 경로 · 본문 id — UUID 가 아니면 422 */
export function assertUuid(value, label = 'id') {
  if (!isUuid(value)) throw new ValidationError(`${label} 형식이 올바르지 않습니다`);
  return String(value);
}

/** 선택 글자: 비면 null, 넘치면 422 */
export function optText(value, max, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label} 은(는) 글자여야 합니다`);
  const s = value.trim();
  if (!s) return null;
  if (s.length > max) throw new ValidationError(`${label} 은(는) ${max}자 이하여야 합니다`);
  return s;
}

/** 필수 글자: 비거나 넘치면 422 */
export function reqText(value, max, label) {
  const s = optText(value, max, label);
  if (!s) throw new ValidationError(`${label} 이(가) 필요합니다`);
  return s;
}

/** 선택 시각: 비면 null, ISO 로 해석 못 하면 422 */
export function optIso(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const t = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(t.getTime())) throw new ValidationError(`${label} 시각 형식이 올바르지 않습니다`);
  return t.toISOString();
}

/** 선택 정수 (min 이상): 비면 null */
export function optInt(value, min, label) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new ValidationError(`${label} 은(는) ${min} 이상의 정수여야 합니다`);
  return n;
}

/** 선택 참/거짓: 없으면 fallback, 참/거짓이 아니면 422 */
export function optBool(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new ValidationError(`${label} 은(는) true/false 여야 합니다`);
  return value;
}

/** 선택 UUID: 비면 null */
export function optUuid(value, label) {
  if (value === undefined || value === null || value === '') return null;
  return assertUuid(value, label);
}

/** 목록 중 하나 */
export function oneOf(value, list, label) {
  if (!list.includes(value)) throw new ValidationError(`${label} 은(는) ${list.join(', ')} 중 하나여야 합니다`);
  return value;
}

/** 작업 종류 배열 — 중복 제거, 목록 밖이면 422 */
export function kindsOf(value, label = 'kinds') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${label} 은(는) 배열이어야 합니다`);
  const out = [];
  for (const k of value) {
    oneOf(k, WORK_KINDS, label);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** 휴대폰 — 숫자 · 공백 · + - ( ) 만 (형식만 본다) */
export function optPhone(value) {
  const s = optText(value, 30, '휴대폰');
  if (s && !/^[0-9+\-() ]+$/.test(s)) throw new ValidationError('휴대폰은 숫자와 - 만 적어 주세요');
  return s;
}
