/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, localStorage, jest, setTimeout, Element, Event */
/**
 * SEGAN 「프로젝트 관리 › 영업 › 견적」 의 견적서 목록 (segan/quotes.js + segan/me.html #quotes)
 *
 *   누가    프로젝트를 가지는 업체 구성원 — 다담 공장 구성원 · 협력업체 Manager · Expert · Agent (직원도)
 *   데이터  workflow-api GET /company/quotes (마이페이지 5단계 — 업체가 보낸 고객 확인서 모아 읽기)
 *   화면    거르기 단추 넷 · 견적서 줄(고객 · 프로젝트 · 날 · 번호 · 판 · 상태 · 합계 · 열람 · 결정) — 보기만 한다
 *   못 읽으면 칸째 감춘다 — 견적 화면에는 견적 단계 프로젝트만 남는다
 *   고객 이름 · 금액 · 문서 번호는 모두 지어낸 것이다
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
const NOW = Date.parse('2026-11-11T03:00:00Z');

const ok = (data, status = 200) => ({ ok: true, status, body: { success: true, data } });
const fail = (status, code, message) => ({
  ok: false,
  status,
  body: { success: false, code, message },
});
const HQ = ok({ company: null, application: null, members: [], invites: [], hq_member: true });
const PLATFORM = ok({
  company: null,
  application: null,
  members: [],
  invites: [],
  platform_member: true,
});
const NOBODY = ok({ company: null, application: null, members: [], invites: [] });
const company = (plan, role = 'staff', status = 'active') => ({
  id: CO,
  name: '다담 협력 주방',
  plan,
  next_plan: null,
  status,
  sido: '대구광역시',
  gugun: '북구',
  role,
  created_at: '2026-10-01T00:00:00Z',
});
const partnerOf = (plan, role, status) =>
  ok({ company: company(plan, role, status), application: null, members: [], invites: [] });

const mod = () => {
  delete window.SeganQuotes;
  (0, eval)(read('segan/quotes.js'));
  return window.SeganQuotes;
};

/** 서버 GET /company/quotes 의 한 줄 */
const qt = (id, patch = {}) => ({
  id,
  doc_no: 'DD-' + id,
  rev: 1,
  status: 'issued',
  title: '예시 견적',
  created_at: '2026-11-10T02:00:00Z',
  expires_at: null,
  first_viewed_at: null,
  view_count: 0,
  decision: null,
  decided_at: null,
  superseded: false,
  totals: { subtotal: 3000000, vat: 300000, total: 3300000 },
  design: { id: 'd-' + id, name: '예시 설계' },
  project: { id: 'p-' + id, title: '예시 싱크대' },
  customer_name: '예시 김고객',
  ...patch,
});
const ITEMS = () => [
  qt('q-1', {
    view_count: 3,
    first_viewed_at: '2026-11-10T05:00:00Z',
    expires_at: '2026-11-24T15:00:00Z',
  }),
  qt('q-2', {
    rev: 2,
    status: 'approved',
    decision: 'approved',
    decided_at: '2026-11-09T01:00:00Z',
    view_count: 5,
    first_viewed_at: '2026-11-08T01:00:00Z',
    customer_name: '예시 박고객',
    project: { id: 'p-2', title: '예시 냉장고장' },
  }),
  qt('q-3', { status: 'superseded', superseded: true }),
  qt('q-4', {
    status: 'rejected',
    decision: 'rejected',
    decided_at: '2026-11-07T01:00:00Z',
    project: null,
    customer_name: '최**',
    design: { id: 'd-4', name: '신발장' },
  }),
  qt('q-5', {
    status: 'revoked',
    totals: null,
    doc_no: null,
    rev: null,
    design: { id: 'd-5', name: null },
    project: null,
    title: null,
    customer_name: null,
  }),
];

