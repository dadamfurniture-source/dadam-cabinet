/**
 * 시험 틀 — 가짜 Supabase(사람 · PostgREST · rpc) · 가짜 Durable Object · 가짜 Claude stream · 가짜 workflow-api(서비스 바인딩).
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
    extractions: [], // ledger_extractions
    documents: {}, // 사진 id → { company_id, storage_path, mime, review_status }
    photos: {}, // 버킷 경로 → Uint8Array
    calls: [],
    ...over,
  };

  function parse(q) {
    const out = {};
    for (const [k, v] of new URLSearchParams(q)) out[k] = v;
    return out;
  }
  // eq · lt · in.( ) 만
  const eq = (row, filters) =>
    Object.entries(filters).every(([k, v]) => {
      if (['select', 'order', 'limit'].includes(k)) return true;
      if (v.startsWith('eq.')) return String(row[k]) === v.slice(3);
      if (v.startsWith('lt.')) return String(row[k]) < v.slice(3);
      if (v.startsWith('in.(') && v.endsWith(')'))
        return v.slice(4, -1).split(',').includes(String(row[k]));
      throw new Error('fake: unsupported filter — ' + k + '=' + v);
    });
  const ok = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  db.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    db.calls.push({ method, path: url.pathname, query: url.search, body });
    if (url.origin !== SUPA) throw new Error('fake: unexpected host ' + url.href);

    const PHOTO = '/storage/v1/object/ledger-evidence/';
    if (url.pathname.startsWith(PHOTO)) {
      const p = decodeURIComponent(url.pathname.slice(PHOTO.length));
      const bytes = db.photos[p];
      return bytes ? new Response(bytes, { status: 200 }) : new Response('{}', { status: 404 });
    }

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
    if (path === 'rpc/ledger_extract_begin') {
      // 0029 ledger_extract_begin 과 같은 판정
      const doc = db.documents[body.p_document];
      if (!doc) return ok({ ok: false, reason: 'not_found' });
      if (doc.review_status !== 'pending') return ok({ ok: false, reason: 'not_pending' });
      const mine = db.extractions.filter((x) => x.document_id === body.p_document);
      const last = mine.sort((a, b) => b.attempt - a.attempt)[0];
      if (last) {
        if (last.status === 'running' || last.status === 'done')
          return ok({ ok: false, reason: last.status, id: last.id });
        if (['refused', 'skipped_budget'].includes(last.status) && !body.p_again)
          return ok({ ok: false, reason: last.status, id: last.id });
        if (last.attempt >= (body.p_again ? 5 : body.p_max_attempts))
          return ok({ ok: false, reason: 'max_attempts', id: last.id });
      }
      const row = {
        id: newId(),
        document_id: body.p_document,
        company_id: doc.company_id,
        attempt: last ? last.attempt + 1 : 1,
        status: 'running',
      };
      db.extractions.push(row);
      return ok({
        ok: true,
        id: row.id,
        attempt: row.attempt,
        company_id: doc.company_id,
        storage_path: doc.storage_path,
        mime: doc.mime,
        uploaded_by: doc.uploaded_by || null,
      });
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
      ledger_extractions: db.extractions,
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
    if (method === 'DELETE') {
      const hit = rows.filter((r) => eq(r, q));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      if (path === 'assistant_conversations') {
        const gone = new Set(hit.map((r) => r.id));
        db.messages = db.messages.filter((m) => !gone.has(m.conversation_id));
      }
      return new Response(null, { status: 204 });
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
      if (Array.isArray(k)) return k.filter((x) => map.delete(x)).length;
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
        /** 한 번에 받는 답 (사진 읽기) — 대본에 throwError 가 있으면 던진다 */
        async create(params) {
          claude.calls.push(structuredClone(params));
          const s = queue.shift() || reply('{}');
          if (s.throwError) throw s.throwError;
          return {
            model: s.model || params.model,
            content: s.content,
            stop_reason: s.stop_reason,
            usage: s.usage,
          };
        },
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

