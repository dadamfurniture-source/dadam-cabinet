/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname, document, window, DOMParser, sessionStorage, jest, console, URL, setTimeout */
/**
 * SEGAN 앱 셸 (segan/shell.js + segan/*.html) — jsdom 에 페이지를 올려 확인한다.
 *
 *   - 탭 4개: 만들기 · 시공사례 · 내 연출컷 · 내 정보 (순서 · 주소), 페이지마다 현재 탭 aria-current
 *     + 관리 탭 — 처음엔 감추고 관리자(AdminAccess.isAdmin)에게만 연다, 탭 페이지마다 AdminAccess 를 싣는다
 *   - 내 연출컷 · 내 정보는 로그인이 없으면 「로그인이 필요합니다」 + login.html?redirect=(이 페이지)
 *   - 내 정보의 역할 메뉴는 기존 모듈 판정(AdminAccess · DetailDesignAccess · DadamMyPageWork)을 따른다
 *     — 페이지가 싣는 실제 js/ 파일을 그대로 올리고 Supabase · /work/me 만 가짜로 둔다
 *   - 사업자 정보는 사이트 푸터(js/site-shell.js)와 같다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const AuthRedirect = require('../js/auth-redirect.js');

const TAB_PAGES = {
  make: 'index.html',
  collection: 'collection.html',
  renders: 'renders.html',
  me: 'me.html',
};
const LABELS = ['만들기', '시공사례', '내 연출컷', '내 정보'];
const HREFS = ['./', 'collection.html', 'renders.html', 'me.html'];
const SESSION = { access_token: 'tok-1', user: { id: 'user-1', email: 'customer@example.com' } };

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
 */
async function load(page, options = {}) {
  const opts = {
    session: null,
    isAdmin: false,
    profile: { tier: null, detaildesign_approved: false, detaildesign_requested_at: null },
    workMe: { ready: true, worker: null },
    workFail: false,
    noSupabase: false,
    ...options,
  };
  const html = read(`segan/${page}`);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);

  sessionStorage.clear();
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

