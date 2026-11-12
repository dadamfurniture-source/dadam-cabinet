/**
 * 근무 일정 — 쉬는 날만 적는다 (마이페이지 6단계 · 인사 › 근무 일정).
 * 표: database/migrations/0060_work_shifts.sql (work_shifts).
 *
 *   GET /company/shifts?from=YYYY-MM-DD&to=YYYY-MM-DD   내 업체 사람과 쉬는 날 (구성원) — 기간은 SHIFT_RANGE_DAYS 일까지
 *     { can_manage, today, from, to,
 *       people [{ kind: member|worker, id, name, role }]   구성원(대표 → 실장 → 직원) 다음에 공장 작업자(다담 공장만)
 *       items  [{ person_kind, person_id, date, kind, note }] }
 *     kind = off 휴무 · leave 연차 · half 반차 · out 외근. 적지 않은 날은 근무다 (줄이 없다).
 *   PUT /company/shifts   하루 적기 · 지우기 (대표 · 실장) { person_kind, person_id, date, kind, note? }
 *     kind 가 null 이면 그날 줄을 지운다(다시 근무). 있으면 넣거나 바꾼다. → { person_kind, person_id, date, kind, note }
 *     오늘에서 SHIFT_EDIT_DAYS 일보다 먼 날은 422.
 *
 * 누가       인사 메뉴를 쓰는 업체 — 다담 공장 · active 협력업체 Agent (segan/me.js PEOPLE_PLANS). 그 업체의 구성원이면 본다
 *            (2026-11-12 사장님 결정 ④ — 대표 · 실장이 적고 구성원 모두가 본다). 그 밖은 403 not_people_company.
 * 사람       구성원 = 그 업체의 active 구성원. 작업자 = 다담 공장 구성원에게 열린 공장 배정(factory_workers)이 있는 작업자 — 다담 공장만.
 *            남의 업체 사람 · 배정이 끝난 작업자 id 는 422.
 * 다른 업체   모든 읽기 · 쓰기를 company_id 로 거른다.
 * 고객 정보   없다. note 는 사람이 적는 짧은 글이다.
 * DB 0060 적용 전이면 409 db_pending.
 */

import { ConflictError, DbError, ForbiddenError, ValidationError, insertOne, restDelete, selectMany, selectOne, updateBy } from './supabase.js';
import { companyOf } from './distribution/company.js';
import { membersOf } from './company-assignee.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KST_MS = 9 * 3600 * 1000;
const DAY_MS = 86400000;

export const SHIFT_KINDS = Object.freeze(['off', 'leave', 'half', 'out']);
export const PERSON_KINDS = Object.freeze(['member', 'worker']);
/** 인사 메뉴를 쓰는 협력업체 plan (+ 다담 공장) */
export const PEOPLE_PLANS = Object.freeze(['agent']);
/** 한 번에 읽는 기간 */
export const SHIFT_RANGE_DAYS = 62;
/** 오늘에서 이만큼 떨어진 날까지 적는다 */
export const SHIFT_EDIT_DAYS = 366;
export const SHIFT_NOTE_MAX = 100;

function dbPending() {
  const err = new ConflictError('DB 0060 적용 전입니다 — 근무 일정은 적용 뒤에 쓸 수 있습니다');
  err.code = 'db_pending';
  return err;
}
const isMissing = (e) => e instanceof DbError && /PGRST20[45]|42P01|42703/.test(String(e.message || ''));
async function db(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    throw e;
  }
}

// ── 순수 ──────────────────────────────────────────────────────

export const kstDateOf = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);

/** 'YYYY-MM-DD' → UTC 자정 ms. 없는 날(02-30)이면 null */
export function dayMs(d) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) return null;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d ? ms : null;
}

/** 읽을 기간 — from · to 둘 다 있어야 하고 from ≤ to, SHIFT_RANGE_DAYS 일까지 */
export function rangeOf(query = {}) {
  const a = dayMs(query.from);
  const b = dayMs(query.to);
  if (a === null) throw new ValidationError('from 은 YYYY-MM-DD 입니다', { field: 'from' });
  if (b === null) throw new ValidationError('to 는 YYYY-MM-DD 입니다', { field: 'to' });
  if (b < a) throw new ValidationError('to 가 from 보다 앞입니다', { field: 'to' });
  if ((b - a) / DAY_MS + 1 > SHIFT_RANGE_DAYS)
    throw new ValidationError(`기간은 ${SHIFT_RANGE_DAYS}일까지입니다`, { field: 'to' });
  return { from: query.from, to: query.to };
}

/** 본문 → 하루 적기. kind 가 null 이면 지우기 */
export function shiftInput(body, nowMs) {
  if (!isPlainObject(body)) throw new ValidationError('JSON 본문이 필요합니다');
  if (!PERSON_KINDS.includes(body.person_kind))
    throw new ValidationError('person_kind 는 member 또는 worker 입니다', { field: 'person_kind' });
  if (!isUuid(body.person_id)) throw new ValidationError('사람을 다시 골라 주세요', { field: 'person_id' });
  const ms = dayMs(body.date);
  if (ms === null) throw new ValidationError('date 는 YYYY-MM-DD 입니다', { field: 'date' });
  const today = dayMs(kstDateOf(nowMs));
  if (Math.abs(ms - today) / DAY_MS > SHIFT_EDIT_DAYS)
    throw new ValidationError('오늘에서 1년 안쪽 날만 적을 수 있습니다', { field: 'date' });
  const kind = body.kind === null || body.kind === undefined || body.kind === '' ? null : body.kind;
  if (kind !== null && !SHIFT_KINDS.includes(kind))
    throw new ValidationError('kind 는 off · leave · half · out 또는 null(지우기) 입니다', { field: 'kind' });
  let note = null;
  if (body.note !== null && body.note !== undefined) {
    if (typeof body.note !== 'string') throw new ValidationError('note 는 글자여야 합니다', { field: 'note' });
    note = body.note.trim() || null;
    if (note && note.length > SHIFT_NOTE_MAX)
      throw new ValidationError(`note 는 ${SHIFT_NOTE_MAX}자까지입니다`, { field: 'note' });
  }
  return { person_kind: body.person_kind, person_id: body.person_id, date: body.date, kind, note };
}

