/**
 * 간편 플래너 웹판 저장소 — 설계 초안 · 설계 사진 · 앱 보낸 기록 · 내 모듈 · 추천 (DB 0046)
 *
 * 간편 플래너를 앱 주소(/segan/planner/)에서 돌리면, 플래너 서버(컨테이너)가 PC 폴더 대신 이 길을 부른다.
 * 부르는 사람의 토큰 그대로 — 누가 무엇을 보고 고치는지는 여기서 정한다 (표는 service_role 만).
 *
 *   GET    /planner/access                         플래너를 쓸 수 있나 → { company, role, can_manage }
 *   GET    /planner/drafts                         내 업체 설계 초안 목록 (최근 고친 순 LIST_MAX)
 *   POST   /planner/drafts                         저장 { project, check } → { id, rev, count } (check 면 rev 가 같을 때만, 아니면 409 conflict)
 *   GET    /planner/drafts/:id                     설계 하나 (model + rev). ?ifExists=1 이면 없을 때 project null
 *   POST   /planner/drafts/:id/discard             버리기 (표시만) → { discarded, count }
 *   GET    /planner/drafts/:id/app-state           마지막으로 앱에 보낸 기록
 *   PUT    /planner/drafts/:id/app-state           { state } 적기
 *   POST   /planner/drafts/:id/photos              사진 한 장 (본문 = JPEG · PNG · WEBP 바이트) → { file, bytes, sha256, w, h }
 *   GET    /planner/drafts/:id/photos/:file        사진 바이트
 *   DELETE /planner/drafts/:id/photos/:file        사진 지우기 (표시만)
 *   GET    /planner/my-modules                     내 모듈 목록 · POST { module } 저장 · DELETE /:id 지우기
 *   GET    /planner/recommend?item=                그 사람이 그 품목으로 저장한 설계에 든 모듈 — 설계 몇 개에 들었나
 *
 * 쓸 수 있는 사람: 다담 공장(hq) 구성원 · active 협력업체(plan expert · agent · manager) 구성원 · 관리자(다담 공장으로 본다).
 * 보기: 그 업체 구성원 누구나 (designs 구성원 읽기 규칙과 같다). 고치기 · 버리기 · 사진: 만든 사람 또는 대표 · 실장 · 관리자.
 * 0046 적용 전이면 409 db_pending (access 는 표를 안 쓴다).
 */

import {
  ConflictError,
  ForbiddenError,
  MONEY_ROLES,
  NotFoundError,
  TooLargeError,
  ValidationError,
  activeMemberships,
  hqCompanyId,
  insertOne,
  restDelete,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { isAdmin } from './reports/admin.js';
import { isMissingRelation } from './work-order-data.js';
import { uploadObject } from './storage.js';

/** 플래너를 쓸 수 있는 협력업체 plan */
export const PLANNER_PLANS = Object.freeze(['expert', 'agent', 'manager']);
export const DRAFT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}$/;
export const MY_MODULE_ID_RE = /^my-[a-z0-9]{6,40}$/;
export const PHOTO_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}\.(jpg|png|webp)$/;
export const ITEM_RE = /^[a-z_]{1,40}$/;
export const PHOTOS_BUCKET = 'planner-photos';
/** 설계 한 벌 (DB 0046 model 상한과 같다) · 저장 요청 본문 · 사진 한 장 · 앱 보낸 기록 · 내 모듈 */
export const MODEL_MAX_BYTES = 5 * 1024 * 1024;
export const SAVE_BODY_MAX_BYTES = MODEL_MAX_BYTES + 64 * 1024;
export const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
export const APP_STATE_MAX_BYTES = 64 * 1024;
export const MY_MODULE_MAX_BYTES = 256 * 1024;
export const LIST_MAX = 200;
export const MY_MODULES_MAX = 500;
const NAME_MAX = 200;

const enc = new TextEncoder();
const bytesOf = (v) => enc.encode(JSON.stringify(v)).length;

