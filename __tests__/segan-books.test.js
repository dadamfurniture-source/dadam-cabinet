/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Element */
/**
 * SEGAN 「내 정보 › 업체」 안의 회계 (segan/books.js + segan/me.html #meBooks)
 *
 *   누가    업체 대표 · 실장만 (account-api GET /partner/me 의 company.role).
 *           직원 · 업체 없음 · 본사 구성원 · /partner/me 를 못 읽음 → 묻지도 않고 칸이 없다
 *   데이터  workflow-api GET /books/summary?month=YYYY-MM (본인 토큰) → { success, data }
 *   화면    이번 달 · 지난달 계약액 · 받은 돈 · 견적 마진 · 실제 마진(실제 원가 없음 N건 — 대신 채우지 않는다)
 *           · 미수 · 상태별 수주 · 다가오는 수금 · 달 바꾸기 · PC ERP 링크
 *   못 읽음 처음엔 칸째 감추고, 달을 바꾸다 못 읽으면 한 줄 안내
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'owner@example.com' } };
const PAY = 'https://pay.example.workers.dev';
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const CO = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-29T03:00:00Z'); // 한국 시간 2026-10-29 12:00

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const company = (extra = {}) => ({
  id: CO,
  name: '다담 협력 주방',
  plan: 'agent',
  next_plan: null,
  status: 'active',
  sido: '대구광역시',
  gugun: '북구',
  role: 'owner',
  created_at: '2026-10-01T00:00:00Z',
  ...extra,
});
const partnerMe = (extra = {}) =>
  ok({ company: company(extra), application: null, members: [], invites: [] });

const monthOf = (month, extra = {}) => ({
  month,
  contract_total: 0,
  received_total: 0,
  quote_margin: 0,
  actual_margin: 0,
  actual_cost_missing: 0,
  ...extra,
});
/** /books/summary data — 기본: 2026-10 · 2026-09 */
const summary = (month = '2026-10', extra = {}) => {
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return {
    company: { id: CO, name: '다담 협력 주방' },
    month,
    months: [
      monthOf(month, {
        contract_total: 12000000,
        received_total: 4500000,
        quote_margin: 3100000,
        actual_margin: 2400000,
        actual_cost_missing: 2,
      }),
      monthOf(prev, {
        contract_total: 8000000,
        received_total: 9000000,
        quote_margin: 2000000,
        actual_margin: -150000,
        actual_cost_missing: 0,
      }),
    ],
    outstanding: { total: 7300000, count: 3 },
    status_counts: { confirmed: 4, in_production: 2, delivered: 1, completed: 9, cancelled: 0 },
    upcoming: [
      {
        order_id: 'o1',
        order_no: 'O-2026-0012',
        stage: 'interim',
        amount: 5000000,
        due_on: '2026-11-05',
      },
      {
        order_id: 'o2',
        order_no: 'O-2026-0009',
        stage: 'balance',
        amount: 2300000,
        due_on: '2026-11-20',
      },
    ],
    ...extra,
  };
};

/**
 * me.html 을 올린다. opts.books(month) → /books/summary 응답 (Error 면 끊김)
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerMe(),
    books: (month) => ok(summary(month)),
    workflowUrl: WORK,
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(opts.now == null ? NOW : opts.now);
  window.history.replaceState(null, '', '/segan/me.html');
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganBooks',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.workflowUrl },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async () => ({ data: [], error: null }),
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.fetch.push({
      url,
      method: init.method || 'GET',
      auth: (init.headers || {}).Authorization,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url.startsWith(WORK + '/books/summary')) {
      const month = new URL(url).searchParams.get('month');
      return reply(await opts.books(month));
    }
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/me/projects') return reply(fail(404, 'not_found', 'x'));
    return reply(ok({ ready: true, worker: null })); // /work/me
  });
  Element.prototype.scrollIntoView = jest.fn();
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/books.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const box = () => $('meBooks');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const bookGets = (calls) => calls.fetch.filter((f) => f.url.startsWith(WORK + '/books/'));
/** 표 → { 항목: [이번 달, 지난달] } (실제 원가 없음 안내는 따로) */
const table = () =>
  Object.fromEntries(
    [...box().querySelectorAll('.me-bk-table tbody tr')].map((tr) => [
      tr.querySelector('th').textContent,
      [...tr.querySelectorAll('td')].map((td) => {
        const c = td.cloneNode(true);
        c.querySelectorAll('.me-bk-miss').forEach((n) => n.remove());
        return c.textContent;
      }),
    ])
  );
