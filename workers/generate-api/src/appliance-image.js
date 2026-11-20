/**
 * 가전 모델 제품 사진 (2026-10-20 사장님 결정 "모델 사진 = (b)").
 *
 *   POST /api/admin/appliance-image  {modelId}   관리자 전용 — 제조사 원본(image_source_url)을 서버에서 받아
 *                                                버킷 appliance-images 에 올리고 image_path 를 채운다 (= 승인).
 *
 * 왜 워커인가: 제조사 사진 서버는 CORS 를 열어 두지 않아 관리 화면(브라우저)이 직접 받을 수 없다.
 * 남의 주소를 서버가 대신 받으므로(SSRF) **허용 호스트만**, https 만, 리다이렉트도 매번 같은 검사, 크기·형식 제한.
 *
 * DB · 버킷은 database/appliance-models-images.sql. 그 SQL 을 아직 안 돌렸으면 409 로 그 파일을 알려 준다.
 * 2026-10-20 사장님 결정은 「치수가 검증된 모델만」이었다 — 2026-11-20 대표님 「미검증도 사진은 가져오기」로 풀었다.
 *   치수 검증(verified)은 사진과 상관없이 따로 남는다 (설계 · 치수에만 쓴다).
 * ※ 제조사 사진 사용 약관 확인은 사장님 몫이다.
 */
import { verifyJwt } from './auth.js';
import { DbError, ForbiddenError, NotFoundError, ValidationError, fetchObjectBase64, selectOne, updateById } from './supabase.js';

export const APPLIANCE_IMAGE_BUCKET = 'appliance-images';

/**
 * 제조사 사진 호스트 — 수집기(scripts/fridge-catalog · kitchen-catalog)가 내보내는 곳.
 *   2026-10-20: 삼성 · LG(www → static 으로 넘어간다, SKS 는 image5) · 위니아 · 리페르(assets-cdn.liebherr.com) · 데이코(www.dacorkorea.com)
 *     · 스메그(www.j-collection.co.kr — 스메그 국내 수입사 제이콜렉션).
 *   2026-11-20 대표님 「(받는 곳 밖 사이트) 넣음」 — 카탈로그에 사진 주소가 있는 나머지 22곳. 그날 robots.txt 를 원문으로 확인:
 *     이미지 경로를 막은 곳 없음 · robots 없음(404)이 11곳 · 4xx(403)인 4곳(쿠쿠 CDN 둘 · 마이디어 OSS · SK매직)은 RFC 9309 대로 막지 않은 것으로 본다.
 */
export const APPLIANCE_IMAGE_HOSTS = [
  'images.samsung.com',
  'www.lge.co.kr', 'static.lge.co.kr', 'image5.lge.co.kr',
  'www.winia.com',
  'assets-cdn.liebherr.com',
  'www.dacorkorea.com',
  'www.j-collection.co.kr',
  // 2026-11-20 — 싱크볼 · 수전 · 쿡탑 · 후드 · 밥솥 · 오븐 · 식세기 · 정수기 · 와인셀러 · 냉장고 제조사
  'baekjosink.com', // 백조 · 아펠 · 블랑코 · 엘레치
  'media3.bsh-group.com', // 가게나우
  'lizens.co.kr', // 리젠스 · 알타이녹스 · 레지녹스
  'static.navienhouse.com', // 나비엔 매직
  'cdn.cuckoo.co.kr', 'cdn3.cuckoo.co.kr', // 쿠쿠
  'www.haatz.com', // 하츠
  'cuchencdn.wisacdn.com', // 쿠첸
  'www.daelimbath.com', // 대림바스
  'www.haier.co.kr', // 하이얼
  'media.miele.com', // 밀레
  'web-res.midea.com', 'iscrm-oss-hk.midea.com', // 마이디어
  'www.electrolux.co.kr', // 일렉트로룩스
  'kohler.scene7.com', // 콜러
  'picopureal.wisacdn.com', // 퓨리얼
  'www.hulec.co.kr', // 휴렉
  'static.skmagic.com', // SK매직
  'www.hdquming.com', // 현대큐밍
  'www.fineappliances.co.kr', // 와인셀러
  'www.ruhens.co.kr', // 루헨스
  'www.kyowonwells.com', // 웰스
];

