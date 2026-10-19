/**
 * 관리자 「경영 대시보드」 (admin/management.html) — 1단계: 맨 위 이익 식 · 재무 줄.
 * Claude 프로젝트 문서 "다담 경영 대시보드" 의 PR-1.
 * 페이지 스크립트를 jsdom 에 그대로 올리고 workflow-api 는 가짜 fetch 로 대신한다.
 * 숫자는 workers/workflow-api/test/management.test.js 의 손계산 예와 같은 묶음이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'admin/management.html'), 'utf8');
const SCRIPT = HTML.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
const BODY = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script>\n      (function'));
const API = 'https://api.test';

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 15; i++) await flush(); }

const SUMMARY = {
  month: '2026-10',
  prevMonth: '2026-09',
  tree: {
    leads: { value: 3, prev: 1 },
    conversion: { value: 25, prev: 100 },
    issued: { value: 4, prev: 1 },
    approved: { value: 1, prev: 1 },
    pending: 1,
    orders: { value: 3, prev: 1 },
    avgContract: { value: 1366667, prev: 3000000 },
    revenue: { value: 4100000, prev: 3000000 },
    cmRate: { value: 22.6, prev: 53.3 },
    contribution: { value: 700000, prev: 1600000 },
    overhead: 2000000,
    net: { value: -1300000, prev: -400000 },
    unknownCost: 1,
  },
  breakEven: { overhead: 2000000, cmRate: 22.6, revenueNeeded: 8857143, progress: 46.3, gap: 4757143, safety: 0 },
  channels: [
    { tier: 'customer', label: '직판', orders: 2, revenue: 3000000, contribution: 600000, cmRate: 30, factoryHours: 2, perHour: 300000 },
    { tier: 'partner', label: '거래처<img src=x onerror=alert(1)>', orders: 1, revenue: 1100000, contribution: 100000, cmRate: 9.1, factoryHours: 3, perHour: 33333 },
  ],
  basis: { revenue: 'VAT 제외 계약금', cost: '확인서 견적 원가 (고정비 회수분 제외)', overhead: 2000000, settingsSource: 'latest' },
  funnel: {
    leads: 3, issued: 4, viewed: 3, approved: 1, ordered: 1, rejected: 1, pending: 1,
    conversion: 25, viewRate: 75, orderRate: 100, avgRevisions: 1.3, medianHoursToView: 6, medianDaysToDecide: 3.5,
    // 워커 시험(management.test.js 2단계 PR-5) 의 손계산 결과 그대로
    reasons: { requests: 4, noReason: 1, codes: [{ code: 'price', label: '금액', count: 3, share: 75 }, { code: 'dimension', label: '치수', count: 1, share: 25 }, { code: 'layout', label: '배치 · 구성', count: 1, share: 25 }] },
  },
  platform: {
    value: { generations: 3, failed: 1, failRate: 25, people: 2, consultedPeople: 1, designs: 2, confirmed: 1, ordered: 1 },
    prev: { generations: 1, failed: 0, failRate: 0, people: 1, consultedPeople: 0, designs: 1, confirmed: 1, ordered: 1 },
  },
  // 워커 시험(management.test.js PR-3) 의 손계산 결과 그대로
  process: {
    variance: {
      orders: 2,
      recorded: 2,
      categories: [
        { category: 'material', label: '자재', orders: 1, estimate: 515000, actual: 560000, diff: 45000, diffRate: 8.7 },
        { category: 'hardware', label: '부자재', orders: 1, estimate: 40000, actual: 30000, diff: -10000, diffRate: -25 },
        { category: 'outsourcing', label: '외주', orders: 1, estimate: 920000, actual: 950000, diff: 30000, diffRate: 3.3 },
      ],
      totals: { estimate: 1475000, actual: 1540000, diff: 65000, diffRate: 4.4 },
      top: [
        { id: 'P1', label: 'P고객 (SO-11)', estimate: 1435000, actual: 1510000, diff: 75000, diffRate: 5.2, worst: { category: 'material', label: '자재', diff: 45000 } },
        { id: 'P2', label: 'SO-12', estimate: 40000, actual: 30000, diff: -10000, diffRate: -25, worst: { category: 'hardware', label: '부자재', diff: -10000 } },
      ],
    },
    time: [
      { role: 'cutter', label: '재단', orders: 1, estimateMin: 70, actualMin: 80, diffRate: 14.3 },
      { role: 'edge', label: '엣지', orders: 1, estimateMin: 15, actualMin: 20, diffRate: 33.3 },
      { role: 'asm', label: '조립', orders: 1, estimateMin: 100, actualMin: 90, diffRate: -10 },
    ],
    load: {
      workdays: 21,
      bottleneck: 'asm',
      roles: [
        { role: 'cutter', label: '재단', people: 1, capacityHours: 142.8, receivedHours: 1.8, doneHours: 1.3, load: 1.3, doneLoad: 0.9 },
        { role: 'edge', label: '엣지', people: 1, capacityHours: 142.8, receivedHours: 0.8, doneHours: 1.3, load: 0.5, doneLoad: 0.9 },
        { role: 'asm', label: '조립', people: 1, capacityHours: 142.8, receivedHours: 2.5, doneHours: 1.5, load: 1.8, doneLoad: 1.1 },
      ],
    },
    throughput: {
      role: 'asm',
      label: '조립',
      rows: [
        { id: 'P1', label: 'P고객 (SO-11)', throughput: 1485000, minutes: 100, perMin: 14850 },
        { id: 'P2', label: 'SO-12', throughput: 430000, minutes: 50, perMin: 8600 },
      ],
      avgPerMin: 12767,
    },
  },
  // 워커 시험(okrs.test.js 3단계 PR-13) 의 손계산 결과 그대로
  okrs: {
    quarter: '2026-Q4',
    elapsed: 22.8,
    items: [
      { id: 'a', objective: '가을 성수기 매출', metric: 'revenue_q', label: '분기 매출 (VAT 제외)', unit: 'won', target: 30000000, current: 3000000, direction: 'up', cumulative: true, progress: 10, status: 'behind', manual_value: null },
      { id: 'b', objective: '수주 8건', metric: 'orders_q', label: '분기 수주 건수', unit: 'count', target: 8, current: 2, direction: 'up', cumulative: true, progress: 25, status: 'on_track', manual_value: null },
      { id: 'c', objective: 'A/S 줄이기', metric: 'as_rate', label: 'A/S 율 (반년)', unit: 'pct', target: 5, current: 4, direction: 'down', cumulative: false, progress: 100, status: 'done', manual_value: null },
      { id: 'e', objective: '쇼룸 열기', metric: 'manual', label: '직접 적기', unit: 'number', target: 3, current: null, direction: 'up', cumulative: false, progress: null, status: null, manual_value: null },
    ],
    metrics: [
      { key: 'revenue_q', label: '분기 매출 (VAT 제외)', unit: 'won', direction: 'up' },
      { key: 'orders_q', label: '분기 수주 건수', unit: 'count', direction: 'up' },
      { key: 'as_rate', label: 'A/S 율 (반년)', unit: 'pct', direction: 'down' },
      { key: 'manual', label: '직접 적기', unit: 'number', direction: 'up' },
    ],
  },
  // 워커 시험(forecast.test.js 3단계 PR-12) 의 손계산 결과 그대로
  forecast: {
    needSql: false,
    today: '2026-10-21',
    months: [
      ['2025-10', 60], ['2025-11', 60], ['2025-12', 40], ['2026-01', 20], ['2026-02', 20], ['2026-03', 30],
      ['2026-04', 40], ['2026-05', 40], ['2026-06', 30], ['2026-07', 20], ['2026-08', 20], ['2026-09', 40],
    ].map(([month, r]) => ({ month, revenue: r * 1000000, source: 'manual' })).concat([{ month: '2026-10', revenue: 15000000, source: 'system', partial: true }]),
    coverage: 12,
    minMonths: 12,
    ready: true,
    index: [0.57, 0.57, 0.86, 1.14, 1.14, 0.86, 0.57, 0.57, 1.14, 1.71, 1.71, 1.14].map((value, i) => ({ m: i + 1, value })),
    peak: { m: 10, value: 1.71 },
    low: { m: 1, value: 0.57 },
    base: 35000000,
    next: [
      { month: '2026-10', index: 1.71, forecast: 59850000 },
      { month: '2026-11', index: 1.71, forecast: 59850000 },
      { month: '2026-12', index: 1.14, forecast: 39900000 },
    ],
    pipeline: { pending: 2, conversion: 33.3, avgContract: 5333333, expected: 3555555 },
  },
  // 워커 시험(sheet-yield.test.js 3단계 PR-11) 의 손계산 결과 그대로
  sheetYield: {
    window: { days: 180, start: '2026-04-25', end: '2026-10-21' },
    orders: 2, planned: 18, actual: 19, diffRate: 5.6, costDiff: 30264,
    yieldNow: 0.8, impliedYield: 0.76, suggestYield: null, minOrders: 5,
    top: [
      { id: 'Y1', label: '이고객 (SO-21)', planned: 8, actual: 9, diffRate: 12.5 },
      { id: 'Y2', label: 'SO-22', planned: 10, actual: 10, diffRate: 0 },
    ],
  },
  // 워커 시험(leadtime.test.js 3단계 PR-10) 의 손계산 결과 그대로
  leadTime: {
    window: { days: 180, start: '2026-04-25', end: '2026-10-21' },
    orders: 2,
    totalMedianDays: 21.2,
    stages: [
      { key: 'measure', label: '수주 → 실측', n: 2, medianDays: 3 },
      { key: 'start', label: '실측 → 제작 착수', n: 2, medianDays: 5 },
      { key: 'make', label: '제작', n: 2, medianDays: 6 },
      { key: 'install', label: '제작 완료 → 설치', n: 2, medianDays: 7.2 },
    ],
    slowest: { key: 'install', label: '제작 완료 → 설치', medianDays: 7.2 },
    install: { done: 2, onTime: 1, onTimeRate: 50, avgLateDays: 3, rescheduled: 1, overdue: 1 },
  },
  // 워커 시험(cashflow.test.js 2단계 PR-9) 의 손계산 결과 그대로 (13주 중 앞 다섯 · 마지막)
  cashflow: {
    start: '2026-10-19', end: '2027-01-17', today: '2026-10-21',
    opening: { amount: 10000000, as_of: '2026-10-20', days: 1, stale: false },
    weeks: [
      { start: '2026-10-19', end: '2026-10-25', inflow: 4500000, outflow: 2348462, net: 2151538, balance: 12151538 },
      { start: '2026-10-26', end: '2026-11-01', inflow: 0, outflow: 1928462, net: -1928462, balance: 10223076 },
      { start: '2026-11-02', end: '2026-11-08', inflow: 5500000, outflow: 1428462, net: 4071538, balance: 14294614 },
      { start: '2026-11-09', end: '2026-11-15', inflow: 0, outflow: 1428462, net: -1428462, balance: 12866152 },
      { start: '2026-11-16', end: '2026-11-22', inflow: 4400000, outflow: 1428462, net: 2971538, balance: 15837690 },
      { start: '2026-11-23', end: '2026-11-29', inflow: 0, outflow: 1428462, net: -1428462, balance: 14409228 },
      { start: '2026-11-30', end: '2026-12-06', inflow: 0, outflow: 1428462, net: -1428462, balance: 12980766 },
      { start: '2026-12-07', end: '2026-12-13', inflow: 0, outflow: 1428462, net: -1428462, balance: 11552304 },
      { start: '2026-12-14', end: '2026-12-20', inflow: 0, outflow: 1428462, net: -1428462, balance: 10123842 },
      { start: '2026-12-21', end: '2026-12-27', inflow: 0, outflow: 1428462, net: -1428462, balance: 8695380 },
      { start: '2026-12-28', end: '2027-01-03', inflow: 0, outflow: 1428462, net: -1428462, balance: 7266918 },
      { start: '2027-01-04', end: '2027-01-10', inflow: 0, outflow: 1428462, net: -1428462, balance: 5838456 },
      { start: '2027-01-11', end: '2027-01-17', inflow: 0, outflow: 1428462, net: -1428462, balance: 4409994 },
    ],
    weeklyOverhead: 1428462,
    overdueIn: 4500000, overdueOut: 920000, laterIn: 100000, laterOut: 300000,
    unscheduledIn: 1300000, unscheduledOrders: 2,
    lowest: { week: 12, start: '2027-01-11', balance: 4409994 },
    firstNegative: null,
  },
  aging: {
    overdue: 4500000,
    notDue: 11300000,
    buckets: [
      { key: '0-30', label: '30일 이내', amount: 3300000, count: 1 },
      { key: '31-60', label: '31~60일', amount: 0, count: 0 },
      { key: '61-90', label: '61~90일', amount: 1200000, count: 1 },
      { key: '90+', label: '90일 넘음', amount: 0, count: 0 },
    ],
    top: [
      { order_id: 'C', label: '최고객 (SO-3)', stage: null, amount: 1200000, days: 81 },
      { order_id: 'A', label: 'SO-1', stage: 'interim', amount: 3300000, days: 11 },
    ],
  },
  // 워커 시험(counterparties.test.js 2단계 PR-8) 의 손계산 결과 그대로
  partners: {
    window: { days: 365, start: '2025-11-01', end: '2026-10-31' },
    partners: 2,
    revenue: 7000000,
    rows: [
      { id: 'pA', name: '한빛인테리어', orders: 2, revenue: 6000000, contribution: 1000000, cmRate: 25, share: 85.7, cumShare: 85.7 },
      { id: 'pB', name: '다온디자인', orders: 1, revenue: 1000000, contribution: 100000, cmRate: 10, share: 14.3, cumShare: 100 },
    ],
    top20: { count: 1, share: 85.7 },
    unassigned: 1,
  },
  suppliers: {
    window: { days: 365, start: '2025-10-20', end: '2026-10-19' },
    suppliers: 2,
    rows: [
      { id: 'sDoor', name: '상일', category: 'door', spend: 1380000, costRows: 2, orders: 4, onTimeRate: 50, dated: 2, avgLateDays: 3, overdue: 1 },
      { id: null, name: '일성합판', category: null, spend: 0, costRows: 0, orders: 1, onTimeRate: null, dated: 0, avgLateDays: null, overdue: 0 },
    ],
  },
  // 워커 시험(feedback.test.js 2단계 PR-7) 의 손계산 결과 그대로
  referral: {
    window: { days: 180, start: '2026-05-05', end: '2026-10-31' },
    sent: 5, answered: 4, responseRate: 80, promoters: 2, passives: 1, detractors: 1, nps: 25, avg: 8.3, thisMonth: 3,
    dist: [0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1],
  },
  // 워커 시험(rework.test.js 2단계 PR-6) 의 손계산 결과 그대로
  quality: {
    month: {
      rework: 2, as: 1, minutes: 210, cost: 30000, laborWon: 87500, total: 117500,
      causes: [{ cause: 'cutting', label: '재단', count: 2, won: 67500 }, { cause: 'install', label: '설치', count: 1, won: 50000 }],
    },
    window: { days: 180, start: '2026-05-05', end: '2026-10-31', installed: 3, withAs: 2, asRate: 66.7 },
    hourly: 25000,
  },
  // 워커 시험(management.test.js PR-4) 의 바탕 — 알바 시급 12,000 × 8시간 × 22일
  scenario: {
    orders: 3,
    revenueCustomer: 3000000,
    revenuePartner: 1000000,
    revenueUnknown: 1000000,
    material: 745000,
    hardware: 120000,
    door: 800000,
    doorSheets: 8,
    outsourcing: 420000,
    labor: 215000,
    overheadAlloc: 0,
    overheadMonthly: 6190000,
    marginRate: 0.2,
    partnerMarginRate: 0.1,
    partTimeMonthly: 2112000,
  },
};

function fakeApi({ admin = true, data = SUMMARY, status = 200 } = {}) {
  const calls = [];
  const fetchFn = jest.fn(async (url, init = {}) => {
    const u = String(url).replace(API, '');
    calls.push(u);
    if (u.startsWith('/management/okrs')) {
      calls.push({ okr: { path: u, method: init.method, body: init.body ? JSON.parse(init.body) : null } });
      return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) };
    }
    if (u === '/management/sales-history') {
      calls.push({ put: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ success: true, data: { saved: 2, removed: 22 } }) };
    }
    if (u === '/management/cash-balance') {
      calls.push({ post: JSON.parse(init.body) });
      return { ok: true, status: 201, json: async () => ({ success: true, data: { id: 'B1' } }) };
    }
    if (u.startsWith('/management/summary') && status === 200) {
      return { ok: true, status: 200, json: async () => ({ success: true, data }) };
    }
    return { ok: false, status, json: async () => ({ success: false, message: '경영 대시보드는 관리자만 볼 수 있습니다' }) };
  });
  return { fetchFn, calls, admin };
}

function boot(api) {
  document.body.innerHTML = BODY;
  window.DADAM_CONFIG = { supabase: { url: 'https://sb', anonKey: 'k' }, workflowApi: { url: API } };
  window.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'T', user: { email: 'a@b.c' } } } }) } }) };
  window.AdminAccess = { isAdmin: async () => api.admin };
  window.__MANAGEMENT_NO_AUTOSTART = true;
  global.fetch = api.fetchFn;
  (0, eval)(SCRIPT);
}

const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();

describe('경영 대시보드 — 들어오기', () => {
  test('관리자 게이트는 정본(AdminAccess)을 쓴다', () => {
    expect(HTML).toMatch(/<script src="\.\.\/js\/admin-access\.js"><\/script>/);
    expect(HTML).toMatch(/window\.AdminAccess\.isAdmin\(state\.sb\)/);
    expect(HTML).toMatch(/noindex, nofollow, noarchive/);
  });

  test('관리자가 아니면 접근 거부 — 서버를 부르지도 않는다', async () => {
    const api = fakeApi({ admin: false });
    boot(api);
    await window.Management.init();
    expect(document.getElementById('accessDenied').style.display).toBe('block');
    expect(api.calls).toHaveLength(0);
  });

  test('관리자는 이번 달(KST) 요약을 부른다', async () => {
    const api = fakeApi();
    boot(api);
    await window.Management.init();
    await settle();
    expect(api.calls[0]).toMatch(/^\/management\/summary\?month=\d{4}-\d{2}$/);
    expect(document.getElementById('fMonth').value).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('맨 위 이익 식', () => {
  test('수주 × 평균 계약금 × 공헌이익률 − 고정비 = 순이익, 칸마다 지난 달', async () => {
    const api = fakeApi();
    boot(api);
    await window.Management.init();
    await settle();
    // 칸마다 이름 · 값 · 지난 달 — 각각 따로 읽는다 (화면에선 세 줄이다)
    const cells = [...document.querySelectorAll('#tree .eq .cell')].map((c) => [
      c.querySelector('label').textContent, c.querySelector('b').textContent, c.querySelector('small').textContent,
    ]);
    expect(cells).toEqual([
      ['수주', '3건', '지난 달 1건'],
      ['평균 계약금 (VAT 제외)', '137만', '지난 달 300만'],
      ['공헌이익률', '22.6%', '지난 달 53.3%'],
      ['월 고정비', '200만', '생산 설정 값'],
      ['월 순이익', '-130만', '지난 달 -40만'],
    ]);
    expect(document.querySelector('#tree .cell.result').classList.contains('neg')).toBe(true);
    expect(document.querySelectorAll('#tree .eq .op')).toHaveLength(4);
  });

  test('매출 · 공헌이익, 수주 앞단(상담 · 확인서 전환), 원가 없는 수주 경고', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    const foot = text('tree');
    expect(foot).toMatch(/2026년 10월 — 이익 식/);
    expect(foot).toMatch(/매출 410만 \(수주 × 평균 계약금\) · 공헌이익 70만 \(매출 × 공헌이익률\)/);
    expect(foot).toMatch(/상담 3건 · 확인서 4건 발행 → 1건 승인 \(전환 25%\) · 결정 대기 1건/);
    expect(foot).toMatch(/견적 원가가 없는 수주 1건은 공헌이익 · 손익분기에서 빠졌습니다/);
  });
});

describe('재무 줄', () => {
  test('손익분기: 막대 46.3% · 더 받아야 할 매출 476만', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.querySelector('.bep-bar i').style.width).toBe('46.3%');
    expect(document.querySelector('.bep-bar i').classList.contains('over')).toBe(false);
    const nums = [...document.querySelectorAll('.bep-nums div')].map((d) => [d.firstChild.textContent.trim(), d.querySelector('b').textContent]);
    expect(nums).toEqual([['손익분기 매출', '886만'], ['이달 매출', '410만'], ['달성률', '46.3%'], ['공헌이익률', '22.6%']]);
    expect(text('bepBody')).toMatch(/손익분기까지 매출 476만을 더 받아야 합니다/);
  });

  test('손익분기를 넘은 달은 안전한계율을 말한다', async () => {
    const data = { ...SUMMARY, breakEven: { overhead: 1000000, cmRate: 50, revenueNeeded: 2000000, progress: 250, gap: 0, safety: 60 } };
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.querySelector('.bep-bar i').style.width).toBe('100%');
    expect(document.querySelector('.bep-bar i').classList.contains('over')).toBe(true);
    expect(text('bepBody')).toMatch(/매출이 60% 줄어도 손해가 아닙니다/);
  });

  test('공헌이익률이 없으면 손익분기를 지어내지 않는다', async () => {
    const data = { ...SUMMARY, breakEven: { overhead: 2000000, cmRate: null, revenueNeeded: null, progress: null, gap: null, safety: null } };
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.querySelector('.bep-bar')).toBeNull();
    expect(text('bepBody')).toMatch(/손익분기를 계산하지 않았습니다/);
  });

  test('채널: 직판 · 거래처 한 줄씩, 1시간당 공헌이익 — 이름은 이스케이프', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    const rows = [...document.querySelectorAll('#channelBody tbody tr')].map((r) => [...r.cells].map((c) => c.textContent.trim()));
    expect(rows[0]).toEqual(['직판', '2건', '300만', '60만', '30%', '2시간', '300,000원']);
    expect(rows[1].slice(1)).toEqual(['1건', '110만', '10만', '9.1%', '3시간', '33,333원']);
    expect(document.getElementById('channelBody').innerHTML).not.toMatch(/<img/);
    expect(rows[1][0]).toBe('거래처<img src=x onerror=alert(1)>');
    // 막대는 시간당이 큰 쪽이 길다
    const bars = [...document.querySelectorAll('#channelBody .hbar')].map((b) => parseInt(b.style.width, 10));
    expect(bars[0]).toBeGreaterThan(bars[1]);
  });

  test('근거 줄: 월 고정비의 출처를 밝힌다', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(text('basis')).toMatch(/월 고정비 200만: 가장 최근에 저장된 생산 설정/);
    expect(document.querySelector('#basis a').getAttribute('href')).toBe('../production.html');
  });
});

describe('달 바꾸기 · 오류', () => {
  test('달을 바꾸면 그 달로 다시 부른다', async () => {
    const api = fakeApi();
    boot(api);
    await window.Management.init();
    await settle();
    const input = document.getElementById('fMonth');
    input.value = '2026-08';
    input.dispatchEvent(new window.Event('change'));
    await settle();
    expect(api.calls.pop()).toBe('/management/summary?month=2026-08');
  });

  test('서버가 거절하면 그 이유를 보여 준다', async () => {
    boot(fakeApi({ status: 403 }));
    await window.Management.init();
    await settle();
    expect(text('statusLine')).toBe('경영 대시보드는 관리자만 볼 수 있습니다');
  });
});

describe('고객 줄 (PR-2)', () => {
  const stages = (id) => [...document.querySelectorAll(`#${id} .stage`)].map((r) => [...r.children].map((c) => c.textContent.trim()));

  test('영업 퍼널: 발행 → 열람 → 승인 → 수주, 발행 대비 비율 · 막대', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowCustomer').hidden).toBe(false);
    expect(stages('funnelBody').map((r) => [r[0], r[2], r[3]])).toEqual([
      ['발행', '4건', '100%'], ['열람', '3건', '75%'], ['승인', '1건', '25%'], ['수주', '1건', '25%'],
    ]);
    expect(document.querySelector('#funnelBody .stage:nth-child(3) .fill').style.width).toBe('75%');
    const body = text('funnelBody');
    expect(body).toMatch(/이달 상담 신청 3건/);
    expect(body).toMatch(/확인서 평균 수정 1.3회/);
    expect(body).toMatch(/첫 열람까지 중간 6시간/);
    expect(body).toMatch(/결정까지 중간 3.5일/);
    expect(body).toMatch(/결정 대기 1건 · 거절 1건/);
  });

  test('AI 플랫폼: 연출컷 → 설계 → 확인서 → 수주, 사람 · 실패 · 지난 달', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(stages('platformBody').map((r) => [r[0], r[2], r[3]])).toEqual([
      ['연출컷', '3건', '100%'], ['설계', '2건', '66.7%'], ['확인서', '1건', '33.3%'], ['수주', '1건', '33.3%'],
    ]);
    const body = text('platformBody');
    expect(body).toMatch(/연출컷 만든 사람 2명 · 그중 상담 신청 1명/);
    expect(body).toMatch(/만들다 실패 1건 \(25%\)/);
    expect(body).toMatch(/지난 달 연출컷 1건 → 수주 1건/);
  });

  test('비어 있는 달 · 못 읽은 기록은 지어내지 않고 말한다', async () => {
    const data = { ...SUMMARY, funnel: { ...SUMMARY.funnel, issued: 0, leads: null }, platform: { value: null, prev: null } };
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(text('funnelBody')).toMatch(/상담 기록을 읽지 못했습니다/);
    expect(text('funnelBody')).toMatch(/이달 처음 나간 확인서가 없습니다/);
    expect(text('platformBody')).toBe('연출컷 기록을 읽지 못했습니다.');
  });

  test('막대는 블록이어야 그려진다 — span 에 너비만 주면 jsdom 에선 통과해도 화면엔 빈 막대다', () => {
    // jsdom 은 배치를 계산하지 않는다. 실제로 막대가 비어 보였던 것을 CSS 로 못박는다.
    expect(HTML).toMatch(/\.stage \.track \{ display: block;/);
    expect(HTML).toMatch(/\.stage \.fill \{ display: block;/);
    expect(HTML).toMatch(/\[hidden\] \{ display: none !important; \}/);
  });

  test('워커가 아직 옛 판이면(퍼널이 없으면) 고객 줄을 숨긴다', async () => {
    const data = { ...SUMMARY };
    delete data.funnel;
    delete data.platform;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowCustomer').hidden).toBe(true);
    expect(text('tree')).toMatch(/이익 식/); // 나머지는 그대로 그린다
  });
});

describe('공정 줄 (PR-3)', () => {
  const rows = (id) => [...document.querySelectorAll(`#${id} tbody tr`)].map((r) => [...r.cells].map((c) => c.textContent.trim()));

  test('견적 대비 실적(돈): 범주별 견적 · 실적 · 차이, 더 나가면 빨강 · 덜 나가면 초록', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowProcess').hidden).toBe(false);
    expect(rows('tblVarianceCat')).toEqual([
      ['자재', '1건', '52만', '56만', '+5만 (+8.7%)'],
      ['부자재', '1건', '4만', '3만', '-1만 (-25%)'],
      ['외주', '1건', '92만', '95만', '+3만 (+3.3%)'],
    ]);
    const cells = document.querySelectorAll('#tblVarianceCat tbody tr td:last-child span');
    expect(cells[0].className).toBe('up');
    expect(cells[1].className).toBe('down');
    expect(text('varianceBody')).toMatch(/실적을 넣은 수주 2건 \/ 2건 · 견적 148만 → 실적 154만 \+7만 \(\+4.4%\)/);
    expect(rows('tblVarianceTop')).toEqual([
      ['P고객 (SO-11)', '+8만 (+5.2%)', '자재'],
      ['SO-12', '-1만 (-25%)', '부자재'],
    ]);
  });

  test('견적 대비 실적(시간): 공정별 예상 분 대 실측 분', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(rows('tblVarianceTime')).toEqual([
      ['재단', '1건', '70분', '80분', '+14.3%'],
      ['엣지', '1건', '15분', '20분', '+33.3%'],
      ['조립', '1건', '100분', '90분', '-10%'],
    ]);
  });

  test('실적도 실측도 없으면 어디서 넣는지 알려 준다', async () => {
    const process = { ...SUMMARY.process, variance: { orders: 3, recorded: 0, categories: [], totals: { estimate: 0, actual: 0, diff: 0, diffRate: null }, top: [] }, time: SUMMARY.process.time.map((x) => ({ ...x, orders: 0 })) };
    boot(fakeApi({ data: { ...SUMMARY, process } }));
    await window.Management.init();
    await settle();
    expect(text('varianceBody')).toMatch(/이달 수주 3건 중 실적 원가도 작업 실측도 없습니다/);
    expect(document.querySelector('#varianceBody a').getAttribute('href')).toBe('../erp.html');
  });

  test('병목: 받은 일 비율이 가장 높은 공정에 꼬리표, 막대는 능력 대비', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    const loads = [...document.querySelectorAll('#bottleneckBody .load')];
    expect(loads.map((l) => l.dataset.role)).toEqual(['cutter', 'edge', 'asm']);
    expect(loads.map((l) => l.querySelector('.fill').style.width)).toEqual(['1.3%', '0.5%', '1.8%']);
    expect(loads[2].querySelector('.tag').textContent).toBe('병목');
    expect(loads[0].querySelector('.tag')).toBeNull();
    expect(loads[2].querySelector('.v').textContent.replace(/\s+/g, ' ')).toMatch(/1.8%받은 2.5시간 \/ 142.8시간한 일 1.5시간/);
    expect(text('bottleneckBody')).toMatch(/근무일 21일/);
  });

  test('부하가 85% 를 넘으면 주황, 100% 를 넘으면 빨강', async () => {
    const roles = SUMMARY.process.load.roles.map((r, i) => ({ ...r, load: [86, 104, 40][i] }));
    boot(fakeApi({ data: { ...SUMMARY, process: { ...SUMMARY.process, load: { ...SUMMARY.process.load, roles, bottleneck: 'edge' } } } }));
    await window.Management.init();
    await settle();
    const fills = [...document.querySelectorAll('#bottleneckBody .load .fill')];
    expect(fills.map((f) => f.className.trim())).toEqual(['fill warn', 'fill full', 'fill']);
    expect(fills[1].style.width).toBe('100%'); // 막대는 100% 에서 멈춘다 — 숫자는 104%
  });

  test('처리량: 병목(조립) 1분당 — 평균과 큰 순 다섯', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(text('bottleneckBody')).toMatch(/조립 1분당 처리량 — 평균 12,767원/);
    expect(rows('tblThroughput')).toEqual([
      ['P고객 (SO-11)', '149만', '100분', '14,850원'],
      ['SO-12', '43만', '50분', '8,600원'],
    ]);
  });

  test('부하 막대도 블록이어야 그려진다', () => {
    expect(HTML).toMatch(/\.load \.track \{ display: block;/);
    expect(HTML).toMatch(/\.load \.fill \{ display: block;/);
  });

  test('워커가 아직 옛 판이면(공정이 없으면) 공정 줄을 숨긴다', async () => {
    const data = { ...SUMMARY };
    delete data.process;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowProcess').hidden).toBe(true);
    expect(document.getElementById('rowCustomer').hidden).toBe(false);
  });
});

describe('만약에 판 (PR-4)', () => {
  const row = (k) => [...document.querySelector(`#tblWhatIf tr[data-k="${k}"]`).cells].map((c) => c.textContent.trim());
  const setLever = (id, v) => {
    const el = document.getElementById(id);
    el.value = String(v);
    el.dispatchEvent(new window.Event('input'));
  };
  const open = async (data) => {
    boot(fakeApi(data ? { data } : undefined));
    await window.Management.init();
    await settle();
  };

  test('레버를 그대로 두면 맨 위 이익 식과 같다 — 공헌이익 170만 · 순이익 -449만', async () => {
    await open();
    expect(document.getElementById('rowWhatIf').hidden).toBe(false);
    expect(row('revenue')).toEqual(['매출 (VAT 제외)', '500만', '500만', '0']);
    expect(row('contribution')).toEqual(['공헌이익', '170만', '170만', '0']);
    expect(row('cmRate')).toEqual(['공헌이익률', '42.5%', '42.5%', '0']);
    expect(row('net')).toEqual(['월 순이익', '-449만', '-449만', '0']);
    expect(row('breakEven')).toEqual(['손익분기 매출', '1,456만', '1,456만', '0']);
    // 마진율 칸은 지금 설정값으로 시작한다
    expect(document.getElementById('lvMargin').value).toBe('20');
    expect(document.getElementById('lvPartner').value).toBe('10');
  });

  test('원판 +10% — 자재 74.5만의 10% 만큼 순이익이 준다 (값을 바꾸는 즉시)', async () => {
    await open();
    setLever('lvMaterial', 10);
    expect(row('variable')).toEqual(['변동원가', '230만', '237만', '+74,500원']);
    expect(row('net')).toEqual(['월 순이익', '-449만', '-456만', '-74,500원']);
    expect(row('cmRate')[3]).toBe('-1.9%p');
    // 원가가 늘면 빨강, 이익이 줄면 빨강
    expect(document.querySelector('#tblWhatIf tr[data-k="variable"] span').className).toBe('up');
    expect(document.querySelector('#tblWhatIf tr[data-k="net"] span').className).toBe('up');
  });

  test('자주 묻는 네 가지는 버튼 하나로', async () => {
    await open();
    const buttons = [...document.querySelectorAll('#whatIfPresets button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['원판 +10%', '도어 장당 +5천 원', '알바 한 명 더 (+211만)', '고객 마진 15%']);
    buttons[1].click(); // 도어 8장 × 5,000
    expect(row('net')[3]).toBe('-40,000원');
    document.getElementById('btnWhatIfReset').click();
    buttons[2].click(); // 고정비 +2,112,000
    expect(row('fixed')).toEqual(['월 고정비', '619만', '830만', '+211만']);
    expect(row('net')[2]).toBe('-660만');
    document.getElementById('btnWhatIfReset').click();
    buttons[3].click(); // 고객 매출 300만 × 1.15/1.2
    expect(row('revenue')[3]).toBe('-125,000원');
    expect(row('net')[3]).toBe('-125,000원');
  });

  test('수주량 +50% 는 매출과 변동원가를 같이 늘린다 — 고정비는 그대로', async () => {
    await open();
    setLever('lvVolume', 50);
    expect(row('revenue')[2]).toBe('750만');
    expect(row('contribution')).toEqual(['공헌이익', '170만', '255만', '+850,000원']);
    expect(row('fixed')[3]).toBe('0');
    expect(row('net')[2]).toBe('-364만');
  });

  test('처음 값으로 — 모든 레버가 돌아오고 차이가 0', async () => {
    await open();
    setLever('lvMaterial', 10);
    setLever('lvMargin', 30);
    document.getElementById('btnWhatIfReset').click();
    expect(document.getElementById('lvMaterial').value).toBe('0');
    expect(document.getElementById('lvMargin').value).toBe('20');
    expect(row('net')[3]).toBe('0');
  });

  test('계산식 — 원 단위로 손계산과 같다', async () => {
    await open();
    const b = SUMMARY.scenario;
    const { applyScenario } = window.Management;
    expect(applyScenario(b, {})).toEqual({ revenue: 5000000, variable: 2300000, contribution: 1700000, cmRate: 42.5, fixed: 6190000, net: -4490000, breakEven: 14564706 });
    expect(applyScenario(b, { materialPct: 10 }).net).toBe(-4564500);
    expect(applyScenario(b, { doorWon: 5000 }).net).toBe(-4530000);
    expect(applyScenario(b, { marginRate: 0.15 }).net).toBe(-4615000);
    expect(applyScenario(b, { partnerMarginRate: 0.2 }).net).toBe(-4490000 + Math.round(1000000 * (1.2 / 1.1 - 1)));
    expect(applyScenario(b, { volumePct: 50 }).net).toBe(-3640000);
    expect(applyScenario(b, { fixedWon: 2112000 }).net).toBe(-6602000);
    expect(applyScenario(b, { laborPct: 20, hardwarePct: 50 }).net).toBe(-4490000 - 43000 - 60000);
  });

  test('공헌이익이 0 이하면 손익분기는 셀 수 없다', async () => {
    await open();
    const r = window.Management.applyScenario(SUMMARY.scenario, { materialPct: 300 });
    expect(r.contribution).toBeLessThan(0);
    expect(r.breakEven).toBeNull();
  });

  test('알바 시급이 없으면 알바 버튼은 빠진다', async () => {
    await open({ ...SUMMARY, scenario: { ...SUMMARY.scenario, partTimeMonthly: 0 } });
    expect([...document.querySelectorAll('#whatIfPresets button')].map((b) => b.textContent)).toEqual(['원판 +10%', '도어 장당 +5천 원', '고객 마진 15%']);
  });

  test('워커가 아직 옛 판이면(바탕이 없으면) 만약에 줄을 숨긴다', async () => {
    const data = { ...SUMMARY };
    delete data.scenario;
    await open(data);
    expect(document.getElementById('rowWhatIf').hidden).toBe(true);
    expect(document.getElementById('rowProcess').hidden).toBe(false);
  });

  test('달을 다시 불러도 입력 이벤트가 두 번 붙지 않는다 (레버는 바탕값으로 돌아온다)', async () => {
    await open();
    setLever('lvMaterial', 10);
    window.Management.render(SUMMARY);
    expect(document.getElementById('lvMaterial').value).toBe('0');
    expect(row('net')[3]).toBe('0');
  });
});

describe('처리능력 근거 (실측이 쌓이면 실측으로)', () => {
  test('실측이 20일 쌓인 공정은 실측 속도, 나머지는 설정 기준과 남은 날', async () => {
    const roles = SUMMARY.process.load.roles.map((r, i) => ({
      ...r,
      basis: i === 0 ? 'measured' : 'settings',
      pace: i === 0 ? 1.2 : null,
      paceDays: [23, 0, 7][i],
    }));
    const load = { ...SUMMARY.process.load, roles, paceMinDays: 20 };
    boot(fakeApi({ data: { ...SUMMARY, process: { ...SUMMARY.process, load } } }));
    await window.Management.init();
    await settle();
    const tags = [...document.querySelectorAll('#bottleneckBody .load small.basis')];
    expect(tags.map((t) => t.textContent)).toEqual(['실측 속도 ×1.2 · 23일', '설정 기준 · 실측 0/20일', '설정 기준 · 실측 7/20일']);
    expect(tags[0].classList.contains('measured')).toBe(true);
    expect(text('bottleneckBody')).toMatch(/실측을 20일 넘게 남긴 공정은 실측 속도로 능력을 고칩니다/);
  });

  test('옛 워커(근거 없음)면 근거 줄을 그리지 않는다', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.querySelectorAll('#bottleneckBody .load small.basis')).toHaveLength(0);
  });
});

describe('수정 요청 사유 (2단계 PR-5)', () => {
  test('퍼널 아래에 사유 막대 — 가장 많은 사유가 꽉 찬 막대, 사유 없이 돌려보낸 수', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    const rows = [...document.querySelectorAll('#reasonBars .reason')];
    expect(rows.map((r) => r.dataset.code)).toEqual(['price', 'dimension', 'layout']);
    expect(rows.map((r) => r.querySelector('.fill').style.width)).toEqual(['100%', '33%', '33%']);
    expect(rows.map((r) => r.querySelector('.n').textContent)).toEqual(['3건', '1건', '1건']);
    expect(text('funnelBody')).toMatch(/수정 요청 사유 — 요청 4건/);
    expect(text('funnelBody')).toMatch(/사유 없이 돌려보낸 것 1건/);
  });

  test('요청이 없거나 옛 워커면 사유 칸을 그리지 않는다', async () => {
    const data = { ...SUMMARY, funnel: { ...SUMMARY.funnel } };
    delete data.funnel.reasons;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('reasonBars')).toBeNull();
  });

  test('사유 막대도 블록이어야 그려진다', () => {
    expect(HTML).toMatch(/\.reason \.track \{ display: block;/);
    expect(HTML).toMatch(/\.reason \.fill \{ display: block;/);
  });
});

describe('재작업 · A/S (2단계 PR-6)', () => {
  test('이달 건수 · 품질비용, 원인별 막대(돈 순), 반년 A/S 율', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardQuality').hidden).toBe(false);
    expect(text('qualityBody')).toMatch(/이달 재작업 2건 · A\/S 1건 · 품질비용 117,500원/);
    const rows = [...document.querySelectorAll('#qualityBars .reason')];
    expect(rows.map((r) => r.dataset.cause)).toEqual(['cutting', 'install']);
    expect(rows.map((r) => r.querySelector('.fill').style.width)).toEqual(['100%', '74%']);
    expect(text('qualityBody')).toMatch(/다시 한 시간 210분 = 87,500원/);
    expect(text('qualityBody')).toMatch(/최근 180일 설치 3건 중 A\/S 간 집 2건 \(66.7%\)/);
    expect(text('qualityBody')).toMatch(/시간당 25,000원/);
  });

  test('기록 표가 아직 없으면(null) SQL 안내, 옛 워커(칸 없음)면 카드를 숨긴다', async () => {
    boot(fakeApi({ data: { ...SUMMARY, quality: null } }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardQuality').hidden).toBe(false);
    expect(text('qualityBody')).toMatch(/management-phase2\.sql 을 실행하면/);

    const data = { ...SUMMARY };
    delete data.quality;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardQuality').hidden).toBe(true);
  });

  test('이달 기록이 없으면 막대 대신 빈 칸 안내', async () => {
    const quality = { ...SUMMARY.quality, month: { rework: 0, as: 0, minutes: 0, cost: 0, laborWon: 0, total: 0, causes: [] } };
    boot(fakeApi({ data: { ...SUMMARY, quality } }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('qualityBars')).toBeNull();
    expect(text('qualityBody')).toMatch(/이달 적은 재작업 · A\/S 가 없습니다/);
  });
});

describe('설치 후 소개 의향 (2단계 PR-7)', () => {
  test('NPS · 평균 · 답 수, 소개함/중립/안 함 막대가 사람 수 비율로, 응답률 · 이달', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardReferral').hidden).toBe(false);
    expect(document.querySelector('#referralBody .nps b').textContent).toBe('+25');
    expect(text('referralBody')).toMatch(/NPS · 평균 8.3점 · 답 4건/);
    const segs = [...document.querySelectorAll('#npsBar .seg')];
    expect(segs.map((s) => s.className)).toEqual(['seg pro', 'seg mid', 'seg det']);
    expect(segs.map((s) => s.style.flex.split(' ')[0])).toEqual(['2', '1', '1']);
    expect(text('referralBody')).toMatch(/응답률 80% \(보낸 링크 5건\)/);
    expect(text('referralBody')).toMatch(/이달 받은 답 3건/);
  });

  test('답이 없으면 링크를 보내라는 안내, 표가 없으면 SQL 안내, 옛 워커면 숨김', async () => {
    const none = { ...SUMMARY.referral, answered: 0, promoters: 0, passives: 0, detractors: 0, nps: null, avg: null, sent: 2 };
    boot(fakeApi({ data: { ...SUMMARY, referral: none } }));
    await window.Management.init();
    await settle();
    expect(text('referralBody')).toMatch(/최근 180일 받은 답이 없습니다 \(보낸 링크 2건\)/);

    boot(fakeApi({ data: { ...SUMMARY, referral: null } }));
    await window.Management.init();
    await settle();
    expect(text('referralBody')).toMatch(/management-phase2\.sql/);

    const data = { ...SUMMARY };
    delete data.referral;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardReferral').hidden).toBe(true);
  });

  test('NPS 가 음수면 부호 그대로', async () => {
    boot(fakeApi({ data: { ...SUMMARY, referral: { ...SUMMARY.referral, nps: -20 } } }));
    await window.Management.init();
    await settle();
    expect(document.querySelector('#referralBody .nps b').textContent).toBe('-20');
  });

  test('막대 조각도 블록이어야 그려진다', () => {
    expect(HTML).toMatch(/\.segbar \.seg \{ display: block;/);
  });
});

describe('거래처 줄 (2단계 PR-8)', () => {
  const rows = (id) => [...document.querySelectorAll(`#${id} tbody tr`)].map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));

  test('파레토: 큰 순 · 누적 비중 막대 · 상위 20% 한 줄 · 업체 안 붙인 수주', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowPartners').hidden).toBe(false);
    expect(text('partnersBody')).toMatch(/거래처 2곳 · 매출 700만 · 상위 1곳\(20%\)이 매출의 85.7%/);
    expect(rows('tblPartners')).toEqual([
      ['한빛인테리어', '2건', '600만', '25%', '85.7%'],
      ['다온디자인', '1건', '100만', '10%', '100%'],
    ]);
    expect([...document.querySelectorAll('#tblPartners .cum .fill')].map((f) => f.style.width)).toEqual(['85.7%', '100%']);
    expect(text('partnersBody')).toMatch(/업체를 안 붙인 수주 1건/);
  });

  test('성적표: 지출 · 발주 · 약속일 지킴(날짜 있는 건수) · 늦은 날 · 밀림은 빨강', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(rows('tblSuppliers')).toEqual([
      ['상일', '1,380,000원', '4건', '50% (2건)', '3일', '1건'],
      ['일성합판', '0원', '1건', '-', '-', '0'],
    ]);
    expect(document.querySelector('#tblSuppliers tbody tr td:last-child span').className).toBe('up');
  });

  test('표가 없으면 SQL 안내 · 옛 워커면 줄을 숨긴다', async () => {
    boot(fakeApi({ data: { ...SUMMARY, partners: null, suppliers: null } }));
    await window.Management.init();
    await settle();
    expect(text('partnersBody')).toMatch(/management-phase2\.sql/);
    expect(text('suppliersBody')).toMatch(/management-phase2\.sql/);

    const data = { ...SUMMARY };
    delete data.partners;
    delete data.suppliers;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowPartners').hidden).toBe(true);
  });

  test('누적 막대는 셀 안의 div 에 — td 를 grid 로 바꾸면 표가 깨진다', () => {
    expect(HTML).not.toMatch(/td\.cum \{ display: grid/);
    expect(HTML).toMatch(/\.tbl \.cum \{ display: grid;/);
    expect(HTML).toMatch(/\.tbl \.cum \.track \{ display: block;/);
  });
});

describe('현금 줄 (2단계 PR-9)', () => {
  test('13주: 시작 · 13주 뒤 · 가장 낮은 주, 주말 잔액 막대 13개(0 위는 파랑), 밀린 돈 · 날짜 모름', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowCash').hidden).toBe(false);
    expect(text('cashflowBody')).toMatch(/시작 10,000,000원 \(2026-10-20\) → 13주 뒤 4,409,994원 · 가장 낮은 주 4,409,994원 \(1\/11 주\)/);
    const bars = [...document.querySelectorAll('#cashChart rect')];
    expect(bars).toHaveLength(13);
    expect(bars.every((b) => b.getAttribute('class') === 'pos')).toBe(true);
    // 막대 높이는 잔액에 비례 — 가장 큰 주(15,837,690)가 가장 높다
    const heights = bars.map((b) => Number(b.getAttribute('height')));
    expect(heights.indexOf(Math.max(...heights))).toBe(4);
    expect(text('cashflowBody')).toMatch(/밀린 받을 돈 4,500,000원/);
    expect(text('cashflowBody')).toMatch(/날짜 모르는 받을 돈 1,300,000원 \(2건\)/);
    expect(text('cashflowBody')).toMatch(/주마다 1,428,462원/);
    expect(document.querySelectorAll('#tblCash tbody tr')).toHaveLength(13);
    expect(document.getElementById('cashForm').hidden).toBe(false);
    expect(document.getElementById('cbDate').value).toBe('2026-10-21');
  });

  test('마이너스가 되는 주는 빨강 막대와 경고, 묵은 잔액도 알린다', async () => {
    const weeks = SUMMARY.cashflow.weeks.map((w, i) => ({ ...w, balance: i >= 3 ? -500000 * (i - 2) : w.balance }));
    const cashflow = { ...SUMMARY.cashflow, weeks, firstNegative: 3, lowest: { week: 12, start: '2027-01-11', balance: -5000000 }, opening: { ...SUMMARY.cashflow.opening, days: 12, stale: true, as_of: '2026-10-09' } };
    boot(fakeApi({ data: { ...SUMMARY, cashflow } }));
    await window.Management.init();
    await settle();
    expect(document.querySelector('#cashChart rect[data-week="3"]').getAttribute('class')).toBe('neg');
    expect(text('cashflowBody')).toMatch(/4주차\(11\/9 주\)에 잔액이 마이너스가 됩니다/);
    expect(text('cashflowBody')).toMatch(/잔액이 12일 전\(2026-10-09\) 것입니다/);
  });

  test('잔액을 안 적었으면 0 에서 시작했다고 알린다', async () => {
    boot(fakeApi({ data: { ...SUMMARY, cashflow: { ...SUMMARY.cashflow, opening: null } } }));
    await window.Management.init();
    await settle();
    expect(text('cashflowBody')).toMatch(/통장 잔액을 아직 안 적었습니다/);
  });

  test('잔액 적기 → POST 후 다시 읽는다', async () => {
    const api = fakeApi();
    boot(api);
    await window.Management.init();
    await settle();
    document.getElementById('cbAmount').value = '12345678';
    document.getElementById('btnCashBalance').click();
    await settle();
    expect(api.calls).toContainEqual({ post: { as_of: '2026-10-21', amount: 12345678 } });
    expect(api.calls.filter((c) => typeof c === 'string' && c.startsWith('/management/summary')).length).toBe(2);
  });

  test('미수 나이: 묶음 막대 · 오래 밀린 순', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(text('agingBody')).toMatch(/밀린 돈 4,500,000원 · 기한 전 11,300,000원/);
    expect([...document.querySelectorAll('#agingBars .reason')].map((b) => b.querySelector('.fill').style.width)).toEqual(['100%', '0%', '36%', '0%']);
    const rows = [...document.querySelectorAll('#tblAging tbody tr')].map((r) => [...r.cells].map((c) => c.textContent));
    expect(rows).toEqual([['최고객 (SO-3)', '1,200,000원', '81일'], ['SO-1', '3,300,000원', '11일']]);
  });

  test('표가 없으면 SQL 안내 · 잔액 적기 숨김, 옛 워커면 줄을 숨긴다', async () => {
    boot(fakeApi({ data: { ...SUMMARY, cashflow: null, aging: null } }));
    await window.Management.init();
    await settle();
    expect(text('cashflowBody')).toMatch(/management-phase2\.sql/);
    expect(document.getElementById('cashForm').hidden).toBe(true);
    const data = { ...SUMMARY };
    delete data.cashflow;
    delete data.aging;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowCash').hidden).toBe(true);
  });
});

describe('리드타임 · 납기 (3단계 PR-10)', () => {
  test('수주 → 설치 중간 · 단계 막대(가장 긴 곳 강조) · 납기 준수 · 밀린 설치', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardLead').hidden).toBe(false);
    expect(text('leadBody')).toMatch(/수주 → 설치 중간 21.2일 \(설치를 끝낸 수주 2건\) · 가장 오래 기다리는 곳 제작 완료 → 설치/);
    const bars = [...document.querySelectorAll('#leadBars .reason')];
    expect(bars.map((b) => b.dataset.stage)).toEqual(['measure', 'start', 'make', 'install']);
    expect(bars.map((b) => b.querySelector('.fill').style.width)).toEqual(['42%', '69%', '83%', '100%']);
    expect(bars.map((b) => b.classList.contains('slow'))).toEqual([false, false, false, true]);
    expect(text('leadBody')).toMatch(/설치 2건 중 약속한 날 안에 50% · 늦으면 평균 3일 · 미룬 설치 1건/);
    expect(text('leadBody')).toMatch(/아직 끝내지 않은 설치 1건/);
  });

  test('설치를 끝낸 수주가 없으면 일정을 완료로 바꾸라는 안내, 칸이 없으면 SQL 안내, 옛 워커면 숨김', async () => {
    boot(fakeApi({ data: { ...SUMMARY, leadTime: { ...SUMMARY.leadTime, orders: 0, install: { done: 0, onTime: 0, onTimeRate: null, avgLateDays: null, rescheduled: 0, overdue: 0 } } } }));
    await window.Management.init();
    await settle();
    expect(text('leadBody')).toMatch(/설치까지 끝낸 수주가 아직 없어/);
    boot(fakeApi({ data: { ...SUMMARY, leadTime: null } }));
    await window.Management.init();
    await settle();
    expect(text('leadBody')).toMatch(/management-phase3\.sql/);
    const data = { ...SUMMARY };
    delete data.leadTime;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardLead').hidden).toBe(true);
  });

  test('단계 이름이 길어 이 막대는 이름 칸을 넓힌다', () => {
    expect(HTML).toMatch(/\.reason\.lead \{ grid-template-columns: 116px/);
  });
});

describe('원판 사용량 (3단계 PR-11)', () => {
  test('계획 대 실제 장수 · 더 쓴 원판 값 · 실제 수율, 많이 쓴 순 표', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardYield').hidden).toBe(false);
    expect(text('yieldBody')).toMatch(/계획 18장 → 실제 19장 \+5.6% · 원판 값 더 씀 30,264원/);
    expect(text('yieldBody')).toMatch(/실제 수율 ≈ 0.76/);
    expect(text('yieldBody')).toMatch(/수주 5건이 쌓이면 수율 설정을 고칠지 말합니다 \(지금 2건\)/);
    const rows = [...document.querySelectorAll('#tblYield tbody tr')].map((r) => [...r.cells].map((c) => c.textContent));
    expect(rows).toEqual([['이고객 (SO-21)', '8장', '9장', '+12.5%'], ['SO-22', '10장', '10장', '0%']]);
  });

  test('충분히 쌓이면 생산 설정의 수율을 고치자고 한다', async () => {
    boot(fakeApi({ data: { ...SUMMARY, sheetYield: { ...SUMMARY.sheetYield, orders: 6, impliedYield: 0.72, suggestYield: 0.72 } } }));
    await window.Management.init();
    await settle();
    expect(text('yieldBody')).toMatch(/원판 수율\(지금 0.8\)을 0.72 로 고치면/);
    expect(document.querySelector('#yieldBody a').getAttribute('href')).toBe('../production.html');
  });

  test('재단이 끝난 수주가 없으면 작업 링크로 남기라는 안내, 옛 워커면 숨김', async () => {
    boot(fakeApi({ data: { ...SUMMARY, sheetYield: { ...SUMMARY.sheetYield, orders: 0, top: [] } } }));
    await window.Management.init();
    await settle();
    expect(text('yieldBody')).toMatch(/재단 기사가 작업 링크로 주문을 골라 장수를 남기면/);
    const data = { ...SUMMARY };
    delete data.sheetYield;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('cardYield').hidden).toBe(true);
  });
});

describe('계절 지수 · 수주 예측 (3단계 PR-12)', () => {
  test('평균 · 성수기 · 비수기, 지난 열두 달 막대(장부 회색) + 예측 석 달(주황), 지수 띠, 파이프라인', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowForecast').hidden).toBe(false);
    expect(text('forecastBody')).toMatch(/최근 열두 달 평균 3,500만 · 성수기 10월\(1.71\) · 비수기 1월\(0.57\)/);
    const chart = document.getElementById('forecastChart');
    expect(chart.querySelectorAll('rect.hist')).toHaveLength(12);
    expect(chart.querySelectorAll('rect.fc')).toHaveLength(3);
    expect(chart.querySelectorAll('rect.sofar')).toHaveLength(1);
    // 막대 높이는 값에 비례 — 2,000만(1월)은 6,000만(작년 10월)의 1/3
    const hist = [...chart.querySelectorAll('rect.hist')].map((r) => Number(r.getAttribute('height')));
    expect(hist[3] / hist[0]).toBeCloseTo(1 / 3, 1);
    const strip = [...document.querySelectorAll('#indexStrip .idx')];
    expect(strip).toHaveLength(12);
    expect(strip[9].className).toBe('idx hi');
    expect(strip[0].className).toBe('idx lo');
    expect(strip[2].className).toBe('idx mid');
    expect(text('forecastBody')).toMatch(/예측 10월 5,985만 11월 5,985만 12월 3,990만/);
    expect(text('forecastBody')).toMatch(/결정 기다리는 확인서 2건 × 전환율 33.3% × 평균 533만 ≈ 356만/);
  });

  test('열두 달이 안 되면 몇 달인지만, 표가 없으면 SQL 안내', async () => {
    boot(fakeApi({ data: { ...SUMMARY, forecast: { ...SUMMARY.forecast, ready: false, coverage: 7, index: null, next: null, peak: null, low: null } } }));
    await window.Management.init();
    await settle();
    expect(text('forecastBody')).toMatch(/끝난 달 7개월 \/ 12개월/);
    expect(document.getElementById('indexStrip')).toBeNull();
    boot(fakeApi({ data: { ...SUMMARY, forecast: { ...SUMMARY.forecast, needSql: true } } }));
    await window.Management.init();
    await settle();
    expect(text('historyBody')).toMatch(/management-phase3\.sql/);
    expect(text('forecastBody')).toMatch(/과거 월 매출 칸이 아직 없습니다/);
  });

  test('과거 매출 넣기: 지난 스물네 달 칸(만원), 적은 달은 채워 두고, 저장은 원으로 PUT', async () => {
    const api = fakeApi();
    boot(api);
    await window.Management.init();
    await settle();
    const inputs = [...document.querySelectorAll('#historyGrid input')];
    expect(inputs).toHaveLength(24);
    expect(inputs[0].dataset.month).toBe('2024-10');
    expect(inputs.at(-1).dataset.month).toBe('2026-09');
    expect(inputs.at(-1).value).toBe('4000');
    expect(inputs[0].value).toBe('');
    inputs[0].value = '2500';
    document.getElementById('btnSaveHistory').click();
    await settle();
    const put = api.calls.find((c) => c && c.put).put;
    expect(put.rows).toHaveLength(24);
    expect(put.rows[0]).toEqual({ month: '2024-10', revenue: 25000000 });
    expect(put.rows[1]).toEqual({ month: '2024-11', revenue: '' });
    expect(put.rows.at(-1)).toEqual({ month: '2026-09', revenue: 40000000 });
  });

  test('옛 워커(칸 없음)면 줄을 숨긴다', async () => {
    const data = { ...SUMMARY };
    delete data.forecast;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('rowForecast').hidden).toBe(true);
  });
});

describe('분기 목표 (3단계 PR-13)', () => {
  test('분기 · 지난 날, 목표마다 막대 · 상태(닿음/제 속도/뒤처짐) · 쌓이는 목표엔 지난 날 표시', async () => {
    boot(fakeApi());
    await window.Management.init();
    await settle();
    expect(document.getElementById('okrSection').hidden).toBe(false);
    expect(text('okrHead')).toMatch(/2026년 4분기 목표/);
    expect(text('okrHead')).toMatch(/분기 22.8% 지남/);
    const items = [...document.querySelectorAll('#okrList .okr-item')];
    expect(items.map((i) => i.querySelector('.okr-st').textContent)).toEqual(['뒤처짐', '제 속도', '닿음', '값 없음']);
    expect(items.map((i) => i.querySelector('.fill').style.width)).toEqual(['10%', '25%', '100%', '0%']);
    expect(items[0].querySelector('.pace').style.left).toBe('22.8%');
    expect(items[2].querySelector('.pace')).toBeNull();
    expect(items[0].textContent.replace(/\s+/g, ' ')).toMatch(/분기 매출 \(VAT 제외\) · 지금 300만 \/ 목표 3,000만 · 10%/);
    expect(items[2].textContent.replace(/\s+/g, ' ')).toMatch(/지금 4% \/ 목표 5% \(이하\)/);
    expect(items[3].querySelector('[data-okr-value="e"]')).not.toBeNull();
  });

  test('넣기: 고른 숫자 · 목표 값을 그 분기로 POST, 직접 적기만 방향을 고른다', async () => {
    const api = fakeApi();
    boot(api);
    await window.Management.init();
    await settle();
    expect(document.getElementById('okDirection').hidden).toBe(true);
    document.getElementById('okObjective').value = '수주 10건';
    document.getElementById('okMetric').value = 'orders_q';
    document.getElementById('okMetric').dispatchEvent(new window.Event('change'));
    document.getElementById('okTarget').value = '10';
    document.getElementById('btnAddOkr').click();
    await settle();
    const post = api.calls.find((c) => c && c.okr && c.okr.method === 'POST').okr;
    expect(post).toEqual({ path: '/management/okrs', method: 'POST', body: { quarter: '2026-Q4', objective: '수주 10건', metric: 'orders_q', target: 10 } });
    document.getElementById('okMetric').value = 'manual';
    document.getElementById('okMetric').dispatchEvent(new window.Event('change'));
    expect(document.getElementById('okDirection').hidden).toBe(false);
  });

  test('직접 적기 목표의 지금 값 적기 · 지우기', async () => {
    const api = fakeApi();
    boot(api);
    await window.Management.init();
    await settle();
    document.querySelector('[data-okr-value="e"]').value = '1';
    document.querySelector('[data-okr-save="e"]').click();
    await settle();
    document.querySelector('[data-okr-del="b"]').click();
    await settle();
    const okrs = api.calls.filter((c) => c && c.okr).map((c) => c.okr);
    expect(okrs).toContainEqual({ path: '/management/okrs/e', method: 'PATCH', body: { manual_value: 1 } });
    expect(okrs).toContainEqual({ path: '/management/okrs/b', method: 'DELETE', body: null });
  });

  test('목표가 없으면 넣으라는 안내, 표가 없으면 SQL 안내 · 넣기 숨김, 옛 워커면 섹션을 숨긴다', async () => {
    boot(fakeApi({ data: { ...SUMMARY, okrs: { ...SUMMARY.okrs, items: [] } } }));
    await window.Management.init();
    await settle();
    expect(text('okrList')).toMatch(/이번 분기 목표가 없습니다/);
    boot(fakeApi({ data: { ...SUMMARY, okrs: null } }));
    await window.Management.init();
    await settle();
    expect(text('okrList')).toMatch(/management-phase3\.sql/);
    expect(document.getElementById('okrEdit').hidden).toBe(true);
    const data = { ...SUMMARY };
    delete data.okrs;
    boot(fakeApi({ data }));
    await window.Management.init();
    await settle();
    expect(document.getElementById('okrSection').hidden).toBe(true);
  });

  test('진도 막대 · 지난 날 표시도 블록이어야 그려진다', () => {
    expect(HTML).toMatch(/\.okr-bar \{ position: relative; display: block;/);
    expect(HTML).toMatch(/\.okr-bar \.fill \{ display: block;/);
  });
});
