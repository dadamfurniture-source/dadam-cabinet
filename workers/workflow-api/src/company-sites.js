/**
 * 설치 · A/S 지도 + 표 — 내 업체의 현장을 지도에 찍을 수 있게 한 목록으로 (마이페이지 「설치」 · 「A/S」).
 * 2026-11-10 대표님 승인 계획 3단계. 칸은 DB 0058.
 *
 *   GET /company/sites?kind=install[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 *     → { company, can_manage, kind, range, today, ready, truncated, items }
 *     일정 표(design_schedules)의 납품 · 설치 줄. 기간을 안 주면 지난 7일 ~ 앞으로 60일. 취소한 일정은 뺀다
 *   GET /company/sites?kind=as
 *     → { company, can_manage, kind, today, ready, truncated, items }
 *     A/S 접수(as_requests, 거둔 것 뺌 · 새 것부터 AS_FETCH 줄) + 이어진 방문 일정(visit)
 *   PUT /company/sites/geo { items: [{ design_id, address, sido, gugun, lat, lng }] }   (한 번에 GEO_BATCH 줄)
 *     → { saved, skipped }
 *     주소 → 좌표는 앱이 지도 SDK 로 바꿔 보낸다 (공개 JavaScript 키 하나 — 워커에 지도 비밀 키를 두지 않는다).
 *     보낸 address 가 지금 저장된 주소 글자와 같을 때만 적는다 → 그 사이 주소가 바뀌었으면 건너뛴다(skipped)
 *   PUT /company/as-requests/:id/visit { visit_at, assignee_name? }
 *     → { id, visit }
 *     그 접수의 방문 일정(design_schedules, type as_visit) 한 줄을 만들거나 고친다 → 업무 달력의 「A/S 방문」과 같은 줄
 *
 * 누가: 프로젝트를 가질 수 있는 업체의 active 구성원 — /company/schedules 와 같다.
 *   좌표 적기는 구성원 누구나 (주소에서 나온 값일 뿐). 방문 일정은 대표 · 실장만 (일정 고치기 = 대표 · 실장, 2026-11-10 결정).
 *   설치 일정의 날짜 · 설치팀 · 상태는 PATCH /schedules/:id 로 고친다 (대표 · 실장 — 설치일이 바뀌면 생산 계획이 다시 돈다).
 *
 * 좌표는 geo_address 가 지금 address 와 같을 때만 믿는다 (0058) — 다르면 needs_geo 로 알려 앱이 다시 바꾼다.
 * 싣는 것: 프로젝트 이름 · 설계 이름 · 수주 번호 · 현장 주소(구성원이 이미 읽을 수 있다) · 지역 · 좌표.
 * 싣지 않는 것: 고객 이름 · 전화 · 출입 메모 · 금액.
 * 0058 적용 전: 목록은 좌표 없이(ready false), 좌표 적기 · 방문 일정은 409 db_pending.
 */

import {
  ConflictError,
  NotFoundError,
  ValidationError,
  insertOne,
  restDelete,
  selectMany,
  selectOne,
  updateBy,
  updateById,
} from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { scheduleRangeOf } from './company-schedules.js';
import { SCHEDULE_LABELS } from './slack.js';
import { AS_STATE_LABEL } from './as-requests.js';
import { isMissingRelation } from './work-order-data.js';
import { assertUuid, optIso, optText } from './work/validate.js';

const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** 설치 목록 — 기간을 안 줬을 때 (지난 날 · 앞으로 올 날) */
export const SITE_PAST_DAYS = 7;
export const SITE_AHEAD_DAYS = 60;
/** 한 번에 읽는 줄 수 — 넘치면 truncated */
export const SITE_FETCH = 300;
export const AS_FETCH = 200;
/** 좌표를 한 번에 적는 줄 수 (워커 하위 요청 수를 넘지 않게) */
export const GEO_BATCH = 20;
/** 대한민국 범위 — DB 제약(0058)과 같다 */
export const GEO_BOUNDS = Object.freeze({ latMin: 32.5, latMax: 39.5, lngMin: 124.0, lngMax: 132.5 });
/** 표에 싣는 증상 글 길이 */
const BODY_MAX = 200;
const IN_CHUNK = 100;

