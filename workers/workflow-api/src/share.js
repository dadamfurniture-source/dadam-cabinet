/**
 * 고객 공유 링크 — 토큰 발급 / 검증 / PIN.
 *
 * 위협 모델: 링크는 카카오톡·문자로 전달되므로 "링크를 가진 사람"이
 * 곧 접근 권한이다. 토큰 강도로는 단톡방 재공유를 막을 수 없다.
 * 그래서 토큰은 추측 불가에만 쓰고, 실제 방어는 PIN + 만료 + 열람 흔적이다.
 */

import { pepperedHash } from './util/hash.js';

const TOKEN_BYTES = 32;
const PIN_MAX_FAIL = 5;
const PIN_LOCK_MINUTES = 30;

/** base64url (패딩 없음). */
function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 공유 토큰 생성. 32바이트 랜덤 → 43자 base64url.
 * 평문은 발급 응답에서 1회만 반환하고 DB 에는 해시만 저장한다.
 */
export function generateShareToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function hashShareToken(env, token) {
  return pepperedHash(env.SHARE_TOKEN_PEPPER, 'share', token);
}

/** PIN 은 문서별로 다른 해시가 되도록 documentId 를 함께 섞는다. */
export function hashAccessPin(env, documentId, pin) {
  return pepperedHash(env.SHARE_TOKEN_PEPPER, 'pin', documentId, String(pin));
}

/** 접근 로그용 IP 해시. 원본 IP 는 저장하지 않는다. */
export async function hashIp(env, request) {
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    '';
  if (!ip) return null;
  return pepperedHash(env.IP_HASH_SALT, 'ip', ip.split(',')[0].trim());
}

/**
 * 공유 링크 URL.
 *
 * ★ 토큰을 쿼리스트링이 아니라 **fragment** 에 싣는다.
 *   쿼리스트링이면 (a) 카카오톡/문자의 링크 미리보기 크롤러가 토큰이 담긴 URL 을
 *   요청해 그 로그에 남고, (b) 고객이 페이지를 열 때 Referer 헤더로 새어 나가고,
 *   (c) Cloudflare/Pages 액세스 로그에 영구 기록된다.
 *   fragment 는 서버로 전송되지 않는다. confirm.html 의 JS 가 location.hash 를
 *   읽어 X-Share-Token 헤더로 실어 보낸다.
 */
export function buildShareUrl(env, token) {
  const base = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/confirm.html#t=${token}`;
}

export function shareExpiryIso(env, validDays) {
  const days =
    Number(validDays) > 0
      ? Number(validDays)
      : parseInt(env.SHARE_LINK_TTL_DAYS || '14', 10) || 14;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** 열람 가능 여부. 사유를 함께 돌려주어 호출부가 상태코드를 정한다. */
export function checkAccessible(doc, now = new Date()) {
  if (!doc) return { ok: false, reason: 'not_found', status: 404 };
  if (doc.status === 'revoked') return { ok: false, reason: 'revoked', status: 410 };
  if (doc.status === 'superseded') return { ok: false, reason: 'superseded', status: 410 };
  if (doc.expires_at && new Date(doc.expires_at) < now) {
    return { ok: false, reason: 'expired', status: 410 };
  }
  return { ok: true };
}

/** PIN 잠금 상태인지. */
export function isPinLocked(doc, now = new Date()) {
  if (!doc.pin_locked_at) return false;
  const until = new Date(doc.pin_locked_at).getTime() + PIN_LOCK_MINUTES * 60 * 1000;
  return now.getTime() < until;
}

/**
 * PIN 검증 결과를 계산한다 (DB 쓰기는 호출부가 한다).
 *
 * @returns {{ok:boolean, reason?:string, status?:number, patch?:Object}}
 *   patch 는 문서에 적용할 실패 카운트/잠금 갱신.
 */
export async function verifyPin(env, doc, suppliedPin, now = new Date()) {
  // PIN 이 설정되지 않은 문서는 열람에 PIN 을 요구하지 않는다
  if (!doc.access_pin_hash) return { ok: true };

  if (isPinLocked(doc, now)) {
    return { ok: false, reason: 'pin_locked', status: 429 };
  }

  if (!suppliedPin) {
    return { ok: false, reason: 'pin_required', status: 401 };
  }

  const supplied = await hashAccessPin(env, doc.id, suppliedPin);
  if (supplied === doc.access_pin_hash) {
    // 성공하면 실패 카운트를 초기화한다
    return {
      ok: true,
      patch: doc.pin_fail_count > 0 ? { pin_fail_count: 0, pin_locked_at: null } : null,
    };
  }

  const fails = (doc.pin_fail_count || 0) + 1;
  const patch = { pin_fail_count: fails };
  if (fails >= PIN_MAX_FAIL) patch.pin_locked_at = now.toISOString();

  return {
    ok: false,
    reason: fails >= PIN_MAX_FAIL ? 'pin_locked' : 'pin_invalid',
    status: fails >= PIN_MAX_FAIL ? 429 : 401,
    patch,
  };
}

/** 고객명 마스킹 — 공유 문서에는 마스킹본만 싣는다. */
export function maskName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (s.length === 1) return s;
  if (s.length === 2) return `${s[0]}*`;
  return `${s[0]}${'*'.repeat(s.length - 2)}${s[s.length - 1]}`;
}

export const PIN_POLICY = { maxFail: PIN_MAX_FAIL, lockMinutes: PIN_LOCK_MINUTES };
