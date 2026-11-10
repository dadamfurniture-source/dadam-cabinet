/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest */
/**
 * 본사 대시보드 앱 화면 (segan/hq-board.html + segan/hq-board.js)
 *
 *   조각     #profit 이익 · 목표 (종합 대시보드) · #finance 손익 분석 · #cash 현금 · 미수 · #forecast 매출 예측 (회계관리)
 *            회계관리 셋은 위 탭으로 오간다 (기록은 넣지 않고 # 만), 모르는 # 는 #profit
 *   서버     workflow-api GET /management/summary?month= (관리자만) — 숫자는 서버가 준 그대로, 만약에 판만 이 화면이 센다
 *            (PC 화면 admin/management.html applyScenario 와 같은 식인지 둘을 맞춰 본다)
 *   넣기     목표 · 통장 잔액 · 과거 월 매출은 PC 화면 링크
 *   움직임   segan/motion.js — 숫자는 지난 달 값에서, 막대는 0 에서, 카드는 차례로 (파일이 없으면 최종 모습 그대로)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'admin-1', email: 'admin@example.com' } };
const WORK = 'https://work.example.workers.dev';
const kst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);

const SUMMARY = {
  month: '2026-11',
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
  breakEven: {
    overhead: 2000000,
    cmRate: 22.6,
    revenueNeeded: 8857143,
    progress: 46.3,
    gap: 4757143,
    safety: 0,
  },
  channels: [
    {
      tier: 'customer',
      label: '직판',
      orders: 2,
      revenue: 3000000,
      contribution: 600000,
      cmRate: 30,
      factoryHours: 2,
      perHour: 300000,
    },
    {
      tier: 'partner',
      label: '거래처<img src=x onerror=alert(1)>',
      orders: 1,
      revenue: 1100000,
      contribution: 100000,
      cmRate: 9.1,
      factoryHours: 3,
      perHour: 33333,
    },
  ],
  basis: {
    revenue: 'VAT 제외 계약금',
    cost: '확인서 견적 원가',
    overhead: 2000000,
    settingsSource: 'latest',
  },
  process: {
    variance: {
      orders: 2,
      recorded: 2,
      categories: [
        {
          category: 'material',
          label: '자재',
          orders: 1,
          estimate: 515000,
          actual: 560000,
          diff: 45000,
          diffRate: 8.7,
        },
        {
          category: 'hardware',
          label: '부자재',
          orders: 1,
          estimate: 40000,
          actual: 30000,
          diff: -10000,
          diffRate: -25,
        },
      ],
      totals: { estimate: 555000, actual: 590000, diff: 35000, diffRate: 6.3 },
      top: [
        { id: 'P1', label: 'P고객 (SO-11)', diff: 45000, diffRate: 8.7, worst: { label: '자재' } },
      ],
    },
    time: [
      { role: 'cutter', label: '재단', orders: 1, estimateMin: 70, actualMin: 80, diffRate: 14.3 },
    ],
  },
  okrs: {
    quarter: '2026-Q4',
    elapsed: 22.8,
    items: [
      {
        id: 'a',
        objective: '가을 성수기 매출',
        label: '분기 매출 (VAT 제외)',
        unit: 'won',
        target: 30000000,
        current: 3000000,
        direction: 'up',
        cumulative: true,
        progress: 10,
        status: 'behind',
      },
      {
        id: 'c',
        objective: 'A/S 줄이기',
        label: 'A/S 율 (반년)',
        unit: 'pct',
        target: 5,
        current: 4,
        direction: 'down',
        cumulative: false,
        progress: 100,
        status: 'done',
      },
    ],
    metrics: [],
  },
  cashflow: {
    today: '2026-11-10',
    opening: { amount: 10000000, as_of: '2026-11-09', days: 1, stale: false },
    weeks: [
      {
        start: '2026-11-09',
        end: '2026-11-15',
        inflow: 4500000,
        outflow: 2000000,
        balance: 12500000,
      },
      { start: '2026-11-16', end: '2026-11-22', inflow: 0, outflow: 3000000, balance: 9500000 },
      { start: '2026-11-23', end: '2026-11-29', inflow: 0, outflow: 11000000, balance: -1500000 },
      {
        start: '2026-11-30',
        end: '2026-12-06',
        inflow: 6000000,
        outflow: 1000000,
        balance: 3500000,
      },
    ],
    weeklyOverhead: 1428462,
    overdueIn: 4500000,
    overdueOut: 920000,
    laterIn: 100000,
    laterOut: 300000,
    unscheduledIn: 1300000,
    unscheduledOrders: 2,
    lowest: { week: 2, start: '2026-11-23', balance: -1500000 },
    firstNegative: 2,
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
    top: [{ order_id: 'C', label: '최고객 (SO-3)', amount: 1200000, days: 81 }],
  },
  forecast: {
    needSql: false,
    today: '2026-11-10',
    months: [
      ['2025-11', 60],
      ['2025-12', 40],
      ['2026-01', 20],
      ['2026-02', 20],
      ['2026-03', 30],
      ['2026-04', 40],
      ['2026-05', 40],
      ['2026-06', 30],
      ['2026-07', 20],
      ['2026-08', 20],
      ['2026-09', 40],
      ['2026-10', 60],
    ]
      .map(([month, r]) => ({ month, revenue: r * 1000000, source: 'manual' }))
      .concat([{ month: '2026-11', revenue: 15000000, source: 'system', partial: true }]),
    coverage: 12,
    minMonths: 12,
    ready: true,
    index: [0.57, 0.57, 0.86, 1.14, 1.14, 0.86, 0.57, 0.57, 1.14, 1.71, 1.71, 1.14].map(
      (value, i) => ({ m: i + 1, value })
    ),
    peak: { m: 10, value: 1.71 },
    low: { m: 1, value: 0.57 },
    base: 35000000,
    next: [
      { month: '2026-11', index: 1.71, forecast: 59850000 },
      { month: '2026-12', index: 1.14, forecast: 39900000 },
      { month: '2027-01', index: 0.57, forecast: 19950000 },
    ],
    pipeline: { pending: 2, conversion: 33.3, avgContract: 5333333, expected: 3555555 },
  },
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

async function load(options = {}) {
  const opts = {
    session: SESSION,
    isAdmin: true,
    url: '/segan/hq-board.html',
    summary: SUMMARY,
    status: 200,
    ...options,
  };
  window.history.replaceState(null, '', opts.url);
  const doc = new DOMParser().parseFromString(read('segan/hq-board.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'SeganShell', 'SeganHqBoard', 'SeganMotion']) delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
  };
  const calls = { summary: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) => ({ data: name === 'is_admin' ? opts.isAdmin : null, error: null }),
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    if (url.endsWith('/work/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { ready: true, worker: null } }),
      };
    if (url.endsWith('/assistant/me'))
      return { ok: false, status: 403, json: async () => ({ success: false }) };
    if (url.startsWith(WORK + '/management/summary')) {
      calls.summary.push({ url, auth: (init.headers || {}).Authorization });
      if (opts.status !== 200)
        return {
          ok: false,
          status: opts.status,
          json: async () => ({
            success: false,
            message: '경영 대시보드는 관리자만 볼 수 있습니다',
          }),
        };
      return { ok: true, status: 200, json: async () => ({ success: true, data: opts.summary }) };
    }
    return { ok: false, status: 404, json: async () => ({ success: false }) };
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  if (opts.motion) window.SeganMotion = opts.motion;
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/hq-board.js'));
  await window.SeganShell.ready;
  await window.SeganHqBoard.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const txt = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const visibleViews = () =>
  [...document.querySelectorAll('.hb-view')].filter((v) => !v.hidden).map((v) => v.dataset.part);

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
  delete window.SeganMotion;
});

describe('들어오기', () => {
  test('관리자가 아니면 「관리자만 볼 수 있습니다」, 요약을 묻지 않는다', async () => {
    const calls = await load({ isAdmin: false });
    expect($('hbDenied').hidden).toBe(false);
    expect($('hbBoard').hidden).toBe(true);
    expect(calls.summary).toHaveLength(0);
  });

  test('관리자 — 이번 달(KST) 요약을 본인 토큰으로 한 번, # 없으면 이익 · 목표', async () => {
    const calls = await load();
    expect(calls.summary).toEqual([
      { url: WORK + '/management/summary?month=' + kst(), auth: 'Bearer tok-1' },
    ]);
    expect(visibleViews()).toEqual(['profit']);
    expect($('hbTitle').textContent).toBe('이익 · 목표');
    expect(document.title).toBe('이익 · 목표 · SEGAN');
    expect($('hbTabs').hidden).toBe(true); // 종합 대시보드 조각은 하나
    expect($('hbMonth').hidden).toBe(false);
    expect($('hbNext').disabled).toBe(true); // 이번 달 다음은 없다
    expect(document.body.dataset.tab).toBe('me');
  });

  test('모르는 # 는 이익 · 목표 · 서버가 거절하면 그 글을 한 줄', async () => {
    await load({ url: '/segan/hq-board.html#nope' });
    expect(visibleViews()).toEqual(['profit']);
    await load({ status: 403 });
    expect($('hbStatus').textContent).toBe('경영 대시보드는 관리자만 볼 수 있습니다');
    expect($('hbStatus').classList.contains('is-error')).toBe(true);
    expect($('hbProfit').textContent).toBe('');
  });
});

describe('이익 · 목표', () => {
  test('이익 식 — 수주 × 평균 계약금 × 공헌이익률 − 고정비 = 순이익, 칸마다 지난 달, 마이너스는 붉게', async () => {
    await load();
    const rows = [...document.querySelectorAll('#hbProfit .hb-calc li')].map((li) => [
      li.querySelector('.hb-op').textContent,
      li.querySelector('.hb-lbl').firstChild.textContent,
      li.querySelector('small').textContent,
      li.querySelector('.hb-val').textContent,
    ]);
    expect(rows).toEqual([
      ['', '수주', '지난 달 1건', '3건'],
      ['×', '평균 계약금 (VAT 제외)', '지난 달 300만', '137만'],
      ['×', '공헌이익률', '지난 달 53.3%', '22.6%'],
      ['−', '월 고정비', '생산 설정 값', '200만'],
      ['=', '월 순이익', '지난 달 -40만', '-130만'],
    ]);
    expect(
      document.querySelector('#hbProfit .hb-calc li.is-net').classList.contains('is-neg')
    ).toBe(true);
    const t = txt($('hbProfit'));
    expect(t).toMatch(/매출 410만 · 공헌이익 70만/);
    expect(t).toMatch(/상담 3건 · 확인서 4건 발행 → 1건 승인 \(전환 25%\) · 결정 대기 1건/);
    expect(t).toMatch(/견적 원가가 없는 수주 1건은 공헌이익 · 손익분기에서 빠졌습니다/);
    // 굴릴 숫자 — 지난 달에서 이번 달로 (고정비는 그대로)
    const net = document.querySelector('#hbProfit li.is-net .hb-val');
    expect([net.dataset.roll, net.dataset.from, net.dataset.to]).toEqual([
      'man',
      '-400000',
      '-1300000',
    ]);
  });

  test('분기 목표 — 상태 · 진도 막대(멈춘 모습은 그 비율) · 지난 날 표시는 쌓이는 목표만', async () => {
    await load();
    const goals = [...document.querySelectorAll('#hbProfit .hb-goal')];
    expect(goals.map((g) => g.querySelector('.hb-pill').textContent)).toEqual(['뒤처짐', '닿음']);
    expect(goals[0].querySelector('.hb-fill').style.transform).toBe('scaleX(0.1)');
    expect(goals[0].querySelector('.hb-pace').style.left).toBe('22.8%');
    expect(goals[1].querySelector('.hb-pace')).toBeNull();
    expect(txt(goals[1])).toMatch(/지금 4% \/ 목표 5% \(이하\) · 100%/);
    expect($('hbPc').querySelector('a').getAttribute('href')).toBe(
      '../admin/management.html?part=profit'
    );
    expect(txt($('hbPc'))).toMatch(/분기 목표 넣기 · 지우기는 PC 화면에서/);
  });

  test('목표 칸이 없거나 비면 안내 한 줄 — 지어내지 않는다', async () => {
    await load({ summary: { ...SUMMARY, okrs: null } });
    expect(txt($('hbProfit'))).toMatch(/분기 목표 칸이 아직 없습니다/);
    await load({ summary: { ...SUMMARY, okrs: { ...SUMMARY.okrs, items: [] } } });
    expect(txt($('hbProfit'))).toMatch(/이번 분기 목표가 없습니다/);
  });
});

describe('회계관리 조각 — 위 탭', () => {
  test('#finance — 탭 셋(손익 분석 · 현금 · 미수 · 매출 예측), 누르면 # 만 바꾸고 기록은 넣지 않는다', async () => {
    await load({ url: '/segan/hq-board.html#finance' });
    const tabs = () => [...$('hbTabs').querySelectorAll('[role="tab"]')];
    expect($('hbTabs').hidden).toBe(false);
    expect(tabs().map((b) => [b.textContent, b.getAttribute('aria-selected')])).toEqual([
      ['손익 분석', 'true'],
      ['현금 · 미수', 'false'],
      ['매출 예측', 'false'],
    ]);
    const len = window.history.length;
    tabs()[1].click();
    expect(window.location.hash).toBe('#cash');
    expect(window.history.length).toBe(len);
    expect(visibleViews()).toEqual(['cash']);
    expect($('hbTitle').textContent).toBe('현금 · 미수');
    expect($('hbMonth').hidden).toBe(true); // 현금은 오늘부터
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect($('hbTabs').querySelector('.hb-tab-ind').style.transform).toBe('translateX(100%)');
  });

  test('손익분기 · 채널 · 견적 대비 실적 — 글은 글자로만', async () => {
    await load({ url: '/segan/hq-board.html#finance' });
    const v = $('hbFinance');
    expect(v.querySelector('.hb-track .hb-fill').style.transform).toBe('scaleX(0.463)');
    expect(txt(v)).toMatch(/손익분기까지 매출 476만을 더 받아야 합니다/);
    const bars = [...v.querySelectorAll('.hb-bar')];
    expect(bars.map((b) => b.querySelector('span').textContent)).toEqual([
      '직판',
      '거래처<img src=x onerror=alert(1)>',
    ]);
    expect(v.querySelector('img')).toBeNull();
    expect(bars[1].querySelector('.hb-fill').dataset.grow).toBe('0.1111');
    expect(txt(v)).toMatch(/실적을 넣은 수주 2건 \/ 2건 · 견적 56만 → 실적 59만 \+4만 \(\+6\.3%\)/);
    expect(v.querySelector('.hb-list .hb-up').textContent).toBe('+5만 (+8.7%)');
    expect(txt(v)).toMatch(/재단 수주 1건 · 예상 70분 · 실측 80분\+14\.3%/);
    expect(txt(v)).toMatch(
      /근거 — 매출: VAT 제외 계약금 · 원가: 확인서 견적 원가 · 월 고정비 200만: 가장 최근에 저장된 생산 설정/
    );
  });

  test('만약에 판 — 셸 시트에 레버 여덟 · 표, 레버를 끌면 바로 다시 센다 · 미리 정한 단추', async () => {
    await load({ url: '/segan/hq-board.html#finance' });
    $('hbWhatIfOpen').click();
    const sheet = document.querySelector('.sg-sheet');
    expect(sheet.querySelector('.sg-sheet-title').textContent).toBe('만약에 판');
    expect(sheet.querySelectorAll('input[type="range"]')).toHaveLength(8);
    const net = () => sheet.querySelector('tr[data-k="net"]').children;
    expect(net()[1].textContent).toBe(net()[2].textContent); // 처음엔 지금 = 바꾸면
    const mat = sheet.querySelector('[data-lever="materialPct"]');
    mat.value = '10';
    mat.dispatchEvent(new window.Event('input', { bubbles: true }));
    const H = window.SeganHqBoard;
    const want = H.applyScenario(
      SUMMARY.scenario,
      H.toLevers({ ...H.leverDefaults(SUMMARY.scenario), materialPct: 10 })
    );
    expect(net()[2].textContent).toBe(Math.round(want.net / 10000).toLocaleString('ko-KR') + '만');
    expect(sheet.querySelector('#hbLv-materialPctOut').textContent).toBe('+10%');
    expect(net()[3].querySelector('.hb-up')).not.toBeNull(); // 이익이 준다
    // 알바 시급이 있으면 「알바 한 명 더」, 처음 값으로
    const presets = [...sheet.querySelectorAll('[data-preset]')].map((b) => b.textContent);
    expect(presets).toEqual([
      '원판 +10%',
      '도어 장당 +5천 원',
      '알바 한 명 더 (+211만)',
      '고객 마진 15%',
      '처음 값으로',
    ]);
    sheet.querySelector('[data-preset="reset"]').click();
    expect(mat.value).toBe('0');
    expect(net()[3].textContent).toBe('0');
  });

  test('만약에 판 식은 PC 화면(admin/management.html)과 같다', async () => {
    await load();
    const html = read('admin/management.html');
    const pc = html.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)[1];
    window.__MANAGEMENT_NO_AUTOSTART = true;
    (0, eval)(pc);
    const H = window.SeganHqBoard;
    const b = SUMMARY.scenario;
    for (const L of [
      {},
      { materialPct: 10 },
      { doorWon: 5000, laborPct: -5 },
      { marginRate: 0.15, partnerMarginRate: 0.05, volumePct: 30, fixedWon: 2112000 },
      { volumePct: -100 },
    ])
      expect([L, H.applyScenario(b, L)]).toEqual([L, window.Management.applyScenario(b, L)]);
    delete window.__MANAGEMENT_NO_AUTOSTART;
    delete window.Management;
  });
});

describe('현금 · 미수', () => {
  test('13주 — 시작 → 13주 뒤 · 가장 낮은 주, 마이너스 경고, 0 선, 훑으면 그 주 (1:1)', async () => {
    await load({ url: '/segan/hq-board.html#cash' });
    const v = $('hbCash');
    expect(txt(v)).toMatch(
      /시작 1,000만 \(2026-11-09\) → 13주 뒤 350만 · 가장 낮은 주 -150만 \(11\/23 주\)/
    );
    expect(v.querySelector('.hb-warn.is-crit').textContent).toBe(
      '3주차(11/23 주)에 잔액이 마이너스가 됩니다.'
    );
    const svg = $('hbCashChart');
    expect(svg.querySelector('line.zero')).not.toBeNull();
    expect(svg.querySelector('path.line[data-draw]').getAttribute('d').split('L')).toHaveLength(4);
    expect(svg.querySelector('circle.low').classList.contains('is-neg')).toBe(true);
    svg.getBoundingClientRect = () => ({ left: 0, width: 340, top: 0, height: 176 });
    svg.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: 205, bubbles: true }));
    expect(svg.classList.contains('is-scrub')).toBe(true);
    expect(txt($('hbCashReadout'))).toBe('11/23~11/29 · 들어옴 0만 · 나감 1,100만잔액 -150만');
    svg.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 205, bubbles: true }));
    expect(svg.classList.contains('is-scrub')).toBe(false);
    const facts = [...v.querySelectorAll('.hb-facts div')].map((d) => [
      d.querySelector('small').textContent,
      d.querySelector('b').textContent,
    ]);
    expect(facts[0]).toEqual(['밀린 받을 돈', '4,500,000원']);
    expect(facts[3]).toEqual(['13주 뒤 들어옴 · 나감', '10만 · 30만']);
  });

  test('미수 나이 — 칸마다 막대(가장 큰 칸 기준) · 오래 밀린 순, 칸이 없으면 안내', async () => {
    await load({ url: '/segan/hq-board.html#cash' });
    const bars = [...$('hbCash').querySelectorAll('[data-bucket]')];
    expect(bars.map((b) => [b.dataset.bucket, b.querySelector('.hb-fill').dataset.grow])).toEqual([
      ['0-30', '1'],
      ['31-60', '0'],
      ['61-90', '0.3636'],
      ['90+', '0'],
    ]);
    const top = $('hbCash').querySelector('.hb-list li');
    expect([
      top.querySelector('span').firstChild.textContent,
      top.querySelector('small').textContent,
      top.querySelector('b').textContent,
    ]).toEqual(['최고객 (SO-3) ', '81일 밀림', '1,200,000원']);
    await load({
      url: '/segan/hq-board.html#cash',
      summary: { ...SUMMARY, cashflow: null, aging: null },
    });
    expect($('hbCash').querySelectorAll('.hb-empty')).toHaveLength(2);
  });
});

describe('매출 예측', () => {
  test('지난 달 막대 열둘 + 예측 셋 + 이번 달 지금까지 · 계절 지수 열둘 · 예측 · 결정 기다리는 확인서', async () => {
    await load({ url: '/segan/hq-board.html#forecast' });
    const svg = $('hbForecastChart');
    expect(svg.querySelectorAll('rect.hist')).toHaveLength(12);
    expect(svg.querySelectorAll('rect.fc')).toHaveLength(3);
    expect(svg.querySelectorAll('rect.sofar')).toHaveLength(1);
    expect($('hbForecast').querySelectorAll('.hb-index span')).toHaveLength(12);
    expect($('hbForecast').querySelector('.hb-index [data-m="10"]').className).toBe('hi');
    const next = [...$('hbForecast').querySelectorAll('.hb-facts div')].map(
      (d) => d.querySelector('small').textContent + ' ' + d.querySelector('b').textContent
    );
    expect(next).toEqual(['11월 예측 5,985만', '12월 예측 3,990만', '1월 예측 1,995만']);
    expect(txt($('hbForecast'))).toMatch(
      /결정 기다리는 확인서 2건 × 전환율 33.3% × 평균 533만 ≈ 356만/
    );
    expect(txt($('hbPc'))).toMatch(/과거 월 매출 넣기는 PC 화면에서/);
  });

  test('열두 달이 모이기 전 — 모인 달 수와 이력만', async () => {
    await load({
      url: '/segan/hq-board.html#forecast',
      summary: {
        ...SUMMARY,
        forecast: { ...SUMMARY.forecast, ready: false, coverage: 5, next: [] },
      },
    });
    expect(txt($('hbForecast'))).toMatch(/끝난 달 5개월 \/ 12개월 — 열두 달이 모이면/);
    expect($('hbForecast').querySelector('.hb-index')).toBeNull();
  });
});

describe('달 · 움직임', () => {
  test('지난 달 ‹ — 그 달로 다시 묻는다, 이번 달로 돌아오면 다음은 막힌다', async () => {
    const calls = await load();
    $('hbPrev').click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const prev = (() => {
      const [y, m] = kst().split('-').map(Number);
      const t = y * 12 + (m - 1) - 1;
      return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
    })();
    expect(calls.summary.at(-1).url).toBe(WORK + '/management/summary?month=' + prev);
    expect($('hbNext').disabled).toBe(false);
  });

  test('segan/motion.js 가 있으면 — 카드는 차례로, 숫자는 지난 달에서, 막대는 0 에서 자란다', async () => {
    const motion = {
      enter: jest.fn(),
      roll: jest.fn(),
      grow: jest.fn(),
      draw: jest.fn(),
      reduced: () => false,
    };
    await load({ motion });
    const cards = [...document.querySelectorAll('#hbProfit .hb-card')];
    expect(motion.enter.mock.calls.filter((c) => cards.includes(c[0])).map((c) => c[2])).toEqual([
      0, 50,
    ]);
    const netCall = motion.roll.mock.calls.find((c) => c[0].closest('li.is-net'));
    expect(netCall.slice(1, 3)).toEqual([-400000, -1300000]);
    expect(netCall[3](-1300000)).toBe('-130만'); // 끝 글은 그린 글 그대로
    expect(motion.grow.mock.calls.map((c) => c[1])).toEqual([0.1, 1]);
  });
});

describe('마이페이지 · 담기', () => {
  test('본사 메뉴 — 넷은 이 앱 화면(같은 창), 셋은 아직 PC 화면', () => {
    const me = read('segan/me.html');
    const app = [...me.matchAll(/href="hq-board\.html#([a-z]+)"(?![^>]*data-desktop-tab)/g)].map(
      (m) => m[1]
    );
    expect(app.sort()).toEqual(['cash', 'finance', 'forecast', 'profit']);
    expect(me).not.toMatch(/management\.html\?part=(profit|finance|cash|forecast)/);
  });

  test('서비스 워커가 화면 · 파일을 담고, 페이지는 motion.js 를 셸보다 먼저 싣는다', () => {
    const sw = read('segan/sw.js');
    expect(sw).toMatch(/SCOPE \+ 'hq-board\.html'/);
    expect(sw).toMatch(/versioned\(SCOPE \+ 'hq-board\.js'\)/);
    expect(sw).toMatch(/versioned\(SCOPE \+ 'hq-board\.css'\)/);
    const html = read('segan/hq-board.html');
    const motionAt = html.search(/src="motion\.js\?v=/);
    expect(motionAt).toBeGreaterThan(0);
    expect(motionAt).toBeLessThan(html.search(/src="shell\.js\?v=/));
  });
});