/** 인사 메뉴를 쓰는 업체인가 — 다담 공장 · active Agent */
export function canHoldPeople(company) {
  if (!company || company.status !== 'active') return false;
  return company.kind === 'hq' || (company.kind === 'partner' && PEOPLE_PLANS.includes(company.plan));
}

// ── 읽기 ──────────────────────────────────────────────────────

async function peopleCompanyOf(env, user, { manage = false } = {}) {
  const { companyId, canAct } = await companyOf(env, user, { manage });
  const company = await selectOne(env, 'companies', { id: `eq.${companyId}`, select: 'id,kind,name,plan,status' });
  if (!canHoldPeople(company))
    throw new ForbiddenError('근무 일정을 쓸 수 있는 팩토리가 아닙니다', 'not_people_company');
  return { company, canAct };
}

/** 그 업체의 사람 — 구성원, 다담 공장이면 구성원에게 배정된 공장 작업자도 */
async function peopleOf(env, company) {
  const members = await membersOf(env, company.id);
  const people = members.map((m) => ({ kind: 'member', id: m.user_id, name: m.name, role: m.role }));
  if (company.kind !== 'hq' || !members.length) return people;
  const open =
    (await selectMany(env, 'factory_workers', {
      plan_user_id: `in.(${members.map((m) => m.user_id).join(',')})`,
      ended_at: 'is.null',
      select: 'worker_id',
      limit: '500',
    })) || [];
  const ids = [...new Set(open.map((f) => f.worker_id).filter(isUuid))];
  if (!ids.length) return people;
  const workers =
    (await selectMany(env, 'workers', {
      id: `in.(${ids.join(',')})`,
      select: 'id,display_name',
      order: 'display_name.asc',
      limit: '500',
    })) || [];
  return people.concat(workers.map((w) => ({ kind: 'worker', id: w.id, name: w.display_name || null, role: 'worker' })));
}

const shiftOut = (r) => ({
  person_kind: r.member_user_id ? 'member' : 'worker',
  person_id: r.member_user_id || r.worker_id,
  date: r.work_date,
  kind: r.kind,
  note: r.note || null,
});

/** GET /company/shifts */
export async function listShifts(env, { user, query = {}, nowMs = Date.now() }) {
  const { company, canAct } = await peopleCompanyOf(env, user);
  const { from, to } = rangeOf(query);
  const [people, rows] = await Promise.all([
    peopleOf(env, company),
    db(() =>
      selectMany(env, 'work_shifts', {
        company_id: `eq.${company.id}`,
        work_date: `gte.${from}`,
        select: 'member_user_id,worker_id,work_date,kind,note',
        order: 'work_date.asc',
        limit: '5000',
      })
    ),
  ]);
  // 끝 날은 여기서 자른다 (적을 수 있는 날이 오늘에서 1년 안쪽이라 뒤로 남는 줄이 많지 않다)
  const inRange = (rows || []).filter((r) => String(r.work_date) <= to);
  const known = new Set(people.map((p) => `${p.kind}:${p.id}`));
  return {
    can_manage: canAct,
    today: kstDateOf(nowMs),
    from,
    to,
    people,
    // 지금 이 업체 사람이 아닌 줄(나간 구성원 · 배정 끝난 작업자)은 싣지 않는다
    items: inRange.map(shiftOut).filter((s) => known.has(`${s.person_kind}:${s.person_id}`)),
  };
}

/** PUT /company/shifts */
export async function putShift(env, { user, body, nowMs = Date.now() }) {
  const { company } = await peopleCompanyOf(env, user, { manage: true });
  const input = shiftInput(body, nowMs);
  const people = await peopleOf(env, company);
  if (!people.some((p) => p.kind === input.person_kind && p.id === input.person_id))
    throw new ValidationError('사람을 다시 골라 주세요', { field: 'person_id' });
  const col = input.person_kind === 'member' ? 'member_user_id' : 'worker_id';
  const mine = { company_id: `eq.${company.id}`, [col]: `eq.${input.person_id}`, work_date: `eq.${input.date}` };
  const out = { person_kind: input.person_kind, person_id: input.person_id, date: input.date, kind: input.kind, note: input.kind ? input.note : null };
  if (input.kind === null) {
    await db(() => restDelete(env, 'work_shifts', mine));
    return out;
  }
  const patch = { kind: input.kind, note: input.note, updated_at: new Date(nowMs).toISOString() };
  const existing = await db(() => selectOne(env, 'work_shifts', { ...mine, select: 'id' }));
  if (existing) {
    await db(() => updateBy(env, 'work_shifts', mine, patch));
    return out;
  }
  try {
    await insertOne(env, 'work_shifts', {
      company_id: company.id,
      [col]: input.person_id,
      work_date: input.date,
      kind: input.kind,
      note: input.note,
      created_by: user.id,
    });
  } catch (e) {
    if (isMissing(e)) throw dbPending();
    // 그 사이 다른 사람이 같은 날을 넣었다 — 그 줄을 바꾼다
    if (!(e instanceof ConflictError)) throw e;
    await db(() => updateBy(env, 'work_shifts', mine, patch));
  }
  return out;
}
