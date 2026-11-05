/**
 * dadam-assistant-api — SEGAN 업체 AI 비서 (Agent 업체 · 시험 업체).
 *
 *   GET  /health
 *   GET  /assistant/me                              내 자리 · 자격 (화면이 비서 탭을 열지 정한다)
 *   GET  /assistant/conversations                   내 대화 (새것부터 20)
 *   POST /assistant/conversations                   새 대화 → 201 { conversation } (자격 full)
 *   GET  /assistant/conversations/:id               대화 + 메시지 (글만 — 생각 블록 · 도구 블록 · 맥락 블록은 주지 않는다)
 *                                                   한 차례의 비서 글(도구 앞뒤)은 한 메시지로 묶는다. running: 도는 차례 { turn, after } | null
 *                                                   actions: 이 대화의 승인 카드 · 연락 초안 (오래된 것부터)
 *   POST /assistant/conversations/:id/turns         { text } + X-Idempotency-Key → 202 { turn, after } (자격 full)
 *                                                   같은 키는 그 차례(200) · 도는 중이면 409 busy · 분 한도 429
 *   GET  /assistant/conversations/:id/events?after=N  사건 줄(NDJSON) — src/session.js
 *   POST /assistant/actions/:id/approve             승인 카드 실행 — 대화한 본인 · 자격 full · 기한 안, 한 번만 (src/actions.js)
 *   POST /assistant/actions/:id/reject              승인 카드 거절
 *   scheduled (하루 한 번)                          시작한 지 90일 지난 대화 지우기 — src/retention.js
 *
 * 인증: Supabase 사용자 JWT (Authorization: Bearer). 사람 · 업체 · 자격은 src/access.js.
 * 표 · 함수는 database/migrations/0026 (assistant_*, company_entitled, assistant_budget_*).
 * 읽기 도구(src/tools.js)는 묻는 사람의 토큰으로 workflow-api 를 부른다 — 토큰은 그 차례 동안 대화 객체의 메모리에만 둔다.
 */
import {
  ok,
  json,
  errorResponse,
  handleOptions,
  corsHeaders,
  readJson,
  badRequest,
  conflict,
  rateLimited,
  notFound,
} from './http.js';
import { verifyUser, selectMany, insertOne } from './db.js';
import { assistantAccess, ownConversation } from './access.js';
import { textOf, userTextOf, isTurnStart } from './claude.js';
import { maxTurns } from './session.js';
import { runRetention } from './retention.js';
import { conversationActions, ownAction, approveAction, rejectAction } from './actions.js';

export { AssistantSession } from './session.js';

const TEXT_MAX = 4000;
const LIST_MAX = 20;
const KEY_RE = /^[A-Za-z0-9_.:-]{1,200}$/;

function sessionStub(env, conversationId) {
  const id = env.ASSISTANT_SESSION.idFromName(conversationId);
  return env.ASSISTANT_SESSION.get(id, { locationHint: env.SESSION_LOCATION || 'enam' });
}

/** 분 한도 — 바인딩이 없거나(시험 · 로컬) 한도기가 실패하면 세지 않는다 (workflow-api 장부 올리기와 같다) */
async function enforceRateLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return;
  let out;
  try {
    out = await binding.limit({ key: String(key) });
  } catch (e) {
    console.warn('[assistant] rate limiter failed:', e && e.message);
    return;
  }
  if (out && out.success === false) throw rateLimited();
}

