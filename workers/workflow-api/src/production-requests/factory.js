/**
 * 팩토리 쪽 제작 의뢰 — Manager 가 고른 팩토리의 받기 · 못 받음 · 24시간 답 없음 (DB 0050).
 * 상담 배정(distribution/company.js)과 같은 길: 목록은 구성원, 받기 · 못 받음은 대표 · 실장, 24시간 지나면 1분 cron 이 되돌린다.
 *
 *   GET  /factory/production-requests             우리에게 온 의뢰 (고른 줄만 — 추천만 되고 안 골린 것은 보이지 않는다)
 *   POST /factory/production-requests/:id/accept  받기 → { request_id, customer_id, project_id, draft_id }
 *   POST /factory/production-requests/:id/decline { reason? } 못 받음 → 본사 Slack · Manager 앱 알림, 본사가 다시 추천
 *   runProductionOfferExpiry (1분 cron)           24시간 지난 답 기다림 → 답 없음(expired), 못 받음과 같게 알린다
 *
 * 받기 — 상담 배정 받기(acceptCompanyConsult)와 같은 차례로, 이 팩토리 company 에:
 *   고객       의뢰한 Manager 업체 (이름 = 업체 이름, 연락처 없음). 같은 Manager 의 앞선 받은 의뢰가 있으면 그 고객 줄을 다시 쓴다
 *   프로젝트    그 고객으로 새로 (제목 「Manager 업체 이름 제작 의뢰 · 품목」)
 *   의뢰       chosen → accepted + 팩토리 프로젝트 (읽은 차례 그대로일 때만 — 그사이 거둠 · 답 없음이면 만든 줄을 지우고 409)
 *   설계 사본   간편 플래너 설계면 이 팩토리의 플래너 설계로 베낀다 (id = pr-<의뢰 id>, 고친 차례 1, 사진 · 앱 보낸 기록은 베끼지 않는다).
 *              실패해도 받기는 그대로 — 다시 받기를 누르면 사본만 다시 만든다.
 * Manager 의 고객 프로젝트는 그대로 둔다 (넘기기 handed_over · origin_project_id 를 쓰지 않는다 — 0050 머리말).
 * 받은 뒤 설계 · BOM · 작업지시서 · 문서는 팩토리 것 (팩토리 등급 규칙 그대로).
 */

import {
  ConflictError,
  DbError,
  NotFoundError,
  ValidationError,
  insertOne,
  restDelete,
  selectMany,
  selectOne,
  updateBy,
} from '../supabase.js';
import { companyOf } from '../distribution/company.js';
import {
  LIST_LIMIT,
  REASON_MAX,
  REC_COLUMNS,
  REQUEST_COLUMNS,
  charLen,
  closeStale,
  companiesById,
  conflict,
  draftsOf,
  expiresAtOf,
  guard,
  guardRead,
  isUuid,
  itemLabel,
  later,
  loadRequest,
  notifyActors,
  notifyHq,
  offerState,
  regionOf,
} from './common.js';

/** cron 한 번에 되돌리는 의뢰 수 — 남으면 다음 1분 */
export const EXPIRE_BATCH = 50;
/** 프로젝트 이름 글자 수 (company-projects.js PROJECT_TITLE_MAX 와 같다) */
const PROJECT_TITLE_MAX = 100;

/** 받은 팩토리의 설계 사본 id — 의뢰마다 하나 (DB planner_drafts_id_check 모양) */
export const factoryDraftIdOf = (requestId) => `pr-${String(requestId).toLowerCase()}`;

/** 팩토리 프로젝트 제목 (순수) */
export function factoryProjectTitle(managerName, item) {
  const label = itemLabel(item);
  const head = [...String(managerName || 'Manager 업체').trim()].slice(0, 60).join('');
  return [...`${head} 제작 의뢰${label ? ` · ${label}` : ''}`].slice(0, PROJECT_TITLE_MAX).join('');
}

/** 우리 팩토리에 온 의뢰 하나 — 고른 줄 중 가장 뒤 차례. 없으면 404 (남의 의뢰는 있는지도 모르게) */
async function loadOffer(env, companyId, requestId) {
  if (!isUuid(requestId)) throw new NotFoundError('제작 의뢰를 찾을 수 없습니다');
  const rec = await selectOne(env, 'production_recommendations', {
    request_id: `eq.${requestId}`,
    company_id: `eq.${companyId}`,
    chosen: 'eq.true',
    select: REC_COLUMNS,
    order: 'round.desc',
  });
  if (!rec) throw new NotFoundError('제작 의뢰를 찾을 수 없습니다');
  const req = await loadRequest(env, requestId);
  return { rec, req };
}

