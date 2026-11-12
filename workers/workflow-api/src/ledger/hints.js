/**
 * 회계장부 — 사진 확인 힌트. DB 0033 ledger_review_hints 가 센 거래처 기억 · 경고를 받아
 * 올릴 값(proposal)과 「바로 올려도 되는 사진」(ready)을 정한다. 앱은 이 값을 그린다 — 규칙은 여기 하나.
 *
 *   올릴 값 (장부 줄)
 *     일자 · 사업자번호(검사 ok) · 품목(내용)   읽은 값
 *     상호      이 거래처로 올린 적이 있으면 그때 쓴 상호(memory), 없으면 읽은 상호
 *     금액 · 부가세  공제되는 증빙(세금계산서 · 카드 · 현금영수증)에 공급가 · 부가세가 있으면 공급가 · 부가세,
 *               아니면 합계 · 0 (세무사 확인 전 기준 — 앱 장부 화면과 같다)
 *     증빙 · 결제 수단  읽은 값, 없으면 지난번 장부 줄 값
 *     계정      지난번 장부 줄 계정(memory) → 없으면 AI 제안(ai, 판 3 account_hint) → 없으면 비움.
 *               방향은 계정 묶음으로 (자산 → asset_buy, 그 밖 → expense)
 *   올릴 곳    지난번이 수주 원가면 order_cost (원가 종류도 지난번) — 수주는 사진마다 고른다
 *
 *   바로 올려도 되는 사진 (ready) — 모두 맞을 때. 아니면 blockers 에 까닭
 *     not_read 읽음이 아님 · checks 사업자번호 · 금액 합 · 날짜 · 한 장 검사 · unsure 꼭 볼 칸에 「확실하지 않음」
 *     warning 중복 · 큰 금액 · 증빙 경고 · 휴업/폐업 · not_trusted 믿을 만한 거래처 아님(장부 줄 3번 같은 계정 · 증빙)
 *     evidence_changed 증빙이 지난번과 다름 · target 지난번이 수주 원가 · incomplete 일자 · 금액 · 계정이 빔 · no_hints 0033 없음
 *     invoice_mode 명세표인데 거래처를 아직 안 고름 · hold 세금계산서를 따로 주는 거래처의 명세표(모아 둔다 — statements.js)
 *   명세표 길 (invoice.route, DB 0036 이 있을 때) ask 고르기 묻기 · hold 모아 두기 · null 그대로 올리기(명세표만 줌 · 명세표 아님)
 */
import { callRpc } from '../supabase.js';

/** 공제되는 부가세 증빙 (앱 segan/ledger.js DEDUCT_EVIDENCE 와 같다) */
export const DEDUCTIBLE_EVIDENCE = Object.freeze(['tax_invoice', 'card', 'cash_receipt']);
/** 꼭 볼 칸(일자 · 거래처 · 공급가 · 부가세 · 계정)에 걸리는 읽은 칸 — 이 칸이 「확실하지 않음」이면 바로 올리지 않는다 */
export const MUST_FIELDS = Object.freeze(['issue_date', 'supplier_name', 'supplier_biz_no', 'supply_amount', 'vat_amount', 'total_amount', 'evidence_type']);
const EVIDENCE = ['tax_invoice', 'invoice', 'card', 'cash_receipt', 'simple_receipt', 'statement', 'other', 'none'];
const METHODS = ['transfer', 'card', 'cash', 'other'];
const CHECKS_OK = { biz_no: 'ok', amounts: 'ok', date: 'ok' };

const wholeWon = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** PostgREST 가 함수를 모른다 (0033 을 적용하기 전) */
export const isMissingFunction = (e) => !!e && (e.statusCode === 404 || /PGRST202|Could not find the function/.test(String(e.message)));

/** 계정 묶음 → 방향 (수입 계정은 사진 지출에 쓰지 않는다) */
function directionOf(accounts, code) {
  const a = (accounts || []).find((x) => x.code === code && x.active !== false);
  if (!a || a.grp === 'income') return null;
  return a.grp === 'asset' ? 'asset_buy' : 'expense';
}

