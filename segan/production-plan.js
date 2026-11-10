/* ============================================================
   segan/production-plan.js — 「프로젝트 관리 › 생산 › 생산 계획」 (segan/me.html #productionPlan)

   PC 화면 production.html(생산 현황판)의 계획 부분을 앱 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만.
   (마이페이지 B안 4단계 — 화면마다 PR 하나. 공장 배정 · 작업자 링크 · 실측 보정은 인사 › 작업자 화면
   segan/production-workers.js, 표준시간 · 인력 설정은 생산 › 생산 설정 화면 segan/production-settings.js)

   누가 보나  다담 공장 구성원만 (account-api GET /partner/me 의 hq_member) — 협력업체 · 다담 본사 구성원은 서버가
             403(not_hq)으로 막는다. 월 손익 요약은 서버가 공장 대표 · 실장 · 관리자에게만 준다(아니면 403 not_money).
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganProductionPlan.load(sb, session, partnerMe) 를 부른다.
             이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /production/proposals/latest      { id, created_at, trigger, status, plan{ days, jobs, suggestions,
                                                        summary, skipped, triggerLabel } } — 없으면 404
               GET  /production/proposals/:id         같은 모양 (지난 제안 한 건)
               POST /production/proposals             { proposal, plan } — 지금 다시 계산. 대표 Slack 으로도 보낸다
               GET  /production/proposals?from=날짜   { items[{ id, created_at, trigger, triggerLabel, status,
                                                        summary{ lateBefore, lateAfter, extraCost } }] }
               POST /production/proposals/:id/decision { decision: 'approve' | 'dismiss', selected[추천 번호] }
                                                      → { status, assignments[], slack{ ok, error } }
               GET  /production/assignments?from=날짜 { items[{ work_date, text, cost, status }] }
               GET  /production/monthly?month=YYYY-MM { month, totals{…}, rows[{ label, tier, revenue, cost, gross }] }
   화면      추천(상태 · 계기 · 요약 다섯 칸 · 추천 목록 고르기 · 「선택한 항목 지시하기」 · 「무시」 · 「지금 다시 계산」) ·
             지난 제안(최근 30일 — 줄을 누르면 그 제안을 위에 띄운다) · 월 손익 요약(달 고르기 · 수주별 보기) ·
             주문별 일정 · 날짜별 부하(막대 셋 + 글 범례 + 시간 칸) · 지시 내역(오늘 이후)
             부분마다 따로 그린다 — 달을 바꿔도 고르던 추천 체크가 남는다.
   이름      추천 종류 · 제안 상태 · 표 머리 · 안내 글은 production.html 과 같다. 지시 상태는 「지시」 · 「완료」
             (admin/work-reports.html 과 같다).
   못 읽으면  처음(403 · 오류 · 끊김) → 칸째 감춘다. 제안이 아직 없으면(404) 빈 안내와 「지금 다시 계산」만.
             지난 제안 · 지시 내역 · 월 손익만 못 읽으면 그 부분만 뺀다. 누른 일이 안 되면 서버 글을 위 한 줄에.
             처음 읽을 때는 다시 계산하지 않는다 — 다시 계산은 대표 Slack 을 보내므로 단추를 눌렀을 때만.
   고객 정보  주문 이름 · 금액은 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var KST_MS = 9 * 3600 * 1000;
  var DAY_MS = 24 * 3600 * 1000;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var HISTORY_DAYS = 30; // 지난 제안 — 최근 30일
  var WEEK = '일월화수목금토';
  var REPORTS_URL = '../admin/work-reports.html'; // 보관함 전체 (PC 관리자 화면)

  // 추천 종류 · 제안 상태 — production.html 과 같다
  var KIND = {
    asm_extra: '조립 인원 추가',
    edge_overtime: '알바 연장',
    edge_outsource: '재단+엣지 외주',
    reschedule: '설치일 조정',
    door_order: '도어 발주',
    top_order: '상판 발주',
    asm_call: '조립 기사 출근',
  };
  var STATUS = {
    pending: '승인 대기',
    approved: '승인됨',
    dismissed: '무시함',
    superseded: '지난 제안',
  };
  // 지시 상태 — admin/work-reports.html 과 같다
  var ASSIGN_STATUS = { instructed: '지시', done: '완료' };
  // 추천 목록 차례 (같은 종류 안에서는 날짜순) — 여기 없는 종류는 맨 앞
  var ORDER = [
    'reschedule',
    'asm_extra',
    'edge_overtime',
    'edge_outsource',
    'door_order',
    'asm_call',
  ];
  var PARTS = ['rec', 'history', 'monthly', 'jobs', 'days', 'assign'];

  var TEXT = {
    title: '생산 계획',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    working: '처리하는 중입니다.',
    none: '아직 생산 계획 제안이 없습니다.',
    noneHelp:
      '「지금 다시 계산」을 누르면 진행 중인 주문으로 계획을 만들고, 대표 Slack 으로도 보냅니다.',
    recompute: '지금 다시 계산',
    recomputed: '다시 계산했습니다. 대표 Slack 으로도 보냈습니다.',
    approve: '선택한 항목 지시하기',
    dismiss: '무시',
    dismissed: '이 제안을 무시했습니다.',
    pickOne: '지시할 항목을 하나 이상 고르세요.',
    latest: '최신 제안 보기',
    recEmpty: '추천할 것이 없습니다.',
    jobsEmpty: '진행 중인 주문이 없습니다.',
    daysEmpty: '작업이 없습니다.',
    assignEmpty: '지시가 없습니다.',
    historyEmpty: '최근 30일 제안이 없습니다.',
    monthlyEmpty: '이 달 수주가 없습니다.',
    reports: '보관함 전체',
    monthlyHelp:
      '그 달에 확정된 수주의 매출(부가세 별도)에서 지출비용을 빼고, 간접비(매출 전체에서 충당)까지 뺀 금액입니다. 지출비용은 계약 스냅샷의 장당 견적 원가입니다.',
    covered: '이번 달 매출로 간접비를 덮었습니다.',
    late: '늦음',
    onTime: '제때',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false, // 처음 읽기를 마쳤다 (칸을 그렸다)
    proposal: null, // 지금 위에 띄운 제안 (없으면 null)
    latestId: '', // 가장 새 제안 — 지난 제안을 열었을 때 돌아갈 곳
    history: null, // 지난 제안 줄 (못 읽으면 null)
    assignments: null, // 지시 내역 (못 읽으면 null)
    monthly: null, // 월 손익 (못 받으면 null — 그 부분을 뺀다)
    busy: false, // 누른 일을 처리하는 중
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
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function todayKst(nowMs) {
    return new Date((nowMs == null ? Date.now() : nowMs) + KST_MS).toISOString().slice(0, 10);
  }
  function addDays(day, n) {
    return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
  }

  // ── 글자 꼴 (production.html 과 같다) ─────────────────
  /** 만원 — 반올림 */
  function man(n) {
    return Math.round(num(n) / 10000).toLocaleString('ko-KR') + '만원';
  }
  /** 초 → 1시간부터 '1.5h', 그보다 짧으면 '30분' */
  function hrs(s) {
    var h = num(s) / 3600;
    return h >= 1 ? h.toFixed(1) + 'h' : Math.round(num(s) / 60) + '분';
  }
  /** 'YYYY-MM-DD' → '11/12(목)' (없으면 '-') */
  function day(s) {
    if (!DAY_RE.test(str(s))) return '-';
    var d = new Date(s + 'T00:00:00Z');
    if (isNaN(d.getTime())) return '-';
    return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + '(' + WEEK[d.getUTCDay()] + ')';
  }
  function wonFull(n) {
    return n == null || !isFinite(Number(n))
      ? '-'
      : Math.round(Number(n)).toLocaleString('ko-KR') + '원';
  }
  /** 만든 때 — 한국 시각 'MM/DD HH:MM' */
  function stamp(iso) {
    var t = Date.parse(str(iso));
    if (isNaN(t)) return '-';
    var at = new Date(t + KST_MS).toISOString();
    return at.slice(5, 7) + '/' + at.slice(8, 10) + ' ' + at.slice(11, 16);
  }

  function canSee(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }

  /** 서버의 제안 한 건 → 화면이 쓰는 모양 (모양이 아니면 null) */
  function proposalOf(p, plan) {
    if (!p || typeof p !== 'object' || Array.isArray(p) || !ID_RE.test(str(p.id))) return null;
    var pl = obj(plan === undefined ? p.plan : plan);
    return {
      id: p.id,
      created_at: str(p.created_at),
      trigger: str(p.trigger),
      status: str(p.status),
      plan: {
        triggerLabel: str(pl.triggerLabel),
        summary: obj(pl.summary),
        suggestions: arr(pl.suggestions),
        jobs: arr(pl.jobs),
        days: arr(pl.days),
        skipped: arr(pl.skipped),
      },
    };
  }

  /** 추천 목록을 그릴 차례 — 원래 번호(서버에 보내는 번호)의 배열 */
  function sortedIndexes(list) {
    return arr(list)
      .map(function (x, i) {
        return { x: obj(x), i: i };
      })
      .sort(function (a, b) {
        return (
          ORDER.indexOf(a.x.type) - ORDER.indexOf(b.x.type) ||
          String(a.x.date).localeCompare(String(b.x.date)) ||
          a.i - b.i
        );
      })
      .map(function (o) {
        return o.i;
      });
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

  async function readAssignments() {
    var r = await call('GET', '/production/assignments?from=' + todayKst());
    J.assignments = r.ok && Array.isArray(obj(r.body.data).items) ? r.body.data.items : null;
  }
  async function readHistory() {
    var r = await call('GET', '/production/proposals?from=' + addDays(todayKst(), -HISTORY_DAYS));
    J.history = r.ok && Array.isArray(obj(r.body.data).items) ? r.body.data.items : null;
  }
  /** 월 손익 — month 가 없으면 서버가 정한 달. 못 받으면 false (지금 것은 그대로 둔다) */
  async function readMonthly(month) {
    var r = await call('GET', '/production/monthly' + (month ? '?month=' + month : ''));
    var d = r.ok ? obj(r.body.data) : null;
    if (!d || !d.totals || typeof d.totals !== 'object') return r;
    J.monthly = { month: str(d.month), totals: obj(d.totals), rows: arr(d.rows) };
    return r;
  }

  // ── 그리기 ──────────────────────────────────────────
  function tableHtml(heads, rows) {
    return (
      '<div class="od-tablewrap"><table class="od-table"><thead><tr>' +
      heads
        .map(function (h) {
          return '<th scope="col"' + (h[1] ? ' class="od-num"' : '') + '>' + esc(h[0]) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table></div>'
    );
  }
  function kpiHtml(pairs) {
    return (
      '<dl class="od-kpi">' +
      pairs
        .map(function (p) {
          return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
        })
        .join('') +
      '</dl>'
    );
  }
  function statusName(s) {
    return own(STATUS, s) ? STATUS[s] : s;
  }
  function triggerName(label, trigger, long) {
    if (label) return label;
    if (trigger === 'order_created') return long ? '새 수주로 계산' : '새 수주';
    return long ? '수동 계산' : '다시 계산';
  }

  /** 추천 — 제안 한 건 (없으면 빈 안내) */
  function recHtml() {
    var p = J.proposal;
    var again =
      '<button type="button" class="mk-btn" data-act="recompute">' +
      esc(TEXT.recompute) +
      '</button>';
    if (!p)
      return (
        '<p class="me-empty">' +
        esc(TEXT.none) +
        '</p><p class="mk-note">' +
        esc(TEXT.noneHelp) +
        '</p><div class="rd-acts pp-acts">' +
        again +
        '</div>'
      );
    var s = p.plan.summary;
    var pending = p.status === 'pending';
    var list = p.plan.suggestions;
    var rows = sortedIndexes(list).map(function (i) {
      var x = obj(list[i]);
      return (
        '<li class="pp-sug"><label class="pp-pick"><input type="checkbox" data-i="' +
        i +
        '"' +
        (pending ? ' checked' : ' disabled') +
        ' /><span class="od-badge pp-kind">' +
        esc(own(KIND, x.type) ? KIND[x.type] : str(x.type)) +
        '</span><span class="pp-text">' +
        esc(str(x.text)) +
        '</span></label><span class="pp-cost">' +
        (x.cost ? esc(man(x.cost)) : '') +
        '</span></li>'
      );
    });
    var old = J.latestId && J.latestId !== p.id;
    return (
      '<p class="pp-meta"><span class="od-badge pp-status">' +
      esc(statusName(p.status)) +
      '</span> ' +
      esc(triggerName(p.plan.triggerLabel, p.trigger, true) + ' · ' + stamp(p.created_at)) +
      '</p>' +
      kpiHtml([
        ['진행 중 주문', num(s.jobs) + '건'],
        ['기본 인력으로 늦는 건', num(s.lateBefore) + '건'],
        [
          '추천대로 하면',
          num(s.lateAfter) +
            '건' +
            (s.needsReschedule ? ' (+설치일 조정 ' + num(s.needsReschedule) + ')' : ''),
        ],
        ['추가 비용', man(s.extraCost)],
        ['조립 기사 출근', num(s.asmCallDays) + '일'],
      ]) +
      (rows.length
        ? '<ul class="pp-sugs">' + rows.join('') + '</ul>'
        : '<p class="me-empty">' + esc(TEXT.recEmpty) + '</p>') +
      '<div class="rd-acts pp-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="approve"' +
      (pending ? '' : ' disabled') +
      '>' +
      esc(TEXT.approve) +
      '</button><button type="button" class="mk-btn" data-act="dismiss"' +
      (pending ? '' : ' disabled') +
      '>' +
      esc(TEXT.dismiss) +
      '</button>' +
      again +
      (old
        ? '<button type="button" class="mk-btn" data-act="latest">' + esc(TEXT.latest) + '</button>'
        : '') +
      '</div>'
    );
  }

  /** 지난 제안 (최근 30일) — 줄을 누르면 그 제안을 위에 띄운다 */
  function historyHtml() {
    if (!J.history) return '';
    var rows = J.history
      .filter(function (r) {
        return r && typeof r === 'object' && ID_RE.test(str(r.id));
      })
      .map(function (r) {
        var s = obj(r.summary);
        var on = !!J.proposal && J.proposal.id === r.id;
        return (
          '<tr' +
          (on ? ' class="od-row--on"' : '') +
          '><td><button type="button" class="od-open" data-act="proposal" data-id="' +
          esc(r.id) +
          '"' +
          (on ? ' aria-current="true"' : '') +
          '>' +
          esc(stamp(r.created_at)) +
          '</button></td><td>' +
          esc(triggerName(str(r.triggerLabel), r.trigger, false)) +
          '</td><td>' +
          esc(statusName(str(r.status))) +
          '</td><td class="od-num">' +
          esc(s.lateBefore != null ? num(s.lateBefore) + '→' + num(s.lateAfter) : '-') +
          '</td><td class="od-num">' +
          esc(s.extraCost ? man(s.extraCost) : '-') +
          '</td></tr>'
        );
      });
    return (
      '<h4 class="od-h">지난 제안 (최근 30일)</h4>' +
      (rows.length
        ? tableHtml([['만든 때'], ['계기'], ['상태'], ['지연 전→후', 1], ['추가 비용', 1]], rows)
        : '<p class="me-empty">' + esc(TEXT.historyEmpty) + '</p>') +
      '<p class="mk-note"><a href="' +
      REPORTS_URL +
      '" data-desktop-tab>' +
      esc(TEXT.reports) +
      ' →</a></p>'
    );
  }

  /** 월 손익 요약 — 서버가 준 사람만 (공장 대표 · 실장 · 관리자) */
  function monthlyHtml() {
    var m = J.monthly;
    if (!m) return '';
    var t = m.totals;
    var net = num(t.net);
    var note =
      (t.unknownCost
        ? '원가를 모르는 수주 ' +
          num(t.unknownCost) +
          '건(장당 견적 이전 스냅샷)은 지출·남는 돈에서 빠졌습니다. '
        : '') +
      (num(t.shortfall) > 0
        ? '간접비를 덮으려면 이번 달 남는 돈이 ' + wonFull(t.shortfall) + ' 더 필요합니다.'
        : TEXT.covered);
    var rows = m.rows.map(function (r) {
      r = obj(r);
      return (
        '<tr><td>' +
        esc(str(r.label)) +
        '</td><td>' +
        (r.tier === 'partner' ? '거래처' : '고객') +
        '</td><td class="od-num">' +
        esc(wonFull(r.revenue)) +
        '</td><td class="od-num">' +
        esc(wonFull(r.cost)) +
        '</td><td class="od-num">' +
        esc(wonFull(r.gross)) +
        '</td></tr>'
      );
    });
    return (
      '<h4 class="od-h">월 손익 요약</h4><label class="mk-input pp-month"><span>월</span><input type="month" name="month" value="' +
      esc(MONTH_RE.test(m.month) ? m.month : '') +
      '" /></label><p class="mk-note">' +
      esc(TEXT.monthlyHelp) +
      '</p>' +
      kpiHtml([
        ['수주', num(t.orders) + '건'],
        ['매출 (부가세 별도)', man(t.revenue)],
        ['지출비용', man(t.cost)],
        [
          '남는 돈 (매출 − 지출)',
          man(t.gross) + (t.grossRate != null ? ' (' + num(t.grossRate) + '%)' : ''),
        ],
        ['간접비', man(t.overhead)],
        // 색만으로 가리지 않는다 — 흑자 · 적자 글자를 같이 적는다
        ['최종 손익', man(t.net) + (net < 0 ? ' (적자)' : ' (흑자)')],
      ]) +
      '<p class="mk-note' +
      (num(t.shortfall) > 0 ? ' od-late' : '') +
      '">' +
      esc(note) +
      '</p><details class="pp-more"><summary>수주별 보기</summary>' +
      (rows.length
        ? tableHtml([['수주'], ['구분'], ['매출', 1], ['지출비용', 1], ['남는 돈', 1]], rows)
        : '<p class="me-empty">' + esc(TEXT.monthlyEmpty) + '</p>') +
      '</details>'
    );
  }

  /** 주문별 일정 */
  function jobsHtml() {
    var p = J.proposal;
    if (!p) return '';
    var rows = p.plan.jobs.map(function (j) {
      j = obj(j);
      var w = obj(j.work);
      var state = j.rescheduleTo
        ? '<span class="od-late">설치일 조정 필요 → ' + esc(day(j.rescheduleTo)) + ' 이후</span>'
        : j.late
          ? '<span class="od-late">' + esc(TEXT.late) + '</span>'
          : esc(TEXT.onTime);
      return (
        '<tr><td>' +
        esc(str(j.label)) +
        (j.outsourced ? '<span class="od-badge">외주</span>' : '') +
        '</td><td>' +
        state +
        '</td><td>' +
        esc(day(j.due)) +
        (j.dueSource === 'default' ? ' <span class="od-dim">(설치일 미정)</span>' : '') +
        '</td><td>' +
        esc(day(j.finish)) +
        '</td><td' +
        (j.doorOrderLate ? ' class="od-late"' : '') +
        '>' +
        esc(day(j.doorOrderBy)) +
        (j.doorOrderLate ? ' (늦음)' : '') +
        '</td><td>' +
        esc(day(j.doorArrival)) +
        '</td><td class="od-num">' +
        esc(hrs(w.cutter)) +
        '</td><td class="od-num">' +
        esc(hrs(w.edge)) +
        '</td><td class="od-num">' +
        esc(hrs(w.asm)) +
        '</td></tr>'
      );
    });
    var skipped = p.plan.skipped
      .map(function (x) {
        x = obj(x);
        return str(x.label) + ' (' + str(x.reason) + ')';
      })
      .join(', ');
    return (
      '<h4 class="od-h">주문별 일정</h4>' +
      (rows.length
        ? tableHtml(
            [
              ['주문'],
              ['상태'],
              ['마감 (설치 하루 전)'],
              ['공장 완료 예정'],
              ['도어 발주 마감'],
              ['도어 도착'],
              ['재단', 1],
              ['엣지', 1],
              ['조립', 1],
            ],
            rows
          )
        : '<p class="me-empty">' + esc(TEXT.jobsEmpty) + '</p>') +
      (skipped ? '<p class="mk-note">계획에서 빠진 주문: ' + esc(skipped) + '</p>' : '')
    );
  }

  /** 부하 막대 한 줄 — 가능 시간 대비 (넘으면 꽉 찬 막대) */
  function barHtml(kind, name, part) {
    var load = num(part.load);
    var cap = num(part.cap);
    var pct = cap > 0 ? Math.round(Math.min(1, load / cap) * 100) : 0;
    var label = name + ' ' + hrs(load) + ' / ' + hrs(cap);
    return (
      '<span class="pp-bar pp-bar--' +
      kind +
      '" role="img" aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '"><i style="width:' +
      pct +
      '%"></i></span>'
    );
  }

  /** 날짜별 부하 — 일이 있는 날만 */
  function daysHtml() {
    var p = J.proposal;
    if (!p) return '';
    var rows = p.plan.days
      .map(function (d) {
        d = obj(d);
        return { date: d.date, cut: obj(d.cut), edge: obj(d.edge), asm: obj(d.asm) };
      })
      .filter(function (d) {
        return num(d.cut.load) + num(d.edge.load) + num(d.asm.load) > 0;
      })
      .map(function (d) {
        return (
          '<tr><td>' +
          esc(day(d.date)) +
          '</td><td class="pp-bars">' +
          barHtml('cut', '재단', d.cut) +
          barHtml('edge', '엣지', d.edge) +
          barHtml('asm', '조립', d.asm) +
          '</td><td class="od-num">' +
          esc(hrs(d.cut.load)) +
          '</td><td class="od-num">' +
          esc(hrs(d.edge.load)) +
          (d.edge.overtimeHours
            ? ' <span class="od-dim">(+' + esc(num(d.edge.overtimeHours)) + 'h 연장)</span>'
            : '') +
          '</td><td class="od-num">' +
          esc(hrs(d.asm.load)) +
          '</td><td>' +
          (d.asm.people ? esc(num(d.asm.people)) + '명' : '-') +
          (d.asm.extra ? '<span class="od-badge">+' + esc(num(d.asm.extra)) + ' 추가</span>' : '') +
          '</td></tr>'
        );
      });
    return (
      '<h4 class="od-h">날짜별 부하</h4>' +
      (rows.length
        ? '<p class="pp-legend"><span><i class="pp-key pp-key--cut"></i>재단 기사</span><span><i class="pp-key pp-key--edge"></i>엣지 (알바)</span><span><i class="pp-key pp-key--asm"></i>조립 기사</span></p>' +
          tableHtml(
            [['날짜'], ['부하 / 가능 시간'], ['재단', 1], ['엣지', 1], ['조립', 1], ['조립 인원']],
            rows
          )
        : '<p class="me-empty">' + esc(TEXT.daysEmpty) + '</p>')
    );
  }

  /** 지시 내역 (오늘 이후) */
  function assignHtml() {
    if (!J.assignments) return '';
    var rows = J.assignments.map(function (a) {
      a = obj(a);
      var s = str(a.status);
      return (
        '<tr><td>' +
        esc(day(a.work_date)) +
        '</td><td class="pp-wrap">' +
        esc(str(a.text)) +
        '</td><td class="od-num">' +
        esc(a.cost ? man(a.cost) : '-') +
        '</td><td>' +
        esc(own(ASSIGN_STATUS, s) ? ASSIGN_STATUS[s] : s) +
        '</td></tr>'
      );
    });
    return (
      '<h4 class="od-h">지시 내역 (오늘 이후)</h4>' +
      (rows.length
        ? tableHtml([['날짜'], ['내용'], ['비용', 1], ['상태']], rows)
        : '<p class="me-empty">' + esc(TEXT.assignEmpty) + '</p>')
    );
  }

  var HTML = {
    rec: recHtml,
    history: historyHtml,
    monthly: monthlyHtml,
    jobs: jobsHtml,
    days: daysHtml,
    assign: assignHtml,
  };

  function partEl(name) {
    var box = $('productionPlan');
    return box ? box.querySelector('[data-pp-part="' + name + '"]') : null;
  }
  /** 고른 부분만 다시 그린다 — 다른 부분의 체크 · 달은 그대로 남는다 */
  function paint(names) {
    names.forEach(function (name) {
      var el = partEl(name);
      if (!el) return;
      var html = HTML[name]();
      el.innerHTML = html;
      el.hidden = !html;
      // PC 관리자 화면 링크 — PC 브라우저에서만 새 탭 (SeganShell.desktopTab)
      var Shell = window.SeganShell || {};
      if (Shell.applyLinkTarget)
        el.querySelectorAll('a[data-desktop-tab]').forEach(function (a) {
          Shell.applyLinkTarget(a);
        });
    });
  }
  function say(text) {
    var box = $('productionPlan');
    var el = box && box.querySelector('[data-pp="msg"]');
    if (el) el.textContent = text || '';
  }
  /** 다담 공장 구성원은 업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다 */
  function showSection() {
    var section = $('partner');
    var box = $('productionPlan');
    if (section && box && !box.hidden) section.hidden = false;
  }
  /** 칸 전체 — 제목 · 한 줄 알림 · 부분마다 빈 자리 */
  function render() {
    var box = $('productionPlan');
    if (!box) return;
    box.innerHTML =
      '<h3 class="me-pt-sub" id="productionPlanTitle">' +
      esc(TEXT.title) +
      '</h3><p class="me-pt-msg" role="status" data-pp="msg"></p>' +
      PARTS.map(function (name) {
        return '<div class="od-sec pp-sec" data-pp-part="' + name + '" hidden></div>';
      }).join('');
    box.hidden = false;
    paint(PARTS);
    showSection();
  }

  // ── 누른 일 ─────────────────────────────────────────
  /** 처리하는 동안 단추를 한 번만 받는다 */
  async function busy(fn) {
    if (J.busy) return;
    J.busy = true;
    var box = $('productionPlan');
    if (box) box.setAttribute('aria-busy', 'true');
    say(TEXT.working);
    try {
      say((await fn()) || '');
    } catch {
      say(TEXT.generic);
    } finally {
      J.busy = false;
      if (box) box.removeAttribute('aria-busy');
    }
  }

  /** 지금 다시 계산 — 서버가 새 제안을 만들고 대표 Slack 으로 보낸다 */
  async function recompute() {
    var r = await call('POST', '/production/proposals');
    var d = r.ok ? obj(r.body.data) : null;
    var p = d ? proposalOf(d.proposal, d.plan) : null;
    if (!p) return errText(r);
    J.proposal = p;
    J.latestId = p.id;
    await Promise.all([readHistory(), readAssignments()]);
    paint(['rec', 'history', 'jobs', 'days', 'assign']);
    return TEXT.recomputed;
  }

  /** 고른 추천을 지시한다(approve) · 제안을 무시한다(dismiss) */
  async function decide(decision) {
    var p = J.proposal;
    if (!p || p.status !== 'pending') return '';
    var box = $('productionPlan');
    var selected = [].slice
      .call(box.querySelectorAll('[data-pp-part="rec"] input[data-i]:checked'))
      .map(function (el) {
        return Number(el.getAttribute('data-i'));
      });
    if (decision === 'approve' && !selected.length) return TEXT.pickOne;
    var r = await call('POST', '/production/proposals/' + encodeURIComponent(p.id) + '/decision', {
      decision: decision,
      selected: selected,
    });
    if (!r.ok) return errText(r);
    var d = obj(r.body.data);
    p.status = str(d.status) || (decision === 'approve' ? 'approved' : 'dismissed');
    await Promise.all([readHistory(), readAssignments()]);
    paint(['rec', 'history', 'assign']);
    if (decision !== 'approve') return TEXT.dismissed;
    var slack = obj(d.slack);
    return (
      '지시 ' +
      arr(d.assignments).length +
      '건을 저장했습니다.' +
      (slack.ok
        ? ' 작업자 Slack 으로 보냈습니다.'
        : ' (Slack 전송 실패: ' + (str(slack.error) || '설정 확인') + ')')
    );
  }

  /** 제안 한 건을 위에 띄운다 — id 가 없으면 가장 새 제안 */
  async function openProposal(id) {
    if (id && !ID_RE.test(id)) return '';
    var r = await call('GET', '/production/proposals/' + (id ? encodeURIComponent(id) : 'latest'));
    var p = r.ok ? proposalOf(r.body.data) : null;
    if (!p) return errText(r);
    J.proposal = p;
    if (!id) J.latestId = p.id;
    paint(['rec', 'history', 'jobs', 'days']);
    return '';
  }

  /** 월 손익의 달을 바꾼다 */
  async function pickMonth(month) {
    var r = await readMonthly(month);
    if (!r.ok) return errText(r);
    paint(['monthly']);
    return '';
  }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!btn || btn.disabled) return;
    var act = btn.getAttribute('data-act');
    if (act === 'recompute') busy(recompute);
    else if (act === 'approve' || act === 'dismiss')
      busy(function () {
        return decide(act);
      });
    else if (act === 'latest')
      busy(function () {
        return openProposal('');
      });
    else if (act === 'proposal') {
      var id = btn.getAttribute('data-id') || '';
      busy(function () {
        return openProposal(id);
      });
    }
  }
  function onChange(e) {
    var el = e.target;
    if (!el || el.name !== 'month' || !MONTH_RE.test(el.value)) return;
    var month = el.value;
    busy(function () {
      return pickMonth(month);
    });
  }

  /**
   * 업체 칸을 읽은 뒤 부른다 (segan/me.js). 다담 공장 구성원만 — 아니면 · 못 읽으면 칸째 감춘다.
   * 제안이 아직 없으면(404) 빈 안내만 그린다 — 여기서는 다시 계산하지 않는다 (대표 Slack 을 보내므로)
   */
  async function load(sb, session, me) {
    var box = $('productionPlan');
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
    J.proposal = null;
    J.latestId = '';
    J.history = null;
    J.assignments = null;
    J.monthly = null;
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      var r = await call('GET', '/production/proposals/latest');
      if (r.ok) {
        J.proposal = proposalOf(r.body.data);
        if (!J.proposal) return;
        J.latestId = J.proposal.id;
      } else if (!(r.status === 404 && r.body.success === false)) return;
      await Promise.all([readHistory(), readAssignments(), readMonthly('')]);
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
        box.addEventListener('change', onChange);
      }
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganProductionPlan = {
    KIND: KIND,
    STATUS: STATUS,
    ASSIGN_STATUS: ASSIGN_STATUS,
    TEXT: TEXT,
    canSee: canSee,
    proposalOf: proposalOf,
    sortedIndexes: sortedIndexes,
    man: man,
    hrs: hrs,
    day: day,
    wonFull: wonFull,
    stamp: stamp,
    todayKst: todayKst,
    addDays: addDays,
    state: J,
    load: load,
  };
})();
