/**
 * 프로젝트 단계 사진 — 한 건 화면의 단계 칸에 사진을 올리고 지운다 (DB 0083 project_files · 버킷 project-files).
 * (2026-11-23 대표님 승인 계획 「프로젝트 관리 새 틀」 — 답 5번 「① 2차로 만듦」: 실측 · 현장 사진을 단계에 직접)
 *
 *   POST   /company/projects/:id/stages/:key/photos   본문 = 사진 (JPEG · PNG, 5MB까지) → 201 { id, url, at, label, mine }
 *   DELETE /company/projects/:id/photos/:fileId       → { id }
 *
 * 누가: 그 업체의 active 구성원이면 올린다. 지우기는 올린 사람 또는 대표 · 실장.
 * 한 단계에 STAGE_UPLOADS_MAX 장까지 (지운 것은 세지 않는다).
 * 지우면 줄에 표시만 남기고(되살리지 못한다) 버킷 파일을 치운다 — 파일을 못 치워도 지운 것으로 친다(화면에는 안 나온다).
 * 다른 업체의 프로젝트 · 없는 프로젝트 · 없는 사진은 404. 표가 아직 없으면(DB 적용 전) 409 db_pending.
 * 단계 칸에 싣는 것은 stageUploads — company-project-stage.js 가 부른다.
 */

import {
  ConflictError,
  DbError,
  ForbiddenError,
  MONEY_ROLES,
  NotFoundError,
  ValidationError,
  insertOne,
  selectMany,
  selectOne,
  updateBy,
} from './supabase.js';
import { projectCompanyOf } from './company-projects.js';
import { isMissingRelation } from './work-order-data.js';
import { STEPS } from './pipeline.js';
import { uploadObject, removeObjects, createSignedUrls } from './storage.js';
import { readBodyCapped } from './ledger/documents.js';
import { sniffImage, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS } from './ledger/checks.js';

export const FILES_BUCKET = 'project-files';
/** 한 단계에 올리는 사진 수 */
export const STAGE_UPLOADS_MAX = 30;
export const UPLOAD_LABEL = '올린 사진';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const dbPending = () => {
  const err = new ConflictError('DB 0083 적용 전입니다 — 사진 올리기는 적용 뒤에 됩니다');
  err.code = 'db_pending';
  return err;
};

/** 버킷이 아직 없다 (DB 적용 전) */
const isMissingBucket = (e) => e instanceof DbError && /bucket|not found|404/i.test(String((e && e.message) || ''));

/** 내 업체의 그 프로젝트 → { company, role, project } */
async function projectOf(env, user, rawId) {
  if (typeof rawId !== 'string' || !UUID_RE.test(rawId)) throw new ValidationError('프로젝트 번호가 올바르지 않습니다');
  const { company, role } = await projectCompanyOf(env, user);
  const project = await selectOne(env, 'projects', { id: `eq.${rawId}`, company_id: `eq.${company.id}`, select: 'id' });
  if (!project) throw new NotFoundError('프로젝트를 찾을 수 없습니다');
  return { company, role, project };
}

/** 그 단계에 올린 사진 줄 (지운 것 뺌 · 새것부터). 표가 없으면 null */
async function liveRows(env, companyId, projectId, stage) {
  try {
    return (
      (await selectMany(env, 'project_files', {
        company_id: `eq.${companyId}`,
        project_id: `eq.${projectId}`,
        stage: `eq.${stage}`,
        deleted_at: 'is.null',
        select: 'id,path,created_by,created_at',
        order: 'created_at.desc',
        limit: String(STAGE_UPLOADS_MAX),
      })) || []
    );
  } catch (e) {
    if (isMissingRelation(e)) return null;
    throw e;
  }
}

/** 화면에 주는 사진 한 장 — 버킷 경로는 싣지 않는다 */
const photoOf = (row, url, me, manage) => ({
  id: row.id,
  url,
  kind: 'upload',
  label: UPLOAD_LABEL,
  at: row.created_at,
  note: null,
  mine: manage || (!!me && row.created_by === me),
});

/**
 * 단계 칸에 싣는 올린 사진 — { ready, max, photos [{ id, url, kind:'upload', label, at, note, mine }] }.
 * mine = 내가 지울 수 있다 (올린 사람 · 대표 · 실장). 서명 주소를 못 만든 사진은 싣지 않는다.
 */
