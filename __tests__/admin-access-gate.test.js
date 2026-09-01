/**
 * W12-23: 관리자 계정은 모든 서비스 기능에 들어갈 수 있어야 한다.
 *
 * 차단 게이트는 두 곳뿐이고 둘 다 관리자 우회가 이미 있었다
 * (detaildesign.html · persistence-init.js). 문제는 `isAdmin()` 이 false 를
 * 돌려주는 것이었다 — **거짓을 캐시**했기 때문이다.
 *
 *   is_admin() 은 auth.uid() 를 본다. 세션이 실리기 전에 부르면 false 다.
 *   그 false 를 1분간 캐시하면, 세션이 준비된 뒤에도 관리자가 계속
 *   비관리자로 판정된다.
 */
const fs = require('fs');
const path = require('path');

const read = (p) =>
  fs
    .readFileSync(path.join(__dirname, '..', p), 'utf8')
    .split('\r\n')
    .join('\n');
const ADMIN = read('js/admin-access.js');
const DD = read('js/detaildesign-access.js');

/** 모듈을 브라우저처럼 평가해 전역 객체를 꺼낸다 (IIFE + window 등록) */
function loadModule(src, win) {
  const fn = new Function('window', 'document', 'sessionStorage', 'console', src);
  fn(win, win.document, win.sessionStorage, console);
  return win;
}

function makeWindow() {
  const store = new Map();
  const win = {
    document: { querySelectorAll: () => [] },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    _store: store,
  };
  win.window = win;
  return win;
}

/** rpc 응답과 세션을 지정한 가짜 supabase 클라이언트 */
function fakeClient({
  session = { user: { id: 'u1' } },
  rpc = { data: true, error: null },
  calls = {},
} = {}) {
  calls.rpc = 0;
  return {
    auth: { getSession: async () => ({ data: { session } }) },
    rpc: async () => {
      calls.rpc++;
      return rpc;
    },
    from: () => ({
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: { message: 'x' } }) }),
      }),
    }),
  };
}

describe('isAdmin — 거짓을 캐시하지 않는다', () => {
  test('세션이 없으면 RPC 를 부르지 않고 false', async () => {
    const win = loadModule(ADMIN, makeWindow());
    const calls = {};
    const c = fakeClient({ session: null, calls });
    expect(await win.AdminAccess.isAdmin(c)).toBe(false);
    expect(calls.rpc).toBe(0);
  });

  test('RPC 가 false 여도 캐시에 남기지 않는다 — 다음에 다시 묻는다', async () => {
    const win = loadModule(ADMIN, makeWindow());
    const calls = {};
    let answer = { data: false, error: null };
    const c = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      rpc: async () => {
        calls.rpc = (calls.rpc || 0) + 1;
        return answer;
      },
    };
    expect(await win.AdminAccess.isAdmin(c)).toBe(false);
    answer = { data: true, error: null }; // 세션이 준비돼 이제 참
    expect(await win.AdminAccess.isAdmin(c)).toBe(true); // 캐시에 막히지 않는다
    expect(calls.rpc).toBe(2);
  });

  test('RPC 실패도 캐시하지 않는다', async () => {
    const win = loadModule(ADMIN, makeWindow());
    let answer = { data: null, error: { message: 'boom' } };
    const c = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      rpc: async () => answer,
    };
    expect(await win.AdminAccess.isAdmin(c)).toBe(false);
    answer = { data: true, error: null };
    expect(await win.AdminAccess.isAdmin(c)).toBe(true);
  });

  test('참은 캐시한다 — RPC 를 두 번 부르지 않는다', async () => {
    const win = loadModule(ADMIN, makeWindow());
    const calls = {};
    const c = fakeClient({ calls });
    expect(await win.AdminAccess.isAdmin(c)).toBe(true);
    expect(await win.AdminAccess.isAdmin(c)).toBe(true);
    expect(calls.rpc).toBe(1);
  });

  test('소스에 부정 캐시가 남지 않았다', () => {
    const fn = ADMIN.slice(
      ADMIN.indexOf('async function isAdmin'),
      ADMIN.indexOf('async function getRole')
    );
    expect(fn).not.toContain('writeCache(false');
    expect(fn).toMatch(/if \(result\) writeCache\(true/);
    expect(fn).toMatch(/cached\.isAdmin === true/);
  });
});

