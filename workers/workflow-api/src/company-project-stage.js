/**
 * 프로젝트 한 건의 단계 — 띠에 적는 날짜 · 걸린 날(timelineOf)과, 누른 단계의 자료(GET …/stages/:key).
 * (2026-11-23 대표님 승인 계획 「프로젝트 관리 새 틀」 — 「선형 단계를 찍으면 어떤 사진 및 도면, 정보들이 있는지 한눈에」)
 *
 *   GET /company/projects/:id/stages/:key   내 업체 프로젝트의 한 단계 (active 구성원)
 *     key = consult | measure | design | quote | contract | make | install | done(A/S)
 *     { key, label, …그 단계의 자료 }
 *       consult   { consults [{ id, created_at, sido, gugun, categories, door_finish, demolition_needed, price_tier,
 *                               preferred_date, preferred_time, wanted_done_date, description, has_image }] }
 *                 그림은 GET /company/consults/:id/image 로 받는다 (버킷 경로 · 서명 주소는 싣지 않는다 — 지금 규칙 그대로)
 *       measure   { ready, visit { id, status, scheduled_at, assignee_id, assignee_name, note, done_at } | null, photos[] }
 *                 photos = 플래너에 넣은 현장사진
 *       design    { designs [{ id, name, created_at, updated_at }], drafts [{ id, name, updated_at, walls, modules }],
 *                   renders [{ design_id, kind, url }], photos[] }      renders = 앱으로 보낸 설계의 정면 · 입체 · 평면 · 배치
 *       quote     { quotes [{ id, design_id, doc_no, rev, current, created_at, expires_at, first_viewed_at, view_count,
 *                             decision, decided_at, total, reasons[] }] }   total = 고객 금액 (견적 목록과 같다 — 구성원 모두)
 *       contract  { orders [{ id, order_no, status, ordered_at, amount, payments [{ stage, due_on, paid_on, amount }] }],
 *                   approvals [{ order_id, state, created_at, decided_at }] }  amount 는 대표 · 실장에게만 (그 밖은 null)
 *       make      { schedules[], documents[], photos[], requests[] }       일정 = 자재 발주 · 제작 착수 · 제작 완료 · 검수
 *       install   { schedules[], documents[], reports[], photos[] }        일정 = 납품 · 설치(+ 고객 확인)
 *       done      { as [{ id, state, label, body, created_at, received_at, done_at, photo_urls[] }], reports[], schedules[] }
 *     schedules [{ id, type, label, status, scheduled_at, started_at, completed_at, assignee_name, customer_confirmed_at? }]
 *     documents [{ id, design_id, doc_type, doc_no, rev, status, created_at }]   보기는 GET /documents/:id/print
 *     reports   [{ id, kind, label, note, created_at, photo_urls[] }]
 *     photos    [{ url, kind, label, at, note }]   사진 주소는 한 시간짜리 서명 주소다
 *     어느 단계에나 (DB 0083 · src/company-project-files.js):
 *       uploads { ready, max, count }   ready = 사진을 올릴 수 있다 (표가 있다) · max = 한 단계에 올리는 수 · count = 지금 올려 둔 수
 *       photos 맨 앞에 올린 사진 [{ id, url, kind: 'upload', label: '올린 사진', at, note, mine }] — mine = 내가 지울 수 있다
 *
 * 프로젝트 창(GET /company/projects/:id)에는 금액 · 사진을 싣지 않는다는 약속이 있어 이 길을 따로 냈다.
 * 읽기만 한다. 다른 업체의 프로젝트 · 없는 프로젝트는 404. 표가 아직 없으면(DB 적용 전) 그 칸만 빈다.
 * 고객 주소 · 연락처는 싣지 않는다 (목록 · 지도 화면이 따로 준다).
 */