function dbPending() {
  const err = new ConflictError('DB 0046 적용 전입니다');
  err.code = 'db_pending';
  return err;
}
function conflict(message, code, details = null) {
  const err = new ConflictError(message, details);
  err.code = code;
  return err;
}
async function guard(job) {
  try {
    return await job();
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
}

/** 다담 공장 · active 협력업체(Expert · Agent · MANAGER) */
export function canUsePlanner(company) {
  if (!company || company.status !== 'active') return false;
  return company.kind === 'hq' || (company.kind === 'partner' && PLANNER_PLANS.includes(company.plan));
}

/**
 * 부르는 사람의 플래너 업체 — { company, role, canManage }. 구성원인 업체가 없으면 관리자는 다담 공장.
 * 쓸 수 없는 업체면 403 not_planner_company, 구성원도 관리자도 아니면 403 not_member.
 */
export async function plannerCompanyOf(env, user) {
  const m = (await activeMemberships(env, user))[0];
  let companyId = m ? m.company_id : null;
  let role = m ? m.role : null;
  if (!companyId) {
    if (!(await isAdmin(env, user))) throw new ForbiddenError('팩토리 구성원만 설계를 씁니다', 'not_member');
    companyId = await hqCompanyId(env);
    role = 'admin';
  }
  const company = await selectOne(env, 'companies', { id: `eq.${companyId}`, select: 'id,kind,name,plan,status' });
  if (!canUsePlanner(company)) throw new ForbiddenError('설계를 쓸 수 있는 팩토리가 아닙니다', 'not_planner_company');
  return { company, role, canManage: role === 'admin' || MONEY_ROLES.includes(role) };
}

/** GET /planner/access */
export async function plannerAccess(env, { user }) {
  const { company, role, canManage } = await plannerCompanyOf(env, user);
  return {
    company: { id: company.id, name: company.name, kind: company.kind, plan: company.plan || null },
    role,
    can_manage: canManage,
  };
}

// ── 설계 요약 (목록 · 추천) ────────────────────────────────

/** 설계에 든 라이브러리 모듈 id — 줄마다 · 키큰장 단 묶음은 단마다, 한 번씩 (플래너 server/recommend.js libIdsOf 와 같다) */
export function libIdsOf(project) {
  const ids = new Set();
  (Array.isArray(project.walls) ? project.walls : []).forEach((w) =>
    Object.values((w && w.lines) || {}).forEach((list) =>
      (Array.isArray(list) ? list : []).forEach((m) => {
        if (m && typeof m.libId === 'string') ids.add(m.libId);
        if (m && Array.isArray(m.tiers)) m.tiers.forEach((t) => typeof t === 'string' && ids.add(t));
      })
    )
  );
  return [...ids].sort();
}

/** 목록 칸 — 플래너 design-archive list() 와 같은 셈 (판정 집계는 PC 설계 모음 몫이라 뺀다) */
export function summaryOf(project) {
  const walls = Array.isArray(project.walls) ? project.walls : [];
  const modules = walls.reduce(
    (s, w) => s + ((w && w.lines && Array.isArray(w.lines.floor) ? w.lines.floor : []).length) + ((w && w.lines && Array.isArray(w.lines.upper) ? w.lines.upper : []).length),
    0
  );
  return {
    walls: walls.length,
    modules,
    origin: project.origin && typeof project.origin === 'object' ? project.origin : null,
    orderNo: typeof project.orderNo === 'string' ? project.orderNo.slice(0, 40) : '',
    completed: project.completedConfirmed === true,
    createdAt: typeof project.createdAt === 'string' ? project.createdAt.slice(0, 40) : null,
    updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt.slice(0, 40) : null,
    libIds: libIdsOf(project).slice(0, 300),
  };
}

/** 키 차례를 맞춘 JSON — DB(jsonb)가 키 차례를 바꾸므로 「내용이 같나」는 이것으로 견준다 */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** 저장할 설계 — rev · archivedAt 은 표 칸이 맡는다 */
export function modelOf(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw new ValidationError('project 가 필요합니다');
  if (!DRAFT_ID_RE.test(String(project.id || ''))) throw new ValidationError('설계 id 형식이 아닙니다', { field: 'id' });
  const { rev: _rev, archivedAt: _at, ...model } = project;
  if (bytesOf(model) > MODEL_MAX_BYTES) throw new TooLargeError(`설계가 너무 큽니다 (${MODEL_MAX_BYTES / 1024 / 1024}MB 까지)`);
  return model;
}
const revOf = (p) => (p && Number.isInteger(p.rev) && p.rev > 0 ? p.rev : 0);
const itemOf = (p) => (typeof p.item === 'string' && ITEM_RE.test(p.item) ? p.item : 'sink');
const nameOf = (p) => (typeof p.name === 'string' ? p.name.trim().slice(0, NAME_MAX) : '');

// ── 설계 초안 ──────────────────────────────────────────────

async function draftOf(env, companyId, id) {
  if (!DRAFT_ID_RE.test(String(id || ''))) throw new ValidationError('설계 id 형식이 아닙니다', { field: 'id' });
  return selectOne(env, 'planner_drafts', { company_id: `eq.${companyId}`, id: `eq.${id}`, select: '*' });
}

function assertEditor(draft, user, canManage) {
  if (canManage || (draft.created_by && draft.created_by === user.id)) return;
  throw new ForbiddenError('설계를 만든 사람이나 대표 · 실장만 고칩니다', 'not_draft_editor');
}

async function liveCount(env, companyId) {
  const rows = await selectMany(env, 'planner_drafts', {
    company_id: `eq.${companyId}`,
    discarded_at: 'is.null',
    select: 'id',
    limit: '1000',
  });
  return (rows || []).length;
}

/** GET /planner/drafts */
export async function listDrafts(env, { user }) {
  const { company } = await plannerCompanyOf(env, user);
  return guard(async () => {
    const rows =
      (await selectMany(env, 'planner_drafts', {
        company_id: `eq.${company.id}`,
        discarded_at: 'is.null',
        select: 'id,name,item,rev,summary,created_by,created_at,updated_at',
        order: 'updated_at.desc',
        limit: String(LIST_MAX),
      })) || [];
    const items = rows.map((r) => {
      const s = r.summary || {};
      return {
        id: r.id,
        name: r.name || '',
        origin: s.origin || null,
        item: r.item,
        createdAt: s.createdAt || r.created_at,
        updatedAt: s.updatedAt || r.updated_at,
        walls: Number(s.walls) || 0,
        modules: Number(s.modules) || 0,
        orderNo: s.orderNo || '',
        completed: s.completed === true,
        rev: r.rev,
        mine: r.created_by === user.id,
      };
    });
    return { items, count: items.length };
  });
}

/** GET /planner/drafts/:id */
export async function getDraft(env, { user, params, query }) {
  const { company } = await plannerCompanyOf(env, user);
  return guard(async () => {
    const d = await draftOf(env, company.id, params.id);
    if (!d || d.discarded_at) {
      if (query && query.ifExists === '1') return { project: null };
      throw new NotFoundError('그 설계가 없습니다');
    }
    return { project: { ...d.model, rev: d.rev } };
  });
}

/** POST /planner/drafts { project, check } */
export async function saveDraft(env, { user, body }) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  const project = body && body.project;
  const model = modelOf(project);
  const check = body && body.check === true;
  return guard(async () => {
    const stored = await draftOf(env, company.id, model.id);
    const fields = { name: nameOf(model), item: itemOf(model), summary: summaryOf(model) };
    if (!stored) {
      const rev = revOf(project) + 1;
      try {
        await insertOne(env, 'planner_drafts', {
          company_id: company.id,
          id: model.id,
          model,
          rev,
          ...fields,
          created_by: user.id,
          updated_by: user.id,
        });
      } catch (e) {
        if (e instanceof ConflictError) throw conflict('다른 곳에서 막 저장된 설계입니다 — 다시 열어 주세요', 'conflict', { rev: null });
        throw e;
      }
      return { id: model.id, rev, count: await liveCount(env, company.id) };
    }
    if (stored.discarded_at) throw conflict('버린 설계입니다 — 새 설계로 저장해 주세요', 'discarded');
    assertEditor(stored, user, canManage);
    if (check && revOf(project) !== stored.rev) {
      throw conflict(
        '다른 곳에서 바뀐 설계입니다 — 설계 모음에서 다시 열어 주세요 (이 창에서 바꾼 것은 이 브라우저에만 있습니다)',
        'conflict',
        { rev: stored.rev }
      );
    }
    if (stableJson(stored.model) === stableJson(model)) return { id: model.id, rev: stored.rev, count: await liveCount(env, company.id) };
    const rev = stored.rev + 1;
    const rows = await updateBy(
      env,
      'planner_drafts',
      { company_id: `eq.${company.id}`, id: `eq.${model.id}`, rev: `eq.${stored.rev}`, discarded_at: 'is.null' },
      { model, rev, ...fields, updated_by: user.id }
    );
    if (!rows || !rows.length) throw conflict('다른 곳에서 바뀐 설계입니다 — 다시 열어 주세요', 'conflict', { rev: null });
    return { id: model.id, rev, count: await liveCount(env, company.id) };
  });
}

