/**
 * 다담 본사 상담 분배 — 관리자(is_admin) 화면의 서버.
 *
 *   GET  /admin/consult-inbox?state=pending|assigned|all   본사 상담 목록 + 지금 배정 · 거쳐 간 업체
 *   GET  /admin/consultations/:id/candidates               1~3순위(점수 내역) + 걸러진 업체와 이유
 *   POST /admin/consultations/:id/assign { company_id }    거르기 다시 확인 → 업체 사본 → 배정 기록 → 앱 알림
 *   GET  /admin/companies?pool=1                           업체 목록 (등급 · 서류 · 상담 설정 여부)
 *   GET  /admin/companies/:id/evaluation                   평가표 + 항목 목록 + 이력
 *   PUT  /admin/companies/:id/evaluation                   평가표 저장 (목록 밖 키는 422)
 *
 * 배정 (assignConsultation)
 *   1) 본사 상담이고 대기(pending)여야 한다. 기다리는 배정이 있으면 409 open_assignment.
 *   2) 순위를 다시 계산해 그 업체가 거르기를 통과하는지 본다 — 아니면 422 not_eligible (details.reasons).
 *   3) 본사 상담을 pending → assigned 로 (읽은 그대로일 때만 — 동시에 두 배정이 나가지 않게).
 *   4) 업체 company_id 로 상담 사본을 넣는다 (origin_consultation_id = 본사 상담). 넘기는 칸은 COPY_FIELDS 뿐 —
 *      관리자 메모 · 담당자 · 본사 내부 칸 · 동의 기록 · 회원 id 는 넘기지 않는다. 품목은 고객 품목 키로 채운다.
 *      연출컷은 사본에 잇지 않는다 (표 권한이 생기지 않게) — 업체 화면이 원래 연출컷의 짧은 서명 주소를 받는다.
 *   5) 배정 기록(consult_assignments)에 순위 · 총점 · 점수 내역을 남긴다.
 *   6) 응답 뒤에 그 업체 대표 · 실장에게 앱 알림 consult_assigned (품목 · 시/군/구만).
 *   중간에 실패하면 사본을 지우고 본사 상담을 대기로 되돌린다.
 */

import {
  ConflictError,
  DbError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  insertOne,
  restDelete,
  selectMany,
  selectOne,
  updateBy,
  upsertOne,
  platformCompanyId,
} from '../supabase.js';
import { isAdmin } from '../reports/admin.js';
import { FURNITURE_LABELS } from '../consult-notify.js';
import { buildMessage } from '../push/messages.js';
import { notifyRoles } from '../push/outbox.js';
import { RULES_VERSION, TOP_N, ASSIGNMENT_TTL_HOURS, REQUIRE_MONTHLY_LIMIT } from './rules.js';
import { customerItems, rankCandidates, candidateView, isPoolCompany } from './score.js';
import {
  loadCompanies,
  loadSettings,
  loadEvaluations,
  loadRankingContext,
  EVALUATION_COLUMNS,
  COMPANY_COLUMNS,
} from './data.js';
import { evaluationCatalog, emptyEvaluation, parseEvaluation, docsOk } from './catalog.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

/** 목록 상태 — 쿼리 값 → 상담 status (null 은 거르지 않음) */
export const INBOX_STATES = Object.freeze({ pending: 'pending', assigned: 'assigned', all: null });
export const INBOX_LIMIT = 200;

/** 업체 사본에 넘기는 칸 (본사 상담 그대로) — 품목 · 제목 · 회사 · 상태 · 원래 상담은 따로 정한다 */
export const COPY_FIELDS = Object.freeze([
  'name',
  'phone',
  'email',
  'sido',
  'gugun',
  'preferred_date',
  'preferred_time',
  'description',
  'space_type',
  'space_width_mm',
  'space_height_mm',
  'space_depth_mm',
  'budget_range',
  'wanted_price_tier',
  'style_preference',
  'door_finish',
  'demolition_needed',
  'request_detail_design',
  'quote',
]);

