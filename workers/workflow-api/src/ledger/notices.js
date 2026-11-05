/**
 * 회계장부 — 장부 알림 (DB 0033 ledger_notices). 알림을 만드는 것은 DB 함수(ledger_notices_scan · ledger_nts_record)이고,
 * 여기는 매분 cron 의 차례 · 앱 알림 · 읽기 주소다. 숫자는 서버가 센 값 그대로 — 비서(AI)는 설명만 한다.
 *
 *   매분 cron (runLedgerNotices) — 하위 요청 한도(50) 안에 들게 분마다 일을 나눈다 (한국 시간)
 *     분 % 5 == 2   ledger_notices_scan → 바로 보낼 알림(중복 · 큰 금액)을 업체 NOW_COMPANIES 곳까지 잡아
 *                   대표 · 실장에게 「장부 확인 필요 N건」 — 한 사람에게 한 시간에 한 번 (꼬리 hYYYYMMDDHH)
 *     분 % 5 == 3   국세청 상태 다시 묻기 — ledger_nts_due(NTS_BATCH, NTS_STALE_DAYS) 를 한 번에 묻고 ledger_nts_record
 *                   (시크릿 NTS_SERVICE_KEY 가 있을 때만 — 키 · 주소는 로그에 남기지 않는다)
 *     08:00~08:29   아침 묶음 — 나머지 알림(단가 · 새 거래처 · 휴업/폐업 · 증빙)을 업체 DIGEST_COMPANIES 곳씩 잡아
 *                   「장부에 바뀐 점 N건」 (아직 안 본 수, 0 이면 보내지 않는다 — 하루 한 번, 꼬리 dYYYYMMDD).
 *                   분 % 5 가 2 · 3 인 분은 건너뛴다 (훑기 · 국세청과 겹치지 않게).
 *                   비서를 쓰는 업체(company_entitled 'assistant' full)는 이 알림을 보내지 않는다 — 같은 시각의 아침 브리핑
 *                   「오늘 볼 것 N건」에 지난 하루 새로 생긴 안 본 장부 알림 수가 든다 (src/brief.js, 2026-11-05 대표님 결정). 잡기는 그대로 한다
 *     07:55         매달 INVOICE_DAY(11)일부터 — 지난달 · 그 앞 달 모아 둔 명세표에 세금계산서가 없으면 invoice_missing
 *                   (DB 0036 ledger_invoice_missing_scan — 거래처 · 달마다 하나라 매일 불러도 하나). 8시 묶음에 실린다
 *     07:50         매달 1일 — 지난달 월 보고 month_report (DB 0038 ledger_month_report_scan — 그 달 장부 줄이 있는
 *                   회계 자격 업체마다 하나). 8시 묶음에 실린다
 *   앱 알림은 사진 AI 읽기 업체(Agent)면 비서 탭으로, 아니면(Expert) 회계 화면으로 보낸다 (access.js ledgerAi)
 *   GET  /ledger/notices         대표 · 실장 — 최근 알림 (?limit= 30, 100까지) + 그 안의 안 본 수. ?company= 본사 보기
 *   POST /ledger/notices/seen    대표 · 실장 — { ids } 본 표시 (업체에 하나, 자기 업체만)
 * 0033 을 적용하기 전에는 함수 · 표가 없다 — 경고를 한 번만 남기고 건너뛴다 (목록은 빈 목록).
 * 앱 알림 글에 금액 · 상호는 없다 (src/push/messages.js ledger_notice). 금액은 앱 안 비서 탭 카드에서만.
 */
import { selectMany, updateBy, callRpc, MONEY_ROLES, ValidationError } from '../supabase.js';
import { buildMessage } from '../push/messages.js';
import { notifyRoles } from '../push/outbox.js';
import { kstHour } from '../push/ledger-hooks.js';
import { ledgerAccess, ledgerAi, assertMoney } from './access.js';
import { isUuid } from './checks.js';
import { NTS_URL, ntsRow } from './review.js';
import { isMissingFunction } from './hints.js';
import { INVOICE_DAY } from './statements.js';
import { kstMonth, shiftMonth } from './dashboard.js';
import { assistantOn } from '../brief.js';

