/**
 * 회계장부 — 정해진 검사 (순수 함수). 값 목록은 DB 제약과 같다 (database/migrations/0027_ledger_core.sql).
 */
import { ValidationError } from '../supabase.js';

export const DIRECTIONS = Object.freeze(['income', 'expense', 'asset_buy', 'asset_sell']);
/** 세금계산서 · 계산서 · 카드 · 현금영수증 · 간이영수증 · 거래명세표 · 기타 · 없음 */
export const EVIDENCE_TYPES = Object.freeze(['tax_invoice', 'invoice', 'card', 'cash_receipt', 'simple_receipt', 'statement', 'other', 'none']);
export const PAYMENT_METHODS = Object.freeze(['transfer', 'card', 'cash', 'other']);
/** 업체 과세 유형 — 일반 · 간이 · 면세 (ledger_book 이 general 일 때만 수금을 공급가 · 부가세로 나눈다) */
export const VAT_TYPES = Object.freeze(['general', 'simplified', 'exempt']);
/** 업종 — 수주 원가 계정 잇기 (ledger_cost_accounts) */
export const BUSINESS_KINDS = Object.freeze(['manufacturing', 'retail']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEM_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
}

/** X-Idempotency-Key — 없으면 null, 꼴이 틀리면 422 */
export function idempotencyKeyOf(value) {
  if (value === null || value === undefined || value === '') return null;
  const k = String(value);
  if (!IDEM_RE.test(k)) throw new ValidationError('X-Idempotency-Key 는 영문 · 숫자 · _ . : - 1~200자입니다');
  return k;
}

/** 사업자등록번호 — 숫자 10자리로 (- · 빈칸 뺌). 비면 null */
export function normalizeBizNo(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/[-\s]/g, '');
  return s === '' ? null : s;
}

