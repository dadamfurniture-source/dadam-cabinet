/**
 * 시험 틀 — 가짜 Supabase(사람 · PostgREST · rpc) · 가짜 Durable Object · 가짜 Claude stream.
 * 실제 네트워크는 쓰지 않는다 (globalThis.fetch 를 갈아 끼운다).
 */
import { AssistantSession } from '../src/session.js';

export const SUPA = 'https://x.supabase.co';
export const CO = 'c0000000-0000-4000-8000-000000000001';
export const CO2 = 'c0000000-0000-4000-8000-000000000002';
export const OWNER = 'a0000000-0000-4000-8000-000000000001';
export const STAFF = 'a0000000-0000-4000-8000-000000000002';
export const OTHER = 'a0000000-0000-4000-8000-000000000003';
export const STRANGER = 'a0000000-0000-4000-8000-000000000004';

const TOKENS = { 't-owner': OWNER, 't-staff': STAFF, 't-other': OTHER, 't-stranger': STRANGER };

let uid = 0;
const newId = () => `d0000000-0000-4000-8000-${String(++uid).padStart(12, '0')}`;

/** 가짜 DB 상태 + fetch */
export function makeDb(over = {}) {
  const db = {
    members: [
      { user_id: OWNER, company_id: CO, role: 'owner', status: 'active' },
      { user_id: STAFF, company_id: CO, role: 'staff', status: 'active' },
      { user_id: OTHER, company_id: CO2, role: 'owner', status: 'active' },
    ],
    entitled: { [CO]: 'full', [CO2]: 'full' },
    conversations: [],
    messages: [],
    audit: [],
    playbooks: [],
    usage: [],
    limit: 10_000_000, // 업체 월 한도 micros
    reserveReason: null, // 정하면 잡기가 그 이유로 실패
    calls: [],
    ...over,
  };

  function parse(q) {
    const out = {};
    for (const [k, v] of new URLSearchParams(q)) out[k] = v;
    return out;
  }
  const eq = (row, filters) =>
    Object.entries(filters).every(([k, v]) => {
      if (['select', 'order', 'limit'].includes(k)) return true;
      if (!v.startsWith('eq.')) throw new Error('fake: only eq filters — ' + k + '=' + v);
      return String(row[k]) === v.slice(3);
    });
  const ok = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  db.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    db.calls.push({ method, path: url.pathname, query: url.search, body });
    if (url.origin !== SUPA) throw new Error('fake: unexpected host ' + url.href);

    if (url.pathname === '/auth/v1/user') {
      const tok = String((init.headers || {}).Authorization || '').replace(/^Bearer\s+/i, '');
      return TOKENS[tok] ? ok({ id: TOKENS[tok] }) : ok({ msg: 'bad' }, 401);
    }
    const path = url.pathname.replace('/rest/v1/', '');
    const q = parse(url.search);

    if (path === 'rpc/company_entitled') {
      const level = db.entitled[body.p_company] || 'none';
      const member = db.members.some(
        (m) => m.user_id === body.p_user && m.company_id === body.p_company && m.status === 'active'
      );
      return ok(body.p_user && !member ? 'none' : level);
    }
    if (path === 'rpc/assistant_budget_reserve') {
      const same = db.usage.find((u) => u.key === body.p_key);
      if (same) return ok({ ok: true, id: same.id, repeat: true });
      if (db.reserveReason) return ok({ ok: false, reason: db.reserveReason });
      const used = db.usage
        .filter((u) => u.company === body.p_company)
        .reduce((s, u) => s + (u.cost ?? u.reserved), 0);
      if (used + body.p_micros > db.limit)
        return ok({ ok: false, reason: 'over_limit', used, limit: db.limit });
      const row = {
        id: newId(),
        key: body.p_key,
        company: body.p_company,
        user: body.p_user,
        purpose: body.p_purpose,
        reserved: body.p_micros,
        model: body.p_model,
        cost: null,
        usage: null,
      };
      db.usage.push(row);
      return ok({ ok: true, id: row.id, repeat: false });
    }
    if (path === 'rpc/assistant_budget_settle') {
      const row = db.usage.find((u) => u.id === body.p_id);
      if (!row) return ok({ ok: false, reason: 'not_found' });
      if (row.cost !== null) return ok({ ok: true, repeat: true });
      row.cost = body.p_cost_micros;
      row.usage = body.p_usage;
      return ok({ ok: true, repeat: false });
    }

    const tables = {
      company_members: db.members,
      assistant_conversations: db.conversations,
      assistant_messages: db.messages,
      assistant_audit: db.audit,
      assistant_playbooks: db.playbooks,
    };
    const rows = tables[path];
    if (!rows) throw new Error('fake: unknown table ' + path);
    if (method === 'GET') {
      let out = rows.filter((r) => eq(r, q));
      if (q.order === 'seq.asc') out = out.slice().sort((a, b) => a.seq - b.seq);
      if (q.order === 'updated_at.desc')
        out = out.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      if (q.order === 'key.asc,version.desc')
        out = out
          .slice()
          .sort((a, b) => (a.key === b.key ? b.version - a.version : a.key < b.key ? -1 : 1));
      if (q.limit) out = out.slice(0, Number(q.limit));
      return ok(out);
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const now = new Date().toISOString();
      const made = list.map((r) => ({
        id: r.id || newId(),
        created_at: now,
        updated_at: now,
        ...r,
      }));
      if (path === 'assistant_messages') {
        for (const r of made) {
          if (rows.some((x) => x.conversation_id === r.conversation_id && x.seq === r.seq)) {
            return new Response('{"code":"23505"}', {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }
      rows.push(...made);
      return ok(made, 201);
    }
    if (method === 'PATCH') {
      const hit = rows.filter((r) => eq(r, q));
      for (const r of hit) Object.assign(r, body, { updated_at: new Date().toISOString() });
      return ok(hit);
    }
    throw new Error('fake: method ' + method);
  };
  return db;
}

/** 가짜 Durable Object 저장소 — get · put · delete · list({ prefix, start }) · setAlarm */
function makeStorage() {
  const map = new Map();
  return {
    map,
    alarm: null,
    async get(k) {
      return map.has(k) ? structuredClone(map.get(k)) : undefined;
    },
    async put(k, v) {
      map.set(k, structuredClone(v));
    },
    async delete(k) {
      return map.delete(k);
    },
    async list({ prefix = '', start = '' } = {}) {
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix) && k >= start).sort();
      return new Map(keys.map((k) => [k, structuredClone(map.get(k))]));
    },
    async setAlarm(t) {
      this.alarm = t;
    },
  };
}

/** 가짜 DO 이름공간 — 이름마다 객체 하나. hints 에 locationHint 를 적는다 */
export function makeSessions(envRef) {
  const objects = new Map();
  const ns = {
    hints: [],
    objects,
    idFromName: (name) => ({ name }),
    get(id, opts = {}) {
      ns.hints.push(opts.locationHint || null);
      if (!objects.has(id.name)) {
        const storage = makeStorage();
        const ctx = { storage, blockConcurrencyWhile: (fn) => fn() };
        objects.set(id.name, { obj: new AssistantSession(ctx, envRef()), storage });
      }
      const { obj } = objects.get(id.name);
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
    },
    /** 걸린 알람을 모두 돌린다 */
    async runAlarms() {
      for (const { obj, storage } of objects.values()) {
        if (storage.alarm !== null) {
          storage.alarm = null;
          await obj.alarm();
        }
      }
    },
  };
  return ns;
}

/** 가짜 Claude — 대본(script)마다 stream 하나. calls 에 받은 params 를 적는다 */
export function makeClaude(scripts = []) {
  const queue = scripts.slice();
  const claude = {
    calls: [],
    push: (...s) => queue.push(...s),
    beta: {
      messages: {
        stream(params) {
          claude.calls.push(structuredClone(params));
          const s = queue.shift() || reply('네.');
          const model = s.model || params.model; // 대본에 모델이 없으면 받은 모델로 답한다
          return {
            async *[Symbol.asyncIterator]() {
              yield {
                type: 'message_start',
                message: {
                  model,
                  usage: s.startUsage || { input_tokens: s.usage.input_tokens, output_tokens: 1 },
                },
              };
              for (const t of s.chunks || []) {
                yield {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'text_delta', text: t },
                };
              }
              if (s.throwAfter) throw s.throwAfter;
              yield {
                type: 'message_delta',
                delta: { stop_reason: s.stop_reason },
                usage: { output_tokens: s.usage.output_tokens },
              };
              yield { type: 'message_stop' };
            },
            async finalMessage() {
              return {
                model,
                content: s.content,
                stop_reason: s.stop_reason,
                usage: s.usage,
              };
            },
          };
        },
      },
    },
  };
  return claude;
}

