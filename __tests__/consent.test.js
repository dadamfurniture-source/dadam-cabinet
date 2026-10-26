/**
 * 동의 기록 — 이용약관 · 개인정보처리방침 · 만 14세 이상 · 마케팅 수신 · 상담 신청 개인정보 수집.
 *
 *   - js/consent.js          가입 메타데이터 → profiles 옮기기 · 마이페이지 마케팅 켜기·끄기 값
 *   - database/consents.sql  더하기만 하는 SQL (빈 값 허용 시각 칸) — DB 없이 소스 글자로 고정한다
 *   - consultation.html      개인정보 수집·이용 동의 칸 + 동의 시각 저장
 *   - mypage.html            마케팅 수신 동의 켜기·끄기
 *   - js/site-shell.js       인증 메일로 돌아온 공용 셸 페이지에서도 옮긴다
 * 가입·로그인 화면 동작은 auth-redirect.test.js 가 페이지를 jsdom 에 올려 본다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');

const C = require('../js/consent.js');

const T = '2026-10-26T01:02:03.000Z';

describe('js/consent.js — 값', () => {
  test('signupMetadata: 필수 셋은 같은 시각, 마케팅은 고른 때만', () => {
    expect(C.signupMetadata(T, true)).toEqual({
      terms_agreed_at: T,
      privacy_agreed_at: T,
      age_confirmed_at: T,
      marketing_agreed_at: T,
      marketing_agreed: true,
    });
    expect(C.signupMetadata(T, false)).toMatchObject({
      marketing_agreed_at: null,
      marketing_agreed: false,
    });
  });

  test('patchFromMetadata: 약관 동의 시각이 없으면 null (소셜 가입 · 예전 가입)', () => {
    expect(C.patchFromMetadata(null)).toBeNull();
    expect(C.patchFromMetadata({})).toBeNull();
    expect(C.patchFromMetadata({ marketing_agreed: true })).toBeNull();
    expect(C.patchFromMetadata({ terms_agreed_at: 'not-a-date' })).toBeNull();
  });

  test('patchFromMetadata: profiles 칸 이름 그대로, 시각만 옮긴다 (marketing_agreed·이름 등은 빼고)', () => {
    const meta = { name: '테스트', marketing_agreed: true, ...C.signupMetadata(T, true) };
    expect(C.patchFromMetadata(meta)).toEqual({
      terms_agreed_at: T,
      privacy_agreed_at: T,
      age_confirmed_at: T,
      marketing_agreed_at: T,
    });
    // 마케팅을 고르지 않았으면 그 칸은 쓰지 않는다 (NULL 그대로)
    expect(C.patchFromMetadata(C.signupMetadata(T, false))).not.toHaveProperty(
      'marketing_agreed_at'
    );
  });

  test('marketingPatch: 켜면 동의 시각 + 철회 시각 지움, 끄면 반대', () => {
    expect(C.marketingPatch(true, T)).toEqual({
      marketing_agreed_at: T,
      marketing_withdrawn_at: null,
    });
    expect(C.marketingPatch(false, T)).toEqual({
      marketing_agreed_at: null,
      marketing_withdrawn_at: T,
    });
  });
});

describe('js/consent.js — syncSignup', () => {
  /** from('profiles').update(v).eq(…).is(…) 를 받아 적는 가짜 */
  function fakeSb(result = { error: null }) {
    const calls = [];
    return {
      calls,
      from: (table) => ({
        update: (patch) => {
          const q = { table, patch, filters: [] };
          calls.push(q);
          const chain = {
            eq: (c, v) => (q.filters.push(['eq', c, v]), chain),
            is: (c, v) => (q.filters.push(['is', c, v]), chain),
            then: (ok, bad) => Promise.resolve(result).then(ok, bad),
          };
          return chain;
        },
      }),
    };
  }
  const user = (meta) => ({ id: 'u-1', user_metadata: meta });

  beforeEach(() => window.localStorage.clear());

  test('본인 행, 아직 옮기지 않은 행(terms_agreed_at IS NULL)만 — 한 번 옮기면 이 브라우저에서는 다시 안 쓴다', async () => {
    const sb = fakeSb();
    await expect(C.syncSignup(sb, user(C.signupMetadata(T, false)))).resolves.toBe(true);
    expect(sb.calls).toEqual([
      {
        table: 'profiles',
        patch: { terms_agreed_at: T, privacy_agreed_at: T, age_confirmed_at: T },
        filters: [
          ['eq', 'id', 'u-1'],
          ['is', 'terms_agreed_at', null],
        ],
      },
    ]);
    await expect(C.syncSignup(sb, user(C.signupMetadata(T, false)))).resolves.toBe(true);
    expect(sb.calls).toHaveLength(1);
  });

  test('가입 동의가 없으면 쓰지 않는다', async () => {
    const sb = fakeSb();
    await expect(C.syncSignup(sb, user({ full_name: '소셜' }))).resolves.toBe(false);
    await expect(C.syncSignup(sb, null)).resolves.toBe(false);
    expect(sb.calls).toHaveLength(0);
  });

  test('쓰기가 실패하면 false — 표시를 남기지 않아 다음에 다시 옮긴다 (예: SQL 적용 전)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = fakeSb({ error: { message: 'column "terms_agreed_at" does not exist' } });
    await expect(C.syncSignup(bad, user(C.signupMetadata(T, false)))).resolves.toBe(false);
    const ok = fakeSb();
    await expect(C.syncSignup(ok, user(C.signupMetadata(T, false)))).resolves.toBe(true);
    expect(ok.calls).toHaveLength(1);
    console.warn.mockRestore();
  });
});

