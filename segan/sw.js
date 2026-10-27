/* ============================================================
   segan/sw.js — SEGAN 앱 셸 서비스 워커 (범위 /segan/ 만)

   담는 것: segan/ 안의 앱 셸 파일(HTML · CSS · JS · 아이콘 · 매니페스트)과 오프라인 화면.
   담지 않는 것: 그 밖의 모든 것.
     - GET 이 아닌 요청 → 손대지 않는다 (브라우저가 그대로 보낸다)
     - 다른 출처 → 손대지 않는다 (Supabase · Workers API · 저장소 서명 URL · CDN · 글꼴)
     - 같은 출처라도 /segan/ 밖 → 손대지 않는다 (기존 사이트 · /api/)
     - Authorization 헤더가 붙은 요청 → 손대지 않는다 (사용자마다 다른 응답)
     - 정적 파일 확장자가 아닌 것 → 손대지 않는다
   전략:
     - HTML(페이지 이동) → 네트워크 먼저, 끊기면 담아 둔 페이지, 없으면 offline.html
       캐시 키에서 쿼리를 뺀다 — 로그인 복귀 코드 같은 값이 캐시 키로 남지 않게.
     - ?v= 가 붙은 정적 파일 → 캐시 먼저 (주소가 버전마다 바뀌므로 오래된 내용이 남지 않는다)
     - ?v= 없는 정적 파일(매니페스트 · 매니페스트 아이콘) → 네트워크 먼저, 끊기면 캐시
   캐시 이름에 사이트 자산 버전을 넣는다. 새 워커가 켜지면 이전 버전 캐시를 지운다.
   ASSET_VERSION 은 scripts/stamp-asset-version.mjs 가 찍는다 (손으로 고치지 않는다).
   ============================================================ */
/* global self, caches, fetch, Request, Response, URL */
'use strict';

const ASSET_VERSION = '2026102701';
const CACHE_PREFIX = 'segan-shell-';
const CACHE = CACHE_PREFIX + ASSET_VERSION;
const SCOPE = new URL('./', self.location.href).pathname; // '/segan/'
const OFFLINE = SCOPE + 'offline.html';
const versioned = (p) => `${p}?v=${ASSET_VERSION}`;

const SHELL = [
  SCOPE, // 만들기 (index.html = start_url)
  SCOPE + 'collection.html', // 시공사례
  SCOPE + 'renders.html', // 내 연출컷
  SCOPE + 'me.html', // 내 정보
  OFFLINE,
  SCOPE + 'manifest.webmanifest',
  versioned(SCOPE + 'shell.css'),
  versioned(SCOPE + 'shell.js'),
  versioned(SCOPE + 'make.css'),
  versioned(SCOPE + 'make.js'),
  versioned(SCOPE + 'icons/icon.svg'),
  versioned(SCOPE + 'icons/wordmark.svg'),
  versioned(SCOPE + 'icons/favicon-32.png'),
  versioned(SCOPE + 'icons/favicon-16.png'),
  versioned(SCOPE + 'icons/apple-touch-icon.png'),
  SCOPE + 'icons/icon-192.png',
  SCOPE + 'icons/icon-512.png',
  SCOPE + 'icons/icon-maskable-512.png',
];

const STATIC_EXT = /\.(?:css|js|png|svg|ico|webmanifest|woff2?)$/i;
const abs = (p) => new URL(p, self.location.href).href;

/**
 * 셸 미리 담기. 호스팅이 *.html 을 확장자 없는 주소로 넘기면(리다이렉트) 그 응답은
 * redirected 표시가 붙어 페이지 이동에 그대로 내줄 수 없다 (브라우저가 거부한다).
 * 그래서 리다이렉트를 거친 응답은 본문 · 머리글만 옮긴 새 응답으로 담는다.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    SHELL.map(async (p) => {
      const req = new Request(abs(p), { cache: 'reload' });
      const res = await fetch(req);
      if (!res.ok) throw new Error(`precache ${p}: ${res.status}`);
      const clean = res.redirected
        ? new Response(await res.blob(), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          })
        : res;
      await cache.put(req, clean);
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** 담아도 되는 응답 — 같은 출처의 온전한 200, 리다이렉트 아님, no-store · private 아님 */
function cacheable(res) {
  if (!res || res.status !== 200 || res.type !== 'basic' || res.redirected) return false;
  return !/no-store|private/i.test(res.headers.get('Cache-Control') || '');
}

async function pageNetworkFirst(event, url) {
  const key = url.origin + url.pathname; // 쿼리 · 해시는 키에 넣지 않는다
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(event.request);
    if (cacheable(res)) event.waitUntil(cache.put(key, res.clone()));
    return res;
  } catch {
    return (await cache.match(key)) || (await cache.match(abs(OFFLINE))) || Response.error();
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const res = await fetch(event.request);
  if (cacheable(res)) event.waitUntil(cache.put(event.request, res.clone()));
  return res;
}

async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(event.request);
    if (cacheable(res)) event.waitUntil(cache.put(event.request, res.clone()));
    return res;
  } catch (err) {
    const hit = await cache.match(event.request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;
  if (req.headers.has('Authorization')) return;
  if (url.pathname === SCOPE + 'sw.js') return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    event.respondWith(pageNetworkFirst(event, url));
    return;
  }
  if (!STATIC_EXT.test(url.pathname)) return;
  event.respondWith(url.searchParams.has('v') ? cacheFirst(event) : networkFirst(event));
});
