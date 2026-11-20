/* ============================================================
   segan/hq-collection.js — 마이페이지 관리 › 플랫폼 › 시공사례 고르기 (segan/me.html #hqCollection, 주소 #hq-collection)

   2026-11-20 대표님 「연출컷은 본사에서 정하고 올릴 수 있도록」 — 연출컷 자동 게시는 끄고(COLLECTION_AUTO_POST "off"),
   본사가 고객의 연출컷을 보고 고른 것만 시공사례 탭에 나간다 (DB 0075 hq_picked_at, segan/collection.js).

   누가 보나  다담 본사 구성원(account-api GET /partner/me 의 platform_member) 또는 사이트 관리자.
             서버가 본사 대표 · 실장 · 관리자만 연다 (403 not_hq 면 칸째 감춘다 — 메뉴 줄도 없다).
             segan/me.js 가 업체 칸을 읽은 뒤 SeganHqCollection.load(sb, session, me, { admin }) 를 부른다.
   서버      generate-api (본인 토큰 — workers/generate-api/src/hq-collection.js)
               GET    /api/hq/collection?before=   { items: [{ id, created_at, place_label, door_color, image, picked }], next }
               POST   /api/hq/collection/:id       올리기 { picked: true }
               DELETE /api/hq/collection/:id       내리기 { picked: false }
             DB 0075 전(409 db_pending)이면 칸은 열고 「준비 중」 한 줄.
   화면      한 줄 안내 → 탭(전체 · 올림 · 안 올림) → 사진 칸(사진 · 품목 · 문 색 · 만든 날 · 상태 · 「올리기」/「내리기」)
             → 「더 보기」. 사진 주소는 1시간짜리라 다시 열면 새로 받는다. 내리기는 한 번 더 묻는다(공개 복사본을 지운다).
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var TEXT = {
    lead: '고른 연출컷만 시공사례 탭에 나갑니다. 사진 위에 표시는 없고, 누르면 업체 칸에 「AI 연출」이 보입니다. 지역 · 고객 정보는 나가지 않습니다.',
    pending: '준비 중입니다 — DB 0075 를 적용하면 열립니다.',
    empty: '고를 연출컷이 없습니다.',
    emptyTab: '이 탭에 해당하는 연출컷이 없습니다.',
    fail: '목록을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.',
    actFail: '바꾸지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
    more: '더 보기',
    pick: '시공사례에 올리기',
    unpick: '내리기',
    picked: '올림',
    notPicked: '안 올림',
    confirmUnpick: '이 연출컷을 시공사례에서 내릴까요? 공개 사본도 지웁니다.',
  };
  var TABS = [
    ['all', '전체'],
    ['picked', '올림'],
    ['not', '안 올림'],
  ];
  var C = {
    base: '',
    sb: null,
    session: null,
    items: null,
    next: null,
    tab: 'all',
    busy: '',
    note: '',
    pending: false,
  };

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** https 주소만 그린다 */
  function safeSrc(u) {
    return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '';
  }
  /** 2026-11-20T… → 11-20 */
  function day(iso) {
    var t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    var d = new Date(t);
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** 볼 수 있나 — 본사 구성원 또는 사이트 관리자 (서버가 대표 · 실장만 한 번 더 거른다) */
  function canSee(me, opts) {
    var admin = !!(opts && opts.admin);
    var platform =
      !!me && typeof me === 'object' && !Array.isArray(me) && me.platform_member === true;
    return admin || platform;
  }

  /** 응답 모양 거르기 — 쓸 수 있는 칸만 */
  function itemsOf(body) {
    if (!body || body.success !== true || !Array.isArray(body.items)) return null;
    return body.items.filter(function (x) {
      return x && typeof x.id === 'string';
    });
  }

  function visible() {
    var list = C.items || [];
    if (C.tab === 'picked')
      return list.filter(function (x) {
        return x.picked === true;
      });
    if (C.tab === 'not')
      return list.filter(function (x) {
        return x.picked !== true;
      });
    return list;
  }

  function cardHTML(x) {
    var src = safeSrc(x.image);
    var name = [x.place_label, x.door_color].filter(Boolean).join(' · ') || '연출컷';
    var busy = C.busy === x.id;
    return (
      '<li class="me-dc-card me-hc-card" data-id="' +
      esc(x.id) +
      '">' +
      '<div class="me-hc-photo">' +
      (src
        ? '<img src="' + esc(src) + '" alt="' + esc(name) + '" loading="lazy" decoding="async">'
        : '') +
      '</div>' +
      '<div class="me-dc-head"><b>' +
      esc(name) +
      '</b><span class="me-badge' +
      (x.picked ? ' me-badge--confirmed' : '') +
      '">' +
      (x.picked ? TEXT.picked : TEXT.notPicked) +
      '</span></div>' +
      '<p class="mk-note">' +
      esc(day(x.created_at)) +
      '</p>' +
      '<button type="button" class="mk-btn" data-act="' +
      (x.picked ? 'unpick' : 'pick') +
      '"' +
      (busy ? ' disabled' : '') +
      '>' +
      (x.picked ? TEXT.unpick : TEXT.pick) +
      '</button>' +
      '</li>'
    );
  }

  function render() {
    var box = $('hqCollectionBody');
    if (!box) return;
    if (C.pending) {
      box.innerHTML = '<p class="me-empty">' + esc(TEXT.pending) + '</p>';
      return;
    }
    var head =
      '<p class="me-pt-sub">' +
      esc(TEXT.lead) +
      '</p>' +
      '<div class="me-hc-tabs" role="tablist">' +
      TABS.map(function (t) {
        return (
          '<button type="button" role="tab" data-tab="' +
          t[0] +
          '" aria-selected="' +
          (C.tab === t[0]) +
          '">' +
          esc(t[1]) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (C.note ? '<p class="mk-note" role="status">' + esc(C.note) + '</p>' : '');
    if (C.items === null) {
      box.innerHTML = head;
      return;
    }
    var list = visible();
    var body = list.length
      ? '<ul class="me-hc-grid">' + list.map(cardHTML).join('') + '</ul>'
      : '<p class="me-empty">' + esc(C.items.length ? TEXT.emptyTab : TEXT.empty) + '</p>';
    var more = C.next
      ? '<button type="button" class="mk-btn" data-act="more">' + esc(TEXT.more) + '</button>'
      : '';
    box.innerHTML = head + body + more;
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = C.sb && (await C.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return C.session ? C.session.access_token : '';
  }

  /** → { status, body } (끊기면 status 0) */
  async function call(method, path) {
    try {
      var res = await fetch(C.base + path, {
        method: method,
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
      var body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body: body };
    } catch {
      return { status: 0, body: null };
    }
  }

  async function loadPage(before) {
    var r = await call(
      'GET',
      '/api/hq/collection' + (before ? '?before=' + encodeURIComponent(before) : '')
    );
    var items = itemsOf(r.body);
    return {
      r: r,
      items: items,
      next: r.body && typeof r.body.next === 'string' ? r.body.next : null,
    };
  }

  async function more() {
    if (!C.next || C.busy) return;
    C.busy = 'more';
    var p = await loadPage(C.next);
    C.busy = '';
    if (!p.items) C.note = TEXT.fail;
    else {
      var seen = {};
      (C.items || []).forEach(function (x) {
        seen[x.id] = true;
      });
      C.items = (C.items || []).concat(
        p.items.filter(function (x) {
          return !seen[x.id];
        })
      );
      C.next = p.next;
      C.note = '';
    }
    render();
  }

  /** 내리기 확인 — 가운데 작은 창 (segan/shell.js SeganShell.sheet, kind 'dialog'). 셸이 없으면 묻지 않고 내리지 않는다 */
  function askUnpick() {
    var sheet = window.SeganShell && window.SeganShell.sheet;
    if (!sheet) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var done = false;
      var body = document.createElement('div');
      var p = document.createElement('p');
      p.className = 'mk-note';
      p.textContent = TEXT.confirmUnpick;
      var acts = document.createElement('div');
      acts.className = 'mk-acts';
      var yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'mk-btn';
      yes.setAttribute('data-confirm', 'yes');
      yes.textContent = TEXT.unpick;
      var no = document.createElement('button');
      no.type = 'button';
      no.className = 'mk-btn';
      no.setAttribute('data-confirm', 'no');
      no.textContent = '취소';
      acts.appendChild(yes);
      acts.appendChild(no);
      body.appendChild(p);
      body.appendChild(acts);
      var h = sheet.open({
        title: TEXT.unpick,
        body: body,
        kind: 'dialog',
        initialFocus: no,
        onClose: function () {
          if (!done) resolve(false);
        },
      });
      no.addEventListener('click', function () {
        done = true;
        resolve(false);
        h.close();
      });
      yes.addEventListener('click', function () {
        done = true;
        resolve(true);
        h.close();
      });
    });
  }

  async function toggle(id, act) {
    var x = (C.items || []).find(function (i) {
      return i.id === id;
    });
    if (!x || C.busy) return;
    if (act === 'unpick' && !(await askUnpick())) return;
    C.busy = id;
    C.note = '';
    render();
    var r = await call(
      act === 'pick' ? 'POST' : 'DELETE',
      '/api/hq/collection/' + encodeURIComponent(id)
    );
    C.busy = '';
    if (r.body && r.body.success === true) x.picked = act === 'pick';
    else C.note = TEXT.actFail;
    render();
  }

  function onClick(e) {
    var t = e.target;
    var tab = t.closest && t.closest('[data-tab]');
    if (tab) {
      C.tab = tab.getAttribute('data-tab');
      return render();
    }
    var btn = t.closest && t.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'more') return more();
    var card = btn.closest('[data-id]');
    if (card) return toggle(card.getAttribute('data-id'), act);
  }

  /** 시공사례 고르기 칸 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data, opts.admin = 사이트 관리자 */
  async function load(sb, session, me, opts) {
    var section = $('hqCollection');
    var box = $('hqCollectionBody');
    if (!section || !box) return;
    section.hidden = true;
    var cfg = window.DADAM_CONFIG || {};
    var api = (cfg.generateApi && cfg.generateApi.url) || '';
    C.base = api.replace(/\/api\/generate\/?$/, '');
    C.sb = sb;
    C.session = session;
    C.items = null;
    C.next = null;
    C.tab = 'all';
    C.busy = '';
    C.note = '';
    C.pending = false;
    if (!C.base || !session || !canSee(me, opts)) return;
    try {
      var p = await loadPage('');
      var code = p.r.body && p.r.body.code;
      if (p.r.status === 409 && code === 'db_pending') C.pending = true;
      else if (!p.items)
        return; // 403 not_hq · 오류 — 칸째 감춘다
      else {
        C.items = p.items;
        C.next = p.next;
      }
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
      }
      render();
      section.hidden = false;
    } catch {
      section.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganHqCollection = {
    TEXT: TEXT,
    state: C,
    canSee: canSee,
    itemsOf: itemsOf,
    load: load,
  };
})();
