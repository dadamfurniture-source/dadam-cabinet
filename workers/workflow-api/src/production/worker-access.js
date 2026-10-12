/**
 * 작업자 링크 · 실측 기록 · 보정.
 *
 * 작업자는 계정이 없다. 대표가 만든 링크의 토큰(X-Worker-Token)이 곧 권한이다.
 * 토큰은 발급 응답에서 1회만 평문으로 주고 DB 에는 해시만 둔다 (고객 공유 링크와 같은 방식).
 * 링크로 할 수 있는 일은 좁게 둔다: 오늘 할 일 보기, 실측 기록 남기기, 내 지시 완료 체크.
 * 금액(일당·비용)은 작업자 화면에 내보내지 않는다.
 */

import { pepperedHash } from '../util/hash.js';
import { selectOne, selectMany, insertOne, updateById, AuthError, ValidationError, NotFoundError } from '../supabase.js';
import { computePlan, getSettings, saveSettings, kstDate } from './service.js';
import { calibrate, calibrationPatch } from './calibration.js';

const TOKEN_BYTES = 24;
const MAX_LINK_DAYS = 365;
const ROLES = ['cutter', 'edge', 'asm'];

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const hashWorkerToken = (env, token) => pepperedHash(env.SHARE_TOKEN_PEPPER, 'worker', token);

/** 토큰은 fragment 에 싣는다 — 링크 미리보기·Referer·접속 로그로 새지 않게 (share.js 와 같은 이유). */
function workerUrl(env, token) {
  return `${String(env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}/production-worker.html#t=${token}`;
}

// ── 대표: 링크 관리 ──
export async function createWorkerLink(env, { user, body }) {
  const label = String((body && body.label) || '').trim();
  if (!label || label.length > 50) throw new ValidationError('작업자 이름(1~50자)이 필요합니다');
  const days = Math.min(MAX_LINK_DAYS, Math.max(1, Math.round(Number(body && body.days) || 90)));
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = toBase64Url(bytes);
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const row = await insertOne(env, 'production_worker_links', {
    user_id: user.id,
    label,
    token_hash: await hashWorkerToken(env, token),
    expires_at: expires,
  });
  return { id: row.id, label: row.label, expires_at: row.expires_at, url: workerUrl(env, token) };
}

export async function listWorkerLinks(env, { user }) {
  return (await selectMany(env, 'production_worker_links', {
    user_id: `eq.${user.id}`,
    select: 'id,label,expires_at,revoked_at,last_used_at,created_at',
    order: 'created_at.desc',
    limit: '100',
  })) || [];
}

export async function revokeWorkerLink(env, { user, linkId }) {
  const row = await selectOne(env, 'production_worker_links', { id: `eq.${linkId}`, select: 'id,user_id' });
  if (!row || row.user_id !== user.id) throw new NotFoundError('작업자 링크를 찾을 수 없습니다');
  await updateById(env, 'production_worker_links', linkId, { revoked_at: new Date().toISOString() });
  return { id: linkId, revoked: true };
}

// ── 작업자: 토큰 확인 ──
export async function resolveWorker(env, token) {
  if (!token || token.length < 20 || token.length > 100) throw new AuthError('작업자 링크가 올바르지 않습니다');
  const link = await selectOne(env, 'production_worker_links', { token_hash: `eq.${await hashWorkerToken(env, token)}`, select: '*' });
  if (!link) throw new AuthError('작업자 링크가 올바르지 않습니다');
  if (link.revoked_at) throw new AuthError('끊긴 링크입니다. 대표에게 새 링크를 받으세요');
  if (new Date(link.expires_at) < new Date()) throw new AuthError('만료된 링크입니다. 대표에게 새 링크를 받으세요');
  return link;
}

/** 계획에서 오늘 각 공정에 걸린 주문과 수량 (순수). */
export function todaysWork(plan, today) {
  const inRange = (r) => r && r[0] && r[0] <= today && (r[1] === null || r[1] >= today);
  const out = { cutter: [], edge: [], asm: [] };
  for (const j of plan.jobs || []) {
    const c = j.counts || {};
    if (j.stages && inRange(j.stages.cutter)) out.cutter.push({ orderId: j.id, label: j.label, units: (c.sheetsPB || 0) + (c.sheetsBack || 0), unit: '장', detail: `PB ${c.sheetsPB || 0} · 뒷판 ${c.sheetsBack || 0}`, due: j.due });
    if (j.stages && inRange(j.stages.edge)) out.edge.push({ orderId: j.id, label: j.label, units: c.sheetsPB || 0, unit: '장', detail: `PB ${c.sheetsPB || 0}장`, due: j.due });
    if (j.stages && inRange(j.stages.asm)) out.asm.push({ orderId: j.id, label: j.label, units: (c.boxes || 0) + (c.drawers || 0), unit: '개', detail: `통 ${c.boxes || 0} · 서랍 ${c.drawers || 0} · 도어 ${c.doors || 0}짝`, due: j.due, doorArrival: j.doorArrival });
  }
  return out;
}