const heads = () =>
  [...box().querySelectorAll('.me-bk-table thead th')].map((th) => th.textContent);
const missNotes = () =>
  [...box().querySelectorAll('.me-bk-table tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => {
      const n = td.querySelector('.me-bk-miss');
      return n ? n.textContent : null;
    })
  );
const statuses = () =>
  [...box().querySelectorAll('.me-bk-status li')].map((li) => [
    li.querySelector('span').textContent,
    li.querySelector('b').textContent,
  ]);
const upcoming = () =>
  [...box().querySelectorAll('.me-pt-list li')].map((li) => ({
    no: li.querySelector('b').textContent,
    sub: li.querySelector('small') ? li.querySelector('small').textContent : '',
    amount: li.querySelector('.me-bk-amt').textContent,
  }));
const navBtn = (act) => box().querySelector(`[data-act="${act}"]`);
const press = async (act) => {
  navBtn(act).click();
  await flush();
};

afterEach(() => jest.restoreAllMocks());

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 업체 내용(#mePartner) 아래 #meBooks, 처음엔 감춘다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('meBooks');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    // 업체 내용 · 상담 · 상담 설정(segan/partner-consults.js) 아래, 칸의 맨 끝
    const ids = [...el.parentElement.children].map((x) => x.id);
    const pos = (id) => ids.findIndex((x) => x === id);
    expect(pos('meBooks')).toBeGreaterThan(pos('mePartner'));
    expect(el.nextElementSibling).toBeNull();
    // books.js 를 업체 칸 스크립트 뒤 · me.js 앞에 싣는다
    const srcs = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
    const at = (name) => srcs.findIndex((s) => s.startsWith(name + '?v='));
    expect(at('books.js')).toBeGreaterThan(at('partner.js'));
    expect(at('books.js')).toBeLessThan(at('me.js'));
    // 서비스 워커가 미리 담는다
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'books.js')");
  });

  test('수주 상태 = erp.html STATUS_LABELS = 워커 ORDER_STATUS_LABELS, 수금 단계 = erp.html · 내 프로젝트와 같다', async () => {
    await load();
    const erp = read('erp.html');
    const status = Function(`return ${erp.match(/var STATUS_LABELS = (\{[\s\S]*?\});/)[1]}`)();
    const pay = Function(`return ${erp.match(/var PAY_STAGE_LABELS = (\{[\s\S]*?\});/)[1]}`)();
    const worker = Function(
      `return ${
        read('workers/workflow-api/src/order-events.js').match(
          /ORDER_STATUS_LABELS = Object\.freeze\((\{[\s\S]*?\})\);/
        )[1]
      }`
    )();
    expect(window.SeganBooks.ORDER_STATUS).toEqual(status);
    expect(window.SeganBooks.ORDER_STATUS).toEqual(worker);
    expect(window.SeganBooks.PAY_STAGE).toEqual(pay);
    expect(window.SeganBooks.PAY_STAGE).toEqual(window.SeganMe.PAY_STAGE);
  });
});

describe('누가 보나 — 대표 · 실장만', () => {
  test('대표 — 본인 토큰으로 이번 달(한국 시간)을 묻고, 업체 칸 안에 회계가 보인다', async () => {
    const calls = await load();
    expect(bookGets(calls)).toEqual([
      { url: WORK + '/books/summary?month=2026-10', method: 'GET', auth: 'Bearer tok-1' },
    ]);
    expect($('partner').hidden).toBe(false);
    expect(box().hidden).toBe(false);
    expect(box().querySelector('h3').textContent).toBe('회계');
    // 업체 칸 내용은 그대로
    expect($('mePartner').querySelector('[data-view="company"]')).not.toBeNull();
  });

  test('실장도 본다', async () => {
    const calls = await load({ partner: partnerMe({ role: 'manager' }) });
    expect(bookGets(calls)).toHaveLength(1);
    expect(box().hidden).toBe(false);
  });

  test.each([
    ['직원', { partner: partnerMe({ role: 'staff' }) }],
    ['업체 없음', { partner: ok({ company: null, application: null, members: [], invites: [] }) }],
    [
      '본사 구성원',
      { partner: ok({ hq_member: true, company: company(), members: [], invites: [] }) },
    ],
    ['/partner/me 404', { partner: fail(404, 'not_found', 'x') }],
    ['/partner/me 끊김', { partner: new TypeError('Failed to fetch') }],
    ['모르는 역할', { partner: partnerMe({ role: 'admin' }) }],
    ['workflow-api 주소 없음', { workflowUrl: '' }],
  ])('%s — 묻지도 않고 칸이 없다', async (_name, extra) => {
    const calls = await load(extra);
    expect(bookGets(calls)).toEqual([]);
    expect(box().hidden).toBe(true);
    expect(box().textContent).toBe('');
  });

  test('로그인 없으면 아무것도 읽지 않는다', async () => {
    const calls = await load({ session: null });
    expect(calls.fetch).toEqual([]);
    expect(box().hidden).toBe(true);
  });

  test('canSee — 순수 판정', async () => {
    await load();
    const { canSee } = window.SeganBooks;
    expect(canSee({ company: { role: 'owner' } })).toBe(true);
    expect(canSee({ company: { role: 'manager' } })).toBe(true);
    expect(canSee({ company: { role: 'staff' } })).toBe(false);
    expect(canSee({ company: null })).toBe(false);
    expect(canSee({ hq_member: true, company: { role: 'owner' } })).toBe(false);
    expect(canSee(null)).toBe(false);
    expect(canSee([])).toBe(false);
  });
});

