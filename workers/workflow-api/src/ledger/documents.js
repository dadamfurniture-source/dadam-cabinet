/**
 * 회계장부 — 영수증 · 거래명세표 사진.
 *
 *   POST /ledger/documents   사진 원본 바이트 (Content-Type 은 보지 않고 첫 바이트로 JPEG · PNG 를 가린다)
 *     업체 구성원 누구나 (직원도), 자격 full. 머리 X-Ledger-Note 올린 사람 메모(300자, encodeURIComponent 한 UTF-8).
 *       메모에는 현장 · 고객 이야기가 들어갈 수 있어 주소(쿼리)에 두지 않는다.
 *     X-Idempotency-Key 가 같거나, 같은 업체에 같은 파일(sha256)이 있으면 처음 사진을 돌려준다 (200 reused).
 *     순서: 분 한도(LEDGER_UPLOAD_LIMIT) → 같은 키 → 하루 장수(업체) → 본문(5MB, 읽으면서 센다) → 형식 · 크기 → 같은 파일
 *       → 버킷 ledger-evidence `{업체}/{yyyy}/{mm}/{사진 id}.jpg|png` → 줄
 *     새 사진이면 그 자리에서 읽기를 건다 (extract.js requestExtract, ctx.waitUntil — 응답을 기다리게 하지 않는다)
 *   GET  /ledger/documents   대표 · 실장: 업체 사진 전부 (?status= · ?mine=1 · ?before= · ?limit=).
 *                            직원: 자기가 올린 것의 일자 · 상태 · 돌려보낸 이유만 — 금액 · 메모 · 파일 칸 · 주소는 없다
 *                            ?company= — 본사 대표 · 실장이 공장 사진 목록을 볼 때 (access.js, 보기만)
 *
 * 사진은 지우지 않는다 (DB 트리거). 파일 주소(서명 URL)는 확인 목록(review.js)이 대표 · 실장에게만 준다.
 */
import { selectOne, selectMany, insertOne, asActor, ValidationError, ConflictError, TooLargeError, RateLimitError } from '../supabase.js';
import { kstDate } from '../production/service.js';
import { uploadObject } from '../storage.js';
import { ledgerAccess, assertWritable } from './access.js';
import { requestExtract } from './extract.js';
import { sniffImage, idempotencyKeyOf, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_MAX_PIXELS } from './checks.js';

export const LEDGER_BUCKET = 'ledger-evidence';
/** 하루(KST) 올리는 장수 — 업체마다 (사람마다 따로 세지 않는다: 한 사람이 업체 몫을 다 올릴 수 있다) */
export const DAILY_COMPANY_MAX = 300;
export const LIST_MAX = 100;
export const REVIEW_STATUSES = Object.freeze(['pending', 'posted', 'returned', 'rejected', 'skipped_budget']);

const DOC_COLS = 'id,company_id,uploaded_by,storage_path,mime,size_bytes,sha256,width,height,note,review_status,decided_by,decided_at,decision_reason,created_at';

/** 직원이 보는 상태 — 한도로 못 읽은 것도 「올림」 */
function staffStatus(s) {
  return s === 'pending' || s === 'skipped_budget' ? 'uploaded' : s;
}

/** 보는 사람에 맞춘 사진 줄 */
export function documentView(row, money) {
  if (!money) {
    return {
      id: row.id,
      created_at: row.created_at,
      status: staffStatus(row.review_status),
      reason: row.review_status === 'returned' ? row.decision_reason || null : null,
    };
  }
  return {
    id: row.id,
    created_at: row.created_at,
    uploaded_by: row.uploaded_by,
    review_status: row.review_status,
    note: row.note || null,
    mime: row.mime,
    size_bytes: row.size_bytes,
    width: row.width,
    height: row.height,
    decided_by: row.decided_by || null,
    decided_at: row.decided_at || null,
    decision_reason: row.decision_reason || null,
  };
}

/** 분 한도 — 바인딩이 없거나(시험 · 로컬) 한도기가 실패하면 세지 않는다 (generate-api guard.js 와 같다) */
async function enforceRateLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return;
  let outcome;
  try {
    outcome = await binding.limit({ key: String(key) });
  } catch (e) {
    console.warn('[Ledger] rate limiter failed:', e && e.message);
    return;
  }
  if (outcome && outcome.success === false) throw new RateLimitError();
}

/** 본문 바이트 — 선언된 길이를 먼저 보고, 읽으면서 maxBytes 를 넘으면 413 */
export async function readBodyCapped(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new TooLargeError('사진은 5MB 까지 올립니다');
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* 이미 닫혔다 */
      }
      throw new TooLargeError('사진은 5MB 까지 올립니다');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function sha256Hex(u8) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** X-Ledger-Note 머리 → 메모 | null */
function noteOf(header) {
  if (header === null || header === undefined) return null;
  let s;
  try {
    s = decodeURIComponent(String(header)).trim();
  } catch {
    throw new ValidationError('메모를 읽지 못했습니다');
  }
  if (s.length > 300) throw new ValidationError('메모는 300자 이하입니다');
  return s || null;
}

