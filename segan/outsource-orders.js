/* ============================================================
   segan/outsource-orders.js — 「생산 › 외주 발주」 (segan/me.html #outsourceOrders)

   PC 화면 admin/work-reports.html(작업 지시 보고)의 외주 · 상판 발주 「입고 처리 · 발주 취소」를 마이페이지 생산 화면으로
   옮긴 것 — 서버 · 권한은 그대로, 화면만. (마이페이지 B안 4단계 — 화면마다 PR 하나)
   앱에는 관리자용 「관리 › 작업 보고」(segan/admin-reports.js)가 이미 있다 — 거기는 모든 보고, 여기는 외주 · 상판 발주만이고
   관리자가 아닌 사람(발주를 낸 본인)도 쓴다.

   누가 보나  다담 공장 구성원(account-api GET /partner/me 의 hq_member) · 협력업체 Expert · Agent 구성원
             (외주 발주는 Expert 이상 — workflow-api documents.js OUTSOURCE_PLANS).
             다담 본사 구성원 · Manager 업체 · 고객에게는 그려지지 않는다.
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganOutsourceOrders.load(sb, session, partnerMe) 를
             부른다. 이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message })
               GET   /reports?kind=outsource_order,countertop_order[&status=ordered|received|cancelled]&page=N
                     { items, hasMore, scope } — scope 'all' = 관리자(다담 공장 전체 발주),
                     'company' = 그 업체 대표 · 실장(내 업체 발주 전체 — 남이 낸 발주도 입고 · 취소), 'mine' = 내가 낸 발주만
               GET   /reports/:id   한 건 (본문 body.doc_no · can_edit — 낸 사람 또는 admin 이상 ·
                     can_status — 입고 · 취소를 할 수 있나: 거기에 그 업체 대표 · 실장을 더한다)
               PATCH /reports/:id   { status: 'received' | 'cancelled' } — 입고로 바꾸면 서버가 오늘을 입고한 날로 남긴다
   화면      상태 거르기(발주 중 · 입고 · 취소 · 전체) → 발주 줄(누르면 그 자리에 상세) → 「입고 처리」 · 「발주 취소」.
             둘 다 그 자리에서 한 번 되묻는다 — 이 화면에는 되돌리는 단추가 없다 (창을 띄우지 않는다).
   없는 것    새 발주(상세설계 4단계 작업지시서 · PC) · 보낸 종이 다시 인쇄(PC) · 메모 · 고정 · 보관(관리 › 작업 보고).
   못 읽으면  칸째 감춘다 (오류 · 끊김). 바꾸기가 안 되면 서버 글을 그 줄에 적는다.
   정보      업체 이름 · 수량 · 문서 번호는 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  // 종류 · 꾸러미 · 상태 이름 — admin/work-reports.html (IS_ORDER · OUTSOURCE_PACK · STATUS_NAME) 과 같다
  var KINDS = ['outsource_order', 'countertop_order'];
  var PACK_NAME = { door: '도어재', 'cut-vendor': '재단·엣지', top: '상판' };
  var STATUS_NAME = { ordered: '발주', received: '입고', cancelled: '취소' };
  // 거르기 — 처음에는 아직 안 들어온 것(발주 중)만
  var FILTERS = [
    ['ordered', '발주 중'],
    ['received', '입고'],
    ['cancelled', '취소'],
    ['', '전체'],
  ];
  var PLANS = ['expert', 'agent']; // 외주 발주 — Expert 이상 (서버 OUTSOURCE_PLANS 와 같다)
  var WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

  var TEXT = {
    title: '외주 발주',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    loadFail: '발주 목록을 불러오지 못했습니다. 잠시 뒤 다시 해 주세요.',
    detailFail: '이 발주를 불러오지 못했습니다.',
    loading: '불러오는 중…',
    scopeAll: '다담 공장의 외주 · 상판 발주 전체입니다.',
    scopeCompany:
      '우리 팩토리의 외주 · 상판 발주 전체입니다. 남이 낸 발주도 입고 · 취소할 수 있습니다.',
    scopeMine: '내가 낸 외주 · 상판 발주만 보입니다.',
    help: '물건이 들어오면 「입고 처리」, 발주를 물렀으면 「발주 취소」를 누르세요. 새 발주는 상세설계 4단계(작업지시서)에서 냅니다 (PC).',
    late: '예정일 지남',
    receiveAsk: '이 발주를 입고로 바꿀까요? 오늘이 입고한 날로 남습니다.',
    cancelAsk: '이 외주 발주를 취소로 바꿀까요? (기록은 남습니다)',
    noUndo: '이 화면에서는 되돌릴 수 없습니다.',
    receive: '입고 처리',
    cancel: '발주 취소',
    keep: '그대로 두기',
    received: '입고 처리했습니다.',
    cancelled: '발주를 취소로 바꿨습니다.',
    readOnly: '발주를 낸 사람과 대표 · 실장 · 관리자만 바꿀 수 있습니다.',
    more: '더 보기',
    empty: {
      ordered: '들어오기를 기다리는 발주가 없습니다.',
      received: '입고 처리한 발주가 없습니다.',
      cancelled: '취소한 발주가 없습니다.',
      '': '외주 · 상판 발주가 없습니다.',
    },
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false, // 처음 읽기를 마쳤다 (칸을 그렸다)
    filter: 'ordered',
    page: 1,
    hasMore: false,
    scope: '', // 'all' | 'company' | 'mine' (서버가 정한다)
    items: null, // 목록 | null(못 읽음)
    openId: null,
    detail: null, // 한 건 | 'loading' | null(못 읽음)
    asking: '', // 되묻는 중 — 'received' | 'cancelled' | ''
    err: '',
    msg: '',
    busy: false,
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

  /** 다담 공장 구성원이거나 Expert · Agent 협력업체 구성원인가 — 다담 본사 구성원 · Manager 업체는 아니다 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.platform_member === true) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    return !!c && typeof c === 'object' && !Array.isArray(c) && PLANS.indexOf(c.plan) >= 0;
  }

  // ── 글자 — admin/work-reports.html 과 같다 ────────────
  function kstDay(iso) {
    var t = iso ? new Date(iso) : new Date(Date.now());
    if (isNaN(t.getTime())) return '';
    return new Date(t.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function dayLabel(s) {
    if (!s) return '-';
    var d = new Date(String(s).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '-';
    return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + '(' + WEEKDAY[d.getUTCDay()] + ')';
  }
  function statusName(s) {
    return s ? STATUS_NAME[s] || s : '';
  }
  /** 꾸러미 이름 — 숫자 칸(metrics) · 본문(body)의 pack, 없으면 상판 발주만 「상판」 */
  function packOf(r) {
    r = obj(r);
    var pack = str(obj(r.metrics).pack) || str(obj(r.body).pack);
    if (PACK_NAME[pack]) return PACK_NAME[pack];
    return r.kind === 'countertop_order' ? PACK_NAME.top : '';
  }
  function vendorOf(r) {
    r = obj(r);
    return str(obj(r.metrics).vendor) || str(obj(r.body).vendor);
  }
  function qtyOf(r) {
    return str(obj(obj(r).metrics).qty);
  }
  /** 발주일 (YYYY-MM-DD) — 기간 시작, 없으면 본문 */
  function orderedOf(r) {
    r = obj(r);
    return (str(r.period_start) || str(obj(r.body).ordered_on)).slice(0, 10);
  }
  /**
   * 입고 예정일 (YYYY-MM-DD) — 숫자 칸(metrics.expected), 없으면 본문.
   * 기간 끝(period_end)은 쓰지 않는다 — 예정일을 안 적은 발주는 서버가 거기에 발주일을 넣는다
   */
  function expectedOf(r) {
    r = obj(r);
    return (str(obj(r.metrics).expected) || str(obj(r.body).expected_on)).slice(0, 10);
  }
  /** 입고한 날 (YYYY-MM-DD) — 입고로 바꿀 때 서버가 남긴다 */
  function receivedOf(r) {
    return str(obj(obj(r).metrics).received_on).slice(0, 10);
  }
  /** 발주 중인데 입고 예정일이 지났나 (오늘 = 한국 날짜) */
  function isLate(r, today) {
    r = obj(r);
    var due = expectedOf(r);
    return r.status === 'ordered' && !!due && due < (today || kstDay());
  }
  /** 줄 아래 글 — 수량 (제목에 꾸러미 · 업체 · 문서 번호가 있다). 제목이 없는 줄만 꾸러미 · 업체도 */
  function subText(r) {
    if (str(obj(r).title)) return qtyOf(r);
    return [packOf(r), vendorOf(r), qtyOf(r)].filter(Boolean).join(' · ');
  }
  /** 줄 아래 날짜 글 — 발주 · 입고 예정 (· 입고) */
  function daysText(r) {
    var out = [];
    if (orderedOf(r)) out.push('발주 ' + dayLabel(orderedOf(r)));
    if (expectedOf(r)) out.push('입고 예정 ' + dayLabel(expectedOf(r)));
    if (obj(r).status === 'received' && receivedOf(r)) out.push('입고 ' + dayLabel(receivedOf(r)));
    return out.join(' · ');
  }
  /** 목록 주소 — 외주 · 상판 발주만, 고른 상태로 */
  function listPath(filter, page) {
    return (
      '/reports?kind=' +
      KINDS.join(',') +
      (filter ? '&status=' + encodeURIComponent(filter) : '') +
      '&page=' +
      (page > 0 ? page : 1)
    );
  }
  /** 바꿀 수 있나 — 발주 중이고, 서버가 바꿔도 된다고 한 것만 */
  function canChange(d) {
    d = obj(d);
    return (
      KINDS.indexOf(d.kind) >= 0 &&
      d.status === 'ordered' &&
      (d.can_edit === true || d.can_status === true)
    );
  }

  // ── 서버 ────────────────────────────────────────────
  async function token() {
    try {
      var r = J.sb && (await J.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return J.session ? J.session.access_token : '';
  }
  async function call(method, path, body) {
    if (!J.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(J.base + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      return { ok: false, status: 0, body: {} };
    }
    var b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    b = b && typeof b === 'object' ? b : {};
    return { ok: res.ok && b.success === true, status: res.status, body: b };
  }
  function errText(r) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : TEXT.generic;
  }

  /** 목록 한 쪽 → { items, hasMore, scope } | null — 외주 · 상판 발주가 아닌 줄은 버린다 */
  async function fetchPage(page) {
    var r = await call('GET', listPath(J.filter, page));
    var d = r.ok ? r.body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return {
      items: d.items.filter(function (x) {
        return (
          x &&
          typeof x === 'object' &&
          typeof x.id === 'string' &&
          x.id &&
          KINDS.indexOf(x.kind) >= 0
        );
      }),
      hasMore: d.hasMore === true,
      scope: d.scope === 'all' || d.scope === 'company' ? d.scope : 'mine',
    };
  }
  /** 첫 쪽부터 다시 읽는다 — 열어 둔 줄이 목록에서 빠졌으면 닫는다 */
  async function reloadList() {
    J.page = 1;
    var got = await fetchPage(1);
    J.items = got ? got.items : null;
    J.hasMore = got ? got.hasMore : false;
    if (got) J.scope = got.scope;
    var openId = J.openId;
    var still = (J.items || []).some(function (x) {
      return x.id === openId;
    });
    if (J.openId && !still) {
      J.openId = null;
      J.detail = null;
      J.asking = '';
      J.err = '';
    }
    return !!got;
  }

  // ── 그리기 ──────────────────────────────────────────
  function btn(act, label, solid) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (J.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function filterHtml() {
    return (
      '<div class="cs-choices oo-filter" role="group" aria-label="상태로 거르기">' +
      FILTERS.map(function (f) {
        var on = J.filter === f[0];
        return (
          '<button type="button" class="mk-btn' +
          (on ? ' mk-btn--solid' : '') +
          '" data-act="filter" data-filter="' +
          f[0] +
          '" aria-pressed="' +
          on +
          '"' +
          (J.busy ? ' disabled' : '') +
          '>' +
          esc(f[1]) +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }
  function fact(name, value) {
    return value ? '<div><dt>' + esc(name) + '</dt><dd>' + esc(value) + '</dd></div>' : '';
  }
  function detailHtml() {
    var d = J.detail;
    if (d === 'loading') return '<p class="sg-note">' + esc(TEXT.loading) + '</p>';
    if (!d) return '<p class="me-pt-msg" role="status">' + esc(TEXT.detailFail) + '</p>';
    var facts =
      '<dl class="me-facts oo-facts">' +
      fact('상태', statusName(d.status)) +
      fact('꾸러미', packOf(d)) +
      fact('업체', vendorOf(d)) +
      fact('수량', qtyOf(d)) +
      fact('발주일', orderedOf(d) ? dayLabel(orderedOf(d)) : '') +
      fact(
        '입고 예정',
        expectedOf(d) ? dayLabel(expectedOf(d)) + (isLate(d) ? ' — ' + TEXT.late : '') : ''
      ) +
      fact('입고한 날', d.status === 'received' && receivedOf(d) ? dayLabel(receivedOf(d)) : '') +
      fact('문서 번호', str(obj(d.body).doc_no)) +
      fact('메모', str(d.note)) +
      '</dl>';
    var err =
      '<p class="mk-error" data-err role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p>';
    var acts = '';
    if (canChange(d)) {
      acts = J.asking
        ? '<div class="pw-ask oo-ask"><p>' +
          esc((J.asking === 'received' ? TEXT.receiveAsk : TEXT.cancelAsk) + ' ' + TEXT.noUndo) +
          '</p><div class="rd-acts">' +
          btn('yes', J.asking === 'received' ? TEXT.receive : TEXT.cancel, true) +
          btn('no', TEXT.keep) +
          '</div></div>'
        : '<div class="rd-acts">' +
          btn('receive', TEXT.receive, true) +
          btn('cancel', TEXT.cancel) +
          '</div>';
    } else if (d.status === 'ordered') {
      acts = '<p class="mk-note">' + esc(TEXT.readOnly) + '</p>';
    }
    return '<div class="ad-detail">' + facts + err + acts + '</div>';
  }
  function rowHtml(r) {
    var open = J.openId === r.id;
    var days = daysText(r);
    var sub = subText(r);
    return (
      '<li class="me-cs-item oo-item' +
      (r.status === 'cancelled' ? ' me-cs-item--off' : '') +
      '" data-order="' +
      esc(r.id) +
      '"><button type="button" class="ad-pick" data-act="open" data-id="' +
      esc(r.id) +
      '" aria-expanded="' +
      open +
      '"><span class="me-c-main"><b>' +
      esc(str(r.title) || TEXT.title) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      (days ? '<small>' + esc(days) + '</small>' : '') +
      '</span><span class="ad-status oo-status">' +
      esc(statusName(r.status)) +
      (isLate(r) ? '<span class="od-badge oo-late">' + esc(TEXT.late) + '</span>' : '') +
      '</span></button>' +
      (open ? detailHtml() : '') +
      '</li>'
    );
  }
  /** 다담 공장 구성원은 업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다 */
  function showSection() {
    var section = $('partner');
    var box = $('outsourceOrders');
    if (section && box && !box.hidden) section.hidden = false;
  }
  function render() {
    var box = $('outsourceOrders');
    if (!box) return;
    var body;
    if (J.items === null)
      body = '<p class="me-pt-msg" role="status">' + esc(TEXT.loadFail) + '</p>';
    else if (!J.items.length)
      body = '<p class="me-empty">' + esc(TEXT.empty[J.filter] || TEXT.empty['']) + '</p>';
    else
      body =
        '<ul class="me-cs-list oo-list">' +
        J.items.map(rowHtml).join('') +
        '</ul>' +
        (J.hasMore ? '<div class="rd-acts">' + btn('more', TEXT.more) + '</div>' : '');
    box.innerHTML =
      '<h3 class="me-pt-sub" id="outsourceOrdersTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(
        (J.scope === 'all'
          ? TEXT.scopeAll
          : J.scope === 'company'
            ? TEXT.scopeCompany
            : TEXT.scopeMine) +
          ' ' +
          TEXT.help
      ) +
      '</p>' +
      filterHtml() +
      '<p class="me-pt-msg" data-oo="msg" role="status">' +
      esc(J.msg) +
      '</p>' +
      body;
    if (J.busy) box.setAttribute('aria-busy', 'true');
    else box.removeAttribute('aria-busy');
    box.hidden = false;
    showSection();
  }

  // ── 누른 일 ─────────────────────────────────────────
  async function pickFilter(filter) {
    var known = FILTERS.some(function (f) {
      return f[0] === filter;
    });
    if (!known || filter === J.filter || J.busy) return;
    J.filter = filter;
    J.openId = null;
    J.detail = null;
    J.asking = '';
    J.err = '';
    J.msg = '';
    J.busy = true;
    render();
    await reloadList();
    J.busy = false;
    render();
  }
  async function openDetail(id) {
    J.openId = id;
    J.detail = 'loading';
    J.asking = '';
    J.err = '';
    render();
    var r = await call('GET', '/reports/' + encodeURIComponent(id));
    if (J.openId !== id) return;
    var d = r.ok && r.body.data && typeof r.body.data === 'object' ? r.body.data : null;
    J.detail = d && KINDS.indexOf(d.kind) >= 0 ? d : null;
    render();
  }
  /** 상태 바꾸기 — 입고 · 취소 (되물은 뒤에만 부른다) */
  async function change(status) {
    var d = J.detail;
    if (!d || d === 'loading' || J.busy || !canChange(d)) return;
    if (status !== 'received' && status !== 'cancelled') return;
    J.busy = true;
    J.err = '';
    render();
    var r = await call('PATCH', '/reports/' + encodeURIComponent(d.id), { status: status });
    if (!r.ok) {
      J.busy = false;
      J.err = errText(r);
      render();
      return;
    }
    J.detail = Object.assign({}, d, obj(r.body.data));
    J.asking = '';
    J.msg = status === 'received' ? TEXT.received : TEXT.cancelled;
    await reloadList();
    J.busy = false;
    render();
  }
  async function more() {
    if (J.busy || !J.hasMore) return;
    J.busy = true;
    render();
    var got = await fetchPage(J.page + 1);
    J.busy = false;
    if (got) {
      J.page += 1;
      J.items = (J.items || []).concat(got.items);
      J.hasMore = got.hasMore;
    } else J.msg = TEXT.loadFail;
    render();
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'filter') return pickFilter(el.getAttribute('data-filter') || '');
    if (act === 'more') return more();
    if (act === 'open') {
      var id = el.getAttribute('data-id');
      J.msg = '';
      if (J.openId === id) {
        J.openId = null;
        J.detail = null;
        J.asking = '';
        J.err = '';
        render();
        return;
      }
      return openDetail(id);
    }
    var d = J.detail && J.detail !== 'loading' ? J.detail : null;
    if (!d || !canChange(d)) return;
    if (act === 'receive' || act === 'cancel') {
      J.asking = act === 'receive' ? 'received' : 'cancelled';
      J.err = '';
      render();
      return;
    }
    if (act === 'no') {
      J.asking = '';
      render();
      return;
    }
    if (act === 'yes' && J.asking) return change(J.asking);
  }

  /**
   * 업체 칸을 읽은 뒤 부른다 (segan/me.js). 다담 공장 구성원 · Expert · Agent 업체 구성원만 — 목록을 못 읽으면 칸째 감춘다.
   * 읽기만 한다 — 여는 것만으로는 아무것도 바꾸거나 보내지 않는다
   */
  async function load(sb, session, me) {
    var box = $('outsourceOrders');
    if (!box) return;
    var hide = function () {
      box.hidden = true;
      box.innerHTML = '';
      J.ready = false;
    };
    hide();
    var cfg = window.DADAM_CONFIG || {};
    J.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    J.sb = sb;
    J.session = session;
    J.me = me;
    J.filter = 'ordered';
    J.page = 1;
    J.hasMore = false;
    J.scope = '';
    J.items = null;
    J.openId = null;
    J.detail = null;
    J.asking = '';
    J.err = '';
    J.msg = '';
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await reloadList())) return;
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
      }
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganOutsourceOrders = {
    KINDS: KINDS,
    PACK_NAME: PACK_NAME,
    STATUS_NAME: STATUS_NAME,
    FILTERS: FILTERS,
    TEXT: TEXT,
    canSee: canSee,
    kstDay: kstDay,
    dayLabel: dayLabel,
    packOf: packOf,
    expectedOf: expectedOf,
    isLate: isLate,
    subText: subText,
    daysText: daysText,
    listPath: listPath,
    canChange: canChange,
    state: J,
    load: load,
  };
})();
