/**
 * Web Push 보내기 (src/push/webpush.js).
 *
 *   - 본문 암호화: RFC 8291 부록 A 의 시험 값(고정 키 · 소금)과 바이트까지 같다. 새 키로 만든 본문은 기기 쪽에서 풀린다
 *   - VAPID JWT: ES256 · 머리 { typ, alg } · aud = 받는 주소 origin · exp = 지금 + 12시간 · sub, 서명이 공개 키로 맞는다
 *   - 보내기: POST · Authorization vapid t=…, k=… · Content-Encoding aes128gcm · TTL 86400 · Urgency normal · 넘겨주기 안 따라감
 *   - 받는 주소: 알려진 푸시 서비스의 https 주소만 (SSRF 막기)
 *   - VAPID 설정: 공개 키가 개인 키와 짝이 안 맞거나 비었으면 config
 * 시험 키는 모두 시험용으로 새로 만든다 (RFC 부록 값 제외).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptPayload,
  decodeSubscriptionKeys,
  b64urlDecode,
  b64urlEncode,
  isAllowedPushEndpoint,
  loadVapid,
  clearVapidCache,
  vapidJwt,
  sendWebPush,
  PushError,
  RECORD_SIZE,
  MAX_PLAINTEXT,
} from '../src/push/webpush.js';

const d = (s) => b64urlDecode(s);
const enc = new TextEncoder();
const dec = new TextDecoder();

// ── RFC 8291 부록 A ────────────────────────────────────

const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  // 머리 · 암호문은 따로 적혀 있다 (머리 86바이트라 base64 를 이어 붙이면 전체와 다르다)
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4' +
    'Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

/** 비압축 점 + d → ECDH 개인 키 */
function ecdhPrivate(pubB64, dB64) {
  const p = d(pubB64);
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: b64urlEncode(p.slice(1, 33)), y: b64urlEncode(p.slice(33)), d: dB64 },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
const cat = (...a) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of a) {
    out.set(x, i);
    i += x.length;
  }
  return out;
};

/** 기기 쪽 풀기 (RFC 8291 §3 을 받는 쪽에서) — 시험에서 새 키로 만든 본문 확인용 */
async function decryptAsUserAgent(body, uaPrivateKey, uaPublic, auth) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic, Uint8Array.of(1)));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), Uint8Array.of(1)))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), Uint8Array.of(1)))).slice(0, 12);
  const k = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct));
  return { rs, idlen, delimiter: plain[plain.length - 1], text: dec.decode(plain.slice(0, -1)) };
}

test('RFC 8291 부록 A — 고정 키 · 소금으로 만든 본문이 시험 값과 바이트까지 같다', async () => {
  const out = await encryptPayload(
    d(RFC.plaintext),
    { p256dh: d(RFC.uaPublic), auth: d(RFC.auth) },
    { salt: d(RFC.salt), localPrivateKey: await ecdhPrivate(RFC.asPublic, RFC.asPrivate), localPublicKey: d(RFC.asPublic) },
  );
  assert.equal(b64urlEncode(out.slice(0, 86)), RFC.header);
  assert.equal(b64urlEncode(out.slice(86)), RFC.ciphertext);
  assert.equal(b64urlEncode(out), RFC.body);
  // 머리: 소금 16 · rs 4096 · idlen 65 · 보내는 쪽 공개 키
  assert.equal(new DataView(out.buffer).getUint32(16), RECORD_SIZE);
  assert.equal(out[20], 65);
  // 기기 쪽에서 풀면 원문 + 끝 표시 0x02
  const back = await decryptAsUserAgent(out, await ecdhPrivate(RFC.uaPublic, RFC.uaPrivate), d(RFC.uaPublic), d(RFC.auth));
  assert.equal(back.text, 'When I grow up, I want to be a watermelon');
  assert.equal(back.delimiter, 2);
});

test('새 키 · 소금 — 매번 다르고, 기기 쪽에서 풀린다 (rs 4096 · 끝 표시 0x02)', async () => {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const msg = JSON.stringify({ title: '승인 요청', body: '수주 되살리기 요청이 왔습니다.', url: '/segan/me.html#partner', tag: 't' });
  const a = await encryptPayload(enc.encode(msg), { p256dh: uaPublic, auth });
  const b = await encryptPayload(enc.encode(msg), { p256dh: uaPublic, auth });
  assert.notEqual(b64urlEncode(a), b64urlEncode(b));
  assert.notEqual(b64urlEncode(a.slice(0, 16)), b64urlEncode(b.slice(0, 16)));
  const back = await decryptAsUserAgent(a, ua.privateKey, uaPublic, auth);
  assert.deepEqual(back, { rs: 4096, idlen: 65, delimiter: 2, text: msg });
  assert.equal(a.length, 86 + enc.encode(msg).length + 1 + 16);
});

