/**
 * 연출컷 공유 링크 — 토큰 발급·해시·검사.
 *
 * workers/workflow-api/src/share.js + util/hash.js 의 pepperedHash 를 옮겨 왔다 (PIN 은 뺐다 —
 * 연출컷은 계약 문서가 아니다). 위협 모델은 같다: 링크를 가진 사람이 곧 접근 권한이고,
 * 토큰은 추측 불가에만 쓰며 실제 방어는 만료와 회수다.
 *
 * ★ 토큰은 URL fragment(#t=) 에 싣는다. 쿼리스트링이면 미리보기 크롤러·Referer·CDN 로그에 남는다.
 *   fragment 는 서버로 전송되지 않고, 페이지 JS 가 읽어 X-Share-Token 헤더로 보낸다.
 *
 * 이 파일은 import 가 없다 — 테스트가 export 만 떼어 평가한다.
 */

const TOKEN_BYTES = 32;

function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** pepper 를 섞은 단방향 해시. 조각마다 길이를 접두해 경계를 분명히 한다. */
export async function pepperedHash(pepper, ...parts) {
  const payload = [pepper || '', ...parts]
    .map((p) => {
      const s = String(p ?? '');
      return `${s.length}:${s}`;
    })
    .join('|');
  return sha256Hex(payload);
}

/** 32바이트 랜덤 → 43자 base64url. 평문은 발급 응답에서 1회만 돌려준다. */
export function generateShareToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function hashShareToken(env, token) {
  return pepperedHash(env.SHARE_TOKEN_PEPPER, 'gshare', token);
}

export function buildShareUrl(env, token) {
  const base = (env.PUBLIC_BASE_URL || 'https://dadamfurniture.com').replace(/\/+$/, '');
  return `${base}/design-share.html#t=${token}`;
}

export function shareExpiryIso(env, validDays) {
  const days =
    Number(validDays) > 0
      ? Math.min(365, Number(validDays))
      : parseInt(env.SHARE_LINK_TTL_DAYS || '30', 10) || 30;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** 열람 가능 여부. 사유와 상태코드를 함께 돌려준다. */
export function checkShareAccessible(row, now = new Date()) {
  if (!row) return { ok: false, reason: 'not_found', status: 404 };
  if (row.share_revoked_at) return { ok: false, reason: 'share_revoked', status: 410 };
  if (row.share_expires_at && new Date(row.share_expires_at) < now)
    return { ok: false, reason: 'share_expired', status: 410 };
  if (row.status !== 'done') return { ok: false, reason: 'not_ready', status: 409 };
  return { ok: true };
}
