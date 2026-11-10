/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, document, window, DOMParser, sessionStorage, jest, console, URL, setTimeout, afterEach */
/**
 * SEGAN 앱 셸 (segan/shell.js + segan/*.html) — jsdom 에 페이지를 올려 확인한다.
 *
 *   - 메뉴: PC 위 메뉴 여섯(AI 연출컷 · 시공사례 · 매거진 · AI 시스템 소개 · 구독 + 오른쪽 끝 마이페이지),
 *     폰 아래 탭 다섯(연출컷 · 시공사례 · 매거진 · SEGAN · 마이) — 순서 · 주소 · 글, 화면마다 켜지는 탭 하나
 *     (SEGAN 은 소개 · 구독 둘 다, 마이는 마이페이지 안 화면들). 내 연출컷 · 비서 · 관리 · 작업은 막대에 없다
 *   - 마이페이지 · 내 연출컷은 로그인이 없으면 「로그인이 필요합니다」 + login.html?redirect=(이 페이지)
 *   - 마이페이지의 역할 판정(SeganShell.ready 의 roles)은 기존 판정(AdminAccess · DadamMyPageWork · 워크플로 API
 *     GET /planner/access · assistant-api GET /assistant/me)을 따른다 — 설계 · 비서 · 작업 · 관리 · 관리자 화면 (PC).
 *     링크(ROLE_LINKS)는 마이페이지 메뉴 묶음에 segan/me.js 가 그린다 (__tests__/segan-me.test.js)
 *     — 페이지가 싣는 실제 js/ 파일을 그대로 올리고 Supabase · /work/me · /planner/access · /assistant/me 만 가짜로 둔다
 *   - 설계(간편 플래너)는 PC 브라우저(pointer fine · 1100px~ · 설치한 앱 아님)에서만 새 탭 — SeganShell.desktopTab
 *   - 사업자 정보는 사이트 푸터(js/site-shell.js)와 같다
 *   - PC 위 메뉴는 1024px 부터 (768px 폭에는 여섯 칸이 빠듯하다), 그 아래는 아래 탭
 *   - 시트 · 옆 패널 · 가운데 창 (SeganShell.sheet) — 열기 · 닫기 · Esc · 바깥 · 뒤로 가기(페이지 처리기는 모른다)
 *     · 옆 패널 하나만 · 초점 돌려주기 · dialog
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');

/** PC 위 메뉴 — [탭, 글, 주소] (오른쪽 끝 마이페이지) */
const PC_TABS = [
  ['make', 'AI 연출컷', './'],
  ['collection', '시공사례', 'collection.html'],
  ['blog', '매거진', 'blog.html'],
  ['about', 'AI 시스템 소개', 'about.html'],
  ['plans', '구독', 'plans.html'],
  ['me', '마이페이지', 'me.html'],
];
/** 폰 아래 탭 — 다섯 */
const PHONE_TABS = [
  ['make', '연출컷', './'],
  ['collection', '시공사례', 'collection.html'],
  ['blog', '매거진', 'blog.html'],
  ['about', 'SEGAN', 'about.html'],
  ['me', '마이', 'me.html'],
];
/** 탭 화면 (위 메뉴 · 아래 탭의 주소) */
const TAB_PAGES = [
  'index.html',
  'collection.html',
  'blog.html',
  'about.html',
  'plans.html',
  'me.html',
];
/** 화면 → [PC 위 메뉴에서 켜지는 탭, 폰 아래 탭에서 켜지는 탭] — 셸 막대가 있는 segan 화면 전부 */
const CURRENT = {
  'index.html': ['make', 'make'],
  'consult.html': ['make', 'make'],
  'collection.html': ['collection', 'collection'],
  'blog.html': ['blog', 'blog'],
  // 매거진 글 — 매거진 탭
  'blog-materials.html': ['blog', 'blog'],
  'blog-edge-finish.html': ['blog', 'blog'],
  'blog-hardware.html': ['blog', 'blog'],
  'blog-kitchen-appliances.html': ['blog', 'blog'],
  'about.html': ['about', 'about'],
  'plans.html': ['plans', 'about'],
  'me.html': ['me', 'me'],
  'renders.html': ['me', 'me'],
  'assistant.html': ['me', 'me'],
  'admin.html': ['me', 'me'],
  'work.html': ['me', 'me'],
  'billing.html': ['me', 'me'],
  'settings.html': ['me', 'me'],
  'activity.html': ['me', 'me'],
  'pay.html': ['me', 'me'],
  'join.html': ['me', 'me'],
  'ledger.html': ['me', 'me'],
  'ledger-board.html': ['me', 'me'],
  'ledger-report.html': ['me', 'me'],
};
/** 막대에서 뺀 탭 — 화면은 남는다 (마이페이지에서 간다) */
const GONE = ['renders', 'assistant', 'admin', 'work'];
const PUBLIC = ['index.html', 'collection.html', 'consult.html', 'about.html', 'plans.html'];
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'customer@example.com' } };
const ASSISTANT_ME = 'https://dadam-assistant-api.dadamfurniture.workers.dev/assistant/me';
const FULL = { company_id: 'c1', role: 'owner', money: true, level: 'full', can_chat: true };
const WORKER = { ready: true, worker: { id: 'w1', status: 'approved', display_name: '작업자' } };

function fakeClient(opts, calls) {
  return {
    auth: {
      getSession: async () => ({ data: { session: opts.session } }),
      signOut: async () => {
        calls.signOut++;
      },
    },
    rpc: async (name) => {
      calls.rpc.push(name);
      return name === 'is_admin'
        ? { data: opts.isAdmin, error: null }
        : { data: null, error: { message: 'x' } };
    },
    from: (table) => {
      calls.from.push(table);
      const result =
        table === 'profiles' ? { data: opts.profile, error: null } : { data: null, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
      };
      return chain;
    },
  };
}

/**
 * segan 페이지를 올린다 — 페이지가 싣는 ../js/ 모듈을 HTML 순서대로 실제로 실행하고 shell.js 를 돌린다.
 * opts: session · isAdmin · profile · workMe(/work/me data) · workFail · noSupabase
 *       planner(/planner/access data — 없으면 403 not_planner_company, 'fail' 이면 끊김)
 *       assistant(/assistant/me data — 없으면 403 not_member, 'fail' 이면 끊김) · keepStorage
 */
async function load(page, options = {}) {
  const opts = {
    session: null,
    isAdmin: false,
    profile: { tier: null, detaildesign_approved: false, detaildesign_requested_at: null },
    workMe: { ready: true, worker: null },
    workFail: false,
    noSupabase: false,
    assistant: null,
    planner: null,
    keepStorage: false,
    ...options,
  };
  const html = read(`segan/${page}`);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);

  if (!opts.keepStorage) sessionStorage.clear();
  for (const k of [
    'AdminAccess',
    'DetailDesignAccess',
    'DadamMyPageWork',
    'SeganShell',
    'DadamShell',
  ])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    workflowApi: { url: 'https://work.example.workers.dev' },
  };
  const calls = { rpc: [], from: [], fetch: [], signOut: 0 };
  window.supabase = opts.noSupabase ? undefined : { createClient: () => fakeClient(opts, calls) };
  window.fetch = jest.fn(async (url, init) => {
    calls.fetch.push({ url, auth: init && init.headers && init.headers.Authorization });
    if (opts.workFail) throw new TypeError('Failed to fetch');
    if (String(url).endsWith('/assistant/me')) {
      if (opts.assistant === 'fail') throw new TypeError('Failed to fetch');
      return opts.assistant
        ? { ok: true, status: 200, json: async () => ({ success: true, data: opts.assistant }) }
        : { ok: false, status: 403, json: async () => ({ success: false, code: 'not_member' }) };
    }
    if (String(url).endsWith('/planner/access')) {
      if (opts.planner === 'fail') throw new TypeError('Failed to fetch');
      return opts.planner
        ? { ok: true, status: 200, json: async () => ({ success: true, data: opts.planner }) }
        : {
            ok: false,
            status: 403,
            json: async () => ({ success: false, code: 'not_planner_company' }),
          };
    }
    return { ok: true, json: async () => ({ success: true, data: opts.workMe }) };
  });

  const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  for (const src of scripts) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue; // 설정은 위에서 가짜로
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  (0, eval)(read('segan/shell.js'));
  const result = await window.SeganShell.ready;
  return { calls, result, scripts };
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const visible = (el) => {
  for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
  return true;
};
const view = (name) => $(`[data-auth-view="${name}"]`);
const BARS = [
  ['.sg-header nav.sg-nav', PC_TABS, 0],
  ['nav.sg-tabbar', PHONE_TABS, 1],
];