import { MONEY_ROLES, NotFoundError, ValidationError, selectMany, selectOne } from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { isFactory } from './company-pipeline.js';
import { membersOf } from './company-assignee.js';
import { isMissingRelation } from './work-order-data.js';
import { STEPS, STEP_LABEL } from './pipeline.js';
import { visitOf } from './company-project-visits.js';
import { createSignedUrls, RENDERS_BUCKET } from './storage.js';
import { quoteTotals } from './company-quotes.js';
import { REPORT_BUCKET, REPORT_KIND_LABEL } from './order-reports.js';
import { AS_BUCKET, AS_STATE_LABEL } from './as-requests.js';
import { CHECK_PHOTO_BUCKET } from './work/checks.js';
import { PHOTOS_BUCKET } from './planner-drafts.js';
import { SCHEDULE_LABELS } from './slack.js';
import { stageUploads } from './company-project-files.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86400000;
/** 한 단계에서 읽는 행 수 */
const ROW_LIMIT = '100';
/** 한 단계에 싣는 사진 수 */
export const STAGE_PHOTOS_MAX = 40;
/** 플래너 사진 종류 → 어느 단계에 보이나 (planner model.js PHOTO_KINDS) */
const PLANNER_KIND_LABEL = Object.freeze({ site: '현장사진', ai: 'AI 연출', complete: '시공 완료' });
/** 작업자 확인 사진 — 역할 이름 (work_checks.role) */
const CHECK_ROLE_LABEL = Object.freeze({
  cut: '재단 확인',
  edge: '엣지 확인',
  assembly: '조립 확인',
  install: '설치 확인',
  demolition: '철거 확인',
  delivery: '납품 확인',
});
const RENDER_KIND_LABEL = Object.freeze({ front: '정면도', iso: '입체', plan: '평면', layout: '배치' });
const DOC_LABEL = Object.freeze({
  work_order: '작업지시서',
  installation_order: '설치 지시서',
  delivery_order: '납품 지시서',
  demolition_order: '철거 지시서',
});

// ── 단계 띠 (순수) ─────────────────────────────────────────────

/**
 * 단계 띠 — 단계마다 들어간 때 · 나간 때 · 걸린 날.
 * @param {{ step: string, visit_ready?: boolean, created_at?: string, closed_at?: string, since?: string,
 *           visit?: { status, created_at, done_at }|null, design_at?: string|null, quote_at?: string|null,
 *           order?: { ordered_at, delivered_at, completed_at }|null, make_at?: string|null }} f
 *   visit = 취소 아닌 가장 이른 실측 · design_at = 첫 설계가 이어진 때 · quote_at = 첫 견적을 보낸 때 ·
 *   order = 취소 아닌 가장 이른 수주 · make_at = 생산을 시작한 때 · since = 다음 할 일의 since (들어간 때를 모를 때 쓴다)
 * @returns {Array<{ key, label, state: 'done'|'now'|'todo', from: string|null, to: string|null, days: number|null }>}
 *   days = 끝난 단계는 걸린 날, 지금 단계는 오늘까지 머문 날. 「끝」 칸과 때를 모르는 칸은 null
 */
export function timelineOf(f, nowMs = Date.now()) {
  const fact = f && typeof f === 'object' ? f : {};
  const order = fact.order || null;
  const visit = fact.visit || null;
  const visitDone = visit && visit.status === 'done' ? visit.done_at || null : null;
  const enter = {
    consult: fact.created_at || null,
    measure: visit ? visit.created_at || null : null,
    design: visitDone || fact.design_at || null,
    quote: fact.quote_at || null,
    contract: order ? order.ordered_at || null : null,
    make: fact.make_at || null,
    install: order ? order.delivered_at || null : null,
    done: (order && order.completed_at) || fact.closed_at || null,
  };
  const keys = STEPS.filter((k) => k !== 'measure' || fact.visit_ready === true);
  const at = keys.indexOf(fact.step);
  const span = (a, b) => {
    const x = Date.parse(a || '');
    const y = typeof b === 'number' ? b : Date.parse(b || '');
    return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / DAY_MS) : null;
  };
  return keys.map((key, i) => {
    const state = at < 0 || i > at ? 'todo' : i < at ? 'done' : 'now';
    let from = state === 'todo' ? null : enter[key];
    let to = null;
    if (state === 'done') {
      // 나간 때 = 그 뒤로 처음 들어간 단계의 때
      for (let j = i + 1; j <= at && !to; j++) to = enter[keys[j]] || null;
    }
    if (state === 'now' && !from) from = fact.since || null;
    let days = null;
    if (key !== 'done') days = state === 'done' ? span(from, to) : state === 'now' ? span(from, nowMs) : null;
    return { key, label: STEP_LABEL[key], state, from, to, days };
  });
}

