/**
 * 승인 카드 (DB 0041 assistant_actions) — 비서는 바꾸는 일을 카드로만 제안하고, 대화한 사람이 본인 권한 안에서 승인하면
 * 이 워커가 그 사람의 토큰으로 workflow-api 의 기존 주소를 부른다.
 * 2026-11-05 대표님 결정:
 *   종류  상담 받기 · 거절, 수주 상태 바꾸기, 영수증 사진 장부에 올리기, 프로젝트 만들기 · 설계 잇기 · 수금 받음 · 원가 줄,
 *         프로젝트 담당자 정하기 (2026-11-06 작업 분배 — 비서는 추천만, 대표 · 실장이 승인),
 *         고객 연락 초안(실행 없음 — 복사만). 문서 발행은 넣지 않는다 (다시 발행하면 옛 공유 링크가 닫힌다)
 *   승인  대화한 본인만. 권한 밖 일은 도구 목록에 없어 카드를 만들지 않는다 (직원은 수주 상태 · 초안만)
 *   기한  만든 뒤 24시간 (DB 기본값 expires_at) — 지난 proposed 는 읽거나 승인할 때 expired 로 닫는다
 *
 *   만들기 (도구 propose_* · draft_customer_message) — 그 사람 토큰으로 workflow-api 를 읽어
 *     카드 칸(DB 값)과 expect(그때 상태)를 만든다. AI 가 준 글은 사유 · 초안처럼 그대로 보여 줄 칸에만 쓴다.
 *   승인 (POST /assistant/actions/:id/approve) — 본인 · 자격 full · proposed · 기한 안 → proposed → running 을 조건부로 한 번 잡고
 *     → 그 사람 토큰 + X-Idempotency-Key act:<id> + expect_* 로 기존 주소 → done / failed(서버 문구) / unknown(끊김 · 5xx)
 *   거절 (POST /assistant/actions/:id/reject) — proposed → rejected
 *   상태 이동 · 바뀌지 않는 칸은 DB 트리거(assistant_actions_guard)가 한 번 더 막는다.
 */
import { insertOne, selectMany, selectOne, updateWhere } from './db.js';
import { isUuid } from './access.js';
import { audit } from './audit.js';
import { conflict, forbidden, notFound } from './http.js';

/** 도구가 실패한 까닭 — Claude 에게 is_error 결과로 돌려준다 (tools.js 와 같은 뜻) */
export class ActionError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_MS = 9 * 3600 * 1000;
const todayKst = (now = Date.now()) => new Date(now + KST_MS).toISOString().slice(0, 10);
/** ISO → 한국 시간 'MM.DD HH:mm' */
function stamp(iso) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return '';
  const k = new Date(t + KST_MS).toISOString();
  return `${k.slice(5, 7)}.${k.slice(8, 10)} ${k.slice(11, 16)}`;
}
const won = (n) => (Number.isFinite(Number(n)) ? `${Number(n).toLocaleString('ko-KR')}원` : '');
const clip = (s, n) => (s === null || s === undefined ? '' : String(s).trim().slice(0, n));

export const STATE_NAMES = Object.freeze({
  proposed: '승인 기다림',
  running: '실행 중',
  done: '완료',
  failed: '실패',
  unknown: '결과 모름',
  rejected: '거절함',
  expired: '기한 지남',
  draft: '초안',
});
const ORDER_STATUS = {
  confirmed: '확정',
  in_production: '제작 중',
  delivered: '납품',
  completed: '완료',
  cancelled: '취소',
};
const PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' };
const COST_CATEGORY = {
  material: '자재',
  hardware: '철물',
  labor: '인건비',
  outsourcing: '외주',
  logistics: '운반',
  other: '기타',
};
const EVIDENCE = {
  tax_invoice: '세금계산서',
  invoice: '계산서',
  card: '카드',
  cash_receipt: '현금영수증',
  simple_receipt: '간이영수증',
  statement: '거래명세표',
  other: '기타',
  none: '없음',
};

const uuidProp = (description) => ({ type: 'string', format: 'uuid', description });
const textProp = (description) => ({ type: 'string', description });

/** workflow-api 읽기 — 그 사람 토큰 (실패하면 ActionError — 서버 문구) */
async function read(env, token, path) {
  if (!env.WORKFLOW_API || typeof env.WORKFLOW_API.fetch !== 'function')
    throw new ActionError('자료 서버에 닿지 못했습니다');
  let res;
  try {
    res = await env.WORKFLOW_API.fetch(
      new Request(`https://workflow-api${path}`, { headers: { Authorization: `Bearer ${token}` } })
    );
  } catch {
    throw new ActionError('자료 서버에 닿지 못했습니다');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    if (res.status === 401)
      throw new ActionError('로그인이 끝나 자료를 못 봤습니다. 다시 로그인해야 합니다');
    throw new ActionError((body && body.message) || `자료 서버 오류 (${res.status})`);
  }
  return body ? body.data : null;
}

