/**
 * 협력업체 — 신청 · 업체 · 직원 초대 · 관리자 처리 (account-api).
 *
 * 표는 database/migrations/0011_partner_signup.sql (companies · company_members · partner_applications ·
 * company_invites · company_events). 쓰기는 모두 service_role REST 로 한다 — 신청 · 초대 표는 회원이 직접 쓰지 못한다.
 * 사용자 확인(verifyJwt) · 관리자 확인(is_admin, 사용자 토큰)은 worker.js 가 하고 여기에는 확인된 사람만 들어온다.
 *
 * 응답: 성공 { success: true, data }, 실패 { success: false, code, error } (error 는 한국어 한 문장).
 *   형식이 틀리면 422 invalid 에 field 를 더한다. 모든 응답에 Cache-Control: no-store, private.
 *   시각은 ISO 문자열(UTC)로 돌려준다.
 *
 * 지키는 것:
 *   - 한 사람은 한 업체에서만 active 구성원 (DB 유니크 — 동시 요청은 23505 로 막힌다)
 *   - 본사 구성원은 협력업체를 신청하거나 들어가지 못한다
 *   - 열린 신청(applied · meeting · 아직 안 쓴 approved)은 한 사람에 하나 (DB 유니크)
 *   - profiles.tier 는 쓰지 않는다 — 구성원 · 업체가 바뀌면 DB 트리거가 맞춘다
 *   - 초대 토큰은 발급 응답에서 한 번만 돌려주고 DB 에는 sha256 hex 만 둔다
 *   - company_events 에 이름 · 연락처 · 사업자번호 같은 개인정보를 넣지 않는다. 이력은 지울 수 없으므로
 *     모든 저장이 끝난 뒤 마지막에 넣고, 실패해도 처리를 되돌리지 않는다 (상태 코드만 로그)
 */
import { jsonResponse } from './cors.js';
import { UUID_RE } from './storage-purge.js';

/** 초대 링크 유효 기간 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
/** 32바이트 base64url (패딩 없음) = 43자 */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** DB CHECK 와 같다 (partner_applications_phone_check · partner_applications_bizno_check) */
export const PHONE_RE = /^[0-9][0-9-]{7,19}$/;
export const BIZNO_RE = /^[0-9]{3}-?[0-9]{2}-?[0-9]{5}$/;
/** in.(…) 한 번에 싣는 id 수 (URL 길이) */
const ID_CHUNK = 100;

export const APPLICATION_STATUSES = Object.freeze([
  'applied',
  'meeting',
  'approved',
  'held',
  'withdrawn',
]);
const LIVE_SUBSCRIPTION = ['active', 'past_due', 'trialing'];

