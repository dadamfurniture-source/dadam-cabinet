/**
 * 다담 본사 쪽 제작 의뢰 — 관리자(is_admin)만 (DB 0050 · 추천 줄 예상 가격대 · 제작 기간 0055).
 *
 *   GET  /admin/production-requests?state=todo|waiting|done|all   의뢰 목록 (기본 todo = 본사 차례: 접수 · 검토 중 · 못 받음 · 답 없음)
 *   POST /admin/production-requests/:id/review                    검토 시작 (submitted → recommending, 두 번 눌러도 같다)
 *   GET  /admin/production-requests/:id/suggestions               추천 후보 — 상담 분배 점수(distribution/score.js) 그대로.
 *                                                                 점수 · 걸러진 이유는 본사 화면만 (Manager 에게는 싣지 않는다)
 *   POST /admin/production-requests/:id/recommend                 { company_ids[1~5], note?, notes?: { company_id: 소개 },
 *                                                                   estimates?: { company_id: { price_min?, price_max?, lead_days? } } }
 *                                                                 → 201 Manager 대표 · 실장에게 앱 알림
 *
 * 예상 가격대 · 제작 기간 (estimates — 팩토리마다, 셋 다 비워 둘 수 있다. Manager 추천 카드에 보인다):
 *   price_min · price_max  원, 0 이상 정수. 둘 다 있으면 최소 ≤ 최대 (본사 화면은 만 원으로 받아 원으로 보낸다)
 *   lead_days              일, 1 이상 정수
 *   어기면 422 — code bad_estimates(모양 · 추천하지 않는 팩토리 · 모르는 칸) · bad_price · price_range · bad_lead_days.
 *   넣은 뒤에는 바꾸지 않는다 (DB 0055 지킴이 — 소개와 같다). 다시 적으려면 다시 추천한다.
 *
 * 추천할 수 있는 팩토리 (서버가 다시 본다): 업체 풀 — 다담 공장 · 활동 중 Expert · Agent 협력업체 (rules.js POOL_PLANS),
 *   의뢰한 업체 자신이 아니고, 이 의뢰를 못 받음 · 답 없음으로 돌려보낸 적이 없는 곳.
 *   지역 · 품목 · 한 달 한도 · 기간 · 서류 거르기는 후보 화면에 이유로만 보인다 (상담 배정처럼 막지는 않는다 — 사장님 확인 대기).
 */

import { ForbiddenError, ValidationError, insertMany, selectMany, updateBy } from '../supabase.js';
import { isAdmin } from '../reports/admin.js';
import { rankCandidates, candidateView, customerItems } from '../distribution/score.js';
import { loadRankingContext } from '../distribution/data.js';
import {
  HQ_NOTE_MAX,
  HQ_TURN,
  LIST_LIMIT,
  PROFILE_NOTE_MAX,
  RECOMMEND_DEFAULT,
  RECOMMEND_MAX,
  RECOMMENDABLE,
  REQUEST_COLUMNS,
  charLen,
  companiesById,
  conflict,
  currentRecs,
  draftsOf,
  estimateOf,
  guard,
  guardRead,
  inPool,
  isUuid,
  later,
  loadRequest,
  notifyActors,
  offerHistory,
  offerState,
  projectsById,
  recsOf,
  regionOf,
  requestBase,
  triedIdsOf,
} from './common.js';

/** 목록 state → 의뢰 status (null 은 모두) */
export const QUEUE_STATES = Object.freeze({
  todo: HQ_TURN,
  waiting: Object.freeze(['recommended', 'chosen']),
  done: Object.freeze(['accepted', 'cancelled']),
  all: null,
});

/** 거르기 이유 중 추천을 막는 것 — 풀 밖 · 이 의뢰를 돌려보낸 곳 */
export const BLOCKING_REASONS = Object.freeze(['tier', 'inactive', 'tried']);

async function assertAdmin(env, user) {
  if (!(await isAdmin(env, user))) throw new ForbiddenError('관리자만 할 수 있습니다', 'not_admin');
}