const SITE_TYPES = Object.freeze(['delivery', 'installation']);
const SITE_COLS = 'design_id,address,address_detail';
const GEO_COLS = `${SITE_COLS},sido,gugun,lat,lng,geo_address`;
const AS_COLS = 'id,order_id,body,state,created_at,received_at,done_at';

const kstDateOf = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);
const kstTimeOf = (ms) => new Date(ms + KST_MS).toISOString().slice(11, 16);
const dayStartIso = (date, plusDays = 0) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - KST_MS + plusDays * DAY_MS).toISOString();

function conflict(message, code) {
  const err = new ConflictError(message);
  err.code = code;
  return err;
}
const dbPending = () => conflict('DB 0058 적용 전입니다 — 지도 좌표 · A/S 방문일은 적용 뒤에 됩니다', 'db_pending');

/** id 가 많으면 나눠 읽는다 (주소 줄이 길어지지 않게) */
async function selectIn(env, table, column, ids, query) {
  const out = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const rows = await selectMany(env, table, { [column]: `in.(${ids.slice(i, i + IN_CHUNK).join(',')})`, ...query });
    out.push(...(rows || []));
  }
  return out;
}

/**
 * 현장 정보 줄 (순수) → 표 · 지도에 싣는 칸.
 * 좌표는 바꾼 그때의 주소(geo_address)가 지금 주소와 같을 때만 — 주소를 고쳤으면 옛 좌표를 쓰지 않는다.
 */
export function siteOf(row) {
  const address = (row && row.address) || null;
  const lat = row ? Number(row.lat) : NaN;
  const lng = row ? Number(row.lng) : NaN;
  const fresh =
    !!address && row.geo_address === address && row.lat != null && row.lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  return {
    address,
    address_detail: (row && row.address_detail) || null,
    sido: fresh ? row.sido || null : null,
    gugun: fresh ? row.gugun || null : null,
    lat: fresh ? lat : null,
    lng: fresh ? lng : null,
    needs_geo: !!address && !fresh,
  };
}

/** 설계들의 현장 정보 → { ready, siteByDesign } (0058 전이면 좌표 칸 없이 다시 읽는다) */
async function sitesOfDesigns(env, designIds) {
  const siteByDesign = new Map();
  if (!designIds.length) return { ready: true, siteByDesign };
  let ready = true;
  let rows;
  try {
    rows = await selectIn(env, 'design_site_info', 'design_id', designIds, { select: GEO_COLS });
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    ready = false;
    rows = await selectIn(env, 'design_site_info', 'design_id', designIds, { select: SITE_COLS });
  }
  for (const r of rows) siteByDesign.set(r.design_id, siteOf(r));
  return { ready, siteByDesign };
}

const NO_SITE = Object.freeze(siteOf(null));

async function projectTitles(env, co, ids) {
  if (!ids.length) return new Map();
  const rows = await selectIn(env, 'projects', 'id', ids, { company_id: co, select: 'id,title' });
  return new Map(rows.map((p) => [p.id, p.title || null]));
}

/** 방문 일정 줄 → 표에 싣는 칸 */
function visitOf(s) {
  if (!s || !s.scheduled_at) return null;
  const ms = Date.parse(s.scheduled_at);
  return {
    schedule_id: s.id,
    day: kstDateOf(ms),
    time: kstTimeOf(ms),
    at: s.scheduled_at,
    assignee_name: s.assignee_name || null,
    status: s.status,
  };
}

/** 설치 목록의 기간 — 안 주면 지난 SITE_PAST_DAYS 일 ~ 앞으로 SITE_AHEAD_DAYS 일 */
export function siteRangeOf(query, nowMs = Date.now()) {
  const q = query || {};
  if (q.from || q.to) return scheduleRangeOf(q, nowMs);
  return {
    from: kstDateOf(nowMs - SITE_PAST_DAYS * DAY_MS),
    to: kstDateOf(nowMs + SITE_AHEAD_DAYS * DAY_MS),
  };
}

