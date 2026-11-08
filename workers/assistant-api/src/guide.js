/**
 * 안내 모드 — 로그인한 누구나(고객 · 팩토리 구성원 · 작업자 · 본사) SEGAN 앱 쓰는 법을 묻는다. 2026-11-08 대표님 결정.
 * 업무 모드(지금 비서 — Agent · 시험 업체, src/session.js)와 따로다. 도구 · 업체 자료가 없고, 자격 함수(company_entitled)를 보지 않는다.
 *
 *   GET  /assistant/guide          { on, used, limit, remaining, day, reset_at } — 오늘(한국 시간) 쓴 질문 수 (세지 않는다)
 *   POST /assistant/guide/turns    { text, history? } → 200 NDJSON (한 줄에 사건 하나)
 *                                  start { used, limit, remaining, reset_at } · text { text } … ·
 *                                  끝 — done { stop_reason } · refused · error { code, message, given_back }
 *                                  보내기 전 오류(JSON): 401 · 422 invalid · 429 rate_limited(분 한도) ·
 *                                  429 guide_limit(하루 한도, data { used, limit, reset_at }) · 403 guide_off(스위치 끔 · 한도 0)
 *
 * 하루 한도 — DB 가 센다 (database/migrations/0048). assistant_global.guide_daily_limit(기본 20) · guide_on.
 *   assistant_guide_take 가 한 문장으로 한도 안에서만 하나 센다 — 동시에 보내도 넘지 않는다. 날짜는 한국 시간, 다음 한국 0시에 풀린다.
 *   글 확인(422)을 먼저 하므로 틀린 요청은 세지 않는다. 서버 쪽 실패(Claude 오류 · 빈 답 · 대화 객체 실패)는 하나 돌려주고,
 *   사람 쪽(끊고 나감 · 거절)은 돌려주지 않는다. 토큰 · 비용은 같은 줄에 더한다 (assistant_guide_settle).
 *
 * 대화 기록 — 서버에 두지 않는다. 화면이 지난 차례를 history 로 보낸다 (마지막 GUIDE_HISTORY_MAX 줄, 줄마다 GUIDE_HISTORY_TEXT_MAX 자).
 *   왜: 안내 모드 사람은 업체가 없어 업무 대화 표(assistant_conversations — 업체 열 필수)에 넣을 수 없고, 새 표를 만들면
 *   90일 보관 · 지우기 · 개인 정보가 함께 늘어난다. 도구 · 업체 자료가 없으므로 화면이 지난 비서 글을 꾸며 보내도
 *   그 사람 자신의 답만 흐려질 뿐 남의 자료 · 권한에 닿지 않는다. 길이 · 줄 수를 잘라 토큰을 묶는다.
 *
 * Claude — 업무 모드와 같은 SDK 부르기(src/claude.js buildRequest · claudeClient). 모델 GUIDE_MODEL(기본 Haiku 5.5) ·
 *   생각 정도 GUIDE_EFFORT(기본 low — 짧은 안내 답) · 최대 답 GUIDE_MAX_OUTPUT_TOKENS(기본 3000).
 *   시스템 글(src/guide-prompt.js)은 모두에게 같아 캐시를 건다. 날짜 · 등급 · 크레딧 · 오늘 질문 수는 사람 메시지 앞 맥락 블록.
 *   등급 · 크레딧은 묻는 사람의 토큰으로 my_credit_wallet 을 불러 읽는다 (그 사람 것만 — 못 읽으면 없이 답한다).
 *   Claude 는 미국 콜로에서 불러야 한다(홍콩 콜로 발신은 403 — src/session.js). 그래서 사람마다 Durable Object(GuideSession,
 *   idFromName('guide:' + 사람), locationHint SESSION_LOCATION)가 부르고 답을 그대로 흘려보낸다. 객체는 저장소를 쓰지 않는다.
 */
import { badRequest, forbidden, HttpError, ok, readJson, corsHeaders } from './http.js';
import { callRpc, callRpcAs } from './db.js';
import { buildRequest, claudeClient, textOf, MODEL_DEFAULT } from './claude.js';
import { CONTEXT_OPEN, todayText } from './prompt.js';
import { costMicros } from './meter.js';
import { guideSystemPrompt } from './guide-prompt.js';

