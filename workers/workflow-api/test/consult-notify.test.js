/**
 * 새 상담 Slack 알림 (src/consult-notify.js · 5분 cron).
 *
 *   - 메시지에 이름 · 연락처 · 이메일 · 요청 내용 · 상담 제목이 없다 — 칸이 넘어와도, 코드 칸에 이상한 글이 들어 있어도
 *   - 잡기: DB 함수 claim_consultation_notices 를 service_role 로 한 번 부르고, 돌려받은 행만 보낸다
 *   - 24시간 창: p_fresh_since = 지금 - 24시간. 그보다 오래된 행은 함수가 표시만 하고(stale) 알리지 않는다
 *   - 여러 건은 한 메시지로 묶는다
 *   - 실패: Slack 이 받지 않으면 건수만 로그에 남기고 다시 보내지 않는다 / 웹훅이 없으면 잡지도 않는다
 *   - 값 목록(유형 · 가구 · 연출컷 품목 · 시간대 · 시/도)이 신청 화면 · 생성 워커의 값과 같다
 * DB 는 PostgREST 경로별로 응답하는 가짜 fetch 로 대신한다. 시험 데이터는 모두 가짜다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import worker, { DAILY_BRIEF_CRON } from '../src/worker.js';
import {
  CONSULT_NOTICE_CRON, FRESH_WINDOW_MS, CLAIM_LIMIT,
  TYPE_LABELS, FURNITURE_LABELS, APP_KIND_LABELS, TIME_LABELS, SIDO,
  buildConsultNotice, noticeLines, itemLabel, regionLabel, contactLabel, isFromApp, consultAdminUrl, runConsultNotices,
} from '../src/consult-notify.js';
import { CATEGORIES } from '../../generate-api/src/prompts.js';

const ROOT = new URL('../../../', import.meta.url);
const readRepo = (p) => readFileSync(fileURLToPath(new URL(p, ROOT)), 'utf8');

const HOOK = 'https://hooks.example.test/consult';
const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  SLACK_WEBHOOK_URL: HOOK,
  PUBLIC_BASE_URL: 'https://dadamfurniture.com/',
};
const NOW = Date.parse('2026-10-27T05:30:00Z'); // KST 14:30

// 가짜 고객 — 이 값들이 메시지 · 로그 어디에도 나오면 안 된다
const PII = {
  name: '홍길동',
  phone: '010-1234-5678',
  email: 'hong@example.com',
  description: '현관 비밀번호 1234 · 매일 저녁 집에 없음',
  title: '홍길동네 거실 붙박이장',
  admin_memo: '메모-비밀',
};
const PII_VALUES = Object.values(PII);

const APP_ROW = {
  created_at: '2026-10-27T05:05:00+00:00',
  consultation_type: 'ai-design',
  furniture_categories: [],
  preferred_date: null,
  preferred_time: '15:00-18:00',
  sido: '경기도',
  gugun: '성남시',
  consult_target: 'partner',
  has_generation: true,
  category: 'sink',
};
const SITE_ROW = {
  created_at: '2026-10-27T03:00:00+00:00',
  consultation_type: 'detail-design',
  furniture_categories: ['wardrobe', 'island'],
  preferred_date: '2026-10-30',
  preferred_time: '09:00-12:00',
  sido: null,
  gugun: null,
  consult_target: null,
  has_generation: false,
  category: null,
};

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
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** console.log · warn · error 를 모아 돌려준다 (시험 출력은 조용히) */
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

const isRpc = (c) => c.url === 'https://x.supabase.co/rest/v1/rpc/claim_consultation_notices';
const slackCalls = (calls) => calls.filter((c) => c.url === HOOK);

// ── 메시지 ─────────────────────────────────────────────

test('한 건: 품목 · 경로 · 상담받을 곳 / 지역 · 연락 희망 · 접수 시각(KST)', () => {
  assert.equal(
    noticeLines(APP_ROW),
    '*싱크대 (AI 설계)* · 앱 · 협력업체 상담\n경기도 성남시 · 연락 희망 오후 (15:00~18:00) · 10/27(화) 14:05 접수',
  );
  assert.equal(
    noticeLines(SITE_ROW),
    '*붙박이장·아일랜드 (상세 설계)* · 사이트\n연락 희망 10/30(금) 오전 (09:00~12:00) · 10/27(화) 12:00 접수',
  );
  const msg = buildConsultNotice([APP_ROW], { adminUrl: consultAdminUrl(ENV) });
  assert.equal(msg.text, '[다담] 새 상담 1건 — 싱크대 (AI 설계)');
  assert.deepEqual(msg.blocks.map((b) => b.type), ['header', 'section', 'context', 'actions']);
  assert.equal(msg.blocks[0].text.text, '📨 새 상담 1건');
  assert.equal(msg.blocks.at(-1).elements[0].url, 'https://dadamfurniture.com/admin/consultations.html');
});