/** 회원에게 돌려주는 신청 칸 */
const APP_FIELDS = [
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
/** 관리자에게 돌려주는 신청 칸 (전부) */
const APP_ALL_FIELDS = [
  'id',
  'user_id',
  'company_id',
  'kind',
  'plan',
  'status',
  'company_name',
  'representative_name',
  'contact_phone',
  'sido',
  'gugun',
  'business_number',
  'intro',
  'meeting_at',
  'decided_by',
  'decided_at',
  'used_at',
  'notified_at',
  'created_at',
  'updated_at',
];
const INVITE_FIELDS = ['id', 'role', 'created_at', 'expires_at', 'accepted_at', 'revoked_at'];
const COMPANY_COLS = 'id,kind,name,plan,next_plan,status,sido,gugun,created_at';
const TIME_FIELDS = new Set([
  'meeting_at',
  'decided_at',
  'used_at',
  'notified_at',
  'created_at',
  'updated_at',
  'expires_at',
  'accepted_at',
  'revoked_at',
]);

/** 형식이 틀린 칸마다 한 문장 */
const FIELD_ERRORS = Object.freeze({
  body: '요청 내용이 올바르지 않습니다.',
  company_name: '업체 이름을 1~100자로 적어 주세요.',
  name: '업체 이름을 1~100자로 적어 주세요.',
  representative_name: '대표자 이름을 1~50자로 적어 주세요.',
  contact_phone: '연락처는 숫자와 - 로 적어 주세요.',
  sido: '시·도를 골라 주세요.',
  gugun: '시·군·구를 골라 주세요.',
  business_number: '사업자등록번호 10자리를 숫자와 - 로 적어 주세요.',
  intro: '하는 일을 1~200자로 적어 주세요.',
  role: '역할은 실장 또는 직원 중에서 골라 주세요.',
  next_plan: '바꿀 등급이 올바르지 않습니다.',
  plan: '등급은 Expert 또는 Agent 중에서 골라 주세요.',
  user_id: '대상 회원이 올바르지 않습니다.',
  id: '대상이 올바르지 않습니다.',
  action: '처리할 동작이 올바르지 않습니다.',
  meeting_at: '미팅 날짜와 시각을 확인해 주세요.',
  status: '신청 상태 값이 올바르지 않습니다.',
});

const MSG = Object.freeze({
  hq_member: '본사 구성원은 협력업체를 신청하거나 들어갈 수 없습니다.',
  application_open: '이미 진행 중인 신청이 있습니다.',
  already_member: '이미 업체 구성원입니다.',
  not_owner: '업체 대표만 할 수 있습니다.',
  company_inactive: '업체가 활동 중이 아니어서 할 수 없습니다.',
  invalid_plan_change: '지금 등급에서는 그렇게 바꿀 수 없습니다.',
  invite_invalid: '초대 링크가 만료되었거나 더 이상 쓸 수 없습니다.',
  invalid_transition: '지금 신청 상태에서는 할 수 없는 처리입니다.',
  cannot_remove_self: '자기 자신은 내보낼 수 없습니다.',
  cannot_remove_owner: '다른 대표는 내보낼 수 없습니다.',
});

export class PartnerError extends Error {
  constructor(status, code, message, extra = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const fail = (status, code, message, extra) => new PartnerError(status, code, message, extra);
const invalid = (field) =>
  fail(422, 'invalid', FIELD_ERRORS[field] || FIELD_ERRORS.body, { field });

class DbError extends Error {
  constructor(method, status, code) {
    super(`${method} ${status}${code ? ` ${code}` : ''}`);
    this.status = status;
    this.code = code;
  }
}

/** service_role REST. 실패하면 DbError(상태 · PostgreSQL 코드) — 응답 본문은 남기지 않는다 */
async function db(env, method, path, body, { prefer = 'return=representation' } = {}) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method !== 'GET') headers.Prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new DbError(method, res.status, err && typeof err.code === 'string' ? err.code : null);
  }
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) ? rows : [];
}

const nowIso = () => new Date().toISOString();

/** DB 시각 → ISO(UTC). 없거나 읽을 수 없으면 null */
function iso(v) {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pick(row, fields) {
  const out = {};
  for (const f of fields) {
    const v = row ? row[f] : undefined;
    out[f] = TIME_FIELDS.has(f) ? iso(v) : v === undefined ? null : v;
  }
  return out;
}

const appView = (row) => pick(row, APP_FIELDS);
const appAllView = (row) => pick(row, APP_ALL_FIELDS);
const inviteView = (row) => pick(row, INVITE_FIELDS);

/** 회원 화면용 업체 (내 역할 포함) */
function companyView(c, role) {
  return {
    id: c.id,
    name: c.name,
    plan: c.plan ?? null,
    next_plan: c.next_plan ?? null,
    status: c.status,
    sido: c.sido ?? null,
    gugun: c.gugun ?? null,
    role,
    created_at: iso(c.created_at),
  };
}

/** 관리자 화면용 업체 */
function adminCompanyView(c) {
  return {
    id: c.id,
    name: c.name,
    plan: c.plan ?? null,
    next_plan: c.next_plan ?? null,
    status: c.status,
    sido: c.sido ?? null,
    gugun: c.gugun ?? null,
    created_at: iso(c.created_at),
  };
}

function memberView(m, profile) {
  return {
    user_id: m.user_id,
    name: (profile && profile.name) || null,
    email: (profile && profile.email) || null,
    role: m.role,
    status: m.status,
    joined_at: iso(m.created_at),
  };
}

const obj = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : {});
/** 글자 수 — DB length() 처럼 코드 포인트로 센다 */
const charLen = (s) => [...s].length;

/** 앞뒤 공백을 자른 1~max 자 글. 아니면 422 */
function text(v, field, max) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || charLen(s) > max) throw invalid(field);
  return s;
}

/** 앞뒤 공백을 자른 뒤 모양 검사. 아니면 422 */
function shaped(v, field, re) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!re.test(s)) throw invalid(field);
  return s;
}

function uuidParam(v, field) {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw invalid(field);
  return v.toLowerCase();
}

