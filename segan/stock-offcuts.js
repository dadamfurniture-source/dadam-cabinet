/* ============================================================
   segan/stock-offcuts.js — 「구매 · 재고 › 자투리 자재」 (segan/me.html #stockOffcuts)

   재단하고 남은 조각을 번호(S-0001)로 적어 두고 다시 쓰는 화면.
   (마이페이지 B안 6단계 — 2026-11-12 사장님 결정: 등록은 구성원 누구나, 번호 + QR 라벨 인쇄.
    조각에 붙인 QR 을 폰 카메라로 찍으면 이 화면이 그 조각을 연 채로 열린다 — me.html?cut=<번호>#stock-scrap)

   누가 보나  다담 공장 구성원 · 협력업체 Expert · Agent 구성원 (segan/stock.js 와 같다). 등록 · 바꾸기 모두 구성원 누구나.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganStockOffcuts.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET   /stock/offcuts               { items[{ id, code, material, thickness_mm, width_mm, height_mm, place, state, memo, created_at, closed_at }] }
               POST  /stock/offcuts               등록 { material, thickness_mm, width_mm, height_mm, place?, memo? }
               PATCH /stock/offcuts/:id           { state?, place? } — 남음 ↔ 예약, 남음 · 예약 → 씀 · 버림 (되돌리지 못한다)
               GET   /stock/offcuts/:id/events    그 조각의 기록
               POST  /stock/offcuts/labels        { ids } → { labels[{ code, …, qr(<svg>) }] } — 「라벨 인쇄」 기록이 남는다
   화면      탭(남은 것 · 쓸 수 있는 것 · 3달 넘음 · 끝난 것) · 재질 · 자리로 거르기 → 줄(번호 · 재질 · 두께 · 크기 · 자리 · 들어온 날 · 상태).
             줄을 누르면 그 자리에 상세 — 예약 / 예약 풀기 · 씀 · 버림 · 자리 옮기기 · 라벨 인쇄 · 기록.
             씀 · 버림은 되돌릴 수 없어 그 자리에서 한 번 되묻는다 (확인 창을 띄우지 않는다).
             「쓸 수 있는 것」 = 남음이고 긴 변 600 · 짧은 변 400 이상. 「3달 넘음」 = 들어온 지 90일이 넘은 남음 · 예약.
   라벨      고른 조각의 QR 라벨을 이 문서 안 인쇄 칸(#stockLabels)에 그리고 인쇄 창을 연다. QR 그림은 서버가 준 것 가운데
             정해진 꼴(<svg class="so-qr"> 사각형 + 경로 하나)만 넣는다.
   없는 것    지우기 · 재질 · 두께 · 크기 고치기 (잘못 적었으면 버림으로 닫고 새로 등록한다).
   못 읽으면  칸째 감춘다 — 그때 메뉴는 「준비 중」 안내로 남는다 (segan/me.js).
   정보      조각 정보 · 메모는 화면에만 그린다 — 알림 · 기기 저장에 싣지 않는다. 고객 정보는 다루지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['expert', 'agent'];
  var STATES = ['left', 'reserved', 'used', 'discarded'];
  var STATE_NAME = { left: '남음', reserved: '예약', used: '씀', discarded: '버림' };
  var TABS = ['open', 'usable', 'old', 'closed'];
  var EVENT_NAME = {
    added: '등록',
    reserved: '예약',
    released: '예약 풂',
    used: '씀',
    discarded: '버림',
    moved: '자리 옮김',
    label: '라벨 인쇄',
  };
  var USABLE = { long: 600, short: 400 };
  var OLD_DAYS = 90;
  var LABELS_MAX = 60;
  var LIMIT = { material: 40, place: 20, memo: 200, side: 3000, thickness: 100 };
  // 서버가 주는 QR 그림 꼴 (workflow-api util/qr.js qrSvg) — 이 꼴이 아니면 그리지 않는다
  var QR_RE =
    /^<svg class="so-qr" viewBox="0 0 \d+ \d+" shape-rendering="crispEdges" xmlns="http:\/\/www\.w3\.org\/2000\/svg"><rect width="\d+" height="\d+" fill="#fff"\/><path d="[MmHhVvZz0-9 .,-]*" fill="#000"\/><\/svg>$/;

  var TEXT = {
    title: '자투리 자재',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    note: '재단하고 남은 조각을 번호로 적어 두고 다시 씁니다. 라벨의 QR 을 폰 카메라로 찍으면 그 조각이 바로 열립니다.',
    tab: { open: '남은 것', usable: '쓸 수 있는 것', old: '3달 넘음', closed: '끝난 것' },
    add: '자투리 등록',
    addTitle: '새 조각',
    material: '재질',
    thickness: '두께 (mm)',
    width: '가로 (mm)',
    height: '세로 (mm)',
    place: '자리 (선택)',
    memo: '메모 (선택)',
    memoHint: '어느 작업에서 남았는지 짧게 적습니다. 고객 이름 · 전화는 적지 않습니다.',
    usableHint: '긴 변 600 · 짧은 변 400 이상이면 「쓸 수 있는 것」에 들어갑니다.',
    printAfter: '등록한 뒤 라벨 인쇄',
    put: '등록',
    stop: '그만두기',
    all: '모두',
    empty: {
      open: '남은 조각이 없습니다.',
      usable: '쓸 수 있는 크기의 조각이 없습니다.',
      old: '3달 넘은 조각이 없습니다.',
      closed: '쓰거나 버린 조각이 없습니다.',
    },
    old: '3달 넘음',
    reserve: '예약',
    release: '예약 풀기',
    use: '씀',
    discard: '버림',
    move: '자리 옮기기',
    moveSave: '옮기기',
    label: '라벨 인쇄',
    labelMany: '고른 조각 라벨 인쇄',
    pick: '라벨 인쇄할 조각으로 고르기',
    askUse: '이 조각을 「씀」으로 닫습니다. 되돌릴 수 없습니다.',
    askDiscard: '이 조각을 「버림」으로 닫습니다. 되돌릴 수 없습니다.',
    yesUse: '씀으로 닫기',
    yesDiscard: '버림으로 닫기',
    needMaterial: '재질을 적어 주세요.',
    needSize: '두께 · 가로 · 세로를 숫자로 적어 주세요.',
    added: '등록했습니다.',
    done: {
      reserved: '예약했습니다.',
      left: '예약을 풀었습니다.',
      used: '「씀」으로 닫았습니다.',
      discarded: '「버림」으로 닫았습니다.',
    },
    moved: '자리를 옮겼습니다.',
    printed: '라벨을 인쇄 창으로 보냈습니다.',
    labelFail: '라벨을 만들지 못했습니다.',
    tooMany: '라벨은 한 번에 60장까지 인쇄합니다.',
    notFound: '조각을 찾을 수 없습니다. 다른 팩토리의 라벨이거나 번호가 잘못됐습니다.',
    history: '기록',
    historyNone: '아직 기록이 없습니다.',
    historyFail: '기록을 읽지 못했습니다.',
    historyWait: '기록을 읽는 중입니다.',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    items: [],
    tab: 'open',
    material: '',
    place: '',
    open: '',
    adding: false,
    ask: '', // 되묻는 중 — 'used' | 'discarded'
    moving: false,
    form: {},
    picked: {},
    msg: '',
    err: '',
    events: null,
    busy: false,
    now: 0,
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
    var n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
    return isFinite(n) ? n : null;
  }

  function canSee(me) {
    var m = obj(me);
    if (m.platform_member === true) return false;
    if (m.hq_member === true) return true;
    return PLANS.indexOf(obj(m.company).plan) >= 0;
  }

  function n0(n) {
    return (Math.round(n * 10) / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
  }

  /** ISO 때 → 한국 시간 { day: 'MM.DD', time: 'HH:mm' } */
  function kst(iso) {
    var t = Date.parse(str(iso));
    if (!isFinite(t)) return null;
    var k = new Date(t + 9 * 3600 * 1000);
    function p(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return {
      day: p(k.getUTCMonth() + 1) + '.' + p(k.getUTCDate()),
      time: p(k.getUTCHours()) + ':' + p(k.getUTCMinutes()),
    };
  }

  /** 서버가 준 조각 하나 — 번호 · 재질 · 크기가 없거나 모르는 상태면 버린다 */
  function rowOf(v) {
    var r = obj(v);
    var w = num(r.width_mm);
    var h = num(r.height_mm);
    var t = num(r.thickness_mm);
    var code = str(r.code).trim();
    var material = str(r.material).trim();
    if (
      !str(r.id) ||
      !code ||
      !material ||
      STATES.indexOf(r.state) < 0 ||
      !(w > 0) ||
      !(h > 0) ||
      !(t > 0)
    )
      return null;
    return {
      id: r.id,
      code: code,
      material: material,
      thickness: t,
      width: w,
      height: h,
      place: str(r.place).trim(),
      state: r.state,
      memo: str(r.memo).trim(),
      at: str(r.created_at),
    };
  }

  function listOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(rowOf).filter(Boolean);
  }

  function isOpen(c) {
    return c.state === 'left' || c.state === 'reserved';
  }

  /** 쓸 수 있는 크기인가 — 남음이고 긴 변 600 · 짧은 변 400 이상 (방향은 따지지 않는다) */
  function isUsable(c) {
    return (
      c.state === 'left' &&
      Math.max(c.width, c.height) >= USABLE.long &&
      Math.min(c.width, c.height) >= USABLE.short
    );
  }

  /** 들어온 지 90일이 넘은 열린 조각인가 */
  function isOld(c, now) {
    var t = Date.parse(c.at);
    return isOpen(c) && isFinite(t) && now - t > OLD_DAYS * 86400000;
  }

  function inTab(c, tab, now) {
    if (tab === 'closed') return !isOpen(c);
    if (tab === 'usable') return isUsable(c);
    if (tab === 'old') return isOld(c, now);
    return isOpen(c);
  }

  /** 줄 상태 글 — 열린 조각이 3달을 넘었으면 그 말을 덧붙인다 */
  function statusOf(c, now) {
    var out = [{ text: STATE_NAME[c.state] }];
    if (isOld(c, now)) out.push({ text: TEXT.old, warn: true });
    return out;
  }

  function sizeText(c) {
    return n0(c.width) + ' × ' + n0(c.height);
  }

  /** 등록 칸 → 서버로 보낼 몸. 틀리면 { error, focus } */
  function addBody(form) {
    var f = obj(form);
    var material = str(f.material).trim();
    if (!material) return { error: TEXT.needMaterial, focus: 'material' };
    var t = num(f.thickness);
    var w = num(f.width);
    var h = num(f.height);
    if (t === null || t <= 0 || t > LIMIT.thickness)
      return { error: TEXT.needSize, focus: 'thickness' };
    if (w === null || w <= 0 || w > LIMIT.side || Math.round(w) !== w)
      return { error: TEXT.needSize, focus: 'width' };
    if (h === null || h <= 0 || h > LIMIT.side || Math.round(h) !== h)
      return { error: TEXT.needSize, focus: 'height' };
    return {
      body: {
        material: material,
        thickness_mm: t,
        width_mm: w,
        height_mm: h,
        place: str(f.place).trim() || null,
        memo: str(f.memo).trim() || null,
      },
    };
  }

  /** 주소의 ?cut=<번호> — 라벨 QR 로 들어왔을 때. 숫자가 아니면 0 */
  function cutFromUrl(search) {
    var m = /[?&]cut=(\d{1,6})(?:&|$)/.exec(str(search));
    return m ? Number(m[1]) : 0;
  }

  function codeOf(seq) {
    var s = String(seq);
    while (s.length < 4) s = '0' + s;
    return 'S-' + s;
  }

  /** 서버가 준 QR 그림 — 정해진 꼴일 때만 돌려준다 */
  function safeQr(svg) {
    var s = str(svg);
    return s.length < 60000 && QR_RE.test(s) ? s : '';
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

  // ── 그리기 ────────────────────────────────────────────────────

  function box() {
    return $('stockOffcuts');
  }
  function dis() {
    return J.busy ? ' disabled' : '';
  }
  function btn(act, label, solid, extra) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (extra || '') +
      dis() +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function input(key, label, value, o) {
    var opt = o || {};
    var id = 'stockOffcuts-' + key;
    return (
      '<label class="mk-input ps-field st-field' +
      (opt.wide ? ' cp-wide' : '') +
      '" for="' +
      id +
      '"><span>' +
      esc(label) +
      '</span><input id="' +
      id +
      '" data-f="' +
      key +
      '" type="text"' +
      (opt.num ? ' inputmode="decimal"' : '') +
      (opt.max ? ' maxlength="' + opt.max + '"' : '') +
      (opt.list ? ' list="' + opt.list + '"' : '') +
      ' autocomplete="off" value="' +
      esc(value == null ? '' : value) +
      '"' +
      dis() +
      '></label>'
    );
  }

  function distinct(key) {
    var seen = {};
    var out = [];
    J.items.forEach(function (c) {
      if (c[key] && !seen[c[key]]) {
        seen[c[key]] = true;
        out.push(c[key]);
      }
    });
    return out.sort(function (a, b) {
      return a.localeCompare(b, 'ko');
    });
  }

  function errHtml() {
    return (
      '<p class="mk-error" data-so="err" role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p>'
    );
  }

  function addFormHtml() {
    var f = J.form;
    return (
      '<div class="cp-form st-form" data-so="form"><h4 class="od-h">' +
      esc(TEXT.addTitle) +
      '</h4><div class="ps-grid cp-grid">' +
      input('material', TEXT.material, f.material, {
        max: LIMIT.material,
        list: 'stockOffcuts-materials',
      }) +
      input('thickness', TEXT.thickness, f.thickness, { num: true }) +
      input('width', TEXT.width, f.width, { num: true }) +
      input('height', TEXT.height, f.height, { num: true }) +
      input('place', TEXT.place, f.place, { max: LIMIT.place, list: 'stockOffcuts-places' }) +
      input('memo', TEXT.memo, f.memo, { max: LIMIT.memo, wide: true }) +
      '</div><datalist id="stockOffcuts-materials">' +
      distinct('material')
        .map(function (m) {
          return '<option value="' + esc(m) + '"></option>';
        })
        .join('') +
      '</datalist><datalist id="stockOffcuts-places">' +
      distinct('place')
        .map(function (m) {
          return '<option value="' + esc(m) + '"></option>';
        })
        .join('') +
      '</datalist>' +
      '<small class="cp-hint">' +
      esc(TEXT.usableHint + ' ' + TEXT.memoHint) +
      '</small>' +
      '<label class="so-check"><input type="checkbox" data-so="printAfter"' +
      (f.printAfter === false ? '' : ' checked') +
      dis() +
      '> <span>' +
      esc(TEXT.printAfter) +
      '</span></label>' +
      errHtml() +
      '<div class="ps-bar">' +
      btn('save-add', TEXT.put, true) +
      btn('stop', TEXT.stop) +
      '<p class="me-pt-msg ps-msg" data-so="msg" role="status">' +
      esc(J.msg) +
      '</p></div></div>'
    );
  }

  function historyHtml() {
    var body;
    if (J.events === null) body = '<p class="me-empty">' + esc(TEXT.historyWait) + '</p>';
    else if (J.events === false) body = '<p class="me-empty">' + esc(TEXT.historyFail) + '</p>';
    else if (!J.events.length) body = '<p class="me-empty">' + esc(TEXT.historyNone) + '</p>';
    else
      body =
        '<ul class="st-history">' +
        J.events
          .map(function (e) {
            var k = kst(e.at);
            return (
              '<li><time>' +
              esc(k ? k.day + ' ' + k.time : '') +
              '</time><span>' +
              esc(EVENT_NAME[e.type] + (e.detail ? ' — ' + e.detail : '')) +
              '</span>' +
              (e.by ? '<small>' + esc(e.by) + '</small>' : '') +
              '</li>'
            );
          })
          .join('') +
        '</ul>';
    return (
      '<div class="st-hist" data-so="history"><h4 class="od-h">' +
      esc(TEXT.history) +
      '</h4>' +
      body +
      '</div>'
    );
  }

  function detailHtml(c) {
    var facts = [
      ['재질', c.material + ' · ' + n0(c.thickness) + 'T'],
      ['크기', sizeText(c) + ' mm'],
      ['자리', c.place || '—'],
    ];
    if (c.memo) facts.push(['메모', c.memo]);
    var bar;
    if (J.ask) {
      bar =
        '<p class="mk-note so-ask" role="alert">' +
        esc(J.ask === 'used' ? TEXT.askUse : TEXT.askDiscard) +
        '</p><div class="ps-bar">' +
        btn('confirm', J.ask === 'used' ? TEXT.yesUse : TEXT.yesDiscard, true) +
        btn('stop', TEXT.stop) +
        '</div>';
    } else if (J.moving) {
      bar =
        '<div class="ps-grid cp-grid">' +
        input('place', '옮길 자리', J.form.place, {
          max: LIMIT.place,
          list: 'stockOffcuts-places2',
        }) +
        '</div><datalist id="stockOffcuts-places2">' +
        distinct('place')
          .map(function (m) {
            return '<option value="' + esc(m) + '"></option>';
          })
          .join('') +
        '</datalist><div class="ps-bar">' +
        btn('save-move', TEXT.moveSave, true) +
        btn('stop', TEXT.stop) +
        '</div>';
    } else if (isOpen(c)) {
      bar =
        '<div class="ps-bar so-acts">' +
        (c.state === 'left'
          ? btn('state', TEXT.reserve, false, ' data-to="reserved"')
          : btn('state', TEXT.release, false, ' data-to="left"')) +
        btn('ask', TEXT.use, false, ' data-to="used"') +
        btn('ask', TEXT.discard, false, ' data-to="discarded"') +
        btn('move', TEXT.move) +
        btn('label', TEXT.label) +
        '</div>';
    } else bar = '';
    return (
      '<div class="st-detail" data-so="detail"><dl class="me-facts">' +
      facts
        .map(function (p) {
          return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
        })
        .join('') +
      '</dl>' +
      bar +
      errHtml() +
      '<p class="me-pt-msg ps-msg" data-so="msg" role="status">' +
      esc(J.msg) +
      '</p>' +
      historyHtml() +
      '</div>'
    );
  }

  function rowHtml(c) {
    var open = J.open === c.id;
    var k = kst(c.at);
    return (
      '<li class="me-cs-item st-item so-item' +
      (isOpen(c) ? '' : ' me-cs-item--off') +
      '" data-so-row="' +
      esc(c.id) +
      '"><div class="so-row">' +
      (isOpen(c)
        ? '<input type="checkbox" class="so-pick" data-so="pick" data-id="' +
          esc(c.id) +
          '" aria-label="' +
          esc(c.code + ' ' + TEXT.pick) +
          '"' +
          (J.picked[c.id] ? ' checked' : '') +
          dis() +
          '>'
        : '<span class="so-pick" aria-hidden="true"></span>') +
      '<button type="button" class="ad-pick" data-act="open" data-id="' +
      esc(c.id) +
      '" aria-expanded="' +
      open +
      '"' +
      dis() +
      '><span class="me-c-main"><b>' +
      esc(c.code) +
      '</b><small>' +
      esc(
        c.material +
          ' · ' +
          n0(c.thickness) +
          'T' +
          (c.place ? ' · ' + c.place : '') +
          (k ? ' · ' + k.day : '')
      ) +
      '</small></span><span class="st-qty"><span><b>' +
      esc(sizeText(c)) +
      '</b>mm</span></span><span class="ad-status st-status">' +
      statusOf(c, J.now)
        .map(function (s) {
          return (
            '<span class="od-badge' + (s.warn ? ' st-warn' : '') + '">' + esc(s.text) + '</span>'
          );
        })
        .join('') +
      '</span></button></div>' +
      (open ? detailHtml(c) : '') +
      '</li>'
    );
  }

  function filterHtml(key, label, list) {
    if (list.length < 2) return '';
    return (
      '<label class="mk-input st-supplier" for="stockOffcuts-by-' +
      key +
      '"><span>' +
      esc(label) +
      '</span><select id="stockOffcuts-by-' +
      key +
      '" data-so="filter" data-key="' +
      key +
      '"' +
      dis() +
      '><option value="">' +
      esc(TEXT.all) +
      '</option>' +
      list
        .map(function (m) {
          return (
            '<option value="' +
            esc(m) +
            '"' +
            (m === J[key] ? ' selected' : '') +
            '>' +
            esc(m) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>'
    );
  }

  function countOf(tab) {
    return J.items.filter(function (c) {
      return inTab(c, tab, J.now);
    }).length;
  }

  function rowsOf() {
    return J.items.filter(function (c) {
      return (
        inTab(c, J.tab, J.now) &&
        (!J.material || c.material === J.material) &&
        (!J.place || c.place === J.place)
      );
    });
  }

  function pickedIds() {
    return J.items
      .filter(function (c) {
        return J.picked[c.id] && isOpen(c);
      })
      .map(function (c) {
        return c.id;
      });
  }

  function keep() {
    var b = box();
    if (!b) return;
    b.querySelectorAll('[data-f]').forEach(function (el) {
      J.form[el.getAttribute('data-f')] = el.value;
    });
    var p = b.querySelector('[data-so="printAfter"]');
    if (p) J.form.printAfter = p.checked;
  }

  function render() {
    var b = box();
    if (!b || !J.ready) return;
    var rows = rowsOf();
    var n = pickedIds().length;
    b.innerHTML =
      '<h3 class="me-pt-sub" id="stockOffcutsTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.note) +
      '</p>' +
      (J.adding
        ? addFormHtml()
        : '<div class="ps-bar st-top">' +
          btn('add', TEXT.add, true) +
          (n ? btn('labels', TEXT.labelMany + ' (' + n + ')') : '') +
          '<p class="me-pt-msg ps-msg" data-so="topmsg" role="status">' +
          esc(J.open ? '' : J.msg) +
          '</p></div>' +
          (!J.open && J.err ? errHtml() : '')) +
      '<div class="cs-choices oo-filter" role="group" aria-label="상태로 거르기">' +
      TABS.map(function (t) {
        var on = J.tab === t;
        return (
          '<button type="button" class="mk-btn' +
          (on ? ' mk-btn--solid' : '') +
          '" data-act="tab" data-tab="' +
          t +
          '" aria-pressed="' +
          on +
          '"' +
          dis() +
          '>' +
          esc(TEXT.tab[t]) +
          ' <span class="cp-count">' +
          countOf(t) +
          '</span></button>'
        );
      }).join('') +
      '</div><div class="so-filters">' +
      filterHtml('material', '재질', distinct('material')) +
      filterHtml('place', '자리', distinct('place')) +
      '</div>' +
      (rows.length
        ? '<ul class="me-cs-list oo-list st-list">' + rows.map(rowHtml).join('') + '</ul>'
        : '<p class="me-empty">' + esc(TEXT.empty[J.tab]) + '</p>');
    if (J.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    b.hidden = false;
    var sec = $('partner');
    if (sec) sec.hidden = false;
  }

  function focusOn(sel) {
    var b = box();
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  function hide() {
    var b = box();
    if (b) {
      b.hidden = true;
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    J.ready = false;
  }

  function find(id) {
    return J.items.filter(function (c) {
      return c.id === id;
    })[0];
  }

  async function reloadList() {
    var r = await call('GET', '/stock/offcuts');
    var list = r.ok ? listOf(r.body.data) : null;
    if (!list) return false;
    J.items = list;
    J.now = Date.now();
    return true;
  }

  async function loadEvents(id) {
    J.events = null;
    var r = await call('GET', '/stock/offcuts/' + encodeURIComponent(id) + '/events');
    if (J.open !== id) return;
    var items = r.ok ? obj(r.body.data).items : null;
    J.events = Array.isArray(items)
      ? items
          .map(function (v) {
            var e = obj(v);
            return EVENT_NAME[e.type]
              ? {
                  type: e.type,
                  detail: str(e.detail).trim(),
                  by: str(e.by).trim(),
                  at: str(e.created_at),
                }
              : null;
          })
          .filter(Boolean)
      : false;
    var b = box();
    var slot = b && b.querySelector('[data-so="history"]');
    if (slot) slot.outerHTML = historyHtml();
  }

  function clearNote() {
    J.msg = '';
    J.err = '';
  }

  function resetRow() {
    J.ask = '';
    J.moving = false;
    J.form = {};
  }

  function open(id) {
    var same = J.open === id;
    J.open = same ? '' : id;
    J.adding = false;
    resetRow();
    clearNote();
    render();
    focusOn('[data-act="open"][data-id="' + id + '"]');
    if (!same && find(id)) loadEvents(id);
  }

  /** 라벨 인쇄 — 이 문서 안 인쇄 칸에 그리고 인쇄 창을 연다 */
  function printLabels(labels) {
    var old = $('stockLabels');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var html = labels
      .map(function (v) {
        var l = obj(v);
        var qr = safeQr(l.qr);
        if (!qr || !str(l.code)) return '';
        return (
          '<div class="so-label">' +
          qr +
          '<div class="so-label-text"><b>' +
          esc(l.code) +
          '</b><span>' +
          esc(str(l.material) + ' · ' + n0(num(l.thickness_mm) || 0) + 'T') +
          '</span><span>' +
          esc(n0(num(l.width_mm) || 0) + ' × ' + n0(num(l.height_mm) || 0) + ' mm') +
          '</span>' +
          (str(l.place) ? '<span>' + esc(l.place) + '</span>' : '') +
          '</div></div>'
        );
      })
      .join('');
    if (!html) return false;
    var el = document.createElement('div');
    el.id = 'stockLabels';
    el.className = 'so-print';
    el.innerHTML = html;
    document.body.appendChild(el);
    document.body.classList.add('so-printing');
    var done = function () {
      document.body.classList.remove('so-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    try {
      window.print();
    } catch {
      done();
    }
    return true;
  }

  async function labels(ids) {
    clearNote();
    if (!ids.length) return;
    if (ids.length > LABELS_MAX) {
      J.err = TEXT.tooMany;
      render();
      return;
    }
    J.busy = true;
    render();
    var r = await call('POST', '/stock/offcuts/labels', { ids: ids });
    var list = r.ok ? obj(r.body.data).labels : null;
    J.busy = false;
    if (Array.isArray(list) && printLabels(list)) {
      J.msg = TEXT.printed;
      J.picked = {};
    } else J.err = r.ok ? TEXT.labelFail : errText(r);
    render();
    if (J.open) loadEvents(J.open);
  }

  async function saveAdd() {
    keep();
    var made = addBody(J.form);
    clearNote();
    if (made.error) {
      J.err = made.error;
      render();
      focusOn('[data-f="' + made.focus + '"]');
      return;
    }
    var printAfter = J.form.printAfter !== false;
    J.busy = true;
    render();
    var r = await call('POST', '/stock/offcuts', made.body);
    var newId = r.ok ? str(obj(r.body.data).id) : '';
    if (r.ok) {
      await reloadList();
      // 같은 재질 · 두께 · 자리를 이어서 넣기 쉽게 남긴다
      J.form = {
        material: J.form.material,
        thickness: J.form.thickness,
        place: J.form.place,
        printAfter: printAfter,
      };
      J.tab = 'open';
      J.msg = TEXT.added + (str(obj(r.body.data).code) ? ' ' + obj(r.body.data).code : '');
    } else J.err = errText(r);
    J.busy = false;
    render();
    focusOn(r.ok ? '[data-f="width"]' : '[data-f="material"]');
    if (r.ok && printAfter && newId) await labels([newId]);
  }

  async function patch(id, body, okText) {
    clearNote();
    J.busy = true;
    render();
    var r = await call('PATCH', '/stock/offcuts/' + encodeURIComponent(id), body);
    if (r.ok) {
      await reloadList();
      resetRow();
      J.msg = okText;
      var c = find(id);
      if (c && !inTab(c, J.tab, J.now)) J.open = ''; // 탭에서 빠졌다 — 줄을 닫고 위에 알린다
    } else J.err = errText(r);
    J.busy = false;
    render();
    if (J.open) {
      focusOn('[data-act="open"][data-id="' + id + '"]');
      loadEvents(id);
    } else focusOn('[data-act="tab"][aria-pressed="true"]');
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    var c = find(J.open);
    if (act === 'tab') {
      J.tab = TABS.indexOf(el.getAttribute('data-tab')) >= 0 ? el.getAttribute('data-tab') : 'open';
      J.open = '';
      resetRow();
      clearNote();
      render();
      focusOn('[data-act="tab"][aria-pressed="true"]');
    } else if (act === 'open') open(el.getAttribute('data-id') || '');
    else if (act === 'add') {
      J.adding = true;
      J.open = '';
      resetRow();
      clearNote();
      render();
      focusOn('[data-f="material"]');
    } else if (act === 'stop') {
      J.adding = false;
      resetRow();
      clearNote();
      render();
      focusOn(J.open ? '[data-act="open"][aria-expanded="true"]' : '[data-act="add"]');
    } else if (act === 'save-add') saveAdd();
    else if (act === 'labels') labels(pickedIds());
    else if (!c) return;
    else if (act === 'state')
      patch(
        c.id,
        { state: el.getAttribute('data-to') },
        TEXT.done[el.getAttribute('data-to')] || ''
      );
    else if (act === 'ask') {
      J.ask = el.getAttribute('data-to') === 'used' ? 'used' : 'discarded';
      clearNote();
      render();
      focusOn('[data-act="confirm"]');
    } else if (act === 'confirm' && J.ask) patch(c.id, { state: J.ask }, TEXT.done[J.ask]);
    else if (act === 'move') {
      J.moving = true;
      J.form = { place: c.place };
      clearNote();
      render();
      focusOn('[data-f="place"]');
    } else if (act === 'save-move') {
      keep();
      patch(c.id, { place: str(J.form.place).trim() || null }, TEXT.moved);
    } else if (act === 'label') labels([c.id]);
  }

  function onChange(e) {
    var el = e.target;
    if (!el || !el.getAttribute) return;
    var kind = el.getAttribute('data-so');
    if (kind === 'pick') {
      keep();
      J.picked[el.getAttribute('data-id')] = el.checked;
      render();
      focusOn('[data-so="pick"][data-id="' + el.getAttribute('data-id') + '"]');
    } else if (kind === 'filter') {
      var key = el.getAttribute('data-key') === 'place' ? 'place' : 'material';
      J[key] = el.value;
      J.open = '';
      render();
      focusOn('[data-so="filter"][data-key="' + key + '"]');
    }
  }

  function onKey(e) {
    if (e.key !== 'Enter' || J.busy) return;
    var el = e.target;
    if (!el || el.tagName !== 'INPUT' || !el.getAttribute('data-f')) return;
    e.preventDefault();
    if (J.adding) saveAdd();
    else if (J.moving && find(J.open)) {
      keep();
      patch(J.open, { place: str(J.form.place).trim() || null }, TEXT.moved);
    }
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('change', onChange);
    b.addEventListener('keydown', onKey);
  }

  /** 라벨 QR 로 들어왔으면(?cut=번호) 그 조각을 연다 — 없으면 그 말을 적는다 */
  function openFromUrl() {
    var seq = cutFromUrl(window.location.search);
    if (!seq) return;
    var code = codeOf(seq);
    var c = J.items.filter(function (x) {
      return x.code === code;
    })[0];
    if (!c) {
      J.err = code + ' ' + TEXT.notFound;
      render();
      return;
    }
    J.tab = isOpen(c) ? 'open' : 'closed';
    J.open = c.id;
    render();
    var b = box();
    var li = b && b.querySelector('[data-so-row="' + c.id + '"]');
    if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    loadEvents(c.id);
  }

  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.items = [];
    J.tab = 'open';
    J.material = '';
    J.place = '';
    J.open = '';
    J.adding = false;
    J.picked = {};
    J.events = null;
    J.busy = false;
    resetRow();
    clearNote();
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await reloadList())) return;
      bind();
      J.ready = true;
      render();
      openFromUrl();
    } catch {
      hide();
    }
  }

  window.SeganStockOffcuts = {
    STATE_NAME: STATE_NAME,
    EVENT_NAME: EVENT_NAME,
    TEXT: TEXT,
    canSee: canSee,
    rowOf: rowOf,
    listOf: listOf,
    isUsable: isUsable,
    isOld: isOld,
    inTab: inTab,
    statusOf: statusOf,
    addBody: addBody,
    cutFromUrl: cutFromUrl,
    codeOf: codeOf,
    safeQr: safeQr,
    state: J,
    load: load,
  };
})();