test('암호화 — 키 모양이 틀리면 bad_key, 글이 3993바이트를 넘으면 too_large', async () => {
  const keys = { p256dh: d(RFC.uaPublic), auth: d(RFC.auth) };
  await assert.rejects(encryptPayload(new Uint8Array(1), { ...keys, auth: new Uint8Array(15) }), { code: 'bad_key' });
  await assert.rejects(encryptPayload(new Uint8Array(1), { ...keys, p256dh: d(RFC.uaPublic).slice(1) }), { code: 'bad_key' });
  const offCurve = d(RFC.uaPublic);
  offCurve[64] ^= 1;
  await assert.rejects(encryptPayload(new Uint8Array(1), { ...keys, p256dh: offCurve }), { code: 'bad_key' });
  await assert.rejects(encryptPayload(new Uint8Array(MAX_PLAINTEXT + 1), keys), { code: 'too_large' });
  const ok = await encryptPayload(new Uint8Array(MAX_PLAINTEXT), keys);
  assert.equal(ok.length, 4096);
  assert.ok(new PushError('x') instanceof Error);
});

test('기기 키 확인 — p256dh 65바이트 곡선 위의 점 · auth 16바이트 (패딩 있어도 됨)', async () => {
  assert.ok(await decodeSubscriptionKeys(RFC.uaPublic, RFC.auth));
  assert.ok(await decodeSubscriptionKeys(RFC.uaPublic, `${RFC.auth}==`));
  const offCurve = d(RFC.uaPublic);
  offCurve[64] ^= 1;
  for (const [p, a] of [
    [RFC.uaPublic.slice(0, -2), RFC.auth],
    [b64urlEncode(offCurve), RFC.auth],
    [RFC.uaPublic, RFC.auth.slice(0, -2)],
    [RFC.uaPublic, 'not base64!'],
    ['', RFC.auth],
    [null, RFC.auth],
    [RFC.asPublic.replace(/^BP/, 'Az'), RFC.auth],
  ]) {
    assert.equal(await decodeSubscriptionKeys(p, a), null, String(p).slice(0, 12));
  }
});

// ── 받는 주소 ──────────────────────────────────────────

test('받는 주소 — 알려진 푸시 서비스의 https 주소만', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/dXk1:APA91bE-abc_def',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
    'https://push.services.mozilla.com/wpush/v1/abc',
    'https://web.push.apple.com/QGuQyavXutnMH7HmHnI',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2bx%2fY',
    'https://FCM.googleapis.com/fcm/send/x',
  ]) {
    assert.equal(isAllowedPushEndpoint(ok), true, ok);
  }
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com.evil.test/x',
    'https://evil.test/fcm.googleapis.com',
    'https://evilfcm.googleapis.com/x',
    'https://notify.windows.com/x',
    'https://evil.test#.notify.windows.com',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com./x',
    'https://169.254.169.254/latest',
    'https://localhost/x',
    'https://fcm.googleapis.com/x y',
    'https://fcm.googleapis.com/x\n',
    ' https://fcm.googleapis.com/x',
    'HTTPS://fcm.googleapis.com/x',
    `https://fcm.googleapis.com/${'a'.repeat(1000)}`,
    'javascript:alert(1)',
    '',
    null,
    42,
  ]) {
    assert.equal(isAllowedPushEndpoint(bad), false, String(bad).slice(0, 40));
  }
});

// ── VAPID ─────────────────────────────────────────────

async function makeVapidEnv(subject = 'https://dadamfurniture.com') {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    env: { VAPID_PRIVATE_KEY: JSON.stringify(jwk), VAPID_PUBLIC_KEY: b64urlEncode(pub), VAPID_SUBJECT: subject },
    publicKey: pair.publicKey,
  };
}

test('VAPID 설정 — 짝이 맞는 키를 읽는다. 비었거나 · 짝이 어긋나거나 · 주체가 https/mailto 가 아니면 config', async () => {
  clearVapidCache();
  const { env } = await makeVapidEnv();
  const v = await loadVapid(env);
  assert.equal(v.publicKey, env.VAPID_PUBLIC_KEY);
  assert.equal(v.subject, 'https://dadamfurniture.com');
  assert.equal(await loadVapid(env), v, '같은 값이면 다시 가져오지 않는다');

  const other = (await makeVapidEnv()).env;
  const cases = [
    {},
    { ...env, VAPID_PRIVATE_KEY: undefined },
    { ...env, VAPID_PUBLIC_KEY: other.VAPID_PUBLIC_KEY },
    { ...env, VAPID_PRIVATE_KEY: '{not json' },
    { ...env, VAPID_PRIVATE_KEY: JSON.stringify({ kty: 'EC', crv: 'P-384' }) },
    { ...env, VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY.slice(0, -4) },
    { ...env, VAPID_SUBJECT: 'dadam' },
    { ...env, VAPID_SUBJECT: 'http://dadamfurniture.com' },
  ];
  for (const c of cases) {
    clearVapidCache();
    await assert.rejects(loadVapid(c), (e) => e instanceof PushError && e.code === 'config');
  }
  clearVapidCache();
  assert.ok(await loadVapid({ ...env, VAPID_SUBJECT: 'mailto:ops@example.test' }));
});

