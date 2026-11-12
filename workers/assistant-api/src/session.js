/**
 * AssistantSession — 대화 하나 = Durable Object 하나 (idFromName(대화 id), locationHint SESSION_LOCATION 기본 enam).
 *
 * 왜 DO 인가: 한 차례(Claude 부르기 + 도구)가 수십 초다. HTTP 요청 안에서 기다리면 탭을 닫는 순간 끊긴다.
 *   알람이 끝까지 돌리고(generate-api job.js 와 같은 방식), 화면은 사건 줄을 받는다 — 끊기면 ?after= 로 이어 받는다.
 *   미국 콜로에서 뜨므로 Claude 를 직접 부른다 (홍콩 콜로 발신은 api.anthropic.com 이 403).
 *
 * 내부 주소 — 워커(src/worker.js)만 부른다. 사람 · 업체 자격 · 대화 주인은 워커가 먼저 확인한다.
 *   POST /turn          { conversationId, companyId, userId, role, money, token, text, key } → 202 { turn, after }
 *                       같은 key 는 그 차례(200 reused) · 차례가 도는 중이면 409 busy
 *                       token(사람의 Supabase JWT)은 메모리에만 둔다 — 저장소 · 사건 · 기록에 넣지 않는다.
 *                       읽기 도구가 그 토큰으로 workflow-api 를 부른다 (src/tools.js). 객체가 다시 떠서 토큰이 없으면 expired.
 *   GET  /events?after=N  NDJSON 한 줄에 사건 하나 — 저장된 N 다음 사건부터, 차례가 끝날 때까지(최대 STREAM_MS) 이어 보낸다
 *   GET  /state         { running: { turn, after } | null } — 화면이 대화를 다시 열 때 도는 차례를 이어 받는다
 *
 * 사건 (n 은 이 대화 안에서 1부터 늘어난다. 최근 EVENT_KEEP 개만 둔다)
 *   사건 줄은 끊긴 화면이 이어 받는 데만 쓴다 — 차례가 끝나고 EVENT_TTL_MS 뒤 알람이 모두 지운다(번호 lastN 은 남긴다).
 *   답 글은 assistant_messages 에 있으므로 객체에는 개인 정보가 오래 남지 않는다 (90일 보관은 src/retention.js).
 *   start { turn } · text { turn, text } · tool { turn, name, label } · card { turn, action } · done { turn, stop_reason }
 *     card — 승인 카드 · 연락 초안을 만들었다 (src/actions.js actionView). 승인 · 거절은 워커 주소로 한다 (사건 없음)
 *   끝 — blocked { turn, reason } · refused { turn } · error { turn, code, message }
 *     blocked reason: not_entitled · conversation_full · no_limit · over_limit · off (예산 함수의 이유 그대로)
 *
 * 대화의 틀(frame) — 시스템 글 + 도구 목록. 첫 차례에 한 번 만들어 저장소 'frame' 에 두고 대화 내내 그대로 보낸다.
 *   둘 중 하나라도 바뀌면 지난 생각 블록이 무효가 된다 (Anthropic preserved thinking). 그래서 플레이북 · 역할이 바뀌어도
 *   이미 시작한 대화의 틀은 그대로고, 새 대화부터 새 틀이다. 날짜는 사람 메시지 앞 맥락 블록으로 붙인다.
 *
 * 한 차례 (alarm)
 *   1. 자격 다시 (company_entitled assistant, 사람)
 *   2. 지난 메시지 — MAX_TURNS 차례를 넘으면 conversation_full
 *   3. Claude 부르기마다 예산 잡기 — 키 chat:{대화}:{차례}:{몇 번째} (알람이 다시 돌아도 한 번만 깎는다) → stream → 정산
 *      답이 tool_use 면 도구를 돌려 tool_result 를 붙이고 다시 부른다 — 도구는 한 차례에 MAX_TOOL_ROUNDS 번까지.
 *      그 뒤에도 도구를 찾으면 「지금까지 본 자료로 답하라」는 오류 결과로 한 번 더 부르고, 그래도 찾으면 tool_limit.
 *   4. 글이 있는 답이면 이 차례의 메시지(사람 · 비서 · 도구 결과 · 비서 …)를 받은 그대로 한 번에 넣는다.
 *      실패 · 거절 · 글 없는 답이면 하나도 넣지 않는다 — 대화 기록에 짝 없는 차례가 남지 않는다
 *   5. 기록(assistant_audit turn — 숫자만, 글 · 도구 결과는 넣지 않는다)
 *   알람은 최소 한 번이라 다시 돌 수 있다. Claude 를 부르기 시작한 뒤 다시 돌면 error interrupted 로 끝낸다 (두 번 부르지 않는다).
 */
