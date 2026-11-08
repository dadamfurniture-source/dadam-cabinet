/**
 * Manager 업체 쪽 제작 의뢰 (DB 0050).
 *
 *   POST /production-requests                 의뢰 내기 (Manager 등급 업체의 대표 · 실장)
 *        { draft_id? | design_id?, project_id?, note?, sido?, gugun?, wanted_done_date? } → 201 의뢰 한 줄
 *        설계는 간편 플래너 설계(draft_id) · 앱 설계(design_id) 중 하나 이상 — 둘 다 이 업체 것만.
 *        앱 설계가 플래너에서 온 것이면 그 플래너 설계를, 플래너 설계에 앱 설계가 있으면 그 앱 설계 · 프로젝트를 같이 잇는다.
 *        같은 설계로 열린 의뢰(받음 · 거둠 전)는 하나뿐 (409 open_request). 본사에 Slack 알림.
 *   GET  /production-requests                 내 업체 의뢰 목록 (구성원) → { ready, can_act, can_create, items }
 *   GET  /production-requests/:id             의뢰 하나 + 지금 차례 추천 팩토리(이름 · 지역 · 하는 품목 · 본사 소개 — 점수 없음) + 고른 기록
 *   POST /production-requests/:id/choose      { company_id } 추천 팩토리 하나 고르기 (대표 · 실장) → 그 팩토리 대표 · 실장에게 앱 알림
 *   POST /production-requests/:id/cancel      거두기 (대표 · 실장, 받음 전에는 언제든)
 *
 * 의뢰를 내는 것은 plan manager(등급) 업체만 — company_members.role 의 manager 는 직책(실장)이다.
 * 보기 · 고르기 · 거두기는 그 의뢰를 낸 업체의 구성원 (등급이 바뀌어도 낸 의뢰는 그 업체 것).
 */

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
} from '../supabase.js';
import { SIDO } from '../consult-notify.js';
import { DRAFT_ID_RE } from '../planner-drafts.js';
import { PLANNER_SOURCE } from '../planner-handoff.js';
import {
  CANCELLABLE,
  LIST_LIMIT,
  NOTE_MAX,
  REQUEST_COLUMNS,
  canRequest,
  charLen,
  closeStale,
  companiesById,
  conflict,
  currentRecs,
  draftsOf,
  expiresAtOf,
  factoryView,
  guard,
  guardRead,
  inPool,
  isUuid,
  itemsOfCompanies,
  later,
  loadRequest,
  myCompanyOf,
  notifyActors,
  notifyHq,
  offerHistory,
  projectsById,
  recsOf,
  requestBase,
} from './common.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function optText(value, max, field, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string')
    throw new ValidationError(`${label}은(는) 글이어야 합니다`, { field });
  const s = value.trim();
  if (!s) return null;
  if (charLen(s) > max) throw new ValidationError(`${label}은(는) ${max}자까지입니다`, { field });
  return s;
}

/** 의뢰 본문 검사 (순수) → { draft_id, design_id, project_id, note, sido, gugun, wanted_done_date } */
export function parseRequest(body) {
  const b = isPlain(body) ? body : {};
  const draftId =
    b.draft_id === undefined || b.draft_id === null || b.draft_id === '' ? null : b.draft_id;
  if (draftId !== null && !(typeof draftId === 'string' && DRAFT_ID_RE.test(draftId)))
    throw new ValidationError('draft_id 형식이 아닙니다', { field: 'draft_id' });
  const designId =
    b.design_id === undefined || b.design_id === null || b.design_id === '' ? null : b.design_id;
  if (designId !== null && !isUuid(designId))
    throw new ValidationError('design_id 형식이 아닙니다', { field: 'design_id' });
  if (!draftId && !designId) {
    const err = new ValidationError('의뢰할 설계를 골라 주세요 (draft_id 또는 design_id)', {
      field: 'draft_id',
    });
    err.code = 'design_required';
    throw err;
  }
  const projectId =
    b.project_id === undefined || b.project_id === null || b.project_id === ''
      ? null
      : b.project_id;
  if (projectId !== null && !isUuid(projectId))
    throw new ValidationError('project_id 형식이 아닙니다', { field: 'project_id' });
  const note = optText(b.note, NOTE_MAX, 'note', '요청 메모');
  const sido = optText(b.sido, 20, 'sido', '시/도');
  const gugun = optText(b.gugun, 40, 'gugun', '시/군/구');
  if (sido && !SIDO.includes(sido))
    throw new ValidationError('시/도 이름이 목록에 없습니다', { field: 'sido' });
  if (gugun && !sido)
    throw new ValidationError('시/군/구는 시/도와 같이 적어 주세요', { field: 'gugun' });
  let wanted = null;
  if (
    b.wanted_done_date !== undefined &&
    b.wanted_done_date !== null &&
    b.wanted_done_date !== ''
  ) {
    const v = b.wanted_done_date;
    if (
      typeof v !== 'string' ||
      !DATE_RE.test(v) ||
      new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v
    )
      throw new ValidationError('wanted_done_date 는 YYYY-MM-DD 날짜입니다', {
        field: 'wanted_done_date',
      });
    wanted = v;
  }
  return {
    draft_id: draftId,
    design_id: designId,
    project_id: projectId,
    note,
    sido,
    gugun,
    wanted_done_date: wanted,
  };
}