function chunks(list, size = ID_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** id → { name, email } (profiles) */
async function profilesById(env, ids) {
  const uniq = [...new Set(ids.filter((id) => typeof id === 'string' && UUID_RE.test(id)))];
  const map = new Map();
  for (const part of chunks(uniq)) {
    const rows = await db(env, 'GET', `profiles?id=in.(${part.join(',')})&select=id,name,email`);
    for (const r of rows) if (r && r.id) map.set(r.id, r);
  }
  return map;
}

// ── 구성원 · 신청 찾기 ─────────────────────────────────

/** 내가 active 구성원인 회사 (본사 포함). 한 사람은 한 곳에서만 active 다 */
async function activeMembership(env, userId) {
  const rows = await db(
    env,
    'GET',
    `company_members?user_id=eq.${userId}&status=eq.active&select=id,company_id,role,company:companies(${COMPANY_COLS})&limit=1`
  );
  const m = rows[0];
  if (!m) return null;
  return { id: m.id, role: m.role, company: m.company || null };
}

const isHq = (m) => !!(m && m.company && m.company.kind === 'hq');
const isPartner = (m) => !!(m && m.company && m.company.kind === 'partner');

/** 협력업체 대표만. 아니면 403 not_owner */
async function partnerOwner(env, userId) {
  const m = await activeMembership(env, userId);
  if (!isPartner(m) || m.role !== 'owner') throw fail(403, 'not_owner', MSG.not_owner);
  return m;
}

const isOpenApplication = (a) =>
  !!a &&
  (a.status === 'applied' || a.status === 'meeting' || (a.status === 'approved' && !a.used_at));

async function hasOpenApplication(env, userId) {
  const rows = await db(
    env,
    'GET',
    `partner_applications?user_id=eq.${userId}&status=in.(applied,meeting,approved)&select=id,status,used_at`
  );
  return rows.some(isOpenApplication);
}

/** 이력 한 줄 — 개인정보 없이. 지울 수 없으니 저장이 다 끝난 뒤 부른다. 실패해도 던지지 않는다 */
async function addEvent(env, row) {
  try {
    await db(env, 'POST', 'company_events', { payload: {}, ...row }, { prefer: 'return=minimal' });
  } catch (e) {
    console.warn('[partner] company_events:', row.type, e && e.status ? e.status : '?');
  }
}

// ── 토큰 ───────────────────────────────────────────────

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32바이트 랜덤 → 43자 base64url */
export function newInviteToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** sha256 hex (64자) — DB 에는 이것만 둔다 */
export async function hashInviteToken(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 쓸 수 있는 초대 (업체 포함). 없음 · 만료 · 취소 · 이미 수락 → 410 invite_invalid */
async function usableInvite(env, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token))
    throw fail(410, 'invite_invalid', MSG.invite_invalid);
  const hash = await hashInviteToken(token);
  const rows = await db(
    env,
    'GET',
    `company_invites?token_hash=eq.${hash}&select=id,company_id,role,expires_at,accepted_at,revoked_at,company:companies(id,kind,name,plan,status)&limit=1`
  );
  const inv = rows[0];
  const expires = inv ? Date.parse(inv.expires_at) : NaN;
  if (
    !inv ||
    inv.accepted_at ||
    inv.revoked_at ||
    !(expires > Date.now()) ||
    !inv.company ||
    inv.company.kind !== 'partner'
  ) {
    throw fail(410, 'invite_invalid', MSG.invite_invalid);
  }
  return inv;
}

// ── 회원 ───────────────────────────────────────────────

/** GET /partner/me */
async function getMe(env, { user }) {
  const [m, apps] = await Promise.all([
    activeMembership(env, user.id),
    db(
      env,
      'GET',
      `partner_applications?user_id=eq.${user.id}&select=${APP_FIELDS.join(',')}&order=created_at.desc&limit=1`
    ),
  ]);
  const data = {
    company: null,
    application: apps[0] ? appView(apps[0]) : null,
    members: [],
    invites: [],
  };
  if (isHq(m)) {
    data.hq_member = true;
    return { data };
  }
  if (!isPartner(m)) return { data };

  data.company = companyView(m.company, m.role);
  if (m.role !== 'owner') return { data };

  const cid = m.company.id;
  const [members, invites] = await Promise.all([
    db(
      env,
      'GET',
      `company_members?company_id=eq.${cid}&select=user_id,role,status,created_at&order=created_at.asc`
    ),
    db(
      env,
      'GET',
      `company_invites?company_id=eq.${cid}&select=${INVITE_FIELDS.join(',')}&order=created_at.desc`
    ),
  ]);
  const profiles = await profilesById(
    env,
    members.map((r) => r.user_id)
  );
  data.members = members.map((r) => memberView(r, profiles.get(r.user_id)));
  data.invites = invites.map(inviteView);
  return { data };
}

