/**
 * Manager 업체 제작 의뢰 — 함께 쓰는 값 · 읽기 · 화면 줄 · 알림 (DB 0050 production_requests · production_recommendations).
 *
 * 2026-11-08 사장님 결정: Manager 등급(인테리어 업체)의 제작 의뢰는 다담 본사로 왔다가, 본사가 상담 내용을 파악한 뒤
 * 추천하는 업체(팩토리) 가운데 Manager 가 선택할 수 있도록 한다.
 *
 * 상태 (production_requests.status — DB 지킴이 production_requests_guard 와 같은 차례)
 *   submitted     접수 — 본사 차례
 *   recommending  본사 검토 중 — 본사 차례
 *   recommended   추천 도착 — Manager 가 고를 차례 (본사는 고르기 전까지 다시 추천할 수 있다)
 *   chosen        팩토리 답 기다림 — 고른 팩토리가 24시간 안에 받기 · 못 받음
 *   accepted      받음 (끝) — 팩토리 쪽 프로젝트 · 설계 사본과 이어짐
 *   declined      못 받음 — 본사가 다시 추천 (그 팩토리는 이 의뢰 후보에서 빠진다)
 *   expired       24시간 답 없음 — 본사가 다시 추천 (그 팩토리는 이 의뢰 후보에서 빠진다)
 *   cancelled     거둠 (끝) — accepted 전에는 Manager 가 언제든
 *
 * 쓰는 차례 (여러 줄을 한 번에 못 쓰므로 — 상담 배정 distribution/* 와 같은 방식):
 *   의뢰 줄(production_requests)이 잠금이자 정본이다 — 「읽은 상태 · 차례 그대로일 때만」 고친다.
 *   추천 줄의 chosen · response 는 기록이다. 잠금에 지면 추천 줄은 cancelled 로 닫아 남기지 않는다 (closeStale).
 *   화면은 의뢰 줄의 상태 · 차례로 추천 줄을 읽는다 (offerState).
 */

import {
  ConflictError,
  ForbiddenError,
  MONEY_ROLES,
  NotFoundError,
  activeMemberships,
  selectMany,
  selectOne,
  updateBy,
} from '../supabase.js';
import { isMissingRelation } from '../work-order-data.js';
import { FURNITURE_LABELS, regionLabel } from '../consult-notify.js';
import { ASSIGNMENT_TTL_HOURS, TOP_N, TRIED_STATES } from '../distribution/rules.js';
import { isPoolCompany } from '../distribution/score.js';
import { buildMessage } from '../push/messages.js';
import { notifyRoles } from '../push/outbox.js';
import { postToWebhook } from '../slack.js';

export const REQUEST_STATUSES = Object.freeze([
  'submitted',
  'recommending',
  'recommended',
  'chosen',
  'accepted',
  'declined',
  'expired',
  'cancelled',
]);
export const STATUS_LABEL = Object.freeze({
  submitted: '접수',
  recommending: '본사 검토 중',
  recommended: '추천 도착',
  chosen: '팩토리 답 기다림',
  accepted: '팩토리가 받음',
  declined: '팩토리가 못 받음',
  expired: '팩토리 답 없음',
  cancelled: '거둠',
});
/** 본사 차례 — 추천(다시 추천)을 기다린다 */
export const HQ_TURN = Object.freeze(['submitted', 'recommending', 'declined', 'expired']);
/** 추천할 수 있는 상태 (recommended 는 Manager 가 고르기 전에 다시 추천) */
export const RECOMMENDABLE = Object.freeze([
  'submitted',
  'recommending',
  'recommended',
  'declined',
  'expired',
]);
/** Manager 가 거둘 수 있는 상태 */
export const CANCELLABLE = Object.freeze([
  'submitted',
  'recommending',
  'recommended',
  'chosen',
  'declined',
  'expired',
]);
export const DONE = Object.freeze(['accepted', 'cancelled']);
/** 추천 줄의 팩토리 답 (DB production_recommendations_response_check) */
export const RESPONSES = Object.freeze(['accepted', 'declined', 'expired', 'cancelled']);
/** 이 답을 한 팩토리는 같은 의뢰의 후보에서 뺀다 — 상담 배정과 같다 (distribution/rules.js TRIED_STATES) */
export const TRIED_RESPONSES = TRIED_STATES;

