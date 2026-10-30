/**
 * 업체 쪽 상담 — 배정받은 상담 받기 · 못 받음, 상담 설정, 내 점수.
 * 업체 풀(협력업체 · 다담 공장)의 구성원 모두 같은 길을 쓴다. 목록 · 설정 응답의 can_act 는 대표 · 실장인지.
 *
 *   GET  /company/consults                 내 업체 상담 목록 (active 구성원)
 *   POST /company/consults/:id/accept      받기 (대표 · 실장) → { customer_id, project_id }
 *   POST /company/consults/:id/decline     못 받음 { reason } (대표 · 실장) → 204
 *   GET  /company/service-settings         상담 설정 읽기 (구성원)
 *   PUT  /company/service-settings         상담 설정 고치기 (대표 · 실장)
 *   GET  /company/my-score                 등급 · 고객 만족(0~5) · 응답률(0~1) (대표 · 실장)
 *   1분 cron                               24시간 지난 기다리는 배정 → 무응답(expired), 못 받음과 같게 되돌린다
 *
 * 받기 — 본사 상담 확정(projects.js acceptConsultation)과 같은 방식으로, 이 업체 company 로:
 *   고객  원래 상담(본사)이 회원 상담이면 { 업체, user_id, 이름, 연락처 } 고객 행 (있으면 그 행), 비회원이면 이름 · 연락처로 새 고객
 *         업체 장부라 이름 · 연락처를 베낀다 — 회원이 탈퇴해도 업체 고객 줄은 남고 user_id 만 비기 때문 (account-api withdrawal.js)
 *   프로젝트  업체 · 그 고객으로 새로 (제목은 사본 제목)
 *   배정 기록 accepted (기다리는 배정일 때만 — 그사이 무응답 처리됐으면 만든 행을 지우고 409)
 *   사본  고객 · 프로젝트를 잇고 status confirmed
 * 못 받음 · 무응답 — 배정 기록 declined · expired, 사본 status returned + 이름 · 전화 · 이메일 지움,
 *   본사 상담은 다시 pending (다음 순위).
 *
 * 연출컷 — 사본에 연출컷을 잇지 않는다 (표 권한이 생기지 않게). 목록이 원래 상담 연출컷 첫 장의 짧은 서명 주소를
 *   싣는다 (돌려보낸 상담은 싣지 않는다).
 */

import {
  ConflictError,
  DbError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  MONEY_ROLES,
  activeMemberships,
  insertOne,
  insertOneIgnoreConflict,
  restDelete,
  selectMany,
  selectOne,
  updateBy,
  upsertOne,
} from '../supabase.js';
import { createSignedUrls } from '../storage.js';
import { ASSIGNMENT_TTL_HOURS } from './rules.js';
import { companyMetrics } from './score.js';
import { loadStats, SETTINGS_COLUMNS } from './data.js';
import { emptySettings, parseServiceSettings } from './catalog.js';
import { expiresAt, quoteTotal } from './admin.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const HOUR_MS = 3600 * 1000;

/** 목록 한 번에 */
export const COMPANY_CONSULTS_LIMIT = 200;
/** 연출컷 서명 주소 수명 (초) */
export const RENDER_URL_TTL_SEC = 3600;
/** cron 한 번에 되돌리는 배정 수 — 남으면 다음 1분 */
export const EXPIRE_BATCH = 50;
/** 못 받음 사유 글자 수 (DB consult_assignments_reason_check) */
export const REASON_MAX = 500;

const COPY_COLUMNS =
  'id,company_id,origin_consultation_id,customer_id,project_id,created_at,status,name,phone,email,sido,gugun,' +
  'furniture_categories,door_finish,demolition_needed,wanted_price_tier,preferred_date,preferred_time,wanted_done_date,' +
  'description,' +
  'request_detail_design,quote,title';

function conflict(message, code, details = null) {
  const err = new ConflictError(message, details);
  err.code = code;
  return err;
}

/**
 * 호출자의 업체 — active 구성원인 업체 (한 사람은 한 업체에만 active). 협력업체 · 다담 공장 모두 같다 (업체 풀).
 * manage 면 대표 · 실장이어야 한다. canAct: 받기 · 못 받음 · 설정 고치기를 할 수 있나 (대표 · 실장).
 * @returns {Promise<{ companyId: string, role: string, canAct: boolean }>}
 */
