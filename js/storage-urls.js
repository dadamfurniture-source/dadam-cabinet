/**
 * 저장된 Storage 주소 → 지금 열 수 있는 주소 (2026-10-26).
 *
 * 고객 사진 버킷(generations · design-images)을 비공개로 바꿔도 화면이 그대로 보이게 한다.
 * DB 행에는 공개 URL(…/storage/v1/object/public/<버킷>/<경로>) 이나 버킷 안 경로가 저장돼 있다. 행은 옮기지 않는다.
 * 보여 줄 때 로그인한 사람의 세션으로 서명 URL 을 만든다 — 버킷이 공개든 비공개든 같은 결과다
 * (비공개면 database/private-photo-buckets.sql 의 본인 읽기 · 관리자 읽기 정책이 서명을 허락한다).
 *
 * 규칙
 *   - 서명하는 버킷은 PRIVATE_BUCKETS 뿐. 다른 버킷(카탈로그 · 시공사례 · 테마)과 외부 주소는 그대로 돌려준다
 *   - 서명을 못 하면(요청 실패 · 권한 없음) 저장된 값을 그대로 돌려준다 — 지금(공개 버킷)과 같은 결과다
 *   - 목록은 버킷마다 createSignedUrls 한 번 (100개씩 나눠 보낸다)
 *   - 같은 경로는 수명이 절반 넘게 남은 동안 같은 주소를 다시 쓴다 — 폴링으로 다시 읽어도 이미지를 다시 받지 않는다
 *
 * 워커 쪽 같은 규칙: workers/generate-api/src/storage-urls.js (공유 열람·본인 조회는 워커가 service_role 로 서명한다).
 * 브라우저 전역 `DadamStorageUrls`, Node(Jest) 는 module.exports.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamStorageUrls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 고객 사진이 들어 있는 버킷 */
  const PRIVATE_BUCKETS = Object.freeze(['generations', 'design-images']);
  /** 화면에서 쓰는 서명 수명 (초) — 본인 화면 · 관리자 화면 */
  const APP_TTL_SEC = 3600;
  /** createSignedUrls 한 번에 보내는 경로 수 */
  const SIGN_CHUNK = 100;

  // /storage/v1/object/public|sign|authenticated/<bucket>/<path>[?…]
  const OBJECT_URL_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

  function decodeSegment(s) {
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  /**
   * 저장된 값 → { bucket, path }.
   *   - Supabase Storage 객체 URL (공개 · 서명 · authenticated) 이면 그 안의 버킷·경로
   *   - bucket 을 주면 버킷 안 경로('uid/gid/base.png')도 받는다
   *   - 그 밖(data: · blob: · 다른 서버 · 사이트 상대 경로)은 null
   */
  function toStorageRef(value, bucket) {
    if (typeof value !== 'string' || !value) return null;
    const m = OBJECT_URL_RE.exec(value);
    if (m) return { bucket: decodeSegment(m[1]), path: m[2].split('/').map(decodeSegment).join('/') };
    if (!bucket) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.charAt(0) === '/' || value.split('/').indexOf('..') >= 0) return null;
    return { bucket: bucket, path: value };
  }

  // bucket/path → { url, exp(ms) }
  const cache = new Map();

  function cached(key, ttlSec, now) {
    const hit = cache.get(key);
    return hit && hit.exp - now > (ttlSec * 1000) / 2 ? hit.url : null;
  }

  /**
   * 값 여러 개를 서명한다. 들어온 순서 그대로, 같은 길이의 배열을 돌려준다.
   * @param {object} client  supabase-js 클라이언트 (로그인 세션으로 서명한다)
   * @param {Array<string>} values  공개 URL · 서명 URL · 버킷 안 경로(opts.bucket 이 있을 때)
   * @param {{bucket?: string, ttl?: number, now?: number}} [opts]
   * @returns {Promise<Array<string>>}
   */
  async function signUrls(client, values, opts) {
    const o = opts || {};
    const ttl = o.ttl || APP_TTL_SEC;
    const now = o.now || Date.now();
    const list = Array.isArray(values) ? values : [];
    const refs = list.map(function (v) {
      const r = toStorageRef(v, o.bucket);
      return r && PRIVATE_BUCKETS.indexOf(r.bucket) >= 0 ? r : null;
    });

    // 버킷별로 아직 서명이 없는(또는 수명이 절반 아래로 남은) 경로만 모은다
    const need = {};
    refs.forEach(function (r) {
      if (!r || cached(r.bucket + '/' + r.path, ttl, now)) return;
      const arr = need[r.bucket] || (need[r.bucket] = []);
      if (arr.indexOf(r.path) < 0) arr.push(r.path);
    });

    const jobs = [];
    Object.keys(need).forEach(function (bucket) {
      const paths = need[bucket];
      for (let i = 0; i < paths.length; i += SIGN_CHUNK) {
        const chunk = paths.slice(i, i + SIGN_CHUNK);
        jobs.push(
          Promise.resolve()
            .then(function () {
              return client.storage.from(bucket).createSignedUrls(chunk, ttl);
            })
            .then(function (res) {
              if (res && res.error) throw res.error;
              ((res && res.data) || []).forEach(function (x) {
                const url = x && !x.error && (x.signedUrl || x.signedURL);
                if (url) cache.set(bucket + '/' + x.path, { url: url, exp: now + ttl * 1000 });
              });
            })
            .catch(function (e) {
              console.warn('[storage-urls] 서명 실패 — 저장된 주소를 그대로 씁니다:', (e && e.message) || e);
            })
        );
      }
    });
    if (jobs.length) await Promise.all(jobs);

    return list.map(function (v, i) {
      const r = refs[i];
      if (!r) return v;
      const hit = cache.get(r.bucket + '/' + r.path);
      return hit && hit.exp > now ? hit.url : v;
    });
  }

  /** 하나만 — signUrls 와 같은 규칙 */
  async function signUrl(client, value, opts) {
    const out = await signUrls(client, [value], opts);
    return out[0];
  }

  /** 시험용 — 캐시 비우기 */
  function clearCache() {
    cache.clear();
  }

  return {
    PRIVATE_BUCKETS: PRIVATE_BUCKETS,
    APP_TTL_SEC: APP_TTL_SEC,
    SIGN_CHUNK: SIGN_CHUNK,
    toStorageRef: toStorageRef,
    signUrls: signUrls,
    signUrl: signUrl,
    clearCache: clearCache,
  };
});
