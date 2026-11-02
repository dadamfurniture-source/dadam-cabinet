/**
 * 읽기 도구 — 비서가 업체 자료를 본다. 모두 workflow-api 의 기존 주소를 묻는 사람의 토큰 그대로 부른다
 * (서비스 바인딩 WORKFLOW_API). 그래서 비서는 그 사람이 앱에서 볼 수 있는 것만 본다 — 직원의 돈 칸은 workflow-api 가 뺀다.
 *
 *   list_consults   GET /company/consults        배정된 상담 (최근 CONSULTS_MAX)
 *   list_projects   GET /company/projects        업체 고객 · 프로젝트 (최근 PROJECTS_MAX)
 *   list_orders     GET /orders                  수주 (최근 ORDERS_MAX, 상태로 거르기)
 *   get_order       GET /orders/:id              수주 하나 — 대표 · 실장이면 원가 · 마진 · 수금 일정
 *   books_summary   GET /books/summary?month=    업체 장부 요약 (대표 · 실장)
 *   ledger_month    GET /ledger/book?month=      회계장부 한 달 — 합계 · 계정별 합 · 줄 (대표 · 실장)
 *   ledger_photos   GET /ledger/documents        올린 영수증 · 명세표 사진의 상태별 장수 (직원은 자기 것만)
 *
 * 결과는 필요한 칸만 골라 줄인다 — 고객 전화 · 이메일 · 사진 주소는 싣지 않는다 (Claude 에 보낼 까닭이 없다).
 * 직원이면 workflow-api 가 빼지 않는 견적 합(quote_total)도 뺀다. 결과 글은 RESULT_MAX 자를 넘지 않는다.
 * 돈 도구(books_summary · ledger_month)는 대화를 대표 · 실장이 시작했을 때만 목록에 넣는다 (toolDefs).
 *
 * 도구 입력은 strict 스키마라 모양이 맞게 오지만, 실행 전에 다시 확인한다 (checkInput).
 * eager_input_streaming 은 켜지 않는다 — 입력이 몇 글자라 미리 흘려받을 것이 없고, strict 의 검사를 그대로 받는다.
 */

export const CONSULTS_MAX = 50;
export const PROJECTS_MAX = 100;
export const ORDERS_MAX = 100;
export const LEDGER_ROWS_MAX = 80;
export const RESULT_MAX = 30_000;
export const ORDER_STATUSES = Object.freeze([
  'confirmed',
  'in_production',
  'delivered',
  'completed',
  'cancelled',
]);

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 도구가 실패한 까닭 — Claude 에게 is_error 결과로 돌려준다 */
export class ToolError extends Error {}

const clip = (s, n) => {
  if (s === null || s === undefined) return null;
  const t = String(s);
  return t.length > n ? t.slice(0, n) + '…' : t;
};

const NO_INPUT = { type: 'object', properties: {}, additionalProperties: false };
const MONTH_INPUT = {
  type: 'object',
  properties: {
    month: { type: 'string', description: '볼 달 YYYY-MM (한국 시간). 없으면 이번 달' },
  },
  additionalProperties: false,
};