async function listInstallSites(env, { company, canAct, query }, nowMs) {
  const co = `eq.${company.id}`;
  const range = siteRangeOf(query, nowMs);
  const rows =
    (await selectMany(env, 'design_schedules', {
      scheduled_at: `gte.${dayStartIso(range.from)}`,
      type: `in.(${SITE_TYPES.join(',')})`,
      status: 'neq.cancelled',
      select: 'id,type,status,scheduled_at,assignee_name,design_id,designs!inner(company_id,name,project_id)',
      'designs.company_id': co,
      order: 'scheduled_at.asc',
      limit: String(SITE_FETCH),
    })) || [];
  const toIso = dayStartIso(range.to, 1);
  const live = rows.filter((s) => s.scheduled_at < toIso);
  const designIds = [...new Set(live.map((s) => s.design_id))];

  const [{ ready, siteByDesign }, orders, titleOf] = await Promise.all([
    sitesOfDesigns(env, designIds),
    designIds.length
      ? selectIn(env, 'orders', 'design_id', designIds, {
        company_id: co,
        status: 'neq.cancelled',
        select: 'design_id,order_no',
        order: 'created_at.desc',
      })
      : [],
    projectTitles(env, co, [...new Set(live.map((s) => (s.designs || {}).project_id).filter(Boolean))]),
  ]);
  const orderNoOf = new Map();
  for (const o of orders) if (!orderNoOf.has(o.design_id)) orderNoOf.set(o.design_id, o.order_no || null);

  return {
    company: { id: company.id, name: company.name || null },
    can_manage: canAct,
    kind: 'install',
    range,
    today: kstDateOf(nowMs),
    ready,
    truncated: rows.length >= SITE_FETCH && live.length === rows.length,
    items: live.map((s) => {
      const ms = Date.parse(s.scheduled_at);
      const d = s.designs || {};
      return {
        key: `schedule:${s.id}`,
        schedule_id: s.id,
        type: s.type,
        label: SCHEDULE_LABELS[s.type] || s.type,
        day: kstDateOf(ms),
        time: kstTimeOf(ms),
        at: s.scheduled_at,
        status: s.status,
        assignee_name: s.assignee_name || null,
        design: { id: s.design_id, name: d.name || null },
        project_id: d.project_id || null,
        project_title: (d.project_id && titleOf.get(d.project_id)) || null,
        order_no: orderNoOf.get(s.design_id) || null,
        ...(siteByDesign.get(s.design_id) || NO_SITE),
      };
    }),
  };
}

