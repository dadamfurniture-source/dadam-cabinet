/**
 * 상담 분배 시험용 가짜 Supabase (PostgREST · Auth · Storage 서명).
 *
 * PostgREST 는 src/distribution/* · src/push/outbox.js · src/projects.js 가 쓰는 만큼만 흉내 낸다:
 *   거르기 eq · neq · in · is · gt · gte · lt · lte, select 칸 고르기(+ 「별명:칸->키」 JSON 꺼내기), order(여러 칸), limit,
 *   POST (배열 · on_conflict + resolution=merge-duplicates | ignore-duplicates · return=minimal), PATCH, DELETE.
 * DB 규칙 (database/migrations/0003 · 0016 · 0018 · 0019 와 같게):
 *   consult_assignments  본사 상담당 기다리는(assigned) 배정 하나 (23505) · state 가 assigned 이면 responded_at 없음 (23514)
 *   consultations        name · email 은 비울 수 없다 (23502)
 *   customers            (company_id, user_id) 유니크 (user_id 가 있을 때)
 *   notification_outbox  dedupe_key 유니크
 *   company_evaluations  company_id 기본 키, 넣거나 고치면 company_evaluation_history 에 한 줄 (트리거)
 *   company_service_settings  company_id 기본 키
 * Auth: Bearer 토큰이 곧 user id. admin/users/:id 는 { id, email }.
 * 시험 데이터는 모두 가짜다.
 */

export const SB = 'https://x.supabase.co';
export const ENV = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key' };

const ISO_RE = /^\d{4}-\d{2}-\d{2}(T|$)/;
const cmpVal = (v) => (typeof v === 'string' && ISO_RE.test(v) ? Date.parse(v) : v);

