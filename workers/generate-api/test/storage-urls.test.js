/**
 * 서명 URL (2026-10-26, src/storage-urls.js) — generations 버킷을 비공개로 바꿔도 화면이 그대로 보이게.
 *
 * 고정하는 것:
 *   1) toStorageRef: 저장된 공개 URL · 서명 URL · 버킷 안 경로 → { bucket, path }. 그 밖은 null
 *   2) createSignedUrls: service_role 로 sign 엔드포인트에 경로 묶음을 한 번 보내고 절대 URL 로 돌려준다
 *   3) signImageUrls: path(없으면 url)로 서명해 url 만 바꾼다. 다른 버킷·외부 주소는 그대로, 실패하면 저장된 URL 그대로
 *   4) shareSignedTtl: 링크가 남은 시간, 최대 1시간
 *   5) 경로: GET /api/share 는 링크 남은 시간으로, GET /api/generate/:id 는 1시간으로 서명한 url 을 싣는다
 *   6) generations 버킷 업로드는 Cache-Control: private, max-age=3600 (예전 public · 1년 · immutable)
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { OBJECT_CACHE_CONTROL, uploadObject } from '../src/supabase.js';
import {
  OWNER_SIGNED_TTL_SEC,
  SHARE_SIGNED_MAX_SEC,
  createSignedUrls,
  shareSignedTtl,
  signImageUrls,
  toStorageRef,
} from '../src/storage-urls.js';

const SB = 'https://example.supabase.co';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
  SHARE_TOKEN_PEPPER: 'pepper',
};
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = `${USER_ID}/${ROW_ID}`;
const pub = (p, bucket = 'generations') => `${SB}/storage/v1/object/public/${bucket}/${p}`;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** sign 엔드포인트 흉내 — 받은 경로마다 '/object/sign/<bucket>/<path>?token=t-<expiresIn>' */
function signResponder(signs, { fail = [] } = {}) {
  return async (url, init) => {
    const bucket = String(url).split('/object/sign/')[1];
    const body = JSON.parse(init.body);
    signs.push({ url: String(url), bucket, headers: init.headers, body });
    return jsonRes(
      body.paths.map((p) =>
        fail.includes(p)
          ? { error: 'Either the object does not exist or you do not have access to it', path: p, signedURL: null }
          : { error: null, path: p, signedURL: `/object/sign/${bucket}/${p}?token=t-${body.expiresIn}` }
      )
    );
  };
}
const signedOf = (p, ttl, bucket = 'generations') => `${SB}/storage/v1/object/sign/${bucket}/${p}?token=t-${ttl}`;

// ─── 1) toStorageRef ───

test('toStorageRef: 저장된 공개 URL → 버킷 · 경로', () => {
  assert.deepEqual(toStorageRef(pub(`${PREFIX}/base.png`)), { bucket: 'generations', path: `${PREFIX}/base.png` });
  assert.deepEqual(toStorageRef(pub(`${USER_ID}/site_photo/1.jpg`, 'design-images')), {
    bucket: 'design-images',
    path: `${USER_ID}/site_photo/1.jpg`,
  });
});

test('toStorageRef: 서명 URL(토큰) · authenticated URL 도 같은 경로로 — 쿼리는 버린다', () => {
  assert.deepEqual(toStorageRef(`${SB}/storage/v1/object/sign/generations/${PREFIX}/v2.jpg?token=abc.def`), {
    bucket: 'generations',
    path: `${PREFIX}/v2.jpg`,
  });
  assert.deepEqual(toStorageRef(`${SB}/storage/v1/object/authenticated/design-images/${USER_ID}/a.png`), {
    bucket: 'design-images',
    path: `${USER_ID}/a.png`,
  });
});

test('toStorageRef: 퍼센트 인코딩된 경로는 풀어서 (서명 요청은 원래 경로로 간다)', () => {
  assert.deepEqual(toStorageRef(pub(`${USER_ID}/site_photo/%ED%98%84%EC%9E%A5%201.jpg`, 'design-images')), {
    bucket: 'design-images',
    path: `${USER_ID}/site_photo/현장 1.jpg`,
  });
});

test('toStorageRef: 버킷을 주면 버킷 안 경로도 받는다 — 주지 않으면 경로만으로는 모른다', () => {
  assert.deepEqual(toStorageRef(`${PREFIX}/room.jpg`, 'generations'), { bucket: 'generations', path: `${PREFIX}/room.jpg` });
  assert.equal(toStorageRef(`${PREFIX}/room.jpg`), null);
});

test('toStorageRef: 스토리지 주소가 아니면 null — data: · blob: · 외부 서버 · 사이트 상대 · .. · 빈 값', () => {
  for (const v of ['data:image/png;base64,AAAA', 'blob:https://x/1', 'https://cdn.example.com/a.jpg', '/img/a.jpg', `${USER_ID}/../x.png`, '', null, undefined, 42]) {
    assert.equal(toStorageRef(v, 'generations'), null, String(v));
  }
});

// ─── 2) createSignedUrls ───

