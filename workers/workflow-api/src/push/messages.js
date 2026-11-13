/**
 * 앱 알림 글 — 모든 알림의 제목 · 본문 · 열 곳을 이 파일 하나에서 정한다.
 *
 * 넣지 않는 것: 고객 이름 · 전화 · 주소 · 금액 · 설계 제목(제목에 이름이 들어갈 수 있다).
 *   새 상담 배정(consult_assigned)만 품목 · 시/군/구를 싣는다 — 정해진 목록 · 모양에 맞는 값만.
 *   장부 알림(ledger_*)은 사진 수만 싣는다 — 금액 · 상호 · 메모 · 돌려보낸 이유는 없다.
 * 수주 번호는 서버가 만든 모양(SO-YYYYMMDD-XXXX: 날짜 + 설계 id 앞 4자)일 때만 싣는다 (safeOrderNo).
 * 열 곳은 앱 안(/segan/…)만 — DB 도 ^/segan/ 만 받는다.
 *
 * 다른 워커가 같은 글을 따로 들고 있다 (서로 import 하지 않는다 — 워커마다 따로 배포된다):
 *   workers/account-api/src/push-outbox.js  업체 신청 (partner_application)
 *   workers/payments-api/src/push-outbox.js 결제 실패 · 업체 정지 (billing_failed · company_suspended)
 * 시험이 이 파일과 같은지 본다 — 글을 바꾸면 세 곳을 같이 바꾼다.
 */

/**
 * DB notification_outbox_kind_check 의 종류 (작업자 넷은 0023, 장부 둘 · 아침 브리핑 assistant_brief 는 0030,
 * 장부 알림 ledger_notice 는 0033, A/S 접수 as_request 는 0045, 제작 의뢰 셋 production_* 은 0050,
 * 제작 의뢰 거둠 production_cancelled 는 0053, 팩토리 대표 · 실장에게 가는 작업자 알림 셋 work_link_request ·
 * work_reply · work_report 는 0064).
 */
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
  'ledger_pending',
  'ledger_returned',
  'ledger_notice',
  'assistant_brief',
  'as_request',
  'production_recommended',
  'production_offered',
  'production_answered',
  'production_cancelled',
  'work_link_request',
  'work_reply',
  'work_report',
]);

/** 작업자 알림 — 업체 없이(company_id 비움) 넣고 업체 없는 기기로 간다 (DB notification_outbox_company_check, 0023) */
export const WORK_NOTIFICATION_KINDS = Object.freeze(['work_invited', 'work_registration', 'work_assigned', 'work_schedule']);

/**
 * 팩토리 대표 · 실장에게 가는 작업자 알림 (0064) — 업체 칸이 있어야 한다. 받는 사람은 그 팩토리의 대표 · 실장 (sender.js).
 *   work_link_request  작업자가 연결을 신청함      work_reply  배정을 수락 · 거절 · 포기함      work_report  완료 · 문제를 보고함
 */
export const WORK_MANAGER_KINDS = Object.freeze(['work_link_request', 'work_reply', 'work_report']);

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
      ? '팩토리 신청 미팅 일정이 바뀌었습니다. 내 정보에서 확인해 주세요.'
      : '팩토리 신청 미팅이 잡혔습니다. 내 정보에서 일정을 확인해 주세요.';
  } else if (status === 'approved') {
    body = upgrade
      ? 'Agent 등급 신청이 승인되었습니다. 다음 결제일부터 바뀝니다.'
      : '팩토리 신청이 승인되었습니다. 내 정보에서 다음 단계를 확인해 주세요.';
  } else if (status === 'held') {
    body = '팩토리 신청이 보류되었습니다. 내 정보에서 확인해 주세요.';
  } else {
    return null;
  }
  return { title: '팩토리 신청', body, url: PARTNER_URL };
}

/**
 * 결제 실패 — 업체 대표에게, 재시도가 시작될 때(첫 실패). 금액은 싣지 않는다.
 * 마지막 재시도도 실패해 업체가 정지되는 실행에서는 보내지 않고 업체 정지 하나만 간다 (payments-api).
 */
function billingFailed() {
  return {
    title: '결제 실패',
    body: '팩토리 구독 결제가 되지 않았습니다. 결제 관리에서 결제 수단을 확인해 주세요.',
    url: PARTNER_URL,
  };
}