/** POST /partner/apply */
async function apply(env, { user, body }) {
  const m = await activeMembership(env, user.id);
  if (isHq(m)) throw fail(409, 'hq_member', MSG.hq_member);
  if (await hasOpenApplication(env, user.id))
    throw fail(409, 'application_open', MSG.application_open);

  let company = null;
  if (m) {
    const c = m.company;
    if (isPartner(m) && m.role === 'owner' && c.plan === 'expert' && c.status === 'active')
      company = c;
    else throw fail(409, 'already_member', MSG.already_member);
  }

  // Expert → Agent 신청은 업체 이름 · 지역을 업체 값으로 채운다 (보낸 값은 보지 않는다)
  const b = obj(body);
  const row = {
    user_id: user.id,
    company_id: company ? company.id : null,
    kind: company ? 'upgrade' : 'new',
    company_name: company ? company.name : text(b.company_name, 'company_name', 100),
    representative_name: text(b.representative_name, 'representative_name', 50),
    contact_phone: shaped(b.contact_phone, 'contact_phone', PHONE_RE),
    sido: company ? company.sido : text(b.sido, 'sido', 20),
    gugun: company ? company.gugun : text(b.gugun, 'gugun', 40),
    business_number: shaped(b.business_number, 'business_number', BIZNO_RE),
    intro: text(b.intro, 'intro', 200),
  };

  let saved;
  try {
    [saved] = await db(env, 'POST', `partner_applications?select=${APP_FIELDS.join(',')}`, row);
  } catch (e) {
    if (e instanceof DbError && e.code === '23505')
      throw fail(409, 'application_open', MSG.application_open);
    throw e;
  }
  if (!saved) throw new Error('apply: no row');

  if (company) {
    await addEvent(env, {
      company_id: company.id,
      actor_user_id: user.id,
      actor_kind: 'member',
      type: 'agent_applied',
    });
  }
  return { status: 201, data: { application: appView(saved) } };
}

/** POST /partner/apply/withdraw — 열린 신청(applied · meeting)을 거둔다 */
async function withdraw(env, { user }) {
  const rows = await db(
    env,
    'PATCH',
    `partner_applications?user_id=eq.${user.id}&status=in.(applied,meeting)&select=${APP_FIELDS.join(',')}`,
    { status: 'withdrawn' }
  );
  if (!rows.length) throw fail(404, 'not_found', '거둘 신청이 없습니다.');
  return { data: { application: appView(rows[0]) } };
}

/** POST /partner/plan — { next_plan: 'expert' | null }. 다음 결제일부터 바꿀 등급을 예약 · 취소한다 */
async function changePlan(env, { user, body }) {
  const b = obj(body);
  if (
    !Object.prototype.hasOwnProperty.call(b, 'next_plan') ||
    (b.next_plan !== 'expert' && b.next_plan !== null)
  ) {
    throw invalid('next_plan');
  }
  const m = await partnerOwner(env, user.id);
  const c = m.company;
  if (c.status !== 'active') throw fail(409, 'company_inactive', MSG.company_inactive);
  if (b.next_plan === 'expert' && c.plan !== 'agent')
    throw fail(409, 'invalid_plan_change', MSG.invalid_plan_change);

  const filter = `id=eq.${c.id}&kind=eq.partner&status=eq.active${b.next_plan === 'expert' ? '&plan=eq.agent' : ''}`;
  const rows = await db(env, 'PATCH', `companies?${filter}&select=${COMPANY_COLS}`, {
    next_plan: b.next_plan,
  });
  // 그사이 업체가 바뀌었다 (정지 · 등급 변경)
  if (!rows.length) throw fail(409, 'invalid_plan_change', MSG.invalid_plan_change);

  await addEvent(env, {
    company_id: c.id,
    actor_user_id: user.id,
    actor_kind: 'member',
    type: 'plan_change_requested',
    payload: { next_plan: b.next_plan },
  });
  return { data: { company: companyView(rows[0], m.role) } };
}