/** 매분 cron — 훑는 분 · 국세청 분 (분 % 5), 아침 묶음 시각 · 분 수 · 한 번에 잡는 업체 수 */
export const SCAN_MINUTE = 2;
export const NTS_MINUTE = 3;
export const DIGEST_HOUR = 8;
export const DIGEST_MINUTES = 30;
export const DIGEST_COMPANIES = 10;
export const NOW_COMPANIES = 10;
/** 세금계산서 없음 훑기 — 아침 묶음 바로 앞 (분 % 5 가 0 이라 훑기 · 국세청과 안 겹친다) · 보는 달 수 */
export const INVOICE_HOUR = 7;
export const INVOICE_MINUTE = 55;
export const INVOICE_MONTHS = 2;
/** 월 보고 — 매달 1일 아침 묶음 바로 앞 (분 % 5 가 0 이라 훑기 · 국세청과 안 겹친다) */
export const MONTH_HOUR = 7;
export const MONTH_MINUTE = 50;
/** 국세청 — 한 번에 묻는 번호 수(API 한도 100) · 다시 물을 날 */
export const NTS_BATCH = 100;
export const NTS_STALE_DAYS = 30;
/** 알림 목록 · 본 표시 */
export const NOTICE_PAGE = 30;
export const NOTICE_MAX = 100;
export const SEEN_MAX = 50;

const NOTICE_COLS = 'id,kind,urgency,document_id,entry_id,cost_id,data,created_at,seen_at';
let warned = false;

/** 0033 이 없다 — 경고는 한 번 */
function missing(e) {
  const gone = isMissingFunction(e) || (e && /PGRST205|Could not find the table/.test(String(e.message)));
  if (gone && !warned) {
    console.warn('[Ledger] ledger notices missing — apply database/migrations/0033');
    warned = true;
  }
  return gone;
}

const kst = (ms) => new Date(ms + 9 * 3600 * 1000);

/** 한국 날짜 'YYYYMMDD' — 하루 한 번 */
export function kstDay(nowMs) {
  return kst(nowMs).toISOString().slice(0, 10).replace(/-/g, '');
}

/** 이 분에 할 일 (순수) */
export function noticeJobs(nowMs) {
  const k = kst(nowMs);
  const m = k.getUTCMinutes();
  const h = k.getUTCHours();
  return {
    scan: m % 5 === SCAN_MINUTE,
    nts: m % 5 === NTS_MINUTE,
    digest: h === DIGEST_HOUR && m < DIGEST_MINUTES && m % 5 !== SCAN_MINUTE && m % 5 !== NTS_MINUTE,
    invoice: h === INVOICE_HOUR && m === INVOICE_MINUTE && k.getUTCDate() >= INVOICE_DAY,
    month: h === MONTH_HOUR && m === MONTH_MINUTE && k.getUTCDate() === 1,
  };
}

/** 세금계산서 없음 — 지난달부터 INVOICE_MONTHS 달 */
async function scanInvoiceMissing(env, nowMs) {
  const month = kstMonth(nowMs);
  let added = 0;
  for (let i = 1; i <= INVOICE_MONTHS; i += 1) {
    const n = await callRpc(env, 'ledger_invoice_missing_scan', { p_month: `${shiftMonth(month, -i)}-01` });
    added += Number.isInteger(n) ? n : 0;
  }
  return added;
}

/** 잡은 알림 → 업체마다 대표 · 실장에게 (안 본 수만) */
async function pushClaimed(env, rows, { digest, nowMs }) {
  let sent = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !isUuid(r.company_id) || !Number.isInteger(r.unseen) || r.unseen < 1) continue;
    if (digest && (await assistantOn(env, r.company_id))) continue; // 아침 브리핑이 싣는다
    const message = buildMessage('ledger_notice', { count: r.unseen, digest, ai: await ledgerAi(env, r.company_id) });
    if (!message) continue;
    sent += await notifyRoles(env, {
      companyId: r.company_id,
      roles: MONEY_ROLES,
      kind: 'ledger_notice',
      ...message,
      refId: r.company_id,
      dedupeSuffix: digest ? `d${kstDay(nowMs)}` : `h${kstHour(nowMs)}`,
    });
  }
  return sent;
}

