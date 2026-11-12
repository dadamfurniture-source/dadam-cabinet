/**
 * 공유 열람 그림 (2026-11-09) — GET /api/share 는 서명 URL 대신 워커 주소를 싣고,
 * GET /api/share/image/:n 이 같은 토큰 검사 뒤 버킷 객체를 service_role 로 흘려보낸다.
 *
 * 고정하는 것:
 *   1) GET /api/share: 그림 주소는 <워커>/api/share/image/<n>. 서명 요청이 없고, 응답 어디에도 회원 id · 버킷 경로가 없다
 *      이 버킷 경로로 풀리지 않는 칸은 url null
 *   2) GET /api/share/image/:n: 토큰(X-Share-Token)의 해시로 행을 찾고, 그 행 images[n] 의 경로를 service_role 로 읽는다
 *      Content-Type 은 저장된 그대로, 캐시에 남기지 않는다(no-store), CORS 허용 출처에 ACAO
 *   3) 토큰 없음 401 · 맞는 행 없음 404 · 회수 · 만료 · 내부 확인용 410 · 준비 중 409 — 버킷을 읽지 않는다
 *   4) n 이 범위 밖 · 다른 버킷 · 경로 없음 → 404 (버킷을 읽지 않는다)
 *   5) 버킷에 객체가 없으면 404, 버킷 오류는 502 — 오류 글에도 회원 id 가 없다
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { hashShareToken } from '../src/share.js';

const SB = 'https://example.supabase.co';
const ENV = {
  SUPABASE_URL: SB,
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
  SHARE_TOKEN_PEPPER: 'pepper',
  CORS_ORIGINS: 'https://dadamfurniture.com',
};
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';
const PREFIX = `${USER_ID}/${ROW_ID}`;
const pub = (p, bucket = 'generations') => `${SB}/storage/v1/object/public/${bucket}/${p}`;
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

const IMAGES = [
  { slot: 'base', label: '싱크대 · 기본안', path: `${PREFIX}/base.png`, url: pub(`${PREFIX}/base.png`), qc: { ok: true } },
  // path 가 없는 예전 행 — 저장된 공개 URL 에서 경로를 꺼낸다
  { slot: 'v2', label: '추천 · 월넛', url: pub(`${PREFIX}/v2.jpg`) },
  // 다른 버킷 · 외부 주소 — 이 워커가 내보내지 않는다
  { slot: 'v3', label: '다른 버킷', url: pub('m1/photo.webp', 'appliance-images') },
  { slot: 'v4', label: '외부', url: 'https://cdn.example.com/a.jpg' },
];
const ROW = {
  id: ROW_ID,
  user_id: USER_ID,
  status: 'done',
  category: 'sink',
  title: null,
  options: { design_style: 'modern' },
  images: IMAGES,
  quote: null,
  created_at: '2026-11-01T00:00:00Z',
  share_expires_at: future(),
  share_revoked_at: null,
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** 가짜 Supabase — generations 조회는 row, 버킷 읽기는 storage(경로) 가 정한다. 서명 요청은 실패시킨다 */
function install(row, { storage } = {}) {
  const seen = { rest: [], objects: [], signs: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith('/rest/v1/generations')) {
      seen.rest.push(u);
      return jsonRes(row ? [row] : []);
    }
    if (u.pathname.startsWith('/storage/v1/object/sign/')) {
      seen.signs += 1;
      throw new Error('공유 열람은 서명하지 않는다');
    }
    const obj = u.pathname.match(/^\/storage\/v1\/object\/generations\/(.+)$/);
    if (obj) {
      seen.objects.push({ path: decodeURIComponent(obj[1]), headers: init.headers || {} });
      if (storage) return storage(obj[1]);
      return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return seen;
}

const shareReq = (token = 'tok') =>
  new Request('https://api.test/api/share', { headers: token ? { 'X-Share-Token': token } : {} });
const imageReq = (n, token = 'tok', extra = {}) =>
  new Request(`https://api.test/api/share/image/${n}`, {
    headers: { ...(token ? { 'X-Share-Token': token } : {}), ...extra },
  });

// ─── 1) GET /api/share ───

test('GET /api/share: 그림 주소는 워커 /api/share/image/<n> — 서명하지 않고, 회원 id · 버킷 경로가 응답에 없다', async () => {
  const seen = install(ROW);
  const res = await worker.fetch(shareReq(), { ...ENV });
  assert.equal(res.status, 200);
  const text = await res.text();
  const { generation } = JSON.parse(text);
  assert.deepEqual(generation.images, [
    { slot: 'base', label: '싱크대 · 기본안', url: 'https://api.test/api/share/image/0' },
    { slot: 'v2', label: '추천 · 월넛', url: 'https://api.test/api/share/image/1' },
    { slot: 'v3', label: '다른 버킷', url: null },
    { slot: 'v4', label: '외부', url: null },
  ]);
  assert.equal(seen.signs, 0, '서명 요청 없음');
  assert.equal(seen.objects.length, 0, '목록에서는 버킷을 읽지 않는다');
  assert.ok(!text.includes(USER_ID), '회원 id 없음');
  assert.ok(!text.includes(ROW_ID), '연출컷 id 없음');
  assert.ok(!text.includes('/storage/v1/'), '버킷 주소 없음');
  // 행은 토큰의 해시로 찾는다
  assert.equal(seen.rest[0].searchParams.get('share_token_hash'), `eq.${await hashShareToken(ENV, 'tok')}`);
});

// ─── 2) GET /api/share/image/:n ───

test('GET /api/share/image/:n: 같은 토큰 검사 뒤 images[n] 경로를 service_role 로 읽어 그대로 흘려보낸다', async () => {
  const seen = install(ROW);
  const res = await worker.fetch(imageReq(0, 'tok', { Origin: 'https://dadamfurniture.com' }), { ...ENV });
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(res.headers.get('Cache-Control'), 'no-store, private', '모든 링크가 같은 주소라 캐시에 남기지 않는다');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://dadamfurniture.com');
  assert.equal(seen.rest[0].searchParams.get('share_token_hash'), `eq.${await hashShareToken(ENV, 'tok')}`);
  assert.deepEqual(seen.objects.map((o) => o.path), [`${PREFIX}/base.png`]);
  assert.equal(seen.objects[0].headers.Authorization, 'Bearer service');
  assert.equal(seen.objects[0].headers.apikey, 'service');
});

test('GET /api/share/image/:n: path 가 없는 예전 칸은 저장된 공개 URL 의 경로로 읽는다', async () => {
  const seen = install(ROW, {
    storage: () => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
  });
  const res = await worker.fetch(imageReq(1), { ...ENV });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/jpeg');
  assert.deepEqual(seen.objects.map((o) => o.path), [`${PREFIX}/v2.jpg`]);
});

// ─── 3) 토큰 · 링크 상태 ───

test('GET /api/share/image/:n: 토큰이 없으면 401 — 행도 버킷도 읽지 않는다', async () => {
  const seen = install(ROW);
  const res = await worker.fetch(imageReq(0, ''), { ...ENV });
  assert.equal(res.status, 401);
  assert.equal(seen.rest.length, 0);
  assert.equal(seen.objects.length, 0);
});

test('GET /api/share/image/:n: 맞는 행이 없는 토큰은 404', async () => {
  const seen = install(null);
  const res = await worker.fetch(imageReq(0, 'wrong'), { ...ENV });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).code, 'not_found');
  assert.equal(seen.objects.length, 0);
});

