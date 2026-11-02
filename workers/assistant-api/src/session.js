/**
 * AssistantSession — 대화 하나 = Durable Object 하나 (idFromName(대화 id), locationHint SESSION_LOCATION 기본 enam).
 *
 * 왜 DO 인가: 한 차례(Claude 부르기)가 수십 초다. HTTP 요청 안에서 기다리면 탭을 닫는 순간 끊긴다.
 *   알람이 끝까지 돌리고(generate-api job.js 와 같은 방식), 화면은 사건 줄을 받는다 — 끊기면 ?after= 로 이어 받는다.
 *   미국 콜로에서 뜨므로 Claude 를 직접 부른다 (홍콩 콜로 발신은 api.anthropic.com 이 403).
 *
 * 내부 주소 — 워커(src/worker.js)만 부른다. 사람 · 업체 자격 · 대화 주인은 워커가 먼저 확인한다.
 *   POST /turn          { conversationId, companyId, userId, role, text, key } → 202 { turn, after }
 *                       같은 key 는 그 차례(200 reused) · 차례가 도는 중이면 409 busy
 *   GET  /events?after=N  NDJSON 한 줄에 사건 하나 — 저장된 N 다음 사건부터, 차례가 끝날 때까지(최대 STREAM_MS) 이어 보낸다
 *
 * 사건 (n 은 이 대화 안에서 1부터 늘어난다. 최근 EVENT_KEEP 개만 둔다)
 *   start { turn } · text { turn, text } · done { turn, stop_reason }
 *   끝 — blocked { turn, reason } · refused { turn } · error { turn, code, message }
 *     blocked reason: not_entitled · conversation_full · no_limit · over_limit · off (예산 함수의 이유 그대로)
 *
 * 한 차례 (alarm)
 *   1. 자격 다시 (company_entitled assistant, 사람)
 *   2. 지난 메시지 — MAX_TURNS 차례를 넘으면 conversation_full
 *   3. 예산 잡기 — 키 chat:{대화}:{차례} (알람이 다시 돌아도 한 번만 깎는다)
 *   4. Claude (stream) — 글 조각을 모아 text 사건으로
 *   5. 글이 있는 답이면 사람 메시지 + 비서 메시지(받은 블록 그대로)를 한 번에 넣는다.
 *      실패 · 거절 · 글 없는 답이면 둘 다 넣지 않는다 — 대화 기록에 짝 없는 차례가 남지 않는다
 *   6. 정산(실제 usage) · 기록(assistant_audit turn — 글은 넣지 않는다)
 *   알람은 최소 한 번이라 다시 돌 수 있다. Claude 를 부르기 시작한 뒤 다시 돌면 error interrupted 로 끝낸다 (두 번 부르지 않는다).
 */
import { selectMany, insertMany, updateWhere } from './db.js';
import { entitledLevel } from './access.js';
import { reserveBudget, settleBudget, estimateMicros, costMicros } from './meter.js';
import { audit } from './audit.js';
import { claudeClient, buildRequest, historyOf, textOf } from './claude.js';
import { systemPrompt, loadPlaybooks } from './prompt.js';

export const EVENT_KEEP = 500;
export const STREAM_MS = 55_000;
const FLUSH_CHARS = 200;
const FLUSH_MS = 250;
const KEYS_KEEP = 20;
const END_TYPES = new Set(['done', 'blocked', 'refused', 'error']);

const evKey = (n) => 'ev:' + String(n).padStart(10, '0');