describe('database/consents.sql — 더하기만', () => {
  const SQL = read('database/consents.sql');
  const body = SQL.replace(/--[^\n]*/g, '');
  const statements = body
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  test('문장은 ALTER TABLE … ADD COLUMN IF NOT EXISTS 와 COMMENT ON COLUMN 뿐', () => {
    for (const s of statements) {
      expect(s).toMatch(
        /^(ALTER TABLE public\.(profiles|consultations)\s+ADD COLUMN IF NOT EXISTS|COMMENT ON COLUMN)/
      );
    }
    expect(body).not.toMatch(
      /\b(DROP|DELETE|TRUNCATE|UPDATE|INSERT|RENAME|CREATE|GRANT|REVOKE|POLICY|TRIGGER)\b/i
    );
    expect(body).not.toMatch(/\bALTER\s+COLUMN\b/i);
  });

  test('profiles 에 시각 칸 다섯, consultations 에 하나 — 모두 빈 값 허용(TIMESTAMPTZ, NOT NULL·DEFAULT 없음)', () => {
    const added = [...body.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)\s+([^,;\n]+)/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]);
    expect(added).toEqual([
      ['terms_agreed_at', 'TIMESTAMPTZ'],
      ['privacy_agreed_at', 'TIMESTAMPTZ'],
      ['age_confirmed_at', 'TIMESTAMPTZ'],
      ['marketing_agreed_at', 'TIMESTAMPTZ'],
      ['marketing_withdrawn_at', 'TIMESTAMPTZ'],
      ['privacy_agreed_at', 'TIMESTAMPTZ'],
    ]);
    expect(body).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  test('화면이 쓰는 칸 이름이 SQL 과 같다', () => {
    for (const f of [...C.SIGNUP_FIELDS, 'marketing_withdrawn_at']) {
      expect(body).toMatch(new RegExp('ADD COLUMN IF NOT EXISTS\\s+' + f + '\\b'));
    }
  });
});