const CONSULT_COLUMNS = [
  'id',
  'company_id',
  'created_at',
  'status',
  'furniture_categories',
  'generation_id',
  ...COPY_FIELDS,
].join(',');

const INBOX_COLUMNS =
  'id,created_at,status,name,phone,sido,gugun,furniture_categories,door_finish,demolition_needed,wanted_price_tier,' +
  'preferred_date,preferred_time,request_detail_design,quote,generation_id';

const HOUR_MS = 3600 * 1000;

async function assertAdmin(env, user) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 할 수 있습니다', 'not_admin');
}

function conflict(message, code, details = null) {
  const err = new ConflictError(message, details);
  err.code = code;
  return err;
}

function notEligible(reasons) {
  const err = new ValidationError('이 업체는 지금 배정할 수 없습니다 (거르기를 통과하지 못함)', {
    reasons,
  });
  err.code = 'not_eligible';
  return err;
}

/** 배정 응답 기한 */
export function expiresAt(assignedAt) {
  const t = Date.parse(assignedAt);
  return Number.isFinite(t) ? new Date(t + ASSIGNMENT_TTL_HOURS * HOUR_MS).toISOString() : null;
}

export function quoteTotal(quote) {
  const n = quote && typeof quote === 'object' ? Number(quote.total) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 본사 상담 하나 — 없거나 본사 상담이 아니면 404 */
async function loadPlatformConsult(env, consultationId) {
  if (!isUuid(consultationId)) throw new NotFoundError('본사 상담을 찾을 수 없습니다');
  const [row, platform] = await Promise.all([
    selectOne(env, 'consultations', { id: `eq.${consultationId}`, select: CONSULT_COLUMNS }),
    platformCompanyId(env),
  ]);
  if (!row || row.company_id !== platform) throw new NotFoundError('본사 상담을 찾을 수 없습니다');
  return { consult: row, platform };
}

async function generationCategory(env, consult) {
  if (!consult.generation_id) return null;
  const g = await selectOne(env, 'generations', {
    id: `eq.${consult.generation_id}`,
    select: 'category',
  });
  return g ? g.category : null;
}

async function rankFor(env, consult, nowMs) {
  const items = customerItems(consult, await generationCategory(env, consult));
  const ctx = await loadRankingContext(env, { nowMs });
  return { items, ...rankCandidates({ consult, items, ...ctx, nowMs }) };
}

async function companyNames(env, ids) {
  const unique = [...new Set(ids.filter(isUuid))];
  if (!unique.length) return new Map();
  const rows =
    (await selectMany(env, 'companies', { id: `in.(${unique.join(',')})`, select: 'id,name' })) ||
    [];
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── 목록 ──────────────────────────────────────────────────────

/** GET /admin/consult-inbox */
export async function consultInbox(env, { user, query = {} }) {
  await assertAdmin(env, user);
  const state = query.state || 'pending';
  if (!has(INBOX_STATES, state))
    throw new ValidationError('state 는 pending · assigned · all 중 하나여야 합니다');
  const platform = await platformCompanyId(env);
  const q = {
    company_id: `eq.${platform}`,
    select: INBOX_COLUMNS,
    order: 'created_at.desc',
    limit: String(INBOX_LIMIT),
  };
  if (INBOX_STATES[state]) q.status = `eq.${INBOX_STATES[state]}`;
  const rows = (await selectMany(env, 'consultations', q)) || [];
  if (!rows.length) return { items: [] };

  const assignments =
    (await selectMany(env, 'consult_assignments', {
      consultation_id: `in.(${rows.map((r) => r.id).join(',')})`,
      select: 'id,consultation_id,company_id,state,assigned_at',
      order: 'assigned_at.asc',
      limit: '2000',
    })) || [];
  const names = await companyNames(
    env,
    assignments.map((a) => a.company_id)
  );
  const byConsult = new Map();
  for (const a of assignments) {
    if (!byConsult.has(a.consultation_id)) byConsult.set(a.consultation_id, []);
    byConsult.get(a.consultation_id).push(a);
  }

  const items = rows.map((r) => {
    const list = byConsult.get(r.id) || [];
    const current =
      [...list].reverse().find((a) => a.state === 'assigned' || a.state === 'accepted') || null;
    return {
      id: r.id,
      created_at: r.created_at,
      status: r.status,
      name: r.name,
      phone: r.phone,
      sido: r.sido,
      gugun: r.gugun,
      furniture_categories: r.furniture_categories || [],
      door_finish: r.door_finish ?? null,
      demolition_needed: r.demolition_needed ?? null,
      wanted_price_tier: r.wanted_price_tier ?? null,
      preferred_date: r.preferred_date,
      preferred_time: r.preferred_time,
      request_detail_design: r.request_detail_design === true,
      quote_total: quoteTotal(r.quote),
      has_generation: Boolean(r.generation_id),
      assignment: current
        ? {
            id: current.id,
            company_id: current.company_id,
            company_name: names.get(current.company_id) || null,
            state: current.state,
            assigned_at: current.assigned_at,
            expires_at: expiresAt(current.assigned_at),
          }
        : null,
      tried: list
        .filter((a) => a.state === 'declined' || a.state === 'expired')
        .map((a) => ({
          company_id: a.company_id,
          company_name: names.get(a.company_id) || null,
          state: a.state,
        })),
    };
  });
  return { items };
}

/** GET /admin/consultations/:id/candidates */
export async function consultCandidates(env, { user, consultationId, nowMs = Date.now() }) {
  await assertAdmin(env, user);
  const { consult } = await loadPlatformConsult(env, consultationId);
  const { ranked, filtered } = await rankFor(env, consult, nowMs);
  return { items: ranked.slice(0, TOP_N).map(candidateView), filtered };
}

// ── 배정 ──────────────────────────────────────────────────────

/** 사본 제목 — 고객이 적은 제목 대신 품목으로 (제목 칸은 비울 수 없다) */
export function copyTitle(items) {
  const labels = items.map((k) => FURNITURE_LABELS[k]).filter(Boolean);
  return labels.length ? `${labels.join('·')} 상담` : '상담';
}

/** 업체 사본 한 줄 */
export function copyRow(consult, companyId, items) {
  const row = {
    company_id: companyId,
    origin_consultation_id: consult.id,
    status: 'pending',
    title: copyTitle(items),
    furniture_categories: items,
  };
  for (const f of COPY_FIELDS) row[f] = consult[f] === undefined ? null : consult[f];
  // 이름 · 이메일 칸은 비울 수 없다 (consultations NOT NULL)
  row.name = consult.name || '';
  row.email = consult.email || '';
  row.request_detail_design = consult.request_detail_design === true;
  return row;
}

/**
 * POST /admin/consultations/:id/assign
 * @returns {{ data: { assignment_id, copy_consultation_id }, notice: object }} notice 는 응답 뒤 앱 알림 (notifyConsultAssigned)
 */
export async function assignConsultation(env, { user, consultationId, body, nowMs = Date.now() }) {
  await assertAdmin(env, user);
  const companyId = body && body.company_id;
  if (!isUuid(companyId)) throw new ValidationError('company_id 가 필요합니다');
  const { consult, platform } = await loadPlatformConsult(env, consultationId);

  const open = await selectOne(env, 'consult_assignments', {
    consultation_id: `eq.${consult.id}`,
    state: 'eq.assigned',
    select: 'id',
  });
  if (open || consult.status === 'assigned')
    throw conflict('이미 업체의 답을 기다리는 배정이 있습니다', 'open_assignment');
  if (consult.status !== 'pending') {
    throw conflict('대기 중인 상담만 배정할 수 있습니다', 'not_pending', {
      status: consult.status,
    });
  }

  const ranking = await rankFor(env, consult, nowMs);
  const pick = ranking.ranked.find((c) => c.company.id === companyId);
  if (!pick) {
    const f = ranking.filtered.find((x) => x.company_id === companyId);
    throw notEligible(f ? f.reasons : []);
  }

  const nowIso = new Date(nowMs).toISOString();
  // 읽은 그대로(대기)일 때만 — 동시에 다른 배정이 나갔으면 0행
  const locked = await updateBy(
    env,
    'consultations',
    { id: `eq.${consult.id}`, company_id: `eq.${platform}`, status: 'eq.pending', select: 'id' },
    { status: 'assigned', updated_at: nowIso }
  );
  if (!locked || !locked.length)
    throw conflict('그사이 상담이 바뀌었습니다. 목록을 다시 불러오세요', 'open_assignment');

  let copy = null;
  let stage = 'copy';
  try {
    copy = await insertOne(env, 'consultations', copyRow(consult, companyId, ranking.items));
    if (!copy || !copy.id) throw new DbError('상담 사본을 만들지 못했습니다');
    stage = 'assignment';
    const assignment = await insertOne(env, 'consult_assignments', {
      consultation_id: consult.id,
      company_id: companyId,
      copy_consultation_id: copy.id,
      rank: pick.rank,
      total: pick.total,
      score: { ...pick.score, rules: RULES_VERSION },
      state: 'assigned',
      assigned_by: user.id,
    });
    if (!assignment || !assignment.id) throw new DbError('배정 기록을 남기지 못했습니다');
    return {
      data: { assignment_id: assignment.id, copy_consultation_id: copy.id },
      notice: {
        companyId,
        assignmentId: assignment.id,
        items: ranking.items,
        gugun: consult.gugun,
      },
    };
  } catch (err) {
    if (copy && copy.id) {
      await restDelete(env, 'consultations', { id: `eq.${copy.id}` }).catch((e) =>
        console.error('assign rollback (copy) failed:', e && e.statusCode)
      );
    }
    // 같은 상담에 기다리는 배정이 이미 있으면(유니크 색인) 상태는 그 배정의 것이라 그대로 둔다
    if (stage === 'assignment' && err instanceof ConflictError)
      throw conflict('이미 업체의 답을 기다리는 배정이 있습니다', 'open_assignment');
    await updateBy(
      env,
      'consultations',
      { id: `eq.${consult.id}`, status: 'eq.assigned', select: 'id' },
      { status: 'pending', updated_at: nowIso }
    ).catch((e) => console.error('assign rollback (status) failed:', e && e.statusCode));
    throw err;
  }
}

/** 배정된 업체 대표 · 실장에게 앱 알림 (던지지 않는다 — 응답 뒤에 돌린다) */
export async function notifyConsultAssigned(env, notice) {
  if (!notice) return 0;
  return notifyRoles(env, {
    companyId: notice.companyId,
    roles: ['owner', 'manager'],
    kind: 'consult_assigned',
    ...buildMessage('consult_assigned', { items: notice.items, gugun: notice.gugun }),
    refId: notice.assignmentId,
  });
}

// ── 업체 · 평가표 ───────────────────────────────────────────────

/** 배정받을 상담 설정이 되어 있나 — 한 달 한도 (rules.js REQUIRE_MONTHLY_LIMIT) */
export function settingsOk(settings) {
  if (!settings) return false;
  if (!REQUIRE_MONTHLY_LIMIT) return true;
  return settings.monthly_limit !== null && settings.monthly_limit !== undefined;
}

/** GET /admin/companies?pool=1 */
export async function listCompaniesAdmin(env, { user, query = {} }) {
  await assertAdmin(env, user);
  const companies = await loadCompanies(env);
  const list = query.pool === '1' ? companies.filter(isPoolCompany) : companies;
  const ids = list.map((c) => c.id);
  const [settingsBy, evaluationBy] = await Promise.all([
    loadSettings(env, ids),
    loadEvaluations(env, ids),
  ]);
  return {
    items: list.map((c) => {
      const ev = evaluationBy.get(c.id) || null;
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        plan: c.plan ?? null,
        status: c.status,
        sido: c.sido ?? null,
        gugun: c.gugun ?? null,
        grade: ev ? (ev.grade ?? null) : null,
        evaluated_at: ev ? (ev.evaluated_at ?? null) : null,
        docs_ok: docsOk(ev),
        settings_ok: settingsOk(settingsBy.get(c.id) || null),
      };
    }),
  };
}

/** 평가할 수 있는 업체 (다담 공장 · 협력업체) — 아니면 404 */
async function loadEvaluableCompany(env, companyId) {
  if (!isUuid(companyId)) throw new NotFoundError('업체를 찾을 수 없습니다');
  const c = await selectOne(env, 'companies', { id: `eq.${companyId}`, select: COMPANY_COLUMNS });
  if (!c || (c.kind !== 'hq' && c.kind !== 'partner'))
    throw new NotFoundError('업체를 찾을 수 없습니다');
  return c;
}

/** 평가한 사람 이메일 — 관리자 화면 이력용. 못 읽으면 빈 칸 */
async function userEmails(env, ids) {
  const out = new Map();
  for (const id of [...new Set(ids.filter(isUuid))].slice(0, 20)) {
    try {
      const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      });
      if (!res.ok) continue;
      const u = await res.json();
      if (u && typeof u.email === 'string') out.set(id, u.email);
    } catch {
      // 이메일은 덤이다
    }
  }
  return out;
}

