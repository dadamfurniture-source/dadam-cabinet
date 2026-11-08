/* ============================================================
   segan/factory-requests.js — 「내 정보 › 업체 › 제작 의뢰함」 (segan/me.html#factory-requests)

   2026-11-08 제작 의뢰: 다담 본사가 추천한 팩토리 가운데 Manager 업체가 고른 곳에 의뢰가 온다.
   고른 때부터 24시간 안에 받기 · 못 받음 (답이 없으면 1분 cron 이 답 없음으로 돌려보내고 본사가 다시 추천).
   받으면 이 팩토리에 — 고객(의뢰한 Manager 업체) · 새 프로젝트 · 간편 플래너 설계 사본 (사진은 오지 않는다).

   누가 보나  팩토리 풀의 구성원 — 다담 공장 구성원(hq_member) · Expert · Agent 협력업체 구성원
             (워커 distribution/rules.js POOL_PLANS — 추천받을 수 있는 곳). account-api GET /partner/me 로 가린다.
             ★ company.plan(등급)과 company.role(직책 — manager 는 실장)은 다르다.
             목록은 구성원 모두, 받기 · 못 받음은 서버 응답의 can_act(대표 · 실장)와 줄마다 can_act(답 기다림 · 기한 안).
             의뢰가 없어도 빈 칸을 보인다 (추천받을 수 있는 곳이라).
             segan/me.js 가 업체 칸을 읽은 뒤 SeganFactoryRequests.load(sb, session, partnerMe) 를 부른다.
             다담 공장 구성원이면 이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /factory/production-requests             { ready, can_act, items[] } — 우리에게 온 의뢰(고른 줄만)
               POST /factory/production-requests/:id/accept  받기 → { request_id, customer_id, project_id, draft_id }
                                                             (받은 의뢰에 다시 누르면 빠진 설계 사본만 다시 만든다)
               POST /factory/production-requests/:id/decline { reason? } 못 받음
   화면      답할 의뢰(답 기다림 · 기한 안)가 먼저 — 답 기한 · 남은 시간, 받기 · 못 받음.
             못 받음은 그 자리에서 사유 칸이 열린다 (적지 않아도 된다). 사유는 다담 본사만 본다 — 의뢰한 업체에는 가지 않는다
               (워커 production-requests/manager.js 는 사유를 싣지 않는다).
             지난 의뢰 — 받음(프로젝트 보기) · 못 받음 · 답 없음 · 거둠(의뢰한 업체가 거뒀다). 의뢰 내용(메모 · 설계)은
               서버가 답 기다림 · 받은 의뢰만 준다.
   못 읽으면  처음(403 · 404 · 오류 · 끊김 · ready false — DB 0050 전) → 칸째 감춘다.
   알림      새 제작 의뢰 알림이 me.html#factory-requests 를 연다 (워커 push/messages.js FACTORY_REQUESTS_URL).
             앱이 열린 채 주소의 # 만 바뀌면 목록을 다시 읽고 내려간다.
   ============================================================ */