test('여러 건은 한 메시지 — 머리에 건수, 한 건에 한 칸', () => {
  const rows = [SITE_ROW, APP_ROW, { ...SITE_ROW, consultation_type: 'estimate', furniture_categories: ['sink'] }];
  const msg = buildConsultNotice(rows, { adminUrl: 'https://a.test/admin/consultations.html' });
  assert.equal(msg.blocks[0].text.text, '📨 새 상담 3건');
  assert.equal(msg.blocks.filter((b) => b.type === 'section').length, 3);
  assert.equal(msg.text, '[다담] 새 상담 3건 — 붙박이장·아일랜드 (상세 설계) 외 2건');
});

test('아주 많으면 40건까지 줄로, 나머지는 「외 n건」 — Slack 블록 50개 안', () => {
  const rows = Array.from({ length: 50 }, () => APP_ROW);
  const msg = buildConsultNotice(rows, { adminUrl: 'https://a.test/x' });
  assert.ok(msg.blocks.length <= 50, `blocks ${msg.blocks.length}`);
  assert.equal(msg.blocks.filter((b) => b.type === 'section').length, 41);
  assert.ok(msg.blocks.some((b) => b.text && b.text.text === '외 10건 — 관리자 화면에서 확인'));
});

test('개인정보: 이름 · 연락처 · 이메일 · 요청 내용 · 제목 · 메모 칸이 넘어와도 메시지에 없다', () => {
  const rows = [{ ...APP_ROW, ...PII }, { ...SITE_ROW, ...PII }];
  const payload = JSON.stringify(buildConsultNotice(rows, { adminUrl: consultAdminUrl(ENV) }));
  for (const v of PII_VALUES) assert.equal(payload.includes(v), false, v);
});

test('개인정보: 코드 칸에 고객 정보 · 이상한 글을 넣어도 목록 밖 값은 싣지 않는다', () => {
  const evil = {
    created_at: '2026-10-27T05:05:00Z',
    consultation_type: PII.name,
    furniture_categories: [PII.phone, 'sink', PII.email],
    preferred_date: PII.phone,
    preferred_time: `${PII.name} ${PII.phone}`,
    sido: PII.email,
    gugun: PII.name,
    consult_target: PII.phone,
    has_generation: false,
    category: PII.description,
  };
  const payload = JSON.stringify(buildConsultNotice([evil, { ...SITE_ROW, sido: '경기도', gugun: PII.phone }]));
  for (const v of PII_VALUES) assert.equal(payload.includes(v), false, v);
  assert.equal(itemLabel(evil), '싱크대');
  assert.equal(regionLabel(evil), '');
  assert.equal(contactLabel(evil), '');
  assert.equal(isFromApp(evil), false);
  // 시/도가 맞아도 시/군/구 모양이 아니면 시/도까지만
  assert.equal(regionLabel({ sido: '경기도', gugun: '<https://evil.test|눌러>' }), '경기도');
  assert.equal(regionLabel({ sido: '경기도', gugun: '010-1234-5678' }), '경기도');
});

test('품목: 앱은 연출컷 품목, 사이트는 고른 가구 종류, 없으면 상담 유형만', () => {
  assert.equal(itemLabel({ category: 'shoe', consultation_type: 'ai-design' }), '신발장 (AI 설계)');
  assert.equal(itemLabel({ furniture_categories: ['sink', 'sink', 'other'], consultation_type: 'estimate' }), '싱크대·기타 (견적 상담)');
  assert.equal(itemLabel({ consultation_type: 'other' }), '기타');
  assert.equal(itemLabel({}), '품목 미지정');
  // 연출컷이 지워져 generation_id 가 비어도 상담받을 곳이 있으면 앱
  assert.equal(isFromApp({ has_generation: false, consult_target: 'hq' }), true);
  assert.equal(isFromApp({ has_generation: false, consult_target: null }), false);
});

// ── 잡기 · 보내기 ──────────────────────────────────────