/**
 * 마이페이지를 띄운다 (기본 = Agent 업체 직원, 견적 화면)
 * opts.list() 로 답을 바꾼다
 */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    partner: partnerOf('agent', 'staff'),
    hash: '#p-quote',
    list: null,
    work: WORK,
    ...options,
  };
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  window.history.replaceState(null, '', '/segan/me.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  localStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'SeganMake',
    'SeganMe',
    'SeganPartner',
    'SeganPartnerProjects',
    'SeganOrders',
    'SeganQuotes',
    'SeganRegions',
    'TossPayments',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: opts.work },
    paymentsApi: { url: PAY },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) =>
        name === 'is_admin' ? { data: false, error: null } : { data: [], error: null },
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
      cache: init.cache,
    });
    const reply = (r) => {
      if (r instanceof Error) throw r;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    };
    if (url === ACC + '/partner/me') return reply(opts.partner);
    if (url === WORK + '/company/quotes')
      return reply(opts.list ? await opts.list() : ok({ company: { id: CO }, items: ITEMS() }));
    if (url === WORK + '/company/projects')
      return reply(ok({ company: { id: CO }, can_manage: false, members: [], items: [] }));
    if (url === PAY + '/subscription') return reply(ok({ plan: 'free', status: 'active' }));
    if (url === PAY + '/plans') return reply(ok({ client_key: 'k', plans: [] }));
    if (url === WORK + '/work/me') return reply(ok({ ready: true, worker: null }));
    return reply(fail(404, 'not_found', 'x'));
  });
  Element.prototype.scrollIntoView = jest.fn();
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/regions.js',
    'segan/partner.js',
    'segan/partner-projects.js',
    'segan/quotes.js',
    'segan/shell.js',
    'segan/make.js',
    'segan/me.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganMe.ready;
  await flush();
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
/** 화면에 보이는가 — 모듈이 감춘 칸(hidden) · 마이페이지가 끈 칸(me-off) 은 아니다 */
const seen = (id) => !!$(id) && !$(id).hidden && !$(id).classList.contains('me-off');
const box = () => $('quotes');
const q = (sel) => box().querySelector(sel);
const qa = (sel) => [...box().querySelectorAll(sel)];
const rows = () => qa('li[data-qt-row]');
const ids = () => rows().map((li) => li.getAttribute('data-qt-row'));
const chip = (k) => q(`[data-act="filter"][data-filter="${k}"]`);
const facts = (li) =>
  Object.fromEntries(
    [...li.querySelectorAll('.al-facts > div')].map((d) => [
      text(d.querySelector('dt')),
      text(d.querySelector('dd')),
    ])
  );
const press = async (el) => {
  el.click();
  await flush();
};
const asked = (calls) =>
  calls.fetch.filter((c) => c.url === WORK + '/company/quotes').map((c) => c.method);

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('자리 · 이름', () => {
  test('me.html — 업체 칸(#partner) 안, 수주 표 다음 · 처음엔 감춘다 · me.js 앞에 읽는다 · 서비스 워커가 담는다', () => {
    const doc = new DOMParser().parseFromString(read('segan/me.html'), 'text/html');
    const el = doc.getElementById('quotes');
    expect(el).not.toBeNull();
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.closest('section').id).toBe('partner');
    expect(el.previousElementSibling.id).toBe('orders');
    const srcs = [...doc.querySelectorAll('script[src]')].map(
      (s) => s.getAttribute('src').split('?')[0]
    );
    const at = (name) => srcs.findIndex((s) => s === name);
    for (const name of ['quotes.js', 'shell.js', 'me.js']) {
      expect(at(name)).toBeGreaterThanOrEqual(0);
    }
    expect(at('quotes.js')).toBeLessThan(at('me.js'));
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'quotes.js')");
  });

  test('등급 · 상태 이름은 서버 · PC 상세설계와 같다', () => {
    const Q = mod();
    const server = read('workers/workflow-api/src/company-projects.js');
    expect(Q.PLANS).toEqual(['manager', 'expert', 'agent']);
    expect(server).toContain("PROJECT_PLANS = Object.freeze(['manager', 'expert', 'agent'])");
    expect(read('workers/workflow-api/src/worker.js')).toContain("path: '/company/quotes'");
    const pc = read('js/detaildesign/workflow-client.js');
    expect(pc).toContain(Q.TEXT.approved);
    expect(pc).toContain(Q.TEXT.rejected);
    expect(Q.FILTERS.map((f) => f[0])).toEqual(['all', 'waiting', 'approved', 'rejected']);
  });

  test('보기만 한다 — 서버에 쓰지 않고, 기기에 남기지 않고, 확인 창도 띄우지 않는다', () => {
    const code = read('segan/quotes.js')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toMatch(/method:/); // GET 만
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|Notification/);
    expect(code).not.toMatch(/\b(confirm|alert|prompt)\(/);
  });
});