async function listAsSites(env, { company, canAct }, nowMs) {
  const co = `eq.${company.id}`;
  const base = { company_id: co, state: 'neq.cancelled', order: 'created_at.desc', limit: String(AS_FETCH) };
  let ready = true;
  let rows;
  try {
    rows = await selectMany(env, 'as_requests', { ...base, select: `${AS_COLS},visit_schedule_id` });
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    ready = false;
    try {
      rows = await selectMany(env, 'as_requests', { ...base, select: AS_COLS });
    } catch (e2) {
      // 표 자체가 아직 없다 (0045 전)
      if (!isMissingRelation(e2)) throw e2;
      rows = [];
    }
  }
  rows = rows || [];

  const orderIds = [...new Set(rows.map((r) => r.order_id).filter(Boolean))];
  const orders = orderIds.length
    ? await selectIn(env, 'orders', 'id', orderIds, { company_id: co, select: 'id,order_no,design_id,project_id' })
    : [];
  const orderOf = new Map(orders.map((o) => [o.id, o]));
  const designIds = [...new Set(orders.map((o) => o.design_id).filter(Boolean))];
  const visitIds = [...new Set(rows.map((r) => r.visit_schedule_id).filter(Boolean))];

  const [sites, designs, visits, titleOf] = await Promise.all([
    sitesOfDesigns(env, designIds),
    designIds.length ? selectIn(env, 'designs', 'id', designIds, { company_id: co, select: 'id,name' }) : [],
    visitIds.length
      ? selectIn(env, 'design_schedules', 'id', visitIds, { select: 'id,scheduled_at,assignee_name,status' })
      : [],
    projectTitles(env, co, [...new Set(orders.map((o) => o.project_id).filter(Boolean))]),
  ]);
  const designNameOf = new Map(designs.map((d) => [d.id, d.name || null]));
  const visitById = new Map(visits.map((v) => [v.id, v]));

  return {
    company: { id: company.id, name: company.name || null },
    can_manage: canAct,
    kind: 'as',
    today: kstDateOf(nowMs),
    ready: ready && sites.ready,
    truncated: rows.length >= AS_FETCH,
    items: rows.map((r) => {
      const o = orderOf.get(r.order_id) || {};
      const body = typeof r.body === 'string' ? r.body : '';
      return {
        key: `as:${r.id}`,
        as_id: r.id,
        state: r.state,
        label: AS_STATE_LABEL[r.state] || r.state,
        day: kstDateOf(Date.parse(r.created_at)),
        at: r.created_at,
        body: body.length > BODY_MAX ? `${body.slice(0, BODY_MAX)}…` : body,
        visit: visitOf(r.visit_schedule_id ? visitById.get(r.visit_schedule_id) : null),
        design: o.design_id ? { id: o.design_id, name: designNameOf.get(o.design_id) || null } : null,
        project_id: o.project_id || null,
        project_title: (o.project_id && titleOf.get(o.project_id)) || null,
        order_no: o.order_no || null,
        ...((o.design_id && sites.siteByDesign.get(o.design_id)) || NO_SITE),
      };
    }),
  };
}

/** GET /company/sites?kind=install|as */
export async function listCompanySites(env, { user, query }, nowMs = Date.now()) {
  const kind = (query && query.kind) || 'install';
  if (kind !== 'install' && kind !== 'as') throw new ValidationError('kind 는 install · as 중 하나여야 합니다');
  const { company, canAct } = await projectCompanyOf(env, user);
  return kind === 'as'
    ? listAsSites(env, { company, canAct }, nowMs)
    : listInstallSites(env, { company, canAct, query }, nowMs);
}

/** 좌표 한 줄 검사 (순수) — 틀리면 422 */
export function geoItemOf(raw) {
  const it = raw && typeof raw === 'object' ? raw : {};
  const designId = assertUuid(it.design_id, '설계 id');
  // 주소는 다듬지 않는다 — 저장된 글자와 똑같아야 그 주소의 좌표다
  if (typeof it.address !== 'string' || !it.address || it.address.length > 200)
    throw new ValidationError('address 는 1~200자 글자여야 합니다', { field: 'address' });
  const lat = Number(it.lat);
  const lng = Number(it.lng);
  const b = GEO_BOUNDS;
  if (
    typeof it.lat !== 'number' ||
    typeof it.lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < b.latMin ||
    lat > b.latMax ||
    lng < b.lngMin ||
    lng > b.lngMax
  )
    throw new ValidationError('좌표가 대한민국 범위 밖입니다', { field: 'lat' });
  return {
    design_id: designId,
    address: it.address,
    sido: optText(it.sido, 20, '시도'),
    gugun: optText(it.gugun, 30, '구군'),
    lat,
    lng,
  };
}