describe('보이는 것', () => {
  test('이번 달 · 지난달 — 계약액 · 받은 돈 · 견적 마진 · 실제 마진 (원 · 천 단위 쉼표)', async () => {
    await load();
    expect(box().querySelector('.me-bk-month').textContent).toBe('2026년 10월');
    expect(heads()).toEqual(['항목', '10월', '9월']);
    expect(table()).toEqual({
      계약액: ['12,000,000원', '8,000,000원'],
      '받은 돈': ['4,500,000원', '9,000,000원'],
      '견적 마진': ['3,100,000원', '2,000,000원'],
      '실제 마진': ['2,400,000원', '-150,000원'],
    });
  });

  test('실제 원가가 빠진 수주가 있으면 실제 마진 옆에 「실제 원가 없음 N건」 — 그 달 칸에만', async () => {
    await load();
    expect(missNotes()).toEqual([
      [null, null],
      [null, null],
      [null, null],
      ['실제 원가 없음 2건', null],
    ]);
  });

  test('실제 마진이 없으면 「-」 — 견적 마진으로 채우지 않는다', async () => {
    await load({
      books: (month) =>
        ok(
          summary(month, {
            months: [
              monthOf('2026-10', {
                contract_total: 5000000,
                quote_margin: 1234567,
                actual_margin: null,
                actual_cost_missing: 4,
              }),
              monthOf('2026-09', { quote_margin: 7654321, actual_margin: undefined }),
            ],
          })
        ),
    });
    expect(table()['실제 마진']).toEqual(['-', '-']);
    expect(missNotes()[3]).toEqual(['실제 원가 없음 4건', null]);
    const actual = box().querySelectorAll('.me-bk-table tbody tr')[3].textContent;
    expect(actual).not.toContain('1,234,567');
    expect(actual).not.toContain('7,654,321');
  });

  test('그 달 줄이 없으면 그 칸은 「-」 (다른 달 값을 끌어오지 않는다)', async () => {
    await load({
      books: (month) =>
        ok(
          summary(month, {
            months: [
              monthOf('2026-08', { contract_total: 999 }),
              monthOf('2026-10', { contract_total: 100 }),
            ],
          })
        ),
    });
    expect(table()['계약액']).toEqual(['100원', '-']);
    expect(table()['받은 돈']).toEqual(['0원', '-']);
  });

  test('미수 — 금액 · 건수', async () => {
    await load();
    const dl = box().querySelector('.me-bk-facts');
    expect(dl.querySelector('dt').textContent).toBe('미수');
    expect(dl.querySelector('dd').textContent).toBe('7,300,000원 · 3건');
  });

  test('미수가 없으면 「-」', async () => {
    await load({ books: (month) => ok(summary(month, { outstanding: null })) });
    expect(box().querySelector('.me-bk-facts dd').textContent).toBe('-');
  });

  test('상태별 수주 — 접수 · 생산 중 · 배송 · 완료 · 취소', async () => {
    await load();
    expect(statuses()).toEqual([
      ['접수', '4'],
      ['생산 중', '2'],
      ['배송', '1'],
      ['완료', '9'],
      ['취소', '0'],
    ]);
  });

  test('다가오는 수금 — 수주 번호 · 단계 · 금액 · 날짜 (받은 순서 그대로)', async () => {
    await load();
    expect(upcoming()).toEqual([
      { no: 'O-2026-0012', sub: '중도금 · 2026.11.05', amount: '5,000,000원' },
      { no: 'O-2026-0009', sub: '잔금 · 2026.11.20', amount: '2,300,000원' },
    ]);
  });

  test.each([
    ['deposit', '계약금'],
    ['interim', '중도금'],
    ['balance', '잔금'],
    ['other', '기타'],
  ])('수금 단계 %s → %s', async (stage, label) => {
    await load({
      books: (month) =>
        ok(
          summary(month, {
            upcoming: [{ order_no: 'O-1', stage, amount: 1, due_on: '2026-11-01' }],
          })
        ),
    });
    expect(upcoming()[0].sub).toBe(`${label} · 2026.11.01`);
  });

  test('다가오는 수금이 없으면 한 줄', async () => {
    await load({ books: (month) => ok(summary(month, { upcoming: [] })) });
    expect(upcoming()).toEqual([]);
    expect(box().querySelector('.me-empty').textContent).toBe('다가오는 수금이 없습니다.');
  });

  test('PC ERP 링크 — 수주 상세 · 원가 · 수금 입력 (../erp.html, 사이트 안)', async () => {
    await load();
    const a = box().querySelector('a.sg-row');
    expect(a.textContent).toBe('수주 상세 · 원가 · 수금 입력은 PC ERP에서');
    expect(a.getAttribute('href')).toBe('../erp.html');
    expect(fs.existsSync(path.join(ROOT, 'segan', '../erp.html'))).toBe(true);
  });

  test('API 글은 글자로만 넣는다 · 고객 정보 칸이 섞여 와도 그리지 않는다', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({
      books: (month) =>
        ok(
          summary(month, {
            upcoming: [
              {
                order_id: 'o1',
                order_no: bad,
                stage: bad,
                amount: 1000,
                due_on: '2026-11-01',
                customer_name: '홍길동',
                customer_phone: '010-1111-2222',
                address: '대구광역시 북구 어딘가 1',
              },
            ],
          })
        ),
    });
    expect(box().querySelector('img')).toBeNull();
    expect(box().querySelector('[onerror]')).toBeNull();
    expect(box().textContent.split(bad).length - 1).toBe(2); // 수주 번호 · 단계
    for (const t of ['홍길동', '010-1111-2222', '어딘가'])
      expect(box().textContent).not.toContain(t);
  });
});

