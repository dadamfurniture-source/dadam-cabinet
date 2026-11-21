/**
 * 사업자등록증 사진 — 본문 읽기 · 형식 가리기 · 비공개 버킷 올리기 · 서명 주소 (account-api).
 *
 * 워커끼리 파일을 import 하지 않으므로 workflow-api 의 영수증 사진 도우미를 필요한 만큼 옮겨 왔다:
 *   readBodyCapped · sha256Hex    workers/workflow-api/src/ledger/documents.js
 *   sniffImage · 사진 한도        workers/workflow-api/src/ledger/checks.js (첫 바이트로 JPEG · PNG 를 가린다 — Content-Type 은 보지 않는다)
 *   uploadObject · createSignedUrls  workers/workflow-api/src/storage.js (service role)
 * 한도는 영수증 사진과 같다 — 5MB(버킷 business-certs 와 같다, database/migrations/0077) · 긴 변 2576px · 375만 화소
 *   (화면이 줄여 올린다. 읽기 모델에 보내는 사진 크기를 묶는다).
 * 실패는 StorageError(상태 코드) — 응답 본문 · 경로는 남기지 않는다.
 */

/** 사진 바이트 한도 — 버킷 business-certs 의 file_size_limit 과 같다 */
export const PHOTO_MAX_BYTES = 5242880;
/** 사진 크기 한도 — 화면이 긴 변 2576px · 375만 화소 이하로 줄여 올린다 */
export const PHOTO_MAX_EDGE = 2576;
export const PHOTO_MAX_PIXELS = 3750000;

export class StorageError extends Error {
  constructor(what, status) {
    super(`storage ${what} ${status}`);
    this.status = status;
  }
}

/** 본문 바이트 — 선언된 길이를 먼저 보고, 읽으면서 maxBytes 를 넘으면 null (너무 큼) */
export async function readBodyCapped(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
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
      return null;
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

export async function sha256Hex(u8) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const JPEG_SOF = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegSize(u8) {
  let i = 2;
  while (i + 3 < u8.length) {
    if (u8[i] !== 0xff) return null;
    let marker = u8[i + 1];
    while (marker === 0xff && i + 2 < u8.length) {
      i += 1;
      marker = u8[i + 1];
    }
    // 길이 없는 표시 (RST · TEM)
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = (u8[i + 2] << 8) | u8[i + 3];
    if (len < 2) return null;
    if (JPEG_SOF.has(marker)) {
      if (i + 8 >= u8.length) return null;
      return { height: (u8[i + 5] << 8) | u8[i + 6], width: (u8[i + 7] << 8) | u8[i + 8] };
    }
    i += 2 + len;
  }
  return null;
}

/**
 * 첫 바이트로 형식 · 크기를 본다.
 * @returns {{ mime, width, height } | { heic: true } | null}
 */
export function sniffImage(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 12) return null;
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) {
    const size = jpegSize(u8);
    return size && size.width > 0 && size.height > 0 ? { mime: 'image/jpeg', ...size } : null;
  }
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG.every((b, k) => u8[k] === b)) {
    if (u8.length < 24 || String.fromCharCode(...u8.slice(12, 16)) !== 'IHDR') return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    return width > 0 && height > 0 ? { mime: 'image/png', width, height } : null;
  }
  if (String.fromCharCode(...u8.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...u8.slice(8, 12));
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif'].includes(brand))
      return { heic: true };
  }
  return null;
}

const serviceHeaders = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

/** 비공개 버킷에 파일 하나 올리기 (service role). 같은 경로가 있으면 실패한다 */
export async function uploadObject(env, bucket, path, bytes, contentType) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), 'Content-Type': contentType, 'x-upsert': 'false' },
    body: bytes,
  });
  if (!res.ok) throw new StorageError('upload', res.status);
}

/**
 * 여러 경로의 서명 주소를 한 번에 만든다.
 * @returns {Promise<Map<string, string>>} path → 절대 주소. 실패한 경로는 빠진다
 */
export async function createSignedUrls(env, bucket, paths, expiresIn) {
  const unique = [...new Set((paths || []).filter((p) => typeof p === 'string' && p))];
  const out = new Map();
  if (unique.length === 0) return out;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn, paths: unique }),
  });
  if (!res.ok) throw new StorageError('sign', res.status);
  const rows = await res.json().catch(() => null);
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.error || !row.signedURL) continue;
    // signedURL 은 '/object/sign/<bucket>/<path>?token=…' 형태 (storage/v1 기준 상대 경로)
    const rel = String(row.signedURL).replace(/^\/+/, '');
    out.set(row.path, `${env.SUPABASE_URL}/storage/v1/${rel}`);
  }
  return out;
}