export async function stageUploads(env, { company, role, user, projectId, stage }) {
  const rows = await liveRows(env, company.id, projectId, stage);
  if (!rows) return { ready: false, max: STAGE_UPLOADS_MAX, photos: [] };
  let urls = new Map();
  if (rows.length) {
    try {
      urls = await createSignedUrls(
        env,
        FILES_BUCKET,
        rows.map((r) => r.path)
      );
    } catch (e) {
      console.warn('[project-files] 사진 서명 주소 실패:', e && e.message);
    }
  }
  const me = user && user.id;
  const manage = MONEY_ROLES.includes(role);
  return {
    ready: true,
    max: STAGE_UPLOADS_MAX,
    photos: rows.filter((r) => urls.get(r.path)).map((r) => photoOf(r, urls.get(r.path), me, manage)),
  };
}

/** POST /company/projects/:id/stages/:key/photos — 본문 = 사진 */
export async function addProjectPhoto(env, { user, params, request }) {
  const stage = params && params.key;
  if (typeof stage !== 'string' || !STEPS.includes(stage)) throw new ValidationError('단계 이름이 올바르지 않습니다', { field: 'key' });
  const { company, role, project } = await projectOf(env, user, params && params.id);

  const bytes = await readBodyCapped(request, PHOTO_MAX_BYTES);
  if (!bytes.byteLength) throw new ValidationError('사진 본문이 비었습니다', { code: 'empty' });
  const img = sniffImage(bytes);
  if (img && img.heic) throw new ValidationError('HEIC 사진은 JPEG 로 바꿔 올려 주세요', { code: 'heic' });
  if (!img) throw new ValidationError('사진은 JPEG · PNG 만 받습니다', { code: 'bad_type' });
  if (Math.max(img.width, img.height) > PHOTO_MAX_EDGE || img.width * img.height > PHOTO_MAX_PIXELS) {
    throw new ValidationError(`사진이 너무 큽니다 (긴 변 ${PHOTO_MAX_EDGE}px · ${PHOTO_MAX_PIXELS / 10000}만 화소 이하)`, { code: 'dimensions' });
  }

  const live = await liveRows(env, company.id, project.id, stage);
  if (!live) throw dbPending();
  if (live.length >= STAGE_UPLOADS_MAX) {
    const err = new ConflictError(`한 단계에 사진은 ${STAGE_UPLOADS_MAX}장까지입니다`);
    err.code = 'too_many';
    throw err;
  }

  const path = `${company.id}/${project.id}/${crypto.randomUUID()}.${img.mime === 'image/png' ? 'png' : 'jpg'}`;
  try {
    await uploadObject(env, FILES_BUCKET, path, bytes, img.mime);
  } catch (e) {
    if (isMissingBucket(e)) throw dbPending();
    throw e;
  }
  let row;
  try {
    row = await insertOne(env, 'project_files', {
      company_id: company.id,
      project_id: project.id,
      stage,
      path,
      created_by: user.id,
    });
  } catch (e) {
    // 줄을 못 넣었으면 올린 파일을 치운다 (주인 없는 파일을 남기지 않는다)
    await removeObjects(env, FILES_BUCKET, [path]).catch(() => {});
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  let url = null;
  try {
    url = (await createSignedUrls(env, FILES_BUCKET, [path])).get(path) || null;
  } catch (e) {
    console.warn('[project-files] 사진 서명 주소 실패:', e && e.message);
  }
  return photoOf(row, url, user.id, MONEY_ROLES.includes(role));
}

/** DELETE /company/projects/:id/photos/:fileId */
export async function removeProjectPhoto(env, { user, params }) {
  const fileId = params && params.fileId;
  if (typeof fileId !== 'string' || !UUID_RE.test(fileId)) throw new ValidationError('사진 번호가 올바르지 않습니다');
  const { company, role, project } = await projectOf(env, user, params && params.id);
  let row;
  try {
    row = await selectOne(env, 'project_files', {
      id: `eq.${fileId}`,
      company_id: `eq.${company.id}`,
      project_id: `eq.${project.id}`,
      deleted_at: 'is.null',
      select: 'id,path,created_by',
    });
  } catch (e) {
    if (isMissingRelation(e)) throw dbPending();
    throw e;
  }
  if (!row) throw new NotFoundError('사진을 찾을 수 없습니다');
  if (!MONEY_ROLES.includes(role) && row.created_by !== user.id)
    throw new ForbiddenError('사진은 올린 사람이나 대표 · 실장이 지웁니다', 'not_uploader');
  await updateBy(
    env,
    'project_files',
    { id: `eq.${row.id}`, company_id: `eq.${company.id}`, deleted_at: 'is.null' },
    { deleted_at: new Date().toISOString(), deleted_by: user.id }
  );
  try {
    await removeObjects(env, FILES_BUCKET, [row.path]);
  } catch (e) {
    console.warn('[project-files] 버킷 파일 치우기 실패:', e && e.message);
  }
  return { id: row.id };
}
