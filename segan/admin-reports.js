/* ============================================================
   segan/admin-reports.js — 「관리 › 작업 보고」 (segan/admin.html#reports)

   누가      관리자 — segan/admin.js 가 관리자일 때만 부른다. 메모 · 고정 · 보관 · 발주 상태는 서버가 준
             can_edit(주인 또는 admin 이상)일 때만 (서버도 같은 판정)
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message })
               GET   /reports/summary            이번 주 지시 · 결정 안 한 제안 · 지연 예상 주문 · 이번 달 추가 인건비
               GET   /reports?kind=&page=        목록 (30개씩, hasMore)
               GET   /reports/:id                한 건 (can_edit)
               PATCH /reports/:id                { note } · { pinned } · { archived } · 외주 · 상판 발주 { status: received | cancelled }
   화면      PC admin/work-reports.html 의 보기 · 확인을 폰 한 줄로: 숫자 넷 · 종류 고르기 · 보고 줄(날 · 종류 · 제목 ·
             숫자 요약 · 상태) · 더 보기 → 누르면 그 자리에 기간 · 숫자 요약 · 메모 · 단추(고정 · 보관 · 입고 처리 ·
             발주 취소 — 되묻기는 화면 안에서). 인쇄 · 생산 계획 승인 · 기간 · 글자 거르기 · 새 메모는 PC에서.
   이름      종류 · 상태 · 숫자 요약 = admin/work-reports.html KINDS · STATUS_NAME · metricsText (시험이 본다)
   못 읽으면  그 자리에 한 줄 안내. 바꾸지 못하면 서버 글을 그 자리에.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var KINDS = [
    ['', '전체'],
    ['production_plan', '생산 계획'],
    ['staffing_decision', '인력 승인'],
    ['daily_brief', '아침 요약'],
    ['work_order', '작업지시서'],
    ['installation_order', '설치 지시서'],
    ['outsource_order', '외주 발주'],
    ['countertop_order', '상판 발주'],
    ['monthly_close', '월 마감'],
    ['note', '메모'],
  ]; // admin/work-reports.html
  var KIND_NAME = {};
  KINDS.forEach(function (k) {
    if (k[0]) KIND_NAME[k[0]] = k[1];
  });
  var STATUS_NAME = {
    pending: '결정 전',
    approved: '승인',
    dismissed: '무시',
    superseded: '대체됨',
    issued: '발행',
    viewed: '열람',
    sent: '보냄',
    failed: '보내기 실패',
    ordered: '발주',
    received: '입고',
    cancelled: '취소',
    instructed: '지시',
    done: '완료',
  }; // admin/work-reports.html
  var WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  var ORDER_KINDS = ['outsource_order', 'countertop_order'];
  var PC_PAGE = '../admin/work-reports.html';
  var TEXT = {
    loadFail: '보고를 불러오지 못했습니다.',
    detailFail: '이 보고를 불러오지 못했습니다.',
    empty: '보고가 없습니다.',
    readOnly: '읽기만 할 수 있습니다 (admin 이상이 바꿉니다)',
    cancelAsk: '이 외주 발주를 취소로 바꿀까요? (기록은 남습니다)',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var R = {
    sb: null,
    session: null,
    base: '',
    kind: '',
    page: 1,
    hasMore: false,
    items: null, // 목록 | null(못 읽음)
    summary: null,
    openId: null,
    detail: null, // 한 건 | 'loading' | null(못 읽음)
    asking: false, // 발주 취소 되묻기
    err: '',
    msg: '',
    busy: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 글자 — admin/work-reports.html 과 같다 ──────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(n) {
    return n === null || n === undefined || n === '' || !isFinite(Number(n))
      ? '-'
      : Number(n).toLocaleString('ko-KR');
  }

  function won(n) {
    return n === null || n === undefined
      ? '-'
      : Math.round(Number(n) / 10000).toLocaleString('ko-KR') + '만';
  }

  function kstDay(iso) {
    var t = iso ? new Date(iso) : new Date();
    return new Date(t.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  function dayLabel(s) {
    if (!s) return '-';
    var d = new Date(String(s).slice(0, 10) + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '-';
    return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + '(' + WEEKDAY[d.getUTCDay()] + ')';
  }

  /** 숫자 요약 한 줄 — admin/work-reports.html metricsText 와 같다 */
  function metricsText(r) {
    var m = r.metrics || {};
    switch (r.kind) {
      case 'production_plan':
        return (
          '주문 ' +
          num(m.jobs) +
          ' · 지연 ' +
          num(m.lateBefore) +
          '→' +
          num(m.lateAfter) +
          ' · 추가 ' +
          won(m.extraCost) +
          ' · 추천 ' +
          num(m.suggestions)
        );
      case 'staffing_decision':
        return '지시 ' + num(m.assignments) + ' · ' + won(m.cost);
      case 'daily_brief':
        return (
          '재단 ' +
          num(m.cut) +
          '% · 엣지 ' +
          num(m.edge) +
          '% · 조립 ' +
          num(m.asm) +
          '%(' +
          num(m.asmPeople) +
          '명) · 오늘 지시 ' +
          num(m.todays) +
          ' · 지연 ' +
          num(m.late)
        );
      case 'work_order':
        return 'rev ' + num(m.rev) + ' · 원판 ' + num(m.sheets) + ' · 라벨 ' + num(m.labels);
      case 'installation_order':
        return 'rev ' + num(m.rev);
      case 'monthly_close':
        return '매출 ' + won(m.revenue) + ' · 손익 ' + won(m.net);
      case 'countertop_order':
      case 'outsource_order':
        return (
          (m.vendor || '') +
          ' · ' +
          (m.qty || '') +
          (m.expected ? ' · 입고 예정 ' + dayLabel(m.expected) : '')
        );
      default:
        return r.note ? String(r.note).slice(0, 60) : '';
    }
  }

  function statusName(s) {
    return s ? STATUS_NAME[s] || s : '';
  }

  // ── 그리기 ─────────────────────────────────────────────
  function summaryHtml(s) {
    if (!s) return '';
    return (
      '<dl class="me-facts ad-kpis">' +
      '<div><dt>이번 주 지시</dt><dd>' +
      esc(num(s.weekAssignments)) +
      '</dd></div>' +
      '<div><dt>결정 안 한 제안</dt><dd>' +
      esc(num(s.pendingProposals)) +
      '</dd></div>' +
      '<div><dt>지연 예상 주문</dt><dd>' +
      esc(s.lateOrders === null || s.lateOrders === undefined ? '-' : num(s.lateOrders)) +
      (s.lateAsOf ? ' (' + esc(dayLabel(s.lateAsOf)) + ' 아침)' : '') +
      '</dd></div>' +
      '<div><dt>이번 달 추가 인건비</dt><dd>' +
      esc(won(s.monthExtraCost)) +
      '</dd></div>' +
      '</dl>'
    );
  }

  function kindSelectHtml() {
    return (
      '<label class="mk-input ad-kind"><span>종류</span><select name="kind"' +
      (R.busy ? ' disabled' : '') +
      '>' +
      KINDS.map(function (k) {
        return (
          '<option value="' +
          esc(k[0]) +
          '"' +
          (k[0] === R.kind ? ' selected' : '') +
          '>' +
          esc(k[1]) +
          '</option>'
        );
      }).join('') +
      '</select></label>'
    );
  }

  function btn(act, label, solid) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (R.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function detailHtml() {
    var d = R.detail;
    if (d === 'loading') return '<p class="sg-note">불러오는 중…</p>';
    if (!d) return '<p class="me-pt-msg" role="status">' + esc(TEXT.detailFail) + '</p>';
    var period = d.period_start
      ? dayLabel(d.period_start) +
        (d.period_end && d.period_end !== d.period_start ? ' ~ ' + dayLabel(d.period_end) : '')
      : '';
    var facts =
      '<dl class="me-facts">' +
      (period ? '<div><dt>기간</dt><dd>' + esc(period) + '</dd></div>' : '') +
      '<div><dt>기록</dt><dd>' +
      esc(kstDay(d.created_at)) +
      '</dd></div>' +
      (d.status ? '<div><dt>상태</dt><dd>' + esc(statusName(d.status)) + '</dd></div>' : '') +
      '<div><dt>요약</dt><dd>' +
      esc(metricsText(d) || '-') +
      '</dd></div>' +
      '</dl>';
    var plan =
      d.kind === 'production_plan' && d.status === 'pending' && d.source_id
        ? '<ul class="sg-rows"><li><a class="sg-row" href="../production.html?p=' +
          encodeURIComponent(d.source_id) +
          '">생산 계획 화면에서 승인 · 무시 (PC)</a></li></ul>'
        : '';
    var canEdit = d.can_edit === true;
    var err =
      '<p class="mk-error" data-err role="alert"' +
      (R.err ? '' : ' hidden') +
      '>' +
      esc(R.err) +
      '</p>';
    if (!canEdit) {
      return (
        '<div class="ad-detail">' +
        facts +
        plan +
        (d.note ? '<p class="mk-note">' + esc(d.note) + '</p>' : '') +
        '<p class="mk-note">' +
        esc(TEXT.readOnly) +
        '</p></div>'
      );
    }
    var order = ORDER_KINDS.indexOf(d.kind) >= 0 && d.status === 'ordered';
    var acts = R.asking
      ? '<div class="ad-panel"><p class="mk-note">' +
        esc(TEXT.cancelAsk) +
        '</p><div class="rd-acts">' +
        btn('cancel-yes', '발주 취소', true) +
        btn('cancel-no', '그대로 두기') +
        '</div></div>'
      : '<div class="rd-acts">' +
        btn('note', '메모 저장', true) +
        btn('pin', d.pinned ? '고정 해제' : '고정') +
        btn('archive', d.archived_at ? '보관 해제' : '보관 처리') +
        (order ? btn('received', '입고 처리') + btn('cancel', '발주 취소') : '') +
        '</div>';
    return (
      '<div class="ad-detail">' +
      facts +
      plan +
      '<label class="mk-input"><span>메모</span><textarea name="note" rows="3" maxlength="4000">' +
      esc(d.note || '') +
      '</textarea></label>' +
      err +
      acts +
      '</div>'
    );
  }

  function rowHtml(r) {
    var open = R.openId === r.id;
    var sub = [dayLabel(kstDay(r.created_at)), KIND_NAME[r.kind] || r.kind, metricsText(r)]
      .filter(Boolean)
      .join(' · ');
    return (
      '<li class="me-cs-item' +
      (r.archived_at ? ' me-cs-item--off' : '') +
      '" data-report="' +
      esc(r.id) +
      '"><button type="button" class="ad-pick" data-act="open" data-id="' +
      esc(r.id) +
      '" aria-expanded="' +
      open +
      '"><span class="me-c-main"><b>' +
      (r.pinned ? '📌 ' : '') +
      esc(r.title || '보고') +
      '</b><small>' +
      esc(sub) +
      '</small></span><span class="ad-status">' +
      esc(statusName(r.status)) +
      '</span></button>' +
      (open ? detailHtml() : '') +
      '</li>'
    );
  }

  function render() {
    var box = $('adReportsBody');
    if (!box) return;
    var body;
    if (R.items === null)
      body = '<p class="me-pt-msg" role="status">' + esc(TEXT.loadFail) + '</p>';
    else if (!R.items.length) body = '<p class="me-empty">' + esc(TEXT.empty) + '</p>';
    else
      body =
        '<ul class="me-cs-list ad-list">' +
        R.items.map(rowHtml).join('') +
        '</ul>' +
        (R.hasMore ? '<div class="rd-acts">' + btn('more', '더 보기') + '</div>' : '');
    box.innerHTML =
      summaryHtml(R.summary) +
      kindSelectHtml() +
      (R.msg ? '<p class="me-pt-msg" role="status">' + esc(R.msg) + '</p>' : '') +
      body +
      '<ul class="sg-rows ad-more"><li><a class="sg-row" href="' +
      PC_PAGE +
      '">인쇄 · 기간 거르기 · 새 메모는 PC에서</a></li></ul>';
  }

  // ── 서버 ───────────────────────────────────────────────
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

  async function call(method, path, body) {
    if (!R.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(R.base + path, {
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

  function listPath(page) {
    return (
      '/reports?' + (R.kind ? 'kind=' + encodeURIComponent(R.kind) + '&' : '') + 'page=' + page
    );
  }

  /** 목록 한 쪽 → { items, hasMore } | null */
  async function fetchPage(page) {
    var r = await call('GET', listPath(page));
    var d = r.ok ? r.body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return {
      items: d.items.filter(function (x) {
        return x && typeof x === 'object' && typeof x.id === 'string' && x.id;
      }),
      hasMore: d.hasMore === true,
    };
  }

  async function fetchSummary() {
    var r = await call('GET', '/reports/summary');
    var d = r.ok ? r.body.data : null;
    return d && typeof d === 'object' ? d : null;
  }

  async function reloadList() {
    R.page = 1;
    var got = await fetchPage(1);
    R.items = got ? got.items : null;
    R.hasMore = got ? got.hasMore : false;
    var openId = R.openId;
    var still = (R.items || []).some(function (x) {
      return x.id === openId;
    });
    if (R.openId && !still) {
      R.openId = null;
      R.detail = null;
    }
  }

  async function openDetail(id) {
    R.openId = id;
    R.detail = 'loading';
    R.asking = false;
    R.err = '';
    render();
    var r = await call('GET', '/reports/' + encodeURIComponent(id));
    if (R.openId !== id) return;
    R.detail = r.ok && r.body.data && typeof r.body.data === 'object' ? r.body.data : null;
    render();
  }

  async function patch(body, okMsg) {
    var d = R.detail;
    if (!d || d === 'loading' || R.busy) return;
    R.busy = true;
    R.err = '';
    var noteNow = noteValue();
    render();
    var r = await call('PATCH', '/reports/' + encodeURIComponent(d.id), body);
    R.busy = false;
    if (!r.ok) {
      R.err = errText(r);
      render();
      setNote(noteNow);
      return;
    }
    R.detail = Object.assign({}, d, r.body.data || {});
    R.asking = false;
    R.msg = okMsg;
    await reloadList();
    render();
  }

  function noteValue() {
    var el = document.querySelector('#adReportsBody textarea[name="note"]');
    return el ? el.value : null;
  }

  function setNote(v) {
    var el = document.querySelector('#adReportsBody textarea[name="note"]');
    if (el && v !== null) el.value = v;
  }

  async function more() {
    if (R.busy || !R.hasMore) return;
    R.busy = true;
    render();
    var got = await fetchPage(R.page + 1);
    R.busy = false;
    if (got) {
      R.page += 1;
      R.items = (R.items || []).concat(got.items);
      R.hasMore = got.hasMore;
    } else R.msg = TEXT.loadFail;
    render();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || R.busy) return;
    var act = el.getAttribute('data-act');
    var d = R.detail && R.detail !== 'loading' ? R.detail : null;
    if (act === 'open') {
      var id = el.getAttribute('data-id');
      R.msg = '';
      if (R.openId === id) {
        R.openId = null;
        R.detail = null;
        render();
        return;
      }
      return openDetail(id);
    }
    if (act === 'more') return more();
    if (!d) return;
    if (act === 'note') return patch({ note: noteValue() || '' }, '메모를 저장했습니다.');
    if (act === 'pin')
      return patch({ pinned: !d.pinned }, d.pinned ? '고정을 풀었습니다.' : '고정했습니다.');
    if (act === 'archive')
      return patch(
        { archived: !d.archived_at },
        d.archived_at
          ? '보관을 풀었습니다.'
          : '보관 처리했습니다 (목록에서 숨김 — 지우지 않습니다).'
      );
    if (act === 'received') return patch({ status: 'received' }, '입고 처리했습니다.');
    if (act === 'cancel') {
      var keep = noteValue();
      R.asking = true;
      render();
      setNote(keep);
      return;
    }
    if (act === 'cancel-no') {
      R.asking = false;
      render();
      return;
    }
    if (act === 'cancel-yes') return patch({ status: 'cancelled' }, '발주를 취소로 바꿨습니다.');
  }

  async function onChange(e) {
    var el = e.target;
    if (!el || el.name !== 'kind' || R.busy) return;
    var v = el.value;
    var known = KINDS.some(function (k) {
      return k[0] === v;
    });
    if (!known) return;
    R.kind = v;
    R.openId = null;
    R.detail = null;
    R.msg = '';
    R.busy = true;
    render();
    await reloadList();
    R.busy = false;
    render();
  }

  /** 작업 보고 칸 채우기 — admin.js 가 #reports 로 올 때 부른다 */
  async function load(sb, session) {
    var box = $('adReportsBody');
    if (!box) return;
    var cfg = window.DADAM_CONFIG || {};
    R.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    R.sb = sb;
    R.session = session;
    R.kind = '';
    R.openId = null;
    R.detail = null;
    R.asking = false;
    R.err = '';
    R.msg = '';
    R.busy = false;
    if (!box.getAttribute('data-bound')) {
      box.setAttribute('data-bound', '1');
      box.addEventListener('click', onClick);
      box.addEventListener('change', onChange);
    }
    box.innerHTML = '<p class="sg-note">불러오는 중…</p>';
    var got = await Promise.all([fetchSummary(), reloadList()]);
    R.summary = got[0];
    render();
  }

  window.SeganAdminReports = {
    KINDS: KINDS,
    STATUS_NAME: STATUS_NAME,
    state: R,
    metricsText: metricsText,
    dayLabel: dayLabel,
    load: load,
  };
})();