export async function workerToday(env, { link }) {
  const today = kstDate();
  const plan = await computePlan(env, { user: { id: link.user_id }, today });
  const assignments = (await selectMany(env, 'production_assignments', {
    user_id: `eq.${link.user_id}`,
    work_date: `eq.${today}`,
    status: 'in.(instructed,done)',
    select: 'id,kind,role,text,status,done_at',
    order: 'created_at.asc',
    limit: '100',
  })) || [];
  const logs = (await selectMany(env, 'production_worklogs', {
    link_id: `eq.${link.id}`,
    work_date: `eq.${today}`,
    select: 'id,role,order_label,units,minutes,created_at',
    order: 'created_at.desc',
    limit: '100',
  })) || [];
  await updateById(env, 'production_worker_links', link.id, { last_used_at: new Date().toISOString() });
  return { worker: link.label, today, work: todaysWork(plan, today), assignments, logs };
}

export function validateWorklog(body) {
  const role = body && body.role;
  if (!ROLES.includes(role)) throw new ValidationError("role 은 'cutter', 'edge', 'asm' 중 하나여야 합니다");
  const units = Number(body.units);
  const minutes = Number(body.minutes);
  if (!(units > 0 && units <= 1000)) throw new ValidationError('수량은 0보다 크고 1000 이하여야 합니다');
  if (!(minutes > 0 && minutes <= 1440)) throw new ValidationError('시간(분)은 0보다 크고 1440 이하여야 합니다');
  return {
    role,
    units: Math.round(units * 100) / 100,
    minutes: Math.round(minutes * 100) / 100,
    order_id: body.order_id ? String(body.order_id) : null,
    order_label: body.order_label ? String(body.order_label).slice(0, 200) : null,
    note: body.note ? String(body.note).slice(0, 300) : null,
  };
}

export async function addWorklog(env, { link, body }) {
  const v = validateWorklog(body);
  const row = await insertOne(env, 'production_worklogs', {
    ...v,
    user_id: link.user_id,
    link_id: link.id,
    worker_label: link.label,
    work_date: kstDate(),
  });
  return { id: row.id, role: row.role, units: row.units, minutes: row.minutes };
}

export async function markAssignmentDone(env, { link, assignmentId, done }) {
  const row = await selectOne(env, 'production_assignments', { id: `eq.${assignmentId}`, select: 'id,user_id' });
  if (!row || row.user_id !== link.user_id) throw new NotFoundError('지시를 찾을 수 없습니다');
  const patch = done === false ? { status: 'instructed', done_at: null } : { status: 'done', done_at: new Date().toISOString() };
  await updateById(env, 'production_assignments', assignmentId, patch);
  return { id: assignmentId, ...patch };
}

// ── 대표: 기록 · 보정 ──
export async function listWorklogs(env, { user, from }) {
  const q = { user_id: `eq.${user.id}`, select: '*', order: 'work_date.desc,created_at.desc', limit: '500' };
  if (from) q.work_date = `gte.${String(from).slice(0, 10)}`;
  return (await selectMany(env, 'production_worklogs', q)) || [];
}

export async function getCalibration(env, { user, days = 30 }) {
  const from = kstDate(new Date(Date.now() - days * 86400000).toISOString());
  const logs = await listWorklogs(env, { user, from });
  const { settings } = await getSettings(env, { user });
  return { from, days, result: calibrate(logs, settings.standards) };
}

/** 보정 적용 — 저장된 설정에 표준시간만 덮어쓴다. */
export async function applyCalibration(env, { user, roles }) {
  const { result } = await getCalibration(env, { user });
  const patch = calibrationPatch(result, roles);
  if (!Object.keys(patch.standards).length) throw new ValidationError('적용할 보정값이 없습니다 (기록이 부족합니다)');
  const { saved } = await getSettings(env, { user });
  const body = { ...(saved || {}), standards: { ...((saved && saved.standards) || {}), ...patch.standards } };
  return saveSettings(env, { user, body });
}
