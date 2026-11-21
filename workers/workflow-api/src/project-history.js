/**
 * 프로젝트 일지(project_events, DB 0078)를 「일어난 일」(프로젝트 한 건 창)과 「소식」(새로 생긴 일)에 얹는다.
 * 2026-11-21 대표님 「프로젝트 한 길」 뒤 공정 1차 — 「누가 했는지」 · 여러 번 바뀐 것도 남기기.
 *
 * 지금까지 두 화면은 각 표의 시각 칸(created_at · decided_at …)에서 일을 뽑았다 (이하 「뽑은 줄」).
 * 일지가 생긴 뒤의 일은 일지가 정본이고, 그전의 일은 뽑은 줄뿐이다. 그래서 둘을 합친다:
 *   · 뽑은 줄과 같은 일(같은 kind · 같은 대상)을 일지에서 찾으면 — 그 줄에 「누가」만 붙인다 (가장 새 것부터 짝짓는다)
 *   · 짝 없는 일지 줄은 — 그대로 한 줄 더한다 (보류 · 생산 시작 · 수주 취소 · 담당자처럼 시각 칸에서 못 뽑는 일,
 *     같은 일이 여러 번 일어난 것의 앞 차례들)
 * 순수 함수뿐이다 — DB 를 읽지 않는다.
 *
 * who { kind: 'member' | 'customer' | 'worker' | 'admin' | 'system', name: string | null }
 *   구성원이면 이름(나간 사람이면 null). 고객 이름은 싣지 않는다 — 화면이 「고객」이라고만 적는다.
 */

import { SCHEDULE_LABELS } from './slack.js';

/** 일정 종류마다 — 잡음 · 날짜 바꿈 · 취소 (종류 말은 slack.js SCHEDULE_LABELS: 실측 · 납품 · 설치 · A/S 방문 …) */
function scheduleLabels() {
  const out = {};
  for (const [type, word] of Object.entries(SCHEDULE_LABELS)) {
    out[`schedule_set_${type}`] = `${word} 일정을 잡았습니다`;
    out[`schedule_moved_${type}`] = `${word} 일정을 바꿨습니다`;
    out[`schedule_cancelled_${type}`] = `${word} 일정을 취소했습니다`;
  }
  return out;
}

/** 일지에만 있는 일의 글 (뽑은 줄의 글은 company-inbox.js NEWS_LABEL · company-project.js HISTORY_LABEL) */
export const EVENT_LABEL = Object.freeze({
  design_sent: '설계를 앱으로 보냈습니다',
  design_unlinked: '설계 잇기를 풀었습니다',
  quote_revoked: '견적서를 거뒀습니다',
  document_issued: '지시서를 냈습니다',
  document_revoked: '지시서를 거뒀습니다',
  order_started: '생산을 시작했습니다',
  order_cancelled: '계약(수주)을 취소했습니다',
  order_reverted: '수주를 접수로 되돌렸습니다',
  order_requested: '수주 상태 바꾸기를 요청했습니다',
  deposit_paid: '계약금이 들어왔습니다',
  balance_paid: '잔금이 들어왔습니다',
  payment_paid: '돈이 들어왔습니다',
  project_held: '프로젝트를 보류했습니다',
  project_resumed: '프로젝트를 다시 진행합니다',
  project_cancelled: '프로젝트를 그만뒀습니다',
  assignee_set: '담당자를 정했습니다',
  assignee_cleared: '담당자를 비웠습니다',
  // 둘째 묶음 (2026-11-21) — 제작 의뢰 · 일정 · A/S · 완료 보고 · 설계 시작
  design_started: '설계를 시작했습니다',
  measure_done: '실측을 끝냈습니다',
  install_confirmed: '설치 날을 고객과 확인했습니다',
  request_sent: '제작 의뢰를 보냈습니다',
  request_chosen: '팩토리를 골랐습니다',
  request_cancelled: '제작 의뢰를 거뒀습니다',
  as_cancelled: 'A/S 접수를 거뒀습니다',
  report_install_done: '설치 완료 보고를 올렸습니다',
  report_as_done: 'A/S 완료 보고를 올렸습니다',
  ...scheduleLabels(),
});

