/**
 * 앱 알림 글 — 모든 알림의 제목 · 본문 · 열 곳을 이 파일 하나에서 정한다.
 *
 * 넣지 않는 것: 고객 이름 · 전화 · 주소 · 금액 · 설계 제목(제목에 이름이 들어갈 수 있다).
 * 수주 번호는 서버가 만든 모양(SO-YYYYMMDD-XXXX: 날짜 + 설계 id 앞 4자)일 때만 싣는다 (safeOrderNo).
 * 열 곳은 앱 안(/segan/…)만 — DB 도 ^/segan/ 만 받는다.
 *
 * 다른 워커가 같은 글을 따로 들고 있다 (서로 import 하지 않는다 — 워커마다 따로 배포된다):
 *   workers/account-api/src/push-outbox.js  업체 신청 (partner_application)
 *   workers/payments-api/src/push-outbox.js 결제 실패 · 업체 정지 (billing_failed · company_suspended)
 * 시험이 이 파일과 같은지 본다 — 글을 바꾸면 세 곳을 같이 바꾼다.
 */

/** DB notification_outbox_kind_check 와 같다 */
export const NOTIFICATION_KINDS = Object.freeze([
  'order_request',
  'order_request_decided',
  'confirmation_decided',
  'partner_application',
  'billing_failed',
  'company_suspended',
  'consult_assigned',
]);

/** 글자 수 상한 (DB notification_outbox_text_check · url_check 와 같다, 코드 포인트로 센다) */
export const TITLE_MAX = 60;
export const BODY_MAX = 160;
export const URL_MAX = 300;

/** 내 정보 › 업체 (결제 관리 · 신청 · 요청이 모두 여기서 이어진다) */
export const PARTNER_URL = '/segan/me.html#partner';

/** 서버가 만드는 수주 번호 (orders.js buildOrderNo — 'SO-' + 날짜 8자리 + 설계 id 앞 4자) */
const ORDER_NO_RE = /^SO-\d{8}-[0-9A-F]{4}$/;

/** 개인정보가 없는 수주 번호만 — 아니면 null */
export function safeOrderNo(v) {
  return typeof v === 'string' && ORDER_NO_RE.test(v) ? v : null;
}

/** 대표 승인이 필요한 수주 요청 종류 (order-events.js EVENT_KIND_LABELS 의 revive · revert) */
export const ORDER_REQUEST_LABELS = Object.freeze({
  revive: '되살리기',
  revert: '완료 되돌리기',
});

const orderPart = (orderNo) => {
  const no = safeOrderNo(orderNo);
  return no ? `수주 ${no}` : '수주';
};

/** 승인 요청 — 대표에게. { eventKind: revive | revert, orderNo } */
function orderRequest({ eventKind, orderNo } = {}) {
  const label = ORDER_REQUEST_LABELS[eventKind];
  if (!label) return null;
  return { title: '승인 요청', body: `${orderPart(orderNo)} ${label} 요청이 왔습니다. 확인해 주세요.`, url: PARTNER_URL };
}

/** 요청 결과 — 요청한 사람에게. { eventKind, orderNo, approved } */
function orderRequestDecided({ eventKind, orderNo, approved } = {}) {
  const label = ORDER_REQUEST_LABELS[eventKind];
  if (!label || typeof approved !== 'boolean') return null;
  return {
    title: '요청 결과',
    body: `${orderPart(orderNo)} ${label} 요청이 ${approved ? '승인' : '반려'}되었습니다.`,
    url: PARTNER_URL,
  };
}

/** 고객 확인서 결정 — 설계 업체에. { approved } (설계 제목 · 고객 이름은 싣지 않는다) */
function confirmationDecided({ approved } = {}) {
  if (typeof approved !== 'boolean') return null;
  return {
    title: '고객 확인서',
    body: approved ? '고객이 확인서를 승인했습니다.' : '고객이 확인서를 반려했습니다. 수정 요청을 확인해 주세요.',
    url: PARTNER_URL,
  };
}

/** 업체 신청 — 신청한 사람에게. { status: meeting | approved | held, upgrade, rescheduled } */
function partnerApplication({ status, upgrade = false, rescheduled = false } = {}) {
  let body;
  if (status === 'meeting') {
    body = rescheduled
      ? '업체 신청 미팅 일정이 바뀌었습니다. 내 정보에서 확인해 주세요.'
      : '업체 신청 미팅이 잡혔습니다. 내 정보에서 일정을 확인해 주세요.';
  } else if (status === 'approved') {
    body = upgrade
      ? 'Agent 등급 신청이 승인되었습니다. 다음 결제일부터 바뀝니다.'
      : '업체 신청이 승인되었습니다. 내 정보에서 다음 단계를 확인해 주세요.';
  } else if (status === 'held') {
    body = '업체 신청이 보류되었습니다. 내 정보에서 확인해 주세요.';
  } else {
    return null;
  }
  return { title: '업체 신청', body, url: PARTNER_URL };
}

/**
 * 결제 실패 — 업체 대표에게, 재시도가 시작될 때(첫 실패). 금액은 싣지 않는다.
 * 마지막 재시도도 실패해 업체가 정지되는 실행에서는 보내지 않고 업체 정지 하나만 간다 (payments-api).
 */
function billingFailed() {
  return {
    title: '결제 실패',
    body: '업체 구독 결제가 되지 않았습니다. 결제 관리에서 결제 수단을 확인해 주세요.',
    url: PARTNER_URL,
  };
}

/** 업체 정지 — 업체 대표에게 */
function companySuspended() {
  return {
    title: '업체 정지',
    body: '결제가 되지 않아 업체가 정지되었습니다. 결제 관리에서 확인해 주세요.',
    url: PARTNER_URL,
  };
}

const BUILDERS = Object.freeze({
  order_request: orderRequest,
  order_request_decided: orderRequestDecided,
  confirmation_decided: confirmationDecided,
  partner_application: partnerApplication,
  billing_failed: billingFailed,
  company_suspended: companySuspended,
});

/**
 * 알림 글 — { title, body, url }. 모르는 종류 · 맞지 않는 값이면 null.
 * @param {string} kind  NOTIFICATION_KINDS 중 하나
 * @param {object} [params]  종류마다 위 함수의 값
 */
export function buildMessage(kind, params = {}) {
  const fn = Object.prototype.hasOwnProperty.call(BUILDERS, kind) ? BUILDERS[kind] : null;
  return fn ? fn(params || {}) : null;
}

/** 글자 수 (DB length() 처럼 코드 포인트) */
export const charLen = (s) => [...String(s)].length;

/** DB CHECK 를 지키는 알림 글인가 */
export function isValidMessage(m) {
  return (
    !!m &&
    typeof m.title === 'string' &&
    typeof m.body === 'string' &&
    typeof m.url === 'string' &&
    charLen(m.title) >= 1 &&
    charLen(m.title) <= TITLE_MAX &&
    charLen(m.body) >= 1 &&
    charLen(m.body) <= BODY_MAX &&
    m.url.startsWith('/segan/') &&
    m.url.length <= URL_MAX
  );
}