test('createSignedUrls: service_role 로 한 번에 보내고(중복 제거) 절대 URL 로 돌려준다 · 실패한 경로는 빠진다', async () => {
  const signs = [];
  globalThis.fetch = signResponder(signs, { fail: ['b.png'] });
  const m = await createSignedUrls(ENV, 'generations', ['a.png', 'b.png', 'a.png', '', null], 600);
  assert.equal(signs.length, 1);
  assert.equal(signs[0].url, `${SB}/storage/v1/object/sign/generations`);
  assert.equal(signs[0].headers.Authorization, 'Bearer service');
  assert.equal(signs[0].headers.apikey, 'service');
  assert.deepEqual(signs[0].body, { expiresIn: 600, paths: ['a.png', 'b.png'] });
  assert.equal(m.get('a.png'), signedOf('a.png', 600));
  assert.equal(m.has('b.png'), false);
});

test('createSignedUrls: 경로가 없으면 요청하지 않는다', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch 하면 안 된다');
  };
  assert.equal((await createSignedUrls(ENV, 'generations', [], 600)).size, 0);
});

// ─── 3) signImageUrls ───

test('signImageUrls: path 로 서명해 url 만 바꾼다 — 나머지 칸·원본 배열은 그대로', async () => {
  const signs = [];
  globalThis.fetch = signResponder(signs);
  const images = [
    { slot: 'base', label: '기본안', path: `${PREFIX}/base.png`, url: pub(`${PREFIX}/base.png`), qc: { ok: true } },
    { slot: 'v2', label: '추천', path: `${PREFIX}/v2.jpg`, url: pub(`${PREFIX}/v2.jpg`) },
  ];
  const out = await signImageUrls(ENV, images, 'generations', 3600);
  assert.equal(signs.length, 1, '목록은 한 번에');
  assert.deepEqual(out[0], { ...images[0], url: signedOf(`${PREFIX}/base.png`, 3600) });
  assert.equal(out[1].url, signedOf(`${PREFIX}/v2.jpg`, 3600));
  assert.equal(images[0].url, pub(`${PREFIX}/base.png`), '원본은 건드리지 않는다');
});

test('signImageUrls: path 가 없으면 저장된 URL 에서 경로를 꺼낸다', async () => {
  const signs = [];
  globalThis.fetch = signResponder(signs);
  const out = await signImageUrls(ENV, [{ slot: 'base', url: pub(`${PREFIX}/base.png`) }], 'generations', 3600);
  assert.deepEqual(signs[0].body.paths, [`${PREFIX}/base.png`]);
  assert.equal(out[0].url, signedOf(`${PREFIX}/base.png`, 3600));
});

test('signImageUrls: 다른 버킷·외부 주소·빈 칸은 그대로, 서명할 것이 없으면 요청도 없다', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch 하면 안 된다');
  };
  const images = [
    { slot: 'a', url: pub('m1/photo.webp', 'appliance-images') },
    { slot: 'b', url: 'data:image/png;base64,AAAA' },
    { slot: 'c', url: 'u0' },
    null,
  ];
  assert.deepEqual(await signImageUrls(ENV, images, 'generations', 3600), images);
  assert.deepEqual(await signImageUrls(ENV, null, 'generations', 3600), []);
});

test('signImageUrls: 서명 요청이 실패하면 저장된 URL 그대로 (공개 버킷이면 지금처럼 열린다)', async () => {
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  const images = [{ slot: 'base', path: `${PREFIX}/base.png`, url: pub(`${PREFIX}/base.png`) }];
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await signImageUrls(ENV, images, 'generations', 3600), images);
  } finally {
    console.warn = warn;
  }
});

test('signImageUrls: 그 경로만 서명에 실패하면 그 칸만 저장된 URL', async () => {
  const signs = [];
  globalThis.fetch = signResponder(signs, { fail: [`${PREFIX}/v3.jpg`] });
  const out = await signImageUrls(
    ENV,
    [
      { slot: 'base', path: `${PREFIX}/base.png`, url: pub(`${PREFIX}/base.png`) },
      { slot: 'v3', path: `${PREFIX}/v3.jpg`, url: pub(`${PREFIX}/v3.jpg`) },
    ],
    'generations',
    3600
  );
  assert.equal(out[0].url, signedOf(`${PREFIX}/base.png`, 3600));
  assert.equal(out[1].url, pub(`${PREFIX}/v3.jpg`));
});

// ─── 4) shareSignedTtl ───

test('shareSignedTtl: 링크가 남은 시간, 최대 1시간 · 만료 시각이 없으면 최대값 · 최소 1초', () => {
  const now = Date.parse('2026-10-26T00:00:00Z');
  assert.equal(SHARE_SIGNED_MAX_SEC, 3600);
  assert.equal(shareSignedTtl('2026-10-26T00:10:00Z', now), 600);
  assert.equal(shareSignedTtl('2026-11-25T00:00:00Z', now), 3600);
  assert.equal(shareSignedTtl(null, now), 3600);
  assert.equal(shareSignedTtl('2026-10-26T00:00:00.400Z', now), 1);
});

