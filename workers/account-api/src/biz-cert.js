/**
 * 사업자등록증 — 올리기 · 사람 확인 · 자동 확인 · 본사 검토 (account-api).
 * 2026-11-21 대표님 계획 승인 「사업자등록증 등록 시 첫 달 무료」 — 사업자번호당 1회 · 계속사업자만 · 자동 확인, 애매한 건만 본사 검토.
 *
 * 표는 database/migrations/0077_business_cert_trial.sql (business_certificates · trial_grants, 비공개 버킷 business-certs).
 * 둘 다 서버만 읽고 쓴다 — 쓰기는 service_role REST (partner.js db). 사용자 확인 · 관리자 확인은 worker.js 가 한다
 * (/admin/partner/applications 와 같은 길).
 * 무료 구독 자체(카드 등록 때 첫 결제 건너뛰기 · trialing · trial_grants 넣기)는 payments-api 가 한다 — 여기는 trial_grants 를 읽기만 한다.
 *
 *   POST /partner/cert            사진 원본 바이트 (Content-Type 은 보지 않고 첫 바이트로 JPEG · PNG 를 가린다)
 *     순서: 이미 무료에 쓴 사업자등록증이 있는가(409 trial_used) → 24시간 5장(429 daily_limit) → 본문(5MB, 413 too_large)
 *       → 형식 · 크기(422 empty · heic · bad_type · dimensions) → 버킷 `{사람}/{yyyy}/{id}.jpg|png`
 *       → 살아 있는 옛 줄(uploaded · review · verified)을 superseded 로 → 새 줄 uploaded → AI 읽기 → extracted
 *     AI 읽기는 assistant-api 를 서비스 바인딩으로 부른다 (env.ASSISTANT.read — 진입점 CertExtract).
 *     바인딩이 없거나 읽기가 실패해도 올리기는 성공이다 (extracted null — 사람이 직접 적는다).
 *   GET  /partner/cert            내 살아 있는(없으면 가장 최근) 사업자등록증 + 무료 가능 여부
 *   POST /partner/cert/confirm    { biz_no, company_name, representative_name, open_date } — 내 uploaded 줄에 적고 자동 확인
 *     막는 것 먼저:  검증 숫자 틀림 → rejected checksum · 이미 무료를 받은 번호 → rejected already_used ·
 *                    국세청 상태가 계속사업자가 아님(휴업 · 폐업 · 없는 번호) → rejected not_active
 *     검토(하나만, 이 차례):  AI 가 번호를 못 읽음 unreadable > 읽은 번호와 다름 edited >
 *                    국세청 진위 불일치 nts_mismatch > 국세청 확인 못 함 nts_unavailable
 *     모두 통과 → verified. checks 에 { checksum, nts_status, nts_valid, duplicate, edited } (하지 않은 확인은 null)
 *     검토로 가면 본사(업체 kind platform)의 active 대표 · 실장에게 biz_cert_review 알림
 *   GET  /admin/partner/certs?status=review|verified|rejected|all   기본 review, 최신순 50줄 + 사진 서명 주소(10분)
 *   POST /admin/partner/certs/:id { decision: approve | reject, reason? }   review 줄만. 올린 사람에게 biz_cert_decided 알림
 *
 * 응답은 partner.js 와 같다 — 성공 { success: true, data }, 실패 { success: false, code, error } (+ 422 invalid 는 field).
 * 표가 아직 없으면(0077 적용 전) 503 not_ready — 다른 길은 그대로 돈다.
 * 개인정보: 회원에게 주는 모양에는 저장 경로 · sha256 · checks 가 없다. 로그에는 사업자등록증 id · 상태 · 까닭 코드만 남긴다
 *   (사업자번호 · 대표자 이름 · 사진 주소를 남기지 않는다).
 */
import { db, DbError, PartnerError, partnerResponse, iso, profilesById } from './partner.js';
import { UUID_RE } from './storage-purge.js';
import { normalizeBizNo, bizNoValid, lookupNtsStatus, validateNts } from './nts.js';
import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_EDGE,
  PHOTO_MAX_PIXELS,
  readBodyCapped,
  sniffImage,
  sha256Hex,
  uploadObject,
  createSignedUrls,
} from './cert-photo.js';
import { enqueueBizCertReviewNotices, enqueueBizCertDecidedNotice } from './push-outbox.js';

