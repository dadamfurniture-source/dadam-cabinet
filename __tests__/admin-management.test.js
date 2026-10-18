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
};

function fakeApi({ admin = true, data = SUMMARY, status = 200 } = {}) {
  const calls = [];
  const fetchFn = jest.fn(async (url) => {
    const u = String(url).replace(API, '');
    calls.push(u);
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
