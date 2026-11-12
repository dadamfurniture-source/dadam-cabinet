/**
 * Web Push 보내기 — 의존성 없이 WebCrypto 만 쓴다 (이 워커는 배포 때 npm ci 를 하지 않는다).
 *
 *   본문 암호화  RFC 8291 (aes128gcm) — 기기 키(p256dh)와 ECDH P-256, auth 비밀, HKDF-SHA-256,
 *               레코드 하나(rs 4096), 끝 표시 0x02 (덧붙임 없음).
 *   보내는 쪽   RFC 8292 VAPID — ES256 JWT (aud = 받는 주소의 origin, exp ≤ 12시간, sub = VAPID_SUBJECT)
 *               Authorization: vapid t=<jwt>, k=<VAPID_PUBLIC_KEY>
 *   머리글      Content-Encoding: aes128gcm · TTL: 86400 · Urgency: high
 *               (업무 알림 — 승인 요청 · 결제 실패 등은 바로 봐야 한다. normal 이면 폰이 절전일 때 전달이 늦다)
 *
 * 받는 주소(endpoint)는 알려진 푸시 서비스만 (isAllowedPushEndpoint) — 등록할 때도, 보낼 때도 본다.
 * 넘겨주기(redirect)는 따라가지 않는다.
 *
 * 비밀 (wrangler secret):
 *   VAPID_PRIVATE_KEY  JWK JSON 문자열 (kty · crv · x · y · d)
 *   VAPID_PUBLIC_KEY   base64url 비압축 P-256 점 (65바이트) — JWK 의 x · y 와 같아야 한다
 *   VAPID_SUBJECT      https 주소 (또는 mailto:)
 *
 * 로그 · 오류 글에 받는 주소 · 키 · 알림 글을 싣지 않는다.
 */

const enc = new TextEncoder();

/** 레코드 크기 (RFC 8291 §2 — 레코드 하나) */
export const RECORD_SIZE = 4096;
/** 푸시 서비스가 받아 주는 본문 4096 − 머리 86 − 끝 표시 1 − 태그 16 (RFC 8291 §4) */
export const MAX_PLAINTEXT = 3993;
/** JWT 유효 시간 — 12시간 */
export const VAPID_TTL_SEC = 12 * 60 * 60;
/** 알림을 푸시 서비스가 들고 있는 시간 (초) */
export const PUSH_TTL_SEC = 86400;
/** 푸시 서비스 응답을 기다리는 시간 */
export const SEND_TIMEOUT_MS = 10_000;

