/* ============================================================
   segan/quotes.js — 「프로젝트 관리 › 영업 › 견적」 의 견적서 목록 (segan/me.html #quotes)

   마이페이지 B안 5단계 — 업체가 낸 견적서(고객 확인서)를 한 화면에 모아 본다.
   지금까지는 PC 상세설계에서 설계를 하나씩 열어야 볼 수 있었다.

   누가 보나  프로젝트를 가지는 업체의 구성원 — 다담 공장 구성원(account-api GET /partner/me 의 hq_member) ·
             협력업체 Manager · Expert · Agent 구성원 (대표 · 실장 · 직원 모두 — 서버 GET /company/projects 와 같은 판정).
             다담 본사 구성원 · 업체 없는 사람 · 고객에게는 그려지지 않는다. segan/me.js 가 업체 칸(segan/partner.js)을
             읽은 뒤 SeganQuotes.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data })
               GET /company/quotes   { company, items[{ id, doc_no, rev, status, title, created_at, expires_at,
                                       first_viewed_at, view_count, decision, decided_at, superseded,
                                       totals { subtotal, vat, total } | null, design { id, name },
                                       project { id, title } | null, customer_name }] } — 새 것부터 200건
             금액은 고객에게 나간 금액뿐이다 (원가 · 마진은 서버가 싣지 않는다) — 구성원 누구나 본다.
   화면      거르기 단추(전체 · 답 기다림 · 고객 확인 완료 · 수정 요청 — 건수) → 견적서 줄
             (고객 이름 · 프로젝트 / 설계 · 보낸 날 · 번호 · 판 · 상태 · 합계 · 열람 횟수 · 결정한 날).
             보기만 한다 — 견적서를 내고 거두는 일은 지금처럼 PC 상세설계에서.
   못 읽으면  칸째 감춘다 (오류 · 끊김 · 권한 없음) — 견적 화면에는 견적 단계 프로젝트만 남는다.
   정보      고객 이름 · 금액은 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['manager', 'expert', 'agent']; // 프로젝트를 가지는 협력업체 등급 (서버 PROJECT_PLANS)
  // 거르기 — 키 · 이름
  var FILTERS = [
    ['all', '전체'],
    ['waiting', '답 기다림'],
    ['approved', '고객 확인 완료'],
    ['rejected', '수정 요청'],
  ];

  var TEXT = {
    title: '견적서',
    note: '고객에게 보낸 견적서(고객 확인서)입니다. 새 것부터 200건까지 나옵니다. 견적서를 내고 거두는 일은 PC 상세설계에서 합니다.',
    filter: '거르기',
    count: '건',
    empty: '보낸 견적서가 없습니다.',
    emptyFilter: '여기에 드는 견적서가 없습니다.',
    noCustomer: '고객 이름 없음',
    noDesign: '이름 없는 설계',
    rev: '판',
    total: '합계',
    supply: '공급가',
    vat: '부가세',
    seen: '열람',
    notSeen: '아직 안 봄',
    times: '번',
    first: '처음',
    decided: '결정',
    expires: '기한',
    // 상태 — 결정이 먼저, 그다음 문서 상태 (PC 상세설계 문서 목록의 말과 같다)
    approved: '고객 확인 완료',
    rejected: '수정 요청',
    revoked: '거둠',
    superseded: '지난 판',
    waiting: '답 기다림',
  };

  var Q = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    items: [],
    filter: 'all',
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

  /** 이 칸을 읽어 볼 사람인가 — 다담 공장 구성원 · 협력업체 Manager · Expert · Agent 구성원 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.platform_member === true) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    return c.status === 'active' && PLANS.indexOf(c.plan) >= 0;
  }

  /** 한국 시간 'MM.DD' */
  function day(iso) {
    var t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000).toISOString();
    return k.slice(5, 7) + '.' + k.slice(8, 10);
  }

  function won(v) {
    return v === null ? '' : v.toLocaleString('ko-KR') + '원';
  }

  /** 견적서 한 줄의 상태 키 — 결정(승인 · 수정 요청)이 먼저, 그다음 거둠 · 지난 판, 나머지는 답 기다림 */
  function stateOf(x) {
    if (x.decision === 'approved') return 'approved';
    if (x.decision === 'rejected') return 'rejected';
    if (x.status === 'revoked') return 'revoked';
    if (x.superseded || x.status === 'superseded') return 'superseded';
    return 'waiting';
  }

  /** 서버가 준 줄 하나 — id 없는 줄은 버린다 */
  function rowOf(v) {
    var r = obj(v);
    var id = typeof r.id === 'string' ? r.id : '';
    if (!id) return null;
    var t = obj(r.totals);
    var row = {
      id: id,
      docNo: str(r.doc_no).trim(),
      rev: num(r.rev),
      status: str(r.status),
      decision: str(r.decision),
      superseded: r.superseded === true,
      title: str(r.title).trim(),
      at: str(r.created_at),
      expiresAt: str(r.expires_at),
      firstViewedAt: str(r.first_viewed_at),
      views: num(r.view_count) || 0,
      decidedAt: str(r.decided_at),
      total: num(t.total),
      subtotal: num(t.subtotal),
      vat: num(t.vat),
      design: str(obj(r.design).name).trim(),
      project: str(obj(r.project).title).trim(),
      customer: str(r.customer_name).trim(),
    };
    row.state = stateOf(row);
    return row;
  }

  /** 목록 — 배열이 아니면 null (이상한 답 → 칸을 감춘다) */
  function listOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(rowOf).filter(Boolean);
  }

  /** 거르기마다 몇 건 */
  function counts(rows) {
    var n = { all: rows.length, waiting: 0, approved: 0, rejected: 0 };
    rows.forEach(function (r) {
      if (Object.prototype.hasOwnProperty.call(n, r.state) && r.state !== 'all') n[r.state] += 1;
    });
    return n;
  }

  function filtered(rows, key) {
    return key === 'all'
      ? rows
      : rows.filter(function (r) {
          return r.state === key;
        });
  }

  /** 줄 아랫글 — 보낸 날 · 번호 · 판 */
  function subOf(r) {
    return [day(r.at), r.docNo, r.rev === null ? '' : r.rev + TEXT.rev].filter(Boolean).join(' · ');
  }

  /** 합계 글 — '합계 (공급가 … + 부가세 …)'. 합계가 없으면 빈 글 */
  function totalText(r) {
    if (r.total === null) return '';
    return (
      won(r.total) +
      (r.subtotal !== null && r.vat !== null
        ? ' (' + TEXT.supply + ' ' + won(r.subtotal) + ' + ' + TEXT.vat + ' ' + won(r.vat) + ')'
        : '')
    );
  }

  /** 고객이 본 횟수 글 */
  function seenText(r) {
    if (!r.views) return TEXT.notSeen;
    var first = day(r.firstViewedAt);
    return r.views + TEXT.times + (first ? ' (' + TEXT.first + ' ' + first + ')' : '');
  }

  async function token() {
    try {
      var r = Q.sb && (await Q.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return Q.session ? Q.session.access_token : '';
  }

  async function read() {
    var res;
    try {
      res = await fetch(Q.base + '/company/quotes', {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
    } catch {
      return null;
    }
    var b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    b = b && typeof b === 'object' ? b : {};
    if (!res.ok || b.success !== true) return null;
    return listOf(b.data);
  }

  function box() {
    return $('quotes');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function filtersHtml() {
    var n = counts(Q.items);
    return (
      '<div class="al-cats" role="group" aria-label="' +
      esc(TEXT.filter) +
      '">' +
      FILTERS.map(function (f) {
        return (
          '<button type="button" class="mk-btn dr-day al-cat" data-act="filter" data-filter="' +
          f[0] +
          '" aria-pressed="' +
          (Q.filter === f[0] ? 'true' : 'false') +
          '">' +
          esc(f[1] + ' ' + n[f[0]]) +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function fact(k, v) {
    return v ? '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>' : '';
  }

  function rowHtml(r) {
    var what = r.project || r.design || r.title || TEXT.noDesign;
    var done = r.state === 'approved' || r.state === 'rejected';
    return (
      '<li class="me-cs-item dr-item qt-item' +
      (r.state === 'revoked' || r.state === 'superseded' ? ' me-cs-item--off' : '') +
      '" data-qt-row="' +
      esc(r.id) +
      '"><div class="dr-head"><span class="me-c-main"><b>' +
      esc((r.customer || TEXT.noCustomer) + ' · ' + what) +
      '</b><small>' +
      esc(subOf(r)) +
      '</small></span><span class="me-badge dr-kind' +
      (r.state === 'approved' || r.state === 'rejected' ? ' as-late' : '') +
      '">' +
      esc(TEXT[r.state]) +
      '</span></div><dl class="me-facts al-facts">' +
      fact(TEXT.total, totalText(r)) +
      fact(TEXT.seen, seenText(r)) +
      fact(TEXT.decided, done ? day(r.decidedAt) : '') +
      fact(TEXT.expires, r.state === 'waiting' ? day(r.expiresAt) : '') +
      '</dl></li>'
    );
  }

  function listHtml() {
    if (!Q.items.length) return '<p class="me-empty" data-qt="empty">' + esc(TEXT.empty) + '</p>';
    var list = filtered(Q.items, Q.filter);
    if (!list.length)
      return '<p class="me-empty" data-qt="empty">' + esc(TEXT.emptyFilter) + '</p>';
    return '<ul class="me-cs-list dr-list">' + list.map(rowHtml).join('') + '</ul>';
  }

  function render() {
    var b = box();
    if (!b || !Q.ready) return;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="quotesTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note) +
      '</p>' +
      (Q.items.length ? filtersHtml() : '') +
      listHtml();
    b.hidden = false;
    var sec = $('partner');
    if (sec) sec.hidden = false;
  }

  function hide() {
    var b = box();
    if (b) {
      b.hidden = true;
      b.innerHTML = '';
    }
    Q.ready = false;
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="filter"]') : null;
    if (!el) return;
    var key = el.getAttribute('data-filter') || '';
    var known = FILTERS.some(function (f) {
      return f[0] === key;
    });
    if (!known || key === Q.filter) return;
    Q.filter = key;
    render();
    var b = box();
    var again = b && b.querySelector('[data-act="filter"][data-filter="' + key + '"]');
    if (again && again.focus) again.focus();
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 볼 사람이 아니거나 못 읽으면 칸을 감춘 채 둔다 */
  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    Q.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    Q.sb = sb || null;
    Q.session = session || null;
    Q.items = [];
    Q.filter = 'all';
    if (!Q.base || !session || !canSee(me)) return;
    try {
      var list = await read();
      if (!list) return;
      Q.items = list;
      bind();
      Q.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganQuotes = {
    PLANS: PLANS,
    FILTERS: FILTERS,
    TEXT: TEXT,
    canSee: canSee,
    day: day,
    won: won,
    stateOf: stateOf,
    rowOf: rowOf,
    listOf: listOf,
    counts: counts,
    filtered: filtered,
    subOf: subOf,
    totalText: totalText,
    seenText: seenText,
    state: Q,
    load: load,
  };
})();
