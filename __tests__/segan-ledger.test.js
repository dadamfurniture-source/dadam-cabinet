/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 업체 회계장부 (segan/ledger.html + segan/ledger.js)
 *
 *   누가    GET /ledger/me — 대표 · 실장(money)만 장부. 직원 · 구성원 아님 · 자격 없음은 이유 한 줄, 장부를 묻지 않는다
 *           자격 read 는 보기만 (입력 · 고치기 · 취소 · 설정 저장 없음)
 *   화면    「종이 원본 5년 보관」 · 과세 설정 · 달 요약 · 장부 줄(직접 · 수금 · 수주 원가), 취소한 줄은 켜야 보인다
 *   쓰기    직접 입력은 X-Idempotency-Key, 고치기는 바뀐 칸 + 이유만, 취소는 이유 필수
 *   고르기  ledgers 가 둘 이상(다담 본사 대표 · 실장)이면 장부 고르기 — 남의 장부는 ?company= · 보기만
 *   사진    can_upload 면 찍기 · 앨범 → JPEG 로 다시 그려(긴 변 2576 · 375만 화소) 한 장씩 POST /ledger/documents
 *           (사진마다 X-Idempotency-Key, 메모는 X-Ledger-Note). 분 한도 429 면 쉬었다가 이어 올리기,
 *           하루 한도 429 면 남은 사진을 멈춰 두고 다시 올리기,
 *           413 · 422 · 못 여는 사진은 다시 올리지 않는다. 직원은 사진 칸만 (장부 · 계정을 묻지 않는다)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const WORK = 'https://work.example.workers.dev';
const NOW = Date.parse('2026-11-02T03:00:00Z'); // 한국 시간 2026-11-02 12:00
const E1 = 'e0000000-0000-4000-8000-000000000001';
const E2 = 'e0000000-0000-4000-8000-000000000002';

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
  tax: { vat_type: 'general', business_kind: 'manufacturing' },
};
const ACCOUNTS = [
  { code: 'income.sales', name: '매출액', grp: 'income', note: null },
  { code: 'purchase.materials', name: '재료비 매입', grp: 'purchase', note: '제조' },
  { code: 'admin.rent', name: '임차료', grp: 'admin', note: null },
  { code: 'asset.tangible', name: '유형자산', grp: 'asset', note: null },
];
const ROWS = [
  {
    source: 'entry',
    id: E1,
    entry_date: '2026-11-01',
    seq: 1,
    direction: 'expense',
    account: 'admin.rent',
    description: '11월 임대료',
    counterparty_name: '건물주',
    amount: 1000000,
    vat_amount: 100000,
    vat_computed: false,
    evidence_type: 'tax_invoice',
    order_id: null,
    order_no: null,
    voided_at: null,
  },
  {
    source: 'entry',
    id: E2,
    entry_date: '2026-11-01',
    seq: 2,
    direction: 'expense',
    account: 'admin.rent',
    description: '잘못 적음',
    counterparty_name: null,
    amount: 5,
    vat_amount: 0,
    vat_computed: false,
    evidence_type: 'none',
    order_id: null,
    order_no: null,
    voided_at: '2026-11-02T00:00:00Z',
  },
  {
    source: 'payment',
    id: 'p1',
    entry_date: '2026-11-02',
    seq: null,
    direction: 'income',
    account: 'income.sales',
    description: 'deposit',
    counterparty_name: '고객 가',
    amount: 1000000,
    vat_amount: 100000,
    vat_computed: true,
    evidence_type: null,
    order_id: 'o1',
    order_no: 'SO-1',
    voided_at: null,
  },
  {
    source: 'cost',
    id: 'c1',
    entry_date: '2026-11-02',
    seq: null,
    direction: 'expense',
    account: null,
    description: '설치 인건비',
    counterparty_name: null,
    amount: 300000,
    vat_amount: null,
    vat_computed: false,
    evidence_type: null,
    order_id: 'o1',
    order_no: 'SO-1',
    voided_at: null,
  },
];
const BOOK = (month = '2026-11') => ({
  from: `${month}-01`,
  to: `${month}-30`,
  level: 'full',
  rows: month === '2026-11' ? ROWS : [],
  totals:
    month === '2026-11'
      ? {
          income: 1000000,
          expense: 1300000,
          asset_buy: 0,
          asset_sell: 0,
          income_vat: 100000,
          expense_vat: 100000,
          vat_unknown: 1,
          account_unknown: 1,
        }
      : {
          income: 0,
          expense: 0,
          asset_buy: 0,
          asset_sell: 0,
          income_vat: 0,
          expense_vat: 0,
          vat_unknown: 0,
          account_unknown: 0,
        },
});

