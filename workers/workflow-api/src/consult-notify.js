/**
 * 새 상담 Slack 알림 — 5분마다 (wrangler.toml [triggers] crons 의 CONSULT_NOTICE_CRON).
 *
 * 상담 신청은 브라우저(consultation.html · segan/consult.html)가 consultations 에 바로 넣는다 — 이 워커를
 * 거치지 않는다. 그래서 cron 이 DB 함수 claim_consultation_notices
 * (database/migrations/0002_consultations_notified_at.sql)로 아직 안 알린 행을 잡아 notified_at 을 표시하고,
 * 회사 Slack(SLACK_WEBHOOK_URL — 생산 · 보고 알림과 같은 채널)에 짧게 알린다. 여러 건이면 한 메시지로 묶는다.
 *
 * 개인정보: 메시지에는 품목 · 지역(시/도 · 시/군/구) · 연락 희망 시간 · 상담받을 곳(본사 · 협력업체) ·
 *   경로(사이트 · 앱) · 접수 시각(KST) · 관리자 화면 링크만 넣는다.
 *   이름 · 연락처 · 이메일 · 요청 내용 · 사이트의 「상담 제목」(고객이 직접 적는 글)은 넣지 않는다 —
 *   DB 함수가 애초에 그 칸을 돌려주지 않고, 여기서도 정해진 값 목록(코드 → 한글)에 맞는 값만 쓴다.
 *   신청 폼은 비로그인 공개라 어느 칸이든 아무 글이나 넣을 수 있다 — 목록 밖 값은 메시지에 싣지 않는다.
 *
 * 두 번 알리지 않기: 함수가 고르고(FOR UPDATE SKIP LOCKED) 표시한 뒤 돌려준 행만 보낸다. 겹친 실행은 같은 행을
 *   잡지 못한다. 표시한 뒤 Slack 보내기가 실패하면 건수만 로그에 남기고 다시 보내지 않는다 (최대 한 번 —
 *   postToWebhook 이 그 자리에서 하는 429 · 5xx 재시도는 그대로). 상담 자체는 관리자 화면에 그대로 있다.
 * 밀린 행: 24시간보다 오래된 미알림 행은 알리지 않고 표시만 한다 — 처음 켤 때 쌓여 있던 옛 상담,
 *   워커나 웹훅이 하루 넘게 멈췄던 동안의 상담.
 */

import { callRpc } from './supabase.js';
import { postToWebhook, formatKst } from './slack.js';

export const CONSULT_NOTICE_CRON = '*/5 * * * *';
/** 이보다 오래된 미알림 행은 알리지 않고 표시만 한다 */
export const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 한 번에 잡는 건수 — 남으면 다음 실행(5분 뒤)이 잡는다. DB 함수도 1~50 으로 자른다 */
export const CLAIM_LIMIT = 20;
/** 한 메시지에 줄로 싣는 건수 (Slack 블록 50개 한도 안) */
const MAX_LINES = 40;

/** 상담 유형 — admin/consultations.html TYPE_LABELS 와 같다 */
export const TYPE_LABELS = Object.freeze({
  'ai-design': 'AI 설계',
  'detail-design': '상세 설계',
  estimate: '견적 상담',
  other: '기타',
});

/** 사이트 신청서의 가구 종류(furniture_categories) — consultation.html 값 · admin CATEGORY_LABELS_KO 와 같다 */
export const FURNITURE_LABELS = Object.freeze({
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  fridge: '냉장고장',
  shoerack: '신발장',
  vanity: '화장대',
  storage: '수납장',
  other: '기타',
});

/** 앱 연출컷 품목(generations.category) — generate-api CATEGORIES · segan/make.js KINDS 와 같다 */
export const APP_KIND_LABELS = Object.freeze({
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  storage: '수납장',
  fridge: '냉장고장',
  vanity: '화장대',
  shoe: '신발장',
  office: '사무실',
  study: '서재',
  bedroom: '침실',
});

/** 연락 희망 시간대 — consultation.html · segan/consult.html 의 선택지와 같다 */
export const TIME_LABELS = Object.freeze({
  '09:00-12:00': '오전 (09:00~12:00)',
  '12:00-15:00': '점심 (12:00~15:00)',
  '15:00-18:00': '오후 (15:00~18:00)',
  '18:00-21:00': '저녁 (18:00~21:00)',
});

/** 시/도 — signup.html locationData · segan/regions.js 와 같다 */
export const SIDO = Object.freeze([
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시',
  '세종특별자치시', '경기도', '강원도', '충청북도', '충청남도', '전라북도', '전라남도', '경상북도',
  '경상남도', '제주특별자치도',
]);
/** 시/군/구 — 목록 값은 모두 한글 한 낱말 + 시 · 군 · 구 (시험이 segan/regions.js 와 견준다) */
const GUGUN_RE = /^[가-힣]{1,10}(?:시|군|구)$/;

const TARGET_LABELS = Object.freeze({ hq: '본사', partner: '협력업체' });
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const has = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);

/** 앱에서 온 행 — 앱만 연출컷(generation_id)과 상담받을 곳(consult_target)을 넣는다 */
export function isFromApp(row) {
  return Boolean(row && (row.has_generation === true || has(TARGET_LABELS, row.consult_target)));
}

/** 품목 — 앱은 연출컷 품목, 사이트는 고른 가구 종류. 뒤에 상담 유형. 고객이 적은 글(제목)은 쓰지 않는다 */
export function itemLabel(row) {
  const kinds = [];
  if (has(APP_KIND_LABELS, row.category)) kinds.push(APP_KIND_LABELS[row.category]);
  for (const c of Array.isArray(row.furniture_categories) ? row.furniture_categories : []) {
    if (has(FURNITURE_LABELS, c) && !kinds.includes(FURNITURE_LABELS[c])) kinds.push(FURNITURE_LABELS[c]);
  }
  const type = has(TYPE_LABELS, row.consultation_type) ? TYPE_LABELS[row.consultation_type] : '';
  if (!kinds.length) return type || '품목 미지정';
  return type ? `${kinds.join('·')} (${type})` : kinds.join('·');
}

