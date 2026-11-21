/**
 * @jest-environment node
 *
 * 사업자등록증 길 (workers/account-api/src/biz-cert.js · nts.js · cert-photo.js · push-outbox.js + worker.js 라우팅).
 * 2026-11-21 대표님 계획 승인 「사업자등록증 등록 시 첫 달 무료」 — DB 는 database/migrations/0077.
 *
 * 고정하는 것:
 *   1) 올리기 POST /partner/cert — 첫 바이트로 JPEG · PNG 만, 5MB · 긴 변 2576px · 375만 화소, 24시간 5장(429),
 *      이미 무료에 쓴 사업자등록증이 있으면 409, 살아 있는 옛 줄은 superseded, AI 읽기가 실패해도 올리기는 성공
 *   2) 확인 POST /partner/cert/confirm — 검증 숫자 반려 · 이미 받은 번호 반려 · 휴폐업 반려 ·
 *      국세청 무응답 검토 · 진위 불일치 검토 · AI 못 읽음 검토 · 번호 고침 검토 · 모두 통과 verified, 검토 사유 차례
 *   3) GET /partner/cert — 공개 모양(저장 경로 · sha256 · checks 없음)과 trial.eligible
 *   4) 본사 검토 — 목록(사진 서명 주소 10분 · 올린 사람 · 무료 기록) · 승인 · 반려, 관리자가 아니면 403
 *   5) 알림 — 검토로 가면 본사 대표 · 실장에게, 결과는 올린 사람에게 (글은 workflow-api messages.js 와 같다)
 *   6) 0077 적용 전(표 없음)에는 503 not_ready — 다른 길은 그대로
 *   7) 응답 · 로그에 사업자번호 · 대표자 이름 · 사진 주소를 필요 이상 싣지 않는다
 *
 * Supabase REST · Storage · 국세청은 fetch 를 가짜로 바꾸고, AI 읽기는 서비스 바인딩(env.ASSISTANT)을 가짜로 끼운다.
 * 실제 DB · 국세청 · Claude 를 부르지 않는다. 시험 데이터(번호 · 이름 · 상호)는 모두 가짜다.
 * ESM 을 jest(CJS) 에서 읽기 위해 import · export 를 떼고, import 하던 것은 인자로 넣어 평가한다 (account-partner 시험과 같다).
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
const Po = loadEsm('workers/account-api/src/push-outbox.js', [
  'enqueuePartnerApplicationNotice',
  'enqueueBizCertReviewNotices',
  'enqueueBizCertDecidedNotice',
  'bizCertReviewMessage',
  'bizCertDecidedMessage',
  'BIZ_CERT_REVIEW_URL',
]);
// 앱 알림 글의 정본 (workflow-api) — account-api 의 글이 같은지 본다
const Msg = loadEsm('workers/workflow-api/src/push/messages.js', [
  'buildMessage',
  'isValidMessage',
]);
const Pt = loadEsm(
  'workers/account-api/src/partner.js',
  [
    'matchPartnerRoute',
    'partnerResponse',
    'runPartnerRoute',
    'db',
    'DbError',
    'PartnerError',
    'iso',
    'profilesById',
  ],
  {
    jsonResponse: C.jsonResponse,
    UUID_RE: SP.UUID_RE,
    enqueuePartnerApplicationNotice: Po.enqueuePartnerApplicationNotice,
  }
);
const N = loadEsm('workers/account-api/src/nts.js', [
  'normalizeBizNo',
  'bizNoValid',
  'ntsRow',
  'lookupNtsStatus',
  'validateNts',
  'NTS_STATUS_URL',
  'NTS_VALIDATE_URL',
]);
const Ph = loadEsm('workers/account-api/src/cert-photo.js', [
  'PHOTO_MAX_BYTES',
  'PHOTO_MAX_EDGE',
  'PHOTO_MAX_PIXELS',
  'readBodyCapped',
  'sniffImage',
  'sha256Hex',
  'uploadObject',
  'createSignedUrls',
]);
const B = loadEsm(
  'workers/account-api/src/biz-cert.js',
  [
    'matchCertRoute',
    'runCertRoute',
    'isPlatformReviewer',
    'autoCheck',
    'certView',
    'CERT_BUCKET',
    'CERT_DAILY_MAX',
    'TRIAL_DAYS',
    'ADMIN_LIST_MAX',
    'SIGNED_URL_TTL_SEC',
    'LIVE_STATUSES',
  ],
  {
    db: Pt.db,
    DbError: Pt.DbError,
    PartnerError: Pt.PartnerError,
    partnerResponse: Pt.partnerResponse,
    iso: Pt.iso,
    profilesById: Pt.profilesById,
    UUID_RE: SP.UUID_RE,
    normalizeBizNo: N.normalizeBizNo,
    bizNoValid: N.bizNoValid,
    lookupNtsStatus: N.lookupNtsStatus,
    validateNts: N.validateNts,
    ...Ph,
    enqueueBizCertReviewNotices: Po.enqueueBizCertReviewNotices,
    enqueueBizCertDecidedNotice: Po.enqueueBizCertDecidedNotice,
  }
);
const W = loadEsm('workers/account-api/src/worker.js', ['__default'], {
  corsHeaders: C.corsHeaders,
  handleOptions: C.handleOptions,
  jsonResponse: C.jsonResponse,
  matchPartnerRoute: Pt.matchPartnerRoute,
  partnerResponse: Pt.partnerResponse,
  runPartnerRoute: Pt.runPartnerRoute,
  matchCertRoute: B.matchCertRoute,
  runCertRoute: B.runCertRoute,
  isPlatformReviewer: B.isPlatformReviewer,
  ...Wd,
}).__default;

const MIGRATION = read('database/migrations/0077_business_cert_trial.sql');
const kindsOf = (name) =>
  [
    ...new RegExp(`${name} CHECK \\(([^;]+)\\);`).exec(MIGRATION)[1].matchAll(/'([a-z_]+)'::text/g),
  ].map((x) => x[1]);
/** 0077 의 알림 종류 · 업체 없이 넣을 수 있는 종류 */
const OUTBOX_KINDS = kindsOf('notification_outbox_kind_check');
const NO_COMPANY_KINDS = kindsOf('notification_outbox_company_check');

const SB = 'https://example.supabase.co';
const NTS_KEY = 'nts-secret-key';

// 사람
const U = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  newbie: 'a0000000-0000-4000-8000-000000000002', // 새로 시작하는 사람 (업체 없음)
  other: 'a0000000-0000-4000-8000-000000000003',
  hqOwner: 'a0000000-0000-4000-8000-000000000004',
  hqManager: 'a0000000-0000-4000-8000-000000000005',
  hqStaff: 'a0000000-0000-4000-8000-000000000006',
  hqLeft: 'a0000000-0000-4000-8000-000000000007',
  partnerOwner: 'a0000000-0000-4000-8000-000000000008',
};
const TOKENS = Object.fromEntries(
  Object.entries(U).map(([k, id]) => [`t-${k}`, { id, email: `${k}@example.test` }])
);
const tok = (k) => `t-${k}`;
const CO = {
  platform: 'c0000000-0000-4000-8000-000000000001',
  partner: 'c0000000-0000-4000-8000-000000000002',
};

/** 검증 숫자가 맞는 가짜 번호 — 앞 9자리에 검증 숫자를 붙인다 */
function bizNo(nine) {
  for (let d = 0; d < 10; d++) if (N.bizNoValid(`${nine}${d}`)) return `${nine}${d}`;
  throw new Error('no check digit');
}
const BIZ = bizNo('123456789');
const BIZ2 = bizNo('220811234');
const BIZ_DASHED = `${BIZ.slice(0, 3)}-${BIZ.slice(3, 5)}-${BIZ.slice(5)}`;
// 가짜 개인정보 — 로그 · 알림에 나오면 안 된다
const PII = { company_name: '새봄가구', representative_name: '김가짜', open_date: '2020-03-05' };
const CONFIRM = () => ({ biz_no: BIZ_DASHED, ...PII });
const EXTRACTED = () => ({ biz_no: BIZ, ...PII });

// ── 가짜 사진 ──────────────────────────────────────────

function jpeg(w, h, pad = 0) {
  const head = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  ];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3];
  const u = new Uint8Array(head.length + sof.length + 9 + 2 + pad);
  u.set(head, 0);
  u.set(sof, head.length);
  u.set([0xff, 0xd9], head.length + sof.length + 9);
  return u;
}
function png(w, h) {
  const u = new Uint8Array(40);
  u.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(u.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return u;
}
function heic() {
  const u = new Uint8Array(32);
  u.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]); // ....ftypheic
  return u;
}
const PHOTO = jpeg(1200, 1600);

// ── 가짜 DB · Storage · 국세청 ─────────────────────────

