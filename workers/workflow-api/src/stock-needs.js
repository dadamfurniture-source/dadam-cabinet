/**
 * 작업지시 자재 ↔ 재고 — 수주마다 필요한 자재와 재고 상태, 짝표, 수주 자재 출고, 자투리 후보.
 * 표 · 함수: database/migrations/0063_stock_links.sql (stock_links · stock_issues · stock_issue()).
 * (2026-11-12 사장님 결정 — 판재는 재질 + 두께로 짝짓는다 · 출고는 사람이 누를 때 · 재단에서 남는 조각은 후보로만)
 *
 *   GET  /stock/needs                       진행 중 수주(계약 확정 · 제작 중)의 자재 상태 (구성원)
 *     { can_manage, counts { ok, expected, short, unlinked, nodoc, issued },
 *       orders [{ id, order_no, name, status, due, issued, has_doc, has_plan, state,
 *                 lines [{ key, kind, label, need, unit, state, item { id, name, spec, unit, qty } | null }] }],
 *       materials [{ key, kind, label, unit, need, orders, ignored, item { id, name, spec, unit } | null }] }
 *     줄 state: ok 재고 있음 · expected 입고 예정까지 치면 됨 · short 없음 · unlinked 짝 없음 · ignored 재고에서 다루지 않음
 *     수주 state: 줄 가운데 가장 나쁜 것 (short > unlinked > expected > ok), 작업지시서가 없으면 nodoc, 이미 출고했으면 issued
 *     재고는 납기(설치 일정, 없으면 수주한 날) 빠른 수주부터 채운다. 이미 출고한 수주는 채우는 데서 뺀다.
 *   PUT  /stock/links                       짝 정하기 (대표 · 실장) { key, label, item_id } | { key, label, ignored: true } | { key } (짝 풀기)
 *   POST /stock/needs/:orderId/issue        수주 자재 출고 (구성원 — 출고는 누구나) { lines [{ item_id, qty }] (1 ~ ISSUE_LINES_MAX) }
 *     한 번에 뺀다. 같은 수주는 한 번만(409 issued), 모자라면 422(아무것도 안 바뀜). 기록에 수주 번호가 남는다.
 *   GET  /stock/needs/:orderId/offcuts      그 수주 재단 배치에서 남을 조각 후보 (구성원)
 *     { order_no, items [{ material, thickness_mm, width_mm, height_mm, sheet_no }] } — 긴 변 600 · 짝은 변 400 이상만
 *
 * 자재가 어디서 오나  수주 → 설계 → 지금 작업지시서(새 판에 밀리지 않고 회수되지 않은 마지막 rev) → 그 문서의 스냅샷.
 *   판재: 재단 배치 요약 sheetsByMaterial { '재질_두께': 장수 } — 문서에 고정된 배치가 먼저, 없으면 스냅샷의 것. 배치가 없으면 판재 줄이 없다(has_plan false).
 *   철물: hardware_payload.hardware[] 를 분류 + 이름으로 모은다.
 * 누가       stock.js 와 같다 (stockCompanyOf — 다담 공장 · active Expert · Agent 구성원).
 * 다른 업체   수주 · 짝표 · 품목 모두 company_id 로 거른다. 남의 수주 id 는 404, 남의 품목 id 는 422.
 * 고객 정보   싣지 않는다 — 수주 번호와 설계 이름까지. 금액도 없다.
 * DB 0063 적용 전이면 409 db_pending.
 */

import { ConflictError, DbError, NotFoundError, ValidationError, callRpc, insertOne, restDelete, selectMany, selectOne, updateBy } from './supabase.js';
import { stockCompanyOf, qtyOf, STOCK_ITEMS_LIMIT } from './stock.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** 한 번에 보는 진행 중 수주 수 */
export const NEEDS_ORDERS = 40;
export const ISSUE_LINES_MAX = 100;
export const KEY_MAX = 200;
/** 자재 상태를 보는 수주 상태 — 계약 확정 · 제작 중 */
export const OPEN_STATUSES = Object.freeze(['confirmed', 'in_production']);
/** 자투리 후보로 보여 주는 크기 — 자투리 화면의 「쓸 수 있는 것」과 같다 */
export const CANDIDATE_MIN = Object.freeze({ long: 600, short: 400 });
/** 나쁜 차례 */
const RANK = { ok: 0, ignored: 0, expected: 1, unlinked: 2, short: 3 };
const UNIT_NAME = { EA: '개', SET: '세트', PAIR: '쌍' };