export const APPLIANCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApplianceImageError extends Error {
  constructor(message, statusCode = 400, code) {
    super(message);
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

/** 허용 호스트의 https 주소인가. 사용자 정보·다른 포트는 받지 않는다. */
export function isAllowedImageUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || ''));
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && (u.port === '' || u.port === '443') &&
    APPLIANCE_IMAGE_HOSTS.includes(u.hostname.toLowerCase());
}

/** 바이트 머리로 형식을 가린다 — Content-Type 만 믿지 않는다. jpeg · png · webp 만. */
export function sniffImageType(bytes) {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * 제조사 사진을 받는다 — 리다이렉트는 직접 따라가며 매번 호스트를 다시 본다.
 * @returns {Promise<{bytes:Uint8Array, mimeType:string}>}
 */
export async function fetchManufacturerImage(url, { fetchImpl = fetch } = {}) {
  let current = String(url || '');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedImageUrl(current)) {
      throw new ApplianceImageError(`허용하지 않는 사진 주소입니다 (${APPLIANCE_IMAGE_HOSTS.join(' · ')} 의 https 만)`, 400, 'image_host');
    }
    // 한글 등 그대로 적힌 경로는 표준 형태(퍼센트 인코딩)로 — 백조 · 아펠 사진이 그대로 보내면 400 (2026-11-20)
    current = new URL(current).toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(current, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8', 'User-Agent': 'dadam-appliance-image/1.0' },
      });
    } catch (e) {
      clearTimeout(timer);
      throw new ApplianceImageError(`사진을 받지 못했습니다: ${e.name === 'AbortError' ? '시간 초과' : e.message}`, 502, 'image_fetch');
    }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get('Location');
      if (!loc) throw new ApplianceImageError('사진 주소가 빈 곳으로 넘어갑니다', 502, 'image_fetch');
      current = new URL(loc, current).toString();
      continue;
    }
    try {
      if (!res.ok) throw new ApplianceImageError(`제조사 서버가 ${res.status} 로 답했습니다`, 502, 'image_fetch');
      const len = Number(res.headers.get('Content-Length') || 0);
      if (len > APPLIANCE_IMAGE_MAX_BYTES) throw new ApplianceImageError('사진이 너무 큽니다 (8MB 까지)', 413, 'image_size');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > APPLIANCE_IMAGE_MAX_BYTES) throw new ApplianceImageError('사진이 너무 큽니다 (8MB 까지)', 413, 'image_size');
      const mimeType = sniffImageType(bytes);
      if (!mimeType) throw new ApplianceImageError('사진이 아닙니다 (jpeg · png · webp 만)', 415, 'image_type');
      return { bytes, mimeType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new ApplianceImageError('사진 주소가 너무 여러 번 넘어갑니다', 502, 'image_fetch');
}

/** 버킷 appliance-images 에 올린다 (있으면 덮어쓴다). 버킷이 없으면 SQL 안내. */
async function uploadApplianceImage(env, path, bytes, mimeType) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new DbError('SUPABASE_SERVICE_ROLE_KEY not configured');
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${APPLIANCE_IMAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': mimeType,
      'x-upsert': 'true',
      'Cache-Control': 'public, max-age=86400',
    },
    body: bytes,
  });
  if (!res.ok) {
    const text = await res.text();
    if (/bucket/i.test(text) && /not.?found/i.test(text)) {
      throw new ApplianceImageError('버킷 appliance-images 가 없습니다 — database/appliance-models-images.sql 을 먼저 실행해 주세요', 409, 'sql_missing');
    }
    throw new DbError(`Storage upload ${res.status}: ${text.slice(0, 200)}`, 502);
  }
}

export function applianceImagePublicUrl(env, path) {
  return `${env.SUPABASE_URL}/storage/v1/object/public/${APPLIANCE_IMAGE_BUCKET}/${path}`;
}