/* global window, document, fetch, location, setInterval */
(function () {
  'use strict';

  var POOL_PLANS = ['expert', 'agent']; // 추천받는 협력업체 등급 (companies.plan) — 워커 distribution/rules.js POOL_PLANS
  var MEMBER_ROLES = ['owner', 'manager', 'staff']; // 구성원 직책 (company.role — manager 는 실장)
  var HASH = '#factory-requests';
  var REASON_MAX = 500; // 워커 production-requests/common.js REASON_MAX
  var OFFER_TTL_HOURS = 24; // 워커 OFFER_TTL_HOURS
  var TICK_MS = 30000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // 우리 팩토리 쪽 답 (워커 common.js offerState) — open 은 우리가 답할 차례
  var STATE_LABEL = {
    open: '새 의뢰',
    accepted: '받음',
    declined: '못 받음',
    expired: '답 없음',
    cancelled: '거둠',
  };

  var TEXT = {
    lead:
      'Manager 업체가 다담 본사의 추천을 보고 고른 제작 의뢰입니다. 고른 때부터 ' +
      OFFER_TTL_HOURS +
      '시간 안에 받기 · 못 받음을 눌러 주세요. 받으면 그 업체를 고객으로 한 프로젝트와 플래너 설계 사본이 만들어집니다.',
    leadStaff: '받기 · 못 받음은 대표 · 실장이 합니다.',
    empty: '아직 온 제작 의뢰가 없습니다.',
    past: '지난 의뢰',
    late: '답할 시간이 지났습니다',
    lateRow: '답할 시간(' + OFFER_TTL_HOURS + '시간)이 지났습니다. 본사가 다시 추천합니다.',
    cancelledRow: '의뢰한 업체가 거둔 의뢰입니다.',
    acceptedRow: '받은 의뢰입니다. 프로젝트와 플래너 설계 사본이 만들어졌습니다.',
    copyMissing: '설계 사본이 아직 없습니다. 「설계 사본 다시 만들기」를 눌러 주세요.',
    reasonLabel: '못 받는 사유 (적지 않아도 됩니다)',
    reasonNote: '사유는 다담 본사만 봅니다. 의뢰한 업체에는 보이지 않습니다.',
    reasonLong: '사유는 ' + REASON_MAX + '자까지 적을 수 있습니다.',
    accepted: '받았습니다. 프로젝트와 플래너 설계 사본을 만들었습니다.',
    acceptedNoCopy:
      '받았습니다. 프로젝트를 만들었습니다. 설계 사본은 「설계 사본 다시 만들기」로 다시 만들 수 있습니다.',
    copied: '설계 사본을 만들었습니다.',
    declined: '못 받음으로 돌려보냈습니다. 본사가 다른 팩토리를 다시 추천합니다.',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var S = {
    sb: null,
    session: null,
    base: '', // workflow-api
    me: null, // GET /partner/me data
    data: null, // { act, items } — 못 읽으면 null
    decline: '', // 못 받음 사유 칸을 연 의뢰 id
    note: null, // { id, text, error } — 그 의뢰 안 한 줄 (id 가 없으면 칸 위)
    busy: false,
    timer: null,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  // ── 글자 ───────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function has(obj, k) {
    return typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 YYYY.MM.DD HH:MM (ISO UTC 로 온 시각) */
  function kstTime(iso) {
    var t = Date.parse(iso || '');
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

  /** 'YYYY-MM-DD' → 'YYYY.MM.DD' */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s));
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }

  /** 남은 시간 — 서버가 준 expires_at 까지 (segan/partner-consults.js 와 같은 글) */
  function leftText(expires, now) {
    var t = Date.parse(expires || '');
    if (isNaN(t)) return '';
    var ms = t - (now == null ? Date.now() : now);
    if (ms <= 0) return TEXT.late;
    var mins = Math.ceil(ms / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return '남은 시간 ' + (h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분');
  }

  function deadlineText(expires, now) {
    var at = kstTime(expires);
    return at ? '답 기한 ' + at + ' · ' + leftText(expires, now) : '';
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  function isHq(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }

  /** 제작 의뢰함을 보이나 — 다담 공장 구성원 · Expert · Agent 협력업체 구성원 */
  function canSee(me) {
    if (isHq(me)) return true;
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    var c = me.company;
    return !!(
      c &&
      typeof c === 'object' &&
      POOL_PLANS.indexOf(c.plan) >= 0 &&
      MEMBER_ROLES.indexOf(c.role) >= 0
    );
  }

  /** GET /factory/production-requests 본문 → { act, items } | null */
  function listOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || d.ready !== true || !Array.isArray(d.items)) return null;
    return {
      act: d.can_act === true,
      items: d.items.filter(function (x) {
        return x && typeof x === 'object' && UUID_RE.test(String(x.id || ''));
      }),
    };
  }

  /** 지금 답할 수 있는 의뢰 — 답 기다림이고 기한 안 (서버 can_act 가 대표 · 실장까지 본다) */
  function isOpen(x, now) {
    if (!x || x.state !== 'open') return false;
    var t = Date.parse(x.expires_at || '');
    return !isFinite(t) || t > (now == null ? Date.now() : now);
  }

  /** 답할 의뢰(기한이 이른 차례) · 지난 의뢰(서버 차례 — 고른 때 최신순) */
  function splitItems(items, now) {
    var open = [];
    var past = [];
    (items || []).forEach(function (x) {
      (isOpen(x, now) ? open : past).push(x);
    });
    open.sort(function (a, b) {
      return (Date.parse(a.expires_at) || 0) - (Date.parse(b.expires_at) || 0);
    });
    return { open: open, past: past };
  }

  /** 못 받음 사유 → 보낼 본문 | { error } (빈 칸이면 사유 없이) */
  function declineBodyOf(text) {
    var s = String(text == null ? '' : text).trim();
    if ([...s].length > REASON_MAX) return { error: TEXT.reasonLong };
    return { body: s ? { reason: s } : {} };
  }

  // ── 그리기 ─────────────────────────────────────────────
  function fact(name, html) {
    return '<div><dt>' + esc(name) + '</dt><dd>' + html + '</dd></div>';
  }

  function noteHtml(n) {
    if (!n || !n.text) return '';
    return n.error
      ? '<p class="mk-error" role="alert">' + esc(n.text) + '</p>'
      : '<p class="me-pt-msg" role="status">' + esc(n.text) + '</p>';
  }

  function btn(act, label, solid, id) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '" data-id="' +
      esc(id) +
      '"' +
      (S.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function factsHtml(x) {
    var f = [];
    var m = x.manager && typeof x.manager === 'object' ? x.manager : {};
    if (m.name)
      f.push(fact('의뢰 업체', esc([m.name, m.region || ''].filter(Boolean).join(' · '))));
    if (x.region) f.push(fact('현장 지역', esc(x.region)));
    if (day(x.wanted_done_date))
      f.push(fact('희망 시기', esc(day(x.wanted_done_date)) + ' 시공 완료'));
    var d = x.design && typeof x.design === 'object' ? x.design : null;
    if (d) {
      var size = [];
      if (Number(d.walls) > 0) size.push('벽 ' + Number(d.walls));
      if (Number(d.modules) > 0) size.push('모듈 ' + Number(d.modules));
      f.push(fact('설계', esc([d.name || '플래너 설계'].concat(size).join(' · '))));
    }
    if (typeof x.note === 'string' && x.note)
      f.push('<div class="me-cs-desc"><dt>요청 메모</dt><dd>' + esc(x.note) + '</dd></div>');
    if (kstTime(x.chosen_at)) f.push(fact('고른 때', esc(kstTime(x.chosen_at))));
    if (kstTime(x.responded_at)) f.push(fact('답한 때', esc(kstTime(x.responded_at))));
    return f.length ? '<dl class="me-facts">' + f.join('') + '</dl>' : '';
  }

  function actsHtml(x) {
    if (S.decline === x.id) {
      return (
        '<div class="me-cs-decline" data-form="decline" data-id="' +
        esc(x.id) +
        '"><label class="mk-input"><span>' +
        esc(TEXT.reasonLabel) +
        '</span><textarea name="reason" rows="3" maxlength="' +
        REASON_MAX +
        '" placeholder="예: 이번 달 일정이 꽉 찼습니다."></textarea></label>' +
        '<p class="mk-note" data-reason-note>' +
        esc(TEXT.reasonNote) +
        '</p>' +
        '<p class="mk-error" data-err role="alert" hidden></p>' +
        '<div class="rd-acts">' +
        btn('decline-send', '못 받음 보내기', true, x.id) +
        btn('decline-cancel', '그만두기', false, x.id) +
        '</div></div>'
      );
    }
    return (
      '<div class="rd-acts">' +
      btn('accept', '받기', true, x.id) +
      btn('decline-open', '못 받음', false, x.id) +
      '</div>'
    );
  }

  /** 받은 의뢰 — 프로젝트 보기, 설계 사본이 빠졌으면 다시 만들기 (대표 · 실장) */
  function acceptedHtml(x) {
    var copyMissing = !!x.design && !x.draft_id;
    return (
      '<p class="me-pt-msg">' +
      esc(copyMissing ? TEXT.copyMissing : TEXT.acceptedRow) +
      '</p>' +
      '<div class="rd-acts">' +
      (x.project_id ? '<a class="mk-btn" href="#partner-projects">프로젝트 보기</a>' : '') +
      (copyMissing && S.data && S.data.act
        ? btn('copy', '설계 사본 다시 만들기', false, x.id)
        : '') +
      '</div>'
    );
  }

  function rowHtml(x, now) {
    var open = isOpen(x, now);
    var late = x.state === 'open' && !open;
    var m = x.manager && typeof x.manager === 'object' ? x.manager : {};
    var title = [m.name || 'Manager 업체', x.item_label || ''].filter(Boolean).join(' · ');
    var sub = [x.region || '', kstTime(x.chosen_at) ? '고름 ' + kstTime(x.chosen_at) : '']
      .filter(Boolean)
      .join(' · ');
    var badge = late ? '시간 지남' : has(STATE_LABEL, x.state) ? STATE_LABEL[x.state] : '';
    var off = !open && x.state !== 'accepted';
    var extra = '';
    if (late) extra = '<p class="me-pt-msg">' + esc(TEXT.lateRow) + '</p>';
    else if (x.state === 'cancelled')
      extra = '<p class="me-pt-msg">' + esc(TEXT.cancelledRow) + '</p>';
    else if (x.state === 'accepted') extra = acceptedHtml(x);
    return (
      '<li class="me-cs-item' +
      (off ? ' me-cs-item--off' : '') +
      '" data-offer="' +
      esc(x.id) +
      '"><div class="me-pt-line"><span class="me-c-main"><b>' +
      esc(title) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span>' +
      (badge ? '<span class="me-badge">' + esc(badge) + '</span>' : '') +
      '</div>' +
      (open
        ? '<p class="me-cs-left" data-expires="' +
          esc(x.expires_at) +
          '">' +
          esc(deadlineText(x.expires_at, now)) +
          '</p>'
        : '') +
      factsHtml(x) +
      extra +
      (S.note && S.note.id === x.id ? noteHtml(S.note) : '') +
      (open && x.can_act === true && S.data.act ? actsHtml(x) : '') +
      '</li>'
    );
  }

  function render() {
    var box = $('factory-requests');
    if (!box) return;
    var d = S.data;
    if (!d) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var now = Date.now();
    var parts = splitItems(d.items, now);
    var matched =
      S.note &&
      d.items.some(function (x) {
        return x.id === S.note.id;
      });
    var list = function (items) {
      return (
        '<ul class="me-cs-list">' +
        items
          .map(function (x) {
            return rowHtml(x, now);
          })
          .join('') +
        '</ul>'
      );
    };
    box.innerHTML =
      '<h3 class="me-pt-sub" id="factoryRequestsTitle">제작 의뢰함</h3>' +
      '<p class="mk-note">' +
      esc(TEXT.lead + (d.act ? '' : ' ' + TEXT.leadStaff)) +
      '</p>' +
      (S.note && !matched ? noteHtml(S.note) : '') +
      (d.items.length
        ? (parts.open.length ? list(parts.open) : '') +
          (parts.past.length
            ? '<p class="me-pt-title me-prq-past">' + esc(TEXT.past) + '</p>' + list(parts.past)
            : '')
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>');
    box.hidden = false;
    showSection();
    startTick();
  }

  /** 다담 공장 구성원은 업체 칸에 협력업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다 */
  function showSection() {
    if (!isHq(S.me)) return;
    var section = $('partner');
    var box = $('factory-requests');
    if (section && box && !box.hidden) section.hidden = false;
  }

  // ── 서버 ───────────────────────────────────────────────
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

  /** → { ok, status, body } (끊기면 status 0) */
  async function call(method, path, body) {
    if (!S.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(S.base + path, {
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

  function messageOf(r) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : TEXT.generic;
  }

  async function fetchList() {
    var r = await call('GET', '/factory/production-requests');
    return r.ok ? listOf(r.body) : null;
  }

  /** 다시 읽기 — 못 읽으면 앞서 그린 목록을 둔다 */
  async function reload() {
    var list = await fetchList();
    if (list) S.data = list;
    render();
  }

  /** 받은 뒤 업체 › 프로젝트 칸도 새로 (segan/partner-projects.js — 새 프로젝트가 생겼다) */
  function refreshProjects() {
    var P = window.SeganPartnerProjects;
    if (P && P.load) P.load(S.sb, S.session, S.me);
  }

  async function accept(id, copyOnly) {
    S.busy = true;
    S.note = null;
    render();
    var r = await call(
      'POST',
      '/factory/production-requests/' + encodeURIComponent(id) + '/accept'
    );
    S.busy = false;
    if (r.ok) {
      var d = r.body.data && typeof r.body.data === 'object' ? r.body.data : {};
      var withCopy = typeof d.draft_id === 'string' && d.draft_id;
      S.note = {
        id: id,
        text: copyOnly
          ? withCopy
            ? TEXT.copied
            : TEXT.copyMissing
          : withCopy
            ? TEXT.accepted
            : TEXT.acceptedNoCopy,
        error: copyOnly && !withCopy,
      };
      S.decline = '';
      await reload();
      if (!copyOnly) refreshProjects();
      return;
    }
    S.note = { id: id, text: messageOf(r), error: true };
    await reload();
  }

  async function sendDecline(id) {
    var box = $('factory-requests');
    var form = box && box.querySelector('[data-form="decline"][data-id="' + id + '"]');
    if (!form) return;
    var ta = form.querySelector('textarea[name="reason"]');
    var got = declineBodyOf(ta ? ta.value : '');
    var err = form.querySelector('[data-err]');
    if (got.error) {
      if (err) {
        err.textContent = got.error;
        err.hidden = false;
      }
      if (ta && ta.focus) ta.focus();
      return;
    }
    S.busy = true;
    form.querySelectorAll('button, textarea').forEach(function (el) {
      el.disabled = true;
    });
    var r = await call(
      'POST',
      '/factory/production-requests/' + encodeURIComponent(id) + '/decline',
      got.body
    );
    S.busy = false;
    if (r.ok) {
      S.decline = '';
      S.note = { id: id, text: TEXT.declined };
      await reload();
      return;
    }
    // 그사이 거둠 · 시간 지남(409) — 목록을 다시 읽고 그 줄에 서버 글을, 그 밖은 사유 칸을 그대로 두고 글만
    if (r.status === 409) {
      S.decline = '';
      S.note = { id: id, text: messageOf(r), error: true };
      await reload();
      return;
    }
    form.querySelectorAll('button, textarea').forEach(function (el) {
      el.disabled = false;
    });
    if (err) {
      err.textContent = messageOf(r);
      err.hidden = false;
    }
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || S.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id') || '';
    if (!UUID_RE.test(id)) return;
    if (act === 'accept') return accept(id, false);
    if (act === 'copy') return accept(id, true);
    if (act === 'decline-open') {
      S.decline = id;
      S.note = null;
      render();
      var ta = $('factory-requests').querySelector('[data-form="decline"] textarea');
      if (ta && ta.focus) ta.focus();
      return;
    }
    if (act === 'decline-cancel') {
      S.decline = '';
      render();
      return;
    }
    if (act === 'decline-send') return sendDecline(id);
  }

  // ── 남은 시간 ─────────────────────────────────────────────
  function tick() {
    var now = Date.now();
    var root = $('factory-requests');
    if (!root) return;
    var expired = false;
    root.querySelectorAll('[data-expires]').forEach(function (el) {
      var exp = el.getAttribute('data-expires');
      if (Date.parse(exp) <= now) expired = true;
      var t = deadlineText(exp, now);
      if (t && el.textContent !== t) el.textContent = t;
    });
    // 기한이 지난 줄은 단추를 거두고 지난 의뢰로 (사유를 적는 중이면 그대로 둔다 — 보내면 서버가 409 로 알린다)
    if (expired && !S.decline && !S.busy) render();
  }

  function startTick() {
    var root = $('factory-requests');
    if (S.timer || !root || !root.querySelector('[data-expires]')) return;
    S.timer = setInterval(tick, TICK_MS);
  }

  function scrollIfAsked() {
    var box = $('factory-requests');
    if (!box || box.hidden || location.hash !== HASH) return;
    if (box.scrollIntoView) box.scrollIntoView({ block: 'start' });
  }

  /** 앱이 열린 채 알림을 눌러 주소의 # 만 바뀌었다 — 새 의뢰를 다시 읽고 내려간다 */
  async function onHash() {
    if (location.hash !== HASH || !S.base || !canSee(S.me) || S.busy || !S.data) return;
    await reload();
    scrollIfAsked();
  }

  /** 제작 의뢰함 채우기 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var box = $('factory-requests');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    var cfg = window.DADAM_CONFIG || {};
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.sb = sb;
    S.session = session;
    S.me = me;
    S.data = null;
    S.decline = '';
    S.note = null;
    S.busy = false;
    if (!S.base || !session || !canSee(me)) return;
    try {
      var list = await fetchList();
      if (!list) return; // 403 · 404 · 오류 · ready false — 칸째 감춘다
      S.data = list;
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
        window.addEventListener('hashchange', onHash);
      }
      render(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
      scrollIfAsked();
    } catch {
      S.data = null;
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganFactoryRequests = {
    POOL_PLANS: POOL_PLANS,
    HASH: HASH,
    REASON_MAX: REASON_MAX,
    OFFER_TTL_HOURS: OFFER_TTL_HOURS,
    STATE_LABEL: STATE_LABEL,
    TEXT: TEXT,
    state: S,
    canSee: canSee,
    listOf: listOf,
    isOpen: isOpen,
    splitItems: splitItems,
    declineBodyOf: declineBodyOf,
    leftText: leftText,
    deadlineText: deadlineText,
    load: load,
  };
})();