/** 도구 정의 — label 은 화면에 「…보는 중」으로 보인다 */
const TOOLS = [
  {
    name: 'list_consults',
    label: '상담 목록 보는 중',
    money: false,
    description:
      `우리 업체에 배정된 상담 목록(최근 ${CONSULTS_MAX}건). 고객 이름 · 지역 · 품목 · 문 마감 · 철거 · 희망 일정 · 상담 설명 · ` +
      '배정 상태(waiting 이면 expires_at 이 응답 마감)를 준다. 연락처는 주지 않는다.',
    input_schema: NO_INPUT,
  },
  {
    name: 'list_projects',
    label: '고객 · 프로젝트 보는 중',
    money: false,
    description: `업체 고객 · 프로젝트 목록(최근 ${PROJECTS_MAX}건). 제목 · 상태 · 고객 이름 · 이어진 설계 수를 준다.`,
    input_schema: NO_INPUT,
  },
  {
    name: 'list_orders',
    label: '수주 목록 보는 중',
    money: false,
    description:
      `수주 목록(최근 ${ORDERS_MAX}건). 수주 번호 · 고객 이름 · 상태 · 수주일 · 납품일 · 완료일 · 메모, ` +
      '대표 · 실장이면 계약금 · 받은 돈도 준다. status 로 한 상태만 고를 수 있다.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ORDER_STATUSES,
          description:
            'confirmed 확정 · in_production 제작 중 · delivered 납품 · completed 완료 · cancelled 취소',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_order',
    label: '수주 자세히 보는 중',
    money: false,
    description:
      '수주 하나를 자세히 본다. order_id 는 list_orders 의 id. 대표 · 실장이면 원가 줄 · 마진 요약 · 수금 일정까지 준다.',
    input_schema: {
      type: 'object',
      properties: { order_id: { type: 'string', format: 'uuid', description: '수주 id' } },
      required: ['order_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'books_summary',
    label: '장부 요약 보는 중',
    money: true,
    description:
      '업체 장부 요약(한 달과 그 앞 달): 계약 합 · 받은 돈 · 견적 마진 · 실적 마진 · 밀린 돈 · 30일 안에 받을 돈 · 상태별 수주 수. ' +
      '달 묶음은 수주한 달이다.',
    input_schema: MONTH_INPUT,
  },
  {
    name: 'ledger_month',
    label: '회계장부 보는 중',
    money: true,
    description:
      `회계장부 한 달: 합계(수입 · 비용 · 부가세) · 계정별 합 · 장부 줄(최근 ${LEDGER_ROWS_MAX}줄). ` +
      '수주 수금 · 원가도 돈이 오간 날로 들어 있다. 금액은 공급가, 부가세는 따로다.',
    input_schema: MONTH_INPUT,
  },
  {
    name: 'ledger_photos',
    label: '올린 사진 보는 중',
    money: false,
    description:
      '올린 영수증 · 명세표 사진(최근 100장)의 상태별 장수와 확인을 기다리는 가장 오래된 사진의 날짜. 직원이면 자기가 올린 것만.',
    input_schema: NO_INPUT,
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Messages API tools — 대화를 시작한 사람의 역할로 한 번 정하고 대화 내내 그대로 보낸다 */
export function toolDefs({ money }) {
  return TOOLS.filter((t) => money || !t.money).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    strict: true,
  }));
}

export function toolLabel(name) {
  const t = BY_NAME.get(name);
  return t ? t.label : '자료 보는 중';
}

/** 입력 다시 확인 → 고친 입력 (틀리면 ToolError) */
export function checkInput(name, input) {
  const v = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!v) throw new ToolError('입력이 객체가 아닙니다');
  const t = BY_NAME.get(name);
  if (!t) throw new ToolError(`없는 도구입니다: ${name}`);
  const allowed = Object.keys(t.input_schema.properties);
  for (const k of Object.keys(v))
    if (!allowed.includes(k)) throw new ToolError(`모르는 입력: ${k}`);
  if (name === 'list_orders' && v.status !== undefined && !ORDER_STATUSES.includes(v.status))
    throw new ToolError(`status 는 ${ORDER_STATUSES.join(' · ')} 중 하나입니다`);
  if (name === 'get_order' && !UUID_RE.test(String(v.order_id || '')))
    throw new ToolError('order_id 는 수주 id(uuid)입니다');
  if (t.input_schema === MONTH_INPUT && v.month !== undefined && !MONTH_RE.test(String(v.month)))
    throw new ToolError('month 는 YYYY-MM 입니다');
  return v;
}

/** workflow-api 를 그 사람 토큰으로 → data (실패하면 ToolError — 서버가 준 문구 그대로) */
async function wf(env, token, path) {
  if (!env.WORKFLOW_API || typeof env.WORKFLOW_API.fetch !== 'function')
    throw new ToolError('자료 서버에 닿지 못했습니다');
  let res;
  try {
    res = await env.WORKFLOW_API.fetch(
      new Request(`https://workflow-api${path}`, { headers: { Authorization: `Bearer ${token}` } })
    );
  } catch {
    throw new ToolError('자료 서버에 닿지 못했습니다');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    if (res.status === 401)
      throw new ToolError('로그인이 끝나 자료를 못 봤습니다. 다시 로그인해야 합니다');
    throw new ToolError((body && body.message) || `자료 서버 오류 (${res.status})`);
  }
  return body ? body.data : null;
}