// ── 단계 자료 ─────────────────────────────────────────────────

/** 표 · 칸이 아직 없으면(DB 적용 전) 빈 목록 — 그 밖의 오류는 그대로 던진다 */
async function orEmpty(promise) {
  try {
    return (await promise) || [];
  } catch (e) {
    if (isMissingRelation(e)) return [];
    throw e;
  }
}

/** 경로 → 서명 주소. 못 만들면 사진 없이 (자료는 그대로 준다) */
async function sign(env, bucket, paths) {
  if (!paths.length) return new Map();
  try {
    return await createSignedUrls(env, bucket, paths);
  } catch (e) {
    console.warn('[project-stage] 사진 서명 주소 실패:', e && e.message);
    return new Map();
  }
}

const inList = (ids) => `in.(${ids.join(',')})`;

function designsOf(c) {
  return selectMany(c.env, 'designs', {
    project_id: c.pid,
    company_id: c.co,
    select: 'id,name,source,source_ref,created_at,updated_at',
    order: 'updated_at.desc',
    limit: ROW_LIMIT,
  }).then((rows) => rows || []);
}

function ordersOf(c, extra = '') {
  return selectMany(c.env, 'orders', {
    project_id: c.pid,
    company_id: c.co,
    select: `id,order_no,status,ordered_at,delivered_at,completed_at${extra}`,
    order: 'ordered_at.desc,created_at.desc',
    limit: ROW_LIMIT,
  }).then((rows) => rows || []);
}

const scheduleRow = (s, confirm) => ({
  id: s.id,
  type: s.type,
  label: SCHEDULE_LABELS[s.type] || s.type,
  status: s.status,
  scheduled_at: s.scheduled_at,
  started_at: s.started_at || null,
  completed_at: s.completed_at || null,
  assignee_name: s.assignee_name || null,
  ...(confirm && s.type === 'installation' ? { customer_confirmed_at: s.customer_confirmed_at || null } : {}),
});

/** 그 설계들의 일정 — types 만. 고객 확인 칸(DB 0079)은 있을 때만 싣는다 */
async function schedulesOf(c, designIds, types, { confirm = false } = {}) {
  if (!designIds.length) return [];
  const cols = 'id,design_id,type,status,scheduled_at,started_at,completed_at,assignee_name';
  const read = (select) =>
    selectMany(c.env, 'design_schedules', {
      design_id: inList(designIds),
      type: inList(types),
      select,
      order: 'scheduled_at.asc',
      limit: ROW_LIMIT,
    });
  let withConfirm = confirm;
  let rows;
  try {
    rows = await read(confirm ? `${cols},customer_confirmed_at` : cols);
  } catch (e) {
    if (!confirm || !isMissingRelation(e)) throw e;
    withConfirm = false;
    rows = await read(cols);
  }
  return (rows || []).map((s) => scheduleRow(s, withConfirm));
}

/** 그 설계들의 지시서 (거둔 것 뺌, 새 것부터) */
async function documentsOf(c, designIds, types) {
  if (!designIds.length) return [];
  const rows =
    (await selectMany(c.env, 'design_documents', {
      design_id: inList(designIds),
      doc_type: inList(types),
      status: 'neq.revoked',
      select: 'id,design_id,doc_type,doc_no,rev,status,created_at',
      order: 'created_at.desc',
      limit: ROW_LIMIT,
    })) || [];
  return rows.map((d) => ({
    id: d.id,
    design_id: d.design_id,
    doc_type: d.doc_type,
    label: DOC_LABEL[d.doc_type] || d.doc_type,
    doc_no: d.doc_no || null,
    rev: d.rev || null,
    status: d.status,
    created_at: d.created_at,
  }));
}

