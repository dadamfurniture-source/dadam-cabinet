// 연출컷 AI 상담 정리본 저장 (2026-11-23 대표님 「상담내역은 마이페이지에 정리본 자동저장」, DB 0081)
//   POST /api/chat/brief 가 note_key(uuid)를 받으면 make_consult_notes 에 (user_id, note_key) 로 한 줄 — 다시 정리하면 같은 줄.
//   정리본 글만 적는다 (대화 · 사진 없음). 못 적어도 정리 답은 준다 (saved:false). note_key 가 없으면 예전 답 모양 그대로.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { cleanNoteKey, saveBriefNote } from '../src/chat-brief.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const KEY = 'AAAAAAAA-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ENV = {
  GEMINI_API_KEY: 'test-key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  GENERATIONS_BUCKET: 'generations',
};
const jsonRes = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const BRIEF = JSON.stringify({ brief: '월넛 도어 · 정수기가 들어갑니다', door_color: 'walnut woodgrain', design_style: 'none' });

let realFetch;
let notes;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function install({ dbStatus = 201 } = {}) {
  notes = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) return jsonRes({ id: USER_ID, email: 'a@b.c' });
    if (u.includes('/rest/v1/make_consult_notes')) {
      notes.push({ url: u, prefer: init.headers.Prefer, body: JSON.parse(init.body) });
      return dbStatus < 300 ? new Response(null, { status: dbStatus }) : jsonRes({ message: 'relation does not exist' }, dbStatus);
    }
    if (u.includes('generativelanguage.googleapis.com')) {
      return jsonRes({ candidates: [{ content: { parts: [{ text: BRIEF }] } }] });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}

const post = (body) =>
  worker.fetch(
    new Request('https://generate.example/api/chat/brief', {
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ENV
  );

const msgs = [
  { role: 'ai', text: '싱크대 구성에서 원하시는 게 있으면 적어 주세요.' },
  { role: 'me', text: '정수기 들어가요, 월넛 도어' },
];

test('note_key 가 있으면 정리본을 (user_id, note_key) 로 적는다 — 글만, 고칠 때는 같은 줄', async () => {
  install();
  const res = await post({ category: 'sink', app: true, messages: msgs, note_key: KEY });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.saved, true);
  assert.equal(out.brief, '월넛 도어 · 정수기가 들어갑니다');
  assert.equal(notes.length, 1);
  assert.match(notes[0].url, /on_conflict=user_id%2Cnote_key/);
  assert.match(notes[0].prefer, /resolution=merge-duplicates/);
  assert.deepEqual(notes[0].body, {
    user_id: USER_ID,
    note_key: KEY.toLowerCase(),
    category: 'sink',
    brief: '월넛 도어 · 정수기가 들어갑니다',
  });
});

test('note_key 가 없거나 uuid 가 아니면 적지 않고, 답 모양도 예전 그대로', async () => {
  install();
  const a = await (await post({ category: 'sink', app: true, messages: msgs })).json();
  assert.ok(!('saved' in a));
  const b = await (await post({ category: 'sink', app: true, messages: msgs, note_key: 'x; drop table' })).json();
  assert.ok(!('saved' in b));
  assert.equal(notes.length, 0);
});

test('DB 가 못 받아도(표가 아직 없음) 정리 답은 준다 — saved:false', async () => {
  install({ dbStatus: 404 });
  const res = await post({ category: 'wardrobe', app: true, messages: msgs, note_key: KEY });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.saved, false);
  assert.equal(out.brief, '월넛 도어 · 정수기가 들어갑니다');
});

test('cleanNoteKey · saveBriefNote — 빈 값은 적지 않는다, 품목은 키로', async () => {
  assert.equal(cleanNoteKey(KEY), KEY.toLowerCase());
  assert.equal(cleanNoteKey('abc'), null);
  assert.equal(cleanNoteKey(null), null);
  const rows = [];
  const upsert = async (_env, table, row, onConflict) => rows.push({ table, row, onConflict });
  assert.equal(await saveBriefNote(ENV, { userId: USER_ID, noteKey: null, category: 'sink', brief: 'a' }, { upsert }), false);
  assert.equal(await saveBriefNote(ENV, { userId: USER_ID, noteKey: KEY, category: 'sink', brief: '' }, { upsert }), false);
  assert.equal(await saveBriefNote(ENV, { userId: USER_ID, noteKey: KEY, category: 'wardrobe', brief: '화이트' }, { upsert }), true);
  assert.deepEqual(rows, [
    { table: 'make_consult_notes', row: { user_id: USER_ID, note_key: KEY, category: 'wardrobe', brief: '화이트' }, onConflict: 'user_id,note_key' },
  ]);
});
