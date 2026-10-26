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

describe('js/site-shell.js — 인증 메일로 돌아온 셸 페이지', () => {
  const src = read('js/site-shell.js');

  test('세션이 있으면 가입 동의를 옮긴다 — 메타데이터에 동의가 있을 때만 js/consent.js 를 불러온다', () => {
    expect(src).toMatch(/bindAccountMenu\(\);\n\s*syncSignupConsent\(sb, session\);/);
    const fn = src.slice(src.indexOf('function syncSignupConsent'));
    expect(fn).toMatch(/if \(!meta\.terms_agreed_at\) return;/);
    expect(fn).toMatch(/s\.src = 'js\/consent\.js';/);
    expect(fn).toMatch(/window\.DadamConsent\.syncSignup\(sb, session\.user\)/);
  });
});
