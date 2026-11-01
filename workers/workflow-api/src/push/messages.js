/**
 * 앱 알림 글 — 모든 알림의 제목 · 본문 · 열 곳을 이 파일 하나에서 정한다.
 *
 * 넣지 않는 것: 고객 이름 · 전화 · 주소 · 금액 · 설계 제목(제목에 이름이 들어갈 수 있다).
 *   새 상담 배정(consult_assigned)만 품목 · 시/군/구를 싣는다 — 정해진 목록 · 모양에 맞는 값만.
 * 수주 번호는 서버가 만든 모양(SO-YYYYMMDD-XXXX: 날짜 + 설계 id 앞 4자)일 때만 싣는다 (safeOrderNo).
 * 열 곳은 앱 안(/segan/…)만 — DB 도 ^/segan/ 만 받는다.
 *
 * 다른 워커가 같은 글을 따로 들고 있다 (서로 import 하지 않는다 — 워커마다 따로 배포된다):
 *   workers/account-api/src/push-outbox.js  업체 신청 (partner_application)
 *   workers/payments-api/src/push-outbox.js 결제 실패 · 업체 정지 (billing_failed · company_suspended)
 * 시험이 이 파일과 같은지 본다 — 글을 바꾸면 세 곳을 같이 바꾼다.
 */

/** DB notification_outbox_kind_check 와 같다 (작업자 넷은 0023) */
export const NOTIFICATION_KINDS = Object.freeze([
  'order_request',
  'order_request_decided',
  'confirmation_decided',
  'partner_application',
  'billing_failed',
  'company_suspended',
  'consult_assigned',
  'work_invited',
  'work_registration',
  'work_assigned',
  'work_schedule',
]);

/** 작업자 알림 — 업체 없이(company_id 비움) 넣고 업체 없는 기기로 간다 (DB notification_outbox_company_check, 0023) */
export const WORK_NOTIFICATION_KINDS = Object.freeze(['work_invited', 'work_registration', 'work_assigned', 'work_schedule']);

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

/** 업체 › 상담 (배정 상담 받기 · 못 받음) */
export const PARTNER_CONSULTS_URL = '/segan/me.html#partner-consults';

/** 상담 품목 키 → 이름 — consult-notify.js FURNITURE_LABELS 와 같다 (시험이 견준다. 이 파일은 import 하지 않는다) */
export const CONSULT_ITEM_LABELS = Object.freeze({
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  fridge: '냉장고장',
  shoerack: '신발장',
  vanity: '화장대',
  storage: '수납장',
  other: '기타',
});

/** 시/군/구 모양 (consult-notify.js 와 같다) — 이 모양이 아니면 싣지 않는다 */
const GUGUN_RE = /^[가-힣]{1,10}(?:시|군|구)$/;

/**
 * 새 상담 배정 — 업체 대표 · 실장에게. { items: 품목 키[], gugun }
 * 품목 · 시/군/구만 싣는다 (이름 · 전화 · 요청 내용 없음). 목록 밖 품목 · 모양이 틀린 시/군/구는 뺀다.
 */
function consultAssigned({ items = [], gugun = null } = {}) {
  const labels = [];
  for (const k of Array.isArray(items) ? items : []) {
    const label =
      typeof k === 'string' && Object.prototype.hasOwnProperty.call(CONSULT_ITEM_LABELS, k)
        ? CONSULT_ITEM_LABELS[k]
        : null;
    if (label && !labels.includes(label)) labels.push(label);
  }
  const parts = [
    labels.join('·'),
    typeof gugun === 'string' && GUGUN_RE.test(gugun) ? gugun : '',
  ].filter(Boolean);
  const head = parts.length ? `${parts.join(' · ')} 상담이` : '상담이';
  return {
    title: '새 상담 배정',
    body: `${head} 배정되었습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.`,
    url: PARTNER_CONSULTS_URL,
  };
}

/** 작업 탭 (앱 「작업」 — 예전 worker.html 작업자 포털) */
export const WORK_URL = '/segan/work.html';

/** 작업 종류 이름 — work/validate.js WORK_KINDS 와 같은 키 (작업 제목 · 지역은 싣지 않는다 — 고객 이름 · 주소가 섞일 수 있다) */
export const WORK_KIND_LABELS = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립' });
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 작업 날 — 한국 시간 'M/D(요일)', 모르면 '' */
export function workDay(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const k = new Date(t + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()}(${WEEKDAY[k.getUTCDay()]})`;
}

/** 작업 한 줄 — 「11/5(목) 설치 작업」, 열 곳은 그 작업 (#job=) — 종류를 모르면 null */
function workJob({ jobKind, startsAt, jobId } = {}) {
  const label = Object.prototype.hasOwnProperty.call(WORK_KIND_LABELS, jobKind) ? WORK_KIND_LABELS[jobKind] : null;
  if (!label) return null;
  const day = workDay(startsAt);
  const url = typeof jobId === 'string' && JOB_ID_RE.test(jobId) ? `${WORK_URL}#job=${jobId.toLowerCase()}` : WORK_URL;
  return { what: `${day ? `${day} ` : ''}${label} 작업`, day, label, url };
}

/** 작업 초대 — 관리자가 작업에 초대(배정 제안)함. { jobKind, startsAt, jobId } */
function workInvited(p) {
  const j = workJob(p);
  if (!j) return null;
  return { title: '작업 초대', body: `${j.what}에 초대받았습니다. 수락하거나 거절해 주세요.`, url: j.url };
}

/** 작업자 신청 결과. { status: approved | rejected } */
function workRegistration({ status } = {}) {
  if (status === 'approved') {
    return { title: '작업자 신청', body: '작업자 신청이 승인되었습니다. 작업 탭에서 작업을 보고 신청할 수 있습니다.', url: WORK_URL };
  }
  if (status === 'rejected') {
    return { title: '작업자 신청', body: '작업자 신청이 승인되지 않았습니다. 작업 탭에서 확인해 주세요.', url: WORK_URL };
  }
  return null;
}

/** 작업 확정 — 신청한 작업에 뽑힘. { jobKind, startsAt, jobId } */
function workAssigned(p) {
  const j = workJob(p);
  if (!j) return null;
  return { title: '작업 확정', body: `${j.what}에 확정되었습니다. 작업 탭에서 확인해 주세요.`, url: j.url };
}

/** 작업 일정 바뀜 — 맡은 작업의 시각이 바뀜. { jobKind, startsAt(새 시각), jobId } */
function workSchedule(p) {
  const j = workJob(p);
  if (!j) return null;
  const body = j.day
    ? `${j.label} 작업 일정이 ${j.day}(으)로 바뀌었습니다. 작업 탭에서 확인해 주세요.`
    : `${j.label} 작업 일정이 바뀌었습니다. 작업 탭에서 확인해 주세요.`;
  return { title: '작업 일정 바뀜', body, url: j.url };
}

const BUILDERS = Object.freeze({
  order_request: orderRequest,
  order_request_decided: orderRequestDecided,
  confirmation_decided: confirmationDecided,
  partner_application: partnerApplication,
  billing_failed: billingFailed,
  company_suspended: companySuspended,
  consult_assigned: consultAssigned,
  work_invited: workInvited,
  work_registration: workRegistration,
  work_assigned: workAssigned,
  work_schedule: workSchedule,
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