/** 답할 수 있나 — 아니면 409 not_open · expired */
function assertOpen(rec, req, nowMs) {
  const state = offerState(rec, req);
  if (state !== 'open') throw conflict('이미 답했거나 거둬진 의뢰입니다', 'not_open', { state });
  const exp = Date.parse(expiresAtOf(rec) || '');
  if (Number.isFinite(exp) && exp <= nowMs)
    throw conflict('답할 시간(24시간)이 지났습니다', 'expired');
}

/** GET /factory/production-requests — can_act: 받기 · 못 받음을 할 수 있나 (대표 · 실장) */
export async function listFactoryRequests(env, { user, nowMs = Date.now() }) {
  const { companyId, canAct } = await companyOf(env, user);
  return guardRead(
    async () => {
      const recs =
        (await selectMany(env, 'production_recommendations', {
          company_id: `eq.${companyId}`,
          chosen: 'eq.true',
          select: REC_COLUMNS,
          order: 'chosen_at.desc',
          limit: String(LIST_LIMIT),
        })) || [];
      if (!recs.length) return { can_act: canAct, items: [] };
      const reqs =
        (await selectMany(env, 'production_requests', {
          id: `in.(${[...new Set(recs.map((r) => r.request_id))].join(',')})`,
          select: REQUEST_COLUMNS,
        })) || [];
      const reqOf = new Map(reqs.map((r) => [r.id, r]));
      const [drafts, managers] = await Promise.all([
        draftsOf(env, reqs),
        companiesById(
          env,
          reqs.map((r) => r.company_id)
        ),
      ]);
      return {
        can_act: canAct,
        items: recs
          .filter((rec) => reqOf.has(rec.request_id))
          .map((rec) => {
            const req = reqOf.get(rec.request_id);
            const state = offerState(rec, req);
            const exp = expiresAtOf(rec);
            const open = state === 'open' && !(Date.parse(exp || '') <= nowMs);
            // 의뢰 내용(메모 · 설계 이름)은 답 기다림 · 받은 의뢰만 — 못 받음 · 답 없음 · 거둠은 품목 · 지역만
            const live = state === 'open' || state === 'accepted';
            const m = managers.get(req.company_id) || null;
            const d = req.draft_id ? drafts.get(`${req.company_id}:${req.draft_id}`) || null : null;
            const mine = state === 'accepted' && req.factory_company_id === companyId;
            return {
              id: req.id,
              state,
              manager: { name: m ? m.name : null, region: m ? regionOf(m) : '' },
              item: req.item || null,
              item_label: itemLabel(req.item),
              region: regionOf(req),
              wanted_done_date: req.wanted_done_date || null,
              note: live ? req.note || null : null,
              design:
                live && req.draft_id
                  ? {
                      name: d ? d.name : null,
                      walls: d ? d.walls : null,
                      modules: d ? d.modules : null,
                    }
                  : null,
              chosen_at: rec.chosen_at,
              expires_at: exp,
              responded_at: rec.responded_at || null,
              project_id: mine ? req.factory_project_id || null : null,
              draft_id: mine ? req.factory_draft_id || null : null,
              can_act: canAct && open,
            };
          }),
      };
    },
    { can_act: canAct, items: [] }
  );
}

/** 받기 — 고객 줄 (Manager 업체). 같은 Manager 의 앞선 받은 의뢰 고객을 다시 쓴다 → { id, owned } */
async function factoryCustomerOf(env, factoryId, req, manager) {
  const prev =
    (await selectMany(env, 'production_requests', {
      company_id: `eq.${req.company_id}`,
      factory_company_id: `eq.${factoryId}`,
      status: 'eq.accepted',
      select: 'id,factory_project_id',
      order: 'status_at.desc',
      limit: '5',
    })) || [];
  const pid = prev.map((p) => p.factory_project_id).find(isUuid);
  if (pid) {
    const p = await selectOne(env, 'projects', {
      id: `eq.${pid}`,
      company_id: `eq.${factoryId}`,
      select: 'id,customer_id',
    });
    if (p && p.customer_id) return { id: p.customer_id, owned: false };
  }
  const row = await insertOne(env, 'customers', {
    company_id: factoryId,
    name: manager ? manager.name : null,
    phone: null,
  });
  if (!row || !row.id) throw new DbError('팩토리 고객 줄을 만들지 못했습니다');
  return { id: row.id, owned: true };
}

/**
 * 간편 플래너 설계 사본 — 받은 팩토리의 플래너 설계로. 던지지 않는다 (실패하면 null — 다시 받기를 누르면 또 해 본다).
 * 사진(planner_draft_photos)과 앱 보낸 기록(app_state)은 베끼지 않는다.
 */