/** POST /partner/invites — { role }. 토큰은 이 응답에서 한 번만 돌려준다 */
async function createInvite(env, { user, body }) {
  const role = obj(body).role;
  if (role !== 'manager' && role !== 'staff') throw invalid('role');
  const m = await partnerOwner(env, user.id);
  if (m.company.status !== 'active') throw fail(409, 'company_inactive', MSG.company_inactive);

  const token = newInviteToken();
  const [saved] = await db(env, 'POST', 'company_invites?select=id,role,expires_at', {
    company_id: m.company.id,
    role,
    token_hash: await hashInviteToken(token),
    created_by: user.id,
    expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  });
  if (!saved) throw new Error('invite: no row');
  return {
    status: 201,
    data: { id: saved.id, role: saved.role, expires_at: iso(saved.expires_at), token },
  };
}

/** POST /partner/invites/:id/revoke — 대표가 자기 업체 초대를 거둔다. 이미 거뒀거나 수락된 초대는 그대로 돌려준다 */
async function revokeInvite(env, { user, params }) {
  const id = uuidParam(params.id, 'id');
  const m = await partnerOwner(env, user.id);
  const cid = m.company.id;
  const rows = await db(
    env,
    'PATCH',
    `company_invites?id=eq.${id}&company_id=eq.${cid}&revoked_at=is.null&accepted_at=is.null&select=${INVITE_FIELDS.join(',')}`,
    { revoked_at: nowIso() }
  );
  if (rows.length) return { data: { invite: inviteView(rows[0]) } };
  const cur = await db(
    env,
    'GET',
    `company_invites?id=eq.${id}&company_id=eq.${cid}&select=${INVITE_FIELDS.join(',')}`
  );
  if (!cur.length) throw fail(404, 'not_found', '초대를 찾을 수 없습니다.');
  return { data: { invite: inviteView(cur[0]) } };
}

/** POST /partner/invites/peek — { token }. 수락 전에 업체 이름 · 역할을 보여 준다 */
async function peekInvite(env, { body }) {
  const inv = await usableInvite(env, obj(body).token);
  return {
    data: { company_name: inv.company.name, role: inv.role, expires_at: iso(inv.expires_at) },
  };
}

/** POST /partner/invites/accept — { token } */
async function acceptInvite(env, { user, body }) {
  const inv = await usableInvite(env, obj(body).token);
  if (inv.company.status !== 'active') throw fail(409, 'company_inactive', MSG.company_inactive);
  if (await activeMembership(env, user.id)) throw fail(409, 'already_member', MSG.already_member);
  if (await hasOpenApplication(env, user.id))
    throw fail(409, 'application_open', MSG.application_open);

  let member;
  try {
    [member] = await db(env, 'POST', 'company_members?select=id', {
      company_id: inv.company_id,
      user_id: user.id,
      role: inv.role,
      status: 'active',
    });
  } catch (e) {
    if (e instanceof DbError && e.code === '23505')
      throw fail(409, 'already_member', MSG.already_member);
    throw e;
  }
  if (!member) throw new Error('accept: no row');

  // 한 번만 — 그사이 다른 사람이 수락했거나 거둬졌으면 넣은 구성원을 뺀다
  let claimed = [];
  let claimError = null;
  try {
    claimed = await db(
      env,
      'PATCH',
      `company_invites?id=eq.${inv.id}&accepted_at=is.null&revoked_at=is.null&expires_at=gt.${nowIso()}&select=id`,
      { accepted_by: user.id, accepted_at: nowIso() }
    );
  } catch (e) {
    claimError = e;
  }
  if (claimError || !claimed.length) {
    try {
      await db(env, 'DELETE', `company_members?id=eq.${member.id}`, undefined, {
        prefer: 'return=minimal',
      });
    } catch (e) {
      console.error('[partner] accept: member rollback failed', e && e.status ? e.status : '?');
    }
    if (claimError) throw claimError;
    throw fail(410, 'invite_invalid', MSG.invite_invalid);
  }

  await addEvent(env, {
    company_id: inv.company_id,
    actor_user_id: user.id,
    actor_kind: 'member',
    type: 'member_joined',
    subject_type: 'member',
    subject_id: member.id,
  });
  return {
    data: {
      company: { id: inv.company.id, name: inv.company.name, plan: inv.company.plan ?? null },
      role: inv.role,
    },
  };
}