// ── 도구마다 ────────────────────────────────────────────

async function listConsults(env, token, input, { money }) {
  const data = (await wf(env, token, '/company/consults')) || {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    total: items.length,
    items: items.slice(0, CONSULTS_MAX).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      status: r.status,
      customer_name: r.name || null,
      region: [r.sido, r.gugun].filter(Boolean).join(' ') || null,
      furniture: r.furniture_categories || [],
      door_finish: r.door_finish ?? null,
      demolition_needed: r.demolition_needed ?? null,
      wanted_price_tier: r.wanted_price_tier ?? null,
      preferred_date: r.preferred_date ?? null,
      preferred_time: r.preferred_time ?? null,
      wanted_done_date: r.wanted_done_date ?? null,
      description: clip(r.description, 300),
      request_detail_design: r.request_detail_design === true,
      ...(money ? { quote_total: r.quote_total ?? null } : {}),
      project_id: r.project_id ?? null,
      assignment: r.assignment
        ? {
            state: r.assignment.state,
            assigned_at: r.assignment.assigned_at,
            expires_at: r.assignment.expires_at,
          }
        : null,
    })),
  };
}

async function listProjects(env, token) {
  const data = (await wf(env, token, '/company/projects')) || {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    total: items.length,
    items: items.slice(0, PROJECTS_MAX).map((p) => ({
      id: p.id,
      title: p.title || null,
      status: p.status,
      created_at: p.created_at,
      closed_at: p.closed_at || null,
      customer_name: (p.customer && p.customer.name) || null,
      design_count: p.design_count || 0,
    })),
  };
}

function orderView(o, money) {
  const out = {
    id: o.id,
    order_no: o.order_no,
    customer_name: o.customer_name || null,
    status: o.status,
    ordered_at: o.ordered_at || null,
    delivered_at: o.delivered_at || null,
    completed_at: o.completed_at || null,
    note: clip(o.note, 200),
  };
  if (money && o.contract_amount !== undefined) out.contract_amount = o.contract_amount;
  if (money && o.received_amount !== undefined) out.received_amount = o.received_amount;
  return out;
}

async function listOrders(env, token, input, { money }) {
  const data = (await wf(env, token, '/orders')) || {};
  let items = Array.isArray(data.items) ? data.items : [];
  if (input.status) items = items.filter((o) => o.status === input.status);
  return {
    total: items.length,
    items: items.slice(0, ORDERS_MAX).map((o) => orderView(o, money)),
  };
}

async function getOrder(env, token, input, { money }) {
  const data = (await wf(env, token, `/orders/${encodeURIComponent(input.order_id)}`)) || {};
  const out = { order: data.order ? orderView(data.order, money) : null };
  if (Array.isArray(data.reworks)) out.rework_count = data.reworks.length;
  if (!money) return out;
  if (data.margin) out.margin = data.margin;
  if (Array.isArray(data.costs))
    out.costs = data.costs.slice(0, 50).map((c) => ({
      category: c.category,
      description: clip(c.description, 100),
      vendor_name: c.vendor_name || null,
      amount: c.amount,
      vat_amount: c.vat_amount ?? null,
      evidence_type: c.evidence_type ?? null,
      spent_on: c.spent_on || null,
      due_on: c.due_on || null,
    }));
  if (Array.isArray(data.payments))
    out.payments = data.payments.map((p) => ({
      stage: p.stage,
      amount: p.amount,
      due_on: p.due_on || null,
      paid_on: p.paid_on || null,
      method: p.method || null,
      memo: clip(p.memo, 100),
    }));
  return out;
}

const monthQuery = (input) => (input.month ? `?month=${input.month}` : '');

async function booksSummary(env, token, input) {
  return wf(env, token, `/books/summary${monthQuery(input)}`);
}

