/**
 * 읽은 칸 다듬기 · 정해진 검사 (AI 가 아니라 서버 계산, 순수 함수).
 *
 *   normalize(raw, { accountCodes })  스키마 밖 값 버리기 · 사업자번호는 숫자만 · 카드번호 · 전화번호 꼴은 [지움] 으로 바꾼다 (redacted 수)
 *                   계정 제안 account_hint 는 받은 계정 목록 안에 있을 때만 남긴다
 *   checkResult(r, today)
 *     biz_no   ok · bad(10자리가 아니거나 검증 숫자 틀림) · missing — 국세청 검증 숫자: 가중치 1,3,7,1,3,7,1,3,5
 *     amounts  ok · mismatch · incomplete — 공급가 + 부가세 + 면세 + 봉사료 = 합계 (공급가 · 합계가 없으면 incomplete)
 *     items    ok · mismatch · none — 품목 금액 합이 공급가나 합계와 같은가 (금액 있는 품목이 없으면 none)
 *     date     ok · future · too_old(5년 넘음) · missing — 한국 날짜 기준
 *     multiple 사진에 문서가 둘 이상 (한 장씩 다시 찍으라고 안내)
 *     redacted 지운 글 수
 */
import { EVIDENCE_TYPES, PAYMENT_METHODS, AMOUNT_FIELDS, FIELDS } from './schema.js';

/** 13~19자리 숫자(사이 띄움 · 붙임표 허용) — 카드번호 꼴 */
const CARD_RE = /\d(?:[ -]?\d){12,18}/g;
/** 휴대폰 · 지역 번호 꼴 */
const PHONE_RE = /\b0\d{1,2}[ -]?\d{3,4}[ -]?\d{4}\b/g;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_MAX = 100;

function redactText(s, count) {
  if (typeof s !== 'string') return null;
  let out = s.replace(CARD_RE, () => {
    count.n += 1;
    return '[지움]';
  });
  out = out.replace(PHONE_RE, () => {
    count.n += 1;
    return '[지움]';
  });
  out = out.trim();
  return out ? out.slice(0, TEXT_MAX) : null;
}

const intOrNull = (v) => (Number.isInteger(v) ? v : null);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Claude 가 준 값 → 저장할 result. { result, redacted } */
export function normalize(raw, { accountCodes = [] } = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const count = { n: 0 };
  const out = {
    document_count: intOrNull(r.document_count),
    evidence_type: EVIDENCE_TYPES.includes(r.evidence_type) ? r.evidence_type : null,
    issue_date:
      typeof r.issue_date === 'string' && DATE_RE.test(r.issue_date) ? r.issue_date : null,
    supplier_name: redactText(r.supplier_name, count),
    supplier_biz_no:
      typeof r.supplier_biz_no === 'string' && r.supplier_biz_no.replace(/\D/g, '')
        ? r.supplier_biz_no.replace(/\D/g, '').slice(0, 20)
        : null,
  };
  for (const k of AMOUNT_FIELDS) out[k] = intOrNull(r[k]);
  const approval = redactText(r.approval_no, count);
  out.approval_no = approval;
  out.payment_method = PAYMENT_METHODS.includes(r.payment_method) ? r.payment_method : null;
  out.items = (Array.isArray(r.items) ? r.items : []).slice(0, 100).map((it) => {
    const i = it && typeof it === 'object' ? it : {};
    return {
      name: redactText(i.name, count) || '',
      quantity: numOrNull(i.quantity),
      unit_price: intOrNull(i.unit_price),
      amount: intOrNull(i.amount),
    };
  });
  out.unsure = [
    ...new Set((Array.isArray(r.unsure) ? r.unsure : []).filter((f) => FIELDS.includes(f))),
  ];
  out.account_hint = accountCodes.includes(r.account_hint) ? r.account_hint : null;
  return { result: out, redacted: count.n };
}

/** 사업자등록번호 검증 숫자 (10자리) */
export function bizNoValid(no) {
  if (typeof no !== 'string' || !/^\d{10}$/.test(no)) return false;
  const d = [...no].map(Number);
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += d[i] * w[i];
  sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}

/** 'YYYY-MM-DD' 한국 날짜 */
export function kstToday(now = Date.now()) {
  return new Date(now + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function minusYears(day, years) {
  const [y, m, d] = day.split('-').map(Number);
  return `${String(y - years).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function checkResult(r, { today = kstToday(), redacted = 0 } = {}) {
  const biz_no = !r.supplier_biz_no ? 'missing' : bizNoValid(r.supplier_biz_no) ? 'ok' : 'bad';

  let amounts = 'incomplete';
  if (r.supply_amount !== null && r.total_amount !== null) {
    const sum =
      r.supply_amount + (r.vat_amount || 0) + (r.tax_free_amount || 0) + (r.service_charge || 0);
    amounts = sum === r.total_amount ? 'ok' : 'mismatch';
  }

  const priced = (r.items || []).filter((i) => i.amount !== null);
  let items = 'none';
  if (priced.length) {
    const sum = priced.reduce((s, i) => s + i.amount, 0);
    items = sum === r.supply_amount || sum === r.total_amount ? 'ok' : 'mismatch';
  }

  let date = 'missing';
  if (r.issue_date) {
    if (r.issue_date > today) date = 'future';
    else if (r.issue_date < minusYears(today, 5)) date = 'too_old';
    else date = 'ok';
  }

  return {
    biz_no,
    amounts,
    items,
    date,
    multiple: (r.document_count || 0) > 1,
    redacted,
  };
}