/** 국세청 상태 다시 묻기 — 묵은 번호를 한 번에 → { asked, saved, added } */
export async function refreshNts(env) {
  const due = (await callRpc(env, 'ledger_nts_due', { p_limit: NTS_BATCH, p_stale_days: NTS_STALE_DAYS })) || [];
  const list = due.map((r) => r && r.biz_no).filter((b) => typeof b === 'string' && /^\d{10}$/.test(b));
  if (!list.length) return { asked: 0, saved: 0, added: 0 };
  let body = null;
  try {
    const res = await fetch(`${NTS_URL}?serviceKey=${encodeURIComponent(env.NTS_SERVICE_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ b_no: list }),
    });
    if (!res.ok) {
      console.error('[Ledger] NTS refresh failed:', res.status);
      return { asked: list.length, saved: 0, added: 0 };
    }
    body = await res.json();
  } catch {
    console.error('[Ledger] NTS refresh failed: network');
    return { asked: list.length, saved: 0, added: 0 };
  }
  if (!body || body.status_code !== 'OK' || !Array.isArray(body.data)) {
    console.error('[Ledger] NTS refresh failed: status');
    return { asked: list.length, saved: 0, added: 0 };
  }
  const rows = list
    .map((b) => {
      const d = body.data.find((x) => x && String(x.b_no) === b);
      return d ? ntsRow(b, d) : null;
    })
    .filter(Boolean);
  if (!rows.length) return { asked: list.length, saved: 0, added: 0 };
  const r = (await callRpc(env, 'ledger_nts_record', { p_rows: rows })) || {};
  return { asked: list.length, saved: r.saved || 0, added: r.added || 0 };
}

/** 매분 cron — 던지지 않는다 → { scan, pushed, nts, skipped? } */
export async function runLedgerNotices(env, { nowMs = Date.now() } = {}) {
  const jobs = noticeJobs(nowMs);
  const out = { scan: null, pushed: 0, nts: null, invoice: null, month: null };
  try {
    if (jobs.month) out.month = await callRpc(env, 'ledger_month_report_scan', { p_month: `${shiftMonth(kstMonth(nowMs), -1)}-01` });
    if (jobs.invoice) out.invoice = await scanInvoiceMissing(env, nowMs);
    if (jobs.scan) {
      out.scan = await callRpc(env, 'ledger_notices_scan', {});
      const rows = await callRpc(env, 'ledger_notices_claim', { p_urgency: 'now', p_companies: NOW_COMPANIES });
      out.pushed += await pushClaimed(env, rows, { digest: false, nowMs });
    }
    if (jobs.digest) {
      const rows = await callRpc(env, 'ledger_notices_claim', { p_urgency: 'digest', p_companies: DIGEST_COMPANIES });
      out.pushed += await pushClaimed(env, rows, { digest: true, nowMs });
    }
    if (jobs.nts && env.NTS_SERVICE_KEY) out.nts = await refreshNts(env);
  } catch (e) {
    if (missing(e)) return { ...out, skipped: 'no_function' };
    console.error('[Ledger] notices failed:', e && e.statusCode ? e.statusCode : 'error');
    return { ...out, skipped: 'error' };
  }
  return out;
}

function noticeView(r) {
  return {
    id: r.id,
    kind: r.kind,
    urgency: r.urgency,
    document_id: r.document_id || null,
    entry_id: r.entry_id || null,
    cost_id: r.cost_id || null,
    data: r.data && typeof r.data === 'object' ? r.data : {},
    created_at: r.created_at,
    seen_at: r.seen_at || null,
  };
}

/** GET /ledger/notices */
export async function listNotices(env, { user, company, limit }) {
  const access = await ledgerAccess(env, user, { company });
  assertMoney(access);
  const n = Math.min(Math.max(Number(limit) || NOTICE_PAGE, 1), NOTICE_MAX);
  let rows = [];
  try {
    rows =
      (await selectMany(env, 'ledger_notices', {
        company_id: `eq.${access.companyId}`,
        select: NOTICE_COLS,
        order: 'created_at.desc',
        limit: String(n),
      })) || [];
  } catch (e) {
    if (!missing(e)) throw e;
    return { items: [], unseen: 0, available: false, level: access.level, viewing: access.viewing };
  }
  return {
    items: rows.map(noticeView),
    unseen: rows.filter((r) => !r.seen_at).length,
    available: true,
    level: access.level,
    viewing: access.viewing,
  };
}

/** POST /ledger/notices/seen — { ids } (자기 업체, 아직 안 본 것만) */
export async function markNoticesSeen(env, { user, body }) {
  const access = await ledgerAccess(env, user);
  assertMoney(access);
  const ids = body && Array.isArray(body.ids) ? [...new Set(body.ids.filter(isUuid))] : [];
  if (!ids.length) throw new ValidationError('ids 가 필요합니다');
  if (ids.length > SEEN_MAX) throw new ValidationError(`한 번에 ${SEEN_MAX}건까지 봅니다`);
  const rows = await updateBy(
    env,
    'ledger_notices',
    { id: `in.(${ids.join(',')})`, company_id: `eq.${access.companyId}`, seen_at: 'is.null' },
    { seen_at: new Date().toISOString(), seen_by: user.id }
  );
  return { seen: (rows || []).length };
}
