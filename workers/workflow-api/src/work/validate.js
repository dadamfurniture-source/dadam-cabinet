/**
 * 작업자 포털 — 입력 검사 (순수). 글자 수 상한은 database/work-jobs.sql 의 CHECK 와 같다.
 * 형식이 틀리면 422 (ValidationError). 사업 규칙(금액 · 기간 · 정원 상한)은 여기서 정하지 않는다.
 */

import { ConflictError, ValidationError } from '../supabase.js';
import { isUuid } from '../reports/record.js';

/**
 * 작업 종류 — work_jobs.kind. 2026-11-13 사장님 결정으로 여섯 (DB 0065): 설치 · A/S · 조립 + 재단 · 엣지 · 철거.
 * 0065 적용 전의 DB 는 앞의 셋만 받는다 — 새 종류로 쓰면 DB 가 거절하고, 부르는 쪽이 409 db_pending 으로 돌린다 (kindsPending).
 * 2026-11-14 사장님 결정으로 일곱 (DB 0066): + 납품 — 설치 · A/S 표의 「납품」 일정 줄에도 작업자를 배정한다 (설치 작업자와 가른다).
 */
export const WORK_KINDS = Object.freeze(['install', 'as', 'assembly', 'cutting', 'edge', 'demolition', 'delivery']);
/** 작업자 종류 — workers.kinds · worker_invites.kinds_preset · worker_companies.kinds. 작업 종류와 같은 일곱 */
export const WORKER_KINDS = WORK_KINDS;
export const KIND_LABEL = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립', cutting: '재단', edge: '엣지', demolition: '철거', delivery: '납품' });
/** 프로젝트 「작업 배정」의 종류 줄 차례 — 일하는 차례 (납품 · 설치 · A/S 는 일정 줄에서 온다) */
export const PROJECT_KINDS = Object.freeze(['demolition', 'cutting', 'edge', 'assembly']);

/**
 * DB 가 새 종류 · 새 칸을 아직 모른다 (0065 · 0066 적용 전) → 409 db_pending. 그 밖의 오류는 그대로 던진다.
 * 종류 제약(23514) · 없는 칸(42703 · PGRST204) 을 본다.
 */
export function kindsPending(e) {
  const text = String((e && e.message) || '');
  if (!/23514|42703|PGRST204/.test(text)) return e;
  const err = new ConflictError('DB 적용 전입니다 — 새 작업 종류(철거 · 재단 · 엣지는 0065, 납품은 0066)와 프로젝트 작업 배정은 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}

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

/** 작업자 종류 배열 — 중복 제거, 목록 밖이면 422 */
export function kindsOf(value, label = 'kinds') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${label} 은(는) 배열이어야 합니다`);
  const out = [];
  for (const k of value) {
    oneOf(k, WORKER_KINDS, label);
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
