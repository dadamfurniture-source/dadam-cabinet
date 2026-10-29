/**
 * 가짜 Supabase(PostgREST · Auth) + 토스 API.
 *
 * 워커는 전부 global fetch 로 나가므로 fetch 하나만 갈아 끼운다 (generate-api 시험과 같은 방식).
 * PostgREST 는 워커가 쓰는 만큼만 흉내 낸다:
 *   필터 eq · neq · lt · lte · gt · gte · in · is, order, limit,
 *   POST(+ on_conflict + resolution=ignore-duplicates), PATCH(return=representation), DELETE.
 * 트리거(업체 등급 맞추기 등)는 흉내 내지 않는다 — 워커가 무엇을 쓰는지만 본다.
 * 시각 비교는 ISO 문자열이면 Date.parse 로 한다 (DB 의 timestamptz 비교와 같게).
 */

export const SUPABASE_URL = 'https://example.supabase.co';
export const TOSS_BASE = 'https://api.tosspayments.com';

export const ENV = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  TOSS_SECRET_KEY: 'test_sk_dummy',
  TOSS_CLIENT_KEY: 'test_ck_dummy',
  TOSS_PRICE_EXPERT_KRW: '99000',
  TOSS_PRICE_AGENT_KRW: '199000',
  CORS_ORIGINS: 'https://dadamfurniture.com',
};

export const DAY = 86_400_000;

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asComparable(v) {
  if (typeof v === 'string' && ISO_RE.test(v)) return Date.parse(v);
  return v;
}

function parseArg(raw, sample) {
  if (typeof sample === 'number') return Number(raw);
  if (typeof sample === 'string' && ISO_RE.test(sample)) return Date.parse(raw);
  if (typeof sample === 'boolean') return raw === 'true';
  return raw;
}

function matches(row, col, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const v = row[col];
  switch (op) {
    case 'is':
      if (raw === 'null') return v === null || v === undefined;
      if (raw === 'true') return v === true;
      if (raw === 'false') return v === false;
      throw new Error(`fake: is.${raw}`);
    case 'in': {
      const list = raw.replace(/^\(|\)$/g, '').split(',');
      return v !== null && v !== undefined && list.includes(String(v));
    }
    case 'eq':
      if (v === null || v === undefined) return false;
      return asComparable(v) === parseArg(raw, v) || String(v) === raw;
    case 'neq':
      if (v === null || v === undefined) return false;
      return !(asComparable(v) === parseArg(raw, v) || String(v) === raw);
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (v === null || v === undefined) return false;
      const a = asComparable(v);
      const b = parseArg(raw, v);
      if (op === 'lt') return a < b;
      if (op === 'lte') return a <= b;
      if (op === 'gt') return a > b;
      return a >= b;
    }
    default:
      throw new Error(`fake: unsupported op ${op}`);
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'on_conflict']);
const UNIQUE = {
  payment_history: ['provider', 'order_id'],
  payment_events: ['provider', 'event_id'],
  notification_outbox: ['dedupe_key'],
};

