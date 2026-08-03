import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateScheduleItems, SCHEDULE_TYPES } from '../src/schedules.js';
import { buildScheduleBlocks, postToWebhook, formatKst } from '../src/slack.js';
import { ValidationError } from '../src/supabase.js';

function items(overrides = []) {
  const base = [
    { type: 'measurement', scheduled_at: '2026-08-12T00:00:00.000Z', assignee_name: '김OO', location: '서울시 강남구' },
    { type: 'installation', scheduled_at: '2026-08-20T01:30:00.000Z' },
  ];
  return overrides.length ? overrides : base;
}

// ── 검증 ──────────────────────────────────────────────────────────

test('정상 일정 통과', () => {
  assert.doesNotThrow(() => validateScheduleItems(items()));
});

test('빈 배열은 422', () => {
  assert.throws(() => validateScheduleItems([]), ValidationError);
  assert.throws(() => validateScheduleItems(null), ValidationError);
});

test('알 수 없는 type 은 422', () => {
  assert.throws(
    () => validateScheduleItems([{ type: 'lunch', scheduled_at: '2026-08-12T00:00:00Z' }]),
    ValidationError,
  );
});

test('8종 일정 타입을 모두 받는다', () => {
  const all = SCHEDULE_TYPES.map((t) => ({ type: t, scheduled_at: '2026-08-12T00:00:00Z' }));
  assert.equal(all.length, 8);
  assert.doesNotThrow(() => validateScheduleItems(all));
});

test('잘못된 날짜는 422', () => {
  assert.throws(
    () => validateScheduleItems([{ type: 'measurement', scheduled_at: 'not-a-date' }]),
    ValidationError,
  );
  assert.throws(() => validateScheduleItems([{ type: 'measurement' }]), ValidationError);
});

test('duration_min 은 양수여야 한다', () => {
  assert.throws(
    () => validateScheduleItems([{ type: 'measurement', scheduled_at: '2026-08-12T00:00:00Z', duration_min: 0 }]),
    ValidationError,
  );
});

test('한 번에 50건을 넘기면 422', () => {
  const many = Array.from({ length: 51 }, () => ({
    type: 'measurement',
    scheduled_at: '2026-08-12T00:00:00Z',
  }));
  assert.throws(() => validateScheduleItems(many), ValidationError);
});

test('잘못된 항목의 인덱스를 details 로 알려준다', () => {
  try {
    validateScheduleItems([
      { type: 'measurement', scheduled_at: '2026-08-12T00:00:00Z' },
      { type: 'nope', scheduled_at: '2026-08-12T00:00:00Z' },
    ]);
    assert.fail('던져야 한다');
  } catch (e) {
    assert.ok(e instanceof ValidationError);
    assert.equal(e.details[0].index, 1);
  }
});

// ── 시각 포맷 ─────────────────────────────────────────────────────

test('KST 로 표시한다', () => {
  // 2026-08-12T00:00:00Z = KST 09:00, 수요일
  assert.equal(formatKst('2026-08-12T00:00:00.000Z'), '8/12(수) 09:00');
});

test('날짜 경계를 넘길 때도 KST 기준이다', () => {
  // 2026-08-11T15:30:00Z = KST 8/12 00:30
  assert.equal(formatKst('2026-08-11T15:30:00.000Z'), '8/12(수) 00:30');
});

// ── Block Kit ─────────────────────────────────────────────────────

function blocksFor(extra = {}) {
  return buildScheduleBlocks({
    title: '김OO님 주방',
    customerName: '홍*동',
    schedules: [
      { type: 'measurement', scheduled_at: '2026-08-12T00:00:00Z', assignee_name: '김담당', location: '서울시 강남구' },
      { type: 'installation', scheduled_at: '2026-08-20T01:30:00Z' },
    ],
    links: { designUrl: 'https://dadamfurniture.com/detaildesign?id=abc', docNo: 'DD-...-CC-r1' },
    totalKrw: 1699500,
    ...extra,
  });
}

