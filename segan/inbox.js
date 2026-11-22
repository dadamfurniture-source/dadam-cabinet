/* ============================================================
   segan/inbox.js — 마이페이지 「TODAY WORK」 의 「새로 생긴 일」 (#meInbox — 2026-11-21 프로젝트 관리 대시보드에서 옮김)

   2026-11-21 대표님 「새롭게 발생 된 일을 표로 만들어서 제일 위에 표시 해주고 그다음에 달력을 표시」 ·
   질문 창에서 고르심 「할 일 + 소식」 (승인 계획 「프로젝트 한 길」).

   2026-11-23 대표님 「오늘 할일은 제거 해주고, 새로 생긴 일에 오늘, 주간, 월간을 선택 해서 할일 목록」 → 「두 가지를 하나로
   합칠 순 없나?」 → 계획(Tbd1CBibNmZgGpZtvKHt5w) 「추천대로 진행」:
     할 일 표 자리에 기간 단추(오늘 · 주간 · 월간, 단추마다 줄 수)와 할 일 + 달력 일정을 합친 한 목록.
     · 「지금 할 일」(맨 위, 세 기간 모두) — 날이 없는 할 일(프로젝트마다 · 기한 없는 묶음) · 기한 지난 묶음
     · 날마다 — 기한 있는 묶음(그 기한 날 · 시각)과 달력 일정(GET /company/schedules — 오늘부터 읽는다,
       달력에서 달을 넘겨도 이 목록은 그대로). 시각 차례, 시각 없는 줄은 그날 맨 아래
     · 기간 — 오늘 / 오늘 ~ 이번 주 일요일 / 오늘 ~ 이번 달 말일. 지난 날 일정은 없다 · 끝남 · 취소 일정은 뺀다 (달력에는 그대로)
     · 처음 칸은 오늘, 고른 칸은 이 기기가 기억한다 (localStorage segan.inbox.range)
     · 일정 줄의 색 · 「열기」 · 「작업 배정」은 segan/calendar.js 의 것(openOf · workProjectOf · statusOf · detailOf)을 쓴다.
       일정을 못 읽으면(403 · 끊김 · 달력 파일 없음) 할 일만 그린다.
   할 일 — 내가 눌러야 끝나는 일. 끝내면 여기서 빠진다 (읽음 표시가 아니라 상태로 정해진다)
     ① 묶음: 서버 GET /company/inbox 의 todo — 새 상담 받기 · 제작 의뢰 답하기 · 팩토리 고르기 ·
        수주 요청 승인 · A/S 접수 받기 · 받을 돈 확인 (수만, 기한이 이른 것부터)
     ② 프로젝트마다: 이미 읽은 프로젝트 목록(segan/partner-projects.js)의 다음 할 일(next) 가운데
        남을 기다리지 않고 · 내 직책으로 할 수 있는 것 — 오래 머문 것부터 PROJECT_MAX 줄.
        단추는 프로젝트 줄과 같은 것이다 (SeganPartnerProjects.nextOf · runNext) — 줄과 표가 어긋나지 않는다.
        프로젝트 이름을 누르면 그 프로젝트의 창이 열린다 (segan/project-sheet.js).
        묶음이 이미 세는 일(팩토리 고르기 · 수주 요청 승인)은 줄마다 다시 적지 않는다.
   소식 — 서버 news: 지난 14일 동안 일어난 일, 새 것부터. 줄 끝에 「누가」(구성원 이름 · 고객 — 일지가 있는 일만).
     지난번에 본 뒤 생긴 것은 「새」 — **계정이 기억한다** (2026-11-21 뒤 공정 1차: 서버 seen_at · POST /company/inbox/seen).
     서버가 seen_at 을 주지 않으면(DB 0078 전 · 옛 서버) 지금처럼 이 기기가 기억한다 (localStorage — 사람마다 따로).
     할 일은 상태라 어느 기기에서나 같다.
   보류한 프로젝트는 할 일 표에 없다 — 다시 볼 날이 되면 「보류 — 다시 볼 날입니다」 한 줄로 나온다 (누르면 그 줄의 칸).

   누가: 프로젝트를 가지는 업체의 구성원 (SeganPartnerProjects.canSee). 고객 · 본사 구성원에게는 없다.
   서버 길을 못 읽으면(옛 서버 · 오류) 프로젝트마다의 할 일만 그린다. 그릴 것이 하나도 없으면 칸을 감춘다.
   글은 서버가 준 것과 프로젝트 이름뿐이다 — 고객 이름 · 전화 · 금액은 오지 않는다 (받을 돈 합계는 대표 · 실장에게만).
   다시 그리기: segan/me.js 의 sync 가 부른다 (프로젝트 만들기 · 상담 받기 · 계약 만들기 뒤 — render 는 글이 바뀔 때만 다시 그린다).
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PROJECT_MAX = 20; // 프로젝트마다의 할 일 줄 수
  var SEEN_KEY = 'segan.inbox.seen'; // + 업체 id + 사람 id — 지난번에 본 가장 새 소식의 때 (서버가 기억하지 못할 때만)
  // 서버 묶음이 이미 세는 일 — 프로젝트 줄의 next.key
  var COVERED = { choose: 'choose', approve: 'approval' };
  var RANGES = ['day', 'week', 'month'];
  var RANGE_KEY = 'segan.inbox.range'; // 고른 기간 — 이 기기가 기억한다
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  // 끝난 · 취소한 일정은 목록에서 뺀다 (달력에는 그대로) — source 마다의 상태 (segan/calendar.js 와 같은 값)
  var DONE = {
    schedule: { completed: 1, cancelled: 1 },
    visit: { completed: 1, cancelled: 1 },
    work: { done: 1 },
    as: { done: 1 },
  };
  var TEXT = {
    title: '새로 생긴 일',
    news: '소식',
    newsNote: '최근 14일',
    range: '기간',
    rangeName: { day: '오늘', week: '주간', month: '월간' },
    now: '지금 할 일',
    colWhat: '할 일',
    colWhere: '프로젝트',
    colWhen: '때',
    open: '열기',
    count: '건',
    more: '건 더 — 프로젝트 관리 목록에서',
    none: {
      day: '오늘 할 일이 없습니다.',
      week: '이번 주 할 일이 없습니다.',
      month: '이번 달 할 일이 없습니다.',
    },
    workOpen: '작업 배정',
    workView: '작업자 보기',
    workGone: '프로젝트 목록에 이 프로젝트가 없습니다. 끝났거나 보관한 프로젝트일 수 있습니다.',
    noNews: '최근 14일 동안 새로 생긴 일이 없습니다.',
    fresh: '새',
    late: '기한 지남',
    hoursLeft: '시간 남음',
    minsLeft: '분 남음',
    today: '오늘',
    yesterday: '어제',
    days: '일째',
    lateDue: '지난 것 ',
    noTitle: '프로젝트',
    whoCustomer: '고객',
    whoAdmin: '본사',
    whoWorker: '작업자',
    whoMember: '구성원',
  };

  var I = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false, // 볼 사람이다
    data: null, // GET /company/inbox data (못 읽었으면 null)
    sched: null, // GET /company/schedules — { manage, today, items } (못 읽었으면 null)
    range: 'day', // 고른 기간
    msg: '', // 「작업 배정」을 못 열었을 때의 글
    seenAt: '', // 이 화면을 연 때의 「지난번에 본 때」 — 이 방문 동안 「새」 표시의 기준
    server: false, // 서버가 본 때를 기억한다 (응답에 seen_at 칸이 있다)
    sent: '', // 서버에 마지막으로 보낸 본 때 — 같은 값을 다시 보내지 않는다
    html: null,
  };

  function $(id) {
    return document.getElementById(id);
  }
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
  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // ── 글 (순수 — 시험이 직접 부른다) ───────────────────────
  /** 답 기한까지 — 「19시간 남음」 · 「40분 남음」 · 「기한 지남」 (모르면 빈 글자) */
  function dueText(iso, now) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var left = t - now;
    if (left <= 0) return TEXT.late;
    var h = Math.floor(left / 3600000);
    return h >= 1 ? h + TEXT.hoursLeft : Math.max(1, Math.floor(left / 60000)) + TEXT.minsLeft;
  }

  /** 그 상태가 시작된 지 — 「오늘」 · 「3일째」 (모르면 빈 글자) */
  function sinceText(iso, now) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var n = Math.floor((now - t) / 86400000);
    return n < 1 ? TEXT.today : n + TEXT.days;
  }

  /** 소식의 때 (한국 시간) — 「오늘 10:12」 · 「어제 17:40」 · 「11.19」 */
  function whenText(iso, now) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600000);
    var day = function (ms) {
      return Math.floor((ms + 9 * 3600000) / 86400000);
    };
    var gap = day(now) - day(t);
    var hm = pad(k.getUTCHours()) + ':' + pad(k.getUTCMinutes());
    if (gap <= 0) return TEXT.today + ' ' + hm;
    if (gap === 1) return TEXT.yesterday + ' ' + hm;
    return pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate());
  }

  /** 서버 묶음 — 아는 칸만 */
  function todoOf(data) {
    var list = obj(data).todo;
    return (Array.isArray(list) ? list : [])
      .map(function (v) {
        var r = obj(v);
        var count = Number(r.count);
        if (typeof r.kind !== 'string' || typeof r.label !== 'string' || !(count > 0)) return null;
        return {
          kind: r.kind,
          label: r.label,
          count: Math.floor(count),
          go: typeof r.go === 'string' && /^p-[a-z]+$/.test(r.go) ? r.go : '',
          due: typeof r.due === 'string' ? r.due : '',
          late: Number(r.late) > 0 ? Math.floor(Number(r.late)) : 0,
        };
      })
      .filter(Boolean);
  }

  /** 서버 소식 — 아는 칸만 */
  function newsOf(data) {
    var list = obj(data).news;
    return (Array.isArray(list) ? list : [])
      .map(function (v) {
        var r = obj(v);
        if (typeof r.label !== 'string' || !r.label || typeof r.at !== 'string') return null;
        return {
          kind: typeof r.kind === 'string' ? r.kind : '',
          at: r.at,
          label: r.label,
          go: typeof r.go === 'string' && /^p-[a-z]+$/.test(r.go) ? r.go : '',
          project: typeof obj(r.project).title === 'string' ? obj(r.project).title : '',
          who: whoText(r.who),
        };
      })
      .filter(Boolean);
  }

  /** 누가 — 구성원 이름 · 「고객」 · 「본사」 (모르면 빈 글자). 고객 이름은 오지 않는다 */
  function whoText(who) {
    var w = obj(who);
    if (w.kind === 'member') return typeof w.name === 'string' && w.name ? w.name : TEXT.whoMember;
    if (w.kind === 'customer') return TEXT.whoCustomer;
    if (w.kind === 'admin') return TEXT.whoAdmin;
    if (w.kind === 'worker') return TEXT.whoWorker;
    return '';
  }

  /**
   * 프로젝트마다의 할 일 — 진행 중 프로젝트의 next 가운데 남을 기다리지 않고 내가 할 수 있는 것.
   * 보류한 프로젝트는 다시 볼 날이 됐을 때만 (next.key hold_due).
   * covered = 서버 묶음이 이미 센 종류(kind) — 그 일은 줄마다 다시 적지 않는다. 오래 머문 것부터.
   */
  function projectTodos(items, covered) {
    return (Array.isArray(items) ? items : [])
      .filter(function (p) {
        var n = p && obj(p.next);
        if (!p || typeof n.label !== 'string' || !n.label) return false;
        if (p.status && p.status !== 'active' && !(p.status === 'on_hold' && n.key === 'hold_due'))
          return false;
        if (n.wait === true || n.allowed === false) return false;
        return !(COVERED[n.key] && covered[COVERED[n.key]]);
      })
      .sort(function (a, b) {
        var x = Date.parse(a.next.since);
        var y = Date.parse(b.next.since);
        if (isNaN(x) && isNaN(y)) return 0;
        if (isNaN(x)) return 1;
        if (isNaN(y)) return -1;
        return x - y;
      });
  }

  // ── 날짜 (순수 — 'YYYY-MM-DD' 한국 날짜) ───────────────
  function addDays(day, n) {
    return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  }
  function weekdayOf(day) {
    return new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay();
  }
  function kstToday(now) {
    return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
  }

  /** 기간의 마지막 날 — 오늘 / 이번 주 일요일 / 이번 달 말일 (오늘부터, 그날 포함) */
  function rangeEnd(range, today) {
    if (range === 'week') return addDays(today, (7 - weekdayOf(today)) % 7);
    if (range === 'month') {
      var y = Number(today.slice(0, 4));
      var m = Number(today.slice(5, 7));
      return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    }
    return today;
  }

  /** 그 때(ISO)의 한국 날 · 시각 — { day, time } (모르면 null) */
  function kstAt(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return null;
    var s = new Date(t + 9 * 3600000).toISOString();
    return { day: s.slice(0, 10), time: s.slice(11, 16) };
  }

  /** 'M월 D일 (요일)' */
  function dayTitle(day) {
    return (
      Number(day.slice(5, 7)) + '월 ' + Number(day.slice(8, 10)) + '일 (' + WEEKDAYS[weekdayOf(day)] + ')'
    );
  }

  /** 목록에 넣을 달력 일정 — 오늘부터, 끝남 · 취소는 뺀다 */
  function schedulesFrom(items, today) {
    return (Array.isArray(items) ? items : []).filter(function (x) {
      if (!x || typeof x !== 'object' || typeof x.day !== 'string' || x.day < today) return false;
      var done = DONE[x.source];
      return !(done && done[x.status]);
    });
  }

  /**
   * 줄을 자리에 놓는다 — rows[{ at: 'now' | 'YYYY-MM-DD', time, ... }] → [{ at, rows }]
   * 「지금 할 일」이 맨 위, 날은 차례로. 한 날 안은 시각 차례 (시각 없는 줄은 맨 아래, 같으면 넣은 차례)
   */
  function groupRows(rows, range, today) {
    var end = rangeEnd(range, today);
    var at = {};
    var out = [];
    rows.forEach(function (r) {
      if (r.at !== 'now' && (r.at < today || r.at > end)) return;
      if (at[r.at] == null) {
        at[r.at] = out.length;
        out.push({ at: r.at, rows: [] });
      }
      out[at[r.at]].rows.push(r);
    });
    out.sort(function (a, b) {
      if (a.at === b.at) return 0;
      if (a.at === 'now') return -1;
      if (b.at === 'now') return 1;
      return a.at < b.at ? -1 : 1;
    });
    out.forEach(function (g) {
      if (g.at === 'now') return;
      g.rows = g.rows
        .map(function (r, i) {
          return { r: r, i: i };
        })
        .sort(function (a, b) {
          var x = a.r.time || '99:99';
          var y = b.r.time || '99:99';
          return x === y ? a.i - b.i : x < y ? -1 : 1;
        })
        .map(function (v) {
          return v.r;
        });
    });
    return out;
  }

  // ── 그리기 ─────────────────────────────────────────────
  function seenKey() {
    var c = obj(obj(I.me).company);
    var u = obj(obj(I.session).user);
    // 사람마다 따로 — 한 기기를 두 계정이 써도 「새」 기준이 섞이지 않는다
    return (
      SEEN_KEY +
      '.' +
      (typeof c.id === 'string' ? c.id : 'hq') +
      '.' +
      (typeof u.id === 'string' ? u.id : 'me')
    );
  }
  function readSeen() {
    try {
      return window.localStorage.getItem(seenKey()) || '';
    } catch {
      return '';
    }
  }
  function readRange() {
    try {
      var r = window.localStorage.getItem(RANGE_KEY);
      return RANGES.indexOf(r) >= 0 ? r : 'day';
    } catch {
      return 'day';
    }
  }
  function writeRange(r) {
    try {
      window.localStorage.setItem(RANGE_KEY, r);
    } catch {
      /* 기억하지 못해도 이번 화면은 그대로 */
    }
  }
  function writeSeen(at) {
    try {
      if (at) window.localStorage.setItem(seenKey(), at);
    } catch {
      /* 기억하지 못해도 그대로 그린다 */
    }
  }

  /** 하위 화면을 열 수 있나 — 그 사람 메뉴에 있고 준비 중이 아닐 때 (segan/me.js — 달력과 같은 판정) */
  function canGo(name) {
    var Me = window.SeganMe;
    if (!name || !Me || !Me.defOf || !Me.available) return false;
    var s = Me.defOf(name);
    return !!s && !s.soon && Me.available(name);
  }

  function goHtml(go) {
    return (
      '<a class="mk-btn" href="#' + esc(go) + '" data-me-go="' + esc(go) + '">' + esc(TEXT.open) + '</a>'
    );
  }

  /** 오늘 — 일정 응답의 날(서버 시계)이 있으면 그것, 아니면 이 기기의 한국 날짜 */
  function todayOf(now) {
    var d = I.sched && I.sched.today;
    return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : kstToday(now);
  }

  /** 할 일 + 달력 일정 → 줄들 [{ at, time, html }] (기간은 아직 거르지 않는다) */
  function agendaRows(now) {
    var PP = window.SeganPartnerProjects;
    var Cal = window.SeganCalendar;
    var packs = todoOf(I.data);
    var covered = {};
    packs.forEach(function (t) {
      covered[t.kind] = true;
    });
    var items = PP && PP.state && PP.state.data ? PP.state.data.items : null;
    var mine = projectTodos(items, covered);
    // 프로젝트 이름 — 누르면 프로젝트 한 건 창 (segan/project-sheet.js)
    var Sheet = window.SeganProjectSheet;
    var canSheet = !!(Sheet && typeof Sheet.canOpen === 'function' && Sheet.canOpen());
    var rows = [];
    // ① 서버 묶음 — 기한이 지났거나 없으면 「지금 할 일」, 남았으면 그 기한 날 · 시각에
    packs.forEach(function (t) {
      var late = t.kind === 'due' && t.late;
      var when = late ? TEXT.lateDue + t.late + TEXT.count : dueText(t.due, now);
      var due = late ? null : kstAt(t.due);
      var ahead = !!due && Date.parse(t.due) > now;
      rows.push({
        at: ahead ? due.day : 'now',
        time: ahead ? due.time : '',
        html:
          '<tr data-ib-todo="' +
          esc(t.kind) +
          '"><th scope="row">' +
          esc(t.label) +
          '</th><td>' +
          esc(t.count + TEXT.count) +
          '</td><td>' +
          esc(when) +
          '</td><td class="ib-act">' +
          (t.go ? goHtml(t.go) : '') +
          '</td></tr>',
      });
    });
    // ② 프로젝트마다의 다음 할 일 — 날이 없다, 늘 「지금 할 일」
    mine.slice(0, PROJECT_MAX).forEach(function (p) {
      var flow = PP && typeof PP.nextOf === 'function' ? PP.nextOf(p) : null;
      if (!flow || !flow.act) return;
      rows.push({
        at: 'now',
        time: '',
        html:
          '<tr data-ib-project="' +
          esc(p.id) +
          '"><th scope="row">' +
          esc(p.next.label) +
          '</th><td>' +
          (canSheet
            ? '<button type="button" class="ib-link" data-act="project" data-id="' +
              esc(p.id) +
              '">' +
              esc(p.title || TEXT.noTitle) +
              '</button>'
            : esc(p.title || TEXT.noTitle)) +
          '</td><td>' +
          esc(sinceText(p.next.since, now)) +
          '</td><td class="ib-act">' +
          flow.act +
          '</td></tr>',
      });
    });
    // ③ 달력 일정 — 그날 · 시각에. 색 · 종류 · 「열기」 · 「작업 배정」은 달력의 것
    if (I.sched && Cal) {
      var manage = I.sched.manage;
      var canWork = !!PP && typeof PP.openWork === 'function';
      schedulesFrom(I.sched.items, todayOf(now)).forEach(function (x) {
        var kind = Cal.KIND_LABEL[x.kind] || '';
        var time = typeof x.time === 'string' && /^\d{2}:\d{2}$/.test(x.time.trim()) ? x.time.trim() : '';
        var go = Cal.openOf(x);
        var workFor = canWork ? Cal.workProjectOf(x) : '';
        var where = [kind, Cal.detailOf(x), Cal.statusOf(x)].filter(Boolean).join(' · ');
        rows.push({
          at: x.day,
          time: time,
          html:
            '<tr data-ib-sched="' +
            esc(x.key) +
            '"><th scope="row"><i class="cal-sw cal-sw--' +
            esc(x.kind) +
            '" aria-hidden="true"></i> ' +
            esc(x.label || kind) +
            '</th><td>' +
            esc(where) +
            '</td><td>' +
            esc(time || (typeof x.time === 'string' ? x.time.trim() : '')) +
            '</td><td class="ib-act">' +
            (canGo(go) ? goHtml(go) : '') +
            (workFor
              ? '<button type="button" class="mk-btn" data-act="work" data-project="' +
                esc(workFor) +
                '">' +
                esc(manage ? TEXT.workOpen : TEXT.workView) +
                '</button>'
              : '') +
            '</td></tr>',
        });
      });
    }
    return { rows: rows, more: mine.length > PROJECT_MAX ? mine.length - PROJECT_MAX : 0 };
  }

  /** 기간 단추 + 한 목록 — { total(지금 할 일 수), html } */
  function agendaHtml(now) {
    var got = agendaRows(now);
    var today = todayOf(now);
    var count = {};
    RANGES.forEach(function (r) {
      count[r] = groupRows(got.rows, r, today).reduce(function (n, g) {
        return n + g.rows.length;
      }, 0);
    });
    var groups = groupRows(got.rows, I.range, today);
    var nowRows = got.rows.filter(function (r) {
      return r.at === 'now';
    }).length;
    var head =
      '<div class="ib-head ib-ranges" role="group" aria-label="' +
      esc(TEXT.range) +
      '">' +
      RANGES.map(function (r) {
        return (
          '<button type="button" class="cal-btn ib-range" data-act="range" data-range="' +
          r +
          '" aria-pressed="' +
          (r === I.range ? 'true' : 'false') +
          '">' +
          esc(TEXT.rangeName[r]) +
          ' <span class="ib-n">' +
          count[r] +
          '</span></button>'
        );
      }).join('') +
      '</div>';
    var body = groups
      .map(function (g) {
        var name =
          g.at === 'now' ? TEXT.now : dayTitle(g.at) + (g.at === today ? ' · ' + TEXT.today : '');
        return (
          '<tr class="ib-day" data-ib-day="' +
          esc(g.at) +
          '"><th scope="rowgroup" colspan="4">' +
          esc(name) +
          '</th></tr>' +
          g.rows
            .map(function (r) {
              return r.html;
            })
            .join('')
        );
      })
      .join('');
    return {
      total: nowRows + (I.sched ? I.sched.items.length : 0),
      html:
        head +
        (body
          ? '<div class="od-tablewrap"><table class="od-table ib-table"><thead><tr><th scope="col">' +
            esc(TEXT.colWhat) +
            '</th><th scope="col">' +
            esc(TEXT.colWhere) +
            '</th><th scope="col">' +
            esc(TEXT.colWhen) +
            '</th><th scope="col" aria-label="' +
            esc(TEXT.open) +
            '"></th></tr></thead><tbody>' +
            body +
            '</tbody></table></div>' +
            (got.more ? '<p class="mk-note">' + esc(got.more + TEXT.more) + '</p>' : '')
          : '<p class="me-empty" data-ib="none">' + esc(TEXT.none[I.range]) + '</p>') +
        (I.msg ? '<p class="mk-note" data-ib="msg" role="status">' + esc(I.msg) + '</p>' : ''),
    };
  }

  function newsHtml(now) {
    var list = newsOf(I.data);
    if (!list.length) return '<p class="me-empty" data-ib="no-news">' + esc(TEXT.noNews) + '</p>';
    return (
      '<ul class="ib-news">' +
      list
        .map(function (n) {
          var fresh = !!I.seenAt && n.at > I.seenAt;
          var body =
            esc(n.label) +
            (n.project ? ' <span class="ib-where">· ' + esc(n.project) + '</span>' : '') +
            (n.who ? ' <span class="ib-where">· ' + esc(n.who) + '</span>' : '');
          return (
            '<li' +
            (fresh ? ' class="is-new"' : '') +
            '><time datetime="' +
            esc(n.at) +
            '">' +
            esc(whenText(n.at, now)) +
            '</time> <span class="ib-what">' +
            (n.go
              ? '<a href="#' + esc(n.go) + '" data-me-go="' + esc(n.go) + '">' + body + '</a>'
              : body) +
            (fresh ? ' <span class="ib-new">' + esc(TEXT.fresh) + '</span>' : '') +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  /** 글이 바뀔 때만 다시 그린다 (누른 단추의 초점을 지키게) */
  function render() {
    var box = $('meInbox');
    if (!box) return;
    if (!I.ready) {
      if (!box.hidden) box.hidden = true;
      return;
    }
    var now = Date.now();
    var todo = agendaHtml(now);
    var hasNews = I.data !== null;
    // 서버 길(할 일 · 일정)을 다 못 읽고 프로젝트마다의 할 일도 없으면 칸을 감춘다 (가짜 「없음」을 그리지 않는다)
    if (!hasNews && !I.sched && !todo.total) {
      box.hidden = true;
      box.innerHTML = '';
      I.html = null;
      return;
    }
    var html =
      '<h3 class="me-pt-sub" id="meInboxTitle">' +
      esc(TEXT.title) +
      '</h3>' +
      todo.html +
      (hasNews
        ? '<div class="ib-head"><b>' +
          esc(TEXT.news) +
          '</b> <small>' +
          esc(TEXT.newsNote) +
          '</small></div>' +
          newsHtml(now)
        : '');
    if (I.html !== html) {
      I.html = html;
      box.innerHTML = html;
      var Shell = window.SeganShell || {};
      if (Shell.applyLinkTarget)
        box.querySelectorAll('a[data-desktop-tab]').forEach(function (a) {
          Shell.applyLinkTarget(a);
        });
    }
    box.hidden = false;
    // 가장 새 소식의 때를 적어 둔다 — 다음에 열면 그 뒤에 생긴 것만 「새」
    var newest = newsOf(I.data)[0];
    if (newest && !box.classList.contains('me-off')) markSeen(newest.at);
  }

  /** 본 때를 적는다 — 서버가 기억하면 서버에(같은 값은 한 번만), 아니면 이 기기에 */
  function markSeen(at) {
    if (!I.server) {
      writeSeen(at);
      return;
    }
    if (!at || I.sent === at || (I.seenAt && at <= I.seenAt)) return;
    I.sent = at;
    postSeen(at);
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    var PP = window.SeganPartnerProjects;
    if (!el || el.disabled) return;
    var act = el.getAttribute('data-act');
    // 기간 — 오늘 · 주간 · 월간 (이 기기가 기억한다)
    if (act === 'range') {
      var r = el.getAttribute('data-range');
      if (RANGES.indexOf(r) < 0 || r === I.range) return;
      I.range = r;
      I.msg = '';
      writeRange(r);
      render();
      return;
    }
    // 달력 일정의 「작업 배정」 — 프로젝트 관리 화면의 목록에서 그 프로젝트 칸을 연다 (달력과 같다). 목록에 없으면 그 글만
    if (act === 'work') {
      var opened = !!PP && typeof PP.openWork === 'function' && PP.openWork(el.getAttribute('data-project') || '');
      var was = I.msg;
      I.msg = opened ? '' : TEXT.workGone;
      if (I.msg !== was) render();
      return;
    }
    if (!PP || typeof PP.runNext !== 'function') return;
    if (act === 'next-sheet' || act === 'next-order')
      PP.runNext(act, el.getAttribute('data-id') || '');
    // 보류를 다시 볼 날 — 프로젝트 목록의 그 줄에서 「다시 진행 · 그만둠」 칸을 연다
    if (act === 'status' && typeof PP.openStatus === 'function')
      PP.openStatus(el.getAttribute('data-for') || '');
    // 실측 — 「실측 일정 잡기」는 프로젝트 목록의 그 줄에서 실측 칸을 열고, 「실측 완료 처리」는 그 자리에서 끝낸다
    if (act === 'visit' && typeof PP.openVisit === 'function')
      PP.openVisit(el.getAttribute('data-for') || '');
    if (act === 'next-visit-done') PP.runNext(act, el.getAttribute('data-for') || '');
    var Sheet = window.SeganProjectSheet;
    if (act === 'project' && Sheet && typeof Sheet.open === 'function')
      Sheet.open(el.getAttribute('data-id') || '');
  }

  // ── 읽기 ───────────────────────────────────────────────
  async function token() {
    try {
      var r = I.sb && (await I.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return I.session ? I.session.access_token : '';
  }

  async function read() {
    var res;
    try {
      res = await fetch(I.base + '/company/inbox', {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
    } catch {
      return null;
    }
    var b = null;
    try {
      b = await res.json();
    } catch {
      b = null;
    }
    b = b && typeof b === 'object' ? b : {};
    if (!res.ok || b.success !== true || !b.data || typeof b.data !== 'object') return null;
    return b.data;
  }

  /**
   * 달력 일정 — GET /company/schedules 오늘 ~ (이번 주 일요일 · 이번 달 말일 가운데 늦은 날).
   * 달력 파일(segan/calendar.js)이 없거나 못 읽으면(403 · 끊김 · 모양이 틀림) null — 할 일만 그린다
   */
  async function readSched() {
    var Cal = window.SeganCalendar;
    if (!Cal || typeof Cal.dataOf !== 'function') return null;
    var today = kstToday(Date.now());
    var a = rangeEnd('week', today);
    var b = rangeEnd('month', today);
    var to = a > b ? a : b;
    try {
      var res = await fetch(
        I.base + '/company/schedules?from=' + today + '&to=' + to,
        { headers: { Authorization: 'Bearer ' + (await token()) }, cache: 'no-store' }
      );
      if (!res.ok) return null;
      return Cal.dataOf(await res.json());
    } catch {
      return null;
    }
  }

  /** POST /company/inbox/seen — 실패해도 조용히 (다음에 다시 「새」로 보일 뿐이다) */
  async function postSeen(at) {
    try {
      await fetch(I.base + '/company/inbox/seen', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (await token()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ at: at }),
        cache: 'no-store',
      });
    } catch {
      /* 다음에 다시 보낸다 */
    }
  }

  /** 다시 읽고 그린다 — 할 일을 끝낸 뒤 (묶음의 수가 바뀐다) · 달력에서 일정을 넣거나 고친 뒤 */
  async function refresh() {
    if (!I.ready || !I.base) return;
    var both = await Promise.all([read(), readSched()]);
    if (both[0]) I.data = both[0];
    if (both[1]) I.sched = both[1];
    render();
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 볼 사람이 아니면 칸을 감춘 채 둔다 */
  async function load(sb, session, me) {
    var box = $('meInbox');
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    var PP = window.SeganPartnerProjects;
    I.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    I.sb = sb || null;
    I.session = session || null;
    I.me = me || null;
    I.data = null;
    I.sched = null;
    I.msg = '';
    I.html = null;
    I.ready = !!(
      box &&
      I.base &&
      session &&
      PP &&
      typeof PP.canSee === 'function' &&
      PP.canSee(me)
    );
    if (box) {
      box.hidden = true;
      box.innerHTML = '';
    }
    if (!I.ready) return;
    I.server = false;
    I.sent = '';
    if (!box.getAttribute('data-bound')) {
      box.setAttribute('data-bound', '1');
      box.addEventListener('click', onClick);
    }
    I.range = readRange();
    var both = await Promise.all([read(), readSched()]);
    I.data = both[0];
    I.sched = both[1];
    // 「새」의 기준 — 서버가 계정마다 기억하면 그 값(없으면 처음 본 것), 아니면 이 기기의 값
    I.server = !!I.data && Object.prototype.hasOwnProperty.call(I.data, 'seen_at');
    I.seenAt = I.server ? (typeof I.data.seen_at === 'string' ? I.data.seen_at : '') : readSeen();
    render();
  }

  window.SeganInbox = {
    TEXT: TEXT,
    PROJECT_MAX: PROJECT_MAX,
    state: I,
    dueText: dueText,
    sinceText: sinceText,
    whenText: whenText,
    whoText: whoText,
    todoOf: todoOf,
    newsOf: newsOf,
    projectTodos: projectTodos,
    rangeEnd: rangeEnd,
    schedulesFrom: schedulesFrom,
    groupRows: groupRows,
    render: render,
    refresh: refresh,
    load: load,
  };
})();
