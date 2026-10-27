/**
 * 결정 ★15 — 공장 작업자에게 가는 것(production-worker.html 의 /public/production/today, 작업자 Slack 채널)에는
 * 고객 실명·일당(금액)이 없다. 가린 이름(홍*동)과 주문번호로 주문을 알아본다.
 *   docs/01-plan/worker-portal.plan.md §9-7 · worker-access.js 머리 규칙 "금액(일당·비용)은 작업자 화면에 내보내지 않는다"
 * 대표 쪽(production.html · 제안 Slack · 월 요약)은 그대로 자세하다.
 * DB 는 PostgREST 경로별로 응답하는 가짜 fetch 로 대신한다 (reports.test.js 와 같은 방식).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyRoute } from './fixtures/company.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { buildJobs, summarizeMonth } from '../src/production/service.js';
import { planProduction } from '../src/production/planner.js';
import { workloadFromCounts } from '../src/production/workload.js';
import { assignmentsFromSuggestions, buildInstructionBlocks, buildProposalBlocks } from '../src/production/notify.js';
import { todaysWork } from '../src/production/worker-access.js';
import { orderLabel, workerOrderLabel, maskOrderLabel, workerAssignmentText } from '../src/production/redact.js';

// 시험용 가짜 고객·작업자 (실제 사람 아님)
const NAME = '홍길동';
const MASKED = '홍*동';
const NAME2 = '김고객';
const MASKED2 = '김*객';
// 금액 문구: "(일당 25만)", "25만", "250,000원"
const MONEY = /일당|\d[\d,.]*\s*(만|원)/;

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_ANON_KEY: 'anon', SHARE_TOKEN_PEPPER: 'test-pepper', CORS_ORIGINS: 'https://dadamfurniture.com' };
const U1 = '11111111-1111-4111-8111-111111111111';
const L1 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';
const O1 = '44444444-4444-4444-8444-444444444444';
const O2 = '55555555-5555-4555-8555-555555555555';
const D1 = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'test-worker-token-0123456789abcdef';

const SINK_3M = { sheetsPB: 5, sheetsBack: 2, edgeFaces: 112, boxes: 8, drawers: 2, doors: 11, shelves: 10, legs: 22, rods: 0 };
const SNAP = {
  id: 'snap1',
  bom_payload: { materials: [{ part: '측판', partId: '0-l1-body:side-0', material: 'PB', thickness: 15, w: 550, h: 708, qty: 2 }, { part: '도어', material: 'MDF', thickness: 18, w: 450, h: 700, qty: 2 }], hardware: [{ category: '다리발', qty: 4 }] },
  cut_plan_payload: { summary: { sheetsByMaterial: { PB_15: 1, 'MDF_2.7': 1 } } },
};
const ORDERS = [
  { id: O1, order_no: 'SO-1', customer_name: NAME, design_id: D1, snapshot_id: 'snap1', status: 'confirmed', ordered_at: '2026-10-12T00:00:00Z' },
  { id: O2, order_no: 'SO-2', customer_name: NAME2, design_id: D1, snapshot_id: 'missing', status: 'in_production', ordered_at: '2026-10-12T00:00:00Z' },
];

/**
 * 대표가 승인한 지시 행 — 진짜 계획기·지시 변환을 거친 문구 그대로 (주문 이름은 대표용 "고객명 (주문번호)").
 * 싱크대 12건을 한 주에 몰아 조립 인원 추가(일당 문구) · 주문별 도어 발주(실명 문구)가 생기게 한다.
 */
function approvedRows() {
  const jobs = [];
  for (let i = 0; i < 12; i++) jobs.push({ id: `s${i}`, label: `${NAME} (SO-${i + 1})`, orderedAt: '2026-10-13', installDate: '2026-10-20', work: workloadFromCounts(SINK_3M) });
  const plan = planProduction({ today: '2026-10-13', jobs });
  const jobLabels = Object.fromEntries(plan.jobs.map((j) => [j.id, j.label]));
  return assignmentsFromSuggestions(plan.suggestions, { userId: U1, proposalId: P1, jobLabels })
    .map((r, i) => ({ id: `a${i}`, ...r, done_at: null, created_at: '2026-10-13T00:00:00Z' }));
}

const json = (rows, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => rows, text: async () => JSON.stringify(rows) });

/** PostgREST 처럼 select 에 적은 열만 돌려준다 (select=* 이면 전부). */
function pick(rows, url) {
  const m = /[?&]select=([^&]*)/.exec(url);
  if (!m || m[1] === '*') return rows;
  const cols = m[1].split(',');
  return rows.map((r) => Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])));
}

