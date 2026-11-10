/* ============================================================
   segan/calendar.js — 「프로젝트 관리」 대시보드의 업무 달력 (segan/me.html #meCalendar)

   누가 보나  다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원 (segan/partner-projects.js canSee 와 같다).
             고객 · 업체 없는 회원에게는 묻지도 않고 칸이 없다. 서버가 403 이면 칸째 감춘다.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganCalendar.load(sb, session, partnerMe) 를 부르고,
             프로젝트 관리 대시보드(#dash-project)에서만 이 칸을 보인다 (me-off).
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET   /company/schedules?from=YYYY-MM-DD&to=YYYY-MM-DD   (한국 날짜 · 그날 포함 · 길어야 100일)
                     → { company, can_manage, range, today, truncated,
                         items[{ key, source: schedule | consult | payment | design_due | as, id,
                                 kind: sales | design | make | install | as,
                                 type, label, day, at, time, title, status, location, design { id, name } | null,
                                 order_no, amount, project { id, title } | null, duration_min?, assignee_name? }] }
               GET   /company/designs            { items[{ id, name, project_id }] } — 「일정 더하기」의 설계 고르기
               POST  /designs/:id/schedules      { items: [{ type, scheduled_at, title? }] }   (대표 · 실장)
               PATCH /schedules/:id              { scheduled_at?, status? }                    (대표 · 실장)
   화면      월 · 주 · 목록 보기, ‹ 오늘 › 로 옮기기, 종류(영업 · 설계 · 생산 · 설치 · A/S) 켜고 끄기.
             월 · 주는 날을 누르면 아래 「그날 일정」 칸에 줄이 나온다. 목록은 그 달의 일정 있는 날만 차례로.
             줄마다 시각 · 종류 · 이름 · 프로젝트 · 설계 · 지역 · 수주 번호 · (받을 날은 금액) · 담당 · 상태,
             「열기」 = 그 일의 하위 화면(상담 · 계약 · 설계 · 생산 · 설치 · A/S), 일정 표의 줄은 대표 · 실장에게 「고치기」(날 · 시각 · 상태).
             「일정 더하기」(대표 · 실장) — 설계 · 종류 · 날 · 시각 · 이름. 일정은 설계에 붙는다 (설계 없는 프로젝트에는 못 넣는다).
             영업 일정(상담 희망일 · 실측 · 받을 날)과 A/S 접수는 서버가 자료에서 찾아 준다 — 여기서 넣지 않는다.
             설계 마감 = 계약금 입금날 당일 (2026-11-10 대표님 결정) — 서버가 수주의 계약금에서 찾아 준다.
             받았으면 받은 날에 「계약금 입금」, 아직이면 계약금 받을 날에 「입금 예정」. 금액은 오지 않는다 (구성원 모두 본다).
   색        종류 다섯 — 영업 #2f6fb0 · 설계 #8a7ff4 · 생산 #c96a2b · 설치 #1f9a86 · A/S #9b3b3b (흰 바탕, 모든 짝 색각 검사 통과).
             색만으로 가리지 않는다: 종류 단추 · 줄에는 이름을 적고, 폰 월 달력의 네모는 종류마다 자리가 정해져 있다.
   움직임    없다 — 달 넘기기 · 날 고르기는 자주 누르는 곳이다 (CLAUDE.md 「SEGAN 앱 모션 규칙」).
   못 읽으면  처음(403 · 404 · 오류 · 끊김 · 모양이 틀림) → 칸째 감춘다. 달을 옮기다 못 읽으면 그 자리에 글 + 「다시 읽기」.
             넣기 · 고치기를 못 하면 서버 글을 그 자리에.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var MEMBER_ROLES = ['owner', 'manager', 'staff'];
  var PLANS = ['manager', 'expert', 'agent']; // 프로젝트를 가지는 협력업체 — segan/partner-projects.js PLANS
  var KINDS = ['sales', 'design', 'make', 'install', 'as']; // 워커 SCHEDULE_KINDS — 이 차례가 네모 자리 · 종류 단추 차례
  var KIND_LABEL = { sales: '영업', design: '설계', make: '생산', install: '설치', as: 'A/S' };
  var VIEWS = ['month', 'week', 'list'];
  var VIEW_LABEL = { month: '월', week: '주', list: '목록' };
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  // 넣을 수 있는 일정 — 워커 SCHEDULE_LABELS (src/slack.js) 와 같다
  var SCHEDULE_TYPES = [
    ['measurement', '실측'],
    ['material_order', '자재 발주'],
    ['manufacturing_start', '제작 착수'],
    ['manufacturing_end', '제작 완료'],
    ['quality_check', '검수'],
    ['delivery', '납품'],
    ['installation', '설치'],
    ['as_visit', 'A/S 방문'],
  ];
  // 일정 표 상태 — 워커 SCHEDULE_STATUSES
  var SCHEDULE_STATUS = {
    scheduled: '예정',
    confirmed: '확정',
    in_progress: '진행 중',
    completed: '끝남',
    cancelled: '취소',
  };
  var AS_STATE = { requested: '접수', received: '받음', done: '끝' }; // segan/as-requests.js 와 같다
  // 설계 마감(계약금 입금날) — 받은 날이면 굳은 날, 받을 날이면 아직 예정
  var DESIGN_DUE_STATE = { deposit_paid: '계약금 입금', deposit_due: '입금 예정' };
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DAY_MS = 24 * 3600 * 1000;
  var KST_MS = 9 * 3600 * 1000;
  var TITLE_MAX = 200; // 워커 schedules.js toRow
  var CELL_CHIPS = 3; // 월 달력 한 칸에 적는 줄 수 (넘으면 +N)
  var DEFAULT_TIME = '09:00';

  var TEXT = {
    loading: '읽는 중입니다.',
    loadErr: '일정을 읽지 못했습니다.',
    truncated: '일정이 많아 일부만 보입니다. 주 보기로 좁혀 보세요.',
    dayEmpty: '이날 일정이 없습니다.',
    listEmpty: '이 달 일정이 없습니다.',
    noDesign: '일정은 설계에 붙습니다. 먼저 플래너에서 프로젝트의 설계를 저장해 주세요.',
    designErr: '설계 목록을 읽지 못했습니다.',
    pickDesign: '설계를 골라 주세요.',
    pickType: '일정 종류를 골라 주세요.',
    dateBad: '날짜를 골라 주세요.',
    timeBad: '시각을 골라 주세요.',
    titleLong: '이름은 ' + TITLE_MAX + '자까지 적을 수 있습니다.',
    added: '일정을 넣었습니다.',
    edited: '일정을 고쳤습니다.',
    noProject: '프로젝트 없는 설계',
    noName: '이름 없는 설계',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var C = {
    sb: null,
    session: null,
    base: '', // workflow-api
    me: null,
    view: 'month',
    cursor: '', // 지금 보는 달 · 주 안의 한 날 (YYYY-MM-DD, 한국 날짜)
    sel: '', // 고른 날
    kinds: { sales: true, design: true, make: true, install: true, as: true },
    data: null, // { manage, today, truncated, items } — 지금 기간
    cache: {}, // 'from~to' → data
    seq: 0, // 늦게 온 응답 버리기
    loading: false,
    loadErr: '',
    form: null, // null | { mode: 'add' } | { mode: 'edit', id }
    designs: null, // 「일정 더하기」의 설계 — null = 아직 안 읽음 · [] = 없음
    designErr: '',
    err: '',
    msg: '',
    busy: false,
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

  // ── 날짜 (순수 함수 — 시험이 직접 부른다. 날은 모두 'YYYY-MM-DD' 한국 날짜) ─────────
  function isDay(v) {
    return typeof v === 'string' && DAY_RE.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z'));
  }

  /** 지금의 한국 날짜 */
  function kstToday(nowMs) {
    return new Date((nowMs == null ? Date.now() : nowMs) + KST_MS).toISOString().slice(0, 10);
  }

  function addDays(day, n) {
    return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
  }

  /** 요일 — 0 = 일 … 6 = 토 */
  function weekdayOf(day) {
    return new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay();
  }

  /** 그 주의 일요일 */
  function weekStart(day) {
    return addDays(day, -weekdayOf(day));
  }

  /** 월 달력 여섯 주 — 그 달 1일이 든 주의 일요일부터 42일 */
  function monthGrid(day) {
    var first = weekStart(day.slice(0, 8) + '01');
    var out = [];
    for (var i = 0; i < 42; i++) out.push(addDays(first, i));
    return out;
  }

  function weekDays(day) {
    var first = weekStart(day);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(first, i));
    return out;
  }

  /** 서버에 물을 기간 — 월 · 목록은 여섯 주(같은 응답을 쓴다), 주는 7일 */
  function rangeOf(view, cursor) {
    var days = view === 'week' ? weekDays(cursor) : monthGrid(cursor);
    return { from: days[0], to: days[days.length - 1] };
  }

  /** ‹ › — 월 · 목록은 앞뒤 달의 1일, 주는 7일 */
  function moveCursor(view, cursor, dir) {
    if (view === 'week') return addDays(cursor, dir < 0 ? -7 : 7);
    var y = Number(cursor.slice(0, 4));
    var m = Number(cursor.slice(5, 7)) - 1 + (dir < 0 ? -1 : 1);
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }

  /** 'M월 D일' */
  function dayText(day) {
    return Number(day.slice(5, 7)) + '월 ' + Number(day.slice(8, 10)) + '일';
  }

  /** 'M월 D일 (요일)' */
  function dayTitle(day) {
    return dayText(day) + ' (' + WEEKDAYS[weekdayOf(day)] + ')';
  }

  /** 머리글 — 월 · 목록 '2026년 11월', 주 '2026년 11월 8일 ~ 11월 14일' */
  function titleOf(view, cursor) {
    var y = Number(cursor.slice(0, 4));
    if (view !== 'week') return y + '년 ' + Number(cursor.slice(5, 7)) + '월';
    var days = weekDays(cursor);
    return Number(days[0].slice(0, 4)) + '년 ' + dayText(days[0]) + ' ~ ' + dayText(days[6]);
  }

  /** 날 + 시각(한국 시간) → 서버에 보낼 시각 */
  function scheduledAtOf(date, time) {
    return date + 'T' + time + ':00+09:00';
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  /** 달력 칸을 보이나 — segan/partner-projects.js canSee 와 같다 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    return !!(
      c &&
      typeof c === 'object' &&
      PLANS.indexOf(c.plan) >= 0 &&
      MEMBER_ROLES.indexOf(c.role) >= 0
    );
  }

  /** GET /company/schedules 본문 → { manage, today, truncated, items } | null (모양이 맞는 줄만) */
  function dataOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.items)) return null;
    return {
      manage: d.can_manage === true,
      today: isDay(d.today) ? d.today : '',
      truncated: d.truncated === true,
      items: d.items.filter(function (x) {
        return (
          x &&
          typeof x === 'object' &&
          typeof x.key === 'string' &&
          x.key &&
          KINDS.indexOf(x.kind) >= 0 &&
          isDay(x.day)
        );
      }),
    };
  }

  /** 한 날 안의 차례 — 시각 차례 (시각 없는 줄이 먼저), 같은 시각은 종류 차례 */
  function sortDay(items) {
    return items.slice().sort(function (a, b) {
      var ta = TIME_RE.test(String(a.time || '')) ? a.time : '';
      var tb = TIME_RE.test(String(b.time || '')) ? b.time : '';
      if (ta !== tb) return ta < tb ? -1 : 1;
      return KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
    });
  }

  /** 날 → 그날 줄 (켠 종류만) */
  function byDay(items, kinds) {
    var map = {};
    (items || []).forEach(function (x) {
      if (kinds && !kinds[x.kind]) return;
      (map[x.day] = map[x.day] || []).push(x);
    });
    Object.keys(map).forEach(function (day) {
      map[day] = sortDay(map[day]);
    });
    return map;
  }

  /** 종류마다 줄 수 — 그 날들 안에서 (끈 종류도 센다) */
  function countKinds(items, days) {
    var inDays = {};
    days.forEach(function (d) {
      inDays[d] = true;
    });
    var n = { sales: 0, design: 0, make: 0, install: 0, as: 0 };
    (items || []).forEach(function (x) {
      if (inDays[x.day]) n[x.kind] += 1;
    });
    return n;
  }

  /** 「열기」가 가는 하위 화면 (segan/me.js 화면 이름) — 상담 희망일 · 실측 = 상담, 받을 날 = 계약, 설계 마감 = 설계 */
  function openOf(x) {
    if (!x || typeof x !== 'object') return '';
    if (x.source === 'payment') return 'p-contract';
    if (x.kind === 'sales') return 'p-consult';
    if (x.kind === 'design') return 'p-design';
    if (x.kind === 'make') return 'p-make';
    if (x.kind === 'install') return 'p-install';
    if (x.kind === 'as') return 'p-as';
    return '';
  }

  /** 상태 글 — 일정 표 · A/S 접수 · 설계 마감 (상담 상태 · 받을 날은 적지 않는다) */
  function statusOf(x) {
    if (x.source === 'schedule') return SCHEDULE_STATUS[x.status] || '';
    if (x.source === 'as') return AS_STATE[x.status] || '';
    if (x.source === 'design_due') return DESIGN_DUE_STATE[x.status] || '';
    return '';
  }

  /** 시각 글 — 'HH:MM' 이거나 상담의 희망 시간대 글 */
  function timeText(x) {
    return typeof x.time === 'string' ? x.time.trim() : '';
  }

  /** 줄의 둘째 줄 — 이름 · 프로젝트 · 설계 · 지역 · 수주 번호 · 금액 · 담당 (있는 것만) */
  function detailOf(x) {
    var out = [];
    if (x.title && x.title !== x.label) out.push(String(x.title));
    if (x.project && x.project.title) out.push(String(x.project.title));
    if (x.design && x.design.name) out.push('설계 ' + x.design.name);
    if (x.location) out.push(String(x.location));
    if (x.order_no) out.push('수주 ' + x.order_no);
    if (x.source === 'payment' && Number(x.amount) > 0)
      out.push(Number(x.amount).toLocaleString('ko-KR') + '원');
    if (x.assignee_name) out.push('담당 ' + x.assignee_name);
    return out.join(' · ');
  }

  /** GET /company/designs 본문 → [{ id, name, project_id }] | null */
  function designsOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return d.items
      .filter(function (x) {
        return x && typeof x === 'object' && UUID_RE.test(String(x.id || ''));
      })
      .map(function (x) {
        return {
          id: x.id,
          name: typeof x.name === 'string' ? x.name : '',
          project_id: typeof x.project_id === 'string' ? x.project_id : '',
        };
      });
  }

  /** 설계를 프로젝트로 묶는다 — [{ title, designs }] (프로젝트 없는 설계는 맨 뒤 한 묶음) */
  function designGroups(designs, projects) {
    var titleOfProject = {};
    (projects || []).forEach(function (p) {
      if (p && p.id) titleOfProject[p.id] = String(p.title || '');
    });
    var groups = [];
    var at = {};
    var rest = [];
    (designs || []).forEach(function (d) {
      var t = d.project_id ? titleOfProject[d.project_id] : '';
      if (!t) return rest.push(d);
      if (at[d.project_id] == null) {
        at[d.project_id] = groups.length;
        groups.push({ title: t, designs: [] });
      }
      groups[at[d.project_id]].designs.push(d);
    });
    if (rest.length) groups.push({ title: TEXT.noProject, designs: rest });
    return groups;
  }

  /**
   * 「일정 더하기」 칸 값 → { designId, body } | { error, field } (서버와 같은 검사)
   * v = { design_id, type, date, time, title }
   */
  function addBodyOf(v) {
    var designId = String(v.design_id || '');
    if (!UUID_RE.test(designId)) return { error: TEXT.pickDesign, field: 'design_id' };
    var type = String(v.type || '');
    var known = SCHEDULE_TYPES.some(function (t) {
      return t[0] === type;
    });
    if (!known) return { error: TEXT.pickType, field: 'type' };
    if (!isDay(v.date)) return { error: TEXT.dateBad, field: 'date' };
    if (!TIME_RE.test(String(v.time || ''))) return { error: TEXT.timeBad, field: 'time' };
    var title = String(v.title || '').trim();
    if (title.length > TITLE_MAX) return { error: TEXT.titleLong, field: 'title' };
    var item = { type: type, scheduled_at: scheduledAtOf(v.date, v.time) };
    if (title) item.title = title;
    return { designId: designId, body: { items: [item] } };
  }

  /**
   * 「고치기」 칸 값 → { body } (바뀐 것만 — 없으면 body null) | { error, field }
   * x = 지금 줄, v = { date, time, status }
   */
  function editBodyOf(x, v) {
    if (!isDay(v.date)) return { error: TEXT.dateBad, field: 'date' };
    if (!TIME_RE.test(String(v.time || ''))) return { error: TEXT.timeBad, field: 'time' };
    if (!SCHEDULE_STATUS[v.status]) return { error: TEXT.generic, field: 'status' };
    var body = {};
    if (v.date !== x.day || v.time !== x.time) body.scheduled_at = scheduledAtOf(v.date, v.time);
    if (v.status !== x.status) body.status = v.status;
    return { body: Object.keys(body).length ? body : null };
  }

  // ── 그리기 ─────────────────────────────────────────────
  function swatch(kind) {
    return '<i class="cal-sw cal-sw--' + kind + '" aria-hidden="true"></i>';
  }

  /** 하위 화면을 열 수 있나 — 그 사람 메뉴에 있고 준비 중이 아닐 때 (segan/me.js) */
  function canOpen(name) {
    var Me = window.SeganMe;
    if (!name || !Me || !Me.defOf || !Me.available) return false;
    var s = Me.defOf(name);
    return !!s && !s.soon && Me.available(name);
  }

  function itemHtml(x) {
    var manage = !!(C.data && C.data.manage);
    var status = statusOf(x);
    var time = timeText(x);
    var detail = detailOf(x);
    var go = openOf(x);
    var editing = C.form && C.form.mode === 'edit' && C.form.id === x.id;
    return (
      '<li class="cal-item' +
      (x.status === 'cancelled' ? ' cal-item--off' : '') +
      '" data-key="' +
      esc(x.key) +
      '">' +
      '<div class="cal-item-line">' +
      swatch(x.kind) +
      '<div class="cal-item-main"><b>' +
      (time ? '<span class="cal-item-time">' + esc(time) + '</span> ' : '') +
      esc(x.label || KIND_LABEL[x.kind]) +
      '</b><small>' +
      esc([KIND_LABEL[x.kind], detail].filter(Boolean).join(' · ')) +
      '</small></div>' +
      (status ? '<span class="me-badge">' + esc(status) + '</span>' : '') +
      '</div>' +
      '<div class="cal-item-acts">' +
      (canOpen(go)
        ? '<a class="cal-link" href="#' + go + '" data-me-go="' + go + '">열기</a>'
        : '') +
      (manage && x.source === 'schedule' && !editing
        ? '<button type="button" class="cal-link" data-act="edit" data-id="' +
          esc(x.id) +
          '" data-fk="edit:' +
          esc(x.id) +
          '">고치기</button>'
        : '') +
      '</div>' +
      (editing ? editFormHtml(x) : '') +
      '</li>'
    );
  }

  function errHtml() {
    return (
      '<p class="mk-error" data-err role="alert"' +
      (C.err ? '' : ' hidden') +
      '>' +
      esc(C.err) +
      '</p>'
    );
  }

  function actsHtml(submitLabel) {
    var off = C.busy ? ' disabled' : '';
    return (
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid"' +
      off +
      '>' +
      submitLabel +
      '</button><button type="button" class="mk-btn" data-act="close"' +
      off +
      '>닫기</button></div>'
    );
  }

  function editFormHtml(x) {
    return (
      '<form class="me-pt-form cal-form" data-form="edit" novalidate>' +
      '<div class="cal-form-row">' +
      '<label class="mk-input"><span>날짜</span><input name="date" type="date" value="' +
      esc(x.day) +
      '" /></label>' +
      '<label class="mk-input"><span>시각</span><input name="time" type="time" value="' +
      esc(TIME_RE.test(String(x.time || '')) ? x.time : DEFAULT_TIME) +
      '" /></label>' +
      '</div>' +
      '<label class="mk-input"><span>상태</span><select name="status">' +
      Object.keys(SCHEDULE_STATUS)
        .map(function (k) {
          return (
            '<option value="' +
            k +
            '"' +
            (k === x.status ? ' selected' : '') +
            '>' +
            SCHEDULE_STATUS[k] +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      errHtml() +
      actsHtml('고치기') +
      '</form>'
    );
  }

  /** 프로젝트 칸이 읽어 둔 프로젝트 (이름 붙이기) — 없으면 빈 목록 */
  function projectsNow() {
    var P = window.SeganPartnerProjects;
    var d = P && P.state ? P.state.data : null;
    return d && Array.isArray(d.items) ? d.items : [];
  }

  function addFormHtml() {
    if (C.designs === null)
      return (
        '<div class="me-pt-form cal-form"><p class="mk-note" role="status">' +
        esc(C.designErr || TEXT.loading) +
        '</p><div class="rd-acts"><button type="button" class="mk-btn" data-act="close">닫기</button></div></div>'
      );
    if (!C.designs.length)
      return (
        '<div class="me-pt-form cal-form"><p class="mk-note">' +
        esc(TEXT.noDesign) +
        '</p><div class="rd-acts"><button type="button" class="mk-btn" data-act="close">닫기</button></div></div>'
      );
    return (
      '<form class="me-pt-form cal-form" data-form="add" novalidate>' +
      '<label class="mk-input"><span>설계</span><select name="design_id"><option value="">설계 고르기</option>' +
      designGroups(C.designs, projectsNow())
        .map(function (g) {
          return (
            '<optgroup label="' +
            esc(g.title) +
            '">' +
            g.designs
              .map(function (d) {
                return (
                  '<option value="' + esc(d.id) + '">' + esc(d.name || TEXT.noName) + '</option>'
                );
              })
              .join('') +
            '</optgroup>'
          );
        })
        .join('') +
      '</select></label>' +
      '<label class="mk-input"><span>종류</span><select name="type">' +
      SCHEDULE_TYPES.map(function (t) {
        return '<option value="' + t[0] + '">' + t[1] + '</option>';
      }).join('') +
      '</select></label>' +
      '<div class="cal-form-row">' +
      '<label class="mk-input"><span>날짜</span><input name="date" type="date" value="' +
      esc(C.sel || C.cursor) +
      '" /></label>' +
      '<label class="mk-input"><span>시각</span><input name="time" type="time" value="' +
      DEFAULT_TIME +
      '" /></label>' +
      '</div>' +
      '<label class="mk-input"><span>이름 (비우면 종류 이름)</span><input name="title" type="text" maxlength="' +
      TITLE_MAX +
      '" autocomplete="off" /></label>' +
      errHtml() +
      actsHtml('넣기') +
      '</form>'
    );
  }

  /** 월 · 주 달력의 한 날 (단추) — full = 주 보기 (줄을 모두, 시각과 함께) */
  function dayCellHtml(day, items, o) {
    var today = day === o.today;
    var out = !o.full && day.slice(0, 7) !== o.month;
    var has = {};
    items.forEach(function (x) {
      has[x.kind] = true;
    });
    var shown = o.full ? items : items.slice(0, CELL_CHIPS);
    var label =
      dayText(day) +
      ' ' +
      WEEKDAYS[weekdayOf(day)] +
      '요일' +
      (today ? ', 오늘' : '') +
      (items.length ? ', 일정 ' + items.length + '건' : ', 일정 없음');
    return (
      '<button type="button" class="cal-day' +
      (out ? ' cal-day--out' : '') +
      '" data-act="day" data-day="' +
      day +
      '" data-fk="day:' +
      day +
      '" aria-pressed="' +
      (day === C.sel ? 'true' : 'false') +
      '"' +
      (today ? ' aria-current="date"' : '') +
      ' aria-label="' +
      esc(label) +
      '">' +
      '<span class="cal-d">' +
      (o.full ? WEEKDAYS[weekdayOf(day)] + ' ' : '') +
      Number(day.slice(8, 10)) +
      '</span>' +
      // 폰 월 달력 — 종류마다 정해진 자리의 네모 (없는 종류는 빈 자리)
      (o.full
        ? ''
        : '<span class="cal-dots" aria-hidden="true">' +
          KINDS.map(function (k) {
            return '<i class="cal-sw cal-sw--' + (has[k] ? k : 'none') + '"></i>';
          }).join('') +
          '</span>') +
      '<span class="cal-chips" aria-hidden="true">' +
      shown
        .map(function (x) {
          var time = o.full && TIME_RE.test(String(x.time || '')) ? x.time + ' ' : '';
          return (
            '<span class="cal-chip' +
            (x.status === 'cancelled' ? ' cal-chip--off' : '') +
            '">' +
            swatch(x.kind) +
            '<span>' +
            esc(time + (x.label || KIND_LABEL[x.kind])) +
            '</span></span>'
          );
        })
        .join('') +
      (items.length > shown.length
        ? '<span class="cal-more">+' + (items.length - shown.length) + '</span>'
        : '') +
      '</span>' +
      '</button>'
    );
  }

  function gridHtml(days, map, o) {
    return (
      '<div class="cal-grid' +
      (o.full ? ' cal-grid--week' : '') +
      '">' +
      (o.full
        ? ''
        : WEEKDAYS.map(function (w) {
            return '<span class="cal-wd" aria-hidden="true">' + w + '</span>';
          }).join('')) +
      days
        .map(function (day) {
          return dayCellHtml(day, map[day] || [], o);
        })
        .join('') +
      '</div>'
    );
  }

  function itemsHtml(items) {
    return '<ul class="cal-items">' + items.map(itemHtml).join('') + '</ul>';
  }

  /** 그날 일정 칸 (월 · 주) */
  function panelHtml(map) {
    var items = map[C.sel] || [];
    return (
      '<div class="cal-panel">' +
      '<h4 class="cal-panel-title">' +
      esc(dayTitle(C.sel)) +
      (C.data && C.sel === C.data.today ? ' · 오늘' : '') +
      '</h4>' +
      (items.length ? itemsHtml(items) : '<p class="me-empty">' + esc(TEXT.dayEmpty) + '</p>') +
      '</div>'
    );
  }

  /** 목록 — 그 달의 일정 있는 날만 차례로 */
  function listHtml(map) {
    var month = C.cursor.slice(0, 7);
    var days = Object.keys(map)
      .filter(function (day) {
        return day.slice(0, 7) === month;
      })
      .sort();
    if (!days.length) return '<p class="me-empty">' + esc(TEXT.listEmpty) + '</p>';
    return (
      '<div class="cal-list">' +
      days
        .map(function (day) {
          return (
            '<div class="cal-panel"><h4 class="cal-panel-title">' +
            esc(dayTitle(day)) +
            (C.data && day === C.data.today ? ' · 오늘' : '') +
            '</h4>' +
            itemsHtml(map[day]) +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function headHtml(counts) {
    var step = C.view === 'week' ? '주' : '달';
    return (
      '<p class="me-pt-sub">업무 달력</p>' +
      '<div class="cal-head">' +
      '<h3 class="cal-title" id="meCalendarTitle">' +
      esc(titleOf(C.view, C.cursor)) +
      '</h3>' +
      '<div class="cal-nav">' +
      '<button type="button" class="cal-btn" data-act="prev" data-fk="act:prev" aria-label="이전 ' +
      step +
      '">‹</button>' +
      '<button type="button" class="cal-btn" data-act="today" data-fk="act:today">오늘</button>' +
      '<button type="button" class="cal-btn" data-act="next" data-fk="act:next" aria-label="다음 ' +
      step +
      '">›</button>' +
      '</div>' +
      '<div class="cal-views" role="group" aria-label="보기">' +
      VIEWS.map(function (v) {
        return (
          '<button type="button" class="cal-btn" data-act="view" data-view="' +
          v +
          '" data-fk="view:' +
          v +
          '" aria-pressed="' +
          (C.view === v ? 'true' : 'false') +
          '">' +
          VIEW_LABEL[v] +
          '</button>'
        );
      }).join('') +
      '</div>' +
      '</div>' +
      '<div class="cal-kinds" role="group" aria-label="종류">' +
      KINDS.map(function (k) {
        return (
          '<button type="button" class="cal-kind" data-act="kind" data-kind="' +
          k +
          '" data-fk="kind:' +
          k +
          '" aria-pressed="' +
          (C.kinds[k] ? 'true' : 'false') +
          '">' +
          swatch(k) +
          '<span>' +
          KIND_LABEL[k] +
          '</span><span class="cal-kind-n">' +
          counts[k] +
          '</span></button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function render() {
    var box = $('meCalendar');
    if (!box || !C.data) return;
    var d = C.data;
    var days = C.view === 'week' ? weekDays(C.cursor) : monthGrid(C.cursor);
    var map = byDay(d.items, C.kinds);
    var o = { today: d.today, month: C.cursor.slice(0, 7), full: C.view === 'week' };
    var active = document.activeElement;
    var fk = active && box.contains(active) ? active.getAttribute('data-fk') : '';
    box.setAttribute('aria-busy', C.loading ? 'true' : 'false');
    box.innerHTML =
      headHtml(countKinds(d.items, days)) +
      (C.loading
        ? '<p class="mk-note cal-state" role="status">' + esc(TEXT.loading) + '</p>'
        : C.loadErr
          ? '<p class="mk-error cal-state" role="alert">' +
            esc(C.loadErr) +
            ' <button type="button" class="cal-link" data-act="retry" data-fk="act:retry">다시 읽기</button></p>'
          : d.truncated
            ? '<p class="mk-note cal-state">' + esc(TEXT.truncated) + '</p>'
            : '') +
      (C.msg ? '<p class="me-pt-msg" role="status">' + esc(C.msg) + '</p>' : '') +
      (C.view === 'list' ? listHtml(map) : gridHtml(days, map, o) + panelHtml(map)) +
      (d.manage
        ? C.form && C.form.mode === 'add'
          ? addFormHtml()
          : '<div class="rd-acts"><button type="button" class="mk-btn" data-act="add" data-fk="act:add">일정 더하기</button></div>'
        : '');
    box.hidden = false;
    if (fk) {
      var again = box.querySelector('[data-fk="' + fk + '"]');
      if (again && again.focus) again.focus();
    }
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

  async function call(method, path, body) {
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(C.base + path, {
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

  /** 지금 기간을 읽는다 (읽어 둔 기간이면 그대로) → { manage, today, truncated, items } | null */
  async function fetchRange() {
    var r = rangeOf(C.view, C.cursor);
    var key = r.from + '~' + r.to;
    if (C.cache[key]) return C.cache[key];
    var res = await call('GET', '/company/schedules?from=' + r.from + '&to=' + r.to);
    var d = res.ok ? dataOf(res.body) : null;
    if (d) C.cache[key] = d;
    return d;
  }

  /** 달 · 주 · 보기를 바꾼 뒤 — 늦게 온 응답은 버린다. 못 읽으면 그 자리에 글 */
  async function refresh() {
    var seq = ++C.seq;
    var r = rangeOf(C.view, C.cursor);
    var hit = C.cache[r.from + '~' + r.to];
    if (hit) {
      C.data = hit;
      C.loading = false;
      C.loadErr = '';
      render();
      return true;
    }
    C.loading = true;
    C.loadErr = '';
    render();
    var d = await fetchRange();
    if (seq !== C.seq) return false;
    C.loading = false;
    if (d) C.data = d;
    else C.loadErr = TEXT.loadErr;
    render();
    return !!d;
  }

  async function loadDesigns() {
    var r = await call('GET', '/company/designs');
    var list = r.ok ? designsOf(r.body) : null;
    if (!C.form || C.form.mode !== 'add') return;
    if (list) C.designs = list;
    else C.designErr = TEXT.designErr;
    render();
  }

  // ── 고치기 ─────────────────────────────────────────────
  function formOf() {
    var box = $('meCalendar');
    return box ? box.querySelector('form[data-form]') : null;
  }

  function valuesOf(form) {
    var out = {};
    ['design_id', 'type', 'date', 'time', 'title', 'status'].forEach(function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      if (el) out[name] = el.value;
    });
    return out;
  }

  function restore(v) {
    var form = formOf();
    if (!form || !v) return;
    Object.keys(v).forEach(function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      if (el) el.value = v[name];
    });
  }

  function focusField(field) {
    var form = formOf();
    var el = form && field ? form.querySelector('[name="' + field + '"]') : null;
    if (el && el.focus) el.focus();
  }

  function itemOf(id) {
    var items = C.data ? C.data.items : [];
    for (var i = 0; i < items.length; i++)
      if (items[i].source === 'schedule' && items[i].id === id) return items[i];
    return null;
  }

  /** 넣기 · 고치기가 끝난 뒤 — 읽어 둔 기간을 버리고 그날로 가서 다시 읽는다 */
  async function afterWrite(day, msg) {
    C.cache = {};
    C.form = null;
    C.busy = false;
    C.err = '';
    C.msg = msg;
    C.sel = day;
    C.cursor = day;
    await refresh();
    // 납품 · 설치 · A/S 방문 일정이 바뀌었을 수 있다 — 설치 · A/S 지도 + 표도 다시 읽는다 (segan/site-map.js)
    var sites = window.SeganSiteMap;
    if (sites && sites.reload) sites.reload();
  }

  /** 다른 화면(설치 · A/S 표)이 일정을 고친 뒤 — 읽어 둔 기간을 버리고 지금 보는 기간을 다시 읽는다 */
  function reload() {
    C.cache = {};
    return C.data ? refresh() : Promise.resolve(false);
  }

  async function submit(form) {
    if (C.busy || !C.form) return;
    var v = valuesOf(form);
    var edit = C.form.mode === 'edit';
    var x = edit ? itemOf(C.form.id) : null;
    if (edit && !x) return;
    var got = edit ? editBodyOf(x, v) : addBodyOf(v);
    if (got.error) {
      C.err = got.error;
      render();
      restore(v);
      focusField(got.field);
      return;
    }
    if (edit && !got.body) {
      // 바뀐 것이 없다 — 서버에 묻지 않고 닫는다
      C.form = null;
      C.err = '';
      render();
      return;
    }
    C.busy = true;
    C.err = '';
    render();
    restore(v);
    var r = edit
      ? await call('PATCH', '/schedules/' + encodeURIComponent(x.id), got.body)
      : await call('POST', '/designs/' + encodeURIComponent(got.designId) + '/schedules', got.body);
    if (!r.ok) {
      C.busy = false;
      C.err = errText(r);
      render();
      restore(v);
      return;
    }
    await afterWrite(v.date, edit ? TEXT.edited : TEXT.added);
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || C.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'prev' || act === 'next') {
      C.cursor = moveCursor(C.view, C.cursor, act === 'prev' ? -1 : 1);
      C.sel = C.cursor;
      C.form = null;
      C.err = '';
      C.msg = '';
      refresh();
    } else if (act === 'today') {
      C.cursor = (C.data && C.data.today) || kstToday();
      C.sel = C.cursor;
      C.form = null;
      C.err = '';
      C.msg = '';
      refresh();
    } else if (act === 'view') {
      var v = el.getAttribute('data-view');
      if (VIEWS.indexOf(v) < 0 || v === C.view) return;
      C.view = v;
      C.cursor = C.sel || C.cursor; // 고른 날이 든 달 · 주로
      C.form = null;
      C.err = '';
      C.msg = '';
      refresh();
    } else if (act === 'kind') {
      var k = el.getAttribute('data-kind');
      if (KINDS.indexOf(k) < 0) return;
      C.kinds[k] = !C.kinds[k];
      render();
    } else if (act === 'day') {
      var day = el.getAttribute('data-day');
      if (!isDay(day)) return;
      C.sel = day;
      if (C.form && C.form.mode === 'edit') C.form = null;
      C.err = '';
      C.msg = '';
      render();
    } else if (act === 'retry') {
      refresh();
    } else if (act === 'add') {
      C.form = { mode: 'add' };
      C.err = '';
      C.msg = '';
      C.designErr = '';
      render();
      if (C.designs === null) loadDesigns();
      else focusField('design_id');
    } else if (act === 'edit') {
      var id = el.getAttribute('data-id') || '';
      if (!itemOf(id)) return;
      C.form = { mode: 'edit', id: id };
      C.err = '';
      C.msg = '';
      render();
      focusField('date');
    } else if (act === 'close') {
      C.form = null;
      C.err = '';
      render();
    }
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute || !form.getAttribute('data-form')) return;
    e.preventDefault();
    submit(form);
  }

  /** 달력 칸 채우기 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var box = $('meCalendar');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    var cfg = window.DADAM_CONFIG || {};
    C.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    C.sb = sb;
    C.session = session;
    C.me = me;
    C.view = 'month';
    C.cursor = kstToday();
    C.sel = C.cursor;
    C.kinds = { sales: true, design: true, make: true, install: true, as: true };
    C.data = null;
    C.cache = {};
    C.seq += 1;
    C.loading = false;
    C.loadErr = '';
    C.form = null;
    C.designs = null;
    C.designErr = '';
    C.err = '';
    C.msg = '';
    C.busy = false;
    if (!C.base || !session || !canSee(me)) return;
    try {
      var d = await fetchRange();
      if (!d) return; // 403 · 404 · 오류 — 칸째 감춘다
      C.data = d;
      // 서버의 오늘이 이 기기와 다른 달이면(자정 앞뒤 · 기기 시계) 서버 날짜로
      if (d.today && d.today !== C.cursor) {
        C.cursor = d.today;
        C.sel = d.today;
        if (!C.cache[rangeOf(C.view, C.cursor).from + '~' + rangeOf(C.view, C.cursor).to]) {
          var again = await fetchRange();
          if (!again) return;
          C.data = again;
        }
      }
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
        box.addEventListener('submit', onSubmit);
      }
      render();
    } catch {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganCalendar = {
    KINDS: KINDS,
    KIND_LABEL: KIND_LABEL,
    SCHEDULE_TYPES: SCHEDULE_TYPES,
    SCHEDULE_STATUS: SCHEDULE_STATUS,
    TITLE_MAX: TITLE_MAX,
    TEXT: TEXT,
    state: C,
    reload: reload,
    isDay: isDay,
    kstToday: kstToday,
    addDays: addDays,
    weekdayOf: weekdayOf,
    monthGrid: monthGrid,
    weekDays: weekDays,
    rangeOf: rangeOf,
    moveCursor: moveCursor,
    titleOf: titleOf,
    scheduledAtOf: scheduledAtOf,
    canSee: canSee,
    dataOf: dataOf,
    byDay: byDay,
    countKinds: countKinds,
    openOf: openOf,
    statusOf: statusOf,
    detailOf: detailOf,
    designsOf: designsOf,
    designGroups: designGroups,
    addBodyOf: addBodyOf,
    editBodyOf: editBodyOf,
    load: load,
  };
})();