describe('메뉴 — PC 위 메뉴 여섯 · 폰 아래 탭 다섯', () => {
  test('셸 막대가 있는 segan 화면은 모두 켤 탭이 정해져 있다 (새 화면은 여기에 적는다)', () => {
    const pages = fs
      .readdirSync(path.join(ROOT, 'segan'))
      .filter(
        (n) => n.endsWith('.html') && read(`segan/${n}`).includes('data-segan-shell="tabbar"')
      );
    expect(pages.sort()).toEqual(Object.keys(CURRENT).sort());
  });

  test.each(Object.entries(CURRENT))(
    '%s — 위 메뉴 · 아래 탭의 순서 · 글 · 주소, 켜진 탭은 하나 (%s)',
    async (page, on) => {
      await load(page);
      for (const [sel, tabs, i] of BARS) {
        const nav = $(sel);
        expect(nav).not.toBeNull();
        expect(nav.getAttribute('aria-label')).toBe('주 메뉴');
        const all = [...nav.querySelectorAll('a')];
        expect(
          all.map((a) => [
            a.getAttribute('data-tab-link'),
            a.textContent.trim(),
            a.getAttribute('href'),
          ])
        ).toEqual(tabs);
        expect(all.every((a) => !a.hidden && visible(a))).toBe(true); // 로그인 전에도 보인다 · 감춘 탭 없음
        const current = all.filter((a) => a.getAttribute('aria-current') === 'page');
        expect(current.map((a) => a.getAttribute('data-tab-link'))).toEqual([on[i]]);
      }
      expect($('main#main')).not.toBeNull();
      expect($$('[data-segan-shell]')).toHaveLength(0); // 자리표시가 모두 채워졌다
    }
  );

  test.each(TAB_PAGES)('%s — h1 이 하나 보인다', async (page) => {
    await load(page);
    expect($$('h1').filter(visible)).toHaveLength(1); // 만들기는 단계마다 제목이 있고 지금 단계만 보인다
  });

  test('PC 위 메뉴는 마이페이지만 오른쪽 끝 (sg-nav-end) · 폰 탭에는 구독이 없다 (SEGAN 안 [소개 | 구독])', async () => {
    await load('index.html');
    expect($$('.sg-nav a.sg-nav-end').map((a) => a.getAttribute('data-tab-link'))).toEqual(['me']);
    expect($$('.sg-tabbar a.sg-nav-end')).toHaveLength(0);
    expect($('.sg-tabbar a[data-tab-link="plans"]')).toBeNull();
    expect($$('.sg-tabbar a')).toHaveLength(5);
  });

  test('탭 하나가 여러 화면에서 켜진다 — SeganShell.currentTab (같은 이름의 탭이 먼저)', async () => {
    await load('index.html');
    const { currentTab } = window.SeganShell;
    expect(currentTab('about', 'phone')).toBe('about');
    expect(currentTab('plans', 'phone')).toBe('about'); // SEGAN = 소개 · 구독
    expect(currentTab('plans', 'pc')).toBe('plans'); // PC 는 「구독」
    expect(currentTab('about', 'pc')).toBe('about');
    for (const page of ['me', 'renders', 'assistant', 'admin', 'work'])
      for (const bar of ['pc', 'phone'])
        expect([page, bar, currentTab(page, bar)]).toEqual([page, bar, 'me']);
    expect(currentTab('make', 'phone')).toBe('make');
    expect(currentTab('nothing', 'pc')).toBe('');
  });

  test('막대에서 뺀 탭(내 연출컷 · 비서 · 관리 · 작업) — 관리자 · 작업자 · 비서 자격이 있어도 막대에 없다, 화면은 남는다', async () => {
    const r = await load('me.html', {
      session: SESSION,
      isAdmin: true,
      workMe: WORKER,
      assistant: FULL,
      planner: {
        company: { id: 'hq', name: '다담 공장', kind: 'hq', plan: null },
        role: 'admin',
        can_manage: true,
      },
    });
    for (const key of GONE) expect($$(`[data-tab-link="${key}"]`)).toEqual([]);
    expect([r.result.admin, r.result.worker, r.result.assistant]).toEqual([true, true, true]);
    const sw = read('segan/sw.js');
    for (const page of ['renders.html', 'assistant.html', 'admin.html', 'work.html']) {
      expect(fs.existsSync(path.join(ROOT, 'segan', page))).toBe(true);
      expect(sw).toContain(`SCOPE + '${page}'`);
    }
    for (const asset of ['renders.js', 'assistant.js', 'admin.js', 'work.css'])
      expect(sw).toContain(`versioned(SCOPE + '${asset}')`);
  });

  test('탭 주소는 segan/ 안의 실제 페이지다 (AI 연출컷 = start_url /segan/)', () => {
    for (const [, , href] of [...PC_TABS, ...PHONE_TABS]) {
      const file = href === './' ? 'index.html' : href;
      expect([href, fs.existsSync(path.join(ROOT, 'segan', file))]).toEqual([href, true]);
    }
    const manifest = JSON.parse(read('segan/manifest.webmanifest'));
    expect(new URL(PC_TABS[0][2], 'https://x/segan/').pathname).toBe(manifest.start_url);
  });

  test('아래 탭 아이콘은 꾸밈 (aria-hidden), 이름은 글자로 · 위 메뉴는 글만', async () => {
    await load('index.html');
    expect($$('.sg-tabbar svg')).toHaveLength(5);
    for (const svg of $$('.sg-tabbar svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect($$('.sg-tabbar a span').map((s) => s.textContent)).toEqual(PHONE_TABS.map((t) => t[1]));
    expect($$('.sg-nav svg')).toHaveLength(0);
  });

  test('관리자 판정(관리 화면 admin.js 가 쓰는 ready.admin) — 로그인 칸이 있는 화면만 is_admin 을 묻고, 작업 · 비서는 묻지 않는다', async () => {
    const admin = await load('admin.html', { session: SESSION, isAdmin: true });
    expect(admin.result.admin).toBe(true);
    expect(admin.calls.rpc).toEqual(['is_admin']);
    expect(admin.calls.fetch).toEqual([]); // /work/me · /assistant/me 는 마이페이지에서만
    const member = await load('admin.html', { session: SESSION, isAdmin: false });
    expect(member.result.admin).toBe(false);
    const open = await load('index.html', { session: SESSION, isAdmin: true });
    expect(open.result.admin).toBe(false); // 로그인 칸 없는 화면 — 묻지 않는다
    expect(open.calls.rpc).toEqual([]);
    expect(open.calls.fetch).toEqual([]);
    const guest = await load('renders.html', { session: null, isAdmin: true });
    expect(guest.calls.rpc).toEqual([]);
    expect(guest.result.admin).toBe(false);
  });

  test('아래 탭은 칸 수를 정하지 않고 보이는 탭만큼 같은 폭', () => {
    const css = read('segan/shell.css');
    const m = css.match(/^\.sg-tabbar \{([^}]*)\}/m);
    expect(m).not.toBeNull();
    const rule = m[1];
    expect(rule).toContain('grid-auto-flow: column');
    expect(rule).not.toContain('grid-template-columns');
  });
});

describe('로그인 안내 — 마이페이지 · 내 연출컷 · 비서 · 관리', () => {
  test.each([
    ['renders.html', 'segan/renders.html', '내 연출컷은'],
    ['me.html', 'segan/me.html', '마이페이지는'],
    ['assistant.html', 'segan/assistant.html', '비서는'],
    ['admin.html', 'segan/admin.html', '관리는'],
  ])(
    '%s — 로그인 없으면 안내 + 로그인 버튼(돌아올 곳 = 이 페이지)',
    async (page, target, phrase) => {
      const { calls } = await load(page, { session: null });
      expect(visible(view('signed-out'))).toBe(true);
      expect(view('signed-in').hidden).toBe(true);
      expect(view('checking').hidden).toBe(true);
      const gate = view('signed-out');
      expect(gate.textContent).toContain('로그인이 필요합니다');
      expect(gate.textContent).toContain(phrase);
      const btn = gate.querySelector('a.sg-btn');
      expect(btn.textContent).toBe('로그인');
      const href = btn.getAttribute('href');
      expect(href).toBe(`../login.html?redirect=${encodeURIComponent(target)}`);
      // 기존 login.html 이 받아 주는 주소인가 (js/auth-redirect.js — 같은 사이트 *.html 만)
      const url = new URL(href, `https://dadamfurniture.com/${target}`);
      expect(url.pathname).toBe('/login.html');
      expect(AuthRedirect.fromSearch(url.search)).toBe(target);
      expect(
        new URL(AuthRedirect.fromSearch(url.search), 'https://dadamfurniture.com/login.html')
          .pathname
      ).toBe(`/${target}`);
      // 로그인 전에는 역할을 묻지 않는다
      expect(calls.rpc).toEqual([]);
      expect(calls.fetch).toEqual([]);
    }
  );

  test('Supabase 라이브러리를 못 받으면 로그인 안 된 것으로 보인다', async () => {
    await load('renders.html', { noSupabase: true });
    expect(visible(view('signed-out'))).toBe(true);
    expect(view('signed-in').hidden).toBe(true);
  });

  test('로그인했으면 안내 대신 내용 (마이페이지는 계정 이메일 · 「내 것」 묶음 맨 위에 내 연출컷)', async () => {
    await load('renders.html', { session: SESSION });
    expect(view('signed-out').hidden).toBe(true);
    expect(visible(view('signed-in'))).toBe(true);

    await load('me.html', { session: SESSION });
    expect(view('signed-out').hidden).toBe(true);
    expect(visible(view('signed-in'))).toBe(true);
    expect($('h1').textContent).toBe('마이페이지');
    expect($('#sgAccountEmail').textContent).toBe('customer@example.com');
    for (const label of ['상담 내역', '크레딧 · 구독', '설정', '로그아웃']) {
      expect(view('signed-in').textContent).toContain(label);
    }
    // 내 연출컷 — 「내 것」 묶음의 첫 줄 (예전 아래 탭)
    const renders = $('#meRenders');
    expect(renders.textContent).toBe('내 연출컷');
    expect(renders.getAttribute('href')).toBe('renders.html');
    expect(visible(renders)).toBe(true);
    expect($('#meGroupMine li a').id).toBe('meRenders');
  });

  test('로그인 칸이 없는 화면 (AI 연출컷 · 시공사례 · 매거진 · 소개 · 구독) 은 로그인과 상관없이 열린다', async () => {
    for (const page of ['index.html', 'collection.html', 'blog.html', 'about.html', 'plans.html']) {
      await load(page, { noSupabase: true });
      expect([page, $$('[data-auth-view]').length]).toEqual([page, 0]);
      expect($('.sg-gate')).toBeNull();
    }
  });

  test('로그아웃 — supabase signOut 을 부른다', async () => {
    const { calls } = await load('me.html', { session: SESSION });
    // 뒤이은 location.reload() 는 jsdom 에 없다 (콘솔 오류만 낸다)
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    $('#sgLogout').click();
    await new Promise((r) => setTimeout(r, 0));
    quiet.mockRestore();
    expect(calls.signOut).toBe(1);
  });
});

describe('마이페이지 역할 판정 — 기존 판정 모듈을 따른다 (SeganShell.ready 의 roles)', () => {
  const KEYS = ['planner', 'assistant', 'worker', 'admin-app', 'admin'];
  /** 역할 링크마다 판정 — ROLE_LINKS 의 role(없으면 key) 로 roles 를 읽는다 (segan/me.js 가 그 줄을 연다) */
  const roleShown = (result) =>
    Object.fromEntries(
      window.SeganShell.ROLE_LINKS.map((r) => [r.key, result.roles[r.role || r.key] === true])
    );
  const none = Object.fromEntries(KEYS.map((k) => [k, false]));

  test('me.html 이 판정 모듈을 싣는다 (admin-access · mypage-work) — 상세설계 판정 모듈은 싣지 않는다', async () => {
    const { scripts } = await load('me.html');
    const bare = scripts.map((s) => s.split('?')[0]);
    for (const f of ['../js/config.js', '../js/admin-access.js', '../js/mypage-work.js']) {
      expect(bare).toContain(f);
    }
    expect(bare).not.toContain('../js/detaildesign-access.js');
    // 셸 · SEGAN 비서 다음에 마이페이지 스크립트 (메뉴 · 상담 내역 · 크레딧 · 구독)
    expect(bare.slice(-4)).toEqual(['shell.js', 'guide.js', 'make.js', 'me.js']);
  });

  test('링크 — 설계(간편 플래너) · 비서 · 작업 · 관리(앱) · 관리자 화면 (PC), 마이페이지 메뉴 묶음', async () => {
    await load('me.html', { session: SESSION });
    const links = window.SeganShell.ROLE_LINKS.map((r) => [r.key, r.label, r.href, r.group]);
    expect(links).toEqual([
      ['planner', '설계', 'planner/', 'company'],
      ['assistant', '비서', 'assistant.html', 'company'],
      ['worker', '작업', 'work.html', 'work'],
      ['admin-app', '관리', 'admin.html', 'hq'],
      ['admin', '관리자 화면 (PC)', '../admin/index.html', 'hq'],
    ]);
    // 새 탭은 설계만 (PC 브라우저에서)
    expect(window.SeganShell.ROLE_LINKS.filter((r) => r.desktopTab).map((r) => r.key)).toEqual([
      'planner',
    ]);
    // 설계는 /segan/planner/ — 이 저장소 밖 플래너 Worker 가 받는다 (서비스 워커도 건드리지 않는다)
    expect(read('segan/sw.js')).toMatch(/startsWith\(SCOPE \+ 'planner\/'\)/);
    for (const [, , href] of links.slice(1))
      expect(fs.existsSync(path.join(ROOT, 'segan', href))).toBe(true);
    // 따로 있던 「업무」 칸은 없다 — 링크는 메뉴 묶음(업체 · 본사 · 오늘 작업)에
    expect(read('segan/me.html')).not.toContain('data-segan-shell="roles"');
    expect($('#sgRoles')).toBeNull();
  });

  test('역할이 없는 회원 — 판정이 모두 거짓', async () => {
    const { result } = await load('me.html', {
      session: SESSION,
      profile: { tier: null, detaildesign_approved: false },
    });
    expect(roleShown(result)).toEqual(none);
    expect(result.roles.workMe).toBeNull();
  });

  test('설계 — GET /planner/access 가 200 이면 연다 (본인 토큰으로 워크플로 API 에 묻는다)', async () => {
    const { calls, result } = await load('me.html', {
      session: SESSION,
      planner: {
        company: { id: 'c1', name: '팩토리', kind: 'partner', plan: 'expert' },
        role: 'owner',
        can_manage: true,
      },
    });
    expect(roleShown(result)).toEqual({ ...none, planner: true });
    expect(calls.fetch).toContainEqual({
      url: 'https://work.example.workers.dev/planner/access',
      auth: 'Bearer tok-1',
    });
  });

  test.each([
    ['대상 업체 아님 (403)', {}],
    ['요청 실패', { planner: 'fail' }],
  ])('설계 감춤 — %s', async (_name, extra) => {
    const { result } = await load('me.html', { session: SESSION, ...extra });
    expect(roleShown(result).planner).toBe(false);
  });

  test('관리자 (is_admin RPC 참) — 관리(앱 화면) · 관리자 화면 (PC) 둘 다 (설계는 서버 판정 /planner/access 를 따른다)', async () => {
    const { calls, result } = await load('me.html', { session: SESSION, isAdmin: true });
    expect(calls.rpc).toContain('is_admin');
    expect(roleShown(result)).toEqual({ ...none, 'admin-app': true, admin: true });
    expect(result.admin).toBe(true);
  });

  test('관리자 아님 (is_admin 거짓) — 관리 · 관리자 화면은 감춘다', async () => {
    const { result } = await load('me.html', {
      session: SESSION,
      isAdmin: false,
      profile: { tier: 'agent', detaildesign_approved: false },
    });
    expect(roleShown(result)['admin-app']).toBe(false);
    expect(roleShown(result).admin).toBe(false);
  });

  test('작업자 (GET /work/me 에 작업자 행) — 작업 · 그 응답(오늘 작업 카드 요약), 본인 토큰으로 묻는다 (설계 · 작업 · 비서 판정 한 번씩)', async () => {
    const { calls, result } = await load('me.html', { session: SESSION, workMe: WORKER });
    expect(roleShown(result)).toEqual({ ...none, worker: true });
    expect(result.worker).toBe(true);
    expect(result.roles.workMe).toEqual(WORKER);
    expect(calls.fetch).toEqual([
      { url: 'https://work.example.workers.dev/planner/access', auth: 'Bearer tok-1' },
      { url: 'https://work.example.workers.dev/work/me', auth: 'Bearer tok-1' },
      { url: ASSISTANT_ME, auth: 'Bearer tok-1' },
    ]);
  });

  test.each([
    ['작업자 행 없음', { workMe: { ready: true, worker: null } }],
    ['표가 아직 없음', { workMe: { ready: false, worker: { id: 'w1' } } }],
    ['요청 실패', { workFail: true }],
  ])('작업 감춤 — %s', async (_name, extra) => {
    const { result } = await load('me.html', { session: SESSION, ...extra });
    expect(roleShown(result).worker).toBe(false);
    expect(result.roles.workMe).toBeNull();
  });

  test('비서 — 자격(level full · read)이 있으면 연다, none · 403 · 끊김이면 감춘다', async () => {
    const on = await load('me.html', { session: SESSION, assistant: FULL });
    expect(roleShown(on.result)).toEqual({ ...none, assistant: true });
    expect(on.result.assistant).toBe(true);
    expect(on.calls.fetch).toContainEqual({ url: ASSISTANT_ME, auth: 'Bearer tok-1' });
    const readOnly = await load('me.html', {
      session: SESSION,
      assistant: { ...FULL, level: 'read', can_chat: false },
    });
    expect(roleShown(readOnly.result).assistant).toBe(true);
    for (const assistant of [{ ...FULL, level: 'none', can_chat: false }, null, 'fail']) {
      const r = await load('me.html', { session: SESSION, assistant });
      expect(roleShown(r.result).assistant).toBe(false);
      expect(r.result.assistant).toBe(false);
    }
  });

  test('비서 — 참은 1분 기억한다 (마이페이지를 다시 열 때마다 묻지 않는다)', async () => {
    await load('me.html', { session: SESSION, assistant: FULL });
    const again = await load('me.html', { session: SESSION, keepStorage: true });
    expect(roleShown(again.result).assistant).toBe(true);
    expect(again.calls.fetch.map((f) => f.url)).not.toContain(ASSISTANT_ME);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    const later = await load('me.html', { session: SESSION, keepStorage: true });
    expect(roleShown(later.result).assistant).toBe(false);
    expect(later.calls.fetch.map((f) => f.url)).toContain(ASSISTANT_ME);
    jest.restoreAllMocks();
  });

  test('관리자이면서 작업자, 설계 · 비서 가능 — 다섯 다', async () => {
    const { result } = await load('me.html', {
      session: SESSION,
      isAdmin: true,
      workMe: { ready: true, worker: { id: 'w1', status: 'approved' } },
      assistant: FULL,
      planner: {
        company: { id: 'hq', name: '다담 공장', kind: 'hq', plan: null },
        role: 'admin',
        can_manage: true,
      },
    });
    expect(roleShown(result)).toEqual(Object.fromEntries(KEYS.map((k) => [k, true])));
  });
});

describe('새 탭 — 설계는 PC 브라우저에서만 (SeganShell.desktopTab)', () => {
  /** matchMedia 가짜 — 물음별 참거짓 */
  const media = (on) => (q) => ({
    matches: !!on[q],
    media: q,
    addEventListener() {},
    removeEventListener() {},
  });
  const PC = { '(pointer: fine)': true, '(min-width: 1100px)': true };
  afterEach(() => {
    delete window.matchMedia;
    delete window.navigator.standalone;
  });

  test.each([
    ['PC 브라우저 (마우스 · 1100px~)', PC, true],
    ['좁은 PC 창 (1100px 아래)', { '(pointer: fine)': true }, false],
    ['폰 · 태블릿 (손가락)', { '(min-width: 1100px)': true }, false],
    ['설치한 앱 (display-mode standalone)', { ...PC, '(display-mode: standalone)': true }, false],
  ])('%s → 새 탭 %s', async (_name, on, tab) => {
    await load('me.html');
    window.matchMedia = media(on);
    expect(window.SeganShell.desktopTab()).toBe(tab);
    const a = document.createElement('a');
    a.href = 'planner/';
    a.setAttribute('data-desktop-tab', '');
    a.setAttribute('target', '_blank');
    document.body.appendChild(a);
    window.SeganShell.applyLinkTarget(a);
    expect([a.getAttribute('target'), a.getAttribute('rel')]).toEqual(
      tab ? ['_blank', 'noopener'] : [null, null]
    );
  });

  test('matchMedia 가 없으면 · iOS 홈 화면 앱이면 같은 창', async () => {
    await load('me.html');
    expect(window.SeganShell.desktopTab()).toBe(false);
    window.matchMedia = media(PC);
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
    expect(window.SeganShell.desktopTab()).toBe(false);
  });

  test('누르는 순간 다시 정한다 — 창 폭을 바꾼 뒤에도 맞다', async () => {
    await load('me.html');
    const a = document.createElement('a');
    a.href = '#x';
    a.setAttribute('data-desktop-tab', '');
    a.innerHTML = '<span>설계</span>';
    document.body.appendChild(a);
    window.matchMedia = media(PC);
    a.querySelector('span').click();
    expect(a.getAttribute('target')).toBe('_blank');
    window.matchMedia = media({ '(pointer: fine)': true });
    a.click();
    expect(a.getAttribute('target')).toBeNull();
  });
});

describe('사업자 정보 — 사이트 푸터(js/site-shell.js)와 같다', () => {
  test('PC 푸터와 폰 마이페이지에 같은 사업자 정보가 있고, 사이트 푸터 글과 같다', async () => {
    await load('me.html');
    const biz = { ...window.SeganShell.BIZ };
    const footer = $('footer.sg-footer').textContent;
    const inMe = $('.sg-biz').textContent;
    for (const v of Object.values(biz)) {
      expect(footer).toContain(v);
      expect(inMe).toContain(v);
    }
    // 다른 탭에는 마이페이지 안 사업자 칸이 없다 (푸터만)
    await load('index.html');
    expect($('.sg-biz')).toBeNull();
    expect($('footer.sg-footer')).not.toBeNull();

    // 사이트 푸터를 실제로 그려 같은 값인지 본다
    document.body.innerHTML = '<div data-site-shell="footer"></div>';
    window.supabase = undefined;
    (0, eval)(read('js/site-shell.js'));
    const site = $('.v5-footer').textContent;
    for (const [k, v] of Object.entries(biz)) expect([k, site.includes(v)]).toEqual([k, true]);
  });
});

describe('숨김 · 접근성 · 안전 영역', () => {
  const PAGES = fs.readdirSync(path.join(ROOT, 'segan')).filter((n) => n.endsWith('.html'));

  test.each(PAGES)(
    '%s — 검색(공개 index · collection · consult · about · plans 만 연다) · 매니페스트 · 아이콘',
    (page) => {
      const html = read(`segan/${page}`);
      if (PUBLIC.includes(page)) expect(html).not.toMatch(/name="robots"/);
      else expect(html).toMatch(/<meta name="robots" content="noindex,nofollow" \/>/);
      expect(html).toMatch(/rel="manifest"/);
      expect(html).toMatch(/rel="apple-touch-icon"/);
    }
  );

  test.each(TAB_PAGES)('%s — 공용 셸(shell.css · shell.js)과 자리표시 4종', (page) => {
    const html = read(`segan/${page}`);
    expect(html).toMatch(/<link rel="stylesheet" href="shell\.css\?v=\d+" \/>/);
    expect(html).toMatch(/<script src="shell\.js\?v=\d+" defer><\/script>/);
    for (const slot of ['header', 'footer', 'tabbar'])
      expect(html).toContain(`data-segan-shell="${slot}"`);
    expect(html).toMatch(/<body class="sg-app" data-tab="\w+">/);
  });

  test('누르는 곳은 44px 이상 · 아래 탭은 안전 영역(env(safe-area-inset-bottom))을 띄운다', () => {
    const css = read('segan/shell.css');
    const vars = Object.fromEntries(
      [...css.matchAll(/(--sg-[\w-]+)\s*:\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])])
    );
    const rule = (sel) => {
      const m = css.match(
        new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
      );
      expect([sel, !!m]).toEqual([sel, true]);
      return m[1];
    };
    const minHeight = (sel) => {
      const v = rule(sel)
        .match(/min-height:\s*([^;]+);/)[1]
        .trim();
      const ref = v.match(/^var\((--sg-[\w-]+)\)$/);
      return ref ? vars[ref[1]] : Number(v.replace('px', ''));
    };
    for (const sel of ['.sg-tabbar a', '.sg-nav a', '.sg-brand', '.sg-row', '.sg-btn']) {
      expect([sel, minHeight(sel) >= 44]).toEqual([sel, true]);
    }
    expect(rule('.sg-tabbar')).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(rule('.sg-tabbar')).toMatch(/position:\s*fixed/);
    expect(rule('.sg-app')).toMatch(/env\(safe-area-inset-bottom\)/); // 본문이 탭 뒤로 숨지 않게
  });

  test('폰 · 태블릿은 아래 탭, PC(1024px~)는 위 메뉴 + 푸터 — 768px 칸에는 메뉴 · 탭 규칙이 없다', () => {
    const css = read('segan/shell.css');
    const parts = css.split('@media (min-width: 1024px)');
    expect(parts).toHaveLength(2);
    const wide = parts[1];
    expect(wide).toMatch(/\.sg-tabbar\s*\{\s*display:\s*none;/);
    expect(wide).toMatch(/\.sg-nav\s*\{[^}]*display:\s*flex;/);
    expect(wide).toMatch(/\.sg-nav \.sg-nav-end\s*\{\s*margin-left:\s*auto;/);
    expect(wide).toMatch(/\.sg-footer\s*\{\s*display:\s*block;/);
    expect(wide).toMatch(/\.sg-biz\s*\{\s*display:\s*none;/);
    expect(wide).toMatch(/\.sg-app\s*\{\s*padding-bottom:\s*0;/);
    const mid = css.split('@media (min-width: 768px)')[1].split('@media (min-width: 1024px)')[0];
    for (const sel of ['.sg-tabbar', '.sg-nav', '.sg-footer', '.sg-biz', '.sg-app', '.sg-header'])
      expect([sel, new RegExp(`\\${sel}\\s*\\{`).test(mid)]).toEqual([sel, false]);
  });

  test('아래 탭 위에 붙는 것(버튼 줄 · 비서 입력 · 장부 알림)은 탭이 없어지는 1024px 부터 아래로 내린다', () => {
    const at1024 = (file) =>
      (read(file).split('@media (min-width: 1024px)')[1] || '').split('@media')[0];
    const at768 = (file) =>
      read(file)
        .split('@media (min-width: 768px)')
        .slice(1)
        .map((part) => part.split('@media')[0])
        .join('');
    expect(at1024('segan/make.css')).toMatch(/\.mk-bar\s*\{\s*bottom:\s*0;/);
    expect(at768('segan/make.css')).not.toMatch(/\.mk-bar\s*\{[^}]*bottom/);
    expect(at1024('segan/assistant.css')).toMatch(/\.as-form\s*\{\s*bottom:\s*0;/);
    expect(at768('segan/assistant.css')).not.toMatch(/\.as-form\s*\{/);
    expect(at1024('segan/ledger.css')).toMatch(/\.lg-state\s*\{\s*bottom:\s*24px;/);
    expect(at1024('segan/ledger.css')).toMatch(/\.lg-tabs\s*\{\s*top:\s*88px;/); // 위 메뉴 높이
    expect(at768('segan/ledger.css')).not.toMatch(/\.lg-(state|tabs)\s*\{/);
  });
});

describe('시트 · 옆 패널 · 가운데 창 — SeganShell.sheet', () => {
  const URL0 = '/segan/collection.html#x';
  const wraps = () => $$('.sg-sheet-wrap');
  const atSheet = () => window.SeganShell.sheet.isSheetState(window.history.state);
  const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
  /** 뒤로 가기는 비동기다 — 셸이 popstate 를 받으면 시험 처리기에는 안 오니 상태를 기다린다 */
  async function until(fn) {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await tick(5);
    }
    throw new Error('기다린 상태가 오지 않았다');
  }
  /** 셸을 올리고, 화면에 여는 버튼 · 페이지 popstate 처리기를 둔다 */
  async function setup() {
    // 새 칸을 넣어 앞 시험이 남긴 「앞으로」 칸을 지운다 — 칸 수(history.length)를 셀 수 있게
    window.history.pushState({ page: 'base' }, '', URL0);
    await load('collection.html');
    const opener = document.createElement('button');
    opener.textContent = '열기';
    $('#main').appendChild(opener);
    opener.focus();
    const pagePop = jest.fn();
    window.addEventListener('popstate', pagePop);
    pops.push(pagePop);
    return { S: window.SeganShell.sheet, opener, pagePop };
  }
  const pops = [];
  afterEach(() => {
    while (pops.length) window.removeEventListener('popstate', pops.pop());
  });
  const para = (text) => {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  };
  const key = (k, extra = {}) =>
    document.activeElement.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
    );

  test('열기 — 제목 · 본문 · aria, 주소(# 포함)는 그대로 기록 칸만 하나, 뒤 화면 잠금, 초점은 창 안', async () => {
    const { S, opener } = await setup();
    const len = window.history.length;
    const body = para('사진 설명');
    const h = S.open({ title: '사진 보기', body });
    expect(wraps()).toHaveLength(1);
    const box = h.el;
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(box.getAttribute('aria-labelledby')).textContent).toBe(
      '사진 보기'
    );
    expect(h.body.contains(body)).toBe(true);
    expect(wraps()[0].classList.contains('sg-sheet-wrap--sheet')).toBe(true);
    expect(window.location.pathname + window.location.hash).toBe(URL0);
    expect(window.history.length).toBe(len + 1);
    expect(atSheet()).toBe(true);
    expect(window.history.state.page).toBe('base'); // 페이지가 둔 값은 그대로
    expect(document.body.classList.contains('sg-locked')).toBe(true);
    expect(box.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(opener);
    expect(S.current().el).toBe(box);
  });

  test('닫기(h.close · 닫기 버튼) — 창을 떼고 기록 칸을 되돌린다, 페이지 처리기는 모른다, 초점은 연 버튼으로', async () => {
    const { S, opener, pagePop } = await setup();
    const onClose = jest.fn();
    const h = S.open({ title: '보기', body: para('x'), onClose });
    await h.close();
    expect(wraps()).toHaveLength(0);
    expect(h.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledWith('close');
    expect(document.body.classList.contains('sg-locked')).toBe(false);
    expect(window.history.state).toEqual({ page: 'base' });
    expect(window.location.pathname + window.location.hash).toBe(URL0);
    expect(document.activeElement).toBe(opener);
    expect(S.current()).toBeNull();
    await h.close(); // 두 번 닫아도 그대로
    const onClose2 = jest.fn();
    S.open({ title: '보기', body: 'x', onClose: onClose2 });
    $('.sg-sheet-x').click();
    expect(onClose2).toHaveBeenCalledWith('button');
    await until(() => !atSheet());
    await tick();
    expect(pagePop).not.toHaveBeenCalled();
    expect(window.history.state).toEqual({ page: 'base' });
  });

  test('Esc 로 닫는다 (한글 조합 중 Esc 는 닫지 않는다)', async () => {
    const { S, opener, pagePop } = await setup();
    const onClose = jest.fn();
    S.open({ title: '보기', body: 'x', onClose });
    key('Escape', { isComposing: true });
    expect(wraps()).toHaveLength(1);
    key('Escape');
    expect(wraps()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledWith('escape');
    expect(document.activeElement).toBe(opener);
    await until(() => !atSheet());
    await tick();
    expect(pagePop).not.toHaveBeenCalled();
  });

  test('바깥(뒤 막) 누르기로 닫는다 — 창 안 누르기 · 안에서 눌러 바깥에서 뗀 것은 닫지 않는다', async () => {
    const { S } = await setup();
    const onClose = jest.fn();
    const h = S.open({ title: '보기', body: para('x'), onClose });
    const wrap = wraps()[0];
    h.body.firstChild.click();
    expect(wraps()).toHaveLength(1);
    h.el.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    wrap.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(wraps()).toHaveLength(1);
    wrap.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
    wrap.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(wraps()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledWith('backdrop');
    await until(() => !atSheet());
  });

  test('뒤로 가기(popstate)가 창을 닫고 페이지 처리기는 돌지 않는다 — 한 번 더 뒤로는 페이지 것', async () => {
    const { S, opener, pagePop } = await setup();
    window.history.pushState({ page: 'two' }, '');
    const onClose = jest.fn();
    S.open({ title: '보기', body: 'x', onClose });
    window.history.back();
    await until(() => wraps().length === 0);
    expect(onClose).toHaveBeenCalledWith('back');
    expect(window.history.state).toEqual({ page: 'two' });
    expect(window.location.pathname + window.location.hash).toBe(URL0);
    expect(document.activeElement).toBe(opener);
    await tick();
    expect(pagePop).not.toHaveBeenCalled();
    window.history.back();
    await until(() => pagePop.mock.calls.length === 1);
    expect(pagePop.mock.calls[0][0].state).toEqual({ page: 'base' });
  });

  test('옆 패널은 하나만 — 새로 열면 앞의 것을 닫고 그 기록 칸을 쓴다, 초점은 처음 연 버튼으로', async () => {
    const { S, opener, pagePop } = await setup();
    const len = window.history.length;
    const firstClose = jest.fn();
    const a = S.open({ title: 'A', kind: 'panel', body: para('a'), onClose: firstClose });
    const inA = document.createElement('button');
    a.body.appendChild(inA);
    inA.focus();
    const b = S.open({ title: 'B', kind: 'panel', body: para('b') });
    expect(firstClose).toHaveBeenCalledWith('replaced');
    expect(a.isOpen()).toBe(false);
    expect(wraps()).toHaveLength(1);
    expect(wraps()[0].classList.contains('sg-sheet-wrap--panel')).toBe(true);
    expect(wraps()[0].textContent).toContain('B');
    expect(window.history.length).toBe(len + 1); // 칸이 늘지 않는다
    // 시트도 같은 자리 — 패널이 열린 채 시트를 열면 패널을 닫는다
    const c = S.open({ title: 'C', kind: 'sheet', body: 'c' });
    expect(b.isOpen()).toBe(false);
    expect(wraps()).toHaveLength(1);
    expect(window.history.length).toBe(len + 1);
    window.history.back();
    await until(() => wraps().length === 0);
    expect(c.isOpen()).toBe(false);
    expect(window.history.state).toEqual({ page: 'base' });
    expect(document.activeElement).toBe(opener);
    await tick();
    expect(pagePop).not.toHaveBeenCalled();
  });

  test('Tab 은 창 안에서만 돈다 · initialFocus', async () => {
    const { S } = await setup();
    const body = document.createElement('div');
    body.innerHTML =
      '<button type="button" id="t1">하나</button><button type="button" id="t2">둘</button>';
    const h = S.open({ title: '보기', body, initialFocus: body.querySelector('#t2') });
    expect(document.activeElement.id).toBe('t2');
    key('Tab');
    expect(document.activeElement).toBe(h.el.querySelector('.sg-sheet-x')); // 처음 = 닫기 버튼
    key('Tab', { shiftKey: true });
    expect(document.activeElement.id).toBe('t2');
  });

  test('가운데 창(dialog) — 시트 위에 겹친다, Esc · 뒤로 가기는 맨 위 창만 닫는다', async () => {
    const { S, pagePop } = await setup();
    const sheet = S.open({ title: '사진', kind: 'sheet', body: para('사진') });
    const sheetEntry = () => window.history.state && window.history.state.sgSheet;
    const below = sheetEntry();
    const del = document.createElement('button');
    sheet.body.appendChild(del);
    del.focus();
    const ask = S.open({ title: '지울까요?', kind: 'dialog', body: para('되돌릴 수 없습니다') });
    expect(wraps()).toHaveLength(2);
    expect(wraps()[1].classList.contains('sg-sheet-wrap--dialog')).toBe(true);
    expect(S.current().kind).toBe('dialog');
    expect(sheet.isOpen()).toBe(true); // 창은 시트를 닫지 않는다
    key('Escape');
    expect(ask.isOpen()).toBe(false);
    expect(sheet.isOpen()).toBe(true);
    expect(document.activeElement).toBe(del); // 창을 연 시트 안 버튼으로
    await until(() => sheetEntry() === below); // 창의 기록 칸만 되돌렸다
    // 다시 열고 뒤로 가기 — 창만 닫히고 시트는 남는다
    const ask2 = S.open({ title: '지울까요?', kind: 'dialog', body: 'x' });
    window.history.back();
    await until(() => !ask2.isOpen());
    expect(sheet.isOpen()).toBe(true);
    expect(atSheet()).toBe(true);
    await sheet.close();
    expect(wraps()).toHaveLength(0);
    expect(window.history.state).toEqual({ page: 'base' });
    await tick();
    expect(pagePop).not.toHaveBeenCalled();
  });

  /**
   * 기록 모형 — 'jsdom' 은 jsdom 그대로(pushState 가 걸린 뒤로 가기를 취소한다),
   * 'browser' 는 브라우저 차례: 뒤로 가기는 늦게 돌고, 그 사이 pushState 가 와도 취소되지 않으며,
   * 돌 때의 칸에서 한 칸 뒤로 간다 (옛 셸은 이때 새 시트를 닫았다).
   */
  function useHistory(mode) {
    if (mode === 'jsdom') return () => {};
    const h = window.history;
    const entries = [h.state];
    let at = 0;
    const go = (n) =>
      setTimeout(() => {
        const to = Math.max(0, Math.min(entries.length - 1, at + n));
        if (to === at) return;
        at = to;
        window.dispatchEvent(new window.PopStateEvent('popstate', { state: entries[at] }));
      }, 0);
    const own = {
      state: { get: () => entries[at], configurable: true },
      length: { get: () => entries.length, configurable: true },
      pushState: {
        value: (st) => {
          entries.splice(at + 1);
          entries.push(st);
          at++;
        },
        configurable: true,
      },
      replaceState: {
        value: (st) => {
          entries[at] = st;
        },
        configurable: true,
      },
      go: { value: go, configurable: true },
      back: { value: () => go(-1), configurable: true },
    };
    Object.defineProperties(h, own);
    return () => Object.keys(own).forEach((k) => delete h[k]);
  }
  const restores = [];
  afterEach(() => {
    while (restores.length) restores.pop()();
  });

  describe.each(['jsdom', 'browser'])('닫고 바로 열기 — 기록 모형 %s', (mode) => {
    test('시트를 닫고(뒤로 가기가 돌아오기 전) 바로 새 시트 — 새 시트는 열린 채, 기록 칸은 하나', async () => {
      const { S, pagePop } = await setup();
      restores.push(useHistory(mode));
      const len = window.history.length;
      const a = S.open({ title: 'A', body: 'a' });
      expect(window.history.length).toBe(len + 1);
      const closing = a.close();
      const onCloseB = jest.fn();
      const b = S.open({ title: 'B', body: para('b'), onClose: onCloseB });
      expect(wraps()).toHaveLength(1); // 창은 바로 그린다
      expect(b.isOpen()).toBe(true);
      await closing; // 닫기의 뒤로 가기가 돌아왔다 (한도 1.5초를 기다리지 않는다)
      await tick();
      expect(b.isOpen()).toBe(true);
      expect(onCloseB).not.toHaveBeenCalled();
      expect(wraps()).toHaveLength(1);
      expect(atSheet()).toBe(true);
      expect(window.history.state.page).toBe('base');
      expect(window.history.length).toBe(len + 1); // [base, B] — A 의 칸은 남지 않는다
      // 뒤로 가기 한 번이면 B 를 닫고 처음 칸이다
      window.history.back();
      await until(() => !b.isOpen());
      expect(onCloseB).toHaveBeenCalledWith('back');
      expect(window.history.state).toEqual({ page: 'base' });
      await tick();
      expect(pagePop).not.toHaveBeenCalled();
    });

    test('창(dialog)을 닫고 바로 다른 시트 — 새 시트가 앞 시트의 칸을 쓴다', async () => {
      const { S, pagePop } = await setup();
      restores.push(useHistory(mode));
      const len = window.history.length;
      const a = S.open({ title: 'A', kind: 'sheet', body: 'a' });
      const ask = S.open({ title: '지울까요?', kind: 'dialog', body: 'x' });
      expect(window.history.length).toBe(len + 2);
      const closing = ask.close();
      const b = S.open({ title: 'B', kind: 'sheet', body: 'b' });
      expect(a.isOpen()).toBe(false);
      await closing;
      await tick();
      expect(b.isOpen()).toBe(true);
      expect(atSheet()).toBe(true);
      expect(window.history.state.sgSheet).not.toBeUndefined();
      await b.close();
      expect(window.history.state).toEqual({ page: 'base' });
      await tick();
      expect(pagePop).not.toHaveBeenCalled();
    });

    test('창을 닫고 바로 아래 시트도 닫기 — 둘 다 칸을 되돌린다 (남은 표시 칸 없음)', async () => {
      const { S, pagePop } = await setup();
      restores.push(useHistory(mode));
      const a = S.open({ title: 'A', kind: 'sheet', body: 'a' });
      const ask = S.open({ title: '지울까요?', kind: 'dialog', body: 'x' });
      const both = Promise.all([ask.close(), a.close()]);
      expect(wraps()).toHaveLength(0);
      await both;
      expect(atSheet()).toBe(false);
      expect(window.history.state).toEqual({ page: 'base' });
      await tick();
      expect(pagePop).not.toHaveBeenCalled();
    });

    test('닫는 중에 연 시트를 바로 닫기 — 칸을 넣지 않고 끝난다', async () => {
      const { S, pagePop } = await setup();
      restores.push(useHistory(mode));
      const len = window.history.length;
      const a = S.open({ title: 'A', body: 'a' });
      const closingA = a.close();
      const b = S.open({ title: 'B', body: 'b' });
      const closingB = b.close();
      expect(wraps()).toHaveLength(0);
      await Promise.all([closingA, closingB]);
      await tick();
      expect(atSheet()).toBe(false);
      expect(window.history.state).toEqual({ page: 'base' });
      expect(window.history.length).toBe(len + 1); // 앞으로 칸(A)만 남는다 — 새 칸은 없다
      expect(pagePop).not.toHaveBeenCalled();
    });
  });

  test('dismissible: false — Esc · 바깥 · 닫기 버튼으로 닫지 않는다 (뒤로 가기는 닫는다)', async () => {
    const { S } = await setup();
    const onClose = jest.fn();
    const h = S.open({ title: '동의', kind: 'dialog', body: 'x', dismissible: false, onClose });
    expect(h.el.querySelector('.sg-sheet-x').hidden).toBe(true);
    key('Escape');
    wraps()[0].click();
    expect(h.isOpen()).toBe(true);
    window.history.back();
    await until(() => !h.isOpen());
    expect(onClose).toHaveBeenCalledWith('back');
  });

  test('isSheetState — 셸이 넣은 칸만 참 · 새로 고친 뒤 남은 표시는 지운다', async () => {
    const { S } = await setup();
    expect(S.STATE_KEY).toBe('sgSheet');
    expect(S.isSheetState({ sgSheet: 3 })).toBe(true);
    expect(S.isSheetState({ mk: 'kind', sgSheet: 3 })).toBe(true);
    for (const st of [null, undefined, {}, { mk: 'kind' }, { sgSheet: '3' }, 'sgSheet'])
      expect(S.isSheetState(st)).toBe(false);
    window.history.replaceState({ mk: 'kind', sgSheet: 3 }, '');
    await load('collection.html');
    expect(window.history.state).toEqual({ mk: 'kind' });
    expect(window.location.pathname + window.location.hash).toBe(URL0);
  });

  test('스타일 — 폰 아래 시트(90dvh · 안만 넘김 · 안전 영역), PC 1100px~ 오른쪽 420px, 움직임 줄이기, 44px', () => {
    const css = read('segan/shell.css');
    const block = (sel) => {
      const m = css.match(
        new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
      );
      expect([sel, !!m]).toEqual([sel, true]);
      return m[1];
    };
    expect(block('.sg-sheet-wrap')).toMatch(/position:\s*fixed/);
    expect(block('.sg-sheet')).toMatch(/max-height:\s*90dvh/);
    expect(block('.sg-sheet-body')).toMatch(/overflow-y:\s*auto/);
    expect(block('.sg-sheet-body')).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(block('.sg-sheet-x')).toMatch(/min-height:\s*44px/);
    expect(css).toMatch(/body\.sg-locked\s*\{\s*overflow:\s*hidden;/);
    // PC 1100px~ 칸 — 시트 · 패널 (마이페이지 두 칸도 같은 폭에서 연다)
    const wide = css
      .split('@media (min-width: 1100px)')
      .slice(1)
      .find((b) => b.includes('.sg-sheet-wrap--panel'));
    expect(wide).toBeDefined();
    expect(wide).toMatch(/\.sg-sheet-wrap--panel \.sg-sheet\s*\{[^}]*width:\s*420px/);
    expect(wide).toMatch(/border-left:\s*1px solid/);
    const calm = css
      .split('@media (prefers-reduced-motion: reduce)')
      .slice(1)
      .find((b) => /^\s*\{\s*\.sg-sheet-wrap/.test(b));
    expect(calm).toMatch(/\.sg-sheet-wrap \.sg-sheet\s*\{\s*animation:\s*none;/);
  });

  describe('폰 시트 — 머리를 끌어 내려 닫는다 (CLAUDE.md 「SEGAN 모션 규칙」)', () => {
    const ptr = (el, type, y) =>
      el.dispatchEvent(
        new window.MouseEvent(type, { clientY: y, bubbles: true, cancelable: true })
      );
    const moved = (el) =>
      Number((/translateY\((-?[\d.]+)px\)/.exec(el.style.transform) || [0, 0])[1]);
    function openTall(S) {
      const onClose = jest.fn();
      const h = S.open({ title: '보기', body: para('본문'), onClose });
      Object.defineProperty(h.el, 'offsetHeight', { configurable: true, value: 500 });
      return { h, onClose, head: h.el.querySelector('.sg-sheet-head') };
    }
    afterEach(() => {
      delete window.matchMedia;
      jest.restoreAllMocks();
    });

    test('놓은 속도로 정한다 — 짧게 내려도 빠르게 던지면 닫고, 멈췄다 놓으면 제자리', async () => {
      const { S } = await setup();
      let t = 1000;
      jest.spyOn(Date, 'now').mockImplementation(() => t);
      const a = openTall(S);
      ptr(a.head, 'pointerdown', 100);
      t += 20;
      ptr(a.head, 'pointermove', 150); // 0.02초에 50px — 1초에 2,500px
      ptr(a.head, 'pointerup', 150);
      await until(() => a.onClose.mock.calls.length === 1);
      expect(a.onClose).toHaveBeenCalledWith('drag');
      const b = openTall(S);
      ptr(b.head, 'pointerdown', 100);
      t += 20;
      ptr(b.head, 'pointermove', 150);
      t += 400; // 멈췄다 놓음
      ptr(b.head, 'pointerup', 150);
      expect(b.h.isOpen()).toBe(true);
      expect(b.h.el.style.transform).toBe('');
      await b.h.close();
    });

    test('손가락을 1:1 로 따라가고, 조금 끌다 놓으면 제자리', async () => {
      const { S } = await setup();
      const { h, onClose, head } = openTall(S);
      let t = 1000;
      jest.spyOn(Date, 'now').mockImplementation(() => t);
      ptr(head, 'pointerdown', 100);
      t += 600;
      ptr(head, 'pointermove', 160); // 천천히 — 0.6초에 60px
      t += 10;
      expect(moved(h.el)).toBe(60);
      ptr(head, 'pointerup', 160);
      expect(h.el.style.transform).toBe('');
      expect(h.isOpen()).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });

    test('위로는 고무줄 — 덜 따라온다. 높이의 40 % 넘게 내리면 닫는다 (why drag)', async () => {
      const { S } = await setup();
      const { h, onClose, head } = openTall(S);
      ptr(head, 'pointerdown', 100);
      ptr(head, 'pointermove', 40);
      expect(moved(h.el)).toBeLessThan(0);
      expect(moved(h.el)).toBeGreaterThan(-60);
      ptr(head, 'pointermove', 360);
      expect(moved(h.el)).toBe(260);
      ptr(head, 'pointerup', 360);
      jest.restoreAllMocks();
      await until(() => onClose.mock.calls.length === 1);
      expect(onClose).toHaveBeenCalledWith('drag');
      expect(wraps()).toHaveLength(0);
    });

    test('닫기 단추에서 시작하면 끌지 않는다 · PC 옆 패널 · 닫을 수 없는 시트는 끌지 않는다', async () => {
      const { S } = await setup();
      const { h, head } = openTall(S);
      const x = head.querySelector('.sg-sheet-x');
      ptr(x, 'pointerdown', 100);
      ptr(head, 'pointermove', 400);
      ptr(head, 'pointerup', 400);
      expect(h.el.style.transform).toBe('');
      expect(h.isOpen()).toBe(true);
      await h.close();
      window.matchMedia = (q) => ({ matches: /min-width:\s*1100px/.test(q), media: q });
      const pc = openTall(S);
      ptr(pc.head, 'pointerdown', 100);
      ptr(pc.head, 'pointermove', 400);
      ptr(pc.head, 'pointerup', 400);
      expect(pc.h.el.style.transform).toBe('');
      expect(pc.h.isOpen()).toBe(true);
      await pc.h.close();
      delete window.matchMedia;
      const fixed = S.open({ title: '확인', body: para('본문'), dismissible: false });
      const fh = fixed.el.querySelector('.sg-sheet-head');
      ptr(fh, 'pointerdown', 100);
      ptr(fh, 'pointermove', 400);
      expect(fixed.el.style.transform).toBe('');
      ptr(fh, 'pointerup', 400);
      expect(fixed.isOpen()).toBe(true);
      await fixed.close();
    });

    test('가운데 창은 끌 머리가 없다 · 손잡이 막대는 폰 시트에만 (CSS)', async () => {
      const css = fs.readFileSync(path.join(ROOT, 'segan/shell.css'), 'utf8');
      expect(css).toMatch(
        /@media \(max-width: 1099\.98px\) \{\s*\.sg-sheet-wrap--sheet \.sg-sheet-head \{[^}]*touch-action: none;/
      );
      expect(css).toMatch(/\.sg-sheet-wrap--sheet \.sg-sheet-head::before \{/);
      expect(css).toMatch(
        /\.sg-sheet \{[^}]*animation: sg-sheet-up var\(--sg-spring-ms\) var\(--sg-spring\);/
      );
    });
  });
});