describe('관리자는 상세설계 승인으로 본다', () => {
  test('profiles 가 미승인이어도 관리자면 통과', async () => {
    const win = makeWindow();
    loadModule(ADMIN, win);
    loadModule(DD, win);
    const c = fakeClient(); // rpc → true (관리자)
    const r = await win.DetailDesignAccess.fetchStatus(c, 'u1');
    expect(r.approved).toBe(true);
  });

  test('관리자가 아니면 profiles 를 본다', async () => {
    const win = makeWindow();
    loadModule(ADMIN, win);
    loadModule(DD, win);
    const c = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      rpc: async () => ({ data: false, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { detaildesign_approved: false, detaildesign_requested_at: '2026-08-26' },
              error: null,
            }),
          }),
        }),
      }),
    };
    const r = await win.DetailDesignAccess.fetchStatus(c, 'u1');
    expect(r.approved).toBe(false);
    expect(r.requestedAt).toBe('2026-08-26');
  });

  test('미승인은 캐시하지 않는다 — 승인 직후 바로 열린다', async () => {
    const win = makeWindow();
    loadModule(ADMIN, win);
    loadModule(DD, win);
    let approved = false;
    const c = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      rpc: async () => ({ data: false, error: null }),
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { detaildesign_approved: approved, detaildesign_requested_at: null },
              error: null,
            }),
          }),
        }),
      }),
    };
    expect((await win.DetailDesignAccess.fetchStatus(c, 'u1')).approved).toBe(false);
    approved = true; // 관리자가 방금 승인
    expect((await win.DetailDesignAccess.fetchStatus(c, 'u1')).approved).toBe(true);
  });

  test('소스에 관리자 우회와 참-only 캐시가 있다', () => {
    expect(DD).toContain('window.AdminAccess.isAdmin(supabaseClient)');
    expect(DD).toMatch(/if \(approved\) writeCache\(userId, true/);
    expect(DD).toMatch(/if \(cached && cached\.approved\)/);
  });
});

describe('차단 게이트 두 곳 모두 관리자를 통과시킨다', () => {
  test('detaildesign.html — isAdmin 이면 즉시 return', () => {
    const html = read('detaildesign.html');
    const guard = html.slice(
      html.indexOf('enforceDetailDesignAccess'),
      html.indexOf('async function requestDetailDesignAccess')
    );
    expect(guard).toMatch(/if \(isAdmin\) return;/);
    // 관리자 판정이 승인 조회보다 **먼저** 와야 한다
    expect(guard.indexOf('isAdmin')).toBeLessThan(guard.indexOf('fetchStatus'));
  });

  test('persistence-init.js — approved || isAdminBypass', () => {
    const js = read('js/detaildesign/persistence-init.js');
    expect(js).toMatch(/detaildesign_approved\) \|\| isAdminBypass/);
  });

  test('그 밖의 페이지는 차단이 아니라 메뉴 노출만 다룬다', () => {
    [
      'ai-design.html',
      'collection.html',
      'material.html',
      'my-designs.html',
      'index.html',
      'consultation.html',
    ].forEach((f) => {
      const src = read(f);
      // 관리자 메뉴 노출은 페이지가 직접 부르거나(구 방식),
      // js/site-shell.js 에 위임한다(v5 공용 셸). 둘 중 하나는 있어야 한다.
      const covered =
        src.includes('AdminAccess.updateNavLinks') || src.includes('js/site-shell.js');
      expect(`${f} covered=${covered}`).toBe(`${f} covered=true`);
      expect(src).not.toContain('approvalOverlay?.classList.remove');
    });

    // 위임했으면 위임받은 쪽이 실제로 그 일을 해야 한다.
    // 셸에서 이 호출이 빠지면 여섯 페이지가 한꺼번에, 조용히 무너진다.
    expect(read('js/site-shell.js')).toContain('AdminAccess.updateNavLinks');
    expect(read('js/site-shell.js')).toContain('DetailDesignAccess.updateNavVisibility');
  });
});