describe('탭 4개 — 순서 · 주소 · 현재 탭', () => {
  test.each(Object.entries(TAB_PAGES))(
    '%s (%s) — 위 메뉴 · 아래 탭 모두 4개, 현재 탭만 aria-current',
    async (key, page) => {
      await load(page);
      expect(document.body.dataset.tab).toBe(key);
      for (const sel of ['.sg-header nav.sg-nav', 'nav.sg-tabbar']) {
        const nav = $(sel);
        expect(nav).not.toBeNull();
        expect(nav.getAttribute('aria-label')).toBe('주 메뉴');
        const all = [...nav.querySelectorAll('a')];
        // 관리 탭은 맨 뒤에 감춰져 있다 (로그인 전 · 관리자 아님)
        expect(all.map((a) => a.getAttribute('data-tab-link'))).toEqual([
          ...Object.keys(TAB_PAGES),
          'admin',
        ]);
        expect(all[all.length - 1].hidden).toBe(true);
        const links = all.filter((a) => !a.hidden);
        expect(links.map((a) => a.textContent.trim())).toEqual(LABELS);
        expect(links.map((a) => a.getAttribute('href'))).toEqual(HREFS);
        const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
        expect(current).toHaveLength(1);
        expect(current[0].getAttribute('data-tab-link')).toBe(key);
        expect(links.every(visible)).toBe(true); // 로그인 전에도 보인다
      }
      expect($('main#main')).not.toBeNull();
      expect($$('h1').filter(visible)).toHaveLength(1); // 만들기는 단계마다 제목이 있고 지금 단계만 보인다
      expect($$('[data-segan-shell]')).toHaveLength(0); // 자리표시가 모두 채워졌다
    }
  );

  test('탭 주소는 segan/ 안의 실제 페이지다 (만들기 = start_url /segan/)', () => {
    expect(HREFS.map((h) => (h === './' ? 'index.html' : h))).toEqual(Object.values(TAB_PAGES));
    for (const page of Object.values(TAB_PAGES))
      expect(fs.existsSync(path.join(ROOT, 'segan', page))).toBe(true);
    const manifest = JSON.parse(read('segan/manifest.webmanifest'));
    expect(new URL(HREFS[0], 'https://x/segan/').pathname).toBe(manifest.start_url);
  });

  test('아래 탭 아이콘은 꾸밈 (aria-hidden), 이름은 글자로', async () => {
    await load('index.html');
    for (const svg of $$('.sg-tabbar svg')) expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect($$('.sg-tabbar a span').map((s) => s.textContent)).toEqual([...LABELS, '관리']);
    expect(
      $$('.sg-tabbar a')
        .filter(visible)
        .map((a) => a.textContent.trim())
    ).toEqual(LABELS);
  });

  test.each([
    'index.html',
    'collection.html',
    'consult.html',
    'join.html',
    'renders.html',
    'me.html',
    'admin.html',
  ])(
    '관리 탭 — %s 는 AdminAccess 를 싣고, 관리자면 위 메뉴 · 아래 탭에 「관리」를 연다',
    async (page) => {
      const { scripts } = await load(page, { session: SESSION, isAdmin: true });
      expect(scripts.some((s) => s.startsWith('../js/admin-access.js?v='))).toBe(true);
      for (const sel of ['.sg-header nav.sg-nav', 'nav.sg-tabbar']) {
        const admin = $(sel + ' a[data-tab-link="admin"]');
        expect(admin.hidden).toBe(false);
        expect(admin.textContent.trim()).toBe('관리');
        expect(admin.getAttribute('href')).toBe('admin.html');
      }
    }
  );

  test('관리 탭 — 관리자가 아니거나 로그인 전이면 감춘 채, 로그인 전에는 is_admin 을 묻지 않는다', async () => {
    const member = await load('index.html', { session: SESSION, isAdmin: false });
    expect($('nav.sg-tabbar a[data-tab-link="admin"]').hidden).toBe(true);
    expect(member.calls.rpc).toEqual(['is_admin']);
    expect(member.result.admin).toBe(false);
    const guest = await load('collection.html', { session: null });
    expect($('nav.sg-tabbar a[data-tab-link="admin"]').hidden).toBe(true);
    expect(guest.calls.rpc).toEqual([]);
    const admin = await load('me.html', { session: SESSION, isAdmin: true });
    expect(admin.result.admin).toBe(true);
  });

  test('아래 탭은 감춘 탭 자리를 두지 않는다 (칸 수를 정하지 않고 보이는 탭만큼)', () => {
    const css = read('segan/shell.css');
    const m = css.match(/^\.sg-tabbar \{([^}]*)\}/m);
    expect(m).not.toBeNull();
    const rule = m[1];
    expect(rule).toContain('grid-auto-flow: column');
    expect(rule).not.toContain('grid-template-columns');
    expect(read('segan/sw.js')).toContain("SCOPE + 'admin.html'");
    expect(read('segan/sw.js')).toContain("versioned(SCOPE + 'admin.js')");
  });
});