test('잡기: service_role 로 DB 함수 한 번 — 24시간 창 · 건수 상한, 돌려받은 행만 한 메시지로 보낸다', async () => {
  const { out } = await withLogs(() =>
    withFetch((c) => (isRpc(c) ? json({ stale: 0, rows: [APP_ROW, SITE_ROW] }) : c.url === HOOK ? plain(200, 'ok') : null), async (calls) => {
      const res = await runConsultNotices(ENV, { now: NOW });
      assert.equal(calls.length, 2);
      const rpc = calls[0];
      assert.equal(rpc.method, 'POST');
      assert.equal(rpc.headers.Authorization, 'Bearer service');
      assert.deepEqual(rpc.body, { p_fresh_since: new Date(NOW - FRESH_WINDOW_MS).toISOString(), p_limit: CLAIM_LIMIT });
      assert.equal(rpc.body.p_fresh_since, '2026-10-26T05:30:00.000Z');
      const posts = slackCalls(calls);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].body.blocks[0].text.text, '📨 새 상담 2건');
      return res;
    }),
  );
  assert.deepEqual(out, { posted: 2, failed: 0, stale: 0 });
});

test('첫 실행(밀린 행): 24시간 지난 행은 함수가 표시만 — 건수만 로그, 알림은 창 안의 행만', async () => {
  const { out, lines } = await withLogs(() =>
    withFetch((c) => (isRpc(c) ? json({ stale: 37, rows: [APP_ROW] }) : c.url === HOOK ? plain(200, 'ok') : null), async (calls) => {
      const res = await runConsultNotices(ENV, { now: NOW });
      const posts = slackCalls(calls);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].body.blocks[0].text.text, '📨 새 상담 1건');
      return res;
    }),
  );
  assert.deepEqual(out, { posted: 1, failed: 0, stale: 37 });
  assert.ok(lines.some((l) => l.includes('24시간 지난 미알림 상담 37건')));
});

test('밀린 행만 있고 새 행이 없으면 Slack 에 보내지 않는다 · 아무것도 없으면 조용하다', async () => {
  for (const [stale, logs] of [[5, 1], [0, 0]]) {
    const { out, lines } = await withLogs(() =>
      withFetch((c) => (isRpc(c) ? json({ stale, rows: [] }) : null), async (calls) => {
        const res = await runConsultNotices(ENV, { now: NOW });
        assert.equal(slackCalls(calls).length, 0);
        return res;
      }),
    );
    assert.deepEqual(out, { posted: 0, failed: 0, stale });
    assert.equal(lines.length, logs);
  }
});

test('실패: Slack 이 받지 않으면 건수만 로그 — 개인정보 · 응답 본문 없이, 다시 보내지 않는다', async () => {
  const rows = [{ ...APP_ROW, ...PII }, { ...SITE_ROW, ...PII }, SITE_ROW];
  const { out, lines } = await withLogs(() =>
    withFetch((c) => (isRpc(c) ? json({ stale: 0, rows }) : c.url === HOOK ? plain(400, `invalid_blocks ${PII.name}`) : null), async (calls) => {
      const res = await runConsultNotices(ENV, { now: NOW });
      // 4xx 는 그 자리 재시도도 없다. 잡기도 한 번뿐 — 표시된 행은 다음 실행에 다시 잡히지 않는다
      assert.equal(slackCalls(calls).length, 1);
      assert.equal(calls.filter(isRpc).length, 1);
      return res;
    }),
  );
  assert.deepEqual(out, { posted: 0, failed: 3, stale: 0 });
  const err = lines.filter((l) => l.startsWith('error:'));
  assert.equal(err.length, 1);
  assert.match(err[0], /상담 3건 알림을 보내지 못함, 다시 보내지 않음 \(400\)/);
  for (const v of PII_VALUES) assert.equal(lines.join('\n').includes(v), false, v);
});

test('웹훅이 없으면 잡지 않는다 (잡으면 표시만 되고 알림이 사라진다) · Supabase 설정이 없어도 그냥 끝', async () => {
  await withFetch(() => null, async (calls) => {
    assert.deepEqual(await runConsultNotices({ ...ENV, SLACK_WEBHOOK_URL: '' }, { now: NOW }), { posted: 0, failed: 0, stale: 0, skipped: 'slack' });
    assert.deepEqual(await runConsultNotices({ SLACK_WEBHOOK_URL: HOOK }, { now: NOW }), { posted: 0, failed: 0, stale: 0, skipped: 'supabase' });
    assert.equal(calls.length, 0);
  });
});

