/**
 * 앱 알림 시험용 가짜 Supabase (PostgREST · Auth) + 가짜 푸시 서비스.
 *
 * PostgREST 는 src/push/* 가 쓰는 만큼만 흉내 낸다:
 *   필터 eq · neq · in · is · lt · lte · gt · gte, select(+ company:companies(status) 끼워 넣기), order, limit,
 *   POST (on_conflict + resolution=merge-duplicates | ignore-duplicates, return=minimal), PATCH, DELETE,
 *   rpc/claim_notifications (database/migrations/0016 의 SQL 과 같은 규칙).
 * 유니크: push_subscriptions.endpoint · notification_outbox.dedupe_key (같으면 23505).
 * 푸시 서비스는 받는 주소마다 정한 상태로 답한다 (pushStatus — 숫자 · 'throw' · 함수).
 * 시험 데이터는 모두 가짜다.
 */

export const SB = 'https://x.supabase.co';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const cmpVal = (v) => (typeof v === 'string' && ISO_RE.test(v) ? Date.parse(v) : v);

function jsonRes(body, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function matches(row, col, expr) {
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const v = row[col];
  switch (op) {
    case 'eq':
      return v !== null && v !== undefined && String(v) === raw;
    case 'neq':
      return v !== null && v !== undefined && String(v) !== raw;
    case 'in':
      return v !== null && v !== undefined && raw.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    case 'is':
      if (raw === 'null') return v === null || v === undefined;
      return String(v) === raw;
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      if (v === null || v === undefined) return false;
      const a = cmpVal(v);
      const b = typeof a === 'number' && !ISO_RE.test(raw) ? Number(raw) : cmpVal(raw);
      return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b;
    }
    default:
      throw new Error(`fake: op ${op}`);
  }
}

const UNIQUE = { push_subscriptions: 'endpoint', notification_outbox: 'dedupe_key' };
const RESERVED = new Set(['select', 'order', 'limit', 'on_conflict']);

let seq = 0;
const newId = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

/**
 * @param {object} [o]
 *   tables   처음 표 (없으면 빈 표)
 *   users    토큰 → { id, email }
 *   nowMs    DB 의 now()
 *   pushStatus  받는 주소 → 상태 숫자 | 'throw' | (call) => 상태. 없으면 201
 *   failDb   (method, table) => 상태 숫자면 그 요청을 실패시킨다
 */