/** 글이 이미 누가 했는지 말하는 일 — 「누가」를 또 붙이지 않는다 (「본사 추천이 도착했습니다 · 본사」가 되지 않게) */
const NO_WHO = Object.freeze(['request_recommended']);

/** 같은 일을 두 번 누른 것으로 보는 사이 (ms) */
const DOUBLE_MS = 60 * 1000;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (typeof v === 'string' && v ? v : null);

/**
 * 일지 한 줄 → { kind, ref, go } | null (모르는 일은 null — 화면에 내지 않는다).
 * kind 는 뽑은 줄과 같은 이름을 쓴다 (짝짓기 · 글).
 */
export function eventKind(ev) {
  const e = obj(ev);
  const payload = obj(e.payload);
  const subject = str(e.subject_id);
  switch (e.type) {
    case 'project_created':
    case 'consult_accepted':
      return { kind: 'project_created', ref: subject, go: null };
    case 'design_linked':
      return { kind: 'design_linked', ref: subject, go: null };
    case 'design_unlinked':
    case 'design_sent':
      return { kind: e.type, ref: subject, go: null };
    case 'quote_sent':
    case 'quote_viewed':
    case 'quote_approved':
    case 'quote_rejected':
    case 'quote_revoked':
      return { kind: e.type, ref: subject, go: 'p-quote' };
    case 'document_issued':
    case 'document_revoked':
      return { kind: e.type, ref: subject, go: null };
    case 'order_created':
      return { kind: 'order_created', ref: subject, go: 'p-contract' };
    case 'order_requested':
      return { kind: 'order_requested', ref: subject, go: 'p-contract' };
    case 'approval_approved':
    case 'approval_rejected':
      return { kind: e.type, ref: subject, go: 'p-contract' };
    case 'order_status': {
      const to = e.to_status;
      if (to === 'in_production') return { kind: 'order_started', ref: subject, go: 'p-make' };
      if (to === 'delivered') return { kind: 'order_delivered', ref: subject, go: 'p-install' };
      if (to === 'completed') return { kind: 'order_completed', ref: subject, go: 'p-install' };
      if (to === 'cancelled') return { kind: 'order_cancelled', ref: subject, go: 'p-contract' };
      if (to === 'confirmed') return { kind: 'order_reverted', ref: subject, go: 'p-contract' };
      return null;
    }
    case 'payment_paid': {
      const kind =
        payload.stage === 'deposit'
          ? 'deposit_paid'
          : payload.stage === 'balance'
            ? 'balance_paid'
            : 'payment_paid';
      return { kind, ref: str(payload.order_id) || subject, go: 'p-contract' };
    }
    case 'status_changed': {
      if (e.to_status === 'on_hold') return { kind: 'project_held', ref: subject, go: null };
      if (e.to_status === 'cancelled') return { kind: 'project_cancelled', ref: subject, go: null };
      if (e.to_status === 'active') return { kind: 'project_resumed', ref: subject, go: null };
      return null;
    }
    case 'assignee_changed':
      return {
        kind: payload.assigned === false ? 'assignee_cleared' : 'assignee_set',
        ref: subject,
        go: null,
      };
    case 'design_started':
      return { kind: 'design_started', ref: subject, go: null };
    case 'measure_done':
      return { kind: 'measure_done', ref: subject, go: null };
    case 'schedule_confirmed':
      return payload.type === 'installation' ? { kind: 'install_confirmed', ref: subject, go: 'p-install' } : null;
    case 'request_created':
      return { kind: 'request_sent', ref: subject, go: 'p-make' };
    case 'request_chosen':
    case 'request_cancelled':
    case 'request_recommended':
    case 'request_accepted':
    case 'request_declined':
    case 'request_expired':
    case 'request_received':
      return { kind: e.type, ref: subject, go: 'p-make' };
    case 'schedule_added':
    case 'schedule_changed': {
      const type = str(payload.type);
      if (!type || !Object.hasOwn(SCHEDULE_LABELS, type)) return null;
      // 고치기는 취소와 날짜 바꿈만 낸다 (메모 · 담당 글만 고친 것은 적히지도 않는다)
      const verb =
        e.type === 'schedule_added'
          ? 'set'
          : e.to_status === 'cancelled'
            ? 'cancelled'
            : payload.moved === true
              ? 'moved'
              : null;
      if (!verb) return null;
      const go =
        type === 'as_visit'
          ? 'p-as'
          : type === 'installation' || type === 'delivery'
            ? 'p-install'
            : null;
      return { kind: `schedule_${verb}_${type}`, ref: subject, go };
    }
    case 'as_requested':
    case 'as_cancelled':
    case 'as_received':
    case 'as_done':
      return { kind: e.type, ref: subject, go: 'p-as' };
    case 'report_added': {
      if (payload.kind !== 'install_done' && payload.kind !== 'as_done') return null;
      return {
        kind: `report_${payload.kind}`,
        ref: subject,
        go: payload.kind === 'as_done' ? 'p-as' : 'p-install',
      };
    }
    default:
      return null;
  }
}