/** GET /admin/production-requests */
export async function listRequestsAdmin(env, { user, query = {} }) {
  await assertAdmin(env, user);
  const state = (query && query.state) || 'todo';
  if (!Object.prototype.hasOwnProperty.call(QUEUE_STATES, state))
    throw new ValidationError('state 는 todo · waiting · done · all 중 하나여야 합니다', {
      field: 'state',
    });
  return guardRead(
    async () => {
      const q = { select: REQUEST_COLUMNS, order: 'created_at.desc', limit: String(LIST_LIMIT) };
      if (QUEUE_STATES[state]) q.status = `in.(${QUEUE_STATES[state].join(',')})`;
      const rows = (await selectMany(env, 'production_requests', q)) || [];
      if (!rows.length) return { state, items: [] };
      const recs = await recsOf(
        env,
        rows.map((r) => r.id)
      );
      const [drafts, projects, companies] = await Promise.all([
        draftsOf(env, rows),
        projectsById(
          env,
          rows.map((r) => r.project_id)
        ),
        companiesById(env, [
          ...rows.map((r) => r.company_id),
          ...rows.map((r) => r.factory_company_id),
          ...recs.map((r) => r.company_id),
        ]),
      ]);
      return {
        state,
        items: rows.map((r) => {
          const m = companies.get(r.company_id) || null;
          const f = r.factory_company_id ? companies.get(r.factory_company_id) || null : null;
          const tried = triedIdsOf(recs.filter((x) => x.request_id === r.id));
          return {
            ...requestBase(r, { drafts, projects }),
            hq_note: r.hq_note || null,
            manager: m
              ? { company_id: m.id, name: m.name, region: regionOf(m), plan: m.plan || null }
              : { company_id: r.company_id, name: null, region: '', plan: null },
            factory: f ? { company_id: f.id, name: f.name } : null,
            recommendations: currentRecs(r, recs).map((x) => ({
              company_id: x.company_id,
              name: (companies.get(x.company_id) || {}).name || null,
              rank: x.rank,
              note: x.note || null,
              ...estimateOf(x),
              chosen: x.chosen === true,
              state: offerState(x, r),
            })),
            offers: offerHistory(r, recs, companies, { withReason: true }),
            tried: [...tried].map((id) => ({
              company_id: id,
              name: (companies.get(id) || {}).name || null,
            })),
            can_review: r.status === 'submitted',
            can_recommend: RECOMMENDABLE.includes(r.status),
          };
        }),
      };
    },
    { state, items: [] }
  );
}

/** POST /admin/production-requests/:id/review */
export async function reviewRequest(env, { user, params }) {
  await assertAdmin(env, user);
  return guard(async () => {
    const req = await loadRequest(env, params.id);
    if (req.status === 'recommending') return { id: req.id, status: 'recommending' };
    if (req.status !== 'submitted')
      throw conflict('접수된 의뢰만 검토를 시작합니다', 'not_submitted', { status: req.status });
    const done = await updateBy(
      env,
      'production_requests',
      { id: `eq.${req.id}`, status: 'eq.submitted', select: 'id,status' },
      { status: 'recommending' }
    );
    if (!done || !done.length) {
      const fresh = await loadRequest(env, req.id);
      if (fresh.status === 'recommending') return { id: req.id, status: 'recommending' };
      throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'stale', {
        status: fresh.status,
      });
    }
    return { id: req.id, status: 'recommending' };
  });
}

/**
 * 점수용 「상담」 모양 — 현장 지역 · 품목 · 시공 완료 희망 날짜만. 가격대는 모른다(모든 팩토리 절반),
 * 상세 설계는 이미 한 의뢰라 요청 없음(모두 만점).
 */
export function consultLike(req) {
  return {
    id: req.id,
    sido: req.sido || null,
    gugun: req.gugun || null,
    furniture_categories: req.item ? [req.item] : [],
    wanted_price_tier: null,
    wanted_done_date: req.wanted_done_date || null,
    request_detail_design: false,
  };
}

/** GET /admin/production-requests/:id/suggestions */
export async function suggestionsFor(env, { user, params, nowMs = Date.now() }) {
  await assertAdmin(env, user);
  return guard(async () => {
    const req = await loadRequest(env, params.id);
    const recs = await recsOf(env, [req.id]);
    const triedIds = triedIdsOf(recs);
    const consult = consultLike(req);
    const items = customerItems(consult);
    const ctx = await loadRankingContext(env, { nowMs });
    // 의뢰한 업체 자신은 후보가 아니다 (Manager 는 풀 밖이라 어차피 tier 로 걸러진다)
    const companies = ctx.companies.filter((c) => c.id !== req.company_id);
    const { ranked, filtered } = rankCandidates({
      consult,
      items,
      ...ctx,
      companies,
      triedIds,
      nowMs,
    });
    const regionBy = new Map(ctx.companies.map((c) => [c.id, regionOf(c)]));
    return {
      request: {
        id: req.id,
        status: req.status,
        round: req.round,
        item: req.item || null,
        region: regionOf(req),
        wanted_done_date: req.wanted_done_date || null,
      },
      default_count: RECOMMEND_DEFAULT,
      max: RECOMMEND_MAX,
      can_recommend: RECOMMENDABLE.includes(req.status),
      items: ranked.map((c) => ({ ...candidateView(c), region: regionBy.get(c.company.id) || '' })),
      filtered: filtered.map((f) => ({
        ...f,
        region: regionBy.get(f.company_id) || '',
        can_recommend: !f.reasons.some((r) => BLOCKING_REASONS.includes(r)),
      })),
    };
  });
}

