/* ============================================================
   segan/company-workers.js — 「인사 › 작업자」 팩토리의 작업자 연결 · 초대 (segan/me.html #companyWorkers)

   팩토리(다담 공장 · Agent)가 자기 작업자를 초대 링크로 모으고, 연결을 승인 · 정지 · 끊는다.
   (2026-11-13 사장님 결정 「작업자 한 길」 — 팩토리마다 자기 작업자, 작업자 계정은 하나 + 팩토리마다 연결.
    초대로 와도 대기 → 초대한 팩토리가 승인해야 연결. 배정은 설치 · A/S 일정 줄에서 — segan/site-map.js)

   누가 보나  다담 공장 구성원 · 협력업체 Agent 구성원 (서버 work/company.js workersCompanyOf 와 같다 — 구성원이면 읽는다).
             바꾸기(승인 · 반려 · 정지 · 연결 끊기 · 초대)는 서버 답(can_manage = 대표 · 실장)을 따르고,
             새 초대 · 승인은 can_invite(인사를 쓰는 팩토리)일 때만 보인다.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganCompanyWorkers.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET   /company/workers                     { company{ name }, can_manage, can_invite,
                                                            workers[{ link_id, name, kinds[], region, status, account_status,
                                                                      via, since, decided_at, reason, active, phone? }],
                                                            invites[{ id, kinds_preset[], display_name_preset, expires_at, created_at }],
                                                            unconfirmed{ total, items[{ kind, at, where }] } }
                                                          unconfirmed = 확인을 기다리는 완료 보고 (where: install · as · project)
               POST  /company/workers/invites             { kinds_preset[], display_name_preset?, expires_at } → { id, url, expires_at }
                                                          링크는 이 답에서만 보인다 (서버에는 해시만). 한 번만 쓸 수 있다.
               POST  /company/workers/invites/:id/revoke  초대 취소
               PATCH /company/workers/:linkId             { status, reason? } — 대기 → 승인 · 반려, 승인 ↔ 정지, 승인 · 정지 → 연결 끝
   화면      「작업자」 — 승인 대기 · 연결됨 · 정지 표 (줄마다 「승인」 「반려」 「정지」 「다시 승인」 「연결 끊기」), 반려 · 끝난 연결은 접어 둔다.
             「초대」 — 종류(여럿) · 이름(선택) · 만료(3일 · 7일 · 30일 가운데 고른다 — 미리 고른 값 없음) → 「초대 링크 만들기」
                       → 링크 상자 + 「링크 복사」. 남은 초대 줄마다 「초대 취소」.
             맨 위 — 확인 안 한 완료 보고가 있으면 건수와 어디서 확인하는지(설치 일정 · A/S · 프로젝트의 「작업 배정」) 한 칸.
                       「확인」을 눌러야 작업이 끝나고, 그때부터 7일 뒤 작업자에게 연 현장 정보가 닫힌다.
   확인      반려 · 정지 · 연결 끊기 · 초대 취소는 창을 띄우지 않는다 — 표 아래에 물음 한 줄과 단추 둘을 그린다.
   못 읽으면  칸째 감춘다 (DB 0064 적용 전 409 db_pending 포함) — 그때 메뉴는 「준비 중」 안내로 남는다 (segan/me.js).
   정보      작업자 이름 · 전화 · 사유는 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다. 전화는 서버가 대표 · 실장에게만 준다.
             초대 링크도 화면에만 둔다 (다시 읽으면 사라진다).
   ============================================================ */