/** POST /partner/members/:user_id/remove — 대표가 직원을 내보낸다. 자기 자신 · 다른 대표는 못 뺀다 */
async function removeMember(env, { user, params }) {
  const target = uuidParam(params.user_id, 'user_id');
  const m = await partnerOwner(env, user.id);
  if (target === String(user.id).toLowerCase())
    throw fail(409, 'cannot_remove', MSG.cannot_remove_self);

  const cid = m.company.id;
  const cols = 'id,user_id,role,status,created_at';
  const found = await db(
    env,
    'GET',
    `company_members?company_id=eq.${cid}&user_id=eq.${target}&status=eq.active&select=${cols}`
  );
  const t = found[0];
  if (!t) throw fail(404, 'not_found', '구성원을 찾을 수 없습니다.');
  if (t.role === 'owner') throw fail(409, 'cannot_remove', MSG.cannot_remove_owner);

  const rows = await db(
    env,
    'PATCH',
    `company_members?id=eq.${t.id}&status=eq.active&role=neq.owner&select=${cols}`,
    {
      status: 'removed',
    }
  );
  if (!rows.length) throw fail(404, 'not_found', '구성원을 찾을 수 없습니다.');

  await addEvent(env, {
    company_id: cid,
    actor_user_id: user.id,
    actor_kind: 'member',
    type: 'member_removed',
    subject_type: 'member',
    subject_id: t.id,
  });
  const profiles = await profilesById(env, [target]);
  return { data: { member: memberView(rows[0], profiles.get(target)) } };
}

// ── 관리자 ─────────────────────────────────────────────

/** GET /admin/partner/applications?status=applied,meeting — 최근 순, 신청 전체 칸 + 신청자 이메일 */
async function adminListApplications(env, { url }) {
  const raw = (url.searchParams.get('status') || '').trim();
  let filter = '';
  if (raw) {
    const list = [
      ...new Set(
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];
    if (!list.length || list.some((s) => !APPLICATION_STATUSES.includes(s)))
      throw invalid('status');
    filter = `&status=in.(${list.join(',')})`;
  }
  const rows = await db(
    env,
    'GET',
    `partner_applications?select=${APP_ALL_FIELDS.join(',')}&order=created_at.desc${filter}`
  );
  const profiles = await profilesById(
    env,
    rows.map((r) => r.user_id)
  );
  return {
    data: rows.map((r) => {
      const p = profiles.get(r.user_id);
      return { ...appAllView(r), email: (p && p.email) || null };
    }),
  };
}

/** meeting_at — ISO 날짜+시각 글만 */
function isoInput(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v.trim())) return null;
  return iso(v.trim());
}

/** POST /admin/partner/applications/:id — { action: meeting | approve | hold } */
async function adminDecide(env, { user, params, body }) {
  const id = uuidParam(params.id, 'id');
  const b = obj(body);
  const action = b.action;
  if (action !== 'meeting' && action !== 'approve' && action !== 'hold') throw invalid('action');
  const meetingAt = action === 'meeting' ? isoInput(b.meeting_at) : null;
  if (action === 'meeting' && !meetingAt) throw invalid('meeting_at');

  const cols = APP_ALL_FIELDS.join(',');
  const cur = (await db(env, 'GET', `partner_applications?id=eq.${id}&select=${cols}`))[0];
  if (!cur) throw fail(404, 'not_found', '신청을 찾을 수 없습니다.');
  if (cur.status !== 'applied' && cur.status !== 'meeting')
    throw fail(409, 'invalid_transition', MSG.invalid_transition);

  const now = nowIso();
  let patch;
  if (action === 'meeting') patch = { status: 'meeting', meeting_at: meetingAt };
  else if (action === 'hold') patch = { status: 'held', decided_by: user.id, decided_at: now };
  else patch = { status: 'approved', decided_by: user.id, decided_at: now };

  // Expert → Agent 승인: 업체 next_plan = agent (다음 결제일부터), 신청은 쓴 것으로
  let company = null;
  if (action === 'approve' && cur.kind === 'upgrade') {
    const cid =
      typeof cur.company_id === 'string' && UUID_RE.test(cur.company_id) ? cur.company_id : null;
    company = cid
      ? (await db(env, 'GET', `companies?id=eq.${cid}&select=${COMPANY_COLS}`))[0]
      : null;
    if (!company || company.kind !== 'partner' || company.status !== 'active') {
      throw fail(409, 'company_inactive', MSG.company_inactive);
    }
    if (company.plan !== 'expert') throw fail(409, 'invalid_plan_change', MSG.invalid_plan_change);
    const set = await db(
      env,
      'PATCH',
      `companies?id=eq.${company.id}&kind=eq.partner&status=eq.active&plan=eq.expert&select=id`,
      { next_plan: 'agent' }
    );
    if (!set.length) throw fail(409, 'invalid_plan_change', MSG.invalid_plan_change);
    patch.used_at = now;
  }

  let rows = [];
  let saveError = null;
  try {
    rows = await db(
      env,
      'PATCH',
      `partner_applications?id=eq.${id}&status=in.(applied,meeting)&select=${cols}`,
      patch
    );
  } catch (e) {
    saveError = e;
  }
  if (saveError || !rows.length) {
    // 업체에 넣은 예약을 되돌린다 (그사이 신청이 바뀌었다)
    if (company) {
      try {
        await db(
          env,
          'PATCH',
          `companies?id=eq.${company.id}&next_plan=eq.agent`,
          { next_plan: company.next_plan ?? null },
          { prefer: 'return=minimal' }
        );
      } catch (e) {
        console.error(
          '[partner] approve: next_plan rollback failed',
          e && e.status ? e.status : '?'
        );
      }
    }
    if (saveError) throw saveError;
    throw fail(409, 'invalid_transition', MSG.invalid_transition);
  }

  if (company) {
    await addEvent(env, {
      company_id: company.id,
      actor_user_id: user.id,
      actor_kind: 'admin',
      type: 'agent_approved',
    });
  }
  return { data: { application: appAllView(rows[0]) } };
}