/** 예상 가격대 · 제작 기간 칸 (DB 0055 production_recommendations) */
export const ESTIMATE_KEYS = Object.freeze(['price_min', 'price_max', 'lead_days']);
/** DB integer 칸(lead_days)이 담는 가장 큰 값 — 칸 형식이지 규칙이 아니다 (가격은 bigint 라 JS 안전 정수면 담긴다) */
const INT4_MAX = 2147483647;
const NO_ESTIMATE = Object.freeze({ price_min: null, price_max: null, lead_days: null });

function badEstimate(message, code, companyId = null) {
  const err = new ValidationError(
    message,
    companyId ? { field: 'estimates', company_id: companyId } : { field: 'estimates' }
  );
  err.code = code;
  return err;
}

/**
 * 팩토리 하나의 예상 가격대 · 제작 기간 검사 (순수) → { price_min, price_max, lead_days } | null (셋 다 없음).
 * 값이 null · 없음이면 적지 않은 것. 숫자(정수)만 받는다 — 글자 '1000' 은 거절.
 */
export function parseEstimate(raw, companyId = null) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw badEstimate(
      'estimates 는 { 팩토리 id: { price_min?, price_max?, lead_days? } } 입니다',
      'bad_estimates',
      companyId
    );
  for (const k of Object.keys(raw))
    if (!ESTIMATE_KEYS.includes(k))
      throw badEstimate(
        'estimates 에는 price_min · price_max · lead_days 만 적습니다',
        'bad_estimates',
        companyId
      );
  const won = (v) => {
    if (v === null || v === undefined) return null;
    if (!Number.isSafeInteger(v) || v < 0)
      throw badEstimate('가격대는 0 이상 정수(원)여야 합니다', 'bad_price', companyId);
    return v;
  };
  const min = won(raw.price_min);
  const max = won(raw.price_max);
  if (min !== null && max !== null && min > max)
    throw badEstimate('가격대 최소가 최대보다 큽니다', 'price_range', companyId);
  let lead = null;
  if (raw.lead_days !== null && raw.lead_days !== undefined) {
    if (!Number.isSafeInteger(raw.lead_days) || raw.lead_days < 1 || raw.lead_days > INT4_MAX)
      throw badEstimate('제작 기간은 1 이상 정수(일)여야 합니다', 'bad_lead_days', companyId);
    lead = raw.lead_days;
  }
  if (min === null && max === null && lead === null) return null;
  return { price_min: min, price_max: max, lead_days: lead };
}