/** 의뢰를 낼 수 있는 협력업체 등급 (companies.plan) — Manager 만. Expert · Agent 업체는 팩토리 자신이다 */
export const REQUEST_PLANS = Object.freeze(['manager']);
/** 의뢰 · 고르기 · 거두기 · 받기 · 못 받음을 하는 직책 (company_members.role — 대표 · 실장. 실장 manager 는 등급 manager 와 다르다) */
export const ACT_ROLES = MONEY_ROLES;

/** 팩토리가 답할 시간 — 상담 배정과 같은 24시간 (DB 지킴이가 고른 때 + 24시간을 찍는다) */
export const OFFER_TTL_HOURS = ASSIGNMENT_TTL_HOURS;
/** 본사가 한 번에 추천하는 팩토리 수 — 기본(화면이 미리 고르는 수)은 상담 순위와 같은 3, 많아야 5 */
export const RECOMMEND_DEFAULT = TOP_N;
export const RECOMMEND_MAX = 5;

/** 글자 수 상한 (DB CHECK 와 같다) */
export const NOTE_MAX = 1000;
export const HQ_NOTE_MAX = 500;
export const PROFILE_NOTE_MAX = 200;
export const REASON_MAX = 500;
export const LIST_LIMIT = 200;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
export const charLen = (s) => [...String(s)].length;
const HOUR_MS = 3600 * 1000;

export const REQUEST_COLUMNS =
  'id,company_id,draft_id,draft_rev,design_id,project_id,item,note,sido,gugun,wanted_done_date,status,round,hq_note,' +
  'factory_company_id,factory_project_id,factory_draft_id,created_by,created_at,updated_at,status_at';
export const REC_COLUMNS =
  'id,request_id,company_id,round,rank,note,chosen,chosen_at,expires_at,response,reason,responded_at,created_at';

export function conflict(message, code, details = null) {
  const err = new ConflictError(message, details);
  err.code = code;
  return err;
}

export const dbPending = () =>
  conflict('DB 0050 적용 전입니다 — 제작 의뢰는 적용 뒤에 됩니다', 'db_pending');

