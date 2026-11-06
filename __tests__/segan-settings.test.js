/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, afterEach, __dirname, document, window, DOMParser, sessionStorage, jest, setTimeout */
/**
 * SEGAN 「설정」 화면 (segan/settings.html + segan/settings.js) — 사이트 mypage.html 의
 * 계정 정보 · 프로필 수정 · 회원탈퇴를 그대로 옮겼다. 정본은 mypage.html 이다:
 *   - 계정 정보   user_metadata 이름(name · full_name · 이메일 앞부분) · 연락처 · 거주지역 · 가입일, 없으면 「미등록」
 *   - 프로필 수정 이름 필수 · auth.updateUser({ data }) + profiles 같은 값, 지역 목록 = mypage.html gugunData
 *   - 회원탈퇴    지우는 것 · 남는 것 안내 = mypage.html, 확인 문구 = WITHDRAW_WORD,
 *                 account-api POST /delete (본인 토큰, 본문 없음) → 로그아웃 · 앱 첫 화면
 *   - 내 정보 탭을 켜고, 로그인 안내는 이 화면으로 돌아온다
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MYPAGE = read('mypage.html');
const ACCOUNT = 'https://account.example.workers.dev';
const USER = {
  id: 'user-1',
  email: 'customer@example.com',
  created_at: '2026-10-05T03:00:00Z',
  user_metadata: { name: '김고객', phone: '010-1234-5678', sido: '대구광역시', gugun: '북구' },
};
const session = (user = USER) => ({ access_token: 'tok-1', user });

const tick = () => new Promise((r) => setTimeout(r, 0));

async function load(options = {}) {
  const opts = {
    session: session(),
    accountUrl: ACCOUNT,
    updateError: null,
    profilesThrow: false,
    deleteRes: { ok: true, status: 200, body: { success: true } },
    deleteFail: false,
    afterUpdateUser: null, // updateUser 뒤 getSession 이 줄 계정
    ...options,
  };
  const doc = new DOMParser().parseFromString(read('segan/settings.html'), 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  for (const a of [...document.body.attributes]) document.body.removeAttribute(a.name);
  for (const a of [...doc.body.attributes]) document.body.setAttribute(a.name, a.value);
  sessionStorage.clear();
  for (const k of ['AdminAccess', 'DadamMyPageWork', 'SeganShell', 'SeganRegions', 'SeganSettings'])
    delete window[k];
  window.DADAM_CONFIG = {
    supabase: { url: 'https://example.supabase.co', anonKey: 'anon' },
    accountApi: opts.accountUrl ? { url: opts.accountUrl } : undefined,
  };
  const calls = { updateUser: [], profiles: [], signOut: 0, fetch: [], go: [] };
  let current = opts.session;
  window.supabase = {
    createClient: () => ({
      auth: {
        getSession: async () => ({ data: { session: current } }),
        updateUser: async (attrs) => {
          calls.updateUser.push(attrs);
          if (opts.updateError) return { data: null, error: opts.updateError };
          if (opts.afterUpdateUser) current = session(opts.afterUpdateUser);
          return { data: { user: current && current.user }, error: null };
        },
        signOut: async () => {
          calls.signOut += 1;
          current = null;
          return { error: null };
        },
      },
      rpc: async () => ({ data: false, error: null }),
      from: (table) => {
        const q = { table };
        const chain = {
          select: () => chain,
          update: (row) => {
            if (opts.profilesThrow) throw new Error('profiles 없음');
            q.update = row;
            return chain;
          },
          eq: async (c, v) => {
            q.eq = [c, v];
            calls.profiles.push(q);
            return { data: null, error: null };
          },
          maybeSingle: async () => ({ data: null, error: null }),
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
      body: init.body,
    });
    if (url === ACCOUNT + '/delete') {
      if (opts.deleteFail) throw new TypeError('Failed to fetch');
      const r = opts.deleteRes;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    return { ok: false, status: 404, json: async () => ({ success: false }) };
  });
  const scripts = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src'));
  for (const src of scripts) {
    if (!src.startsWith('../js/') || src.startsWith('../js/config.js')) continue;
    (0, eval)(read(src.slice(3).split('?')[0]));
  }
  for (const f of ['segan/shell.js', 'segan/regions.js', 'segan/settings.js']) (0, eval)(read(f));
  window.SeganSettings.go = (url) => calls.go.push(url);
  await window.SeganShell.ready;
  await window.SeganSettings.ready;
  return calls;
}

const $ = (id) => document.getElementById(id);
const texts = (sel) =>
  [...document.querySelectorAll(sel)].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
const setVal = (id, v) => {
  $(id).value = v;
  $(id).dispatchEvent(new window.Event('input', { bubbles: true }));
};
const choose = (id, v) => {
  $(id).value = v;
  $(id).dispatchEvent(new window.Event('change', { bubbles: true }));
};
const submitEdit = async () => {
  $('stEditForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick();
  await tick();
};

/** mypage.html 의 <ul class="withdraw-list…"> 안 글 (정본) */
function mypageList(re) {
  const from = MYPAGE.search(re);
  expect(from).toBeGreaterThan(-1);
  const list = MYPAGE.slice(from, from + MYPAGE.slice(from).search(/<\/ul>/));
  return [...list.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
}

afterEach(() => jest.restoreAllMocks());

describe('화면 — 내 정보 탭 안', () => {
  test('내 정보 탭이 켜지고 · noindex · 서비스 워커가 담는다', async () => {
    await load();
    expect(document.body.getAttribute('data-tab')).toBe('me');
    expect(
      document.querySelector('nav.sg-tabbar a[aria-current="page"]').getAttribute('data-tab-link')
    ).toBe('me');
    expect(read('segan/settings.html')).toContain(
      '<meta name="robots" content="noindex,nofollow" />'
    );
    const sw = read('segan/sw.js');
    expect(sw).toContain("SCOPE + 'settings.html'");
    expect(sw).toContain("versioned(SCOPE + 'settings.js')");
    expect(document.querySelector('a.mk-back').getAttribute('href')).toBe('me.html');
  });

  test('로그인 없으면 아무것도 읽지 않고, 로그인 안내는 이 화면으로 돌아온다', async () => {
    const calls = await load({ session: null });
    expect(document.querySelector('[data-auth-view="signed-out"]').hidden).toBe(false);
    expect(document.querySelector('[data-auth-view="signed-in"]').hidden).toBe(true);
    const a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
    expect(a.getAttribute('href')).toBe(
      '../login.html?redirect=' + encodeURIComponent('segan/settings.html')
    );
    // js/auth-redirect.js 가 받는 주소다
    const AuthRedirect = require('../js/auth-redirect.js');
    expect(AuthRedirect.sanitize('segan/settings.html')).toBe('segan/settings.html');
    expect(calls.fetch.some((f) => f.url.startsWith(ACCOUNT))).toBe(false);
    expect(calls.updateUser).toEqual([]);
  });
});

describe('계정 정보 — mypage.html 「계정 정보」와 같은 출처 · 같은 빈 값', () => {
  test('이름 · 이메일 · 연락처 · 거주지역 · 가입일', async () => {
    await load();
    expect($('stName').textContent).toBe('김고객');
    expect($('stEmail').textContent).toBe('customer@example.com');
    expect($('stPhone').textContent).toBe('010-1234-5678');
    expect($('stPlace').textContent).toBe('대구광역시 북구');
    expect($('stJoined').textContent).toBe(
      new Date(USER.created_at).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    );
  });

  test.each([
    [{ full_name: '구글 이름' }, '구글 이름', '미등록', '미등록'],
    [{}, 'customer', '미등록', '미등록'],
    [{ name: '이름', sido: '서울특별시' }, '이름', '미등록', '서울특별시'],
  ])('메타 %j → 이름 %s · 연락처 %s · 지역 %s', async (meta, name, phone, place) => {
    await load({ session: session({ ...USER, user_metadata: meta }) });
    expect($('stName').textContent).toBe(name);
    expect($('stPhone').textContent).toBe(phone);
    expect($('stPlace').textContent).toBe(place);
  });

  test('글은 글자로만 넣는다', async () => {
    const bad = '<img src=x onerror=alert(1)>';
    await load({ session: session({ ...USER, user_metadata: { name: bad, phone: bad } }) });
    expect(document.querySelector('main img')).toBeNull();
    expect($('stName').textContent).toBe(bad);
  });
});

describe('프로필 수정 — mypage.html submitEditProfile', () => {
  test('지역 목록 = mypage.html gugunData (시/도 차례 · 시/군/구)', async () => {
    await load();
    const m = MYPAGE.match(/const gugunData = (\{[\s\S]*?\n {6}\});/);
    const gugunData = Function(`return ${m[1]}`)();
    expect(window.SeganRegions).toEqual(gugunData);
    $('stEditOpen').click();
    expect([...$('stEditSido').options].map((o) => o.value)).toEqual([
      '',
      ...Object.keys(gugunData),
    ]);
    // mypage.html 프로필 수정 시/도 목록과도 같다
    const sidoBlock = MYPAGE.slice(MYPAGE.indexOf('<select id="editSido"'));
    const sidoHtml = sidoBlock.slice(0, sidoBlock.indexOf('</select>'));
    expect([...sidoHtml.matchAll(/<option value="([^"]*)">/g)].map((x) => x[1])).toEqual([
      '',
      ...Object.keys(gugunData),
    ]);
    choose('stEditSido', '경기도');
    expect([...$('stEditGugun').options].map((o) => o.value)).toEqual(['', ...gugunData['경기도']]);
    choose('stEditSido', '');
    expect(texts('#stEditGugun option')).toEqual(['시/도를 먼저 선택하세요']);
  });

  test('열면 지금 값이 채워진다', async () => {
    await load();
    expect($('stEditForm').hidden).toBe(true);
    $('stEditOpen').click();
    expect($('stEditForm').hidden).toBe(false);
    expect($('stEditName').value).toBe('김고객');
    expect($('stEditPhone').value).toBe('010-1234-5678');
    expect($('stEditSido').value).toBe('대구광역시');
    expect($('stEditGugun').value).toBe('북구');
    $('stEditCancel').click();
    expect($('stEditForm').hidden).toBe(true);
  });

  test('이름이 비면 막는다 (mypage.html 과 같은 글)', async () => {
    const calls = await load();
    $('stEditOpen').click();
    setVal('stEditName', '   ');
    await submitEdit();
    expect($('stEditError').hidden).toBe(false);
    expect($('stEditError').textContent).toBe('이름을 입력해주세요.');
    expect(calls.updateUser).toEqual([]);
  });

  test('저장 — auth.updateUser({ data }) 뒤 profiles 도 같은 값, 화면을 고친다', async () => {
    const calls = await load({
      afterUpdateUser: {
        ...USER,
        user_metadata: { name: '새 이름', phone: '', sido: '경기도', gugun: '수원시' },
      },
    });
    $('stEditOpen').click();
    setVal('stEditName', ' 새 이름 ');
    setVal('stEditPhone', '');
    choose('stEditSido', '경기도');
    choose('stEditGugun', '수원시');
    await submitEdit();
    expect(calls.updateUser).toEqual([
      { data: { name: '새 이름', phone: '', sido: '경기도', gugun: '수원시' } },
    ]);
    expect(calls.profiles).toHaveLength(1);
    const p = calls.profiles[0];
    expect(p.table).toBe('profiles');
    expect(p.eq).toEqual(['id', 'user-1']);
    expect(Object.keys(p.update).sort()).toEqual(['gugun', 'name', 'phone', 'sido', 'updated_at']);
    expect(p.update).toMatchObject({ name: '새 이름', phone: '', sido: '경기도', gugun: '수원시' });
    expect($('stEditForm').hidden).toBe(true);
    expect($('stEditDone').hidden).toBe(false);
    expect($('stEditDone').textContent).toBe('프로필이 수정되었습니다.');
    expect($('stName').textContent).toBe('새 이름');
    expect($('stPhone').textContent).toBe('미등록');
    expect($('stPlace').textContent).toBe('경기도 수원시');
    // 다시 열면 바뀐 계정 값
    $('stEditOpen').click();
    expect($('stEditName').value).toBe('새 이름');
    expect($('stEditGugun').value).toBe('수원시');
  });

  test('profiles 를 못 고쳐도 저장은 된다 (mypage.html 처럼 넘긴다)', async () => {
    const calls = await load({ profilesThrow: true });
    $('stEditOpen').click();
    await submitEdit();
    expect(calls.updateUser).toHaveLength(1);
    expect($('stEditDone').hidden).toBe(false);
    expect($('stEditError').hidden).toBe(true);
  });

  test('계정 저장이 실패하면 그 글을 칸 아래에, 화면은 그대로', async () => {
    await load({ updateError: { message: '네트워크 오류' } });
    $('stEditOpen').click();
    setVal('stEditName', '다른 이름');
    await submitEdit();
    expect($('stEditError').textContent).toBe('프로필 수정 중 오류가 발생했습니다: 네트워크 오류');
    expect($('stEditForm').hidden).toBe(false);
    expect($('stName').textContent).toBe('김고객');
    expect($('stEditSave').disabled).toBe(false);
  });
});