/** 추천 본문 검사 (순수) → { ids, hqNote, notes: Map, estimates: Map } */
export function parseRecommend(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const ids = b.company_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > RECOMMEND_MAX)
    throw new ValidationError(`company_ids 는 팩토리 1~${RECOMMEND_MAX}곳입니다`, {
      field: 'company_ids',
    });
  if (!ids.every(isUuid))
    throw new ValidationError('company_ids 형식이 아닙니다', { field: 'company_ids' });
  const lower = ids.map((x) => x.toLowerCase());
  if (new Set(lower).size !== lower.length)
    throw new ValidationError('같은 팩토리가 두 번 있습니다', { field: 'company_ids' });
  let hqNote = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== 'string')
      throw new ValidationError('note 는 글이어야 합니다', { field: 'note' });
    hqNote = b.note.trim() || null;
    if (hqNote && charLen(hqNote) > HQ_NOTE_MAX)
      throw new ValidationError(`note 는 ${HQ_NOTE_MAX}자까지입니다`, { field: 'note' });
  }
  const notes = new Map();
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== 'object' || Array.isArray(b.notes))
      throw new ValidationError('notes 는 { 팩토리 id: 소개 } 입니다', { field: 'notes' });
    for (const [k, v] of Object.entries(b.notes)) {
      const key = String(k).toLowerCase();
      if (!lower.includes(key))
        throw new ValidationError('notes 에 추천하지 않는 팩토리가 있습니다', { field: 'notes' });
      if (v === null || v === undefined) continue;
      if (typeof v !== 'string')
        throw new ValidationError('소개는 글이어야 합니다', { field: 'notes' });
      const s = v.trim();
      if (charLen(s) > PROFILE_NOTE_MAX)
        throw new ValidationError(`소개는 ${PROFILE_NOTE_MAX}자까지입니다`, { field: 'notes' });
      if (s) notes.set(key, s);
    }
  }
  const estimates = new Map();
  if (b.estimates !== undefined && b.estimates !== null) {
    if (typeof b.estimates !== 'object' || Array.isArray(b.estimates))
      throw badEstimate(
        'estimates 는 { 팩토리 id: { price_min?, price_max?, lead_days? } } 입니다',
        'bad_estimates'
      );
    for (const [k, v] of Object.entries(b.estimates)) {
      const key = String(k).toLowerCase();
      if (!lower.includes(key))
        throw badEstimate('estimates 에 추천하지 않는 팩토리가 있습니다', 'bad_estimates');
      const e = parseEstimate(v, key);
      if (e) estimates.set(key, e);
    }
  }
  return { ids: lower, hqNote, notes, estimates };
}

function notEligible(companyId, reasons) {
  const err = new ValidationError('추천할 수 없는 팩토리가 있습니다', {
    company_id: companyId,
    reasons,
  });
  err.code = 'not_eligible';
  return err;
}

/** POST /admin/production-requests/:id/recommend */
export async function recommendFactories(env, { user, params, body, ctx }) {
  await assertAdmin(env, user);
  const { ids, hqNote, notes, estimates } = parseRecommend(body);
  return guard(async () => {
    const req = await loadRequest(env, params.id);
    if (!RECOMMENDABLE.includes(req.status))
      throw conflict('지금은 추천할 수 없는 의뢰입니다', 'not_recommendable', {
        status: req.status,
      });
    const recs = await recsOf(env, [req.id]);
    const tried = triedIdsOf(recs);
    const companies = await companiesById(env, ids);
    for (const id of ids) {
      const c = companies.get(id);
      if (!c) throw notEligible(id, ['unknown']);
      if (c.id === req.company_id || !inPool(c))
        throw notEligible(id, c.status !== 'active' ? ['inactive'] : ['tier']);
      if (tried.has(c.id)) throw notEligible(id, ['tried']);
    }
    // 1) 다음 차례 추천 줄 — 잠금에 진 앞선 시도의 줄이 있어도 그 뒤 차례로 (화면은 의뢰의 차례만 보인다)
    const round = Math.max(req.round, ...recs.map((r) => r.round)) + 1;
    let inserted;
    try {
      inserted = await insertMany(
        env,
        'production_recommendations',
        ids.map((id, i) => ({
          request_id: req.id,
          company_id: companies.get(id).id,
          round,
          rank: i + 1,
          note: notes.get(id) || null,
          ...(estimates.get(id) || NO_ESTIMATE),
          created_by: user.id,
        }))
      );
    } catch (e) {
      if (e && e.statusCode === 409)
        throw conflict('그사이 다른 추천이 들어왔습니다. 다시 불러오세요', 'stale');
      throw e;
    }
    // 2) 의뢰 잠금 — 읽은 상태 · 차례 그대로일 때만
    const locked = await updateBy(
      env,
      'production_requests',
      {
        id: `eq.${req.id}`,
        status: `eq.${req.status}`,
        round: `eq.${req.round}`,
        select: 'id,status,round',
      },
      { status: 'recommended', round, hq_note: hqNote, factory_company_id: null }
    );
    if (!locked || !locked.length)
      throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'stale');
    await later(
      ctx,
      notifyActors(env, {
        companyId: req.company_id,
        kind: 'production_recommended',
        params: { count: ids.length },
        refId: req.id,
        dedupeSuffix: `r${round}`,
      })
    );
    return {
      id: req.id,
      status: 'recommended',
      round,
      hq_note: hqNote,
      recommendations: (inserted || [])
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({
          company_id: r.company_id,
          name: (companies.get(r.company_id) || {}).name || null,
          rank: r.rank,
          note: r.note || null,
          ...estimateOf(r),
        })),
    };
  });
}
