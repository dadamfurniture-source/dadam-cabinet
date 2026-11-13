/* ============================================================
   segan/work-recruit.js — 「작업 배정」 줄의 모집 칸 (segan/project-work.js · segan/site-map.js 가 같이 쓴다)

   모집 게시 — 팩토리가 작업을 올리면 연결된 작업자들이 보고 신청하고, 팩토리가 그중에서 뽑는다.
   (2026-11-14 사장님 결정: 「작업 배정」 줄에 「모집 올리기」 — 프로젝트의 종류 줄 · 납품 · 설치 · A/S 일정 줄.
    지금까지는 팩토리가 작업자를 골라 제안하는 「지정」뿐이었다. 프로젝트나 일정에 붙지 않은 작업은 만들지 않는다)

   이 파일은 글 · 모양 · 입력 읽기만 한다 (서버를 부르지 않는다). 누른 일은 그 칸을 그리는 화면이 한다:
     서버 workflow-api (src/work/recruit.js)
       POST /company/projects/:id/work/recruit           { kind, people, apply_deadline?, at? } | { kind, stop: true }
       POST /company/schedules/:id/workers/recruit       { people, apply_deadline? } | { stop: true }
       POST /company/work/applications/:id/approve | reject
     줄의 recruit { on, state, slots, filled, deadline, applications[{ application_id, name, message, at }] } | null
       state = open 모집 중 · full 정원이 참 · expired 지원 종료일이 지남
   화면      모집 중이면: 지금 상태 한 줄 + 신청한 작업자(이름 · 남긴 글 · 신청한 때 · 「뽑기」 「반려」) + 「모집 내리기」(되묻는다).
             아니면: 모집 인원(꼭 적는다 — 미리 적어 둔 값 없음) · 지원 종료일(선택) → 「모집 올리기」.
             뽑으면 그 작업자의 배정이 바로 확정된다 (작업자가 스스로 신청했으므로 따로 수락을 받지 않는다).
   단추 이름  data-act = <머리>-recruit · -recruit-stop · -recruit-stop-yes · -recruit-stop-no · -app-approve · -app-reject
             (머리는 화면마다 — project-work 는 pw, site-map 은 wk). 입력 name = <머리>-people · -until-date · -until-time
   정보      신청한 작업자 이름 · 남긴 글은 화면에만 그린다 — 기기 저장 · 알림 · 주소에 싣지 않는다.
   ============================================================ */