describe('못 읽으면 — 처음엔 칸째 감춘다', () => {
  test.each([
    ['403', () => fail(403, 'forbidden', 'x')],
    ['404 (아직 배포 전)', () => fail(404, 'not_found', 'x')],
    ['500', () => fail(500, 'error', 'x')],
    ['끊김', () => new TypeError('Failed to fetch')],
    [
      '본문이 JSON 아님',
      () => ({
        ok: true,
        status: 200,
        get body() {
          throw new SyntaxError('Unexpected token');
        },
      }),
    ],
    ['success 아님', () => ({ ok: true, status: 200, body: { success: false, data: summary() } })],
    ['data 없음', () => ({ ok: true, status: 200, body: { success: true } })],
    ['data 가 목록', () => ok([])],
    ['month 형식이 틀림', () => ok(summary('2026-10', { month: '2026/10' }))],
    ['months 가 목록 아님', () => ok(summary('2026-10', { months: {} }))],
  ])('%s', async (_name, books) => {
    await load({ books });
    expect(box().hidden).toBe(true);
    expect(box().textContent).toBe('');
    // 업체 칸 · 다른 칸은 그대로
    expect($('partner').hidden).toBe(false);
    expect($('mePartner').querySelector('[data-view="company"]')).not.toBeNull();
    expect($('meSub').textContent).toBe('없음');
  });
});

