/**
 * 2026-10-20: 가전 모델 제품 사진 가져오기 — POST /api/admin/appliance-image (src/appliance-image.js).
 *
 * 고정하는 것:
 *   1) 관리자(admin · super_admin)만 — 로그인 없음 401, 역할 없음·viewer 403
 *   2) 허용 호스트의 https 만 — 다른 호스트·http·포트·사용자 정보 400, 리다이렉트도 매번 같은 검사 (LG www → static 은 통과)
 *   3) 형식은 바이트로 (jpeg · png · webp), 8MB 넘으면 413
 *   4) 성공: 버킷 appliance-images/{id}/photo.{ext} 업로드 → 행에 image_path · image_approved_at · image_approved_by
 *   5) SQL 을 아직 안 돌렸으면(칸·버킷 없음) 409 sql_missing — 그 파일 이름을 알려 준다
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { isAllowedImageUrl, sniffImageType, fetchManufacturerImage, APPLIANCE_IMAGE_MAX_BYTES } from '../src/appliance-image.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const MODEL_ID = '33333333-3333-4333-8333-333333333333';
const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

let realFetch;
let calls;
let state;

const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  realFetch = globalThis.fetch;
  calls = [];
  state = {
    role: 'admin',
    row: { id: MODEL_ID, brand: 'LG', model_code: 'S834MEE111', image_source_url: 'https://www.lge.co.kr/kr/images/refrigerators/md1/md1-450x450.jpg' },
    rowError: null,
    image: { status: 200, body: WEBP },
    bucketMissing: false,
  };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: u, method, init });
    if (u.endsWith('/auth/v1/user')) {
      const auth = (init.headers && init.headers.Authorization) || '';
      return auth === 'Bearer good' ? jsonRes({ id: USER_ID, email: 'a@b.c' }) : jsonRes({ msg: 'bad' }, 401);
    }
    if (u.includes('/rest/v1/admin_roles')) return jsonRes(state.role ? [{ role: state.role }] : []);
    if (u.includes('/rest/v1/appliance_models') && method === 'GET') {
      if (state.rowError) return new Response(state.rowError, { status: 400 });
      return jsonRes(state.row ? [state.row] : []);
    }
    if (u.includes('/rest/v1/appliance_models') && method === 'PATCH') return jsonRes([{ ...state.row, ...JSON.parse(init.body) }]);
    if (u.includes('/storage/v1/object/appliance-images/')) {
      if (state.bucketMissing) return new Response('{"statusCode":"404","error":"Bucket not found","message":"Bucket not found"}', { status: 400 });
      return jsonRes({ Key: 'x' });
    }
    if (u.startsWith('https://www.lge.co.kr/')) {
      return new Response(null, { status: 302, headers: { Location: u.replace('https://www.lge.co.kr', 'https://static.lge.co.kr') } });
    }
    if (u.startsWith('https://static.lge.co.kr/') || u.startsWith('https://images.samsung.com/') || u.startsWith('https://www.winia.com/')) {
      const { status, body, headers } = state.image;
      return new Response(body, { status, headers: headers || {} });
    }
    if (u.startsWith('https://evil.example/')) return new Response(PNG, { status: 200 });
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function post(body, token = 'good') {
  return worker.fetch(
    new Request('https://w.example/api/admin/appliance-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }),
    ENV
  );
}

// ─── 1) 관리자만 ───

test('로그인 없으면 401, 역할 없거나 viewer 면 403 — 제조사 서버에 가지 않는다', async () => {
  assert.equal((await post({ modelId: MODEL_ID }, null)).status, 401);
  state.role = null;
  assert.equal((await post({ modelId: MODEL_ID })).status, 403);
  state.role = 'viewer';
  const r = await post({ modelId: MODEL_ID });
  assert.equal(r.status, 403);
  assert.ok(!calls.some((c) => c.url.includes('lge.co.kr')));
});

test('modelId 가 uuid 가 아니면 400, 행이 없으면 404, 원본 주소가 없으면 400 no_source', async () => {
  assert.equal((await post({ modelId: 'x' })).status, 400);
  state.row = null;
  assert.equal((await post({ modelId: MODEL_ID })).status, 404);
  state.row = { id: MODEL_ID, brand: 'LG', model_code: 'X', image_source_url: null };
  const r = await post({ modelId: MODEL_ID });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'no_source');
});

// ─── 4) 성공 ───

test('성공 — LG www → static 리다이렉트를 따라가 webp 로 올리고 행을 채운다', async () => {
  const r = await post({ modelId: MODEL_ID });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.image_path, `${MODEL_ID}/photo.webp`);
  assert.equal(out.url, `https://example.supabase.co/storage/v1/object/public/appliance-images/${MODEL_ID}/photo.webp`);
  const up = calls.find((c) => c.url.includes('/storage/v1/object/appliance-images/'));
  assert.equal(up.method, 'POST');
  assert.equal(up.init.headers['Content-Type'], 'image/webp');
  assert.equal(up.init.headers['x-upsert'], 'true');
  const patch = calls.find((c) => c.method === 'PATCH');
  const body = JSON.parse(patch.init.body);
  assert.equal(body.image_path, `${MODEL_ID}/photo.webp`);
  assert.equal(body.image_approved_by, USER_ID);
  assert.ok(!Number.isNaN(Date.parse(body.image_approved_at)));
  assert.ok(patch.url.includes(`id=eq.${MODEL_ID}`));
  // 제조사 서버에 우리 키를 보내지 않는다
  for (const c of calls.filter((x) => /lge\.co\.kr/.test(x.url))) {
    assert.ok(!JSON.stringify(c.init.headers || {}).includes('service'));
    assert.equal(c.init.redirect, 'manual');
  }
});

test('형식은 바이트 머리로 — Content-Type 이 image 여도 HTML 이면 415, 확장자는 실제 형식', async () => {
  state.image = { status: 200, body: new TextEncoder().encode('<html>notFound</html>'), headers: { 'Content-Type': 'image/png' } };
  const r = await post({ modelId: MODEL_ID });
  assert.equal(r.status, 415);
  assert.ok(!calls.some((c) => c.method === 'PATCH'));
  state.image = { status: 200, body: JPG, headers: { 'Content-Type': 'image/png' } };
  const ok = await post({ modelId: MODEL_ID });
  assert.equal((await ok.json()).image_path, `${MODEL_ID}/photo.jpg`);
});

test('제조사가 404 면 502, 8MB 넘으면 413 — 행은 그대로', async () => {
  state.image = { status: 404, body: new Uint8Array(0) };
  assert.equal((await post({ modelId: MODEL_ID })).status, 502);
  state.image = { status: 200, body: new Uint8Array(APPLIANCE_IMAGE_MAX_BYTES + 1).fill(0xff) };
  assert.equal((await post({ modelId: MODEL_ID })).status, 413);
  assert.ok(!calls.some((c) => c.method === 'PATCH'));
});

// ─── 2) 허용 호스트 ───

test('허용 호스트의 https 만', () => {
  assert.ok(isAllowedImageUrl('https://images.samsung.com/kdp/goods/a.png'));
  assert.ok(isAllowedImageUrl('https://static.lge.co.kr/kr/images/a.jpg'));
  assert.ok(isAllowedImageUrl('https://www.winia.com/common/file/imageView?IMG_PATH=/upload/basic_info/A(A)_1.png'));
  for (const bad of [
    'http://images.samsung.com/a.png',
    'https://images.samsung.com.evil.example/a.png',
    'https://evil.example/a.png',
    'https://user:pw@images.samsung.com/a.png',
    'https://images.samsung.com:8443/a.png',
    'file:///etc/passwd',
    'https://169.254.169.254/latest',
    '',
    null,
  ]) assert.equal(isAllowedImageUrl(bad), false, String(bad));
});

test('원본이 다른 호스트면 400 image_host — 그 서버에 가지 않는다', async () => {
  state.row = { ...state.row, image_source_url: 'https://evil.example/a.png' };
  const r = await post({ modelId: MODEL_ID });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'image_host');
  assert.ok(!calls.some((c) => c.url.startsWith('https://evil.example/')));
});

test('리다이렉트가 허용 밖으로 나가면 멈춘다', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/x.png' } });
  await assert.rejects(fetchManufacturerImage('https://images.samsung.com/a.png', { fetchImpl }), (e) => e.code === 'image_host');
  const loop = async (u) => new Response(null, { status: 302, headers: { Location: u + 'x' } });
  await assert.rejects(fetchManufacturerImage('https://images.samsung.com/a', { fetchImpl: loop }), /여러 번/);
});

test('sniffImageType — jpeg · png · webp 만', () => {
  assert.equal(sniffImageType(JPG), 'image/jpeg');
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(WEBP), 'image/webp');
  assert.equal(sniffImageType(new TextEncoder().encode('GIF89a')), null);
});

// ─── 5) SQL 아직 ───

test('사진 칸이 없으면 409 sql_missing, 버킷이 없으면 409 sql_missing — 파일 이름을 알려 준다', async () => {
  state.rowError = '{"code":"42703","message":"column appliance_models.image_source_url does not exist"}';
  let r = await post({ modelId: MODEL_ID });
  assert.equal(r.status, 409);
  let out = await r.json();
  assert.equal(out.code, 'sql_missing');
  assert.match(out.error, /appliance-models-images\.sql/);
  state.rowError = null;
  state.bucketMissing = true;
  r = await post({ modelId: MODEL_ID });
  assert.equal(r.status, 409);
  out = await r.json();
  assert.equal(out.code, 'sql_missing');
  assert.ok(!calls.some((c) => c.method === 'PATCH'));
});
