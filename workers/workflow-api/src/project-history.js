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
});

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
    const who = hit ? whoOf(hit.ev, memberOf) : null;
    out.push(who ? { ...rest, who } : rest);
  }
  for (const list of groups.values()) {
    for (const { ev, kind, go } of list) {
      if (skip.includes(kind)) continue;
      const label = labelOf(kind);
      if (!label) continue;
      const who = whoOf(ev, memberOf);
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
