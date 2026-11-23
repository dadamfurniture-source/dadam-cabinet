/* ============================================================
   segan/consent.js — 가입 동의 창 (2026-11-23 대표님 「동의 체크 갯수 줄이기」 · #1100 을 앱에 맞춰 새로)

   누구에게: 로그인한 회원 가운데 profiles.terms_agreed_at 이 빈 사람 (이메일 · 카카오 · Google 가입 모두,
            이미 가입한 회원도 한 번). 동의하면 다시 뜨지 않는다.
   언제:     앱 화면을 열면 이 접속(sessionStorage)에 한 번 뜬다. 닫으면 그대로 둘러볼 수 있고,
            연출컷 만들기 · AI 상담 · 상담 신청 · 시공사례 올리기 · 구독 시작을 하려 할 때 다시 뜬다
            (그 화면이 SeganConsent.need() 를 부른다 — 동의하면 하려던 일을 이어서 한다).
   칸:       전체 동의 (아래 둘을 같이 켜고 끈다)
            [필수] 만 14세 이상이며, 이용약관과 개인정보 처리방침을 확인했습니다  — 셋을 한 칸으로
            [선택] 혜택 · 새 소식을 문자 · 메일로 받겠습니다                     — 따로 (정보통신망법 50조)
   남기는 것: profiles.terms_agreed_at · privacy_agreed_at · age_confirmed_at = 지금,
            marketing_agreed_at = 지금 또는 비움 (끄고 켜기는 마이페이지 설정 — segan/settings.js)
   「동의하지 않음」은 두지 않는다 — 「나중에」는 창만 닫는다 (2026-11-23 대표님 ①). 탈퇴는 마이페이지에서.
   동의 기록을 읽지 못하면(네트워크 · 권한 · 회원 줄 없음) 창을 띄우지 않고 막지도 않는다 — #1100 과 같다.

   쓰는 법:  SeganConsent.need().then(function (ok) { if (ok) 하려던 일(); });
            로그인 전이면 true (로그인 안내는 그 화면이 따로 한다)
   ============================================================ */
