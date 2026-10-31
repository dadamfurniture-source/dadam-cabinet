/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest */
/**
 * SEGAN 「관리」 탭 (segan/admin.html + segan/admin.js)
 *
 *   누가     관리자 — segan/shell.js 가 AdminAccess.isAdmin 으로 가린다 (SeganShell.ready 의 admin)
 *            로그인 전 → 셸의 로그인 안내, 관리자 아님 → 「관리자만 볼 수 있습니다」 (서버를 묻지 않는다)
 *   오늘 할 일 새 업체 신청 (account-api) · 배정을 기다리는 상담 · 업체 답을 기다리는 배정 (consult-inbox) ·
 *            결정할 생산 제안 (reports/summary). 못 읽은 줄은 「불러오지 못함」, 상한 200 이면 「200+건」
 *   PC에서 열기 PC 에 남기는 관리자 화면 10개 — 이름 · 주소는 js/admin-shell.js ADMIN_NAV 와 같다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SESSION = { access_token: 'tok-1', user: { id: 'admin-1', email: 'admin@example.com' } };
const WORK = 'https://work.example.workers.dev';
const ACC = 'https://acc.example.workers.dev';

const ok = (data) => ({ ok: true, status: 200, body: { success: true, data } });
const fail = (status) => ({ ok: false, status, body: { success: false, message: 'x' } });
const many = (n) => Array.from({ length: n }, (_, i) => ({ id: 'x' + i }));

/** admin.html 을 올린다. opts.replies[경로] → 응답 (Error 면 끊김) */
async function load(options = {}) {
  const opts = {
    session: SESSION,
    isAdmin: true,
    replies: {
      [ACC + '/admin/partner/applications?status=applied,meeting']: ok(many(3)),
      [WORK + '/admin/consult-inbox?state=pending']: ok({ items: many(2) }),
      [WORK + '/admin/consult-inbox?state=assigned']: ok({ items: many(200) }),
      [WORK + '/reports/summary']: ok({ pendingProposals: 0, scope: 'all' }),
    },
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/admin.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'SeganShell', 'SeganAdmin']) delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: WORK },
    accountApi: { url: ACC },
  };
  const calls = { fetch: [], rpc: [] };
  window.supabase = {
    createClient: () => ({
      auth: { getSession: async () => ({ data: { session: opts.session } }) },
      rpc: async (name) => {
        calls.rpc.push(name);
        return { data: name === 'is_admin' ? opts.isAdmin : null, error: null };
      },
    }),
  };
  window.fetch = jest.fn(async (url, init = {}) => {
    calls.fetch.push({ url, auth: (init.headers || {}).Authorization });
    const r = opts.replies[url];
    if (r instanceof Error) throw r;
    const reply = r || fail(404);
    return { ok: reply.ok, status: reply.status, json: async () => reply.body };
  });
  for (const src of [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'))) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  (0, eval)(read('segan/shell.js'));
  (0, eval)(read('segan/admin.js'));
  await window.SeganShell.ready;
  await window.SeganAdmin.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const today = () =>
  [...$('adTodayRows').querySelectorAll('li')].map((li) => [
    li.getAttribute('data-today'),
    li.querySelector('a').firstChild.textContent,
    li.querySelector('.ad-count').textContent,
    li.querySelector('.ad-count').classList.contains('is-on'),
    li.querySelector('a').getAttribute('href'),
  ]);

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('누가 보나', () => {
  test('로그인 전 — 셸의 로그인 안내, 서버를 묻지 않는다', async () => {
    const calls = await load({ session: null });
    expect(document.querySelector('[data-auth-view="signed-out"]').hidden).toBe(false);
    expect(document.querySelector('[data-auth-view="signed-out"]').textContent).toContain(
      '관리는 로그인한 뒤에 볼 수 있습니다.'
    );
    expect(calls.fetch).toHaveLength(0);
  });

  test('관리자가 아니면 「관리자만 볼 수 있습니다」, 수를 묻지 않는다 · 탭도 감춘다', async () => {
    const calls = await load({ isAdmin: false });
    expect($('adDenied').hidden).toBe(false);
    expect($('adToday').hidden).toBe(true);
    expect($('adPc').hidden).toBe(true);
    expect(calls.fetch).toHaveLength(0);
    expect(document.querySelector('nav.sg-tabbar a[data-tab-link="admin"]').hidden).toBe(true);
  });
});

describe('오늘 할 일', () => {
  test('관리자 — 수 넷을 본인 토큰으로 묻고, 상한이면 200+, 할 일이 있으면 진하게, 줄은 PC 화면으로', async () => {
    const calls = await load();
    expect($('adDenied').hidden).toBe(true);
    expect($('adToday').hidden).toBe(false);
    const tab = document.querySelector('nav.sg-tabbar a[data-tab-link="admin"]');
    expect(tab.hidden).toBe(false);
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(today()).toEqual([
      ['applications', '새 업체 신청', '3건', true, '#applications'],
      ['pending', '배정을 기다리는 상담', '2건', true, '../admin/consult-distribution.html'],
      ['assigned', '업체 답을 기다리는 배정', '200+건', true, '../admin/consult-distribution.html'],
      ['proposals', '결정할 생산 제안', '0건', false, '../admin/work-reports.html'],
    ]);
    expect(calls.fetch.map((f) => f.auth)).toEqual(Array(4).fill('Bearer tok-1'));
  });

  test('못 읽은 줄은 「불러오지 못함」 (0 으로 채우지 않는다), 다른 줄은 그대로', async () => {
    await load({
      replies: {
        [ACC + '/admin/partner/applications?status=applied,meeting']: fail(403),
        [WORK + '/admin/consult-inbox?state=pending']: new Error('offline'),
        [WORK + '/admin/consult-inbox?state=assigned']: ok({ items: [] }),
        [WORK + '/reports/summary']: ok({ pendingProposals: 'x' }),
      },
    });
    expect(today().map((r) => r[2])).toEqual([
      '불러오지 못함',
      '불러오지 못함',
      '0건',
      '불러오지 못함',
    ]);
  });

  test('본문 읽기 — 모양이 틀리면 null', async () => {
    await load();
    const A = window.SeganAdmin;
    expect(A.applicationsOf({ success: true, data: many(2) })).toBe(2);
    expect(A.applicationsOf({ success: true, data: { items: [] } })).toBeNull();
    expect(A.applicationsOf({ success: false, data: [] })).toBeNull();
    expect(A.inboxOf({ success: true, data: { items: many(5) } })).toBe(5);
    expect(A.inboxOf({ success: true, data: [] })).toBeNull();
    expect(A.proposalsOf({ success: true, data: { pendingProposals: 4 } })).toBe(4);
    expect(A.proposalsOf({ success: true, data: { pendingProposals: -1 } })).toBeNull();
    expect(A.countText(null)).toBe('불러오지 못함');
    expect(A.countText(7, 200)).toBe('7건');
    expect(A.countText(250, 200)).toBe('200+건');
    // 상한은 워커 consult-inbox 와 같다
    expect(read('workers/workflow-api/src/distribution/admin.js')).toContain(
      `export const INBOX_LIMIT = ${A.INBOX_LIMIT};`
    );
  });
});

describe('PC에서 열기', () => {
  test('PC 에 남기는 화면 10개 — 이름 · 주소는 js/admin-shell.js ADMIN_NAV 와 같고 파일이 있다', async () => {
    await load();
    expect($('adPc').hidden).toBe(false);
    const rows = [...$('adPcRows').querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
    ]);
    expect(rows).toHaveLength(10);
    const nav = read('js/admin-shell.js');
    for (const [label, href] of rows) {
      const file = href.replace('../admin/', '');
      expect(nav).toContain(`href: '${file}', icon:`);
      expect(nav).toMatch(new RegExp(`href: '${file.replace('.', '\\.')}'[^}]*label: '${label}'`));
      expect(fs.existsSync(path.join(ROOT, 'admin', file))).toBe(true);
    }
    // 앱으로 옮기는 넷(업체 신청 · 상담 · 작업 보고 · 회원)은 PC 목록에 두지 않는다
    for (const moved of [
      'expert-requests',
      'consultations',
      'consult-distribution',
      'work-reports',
      'users',
    ])
      expect(rows.some(([, href]) => href.includes(moved))).toBe(false);
  });
});