/** 의뢰를 낼 수 있는 사람 — Manager 등급 업체의 대표 · 실장 */
async function requesterOf(env, user) {
  const me = await myCompanyOf(env, user);
  if (!canRequest(me.company))
    throw new ForbiddenError('제작 의뢰는 Manager 등급 업체만 낼 수 있습니다', 'not_manager_plan');
  if (!me.canAct)
    throw new ForbiddenError('업체 대표 · 실장만 제작 의뢰를 낼 수 있습니다', 'not_manager');
  return me;
}

/** 내 업체의 의뢰 — 남의 의뢰는 있는지도 모르게 404. act 면 대표 · 실장 */
async function myRequestOf(env, user, id, { act = false } = {}) {
  const me = await myCompanyOf(env, user);
  if (act && !me.canAct)
    throw new ForbiddenError('업체 대표 · 실장만 할 수 있습니다', 'not_manager');
  const req = await loadRequest(env, id, { companyId: me.company.id });
  return { ...me, req };
}

/** POST /production-requests */
export async function createRequest(env, { user, body, ctx }) {
  const { company } = await requesterOf(env, user);
  const input = parseRequest(body);
  return guard(async () => {
    let design = null;
    if (input.design_id) {
      design = await selectOne(env, 'designs', {
        id: `eq.${input.design_id}`,
        company_id: `eq.${company.id}`,
        select: 'id,company_id,project_id,source,source_ref',
      });
      if (!design) throw new NotFoundError('설계를 찾을 수 없습니다');
    }
    // 플래너에서 온 앱 설계면 그 플래너 설계를 같이 잇는다
    let draftId = input.draft_id;
    if (
      !draftId &&
      design &&
      design.source === PLANNER_SOURCE &&
      DRAFT_ID_RE.test(String(design.source_ref || ''))
    )
      draftId = design.source_ref;
    let draft = null;
    if (draftId) {
      draft = await selectOne(env, 'planner_drafts', {
        company_id: `eq.${company.id}`,
        id: `eq.${draftId}`,
        select: 'id,name,item,rev,summary,discarded_at',
      });
      if (!draft || draft.discarded_at) {
        if (input.draft_id) throw new NotFoundError('설계를 찾을 수 없습니다');
        draft = null;
      }
    }
    // 플래너 설계를 앱에 보낸 적이 있으면 그 앱 설계도 잇는다 (DB 0035 designs_source_ref_key)
    if (!design && draft) {
      design = await selectOne(env, 'designs', {
        company_id: `eq.${company.id}`,
        source: `eq.${PLANNER_SOURCE}`,
        source_ref: `eq.${draft.id}`,
        select: 'id,company_id,project_id,source,source_ref',
      });
    }
    let project = null;
    const projectId = input.project_id || (design && design.project_id) || null;
    if (projectId) {
      project = await selectOne(env, 'projects', {
        id: `eq.${projectId}`,
        company_id: `eq.${company.id}`,
        select: 'id,company_id,title,status',
      });
      if (input.project_id) {
        if (!project) throw new NotFoundError('프로젝트를 찾을 수 없습니다');
        if (project.status !== 'active')
          throw conflict('진행 중인 프로젝트만 이을 수 있습니다', 'project_closed', {
            status: project.status,
          });
      } else if (!project || project.status !== 'active') project = null;
    }
    let row;
    try {
      row = await insertOne(env, 'production_requests', {
        company_id: company.id,
        draft_id: draft ? draft.id : null,
        draft_rev: draft ? draft.rev : null,
        design_id: design ? design.id : null,
        project_id: project ? project.id : null,
        item:
          draft && typeof draft.item === 'string' && /^[a-z_]{1,40}$/.test(draft.item)
            ? draft.item
            : null,
        note: input.note,
        sido: input.sido,
        gugun: input.gugun,
        wanted_done_date: input.wanted_done_date,
        created_by: user.id,
      });
    } catch (e) {
      if (e instanceof ConflictError)
        throw conflict('이 설계로 이미 열린 제작 의뢰가 있습니다', 'open_request');
      throw e;
    }
    if (!row || !row.id) throw conflict('제작 의뢰를 넣지 못했습니다', 'not_saved');
    await later(ctx, notifyHq(env, 'new', row, company));
    const drafts = await draftsOf(env, [row]);
    const projects = project ? new Map([[project.id, project]]) : new Map();
    return { ...requestBase(row, { drafts, projects }), can_cancel: true, can_choose: false };
  });
}