describe('로그인 안내 — 내 연출컷 · 내 정보', () => {
  test.each([
    ['renders.html', 'segan/renders.html', '내 연출컷은'],
    ['me.html', 'segan/me.html', '내 정보는'],
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

  test('로그인했으면 안내 대신 내용 (내 정보는 계정 이메일)', async () => {
    await load('renders.html', { session: SESSION });
    expect(view('signed-out').hidden).toBe(true);
    expect(visible(view('signed-in'))).toBe(true);

    await load('me.html', { session: SESSION });
    expect(view('signed-out').hidden).toBe(true);
    expect(visible(view('signed-in'))).toBe(true);
    expect($('#sgAccountEmail').textContent).toBe('customer@example.com');
    for (const label of ['상담 내역', '크레딧 · 구독', '설정', '로그아웃']) {
      expect(view('signed-in').textContent).toContain(label);
    }
  });

  test('만들기 · 시공사례는 로그인과 상관없이 열린다 (로그인 칸이 없다)', async () => {
    for (const page of ['index.html', 'collection.html']) {
      await load(page, { noSupabase: true });
      expect($$('[data-auth-view]')).toHaveLength(0);
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

describe('내 정보 — 역할 메뉴는 기존 판정 모듈을 따른다', () => {
  const roleShown = () =>
    Object.fromEntries(
      ['detail', 'admin', 'worker'].map((k) => [k, visible($(`[data-role="${k}"]`))])
    );

  test('me.html 이 판정 모듈을 싣는다 (admin-access · detaildesign-access · mypage-work)', async () => {
    const { scripts } = await load('me.html');
    const bare = scripts.map((s) => s.split('?')[0]);
    for (const f of [
      '../js/config.js',
      '../js/admin-access.js',
      '../js/detaildesign-access.js',
      '../js/mypage-work.js',
    ]) {
      expect(bare).toContain(f);
    }
    // DetailDesignAccess 가 AdminAccess 를 부르므로 admin-access 가 먼저
    const order = bare.filter((s) => /admin-access|detaildesign-access/.test(s));
    expect(order).toEqual(['../js/admin-access.js', '../js/detaildesign-access.js']);
    // 셸 다음에 내 정보 탭 스크립트 (상담 내역 · 크레딧 · 구독)
    expect(bare.slice(-3)).toEqual(['shell.js', 'make.js', 'me.js']);
  });

  test('링크 주소 — 상세설계 · 관리자 화면 · 작업자 포털 (기존 페이지)', async () => {
    await load('me.html', { session: SESSION });
    const links = $$('#sgRoles a').map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      ['상세설계', '../detaildesign.html'],
      ['관리자 화면', '../admin/index.html'],
      ['작업자 포털', '../worker.html'],
    ]);
    for (const [, href] of links) expect(fs.existsSync(path.join(ROOT, 'segan', href))).toBe(true);
  });

  test('역할이 없는 회원 — 업무 칸 자체를 감춘다', async () => {
    await load('me.html', {
      session: SESSION,
      profile: { tier: null, detaildesign_approved: false },
    });
    expect(roleShown()).toEqual({ detail: false, admin: false, worker: false });
    expect($('#sgRoles').hidden).toBe(true);
  });

  test.each(['standard', 'expert', 'agent', null, 'unknown'])(
    '상세설계 — 등급 %s 은 DetailDesignAccess.decide 와 같은 결과',
    async (tier) => {
      await load('me.html', { session: SESSION, profile: { tier, detaildesign_approved: false } });
      const expected = window.DetailDesignAccess.decide({
        isAdmin: false,
        tier,
        approved: false,
      }).allowed;
      expect(roleShown().detail).toBe(expected);
      expect(roleShown().admin).toBe(false);
      expect($('#sgRoles').hidden).toBe(!expected);
    }
  );

  test('상세설계 — 본사 승인 계정은 decide 의 approved 규칙을 따른다', async () => {
    await load('me.html', {
      session: SESSION,
      profile: { tier: null, detaildesign_approved: true },
    });
    expect(roleShown().detail).toBe(
      window.DetailDesignAccess.decide({ tier: null, approved: true }).allowed
    );
  });

  test('관리자 (is_admin RPC 참) — 관리자 화면 + 상세설계', async () => {
    const { calls } = await load('me.html', { session: SESSION, isAdmin: true });
    expect(calls.rpc).toContain('is_admin');
    expect(roleShown()).toEqual({ detail: true, admin: true, worker: false });
    expect(visible($('#sgRoles'))).toBe(true);
  });

  test('관리자 아님 (is_admin 거짓) — 관리자 화면은 감춘다', async () => {
    await load('me.html', {
      session: SESSION,
      isAdmin: false,
      profile: { tier: 'agent', detaildesign_approved: false },
    });
    expect(roleShown().admin).toBe(false);
  });

  test('작업자 (GET /work/me 에 작업자 행) — 작업자 포털, 본인 토큰으로 묻는다', async () => {
    const { calls } = await load('me.html', {
      session: SESSION,
      workMe: { ready: true, worker: { id: 'w1', status: 'approved', display_name: '작업자' } },
    });
    expect(roleShown()).toEqual({ detail: false, admin: false, worker: true });
    expect(calls.fetch).toEqual([
      { url: 'https://work.example.workers.dev/work/me', auth: 'Bearer tok-1' },
    ]);
  });

  test.each([
    ['작업자 행 없음', { workMe: { ready: true, worker: null } }],
    ['표가 아직 없음', { workMe: { ready: false, worker: { id: 'w1' } } }],
    ['요청 실패', { workFail: true }],
  ])('작업자 포털 감춤 — %s', async (_name, extra) => {
    await load('me.html', { session: SESSION, ...extra });
    expect(roleShown().worker).toBe(false);
  });

  test('관리자이면서 작업자 — 셋 다', async () => {
    await load('me.html', {
      session: SESSION,
      isAdmin: true,
      workMe: { ready: true, worker: { id: 'w1', status: 'approved' } },
    });
    expect(roleShown()).toEqual({ detail: true, admin: true, worker: true });
  });
});

describe('사업자 정보 — 사이트 푸터(js/site-shell.js)와 같다', () => {
  test('PC 푸터와 폰 내 정보에 같은 사업자 정보가 있고, 사이트 푸터 글과 같다', async () => {
    await load('me.html');
    const biz = { ...window.SeganShell.BIZ };
    const footer = $('footer.sg-footer').textContent;
    const inMe = $('.sg-biz').textContent;
    for (const v of Object.values(biz)) {
      expect(footer).toContain(v);
      expect(inMe).toContain(v);
    }
    // 다른 탭에는 내 정보 안 사업자 칸이 없다 (푸터만)
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

  test.each(PAGES)('%s — noindex,nofollow · 매니페스트 · 아이콘', (page) => {
    const html = read(`segan/${page}`);
    expect(html).toMatch(/<meta name="robots" content="noindex,nofollow" \/>/);
    expect(html).toMatch(/rel="manifest"/);
    expect(html).toMatch(/rel="apple-touch-icon"/);
  });

  test.each(Object.values(TAB_PAGES))(
    '%s — 공용 셸(shell.css · shell.js)과 자리표시 4종',
    (page) => {
      const html = read(`segan/${page}`);
      expect(html).toMatch(/<link rel="stylesheet" href="shell\.css\?v=\d+" \/>/);
      expect(html).toMatch(/<script src="shell\.js\?v=\d+" defer><\/script>/);
      for (const slot of ['header', 'footer', 'tabbar'])
        expect(html).toContain(`data-segan-shell="${slot}"`);
      expect(html).toMatch(/<body class="sg-app" data-tab="\w+">/);
    }
  );

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

  test('폰은 아래 탭, PC(768px~)는 위 메뉴 + 푸터', () => {
    const css = read('segan/shell.css');
    const parts = css.split('@media (min-width: 768px)');
    expect(parts).toHaveLength(2);
    const wide = parts[1];
    expect(wide).toMatch(/\.sg-tabbar\s*\{\s*display:\s*none;/);
    expect(wide).toMatch(/\.sg-nav\s*\{[^}]*display:\s*flex;/);
    expect(wide).toMatch(/\.sg-footer\s*\{\s*display:\s*block;/);
    expect(wide).toMatch(/\.sg-biz\s*\{\s*display:\s*none;/);
  });
});
