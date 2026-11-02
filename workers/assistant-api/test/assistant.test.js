/**
 * assistant-api 뼈대 — 사람 · 자격 · 대화 · 차례(예산 · Claude · 저장 · 정산 · 기록) · 사건 줄.
 * 가짜 Supabase · 가짜 DO · 가짜 Claude (test/fakes.js). 실제 네트워크 · 모델 비용 없음.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeDb, makeClaude, reply, CO, CO2, OWNER } from './fakes.js';
import { costMicros, estimateMicros, rateOf, RATES } from '../src/meter.js';
import { echoContent, historyOf, buildRequest } from '../src/claude.js';
import { systemPrompt } from '../src/prompt.js';

async function newConversation(w, token = 't-owner') {
  const r = await w.call('/assistant/conversations', { token, method: 'POST' });
  assert.equal(r.status, 201, r.text);
  return r.body.data.conversation.id;
}

async function turn(w, id, text, { token = 't-owner', key } = {}) {
  return w.call(`/assistant/conversations/${id}/turns`, {
    token,
    method: 'POST',
    body: { text },
    headers: key ? { 'X-Idempotency-Key': key } : {},
  });
}

// ── 사람 · 자격 ──────────────────────────────────────────

test('/health · CORS preflight · 없는 주소 404', async () => {
  const w = await makeWorld();
  const h = await w.call('/health', { token: null });
  assert.equal(h.status, 200);
  assert.equal(h.body.service, 'dadam-assistant-api');
  const pre = await w.worker.fetch(
    new Request('https://assistant.test/assistant/me', {
      method: 'OPTIONS',
      headers: { Origin: 'https://dadamfurniture.com' },
    }),
    w.env
  );
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), 'https://dadamfurniture.com');
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Idempotency-Key/);
  const bad = await w.worker.fetch(
    new Request('https://assistant.test/assistant/me', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    }),
    w.env
  );
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await w.call('/nope')).status, 404);
});

test('/assistant/me — 로그인 401, 구성원 아님 403, 자격 없음은 level none · can_chat false', async () => {
  const w = await makeWorld({ db: makeDb({ entitled: { [CO]: 'full', [CO2]: 'none' } }) });
  assert.equal((await w.call('/assistant/me', { token: null })).status, 401);
  assert.equal((await w.call('/assistant/me', { token: 't-bad' })).status, 401);
  const stranger = await w.call('/assistant/me', { token: 't-stranger' });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.body.code, 'not_member');
  const owner = await w.call('/assistant/me');
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body.data, {
    company_id: CO,
    role: 'owner',
    money: true,
    level: 'full',
    can_chat: true,
    max_turns: 30,
  });
  assert.equal(owner.headers.get('Cache-Control'), 'no-store');
  const staff = await w.call('/assistant/me', { token: 't-staff' });
  assert.equal(staff.body.data.money, false);
  const other = await w.call('/assistant/me', { token: 't-other' });
  assert.equal(other.body.data.level, 'none');
  assert.equal(other.body.data.can_chat, false);
  // 자격은 사람과 함께 묻는다
  const rpc = w.db.calls.filter((c) => c.path.endsWith('/rpc/company_entitled'));
  assert.deepEqual(rpc[0].body, { p_company: CO, p_feature: 'assistant', p_user: OWNER });
});

test('대화 만들기 — 자격 full 만, 내 대화만 보인다 (다른 사람 · 다른 업체 대화는 404)', async () => {
  const w = await makeWorld({ db: makeDb({ entitled: { [CO]: 'full', [CO2]: 'none' } }) });
  const no = await w.call('/assistant/conversations', { token: 't-other', method: 'POST' });
  assert.equal(no.status, 403);
  assert.equal(no.body.code, 'not_entitled');
  const id = await newConversation(w);
  assert.deepEqual(
    w.db.conversations.map((c) => [c.company_id, c.user_id]),
    [[CO, OWNER]]
  );
  const list = await w.call('/assistant/conversations');
  assert.deepEqual(
    list.body.data.items.map((c) => c.id),
    [id]
  );
  assert.deepEqual(
    (await w.call('/assistant/conversations', { token: 't-staff' })).body.data.items,
    []
  );
  for (const path of [`/assistant/conversations/${id}`, `/assistant/conversations/${id}/events`]) {
    assert.equal((await w.call(path, { token: 't-staff' })).status, 404, path);
  }
  assert.equal((await turn(w, id, '안녕', { token: 't-staff' })).status, 404);
  assert.equal((await w.call('/assistant/conversations/not-a-uuid')).status, 404);
});

// ── 차례 ─────────────────────────────────────────────────

test('차례 — 202 → 알람이 예산 잡기 · Claude · 저장 · 정산 · 기록, 사건 줄은 start · text · done', async () => {
  const claude = makeClaude([reply('안녕하세요. 무엇을 도와드릴까요?')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  const r = await turn(w, id, '  안녕  ', { key: 'k-1' });
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(r.body.data, { turn: 1, after: 0, reused: false });
  assert.deepEqual(w.sessions.hints, ['enam']);

  // 같은 키는 그 차례, 다른 키는 도는 중이라 409
  const again = await turn(w, id, '안녕', { key: 'k-1' });
  assert.equal(again.status, 200);
  assert.equal(again.body.data.turn, 1);
  const busy = await turn(w, id, '또', { key: 'k-2' });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.code, 'busy');

  // 사건 줄을 열어 둔 채로 알람을 돌린다 — 이어 받는다
  const live = w.events(id, 0);
  await w.sessions.runAlarms();
  const { list } = await live;
  assert.deepEqual([...new Set(list.map((e) => e.type))], ['start', 'text', 'done']);
  assert.equal(
    list
      .filter((e) => e.type === 'text')
      .map((e) => e.text)
      .join(''),
    '안녕하세요. 무엇을 도와드릴까요?'
  );
  assert.deepEqual(
    list.map((e) => e.n),
    list.map((_, i) => i + 1)
  );
  assert.equal(list.at(-1).stop_reason, 'end_turn');

  // Claude 에 보낸 것
  assert.equal(claude.calls.length, 1);
  const p = claude.calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.max_tokens, 8000);
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.fallbacks, 'default');
  assert.equal(p.inference_geo, 'us');
  assert.deepEqual(p.output_config, { effort: 'medium' });
  assert.equal(p.thinking, undefined);
  assert.equal(p.tools, undefined);
  assert.match(p.system, /업체 대표이다/);
  assert.match(p.system, /숫자 · 이름 · 날짜를 지어내지 않는다/);
  assert.deepEqual(p.messages, [{ role: 'user', content: [{ type: 'text', text: '안녕' }] }]);

  // 저장 — 사람 + 비서(받은 블록 그대로), 제목은 첫 글
  assert.deepEqual(
    w.db.messages.map((m) => [m.seq, m.role, m.content.map((b) => b.type)]),
    [
      [1, 'user', ['text']],
      [2, 'assistant', ['thinking', 'text']],
    ]
  );
  assert.equal(w.db.messages[1].content[0].signature, 'sig-1');
  assert.equal(w.db.conversations[0].title, '안녕');

  // 예산 — 키 chat:{대화}:{차례}, 잡은 금액은 어림 · 정산은 실제 usage × 요금 × 1.1
  assert.equal(w.db.usage.length, 1);
  const u = w.db.usage[0];
  assert.equal(u.key, `chat:${id}:1`);
  assert.equal(u.purpose, 'chat');
  assert.equal(u.user, OWNER);
  assert.ok(u.reserved >= 8000 * 20 * 1.1, String(u.reserved));
  assert.equal(u.cost, Math.ceil((1000 * 4 + 200 * 20) * 1.1));
  assert.equal(u.usage.input_tokens, 1000);
  assert.equal(u.usage.model, 'claude-opus-5-5');

  // 기록 — 숫자만, 글은 넣지 않는다
  const t = w.db.audit.find((a) => a.kind === 'turn');
  assert.equal(t.company_id, CO);
  assert.equal(t.conversation_id, id);
  assert.equal(t.name, 'claude-opus-5-5');
  assert.equal(t.detail.output_tokens, 200);
  assert.ok(!JSON.stringify(w.db.audit).includes('안녕'));

  // 대화 보기 — 글만
  const view = await w.call(`/assistant/conversations/${id}`);
  assert.deepEqual(
    view.body.data.messages.map((m) => [m.seq, m.role, m.text]),
    [
      [1, 'user', '안녕'],
      [2, 'assistant', '안녕하세요. 무엇을 도와드릴까요?'],
    ]
  );
  assert.ok(!view.text.includes('sig-1'));

  // 끝난 뒤 ?after= 는 그 뒤 사건만, 저장된 것까지 보내고 닫는다
  const tail = await w.events(id, list.at(-2).n);
  assert.deepEqual(
    tail.list.map((e) => e.type),
    ['done']
  );
});

test('둘째 차례 — 지난 메시지를 그대로(생각 블록 포함) 다시 보내고, seq 를 잇는다', async () => {
  const claude = makeClaude([reply('첫 답'), reply('둘째 답')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '첫 질문');
  await w.sessions.runAlarms();
  const r = await turn(w, id, '둘째 질문');
  assert.equal(r.body.data.turn, 2);
  assert.ok(r.body.data.after > 0);
  await w.sessions.runAlarms();
  const p = claude.calls[1];
  assert.deepEqual(
    p.messages.map((m) => m.role),
    ['user', 'assistant', 'user']
  );
  assert.deepEqual(p.messages[1].content, w.db.messages[1].content);
  assert.equal(p.messages[1].content[0].type, 'thinking');
  assert.deepEqual(
    w.db.messages.map((m) => m.seq),
    [1, 2, 3, 4]
  );
  assert.equal(w.db.conversations[0].title, '첫 질문');
  assert.deepEqual(
    w.db.usage.map((u) => u.key),
    [`chat:${id}:1`, `chat:${id}:2`]
  );
});

test('직원 — 시스템 글에 돈 정보를 말하지 않는다는 줄', async () => {
  const claude = makeClaude([reply('네')]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w, 't-staff');
  await turn(w, id, '이번 달 마진은?', { token: 't-staff' });
  await w.sessions.runAlarms();
  assert.match(claude.calls[0].system, /업체 직원이다/);
  assert.match(claude.calls[0].system, /금액 · 원가 · 마진 · 수금 · 장부 정보를 말하지 않는다/);
});

test('예산이 안 되면 blocked — Claude 를 부르지 않고 메시지를 넣지 않는다', async () => {
  for (const reason of ['over_limit', 'no_limit', 'not_entitled', 'off']) {
    const claude = makeClaude();
    const w = await makeWorld({ claude, db: makeDb({ reserveReason: reason }) });
    const id = await newConversation(w);
    await turn(w, id, '안녕');
    await w.sessions.runAlarms();
    const { list } = await w.events(id);
    assert.deepEqual(
      list.map((e) => e.type),
      ['start', 'blocked'],
      reason
    );
    assert.equal(list[1].reason, reason);
    assert.equal(claude.calls.length, 0);
    assert.equal(w.db.messages.length, 0);
    assert.deepEqual(
      w.db.audit.map((a) => [a.kind, a.name]),
      [['blocked', reason]]
    );
    // 끝났으니 다음 차례를 받는다
    assert.equal((await turn(w, id, '다시')).status, 202);
  }
});

test('보낸 뒤 자격이 사라지면 blocked not_entitled — 예산을 잡지 않는다', async () => {
  const claude = makeClaude();
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '안녕');
  w.db.entitled[CO] = 'none';
  await w.sessions.runAlarms();
  const { list } = await w.events(id);
  assert.equal(list.at(-1).type, 'blocked');
  assert.equal(list.at(-1).reason, 'not_entitled');
  assert.equal(w.db.usage.length, 0);
  assert.equal(claude.calls.length, 0);
});

test('대화가 MAX_TURNS 를 넘으면 blocked conversation_full', async () => {
  const claude = makeClaude([reply('하나')]);
  const w = await makeWorld({ claude, env: { MAX_TURNS: '1' } });
  const id = await newConversation(w);
  await turn(w, id, '하나');
  await w.sessions.runAlarms();
  await turn(w, id, '둘');
  await w.sessions.runAlarms();
  const { list } = await w.events(id);
  assert.equal(list.at(-1).reason, 'conversation_full');
  assert.equal(claude.calls.length, 1);
  assert.equal((await w.call('/assistant/me', {})).body.data.max_turns, 1);
});

test('거절(refusal) — refused, 메시지는 넣지 않고 비용은 정산한다', async () => {
  const claude = makeClaude([reply('', { chunks: [], content: [], stop_reason: 'refusal' })]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '안녕');
  await w.sessions.runAlarms();
  const { list } = await w.events(id);
  assert.equal(list.at(-1).type, 'refused');
  assert.equal(w.db.messages.length, 0);
  assert.equal(w.db.usage[0].cost, Math.ceil((1000 * 4 + 200 * 20) * 1.1));
  assert.deepEqual(
    w.db.audit.map((a) => [a.kind, a.name]),
    [['blocked', 'refusal']]
  );
});

test('글 없는 답 · Claude 오류 — error, 메시지는 넣지 않는다 (오류는 받은 만큼만 정산)', async () => {
  const empty = reply('', {
    chunks: [],
    content: [{ type: 'thinking', thinking: '', signature: 's' }],
    stop_reason: 'max_tokens',
  });
  const boom = Object.assign(new Error('overloaded'), { status: 529 });
  const broken = reply('반쯤', {
    throwAfter: boom,
    startUsage: { input_tokens: 1000, output_tokens: 1 },
  });
  const claude = makeClaude([empty, broken]);
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '하나');
  await w.sessions.runAlarms();
  await turn(w, id, '둘');
  await w.sessions.runAlarms();
  const { list } = await w.events(id);
  const ends = list.filter((e) => e.type === 'error');
  assert.deepEqual(
    ends.map((e) => e.code),
    ['empty', 'claude']
  );
  assert.equal(w.db.messages.length, 0);
  assert.equal(w.db.usage[1].cost, Math.ceil((1000 * 4 + 1 * 20) * 1.1));
  assert.deepEqual(
    w.db.audit.map((a) => [a.kind, a.name]),
    [
      ['error', 'empty'],
      ['error', 'claude'],
    ]
  );
  assert.equal(w.db.audit[1].detail.status, 529);
  // 끊긴 답의 글은 대화 기록에 없다 — 다음 차례는 그대로 받는다
  assert.equal((await turn(w, id, '셋')).status, 202);
});

test('알람이 다시 돌면(부르기 시작한 뒤) error interrupted — 두 번 부르지 않는다', async () => {
  const claude = makeClaude();
  const w = await makeWorld({ claude });
  const id = await newConversation(w);
  await turn(w, id, '안녕');
  const { obj, storage } = [...w.sessions.objects.values()][0];
  obj.m.current.phase = 'running';
  storage.alarm = null;
  await obj.alarm();
  const { list } = await w.events(id);
  assert.equal(list.at(-1).type, 'error');
  assert.equal(list.at(-1).code, 'interrupted');
  assert.equal(claude.calls.length, 0);
});

test('글 확인 · 키 형식 · 분 한도 429', async () => {
  let n = 0;
  const w = await makeWorld({
    env: { ASSISTANT_TURN_LIMIT: { limit: async () => ({ success: ++n < 3 }) } },
  });
  const id = await newConversation(w);
  assert.equal((await turn(w, id, '   ')).status, 422);
  assert.equal((await turn(w, id, '가'.repeat(4001))).status, 422);
  const r = await turn(w, id, '안녕', { key: 'bad key!' });
  assert.equal(r.status, 429); // 세 번째 부르기 — 한도가 먼저
  n = 0;
  assert.equal((await turn(w, id, '안녕', { key: 'bad key!' })).status, 422);
});

// ── 순수 ─────────────────────────────────────────────────

test('요금 — 모델 앞머리 · 1.1배 · 모르는 모델은 가장 비싼 값, 어림은 출력 최대치를 넘게', () => {
  assert.equal(rateOf('claude-opus-5-5'), RATES['claude-opus-5-5']);
  assert.equal(rateOf('claude-opus-5-5-20261101'), RATES['claude-opus-5-5']);
  assert.equal(rateOf('claude-opus-5'), RATES['claude-opus-5']);
  assert.deepEqual(rateOf('claude-unknown'), {
    input: 5,
    cache_write: 6.25,
    cache_read: 0.5,
    output: 25,
  });
  const usage = {
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_input_tokens: 5000,
    cache_creation_input_tokens: 2000,
  };
  assert.equal(
    costMicros({}, 'claude-opus-5-5', usage),
    Math.ceil((1000 * 4 + 100 * 20 + 5000 * 0.2 + 2000 * 5) * 1.1)
  );
  assert.equal(
    costMicros({ INFERENCE_GEO: 'global' }, 'claude-opus-5-5', usage),
    1000 * 4 + 100 * 20 + 5000 * 0.2 + 2000 * 5
  );
  assert.equal(costMicros({}, 'claude-opus-5-5', null), 0);
  const params = buildRequest(
    {},
    {
      system: '가'.repeat(100),
      messages: [{ role: 'user', content: [{ type: 'text', text: '나' }] }],
    }
  );
  assert.ok(estimateMicros({}, params) > 8000 * 20 * 1.1);
});

test('다시 보내기 — fallback 블록이 있으면 그 앞은 글만, 뒤는 그대로', () => {
  const plain = [
    { type: 'thinking', thinking: '', signature: 'a' },
    { type: 'text', text: '답' },
  ];
  assert.deepEqual(echoContent(plain), plain);
  const switched = [
    { type: 'thinking', thinking: '', signature: 'a' },
    { type: 'text', text: '앞' },
    { type: 'tool_use', id: 't', name: 'x', input: {} },
    { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
    { type: 'thinking', thinking: '', signature: 'b' },
    { type: 'text', text: '뒤' },
  ];
  assert.deepEqual(
    echoContent(switched).map((b) => b.type + ':' + (b.text || b.signature || '')),
    ['text:앞', 'thinking:b', 'text:뒤']
  );
  assert.deepEqual(
    historyOf([
      { role: 'user', content: [{ type: 'text', text: 'q' }] },
      { role: 'assistant', content: switched },
    ])[1].content.length,
    3
  );
});

test('시스템 글 — 플레이북은 키마다 가장 높은 판만 붙는다', async () => {
  const w = await makeWorld({
    db: makeDb({
      playbooks: [
        { key: 'consult', version: 1, body: '옛 판' },
        { key: 'consult', version: 2, body: '새 판' },
        { key: 'usage', version: 1, body: '사용법' },
      ],
    }),
    claude: makeClaude([reply('네')]),
  });
  const id = await newConversation(w);
  await turn(w, id, '안녕');
  await w.sessions.runAlarms();
  const sys = w.claude.calls[0].system;
  assert.match(sys, /<playbook key="consult" version="2">\n새 판/);
  assert.ok(!sys.includes('옛 판'));
  assert.match(sys, /<playbook key="usage" version="1">/);
  assert.match(systemPrompt({ role: 'manager', playbooks: [] }), /업체 실장이다/);
});
