/* ============================================================
   segan/project-sheet.js — 프로젝트 한 건 창 (처음부터 끝까지 한 창에서)

   2026-11-21 대표님 「모든 공정이 자연 스럽게 이어지도록 UI가 배치 되어 있어야하고, 파이프라인도 구축 되어 있어야해」
   — 승인 계획 「프로젝트 한 길」 묶음 4. 새로 생긴 일 표의 프로젝트 이름이 연다 (줄의 「진행 보기」 단추는 11-21 뺌).

   창에 있는 것 (위에서부터)
     고객 · 전화 · 담당 · 시작한 날
     단계 띠 · 다음 할 일 — 프로젝트 줄과 같은 것 (SeganPartnerProjects.nextOf · runNext)
     일어난 일 — 오래된 것부터 (프로젝트 생김 → 설계 → 견적 → 계약 → 배송 · 완료 → A/S).
       줄 끝에 「누가」 — 구성원 이름 · 고객 · 본사 (일지가 있는 일만 — 2026-11-21 뒤 공정 1차)
     설계 · 견적 · 계약 · 제작 의뢰 · A/S — 있는 것만, 저마다 그 화면으로 가는 링크 (계약은 수주 창을 연다)

   읽기: workflow-api GET /company/projects/:id (src/company-project.js) — SeganPartnerProjects.readProject 가 읽는다
         (로그인 · 주소는 프로젝트 칸의 것을 그대로 쓴다).
   못 읽으면(옛 서버 · 오류) 이미 읽은 프로젝트 줄로 위쪽(고객 · 단계 띠 · 다음 할 일)만 그리고 알린다.
   서버에 쓰지 않는다 — 다음 할 일 단추는 프로젝트 칸이 한다. 금액 · 주소는 오지 않는다.
   창 안의 화면 링크(#p-…)는 창을 닫은 뒤 그 화면으로 간다.
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  var TEXT = {
    loading: '불러오는 중…',
    failed: '지나온 일을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.',
    none: '프로젝트를 찾을 수 없습니다.',
    noTitle: '프로젝트',
    assignee: '담당 ',
    started: ' 시작',
    history: '일어난 일',
    designs: '설계',
    quotes: '견적',
    orders: '계약',
    requests: '제작 의뢰',
    as: 'A/S',
    noName: '이름 없는 설계',
    edited: ' 고침',
    sent: ' 보냄',
    open: '열기',
    toDesign: '설계 화면',
    toQuote: '견적 화면',
    toMake: '제작 의뢰 화면',
    toAs: 'A/S 화면',
    quoteApproved: '고객 승인',
    quoteRejected: '고객 수정 요청',
    quoteExpired: '답 기한 지남',
    quoteWaiting: '고객 답 기다림',
    views: '번 열어 봄',
    depositPaid: '계약금 받음',
    depositUnpaid: '계약금 전',
    noOrderNo: '번호 없음',
    balancePaid: '잔금 받음',
    balanceUnpaid: '잔금 전',
    whoCustomer: '고객',
    whoAdmin: '본사',
    whoWorker: '작업자',
    whoMember: '구성원',
    held: '보류 중',
    cancelled: '그만둔 프로젝트',
    holdUntil: '다시 볼 날 ',
  };
  // 수주 상태 — segan/orders.js STATUS 와 같은 이름 (그 파일이 있으면 그것을 쓴다)
  var ORDER_STATUS = {
    confirmed: '접수',
    in_production: '생산 중',
    delivered: '배송',
    completed: '완료',
    cancelled: '취소',
  };
  // 제작 의뢰 상태 — segan/production-requests.js STATUS_LABEL 과 같은 이름
  var REQUEST_STATUS = {
    submitted: '접수',
    recommending: '본사 검토 중',
    recommended: '추천 도착',
    chosen: '팩토리 답 기다림',
    accepted: '팩토리가 받음',
    declined: '팩토리가 못 받음',
    expired: '팩토리 답 없음',
  };
  // A/S 상태 — segan/as-requests.js STATE_LABEL 과 같은 이름
  var AS_STATE = { requested: '접수', received: '받음', done: '끝', cancelled: '거둠' };

  var S = {
    open: null, // { id, node, handle, data, note }
  };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function PP() {
    return window.SeganPartnerProjects || null;
  }

  // ── 글 (순수 — 시험이 직접 부른다) ───────────────────────
  /** 때 (한국 시간) — 「2026.11.19 10:12」, 날짜뿐인 값은 「2026.11.19」 (모르면 빈 글자) */
  function whenText(at) {
    if (typeof at !== 'string' || !at) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at.replace(/-/g, '.');
    var t = Date.parse(at);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600000);
    return (
      k.getUTCFullYear() +
      '.' +
      pad(k.getUTCMonth() + 1) +
      '.' +
      pad(k.getUTCDate()) +
      ' ' +
      pad(k.getUTCHours()) +
      ':' +
      pad(k.getUTCMinutes())
    );
  }
  function dayText(at) {
    return whenText(at).slice(0, 10);
  }

  /** 견적 한 줄의 상태 글 — 고객 승인 · 수정 요청 · 답 기한 지남 · 답 기다림 (+ 몇 번 열어 봄) */
  function quoteText(q, now) {
    var r = obj(q);
    var views = Number(r.view_count) > 0 ? Math.floor(Number(r.view_count)) + TEXT.views : '';
    var state =
      r.decision === 'approved'
        ? TEXT.quoteApproved
        : r.decision === 'rejected'
          ? TEXT.quoteRejected
          : Date.parse(r.expires_at) <= now
            ? TEXT.quoteExpired
            : TEXT.quoteWaiting;
    return [state, views].filter(Boolean).join(' · ');
  }

  /** 누가 — 구성원 이름 · 「고객」 · 「본사」 (모르면 빈 글자). 고객 이름은 오지 않는다 */
  function byText(who) {
    var w = obj(who);
    if (w.kind === 'member') return typeof w.name === 'string' && w.name ? w.name : TEXT.whoMember;
    if (w.kind === 'customer') return TEXT.whoCustomer;
    if (w.kind === 'admin') return TEXT.whoAdmin;
    if (w.kind === 'worker') return TEXT.whoWorker;
    return '';
  }

  /** 보류 · 그만둠 한 줄 — 「보류 중 · 다시 볼 날 2026.12.05 · 「메모」」 (진행 중이면 빈 글자) */
  function stateText(p) {
    var r = obj(p);
    var state = r.status === 'on_hold' ? TEXT.held : r.status === 'cancelled' ? TEXT.cancelled : '';
    if (!state) return '';
    return [
      state,
      r.status === 'on_hold' && typeof r.hold_until === 'string' && r.hold_until
        ? TEXT.holdUntil + r.hold_until.replace(/-/g, '.')
        : '',
      typeof r.status_note === 'string' && r.status_note ? '「' + r.status_note + '」' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 맨 위 한 줄 — 고객 · 담당 · 시작한 날 (전화는 따로 링크로) */
  function whoText(p) {
    var r = obj(p);
    var who = obj(r.customer).name;
    var a = obj(r.assignee);
    var pp = PP();
    var name = a.user_id ? (pp && pp.personLabel ? pp.personLabel(a) : a.name || '') : '';
    return [
      typeof who === 'string' ? who : '',
      name ? TEXT.assignee + name : '',
      dayText(r.created_at) ? dayText(r.created_at) + TEXT.started : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function secHtml(key, title, count, inner, link) {
    return (
      '<section class="od-sec" data-ps="' +
      key +
      '"><h4 class="od-h">' +
      esc(title) +
      (count ? ' <span class="ps-n">' + count + '</span>' : '') +
      '</h4>' +
      inner +
      (link ? '<p class="ps-more"><a href="#' + link[0] + '">' + esc(link[1]) + '</a></p>' : '') +
      '</section>'
    );
  }
  function rowHtml(main, sub, act) {
    return (
      '<li><span class="ps-main">' +
      esc(main) +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span>' +
      (act || '') +
      '</li>'
    );
  }

  /** 창의 몸 — d = GET /company/projects/:id 의 data (못 읽었으면 { project: 이미 읽은 줄 }) */
  function bodyHtml(d, now) {
    var data = obj(d);
    var p = obj(data.project);
    var pp = PP();
    var flow = pp && typeof pp.nextOf === 'function' && p.id ? pp.nextOf(p) : null;
    var phone = obj(p.customer).phone;
    var who = whoText(p);
    var html =
      who || phone
        ? '<p class="ps-who">' +
          esc(who) +
          (typeof phone === 'string' && phone
            ? (who ? ' · ' : '') +
              '<a href="tel:' +
              esc(phone.replace(/[^0-9+]/g, '')) +
              '">' +
              esc(phone) +
              '</a>'
            : '') +
          '</p>'
        : '';
    // 보류 · 그만둠이면 그 사정을 한 줄로 (바꾸는 것은 프로젝트 줄의 「보류 · 그만둠」에서)
    if (stateText(p)) html += '<p class="ps-state" data-ps="state">' + esc(stateText(p)) + '</p>';
    // 실측 한 줄 — 프로젝트 줄과 같은 글 (2026-11-21 뒤 공정 2차. 잡고 끝내는 것은 프로젝트 줄에서)
    var visit = pp && typeof pp.visitText === 'function' ? pp.visitText(p) : '';
    if (visit) html += '<p class="ps-state" data-ps="visit">' + esc(visit) + '</p>';
    if (flow) {
      html +=
        (flow.strip || '') +
        (flow.note || '') +
        (flow.act ? '<div class="rd-acts">' + flow.act + (flow.tail || '') + '</div>' : '');
    }
    var history = arr(data.history).filter(function (h) {
      return h && typeof h.label === 'string' && h.label && whenText(h.at);
    });
    if (history.length)
      html += secHtml(
        'history',
        TEXT.history,
        0,
        '<ol class="ps-history">' +
          history
            .map(function (h) {
              return (
                '<li><time datetime="' +
                esc(h.at) +
                '">' +
                esc(whenText(h.at)) +
                '</time><span>' +
                esc(h.label) +
                (byText(h.who) ? ' <span class="ps-by">· ' + esc(byText(h.who)) + '</span>' : '') +
                '</span></li>'
              );
            })
            .join('') +
          '</ol>'
      );
    var designs = arr(data.designs);
    if (designs.length)
      html += secHtml(
        'designs',
        TEXT.designs,
        designs.length,
        '<ul class="ps-list">' +
          designs
            .map(function (x) {
              var r = obj(x);
              return rowHtml(
                r.name || TEXT.noName,
                dayText(r.updated_at) ? dayText(r.updated_at) + TEXT.edited : ''
              );
            })
            .join('') +
          '</ul>',
        ['p-design', TEXT.toDesign]
      );
    var quotes = arr(data.quotes);
    if (quotes.length)
      html += secHtml(
        'quotes',
        TEXT.quotes,
        quotes.length,
        '<ul class="ps-list">' +
          quotes
            .map(function (q) {
              return rowHtml(dayText(obj(q).created_at) + TEXT.sent, quoteText(q, now));
            })
            .join('') +
          '</ul>',
        ['p-quote', TEXT.toQuote]
      );
    var orders = arr(data.orders);
    var status = (window.SeganOrders && window.SeganOrders.STATUS) || ORDER_STATUS;
    if (orders.length)
      html += secHtml(
        'orders',
        TEXT.orders,
        orders.length,
        '<ul class="ps-list">' +
          orders
            .map(function (x) {
              var o = obj(x);
              var deposit =
                o.status === 'cancelled'
                  ? ''
                  : o.deposit === 'paid'
                    ? TEXT.depositPaid
                    : o.deposit === 'unpaid'
                      ? TEXT.depositUnpaid
                      : '';
              // 잔금 — 끝난 수주에서만 (잔금 줄이 없으면 적지 않는다)
              var balance =
                o.status !== 'completed'
                  ? ''
                  : o.balance === 'paid'
                    ? TEXT.balancePaid
                    : o.balance === 'unpaid'
                      ? TEXT.balanceUnpaid
                      : '';
              return rowHtml(
                (o.order_no || TEXT.noOrderNo) +
                  ' · ' +
                  (status[o.status] || ORDER_STATUS[o.status] || ''),
                [dayText(o.ordered_at), deposit, balance].filter(Boolean).join(' · '),
                '<button type="button" class="mk-btn" data-act="order" data-id="' +
                  esc(o.id) +
                  '">' +
                  esc(TEXT.open) +
                  '</button>'
              );
            })
            .join('') +
          '</ul>'
      );
    var requests = arr(data.requests);
    if (requests.length)
      html += secHtml(
        'requests',
        TEXT.requests,
        requests.length,
        '<ul class="ps-list">' +
          requests
            .map(function (x) {
              var r = obj(x);
              return rowHtml(REQUEST_STATUS[r.status] || '', dayText(r.status_at));
            })
            .join('') +
          '</ul>',
        ['p-make', TEXT.toMake]
      );
    var as = arr(data.as);
    if (as.length)
      html += secHtml(
        'as',
        TEXT.as,
        as.length,
        '<ul class="ps-list">' +
          as
            .map(function (x) {
              var r = obj(x);
              return rowHtml(AS_STATE[r.state] || '', dayText(r.created_at));
            })
            .join('') +
          '</ul>',
        ['p-as', TEXT.toAs]
      );
    return html;
  }

  function paint() {
    var O = S.open;
    if (!O) return;
    var note = O.node.querySelector('[data-ps="note"]');
    var body = O.node.querySelector('[data-ps="body"]');
    note.textContent = O.note || '';
    note.hidden = !O.note;
    body.innerHTML = O.data ? bodyHtml(O.data, Date.now()) : '';
    var Shell = window.SeganShell || {};
    if (Shell.applyLinkTarget)
      body.querySelectorAll('a[data-desktop-tab]').forEach(function (a) {
        Shell.applyLinkTarget(a);
      });
  }

  /** 창을 닫고 그 화면으로 — 닫기의 뒤로 가기가 끝난 뒤에 주소를 바꾼다 */
  function leaveTo(hash) {
    var O = S.open;
    var done = O && O.handle && typeof O.handle.close === 'function' ? O.handle.close('nav') : null;
    var move = function () {
      window.location.hash = hash;
    };
    if (done && typeof done.then === 'function') done.then(move, move);
    else move();
  }

  function onClick(e) {
    var O = S.open;
    if (!O || !e.target || !e.target.closest) return;
    var btn = e.target.closest('[data-act]');
    if (btn && !btn.disabled) {
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id') || '';
      var pp = PP();
      if (act === 'order') {
        var Orders = window.SeganOrders;
        var opened = Orders && typeof Orders.open === 'function' ? Orders.open(id) : null;
        // 수주 창이 이 창을 바꾼다. 못 열면 계약 화면으로
        Promise.resolve(opened).then(function (ok) {
          if (!ok) leaveTo('#p-contract');
        });
      } else if (
        (act === 'next-sheet' || act === 'next-order') &&
        pp &&
        typeof pp.runNext === 'function'
      ) {
        pp.runNext(act, id);
      } else if ((act === 'visit' || act === 'next-visit-done') && pp) {
        // 실측 — 창을 닫고 프로젝트 줄에서 한다 (실측 칸을 열거나, 그 자리에서 끝낸다)
        var target = btn.getAttribute('data-for') || '';
        var after = function () {
          if (act === 'visit' && typeof pp.openVisit === 'function') pp.openVisit(target);
          else if (act === 'next-visit-done' && typeof pp.runNext === 'function') pp.runNext(act, target);
        };
        var closing = O.handle && typeof O.handle.close === 'function' ? O.handle.close('nav') : null;
        if (closing && typeof closing.then === 'function') closing.then(after, after);
        else after();
      }
      return;
    }
    // 창 안의 앱 화면 링크 — 창을 닫고 간다 (새 탭으로 여는 누름 · 밖으로 나가는 링크는 그대로)
    var a = e.target.closest('a[href^="#"]');
    if (
      !a ||
      e.defaultPrevented ||
      e.button > 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    e.preventDefault();
    leaveTo(a.getAttribute('href'));
  }

  /** 열 수 있나 — 시트와 프로젝트 칸이 있고, 프로젝트를 읽는 길이 있다 */
  function canOpen() {
    var Shell = window.SeganShell;
    var pp = PP();
    return !!(
      Shell &&
      Shell.sheet &&
      typeof Shell.sheet.open === 'function' &&
      pp &&
      typeof pp.readProject === 'function'
    );
  }

  /** 프로젝트 창을 연다. 이미 읽은 줄이 있으면 그것으로 먼저 그리고, 서버에서 읽어 채운다 */
  async function open(id) {
    if (!canOpen() || typeof id !== 'string' || !id) return false;
    if (S.open && S.open.id === id) return true;
    var pp = PP();
    var items = pp.state && pp.state.data ? arr(pp.state.data.items) : [];
    var row = items.filter(function (x) {
      return x && x.id === id;
    })[0];
    var node = document.createElement('div');
    node.className = 'od-detail ps';
    node.innerHTML =
      '<p class="me-pt-msg" role="status" data-ps="note"></p><div data-ps="body"></div>';
    node.addEventListener('click', onClick);
    var O = {
      id: id,
      node: node,
      handle: null,
      data: row ? { project: row } : null,
      note: TEXT.loading,
    };
    S.open = O;
    O.handle = window.SeganShell.sheet.open({
      title: (row && row.title) || TEXT.noTitle,
      body: node,
      kind: 'sheet',
      onClose: function () {
        if (S.open === O) S.open = null;
      },
    });
    paint();
    var r = await pp.readProject(id);
    if (S.open !== O) return true; // 그 사이에 닫았다
    if (r && r.ok && r.data && typeof r.data === 'object' && obj(r.data.project).id === id) {
      O.data = r.data;
      O.note = '';
    } else {
      O.note = r && r.status === 404 && !row ? TEXT.none : TEXT.failed;
    }
    paint();
    return true;
  }

  window.SeganProjectSheet = {
    TEXT: TEXT,
    state: S,
    whenText: whenText,
    quoteText: quoteText,
    byText: byText,
    stateText: stateText,
    whoText: whoText,
    bodyHtml: bodyHtml,
    canOpen: canOpen,
    open: open,
  };
})();