const canCancel = (req) => CANCELLABLE.includes(req.status);

/** GET /production-requests */
export async function listMyRequests(env, { user }) {
  const { company, canAct } = await myCompanyOf(env, user);
  const head = { can_act: canAct, can_create: canAct && canRequest(company) };
  return guardRead(
    async () => {
      const rows =
        (await selectMany(env, 'production_requests', {
          company_id: `eq.${company.id}`,
          select: REQUEST_COLUMNS,
          order: 'created_at.desc',
          limit: String(LIST_LIMIT),
        })) || [];
      if (!rows.length) return { ...head, items: [] };
      const [drafts, projects, recs] = await Promise.all([
        draftsOf(env, rows),
        projectsById(
          env,
          rows.map((r) => r.project_id)
        ),
        recsOf(
          env,
          rows.map((r) => r.id)
        ),
      ]);
      const companies = await companiesById(
        env,
        rows.map((r) => r.factory_company_id)
      );
      return {
        ...head,
        items: rows.map((r) => {
          const factory = r.factory_company_id ? companies.get(r.factory_company_id) || null : null;
          return {
            ...requestBase(r, { drafts, projects }),
            recommendation_count: currentRecs(r, recs).length,
            factory: factory ? { company_id: factory.id, name: factory.name } : null,
            can_cancel: canAct && canCancel(r),
            can_choose: canAct && r.status === 'recommended',
          };
        }),
      };
    },
    { ...head, items: [] }
  );
}

/** GET /production-requests/:id */
export async function getMyRequest(env, { user, params }) {
  return guard(async () => {
    const { canAct, req } = await myRequestOf(env, user, params.id);
    const recs = await recsOf(env, [req.id]);
    const now = currentRecs(req, recs);
    const ids = [
      ...new Set([...recs.map((r) => r.company_id), req.factory_company_id].filter(Boolean)),
    ];
    const [drafts, projects, companies, items] = await Promise.all([
      draftsOf(env, [req]),
      projectsById(env, [req.project_id]),
      companiesById(env, ids),
      itemsOfCompanies(
        env,
        now.map((r) => r.company_id)
      ),
    ]);
    const factory = req.factory_company_id ? companies.get(req.factory_company_id) || null : null;
    return {
      ...requestBase(req, { drafts, projects }),
      hq_note: req.round > 0 ? req.hq_note || null : null,
      factory: factory ? { company_id: factory.id, name: factory.name } : null,
      can_cancel: canAct && canCancel(req),
      can_choose: canAct && req.status === 'recommended',
      recommendations: now.map((r) => factoryView(r, req, { companies, items })),
      offers: offerHistory(req, recs, companies),
    };
  });
}