/** 지역 — 목록에 있는 시/도, 그 뒤 시/군/구 모양일 때만 */
export function regionLabel(row) {
  if (!SIDO.includes(row.sido)) return '';
  return typeof row.gugun === 'string' && GUGUN_RE.test(row.gugun) ? `${row.sido} ${row.gugun}` : row.sido;
}

/** 연락 희망 — 날짜(사이트) · 시간대. 목록 밖 시간대는 뺀다 */
export function contactLabel(row) {
  const parts = [];
  const d = typeof row.preferred_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.preferred_date)
    ? new Date(`${row.preferred_date}T00:00:00Z`)
    : null;
  if (d && !Number.isNaN(d.getTime())) parts.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`);
  if (has(TIME_LABELS, row.preferred_time)) parts.push(TIME_LABELS[row.preferred_time]);
  return parts.join(' ');
}

/** 한 건 — 두 줄. 1: 품목 · 경로 · 상담받을 곳, 2: 지역 · 연락 희망 · 접수 시각 */
export function noticeLines(row) {
  const head = [`*${itemLabel(row)}*`, isFromApp(row) ? '앱' : '사이트'];
  if (has(TARGET_LABELS, row.consult_target)) head.push(`${TARGET_LABELS[row.consult_target]} 상담`);
  const tail = [];
  const region = regionLabel(row);
  if (region) tail.push(region);
  const contact = contactLabel(row);
  if (contact) tail.push(`연락 희망 ${contact}`);
  tail.push(`${formatKst(row.created_at)} 접수`);
  return `${head.join(' · ')}\n${tail.join(' · ')}`;
}

/** 관리자 상담 목록 링크 */
export function consultAdminUrl(env) {
  const base = String((env && env.PUBLIC_BASE_URL) || '').replace(/\/+$/, '');
  return base ? `${base}/admin/consultations.html` : '';
}

/**
 * 메시지 (순수). rows 는 DB 함수가 돌려준 행 — 위의 정해진 칸만 읽는다.
 * @returns {{ text: string, blocks: object[] }}
 */
export function buildConsultNotice(rows, { adminUrl = '' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const n = list.length;
  const shown = list.slice(0, MAX_LINES);
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `📨 새 상담 ${n}건`, emoji: true } },
    ...shown.map((r) => ({ type: 'section', text: { type: 'mrkdwn', text: noticeLines(r) } })),
  ];
  if (n > shown.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `외 ${n - shown.length}건 — 관리자 화면에서 확인` } });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '이름 · 연락처 · 요청 내용은 관리자 화면에서만 봅니다' }] });
  if (adminUrl) {
    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: '상담 관리 열기', emoji: true }, url: adminUrl }],
    });
  }
  const first = n ? itemLabel(list[0]) : '';
  const text = `[다담] 새 상담 ${n}건${first ? ` — ${first}${n > 1 ? ` 외 ${n - 1}건` : ''}` : ''}`;
  return { text, blocks };
}

/** 로그용 사유 — 상태 코드 · PostgREST 코드만 (응답 본문은 남기지 않는다) */
function reasonOf(err) {
  const s = String((err && err.message) || err || '');
  const status = (err && err.statusCode) || (s.match(/^(\w+)/) || [])[1] || '?';
  const code = (s.match(/"code"\s*:\s*"([A-Z0-9]+)"/) || [])[1];
  return code ? `${status} ${code}` : String(status);
}

/**
 * cron 한 번. 던지지 않는다 — 결과 요약만 돌려준다 (로그에는 건수 · 사유 코드만).
 * @param {object} env
 * @param {{ now?: number, limit?: number }} [opts]
 * @returns {Promise<{posted:number, failed:number, stale:number, skipped?:string, error?:string}>}
 */
export async function runConsultNotices(env, { now = Date.now(), limit = CLAIM_LIMIT } = {}) {
  const result = { posted: 0, failed: 0, stale: 0 };
  if (!env || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ...result, skipped: 'supabase' };
  // 웹훅이 없으면 잡지 않는다 — 잡으면 표시만 되고 알림은 사라진다
  if (!env.SLACK_WEBHOOK_URL) return { ...result, skipped: 'slack' };

  let out;
  try {
    out = await callRpc(env, 'claim_consultation_notices', {
      p_fresh_since: new Date(now - FRESH_WINDOW_MS).toISOString(),
      p_limit: limit,
    });
  } catch (e) {
    const reason = reasonOf(e);
    console.error(`[consult-notify] 상담 잡기 실패 (${reason})`);
    return { ...result, error: reason };
  }

  result.stale = Number(out && out.stale) || 0;
  const rows = Array.isArray(out && out.rows) ? out.rows : [];
  if (result.stale) console.log(`[consult-notify] 24시간 지난 미알림 상담 ${result.stale}건 — 알리지 않고 표시만 함`);
  if (!rows.length) return result;

  const sent = await postToWebhook(env, buildConsultNotice(rows, { adminUrl: consultAdminUrl(env) }));
  if (!sent || !sent.ok) {
    result.failed = rows.length;
    console.error(
      `[consult-notify] Slack 전송 실패 — 상담 ${rows.length}건 알림을 보내지 못함, 다시 보내지 않음 (${reasonOf(sent && sent.error)})`,
    );
    return result;
  }
  result.posted = rows.length;
  return result;
}
