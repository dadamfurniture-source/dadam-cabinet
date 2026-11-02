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
 *           (사진마다 X-Idempotency-Key, 메모는 X-Ledger-Note). 429 면 남은 사진을 멈춰 두고 다시 올리기,
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
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/ledger.html');
  const doc = new DOMParser().parseFromString(read('segan/ledger.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'DadamMyPageWork', 'SeganShell', 'SeganLedger']) delete window[k];
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
    if (url.startsWith(WORK + '/ledger/me'))
      return reply(typeof opts.me === 'function' ? opts.me(url) : opts.me);
    if (url === WORK + '/ledger/accounts') return reply(opts.accounts);
    if (url.startsWith(WORK + '/ledger/book'))
      return reply(opts.book(new URL(url).searchParams.get('month')));
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
    expect($('lgBody').hidden).toBe(false);
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
    expect(calls.at(-1).url).toBe(WORK + '/ledger/book?month=2026-10&include_void=1');
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
      [fail(403, 'not_entitled', 'x'), '장부는 Agent 업체가 씁니다.'],
      [fail(500, '', 'x'), '장부를 불러오지 못했습니다.'],
    ]) {
      const calls = await load({ me });
      expect($('lgState').textContent).toBe(text);
      expect($('lgBody').hidden).toBe(true);
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
    expect($('lgPhotosNote').textContent).toContain('지금은 사진을 모아 두고');
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
    expect($('lgBody').hidden).toBe(true);
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

  test('429 — 남은 사진은 멈춰 두고, 다시 올리기는 같은 키로 · 같은 사진은 「이미 올린 사진」', async () => {
    let n = 0;
    const calls = await load({
      upload: () => {
        n += 1;
        if (n === 2)
          return fail(429, 'rate_limited', '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요');
        if (n === 3) return ok({ document: { id: 'd' }, reused: true });
        return ok({ document: { id: 'd' + n }, reused: false }, 201);
      },
    });
    fakeMedia({ width: 1000, height: 800 });
    pick([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')], 'lgCamera');
    await flush();
    expect(posts(calls).length).toBe(2);
    expect($('lgUpState').textContent).toBe('1장 올림 · 2장 못 올림');
    expect($('lgUpFail').textContent).toContain('잠시 뒤 다시 시도해 주세요');
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