/** 0050 적용 전이면 409 db_pending */
export async function guard(job) {
  try {
    return await job();
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
}

/** 보기 — 0050 적용 전이면 ready false 로 */
export async function guardRead(job, empty) {
  try {
    return { ready: true, ...(await job()) };
  } catch (e) {
    if (isMissingRelation(e)) return { ready: false, ...empty };
    throw e;
  }
}

/** 품목 이름 — 상담 품목 키(consult-notify.js FURNITURE_LABELS)만, 아니면 null */
export const itemLabel = (item) =>
  typeof item === 'string' && Object.prototype.hasOwnProperty.call(FURNITURE_LABELS, item)
    ? FURNITURE_LABELS[item]
    : null;

/** 지역 글 — 목록에 있는 시/도 (+ 시/군/구), 아니면 '' */
export const regionOf = (row) =>
  row ? regionLabel({ sido: row.sido, gugun: row.gugun }) || '' : '';

// ── 업체 ────────────────────────────────────────────────────

/**
 * 부르는 사람의 업체 — active 구성원인 업체 (한 사람은 한 업체에만 active).
 * @returns {Promise<{ company, role, canAct }>} canAct: 대표 · 실장
 */
export async function myCompanyOf(env, user) {
  const m = (await activeMemberships(env, user))[0];
  if (!m) throw new ForbiddenError('업체 구성원만 볼 수 있습니다', 'not_member');
  const company = await selectOne(env, 'companies', {
    id: `eq.${m.company_id}`,
    select: 'id,kind,name,plan,status,sido,gugun',
  });
  if (!company) throw new ForbiddenError('업체 구성원만 볼 수 있습니다', 'not_member');
  return { company, role: m.role, canAct: ACT_ROLES.includes(m.role) };
}

/** 의뢰를 낼 수 있는 업체인가 — active 협력업체 plan manager (등급. 직책 실장과 다르다) */
export const canRequest = (company) =>
  Boolean(company) &&
  company.kind === 'partner' &&
  company.status === 'active' &&
  REQUEST_PLANS.includes(company.plan);

/** 이름 · 지역 — 업체 id → { id, kind, name, plan, status, sido, gugun } */
export async function companiesById(env, ids) {
  const list = [...new Set((ids || []).filter(isUuid))];
  if (!list.length) return new Map();
  const rows =
    (await selectMany(env, 'companies', {
      id: `in.(${list.join(',')})`,
      select: 'id,kind,name,plan,status,sido,gugun',
    })) || [];
  return new Map(rows.map((r) => [r.id, r]));
}

/** 팩토리 「하는 품목」 이름 — 상담 설정(company_service_settings.items)에서 함 · 외주인 것 */
export async function itemsOfCompanies(env, ids) {
  const list = [...new Set((ids || []).filter(isUuid))];
  const out = new Map();
  if (!list.length) return out;
  const rows =
    (await selectMany(env, 'company_service_settings', {
      company_id: `in.(${list.join(',')})`,
      select: 'company_id,items',
    })) || [];
  for (const r of rows) {
    const items = r.items && typeof r.items === 'object' ? r.items : {};
    out.set(
      r.company_id,
      Object.keys(FURNITURE_LABELS)
        .filter((k) => items[k] === 'do' || items[k] === 'outsource')
        .map((k) => FURNITURE_LABELS[k])
    );
  }
  return out;
}

// ── 의뢰 · 추천 읽기 ───────────────────────────────────────────

export async function loadRequest(env, id, { companyId = null } = {}) {
  if (!isUuid(id)) throw new NotFoundError('제작 의뢰를 찾을 수 없습니다');
  const q = { id: `eq.${id}`, select: REQUEST_COLUMNS };
  if (companyId) q.company_id = `eq.${companyId}`;
  const row = await selectOne(env, 'production_requests', q);
  if (!row) throw new NotFoundError('제작 의뢰를 찾을 수 없습니다');
  return row;
}

/** 의뢰들의 추천 줄 전부 (차례 · 순서 차례) */
export async function recsOf(env, requestIds) {
  const ids = [...new Set((requestIds || []).filter(isUuid))];
  if (!ids.length) return [];
  return (
    (await selectMany(env, 'production_recommendations', {
      request_id: `in.(${ids.join(',')})`,
      select: REC_COLUMNS,
      order: 'round.asc,rank.asc',
      limit: '5000',
    })) || []
  );
}

/** 간편 플래너 설계 요약 — `${업체}:${id}` → { name, item, rev, walls, modules } */
export async function draftsOf(env, rows) {
  const out = new Map();
  const want = rows.filter((r) => r && r.draft_id);
  if (!want.length) return out;
  const companies = [...new Set(want.map((r) => r.company_id))];
  const ids = [...new Set(want.map((r) => r.draft_id))];
  const found =
    (await selectMany(env, 'planner_drafts', {
      company_id: `in.(${companies.join(',')})`,
      // 설계 id 는 영문 · 숫자 · - 만 (DB planner_drafts_id_check) — 따옴표 없이 싣는다
      id: `in.(${ids.join(',')})`,
      select: 'company_id,id,name,item,rev,summary,discarded_at',
      limit: '1000',
    })) || [];
  for (const d of found) {
    const s = d.summary && typeof d.summary === 'object' ? d.summary : {};
    out.set(`${d.company_id}:${d.id}`, {
      name: d.name || '',
      item: d.item || null,
      rev: d.rev,
      walls: Number(s.walls) || 0,
      modules: Number(s.modules) || 0,
      discarded: Boolean(d.discarded_at),
    });
  }
  return out;
}

/** 프로젝트 제목 — id → { id, title, status } */
export async function projectsById(env, ids) {
  const list = [...new Set((ids || []).filter(isUuid))];
  if (!list.length) return new Map();
  const rows =
    (await selectMany(env, 'projects', {
      id: `in.(${list.join(',')})`,
      select: 'id,company_id,customer_id,title,status',
    })) || [];
  return new Map(rows.map((r) => [r.id, r]));
}

/** 이 의뢰를 못 받음 · 답 없음으로 돌려보낸 팩토리 — 후보에서 뺀다 */
export function triedIdsOf(recs) {
  return new Set(
    (recs || []).filter((r) => TRIED_RESPONSES.includes(r.response)).map((r) => r.company_id)
  );
}

/** 지금 차례의 추천 줄 (순서대로) */
export const currentRecs = (req, recs) =>
  (recs || [])
    .filter((r) => r.request_id === req.id && r.round === req.round && req.round > 0)
    .sort((a, b) => a.rank - b.rank);

/**
 * 고른 줄의 상태 — open(답 기다림) · accepted · declined · expired · cancelled.
 * 의뢰 줄이 정본: 추천 줄의 답이 아직 비었으면 의뢰의 상태 · 차례 · 고른 팩토리로 정한다.
 */
export function offerState(rec, req) {
  if (!rec || !rec.chosen) return null;
  if (rec.response) return rec.response;
  if (req && req.round === rec.round && req.factory_company_id === rec.company_id) {
    if (req.status === 'chosen') return 'open';
    if (['accepted', 'declined', 'expired'].includes(req.status)) return req.status;
  }
  return 'cancelled';
}

/**
 * 답이 빈 고른 줄을 의뢰 줄에 맞춰 닫는다 (잠금에 졌거나 두 번째 쓰기가 빠졌을 때). 던지지 않는다.
 * open(아직 기다림)이면 그대로 둔다.
 */
export async function closeStale(env, rec, req) {
  const state = offerState(rec, req);
  if (!state || state === 'open' || rec.response) return state;
  try {
    await updateBy(
      env,
      'production_recommendations',
      { id: `eq.${rec.id}`, response: 'is.null', select: 'id' },
      { response: state }
    );
  } catch (e) {
    console.warn('[production] 추천 줄 닫기 실패:', e && e.statusCode ? e.statusCode : 'error');
  }
  return state;
}

export function expiresAtOf(rec) {
  if (rec && rec.expires_at) return rec.expires_at;
  const t = rec && rec.chosen_at ? Date.parse(rec.chosen_at) : NaN;
  return Number.isFinite(t) ? new Date(t + OFFER_TTL_HOURS * HOUR_MS).toISOString() : null;
}

// ── 화면 줄 ──────────────────────────────────────────────────

/** 의뢰 한 줄 — 모두가 보는 칸 (점수 · 본사 내부 메모 없음) */
export function requestBase(req, { drafts = new Map(), projects = new Map() } = {}) {
  const d = req.draft_id ? drafts.get(`${req.company_id}:${req.draft_id}`) || null : null;
  const p = req.project_id ? projects.get(req.project_id) || null : null;
  return {
    id: req.id,
    status: req.status,
    label: STATUS_LABEL[req.status] || req.status,
    created_at: req.created_at,
    status_at: req.status_at,
    item: req.item || null,
    item_label: itemLabel(req.item),
    draft: req.draft_id
      ? {
          id: req.draft_id,
          name: d ? d.name : null,
          rev: req.draft_rev,
          current_rev: d ? d.rev : null,
          walls: d ? d.walls : null,
          modules: d ? d.modules : null,
        }
      : null,
    design_id: req.design_id || null,
    project: p
      ? { id: p.id, title: p.title || null }
      : req.project_id
        ? { id: req.project_id, title: null }
        : null,
    note: req.note || null,
    sido: req.sido || null,
    gugun: req.gugun || null,
    region: regionOf(req),
    wanted_done_date: req.wanted_done_date || null,
    round: req.round,
  };
}

/** 추천 팩토리 한 줄 — Manager 화면: 이름 · 지역 · 하는 품목 · 본사 소개 (점수 없음) */
export function factoryView(rec, req, { companies, items }) {
  const c = companies.get(rec.company_id) || null;
  return {
    company_id: rec.company_id,
    name: c ? c.name : null,
    kind: c ? c.kind : null,
    factory_label: c && c.kind === 'hq' ? '다담 공장' : '팩토리',
    region: c ? regionOf(c) : '',
    items: (items && items.get(rec.company_id)) || [],
    note: rec.note || null,
    rank: rec.rank,
    chosen: rec.chosen === true,
    offer: rec.chosen
      ? {
          state: offerState(rec, req),
          chosen_at: rec.chosen_at,
          expires_at: expiresAtOf(rec),
          responded_at: rec.responded_at || null,
        }
      : null,
  };
}

/** 고른 기록 (차례마다) — 팩토리 이름 · 답 · 때. withReason 은 본사 화면만 (못 받음 사유) */
export function offerHistory(req, recs, companies, { withReason = false } = {}) {
  return (recs || [])
    .filter((r) => r.request_id === req.id && r.chosen)
    .sort((a, b) => a.round - b.round)
    .map((r) => {
      const c = companies.get(r.company_id) || null;
      const row = {
        round: r.round,
        company_id: r.company_id,
        name: c ? c.name : null,
        state: offerState(r, req),
        chosen_at: r.chosen_at,
        expires_at: expiresAtOf(r),
        responded_at: r.responded_at || null,
      };
      if (withReason) row.reason = r.reason || null;
      return row;
    });
}

// ── 알림 ────────────────────────────────────────────────────

/** 업체 대표 · 실장에게 앱 알림 (던지지 않는다) */
export async function notifyActors(env, { companyId, kind, params, refId, dedupeSuffix = null }) {
  const msg = buildMessage(kind, params);
  if (!msg) return 0;
  try {
    return await notifyRoles(env, {
      companyId,
      roles: [...ACT_ROLES],
      kind,
      ...msg,
      refId,
      dedupeSuffix,
    });
  } catch {
    return 0;
  }
}

/** Slack 글에 넣는 업체 이름 — & < > 를 바꾸고(멘션 · 링크 막기) 40자까지 */
export function slackName(name) {
  const s = [
    ...String(name || '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim(),
  ]
    .slice(0, 40)
    .join('');
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '이름 없는 업체';
}

/** 본사 관리자 화면 (다음 PR) */
export const ADMIN_PAGE = '/admin/production-requests.html';

/**
 * 본사 Slack 한 메시지 (순수). kind: new(새 의뢰) | declined(못 받음) | expired(답 없음).
 * 업체 이름 · 품목 · 지역만 — 고객 이름 · 연락처 · 요청 메모 · 설계 이름은 싣지 않는다.
 */
export function buildHqSlack(kind, { managerName, item, region, adminUrl = '' } = {}) {
  const what = [slackName(managerName), itemLabel(item) || '품목 미지정', region || '']
    .filter(Boolean)
    .join(' · ');
  let line;
  if (kind === 'new') line = `새 제작 의뢰 — ${what}. 검토해 팩토리를 추천해 주세요.`;
  else if (kind === 'declined')
    line = `제작 의뢰 다시 추천 필요 — ${what}: 고른 팩토리가 못 받았습니다.`;
  else if (kind === 'expired')
    line = `제작 의뢰 다시 추천 필요 — ${what}: 고른 팩토리가 ${OFFER_TTL_HOURS}시간 안에 답하지 않았습니다.`;
  else return null;
  return {
    text: adminUrl ? `${line}\n${adminUrl}` : line,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: adminUrl ? `${line}\n<${adminUrl}|제작 의뢰 열기>` : line },
      },
    ],
  };
}

/** 본사 Slack 보내기 (던지지 않는다). 웹훅이 없으면 건너뛴다 */
export async function notifyHq(env, kind, req, managerCompany) {
  if (!env || !env.SLACK_WEBHOOK_URL) return false;
  try {
    const base = String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
    const payload = buildHqSlack(kind, {
      managerName: managerCompany ? managerCompany.name : '',
      item: req.item,
      region: regionOf(req) || regionOf(managerCompany),
      adminUrl: base ? `${base}${ADMIN_PAGE}` : '',
    });
    if (!payload) return false;
    const sent = await postToWebhook(env, payload);
    if (!sent || !sent.ok) console.warn('[production] 본사 Slack 실패:', kind);
    return Boolean(sent && sent.ok);
  } catch (e) {
    console.warn('[production] 본사 Slack 실패:', kind, e && e.message ? 'error' : '');
    return false;
  }
}

/** 응답을 막지 않고 뒤에서 (ctx 가 없으면 기다린다) */
export async function later(ctx, job) {
  const p = Promise.resolve(job).catch(() => null);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  else await p;
}

/** 팩토리 풀 안인가 (상담 분배와 같은 풀 — 다담 공장 · 활동 중 Expert · Agent) */
export const inPool = (company) => isPoolCompany(company);