/** 도구 쓰는 답 — 생각 블록 + (글) + tool_use */
export function toolUse(name, input = {}, { id = 'tu-' + name, text = '', usage } = {}) {
  const content = [{ type: 'thinking', thinking: '', signature: 'sig-t' }];
  if (text) content.push({ type: 'text', text, citations: null });
  content.push({ type: 'tool_use', id, name, input });
  return {
    chunks: text ? text.match(/.{1,3}/gsu) : [],
    content,
    stop_reason: 'tool_use',
    usage: usage || {
      input_tokens: 1000,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

export const ORDER_ID = 'e0000000-0000-4000-8000-000000000001';

/** 기본 workflow-api 자료 — 경로마다 data */
function workflowData() {
  return {
    '/company/consults': {
      can_act: true,
      items: [
        {
          id: 'c1',
          created_at: '2026-11-01T01:00:00Z',
          status: 'assigned',
          name: '김고객',
          phone: '010-1234-5678',
          email: 'kim@example.com',
          sido: '서울',
          gugun: '강남구',
          furniture_categories: ['sink'],
          description: '상부장 교체',
          quote_total: 3_300_000,
          generation_image_url: 'https://signed.example/x.jpg',
          assignment: {
            id: 'a1',
            state: 'waiting',
            assigned_at: '2026-11-01T01:00:00Z',
            expires_at: '2026-11-02T01:00:00Z',
          },
        },
      ],
    },
    '/company/projects': {
      company: { id: CO, name: '시험 업체' },
      items: [
        {
          id: 'p1',
          title: '강남 주방',
          status: 'open',
          created_at: '2026-10-30T00:00:00Z',
          customer: { id: 'u1', name: '김고객', phone: '010-1234-5678' },
          design_count: 2,
        },
      ],
    },
    '/orders': {
      items: [
        {
          id: ORDER_ID,
          order_no: 'O-1',
          customer_name: '김고객',
          status: 'confirmed',
          ordered_at: '2026-11-01',
          contract_amount: 5_500_000,
          received_amount: 1_000_000,
          note: '잔금 현장',
        },
        {
          id: 'o2',
          order_no: 'O-2',
          customer_name: '이고객',
          status: 'completed',
          ordered_at: '2026-10-01',
          contract_amount: 2_200_000,
          received_amount: 2_200_000,
        },
      ],
    },
    ['/orders/' + ORDER_ID]: {
      order: {
        id: ORDER_ID,
        order_no: 'O-1',
        customer_name: '김고객',
        status: 'confirmed',
        ordered_at: '2026-11-01',
        contract_amount: 5_500_000,
        received_amount: 1_000_000,
      },
      costs: [
        {
          category: 'material',
          description: '도어',
          vendor_name: '예림',
          amount: 800_000,
          vat_amount: 80_000,
          evidence_type: 'tax_invoice',
          spent_on: '2026-11-02',
        },
      ],
      margin: {
        contract_amount: 5_500_000,
        received_amount: 1_000_000,
        outstanding: 4_500_000,
        cost_total: 800_000,
      },
      payments: [
        {
          stage: 'deposit',
          amount: 1_000_000,
          due_on: '2026-11-01',
          paid_on: '2026-11-01',
          method: 'transfer',
          memo: '계약금',
        },
      ],
      reworks: [],
    },
    '/books/summary': {
      month: '2026-11',
      months: [{ month: '2026-11', contract_total: 5_500_000 }],
      outstanding: { total: 0, count: 0 },
    },
    '/ledger/book': {
      from: '2026-11-01',
      to: '2026-11-30',
      totals: { income: 909_091, expense: 800_000 },
      rows: [
        {
          source: 'payment',
          entry_date: '2026-11-01',
          direction: 'income',
          account: 'income.sales',
          description: 'deposit',
          amount: 909_091,
          vat_amount: 90_909,
        },
        {
          source: 'cost',
          entry_date: '2026-11-02',
          direction: 'expense',
          account: 'expense.material',
          description: '도어',
          counterparty_name: '예림',
          amount: 800_000,
          vat_amount: 80_000,
          evidence_type: 'tax_invoice',
        },
        {
          source: 'entry',
          entry_date: '2026-11-02',
          direction: 'expense',
          account: 'expense.material',
          description: '취소된 줄',
          amount: 999,
          vat_amount: 0,
          voided_at: '2026-11-02T05:00:00Z',
        },
      ],
    },
    '/ledger/accounts': {
      items: [
        { code: 'income.sales', name: '매출' },
        { code: 'expense.material', name: '재료비' },
      ],
    },
    '/ledger/documents': {
      money: true,
      items: [
        { id: 'd1', review_status: 'pending', created_at: '2026-11-02T00:00:00Z' },
        { id: 'd2', review_status: 'pending', created_at: '2026-11-01T00:00:00Z' },
        { id: 'd3', review_status: 'posted', created_at: '2026-10-30T00:00:00Z' },
      ],
    },
  };
}

/**
 * 가짜 workflow-api — 경로(쿼리 빼고)마다 data 를 { success, data } 로. over: 경로 → data | (call) => Response.
 * calls 에 { path, query, token } 을 적는다. 토큰이 없으면 401.
 */
export function makeWorkflow(over = {}) {
  const routes = { ...workflowData(), ...over };
  const wf = {
    calls: [],
    routes,
    async fetch(request) {
      const url = new URL(request.url);
      const token = String(request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const call = { path: url.pathname, query: url.search, token };
      wf.calls.push(call);
      if (!token) return new Response('{"success":false,"message":"로그인"}', { status: 401 });
      const r = routes[url.pathname];
      if (typeof r === 'function') return r(call);
      if (r === undefined)
        return new Response('{"success":false,"message":"Not found"}', { status: 404 });
      return new Response(JSON.stringify({ success: true, data: r }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  return wf;
}

/** 워커 + env 한 벌 */
export async function makeWorld({
  db = makeDb(),
  claude = makeClaude(),
  workflow = makeWorkflow(),
  env: extra = {},
} = {}) {
  const worker = (await import('../src/worker.js')).default;
  let env;
  const sessions = makeSessions(() => env);
  env = {
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: 's',
    CORS_ORIGINS: 'https://dadamfurniture.com',
    ASSISTANT_SESSION: sessions,
    ASSISTANT_CLAUDE: claude,
    WORKFLOW_API: workflow,
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
  return { worker, env, db, claude, workflow, sessions, call, events };
}
