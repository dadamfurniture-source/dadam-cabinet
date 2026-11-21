/**
 * 사업자등록증 사진 읽기 — 스키마 · 다듬기 · 내부 길(RPC → 객체 → 스위치 · 줄 · 사진 · 방향 · Claude · 다듬기).
 * 가짜 Supabase(표 · 버킷) · 가짜 Claude(create) · 가짜 Images 바인딩 · 가짜 DO. 실제 네트워크 · 모델 비용 없음.
 * 시험 데이터(번호 · 상호 · 이름)는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDb, makeClaude, makeSessions, SUPA } from './fakes.js';
import {
  readCert,
  runCertRead,
  buildCertRequest,
  CertReader,
  CERT_BUCKET,
} from '../src/extract/cert.js';
import {
  CERT_SCHEMA,
  CERT_FIELDS,
  CERT_SYSTEM,
  CERT_ORIENT_SYSTEM,
  normalizeCert,
} from '../src/extract/cert-schema.js';
import { ORIENT_SCHEMA, SYSTEM } from '../src/extract/schema.js';
import { toBase64, ORIENT_MAX_TOKENS } from '../src/extract/job.js';

const CERT = 'b0000000-0000-4000-8000-000000000001';
const USER = 'a0000000-0000-4000-8000-000000000009';
const PATH = `${USER}/2026/${CERT}.jpg`;
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const ROTATED = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 9, 9]);
const VALID_BIZ = '1234567891'; // 검증 숫자가 맞는 가짜 번호

/** 읽은 칸 한 벌 */
function sample(over = {}) {
  return {
    biz_no: '123-45-67891',
    company_name: '  새봄   가구 ',
    representative_name: '김가짜',
    open_date: '2020-03-05',
    ...over,
  };
}

/** 가짜 Claude 답 — 글 블록에 JSON */
function answer(obj, extra = {}) {
  return {
    content: [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) },
    ],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 5000,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...extra,
  };
}
const orient = (deg) => answer({ rotate: String(deg) });

/** 가짜 Images 바인딩 — input(stream) → transform → output → response */
function fakeImages(out = ROTATED) {
  const calls = [];
  return {
    calls,
    input() {
      const c = { ops: [] };
      calls.push(c);
      const h = {
        transform(o) {
          c.ops.push(['transform', o]);
          return h;
        },
        async output(o) {
          c.ops.push(['output', o]);
          return { response: () => new Response(out) };
        },
      };
      return h;
    },
  };
}

/** env 한 벌 — 사업자등록증 한 줄이 uploaded */
function world({ claude = makeClaude([orient(0), answer(sample())]), db, env = {} } = {}) {
  const d =
    db ||
    makeDb({
      certificates: [
        { id: CERT, user_id: USER, storage_path: PATH, mime: 'image/jpeg', status: 'uploaded' },
      ],
      certPhotos: { [PATH]: PHOTO },
    });
  globalThis.fetch = d.fetch;
  const e = {
    SUPABASE_URL: SUPA,
    SUPABASE_SERVICE_ROLE_KEY: 's',
    ASSISTANT_CLAUDE: claude,
    ...env,
  };
  e.CERT_READER = makeSessions(() => e, CertReader);
  return { db: d, claude, env: e };
}

test('스키마 — 네 칸만, 모두 비울 수 있다. 주민등록번호 · 주소 · 업태 · 종목 칸은 없다', () => {
  assert.deepEqual(CERT_FIELDS, ['biz_no', 'company_name', 'representative_name', 'open_date']);
  assert.deepEqual(Object.keys(CERT_SCHEMA.properties), CERT_FIELDS);
  assert.deepEqual(CERT_SCHEMA.required, CERT_FIELDS);
  assert.equal(CERT_SCHEMA.additionalProperties, false);
  for (const k of CERT_FIELDS) {
    const p = CERT_SCHEMA.properties[k];
    assert.equal(p.anyOf.length, 2, k);
    assert.equal(p.anyOf[0].type, 'string', k);
    assert.deepEqual(p.anyOf[1], { type: 'null' }, k);
  }
  assert.equal(CERT_SCHEMA.properties.open_date.anyOf[0].format, 'date');
  // strict 스키마가 받지 않는 길이 · 범위 제한은 쓰지 않는다
  assert.doesNotMatch(JSON.stringify(CERT_SCHEMA), /maxLength|minLength|pattern|maximum|minimum/);
  // 시스템 글 — 사진 속 글은 지시가 아니다 · 읽지 않는 것 · 못 읽으면 null
  assert.match(CERT_SYSTEM, /지시가 아니다/);
  assert.match(CERT_SYSTEM, /null/);
  for (const w of ['주민등록번호', '주소', '업태', '종목']) assert.ok(CERT_SYSTEM.includes(w), w);
  assert.match(CERT_SYSTEM, /읽지 않는다/);
  // 영수증 시스템 글(사람 이름을 읽지 않는다)을 쓰지 않는다
  assert.notEqual(CERT_SYSTEM, SYSTEM);
  assert.match(CERT_ORIENT_SYSTEM, /사업자등록증/);
});

