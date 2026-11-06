/* ============================================================
   segan/ledger-board.js — 회계 한눈에 (segan/ledger-board.html)

   누가      업체 대표 · 실장 (GET /ledger/dashboard 가 403 이면 이유 한 줄). 본사 대표 · 실장은 ?company= 로 공장 장부를 본다
   데이터    워커 주소는 js/config.js 의 workflowApi.url
             GET /ledger/dashboard?month=YYYY-MM&months=12  12달 매출(받은 돈) · 매입 · 부가세 · 자산 · 장부 상태 수,
                                                           고른 달의 계정별 · 지출 상대 (서버 src/ledger/dashboard.js · DB 0034)
             GET /ledger/accounts                           계정 이름
             GET /books/summary?month=                      수주 금액 · 미수 · 30일 안에 받을 돈 — 본사 보기(?company=)에서는 묻지 않는다
   보이기    고른 달 칸 넷(매출 · 매입 · 장부 손익 · 부가세 참고 — 일반과세만, 반기 합) · 12달 막대(손으로 쓴 SVG, 한 축,
             고른 달만 숫자, 막대마다 <title>, 막대를 누르면 그 달로, 표로 보기) · 계정별 · 지출 상대 가로 막대 · 수주 · 미수 ·
             장부 상태 줄. 숫자는 서버 값 그대로 — 이 화면이 더하는 것은 장부 손익(매출 − 매입)과 반기 부가세 참고뿐.
   장부 화면 판  segan/ledger.html 의 「한눈에」 탭(#lgTabs 가 있으면)에서는 혼자 시작하지 않고 ledger.js 가
             mount({ sb, session, base, company, names, onMonth }) · show(달) 로 부른다 — 달 바꾸기는 장부 머리가 하고
             (판 안의 ‹ › 는 감춘다 — ledger-board.css .lb-embedded), 막대를 누르면 onMonth 로 화면 전체의 달을 바꾼다.
             장부 상태 칩은 #photos (사진 탭)로
   글은 모두 textContent · createElementNS 로 넣는다 (HTML 글을 그대로 넣지 않는다).
   ============================================================ */