/** 보통 답 — 생각 블록 + 글 */
export function reply(text, extra = {}) {
  const chunks = text.match(/.{1,3}/gsu) || [text];
  return {
    chunks,
    content: [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'text', text, citations: null },
    ],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...extra,
  };
}

/** 워커 + env 한 벌 */
export async function makeWorld({ db = makeDb(), claude = makeClaude(), env: extra = {} } = {}) {
  const worker = (await import('../src/worker.js')).default;
  let env;
  const sessions = makeSessions(() => env);
  env = {
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: 's',
    CORS_ORIGINS: 'https://dadamfurniture.com',
    ASSISTANT_SESSION: sessions,
    ASSISTANT_CLAUDE: claude,
    ...extra,
  };
  globalThis.fetch = db.fetch;
  const call = async (path, { token = 't-owner', method = 'GET', body, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(`https://assistant.test${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env
    );
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  /** NDJSON 사건 줄을 끝까지 읽는다 */
  const events = async (convId, after = 0, token = 't-owner') => {
    const res = await worker.fetch(
      new Request(
        `https://assistant.test/assistant/conversations/${convId}/events?after=${after}`,
        { headers: { Authorization: `Bearer ${token}` } }
      ),
      env
    );
    if (res.status !== 200) return { status: res.status, list: [] };
    const text = await res.text();
    return {
      status: 200,
      list: text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    };
  };
  return { worker, env, db, claude, sessions, call, events };
}