test('DB 함수가 없거나 실패하면 Slack 에 보내지 않고 상태 · 코드만 로그 (응답 본문은 남기지 않는다)', async () => {
  const body = { code: 'PGRST202', message: 'Could not find the function public.claim_consultation_notices', hint: PII.name };
  const { out, lines } = await withLogs(() =>
    withFetch((c) => (isRpc(c) ? json(body, 404) : null), async (calls) => {
      const res = await runConsultNotices(ENV, { now: NOW });
      assert.equal(slackCalls(calls).length, 0);
      return res;
    }),
  );
  assert.deepEqual(out, { posted: 0, failed: 0, stale: 0, error: '404 PGRST202' });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^error: \[consult-notify\] 상담 잡기 실패 \(404 PGRST202\)$/);
});

// ── cron ───────────────────────────────────────────────

test('wrangler.toml crons = 생산 요약 · 새 상담 알림 두 개, scheduled() 판정 값과 같다', () => {
  const toml = readRepo('workers/workflow-api/wrangler.toml');
  const m = toml.match(/^crons\s*=\s*\[(.*)\]\s*$/m);
  assert.ok(m, 'crons 줄');
  const crons = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(crons, [DAILY_BRIEF_CRON, CONSULT_NOTICE_CRON]);
  assert.equal(CONSULT_NOTICE_CRON, '*/5 * * * *');
});

async function runScheduled(cron) {
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  return withLogs(() =>
    withFetch((c) => (isRpc(c) ? json({ stale: 0, rows: [] }) : c.url.includes('/rest/v1/') ? json([]) : null), async (calls) => {
      await worker.scheduled({ cron, scheduledTime: NOW }, ENV, ctx);
      await Promise.all(waits);
      return { calls, waits: waits.length };
    }),
  );
}

test('scheduled(): 5분 cron 은 새 상담 · 새 업체 신청 알림만(따로 돈다), 아침 cron 은 생산 요약만, 모르는 cron 은 아무것도', async () => {
  const consult = (await runScheduled(CONSULT_NOTICE_CRON)).out;
  assert.equal(consult.waits, 2);
  assert.deepEqual(consult.calls.map((c) => c.url).sort(), [
    'https://x.supabase.co/rest/v1/rpc/claim_consultation_notices',
    'https://x.supabase.co/rest/v1/rpc/claim_partner_application_notices',
  ]);

  const daily = (await runScheduled(DAILY_BRIEF_CRON)).out;
  assert.equal(daily.waits, 2);
  assert.equal(daily.calls.filter(isRpc).length, 0);

  const unknown = await runScheduled('0 0 * * *');
  assert.equal(unknown.out.waits, 0);
  assert.equal(unknown.out.calls.length, 0);
});

// ── 값 목록이 화면 · 생성 워커와 같다 ──────────────────

const optionValues = (html, re) => [...html.matchAll(re)].map((m) => m[1]);

test('상담 유형 · 가구 종류 · 시간대: consultation.html · segan/consult.html 의 값과 같다', () => {
  const site = readRepo('consultation.html');
  assert.deepEqual(optionValues(site, /name="consultationType" value="([^"]+)"/g).sort(), Object.keys(TYPE_LABELS).sort());
  assert.deepEqual(optionValues(site, /name="furnitureCategory" value="([^"]+)"/g).sort(), Object.keys(FURNITURE_LABELS).sort());
  const siteTimes = optionValues(site.slice(site.indexOf('id="preferredTime"')), /<option value="([^"]+)">/g).slice(0, 4);
  assert.deepEqual(siteTimes, Object.keys(TIME_LABELS));
  const app = readRepo('segan/consult.html');
  const appTimes = optionValues(app.slice(app.indexOf('id="csTime"')), /<option value="([^"]*)">/g).filter(Boolean).slice(0, 4);
  assert.deepEqual(appTimes, Object.keys(TIME_LABELS));
  for (const [v, label] of Object.entries(TIME_LABELS)) assert.ok(site.includes(`<option value="${v}">${label}</option>`), label);
});

test('연출컷 품목: generate-api CATEGORIES 의 key · 이름과 같다', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(CATEGORIES).map(([k, c]) => [k, c.label])),
    { ...APP_KIND_LABELS },
  );
});

test('시/도 · 시/군/구: segan/regions.js 목록은 모두 통과하고 다른 글은 막힌다', () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readRepo('segan/regions.js'), sandbox);
  const R = sandbox.window.SeganRegions;
  assert.deepEqual(Object.keys(R), [...SIDO]);
  for (const [sido, list] of Object.entries(R)) {
    for (const gugun of list) assert.equal(regionLabel({ sido, gugun }), `${sido} ${gugun}`);
  }
  assert.equal(regionLabel({ sido: '서울', gugun: '강남구' }), '');
});
