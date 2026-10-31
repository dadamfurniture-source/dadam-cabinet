/* ============================================================
   segan/admin-applications.js — 「관리 › 새 업체 신청」 (segan/admin.html#applications)

   누가      관리자 — segan/admin.js 가 관리자일 때만 부른다 (서버도 관리자만 답한다)
   서버      account-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, error | message, code })
               GET  /admin/partner/applications?status=applied,meeting   열린 신청 (최근 순, data 배열)
               POST /admin/partner/applications/:id   { action: meeting, meeting_at } | { action: approve | hold }
   화면      열린 신청(신청 접수 · 미팅 예정)마다 업체 이름 · 종류 · 상태 · 대표자 · 연락처 · 지역 · 사업자등록번호 ·
             이메일 · 신청일 · 미팅 · 하는 일, 단추 「미팅 잡기(바꾸기)」 · 「승인」 · 「보류」 —
             PC admin/expert-requests.html 과 같은 일 · 같은 안내 글. 되묻기는 화면 안에서 (브라우저 confirm 없음).
             보류 · 승인한 신청 · 협력업체 목록은 PC 화면에서 본다.
   이름      상태 · 종류 = admin/expert-requests.html STATUS_LABEL · KIND_LABEL
   못 읽으면  목록 자리에 한 줄 안내. 처리를 못 하면 서버 글을 그 카드에.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var STATUS_LABEL = {
    applied: '신청 접수',
    meeting: '미팅 예정',
    approved: '승인',
    held: '보류',
    withdrawn: '거둠',
  }; // admin/expert-requests.html
  var KIND_LABEL = { new: '새 업체', upgrade: 'Expert→Agent' }; // admin/expert-requests.html
  var OPEN = ['applied', 'meeting'];
  var PC_PAGE = '../admin/expert-requests.html';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var TEXT = {
    loadFail: '신청을 불러오지 못했습니다.',
    empty: '열린 업체 신청이 없습니다.',
    meetingPick: '미팅 날짜와 시각을 골라 주세요.',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var P = {
    sb: null,
    session: null,
    base: '',
    items: null, // 열린 신청 | null(못 읽음)
    open: null, // { id, action: meeting | approve | hold }
    err: '',
    msg: '',
    busy: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 'YYYY.MM.DD HH:MM' (ISO UTC 로 온 시각) */
  function kstTime(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
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

  /** datetime-local 값('YYYY-MM-DDTHH:MM', 한국 시간) — 칸에 지금 미팅을 채울 때 */
  function kstInput(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return (
      k.getUTCFullYear() +
      '-' +
      pad(k.getUTCMonth() + 1) +
      '-' +
      pad(k.getUTCDate()) +
      'T' +
      pad(k.getUTCHours()) +
      ':' +
      pad(k.getUTCMinutes())
    );
  }

  /** datetime-local 값(한국 시간) → UTC ISO | null */
  function meetingIso(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v || ''));
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 9 * 3600 * 1000;
    return isNaN(t) ? null : new Date(t).toISOString();
  }

  function telHref(tel) {
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }

  /** GET 본문 → 열린 신청 | null (id 가 uuid 이고 상태가 열린 것만) */
  function listOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!Array.isArray(d)) return null;
    return d.filter(function (a) {
      return (
        a &&
        typeof a === 'object' &&
        UUID_RE.test(String(a.id || '')) &&
        OPEN.indexOf(a.status) >= 0
      );
    });
  }

  /** 되묻는 글 — PC admin/expert-requests.html openDecide 와 같다 */
  function decideText(a, action) {
    var name = (a && a.company_name) || '이 업체';
    if (action === 'approve') {
      return a && a.kind === 'upgrade'
        ? name + ' — 승인하면 다음 결제일부터 Agent 금액 · 크레딧이 됩니다.'
        : name +
            ' — 승인하면 대표가 앱에서 카드를 등록하고 첫 달을 결제할 때 Agent 업체가 시작됩니다.';
    }
    return name + ' — 보류하면 이 신청은 닫힙니다. 신청자는 다시 신청할 수 있습니다.';
  }

  // ── 그리기 ─────────────────────────────────────────────
  function fact(label, html) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>';
  }

  function factsHtml(a) {
    var region = [a.sido, a.gugun].filter(Boolean).join(' ');
    var rows = [
      fact('대표자', esc(a.representative_name || '-')),
      fact(
        '연락처',
        a.contact_phone
          ? '<a href="' + esc(telHref(a.contact_phone)) + '">' + esc(a.contact_phone) + '</a>'
          : '-'
      ),
      fact('지역', esc(region || '-')),
      fact('사업자 번호', esc(a.business_number || '-')),
      fact('이메일', esc(a.email || '-')),
      fact('신청일', esc(kstTime(a.created_at) || '-')),
    ];
    if (a.meeting_at) rows.push(fact('미팅', esc(kstTime(a.meeting_at))));
    rows.push(fact('하는 일', esc(a.intro || '-')));
    return '<dl class="me-facts">' + rows.join('') + '</dl>';
  }

  function btn(act, id, label, solid) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '" data-id="' +
      esc(id) +
      '"' +
      (P.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function panelHtml(a) {
    var o = P.open;
    var err =
      '<p class="mk-error" data-err role="alert"' +
      (P.err ? '' : ' hidden') +
      '>' +
      esc(P.err) +
      '</p>';
    if (o.action === 'meeting') {
      return (
        '<div class="ad-panel" data-panel="meeting">' +
        '<label class="mk-input"><span>미팅 (한국 시간)</span><input type="datetime-local" name="meeting_at" value="' +
        esc(a.meeting_at ? kstInput(a.meeting_at) : '') +
        '" /></label>' +
        err +
        '<div class="rd-acts">' +
        btn('meeting-save', a.id, '미팅 저장', true) +
        btn('cancel', a.id, '취소') +
        '</div></div>'
      );
    }
    return (
      '<div class="ad-panel" data-panel="' +
      o.action +
      '"><p class="mk-note">' +
      esc(decideText(a, o.action)) +
      '</p>' +
      err +
      '<div class="rd-acts">' +
      btn(o.action + '-yes', a.id, o.action === 'approve' ? '승인' : '보류', true) +
      btn('cancel', a.id, '취소') +
      '</div></div>'
    );
  }

  function itemHtml(a) {
    var opened = P.open && P.open.id === a.id;
    return (
      '<li class="me-cs-item" data-app="' +
      esc(a.id) +
      '"><div class="me-pt-line"><span class="me-c-main"><b>' +
      esc(a.company_name || '이름 없음') +
      '</b><small>' +
      esc(
        [KIND_LABEL[a.kind] || a.kind || '', STATUS_LABEL[a.status] || a.status || '']
          .filter(Boolean)
          .join(' · ')
      ) +
      '</small></span></div>' +
      factsHtml(a) +
      (opened
        ? panelHtml(a)
        : '<div class="rd-acts">' +
          btn('meeting', a.id, a.status === 'meeting' ? '미팅 바꾸기' : '미팅 잡기') +
          btn('approve', a.id, '승인', true) +
          btn('hold', a.id, '보류') +
          '</div>')
    );
  }

  function render() {
    var box = $('adApplicationsBody');
    if (!box) return;
    var body;
    if (P.items === null)
      body = '<p class="me-pt-msg" role="status">' + esc(TEXT.loadFail) + '</p>';
    else if (!P.items.length) body = '<p class="me-empty">' + esc(TEXT.empty) + '</p>';
    else body = '<ul class="me-cs-list ad-list">' + P.items.map(itemHtml).join('') + '</ul>';
    box.innerHTML =
      (P.msg ? '<p class="me-pt-msg" role="status">' + esc(P.msg) + '</p>' : '') +
      body +
      '<ul class="sg-rows ad-more"><li><a class="sg-row" href="' +
      PC_PAGE +
      '">보류 · 승인한 신청과 협력업체는 PC에서</a></li></ul>';
  }

  // ── 서버 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = P.sb && (await P.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return P.session ? P.session.access_token : '';
  }

  async function call(method, path, body) {
    if (!P.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(P.base + path, {
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
    var m = r && r.body && (r.body.error || r.body.message);
    return typeof m === 'string' && m ? m : TEXT.generic;
  }

  async function fetchList() {
    var r = await call('GET', '/admin/partner/applications?status=applied,meeting');
    return r.ok ? listOf(r.body) : null;
  }

  // ── 고치기 ─────────────────────────────────────────────
  function find(id) {
    return (P.items || []).filter(function (a) {
      return a.id === id;
    })[0];
  }

  async function send(id, body, okMsg) {
    P.busy = true;
    P.err = '';
    var keep = body.action === 'meeting' ? body.meeting_at : null;
    render();
    var r = await call('POST', '/admin/partner/applications/' + encodeURIComponent(id), body);
    if (!r.ok) {
      P.busy = false;
      P.err = errText(r);
      render();
      if (keep) {
        var input = document.querySelector('[data-app="' + id + '"] input[name="meeting_at"]');
        if (input) input.value = kstInput(keep);
      }
      return;
    }
    P.items = await fetchList();
    P.busy = false;
    P.open = null;
    P.msg = okMsg;
    render();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || P.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    var a = find(id);
    if (!a) return;
    if (act === 'meeting' || act === 'approve' || act === 'hold') {
      P.open = { id: id, action: act };
      P.err = '';
      P.msg = '';
      render();
      return;
    }
    if (act === 'cancel') {
      P.open = null;
      P.err = '';
      render();
      return;
    }
    if (act === 'meeting-save') {
      var input = document.querySelector('[data-app="' + id + '"] input[name="meeting_at"]');
      var at = meetingIso(input ? input.value : '');
      if (!at) {
        P.err = TEXT.meetingPick;
        render();
        return;
      }
      send(
        id,
        { action: 'meeting', meeting_at: at },
        '미팅을 잡았습니다 — ' + kstTime(at) + ' (한국 시간)'
      );
      return;
    }
    if (act === 'approve-yes') return send(id, { action: 'approve' }, '승인했습니다.');
    if (act === 'hold-yes') return send(id, { action: 'hold' }, '보류했습니다.');
  }

  /** 새 업체 신청 칸 채우기 — admin.js 가 #applications 로 올 때 부른다 */
  async function load(sb, session) {
    var box = $('adApplicationsBody');
    if (!box) return;
    var cfg = window.DADAM_CONFIG || {};
    P.base = (cfg.accountApi && cfg.accountApi.url) || '';
    P.sb = sb;
    P.session = session;
    P.open = null;
    P.err = '';
    P.msg = '';
    P.busy = false;
    if (!box.getAttribute('data-bound')) {
      box.setAttribute('data-bound', '1');
      box.addEventListener('click', onClick);
    }
    box.innerHTML = '<p class="sg-note">불러오는 중…</p>';
    P.items = await fetchList();
    render();
  }

  window.SeganAdminApplications = {
    STATUS_LABEL: STATUS_LABEL,
    KIND_LABEL: KIND_LABEL,
    state: P,
    listOf: listOf,
    decideText: decideText,
    meetingIso: meetingIso,
    kstTime: kstTime,
    load: load,
  };
})();
