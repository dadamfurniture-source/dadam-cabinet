/**
 * 작업자 포털 — 작업자에게 가는 JSON 을 한 곳에서 깎는다 (순수 함수, docs/01-plan/worker-portal-contract.md §3 응답 모양).
 *
 * 작업자 응답은 반드시 이 파일의 함수를 거친다. DB 행을 그대로 내보내지 않는다.
 *   - 금액은 pay_visible 일 때만 (원가 · 마진은 어디에도 없다)
 *   - 주문번호 · 가린 고객 이름은 내 배정이 활성일 때만
 *   - 현장 주소 · 연락처는 1주차에 어디에도 없다 (공개 기간 ★7 미정) — site: null + 안내 문구
 *   - 다른 작업자의 이름 · 신청 · 관리자 메모는 없다
 * 금지 키(FORBIDDEN_KEYS)는 시험이 모든 작업자 응답을 깊이 훑어 고정한다.
 */

import { maskName } from '../share.js';

/** 작업자 응답에 절대 없는 키. phone 은 작업자 본인 정보(WorkerSelf)에서만 허용 */
export const FORBIDDEN_KEYS = Object.freeze(['address', 'phone', 'customer_name', 'cost', 'margin', 'note']);

export const SITE_NOTE = '현장 주소·연락처는 공개 기간이 정해지면 열립니다';

/** 정원에 세는 배정 상태 */
export const COUNTED_STATUSES = Object.freeze(['confirmed', 'started', 'submitted', 'revision', 'accepted']);
/** 활성 배정 (부분 고유 인덱스와 같다) */
export const ACTIVE_STATUSES = Object.freeze(['offered', ...COUNTED_STATUSES]);

/** 저장된 상태 + 마감 판정. open 이고 apply_deadline 이 지났으면 'expired' (저장하지 않는다) */
export function effectiveStatus(job, now = Date.now()) {
  if (!job) return null;
  if (job.status === 'open' && job.apply_deadline) {
    const t = new Date(job.apply_deadline).getTime();
    if (Number.isFinite(t) && t < now) return 'expired';
  }
  return job.status;
}

/** 작업자 본인 정보 */
export function workerSelf(w) {
  if (!w) return null;
  return {
    id: w.id,
    status: w.status,
    display_name: w.display_name,
    phone: w.phone || null,
    kinds: Array.isArray(w.kinds) ? w.kinds : [],
    region_label: w.region_label || null,
    photo_consent: w.photo_consent === true,
    consent_version: w.consent_version || null,
    reject_reason: w.reject_reason || null,
  };
}

/** 내 신청 (편집자의 결정 사유는 내보내지 않는다 — 내부 판단이 섞일 수 있다) */
export function workerApplication(a) {
  if (!a) return null;
  return {
    id: a.id,
    job_id: a.job_id,
    status: a.status,
    message: a.message || null,
    created_at: a.created_at || null,
    decided_at: a.decided_at || null,
  };
}

/** 내 배정 (no_show · 만든 사람 · 이름 사본은 관리자용) */
export function workerAssignment(a) {
  if (!a) return null;
  return {
    id: a.id,
    job_id: a.job_id,
    status: a.status,
    via: a.via,
    started_at: a.started_at || null,
    submitted_at: a.submitted_at || null,
    accepted_at: a.accepted_at || null,
    revision_count: a.revision_count || 0,
    release_reason: a.release_reason || null,
    created_at: a.created_at || null,
  };
}

/** 기록 한 줄 (쓴 사람 계정 id 는 빼고 역할만) */
export function workerUpdate(u) {
  if (!u) return null;
  return {
    id: u.id,
    assignment_id: u.assignment_id || null,
    author_role: u.author_role,
    kind: u.kind,
    body: u.body,
    issue_chips: Array.isArray(u.issue_chips) ? u.issue_chips : [],
    amends_id: u.amends_id || null,
    created_at: u.created_at || null,
  };
}

/** 한 작업에서 내 배정 여럿 중 대표 하나 — 활성 우선, 그다음 최근 */
export function pickAssignment(list) {
  const rows = (list || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows.find((a) => ACTIVE_STATUSES.includes(a.status)) || rows[0] || null;
}

/** 작업 카드 */
export function jobCard(job, { filled = 0, application = null, assignment = null, now = Date.now() } = {}) {
  const card = {
    id: job.id,
    kind: job.kind,
    title: job.title,
    region_label: job.region_label || null,
    starts_at: job.starts_at || null,
    ends_at: job.ends_at || null,
    apply_deadline: job.apply_deadline || null,
    slots: job.slots,
    filled,
    effective_status: effectiveStatus(job, now),
    my: {},
  };
  if (job.pay_visible === true && job.pay_amount !== null && job.pay_amount !== undefined) {
    card.pay = { amount: job.pay_amount, unit: job.pay_unit || null };
  }
  if (application) {
    card.my.application_id = application.id;
    card.my.application_status = application.status;
  }
  if (assignment) {
    card.my.assignment_id = assignment.id;
    card.my.assignment_status = assignment.status;
    // 거절 · 포기 사유(작업자 본인 글) 또는 작업 마감 · 취소로 끝난 초대의 안내 — 지난 작업 탭에서 보인다.
    // 편집자 제외(removed) 사유는 이 칸에 없다 (이벤트에만)
    if (assignment.release_reason) card.my.release_reason = assignment.release_reason;
  }
  return card;
}

/**
 * 작업 상세. order 는 { order_no, customer_name } (없으면 null) — 내 배정이 활성일 때만 주문번호 · 가린 이름을 싣는다.
 * timeline 은 부르는 쪽이 이미 고른 기록 (visible_to_worker · 내 배정 관련 + 작업 전체 회사 공지).
 */
export function jobDetail(job, { filled = 0, application = null, assignment = null, order = null, timeline = [], now = Date.now() } = {}) {
  const out = {
    ...jobCard(job, { filled, application, assignment, now }),
    detail: job.detail || null,
    site: null,
    site_note: SITE_NOTE,
    timeline: (timeline || []).map(workerUpdate),
  };
  if (assignment && ACTIVE_STATUSES.includes(assignment.status) && order) {
    if (order.order_no) out.order_no = order.order_no;
    const masked = maskName(order.customer_name);
    if (masked) out.customer_masked = masked;
  }
  return out;
}

/** 값 안의 금지 키 경로 (시험 · 방어용). allowPhoneAt 는 phone 을 허용하는 경로 접두 */
export function findForbiddenKeys(value, { allowPhoneAt = [] } = {}, path = '$') {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findForbiddenKeys(v, { allowPhoneAt }, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      const allowed = k === 'phone' && allowPhoneAt.some((pre) => p === `${pre}.phone`);
      if (FORBIDDEN_KEYS.includes(k) && !allowed) hits.push(p);
      hits.push(...findForbiddenKeys(v, { allowPhoneAt }, p));
    }
  }
  return hits;
}