describe('달 바꾸기', () => {
  test('지난달 → 그 달을 묻고 표 머리 · 이름이 바뀐다, 이번 달에서는 다음 달로 가지 않는다', async () => {
    const calls = await load();
    expect(navBtn('next').disabled).toBe(true);
    expect(navBtn('prev').disabled).toBe(false);
    expect(navBtn('prev').getAttribute('aria-label')).toBe('지난달');
    await press('prev');
    expect(bookGets(calls).map((f) => f.url)).toEqual([
      WORK + '/books/summary?month=2026-10',
      WORK + '/books/summary?month=2026-09',
    ]);
    expect(bookGets(calls)[1].auth).toBe('Bearer tok-1');
    expect(box().querySelector('.me-bk-month').textContent).toBe('2026년 9월');
    expect(heads()).toEqual(['항목', '9월', '8월']);
    expect(navBtn('next').disabled).toBe(false);
    await press('next');
    expect(box().querySelector('.me-bk-month').textContent).toBe('2026년 10월');
    expect(navBtn('next').disabled).toBe(true);
    expect(bookGets(calls)).toHaveLength(3);
  });

  test('해를 넘어간다 — 1월의 지난달은 지난해 12월', async () => {
    const calls = await load({ now: Date.parse('2026-01-10T00:00:00Z') });
    expect(heads()).toEqual(['항목', '1월', '12월']);
    await press('prev');
    expect(bookGets(calls)[1].url).toBe(WORK + '/books/summary?month=2025-12');
    expect(box().querySelector('.me-bk-month').textContent).toBe('2025년 12월');
    expect(heads()).toEqual(['항목', '12월', '11월']);
  });

  test('묻는 동안은 단추를 잠근다 (겹쳐 묻지 않는다)', async () => {
    let release;
    const calls = await load({
      books: (month) =>
        month === '2026-10'
          ? ok(summary(month))
          : new Promise((r) => {
              release = () => r(ok(summary(month)));
            }),
    });
    navBtn('prev').click();
    await flush();
    expect(navBtn('prev').disabled).toBe(true);
    expect(navBtn('next').disabled).toBe(true);
    navBtn('prev').click();
    await flush();
    expect(bookGets(calls)).toHaveLength(2);
    release();
    await flush();
    expect(box().querySelector('.me-bk-month').textContent).toBe('2026년 9월');
    expect(navBtn('prev').disabled).toBe(false);
  });

  test('바꾼 달을 못 읽으면 한 줄 안내 — 달 바꾸기 · ERP 링크는 남고, 다시 바꿀 수 있다', async () => {
    const calls = await load({
      books: (month) => (month === '2026-09' ? fail(500, 'error', 'x') : ok(summary(month))),
    });
    await press('prev');
    expect(box().hidden).toBe(false);
    expect(box().querySelector('.me-pt-msg').textContent).toBe('이 달 회계를 불러오지 못했습니다.');
    expect(box().querySelector('.me-bk-table')).toBeNull();
    expect(box().querySelector('.me-bk-month').textContent).toBe('2026년 9월');
    expect(box().querySelector('a.sg-row').getAttribute('href')).toBe('../erp.html');
    await press('prev');
    expect(
      bookGets(calls)
        .map((f) => f.url)
        .pop()
    ).toBe(WORK + '/books/summary?month=2026-08');
    expect(box().querySelector('.me-pt-msg')).toBeNull();
    expect(heads()).toEqual(['항목', '8월', '7월']);
  });
});

describe('달 계산 (순수 함수)', () => {
  test('thisMonth — 한국 시간', async () => {
    await load();
    const { thisMonth } = window.SeganBooks;
    expect(thisMonth(Date.parse('2026-10-31T14:59:00Z'))).toBe('2026-10'); // 한국 23:59
    expect(thisMonth(Date.parse('2026-10-31T15:00:00Z'))).toBe('2026-11'); // 한국 11-01 00:00
    expect(thisMonth(Date.parse('2026-12-31T15:30:00Z'))).toBe('2027-01');
  });

  test('shiftMonth', async () => {
    await load();
    const { shiftMonth } = window.SeganBooks;
    expect(shiftMonth('2026-10', -1)).toBe('2026-09');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-10', -13)).toBe('2025-09');
    expect(shiftMonth('bad', -1)).toBe('');
  });

  test('monthRow · summaryOf', async () => {
    await load();
    const { monthRow, summaryOf } = window.SeganBooks;
    const d = summary('2026-10');
    expect(monthRow(d, '2026-09').contract_total).toBe(8000000);
    expect(monthRow(d, '2026-07')).toBeNull();
    expect(monthRow({ months: [null, 3] }, '2026-10')).toBeNull();
    expect(summaryOf({ success: true, data: d })).toBe(d);
    expect(summaryOf(d)).toBeNull(); // 감싸지 않은 본문은 받지 않는다 ({ success, data })
    expect(summaryOf(null)).toBeNull();
  });
});
