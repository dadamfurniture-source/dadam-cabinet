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
 *   DadamConsent.agreePatch(nowIso, marketing)      → 동의 창에서 동의했을 때 profiles 에 쓸 값
 *   DadamConsent.gate.start(sb, session, { required })  → 동의 기록이 없으면 동의 창 (아래 「동의 창」)
 *   DadamConsent.gate.allow(resume)                 → 서비스 동작 앞에서: 동의했으면 true, 아니면 창을 띄우고 false
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

  /** 동의 창에서 동의했을 때 profiles 에 쓸 값 — 이메일 가입과 같은 칸, 같은 모양 */
  function agreePatch(nowIso, marketing) {
    return patchFromMetadata(signupMetadata(nowIso, marketing));
  }

  // ═══════════════════════════════════════════════════════════════
  // 동의 창 — profiles.terms_agreed_at 이 비어 있는 회원
  //   (카카오·Google 로 가입한 회원, 이 기능 전에 가입한 회원)
  //
  //   · 로그인한 뒤 한 번, 보던 페이지 위에 창으로 띄운다.
  //   · 동의 전에는 서비스 동작만 막는다(연출컷 시작 · 상담 신청 · 상세설계 열기). 둘러보기는 그대로.
  //     닫으면 서비스 동작을 하려 할 때 다시 뜬다.
  //   · 동의하면 이메일 가입과 같은 칸을 쓴다(agreePatch).
  //   · 동의하지 않거나 만 14세 미만이면 계정을 지운다 — 탈퇴와 같은 길
  //     (workers/account-api POST /delete, 본인 토큰으로 자기 계정만). 그 뒤 로그아웃.
  //
  //   화면에서만 막는다. 서버(연출컷·상담 저장)는 동의 여부를 따로 보지 않는다.
  // ═══════════════════════════════════════════════════════════════

  /**
   * 동의 전에는 누르면 창이 대신 뜨는 것 — 서비스 동작.
   * 다른 페이지의 id 를 여기서 가리키므로, 이름이 바뀌면 consent.test.js 가 깨져 알린다.
   */
  const SERVICE_SELECTORS = [
    '#runBtn', // ai-design.html 「연출컷 생성」
    '[data-act="regen"]', // my-designs.html 「다시 생성」 — 연출컷을 새로 만든다
    '#navDetailDesign', // 공용 셸 헤더 「DETAIL DESIGN」
    'a[href^="detaildesign.html"]', // 상세설계로 가는 링크
    '#toPlanner', // ai-design.html 「상세설계로 가져오기」
    '[data-act="planner"]', // my-designs.html 「상세설계로」
  ];

  /** 로그인 한 번에 창을 저절로 한 번만 띄운다 — 회원별 마지막 로그인 시각을 적어 둔다 */
  const ASKED_KEY = 'dadam.consentAsked.';

  const gate = {
    state: 'unknown', // 'unknown' | 'needed' | 'ok'
    sb: null,
    user: null,
    required: false, // 이 페이지 자체가 서비스(상세설계)면 닫을 때 페이지를 떠난다
    resume: null, // 창을 띄운 서비스 동작 — 동의하면 이어서 한다
    el: null,
    lastFocus: null,
    leaveTo: 'ai-design.html',
    /** 페이지 이동 — 시험에서 바꿔 끼운다 */
    navigate: function (url) {
      window.location.href = url;
    },
  };

  /**
   * 동의 창을 띄워야 하는가. 가입 동의(메타데이터)를 먼저 옮긴 뒤 본다 —
   * 이메일로 가입한 회원은 여기서 끝난다.
   * true · false, 읽지 못하면 null (칸이 아직 없거나 네트워크 오류 — 그때는 막지 않는다).
   */
  async function needsConsent(sb, user) {
    if (!sb || !user || !user.id) return null;
    try {
      await syncSignup(sb, user);
    } catch (e) {
      console.warn('[consent] 가입 동의 옮기기:', e && e.message);
    }
    try {
      const { data, error } = await sb
        .from('profiles')
        .select('terms_agreed_at')
        .eq('id', user.id)
        .maybeSingle();
      if (error || !data) return null;
      return !data.terms_agreed_at;
    } catch (e) {
      return null;
    }
  }

  function askedFor(user) {
    try {
      return (
        window.localStorage.getItem(ASKED_KEY + user.id) === String(user.last_sign_in_at || '')
      );
    } catch (e) {
      return false;
    }
  }

  function markAsked(user) {
    try {
      window.localStorage.setItem(ASKED_KEY + user.id, String(user.last_sign_in_at || ''));
    } catch (e) {
      /* 저장소를 못 쓰면 페이지마다 한 번 뜬다 */
    }
  }

  /**
   * 로그인한 페이지에서 부른다 (공용 셸 · 상담 신청).
   * opts.required — 이 페이지를 여는 것이 곧 서비스(상세설계)일 때. 바로 띄우고, 닫으면 떠난다.
   */
  async function start(sb, session, opts) {
    const o = opts || {};
    gate.sb = sb;
    gate.user = session && session.user;
    gate.required = Boolean(o.required);
    const need = await needsConsent(sb, gate.user);
    gate.state = need === null ? 'unknown' : need ? 'needed' : 'ok';
    if (gate.state !== 'needed') return gate.state;

    installGuard();
    if (gate.required) {
      open();
    } else if (!askedFor(gate.user)) {
      markAsked(gate.user);
      open();
    }
    return gate.state;
  }

  /**
   * 서비스 동작 앞에서 부른다. 동의했거나 알 수 없으면 true.
   * 아직이면 창을 띄우고 false — 동의하면 resume 을 부른다.
   */
  function allow(resume) {
    if (gate.state !== 'needed') return true;
    open(resume);
    return false;
  }

  function onClickCapture(e) {
    if (gate.state !== 'needed' || !e.target || !e.target.closest) return;
    const hit = e.target.closest(SERVICE_SELECTORS.join(','));
    if (!hit || (gate.el && gate.el.contains(hit))) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    open(function () {
      hit.click();
    });
  }

  let guarded = false;
  function installGuard() {
    if (guarded) return;
    guarded = true;
    // 캡처 단계 — 페이지가 버튼에 단 onclick 보다 먼저 받는다
    document.addEventListener('click', onClickCapture, true);
  }

  // ── 창 ───────────────────────────────────────────────────────────

  const STYLE = [
    '.dc-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;',
    'padding:16px;background:rgba(45,42,38,.45);font-family:var(--v5-sans,"Noto Sans KR",-apple-system,sans-serif);',
    'font-weight:300;color:var(--v5-ink,#2d2a26);word-break:keep-all;overflow-wrap:break-word;line-height:1.7}',
    '.dc-backdrop *{box-sizing:border-box}',
    '.dc-backdrop[hidden],.dc-backdrop [hidden]{display:none!important}',
    '.dc-panel{position:relative;width:100%;max-width:440px;max-height:calc(100vh - 32px);overflow:auto;',
    'background:var(--v5-card,#fcfaf7);border:1px solid var(--v5-line-card,rgba(45,42,38,.11));padding:34px 30px 28px}',
    '.dc-close{position:absolute;top:10px;right:12px;width:36px;height:36px;border:0;background:none;cursor:pointer;',
    'font-size:22px;line-height:1;color:var(--v5-ink-55,rgba(45,42,38,.55))}',
    '.dc-close:hover{color:var(--v5-ink,#2d2a26)}',
    '.dc-eyebrow{margin:0;font-size:11px;letter-spacing:.34em;color:var(--v5-tan,#8a7457)}',
    '.dc-title{margin:10px 0 8px;font-size:19px;font-weight:400;letter-spacing:.01em;line-height:1.5}',
    '.dc-lede{margin:0 0 18px;font-size:13.5px;color:var(--v5-ink-62,rgba(45,42,38,.62))}',
    '.dc-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--v5-line,rgba(45,42,38,.1))}',
    '.dc-list li{border-bottom:1px solid var(--v5-line,rgba(45,42,38,.1))}',
    '.dc-list label{display:flex;align-items:flex-start;gap:10px;padding:11px 2px;font-size:13.5px;cursor:pointer}',
    '.dc-list input{width:17px;height:17px;margin:3px 0 0;flex:none;accent-color:var(--v5-ink,#2d2a26);cursor:pointer}',
    '.dc-list a{color:inherit;text-decoration:underline;text-underline-offset:3px}',
    '.dc-req{font-weight:400;color:var(--v5-tan,#8a7457)}',
    '.dc-opt{color:var(--v5-ink-55,rgba(45,42,38,.55))}',
    '.dc-note{margin:12px 0 0;font-size:12px;color:var(--v5-ink-55,rgba(45,42,38,.55))}',
    '.dc-msg{margin:12px 0 0;font-size:12.5px;color:#a54034}',
    '.dc-actions{display:flex;gap:10px;margin-top:22px}',
    '.dc-btn{flex:1;padding:13px 10px;border:1px solid var(--v5-ink,#2d2a26);background:var(--v5-ink,#2d2a26);',
    'color:var(--v5-invert,#f6f3ee);font:inherit;font-size:12.5px;font-weight:400;letter-spacing:.08em;cursor:pointer;border-radius:0}',
    '.dc-btn--ghost{background:none;color:var(--v5-ink-62,rgba(45,42,38,.62));border-color:var(--v5-line-18,rgba(45,42,38,.18))}',
    '.dc-btn--danger{background:#a54034;border-color:#a54034;color:#fff}',
    '.dc-btn[disabled]{opacity:.45;cursor:default}',
    '.dc-btn:focus-visible,.dc-close:focus-visible{outline:2px solid var(--v5-tan,#8a7457);outline-offset:2px}',
    '@media (max-width:480px){.dc-panel{padding:30px 20px 22px}.dc-actions{flex-direction:column-reverse}}',
  ].join('');

  const HTML =
    '<section class="dc-panel" role="dialog" aria-modal="true" aria-labelledby="dcTitle">' +
    '<button type="button" class="dc-close" data-act="close" aria-label="닫기">×</button>' +
    // 1단계 — 동의
    '<div data-step="agree">' +
    '<p class="dc-eyebrow">AGREEMENT</p>' +
    '<h2 class="dc-title" id="dcTitle">서비스 이용 동의</h2>' +
    '<p class="dc-lede">다담가구 서비스를 쓰려면 아래 동의가 필요합니다.</p>' +
    '<ul class="dc-list">' +
    '<li><label><input type="checkbox" data-k="age" />' +
    '<span><b class="dc-req">[필수]</b> 만 14세 이상입니다.</span></label></li>' +
    '<li><label><input type="checkbox" data-k="terms" />' +
    '<span><b class="dc-req">[필수]</b> <a href="terms.html" target="_blank" rel="noopener">이용약관</a>에 동의합니다.</span></label></li>' +
    '<li><label><input type="checkbox" data-k="privacy" />' +
    '<span><b class="dc-req">[필수]</b> <a href="privacy.html" target="_blank" rel="noopener">개인정보처리방침</a>에 동의합니다.</span></label></li>' +
    '<li><label><input type="checkbox" data-k="marketing" />' +
    '<span class="dc-opt">[선택] 마케팅 정보 수신에 동의합니다.</span></label></li>' +
    '</ul>' +
    '<p class="dc-note">만 14세 미만이면 가입할 수 없습니다. 「동의하지 않음」을 눌러 주세요.</p>' +
    '<p class="dc-msg" data-msg="agree" role="alert" hidden></p>' +
    '<div class="dc-actions">' +
    '<button type="button" class="dc-btn dc-btn--ghost" data-act="decline">동의하지 않음</button>' +
    '<button type="button" class="dc-btn" data-act="agree" disabled>동의하고 계속</button>' +
    '</div>' +
    '</div>' +
    // 2단계 — 동의하지 않음
    '<div data-step="decline" hidden>' +
    '<p class="dc-eyebrow">ACCOUNT</p>' +
    '<h2 class="dc-title" id="dcTitleDecline">계정을 지웁니다</h2>' +
    '<p class="dc-lede">동의하지 않거나 만 14세 미만이면 서비스를 쓸 수 없습니다. ' +
    '이 계정과 계정에 저장된 정보를 지우고 로그아웃합니다. 지운 계정은 되돌릴 수 없습니다.</p>' +
    '<p class="dc-msg" data-msg="decline" role="alert" hidden></p>' +
    '<div class="dc-actions">' +
    '<button type="button" class="dc-btn dc-btn--ghost" data-act="back">돌아가기</button>' +
    '<button type="button" class="dc-btn dc-btn--danger" data-act="delete">계정 지우기</button>' +
    '</div>' +
    '</div>' +
    '</section>';

  function q(sel) {
    return gate.el.querySelector(sel);
  }

  function say(step, text) {
    const m = q('[data-msg="' + step + '"]');
    m.textContent = text || '';
    m.hidden = !text;
  }

  function showStep(step) {
    q('[data-step="agree"]').hidden = step !== 'agree';
    q('[data-step="decline"]').hidden = step !== 'decline';
    q('[role="dialog"]').setAttribute(
      'aria-labelledby',
      step === 'agree' ? 'dcTitle' : 'dcTitleDecline'
    );
    say('agree', '');
    say('decline', '');
    const first = step === 'agree' ? q('[data-k="age"]') : q('[data-act="back"]');
    if (first) first.focus();
  }

  function refreshAgree() {
    const ok = ['age', 'terms', 'privacy'].every(function (k) {
      return q('[data-k="' + k + '"]').checked;
    });
    q('[data-act="agree"]').disabled = !ok;
  }

  function build() {
    if (!document.getElementById('dadamConsentStyle')) {
      const st = document.createElement('style');
      st.id = 'dadamConsentStyle';
      st.textContent = STYLE;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.className = 'dc-backdrop';
    el.hidden = true;
    el.innerHTML = HTML;
    document.body.appendChild(el);
    gate.el = el;

    el.addEventListener('change', function (e) {
      if (e.target && e.target.matches('[data-k]')) refreshAgree();
    });
    el.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'close') close();
      else if (act === 'agree') agree();
      else if (act === 'decline') showStep('decline');
      else if (act === 'back') showStep('agree');
      else if (act === 'delete') removeAccount();
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab') {
        trapTab(e);
      }
    });
  }

  /** 창 안에서만 Tab 이 돈다 */
  function trapTab(e) {
    const items = Array.prototype.filter.call(
      gate.el.querySelectorAll('button, a[href], input'),
      function (n) {
        return !n.disabled && !n.closest('[hidden]');
      }
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function busy(on) {
    gate.el.querySelectorAll('button').forEach(function (b) {
      if (b.getAttribute('data-act') === 'agree' && !on) return refreshAgree();
      b.disabled = on;
    });
  }

  function open(resume) {
    if (!gate.el) build();
    gate.resume = typeof resume === 'function' ? resume : null;
    if (gate.el.hidden) {
      gate.lastFocus = document.activeElement;
      gate.el.hidden = false;
      document.documentElement.style.overflow = 'hidden';
    }
    showStep('agree');
    refreshAgree();
  }

  function hide() {
    if (!gate.el || gate.el.hidden) return;
    gate.el.hidden = true;
    document.documentElement.style.overflow = '';
    if (gate.lastFocus && gate.lastFocus.focus) gate.lastFocus.focus();
  }

  /** 동의하지 않고 닫기 — 둘러보기는 그대로. 이 페이지가 서비스 자체면 떠난다 */
  function close() {
    hide();
    gate.resume = null;
    if (gate.required && gate.state === 'needed') gate.navigate(gate.leaveTo);
  }

  async function agree() {
    const marketing = q('[data-k="marketing"]').checked;
    busy(true);
    say('agree', '');
    try {
      const { error } = await gate.sb
        .from('profiles')
        .update(agreePatch(new Date().toISOString(), marketing))
        .eq('id', gate.user.id)
        .is('terms_agreed_at', null);
      if (error) throw error;
    } catch (e) {
      console.warn('[consent] 동의 저장 실패:', e && e.message);
      busy(false);
      say('agree', '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    gate.state = 'ok';
    const resume = gate.resume;
    busy(false);
    hide();
    gate.resume = null;
    if (resume) resume();
  }

  /** 동의하지 않음 — 회원탈퇴와 같은 워커로 본인 계정을 지우고 로그아웃 */
  async function removeAccount() {
    busy(true);
    say('decline', '');
    try {
      const base =
        window.DADAM_CONFIG && window.DADAM_CONFIG.accountApi && window.DADAM_CONFIG.accountApi.url;
      if (!base) throw new Error('계정 삭제를 할 수 없습니다.');
      const r = await gate.sb.auth.getSession();
      const token = r && r.data && r.data.session && r.data.session.access_token;
      if (!token) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
      const res = await fetch(base + '/delete', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
      const body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !body.success) throw new Error(body.error || '계정을 지우지 못했습니다.');
    } catch (e) {
      busy(false);
      say('decline', e && e.message ? e.message : '계정을 지우지 못했습니다.');
      return;
    }
    // 계정이 사라졌다. 남은 세션도 지우고 첫 화면으로
    try {
      await gate.sb.auth.signOut();
    } catch (e) {
      /* 이미 지운 계정 — 세션 정리 실패는 무시한다 */
    }
    gate.state = 'unknown';
    gate.navigate('index.html');
  }

  const gateApi = {
    SERVICE_SELECTORS,
    start,
    allow,
    needsConsent,
    /** 시험·디버그용 — 지금 상태 */
    get state() {
      return gate.state;
    },
    set navigate(fn) {
      gate.navigate = fn;
    },
    /** 시험용 — 창과 상태를 처음으로 */
    _reset() {
      if (gate.el && gate.el.parentNode) gate.el.parentNode.removeChild(gate.el);
      gate.el = null;
      gate.state = 'unknown';
      gate.resume = null;
      gate.required = false;
      document.documentElement.style.overflow = '';
      gate.navigate = function (url) {
        window.location.href = url;
      };
    },
  };

  return {
    SIGNUP_FIELDS,
    signupMetadata,
    patchFromMetadata,
    syncSignup,
    marketingPatch,
    agreePatch,
    gate: gateApi,
  };
});
