/**
 * 대화 보관 — 시작한 지 90일 지난 대화 지우기(메시지 함께) · 차례가 끝나고 하루 뒤 대화 객체의 사건 줄 지우기.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeDb, makeClaude, reply, CO, OWNER } from './fakes.js';
import { runRetention, RETAIN_DAYS } from '../src/retention.js';
import { EVENT_TTL_MS } from '../src/session.js';

const DAY = 86400 * 1000;

test('90일 — 시작한 지 90일 지난 대화만 지우고, 그 메시지도 함께 지운다', async () => {
  const now = Date.UTC(2026, 10, 3, 18, 40);
  const iso = (days) => new Date(now - days * DAY).toISOString();
  const db = makeDb({
    conversations: [
      { id: 'old', company_id: CO, user_id: OWNER, created_at: iso(91), updated_at: iso(1) },
      { id: 'edge', company_id: CO, user_id: OWNER, created_at: iso(89), updated_at: iso(89) },
      { id: 'new', company_id: CO, user_id: OWNER, created_at: iso(1), updated_at: iso(1) },
    ],
    messages: [
      { conversation_id: 'old', seq: 1, role: 'user', content: [] },
      { conversation_id: 'old', seq: 2, role: 'assistant', content: [] },
      { conversation_id: 'new', seq: 1, role: 'user', content: [] },
    ],
  });
  globalThis.fetch = db.fetch;
  const out = await runRetention(
    { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' },
    { nowMs: now }
  );
  assert.equal(RETAIN_DAYS, 90);
  assert.deepEqual(out, { deleted: 1, cutoff: iso(90) });
  // 마지막에 쓴 날(updated_at)이 아니라 시작한 날(created_at)로 센다
  assert.deepEqual(
    db.conversations.map((c) => c.id),
    ['edge', 'new']
  );
  assert.deepEqual(
    db.messages.map((m) => m.conversation_id),
    ['new']
  );
  const del = db.calls.find((c) => c.method === 'DELETE');
  assert.equal(del.path, '/rest/v1/assistant_conversations');
  assert.equal(decodeURIComponent(del.query), '?id=in.(old)');
  // 지울 것이 없으면 지우지 않는다
  db.calls.length = 0;
  assert.deepEqual(
    (await runRetention({ SUPABASE_URL: 'https://x.supabase.co' }, { nowMs: now })).deleted,
    0
  );
  assert.ok(!db.calls.some((c) => c.method === 'DELETE'));
});

test('90일 — DB 오류여도 던지지 않는다 (다음 날 다시)', async () => {
  globalThis.fetch = async () => new Response('boom', { status: 500 });
  const out = await runRetention({ SUPABASE_URL: 'https://x.supabase.co' });
  assert.equal(out.deleted, 0);
});

test('scheduled — 하루 한 번 보관 정리를 waitUntil 로', async () => {
  const w = await makeWorld();
  const waits = [];
  await w.worker.scheduled({ scheduledTime: Date.now(), cron: '40 18 * * *' }, w.env, {
    waitUntil: (p) => waits.push(p),
  });
  assert.equal(waits.length, 1);
  assert.deepEqual(await waits[0], { deleted: 0, cutoff: (await waits[0]).cutoff });
});

test('사건 줄 — 차례가 끝나면 하루 뒤 알람, 그때 사건 · 같은 키 기억만 지우고 번호는 이어 간다', async () => {
  const claude = makeClaude([reply('하나'), reply('둘')]);
  const w = await makeWorld({ claude });
  const r = await w.call('/assistant/conversations', { method: 'POST' });
  const id = r.body.data.conversation.id;
  await w.call(`/assistant/conversations/${id}/turns`, {
    method: 'POST',
    body: { text: '하나' },
    headers: { 'X-Idempotency-Key': 'k1' },
  });
  await w.sessions.runAlarms();
  const { obj, storage } = w.sessions.objects.get(id);
  const evKeys = () => [...storage.map.keys()].filter((k) => k.startsWith('ev:'));
  assert.ok(evKeys().length > 0);
  const lastN = obj.m.lastN;
  // 하루 뒤로 알람이 걸렸다
  assert.ok(storage.alarm >= Date.now() + EVENT_TTL_MS - 5000, String(storage.alarm));
  assert.equal(obj.m.purgeAt, storage.alarm);

  // 때가 되기 전 알람은 아무것도 지우지 않는다
  await obj.alarm();
  assert.ok(evKeys().length > 0);

  // 때가 지나면 지운다 — 번호 · 틀은 남는다
  obj.m.purgeAt = Date.now() - 1;
  await obj.alarm();
  assert.deepEqual(evKeys(), []);
  assert.equal(obj.m.lastN, lastN);
  assert.deepEqual(obj.m.keys, []);
  assert.equal(obj.m.purgeAt, null);
  assert.ok(storage.map.has('frame'));
  assert.deepEqual((await w.events(id, 0)).list, []);

  // 다음 차례는 번호를 이어 간다
  const t2 = await w.call(`/assistant/conversations/${id}/turns`, {
    method: 'POST',
    body: { text: '둘' },
  });
  assert.equal(t2.body.data.after, lastN);
  await w.sessions.runAlarms();
  const { list } = await w.events(id, lastN);
  assert.equal(list[0].n, lastN + 1);
  assert.equal(list.at(-1).type, 'done');
  // 대화 기록(DB)은 그대로
  assert.equal(w.db.messages.length, 4);
});