describe('consultation.html — 개인정보 수집·이용 동의', () => {
  const html = read('consultation.html');

  test('필수 동의 칸과 처리방침 링크가 신청 버튼 앞에 있다', () => {
    const box = html.indexOf('id="agreePrivacy"');
    expect(box).toBeGreaterThan(0);
    expect(box).toBeLessThan(html.indexOf('id="submitBtn"'));
    expect(html).toMatch(/<input type="checkbox" id="agreePrivacy" required \/>/);
    expect(html).toMatch(
      /<a href="privacy\.html" target="_blank" rel="noopener">개인정보처리방침<\/a>/
    );
  });

  test('알림 내용은 처리방침의 상담 신청 줄과 같다 (항목 · 보유 기간)', () => {
    expect(html).toContain('<dd>이름, 전화번호, 이메일, 상담 제목</dd>');
    expect(html).toContain('<dd>상담 내용, 가구 종류, 공간, 치수, 예산, 스타일, 희망 일시</dd>');
    expect(html).toContain('<dd>상담이 끝난 뒤 3년</dd>');
  });

  test('동의하지 않으면 넣지 않고, 넣을 때 동의 시각을 함께 저장한다', () => {
    const fn = html.slice(html.indexOf('async function submitConsultation'));
    const check = fn.indexOf("getElementById('agreePrivacy').checked");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(fn.indexOf(".from('consultations').insert("));
    expect(fn).toMatch(/privacy_agreed_at: new Date\(\)\.toISOString\(\)/);
  });
});

describe('mypage.html — 마케팅 수신 동의', () => {
  const html = read('mypage.html');

  test('계정 정보에 켜기·끄기가 있고 js/consent.js 를 싣는다', () => {
    expect(html).toMatch(/<script src="js\/consent\.js"><\/script>/);
    expect(html).toMatch(/id="marketingToggle"/);
    expect(html).toMatch(/onchange="toggleMarketing\(\)"/);
  });

  test('본인 행의 동의·철회 시각을 읽고, 바꿀 때 marketingPatch 로 쓴다', () => {
    expect(html).toMatch(
      /\.select\('marketing_agreed_at, marketing_withdrawn_at'\)\s*\.eq\('id', currentUser\.id\)/
    );
    expect(html).toMatch(
      /window\.DadamConsent\.marketingPatch\(agree, new Date\(\)\.toISOString\(\)\)/
    );
    expect(html).toMatch(/\.update\(patch\)\s*\.eq\('id', currentUser\.id\)/);
  });
});

describe('js/site-shell.js — 로그인한 셸 페이지마다 동의 확인', () => {
  const src = read('js/site-shell.js');

  test('세션이 있으면 js/consent.js 를 불러와 gate.start — 상세설계 페이지는 required', () => {
    expect(src).toMatch(/bindAccountMenu\(\);\n\s*startConsentGate\(sb, session\);/);
    const fn = src.slice(src.indexOf('function startConsentGate'));
    expect(fn).toMatch(/s\.src = 'js\/consent\.js';/);
    expect(fn).toMatch(/\.start\(sb, session, \{ required: currentNav === 'detail' \}\)/);
  });

  test('상세설계 페이지는 새 셸을 받도록 버전을 올렸다', () => {
    expect(read('detaildesign.html')).toMatch(
      /<script src="js\/site-shell\.js\?v=38\.7" defer><\/script>/
    );
  });
});

describe('동의 창이 막는 서비스 동작 — 가리키는 요소가 실제로 있다', () => {
  test.each([
    ['#runBtn', 'ai-design.html', 'id="runBtn"'],
    ['#toPlanner', 'ai-design.html', 'id="toPlanner"'],
    ['[data-act="regen"]', 'my-designs.html', 'data-act="regen"'],
    ['[data-act="planner"]', 'my-designs.html', 'data-act="planner"'],
    ['#navDetailDesign', 'js/site-shell.js', 'id="navDetailDesign"'],
    ['a[href^="detaildesign.html"]', 'js/site-shell.js', 'href="detaildesign.html"'],
  ])('%s → %s', (sel, file, needle) => {
    expect(C.gate.SERVICE_SELECTORS).toContain(sel);
    expect(read(file)).toContain(needle);
  });

  test('목록에는 이 여섯 가지뿐 (연출컷 시작 · 상세설계 열기 — 상담 신청은 consultation.html 이 직접 막는다)', () => {
    expect(C.gate.SERVICE_SELECTORS).toHaveLength(6);
  });
});