function dbPending() {
  const err = new ConflictError('DB 0063 적용 전입니다 — 자재 잇기는 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}
const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883/.test(String(e.message || ''));
const codeIn = (e, code) => e instanceof DbError && String(e.message || '').includes(`"${code}"`);
async function db(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    throw e;
  }
}

// ── 순수 ──────────────────────────────────────────────────────

const clean = (v) => String(v == null ? '' : v).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** 판재 키 — 재질 + 두께 */
export function boardKey(material, thickness) {
  const m = clean(material);
  const t = Number(thickness);
  return m && Number.isFinite(t) && t > 0 ? { key: `B|${m}|${t}`, label: `${m} ${t}T` } : null;
}

/** 철물 키 — 분류 + 이름 */
export function hardwareKey(category, item) {
  const c = clean(category);
  const i = clean(item);
  if (!i) return null;
  return { key: `H|${c}|${i}`.slice(0, KEY_MAX), label: (c ? `${c} · ${i}` : i).slice(0, KEY_MAX) };
}

/** 재단 배치 요약 → 판재 줄. '재질_두께' 의 마지막 _ 에서 가른다 */
export function boardNeeds(sheetsByMaterial) {
  const out = [];
  if (!isPlainObject(sheetsByMaterial)) return out;
  for (const [k, v] of Object.entries(sheetsByMaterial)) {
    const at = k.lastIndexOf('_');
    const n = Number(v);
    const key = at > 0 ? boardKey(k.slice(0, at), k.slice(at + 1)) : null;
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    out.push({ ...key, kind: 'board', need: Math.ceil(n * 100) / 100, unit: '장' });
  }
  return out;
}

/** 철물 행들 → 분류 + 이름으로 모은 줄 */
export function hardwareNeeds(rows) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isPlainObject(r)) continue;
    const key = hardwareKey(r.category, r.item);
    const n = Number(r.qty);
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    const unit = UNIT_NAME[String(r.unit || '').toUpperCase()] || clean(r.unit).slice(0, 8) || '개';
    const cur = by.get(key.key);
    if (cur) cur.need = Math.round((cur.need + n) * 100) / 100;
    else by.set(key.key, { ...key, kind: 'hardware', need: Math.round(n * 100) / 100, unit });
  }
  return [...by.values()];
}

/**
 * 재고를 수주 차례대로 채운다.
 * orders = [{ id, issued, has_doc, needs[] }] (납기 빠른 차례) · links = Map(key → { item_id, ignored }) · items = Map(id → { qty, expected })
 * → orders 에 lines[] · state 를 채워 돌려준다 (items 의 남은 양은 바뀐다)
 */
export function allocate(orders, links, items) {
  const left = new Map([...items].map(([id, it]) => [id, { qty: Number(it.qty) || 0, expected: Number(it.expected_qty) || 0 }]));
  return orders.map((o) => {
    const lines = (o.needs || []).map((n) => {
      const link = links.get(n.key);
      if (!link) return { ...n, state: 'unlinked', item_id: null };
      if (link.ignored || !link.item_id) return { ...n, state: 'ignored', item_id: null };
      const pool = left.get(link.item_id);
      if (!pool) return { ...n, state: 'unlinked', item_id: null };
      // 이미 출고한 수주는 재고를 다시 잡지 않는다
      if (o.issued) return { ...n, state: 'ok', item_id: link.item_id };
      let state;
      if (pool.qty >= n.need) {
        pool.qty -= n.need;
        state = 'ok';
      } else if (pool.qty + pool.expected >= n.need) {
        pool.expected -= n.need - pool.qty;
        pool.qty = 0;
        state = 'expected';
      } else {
        // 모자라도 있는 만큼은 이 수주 몫으로 본다 (뒤 수주가 가져가지 않게)
        pool.qty = 0;
        pool.expected = 0;
        state = 'short';
      }
      return { ...n, state, item_id: link.item_id };
    });
    let state = 'ok';
    for (const l of lines) if (RANK[l.state] > RANK[state]) state = l.state;
    if (state === 'ignored') state = 'ok';
    if (!o.has_doc) state = 'nodoc';
    if (o.issued) state = 'issued';
    return { ...o, lines, state };
  });
}