/** 하루(KST) 장수 — 넘으면 429 daily_limit */
async function checkDaily(env, companyId, today) {
  const rows = (await selectMany(env, 'ledger_documents', {
    company_id: `eq.${companyId}`,
    created_at: `gte.${today}T00:00:00+09:00`,
    select: 'id',
    limit: String(DAILY_COMPANY_MAX),
  })) || [];
  if (rows.length >= DAILY_COMPANY_MAX) throw new RateLimitError(`업체마다 하루 ${DAILY_COMPANY_MAX}장까지 올립니다`, 'daily_limit');
}

async function documentBy(env, companyId, filter) {
  return selectOne(env, 'ledger_documents', { company_id: `eq.${companyId}`, ...filter, select: DOC_COLS });
}

/** 사진 올리기 → { document, reused }. ctx 가 있으면 새 사진의 읽기를 건다 */
export async function uploadDocument(env, { user, request, ctx }) {
  const access = await ledgerAccess(env, user);
  assertWritable(access);
  await enforceRateLimit(env.LEDGER_UPLOAD_LIMIT, user.id);
  const key = idempotencyKeyOf(request.headers.get('X-Idempotency-Key'));
  const note = noteOf(request.headers.get('X-Ledger-Note'));
  if (key) {
    const prev = await documentBy(env, access.companyId, { idempotency_key: `eq.${key}` });
    if (prev) return { document: documentView(prev, access.money), reused: true };
  }
  const today = kstDate();
  await checkDaily(env, access.companyId, today);

  const bytes = await readBodyCapped(request, PHOTO_MAX_BYTES);
  if (!bytes.byteLength) throw new ValidationError('사진 본문이 비었습니다', { code: 'empty' });
  const img = sniffImage(bytes);
  if (img && img.heic) throw new ValidationError('HEIC 사진은 앱이 JPEG 로 바꿔 올립니다', { code: 'heic' });
  if (!img) throw new ValidationError('사진은 JPEG · PNG 만 받습니다', { code: 'bad_type' });
  if (Math.max(img.width, img.height) > PHOTO_MAX_EDGE || img.width * img.height > PHOTO_MAX_PIXELS) {
    throw new ValidationError(`사진이 너무 큽니다 (긴 변 ${PHOTO_MAX_EDGE}px · ${PHOTO_MAX_PIXELS / 10000}만 화소 이하)`, { code: 'dimensions' });
  }
  const sha256 = await sha256Hex(bytes);
  const same = await documentBy(env, access.companyId, { sha256: `eq.${sha256}` });
  if (same) return { document: documentView(same, access.money), reused: true };

  const id = crypto.randomUUID();
  const ext = img.mime === 'image/png' ? 'png' : 'jpg';
  const path = `${access.companyId}/${today.slice(0, 4)}/${today.slice(5, 7)}/${id}.${ext}`;
  await uploadObject(env, LEDGER_BUCKET, path, bytes, img.mime);
  const row = {
    id,
    company_id: access.companyId,
    uploaded_by: user.id,
    storage_path: path,
    mime: img.mime,
    size_bytes: bytes.byteLength,
    sha256,
    width: img.width,
    height: img.height,
    note,
    idempotency_key: key,
  };
  let saved;
  try {
    saved = await insertOne(asActor(env, user), 'ledger_documents', row);
  } catch (e) {
    // 같은 파일 · 같은 키가 동시에 — 먼저 들어간 줄 (올린 파일은 경로가 달라 남는다)
    if (e instanceof ConflictError) {
      const prev = (await documentBy(env, access.companyId, { sha256: `eq.${sha256}` }))
        || (key ? await documentBy(env, access.companyId, { idempotency_key: `eq.${key}` }) : null);
      if (prev) return { document: documentView(prev, access.money), reused: true };
    }
    throw e;
  }
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(requestExtract(env, id));
  return { document: documentView(saved, access.money), reused: false };
}

/** 사진 목록 */
export async function listDocuments(env, { user, company, status, mine, before, limit }) {
  const access = await ledgerAccess(env, user, { company });
  const n = Math.min(Math.max(Number(limit) || 50, 1), LIST_MAX);
  const q = { company_id: `eq.${access.companyId}`, select: DOC_COLS, order: 'created_at.desc', limit: String(n) };
  if (!access.money || mine) q.uploaded_by = `eq.${user.id}`;
  if (status) {
    if (!access.money) throw new ValidationError('상태로 찾기는 대표 · 실장만 합니다');
    if (!REVIEW_STATUSES.includes(status)) throw new ValidationError(`status 는 ${REVIEW_STATUSES.join(' · ')} 중 하나입니다`);
    q.review_status = `eq.${status}`;
  }
  if (before) {
    if (!Number.isFinite(Date.parse(before))) throw new ValidationError('before 는 시각입니다');
    q.created_at = `lt.${new Date(before).toISOString()}`;
  }
  const rows = (await selectMany(env, 'ledger_documents', q)) || [];
  return { items: rows.map((r) => documentView(r, access.money)), money: access.money };
}