/** GET /admin/partner/companies — 협력업체만, 최근 순 */
async function adminListCompanies(env) {
  const companies = await db(
    env,
    'GET',
    `companies?kind=eq.partner&select=${COMPANY_COLS}&order=created_at.desc`
  );
  const ids = companies.map((c) => c.id).filter((id) => typeof id === 'string' && UUID_RE.test(id));
  const members = [];
  const subs = [];
  for (const part of chunks(ids)) {
    const inList = part.join(',');
    const [m, s] = await Promise.all([
      db(
        env,
        'GET',
        `company_members?company_id=in.(${inList})&status=eq.active&select=company_id,user_id,role,created_at&order=created_at.asc`
      ),
      db(
        env,
        'GET',
        `subscriptions?company_id=in.(${inList})&select=company_id,status,next_charge_at,amount_krw,created_at&order=created_at.desc`
      ),
    ]);
    members.push(...m);
    subs.push(...s);
  }
  const owners = new Map();
  const counts = new Map();
  for (const r of members) {
    counts.set(r.company_id, (counts.get(r.company_id) || 0) + 1);
    if (r.role === 'owner' && !owners.has(r.company_id)) owners.set(r.company_id, r.user_id);
  }
  // 살아 있는 구독(업체에 하나)이 있으면 그것, 없으면 가장 최근 것
  const subOf = new Map();
  for (const s of subs) {
    const prev = subOf.get(s.company_id);
    if (!prev || (!LIVE_SUBSCRIPTION.includes(prev.status) && LIVE_SUBSCRIPTION.includes(s.status)))
      subOf.set(s.company_id, s);
  }
  const profiles = await profilesById(env, [...owners.values()]);
  return {
    data: companies.map((c) => {
      const owner = profiles.get(owners.get(c.id));
      const s = subOf.get(c.id);
      return {
        ...adminCompanyView(c),
        owner_email: (owner && owner.email) || null,
        member_count: counts.get(c.id) || 0,
        subscription: s
          ? {
              status: s.status,
              next_charge_at: iso(s.next_charge_at),
              amount_krw: s.amount_krw ?? null,
            }
          : null,
      };
    }),
  };
}

/** POST /admin/partner/companies — 「업체로 만들기」 { user_id, name, plan, sido, gugun }. 구독 없이 만든다 */
async function adminCreateCompany(env, { user, body }) {
  const b = obj(body);
  const target = uuidParam(b.user_id, 'user_id');
  const name = text(b.name, 'name', 100);
  const plan = b.plan;
  if (plan !== 'expert' && plan !== 'agent') throw invalid('plan');
  const sido = text(b.sido, 'sido', 20);
  const gugun = text(b.gugun, 'gugun', 40);

  const profile = await db(env, 'GET', `profiles?id=eq.${target}&select=id`);
  if (!profile.length) throw fail(404, 'not_found', '회원을 찾을 수 없습니다.');
  if (await activeMembership(env, target)) throw fail(409, 'already_member', MSG.already_member);

  const [company] = await db(env, 'POST', `companies?select=${COMPANY_COLS}`, {
    kind: 'partner',
    name,
    plan,
    status: 'active',
    sido,
    gugun,
    created_by: user.id,
  });
  if (!company) throw new Error('company: no row');

  try {
    await db(
      env,
      'POST',
      'company_members',
      { company_id: company.id, user_id: target, role: 'owner', status: 'active' },
      { prefer: 'return=minimal' }
    );
  } catch (e) {
    // 구성원을 못 넣으면 만든 업체를 지운다 (아직 이력 · 구성원이 없다)
    try {
      await db(env, 'DELETE', `companies?id=eq.${company.id}`, undefined, {
        prefer: 'return=minimal',
      });
    } catch (e2) {
      console.error('[partner] create company: rollback failed', e2 && e2.status ? e2.status : '?');
    }
    if (e instanceof DbError && e.code === '23505')
      throw fail(409, 'already_member', MSG.already_member);
    if (e instanceof DbError && e.code === '23503')
      throw fail(404, 'not_found', '회원을 찾을 수 없습니다.');
    throw e;
  }

  await addEvent(env, {
    company_id: company.id,
    actor_user_id: user.id,
    actor_kind: 'admin',
    type: 'company_created',
    payload: { by: 'admin' },
  });
  return { status: 201, data: { company: adminCompanyView(company) } };
}