// ─── 5) 경로 ───

const IMAGES = [
  { slot: 'base', label: '싱크대 · 기본안', path: `${PREFIX}/base.png`, url: pub(`${PREFIX}/base.png`), qc: { ok: true } },
  { slot: 'v2', label: '추천 · 월넛', path: `${PREFIX}/v2.jpg`, url: pub(`${PREFIX}/v2.jpg`) },
];

function installRoute(row, signs) {
  const sign = signResponder(signs);
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
    if (u.includes('/storage/v1/object/sign/')) return sign(url, init);
    if (u.includes('/rest/v1/generations')) return jsonRes(row ? [row] : []);
    throw new Error(`unexpected fetch ${u}`);
  };
}

test('GET /api/share: 링크가 10분 남았으면 10분짜리 서명 URL — 싣는 칸은 예전 그대로', async () => {
  const signs = [];
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  installRoute({ id: ROW_ID, user_id: USER_ID, status: 'done', category: 'sink', options: {}, images: IMAGES, share_expires_at: expires }, signs);
  const res = await worker.fetch(new Request('https://api.test/api/share', { headers: { 'X-Share-Token': 'tok' } }), { ...ENV });
  assert.equal(res.status, 200);
  const { generation } = await res.json();
  assert.equal(signs.length, 1, '공유 열람도 목록은 한 번에 서명');
  const ttl = signs[0].body.expiresIn;
  assert.ok(ttl > 590 && ttl <= 600, `expiresIn ${ttl}`);
  assert.equal(signs[0].headers.Authorization, 'Bearer service', '익명 열람은 워커가 service_role 로 서명');
  assert.deepEqual(generation.images, [
    { slot: 'base', label: '싱크대 · 기본안', url: signedOf(`${PREFIX}/base.png`, ttl) },
    { slot: 'v2', label: '추천 · 월넛', url: signedOf(`${PREFIX}/v2.jpg`, ttl) },
  ]);
});

test('GET /api/share: 링크가 30일 남았어도 서명은 최대 1시간', async () => {
  const signs = [];
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  installRoute({ id: ROW_ID, user_id: USER_ID, status: 'done', category: 'sink', options: {}, images: IMAGES, share_expires_at: expires }, signs);
  const res = await worker.fetch(new Request('https://api.test/api/share', { headers: { 'X-Share-Token': 'tok' } }), { ...ENV });
  assert.equal(res.status, 200);
  assert.equal(signs[0].body.expiresIn, SHARE_SIGNED_MAX_SEC);
});

test('GET /api/share: 만료·회수된 링크는 서명하지 않는다 (410)', async () => {
  const signs = [];
  installRoute({ id: ROW_ID, user_id: USER_ID, status: 'done', options: {}, images: IMAGES, share_expires_at: new Date(Date.now() - 1000).toISOString() }, signs);
  const res = await worker.fetch(new Request('https://api.test/api/share', { headers: { 'X-Share-Token': 'tok' } }), { ...ENV });
  assert.equal(res.status, 410);
  assert.equal(signs.length, 0);
});

test('GET /api/generate/:id: 본인 조회는 1시간짜리 서명 URL, path 는 그대로 싣는다', async () => {
  const signs = [];
  installRoute({ id: ROW_ID, status: 'done', category: 'sink', images: IMAGES, created_at: '2026-10-26T00:00:00Z' }, signs);
  const res = await worker.fetch(
    new Request(`https://api.test/api/generate/${ROW_ID}`, { headers: { Authorization: 'Bearer t' } }),
    { ...ENV }
  );
  assert.equal(res.status, 200);
  const { generation } = await res.json();
  assert.equal(signs.length, 1);
  assert.equal(signs[0].body.expiresIn, OWNER_SIGNED_TTL_SEC);
  assert.equal(OWNER_SIGNED_TTL_SEC, 3600);
  assert.equal(generation.images[0].url, signedOf(`${PREFIX}/base.png`, 3600));
  assert.equal(generation.images[0].path, `${PREFIX}/base.png`);
  assert.deepEqual(generation.images[0].qc, { ok: true });
  assert.equal(generation.images[1].url, signedOf(`${PREFIX}/v2.jpg`, 3600));
});

// ─── 6) 업로드 캐시 ───

test('uploadObject: generations 버킷 업로드는 Cache-Control: private, max-age=3600', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return jsonRes({ Key: 'ok' });
  };
  const up = await uploadObject(ENV, `${PREFIX}/base.png`, Buffer.from('IMG').toString('base64'), 'image/png');
  assert.equal(OBJECT_CACHE_CONTROL, 'private, max-age=3600');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `${SB}/storage/v1/object/generations/${PREFIX}/base.png`);
  assert.equal(seen[0].init.headers['Cache-Control'], 'private, max-age=3600');
  assert.equal(seen[0].init.headers['Content-Type'], 'image/png');
  assert.equal(up.url, pub(`${PREFIX}/base.png`), '행에 저장하는 주소는 예전 모양 그대로');
});
