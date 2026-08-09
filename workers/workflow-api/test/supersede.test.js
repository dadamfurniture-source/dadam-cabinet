/**
 * 재발행 시 구 리비전 대체 처리.
 *
 * 루프 실주행에서 잡힌 결함: supersede 가 `body.supersedes` 를 보낼 때만 돌았는데
 * 어떤 화면도 그 필드를 보내지 않았다. 그래서 확인서를 재발행해도
 * **구 공유 링크가 계속 살아 있었다** — 고객이 옛 금액의 확인서를 그대로 열 수 있다.
 * share.js 의 superseded → 410 분기도 도달 불가능한 죽은 코드였다.
 *
 * 상태 규칙이 핵심이다: 고객이 결정한 문서는 상태를 보존해야 한다.
 * 'superseded' 로 덮으면 "승인했다"·"수정 요청했다" 는 사실이 사라진다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supersedePriorRevisions } from '../src/documents.js';

/** updateBy 호출을 가로채는 가짜 env — 필터와 패치를 그대로 기록한다 */
function fakeEnv() {
  const calls = [];
  return {
    calls,
    env: {
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      // restRequest 가 쓰는 fetch 를 가로챈다
      _fetch: null,
    },
  };
}

// supabase.js 의 updateBy 는 fetch 를 쓴다 — 전역 fetch 를 잠시 가로챈다
function withCapturedFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => [{ id: 'x' }],
      text: async () => '[]',
    };
  };
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original;
  });
}

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const ARGS = { designId: 'D1', docType: 'customer_confirmation', newDocId: 'NEW', newRev: 3 };

test('같은 설계·같은 종류의 이전 리비전만 대상으로 한다', async () => {
  await withCapturedFetch(async (calls) => {
    await supersedePriorRevisions(ENV, ARGS);
    assert.equal(calls.length, 2, '결정된 문서 / 결정 없는 문서 두 번');
    for (const c of calls) {
      assert.match(c.url, /design_id=eq\.D1/);
      assert.match(c.url, /doc_type=eq\.customer_confirmation/);
      assert.match(c.url, /rev=lt\.3/, '새 리비전보다 낮은 것만');
      assert.match(c.url, /superseded_by=is\.null/, '이미 대체된 것은 건드리지 않는다');
      assert.equal(c.method, 'PATCH');
    }
  });
});

test('고객이 결정한 문서는 상태를 보존한다', async () => {
  await withCapturedFetch(async (calls) => {
    await supersedePriorRevisions(ENV, ARGS);
    const decided = calls.find((c) => /decision=not\.is\.null/.test(c.url));
    assert.ok(decided, '결정된 문서용 호출이 있어야 한다');
    assert.deepEqual(decided.body, { superseded_by: 'NEW' });
    assert.ok(!('status' in decided.body), '승인·반려 기록을 덮으면 안 된다');
  });
});

test('결정이 없는 문서만 superseded 로 바꿔 링크를 닫는다', async () => {
  await withCapturedFetch(async (calls) => {
    await supersedePriorRevisions(ENV, ARGS);
    const undecided = calls.find((c) => /decision=is\.null/.test(c.url));
    assert.ok(undecided);
    assert.equal(undecided.body.status, 'superseded');
    assert.equal(undecided.body.superseded_by, 'NEW');
  });
});

test('대체한 건수를 정확히 돌려준다', async () => {
  await withCapturedFetch(async () => {
    const n = await supersedePriorRevisions(ENV, ARGS);
    assert.equal(n.total, 2, '가짜 응답이 각 1행이므로 합 2');
  });
});

test('링크가 실제로 닫힌 수를 따로 센다', async () => {
  // 고객이 승인·반려한 문서는 상태를 보존하므로 링크가 계속 열린다.
  // 둘을 뭉뚱그리면 "옛 링크가 닫혔다" 는 잘못된 안내를 하게 된다.
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    // 1번째 = 결정된 문서 2건(링크 유지), 2번째 = 미결정 1건(링크 닫힘)
    const rows = call === 1 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }];
    return { ok: true, status: 200, headers: { get: () => 'application/json' },
             json: async () => rows, text: async () => JSON.stringify(rows) };
  };
  try {
    const n = await supersedePriorRevisions(ENV, ARGS);
    assert.equal(n.total, 3, '대체된 문서는 3건');
    assert.equal(n.closed, 1, '그중 링크가 닫힌 것은 1건뿐');
  } finally { globalThis.fetch = original; }
});

test('행을 못 받으면 0 이 아니라 null — 0 은 "대체 없음" 으로 읽힌다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 204,               // PostgREST 가 본문을 안 돌려주는 경우
    headers: { get: () => null },
    json: async () => null, text: async () => '',
  });
  try {
    const n = await supersedePriorRevisions(ENV, ARGS);
    assert.equal(n.total, null, '셀 수 없으면 0 으로 속이면 안 된다');
    assert.equal(n.closed, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('갱신된 행 수만큼 정확히 센다', async () => {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    const rows = call === 1 ? [{ id: 'a' }] : [{ id: 'b' }, { id: 'c' }, { id: 'd' }];
    return {
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => rows, text: async () => JSON.stringify(rows),
    };
  };
  try {
    const n = await supersedePriorRevisions(ENV, ARGS);
    assert.equal(n.total, 4, '1 + 3');
    assert.equal(n.closed, 3, '미결정 3건만 링크가 닫힌다');
  } finally {
    globalThis.fetch = original;
  }
});

test('representation 을 요청해 행을 받아온다', async () => {
  await withCapturedFetch(async () => {
    const original = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url, init) => {
      seen.push(init.headers.Prefer || '');
      return { ok: true, status: 200, headers: { get: () => 'application/json' },
               json: async () => [], text: async () => '[]' };
    };
    try {
      await supersedePriorRevisions(ENV, ARGS);
      for (const p of seen) assert.match(p, /return=representation/);
    } finally { globalThis.fetch = original; }
  });
});

test('작업지시서도 같은 규칙으로 대체된다', async () => {
  await withCapturedFetch(async (calls) => {
    await supersedePriorRevisions(ENV, { ...ARGS, docType: 'installation_order' });
    for (const c of calls) assert.match(c.url, /doc_type=eq\.installation_order/);
  });
});

test('첫 발행(rev 1)이면 대상이 없다 — rev < 1 은 존재할 수 없다', async () => {
  await withCapturedFetch(async (calls) => {
    await supersedePriorRevisions(ENV, { ...ARGS, newRev: 1 });
    for (const c of calls) assert.match(c.url, /rev=lt\.1/);
  });
});