/**
 * 2026-10-20: 생성 때 — 고른 냉장고 모델(design_spec appliances[].model)의 가져온 사진을 읽는다.
 *   모델 코드(대표 코드 또는 색상 변형 코드)로 찾고, 브랜드가 있으면 브랜드도 맞춘다. image_path 가 있는 행만.
 *   없으면 null (글만으로 그린다). 칸이 없거나(SQL 미실행) 읽기 실패는 던진다 — job.js 가 잡아 글만으로 간다.
 * @returns {Promise<{base64:string, mimeType:string, code:string, modelId:string}|null>}
 */
export async function loadFridgeModelPhoto(env, model) {
  const code = model && typeof model.code === 'string' ? model.code.trim() : '';
  // PostgREST 필터에 그대로 들어간다 — 수집한 코드 모양(영숫자 · . _ - 괄호)만 받는다. 위니아는 'LWFU266HEMYSO(A)'
  if (!/^[A-Za-z0-9][A-Za-z0-9._()-]{0,39}$/.test(code)) return null;
  const query = {
    select: 'id,image_path',
    image_path: 'not.is.null',
    or: `(model_code.eq."${code}",model_codes.cs.{"${code}"})`,
    order: 'verified.desc,updated_at.desc',
  };
  if (model && typeof model.brand === 'string' && model.brand.trim()) query.brand = `eq.${model.brand.trim()}`;
  const row = await selectOne(env, 'appliance_models', query);
  if (!row || !row.image_path) return null;
  const img = await fetchObjectBase64(env, row.image_path, APPLIANCE_IMAGE_BUCKET);
  const mimeType = String(img.mimeType || '').split(';')[0].trim().toLowerCase();
  if (!EXT[mimeType]) return null;
  return { base64: img.base64, mimeType, code, modelId: row.id };
}

/** 관리자 판별 —가전 모델 쓰기 정책(database/fix-appliance-models-rls.sql)과 같은 admin · super_admin. */
async function assertApplianceAdmin(env, user) {
  let row = null;
  try {
    row = await selectOne(env, 'admin_roles', { user_id: `eq.${user.id}`, select: 'role' });
  } catch (e) {
    console.warn('[ApplianceImage] admin_roles read failed:', e.message);
  }
  if (!row || !['admin', 'super_admin'].includes(row.role)) {
    throw new ForbiddenError('가전 모델 사진은 admin · super_admin 만 가져올 수 있습니다');
  }
}

const sqlMissing = (e) => e instanceof DbError && /image_(source_url|path|approved)/.test(e.message);

/**
 * POST /api/admin/appliance-image {modelId} → {success, model_id, image_path, url, bytes, mime_type}
 */
export async function copyApplianceImage(request, env) {
  const user = await verifyJwt(request, env);
  await assertApplianceAdmin(env, user);
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError('본문이 JSON 이 아닙니다');
  }
  const modelId = body && body.modelId;
  if (!UUID_RE.test(String(modelId || ''))) throw new ValidationError('modelId 가 필요합니다');

  let row;
  try {
    row = await selectOne(env, 'appliance_models', { id: `eq.${modelId}`, select: 'id,brand,model_code,verified,image_source_url' });
  } catch (e) {
    if (sqlMissing(e)) throw new ApplianceImageError('사진 칸이 없습니다 — database/appliance-models-images.sql 을 먼저 실행해 주세요', 409, 'sql_missing');
    throw e;
  }
  if (!row) throw new NotFoundError('가전 모델을 찾을 수 없습니다');
  // 치수 검증 여부와 상관없이 가져온다 (2026-11-20 대표님 「미검증도 사진은 가져오기」 — 그 전에는 409 model_unverified)
  if (!row.image_source_url) throw new ApplianceImageError('이 모델에는 제조사 사진 주소(image_source_url)가 없습니다', 400, 'no_source');

  const { bytes, mimeType } = await fetchManufacturerImage(row.image_source_url);
  const path = `${row.id}/photo.${EXT[mimeType]}`;
  await uploadApplianceImage(env, path, bytes, mimeType);
  await updateById(env, 'appliance_models', row.id, {
    image_path: path,
    image_approved_at: new Date().toISOString(),
    image_approved_by: user.id,
  });
  return {
    success: true,
    model_id: row.id,
    image_path: path,
    url: applianceImagePublicUrl(env, path),
    bytes: bytes.length,
    mime_type: mimeType,
  };
}

