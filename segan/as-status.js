/* ============================================================
   segan/as-status.js — 마이페이지 관리 › 플랫폼 › 「A/S 현황」 (segan/me.html #asStatus, 주소 #as-status)

   PC 화면 admin/as-requests.html(A/S 접수 기록)을 마이페이지 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만.
   (마이페이지 B안 4단계 — 화면마다 PR 하나)
   고객이 앱에서 보낸 A/S 는 그 수주의 팩토리 담당자(없으면 대표 · 실장)에게 바로 간다. 본사는 기록만 한다 —
   접수 · 처리 시간과 A/S 율을 모으고, 48시간 넘게 아무도 안 받으면 회사 Slack 으로 알린다(서버 cron). 보기만 하는 화면.
   팩토리의 A/S함(segan/as-requests.js — #as)과는 다른 화면이다.

   누가 보나  사이트 관리자(is_admin — 셸 판정 roles.admin)만. segan/me.js 가 업체 칸을 읽은 뒤
             SeganAsStatus.load(sb, session, partnerMe, { admin }) 를 부른다. 관리자가 아니면 묻지도 않는다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } — 서버가 관리자를 다시 가린다)
               GET /admin/as-requests?days=7|30|90|180
                 { ready, days,
                   stats { total, waiting, late, avg_receive_hours, avg_done_hours,
                           factories[{ company_id, name, count, done, orders_done, as_rate }] },
                   items[{ id, factory, order_no, state, label, route, created_at, received_at, done_at, alerted }] }
                 — 새 것부터, 많아야 500건. 표가 아직 없으면 ready: false. 고객이 적은 내용 · 사진은 싣지 않는다
   화면      기간 단추 넷 · 「다시 읽기」 → 숫자 다섯(A/S 접수 · 아직 안 받음 · 48시간 넘김 · 받기까지 평균 · 끝까지 평균)
             → 팩토리마다(A/S 접수 · 끝낸 A/S · 끝낸 수주 · A/S 율) → 접수 목록(때 · 팩토리 · 주문번호 · 간 곳 · 상태 ·
             받기까지 · 끝까지).
   못 읽으면  처음에 못 읽으면 칸째 감춘다 (오류 · 끊김 · 권한 없음) — 관리자에게는 PC 화면 줄이 남는다.
             기간을 바꾸거나 다시 읽다가 못 읽으면 있던 것은 그대로 두고 글만 남긴다.
   정보      팩토리 이름 · 주문번호는 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var DAYS = [7, 30, 90, 180]; // admin/as-requests.html 의 기간 (서버 FEED_DAYS_MAX 180)
  var DAYS_DEFAULT = 30;
  var ALERT_HOURS = 48; // 워커 as-requests.js ALERT_HOURS
  var ROUTE_LABEL = { assignee: '담당자', owners: '대표 · 실장', manager: 'MANAGER' };
  var STATE_LABEL = { requested: '접수', received: '받음', done: '끝', cancelled: '거둠' }; // 워커 AS_STATE_LABEL

  var TEXT = {
    title: 'A/S 현황',
    lead: '고객이 앱에서 보낸 A/S 는 그 수주의 팩토리 담당자(없으면 대표 · 실장)에게 바로 갑니다. 본사는 기록만 합니다 — 48시간 넘게 아무도 안 받으면 Slack 으로 알립니다.',
    days: '기간',
    recent: '최근',
    day: '일',
    reload: '다시 읽기',
    loading: '불러오는 중…',
    fail: '불러오지 못했습니다.',
    count: '건',
    hour: '시간',
    needSql: 'A/S 접수 칸이 아직 없습니다 — DB 0045 적용 뒤에 보입니다.',
    total: 'A/S 접수',
    waiting: '아직 안 받음',
    late: ALERT_HOURS + '시간 넘김',
    avgReceive: '받기까지 평균',
    avgDone: '끝까지 평균',
    factories: '팩토리마다',
    rateNote: 'A/S 율 = 이 기간 접수 수 ÷ 이 기간 끝낸 수주 수 (거둔 접수는 뺍니다)',
    factory: '팩토리',
    doneAs: '끝낸 A/S',
    doneOrders: '끝낸 수주',
    rate: 'A/S 율',
    noFactories: '이 기간에 들어온 A/S 와 끝낸 수주가 없습니다.',
    list: '접수 목록',
    empty: '이 기간에 들어온 A/S 접수가 없습니다.',
    noFactory: '팩토리 모름',
    orderNo: '주문번호',
    route: '간 곳',
    toReceive: '받기까지',
    toDone: '끝까지',
    alerted: '알림 보냄',
  };

  var S = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    days: DAYS_DEFAULT,
    data: null, // { ready, days, stats, items }
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

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  /** 한국 시간 'MM.DD HH:mm' — admin/as-requests.html when 과 같다 */
  function when(iso) {
    var t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000).toISOString();
    return k.slice(5, 7) + '.' + k.slice(8, 10) + ' ' + k.slice(11, 16);
  }

  /** 두 때 사이 — 'N시간' (하루가 넘으면 'N일 M시간'), 없으면 '' */
  function span(from, to) {
    var a = Date.parse(from);
    var b = Date.parse(to);
    if (Number.isNaN(a) || Number.isNaN(b) || b < a) return '';
    var h = Math.round((b - a) / 3600000);
    return h >= 24 ? Math.floor(h / 24) + '일 ' + (h % 24) + '시간' : h + '시간';
  }

  /** 접수 상태로 ALERT_HOURS 를 넘겼나 */
  function isLate(x, nowMs) {
    return obj(x).state === 'requested' && nowMs - Date.parse(x.at) > ALERT_HOURS * 3600000;
  }

  /** 접수 한 줄 — id 없는 줄은 버린다 */
  function rowOf(v) {
    var r = obj(v);
    var id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
    if (!id) return null;
    var state = str(r.state);
    var route = str(r.route);
    return {
      id: id,
      factory: str(r.factory).trim(),
      orderNo: str(r.order_no).trim(),
      state: state,
      label: str(r.label).trim() || (own(STATE_LABEL, state) ? STATE_LABEL[state] : state) || '-',
      route: own(ROUTE_LABEL, route) ? ROUTE_LABEL[route] : route,
      at: str(r.created_at),
      receivedAt: str(r.received_at),
      doneAt: str(r.done_at),
      alerted: r.alerted === true,
    };
  }

  /** 팩토리 한 줄 */
  function factoryOf(v) {
    var f = obj(v);
    return {
      name: str(f.name).trim(),
      count: num(f.count),
      done: num(f.done),
      ordersDone: num(f.orders_done),
      rate: num(f.as_rate),
    };
  }

  /** 서버 stats → 숫자 다섯 + 팩토리 줄. 없으면 null */
  function statsOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return {
      total: num(v.total),
      waiting: num(v.waiting),
      late: num(v.late),
      avgReceive: num(v.avg_receive_hours),
      avgDone: num(v.avg_done_hours),
      factories: (Array.isArray(v.factories) ? v.factories : []).map(factoryOf),
    };
  }

  /** 서버 답 → { ready, days, stats, items } — 목록이 배열이 아니면 null (이상한 답) */
  function feedOf(data, asked) {
    var d = obj(data);
    if (!Array.isArray(d.items)) return null;
    return {
      ready: d.ready !== false,
      days: DAYS.indexOf(d.days) >= 0 ? d.days : asked,
      stats: statsOf(d.stats),
      items: d.items.map(rowOf).filter(Boolean),
    };
  }

  function statusText(feed) {
    if (!feed || !feed.ready) return '';
    return feed.items.length + TEXT.count + ' · ' + TEXT.recent + ' ' + feed.days + TEXT.day;
  }

  /** 접수 줄의 상태 글 — 늦었으면 「접수 · 48시간 넘김」 */
  function stateText(x, nowMs) {
    return isLate(x, nowMs) ? x.label + ' · ' + TEXT.late : x.label;
  }

  async function token() {
    try {
      var r = S.sb && (await S.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return S.session ? S.session.access_token : '';
  }

  /** 그 기간의 기록을 읽는다 — 못 읽으면 { feed: null, message } */
  async function read(days) {
    var res;
    try {
      res = await fetch(S.base + '/admin/as-requests?days=' + encodeURIComponent(days), {
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
    return $('asStatus');
  }

  function box() {
    return $('asStatusBody');
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
          (S.days === n ? 'true' : 'false') +
          '"' +
          (S.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.recent + ' ' + n + TEXT.day) +
          '</button>'
        );
      }).join('') +
      '</div><button type="button" class="mk-btn" data-act="reload"' +
      (S.busy ? ' disabled' : '') +
      '>' +
      esc(TEXT.reload) +
      '</button></div>'
    );
  }

  function n(v, unit) {
    return v === null ? '-' : v + unit;
  }

  function kpiHtml(s) {
    if (!s) return '';
    var cells = [
      ['total', TEXT.total, n(s.total, TEXT.count), false],
      ['waiting', TEXT.waiting, n(s.waiting, TEXT.count), false],
      // 늦은 접수가 있으면 — 색만으로 알리지 않는다 (굵은 글 + 테두리)
      ['late', TEXT.late, n(s.late, TEXT.count), s.late > 0],
      ['avg-receive', TEXT.avgReceive, n(s.avgReceive, TEXT.hour), false],
      ['avg-done', TEXT.avgDone, n(s.avgDone, TEXT.hour), false],
    ];
    return (
      '<dl class="od-kpi as-kpi" data-as="kpi">' +
      cells
        .map(function (c) {
          return (
            '<div data-k="' +
            c[0] +
            '"' +
            (c[3] ? ' class="as-warn"' : '') +
            '><dt>' +
            esc(c[1]) +
            '</dt><dd>' +
            esc(c[2]) +
            '</dd></div>'
          );
        })
        .join('') +
      '</dl>'
    );
  }

  function factoriesHtml(s) {
    var list = s ? s.factories : [];
    var cell = function (v) {
      return '<td class="od-num">' + esc(v === null ? '-' : v) + '</td>';
    };
    return (
      '<section class="as-sec" data-as="factories"><h4 class="od-h">' +
      esc(TEXT.factories) +
      '</h4><p class="mk-note">' +
      esc(TEXT.rateNote) +
      '</p>' +
      (list.length
        ? '<div class="od-tablewrap"><table class="od-table as-table"><thead><tr><th scope="col">' +
          esc(TEXT.factory) +
          '</th><th scope="col" class="od-num">' +
          esc(TEXT.total) +
          '</th><th scope="col" class="od-num">' +
          esc(TEXT.doneAs) +
          '</th><th scope="col" class="od-num">' +
          esc(TEXT.doneOrders) +
          '</th><th scope="col" class="od-num">' +
          esc(TEXT.rate) +
          '</th></tr></thead><tbody>' +
          list
            .map(function (f) {
              return (
                '<tr><th scope="row">' +
                esc(f.name || '-') +
                '</th>' +
                cell(f.count) +
                cell(f.done) +
                cell(f.ordersDone) +
                '<td class="od-num">' +
                esc(f.rate === null ? '-' : f.rate + '%') +
                '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>'
        : '<p class="me-empty">' + esc(TEXT.noFactories) + '</p>') +
      '</section>'
    );
  }

  function rowHtml(x, nowMs) {
    var late = isLate(x, nowMs);
    var took = [
      span(x.at, x.receivedAt) ? TEXT.toReceive + ' ' + span(x.at, x.receivedAt) : '',
      span(x.at, x.doneAt) ? TEXT.toDone + ' ' + span(x.at, x.doneAt) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    var sub = [
      when(x.at),
      x.orderNo ? TEXT.orderNo + ' ' + x.orderNo : '',
      x.route ? TEXT.route + ' ' + x.route : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      '<li class="me-cs-item dr-item" data-as-row="' +
      esc(x.id) +
      '"><div class="dr-head"><span class="me-c-main"><b>' +
      esc(x.factory || TEXT.noFactory) +
      '</b><small>' +
      esc(sub) +
      '</small></span><span class="me-badge dr-kind' +
      (late ? ' as-late' : '') +
      '">' +
      esc(stateText(x, nowMs)) +
      '</span></div>' +
      (took || x.alerted
        ? '<p class="dr-note">' +
          esc([took, x.alerted ? TEXT.alerted : ''].filter(Boolean).join(' · ')) +
          '</p>'
        : '') +
      '</li>'
    );
  }

  function listHtml(feed, nowMs) {
    return (
      '<section class="as-sec" data-as="list"><h4 class="od-h">' +
      esc(TEXT.list) +
      '</h4>' +
      (feed.items.length
        ? '<ul class="me-cs-list dr-list">' +
          feed.items
            .map(function (x) {
              return rowHtml(x, nowMs);
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty" data-as="empty">' + esc(TEXT.empty) + '</p>') +
      '</section>'
    );
  }

  function bodyHtml() {
    var feed = S.data;
    if (!feed.ready) return '<p class="me-empty" data-as="needsql">' + esc(TEXT.needSql) + '</p>';
    return kpiHtml(feed.stats) + factoriesHtml(feed.stats) + listHtml(feed, Date.now());
  }

  function render() {
    var b = box();
    var s = sec();
    if (!b || !s || !S.ready || !S.data) return;
    b.innerHTML =
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p>' +
      daysHtml() +
      '<p class="me-pt-msg dr-status" data-as="status" role="status">' +
      esc(S.msg) +
      '</p><p class="mk-error" data-as="err" role="alert"' +
      (S.err ? '' : ' hidden') +
      '>' +
      esc(S.err) +
      '</p>' +
      bodyHtml();
    if (S.busy) b.setAttribute('aria-busy', 'true');
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
    S.ready = false;
  }

  function focusOn(sel) {
    var b = box();
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  /** 기간을 바꾸거나 다시 읽는다 — 못 읽으면 있던 것 · 고른 기간은 그대로 두고 글만 남긴다 */
  async function refresh(days, back) {
    if (S.busy || !S.ready) return;
    S.busy = true;
    S.msg = TEXT.loading;
    S.err = '';
    render();
    var r = await read(days);
    S.busy = false;
    if (r.feed) {
      S.days = days;
      S.data = r.feed;
      S.msg = statusText(r.feed);
    } else {
      S.msg = statusText(S.data);
      S.err = r.message || TEXT.fail;
    }
    render();
    focusOn(back);
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || S.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'reload') refresh(S.days, '[data-act="reload"]');
    else if (act === 'days') {
      var d = Number(el.getAttribute('data-days'));
      if (DAYS.indexOf(d) < 0 || d === S.days) return;
      refresh(d, '[data-act="days"][data-days="' + d + '"]');
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
    S.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    S.sb = sb || null;
    S.session = session || null;
    S.days = DAYS_DEFAULT;
    S.data = null;
    S.busy = false;
    S.msg = '';
    S.err = '';
    if (!S.base || !session || !(opts && opts.admin === true)) return;
    try {
      var r = await read(S.days);
      if (!r.feed) return;
      S.data = r.feed;
      S.msg = statusText(r.feed);
      bind();
      S.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganAsStatus = {
    DAYS: DAYS,
    DAYS_DEFAULT: DAYS_DEFAULT,
    ALERT_HOURS: ALERT_HOURS,
    ROUTE_LABEL: ROUTE_LABEL,
    STATE_LABEL: STATE_LABEL,
    TEXT: TEXT,
    when: when,
    span: span,
    isLate: isLate,
    rowOf: rowOf,
    statsOf: statsOf,
    feedOf: feedOf,
    statusText: statusText,
    stateText: stateText,
    state: S,
    load: load,
  };
})();