/** POST /planner/drafts/:id/discard */
export async function discardDraft(env, { user, params }) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  return guard(async () => {
    const d = await draftOf(env, company.id, params.id);
    if (!d || d.discarded_at) return { discarded: false, count: await liveCount(env, company.id) };
    assertEditor(d, user, canManage);
    await updateBy(
      env,
      'planner_drafts',
      { company_id: `eq.${company.id}`, id: `eq.${d.id}`, discarded_at: 'is.null' },
      { discarded_at: new Date().toISOString(), updated_by: user.id }
    );
    return { discarded: true, count: await liveCount(env, company.id) };
  });
}

/** 살아 있는 설계 — 없거나 버렸으면 404 */
async function liveDraftOf(env, companyId, id) {
  const d = await draftOf(env, companyId, id);
  if (!d || d.discarded_at) throw new NotFoundError('그 설계가 없습니다');
  return d;
}

/** GET /planner/drafts/:id/app-state */
export async function getAppState(env, { user, params }) {
  const { company } = await plannerCompanyOf(env, user);
  return guard(async () => ({ state: (await liveDraftOf(env, company.id, params.id)).app_state || null }));
}

/** PUT /planner/drafts/:id/app-state { state } */
export async function putAppState(env, { user, params, body }) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  const state = body && body.state;
  if (state !== null && (!state || typeof state !== 'object' || Array.isArray(state))) throw new ValidationError('state 는 객체여야 합니다');
  if (state && bytesOf(state) > APP_STATE_MAX_BYTES) throw new TooLargeError('앱 보낸 기록이 너무 큽니다');
  return guard(async () => {
    const d = await liveDraftOf(env, company.id, params.id);
    assertEditor(d, user, canManage);
    await updateBy(env, 'planner_drafts', { company_id: `eq.${company.id}`, id: `eq.${d.id}`, discarded_at: 'is.null' }, { app_state: state, updated_by: user.id });
    return { state };
  });
}