function conversationView(row) {
  return {
    id: row.id,
    title: row.title || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── 처리 ────────────────────────────────────────────────
async function me(request, env, user) {
  const a = await assistantAccess(env, user);
  return ok(request, env, {
    company_id: a.companyId,
    role: a.role,
    money: a.money,
    level: a.level,
    can_chat: a.level === 'full',
    max_turns: maxTurns(env),
  });
}

async function listConversations(request, env, user) {
  const a = await assistantAccess(env, user);
  const rows = await selectMany(env, 'assistant_conversations', {
    user_id: `eq.${user.id}`,
    company_id: `eq.${a.companyId}`,
    select: 'id,title,created_at,updated_at',
    order: 'updated_at.desc',
    limit: String(LIST_MAX),
  });
  return ok(request, env, { items: rows.map(conversationView) });
}

async function createConversation(request, env, user) {
  const a = await assistantAccess(env, user, { chat: true });
  const row = await insertOne(env, 'assistant_conversations', {
    company_id: a.companyId,
    user_id: user.id,
  });
  return ok(request, env, { conversation: conversationView(row) }, 201);
}

/** 저장된 메시지 → 화면 메시지 — 사람 글 하나 · 그 차례 비서 글 하나씩 (도구 결과만 담긴 메시지는 건너뛴다) */
export function messagesView(rows) {
  const out = [];
  for (const r of rows || []) {
    if (r.role === 'user') {
      if (!isTurnStart(r)) continue;
      out.push({ seq: r.seq, role: 'user', text: userTextOf(r.content), created_at: r.created_at });
      continue;
    }
    const text = textOf(r.content);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === 'assistant') last.text += '\n\n' + text;
    else out.push({ seq: r.seq, role: 'assistant', text, created_at: r.created_at });
  }
  return out;
}

async function getConversation(request, env, user, id) {
  const a = await assistantAccess(env, user);
  const conv = await ownConversation(env, a, user, id);
  const [rows, state, actions] = await Promise.all([
    selectMany(env, 'assistant_messages', {
      conversation_id: `eq.${conv.id}`,
      select: 'seq,role,content,created_at',
      order: 'seq.asc',
    }),
    sessionStub(env, conv.id)
      .fetch('https://assistant-session/state')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    // 카드를 못 읽어도 대화는 연다 (DB 0041 전 · 끊김)
    conversationActions(env, conv.id).catch((e) => {
      console.error('[assistant] actions read failed:', e && e.message);
      return [];
    }),
  ]);
  return ok(request, env, {
    conversation: conversationView(conv),
    messages: messagesView(rows),
    running: (state && state.running) || null,
    actions,
  });
}

/** 승인 · 거절 — 승인은 지금도 비서 자격 full 이어야 한다 */
async function decideAction(request, env, user, id, decision) {
  const a = await assistantAccess(env, user, { chat: decision === 'approve' });
  const row = await ownAction(env, a, user, id);
  const action =
    decision === 'approve'
      ? await approveAction(env, { access: a, user, row })
      : await rejectAction(env, { user, row });
  return ok(request, env, { action });
}

async function sendTurn(request, env, user, id) {
  const a = await assistantAccess(env, user, { chat: true });
  const conv = await ownConversation(env, a, user, id);
  await enforceRateLimit(env.ASSISTANT_TURN_LIMIT, user.id);
  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw badRequest('보낼 글을 적어 주세요');
  if (text.length > TEXT_MAX) throw badRequest(`글은 ${TEXT_MAX}자까지 보냅니다`);
  const rawKey = request.headers.get('X-Idempotency-Key');
  if (rawKey && !KEY_RE.test(rawKey)) throw badRequest('X-Idempotency-Key 형식이 틀렸습니다');
  const res = await sessionStub(env, conv.id).fetch('https://assistant-session/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversationId: conv.id,
      companyId: a.companyId,
      userId: user.id,
      role: a.role,
      money: a.money,
      token: user.token,
      text,
      key: rawKey || null,
    }),
  });
  const out = await res.json();
  if (res.status === 409) throw conflict('앞 차례가 아직 도는 중입니다', 'busy');
  if (res.status >= 400) throw new Error(`session ${res.status}`);
  return ok(
    request,
    env,
    { turn: out.turn, after: out.after, reused: !!out.reused },
    res.status === 202 ? 202 : 200
  );
}

async function streamEvents(request, env, user, id) {
  const a = await assistantAccess(env, user);
  const conv = await ownConversation(env, a, user, id);
  const after = Number(new URL(request.url).searchParams.get('after'));
  const n = Number.isInteger(after) && after > 0 ? after : 0;
  const res = await sessionStub(env, conv.id).fetch(`https://assistant-session/events?after=${n}`);
  return new Response(res.body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
    },
  });
}

// ── 길 찾기 ─────────────────────────────────────────────
const CONV_RE = /^\/assistant\/conversations\/([^/]+)(\/turns|\/events)?$/;
const ACTION_RE = /^\/assistant\/actions\/([^/]+)\/(approve|reject)$/;

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  if (path === '/health' && method === 'GET') {
    return json(request, env, {
      ok: true,
      service: 'dadam-assistant-api',
      colo: (request.cf && request.cf.colo) || null,
    });
  }
  if (path === '/assistant/me' && method === 'GET')
    return me(request, env, await verifyUser(request, env));
  if (path === '/assistant/conversations') {
    if (method === 'GET') return listConversations(request, env, await verifyUser(request, env));
    if (method === 'POST') return createConversation(request, env, await verifyUser(request, env));
  }
  const m = CONV_RE.exec(path);
  if (m) {
    const [, id, tail] = m;
    if (!tail && method === 'GET')
      return getConversation(request, env, await verifyUser(request, env), id);
    if (tail === '/turns' && method === 'POST')
      return sendTurn(request, env, await verifyUser(request, env), id);
    if (tail === '/events' && method === 'GET')
      return streamEvents(request, env, await verifyUser(request, env), id);
  }
  const act = ACTION_RE.exec(path);
  if (act && method === 'POST')
    return decideAction(request, env, await verifyUser(request, env), act[1], act[2]);
  throw notFound('주소가 없습니다');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions(request, env);
    try {
      return await route(request, env);
    } catch (e) {
      return errorResponse(request, env, e);
    }
  },

  /** 하루 한 번 (wrangler [triggers] crons) — 90일 지난 대화 지우기 (src/retention.js) */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRetention(env, { nowMs: event.scheduledTime }));
  },
};