export async function copyDraftToFactory(env, req, factoryId, user) {
  if (!req.draft_id) return null;
  if (req.factory_draft_id) return req.factory_draft_id;
  const id = factoryDraftIdOf(req.id);
  try {
    const src = await selectOne(env, 'planner_drafts', {
      company_id: `eq.${req.company_id}`,
      id: `eq.${req.draft_id}`,
      select: 'id,name,item,model,summary',
    });
    if (!src || !src.model || typeof src.model !== 'object') return null;
    try {
      await insertOne(env, 'planner_drafts', {
        company_id: factoryId,
        id,
        name: src.name || '',
        item: src.item || 'sink',
        model: { ...src.model, id },
        rev: 1,
        summary: src.summary && typeof src.summary === 'object' ? src.summary : {},
        created_by: user.id,
        updated_by: user.id,
      });
    } catch (e) {
      // 앞선 시도가 사본을 이미 넣었으면 그대로 쓴다
      if (!(e instanceof ConflictError)) throw e;
    }
    await updateBy(
      env,
      'production_requests',
      { id: `eq.${req.id}`, status: 'eq.accepted', factory_draft_id: 'is.null', select: 'id' },
      { factory_draft_id: id }
    );
    return id;
  } catch (e) {
    console.warn('[production] 설계 사본 실패:', e && e.statusCode ? e.statusCode : 'error');
    return null;
  }
}

/** POST /factory/production-requests/:id/accept */
export async function acceptFactoryRequest(env, { user, params, ctx, nowMs = Date.now() }) {
  const { companyId } = await companyOf(env, user, { manage: true });
  return guard(async () => {
    const { rec, req } = await loadOffer(env, companyId, params.id);
    // 두 번 눌러도 같은 답 — 이미 받은 의뢰는 이어진 프로젝트 그대로 (설계 사본이 빠졌으면 다시 만든다)
    if (
      req.status === 'accepted' &&
      req.factory_company_id === companyId &&
      req.round === rec.round &&
      req.factory_project_id
    ) {
      const p = await selectOne(env, 'projects', {
        id: `eq.${req.factory_project_id}`,
        select: 'id,customer_id',
      });
      const draftId = await copyDraftToFactory(env, req, companyId, user);
      if (!rec.response) await closeStale(env, rec, req);
      return {
        request_id: req.id,
        customer_id: p ? p.customer_id : null,
        project_id: req.factory_project_id,
        draft_id: draftId,
      };
    }
    assertOpen(rec, req, nowMs);
    const manager = (await companiesById(env, [req.company_id])).get(req.company_id) || null;
    const customer = await factoryCustomerOf(env, companyId, req, manager);
    let projectId = null;
    const undo = async () => {
      if (projectId) await restDelete(env, 'projects', { id: `eq.${projectId}` }).catch(() => null);
      if (customer.owned)
        await restDelete(env, 'customers', { id: `eq.${customer.id}` }).catch(() => null);
    };
    try {
      const p = await insertOne(env, 'projects', {
        company_id: companyId,
        customer_id: customer.id,
        title: factoryProjectTitle(manager ? manager.name : '', req.item),
        status: 'active',
      });
      if (!p || !p.id) throw new DbError('프로젝트를 만들지 못했습니다');
      projectId = p.id;
    } catch (e) {
      await undo();
      throw e;
    }
    // 의뢰 잠금 — 읽은 차례 그대로 이 팩토리의 답 기다림일 때만 (그사이 거둠 · 답 없음이면 0행)
    const locked = await updateBy(
      env,
      'production_requests',
      {
        id: `eq.${req.id}`,
        status: 'eq.chosen',
        round: `eq.${req.round}`,
        factory_company_id: `eq.${companyId}`,
        select: REQUEST_COLUMNS,
      },
      { status: 'accepted', factory_project_id: projectId }
    ).catch(async (e) => {
      await undo();
      throw e;
    });
    if (!locked || !locked.length) {
      await undo();
      throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'not_open');
    }
    const accepted = locked[0];
    await updateBy(
      env,
      'production_recommendations',
      { id: `eq.${rec.id}`, response: 'is.null', select: 'id' },
      { response: 'accepted', responded_by: user.id }
    ).catch((e) =>
      console.warn('[production] 받기 기록 실패:', e && e.statusCode ? e.statusCode : 'error')
    );
    const draftId = await copyDraftToFactory(env, accepted, companyId, user);
    await later(
      ctx,
      notifyActors(env, {
        companyId: req.company_id,
        kind: 'production_answered',
        params: { answer: 'accepted' },
        refId: rec.id,
        dedupeSuffix: 'accepted',
      })
    );
    return {
      request_id: req.id,
      customer_id: customer.id,
      project_id: projectId,
      draft_id: draftId,
    };
  });
}

