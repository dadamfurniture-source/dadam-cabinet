/* ============================================================
   segan/books.js — 「내 정보 › 업체」 안의 회계 (segan/me.html #meBooks)

   누가 보나  회계 요약은 협력업체 대표 · 실장만 — account-api GET /partner/me 의 company.role.
             직원 · 본사 · 공장 구성원은 아래 장부 · 사진 줄만, 업체 없음은 칸이 없다. segan/me.js 가 업체 칸(segan/partner.js)을
             읽은 뒤 SeganBooks.load(sb, session, partnerMe) 를 부른다 (/partner/me 를 두 번 묻지 않는다).
   데이터    workflow-api GET /books/summary?month=YYYY-MM (본인 토큰) → { success, data }
             data = { company, month, months: [이번 달, 지난달], outstanding, status_counts, upcoming }
   보이는 것  이번 달 · 지난달 — 계약액 · 받은 돈 · 견적 마진 · 실제 마진
               실제 원가가 빠진 수주가 있으면(actual_cost_missing > 0) 실제 마진 옆에 「실제 원가 없음 N건」.
               실제 마진 자리에 다른 값(견적 마진 등)을 채우지 않는다 — 값이 없으면 「-」
             미수 (금액 · 건수) · 상태별 수주 수 · 다가오는 수금 (수주 번호 · 단계 · 금액 · 날짜)
             달 바꾸기 (지난달 · 다음 달 — 이번 달 뒤로는 가지 않는다)
             수주 상세 · 원가 · 수금 입력은 PC ERP(erp.html) 로 보낸다
             회계(segan/ledger.html — 한눈에 · 매출 · 매입 · 사진 탭) · 이번 달 보고서(segan/ledger-report.html) 줄 —
             workflow-api GET /ledger/me 가 그 업체 대표 · 실장에게 답할 때만 (회계 = Agent 업체 · 시험 업체,
             DB 0047). 장부 줄 · 사진이 있는데 등급이 내려간 업체(Expert 로 쓰던 업체 등)는 level read — 보기만:
             「Expert 등급은 장부를 볼 수만 있습니다 — 장부를 쓰려면 Agent 등급이어야 합니다」 + 등급 비교(segan/plans.html)
             다담 본사 · 공장 구성원(/partner/me 에 협력업체가 없다)은 회계 요약 없이 장부 줄만 — 역시 /ledger/me 가 답할 때.
             그때는 업체 칸(#partner)도 연다 (공장 구성원은 segan/partner.js 가 감춰 둔다)
             직원(협력업체 · 본사 · 공장)은 /ledger/me 가 can_upload 로 답할 때 「영수증 올리기」 줄만 — 금액 · 요약 없이
   이름      수주 상태 = erp.html STATUS_LABELS = 워커 order-events.js ORDER_STATUS_LABELS
             수금 단계 = erp.html PAY_STAGE_LABELS = 워커 payments.js (segan/me.js PAY_STAGE 와 같다)
   못 읽으면  처음(403 · 404 · 오류 · 주소 없음 · 모양이 틀림) → 칸째 감춘다.
             달을 바꾸다 못 읽으면 달 바꾸기는 두고 한 줄 안내.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var ROLES = ['owner', 'manager']; // 대표 · 실장
  var ORDER_STATUS = {
    confirmed: '접수',
    in_production: '생산 중',
    delivered: '배송',
    completed: '완료',
    cancelled: '취소',
  }; // erp.html STATUS_LABELS · 워커 order-events.js
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' }; // erp.html · 워커 payments.js
  var METRICS = [
    ['contract_total', '계약액'],
    ['received_total', '받은 돈'],
    ['quote_margin', '견적 마진'],
    ['actual_margin', '실제 마진'],
  ];
  var ERP_PAGE = '../erp.html';
  var LEDGER_PAGE = 'ledger.html';
  var REPORT_PAGE = 'ledger-report.html'; // 인쇄용 월 회계 보고서
  var PLANS_PAGE = 'plans.html'; // 등급 비교 (segan/plans.html)
  // 등급 이름 (company.plan) — segan/partner.js PLAN_LABEL 과 같다. ROLES 의 manager(실장)와 다르다
  var PLAN_LABEL = { manager: 'Manager', expert: 'Expert', agent: 'Agent' };
  var MONTH_RE = /^(\d{4})-(\d{2})$/;
  var FAIL_MSG = '이 달 회계를 불러오지 못했습니다.';

  var B = {
    sb: null,
    session: null,
    base: '', // workflow-api
    month: '', // 보고 있는 달 YYYY-MM
    data: null, // 마지막으로 읽은 data
    err: '',
    busy: false,
    ledger: false, // 장부를 여는가 (GET /ledger/me)
    // GET /ledger/me 의 답 — 'book' 장부(full · read) · 'upload' 사진만 올림 · '' 못 연다. 마이페이지 회계 관리 (segan/me.js)
    ledgerKind: '',
    readOnly: '', // 장부를 보기만 할 때 (level read) 그 까닭 한 줄
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 글자 ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 금액 — 값이 없으면 「-」 (0 으로 채우지 않는다) */
  function money(n) {
    if (n == null || n === '' || !isFinite(Number(n))) return '-';
    return Number(n).toLocaleString('ko-KR') + '원';
  }

  /** 건수 — 값이 없으면 「-」 */
  function count(n) {
    if (n == null || n === '' || !isFinite(Number(n))) return '-';
    return Number(n).toLocaleString('ko-KR');
  }

  /** 'YYYY-MM-DD' → 'YYYY.MM.DD' (날짜만 온 값 — Date 로 바꾸면 시간대에 따라 하루 밀린다) */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s == null ? '' : s));
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }

  // ── 달 ─────────────────────────────────────────────────
  /** 한국 시간 이번 달 'YYYY-MM' */
  function thisMonth(now) {
    var k = new Date((now == null ? Date.now() : now) + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1);
  }

  /** 'YYYY-MM' 에서 by 달 옮긴 달 */
  function shiftMonth(month, by) {
    var m = MONTH_RE.exec(month);
    if (!m) return '';
    var t = Number(m[1]) * 12 + Number(m[2]) - 1 + by;
    return Math.floor(t / 12) + '-' + pad((t % 12) + 1);
  }

  function monthLabel(month) {
    var m = MONTH_RE.exec(month);
    return m ? m[1] + '년 ' + Number(m[2]) + '월' : '';
  }

  function monthShort(month) {
    var m = MONTH_RE.exec(month);
    return m ? Number(m[2]) + '월' : '';
  }

  // ── 판정 (순수 함수 — 시험이 직접 부른다) ─────────────────
  /** 회계를 볼 수 있나 — 업체 대표 · 실장 (본사 구성원 · 직원 · 업체 없음은 아니다) */
  function canSee(me) {
    if (!me || typeof me !== 'object' || me.hq_member) return false;
    var c = me.company;
    return !!(c && typeof c === 'object' && ROLES.indexOf(c.role) >= 0);
  }

  /**
   * 장부를 보기만 할 때(level read)의 한 줄 — 회계(장부 쓰기)는 이용 중인 Agent 팩토리만 (DB 0047).
   * → { text, plans } (plans: 등급 비교 링크를 붙이나)
   */
  function readOnlyNote(company) {
    var c = company && typeof company === 'object' ? company : null;
    if (c && c.status && c.status !== 'active')
      return { text: '팩토리가 이용 중이 아니어서 장부를 볼 수만 있습니다.', plans: false };
    var name = c && c.plan !== 'agent' ? PLAN_LABEL[c.plan] : '';
    return {
      text:
        (name ? name + ' 등급은' : '지금 등급에서는') +
        ' 장부를 볼 수만 있습니다 — 장부를 쓰려면 Agent 등급이어야 합니다.',
      plans: true,
    };
  }

  function readOnlyHtml() {
    if (!B.readOnly) return '';
    var n = B.readOnly;
    return (
      '<p class="mk-note me-bk-ro" role="note">' +
      esc(n.text) +
      (n.plans ? ' <a class="mk-link" href="' + PLANS_PAGE + '">등급 비교</a>' : '') +
      '</p>'
    );
  }

  /** GET /books/summary 본문 → data | null (모양이 틀리면 null) */
  function summaryOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    if (!MONTH_RE.test(String(d.month || '')) || !Array.isArray(d.months)) return null;
    return d;
  }

  /** months 에서 그 달 줄 (없으면 null — 다른 달 값을 끌어오지 않는다) */
  function monthRow(d, month) {
    var list = d && Array.isArray(d.months) ? d.months : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i] === 'object' && list[i].month === month) return list[i];
    }
    return null;
  }

  // ── 그리기 ─────────────────────────────────────────────
  function cell(row, key) {
    if (!row) return '<td>-</td>';
    var miss = Number(row.actual_cost_missing);
    var note =
      key === 'actual_margin' && miss > 0
        ? '<small class="me-bk-miss">실제 원가 없음 ' + esc(count(miss)) + '건</small>'
        : '';
    return '<td>' + esc(money(row[key])) + note + '</td>';
  }

  /** 이번 달 · 지난달 — 계약액 · 받은 돈 · 견적 마진 · 실제 마진 */
  function compareHtml(d, month) {
    var prev = shiftMonth(month, -1);
    var a = monthRow(d, month);
    var b = monthRow(d, prev);
    return (
      '<table class="me-bk-table"><thead><tr><th scope="col"><span class="me-bk-sr">항목</span></th>' +
      '<th scope="col">' +
      esc(monthShort(month)) +
      '</th><th scope="col">' +
      esc(monthShort(prev)) +
      '</th></tr></thead><tbody>' +
      METRICS.map(function (x) {
        return (
          '<tr><th scope="row">' + esc(x[1]) + '</th>' + cell(a, x[0]) + cell(b, x[0]) + '</tr>'
        );
      }).join('') +
      '</tbody></table>'
    );
  }

  function outstandingHtml(o) {
    var x = o && typeof o === 'object' ? o : {};
    var t = money(x.total);
    if (x.count != null && isFinite(Number(x.count))) t += ' · ' + count(x.count) + '건';
    return '<dl class="me-facts me-bk-facts"><div><dt>미수</dt><dd>' + esc(t) + '</dd></div></dl>';
  }

  function statusHtml(s) {
    var x = s && typeof s === 'object' ? s : {};
    return (
      '<p class="me-bk-h">상태별 수주</p><ul class="me-bk-status">' +
      Object.keys(ORDER_STATUS)
        .map(function (k) {
          return (
            '<li data-status="' +
            k +
            '"><b>' +
            esc(count(x[k])) +
            '</b><span>' +
            esc(ORDER_STATUS[k]) +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function upcomingHtml(list) {
    var rows = (Array.isArray(list) ? list : []).filter(function (p) {
      return p && typeof p === 'object';
    });
    var body = rows.length
      ? '<ul class="me-pt-list">' +
        rows
          .map(function (p) {
            var sub = [PAY_STAGE[p.stage] || p.stage || '', day(p.due_on)]
              .filter(Boolean)
              .join(' · ');
            return (
              '<li class="me-pt-row"><span class="me-pt-line"><span class="me-c-main"><b>' +
              esc(p.order_no || '수주') +
              '</b>' +
              (sub ? '<small>' + esc(sub) + '</small>' : '') +
              '</span><span class="me-bk-amt">' +
              esc(money(p.amount)) +
              '</span></span></li>'
            );
          })
          .join('') +
        '</ul>'
      : '<p class="me-empty">다가오는 수금이 없습니다.</p>';
    return '<p class="me-bk-h">다가오는 수금</p>' + body;
  }

  function navHtml() {
    var last = B.month >= thisMonth();
    return (
      '<div class="me-bk-nav">' +
      '<button type="button" class="mk-btn me-bk-step" data-act="prev" aria-label="지난달"' +
      (B.busy ? ' disabled' : '') +
      '>‹</button>' +
      '<p class="me-bk-month" aria-live="polite">' +
      esc(monthLabel(B.month)) +
      '</p>' +
      '<button type="button" class="mk-btn me-bk-step" data-act="next" aria-label="다음 달"' +
      (B.busy || last ? ' disabled' : '') +
      '>›</button>' +
      '</div>'
    );
  }

  function render() {
    var box = $('meBooks');
    if (!box) return;
    var d = B.data;
    var body = B.err
      ? '<p class="me-pt-msg" role="status">' + esc(B.err) + '</p>'
      : compareHtml(d, B.month) +
        outstandingHtml(d.outstanding) +
        statusHtml(d.status_counts) +
        upcomingHtml(d.upcoming);
    box.innerHTML =
      '<h3 class="me-pt-sub" id="meBooksTitle">회계</h3>' +
      '<div class="me-pt-box me-bk-box">' +
      navHtml() +
      body +
      '</div>' +
      '<ul class="sg-rows me-pt-rows">' +
      (B.ledger
        ? '<li><a class="sg-row" href="' +
          LEDGER_PAGE +
          '">회계 — 한눈에 · 매출 · 매입 · 사진</a></li>' +
          '<li><a class="sg-row" href="' +
          REPORT_PAGE +
          '">이번 달 회계 보고서 · 인쇄</a></li>'
        : '') +
      '<li><a class="sg-row" href="' +
      ERP_PAGE +
      '">수주 상세 · 원가 · 수금 입력은 PC ERP에서</a></li></ul>' +
      (B.ledger ? readOnlyHtml() : '');
    box.hidden = false;
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = B.sb && (await B.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return B.session ? B.session.access_token : '';
  }

  /** GET /books/summary?month= → data | null (403 · 404 · 오류 · 끊김 · 모양이 틀림은 모두 null) */
  async function fetchSummary(month) {
    try {
      var res = await fetch(B.base + '/books/summary?month=' + encodeURIComponent(month), {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return summaryOf(await res.json());
    } catch {
      return null;
    }
  }

  /**
   * GET /ledger/me → { kind, read }. kind: 'book' 대표 · 실장이고 장부 자격(full · read) · 'upload' 사진만 올림 ·
   * '' 못 연다(못 읽음 포함). read: 자기 업체 장부를 보기만 한다 (level read · 남의 장부 보기 아님)
   */
  async function ledgerOpen() {
    var none = { kind: '', read: false };
    try {
      var res = await fetch(B.base + '/ledger/me', {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
      if (!res.ok) return none;
      var b = await res.json();
      var d = b && b.success === true ? b.data : null;
      if (d && d.money === true && (d.level === 'full' || d.level === 'read'))
        return {
          kind: 'book',
          read: d.level === 'read' && d.viewing !== true,
        };
      if (d && d.can_upload === true) return { kind: 'upload', read: false };
      return none;
    } catch {
      return none;
    }
  }

  /** 회계 요약 없이 장부 줄만 (다담 본사 · 공장 대표 · 실장) · 사진 올리기 줄만 (직원) */
  function renderLedgerOnly(kind) {
    var box = $('meBooks');
    if (!box) return;
    box.innerHTML =
      '<h3 class="me-pt-sub" id="meBooksTitle">회계</h3>' +
      '<ul class="sg-rows me-pt-rows"><li><a class="sg-row" href="' +
      LEDGER_PAGE +
      '">' +
      (kind === 'upload' ? '영수증 · 명세표 사진 올리기' : '회계 — 한눈에 · 매출 · 매입 · 사진') +
      '</a></li></ul>';
    box.hidden = false;
    var section = $('partner');
    if (section) section.hidden = false;
  }

  async function go(month) {
    if (B.busy || !MONTH_RE.test(month) || month > thisMonth()) return;
    B.busy = true;
    render();
    var d = await fetchSummary(month);
    B.busy = false;
    B.month = month;
    B.data = d;
    B.err = d ? '' : FAIL_MSG;
    render();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || B.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'prev') return go(shiftMonth(B.month, -1));
    if (act === 'next') return go(shiftMonth(B.month, 1));
  }

  /** 회계 칸 채우기 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var box = $('meBooks');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    B.ledgerKind = '';
    var cfg = window.DADAM_CONFIG || {};
    B.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    B.sb = sb;
    B.session = session;
    if (!B.base || !session) return;
    if (!canSee(me)) {
      // 협력업체가 없는 구성원(다담 본사 · 공장)과 협력업체 직원 — 장부를 열면 장부 줄, 사진만 올리면 올리기 줄
      if (!me || typeof me !== 'object') return;
      var open = await ledgerOpen();
      B.ledgerKind = open.kind;
      if (open.kind) renderLedgerOnly(open.kind);
      return;
    }
    try {
      var month = thisMonth();
      var got = await Promise.all([fetchSummary(month), ledgerOpen()]);
      var d = got[0];
      B.ledgerKind = got[1].kind;
      B.ledger = got[1].kind === 'book';
      B.readOnly = B.ledger && got[1].read ? readOnlyNote(me.company) : '';
      if (!d) return; // 403 · 404 · 오류 — 칸째 감춘다
      B.month = month;
      B.data = d;
      B.err = '';
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
      }
      render(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
    } catch {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganBooks = {
    ROLES: ROLES,
    ORDER_STATUS: ORDER_STATUS,
    PAY_STAGE: PAY_STAGE,
    state: B,
    canSee: canSee,
    readOnlyNote: readOnlyNote,
    summaryOf: summaryOf,
    monthRow: monthRow,
    thisMonth: thisMonth,
    shiftMonth: shiftMonth,
    load: load,
  };
})();
