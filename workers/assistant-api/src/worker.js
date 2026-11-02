/**
 * dadam-assistant-api — SEGAN 업체 AI 비서 (Agent 업체 · 시험 업체).
 *
 *   GET  /health
 *   GET  /assistant/me                              내 자리 · 자격 (화면이 비서 탭을 열지 정한다)
 *   GET  /assistant/conversations                   내 대화 (새것부터 20)
 *   POST /assistant/conversations                   새 대화 → 201 { conversation } (자격 full)
 *   GET  /assistant/conversations/:id               대화 + 메시지 (글만 — 생각 블록 · 내부 블록은 주지 않는다)
 *   POST /assistant/conversations/:id/turns         { text } + X-Idempotency-Key → 202 { turn, after } (자격 full)
 *                                                   같은 키는 그 차례(200) · 도는 중이면 409 busy · 분 한도 429
 *   GET  /assistant/conversations/:id/events?after=N  사건 줄(NDJSON) — src/session.js
 *
 * 인증: Supabase 사용자 JWT (Authorization: Bearer). 사람 · 업체 · 자격은 src/access.js.
 * 표 · 함수는 database/migrations/0026 (assistant_*, company_entitled, assistant_budget_*).
 * 이 단계에는 도구가 없다 — 비서는 업체 자료를 읽지 않는다 (읽기 도구는 다음 단계).
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
import { textOf } from './claude.js';
import { maxTurns } from './session.js';

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

async function getConversation(request, env, user, id) {
  const a = await assistantAccess(env, user);
  const conv = await ownConversation(env, a, user, id);
  const rows = await selectMany(env, 'assistant_messages', {
    conversation_id: `eq.${conv.id}`,
    select: 'seq,role,content,created_at',
    order: 'seq.asc',
  });
  return ok(request, env, {
    conversation: conversationView(conv),
    messages: rows.map((r) => ({
      seq: r.seq,
      role: r.role,
      text: textOf(r.content),
      created_at: r.created_at,
    })),
  });
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
};
