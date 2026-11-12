/* ============================================================
   segan/work-shifts.js — 「인사 › 근무 일정」 (segan/me.html #workShifts)

   쉬는 날만 적는 주간 표. 적지 않은 날은 근무다.
   (마이페이지 B안 6단계 — 2026-11-12 사장님 결정 ④: 휴무 · 연차 · 반차 · 외근만, 대표 · 실장이 적고 구성원 모두가 본다,
    다담 공장은 공장 작업자도 같이. 출근 · 퇴근 시간(근태)은 다루지 않는다)

   누가 보나  다담 공장 구성원 · 협력업체 Agent 구성원 (서버 work-shifts.js canHoldPeople 과 같다). 적을 수 있는지는
             서버 답(can_manage)을 따른다. segan/me.js 가 업체 칸을 읽은 뒤 SeganWorkShifts.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET /company/shifts?from=&to=   { can_manage, today, people[{ kind, id, name, role }], items[{ person_kind, person_id, date, kind, note }] }
               PUT /company/shifts             { person_kind, person_id, date, kind | null, note? } — null 이면 지운다(다시 근무)
   화면      한 주(월 ~ 일) 표 — 줄 = 사람, 칸 = 그날. 칸에 쉬는 종류가 글자로 적힌다 (빈 칸 = 근무). 오늘 칸은 굵은 선.
             지난 주 · 다음 주 · 이번 주 단추. 대표 · 실장은 칸을 눌러 그 아래에서 종류와 메모를 고른다.
   못 읽으면  칸째 감춘다 — 그때 메뉴는 「준비 중」 안내로 남는다 (segan/me.js).
   정보      사람 이름 · 메모는 화면에만 그린다 — 알림 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLANS = ['agent']; // segan/me.js PEOPLE_PLANS 와 같다
  var KINDS = ['off', 'leave', 'half', 'out'];
  var KIND_NAME = { off: '휴무', leave: '연차', half: '반차', out: '외근' };
  var ROLE_NAME = { owner: '대표', manager: '실장', staff: '직원', worker: '작업자' };
  var DOW = ['월', '화', '수', '목', '금', '토', '일'];
  var DAY_MS = 86400000;
  var NOTE_MAX = 100;

  var TEXT = {
    title: '근무 일정',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    note: '쉬는 날만 적습니다. 빈 칸은 근무입니다.',
    noteManage:
      '쉬는 날만 적습니다. 빈 칸은 근무입니다. 칸을 눌러 휴무 · 연차 · 반차 · 외근을 고릅니다.',
    prev: '지난 주',
    next: '다음 주',
    thisWeek: '이번 주',
    person: '사람',
    work: '근무',
    workBtn: '근무 (지우기)',
    memo: '메모 (선택)',
    close: '닫기',
    none: '아직 사람이 없습니다.',
    noName: '이름 없음',
    saved: '적었습니다.',
    cleared: '근무로 돌렸습니다.',
    today: '오늘',
    count: '이 주 쉬는 날',
    countUnit: '건',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    canManage: false,
    today: '',
    from: '',
    people: [],
    items: {},
    pick: null,
    msg: '',
    err: '',
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
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function canSee(me) {
    var m = obj(me);
    if (m.platform_member === true) return false;
    if (m.hq_member === true) return true;
    return PLANS.indexOf(obj(m.company).plan) >= 0;
  }

  /** 'YYYY-MM-DD' → UTC 자정 ms (틀리면 NaN) */
  function ms(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(str(d)) ? Date.parse(d + 'T00:00:00Z') : NaN;
  }
  function iso(t) {
    return new Date(t).toISOString().slice(0, 10);
  }
  /** 그날에서 n 일 뒤 */
  function addDays(d, n) {
    return iso(ms(d) + n * DAY_MS);
  }
  /** 그날이 든 주의 월요일 */
  function mondayOf(d) {
    var t = ms(d);
    var dow = (new Date(t).getUTCDay() + 6) % 7; // 월 0 … 일 6
    return iso(t - dow * DAY_MS);
  }
  /** 한 주의 날 일곱 */
  function weekOf(from) {
    return DOW.map(function (_, i) {
      return addDays(from, i);
    });
  }
  function md(d) {
    return d.slice(5, 7) + '.' + d.slice(8, 10);
  }
  function keyOf(kind, id, date) {
    return kind + ':' + id + ':' + date;
  }

  /** 서버가 준 사람 — 종류 · id 가 없으면 버린다 */
  function personOf(v) {
    var p = obj(v);
    if ((p.kind !== 'member' && p.kind !== 'worker') || !str(p.id)) return null;
    return {
      kind: p.kind,
      id: p.id,
      name: str(p.name).trim(),
      role: ROLE_NAME[p.role] ? p.role : p.kind === 'worker' ? 'worker' : 'staff',
    };
  }

  /** 서버가 준 쉬는 날들 → { '종류:id:날': { kind, note } } — 모르는 종류는 버린다 */
  function itemsOf(list) {
    var out = {};
    (Array.isArray(list) ? list : []).forEach(function (v) {
      var s = obj(v);
      if (KINDS.indexOf(s.kind) < 0 || !str(s.person_id) || isNaN(ms(s.date))) return;
      out[keyOf(s.person_kind === 'worker' ? 'worker' : 'member', s.person_id, s.date)] = {
        kind: s.kind,
        note: str(s.note).trim(),
      };
    });
    return out;
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

  function box() {
    return $('workShifts');
  }
  function dis() {
    return J.busy ? ' disabled' : '';
  }
  function nameOf(p) {
    return p.name || TEXT.noName;
  }

  function cellHtml(p, d) {
    var s = J.items[keyOf(p.kind, p.id, d)];
    var label = s ? KIND_NAME[s.kind] : '';
    var on = J.pick && J.pick.kind === p.kind && J.pick.id === p.id && J.pick.date === d;
    var cls =
      'ws-cell' + (d === J.today ? ' ws-today' : '') + (s ? ' ws-off' : '') + (on ? ' ws-on' : '');
    var aria =
      nameOf(p) + ' ' + md(d) + ' ' + (label || TEXT.work) + (s && s.note ? ' — ' + s.note : '');
    if (!J.canManage)
      return (
        '<td class="' +
        cls +
        '"' +
        (s && s.note ? ' title="' + esc(s.note) + '"' : '') +
        '><span class="me-bk-sr">' +
        esc(aria) +
        '</span><span aria-hidden="true">' +
        esc(label) +
        '</span></td>'
      );
    return (
      '<td class="' +
      cls +
      '"><button type="button" class="ws-btn" data-act="pick" data-kind="' +
      p.kind +
      '" data-id="' +
      esc(p.id) +
      '" data-date="' +
      d +
      '" aria-label="' +
      esc(aria) +
      '" aria-pressed="' +
      !!on +
      '"' +
      dis() +
      '>' +
      esc(label) +
      '</button></td>'
    );
  }

  function editorHtml() {
    var k = J.pick;
    if (!k) return '';
    var p = J.people.filter(function (x) {
      return x.kind === k.kind && x.id === k.id;
    })[0];
    if (!p) return '';
    var s = J.items[keyOf(k.kind, k.id, k.date)];
    var dow = DOW[(new Date(ms(k.date)).getUTCDay() + 6) % 7];
    return (
      '<div class="cp-form ws-editor" data-ws="editor"><h4 class="od-h">' +
      esc(nameOf(p) + ' · ' + md(k.date) + ' (' + dow + ')') +
      '</h4><div class="cs-choices" role="group" aria-label="그날 근무">' +
      '<button type="button" class="mk-btn' +
      (s ? '' : ' mk-btn--solid') +
      '" data-act="set" data-to="" aria-pressed="' +
      !s +
      '"' +
      dis() +
      '>' +
      esc(s ? TEXT.workBtn : TEXT.work) +
      '</button>' +
      KINDS.map(function (kind) {
        var on = s && s.kind === kind;
        return (
          '<button type="button" class="mk-btn' +
          (on ? ' mk-btn--solid' : '') +
          '" data-act="set" data-to="' +
          kind +
          '" aria-pressed="' +
          !!on +
          '"' +
          dis() +
          '>' +
          esc(KIND_NAME[kind]) +
          '</button>'
        );
      }).join('') +
      '</div><label class="mk-input ps-field ws-note" for="workShifts-note"><span>' +
      esc(TEXT.memo) +
      '</span><input id="workShifts-note" data-ws="note" type="text" maxlength="' +
      NOTE_MAX +
      '" autocomplete="off" value="' +
      esc(s ? s.note : '') +
      '"' +
      dis() +
      '></label>' +
      '<p class="mk-error" data-ws="err" role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p><div class="ps-bar">' +
      '<button type="button" class="mk-btn" data-act="close"' +
      dis() +
      '>' +
      esc(TEXT.close) +
      '</button><p class="me-pt-msg ps-msg" data-ws="msg" role="status">' +
      esc(J.msg) +
      '</p></div></div>'
    );
  }

  function render() {
    var b = box();
    if (!b || !J.ready) return;
    var days = weekOf(J.from);
    var n = 0;
    J.people.forEach(function (p) {
      days.forEach(function (d) {
        if (J.items[keyOf(p.kind, p.id, d)]) n += 1;
      });
    });
    b.innerHTML =
      '<h3 class="me-pt-sub" id="workShiftsTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(J.canManage ? TEXT.noteManage : TEXT.note) +
      '</p>' +
      '<div class="ps-bar ws-nav"><button type="button" class="mk-btn" data-act="prev"' +
      dis() +
      '>‹ ' +
      esc(TEXT.prev) +
      '</button><b class="ws-range" data-ws="range">' +
      esc(md(days[0]) + ' ~ ' + md(days[6])) +
      '</b>' +
      '<button type="button" class="mk-btn" data-act="next"' +
      dis() +
      '>' +
      esc(TEXT.next) +
      ' ›</button>' +
      (mondayOf(J.today) === J.from
        ? ''
        : '<button type="button" class="mk-btn" data-act="today"' +
          dis() +
          '>' +
          esc(TEXT.thisWeek) +
          '</button>') +
      '<p class="me-pt-msg ps-msg" data-ws="count">' +
      esc(TEXT.count + ' ' + n + TEXT.countUnit) +
      '</p></div>' +
      (J.people.length
        ? '<div class="od-tablewrap"><table class="od-table ws-table"><thead><tr><th scope="col">' +
          esc(TEXT.person) +
          '</th>' +
          days
            .map(function (d, i) {
              return (
                '<th scope="col" class="ws-day' +
                (d === J.today ? ' ws-today' : '') +
                '">' +
                esc(DOW[i]) +
                '<small>' +
                esc(md(d)) +
                (d === J.today ? ' · ' + esc(TEXT.today) : '') +
                '</small></th>'
              );
            })
            .join('') +
          '</tr></thead><tbody>' +
          J.people
            .map(function (p) {
              return (
                '<tr data-ws-row="' +
                esc(p.kind + ':' + p.id) +
                '"><th scope="row">' +
                esc(nameOf(p)) +
                '<small>' +
                esc(ROLE_NAME[p.role]) +
                '</small></th>' +
                days
                  .map(function (d) {
                    return cellHtml(p, d);
                  })
                  .join('') +
                '</tr>'
              );
            })
            .join('') +
          '</tbody></table></div>'
        : '<p class="me-empty">' + esc(TEXT.none) + '</p>') +
      editorHtml();
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

  /** 그 주를 읽는다 — 읽었으면 true */
  async function readWeek(from) {
    var r = await call('GET', '/company/shifts?from=' + from + '&to=' + addDays(from, 6));
    var d = r.ok ? obj(r.body.data) : null;
    if (!d || !Array.isArray(d.people) || !Array.isArray(d.items)) return false;
    J.from = from;
    J.canManage = d.can_manage === true;
    if (!isNaN(ms(d.today))) J.today = d.today;
    J.people = d.people.map(personOf).filter(Boolean);
    J.items = itemsOf(d.items);
    return true;
  }

  async function go(from) {
    if (J.busy) return;
    J.busy = true;
    J.msg = '';
    J.err = '';
    render();
    var ok = await readWeek(from);
    J.busy = false;
    if (ok) J.pick = null;
    else J.err = TEXT.generic;
    render();
    focusOn('[data-ws="range"]');
  }

  async function setKind(to) {
    var k = J.pick;
    if (!k || J.busy) return;
    var b = box();
    var noteEl = b && b.querySelector('[data-ws="note"]');
    var note = noteEl ? noteEl.value.trim() : '';
    J.busy = true;
    J.msg = '';
    J.err = '';
    render();
    var r = await call('PUT', '/company/shifts', {
      person_kind: k.kind,
      person_id: k.id,
      date: k.date,
      kind: to || null,
      note: to ? note || null : null,
    });
    if (r.ok) {
      var key = keyOf(k.kind, k.id, k.date);
      if (to) J.items[key] = { kind: to, note: note };
      else delete J.items[key];
      J.msg = to ? TEXT.saved : TEXT.cleared;
    } else J.err = errText(r);
    J.busy = false;
    render();
    focusOn('[data-act="set"][aria-pressed="true"]');
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'prev') go(addDays(J.from, -7));
    else if (act === 'next') go(addDays(J.from, 7));
    else if (act === 'today') go(mondayOf(J.today));
    else if (act === 'close') {
      J.pick = null;
      J.msg = '';
      J.err = '';
      render();
    } else if (act === 'pick' && J.canManage) {
      J.pick = {
        kind: el.getAttribute('data-kind') === 'worker' ? 'worker' : 'member',
        id: el.getAttribute('data-id') || '',
        date: el.getAttribute('data-date') || '',
      };
      J.msg = '';
      J.err = '';
      render();
      focusOn('[data-act="set"][aria-pressed="true"]');
    } else if (act === 'set' && J.canManage) setKind(el.getAttribute('data-to') || '');
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
  }

  async function load(sb, session, me) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    J.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    J.sb = sb || null;
    J.session = session || null;
    J.people = [];
    J.items = {};
    J.pick = null;
    J.msg = '';
    J.err = '';
    J.busy = false;
    J.canManage = false;
    // 한국 시간의 오늘 — 서버가 답하면 그 값으로 바꾼다
    J.today = iso(Date.now() + 9 * 3600 * 1000);
    if (!J.base || !session || !canSee(me)) return;
    try {
      if (!(await readWeek(mondayOf(J.today)))) return;
      if (mondayOf(J.today) !== J.from && !(await readWeek(mondayOf(J.today)))) return;
      bind();
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganWorkShifts = {
    KIND_NAME: KIND_NAME,
    ROLE_NAME: ROLE_NAME,
    TEXT: TEXT,
    canSee: canSee,
    mondayOf: mondayOf,
    addDays: addDays,
    weekOf: weekOf,
    personOf: personOf,
    itemsOf: itemsOf,
    state: J,
    load: load,
  };
})();
