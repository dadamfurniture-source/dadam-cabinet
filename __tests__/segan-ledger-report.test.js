/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 인쇄용 월 회계 보고서 (segan/ledger-report.html + segan/ledger-report.js)
 *
 *   데이터  GET /ledger/me (팩토리 이름) · /ledger/dashboard?month=&months=12 · /ledger/accounts · /ledger/receivables · /ledger/payables
 *   보이기  칸 넷(매출 · 매입 · 장부 손익 · 부가세 예상 — 일반과세만) · 최근 6달 · 매입 계정별 · 지출 상대 · 받을 돈 · 낼 돈 · 남은 할 일
 *   그 밖   인쇄 단추(window.print), 달 바꾸기, 받을 돈 · 낼 돈을 모르면 그 줄을 뺀다, 대표 · 실장만
 *   월 마감 메모  GET /ledger/close-memo?month= (2026-11-06 6-L3) — 서버가 센 손볼 곳, 0 은 뺀다, 모르면 칸째 감춘다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const WORK = 'https://work.example.workers.dev';
const NOW = Date.parse('2026-11-03T03:00:00Z'); // 한국 시간 11월 3일

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});

const ME = {
  company_id: 'c1',
  role: 'owner',
  money: true,
  level: 'full',
  can_upload: true,
  can_write: true,
  ai: false,
  ledgers: [{ company_id: 'c1', name: '한빛 인테리어', kind: 'partner', own: true }],
};
const ZERO = {
  income: 0,
  income_vat: 0,
  expense: 0,
  expense_vat: 0,
  asset_buy: 0,
  asset_sell: 0,
  account_unknown: 0,
  vat_unknown: 0,
  evidence_risk: 0,
};
const months12 = (end) => {
  const [y, m] = end.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 12 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
};
const DASH = (month = '2026-11') => ({
  month,
  available: true,
  vat_type: 'general',
  pending_photos: 3,
  held_statements: 0,
  months: months12(month).map((mm) => {
    if (mm === '2026-09')
      return {
        ...ZERO,
        month: mm,
        income: 30000000,
        income_vat: 3000000,
        expense: 21000000,
        expense_vat: 1900000,
      };
    if (mm === '2026-10')
      return {
        ...ZERO,
        month: mm,
        income: 48200000,
        income_vat: 4820000,
        expense: 31050000,
        expense_vat: 2860000,
        evidence_risk: 2,
      };
    return { ...ZERO, month: mm };
  }),
  accounts: [
    { direction: 'expense', account: 'admin.freight', amount: 4100000, vat_amount: 410000, n: 6 },
    {
      direction: 'expense',
      account: 'purchase.materials',
      amount: 22400000,
      vat_amount: 2240000,
      n: 18,
    },
  ],
  suppliers: [{ name: '가나목재', amount: 9000000, n: 4 }],
});
const RECV = { count: 2, total: 4100000, late_count: 1, late_total: 900000, items: [] };
const PAY = { count: 1, total: 3800000, late_count: 0, late_total: 0, items: [] };

async function load(options = {}) {
  const opts = {
    me: ok(ME),
    dash: (url) => ok(DASH(new URL(url).searchParams.get('month'))),
    accounts: ok({
      items: [
        { code: 'purchase.materials', name: '재료비 매입' },
        { code: 'admin.freight', name: '운반비' },
      ],
    }),
    recv: () => ok(RECV),
    pay: () => ok(PAY),
    memo: () => ok({ available: false }),
    search: '',
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/ledger-report.html' + opts.search);
  const doc = new DOMParser().parseFromString(read('segan/ledger-report.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganLedgerBoard',
    'SeganLedgerReport',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
  };
  const calls = [];
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: SESSION } }) },
      rpc: async () => ({ data: [], error: null }),
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    if (url.startsWith(WORK + '/ledger/me')) return reply(opts.me);
    if (url.startsWith(WORK + '/ledger/dashboard')) return reply(opts.dash(url));
    if (url === WORK + '/ledger/accounts') return reply(opts.accounts);
    if (url.startsWith(WORK + '/ledger/receivables')) return reply(opts.recv(url));
    if (url.startsWith(WORK + '/ledger/payables')) return reply(opts.pay(url));
    if (url.startsWith(WORK + '/ledger/close-memo')) return reply(opts.memo(url));
    return reply(ok({ ready: true, worker: null }));
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/ledger-board.js'));
  (0, eval)(read('segan/ledger-report.js'));
  await window.SeganShell.ready;
  await window.SeganLedgerBoard.ready;
  await window.SeganLedgerReport.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const tiles = () =>
  [...$('lrTiles').querySelectorAll('.lr-tile')].map((t) => [
    t.querySelector('dt').textContent,
    t.querySelector('b').textContent,
    (t.querySelector('small') || {}).textContent || '',
  ]);