import { selectMany, insertMany, updateWhere } from './db.js';
import { entitledLevel } from './access.js';
import { reserveBudget, settleBudget, estimateMicros, costMicros } from './meter.js';
import { audit } from './audit.js';
import { claudeClient, buildRequest, historyOf, textOf, isTurnStart } from './claude.js';
import { systemPrompt, loadPlaybooks, contextBlock } from './prompt.js';
import { toolDefs, toolLabel, runTool } from './tools.js';
import { conversationActions, actionsContext } from './actions.js';

export const EVENT_KEEP = 500;
export const STREAM_MS = 55_000;
/** 차례가 끝나고 사건 줄을 지우기까지 */
export const EVENT_TTL_MS = 24 * 3600 * 1000;
export const MAX_TOOL_ROUNDS = 6;
const FLUSH_CHARS = 200;
const FLUSH_MS = 250;
const KEYS_KEEP = 20;
const END_TYPES = new Set(['done', 'blocked', 'refused', 'error']);
const TOOL_LIMIT_NOTE = `도구는 한 차례에 ${MAX_TOOL_ROUNDS}번까지 쓴다. 더 찾지 말고 지금까지 본 자료로 답하라.`;

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

const addUsage = (sum, u) => {
  sum.input_tokens += Number(u && u.input_tokens) || 0;
  sum.output_tokens += Number(u && u.output_tokens) || 0;
};