/** 재단 배치 → 남을 조각 후보 (긴 변 600 · 짧은 변 400 이상) */
export function offcutCandidates(plan) {
  if (!isPlainObject(plan) || !Array.isArray(plan.offcuts)) return [];
  const sheetBy = new Map((Array.isArray(plan.sheets) ? plan.sheets : []).filter(isPlainObject).map((s) => [s.no, s]));
  const out = [];
  for (const c of plan.offcuts) {
    if (!isPlainObject(c)) continue;
    const w = Math.floor(Number(c.w));
    const h = Math.floor(Number(c.h));
    const s = sheetBy.get(c.sheetNo);
    if (!s || !(w > 0) || !(h > 0)) continue;
    if (Math.max(w, h) < CANDIDATE_MIN.long || Math.min(w, h) < CANDIDATE_MIN.short) continue;
    const t = Number(s.thickness);
    const material = clean(s.material);
    if (!material || !(t > 0)) continue;
    out.push({ material, thickness_mm: t, width_mm: w, height_mm: h, sheet_no: Number(c.sheetNo) });
  }
  return out;
}

/** 본문 → 짝 정하기 */
export function linkInput(body) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const key = typeof body.key === 'string' ? body.key : '';
  const m = /^([BH])\|.+/.exec(key);
  if (!m || key.length > KEY_MAX) throw new ValidationError('자재를 다시 골라 주세요', { field: 'key' });
  const kind = m[1] === 'B' ? 'board' : 'hardware';
  const ignored = body.ignored === true;
  const item = body.item_id === undefined ? null : body.item_id;
  if (item !== null && !isUuid(item)) throw new ValidationError('품목을 다시 골라 주세요', { field: 'item_id' });
  if (item && ignored) throw new ValidationError('품목을 고르거나 「다루지 않음」 가운데 하나만 됩니다', { field: 'item_id' });
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, KEY_MAX) : key.slice(2).replace(/\|/g, ' · ');
  return { key, kind, label, item_id: item, ignored };
}

/** 본문 → 출고 줄 */
export function issueInput(body) {
  if (!isPlainObject(body) || !Array.isArray(body.lines) || !body.lines.length || body.lines.length > ISSUE_LINES_MAX)
    throw new ValidationError(`품목은 1 ~ ${ISSUE_LINES_MAX}줄입니다`, { field: 'lines' });
  const seen = new Set();
  return body.lines.map((l) => {
    if (!isPlainObject(l) || !isUuid(l.item_id)) throw new ValidationError('품목을 다시 골라 주세요', { field: 'lines' });
    if (seen.has(l.item_id)) throw new ValidationError('같은 품목이 두 번 들어 있습니다', { field: 'lines' });
    seen.add(l.item_id);
    return { item_id: l.item_id, qty: qtyOf(l.qty, 'lines', { positive: true }) };
  });
}

// ── 읽기 ──────────────────────────────────────────────────────

const inList = (ids) => `in.(${ids.join(',')})`;

/** 설계마다 지금 작업지시서 — Map(design_id → { snapshot_id, sheets }) */
async function docsOf(env, designIds) {
  const out = new Map();
  if (!designIds.length) return out;
  const rows =
    (await selectMany(env, 'design_documents', {
      design_id: inList(designIds),
      doc_type: 'eq.work_order',
      superseded_by: 'is.null',
      status: 'neq.revoked',
      // 문서에 고정된 재단 배치의 요약만 꺼낸다 (배치 전체는 크다)
      select: 'design_id,snapshot_id,rev,sheets:render_payload->cut_plan->summary->sheetsByMaterial',
      order: 'rev.desc',
      limit: '500',
    })) || [];
  for (const r of rows) if (!out.has(r.design_id)) out.set(r.design_id, r);
  return out;
}

/** 스냅샷마다 철물 · 배치 요약 — Map(id → { hardware, sheets }) */
async function snapshotsOf(env, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows =
    (await selectMany(env, 'design_snapshots', {
      id: inList(ids),
      select: 'id,hardware:hardware_payload->hardware,sheets:cut_plan_payload->summary->sheetsByMaterial',
      limit: '500',
    })) || [];
  for (const r of rows) out.set(r.id, r);
  return out;
}

