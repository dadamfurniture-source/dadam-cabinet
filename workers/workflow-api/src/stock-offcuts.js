/**
 * 재고 — 자투리 자재와 구매 · 재고 숫자 (마이페이지 6단계 · 구매 · 재고 › 자투리 자재 · 대시보드).
 * 표: database/migrations/0059_stock.sql (stock_offcuts · stock_offcut_events).
 *
 *   GET   /stock/offcuts                 내 업체 자투리 — 새 것부터 OFFCUTS_LIMIT 조각 (구성원)
 *     { can_manage, items [{ id, code, material, thickness_mm, width_mm, height_mm, place, state, memo, created_at, closed_at }] }
 *     code = 'S-0001' (업체마다 차례). state = left 남음 · reserved 예약 · used 씀 · discarded 버림
 *   POST  /stock/offcuts                 자투리 등록 (구성원) { material, thickness_mm, width_mm, height_mm, place?, memo? }
 *   PATCH /stock/offcuts/:id             상태 · 자리 · 메모 바꾸기 (구성원) { state?, place?, memo? }
 *     상태는 남음 ↔ 예약, 남음 · 예약 → 씀 · 버림 (끝 — 되돌리지 못한다, DB 지킴이). 재질 · 두께 · 크기는 못 바꾼다.
 *   GET   /stock/offcuts/:id/events      그 조각의 기록 (구성원) { items [{ type, detail, by, created_at }] }
 *   POST  /stock/offcuts/labels          라벨 QR 만들기 (구성원) { ids [1 ~ LABELS_MAX] }
 *     → { labels [{ id, code, material, thickness_mm, width_mm, height_mm, place, url, qr }] } — qr 은 <svg> 글.
 *     QR 에는 앱 주소와 번호만 들어간다 (SEGAN_ORIGIN/segan/me.html?cut=<번호>#stock-scrap) — 로그인한 그 업체 사람만 열린다.
 *     「라벨 인쇄」 기록을 조각마다 남긴다.
 *   GET   /stock/summary                 구매 · 재고 숫자 (구성원)
 *     { short { board, hardware }, expected, offcuts { left, reserved, old },
 *       boards [{ name, spec, unit, qty }] (남은 수량 많은 판재부터 BOARDS_TOP),
 *       value { total, board, hardware, unpriced } }   재고 금액(원) = 남은 수량 × 단가 — 대표 · 실장에게만, 단가 칸이 있을 때만(DB 0061).
 *                                                      unpriced = 남은 수량이 있는데 단가가 없는 품목 수 (금액에서 빠진다)
 *       bought { month, total, unpriced } }            이번 달(KST) 매입 금액(원) = 이번 달 입고 수량 × 지금 단가 — value 와 같은 사람 · 같은 때에만.
 *                                                      입고할 때의 값은 적어 두지 않으므로 지금 단가로 셈한 어림이다. 실사 조정은 세지 않는다.
 *                                                      unpriced = 이번 달 입고가 있는데 단가가 없는(또는 숨긴) 품목 수 (금액에서 빠진다)
 *     old = 들어온 지 OFFCUT_OLD_DAYS 일이 넘은 남음 · 예약 조각.
 *
 * 누가       stock.js 와 같다 — 다담 공장 · active Expert · Agent 구성원 (stockCompanyOf). 자투리는 등록 · 바꾸기 모두 구성원 누구나
 *            (2026-11-12 사장님 결정 — 공장 직원이 그 자리에서 적는다).
 * 다른 업체   모든 읽기 · 쓰기를 company_id 로 거른다. 남의 조각 id 는 404.
 * 지우기 없음  버림도 줄은 남는다. 기록은 추가만.
 * 고객 정보   없다. memo · detail 은 사람이 적는 짧은 글(어느 작업에서 남았는지)이다.
 * DB 0059 적용 전이면 409 db_pending.
 */

import { ConflictError, DbError, NotFoundError, ValidationError, insertMany, insertOne, selectMany, selectOne, updateBy } from './supabase.js';
import { stockCompanyOf, selectPriced, STOCK_ITEMS_LIMIT } from './stock.js';
import { membersOf } from './company-assignee.js';
import { qrSvg } from './util/qr.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const OFFCUT_STATES = Object.freeze(['left', 'reserved', 'used', 'discarded']);
export const OFFCUTS_LIMIT = 500;
export const LABELS_MAX = 60;
export const EVENTS_LIMIT = 50;
export const MATERIAL_MAX = 40;
export const PLACE_MAX = 20;
export const OFFCUT_MEMO_MAX = 200;
export const SIDE_MAX = 3000;
export const THICKNESS_MAX = 100;
/** 「3달 넘음」 */
export const OFFCUT_OLD_DAYS = 90;
export const BOARDS_TOP = 8;
/** 이번 달 입고 기록을 이만큼까지 읽어 매입 금액을 셈한다 */
export const MONTH_MOVES_LIMIT = 5000;
/** 번호가 겹쳤을 때 다시 해 보는 횟수 (둘이 동시에 등록) */
const SEQ_TRIES = 4;
/** 라벨 QR 이 여는 앱 주소 */
export const SEGAN_ORIGIN = 'https://dadamfurniture.com';