export const CERT_BUCKET = 'business-certs';
/** 한 사람이 24시간에 올릴 수 있는 장수 */
export const CERT_DAILY_MAX = 5;
export const CERT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 첫 달 무료 날수 */
export const TRIAL_DAYS = 30;
/** 본사 검토 목록 — 줄 수 · 사진 서명 주소 유효 시간(초) */
export const ADMIN_LIST_MAX = 50;
export const SIGNED_URL_TTL_SEC = 600;
/** 살아 있는 상태 — 한 사람에 하나 (DB business_certificates_one_live_per_user) */
export const LIVE_STATUSES = Object.freeze(['uploaded', 'review', 'verified']);
export const ADMIN_STATUS_FILTERS = Object.freeze(['review', 'verified', 'rejected', 'all']);
/** DB 길이 제약과 같다 (business_certificates_len_check) */
const COMPANY_NAME_MAX = 100;
const REPRESENTATIVE_NAME_MAX = 60;
const REASON_MAX = 300;
/** 올리기 전에 보는 내 줄 수 (하루 한도 · 이미 쓴 사업자등록증) */
const MINE_MAX = 100;

const COLS =
  'id,user_id,storage_path,status,extracted,biz_no,company_name,representative_name,open_date,checks,review_reason,decision_reason,confirmed_at,decided_by,decided_at,created_at';
const LIVE_FILTER = `status=in.(${LIVE_STATUSES.join(',')})`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BIZ_NO_RE = /^\d{10}$/;

const FIELD_ERRORS = Object.freeze({
  body: '요청 내용이 올바르지 않습니다.',
  biz_no: '사업자등록번호 10자리를 숫자와 - 로 적어 주세요.',
  company_name: '상호를 1~100자로 적어 주세요.',
  representative_name: '대표자 이름을 1~60자로 적어 주세요.',
  open_date: '개업연월일을 YYYY-MM-DD 로 적어 주세요.',
  status: '상태 값이 올바르지 않습니다.',
  id: '대상이 올바르지 않습니다.',
  decision: '처리할 동작이 올바르지 않습니다.',
  reason: '사유를 1~300자로 적어 주세요.',
});

const MSG = Object.freeze({
  trial_used: '이미 첫 달 무료에 쓴 사업자등록증이 있어 다시 올릴 수 없습니다.',
  daily_limit: '사업자등록증은 24시간에 5장까지 올릴 수 있습니다. 잠시 뒤 다시 시도해 주세요.',
  too_large: '사진은 5MB 까지 올립니다.',
  empty: '사진 본문이 비었습니다.',
  heic: 'HEIC 사진은 JPEG 로 바꿔 올려 주세요.',
  bad_type: '사진은 JPEG · PNG 만 받습니다.',
  dimensions: `사진이 너무 큽니다 (긴 변 ${PHOTO_MAX_EDGE}px · ${PHOTO_MAX_PIXELS / 10000}만 화소 이하).`,
  upload_conflict: '다른 올리기가 진행 중입니다. 잠시 뒤 다시 시도해 주세요.',
  not_uploaded: '확인할 사업자등록증이 없습니다. 사진을 먼저 올려 주세요.',
  not_found: '사업자등록증을 찾을 수 없습니다.',
  invalid_transition: '지금 상태에서는 할 수 없는 처리입니다.',
  already_used: '이미 첫 달 무료를 받은 사업자등록번호입니다.',
  not_ready: '아직 준비 중인 기능입니다. 잠시 뒤 다시 시도해 주세요.',
});

const fail = (status, code) => new PartnerError(status, code, MSG[code]);
const invalid = (field) =>
  new PartnerError(422, 'invalid', FIELD_ERRORS[field] || FIELD_ERRORS.body, { field });

const nowIso = () => new Date().toISOString();
const obj = (b) => (b && typeof b === 'object' && !Array.isArray(b) ? b : {});
/** 글자 수 — DB length() 처럼 코드 포인트로 센다 */
const charLen = (s) => [...s].length;

/** 앞뒤 공백을 자른 1~max 자 글. 아니면 422 */
function text(v, field, max) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || charLen(s) > max) throw invalid(field);
  return s;
}