/** 업체 정지 — 업체 대표에게 */
function companySuspended() {
  return {
    title: '팩토리 정지',
    body: '결제가 되지 않아 팩토리가 정지되었습니다. 결제 관리에서 확인해 주세요.',
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
export const WORK_KIND_LABELS = Object.freeze({ install: '설치', as: 'A/S', assembly: '조립', cutting: '재단', edge: '엣지', demolition: '철거' });
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

/** 알림 글에 싣는 팩토리 이름 — 30자까지, 없으면 null */
function companyLabel(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? [...s].slice(0, 30).join('') : null;
}

/**
 * 작업자 신청 결과. { status: approved | rejected }
 * companyName 이 있으면 그 팩토리와의 연결 결과 (0064 — 팩토리 대표 · 실장이 승인 · 반려).
 */
function workRegistration({ status, companyName } = {}) {
  const co = companyLabel(companyName);
  if (co && status === 'approved') {
    return { title: '팩토리 연결', body: `${co} 연결이 승인되었습니다. 작업 탭에서 확인해 주세요.`, url: WORK_URL };
  }
  if (co && status === 'rejected') {
    return { title: '팩토리 연결', body: `${co} 연결이 승인되지 않았습니다. 작업 탭에서 확인해 주세요.`, url: WORK_URL };
  }
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

/**
 * 작업 일정 바뀜 — 맡은 작업의 시각이 바뀜. { jobKind, startsAt(새 시각), jobId }
 * cancelled 가 true 면 일정이 취소돼 그 작업이 취소된 것 — 같은 종류(work_schedule)로 글만 다르다
 */
function workSchedule(p) {
  const j = workJob(p);
  if (!j) return null;
  if (p && p.cancelled === true) {
    return { title: '작업 취소', body: `${j.what}이 취소되었습니다. 작업 탭에서 확인해 주세요.`, url: j.url };
  }
  const body = j.day
    ? `${j.label} 작업 일정이 ${j.day}(으)로 바뀌었습니다. 작업 탭에서 확인해 주세요.`
    : `${j.label} 작업 일정이 바뀌었습니다. 작업 탭에서 확인해 주세요.`;
  return { title: '작업 일정 바뀜', body, url: j.url };
}

/** 팩토리 쪽 화면 — 인사 › 작업자 · 설치 · A/S 일정 · 프로젝트(작업 배정) */
export const COMPANY_WORKERS_URL = '/segan/me.html#workers';
export const COMPANY_INSTALL_URL = '/segan/me.html#p-install';
export const COMPANY_AS_URL = '/segan/me.html#p-as';
export const COMPANY_PROJECT_URL = '/segan/me.html#dash-project';
/** 설치 · A/S 는 그 일정 화면, 철거 · 재단 · 엣지 · 조립은 프로젝트의 「작업 배정」 */
const companyJobUrl = (jobKind) => (jobKind === 'as' ? COMPANY_AS_URL : jobKind === 'install' ? COMPANY_INSTALL_URL : COMPANY_PROJECT_URL);

const companyWhere = (jobKind) => (jobKind === 'as' || jobKind === 'install' ? '일정' : '프로젝트');

/** 작업자가 연결을 신청함 — 이름 · 전화는 싣지 않는다 (화면에서 본다) */
function workLinkRequest() {
  return { title: '작업자 연결 신청', body: '작업자가 팩토리 연결을 신청했습니다. 인사 › 작업자에서 확인해 주세요.', url: COMPANY_WORKERS_URL };
}

const WORK_REPLY_TEXT = Object.freeze({ confirmed: '수락했습니다', declined: '거절했습니다', released: '포기했습니다' });

/** 작업자가 배정에 답함. { reply: confirmed | declined | released, jobKind, startsAt } — 작업자 이름 · 사유는 싣지 않는다 */
function workReply({ reply, jobKind, startsAt } = {}) {
  const said = Object.prototype.hasOwnProperty.call(WORK_REPLY_TEXT, reply) ? WORK_REPLY_TEXT[reply] : null;
  const j = workJob({ jobKind, startsAt });
  if (!said || !j) return null;
  return { title: '작업 배정 답', body: `작업자가 ${j.what} 배정을 ${said}. ${companyWhere(jobKind)}에서 확인해 주세요.`, url: companyJobUrl(jobKind) };
}

/** 작업자가 보고함. { report: result | issue, jobKind, startsAt } — 보고 글은 싣지 않는다 */
function workReport({ report, jobKind, startsAt } = {}) {
  const j = workJob({ jobKind, startsAt });
  if (!j) return null;
  if (report === 'result') return { title: '작업 완료 보고', body: `${j.what} 완료 보고가 왔습니다. ${companyWhere(jobKind)}에서 확인해 주세요.`, url: companyJobUrl(jobKind) };
  if (report === 'issue') return { title: '작업 문제 보고', body: `${j.what}에 문제 보고가 왔습니다. ${companyWhere(jobKind)}에서 확인해 주세요.`, url: companyJobUrl(jobKind) };
  return null;
}

/** 장부 화면 (내 정보 › 회계 › 장부 — 대표 · 실장은 「확인할 사진」, 직원은 올린 사진 상태) */
export const LEDGER_URL = '/segan/ledger.html';
/** 확인할 사진 수 — 이보다 많으면 「N장 넘게」 */
export const LEDGER_PENDING_MAX = 999;

/** 확인할 사진 — 업체 대표 · 실장에게. { count } (확인 기다리는 사진 수, 1 이상) */
function ledgerPending({ count } = {}) {
  if (!Number.isInteger(count) || count < 1) return null;
  const n = count > LEDGER_PENDING_MAX ? `${LEDGER_PENDING_MAX}장 넘게` : `${count}장`;
  return { title: '확인할 사진', body: `확인할 영수증 · 명세표 사진이 ${n} 있습니다.`, url: LEDGER_URL };
}

/** 장부 알림 카드가 쌓이는 곳 — 비서 탭 「장부 알림」 */
export const LEDGER_NOTICE_URL = '/segan/assistant.html';

/**
 * 장부 알림 — 업체 대표 · 실장에게. { count, digest, ai } (아직 안 본 알림 수, 1 이상).
 * ai false(사진 AI 읽기 · 비서가 없는 Expert 업체)면 비서 탭 대신 회계 화면으로 — 월 보고 · 명세표 알림이 거기 보인다.
 * digest 면 아침 묶음(단가 · 새 거래처 · 휴업/폐업 · 증빙), 아니면 바로 알림(중복 의심 · 평소와 다른 큰 금액). 금액 · 상호 없음
 */
function ledgerNotice({ count, digest, ai } = {}) {
  if (!Number.isInteger(count) || count < 1) return null;
  const n = count > LEDGER_PENDING_MAX ? `${LEDGER_PENDING_MAX}건 넘게` : `${count}건`;
  if (ai === false) {
    return { title: '장부 알림', body: `장부에 새 알림이 ${n} 있습니다. 회계 화면에서 확인해 주세요.`, url: LEDGER_URL };
  }
  return digest
    ? { title: '장부에 바뀐 점', body: `장부에 바뀐 점이 ${n} 있습니다. 비서 탭에서 확인해 주세요.`, url: LEDGER_NOTICE_URL }
    : { title: '장부 확인 필요', body: `중복 의심 · 평소와 다른 큰 금액이 ${n} 있습니다. 비서 탭에서 확인해 주세요.`, url: LEDGER_NOTICE_URL };
}

/** 돌려받은 사진 — 사진을 올린 사람에게 (이유는 싣지 않는다 — 장부 화면에서 본다) */
function ledgerReturned() {
  return {
    title: '돌려받은 사진',
    body: '올린 영수증 · 명세표 사진이 돌려보내졌습니다. 이유를 확인해 주세요.',
    url: LEDGER_URL,
  };
}

/** 아침 브리핑이 보이는 곳 — 비서 탭 맨 위 「오늘 브리핑」 (src/brief.js) */
export const BRIEF_URL = '/segan/assistant.html';
/** 볼 것 수 — 이보다 많으면 「N건 넘게」 */
export const BRIEF_MAX = 999;

/** 아침 브리핑 — 비서를 쓰는 업체 구성원에게. { count } (그 사람이 볼 것 수, 1 이상). 이름 · 금액 · 무엇인지는 싣지 않는다 */
function assistantBrief({ count } = {}) {
  if (!Number.isInteger(count) || count < 1) return null;
  const n = count > BRIEF_MAX ? `${BRIEF_MAX}건 넘게` : `${count}건`;
  return { title: '오늘 브리핑', body: `오늘 볼 것이 ${n} 있습니다. 비서 탭에서 확인해 주세요.`, url: BRIEF_URL };
}

/** 팩토리 A/S함 (내 정보 › 팩토리 — 2026-11-06 A/S 접수) */
export const AS_URL = '/segan/me.html#as';

/** 새 A/S 접수 — 그 수주의 담당자(없으면 대표 · 실장)에게. { orderNo } — 고객 이름 · 내용은 싣지 않는다 */
function asRequest({ orderNo } = {}) {
  return { title: 'A/S 접수', body: `${orderPart(orderNo)} A/S 접수가 들어왔습니다. A/S함에서 받아 주세요.`, url: AS_URL };
}

/** Manager 업체 › 제작 의뢰 (내 정보 — 2026-11-08 제작 의뢰) */
export const PRODUCTION_REQUESTS_URL = '/segan/me.html#production-requests';
/** 팩토리 › 제작 의뢰함 (내 정보 › 팩토리) */
export const FACTORY_REQUESTS_URL = '/segan/me.html#factory-requests';
/** 한 번에 추천하는 팩토리 수 상한 (production-requests/common.js RECOMMEND_MAX 와 같다) */
export const PRODUCTION_RECOMMEND_MAX = 5;

/** 추천 도착 — 의뢰한 Manager 업체 대표 · 실장에게. { count } (추천한 팩토리 수). 팩토리 이름은 싣지 않는다 */
function productionRecommended({ count } = {}) {
  const n = Number.isInteger(count) && count >= 1 && count <= PRODUCTION_RECOMMEND_MAX ? `${count}곳을` : '';
  return {
    title: '제작 의뢰 추천',
    body: n ? `본사가 제작 의뢰에 팩토리 ${n} 추천했습니다. 맡길 곳을 골라 주세요.` : '본사가 제작 의뢰에 팩토리를 추천했습니다. 맡길 곳을 골라 주세요.',
    url: PRODUCTION_REQUESTS_URL,
  };
}

/** 제작 의뢰 품목 이름 — 상담 품목 키만, 목록 밖이면 '' */
const productionItem = (item) =>
  typeof item === 'string' && Object.prototype.hasOwnProperty.call(CONSULT_ITEM_LABELS, item) ? CONSULT_ITEM_LABELS[item] : '';

/** 새 제작 의뢰 — Manager 가 고른 팩토리 대표 · 실장에게. { item } (품목 키 — 목록 밖이면 뺀다). 업체 이름 · 메모 · 설계 이름 없음 */
function productionOffered({ item } = {}) {
  const label = productionItem(item);
  return {
    title: '새 제작 의뢰',
    body: `${label ? `${label} ` : ''}제작 의뢰가 왔습니다. 24시간 안에 받기 · 못 받음을 골라 주세요.`,
    url: FACTORY_REQUESTS_URL,
  };
}

/** 의뢰 거둠 — 답을 기다리던(chosen) 팩토리 대표 · 실장에게. { item } (품목 키 — 목록 밖이면 뺀다). 업체 이름 · 메모 · 설계 이름 없음 */
function productionCancelled({ item } = {}) {
  const label = productionItem(item);
  return {
    title: '제작 의뢰 거둠',
    body: `의뢰한 업체가 ${label ? `${label} ` : ''}제작 의뢰를 거뒀습니다. 받기 · 못 받음을 고르지 않아도 됩니다.`,
    url: FACTORY_REQUESTS_URL,
  };
}

/** 팩토리 답 — 의뢰한 Manager 업체 대표 · 실장에게. { answer: accepted | declined | expired } */
function productionAnswered({ answer } = {}) {
  if (answer === 'accepted') {
    return { title: '제작 의뢰 받음', body: '고른 팩토리가 제작 의뢰를 받았습니다. 제작 의뢰에서 확인해 주세요.', url: PRODUCTION_REQUESTS_URL };
  }
  if (answer === 'declined') {
    return { title: '제작 의뢰 못 받음', body: '고른 팩토리가 제작 의뢰를 받지 못했습니다. 본사가 다시 추천해 드립니다.', url: PRODUCTION_REQUESTS_URL };
  }
  if (answer === 'expired') {
    return { title: '제작 의뢰 답 없음', body: '고른 팩토리가 24시간 안에 답하지 않았습니다. 본사가 다시 추천해 드립니다.', url: PRODUCTION_REQUESTS_URL };
  }
  return null;
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
  ledger_pending: ledgerPending,
  ledger_returned: ledgerReturned,
  ledger_notice: ledgerNotice,
  assistant_brief: assistantBrief,
  as_request: asRequest,
  production_recommended: productionRecommended,
  production_offered: productionOffered,
  production_answered: productionAnswered,
  production_cancelled: productionCancelled,
  work_link_request: workLinkRequest,
  work_reply: workReply,
  work_report: workReport,
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