/** 알려진 푸시 서비스 — 이 호스트(또는 이 꼬리)만 보낸다 */
export const PUSH_HOSTS = Object.freeze([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);
export const PUSH_HOST_SUFFIXES = Object.freeze(['.notify.windows.com']);
/** DB CHECK (push_subscriptions_endpoint_check) 와 같다 */
export const ENDPOINT_MAX = 1000;

export class PushError extends Error {
  /** code — 짧은 이름만 (bad_key · too_large · config). 받는 주소 · 키는 싣지 않는다 */
  constructor(code) {
    super(code);
    this.code = code;
  }
}

// ── base64url ─────────────────────────────────────────

export function b64urlEncode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const B64URL_RE = /^[A-Za-z0-9_-]*={0,2}$/;

/** base64url (패딩 있어도 됨) → 바이트. 모양이 틀리면 null */
export function b64urlDecode(str) {
  if (typeof str !== 'string' || !B64URL_RE.test(str)) return null;
  let s = str.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (s.length % 4 === 1) return null;
  while (s.length % 4) s += '=';
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

// ── 받는 주소 ─────────────────────────────────────────

/** 출력 가능한 ASCII 만 (공백 · 제어 문자 없음) */
const PRINTABLE_RE = /^[\x21-\x7e]+$/;

/**
 * 알려진 푸시 서비스의 https 주소인가 (SSRF 막기).
 * 사용자 · 비밀번호 · 포트가 붙은 주소, 공백 · 제어 문자가 든 주소, 1000자 넘는 주소는 받지 않는다.
 */
export function isAllowedPushEndpoint(raw) {
  if (typeof raw !== 'string' || raw.length > ENDPOINT_MAX || !raw.startsWith('https://')) return false;
  if (!PRINTABLE_RE.test(raw)) return false;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  if (PUSH_HOSTS.includes(host)) return true;
  return PUSH_HOST_SUFFIXES.some((s) => host.length > s.length && host.endsWith(s));
}

// ── 기기 키 ───────────────────────────────────────────

/**
 * 기기 키 확인 — p256dh 는 P-256 위의 비압축 점(65바이트), auth 는 16바이트.
 * 맞으면 { p256dh, auth } 바이트, 아니면 null.
 */
export async function decodeSubscriptionKeys(p256dhStr, authStr) {
  const p256dh = b64urlDecode(p256dhStr);
  const auth = b64urlDecode(authStr);
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 4) return null;
  if (!auth || auth.length !== 16) return null;
  try {
    // 곡선 위의 점인지 — 아니면 WebCrypto 가 거절한다
    await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch {
    return null;
  }
  return { p256dh, auth };
}

// ── RFC 8291 암호화 ───────────────────────────────────

/**
 * aes128gcm 본문 만들기 (RFC 8291).
 * @param {Uint8Array} plaintext
 * @param {{ p256dh: Uint8Array, auth: Uint8Array }} keys  기기 키 (바이트)
 * @param {{ salt?: Uint8Array, localPrivateKey?: CryptoKey, localPublicKey?: Uint8Array }} [fixed]
 *   시험용 — RFC 8291 부록 A 의 고정 키 · 소금. 평소에는 매번 새로 만든다
 * @returns {Promise<Uint8Array>} 머리(소금 16 · rs 4 · idlen 1 · 보내는 쪽 공개 키 65) + 암호문
 */
export async function encryptPayload(plaintext, keys, fixed = {}) {
  const { p256dh, auth } = keys || {};
  if (!(p256dh instanceof Uint8Array) || p256dh.length !== 65 || p256dh[0] !== 4) throw new PushError('bad_key');
  if (!(auth instanceof Uint8Array) || auth.length !== 16) throw new PushError('bad_key');
  if (!(plaintext instanceof Uint8Array) || plaintext.length > MAX_PLAINTEXT) throw new PushError('too_large');

  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  let asPrivate = fixed.localPrivateKey;
  let asPublic = fixed.localPublicKey;
  if (!asPrivate || !asPublic) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  let uaPublic;
  try {
    uaPublic = await crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch {
    throw new PushError('bad_key');
  }
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, asPrivate, 256));

  // HKDF(auth 비밀, ECDH) → IKM  (key_info = "WebPush: info" 0x00 ua_public as_public)
  const prkKey = await hmac(auth, ecdhSecret);
  const keyInfo = concat(enc.encode('WebPush: info\0'), p256dh, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, Uint8Array.of(1)));
  // HKDF(소금, IKM) → CEK 16 · NONCE 12
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))).slice(0, 12);

  // 레코드 하나 — 글 + 끝 표시 0x02 (덧붙임 없음)
  const record = concat(plaintext, Uint8Array.of(2));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

// ── RFC 8292 VAPID ────────────────────────────────────

let vapidCache = null; // { raw, pub, subject, vapid }

/**
 * VAPID 설정 읽기 (격리마다 한 번 가져온다). 비었거나 틀리면 PushError('config').
 * 공개 키가 개인 키(JWK x · y)와 짝이 맞는지도 본다 — 어긋나면 모든 알림이 거절된다.
 * @returns {Promise<{ key: CryptoKey, publicKey: string, subject: string }>}
 */