async function ledgerMonth(env, token, input) {
  const [book, accounts] = await Promise.all([
    wf(env, token, `/ledger/book${monthQuery(input)}`),
    wf(env, token, '/ledger/accounts'),
  ]);
  const names = new Map(((accounts && accounts.items) || []).map((a) => [a.code, a.name]));
  const rows = ((book && book.rows) || []).filter((r) => !r.voided_at);
  const byAccount = new Map();
  for (const r of rows) {
    const key = `${r.direction}|${r.account || ''}`;
    const cur = byAccount.get(key) || {
      direction: r.direction,
      account: r.account ? names.get(r.account) || r.account : '(계정 없음)',
      amount: 0,
      vat_amount: 0,
      count: 0,
    };
    cur.amount += Number(r.amount) || 0;
    cur.vat_amount += Number(r.vat_amount) || 0;
    cur.count += 1;
    byAccount.set(key, cur);
  }
  return {
    from: book && book.from,
    to: book && book.to,
    totals: book && book.totals,
    by_account: [...byAccount.values()].sort((a, b) => b.amount - a.amount),
    rows_total: rows.length,
    rows: rows.slice(-LEDGER_ROWS_MAX).map((r) => ({
      date: r.entry_date,
      source: r.source,
      direction: r.direction,
      account: r.account ? names.get(r.account) || r.account : null,
      description: clip(r.description, 80),
      counterparty: r.counterparty_name || null,
      amount: r.amount,
      vat_amount: r.vat_amount ?? null,
      evidence_type: r.evidence_type ?? null,
    })),
  };
}

async function ledgerPhotos(env, token) {
  const data = (await wf(env, token, '/ledger/documents?limit=100')) || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const by = {};
  let oldestPending = null;
  for (const d of items) {
    by[d.review_status] = (by[d.review_status] || 0) + 1;
    if (d.review_status === 'pending' && (!oldestPending || d.created_at < oldestPending))
      oldestPending = d.created_at;
  }
  return { counted: items.length, by_status: by, oldest_pending_at: oldestPending };
}

const RUN = {
  list_consults: listConsults,
  list_projects: listProjects,
  list_orders: listOrders,
  get_order: getOrder,
  books_summary: booksSummary,
  ledger_month: ledgerMonth,
  ledger_photos: ledgerPhotos,
};

/** 결과 → 글 (RESULT_MAX 를 넘으면 목록을 반씩 줄인다) */
export function resultText(value) {
  let v = value;
  let text = JSON.stringify(v);
  while (text.length > RESULT_MAX && v && Array.isArray(v.items) && v.items.length > 1) {
    v = { ...v, items: v.items.slice(0, Math.ceil(v.items.length / 2)), shortened: true };
    text = JSON.stringify(v);
  }
  while (text.length > RESULT_MAX && v && Array.isArray(v.rows) && v.rows.length > 1) {
    v = { ...v, rows: v.rows.slice(-Math.ceil(v.rows.length / 2)), shortened: true };
    text = JSON.stringify(v);
  }
  return text.length > RESULT_MAX ? text.slice(0, RESULT_MAX) : text;
}

/**
 * tool_use 블록 하나 → tool_result 블록. 던지지 않는다 — 실패는 is_error 결과로.
 * @param {{ token: string, money: boolean, allowed: Set<string> }} ctx allowed: 이 대화의 도구 이름
 */
export async function runTool(env, block, ctx) {
  const base = { type: 'tool_result', tool_use_id: block.id };
  try {
    if (!ctx.allowed.has(block.name) || !RUN[block.name])
      throw new ToolError(`이 대화에서 쓸 수 없는 도구입니다: ${block.name}`);
    const input = checkInput(block.name, block.input);
    const value = await RUN[block.name](env, ctx.token, input, { money: ctx.money });
    return { ...base, content: resultText(value === undefined ? null : value) };
  } catch (e) {
    const message = e instanceof ToolError ? e.message : '자료를 읽지 못했습니다';
    if (!(e instanceof ToolError))
      console.error('[assistant] tool failed:', block.name, e && e.message);
    return { ...base, content: message, is_error: true };
  }
}
