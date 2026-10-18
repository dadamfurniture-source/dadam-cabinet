/**
 * 설치 후 한 문항 — 경영 대시보드 2단계 PR-7 (12 만족도 · 소개율).
 *
 * "지인에게 다담가구를 소개하시겠어요?" 0~10. 링크는 확인서 공유와 같은 방식 — 토큰은 fragment,
 * DB 에는 해시만. 수주 하나에 하나, 답을 받으면 다시 만들 수 없고, 두 번 눌러도 한 번만 남는다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  feedbackStatus, validateAnswer, buildFeedbackUrl, hashFeedbackToken,
  getFeedback, createFeedbackLink, openFeedback, answerFeedback, FEEDBACK_QUESTION,
} from '../src/feedback.js';
import { referralOf, buildManagementSummary } from '../src/management/summary.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SHARE_TOKEN_PEPPER: 'p', PUBLIC_BASE_URL: 'https://dadamfurniture.com/' };
const json = (rows, status = 200) => ({
  ok: true, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows),
});
const fail = (status, body) => ({
  ok: false, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
const NO_TABLE = () => fail(404, { code: 'PGRST205', message: "Could not find the table 'public.install_feedback' in the schema cache" });

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    const res = route(u, init.method || 'GET', calls.at(-1).body);
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}
const owned = (u, method) => {
  if (method === 'GET' && u.includes('/orders?')) return json([{ id: 'O1', design_id: 'D1' }]);
  if (method === 'GET' && u.includes('/designs?')) return json([{ id: 'D1', user_id: 'U1' }]);
  return null;
};
const FUTURE = '2099-01-01T00:00:00Z';
const PAST = '2020-01-01T00:00:00Z';

test('링크: fragment(#t=) 로 — 서버 · 미리보기 로그에 토큰이 남지 않게', () => {
  assert.equal(buildFeedbackUrl(ENV, 'abc'), 'https://dadamfurniture.com/feedback.html#t=abc');
});

test('토큰 해시는 확인서 공유 해시와 섞이지 않는다 (용도 이름이 다르다)', async () => {
  const { hashShareToken } = await import('../src/share.js');
  assert.notEqual(await hashFeedbackToken(ENV, 'abc'), await hashShareToken(ENV, 'abc'));
});

test('답: 0~10 정수 하나, 한 줄은 다듬어 1,000자까지', () => {
  assert.deepEqual(validateAnswer({ score: '9', comment: '  깔끔해요 ' }), { score: 9, comment: '깔끔해요' });
  assert.deepEqual(validateAnswer({ score: 0 }), { score: 0, comment: null });
  assert.throws(() => validateAnswer({ score: 11 }), /0부터 10/);
  assert.throws(() => validateAnswer({ score: 7.5 }), /0부터 10/);
  assert.throws(() => validateAnswer({}), /0부터 10/);
});

test('수주 화면 상태: 없음 · 기다림 · 기간 지남 · 받음', () => {
  assert.deepEqual(feedbackStatus(null), { exists: false });
  const now = Date.parse('2026-10-19T00:00:00Z');
  assert.equal(feedbackStatus({ expires_at: FUTURE }, now).expired, false);
  assert.equal(feedbackStatus({ expires_at: PAST }, now).expired, true);
  const done = feedbackStatus({ expires_at: PAST, answered_at: '2026-10-10T00:00:00Z', score: 10, comment: '좋아요' }, now);
  assert.equal(done.answered, true);
  assert.equal(done.expired, false); // 답을 받았으면 기간은 상관없다
  assert.equal(done.score, 10);
});

test('수주 상세: 표가 아직 없으면 null — 화면이 SQL 안내를 띄운다', async () => {
  await withFetch((u) => (u.includes('/install_feedback?') ? NO_TABLE() : null), async () => {
    assert.equal(await getFeedback(ENV, 'O1'), null);
  });
});

test('링크 만들기: 처음이면 넣고, 답 전이면 토큰만 바꾸고(옛 링크는 죽는다), 답 뒤에는 막는다', async () => {
  await withFetch((u, method, body) => owned(u, method)
    || (method === 'GET' && u.includes('/install_feedback?') ? json([]) : null)
    || (method === 'POST' && u.endsWith('/install_feedback') ? json([{ id: 'F1', ...body }], 201) : null), async (calls) => {
    const out = await createFeedbackLink(ENV, { orderId: 'O1', user: { id: 'U1' } });
    assert.match(out.url, /^https:\/\/dadamfurniture\.com\/feedback\.html#t=[A-Za-z0-9_-]{43}$/);
    const post = calls.find((c) => c.method === 'POST');
    const token = out.url.split('#t=')[1];
    assert.equal(post.body.token_hash, await hashFeedbackToken(ENV, token)); // 평문은 저장하지 않는다
    assert.equal(post.body.order_id, 'O1');
    assert.ok(!JSON.stringify(post.body).includes(token));
  });
  await withFetch((u, method, body) => owned(u, method)
    || (method === 'GET' && u.includes('/install_feedback?') ? json([{ id: 'F1', answered_at: null }]) : null)
    || (method === 'PATCH' && u.includes('/install_feedback?id=eq.F1') ? json([{ id: 'F1', ...body }]) : null), async (calls) => {
    await createFeedbackLink(ENV, { orderId: 'O1', user: { id: 'U1' } });
    assert.ok(calls.some((c) => c.method === 'PATCH'));
    assert.ok(!calls.some((c) => c.method === 'POST'));
  });
  await withFetch((u, method) => owned(u, method) || (method === 'GET' && u.includes('/install_feedback?') ? json([{ id: 'F1', answered_at: '2026-10-10T00:00:00Z' }]) : null), async () => {
    await assert.rejects(createFeedbackLink(ENV, { orderId: 'O1', user: { id: 'U1' } }), /이미 답을 받았습니다/);
  });
  await withFetch((u, method) => owned(u, method) || (u.includes('/install_feedback?') ? NO_TABLE() : null), async () => {
    await assert.rejects(createFeedbackLink(ENV, { orderId: 'O1', user: { id: 'U1' } }), /management-phase2\.sql/);
  });
});

test('고객이 열 때: 질문만 준다 · 받은 뒤엔 답했다고 · 기간 지나면 410 · 모르는 링크는 404', async () => {
  const route = (row) => (u) => (u.includes('/install_feedback?') ? json(row ? [row] : []) : null);
  await withFetch(route({ id: 'F1', expires_at: FUTURE }), async () => {
    assert.deepEqual(await openFeedback(ENV, { token: 't' }), { question: FEEDBACK_QUESTION, answered: false });
  });
  await withFetch(route({ id: 'F1', expires_at: PAST, answered_at: '2026-10-10T00:00:00Z', score: 8 }), async () => {
    assert.deepEqual(await openFeedback(ENV, { token: 't' }), { question: FEEDBACK_QUESTION, answered: true, score: 8 });
  });
  await withFetch(route({ id: 'F1', expires_at: PAST }), async () => {
    await assert.rejects(openFeedback(ENV, { token: 't' }), (e) => e.constructor.name === 'GoneError');
  });
  await withFetch(route(null), async () => {
    await assert.rejects(openFeedback(ENV, { token: 't' }), /쓸 수 없는 링크/);
  });
  await assert.rejects(openFeedback(ENV, { token: '' }), /올바르지 않습니다/);
});

test('답 남기기: 답이 없는 행에만 쓴다 — 두 번 눌러도 한 번만', async () => {
  await withFetch((u, method, body) => (method === 'GET' ? json([{ id: 'F1', expires_at: FUTURE }]) : method === 'PATCH' ? json([{ id: 'F1', ...body }]) : null), async (calls) => {
    assert.deepEqual(await answerFeedback(ENV, { token: 't', body: { score: 10, comment: '최고' } }), { answered: true, score: 10 });
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.match(patch.url, /answered_at=is\.null/);
    assert.equal(patch.body.score, 10);
    assert.equal(patch.body.comment, '최고');
  });
  // 동시에 두 번 — 먼저 쓴 쪽이 이기고 나중 쪽은 0행
  await withFetch((u, method) => (method === 'GET' ? json([{ id: 'F1', expires_at: FUTURE }]) : method === 'PATCH' ? json([]) : null), async () => {
    await assert.rejects(answerFeedback(ENV, { token: 't', body: { score: 3 } }), /이미 답해 주셨습니다/);
  });
  await withFetch((u, method) => (method === 'GET' ? json([{ id: 'F1', expires_at: PAST }]) : null), async () => {
    await assert.rejects(answerFeedback(ENV, { token: 't', body: { score: 3 } }), /기간이 지났습니다/);
  });
});

// ── 소개율 · NPS ──
const FEEDBACK = [
  { score: 10, created_at: '2026-09-01T01:00:00Z', answered_at: '2026-09-02T01:00:00Z' },
  { score: 9, created_at: '2026-09-20T01:00:00Z', answered_at: '2026-10-03T01:00:00Z' },
  { score: 8, created_at: '2026-10-01T01:00:00Z', answered_at: '2026-10-05T01:00:00Z' },
  { score: 6, created_at: '2026-10-02T01:00:00Z', answered_at: '2026-10-08T01:00:00Z' },
  { score: null, created_at: '2026-10-10T01:00:00Z', answered_at: null }, // 아직 답 없음
  { score: 10, created_at: '2026-01-05T01:00:00Z', answered_at: '2026-01-06T01:00:00Z' }, // 반년 창 밖
];

test('소개율: 반년 창 — 답 4 (소개함 2 · 중립 1 · 안 함 1), NPS +25, 평균 8.3, 응답률 80%, 이달 3', () => {
  assert.deepEqual(referralOf(FEEDBACK, '2026-10'), {
    window: { days: 180, start: '2026-05-05', end: '2026-10-31' },
    sent: 5,
    answered: 4,
    responseRate: 80,
    promoters: 2,
    passives: 1,
    detractors: 1,
    nps: 25,
    avg: 8.3,
    thisMonth: 3,
    dist: [0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1],
  });
});

test('소개율: 표가 없으면 null, 답이 없으면 NPS 도 null', () => {
  assert.equal(referralOf(null, '2026-10'), null);
  const r = referralOf([{ score: null, created_at: '2026-10-10T01:00:00Z', answered_at: null }], '2026-10');
  assert.equal(r.nps, null);
  assert.equal(r.avg, null);
  assert.equal(r.responseRate, 0);
  const s = buildManagementSummary({ orders: [], snapshotsById: new Map(), documents: [], consultations: [], settings: {}, month: '2026-10' });
  assert.equal(s.referral, null);
});