// ── 동의 창 (jsdom) ─────────────────────────────────────────────────

describe('동의 창 — 동의 기록이 없는 회원', () => {
  const USER = {
    id: 'u-9',
    last_sign_in_at: '2026-10-26T09:00:00Z',
    user_metadata: { full_name: '소셜' },
  };

  /**
   * 가짜 Supabase. profiles 의 terms_agreed_at 을 들고 있고, update 를 받아 적는다.
   * row === 'error' 이면 select 가 오류(칸 없음)를 낸다.
   */
  function fakeSb({ row = { terms_agreed_at: null }, updateError = null } = {}) {
    const calls = { update: [], signOut: 0 };
    const sb = {
      calls,
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              row === 'error'
                ? {
                    data: null,
                    error: { message: 'column profiles.terms_agreed_at does not exist' },
                  }
                : { data: row, error: null },
          }),
        }),
        update: (patch) => {
          const q = { patch, filters: [] };
          calls.update.push(q);
          const chain = {
            eq: (c, v) => (q.filters.push(['eq', c, v]), chain),
            is: (c, v) => (q.filters.push(['is', c, v]), chain),
            then: (ok, bad) => Promise.resolve({ error: updateError }).then(ok, bad),
          };
          return chain;
        },
      }),
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'tok-9', user: USER } } }),
        signOut: async () => {
          calls.signOut++;
          return { error: null };
        },
      },
    };
    return sb;
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));
  const $ = (sel) => document.querySelector('.dc-backdrop ' + sel);
  const dialogOpen = () => {
    const el = document.querySelector('.dc-backdrop');
    return Boolean(el && !el.hidden);
  };
  const check = (...keys) => {
    for (const k of keys) {
      const box = $('[data-k="' + k + '"]');
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  let went;

  beforeEach(() => {
    window.localStorage.clear();
    C.gate._reset();
    went = [];
    C.gate.navigate = (url) => went.push(url);
    document.body.innerHTML =
      '<button type="button" id="runBtn">연출컷 생성</button>' +
      '<a href="detaildesign.html" id="navDetailDesign">DETAIL DESIGN</a>' +
      '<a href="collection.html" id="browse">COLLECTION</a>';
    window.DADAM_CONFIG = { accountApi: { url: 'https://account.test' } };
  });
  afterEach(() => {
    delete global.fetch;
  });

  test('로그인한 뒤 보던 페이지 위에 한 번 뜬다 — 같은 로그인에서는 페이지를 옮겨도 저절로는 다시 안 뜬다', async () => {
    await expect(C.gate.start(fakeSb(), { user: USER })).resolves.toBe('needed');
    expect(dialogOpen()).toBe(true);
    expect($('[role="dialog"]').getAttribute('aria-modal')).toBe('true');

    // 다른 페이지 (새로 그린 창)
    C.gate._reset();
    await C.gate.start(fakeSb(), { user: USER });
    expect(dialogOpen()).toBe(false);

    // 다시 로그인하면 또 뜬다
    C.gate._reset();
    await C.gate.start(fakeSb(), { user: { ...USER, last_sign_in_at: '2026-10-27T09:00:00Z' } });
    expect(dialogOpen()).toBe(true);
  });

  test('필수 셋(만 14세 · 이용약관 · 개인정보처리방침)이 모두 체크돼야 「동의하고 계속」이 눌린다. 약관 링크는 새 탭', async () => {
    await C.gate.start(fakeSb(), { user: USER });
    const agree = $('[data-act="agree"]');
    expect(agree.disabled).toBe(true);
    check('age', 'terms');
    expect(agree.disabled).toBe(true);
    check('privacy');
    expect(agree.disabled).toBe(false);
    const links = [...document.querySelectorAll('.dc-backdrop a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['terms.html', 'privacy.html']);
    for (const a of links) expect(a.getAttribute('target')).toBe('_blank');
  });

  test('닫으면 둘러보기는 그대로, 서비스 동작(연출컷 생성)을 누르면 다시 뜬다 — 동의하면 그 동작을 이어서 한다', async () => {
    const sb = fakeSb();
    let ran = 0;
    document.getElementById('runBtn').onclick = () => ran++;
    await C.gate.start(sb, { user: USER });
    $('[data-act="close"]').click();
    expect(dialogOpen()).toBe(false);

    // 둘러보기 링크는 막지 않는다
    const browse = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.getElementById('browse').dispatchEvent(browse);
    expect(browse.defaultPrevented).toBe(false);
    expect(dialogOpen()).toBe(false);

    document.getElementById('runBtn').click();
    expect(ran).toBe(0);
    expect(dialogOpen()).toBe(true);

    check('age', 'terms', 'privacy', 'marketing');
    $('[data-act="agree"]').click();
    await flush();
    expect(sb.calls.update).toHaveLength(1);
    const { patch, filters } = sb.calls.update[0];
    expect(Object.keys(patch).sort()).toEqual(
      ['age_confirmed_at', 'marketing_agreed_at', 'privacy_agreed_at', 'terms_agreed_at'].sort()
    );
    expect(new Set(Object.values(patch)).size).toBe(1); // 같은 시각
    expect(filters).toEqual([
      ['eq', 'id', 'u-9'],
      ['is', 'terms_agreed_at', null],
    ]);
    expect(dialogOpen()).toBe(false);
    expect(ran).toBe(1); // 이어서 연출컷 생성
    expect(C.gate.state).toBe('ok');

    // 동의한 뒤에는 막지 않는다
    document.getElementById('runBtn').click();
    expect(ran).toBe(2);
  });

  test('마케팅을 고르지 않으면 marketing_agreed_at 은 쓰지 않는다', async () => {
    const sb = fakeSb();
    await C.gate.start(sb, { user: USER });
    check('age', 'terms', 'privacy');
    $('[data-act="agree"]').click();
    await flush();
    expect(sb.calls.update[0].patch).not.toHaveProperty('marketing_agreed_at');
  });

  test('저장이 실패하면 창에 알리고 막은 채로 둔다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await C.gate.start(fakeSb({ updateError: { message: 'nope' } }), { user: USER });
    check('age', 'terms', 'privacy');
    $('[data-act="agree"]').click();
    await flush();
    expect(dialogOpen()).toBe(true);
    expect($('[data-msg="agree"]').textContent).toContain('저장하지 못했습니다');
    expect(C.gate.state).toBe('needed');
    console.warn.mockRestore();
  });

  test('「동의하지 않음」→ 계정을 지운다고 알린 뒤, 탈퇴 워커로 본인 계정을 지우고 로그아웃', async () => {
    const sb = fakeSb();
    const fetched = [];
    global.fetch = async (url, init) => {
      fetched.push({ url, init });
      return { ok: true, json: async () => ({ success: true }) };
    };
    await C.gate.start(sb, { user: USER });
    $('[data-act="decline"]').click();
    expect($('[data-step="agree"]').hidden).toBe(true);
    expect($('[data-step="decline"]').hidden).toBe(false);
    expect($('[data-step="decline"]').textContent).toContain(
      '이 계정과 계정에 저장된 정보를 지우고 로그아웃합니다'
    );

    // 돌아가기
    $('[data-act="back"]').click();
    expect($('[data-step="agree"]').hidden).toBe(false);
    expect(fetched).toHaveLength(0);

    $('[data-act="decline"]').click();
    $('[data-act="delete"]').click();
    await flush();
    expect(fetched).toEqual([
      {
        url: 'https://account.test/delete',
        init: { method: 'POST', headers: { Authorization: 'Bearer tok-9' } },
      },
    ]);
    expect(sb.calls.signOut).toBe(1);
    expect(went).toEqual(['index.html']);
    expect(sb.calls.update).toHaveLength(0);
  });

  test('계정 삭제가 실패하면 워커의 문구를 보여 주고 로그아웃하지 않는다', async () => {
    const sb = fakeSb();
    global.fetch = async () => ({
      ok: false,
      json: async () => ({
        success: false,
        error: '탈퇴 처리에 실패했습니다. 고객센터로 문의해 주세요.',
      }),
    });
    await C.gate.start(sb, { user: USER });
    $('[data-act="decline"]').click();
    $('[data-act="delete"]').click();
    await flush();
    expect($('[data-msg="decline"]').textContent).toBe(
      '탈퇴 처리에 실패했습니다. 고객센터로 문의해 주세요.'
    );
    expect(sb.calls.signOut).toBe(0);
    expect(went).toEqual([]);
  });

  test('상세설계 페이지(required): 바로 뜨고, 동의하지 않고 닫으면 페이지를 떠난다', async () => {
    await C.gate.start(fakeSb(), { user: USER }, { required: true });
    expect(dialogOpen()).toBe(true);
    $('[data-act="close"]').click();
    expect(went).toEqual(['ai-design.html']);
  });

  test('Esc 는 닫기와 같다', async () => {
    await C.gate.start(fakeSb(), { user: USER });
    $('[role="dialog"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    expect(dialogOpen()).toBe(false);
  });

  test('이미 동의한 회원 · 이메일 가입 동의가 옮겨진 회원에게는 뜨지 않는다', async () => {
    await expect(
      C.gate.start(fakeSb({ row: { terms_agreed_at: '2026-10-26T01:02:03.000Z' } }), { user: USER })
    ).resolves.toBe('ok');
    expect(dialogOpen()).toBe(false);
    document.getElementById('runBtn').click();
    expect(dialogOpen()).toBe(false);
    expect(C.gate.allow()).toBe(true);
  });

  test('동의 기록을 읽지 못하면(칸이 아직 없음 등) 띄우지도 막지도 않는다', async () => {
    await expect(C.gate.start(fakeSb({ row: 'error' }), { user: USER })).resolves.toBe('unknown');
    expect(dialogOpen()).toBe(false);
    expect(C.gate.allow()).toBe(true);
  });

  test('allow: 동의 전이면 창을 띄우고 false, 동의하면 resume', async () => {
    const sb = fakeSb();
    await C.gate.start(sb, { user: USER });
    $('[data-act="close"]').click();
    let resumed = 0;
    expect(C.gate.allow(() => resumed++)).toBe(false);
    expect(dialogOpen()).toBe(true);
    check('age', 'terms', 'privacy');
    $('[data-act="agree"]').click();
    await flush();
    expect(resumed).toBe(1);
  });
});

describe('consultation.html — 회원은 상담 신청 전에 동의 창', () => {
  const html = read('consultation.html');

  test('js/consent.js 를 싣고, 로그인했으면 gate.start, 신청 때 gate.allow 로 막는다', () => {
    expect(html).toMatch(/<script src="js\/consent\.js"><\/script>/);
    expect(html).toMatch(/await window\.DadamConsent\.gate\.start\(supabaseClient, session\)/);
    const fn = html.slice(html.indexOf('async function submitConsultation'));
    const gateAt = fn.indexOf('window.DadamConsent.gate.allow(');
    expect(gateAt).toBeGreaterThan(0);
    expect(gateAt).toBeLessThan(fn.indexOf(".from('consultations').insert("));
    expect(fn).toMatch(/currentUser &&\s*window\.DadamConsent &&/);
  });
});