/** 작업자 확인 사진 — 그 수주들의 그 역할들 (새 것부터) */
async function checkPhotosOf(c, orderIds, roles) {
  if (!orderIds.length) return [];
  const rows = await orEmpty(
    selectMany(c.env, 'work_checks', {
      order_id: inList(orderIds),
      company_id: c.co,
      role: inList(roles),
      checked: 'eq.true',
      photo_path: 'not.is.null',
      select: 'role,photo_path,created_at',
      order: 'created_at.desc',
      limit: String(STAGE_PHOTOS_MAX),
    })
  );
  const urls = await sign(c.env, CHECK_PHOTO_BUCKET, rows.map((r) => r.photo_path));
  return rows
    .filter((r) => urls.has(r.photo_path))
    .map((r) => ({ url: urls.get(r.photo_path), kind: 'check', label: CHECK_ROLE_LABEL[r.role] || r.role, at: r.created_at, note: null }));
}

/** 완료 보고 — 그 수주들의 그 종류 (새 것부터), 사진은 서명 주소 */
async function reportsOf(c, orderIds, kind) {
  if (!orderIds.length) return [];
  const rows = await orEmpty(
    selectMany(c.env, 'order_reports', {
      order_id: inList(orderIds),
      company_id: c.co,
      kind: `eq.${kind}`,
      select: 'id,kind,note,photos,created_at',
      order: 'created_at.desc',
      limit: ROW_LIMIT,
    })
  );
  const photos = (r) => (Array.isArray(r.photos) ? r.photos : []);
  const urls = await sign(c.env, REPORT_BUCKET, rows.flatMap(photos));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    label: REPORT_KIND_LABEL[r.kind] || r.kind,
    note: r.note || null,
    created_at: r.created_at,
    photo_urls: photos(r).map((p) => urls.get(p) || null).filter(Boolean),
  }));
}

/**
 * 이 프로젝트의 플래너 초안과 그 사진 — { drafts, photos }.
 * 초안 = 요약의 projectId 가 이 프로젝트거나, 앱으로 보낸 설계의 원본(designs.source_ref).
 * 사진 = 초안에 달려 있고(model.photos) 지우지 않은 것. 종류(현장 · AI · 시공 완료)는 초안이 적어 둔 대로.
 */
async function plannerOf(c, designs) {
  const all = await orEmpty(
    selectMany(c.env, 'planner_drafts', {
      company_id: c.co,
      discarded_at: 'is.null',
      select: 'id,name,updated_at,summary,project_id:summary->>projectId,photos:model->photos',
      order: 'updated_at.desc',
      limit: '200',
    })
  );
  const refs = new Set(designs.map((d) => d.source_ref).filter(Boolean));
  const mine = all.filter((d) => d.project_id === c.project.id || refs.has(d.id));
  const drafts = mine.map((d) => {
    const s = d.summary && typeof d.summary === 'object' ? d.summary : {};
    return { id: d.id, name: d.name || null, updated_at: d.updated_at || null, walls: Number(s.walls) || 0, modules: Number(s.modules) || 0 };
  });
  if (!mine.length) return { drafts, photos: [] };
  const stored = await orEmpty(
    selectMany(c.env, 'planner_draft_photos', {
      company_id: c.co,
      draft_id: inList(mine.map((d) => d.id)),
      deleted_at: 'is.null',
      select: 'draft_id,file,created_at',
      limit: '500',
    })
  );
  const live = new Map(stored.map((r) => [`${r.draft_id}/${r.file}`, r]));
  const list = [];
  for (const d of mine) {
    for (const ph of Array.isArray(d.photos) ? d.photos : []) {
      const file = ph && typeof ph === 'object' ? ph.file || ph.id : null;
      const row = typeof file === 'string' ? live.get(`${d.id}/${file}`) : null;
      if (!row) continue;
      list.push({
        path: `${c.company.id}/${d.id}/${file}`,
        kind: ph.kind in PLANNER_KIND_LABEL ? ph.kind : 'ai',
        at: (typeof ph.addedAt === 'string' && ph.addedAt) || row.created_at,
        note: typeof ph.note === 'string' && ph.note ? ph.note.slice(0, 200) : null,
      });
    }
  }
  const kept = list.slice(0, STAGE_PHOTOS_MAX * 3);
  const urls = await sign(c.env, PHOTOS_BUCKET, kept.map((p) => p.path));
  const photos = kept
    .filter((p) => urls.has(p.path))
    .map((p) => ({ url: urls.get(p.path), kind: p.kind, label: PLANNER_KIND_LABEL[p.kind], at: p.at, note: p.note }));
  return { drafts, photos };
}

