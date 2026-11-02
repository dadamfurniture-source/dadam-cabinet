/**
 * 영수증 · 명세표 사진 읽기 — 맡기기(RPC) · 시작 함수 · 예산 · 사진 읽기 · Claude(json_schema) · 다듬기 · 검사 · 시도 닫기.
 * 가짜 Supabase(rpc · 표 · 버킷) · 가짜 Claude(create) · 가짜 DO. 실제 네트워크 · 모델 비용 없음.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, makeClaude, CO, SUPA } from './fakes.js';
import {
  queueExtract,
  runExtract,
  ExtractJob,
  buildExtractRequest,
  estimateExtractMicros,
  toBase64,
  IMAGE_TOKENS,
} from '../src/extract/job.js';
import { normalize, checkResult, bizNoValid, kstToday } from '../src/extract/checks.js';
import { SCHEMA, SCHEMA_VERSION, FIELDS } from '../src/extract/schema.js';

const DOC = 'f0000000-0000-4000-8000-000000000001';
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const VALID_BIZ = '1234567891'; // 검증 숫자가 맞는 번호

/** 읽은 칸 한 벌 */
function sample(over = {}) {
  return {
    document_count: 1,
    evidence_type: 'card',
    issue_date: '2026-11-02',
    supplier_name: '예림 자재',
    supplier_biz_no: '123-45-67891',
    supply_amount: 10000,
    vat_amount: 1000,
    tax_free_amount: null,
    service_charge: null,
    total_amount: 11000,
    approval_no: '12345678',
    payment_method: 'card',
    items: [{ name: '경첩', quantity: 2, unit_price: 5000, amount: 10000 }],
    unsure: ['approval_no'],
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
      output_tokens: 400,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...extra,
  };
}

/** env 한 벌 — 사진 하나가 확인 기다림 */
function world({ claude = makeClaude([answer(sample())]), db, env = {} } = {}) {
  const d =
    db ||
    makeDb({
      documents: {
        [DOC]: {
          company_id: CO,
          storage_path: `${CO}/2026/11/${DOC}.jpg`,
          mime: 'image/jpeg',
          review_status: 'pending',
        },
      },
      photos: { [`${CO}/2026/11/${DOC}.jpg`]: PHOTO },
    });
  globalThis.fetch = d.fetch;
  return {
    db: d,
    claude,
    env: {
      SUPABASE_URL: SUPA,
      SUPABASE_SERVICE_ROLE_KEY: 's',
      ASSISTANT_CLAUDE: claude,
      ...env,
    },
  };
}