function parseJwt(jwt) {
  const [h, p, s] = jwt.split('.');
  return {
    header: JSON.parse(dec.decode(d(h))),
    claims: JSON.parse(dec.decode(d(p))),
    input: enc.encode(`${h}.${p}`),
    sig: d(s),
  };
}

test('VAPID JWT — ES256, aud = origin · exp = 지금 + 12시간 · sub, 64바이트 서명이 공개 키로 맞는다', async () => {
  clearVapidCache();
  const { env, publicKey } = await makeVapidEnv();
  const v = await loadVapid(env);
  const jwt = await vapidJwt(v, 'https://fcm.googleapis.com', 1_800_000_000);
  assert.match(jwt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const t = parseJwt(jwt);
  assert.deepEqual(t.header, { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(t.claims, { aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://dadamfurniture.com' });
  assert.equal(t.sig.length, 64);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, t.sig, t.input), true);
});

// ── 보내기 ────────────────────────────────────────────

async function withFetch(handler, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

async function deviceSub(endpoint = 'https://fcm.googleapis.com/fcm/send/abc:APA91') {
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { sub: { endpoint, p256dh: b64urlEncode(raw), auth: b64urlEncode(auth) }, ua, raw, auth };
}

test('보내기 — POST, VAPID · aes128gcm · TTL 86400 · Urgency normal, 넘겨주기 안 따라감. 기기 쪽에서 글이 풀린다', async () => {
  clearVapidCache();
  const { env, publicKey } = await makeVapidEnv();
  const v = await loadVapid(env);
  const dev = await deviceSub();
  const message = { title: '업체 신청', body: '업체 신청이 승인되었습니다.', url: '/segan/me.html#partner', tag: 'partner_application:x' };
  const cache = new Map();
  const res = await withFetch(
    () => new Response(null, { status: 201 }),
    async (calls) => {
      const r1 = await sendWebPush(v, dev.sub, message, { nowMs: 1_800_000_000_000, jwtCache: cache });
      const r2 = await sendWebPush(v, dev.sub, message, { nowMs: 1_800_000_000_000, jwtCache: cache });
      assert.equal(calls.length, 2);
      const { url, init } = calls[0];
      assert.equal(url, dev.sub.endpoint);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'manual');
      assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
      assert.equal(init.headers.TTL, '86400');
      assert.equal(init.headers.Urgency, 'normal');
      const m = init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
      assert.ok(m, 'vapid t=…, k=…');
      assert.equal(m[2], env.VAPID_PUBLIC_KEY);
      const t = parseJwt(m[1]);
      assert.equal(t.claims.aud, 'https://fcm.googleapis.com');
      assert.equal(t.claims.exp, 1_800_000_000 + 43200);
      assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, t.sig, t.input), true);
      assert.equal(calls[1].init.headers.Authorization, init.headers.Authorization, '같은 origin 은 JWT 를 다시 쓴다');
      const back = await decryptAsUserAgent(new Uint8Array(init.body), dev.ua.privateKey, dev.raw, dev.auth);
      assert.deepEqual(JSON.parse(back.text), message);
      return [r1, r2];
    },
  );
  assert.deepEqual(res, [{ status: 201 }, { status: 201 }]);
});

test('보내기 — 모르는 주소 · 틀린 키는 보내지 않는다, 연결 실패는 network · 시간 초과는 timeout (주소는 싣지 않는다)', async () => {
  clearVapidCache();
  const { env } = await makeVapidEnv();
  const v = await loadVapid(env);
  const dev = await deviceSub();
  await withFetch(
    () => {
      throw new TypeError(`fetch failed ${dev.sub.endpoint}`);
    },
    async (calls) => {
      assert.deepEqual(await sendWebPush(v, { ...dev.sub, endpoint: 'https://evil.test/x' }, {}), { status: 0, error: 'endpoint' });
      assert.deepEqual(await sendWebPush(v, { ...dev.sub, auth: 'AAAA' }, {}), { status: 0, error: 'bad_key' });
      assert.equal(calls.length, 0);
      assert.deepEqual(await sendWebPush(v, dev.sub, {}), { status: 0, error: 'network' });
    },
  );
  await withFetch(
    () => {
      throw new DOMException('timed out', 'TimeoutError');
    },
    async () => {
      assert.deepEqual(await sendWebPush(v, dev.sub, {}), { status: 0, error: 'timeout' });
    },
  );
  await withFetch(
    () => new Response('gone', { status: 410 }),
    async () => {
      assert.deepEqual(await sendWebPush(v, dev.sub, {}), { status: 410 });
    },
  );
});