function jsonRes(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function maxTurns(env) {
  const v = Number(env.MAX_TURNS);
  return Number.isInteger(v) && v > 0 ? v : 30;
}

export class AssistantSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.subs = new Set();
    this.m = { lastN: 0, turns: 0, current: null, keys: [] };
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('meta');
      if (saved) this.m = { ...this.m, ...saved };
    });
  }

  async save() {
    await this.ctx.storage.put('meta', this.m);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/turn')
      return this.startTurn(await request.json());
    if (request.method === 'GET' && url.pathname === '/events') {
      const after = Number(url.searchParams.get('after'));
      return this.events(Number.isInteger(after) && after > 0 ? after : 0);
    }
    return new Response('not found', { status: 404 });
  }

  // ── 차례 받기 ───────────────────────────────────────────
  async startTurn(input) {
    if (!input || !input.conversationId || !input.companyId || !input.userId || !input.text) {
      return jsonRes({ error: 'bad_turn' }, 400);
    }
    const seen = input.key ? this.m.keys.find((k) => k.key === input.key) : null;
    if (seen) return jsonRes({ turn: seen.turn, after: seen.after, reused: true }, 200);
    if (this.m.current) return jsonRes({ error: 'busy', turn: this.m.current.turn }, 409);
    const turn = this.m.turns + 1;
    const after = this.m.lastN;
    this.m.turns = turn;
    this.m.current = {
      turn,
      phase: 'queued',
      conversationId: input.conversationId,
      companyId: input.companyId,
      userId: input.userId,
      role: input.role || 'staff',
      text: String(input.text),
    };
    if (input.key)
      this.m.keys = this.m.keys.concat([{ key: input.key, turn, after }]).slice(-KEYS_KEEP);
    await this.emit('start', { turn });
    await this.ctx.storage.setAlarm(Date.now());
    return jsonRes({ turn, after, reused: false }, 202);
  }

  // ── 사건 ──────────────────────────────────────────────
  async emit(type, data) {
    const ev = { n: this.m.lastN + 1, type, ...data, at: new Date().toISOString() };
    this.m.lastN = ev.n;
    await this.ctx.storage.put(evKey(ev.n), ev);
    if (ev.n > EVENT_KEEP) await this.ctx.storage.delete(evKey(ev.n - EVENT_KEEP));
    await this.save();
    for (const s of [...this.subs]) s.push(ev);
    return ev;
  }

  async events(after) {
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    const enc = new TextEncoder();
    let last = after;
    let replaying = true;
    let closed = false;
    const pending = [];
    const finish = () => {
      if (closed) return;
      closed = true;
      this.subs.delete(sub);
      clearTimeout(timer);
      w.close().catch(() => {});
    };
    // 저장된 사건을 다시 보낼 때는 지난 차례의 끝 사건에서 닫지 않는다 — 다 보낸 뒤 도는 차례가 없으면 닫는다
    const send = (ev) => {
      if (closed || ev.n <= last) return;
      last = ev.n;
      w.write(enc.encode(JSON.stringify(ev) + '\n')).catch(finish);
      if (!replaying && END_TYPES.has(ev.type)) finish();
    };
    const sub = { push: (ev) => (replaying ? pending.push(ev) : send(ev)) };
    this.subs.add(sub);
    const timer = setTimeout(finish, STREAM_MS);

    const stored = await this.ctx.storage.list({ prefix: 'ev:', start: evKey(after + 1) });
    for (const ev of stored.values()) send(ev);
    replaying = false;
    for (const ev of pending) send(ev);
    if (!this.m.current) finish(); // 도는 차례가 없으면 저장된 것까지만
    return new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── 차례 돌리기 ─────────────────────────────────────────
  async alarm() {
    const cur = this.m.current;
    if (!cur) return;
    if (cur.phase !== 'queued') {
      // Claude 를 부르기 시작한 뒤 객체가 다시 떴다 — 두 번 부르지 않는다
      await this.fail(cur, 'interrupted', '답을 만드는 중에 끊겼습니다. 다시 보내 주세요.');
      return;
    }
    cur.phase = 'running';
    await this.save();
    try {
      await this.runTurn(cur);
    } catch (e) {
      console.error('[assistant] turn failed:', e && e.stack ? e.stack : String(e));
      await this.record(cur, 'error', 'turn', {
        turn: cur.turn,
        message: String((e && e.message) || e).slice(0, 200),
      });
      await this.fail(cur, 'failed', '답을 만들지 못했습니다. 잠시 뒤 다시 보내 주세요.');
    }
  }

  async runTurn(cur) {
    const env = this.env;
    if ((await entitledLevel(env, cur.companyId, cur.userId)) !== 'full')
      return this.block(cur, 'not_entitled');

    const rows = await selectMany(env, 'assistant_messages', {
      conversation_id: `eq.${cur.conversationId}`,
      select: 'seq,role,content',
      order: 'seq.asc',
    });
    if (rows.filter((r) => r.role === 'user').length >= maxTurns(env))
      return this.block(cur, 'conversation_full');

    const userContent = [{ type: 'text', text: cur.text }];
    const params = buildRequest(env, {
      system: systemPrompt({ role: cur.role, playbooks: await loadPlaybooks(env) }),
      messages: historyOf(rows).concat([{ role: 'user', content: userContent }]),
    });
    const reserve = await reserveBudget(env, {
      companyId: cur.companyId,
      userId: cur.userId,
      key: `chat:${cur.conversationId}:${cur.turn}`,
      micros: estimateMicros(env, params),
      model: params.model,
    });
    if (!reserve.ok) return this.block(cur, reserve.reason || 'over_limit');

    const started = Date.now();
    let partial = null;
    let final;
    try {
      const stream = claudeClient(env).beta.messages.stream(params);
      let buf = '';
      let flushed = Date.now();
      for await (const ev of stream) {
        if (ev.type === 'message_start' && ev.message) partial = ev.message.usage || null;
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          buf += ev.delta.text;
          if (buf.length >= FLUSH_CHARS || Date.now() - flushed >= FLUSH_MS) {
            await this.emit('text', { turn: cur.turn, text: buf });
            buf = '';
            flushed = Date.now();
          }
        }
      }
      if (buf) await this.emit('text', { turn: cur.turn, text: buf });
      final = await stream.finalMessage();
    } catch (e) {
      await settleBudget(
        env,
        reserve.id,
        costMicros(env, params.model, partial),
        partial,
        params.model
      );
      await this.record(cur, 'error', 'claude', {
        turn: cur.turn,
        status: (e && e.status) || null,
        ms: Date.now() - started,
      });
      return this.fail(cur, 'claude', '답을 만들지 못했습니다. 잠시 뒤 다시 보내 주세요.');
    }

    const model = final.model || params.model;
    const usage = final.usage || {};
    const cost = costMicros(env, model, usage);
    await settleBudget(env, reserve.id, cost, usage, model);
    const detail = {
      turn: cur.turn,
      stop_reason: final.stop_reason || null,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cost_micros: cost,
      ms: Date.now() - started,
    };
    if (final.stop_reason === 'refusal') {
      await this.record(cur, 'blocked', 'refusal', detail);
      return this.finish(cur, 'refused', {});
    }
    if (!textOf(final.content)) {
      await this.record(cur, 'error', 'empty', detail);
      return this.fail(cur, 'empty', '답이 비었습니다. 다시 보내 주세요.');
    }

    const seq = rows.length ? rows[rows.length - 1].seq : 0;
    await insertMany(env, 'assistant_messages', [
      { conversation_id: cur.conversationId, seq: seq + 1, role: 'user', content: userContent },
      {
        conversation_id: cur.conversationId,
        seq: seq + 2,
        role: 'assistant',
        content: final.content,
      },
    ]);
    await updateWhere(
      env,
      'assistant_conversations',
      { id: `eq.${cur.conversationId}` },
      seq === 0 ? { title: cur.text.trim().slice(0, 40) } : { updated_at: new Date().toISOString() }
    );
    await this.record(cur, 'turn', model, detail);
    return this.finish(cur, 'done', { stop_reason: final.stop_reason || null });
  }

  // ── 끝내기 ─────────────────────────────────────────────
  async finish(cur, type, data) {
    this.m.current = null;
    await this.emit(type, { turn: cur.turn, ...data });
  }

  async block(cur, reason) {
    await this.record(cur, 'blocked', reason, { turn: cur.turn });
    return this.finish(cur, 'blocked', { reason });
  }

  async fail(cur, code, message) {
    return this.finish(cur, 'error', { code, message });
  }

  record(cur, kind, name, detail) {
    return audit(this.env, {
      companyId: cur.companyId,
      userId: cur.userId,
      conversationId: cur.conversationId,
      kind,
      name,
      detail,
    });
  }
}