const COLUMNS = 'id,seq,material,thickness_mm,width_mm,height_mm,place,state,memo,created_at,closed_at';
const EVENT_OF = { reserved: 'reserved', left: 'released', used: 'used', discarded: 'discarded' };

function dbPending() {
  const err = new ConflictError('DB 0059 적용 전입니다 — 재고는 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}
const isMissing = (e) => e instanceof DbError && /PGRST20[245]|42P01|42703|42883/.test(String(e.message || ''));
async function db(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    throw e;
  }
}

// ── 순수 ──────────────────────────────────────────────────────

/** 번호 → 'S-0001' */
export const codeOf = (seq) => `S-${String(seq).padStart(4, '0')}`;

/** 라벨 QR 이 여는 주소 */
export const labelUrl = (seq) => `${SEGAN_ORIGIN}/segan/me.html?cut=${seq}#stock-scrap`;

function textOf(v, field, max, { required = false } = {}) {
  if (v === null || v === undefined) {
    if (required) throw new ValidationError(`${field} 이 필요합니다`, { field });
    return null;
  }
  if (typeof v !== 'string') throw new ValidationError(`${field} 은 글자여야 합니다`, { field });
  const s = v.trim();
  if (!s && required) throw new ValidationError(`${field} 이 필요합니다`, { field });
  if (s.length > max) throw new ValidationError(`${field} 은 ${max}자까지입니다`, { field });
  return s || null;
}

function mmOf(v, field, max, { integer = true } = {}) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > max || (integer && !Number.isInteger(n)))
    throw new ValidationError(`${field} 은 ${integer ? '1' : '0 보다 크고'} ~ ${max} mm 입니다`, { field });
  return integer ? n : Math.round(n * 10) / 10;
}

/** 본문 → 새 자투리 칸 */
export function offcutInput(body) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  return {
    material: textOf(body.material, 'material', MATERIAL_MAX, { required: true }),
    thickness_mm: mmOf(body.thickness_mm, 'thickness_mm', THICKNESS_MAX, { integer: false }),
    width_mm: mmOf(body.width_mm, 'width_mm', SIDE_MAX),
    height_mm: mmOf(body.height_mm, 'height_mm', SIDE_MAX),
    place: textOf(body.place, 'place', PLACE_MAX),
    memo: textOf(body.memo, 'memo', OFFCUT_MEMO_MAX),
  };
}

/** 본문 → 바꿀 칸 (상태 · 자리 · 메모 가운데 온 것만) */
export function offcutPatch(body) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  const out = {};
  if (has(body, 'state')) {
    if (!OFFCUT_STATES.includes(body.state))
      throw new ValidationError('state 는 left · reserved · used · discarded 입니다', { field: 'state' });
    out.state = body.state;
  }
  if (has(body, 'place')) out.place = textOf(body.place, 'place', PLACE_MAX);
  if (has(body, 'memo')) out.memo = textOf(body.memo, 'memo', OFFCUT_MEMO_MAX);
  if (!Object.keys(out).length) throw new ValidationError('바꿀 칸이 없습니다');
  return out;
}