export function createBackend({ nowMs = Date.now() } = {}) {
  const db = {
    subscriptions: [],
    payment_history: [],
    payment_events: [],
    profiles: [],
    user_credits: [],
    credit_ledger: [],
    companies: [],
    company_members: [],
    company_events: [],
    company_credits: [],
    partner_applications: [],
  };
  const calls = { toss: [], rest: [] };
  const state = {
    nowMs,
    /** (method, table, body) => true 면 그 요청을 500 으로 떨어뜨린다 */
    failDb: null,
    users: {}, // token → { id, email }
    admins: new Set(), // token
    /** 정기·첫 결제 응답을 차례로. 함수면 (payload, headers) 로 부른다 */
    chargeQueue: [],
    cancelResult: null, // null = 성공, 아니면 { status, code, message }
    payments: {}, // paymentKey → payment (조회용)
    ordersById: {}, // orderId → payment (주문번호 조회용)
    issueResult: { billingKey: 'bk_new', customerKey: null },
  };

  function rows(table) {
    if (!db[table]) db[table] = [];
    return db[table];
  }

  // or=(col.op.val,col.op."quoted val") — 하나라도 맞으면 통과
  function matchesOr(row, expr) {
    const inner = expr.replace(/^\(|\)$/g, '');
    const parts = [];
    let buf = '';
    let quoted = false;
    for (const ch of inner) {
      if (ch === '"') quoted = !quoted;
      if (ch === ',' && !quoted) {
        parts.push(buf);
        buf = '';
      } else {
        buf += ch;
      }
    }
    if (buf) parts.push(buf);
    return parts.some((part) => {
      const dot = part.indexOf('.');
      const col = part.slice(0, dot);
      const rest = part.slice(dot + 1).replace(/"/g, '');
      return matches(row, col, rest);
    });
  }

  function filterRows(table, params) {
    let out = rows(table).filter((row) => {
      for (const [k, expr] of params) {
        if (RESERVED.has(k)) continue;
        if (k === 'or') {
          if (!matchesOr(row, expr)) return false;
          continue;
        }
        if (!matches(row, k, expr)) return false;
      }
      return true;
    });
    const order = params.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      out = [...out].sort((a, b) => {
        const x = asComparable(a[col]);
        const y = asComparable(b[col]);
        if (x === y) return 0;
        return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      });
    }
    const limit = params.get('limit');
    if (limit) out = out.slice(0, Number(limit));
    return out;
  }

  async function rest(url, init) {
    const method = (init.method || 'GET').toUpperCase();
    const path = url.pathname.replace('/rest/v1/', '');
    const headers = new Headers(init.headers || {});
    calls.rest.push({
      method,
      path,
      query: url.search,
      body: init.body ? JSON.parse(init.body) : undefined,
    });

    if (path === 'rpc/is_admin') {
      const token = (headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      return jsonRes(state.admins.has(token));
    }

    const table = path;
    const reqBody = init.body ? JSON.parse(init.body) : undefined;
    if (state.failDb && state.failDb(method, table, reqBody)) {
      return new Response('boom', { status: 500 });
    }
    const params = url.searchParams;

    if (method === 'GET') {
      // select=a,b,c 면 그 칸만 (PostgREST 처럼). '*' 나 없으면 전부.
      const select = params.get('select');
      const found = filterRows(table, params);
      if (!select || select === '*') return jsonRes(found);
      const cols = select.split(',').map((c) => c.trim());
      return jsonRes(
        found.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])))
      );
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      const list = Array.isArray(body) ? body : [body];
      const prefer = headers.get('Prefer') || '';
      const out = [];
      for (const r of list) {
        const row = {
          id: crypto.randomUUID(),
          created_at: new Date(state.nowMs).toISOString(),
          ...r,
        };
        const uniq = UNIQUE[table];
        if (uniq && rows(table).some((x) => uniq.every((c) => x[c] === row[c]))) {
          if (prefer.includes('resolution=ignore-duplicates')) continue;
          return new Response(JSON.stringify({ code: '23505', message: 'duplicate key' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        rows(table).push(row);
        out.push(row);
      }
      return jsonRes(out, 201);
    }
    if (method === 'PATCH') {
      const patch = JSON.parse(init.body);
      const hit = filterRows(table, params);
      hit.forEach((row) => Object.assign(row, patch));
      return jsonRes(hit);
    }
    if (method === 'DELETE') {
      const hit = new Set(filterRows(table, params));
      db[table] = rows(table).filter((r) => !hit.has(r));
      return jsonRes([...hit]);
    }
    throw new Error(`fake rest: ${method} ${path}`);
  }

  async function auth(url, init) {
    const headers = new Headers(init.headers || {});
    const token = (headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const user = state.users[token];
    if (!user) return jsonRes({ message: 'invalid' }, 401);
    return jsonRes({ id: user.id, email: user.email, user_metadata: { name: user.name || null } });
  }

  async function toss(url, init) {
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = {
      method,
      path: url.pathname,
      body,
      idempotencyKey: headers.get('Idempotency-Key'),
    };
    calls.toss.push(call);

    if (method === 'POST' && url.pathname === '/v1/billing/authorizations/issue') {
      return jsonRes({ ...state.issueResult, customerKey: body.customerKey });
    }
    if (method === 'POST' && url.pathname.startsWith('/v1/billing/')) {
      const next = state.chargeQueue.length ? state.chargeQueue.shift() : 'ok';
      const result = typeof next === 'function' ? await next(body, call) : next;
      if (result === 'ok' || result === undefined) {
        const payment = {
          paymentKey: `pk_${body.orderId}`,
          orderId: body.orderId,
          status: 'DONE',
          totalAmount: body.amount,
          method: '카드',
          receipt: { url: `https://receipt.example/${body.orderId}` },
        };
        state.payments[payment.paymentKey] = payment;
        state.ordersById[payment.orderId] = payment;
        return jsonRes(payment);
      }
      if (result.throw) throw result.throw;
      return jsonRes({ code: result.code, message: result.message || result.code }, result.status);
    }
    const cancel = url.pathname.match(/^\/v1\/payments\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancel) {
      if (state.cancelResult) {
        return jsonRes(
          {
            code: state.cancelResult.code,
            message: state.cancelResult.message || state.cancelResult.code,
          },
          state.cancelResult.status
        );
      }
      const key = decodeURIComponent(cancel[1]);
      return jsonRes({ paymentKey: key, status: 'CANCELED' });
    }
    const byOrder = url.pathname.match(/^\/v1\/payments\/orders\/([^/]+)$/);
    if (method === 'GET' && byOrder) {
      const p = state.ordersById[decodeURIComponent(byOrder[1])];
      return p ? jsonRes(p) : jsonRes({ code: 'NOT_FOUND_PAYMENT', message: 'nf' }, 404);
    }
    const byKey = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (method === 'GET' && byKey) {
      const p = state.payments[decodeURIComponent(byKey[1])];
      return p ? jsonRes(p) : jsonRes({ code: 'NOT_FOUND_PAYMENT', message: 'nf' }, 404);
    }
    throw new Error(`fake toss: ${method} ${url.pathname}`);
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === SUPABASE_URL && url.pathname.startsWith('/rest/v1/')) return rest(url, init);
    if (url.origin === SUPABASE_URL && url.pathname === '/auth/v1/user') return auth(url, init);
    if (url.origin === TOSS_BASE) return toss(url, init);
    throw new Error(`fake fetch: unexpected ${url}`);
  }

  return {
    db,
    calls,
    state,
    fetch: fetchImpl,
    tossCalls(prefix) {
      return calls.toss.filter((c) => c.path.startsWith(prefix));
    },
    charges() {
      return calls.toss.filter(
        (c) =>
          c.method === 'POST' && c.path.startsWith('/v1/billing/') && !c.path.endsWith('/issue')
      );
    },
    cancels() {
      return calls.toss.filter((c) => c.method === 'POST' && c.path.endsWith('/cancel'));
    },
  };
}

/** global fetch 를 갈아 끼우고, 되돌리는 함수를 준다. */
export function installFetch(backend) {
  const real = globalThis.fetch;
  globalThis.fetch = backend.fetch;
  return () => {
    globalThis.fetch = real;
  };
}

/** console 소음을 막는다 (실패 로그는 일부러 내는 것이다). */
export function quietConsole() {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  console.log = (...a) => lines.push(['log', a.join(' ')]);
  console.warn = (...a) => lines.push(['warn', a.join(' ')]);
  console.error = (...a) => lines.push(['error', a.join(' ')]);
  return {
    lines,
    restore() {
      Object.assign(console, saved);
    },
  };
}

export const iso = (ms) => new Date(ms).toISOString();