/** 'YYYY-MM-DD' 인 실제 날짜. 아니면 422 */
function dateInput(v, field) {
  const s = typeof v === 'string' ? v.trim() : '';
  const t = DATE_RE.test(s) ? Date.parse(`${s}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) throw invalid(field);
  return s;
}

/** 한국 시간의 해 (사진 경로) */
const kstYear = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 4);

// ── 모양 ───────────────────────────────────────────────

/** AI 가 읽은 값 — 네 칸만, 모양이 맞는 값만 (아니면 null) */
function extractedOf(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const str = (v, max) =>
    typeof v === 'string' && v.trim() && charLen(v.trim()) <= max ? v.trim() : null;
  return {
    biz_no: typeof e.biz_no === 'string' && BIZ_NO_RE.test(e.biz_no) ? e.biz_no : null,
    company_name: str(e.company_name, COMPANY_NAME_MAX),
    representative_name: str(e.representative_name, REPRESENTATIVE_NAME_MAX),
    open_date: typeof e.open_date === 'string' && DATE_RE.test(e.open_date) ? e.open_date : null,
  };
}

/** 회원에게 주는 모양 — 저장 경로 · sha256 · checks 는 싣지 않는다 */
export function certView(row) {
  return {
    id: row.id,
    status: row.status,
    extracted: extractedOf(row.extracted),
    biz_no: row.biz_no ?? null,
    company_name: row.company_name ?? null,
    representative_name: row.representative_name ?? null,
    open_date: row.open_date ?? null,
    review_reason: row.review_reason ?? null,
    decision_reason: row.decision_reason ?? null,
    created_at: iso(row.created_at),
  };
}

/** 본사에 주는 모양 — 회원 모양 + 자동 확인 결과 · 올린 사람 · 처리 기록 */
function adminCertView(row) {
  return {
    ...certView(row),
    checks: row.checks && typeof row.checks === 'object' ? row.checks : null,
    user_id: row.user_id,
    confirmed_at: iso(row.confirmed_at),
    decided_by: row.decided_by ?? null,
    decided_at: iso(row.decided_at),
  };
}

// ── 읽기 ───────────────────────────────────────────────

/** 그 번호로 준 무료 기록 (없으면 null). 번호는 숫자 10자리만 묻는다 */
async function grantOf(env, bizNo) {
  if (typeof bizNo !== 'string' || !BIZ_NO_RE.test(bizNo)) return null;
  const rows = await db(
    env,
    'GET',
    `trial_grants?biz_no=eq.${bizNo}&select=biz_no,plan,started_at,ends_at,company_id&limit=1`
  );
  return rows[0] || null;
}

/** 내 살아 있는 줄, 없으면 가장 최근 줄, 없으면 null */
async function myCert(env, userId) {
  const live = await db(
    env,
    'GET',
    `business_certificates?user_id=eq.${userId}&${LIVE_FILTER}&select=${COLS}&limit=1`
  );
  if (live[0]) return live[0];
  const last = await db(
    env,
    'GET',
    `business_certificates?user_id=eq.${userId}&select=${COLS}&order=created_at.desc&limit=1`
  );
  return last[0] || null;
}

/** 무료 가능 여부 — verified 이고 그 번호로 준 무료가 없을 때만 */
async function trialOf(env, cert) {
  const no = (reason) => ({ eligible: false, reason, days: TRIAL_DAYS });
  if (!cert) return no('no_cert');
  if (cert.status !== 'verified') return no('not_verified');
  if (await grantOf(env, cert.biz_no)) return no('already_used');
  return { eligible: true, reason: null, days: TRIAL_DAYS };
}

// ── AI 읽기 ────────────────────────────────────────────

let warnedNoBinding = false;

/** assistant-api 에 한 장 읽기를 맡긴다 → 읽은 네 칸 | null. 던지지 않는다 */
async function requestCertRead(env, certId) {
  const b = env && env.ASSISTANT;
  if (!b || typeof b.read !== 'function') {
    if (!warnedNoBinding) {
      console.warn('[cert] ASSISTANT binding missing — certificate reading is not requested');
      warnedNoBinding = true;
    }
    return null;
  }
  try {
    const out = await b.read({ certificateId: certId });
    if (out && out.ok === true) return extractedOf(out.extracted);
    const reason = out && typeof out.reason === 'string' ? out.reason.slice(0, 60) : 'empty';
    console.warn('[cert] read skipped:', certId, reason);
    return null;
  } catch {
    console.error('[cert] read failed:', certId);
    return null;
  }
}

// ── 회원 ───────────────────────────────────────────────

/** POST /partner/cert — 사진 올리기 */
async function uploadCert(env, { user, request }) {
  const mine = await db(
    env,
    'GET',
    `business_certificates?user_id=eq.${user.id}&select=id,status,created_at&order=created_at.desc&limit=${MINE_MAX}`
  );
  // 이미 무료에 쓴 사업자등록증이 있으면 다시 올리지 못한다 (올리면 그 줄이 superseded 가 된다)
  const ids = mine.map((r) => r.id).filter((id) => typeof id === 'string' && UUID_RE.test(id));
  if (ids.length) {
    const used = await db(
      env,
      'GET',
      `trial_grants?certificate_id=in.(${ids.join(',')})&select=id&limit=1`
    );
    if (used.length) throw fail(409, 'trial_used');
  }
  const since = Date.now() - CERT_WINDOW_MS;
  if (mine.filter((r) => Date.parse(r.created_at) > since).length >= CERT_DAILY_MAX)
    throw fail(429, 'daily_limit');

  const bytes = await readBodyCapped(request, PHOTO_MAX_BYTES);
  if (!bytes) throw fail(413, 'too_large');
  if (!bytes.byteLength) throw fail(422, 'empty');
  const img = sniffImage(bytes);
  if (img && img.heic) throw fail(422, 'heic');
  if (!img) throw fail(422, 'bad_type');
  if (Math.max(img.width, img.height) > PHOTO_MAX_EDGE || img.width * img.height > PHOTO_MAX_PIXELS)
    throw fail(422, 'dimensions');

  const sha256 = await sha256Hex(bytes);
  const id = crypto.randomUUID();
  const path = `${user.id}/${kstYear()}/${id}.${img.mime === 'image/png' ? 'png' : 'jpg'}`;
  await uploadObject(env, CERT_BUCKET, path, bytes, img.mime);

  // 살아 있는 옛 줄을 옛 것으로 돌린 뒤 새 줄을 넣는다 (한 사람에 살아 있는 줄 하나)
  const before = new Map(mine.map((r) => [r.id, r.status]));
  const old = await db(
    env,
    'PATCH',
    `business_certificates?user_id=eq.${user.id}&${LIVE_FILTER}&select=id`,
    { status: 'superseded', updated_at: nowIso() }
  );
  let saved;
  try {
    [saved] = await db(env, 'POST', `business_certificates?select=${COLS}`, {
      id,
      user_id: user.id,
      storage_path: path,
      mime: img.mime,
      size_bytes: bytes.byteLength,
      sha256,
      status: 'uploaded',
    });
    if (!saved) throw new Error('cert: no row');
  } catch (e) {
    // 새 줄을 못 넣었다 — 옛 줄을 살려 둔다 (올린 파일은 경로가 달라 남는다)
    for (const o of old) {
      const prev = before.get(o.id);
      if (!LIVE_STATUSES.includes(prev)) continue;
      try {
        await db(
          env,
          'PATCH',
          `business_certificates?id=eq.${o.id}&status=eq.superseded`,
          { status: prev, updated_at: nowIso() },
          { prefer: 'return=minimal' }
        );
      } catch (e2) {
        console.error('[cert] upload: restore failed', o.id, e2 && e2.status ? e2.status : '?');
      }
    }
    // 같은 사람이 같은 때 올렸다 (살아 있는 줄 유니크)
    if (e instanceof DbError && e.code === '23505') throw fail(409, 'upload_conflict');
    throw e;
  }

  // AI 읽기 — 실패해도 올리기는 성공이다
  const extracted = await requestCertRead(env, id);
  if (extracted) {
    try {
      const rows = await db(
        env,
        'PATCH',
        `business_certificates?id=eq.${id}&status=eq.uploaded&select=${COLS}`,
        { extracted, updated_at: nowIso() }
      );
      if (rows[0]) saved = rows[0];
    } catch (e) {
      console.warn('[cert] extracted save failed:', id, e && e.status ? e.status : '?');
    }
  }
  console.log('[cert] upload', id, saved.extracted ? 'read' : 'unread');
  return { status: 201, data: { cert: certView(saved) } };
}

/** GET /partner/cert */
async function getCert(env, { user }) {
  const cert = await myCert(env, user.id);
  return { data: { cert: cert ? certView(cert) : null, trial: await trialOf(env, cert) } };
}

/**
 * 자동 확인 — 막는 것(rejected)이 검토(review)보다 먼저다. 하지 않은 확인은 checks 에 null 로 남는다.
 * @param {{ bizNo: string, openDate: string, representativeName: string, readBizNo: string | null }} v
 * @returns {Promise<{ status: 'verified' | 'review' | 'rejected', review_reason: string | null, decision_reason: string | null, checks: object }>}
 */
export async function autoCheck(env, { bizNo, openDate, representativeName, readBizNo }) {
  const checks = {
    checksum: bizNoValid(bizNo),
    nts_status: null,
    nts_valid: null,
    duplicate: null,
    // AI 가 읽은 번호와 사람이 확인한 번호가 다른가 (AI 가 못 읽었으면 견줄 수 없다 — null)
    edited: readBizNo ? readBizNo !== bizNo : null,
  };
  const out = (status, review_reason, decision_reason) => ({
    status,
    review_reason,
    decision_reason,
    checks,
  });

  if (!checks.checksum) return out('rejected', null, 'checksum');
  checks.duplicate = !!(await grantOf(env, bizNo));
  if (checks.duplicate) return out('rejected', null, 'already_used');
  const nts = await lookupNtsStatus(env, bizNo);
  checks.nts_status = nts ? nts.status : null;
  if (nts && nts.status !== 'active') return out('rejected', null, 'not_active');
  checks.nts_valid = await validateNts(env, { bizNo, openDate, representativeName });

  if (!readBizNo) return out('review', 'unreadable', null);
  if (checks.edited) return out('review', 'edited', null);
  if (checks.nts_valid === false) return out('review', 'nts_mismatch', null);
  if (!nts || checks.nts_valid === null) return out('review', 'nts_unavailable', null);
  return out('verified', null, null);
}

/** 본사(업체 kind platform)의 active 대표 · 실장에게 검토 알림. 던지지 않는다 */
async function notifyReviewers(env, certId) {
  try {
    const hq = await db(env, 'GET', 'companies?kind=eq.platform&select=id');
    const ids = hq.map((c) => c.id).filter((id) => typeof id === 'string' && UUID_RE.test(id));
    if (!ids.length) return 0;
    const members = await db(
      env,
      'GET',
      `company_members?company_id=in.(${ids.join(',')})&status=eq.active&role=in.(owner,manager)&select=user_id,company_id`
    );
    return await enqueueBizCertReviewNotices(env, certId, members);
  } catch (e) {
    console.warn('[cert] review notice failed:', certId, e && e.status ? e.status : '?');
    return 0;
  }
}

/** POST /partner/cert/confirm — 사람이 확인한 값을 적고 자동 확인을 돌린다 */
async function confirmCert(env, { user, body }) {
  const b = obj(body);
  const bizNo = typeof b.biz_no === 'string' ? normalizeBizNo(b.biz_no) : null;
  if (!bizNo || !BIZ_NO_RE.test(bizNo)) throw invalid('biz_no');
  const companyName = text(b.company_name, 'company_name', COMPANY_NAME_MAX);
  const representativeName = text(
    b.representative_name,
    'representative_name',
    REPRESENTATIVE_NAME_MAX
  );
  const openDate = dateInput(b.open_date, 'open_date');

  const [cur] = await db(
    env,
    'GET',
    `business_certificates?user_id=eq.${user.id}&status=eq.uploaded&select=${COLS}&limit=1`
  );
  if (!cur) throw fail(409, 'not_uploaded');

  const read = extractedOf(cur.extracted);
  const verdict = await autoCheck(env, {
    bizNo,
    openDate,
    representativeName,
    readBizNo: read ? read.biz_no : null,
  });
  const now = nowIso();
  const rows = await db(
    env,
    'PATCH',
    `business_certificates?id=eq.${cur.id}&user_id=eq.${user.id}&status=eq.uploaded&select=${COLS}`,
    {
      biz_no: bizNo,
      company_name: companyName,
      representative_name: representativeName,
      open_date: openDate,
      status: verdict.status,
      checks: verdict.checks,
      review_reason: verdict.review_reason,
      decision_reason: verdict.decision_reason,
      confirmed_at: now,
      updated_at: now,
    }
  );
  // 그사이 새로 올렸거나 이미 확인했다
  if (!rows.length) throw fail(409, 'not_uploaded');
  const cert = rows[0];
  console.log(
    '[cert] confirm',
    cert.id,
    cert.status,
    verdict.review_reason || verdict.decision_reason || '-'
  );
  if (cert.status === 'review') await notifyReviewers(env, cert.id);
  return { data: { cert: certView(cert), trial: await trialOf(env, cert) } };
}

// ── 본사 검토 ──────────────────────────────────────────

/** GET /admin/partner/certs?status=review|verified|rejected|all — 기본 review, 최신순 50줄 */
async function adminListCerts(env, { url }) {
  const status = (url.searchParams.get('status') || 'review').trim();
  if (!ADMIN_STATUS_FILTERS.includes(status)) throw invalid('status');
  const filter = status === 'all' ? '' : `&status=eq.${status}`;
  const rows = await db(
    env,
    'GET',
    `business_certificates?select=${COLS}&order=created_at.desc&limit=${ADMIN_LIST_MAX}${filter}`
  );
  if (!rows.length) return { data: [] };

  const bizNos = [...new Set(rows.map((r) => r.biz_no).filter((n) => BIZ_NO_RE.test(String(n))))];
  const [profiles, urls, grants] = await Promise.all([
    profilesById(
      env,
      rows.map((r) => r.user_id)
    ),
    createSignedUrls(
      env,
      CERT_BUCKET,
      rows.map((r) => r.storage_path),
      SIGNED_URL_TTL_SEC
    ),
    bizNos.length
      ? db(
          env,
          'GET',
          `trial_grants?biz_no=in.(${bizNos.join(',')})&select=biz_no,plan,started_at,ends_at,company_id`
        )
      : [],
  ]);
  const grantOfNo = new Map(grants.map((g) => [g.biz_no, g]));
  return {
    data: rows.map((r) => {
      const p = profiles.get(r.user_id);
      const g = grantOfNo.get(r.biz_no);
      return {
        ...adminCertView(r),
        email: (p && p.email) || null,
        name: (p && p.name) || null,
        photo_url: urls.get(r.storage_path) || null,
        trial: g
          ? {
              plan: g.plan,
              started_at: iso(g.started_at),
              ends_at: iso(g.ends_at),
              company_id: g.company_id ?? null,
            }
          : null,
      };
    }),
  };
}

/** POST /admin/partner/certs/:id — { decision: approve | reject, reason? }. review 줄만 */
async function adminDecideCert(env, { user, params, body }) {
  if (typeof params.id !== 'string' || !UUID_RE.test(params.id)) throw invalid('id');
  const id = params.id.toLowerCase();
  const b = obj(body);
  const decision = b.decision;
  if (decision !== 'approve' && decision !== 'reject') throw invalid('decision');
  // 반려는 사유가 있어야 한다. 승인은 적었을 때만 남긴다
  const given = b.reason !== undefined && b.reason !== null && b.reason !== '';
  const reason = decision === 'reject' || given ? text(b.reason, 'reason', REASON_MAX) : null;

  const [cur] = await db(env, 'GET', `business_certificates?id=eq.${id}&select=${COLS}&limit=1`);
  if (!cur) throw fail(404, 'not_found');
  if (cur.status !== 'review') throw fail(409, 'invalid_transition');
  // 검토를 기다리는 사이 그 번호가 다른 길로 무료를 받았다
  if (decision === 'approve' && (await grantOf(env, cur.biz_no))) throw fail(409, 'already_used');

  const now = nowIso();
  const rows = await db(
    env,
    'PATCH',
    `business_certificates?id=eq.${id}&status=eq.review&select=${COLS}`,
    {
      status: decision === 'approve' ? 'verified' : 'rejected',
      decided_by: user.id,
      decided_at: now,
      decision_reason: reason,
      updated_at: now,
    }
  );
  // 그사이 올린 사람이 새로 올렸거나 다른 관리자가 처리했다
  if (!rows.length) throw fail(409, 'invalid_transition');
  console.log('[cert] decide', id, rows[0].status);
  // 올린 사람에게 앱 알림. 실패해도 처리는 그대로다
  await enqueueBizCertDecidedNotice(env, rows[0]);
  return { data: { cert: adminCertView(rows[0]) } };
}

/** 검토할 수 있는 본사 사람인가 — 다담 본사(companies.kind 'platform')의 active 대표 · 실장. 확인하지 못하면 false (관리자 확인으로 넘어간다) */
export async function isPlatformReviewer(env, userId) {
  try {
    const rows = await db(
      env,
      'GET',
      `company_members?user_id=eq.${userId}&status=eq.active&role=in.(owner,manager)&select=company_id`
    );
    const ids = [...new Set((rows || []).map((r) => r.company_id).filter(Boolean))];
    if (!ids.length) return false;
    const found = await db(
      env,
      'GET',
      `companies?id=in.(${ids.join(',')})&kind=eq.platform&select=id&limit=1`
    );
    return Array.isArray(found) && found.length > 0;
  } catch {
    return false;
  }
}

// ── 길 ─────────────────────────────────────────────────

const ROUTES = [
  { method: 'POST', path: '/partner/cert', raw: true, run: uploadCert },
  { method: 'GET', path: '/partner/cert', run: getCert },
  { method: 'POST', path: '/partner/cert/confirm', run: confirmCert },
  // reviewer — 사이트 관리자뿐 아니라 다담 본사 대표 · 실장도 (isPlatformReviewer, worker.js handlePartner 가 본다)
  { method: 'GET', path: '/admin/partner/certs', admin: true, reviewer: true, run: adminListCerts },
  {
    method: 'POST',
    path: '/admin/partner/certs/:id',
    admin: true,
    reviewer: true,
    run: adminDecideCert,
  },
].map((r) => ({ ...r, parts: r.path.split('/') }));

/**
 * 요청에 맞는 길. 없으면 null (partner.js matchPartnerRoute 와 같은 모양).
 * @returns {{ run: Function, admin: boolean, reviewer: boolean, raw: boolean, params: object } | null}
 */
export function matchCertRoute(method, pathname) {
  const parts = String(pathname || '').split('/');
  for (const r of ROUTES) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const want = r.parts[i];
      if (want.startsWith(':')) {
        if (!parts[i]) {
          ok = false;
          break;
        }
        try {
          params[want.slice(1)] = decodeURIComponent(parts[i]);
        } catch {
          ok = false;
          break;
        }
      } else if (want !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { run: r.run, admin: !!r.admin, reviewer: !!r.reviewer, raw: !!r.raw, params };
  }
  return null;
}

/** 표 · 칸이 아직 없다 (0077 적용 전) — PostgREST PGRST205 · PGRST204, Postgres 42P01 · 42703 */
const isMissing = (e) =>
  e instanceof DbError && /^(PGRST20[45]|42P01|42703)$/.test(String(e.code || ''));

/**
 * 확인된 사람(user)으로 길을 돌린다. 던지지 않는다 (partner.js runPartnerRoute 와 같은 응답).
 * raw 길(사진 올리기)은 본문을 JSON 으로 읽지 않고 request 를 그대로 넘긴다.
 */
export async function runCertRoute(request, env, route, { user, url }) {
  const reply = (body, status) => partnerResponse(request, env, body, status);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply({ success: false, code: 'not_configured', error: '서버 설정이 필요합니다.' }, 503);
  }
  if (!user || typeof user.id !== 'string' || !UUID_RE.test(user.id)) {
    return reply({ success: false, code: 'unauthorized', error: '로그인이 필요합니다' }, 401);
  }
  try {
    const body =
      request.method === 'POST' && !route.raw ? await request.json().catch(() => null) : null;
    const out = await route.run(env, {
      user: { id: user.id.toLowerCase(), email: user.email },
      params: route.params,
      body,
      url,
      request,
    });
    return reply({ success: true, data: out.data }, out.status || 200);
  } catch (e) {
    if (e instanceof PartnerError) {
      return reply(
        { success: false, code: e.code, error: e.message, ...(e.extra || {}) },
        e.status
      );
    }
    if (isMissing(e)) {
      console.warn('[cert] not ready:', e.code);
      return reply({ success: false, code: 'not_ready', error: MSG.not_ready }, 503);
    }
    console.error('[cert] error:', e && e.message ? e.message : '?');
    return reply(
      { success: false, code: 'server_error', error: '처리 중 오류가 발생했습니다.' },
      500
    );
  }
}