/** 지금 상태에서 그 상태로 갈 수 있나 — DB 지킴이(stock_offcuts_guard)와 같다 */
export function canMove(from, to) {
  if (from === to) return true;
  return from === 'left' || from === 'reserved';
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

function offcutOut(r) {
  return {
    id: r.id,
    code: codeOf(r.seq),
    material: r.material,
    thickness_mm: num(r.thickness_mm),
    width_mm: num(r.width_mm),
    height_mm: num(r.height_mm),
    place: r.place || null,
    state: r.state,
    memo: r.memo || null,
    created_at: r.created_at,
    closed_at: r.closed_at || null,
  };
}

// ── 길 ────────────────────────────────────────────────────────

/** GET /stock/offcuts */
export async function listOffcuts(env, { user }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  const rows = await db(() =>
    selectMany(env, 'stock_offcuts', {
      company_id: `eq.${company.id}`,
      select: COLUMNS,
      order: 'created_at.desc,seq.desc',
      limit: String(OFFCUTS_LIMIT),
    })
  );
  return { can_manage: canAct, items: (rows || []).map(offcutOut) };
}

async function offcutOf(env, companyId, id) {
  const gone = () => new NotFoundError('이 팩토리의 자투리를 찾을 수 없습니다');
  if (!isUuid(id)) throw gone();
  const row = await db(() => selectOne(env, 'stock_offcuts', { id: `eq.${id}`, company_id: `eq.${companyId}`, select: COLUMNS }));
  if (!row) throw gone();
  return row;
}

async function addEvents(env, rows) {
  if (rows.length) await db(() => insertMany(env, 'stock_offcut_events', rows));
}

/** POST /stock/offcuts — 번호는 지금 가장 큰 번호 + 1. 겹치면(동시에 등록) 다시 읽어 넣는다 */
export async function createOffcut(env, { user, body }) {
  const { company } = await stockCompanyOf(env, user);
  const input = offcutInput(body);
  for (let i = 0; i < SEQ_TRIES; i++) {
    const top = await db(() =>
      selectMany(env, 'stock_offcuts', { company_id: `eq.${company.id}`, select: 'seq', order: 'seq.desc', limit: '1' })
    );
    const seq = ((top && top[0] && Number(top[0].seq)) || 0) + 1;
    let row;
    try {
      row = await insertOne(env, 'stock_offcuts', { ...input, company_id: company.id, seq, created_by: user.id });
    } catch (e) {
      if (isMissing(e)) throw dbPending();
      if (e instanceof ConflictError) continue;
      throw e;
    }
    if (!row || !row.id) throw new DbError('자투리를 등록하지 못했습니다');
    await addEvents(env, [{ company_id: company.id, offcut_id: row.id, type: 'added', detail: input.place, actor_user_id: user.id }]);
    return offcutOut(row);
  }
  const err = new ConflictError('번호를 정하지 못했습니다. 다시 해 주세요');
  err.code = 'busy';
  throw err;
}

/** PATCH /stock/offcuts/:id */
export async function updateOffcut(env, { user, params, body }) {
  const { company } = await stockCompanyOf(env, user);
  const patch = offcutPatch(body);
  const before = await offcutOf(env, company.id, params && params.id);
  if (has(patch, 'state') && !canMove(before.state, patch.state)) {
    const err = new ConflictError('이미 쓰거나 버린 조각은 되돌릴 수 없습니다');
    err.code = 'closed';
    throw err;
  }
  const change = {};
  if (has(patch, 'state') && patch.state !== before.state) change.state = patch.state;
  if (has(patch, 'place') && patch.place !== (before.place || null)) change.place = patch.place;
  if (has(patch, 'memo') && patch.memo !== (before.memo || null)) change.memo = patch.memo;
  if (!Object.keys(change).length) return offcutOut(before);
  const rows = await db(() => updateBy(env, 'stock_offcuts', { id: `eq.${before.id}`, company_id: `eq.${company.id}` }, change));
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) throw new DbError('자투리를 바꾸지 못했습니다');
  const base = { company_id: company.id, offcut_id: before.id, actor_user_id: user.id };
  const events = [];
  if (change.state) events.push({ ...base, type: EVENT_OF[change.state], detail: null });
  if (has(change, 'place')) events.push({ ...base, type: 'moved', detail: `${before.place || '—'} → ${change.place || '—'}` });
  await addEvents(env, events);
  return offcutOut(row);
}

/** GET /stock/offcuts/:id/events */
export async function listOffcutEvents(env, { user, params }) {
  const { company } = await stockCompanyOf(env, user);
  const cut = await offcutOf(env, company.id, params && params.id);
  const rows =
    (await db(() =>
      selectMany(env, 'stock_offcut_events', {
        offcut_id: `eq.${cut.id}`,
        company_id: `eq.${company.id}`,
        select: 'type,detail,actor_user_id,created_at',
        order: 'created_at.desc',
        limit: String(EVENTS_LIMIT),
      })
    )) || [];
  const members = rows.length ? await membersOf(env, company.id) : [];
  const nameBy = new Map(members.map((m) => [m.user_id, m.name]));
  return {
    items: rows.map((r) => ({
      type: r.type,
      detail: r.detail || null,
      by: (r.actor_user_id && nameBy.get(r.actor_user_id)) || null,
      created_at: r.created_at,
    })),
  };
}