/* global window, document, fetch, location, URLSearchParams */
(function () {
  'use strict';

  var DENY = {
    not_member: '회계 한눈에는 팩토리 구성원만 봅니다.',
    not_entitled: '회계 한눈에는 Expert · Agent 팩토리가 봅니다.',
    not_money: '회계 한눈에는 팩토리 대표 · 실장만 봅니다.',
  };
  var FAIL_MSG = '회계 한눈에를 불러오지 못했습니다.';
  var NOT_READY_MSG = '회계 한눈에를 준비하는 중입니다. 잠시 뒤 다시 열어 주세요.';
  var MONTHS = 12; // 워커 src/ledger/dashboard.js DASH_MONTHS
  var MAN = 10000; // 막대 눈금 단위 (만원)
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' }; // segan/books.js 와 같다
  var NS = 'http://www.w3.org/2000/svg';
  // 장부 화면의 「한눈에」 탭 안인가 (segan/ledger.html)
  var EMBED = !!document.getElementById('lgTabs');

  var B = {
    sb: null,
    session: null,
    base: '',
    company: '', // 본사 보기 — 주소의 ?company=
    month: '',
    data: null, // GET /ledger/dashboard data
    names: {}, // 계정 코드 → 이름
    books: null, // GET /books/summary data
    busy: false,
    mounted: false, // 장부 화면 판 — mount 를 한 번 했다
    onMonth: null, // 장부 화면 판 — 막대를 누르면 (달)
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 이번 달 'YYYY-MM' */
  function thisMonth() {
    var k = new Date(Date.now() + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1);
  }

  function shiftMonth(month, n) {
    var p = month.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1 + n, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }

  function monthLabel(month) {
    var p = month.split('-');
    return p[0] + '년 ' + Number(p[1]) + '월';
  }

  /** 금액 — 원 */
  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }

  /** 금액 — 만원 (반올림) */
  function man(n) {
    return Math.round(Number(n || 0) / MAN).toLocaleString('ko-KR');
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svg(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) {
      n.setAttribute(k, attrs[k]);
    });
    if (text != null) n.textContent = text;
    return n;
  }

  function setState(msg) {
    $('lbState').textContent = msg || '';
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

  /** → { ok, status, data, code, message } (끊김은 status 0) */
  async function api(path) {
    try {
      var res = await fetch(B.base + path, {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
      var b = null;
      try {
        b = await res.json();
      } catch {
        b = null;
      }
      var good = res.ok && b && b.success === true;
      return {
        ok: !!good,
        status: res.status,
        data: good ? b.data : null,
        code: b && b.code ? b.code : '',
      };
    } catch {
      return { ok: false, status: 0, data: null, code: '' };
    }
  }

  /** 본사 보기 — ?company= 를 붙인다 */
  function withCompany(path) {
    if (!B.company) return path;
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'company=' + encodeURIComponent(B.company);
  }

  // ── 계산 (순수) ─────────────────────────────────────────
  /** 고른 달 줄 · 앞 달 줄 */
  function monthRow(data, month) {
    var list = (data && data.months) || [];
    for (var i = 0; i < list.length; i++) if (list[i].month === month) return list[i];
    return null;
  }

  /** 부가세 참고 — 고른 달이 든 반기(1~6월 · 7~12월)의 매출세액 − 매입세액 (고른 달까지) */
  function vatHalf(data, month) {
    var p = month.split('-').map(Number);
    var firstMonth = p[1] <= 6 ? 1 : 7;
    var sum = 0;
    ((data && data.months) || []).forEach(function (r) {
      var q = r.month.split('-').map(Number);
      if (q[0] === p[0] && q[1] >= firstMonth && q[1] <= p[1])
        sum += Number(r.income_vat || 0) - Number(r.expense_vat || 0);
    });
    return { label: firstMonth === 1 ? '1~6월' : '7~12월', amount: sum };
  }

  // ── 그리기 ─────────────────────────────────────────────
  function tile(label, value, sub) {
    var div = el('div', 'lb-tile');
    div.appendChild(el('dt', '', label));
    var dd = el('dd', '');
    dd.appendChild(el('b', 'lb-tile-v', value));
    if (sub) dd.appendChild(el('small', 'lb-tile-s', sub));
    div.appendChild(dd);
    return div;
  }

  function renderTiles() {
    var d = B.data;
    var cur = monthRow(d, B.month) || {};
    var prev = monthRow(d, shiftMonth(B.month, -1));
    var profit = Number(cur.income || 0) - Number(cur.expense || 0);
    var box = $('lbTiles');
    box.textContent = '';
    box.appendChild(
      tile('매출 (받은 돈)', won(cur.income), '부가세 ' + won(cur.income_vat) + ' 따로')
    );
    box.appendChild(
      tile(
        '매입',
        won(cur.expense),
        '공제 부가세 ' +
          won(cur.expense_vat) +
          (cur.asset_buy ? ' · 자산 사기 ' + won(cur.asset_buy) : '')
      )
    );
    var diff = prev ? profit - (Number(prev.income || 0) - Number(prev.expense || 0)) : null;
    box.appendChild(
      tile(
        '장부 손익',
        won(profit),
        diff === null
          ? '매출 − 매입'
          : '지난달보다 ' + (diff >= 0 ? '+' : '−') + won(Math.abs(diff))
      )
    );
    if (d.vat_type === 'general') {
      var h = vatHalf(d, B.month);
      box.appendChild(
        tile('부가세 참고 (' + h.label + ')', won(h.amount), '매출세액 − 매입세액 · 참고')
      );
    } else {
      box.appendChild(
        tile(
          '부가세 참고',
          '-',
          d.vat_type ? '일반과세 업체만 보입니다' : '장부에서 과세 유형을 골라 주세요'
        )
      );
    }
  }

  /**
   * 12달 막대 — 한 축(만원), 두 줄(매출 · 매입), 고른 달만 숫자, 막대를 누르면 그 달로.
   * 그림 폭은 칸 폭 그대로(글자가 줄지 않게, 320~640). 한 달 폭이 좁으면(폰) 막대 위 숫자는 빼고 위 칸에서 본다
   */
  function renderChart() {
    var list = (B.data && B.data.months) || [];
    var W = Math.max(320, Math.min(640, $('lbChart').clientWidth || 600));
    var H = 250;
    var L0 = 48;
    var R0 = 6;
    var T0 = 16;
    var B0 = 28;
    var pw = W - L0 - R0;
    var ph = H - T0 - B0;
    var top = 0;
    list.forEach(function (r) {
      top = Math.max(top, Number(r.income || 0), Number(r.expense || 0));
    });
    // 눈금 — 만원 단위로 1 · 2 · 5 × 10^k 중 4~5칸이 되게
    var raw = Math.max(top / MAN / 4, 1);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var stepMan = [1, 2, 5, 10]
      .map(function (k) {
        return k * mag;
      })
      .filter(function (s) {
        return s >= raw;
      })[0];
    var maxMan = Math.max(stepMan * Math.ceil(top / MAN / stepMan), stepMan);
    var y = function (won) {
      return T0 + ph - (won / MAN / maxMan) * ph;
    };
    var root = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      role: 'img',
      'aria-label': '12달 매출(받은 돈)과 매입 막대 — 막대를 누르면 그 달을 봅니다',
    });
    var gw = pw / Math.max(list.length, 1);
    var bw = Math.min(16, (gw - 6) / 2);
    list.forEach(function (r, i) {
      if (r.month === B.month)
        root.appendChild(
          svg('rect', { class: 'lb-sel', x: L0 + i * gw + 1, y: T0, width: gw - 2, height: ph })
        );
    });
    for (var v = 0; v <= maxMan; v += stepMan) {
      root.appendChild(
        svg('line', {
          class: v === 0 ? 'lb-base' : 'lb-grid',
          x1: L0,
          x2: W - R0,
          y1: y(v * MAN),
          y2: y(v * MAN),
        })
      );
      root.appendChild(
        svg(
          'text',
          { class: 'lb-ax', x: L0 - 6, y: y(v * MAN) + 4, 'text-anchor': 'end' },
          v.toLocaleString('ko-KR')
        )
      );
    }
    list.forEach(function (r, i) {
      var x0 = L0 + i * gw + (gw - (bw * 2 + 2)) / 2;
      var g = svg('g', { class: 'lb-month', 'data-month': r.month, tabindex: '0', role: 'button' });
      var label = monthLabel(r.month) + ' — 매출 ' + won(r.income) + ' · 매입 ' + won(r.expense);
      g.appendChild(svg('title', {}, label));
      g.setAttribute('aria-label', label);
      // 누르기 쉬운 자리 (막대보다 넓게)
      g.appendChild(
        svg('rect', { class: 'lb-hit', x: L0 + i * gw, y: T0, width: gw, height: ph + B0 })
      );
      g.appendChild(
        svg('rect', {
          class: 'lb-bar lb-bar--in',
          x: x0,
          y: y(r.income || 0),
          width: bw,
          height: y(0) - y(r.income || 0),
        })
      );
      g.appendChild(
        svg('rect', {
          class: 'lb-bar lb-bar--out',
          x: x0 + bw + 2,
          y: y(r.expense || 0),
          width: bw,
          height: y(0) - y(r.expense || 0),
        })
      );
      g.appendChild(
        svg(
          'text',
          { class: 'lb-ax', x: L0 + i * gw + gw / 2, y: H - 9, 'text-anchor': 'middle' },
          Number(r.month.slice(5)) + '월'
        )
      );
      if (r.month === B.month && gw >= 40) {
        g.appendChild(
          svg(
            'text',
            { class: 'lb-lbl', x: x0 + bw / 2, y: y(r.income || 0) - 5, 'text-anchor': 'middle' },
            man(r.income)
          )
        );
        g.appendChild(
          svg(
            'text',
            {
              class: 'lb-lbl',
              x: x0 + bw + 2 + bw / 2,
              y: y(r.expense || 0) - 5,
              'text-anchor': 'middle',
            },
            man(r.expense)
          )
        );
      }
      root.appendChild(g);
    });
    var box = $('lbChart');
    box.textContent = '';
    box.appendChild(root);
    var tb = $('lbTableBody');
    tb.textContent = '';
    list.forEach(function (r) {
      var tr = el('tr');
      [
        monthLabel(r.month),
        won(r.income),
        won(r.expense),
        won(Number(r.income || 0) - Number(r.expense || 0)),
      ].forEach(function (c) {
        tr.appendChild(el('td', '', c));
      });
      tb.appendChild(tr);
    });
  }

  /** 가로 막대 — [{ name, amount }] */
  function bars(box, rows, empty) {
    box.textContent = '';
    if (!rows.length) {
      box.appendChild(el('p', 'lb-empty', empty));
      return;
    }
    var max = Math.max.apply(
      null,
      rows.map(function (r) {
        return r.amount;
      })
    );
    rows.forEach(function (r) {
      var row = el('div', 'lb-hb');
      row.appendChild(el('span', 'lb-hb-n', r.name));
      var track = el('span', 'lb-hb-t');
      var fill = el('span', 'lb-hb-f');
      fill.style.width = (max > 0 ? (r.amount / max) * 100 : 0).toFixed(1) + '%';
      fill.title = r.name + ' ' + won(r.amount);
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'lb-hb-v', man(r.amount)));
      box.appendChild(row);
    });
  }

  function renderBars() {
    var d = B.data;
    var acc = (d.accounts || [])
      .slice()
      .sort(function (a, b) {
        return b.amount - a.amount;
      })
      .map(function (a) {
        var name = a.account ? B.names[a.account] || a.account : '계정 미정';
        return { name: name + (a.direction === 'asset_buy' ? ' (자산)' : ''), amount: a.amount };
      });
    var mon = Number(B.month.slice(5)) + '월';
    $('lbAccTitle').textContent = mon + ' 매입 · 계정별 (만원)';
    $('lbSupTitle').textContent = mon + ' 지출 상대 · 상위 5 (만원)';
    bars($('lbAccounts'), acc, '이 달 매입이 없습니다.');
    // 서버는 보고서 몫으로 10곳까지 준다 — 한눈에는 5곳만
    bars($('lbSuppliers'), (d.suppliers || []).slice(0, 5), '이 달 지출 상대가 없습니다.');
  }

  function kv(box, pairs) {
    box.textContent = '';
    pairs.forEach(function (p) {
      box.appendChild(el('dt', '', p[0]));
      box.appendChild(el('dd', '', p[1]));
    });
  }

  function renderBooks() {
    var show = !B.company && !!B.books;
    $('lbBooks').hidden = !show;
    if (!show) return;
    var b = B.books;
    var cur = (b.months || [])[0] || {};
    var out = b.outstanding || {};
    kv($('lbBooksKv'), [
      [Number(B.month.slice(5)) + '월 수주 금액', won(cur.contract_total)],
      ['미수 (받을 날 지남)', won(out.total) + ' · ' + (out.count || 0) + '건'],
    ]);
    var up = (b.upcoming || []).slice(0, 5);
    kv(
      $('lbUpcoming'),
      up.length
        ? up.map(function (u) {
            return [
              String(u.due_on || '')
                .slice(5)
                .replace('-', '.') +
                ' · ' +
                (PAY_STAGE[u.stage] || u.stage),
              won(u.amount),
            ];
          })
        : [['없음', '']]
    );
  }

  function renderStatus() {
    var cur = monthRow(B.data, B.month) || {};
    var ul = $('lbStatus');
    ul.textContent = '';
    var add = function (text, warn, href) {
      var li = el('li', 'lb-chip' + (warn ? ' lb-chip--warn' : ''));
      if (href) {
        var a = el('a', '', text);
        a.href = href;
        li.appendChild(a);
      } else li.textContent = text;
      ul.appendChild(li);
    };
    var photos = EMBED ? '#photos' : withCompany('ledger.html');
    add('확인 기다리는 사진 ' + (B.data.pending_photos || 0) + '장', false, photos);
    if (B.data.held_statements)
      add(
        '세금계산서 기다리는 명세표 ' + B.data.held_statements + '장',
        false,
        EMBED ? '#buys' : withCompany('ledger.html')
      );
    add('증빙 경고 ' + (cur.evidence_risk || 0) + '건', cur.evidence_risk > 0);
    add('계정 미정 ' + (cur.account_unknown || 0) + '줄', cur.account_unknown > 0);
    add('부가세 모름 원가 ' + (cur.vat_unknown || 0) + '줄', cur.vat_unknown > 0);
  }

  function render() {
    $('lbMonth').textContent = monthLabel(B.month);
    $('lbNext').disabled = B.busy || B.month >= thisMonth();
    $('lbPrev').disabled = B.busy;
    renderTiles();
    renderChart();
    renderBars();
    renderBooks();
    renderStatus();
  }

  // ── 불러오기 ───────────────────────────────────────────
  async function load(month) {
    if (B.busy) return;
    B.busy = true;
    setState('불러오는 중…');
    var r = await api(withCompany('/ledger/dashboard?month=' + month + '&months=' + MONTHS));
    if (!r.ok) {
      B.busy = false;
      return setState(DENY[r.code] || FAIL_MSG);
    }
    if (!r.data || r.data.available === false) {
      B.busy = false;
      return setState(NOT_READY_MSG);
    }
    B.data = r.data;
    B.month = month;
    B.books = null;
    if (!B.company) {
      var b = await api('/books/summary?month=' + month);
      B.books = b.ok ? b.data : null;
    }
    B.busy = false;
    setState('');
    $('lbBody').hidden = false;
    render();
  }

  function onChartClick(e) {
    var g = e.target && e.target.closest ? e.target.closest('[data-month]') : null;
    if (!g || g.getAttribute('data-month') === B.month) return;
    if (B.onMonth) B.onMonth(g.getAttribute('data-month'));
    else load(g.getAttribute('data-month'));
  }

  function bind() {
    $('lbPrev').addEventListener('click', function () {
      load(shiftMonth(B.month, -1));
    });
    $('lbNext').addEventListener('click', function () {
      if (B.month < thisMonth()) load(shiftMonth(B.month, 1));
    });
    $('lbChart').addEventListener('click', onChartClick);
    window.addEventListener('resize', function () {
      if (B.data) renderChart();
    });
    $('lbChart').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onChartClick(e);
      }
    });
  }

  async function start(auth) {
    if (!auth || !auth.session || !auth.sb || !$('lbTiles')) return;
    B.sb = auth.sb;
    B.session = auth.session;
    var cfg = window.DADAM_CONFIG || {};
    B.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    if (!B.base) return setState(FAIL_MSG);
    var q = new URLSearchParams(location.search);
    var company = q.get('company') || '';
    B.company = UUID_RE.test(company) ? company : '';
    var month = q.get('month') || '';
    if (B.company) $('lbBack').href = withCompany('ledger.html');
    var acc = await api('/ledger/accounts');
    if (acc.ok)
      ((acc.data && acc.data.items) || []).forEach(function (a) {
        B.names[a.code] = a.name;
      });
    bind();
    await load(MONTH_RE.test(month) && month <= thisMonth() ? month : thisMonth());
  }

  /** 장부 화면 판 — 토큰 · 주소 · 본사 보기 · 계정 이름 · 막대 누름. 보는 업체가 바뀌면 그린 것을 버린다 */
  function mount(ctx) {
    var c = ctx || {};
    var company = UUID_RE.test(c.company || '') ? c.company : '';
    if (company !== B.company) {
      B.data = null;
      B.books = null;
      B.month = '';
    }
    B.sb = c.sb || null;
    B.session = c.session || null;
    B.base = c.base || '';
    B.company = company;
    B.names = c.names || {};
    B.onMonth = typeof c.onMonth === 'function' ? c.onMonth : null;
    if (!B.mounted) bind();
    B.mounted = true;
  }

  /** 장부 화면 판 — 그 달을 보인다 (이미 그 달을 그렸으면 다시 묻지 않는다) */
  function show(month) {
    if (!B.mounted || !MONTH_RE.test(month || '')) return Promise.resolve();
    if (B.data && B.month === month) return Promise.resolve();
    return load(month);
  }

  var exported = {
    state: B,
    mount: mount,
    show: show,
    shiftMonth: shiftMonth,
    vatHalf: vatHalf,
    monthLabel: monthLabel,
  };
  window.SeganLedgerBoard = exported;
  // 장부 화면 판이면 ledger.js 가 mount · show 로 부른다
  exported.ready = EMBED
    ? Promise.resolve(null)
    : (window.SeganShell && window.SeganShell.ready
        ? window.SeganShell.ready
        : Promise.resolve(null)
      ).then(start);
})();