/** 사업자등록번호 검증 숫자 — 가중치 1,3,7,1,3,7,1,3,5 */
export function bizNoValid(bizNo) {
  if (typeof bizNo !== 'string' || !/^\d{10}$/.test(bizNo)) return false;
  const d = bizNo.split('').map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * w[i];
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

/** 계정 묶음이 받는 방향 — DB 트리거 ledger_entries_guard 와 같다 */
export function groupTakes(grp, direction) {
  if (grp === 'income') return direction === 'income';
  if (grp === 'purchase' || grp === 'manufacturing' || grp === 'admin') return direction === 'expense';
  if (grp === 'asset') return direction === 'asset_buy' || direction === 'asset_sell';
  return false;
}

function text(body, key, max) {
  const v = body[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ValidationError(`${key} 는 글이어야 합니다`);
  const s = v.trim();
  if (s.length > max) throw new ValidationError(`${key} 는 ${max}자 이하입니다`);
  return s === '' ? null : s;
}

function won(body, key, { min }) {
  const n = Number(body[key]);
  if (body[key] === null || body[key] === '' || !Number.isSafeInteger(n) || n < min) {
    throw new ValidationError(`${key} 는 ${min} 이상 정수(원)입니다`);
  }
  return n;
}

const ENTRY_KEYS = ['entry_date', 'direction', 'account', 'description', 'counterparty_id', 'counterparty_name', 'counterparty_biz_no', 'amount', 'vat_amount', 'evidence_type', 'payment_method'];

/**
 * 장부 줄 입력 → 저장할 칸. partial 이면 보낸 칸만 (고치기), 아니면 일자 · 방향 · 계정 · 금액 · 증빙이 꼭 있어야 한다.
 * 계정이 그 방향을 받는지는 계정 목록을 아는 쪽(entries.js)이 본다.
 */
export function parseEntryInput(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  const out = {};
  for (const k of ['entry_date', 'direction', 'account', 'amount', 'evidence_type']) {
    if (!partial && !has(k)) throw new ValidationError(`${k} 가 필요합니다`);
  }
  if (has('entry_date')) {
    if (!isDate(body.entry_date)) throw new ValidationError('entry_date 는 YYYY-MM-DD 날짜입니다');
    out.entry_date = body.entry_date;
  }
  if (has('direction')) {
    if (!DIRECTIONS.includes(body.direction)) throw new ValidationError(`direction 은 ${DIRECTIONS.join(' · ')} 중 하나입니다`);
    out.direction = body.direction;
  }
  if (has('account')) {
    if (typeof body.account !== 'string' || !/^[a-z]+\.[a-z_]+$/.test(body.account)) throw new ValidationError('account 는 계정 코드입니다');
    out.account = body.account;
  }
  if (has('description')) out.description = text(body, 'description', 200);
  if (has('counterparty_id')) {
    const v = body.counterparty_id;
    if (v !== null && v !== '' && !isUuid(v)) throw new ValidationError('counterparty_id 가 올바르지 않습니다');
    out.counterparty_id = v || null;
  }
  if (has('counterparty_name')) out.counterparty_name = text(body, 'counterparty_name', 100);
  if (has('counterparty_biz_no')) {
    const b = normalizeBizNo(body.counterparty_biz_no);
    if (b !== null && !bizNoValid(b)) throw new ValidationError('사업자등록번호가 올바르지 않습니다 (숫자 10자리, 검증 숫자)');
    out.counterparty_biz_no = b;
  }
  if (has('amount')) out.amount = won(body, 'amount', { min: 1 });
  if (has('vat_amount')) out.vat_amount = body.vat_amount === null ? 0 : won(body, 'vat_amount', { min: 0 });
  else if (!partial) out.vat_amount = 0;
  if (has('evidence_type')) {
    if (!EVIDENCE_TYPES.includes(body.evidence_type)) throw new ValidationError(`evidence_type 은 ${EVIDENCE_TYPES.join(' · ')} 중 하나입니다`);
    out.evidence_type = body.evidence_type;
  }
  if (has('payment_method')) {
    const v = body.payment_method;
    if (v !== null && v !== '' && !PAYMENT_METHODS.includes(v)) throw new ValidationError(`payment_method 는 ${PAYMENT_METHODS.join(' · ')} 중 하나입니다`);
    out.payment_method = v || null;
  }
  if (partial && !ENTRY_KEYS.some((k) => k in out)) throw new ValidationError('바꿀 칸이 없습니다');
  return out;
}

/** 취소 · 고치기 이유 — 1~300자 */
export function reasonOf(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) throw new ValidationError('이유를 적어 주세요');
  if (s.length > 300) throw new ValidationError('이유는 300자 이하입니다');
  return s;
}

// ── 사진 ──

/** 사진 바이트 한도 — 버킷 ledger-evidence 와 같다 */
export const PHOTO_MAX_BYTES = 5242880;
/** 사진 크기 한도 — 앱이 긴 변 2576px · 375만 화소 이하로 줄여 올린다 */
export const PHOTO_MAX_EDGE = 2576;
export const PHOTO_MAX_PIXELS = 3750000;

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(u8) {
  let i = 2;
  while (i + 3 < u8.length) {
    if (u8[i] !== 0xff) return null;
    let marker = u8[i + 1];
    while (marker === 0xff && i + 2 < u8.length) {
      i += 1;
      marker = u8[i + 1];
    }
    // 길이 없는 표시 (RST · TEM)
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = (u8[i + 2] << 8) | u8[i + 3];
    if (len < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 8 >= u8.length) return null;
      return { height: (u8[i + 5] << 8) | u8[i + 6], width: (u8[i + 7] << 8) | u8[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * 첫 바이트로 형식 · 크기를 본다.
 * @returns {{ mime, width, height } | { heic: true } | null}
 */
export function sniffImage(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 12) return null;
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    const size = jpegSize(u8);
    return size && size.width > 0 && size.height > 0 ? { mime: 'image/jpeg', ...size } : null;
  }
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG.every((b, k) => u8[k] === b)) {
    if (u8.length < 24 || String.fromCharCode(...u8.slice(12, 16)) !== 'IHDR') return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    return width > 0 && height > 0 ? { mime: 'image/png', width, height } : null;
  }
  if (String.fromCharCode(...u8.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...u8.slice(8, 12));
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif'].includes(brand)) return { heic: true };
  }
  return null;
}