/** 읽은 칸 + 기억 → 올릴 장부 줄 칸 · 어디서 왔나 (순수) */
export function proposalFor(result, hints, accounts) {
  const r = result || {};
  const mem = (hints && hints.memory) || {};
  const lastEntry = mem.last_entry || null;
  const supply = wholeWon(r.supply_amount);
  const vat = wholeWon(r.vat_amount);
  const readEvidence = EVIDENCE.includes(r.evidence_type) ? r.evidence_type : null;
  const memEvidence = lastEntry && EVIDENCE.includes(lastEntry.evidence_type) ? lastEntry.evidence_type : null;
  const evidence = readEvidence || memEvidence;
  const deductible = DEDUCTIBLE_EVIDENCE.includes(evidence) && supply > 0 && vat > 0;
  const readMethod = METHODS.includes(r.payment_method) ? r.payment_method : null;
  const memMethod = lastEntry && METHODS.includes(lastEntry.payment_method) ? lastEntry.payment_method : null;
  const items = (Array.isArray(r.items) ? r.items : []).filter((i) => i && typeof i.name === 'string' && i.name.trim());
  const desc = items.length ? items[0].name.trim() + (items.length > 1 ? ` 외 ${items.length - 1}건` : '') : null;

  let account = null;
  let accountSource = null;
  if (lastEntry && directionOf(accounts, lastEntry.account)) {
    account = lastEntry.account;
    accountSource = 'memory';
  } else if (r.account_hint && directionOf(accounts, r.account_hint)) {
    account = r.account_hint;
    accountSource = 'ai';
  }
  const memName = lastEntry ? str(lastEntry.display_name, 100) : null;
  const bizOk = hints && hints.supplier && typeof hints.supplier.biz_no === 'string' ? hints.supplier.biz_no : null;

  return {
    proposal: {
      entry_date: typeof r.issue_date === 'string' ? r.issue_date : null,
      direction: account ? directionOf(accounts, account) : 'expense',
      account,
      description: desc ? desc.slice(0, 200) : null,
      counterparty_name: memName || str(r.supplier_name, 100),
      counterparty_biz_no: bizOk,
      amount: deductible ? supply : wholeWon(r.total_amount),
      vat_amount: deductible ? vat : 0,
      evidence_type: evidence,
      payment_method: readMethod || memMethod,
    },
    deductible,
    sources: {
      account: accountSource,
      counterparty_name: memName ? 'memory' : str(r.supplier_name, 100) ? 'read' : null,
      evidence_type: readEvidence ? 'read' : memEvidence ? 'memory' : null,
      payment_method: readMethod ? 'read' : memMethod ? 'memory' : null,
    },
  };
}

/** 명세표 길 — 0036 힌트(invoice_mode 칸)가 있을 때만: 안 고름 ask · 따로 줌 hold · 그 밖 null (순수) */
export function invoiceRoute(evidence, hints) {
  if (evidence !== 'statement' || !hints || !Object.prototype.hasOwnProperty.call(hints, 'invoice_mode')) return null;
  if (!hints.invoice_mode) return 'ask';
  return hints.invoice_mode === 'separate' ? 'hold' : null;
}

