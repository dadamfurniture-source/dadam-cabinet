/* ============================================================
   segan/stock-moves.js — 「구매 · 재고 › 입출고」 (segan/me.html #stockMoves) 와
                          구매 · 재고 대시보드 숫자 (#meStockNumbers)

   읽기만 하는 두 칸. 적는 것은 기본 자재 · 철물 화면(segan/stock.js)에서 한다.
   (마이페이지 B안 6단계)

   누가 보나  다담 공장 구성원 · 협력업체 Expert · Agent 구성원 (segan/stock.js 와 같다).
             segan/me.js 가 업체 칸을 읽은 뒤 SeganStockMoves.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data })
               GET /stock/moves     { items[{ id, item_name, item_spec, unit, kind, qty, qty_after, ref, note, by, created_at }] } 새 것부터 200건
               GET /stock/summary   { short { board, hardware }, expected, offcuts { left, reserved, old }, boards[{ name, spec, unit, qty }],
                                      value { total, board, hardware, unpriced } — 재고 금액(원), 대표 · 실장 답에만 }
   화면      입출고 — 종류(전체 · 입고 · 출고 · 실사 조정)로 거르는 표: 때 · 품목 · 종류 · 수량 · 남은 수량 · 어디에 · 적은 사람.
             숫자 — 안전 재고 아래(판재 · 철물) · 입고 예정 · 자투리(남음 · 예약 · 3달 넘음) 칸과 재질별 판재 줄.
             칸을 누르면 그 화면으로 간다.
   못 읽으면  그 칸만 감춘다 (입출고는 메뉴 줄도 없다, 숫자는 대시보드에 안 나온다).
   없는 것    이번 달 매입 · 작업지시 자재 상태. 재고 금액은 서버가 줄 때만(대표 · 실장 · 단가 칸이 있을 때) 그린다.
   정보      품목 이름 · 메모는 화면에만 그린다 — 알림 · 기기 저장에 싣지 않는다. 고객 정보는 다루지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['expert', 'agent'];
  var KINDS = ['in', 'out', 'adjust'];
  var KIND_NAME = { in: '입고', out: '출고', adjust: '실사 조정' };
  var FILTERS = ['all', 'in', 'out', 'adjust'];

  var TEXT = {
    title: '입출고',
    note: '판재 · 철물이 들어오고 나간 기록입니다. 새 것부터 200건까지 보입니다. 적는 것은 「기본 자재」 · 「철물」 화면에서 합니다.',
    filter: { all: '전체', in: '입고', out: '출고', adjust: '실사 조정' },
    empty: '아직 기록이 없습니다.',
    emptyKind: '이 종류의 기록이 없습니다.',
    cols: ['때', '품목', '종류', '수량', '남은 수량', '어디에 · 메모', '적은 사람'],
    numbers: '재고 한눈에',
    shortBoard: '안전 재고 아래 — 판재',
    shortHardware: '안전 재고 아래 — 철물',
    expected: '입고 예정',
    offLeft: '자투리 남음',
    offReserved: '자투리 예약',
    offOld: '3달 넘은 자투리',
    kinds: '종',
    pieces: '조각',
    boards: '판재 재고',
    boardsNone: '쓰는 판재가 없습니다.',
    worth: '재고 금액 (판재 · 철물)',
    won: '원',
    worthParts: ['판재', '철물'],
    unpriced: '단가 없는 품목',
  };

  var J = { base: '', sb: null, session: null, moves: null, filter: 'all', sum: null };

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
    var n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return isFinite(n) ? n : null;
  }
  function count(v) {
    var n = num(v);
    return n !== null && n >= 0 ? Math.floor(n) : 0;
  }

  function canSee(me) {
    var m = obj(me);
    if (m.platform_member === true) return false;
    if (m.hq_member === true) return true;
    return PLANS.indexOf(obj(m.company).plan) >= 0;
  }

  function qtyText(n) {
    var v = num(n);
    if (v === null) return '0';
    return (Math.round(v * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  }

  /** ISO 때 → 'MM.DD HH:mm' (한국 시간) */
  function whenText(iso) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    function p(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return (
      p(k.getUTCMonth() + 1) +
      '.' +
      p(k.getUTCDate()) +
      ' ' +
      p(k.getUTCHours()) +
      ':' +
      p(k.getUTCMinutes())
    );
  }

  /** 서버가 준 기록 하나 — 모르는 종류 · 수량 없는 줄은 버린다 */
  function moveOf(v) {
    var r = obj(v);
    var qty = num(r.qty);
    if (!str(r.id) || KINDS.indexOf(r.kind) < 0 || qty === null) return null;
    return {
      id: r.id,
      kind: r.kind,
      qty: qty,
      after: num(r.qty_after),
      item: [str(r.item_name).trim(), str(r.item_spec).trim()].filter(Boolean).join(' · ') || '—',
      unit: str(r.unit).trim(),
      where: [str(r.ref).trim(), str(r.note).trim()].filter(Boolean).join(' · '),
      by: str(r.by).trim(),
      at: str(r.created_at),
    };
  }

  function movesOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(moveOf).filter(Boolean);
  }

  /** 수량 글 — 입고 +, 출고 −, 실사 조정은 부호 그대로 */
  function signed(m) {
    var plus = m.kind === 'in' || (m.kind === 'adjust' && m.qty > 0);
    return (plus ? '+' : '−') + qtyText(Math.abs(m.qty)) + m.unit;
  }

  /** 서버가 준 숫자 — 꼴이 아니면 null */
  function summaryOf(data) {
    var d = obj(data);
    if (!d.short || !d.offcuts) return null;
    var s = obj(d.short);
    var o = obj(d.offcuts);
    return {
      shortBoard: count(s.board),
      shortHardware: count(s.hardware),
      expected: count(d.expected),
      left: count(o.left),
      reserved: count(o.reserved),
      old: count(o.old),
      boards: (Array.isArray(d.boards) ? d.boards : [])
        .map(function (v) {
          var b = obj(v);
          var name = [str(b.name).trim(), str(b.spec).trim()].filter(Boolean).join(' · ');
          return name ? { name: name, unit: str(b.unit).trim(), qty: num(b.qty) || 0 } : null;
        })
        .filter(Boolean),
      value: valueOf(d.value),
    };
  }

  /** 재고 금액 — 대표 · 실장 답에만 온다. 꼴이 아니면 null (칸을 그리지 않는다) */
  function valueOf(v) {
    var o = obj(v);
    var total = num(o.total);
    if (total === null || total < 0) return null;
    return {
      total: Math.round(total),
      board: Math.round(num(o.board) || 0),
      hardware: Math.round(num(o.hardware) || 0),
      unpriced: count(o.unpriced),
    };
  }

  function wonText(n) {
    return Math.round(n).toLocaleString('ko-KR') + TEXT.won;
  }

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

  async function get(path) {
    if (!J.base) return null;
    var res;
    try {
      res = await fetch(J.base + path, {
        method: 'GET',
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
    return res.ok && b && b.success === true ? b.data : null;
  }

  // ── 입출고 ────────────────────────────────────────────────────

  function renderMoves() {
    var b = $('stockMoves');
    if (!b || !J.moves) return;
    var rows = J.moves.filter(function (m) {
      return J.filter === 'all' || m.kind === J.filter;
    });
    b.innerHTML =
      '<h3 class="me-pt-sub" id="stockMovesTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note) +
      '</p>' +
      '<div class="cs-choices oo-filter" role="group" aria-label="종류로 거르기">' +
      FILTERS.map(function (f) {
        var on = J.filter === f;
        return (
          '<button type="button" class="mk-btn' +
          (on ? ' mk-btn--solid' : '') +
          '" data-act="filter" data-filter="' +
          f +
          '" aria-pressed="' +
          on +
          '">' +
          esc(TEXT.filter[f]) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (rows.length
        ? '<div class="od-tablewrap"><table class="od-table sm-table"><thead><tr>' +
          TEXT.cols
            .map(function (c, i) {
              return (
                '<th scope="col"' +
                (i === 3 || i === 4 ? ' class="od-num"' : '') +
                '>' +
                esc(c) +
                '</th>'
              );
            })
            .join('') +
          '</tr></thead><tbody>' +
          rows
            .map(function (m) {
              return (
                '<tr data-sm-row="' +
                esc(m.id) +
                '"><td>' +
                esc(whenText(m.at)) +
                '</td><th scope="row">' +
                esc(m.item) +
                '</th><td>' +
                esc(KIND_NAME[m.kind]) +
                '</td><td class="od-num">' +
                esc(signed(m)) +
                '</td><td class="od-num">' +
                esc(m.after === null ? '' : qtyText(m.after) + m.unit) +
                '</td><td>' +
                esc(m.where) +
                '</td><td>' +
                esc(m.by) +
                '</td></tr>'
              );
            })
            .join('') +
          '</tbody></table></div>'
        : '<p class="me-empty">' + esc(J.moves.length ? TEXT.emptyKind : TEXT.empty) + '</p>');
    b.hidden = false;
    var sec = $('partner');
    if (sec) sec.hidden = false;
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act="filter"]') : null;
    if (!el) return;
    var f = el.getAttribute('data-filter');
    J.filter = FILTERS.indexOf(f) >= 0 ? f : 'all';
    renderMoves();
    var b = $('stockMoves');
    var on = b && b.querySelector('[data-act="filter"][aria-pressed="true"]');
    if (on && on.focus) on.focus();
  }

  // ── 숫자 ──────────────────────────────────────────────────────

  function kpi(key, label, value, href, warn) {
    return (
      '<div data-sn="' +
      key +
      '"' +
      (warn ? ' class="sn-warn"' : '') +
      '><dt>' +
      esc(label) +
      '</dt><dd>' +
      (href
        ? '<a href="' + href + '" data-me-go="' + href.slice(1) + '">' + esc(value) + '</a>'
        : esc(value)) +
      '</dd></div>'
    );
  }

  function renderNumbers() {
    var b = $('meStockNumbers');
    if (!b || !J.sum) return;
    var s = J.sum;
    var top = s.boards.reduce(function (m, x) {
      return Math.max(m, x.qty);
    }, 0);
    b.innerHTML =
      '<h3 class="me-pt-sub" id="meStockNumbersTitle">' +
      esc(TEXT.numbers) +
      '</h3>' +
      (s.value
        ? '<dl class="od-kpi as-kpi sn-worth" data-sn="worth"><div><dt>' +
          esc(TEXT.worth) +
          '</dt><dd>' +
          esc(wonText(s.value.total)) +
          '</dd></div><div><dt>' +
          esc(TEXT.worthParts[0]) +
          '</dt><dd>' +
          esc(wonText(s.value.board)) +
          '</dd></div><div><dt>' +
          esc(TEXT.worthParts[1]) +
          '</dt><dd>' +
          esc(wonText(s.value.hardware)) +
          '</dd></div>' +
          (s.value.unpriced
            ? '<div><dt>' +
              esc(TEXT.unpriced) +
              '</dt><dd>' +
              s.value.unpriced +
              esc(TEXT.kinds) +
              '</dd></div>'
            : '') +
          '</dl>'
        : '') +
      '<dl class="od-kpi as-kpi">' +
      kpi(
        'short-board',
        TEXT.shortBoard,
        s.shortBoard + TEXT.kinds,
        '#stock-board',
        s.shortBoard > 0
      ) +
      kpi(
        'short-hardware',
        TEXT.shortHardware,
        s.shortHardware + TEXT.kinds,
        '#stock-hardware',
        s.shortHardware > 0
      ) +
      kpi('expected', TEXT.expected, s.expected + TEXT.kinds, '') +
      kpi('off-left', TEXT.offLeft, s.left + TEXT.pieces, '#stock-scrap') +
      kpi('off-reserved', TEXT.offReserved, s.reserved + TEXT.pieces, '') +
      kpi('off-old', TEXT.offOld, s.old + TEXT.pieces, '#stock-scrap', s.old > 0) +
      '</dl><h4 class="od-h">' +
      esc(TEXT.boards) +
      '</h4>' +
      (s.boards.length
        ? '<ul class="sn-bars">' +
          s.boards
            .map(function (x) {
              var pct = top > 0 ? Math.max(Math.round((x.qty / top) * 100), x.qty > 0 ? 2 : 0) : 0;
              return (
                '<li><span class="sn-name">' +
                esc(x.name) +
                '</span><span class="sn-bar" aria-hidden="true"><i style="width:' +
                pct +
                '%"></i></span><span class="sn-qty">' +
                esc(qtyText(x.qty) + x.unit) +
                '</span></li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' + esc(TEXT.boardsNone) + '</p>');
    b.hidden = false;
  }

  function hide() {
    ['stockMoves', 'meStockNumbers'].forEach(function (id) {
      var b = $(id);
      if (b) {
        b.hidden = true;
        b.innerHTML = '';
      }
    });
  }

  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.moves = null;
    J.sum = null;
    J.filter = 'all';
    if (!J.base || !session || !canSee(me)) return;
    try {
      var got = await Promise.all([get('/stock/moves'), get('/stock/summary')]);
      J.moves = got[0] ? movesOf(got[0]) : null;
      J.sum = got[1] ? summaryOf(got[1]) : null;
      var b = $('stockMoves');
      if (b && J.moves) {
        if (!b.getAttribute('data-bound')) {
          b.setAttribute('data-bound', '1');
          b.addEventListener('click', onClick);
        }
        renderMoves();
      }
      renderNumbers();
    } catch {
      hide();
    }
  }

  window.SeganStockMoves = {
    KIND_NAME: KIND_NAME,
    TEXT: TEXT,
    canSee: canSee,
    moveOf: moveOf,
    movesOf: movesOf,
    signed: signed,
    summaryOf: summaryOf,
    valueOf: valueOf,
    whenText: whenText,
    state: J,
    load: load,
  };
})();
