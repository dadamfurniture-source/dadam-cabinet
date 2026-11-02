/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 업체 회계장부 (segan/ledger.html + segan/ledger.js)
 *
 *   누가    GET /ledger/me — 대표 · 실장(money)만 장부. 직원 · 구성원 아님 · 자격 없음은 이유 한 줄, 장부를 묻지 않는다
 *           자격 read 는 보기만 (입력 · 고치기 · 취소 · 설정 저장 없음)
 *   화면    「종이 원본 5년 보관」 · 과세 설정 · 달 요약 · 장부 줄(직접 · 수금 · 수주 원가), 취소한 줄은 켜야 보인다
 *   쓰기    직접 입력은 X-Idempotency-Key, 고치기는 바뀐 칸 + 이유만, 취소는 이유 필수
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
      body: init.body ? JSON.parse(init.body) : null,
      key: headers['X-Idempotency-Key'] || null,
      auth: headers.Authorization,
    });
    const reply = (r) => ({ ok: r.ok, status: r.status, json: async () => r.body });
    if (url === WORK + '/ledger/me') return reply(opts.me);
    if (url === WORK + '/ledger/accounts') return reply(opts.accounts);
    if (url.startsWith(WORK + '/ledger/book'))
      return reply(opts.book(new URL(url).searchParams.get('month')));
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
        ok({ ...ME, role: 'staff', money: false, can_write: false, tax: undefined }),
        '장부는 업체 대표 · 실장만 봅니다.',
      ],
      [fail(403, 'not_member', 'x'), '장부는 업체 구성원만 씁니다.'],
      [fail(403, 'not_entitled', 'x'), '장부는 Agent 업체가 씁니다.'],
      [fail(500, '', 'x'), '장부를 불러오지 못했습니다.'],
    ]) {
      const calls = await load({ me });
      expect($('lgState').textContent).toBe(text);
      expect($('lgBody').hidden).toBe(true);
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
