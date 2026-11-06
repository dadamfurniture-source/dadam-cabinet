/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 회계 한눈에 (segan/ledger-board.html + segan/ledger-board.js)
 *
 *   데이터  GET /ledger/dashboard?month=&months=12 (+?company= 본사 보기) · /ledger/accounts · /books/summary?month= (본사 보기에서는 없다)
 *   칸 넷   매출(받은 돈) · 매입 · 장부 손익(지난달과) · 부가세 참고(일반과세만, 반기 합)
 *   그림    12달 막대 — 고른 달만 숫자, 막대를 누르면 그 달로, 표로 보기. 계정별 · 지출 상대 가로 막대
 *   그 밖   수주 · 미수 · 30일 안 받을 돈, 장부 상태 줄, 403 · 0034 전은 한 줄
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const WORK = 'https://work.example.workers.dev';
const HQ = 'c0000000-0000-4000-8000-0000000000b2';
const NOW = Date.parse('2026-11-03T03:00:00Z'); // 한국 시간 11월 3일

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});

const months12 = (end = '2026-11') => {
  const [y, m] = end.split('-').map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 12 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
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
const DASH = (month = '2026-11', over = {}) => ({
  month,
  from: '2025-12-01',
  to: '2026-11-30',
  available: true,
  vat_type: 'general',
  months: months12(month).map((mm) => {
    if (mm === '2026-07')
      return {
        ...ZERO,
        month: mm,
        income: 5000000,
        income_vat: 500000,
        expense: 2000000,
        expense_vat: 200000,
      };
    if (mm === '2026-10')
      return {
        ...ZERO,
        month: mm,
        income: 30000000,
        income_vat: 3000000,
        expense: 21000000,
        expense_vat: 1900000,
      };
    if (mm === '2026-11')
      return {
        ...ZERO,
        month: mm,
        income: 46000000,
        income_vat: 4600000,
        expense: 31000000,
        expense_vat: 2860000,
        asset_buy: 1000000,
        account_unknown: 2,
        vat_unknown: 1,
        evidence_risk: 3,
      };
    return { ...ZERO, month: mm };
  }),
  accounts: [
    {
      direction: 'expense',
      account: 'purchase.materials',
      amount: 21500000,
      vat_amount: 2150000,
      n: 9,
    },
    {
      direction: 'asset_buy',
      account: 'asset.tangible',
      amount: 1000000,
      vat_amount: 100000,
      n: 1,
    },
    { direction: 'expense', account: null, amount: 900000, vat_amount: 0, n: 2 },
  ],
  suppliers: [
    { name: '가나목재', amount: 11800000, n: 4 },
    { name: '다라철물', amount: 5200000, n: 3 },
  ],
  pending_photos: 14,
  level: 'full',
  viewing: false,
  ...over,
});
const BOOKS = {
  month: '2026-11',
  months: [{ month: '2026-11', contract_total: 62000000, received_total: 50600000 }],
  outstanding: { total: 13500000, count: 4 },
  upcoming: [
    { order_id: 'o1', order_no: 'SO-1', stage: 'balance', amount: 9800000, due_on: '2026-11-08' },
  ],
};

async function load(options = {}) {
  const opts = {
    dash: (url) => ok(DASH(new URL(url).searchParams.get('month'))),
    accounts: ok({
      items: [
        { code: 'purchase.materials', name: '재료비 매입' },
        { code: 'asset.tangible', name: '유형자산' },
      ],
    }),
    books: () => ok(BOOKS),
    search: '',
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/ledger-board.html' + opts.search);
  const doc = new DOMParser().parseFromString(read('segan/ledger-board.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'DadamMyPageWork', 'SeganShell', 'SeganLedgerBoard'])
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
    calls.push({ url, method: init.method || 'GET', auth: (init.headers || {}).Authorization });
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    if (url.startsWith(WORK + '/ledger/dashboard')) return reply(opts.dash(url));
    if (url === WORK + '/ledger/accounts') return reply(opts.accounts);
    if (url.startsWith(WORK + '/books/summary')) return reply(opts.books(url));
    return reply(ok({ ready: true, worker: null })); // /work/me 등
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/ledger-board.js'));
  await window.SeganShell.ready;
  await window.SeganLedgerBoard.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const tiles = () =>
  [...$('lbTiles').querySelectorAll('.lb-tile')].map((t) => [
    t.querySelector('dt').textContent,
    t.querySelector('.lb-tile-v').textContent,
    (t.querySelector('.lb-tile-s') || {}).textContent || '',
  ]);
const dashGets = (calls) => calls.filter((c) => c.url.startsWith(WORK + '/ledger/dashboard'));

afterEach(() => {
  jest.restoreAllMocks();
});

describe('회계 한눈에', () => {
  test('이번 달 — 칸 넷(손익 · 반기 부가세 참고), 12달 막대(고른 달만 숫자), 계정별 · 지출 상대, 수주 · 미수, 장부 상태', async () => {
    const calls = await load();
    expect(dashGets(calls).map((c) => c.url)).toEqual([
      WORK + '/ledger/dashboard?month=2026-11&months=12',
    ]);
    expect(calls.filter((c) => c.url === WORK + '/books/summary?month=2026-11').length).toBe(1);
    expect($('lbBody').hidden).toBe(false);
    expect($('lbMonth').textContent).toBe('2026년 11월');
    expect($('lbNext').disabled).toBe(true);
    expect(tiles()).toEqual([
      ['매출 (받은 돈)', '46,000,000원', '부가세 4,600,000원 따로'],
      ['매입', '31,000,000원', '공제 부가세 2,860,000원 · 자산 사기 1,000,000원'],
      ['장부 손익', '15,000,000원', '지난달보다 +6,000,000원'],
      // 7~12월: (500,000 − 200,000) + (3,000,000 − 1,900,000) + (4,600,000 − 2,860,000)
      ['부가세 참고 (7~12월)', '3,140,000원', '매출세액 − 매입세액 · 참고'],
    ]);
    const svg = $('lbChart').querySelector('svg');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.querySelectorAll('.lb-month').length).toBe(12);
    expect(svg.querySelectorAll('.lb-bar--in').length).toBe(12);
    // 고른 달(마지막)만 숫자 — 만원
    expect([...svg.querySelectorAll('.lb-lbl')].map((t) => t.textContent)).toEqual([
      '4,600',
      '3,100',
    ]);
    expect(svg.querySelector('[data-month="2026-11"] title').textContent).toBe(
      '2026년 11월 — 매출 46,000,000원 · 매입 31,000,000원'
    );
    expect($('lbTableBody').querySelectorAll('tr').length).toBe(12);
    expect(
      [...$('lbAccounts').querySelectorAll('.lb-hb')].map((r) => [
        r.querySelector('.lb-hb-n').textContent,
        r.querySelector('.lb-hb-v').textContent,
      ])
    ).toEqual([
      ['재료비 매입', '2,150'],
      ['유형자산 (자산)', '100'],
      ['계정 미정', '90'],
    ]);
    expect([...$('lbSuppliers').querySelectorAll('.lb-hb-n')].map((n) => n.textContent)).toEqual([
      '가나목재',
      '다라철물',
    ]);
    expect($('lbBooks').hidden).toBe(false);
    expect($('lbBooksKv').textContent).toContain('62,000,000원');
    expect($('lbBooksKv').textContent).toContain('13,500,000원 · 4건');
    expect($('lbUpcoming').textContent).toContain('11.08 · 잔금');
    expect(
      [...$('lbStatus').querySelectorAll('li')].map((li) => [li.textContent, li.className])
    ).toEqual([
      ['확인 기다리는 사진 14장', 'lb-chip'],
      ['증빙 경고 3건', 'lb-chip lb-chip--warn'],
      ['계정 미정 2줄', 'lb-chip lb-chip--warn'],
      ['부가세 포함 합계로 적힌 원가 1줄', 'lb-chip lb-chip--warn'],
    ]);
    expect($('lbStatus').querySelector('a').getAttribute('href')).toBe('ledger.html');
  });

  test('막대 · ‹ 를 누르면 그 달까지 12달로 다시, 부가세 참고는 일반과세만', async () => {
    const calls = await load({
      dash: (url) => {
        const m = new URL(url).searchParams.get('month');
        return ok(DASH(m, m === '2026-10' ? { vat_type: 'simplified' } : {}));
      },
    });
    $('lbChart')
      .querySelector('[data-month="2026-10"] .lb-hit')
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    expect(dashGets(calls).at(-1).url).toBe(WORK + '/ledger/dashboard?month=2026-10&months=12');
    expect($('lbMonth').textContent).toBe('2026년 10월');
    expect($('lbNext').disabled).toBe(false);
    expect(tiles()[3]).toEqual(['부가세 참고', '-', '일반과세 업체만 보입니다']);
    $('lbPrev').click();
    await flush();
    expect(dashGets(calls).at(-1).url).toBe(WORK + '/ledger/dashboard?month=2026-09&months=12');
  });

  test('본사 보기(?company=) — 대시보드에 붙이고, 수주 · 미수는 묻지 않는다 · 장부로 돌아가는 길에도 붙인다', async () => {
    const calls = await load({ search: `?company=${HQ}` });
    expect(dashGets(calls)[0].url).toBe(
      `${WORK}/ledger/dashboard?month=2026-11&months=12&company=${HQ}`
    );
    expect(calls.some((c) => c.url.startsWith(WORK + '/books/'))).toBe(false);
    expect($('lbBooks').hidden).toBe(true);
    expect($('lbBack').getAttribute('href')).toBe(`ledger.html?company=${HQ}`);
  });

  test('모아 둔 명세표가 있으면 장부 상태에 「세금계산서 기다리는 명세표」 (장부로)', async () => {
    await load({
      dash: (url) => ok({ ...DASH(new URL(url).searchParams.get('month')), held_statements: 3 }),
    });
    const chips = [...$('lbStatus').querySelectorAll('li')].map((li) => li.textContent);
    expect(chips.slice(0, 2)).toEqual([
      '확인 기다리는 사진 14장',
      '세금계산서 기다리는 명세표 3장',
    ]);
    expect($('lbStatus').querySelectorAll('a')[1].getAttribute('href')).toBe('ledger.html');
  });

  test('지출 상대 — 서버가 10곳을 줘도 한눈에는 큰 5곳만 (보고서가 10곳)', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({
      name: `상호${i + 1}`,
      amount: (10 - i) * 100000,
      n: 1,
    }));
    await load({
      dash: (url) => ok({ ...DASH(new URL(url).searchParams.get('month')), suppliers: ten }),
    });
    expect([...$('lbSuppliers').querySelectorAll('.lb-hb-n')].map((n) => n.textContent)).toEqual([
      '상호1',
      '상호2',
      '상호3',
      '상호4',
      '상호5',
    ]);
    expect($('lbSupTitle').textContent).toBe('11월 지출 상대 · 상위 5 (만원)');
  });

  test('직원 403 · 0034 전 — 한 줄만', async () => {
    await load({ dash: () => fail(403, 'not_money', 'x') });
    expect($('lbBody').hidden).toBe(true);
    expect($('lbState').textContent).toBe('회계 한눈에는 팩토리 대표 · 실장만 봅니다.');
    await load({ dash: () => ok({ available: false, month: '2026-11' }) });
    expect($('lbBody').hidden).toBe(true);
    expect($('lbState').textContent).toBe(
      '회계 한눈에를 준비하는 중입니다. 잠시 뒤 다시 열어 주세요.'
    );
  });

  test('순수 — 달 옮기기 · 반기 부가세 · 달 이름', async () => {
    await load();
    const { shiftMonth, vatHalf, monthLabel } = window.SeganLedgerBoard;
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(vatHalf(DASH(), '2026-03')).toEqual({ label: '1~6월', amount: 0 });
    expect(monthLabel('2026-03')).toBe('2026년 3월');
  });

  test('sw.js 가 회계 한눈에를 담는다 · innerHTML 을 쓰지 않는다', () => {
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'ledger-board.html'");
    expect(sw).toContain("versioned(SCOPE + 'ledger-board.js')");
    expect(read('segan/ledger-board.js')).not.toMatch(/innerHTML/);
  });
});