// ── 설계 사진 ──────────────────────────────────────────────

/** 바이트로 형식 · 크기 — JPEG SOF · PNG IHDR · WEBP VP8 / VP8L / VP8X (플래너 design-archive sniff · imageSize 와 같다) */
export function sniffPhoto(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 12) return null;
  const ascii = (a, b) => String.fromCharCode(...u8.slice(a, b));
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  try {
    if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
      let i = 2;
      while (i + 9 < u8.length) {
        if (u8[i] !== 0xff) {
          i += 1;
          continue;
        }
        const m = u8[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { ext: 'jpg', mime: 'image/jpeg', w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        i += 2 + dv.getUint16(i + 2);
      }
      return { ext: 'jpg', mime: 'image/jpeg', w: null, h: null };
    }
    if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, k) => u8[k] === b)) {
      return { ext: 'png', mime: 'image/png', w: u8.length >= 24 ? dv.getUint32(16) : null, h: u8.length >= 24 ? dv.getUint32(20) : null };
    }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
      const chunk = ascii(12, 16);
      let w = null;
      let h = null;
      if (chunk === 'VP8 ' && u8.length >= 30) {
        w = dv.getUint16(26, true) & 0x3fff;
        h = dv.getUint16(28, true) & 0x3fff;
      } else if (chunk === 'VP8L' && u8.length >= 25) {
        const b = dv.getUint32(21, true);
        w = (b & 0x3fff) + 1;
        h = ((b >> 14) & 0x3fff) + 1;
      } else if (chunk === 'VP8X' && u8.length >= 30) {
        w = 1 + (u8[24] | (u8[25] << 8) | (u8[26] << 16));
        h = 1 + (u8[27] | (u8[28] << 8) | (u8[29] << 16));
      }
      return { ext: 'webp', mime: 'image/webp', w, h };
    }
  } catch {
    /* 읽지 못하면 형식만 */
  }
  return null;
}