describe('회원탈퇴 — mypage.html submitWithdraw', () => {
  const open = () => $('stWithdrawOpen').click();
  const press = async () => {
    $('stWithdrawBtn').click();
    await tick();
    await tick();
    await tick();
  };

  test('지우는 것 · 남는 것 · 확인 문구 = mypage.html', async () => {
    await load();
    expect(texts('#stWithdrawGone li')).toEqual(mypageList(/<ul class="withdraw-list">/));
    expect(texts('#stWithdrawKeep li')).toEqual(
      mypageList(/<ul class="withdraw-list" id="withdrawKeep">/)
    );
    const word = MYPAGE.match(/const WITHDRAW_WORD = '([^']+)';/)[1];
    expect(window.SeganSettings.WITHDRAW_WORD).toBe(word);
    expect($('stWithdrawWord').textContent).toBe(word);
  });

  test('확인 문구를 그대로 적어야 단추가 열린다', async () => {
    await load();
    expect($('stWithdraw').hidden).toBe(true);
    open();
    expect($('stWithdraw').hidden).toBe(false);
    expect($('stWithdrawBtn').disabled).toBe(true);
    setVal('stWithdrawInput', '탈퇴');
    expect($('stWithdrawBtn').disabled).toBe(true);
    setVal('stWithdrawInput', ' 탈퇴합니다 ');
    expect($('stWithdrawBtn').disabled).toBe(false);
    $('stWithdrawCancel').click();
    expect($('stWithdraw').hidden).toBe(true);
    open();
    expect($('stWithdrawInput').value).toBe('');
    expect($('stWithdrawBtn').disabled).toBe(true);
  });

  test('영구 삭제 — account-api POST /delete (본인 토큰 · 대상 id 없음) → 로그아웃 · 앱 첫 화면', async () => {
    const calls = await load();
    sessionStorage.setItem('segan.assistant.on.user-1', String(Date.now()));
    open();
    setVal('stWithdrawInput', '탈퇴합니다');
    await press();
    const del = calls.fetch.filter((f) => f.url === ACCOUNT + '/delete');
    expect(del).toEqual([
      { url: ACCOUNT + '/delete', method: 'POST', auth: 'Bearer tok-1', body: undefined },
    ]);
    expect(calls.signOut).toBe(1);
    expect(calls.go).toEqual(['./']);
    expect(sessionStorage.getItem('segan.assistant.on.user-1')).toBeNull();
  });

  test.each([
    [
      '서버가 거절',
      {
        deleteRes: {
          ok: false,
          status: 401,
          body: { success: false, error: '로그인이 필요합니다' },
        },
      },
      '로그인이 필요합니다',
    ],
    [
      '본문 없음',
      { deleteRes: { ok: false, status: 500, body: null } },
      '탈퇴 처리에 실패했습니다.',
    ],
    ['주소 없음', { accountUrl: '' }, '탈퇴 기능을 사용할 수 없습니다.'],
  ])('실패 — %s: 글을 보이고 단추를 다시 연다, 로그아웃하지 않는다', async (_n, extra, msg) => {
    const calls = await load(extra);
    open();
    setVal('stWithdrawInput', '탈퇴합니다');
    await press();
    expect($('stWithdrawStatus').hidden).toBe(false);
    expect($('stWithdrawStatus').textContent).toBe(msg);
    expect($('stWithdrawBtn').disabled).toBe(false);
    expect(calls.signOut).toBe(0);
    expect(calls.go).toEqual([]);
  });

  test('세션이 끝났으면 다시 로그인하라고 한다', async () => {
    const calls = await load();
    open();
    setVal('stWithdrawInput', '탈퇴합니다');
    // 화면을 연 뒤 세션이 끝남
    window.SeganSettings.state.sb.auth.getSession = async () => ({ data: { session: null } });
    await press();
    expect($('stWithdrawStatus').textContent).toBe(
      '로그인이 만료되었습니다. 다시 로그인해 주세요.'
    );
    expect(calls.fetch.some((f) => f.url === ACCOUNT + '/delete')).toBe(false);
  });
});