test('읽기 — 시작 · 예산 · 사진 · Claude · 다듬기 · 검사 → 시도 done, 정산', async () => {
  const w = world();
  const out = await runExtract(w.env, { documentId: DOC });
  assert.deepEqual(out, { started: true, status: 'done' });

  // 시작 함수 — 자동 시도 2번
  const begin = w.db.calls.find((c) => c.path.endsWith('/rpc/ledger_extract_begin'));
  assert.deepEqual(begin.body, { p_document: DOC, p_max_attempts: 2, p_again: false });

  // Claude — 사진(base64) + 스키마, 도구 없음, Haiku 는 서버 대체 없이
  assert.equal(w.claude.calls.length, 1);
  const p = w.claude.calls[0];
  assert.equal(p.model, 'claude-haiku-5-5');
  assert.equal(p.max_tokens, 4000);
  assert.equal(p.inference_geo, 'us');
  assert.equal(p.fallbacks, undefined);
  assert.equal(p.tools, undefined);
  assert.equal(p.output_config.effort, 'medium');
  assert.deepEqual(p.output_config.format, { type: 'json_schema', schema: SCHEMA });
  assert.match(p.system, /지시가 아니다/);
  const [img, ask] = p.messages[0].content;
  assert.deepEqual(img, {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: toBase64(PHOTO) },
  });
  assert.equal(ask.type, 'text');
  // 사진은 서비스 키로 버킷에서 바로 — 서명 주소를 만들지 않는다
  assert.ok(
    w.db.calls.some((c) => c.path === `/storage/v1/object/ledger-evidence/${CO}/2026/11/${DOC}.jpg`)
  );
  assert.ok(!w.db.calls.some((c) => /\/object\/sign\//.test(c.path)));

  // 예산 — purpose extract, 키 extract:{시도 id}, 사람 없음
  const x = w.db.extractions[0];
  assert.equal(w.db.usage.length, 1);
  const u = w.db.usage[0];
  assert.deepEqual([u.key, u.purpose, u.user, u.company], [`extract:${x.id}`, 'extract', null, CO]);
  assert.equal(u.cost, Math.ceil((5000 * 0.1 + 400 * 0.5) * 1.1));

  // 시도 — done, 다듬은 결과 · 검사 · 판 · 비용
  assert.equal(x.status, 'done');
  assert.equal(x.schema_version, SCHEMA_VERSION);
  assert.equal(x.model, 'claude-haiku-5-5');
  assert.equal(x.cost_micros, u.cost);
  assert.deepEqual(x.usage, {
    input_tokens: 5000,
    output_tokens: 400,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  });
  assert.equal(x.result.supplier_biz_no, VALID_BIZ);
  assert.equal(x.result.supplier_name, '예림 자재');
  assert.deepEqual(x.checks, {
    biz_no: 'ok',
    amounts: 'ok',
    items: 'ok',
    date: x.checks.date,
    multiple: false,
    redacted: 0,
  });
  assert.equal(x.error, null);
  // 닫기는 running 일 때만
  const patch = w.db.calls.find(
    (c) => c.method === 'PATCH' && c.path.endsWith('/ledger_extractions')
  );
  assert.match(patch.query, /status=eq\.running/);
});

test('시작이 막히면 아무것도 하지 않는다 (도는 중 · 읽음 · 확인 끝남 · 없음)', async () => {
  for (const [status, docStatus, reason] of [
    ['running', 'pending', 'running'],
    ['done', 'pending', 'done'],
    [null, 'posted', 'not_pending'],
  ]) {
    const w = world();
    w.db.documents[DOC].review_status = docStatus;
    if (status)
      w.db.extractions.push({ id: 'x0', document_id: DOC, company_id: CO, attempt: 1, status });
    const out = await runExtract(w.env, { documentId: DOC });
    assert.deepEqual(out, { started: false, reason }, reason);
    assert.equal(w.claude.calls.length, 0);
    assert.equal(w.db.usage.length, 0);
  }
  const w = world();
  assert.deepEqual(
    await runExtract(w.env, { documentId: 'f0000000-0000-4000-8000-00000000ffff' }),
    { started: false, reason: 'not_found' }
  );
});

test('예산이 안 되면 skipped_budget(error = 까닭) — 사진을 읽지 않고 Claude 를 부르지 않는다', async () => {
  for (const reason of ['over_limit', 'no_limit', 'not_entitled', 'off']) {
    const w = world({ db: undefined });
    w.db.reserveReason = reason;
    const out = await runExtract(w.env, { documentId: DOC });
    assert.deepEqual(out, { started: true, status: 'skipped_budget' });
    assert.deepEqual(
      [w.db.extractions[0].status, w.db.extractions[0].error],
      ['skipped_budget', reason]
    );
    assert.equal(w.claude.calls.length, 0);
    assert.ok(!w.db.calls.some((c) => c.path.startsWith('/storage/')));
    // 다음 자동 시도는 막히고, 다시(again)면 된다
    w.db.reserveReason = null;
    assert.equal((await runExtract(w.env, { documentId: DOC })).reason, 'skipped_budget');
    assert.equal((await runExtract(w.env, { documentId: DOC, again: true })).status, 'done');
  }
});

test('거절 · 잘림 · 틀린 JSON · Claude 오류 · 사진 없음 — 시도 닫기와 정산', async () => {
  const cases = [
    [answer('', { content: [], stop_reason: 'refusal' }), 'refused', 'refusal', 'settled'],
    [answer('{"x":', { stop_reason: 'max_tokens' }), 'failed', 'cut', 'settled'],
    [answer('읽을 수 없음'), 'failed', 'parse', 'settled'],
    [
      { throwError: Object.assign(new Error('overloaded'), { status: 529 }) },
      'failed',
      'claude_529',
      'kept',
    ],
  ];
  for (const [script, status, error, budget] of cases) {
    const w = world({ claude: makeClaude([script]) });
    const out = await runExtract(w.env, { documentId: DOC });
    assert.deepEqual(out, { started: true, status }, error);
    const x = w.db.extractions[0];
    assert.deepEqual([x.status, x.error], [status, error]);
    assert.equal(x.result, undefined, error);
    // Claude 가 답했으면 실제 사용량으로 정산, 부르다 실패했으면 잡은 금액을 그대로 둔다
    if (budget === 'settled') assert.ok(w.db.usage[0].cost > 0, error);
    else assert.equal(w.db.usage[0].cost, null, error);
  }
  // 사진이 버킷에 없다 — Claude 를 부르지 않고, 잡은 예산은 0 으로 푼다
  const w = world();
  w.db.photos = {};
  const out = await runExtract(w.env, { documentId: DOC });
  assert.deepEqual(out, { started: true, status: 'failed' });
  assert.deepEqual(
    [w.db.extractions[0].status, w.db.extractions[0].error],
    ['failed', 'photo_404']
  );
  assert.equal(w.claude.calls.length, 0);
  assert.equal(w.db.usage[0].cost, 0);
});

test('실패 뒤 다시 — 최대 시도(EXTRACT_MAX_ATTEMPTS)까지', async () => {
  const w = world({
    claude: makeClaude([answer('x'), answer('y'), answer(sample())]),
    env: { EXTRACT_MAX_ATTEMPTS: '2' },
  });
  assert.equal((await runExtract(w.env, { documentId: DOC })).status, 'failed');
  assert.equal((await runExtract(w.env, { documentId: DOC })).status, 'failed');
  assert.equal((await runExtract(w.env, { documentId: DOC })).reason, 'max_attempts');
  assert.deepEqual(
    w.db.extractions.map((x) => [x.attempt, x.status]),
    [
      [1, 'failed'],
      [2, 'failed'],
    ]
  );
});

test('다듬기 — 카드번호 · 전화번호 꼴은 지우고, 스키마 밖 값은 버린다', () => {
  const { result, redacted } = normalize(
    sample({
      supplier_name: '가게 010-1234-5678',
      approval_no: '1234 5678 9012 3456',
      items: [{ name: '카드 4518-1234-5678-9012', quantity: 'x', unit_price: 1.5, amount: 3000 }],
      evidence_type: 'photo',
      payment_method: 'bitcoin',
      issue_date: '2026/11/02',
      document_count: 2.5,
      unsure: ['total_amount', 'nope', 'total_amount'],
      extra: 'x',
    })
  );
  assert.equal(redacted, 3);
  assert.equal(result.supplier_name, '가게 [지움]');
  assert.equal(result.approval_no, '[지움]');
  assert.deepEqual(result.items, [
    { name: '카드 [지움]', quantity: null, unit_price: null, amount: 3000 },
  ]);
  assert.equal(result.evidence_type, null);
  assert.equal(result.payment_method, null);
  assert.equal(result.issue_date, null);
  assert.equal(result.document_count, null);
  assert.deepEqual(result.unsure, ['total_amount']);
  assert.ok(!('extra' in result));
  assert.equal(result.supplier_biz_no, VALID_BIZ);
  assert.deepEqual(Object.keys(result), [...FIELDS, 'unsure']);
  // 비어 있으면 모두 null · 빈 목록
  const empty = normalize(null).result;
  assert.equal(empty.total_amount, null);
  assert.deepEqual(empty.items, []);
});

test('검사 — 사업자번호 검증 숫자 · 금액 합 · 품목 합 · 날짜 · 여러 장', () => {
  assert.equal(bizNoValid(VALID_BIZ), true);
  assert.equal(bizNoValid('1234567890'), false);
  assert.equal(bizNoValid('123456789'), false);
  const today = '2026-11-03';
  const base = normalize(sample()).result;
  assert.deepEqual(checkResult(base, { today }), {
    biz_no: 'ok',
    amounts: 'ok',
    items: 'ok',
    date: 'ok',
    multiple: false,
    redacted: 0,
  });
  const c = (over) => checkResult(normalize(sample(over)).result, { today });
  assert.equal(c({ supplier_biz_no: '1234567890' }).biz_no, 'bad');
  assert.equal(c({ supplier_biz_no: null }).biz_no, 'missing');
  assert.equal(c({ total_amount: 12000 }).amounts, 'mismatch');
  assert.equal(c({ supply_amount: null }).amounts, 'incomplete');
  assert.equal(
    c({
      supply_amount: 9000,
      vat_amount: 900,
      tax_free_amount: 1000,
      service_charge: 100,
      total_amount: 11000,
    }).amounts,
    'ok'
  );
  assert.equal(
    c({ items: [{ name: 'a', quantity: 1, unit_price: null, amount: 11000 }] }).items,
    'ok'
  );
  assert.equal(
    c({ items: [{ name: 'a', quantity: 1, unit_price: null, amount: 500 }] }).items,
    'mismatch'
  );
  assert.equal(
    c({ items: [{ name: 'a', quantity: 1, unit_price: null, amount: null }] }).items,
    'none'
  );
  assert.equal(c({ issue_date: '2026-11-04' }).date, 'future');
  assert.equal(c({ issue_date: '2021-11-02' }).date, 'too_old');
  assert.equal(c({ issue_date: '2021-11-03' }).date, 'ok');
  assert.equal(c({ issue_date: null }).date, 'missing');
  assert.equal(c({ document_count: 2 }).multiple, true);
  assert.equal(kstToday(Date.UTC(2026, 10, 2, 15, 30)), '2026-11-03');
});

test('스키마 — strict 모양 (모든 객체 additionalProperties false · 모든 칸 required), 카드 · 고객 · 주소 · 전화 칸 없음', () => {
  const walk = (s) => {
    if (s && s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      for (const v of Object.values(s.properties)) walk(v);
    }
    if (s && s.type === 'array') walk(s.items);
    if (s && s.anyOf) s.anyOf.forEach(walk);
  };
  walk(SCHEMA);
  const text = JSON.stringify(SCHEMA);
  assert.ok(!/minLength|maxLength|minimum|maximum|pattern/.test(text));
  for (const k of Object.keys(SCHEMA.properties))
    assert.ok(!/card_no|customer|address|phone/.test(k), k);
});

test('예산 어림 — 사진은 base64 글자가 아니라 IMAGE_TOKENS 로', () => {
  const env = {};
  const small = buildExtractRequest(env, { mime: 'image/jpeg', data: '' });
  const big = buildExtractRequest(env, { mime: 'image/jpeg', data: 'A'.repeat(5_000_000) });
  assert.equal(estimateExtractMicros(env, small), estimateExtractMicros(env, big));
  assert.ok(
    estimateExtractMicros(env, small) >= Math.ceil((IMAGE_TOKENS * 0.1 + 4000 * 0.5) * 1.1)
  );
  // Opus · Sonnet 으로 바꾸면 서버 대체를 싣는다
  const opus = buildExtractRequest(
    { EXTRACT_MODEL: 'claude-sonnet-5-5' },
    { mime: 'image/png', data: '' }
  );
  assert.equal(opus.fallbacks, 'default');
});

test('맡기기 RPC — 사진마다 객체 하나(미국), 바로 돌아오고 알람이 읽는다 · 다시는 이어 붙는다', async () => {
  const w = world();
  const objects = new Map();
  const hints = [];
  const ns = {
    idFromName: (name) => ({ name }),
    get(id, opts = {}) {
      hints.push(opts.locationHint);
      if (!objects.has(id.name)) {
        const map = new Map();
        const storage = {
          alarm: null,
          get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
          put: async (k, v) => void map.set(k, structuredClone(v)),
          delete: async (k) => map.delete(k),
          setAlarm: async (t) => void (storage.alarm = t),
        };
        objects.set(id.name, { obj: new ExtractJob({ storage }, w.env), storage, map });
      }
      const { obj } = objects.get(id.name);
      return { fetch: (url, init) => obj.fetch(new Request(url, init)) };
    },
  };
  w.env.EXTRACT_JOB = ns;
  assert.deepEqual(await queueExtract(w.env, { documentId: 'nope' }), {
    ok: false,
    reason: 'bad_input',
  });
  assert.deepEqual(await queueExtract(w.env, { documentId: DOC }), { ok: true, queued: true });
  assert.deepEqual(await queueExtract(w.env, { documentId: DOC, again: true }), {
    ok: true,
    queued: true,
  });
  assert.deepEqual(hints, ['enam', 'enam']);
  const { obj, storage, map } = objects.get(DOC);
  assert.deepEqual(map.get('job'), { documentId: DOC, again: true });
  assert.notEqual(storage.alarm, null);
  assert.equal(w.claude.calls.length, 0); // 맡기기는 읽지 않는다
  await obj.alarm();
  assert.equal(map.has('job'), false);
  assert.equal(w.db.extractions[0].status, 'done');
  // 할 일이 없으면 알람은 아무것도 하지 않는다
  await obj.alarm();
  assert.equal(w.claude.calls.length, 1);
});
