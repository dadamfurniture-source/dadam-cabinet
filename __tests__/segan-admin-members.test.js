/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout, Event */
/**
 * SEGAN 「관리 › 회원」 (segan/admin-members.js + segan/admin.html#members, 보기만)
 *
 *   들어오기  관리 첫 화면 「찾기 › 회원」 = #members
 *   읽는 것    Supabase profiles (최근 가입 20명, 이름 · 이메일 찾기 = or ilike) + 그 20명의 subscriptions · user_credits
 *             — PC admin/users.html 과 같은 표 · 같은 관리자 권한, 새 서버 주소 없음
 *   화면      이름 · 이메일 · 등급 · 구독 · 크레딧 · 상세설계 · 지역 · 가입. 바꾸기는 PC에서
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'admin-1', email: 'admin@example.com' } };
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';
const U1 = 'u1111111-1111-4111-8111-111111111111';
const U2 = 'u2222222-2222-4222-8222-222222222222';

const PROFILES = [
  {
    id: U1,
    name: '김고객',
    email: 'kim@example.test',
    tier: 'expert',
    tier_source: 'subscription',
    provider: 'google',
    sido: '대구광역시',
    gugun: '북구',
    detaildesign_approved: true,
    created_at: '2026-10-31T16:00:00Z', // 한국 시간 11-01
  },
  {
    id: U2,
    name: null,
    email: 'lee@example.test',
    tier: null,
    provider: null,
    detaildesign_requested_at: '2026-10-20T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
  },
];

/** 가짜 Supabase — 부른 거르기를 적어 두고 opts 표 값을 준다 */
function fakeClient(opts, calls) {
  return {
    auth: { getSession: async () => ({ data: { session: SESSION } }) },
    rpc: async (name) => ({ data: name === 'is_admin', error: null }),
    from: (table) => {
      const q = { table, ops: [] };
      calls.from.push(q);
      const chain = {
        select: (s) => (q.ops.push(['select', s]), chain),
        order: (c, o) => (q.ops.push(['order', c, o && o.ascending]), chain),
        limit: (n) => (q.ops.push(['limit', n]), chain),
        or: (f) => (q.ops.push(['or', f]), chain),
        in: (c, v) => (q.ops.push(['in', c, v]), chain),
        then: (resolve, reject) => Promise.resolve(opts.tables(table, q)).then(resolve, reject),
      };
      return chain;
    },
  };
}