/** 질문 글 최대 */
export const GUIDE_TEXT_MAX = 1000;
/** 받는 history 줄 수 최대 — 넘으면 422. 실제로 보내는 것은 마지막 GUIDE_HISTORY_MAX 줄 */
export const GUIDE_HISTORY_ACCEPT = 50;
export const GUIDE_HISTORY_MAX = 6;
export const GUIDE_HISTORY_TEXT_MAX = 2000;
const FLUSH_CHARS = 120;
const FLUSH_MS = 200;
const NDJSON = 'application/x-ndjson; charset=utf-8';

const TIER_NAME = Object.freeze({
  standard: 'Standard',
  manager: 'Manager',
  expert: 'Expert',
  agent: 'Agent',
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── 하루 한도 ───────────────────────────────────────────

/** assistant_guide_status 결과 → 화면 값 */
export function statusView(s) {
  const o = s && typeof s === 'object' ? s : {};
  const used = num(o.used);
  const limit = num(o.limit);
  const on = o.on === true && limit > 0;
  return {
    on,
    used,
    limit,
    remaining: on ? Math.max(limit - used, 0) : 0,
    day: o.day || null,
    reset_at: o.reset_at || null,
  };
}

export const guideOff = () =>
  forbidden('지금은 안내 모드를 쉬고 있습니다. 잠시 뒤 다시 시도해 주세요.', 'guide_off');

export const guideLimit = (take) =>
  new HttpError(
    429,
    `오늘 안내 질문 ${num(take.limit)}개를 모두 썼습니다. 내일 0시(한국 시간)부터 다시 물을 수 있습니다.`,
    'guide_limit',
    { used: num(take.used), limit: num(take.limit), reset_at: take.reset_at || null }
  );

/** assistant_guide_take 결과 확인 — 한도 안이 아니면 던진다 */
export function checkTake(take) {
  if (take && take.ok === true) return take;
  if (!take || take.reason === 'off' || num(take.limit) < 1) throw guideOff();
  throw guideLimit(take);
}

/** 정산 — 실패해도 던지지 않는다 (질문 수는 이미 세었다) */
export async function settleGuide(env, { userId, day, cost = 0, usage = null, giveBack = false }) {
  const u = usage || {};
  try {
    await callRpc(env, 'assistant_guide_settle', {
      p_user: userId,
      p_day: day,
      p_cost_micros: Math.max(0, Math.ceil(cost || 0)),
      p_usage: {
        input_tokens: num(u.input_tokens),
        output_tokens: num(u.output_tokens),
        cache_read_input_tokens: num(u.cache_read_input_tokens),
        cache_creation_input_tokens: num(u.cache_creation_input_tokens),
      },
      p_give_back: giveBack === true,
    });
  } catch (e) {
    console.error('[assistant] guide settle failed:', e && e.message);
  }
}

// ── 요청 만들기 (순수) ──────────────────────────────────

/** 본문 → { text, history } — 틀리면 422 */
export function parseGuideBody(body) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw badRequest('물어볼 글을 적어 주세요');
  if (text.length > GUIDE_TEXT_MAX) throw badRequest(`질문은 ${GUIDE_TEXT_MAX}자까지 보냅니다`);
  const raw = body.history === undefined || body.history === null ? [] : body.history;
  if (!Array.isArray(raw) || raw.length > GUIDE_HISTORY_ACCEPT)
    throw badRequest(`history 는 ${GUIDE_HISTORY_ACCEPT}줄까지의 배열입니다`);
  const lines = [];
  for (const h of raw) {
    if (
      !h ||
      typeof h !== 'object' ||
      !['user', 'assistant'].includes(h.role) ||
      typeof h.text !== 'string'
    )
      throw badRequest('history 의 줄은 { role: user | assistant, text } 입니다');
    const t = h.text.trim().slice(0, GUIDE_HISTORY_TEXT_MAX);
    if (t) lines.push({ role: h.role, text: t });
  }
  const history = lines.slice(-GUIDE_HISTORY_MAX);
  while (history.length && history[0].role !== 'user') history.shift(); // 첫 메시지는 사람
  return { text, history };
}

/** 맥락 블록 — 오늘 날짜 · 묻는 사람의 등급 · 크레딧(my_credit_wallet) · 오늘 안내 질문 수 */
export function guideContext(now, wallet, take) {
  const parts = [todayText(now)];
  if (wallet && typeof wallet === 'object') {
    const who = [];
    if (TIER_NAME[wallet.plan]) who.push(`등급 ${TIER_NAME[wallet.plan]}`);
    who.push(wallet.scope === 'company' ? '팩토리 크레딧 통장을 씀' : '내 크레딧 통장을 씀');
    if (
      wallet.balance !== null &&
      wallet.balance !== undefined &&
      Number.isFinite(Number(wallet.balance))
    )
      who.push(`남은 크레딧 ${Number(wallet.balance)}`);
    if (Number(wallet.monthly) > 0) who.push(`월 지급 크레딧 ${Number(wallet.monthly)}`);
    if (wallet.usable === false) who.push('지금은 이 크레딧 통장을 쓸 수 없는 상태');
    parts.push(`묻는 사람: ${who.join(' · ')}.`);
  } else {
    parts.push('묻는 사람의 등급 · 크레딧은 읽지 못했다.');
  }
  parts.push(
    `오늘 안내 질문 ${num(take && take.used)}번째 · 하루 ${num(take && take.limit)}개까지.`
  );
  return { type: 'text', text: `${CONTEXT_OPEN}${parts.join(' ')}</맥락>` };
}

/** history + 이번 질문 → Messages API messages (글만) */
export function guideMessages({ text, history, context }) {
  const out = (history || []).map((h) => ({
    role: h.role,
    content: [{ type: 'text', text: h.text }],
  }));
  out.push({ role: 'user', content: [context, { type: 'text', text }] });
  return out;
}

let SYSTEM = null;
/** 시스템 글 블록 — 모두에게 같아 캐시를 건다 (Haiku 5.5 캐시 최소 512 토큰 — 넘는다) */
export function guideSystem() {
  if (!SYSTEM) SYSTEM = guideSystemPrompt();
  return [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }];
}

