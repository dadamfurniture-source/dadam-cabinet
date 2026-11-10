/* ============================================================
   segan/hq-board.js — 본사 대시보드 앱 화면 (segan/hq-board.html#이름)

   경영 대시보드(admin/management.html)의 조각 넷을 폰 앱 화면으로 — 마이페이지 본사 메뉴가 연다
     #profit    종합 대시보드 › 이익 · 목표   이번 달 이익 식 · 분기 목표
     #finance   회계관리 › 손익 분석          손익분기 · 채널 공헌이익 · 견적 대비 실적 · 만약에 판(시트)
     #cash      회계관리 › 현금 · 미수        13주 현금흐름 · 미수 나이
     #forecast  회계관리 › 매출 예측          계절 지수 · 수주 예측
   같은 메뉴 조각끼리 위 탭으로 오간다 (회계관리 셋 — 기록은 넣지 않고 # 만 바꾼다). 모르는 # 는 #profit.
   나머지 조각(고객 흐름 · 거래처 · 공급처 성적 · 공정 · 품질)은 아직 PC 화면 그대로다.

   누가   관리자 — 셸 판정(SeganShell.ready 의 admin), 서버도 관리자만 답한다
   서버   workflow-api GET /management/summary?month=YYYY-MM — 숫자는 서버가 준 그대로 그린다.
          만약에 판만 이 화면에서 다시 센다 (PC 화면 applyScenario 와 같은 식 — 시험이 둘을 맞춰 본다)
   넣기   분기 목표 넣기 · 지우기 · 통장 잔액 · 과거 월 매출은 PC 화면(../admin/management.html?part=) — 앱은 보기만
   움직임 segan/motion.js (CLAUDE.md 「SEGAN 모션 규칙」)
          숫자는 지난 달 값에서 굴리고, 막대는 자라고, 선은 그려진다. 탭은 차례대로 좌우로 들어오고 나간다.
          13주 그래프는 손가락 · 마우스를 1:1 로 따라간다 (움직임 없음). 파일이 없거나 동작 줄이기면 바로 최종 모습
   못 읽으면  그 자리에 서버 글 한 줄 — 숫자를 지어내지 않는다
   ============================================================ */