/* global window */
(function () {
  'use strict';

  var KST_MS = 9 * 3600 * 1000;
  var WEEK = '일월화수목금토';
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var PEOPLE_MAX = 10; // 서버 work/schedule-link.js ASSIGN_MAX
  var STATES = ['open', 'full', 'expired'];

  var TEXT = {
    title: '모집',
    help: '모집을 올리면 이 종류로 연결된 작업자에게 알림이 가고, 작업자 화면의 「모집중」에 종류 · 날짜 · 지역 · 팩토리 이름만 보입니다. 신청한 사람 가운데 뽑으면 바로 확정됩니다.',
    people: '모집 인원',
    peopleUnit: '명',
    until: '지원 종료일 (선택)',
    untilTime: '종료 시각',
    open: '모집 올리기',
    stop: '모집 내리기',
    stopAsk: '모집을 내릴까요?',
    stopAskApps: '답을 기다리는 신청은 반려로 끝납니다.',
    stopYes: '내리기',
    cancel: '취소',
    on: '모집 중입니다',
    full: '정원이 찼습니다 — 작업자 화면의 「모집중」에는 보이지 않습니다',
    expired: '지원 종료일이 지나 작업자 화면의 「모집중」에 보이지 않습니다',
    slots: '정원',
    of: '명 가운데',
    filled: '명 확정',
    deadline: '지원 종료',
    apps: '신청한 작업자',
    noApps: '아직 신청한 작업자가 없습니다.',
    applied: '신청',
    message: '남긴 글',
    pick: '뽑기',
    reject: '반려',
    noName: '(이름 없음)',
    summaryOn: '모집 중',
    summaryApps: '신청',
    needPeople: '모집 인원을 적어 주세요 (1 ~ ' + PEOPLE_MAX + '명).',
    needDate: '지원 종료일의 날짜를 골라 주세요.',
    needTime: '지원 종료일의 시각을 골라 주세요.',
    past: '지원 종료일은 지금보다 뒤여야 합니다.',
    opened: '모집을 올렸습니다. 연결된 작업자에게 알림이 갑니다.',
    stopped: '모집을 내렸습니다.',
    picked: '작업자를 뽑았습니다. 배정이 확정됐습니다.',
    rejected: '신청을 반려했습니다.',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }
  /** 때 → '11/18 (수) 09:00' 한국 시간 (없으면 '') */
  function whenText(iso) {
    var t = Date.parse(typeof iso === 'string' ? iso : '');
    if (isNaN(t)) return '';
    var d = new Date(t + KST_MS);
    var at = d.toISOString();
    return (
      d.getUTCMonth() +
      1 +
      '/' +
      d.getUTCDate() +
      ' (' +
      WEEK[d.getUTCDay()] +
      ') ' +
      at.slice(11, 16)
    );
  }

  /**
   * 서버 줄의 recruit → { on, state, slots, filled, deadline, apps[{ id, name, message, at }] } | null
   * (모양이 틀리면 null — 모집 칸을 그리지 않는다)
   */
  function recruitOf(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var num = function (v) {
      return typeof v === 'number' && v >= 0 && Math.floor(v) === v ? v : 0;
    };
    var on = raw.on === true;
    return {
      on: on,
      state: on && STATES.indexOf(raw.state) >= 0 ? raw.state : on ? 'open' : '',
      slots: num(raw.slots),
      filled: num(raw.filled),
      deadline: on ? str(raw.deadline) : '',
      apps: (Array.isArray(raw.applications) ? raw.applications : [])
        .filter(function (a) {
          return a && typeof a === 'object' && ID_RE.test(str(a.application_id));
        })
        .map(function (a) {
          return {
            id: str(a.application_id),
            name: str(a.name),
            message: str(a.message),
            at: str(a.at),
          };
        }),
    };
  }
  /** 표의 상태 칸에 붙이는 짧은 글 — '모집 중 · 신청 2' · '모집 중' · '신청 2' · '' */
  function summaryOf(rc) {
    if (!rc) return '';
    var parts = [];
    if (rc.on && rc.state === 'open') parts.push(TEXT.summaryOn);
    if (rc.apps.length) parts.push(TEXT.summaryApps + ' ' + rc.apps.length);
    return parts.join(' · ');
  }
  /** 지금 상태 한 줄 — '모집 중입니다 — 정원 3명 가운데 1명 확정 · 지원 종료 11/18 (수) 18:00' */
  function statusText(rc) {
    var head = rc.state === 'full' ? TEXT.full : rc.state === 'expired' ? TEXT.expired : TEXT.on;
    var parts = [TEXT.slots + ' ' + rc.slots + TEXT.of + ' ' + rc.filled + TEXT.filled];
    if (rc.deadline && whenText(rc.deadline))
      parts.push(TEXT.deadline + ' ' + whenText(rc.deadline));
    return head + ' — ' + parts.join(' · ');
  }

  // ── 그리기 ────────────────────────────────────────────
  function btnHtml(o, act, id, label, solid) {
    var full = o.prefix + '-' + act;
    return (
      '<button type="button" class="' +
      (solid === 'link' ? 'od-open' : 'mk-btn' + (solid ? ' mk-btn--solid' : '')) +
      '" data-act="' +
      full +
      '"' +
      (id ? ' data-id="' + esc(id) + '"' : '') +
      (o.fk ? ' data-fk="' + full + ':' + esc(id || '') + '"' : '') +
      (o.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }
  function inputHtml(o, name, type, label, extra) {
    var full = o.prefix + '-' + name;
    return (
      '<label class="mk-input"><span>' +
      esc(label) +
      '</span><input name="' +
      full +
      '" type="' +
      type +
      '"' +
      (extra || '') +
      (o.fk ? ' data-fk="in:' + full + '"' : '') +
      (o.busy ? ' disabled' : '') +
      ' /></label>'
    );
  }
  function appsHtml(rc, o) {
    if (!rc.apps.length) return rc.on ? '<p class="me-empty">' + esc(TEXT.noApps) + '</p>' : '';
    return (
      '<p class="cw-label">' +
      esc(TEXT.apps + ' ' + rc.apps.length) +
      '</p><ul class="sm-wk-list wr-apps">' +
      rc.apps
        .map(function (a) {
          var when = whenText(a.at);
          return (
            '<li class="sm-wk-item"><div class="sm-wk-row"><span class="sm-wk-name">' +
            esc(a.name || TEXT.noName) +
            '</span><span class="sm-wk-state">' +
            esc(TEXT.applied + (when ? ' ' + when : '')) +
            '</span><span class="sm-wk-acts">' +
            (o.manage
              ? (o.assign ? btnHtml(o, 'app-approve', a.id, TEXT.pick, 'link') : '') +
                btnHtml(o, 'app-reject', a.id, TEXT.reject, 'link')
              : '') +
            '</span></div>' +
            (a.message
              ? '<p class="mk-note">' + esc(TEXT.message + ': ' + a.message) + '</p>'
              : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }
  /**
   * 모집 칸 HTML ('' 이면 그릴 것이 없다).
   * o = { prefix: 'pw' | 'wk', manage: 대표 · 실장, assign: 새로 사람을 들일 수 있는 줄, busy, asking: 내리기를 되묻는 중, fk: data-fk 를 붙인다 }
   */
  function blockHtml(rc, o) {
    o = o || {};
    var on = !!rc && rc.on;
    var hasApps = !!rc && rc.apps.length > 0;
    // 모집 중이 아니고 신청도 없으면 — 올릴 수 있는 사람에게만 올리는 칸을 보인다
    if (!on && !hasApps && !(o.manage && o.assign)) return '';
    var body = '';
    if (on) {
      body +=
        '<p class="mk-note" data-wr="status">' + esc(statusText(rc)) + '</p>' + appsHtml(rc, o);
      if (o.manage)
        body += o.asking
          ? '<div class="pw-ask" role="group" aria-label="확인" data-wr="ask"><p>' +
            esc(TEXT.stopAsk + (hasApps ? ' ' + TEXT.stopAskApps : '')) +
            '</p><div class="rd-acts">' +
            btnHtml(o, 'recruit-stop-yes', '', TEXT.stopYes, true) +
            btnHtml(o, 'recruit-stop-no', '', TEXT.cancel) +
            '</div></div>'
          : '<div class="rd-acts">' + btnHtml(o, 'recruit-stop', '', TEXT.stop) + '</div>';
    } else {
      body += appsHtml(rc || { apps: [], on: false }, o);
      if (o.manage && o.assign)
        body +=
          '<p class="mk-note">' +
          esc(TEXT.help) +
          '</p><div class="pjw-date wr-form">' +
          inputHtml(
            o,
            'people',
            'number',
            TEXT.people,
            ' min="1" max="' +
              PEOPLE_MAX +
              '" step="1" inputmode="numeric" placeholder="' +
              esc(TEXT.peopleUnit) +
              '"'
          ) +
          inputHtml(o, 'until-date', 'date', TEXT.until) +
          inputHtml(o, 'until-time', 'time', TEXT.untilTime) +
          '<div class="rd-acts">' +
          btnHtml(o, 'recruit', '', TEXT.open) +
          '</div></div>';
    }
    return (
      '<div class="wr" data-wr="box"><p class="cw-label">' +
      esc(TEXT.title) +
      '</p>' +
      body +
      '</div>'
    );
  }

  /**
   * 칸의 입력 → { body: { people, apply_deadline? } } | { error: 'people' | 'until-date' | 'until-time', message }
   * 인원은 꼭 적는다 (1 ~ PEOPLE_MAX). 종료일은 비워 둘 수 있다 — 날을 적었으면 시각도 적어야 하고, 지금보다 뒤여야 한다.
   */
  function readForm(host, prefix, nowMs) {
    var val = function (name) {
      var el = host && host.querySelector('[name="' + prefix + '-' + name + '"]');
      return el ? str(el.value) : '';
    };
    var raw = val('people');
    var people = Number(raw);
    if (!/^\d+$/.test(raw) || people < 1 || people > PEOPLE_MAX)
      return { error: 'people', message: TEXT.needPeople };
    var body = { people: people };
    var day = val('until-date');
    var time = val('until-time');
    if (day || time) {
      if (!DAY_RE.test(day) || isNaN(Date.parse(day + 'T00:00:00Z')))
        return { error: 'until-date', message: TEXT.needDate };
      if (!TIME_RE.test(time)) return { error: 'until-time', message: TEXT.needTime };
      var at = day + 'T' + time + ':00+09:00';
      if (Date.parse(at) <= (nowMs == null ? Date.now() : nowMs))
        return { error: 'until-date', message: TEXT.past };
      body.apply_deadline = at;
    }
    return { body: body };
  }

  window.SeganWorkRecruit = {
    TEXT: TEXT,
    PEOPLE_MAX: PEOPLE_MAX,
    whenText: whenText,
    recruitOf: recruitOf,
    summaryOf: summaryOf,
    statusText: statusText,
    blockHtml: blockHtml,
    readForm: readForm,
  };
})();