/** GET /stock/needs */
export async function listStockNeeds(env, { user }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  const [orders, links, items] = await Promise.all([
    selectMany(env, 'orders', {
      company_id: `eq.${company.id}`,
      status: inList(OPEN_STATUSES),
      select: 'id,order_no,design_id,status,ordered_at',
      order: 'ordered_at.asc',
      limit: String(NEEDS_ORDERS),
    }),
    db(() => selectMany(env, 'stock_links', { company_id: `eq.${company.id}`, select: 'match_key,kind,label,item_id,ignored', limit: '2000' })),
    db(() => selectMany(env, 'stock_items', { company_id: `eq.${company.id}`, select: 'id,kind,name,spec,unit,qty,expected_qty,active', limit: String(STOCK_ITEMS_LIMIT) })),
  ]);
  const list = orders || [];
  const designIds = [...new Set(list.map((o) => o.design_id).filter(isUuid))];
  const orderIds = list.map((o) => o.id);
  const [docs, designs, installs, issues] = await Promise.all([
    docsOf(env, designIds),
    designIds.length ? selectMany(env, 'designs', { id: inList(designIds), select: 'id,name', limit: '500' }) : [],
    designIds.length
      ? selectMany(env, 'design_schedules', { design_id: inList(designIds), type: 'eq.installation', status: 'neq.cancelled', select: 'design_id,scheduled_at', order: 'scheduled_at.asc', limit: '500' })
      : [],
    orderIds.length ? db(() => selectMany(env, 'stock_issues', { company_id: `eq.${company.id}`, order_id: inList(orderIds), select: 'order_id', limit: '500' })) : [],
  ]);
  const snaps = await snapshotsOf(env, [...new Set([...docs.values()].map((d) => d.snapshot_id).filter(isUuid))]);
  const nameBy = new Map((designs || []).map((d) => [d.id, d.name]));
  const dueBy = new Map();
  for (const s of installs || []) if (!dueBy.has(s.design_id) && s.scheduled_at) dueBy.set(s.design_id, s.scheduled_at);
  const issued = new Set((issues || []).map((i) => i.order_id));

  const rows = list
    .map((o) => {
      const doc = docs.get(o.design_id) || null;
      const snap = doc ? snaps.get(doc.snapshot_id) || null : null;
      const sheets = doc && isPlainObject(doc.sheets) ? doc.sheets : snap && isPlainObject(snap.sheets) ? snap.sheets : null;
      return {
        id: o.id,
        order_no: o.order_no,
        name: nameBy.get(o.design_id) || null,
        status: o.status,
        due: dueBy.get(o.design_id) || null,
        sort: dueBy.get(o.design_id) || o.ordered_at || '',
        issued: issued.has(o.id),
        has_doc: !!doc,
        has_plan: !!sheets,
        needs: doc ? [...boardNeeds(sheets), ...hardwareNeeds(snap && snap.hardware)] : [],
      };
    })
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));

  const linkBy = new Map((links || []).map((l) => [l.match_key, l]));
  const itemBy = new Map((items || []).map((i) => [i.id, i]));
  const done = allocate(rows, linkBy, itemBy);
  const brief = (id, withQty) => {
    const it = id ? itemBy.get(id) : null;
    if (!it) return null;
    const out = { id: it.id, name: it.name, spec: it.spec || '', unit: it.unit };
    if (withQty) out.qty = Number(it.qty) || 0;
    return out;
  };

  const counts = { ok: 0, expected: 0, short: 0, unlinked: 0, nodoc: 0, issued: 0 };
  const mats = new Map();
  for (const o of done) {
    if (has(counts, o.state)) counts[o.state] += 1;
    for (const l of o.lines) {
      const cur = mats.get(l.key);
      if (cur) {
        if (!o.issued) cur.need = Math.round((cur.need + l.need) * 100) / 100;
        cur.orders += 1;
      } else mats.set(l.key, { key: l.key, kind: l.kind, label: l.label, unit: l.unit, need: o.issued ? 0 : l.need, orders: 1 });
    }
  }
  // 짝표에만 있고 지금 수주에는 안 나오는 자재도 싣는다 (짝을 고칠 수 있게)
  for (const l of links || []) if (!mats.has(l.match_key)) mats.set(l.match_key, { key: l.match_key, kind: l.kind, label: l.label, unit: l.kind === 'board' ? '장' : '개', need: 0, orders: 0 });

  return {
    can_manage: canAct,
    counts,
    orders: done.map((o) => ({
      id: o.id,
      order_no: o.order_no,
      name: o.name,
      status: o.status,
      due: o.due,
      issued: o.issued,
      has_doc: o.has_doc,
      has_plan: o.has_plan,
      state: o.state,
      lines: o.lines.map((l) => ({ key: l.key, kind: l.kind, label: l.label, need: l.need, unit: l.unit, state: l.state, item: brief(l.item_id, true) })),
    })),
    materials: [...mats.values()]
      .map((m) => {
        const link = linkBy.get(m.key);
        return { ...m, ignored: !!(link && link.ignored), item: brief(link && link.item_id, false) };
      })
      .sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label, 'ko') : a.kind === 'board' ? -1 : 1)),
  };
}