const plannerPhotos = (planner, kinds) => planner.photos.filter((p) => kinds.includes(p.kind)).slice(0, STAGE_PHOTOS_MAX);

const LOADERS = {
  async consult(c) {
    const rows =
      (await selectMany(c.env, 'consultations', {
        company_id: c.co,
        project_id: c.pid,
        select:
          'id,origin_consultation_id,status,created_at,sido,gugun,furniture_categories,door_finish,demolition_needed,' +
          'wanted_price_tier,preferred_date,preferred_time,wanted_done_date,description',
        order: 'created_at.asc',
        limit: '10',
      })) || [];
    const live = rows.filter((r) => r.status !== 'returned');
    const originIds = [...new Set(live.map((r) => r.origin_consultation_id).filter((id) => UUID_RE.test(String(id || ''))))];
    const origins = originIds.length
      ? (await selectMany(c.env, 'consultations', { id: inList(originIds), select: 'id,generation_id' })) || []
      : [];
    const withImage = new Set(origins.filter((o) => o.generation_id).map((o) => o.id));
    return {
      consults: live.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        sido: r.sido || null,
        gugun: r.gugun || null,
        categories: r.furniture_categories || [],
        door_finish: r.door_finish ?? null,
        demolition_needed: r.demolition_needed ?? null,
        price_tier: r.wanted_price_tier ?? null,
        preferred_date: r.preferred_date || null,
        preferred_time: r.preferred_time || null,
        wanted_done_date: r.wanted_done_date ?? null,
        description: r.description ?? null,
        has_image: withImage.has(r.origin_consultation_id),
      })),
    };
  },

  async measure(c) {
    let ready = true;
    let rows = [];
    try {
      rows =
        (await selectMany(c.env, 'project_visits', {
          company_id: c.co,
          project_id: c.pid,
          select: 'id,status,scheduled_at,assignee_id,assignee_name,note,done_at,created_at',
          order: 'created_at.desc',
          limit: '20',
        })) || [];
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
      ready = false;
    }
    const row = rows.find((r) => r.status !== 'cancelled') || null;
    const [members, designs] = await Promise.all([row && row.assignee_id ? membersOf(c.env, c.company.id) : [], designsOf(c)]);
    const planner = await plannerOf(c, designs);
    return {
      ready,
      visit: visitOf(row, new Map(members.map((m) => [m.user_id, m]))),
      photos: plannerPhotos(planner, ['site']),
    };
  },

  async design(c) {
    const designs = await designsOf(c);
    const designIds = designs.map((d) => d.id);
    const [planner, renders] = await Promise.all([
      plannerOf(c, designs),
      designIds.length
        ? orEmpty(
            selectMany(c.env, 'design_renders', {
              design_id: inList(designIds),
              kind: 'in.(front,iso,plan,layout)',
              select: 'design_id,item_unique_id,kind,path,created_at',
              order: 'created_at.desc',
              limit: ROW_LIMIT,
            })
          )
        : [],
    ]);
    // 설계 · 품목 · 종류마다 가장 새 그림 하나
    const seen = new Set();
    const latest = renders.filter((r) => {
      const k = `${r.design_id}/${r.item_unique_id}/${r.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const urls = await sign(c.env, RENDERS_BUCKET, latest.map((r) => r.path));
    return {
      designs: designs.map((d) => ({ id: d.id, name: d.name || null, created_at: d.created_at || null, updated_at: d.updated_at || null })),
      drafts: planner.drafts,
      renders: latest
        .filter((r) => urls.has(r.path))
        .slice(0, STAGE_PHOTOS_MAX)
        .map((r) => ({ design_id: r.design_id, kind: r.kind, label: RENDER_KIND_LABEL[r.kind] || r.kind, url: urls.get(r.path), at: r.created_at })),
      photos: plannerPhotos(planner, ['ai']),
    };
  },

  async quote(c) {
    const designs = await designsOf(c);
    const rows = designs.length
      ? (await selectMany(c.env, 'design_documents', {
          design_id: inList(designs.map((d) => d.id)),
          doc_type: 'eq.customer_confirmation',
          status: 'neq.revoked',
          select:
            'id,design_id,doc_no,rev,status,decision,decided_at,first_viewed_at,view_count,expires_at,superseded_by,created_at,totals,' +
            'reasons:render_payload->decision_reasons',
          order: 'created_at.desc',
          limit: ROW_LIMIT,
        })) || []
      : [];
    return {
      quotes: rows.map((d) => {
        const totals = quoteTotals(d.totals);
        return {
          id: d.id,
          design_id: d.design_id,
          doc_no: d.doc_no || null,
          rev: d.rev || null,
          // 지금 판 — 새 판에 밀리지 않은 것
          current: d.status !== 'superseded' && !d.superseded_by,
          created_at: d.created_at,
          expires_at: d.expires_at || null,
          first_viewed_at: d.first_viewed_at || null,
          view_count: d.view_count || 0,
          decision: d.decision || null,
          decided_at: d.decided_at || null,
          total: totals ? totals.total : null,
          reasons: Array.isArray(d.reasons) ? d.reasons.filter((x) => typeof x === 'string') : [],
        };
      }),
    };
  },

  async contract(c) {
    const orders = await ordersOf(c, c.money ? ',contract_amount' : '');
    const ids = orders.map((o) => o.id);
    const [payments, events] = ids.length
      ? await Promise.all([
          orEmpty(
            selectMany(c.env, 'order_payments', {
              order_id: inList(ids),
              select: `order_id,stage,due_on,paid_on${c.money ? ',amount' : ''}`,
              order: 'due_on.asc',
              limit: ROW_LIMIT,
            })
          ),
          selectMany(c.env, 'order_events', {
            order_id: inList(ids),
            company_id: c.co,
            state: 'in.(pending,approved,rejected)',
            select: 'order_id,state,created_at,decided_at',
            order: 'created_at.asc',
            limit: ROW_LIMIT,
          }),
        ])
      : [[], []];
    const amount = (v) => (c.money && Number.isFinite(Number(v)) ? Number(v) : null);
    return {
      orders: orders.map((o) => ({
        id: o.id,
        order_no: o.order_no || null,
        status: o.status,
        ordered_at: o.ordered_at || null,
        amount: amount(o.contract_amount),
        payments: payments
          .filter((p) => p.order_id === o.id)
          .map((p) => ({ stage: p.stage, due_on: p.due_on || null, paid_on: p.paid_on || null, amount: amount(p.amount) })),
      })),
      approvals: (events || []).map((e) => ({ order_id: e.order_id, state: e.state, created_at: e.created_at, decided_at: e.decided_at || null })),
    };
  },

  async make(c) {
    const [designs, orders] = await Promise.all([designsOf(c), ordersOf(c)]);
    const designIds = designs.map((d) => d.id);
    const orderIds = orders.filter((o) => o.status !== 'cancelled').map((o) => o.id);
    const [schedules, documents, photos, requests] = await Promise.all([
      schedulesOf(c, designIds, ['material_order', 'manufacturing_start', 'manufacturing_end', 'quality_check']),
      documentsOf(c, designIds, ['work_order']),
      checkPhotosOf(c, orderIds, ['cut', 'edge', 'assembly']),
      c.factory
        ? []
        : orEmpty(
            selectMany(c.env, 'production_requests', {
              project_id: c.pid,
              company_id: c.co,
              status: 'neq.cancelled',
              select: 'id,status,status_at',
              order: 'status_at.desc',
              limit: ROW_LIMIT,
            })
          ),
    ]);
    return {
      schedules,
      documents,
      photos,
      requests: requests.map((r) => ({ id: r.id, status: r.status, status_at: r.status_at || null })),
    };
  },

  async install(c) {
    const [designs, orders] = await Promise.all([designsOf(c), ordersOf(c)]);
    const designIds = designs.map((d) => d.id);
    const orderIds = orders.filter((o) => o.status !== 'cancelled').map((o) => o.id);
    const [schedules, documents, reports, checks, planner] = await Promise.all([
      schedulesOf(c, designIds, ['delivery', 'installation'], { confirm: true }),
      documentsOf(c, designIds, ['installation_order', 'delivery_order', 'demolition_order']),
      reportsOf(c, orderIds, 'install_done'),
      checkPhotosOf(c, orderIds, ['install', 'demolition', 'delivery']),
      plannerOf(c, designs),
    ]);
    return { schedules, documents, reports, photos: checks.concat(plannerPhotos(planner, ['complete'])).slice(0, STAGE_PHOTOS_MAX) };
  },

  async done(c) {
    const [designs, orders] = await Promise.all([designsOf(c), ordersOf(c)]);
    const orderIds = orders.filter((o) => o.status !== 'cancelled').map((o) => o.id);
    const [rows, reports, schedules] = await Promise.all([
      c.factory && orderIds.length
        ? orEmpty(
            selectMany(c.env, 'as_requests', {
              order_id: inList(orderIds),
              company_id: c.co,
              state: 'neq.cancelled',
              select: 'id,body,photos,state,created_at,received_at,done_at',
              order: 'created_at.desc',
              limit: ROW_LIMIT,
            })
          )
        : [],
      reportsOf(c, orderIds, 'as_done'),
      schedulesOf(c, designs.map((d) => d.id), ['as_visit']),
    ]);
    const photos = (r) => (Array.isArray(r.photos) ? r.photos : []);
    const urls = await sign(c.env, AS_BUCKET, rows.flatMap(photos));
    return {
      as: rows.map((r) => ({
        id: r.id,
        state: r.state,
        label: AS_STATE_LABEL[r.state] || r.state,
        body: r.body || null,
        created_at: r.created_at,
        received_at: r.received_at || null,
        done_at: r.done_at || null,
        photo_urls: photos(r).map((p) => urls.get(p) || null).filter(Boolean),
      })),
      reports,
      schedules,
    };
  },
};

/** GET /company/projects/:id/stages/:key */
export async function getCompanyProjectStage(env, { user, params }) {
  const projectId = params && params.id;
  const key = params && params.key;
  if (typeof projectId !== 'string' || !UUID_RE.test(projectId)) throw new ValidationError('프로젝트 번호가 올바르지 않습니다');
  if (typeof key !== 'string' || !STEPS.includes(key)) throw new ValidationError('단계 이름이 올바르지 않습니다', { field: 'key' });
  const { company, role } = await projectCompanyOf(env, user);
  const co = `eq.${company.id}`;
  const project = await selectOne(env, 'projects', { id: `eq.${projectId}`, company_id: co, select: 'id,status,created_at' });
  if (!project) throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  const [body, up] = await Promise.all([
    LOADERS[key]({
      env,
      company,
      co,
      project,
      pid: `eq.${project.id}`,
      money: MONEY_ROLES.includes(role),
      factory: isFactory(company),
    }),
    stageUploads(env, { company, role, user, projectId: project.id, stage: key }),
  ]);
  // 올린 사진이 맨 앞 — 그 단계가 원래 주던 사진(플래너 · 작업자 확인 · 완료 보고)은 그 뒤에
  return {
    key,
    label: STEP_LABEL[key],
    ...body,
    uploads: { ready: up.ready, max: up.max, count: up.photos.length },
    photos: [...up.photos, ...(Array.isArray(body.photos) ? body.photos : [])],
  };
}