export async function loadVapid(env) {
  const raw = env && env.VAPID_PRIVATE_KEY;
  const pub = env && env.VAPID_PUBLIC_KEY;
  const subject = env && env.VAPID_SUBJECT;
  if (vapidCache && vapidCache.raw === raw && vapidCache.pub === pub && vapidCache.subject === subject) {
    return vapidCache.vapid;
  }
  if (typeof raw !== 'string' || typeof pub !== 'string' || typeof subject !== 'string') throw new PushError('config');
  if (!/^(https:\/\/|mailto:)\S+$/.test(subject)) throw new PushError('config');
  let jwk;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new PushError('config');
  }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y || !jwk.d) throw new PushError('config');
  const point = b64urlDecode(pub);
  const x = b64urlDecode(jwk.x);
  const y = b64urlDecode(jwk.y);
  if (!point || point.length !== 65 || point[0] !== 4 || !x || !y || x.length !== 32 || y.length !== 32) {
    throw new PushError('config');
  }
  if (b64urlEncode(point.slice(1, 33)) !== b64urlEncode(x) || b64urlEncode(point.slice(33)) !== b64urlEncode(y)) {
    throw new PushError('config');
  }
  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new PushError('config');
  }
  const vapid = { key, publicKey: b64urlEncode(point), subject };
  vapidCache = { raw, pub, subject, vapid };
  return vapid;
}

/** 시험용 — VAPID 캐시 비우기 */
export function clearVapidCache() {
  vapidCache = null;
}

/**
 * VAPID JWT (ES256). WebCrypto 의 ECDSA 서명은 r ‖ s (64바이트) 라 JWS 모양 그대로다.
 * @param {{ key: CryptoKey, subject: string }} vapid
 * @param {string} audience  받는 주소의 origin
 * @param {number} nowSec
 */
export async function vapidJwt(vapid, audience, nowSec) {
  const head = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: nowSec + VAPID_TTL_SEC, sub: vapid.subject })));
  const input = `${head}.${claims}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapid.key, enc.encode(input));
  return `${input}.${b64urlEncode(new Uint8Array(sig))}`;
}

/**
 * origin 마다 JWT 를 한 번 만들어 쓴다 — 남은 시간이 1시간보다 적으면 새로 만든다.
 * cache 는 Map (한 번의 실행 동안 쓴다).
 */
async function jwtFor(vapid, audience, nowSec, cache) {
  const hit = cache && cache.get(audience);
  if (hit && hit.exp - nowSec > 3600) return hit.jwt;
  const jwt = await vapidJwt(vapid, audience, nowSec);
  if (cache) cache.set(audience, { jwt, exp: nowSec + VAPID_TTL_SEC });
  return jwt;
}

/**
 * 알림 한 건 보내기.
 * @param {{ key: CryptoKey, publicKey: string, subject: string }} vapid  loadVapid 결과
 * @param {{ endpoint: string, p256dh: string, auth: string }} sub  기기 등록 한 줄
 * @param {object} message  { title, body, url, tag } — JSON 으로 보낸다
 * @param {{ nowMs?: number, jwtCache?: Map }} [opts]
 * @returns {Promise<{ status: number, error?: string }>}
 *   status — 푸시 서비스의 HTTP 상태. 보내지 못했으면 0 과 짧은 error
 *   (endpoint · bad_key · too_large · network · timeout). 받는 주소 · 키 · 글은 싣지 않는다
 */
export async function sendWebPush(vapid, sub, message, { nowMs = Date.now(), jwtCache = null } = {}) {
  if (!sub || !isAllowedPushEndpoint(sub.endpoint)) return { status: 0, error: 'endpoint' };
  const keys = await decodeSubscriptionKeys(sub.p256dh, sub.auth);
  if (!keys) return { status: 0, error: 'bad_key' };
  let body;
  try {
    body = await encryptPayload(enc.encode(JSON.stringify(message)), keys);
  } catch (e) {
    return { status: 0, error: e instanceof PushError ? e.code : 'bad_key' };
  }
  const audience = new URL(sub.endpoint).origin;
  const jwt = await jwtFor(vapid, audience, Math.floor(nowMs / 1000), jwtCache);
  let res;
  try {
    res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(PUSH_TTL_SEC),
        Urgency: 'high',
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    return { status: 0, error: e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'network' };
  }
  // 응답 본문은 읽지 않는다 (흘려보낸다)
  try {
    if (res.body && typeof res.body.cancel === 'function') await res.body.cancel();
  } catch {
    /* 무시 */
  }
  return { status: res.status };
}