export class AssistantSession {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.subs = new Set();
    this.tokens = new Map(); // 차례 → 사람 토큰 (메모리에만)
    this.m = { lastN: 0, turns: 0, current: null, keys: [], purgeAt: null };
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
    if (request.method === 'GET' && url.pathname === '/state') {
      const cur = this.m.current;
      return jsonRes({ running: cur ? { turn: cur.turn, after: cur.after } : null }, 200);
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
      after,
      phase: 'queued',
      conversationId: input.conversationId,
      companyId: input.companyId,
      userId: input.userId,
      role: input.role || 'staff',
      money: input.money === true,
      text: String(input.text),
    };
    if (input.token) this.tokens.set(turn, String(input.token));
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
    if (!cur) return this.purgeIfDue();
    if (cur.phase !== 'queued') {
      // Claude 를 부르기 시작한 뒤 객체가 다시 떴다 — 두 번 부르지 않는다
      await this.fail(cur, 'interrupted', '답을 만드는 중에 끊겼습니다. 다시 보내 주세요.');
      return;
    }
    cur.phase = 'running';
    await this.save();
    const token = this.tokens.get(cur.turn) || null;
    this.tokens.delete(cur.turn);
    try {
      await this.runTurn(cur, token);
    } catch (e) {
      console.error('[assistant] turn failed:', e && e.stack ? e.stack : String(e));
      await this.record(cur, 'error', 'turn', {
        turn: cur.turn,
        message: String((e && e.message) || e).slice(0, 200),
      });
      await this.fail(cur, 'failed', '답을 만들지 못했습니다. 잠시 뒤 다시 보내 주세요.');
    }
  }

  /** 이 대화의 틀 — 없으면 지금 역할 · 플레이북으로 만들어 둔다 */
  async frame(cur) {
    const saved = await this.ctx.storage.get('frame');
    if (saved && typeof saved.system === 'string' && Array.isArray(saved.tools)) return saved;
    const frame = {
      system: systemPrompt({ role: cur.role, playbooks: await loadPlaybooks(this.env) }),
      tools: toolDefs({ money: cur.money }),
    };
    await this.ctx.storage.put('frame', frame);
    return frame;
  }

  async runTurn(cur, token) {
    const env = this.env;
    if ((await entitledLevel(env, cur.companyId, cur.userId)) !== 'full')
      return this.block(cur, 'not_entitled');
    if (!token) return this.fail(cur, 'expired', '잠시 끊겼습니다. 다시 보내 주세요.');

    const rows = await selectMany(env, 'assistant_messages', {
      conversation_id: `eq.${cur.conversationId}`,
      select: 'seq,role,content',
      order: 'seq.asc',
    });
    if (rows.filter(isTurnStart).length >= maxTurns(env))
      return this.block(cur, 'conversation_full');

    const frame = await this.frame(cur);
    const allowed = new Set(frame.tools.map((t) => t.name));
    const history = historyOf(rows);
    // 이 대화의 카드 상태 — 사람이 승인 · 거절한 결과를 비서가 알게 맥락 블록에 싣는다 (못 읽으면 카드 없이)
    const cards = await conversationActions(env, cur.conversationId)
      .then(actionsContext)
      .catch((e) => {
        console.error('[assistant] actions read failed:', e && e.message);
        return [];
      });
    const added = [
      {
        role: 'user',
        content: [contextBlock(Date.now(), cards), { type: 'text', text: cur.text }],
      },
    ];
    const started = Date.now();
    const sum = { input_tokens: 0, output_tokens: 0, cost_micros: 0, calls: 0, tools: 0 };
    let rounds = 0;
    let wrote = false;
    let final;
    let model = null;

    for (;;) {
      const params = buildRequest(env, {
        system: frame.system,
        tools: frame.tools,
        messages: history.concat(added),
      });
      sum.calls += 1;
      const reserve = await reserveBudget(env, {
        companyId: cur.companyId,
        userId: cur.userId,
        key: `chat:${cur.conversationId}:${cur.turn}:${sum.calls}`,
        micros: estimateMicros(env, params),
        model: params.model,
      });
      if (!reserve.ok) return this.block(cur, reserve.reason || 'over_limit');

      const got = await this.callClaude(cur, params, reserve, { gap: wrote });
      if (!got) return; // 실패는 callClaude 가 끝냈다
      final = got.final;
      model = final.model || params.model;
      wrote = wrote || got.wrote;
      addUsage(sum, got.usage);
      sum.cost_micros += got.cost;

      if (final.stop_reason === 'refusal') {
        await this.record(cur, 'blocked', 'refusal', this.detail(cur, sum, final, started));
        return this.finish(cur, 'refused', {});
      }
      const content = Array.isArray(final.content) ? final.content : [];
      const uses = content.filter((b) => b && b.type === 'tool_use');
      if (final.stop_reason !== 'tool_use' || !uses.length) {
        if (uses.length) {
          // 도구를 부르다 잘린 답 (max_tokens) — 짝 없는 tool_use 를 기록에 남기지 않는다
          await this.record(cur, 'error', 'cut', this.detail(cur, sum, final, started));
          return this.fail(cur, 'cut', '답이 너무 길어 끊겼습니다. 질문을 나눠 다시 보내 주세요.');
        }
        added.push({ role: 'assistant', content });
        break;
      }
      added.push({ role: 'assistant', content });
      if (rounds > MAX_TOOL_ROUNDS) {
        await this.record(cur, 'error', 'tool_limit', this.detail(cur, sum, final, started));
        return this.fail(
          cur,
          'tool_limit',
          '자료를 너무 많이 찾느라 답을 만들지 못했습니다. 질문을 좁혀 다시 보내 주세요.'
        );
      }
      const results = [];
      for (const b of uses) {
        if (rounds === MAX_TOOL_ROUNDS) {
          results.push({
            type: 'tool_result',
            tool_use_id: b.id,
            content: TOOL_LIMIT_NOTE,
            is_error: true,
          });
          continue;
        }
        await this.emit('tool', { turn: cur.turn, name: b.name, label: toolLabel(b.name) });
        sum.tools += 1;
        const r = await runTool(env, b, {
          token,
          money: cur.money,
          allowed,
          conversationId: cur.conversationId,
          companyId: cur.companyId,
          userId: cur.userId,
        });
        if (r.card) {
          await this.emit('card', { turn: cur.turn, action: r.card });
          delete r.card;
        }
        results.push(r);
      }
      rounds += 1;
      added.push({ role: 'user', content: results });
    }

    if (!added.some((m) => m.role === 'assistant' && textOf(m.content))) {
      await this.record(cur, 'error', 'empty', this.detail(cur, sum, final, started));
      return this.fail(cur, 'empty', '답이 비었습니다. 다시 보내 주세요.');
    }

    const seq = rows.length ? rows[rows.length - 1].seq : 0;
    await insertMany(
      env,
      'assistant_messages',
      added.map((m, i) => ({
        conversation_id: cur.conversationId,
        seq: seq + 1 + i,
        role: m.role,
        content: m.content,
      }))
    );
    await updateWhere(
      env,
      'assistant_conversations',
      { id: `eq.${cur.conversationId}` },
      seq === 0 ? { title: cur.text.trim().slice(0, 40) } : { updated_at: new Date().toISOString() }
    );
    await this.record(cur, 'turn', model, this.detail(cur, sum, final, started));
    return this.finish(cur, 'done', { stop_reason: final.stop_reason || null });
  }

  /**
   * Claude 한 번 (stream) — 글 조각을 text 사건으로. 성공이면 정산하고 { final, usage, cost, wrote },
   * 실패면 받은 만큼 정산 · 기록하고 error claude 로 차례를 끝낸 뒤 null.
   * gap: 이 차례에 앞서 쓴 글이 있으면 새 글 앞에 빈 줄을 넣는다 (도구 앞뒤 글이 붙지 않게).
   */
  async callClaude(cur, params, reserve, { gap }) {
    const env = this.env;
    const started = Date.now();
    let partial = null;
    let wrote = false;
    try {
      const stream = claudeClient(env).beta.messages.stream(params);
      let buf = '';
      let flushed = Date.now();
      for await (const ev of stream) {
        if (ev.type === 'message_start' && ev.message) partial = ev.message.usage || null;
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          if (!wrote && gap) buf += '\n\n';
          wrote = true;
          buf += ev.delta.text;
          if (buf.length >= FLUSH_CHARS || Date.now() - flushed >= FLUSH_MS) {
            await this.emit('text', { turn: cur.turn, text: buf });
            buf = '';
            flushed = Date.now();
          }
        }
      }
      if (buf) await this.emit('text', { turn: cur.turn, text: buf });
      const final = await stream.finalMessage();
      const model = final.model || params.model;
      const usage = final.usage || {};
      const cost = costMicros(env, model, usage);
      await settleBudget(env, reserve.id, cost, usage, model);
      return { final, usage, cost, wrote };
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
      await this.fail(cur, 'claude', '답을 만들지 못했습니다. 잠시 뒤 다시 보내 주세요.');
      return null;
    }
  }

  /** 기록용 숫자 — 글 · 도구 결과는 넣지 않는다 */
  detail(cur, sum, final, started) {
    return {
      turn: cur.turn,
      stop_reason: (final && final.stop_reason) || null,
      input_tokens: sum.input_tokens,
      output_tokens: sum.output_tokens,
      cost_micros: sum.cost_micros,
      calls: sum.calls,
      tools: sum.tools,
      ms: Date.now() - started,
    };
  }

  // ── 끝내기 ─────────────────────────────────────────────
  async finish(cur, type, data) {
    this.m.current = null;
    await this.emit(type, { turn: cur.turn, ...data });
    // 하루 뒤 사건 줄 지우기 — 다음 차례가 오면 그 차례 끝에서 다시 미룬다
    this.m.purgeAt = Date.now() + EVENT_TTL_MS;
    await this.save();
    await this.ctx.storage.setAlarm(this.m.purgeAt);
  }

  /** 지울 때가 됐으면 사건 줄 · 같은 키 기억을 지운다 (번호는 이어 간다) */
  async purgeIfDue() {
    if (!this.m.purgeAt || Date.now() < this.m.purgeAt) return;
    const keys = [...(await this.ctx.storage.list({ prefix: 'ev:' })).keys()];
    for (let i = 0; i < keys.length; i += 128)
      await this.ctx.storage.delete(keys.slice(i, i + 128));
    this.m.purgeAt = null;
    this.m.keys = [];
    await this.save();
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