/**
 * workflow-api 쓰기 — 던지지 않는다 → { outcome: 'done' | 'failed' | 'unknown', status, data, message, code }
 * 보낸 뒤 끊기거나 5xx 면 서버가 했는지 모른다 — unknown
 */
async function send(env, token, method, path, { body, key } = {}) {
  if (!env.WORKFLOW_API || typeof env.WORKFLOW_API.fetch !== 'function')
    return { outcome: 'failed', status: 0, message: '자료 서버에 닿지 못했습니다' };
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['X-Idempotency-Key'] = key;
  let res;
  try {
    res = await env.WORKFLOW_API.fetch(
      new Request(`https://workflow-api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    );
  } catch {
    return { outcome: 'unknown', status: 0, message: '보낸 뒤 연결이 끊겼습니다' };
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (res.status >= 500)
    return { outcome: 'unknown', status: res.status, message: '서버 오류로 결과를 모릅니다' };
  if (!res.ok) {
    const code = (json && (json.code || (json.details && json.details.code))) || null;
    return {
      outcome: 'failed',
      status: res.status,
      code,
      message: clip((json && json.message) || `서버가 받지 않았습니다 (${res.status})`, 300),
    };
  }
  return { outcome: 'done', status: res.status, data: json ? json.data : null };
}

const field = (label, value) => ({ label, value: clip(value, 300) });
/** 업체 안 역할 — 화면 이름 (manager 는 「실장」) */
const ROLE_NAMES = Object.freeze({ owner: '대표', manager: '실장', staff: '직원' });
const personLabel = (m) => (m ? `${m.name || '이름 없음'} (${ROLE_NAMES[m.role] || '구성원'})` : '(없음)');

// ── 종류마다: 도구 · 카드 만들기 · 실행 ───────────────────────

async function consultCard(env, token, input) {
  const data = (await read(env, token, '/company/consults')) || {};
  if (!data.can_act) throw new ActionError('상담 받기 · 거절은 팩토리 대표 · 실장만 합니다');
  const c = (Array.isArray(data.items) ? data.items : []).find(
    (x) => x && x.id === input.consult_id
  );
  if (!c) throw new ActionError('그 상담을 찾지 못했습니다 — list_consults 의 id 를 쓰세요');
  const a = c.assignment;
  if (!a || a.state !== 'assigned') throw new ActionError('응답을 기다리는 상담이 아닙니다');
  if (a.expires_at && Date.parse(a.expires_at) <= Date.now())
    throw new ActionError('응답 마감(배정 뒤 24시간)이 지난 상담입니다');
  const fields = [
    field('고객', c.name || '-'),
    field('지역', [c.sido, c.gugun].filter(Boolean).join(' ') || '-'),
    field('품목', (c.furniture_categories || []).join(' · ') || '-'),
    field('응답 마감', stamp(a.expires_at)),
  ];
  return { c, fields };
}

const CONSULT_INPUT = (decline) => ({
  type: 'object',
  properties: {
    consult_id: uuidProp('list_consults 의 상담 id'),
    ...(decline ? { reason: textProp('거절 사유 (500자까지, 고객에게 보이지 않는다)') } : {}),
  },
  required: ['consult_id'],
  additionalProperties: false,
});

export const KINDS = Object.freeze({
  consult_accept: {
    tool: 'propose_consult_accept',
    label: '상담 받기 카드 만드는 중',
    money: true,
    description:
      '배정된 상담을 「받기」 하는 승인 카드를 만든다 (실행은 사람이 승인할 때). 받으면 그 고객 · 프로젝트가 생긴다. 응답 기다리는 상담만.',
    input_schema: CONSULT_INPUT(false),
    async build(env, token, input) {
      const { c, fields } = await consultCard(env, token, input);
      return {
        params: { consult_id: c.id },
        expect: { assignment_state: 'assigned' },
        card: { title: '상담 받기', subject: c.name || '상담', fields },
      };
    },
    run: (env, token, row) =>
      send(env, token, 'POST', `/company/consults/${row.params.consult_id}/accept`, { body: {} }),
  },
  consult_decline: {
    tool: 'propose_consult_decline',
    label: '상담 거절 카드 만드는 중',
    money: true,
    description:
      '배정된 상담을 「거절」 하는 승인 카드를 만든다 (실행은 사람이 승인할 때). 거절하면 상담이 본사로 돌아가고 고객 연락처가 지워진다.',
    input_schema: CONSULT_INPUT(true),
    async build(env, token, input) {
      const { c, fields } = await consultCard(env, token, input);
      const reason = clip(input.reason, 500) || null;
      return {
        params: { consult_id: c.id, reason },
        expect: { assignment_state: 'assigned' },
        card: {
          title: '상담 거절',
          subject: c.name || '상담',
          fields: fields.concat([field('사유', reason || '(없음)')]),
        },
      };
    },
    run: (env, token, row) =>
      send(env, token, 'POST', `/company/consults/${row.params.consult_id}/decline`, {
        body: row.params.reason ? { reason: row.params.reason } : {},
      }),
  },
  order_status: {
    tool: 'propose_order_status',
    label: '수주 상태 카드 만드는 중',
    money: false,
    description:
      '수주 상태를 바꾸는 승인 카드를 만든다 (실행은 사람이 승인할 때). 확정 → 제작 중 → 납품 → 완료, 취소 · 되돌리기는 사유가 필요하다. ' +
      '되살리기 · 완료 되돌리기는 대표가 아니면 대표 승인 요청으로 간다.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: uuidProp('list_orders 의 수주 id'),
        to: {
          type: 'string',
          enum: Object.keys(ORDER_STATUS),
          description:
            'confirmed 확정 · in_production 제작 중 · delivered 납품 · completed 완료 · cancelled 취소',
        },
        reason: textProp('사유 (취소 · 되돌리기 · 되살리기에 필요)'),
      },
      required: ['order_id', 'to'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      const [od, ev] = await Promise.all([
        read(env, token, `/orders/${input.order_id}`),
        read(env, token, `/orders/${input.order_id}/events`),
      ]);
      const order = (od && od.order) || null;
      if (!order || !ev) throw new ActionError('그 수주를 찾지 못했습니다');
      if (ev.pending)
        throw new ActionError('대표 결정을 기다리는 요청이 있어 지금은 바꿀 수 없습니다');
      const move = (Array.isArray(ev.moves) ? ev.moves : []).find((m) => m && m.to === input.to);
      if (!move) {
        const can = (ev.moves || []).map((m) => m.label).join(' · ') || '없음';
        throw new ActionError(
          `지금 상태(${ORDER_STATUS[ev.status] || ev.status})에서 그 상태로는 바꿀 수 없습니다 — 가능: ${can}`
        );
      }
      const reason = clip(input.reason, 300) || null;
      if (move.reason_required && !reason)
        throw new ActionError('이 바꾸기는 사유가 필요합니다 — 사유를 물어 다시 만들어 주세요');
      const fields = [
        field('수주', order.order_no),
        field('고객', order.customer_name || '-'),
        field('지금', ORDER_STATUS[ev.status] || ev.status),
        field('바꿀 상태', move.label || ORDER_STATUS[input.to]),
      ];
      if (reason) fields.push(field('사유', reason));
      if (move.request)
        fields.push(field('알림', '대표 승인 요청으로 갑니다 — 대표가 승인하면 바뀝니다'));
      return {
        params: { order_id: input.order_id, to: input.to, reason },
        expect: { status: ev.status },
        card: { title: '수주 상태 바꾸기', subject: order.order_no, fields },
      };
    },
    run: (env, token, row) =>
      send(env, token, 'PATCH', `/orders/${row.params.order_id}`, {
        body: {
          status: row.params.to,
          ...(row.params.reason ? { reason: row.params.reason } : {}),
          expect_status: row.expect.status,
        },
      }),
  },
  ledger_post: {
    tool: 'propose_ledger_post',
    label: '사진 올리기 카드 만드는 중',
    money: true,
    description:
      '확인 기다리는 영수증 · 명세표 사진 하나를 서버가 낸 값 그대로 장부에 올리는 승인 카드를 만든다. ' +
      '「바로 올려도 되는 사진」(거래처 기억이 맞는 사진)만 된다 — 아니면 회계 › 사진에서 사람이 확인해야 한다.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: uuidProp('올린 사진 id (ledger_photos 가 아니라 회계 확인 목록의 사진 id)'),
      },
      required: ['document_id'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      const [review, accounts] = await Promise.all([
        read(env, token, '/ledger/review'),
        read(env, token, '/ledger/accounts'),
      ]);
      const doc = ((review && review.items) || []).find((d) => d && d.id === input.document_id);
      if (!doc) throw new ActionError('확인 기다리는 사진에서 찾지 못했습니다');
      const h = doc.hints;
      if (!h || !h.ready || !h.proposal)
        throw new ActionError('바로 올릴 수 있는 사진이 아닙니다 — 회계 › 사진에서 확인해 주세요');
      const p = h.proposal;
      const names = new Map(((accounts && accounts.items) || []).map((a) => [a.code, a.name]));
      const fields = [
        field('일자', p.entry_date),
        field('거래처', p.counterparty_name || '-'),
        field('공급가', won(p.amount)),
        field('부가세', won(p.vat_amount)),
        field('계정', names.get(p.account) || p.account),
        field('증빙', EVIDENCE[p.evidence_type] || p.evidence_type || '-'),
      ];
      return {
        params: { document_id: doc.id },
        expect: { proposal: p },
        card: {
          title: '영수증 사진 장부에 올리기',
          subject: p.counterparty_name || '사진',
          fields,
        },
      };
    },
    run: (env, token, row) =>
      send(env, token, 'POST', `/ledger/documents/${row.params.document_id}/post`, {
        body: { ready: true, entry: row.expect.proposal },
      }),
  },
  project_create: {
    tool: 'propose_project_create',
    label: '프로젝트 카드 만드는 중',
    money: true,
    description:
      '팩토리 고객 · 프로젝트를 새로 만드는 승인 카드를 만든다. 있는 고객이면 customer_id(list_projects 의 고객 id), ' +
      '새 고객이면 customer_name(과 customer_phone) — 둘 중 하나만.',
    input_schema: {
      type: 'object',
      properties: {
        title: textProp('프로젝트 이름 (100자까지)'),
        customer_id: uuidProp('있는 고객 id (list_projects 의 customer.id)'),
        customer_name: textProp('새 고객 이름 (50자까지)'),
        customer_phone: textProp('새 고객 전화 (숫자와 -)'),
      },
      required: ['title'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      const title = clip(input.title, 100);
      if (!title) throw new ActionError('프로젝트 이름이 필요합니다');
      const hasId = !!input.customer_id;
      const name = clip(input.customer_name, 50);
      if (hasId === !!name) throw new ActionError('customer_id 와 customer_name 중 하나만 주세요');
      const data = (await read(env, token, '/company/projects')) || {};
      if (!data.can_manage) throw new ActionError('프로젝트 만들기는 팩토리 대표 · 실장만 합니다');
      let customer;
      if (hasId) {
        const p = (data.items || []).find(
          (x) => x && x.customer && x.customer.id === input.customer_id
        );
        if (!p)
          throw new ActionError('그 고객을 찾지 못했습니다 — list_projects 의 고객 id 를 쓰세요');
        customer = { id: input.customer_id, label: p.customer.name || '고객' };
      } else {
        const phone = clip(input.customer_phone, 20) || null;
        customer = { name, phone, label: `${name} (새 고객${phone ? ` · ${phone}` : ''})` };
      }
      return {
        params: {
          title,
          ...(hasId
            ? { customer_id: customer.id }
            : { customer: { name: customer.name, phone: customer.phone } }),
        },
        expect: {},
        card: {
          title: '프로젝트 만들기',
          subject: title,
          fields: [field('프로젝트', title), field('고객', customer.label)],
        },
      };
    },
    run: (env, token, row) =>
      send(env, token, 'POST', '/company/projects', { body: row.params, key: `act:${row.id}` }),
  },
  design_link: {
    tool: 'propose_design_link',
    label: '설계 잇기 카드 만드는 중',
    money: true,
    description:
      '팩토리 설계를 같은 팩토리 프로젝트에 잇는 승인 카드를 만든다. 설계는 list_designs, 프로젝트는 list_projects 의 id. 수주가 생긴 설계는 바꾸지 못한다.',
    input_schema: {
      type: 'object',
      properties: {
        design_id: uuidProp('list_designs 의 설계 id'),
        project_id: uuidProp('list_projects 의 프로젝트 id'),
      },
      required: ['design_id', 'project_id'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      const [designs, projects] = await Promise.all([
        read(env, token, '/company/designs'),
        read(env, token, '/company/projects'),
      ]);
      const d = ((designs && designs.items) || []).find((x) => x && x.id === input.design_id);
      if (!d) throw new ActionError('그 설계를 찾지 못했습니다 — list_designs 의 id 를 쓰세요');
      if (d.has_order) throw new ActionError('수주가 생긴 설계는 프로젝트를 바꿀 수 없습니다');
      const byId = new Map(((projects && projects.items) || []).map((p) => [p.id, p]));
      const target = byId.get(input.project_id);
      if (!target)
        throw new ActionError('그 프로젝트를 찾지 못했습니다 — list_projects 의 id 를 쓰세요');
      if (d.project_id === input.project_id)
        throw new ActionError('이미 그 프로젝트에 이어진 설계입니다');
      const now = d.project_id ? byId.get(d.project_id) : null;
      return {
        params: { design_id: d.id, project_id: input.project_id },
        expect: { project_id: d.project_id || null },
        card: {
          title: '설계를 프로젝트에 잇기',
          subject: d.name || '설계',
          fields: [
            field('설계', d.name || '-'),
            field('지금', now ? now.title || '프로젝트' : '(이은 프로젝트 없음)'),
            field('이을 프로젝트', target.title || '프로젝트'),
          ],
        },
      };
    },
    run: (env, token, row) =>
      send(env, token, 'PUT', `/designs/${row.params.design_id}/project`, {
        body: { project_id: row.params.project_id, expect_project_id: row.expect.project_id },
      }),
  },
  project_assign: {
    tool: 'propose_project_assign',
    label: '담당자 카드 만드는 중',
    money: true,
    description:
      '팩토리 프로젝트의 담당자를 정하는 승인 카드를 만든다 — 비서는 추천만 하고 대표 · 실장이 승인해야 정해진다. ' +
      'project_id 는 list_projects 의 id. assignee_id 를 비우면 추천 1순위(진행 중 담당이 적은 사람 → 이레 안 일정이 적은 사람)로, ' +
      '다른 사람을 원하면 list_projects 의 members 의 user_id. 카드에 근거 숫자가 함께 나온다.',
    input_schema: {
      type: 'object',
      properties: {
        project_id: uuidProp('list_projects 의 프로젝트 id'),
        assignee_id: uuidProp('담당자로 정할 구성원 (list_projects 의 members user_id) — 비우면 추천 1순위'),
      },
      required: ['project_id'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      const [c, projects] = await Promise.all([
        read(env, token, `/company/projects/${input.project_id}/assignee-candidates`),
        read(env, token, '/company/projects'),
      ]);
      const list = (c && Array.isArray(c.candidates) ? c.candidates : []).filter((m) => m && m.user_id);
      if (!list.length) throw new ActionError('담당자가 될 구성원이 없습니다');
      const picked = input.assignee_id ? list.find((m) => m.user_id === input.assignee_id) : list[0];
      if (!picked)
        throw new ActionError('그 사람은 이 팩토리의 지금 구성원이 아닙니다 — list_projects 의 members 를 쓰세요');
      const current = (c && c.assignee_id) || null;
      if (picked.user_id === current) throw new ActionError('이미 그 사람이 담당자입니다');
      const p = ((projects && projects.items) || []).find((x) => x && x.id === input.project_id) || {};
      const now = current ? list.find((m) => m.user_id === current) || { name: null, role: null } : null;
      const days = Number(c && c.days) || 7;
      return {
        params: { project_id: input.project_id, assignee_id: picked.user_id },
        expect: { assignee_id: current },
        card: {
          title: '프로젝트 담당자 정하기',
          subject: p.title || '프로젝트',
          fields: [
            field('프로젝트', p.title || '-'),
            field('지금 담당자', now ? personLabel(now) : '(없음)'),
            field('정할 담당자', personLabel(picked)),
            field(
              '근거',
              `진행 중 담당 ${Number(picked.active_projects) || 0}개 · ${days}일 안 일정 ${Number(picked.week_schedules) || 0}개` +
                (input.assignee_id ? '' : ' (추천 1순위)')
            ),
          ],
        },
      };
    },
    run: (env, token, row) =>
      send(env, token, 'PUT', `/company/projects/${row.params.project_id}/assignee`, {
        body: { assignee_id: row.params.assignee_id, expect_assignee_id: row.expect.assignee_id },
      }),
  },
  payment_received: {
    tool: 'propose_payment_received',
    label: '수금 카드 만드는 중',
    money: true,
    description:
      '수금을 「받음」으로 적는 승인 카드를 만든다. 있는 수금 일정이면 payment_id(get_order 의 수금 일정), ' +
      '일정에 없던 돈이면 stage · amount 로 새 줄. paid_on 은 받은 날 YYYY-MM-DD (없으면 오늘).',
    input_schema: {
      type: 'object',
      properties: {
        order_id: uuidProp('수주 id'),
        payment_id: uuidProp('받음으로 적을 수금 일정 id'),
        stage: { type: 'string', enum: Object.keys(PAY_STAGE), description: '새 줄의 단계' },
        amount: { type: 'integer', description: '새 줄의 금액(원)' },
        paid_on: textProp('받은 날 YYYY-MM-DD'),
      },
      required: ['order_id'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      const paidOn = input.paid_on ? String(input.paid_on) : todayKst();
      if (!DATE_RE.test(paidOn)) throw new ActionError('paid_on 은 YYYY-MM-DD 입니다');
      const od = (await read(env, token, `/orders/${input.order_id}`)) || {};
      const order = od.order;
      if (!order) throw new ActionError('그 수주를 찾지 못했습니다');
      if (!Array.isArray(od.payments)) throw new ActionError('수금은 팩토리 대표 · 실장만 적습니다');
      const head = [field('수주', order.order_no), field('고객', order.customer_name || '-')];
      if (input.payment_id) {
        const p = od.payments.find((x) => x && x.id === input.payment_id);
        if (!p)
          throw new ActionError(
            '그 수금 일정을 찾지 못했습니다 — get_order 의 수금 일정 id 를 쓰세요'
          );
        if (p.paid_on) throw new ActionError(`이미 받은 일정입니다 (${p.paid_on})`);
        return {
          params: { order_id: input.order_id, payment_id: p.id, paid_on: paidOn },
          expect: { paid_on: null },
          card: {
            title: '수금 받음',
            subject: order.order_no,
            fields: head.concat([
              field('단계', PAY_STAGE[p.stage] || p.stage),
              field('금액', won(p.amount)),
              field('받을 날', p.due_on || '-'),
              field('받은 날', paidOn),
            ]),
          },
        };
      }
      if (!input.stage || !Number.isInteger(input.amount) || input.amount < 1)
        throw new ActionError('일정에 없던 돈이면 stage 와 amount(1원 이상)가 필요합니다');
      return {
        params: {
          order_id: input.order_id,
          stage: input.stage,
          amount: input.amount,
          paid_on: paidOn,
        },
        expect: {},
        card: {
          title: '수금 받음 (새 줄)',
          subject: order.order_no,
          fields: head.concat([
            field('단계', PAY_STAGE[input.stage]),
            field('금액', won(input.amount)),
            field('받은 날', paidOn),
          ]),
        },
      };
    },
    run(env, token, row) {
      const p = row.params;
      if (p.payment_id)
        return send(env, token, 'PATCH', `/orders/${p.order_id}/payments/${p.payment_id}`, {
          body: { paid_on: p.paid_on, expect_unpaid: true },
        });
      return send(env, token, 'POST', `/orders/${p.order_id}/payments`, {
        body: { stage: p.stage, amount: p.amount, paid_on: p.paid_on },
        key: `act:${row.id}`,
      });
    },
  },
  cost_add: {
    tool: 'propose_cost_add',
    label: '원가 카드 만드는 중',
    money: true,
    description:
      '수주에 원가 줄을 넣는 승인 카드를 만든다. amount 는 부가세 뺀 공급가(원), 부가세는 vat_amount 로 따로. ' +
      '낸 날은 spent_on, 아직 안 냈으면 낼 날 due_on (YYYY-MM-DD).',
    input_schema: {
      type: 'object',
      properties: {
        order_id: uuidProp('수주 id'),
        category: { type: 'string', enum: Object.keys(COST_CATEGORY), description: '원가 종류' },
        amount: { type: 'integer', description: '공급가(원)' },
        vat_amount: { type: 'integer', description: '부가세(원)' },
        vendor_name: textProp('공급처 이름 (100자까지)'),
        description: textProp('내용 (300자까지)'),
        evidence_type: { type: 'string', enum: Object.keys(EVIDENCE), description: '증빙' },
        spent_on: textProp('낸 날 YYYY-MM-DD'),
        due_on: textProp('낼 날 YYYY-MM-DD'),
      },
      required: ['order_id', 'category', 'amount'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      if (!Number.isInteger(input.amount) || input.amount < 0)
        throw new ActionError('amount 는 0 이상 정수(원)입니다');
      if (
        input.vat_amount !== undefined &&
        (!Number.isInteger(input.vat_amount) || input.vat_amount < 0)
      )
        throw new ActionError('vat_amount 는 0 이상 정수(원)입니다');
      for (const k of ['spent_on', 'due_on'])
        if (input[k] !== undefined && !DATE_RE.test(String(input[k])))
          throw new ActionError(`${k} 는 YYYY-MM-DD 입니다`);
      const od = (await read(env, token, `/orders/${input.order_id}`)) || {};
      const order = od.order;
      if (!order) throw new ActionError('그 수주를 찾지 못했습니다');
      if (!Array.isArray(od.costs)) throw new ActionError('원가는 팩토리 대표 · 실장만 적습니다');
      const params = { order_id: input.order_id, category: input.category, amount: input.amount };
      for (const k of ['vat_amount', 'evidence_type', 'spent_on', 'due_on'])
        if (input[k] !== undefined) params[k] = input[k];
      if (input.vendor_name) params.vendor_name = clip(input.vendor_name, 100);
      if (input.description) params.description = clip(input.description, 300);
      const fields = [
        field('수주', order.order_no),
        field('종류', COST_CATEGORY[input.category]),
        field('공급가', won(input.amount)),
        field('부가세', input.vat_amount === undefined ? '(미기재)' : won(input.vat_amount)),
      ];
      if (params.vendor_name) fields.push(field('공급처', params.vendor_name));
      if (params.description) fields.push(field('내용', params.description));
      if (params.evidence_type) fields.push(field('증빙', EVIDENCE[params.evidence_type]));
      if (params.spent_on) fields.push(field('낸 날', params.spent_on));
      if (params.due_on) fields.push(field('낼 날', params.due_on));
      return {
        params,
        expect: {},
        card: { title: '원가 줄 넣기', subject: order.order_no, fields },
      };
    },
    run(env, token, row) {
      const { order_id: orderId, ...body } = row.params;
      return send(env, token, 'POST', `/orders/${orderId}/costs`, { body, key: `act:${row.id}` });
    },
  },
  draft: {
    tool: 'draft_customer_message',
    label: '연락 초안 만드는 중',
    money: false,
    description:
      '고객에게 보낼 문자 · 카톡 초안 카드를 만든다. 보내는 기능은 없다 — 사람이 복사해 직접 보낸다. 금액 · 개인정보는 꼭 필요할 때만.',
    input_schema: {
      type: 'object',
      properties: {
        text: textProp('초안 글 (2000자까지)'),
        purpose: textProp('무엇에 대한 연락인지 짧게 (예: 실측 일정 안내)'),
      },
      required: ['text'],
      additionalProperties: false,
    },
    async build(env, token, input) {
      const text = clip(input.text, 2000);
      if (!text) throw new ActionError('초안 글이 비었습니다');
      return {
        params: {},
        expect: {},
        card: { title: '고객 연락 초안', subject: clip(input.purpose, 100) || '연락', text },
      };
    },
    run: null,
  },
});

const BY_TOOL = new Map(Object.entries(KINDS).map(([kind, k]) => [k.tool, kind]));

/** 카드 도구 정의 — 돈 도구(대표 · 실장)는 money 일 때만 */
export function actionToolDefs({ money }) {
  return Object.values(KINDS)
    .filter((k) => money || !k.money)
    .map((k) => ({
      name: k.tool,
      description: k.description,
      input_schema: k.input_schema,
      strict: true,
    }));
}

export const isActionTool = (name) => BY_TOOL.has(name);
export const actionToolLabel = (name) =>
  BY_TOOL.has(name) ? KINDS[BY_TOOL.get(name)].label : null;

/** 화면 · 도구 결과에 싣는 카드 */
export function actionView(row, now = Date.now()) {
  const expired = row.state === 'proposed' && Date.parse(row.expires_at) <= now;
  const state = expired ? 'expired' : row.state;
  const r = row.result || null;
  return {
    id: row.id,
    kind: row.kind,
    state,
    state_name: STATE_NAMES[state] || state,
    card: row.card || {},
    created_at: row.created_at,
    expires_at: row.expires_at,
    decided_at: row.decided_at || null,
    finished_at: row.finished_at || null,
    result: r ? { message: r.message || null, pending: !!r.pending } : null,
  };
}

/**
 * 카드 도구 하나 실행 → { value, view } (실패는 ActionError)
 * @param {{ token, companyId, conversationId, userId }} ctx
 */
export async function proposeAction(env, name, input, ctx) {
  const kind = BY_TOOL.get(name);
  if (!kind) throw new ActionError(`없는 도구입니다: ${name}`);
  const v = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!v) throw new ActionError('입력이 객체가 아닙니다');
  const allowed = Object.keys(KINDS[kind].input_schema.properties);
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) throw new ActionError(`모르는 입력: ${k}`);
  for (const k of allowed) {
    const p = KINDS[kind].input_schema.properties[k];
    if (p.format === 'uuid' && v[k] !== undefined && !isUuid(String(v[k])))
      throw new ActionError(`${k} 는 id(uuid)입니다`);
    if (p.enum && v[k] !== undefined && !p.enum.includes(v[k]))
      throw new ActionError(`${k} 는 ${p.enum.join(' · ')} 중 하나입니다`);
  }
  for (const k of KINDS[kind].input_schema.required || [])
    if (v[k] === undefined || v[k] === null || v[k] === '')
      throw new ActionError(`${k} 가 필요합니다`);
  if (!ctx.conversationId || !ctx.companyId || !ctx.userId)
    throw new ActionError('대화 밖에서는 카드를 만들 수 없습니다');
  const made = await KINDS[kind].build(env, ctx.token, v);
  const row = await insertOne(env, 'assistant_actions', {
    company_id: ctx.companyId,
    conversation_id: ctx.conversationId,
    user_id: ctx.userId,
    kind,
    state: kind === 'draft' ? 'draft' : 'proposed',
    params: made.params,
    expect: made.expect,
    card: made.card,
  });
  if (!row || !row.id) throw new ActionError('카드를 만들지 못했습니다');
  await audit(env, {
    companyId: ctx.companyId,
    userId: ctx.userId,
    conversationId: ctx.conversationId,
    kind: 'action',
    name: kind,
    detail: { state: row.state },
  });
  const view = actionView(row);
  const value = {
    card_id: row.id,
    kind,
    state: view.state,
    title: made.card.title,
    fields: made.card.fields || [],
    ...(made.card.text ? { text: made.card.text } : {}),
    note:
      kind === 'draft'
        ? '초안 카드를 만들었다. 보내는 것은 사람이 한다 — 보냈다고 말하지 않는다.'
        : '승인 카드를 만들었다. 사람이 카드에서 승인해야 실행된다 — 승인 전에는 했다고 말하지 말고 카드를 보고 승인하라고 안내한다.',
  };
  return { value, view };
}

// ── 승인 · 거절 ─────────────────────────────────────────

/** 내 카드 — 다른 사람 · 다른 업체 카드는 없는 것과 같다 (404) */
export async function ownAction(env, access, user, id) {
  if (!isUuid(id)) throw notFound('카드가 없습니다');
  const row = await selectOne(env, 'assistant_actions', {
    id: `eq.${id}`,
    user_id: `eq.${user.id}`,
    company_id: `eq.${access.companyId}`,
    select: '*',
  });
  if (!row) throw notFound('카드가 없습니다');
  return row;
}

/** 기한 지난 승인 기다림 → expired (조건부) */
async function closeExpired(env, row) {
  const rows = await updateWhere(
    env,
    'assistant_actions',
    { id: `eq.${row.id}`, state: 'eq.proposed', select: '*' },
    { state: 'expired' }
  );
  return rows[0] || { ...row, state: 'expired' };
}

function assertOpen(row) {
  if (row.kind === 'draft') throw conflict('초안 카드는 승인하는 카드가 아닙니다', 'not_action');
  if (row.state !== 'proposed')
    throw conflict(`이미 ${STATE_NAMES[row.state] || row.state} 카드입니다`, 'decided');
}

/** 결과 → 저장할 result (ids · 서버 문구만) */
function resultOf(kind, out) {
  const d = (out && out.data) || {};
  if (out.outcome !== 'done')
    return { status: out.status || 0, code: out.code || null, message: out.message || null };
  if (kind === 'order_status' && out.status === 202)
    return {
      status: 202,
      pending: true,
      message: '대표 승인 요청을 보냈습니다',
      event_id: d.id || null,
    };
  const ids = {};
  for (const k of ['customer_id', 'project_id', 'document_id', 'entry_id', 'cost_id', 'design_id'])
    if (typeof d[k] === 'string') ids[k] = d[k];
  if (d.payment && d.payment.id) ids.payment_id = d.payment.id;
  if (kind === 'cost_add' && typeof d.id === 'string') ids.cost_id = d.id;
  if (kind === 'order_status' && typeof d.status === 'string') ids.order_status = d.status;
  return { status: out.status, ...ids };
}

/**
 * 승인 — 한 번만 잡고 그 사람 토큰으로 실행 → 카드
 * @param {{ companyId, money }} access 지금 역할 (assistantAccess)
 */
export async function approveAction(env, { access, user, row, now = Date.now() }) {
  const k = KINDS[row.kind];
  if (!k || !k.run) throw conflict('초안 카드는 승인하는 카드가 아닙니다', 'not_action');
  if (row.state === 'proposed' && Date.parse(row.expires_at) <= now) {
    await closeExpired(env, row);
    throw conflict(
      '기한(24시간)이 지난 카드입니다 — 비서에게 다시 물어 새 카드를 만들어 주세요',
      'expired'
    );
  }
  assertOpen(row);
  if (k.money && !access.money)
    throw forbidden('이 카드는 팩토리 대표 · 실장만 승인합니다', 'not_money');
  const claimed = await updateWhere(
    env,
    'assistant_actions',
    {
      id: `eq.${row.id}`,
      state: 'eq.proposed',
      expires_at: `gt.${new Date(now).toISOString()}`,
      select: '*',
    },
    { state: 'running' }
  );
  if (!claimed.length) {
    const cur = await selectOne(env, 'assistant_actions', { id: `eq.${row.id}`, select: '*' });
    throw conflict(`이미 ${STATE_NAMES[(cur && cur.state) || 'running']} 카드입니다`, 'decided');
  }
  const out = await k.run(env, user.token, claimed[0]);
  const state = out.outcome === 'done' ? 'done' : out.outcome === 'unknown' ? 'unknown' : 'failed';
  const result = resultOf(row.kind, out);
  const done = await updateWhere(
    env,
    'assistant_actions',
    { id: `eq.${row.id}`, state: 'eq.running', select: '*' },
    { state, result }
  );
  await audit(env, {
    companyId: row.company_id,
    userId: user.id,
    conversationId: row.conversation_id,
    kind: 'action',
    name: row.kind,
    detail: { state, status: out.status || 0, code: out.code || null },
  });
  return actionView(done[0] || { ...claimed[0], state, result }, now);
}

/** 거절 — 승인 기다림만 */
export async function rejectAction(env, { user, row, now = Date.now() }) {
  if (row.state === 'proposed' && Date.parse(row.expires_at) <= now) {
    return actionView(await closeExpired(env, row), now);
  }
  assertOpen(row);
  const rows = await updateWhere(
    env,
    'assistant_actions',
    { id: `eq.${row.id}`, state: 'eq.proposed', select: '*' },
    { state: 'rejected' }
  );
  if (!rows.length) throw conflict('이미 승인 · 거절된 카드입니다', 'decided');
  await audit(env, {
    companyId: row.company_id,
    userId: user.id,
    conversationId: row.conversation_id,
    kind: 'action',
    name: row.kind,
    detail: { state: 'rejected' },
  });
  return actionView(rows[0], now);
}

/** 대화의 카드 (오래된 것부터) — 기한 지난 승인 기다림은 닫고 준다 */
export async function conversationActions(env, conversationId, now = Date.now()) {
  const rows = await selectMany(env, 'assistant_actions', {
    conversation_id: `eq.${conversationId}`,
    select: '*',
    order: 'created_at.asc',
  });
  if (rows.some((r) => r.state === 'proposed' && Date.parse(r.expires_at) <= now)) {
    await updateWhere(
      env,
      'assistant_actions',
      {
        conversation_id: `eq.${conversationId}`,
        state: 'eq.proposed',
        expires_at: `lte.${new Date(now).toISOString()}`,
      },
      { state: 'expired' }
    );
  }
  return rows.map((r) => actionView(r, now));
}

/** 다음 차례 맥락 블록에 실을 카드 한 줄씩 (최근 ACTIONS_IN_CONTEXT) */
export const ACTIONS_IN_CONTEXT = 10;
export function actionsContext(views) {
  return (views || [])
    .slice(-ACTIONS_IN_CONTEXT)
    .map(
      (v) =>
        `「${v.card.title || v.kind}${v.card.subject ? ` · ${v.card.subject}` : ''}」 ${v.state_name}${v.result && v.result.message && v.state !== 'done' ? ` (${v.result.message})` : ''}`
    );
}