async function readCapped(request, max) {
  const declared = Number(request.headers.get('Content-Length'));
  const tooBig = () => new TooLargeError(`사진은 ${Math.round(max / 1024 / 1024)}MB 까지 올립니다`);
  if (Number.isFinite(declared) && declared > max) throw tooBig();
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {
        /* 이미 닫혔다 */
      }
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const photoPathOf = (companyId, draftId, file) => `${companyId}/${draftId}/${file}`;

/** POST /planner/drafts/:id/photos (본문 = 이미지 바이트) */
export async function addPhoto(env, { user, params, request }) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  return guard(async () => {
    const d = await liveDraftOf(env, company.id, params.id);
    assertEditor(d, user, canManage);
    const bytes = await readCapped(request, PHOTO_MAX_BYTES);
    if (!bytes.byteLength) throw new ValidationError('사진이 비어 있습니다', { code: 'empty' });
    const img = sniffPhoto(bytes);
    if (!img) throw new ValidationError('JPEG · PNG · WEBP 사진만 받습니다', { code: 'bad_type' });
    const rand = hex(crypto.getRandomValues(new Uint8Array(4)));
    const file = `photo-${Date.now().toString(36)}-${rand}.${img.ext}`;
    const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
    try {
      await uploadObject(env, PHOTOS_BUCKET, photoPathOf(company.id, d.id, file), bytes, img.mime);
    } catch (e) {
      if (/bucket|not found|404/i.test(String((e && e.message) || ''))) throw dbPending();
      throw e;
    }
    await insertOne(env, 'planner_draft_photos', {
      company_id: company.id,
      draft_id: d.id,
      file,
      mime: img.mime,
      bytes: bytes.byteLength,
      width: img.w || null,
      height: img.h || null,
      sha256,
      created_by: user.id,
    });
    return { file, bytes: bytes.byteLength, sha256, w: img.w || null, h: img.h || null };
  });
}

async function photoRowOf(env, companyId, draftId, file) {
  if (!PHOTO_FILE_RE.test(String(file || ''))) throw new ValidationError('사진 이름 형식이 아닙니다');
  const row = await selectOne(env, 'planner_draft_photos', {
    company_id: `eq.${companyId}`,
    draft_id: `eq.${draftId}`,
    file: `eq.${file}`,
    deleted_at: 'is.null',
    select: 'file,mime',
  });
  if (!row) throw new NotFoundError('그 사진이 없습니다');
  return row;
}