async function load(options = {}) {
  const opts = {
    me: ok(ME),
    accounts: ok({ items: ACCOUNTS }),
    book: (month) => ok(BOOK(month)),
    write: () => ok({ entry: { id: 'new' }, reused: false }, 201),
    docs: () => ok({ items: [], money: true }),
    upload: () => ok({ document: { id: 'd-new' }, reused: false }, 201),
    review: () => ok({ items: [], level: 'full', viewing: false }),
    decide: () => ok({ document_id: 'x' }, 201),
    batch: () => ok({ items: [], posted: 0 }),
    business: () => ok({ available: false, biz_no: '' }),
    orders: () => ok({ items: [] }),
    held: () => ok({ available: true, groups: [], count: 0 }),
    heldEntries: () => ok({ items: [] }),
    suppliers: () => ok({ available: true, items: [] }),
    attach: () => ok({ attached: 0, compare: { n: 0 }, dry_run: true }),
    hold: () => ok({ held: 0 }),
    // 한눈에 탭 (ledger-board.js) — 처음 여는 탭
    dash: () =>
      ok({
        available: true,
        vat_type: 'general',
        months: [],
        accounts: [],
        suppliers: [],
        pending_photos: 0,
        held_statements: 0,
      }),
    booksSummary: () => ok({ months: [], outstanding: { total: 0, count: 0 }, upcoming: [] }),
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/ledger.html' + (opts.search || ''));
  const doc = new DOMParser().parseFromString(read('segan/ledger.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganLedger',
    'SeganLedgerBoard',
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
    const headers = init.headers || {};
    calls.push({
      url,
      method: init.method || 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      raw: init.body && typeof init.body !== 'string' ? init.body : null,
      key: headers['X-Idempotency-Key'] || null,
      auth: headers.Authorization,
      headers,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url.startsWith(WORK + '/ledger/dashboard')) return reply(opts.dash(url));
    if (url.startsWith(WORK + '/books/summary')) return reply(opts.booksSummary(url));
    if (url.startsWith(WORK + '/ledger/me'))
      return reply(typeof opts.me === 'function' ? opts.me(url) : opts.me);
    if (url === WORK + '/ledger/accounts') return reply(opts.accounts);
    if (url.startsWith(WORK + '/ledger/book'))
      return reply(opts.book(new URL(url).searchParams.get('month')));
    if (url === WORK + '/ledger/review/post') return reply(opts.batch(url, init));
    if (url.startsWith(WORK + '/ledger/review')) return reply(opts.review(url));
    if (/\/ledger\/documents\/[^/]+\/(post|return|reject|reread)$/.test(url))
      return reply(opts.decide(url, init));
    if (url.startsWith(WORK + '/ledger/business-status')) return reply(opts.business(url));
    if (url === WORK + '/ledger/orders') return reply(opts.orders(url));
    if (url.startsWith(WORK + '/ledger/held/entries')) return reply(opts.heldEntries(url));
    if (url.startsWith(WORK + '/ledger/held')) return reply(opts.held(url));
    if (url.startsWith(WORK + '/ledger/suppliers')) return reply(opts.suppliers(url, init));
    if (/\/ledger\/entries\/[^/]+\/attach$/.test(url)) return reply(opts.attach(url, init));
    if (/\/ledger\/documents\/(hold|unhold)$/.test(url)) return reply(opts.hold(url, init));
    if (url.startsWith(WORK + '/ledger/documents'))
      return reply(init.method === 'POST' ? opts.upload(url, init) : opts.docs(url));
    if (url.startsWith(WORK + '/ledger/')) return reply(opts.write(url, init));
    return reply(ok({ ready: true, worker: null })); // /work/me
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/ledger-board.js'));
  (0, eval)(read('segan/ledger.js'));
  await window.SeganShell.ready;
  await window.SeganLedger.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const items = () => [...$('lgList').querySelectorAll('.lg-item')];
const sum = () =>
  Object.fromEntries(
    [...$('lgSum').querySelectorAll('div')].map((d) => [
      d.querySelector('dt').textContent,
      d.querySelector('dd').textContent,
    ])
  );
const ledgerCalls = (calls) => calls.filter((c) => c.url.startsWith(WORK + '/ledger/'));
const set = (id, v) => {
  $(id).value = v;
  $(id).dispatchEvent(new window.Event('change'));
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('보기', () => {
  test('대표 — 안내 · 과세 설정 · 달 요약 · 장부 줄 (취소한 줄은 감춘다)', async () => {
    const calls = await load();
    expect($('lgKeep').textContent).toContain('종이 원본은 5년 보관');
    expect($('lgTabs').hidden).toBe(false);
    expect($('lgTaxNote').textContent).toBe('일반과세 · 제조');
    expect($('lgMonth').textContent).toBe('2026년 11월');
    expect($('lgNext').disabled).toBe(true);
    expect(sum()).toEqual({
      수입: '1,000,000원',
      비용: '1,300,000원',
      '장부 손익': '-300,000원',
      '받은 부가세': '100,000원',
      '낸 부가세': '100,000원',
    });
    expect($('lgSumNote').hidden).toBe(false);
    expect($('lgSumNote').textContent).toContain('부가세를 모르는 줄 1개');
    expect($('lgSumNote').textContent).toContain('계정이 정해지지 않은 원가 줄 1개');
    expect(items().map((li) => li.getAttribute('data-id'))).toEqual([E1, 'p1', 'c1']);
    const [rent, pay, cost] = items();
    expect(rent.querySelector('b').textContent).toBe('임차료');
    expect(rent.querySelector('.lg-amt').textContent).toBe('−1,000,000원');
    expect(rent.querySelector('.lg-meta').textContent).toBe('부가세 100,000원 · 세금계산서');
    expect(pay.querySelector('small').textContent).toBe('11.02 · 수금 · 계약금 · 고객 가 · SO-1');
    expect(pay.querySelector('.lg-amt').textContent).toBe('+1,000,000원');
    expect(pay.querySelector('.lg-meta').textContent).toBe('부가세 100,000원 (계산값)');
    expect(cost.querySelector('b').textContent).toBe('계정 미정');
    expect(cost.querySelector('.lg-meta').textContent).toBe('부가세 모름');
    // 고치기 · 취소는 직접 입력한 줄에만
    expect(rent.querySelector('[data-act="edit"]')).not.toBeNull();
    expect(pay.querySelector('[data-act]')).toBeNull();
    expect(cost.querySelector('[data-act]')).toBeNull();
    const book = calls.find((c) => c.url.startsWith(WORK + '/ledger/book'));
    expect(book.url).toBe(WORK + '/ledger/book?month=2026-11&include_void=1');
    expect(book.auth).toBe('Bearer tok-1');

    $('lgShowVoid').checked = true;
    $('lgShowVoid').dispatchEvent(new window.Event('change'));
    const voided = items().find((li) => li.getAttribute('data-id') === E2);
    expect(voided.classList.contains('lg-item--void')).toBe(true);
    expect(voided.querySelector('.lg-meta').textContent).toContain('취소한 줄');
    expect(voided.querySelector('[data-act]')).toBeNull();
  });

  test('달 바꾸기 — 지난달을 묻고, 이번 달 뒤로는 가지 않는다', async () => {
    const calls = await load();
    $('lgPrev').click();
    await flush();
    const books = calls.filter((c) => c.url.startsWith(WORK + '/ledger/book'));
    expect(books.at(-1).url).toBe(WORK + '/ledger/book?month=2026-10&include_void=1');
    // 한눈에 탭도 같은 달로
    const dash = calls.filter((c) => c.url.startsWith(WORK + '/ledger/dashboard'));
    expect(dash.at(-1).url).toBe(WORK + '/ledger/dashboard?month=2026-10&months=12');
    expect($('lgMonth').textContent).toBe('2026년 10월');
    expect($('lgList').textContent).toContain('이 달 장부 줄이 없습니다');
    $('lgNext').click();
    await flush();
    expect($('lgMonth').textContent).toBe('2026년 11월');
    const n = calls.length;
    $('lgNext').click();
    await flush();
    expect(calls.length).toBe(n);
  });

  test('직원 · 구성원 아님 · 자격 없음 — 이유 한 줄, 장부를 묻지 않는다', async () => {
    for (const [me, text] of [
      [
        ok({
          ...ME,
          role: 'staff',
          money: false,
          can_upload: false,
          can_write: false,
          tax: undefined,
        }),
        '장부는 업체 대표 · 실장만 봅니다.',
      ],
      [fail(403, 'not_member', 'x'), '장부는 업체 구성원만 씁니다.'],
      [fail(403, 'not_entitled', 'x'), '회계는 Expert · Agent 업체가 씁니다.'],
      [fail(500, '', 'x'), '장부를 불러오지 못했습니다.'],
    ]) {
      const calls = await load({ me });
      expect($('lgState').textContent).toBe(text);
      expect($('lgTabs').hidden).toBe(true);
      expect($('lgPhotos').hidden).toBe(true);
      expect(ledgerCalls(calls).map((c) => c.url)).toEqual([WORK + '/ledger/me']);
      jest.restoreAllMocks();
    }
  });

  test('자격 read — 보기만 (입력 · 고치기 · 취소 · 설정 저장 없음)', async () => {
    await load({ me: ok({ ...ME, level: 'read', can_upload: false, can_write: false }) });
    expect($('lgReadonly').hidden).toBe(false);
    expect($('lgAdd').hidden).toBe(true);
    expect($('lgTaxSave').hidden).toBe(true);
    expect($('lgVatType').disabled).toBe(true);
    expect($('lgList').querySelector('[data-act]')).toBeNull();
    expect($('lgPhotos').hidden).toBe(false);
    expect($('lgUp').hidden).toBe(true);
  });
});

describe('탭 (한눈에 · 매출 · 매입 · 사진 · 설정)', () => {
  const tabOn = () =>
    document.querySelector('#lgTabs [aria-selected="true"]').getAttribute('data-tab');
  const shown = () =>
    ['lgPaneBoard', 'lgPaneBook', 'lgPanePhotos', 'lgPaneSettings'].filter((id) => !$(id).hidden);
  const click = async (tab) => {
    document.querySelector('#lgTabs [data-tab="' + tab + '"]').click();
    await flush();
  };

  test('처음은 한눈에 — 같은 달 대시보드 · 수주 요약, 매출 · 매입은 한 장부를 방향으로 나눠 보인다', async () => {
    const calls = await load();
    expect($('lgTabs').hidden).toBe(false);
    expect(tabOn()).toBe('board');
    expect(shown()).toEqual(['lgPaneBoard']);
    expect(calls.find((c) => c.url.startsWith(WORK + '/ledger/dashboard')).url).toBe(
      WORK + '/ledger/dashboard?month=2026-11&months=12'
    );
    expect($('lbBody').hidden).toBe(false);
    await click('sales');
    expect(shown()).toEqual(['lgPaneBook']);
    expect($('lgBookTitle').textContent).toBe('매출 — 받은 돈 · 수입');
    expect(items().map((li) => li.getAttribute('data-id'))).toEqual(['p1']);
    $('lgAdd').click();
    expect($('lgDir').value).toBe('income');
    $('lgCancel').click();
    await click('buys');
    expect($('lgBookTitle').textContent).toBe('매입 — 낸 돈 · 비용');
    expect(items().map((li) => li.getAttribute('data-id'))).toEqual([E1, 'c1']);
    $('lgAdd').click();
    expect($('lgDir').value).toBe('expense');
    await click('settings');
    expect(shown()).toEqual(['lgPaneSettings']);
    expect($('lgTaxNote').textContent).toBe('일반과세 · 제조');
    // 다시 한눈에 — 그린 달이면 다시 묻지 않는다
    const n = calls.filter((c) => c.url.startsWith(WORK + '/ledger/dashboard')).length;
    await click('board');
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/dashboard')).length).toBe(n);
  });

  test('주소 #photos · ?month= 로 열기 — 사진 판 · 그 달, 사진 탭 옆에 확인할 사진 수, 알림 한 줄은 누르면 닫는다', async () => {
    const rv = (n) => ({
      id: 'r' + n,
      created_at: '2026-11-02T0' + n + ':00:00Z',
      review_status: 'pending',
      note: null,
      photo_url: null,
      photo_expires_in: 600,
      extraction: null,
    });
    const calls = await load({
      search: '?month=2026-09#photos',
      review: () => ok({ items: [rv(1), rv(2)], level: 'full', viewing: false }),
    });
    expect(tabOn()).toBe('photos');
    expect(shown()).toEqual(['lgPanePhotos']);
    expect($('lgMonth').textContent).toBe('2026년 9월');
    expect(calls.find((c) => c.url.startsWith(WORK + '/ledger/book')).url).toBe(
      WORK + '/ledger/book?month=2026-09&include_void=1'
    );
    expect(calls.some((c) => c.url.startsWith(WORK + '/ledger/dashboard'))).toBe(false);
    expect($('lgTabPhotosN').hidden).toBe(false);
    expect($('lgTabPhotosN').textContent).toBe('2');
    $('lgState').textContent = '저장했습니다.';
    $('lgState').click();
    expect($('lgState').textContent).toBe('');
  });

  test('한눈에의 막대를 누르면 화면 전체의 달이 바뀐다 (장부 · 한눈에)', async () => {
    const calls = await load();
    window.SeganLedgerBoard.state.onMonth('2026-10');
    await flush();
    expect($('lgMonth').textContent).toBe('2026년 10월');
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).at(-1).url).toBe(
      WORK + '/ledger/book?month=2026-10&include_void=1'
    );
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/dashboard')).at(-1).url).toBe(
      WORK + '/ledger/dashboard?month=2026-10&months=12'
    );
  });

  test('직원 — 탭 없이 사진 판만 (한눈에 · 장부를 묻지 않는다)', async () => {
    const calls = await load({
      me: ok({
        ...ME,
        role: 'staff',
        money: false,
        can_upload: true,
        can_write: false,
        tax: undefined,
      }),
      docs: () => ok({ items: [], money: false }),
    });
    expect($('lgTabs').hidden).toBe(true);
    expect($('lgPanePhotos').hidden).toBe(false);
    expect($('lgPaneBoard').hidden).toBe(true);
    expect(calls.some((c) => /\/ledger\/(dashboard|book)/.test(c.url))).toBe(false);
  });
});

describe('쓰기', () => {
  test('직접 입력 — 구분마다 계정, 확인 뒤 X-Idempotency-Key 와 함께 보내고 장부를 다시 읽는다', async () => {
    const calls = await load();
    $('lgAdd').click();
    expect($('lgForm').hidden).toBe(false);
    expect($('lgDate').value).toBe('2026-11-02');
    expect([...$('lgAccount').options].map((o) => o.value)).toEqual([
      'purchase.materials',
      'admin.rent',
    ]);
    set('lgDir', 'income');
    expect([...$('lgAccount').options].map((o) => o.value)).toEqual(['income.sales']);
    set('lgDir', 'expense');
    set('lgAccount', 'admin.rent');
    $('lgForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect($('lgFormError').textContent).toBe('금액을 1원 이상 정수로 적어 주세요.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    set('lgAmount', '200000');
    set('lgVat', '20000');
    set('lgEvidence', 'card');
    set('lgMethod', 'card');
    $('lgDesc').value = ' 소모품 ';
    $('lgCpBiz').value = '124-81-00998';
    $('lgForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe(WORK + '/ledger/entries');
    expect(post.key).toMatch(/^[A-Za-z0-9_.:-]{1,200}$/);
    expect(post.body).toEqual({
      entry_date: '2026-11-02',
      direction: 'expense',
      account: 'admin.rent',
      description: '소모품',
      counterparty_name: null,
      counterparty_biz_no: '124-81-00998',
      amount: 200000,
      vat_amount: 20000,
      evidence_type: 'card',
      payment_method: 'card',
    });
    expect($('lgForm').hidden).toBe(true);
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).length).toBe(2);
  });

  test('직접 입력 — 서버가 거절하면 그 말을 칸 아래에, 같은 칸에서 다시 누르면 같은 키', async () => {
    let n = 0;
    const calls = await load({
      write: () =>
        ++n === 1
          ? fail(422, '', '「임차료」 계정은 이 방향(income)에 쓰지 않습니다')
          : ok({ entry: { id: 'x' } }, 201),
    });
    $('lgAdd').click();
    set('lgAmount', '1000');
    set('lgEvidence', 'none');
    $('lgForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect($('lgFormError').textContent).toContain('쓰지 않습니다');
    $('lgForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts.length).toBe(2);
    expect(posts[0].key).toBe(posts[1].key);
  });

  test('고치기 — 바뀐 칸과 이유만 보낸다 (이유 · 바뀐 칸이 없으면 보내지 않는다)', async () => {
    const calls = await load({ write: () => ok({ entry: { id: 'n' }, replaced: E1 }, 201) });
    items()[0].querySelector('[data-act="edit"]').click();
    expect($('lgFormTitle').textContent).toBe('장부 줄 고치기');
    expect($('lgReasonRow').hidden).toBe(false);
    expect($('lgAmount').value).toBe('1000000');
    expect($('lgAccount').value).toBe('admin.rent');
    $('lgReason').value = '금액 고침';
    $('lgForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect($('lgFormError').textContent).toBe('바뀐 칸이 없습니다.');
    set('lgAmount', '900000');
    $('lgReason').value = '';
    $('lgForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    expect($('lgFormError').textContent).toBe('고치는 이유를 적어 주세요.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    $('lgReason').value = '금액 고침';
    $('lgForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe(`${WORK}/ledger/entries/${E1}/correct`);
    expect(post.body).toEqual({ amount: 900000, reason: '금액 고침' });
  });

  test('취소 — 이유 칸을 열고, 이유가 있어야 보낸다', async () => {
    const calls = await load({ write: () => ok({ entry: { id: E1 } }) });
    items()[0].querySelector('[data-act="void"]').click();
    const ok1 = $('lgList').querySelector('[data-act="void-ok"]');
    expect(ok1).not.toBeNull();
    ok1.click();
    await flush();
    expect($('lgState').textContent).toBe('취소 이유를 적어 주세요.');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    $('lgList').querySelector('[data-void-reason]').value = '두 번 적음';
    $('lgList').querySelector('[data-act="void-ok"]').click();
    await flush();
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe(`${WORK}/ledger/entries/${E1}/void`);
    expect(post.body).toEqual({ reason: '두 번 적음' });
  });

  test('과세 설정 저장 — 둘 다 골라야 보내고, 저장 뒤 장부를 다시 읽는다', async () => {
    const calls = await load({
      write: () => ok({ vat_type: 'simplified', business_kind: 'retail' }),
    });
    set('lgVatType', '');
    $('lgTaxSave').click();
    await flush();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    set('lgVatType', 'simplified');
    set('lgBizKind', 'retail');
    $('lgTaxSave').click();
    await flush();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.url).toBe(WORK + '/ledger/settings');
    expect(put.body).toEqual({ vat_type: 'simplified', business_kind: 'retail' });
    expect($('lgTaxNote').textContent).toBe('간이과세 · 도소매');
  });
});

describe('순수 함수', () => {
  test('고치기 칸 비교 — 장부 보기에 없는 칸은 적었을 때만', async () => {
    await load();
    const L = window.SeganLedger;
    const row = ROWS[0];
    const same = {
      entry_date: row.entry_date,
      direction: row.direction,
      account: row.account,
      description: row.description,
      counterparty_name: row.counterparty_name,
      amount: row.amount,
      vat_amount: row.vat_amount,
      evidence_type: row.evidence_type,
      payment_method: null,
      counterparty_biz_no: null,
    };
    expect(L.diffPatch(row, same)).toEqual({});
    expect(L.diffPatch(row, { ...same, description: null, payment_method: 'cash' })).toEqual({
      description: null,
      payment_method: 'cash',
    });
    expect(L.accountsFor(ACCOUNTS, 'asset_sell').map((a) => a.code)).toEqual(['asset.tangible']);
  });
});

describe('장부 고르기 (다담 본사 → 다담 공장)', () => {
  const PF = 'c0000000-0000-4000-8000-0000000000b1';
  const HQ = 'c0000000-0000-4000-8000-0000000000b2';
  const LEDGERS = [
    { company_id: PF, name: '다담 본사', kind: 'platform', own: true },
    { company_id: HQ, name: '다담 공장', kind: 'hq', own: false },
  ];
  const meOf = (url) => {
    const c = new URL(url).searchParams.get('company');
    return c === HQ
      ? ok({
          ...ME,
          company_id: HQ,
          level: 'read',
          viewing: true,
          can_upload: false,
          can_write: false,
          tax: { vat_type: 'general', business_kind: 'manufacturing' },
          ledgers: LEDGERS,
        })
      : ok({
          ...ME,
          company_id: PF,
          viewing: false,
          tax: { vat_type: null, business_kind: null },
          ledgers: LEDGERS,
        });
  };

  test('둘 이상이면 고르기가 보이고, 공장을 고르면 ?company= 로 보기만, 다시 본사로', async () => {
    const calls = await load({ me: meOf });
    expect($('lgSwitch').hidden).toBe(false);
    expect([...$('lgCompany').options].map((o) => o.textContent)).toEqual([
      '다담 본사',
      '다담 공장 (보기만)',
    ]);
    expect($('lgCompany').value).toBe(PF);
    expect($('lgAdd').hidden).toBe(false);
    set('lgCompany', HQ);
    await flush();
    expect(calls.some((c) => c.url === `${WORK}/ledger/me?company=${HQ}`)).toBe(true);
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).at(-1).url).toBe(
      `${WORK}/ledger/book?month=2026-11&include_void=1&company=${HQ}`
    );
    expect($('lgReadonly').hidden).toBe(false);
    expect($('lgReadonly').textContent).toBe('다담 공장 장부 — 보기만 합니다.');
    expect($('lgAdd').hidden).toBe(true);
    expect($('lgTaxSave').hidden).toBe(true);
    expect($('lgList').querySelector('[data-act]')).toBeNull();
    expect($('lgUp').hidden).toBe(true);
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/documents')).at(-1).url).toBe(
      `${WORK}/ledger/documents?limit=20&company=${HQ}`
    );
    set('lgCompany', PF);
    await flush();
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).at(-1).url).toBe(
      WORK + '/ledger/book?month=2026-11&include_void=1'
    );
    expect($('lgReadonly').hidden).toBe(true);
    expect($('lgAdd').hidden).toBe(false);
    expect($('lgUp').hidden).toBe(false);
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/documents')).at(-1).url).toBe(
      `${WORK}/ledger/documents?limit=20`
    );
  });

  test('장부가 하나면 고르기가 없고, 서버가 처음부터 남의 장부(viewing)로 열면 그 업체로 묻는다', async () => {
    await load();
    expect($('lgSwitch').hidden).toBe(true);
    jest.restoreAllMocks();
    const calls = await load({
      me: ok({
        ...ME,
        company_id: HQ,
        level: 'read',
        viewing: true,
        can_write: false,
        ledgers: [LEDGERS[1]],
      }),
    });
    expect($('lgSwitch').hidden).toBe(true);
    expect(calls.find((c) => c.url.startsWith(WORK + '/ledger/book')).url).toBe(
      `${WORK}/ledger/book?month=2026-11&include_void=1&company=${HQ}`
    );
    expect($('lgReadonly').textContent).toBe('다담 공장 장부 — 보기만 합니다.');
  });
});

describe('사진', () => {
  const at = (h, m) => `2026-11-02T0${h}:${m}:00Z`;
  const docs = () => [...$('lgDocs').querySelectorAll('.lg-doc')];
  const posts = (calls) =>
    calls.filter((c) => c.method === 'POST' && c.url === WORK + '/ledger/documents');
  const jpg = (name) => new window.File(['x'], name, { type: 'image/jpeg' });
  /** 기기 열기 · JPEG 로 다시 그리기 흉내 — 이름에 'broken' 이 들어가면 못 연다 */
  function fakeMedia(size = { width: 4032, height: 3024 }) {
    const encoded = [];
    window.SeganLedger.media.decode = jest.fn(async (file) => {
      if (/broken|\.heic$/.test(file.name)) throw new Error('decode');
      return { source: { name: file.name }, ...size, release: jest.fn() };
    });
    window.SeganLedger.media.encode = jest.fn(async (source, width, height) => {
      const blob = new window.Blob(['jpeg:' + source.name], { type: 'image/jpeg' });
      encoded.push({ name: source.name, width, height, blob });
      return blob;
    });
    return encoded;
  }
  function pick(files, id = 'lgFiles') {
    Object.defineProperty($(id), 'files', { value: files, configurable: true });
    $(id).dispatchEvent(new window.Event('change'));
  }

  test('대표 — 사진 칸 · 올린 사진 목록(상태 · 메모 · 돌려보낸 이유), 더 보기는 마지막 사진 앞', async () => {
    const page = Array.from({ length: 20 }, (_, i) => ({
      id: 'd' + i,
      created_at: at(3, String(59 - i).padStart(2, '0')),
      review_status: i === 1 ? 'returned' : 'pending',
      note: i === 0 ? '현장 A 자재' : null,
      decision_reason: i === 1 ? '흐림' : null,
    }));
    const calls = await load({
      docs: (url) =>
        new URL(url).searchParams.get('before')
          ? ok({
              items: [{ id: 'old', created_at: at(1, '00'), review_status: 'posted' }],
              money: true,
            })
          : ok({ items: page, money: true }),
    });
    expect($('lgPhotos').hidden).toBe(false);
    expect($('lgUp').hidden).toBe(false);
    expect($('lgPhotosNote').textContent).toContain('「확인할 사진」에서 칸을 확인한 뒤');
    expect(calls.find((c) => c.url.startsWith(WORK + '/ledger/documents')).url).toBe(
      WORK + '/ledger/documents?limit=20'
    );
    expect(docs().length).toBe(20);
    expect(docs()[0].querySelector('.lg-doc-line').textContent).toBe('11.02 12:59확인 기다림');
    expect(docs()[0].querySelector('small').textContent).toBe('현장 A 자재');
    expect(docs()[1].querySelector('b').textContent).toBe('돌려보냄');
    expect(docs()[1].querySelector('small').textContent).toBe('이유: 흐림');
    expect($('lgDocsMore').hidden).toBe(false);
    $('lgDocsMore').click();
    await flush();
    expect(calls.at(-1).url).toBe(
      WORK + '/ledger/documents?limit=20&before=' + encodeURIComponent(at(3, '40'))
    );
    expect(docs().length).toBe(21);
    expect(docs()[20].querySelector('b').textContent).toBe('장부에 올림');
    expect($('lgDocsMore').hidden).toBe(true);
  });

  test('직원 — 사진 칸만 (장부 · 계정을 묻지 않는다), 자기 사진 상태 · 돌려보낸 이유', async () => {
    const calls = await load({
      me: ok({
        company_id: 'c1',
        role: 'staff',
        money: false,
        level: 'full',
        viewing: false,
        can_upload: true,
        can_write: false,
      }),
      docs: () =>
        ok({
          items: [
            { id: 'a', created_at: at(3, '10'), status: 'uploaded', reason: null },
            { id: 'b', created_at: at(2, '10'), status: 'returned', reason: '다시 찍어 주세요' },
            { id: 'c', created_at: at(1, '10'), status: 'posted', reason: null },
          ],
          money: false,
        }),
    });
    expect($('lgTitle').textContent).toBe('영수증 올리기');
    expect($('lgTabs').hidden).toBe(true);
    expect($('lgPhotos').hidden).toBe(false);
    expect($('lgUp').hidden).toBe(false);
    expect($('lgPhotosNote').textContent).toContain('금액은 대표 · 실장만 봅니다');
    expect(ledgerCalls(calls).map((c) => c.url)).toEqual([
      WORK + '/ledger/me',
      WORK + '/ledger/documents?limit=20',
    ]);
    expect(docs().map((li) => li.querySelector('b').textContent)).toEqual([
      '올림',
      '돌려보냄',
      '확인됨',
    ]);
    expect(docs()[1].querySelector('small').textContent).toBe('이유: 다시 찍어 주세요');
    expect(docs()[0].querySelector('small')).toBeNull();
  });

  test('올리기 — 줄인 JPEG 를 한 장씩, 사진마다 키 · 메모 머리, 못 여는 사진(HEIC)은 안내만 · 다시 올리지 않는다', async () => {
    const calls = await load();
    const encoded = fakeMedia();
    $('lgNote').value = '  302호 현장  ';
    pick([jpg('a.jpg'), new window.File(['x'], 'b.heic', { type: 'image/heic' }), jpg('c.jpg')]);
    await flush();
    const sent = posts(calls);
    expect(sent.length).toBe(2);
    expect(encoded.map((e) => [e.name, e.width, e.height])).toEqual([
      ['a.jpg', 2236, 1677],
      ['c.jpg', 2236, 1677],
    ]);
    expect(sent[0].raw).toBe(encoded[0].blob);
    expect(sent[1].raw).toBe(encoded[1].blob);
    expect(sent[0].headers['Content-Type']).toBe('image/jpeg');
    expect(sent[0].headers['X-Ledger-Note']).toBe(encodeURIComponent('302호 현장'));
    expect(sent[0].url).toBe(WORK + '/ledger/documents');
    expect(sent[0].key).toBeTruthy();
    expect(sent[0].key).not.toBe(sent[1].key);
    expect($('lgUpState').textContent).toBe('2장 올림 · 1장 못 올림');
    expect($('lgUpFail').textContent).toContain('b.heic');
    expect($('lgUpFail').textContent).toContain('「높은 호환성」');
    expect($('lgRetry').hidden).toBe(true);
    expect(window.SeganLedger.media.decode.mock.results.length).toBe(3);
    // 올린 뒤 목록을 다시 읽는다
    expect(calls.at(-1).url).toBe(WORK + '/ledger/documents?limit=20');
    expect($('lgFiles').value).toBe('');
  });

  test('분 한도 429 — 1분 쉬었다가 그 사진부터 같은 키 · 같은 JPEG 로 이어 올린다', async () => {
    let n = 0;
    const calls = await load({
      upload: () => {
        n += 1;
        if (n === 2)
          return fail(429, 'rate_limited', '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요');
        return ok({ document: { id: 'd' + n }, reused: false }, 201);
      },
    });
    fakeMedia({ width: 1000, height: 800 });
    let wake;
    const sleep = jest.fn(() => new Promise((r) => (wake = r)));
    window.SeganLedger.timer.sleep = sleep;
    pick([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
    await flush();
    // 쉬는 동안 — 기다리는 시간은 분 한도 period, 단추는 잠긴다
    expect(sleep).toHaveBeenCalledWith(window.SeganLedger.RESUME_MS);
    expect(window.SeganLedger.RESUME_MS).toBe(60000);
    expect(posts(calls).length).toBe(2);
    expect($('lgUpState').textContent).toBe(
      '2 / 3장 — 1분에 올릴 수 있는 장수를 넘어 잠시 쉬었다가 이어 올립니다. 화면을 켜 두세요.'
    );
    expect($('lgUpFail').textContent).toBe('');
    expect($('lgRetry').hidden).toBe(true);
    expect($('lgPick').disabled).toBe(true);
    wake();
    await flush();
    const sent = posts(calls);
    expect(sent.length).toBe(4);
    expect(sent[2].key).toBe(sent[1].key);
    expect(sent[2].raw).toBe(sent[1].raw);
    expect(window.SeganLedger.media.encode.mock.calls.length).toBe(3);
    expect($('lgUpState').textContent).toBe('3장 올림');
    expect($('lgPick').disabled).toBe(false);
  });

  test('하루 한도 429 — 남은 사진은 멈춰 두고, 다시 올리기는 같은 키로 · 같은 사진은 「이미 올린 사진」', async () => {
    let n = 0;
    const calls = await load({
      upload: () => {
        n += 1;
        if (n === 2) return fail(429, 'daily_limit', '업체마다 하루 300장까지 올립니다');
        if (n === 3) return ok({ document: { id: 'd' }, reused: true });
        return ok({ document: { id: 'd' + n }, reused: false }, 201);
      },
    });
    fakeMedia({ width: 1000, height: 800 });
    pick([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')], 'lgCamera');
    await flush();
    expect(posts(calls).length).toBe(2);
    expect($('lgUpState').textContent).toBe('1장 올림 · 2장 못 올림');
    expect($('lgUpFail').textContent).toContain('업체마다 하루 300장까지 올립니다');
    expect($('lgRetry').hidden).toBe(false);
    const keyB = posts(calls)[1].key;
    $('lgRetry').click();
    await flush();
    const again = posts(calls).slice(2);
    expect(again.length).toBe(2);
    expect(again[0].key).toBe(keyB);
    // 다시 올릴 때는 다시 그리지 않는다 (처음 그린 JPEG 그대로)
    expect(window.SeganLedger.media.encode.mock.calls.length).toBe(3);
    expect(window.SeganLedger.media.encode.mock.calls[0].slice(1)).toEqual([1000, 800]);
    expect($('lgUpState').textContent).toBe('1장 올림 · 1장은 이미 올린 사진');
    expect($('lgRetry').hidden).toBe(true);
  });

  test('413 · 422 · 끊김 — 서버 말을 보이고, 형식 · 크기 거절은 다시 올리지 않는다 (끊긴 사진만 같은 키로)', async () => {
    let n = 0;
    const calls = await load({
      upload: () => {
        n += 1;
        if (n === 1) return fail(413, 'too_large', '사진은 5MB 까지 올립니다');
        if (n === 2)
          return {
            ok: false,
            status: 422,
            body: {
              success: false,
              message: '사진은 JPEG · PNG 만 받습니다',
              details: { code: 'bad_type' },
            },
          };
        if (n === 3) return new Error('offline');
        return ok({ document: { id: 'd' }, reused: false }, 201);
      },
    });
    fakeMedia({ width: 800, height: 600 });
    pick([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')]);
    await flush();
    expect($('lgUpFail').textContent).toContain('사진은 5MB 까지 올립니다');
    expect($('lgUpFail').textContent).toContain('사진은 JPEG · PNG 만 받습니다');
    expect($('lgUpFail').textContent).toContain('연결이 끊겼습니다.');
    expect($('lgUpState').textContent).toBe('3장 못 올림');
    expect($('lgRetry').hidden).toBe(false);
    const keyC = posts(calls)[2].key;
    $('lgRetry').click();
    await flush();
    const again = posts(calls).slice(3);
    expect(again.length).toBe(1);
    expect(again[0].key).toBe(keyC);
    expect($('lgUpState').textContent).toBe('1장 올림');
    expect($('lgRetry').hidden).toBe(true);
  });

  test('순수 — 줄이는 크기 (긴 변 2576 · 375만 화소, 키우지 않는다) · 한국 시간', () => {
    const { fitSize, stamp } = window.SeganLedger;
    expect(fitSize(1000, 800)).toEqual({ width: 1000, height: 800 });
    expect(fitSize(4032, 3024)).toEqual({ width: 2236, height: 1677 });
    expect(fitSize(6000, 1000)).toEqual({ width: 2576, height: 429 });
    for (const [w, h] of [
      [4032, 3024],
      [3024, 4032],
      [8000, 6000],
      [2576, 2576],
      [12000, 300],
    ]) {
      const s = fitSize(w, h);
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(2576);
      expect(s.width * s.height).toBeLessThanOrEqual(3750000);
    }
    expect(stamp('2026-11-02T03:05:00Z')).toBe('11.02 12:05');
    expect(stamp('엉터리')).toBe('');
  });
});

describe('사진 확인 (대표 · 실장)', () => {
  const D = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const URL1 = 'https://x.supabase.co/storage/v1/object/sign/ledger-evidence/a.jpg?token=t';
  const CHECKS = {
    biz_no: 'ok',
    amounts: 'ok',
    items: 'ok',
    date: 'ok',
    multiple: false,
    redacted: 0,
  };
  const RESULT = {
    document_count: 1,
    evidence_type: 'card',
    issue_date: '2026-11-01',
    supplier_name: '예림 자재',
    supplier_biz_no: '1234567891',
    supply_amount: 10000,
    vat_amount: 1000,
    tax_free_amount: null,
    service_charge: null,
    total_amount: 11000,
    approval_no: '12345678',
    payment_method: 'card',
    items: [
      { name: '경첩', quantity: 2, unit_price: 4000, amount: 8000 },
      { name: '나사', quantity: 1, unit_price: 2000, amount: 2000 },
    ],
    unsure: [],
  };
  const doc = (n, extraction, over = {}) => ({
    id: D(n),
    created_at: `2026-11-02T${String(n % 24).padStart(2, '0')}:00:00Z`,
    review_status: 'pending',
    note: null,
    photo_url: URL1,
    photo_expires_in: 600,
    extraction,
    ...over,
  });
  const done = (result = RESULT, checks = CHECKS) => ({
    id: 'x',
    attempt: 1,
    status: 'done',
    model: 'claude-haiku-5-5',
    schema_version: 1,
    result,
    checks,
    error: null,
  });
  /** 서버 힌트 (워커 src/ledger/hints.js hintView) — 기억으로 채운 올릴 값 */
  const PROPOSAL = {
    entry_date: '2026-11-01',
    direction: 'expense',
    account: 'purchase.materials',
    description: '경첩 외 1건',
    counterparty_name: '예림자재',
    counterparty_biz_no: '1234567891',
    amount: 10000,
    vat_amount: 1000,
    evidence_type: 'card',
    payment_method: 'card',
  };
  const hints = (over = {}) => ({
    available: true,
    supplier: { name: '예림 자재', biz_no: '1234567891' },
    memory: { posts: 3, entry_posts: 3, last_target: 'entry', last_on: '2026-10-20' },
    first_time: false,
    trusted: true,
    warnings: { duplicate: null, large: null, evidence_risk: false, nts: null },
    target: 'entry',
    category: null,
    proposal: PROPOSAL,
    deductible: true,
    sources: {
      account: 'memory',
      counterparty_name: 'memory',
      evidence_type: 'read',
      payment_method: 'read',
    },
    ready: true,
    blockers: [],
    ...over,
  });
  const rows = () => [...$('lgReviewList').querySelectorAll('.lg-rv')];
  const readyRows = () => [...$('lgReadyList').querySelectorAll('.lg-rv')];
  const mustRow = (key) => $('lgRvMust').querySelector(`[data-must="${key}"]`);
  const markOf = (key) => mustRow(key).querySelector('[data-mark]').textContent;
  const rowOf = (n) => $('lgReviewList').querySelector(`[data-id="${D(n)}"]`);
  const open = async (n) => {
    rowOf(n).querySelector('[data-act="rv-open"]').click();
    await flush();
  };
  const reviewGets = (calls) => calls.filter((c) => c.url.startsWith(WORK + '/ledger/review?'));
  const submitSheet = async () => {
    $('lgRvForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
  };

  afterEach(() => {
    if (window.SeganLedger && window.SeganLedger.poll) window.SeganLedger.poll.stop();
  });

  test('목록 — 읽기 상태 · 경고(칸 이름으로) · 썸네일 · 개수, 힌트가 없으면 바로 올리기 묶음도 없다', async () => {
    const calls = await load({
      review: () =>
        ok({
          items: [
            doc(1, done(), { note: '현장 A' }),
            doc(
              2,
              done(
                { ...RESULT, unsure: ['total_amount', 'issue_date'] },
                { ...CHECKS, biz_no: 'bad' }
              )
            ),
            doc(3, { id: 'y', attempt: 1, status: 'running' }),
            doc(4, { id: 'z', attempt: 2, status: 'failed', error: 'parse' }, { photo_url: null }),
            doc(5, null),
          ],
          level: 'full',
          viewing: false,
        }),
    });
    expect(reviewGets(calls).map((c) => c.url)).toEqual([
      WORK + '/ledger/review?status=pending&limit=50',
    ]);
    expect($('lgReview').hidden).toBe(false);
    expect($('lgReviewTitle').textContent).toBe('확인할 사진 5장');
    expect(rows().map((li) => li.querySelector('.lg-rv-line b').textContent)).toEqual([
      '읽음',
      '읽음',
      '읽는 중',
      '못 읽음',
      '읽기 기다림',
    ]);
    const a = rowOf(1);
    expect(a.querySelector('.lg-rv-memo').textContent).toBe('현장 A');
    expect(a.querySelector('.lg-rv-sum').textContent).toBe('예림 자재 · 11,000원');
    const img = a.querySelector('img.lg-rv-thumb');
    expect(img.getAttribute('src')).toBe(URL1);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(rowOf(4).querySelector('.lg-rv-thumb--none').textContent).toBe('사진 없음');
    expect([...rowOf(2).querySelectorAll('.lg-chip')].map((c) => c.textContent)).toEqual([
      '사업자번호 확인 필요',
      '확실하지 않음: 합계 · 일자',
    ]);
    expect(rowOf(2).querySelector('.lg-chip').classList.contains('lg-chip--warn')).toBe(true);
    expect(a.querySelector('.lg-chip')).toBeNull();
    // 서버 힌트가 없으면 바로 올리기 묶음도 없다
    expect($('lgReady').hidden).toBe(true);
    // 읽는 중이 있어 다시 묻기를 걸어 둔다
    expect(window.SeganLedger.state.pollTimer).not.toBeNull();
  });

  test('시트 — 읽은 칸으로 채우고(공제 증빙은 공급가 · 부가세) 꼭 볼 칸에 ✓ · 확인, 계정을 골라야 장부에 올린다', async () => {
    const calls = await load({
      review: () =>
        ok({
          items: [
            doc(1, done({ ...RESULT, unsure: ['issue_date'] }, { ...CHECKS, amounts: 'mismatch' })),
          ],
        }),
    });
    await open(1);
    expect($('lgSheet').hidden).toBe(false);
    expect($('lgRvPhoto').getAttribute('src')).toBe(URL1);
    expect($('lgRvRead').textContent).toContain('읽음');
    expect([...$('lgRvChips').querySelectorAll('.lg-chip')].map((c) => c.textContent)).toEqual([
      '금액 합이 안 맞음',
      '확실하지 않음: 일자',
    ]);
    expect($('lgRvAmounts').textContent).toBe(
      '읽은 금액 — 공급가 10,000원 · 부가세 1,000원 · 합계 11,000원'
    );
    expect($('lgRvDate').value).toBe('2026-11-01');
    // 꼭 볼 칸 — 확실하지 않은 일자 · 합이 안 맞는 금액 · 고르지 않은 계정은 「확인」, 나머지 ✓
    expect(['date', 'cp', 'amount', 'vat', 'account'].map(markOf)).toEqual([
      '확인',
      '✓',
      '확인',
      '확인',
      '확인',
    ]);
    expect(mustRow('date').classList.contains('lg-flag')).toBe(true);
    expect(mustRow('cp').classList.contains('lg-flag')).toBe(false);
    expect(mustRow('amount').querySelector('[data-why]').textContent).toBe(
      '공급가 + 부가세가 합계와 맞지 않습니다'
    );
    expect(mustRow('account').querySelector('[data-why]').textContent).toBe('계정을 골라 주세요');
    expect($('lgRvAmountLabel').textContent).toBe('공급가');
    expect($('lgRvMore').open).toBe(false);
    expect([...$('lgRvItems').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '경첩 2 × 4,000원 = 8,000원',
      '나사 1 × 2,000원 = 2,000원',
    ]);
    expect($('lgRvCpName').value).toBe('예림 자재');
    expect($('lgRvBiz').value).toBe('1234567891');
    expect($('lgRvAmount').value).toBe('10000');
    expect($('lgRvVat').value).toBe('1000');
    expect($('lgRvEvidence').value).toBe('card');
    expect($('lgRvMethod').value).toBe('card');
    expect($('lgRvDesc').value).toBe('경첩 외 1건');
    expect($('lgRvAccount').value).toBe('');
    expect($('lgRvReread').hidden).toBe(true);
    // 사진을 누르면 크게
    $('lgRvPhotoBtn').click();
    expect($('lgRvPhotoBtn').classList.contains('lg-rv-photo--big')).toBe(true);
    // 계정 없이 — 보내지 않는다
    await submitSheet();
    expect($('lgRvError').textContent).toBe('계정을 골라 주세요.');
    expect(calls.some((c) => c.url.endsWith('/post'))).toBe(false);
    set('lgRvAccount', 'purchase.materials');
    const books = calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).length;
    await submitSheet();
    const post = calls.find((c) => c.url === `${WORK}/ledger/documents/${D(1)}/post`);
    expect(post.method).toBe('POST');
    expect(post.body).toEqual({
      target: 'entry',
      entry: {
        entry_date: '2026-11-01',
        direction: 'expense',
        account: 'purchase.materials',
        description: '경첩 외 1건',
        counterparty_name: '예림 자재',
        counterparty_biz_no: '1234567891',
        amount: 10000,
        vat_amount: 1000,
        evidence_type: 'card',
        payment_method: 'card',
      },
    });
    expect($('lgSheet').hidden).toBe(true);
    expect(rows().length).toBe(0);
    expect($('lgState').textContent).toBe('장부에 올렸습니다.');
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).length).toBe(books + 1);
  });

  test('시트 — 틀린 금액 · 사업자번호는 보내지 않는다, 읽기 전 사진은 빈 칸에서 직접', async () => {
    const calls = await load({ review: () => ok({ items: [doc(3, null)] }) });
    await open(3);
    expect($('lgRvRead').textContent).toContain('아직 읽지 않았습니다');
    expect(markOf('date')).toBe('');
    expect($('lgRvAmount').value).toBe('');
    expect($('lgRvAmounts').textContent).toBe('');
    set('lgRvDate', '2026-11-02');
    set('lgRvAccount', 'admin.rent');
    set('lgRvEvidence', 'simple_receipt');
    // 공제 안 되는 증빙이면 칸 이름이 바뀐다
    expect($('lgRvAmountLabel').textContent).toBe('금액 (부가세 공제 안 됨)');
    await submitSheet();
    expect($('lgRvError').textContent).toBe('금액을 1원 이상 정수로 적어 주세요.');
    set('lgRvAmount', '5500');
    $('lgRvBiz').value = '1234567890';
    await submitSheet();
    expect($('lgRvError').textContent).toContain('사업자등록번호를 확인해 주세요');
    expect(calls.some((c) => c.url.endsWith('/post'))).toBe(false);
    $('lgRvBiz').value = '';
    await submitSheet();
    const post = calls.find((c) => c.url.endsWith('/post'));
    expect(post.body.entry).toEqual({
      entry_date: '2026-11-02',
      direction: 'expense',
      account: 'admin.rent',
      description: null,
      counterparty_name: null,
      counterparty_biz_no: null,
      amount: 5500,
      vat_amount: 0,
      evidence_type: 'simple_receipt',
      payment_method: null,
    });
  });

  test('수주 원가로 — 이 업체 수주(GET /ledger/orders)를 골라 원가 종류와 함께', async () => {
    const O1 = 'f0000000-0000-4000-8000-000000000001';
    const calls = await load({
      review: () => ok({ items: [doc(1, done()), doc(2, done())] }),
      orders: () =>
        ok({
          items: [{ id: O1, order_no: 'SO-1', customer_name: '김고객', status: 'confirmed' }],
        }),
    });
    await open(1);
    set('lgRvTarget', 'order_cost');
    await flush();
    expect(calls.filter((c) => c.url === WORK + '/ledger/orders').length).toBe(1);
    expect([...$('lgRvOrder').options].map((o) => [o.value, o.textContent])).toEqual([
      ['', '고르기'],
      [O1, 'SO-1 · 김고객'],
    ]);
    expect($('lgRvAccount').closest('.lg-must-row').hidden).toBe(true);
    expect($('lgRvOrder').closest('.lg-must-row').hidden).toBe(false);
    expect($('lgRvOrder').closest('.lg-must-row').querySelector('[data-why]').hidden).toBe(true);
    expect($('lgRvPost').textContent).toBe('수주 원가로 올리기');
    expect([...$('lgRvCategory').options].map((o) => o.textContent)).toEqual([
      '자재',
      '부자재',
      '노무',
      '외주',
      '물류',
      '기타',
    ]);
    await submitSheet();
    expect($('lgRvError').textContent).toBe('수주를 골라 주세요.');
    set('lgRvOrder', O1);
    set('lgRvCategory', 'hardware');
    await submitSheet();
    const post = calls.find((c) => c.url.endsWith('/post'));
    expect(post.body).toEqual({
      target: 'order_cost',
      order_id: O1,
      cost: {
        category: 'hardware',
        amount: 10000,
        vat_amount: 1000,
        description: '경첩 외 1건',
        vendor_name: '예림 자재',
        evidence_type: 'card',
        spent_on: '2026-11-01',
      },
    });
    expect($('lgState').textContent).toBe('수주 원가로 올렸습니다.');
    // 다른 사진에서 다시 골라도 수주 목록은 한 번만 묻는다
    await open(2);
    set('lgRvTarget', 'order_cost');
    await flush();
    expect(calls.filter((c) => c.url === WORK + '/ledger/orders').length).toBe(1);
  });

  test('수주 원가로 — 이 업체 수주가 없으면 그렇다고 쓰고 할 일을 칸 아래에, 올리지 않는다', async () => {
    const calls = await load({
      review: () => ok({ items: [doc(1, done())] }),
      orders: () => ok({ items: [] }),
    });
    await open(1);
    set('lgRvTarget', 'order_cost');
    await flush();
    expect([...$('lgRvOrder').options].map((o) => [o.value, o.textContent])).toEqual([
      ['', '이 업체 수주가 없습니다'],
    ]);
    const why = $('lgRvOrder').closest('.lg-must-row').querySelector('[data-why]');
    expect(why.hidden).toBe(false);
    expect(why.textContent).toContain('「수주 전환」해야 생깁니다');
    await submitSheet();
    expect($('lgRvError').textContent).toBe('이 업체에는 고를 수주가 없습니다.');
    expect(calls.some((c) => c.url.endsWith('/post'))).toBe(false);
  });

  test('수주 원가로 — 수주 목록을 못 불러오면 그렇게 쓰고, 다시 고르면 다시 묻는다', async () => {
    let n = 0;
    const calls = await load({
      review: () => ok({ items: [doc(1, done())] }),
      orders: () => (++n === 1 ? fail(500, 'internal', 'x') : ok({ items: [] })),
    });
    await open(1);
    set('lgRvTarget', 'order_cost');
    await flush();
    expect($('lgRvOrder').options[0].textContent).toBe('수주 목록을 불러오지 못했습니다');
    expect($('lgRvError').textContent).toBe('수주 목록을 불러오지 못했습니다.');
    set('lgRvTarget', 'entry');
    set('lgRvTarget', 'order_cost');
    await flush();
    expect(calls.filter((c) => c.url === WORK + '/ledger/orders').length).toBe(2);
    expect($('lgRvOrder').options[0].textContent).toBe('이 업체 수주가 없습니다');
  });

  test('돌려보내기 · 버리기 — 화면 안에서 이유를 받고(confirm 없음), 보낸 뒤 목록에서 뺀다', async () => {
    for (const [btn, path, text] of [
      ['lgRvReturn', 'return', '사진을 돌려보냈습니다.'],
      ['lgRvReject', 'reject', '사진을 버렸습니다.'],
    ]) {
      window.confirm = jest.fn(() => true);
      const calls = await load({ review: () => ok({ items: [doc(1, done()), doc(2, done())] }) });
      await open(1);
      $(btn).click();
      expect($('lgRvDecide').hidden).toBe(false);
      $('lgRvDecideOk').click();
      await flush();
      expect($('lgRvError').textContent).toBe('이유를 적어 주세요.');
      expect(calls.some((c) => c.url.endsWith('/' + path))).toBe(false);
      $('lgRvReason').value = ' 흐림 ';
      $('lgRvDecideOk').click();
      await flush();
      const post = calls.find((c) => c.url === `${WORK}/ledger/documents/${D(1)}/${path}`);
      expect(post.body).toEqual({ reason: '흐림' });
      expect($('lgSheet').hidden).toBe(true);
      expect(rows().map((li) => li.getAttribute('data-id'))).toEqual([D(2)]);
      expect($('lgState').textContent).toBe(text);
      expect(window.confirm).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    }
  });

  test('409 — 이미 확인한 사진이면 시트를 닫고 목록을 다시 읽는다', async () => {
    const calls = await load({
      review: () => ok({ items: [doc(1, done())] }),
      decide: () => fail(409, 'not_pending', '이미 확인한 사진입니다'),
    });
    await open(1);
    set('lgRvAccount', 'admin.rent');
    await submitSheet();
    expect($('lgSheet').hidden).toBe(true);
    expect($('lgState').textContent).toBe('이미 확인한 사진입니다');
    expect(reviewGets(calls).length).toBe(2);
  });

  test('다시 읽기 — 못 읽음 · 거절 · 한도 사진에만, 보내면 목록을 다시 읽는다', async () => {
    const calls = await load({
      review: () =>
        ok({
          items: [
            doc(1, done()),
            doc(2, { id: 'b', attempt: 1, status: 'skipped_budget', error: 'over_limit' }),
          ],
        }),
      decide: () => ok({ queued: true, reason: null }, 202),
    });
    await open(1);
    expect($('lgRvReread').hidden).toBe(true);
    $('lgRvClose').click();
    await open(2);
    expect($('lgRvRead').textContent).toContain('한도로 읽지 못했습니다');
    expect($('lgRvReread').hidden).toBe(false);
    $('lgRvReread').click();
    await flush();
    const post = calls.find((c) => c.url === `${WORK}/ledger/documents/${D(2)}/reread`);
    expect(post.method).toBe('POST');
    expect($('lgState').textContent).toBe('다시 읽는 중입니다.');
    expect(reviewGets(calls).length).toBe(2);
  });

  test('사업자 상태 — 서버에 키가 없으면 단추를 감추고, 있으면 상태를 보인다', async () => {
    const calls = await load({ review: () => ok({ items: [doc(1, done()), doc(2, done())] }) });
    await open(1);
    expect($('lgRvBizRow').hidden).toBe(false);
    $('lgRvBizCheck').click();
    await flush();
    expect(calls.find((c) => c.url.includes('/ledger/business-status')).url).toBe(
      WORK + '/ledger/business-status?biz_no=1234567891'
    );
    expect($('lgRvBizRow').hidden).toBe(true);
    $('lgRvClose').click();
    await open(2);
    expect($('lgRvBizRow').hidden).toBe(true);
    jest.restoreAllMocks();

    await load({
      review: () => ok({ items: [doc(1, done())] }),
      business: () =>
        ok({
          available: true,
          cached: false,
          biz_no: '1234567891',
          status: 'closed',
          tax_type: '부가가치세 일반과세자',
          closed_on: '2026-10-01',
        }),
    });
    await open(1);
    $('lgRvBizCheck').click();
    await flush();
    expect($('lgRvBizState').textContent).toBe('폐업 (2026-10-01) · 부가가치세 일반과세자');
    expect($('lgRvBizRow').hidden).toBe(false);
    // 틀린 번호면 단추가 없다
    $('lgRvBiz').value = '1234567890';
    $('lgRvBiz').dispatchEvent(new window.Event('input'));
    expect($('lgRvBizRow').hidden).toBe(true);
  });

  test('바로 올려도 되는 사진 — 줄마다 올릴 값, 한 번에 서버 값 그대로 20장씩, 못 올린 장은 목록을 다시 받는다', async () => {
    const many = Array.from({ length: 21 }, (_, i) => doc(i + 1, done(), { hints: hints() }));
    const other = doc(22, done(), { hints: hints({ ready: false, blockers: ['not_trusted'] }) });
    let n = 0;
    let reviews = 0;
    const calls = await load({
      review: () => {
        reviews += 1;
        return ok({ items: reviews === 1 ? [...many, other] : [many[1], other] });
      },
      batch: (url, init) => {
        n += 1;
        const body = JSON.parse(init.body);
        return ok({
          items: body.items.map((x, i) =>
            n === 1 && i === 1
              ? {
                  id: x.id,
                  ok: false,
                  status: 409,
                  message: '목록을 본 뒤 값이 바뀌었습니다',
                  code: 'changed',
                }
              : { id: x.id, ok: true, target: 'entry' }
          ),
          posted: 0,
        });
      },
    });
    expect($('lgReady').hidden).toBe(false);
    expect($('lgReadyTitle').textContent).toBe('바로 올려도 되는 사진 21장');
    expect($('lgReadyPost').textContent).toBe('21장 올리기');
    expect(readyRows().length).toBe(21);
    expect(readyRows()[0].querySelector('.lg-rv-ready1').textContent).toBe('11.01 · 예림자재');
    expect(readyRows()[0].querySelector('.lg-rv-ready2').textContent).toBe(
      '10,000원 + 부가세 1,000원 · 재료비 매입'
    );
    // 바로 올릴 수 없는 사진은 아래 목록에
    expect(rows().map((li) => li.getAttribute('data-id'))).toEqual([D(22)]);
    const books = calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).length;
    $('lgReadyPost').click();
    await flush();
    const sent = calls.filter((c) => c.url === WORK + '/ledger/review/post');
    expect(sent.map((c) => c.body.items.length)).toEqual([20, 1]);
    expect(sent[0].body.items[0]).toEqual({ id: D(1), ready: true, entry: PROPOSAL });
    expect($('lgBatchState').textContent).toBe('20장 올림 · 1장 못 올림');
    expect($('lgBatchResult').textContent).toContain('목록을 본 뒤 값이 바뀌었습니다');
    // 못 올린 장이 있으면 목록을 다시 받는다
    expect(reviews).toBe(2);
    expect(readyRows().map((li) => li.getAttribute('data-id'))).toEqual([D(2)]);
    expect(calls.filter((c) => c.url.startsWith(WORK + '/ledger/book')).length).toBe(books + 1);
  });

  test('시트 — 서버 올릴 값으로 채우고 꼬리표(지난번대로 · AI 제안) · 까닭(큰 금액 · 폐업)', async () => {
    await load({
      review: () =>
        ok({
          items: [
            // 바로 올리기 묶음이 아닌 아래 목록에서 연다
            doc(1, done(), { hints: hints({ ready: false, blockers: ['not_trusted'] }) }),
            doc(2, done(), {
              hints: hints({
                ready: false,
                proposal: { ...PROPOSAL, account: 'admin.rent', counterparty_name: '예림 자재' },
                sources: {
                  account: 'ai',
                  counterparty_name: 'read',
                  evidence_type: 'read',
                  payment_method: 'read',
                },
                first_time: true,
                warnings: {
                  duplicate: { document_id: D(1), created_at: '2026-11-02T01:00:00Z' },
                  large: { median: 4000, n: 3, ratio: 2.8 },
                  evidence_risk: false,
                  nts: { status: 'closed', closed_on: '2026-10-15' },
                },
              }),
            }),
          ],
        }),
    });
    await open(1);
    expect($('lgRvAccount').value).toBe('purchase.materials');
    expect($('lgRvCpName').value).toBe('예림자재');
    expect(['date', 'cp', 'amount', 'vat', 'account'].map(markOf)).toEqual([
      '✓',
      '✓',
      '✓',
      '✓',
      '✓',
    ]);
    expect(mustRow('account').querySelector('[data-tag]').textContent).toBe('지난번대로');
    expect(mustRow('cp').querySelector('[data-tag]').textContent).toBe('지난번대로');
    $('lgRvClose').click();
    await open(2);
    expect($('lgRvAccount').value).toBe('admin.rent');
    expect(mustRow('account').querySelector('[data-tag]').textContent).toBe('AI 제안');
    expect(markOf('account')).toBe('확인');
    expect(mustRow('cp').querySelector('[data-tag]').textContent).toBe('처음');
    expect(mustRow('cp').querySelector('[data-why]').textContent).toBe(
      '국세청 조회: 폐업 (2026-10-15)'
    );
    expect(mustRow('amount').querySelector('[data-why]').textContent).toBe(
      '평소보다 큰 금액입니다 (최근 중앙값 4,000원의 2.8배)'
    );
    expect(
      [...$('lgRvChips').querySelectorAll('.lg-chip')].map((c) => [c.textContent, c.className])
    ).toEqual([
      ['중복 의심 — 11.02 10:00 사진', 'lg-chip lg-chip--crit'],
      ['폐업 사업자', 'lg-chip lg-chip--crit'],
      ['평소보다 큰 금액 (2.8배)', 'lg-chip lg-chip--warn'],
      ['처음 보는 거래처', 'lg-chip lg-chip--info'],
    ]);
  });

  test('직원 — 확인할 사진을 묻지 않고 칸도 없다', async () => {
    const calls = await load({
      me: ok({ ...ME, role: 'staff', money: false, can_write: false }),
      review: () => {
        throw new Error('staff must not call review');
      },
    });
    expect($('lgReview').hidden).toBe(true);
    expect(calls.some((c) => /\/ledger\/(review|business-status)|\/orders$/.test(c.url))).toBe(
      false
    );
  });

  test('다담 공장 보기 — 목록은 ?company= 로 보이고, 고르기 · 쓰기 단추가 없고 시트는 보기만', async () => {
    const HQ = 'c0000000-0000-4000-8000-0000000000b2';
    const calls = await load({
      me: ok({
        ...ME,
        company_id: HQ,
        level: 'read',
        viewing: true,
        can_upload: false,
        can_write: false,
        ledgers: [{ company_id: HQ, name: '다담 공장', kind: 'hq', own: false }],
      }),
      review: () =>
        ok({ items: [doc(1, done(), { hints: hints() })], level: 'read', viewing: true }),
    });
    expect(reviewGets(calls)[0].url).toBe(
      `${WORK}/ledger/review?status=pending&limit=50&company=${HQ}`
    );
    expect($('lgReviewNote').textContent).toBe('보기만 합니다.');
    // 보기만이면 바로 올리기 묶음 없이 아래 목록에
    expect($('lgReady').hidden).toBe(true);
    expect(rows().length).toBe(1);
    await open(1);
    expect($('lgRvActs').hidden).toBe(true);
    expect($('lgRvAmount').disabled).toBe(true);
    expect($('lgRvBizRow').hidden).toBe(true);
  });

  test('읽는 중이면 화면이 보일 때 다시 묻고, 다 읽으면 멈춘다 (숨기면 멈춘다)', async () => {
    let n = 0;
    const calls = await load({
      review: () => {
        n += 1;
        return ok({
          items: [doc(1, n === 1 ? { id: 'a', attempt: 1, status: 'running' } : done())],
        });
      },
    });
    const { state, poll } = window.SeganLedger;
    expect(state.pollTimer).not.toBeNull();
    expect(poll.POLL_MS).toBe(10000);
    // 숨기면 멈추고, 그동안은 묻지 않는다
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(state.pollTimer).toBeNull();
    await poll.tick();
    expect(reviewGets(calls).length).toBe(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    expect(state.pollTimer).not.toBeNull();
    await poll.tick();
    expect(reviewGets(calls).length).toBe(2);
    expect(rowOf(1).querySelector('.lg-rv-line b').textContent).toBe('읽음');
    expect(state.pollTimer).toBeNull();
    delete document.visibilityState;
  });

  test('사진 돌리기 — 90도씩 화면에서만 돌리고, 돌린 사진이 상자에 맞는다 · 사진마다 기억', async () => {
    await load({ review: () => ok({ items: [doc(1, done()), doc(2, done())] }) });
    const img = $('lgRvPhoto');
    const size = (el, key, value) => Object.defineProperty(el, key, { value, configurable: true });
    size(img, 'naturalWidth', 3000);
    size(img, 'naturalHeight', 4000);
    size($('lgRvPhotoBtn'), 'clientWidth', 400);
    await open(1);
    expect($('lgRvRotateRow').hidden).toBe(false);
    expect(img.getAttribute('data-rot')).toBe('0');
    expect(img.getAttribute('style')).toBeNull();
    const turn = () => $('lgRvRotate').click();
    // 90 — 세로 사진(3:4)이 누워 폭 400 · 높이 300
    turn();
    expect(img.getAttribute('data-rot')).toBe('90');
    expect(img.style.transform).toBe('rotate(90deg) translateY(-100%)');
    expect([img.style.width, img.style.height, img.style.marginBottom, img.style.left]).toEqual([
      '300px',
      '400px',
      '-100px',
      '0px',
    ]);
    // 180 · 270 · 다시 0
    turn();
    expect(img.style.transform).toBe('rotate(180deg)');
    expect(img.style.width).toBe('');
    turn();
    expect(img.style.transform).toBe('rotate(270deg) translateX(-100%)');
    turn();
    expect(img.getAttribute('style')).toBeNull();
    // 가로 사진(4:3)을 90 — 작게 보기면 돌린 뒤 높이 320 안, 가운데 · 크게 보기면 폭 가득
    size(img, 'naturalWidth', 4000);
    size(img, 'naturalHeight', 3000);
    turn();
    expect([img.style.width, img.style.height, img.style.left]).toEqual(['320px', '240px', '80px']);
    $('lgRvPhotoBtn').click();
    expect([img.style.width, img.style.height, img.style.left]).toEqual(['533px', '400px', '0px']);
    // 다른 사진은 돌리지 않은 채로, 돌아오면 돌린 그대로
    $('lgRvClose').click();
    await open(2);
    expect(img.getAttribute('data-rot')).toBe('0');
    $('lgRvClose').click();
    await open(1);
    expect(img.getAttribute('data-rot')).toBe('90');
  });

  test('읽을 때 돌린 사진(result.rotate) — 처음부터 그만큼 돌려 보이고(썸네일도), 「사진 돌리기」는 거기서 90도씩', async () => {
    await load({
      review: () =>
        ok({
          items: [
            doc(1, done({ ...RESULT, rotate: 90 })),
            doc(2, done({ ...RESULT, rotate: 0 })),
            doc(3, done({ ...RESULT, rotate: 45 })),
            doc(4, { id: 'y', attempt: 1, status: 'running' }),
          ],
        }),
    });
    const thumb = (n) => rowOf(n).querySelector('img.lg-rv-thumb').style.transform;
    expect([1, 2, 3, 4].map(thumb)).toEqual(['rotate(90deg)', '', '', '']);
    const img = $('lgRvPhoto');
    await open(1);
    expect(img.getAttribute('data-rot')).toBe('90');
    const turn = () => $('lgRvRotate').click();
    turn();
    expect(img.getAttribute('data-rot')).toBe('180');
    turn();
    turn();
    // 0 으로 고친 것도 기억한다 (읽을 때 각도로 돌아가지 않는다)
    expect(img.getAttribute('data-rot')).toBe('0');
    $('lgRvClose').click();
    await open(1);
    expect(img.getAttribute('data-rot')).toBe('0');
    $('lgRvClose').click();
    // 0 · 모르는 값 · 읽는 중은 돌리지 않는다
    for (const n of [2, 3, 4]) {
      await open(n);
      expect(img.getAttribute('data-rot')).toBe('0');
      $('lgRvClose').click();
    }
  });

  describe('거래명세표 모아 붙이기', () => {
    const STMT = { ...RESULT, evidence_type: 'statement', items: [] };
    const askHints = () =>
      hints({
        ready: false,
        blockers: ['invoice_mode'],
        invoice: { mode: null, route: 'ask' },
        proposal: { ...PROPOSAL, evidence_type: 'statement', amount: 11000, vat_amount: 0 },
      });
    const G = {
      supplier_key: 'b1234567891',
      supplier_name: '가나목재',
      biz_no: '1234567891',
      name_key: '가나목재',
      invoice_mode: 'separate',
      month: '2026-10',
      count: 2,
      supply: 800000,
      total: 880000,
      late: true,
      documents: [
        {
          id: D(1),
          issue_date: '2026-10-07',
          supply_amount: 300000,
          vat_amount: 30000,
          total_amount: 330000,
          created_at: '2026-10-07T00:00:00Z',
        },
        {
          id: D(2),
          issue_date: '2026-10-15',
          supply_amount: 500000,
          vat_amount: 50000,
          total_amount: 550000,
          created_at: '2026-10-15T00:00:00Z',
        },
      ],
    };
    const ENTRY = {
      entry_id: E1,
      entry_date: '2026-10-31',
      amount: 800000,
      vat_amount: 80000,
      evidence_type: 'tax_invoice',
      counterparty_name: '(주)가나목재',
      supporting: 0,
    };
    const attachReply = (url, init) =>
      JSON.parse(init.body).dry_run
        ? ok({
            attached: 0,
            compare: {
              n: 2,
              basis: 'supply',
              statements: 800000,
              invoice: 800000,
              diff: 0,
              match: true,
              missing: 0,
            },
            dry_run: true,
          })
        : ok({
            attached: 2,
            compare: { n: 2, basis: 'supply', diff: 0, match: true },
            dry_run: false,
          });

    test('거래처를 안 골랐으면 시트가 묻고, 따로 줌 → 그 거래처 명세표를 한 번에 모아 둔다', async () => {
      const calls = await load({
        review: () =>
          ok({
            items: [
              doc(1, done(STMT), { hints: askHints() }),
              doc(2, done(STMT), { hints: askHints() }),
            ],
          }),
        suppliers: (url, init) =>
          init && init.method === 'PUT'
            ? ok({
                key: 'b1234567891',
                mode: 'separate',
                name: '예림 자재',
                released: 0,
                candidates: [D(2)],
              })
            : ok({ available: true, items: [] }),
        hold: () => ok({ held: 2 }),
      });
      expect(rowOf(1).textContent).toContain('명세표 — 세금계산서를 따로 주는지 고르기');
      expect(readyRows()).toHaveLength(0);
      await open(1);
      expect($('lgRvInv').hidden).toBe(false);
      expect($('lgRvInvTitle').textContent).toBe('예림 자재는 세금계산서를 따로 주나요?');
      expect($('lgRvInvHold').hidden).toBe(true);
      $('lgRvInvSep').click();
      await flush();
      const put = calls.find((c) => c.url === WORK + '/ledger/suppliers' && c.method === 'PUT');
      expect(put.body).toEqual({ document_id: D(1), mode: 'separate' });
      // 이 사진이 후보에 없어도 맨 앞에 넣는다
      expect($('lgRvHold').textContent).toBe('2장 모아 두기');
      expect($('lgRvInvNote').textContent).toContain('명세표 2장(이 사진 포함)');
      $('lgRvHold').click();
      await flush();
      expect(calls.find((c) => c.url === WORK + '/ledger/documents/hold').body).toEqual({
        document_ids: [D(1), D(2)],
      });
      expect($('lgSheet').hidden).toBe(true);
      expect(rows()).toHaveLength(0);
      expect($('lgState').textContent).toBe(
        '명세표 2장을 모아 뒀습니다 — 세금계산서가 오면 붙입니다.'
      );
      expect(calls.filter((c) => c.url === WORK + '/ledger/held').length).toBeGreaterThanOrEqual(2);
    });

    test('명세표만 줌 — 그대로 장부 줄로 올리고, 잘못 골랐으면 시트에서 다시 고른다', async () => {
      const calls = await load({
        review: () => ok({ items: [doc(1, done(STMT), { hints: askHints() })] }),
        suppliers: (url, init) =>
          init && init.method === 'PUT'
            ? ok({
                key: 'b1234567891',
                mode: 'statement_only',
                name: '예림 자재',
                released: 0,
                candidates: [],
              })
            : ok({ available: true, items: [] }),
      });
      await open(1);
      $('lgRvInvOnly').click();
      await flush();
      expect(calls.find((c) => c.method === 'PUT').body).toEqual({
        document_id: D(1),
        mode: 'statement_only',
      });
      expect($('lgRvInv').hidden).toBe(false);
      expect($('lgRvInvTitle').textContent).toBe('예림 자재는 명세표만 주는 곳으로 정했습니다');
      expect($('lgRvInvAsk').hidden).toBe(true);
      expect($('lgRvInvRedoRow').hidden).toBe(false);
      expect($('lgRvPost').hidden).toBe(false);
      // 잘못 눌렀으면 — 다시 묻고, 고른 것으로 서버에 다시 보낸다
      $('lgRvInvRedo').click();
      expect($('lgRvInvAsk').hidden).toBe(false);
      expect($('lgRvInvRedoRow').hidden).toBe(true);
      expect($('lgRvInvTitle').textContent).toBe('예림 자재는 세금계산서를 따로 주나요?');
      $('lgRvInvSep').click();
      await flush();
      const puts = calls.filter((c) => c.method === 'PUT');
      expect(puts.map((c) => c.body.mode)).toEqual(['statement_only', 'separate']);
      expect($('lgRvInvHold').hidden).toBe(false);
      expect($('lgRvInvRedoRow').hidden).toBe(false);
    });

    test('세금계산서 기다리는 명세표 — 거래처 · 달 묶음, 붙이기 창에서 맞춰 보고 고른 것만 붙인다', async () => {
      const calls = await load({
        held: () => ok({ available: true, groups: [G], count: 2 }),
        heldEntries: () => ok({ items: [ENTRY] }),
        attach: attachReply,
      });
      expect($('lgHeld').hidden).toBe(false);
      expect($('lgHeldTitle').textContent).toBe('세금계산서 기다리는 명세표 2장');
      const row = $('lgHeldList').querySelector('.lg-held-row');
      expect(row.textContent).toContain('가나목재 · 2026년 10월');
      expect(row.textContent).toContain('2장 · 공급가 800,000원');
      expect(row.textContent).toContain('11일이 지났는데 세금계산서가 아직 없습니다');
      row.querySelector('[data-act="held-attach"]').click();
      await flush();
      expect($('lgAttach').hidden).toBe(false);
      expect(calls.find((c) => c.url.startsWith(WORK + '/ledger/held/entries')).url).toBe(
        WORK + '/ledger/held/entries?biz_no=1234567891&name_key=' + encodeURIComponent('가나목재')
      );
      expect($('lgAtEntry').value).toBe(E1);
      const dry = calls.filter((c) => /\/attach$/.test(c.url));
      expect(dry.at(-1).body).toEqual({ document_ids: [D(1), D(2)], dry_run: true });
      expect($('lgAtRes').textContent).toContain('같습니다');
      expect($('lgAtCmp').textContent).toContain('명세표 공급가 합 (2장)');
      // 하나 빼면 다시 맞춰 본다
      const box = $('lgAtDocs').querySelector(`[data-doc="${D(2)}"]`);
      box.checked = false;
      box.dispatchEvent(new window.Event('change', { bubbles: true }));
      await flush();
      expect(calls.filter((c) => /\/attach$/.test(c.url)).at(-1).body).toEqual({
        document_ids: [D(1)],
        dry_run: true,
      });
      $('lgAtGo').click();
      await flush();
      expect(calls.filter((c) => /\/attach$/.test(c.url)).at(-1).body).toEqual({
        document_ids: [D(1)],
      });
      expect($('lgAttach').hidden).toBe(true);
      expect($('lgState').textContent).toBe('명세표 2장을 세금계산서 줄에 붙였습니다.');
    });

    test('세금계산서 사진을 올리면 그 거래처 모아 둔 명세표를 붙일지 묻는다', async () => {
      const TAX = { ...RESULT, evidence_type: 'tax_invoice', supplier_name: '가나목재' };
      await load({
        review: () =>
          ok({
            items: [
              doc(1, done(TAX), {
                hints: hints({
                  ready: false,
                  blockers: ['evidence_changed'],
                  supplier: { name: '가나목재', biz_no: '1234567891', key: 'b1234567891' },
                  proposal: { ...PROPOSAL, evidence_type: 'tax_invoice', entry_date: '2026-10-31' },
                }),
              }),
            ],
          }),
        decide: () => ok({ document_id: D(1), target: 'entry', entry_id: E1 }, 201),
        held: () => ok({ available: true, groups: [G], count: 2 }),
        heldEntries: () => ok({ items: [ENTRY] }),
        attach: attachReply,
      });
      await open(1);
      await submitSheet();
      expect($('lgSheet').hidden).toBe(true);
      expect($('lgAttach').hidden).toBe(false);
      expect($('lgAtEntry').value).toBe(E1);
    });

    test('거래처별 세금계산서 — 목록에서 바꾸면 열쇠로 고르고, 모아 둔 명세표가 돌아간 수를 알린다', async () => {
      const calls = await load({
        suppliers: (url, init) =>
          init && init.method === 'PUT'
            ? ok({
                key: 'b1234567891',
                mode: 'statement_only',
                name: '가나목재',
                released: 2,
                candidates: [],
              })
            : ok({
                available: true,
                items: [
                  {
                    supplier_key: 'b1234567891',
                    name: '가나목재',
                    mode: 'separate',
                    set_at: '2026-11-04T00:00:00Z',
                  },
                ],
              }),
      });
      expect($('lgSup').hidden).toBe(false);
      const sel = $('lgSupList').querySelector('select');
      expect(sel.value).toBe('separate');
      sel.value = 'statement_only';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await flush();
      expect(calls.find((c) => c.method === 'PUT').body).toEqual({
        supplier_key: 'b1234567891',
        mode: 'statement_only',
      });
      expect($('lgState').textContent).toBe(
        '가나목재 — 명세표만 줌 (모아 둔 명세표 2장을 확인할 사진으로)'
      );
    });

    test('맞춰 보기 글 — 다르면 차이 · 다 못 읽으면 그렇다고 (순수)', async () => {
      await load();
      const t = window.SeganLedger.compareText;
      expect(
        t({
          n: 2,
          basis: 'supply',
          statements: 800000,
          invoice: 1000000,
          diff: -200000,
          match: false,
        }).res
      ).toBe(
        '200,000원 다릅니다 — 빠진 명세표가 있거나 세금계산서가 잘못됐을 수 있습니다. 그래도 붙일 수 있습니다.'
      );
      const total = t({
        n: 2,
        basis: 'total',
        statements: null,
        invoice: 1100000,
        diff: null,
        match: null,
      });
      expect(total.rows[0]).toEqual(['명세표 합계 합 (2장)', '읽지 못한 값이 있음']);
      expect(total.good).toBe(null);
      expect(t({ n: 0 }).rows).toEqual([]);
    });
  });

  describe('사진 주소가 끝날 때 (서명 주소 10분)', () => {
    const URL2 = URL1.replace('token=t', 'token=t2');
    let clock;
    afterEach(() => clock && clock.mockRestore());

    test('사진을 열 때 — 9분 넘으면 불러온 장수만큼(더 보기 쪽까지) 다시 받아 새 주소로 연다', async () => {
      let photo = URL1;
      const first = Array.from({ length: 50 }, (_, k) => k + 1);
      const calls = await load({
        review: (url) =>
          ok({
            items: (url.includes('before=') ? [51, 52] : first).map((n) =>
              doc(n, done(), { photo_url: photo })
            ),
          }),
      });
      $('lgReviewMore').click();
      await flush();
      expect(rows().length).toBe(52);
      expect(window.SeganLedger.PHOTO_MARGIN_MS).toBe(60000);
      const now = Date.now();
      clock = jest.spyOn(Date, 'now');
      // 8분 — 그대로 연다
      clock.mockReturnValue(now + 8 * 60000);
      await open(52);
      expect(reviewGets(calls).length).toBe(2);
      expect($('lgRvPhoto').getAttribute('src')).toBe(URL1);
      $('lgRvClose').click();
      // 9분 넘음 (10분 − 1분) — 두 쪽을 다시 받고 연다
      photo = URL2;
      clock.mockReturnValue(now + 9 * 60000 + 1000);
      await open(52);
      expect(
        reviewGets(calls)
          .slice(2)
          .map((c) => c.url)
      ).toEqual([
        WORK + '/ledger/review?status=pending&limit=50',
        WORK +
          '/ledger/review?status=pending&limit=50&before=' +
          encodeURIComponent(doc(50).created_at),
      ]);
      expect(rows().length).toBe(52);
      expect($('lgSheet').hidden).toBe(false);
      expect($('lgRvPhoto').getAttribute('src')).toBe(URL2);
      expect(rowOf(1).querySelector('img').getAttribute('src')).toBe(URL2);
    });

    test('화면이 다시 보이거나 썸네일이 안 열리면 — 끝났을 때만 새로 받는다', async () => {
      let photo = URL1;
      const calls = await load({
        review: () => ok({ items: [doc(1, done(), { photo_url: photo })] }),
      });
      const thumbError = () =>
        rowOf(1).querySelector('img').dispatchEvent(new window.Event('error'));
      const now = Date.now();
      clock = jest.spyOn(Date, 'now');
      // 1분 — 썸네일 오류여도 묻지 않는다
      clock.mockReturnValue(now + 60000);
      thumbError();
      document.dispatchEvent(new window.Event('visibilitychange'));
      await flush();
      expect(reviewGets(calls).length).toBe(1);
      // 10분 — 화면이 다시 보이면 새 주소 (앞 시험들이 남긴 듣는 곳도 같은 document 에 있어 묻는 수는 세지 않는다)
      photo = URL2;
      clock.mockReturnValue(now + 10 * 60000);
      document.dispatchEvent(new window.Event('visibilitychange'));
      await flush();
      expect(rowOf(1).querySelector('img').getAttribute('src')).toBe(URL2);
      const base = reviewGets(calls).length;
      // 새로 받은 바로 뒤 — 오류가 나도 다시 묻지 않는다
      thumbError();
      await flush();
      expect(reviewGets(calls).length).toBe(base);
      // 또 끝나면 열 때 새로 — 칸을 고치는 중에는 썸네일 오류여도 그대로, 닫은 뒤에는 새로
      clock.mockReturnValue(now + 20 * 60000);
      await open(1);
      expect(reviewGets(calls).length).toBe(base + 1);
      clock.mockReturnValue(now + 30 * 60000);
      thumbError();
      await flush();
      expect(reviewGets(calls).length).toBe(base + 1);
      $('lgRvClose').click();
      thumbError();
      await flush();
      expect(reviewGets(calls).length).toBe(base + 2);
    });
  });

  test('순수 — 채우기 기준 · 경고 · 꼭 볼 칸 · 사업자번호', async () => {
    await load();
    const { prefillEntry, prefillFor, mustMarks, warningsOf, bizNoValid } = window.SeganLedger;
    // 공제 증빙 + 공급가 · 부가세 → 공급가 · 부가세
    expect(prefillEntry(RESULT)).toMatchObject({
      amount: 10000,
      vat_amount: 1000,
      deductible: true,
    });
    // 간이영수증 · 거래명세표 · 모름 → 합계 · 0
    for (const ev of ['simple_receipt', 'statement', 'other', null]) {
      expect(prefillEntry({ ...RESULT, evidence_type: ev })).toMatchObject({
        amount: 11000,
        vat_amount: 0,
        deductible: false,
      });
    }
    // 카드여도 부가세가 없으면 합계 · 0, 합계가 없으면 비운다 (계산해서 채우지 않는다)
    expect(prefillEntry({ ...RESULT, vat_amount: null })).toMatchObject({
      amount: 11000,
      vat_amount: 0,
    });
    expect(
      prefillEntry({ ...RESULT, evidence_type: 'simple_receipt', total_amount: null })
    ).toMatchObject({ amount: null, vat_amount: 0 });
    expect(prefillEntry(null)).toMatchObject({
      entry_date: '',
      amount: null,
      evidence_type: '',
      description: '',
    });
    expect(prefillEntry({ ...RESULT, items: [{ name: '경첩', amount: 1 }] }).description).toBe(
      '경첩'
    );
    expect(
      prefillEntry({ ...RESULT, evidence_type: 'photo', payment_method: 'coin' })
    ).toMatchObject({ evidence_type: '', payment_method: '' });
    // 경고
    expect(warningsOf(doc(1, done())).length).toBe(0);
    expect(
      warningsOf(
        doc(1, done(RESULT, { ...CHECKS, date: 'future', multiple: true, items: 'mismatch' }))
      ).map((w) => w.text)
    ).toEqual(['금액 합이 안 맞음', '날짜 확인', '한 장씩 다시 찍기']);
    expect(warningsOf(doc(1, { status: 'failed' }))).toEqual([]);
    // 채우기 — 서버 값이 먼저, 없으면 읽은 칸 · 서버 번호가 비면 읽은 번호를 보여 고치게
    expect(prefillFor(doc(1, done(), { hints: hints() }))).toMatchObject({
      ...PROPOSAL,
      deductible: true,
    });
    expect(prefillFor(doc(1, done()))).toEqual(prefillEntry(RESULT));
    expect(
      prefillFor(
        doc(1, done(), { hints: hints({ proposal: { ...PROPOSAL, counterparty_biz_no: null } }) })
      ).counterparty_biz_no
    ).toBe('1234567891');
    expect(prefillFor(doc(1, { status: 'running' }))).toEqual(prefillEntry(null));
    // 꼭 볼 칸 — 읽지 않은 사진은 표시 없음, 공제 안 되는 증빙은 부가세 까닭만
    expect(Object.values(mustMarks(doc(1, { status: 'running' }))).map((m) => m.mark)).toEqual([
      '',
      '',
      '',
      '',
      '',
    ]);
    const simple = mustMarks(doc(1, done({ ...RESULT, evidence_type: 'simple_receipt' })));
    expect([simple.vat.mark, simple.vat.why]).toEqual([
      'ok',
      '공제 안 되는 증빙이라 0 — 합계를 금액에 적었습니다',
    ]);
    expect(mustMarks(doc(1, done(RESULT, { ...CHECKS, date: 'future' }))).date.why).toBe(
      '앞날 날짜입니다'
    );
    expect(bizNoValid('123-45-67891')).toBe(true);
    expect(bizNoValid('1234567890')).toBe(false);
  });
});