function json(body, status = 200) {
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
      return (
        v !== null &&
        v !== undefined &&
        raw
          .replace(/^\(|\)$/g, '')
          .split(',')
          .includes(String(v))
      );
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

const RESERVED = new Set(['select', 'order', 'limit', 'on_conflict']);
const PK = { company_evaluations: 'company_id', company_service_settings: 'company_id' };

let seq = 0;
export const fakeId = () => {
  seq += 1;
  return `00000000-0000-4000-9000-${String(seq).padStart(12, '0')}`;
};

/**
 * @param {object} o
 *   tables   처음 표 { 표: [행] } (깊은 복사)
 *   admins   관리자 user_id 목록
 *   nowMs    DB now()
 *   before   (method, table, params, body) → Response 면 그 요청을 그 응답으로 끝낸다 (경합 · 실패 흉내)
 */
export function createFake({ tables = {}, admins = [], nowMs = Date.now(), before = null } = {}) {
  const db = {
    companies: [],
    company_members: [],
    admin_roles: admins.map((user_id) => ({ user_id, role: 'admin' })),
    consultations: [],
    consult_assignments: [],
    company_service_settings: [],
    company_evaluations: [],
    company_evaluation_history: [],
    orders: [],
    rework_logs: [],
    install_feedback: [],
    design_snapshots: [],
    generations: [],
    customers: [],
    projects: [],
    notification_outbox: [],
    ...JSON.parse(JSON.stringify(tables)),
  };
  const calls = [];
  const nowIso = () => new Date(nowMs).toISOString();

  function project(row, select) {
    if (!select || select === '*') return { ...row };
    const out = {};
    for (const item of select.split(',')) {
      const alias = item.match(/^(\w+):(\w+)->(\w+)$/);
      if (alias) {
        const [, name, col, key] = alias;
        const v = row[col];
        out[name] = v && typeof v === 'object' && v[key] !== undefined ? v[key] : null;
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
      const keys = order.split(',').map((k) => {
        const [col, dir = 'asc'] = k.split('.');
        return { col, desc: dir === 'desc' };
      });
      out = [...out].sort((a, b) => {
        for (const { col, desc } of keys) {
          const x = cmpVal(a[col]);
          const y = cmpVal(b[col]);
          if (x === y) continue;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return (x < y ? -1 : 1) * (desc ? -1 : 1);
        }
        return 0;
      });
    }
    const limit = params.get('limit');
    if (limit) out = out.slice(0, Number(limit));
    return out;
  }

  const fail = (code, status, message = code) => json({ code, message }, status);

  /** 넣거나 고친 뒤의 행이 DB 규칙을 지키나 — 어기면 응답 */
  function check(table, row, self = null) {
    if (table === 'consult_assignments') {
      if (
        (row.state === 'assigned') !==
        (row.responded_at === null || row.responded_at === undefined)
      ) {
        return fail('23514', 400, 'consult_assignments_responded_check');
      }
      if (
        row.state === 'assigned' &&
        db.consult_assignments.some(
          (x) => x !== self && x.state === 'assigned' && x.consultation_id === row.consultation_id
        )
      ) {
        return fail('23505', 409, 'consult_assignments_one_open');
      }
    }
    if (table === 'consultations') {
      if (
        row.name === null ||
        row.name === undefined ||
        row.email === null ||
        row.email === undefined
      )
        return fail('23502', 400, 'not null');
    }
    if (table === 'customers' && row.user_id) {
      if (
        db.customers.some(
          (x) => x !== self && x.company_id === row.company_id && x.user_id === row.user_id
        )
      )
        return fail('23505', 409);
    }
    if (table === 'notification_outbox' && row.dedupe_key) {
      if (db.notification_outbox.some((x) => x !== self && x.dedupe_key === row.dedupe_key))
        return fail('23505', 409);
    }
    return null;
  }

  function defaults(table) {
    const base = { id: fakeId() };
    if (table === 'consultations')
      return {
        ...base,
        created_at: nowIso(),
        updated_at: nowIso(),
        status: 'pending',
        customer_id: null,
        project_id: null,
        user_id: null,
        generation_id: null,
      };
    if (table === 'consult_assignments')
      return {
        ...base,
        assigned_at: nowIso(),
        state: 'assigned',
        score: {},
        responded_at: null,
        responded_by: null,
        reason: null,
      };
    if (table === 'notification_outbox') return { ...base, state: 'queued', created_at: nowIso() };
    if (table === 'company_evaluations') return { evaluated_at: nowIso() };
    if (table === 'company_service_settings') return { updated_at: nowIso() };
    return { ...base, created_at: nowIso() };
  }

  function afterWrite(table, row) {
    if (table === 'company_evaluations') {
      db.company_evaluation_history.push({
        id: fakeId(),
        company_id: row.company_id,
        snapshot: JSON.parse(JSON.stringify(row)),
        evaluated_by: row.evaluated_by ?? null,
        evaluated_at: row.evaluated_at,
        created_at: nowIso(),
      });
    }
  }

  async function rest(url, init) {
    const method = (init.method || 'GET').toUpperCase();
    const table = url.pathname.replace('/rest/v1/', '');
    const headers = new Headers(init.headers || {});
    const body = init.body ? JSON.parse(init.body) : undefined;
    const prefer = headers.get('Prefer') || '';
    const params = url.searchParams;
    calls.push({ method, table, params, body, prefer, query: decodeURIComponent(url.search) });
    if (before) {
      const r = before(method, table, params, body);
      if (r) return r;
    }
    if (!db[table]) throw new Error(`fake: 모르는 표 ${table}`);
    const reply = (rows, status) =>
      prefer.includes('return=minimal') ? new Response(null, { status: 201 }) : json(rows, status);

    if (method === 'GET')
      return json(filterRows(table, params).map((r) => project(r, params.get('select'))));

    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const onConflict = params.get('on_conflict');
      const out = [];
      for (const r of list) {
        const key = PK[table] || (table === 'notification_outbox' ? 'dedupe_key' : null);
        const clash =
          key && onConflict === key && r[key] ? db[table].find((x) => x[key] === r[key]) : null;
        if (clash && prefer.includes('resolution=ignore-duplicates')) continue;
        if (clash && prefer.includes('resolution=merge-duplicates')) {
          const next = { ...clash, ...r };
          const bad = check(table, next, clash);
          if (bad) return bad;
          Object.assign(clash, r);
          afterWrite(table, clash);
          out.push({ ...clash });
          continue;
        }
        if (PK[table] && db[table].some((x) => x[PK[table]] === r[PK[table]]))
          return fail('23505', 409);
        const row = { ...defaults(table), ...r };
        const bad = check(table, row);
        if (bad) return bad;
        db[table].push(row);
        afterWrite(table, row);
        out.push({ ...row });
      }
      return reply(out, 201);
    }

    if (method === 'PATCH') {
      const hit = filterRows(table, params);
      for (const r of hit) {
        const bad = check(table, { ...r, ...body }, r);
        if (bad) return bad;
      }
      for (const r of hit) {
        Object.assign(r, body);
        afterWrite(table, r);
      }
      return reply(
        hit.map((r) => project(r, params.get('select'))),
        200
      );
    }

    if (method === 'DELETE') {
      const hit = new Set(filterRows(table, params));
      db[table] = db[table].filter((r) => !hit.has(r));
      return reply(
        [...hit].map((r) => project(r, params.get('select'))),
        200
      );
    }
    throw new Error(`fake: ${method} ${table}`);
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname.startsWith('/rest/v1/')) return rest(url, init);
    const auth = new Headers(init.headers || {}).get('Authorization') || '';
    if (url.pathname === '/auth/v1/user') {
      const id = auth.replace(/^Bearer\s+/i, '');
      return id && id !== 'bad'
        ? json({ id, email: `${id}@test.local` })
        : json({ message: 'bad jwt' }, 401);
    }
    const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (adminUser) return json({ id: adminUser[1], email: `${adminUser[1]}@test.local` });
    const sign = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)$/);
    if (sign) {
      const reqBody = JSON.parse(init.body);
      calls.push({ method: 'SIGN', table: `storage:${sign[1]}`, body: reqBody });
      return json(
        reqBody.paths.map((p) => ({
          path: p,
          signedURL: `/object/sign/${sign[1]}/${p}?token=t${reqBody.expiresIn}`,
        }))
      );
    }
    throw new Error(`fake: 모르는 주소 ${url}`);
  }

  return { db, calls, fetch: fetchImpl };
}

/**
 * 워커로 한 번 부른다 — fetch 를 갈아 끼우고, 응답 뒤 일(waitUntil)까지 기다린다.
 * @returns {Promise<{ status, json, headers }>}
 */
export async function callWorker(worker, fake, path, token, { method = 'GET', body } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const later = [];
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await worker.fetch(
      new Request(`https://api.test${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      ENV,
      { waitUntil: (p) => later.push(p) }
    );
    await Promise.all(later);
    const text = await r.text();
    return { status: r.status, json: text ? JSON.parse(text) : null, headers: r.headers };
  } finally {
    globalThis.fetch = original;
  }
}

/** fetch 만 갈아 끼우고 fn 을 돌린다 (서비스 함수를 바로 부를 때) */
export async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** 쓰기 요청 (GET 빼고) */
export const writesOf = (fake) =>
  fake.calls.filter((c) => c.method !== 'GET' && c.method !== 'SIGN');