/** GET /admin/companies/:id/evaluation */
export async function getCompanyEvaluation(env, { user, companyId }) {
  await assertAdmin(env, user);
  const company = await loadEvaluableCompany(env, companyId);
  const [row, history] = await Promise.all([
    selectOne(env, 'company_evaluations', {
      company_id: `eq.${company.id}`,
      select: EVALUATION_COLUMNS,
    }),
    selectMany(env, 'company_evaluation_history', {
      company_id: `eq.${company.id}`,
      select: 'snapshot,evaluated_by,evaluated_at,created_at',
      order: 'created_at.desc',
      limit: '50',
    }),
  ]);
  const emails = await userEmails(
    env,
    (history || []).map((h) => h.evaluated_by)
  );
  return {
    company: {
      id: company.id,
      name: company.name,
      kind: company.kind,
      plan: company.plan ?? null,
      status: company.status,
    },
    evaluation: row || emptyEvaluation(company.id),
    catalog: evaluationCatalog(),
    history: (history || []).map((h) => ({
      evaluated_at: h.evaluated_at,
      evaluated_by_email: emails.get(h.evaluated_by) || null,
      grade: h.snapshot && h.snapshot.grade ? h.snapshot.grade : null,
    })),
  };
}

/** PUT /admin/companies/:id/evaluation */
export async function putCompanyEvaluation(env, { user, companyId, body, nowMs = Date.now() }) {
  await assertAdmin(env, user);
  const company = await loadEvaluableCompany(env, companyId);
  const existing = await selectOne(env, 'company_evaluations', {
    company_id: `eq.${company.id}`,
    select: 'docs',
  });
  const nowIso = new Date(nowMs).toISOString();
  const fields = parseEvaluation(body, { existing, userId: user.id, nowIso });
  const row = await upsertOne(
    env,
    'company_evaluations',
    { company_id: company.id, ...fields, evaluated_at: nowIso, evaluated_by: user.id },
    'company_id'
  );
  if (!row) throw new DbError('평가표를 저장하지 못했습니다');
  return { evaluation: row };
}