/** PUT /company/sites/geo */
export async function saveSiteGeo(env, { user, body }) {
  const { company } = await projectCompanyOf(env, user);
  const raw = body && body.items;
  if (!Array.isArray(raw) || !raw.length) throw new ValidationError('items 가 필요합니다', { field: 'items' });
  if (raw.length > GEO_BATCH) throw new ValidationError(`한 번에 ${GEO_BATCH}줄까지 적을 수 있습니다`, { field: 'items' });
  const items = raw.map(geoItemOf);

  // 내 업체 설계만 — 남의 설계 줄은 말없이 건너뛴다
  const ids = [...new Set(items.map((i) => i.design_id))];
  const mine = new Set(
    ((await selectMany(env, 'designs', { id: `in.(${ids.join(',')})`, company_id: `eq.${company.id}`, select: 'id' })) || []).map(
      (d) => d.id,
    ),
  );
  const now = new Date(Date.now()).toISOString();
  let saved = 0;
  let skipped = 0;
  for (const it of items) {
    if (!mine.has(it.design_id)) {
      skipped += 1;
      continue;
    }
    let out;
    try {
      out = await updateBy(
        env,
        'design_site_info',
        { design_id: `eq.${it.design_id}`, address: `eq.${it.address}`, select: 'design_id' },
        { sido: it.sido, gugun: it.gugun, lat: it.lat, lng: it.lng, geo_address: it.address, geocoded_at: now },
      );
    } catch (e) {
      if (isMissingRelation(e)) throw dbPending();
      throw e;
    }
    if (Array.isArray(out) && out.length) saved += 1;
    else skipped += 1; // 그 사이 주소가 바뀌었거나 현장 정보가 없다
  }
  return { saved, skipped };
}

/** PUT /company/as-requests/:id/visit */
export async function setAsVisit(env, { user, params, body }) {
  const id = assertUuid(params.id, '접수 id');
  const { company } = await projectCompanyOf(env, user, { manage: true });
  const visitAt = optIso(body && body.visit_at, '방문일');
  if (!visitAt) throw new ValidationError('방문일이 필요합니다', { field: 'visit_at' });
  const assignee = optText(body && body.assignee_name, 50, '담당');
  const co = `eq.${company.id}`;

  let row;
  try {
    row = await selectOne(env, 'as_requests', { id: `eq.${id}`, company_id: co, select: 'id,order_id,state,visit_schedule_id' });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  if (!row) throw new NotFoundError('접수를 찾을 수 없습니다');
  if (row.state !== 'requested' && row.state !== 'received')
    throw conflict('끝났거나 거둔 접수에는 방문일을 잡을 수 없습니다', 'closed');

  // 이미 방문 일정이 있으면 그 줄을 고친다 (취소 · 완료했던 줄은 다시 예정으로)
  if (row.visit_schedule_id) {
    const cur = await selectOne(env, 'design_schedules', { id: `eq.${row.visit_schedule_id}`, select: 'id,status' });
    if (cur) {
      const patch = { scheduled_at: visitAt, assignee_name: assignee };
      if (cur.status === 'cancelled' || cur.status === 'completed') patch.status = 'scheduled';
      const next = await updateById(env, 'design_schedules', cur.id, patch);
      return { id: row.id, visit: visitOf(next || { ...cur, ...patch }) };
    }
  }

  const order = await selectOne(env, 'orders', { id: `eq.${row.order_id}`, company_id: co, select: 'id,design_id' });
  const design =
    order && order.design_id ? await selectOne(env, 'designs', { id: `eq.${order.design_id}`, company_id: co, select: 'id' }) : null;
  if (!design) throw conflict('이 접수의 설계를 찾을 수 없어 일정을 넣지 못했습니다', 'no_design');

  const made = await insertOne(env, 'design_schedules', {
    design_id: design.id,
    batch_id: crypto.randomUUID(),
    type: 'as_visit',
    title: SCHEDULE_LABELS.as_visit || 'A/S 방문',
    scheduled_at: visitAt,
    assignee_name: assignee,
    status: 'scheduled',
    created_by: user.id,
  });
  // 그 사이 다른 사람이 방문 일정을 이었으면 내 줄을 지우고 물러난다 (한 접수 한 일정)
  const linked = await updateBy(
    env,
    'as_requests',
    { id: `eq.${row.id}`, visit_schedule_id: 'is.null', select: 'id' },
    { visit_schedule_id: made.id },
  );
  if (!Array.isArray(linked) || !linked.length) {
    await restDelete(env, 'design_schedules', { id: `eq.${made.id}` });
    throw conflict('그 사이 바뀌었습니다 — 새로 불러온 뒤 다시 해 주세요', 'stale');
  }
  return { id: row.id, visit: visitOf(made) };
}