/** 바로 올려도 되는 사진인가 → 까닭 목록 (빈 목록이면 된다) (순수) */
export function blockersOf(extraction, hints, made) {
  const out = [];
  if (!extraction || extraction.status !== 'done') return ['not_read'];
  if (!hints || hints.read !== true) return ['no_hints'];
  const c = extraction.checks || {};
  if (Object.entries(CHECKS_OK).some(([k, v]) => c[k] !== v) || c.multiple) out.push('checks');
  const unsure = (extraction.result && Array.isArray(extraction.result.unsure) && extraction.result.unsure) || [];
  if (unsure.some((f) => MUST_FIELDS.includes(f))) out.push('unsure');
  const nts = hints.nts && hints.nts.status;
  if (hints.duplicate || hints.large || hints.evidence_risk || nts === 'suspended' || nts === 'closed') out.push('warning');
  const route = invoiceRoute(made.proposal.evidence_type, hints);
  if (route === 'ask') out.push('invoice_mode');
  if (route === 'hold') out.push('hold');
  if (!hints.trusted) out.push('not_trusted');
  const last = hints.memory && hints.memory.last;
  if (last && last.src === 'cost') out.push('target');
  const lastEntry = hints.memory && hints.memory.last_entry;
  if (!lastEntry || lastEntry.evidence_type !== made.proposal.evidence_type) out.push('evidence_changed');
  const p = made.proposal;
  if (!p.entry_date || !(Number.isSafeInteger(p.amount) && p.amount >= 1) || !p.account || made.sources.account !== 'memory') out.push('incomplete');
  return out;
}

/** 확인 목록 한 장의 힌트 (순수) — extraction: 마지막 시도, hints: ledger_review_hints 한 장 | null */
export function hintView(extraction, hints, accounts, { available = true } = {}) {
  if (!extraction || extraction.status !== 'done') return null;
  const made = proposalFor(extraction.result, hints && hints.read ? hints : null, accounts);
  const mem = (hints && hints.memory) || null;
  const last = mem && mem.last;
  const blockers = available ? blockersOf(extraction, hints, made) : ['no_hints'];
  return {
    available: available && !!(hints && hints.read),
    supplier: hints && hints.supplier ? { name: hints.supplier.name || null, biz_no: hints.supplier.biz_no || null, key: hints.supplier_key || null } : null,
    invoice: { mode: (hints && hints.invoice_mode) || null, route: hints && hints.read ? invoiceRoute(made.proposal.evidence_type, hints) : null },
    memory: mem ? { posts: mem.posts || 0, entry_posts: mem.entry_posts || 0, last_target: last ? (last.src === 'cost' ? 'order_cost' : 'entry') : null, last_on: last ? last.on_date || null : null } : null,
    first_time: hints ? hints.first_time === true : false,
    trusted: hints ? hints.trusted === true : false,
    warnings: {
      duplicate: (hints && hints.duplicate) || null,
      large: (hints && hints.large) || null,
      evidence_risk: !!(hints && hints.evidence_risk),
      nts: (hints && hints.nts) || null,
    },
    target: last && last.src === 'cost' ? 'order_cost' : 'entry',
    category: last && last.src === 'cost' ? last.category || null : null,
    proposal: made.proposal,
    deductible: made.deductible,
    sources: made.sources,
    ready: blockers.length === 0,
    blockers,
  };
}

/** ledger_review_hints — { map, available }. 0033 이 없으면 빈 지도 (목록 · 올리기는 그대로) */
export async function loadHints(env, companyId, documentIds) {
  const map = new Map();
  if (!documentIds.length) return { map, available: true };
  try {
    const rows = await callRpc(env, 'ledger_review_hints', { p_company: companyId, p_documents: documentIds });
    for (const r of Array.isArray(rows) ? rows : []) if (r && r.document_id) map.set(r.document_id, r.hints || null);
    return { map, available: true };
  } catch (e) {
    if (isMissingFunction(e)) {
      console.warn('[Ledger] ledger_review_hints missing — apply database/migrations/0033');
      return { map, available: false };
    }
    throw e;
  }
}

/** 두 장부 줄 칸이 같은가 — 바로 올리기에서 앱이 본 값과 지금 값 (순수) */
export function sameProposal(a, b) {
  const keys = ['entry_date', 'direction', 'account', 'description', 'counterparty_name', 'counterparty_biz_no', 'amount', 'vat_amount', 'evidence_type', 'payment_method'];
  const norm = (v) => (v === undefined || v === '' ? null : v);
  return !!a && !!b && keys.every((k) => norm(a[k]) === norm(b[k]));
}