describe('순수 함수', () => {
  test('canSee — 다담 공장 구성원 · active 협력업체 Manager · Expert · Agent 구성원(직원도)', () => {
    const Q = mod();
    const me = (r) => r.body.data;
    expect(Q.canSee(me(HQ))).toBe(true);
    for (const plan of ['manager', 'expert', 'agent']) {
      for (const role of ['owner', 'manager', 'staff']) {
        expect(Q.canSee(me(partnerOf(plan, role)))).toBe(true);
      }
    }
    expect(Q.canSee(me(partnerOf('agent', 'owner', 'suspended')))).toBe(false);
    expect(Q.canSee(me(partnerOf('standard', 'owner')))).toBe(false);
    expect(Q.canSee(me(partnerOf(null, 'owner')))).toBe(false);
    expect(Q.canSee(me(PLATFORM))).toBe(false);
    expect(Q.canSee(me(NOBODY))).toBe(false);
    expect(Q.canSee(null)).toBe(false);
  });

  test('stateOf — 결정이 먼저, 그다음 거둠 · 지난 판, 나머지는 답 기다림', () => {
    const Q = mod();
    expect(Q.stateOf({ decision: 'approved', status: 'approved', superseded: true })).toBe(
      'approved'
    );
    expect(Q.stateOf({ decision: 'rejected', status: 'rejected' })).toBe('rejected');
    expect(Q.stateOf({ decision: '', status: 'revoked' })).toBe('revoked');
    expect(Q.stateOf({ decision: '', status: 'superseded' })).toBe('superseded');
    expect(Q.stateOf({ decision: '', status: 'issued', superseded: true })).toBe('superseded');
    expect(Q.stateOf({ decision: '', status: 'issued' })).toBe('waiting');
  });

  test('rowOf · listOf · counts · filtered', () => {
    const Q = mod();
    expect(Q.rowOf({ doc_no: 'x' })).toBeNull();
    expect(Q.listOf({ items: 'x' })).toBeNull();
    expect(Q.listOf(null)).toBeNull();
    const list = Q.listOf({ items: [...ITEMS(), null, {}] });
    expect(list.map((r) => r.state)).toEqual([
      'waiting',
      'approved',
      'superseded',
      'rejected',
      'revoked',
    ]);
    expect(Q.counts(list)).toEqual({ all: 5, waiting: 1, approved: 1, rejected: 1 });
    expect(Q.filtered(list, 'all').length).toBe(5);
    expect(Q.filtered(list, 'waiting').map((r) => r.id)).toEqual(['q-1']);
    expect(Q.rowOf({ id: 'a', totals: { total: '3' }, view_count: 'x' })).toMatchObject({
      total: null,
      views: 0,
      state: 'waiting',
    });
  });

  test('day · won · subOf · totalText · seenText', () => {
    const Q = mod();
    expect(Q.day('2026-11-10T16:00:00Z')).toBe('11.11'); // 한국 시간
    expect(Q.day('엉뚱')).toBe('');
    expect(Q.won(3300000)).toBe('3,300,000원');
    expect(Q.won(null)).toBe('');
    const [a, , , , e] = Q.listOf({ items: ITEMS() });
    expect(Q.subOf(a)).toBe('11.10 · DD-q-1 · 1판');
    expect(Q.subOf(e)).toBe('11.10');
    expect(Q.totalText(a)).toBe('3,300,000원 (공급가 3,000,000원 + 부가세 300,000원)');
    expect(Q.totalText({ total: 5000, subtotal: null, vat: null })).toBe('5,000원');
    expect(Q.totalText(e)).toBe('');
    expect(Q.seenText(a)).toBe('3번 (처음 11.10)');
    expect(Q.seenText(e)).toBe('아직 안 봄');
    expect(Q.seenText({ views: 2, firstViewedAt: '' })).toBe('2번');
  });
});