const rows = (id) =>
  [...$(id).querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('회계 보고서', () => {
  test('?month= 그 달 — 제목 · 칸 넷 · 최근 6달 · 계정별 · 지출 상대 · 받을 돈 · 낼 돈 · 남은 할 일', async () => {
    const calls = await load({ search: '?month=2026-10' });
    expect($('lrBody').hidden).toBe(false);
    expect($('lrTitle').textContent).toBe('한빛 인테리어 · 2026년 10월 회계 보고');
    expect($('lrMade').textContent).toBe('만든 날 2026-11-03 · 받은 돈 · 낸 돈 기준');
    expect(tiles()).toEqual([
      ['매출 (받은 돈)', '48,200,000원', '부가세 4,820,000원 따로'],
      ['매입', '31,050,000원', '공제 부가세 2,860,000원'],
      ['장부 손익', '17,150,000원', '지난달보다 +8,150,000원'],
      ['부가세 예상 (7~12월)', '3,060,000원', '매출세액 − 매입세액 · 참고'],
    ]);
    expect(rows('lrMonths').map((r) => r[0])).toEqual([
      '2026년 5월',
      '2026년 6월',
      '2026년 7월',
      '2026년 8월',
      '2026년 9월',
      '2026년 10월',
    ]);
    expect(rows('lrMonths').at(-1)).toEqual([
      '2026년 10월',
      '48,200,000원',
      '31,050,000원',
      '17,150,000원',
    ]);
    expect(rows('lrAccounts')).toEqual([
      ['재료비 매입', '22,400,000원', '2,240,000원', '18'],
      ['운반비', '4,100,000원', '410,000원', '6'],
    ]);
    expect(rows('lrSuppliers')).toEqual([['가나목재', '9,000,000원', '4']]);
    expect($('lrMoneyBox').hidden).toBe(false);
    expect($('lrMoney').textContent).toBe(
      '받을 돈4,100,000원 · 2건 (늦음 900,000원)낼 돈3,800,000원 · 1건'
    );
    expect([...$('lrTodo').children].map((li) => li.textContent)).toEqual([
      '확인 기다리는 사진 3장',
      '증빙 경고 2건',
    ]);
    expect(calls.find((c) => c.url.startsWith(WORK + '/ledger/dashboard')).url).toBe(
      WORK + '/ledger/dashboard?month=2026-10&months=12'
    );
  });

  test('인쇄 단추는 window.print, ‹ 는 앞 달로 다시, 받을 돈 · 낼 돈을 모르면(404) 그 줄을 뺀다', async () => {
    const calls = await load({
      search: '?month=2026-10',
      recv: () => fail(404, '', 'x'),
      pay: () => fail(404, '', 'x'),
    });
    expect($('lrMoneyBox').hidden).toBe(true);
    window.print = jest.fn();
    $('lrPrint').click();
    expect(window.print).toHaveBeenCalled();
    $('lrPrev').click();
    await flush();
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/dashboard')).at(-1).url).toBe(
      WORK + '/ledger/dashboard?month=2026-09&months=12'
    );
    expect($('lrMonth').textContent).toBe('2026년 9월');
  });

  test('지출 상대 — 상위 10곳까지', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `상호${i + 1}`,
      amount: (12 - i) * 100000,
      n: 1,
    }));
    await load({
      search: '?month=2026-10',
      dash: (url) => ok({ ...DASH(new URL(url).searchParams.get('month')), suppliers: many }),
    });
    expect($('lrSupTitle').textContent).toBe('이 달 지출 상대 · 상위 10');
    expect(rows('lrSuppliers').map((r) => r[0])).toEqual(many.slice(0, 10).map((s) => s.name));
  });

  test('직원 · 자격 없음 — 이유 한 줄', async () => {
    for (const [me, text] of [
      [ok({ ...ME, role: 'staff', money: false }), '회계 보고서는 팩토리 대표 · 실장만 봅니다.'],
      [fail(403, 'not_entitled', 'x'), '회계 보고서는 Expert · Agent 팩토리가 봅니다.'],
    ]) {
      await load({ me });
      expect($('lrState').textContent).toBe(text);
      expect($('lrBody').hidden).toBe(true);
      jest.restoreAllMocks();
    }
  });

  test('innerHTML 을 쓰지 않는다 · sw.js 가 보고서를 담는다', () => {
    expect(read('segan/ledger-report.js')).not.toMatch(/innerHTML/);
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'ledger-report.html'");
    expect(sw).toContain("versioned(SCOPE + 'ledger-report.js')");
  });
});