// ── 길 ─────────────────────────────────────────────────

const ROUTES = [
  { method: 'GET', path: '/partner/me', run: getMe },
  { method: 'POST', path: '/partner/apply', run: apply },
  { method: 'POST', path: '/partner/apply/withdraw', run: withdraw },
  { method: 'POST', path: '/partner/plan', run: changePlan },
  { method: 'POST', path: '/partner/invites', run: createInvite },
  { method: 'POST', path: '/partner/invites/peek', run: peekInvite },
  { method: 'POST', path: '/partner/invites/accept', run: acceptInvite },
  { method: 'POST', path: '/partner/invites/:id/revoke', run: revokeInvite },
  { method: 'POST', path: '/partner/members/:user_id/remove', run: removeMember },
  { method: 'GET', path: '/admin/partner/applications', admin: true, run: adminListApplications },
  { method: 'POST', path: '/admin/partner/applications/:id', admin: true, run: adminDecide },
  { method: 'GET', path: '/admin/partner/companies', admin: true, run: adminListCompanies },
  { method: 'POST', path: '/admin/partner/companies', admin: true, run: adminCreateCompany },
].map((r) => ({ ...r, parts: r.path.split('/') }));

/**
 * 요청에 맞는 길. 없으면 null.
 * @returns {{ run: Function, admin: boolean, params: object } | null}
 */
export function matchPartnerRoute(method, pathname) {
  const parts = String(pathname || '').split('/');
  for (const r of ROUTES) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const want = r.parts[i];
      if (want.startsWith(':')) {
        if (!parts[i]) {
          ok = false;
          break;
        }
        params[want.slice(1)] = decodeURIComponent(parts[i]);
      } else if (want !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { run: r.run, admin: !!r.admin, params };
  }
  return null;
}

/** JSON + Cache-Control: no-store, private */
export function partnerResponse(request, env, body, status = 200) {
  const res = jsonResponse(request, env, body, status);
  res.headers.set('Cache-Control', 'no-store, private');
  return res;
}

/**
 * 확인된 사람(user)으로 길을 돌린다. 던지지 않는다.
 * @param {{ run: Function, params: object }} route  matchPartnerRoute 결과
 * @param {{ user: {id: string, email?: string}, url: URL }} ctx
 */
export async function runPartnerRoute(request, env, route, { user, url }) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return partnerResponse(
      request,
      env,
      { success: false, code: 'not_configured', error: '서버 설정이 필요합니다.' },
      503
    );
  }
  if (!user || typeof user.id !== 'string' || !UUID_RE.test(user.id)) {
    return partnerResponse(
      request,
      env,
      { success: false, code: 'unauthorized', error: '로그인이 필요합니다' },
      401
    );
  }
  try {
    const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
    const out = await route.run(env, {
      user: { id: user.id.toLowerCase(), email: user.email },
      params: route.params,
      body,
      url,
    });
    return partnerResponse(request, env, { success: true, data: out.data }, out.status || 200);
  } catch (e) {
    if (e instanceof PartnerError) {
      return partnerResponse(
        request,
        env,
        { success: false, code: e.code, error: e.message, ...(e.extra || {}) },
        e.status
      );
    }
    console.error('[partner] error:', e && e.message ? e.message : '?');
    return partnerResponse(
      request,
      env,
      { success: false, code: 'server_error', error: '처리 중 오류가 발생했습니다.' },
      500
    );
  }
}