/** Claude 요청 — 업무 모드와 같은 buildRequest, 모델 · 생각 정도 · 최대 답만 안내 모드 값. 도구 없음 */
export function guideRequest(env, messages) {
  return buildRequest(
    {
      ANTHROPIC_MODEL: env.GUIDE_MODEL || MODEL_DEFAULT,
      EFFORT: env.GUIDE_EFFORT || 'low',
      MAX_OUTPUT_TOKENS: env.GUIDE_MAX_OUTPUT_TOKENS || '3000',
      INFERENCE_GEO: env.INFERENCE_GEO,
    },
    { system: guideSystem(), messages }
  );
}

/** 묻는 사람의 크레딧 통장 — 그 사람 토큰으로 (남의 것은 읽을 수 없다). 못 읽으면 null */
export async function readWallet(env, token) {
  try {
    const rows = await callRpcAs(env, token, 'my_credit_wallet', {});
    const w = Array.isArray(rows) ? rows[0] : rows;
    return w && typeof w === 'object' ? w : null;
  } catch (e) {
    console.warn('[assistant] guide wallet read failed:', e && e.message);
    return null;
  }
}

// ── 주소 ────────────────────────────────────────────────

export async function guideStatus(request, env, user) {
  const s = await callRpc(env, 'assistant_guide_status', { p_user: user.id });
  return ok(request, env, statusView(s));
}

function guideStub(env, userId) {
  const ns = env.GUIDE_SESSION;
  return ns.get(ns.idFromName('guide:' + userId), { locationHint: env.SESSION_LOCATION || 'enam' });
}

