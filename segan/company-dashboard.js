/* ============================================================
   segan/company-dashboard.js — 「프로젝트 관리」 대시보드의 진행 현황 (segan/me.html #meNumbers)

   2026-11-23 대표님 승인 「프로젝트 관리 새 틀」 — 「우리 팩토리 숫자」(글 · 숫자 표)를 큰 숫자 넷 + 그래프 넷으로 바꿨다.
     큰 숫자   진행 중 프로젝트(멈춘 것 · 보류) · 수주 잔고 · 받을 날이 지난 미수금 · 이번 달 계약
     그래프    ① 단계마다 쌓인 프로젝트(머문 날로 나눠 쌓음 — 누르면 그 단계 화면) ② 단계마다 걸린 날
               ③ 받을 돈(지난 날수로 나눈 미수금 · 앞 8주 받을 돈) ④ 앞 8주 제작 착수 · 설치 일정
     아래 한 줄 견적 → 계약(여섯 달) · 설치 납기 · A/S 율

   누가 보나  프로젝트를 가지는 업체의 대표 · 실장 — 협력업체 Manager · Expert · Agent 의 owner · manager,
             다담 공장 구성원(account-api GET /partner/me 의 hq_member — 직책은 서버가 가린다: 직원이면 403 → 칸을 감춘다).
             다담 본사 구성원 · 업체 직원 · 업체 없는 사람 · 고객에게는 그려지지 않는다 (직원은 묻지도 않는다).
             금액이 나온다 (2026-11-23 대표님 「대표 · 실장에게 금액까지」).
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganCompanyDashboard.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api GET /company/dashboard (본인 토큰 · 응답은 { success, data } — workers/workflow-api/src/company-dashboard.js)
             단계 · 느림 · 멈춤은 서버가 정한다. 화면은 받은 수를 그리기만 한다.
   못 읽으면  칸째 감춘다. 보기만 한다 — 서버에 쓰지 않고 기기에 남기지 않는다.
   그래프는 segan/charts.js, 움직임은 segan/motion.js (없어도 멈춘 모습 그대로 보인다).
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['manager', 'expert', 'agent']; // 프로젝트를 가지는 협력업체 등급 (서버 PROJECT_PLANS)
  var ROLES = ['owner', 'manager']; // 대표 · 실장 (서버 MONEY_ROLES)
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

  var TEXT = {
    title: '진행 현황',
    note: ' 기준 · 진행 중인 프로젝트만 셉니다. 대표 · 실장에게만 보입니다.',
    count: '건',
    days: '일',
    won: '원',
    man: '만 원',
    active: '진행 중 프로젝트',
    stuck: '멈춘 것 ',
    noStuck: '멈춘 것 없음',
    held: '보류 ',
    backlog: '수주 잔고',
    backlogNote: '계약했고 설치 전',
    overdue: '받을 날이 지난 미수금',
    oldest: '가장 오래 ',
    none: '없음',
    month: '이번 달 계약',
    more: '건 많음',
    less: '건 적음',
    same: '지난달과 같음',
    prev: '지난달 ',
    than: '보다 ',
    steps: '단계마다 쌓인 프로젝트',
    stepsNone: '진행 중인 프로젝트가 없습니다.',
    stepsOk: '멈춘 프로젝트가 없습니다.',
    fresh: '여유',
    slow: '느림',
    stuckOne: '멈춤',
    rule: '느림 · 멈춤 — ',
    ruleDue: '생산 · 설치는 잡은 날이 지나면 멈춤',
    daysTitle: '단계마다 걸린 날',
    daysNote: '지난 석 달에 그 단계를 끝낸 프로젝트의 가운데 값',
    daysNone: '지난 석 달에 끝낸 단계가 아직 없습니다.',
    daysOk: '앞 석 달보다 늘어난 단계가 없습니다.',
    grew: '일 늘었습니다.',
    grewBy: '앞 석 달보다 ',
    hot: '앞 석 달보다 가장 많이 늘어난 단계',
    money: '받을 돈',
    late: '받을 날이 지난 돈 ',
    ahead: '앞 8주에 받을 돈 ',
    lateLegend: '지난 날수로 나눈 미수금',
    aheadLegend: '주마다 받을 돈 (만 원)',
    load: '앞 8주 제작 착수 · 설치',
    loadNone: '앞 8주에 잡힌 제작 착수 · 설치 일정이 없습니다.',
    make: '제작 착수',
    install: '설치',
    most: ' 주가 가장 많습니다 — ',
    conv: '견적 → 계약 (여섯 달)',
    convNow: '이번 달 견적 ',
    convOf: '건 가운데 계약 ',
    onTime: '설치 납기 지킴 (지난 반년)',
    onTimeOf: '끝낸 설치 ',
    onTimeIn: '건이 처음 잡은 날 안에',
    of: '건 가운데 ',
    overdueInstall: '잡힌 날이 지난 설치 ',
    as: 'A/S 율 (지난 반년)',
    asOf: '끝낸 수주 ',
    asReq: 'A/S 접수 ',
    dash: '-',
  };

  var S = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    data: null,
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

  function list(v) {
    return Array.isArray(v) ? v.map(obj) : [];
  }

  /** 숫자 아니면 null */
  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  /** 0 이상의 수 — 아니면 0 */
  function cnt(v) {
    var n = num(v);
    return n !== null && n > 0 ? n : 0;
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

  /** 금액 — 만 원부터는 '1,260만 원', 그 아래는 '9,000원' */
  function won(n) {
    var v = cnt(n);
    if (v >= 10000) return Math.round(v / 10000).toLocaleString('ko-KR') + TEXT.man;
    return v.toLocaleString('ko-KR') + TEXT.won;
  }

  /** 만 원 단위 숫자만 — 기둥 위에 적는다 */
  function man(n) {
    return Math.round(cnt(n) / 10000).toLocaleString('ko-KR');
  }

  /** 'YYYY-MM-DD' → '11.23' */
  function dayLabel(d) {
    return DAY_RE.test(d) ? Number(d.slice(5, 7)) + '.' + Number(d.slice(8, 10)) : '';
  }

  /** 'YYYY-MM-DD' → '2026.11.23' */
  function fullDay(d) {
    return DAY_RE.test(d) ? d.slice(0, 4) + '.' + d.slice(5, 7) + '.' + d.slice(8, 10) : '';
  }

  /** '2026-11' → '11월' */
  function monthLabel(m) {
    return MONTH_RE.test(m) ? Number(m.slice(5, 7)) + '월' : '';
  }

  /** 서버 답 → 화면에 쓸 모양. 날짜나 단계 목록이 없으면 null (이상한 답) */
  function viewOf(data) {
    var d = obj(data);
    if (!DAY_RE.test(str(d.today)) || !Array.isArray(d.steps)) return null;
    var active = obj(d.active);
    var money = obj(d.money);
    var backlog = obj(money.backlog);
    var overdue = obj(money.overdue);
    var upcoming = obj(money.upcoming);
    var month = obj(money.month);
    var days = obj(d.days);
    var worst = obj(days.worst);
    var limits = obj(d.thresholds);
    return {
      today: d.today,
      active: { count: cnt(active.count), stuck: cnt(active.stuck), held: cnt(active.held) },
      steps: list(d.steps)
        .filter(function (s) {
          return str(s.key) && str(s.label);
        })
        .map(function (s) {
          var lim = obj(limits[s.key]);
          return {
            key: s.key,
            label: s.label,
            count: cnt(s.count),
            fresh: cnt(s.fresh),
            slow: cnt(s.slow),
            stuck: cnt(s.stuck),
            limit: num(lim.slow) !== null && num(lim.stuck) !== null ? [lim.slow, lim.stuck] : null,
          };
        }),
      days: list(days.steps)
        .filter(function (s) {
          return str(s.key) && str(s.label);
        })
        .map(function (s) {
          return {
            key: s.key,
            label: s.label,
            n: cnt(s.n),
            days: num(s.medianDays),
            delta: num(s.delta),
          };
        }),
      worst:
        str(worst.key) && num(worst.delta) !== null
          ? { key: worst.key, label: str(worst.label), delta: worst.delta }
          : null,
      backlog: { amount: cnt(backlog.amount), count: cnt(backlog.count) },
      overdue: {
        amount: cnt(overdue.amount),
        count: cnt(overdue.count),
        orders: cnt(overdue.orders),
        oldest: num(overdue.oldestDays),
        buckets: list(overdue.buckets).map(function (b) {
          return {
            key: str(b.key),
            label: str(b.label),
            amount: cnt(b.amount),
            count: cnt(b.count),
          };
        }),
      },
      upcoming: {
        amount: cnt(upcoming.amount),
        weeks: list(upcoming.weeks).map(function (w) {
          return { start: str(w.start), amount: cnt(w.amount), count: cnt(w.count) };
        }),
      },
      month: {
        count: cnt(month.count),
        amount: cnt(month.amount),
        prevCount: cnt(month.prevCount),
      },
      load:
        d.load && Array.isArray(obj(d.load).weeks)
          ? list(d.load.weeks).map(function (w) {
              return { start: str(w.start), make: cnt(w.make), install: cnt(w.install) };
            })
          : null,
      conversion: list(obj(d.conversion).months).map(function (m) {
        return {
          month: str(m.month),
          issued: cnt(m.issued),
          ordered: cnt(m.ordered),
          rate: num(m.rate),
        };
      }),
      install:
        d.install && typeof d.install === 'object'
          ? {
              done: cnt(d.install.done),
              onTime: cnt(d.install.onTime),
              rate: num(d.install.onTimeRate),
              overdue: cnt(d.install.overdue),
            }
          : null,
      as:
        d.as && typeof d.as === 'object'
          ? { installed: cnt(d.as.installed), requests: cnt(d.as.requests), rate: num(d.as.rate) }
          : null,
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

  /** 못 읽으면 null */
  async function read() {
    var res;
    try {
      res = await fetch(S.base + '/company/dashboard', {
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
    return viewOf(b.data);
  }

  function box() {
    return $('meNumbers');
  }

  // ── 글 ────────────────────────────────────────────────
  /** 그래프 ① 위에 적는 한 줄 — 멈춘 것이 가장 많은 단계 */
  function stepsSay(v) {
    if (!v.active.count) return TEXT.stepsNone;
    var top = v.steps.reduce(function (a, b) {
      return b.stuck > (a ? a.stuck : 0) ? b : a;
    }, null);
    if (!top) return TEXT.stepsOk;
    return (
      top.label +
      '에 ' +
      top.count +
      TEXT.count +
      ', 그 가운데 ' +
      top.stuck +
      TEXT.count +
      '이 멈춰 있습니다.'
    );
  }

  /** 그래프 ② 위에 적는 한 줄 */
  function daysSay(v) {
    var any = v.days.some(function (s) {
      return s.days !== null;
    });
    if (!any) return TEXT.daysNone;
    if (!v.worst) return TEXT.daysOk;
    return v.worst.label + ' 단계가 ' + TEXT.grewBy + v.worst.delta + TEXT.grew;
  }

  /** 그래프 ④ 위에 적는 한 줄 — 제작 착수 · 설치를 더해 가장 많은 주 */
  function loadSay(weeks) {
    var top = null;
    weeks.forEach(function (w) {
      if (w.make + w.install > 0 && (!top || w.make + w.install > top.make + top.install)) top = w;
    });
    if (!top) return TEXT.loadNone;
    return (
      dayLabel(top.start) +
      TEXT.most +
      TEXT.make +
      ' ' +
      top.make +
      TEXT.count +
      ' · ' +
      TEXT.install +
      ' ' +
      top.install +
      TEXT.count
    );
  }

  /** 느림 · 멈춤 기준 한 줄 — '상담 · 실측 2일 · 7일, 설계 · 견적 · 계약 3일 · 7일, 생산 · 설치는 …' */
  function ruleSay(v) {
    var groups = [];
    v.steps.forEach(function (s) {
      if (!s.limit) return;
      var key = s.limit[0] + TEXT.days + ' · ' + s.limit[1] + TEXT.days;
      var g = groups.filter(function (x) {
        return x.key === key;
      })[0];
      if (g) g.labels.push(s.label);
      else groups.push({ key: key, labels: [s.label] });
    });
    if (!groups.length) return '';
    return (
      TEXT.rule +
      groups
        .map(function (g) {
          return g.labels.join(' · ') + ' ' + g.key;
        })
        .concat([TEXT.ruleDue])
        .join(', ')
    );
  }

  function monthSay(m) {
    var diff = m.count - m.prevCount;
    if (!diff) return TEXT.same + ' (' + m.prevCount + TEXT.count + ')';
    return (
      TEXT.prev +
      m.prevCount +
      TEXT.count +
      TEXT.than +
      Math.abs(diff) +
      (diff > 0 ? TEXT.more : TEXT.less)
    );
  }

  // ── 그리기 ─────────────────────────────────────────────
  function kpi(key, label, value, sub, warn) {
    return (
      '<div data-k="' +
      key +
      '"><dt>' +
      esc(label) +
      '</dt><dd>' +
      esc(value) +
      '</dd><dd class="cd-sub' +
      (warn ? ' cd-warn' : '') +
      '">' +
      esc(sub) +
      '</dd></div>'
    );
  }

  function kpisHtml(v) {
    var a = v.active;
    var activeSub =
      (a.stuck ? TEXT.stuck + a.stuck + TEXT.count : TEXT.noStuck) +
      (a.held ? ' · ' + TEXT.held + a.held + TEXT.count : '');
    var o = v.overdue;
    var overdueSub = o.count
      ? o.orders +
        TEXT.count +
        (o.oldest !== null ? ' · ' + TEXT.oldest + o.oldest + TEXT.days : '')
      : TEXT.none;
    return (
      '<dl class="cd-kpis" data-cd="kpis">' +
      kpi('active', TEXT.active, a.count + TEXT.count, activeSub, a.stuck > 0) +
      kpi(
        'backlog',
        TEXT.backlog,
        won(v.backlog.amount),
        v.backlog.count + TEXT.count + ' · ' + TEXT.backlogNote,
        false
      ) +
      kpi('overdue', TEXT.overdue, won(o.amount), overdueSub, o.count > 0) +
      kpi(
        'month',
        TEXT.month,
        v.month.count + TEXT.count + ' · ' + won(v.month.amount),
        monthSay(v.month),
        false
      ) +
      '</dl>'
    );
  }

  function chart(key, title, say, body) {
    return (
      '<section class="cd-chart" data-cd="' +
      key +
      '"><h4 class="od-h">' +
      esc(title) +
      '</h4><p class="cd-say" data-cd="say">' +
      esc(say) +
      '</p>' +
      body +
      '</section>'
    );
  }

  function stepsHtml(v, C) {
    var rows = v.steps.map(function (s) {
      return {
        key: s.key,
        label: s.label,
        value: s.count,
        text: s.count + TEXT.count,
        go: 'p-' + s.key,
        segs: [
          { cls: 'cd-fresh', n: s.fresh, label: TEXT.fresh },
          { cls: 'cd-slow', n: s.slow, label: TEXT.slow },
          { cls: 'cd-stuck', n: s.stuck, label: TEXT.stuckOne },
        ],
      };
    });
    var rule = ruleSay(v);
    return chart(
      'steps',
      TEXT.steps,
      stepsSay(v),
      C.stackRows(rows) +
        C.legend([
          { cls: 'cd-fresh', label: TEXT.fresh },
          { cls: 'cd-slow', label: TEXT.slow },
          { cls: 'cd-stuck', label: TEXT.stuckOne },
        ]) +
        (rule ? '<p class="cd-note" data-cd="rule">' + esc(rule) + '</p>' : '')
    );
  }

  function daysHtml(v, C) {
    var rows = v.days.map(function (s) {
      return {
        key: s.key,
        label: s.label,
        value: s.days === null ? 0 : s.days,
        text: s.days === null ? TEXT.dash : s.days + TEXT.days,
        note: s.delta ? (s.delta > 0 ? '+' : '−') + Math.abs(s.delta) : '',
        cls: v.worst && v.worst.key === s.key ? 'cd-hot' : '',
      };
    });
    return chart(
      'days',
      TEXT.daysTitle,
      daysSay(v),
      C.barRows(rows) +
        '<p class="cd-note">' +
        esc(TEXT.daysNote) +
        '</p>' +
        (v.worst ? C.legend([{ cls: 'cd-hot', label: TEXT.hot }]) : '')
    );
  }

  function moneyHtml(v, C) {
    var late = v.overdue.buckets.map(function (b) {
      return {
        key: b.key,
        label: b.label,
        value: b.amount,
        text: b.amount ? won(b.amount) : TEXT.dash,
        cls: 'cd-stuck',
      };
    });
    var cols = v.upcoming.weeks.map(function (w) {
      return { label: dayLabel(w.start), values: { amount: w.amount } };
    });
    return chart(
      'money',
      TEXT.money,
      TEXT.late + won(v.overdue.amount) + ', ' + TEXT.ahead + won(v.upcoming.amount),
      '<div class="cd-two"><div>' +
        C.barRows(late) +
        '<p class="cd-note">' +
        esc(TEXT.lateLegend) +
        '</p></div><div>' +
        C.columns(cols, [{ key: 'amount', cls: 'cd-cash', label: TEXT.money }], man) +
        '<p class="cd-note">' +
        esc(TEXT.aheadLegend) +
        '</p></div></div>'
    );
  }

  function loadHtml(v, C) {
    if (!v.load) return '';
    var cols = v.load.map(function (w) {
      return { label: dayLabel(w.start), values: { make: w.make, install: w.install } };
    });
    var series = [
      { key: 'make', cls: 'cd-make', label: TEXT.make },
      { key: 'install', cls: 'cd-install', label: TEXT.install },
    ];
    return chart('load', TEXT.load, loadSay(v.load), C.columns(cols, series) + C.legend(series));
  }

  function cell(key, label, value, line, extra) {
    return (
      '<div data-cd="' +
      key +
      '"><span class="cd-cap">' +
      esc(label) +
      '</span><b>' +
      esc(value) +
      '</b>' +
      (extra || '') +
      '<span class="cd-cap">' +
      esc(line) +
      '</span></div>'
    );
  }

  function trioHtml(v, C) {
    var out = '';
    var months = v.conversion;
    if (months.length) {
      var now = months[months.length - 1];
      var known = months.filter(function (m) {
        return m.rate !== null;
      });
      var trend =
        known.length > 1
          ? monthLabel(known[0].month) +
            ' ' +
            known[0].rate +
            '% → ' +
            monthLabel(known[known.length - 1].month) +
            ' ' +
            known[known.length - 1].rate +
            '%'
          : '';
      out += cell(
        'conversion',
        TEXT.conv,
        now.rate === null ? TEXT.dash : now.rate + '%',
        TEXT.convNow + now.issued + TEXT.convOf + now.ordered + TEXT.count,
        C.spark(
          months.map(function (m) {
            return m.rate;
          }),
          trend
        ) + (trend ? '<span class="cd-cap" data-cd="trend">' + esc(trend) + '</span>' : '')
      );
    }
    if (v.install)
      out += cell(
        'install',
        TEXT.onTime,
        v.install.rate === null ? TEXT.dash : v.install.rate + '%',
        TEXT.onTimeOf +
          v.install.done +
          TEXT.of +
          v.install.onTime +
          TEXT.onTimeIn +
          (v.install.overdue ? ' · ' + TEXT.overdueInstall + v.install.overdue + TEXT.count : '')
      );
    if (v.as)
      out += cell(
        'as',
        TEXT.as,
        v.as.rate === null ? TEXT.dash : v.as.rate + '%',
        TEXT.asOf + v.as.installed + TEXT.of + TEXT.asReq + v.as.requests + TEXT.count
      );
    return out ? '<div class="cd-trio" data-cd="trio">' + out + '</div>' : '';
  }

  function render() {
    var b = box();
    var C = window.SeganCharts;
    if (!b || !S.ready || !S.data || !C) return;
    var v = S.data;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="meNumbersTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note" data-cd="note">' +
      esc(fullDay(v.today) + TEXT.note) +
      '</p>' +
      kpisHtml(v) +
      '<div class="cd-charts">' +
      stepsHtml(v, C) +
      daysHtml(v, C) +
      moneyHtml(v, C) +
      loadHtml(v, C) +
      '</div>' +
      trioHtml(v, C);
    b.hidden = false;
    C.animate(b);
  }

  function hide() {
    var b = box();
    if (b) {
      b.hidden = true;
      b.innerHTML = '';
    }
    S.ready = false;
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 볼 사람이 아니거나 못 읽으면 칸을 감춘 채 둔다 */
  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    S.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    S.sb = sb || null;
    S.session = session || null;
    S.data = null;
    if (!S.base || !session || !canSee(me)) return;
    try {
      var got = await read();
      if (!got) return;
      S.data = got;
      S.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganCompanyDashboard = {
    PLANS: PLANS,
    ROLES: ROLES,
    TEXT: TEXT,
    canSee: canSee,
    won: won,
    man: man,
    dayLabel: dayLabel,
    viewOf: viewOf,
    stepsSay: stepsSay,
    daysSay: daysSay,
    loadSay: loadSay,
    ruleSay: ruleSay,
    state: S,
    load: load,
  };
})();
