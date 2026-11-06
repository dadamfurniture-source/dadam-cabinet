/* ============================================================
   segan/settings.js — 「설정」 화면 (segan/settings.html — 내 정보 › 설정 · 프로필 · 탈퇴)

   사이트 mypage.html 의 「계정 정보」 · 「프로필 수정」 · 「회원탈퇴」를 그대로 옮겼다. 새 규칙을 만들지 않는다.
     계정 정보   로그인 계정의 user_metadata (mypage.html loadUserProfile)
                 이름 = name · full_name · 이메일 앞부분, 연락처 · 거주지역(sido gugun)은 없으면 「미등록」,
                 가입일 = 계정 created_at
     프로필 수정 이름(필수) · 연락처 · 거주지역 시/도 · 시/군/구 (mypage.html submitEditProfile)
                 목록은 segan/regions.js — mypage.html gugunData 와 같은 목록이다 (시험이 본다)
                 auth.updateUser({ data }) 로 저장하고 profiles 도 같은 값으로 고친다 (profiles 실패는 넘긴다)
     회원탈퇴    지우는 것 · 남는 것 안내 + 확인 문구 「탈퇴합니다」를 그대로 적어야 단추가 열린다 (mypage.html submitWithdraw)
                 account-api POST /delete (본인 토큰만 — 대상 id 를 보내지 않는다, 보내면 남의 계정을 지목할 수 있다).
                 되면 남은 세션을 지우고 앱 첫 화면으로 간다

   로그인 · 탭 · 로그인 안내는 segan/shell.js 가 맡는다 (data-tab="me" — 내 정보 탭 안의 화면).
   로그인 안내의 돌아올 곳만 이 화면(segan/settings.html)으로 바꾼다.
   ============================================================ */