/** 누가 — 구성원이면 이름 (memberOf: Map(user_id → { name })) */
export function whoOf(ev, memberOf) {
  const e = obj(ev);
  const kind = str(e.actor_kind);
  if (!kind || kind === 'system') return null;
  if (kind !== 'member') return { kind, name: null };
  const m =
    e.actor_user_id && memberOf && typeof memberOf.get === 'function'
      ? memberOf.get(e.actor_user_id)
      : null;
  return { kind, name: (m && str(m.name)) || null };
}

/**
 * 뽑은 줄에 일지를 합친다.
 * @param {Array<{ kind, at, label, go, ref? }>} items  뽑은 줄 (ref = 그 일의 대상 id — 짝짓기에만 쓴다)
 * @param {Array<object>} events                        일지 줄 (아무 차례)
 * @param {{ memberOf?: Map, labelOf: (kind: string) => string|undefined, extra?: (ev: object) => object, skip?: string[] }} opts
 *        labelOf  kind → 글 (없으면 그 일지 줄은 내지 않는다)
 *        extra    짝 없는 일지 줄에 더할 칸 (소식의 project 등)
 *        skip     짝 없는 줄로는 내지 않을 kind
 * @returns {Array<object>} 합친 줄 (차례는 그대로 — 부르는 쪽이 정렬한다). ref 는 뺀다
 */
export function mergeEvents(items, events, opts = {}) {
  const { memberOf = null, labelOf, extra = null, skip = [] } = opts;
  // 일지를 kind·ref 로 묶는다 — 같은 일을 두 번 누른 것(1분 안)은 하나로
  const groups = new Map();
  const sorted = (Array.isArray(events) ? events : [])
    .filter((e) => e && typeof e.created_at === 'string')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const ev of sorted) {
    const k = eventKind(ev);
    if (!k) continue;
    const key = `${k.kind}|${k.ref || ''}`;
    const list = groups.get(key) || [];
    const last = list[list.length - 1];
    if (last && Date.parse(ev.created_at) - Date.parse(last.ev.created_at) < DOUBLE_MS) continue;
    list.push({ ev, ...k });
    groups.set(key, list);
  }
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const { ref, ...rest } = it;
    const list = groups.get(`${it.kind}|${ref || ''}`);
    // 가장 새 일지 줄과 짝짓는다 — 뽑은 줄은 그 일의 마지막 모습이다
    const hit = list && list.length ? list.pop() : null;
    const who = hit && !NO_WHO.includes(it.kind) ? whoOf(hit.ev, memberOf) : null;
    out.push(who ? { ...rest, who } : rest);
  }
  for (const list of groups.values()) {
    for (const { ev, kind, go } of list) {
      if (skip.includes(kind)) continue;
      const label = labelOf(kind);
      if (!label) continue;
      const who = NO_WHO.includes(kind) ? null : whoOf(ev, memberOf);
      out.push({
        kind,
        at: ev.created_at,
        label,
        go,
        ...(extra ? extra(ev) : {}),
        ...(who ? { who } : {}),
      });
    }
  }
  return out;
}