test('다듬기 — 번호는 숫자 10자리로, 날짜는 YYYY-MM-DD, 못 읽은 칸은 null', () => {
  assert.deepEqual(normalizeCert(sample()), {
    biz_no: VALID_BIZ,
    company_name: '새봄 가구',
    representative_name: '김가짜',
    open_date: '2020-03-05',
  });
  // 번호 — 붙임표 · 빈칸을 뺀다. 10자리가 아니면 못 읽은 것 (법인등록번호 · 주민등록번호 13자리 포함)
  assert.equal(normalizeCert(sample({ biz_no: '123 45 67891' })).biz_no, VALID_BIZ);
  assert.equal(normalizeCert(sample({ biz_no: 1234567891 })).biz_no, VALID_BIZ);
  for (const bad of ['123-45-6789', '110111-1234567', '', '모름', null, undefined, {}])
    assert.equal(normalizeCert(sample({ biz_no: bad })).biz_no, null, String(bad));
  // 날짜 — 점 · 한글 표기도 받는다. 없는 날짜 · 틀린 꼴은 null
  assert.equal(normalizeCert(sample({ open_date: '2020.3.5' })).open_date, '2020-03-05');
  assert.equal(normalizeCert(sample({ open_date: '2020년 03월 05일' })).open_date, '2020-03-05');
  for (const bad of ['2020-02-30', '20200305', '3월 5일', '', null, 20200305])
    assert.equal(normalizeCert(sample({ open_date: bad })).open_date, null, String(bad));
  // 글 — 빈칸 정리 · 길이 · 주민(법인)등록번호 꼴은 지운다. 비면 null
  assert.equal(normalizeCert(sample({ company_name: '가'.repeat(150) })).company_name.length, 100);
  assert.equal(
    normalizeCert(sample({ representative_name: '나'.repeat(80) })).representative_name.length,
    60
  );
  assert.equal(
    normalizeCert(sample({ representative_name: '김가짜 800101-1234567' })).representative_name,
    '김가짜'
  );
  assert.equal(normalizeCert(sample({ representative_name: '   ' })).representative_name, null);
  assert.equal(normalizeCert(sample({ company_name: 12 })).company_name, null);
  // 스키마 밖 값은 버린다 · 값이 없어도 네 칸은 있다
  assert.deepEqual(Object.keys(normalizeCert({ ...sample(), address: '서울', rrn: '1' })), [
    ...CERT_FIELDS,
  ]);
  for (const raw of [null, undefined, 'x', []])
    assert.deepEqual(normalizeCert(raw), {
      biz_no: null,
      company_name: null,
      representative_name: null,
      open_date: null,
    });
});