async function withFetch(route, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method || 'GET' });
    const res = route(u, init.method || 'GET');
    if (!res) throw new Error(`unexpected fetch ${init.method || 'GET'} ${u}`);
    return res;
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function factoryDb({ assignments, logs }) {
  return (u, method) => {
    if (u.includes('/production_worker_links?') && method === 'GET') {
      return json([{ id: L1, user_id: U1, label: '재단 작업자', expires_at: '2099-01-01T00:00:00Z', revoked_at: null }]);
    }
    if (u.includes('/production_worker_links?') && method === 'PATCH') return json([{ id: L1 }]);
    if (u.includes('/production_settings?')) return json([]);
    if (companyRoute(u)) return companyRoute(u);
    if (u.includes('/designs?')) return json([{ id: D1 }]);
    if (u.includes('/orders?')) return json(ORDERS);
    if (u.includes('/design_snapshots?')) return json([SNAP]);
    if (u.includes('/design_schedules?')) return json([]);
    if (u.includes('/work_reports?')) return json([]);
    if (u.includes('/production_assignments?')) return json(pick(assignments, u));
    if (u.includes('/production_worklogs?')) return json(pick(logs, u));
    return null;
  };
}

test('작업자 화면 GET /public/production/today — 고객 실명·일당·비용이 없다, 가린 이름과 주문번호는 있다', async () => {
  const assignments = approvedRows();
  // 시험 고정값이 정말 새는 문구를 담고 있는지 (대표용 원문)
  assert.ok(assignments.some((a) => a.text.includes('일당')), '조립 인원 추가 지시에 일당 문구');
  assert.ok(assignments.some((a) => a.text.includes(NAME)), '주문별 지시에 고객 실명');
  // 오늘 이미 남긴 실측 기록 — 주문에 묶인 것은 예전 화면이 보낸 대표용 이름일 수 있다, 손으로 적은 것은 작업자 자신의 글
  const logs = [
    { id: 'l1', link_id: L1, role: 'cutter', order_id: O1, order_label: `${NAME} (SO-1)`, units: 3, minutes: 40, created_at: '2026-10-13T01:00:00Z' },
    { id: 'l2', link_id: L1, role: 'cutter', order_id: null, order_label: '추가 재단', units: 1, minutes: 10, created_at: '2026-10-13T02:00:00Z' },
  ];
  await withFetch(factoryDb({ assignments, logs }), async () => {
    const res = await worker.fetch(new Request('https://api.test/public/production/today', { headers: { 'X-Worker-Token': TOKEN, Origin: 'https://dadamfurniture.com' } }), ENV, { waitUntil() {} });
    assert.equal(res.status, 200);
    const body = await res.json();
    const data = body.data;
    const all = JSON.stringify(data);
    assert.ok(!all.includes(NAME), '고객 실명 없음');
    assert.ok(!all.includes(NAME2), '계획에서 빠진 주문도 실명 없음');
    assert.doesNotMatch(all, MONEY, '일당·금액 문구 없음');
    assert.ok(!/"cost"/.test(all), '비용 열 없음');
    assert.ok(data.assignments.every((a) => !('order_label' in a) && !('cost' in a)), '지시에는 원문 주문 이름·비용 열을 싣지 않는다');
    // 주문은 가린 이름 + 주문번호로 알아본다
    const cut = data.work.cutter.find((x) => x.orderId === O1);
    assert.equal(cut.label, `${MASKED} (SO-1)`);
    assert.deepEqual(data.skipped, [{ label: `${MASKED2} (SO-2)`, reason: 'BOM 없음' }]);
    const door = data.assignments.find((a) => a.kind === 'door_order');
    assert.ok(door.text.startsWith(`${MASKED} (SO-`), door.text);
    const extra = data.assignments.find((a) => a.kind === 'asm_extra');
    assert.match(extra.text, /조립 인원 \d+명 추가 — 조립 [\d.]+시간 초과$/);
    assert.deepEqual(Object.keys(extra).sort(), ['done_at', 'id', 'kind', 'role', 'status', 'text']);
    // 실측 기록: 주문에 묶인 이름은 가리고, 손으로 적은 글은 그대로
    assert.deepEqual(data.logs.map((l) => l.order_label), [`${MASKED} (SO-1)`, '추가 재단']);
  });
});

test('작업자 Slack 채널 지시 — 실명·일당 없이 가린 이름으로', () => {
  const rows = approvedRows().filter((r) => r.work_date);
  const msg = JSON.stringify(buildInstructionBlocks({ assignments: rows }));
  assert.ok(!msg.includes(NAME), '고객 실명 없음');
  assert.doesNotMatch(msg, MONEY, '일당·금액 문구 없음');
  assert.ok(msg.includes(`${MASKED} (SO-`), '가린 이름 + 주문번호');
  assert.ok(msg.includes('조립 인원'), '지시 내용은 그대로');
});