/* global window, document, fetch, location, history */
(function () {
  'use strict';

  var PARTS = {
    profit: { title: '이익 · 목표', menu: 'dash', month: true, view: 'hbProfit' },
    finance: { title: '손익 분석', menu: 'ledger', month: true, view: 'hbFinance' },
    cash: { title: '현금 · 미수', menu: 'ledger', month: false, view: 'hbCash' },
    forecast: { title: '매출 예측', menu: 'ledger', month: false, view: 'hbForecast' },
  };
  var ORDER = ['profit', 'finance', 'cash', 'forecast'];
  // PC 화면에서 하는 일 — 조각마다 (넣기 · 표)
  var PC_NOTE = {
    profit: '분기 목표 넣기 · 지우기는',
    finance: '수주별 원가 · 마진은',
    cash: '통장 잔액 적기 · 주별 표는',
    forecast: '과거 월 매출 넣기는',
  };
  var FAIL = '불러오지 못했습니다';
  var OKR_STATUS = {
    done: ['닿음', 'done'],
    on_track: ['제 속도', 'track'],
    behind: ['뒤처짐', 'behind'],
    below: ['아직', 'below'],
  }; // admin/management.html 과 같다
  var SOURCE_LABEL = {
    hq: '본사 설정',
    mine: '내 생산 설정',
    latest: '가장 최근에 저장된 생산 설정',
    default: '기본값',
  };

  var S = { part: '', month: '', data: null, busy: false, session: null, base: '', scrub: null };

  var $ = function (id) {
    return document.getElementById(id);
  };
  function M() {
    return window.SeganMotion || null;
  }

  // ── 글 · 숫자 (admin/management.html 과 같은 모양) ─────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isNum(n) {
    return n !== null && n !== undefined && n !== '' && isFinite(Number(n));
  }
  function man(n) {
    return isNum(n) ? Math.round(Number(n) / 10000).toLocaleString('ko-KR') + '만' : '-';
  }
  function won(n) {
    return isNum(n) ? Math.round(Number(n)).toLocaleString('ko-KR') + '원' : '-';
  }
  function cnt(n) {
    return isNum(n) ? Number(n).toLocaleString('ko-KR') + '건' : '-';
  }
  function pct(n) {
    return isNum(n) ? n + '%' : '-';
  }
  function hrs(n) {
    return isNum(n) ? n + '시간' : '-';
  }
  function mins(n) {
    return isNum(n) ? Number(n).toLocaleString('ko-KR') + '분' : '-';
  }
  /** 굴리는 동안의 글 — 끝은 위 함수와 같은 글 */
  var ROLL_FMT = {
    cnt: function (v) {
      return Math.round(v).toLocaleString('ko-KR') + '건';
    },
    man: function (v) {
      return Math.round(v / 10000).toLocaleString('ko-KR') + '만';
    },
    pct: function (v) {
      return Math.round(v * 10) / 10 + '%';
    },
  };
  function kstMonth() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
  }
  function monthLabel(m) {
    var p = String(m).split('-').map(Number);
    return p[0] + '년 ' + p[1] + '월';
  }
  function shiftMonth(m, by) {
    var p = String(m).split('-').map(Number);
    var t = p[0] * 12 + (p[1] - 1) + by;
    return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
  }
  function mmdd(d) {
    return Number(String(d).slice(5, 7)) + '/' + Number(String(d).slice(8, 10));
  }
  function shortMonth(k) {
    return String(k).slice(2, 4) + '.' + String(k).slice(5, 7);
  }
  function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
  }

  /** 굴릴 숫자 — 처음 글은 최종값 (움직임이 없어도 맞다) */
  function rollHtml(tag, cls, value, prev, fmt) {
    var fin = fmt === 'cnt' ? cnt(value) : fmt === 'pct' ? pct(value) : man(value);
    var from = isNum(prev) ? Number(prev) : Number(value);
    return (
      '<' +
      tag +
      ' class="' +
      cls +
      '" data-roll="' +
      fmt +
      '" data-from="' +
      esc(from) +
      '" data-to="' +
      esc(value) +
      '">' +
      esc(fin) +
      '</' +
      tag +
      '>'
    );
  }
  /** 막대 — 멈춘 모습은 그 비율 (style), 움직임은 0 에서 자란다 */
  function fillHtml(ratio, cls) {
    var r = Math.round(clamp01(ratio) * 10000) / 10000;
    return (
      '<span class="hb-fill' +
      (cls ? ' ' + cls : '') +
      '" data-grow="' +
      r +
      '" style="transform: scaleX(' +
      r +
      ')"></span>'
    );
  }
  function card(title, body, opts) {
    opts = opts || {};
    return (
      '<article class="hb-card' +
      (opts.wide ? ' is-wide' : '') +
      '"' +
      (opts.id ? ' id="' + opts.id + '"' : '') +
      '>' +
      '<div class="hb-card-head"><h2>' +
      esc(title) +
      '</h2>' +
      (opts.tag ? '<span class="hb-tag">' + esc(opts.tag) + '</span>' : '') +
      '</div>' +
      (opts.q ? '<p class="hb-q">' + esc(opts.q) + '</p>' : '') +
      body +
      '</article>'
    );
  }

  // ── 이익 · 목표 ────────────────────────────────────
  function calcRow(op, label, sub, value, prev, fmt, cls) {
    return (
      '<li class="' +
      (cls || '') +
      '"><span class="hb-op">' +
      op +
      '</span><span class="hb-lbl">' +
      esc(label) +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span>' +
      rollHtml('b', 'hb-val', value, prev, fmt) +
      '</li>'
    );
  }
  function prevText(v, f) {
    return isNum(v) ? '지난 달 ' + f(v) : '지난 달 -';
  }
  function profitHtml(d) {
    var t = d.tree;
    var net = t.net.value;
    var rows =
      calcRow('', '수주', prevText(t.orders.prev, cnt), t.orders.value, t.orders.prev, 'cnt') +
      calcRow(
        '×',
        '평균 계약금 (VAT 제외)',
        prevText(t.avgContract.prev, man),
        t.avgContract.value,
        t.avgContract.prev,
        'man'
      ) +
      calcRow(
        '×',
        '공헌이익률',
        prevText(t.cmRate.prev, pct),
        t.cmRate.value,
        t.cmRate.prev,
        'pct'
      ) +
      calcRow('−', '월 고정비', '생산 설정 값', t.overhead, null, 'man') +
      calcRow(
        '=',
        '월 순이익',
        prevText(t.net.prev, man),
        net,
        t.net.prev,
        'man',
        'is-net' + (isNum(net) && net < 0 ? ' is-neg' : '')
      );
    var lead = isNum(t.leads.value) ? '상담 ' + cnt(t.leads.value) : '상담 -';
    var conv =
      '확인서 ' +
      cnt(t.issued.value) +
      ' 발행 → ' +
      cnt(t.approved.value) +
      ' 승인 (전환 ' +
      pct(t.conversion.value) +
      ')';
    var pending = t.pending > 0 ? ' · 결정 대기 ' + cnt(t.pending) : '';
    var tree = card(
      '이번 달 이익 식',
      '<ol class="hb-calc">' +
        rows +
        '</ol>' +
        '<p class="hb-line">매출 <b>' +
        esc(man(t.revenue.value)) +
        '</b> · 공헌이익 <b>' +
        esc(man(t.contribution.value)) +
        '</b></p>' +
        '<p class="hb-note">수주 앞단 — ' +
        esc(lead) +
        ' · ' +
        esc(conv) +
        esc(pending) +
        '</p>' +
        (t.unknownCost > 0
          ? '<p class="hb-warn">견적 원가가 없는 수주 ' +
            esc(cnt(t.unknownCost)) +
            '은 공헌이익 · 손익분기에서 빠졌습니다.</p>'
          : ''),
      { tag: monthLabel(d.month) }
    );
    return tree + (d.okrs === undefined ? '' : okrHtml(d.okrs));
  }
  function okrValue(v, unit) {
    if (!isNum(v)) return '-';
    if (unit === 'won') return man(v);
    if (unit === 'count') return cnt(v);
    if (unit === 'pct') return pct(v);
    return Number(v).toLocaleString('ko-KR');
  }
  function okrHtml(o) {
    if (!o) return card('분기 목표', '<p class="hb-empty">분기 목표 칸이 아직 없습니다.</p>');
    var head = o.quarter.replace('-Q', '년 ') + '분기 · ' + o.elapsed + '% 지남';
    if (!o.items.length)
      return card(
        '분기 목표',
        '<p class="hb-empty">이번 분기 목표가 없습니다. 목표는 PC 화면에서 대시보드 숫자에 묶어 넣습니다.</p>',
        {
          tag: head,
        }
      );
    var items = o.items
      .map(function (i) {
        var st = OKR_STATUS[i.status] || ['값 없음', 'none'];
        var fillCls = {
          done: 'is-ok',
          track: '',
          behind: 'is-warn',
          below: 'is-muted',
          none: 'is-muted',
        }[st[1]];
        var pace = i.cumulative
          ? '<i class="hb-pace" style="left: ' +
            Math.min(100, Number(o.elapsed) || 0) +
            '%" title="지난 날 ' +
            esc(o.elapsed) +
            '%"></i>'
          : '';
        return (
          '<div class="hb-goal" data-okr="' +
          esc(i.id) +
          '"><div class="hb-goal-top"><b>' +
          esc(i.objective) +
          '</b><span class="hb-pill ' +
          st[1] +
          '">' +
          esc(st[0]) +
          '</span></div>' +
          '<div class="hb-track">' +
          fillHtml((Number(i.progress) || 0) / 100, fillCls) +
          pace +
          '</div>' +
          '<div class="hb-goal-meta">' +
          esc(i.label) +
          ' · 지금 <b class="hb-num">' +
          esc(okrValue(i.current, i.unit)) +
          '</b> / 목표 <b class="hb-num">' +
          esc(okrValue(i.target, i.unit)) +
          '</b>' +
          (i.direction === 'down' ? ' (이하)' : '') +
          (isNum(i.progress) ? ' · ' + esc(i.progress) + '%' : '') +
          '</div></div>'
        );
      })
      .join('');
    return card('분기 목표', '<div class="hb-goals">' + items + '</div>', { tag: head });
  }

  // ── 손익 분석 ──────────────────────────────────────
  function breakEvenHtml(d) {
    var b = d.breakEven;
    var rev = d.tree.revenue.value;
    if (!isNum(b.revenueNeeded))
      return card(
        '손익분기',
        '<p class="hb-empty">견적 원가가 있는 수주가 없어 공헌이익률을 낼 수 없습니다 — 손익분기를 계산하지 않았습니다.</p>'
      );
    var over = Number(b.progress) >= 100;
    var line = over
      ? '손익분기를 넘었습니다 — 매출이 <b>' +
        esc(pct(b.safety)) +
        '</b> 줄어도 손해가 아닙니다 (안전한계율).'
      : '손익분기까지 매출 <b>' + esc(man(b.gap)) + '</b>을 더 받아야 합니다.';
    return card(
      '손익분기',
      '<div class="hb-track" role="img" aria-label="손익분기 달성률 ' +
        esc(pct(b.progress)) +
        '">' +
        fillHtml(Number(b.progress) / 100, over ? 'is-ok' : '') +
        '</div>' +
        '<div class="hb-facts"><div><small>손익분기 매출</small><b>' +
        esc(man(b.revenueNeeded)) +
        '</b></div>' +
        '<div><small>이달 매출</small>' +
        rollHtml('b', '', rev, 0, 'man') +
        '</div>' +
        '<div><small>달성률</small><b>' +
        esc(pct(b.progress)) +
        '</b></div>' +
        '<div><small>공헌이익률</small><b>' +
        esc(pct(b.cmRate)) +
        '</b></div></div>' +
        '<p class="hb-line">' +
        line +
        '</p>' +
        '<p class="hb-note">손익분기 매출 = 월 고정비 ' +
        esc(man(b.overhead)) +
        ' ÷ 공헌이익률</p>',
      { q: '이번 달 얼마를 더 받아야 월 고정비를 덮나', tag: monthLabel(d.month) }
    );
  }
  function channelsHtml(d) {
    var list = d.channels || [];
    if (!list.length)
      return card('채널 공헌이익', '<p class="hb-empty">이번 달 수주가 없습니다.</p>');
    var top = Math.max.apply(
      null,
      list
        .map(function (c) {
          return Number(c.perHour) || 0;
        })
        .concat([1])
    );
    var rows = list
      .map(function (c) {
        return (
          '<div class="hb-bar"><span>' +
          esc(c.label) +
          '</span><span class="hb-track">' +
          fillHtml((Number(c.perHour) || 0) / top) +
          '</span><b>' +
          esc(won(c.perHour)) +
          '</b>' +
          '<small>수주 ' +
          esc(cnt(c.orders)) +
          ' · 매출 ' +
          esc(man(c.revenue)) +
          ' · 공헌이익 ' +
          esc(man(c.contribution)) +
          ' (' +
          esc(pct(c.cmRate)) +
          ') · 공장 ' +
          esc(hrs(c.factoryHours)) +
          '</small></div>'
        );
      })
      .join('');
    return card(
      '채널 공헌이익',
      '<div class="hb-bars">' +
        rows +
        '</div>' +
        '<p class="hb-note">막대 = 공장 1시간당 공헌이익. 공장 시간 = 견적이 잡은 재단 · 엣지 · 조립 시간. 거래처는 계약금이 거래처 견적과 1,000원 안인 수주입니다.</p>',
      { q: '어느 쪽 일이 고정비를 더 덮나 · 공장 1시간당으로 보면' }
    );
  }
  function diffText(n, rate) {
    if (!isNum(n)) return '<span>-</span>';
    var cls = n > 0 ? 'hb-up' : n < 0 ? 'hb-down' : '';
    var sign = n > 0 ? '+' : '';
    return (
      '<span class="' +
      cls +
      '">' +
      esc(sign + man(n) + (isNum(rate) ? ' (' + sign + rate + '%)' : '')) +
      '</span>'
    );
  }
  function varianceHtml(d) {
    if (!d.process) return '';
    var v = d.process.variance;
    var time = (d.process.time || []).filter(function (t) {
      return t.orders > 0;
    });
    if (!(v.recorded > 0) && !time.length)
      return card(
        '견적 대비 실적',
        '<p class="hb-empty">이달 수주 ' +
          esc(cnt(v.orders)) +
          ' 중 실적 원가도 작업 실측도 없습니다. PC 화면에서 수주별 원가를 넣거나 작업자 링크로 시간을 남기면 견적과 비교합니다.</p>',
        { q: '견적이 어디서 빗나가나' }
      );
    var out = [];
    if (v.recorded > 0) {
      var t = v.totals;
      out.push(
        '<p class="hb-line">실적을 넣은 수주 <b>' +
          esc(cnt(v.recorded)) +
          '</b> / ' +
          esc(cnt(v.orders)) +
          ' · 견적 <b>' +
          esc(man(t.estimate)) +
          '</b> → 실적 <b>' +
          esc(man(t.actual)) +
          '</b> ' +
          diffText(t.diff, t.diffRate) +
          '</p>'
      );
      out.push(
        '<ul class="hb-list">' +
          v.categories
            .map(function (c) {
              return (
                '<li><span>' +
                esc(c.label) +
                ' <small>수주 ' +
                esc(cnt(c.orders)) +
                ' · 견적 ' +
                esc(man(c.estimate)) +
                ' → 실적 ' +
                esc(man(c.actual)) +
                '</small></span><b>' +
                diffText(c.diff, c.diffRate) +
                '</b></li>'
              );
            })
            .join('') +
          '</ul>'
      );
      if (v.top && v.top.length)
        out.push(
          '<p class="hb-sub">크게 빗나간 주문</p><ul class="hb-list">' +
            v.top
              .map(function (r) {
                return (
                  '<li><span>' +
                  esc(r.label) +
                  ' <small>가장 큰 범주 ' +
                  esc(r.worst ? r.worst.label : '-') +
                  '</small></span><b>' +
                  diffText(r.diff, r.diffRate) +
                  '</b></li>'
                );
              })
              .join('') +
            '</ul>'
        );
    }
    if (time.length)
      out.push(
        '<p class="hb-sub">작업 시간 — 견적이 잡은 분 대 작업자 실측</p><ul class="hb-list">' +
          time
            .map(function (t) {
              var r = t.diffRate;
              var cls = r > 0 ? 'hb-up' : r < 0 ? 'hb-down' : '';
              return (
                '<li><span>' +
                esc(t.label) +
                ' <small>수주 ' +
                esc(cnt(t.orders)) +
                ' · 예상 ' +
                esc(mins(t.estimateMin)) +
                ' · 실측 ' +
                esc(mins(t.actualMin)) +
                '</small></span><b><span class="' +
                cls +
                '">' +
                esc(isNum(r) ? (r > 0 ? '+' : '') + r + '%' : '-') +
                '</span></b></li>'
              );
            })
            .join('') +
          '</ul>'
      );
    out.push(
      '<p class="hb-note">돈은 넣은 범주만 비교합니다. 노무는 월급이라 돈 대신 시간으로 봅니다.</p>'
    );
    return card('견적 대비 실적', out.join(''), {
      q: '견적이 어디서 빗나가나 — 자재값인가, 외주인가, 작업 시간인가',
    });
  }
  function whatIfHtml(d) {
    if (!d.scenario) return '';
    return card(
      '만약에 판',
      '<button type="button" class="mk-btn hb-open" id="hbWhatIfOpen">단가 · 마진 · 물량 바꿔 보기</button>' +
        '<p class="hb-note">이달 수주 가운데 견적 원가가 있는 것으로 셉니다.</p>',
      { q: '바꾸면 이달 이익이 얼마나 움직이나' }
    );
  }
  function financeHtml(d) {
    return breakEvenHtml(d) + channelsHtml(d) + varianceHtml(d) + whatIfHtml(d) + basisHtml(d);
  }
  function basisHtml(d) {
    var b = d.basis || {};
    return (
      '<p class="hb-note hb-basis">근거 — 매출: ' +
      esc(b.revenue) +
      ' · 원가: ' +
      esc(b.cost) +
      ' · 월 고정비 ' +
      esc(man(b.overhead)) +
      ': ' +
      esc(SOURCE_LABEL[b.settingsSource] || b.settingsSource) +
      '</p>'
    );
  }

  // ── 만약에 판 — PC 화면 applyScenario 와 같은 식 ─────────
  function n0(v) {
    return isNum(v) ? Number(v) : 0;
  }
  /**
   * 이달 바탕(서버 scenario)에 레버를 걸어 다시 센다.
   *   마진율은 0.2 꼴, 나머지 % 는 10 꼴
   */
  function applyScenario(b, L) {
    var vol = 1 + n0(L.volumePct) / 100;
    var mC = isNum(L.marginRate) ? Number(L.marginRate) : b.marginRate;
    var mP = isNum(L.partnerMarginRate) ? Number(L.partnerMarginRate) : b.partnerMarginRate;
    var priceC = (1 + mC) / (1 + n0(b.marginRate));
    var priceP = (1 + mP) / (1 + n0(b.partnerMarginRate));
    var revenueKnown = (b.revenueCustomer * priceC + b.revenuePartner * priceP) * vol;
    var variable =
      (b.material * (1 + n0(L.materialPct) / 100) +
        b.hardware * (1 + n0(L.hardwarePct) / 100) +
        b.door +
        b.doorSheets * n0(L.doorWon) +
        b.outsourcing +
        b.labor * (1 + n0(L.laborPct) / 100) +
        b.overheadAlloc) *
      vol;
    var contribution = revenueKnown - variable;
    var fixed = b.overheadMonthly + n0(L.fixedWon);
    var cm = revenueKnown > 0 ? contribution / revenueKnown : null;
    return {
      revenue: Math.round(revenueKnown + b.revenueUnknown * vol),
      variable: Math.round(variable),
      contribution: Math.round(contribution),
      cmRate: cm === null ? null : Math.round(cm * 1000) / 10,
      fixed: Math.round(fixed),
      net: Math.round(contribution - fixed),
      breakEven: cm > 0 ? Math.round(fixed / cm) : null,
    };
  }
  // 레버 — [키, 이름, 최소, 최대, 칸, 단위, 서버 값으로 바꾸기]
  var LEVERS = [
    ['materialPct', '원판 · 자재 단가', -30, 50, 1, '%'],
    ['hardwarePct', '철물 단가', -30, 50, 1, '%'],
    ['doorWon', '도어 외주 장당', -20000, 30000, 1000, '원'],
    ['laborPct', '인건비', -30, 50, 1, '%'],
    ['marginRate', '고객 마진율', 0, 40, 1, '%p'],
    ['partnerMarginRate', '거래처 마진율', 0, 30, 1, '%p'],
    ['volumePct', '수주량', -50, 100, 5, '%'],
    ['fixedWon', '월 고정비 더하기', 0, 1000, 10, '만원'],
  ];
  function leverDefaults(b) {
    return {
      materialPct: 0,
      hardwarePct: 0,
      doorWon: 0,
      laborPct: 0,
      marginRate: Math.round(n0(b.marginRate) * 100),
      partnerMarginRate: Math.round(n0(b.partnerMarginRate) * 100),
      volumePct: 0,
      fixedWon: 0,
    };
  }
  /** 화면 값(만원 · % 정수) → applyScenario 레버 */
  function toLevers(v) {
    return {
      materialPct: v.materialPct,
      hardwarePct: v.hardwarePct,
      doorWon: v.doorWon,
      laborPct: v.laborPct,
      marginRate: v.marginRate / 100,
      partnerMarginRate: v.partnerMarginRate / 100,
      volumePct: v.volumePct,
      fixedWon: v.fixedWon * 10000,
    };
  }
  function leverText(key, v) {
    var L = LEVERS.filter(function (l) {
      return l[0] === key;
    })[0];
    var sign = v > 0 && key !== 'marginRate' && key !== 'partnerMarginRate' ? '+' : '';
    var unit = L[5] === '%p' ? '%' : L[5];
    return sign + Number(v).toLocaleString('ko-KR') + unit;
  }
  function amt(v) {
    return isNum(v) && Math.abs(v) < 1000000 ? won(v) : man(v);
  }
  function whatIfRows(b, vals) {
    var base = applyScenario(b, {});
    var next = applyScenario(b, toLevers(vals));
    var line = function (label, k, fmt, key) {
      var a = base[k];
      var z = next[k];
      var dlt = isNum(a) && isNum(z) ? z - a : null;
      var diff = '-';
      if (isNum(dlt)) {
        if (dlt === 0) diff = '0';
        else if (k === 'cmRate')
          diff =
            '<span class="' +
            (dlt > 0 ? 'hb-down' : 'hb-up') +
            '">' +
            esc((dlt > 0 ? '+' : '') + Math.round(dlt * 10) / 10 + '%p') +
            '</span>';
        else {
          var bad = (k === 'variable' || k === 'fixed' || k === 'breakEven') === dlt > 0;
          diff =
            '<span class="' +
            (bad ? 'hb-up' : 'hb-down') +
            '">' +
            esc((dlt > 0 ? '+' : '') + amt(dlt)) +
            '</span>';
        }
      }
      return (
        '<tr class="' +
        (key ? 'is-key' : '') +
        '" data-k="' +
        k +
        '"><td>' +
        esc(label) +
        '</td><td>' +
        esc(fmt(a)) +
        '</td><td>' +
        esc(fmt(z)) +
        '</td><td>' +
        diff +
        '</td></tr>'
      );
    };
    return [
      line('매출 (VAT 제외)', 'revenue', man),
      line('변동원가', 'variable', man),
      line('공헌이익', 'contribution', man),
      line('공헌이익률', 'cmRate', pct),
      line('월 고정비', 'fixed', man),
      line('월 순이익', 'net', man, true),
      line('손익분기 매출', 'breakEven', man),
    ].join('');
  }
  /** 만약에 판 — 셸 시트(폰은 아래에서 올라와 끌어 내려 닫는다, PC 는 옆 패널) */
  function openWhatIf() {
    var b = S.data && S.data.scenario;
    var Shell = window.SeganShell;
    if (!b || !Shell || !Shell.sheet) return;
    var vals = leverDefaults(b);
    var node = document.createElement('div');
    var presets = [
      ['원판 +10%', { materialPct: 10 }],
      ['도어 장당 +5천 원', { doorWon: 5000 }],
      ['고객 마진 15%', { marginRate: 15 }],
    ];
    if (b.partTimeMonthly > 0)
      presets.splice(2, 0, [
        '알바 한 명 더 (+' + man(b.partTimeMonthly) + ')',
        { fixedWon: b.partTimeMonthly / 10000 },
      ]);
    node.innerHTML =
      '<div class="hb-presets">' +
      presets
        .map(function (p, i) {
          return '<button type="button" data-preset="' + i + '">' + esc(p[0]) + '</button>';
        })
        .join('') +
      '<button type="button" data-preset="reset">처음 값으로</button></div>' +
      '<div class="hb-levers">' +
      LEVERS.map(function (L) {
        var id = 'hbLv-' + L[0];
        return (
          '<div class="hb-lever"><label for="' +
          id +
          '"><span>' +
          esc(L[1]) +
          '</span><output id="' +
          id +
          'Out" for="' +
          id +
          '">' +
          esc(leverText(L[0], vals[L[0]])) +
          '</output></label><input type="range" id="' +
          id +
          '" data-lever="' +
          L[0] +
          '" min="' +
          L[2] +
          '" max="' +
          L[3] +
          '" step="' +
          L[4] +
          '" value="' +
          vals[L[0]] +
          '" /></div>'
        );
      }).join('') +
      '</div>' +
      '<div class="hb-table-wrap"><table class="hb-table" id="hbWhatIf"><thead><tr><th scope="col"></th><th scope="col">지금</th>' +
      '<th scope="col">바꾸면</th><th scope="col">차이</th></tr></thead><tbody>' +
      whatIfRows(b, vals) +
      '</tbody></table></div>' +
      '<p class="hb-note">마진율은 이달 수주를 그 마진으로 다시 매긴다고 보고, 수주량은 매출과 변동원가를 같은 비율로 늘립니다.</p>';
    var redraw = function () {
      LEVERS.forEach(function (L) {
        var el = node.querySelector('[data-lever="' + L[0] + '"]');
        el.value = String(vals[L[0]]);
        node.querySelector('#hbLv-' + L[0] + 'Out').textContent = leverText(L[0], vals[L[0]]);
      });
      node.querySelector('tbody').innerHTML = whatIfRows(b, vals);
    };
    // 레버 — 끄는 동안 바로 (손을 1:1 로 따라간다)
    node.addEventListener('input', function (e) {
      var k = e.target && e.target.getAttribute('data-lever');
      if (!k) return;
      vals[k] = Number(e.target.value);
      node.querySelector('#hbLv-' + k + 'Out').textContent = leverText(k, vals[k]);
      node.querySelector('tbody').innerHTML = whatIfRows(b, vals);
    });
    node.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-preset]') : null;
      if (!btn) return;
      var p = btn.getAttribute('data-preset');
      vals = leverDefaults(b);
      if (p !== 'reset') {
        var set = presets[Number(p)][1];
        for (var k in set) if (Object.prototype.hasOwnProperty.call(set, k)) vals[k] = set[k];
      }
      redraw();
    });
    S.whatIf = Shell.sheet.open({ title: '만약에 판', body: node, kind: 'sheet' });
  }

  // ── 현금 · 미수 ────────────────────────────────────
  var NEED_CASH =
    '<p class="hb-empty">수금 · 지급 칸이 아직 없습니다. PC 화면의 수주 상세에서 수금 일정과 지급 예정일을 적을 수 있게 되면 채워집니다.</p>';
  var CW = { w: 340, h: 176, x0: 8, x1: 300, y0: 14, y1: 146 };
  /** 13주 주말 잔액 선 — 0 아래로 가면 0 선을 긋는다. 눈금은 오른쪽 */
  function cashSvg(weeks) {
    var vals = weeks.map(function (w) {
      return Number(w.balance) || 0;
    });
    var max = Math.max.apply(null, vals.concat([0]));
    var min = Math.min.apply(null, vals.concat([0]));
    var span = max - min || 1;
    var n = weeks.length;
    var X = function (i) {
      return CW.x0 + (n > 1 ? (i * (CW.x1 - CW.x0)) / (n - 1) : 0);
    };
    var Y = function (v) {
      return CW.y1 - ((v - min) / span) * (CW.y1 - CW.y0);
    };
    var pts = vals.map(function (v, i) {
      return X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
    });
    var lowI = vals.indexOf(Math.min.apply(null, vals));
    var out =
      '<line class="grid" x1="' +
      CW.x0 +
      '" x2="' +
      CW.x1 +
      '" y1="' +
      Y(max).toFixed(1) +
      '" y2="' +
      Y(max).toFixed(1) +
      '"></line>' +
      '<text class="tick" x="' +
      (CW.x1 + 6) +
      '" y="' +
      (Y(max) + 3.5).toFixed(1) +
      '">' +
      esc(man(max)) +
      '</text>' +
      '<line class="' +
      (min < 0 ? 'zero' : 'grid') +
      '" x1="' +
      CW.x0 +
      '" x2="' +
      CW.x1 +
      '" y1="' +
      Y(0).toFixed(1) +
      '" y2="' +
      Y(0).toFixed(1) +
      '"></line>' +
      '<text class="tick" x="' +
      (CW.x1 + 6) +
      '" y="' +
      (Y(0) + 3.5).toFixed(1) +
      '">0</text>';
    if (min < 0)
      out +=
        '<text class="tick" x="' +
        (CW.x1 + 6) +
        '" y="' +
        (Y(min) + 3.5).toFixed(1) +
        '">' +
        esc(man(min)) +
        '</text>';
    weeks.forEach(function (w, i) {
      if (i % 3 === 0 || i === n - 1)
        out +=
          '<text class="tick" x="' +
          X(i).toFixed(1) +
          '" y="' +
          (CW.h - 4) +
          '" text-anchor="' +
          (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') +
          '">' +
          esc(mmdd(w.start)) +
          '</text>';
    });
    out +=
      '<path class="area" d="M' +
      pts.join(' L') +
      ' L' +
      X(n - 1).toFixed(1) +
      ' ' +
      Y(Math.max(min, 0)).toFixed(1) +
      ' L' +
      X(0).toFixed(1) +
      ' ' +
      Y(Math.max(min, 0)).toFixed(1) +
      ' Z" data-fade></path>' +
      '<path class="line" d="M' +
      pts.join(' L') +
      '" data-draw></path>' +
      '<circle class="low' +
      (vals[lowI] < 0 ? ' is-neg' : '') +
      '" cx="' +
      X(lowI).toFixed(1) +
      '" cy="' +
      Y(vals[lowI]).toFixed(1) +
      '" r="3.5" data-fade></circle>' +
      '<circle class="end" cx="' +
      X(n - 1).toFixed(1) +
      '" cy="' +
      Y(vals[n - 1]).toFixed(1) +
      '" r="4.5" data-fade></circle>' +
      '<g class="scrub"><line class="scrub-line" y1="' +
      (CW.y0 - 6) +
      '" y2="' +
      CW.y1 +
      '"></line><circle class="scrub-dot" r="4.5"></circle></g>';
    S.scrub = { weeks: weeks, X: X, Y: Y, n: n };
    return (
      '<svg class="hb-chart is-scrub-able" id="hbCashChart" viewBox="0 0 ' +
      CW.w +
      ' ' +
      CW.h +
      '" role="img" aria-label="13주 주말 잔액 — ' +
      esc(mmdd(weeks[0].start)) +
      ' 주 ' +
      esc(man(vals[0])) +
      '에서 ' +
      esc(mmdd(weeks[n - 1].start)) +
      ' 주 ' +
      esc(man(vals[n - 1])) +
      ', 가장 낮은 주 ' +
      esc(man(vals[lowI])) +
      '">' +
      out +
      '</svg>'
    );
  }
  function cashflowHtml(d) {
    var c = d.cashflow;
    if (!c) return card('13주 현금흐름', NEED_CASH, { wide: true });
    var notes = [];
    if (!c.opening)
      notes.push(
        '<p class="hb-warn">통장 잔액을 아직 안 적었습니다 — 0 에서 시작한 흐름입니다.</p>'
      );
    else if (c.opening.stale)
      notes.push(
        '<p class="hb-warn">잔액이 ' +
          esc(c.opening.days) +
          '일 전(' +
          esc(c.opening.as_of) +
          ') 것입니다 — 새로 적어 주세요.</p>'
      );
    if (c.firstNegative !== null && c.firstNegative !== undefined)
      notes.push(
        '<p class="hb-warn is-crit">' +
          esc(c.firstNegative + 1) +
          '주차(' +
          esc(mmdd(c.weeks[c.firstNegative].start)) +
          ' 주)에 잔액이 마이너스가 됩니다.</p>'
      );
    var last = c.weeks[c.weeks.length - 1];
    return card(
      '13주 현금흐름',
      '<p class="hb-line">시작 <b>' +
        esc(c.opening ? man(c.opening.amount) : '0') +
        '</b>' +
        (c.opening ? ' (' + esc(c.opening.as_of) + ')' : '') +
        ' → 13주 뒤 <b>' +
        esc(man(last.balance)) +
        '</b> · 가장 낮은 주 <b>' +
        esc(man(c.lowest.balance)) +
        '</b> (' +
        esc(mmdd(c.lowest.start)) +
        ' 주)</p>' +
        notes.join('') +
        '<div class="hb-readout" id="hbCashReadout" aria-live="polite"><span>그래프를 훑으면 주마다</span><b></b></div>' +
        cashSvg(c.weeks) +
        '<div class="hb-facts"><div><small>밀린 받을 돈</small><b>' +
        esc(won(c.overdueIn)) +
        '</b></div>' +
        '<div><small>밀린 낼 돈</small><b>' +
        esc(won(c.overdueOut)) +
        '</b></div>' +
        '<div><small>날짜 모르는 받을 돈 (' +
        esc(cnt(c.unscheduledOrders)) +
        ')</small><b>' +
        esc(won(c.unscheduledIn)) +
        '</b></div>' +
        '<div><small>13주 뒤 들어옴 · 나감</small><b>' +
        esc(man(c.laterIn)) +
        ' · ' +
        esc(man(c.laterOut)) +
        '</b></div></div>' +
        '<p class="hb-note">들어옴 = 아직 안 받은 수금 일정(밀린 것은 이번 주). 나감 = 낼 날이 있는 원가 + 월 고정비를 주마다 ' +
        esc(won(c.weeklyOverhead)) +
        '. 오늘부터 봅니다.</p>',
      { q: '오늘부터 석 달, 주마다 통장에 얼마가 남나', wide: true }
    );
  }
  function agingHtml(d) {
    var a = d.aging;
    if (!a) return card('미수 나이', NEED_CASH);
    if (!(a.overdue > 0))
      return card(
        '미수 나이',
        '<p class="hb-line">밀린 돈이 없습니다 · 기한 전 받을 돈 <b>' +
          esc(won(a.notDue)) +
          '</b></p>'
      );
    var max = Math.max.apply(
      null,
      a.buckets
        .map(function (b) {
          return Number(b.amount) || 0;
        })
        .concat([1])
    );
    var steps = ['', 'is-warn', 'is-warn', 'is-crit'];
    var bars = a.buckets
      .map(function (b, i) {
        return (
          '<div class="hb-bar" data-bucket="' +
          esc(b.key) +
          '"><span>' +
          esc(b.label) +
          '</span><span class="hb-track">' +
          fillHtml((Number(b.amount) || 0) / max, steps[i] || '') +
          '</span><b>' +
          esc(won(b.amount)) +
          '</b></div>'
        );
      })
      .join('');
    var top = (a.top || [])
      .map(function (t) {
        return (
          '<li><span>' +
          esc(t.label) +
          ' <small>' +
          esc(t.days + '일 밀림') +
          '</small></span><b>' +
          esc(won(t.amount)) +
          '</b></li>'
        );
      })
      .join('');
    return card(
      '미수 나이',
      '<p class="hb-line">밀린 돈 <b class="hb-up">' +
        esc(won(a.overdue)) +
        '</b> · 기한 전 <b>' +
        esc(won(a.notDue)) +
        '</b></p>' +
        '<div class="hb-bars">' +
        bars +
        '</div>' +
        (top ? '<p class="hb-sub">오래 밀린 순</p><ul class="hb-list">' + top + '</ul>' : '') +
        '<p class="hb-note">수금 일정이 있으면 받기로 한 날부터, 없으면 설치(납품 · 완료)한 날부터 셉니다.</p>',
      { q: '받을 날이 지났는데 못 받은 돈 — 얼마나 오래 밀렸나' }
    );
  }
  function cashHtml(d) {
    return cashflowHtml(d) + agingHtml(d);
  }

  // ── 매출 예측 ──────────────────────────────────────
  /** 지난 달들(장부 = 흐림 · 시스템 = 남색) + 예측 석 달(점선, 이번 달은 지금까지를 안에) — 아래에서 자란다 */
  function forecastSvg(f) {
    var past = f.months.filter(function (x) {
      return !x.partial;
    });
    var nexts = f.next || [];
    var cur = f.months.filter(function (x) {
      return x.partial;
    })[0];
    var cols = past.length + Math.max(nexts.length, 1);
    var W = 340;
    var H = 160;
    var top = 14;
    var bottom = 20;
    var vals = past
      .map(function (x) {
        return x.revenue;
      })
      .concat(
        nexts.map(function (n) {
          return n.forecast;
        }),
        cur && cur.revenue ? [cur.revenue] : []
      );
    var max = Math.max.apply(null, vals.concat([1]));
    var bw = W / cols;
    var y = function (v) {
      return top + (1 - v / max) * (H - top - bottom);
    };
    var bar = function (i, v, cls, title, k) {
      return (
        '<rect class="' +
        cls +
        '" data-col="' +
        k +
        '" x="' +
        (i * bw + 1).toFixed(1) +
        '" y="' +
        y(v).toFixed(1) +
        '" width="' +
        Math.max(1, bw - 2).toFixed(1) +
        '" height="' +
        Math.max(1, H - bottom - y(v)).toFixed(1) +
        '"><title>' +
        esc(title) +
        '</title></rect>'
      );
    };
    var label = function (i, k) {
      return (
        '<text class="tick" x="' +
        (i * bw + bw / 2).toFixed(1) +
        '" y="' +
        (H - 6) +
        '" text-anchor="middle">' +
        esc(shortMonth(k)) +
        '</text>'
      );
    };
    var step = Math.ceil(cols / 6);
    var out = '';
    past.forEach(function (x, i) {
      out += bar(
        i,
        x.revenue,
        x.source === 'manual' ? 'hist' : 'sys',
        x.month + ' ' + won(x.revenue),
        i
      );
      if (i % step === 0) out += label(i, x.month);
    });
    nexts.forEach(function (n, j) {
      var i = past.length + j;
      out += bar(i, n.forecast, 'fc', n.month + ' 예측 ' + won(n.forecast), i);
      if (j === 0 && cur && cur.revenue)
        out += bar(i, cur.revenue, 'sofar', cur.month + ' 지금까지 ' + won(cur.revenue), i);
      out += label(i, n.month);
    });
    return (
      '<svg class="hb-chart" id="hbForecastChart" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" role="img" aria-label="달별 매출과 예측">' +
      out +
      '<text class="tick" x="' +
      (W - 2) +
      '" y="' +
      (top - 3) +
      '" text-anchor="end">' +
      esc(man(max)) +
      '</text></svg>' +
      '<div class="hb-legend"><span><i style="background: var(--hb-hist)"></i>장부에 적은 달</span><span><i style="background: var(--hb-sys)"></i>시스템 수주</span>' +
      '<span><i style="border: 1.5px dashed var(--hb-warn-line)"></i>예측</span></div>'
    );
  }
  function forecastHtml(d) {
    var f = d.forecast;
    if (!f)
      return card('계절 지수 · 수주 예측', '<p class="hb-empty">예측 칸이 아직 없습니다.</p>', {
        wide: true,
      });
    var p = f.pipeline || {};
    var pipe =
      p.pending > 0
        ? '결정 기다리는 확인서 <b>' +
          esc(cnt(p.pending)) +
          '</b>' +
          (p.expected !== null && p.expected !== undefined
            ? ' × 전환율 ' +
              esc(pct(p.conversion)) +
              ' × 평균 ' +
              esc(man(p.avgContract)) +
              ' ≈ <b>' +
              esc(man(p.expected)) +
              '</b>'
            : ' — 전환율 · 평균 수주를 낼 이력이 아직 없습니다')
        : '결정을 기다리는 확인서가 없습니다';
    if (!f.ready)
      return card(
        '계절 지수 · 수주 예측',
        '<p class="hb-line">끝난 달 <b>' +
          esc(f.coverage) +
          '개월</b> / ' +
          esc(f.minMonths) +
          '개월 — 열두 달이 모이면 계절 지수와 예측이 나옵니다</p>' +
          (f.needSql ? '<p class="hb-warn">과거 월 매출 칸이 아직 없습니다.</p>' : '') +
          (f.months.length > 1 ? forecastSvg(f) : '') +
          '<p class="hb-line">' +
          pipe +
          '</p>',
        { wide: true }
      );
    var strip = f.index
      .map(function (x) {
        var v = x.value;
        var cls = v === null ? '' : v >= 1.2 ? 'hi' : v <= 0.8 ? 'lo' : '';
        return (
          '<span class="' +
          cls +
          '" data-m="' +
          x.m +
          '"><small>' +
          x.m +
          '월</small><b>' +
          (v === null ? '-' : esc(v.toFixed(2))) +
          '</b></span>'
        );
      })
      .join('');
    var next = f.next
      .map(function (n) {
        return (
          '<div><small>' +
          esc(Number(String(n.month).slice(5, 7)) + '월 예측') +
          '</small>' +
          rollHtml('b', '', n.forecast, 0, 'man') +
          '</div>'
        );
      })
      .join('');
    return card(
      '계절 지수 · 수주 예측',
      '<p class="hb-line">최근 열두 달 평균 <b>' +
        esc(man(f.base)) +
        '</b> · 성수기 <b>' +
        esc(f.peak.m + '월') +
        '</b>(' +
        esc(f.peak.value) +
        ') · 비수기 <b>' +
        esc(f.low.m + '월') +
        '</b>(' +
        esc(f.low.value) +
        ')</p>' +
        forecastSvg(f) +
        '<div class="hb-facts">' +
        next +
        '</div>' +
        '<div class="hb-index" aria-label="달별 계절 지수">' +
        strip +
        '</div>' +
        '<p class="hb-line">' +
        pipe +
        '</p>' +
        '<p class="hb-note">지수 = 같은 달 평균 ÷ 전체 달 평균 (1.0 = 보통 달). 예측 = 최근 열두 달 평균 × 그 달 지수. 끝난 달 ' +
        esc(f.coverage) +
        '개월 기준.</p>',
      { q: '어느 달이 잘 되고 어느 달이 비나 · 이번 달과 다음 두 달은 얼마쯤', wide: true }
    );
  }

  // ── 그리기 · 움직임 ────────────────────────────────
  var RENDER = { profit: profitHtml, finance: financeHtml, cash: cashHtml, forecast: forecastHtml };

  /** 조각 하나를 그린다 — 실패한 조각은 그 자리에 한 줄 */
  function paint(part) {
    var view = $(PARTS[part].view);
    if (!view || !S.data) return;
    try {
      view.innerHTML = RENDER[part](S.data);
    } catch {
      view.innerHTML =
        '<p class="hb-empty">이 조각을 그리지 못했습니다 — 서버 답의 모양이 다릅니다.</p>';
    }
    var open = part === 'finance' ? view.querySelector('#hbWhatIfOpen') : null;
    if (open) open.addEventListener('click', openWhatIf);
    if (part === 'cash') bindScrub();
  }

  /** 들어올 때 — 카드는 차례로, 숫자는 굴리고, 막대는 자라고, 선은 그려진다 */
  function animate(part) {
    var m = M();
    var view = $(PARTS[part].view);
    if (!m || !view) return;
    [].forEach.call(view.querySelectorAll('.hb-card'), function (c, i) {
      m.enter(c, { transform: 'translateY(10px)', opacity: 0.35 }, i * 50);
    });
    [].forEach.call(view.querySelectorAll('.hb-calc li'), function (li, i) {
      m.enter(li, { transform: 'translateY(8px)', opacity: 0.3 }, 80 + i * 45);
    });
    [].forEach.call(view.querySelectorAll('[data-roll]'), function (el, i) {
      var to = Number(el.getAttribute('data-to'));
      var from = Number(el.getAttribute('data-from'));
      var kind = el.getAttribute('data-roll');
      var fin = el.textContent;
      if (!isFinite(to)) return;
      m.roll(
        el,
        from,
        to,
        function (v) {
          return v === to ? fin : ROLL_FMT[kind](v);
        },
        120 + i * 50
      );
    });
    [].forEach.call(view.querySelectorAll('[data-grow]'), function (el, i) {
      m.grow(el, Number(el.getAttribute('data-grow')), 'x', 150 + i * 40);
    });
    [].forEach.call(view.querySelectorAll('rect[data-col]'), function (el) {
      m.grow(el, 1, 'y', 60 + Number(el.getAttribute('data-col')) * 25);
    });
    [].forEach.call(view.querySelectorAll('path[data-draw]'), function (el) {
      m.draw(el, 150);
    });
    [].forEach.call(view.querySelectorAll('[data-fade]'), function (el) {
      m.enter(el, { opacity: 0 }, 650);
    });
  }

  // 13주 그래프 훑기 — 손가락 · 마우스를 1:1 로 (지연 · 움직임 없음)
  function bindScrub() {
    var svg = $('hbCashChart');
    var out = $('hbCashReadout');
    if (!svg || !out || !S.scrub) return;
    var g = S.scrub;
    var line = svg.querySelector('.scrub-line');
    var dot = svg.querySelector('.scrub-dot');
    var at = function (clientX) {
      var r = svg.getBoundingClientRect();
      if (!(r.width > 0)) return;
      var vx = ((clientX - r.left) / r.width) * CW.w;
      var i = Math.max(
        0,
        Math.min(g.n - 1, Math.round(((vx - CW.x0) / (CW.x1 - CW.x0)) * (g.n - 1)))
      );
      var w = g.weeks[i];
      line.setAttribute('x1', g.X(i));
      line.setAttribute('x2', g.X(i));
      dot.setAttribute('cx', g.X(i));
      dot.setAttribute('cy', g.Y(Number(w.balance) || 0));
      svg.classList.add('is-scrub');
      out.firstChild.textContent =
        mmdd(w.start) +
        '~' +
        mmdd(w.end) +
        ' · 들어옴 ' +
        man(w.inflow) +
        ' · 나감 ' +
        man(w.outflow);
      out.lastChild.textContent = '잔액 ' + man(w.balance);
    };
    var end = function () {
      svg.classList.remove('is-scrub');
      out.firstChild.textContent = '그래프를 훑으면 주마다';
      out.lastChild.textContent = '';
    };
    svg.addEventListener('pointerdown', function (e) {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* 붙잡지 못해도 그래프 안에서는 따라간다 */
      }
      at(e.clientX);
    });
    svg.addEventListener('pointermove', function (e) {
      if (
        e.pointerType === 'mouse' ||
        (svg.hasPointerCapture && svg.hasPointerCapture(e.pointerId))
      )
        at(e.clientX);
    });
    svg.addEventListener('pointerup', function (e) {
      if (e.pointerType !== 'mouse') end();
    });
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', function (e) {
      if (e.pointerType === 'mouse') end();
    });
  }

  // ── 조각 고르기 · 탭 ───────────────────────────────
  function askedPart() {
    var h = String(location.hash || '').slice(1);
    return Object.prototype.hasOwnProperty.call(PARTS, h) ? h : 'profit';
  }
  function siblings(part) {
    return ORDER.filter(function (k) {
      return PARTS[k].menu === PARTS[part].menu;
    });
  }
  function renderTabs(part) {
    var tabs = $('hbTabs');
    var sib = siblings(part);
    tabs.hidden = sib.length < 2;
    [].forEach.call(tabs.querySelectorAll('button'), function (b) {
      b.parentNode.removeChild(b);
    });
    if (tabs.hidden) return;
    sib.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('data-part', k);
      b.setAttribute('aria-selected', String(k === part));
      b.setAttribute('aria-controls', PARTS[k].view);
      b.id = 'hbTab-' + k;
      b.textContent = PARTS[k].title;
      tabs.appendChild(b);
    });
    moveTabInd(part);
  }
  function moveTabInd(part) {
    var tabs = $('hbTabs');
    var ind = tabs.querySelector('.hb-tab-ind');
    var sib = siblings(part);
    var i = sib.indexOf(part);
    if (!ind || i < 0) return;
    ind.style.width = 100 / sib.length + '%';
    ind.style.transform = 'translateX(' + i * 100 + '%)';
    [].forEach.call(tabs.querySelectorAll('[role="tab"]'), function (b) {
      b.setAttribute('aria-selected', String(b.getAttribute('data-part') === part));
    });
  }
  function head(part) {
    var p = PARTS[part];
    $('hbTitle').textContent = p.title;
    document.title = p.title + ' · SEGAN';
    $('hbMonth').hidden = !p.month;
    $('hbMonthLabel').textContent = monthLabel(S.month);
    $('hbNext').disabled = S.month >= kstMonth();
    $('hbPc').innerHTML =
      esc(PC_NOTE[part]) +
      ' <a href="../admin/management.html?part=' +
      part +
      '" data-desktop-tab>PC 화면에서 ↗</a>';
    var Shell = window.SeganShell;
    var a = $('hbPc').querySelector('a');
    if (a && Shell && Shell.applyLinkTarget) Shell.applyLinkTarget(a);
  }

  /** 조각을 보인다. from 이 있으면 탭 차례대로 좌우로 넘긴다 (들어온 쪽으로 나간다) */
  function show(part, from) {
    S.part = part;
    head(part);
    var m = M();
    ORDER.forEach(function (k) {
      var v = $(PARTS[k].view);
      if (!v) return;
      if (k === part) {
        v.hidden = false;
        v.classList.remove('is-leaving');
      } else if (k === from && m && !m.reduced() && typeof v.animate === 'function') {
        // 나가는 조각 — 잠깐 보인 채 옆으로
        var sibs = siblings(part);
        var dir = sibs.indexOf(part) > sibs.indexOf(from) ? 1 : -1;
        v.hidden = false;
        v.classList.add('is-leaving');
        var a = v.animate(
          [
            { transform: 'none', opacity: 1 },
            { transform: 'translateX(' + -dir * 32 + 'px)', opacity: 0 },
          ],
          { duration: 180, easing: 'cubic-bezier(0.4, 0, 1, 1)' }
        );
        var done = function () {
          if (S.part !== k) v.hidden = true;
          v.classList.remove('is-leaving');
        };
        a.onfinish = done;
        a.oncancel = done;
        var inV = $(PARTS[part].view);
        m.enter(inV, { transform: 'translateX(' + dir * 32 + 'px)', opacity: 0 });
      } else {
        v.hidden = true;
        v.classList.remove('is-leaving');
      }
    });
    renderTabs(part);
    animate(part);
  }

  function onTab(e) {
    var b = e.target && e.target.closest ? e.target.closest('[role="tab"]') : null;
    if (!b) return;
    var part = b.getAttribute('data-part');
    if (part === S.part) return;
    var from = S.part;
    try {
      history.replaceState(history.state, '', '#' + part); // 옆 조각 — 기록은 넣지 않는다 (뒤로 = 마이페이지)
    } catch {
      /* 주소를 못 바꿔도 조각은 바꾼다 */
    }
    show(part, from);
  }
  function onTabKey(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var sib = siblings(S.part);
    var i = sib.indexOf(S.part) + (e.key === 'ArrowRight' ? 1 : -1);
    var next = sib[(i + sib.length) % sib.length];
    var b = $('hbTab-' + next);
    if (b) {
      b.click();
      b.focus();
    }
  }

  // ── 서버 ───────────────────────────────────────────
  function setStatus(msg, error) {
    var s = $('hbStatus');
    s.textContent = msg || '';
    s.classList.toggle('is-error', !!error);
  }
  async function load(month) {
    if (S.busy) return;
    S.busy = true;
    S.month = month;
    head(S.part || askedPart());
    setStatus('불러오는 중…');
    try {
      var res = await fetch(S.base + '/management/summary?month=' + encodeURIComponent(month), {
        headers: { Authorization: 'Bearer ' + S.session.access_token },
        cache: 'no-store',
      });
      var body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      if (!res.ok || !body || body.success !== true || !body.data)
        throw new Error((body && (body.message || body.error)) || FAIL + ' (' + res.status + ')');
      S.data = body.data;
      setStatus('');
      ORDER.forEach(paint);
      show(S.part || askedPart());
    } catch (err) {
      setStatus((err && err.message) || FAIL, true);
    } finally {
      S.busy = false;
    }
  }

  async function start(r) {
    if (!r || !r.session) return; // 로그인 안내는 셸이 보인다
    if (r.admin !== true) {
      $('hbDenied').hidden = false;
      return;
    }
    var cfg = window.DADAM_CONFIG || {};
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.session = r.session;
    $('hbBoard').hidden = false;
    S.part = askedPart();
    if (!S.base) {
      setStatus('업무 서버 주소가 없습니다.', true);
      return;
    }
    $('hbTabs').addEventListener('click', onTab);
    $('hbTabs').addEventListener('keydown', onTabKey);
    $('hbPrev').addEventListener('click', function () {
      load(shiftMonth(S.month, -1));
    });
    $('hbNext').addEventListener('click', function () {
      if (S.month < kstMonth()) load(shiftMonth(S.month, 1));
    });
    // 알림 · 다른 화면이 # 만 바꾸면 그 조각으로
    window.addEventListener('hashchange', function () {
      var p = askedPart();
      if (p !== S.part && S.data) show(p, siblings(p).indexOf(S.part) >= 0 ? S.part : '');
    });
    await load(kstMonth());
  }

  var api = {
    PARTS: PARTS,
    ORDER: ORDER,
    LEVERS: LEVERS,
    applyScenario: applyScenario,
    leverDefaults: leverDefaults,
    toLevers: toLevers,
    state: S,
    show: show,
    load: load,
    openWhatIf: openWhatIf,
  };
  window.SeganHqBoard = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