/** 질문 하나 — 분 한도는 worker.js 가 먼저 본다 */
export async function guideTurn(request, env, user) {
  const { text, history } = parseGuideBody(await readJson(request));
  const [take, wallet] = await Promise.all([
    callRpc(env, 'assistant_guide_take', { p_user: user.id }),
    readWallet(env, user.token),
  ]);
  checkTake(take);
  const params = guideRequest(
    env,
    guideMessages({ text, history, context: guideContext(Date.now(), wallet, take) })
  );
  const start = {
    used: num(take.used),
    limit: num(take.limit),
    remaining: Math.max(num(take.limit) - num(take.used), 0),
    reset_at: take.reset_at || null,
  };
  let res;
  try {
    res = await guideStub(env, user.id).fetch('https://guide-session/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, day: take.day, params, start }),
    });
    if (!res.ok) throw new Error(`guide session ${res.status}`);
  } catch (e) {
    await settleGuide(env, { userId: user.id, day: take.day, giveBack: true });
    throw e;
  }
  return new Response(res.body, {
    status: 200,
    headers: { 'Content-Type': NDJSON, 'Cache-Control': 'no-store', ...corsHeaders(request, env) },
  });
}

// ── 대화 객체 (미국 콜로) ───────────────────────────────

/**
 * 한 질문을 끝까지 — start 를 먼저 보내고, 글 조각을 text 로, 끝 사건 하나, 그 뒤 정산.
 * out.gone — 사람이 끊고 나갔다(쓰기 실패). 그러면 Claude 를 멈추고 받은 만큼만 정산한다 (돌려주지 않는다).
 */
export async function runGuide(env, input, send, out) {
  const { params, userId, day } = input;
  send({ type: 'start', ...(input.start || {}) });
  let usage = null;
  let wrote = false;
  let final = null;
  let failed = null;
  let buf = '';
  let flushed = Date.now();
  const flush = () => {
    if (!buf) return;
    send({ type: 'text', text: buf });
    buf = '';
    flushed = Date.now();
  };
  try {
    const stream = claudeClient(env).beta.messages.stream(params);
    for await (const ev of stream) {
      if (out.gone) {
        if (typeof stream.abort === 'function') stream.abort();
        break;
      }
      if (ev.type === 'message_start' && ev.message) usage = { ...(ev.message.usage || {}) };
      if (ev.type === 'message_delta' && ev.usage) usage = { ...(usage || {}), ...ev.usage };
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        wrote = true;
        buf += ev.delta.text;
        if (buf.length >= FLUSH_CHARS || Date.now() - flushed >= FLUSH_MS) flush();
      }
    }
    if (!out.gone) {
      final = await stream.finalMessage();
      usage = final.usage || usage;
    }
  } catch (e) {
    failed = e;
  }
  if (!out.gone) flush();
  const model = (final && final.model) || params.model;
  const cost = costMicros(env, model, usage);
  let giveBack = false;
  if (out.gone) {
    // 끊고 나갔다 — 보낼 곳이 없다
  } else if (failed) {
    console.error(
      '[assistant] guide claude failed:',
      (failed && failed.status) || '',
      failed && failed.message
    );
    giveBack = !wrote;
    send({
      type: 'error',
      code: 'claude',
      message: '답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요.',
      given_back: giveBack,
    });
  } else if (final.stop_reason === 'refusal') {
    send({ type: 'refused' });
  } else if (!textOf(final.content)) {
    giveBack = true;
    send({
      type: 'error',
      code: 'empty',
      message: '답이 비었습니다. 다시 물어봐 주세요.',
      given_back: true,
    });
  } else {
    send({ type: 'done', stop_reason: final.stop_reason || null });
  }
  await settleGuide(env, { userId, day, cost, usage, giveBack });
}

export class GuideSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/turn')
      return new Response('not found', { status: 404 });
    const input = await request.json().catch(() => null);
    if (!input || !input.userId || !input.day || !input.params || typeof input.params !== 'object')
      return new Response(JSON.stringify({ error: 'bad_turn' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    const enc = new TextEncoder();
    const out = { gone: false };
    const send = (ev) => {
      if (out.gone) return;
      w.write(enc.encode(JSON.stringify(ev) + '\n')).catch(() => {
        out.gone = true;
      });
    };
    const run = runGuide(this.env, input, send, out)
      .catch((e) =>
        console.error('[assistant] guide turn failed:', e && e.stack ? e.stack : String(e))
      )
      .finally(() => w.close().catch(() => {}));
    if (this.ctx && typeof this.ctx.waitUntil === 'function') this.ctx.waitUntil(run);
    return new Response(readable, {
      headers: { 'Content-Type': NDJSON, 'Cache-Control': 'no-store' },
    });
  }
}