test('작업자 할 일(todaysWork) — 실제 수주에서 만든 계획의 주문 이름은 가린 이름', () => {
  const { jobs } = buildJobs(ORDERS, new Map([['snap1', SNAP]]), []);
  const plan = planProduction({ today: '2026-10-13', jobs });
  const w = todaysWork(plan, '2026-10-13');
  const labels = [...w.cutter, ...w.edge, ...w.asm].map((x) => x.label);
  assert.ok(labels.length > 0);
  assert.ok(labels.every((l) => l === `${MASKED} (SO-1)`), labels.join(', '));
});

test('redact: 주문 이름 가리기 · 저장된 지시 문구 깎기', () => {
  const o = { customer_name: NAME, order_no: 'SO-1' };
  assert.equal(orderLabel(o), `${NAME} (SO-1)`);
  assert.equal(workerOrderLabel(o), `${MASKED} (SO-1)`);
  assert.equal(workerOrderLabel({ order_no: 'SO-9' }), 'SO-9');
  // 저장된 대표용 이름 → 작업자용. 주문번호만이면 그대로, 이미 가린 것은 다시 가려도 같다
  assert.equal(maskOrderLabel(orderLabel(o)), workerOrderLabel(o));
  assert.equal(maskOrderLabel('SO-9'), 'SO-9');
  assert.equal(maskOrderLabel(`${MASKED} (SO-1)`), `${MASKED} (SO-1)`);
  assert.equal(maskOrderLabel('이수 (SO-3)'), '이* (SO-3)');
  assert.equal(maskOrderLabel(null), '');
  // 지시 문구: 이름이 여러 번 나와도 모두 가리고, 일당 괄호만 뺀다 (다른 괄호는 그대로)
  assert.equal(
    workerAssignmentText({ order_label: `${NAME} (SO-1)`, text: `${NAME} (SO-1): 도어 외주 발주 10/14(수)까지 (이미 늦음 — ${NAME} (SO-1))` }),
    `${MASKED} (SO-1): 도어 외주 발주 10/14(수)까지 (이미 늦음 — ${MASKED} (SO-1))`,
  );
  assert.equal(workerAssignmentText({ text: '10/20(화) 조립 인원 1명 추가 — 조립 2.5시간 초과 (일당 25만)' }), '10/20(화) 조립 인원 1명 추가 — 조립 2.5시간 초과');
  assert.equal(workerAssignmentText({ order_label: 'SO-9', text: 'SO-9: 상판 발주 10/15(목)까지 (설치 4근무일 전)' }), 'SO-9: 상판 발주 10/15(목)까지 (설치 4근무일 전)');
  assert.equal(workerAssignmentText(null), '');
});

test('대표 쪽은 그대로 — 계획 주문 이름은 실명, 제안 문구는 일당, 월 요약은 실명', () => {
  const { jobs, skipped } = buildJobs(ORDERS, new Map([['snap1', SNAP]]), []);
  assert.equal(jobs[0].label, `${NAME} (SO-1)`);
  assert.equal(skipped[0].label, NAME2);
  const many = [];
  for (let i = 0; i < 12; i++) many.push({ id: `s${i}`, label: `${NAME} (SO-${i + 1})`, orderedAt: '2026-10-13', installDate: '2026-10-20', work: workloadFromCounts(SINK_3M) });
  const plan = planProduction({ today: '2026-10-13', jobs: many });
  const proposal = JSON.stringify(buildProposalBlocks({ plan, link: null }));
  assert.match(proposal, /일당 \d+만/);
  assert.ok(proposal.includes(NAME));
  const month = summarizeMonth([{ ...ORDERS[0], ordered_at: '2026-10-12T00:00:00Z', contract_amount: 1100000 }], new Map(), { month: '2026-10', overheadMonthly: 0 });
  assert.equal(month.rows[0].label, `${NAME} (SO-1)`);
});

test('공장 작업자 화면 "다른 작업 기록" 예시 — 고객 이름 대신 주문번호(orders.js buildOrderNo 모양) + 품목 (1주차 후속 F)', () => {
  const html = readFileSync(fileURLToPath(new URL('../../../production-worker.html', import.meta.url)), 'utf8');
  const m = /<input id="freeLabel" placeholder="([^"]*)"/.exec(html);
  assert.ok(m, 'freeLabel 입력칸');
  assert.match(m[1], /^예: SO-\d{8}-[0-9A-F]{4} 싱크대 /, '주문번호 SO-YYYYMMDD-XXXX + 품목');
  // 어떤 예시 문구도 사람 이름(김OO 등)을 적게 유도하지 않는다
  const placeholders = [...html.matchAll(/placeholder="([^"]*)"/g)].map((x) => x[1]);
  for (const p of placeholders) assert.doesNotMatch(p, /[가-힣]O{2}|[가-힣]○○|고객/, p);
});