/** POST /stock/offcuts/labels */
export async function makeOffcutLabels(env, { user, body }) {
  const { company } = await stockCompanyOf(env, user);
  const ids = isPlainObject(body) && Array.isArray(body.ids) ? [...new Set(body.ids)] : null;
  if (!ids || !ids.length || ids.length > LABELS_MAX || !ids.every(isUuid))
    throw new ValidationError(`ids 는 1 ~ ${LABELS_MAX} 개입니다`, { field: 'ids' });
  const rows =
    (await db(() =>
      selectMany(env, 'stock_offcuts', {
        id: `in.(${ids.join(',')})`,
        company_id: `eq.${company.id}`,
        select: COLUMNS,
        order: 'seq.asc',
        limit: String(LABELS_MAX),
      })
    )) || [];
  if (rows.length !== ids.length) throw new NotFoundError('이 팩토리의 자투리를 찾을 수 없습니다');
  await addEvents(
    env,
    rows.map((r) => ({ company_id: company.id, offcut_id: r.id, type: 'label', detail: null, actor_user_id: user.id }))
  );
  return {
    labels: rows.map((r) => {
      const url = labelUrl(r.seq);
      return {
        id: r.id,
        code: codeOf(r.seq),
        material: r.material,
        thickness_mm: num(r.thickness_mm),
        width_mm: num(r.width_mm),
        height_mm: num(r.height_mm),
        place: r.place || null,
        url,
        qr: qrSvg(url, { className: 'so-qr' }),
      };
    }),
  };
}

const KST_MS = 9 * 3600 * 1000;
/** 이번 달(KST) — { month: 'YYYY-MM', fromIso: 그 달 1일 0시(KST) } */
export function kstMonthOf(nowMs) {
  const month = new Date(nowMs + KST_MS).toISOString().slice(0, 7);
  return { month, fromIso: new Date(Date.parse(`${month}-01T00:00:00Z`) - KST_MS).toISOString() };
}

/** GET /stock/summary */
export async function getStockSummary(env, { user, nowMs = Date.now() }) {
  const { company, canAct } = await stockCompanyOf(env, user);
  const itemQuery = {
    company_id: `eq.${company.id}`,
    active: 'eq.true',
    select: 'id,kind,name,spec,unit,qty,safety_qty,expected_qty',
    limit: String(STOCK_ITEMS_LIMIT),
  };
  const [read, cuts] = await Promise.all([
    // 단가는 원가 — 대표 · 실장일 때만 읽는다
    canAct ? selectPriced(env, itemQuery) : db(() => selectMany(env, 'stock_items', itemQuery)).then((rows) => ({ rows, priced: false })),
    db(() =>
      selectMany(env, 'stock_offcuts', {
        company_id: `eq.${company.id}`,
        state: 'in.(left,reserved)',
        select: 'state,created_at',
        limit: '5000',
      })
    ),
  ]);
  const items = read.rows || [];
  const short = { board: 0, hardware: 0 };
  let expected = 0;
  for (const i of items || []) {
    if (Number(i.qty) < Number(i.safety_qty) && has(short, i.kind)) short[i.kind] += 1;
    if (i.expected_qty !== null && i.expected_qty !== undefined) expected += 1;
  }
  const oldBefore = nowMs - OFFCUT_OLD_DAYS * 86400000;
  const offcuts = { left: 0, reserved: 0, old: 0 };
  for (const c of cuts || []) {
    if (has(offcuts, c.state)) offcuts[c.state] += 1;
    if (Date.parse(c.created_at) < oldBefore) offcuts.old += 1;
  }
  const boards = (items || [])
    .filter((i) => i.kind === 'board')
    .map((i) => ({ name: i.name, spec: i.spec || '', unit: i.unit, qty: Number(i.qty) || 0 }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ko'))
    .slice(0, BOARDS_TOP);
  const out = { short, expected, offcuts, boards };
  if (read.priced) {
    const value = { total: 0, board: 0, hardware: 0, unpriced: 0 };
    for (const i of items) {
      const qty = Number(i.qty) || 0;
      if (i.unit_price === null || i.unit_price === undefined) {
        if (qty > 0) value.unpriced += 1;
        continue;
      }
      const won = Math.round(qty * Number(i.unit_price));
      value.total += won;
      if (has(value, i.kind)) value[i.kind] += won;
    }
    out.value = value;

    // 이번 달 매입 — 입고 기록 × 지금 단가 (대표 · 실장만 여기까지 온다)
    const { month, fromIso } = kstMonthOf(nowMs);
    const ins = await db(() =>
      selectMany(env, 'stock_moves', {
        company_id: `eq.${company.id}`,
        kind: 'eq.in',
        created_at: `gte.${fromIso}`,
        select: 'item_id,qty',
        limit: String(MONTH_MOVES_LIMIT),
      })
    );
    const priceBy = new Map(items.map((i) => [i.id, i.unit_price]));
    const noPrice = new Set();
    let total = 0;
    for (const m of ins || []) {
      const p = priceBy.get(m.item_id);
      if (p === null || p === undefined) noPrice.add(m.item_id);
      else total += Math.round((Number(m.qty) || 0) * Number(p));
    }
    out.bought = { month, total, unpriced: noPrice.size };
  }
  return out;
}
