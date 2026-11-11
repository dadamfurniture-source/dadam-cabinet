/* ============================================================
   segan/company-summary.js — 「프로젝트 관리」 대시보드의 우리 팩토리 숫자 (segan/me.html #meNumbers)

   마이페이지 B안 5단계 — 업체용 대시보드 숫자. 견적 흐름(보냄 → 봄 → 확인 → 수주)과 리드타임 · 설치 납기.
   지금까지는 관리자용 경영 화면에 다담 공장 것만 있었다.

   누가 보나  프로젝트를 가지는 업체의 대표 · 실장 — 협력업체 Manager · Expert · Agent 의 owner · manager,
             다담 공장 구성원(account-api GET /partner/me 의 hq_member — 직책은 서버가 가린다: 직원이면 403 → 칸을 감춘다).
             다담 본사 구성원 · 업체 직원 · 업체 없는 사람 · 고객에게는 그려지지 않는다 (직원은 묻지도 않는다).
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganCompanySummary.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data })
               GET /company/summary[?month=YYYY-MM]
                 { company, month,
                   funnel { leads, issued, viewed, approved, ordered, rejected, pending, conversion, viewRate, orderRate,
                            avgRevisions, medianHoursToView, medianDaysToDecide, reasons { requests, noReason, codes[] } },
                   lead { window { start, end }, orders, totalMedianDays, stages[{ key, label, n, medianDays }], slowest,
                          install { done, onTime, onTimeRate, avgLateDays, rescheduled, overdue } } | null }
             건수 · 비율 · 날수뿐이다 — 금액 · 고객 이름은 서버가 싣지 않는다.
   화면      달 고르기(‹ 지난 달 · 다음 달 ›) → 견적 흐름 숫자 칸 → 걸린 시간 한 줄 · 수정 요청 사유 →
             최근 6개월 리드타임(단계마다 날수) · 설치 납기. 프로젝트 관리 대시보드(#dash-project)에서만 보인다.
   못 읽으면  처음에 못 읽으면 칸째 감춘다. 달을 바꾸다 못 읽으면 있던 숫자는 그대로 두고 글만 남긴다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['manager', 'expert', 'agent']; // 프로젝트를 가지는 협력업체 등급 (서버 PROJECT_PLANS)
  var ROLES = ['owner', 'manager']; // 대표 · 실장 (서버 MONEY_ROLES)
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

  var TEXT = {
    title: '우리 팩토리 숫자',
    note: '건수 · 비율 · 날수만 나옵니다. 대표 · 실장에게만 보입니다.',
    prev: '‹ 지난 달',
    next: '다음 달 ›',
    loading: '불러오는 중…',
    fail: '불러오지 못했습니다.',
    funnel: '견적 흐름',
    funnelNote:
      '그 달에 처음 견적서를 보낸 설계를 한 건으로 셉니다. 고쳐서 다시 보낸 것은 따로 세지 않습니다.',
    issued: '견적 보냄',
    viewed: '고객이 봄',
    approved: '고객 확인 완료',
    ordered: '수주',
    pending: '답 기다림',
    rejected: '수정 요청',
    leads: '상담',
    count: '건',
    noFunnel: '이 달에 처음 보낸 견적서가 없습니다.',
    revisions: '설계 한 건에 견적서 평균',
    revisionsUnit: '번',
    toView: '보내고 열어 보기까지',
    toDecide: '보내고 결정까지',
    hours: '시간',
    days: '일',
    median: '(중간값)',
    reasons: '수정 요청 사유',
    noReason: '사유 없음',
    lead: '리드타임 · 설치 납기',
    leadNote: '에 설치를 끝낸 수주로 셉니다.',
    total: '수주 → 설치',
    slowest: '가장 오래 걸리는 단계',
    noLead: '이 기간에 설치를 끝낸 수주가 없습니다.',
    install: '설치 납기',
    done: '끝낸 설치',
    onTime: '처음 잡은 날 안에',
    late: '늦으면 평균',
    rescheduled: '일정을 미룬 설치',
    overdue: '잡힌 날이 지난 설치',
  };

  var S = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    data: null, // { month, funnel, lead }
    thisMonth: '', // 서버가 처음 돌려준 달 (그 뒤로는 못 넘어간다)
    busy: false,
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

  /** 이 칸을 읽어 볼 사람인가 — 다담 공장 구성원(직책은 서버가 가린다) · 협력업체 Manager · Expert · Agent 의 대표 · 실장 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.platform_member === true) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
    return c.status === 'active' && PLANS.indexOf(c.plan) >= 0 && ROLES.indexOf(c.role) >= 0;
  }

  /** 'YYYY-MM' 에서 n 달 옮긴 달 */
  function shiftMonth(month, n) {
    if (!MONTH_RE.test(month)) return '';
    var y = Number(month.slice(0, 4));
    var m = Number(month.slice(5, 7)) - 1 + n;
    var d = new Date(Date.UTC(y, m, 1));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  }

  /** '2026-11' → '2026년 11월' */
  function monthLabel(month) {
    return MONTH_RE.test(month) ? month.slice(0, 4) + '년 ' + Number(month.slice(5, 7)) + '월' : '';
  }

  /** 'YYYY-MM-DD' → 'MM.DD' */
  function dayLabel(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(5, 7) + '.' + d.slice(8, 10) : '';
  }

  /** 건수 + 비율 — '3건 (60%)', 비율이 없으면 건수만, 건수가 없으면 '-' */
  function countRate(n, rate) {
    if (n === null) return '-';
    return n + TEXT.count + (rate === null ? '' : ' (' + rate + '%)');
  }

  /** 서버 답 → 화면에 쓸 모양. 달이 틀리거나 funnel 이 없으면 null (이상한 답) */
  function viewOf(data) {
    var d = obj(data);
    var f = d.funnel;
    if (!MONTH_RE.test(str(d.month)) || !f || typeof f !== 'object' || Array.isArray(f))
      return null;
    var r = obj(f.reasons);
    var lead = null;
    if (d.lead && typeof d.lead === 'object' && !Array.isArray(d.lead)) {
      var L = d.lead;
      var ins = obj(L.install);
      var slow = obj(L.slowest);
      lead = {
        start: str(obj(L.window).start),
        end: str(obj(L.window).end),
        orders: num(L.orders) || 0,
        total: num(L.totalMedianDays),
        stages: (Array.isArray(L.stages) ? L.stages : []).map(obj).map(function (s) {
          return { label: str(s.label), n: num(s.n) || 0, days: num(s.medianDays) };
        }),
        slowest: str(slow.label) ? { label: str(slow.label), days: num(slow.medianDays) } : null,
        done: num(ins.done) || 0,
        onTime: num(ins.onTime) || 0,
        onTimeRate: num(ins.onTimeRate),
        avgLateDays: num(ins.avgLateDays),
        rescheduled: num(ins.rescheduled) || 0,
        overdue: num(ins.overdue) || 0,
      };
    }
    return {
      month: d.month,
      funnel: {
        leads: num(f.leads),
        issued: num(f.issued) || 0,
        viewed: num(f.viewed) || 0,
        approved: num(f.approved) || 0,
        ordered: num(f.ordered) || 0,
        rejected: num(f.rejected) || 0,
        pending: num(f.pending) || 0,
        conversion: num(f.conversion),
        viewRate: num(f.viewRate),
        orderRate: num(f.orderRate),
        avgRevisions: num(f.avgRevisions),
        hoursToView: num(f.medianHoursToView),
        daysToDecide: num(f.medianDaysToDecide),
        reasons: (Array.isArray(r.codes) ? r.codes : []).map(obj).map(function (c) {
          return { label: str(c.label) || str(c.code), count: num(c.count) || 0 };
        }),
        noReason: num(r.noReason) || 0,
      },
      lead: lead,
    };
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

  /** 그 달 숫자를 읽는다 ('' = 이번 달) — 못 읽으면 null */
  async function read(month) {
    var res;
    try {
      res = await fetch(
        S.base + '/company/summary' + (month ? '?month=' + encodeURIComponent(month) : ''),
        {
          headers: { Authorization: 'Bearer ' + (await token()) },
          cache: 'no-store',
        }
      );
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
    return viewOf(b.data);
  }

  function box() {
    return $('meNumbers');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function kpi(key, label, value, warn) {
    return (
      '<div data-k="' +
      key +
      '"' +
      (warn ? ' class="as-warn"' : '') +
      '><dt>' +
      esc(label) +
      '</dt><dd>' +
      esc(value) +
      '</dd></div>'
    );
  }

  function monthBarHtml() {
    var m = S.data.month;
    var dis = S.busy ? ' disabled' : '';
    return (
      '<div class="dr-bar cs-bar"><button type="button" class="mk-btn" data-act="prev"' +
      dis +
      '>' +
      esc(TEXT.prev) +
      '</button><b class="cs-month" data-cs="month">' +
      esc(monthLabel(m)) +
      '</b><button type="button" class="mk-btn" data-act="next"' +
      (S.busy || m >= S.thisMonth ? ' disabled' : '') +
      '>' +
      esc(TEXT.next) +
      '</button></div>'
    );
  }

  function funnelHtml(f) {
    var head =
      '<section class="as-sec" data-cs="funnel"><h4 class="od-h">' +
      esc(TEXT.funnel) +
      '</h4><p class="mk-note">' +
      esc(TEXT.funnelNote) +
      '</p>';
    var leads = f.leads === null ? '' : kpi('leads', TEXT.leads, f.leads + TEXT.count);
    if (!f.issued)
      return (
        head +
        (leads ? '<dl class="od-kpi as-kpi">' + leads + '</dl>' : '') +
        '<p class="me-empty" data-cs="nofunnel">' +
        esc(TEXT.noFunnel) +
        '</p></section>'
      );
    var times = [
      f.avgRevisions === null ? '' : TEXT.revisions + ' ' + f.avgRevisions + TEXT.revisionsUnit,
      f.hoursToView === null
        ? ''
        : TEXT.toView + ' ' + f.hoursToView + TEXT.hours + ' ' + TEXT.median,
      f.daysToDecide === null
        ? ''
        : TEXT.toDecide + ' ' + f.daysToDecide + TEXT.days + ' ' + TEXT.median,
    ].filter(Boolean);
    var reasons = f.reasons
      .map(function (c) {
        return c.label + ' ' + c.count;
      })
      .concat(f.noReason ? [TEXT.noReason + ' ' + f.noReason] : []);
    return (
      head +
      '<dl class="od-kpi as-kpi">' +
      leads +
      kpi('issued', TEXT.issued, f.issued + TEXT.count) +
      kpi('viewed', TEXT.viewed, countRate(f.viewed, f.viewRate)) +
      kpi('approved', TEXT.approved, countRate(f.approved, f.conversion)) +
      kpi('ordered', TEXT.ordered, countRate(f.ordered, f.orderRate)) +
      kpi('pending', TEXT.pending, f.pending + TEXT.count) +
      kpi('rejected', TEXT.rejected, f.rejected + TEXT.count) +
      '</dl>' +
      (times.length
        ? '<p class="cs-line" data-cs="times">' + esc(times.join(' · ')) + '</p>'
        : '') +
      (reasons.length
        ? '<p class="cs-line" data-cs="reasons">' +
          esc(TEXT.reasons + ' — ' + reasons.join(' · ')) +
          '</p>'
        : '') +
      '</section>'
    );
  }

  function leadHtml(L) {
    if (!L) return '';
    var range =
      dayLabel(L.start) && dayLabel(L.end)
        ? L.start.slice(0, 4) + '.' + dayLabel(L.start) + ' ~ ' + dayLabel(L.end)
        : '';
    var head =
      '<section class="as-sec" data-cs="lead"><h4 class="od-h">' +
      esc(TEXT.lead) +
      '</h4>' +
      (range ? '<p class="mk-note">' + esc(range + TEXT.leadNote) + '</p>' : '');
    var stages = L.orders
      ? '<dl class="od-kpi as-kpi" data-cs="stages">' +
        kpi(
          'total',
          TEXT.total,
          (L.total === null ? '-' : L.total + TEXT.days) + ' · ' + L.orders + TEXT.count
        ) +
        L.stages
          .map(function (s, i) {
            return kpi('stage-' + i, s.label, s.days === null ? '-' : s.days + TEXT.days);
          })
          .join('') +
        '</dl>' +
        (L.slowest
          ? '<p class="cs-line" data-cs="slowest">' +
            esc(
              TEXT.slowest +
                ' — ' +
                L.slowest.label +
                (L.slowest.days === null ? '' : ' ' + L.slowest.days + TEXT.days)
            ) +
            '</p>'
          : '')
      : '<p class="me-empty" data-cs="nolead">' + esc(TEXT.noLead) + '</p>';
    var install =
      '<h4 class="od-h cs-sub">' +
      esc(TEXT.install) +
      '</h4><dl class="od-kpi as-kpi" data-cs="install">' +
      kpi('done', TEXT.done, L.done + TEXT.count) +
      kpi('ontime', TEXT.onTime, L.done ? countRate(L.onTime, L.onTimeRate) : '-') +
      kpi('late', TEXT.late, L.avgLateDays === null ? '-' : L.avgLateDays + TEXT.days) +
      kpi('rescheduled', TEXT.rescheduled, L.rescheduled + TEXT.count) +
      // 잡힌 날이 지났는데 아직 안 끝난 설치 — 색만으로 알리지 않는다 (굵은 글 + 왼쪽 선)
      kpi('overdue', TEXT.overdue, L.overdue + TEXT.count, L.overdue > 0) +
      '</dl>';
    return head + stages + install + '</section>';
  }

  function render() {
    var b = box();
    if (!b || !S.ready || !S.data) return;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="meNumbersTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note) +
      '</p>' +
      monthBarHtml() +
      '<p class="me-pt-msg dr-status" data-cs="status" role="status">' +
      esc(S.busy ? TEXT.loading : '') +
      '</p><p class="mk-error" data-cs="err" role="alert"' +
      (S.err ? '' : ' hidden') +
      '>' +
      esc(S.err) +
      '</p>' +
      funnelHtml(S.data.funnel) +
      leadHtml(S.data.lead);
    if (S.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
  }

  function hide() {
    var b = box();
    if (b) {
      b.hidden = true;
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    S.ready = false;
  }

  /** 달을 옮긴다 — 못 읽으면 있던 숫자 · 달은 그대로 두고 글만 남긴다 */
  async function go(n) {
    if (!S.ready || S.busy || !S.data) return;
    var want = shiftMonth(S.data.month, n);
    if (!want || want > S.thisMonth) return;
    S.busy = true;
    S.err = '';
    render();
    var got = await read(want);
    S.busy = false;
    if (got) S.data = got;
    else S.err = TEXT.fail;
    render();
    var b = box();
    var el = b && b.querySelector('[data-act="' + (n < 0 ? 'prev' : 'next') + '"]');
    if (el && el.disabled) el = b.querySelector('[data-act="prev"]');
    if (el && el.focus) el.focus();
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || S.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'prev') go(-1);
    else if (act === 'next') go(1);
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
    S.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    S.sb = sb || null;
    S.session = session || null;
    S.data = null;
    S.thisMonth = '';
    S.busy = false;
    S.err = '';
    if (!S.base || !session || !canSee(me)) return;
    try {
      var got = await read('');
      if (!got) return;
      S.data = got;
      S.thisMonth = got.month;
      bind();
      S.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganCompanySummary = {
    PLANS: PLANS,
    ROLES: ROLES,
    TEXT: TEXT,
    canSee: canSee,
    shiftMonth: shiftMonth,
    monthLabel: monthLabel,
    dayLabel: dayLabel,
    countRate: countRate,
    viewOf: viewOf,
    state: S,
    load: load,
  };
})();
