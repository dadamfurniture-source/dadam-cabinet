/**
 * @jest-environment node
 *
 * 협력업체 길 (workers/account-api/src/partner.js + worker.js 라우팅).
 *
 * 고정하는 것:
 *   1) 응답 모양 — 성공 { success, data }, 실패 { success:false, code, error } (+ 422 는 field), Cache-Control: no-store, private,
 *      시각은 ISO(UTC). 로그인 안 됨 401 unauthorized · 관리자 아님 403 not_admin · 서버 키 없음 503 not_configured
 *   2) GET /partner/me — 협력업체만 company 로, 본사 구성원은 company null + hq_member. 직원 목록 · 초대는 대표에게만
 *   3) 신청 — 본사 409 · 열린 신청 409 · Expert 대표는 upgrade(업체 값으로 채움, 이력 agent_applied) · 그 밖 구성원 409 ·
 *      형식 422(앞뒤 공백 자름, 연락처 · 사업자번호는 숫자와 -). 거두기
 *   4) 등급 예약 — Agent → Expert 예약 · 예약 취소, 대표만, 이력 plan_change_requested
 *   5) 직원 초대 — 토큰은 발급 때 한 번만(DB 에는 sha256 hex), 7일. 미리 보기 · 수락(한 번만, 동시 수락은 되돌림) · 거두기 · 내보내기
 *   6) 관리자 — 신청 목록(이메일) · 미팅 · 승인(upgrade 면 next_plan agent + used_at) · 보류 · 업체 목록 · 업체로 만들기
 *   7) profiles.tier 를 쓰지 않는다 · company_events 에 개인정보가 없다
 *
 * Supabase REST 는 표를 메모리에 둔 작은 흉내(fakeDb)로 대신한다 — 필터(eq · neq · in · is · gt · lt) · select(+ 업체 끼워 넣기) ·
 * order · limit · 유니크(23505) · FK(23503) · CHECK(23514) 를 0011 마이그레이션과 같게 흉내 낸다. 시험 데이터는 모두 가짜다.
 * ESM 을 jest(CJS) 에서 읽기 위해 import · export 를 떼고, import 하던 것은 인자로 넣어 평가한다.
 */

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

function loadEsm(rel, names, deps = {}) {
  const src = read(rel)
    .replace(/^import [\s\S]*?;\n/gm, '')
    .replace(/^export default /m, 'const __default = ')
    .replace(/^export /gm, '');
  const keys = Object.keys(deps);
  return new Function(...keys, src + `\nreturn { ${names.join(', ')} };`)(
    ...keys.map((k) => deps[k])
  );
}

const SP = loadEsm('workers/account-api/src/storage-purge.js', [
  'UUID_RE',
  'makePurgeContext',
  'purgeDesignFiles',
  'purgeSummary',
  'purgeUserFiles',
]);
const Wd = loadEsm(
  'workers/account-api/src/withdrawal.js',
  ['prepareWithdrawal', 'soleOwnerCompanies', 'withdrawalDetail', 'withdrawalSummary'],
  SP
);
const C = loadEsm('workers/account-api/src/cors.js', [
  'corsHeaders',
  'handleOptions',
  'jsonResponse',
]);
const Pt = loadEsm(
  'workers/account-api/src/partner.js',
  [
    'matchPartnerRoute',
    'partnerResponse',
    'runPartnerRoute',
    'hashInviteToken',
    'newInviteToken',
    'INVITE_TTL_MS',
    'PHONE_RE',
    'BIZNO_RE',
  ],
  { jsonResponse: C.jsonResponse, UUID_RE: SP.UUID_RE }
);
const W = loadEsm('workers/account-api/src/worker.js', ['__default'], {
  corsHeaders: C.corsHeaders,
  handleOptions: C.handleOptions,
  jsonResponse: C.jsonResponse,
  matchPartnerRoute: Pt.matchPartnerRoute,
  partnerResponse: Pt.partnerResponse,
  runPartnerRoute: Pt.runPartnerRoute,
  ...Wd,
}).__default;

const MIGRATION_0011 = (() => {
  try {
    return read('database/migrations/0011_partner_signup.sql');
  } catch {
    return null;
  }
})();

const SB = 'https://example.supabase.co';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  CORS_ORIGINS: 'https://dadamfurniture.com',
};

// 사람
const U = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  hq: 'a0000000-0000-4000-8000-000000000002',
  owner: 'a0000000-0000-4000-8000-000000000003', // Expert 업체 대표
  staff: 'a0000000-0000-4000-8000-000000000004', // Expert 업체 직원
  owner2: 'a0000000-0000-4000-8000-000000000005', // Expert 업체의 두 번째 대표
  agentOwner: 'a0000000-0000-4000-8000-000000000006', // Agent 업체 대표
  suspOwner: 'a0000000-0000-4000-8000-000000000007', // 정지된 업체 대표
  newbie: 'a0000000-0000-4000-8000-000000000008', // 아무 데도 없음
  left: 'a0000000-0000-4000-8000-000000000009', // Expert 업체에서 나간 사람
};
const TOKENS = Object.fromEntries(
  Object.entries(U).map(([k, id]) => [`t-${k}`, { id, email: `${k}@example.test` }])
);
const tok = (k) => `t-${k}`;

// 회사
const CO = {
  hq: 'c0000000-0000-4000-8000-000000000001',
  expert: 'c0000000-0000-4000-8000-000000000002',
  agent: 'c0000000-0000-4000-8000-000000000003',
  susp: 'c0000000-0000-4000-8000-000000000004',
};

const T0 = '2026-10-01T00:00:00.000Z';
const at = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();

// 가짜 개인정보 — company_events · 로그에 나오면 안 된다
const PII = {
  representative_name: '홍길동',
  contact_phone: '010-1234-5678',
  business_number: '123-45-67890',
};

function seed() {
  return {
    profiles: Object.entries(U).map(([k, id]) => ({
      id,
      name: `이름-${k}`,
      email: `${k}@example.test`,
      tier: 'standard',
    })),
    companies: [
      {
        id: CO.hq,
        kind: 'hq',
        name: '본사',
        plan: null,
        next_plan: null,
        status: 'active',
        sido: null,
        gugun: null,
        created_at: at(0),
      },
      {
        id: CO.expert,
        kind: 'partner',
        name: '성남가구',
        plan: 'expert',
        next_plan: null,
        status: 'active',
        sido: '경기도',
        gugun: '성남시',
        created_at: at(10),
      },
      {
        id: CO.agent,
        kind: 'partner',
        name: '부산가구',
        plan: 'agent',
        next_plan: null,
        status: 'active',
        sido: '부산광역시',
        gugun: '해운대구',
        created_at: at(20),
      },
      {
        id: CO.susp,
        kind: 'partner',
        name: '멈춘가구',
        plan: 'expert',
        next_plan: null,
        status: 'suspended',
        sido: '서울특별시',
        gugun: '강남구',
        created_at: at(30),
      },
    ],
    company_members: [
      {
        id: 'm0000000-0000-4000-8000-000000000001',
        company_id: CO.hq,
        user_id: U.hq,
        role: 'owner',
        status: 'active',
        created_at: at(1),
      },
      {
        id: 'm0000000-0000-4000-8000-000000000002',
        company_id: CO.expert,
        user_id: U.owner,
        role: 'owner',
        status: 'active',
        created_at: at(11),
      },
      {
        id: 'm0000000-0000-4000-8000-000000000003',
        company_id: CO.expert,
        user_id: U.staff,
        role: 'staff',
        status: 'active',
        created_at: at(12),
      },
      {
        id: 'm0000000-0000-4000-8000-000000000004',
        company_id: CO.expert,
        user_id: U.left,
        role: 'staff',
        status: 'removed',
        created_at: at(13),
      },
      {
        id: 'm0000000-0000-4000-8000-000000000005',
        company_id: CO.expert,
        user_id: U.owner2,
        role: 'owner',
        status: 'active',
        created_at: at(14),
      },
      {
        id: 'm0000000-0000-4000-8000-000000000006',
        company_id: CO.agent,
        user_id: U.agentOwner,
        role: 'owner',
        status: 'active',
        created_at: at(21),
      },
      {
        id: 'm0000000-0000-4000-8000-000000000007',
        company_id: CO.susp,
        user_id: U.suspOwner,
        role: 'owner',
        status: 'active',
        created_at: at(31),
      },
    ],
    partner_applications: [],
    company_invites: [],
    company_events: [],
    subscriptions: [],
  };
}

