/* ============================================================
   segan/done-reports.js — 마이페이지 관리 › 플랫폼 › 「완료 보고」 (segan/me.html #doneReports, 주소 #done-reports)

   PC 화면 admin/order-reports.html(완료 보고 모아 보기)을 마이페이지 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만.
   (마이페이지 B안 4단계 — 화면마다 PR 하나)
   팩토리가 수주에서 올린 「설치 완료」 · 「A/S 완료」 보고를 본사가 모아 본다. 기록만 한다 (검수 없음) — 보기만 하는 화면.

   누가 보나  사이트 관리자(is_admin — 셸 판정 roles.admin)만. segan/me.js 가 업체 칸을 읽은 뒤
             SeganDoneReports.load(sb, session, partnerMe, { admin }) 를 부른다. 관리자가 아니면 묻지도 않는다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } — 서버가 관리자를 다시 가린다)
               GET /admin/order-reports?days=7|30|90   { ready, days, items[{ id, company_name, order_no, kind, label, note,
                                                         photo_urls, learn_ok, created_at }] } — 새 것부터, 많아야 200건.
                                                       표가 아직 없으면 ready: false
   화면      기간 단추 셋(최근 7일 · 30일 · 90일) · 「다시 읽기」 → 건수 한 줄 → 보고 줄
             (보고한 때 · 종류 · 팩토리 · 주문번호 · 학습 동의 · 메모 · 사진). 사진은 서버의 서명 주소(1시간)라
             오래 열어 두면 「다시 읽기」로 새로 받는다. 누르면 새 탭.
   학습      서버 learn_ok — 고객이 「시공 사진 학습 활용」에 동의한 상담의 수주만 true. 동의 · 안 함 · 모름.
   못 읽으면  처음에 못 읽으면 칸째 감춘다 (오류 · 끊김 · 권한 없음) — 관리자에게는 PC 화면 줄이 남는다.
             기간을 바꾸거나 다시 읽다가 못 읽으면 있던 줄은 그대로 두고 글만 남긴다.
   정보      팩토리 이름 · 주문번호 · 메모 · 사진 주소는 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var DAYS = [7, 30, 90]; // admin/order-reports.html 의 기간 (서버 FEED_DAYS_MAX 90)
  var DAYS_DEFAULT = 30;
  var KIND_NAME = { install_done: '설치 완료', as_done: 'A/S 완료' }; // 서버 REPORT_KIND_LABEL

  var TEXT = {
    title: '완료 보고',
    lead: '팩토리가 수주에서 올린 「설치 완료」 · 「A/S 완료」 보고입니다. 본사는 기록만 합니다 (검수 없음).',
    days: '기간',
    recent: '최근',
    day: '일',
    reload: '다시 읽기',
    loading: '불러오는 중…',
    fail: '불러오지 못했습니다.',
    count: '건',
    empty: '이 기간에 들어온 보고가 없습니다.',
    needSql: '완료 보고 칸이 아직 없습니다 — DB 0043 적용 뒤에 보입니다.',
    noCompany: '팩토리 모름',
    orderNo: '주문번호',
    photo: '사진',
    learn: '학습',
    learnYes: '동의',
    learnNo: '안 함',
    learnUnknown: '모름',
  };

  var R = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    days: DAYS_DEFAULT,
    data: null, // { ready, days, items }
    busy: false,
    msg: '',
    err: '',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  /** 한국 시간 'MM.DD HH:mm' — admin/order-reports.html when 과 같다 */
  function when(iso) {
    var t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000).toISOString();
    return k.slice(5, 7) + '.' + k.slice(8, 10) + ' ' + k.slice(11, 16);
  }

  /** 학습 동의 — true 동의 · false 안 함 · 그 밖(null — 상담을 못 찾음 · 0044 전) 모름 */
  function learnLabel(v) {
    return v === true ? TEXT.learnYes : v === false ? TEXT.learnNo : TEXT.learnUnknown;
  }

  /** 보고 한 줄 — id 없는 줄은 버린다. 사진은 https 주소만 */
  function rowOf(v) {
    var r = obj(v);
    var id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
    if (!id) return null;
    return {
      id: id,
      company: str(r.company_name).trim(),
      orderNo: str(r.order_no).trim(),
      label: str(r.label).trim() || KIND_NAME[str(r.kind)] || str(r.kind) || '-',
      note: str(r.note).trim(),
      photos: (Array.isArray(r.photo_urls) ? r.photo_urls : []).filter(function (u) {
        return str(u).indexOf('https://') === 0;
      }),
      learn: r.learn_ok === true ? true : r.learn_ok === false ? false : null,
      at: str(r.created_at),
    };
  }

  /** 서버 답 → { ready, days, items } — 목록이 배열이 아니면 null (이상한 답) */
  function feedOf(data, asked) {
    var d = obj(data);
    if (!Array.isArray(d.items)) return null;
    return {
      ready: d.ready !== false,
      days: DAYS.indexOf(d.days) >= 0 ? d.days : asked,
      items: d.items.map(rowOf).filter(Boolean),
    };
  }

  function statusText(feed) {
    if (!feed || !feed.ready) return '';
    return feed.items.length + TEXT.count + ' · ' + TEXT.recent + ' ' + feed.days + TEXT.day;
  }

  async function token() {
    try {
      var r = R.sb && (await R.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return R.session ? R.session.access_token : '';
  }

  /** 그 기간의 보고를 읽는다 — 못 읽으면 { feed: null, message } */
  async function read(days) {
    var res;
    try {
      res = await fetch(R.base + '/admin/order-reports?days=' + encodeURIComponent(days), {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
    } catch {
      return { feed: null, message: '' };
    }
    var b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    b = b && typeof b === 'object' ? b : {};
    if (!res.ok || b.success !== true) return { feed: null, message: str(b.message) };
    return { feed: feedOf(b.data, days), message: '' };
  }

  function sec() {
    return $('doneReports');
  }

  function box() {
    return $('doneReportsBody');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function daysHtml() {
    return (
      '<div class="dr-bar"><div class="dr-days" role="group" aria-label="' +
      esc(TEXT.days) +
      '">' +
      DAYS.map(function (n) {
        return (
          '<button type="button" class="mk-btn dr-day" data-act="days" data-days="' +
          n +
          '" aria-pressed="' +
          (R.days === n ? 'true' : 'false') +
          '"' +
          (R.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.recent + ' ' + n + TEXT.day) +
          '</button>'
        );
      }).join('') +
      '</div><button type="button" class="mk-btn" data-act="reload"' +
      (R.busy ? ' disabled' : '') +
      '>' +
      esc(TEXT.reload) +
      '</button></div>'
    );
  }

  function photosHtml(x) {
    if (!x.photos.length) return '';
    return (
      '<div class="dr-photos">' +
      x.photos
        .map(function (u, i) {
          var name = x.label + ' ' + TEXT.photo + ' ' + (i + 1);
          return (
            '<a href="' +
            esc(u) +
            '" target="_blank" rel="noopener noreferrer"><img src="' +
            esc(u) +
            '" alt="' +
            esc(name) +
            '" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="72" height="72"></a>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function rowHtml(x) {
    var sub = [
      when(x.at),
      x.orderNo ? TEXT.orderNo + ' ' + x.orderNo : '',
      TEXT.learn + ' ' + learnLabel(x.learn),
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      '<li class="me-cs-item dr-item" data-dr-row="' +
      esc(x.id) +
      '"><div class="dr-head"><span class="me-c-main"><b>' +
      esc(x.company || TEXT.noCompany) +
      '</b><small>' +
      esc(sub) +
      '</small></span><span class="me-badge dr-kind">' +
      esc(x.label) +
      '</span></div>' +
      (x.note ? '<p class="dr-note">' + esc(x.note) + '</p>' : '') +
      photosHtml(x) +
      '</li>'
    );
  }

  function listHtml() {
    var feed = R.data;
    if (!feed.ready) return '<p class="me-empty" data-dr="needsql">' + esc(TEXT.needSql) + '</p>';
    if (!feed.items.length)
      return '<p class="me-empty" data-dr="empty">' + esc(TEXT.empty) + '</p>';
    return '<ul class="me-cs-list dr-list">' + feed.items.map(rowHtml).join('') + '</ul>';
  }

  function render() {
    var b = box();
    var s = sec();
    if (!b || !s || !R.ready || !R.data) return;
    b.innerHTML =
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p>' +
      daysHtml() +
      '<p class="me-pt-msg dr-status" data-dr="status" role="status">' +
      esc(R.msg) +
      '</p><p class="mk-error" data-dr="err" role="alert"' +
      (R.err ? '' : ' hidden') +
      '>' +
      esc(R.err) +
      '</p>' +
      listHtml();
    if (R.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    s.hidden = false;
  }

  function hide() {
    var b = box();
    var s = sec();
    if (b) {
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    if (s) s.hidden = true;
    R.ready = false;
  }

  function focusOn(sel) {
    var b = box();
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  /** 기간을 바꾸거나 다시 읽는다 — 못 읽으면 있던 줄 · 고른 기간은 그대로 두고 글만 남긴다 */
  async function refresh(days, back) {
    if (R.busy || !R.ready) return;
    R.busy = true;
    R.msg = TEXT.loading;
    R.err = '';
    render();
    var r = await read(days);
    R.busy = false;
    if (r.feed) {
      R.days = days;
      R.data = r.feed;
      R.msg = statusText(r.feed);
    } else {
      R.msg = statusText(R.data);
      R.err = r.message || TEXT.fail;
    }
    render();
    focusOn(back);
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || R.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'reload') refresh(R.days, '[data-act="reload"]');
    else if (act === 'days') {
      var n = Number(el.getAttribute('data-days'));
      if (DAYS.indexOf(n) < 0 || n === R.days) return;
      refresh(n, '[data-act="days"][data-days="' + n + '"]');
    }
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 관리자가 아니거나 못 읽으면 칸을 감춘 채 둔다 */
  async function load(sb, session, me, opts) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    R.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    R.sb = sb || null;
    R.session = session || null;
    R.days = DAYS_DEFAULT;
    R.data = null;
    R.busy = false;
    R.msg = '';
    R.err = '';
    if (!R.base || !session || !(opts && opts.admin === true)) return;
    try {
      var r = await read(R.days);
      if (!r.feed) return;
      R.data = r.feed;
      R.msg = statusText(r.feed);
      bind();
      R.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganDoneReports = {
    DAYS: DAYS,
    DAYS_DEFAULT: DAYS_DEFAULT,
    KIND_NAME: KIND_NAME,
    TEXT: TEXT,
    when: when,
    learnLabel: learnLabel,
    rowOf: rowOf,
    feedOf: feedOf,
    statusText: statusText,
    state: R,
    load: load,
  };
})();