/** POST /production-requests/:id/choose { company_id } */
export async function chooseFactory(env, { user, params, body, ctx }) {
  const raw = body && body.company_id;
  if (!isUuid(raw)) throw new ValidationError('company_id 가 필요합니다', { field: 'company_id' });
  const companyId = raw.toLowerCase();
  return guard(async () => {
    const { req } = await myRequestOf(env, user, params.id, { act: true });
    if (req.status !== 'recommended')
      throw conflict('추천이 도착한 의뢰만 고를 수 있습니다', 'not_recommended', {
        status: req.status,
      });
    const rec = currentRecs(req, await recsOf(env, [req.id])).find(
      (r) => r.company_id === companyId
    );
    if (!rec) {
      const err = new ValidationError('본사가 이번에 추천한 팩토리가 아닙니다', {
        field: 'company_id',
      });
      err.code = 'not_recommended_company';
      throw err;
    }
    const factory = (await companiesById(env, [companyId])).get(companyId);
    if (!inPool(factory)) {
      const err = new ValidationError(
        '이 팩토리는 지금 의뢰를 받을 수 없습니다 — 본사에 다시 추천을 요청해 주세요',
        { reasons: ['inactive'] }
      );
      err.code = 'not_eligible';
      throw err;
    }
    // 1) 추천 줄 고르기 — 한 의뢰에 답을 기다리는 줄은 하나 (DB 유니크). 고른 때 · 기한은 DB 가 찍는다
    let taken;
    try {
      taken = await updateBy(
        env,
        'production_recommendations',
        {
          id: `eq.${rec.id}`,
          chosen: 'eq.false',
          response: 'is.null',
          select: 'id,request_id,company_id,round,chosen,chosen_at,expires_at,response',
        },
        { chosen: true }
      );
    } catch (e) {
      if (e instanceof ConflictError)
        throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'stale');
      throw e;
    }
    const picked = Array.isArray(taken) ? taken[0] : null;
    if (!picked) throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'stale');
    // 2) 의뢰 잠금 — 읽은 차례 그대로 추천 도착일 때만
    const locked = await updateBy(
      env,
      'production_requests',
      {
        id: `eq.${req.id}`,
        status: 'eq.recommended',
        round: `eq.${req.round}`,
        select: 'id,status,round,factory_company_id',
      },
      { status: 'chosen', factory_company_id: companyId }
    );
    if (!locked || !locked.length) {
      const fresh = await loadRequest(env, req.id);
      await closeStale(env, picked, fresh);
      throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'stale');
    }
    await later(
      ctx,
      notifyActors(env, {
        companyId,
        kind: 'production_offered',
        params: { item: req.item },
        refId: picked.id,
      })
    );
    return {
      id: req.id,
      status: 'chosen',
      offer: {
        company_id: companyId,
        chosen_at: picked.chosen_at || null,
        expires_at: expiresAtOf(picked),
      },
    };
  });
}

/** POST /production-requests/:id/cancel */
export async function cancelMyRequest(env, { user, params }) {
  return guard(async () => {
    const { req } = await myRequestOf(env, user, params.id, { act: true });
    if (req.status === 'cancelled') return { id: req.id, status: 'cancelled' };
    if (!canCancel(req))
      throw conflict(
        '팩토리가 받은 의뢰는 거둘 수 없습니다 — 팩토리에 연락해 주세요',
        'not_cancellable',
        { status: req.status }
      );
    const locked = await updateBy(
      env,
      'production_requests',
      {
        id: `eq.${req.id}`,
        status: `eq.${req.status}`,
        round: `eq.${req.round}`,
        select: 'id,status',
      },
      { status: 'cancelled', factory_company_id: null }
    );
    if (!locked || !locked.length)
      throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'stale');
    // 답을 기다리던 팩토리 줄은 거둠으로 닫는다
    if (req.status === 'chosen') {
      const open = (await recsOf(env, [req.id])).filter((r) => r.chosen && !r.response);
      for (const r of open)
        await closeStale(env, r, { ...req, status: 'cancelled', factory_company_id: null });
    }
    return { id: req.id, status: 'cancelled' };
  });
}