/** GET /planner/drafts/:id/photos/:file → { bytes, mime } (라우트가 이미지로 돌려준다) */
export async function readPhoto(env, { user, params }) {
  const { company } = await plannerCompanyOf(env, user);
  return guard(async () => {
    const d = await liveDraftOf(env, company.id, params.id);
    const row = await photoRowOf(env, company.id, d.id, params.file);
    const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${PHOTOS_BUCKET}/${photoPathOf(company.id, d.id, row.file)}`, {
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!res.ok) throw new NotFoundError('그 사진이 없습니다');
    return { bytes: new Uint8Array(await res.arrayBuffer()), mime: row.mime };
  });
}

/** DELETE /planner/drafts/:id/photos/:file — 표시만 (버킷 파일은 남는다) */
export async function deletePhoto(env, { user, params }) {
  const { company, canManage } = await plannerCompanyOf(env, user);
  return guard(async () => {
    const d = await liveDraftOf(env, company.id, params.id);
    assertEditor(d, user, canManage);
    const row = await photoRowOf(env, company.id, d.id, params.file);
    await updateBy(
      env,
      'planner_draft_photos',
      { company_id: `eq.${company.id}`, draft_id: `eq.${d.id}`, file: `eq.${row.file}`, deleted_at: 'is.null' },
      { deleted_at: new Date().toISOString() }
    );
    return { file: row.file };
  });
}

// ── 내 모듈 ────────────────────────────────────────────────

async function myModules(env, user) {
  return (
    (await selectMany(env, 'planner_my_modules', {
      user_id: `eq.${user.id}`,
      select: 'id,payload,created_at',
      order: 'created_at.desc',
      limit: String(MY_MODULES_MAX),
    })) || []
  ).map((r) => ({ ...r.payload, id: r.id, createdAt: r.payload && r.payload.createdAt ? r.payload.createdAt : r.created_at }));
}

/** GET /planner/my-modules */
export async function listMyModules(env, { user }) {
  await plannerCompanyOf(env, user);
  return guard(async () => {
    const modules = await myModules(env, user);
    return { modules, count: modules.length };
  });
}

/** POST /planner/my-modules { module } — id 는 플래너 서버가 단다 (정리 · 라이브러리 확인도 그쪽) */
export async function saveMyModule(env, { user, body }) {
  const { company } = await plannerCompanyOf(env, user);
  const mod = body && body.module;
  if (!mod || typeof mod !== 'object' || Array.isArray(mod)) throw new ValidationError('module 이 필요합니다');
  if (!MY_MODULE_ID_RE.test(String(mod.id || ''))) throw new ValidationError('내 모듈 id 형식이 아닙니다', { field: 'id' });
  if (bytesOf(mod) > MY_MODULE_MAX_BYTES) throw new TooLargeError('내 모듈이 너무 큽니다');
  return guard(async () => {
    await insertOne(env, 'planner_my_modules', { user_id: user.id, id: mod.id, company_id: company.id, payload: mod });
    return { module: mod, count: (await myModules(env, user)).length };
  });
}

/** DELETE /planner/my-modules/:id */
export async function deleteMyModule(env, { user, params }) {
  await plannerCompanyOf(env, user);
  if (!MY_MODULE_ID_RE.test(String(params.id || ''))) throw new ValidationError('내 모듈 id 형식이 아닙니다', { field: 'id' });
  return guard(async () => {
    await restDelete(env, 'planner_my_modules', { user_id: `eq.${user.id}`, id: `eq.${params.id}` });
    return { id: params.id, count: (await myModules(env, user)).length };
  });
}

// ── 추천 ───────────────────────────────────────────────────

/** GET /planner/recommend?item= — 그 사람이 마지막으로 저장한 그 품목 설계들에 든 모듈 (플래너 recommend.js usageOf 와 같은 셈) */
export async function recommendOf(env, { user, query }) {
  const { company } = await plannerCompanyOf(env, user);
  const item = query && typeof query.item === 'string' && ITEM_RE.test(query.item) ? query.item : null;
  if (!item) throw new ValidationError('item 이 필요합니다', { field: 'item' });
  return guard(async () => {
    const rows =
      (await selectMany(env, 'planner_drafts', {
        company_id: `eq.${company.id}`,
        updated_by: `eq.${user.id}`,
        item: `eq.${item}`,
        discarded_at: 'is.null',
        select: 'summary',
        limit: '1000',
      })) || [];
    const count = new Map();
    for (const r of rows) for (const id of (r.summary && Array.isArray(r.summary.libIds) ? r.summary.libIds : [])) count.set(id, (count.get(id) || 0) + 1);
    const used = [...count.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
    return { account: true, designs: rows.length, used };
  });
}