test('fallback text 를 반드시 채운다', () => {
  const { text } = blocksFor();
  assert.ok(text && text.length > 0, '모바일 알림에서 blocks 가 렌더되지 않을 수 있다');
  assert.ok(text.includes('실측'));
  assert.ok(text.includes('설치'));
});

test('일정 건수만큼 section 이 생긴다', () => {
  const { blocks } = blocksFor();
  const sections = blocks.filter((b) => b.type === 'section' && b.text);
  assert.equal(sections.length, 2);
  assert.ok(sections[0].text.text.includes('8/12(수) 09:00'));
  assert.ok(sections[0].text.text.includes('실측'));
  assert.ok(sections[0].text.text.includes('김담당'));
});

test('견적 금액을 필드에 싣는다', () => {
  const { blocks } = blocksFor();
  const fieldBlock = blocks.find((b) => b.type === 'section' && b.fields);
  assert.ok(fieldBlock.fields.some((f) => f.text.includes('1,699,500원')));
});

test('금액이 없으면 견적 필드를 넣지 않는다', () => {
  const { blocks } = blocksFor({ totalKrw: null });
  const fieldBlock = blocks.find((b) => b.type === 'section' && b.fields);
  assert.ok(!fieldBlock.fields.some((f) => f.text.includes('견적')));
});

test('버튼은 url 형만 쓴다 — action_id 는 서명 검증이 필요하다', () => {
  const { blocks } = blocksFor();
  const actions = blocks.find((b) => b.type === 'actions');
  assert.ok(actions);
  for (const el of actions.elements) {
    assert.equal(el.type, 'button');
    assert.ok(el.url, 'url 이 없는 버튼은 인터랙티브 처리가 필요해진다');
    assert.equal(el.action_id, undefined);
  }
});

test('링크가 없으면 버튼 블록을 넣지 않는다', () => {
  const { blocks } = blocksFor({ links: null });
  assert.ok(!blocks.some((b) => b.type === 'actions'));
});

test('Slack 마크업 문자를 이스케이프한다', () => {
  const { blocks } = buildScheduleBlocks({
    title: '주방',
    customerName: '<script>',
    schedules: [
      { type: 'measurement', scheduled_at: '2026-08-12T00:00:00Z', assignee_name: '<a|b>&c' },
    ],
    links: null,
    totalKrw: null,
  });
  const json = JSON.stringify(blocks);
  assert.ok(!json.includes('<script>'));
  assert.ok(json.includes('&lt;script&gt;'));
  assert.ok(json.includes('&lt;a|b&gt;&amp;c'));
});

// ── 전송 ──────────────────────────────────────────────────────────

test('webhook secret 이 없으면 실패로 기록하되 예외를 던지지 않는다', async () => {
  const r = await postToWebhook({}, { text: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 0);
  assert.match(r.error, /not configured/);
});

test('4xx 는 재시도하지 않는다', async () => {
  let calls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response('invalid_payload', { status: 400 });
  };
  try {
    const r = await postToWebhook({ SLACK_WEBHOOK_URL: 'https://hooks.example/x' }, { text: 'x' });
    assert.equal(r.ok, false);
    assert.equal(calls, 1, '400 은 재시도해도 소용없다');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('200 이면 1회로 끝난다', async () => {
  let calls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response('ok', { status: 200 });
  };
  try {
    const r = await postToWebhook({ SLACK_WEBHOOK_URL: 'https://hooks.example/x' }, { text: 'x' });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 1);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('5xx 는 재시도 후 실패로 끝난다', async () => {
  let calls = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls++;
    return new Response('server error', { status: 503 });
  };
  try {
    const r = await postToWebhook({ SLACK_WEBHOOK_URL: 'https://hooks.example/x' }, { text: 'x' });
    assert.equal(r.ok, false);
    assert.equal(calls, 3, '지수 백오프 3회');
  } finally {
    globalThis.fetch = origFetch;
  }
});