async function load(options = {}) {
  const opts = {
    hash: '#members',
    tables: (table) => {
      if (table === 'profiles') return { data: PROFILES, error: null };
      if (table === 'subscriptions')
        return {
          data: [
            { user_id: U1, plan: 'expert', status: 'cancelled', ended_at: null, amount_krw: 49000 },
          ],
          error: null,
        };
      if (table === 'user_credits')
        return {
          data: [{ user_id: U1, balance: 1200, period_end: '2026-11-30T14:59:59Z' }],
          error: null,
        };
      return { data: [], error: null };
    },
    ...options,
  };
  window.history.replaceState(null, '', '/segan/admin.html' + opts.hash);
  const doc = new DOMParser().parseFromString(read('segan/admin.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'SeganShell',
    'SeganAdmin',
    'SeganAdminApplications',
    'SeganAdminConsults',
    'SeganAdminReports',
    'SeganAdminMembers',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    accountApi: { url: ACC },
  };
  const calls = { from: [], fetch: [] };
  window.supabase = { createClient: () => fakeClient(opts, calls) };
  window.fetch = jest.fn(async (url) => {
    calls.fetch.push(url);
    const body = url.startsWith(ACC)
      ? { success: true, data: [] }
      : url.includes('consult-inbox')
        ? { success: true, data: { items: [] } }
        : { success: true, data: { pendingProposals: 0 } };
    return { ok: true, status: 200, json: async () => body };
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of [
    'segan/shell.js',
    'segan/admin-applications.js',
    'segan/admin-consults.js',
    'segan/admin-reports.js',
    'segan/admin-members.js',
    'segan/admin.js',
  ])
    (0, eval)(read(f));
  await window.SeganShell.ready;
  await window.SeganAdmin.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const member = (id) => document.querySelector(`[data-member="${id}"]`);
const facts = (id) =>
  [...member(id).querySelectorAll('.me-facts div')].map((d) => [
    d.querySelector('dt').textContent,
    d.querySelector('dd').textContent,
  ]);
const profileCalls = (calls) => calls.from.filter((q) => q.table === 'profiles');
const searchFor = async (q) => {
  $('adMembersBody').querySelector('input[name="q"]').value = q;
  $('adMembersBody')
    .querySelector('form[data-form="search"]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('들어오기', () => {
  test('관리 첫 화면 「찾기」 줄 = #members, 열면 첫 화면을 감춘다', async () => {
    await load({ hash: '' });
    expect($('adGo').hidden).toBe(false);
    expect($('adGo').querySelector('a').getAttribute('href')).toBe('#members');
    await load();
    expect($('adMembers').hidden).toBe(false);
    expect($('adGo').hidden).toBe(true);
    expect($('adToday').hidden).toBe(true);
  });
});

describe('목록', () => {
  test('최근 가입 20명 — 이름 · 이메일 · 등급(결제) · 구독 · 크레딧 · 상세설계 · 지역 · 가입', async () => {
    const calls = await load();
    expect(profileCalls(calls)[0].ops).toEqual([
      ['select', '*'],
      ['order', 'created_at', false],
      ['limit', 20],
    ]);
    const billing = calls.from.filter((q) => q.table !== 'profiles' && q.table !== 'companies');
    expect(billing.map((q) => [q.table, q.ops.find((o) => o[0] === 'in')])).toEqual([
      ['subscriptions', ['in', 'user_id', [U1, U2]]],
      ['user_credits', ['in', 'user_id', [U1, U2]]],
    ]);
    expect(member(U1).querySelector('b').textContent).toBe('김고객');
    expect(member(U1).querySelector('small').textContent).toBe('kim@example.test');
    expect(member(U1).querySelector('.ad-status').textContent).toBe('Expert · 결제');
    expect(facts(U1)).toEqual([
      ['구독', '해지 예약 · expert · 49,000원'],
      ['크레딧', '1,200 (~ 2026.11.30)'],
      ['상세설계', '승인됨'],
      ['지역', '대구광역시 북구'],
      ['가입', 'Google · 2026.11.01'],
    ]);
    expect(member(U2).querySelector('b').textContent).toBe('이름 없음');
    expect(member(U2).querySelector('.ad-status').textContent).toBe('Standard');
    expect(facts(U2)).toEqual([
      ['구독', '-'],
      ['크레딧', '미사용'],
      ['상세설계', '검토중'],
      ['지역', '-'],
      ['가입', 'Email · 2026.10.01'],
    ]);
    expect(document.querySelector('#adMembers .ad-more a').getAttribute('href')).toBe(
      '../admin/users.html'
    );
  });

  test('찾기 — 이름 · 이메일 or ilike, 위험 글자는 빈칸으로', async () => {
    const calls = await load();
    await searchFor(' kim,(x)* ');
    const last = profileCalls(calls).pop();
    expect(last.ops).toContainEqual(['or', 'email.ilike.*kim  x*,name.ilike.*kim  x*']);
    expect($('adMembersBody').querySelector('.sg-note').textContent).toBe(
      '「kim  x」 찾은 회원 (최근 가입 순 20명까지)'
    );
    expect(window.SeganAdminMembers.cleanQuery('a%b"c\'d\\e')).toBe('a b c d e');
  });

  test('회원을 못 읽으면 안내, 구독 · 크레딧만 못 읽으면 그 칸만 「-」', async () => {
    await load({ tables: () => ({ data: null, error: { message: 'x' } }) });
    expect($('adMembersBody').textContent).toContain('회원을 불러오지 못했습니다.');
    await load({
      tables: (t) =>
        t === 'profiles'
          ? { data: PROFILES, error: null }
          : { data: null, error: { message: 'x' } },
    });
    expect(facts(U1).slice(0, 2)).toEqual([
      ['구독', '-'],
      ['크레딧', '-'],
    ]);
    await load({
      tables: (t) => (t === 'profiles' ? { data: [], error: null } : { data: [], error: null }),
    });
    expect($('adMembersBody').textContent).toContain('맞는 회원이 없습니다.');
  });

  test('이름 = PC admin/users.html (구독 상태 · 가입 방법 · 20명)', async () => {
    await load();
    const pc = read('admin/users.html');
    const A = window.SeganAdminMembers;
    expect(pc).toContain(
      "const SUB_KO = { active: '이용 중', cancelled: '해지 예약', past_due: '결제 실패', expired: '종료' };"
    );
    expect(A.SUB_KO).toEqual({
      active: '이용 중',
      cancelled: '해지 예약',
      past_due: '결제 실패',
      expired: '종료',
    });
    for (const [k, v] of Object.entries(A.PROVIDER_LABEL)) expect(pc).toContain(`${k}: '${v}'`);
    expect(pc).toMatch(/pageSize = 20\b/);
    expect(A.subKey({ status: 'cancelled', ended_at: '2026-10-01' })).toBe('expired');
    expect(A.subKey({ status: 'active' })).toBe('active');
  });
});