function seed() {
  const mem = (n, company_id, user_id, role, status = 'active') => ({
    id: `m0000000-0000-4000-8000-00000000000${n}`,
    company_id,
    user_id,
    role,
    status,
    created_at: '2026-10-01T00:00:00.000Z',
  });
  return {
    profiles: Object.entries(U).map(([k, id]) => ({
      id,
      name: `이름-${k}`,
      email: `${k}@example.test`,
      tier: 'standard',
    })),
    companies: [
      { id: CO.platform, kind: 'platform', name: '다담 본사', plan: null, status: 'active' },
      { id: CO.partner, kind: 'partner', name: '성남가구', plan: 'expert', status: 'active' },
    ],
    company_members: [
      mem(1, CO.platform, U.hqOwner, 'owner'),
      mem(2, CO.platform, U.hqManager, 'manager'),
      mem(3, CO.platform, U.hqStaff, 'staff'),
      mem(4, CO.platform, U.hqLeft, 'manager', 'removed'),
      mem(5, CO.partner, U.partnerOwner, 'owner'),
    ],
    partner_applications: [],
    company_invites: [],
    business_certificates: [],
    trial_grants: [],
    notification_outbox: [],
  };
}

function jsonRes(body, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function matches(row, key, expr) {
  const v = row[key];
  const dot = expr.indexOf('.');
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  if (op === 'eq') return v !== null && v !== undefined && String(v) === val;
  if (op === 'in')
    return val
      .replace(/^\(|\)$/g, '')
      .split(',')
      .includes(String(v));
  if (op === 'is') return val === 'null' ? v === null || v === undefined : String(v) === val;
  throw new Error(`fakeDb: op ${op}`);
}

const LIVE = ['uploaded', 'review', 'verified'];
const len = (s, a, b) => typeof s === 'string' && [...s].length >= a && [...s].length <= b;
const optLen = (s, a, b) => s === null || s === undefined || len(s, a, b);

/** 0077 의 유니크 · CHECK 흉내. 위반이면 { code, status } */
function violation(tables, table, row, self) {
  const others = tables[table].filter((r) => r !== self);
  if (table === 'business_certificates') {
    const ok =
      ['image/jpeg', 'image/png'].includes(row.mime) &&
      Number.isInteger(row.size_bytes) &&
      row.size_bytes >= 1 &&
      row.size_bytes <= 5242880 &&
      /^[0-9a-f]{64}$/.test(row.sha256) &&
      ['uploaded', 'verified', 'review', 'rejected', 'superseded'].includes(row.status) &&
      (row.biz_no === null || row.biz_no === undefined || /^[0-9]{10}$/.test(row.biz_no)) &&
      len(row.storage_path, 1, 300) &&
      optLen(row.company_name, 1, 100) &&
      optLen(row.representative_name, 1, 60) &&
      optLen(row.review_reason, 1, 60) &&
      optLen(row.decision_reason, 1, 300) &&
      (!['verified', 'review'].includes(row.status) || !!row.biz_no);
    if (!ok) return { code: '23514', status: 400 };
    if (others.some((r) => r.storage_path === row.storage_path))
      return { code: '23505', status: 409 };
    if (
      LIVE.includes(row.status) &&
      others.some((r) => r.user_id === row.user_id && LIVE.includes(r.status))
    )
      return { code: '23505', status: 409 };
  }
  if (table === 'notification_outbox') {
    const ok =
      OUTBOX_KINDS.includes(row.kind) &&
      (!!row.company_id || NO_COMPANY_KINDS.includes(row.kind)) &&
      len(row.title, 1, 60) &&
      len(row.body, 1, 160) &&
      /^\/segan\//.test(row.url) &&
      (row.dedupe_key === null || len(row.dedupe_key, 1, 200));
    if (!ok) return { code: '23514', status: 400 };
    if (row.dedupe_key && others.some((r) => r.dedupe_key === row.dedupe_key))
      return { code: '23505', status: 409 };
  }
  return null;
}

const CERT_DEFAULTS = () => ({
  company_id: null,
  status: 'uploaded',
  extracted: null,
  biz_no: null,
  company_name: null,
  representative_name: null,
  open_date: null,
  checks: null,
  review_reason: null,
  confirmed_at: null,
  decided_by: null,
  decided_at: null,
  decision_reason: null,
});

/**
 * @param {object} [o]
 *   mutate(tables)   처음 표를 바꾼다
 *   fail             { 'POST business_certificates': 500, 'STORAGE upload': 500, ... }
 *   missing          표 이름 목록 — 그 표는 없다 (404 PGRST205, 0077 적용 전)
 *   nts              { status: '01' | '02' | '03' | '' | 숫자(HTTP 상태) | 'throw', valid: '01' | '02' | 숫자 | 'throw' | 'odd' }
 */
function fakeBackend({ mutate = null, fail = {}, missing = [], nts = {} } = {}) {
  const tables = seed();
  if (mutate) mutate(tables);
  const calls = [];
  const objects = new Map(); // 버킷 경로 → 바이트 수
  const ntsCalls = [];
  const ntsConf = { status: '01', valid: '01', ...nts };

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';
    const headers = init.headers || {};
    const auth = headers.Authorization || headers.authorization || '';

    // 국세청
    if (u.origin === 'https://api.odcloud.kr') {
      const what = u.pathname.endsWith('/status') ? 'status' : 'validate';
      const body = JSON.parse(init.body);
      ntsCalls.push({ what, url: String(url), body, method });
      const conf = ntsConf[what === 'status' ? 'status' : 'valid'];
      if (conf === 'throw') throw new Error('connect ECONNREFUSED');
      if (typeof conf === 'number') return jsonRes({ msg: 'error' }, conf);
      if (what === 'status') {
        return jsonRes({
          status_code: 'OK',
          data: [{ b_no: body.b_no[0], b_stt_cd: conf, tax_type: '부가가치세 일반과세자' }],
        });
      }
      if (conf === 'odd') return jsonRes({ status_code: 'OK', data: [{ unexpected: true }] });
      return jsonRes({ status_code: 'OK', data: [{ b_no: body.businesses[0].b_no, valid: conf }] });
    }
    if (u.origin !== SB) throw new Error(`unexpected ${method} ${u}`);

    if (u.pathname === '/auth/v1/user') {
      const who = TOKENS[auth.replace(/^Bearer\s+/, '')];
      return who ? jsonRes(who) : jsonRes({ message: 'bad jwt' }, 401);
    }
    if (u.pathname === '/rest/v1/rpc/is_admin') {
      const who = TOKENS[auth.replace(/^Bearer\s+/, '')];
      return jsonRes(!!who && who.id === U.admin);
    }

    // Storage — 올리기 · 서명 주소
    const sign = u.pathname.match(/^\/storage\/v1\/object\/sign\/([\w-]+)$/);
    if (sign) {
      const body = JSON.parse(init.body);
      calls.push({ kind: 'storage', op: 'sign', bucket: sign[1], body, auth });
      if (fail['STORAGE sign']) return jsonRes({ message: 'boom' }, fail['STORAGE sign']);
      return jsonRes(
        body.paths.map((p) => ({
          path: p,
          signedURL: `/object/sign/${sign[1]}/${p}?token=signed-${body.expiresIn}`,
          error: null,
        }))
      );
    }
    const obj = u.pathname.match(/^\/storage\/v1\/object\/([\w-]+)\/(.+)$/);
    if (obj) {
      calls.push({
        kind: 'storage',
        op: 'upload',
        bucket: obj[1],
        path: obj[2],
        size: init.body.byteLength,
        contentType: headers['Content-Type'],
        upsert: headers['x-upsert'],
        auth,
      });
      if (fail['STORAGE upload']) return jsonRes({ message: 'boom' }, fail['STORAGE upload']);
      objects.set(`${obj[1]}/${obj[2]}`, init.body.byteLength);
      return jsonRes({ Key: `${obj[1]}/${obj[2]}` });
    }

    const m = u.pathname.match(/^\/rest\/v1\/(\w+)$/);
    if (!m) throw new Error(`unexpected ${method} ${u}`);
    const table = m[1];
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
    if (missing.includes(table))
      return jsonRes(
        { code: 'PGRST205', message: `Could not find the table 'public.${table}'` },
        404
      );
    if (!tables[table]) throw new Error(`fakeDb: table ${table}`);
    const f = fail[`${method} ${table}`];
    if (f) return jsonRes({ code: 'XX000', message: 'boom' }, f);

    const params = [...u.searchParams.entries()];
    const get = (k) => (params.find(([key]) => key === k) || [])[1] || null;
    const select = get('select');
    const order = get('order');
    const limit = get('limit');
    const filters = params.filter(
      ([k]) => !['select', 'order', 'limit', 'on_conflict'].includes(k)
    );
    const pick = () => tables[table].filter((r) => filters.every(([k, v]) => matches(r, k, v)));
    // select — 칸 이름, 그리고 partner.js 가 쓰는 업체 끼워 넣기 company:companies(칸…) 하나
    const project = (row) => {
      if (!select || select === '*') return { ...row };
      const out = {};
      for (const item of select.split(/,(?![^(]*\))/)) {
        const embed = item.match(/^(\w+):companies\((.*)\)$/);
        if (embed) {
          const co = tables.companies.find((c) => c.id === row.company_id);
          out[embed[1]] = co
            ? Object.fromEntries(embed[2].split(',').map((k) => [k, co[k] ?? null]))
            : null;
        } else out[item] = row[item] === undefined ? null : row[item];
      }
      return out;
    };
    const minimal = /return=minimal/.test(call.prefer || '');
    const out = (rows, status) =>
      minimal
        ? new Response(null, { status: status === 200 ? 204 : status })
        : jsonRes(rows.map(project), status);

    if (method === 'GET') {
      let rows = pick();
      if (order) {
        const [col, dir] = order.split('.');
        rows = [...rows].sort(
          (a, b) => (dir === 'desc' ? -1 : 1) * (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0)
        );
      }
      if (limit) rows = rows.slice(0, Number(limit));
      return jsonRes(rows.map(project));
    }
    if (method === 'POST') {
      const made = [];
      for (const b of Array.isArray(body) ? body : [body]) {
        const now = new Date().toISOString();
        const row = {
          ...(table === 'business_certificates' ? CERT_DEFAULTS() : {}),
          id: nodeCrypto.randomUUID(),
          created_at: now,
          ...(table === 'business_certificates' ? { updated_at: now } : {}),
          ...b,
        };
        const bad = violation(tables, table, row, null);
        if (
          bad &&
          bad.code === '23505' &&
          /resolution=ignore-duplicates/.test(call.prefer || '') &&
          u.searchParams.get('on_conflict')
        )
          continue;
        if (bad) return jsonRes({ code: bad.code, message: 'violation' }, bad.status);
        made.push(row);
      }
      tables[table].push(...made);
      return out(made, 201);
    }
    if (method === 'PATCH') {
      const rows = pick();
      for (const r of rows) {
        const bad = violation(tables, table, { ...r, ...body }, r);
        if (bad) return jsonRes({ code: bad.code, message: 'violation' }, bad.status);
      }
      for (const r of rows) Object.assign(r, body);
      return out(rows, 200);
    }
    throw new Error(`fakeDb: ${method}`);
  };
  const writes = (table) =>
    calls.filter((c) => c.kind === 'rest' && c.method !== 'GET' && (!table || c.table === table));
  return { tables, calls, writes, objects, ntsCalls, fetchImpl };
}