export function createFake({ tables = {}, users = {}, nowMs = Date.now(), pushStatus = {}, failDb = null } = {}) {
  const db = {
    companies: [],
    company_members: [],
    partner_applications: [],
    push_subscriptions: [],
    notification_outbox: [],
    ...JSON.parse(JSON.stringify(tables)),
  };
  const calls = { rest: [], push: [], auth: 0 };
  const state = { nowMs };
  const nowIso = () => new Date(state.nowMs).toISOString();

  function project(table, row, select) {
    if (!select || select === '*') return { ...row };
    const out = {};
    for (const item of select.split(/,(?![^(]*\))/)) {
      const m = item.match(/^(\w+):(\w+)\((.*)\)$/);
      if (m) {
        const [, alias, target, cols] = m;
        const found = db[target].find((r) => r.id === row.company_id);
        out[alias] = found ? project(target, found, cols) : null;
      } else {
        out[item] = row[item] === undefined ? null : row[item];
      }
    }
    return out;
  }

  function filterRows(table, params) {
    let out = db[table].filter((row) => {
      for (const [k, v] of params) {
        if (RESERVED.has(k)) continue;
        if (!matches(row, k, v)) return false;
      }
      return true;
    });
    const order = params.get('order');
    if (order) {
      const [col, dir] = order.split('.');
      out = [...out].sort((a, b) => (cmpVal(a[col]) < cmpVal(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1));
    }
    const limit = params.get('limit');
    if (limit) out = out.slice(0, Number(limit));
    return out;
  }

  function claim(limit) {
    const now = state.nowMs;
    const picked = db.notification_outbox
      .filter(
        (r) =>
          r.state === 'queued' &&
          Date.parse(r.send_after) <= now &&
          r.attempts < 5 &&
          (r.claimed_at === null || Date.parse(r.claimed_at) < now - 5 * 60_000),
      )
      .sort((a, b) => Date.parse(a.send_after) - Date.parse(b.send_after) || Date.parse(a.created_at) - Date.parse(b.created_at))
      .slice(0, Math.min(Math.max(limit || 50, 1), 200));
    for (const r of picked) {
      r.claimed_at = nowIso();
      r.attempts += 1;
    }
    return picked.map((r) => ({ ...r }));
  }

  const DEFAULTS = {
    push_subscriptions: () => ({
      created_at: nowIso(),
      updated_at: nowIso(),
      last_sent_at: null,
      fail_count: 0,
      user_agent: null,
      company_id: null,
    }),
    notification_outbox: () => ({
      state: 'queued',
      attempts: 0,
      send_after: nowIso(),
      claimed_at: null,
      sent_at: null,
      last_error: null,
      created_at: nowIso(),
      company_id: null,
      ref_id: null,
      dedupe_key: null,
    }),
  };

  async function rest(url, init) {
    const method = (init.method || 'GET').toUpperCase();
    const path = url.pathname.replace('/rest/v1/', '');
    const headers = new Headers(init.headers || {});
    const body = init.body ? JSON.parse(init.body) : undefined;
    const prefer = headers.get('Prefer') || '';
    calls.rest.push({ method, path, query: decodeURIComponent(url.search), body, prefer });
    const failed = failDb && failDb(method, path);
    if (failed) return jsonRes({ code: 'XX000', message: 'boom' }, failed);

    if (path === 'rpc/claim_notifications') return jsonRes(claim(body && body.p_limit));
    const table = path;
    if (!db[table]) throw new Error(`fake: table ${table}`);
    const params = url.searchParams;
    const minimal = prefer.includes('return=minimal');
    const reply = (rows, status) => (minimal ? new Response(null, { status: 204 }) : jsonRes(rows, status));

    if (method === 'GET') {
      return jsonRes(filterRows(table, params).map((r) => project(table, r, params.get('select'))));
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const keys = JSON.stringify(Object.keys(list[0]).sort());
      if (list.some((r) => JSON.stringify(Object.keys(r).sort()) !== keys)) {
        return jsonRes({ code: 'PGRST102', message: 'All object keys must match' }, 400);
      }
      const uniq = UNIQUE[table];
      const onConflict = params.get('on_conflict');
      const out = [];
      for (const r of list) {
        const clash = uniq && r[uniq] !== null && r[uniq] !== undefined ? db[table].find((x) => x[uniq] === r[uniq]) : null;
        if (clash) {
          if (onConflict === uniq && prefer.includes('resolution=ignore-duplicates')) continue;
          if (onConflict === uniq && prefer.includes('resolution=merge-duplicates')) {
            Object.assign(clash, r);
            out.push(clash);
            continue;
          }
          return jsonRes({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        }
        const row = { ...(DEFAULTS[table] ? DEFAULTS[table]() : {}), id: newId(), ...r };
        db[table].push(row);
        out.push(row);
      }
      return reply(out.map((r) => ({ ...r })), 201);
    }
    if (method === 'PATCH') {
      const hit = filterRows(table, params);
      if (table === 'notification_outbox') {
        for (const r of hit) {
          const next = { ...r, ...body };
          if ((next.state === 'sent') !== (next.sent_at !== null && next.sent_at !== undefined)) {
            return jsonRes({ code: '23514', message: 'notification_outbox_sent_check' }, 400);
          }
        }
      }
      hit.forEach((r) => Object.assign(r, body));
      return reply(hit.map((r) => ({ ...r })), 200);
    }
    if (method === 'DELETE') {
      const hit = new Set(filterRows(table, params));
      db[table] = db[table].filter((r) => !hit.has(r));
      return reply([...hit], 200);
    }
    throw new Error(`fake: ${method} ${path}`);
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === SB && url.pathname.startsWith('/rest/v1/')) return rest(url, init);
    if (url.origin === SB && url.pathname === '/auth/v1/user') {
      calls.auth += 1;
      const auth = new Headers(init.headers || {}).get('Authorization') || '';
      const who = users[auth.replace(/^Bearer\s+/i, '')];
      return who ? jsonRes(who) : jsonRes({ message: 'bad jwt' }, 401);
    }
    // 푸시 서비스
    const endpoint = String(input);
    calls.push.push({ endpoint, init });
    const rule = pushStatus[endpoint];
    const status = typeof rule === 'function' ? rule(init) : rule === undefined ? 201 : rule;
    if (status === 'throw') throw new TypeError('fetch failed');
    return new Response(null, { status });
  }

  return { db, calls, state, fetch: fetchImpl };
}

/** fetch 를 갈아 끼우고 console 을 모은다 */
export async function withFake(fake, fn) {
  const original = globalThis.fetch;
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  globalThis.fetch = fake.fetch;
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(`${k}: ${a.map(String).join(' ')}`);
  try {
    return await fn(lines);
  } finally {
    globalThis.fetch = original;
    Object.assign(console, saved);
  }
}