function jsonRes(body, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 위 단계의 콤마로 나눈다 (괄호 안은 그대로) */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const cmp = (a, b) => {
  const da = Date.parse(a);
  const dbb = Date.parse(b);
  if (
    typeof a === 'string' &&
    typeof b === 'string' &&
    !Number.isNaN(da) &&
    !Number.isNaN(dbb) &&
    /\d{4}-\d{2}-\d{2}T/.test(a)
  )
    return da - dbb;
  return a < b ? -1 : a > b ? 1 : 0;
};

function matches(row, key, expr) {
  const v = row[key];
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  switch (op) {
    case 'eq':
      return v !== null && v !== undefined && String(v) === val;
    case 'neq':
      return v !== null && v !== undefined && String(v) !== val;
    case 'in':
      return val
        .replace(/^\(|\)$/g, '')
        .split(',')
        .includes(String(v));
    case 'is':
      return val === 'null' ? v === null || v === undefined : String(v) === val;
    case 'gt':
      return v !== null && v !== undefined && cmp(v, val) > 0;
    case 'lt':
      return v !== null && v !== undefined && cmp(v, val) < 0;
    default:
      throw new Error(`fakeDb: op ${op}`);
  }
}

const FK_EMBED = { companies: { table: 'companies', fk: 'company_id' } };

function project(tables, table, row, select) {
  if (!select || select === '*') return { ...row };
  const out = {};
  for (const item of splitTop(select)) {
    const m = item.match(/^(?:(\w+):)?(\w+)\((.*)\)$/);
    if (m) {
      const [, alias, name, cols] = m;
      const e = FK_EMBED[name];
      if (!e) throw new Error(`fakeDb: embed ${name} on ${table}`);
      const target = tables[e.table].find((r) => r.id === row[e.fk]);
      out[alias || name] = target ? project(tables, e.table, target, cols) : null;
    } else {
      out[item] = row[item] === undefined ? null : row[item];
    }
  }
  return out;
}

const isOpenApp = (a) =>
  a.status === 'applied' || a.status === 'meeting' || (a.status === 'approved' && !a.used_at);

/** 0011 의 유니크 · FK · CHECK 흉내. 위반이면 { code, status } */
function violation(tables, table, row, self) {
  const others = tables[table].filter((r) => r !== self);
  if (table === 'company_members') {
    if (!tables.profiles.some((p) => p.id === row.user_id)) return { code: '23503', status: 409 };
    if (!tables.companies.some((c) => c.id === row.company_id))
      return { code: '23503', status: 409 };
    if (
      !['owner', 'manager', 'staff'].includes(row.role) ||
      !['active', 'removed'].includes(row.status)
    )
      return { code: '23514', status: 400 };
    if (
      row.status === 'active' &&
      others.some((r) => r.user_id === row.user_id && r.status === 'active')
    )
      return { code: '23505', status: 409 };
  }
  if (table === 'partner_applications') {
    const len = (s, a, b) => typeof s === 'string' && [...s].length >= a && [...s].length <= b;
    const ok =
      ['new', 'upgrade'].includes(row.kind) &&
      row.plan === 'agent' &&
      ['applied', 'meeting', 'approved', 'held', 'withdrawn'].includes(row.status) &&
      (row.kind === 'new' || row.company_id) &&
      (!row.used_at || (row.status === 'approved' && row.company_id)) &&
      len(row.company_name, 1, 100) &&
      len(row.representative_name, 1, 50) &&
      len(row.sido, 1, 20) &&
      len(row.gugun, 1, 40) &&
      len(row.intro, 1, 200) &&
      /^[0-9][0-9-]{7,19}$/.test(row.contact_phone) &&
      /^[0-9]{3}-?[0-9]{2}-?[0-9]{5}$/.test(row.business_number);
    if (!ok) return { code: '23514', status: 400 };
    if (isOpenApp(row) && others.some((r) => r.user_id === row.user_id && isOpenApp(r)))
      return { code: '23505', status: 409 };
  }
  if (table === 'company_invites') {
    if (!['manager', 'staff'].includes(row.role) || !/^[0-9a-f]{64}$/.test(row.token_hash))
      return { code: '23514', status: 400 };
    if (!(Date.parse(row.expires_at) > Date.parse(row.created_at)))
      return { code: '23514', status: 400 };
    if (!row.accepted_by !== !row.accepted_at) return { code: '23514', status: 400 };
    if (others.some((r) => r.token_hash === row.token_hash)) return { code: '23505', status: 409 };
  }
  if (table === 'companies') {
    if (row.kind === 'partner' && !row.plan) return { code: '23514', status: 400 };
    if (
      row.next_plan !== null &&
      row.next_plan !== undefined &&
      (row.kind !== 'partner' ||
        !['expert', 'agent'].includes(row.next_plan) ||
        row.next_plan === row.plan)
    ) {
      return { code: '23514', status: 400 };
    }
  }
  return null;
}

const DEFAULTS = {
  companies: () => ({
    next_plan: null,
    status: 'applied',
    sido: null,
    gugun: null,
    created_by: null,
  }),
  company_members: () => ({ status: 'active' }),
  partner_applications: () => ({
    company_id: null,
    plan: 'agent',
    status: 'applied',
    meeting_at: null,
    decided_by: null,
    decided_at: null,
    used_at: null,
    notified_at: null,
  }),
  company_invites: () => ({
    accepted_by: null,
    accepted_at: null,
    revoked_at: null,
    created_by: null,
  }),
  company_events: () => ({
    payload: {},
    subject_type: null,
    subject_id: null,
    actor_user_id: null,
  }),
};

/**
 * @param {object} [o]
 *   fail: { 'POST company_events': 500, ... } — 그 요청을 실패시킨다
 *   onRequest(call, tables): 요청 전에 표를 바꿀 수 있다 (동시 요청 흉내)
 */
function fakeDb({ fail = {}, onRequest = null, mutate = null } = {}) {
  const tables = seed();
  if (mutate) mutate(tables);
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    const headers = init.headers || {};
    const auth = headers.Authorization || headers.authorization || '';
    if (u.pathname === '/auth/v1/user') {
      calls.push({ kind: 'whoami' });
      const who = TOKENS[auth.replace(/^Bearer\s+/, '')];
      return who ? jsonRes(who) : jsonRes({ message: 'bad jwt' }, 401);
    }
    if (u.pathname === '/rest/v1/rpc/is_admin') {
      calls.push({ kind: 'is_admin', auth });
      const who = TOKENS[auth.replace(/^Bearer\s+/, '')];
      return jsonRes(!!who && who.id === U.admin);
    }
    const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) throw new Error(`unexpected ${method} ${u}`);
    const table = m[1];
    if (!tables[table]) throw new Error(`fakeDb: table ${table}`);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call = {
      kind: 'rest',
      method,
      table,
      query: u.search,
      body,
      auth,
      prefer: headers.Prefer || null,
    };
    calls.push(call);
    if (onRequest) onRequest(call, tables);
    const f = fail[`${method} ${table}`];
    if (f) return jsonRes({ code: 'XX000', message: 'boom' }, f);

    const params = [...u.searchParams.entries()];
    const select = (params.find(([k]) => k === 'select') || [])[1] || null;
    const order = (params.find(([k]) => k === 'order') || [])[1] || null;
    const limit = (params.find(([k]) => k === 'limit') || [])[1] || null;
    const filters = params.filter(([k]) => !['select', 'order', 'limit'].includes(k));
    const pick = () => tables[table].filter((r) => filters.every(([k, v]) => matches(r, k, v)));
    const minimal = /return=minimal/.test(call.prefer || '');
    const out = (rows, status) =>
      minimal
        ? new Response(null, { status: status === 200 ? 204 : status })
        : jsonRes(
            rows.map((r) => project(tables, table, r, select)),
            status
          );

    if (method === 'GET') {
      let rows = pick();
      if (order) {
        const [col, dir] = order.split('.');
        rows = [...rows].sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[col], b[col]));
      }
      if (limit) rows = rows.slice(0, Number(limit));
      return jsonRes(rows.map((r) => project(tables, table, r, select)));
    }
    if (method === 'POST') {
      const list = Array.isArray(body) ? body : [body];
      const made = [];
      for (const b of list) {
        const row = {
          ...(DEFAULTS[table] ? DEFAULTS[table]() : {}),
          id: nodeCrypto.randomUUID(),
          created_at: new Date().toISOString(),
          ...b,
        };
        if (table === 'partner_applications' || table === 'companies')
          row.updated_at = row.created_at;
        const bad = violation(tables, table, row, null);
        if (bad) return jsonRes({ code: bad.code, message: 'violation' }, bad.status);
        made.push(row);
      }
      tables[table].push(...made);
      return out(made, 201);
    }
    if (method === 'PATCH') {
      if (table === 'company_events')
        return jsonRes({ code: '42501', message: 'permission denied' }, 403);
      const rows = pick();
      for (const r of rows) {
        const next = { ...r, ...body };
        const bad = violation(tables, table, next, r);
        if (bad) return jsonRes({ code: bad.code, message: 'violation' }, bad.status);
      }
      for (const r of rows)
        Object.assign(
          r,
          body,
          table === 'partner_applications' ? { updated_at: new Date().toISOString() } : {}
        );
      return out(rows, 200);
    }
    if (method === 'DELETE') {
      if (table === 'company_events')
        return jsonRes({ code: '42501', message: 'permission denied' }, 403);
      const rows = pick();
      tables[table] = tables[table].filter((r) => !rows.includes(r));
      return out(rows, 200);
    }
    throw new Error(`fakeDb: ${method}`);
  };
  const writes = () => calls.filter((c) => c.kind === 'rest' && c.method !== 'GET');
  return { tables, calls, writes, fetchImpl };
}