/** 가짜 서비스 바인딩 — assistant-api CertExtract.read */
function fakeAssistant(result = () => ({ ok: true, extracted: EXTRACTED() })) {
  const calls = [];
  return {
    calls,
    async read(input) {
      calls.push(input);
      const out = typeof result === 'function' ? result(input) : result;
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

function makeEnv(over = {}) {
  return {
    SUPABASE_URL: SB,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    CORS_ORIGINS: 'https://dadamfurniture.com',
    NTS_SERVICE_KEY: NTS_KEY,
    ASSISTANT: fakeAssistant(),
    ...over,
  };
}

function req(method, pathname, token, body) {
  const headers = { Origin: 'https://dadamfurniture.com' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const raw = body instanceof Uint8Array;
  if (body !== undefined) headers['Content-Type'] = raw ? 'image/jpeg' : 'application/json';
  return new Request(`https://account.test${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
}

let be;
let env;
async function call(method, pathname, who, body, e = env) {
  const res = await W.fetch(req(method, pathname, who ? tok(who) : null, body), e);
  const json = await res.json();
  return { status: res.status, json, headers: res.headers };
}
const upload = (who, bytes = PHOTO, e = env) => call('POST', '/partner/cert', who, bytes, e);
const confirm = (who, body = CONFIRM(), e = env) =>
  call('POST', '/partner/cert/confirm', who, body, e);

const realFetch = global.fetch;
const realConsole = { log: console.log, warn: console.warn, error: console.error };
let logs;
const use = (o) => {
  be = fakeBackend(o);
  global.fetch = be.fetchImpl;
  return be;
};
beforeEach(() => {
  logs = [];
  for (const k of Object.keys(realConsole))
    console[k] = (...a) => logs.push(a.map(String).join(' '));
  env = makeEnv();
  use();
});
afterEach(() => {
  global.fetch = realFetch;
  Object.assign(console, realConsole);
});

const certs = () => be.tables.business_certificates;
const outbox = () => be.tables.notification_outbox;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CERT_KEYS = [
  'id',
  'status',
  'extracted',
  'biz_no',
  'company_name',
  'representative_name',
  'open_date',
  'review_reason',
  'decision_reason',
  'created_at',
];

/** 사업자등록증 한 줄을 바로 넣는다 */
function addCert(tables, row = {}) {
  const id = row.id || nodeCrypto.randomUUID();
  const full = {
    ...CERT_DEFAULTS(),
    id,
    user_id: U.newbie,
    storage_path: `${row.user_id || U.newbie}/2026/${id}.jpg`,
    mime: 'image/jpeg',
    size_bytes: 1000,
    sha256: 'a'.repeat(64),
    created_at: new Date(Date.now() - 60000).toISOString(),
    updated_at: new Date(Date.now() - 60000).toISOString(),
    ...row,
  };
  tables.business_certificates.push(full);
  return full;
}
const confirmedFields = () => ({ biz_no: BIZ, ...PII });
function addGrant(tables, row = {}) {
  const full = {
    id: nodeCrypto.randomUUID(),
    biz_no: BIZ,
    certificate_id: null,
    user_id: null,
    company_id: CO.partner,
    subscription_id: null,
    plan: 'expert',
    started_at: '2026-11-01T00:00:00.000Z',
    ends_at: '2026-12-01T00:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z',
    ...row,
  };
  tables.trial_grants.push(full);
  return full;
}

// ── 1) 올리기 ──────────────────────────────────────────

describe('POST /partner/cert — 사진 올리기', () => {
  test('JPEG — 버킷 business-certs 의 {사람}/{yyyy}/{id}.jpg, 줄은 uploaded, AI 가 읽은 값이 extracted 에', async () => {
    const r = await upload('newbie');
    expect(r.status).toBe(201);
    expect(r.json.success).toBe(true);
    expect(r.headers.get('Cache-Control')).toBe('no-store, private');
    const cert = r.json.data.cert;
    expect(Object.keys(cert)).toEqual(CERT_KEYS);
    expect(cert).toMatchObject({
      status: 'uploaded',
      extracted: EXTRACTED(),
      biz_no: null,
      company_name: null,
      representative_name: null,
      open_date: null,
      review_reason: null,
      decision_reason: null,
    });
    expect(cert.created_at).toMatch(ISO_RE);

    const [row] = certs();
    expect(row).toMatchObject({
      id: cert.id,
      user_id: U.newbie,
      company_id: null,
      mime: 'image/jpeg',
      size_bytes: PHOTO.byteLength,
      status: 'uploaded',
      extracted: EXTRACTED(),
    });
    expect(row.sha256).toBe(nodeCrypto.createHash('sha256').update(PHOTO).digest('hex'));
    expect(row.storage_path).toMatch(new RegExp(`^${U.newbie}/20\\d\\d/${cert.id}\\.jpg$`));

    const up = be.calls.find((c) => c.kind === 'storage' && c.op === 'upload');
    expect(up).toMatchObject({
      bucket: 'business-certs',
      path: row.storage_path,
      size: PHOTO.byteLength,
      contentType: 'image/jpeg',
      upsert: 'false',
      auth: 'Bearer service',
    });
    expect(B.CERT_BUCKET).toBe('business-certs');
    // AI 읽기는 줄을 넣은 뒤 그 id 로 한 번
    expect(env.ASSISTANT.calls).toEqual([{ certificateId: cert.id }]);
  });

  test('PNG — Content-Type 이 아니라 첫 바이트로 가린다 (.png)', async () => {
    const r = await upload('newbie', png(800, 1100));
    expect(r.status).toBe(201);
    expect(certs()[0].mime).toBe('image/png');
    expect(certs()[0].storage_path).toMatch(/\.png$/);
    expect(be.calls.find((c) => c.op === 'upload').contentType).toBe('image/png');
  });

  test('형식 · 크기 — 사진이 아님 422 bad_type · HEIC 422 heic · 빈 본문 422 empty · 너무 큰 화소 422 dimensions · 5MB 넘음 413', async () => {
    const cases = [
      [new TextEncoder().encode('%PDF-1.7 not a photo at all'), 422, 'bad_type'],
      [heic(), 422, 'heic'],
      [new Uint8Array(0), 422, 'empty'],
      [jpeg(4000, 3000), 422, 'dimensions'],
      [jpeg(2576, 1500), 422, 'dimensions'], // 긴 변은 맞지만 375만 화소를 넘는다
      [jpeg(1200, 1600, Ph.PHOTO_MAX_BYTES), 413, 'too_large'],
    ];
    for (const [bytes, status, code] of cases) {
      const r = await upload('newbie', bytes);
      expect([r.status, r.json.code]).toEqual([status, code]);
      expect(r.json.success).toBe(false);
      expect(typeof r.json.error).toBe('string');
    }
    expect(certs()).toHaveLength(0);
    expect(be.objects.size).toBe(0);
    expect(env.ASSISTANT.calls).toHaveLength(0);
    // 긴 변 2576 · 375만 화소 안이면 된다
    expect((await upload('newbie', jpeg(2576, 1455))).status).toBe(201);
    expect([Ph.PHOTO_MAX_BYTES, Ph.PHOTO_MAX_EDGE, Ph.PHOTO_MAX_PIXELS]).toEqual([
      5242880, 2576, 3750000,
    ]);
  });

  test('하루 한도 — 24시간 안에 5장을 올렸으면 429 daily_limit (24시간이 지난 줄은 세지 않는다)', async () => {
    const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
    use({
      mutate: (t) => {
        for (const h of [1, 2, 3, 23]) addCert(t, { status: 'superseded', created_at: ago(h) });
        for (const h of [25, 48, 72]) addCert(t, { status: 'rejected', created_at: ago(h) });
        // 다른 사람의 줄은 세지 않는다
        for (const h of [1, 2, 3, 4, 5])
          addCert(t, { user_id: U.other, status: 'superseded', created_at: ago(h) });
      },
    });
    expect(B.CERT_DAILY_MAX).toBe(5);
    expect((await upload('newbie')).status).toBe(201); // 다섯째
    const r = await upload('newbie');
    expect([r.status, r.json.code]).toEqual([429, 'daily_limit']);
    expect(certs().filter((c) => c.user_id === U.newbie)).toHaveLength(8);
    expect(be.objects.size).toBe(1);
  });

  test('다시 올리면 살아 있는 옛 줄(uploaded · review · verified)은 superseded — 살아 있는 줄은 늘 하나', async () => {
    for (const status of ['uploaded', 'review', 'verified']) {
      let old;
      use({
        mutate: (t) => {
          old = addCert(t, { status, ...(status === 'uploaded' ? {} : confirmedFields()) });
          addCert(t, { status: 'rejected', decision_reason: 'checksum', ...confirmedFields() });
          addCert(t, { user_id: U.other, status: 'verified', ...confirmedFields() });
        },
      });
      const r = await upload('newbie');
      expect(r.status).toBe(201);
      expect(old.status).toBe('superseded');
      const mine = certs().filter((c) => c.user_id === U.newbie);
      expect(mine.filter((c) => B.LIVE_STATUSES.includes(c.status)).map((c) => c.id)).toEqual([
        r.json.data.cert.id,
      ]);
      // 반려된 줄 · 다른 사람의 줄은 그대로
      expect(mine.map((c) => c.status).sort()).toEqual(['rejected', 'superseded', 'uploaded']);
      expect(certs().find((c) => c.user_id === U.other).status).toBe('verified');
    }
  });

  test('이미 무료에 쓴 사업자등록증이 있는 사람은 다시 올릴 수 없다 — 409 trial_used, 아무것도 바꾸지 않는다', async () => {
    let used;
    use({
      mutate: (t) => {
        used = addCert(t, { status: 'verified', ...confirmedFields() });
        addGrant(t, { certificate_id: used.id, user_id: U.newbie });
      },
    });
    const r = await upload('newbie');
    expect([r.status, r.json.code]).toEqual([409, 'trial_used']);
    expect(used.status).toBe('verified');
    expect(certs()).toHaveLength(1);
    expect(be.objects.size).toBe(0);
    expect(be.writes()).toHaveLength(0);
    // 다른 사람의 사업자등록증으로 준 무료는 나와 상관없다
    use({
      mutate: (t) => {
        const c = addCert(t, { user_id: U.other, status: 'verified', ...confirmedFields() });
        addGrant(t, { certificate_id: c.id, user_id: U.other });
      },
    });
    expect((await upload('newbie')).status).toBe(201);
  });

  test('AI 읽기가 실패해도 올리기는 성공 — extracted 는 null (읽기 실패 · 던짐 · 바인딩 없음 · 모양이 틀린 값)', async () => {
    const cases = [
      fakeAssistant({ ok: false, reason: 'claude_529' }),
      fakeAssistant(new Error('binding broke')),
      undefined,
      fakeAssistant({ ok: true, extracted: 'not an object' }),
    ];
    for (const ASSISTANT of cases) {
      use();
      const r = await upload('newbie', PHOTO, makeEnv({ ASSISTANT }));
      expect(r.status).toBe(201);
      expect(r.json.data.cert.extracted).toBeNull();
      expect(certs()[0]).toMatchObject({ status: 'uploaded', extracted: null });
    }
    // 읽은 값은 모양이 맞는 칸만 남긴다 (번호는 숫자 10자리 · 날짜는 YYYY-MM-DD)
    use();
    const odd = fakeAssistant({
      ok: true,
      extracted: { biz_no: '123', company_name: ' 새봄가구 ', open_date: '2020/03/05', extra: 1 },
    });
    const r = await upload('newbie', PHOTO, makeEnv({ ASSISTANT: odd }));
    expect(r.json.data.cert.extracted).toEqual({
      biz_no: null,
      company_name: '새봄가구',
      representative_name: null,
      open_date: null,
    });
  });

  test('새 줄을 못 넣으면 옛 줄을 살려 둔다 · 사진을 못 올리면 줄을 건드리지 않는다', async () => {
    let old;
    use({
      mutate: (t) => (old = addCert(t, { status: 'verified', ...confirmedFields() })),
      fail: { 'POST business_certificates': 500 },
    });
    let r = await upload('newbie');
    expect([r.status, r.json.code]).toEqual([500, 'server_error']);
    expect(old.status).toBe('verified');
    expect(certs()).toHaveLength(1);
    // 옛 것으로 돌렸다가 → 넣기 실패 → 되살렸다
    expect(be.writes('business_certificates').map((c) => [c.method, c.body.status])).toEqual([
      ['PATCH', 'superseded'],
      ['POST', 'uploaded'],
      ['PATCH', 'verified'],
    ]);

    use({
      mutate: (t) => (old = addCert(t, { status: 'verified', ...confirmedFields() })),
      fail: { 'STORAGE upload': 500 },
    });
    r = await upload('newbie');
    expect([r.status, r.json.code]).toEqual([500, 'server_error']);
    expect(old.status).toBe('verified');
    expect(be.writes()).toHaveLength(0);
  });

  test('로그인 안 됨 401 · 서버 키 없음 503 not_configured', async () => {
    let r = await upload(null);
    expect([r.status, r.json.code]).toEqual([401, 'unauthorized']);
    r = await upload('newbie', PHOTO, makeEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }));
    expect([r.status, r.json.code]).toEqual([503, 'not_configured']);
    expect(certs()).toHaveLength(0);
  });
});

// ── 2) 확인 ────────────────────────────────────────────

describe('POST /partner/cert/confirm — 사람 확인 + 자동 확인', () => {
  const uploaded = (extracted = EXTRACTED()) => ({
    mutate: (t) => addCert(t, { status: 'uploaded', extracted }),
  });

  test('모두 통과 → verified — 번호는 숫자 10자리로, checks · confirmed_at, 무료 가능', async () => {
    use(uploaded());
    const r = await confirm('newbie');
    expect(r.status).toBe(200);
    const { cert, trial } = r.json.data;
    expect(Object.keys(cert)).toEqual(CERT_KEYS);
    expect(cert).toMatchObject({
      status: 'verified',
      biz_no: BIZ,
      ...PII,
      review_reason: null,
      decision_reason: null,
    });
    expect(trial).toEqual({ eligible: true, reason: null, days: 30 });
    const [row] = certs();
    expect(row.checks).toEqual({
      checksum: true,
      nts_status: 'active',
      nts_valid: true,
      duplicate: false,
      edited: false,
    });
    expect(row.confirmed_at).toMatch(ISO_RE);
    expect(row.status).toBe('verified');
    expect(outbox()).toHaveLength(0);

    // 국세청 — 상태조회 다음 진위확인, 시크릿은 주소의 serviceKey 로
    expect(be.ntsCalls.map((c) => c.what)).toEqual(['status', 'validate']);
    const [st, va] = be.ntsCalls;
    expect(st.url).toBe(`${N.NTS_STATUS_URL}?serviceKey=${NTS_KEY}`);
    expect(st.method).toBe('POST');
    expect(st.body).toEqual({ b_no: [BIZ] });
    expect(va.url).toBe(`${N.NTS_VALIDATE_URL}?serviceKey=${NTS_KEY}`);
    expect(va.body).toEqual({
      businesses: [
        {
          b_no: BIZ,
          start_dt: '20200305',
          p_nm: '김가짜',
          p_nm2: '',
          b_nm: '',
          corp_no: '',
          b_sector: '',
          b_type: '',
        },
      ],
    });
    expect(N.NTS_STATUS_URL).toBe('https://api.odcloud.kr/api/nts-businessman/v1/status');
    expect(N.NTS_VALIDATE_URL).toBe('https://api.odcloud.kr/api/nts-businessman/v1/validate');
  });

  test('형식 — 번호 10자리 · 상호 1~100 · 대표자 1~60 · 날짜 YYYY-MM-DD, 아니면 422 invalid + field', async () => {
    use(uploaded());
    const bad = [
      [{ biz_no: '123-45-6789' }, 'biz_no'],
      [{ biz_no: 1234567891 }, 'biz_no'],
      [{ biz_no: '12345678901' }, 'biz_no'],
      [{ company_name: '   ' }, 'company_name'],
      [{ company_name: '가'.repeat(101) }, 'company_name'],
      [{ representative_name: '나'.repeat(61) }, 'representative_name'],
      [{ representative_name: undefined }, 'representative_name'],
      [{ open_date: '2020.03.05' }, 'open_date'],
      [{ open_date: '2020-02-30' }, 'open_date'],
      [{ open_date: '20200305' }, 'open_date'],
    ];
    for (const [over, field] of bad) {
      const r = await confirm('newbie', { ...CONFIRM(), ...over });
      expect([r.status, r.json.code, r.json.field]).toEqual([422, 'invalid', field]);
    }
    const r = await call('POST', '/partner/cert/confirm', 'newbie', 'not json');
    expect([r.status, r.json.code]).toEqual([422, 'invalid']);
    expect(certs()[0].status).toBe('uploaded');
    expect(be.ntsCalls).toHaveLength(0);
    // 앞뒤 공백은 자른다 · 번호는 붙임표 · 빈칸 없이 넣는다
    const ok = await confirm('newbie', {
      biz_no: ` ${BIZ.slice(0, 3)} ${BIZ.slice(3, 5)} ${BIZ.slice(5)} `,
      company_name: '  새봄가구 ',
      representative_name: ' 김가짜 ',
      open_date: ' 2020-03-05 ',
    });
    expect(ok.json.data.cert).toMatchObject({ status: 'verified', biz_no: BIZ, ...PII });
  });

  test('확인할 uploaded 줄이 없으면 409 not_uploaded (없음 · 이미 확인함 · 남의 줄)', async () => {
    let r = await confirm('newbie');
    expect([r.status, r.json.code]).toEqual([409, 'not_uploaded']);
    for (const status of ['verified', 'review', 'rejected', 'superseded']) {
      use({ mutate: (t) => addCert(t, { status, ...confirmedFields() }) });
      r = await confirm('newbie');
      expect([r.status, r.json.code]).toEqual([409, 'not_uploaded']);
    }
    use({ mutate: (t) => addCert(t, { user_id: U.other, status: 'uploaded' }) });
    r = await confirm('newbie');
    expect([r.status, r.json.code]).toEqual([409, 'not_uploaded']);
    expect(certs()[0].status).toBe('uploaded');
    expect(be.ntsCalls).toHaveLength(0);
  });

  test('검증 숫자가 틀리면 rejected checksum — 국세청을 묻지 않는다', async () => {
    use(uploaded());
    const wrong = `${BIZ.slice(0, 9)}${(Number(BIZ[9]) + 1) % 10}`;
    const r = await confirm('newbie', { ...CONFIRM(), biz_no: wrong });
    expect(r.status).toBe(200);
    expect(r.json.data.cert).toMatchObject({
      status: 'rejected',
      decision_reason: 'checksum',
      review_reason: null,
      biz_no: wrong,
    });
    expect(r.json.data.trial).toEqual({ eligible: false, reason: 'not_verified', days: 30 });
    expect(certs()[0].checks).toEqual({
      checksum: false,
      nts_status: null,
      nts_valid: null,
      duplicate: null,
      edited: true,
    });
    expect(be.ntsCalls).toHaveLength(0);
    expect(outbox()).toHaveLength(0);
  });

  test('이미 무료를 받은 번호면 rejected already_used — 국세청을 묻지 않는다', async () => {
    use({
      mutate: (t) => {
        addCert(t, { status: 'uploaded', extracted: EXTRACTED() });
        addGrant(t, { biz_no: BIZ });
      },
    });
    const r = await confirm('newbie');
    expect(r.json.data.cert).toMatchObject({ status: 'rejected', decision_reason: 'already_used' });
    expect(certs()[0].checks).toMatchObject({ checksum: true, duplicate: true, nts_status: null });
    expect(be.ntsCalls).toHaveLength(0);
    expect(outbox()).toHaveLength(0);
    // 반려된 줄은 살아 있는 줄이 아니다 — 다시 올릴 수 있다
    expect((await upload('newbie')).status).toBe(201);
  });

  test('계속사업자가 아니면 rejected not_active (휴업 02 · 폐업 03 · 등록되지 않은 번호) — 진위확인은 묻지 않는다', async () => {
    for (const [code, status] of [
      ['02', 'suspended'],
      ['03', 'closed'],
      ['', 'unregistered'],
    ]) {
      use({ ...uploaded(), nts: { status: code } });
      const r = await confirm('newbie');
      expect(r.json.data.cert).toMatchObject({ status: 'rejected', decision_reason: 'not_active' });
      expect(certs()[0].checks).toEqual({
        checksum: true,
        nts_status: status,
        nts_valid: null,
        duplicate: false,
        edited: false,
      });
      expect(be.ntsCalls.map((c) => c.what)).toEqual(['status']);
      expect(outbox()).toHaveLength(0);
    }
  });

  test('국세청이 답하지 않으면 검토 nts_unavailable (오류 · 연결 실패 · 시크릿 없음 · 진위확인만 실패 · 모르는 응답)', async () => {
    const cases = [
      [{ nts: { status: 503 } }, {}, null, true],
      [{ nts: { status: 'throw' } }, {}, null, true],
      [{}, { NTS_SERVICE_KEY: undefined }, null, null],
      [{ nts: { valid: 500 } }, {}, 'active', null],
      [{ nts: { valid: 'throw' } }, {}, 'active', null],
      [{ nts: { valid: 'odd' } }, {}, 'active', null],
    ];
    for (const [backend, envOver, ntsStatus, ntsValid] of cases) {
      use({ ...uploaded(), ...backend });
      const r = await confirm('newbie', CONFIRM(), makeEnv(envOver));
      expect(r.status).toBe(200);
      expect(r.json.data.cert).toMatchObject({
        status: 'review',
        review_reason: 'nts_unavailable',
        decision_reason: null,
      });
      expect(r.json.data.trial).toEqual({ eligible: false, reason: 'not_verified', days: 30 });
      expect(certs()[0].checks).toEqual({
        checksum: true,
        nts_status: ntsStatus,
        nts_valid: ntsValid,
        duplicate: false,
        edited: false,
      });
    }
    // 시크릿이 없으면 국세청을 아예 부르지 않는다
    expect(be.ntsCalls.map((c) => c.what)).toEqual(['status', 'validate']);
    use(uploaded());
    await confirm('newbie', CONFIRM(), makeEnv({ NTS_SERVICE_KEY: '' }));
    expect(be.ntsCalls).toHaveLength(0);
  });

  test('진위확인 불일치(02)면 검토 nts_mismatch', async () => {
    use({ ...uploaded(), nts: { valid: '02' } });
    const r = await confirm('newbie');
    expect(r.json.data.cert).toMatchObject({ status: 'review', review_reason: 'nts_mismatch' });
    expect(certs()[0].checks).toMatchObject({ nts_status: 'active', nts_valid: false });
  });

  test('AI 가 번호를 못 읽었으면 검토 unreadable · 읽은 번호와 다르면 검토 edited — 국세청 사유보다 먼저', async () => {
    // 못 읽음 — 읽은 값이 없거나 번호 칸이 비었다
    for (const extracted of [null, { ...EXTRACTED(), biz_no: null }]) {
      for (const nts of [{}, { valid: '02' }, { status: 503 }]) {
        use({ ...uploaded(extracted), nts });
        const r = await confirm('newbie');
        expect(r.json.data.cert).toMatchObject({ status: 'review', review_reason: 'unreadable' });
        expect(certs()[0].checks.edited).toBeNull();
      }
    }
    // 번호 고침 — AI 가 읽은 번호와 사람이 확인한 번호가 다르다
    for (const nts of [{}, { valid: '02' }, { status: 503 }]) {
      use({ ...uploaded({ ...EXTRACTED(), biz_no: BIZ2 }), nts });
      const r = await confirm('newbie');
      expect(r.json.data.cert).toMatchObject({
        status: 'review',
        review_reason: 'edited',
        biz_no: BIZ,
      });
      expect(certs()[0].checks.edited).toBe(true);
    }
    // 막는 것이 검토보다 먼저다 — 못 읽었어도 휴폐업이면 반려
    use({ ...uploaded(null), nts: { status: '03' } });
    const r = await confirm('newbie');
    expect(r.json.data.cert).toMatchObject({
      status: 'rejected',
      decision_reason: 'not_active',
      review_reason: null,
    });
  });

  test('검토로 가면 본사(kind platform)의 active 대표 · 실장에게 biz_cert_review — 한 번만, 글에 번호 · 이름 없음', async () => {
    use({ ...uploaded(), nts: { valid: '02' } });
    const r = await confirm('newbie');
    const id = r.json.data.cert.id;
    const rows = outbox();
    expect(rows.map((n) => n.user_id).sort()).toEqual([U.hqOwner, U.hqManager].sort());
    const msg = Msg.buildMessage('biz_cert_review', {});
    for (const n of rows) {
      expect(n).toMatchObject({
        company_id: CO.platform,
        kind: 'biz_cert_review',
        title: msg.title,
        body: msg.body,
        url: msg.url,
        ref_id: id,
        dedupe_key: `biz_cert_review:${id}:${n.user_id}`,
      });
      for (const v of [BIZ, BIZ_DASHED, ...Object.values(PII)])
        expect(`${n.title} ${n.body} ${n.url}`).not.toContain(v);
    }
    const post = be.writes('notification_outbox')[0];
    expect(post.query).toBe('?on_conflict=dedupe_key');
    expect(post.prefer).toBe('resolution=ignore-duplicates,return=minimal');
    // 같은 사업자등록증을 다시 넣어도 한 번만
    await Po.enqueueBizCertReviewNotices(env, id, [
      { user_id: U.hqOwner, company_id: CO.platform },
      { user_id: U.hqOwner, company_id: CO.platform },
    ]);
    expect(outbox()).toHaveLength(2);
  });

  test('알림 넣기가 실패해도 확인은 그대로 된다 (던지지 않는다)', async () => {
    for (const fail of [{ 'POST notification_outbox': 500 }, { 'GET companies': 500 }]) {
      use({ ...uploaded(), nts: { valid: '02' }, fail });
      const r = await confirm('newbie');
      expect(r.status).toBe(200);
      expect(r.json.data.cert.status).toBe('review');
      expect(outbox()).toHaveLength(0);
    }
  });
});

// ── 3) 내 사업자등록증 ─────────────────────────────────

describe('GET /partner/cert — 내 사업자등록증 · 무료 가능 여부', () => {
  const get = (who) => call('GET', '/partner/cert', who);

  test('없으면 cert null · no_cert', async () => {
    const r = await get('newbie');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      success: true,
      data: { cert: null, trial: { eligible: false, reason: 'no_cert', days: 30 } },
    });
    expect(B.TRIAL_DAYS).toBe(30);
  });

  test('uploaded · review 는 not_verified, verified 는 eligible, 그 번호가 trial_grants 에 있으면 already_used', async () => {
    for (const status of ['uploaded', 'review']) {
      use({
        mutate: (t) => addCert(t, { status, ...(status === 'review' ? confirmedFields() : {}) }),
      });
      const r = await get('newbie');
      expect(r.json.data.cert.status).toBe(status);
      expect(r.json.data.trial).toEqual({ eligible: false, reason: 'not_verified', days: 30 });
    }
    use({ mutate: (t) => addCert(t, { status: 'verified', ...confirmedFields() }) });
    let r = await get('newbie');
    expect(r.json.data.trial).toEqual({ eligible: true, reason: null, days: 30 });

    use({
      mutate: (t) => {
        addCert(t, { status: 'verified', ...confirmedFields() });
        addGrant(t, { biz_no: BIZ });
      },
    });
    r = await get('newbie');
    expect(r.json.data.trial).toEqual({ eligible: false, reason: 'already_used', days: 30 });
    // 다른 번호로 준 무료는 상관없다
    use({
      mutate: (t) => {
        addCert(t, { status: 'verified', ...confirmedFields() });
        addGrant(t, { biz_no: BIZ2 });
      },
    });
    expect((await get('newbie')).json.data.trial.eligible).toBe(true);
  });

  test('살아 있는 줄이 먼저, 없으면 가장 최근 줄. 남의 줄은 보이지 않는다', async () => {
    const at = (min) => new Date(Date.now() - min * 60000).toISOString();
    let live;
    use({
      mutate: (t) => {
        live = addCert(t, { status: 'verified', created_at: at(50), ...confirmedFields() });
        addCert(t, { status: 'rejected', created_at: at(10), ...confirmedFields() });
        addCert(t, { user_id: U.other, status: 'uploaded', created_at: at(1) });
      },
    });
    expect((await get('newbie')).json.data.cert.id).toBe(live.id);

    let last;
    use({
      mutate: (t) => {
        addCert(t, { status: 'superseded', created_at: at(50) });
        last = addCert(t, {
          status: 'rejected',
          decision_reason: 'not_active',
          created_at: at(10),
          ...confirmedFields(),
        });
      },
    });
    const r = await get('newbie');
    expect(r.json.data.cert).toMatchObject({
      id: last.id,
      status: 'rejected',
      decision_reason: 'not_active',
    });
    expect(r.json.data.trial.reason).toBe('not_verified');
    expect((await get('other')).json.data.cert).toBeNull();
  });

  test('공개 모양 — 저장 경로 · sha256 · checks · 올린 사람 id 를 싣지 않는다', async () => {
    use({
      mutate: (t) =>
        addCert(t, {
          status: 'review',
          review_reason: 'nts_mismatch',
          checks: { checksum: true },
          extracted: EXTRACTED(),
          ...confirmedFields(),
        }),
    });
    const r = await get('newbie');
    expect(Object.keys(r.json.data.cert)).toEqual(CERT_KEYS);
    const text = JSON.stringify(r.json);
    for (const k of ['storage_path', 'sha256', 'checks', 'user_id', 'size_bytes', 'mime'])
      expect(text).not.toContain(k);
    expect(text).not.toContain(certs()[0].storage_path);
  });
});

// ── 4) 본사 검토 ───────────────────────────────────────

describe('본사 검토 — /admin/partner/certs', () => {
  const at = (min) => new Date(Date.now() - min * 60000).toISOString();
  const reviewRow = (t, over = {}) =>
    addCert(t, {
      status: 'review',
      review_reason: 'nts_mismatch',
      checks: {
        checksum: true,
        nts_status: 'active',
        nts_valid: false,
        duplicate: false,
        edited: false,
      },
      extracted: EXTRACTED(),
      confirmed_at: at(5),
      ...confirmedFields(),
      ...over,
    });

  test('다담 본사 대표 · 실장도 검토할 수 있다 (사이트 관리자가 아니어도) — 본사 직원 · 나간 실장 · 팩토리 대표는 못 한다', async () => {
    let row;
    use({ mutate: (t) => (row = reviewRow(t)) });
    for (const who of ['hqOwner', 'hqManager']) {
      const r = await call('GET', '/admin/partner/certs', who);
      expect([who, r.status, r.json.data.map((c) => c.id)]).toEqual([who, 200, [row.id]]);
    }
    for (const who of ['hqStaff', 'hqLeft', 'partnerOwner', 'newbie']) {
      const r = await call('GET', '/admin/partner/certs', who);
      expect([who, r.status, r.json.code]).toEqual([who, 403, 'not_admin']);
    }
    // 본사 실장이 승인한다
    const r = await call('POST', `/admin/partner/certs/${row.id}`, 'hqManager', {
      decision: 'approve',
    });
    expect(r.status).toBe(200);
    expect(row.status).toBe('verified');
    expect(row.decided_by).toBe(U.hqManager);
    // 다른 관리자 길(업체 신청)은 그대로 관리자만
    const apps = await call('GET', '/admin/partner/applications', 'hqOwner');
    expect([apps.status, apps.json.code]).toEqual([403, 'not_admin']);
  });

  test('관리자가 아니면 403 not_admin · 로그인 안 됨 401 — 목록 · 처리 모두', async () => {
    let row;
    use({ mutate: (t) => (row = reviewRow(t)) });
    for (const who of ['newbie', 'hqStaff', 'partnerOwner']) {
      let r = await call('GET', '/admin/partner/certs', who);
      expect([r.status, r.json.code]).toEqual([403, 'not_admin']);
      r = await call('POST', `/admin/partner/certs/${row.id}`, who, { decision: 'approve' });
      expect([r.status, r.json.code]).toEqual([403, 'not_admin']);
    }
    let r = await call('GET', '/admin/partner/certs', null);
    expect([r.status, r.json.code]).toEqual([401, 'unauthorized']);
    r = await call('POST', `/admin/partner/certs/${row.id}`, null, { decision: 'approve' });
    expect([r.status, r.json.code]).toEqual([401, 'unauthorized']);
    expect(row.status).toBe('review');
    expect(be.calls.filter((c) => c.kind === 'storage')).toHaveLength(0);
  });

  test('목록 — 기본 review, 최신순. 줄마다 공개 모양 + checks · 올린 사람 · 사진 서명 주소(10분) · 무료 기록', async () => {
    let a;
    let b;
    use({
      mutate: (t) => {
        a = reviewRow(t, { created_at: at(30) });
        b = reviewRow(t, {
          user_id: U.other,
          biz_no: BIZ2,
          review_reason: 'edited',
          created_at: at(10),
        });
        addCert(t, { user_id: U.partnerOwner, status: 'verified', ...confirmedFields() });
        addCert(t, { user_id: U.hqStaff, status: 'uploaded' });
        addGrant(t, { biz_no: BIZ2, plan: 'manager', company_id: CO.partner });
      },
    });
    const r = await call('GET', '/admin/partner/certs', 'admin');
    expect(r.status).toBe(200);
    expect(r.json.data.map((c) => c.id)).toEqual([b.id, a.id]);
    const [first, second] = r.json.data;
    expect(Object.keys(first)).toEqual([
      ...CERT_KEYS,
      'checks',
      'user_id',
      'confirmed_at',
      'decided_by',
      'decided_at',
      'email',
      'name',
      'photo_url',
      'trial',
    ]);
    expect(first).toMatchObject({
      status: 'review',
      review_reason: 'edited',
      biz_no: BIZ2,
      checks: b.checks,
      user_id: U.other,
      email: 'other@example.test',
      name: '이름-other',
      photo_url: `${SB}/storage/v1/object/sign/business-certs/${b.storage_path}?token=signed-600`,
      trial: {
        plan: 'manager',
        started_at: '2026-11-01T00:00:00.000Z',
        ends_at: '2026-12-01T00:00:00.000Z',
        company_id: CO.partner,
      },
    });
    expect(second).toMatchObject({ user_id: U.newbie, trial: null, decided_at: null });
    expect(second.confirmed_at).toMatch(ISO_RE);
    // 서명 주소 — 한 번에, 10분, 서비스 키로
    const sign = be.calls.filter((c) => c.op === 'sign');
    expect(sign).toHaveLength(1);
    expect(sign[0]).toMatchObject({
      bucket: 'business-certs',
      body: { expiresIn: 600, paths: [b.storage_path, a.storage_path] },
      auth: 'Bearer service',
    });
    expect(B.SIGNED_URL_TTL_SEC).toBe(600);
    // 저장 경로 · sha256 칸은 싣지 않는다 (서명 주소 안의 경로만)
    expect(Object.keys(first)).not.toEqual(expect.arrayContaining(['storage_path', 'sha256']));
  });

  test('목록 — status=verified · rejected · all, 그 밖은 422. 50줄까지. 없으면 빈 목록(서명 주소를 만들지 않는다)', async () => {
    use({
      mutate: (t) => {
        reviewRow(t, { created_at: at(40) });
        addCert(t, {
          user_id: U.other,
          status: 'verified',
          created_at: at(30),
          ...confirmedFields(),
        });
        addCert(t, {
          user_id: U.partnerOwner,
          status: 'rejected',
          decision_reason: 'checksum',
          created_at: at(20),
          ...confirmedFields(),
        });
        addCert(t, { user_id: U.hqStaff, status: 'uploaded', created_at: at(10) });
      },
    });
    const list = async (q) => (await call('GET', `/admin/partner/certs${q}`, 'admin')).json.data;
    expect((await list('?status=review')).map((c) => c.status)).toEqual(['review']);
    expect((await list('?status=verified')).map((c) => c.status)).toEqual(['verified']);
    expect((await list('?status=rejected')).map((c) => c.status)).toEqual(['rejected']);
    expect((await list('?status=all')).map((c) => c.status)).toEqual([
      'uploaded',
      'rejected',
      'verified',
      'review',
    ]);
    for (const bad of ['uploaded', 'superseded', 'review,verified', 'x']) {
      const r = await call('GET', `/admin/partner/certs?status=${bad}`, 'admin');
      expect([r.status, r.json.code, r.json.field]).toEqual([422, 'invalid', 'status']);
    }
    const q = be.calls.filter((c) => c.method === 'GET' && c.table === 'business_certificates');
    expect(q.every((c) => /limit=50/.test(c.query) && /order=created_at\.desc/.test(c.query))).toBe(
      true
    );
    expect(B.ADMIN_LIST_MAX).toBe(50);

    use();
    const r = await call('GET', '/admin/partner/certs', 'admin');
    expect(r.json).toEqual({ success: true, data: [] });
    expect(be.calls.filter((c) => c.kind === 'storage')).toHaveLength(0);
  });

  test('승인 — verified · decided_by · decided_at, 올린 사람에게 biz_cert_decided (업체 없이)', async () => {
    let row;
    use({ mutate: (t) => (row = reviewRow(t)) });
    const r = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', {
      decision: 'approve',
    });
    expect(r.status).toBe(200);
    expect(r.json.data.cert).toMatchObject({
      id: row.id,
      status: 'verified',
      decided_by: U.admin,
      decision_reason: null,
      user_id: U.newbie,
      checks: row.checks,
    });
    expect(r.json.data.cert.decided_at).toMatch(ISO_RE);
    expect(row).toMatchObject({ status: 'verified', decided_by: U.admin });

    const msg = Msg.buildMessage('biz_cert_decided', { approved: true });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({
      user_id: U.newbie,
      company_id: null,
      kind: 'biz_cert_decided',
      title: msg.title,
      body: msg.body,
      url: msg.url,
      ref_id: row.id,
      dedupe_key: `biz_cert_decided:${row.id}:${U.newbie}:verified`,
    });
    // 올린 사람은 이제 무료를 시작할 수 있다
    const mine = await call('GET', '/partner/cert', 'newbie');
    expect(mine.json.data.trial).toEqual({ eligible: true, reason: null, days: 30 });
  });

  test('승인 — 그사이 그 번호가 무료를 받았으면 409 already_used (줄은 review 그대로, 알림 없음)', async () => {
    let row;
    use({
      mutate: (t) => {
        row = reviewRow(t);
        addGrant(t, { biz_no: BIZ });
      },
    });
    const r = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', {
      decision: 'approve',
    });
    expect([r.status, r.json.code]).toEqual([409, 'already_used']);
    expect(row.status).toBe('review');
    expect(outbox()).toHaveLength(0);
    // 반려는 된다
    const rej = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', {
      decision: 'reject',
      reason: '이미 무료를 받은 번호',
    });
    expect(rej.json.data.cert.status).toBe('rejected');
  });

  test('반려 — 사유 필수(1~300자), rejected + decision_reason, 올린 사람에게 알림 (사유는 알림에 없다)', async () => {
    let row;
    use({ mutate: (t) => (row = reviewRow(t)) });
    for (const reason of [undefined, '', '   ', '가'.repeat(301), 12]) {
      const r = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', {
        decision: 'reject',
        reason,
      });
      expect([r.status, r.json.code, r.json.field]).toEqual([422, 'invalid', 'reason']);
    }
    expect(row.status).toBe('review');
    const reason = '대표자 이름이 등록증과 다릅니다';
    const r = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', {
      decision: 'reject',
      reason: `  ${reason} `,
    });
    expect(r.status).toBe(200);
    expect(r.json.data.cert).toMatchObject({
      status: 'rejected',
      decision_reason: reason,
      decided_by: U.admin,
    });
    const msg = Msg.buildMessage('biz_cert_decided', { approved: false });
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({
      user_id: U.newbie,
      company_id: null,
      kind: 'biz_cert_decided',
      title: msg.title,
      body: msg.body,
      url: msg.url,
      dedupe_key: `biz_cert_decided:${row.id}:${U.newbie}:rejected`,
    });
    expect(outbox()[0].body).not.toContain(reason);
    // 올린 사람은 사유를 내 사업자등록증에서 본다 · 다시 올릴 수 있다
    const mine = await call('GET', '/partner/cert', 'newbie');
    expect(mine.json.data.cert).toMatchObject({ status: 'rejected', decision_reason: reason });
    expect((await upload('newbie')).status).toBe(201);
  });

  test('review 줄만 — 다른 상태 409 invalid_transition · 없는 줄 404 · 틀린 id · 동작 422', async () => {
    for (const status of ['uploaded', 'verified', 'rejected', 'superseded']) {
      let row;
      use({
        mutate: (t) =>
          (row = addCert(t, { status, ...(status === 'uploaded' ? {} : confirmedFields()) })),
      });
      const r = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', {
        decision: 'approve',
      });
      expect([r.status, r.json.code]).toEqual([409, 'invalid_transition']);
      expect(row.status).toBe(status);
    }
    let r = await call('POST', `/admin/partner/certs/${nodeCrypto.randomUUID()}`, 'admin', {
      decision: 'approve',
    });
    expect([r.status, r.json.code]).toEqual([404, 'not_found']);
    r = await call('POST', '/admin/partner/certs/not-a-uuid', 'admin', { decision: 'approve' });
    expect([r.status, r.json.code, r.json.field]).toEqual([422, 'invalid', 'id']);
    let row;
    use({ mutate: (t) => (row = reviewRow(t)) });
    for (const decision of [undefined, 'hold', 'verified']) {
      r = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', { decision });
      expect([r.status, r.json.code, r.json.field]).toEqual([422, 'invalid', 'decision']);
    }
    expect(outbox()).toHaveLength(0);
  });

  test('알림 넣기가 실패해도 처리는 그대로 된다', async () => {
    let row;
    use({ mutate: (t) => (row = reviewRow(t)), fail: { 'POST notification_outbox': 500 } });
    const r = await call('POST', `/admin/partner/certs/${row.id}`, 'admin', {
      decision: 'approve',
    });
    expect(r.status).toBe(200);
    expect(row.status).toBe('verified');
  });
});

// ── 5) 알림 글 · 0077 적용 전 · 로그 ───────────────────

describe('알림 글 · 준비 전 · 로그', () => {
  test('account-api 가 든 알림 글은 workflow-api messages.js 와 같다', () => {
    expect(Po.bizCertReviewMessage()).toEqual(Msg.buildMessage('biz_cert_review', {}));
    expect(Po.bizCertDecidedMessage({ approved: true })).toEqual(
      Msg.buildMessage('biz_cert_decided', { approved: true })
    );
    expect(Po.bizCertDecidedMessage({ approved: false })).toEqual(
      Msg.buildMessage('biz_cert_decided', { approved: false })
    );
    expect(Po.bizCertDecidedMessage({})).toBeNull();
    expect(Po.BIZ_CERT_REVIEW_URL).toBe('/segan/me.html#hq-biz-cert');
    for (const m of [
      Po.bizCertReviewMessage(),
      Po.bizCertDecidedMessage({ approved: true }),
      Po.bizCertDecidedMessage({ approved: false }),
    ])
      expect(Msg.isValidMessage(m)).toBe(true);
    // 0077 이 세 종류를 받는다 · 검토 결과만 업체 없이 넣는다
    expect(OUTBOX_KINDS.slice(-3)).toEqual(['trial_ending', 'biz_cert_review', 'biz_cert_decided']);
    expect(NO_COMPANY_KINDS).toContain('biz_cert_decided');
    expect(NO_COMPANY_KINDS).not.toContain('biz_cert_review');
  });

  test('0077 적용 전(표 없음) — 사업자등록증 길은 503 not_ready, 협력업체 길은 그대로 돈다', async () => {
    use({ missing: ['business_certificates', 'trial_grants'] });
    const tries = [
      () => call('GET', '/partner/cert', 'newbie'),
      () => upload('newbie'),
      () => confirm('newbie'),
      () => call('GET', '/admin/partner/certs', 'admin'),
      () =>
        call('POST', `/admin/partner/certs/${nodeCrypto.randomUUID()}`, 'admin', {
          decision: 'approve',
        }),
    ];
    for (const t of tries) {
      const r = await t();
      expect([r.status, r.json.code]).toEqual([503, 'not_ready']);
      expect(r.json.success).toBe(false);
    }
    expect(be.objects.size).toBe(0);
    // 다른 길 — 내 팩토리 · 없는 길
    const me = await call('GET', '/partner/me', 'partnerOwner');
    expect(me.status).toBe(200);
    expect(me.json.data.company.id).toBe(CO.partner);
    const res = await W.fetch(req('GET', '/nope', tok('newbie')), env);
    expect(res.status).toBe(404);
  });

  test('길 — 사업자등록증 길만 잡는다 (협력업체 길과 겹치지 않는다)', () => {
    expect(B.matchCertRoute('POST', '/partner/cert')).toMatchObject({ admin: false, raw: true });
    expect(B.matchCertRoute('GET', '/partner/cert')).toMatchObject({ admin: false, raw: false });
    expect(B.matchCertRoute('POST', '/partner/cert/confirm')).toMatchObject({ raw: false });
    expect(B.matchCertRoute('GET', '/admin/partner/certs')).toMatchObject({ admin: true });
    expect(B.matchCertRoute('POST', '/admin/partner/certs/abc')).toMatchObject({
      admin: true,
      params: { id: 'abc' },
    });
    for (const [m, p] of [
      ['GET', '/partner/me'],
      ['POST', '/partner/apply'],
      ['GET', '/admin/partner/applications'],
      ['GET', '/partner/cert/confirm'],
      ['POST', '/admin/partner/certs'],
      ['POST', '/admin/partner/certs/'],
      ['DELETE', '/partner/cert'],
    ])
      expect(B.matchCertRoute(m, p)).toBeNull();
    for (const [m, p] of [
      ['POST', '/partner/cert'],
      ['GET', '/partner/cert'],
      ['POST', '/partner/cert/confirm'],
      ['GET', '/admin/partner/certs'],
    ])
      expect(Pt.matchPartnerRoute(m, p)).toBeNull();
  });

  test('로그 — 사업자번호 · 대표자 · 상호 · 사진 경로 · 국세청 키를 남기지 않는다 (id · 상태 코드만)', async () => {
    // 올리기 → 확인(검토) → 본사 반려 → 다시 올리기 → 확인(통과), 그리고 실패 길 몇 가지
    use({ nts: { valid: '02' } });
    const up = await upload('newbie');
    await confirm('newbie');
    await call('GET', '/admin/partner/certs', 'admin');
    await call('POST', `/admin/partner/certs/${up.json.data.cert.id}`, 'admin', {
      decision: 'reject',
      reason: '김가짜 대표자 불일치',
    });
    const paths = certs().map((c) => c.storage_path);
    use({ nts: { status: 'throw' } });
    await upload('newbie', PHOTO, makeEnv({ ASSISTANT: fakeAssistant(new Error(`boom ${BIZ}`)) }));
    await confirm('newbie');
    use({ missing: ['business_certificates'] });
    await upload('newbie');
    use({ fail: { 'POST business_certificates': 500 } });
    await upload('newbie');

    const all = logs.join('\n');
    expect(all).toMatch(/\[cert\]/);
    for (const secret of [
      BIZ,
      BIZ_DASHED,
      ...Object.values(PII),
      NTS_KEY,
      'serviceKey',
      'api.odcloud.kr',
      ...paths,
      'newbie@example.test',
      '대표자 불일치',
    ])
      expect(all).not.toContain(secret);
  });

  test('국세청 도우미 — 검증 숫자 · 번호 다듬기 · 상태 줄 (workflow-api ledger 와 같은 셈)', () => {
    const W_CHECKS = read('workers/workflow-api/src/ledger/checks.js');
    expect(W_CHECKS).toContain('const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];');
    expect(read('workers/account-api/src/nts.js')).toContain(
      'const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];'
    );
    expect(N.bizNoValid(BIZ)).toBe(true);
    expect(N.bizNoValid(BIZ_DASHED)).toBe(false);
    expect(N.bizNoValid(`${BIZ.slice(0, 9)}${(Number(BIZ[9]) + 3) % 10}`)).toBe(false);
    expect(N.normalizeBizNo(BIZ_DASHED)).toBe(BIZ);
    expect(N.normalizeBizNo('  ')).toBeNull();
    expect(N.normalizeBizNo(null)).toBeNull();
    expect(N.ntsRow(BIZ, { b_stt_cd: '01', tax_type: ' 일반과세자 ' })).toEqual({
      biz_no: BIZ,
      status: 'active',
      tax_type: '일반과세자',
      closed_on: null,
    });
    expect(N.ntsRow(BIZ, { b_stt_cd: '03', end_dt: '20240131' })).toMatchObject({
      status: 'closed',
      closed_on: '2024-01-31',
    });
    expect(N.ntsRow(BIZ, { b_stt_cd: '' }).status).toBe('unregistered');
    // 진위확인 주석 — 실제 키로 확인하지 못했다는 점을 남겼다
    expect(read('workers/account-api/src/nts.js')).toMatch(/실제 키로 확인하지 못했다/);
  });
});