/** PUT /stock/links */
export async function putStockLink(env, { user, body, nowMs = Date.now() }) {
  const { company } = await stockCompanyOf(env, user, { manage: true });
  const input = linkInput(body);
  const mine = { company_id: `eq.${company.id}`, match_key: `eq.${input.key}` };
  if (!input.item_id && !input.ignored) {
    await db(() => restDelete(env, 'stock_links', mine));
    return { key: input.key, item_id: null, ignored: false };
  }
  if (input.item_id) {
    const it = await db(() => selectOne(env, 'stock_items', { id: `eq.${input.item_id}`, company_id: `eq.${company.id}`, select: 'id,kind' }));
    if (!it) throw new ValidationError('품목을 다시 골라 주세요', { field: 'item_id' });
    if (it.kind !== input.kind)
      throw new ValidationError(input.kind === 'board' ? '판재는 기본 자재 품목과 짝짓습니다' : '철물은 철물 품목과 짝짓습니다', { field: 'item_id' });
  }
  const row = { kind: input.kind, label: input.label, item_id: input.item_id, ignored: input.ignored, updated_by: user.id, updated_at: new Date(nowMs).toISOString() };
  const existing = await db(() => selectOne(env, 'stock_links', { ...mine, select: 'id' }));
  if (existing) await db(() => updateBy(env, 'stock_links', mine, row));
  else {
    try {
      await insertOne(env, 'stock_links', { ...row, company_id: company.id, match_key: input.key });
    } catch (e) {
      if (isMissing(e)) throw dbPending();
      if (!(e instanceof ConflictError)) throw e;
      await db(() => updateBy(env, 'stock_links', mine, row));
    }
  }
  return { key: input.key, item_id: input.item_id, ignored: input.ignored };
}

async function orderOf(env, companyId, id) {
  const gone = () => new NotFoundError('이 팩토리의 수주를 찾을 수 없습니다');
  if (!isUuid(id)) throw gone();
  const row = await selectOne(env, 'orders', { id: `eq.${id}`, company_id: `eq.${companyId}`, select: 'id,order_no,design_id,status' });
  if (!row) throw gone();
  return row;
}

/** POST /stock/needs/:orderId/issue */
export async function issueStockForOrder(env, { user, params, body }) {
  const { company } = await stockCompanyOf(env, user);
  const lines = issueInput(body);
  const order = await orderOf(env, company.id, params && params.orderId);
  if (!OPEN_STATUSES.includes(order.status)) {
    const err = new ConflictError('계약 확정 · 제작 중인 수주만 자재를 출고합니다');
    err.code = 'not_open';
    throw err;
  }
  let row;
  try {
    row = await callRpc(env, 'stock_issue', { p_company: company.id, p_order: order.id, p_ref: order.order_no, p_lines: lines, p_actor: user.id });
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    if (e instanceof ConflictError || codeIn(e, '23505')) {
      const err = new ConflictError('이 수주는 이미 자재를 출고했습니다');
      err.code = 'issued';
      throw err;
    }
    if (codeIn(e, 'P0002') || codeIn(e, '23503')) throw new ValidationError('품목을 다시 골라 주세요', { field: 'lines' });
    if (codeIn(e, '22023'))
      throw new ValidationError('재고가 모자란 품목이 있습니다. 아무것도 빼지 않았습니다 — 수량을 고치거나 먼저 입고해 주세요', { field: 'lines' });
    throw e;
  }
  const r = Array.isArray(row) ? row[0] : row;
  if (!r || !r.id) throw new DbError('자재를 출고하지 못했습니다');
  return { order_id: order.id, order_no: order.order_no, lines: lines.length, created_at: r.created_at };
}

/** GET /stock/needs/:orderId/offcuts */
export async function listOffcutCandidates(env, { user, params }) {
  const { company } = await stockCompanyOf(env, user);
  const order = await orderOf(env, company.id, params && params.orderId);
  const doc = await selectOne(env, 'design_documents', {
    design_id: `eq.${order.design_id}`,
    doc_type: 'eq.work_order',
    superseded_by: 'is.null',
    status: 'neq.revoked',
    select: 'snapshot_id,plan:render_payload->cut_plan',
    order: 'rev.desc',
  });
  let plan = doc && isPlainObject(doc.plan) ? doc.plan : null;
  if (doc && !plan && isUuid(doc.snapshot_id)) {
    const snap = await selectOne(env, 'design_snapshots', { id: `eq.${doc.snapshot_id}`, select: 'plan:cut_plan_payload' });
    plan = snap && isPlainObject(snap.plan) ? snap.plan : null;
  }
  return { order_no: order.order_no, items: offcutCandidates(plan) };
}