export async function companyOf(env, user, { manage = false } = {}) {
  const memberships = await activeMemberships(env, user);
  const m = memberships[0];
  if (!m) throw new ForbiddenError('업체 구성원만 볼 수 있습니다', 'not_member');
  const canAct = MONEY_ROLES.includes(m.role);
  if (manage && !canAct)
    throw new ForbiddenError('업체 대표 · 실장만 할 수 있습니다', 'not_manager');
  return { companyId: m.company_id, role: m.role, canAct };
}

// ── 목록 ──────────────────────────────────────────────────────

/** 연출컷 첫 장 → { bucket, path } (path 가 없으면 저장된 Storage 주소에서 꺼낸다) */
const OBJECT_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;
export function renderRef(images, defaultBucket) {
  const first = Array.isArray(images) ? images[0] : null;
  if (!first || typeof first !== 'object') return null;
  if (
    typeof first.path === 'string' &&
    first.path &&
    !first.path.startsWith('/') &&
    !first.path.split('/').includes('..')
  ) {
    return { bucket: defaultBucket, path: first.path };
  }
  const m = typeof first.url === 'string' ? OBJECT_URL_RE.exec(first.url) : null;
  if (!m) return null;
  try {
    return {
      bucket: decodeURIComponent(m[1]),
      path: m[2].split('/').map(decodeURIComponent).join('/'),
    };
  } catch {
    return null;
  }
}

/** 사본 id → 서명 주소 (원래 상담의 연출컷 첫 장). 서명을 못 하면 빈 칸 */
async function renderUrls(env, copies) {
  const out = new Map();
  const live = copies.filter((c) => c.status !== 'returned' && isUuid(c.origin_consultation_id));
  if (!live.length) return out;
  try {
    const origins =
      (await selectMany(env, 'consultations', {
        id: `in.(${[...new Set(live.map((c) => c.origin_consultation_id))].join(',')})`,
        select: 'id,generation_id',
      })) || [];
    const genOf = new Map(
      origins.filter((o) => o.generation_id).map((o) => [o.id, o.generation_id])
    );
    if (!genOf.size) return out;
    const gens =
      (await selectMany(env, 'generations', {
        id: `in.(${[...new Set(genOf.values())].join(',')})`,
        select: 'id,images',
      })) || [];
    const bucketDefault = env.GENERATIONS_BUCKET || 'generations';
    const refOf = new Map(
      gens.map((g) => [g.id, renderRef(g.images, bucketDefault)]).filter(([, r]) => r)
    );
    const byBucket = new Map();
    for (const ref of refOf.values()) {
      if (!byBucket.has(ref.bucket)) byBucket.set(ref.bucket, []);
      byBucket.get(ref.bucket).push(ref.path);
    }
    const signed = new Map();
    for (const [bucket, paths] of byBucket) {
      const urls = await createSignedUrls(env, bucket, paths, RENDER_URL_TTL_SEC);
      for (const [path, url] of urls) signed.set(`${bucket}/${path}`, url);
    }
    for (const c of live) {
      const ref = refOf.get(genOf.get(c.origin_consultation_id));
      const url = ref ? signed.get(`${ref.bucket}/${ref.path}`) : null;
      if (url) out.set(c.id, url);
    }
  } catch (err) {
    console.warn(
      '[company-consults] 연출컷 서명 실패 — 연출컷 없이 보냅니다:',
      err && err.statusCode ? err.statusCode : 'error'
    );
  }
  return out;
}

