/**
 * 새 업체 신청 Slack 알림 (src/consult-notify.js 의 runPartnerApplicationNotices · 상담 알림과 같은 5분 cron).
 *
 *   - 메시지: 「새 업체 신청 N건 (새 업체 a · Expert→Agent b) — 관리자 화면에서 확인」 + 관리자 화면 링크
 *   - 업체 이름 · 대표자 · 연락처 · 사업자번호 · 소개는 없다 — 칸이 넘어와도
 *   - 잡기: DB 함수 claim_partner_application_notices 를 service_role 로 한 번, 상담과 같은 24시간 창 · 건수 상한
 *   - 0건이면 보내지 않는다 / Slack 실패는 건수만 로그, 다시 보내지 않는다 / 웹훅이 없으면 잡지 않는다
 *   - 업체 신청 쪽이 실패해도(DB 함수 없음 · 네트워크) 같은 cron 의 상담 알림은 그대로 보낸다
 * DB 는 PostgREST 경로별로 응답하는 가짜 fetch 로 대신한다. 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {
  CONSULT_NOTICE_CRON, FRESH_WINDOW_MS, CLAIM_LIMIT, PARTNER_KIND_LABELS,
  buildPartnerApplicationNotice, partnerAdminUrl, runPartnerApplicationNotices,
} from '../src/consult-notify.js';

const HOOK = 'https://hooks.example.test/partner';
const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SLACK_WEBHOOK_URL: HOOK,
  PUBLIC_BASE_URL: 'https://dadamfurniture.com/',
};
const NOW = Date.parse('2026-10-28T05:30:00Z');
const ADMIN_URL = 'https://dadamfurniture.com/admin/expert-requests.html';

// 가짜 신청자 — 메시지 · 로그 어디에도 나오면 안 된다
const PII = {
  company_name: '홍길동가구',
  representative_name: '홍길동',
  contact_phone: '010-1234-5678',
  business_number: '123-45-67890',
  intro: '주방 가구 시공 전문',
  email: 'hong@example.com',
};
const PII_VALUES = Object.values(PII);

const NEW_ROW = { created_at: '2026-10-28T05:10:00+00:00', kind: 'new' };
const UP_ROW = { created_at: '2026-10-28T05:20:00+00:00', kind: 'upgrade' };

const json = (body, status = 200) => ({
  ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body),
});
const plain = (status, body) => ({
  ok: status < 400, status, headers: { get: () => null }, json: async () => ({}), text: async () => body,
});

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    const call = { url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const res = route(call);
    if (!res) throw new Error(`unexpected fetch ${call.method} ${u}`);
    if (res instanceof Error) throw res;
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

async function withLogs(fn) {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines = [];
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(`${k}: ${a.map(String).join(' ')}`);
  try {
    const out = await fn(lines);
    return { out, lines };
  } finally {
    Object.assign(console, saved);
  }
}

const isPartnerRpc = (c) => c.url === 'https://x.supabase.co/rest/v1/rpc/claim_partner_application_notices';
const isConsultRpc = (c) => c.url === 'https://x.supabase.co/rest/v1/rpc/claim_consultation_notices';
const slackCalls = (calls) => calls.filter((c) => c.url === HOOK);

// ── 메시지 ─────────────────────────────────────────────

test('메시지: 건수 · 종류별 건수 · 관리자 화면 링크', () => {
  const msg = buildPartnerApplicationNotice([NEW_ROW, UP_ROW, NEW_ROW], { adminUrl: partnerAdminUrl(ENV) });
  const line = '새 업체 신청 3건 (새 업체 2 · Expert→Agent 1) — 관리자 화면에서 확인';
  assert.equal(msg.text, `${line}\n${ADMIN_URL}`);
  assert.deepEqual(msg.blocks.map((b) => b.type), ['section', 'actions']);
  assert.equal(msg.blocks[0].text.text, line);
  assert.equal(msg.blocks[1].elements[0].url, ADMIN_URL);
  assert.deepEqual(PARTNER_KIND_LABELS, { new: '새 업체', upgrade: 'Expert→Agent' });
});

test('메시지: 한 종류만 있어도 두 종류를 다 적는다 · 링크가 없으면 글만', () => {
  const msg = buildPartnerApplicationNotice([UP_ROW]);
  assert.equal(msg.text, '새 업체 신청 1건 (새 업체 0 · Expert→Agent 1) — 관리자 화면에서 확인');
  assert.deepEqual(msg.blocks.map((b) => b.type), ['section']);
  assert.equal(partnerAdminUrl({}), '');
  assert.equal(partnerAdminUrl({ PUBLIC_BASE_URL: 'https://dadamfurniture.com' }), ADMIN_URL);
});

test('개인정보: 업체 이름 · 대표자 · 연락처 · 사업자번호 · 소개 · 이메일 칸이 넘어와도 메시지에 없다', () => {
  const rows = [{ ...NEW_ROW, ...PII }, { ...UP_ROW, ...PII, kind: 'upgrade' }];
  const payload = JSON.stringify(buildPartnerApplicationNotice(rows, { adminUrl: partnerAdminUrl(ENV) }));
  for (const v of PII_VALUES) assert.equal(payload.includes(v), false, v);
});

// ── 잡기 · 보내기 ──────────────────────────────────────

test('잡기: service_role 로 DB 함수 한 번 — 상담과 같은 24시간 창 · 건수 상한, 한 메시지로 보낸다', async () => {
  const { out } = await withLogs(() =>
    withFetch((c) => (isPartnerRpc(c) ? json({ stale: 0, rows: [NEW_ROW, UP_ROW] }) : c.url === HOOK ? plain(200, 'ok') : null), async (calls) => {
      const res = await runPartnerApplicationNotices(ENV, { now: NOW });
      assert.equal(calls.length, 2);
      const rpc = calls[0];
      assert.equal(rpc.method, 'POST');
      assert.equal(rpc.headers.Authorization, 'Bearer service');
      assert.deepEqual(rpc.body, { p_fresh_since: new Date(NOW - FRESH_WINDOW_MS).toISOString(), p_limit: CLAIM_LIMIT });
      assert.equal(rpc.body.p_fresh_since, '2026-10-27T05:30:00.000Z');
      const posts = slackCalls(calls);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].body.blocks[0].text.text, '새 업체 신청 2건 (새 업체 1 · Expert→Agent 1) — 관리자 화면에서 확인');
      return res;
    }),
  );
  assert.deepEqual(out, { posted: 2, failed: 0, stale: 0 });
});

test('0건이면 보내지 않는다 — 밀린 행(24시간 지남)은 건수만 로그', async () => {
  for (const [stale, logs] of [[4, 1], [0, 0]]) {
    const { out, lines } = await withLogs(() =>
      withFetch((c) => (isPartnerRpc(c) ? json({ stale, rows: [] }) : null), async (calls) => {
        const res = await runPartnerApplicationNotices(ENV, { now: NOW });
        assert.equal(slackCalls(calls).length, 0);
        return res;
      }),
    );
    assert.deepEqual(out, { posted: 0, failed: 0, stale });
    assert.equal(lines.length, logs);
    if (logs) assert.match(lines[0], /24시간 지난 미알림 업체 신청 4건/);
  }
});

test('Slack 이 받지 않으면 건수만 로그 — 개인정보 · 응답 본문 없이, 다시 보내지 않는다', async () => {
  const rows = [{ ...NEW_ROW, ...PII }, UP_ROW];
  const { out, lines } = await withLogs(() =>
    withFetch((c) => (isPartnerRpc(c) ? json({ stale: 0, rows }) : c.url === HOOK ? plain(400, `invalid_blocks ${PII.representative_name}`) : null), async (calls) => {
      const res = await runPartnerApplicationNotices(ENV, { now: NOW });
      assert.equal(slackCalls(calls).length, 1);
      assert.equal(calls.filter(isPartnerRpc).length, 1);
      return res;
    }),
  );
  assert.deepEqual(out, { posted: 0, failed: 2, stale: 0 });
  const err = lines.filter((l) => l.startsWith('error:'));
  assert.equal(err.length, 1);
  assert.match(err[0], /업체 신청 2건 알림을 보내지 못함, 다시 보내지 않음 \(400\)/);
  for (const v of PII_VALUES) assert.equal(lines.join('\n').includes(v), false, v);
});

test('웹훅이 없으면 잡지 않는다 · Supabase 설정이 없어도 그냥 끝', async () => {
  await withFetch(() => null, async (calls) => {
    assert.deepEqual(await runPartnerApplicationNotices({ ...ENV, SLACK_WEBHOOK_URL: '' }, { now: NOW }), { posted: 0, failed: 0, stale: 0, skipped: 'slack' });
    assert.deepEqual(await runPartnerApplicationNotices({ SLACK_WEBHOOK_URL: HOOK }, { now: NOW }), { posted: 0, failed: 0, stale: 0, skipped: 'supabase' });
    assert.equal(calls.length, 0);
  });
});

test('DB 함수가 없거나 실패하면 Slack 에 보내지 않고 상태 · 코드만 로그', async () => {
  const body = { code: 'PGRST202', message: 'Could not find the function public.claim_partner_application_notices', hint: PII.contact_phone };
  const { out, lines } = await withLogs(() =>
    withFetch((c) => (isPartnerRpc(c) ? json(body, 404) : null), async (calls) => {
      const res = await runPartnerApplicationNotices(ENV, { now: NOW });
      assert.equal(slackCalls(calls).length, 0);
      return res;
    }),
  );
  assert.deepEqual(out, { posted: 0, failed: 0, stale: 0, error: '404 PGRST202' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^error: \[partner-notify\] 업체 신청 잡기 실패 \(404 PGRST202\)$/);
});

// ── 같은 cron · 상담 알림은 그대로 ─────────────────────

async function runCron(route) {
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  return withLogs(() =>
    withFetch(route, async (calls) => {
      await worker.scheduled({ cron: CONSULT_NOTICE_CRON, scheduledTime: NOW }, ENV, ctx);
      await Promise.all(waits);
      return { calls, waits: waits.length };
    }),
  );
}

const CONSULT_ROW = {
  created_at: '2026-10-28T05:05:00+00:00',
  consultation_type: 'ai-design',
  furniture_categories: [],
  preferred_date: null,
  preferred_time: null,
  sido: null,
  gugun: null,
  consult_target: null,
  has_generation: false,
  category: 'sink',
};

test('5분 cron: 상담 · 업체 신청을 각각 한 메시지로 보낸다', async () => {
  const { out } = await runCron((c) =>
    isConsultRpc(c) ? json({ stale: 0, rows: [CONSULT_ROW] }) : isPartnerRpc(c) ? json({ stale: 0, rows: [NEW_ROW] }) : c.url === HOOK ? plain(200, 'ok') : null,
  );
  assert.equal(out.waits, 2);
  const texts = slackCalls(out.calls).map((c) => c.body.text).sort();
  assert.equal(texts.length, 2);
  assert.ok(texts.some((t) => t.startsWith('[다담] 새 상담 1건')));
  assert.ok(texts.some((t) => t.startsWith('새 업체 신청 1건 (새 업체 1 · Expert→Agent 0)')));
});

test('5분 cron: 업체 신청 쪽이 실패해도(함수 없음 · 네트워크 오류) 상담 알림은 그대로 보낸다', async () => {
  for (const partnerRes of [json({ code: 'PGRST202', message: 'nope' }, 404), new Error('network down')]) {
    const { out } = await runCron((c) =>
      isConsultRpc(c) ? json({ stale: 0, rows: [CONSULT_ROW] }) : isPartnerRpc(c) ? partnerRes : c.url === HOOK ? plain(200, 'ok') : null,
    );
    const posts = slackCalls(out.calls);
    assert.equal(posts.length, 1);
    assert.ok(posts[0].body.text.startsWith('[다담] 새 상담 1건'));
  }
});

test('5분 cron: 상담 쪽이 실패해도 업체 신청 알림은 보낸다', async () => {
  const { out } = await runCron((c) =>
    isConsultRpc(c) ? json({ code: 'PGRST202', message: 'nope' }, 404) : isPartnerRpc(c) ? json({ stale: 0, rows: [UP_ROW] }) : c.url === HOOK ? plain(200, 'ok') : null,
  );
  const posts = slackCalls(out.calls);
  assert.equal(posts.length, 1);
  assert.ok(posts[0].body.text.startsWith('새 업체 신청 1건 (새 업체 0 · Expert→Agent 1)'));
});