describe('월 마감 메모 (2026-11-06 6-L3)', () => {
  const MEMO = (month = '2026-10') => ({
    month,
    prev_month: '2026-09',
    available: true,
    vat_type: 'general',
    items: [
      { key: 'noevid', label: '증빙 없는 지출', n: 1, amount: 55000, rows: [{ date: '2026-10-05', name: '가나상사', account: null, amount: 55000 }] },
      { key: 'simple30k', label: '3만 원 넘는데 간이영수증', n: 0, amount: 0, rows: [] },
      { key: 'invoice', label: '세금계산서 기다리는 명세표', n: 2 },
      { key: 'photos', label: '확인 안 한 사진', n: 0 },
      { key: 'late', label: '늦은 받을 돈', n: 1, amount: 4500000, rows: [{ order_no: '2610-03', stage: 'interim', due_on: '2026-10-25', amount: 4500000 }] },
      { key: 'vat', label: '부가세', n: 1, amount: 1960000, income_vat: 4820000, expense_vat: 2860000, counted: true },
      { key: 'acct', label: '전달보다 크게 바뀐 계정', n: 1, rows: [{ account: 'purchase.materials', amount: 22400000, prev: 15000000, diff: 7400000, rate: 49.3 }] },
      { key: 'dup', label: '중복 의심', n: 1, rows: [{ date: '2026-10-01', name: '가나목재' }] },
    ],
  });

  test('그 달 메모를 묻고, 0 인 것은 빼고 서버 차례대로 · 줄마다 작은 글', async () => {
    const calls = await load({ search: '?month=2026-10', memo: (url) => ok(MEMO(new URL(url).searchParams.get('month'))) });
    expect(calls.some((c) => c.url === WORK + '/ledger/close-memo?month=2026-10')).toBe(true);
    expect($('lrMemoBox').hidden).toBe(false);
    const items = [...$('lrMemo').children].map((li) => [li.firstChild.textContent, [...li.querySelectorAll('small')].map((s) => s.textContent)]);
    expect(items).toEqual([
      ['증빙 없는 지출 1건 · 55,000원', ['10.05 · 가나상사 · 55,000원']],
      ['세금계산서 기다리는 명세표 2장', []],
      ['늦은 받을 돈 1건 · 4,500,000원', ['2610-03 · 중도금 · 10.25까지 · 4,500,000원']],
      ['부가세 (받은 − 낸) 1,960,000원 · 부가세 모르는 줄 1줄', []],
      ['전달보다 크게 바뀐 계정', ['재료비 매입 22,400,000원 (전달 15,000,000원 · +49.3%)']],
      ['중복 의심 1건', ['10.01 · 가나목재']],
    ]);
  });

  test('손볼 곳이 없으면 한 줄, 서버가 모르면(0034 전 · 오류) 칸째 감춘다', async () => {
    const empty = { ...MEMO(), items: MEMO().items.map((x) => ({ ...x, n: 0, rows: [], counted: false })) };
    await load({ search: '?month=2026-10', memo: () => ok(empty) });
    expect($('lrMemoBox').hidden).toBe(false);
    expect($('lrMemo').textContent).toBe('손볼 곳이 없습니다.');
    await load({ search: '?month=2026-10', memo: () => fail(500, 'x', 'boom') });
    expect($('lrMemoBox').hidden).toBe(true);
    await load({ search: '?month=2026-10' });
    expect($('lrMemoBox').hidden).toBe(true);
  });

  test('본사 보기(?company=)도 그 장부의 메모', async () => {
    const C = '11111111-1111-4111-8111-111111111111';
    const calls = await load({ search: '?month=2026-10&company=' + C, memo: () => ok(MEMO()) });
    expect(calls.some((c) => c.url === WORK + '/ledger/close-memo?month=2026-10&company=' + C)).toBe(true);
  });
});