/** GET /company/consults — can_act: 받기 · 못 받음을 할 수 있나 (대표 · 실장) */
export async function listCompanyConsults(env, { user }) {
  const { companyId, canAct } = await companyOf(env, user);
  const rows =
    (await selectMany(env, 'consultations', {
      company_id: `eq.${companyId}`,
      select: COPY_COLUMNS,
      order: 'created_at.desc',
      limit: String(COMPANY_CONSULTS_LIMIT),
    })) || [];
  if (!rows.length) return { can_act: canAct, items: [] };
  const assignments =
    (await selectMany(env, 'consult_assignments', {
      company_id: `eq.${companyId}`,
      copy_consultation_id: `in.(${rows.map((r) => r.id).join(',')})`,
      select: 'id,copy_consultation_id,state,assigned_at',
      order: 'assigned_at.desc',
    })) || [];
  const assignmentOf = new Map();
  for (const a of assignments)
    if (!assignmentOf.has(a.copy_consultation_id)) assignmentOf.set(a.copy_consultation_id, a);
  const urls = await renderUrls(env, rows);

  return {
    can_act: canAct,
    items: rows.map((r) => {
      const returned = r.status === 'returned';
      const a = assignmentOf.get(r.id) || null;
      return {
        id: r.id,
        created_at: r.created_at,
        status: r.status,
        // 돌려보낸 상담은 연락처 없이 (DB 에서도 지웠다)
        name: returned ? null : r.name || null,
        phone: returned ? null : r.phone || null,
        email: returned ? null : r.email || null,
        sido: r.sido,
        gugun: r.gugun,
        furniture_categories: r.furniture_categories || [],
        door_finish: r.door_finish ?? null,
        demolition_needed: r.demolition_needed ?? null,
        wanted_price_tier: r.wanted_price_tier ?? null,
        preferred_date: r.preferred_date,
        preferred_time: r.preferred_time,
        wanted_done_date: r.wanted_done_date ?? null,
        description: r.description ?? null,
        request_detail_design: r.request_detail_design === true,
        quote_total: quoteTotal(r.quote),
        project_id: r.project_id ?? null,
        generation_image_url: urls.get(r.id) || null,
        assignment: a
          ? {
              id: a.id,
              state: a.state,
              assigned_at: a.assigned_at,
              expires_at: expiresAt(a.assigned_at),
            }
          : null,
      };
    }),
  };
}

// ── 받기 · 못 받음 ─────────────────────────────────────────────

/** 내 업체 사본과 그 배정 — 없으면 404, 배정이 없는 상담은 409 no_assignment */
async function loadCopyWithAssignment(env, companyId, consultationId) {
  if (!isUuid(consultationId)) throw new NotFoundError('상담을 찾을 수 없습니다');
  const copy = await selectOne(env, 'consultations', {
    id: `eq.${consultationId}`,
    company_id: `eq.${companyId}`,
    select: 'id,company_id,origin_consultation_id,customer_id,project_id,status,name,phone,title',
  });
  if (!copy) throw new NotFoundError('상담을 찾을 수 없습니다');
  const assignment = await selectOne(env, 'consult_assignments', {
    copy_consultation_id: `eq.${copy.id}`,
    company_id: `eq.${companyId}`,
    select: 'id,consultation_id,company_id,copy_consultation_id,state,assigned_at',
    order: 'assigned_at.desc',
  });
  if (!assignment) throw conflict('배정받은 상담이 아닙니다', 'no_assignment');
  return { copy, assignment };
}

function assertOpen(assignment, nowMs) {
  if (assignment.state !== 'assigned')
    throw conflict('이미 답한 상담입니다', 'not_open', { state: assignment.state });
  if (Date.parse(assignment.assigned_at) + ASSIGNMENT_TTL_HOURS * HOUR_MS <= nowMs) {
    throw conflict('답할 시간(24시간)이 지났습니다', 'expired');
  }
}

/** 받기 — 고객 행 → { id, created, owned } (owned: 이번에 만들었고 다른 요청이 찾아 쓸 수 없는 행) */
async function resolveCompanyCustomer(env, companyId, copy, originUserId) {
  if (copy.customer_id) return { id: copy.customer_id, created: false, owned: false };
  if (originUserId) {
    const find = () =>
      selectOne(env, 'customers', {
        company_id: `eq.${companyId}`,
        user_id: `eq.${originUserId}`,
        select: 'id',
      });
    const found = await find();
    if (found) return { id: found.id, created: false, owned: false };
    const inserted = await insertOneIgnoreConflict(env, 'customers', {
      company_id: companyId,
      user_id: originUserId,
      name: copy.name || null,
      phone: copy.phone || null,
    });
    if (inserted) return { id: inserted.id, created: true, owned: false };
    const again = await find();
    if (!again) throw new DbError('업체 고객 행을 만들지 못했습니다');
    return { id: again.id, created: false, owned: false };
  }
  const row = await insertOne(env, 'customers', {
    company_id: companyId,
    name: copy.name,
    phone: copy.phone || null,
  });
  if (!row || !row.id) throw new DbError('고객 행을 만들지 못했습니다');
  return { id: row.id, created: true, owned: true };
}