function req(method, pathname, token, body) {
  const headers = { Origin: 'https://dadamfurniture.com' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return new Request(`https://account.test${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

let db;
async function call(method, pathname, who, body, env = ENV) {
  const res = await W.fetch(req(method, pathname, who ? tok(who) : null, body), env);
  const json = await res.json();
  return { status: res.status, json, headers: res.headers };
}

const realFetch = global.fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
let logs;
beforeEach(() => {
  logs = [];
  for (const k of Object.keys(realConsole))
    console[k] = (...a) => logs.push(a.map(String).join(' '));
  db = fakeDb();
  global.fetch = db.fetchImpl;
});
afterEach(() => {
  global.fetch = realFetch;
  Object.assign(console, realConsole);
});

const use = (o) => {
  db = fakeDb(o);
  global.fetch = db.fetchImpl;
  return db;
};

const APP_KEYS = [
  'id',
  'kind',
  'status',
  'company_name',
  'sido',
  'gugun',
  'meeting_at',
  'decided_at',
  'used_at',
  'created_at',
];
const COMPANY_KEYS = [
  'id',
  'name',
  'plan',
  'next_plan',
  'status',
  'sido',
  'gugun',
  'role',
  'created_at',
];
const MEMBER_KEYS = ['user_id', 'name', 'email', 'role', 'status', 'joined_at'];
const INVITE_KEYS = ['id', 'role', 'created_at', 'expires_at', 'accepted_at', 'revoked_at'];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const APPLY_BODY = () => ({
  company_name: '  새가구  ',
  representative_name: ' 홍길동 ',
  contact_phone: ' 010-1234-5678 ',
  sido: '경기도',
  gugun: '수원시',
  business_number: '123-45-67890',
  intro: ' 주방 가구 시공 ',
});

function addApp(tables, row) {
  const full = {
    id: nodeCrypto.randomUUID(),
    company_id: null,
    kind: 'new',
    plan: 'agent',
    status: 'applied',
    company_name: '새가구',
    representative_name: PII.representative_name,
    contact_phone: PII.contact_phone,
    sido: '경기도',
    gugun: '수원시',
    business_number: PII.business_number,
    intro: '주방 가구',
    meeting_at: null,
    decided_by: null,
    decided_at: null,
    used_at: null,
    notified_at: null,
    created_at: at(100),
    updated_at: at(100),
    ...row,
  };
  tables.partner_applications.push(full);
  return full;
}

function addInvite(tables, token, row = {}) {
  const hash = nodeCrypto.createHash('sha256').update(token).digest('hex');
  const full = {
    id: nodeCrypto.randomUUID(),
    company_id: CO.expert,
    role: 'staff',
    token_hash: hash,
    created_by: U.owner,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    accepted_by: null,
    accepted_at: null,
    revoked_at: null,
    ...row,
  };
  tables.company_invites.push(full);
  return full;
}

const TOKEN = 'A'.repeat(42) + 'w'; // 43자 base64url 모양

// ── 1) 공통 ────────────────────────────────────────────

describe('공통 — 응답 모양 · 확인', () => {
  test('로그인 안 했으면 401 unauthorized — DB 를 보지 않는다, no-store', async () => {
    const r = await call('GET', '/partner/me', null);
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ success: false, code: 'unauthorized', error: '로그인이 필요합니다' });
    expect(r.headers.get('Cache-Control')).toBe('no-store, private');
    expect(db.calls.filter((c) => c.kind === 'rest')).toEqual([]);

    const bad = await W.fetch(req('GET', '/partner/me', 'expired-token'), ENV);
    expect(bad.status).toBe(401);
    expect((await bad.json()).code).toBe('unauthorized');
  });

  test('관리자 길은 is_admin(사용자 토큰)으로 — 관리자 아니면 403 not_admin, 아무것도 건드리지 않는다', async () => {
    for (const [m, p, b] of [
      ['GET', '/admin/partner/applications'],
      ['GET', '/admin/partner/companies'],
      [
        'POST',
        '/admin/partner/companies',
        { user_id: U.newbie, name: 'x', plan: 'expert', sido: '경기도', gugun: '수원시' },
      ],
      ['POST', `/admin/partner/applications/${U.newbie}`, { action: 'approve' }],
    ]) {
      const r = await call(m, p, 'owner', b);
      expect(r.status).toBe(403);
      expect(r.json).toEqual({
        success: false,
        code: 'not_admin',
        error: '관리자만 사용할 수 있습니다',
      });
      expect(r.headers.get('Cache-Control')).toBe('no-store, private');
    }
    expect(
      db.calls
        .filter((c) => c.kind === 'is_admin')
        .every((c) => c.auth === `Bearer ${tok('owner')}`)
    ).toBe(true);
    expect(db.calls.filter((c) => c.kind === 'rest')).toEqual([]);
  });

  test('service_role 키가 없으면 503 not_configured (로그인 확인 뒤)', async () => {
    const r = await call('GET', '/partner/me', 'owner', undefined, {
      ...ENV,
      SUPABASE_SERVICE_ROLE_KEY: '',
    });
    expect(r.status).toBe(503);
    expect(r.json.code).toBe('not_configured');
  });

  test('길 찾기 — 정해진 길만, 경로의 id 를 꺼낸다. 모르는 길은 그대로 404', async () => {
    expect(Pt.matchPartnerRoute('POST', `/partner/invites/${CO.expert}/revoke`).params).toEqual({
      id: CO.expert,
    });
    expect(Pt.matchPartnerRoute('POST', `/partner/members/${U.staff}/remove`).params).toEqual({
      user_id: U.staff,
    });
    expect(Pt.matchPartnerRoute('POST', '/partner/invites/peek').params).toEqual({});
    expect(Pt.matchPartnerRoute('GET', '/partner/apply')).toBeNull();
    expect(Pt.matchPartnerRoute('POST', '/partner/me')).toBeNull();
    expect(Pt.matchPartnerRoute('POST', '/partner/invites//revoke')).toBeNull();
    const r = await W.fetch(req('GET', '/partner/nothing', tok('owner')), ENV);
    expect(r.status).toBe(404);
  });

  test('DB 오류는 500 server_error — 응답 · 로그에 DB 본문이 없다', async () => {
    use({ fail: { 'GET company_members': 500 } });
    const r = await call('GET', '/partner/me', 'owner');
    expect(r.status).toBe(500);
    expect(r.json).toEqual({
      success: false,
      code: 'server_error',
      error: '처리 중 오류가 발생했습니다.',
    });
    expect(logs.join('\n')).not.toMatch(/boom/);
  });

  test('경로 id 가 uuid 가 아니면 422 invalid + field — DB 에 쓰지 않는다', async () => {
    for (const [p, field, who] of [
      ['/partner/invites/not-a-uuid/revoke', 'id', 'owner'],
      ['/partner/members/1%27%20or%201=1/remove', 'user_id', 'owner'],
      ['/admin/partner/applications/abc', 'id', 'admin'],
    ]) {
      const r = await call('POST', p, who, { action: 'approve' });
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ success: false, code: 'invalid', field });
    }
    expect(db.writes()).toEqual([]);
  });
});

// ── 2) GET /partner/me ─────────────────────────────────

describe('GET /partner/me', () => {
  test('아무 데도 없는 사람 — company · application null, 목록 빈 칸, hq_member 없음', async () => {
    const r = await call('GET', '/partner/me', 'newbie');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      success: true,
      data: { company: null, application: null, members: [], invites: [] },
    });
  });

  test('대표 — 업체(내 역할) · 직원 목록(나간 사람 포함, 이름 · 이메일은 profiles) · 초대(토큰 해시 없음)', async () => {
    addInvite(db.tables, TOKEN);
    const r = await call('GET', '/partner/me', 'owner');
    const d = r.json.data;
    expect(Object.keys(d)).toEqual(['company', 'application', 'members', 'invites']);
    expect(Object.keys(d.company)).toEqual(COMPANY_KEYS);
    expect(d.company).toMatchObject({
      id: CO.expert,
      name: '성남가구',
      plan: 'expert',
      next_plan: null,
      status: 'active',
      sido: '경기도',
      gugun: '성남시',
      role: 'owner',
    });
    expect(d.company.created_at).toMatch(ISO_RE);
    expect(d.members.map((x) => [x.user_id, x.role, x.status])).toEqual([
      [U.owner, 'owner', 'active'],
      [U.staff, 'staff', 'active'],
      [U.left, 'staff', 'removed'],
      [U.owner2, 'owner', 'active'],
    ]);
    for (const x of d.members) {
      expect(Object.keys(x)).toEqual(MEMBER_KEYS);
      expect(x.joined_at).toMatch(ISO_RE);
    }
    expect(d.members[1]).toMatchObject({ name: '이름-staff', email: 'staff@example.test' });
    expect(d.invites).toHaveLength(1);
    expect(Object.keys(d.invites[0])).toEqual(INVITE_KEYS);
    expect(JSON.stringify(d)).not.toMatch(/token_hash|[0-9a-f]{64}/);
    expect(d.hq_member).toBeUndefined();
  });

  test('직원 · 실장 — 업체와 내 역할만, 직원 목록 · 초대는 빈 칸', async () => {
    const r = await call('GET', '/partner/me', 'staff');
    expect(r.json.data.company).toMatchObject({ id: CO.expert, role: 'staff' });
    expect(r.json.data.members).toEqual([]);
    expect(r.json.data.invites).toEqual([]);
    expect(db.calls.some((c) => c.table === 'company_invites')).toBe(false);
  });

  test('본사 구성원 — company null + hq_member true', async () => {
    const r = await call('GET', '/partner/me', 'hq');
    expect(r.json.data).toEqual({
      company: null,
      application: null,
      members: [],
      invites: [],
      hq_member: true,
    });
  });

  test('신청은 가장 최근 하나 (아무 상태) — 회원 칸만, 연락처 · 사업자번호 없음', async () => {
    addApp(db.tables, { user_id: U.newbie, status: 'held', created_at: at(100) });
    const last = addApp(db.tables, {
      user_id: U.newbie,
      status: 'meeting',
      meeting_at: '2026-11-02T05:00:00+00:00',
      created_at: at(200),
    });
    const r = await call('GET', '/partner/me', 'newbie');
    expect(Object.keys(r.json.data.application)).toEqual(APP_KEYS);
    expect(r.json.data.application).toMatchObject({
      id: last.id,
      status: 'meeting',
      meeting_at: '2026-11-02T05:00:00.000Z',
    });
    expect(JSON.stringify(r.json)).not.toContain(PII.contact_phone);
  });
});

// ── 3) 신청 ────────────────────────────────────────────

describe('POST /partner/apply', () => {
  test('새 업체 — 201, kind new, 앞뒤 공백을 자르고 저장. 이력은 없다 (업체가 아직 없다)', async () => {
    const r = await call('POST', '/partner/apply', 'newbie', APPLY_BODY());
    expect(r.status).toBe(201);
    expect(Object.keys(r.json.data.application)).toEqual(APP_KEYS);
    expect(r.json.data.application).toMatchObject({
      kind: 'new',
      status: 'applied',
      company_name: '새가구',
      sido: '경기도',
      gugun: '수원시',
      used_at: null,
    });
    expect(r.json.data.application.created_at).toMatch(ISO_RE);
    const row = db.tables.partner_applications[0];
    expect(row).toMatchObject({
      user_id: U.newbie,
      company_id: null,
      kind: 'new',
      company_name: '새가구',
      representative_name: '홍길동',
      contact_phone: '010-1234-5678',
      business_number: '123-45-67890',
      intro: '주방 가구 시공',
    });
    expect(db.tables.company_events).toEqual([]);
  });

  test('Expert 업체 대표 — kind upgrade, 업체 이름 · 지역은 업체 값(보낸 값은 무시), 이력 agent_applied (개인정보 없음)', async () => {
    const r = await call('POST', '/partner/apply', 'owner', {
      ...APPLY_BODY(),
      company_name: '딴이름',
      sido: '제주특별자치도',
      gugun: '',
    });
    expect(r.status).toBe(201);
    expect(r.json.data.application).toMatchObject({
      kind: 'upgrade',
      company_name: '성남가구',
      sido: '경기도',
      gugun: '성남시',
    });
    expect(db.tables.partner_applications[0].company_id).toBe(CO.expert);
    expect(db.tables.company_events).toHaveLength(1);
    expect(db.tables.company_events[0]).toMatchObject({
      company_id: CO.expert,
      actor_user_id: U.owner,
      actor_kind: 'member',
      type: 'agent_applied',
      payload: {},
    });
    const ev = JSON.stringify(db.tables.company_events);
    for (const v of [...Object.values(PII), '홍길동', '주방 가구']) expect(ev).not.toContain(v);
  });

  test('본사 구성원 409 hq_member · 협력업체의 다른 구성원 409 already_member — 저장하지 않는다', async () => {
    expect((await call('POST', '/partner/apply', 'hq', APPLY_BODY())).json).toMatchObject({
      code: 'hq_member',
    });
    for (const who of ['staff', 'agentOwner', 'suspOwner']) {
      const r = await call('POST', '/partner/apply', who, APPLY_BODY());
      expect(r.status).toBe(409);
      expect(r.json).toMatchObject({ success: false, code: 'already_member' });
    }
    expect(db.tables.partner_applications).toEqual([]);
  });

  test('열린 신청(applied · meeting · 안 쓴 approved)이 있으면 409 application_open. 보류 · 거둔 · 쓴 신청 뒤에는 다시 신청한다', async () => {
    for (const status of ['applied', 'meeting', 'approved']) {
      const d = use();
      addApp(d.tables, { user_id: U.newbie, status });
      const r = await call('POST', '/partner/apply', 'newbie', APPLY_BODY());
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('application_open');
    }
    for (const row of [{ status: 'held' }, { status: 'withdrawn' }]) {
      const d = use();
      addApp(d.tables, { user_id: U.newbie, ...row });
      expect((await call('POST', '/partner/apply', 'newbie', APPLY_BODY())).status).toBe(201);
    }
  });

  test('동시에 두 번 — DB 유니크(23505)도 409 application_open', async () => {
    use({
      onRequest: (c, t) => {
        if (c.method === 'POST' && c.table === 'partner_applications')
          addApp(t, { user_id: U.newbie });
      },
    });
    const r = await call('POST', '/partner/apply', 'newbie', APPLY_BODY());
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('application_open');
  });

  test('형식이 틀리면 422 invalid + field — 칸마다', async () => {
    const cases = [
      ['company_name', ''],
      ['company_name', '가'.repeat(101)],
      ['representative_name', '   '],
      ['representative_name', '가'.repeat(51)],
      ['contact_phone', '010 1234 5678'],
      ['contact_phone', '전화010-1234'],
      ['contact_phone', '-0101234567'],
      ['contact_phone', '0101234'],
      ['sido', ''],
      ['sido', '가'.repeat(21)],
      ['gugun', '가'.repeat(41)],
      ['business_number', '12-345-67890'],
      ['business_number', '123456789'],
      ['business_number', '123 45 67890'],
      ['intro', ''],
      ['intro', '가'.repeat(201)],
      ['intro', 7],
    ];
    for (const [field, value] of cases) {
      const r = await call('POST', '/partner/apply', 'newbie', { ...APPLY_BODY(), [field]: value });
      expect(`${field}=${JSON.stringify(value)} ${r.status}`).toBe(
        `${field}=${JSON.stringify(value)} 422`
      );
      expect(r.json).toMatchObject({ success: false, code: 'invalid', field });
      expect(typeof r.json.error).toBe('string');
    }
    const empty = await call('POST', '/partner/apply', 'newbie', 'not json');
    expect(empty.json).toMatchObject({ code: 'invalid', field: 'company_name' });
    expect(db.writes()).toEqual([]);
  });

  test('경계 값은 받는다 — 100 · 50 · 20 · 40 · 200자(코드 포인트), 하이픈 없는 번호 — DB CHECK 와 같다', async () => {
    const r = await call('POST', '/partner/apply', 'newbie', {
      company_name: '가'.repeat(100),
      representative_name: '😀'.repeat(50),
      contact_phone: '01012345678',
      sido: '가'.repeat(20),
      gugun: '가'.repeat(40),
      business_number: '1234567890',
      intro: '가'.repeat(200),
    });
    expect(r.status).toBe(201);
    expect(Pt.PHONE_RE.source).toBe('^[0-9][0-9-]{7,19}$');
    expect(Pt.BIZNO_RE.source).toBe('^[0-9]{3}-?[0-9]{2}-?[0-9]{5}$');
    if (MIGRATION_0011) {
      expect(MIGRATION_0011).toContain(`contact_phone ~ '${Pt.PHONE_RE.source}'`);
      expect(MIGRATION_0011).toContain(`business_number ~ '${Pt.BIZNO_RE.source}'`);
    }
  });

  test('Expert 대표의 upgrade 는 업체 칸(이름 · 지역)을 검사하지 않는다 — 대표자 · 연락처 · 번호 · 소개만', async () => {
    const r = await call('POST', '/partner/apply', 'owner', {
      ...APPLY_BODY(),
      company_name: undefined,
      sido: undefined,
      gugun: undefined,
    });
    expect(r.status).toBe(201);
    const bad = await call('POST', '/partner/apply', 'owner2', {
      ...APPLY_BODY(),
      contact_phone: 'abc',
    });
    expect(bad.status).toBe(422);
    expect(bad.json).toMatchObject({ code: 'invalid', field: 'contact_phone' });
  });
});

describe('POST /partner/apply/withdraw', () => {
  test('열린 신청(applied · meeting)을 withdrawn 으로 — 회원 칸', async () => {
    const a = addApp(db.tables, { user_id: U.newbie, status: 'meeting' });
    const r = await call('POST', '/partner/apply/withdraw', 'newbie');
    expect(r.status).toBe(200);
    expect(r.json.data.application).toMatchObject({ id: a.id, status: 'withdrawn' });
    expect(Object.keys(r.json.data.application)).toEqual(APP_KEYS);
    expect(a.status).toBe('withdrawn');
  });

  test('없으면 404 not_found — 승인 · 보류된 신청은 거두지 않는다, 남의 신청도', async () => {
    addApp(db.tables, { user_id: U.newbie, status: 'approved' });
    addApp(db.tables, { user_id: U.staff, status: 'applied' });
    const r = await call('POST', '/partner/apply/withdraw', 'newbie');
    expect(r.status).toBe(404);
    expect(r.json).toMatchObject({ success: false, code: 'not_found' });
    expect(db.tables.partner_applications.map((x) => x.status)).toEqual(['approved', 'applied']);
  });
});

// ── 4) 등급 예약 ───────────────────────────────────────

describe('POST /partner/plan', () => {
  test('Agent 업체 대표가 expert 예약 → next_plan expert, 이력 plan_change_requested {next_plan}', async () => {
    const r = await call('POST', '/partner/plan', 'agentOwner', { next_plan: 'expert' });
    expect(r.status).toBe(200);
    expect(r.json.data.company).toMatchObject({
      id: CO.agent,
      plan: 'agent',
      next_plan: 'expert',
      role: 'owner',
    });
    expect(Object.keys(r.json.data.company)).toEqual(COMPANY_KEYS);
    expect(db.tables.companies.find((c) => c.id === CO.agent).next_plan).toBe('expert');
    expect(db.tables.company_events).toEqual([
      expect.objectContaining({
        company_id: CO.agent,
        actor_user_id: U.agentOwner,
        actor_kind: 'member',
        type: 'plan_change_requested',
        payload: { next_plan: 'expert' },
      }),
    ]);
  });

  test('null 은 예약 취소 — 승인된 upgrade 예약(next_plan agent)도 지운다', async () => {
    db.tables.companies.find((c) => c.id === CO.expert).next_plan = 'agent';
    const r = await call('POST', '/partner/plan', 'owner', { next_plan: null });
    expect(r.status).toBe(200);
    expect(r.json.data.company.next_plan).toBeNull();
    expect(db.tables.companies.find((c) => c.id === CO.expert).next_plan).toBeNull();
    expect(db.tables.company_events[0].payload).toEqual({ next_plan: null });
  });

  test('Expert 업체가 expert 예약 409 invalid_plan_change · 대표 아님 403 not_owner · 정지 409 company_inactive · 값 틀림 422', async () => {
    expect((await call('POST', '/partner/plan', 'owner', { next_plan: 'expert' })).json.code).toBe(
      'invalid_plan_change'
    );
    for (const who of ['staff', 'hq', 'newbie']) {
      const r = await call('POST', '/partner/plan', who, { next_plan: null });
      expect(r.status).toBe(403);
      expect(r.json.code).toBe('not_owner');
    }
    expect((await call('POST', '/partner/plan', 'suspOwner', { next_plan: null })).json.code).toBe(
      'company_inactive'
    );
    for (const b of [{}, { next_plan: 'agent' }, { next_plan: 'standard' }, { next_plan: '' }]) {
      const r = await call('POST', '/partner/plan', 'agentOwner', b);
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code: 'invalid', field: 'next_plan' });
    }
    expect(db.writes()).toEqual([]);
  });
});

// ── 5) 직원 초대 ───────────────────────────────────────

describe('직원 초대', () => {
  test('만들기 — 201 {id, role, expires_at, token}. 토큰은 43자 base64url, DB 에는 sha256 hex 만, 7일', async () => {
    const before = Date.now();
    const r = await call('POST', '/partner/invites', 'owner', { role: 'manager' });
    expect(r.status).toBe(201);
    expect(Object.keys(r.json.data)).toEqual(['id', 'role', 'expires_at', 'token']);
    expect(r.json.data.role).toBe('manager');
    expect(r.json.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = db.tables.company_invites[0];
    expect(row.token_hash).toBe(
      nodeCrypto.createHash('sha256').update(r.json.data.token).digest('hex')
    );
    expect(JSON.stringify(row)).not.toContain(r.json.data.token);
    expect(row).toMatchObject({ company_id: CO.expert, role: 'manager', created_by: U.owner });
    const exp = Date.parse(r.json.data.expires_at);
    expect(exp - before).toBeGreaterThanOrEqual(Pt.INVITE_TTL_MS - 1000);
    expect(exp - Date.now()).toBeLessThanOrEqual(Pt.INVITE_TTL_MS);
    expect(Pt.INVITE_TTL_MS).toBe(7 * 24 * 3600 * 1000);
    // 다시 읽어도 토큰은 없다
    const me = await call('GET', '/partner/me', 'owner');
    expect(JSON.stringify(me.json)).not.toContain(r.json.data.token);
  });

  test('토큰 만들기 · 해시 — 매번 다르고, 해시는 sha256 hex 64자', async () => {
    const a = Pt.newInviteToken();
    expect(a).not.toBe(Pt.newInviteToken());
    expect(await Pt.hashInviteToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  test('대표만 · 업체 active 만 · 역할은 manager | staff', async () => {
    expect((await call('POST', '/partner/invites', 'staff', { role: 'staff' })).json.code).toBe(
      'not_owner'
    );
    expect((await call('POST', '/partner/invites', 'hq', { role: 'staff' })).json.code).toBe(
      'not_owner'
    );
    expect((await call('POST', '/partner/invites', 'suspOwner', { role: 'staff' })).json.code).toBe(
      'company_inactive'
    );
    for (const role of ['owner', '', undefined, 'STAFF']) {
      const r = await call('POST', '/partner/invites', 'owner', { role });
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code: 'invalid', field: 'role' });
    }
    expect(db.tables.company_invites).toEqual([]);
  });

  test('미리 보기 — 업체 이름 · 역할 · 만료. 쓸 수 없으면 410', async () => {
    const inv = addInvite(db.tables, TOKEN, { role: 'manager' });
    const r = await call('POST', '/partner/invites/peek', 'newbie', { token: TOKEN });
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual({
      company_name: '성남가구',
      role: 'manager',
      expires_at: new Date(inv.expires_at).toISOString(),
    });
    expect(db.writes()).toEqual([]);
    const gone = await call('POST', '/partner/invites/peek', 'newbie', { token: 'B'.repeat(43) });
    expect(gone.status).toBe(410);
    expect(gone.json).toMatchObject({ success: false, code: 'invite_invalid' });
  });

  test('수락 — 구성원(초대 역할, active) → 초대 accepted_by/at → 이력 member_joined. 200 {company:{id,name,plan}, role}', async () => {
    const inv = addInvite(db.tables, TOKEN, { role: 'manager' });
    const r = await call('POST', '/partner/invites/accept', 'newbie', { token: TOKEN });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      success: true,
      data: { company: { id: CO.expert, name: '성남가구', plan: 'expert' }, role: 'manager' },
    });
    const mem = db.tables.company_members.find((m) => m.user_id === U.newbie);
    expect(mem).toMatchObject({ company_id: CO.expert, role: 'manager', status: 'active' });
    expect(inv.accepted_by).toBe(U.newbie);
    expect(inv.accepted_at).toMatch(ISO_RE);
    expect(db.tables.company_events).toEqual([
      expect.objectContaining({
        company_id: CO.expert,
        actor_user_id: U.newbie,
        actor_kind: 'member',
        type: 'member_joined',
        subject_type: 'member',
        subject_id: mem.id,
      }),
    ]);
    // 순서: 구성원 → 초대 → 이력
    const w = db.writes().map((c) => `${c.method} ${c.table}`);
    expect(w).toEqual(['POST company_members', 'PATCH company_invites', 'POST company_events']);
    // 두 번째는 410
    use();
    const again = await call('POST', '/partner/invites/accept', 'staff', { token: TOKEN });
    expect(again.status).toBe(410);
  });

  test('없음 · 만료 · 취소 · 이미 수락 · 모양 틀림 → 410 invite_invalid, 아무것도 쓰지 않는다', async () => {
    const cases = [
      [null, TOKEN],
      [{ expires_at: new Date(Date.now() - 1000).toISOString() }, TOKEN],
      [{ revoked_at: at(500) }, TOKEN],
      [{ accepted_by: U.staff, accepted_at: at(500) }, TOKEN],
      [{}, 'short'],
      [{}, `${TOKEN}=`],
      [{}, 12345],
    ];
    for (const [row, token] of cases) {
      const d = use();
      if (row) addInvite(d.tables, TOKEN, row);
      const r = await call('POST', '/partner/invites/accept', 'newbie', { token });
      expect(r.status).toBe(410);
      expect(r.json.code).toBe('invite_invalid');
      expect(d.writes()).toEqual([]);
    }
  });

  test('업체가 active 아님 409 company_inactive · 이미 구성원(본사 포함) 409 already_member · 열린 신청 409 application_open', async () => {
    let d = use();
    addInvite(d.tables, TOKEN, { company_id: CO.susp });
    expect(
      (await call('POST', '/partner/invites/accept', 'newbie', { token: TOKEN })).json.code
    ).toBe('company_inactive');
    for (const who of ['hq', 'staff', 'agentOwner']) {
      d = use();
      addInvite(d.tables, TOKEN);
      const r = await call('POST', '/partner/invites/accept', who, { token: TOKEN });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('already_member');
      expect(d.writes()).toEqual([]);
    }
    d = use();
    addInvite(d.tables, TOKEN);
    addApp(d.tables, { user_id: U.newbie, status: 'approved' });
    expect(
      (await call('POST', '/partner/invites/accept', 'newbie', { token: TOKEN })).json.code
    ).toBe('application_open');
    expect(d.writes()).toEqual([]);
  });

  test('동시 수락 — 구성원 유니크 충돌은 409 already_member, 초대를 남이 먼저 쓰면 넣은 구성원을 빼고 410', async () => {
    let d = use({
      onRequest: (c, t) => {
        if (c.method === 'POST' && c.table === 'company_members') {
          t.company_members.push({
            id: nodeCrypto.randomUUID(),
            company_id: CO.agent,
            user_id: U.newbie,
            role: 'staff',
            status: 'active',
            created_at: at(900),
          });
        }
      },
    });
    addInvite(d.tables, TOKEN);
    let r = await call('POST', '/partner/invites/accept', 'newbie', { token: TOKEN });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('already_member');

    d = use({
      onRequest: (c, t) => {
        if (c.method === 'PATCH' && c.table === 'company_invites') {
          Object.assign(t.company_invites[0], { accepted_by: U.left, accepted_at: at(900) });
        }
      },
    });
    addInvite(d.tables, TOKEN);
    r = await call('POST', '/partner/invites/accept', 'newbie', { token: TOKEN });
    expect(r.status).toBe(410);
    expect(r.json.code).toBe('invite_invalid');
    expect(d.tables.company_members.some((m) => m.user_id === U.newbie)).toBe(false);
    expect(d.tables.company_events).toEqual([]);
  });

  test('거두기 — 대표가 자기 업체 초대를 revoked_at. 남의 업체 초대 404, 이미 거둔 것은 그대로', async () => {
    const inv = addInvite(db.tables, TOKEN);
    const other = addInvite(db.tables, 'C'.repeat(43), {
      company_id: CO.agent,
      created_by: U.agentOwner,
    });
    const r = await call('POST', `/partner/invites/${inv.id}/revoke`, 'owner');
    expect(r.status).toBe(200);
    expect(Object.keys(r.json.data.invite)).toEqual(INVITE_KEYS);
    expect(r.json.data.invite.revoked_at).toMatch(ISO_RE);
    const first = inv.revoked_at;
    const again = await call('POST', `/partner/invites/${inv.id}/revoke`, 'owner');
    expect(again.status).toBe(200);
    expect(inv.revoked_at).toBe(first);
    const notMine = await call('POST', `/partner/invites/${other.id}/revoke`, 'owner');
    expect(notMine.status).toBe(404);
    expect(notMine.json.code).toBe('not_found');
    expect(other.revoked_at).toBeNull();
    expect((await call('POST', `/partner/invites/${inv.id}/revoke`, 'staff')).json.code).toBe(
      'not_owner'
    );
  });
});

// ── 내보내기 ───────────────────────────────────────────

describe('POST /partner/members/:user_id/remove', () => {
  test('대표가 직원을 내보낸다 — status removed, 이력 member_removed (subject member)', async () => {
    const r = await call('POST', `/partner/members/${U.staff}/remove`, 'owner');
    expect(r.status).toBe(200);
    expect(r.json.data.member).toEqual({
      user_id: U.staff,
      name: '이름-staff',
      email: 'staff@example.test',
      role: 'staff',
      status: 'removed',
      joined_at: at(12),
    });
    const row = db.tables.company_members.find((m) => m.user_id === U.staff);
    expect(row.status).toBe('removed');
    expect(db.tables.company_events).toEqual([
      expect.objectContaining({
        company_id: CO.expert,
        actor_user_id: U.owner,
        actor_kind: 'member',
        type: 'member_removed',
        subject_type: 'member',
        subject_id: row.id,
      }),
    ]);
  });

  test('자기 자신 · 다른 대표 409 cannot_remove · 다른 업체 사람 · 나간 사람 404 · 대표 아님 403', async () => {
    expect((await call('POST', `/partner/members/${U.owner}/remove`, 'owner')).json.code).toBe(
      'cannot_remove'
    );
    expect(
      (await call('POST', `/partner/members/${U.owner.toUpperCase()}/remove`, 'owner')).json.code
    ).toBe('cannot_remove');
    expect((await call('POST', `/partner/members/${U.owner2}/remove`, 'owner')).json.code).toBe(
      'cannot_remove'
    );
    expect((await call('POST', `/partner/members/${U.agentOwner}/remove`, 'owner')).status).toBe(
      404
    );
    expect((await call('POST', `/partner/members/${U.left}/remove`, 'owner')).status).toBe(404);
    expect((await call('POST', `/partner/members/${U.owner}/remove`, 'staff')).json.code).toBe(
      'not_owner'
    );
    expect(db.writes()).toEqual([]);
  });
});

// ── 6) 관리자 ──────────────────────────────────────────

describe('관리자 — 신청', () => {
  test('목록 — 최근 순, 신청 전체 칸 + 신청자 이메일. status 로 거른다, 없으면 전부', async () => {
    addApp(db.tables, { user_id: U.newbie, status: 'held', created_at: at(100) });
    addApp(db.tables, { user_id: U.newbie, status: 'applied', created_at: at(300) });
    addApp(db.tables, {
      user_id: U.owner,
      kind: 'upgrade',
      company_id: CO.expert,
      status: 'meeting',
      created_at: at(200),
      meeting_at: at(5000),
    });
    const r = await call('GET', '/admin/partner/applications?status=applied,meeting', 'admin');
    expect(r.status).toBe(200);
    expect(r.json.data.map((x) => [x.status, x.email])).toEqual([
      ['applied', 'newbie@example.test'],
      ['meeting', 'owner@example.test'],
    ]);
    expect(r.json.data[0]).toMatchObject({
      representative_name: PII.representative_name,
      contact_phone: PII.contact_phone,
      business_number: PII.business_number,
      intro: '주방 가구',
    });
    expect(Object.keys(r.json.data[0])).toEqual(
      expect.arrayContaining([
        'user_id',
        'company_id',
        'plan',
        'decided_by',
        'notified_at',
        'updated_at',
        'email',
      ])
    );
    expect(r.json.data[1].meeting_at).toBe(at(5000));
    expect((await call('GET', '/admin/partner/applications', 'admin')).json.data).toHaveLength(3);
    expect(
      (await call('GET', '/admin/partner/applications?status=', 'admin')).json.data
    ).toHaveLength(3);
    const bad = await call(
      'GET',
      '/admin/partner/applications?status=applied,approved),or=(x',
      'admin'
    );
    expect(bad.status).toBe(422);
    expect(bad.json).toMatchObject({ code: 'invalid', field: 'status' });
  });

  test('미팅 잡기 — applied | meeting → meeting, meeting_at 은 ISO 로', async () => {
    const a = addApp(db.tables, { user_id: U.newbie });
    let r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'meeting',
      meeting_at: '2026-11-03T10:30:00+09:00',
    });
    expect(r.status).toBe(200);
    expect(r.json.data.application).toMatchObject({
      id: a.id,
      status: 'meeting',
      meeting_at: '2026-11-03T01:30:00.000Z',
    });
    r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'meeting',
      meeting_at: '2026-11-04T01:00:00.000Z',
    });
    expect(r.json.data.application.meeting_at).toBe('2026-11-04T01:00:00.000Z');
    for (const meeting_at of [undefined, '', '내일', '2026-11-04', '2026-13-40T99:99']) {
      const bad = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
        action: 'meeting',
        meeting_at,
      });
      expect(bad.status).toBe(422);
      expect(bad.json).toMatchObject({ code: 'invalid', field: 'meeting_at' });
    }
  });

  test('승인(새 업체) — approved, decided_by/at. 업체는 건드리지 않는다 (결제 때 만든다)', async () => {
    const a = addApp(db.tables, { user_id: U.newbie, status: 'meeting' });
    const r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'approve',
    });
    expect(r.status).toBe(200);
    expect(r.json.data.application).toMatchObject({
      status: 'approved',
      decided_by: U.admin,
      used_at: null,
    });
    expect(r.json.data.application.decided_at).toMatch(ISO_RE);
    expect(db.writes().map((c) => `${c.method} ${c.table}`)).toEqual([
      'PATCH partner_applications',
    ]);
  });

  test('승인(upgrade) — 업체 next_plan agent (plan 은 그대로), 신청 used_at, 이력 agent_approved (actor admin)', async () => {
    const a = addApp(db.tables, {
      user_id: U.owner,
      kind: 'upgrade',
      company_id: CO.expert,
      company_name: '성남가구',
    });
    const r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'approve',
    });
    expect(r.status).toBe(200);
    expect(r.json.data.application).toMatchObject({ status: 'approved', decided_by: U.admin });
    expect(r.json.data.application.used_at).toMatch(ISO_RE);
    const co = db.tables.companies.find((c) => c.id === CO.expert);
    expect(co).toMatchObject({ plan: 'expert', next_plan: 'agent' });
    expect(db.tables.company_events).toEqual([
      expect.objectContaining({
        company_id: CO.expert,
        actor_user_id: U.admin,
        actor_kind: 'admin',
        type: 'agent_approved',
        payload: {},
      }),
    ]);
    // 승인되어 쓴 신청은 열린 신청이 아니다 — 대표는 다시 신청할 수 있는 상태
    expect(db.tables.partner_applications[0].used_at).toBeTruthy();
  });

  test('승인(upgrade) — 업체가 active 아님 409 company_inactive · 이미 Agent 409 invalid_plan_change, 아무것도 바꾸지 않는다', async () => {
    let d = use();
    let a = addApp(d.tables, { user_id: U.suspOwner, kind: 'upgrade', company_id: CO.susp });
    let r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'approve',
    });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('company_inactive');
    expect(d.writes()).toEqual([]);
    d = use();
    a = addApp(d.tables, { user_id: U.agentOwner, kind: 'upgrade', company_id: CO.agent });
    r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', { action: 'approve' });
    expect(r.json.code).toBe('invalid_plan_change');
    expect(d.writes()).toEqual([]);
    expect(a.status).toBe('applied');
  });

  test('승인(upgrade) 도중 신청이 바뀌면 409 invalid_transition — 업체 예약을 되돌린다', async () => {
    const d = use({
      onRequest: (c, t) => {
        if (c.method === 'PATCH' && c.table === 'partner_applications')
          t.partner_applications[0].status = 'withdrawn';
      },
    });
    const a = addApp(d.tables, { user_id: U.owner, kind: 'upgrade', company_id: CO.expert });
    const r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'approve',
    });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('invalid_transition');
    expect(d.tables.companies.find((c) => c.id === CO.expert).next_plan).toBeNull();
    expect(d.tables.company_events).toEqual([]);
  });

  test('보류 — held, decided_by/at. 다른 상태에서는 409 invalid_transition · 없는 신청 404 · 모르는 동작 422', async () => {
    const a = addApp(db.tables, { user_id: U.newbie });
    const r = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'hold',
    });
    expect(r.json.data.application).toMatchObject({ status: 'held', decided_by: U.admin });
    for (const action of ['meeting', 'approve', 'hold']) {
      const again = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
        action,
        meeting_at: '2026-11-04T01:00:00.000Z',
      });
      expect(again.status).toBe(409);
      expect(again.json.code).toBe('invalid_transition');
    }
    for (const status of ['approved', 'withdrawn']) {
      const b = addApp(db.tables, { user_id: U.staff, status, created_at: at(700) });
      expect(
        (await call('POST', `/admin/partner/applications/${b.id}`, 'admin', { action: 'hold' }))
          .json.code
      ).toBe('invalid_transition');
    }
    expect(
      (await call('POST', `/admin/partner/applications/${U.newbie}`, 'admin', { action: 'hold' }))
        .status
    ).toBe(404);
    const bad = await call('POST', `/admin/partner/applications/${a.id}`, 'admin', {
      action: 'delete',
    });
    expect(bad.json).toMatchObject({ code: 'invalid', field: 'action' });
  });
});

describe('관리자 — 업체', () => {
  test('목록 — 협력업체만, 대표 이메일 · 구성원 수(active) · 구독(살아 있는 것, 없으면 최근)', async () => {
    db.tables.subscriptions.push(
      {
        id: 's1',
        company_id: CO.expert,
        user_id: U.owner,
        status: 'cancelled',
        next_charge_at: null,
        amount_krw: 50000,
        created_at: at(50),
      },
      {
        id: 's2',
        company_id: CO.expert,
        user_id: U.owner,
        status: 'active',
        next_charge_at: '2026-11-10T00:00:00+00:00',
        amount_krw: 50000,
        created_at: at(40),
      },
      {
        id: 's3',
        company_id: CO.susp,
        user_id: U.suspOwner,
        status: 'payment_failed',
        next_charge_at: null,
        amount_krw: 50000,
        created_at: at(60),
      }
    );
    const r = await call('GET', '/admin/partner/companies', 'admin');
    expect(r.status).toBe(200);
    expect(r.json.data.map((c) => c.id)).toEqual([CO.susp, CO.agent, CO.expert]);
    const ex = r.json.data.find((c) => c.id === CO.expert);
    expect(Object.keys(ex)).toEqual([
      'id',
      'name',
      'plan',
      'next_plan',
      'status',
      'sido',
      'gugun',
      'created_at',
      'owner_email',
      'member_count',
      'subscription',
    ]);
    expect(ex).toMatchObject({
      owner_email: 'owner@example.test',
      member_count: 3,
      subscription: {
        status: 'active',
        next_charge_at: '2026-11-10T00:00:00.000Z',
        amount_krw: 50000,
      },
    });
    expect(r.json.data.find((c) => c.id === CO.susp).subscription).toEqual({
      status: 'payment_failed',
      next_charge_at: null,
      amount_krw: 50000,
    });
    expect(r.json.data.find((c) => c.id === CO.agent).subscription).toBeNull();
  });

  test('업체로 만들기 — 업체(partner, active, created_by 관리자) + owner 구성원 + 이력 company_created {by:admin}. 구독 없이, 201', async () => {
    const r = await call('POST', '/admin/partner/companies', 'admin', {
      user_id: U.newbie,
      name: ' 새업체 ',
      plan: 'agent',
      sido: '경기도',
      gugun: '수원시',
    });
    expect(r.status).toBe(201);
    expect(Object.keys(r.json.data.company)).toEqual([
      'id',
      'name',
      'plan',
      'next_plan',
      'status',
      'sido',
      'gugun',
      'created_at',
    ]);
    expect(r.json.data.company).toMatchObject({
      name: '새업체',
      plan: 'agent',
      next_plan: null,
      status: 'active',
      sido: '경기도',
      gugun: '수원시',
    });
    const co = db.tables.companies.find((c) => c.id === r.json.data.company.id);
    expect(co).toMatchObject({ kind: 'partner', created_by: U.admin });
    expect(db.tables.company_members.find((m) => m.user_id === U.newbie)).toMatchObject({
      company_id: co.id,
      role: 'owner',
      status: 'active',
    });
    expect(db.tables.company_events).toEqual([
      expect.objectContaining({
        company_id: co.id,
        actor_user_id: U.admin,
        actor_kind: 'admin',
        type: 'company_created',
        payload: { by: 'admin' },
      }),
    ]);
    expect(db.writes().map((c) => `${c.method} ${c.table}`)).toEqual([
      'POST companies',
      'POST company_members',
      'POST company_events',
    ]);
    expect(db.calls.some((c) => c.table === 'subscriptions')).toBe(false);
  });

  test('업체로 만들기 — 이미 구성원(본사 포함) 409 already_member · 없는 회원 404 · 형식 422', async () => {
    for (const who of [U.hq, U.staff]) {
      const r = await call('POST', '/admin/partner/companies', 'admin', {
        user_id: who,
        name: 'x',
        plan: 'expert',
        sido: '경기도',
        gugun: '수원시',
      });
      expect(r.status).toBe(409);
      expect(r.json.code).toBe('already_member');
    }
    const none = await call('POST', '/admin/partner/companies', 'admin', {
      user_id: 'b0000000-0000-4000-8000-000000000000',
      name: 'x',
      plan: 'expert',
      sido: '경기도',
      gugun: '수원시',
    });
    expect(none.status).toBe(404);
    const ok = { user_id: U.newbie, name: 'x', plan: 'expert', sido: '경기도', gugun: '수원시' };
    for (const [field, value] of [
      ['user_id', 'abc'],
      ['name', ''],
      ['plan', 'standard'],
      ['sido', ''],
      ['gugun', '가'.repeat(41)],
    ]) {
      const r = await call('POST', '/admin/partner/companies', 'admin', { ...ok, [field]: value });
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code: 'invalid', field });
    }
    expect(db.writes()).toEqual([]);
  });

  test('업체로 만들기 — 그사이 다른 곳 구성원이 되면(23505) 만든 업체를 지우고 409', async () => {
    const d = use({
      onRequest: (c, t) => {
        if (c.method === 'POST' && c.table === 'company_members') {
          t.company_members.push({
            id: nodeCrypto.randomUUID(),
            company_id: CO.agent,
            user_id: U.newbie,
            role: 'staff',
            status: 'active',
            created_at: at(900),
          });
        }
      },
    });
    const r = await call('POST', '/admin/partner/companies', 'admin', {
      user_id: U.newbie,
      name: 'x',
      plan: 'expert',
      sido: '경기도',
      gugun: '수원시',
    });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe('already_member');
    expect(d.tables.companies).toHaveLength(4);
    expect(d.tables.company_events).toEqual([]);
  });
});

// ── 7) 지키는 것 ───────────────────────────────────────

describe('지키는 것', () => {
  test('profiles 는 읽기만 — tier 를 쓰지 않는다 (트리거가 맞춘다)', async () => {
    addInvite(db.tables, TOKEN);
    await call('POST', '/partner/invites/accept', 'newbie', { token: TOKEN });
    await call('POST', `/partner/members/${U.staff}/remove`, 'owner');
    await call('POST', '/admin/partner/companies', 'admin', {
      user_id: U.left,
      name: 'x',
      plan: 'expert',
      sido: '경기도',
      gugun: '수원시',
    });
    await call('POST', '/partner/plan', 'agentOwner', { next_plan: 'expert' });
    expect(db.calls.filter((c) => c.table === 'profiles' && c.method !== 'GET')).toEqual([]);
    expect(JSON.stringify(db.writes().map((c) => c.body))).not.toMatch(/"tier"/);
    expect(read('workers/account-api/src/partner.js')).not.toMatch(
      /['"`]profiles\?[^'"`]*tier|tier_source/
    );
  });

  test('이력이 실패해도 처리는 그대로 — 상태 코드만 로그, 개인정보 없음', async () => {
    use({ fail: { 'POST company_events': 500 } });
    const r = await call('POST', '/partner/apply', 'owner', APPLY_BODY());
    expect(r.status).toBe(201);
    expect(logs.some((l) => /company_events: agent_applied 500/.test(l))).toBe(true);
    for (const v of Object.values(PII)) expect(logs.join('\n')).not.toContain(v);
  });

  test('company_events 에 넣는 행은 정해진 칸만 — 이름 · 연락처 · 사업자번호 · 이메일 없음', async () => {
    addInvite(db.tables, TOKEN);
    await call('POST', '/partner/apply', 'owner', APPLY_BODY());
    await call('POST', '/partner/invites/accept', 'newbie', { token: TOKEN });
    await call('POST', `/partner/members/${U.staff}/remove`, 'owner');
    const a = db.tables.partner_applications[0];
    await call('POST', `/admin/partner/applications/${a.id}`, 'admin', { action: 'approve' });
    await call('POST', '/admin/partner/companies', 'admin', {
      user_id: U.left,
      name: '남은가구',
      plan: 'expert',
      sido: '경기도',
      gugun: '수원시',
    });
    const types = db.tables.company_events.map((e) => e.type);
    expect(types).toEqual([
      'agent_applied',
      'member_joined',
      'member_removed',
      'agent_approved',
      'company_created',
    ]);
    const allowed = [
      'company_id',
      'actor_user_id',
      'actor_kind',
      'type',
      'subject_type',
      'subject_id',
      'payload',
      'id',
      'created_at',
    ];
    for (const e of db.tables.company_events) {
      for (const k of Object.keys(e)) expect(allowed).toContain(k);
      expect(['member', 'admin', 'system']).toContain(e.actor_kind);
      expect(
        e.subject_type === null ||
          ['company', 'member', 'customer', 'project'].includes(e.subject_type)
      ).toBe(true);
      expect(e.type.length).toBeLessThanOrEqual(40);
    }
    const ev = JSON.stringify(db.tables.company_events);
    for (const v of [...Object.values(PII), '@example.test', '이름-']) expect(ev).not.toContain(v);
  });
});