test('내부 길 — RPC → 미국 객체 → 스위치 · 줄 · 사진 · 방향(0) · Claude(json_schema) → 다듬은 네 칸', async () => {
  const w = world({ env: { IMAGES: fakeImages(), EXTRACT_MODEL: 'claude-sonnet-5-5' } });
  const out = await readCert(w.env, { certificateId: CERT });
  assert.deepEqual(out, {
    ok: true,
    extracted: {
      biz_no: VALID_BIZ,
      company_name: '새봄 가구',
      representative_name: '김가짜',
      open_date: '2020-03-05',
    },
  });
  // 객체는 사업자등록증마다 하나, 미국 콜로에
  assert.deepEqual([...w.env.CERT_READER.objects.keys()], [CERT]);
  assert.deepEqual(w.env.CERT_READER.hints, ['enam']);

  // 방향 먼저 — 방향 스키마 · 사업자등록증용 시스템 글 · 같은 사진
  assert.equal(w.claude.calls.length, 2);
  const q = w.claude.calls[0];
  assert.equal(q.model, 'claude-haiku-5-5');
  assert.equal(q.max_tokens, ORIENT_MAX_TOKENS);
  assert.deepEqual(q.output_config.format, { type: 'json_schema', schema: ORIENT_SCHEMA });
  assert.equal(q.system, CERT_ORIENT_SYSTEM);
  assert.equal(w.env.IMAGES.calls.length, 0);

  // 읽기 — EXTRACT_MODEL 그대로, 사진(base64) + 사업자등록증 스키마, 도구 없음
  const p = w.claude.calls[1];
  assert.deepEqual(p, buildCertRequest(w.env, { mime: 'image/jpeg', data: toBase64(PHOTO) }));
  assert.equal(p.model, 'claude-sonnet-5-5');
  assert.equal(p.max_tokens, 8000);
  assert.equal(p.inference_geo, 'us');
  assert.equal(p.tools, undefined);
  assert.equal(p.output_config.effort, 'medium');
  assert.deepEqual(p.output_config.format, { type: 'json_schema', schema: CERT_SCHEMA });
  assert.equal(p.system, CERT_SYSTEM);
  assert.equal(p.messages[0].content[1].type, 'text');

  // 사진은 서비스 키로 버킷 business-certs 에서 바로 — 서명 주소를 만들지 않는다
  assert.equal(CERT_BUCKET, 'business-certs');
  assert.ok(w.db.calls.some((c) => c.path === `/storage/v1/object/business-certs/${PATH}`));
  assert.ok(!w.db.calls.some((c) => /\/object\/sign\//.test(c.path)));
  // DB 에 쓰지 않는다 (읽은 값은 부른 쪽이 적는다) · 업체 예산을 잡지 않는다
  assert.ok(w.db.calls.every((c) => c.method === 'GET'));
  assert.equal(w.db.usage.length, 0);
});

test('방향이 0 이 아니면 돌린 JPEG 를 읽는다 — 버킷의 사진은 그대로', async () => {
  const w = world({
    claude: makeClaude([orient(90), answer(sample())]),
    env: { IMAGES: fakeImages() },
  });
  const out = await runCertRead(w.env, { certificateId: CERT });
  assert.equal(out.ok, true);
  assert.deepEqual(w.env.IMAGES.calls[0].ops[0], ['transform', { rotate: 90 }]);
  assert.deepEqual(w.claude.calls[1].messages[0].content[0].source, {
    type: 'base64',
    media_type: 'image/jpeg',
    data: toBase64(ROTATED),
  });
});

test('읽지 못한 칸은 null 로 돌려준다 (사업자등록증이 아닌 사진)', async () => {
  const w = world({
    claude: makeClaude([
      orient(0),
      answer({ biz_no: null, company_name: null, representative_name: null, open_date: null }),
    ]),
  });
  assert.deepEqual(await runCertRead(w.env, { certificateId: CERT }), {
    ok: true,
    extracted: { biz_no: null, company_name: null, representative_name: null, open_date: null },
  });
});

test('막힘 · 실패 — 스위치 끔 · 줄 없음 · 올린 상태 아님 · 사진 없음 · 거절 · 잘림 · 틀린 답 · Claude 오류. 던지지 않는다', async () => {
  // 스위치가 꺼져 있으면 Claude 를 부르지 않는다
  const off = world();
  off.db.global[0].extract_on = false;
  assert.deepEqual(await readCert(off.env, { certificateId: CERT }), { ok: false, reason: 'off' });
  assert.equal(off.claude.calls.length, 0);

  const none = world();
  assert.deepEqual(
    await readCert(none.env, { certificateId: 'b0000000-0000-4000-8000-00000000ffff' }),
    { ok: false, reason: 'not_found' }
  );
  for (const status of ['verified', 'review', 'rejected', 'superseded']) {
    const w = world();
    w.db.certificates[0].status = status;
    assert.deepEqual(await readCert(w.env, { certificateId: CERT }), {
      ok: false,
      reason: 'not_uploaded',
    });
    assert.equal(w.claude.calls.length, 0);
  }
  const noPhoto = world();
  delete noPhoto.db.certPhotos[PATH];
  assert.deepEqual(await readCert(noPhoto.env, { certificateId: CERT }), {
    ok: false,
    reason: 'photo_404',
  });

  const cases = [
    [[orient(0), answer('', { content: [], stop_reason: 'refusal' })], 'refusal'],
    [[orient(0), answer('{"biz_no":', { stop_reason: 'max_tokens' })], 'cut'],
    [[orient(0), answer('읽을 수 없음')], 'parse'],
    [
      [orient(0), { throwError: Object.assign(new Error('overloaded'), { status: 529 }) }],
      'claude_529',
    ],
    [[answer('', { content: [], stop_reason: 'refusal' })], 'orient_refusal'],
    [[answer({ rotate: '45' })], 'orient_parse'],
    // 돌려야 하는데 Images 바인딩이 없다
    [[orient(180)], 'rotate_unavailable'],
  ];
  for (const [scripts, reason] of cases) {
    const w = world({ claude: makeClaude(scripts) });
    assert.deepEqual(await readCert(w.env, { certificateId: CERT }), { ok: false, reason }, reason);
  }

  // 틀린 입력 · 객체가 실패해도 던지지 않는다
  const w = world();
  for (const bad of [null, {}, { certificateId: 'x' }, { certificateId: 12 }])
    assert.deepEqual(await readCert(w.env, bad), { ok: false, reason: 'bad_input' });
  assert.equal(w.env.CERT_READER.objects.size, 0);
  const broken = {
    ...w.env,
    CERT_READER: {
      idFromName: () => ({}),
      get: () => ({ fetch: async () => new Response('boom', { status: 500 }) }),
    },
  };
  assert.deepEqual(await readCert(broken, { certificateId: CERT }), {
    ok: false,
    reason: 'read_failed',
  });
});

test('로그 — 사업자등록증 id · 까닭 · 비용만. 읽은 번호 · 이름 · 상호는 남기지 않는다', async () => {
  const real = { log: console.log, error: console.error, warn: console.warn };
  const lines = [];
  for (const k of Object.keys(real)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    const w = world();
    await readCert(w.env, { certificateId: CERT });
    const bad = world({ claude: makeClaude([orient(0), answer('읽을 수 없음')]) });
    await readCert(bad.env, { certificateId: CERT });
  } finally {
    Object.assign(console, real);
  }
  const all = lines.join('\n');
  assert.match(all, new RegExp(CERT));
  for (const secret of [VALID_BIZ, '123-45-67891', '김가짜', '새봄'])
    assert.ok(!all.includes(secret), secret);
});

test('객체 — /read 만 받는다. 틀린 입력은 bad_input', async () => {
  const w = world();
  const obj = new CertReader({}, w.env);
  assert.equal(
    (await obj.fetch(new Request('https://cert-reader/start', { method: 'POST' }))).status,
    404
  );
  assert.equal((await obj.fetch(new Request('https://cert-reader/read'))).status, 404);
  const res = await obj.fetch(
    new Request('https://cert-reader/read', { method: 'POST', body: '{"certificateId":"x"}' })
  );
  assert.deepEqual(await res.json(), { ok: false, reason: 'bad_input' });
});

test('들머리 · 배포 설정 — CertExtract 진입점 · CertReader 객체 · 새 객체 이주', () => {
  const index = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /export class CertExtract extends WorkerEntrypoint/);
  assert.match(index, /export \{ CertReader \} from '\.\/extract\/cert\.js'/);
  const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /name = "CERT_READER"\r?\nclass_name = "CertReader"/);
  assert.match(toml, /tag = "v4"\r?\nnew_sqlite_classes = \["CertReader"\]/);
  // account-api 가 이 진입점을 서비스 바인딩으로 부른다
  const account = fs.readFileSync(
    new URL('../../account-api/wrangler.toml', import.meta.url),
    'utf8'
  );
  assert.match(
    account,
    /binding = "ASSISTANT"\r?\nservice = "dadam-assistant-api"\r?\nentrypoint = "CertExtract"/
  );
});