/** POST /company/consults/:id/accept */
export async function acceptCompanyConsult(env, { user, consultationId, nowMs = Date.now() }) {
  const { companyId } = await companyOf(env, user, { manage: true });
  const { copy, assignment } = await loadCopyWithAssignment(env, companyId, consultationId);
  // 두 번 눌러도 같은 답 — 이미 받은 상담은 이어진 고객 · 프로젝트를 그대로
  if (assignment.state === 'accepted' && copy.customer_id && copy.project_id) {
    return { customer_id: copy.customer_id, project_id: copy.project_id };
  }
  assertOpen(assignment, nowMs);

  const origin = await selectOne(env, 'consultations', {
    id: `eq.${assignment.consultation_id}`,
    select: 'id,user_id',
  });
  const customer = await resolveCompanyCustomer(
    env,
    companyId,
    copy,
    origin ? origin.user_id : null
  );
  let createdProject = null;
  // 이번에 만든 행만 지운다 (회원 고객 행은 그 계정의 업체 고객이라 둔다)
  const undo = async () => {
    if (createdProject) await restDelete(env, 'projects', { id: `eq.${createdProject}` });
    if (customer.owned) await restDelete(env, 'customers', { id: `eq.${customer.id}` });
  };
  let projectId = copy.project_id;
  if (!projectId) {
    const row = await insertOne(env, 'projects', {
      company_id: companyId,
      customer_id: customer.id,
      title: copy.title,
      status: 'active',
    }).catch(async (err) => {
      await undo();
      throw err;
    });
    if (!row || !row.id) {
      await undo();
      throw new DbError('프로젝트를 만들지 못했습니다');
    }
    createdProject = row.id;
    projectId = row.id;
  }

  const nowIso = new Date(nowMs).toISOString();
  // 기다리는 배정일 때만 — 그사이 무응답 처리 · 못 받음이 됐으면 0행
  const taken = await updateBy(
    env,
    'consult_assignments',
    { id: `eq.${assignment.id}`, state: 'eq.assigned', select: 'id' },
    { state: 'accepted', responded_at: nowIso, responded_by: user.id }
  );
  if (!taken || !taken.length) {
    await undo();
    throw conflict('그사이 상담이 바뀌었습니다. 목록을 다시 불러오세요', 'not_open');
  }
  await updateBy(
    env,
    'consultations',
    { id: `eq.${copy.id}`, company_id: `eq.${companyId}`, select: 'id' },
    { customer_id: customer.id, project_id: projectId, status: 'confirmed', updated_at: nowIso }
  );
  return { customer_id: customer.id, project_id: projectId };
}

/**
 * 배정을 업체에서 거둔다 — 못 받음(declined) · 무응답(expired). 기다리는 배정일 때만 (아니면 false).
 *   사본 status returned + 이름 · 전화 · 이메일 지움 (이름 · 이메일 칸은 비울 수 없어 빈 글)
 *   본사 상담 assigned → pending
 */
export async function returnAssignment(
  env,
  assignment,
  { state, by = null, reason = null, nowIso }
) {
  const done = await updateBy(
    env,
    'consult_assignments',
    { id: `eq.${assignment.id}`, state: 'eq.assigned', select: 'id' },
    { state, responded_at: nowIso, responded_by: by, reason }
  );
  if (!done || !done.length) return false;
  if (isUuid(assignment.copy_consultation_id)) {
    await updateBy(
      env,
      'consultations',
      { id: `eq.${assignment.copy_consultation_id}`, select: 'id' },
      { status: 'returned', name: '', phone: null, email: '', updated_at: nowIso }
    );
  }
  await updateBy(
    env,
    'consultations',
    { id: `eq.${assignment.consultation_id}`, status: 'eq.assigned', select: 'id' },
    { status: 'pending', updated_at: nowIso }
  );
  return true;
}