/* global window, document, sessionStorage */
(function () {
  'use strict';

  var ASKED_KEY = 'segan.consent.asked'; // 이 접속에 한 번 띄웠다
  var TEXT = {
    title: '시작하기 전에 한 번만 확인해 주세요',
    all: '전체 동의',
    required: '[필수] 만 14세 이상이며, 이용약관과 개인정보 처리방침을 확인했습니다',
    marketing: '[선택] 혜택 · 새 소식을 문자 · 메일로 받겠습니다',
    marketingNote: '안 받아도 SEGAN 은 똑같이 씁니다. 마이페이지 설정에서 언제든 바꿉니다.',
    terms: '이용약관',
    privacy: '개인정보 처리방침',
    agree: '동의하고 시작',
    later: '나중에',
    needRequired: '필수 칸을 체크해 주세요.',
    saving: '저장하는 중…',
    failed: '저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
  };

  var state = { loaded: null, agreed: null, sb: null, uid: null, open: null };

  function shell() {
    return window.SeganShell || null;
  }

  function asked() {
    try {
      return sessionStorage.getItem(ASKED_KEY) === '1';
    } catch {
      return false;
    }
  }

  function markAsked() {
    try {
      sessionStorage.setItem(ASKED_KEY, '1');
    } catch {
      /* 저장소가 막히면 다음 화면에서 다시 뜰 뿐 */
    }
  }

  /** 동의 기록 읽기 — agreed: true(동의함 · 로그인 전 · 읽기 실패) | false(아직) */
  function load() {
    if (state.loaded) return state.loaded;
    state.loaded = (async function () {
      var S = shell();
      if (!S) return (state.agreed = true);
      var r = await S.ready;
      var session = r && r.session;
      var sb = S.client && S.client();
      if (!session || !sb) return (state.agreed = true);
      state.sb = sb;
      state.uid = session.user && session.user.id;
      try {
        var q = await sb.from('profiles').select('terms_agreed_at').eq('id', state.uid).maybeSingle();
        if (q.error) return (state.agreed = true);
        // 회원 줄이 있고 그 칸이 비었을(null) 때만 「아직」 — 줄이 없거나 칸을 못 읽으면 막지 않는다
        state.agreed = !(q.data && q.data.terms_agreed_at === null);
      } catch {
        state.agreed = true;
      }
      return state.agreed;
    })();
    return state.loaded;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function checkRow(id, label, cls) {
    var row = el('label', 'sgc-row' + (cls ? ' ' + cls : ''));
    var box = el('input');
    box.type = 'checkbox';
    box.id = id;
    row.appendChild(box);
    row.appendChild(el('span', '', label));
    return { row: row, box: box };
  }

  function link(href, text) {
    var a = el('a', 'sgc-link', text);
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }

  /** 동의 창 — 동의하면 true, 닫으면 false 로 풀린다 */
  function openDialog() {
    if (state.open) return state.open;
    var S = shell();
    if (!S || !S.sheet) return Promise.resolve(true);
    markAsked();
    state.open = new Promise(function (resolve) {
      var done = false;
      var finish = function (ok) {
        if (done) return;
        done = true;
        state.open = null;
        resolve(ok);
      };

      var body = el('div', 'sgc');
      var all = checkRow('sgcAll', TEXT.all, 'sgc-row--all');
      var req = checkRow('sgcRequired', TEXT.required);
      var links = el('p', 'sgc-links');
      links.appendChild(link('../terms.html', TEXT.terms));
      links.appendChild(document.createTextNode(' · '));
      links.appendChild(link('../privacy.html', TEXT.privacy));
      var mk = checkRow('sgcMarketing', TEXT.marketing);
      var note = el('p', 'sgc-note', TEXT.marketingNote);
      var err = el('p', 'sgc-error');
      err.setAttribute('role', 'alert');
      err.hidden = true;
      var bar = el('div', 'sgc-bar');
      var ok = el('button', 'sg-btn sgc-agree', TEXT.agree);
      ok.type = 'button';
      var later = el('button', 'sg-btn sgc-later', TEXT.later);
      later.type = 'button';
      bar.appendChild(ok);
      bar.appendChild(later);
      [all.row, req.row, links, mk.row, note, err, bar].forEach(function (n) {
        body.appendChild(n);
      });

      var kids = [req.box, mk.box];
      var sync = function () {
        all.box.checked = kids.every(function (k) {
          return k.checked;
        });
        ok.disabled = !req.box.checked;
      };
      all.box.addEventListener('change', function () {
        kids.forEach(function (k) {
          k.checked = all.box.checked;
        });
        sync();
      });
      kids.forEach(function (k) {
        k.addEventListener('change', sync);
      });
      sync();

      var h = S.sheet.open({
        title: TEXT.title,
        body: body,
        kind: 'dialog',
        initialFocus: all.box,
        onClose: function () {
          finish(state.agreed === true);
        },
      });

      later.addEventListener('click', function () {
        h.close();
      });
      ok.addEventListener('click', async function () {
        if (!req.box.checked) {
          err.textContent = TEXT.needRequired;
          err.hidden = false;
          return;
        }
        ok.disabled = true;
        ok.textContent = TEXT.saving;
        err.hidden = true;
        var now = new Date().toISOString();
        var row = {
          terms_agreed_at: now,
          privacy_agreed_at: now,
          age_confirmed_at: now,
          marketing_agreed_at: mk.box.checked ? now : null,
        };
        try {
          var res = await state.sb.from('profiles').update(row).eq('id', state.uid).select('id');
          if (res.error || !res.data || !res.data.length) throw new Error('no row');
          state.agreed = true;
          h.close();
        } catch {
          err.textContent = TEXT.failed;
          err.hidden = false;
          ok.textContent = TEXT.agree;
          sync();
        }
      });
    });
    return state.open;
  }

  /** 하려는 일 앞에서 — 동의했으면(또는 로그인 전이면) true, 아니면 창을 띄워 그 답.
   *  창이 이미 떠 있으면 그 창의 답을 기다린다 (새 창을 또 열지 않는다) */
  function need() {
    if (state.open) return state.open;
    return load().then(function () {
      return state.agreed ? true : openDialog();
    });
  }

  /** 화면을 열 때 — 이 접속에 아직 안 띄웠으면 한 번 */
  async function auto() {
    await load();
    if (!state.agreed && !asked()) openDialog();
  }

  window.SeganConsent = { need: need, TEXT: TEXT, ASKED_KEY: ASKED_KEY };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto);
  else auto();
})();
