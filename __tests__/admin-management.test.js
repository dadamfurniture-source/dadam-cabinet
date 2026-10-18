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