/* global window, document, location, fetch */
(function () {
  'use strict';

  var WITHDRAW_WORD = '탈퇴합니다'; // mypage.html WITHDRAW_WORD
  var LOGIN_PAGE = '../login.html';
  var SELF = 'segan/settings.html';
  var HOME = './'; // 탈퇴 뒤 — 앱 첫 화면 (mypage.html 은 사이트 첫 화면)
  var ASSISTANT_MEMO = 'segan.assistant.on.'; // segan/shell.js 의 비서 탭 기억 — 로그아웃처럼 지운다
  var TEXT = {
    none: '미등록',
    nameRequired: '이름을 입력해주세요.',
    saved: '프로필이 수정되었습니다.',
    saveFail: '프로필 수정 중 오류가 발생했습니다: ',
    wordMismatch: '확인 문구가 일치하지 않습니다.',
    working: '처리 중…',
    expired: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
    noApi: '탈퇴 기능을 사용할 수 없습니다.',
    withdrawFail: '탈퇴 처리에 실패했습니다.',
  };

  var S = { sb: null, session: null, user: null, saving: false };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 계정 정보 ──────────────────────────────────────────
  function metaOf(user) {
    return (user && user.user_metadata) || {};
  }

  /** 이름 — mypage.html 과 같은 차례: name · full_name · 이메일 앞부분 */
  function nameOf(user) {
    var meta = metaOf(user);
    return meta.name || meta.full_name || String((user && user.email) || '').split('@')[0];
  }

  /** 거주지역 — 시/도 · 시/군구가 다 있으면 「시/도 시/군/구」, 시/도만 있으면 그것, 없으면 「미등록」 */
  function placeOf(meta) {
    return meta.sido && meta.gugun ? meta.sido + ' ' + meta.gugun : meta.sido || TEXT.none;
  }

  /** 가입일 — 「2026년 11월 7일」 (mypage.html 과 같은 ko-KR 긴 날짜) */
  function joinedOf(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '-';
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function renderInfo(user, meta) {
    var m = meta || metaOf(user);
    $('stName').textContent = meta ? meta.name : nameOf(user);
    $('stEmail').textContent = (user && user.email) || '-';
    $('stPhone').textContent = m.phone || TEXT.none;
    $('stPlace').textContent = placeOf(m);
    $('stJoined').textContent = joinedOf(user && user.created_at);
  }

  // ── 거주지역 고르기 ────────────────────────────────────
  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function fillSido(selected) {
    var R = window.SeganRegions || {};
    var sel = $('stEditSido');
    sel.textContent = '';
    sel.appendChild(option('', '선택하세요'));
    Object.keys(R).forEach(function (s) {
      sel.appendChild(option(s, s));
    });
    sel.value = R[selected] ? selected : '';
  }

  /** 시/군/구 — 시/도를 고르기 전에는 안내 한 줄만 (mypage.html updateGugun) */
  function fillGugun(selected) {
    var R = window.SeganRegions || {};
    var list = R[$('stEditSido').value] || null;
    var sel = $('stEditGugun');
    sel.textContent = '';
    if (!list) {
      sel.appendChild(option('', '시/도를 먼저 선택하세요'));
      return;
    }
    sel.appendChild(option('', '선택하세요'));
    list.forEach(function (g) {
      sel.appendChild(option(g, g));
    });
    sel.value = list.indexOf(selected) >= 0 ? selected : '';
  }

  // ── 프로필 수정 ────────────────────────────────────────
  function editError(msg) {
    $('stEditError').textContent = msg || '';
    $('stEditError').hidden = !msg;
  }

  function openEdit() {
    var meta = metaOf(S.user);
    $('stEditName').value = meta.name || meta.full_name || '';
    $('stEditPhone').value = meta.phone || '';
    fillSido(meta.sido || '');
    fillGugun(meta.gugun || '');
    editError('');
    $('stEditDone').hidden = true;
    $('stEditForm').hidden = false;
    $('stEditOpen').hidden = true;
  }

  function closeEdit() {
    $('stEditForm').hidden = true;
    $('stEditOpen').hidden = false;
    editError('');
  }

  async function saveEdit(e) {
    if (e) e.preventDefault();
    if (S.saving) return;
    var name = $('stEditName').value.trim();
    var phone = $('stEditPhone').value.trim();
    var sido = $('stEditSido').value;
    var gugun = $('stEditGugun').value;
    if (!name) return editError(TEXT.nameRequired);
    editError('');
    S.saving = true;
    $('stEditSave').disabled = true;
    try {
      // 1. 로그인 계정의 user_metadata
      var r = await S.sb.auth.updateUser({
        data: { name: name, phone: phone, sido: sido, gugun: gugun },
      });
      if (r && r.error) throw r.error;
      // 2. profiles 도 같은 값으로 (실패해도 넘긴다 — mypage.html 과 같다)
      try {
        await S.sb
          .from('profiles')
          .update({
            name: name,
            phone: phone,
            sido: sido,
            gugun: gugun,
            updated_at: new Date().toISOString(),
          })
          .eq('id', S.user.id);
      } catch {
        /* profiles 고치기는 건너뛴다 */
      }
      // 세션을 다시 읽어 바뀐 계정 정보를 쓴다
      try {
        var g = await S.sb.auth.getSession();
        var session = g && g.data ? g.data.session : null;
        if (session && session.user) {
          S.session = session;
          S.user = session.user;
        }
      } catch {
        /* 못 읽으면 적은 값으로 보인다 */
      }
      closeEdit();
      renderInfo(S.user, { name: name, phone: phone, sido: sido, gugun: gugun });
      $('stEditDone').hidden = false;
    } catch (err) {
      editError(TEXT.saveFail + ((err && err.message) || ''));
    }
    S.saving = false;
    $('stEditSave').disabled = false;
  }

  // ── 회원탈퇴 ───────────────────────────────────────────
  function withdrawStatus(msg) {
    $('stWithdrawStatus').textContent = msg || '';
    $('stWithdrawStatus').hidden = !msg;
  }

  function openWithdraw() {
    $('stWithdrawInput').value = '';
    withdrawStatus('');
    $('stWithdrawBtn').disabled = true;
    $('stWithdraw').hidden = false;
    $('stWithdrawOpen').hidden = true;
  }

  function closeWithdraw() {
    $('stWithdraw').hidden = true;
    $('stWithdrawOpen').hidden = false;
  }

  /** 로그아웃과 같은 정리 — 이 기기에 남은 판정 기억을 지운다 (segan/shell.js 로그아웃) */
  function forgetCaches() {
    try {
      if (window.AdminAccess && window.AdminAccess.clearCache) window.AdminAccess.clearCache();
      if (window.DetailDesignAccess && window.DetailDesignAccess.clearCache)
        window.DetailDesignAccess.clearCache();
      for (var i = window.sessionStorage.length - 1; i >= 0; i--) {
        var k = window.sessionStorage.key(i);
        if (k && k.indexOf(ASSISTANT_MEMO) === 0) window.sessionStorage.removeItem(k);
      }
    } catch {
      /* noop */
    }
  }

  async function submitWithdraw() {
    var btn = $('stWithdrawBtn');
    if ($('stWithdrawInput').value.trim() !== WITHDRAW_WORD) {
      withdrawStatus(TEXT.wordMismatch);
      return;
    }
    btn.disabled = true;
    withdrawStatus(TEXT.working);
    try {
      var g = await S.sb.auth.getSession();
      var session = g && g.data ? g.data.session : null;
      if (!session) throw new Error(TEXT.expired);

      var cfg = window.DADAM_CONFIG || {};
      var base = cfg.accountApi && cfg.accountApi.url;
      if (!base) throw new Error(TEXT.noApi);

      var res = await fetch(base + '/delete', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !body || !body.success)
        throw new Error((body && body.error) || TEXT.withdrawFail);

      // 계정이 사라졌으므로 남은 세션도 지우고 첫 화면으로
      try {
        await S.sb.auth.signOut();
      } catch {
        /* 그래도 간다 */
      }
      forgetCaches();
      api.go(HOME);
    } catch (err) {
      btn.disabled = false;
      withdrawStatus((err && err.message) || TEXT.withdrawFail);
    }
  }

  // ── 시작 ───────────────────────────────────────────────
  function bind() {
    $('stEditOpen').addEventListener('click', openEdit);
    $('stEditCancel').addEventListener('click', closeEdit);
    $('stEditForm').addEventListener('submit', saveEdit);
    $('stEditSido').addEventListener('change', function () {
      fillGugun('');
    });
    $('stWithdrawOpen').addEventListener('click', openWithdraw);
    $('stWithdrawCancel').addEventListener('click', closeWithdraw);
    $('stWithdrawInput').addEventListener('input', function () {
      $('stWithdrawBtn').disabled = $('stWithdrawInput').value.trim() !== WITHDRAW_WORD;
    });
    $('stWithdrawBtn').addEventListener('click', submitWithdraw);
  }

  function start(auth) {
    if (!$('stName')) return;
    if (!auth || !auth.session || !auth.sb) {
      // 로그인 안내 — 로그인한 뒤 이 화면으로 돌아온다
      var a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
      if (a) a.setAttribute('href', LOGIN_PAGE + '?redirect=' + encodeURIComponent(SELF));
      return;
    }
    S.sb = auth.sb;
    S.session = auth.session;
    S.user = auth.session.user || {};
    renderInfo(S.user);
    bind();
  }

  var api = {
    WITHDRAW_WORD: WITHDRAW_WORD,
    TEXT: TEXT,
    state: S,
    nameOf: nameOf,
    placeOf: placeOf,
    /** 페이지 이동 — 시험이 바꿔 끼운다 */
    go: function (url) {
      location.assign(url);
    },
  };
  window.SeganSettings = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