test('GET /api/share/image/:n: 회수 · 만료 · 내부 확인용 410, 준비 중 409 — 버킷을 읽지 않는다', async () => {
  const cases = [
    [{ share_revoked_at: past() }, 410, 'share_revoked'],
    [{ share_expires_at: past() }, 410, 'share_expired'],
    [{ options: { internal_only: true } }, 410, 'internal_only'],
    [{ status: 'rendering' }, 409, 'not_ready'],
  ];
  for (const [patch, status, code] of cases) {
    const seen = install({ ...ROW, ...patch });
    const res = await worker.fetch(imageReq(0), { ...ENV });
    assert.equal(res.status, status, code);
    assert.equal((await res.json()).code, code);
    assert.equal(seen.objects.length, 0, code);
  }
});

// ─── 4) 내보내지 않는 칸 ───

test('GET /api/share/image/:n: 범위 밖 · 다른 버킷 · 외부 주소 · 경로 없는 칸은 404 — 버킷을 읽지 않는다', async () => {
  const seen = install({ ...ROW, images: [...IMAGES, { slot: 'v5', label: '빈 칸' }] });
  for (const n of [2, 3, 4, 5, 999]) {
    const res = await worker.fetch(imageReq(n), { ...ENV });
    assert.equal(res.status, 404, String(n));
  }
  assert.equal(seen.objects.length, 0);
});

test('GET /api/share/image/:n: 숫자가 아닌 칸 번호 · GET 이 아닌 요청은 이 경로로 오지 않는다 (404)', async () => {
  const seen = install(ROW);
  for (const req of [
    imageReq('x'),
    imageReq('-1'),
    imageReq('1000'),
    new Request('https://api.test/api/share/image/0', { method: 'POST', headers: { 'X-Share-Token': 'tok' } }),
  ]) {
    const res = await worker.fetch(req, { ...ENV });
    assert.equal(res.status, 404, `${req.method} ${req.url}`);
  }
  assert.equal(seen.objects.length, 0);
});

// ─── 5) 버킷 오류 ───

test('GET /api/share/image/:n: 버킷에 객체가 없으면 404, 버킷 오류는 502 — 오류 글에 회원 id 가 없다', async () => {
  const errors = console.error;
  console.error = () => {};
  try {
    for (const [status, want] of [
      [400, 404],
      [404, 404],
      [500, 502],
    ]) {
      install(ROW, { storage: () => jsonRes({ statusCode: String(status), error: 'x', message: 'x' }, status) });
      const res = await worker.fetch(imageReq(0), { ...ENV });
      assert.equal(res.status, want, String(status));
      const text = await res.text();
      assert.ok(!text.includes(USER_ID), text);
      assert.ok(!text.includes(ROW_ID), text);
    }
  } finally {
    console.error = errors;
  }
});