function parseReason(body) {
  const raw = body && body.reason;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new ValidationError('reason 은 글이어야 합니다');
  const reason = raw.trim();
  if (reason.length > REASON_MAX) throw new ValidationError(`reason 은 ${REASON_MAX}자까지입니다`);
  return reason || null;
}

/** POST /company/consults/:id/decline */
export async function declineCompanyConsult(
  env,
  { user, consultationId, body, nowMs = Date.now() }
) {
  const { companyId } = await companyOf(env, user, { manage: true });
  const reason = parseReason(body);
  const { assignment } = await loadCopyWithAssignment(env, companyId, consultationId);
  if (assignment.state !== 'assigned')
    throw conflict('이미 답한 상담입니다', 'not_open', { state: assignment.state });
  const ok = await returnAssignment(env, assignment, {
    state: 'declined',
    by: user.id,
    reason,
    nowIso: new Date(nowMs).toISOString(),
  });
  if (!ok) throw conflict('그사이 상담이 바뀌었습니다. 목록을 다시 불러오세요', 'not_open');
}

/** 1분 cron — 24시간 지난 기다리는 배정을 무응답으로 되돌린다 */
export async function runAssignmentExpiry(env, { nowMs = Date.now(), limit = EXPIRE_BATCH } = {}) {
  const cutoff = new Date(nowMs - ASSIGNMENT_TTL_HOURS * HOUR_MS).toISOString();
  const rows =
    (await selectMany(env, 'consult_assignments', {
      state: 'eq.assigned',
      assigned_at: `lte.${cutoff}`,
      select: 'id,consultation_id,company_id,copy_consultation_id,assigned_at',
      order: 'assigned_at.asc',
      limit: String(limit),
    })) || [];
  const nowIso = new Date(nowMs).toISOString();
  let expired = 0;
  let failed = 0;
  for (const a of rows) {
    try {
      if (await returnAssignment(env, a, { state: 'expired', nowIso })) expired += 1;
    } catch (err) {
      failed += 1;
      console.error('assignment expiry failed:', err && err.statusCode ? err.statusCode : 'error');
    }
  }
  return { expired, failed };
}

// ── 상담 설정 · 내 점수 ─────────────────────────────────────────

/** GET /company/service-settings — can_act: 고칠 수 있나 (대표 · 실장) */
export async function getServiceSettings(env, { user }) {
  const { companyId, canAct } = await companyOf(env, user);
  const row = await selectOne(env, 'company_service_settings', {
    company_id: `eq.${companyId}`,
    select: SETTINGS_COLUMNS,
  });
  const s = row || emptySettings();
  return {
    can_act: canAct,
    regions: s.regions || [],
    items: s.items || {},
    monthly_limit: s.monthly_limit ?? null,
    lead_days: s.lead_days ?? null,
    updated_at: s.updated_at ?? null,
  };
}

/** PUT /company/service-settings */
export async function putServiceSettings(env, { user, body, nowMs = Date.now() }) {
  const { companyId } = await companyOf(env, user, { manage: true });
  const fields = parseServiceSettings(body);
  const row = await upsertOne(
    env,
    'company_service_settings',
    {
      company_id: companyId,
      ...fields,
      updated_by: user.id,
      updated_at: new Date(nowMs).toISOString(),
    },
    'company_id'
  );
  if (!row) throw new DbError('상담 설정을 저장하지 못했습니다');
  return {
    can_act: true,
    regions: row.regions,
    items: row.items,
    monthly_limit: row.monthly_limit ?? null,
    lead_days: row.lead_days ?? null,
    updated_at: row.updated_at ?? null,
  };
}

/** GET /company/my-score — 등급 · 고객 만족(0~5, 소수 한 자리) · 응답률(0~1, 소수 둘째 자리). 자료가 없으면 null */
export async function myScore(env, { user, nowMs = Date.now() }) {
  const { companyId } = await companyOf(env, user, { manage: true });
  const [evaluation, statsBy] = await Promise.all([
    selectOne(env, 'company_evaluations', { company_id: `eq.${companyId}`, select: 'grade' }),
    loadStats(env, [companyId], { nowMs, withItems: false }),
  ]);
  const m = companyMetrics(statsBy.get(companyId));
  return {
    grade: evaluation ? (evaluation.grade ?? null) : null,
    satisfaction: m.satisfaction,
    response_rate: m.response_rate,
  };
}