function parseReason(body) {
  const raw = body && body.reason;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string')
    throw new ValidationError('reason 은 글이어야 합니다', { field: 'reason' });
  const reason = raw.trim();
  if (charLen(reason) > REASON_MAX)
    throw new ValidationError(`reason 은 ${REASON_MAX}자까지입니다`, { field: 'reason' });
  return reason || null;
}

/** 못 받음 · 답 없음 뒤 — Manager 대표 · 실장 앱 알림 + 본사 Slack (던지지 않는다) */
async function noticeReturned(env, req, rec, answer) {
  const manager =
    (await companiesById(env, [req.company_id]).catch(() => new Map())).get(req.company_id) || null;
  await Promise.all([
    notifyActors(env, {
      companyId: req.company_id,
      kind: 'production_answered',
      params: { answer },
      refId: rec.id,
      dedupeSuffix: answer,
    }),
    notifyHq(env, answer, req, manager),
  ]);
}

/** POST /factory/production-requests/:id/decline { reason? } */
export async function declineFactoryRequest(env, { user, params, body, ctx, nowMs = Date.now() }) {
  const { companyId } = await companyOf(env, user, { manage: true });
  const reason = parseReason(body);
  return guard(async () => {
    const { rec, req } = await loadOffer(env, companyId, params.id);
    assertOpen(rec, req, nowMs);
    const locked = await updateBy(
      env,
      'production_requests',
      {
        id: `eq.${req.id}`,
        status: 'eq.chosen',
        round: `eq.${req.round}`,
        factory_company_id: `eq.${companyId}`,
        select: 'id,status',
      },
      { status: 'declined' }
    );
    if (!locked || !locked.length)
      throw conflict('그사이 의뢰가 바뀌었습니다. 다시 불러오세요', 'not_open');
    await updateBy(
      env,
      'production_recommendations',
      { id: `eq.${rec.id}`, response: 'is.null', select: 'id' },
      { response: 'declined', reason, responded_by: user.id }
    ).catch((e) =>
      console.warn('[production] 못 받음 기록 실패:', e && e.statusCode ? e.statusCode : 'error')
    );
    await later(ctx, noticeReturned(env, req, rec, 'declined'));
    return { request_id: req.id, status: 'declined' };
  });
}

/**
 * 1분 cron — 24시간 지난 답 기다림을 답 없음(expired)으로. 의뢰 잠금에 지는 줄(그사이 받음 · 거둠)은 의뢰에 맞춰 닫는다.
 * 0050 적용 전이면 조용히 건너뛴다. 던지지 않는다.
 */
export async function runProductionOfferExpiry(
  env,
  { nowMs = Date.now(), limit = EXPIRE_BATCH } = {}
) {
  const out = { expired: 0, closed: 0, failed: 0 };
  let recs;
  try {
    recs =
      (await selectMany(env, 'production_recommendations', {
        chosen: 'eq.true',
        response: 'is.null',
        expires_at: `lte.${new Date(nowMs).toISOString()}`,
        select: REC_COLUMNS,
        order: 'expires_at.asc',
        limit: String(limit),
      })) || [];
  } catch (e) {
    if (e instanceof DbError && /PGRST20[45]|42P01|42703/.test(String(e.message || '')))
      return { ...out, skipped: 'db' };
    console.error('[production] 답 없음 읽기 실패:', e && e.statusCode ? e.statusCode : 'error');
    return { ...out, failed: 1 };
  }
  for (const rec of recs) {
    try {
      const req = await loadRequest(env, rec.request_id);
      if (offerState(rec, req) !== 'open') {
        await closeStale(env, rec, req);
        out.closed += 1;
        continue;
      }
      const locked = await updateBy(
        env,
        'production_requests',
        {
          id: `eq.${req.id}`,
          status: 'eq.chosen',
          round: `eq.${rec.round}`,
          factory_company_id: `eq.${rec.company_id}`,
          select: 'id',
        },
        { status: 'expired' }
      );
      if (!locked || !locked.length) {
        await closeStale(env, rec, await loadRequest(env, rec.request_id));
        out.closed += 1;
        continue;
      }
      await updateBy(
        env,
        'production_recommendations',
        { id: `eq.${rec.id}`, response: 'is.null', select: 'id' },
        { response: 'expired' }
      );
      await noticeReturned(env, req, rec, 'expired');
      out.expired += 1;
    } catch (e) {
      out.failed += 1;
      console.error('[production] 답 없음 처리 실패:', e && e.statusCode ? e.statusCode : 'error');
    }
  }
  return out;
}
