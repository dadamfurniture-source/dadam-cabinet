/**
 * 동의 기록 — 이용약관 · 개인정보처리방침 · 만 14세 이상 · 마케팅 수신 (database/consents.sql 의 칸)
 *
 * 이메일 가입은 인증 메일을 누르기 전까지 세션이 없다. 세션 없이는 profiles 에 쓸 수 없으므로
 * signup.html 은 동의 시각을 가입 메타데이터(user_metadata)에 실어 두고, 세션이 처음 생기는 곳
 * (login.html · 공용 셸 js/site-shell.js · 인증 없이 바로 세션이 나오면 signup.html)에서
 * syncSignup 이 회원 본인 세션으로 profiles 에 옮긴다. 기존 RLS "Users can update own profile" 안이다.
 *
 * 순수 함수는 브라우저 전역 `DadamConsent`, Node(Jest) 는 module.exports 로 같이 쓴다.
 *
 *   DadamConsent.signupMetadata(nowIso, marketing)  → 가입 메타데이터에 실을 값
 *   DadamConsent.patchFromMetadata(meta)            → profiles 에 옮길 값 | null (가입 동의가 없으면)
 *   DadamConsent.syncSignup(sb, user)               → Promise<boolean> 옮겼거나 이미 옮겼으면 true
 *   DadamConsent.marketingPatch(agree, nowIso)      → 마이페이지 켜기·끄기 때 profiles 에 쓸 값
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamConsent = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 가입 메타데이터에서 profiles 로 옮기는 칸 — 이름이 같다 */
  const SIGNUP_FIELDS = [
    'terms_agreed_at',
    'privacy_agreed_at',
    'age_confirmed_at',
    'marketing_agreed_at',
  ];

  /** 옮긴 뒤 이 브라우저에서는 다시 쓰지 않는다 (회원마다) */
  const SYNCED_KEY = 'dadam.consentSynced.';

  function isTime(v) {
    return typeof v === 'string' && v.length > 0 && !Number.isNaN(Date.parse(v));
  }

  /**
   * 이메일 가입 화면이 signUp 의 options.data 에 더하는 값.
   * 약관·처리방침·만 14세 이상은 필수라 가입하는 순간 모두 같은 시각이다.
   * marketing_agreed(참/거짓)는 예전부터 싣던 칸이라 그대로 둔다.
   */
  function signupMetadata(nowIso, marketing) {
    return {
      terms_agreed_at: nowIso,
      privacy_agreed_at: nowIso,
      age_confirmed_at: nowIso,
      marketing_agreed_at: marketing ? nowIso : null,
      marketing_agreed: Boolean(marketing),
    };
  }

  /**
   * 가입 메타데이터 → profiles 에 쓸 값. 이용약관 동의 시각이 없으면 null
   * (카카오·Google 가입, 이 기능 전에 가입한 회원).
   */
  function patchFromMetadata(meta) {
    if (!meta || !isTime(meta.terms_agreed_at)) return null;
    const patch = {};
    for (const f of SIGNUP_FIELDS) {
      if (isTime(meta[f])) patch[f] = meta[f];
    }
    return patch;
  }

  /**
   * 가입 때 받은 동의를 profiles 에 옮긴다.
   * 이미 terms_agreed_at 이 있는 행은 건드리지 않는다 — 다른 기기에서 먼저 옮겼거나,
   * 그 뒤 마이페이지에서 마케팅 동의를 바꿨으면 그 값을 덮지 않기 위해서다.
   */
  async function syncSignup(sb, user) {
    if (!sb || !user || !user.id) return false;
    const patch = patchFromMetadata(user.user_metadata);
    if (!patch) return false;

    const key = SYNCED_KEY + user.id;
    try {
      if (window.localStorage.getItem(key)) return true;
    } catch (e) {
      /* 저장소를 못 쓰는 브라우저 — 매번 확인한다 */
    }

    const { error } = await sb
      .from('profiles')
      .update(patch)
      .eq('id', user.id)
      .is('terms_agreed_at', null);
    if (error) {
      console.warn('[consent] 가입 동의 기록 실패:', error.message);
      return false;
    }
    try {
      window.localStorage.setItem(key, '1');
    } catch (e) {
      /* 위와 같다 */
    }
    return true;
  }

  /** 마이페이지 마케팅 수신 동의 켜기·끄기 */
  function marketingPatch(agree, nowIso) {
    return agree
      ? { marketing_agreed_at: nowIso, marketing_withdrawn_at: null }
      : { marketing_agreed_at: null, marketing_withdrawn_at: nowIso };
  }

  return { SIGNUP_FIELDS, signupMetadata, patchFromMetadata, syncSignup, marketingPatch };
});
