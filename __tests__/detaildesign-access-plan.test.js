/**
 * D6 (2026-10-18): 상세설계는 구독 플랜 기준으로 연다.
 *
 *   관리자 → 언제나 열림
 *   profiles.tier 가 POLICY.minTier 이상 → 열림
 *   본사 승인(profiles.detaildesign_approved) → POLICY.approvedBypassesPlan 이면 플랜과 상관없이 열림 (파트너)
 *   그 밖 → 막힘. 조회 실패·모르는 등급도 막힘 (fail-closed)
 *
 * 차단 게이트는 두 곳 (detaildesign.html 상단 가드 · persistence-init.js loadUserProfile).
 * 전에는 상단 가드가 `return;` 한 줄로 꺼져 있었다.
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
  };
  win.window = win;
  loadModule(ADMIN, win);
  loadModule(DD, win);
  return win;
}

/** 관리자 아님 + profiles 행을 돌려주는 가짜 클라이언트 */
function profileClient(row, error = null) {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    rpc: async () => ({ data: false, error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: row, error }) }) }),
    }),
  };
}

describe('정책은 한 곳 — POLICY', () => {
  test('최소 등급과 승인 우회가 POLICY 에 있다', () => {
    const { POLICY } = makeWindow().DetailDesignAccess;
    // 2026-10-19 사장님: 모든 회원 (standard 는 무료 가입 등급)
    expect(POLICY.minTier).toBe('standard');
    expect(POLICY.approvedBypassesPlan).toBe(true);
    expect(Object.isFrozen(POLICY)).toBe(true);
  });
});

describe('decide — 판정표', () => {
  const { decide } = makeWindow().DetailDesignAccess;
  test.each([
    [{ isAdmin: true, tier: 'standard', approved: false }, true, 'admin'],
    [{ tier: 'agent', approved: false }, true, 'plan'],
    [{ tier: 'expert', approved: false }, true, 'plan'],
    [{ tier: 'standard', approved: false }, true, 'plan'],
    [{ tier: null, approved: true }, true, 'approved'],
    [{ tier: 'business', approved: false }, false, 'plan_required'], // 옛 등급 이름은 모른다
    [{ tier: null, approved: false }, false, 'plan_required'],
    [{}, false, 'plan_required'],
  ])('%j → %s', (input, allowed, reason) => {
    expect(decide(input)).toEqual({ allowed, reason });
  });
});

describe('fetchStatus — profiles.tier 를 본다', () => {
  test('expert 구독자는 열린다', async () => {
    const win = makeWindow();
    const r = await win.DetailDesignAccess.fetchStatus(
      profileClient({ tier: 'expert', detaildesign_approved: false, detaildesign_requested_at: null }),
      'u1'
    );
    expect(r).toMatchObject({ approved: true, reason: 'plan', tier: 'expert' });
  });

  test('standard(무료) 회원도 승인 없이 열린다', async () => {
    const win = makeWindow();
    const r = await win.DetailDesignAccess.fetchStatus(
      profileClient({ tier: 'standard', detaildesign_approved: false, detaildesign_requested_at: null }),
      'u1'
    );
    expect(r).toMatchObject({ approved: true, reason: 'plan', tier: 'standard' });
  });

  test('등급이 없는 프로필은 막히고, 본사 승인이면 열린다', async () => {
    const win = makeWindow();
    const blocked = await win.DetailDesignAccess.fetchStatus(
      profileClient({ tier: null, detaildesign_approved: false, detaildesign_requested_at: '2026-10-01' }),
      'u1'
    );
    expect(blocked).toMatchObject({ approved: false, reason: 'plan_required', requestedAt: '2026-10-01' });
    const win2 = makeWindow();
    const opened = await win2.DetailDesignAccess.fetchStatus(
      profileClient({ tier: null, detaildesign_approved: true, detaildesign_requested_at: null }),
      'u1'
    );
    expect(opened).toMatchObject({ approved: true, reason: 'approved' });
  });

  test('profiles 조회 실패는 막힌다', async () => {
    const win = makeWindow();
    const r = await win.DetailDesignAccess.fetchStatus(profileClient(null, { message: 'x' }), 'u1');
    expect(r.approved).toBe(false);
  });

  test('tier 를 조회한다', () => {
    expect(DD).toMatch(/\.select\('tier, detaildesign_approved, detaildesign_requested_at'\)/);
  });
});

describe('차단 게이트 두 곳이 같은 decide 를 쓴다', () => {
  test('detaildesign.html — 상단 가드가 꺼져 있지 않다', () => {
    const html = read('detaildesign.html');
    const guard = html.slice(
      html.indexOf('enforceDetailDesignAccess'),
      html.indexOf('function showDetailDesignBlocked')
    );
    // 관리자 return 뒤에 맨 return 이 다시 나오면 가드가 꺼진 것이다
    const afterAdmin = guard.slice(guard.indexOf('if (isAdmin) return;') + 'if (isAdmin) return;'.length);
    expect(afterAdmin).not.toMatch(/^\s*return;/m);
    expect(afterAdmin).toContain('DetailDesignAccess.fetchStatus(client, user.id)');
    expect(afterAdmin).toContain('showDetailDesignBlocked(status)');
  });

  test('persistence-init.js — decide 로 판정하고 metadata 의 tier 는 믿지 않는다', () => {
    const js = read('js/detaildesign/persistence-init.js');
    expect(js).toContain('window.DetailDesignAccess.decide({');
    expect(js).toMatch(/tier: profileFromDb \? userProfile\.tier : null/);
    expect(js).not.toMatch(/const approved = Boolean\(userProfile\?\.detaildesign_approved\)/);
  });
});