describe('화면', () => {
  test('업체 직원 — 한 번 읽어 견적서 줄을 그린다 (본인 토큰 · 캐시 없이)', async () => {
    const calls = await load();
    expect(asked(calls)).toEqual(['GET']);
    const c = calls.fetch.find((x) => x.url === WORK + '/company/quotes');
    expect(c.auth).toBe('Bearer tok-1');
    expect(c.cache).toBe('no-store');
    expect(seen('quotes')).toBe(true);
    expect(text($('quotesTitle'))).toBe('견적서');
    expect(qa('[data-act="filter"]').map(text)).toEqual([
      '전체 5',
      '답 기다림 1',
      '고객 확인 완료 1',
      '수정 요청 1',
    ]);
    expect(chip('all').getAttribute('aria-pressed')).toBe('true');
    expect(ids()).toEqual(['q-1', 'q-2', 'q-3', 'q-4', 'q-5']);
    const [a, b, c2, d, e] = rows();
    expect(text(a.querySelector('b'))).toBe('예시 김고객 · 예시 싱크대');
    expect(text(a.querySelector('small'))).toBe('11.10 · DD-q-1 · 1판');
    expect(text(a.querySelector('.dr-kind'))).toBe('답 기다림');
    expect(facts(a)).toEqual({
      합계: '3,300,000원 (공급가 3,000,000원 + 부가세 300,000원)',
      열람: '3번 (처음 11.10)',
      기한: '11.25',
    });
    expect(text(b.querySelector('.dr-kind'))).toBe('고객 확인 완료');
    expect(facts(b)).toMatchObject({ 열람: '5번 (처음 11.08)', 결정: '11.09' });
    expect(text(c2.querySelector('.dr-kind'))).toBe('지난 판');
    expect(c2.classList.contains('me-cs-item--off')).toBe(true);
    // 프로젝트에 잇지 않은 설계 — 설계 이름, 가린 고객 이름 그대로
    expect(text(d.querySelector('b'))).toBe('최** · 신발장');
    expect(text(d.querySelector('.dr-kind'))).toBe('수정 요청');
    // 거둔 견적서 — 금액 · 번호 · 이름이 없다
    expect(text(e.querySelector('b'))).toBe('고객 이름 없음 · 이름 없는 설계');
    expect(text(e.querySelector('.dr-kind'))).toBe('거둠');
    expect(facts(e)).toEqual({ 열람: '아직 안 봄' });
    expect(e.classList.contains('me-cs-item--off')).toBe(true);
  });

  test('거르기 — 서버에 묻지 않고 거른다. 드는 것이 없으면 안내 글', async () => {
    const items = ITEMS().filter((x) => x.id !== 'q-4');
    const calls = await load({ list: () => ok({ items }) });
    await press(chip('waiting'));
    expect(ids()).toEqual(['q-1']);
    expect(chip('waiting').getAttribute('aria-pressed')).toBe('true');
    expect(chip('all').getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(chip('waiting'));
    await press(chip('approved'));
    expect(ids()).toEqual(['q-2']);
    await press(chip('rejected'));
    expect(rows().length).toBe(0);
    expect(text(q('[data-qt="empty"]'))).toBe('여기에 드는 견적서가 없습니다.');
    await press(chip('all'));
    expect(rows().length).toBe(4);
    expect(asked(calls).length).toBe(1);
  });

  test('견적서가 없으면 — 안내 글만 (거르기 단추 없음)', async () => {
    await load({ list: () => ok({ items: [] }) });
    expect(seen('quotes')).toBe(true);
    expect(text(q('[data-qt="empty"]'))).toBe('보낸 견적서가 없습니다.');
    expect(qa('[data-act="filter"]').length).toBe(0);
  });

  test('고객 이름 · 프로젝트 이름은 글자 그대로 그린다', async () => {
    const items = ITEMS();
    items[0].customer_name = '<img src=x onerror=1>';
    items[0].project.title = '<script>x</script>';
    await load({ list: () => ok({ items }) });
    expect(q('img')).toBeNull();
    expect(q('script')).toBeNull();
    expect(text(rows()[0].querySelector('b'))).toBe('<img src=x onerror=1> · <script>x</script>');
  });

  test('견적 화면에서만 보인다 — 다른 단계 화면에서는 꺼진다', async () => {
    await load({ hash: '#p-contract' });
    expect(seen('quotes')).toBe(false);
    window.location.hash = '#p-quote';
    window.dispatchEvent(new Event('hashchange'));
    await flush();
    expect(seen('quotes')).toBe(true);
  });

  test('다담 공장 구성원 · Manager 업체 — 보인다', async () => {
    for (const partner of [HQ, partnerOf('manager', 'owner')]) {
      const calls = await load({ partner });
      expect(asked(calls)).toEqual(['GET']);
      expect(seen('quotes')).toBe(true);
    }
  }, 20000);
});

describe('안 보이는 때', () => {
  test('본사 구성원 · 업체 없는 사람 · 멈춘 업체 · 로그인하지 않은 사람 · 워커 주소 없음 — 묻지 않는다', async () => {
    for (const o of [
      { partner: PLATFORM },
      { partner: NOBODY },
      { partner: partnerOf('agent', 'owner', 'suspended') },
      { session: null },
      { work: '' },
    ]) {
      const calls = await load(o);
      expect(asked(calls)).toEqual([]);
      expect(seen('quotes')).toBe(false);
      expect(box().innerHTML).toBe('');
    }
  }, 30000);

  test('못 읽으면(403 · 오류 · 끊김 · 목록 없는 답) — 칸째 감춘다', async () => {
    for (const list of [
      () => fail(403, 'not_project_company', '프로젝트를 쓸 수 있는 팩토리가 아닙니다'),
      () => fail(404, 'not_found', 'Not found'),
      () => new Error('offline'),
      () => ok({ items: 'x' }),
      () => ok(null),
    ]) {
      const calls = await load({ list });
      expect(asked(calls)).toEqual(['GET']);
      expect(seen('quotes')).toBe(false);
      expect(box().hidden).toBe(true);
      expect(box().innerHTML).toBe('');
    }
  }, 30000);
});
