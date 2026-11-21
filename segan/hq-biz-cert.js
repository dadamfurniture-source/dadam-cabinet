/* ============================================================
   segan/hq-biz-cert.js — 마이페이지 관리 › 플랫폼 › 사업자등록증 확인 (segan/me.html #hqBizCert, 주소 #hq-biz-cert)

   2026-11-21 대표님 계획 승인 「사업자등록증 등록 시 첫 달 무료 — 자동 확인, 의심 건만 본사 검토」 (DB 0077).
   자동 확인(검증 숫자 · 국세청 상태 · 진위확인 · AI 가 읽은 번호)이 애매한 건만 여기로 온다 — 사진을 보고 승인 · 반려한다.
   승인하면 그 사람이 팩토리를 첫 달 무료로 시작할 수 있고, 반려하면 사유가 그 사람 화면에 보인다.

   누가 보나  다담 본사 구성원(account-api GET /partner/me 의 platform_member) 또는 사이트 관리자.
             서버가 본사 대표 · 실장 · 관리자만 연다 (403 이면 칸째 감춘다 — 메뉴 줄도 없다).
             segan/me.js 가 업체 칸을 읽은 뒤 SeganHqBizCert.load(sb, session, me, { admin }) 를 부른다.
   서버      account-api (본인 토큰 — workers/account-api/src/biz-cert.js)
               GET  /admin/partner/certs?status=review|verified|rejected   { data: [{ id, status, biz_no, company_name,
                    representative_name, open_date, extracted, review_reason, decision_reason, created_at, checks,
                    email, name, photo_url, trial }] } — 최신순 50줄, 사진 주소는 10분짜리
               POST /admin/partner/certs/:id   { decision: approve | reject, reason } — 반려는 사유 필수
             DB 0077 전(503 not_ready)이면 칸은 열고 「준비 중」 한 줄.
   화면      한 줄 안내 → 탭(검토할 것 · 확인됨 · 반려) → 카드(사진 · 번호 · 상호 · 대표자 · 개업일 · 올린 사람 · 올린 날 ·
             검토로 온 까닭 · 자동 확인 결과) → 「승인」 · 「반려」(사유를 적는다). 되묻기는 화면 안에서 (브라우저 confirm 없음).
             확인됨 탭에는 무료를 시작했는지(등급 · 기간), 반려 탭에는 사유.
             사진 주소가 10분짜리라 탭을 누르면 새로 받는다. 사진은 내려받는 단추 없이 보기만.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var TEXT = {
    lead: '자동 확인이 애매했던 사업자등록증입니다. 사진과 적힌 내용을 견줘 승인하면 그 팩토리가 첫 달 무료로 시작할 수 있습니다.',
    pending: '준비 중입니다 — DB 0077 을 적용하면 열립니다.',
    empty: {
      review: '검토할 사업자등록증이 없습니다.',
      verified: '확인된 사업자등록증이 없습니다.',
      rejected: '반려한 사업자등록증이 없습니다.',
    },
    fail: '목록을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.',
    actFail: '처리하지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
    approve: '승인',
    reject: '반려',
    askApprove: '이 사업자등록증을 승인할까요? 이 번호로 첫 달 무료를 한 번 받을 수 있게 됩니다.',
    askReject: '반려 사유를 적어 주세요. 올린 사람의 화면에 그대로 보입니다.',
    needReason: '반려 사유를 적어 주세요.',
    yesApprove: '승인하기',
    yesReject: '반려하기',
    no: '그만두기',
    taken: '그 사이 이 번호가 첫 달 무료를 받았습니다. 승인할 수 없습니다.',
    noPhoto: '사진을 열 수 없습니다. 탭을 다시 눌러 주세요.',
  };
  var TABS = [
    ['review', '검토할 것'],
    ['verified', '확인됨'],
    ['rejected', '반려'],
  ];
  // 검토로 온 까닭 (account-api review_reason)
  var REVIEW_REASON = {
    unreadable: 'AI 가 사진에서 번호를 읽지 못했습니다',
    edited: '올린 사람이 적은 번호가 AI 가 읽은 번호와 다릅니다',
    nts_mismatch: '국세청 진위확인이 맞지 않습니다 (번호 · 대표자 · 개업일)',
    nts_unavailable: '국세청에 확인하지 못했습니다',
  };
  // 자동으로 막힌 까닭 (account-api decision_reason 코드) — 본사가 적은 글은 그대로 보인다
  var REJECT_REASON = {
    checksum: '사업자등록번호 검증 숫자가 틀림',
    already_used: '이미 첫 달 무료를 받은 번호',
    not_active: '휴업 · 폐업 · 등록되지 않은 사업자',
  };
  var NTS_STATUS = {
    active: '계속사업자',
    suspended: '휴업',
    closed: '폐업',
    unregistered: '등록되지 않음',
  };
  var PLAN_LABEL = { manager: 'Manager', expert: 'Expert', agent: 'Agent' };
  var REASON_MAX = 300; // DB business_certificates.decision_reason
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var C = {
    sb: null,
    session: null,
    base: '',
    tab: 'review',
    items: null, // 그 탭의 목록 | null(못 읽음)
    pending: false,
    ask: null, // { id, action: approve | reject }
    err: '', // 열린 카드의 안내
    note: '',
    busy: false,
  };

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** https 주소만 그린다 */
  function safeSrc(u) {
    return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '';
  }
  /** 2026-11-21T… → 2026-11-21 (한국 날짜) */
  function day(iso) {
    var t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    return new Date(t + 9 * 3600000).toISOString().slice(0, 10);
  }
  function bizNo(v) {
    var d = String(v || '').replace(/\D/g, '');
    return d.length === 10
      ? d.slice(0, 3) + '-' + d.slice(3, 5) + '-' + d.slice(5)
      : String(v || '');
  }

  /** 볼 수 있나 — 본사 구성원 또는 사이트 관리자 (서버가 대표 · 실장 · 관리자만 한 번 더 거른다) */
  function canSee(me, opts) {
    var admin = !!(opts && opts.admin);
    var platform =
      !!me && typeof me === 'object' && !Array.isArray(me) && me.platform_member === true;
    return admin || platform;
  }

  /** 응답 모양 거르기 — 쓸 수 있는 줄만 */
  function itemsOf(body) {
    if (!body || body.success !== true || !Array.isArray(body.data)) return null;
    return body.data.filter(function (x) {
      return x && typeof x.id === 'string' && UUID_RE.test(x.id);
    });
  }

  /** 자동 확인 결과 줄들 — [이름, 값, 좋음 | 나쁨 | 모름] */
  function checkRows(x) {
    var k = x && x.checks && typeof x.checks === 'object' ? x.checks : {};
    var tri = function (v, yes, no) {
      return v === true ? [yes, 'ok'] : v === false ? [no, 'bad'] : ['확인 못 함', 'unknown'];
    };
    var read = x && x.extracted && typeof x.extracted === 'object' ? x.extracted.biz_no : null;
    var rows = [];
    var a = tri(k.checksum, '맞음', '틀림');
    rows.push(['검증 숫자', a[0], a[1]]);
    rows.push([
      '국세청 상태',
      NTS_STATUS[k.nts_status] || '확인 못 함',
      k.nts_status === 'active' ? 'ok' : NTS_STATUS[k.nts_status] ? 'bad' : 'unknown',
    ]);
    var b = tri(k.nts_valid, '일치', '불일치');
    rows.push(['국세청 진위확인', b[0], b[1]]);
    rows.push([
      'AI 가 읽은 번호',
      read ? bizNo(read) + (k.edited === true ? ' (적은 번호와 다름)' : '') : '읽지 못함',
      read ? (k.edited === true ? 'bad' : 'ok') : 'unknown',
    ]);
    return rows;
  }

  function fact(label, value) {
    return value ? '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>' : '';
  }

  function askHTML(x) {
    if (!C.ask || C.ask.id !== x.id) {
      return (
        '<div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="approve">' +
        esc(TEXT.approve) +
        '</button><button type="button" class="mk-btn" data-act="reject">' +
        esc(TEXT.reject) +
        '</button></div>'
      );
    }
    var reject = C.ask.action === 'reject';
    return (
      '<div class="rd-confirm me-bc-ask"><p class="mk-note">' +
      esc(reject ? TEXT.askReject : TEXT.askApprove) +
      '</p>' +
      (reject
        ? '<label class="mk-input"><span>반려 사유</span><textarea name="reason" rows="3" maxlength="' +
          REASON_MAX +
          '"></textarea></label>'
        : '') +
      (C.err ? '<p class="mk-error" role="alert">' + esc(C.err) + '</p>' : '') +
      '<div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="yes">' +
      esc(reject ? TEXT.yesReject : TEXT.yesApprove) +
      '</button><button type="button" class="mk-btn" data-act="no">' +
      esc(TEXT.no) +
      '</button></div></div>'
    );
  }

  function cardHTML(x) {
    var src = safeSrc(x.photo_url);
    var who = [x.name, x.email].filter(Boolean).join(' · ');
    var trial = x.trial && typeof x.trial === 'object' ? x.trial : null;
    var facts =
      fact('사업자등록번호', bizNo(x.biz_no)) +
      fact('상호', x.company_name) +
      fact('대표자', x.representative_name) +
      fact('개업일', x.open_date) +
      fact('올린 사람', who) +
      fact('올린 날', day(x.created_at));
    if (x.status === 'review')
      facts += fact('검토로 온 까닭', REVIEW_REASON[x.review_reason] || x.review_reason);
    if (x.status === 'rejected')
      facts += fact('반려 사유', REJECT_REASON[x.decision_reason] || x.decision_reason);
    if (x.status === 'verified')
      facts += fact(
        '첫 달 무료',
        trial
          ? (PLAN_LABEL[trial.plan] || trial.plan || '') +
              ' · ' +
              day(trial.started_at) +
              ' ~ ' +
              day(trial.ends_at)
          : '아직 시작하지 않음'
      );
    var checks = checkRows(x)
      .map(function (r) {
        return (
          '<li data-check="' +
          r[2] +
          '"><span>' +
          esc(r[0]) +
          '</span><span>' +
          esc(r[1]) +
          '</span></li>'
        );
      })
      .join('');
    return (
      '<li class="me-bc-card" data-id="' +
      esc(x.id) +
      '"><div class="me-bc-photo">' +
      (src
        ? '<img src="' +
          esc(src) +
          '" alt="사업자등록증 사진" loading="lazy" decoding="async" draggable="false" />'
        : '<p class="me-empty">' + esc(TEXT.noPhoto) + '</p>') +
      '</div><div class="me-bc-body"><dl class="me-facts">' +
      facts +
      '</dl><ul class="me-bc-checks" aria-label="자동 확인 결과">' +
      checks +
      '</ul>' +
      (x.status === 'review' ? askHTML(x) : '') +
      '</div></li>'
    );
  }

  function render() {
    var box = $('hqBizCertBody');
    if (!box) return;
    if (C.pending) {
      box.innerHTML = '<p class="me-empty">' + esc(TEXT.pending) + '</p>';
      return;
    }
    var head =
      '<p class="me-pt-sub">' +
      esc(TEXT.lead) +
      '</p><div class="me-hc-tabs" role="tablist">' +
      TABS.map(function (t) {
        return (
          '<button type="button" role="tab" data-tab="' +
          t[0] +
          '" aria-selected="' +
          (C.tab === t[0]) +
          '">' +
          esc(t[1]) +
          '</button>'
        );
      }).join('') +
      '</div>' +
      (C.note ? '<p class="mk-note" role="status">' + esc(C.note) + '</p>' : '');
    if (C.items === null) {
      box.innerHTML = head + '<p class="me-empty">' + esc(TEXT.fail) + '</p>';
      return;
    }
    box.innerHTML =
      head +
      (C.items.length
        ? '<ul class="me-bc-list">' + C.items.map(cardHTML).join('') + '</ul>'
        : '<p class="me-empty">' + esc(TEXT.empty[C.tab]) + '</p>');
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = C.sb && (await C.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return C.session ? C.session.access_token : '';
  }

  /** → { status, body } (끊기면 status 0) */
  async function call(method, path, body) {
    try {
      var headers = { Authorization: 'Bearer ' + (await token()) };
      if (body) headers['Content-Type'] = 'application/json';
      var res = await fetch(C.base + path, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
      var json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, body: json };
    } catch {
      return { status: 0, body: null };
    }
  }

  /** 그 탭의 목록을 새로 받는다 (사진 주소가 10분짜리다) → { r, items } */
  async function fetchTab(tab) {
    var r = await call('GET', '/admin/partner/certs?status=' + encodeURIComponent(tab));
    return { r: r, items: itemsOf(r.body) };
  }

  async function openTab(tab) {
    if (C.busy) return;
    C.busy = true;
    C.tab = tab;
    C.ask = null;
    C.err = '';
    C.note = '';
    var p = await fetchTab(tab);
    C.busy = false;
    C.items = p.items;
    render();
  }

  /** 승인 · 반려 보내기 — 반려는 사유가 있어야 한다 */
  async function decide(card) {
    if (!C.ask || C.busy) return;
    var id = C.ask.id;
    var reject = C.ask.action === 'reject';
    var area = card ? card.querySelector('textarea[name="reason"]') : null;
    var reason = area ? String(area.value || '').trim() : '';
    if (reject && !reason) {
      C.err = TEXT.needReason;
      render();
      var again = $('hqBizCertBody').querySelector('textarea[name="reason"]');
      if (again && again.focus) again.focus();
      return;
    }
    C.busy = true;
    var body = { decision: reject ? 'reject' : 'approve' };
    if (reason) body.reason = reason.slice(0, REASON_MAX);
    var r = await call('POST', '/admin/partner/certs/' + encodeURIComponent(id), body);
    C.busy = false;
    if (r.status === 200 && r.body && r.body.success === true) {
      // 처리한 줄은 검토 목록에서 빠진다
      C.items = (C.items || []).filter(function (x) {
        return x.id !== id;
      });
      C.ask = null;
      C.err = '';
      C.note = reject ? '반려했습니다.' : '승인했습니다.';
      return render();
    }
    var code = r.body && r.body.code;
    C.err =
      code === 'already_used'
        ? TEXT.taken
        : (r.body && typeof r.body.error === 'string' && r.body.error) || TEXT.actFail;
    render();
  }

  function onClick(e) {
    var t = e.target;
    var tab = t.closest && t.closest('[data-tab]');
    if (tab) return openTab(tab.getAttribute('data-tab'));
    var btn = t.closest && t.closest('[data-act]');
    if (!btn || C.busy) return;
    var act = btn.getAttribute('data-act');
    var card = btn.closest('[data-id]');
    if (!card) return;
    if (act === 'approve' || act === 'reject') {
      C.ask = { id: card.getAttribute('data-id'), action: act };
      C.err = '';
      C.note = '';
      render();
      var area = $('hqBizCertBody').querySelector('textarea[name="reason"]');
      if (area && area.focus) area.focus();
      return;
    }
    if (act === 'no') {
      C.ask = null;
      C.err = '';
      return render();
    }
    if (act === 'yes') return decide(card);
  }

  /** 사업자등록증 확인 칸 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data, opts.admin = 사이트 관리자 */
  async function load(sb, session, me, opts) {
    var section = $('hqBizCert');
    var box = $('hqBizCertBody');
    if (!section || !box) return;
    section.hidden = true;
    var cfg = window.DADAM_CONFIG || {};
    C.base = (cfg.accountApi && cfg.accountApi.url) || '';
    C.sb = sb;
    C.session = session;
    C.tab = 'review';
    C.items = null;
    C.pending = false;
    C.ask = null;
    C.err = '';
    C.note = '';
    C.busy = false;
    if (!C.base || !session || !canSee(me, opts)) return;
    try {
      var p = await fetchTab('review');
      var code = p.r.body && p.r.body.code;
      if (p.r.status === 503 && code === 'not_ready') C.pending = true;
      else if (!p.items)
        return; // 403 · 오류 — 칸째 감춘다
      else C.items = p.items;
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
        // 사진은 보기만 — 오른쪽 단추 메뉴 · 끌기를 막는다
        ['contextmenu', 'dragstart'].forEach(function (type) {
          box.addEventListener(type, function (ev) {
            if (ev.target && ev.target.tagName === 'IMG') ev.preventDefault();
          });
        });
      }
      render();
      section.hidden = false;
    } catch {
      section.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganHqBizCert = {
    TEXT: TEXT,
    TABS: TABS,
    REVIEW_REASON: REVIEW_REASON,
    REJECT_REASON: REJECT_REASON,
    state: C,
    canSee: canSee,
    itemsOf: itemsOf,
    checkRows: checkRows,
    load: load,
  };
})();