/* global window, document, fetch, navigator */
(function () {
  'use strict';

  var PLANS = ['agent']; // segan/me.js PEOPLE_PLANS 와 같다
  var KST_MS = 9 * 3600 * 1000;
  var DAY_MS = 86400000;
  var WEEK = '일월화수목금토';
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var NAME_MAX = 30; // 서버 display_name_preset
  var REASON_MAX = 200; // 서버 reason

  // 작업자 종류 — 서버 work/validate.js KIND_LABEL 과 같다
  var KINDS = ['demolition', 'cutting', 'edge', 'assembly', 'install', 'as']; // 일하는 차례
  var KIND = { install: '설치', as: 'A/S', assembly: '조립', cutting: '재단', edge: '엣지', demolition: '철거' };
  var STATUS = {
    pending: '승인 대기',
    approved: '연결됨',
    suspended: '정지',
    rejected: '반려',
    ended: '연결 끝',
  };
  var VIA = { invite: '초대 링크', public: '공개 신청', migrated: '기존 작업자' };
  var DAYS = [3, 7, 30]; // 초대 만료 — 고르는 값 (미리 고르지 않는다)
  // 확인을 기다리는 완료 보고를 어디서 확인하나 — 서버 unconfirmed.items[].where → [이름, 그 화면]
  var WAIT_WHERE = {
    install: ['설치 일정', '#p-install'],
    as: ['A/S', '#p-as'],
    project: ['프로젝트의 「작업 배정」', '#dash-project'],
  };
  var WAIT_ORDER = ['install', 'as', 'project'];

  var TEXT = {
    title: '작업자 연결 · 초대',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    note: '초대 링크로 작업자(철거 · 재단 · 엣지 · 조립 · 설치 · A/S)를 모으고, 신청이 오면 승인합니다. 배정은 프로젝트의 「작업 배정」에서 합니다.',
    noteRead: '우리 팩토리와 연결된 작업자입니다. 초대 · 승인은 대표 · 실장이 합니다.',
    noteNoInvite:
      '지금 등급에서는 새 초대 · 승인을 할 수 없습니다. 정지 · 연결 끊기는 할 수 있습니다.',
    tabWorkers: '작업자',
    tabInvite: '초대',
    pending: '승인 대기',
    approved: '연결됨',
    suspended: '정지',
    closed: '반려 · 끝난 연결',
    none: '아직 연결된 작업자가 없습니다.',
    noneManage: '아직 연결된 작업자가 없습니다. 「초대」에서 링크를 만들어 보내 주세요.',
    noName: '이름 없음',
    approve: '승인',
    reapprove: '다시 승인',
    reject: '반려',
    suspend: '정지',
    end: '연결 끊기',
    approvedMsg: '승인했습니다. 프로젝트의 「작업 배정」에서 배정할 수 있습니다.',
    rejectedMsg: '반려했습니다.',
    suspendedMsg: '정지했습니다. 새 배정을 받지 않습니다.',
    endedMsg: '연결을 끊었습니다.',
    rejectAsk: '이 작업자의 연결 신청을 반려할까요?',
    suspendAsk: '이 작업자를 정지할까요? 새 배정을 받지 않습니다. 진행 중인 배정은 그대로 갑니다.',
    endAsk:
      '이 작업자와 연결을 끊을까요? 진행 중인 배정은 끝까지 가고 새 배정만 막습니다. 다시 연결하려면 새 초대 링크가 필요합니다.',
    reason: '사유 (선택 — 우리 팩토리에서만 봅니다)',
    cancel: '취소',
    accountSuspended: '본사 정지',
    activeUnit: '건',
    inviteHelp:
      '링크를 받은 사람이 로그인해 신청하면 「승인 대기」에 나타납니다. 링크는 한 번만 쓸 수 있습니다.',
    kinds: '맡길 작업 종류 (여럿 고를 수 있습니다 · 안 골라도 됩니다)',
    name: '이름 (선택 — 신청서에 미리 적힙니다)',
    days: '링크 만료',
    daysUnit: '일',
    pickDays: '링크 만료를 골라 주세요.',
    make: '초대 링크 만들기',
    made: '초대 링크',
    madeNote: '까지 쓸 수 있습니다. 링크는 지금만 보이니 복사해서 카카오톡 · 문자로 보내 주세요.',
    madeMsg: '초대 링크를 만들었습니다.',
    copy: '링크 복사',
    copied: '복사했습니다. 메시지로 보내 주세요.',
    copyFail: '복사하지 못했습니다. 링크를 길게 눌러 복사해 주세요.',
    invites: '남은 초대',
    noInvites: '남은 초대가 없습니다.',
    revoke: '초대 취소',
    revokeAsk: '이 초대를 취소할까요? 보낸 링크를 더 이상 쓸 수 없습니다.',
    revokeYes: '초대 취소하기',
    revokedMsg: '초대를 취소했습니다.',
    workerScreen: '작업자는 앱 「작업」 화면에서 초대를 받고 수락 · 보고합니다. 작업자로 등록하지 않은 계정으로 열면 신청서가 보입니다.',
    workerScreenLink: '작업자 화면 열기',
    waitHead: '확인 안 한 완료 보고',
    waitUnit: '건',
    waitNote:
      '「확인」을 눌러야 작업이 끝나고, 그때부터 7일 뒤 작업자에게 연 현장 주소 · 연락처가 닫힙니다.',
    waitNoteRead: '확인은 대표 · 실장이 합니다.',
    waitGo: '에서 확인',
    waitMore: '외',
    anyKind: '정하지 않음',
    anyName: '정하지 않음',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    canManage: false,
    canInvite: false,
    company: '',
    workers: [],
    invites: [],
    wait: { total: 0, items: [] }, // 확인을 기다리는 완료 보고 (서버 unconfirmed)
    tab: 'workers', // workers | invite
    form: { kinds: [], name: '', days: 0 },
    made: null, // 방금 만든 초대 { id, url, expires_at } — 화면에만
    ask: null, // 확인을 기다리는 일 { kind: 'reject' | 'suspend' | 'end' | 'revoke', id }
    msg: '',
    err: '',
    copy: '',
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
  function str(v) {
    return typeof v === 'string' ? v : '';
  }
  function arr(v) {
    return Array.isArray(v) ? v : [];
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  function canSee(me) {
    var m = obj(me);
    if (m.platform_member === true) return false;
    if (m.hq_member === true) return true;
    return PLANS.indexOf(obj(m.company).plan) >= 0;
  }

  // ── 글자 꼴 ─────────────────────────────────────────
  /** 때 → 한국 날짜 '11/20(금)' (없으면 '-') */
  function dayKst(iso) {
    var t = Date.parse(str(iso));
    if (isNaN(t)) return '-';
    var d = new Date(t + KST_MS);
    return d.getUTCMonth() + 1 + '/' + d.getUTCDate() + '(' + WEEK[d.getUTCDay()] + ')';
  }
  function kindsText(list, none) {
    var names = arr(list)
      .filter(function (k) {
        return own(KIND, k);
      })
      .map(function (k) {
        return KIND[k];
      });
    return names.length ? names.join(' · ') : none || '-';
  }
  /** 지금부터 days 일 뒤 (ISO) */
  function expiresIn(days, nowMs) {
    return new Date((nowMs == null ? Date.now() : nowMs) + days * DAY_MS).toISOString();
  }

  /** 서버 줄 → 화면 줄 (모르는 상태 · id 없는 줄은 버린다) */
  function workerOf(v) {
    v = obj(v);
    var id = str(v.link_id);
    if (!ID_RE.test(id) || !own(STATUS, v.status)) return null;
    return {
      id: id,
      name: str(v.name),
      kinds: arr(v.kinds).filter(function (k) {
        return own(KIND, k);
      }),
      region: str(v.region),
      status: v.status,
      accountStatus: str(v.account_status),
      via: own(VIA, v.via) ? v.via : '',
      since: str(v.since),
      decidedAt: str(v.decided_at),
      reason: str(v.reason),
      active: Number(v.active) > 0 ? Math.floor(Number(v.active)) : 0,
      phone: str(v.phone),
    };
  }
  function inviteOf(v) {
    v = obj(v);
    var id = str(v.id);
    if (!ID_RE.test(id)) return null;
    return {
      id: id,
      kinds: arr(v.kinds_preset),
      name: str(v.display_name_preset),
      expiresAt: str(v.expires_at),
      createdAt: str(v.created_at),
    };
  }

  // ── 서버 ────────────────────────────────────────────
  /** 서버 unconfirmed → { total, items[{ kind, at, where }] } (모르는 종류 · 자리는 뺀다, 모양이 틀리면 0건) */
  function waitOf(v) {
    var o = obj(v);
    var items = arr(o.items)
      .map(function (x) {
        var i = obj(x);
        if (!own(KIND, i.kind) || !own(WAIT_WHERE, i.where)) return null;
        return { kind: i.kind, at: str(i.at), where: i.where };
      })
      .filter(Boolean);
    var total = typeof o.total === 'number' && o.total >= 0 && Math.floor(o.total) === o.total ? o.total : 0;
    return { total: Math.max(total, items.length), items: items };
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

  /** 목록을 읽는다 — 읽었으면 true */
  async function read() {
    var r = await call('GET', '/company/workers');
    var d = r.ok ? obj(r.body.data) : null;
    if (!d || !Array.isArray(d.workers)) return false;
    J.canManage = d.can_manage === true;
    J.canInvite = J.canManage && d.can_invite === true;
    J.company = str(obj(d.company).name);
    J.workers = d.workers.map(workerOf).filter(Boolean);
    J.invites = J.canManage ? arr(d.invites).map(inviteOf).filter(Boolean) : [];
    J.wait = waitOf(d.unconfirmed);
    return true;
  }

  // ── 그리기 ──────────────────────────────────────────
  function box() {
    return $('companyWorkers');
  }
  function dis() {
    return J.busy ? ' disabled' : '';
  }
  function nameOf(w) {
    return w.name || TEXT.noName;
  }
  function asking(kind, id) {
    return !!J.ask && J.ask.kind === kind && J.ask.id === id;
  }
  function actBtn(act, id, label) {
    return (
      '<button type="button" class="od-open" data-act="' +
      act +
      '" data-id="' +
      esc(id) +
      '"' +
      dis() +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function tableHtml(heads, rows) {
    return (
      '<div class="od-tablewrap"><table class="od-table"><thead><tr>' +
      heads
        .map(function (h) {
          return (
            '<th scope="col"' +
            (h === '' ? ' class="pw-act"' : '') +
            '>' +
            (h === '' ? '<span class="pw-sr">하기</span>' : esc(h)) +
            '</th>'
          );
        })
        .join('') +
      '</tr></thead><tbody>' +
      rows.join('') +
      '</tbody></table></div>'
    );
  }
  /** 확인 한 줄 — 창을 띄우지 않고 표 아래에 그린다. withReason 이면 사유 칸 */
  function askHtml(name, question, yes, withReason) {
    return (
      '<div class="pw-ask" role="group" aria-label="확인" data-cw="ask"><p>' +
      (name ? '<b>' + esc(name) + '</b> — ' : '') +
      esc(question) +
      '</p>' +
      (withReason
        ? '<label class="mk-input ps-field cw-reason" for="companyWorkers-reason"><span>' +
          esc(TEXT.reason) +
          '</span><input id="companyWorkers-reason" data-cw="reason" type="text" maxlength="' +
          REASON_MAX +
          '" autocomplete="off"' +
          dis() +
          '></label>'
        : '') +
      '<div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="yes"' +
      dis() +
      '>' +
      esc(yes) +
      '</button><button type="button" class="mk-btn" data-act="no"' +
      dis() +
      '>' +
      esc(TEXT.cancel) +
      '</button></div></div>'
    );
  }

  /** 한 상태의 표 — status: pending | approved | suspended */
  function groupHtml(status) {
    var list = J.workers.filter(function (w) {
      return w.status === status;
    });
    if (!list.length) return '';
    var manage = J.canManage;
    var askName = '';
    var askKind = '';
    var rows = list.map(function (w) {
      var on = !!J.ask && J.ask.id === w.id && J.ask.kind !== 'revoke';
      if (on) {
        askName = nameOf(w);
        askKind = J.ask.kind;
      }
      var acts = '';
      if (manage) {
        if (status === 'pending')
          acts =
            (J.canInvite ? actBtn('approve', w.id, TEXT.approve) : '') +
            actBtn('reject', w.id, TEXT.reject);
        else if (status === 'approved')
          acts = actBtn('suspend', w.id, TEXT.suspend) + actBtn('end', w.id, TEXT.end);
        else
          acts =
            (J.canInvite ? actBtn('approve', w.id, TEXT.reapprove) : '') +
            actBtn('end', w.id, TEXT.end);
      }
      var last =
        status === 'pending'
          ? dayKst(w.since) + (w.via ? ' · ' + VIA[w.via] : '')
          : status === 'approved'
            ? w.active
              ? w.active + TEXT.activeUnit
              : '-'
            : w.reason || '-';
      return (
        '<tr' +
        (on ? ' class="od-row--on"' : '') +
        '><td>' +
        esc(nameOf(w)) +
        (w.accountStatus === 'suspended'
          ? ' <span class="pw-muted">(' + esc(TEXT.accountSuspended) + ')</span>'
          : '') +
        '</td><td>' +
        esc(kindsText(w.kinds)) +
        '</td><td' +
        (w.region ? '' : ' class="pw-muted"') +
        '>' +
        esc(w.region || '-') +
        '</td>' +
        (manage ? '<td>' + esc(w.phone || '-') + '</td>' : '') +
        '<td>' +
        esc(last) +
        '</td>' +
        (manage ? '<td class="pw-act">' + acts + '</td>' : '') +
        '</tr>'
      );
    });
    var heads = ['작업자', '종류', '지역'];
    if (manage) heads.push('전화');
    heads.push(status === 'pending' ? '신청' : status === 'approved' ? '진행 중 배정' : '사유');
    if (manage) heads.push('');
    var ask = '';
    if (askKind === 'reject') ask = askHtml(askName, TEXT.rejectAsk, TEXT.reject, true);
    else if (askKind === 'suspend') ask = askHtml(askName, TEXT.suspendAsk, TEXT.suspend, true);
    else if (askKind === 'end') ask = askHtml(askName, TEXT.endAsk, TEXT.end, false);
    return (
      '<div class="od-sec pw-sec" data-cw-group="' +
      status +
      '"><h4 class="od-h">' +
      esc(TEXT[status]) +
      ' <span class="pw-muted">' +
      list.length +
      '</span></h4>' +
      tableHtml(heads, rows) +
      ask +
      '</div>'
    );
  }
  /** 반려 · 끝난 연결 — 접어 둔다 (보기만) */
  function closedHtml() {
    var list = J.workers.filter(function (w) {
      return w.status === 'rejected' || w.status === 'ended';
    });
    if (!list.length) return '';
    var rows = list.map(function (w) {
      return (
        '<tr><td>' +
        esc(nameOf(w)) +
        '</td><td>' +
        esc(kindsText(w.kinds)) +
        '</td><td>' +
        esc(STATUS[w.status]) +
        '</td><td>' +
        esc(dayKst(w.decidedAt || w.since)) +
        '</td></tr>'
      );
    });
    return (
      '<details class="pw-more" data-cw-group="closed"><summary>' +
      esc(TEXT.closed) +
      ' ' +
      list.length +
      '</summary>' +
      tableHtml(['작업자', '종류', '상태', '날짜'], rows) +
      '</details>'
    );
  }
  function workersHtml() {
    var html = groupHtml('pending') + groupHtml('approved') + groupHtml('suspended') + closedHtml();
    return html || '<p class="me-empty">' + esc(J.canInvite ? TEXT.noneManage : TEXT.none) + '</p>';
  }

  function choiceBtn(act, attr, value, label, on) {
    return (
      '<button type="button" class="mk-btn' +
      (on ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '" ' +
      attr +
      '="' +
      esc(value) +
      '" aria-pressed="' +
      on +
      '"' +
      dis() +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function madeHtml() {
    if (!J.made) return '';
    return (
      '<div class="me-pt-box me-pt-made" data-cw="made"><p class="me-pt-title">' +
      esc(TEXT.made) +
      '</p><input class="me-pt-url" id="companyWorkersLink" type="text" readonly aria-label="' +
      esc(TEXT.made) +
      '" value="' +
      esc(J.made.url) +
      '" /><p class="mk-note">' +
      esc(dayKst(J.made.expires_at) + TEXT.madeNote) +
      '</p><div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="copy">' +
      esc(TEXT.copy) +
      '</button></div><p class="me-pt-msg" data-cw="copy" role="status">' +
      esc(J.copy) +
      '</p></div>'
    );
  }
  function invitesHtml() {
    var askName = '';
    var rows = J.invites.map(function (v) {
      var on = asking('revoke', v.id);
      if (on) askName = v.name;
      return (
        '<tr' +
        (on ? ' class="od-row--on"' : '') +
        '><td' +
        (v.name ? '' : ' class="pw-muted"') +
        '>' +
        esc(v.name || TEXT.anyName) +
        '</td><td>' +
        esc(kindsText(v.kinds, TEXT.anyKind)) +
        '</td><td>' +
        esc(dayKst(v.createdAt)) +
        '</td><td>' +
        esc(dayKst(v.expiresAt)) +
        '</td><td class="pw-act">' +
        actBtn('revoke', v.id, TEXT.revoke) +
        '</td></tr>'
      );
    });
    return (
      '<div class="od-sec pw-sec" data-cw-group="invites"><h4 class="od-h">' +
      esc(TEXT.invites) +
      '</h4>' +
      (rows.length
        ? tableHtml(['이름', '종류', '만든 날', '만료', ''], rows)
        : '<p class="me-empty">' + esc(TEXT.noInvites) + '</p>') +
      (J.ask && J.ask.kind === 'revoke'
        ? askHtml(askName, TEXT.revokeAsk, TEXT.revokeYes, false)
        : '') +
      '</div>'
    );
  }
  function inviteHtml() {
    var f = J.form;
    var form = J.canInvite
      ? '<div class="me-pt-form cw-form" data-cw="form"><p class="mk-note">' +
        esc(TEXT.inviteHelp) +
        '</p><div role="group" aria-label="' +
        esc(TEXT.kinds) +
        '"><p class="cw-label">' +
        esc(TEXT.kinds) +
        '</p><div class="cs-choices">' +
        KINDS.map(function (k) {
          return choiceBtn('kind', 'data-kind', k, KIND[k], f.kinds.indexOf(k) >= 0);
        }).join('') +
        '</div></div><label class="mk-input ps-field" for="companyWorkers-name"><span>' +
        esc(TEXT.name) +
        '</span><input id="companyWorkers-name" data-cw="name" type="text" maxlength="' +
        NAME_MAX +
        '" autocomplete="off" value="' +
        esc(f.name) +
        '"' +
        dis() +
        '></label><div role="group" aria-label="' +
        esc(TEXT.days) +
        '"><p class="cw-label">' +
        esc(TEXT.days) +
        '</p><div class="cs-choices">' +
        DAYS.map(function (d) {
          return choiceBtn('days', 'data-days', d, d + TEXT.daysUnit, f.days === d);
        }).join('') +
        '</div></div><div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="make"' +
        dis() +
        '>' +
        esc(TEXT.make) +
        '</button></div></div>'
      : '<p class="mk-note">' + esc(TEXT.noteNoInvite) + '</p>';
    return form + madeHtml() + invitesHtml();
  }
  /** 확인 안 한 완료 보고 — 건수 + 자리마다 한 줄 (그 화면으로 가는 링크 · 종류와 날짜). 없으면 '' */
  function waitHtml() {
    var w = J.wait;
    if (!w || !w.total) return '';
    var lines = WAIT_ORDER.map(function (where) {
      var list = w.items.filter(function (i) {
        return i.where === where;
      });
      if (!list.length) return '';
      var what = list
        .map(function (i) {
          var day = dayKst(i.at);
          return (day === '-' ? '' : day + ' ') + KIND[i.kind];
        })
        .join(' · ');
      return (
        '<li><a class="od-pc" href="' +
        WAIT_WHERE[where][1] +
        '">' +
        esc(WAIT_WHERE[where][0] + TEXT.waitGo) +
        ' →</a> <span>' +
        esc(what) +
        '</span></li>'
      );
    }).join('');
    var more = w.total - w.items.length;
    return (
      '<div class="cw-wait" data-cw="wait" role="status"><p class="cw-wait-head"><b>' +
      esc(TEXT.waitHead + ' ' + w.total + TEXT.waitUnit) +
      '</b></p>' +
      (lines ? '<ul>' + lines + '</ul>' : '') +
      (more > 0 ? '<p class="mk-note">' + esc(TEXT.waitMore + ' ' + more + TEXT.waitUnit) + '</p>' : '') +
      '<p class="mk-note">' +
      esc(TEXT.waitNote + (J.canManage ? '' : ' ' + TEXT.waitNoteRead)) +
      '</p></div>'
    );
  }

  function tabsHtml() {
    var pending = J.workers.filter(function (w) {
      return w.status === 'pending';
    }).length;
    return (
      '<div class="cs-choices cw-tabs" role="group" aria-label="보기">' +
      choiceBtn(
        'tab',
        'data-tab',
        'workers',
        TEXT.tabWorkers + (pending ? ' · ' + TEXT.pending + ' ' + pending : ''),
        J.tab === 'workers'
      ) +
      choiceBtn(
        'tab',
        'data-tab',
        'invite',
        TEXT.tabInvite + (J.invites.length ? ' ' + J.invites.length : ''),
        J.tab === 'invite'
      ) +
      '</div>'
    );
  }

  /** 다담 공장 구성원은 업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다 */
  function showSection() {
    var section = $('partner');
    var b = box();
    if (section && b && !b.hidden) section.hidden = false;
  }
  function render() {
    var b = box();
    if (!b || !J.ready) return;
    // 다시 그려도 적던 이름 · 사유 · 펼친 칸은 그대로
    var reasonEl = b.querySelector('[data-cw="reason"]');
    var reason = reasonEl ? reasonEl.value : '';
    var more = b.querySelector('details');
    var open = !!more && more.open;
    var invite = J.canManage && J.tab === 'invite';
    b.innerHTML =
      '<h3 class="me-pt-sub" id="companyWorkersTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(J.canManage ? TEXT.note : TEXT.noteRead) +
      '</p><p class="mk-note" data-cw="worker-screen">' +
      esc(TEXT.workerScreen) +
      ' <a class="od-pc" href="work.html">' +
      esc(TEXT.workerScreenLink) +
      ' →</a></p>' +
      waitHtml() +
      (J.canManage ? tabsHtml() : '') +
      '<p class="me-pt-msg" role="status" data-cw="msg">' +
      esc(J.msg) +
      '</p><p class="mk-error" role="alert" data-cw="err"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p>' +
      (invite ? inviteHtml() : workersHtml());
    b.hidden = false;
    b.toggleAttribute('aria-busy', J.busy);
    reasonEl = b.querySelector('[data-cw="reason"]');
    if (reasonEl && reason) reasonEl.value = reason;
    more = b.querySelector('details');
    if (more && open) more.open = true;
    showSection();
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

  // ── 누른 일 ─────────────────────────────────────────
  /** 서버에 한 가지를 하고 목록을 다시 읽는다 */
  async function run(fn, done) {
    if (J.busy) return;
    J.busy = true;
    J.msg = '';
    J.err = '';
    render();
    var r = await fn();
    if (r.ok) {
      J.ask = null;
      if (typeof done === 'function') done(r);
      else J.msg = done || '';
    } else J.err = errText(r);
    // 실패해도 다시 읽는다 — 그 사이 바뀐 줄(이미 승인 · 이미 취소)을 화면에 맞춘다
    await read();
    J.busy = false;
    render();
  }
  function setStatus(id, status, reason, msg) {
    var body = { status: status };
    if (reason) body.reason = reason;
    return run(function () {
      return call('PATCH', '/company/workers/' + encodeURIComponent(id), body);
    }, msg);
  }
  function makeInvite() {
    var f = J.form;
    if (DAYS.indexOf(f.days) < 0) {
      J.msg = '';
      J.err = TEXT.pickDays;
      render();
      focusOn('[data-act="days"]');
      return;
    }
    var name = f.name.trim();
    var body = { kinds_preset: f.kinds.slice(), expires_at: expiresIn(f.days) };
    if (name) body.display_name_preset = name;
    return run(
      function () {
        return call('POST', '/company/workers/invites', body);
      },
      function (r) {
        var d = obj(r.body.data);
        J.made = str(d.url)
          ? { id: str(d.id), url: d.url, expires_at: str(d.expires_at) || body.expires_at }
          : null;
        J.copy = '';
        J.form = { kinds: [], name: '', days: 0 };
        J.msg = TEXT.madeMsg;
      }
    );
  }
  async function copyLink() {
    var b = box();
    var out = b && b.querySelector('[data-cw="copy"]');
    var field = $('companyWorkersLink');
    var link = J.made ? J.made.url : '';
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(link);
      J.copy = TEXT.copied;
    } catch {
      if (field && field.select) field.select();
      J.copy = TEXT.copyFail;
    }
    if (out) out.textContent = J.copy;
  }
  function confirmed() {
    var a = J.ask;
    if (!a) return;
    var b = box();
    var reasonEl = b && b.querySelector('[data-cw="reason"]');
    var reason = reasonEl ? reasonEl.value.trim() : '';
    if (a.kind === 'reject') return setStatus(a.id, 'rejected', reason, TEXT.rejectedMsg);
    if (a.kind === 'suspend') return setStatus(a.id, 'suspended', reason, TEXT.suspendedMsg);
    if (a.kind === 'end') return setStatus(a.id, 'ended', '', TEXT.endedMsg);
    if (a.kind === 'revoke')
      return run(
        function () {
          return call('POST', '/company/workers/invites/' + encodeURIComponent(a.id) + '/revoke');
        },
        function () {
          // 방금 만든 초대를 취소했으면 링크 상자도 지운다 — 못 쓰는 링크를 보내지 않게
          if (J.made && J.made.id === a.id) J.made = null;
          J.msg = TEXT.revokedMsg;
        }
      );
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id') || '';
    if (act === 'copy') {
      copyLink();
      return;
    }
    if (!J.canManage) return;
    if (act === 'tab') {
      J.tab = el.getAttribute('data-tab') === 'invite' ? 'invite' : 'workers';
      J.ask = null;
      J.msg = '';
      J.err = '';
      render();
      focusOn('[data-act="tab"][aria-pressed="true"]');
    } else if (act === 'kind') {
      var k = el.getAttribute('data-kind');
      if (!own(KIND, k)) return;
      var at = J.form.kinds.indexOf(k);
      if (at >= 0) J.form.kinds.splice(at, 1);
      else J.form.kinds.push(k);
      render();
      focusOn('[data-act="kind"][data-kind="' + k + '"]');
    } else if (act === 'days') {
      var d = Number(el.getAttribute('data-days'));
      J.form.days = DAYS.indexOf(d) >= 0 ? d : 0;
      J.err = '';
      render();
      focusOn('[data-act="days"][data-days="' + d + '"]');
    } else if (act === 'make' && J.canInvite) makeInvite();
    else if (act === 'approve' && J.canInvite && ID_RE.test(id))
      setStatus(id, 'approved', '', TEXT.approvedMsg);
    else if (
      (act === 'reject' || act === 'suspend' || act === 'end' || act === 'revoke') &&
      ID_RE.test(id)
    ) {
      J.ask = { kind: act, id: id };
      J.msg = '';
      J.err = '';
      render();
      focusOn(
        '[data-cw="ask"] ' + (act === 'reject' || act === 'suspend' ? 'input' : '[data-act="yes"]')
      );
    } else if (act === 'yes') confirmed();
    else if (act === 'no') {
      J.ask = null;
      render();
    }
  }
  /** 적던 이름을 기억한다 — 다시 그려도 남게 */
  function onInput(e) {
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute('data-cw') === 'name') J.form.name = el.value;
  }
  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('input', onInput);
  }

  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.canManage = false;
    J.canInvite = false;
    J.company = '';
    J.workers = [];
    J.invites = [];
    J.tab = 'workers';
    J.form = { kinds: [], name: '', days: 0 };
    J.made = null;
    J.ask = null;
    J.msg = '';
    J.err = '';
    J.copy = '';
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await read())) return;
      bind();
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganCompanyWorkers = {
    KIND: KIND,
    STATUS: STATUS,
    VIA: VIA,
    DAYS: DAYS,
    TEXT: TEXT,
    canSee: canSee,
    dayKst: dayKst,
    kindsText: kindsText,
    expiresIn: expiresIn,
    workerOf: workerOf,
    inviteOf: inviteOf,
    waitOf: waitOf,
    state: J,
    load: load,
  };
})();
