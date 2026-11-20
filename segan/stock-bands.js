/**
 * 구매 · 재고 › 기본 자재 — 밴드 재고 칸 (2026-11-19 사장님 「빼기는 밴드 재고 운영, 60*2440의 밴드를 18개 기본 재고로 만들고 8개가 남으면
 *   새로운 밴드재고 만들기로 요청.」 · 질문 창 「알림 + 「밴드 만들기」 줄」).
 *   segan/stock.js 가 기본 자재 화면을 그릴 때 맨 위 자리(data-st-bands)를 주고 mount 를 부른다 — 이 칸은 자기 값을 따로 읽는다.
 *   서버: workflow-api src/stock-bands.js — GET /stock/bands · POST /stock/bands/items · POST /stock/bands/requests/:id/made · …/cancel (DB 0074).
 *   생산 설정에서 소부품 「빼기」를 고른 팩토리에만 보인다. 화면 글은 값 · 상태 · 단추만 (풀이는 AI 도우미 지식).
 */
(function () {
  'use strict';

  var TEXT = {
    title: '밴드 재고',
    makeItems: '밴드 품목 만들기',
    made: '만들었음',
    cancel: '요청 취소',
    requested: '만들기 요청',
    short: '만들 때',
    none: '밴드 품목이 없습니다.',
    sheet: '꺼낸 원장',
    noSheet: '원장 없이 (밴드만 입고)',
    working: '처리하는 중입니다.',
    done: '적었습니다.',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    pending: 'DB 적용 전입니다 — 밴드 재고는 적용 뒤에 쓸 수 있습니다.',
  };

  var J = { el: null, base: '', token: null, data: null, boards: [], busy: false, msg: '', err: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }
  function qtyText(n) {
    var v = num(n);
    return (Math.round(v * 100) / 100).toLocaleString('ko-KR');
  }
  var colorText = function (c) {
    return c ? String(c) : '색 없음';
  };

  async function call(method, path, body) {
    if (!J.base || !J.token) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await J.token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(J.base + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
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
    if (r && r.body && r.body.code === 'db_pending') return TEXT.pending;
    return (r && r.body && r.body.message) || TEXT.generic;
  }

  /** 보이는가 — 빼기 팩토리 · 밴드 품목이 있거나 · 대표 · 실장 (팩토리 기본이 더하기여도 설계마다 빼기를 고른다 — 2026-11-20 「BOM에도 … 이 설계에만」) */
  function shown(d) {
    return !!d && (d.mode === 'stock' || (Array.isArray(d.items) && d.items.length > 0) || !!d.can_manage);
  }

  /** 칸 한 장 — 보이지 않으면 빈 글 */
  function html(d, boards, state) {
    if (!shown(d)) return '';
    var b = d.band || {};
    var off = state.busy ? ' disabled' : '';
    var items = Array.isArray(d.items) ? d.items : [];
    var sheetSelect = function (id) {
      return (
        '<select data-sb-sheet="' + esc(id) + '" aria-label="' + esc(TEXT.sheet) + '"' + off + '><option value="">' + esc(TEXT.noSheet) + '</option>' +
        boards
          .map(function (it) {
            return '<option value="' + esc(it.id) + '">' + esc(it.name + (it.spec ? ' · ' + it.spec : '') + ' (' + qtyText(it.qty) + it.unit + ')') + '</option>';
          })
          .join('') +
        '</select>'
      );
    };
    var rows = items
      .map(function (it) {
        var r = it.request;
        return (
          '<li class="sg-row st-band' + (it.short ? ' st-short' : '') + '" data-sb-item="' + esc(it.id) + '">' +
          '<b>' + esc(colorText(it.color)) + '</b> <span class="muted">' + esc(it.spec || '') + '</span> ' +
          '<span class="st-qty">' + qtyText(it.qty) + esc(it.unit || '본') + '</span>' +
          (it.short ? ' <span class="st-badge warn">' + esc(TEXT.short) + '</span>' : '') +
          (r
            ? '<div class="st-band-req">' + esc(TEXT.requested) + ' ' + esc(r.code) + ' · ' + qtyText(r.qty) + esc(it.unit || '본') + ' ' +
              sheetSelect(r.id) +
              ' <button type="button" class="sg-btn sg-btn-solid" data-sb-made="' + esc(r.id) + '"' + off + '>' + esc(TEXT.made) + '</button>' +
              (d.can_manage ? ' <button type="button" class="sg-btn" data-sb-cancel="' + esc(r.id) + '"' + off + '>' + esc(TEXT.cancel) + '</button>' : '') +
              '</div>'
            : '') +
          '</li>'
        );
      })
      .join('');
    return (
      '<div class="od-sec st-bands" data-sb>' +
      '<h4 class="od-h">' + esc(TEXT.title) + ' <span class="muted">' + esc((b.material || 'PB') + ' ' + num(b.thickness) + 'T · ' + num(b.width) + ' × ' + num(b.length) + ' · ' + num(b.base) + '본씩 · ' + num(b.reorder) + '본 남으면') + '</span></h4>' +
      (rows ? '<ul class="me-cs-list st-list">' + rows + '</ul>' : '<p class="me-empty">' + esc(TEXT.none) + '</p>') +
      (d.can_manage ? '<div class="ps-bar"><button type="button" class="sg-btn" data-sb-items' + off + '>' + esc(TEXT.makeItems) + '</button></div>' : '') +
      '<p class="me-pt-msg ps-msg' + (state.err ? ' err' : '') + '" data-sb-msg role="status">' + esc(state.msg || '') + '</p>' +
      '</div>'
    );
  }

  function draw() {
    if (!J.el) return;
    J.el.innerHTML = html(J.data, J.boards, J);
    J.el.hidden = !J.el.innerHTML;
  }

  async function reload() {
    var r = await call('GET', '/stock/bands');
    J.data = r.ok ? r.body.data : null;
    if (shown(J.data)) {
      var s = await call('GET', '/stock/items?kind=board');
      J.boards = s.ok && s.body.data && Array.isArray(s.body.data.items) ? s.body.data.items.filter(function (it) { return it.active !== false; }) : [];
    }
    draw();
  }

  async function act(fn) {
    if (J.busy) return;
    J.busy = true;
    J.msg = TEXT.working;
    J.err = false;
    draw();
    var r = await fn();
    J.busy = false;
    J.msg = r.ok ? TEXT.done : errText(r);
    J.err = !r.ok;
    if (r.ok) await reload();
    else draw();
  }

  function onClick(e) {
    var t = e.target;
    var made = t.closest && t.closest('[data-sb-made]');
    if (made) {
      var id = made.getAttribute('data-sb-made');
      var sel = J.el.querySelector('[data-sb-sheet="' + id + '"]');
      var sheet = sel && sel.value ? sel.value : null;
      act(function () {
        return call('POST', '/stock/bands/requests/' + encodeURIComponent(id) + '/made', sheet ? { sheet_item_id: sheet } : {});
      });
      return;
    }
    var cancel = t.closest && t.closest('[data-sb-cancel]');
    if (cancel) {
      var cid = cancel.getAttribute('data-sb-cancel');
      act(function () {
        return call('POST', '/stock/bands/requests/' + encodeURIComponent(cid) + '/cancel');
      });
      return;
    }
    if (t.closest && t.closest('[data-sb-items]')) {
      act(function () {
        return call('POST', '/stock/bands/items', {});
      });
    }
  }

  /** stock.js 가 기본 자재 화면을 그릴 때마다 부른다 — 처음이면 읽고, 아니면 가진 값으로 다시 그린다 */
  function mount(el, ctx) {
    if (!el) return;
    var first = J.el !== el;
    J.el = el;
    J.base = ctx && ctx.base ? ctx.base : J.base;
    J.token = ctx && ctx.token ? ctx.token : J.token;
    if (first) el.addEventListener('click', onClick);
    if (first && !J.data) reload();
    else draw();
  }

  window.SeganStockBands = { mount: mount, html: html, TEXT: TEXT };
})();
