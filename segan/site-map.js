/* ============================================================
   segan/site-map.js — 「프로젝트 관리」 설치 · A/S 화면의 지도 + 표
                       (segan/me.html #siteInstall · #siteAs — 2026-11-10 대표님 승인 계획 3단계)

   누가 보나  설치 = 다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원 (업무 달력과 같다 — segan/calendar.js canSee)
             A/S  = 다담 공장 · Expert · Agent 구성원 (A/S함과 같다 — segan/as-requests.js canSee). Manager 의 A/S 는 준비 중.
             고객 · 업체 없는 회원에게는 묻지도 않고 칸이 없다. 서버가 403 이면 칸째 감춘다.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganSiteMap.load(sb, session, partnerMe) 를 부르고,
             설치 화면(#p-install) · A/S 화면(#p-as)에서만 칸을 보인다 (me-off).
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET   /company/sites?kind=install | as
                     → { company, can_manage, kind, range, today, ready, truncated, items[] }
                       설치 줄 { key, schedule_id, type, label, day, time, status, assignee_name, design { id, name } | null,
                                 project_id, project_title, order_no, address, address_detail, sido, gugun, lat, lng, needs_geo }
                       A/S 줄  { key, as_id, state, label, day, body, visit { schedule_id, day, time, assignee_name, status } | null,
                                 design, project_id, project_title, order_no, address …, needs_geo }
                       ready = false 면 DB 0058 을 아직 안 넣은 것 — 좌표 · 방문 일정 칸이 없다 (표는 그대로 쓴다)
               PUT   /company/sites/geo             { items: [{ design_id, address, lat, lng, sido?, gugun? }] }  (구성원 · 한 번에 20곳)
               PATCH /schedules/:id                 { scheduled_at?, assignee_name?, status? }                     (대표 · 실장)
               PUT   /company/as-requests/:id/visit { visit_at, assignee_name? }                                   (대표 · 실장)
   지도      카카오맵 JavaScript SDK (2026-11-10 대표님 결정). 키는 JavaScript 키 하나 — 사이트 도메인에만 묶인 공개 키다.
             KAKAO_JS_KEY (또는 DADAM_CONFIG.kakaoJsKey) 가 비어 있으면 지도 자리에 「준비 중」 한 줄, 표는 그대로.
             칸이 화면에 보일 때 처음 SDK 를 부른다 (안 보는 사람은 부르지 않는다).
   좌표      주소 → 좌표는 브라우저에서 카카오 주소 찾기(services.Geocoder)로 바꾸고, 찾은 값을 서버에 적는다
             (PUT /company/sites/geo — 서버는 「지금 주소와 같은 글자」일 때만 받는다). 주소를 고치면 좌표는 저절로 다시 구한다.
             주소 글자 · 좌표를 브라우저 저장소에 두지 않는다 — 이 화면이 떠 있는 동안만 기억한다.
             상세 주소 · 연락처는 지도 회사에 보내지 않는다.
   화면      위에 거르기 단추(설치: 전체 · 오늘 · 이번 주 · 팀 미정, A/S: 전체 · 처리 중 · 끝남 · 담당 미정) + 설치팀/담당 · 지역 고르기,
             지도(번호 핀 — 표의 번호와 같다. 같은 자리 현장은 핀 하나, 누를 때마다 차례로), 표,
             줄 · 핀을 누르면 아래에 현장 정보. 대표 · 실장은 설치 줄의 날짜 · 시각 · 설치팀 · 상태를 고치고(일정 표에 저장),
             A/S 줄의 방문일 · 담당을 잡는다(일정 표의 「A/S 방문」 한 줄). 저장하면 업무 달력도 다시 읽는다.
             「이번 주」 = 일요일부터 (업무 달력과 같다).
   색        핀 · 번호 네모 넷 — 파랑(예정) · 노랑(진행 중 / 방문일 미정) · 빨강(팀 · 담당 미정) · 초록(끝).
             색만으로 가리지 않는다: 표에 상태 글자가 있고 범례에 이름을 적는다.
   움직임    없다 — 줄 · 핀 고르기는 자주 누르는 곳이다 (지도도 밀지 않고 바로 옮긴다. CLAUDE.md 「SEGAN 앱 모션 규칙」).
   못 읽으면  처음(403 · 404 · 오류 · 끊김 · 모양이 틀림) → 칸째 감춘다. 다시 읽다 못 읽으면 본 것을 두고 글 + 「다시 읽기」.
             지도를 못 불러와도 표는 그대로. 고치기를 못 하면 서버 글을 그 자리에.
   ============================================================ */
/* global window, document, fetch, setTimeout, clearTimeout */
(function () {
  'use strict';

  // 카카오맵 JavaScript 키 (공개 키 — 카카오 개발자 콘솔에서 사이트 도메인에만 묶는다). REST · Admin 키는 여기 넣지 않는다.
  var KAKAO_JS_KEY = '';
  var SDK_URL = 'https://dapi.kakao.com/v2/maps/sdk.js';
  var CENTER = [36.5, 127.8]; // 처음 지도 가운데 — 핀을 그리면 핀에 맞춘다
  var LEVEL_ALL = 13;
  var LEVEL_ONE = 4;
  var GEO_BATCH = 20; // 서버가 한 번에 받는 곳 수
  var GEO_MAX = 40; // 한 번 읽을 때 좌표로 바꾸는 주소 수
  var GEO_WAIT_MS = 8000;
  // 서버 · DB 가 받는 좌표 범위 (대한민국) — workers/workflow-api/src/company-sites.js, DB 0058
  var BOUNDS = { lat: [32.5, 39.5], lng: [124.0, 132.5] };
  var TEAM_MAX = 50;
  var SIDO_MAX = 20;
  var GUGUN_MAX = 30;

  var MEMBER_ROLES = ['owner', 'manager', 'staff'];
  var INSTALL_PLANS = ['manager', 'expert', 'agent']; // segan/calendar.js PLANS
  var AS_PLANS = ['expert', 'agent']; // segan/as-requests.js PLANS
  var KINDS = ['install', 'as'];
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  // 일정 표 상태 — 워커 SCHEDULE_STATUSES (segan/calendar.js 와 같은 글자)
  var SCHEDULE_STATUS = {
    scheduled: '예정',
    confirmed: '확정',
    in_progress: '진행 중',
    completed: '끝남',
    cancelled: '취소',
  };
  // 여기서 고를 수 있는 상태 — 취소 · 되살리기는 업무 달력에서 한다
  var STATUS_OPTIONS = ['scheduled', 'confirmed', 'in_progress', 'completed'];
  var AS_STATE = { requested: '접수', received: '받음', done: '끝' };
  var TYPE_LABEL = { delivery: '납품', installation: '설치' };
  var VIEW = {
    install: {
      box: 'siteInstall',
      title: '설치 현장',
      team: '설치팀',
      tabs: [
        ['all', '전체'],
        ['today', '오늘'],
        ['week', '이번 주'],
        ['unset', '팀 미정'],
      ],
      legend: [
        ['info', '예정 · 확정'],
        ['warn', '진행 중'],
        ['bad', '팀 미정'],
        ['ok', '끝남'],
      ],
      empty: '납품 · 설치 일정이 없습니다. 일정은 프로젝트 관리의 업무 달력에서 넣습니다.',
      none: '이 조건에 맞는 일정이 없습니다.',
    },
    as: {
      box: 'siteAs',
      title: 'A/S 현장',
      team: '담당',
      tabs: [
        ['all', '전체'],
        ['open', '처리 중'],
        ['done', '끝남'],
        ['unset', '담당 미정'],
      ],
      legend: [
        ['info', '방문 예정'],
        ['warn', '방문일 미정'],
        ['bad', '담당 미정'],
        ['ok', '끝'],
      ],
      empty: 'A/S 접수가 없습니다.',
      none: '이 조건에 맞는 접수가 없습니다.',
    },
  };
  var TEXT = {
    generic: '저장하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    saved: '저장했습니다.',
    savedStale: '저장했습니다. 목록을 다시 읽지 못했습니다.',
    reloadFailed: '목록을 다시 읽지 못했습니다.',
    retry: '다시 읽기',
    truncated: '줄이 많아 일부만 보입니다.',
    mapSoon: '지도는 준비 중입니다. 아래 표는 그대로 쓸 수 있습니다.',
    mapLoading: '지도를 불러오는 중입니다.',
    mapFailed: '지도를 불러오지 못했습니다. 아래 표는 그대로 쓸 수 있습니다.',
    noAddress: '현장 주소가 없습니다.',
    notFound: '지도에서 이 주소를 찾지 못했습니다.',
    needDate: '날짜를 골라 주세요.',
    needTime: '시각을 골라 주세요.',
    teamLong: '이름은 ' + TEAM_MAX + '자까지 적을 수 있습니다.',
    visitSoon: '방문일 넣기는 준비 중입니다.',
    unset: '미정',
    noName: '(이름 없음)',
  };
  var DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  var KEY_RE = /^[0-9a-zA-Z]{16,64}$/;
  var DAY_MS = 86400000;
  var KST_MS = 9 * 3600000;

  // 두 화면이 같이 쓰는 것. geo = 이 화면이 떠 있는 동안 찾은 좌표 ('설계|주소' → { lat, lng, sido, gugun } | null = 못 찾음)
  var S = {
    sb: null,
    session: null,
    base: '',
    geo: {},
    geoLeft: GEO_MAX,
    geoBusy: false,
    sdk: 'idle', // idle | loading | ready | failed | nokey
    sdkWait: null,
  };
  function viewState(kind) {
    return {
      kind: kind,
      data: null, // { manage, today, ready, truncated, range, items }
      tab: 'all',
      team: '',
      region: '',
      sel: '', // 고른 줄의 key
      form: false,
      err: '',
      msg: '',
      busy: false,
      loadErr: '',
      visible: false,
      fit: true, // 다음에 그릴 때 핀에 지도를 맞춘다
      center: false, // 다음에 그릴 때 고른 핀으로 옮긴다
      map: null,
      canvas: null,
      overlays: [],
      watch: null,
    };
  }
  var V = { install: viewState('install'), as: viewState('as') };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  // ── 날짜 (순수 함수 — 날은 모두 'YYYY-MM-DD' 한국 날짜) ─────────────────────────
  function isDay(v) {
    return typeof v === 'string' && DAY_RE.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z'));
  }
  function kstToday(nowMs) {
    return new Date((nowMs == null ? Date.now() : nowMs) + KST_MS).toISOString().slice(0, 10);
  }
  function addDays(day, n) {
    return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
  }
  function weekdayOf(day) {
    return new Date(Date.parse(day + 'T00:00:00Z')).getUTCDay();
  }
  /** 그날이 든 주 — 일요일부터 토요일까지 (업무 달력과 같다) */
  function weekOf(day) {
    var from = addDays(day, -weekdayOf(day));
    return { from: from, to: addDays(from, 6) };
  }
  /** 'M월 D일 (요일)' */
  function dayTitle(day) {
    if (!isDay(day)) return '';
    return (
      Number(day.slice(5, 7)) +
      '월 ' +
      Number(day.slice(8, 10)) +
      '일 (' +
      WEEKDAYS[weekdayOf(day)] +
      ')'
    );
  }
  /** 'M/D (요일)' — 표의 좁은 칸 */
  function dayShort(day) {
    if (!isDay(day)) return '';
    return (
      Number(day.slice(5, 7)) +
      '/' +
      Number(day.slice(8, 10)) +
      ' (' +
      WEEKDAYS[weekdayOf(day)] +
      ')'
    );
  }
  /** 한국 날짜 + 시각 → 서버에 보내는 때 */
  function scheduledAtOf(day, time) {
    return day + 'T' + time + ':00+09:00';
  }

  // ── 누가 보나 ────────────────────────────────────────────────────────────────
  function memberOf(me, plans) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    return !!(
      c &&
      typeof c === 'object' &&
      plans.indexOf(c.plan) >= 0 &&
      MEMBER_ROLES.indexOf(c.role) >= 0
    );
  }
  /** 설치 지도 — 업무 달력을 보는 사람 */
  function canSee(me) {
    return memberOf(me, INSTALL_PLANS);
  }
  /** A/S 지도 — A/S함을 보는 사람 */
  function canSeeAs(me) {
    return memberOf(me, AS_PLANS);
  }

  // ── 서버 본문 → 줄 ───────────────────────────────────────────────────────────
  function inKorea(lat, lng) {
    return (
      typeof lat === 'number' &&
      typeof lng === 'number' &&
      isFinite(lat) &&
      isFinite(lng) &&
      lat >= BOUNDS.lat[0] &&
      lat <= BOUNDS.lat[1] &&
      lng >= BOUNDS.lng[0] &&
      lng <= BOUNDS.lng[1]
    );
  }
  function designOf(raw) {
    var d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    return d && str(d.id) ? { id: str(d.id), name: str(d.name) } : null;
  }
  function siteOf(raw) {
    var ok = inKorea(raw.lat, raw.lng);
    return {
      design: designOf(raw.design),
      project_id: str(raw.project_id),
      project_title: str(raw.project_title),
      order_no: str(raw.order_no),
      address: str(raw.address),
      address_detail: str(raw.address_detail),
      sido: str(raw.sido),
      gugun: str(raw.gugun),
      lat: ok ? raw.lat : null,
      lng: ok ? raw.lng : null,
      needs_geo: raw.needs_geo === true,
    };
  }
  function visitOfRaw(raw) {
    var x = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
    if (!x || !str(x.schedule_id) || !isDay(x.day)) return null;
    return {
      schedule_id: str(x.schedule_id),
      day: x.day,
      time: TIME_RE.test(str(x.time)) ? str(x.time) : '',
      assignee_name: str(x.assignee_name),
      status: str(x.status),
    };
  }
  function itemOf(kind, raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !str(raw.key)) return null;
    var it = siteOf(raw);
    it.key = str(raw.key);
    if (kind === 'install') {
      if (!str(raw.schedule_id) || !isDay(raw.day)) return null;
      it.schedule_id = str(raw.schedule_id);
      it.type = str(raw.type);
      it.label = str(raw.label) || TYPE_LABEL[it.type] || '';
      it.day = raw.day;
      it.time = TIME_RE.test(str(raw.time)) ? str(raw.time) : '';
      it.status = str(raw.status);
      it.assignee_name = str(raw.assignee_name);
      return it;
    }
    if (!str(raw.as_id) || !AS_STATE[raw.state]) return null;
    it.as_id = str(raw.as_id);
    it.state = raw.state;
    it.label = AS_STATE[raw.state];
    it.day = isDay(raw.day) ? raw.day : '';
    it.body = str(raw.body);
    it.visit = visitOfRaw(raw.visit);
    return it;
  }
  /** GET /company/sites 본문 → { manage, today, ready, truncated, range, items } | null (모양이 맞는 줄만) */
  function dataOf(body, kind) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.items)) return null;
    if (KINDS.indexOf(kind) < 0 || (d.kind && d.kind !== kind)) return null;
    var r = d.range && typeof d.range === 'object' ? d.range : null;
    return {
      manage: d.can_manage === true,
      today: isDay(d.today) ? d.today : kstToday(),
      ready: d.ready !== false,
      truncated: d.truncated === true,
      range: r && isDay(r.from) && isDay(r.to) ? { from: r.from, to: r.to } : null,
      items: d.items
        .map(function (x) {
          return itemOf(kind, x);
        })
        .filter(Boolean),
    };
  }

  // ── 줄 읽기 (순수 함수) ──────────────────────────────────────────────────────
  function geoKey(item) {
    return item && item.design && item.address ? item.design.id + '|' + item.address : '';
  }
  function memoOf(item, memo) {
    var k = geoKey(item);
    return k && memo && Object.prototype.hasOwnProperty.call(memo, k) ? memo[k] : undefined;
  }
  /** 그 줄의 좌표 — 서버가 준 것, 없으면 이 화면에서 찾은 것 */
  function coordOf(item, memo) {
    if (inKorea(item.lat, item.lng)) return { lat: item.lat, lng: item.lng };
    var g = memoOf(item, memo);
    return g ? { lat: g.lat, lng: g.lng } : null;
  }
  /**
   * 지역 — { area: 시도(거르기), text: '시도 구군'(표) }.
   * 좌표를 아직 못 구한 주소는 주소 글자의 앞 두 마디를 보여 주기만 한다 (저장하지 않는다 — 좌표를 구하면 지도 회사 이름으로 바뀐다).
   */
  function regionOf(item, memo) {
    var g = memoOf(item, memo);
    var sido = item.sido || (g && g.sido) || '';
    var gugun = item.gugun || (g && g.gugun) || '';
    if (!sido) {
      var t = item.address.split(/\s+/).filter(Boolean);
      sido = t[0] || '';
      gugun = t[1] || '';
    }
    return { area: sido, text: [sido, gugun].filter(Boolean).join(' ') };
  }
  /** A/S 방문 일정 — 취소된 방문은 「방문일 미정」으로 읽는다 */
  function visitOf(item) {
    return item.visit && item.visit.status !== 'cancelled' ? item.visit : null;
  }
  /** 설치팀 · 방문 담당 */
  function teamOf(kind, item) {
    if (kind === 'install') return item.assignee_name || '';
    var v = visitOf(item);
    return v ? v.assignee_name : '';
  }
  /** 핀 · 번호 네모의 색 이름 — info | warn | bad | ok */
  function pinTone(kind, item) {
    if (kind === 'install') {
      if (item.status === 'completed') return 'ok';
      if (item.status === 'in_progress') return 'warn';
      return item.assignee_name ? 'info' : 'bad';
    }
    if (item.state === 'done') return 'ok';
    var v = visitOf(item);
    if (!v) return 'warn';
    return v.assignee_name ? 'info' : 'bad';
  }
  function tabMatch(kind, tab, item, today) {
    if (tab === 'all') return true;
    if (kind === 'install') {
      if (tab === 'today') return item.day === today;
      if (tab === 'week') {
        var w = weekOf(today);
        return item.day >= w.from && item.day <= w.to;
      }
      if (tab === 'unset') return !item.assignee_name && item.status !== 'completed';
      return false;
    }
    if (tab === 'open') return item.state !== 'done';
    if (tab === 'done') return item.state === 'done';
    if (tab === 'unset') return item.state !== 'done' && !teamOf(kind, item);
    return false;
  }
  /** 거르기 단추 — [{ id, label, n }] (수는 전체 줄에서 센다) */
  function tabsOf(kind, items, today) {
    return VIEW[kind].tabs.map(function (t) {
      return {
        id: t[0],
        label: t[1],
        n: items.filter(function (it) {
          return tabMatch(kind, t[0], it, today);
        }).length,
      };
    });
  }
  /** f = { tab, team, region } */
  function filterItems(kind, items, f, today, memo) {
    return items.filter(function (it) {
      if (!tabMatch(kind, f.tab || 'all', it, today)) return false;
      if (f.team && teamOf(kind, it) !== f.team) return false;
      if (f.region && regionOf(it, memo).area !== f.region) return false;
      return true;
    });
  }
  function uniq(list) {
    var seen = {};
    return list
      .filter(function (x) {
        if (!x || seen[x]) return false;
        seen[x] = true;
        return true;
      })
      .sort(function (a, b) {
        return a.localeCompare(b, 'ko');
      });
  }
  function teamsOf(kind, items) {
    return uniq(
      items.map(function (it) {
        return teamOf(kind, it);
      })
    );
  }
  function regionsOf(items, memo) {
    return uniq(
      items.map(function (it) {
        return regionOf(it, memo).area;
      })
    );
  }
  /** 좌표로 바꿀 주소 — 설계 · 주소가 있고 아직 안 찾아 본 것만, 같은 것은 한 번, 많아야 max 곳 */
  function geoTargets(items, memo, max) {
    var out = [];
    var seen = {};
    items.forEach(function (it) {
      var k = geoKey(it);
      if (!it.needs_geo || !k || seen[k] || out.length >= max) return;
      if (memoOf(it, memo) !== undefined) return;
      seen[k] = true;
      out.push({ design_id: it.design.id, address: it.address });
    });
    return out;
  }
  /**
   * 설치 줄 고치기 — 바뀐 것만 담는다.
   * values = { date, time, team, status } → { patch } | { error: 칸 이름, message }
   */
  function patchOf(item, values) {
    var date = str(values.date);
    var time = str(values.time);
    var team = str(values.team);
    var status = str(values.status);
    if (!isDay(date)) return { error: 'date', message: TEXT.needDate };
    if (!TIME_RE.test(time)) return { error: 'time', message: TEXT.needTime };
    if (team.length > TEAM_MAX) return { error: 'team', message: TEXT.teamLong };
    var patch = {};
    if (date !== item.day || time !== item.time) patch.scheduled_at = scheduledAtOf(date, time);
    if (team !== (item.assignee_name || '')) patch.assignee_name = team || null;
    if (STATUS_OPTIONS.indexOf(status) >= 0 && status !== item.status) patch.status = status;
    return { patch: patch };
  }
  /**
   * A/S 방문 잡기 — values = { date, time, team } → { body, same } | { error, message }
   * same = 지금 방문 일정과 같다 (보내지 않는다)
   */
  function visitBodyOf(item, values) {
    var date = str(values.date);
    var time = str(values.time);
    var team = str(values.team);
    if (!isDay(date)) return { error: 'date', message: TEXT.needDate };
    if (!TIME_RE.test(time)) return { error: 'time', message: TEXT.needTime };
    if (team.length > TEAM_MAX) return { error: 'team', message: TEXT.teamLong };
    var v = visitOf(item);
    return {
      body: { visit_at: scheduledAtOf(date, time), assignee_name: team || null },
      same: !!v && v.day === date && v.time === time && v.assignee_name === team,
    };
  }
  /**
   * 핀 묶기 — 같은 자리 현장은 핀 하나.
   * rows = [{ n, item, coord, tone }] → [{ lat, lng, keys[], n, tone, on }] (번호 · 색은 고른 줄, 없으면 첫 줄)
   */
  function groupPins(rows, sel) {
    var by = {};
    var out = [];
    rows.forEach(function (r) {
      if (!r.coord) return;
      var k = r.coord.lat.toFixed(5) + ',' + r.coord.lng.toFixed(5);
      var g = by[k];
      if (!g) {
        g = by[k] = {
          lat: r.coord.lat,
          lng: r.coord.lng,
          keys: [],
          n: r.n,
          tone: r.tone,
          on: false,
        };
        out.push(g);
      }
      g.keys.push(r.item.key);
      if (sel && r.item.key === sel) {
        g.n = r.n;
        g.tone = r.tone;
        g.on = true;
      }
    });
    return out;
  }
  /** 핀을 누르면 고를 줄 — 그 핀의 줄을 차례로 돈다 */
  function nextKey(keys, sel) {
    var i = keys.indexOf(sel);
    return keys[i < 0 ? 0 : (i + 1) % keys.length];
  }

  // ── 서버 ────────────────────────────────────────────────────────────────────
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
  async function call(method, path, body) {
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
  function errText(r) {
    var m = r && r.body && r.body.message;
    return typeof m === 'string' && m ? m : TEXT.generic;
  }
  async function fetchView(v) {
    var r = await call('GET', '/company/sites?kind=' + v.kind);
    return r.ok ? dataOf(r.body, v.kind) : null;
  }

  // ── 카카오맵 ────────────────────────────────────────────────────────────────
  function sdkKey() {
    var c = window.DADAM_CONFIG;
    var k = c && typeof c.kakaoJsKey === 'string' ? c.kakaoJsKey.trim() : '';
    k = k || KAKAO_JS_KEY;
    return KEY_RE.test(k) ? k : '';
  }
  /** SDK 를 한 번만 부른다 → 'ready' | 'failed' | 'nokey' */
  function ensureSdk() {
    if (S.sdkWait) return S.sdkWait;
    S.sdkWait = new Promise(function (resolve) {
      var done = function (state) {
        S.sdk = state;
        resolve(state);
      };
      var boot = function () {
        try {
          window.kakao.maps.load(function () {
            done('ready');
          });
        } catch {
          done('failed');
        }
      };
      var have = function () {
        return !!(
          window.kakao &&
          window.kakao.maps &&
          typeof window.kakao.maps.load === 'function'
        );
      };
      if (have()) return boot();
      var key = sdkKey();
      if (!key) return done('nokey');
      S.sdk = 'loading';
      var el = document.createElement('script');
      el.src =
        SDK_URL + '?appkey=' + encodeURIComponent(key) + '&libraries=services&autoload=false';
      el.async = true;
      el.onload = function () {
        if (have()) boot();
        else done('failed');
      };
      el.onerror = function () {
        done('failed');
      };
      document.head.appendChild(el);
    });
    return S.sdkWait;
  }
  /** 주소 한 줄 → { lat, lng, sido, gugun } | null (못 찾음 · 대한민국 밖 · 응답 없음) */
  function geocode(coder, address) {
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        resolve(null);
      }, GEO_WAIT_MS);
      var finish = function (v) {
        clearTimeout(timer);
        resolve(v);
      };
      try {
        coder.addressSearch(address, function (result, status) {
          var okStatus = window.kakao.maps.services.Status.OK;
          var r = status === okStatus && Array.isArray(result) ? result[0] : null;
          if (!r) return finish(null);
          var lat = Number(r.y);
          var lng = Number(r.x);
          if (!inKorea(lat, lng)) return finish(null);
          var a = r.address || r.road_address || {};
          finish({
            lat: lat,
            lng: lng,
            sido: str(a.region_1depth_name).slice(0, SIDO_MAX),
            gugun: str(a.region_2depth_name).slice(0, GUGUN_MAX),
          });
        });
      } catch {
        finish(null);
      }
    });
  }
  /** 보이는 화면의 주소를 좌표로 바꾸고 서버에 적는다 (한 번에 하나씩 · 적기를 못 해도 말하지 않는다 — 다음에 다시 찾는다) */
  async function runGeo() {
    if (S.geoBusy || S.sdk !== 'ready') return;
    var maps = window.kakao && window.kakao.maps;
    var Coder = maps && maps.services && maps.services.Geocoder;
    if (typeof Coder !== 'function') return;
    S.geoBusy = true;
    try {
      var coder = new Coder();
      for (;;) {
        var items = [];
        var ready = false;
        KINDS.forEach(function (k) {
          if (!V[k].data || !V[k].visible) return;
          items = items.concat(V[k].data.items);
          ready = ready || V[k].data.ready;
        });
        var targets = geoTargets(items, S.geo, Math.min(S.geoLeft, GEO_BATCH));
        if (!targets.length) break;
        var found = [];
        for (var i = 0; i < targets.length; i++) {
          var t = targets[i];
          S.geoLeft -= 1;
          var g = await geocode(coder, t.address);
          S.geo[t.design_id + '|' + t.address] = g;
          if (!g) continue;
          var row = { design_id: t.design_id, address: t.address, lat: g.lat, lng: g.lng };
          if (g.sido) row.sido = g.sido;
          if (g.gugun) row.gugun = g.gugun;
          found.push(row);
        }
        KINDS.forEach(function (k) {
          if (!V[k].data) return;
          V[k].fit = V[k].fit || !V[k].sel;
          render(V[k]);
        });
        if (found.length && ready) await call('PUT', '/company/sites/geo', { items: found });
      }
    } catch {
      /* 좌표는 덤이다 — 표는 그대로 */
    } finally {
      S.geoBusy = false;
      // 다 찾은 뒤에야 「표에만 있는 현장」 줄을 적는다 (찾는 동안에는 숫자가 줄어드는 중이다)
      KINDS.forEach(function (k) {
        if (V[k].data) paintMap(V[k]);
      });
    }
  }

  // ── 화면 ────────────────────────────────────────────────────────────────────
  function boxOf(v) {
    return document.getElementById(VIEW[v.kind].box);
  }
  function part(v, name) {
    var box = boxOf(v);
    return box ? box.querySelector('[data-sm="' + name + '"]') : null;
  }
  /** 거른 줄 — [{ n, item, coord, tone, region }] (번호는 보이는 차례) */
  function rowsOf(v) {
    return filterItems(v.kind, v.data.items, v, v.data.today, S.geo).map(function (it, i) {
      return {
        n: i + 1,
        item: it,
        coord: coordOf(it, S.geo),
        tone: pinTone(v.kind, it),
        region: regionOf(it, S.geo).text,
      };
    });
  }
  function nameOf(item) {
    return item.project_title || (item.design && item.design.name) || TEXT.noName;
  }
  /** 프로젝트 이름 아래 작은 글 — 설계 이름(다를 때) · 수주 번호 */
  function subOf(item) {
    var d =
      item.design && item.design.name && item.design.name !== nameOf(item) ? item.design.name : '';
    return [d, item.order_no].filter(Boolean).join(' · ');
  }

  function mount(v) {
    var box = boxOf(v);
    if (!box || box.getAttribute('data-mounted') === '1') return;
    var id = VIEW[v.kind].box;
    box.setAttribute('data-mounted', '1');
    box.innerHTML =
      '<h3 class="me-pt-sub" id="' +
      id +
      'Title">' +
      esc(VIEW[v.kind].title) +
      '</h3>' +
      '<div class="sm-head" data-sm="head"></div>' +
      '<div class="sm-mapwrap" data-sm="mapwrap">' +
      '<div class="sm-map" data-sm="canvas"></div>' +
      '<p class="sm-mapmsg" data-sm="mapmsg" role="status"></p>' +
      '</div>' +
      '<p class="sm-mapnote" data-sm="mapnote"></p>' +
      '<ul class="sm-legend" data-sm="legend" aria-label="색 풀이"></ul>' +
      '<div data-sm="state"></div>' +
      '<div class="sm-tablewrap" data-sm="table"></div>' +
      '<div data-sm="detail"></div>';
    box.setAttribute('aria-labelledby', id + 'Title');
    part(v, 'legend').innerHTML = VIEW[v.kind].legend
      .map(function (l) {
        return (
          '<li><span class="sm-sw sm-sw--' +
          l[0] +
          '" aria-hidden="true"></span>' +
          esc(l[1]) +
          '</li>'
        );
      })
      .join('');
  }

  function headHtml(v) {
    var d = v.data;
    var tabs = tabsOf(v.kind, d.items, d.today)
      .map(function (t) {
        return (
          '<button type="button" class="cal-btn" data-act="tab" data-tab="' +
          t.id +
          '" data-fk="tab:' +
          t.id +
          '" aria-pressed="' +
          (v.tab === t.id ? 'true' : 'false') +
          '">' +
          esc(t.label) +
          ' <span class="sm-n">' +
          t.n +
          '</span></button>'
        );
      })
      .join('');
    var pick = function (name, label, list, value) {
      // 고른 값이 목록에서 빠져도(다시 읽은 뒤) 고른 채로 둔다 — 눌러서 「전체」로 돌린다
      var all = value && list.indexOf(value) < 0 ? list.concat([value]) : list;
      return (
        '<label class="sm-filter"><span>' +
        esc(label) +
        '</span><select data-filter="' +
        name +
        '" data-fk="f:' +
        name +
        '"><option value="">전체</option>' +
        all
          .map(function (x) {
            return (
              '<option value="' +
              esc(x) +
              '"' +
              (x === value ? ' selected' : '') +
              '>' +
              esc(x) +
              '</option>'
            );
          })
          .join('') +
        '</select></label>'
      );
    };
    var range =
      v.kind === 'install' && d.range
        ? '<p class="sm-range">' +
          esc(dayTitle(d.range.from) + ' ~ ' + dayTitle(d.range.to)) +
          ' 납품 · 설치 일정</p>'
        : '';
    return (
      range +
      '<div class="sm-tabs" role="group" aria-label="걸러 보기">' +
      tabs +
      '</div>' +
      '<div class="sm-filters">' +
      pick('team', VIEW[v.kind].team, teamsOf(v.kind, d.items), v.team) +
      pick('region', '지역', regionsOf(d.items, S.geo), v.region) +
      '</div>'
    );
  }

  function stateHtml(v, rows) {
    var d = v.data;
    var out = '';
    if (v.loadErr)
      out +=
        '<p class="mk-error" role="alert">' +
        esc(v.loadErr) +
        ' <button type="button" class="cal-link" data-act="retry" data-fk="retry">' +
        esc(TEXT.retry) +
        '</button></p>';
    if (d.truncated) out += '<p class="mk-note">' + esc(TEXT.truncated) + '</p>';
    if (!d.items.length) out += '<p class="me-empty">' + esc(VIEW[v.kind].empty) + '</p>';
    else if (!rows.length) out += '<p class="me-empty">' + esc(VIEW[v.kind].none) + '</p>';
    return out;
  }

  function numCell(v, r) {
    var on = v.sel === r.item.key;
    return (
      '<th scope="row"><button type="button" class="sm-num sm-num--' +
      r.tone +
      '" data-act="pick" data-key="' +
      esc(r.item.key) +
      '" data-fk="row:' +
      esc(r.item.key) +
      '" aria-pressed="' +
      (on ? 'true' : 'false') +
      '" aria-label="' +
      r.n +
      '번 ' +
      esc(nameOf(r.item)) +
      '">' +
      r.n +
      '</button></th>'
    );
  }
  function nameCell(item) {
    var sub = subOf(item);
    return (
      '<td class="sm-name"><b>' +
      esc(nameOf(item)) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</td>'
    );
  }
  function dim(text) {
    return '<span class="sm-dim">' + esc(text) + '</span>';
  }
  function tableHtml(v, rows) {
    if (!rows.length) return '';
    var install = v.kind === 'install';
    var head = install
      ? ['번호', '날짜', '시각', '프로젝트', '지역', '설치팀', '상태']
      : ['번호', '접수일', '방문일', '프로젝트', '지역', '증상', '담당', '상태'];
    var body = rows
      .map(function (r) {
        var it = r.item;
        var cells;
        if (install) {
          cells =
            '<td>' +
            esc(dayShort(it.day)) +
            '</td><td>' +
            esc(it.time) +
            '</td>' +
            nameCell(it) +
            '<td>' +
            (r.region ? esc(r.region) : dim('—')) +
            '</td><td>' +
            (it.assignee_name ? esc(it.assignee_name) : dim(TEXT.unset)) +
            '</td><td>' +
            esc((it.label ? it.label + ' · ' : '') + (SCHEDULE_STATUS[it.status] || it.status)) +
            '</td>';
        } else {
          var visit = visitOf(it);
          cells =
            '<td>' +
            esc(dayShort(it.day)) +
            '</td><td>' +
            (visit
              ? esc(dayShort(visit.day) + (visit.time ? ' ' + visit.time : ''))
              : dim(TEXT.unset)) +
            '</td>' +
            nameCell(it) +
            '<td>' +
            (r.region ? esc(r.region) : dim('—')) +
            '</td><td class="sm-body">' +
            esc(it.body) +
            '</td><td>' +
            (visit && visit.assignee_name ? esc(visit.assignee_name) : dim(TEXT.unset)) +
            '</td><td>' +
            esc(it.label) +
            '</td>';
        }
        return (
          '<tr class="sm-row' +
          (v.sel === it.key ? ' sm-row--on' : '') +
          '" data-act="pick" data-key="' +
          esc(it.key) +
          '">' +
          numCell(v, r) +
          cells +
          '</tr>'
        );
      })
      .join('');
    return (
      '<table class="sm-table"><thead><tr>' +
      head
        .map(function (h) {
          return '<th scope="col">' + h + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>' +
      body +
      '</tbody></table>'
    );
  }

  function dl(pairs) {
    return (
      '<dl class="sm-dl">' +
      pairs
        .filter(function (p) {
          return p[1];
        })
        .map(function (p) {
          return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
        })
        .join('') +
      '</dl>'
    );
  }
  function addressText(item, coord) {
    if (!item.address) return TEXT.noAddress;
    var a = [item.address, item.address_detail].filter(Boolean).join(' ');
    // 찾아 봤는데 없던 주소만 말한다 (아직 안 찾아 본 주소는 말하지 않는다)
    return !coord && memoOf(item, S.geo) === null ? a + ' — ' + TEXT.notFound : a;
  }
  function field(label, input) {
    return '<label class="mk-input"><span>' + esc(label) + '</span>' + input + '</label>';
  }
  function formHtml(v, item) {
    var install = v.kind === 'install';
    var visit = install ? null : visitOf(item);
    var day = install ? item.day : visit ? visit.day : '';
    var time = install ? item.time : visit && visit.time ? visit.time : '10:00';
    var team = teamOf(v.kind, item);
    var status = install
      ? field(
          '상태',
          '<select name="status">' +
            STATUS_OPTIONS.map(function (s) {
              return (
                '<option value="' +
                s +
                '"' +
                (s === item.status ? ' selected' : '') +
                '>' +
                SCHEDULE_STATUS[s] +
                '</option>'
              );
            }).join('') +
            '</select>'
        )
      : '';
    return (
      '<form class="me-pt-form cal-form" data-form="' +
      (install ? 'edit' : 'visit') +
      '" novalidate>' +
      '<div class="cal-form-row">' +
      field(
        install ? '날짜' : '방문일',
        '<input name="date" type="date" value="' + esc(day) + '" data-fk="in:date" required />'
      ) +
      field(
        '시각',
        '<input name="time" type="time" value="' + esc(time) + '" data-fk="in:time" required />'
      ) +
      '</div>' +
      field(
        VIEW[v.kind].team,
        '<input name="team" type="text" maxlength="' +
          TEAM_MAX +
          '" value="' +
          esc(team) +
          '" data-fk="in:team" autocomplete="off" />'
      ) +
      status +
      '<p class="mk-error" data-err role="alert"' +
      (v.err ? '' : ' hidden') +
      '>' +
      esc(v.err) +
      '</p>' +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid" data-fk="save"' +
      (v.busy ? ' disabled' : '') +
      '>저장</button><button type="button" class="mk-btn" data-act="close" data-fk="close"' +
      (v.busy ? ' disabled' : '') +
      '>닫기</button></div></form>'
    );
  }
  function detailHtml(v, rows) {
    var r = rows.filter(function (x) {
      return x.item.key === v.sel;
    })[0];
    var msg = v.msg ? '<p class="me-pt-msg" role="status">' + esc(v.msg) + '</p>' : '';
    if (!r) return msg;
    var it = r.item;
    var install = v.kind === 'install';
    var visit = install ? null : visitOf(it);
    var pairs = install
      ? [
          ['일정', dayTitle(it.day) + (it.time ? ' ' + it.time : '')],
          ['종류', it.label],
          ['설치팀', it.assignee_name || TEXT.unset],
          ['상태', SCHEDULE_STATUS[it.status] || it.status],
        ]
      : [
          ['접수일', dayTitle(it.day)],
          ['증상', it.body],
          [
            '방문일',
            visit ? dayTitle(visit.day) + (visit.time ? ' ' + visit.time : '') : TEXT.unset,
          ],
          ['담당', (visit && visit.assignee_name) || TEXT.unset],
          ['상태', it.label],
        ];
    pairs = pairs.concat([
      ['프로젝트', it.project_title],
      ['설계', it.design ? it.design.name : ''],
      ['수주 번호', it.order_no],
      ['현장 주소', addressText(it, r.coord)],
    ]);
    var canEdit = v.data.manage && (install || it.state !== 'done');
    var acts = '';
    var note = '';
    if (canEdit && !install && !v.data.ready) {
      note = '<p class="mk-note">' + esc(TEXT.visitSoon) + '</p>';
      canEdit = false;
    }
    if (!v.form)
      acts =
        '<div class="rd-acts">' +
        (canEdit
          ? '<button type="button" class="mk-btn mk-btn--solid" data-act="edit" data-fk="edit">' +
            (install ? '고치기' : visit ? '방문일 고치기' : '방문일 잡기') +
            '</button>'
          : '') +
        '<button type="button" class="mk-btn" data-act="unpick" data-fk="unpick">닫기</button></div>';
    return (
      '<div class="me-pt-box sm-detail">' +
      '<h4 class="sm-detail-title"><span class="sm-num sm-num--' +
      r.tone +
      '" aria-hidden="true">' +
      r.n +
      '</span>' +
      esc(nameOf(it)) +
      '</h4>' +
      dl(pairs) +
      msg +
      note +
      (v.form && canEdit ? formHtml(v, it) : acts) +
      '</div>'
    );
  }

  function fitMap(v, pins) {
    var maps = window.kakao.maps;
    if (!pins.length) return;
    if (pins.length === 1) {
      v.map.setCenter(new maps.LatLng(pins[0].lat, pins[0].lng));
      v.map.setLevel(LEVEL_ONE);
      return;
    }
    var b = new maps.LatLngBounds();
    pins.forEach(function (p) {
      b.extend(new maps.LatLng(p.lat, p.lng));
    });
    v.map.setBounds(b);
  }
  function drawMap(v, rows) {
    var maps = window.kakao.maps;
    var canvas = part(v, 'canvas');
    if (!v.map || v.canvas !== canvas) {
      v.map = new maps.Map(canvas, {
        center: new maps.LatLng(CENTER[0], CENTER[1]),
        level: LEVEL_ALL,
      });
      v.canvas = canvas;
      v.overlays = [];
      v.fit = true;
    }
    v.overlays.forEach(function (o) {
      o.setMap(null);
    });
    v.overlays = [];
    var pins = groupPins(rows, v.sel);
    pins.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sm-pin sm-pin--' + p.tone + (p.on ? ' sm-pin--on' : '');
      b.textContent = p.n + (p.keys.length > 1 ? '+' : '');
      b.setAttribute('aria-pressed', p.on ? 'true' : 'false');
      b.setAttribute(
        'aria-label',
        p.n + '번 현장' + (p.keys.length > 1 ? ' 외 ' + (p.keys.length - 1) + '곳' : '')
      );
      b.addEventListener('click', function () {
        if (v.busy) return;
        pick(v, nextKey(p.keys, v.sel));
      });
      var o = new maps.CustomOverlay({
        position: new maps.LatLng(p.lat, p.lng),
        content: b,
        xAnchor: 0.5,
        yAnchor: 0.5,
        clickable: true,
        zIndex: p.on ? 3 : 1,
      });
      o.setMap(v.map);
      v.overlays.push(o);
    });
    if (v.fit) fitMap(v, pins);
    else if (v.center) {
      var on = pins.filter(function (p) {
        return p.on;
      })[0];
      if (on) v.map.setCenter(new maps.LatLng(on.lat, on.lng)); // 밀지 않고 바로 옮긴다
    }
    v.fit = false;
    v.center = false;
  }
  /** 지도 자리 — SDK 상태 글 · 핀 · 「표에만 있는 현장」 한 줄 */
  function paintMap(v, rows) {
    var wrap = part(v, 'mapwrap');
    if (!wrap || !v.data) return;
    rows = rows || rowsOf(v);
    var none = !v.data.items.length;
    var off = S.sdk === 'nokey' || S.sdk === 'failed';
    var ready = S.sdk === 'ready';
    wrap.hidden = none;
    wrap.classList.toggle('sm-mapwrap--off', off);
    part(v, 'legend').hidden = none;
    part(v, 'canvas').hidden = off;
    var msg = part(v, 'mapmsg');
    msg.hidden = ready;
    msg.textContent = ready
      ? ''
      : S.sdk === 'nokey'
        ? TEXT.mapSoon
        : S.sdk === 'failed'
          ? TEXT.mapFailed
          : TEXT.mapLoading;
    var missing = rows.filter(function (r) {
      return !r.coord;
    }).length;
    var note = part(v, 'mapnote');
    note.textContent =
      ready && !none && missing && !S.geoBusy
        ? '주소가 없거나 지도에서 찾지 못한 현장 ' + missing + '곳은 표에만 있습니다.'
        : '';
    note.hidden = !note.textContent;
    if (!ready || none || !v.visible) return;
    try {
      drawMap(v, rows);
    } catch {
      S.sdk = 'failed';
      paintMap(v, rows);
    }
  }

  /** 열어 둔 입력 칸의 값 — 다시 그려도 적던 글을 잃지 않는다 */
  function formValues(box) {
    var f = box.querySelector('form[data-form]');
    if (!f) return null;
    var out = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (el.name) out[el.name] = el.value;
    });
    return out;
  }
  function render(v) {
    var box = boxOf(v);
    if (!box || !v.data) return;
    var active = document.activeElement;
    var fk = active && box.contains(active) ? active.getAttribute('data-fk') : '';
    var typed = v.form ? formValues(box) : null;
    var rows = rowsOf(v);
    var has = rows.some(function (r) {
      return r.item.key === v.sel;
    });
    if (v.sel && !has) {
      v.sel = '';
      v.form = false;
      v.err = '';
    }
    part(v, 'head').innerHTML = headHtml(v);
    part(v, 'state').innerHTML = stateHtml(v, rows);
    part(v, 'table').innerHTML = tableHtml(v, rows);
    part(v, 'detail').innerHTML = detailHtml(v, rows);
    var f = box.querySelector('form[data-form]');
    if (f && typed)
      Object.keys(typed).forEach(function (name) {
        if (f.elements[name]) f.elements[name].value = typed[name];
      });
    box.setAttribute('aria-busy', v.busy ? 'true' : 'false');
    paintMap(v, rows);
    if (fk) {
      var again = Array.prototype.filter.call(box.querySelectorAll('[data-fk]'), function (el) {
        return el.getAttribute('data-fk') === fk;
      })[0];
      if (again && typeof again.focus === 'function') again.focus();
    }
  }

  function pick(v, key) {
    if (v.sel === key) return;
    v.sel = key;
    v.form = false;
    v.err = '';
    v.msg = '';
    v.center = true;
    render(v);
  }

  /** 칸이 화면에 보이면 지도를 부른다 (안 보는 화면의 지도 · 주소 찾기를 돌리지 않는다) */
  function onVisible(v) {
    ensureSdk().then(function () {
      if (!v.data) return;
      if (v.map && S.sdk === 'ready') {
        try {
          v.map.relayout(); // 감춰져 있던 지도는 크기를 다시 잰다
        } catch {
          /* 아래에서 다시 그린다 */
        }
        v.fit = v.fit || !v.sel;
      }
      paintMap(v);
      runGeo();
    });
    paintMap(v);
  }
  function watch(v) {
    var wrap = part(v, 'mapwrap');
    if (!wrap || v.watch) return;
    if (typeof window.ResizeObserver !== 'function') {
      v.watch = true;
      v.visible = true;
      onVisible(v);
      return;
    }
    v.watch = new window.ResizeObserver(function (entries) {
      var w = entries.length ? entries[entries.length - 1].contentRect.width : 0;
      var was = v.visible;
      v.visible = w > 0;
      if (v.visible && !was) onVisible(v);
    });
    v.watch.observe(boxOf(v));
  }

  // ── 누르기 · 저장 ────────────────────────────────────────────────────────────
  function calendarReload() {
    var Cal = window.SeganCalendar;
    if (Cal && typeof Cal.reload === 'function') Cal.reload();
  }
  /** 그 화면을 다시 읽는다 — 못 읽으면 본 것을 두고 글만 */
  async function reloadView(v) {
    var d = await fetchView(v);
    if (!d) {
      v.loadErr = TEXT.reloadFailed;
      render(v);
      return false;
    }
    v.loadErr = '';
    v.data = d;
    v.fit = v.fit || !v.sel;
    render(v);
    runGeo();
    return true;
  }
  /** 다른 칸(업무 달력 · A/S함)이 일정을 바꿨을 때 — 읽어 둔 화면만 다시 읽는다 */
  function reload() {
    return Promise.all(
      KINDS.map(function (k) {
        return V[k].data && !V[k].busy ? reloadView(V[k]) : null;
      })
    );
  }
  function showError(v, box, res) {
    v.err = res.message;
    render(v);
    var el = box.querySelector('form [name="' + res.error + '"]');
    if (el && typeof el.focus === 'function') el.focus();
  }
  async function submit(v, form) {
    var box = boxOf(v);
    if (v.busy || !v.form || !box) return;
    var item = v.data.items.filter(function (it) {
      return it.key === v.sel;
    })[0];
    if (!item || !v.data.manage) return;
    var values = formValues(box) || {};
    var install = form.getAttribute('data-form') === 'edit';
    var res = install ? patchOf(item, values) : visitBodyOf(item, values);
    if (res.error) return showError(v, box, res);
    if (install ? !Object.keys(res.patch).length : res.same) {
      v.form = false; // 바뀐 것이 없다 — 부르지 않고 닫는다
      v.err = '';
      render(v);
      return;
    }
    v.busy = true;
    v.err = '';
    v.msg = '';
    render(v);
    var r = install
      ? await call('PATCH', '/schedules/' + encodeURIComponent(item.schedule_id), res.patch)
      : await call(
          'PUT',
          '/company/as-requests/' + encodeURIComponent(item.as_id) + '/visit',
          res.body
        );
    v.busy = false;
    if (!r.ok) {
      v.err = errText(r);
      render(v);
      return;
    }
    v.form = false;
    v.msg = TEXT.saved;
    if (!(await reloadView(v))) {
      v.msg = TEXT.savedStale;
      render(v);
    }
    calendarReload();
  }
  function onClick(v, e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || v.busy || !v.data) return;
    var act = el.getAttribute('data-act');
    if (act === 'pick') {
      // 열어 둔 입력 칸 안을 누른 것은 줄 고르기가 아니다
      pick(v, el.getAttribute('data-key'));
    } else if (act === 'tab') {
      v.tab = el.getAttribute('data-tab') || 'all';
      v.msg = '';
      v.fit = true;
      render(v);
    } else if (act === 'unpick') {
      v.sel = '';
      v.form = false;
      v.err = '';
      v.msg = '';
      render(v);
    } else if (act === 'edit') {
      v.form = true;
      v.err = '';
      v.msg = '';
      render(v);
      var first = boxOf(v).querySelector('form [name="date"]');
      if (first && typeof first.focus === 'function') first.focus();
    } else if (act === 'close') {
      v.form = false;
      v.err = '';
      render(v);
    } else if (act === 'retry') {
      reloadView(v);
    }
  }
  function onChange(v, e) {
    var el = e.target;
    var name = el && el.getAttribute ? el.getAttribute('data-filter') : '';
    if (!name || !v.data || v.busy) return;
    if (name === 'team') v.team = el.value;
    if (name === 'region') v.region = el.value;
    v.msg = '';
    v.fit = true;
    render(v);
  }
  function bind(v) {
    var box = boxOf(v);
    if (!box || box.getAttribute('data-bound') === '1') return;
    box.setAttribute('data-bound', '1');
    box.addEventListener('click', function (e) {
      onClick(v, e);
    });
    box.addEventListener('change', function (e) {
      onChange(v, e);
    });
    box.addEventListener('submit', function (e) {
      var form = e.target && e.target.closest ? e.target.closest('form[data-form]') : null;
      if (!form) return;
      e.preventDefault();
      submit(v, form);
    });
  }

  /**
   * 설치 · A/S 지도 칸을 올린다. me = account-api GET /partner/me 의 data (segan/partner.js state.me).
   * 볼 수 없는 사람 · 못 읽은 화면은 칸째 감춘다.
   */
  async function load(sb, session, me) {
    var cfg = window.DADAM_CONFIG || {};
    S.sb = sb || null;
    S.session = session || null;
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.geo = {};
    S.geoLeft = GEO_MAX;
    await Promise.all(
      KINDS.map(async function (k) {
        var v = V[k];
        var box = boxOf(v);
        var keep = {
          map: v.map,
          canvas: v.canvas,
          overlays: v.overlays,
          watch: v.watch,
          visible: v.visible,
        };
        V[k] = v = Object.assign(viewState(k), keep);
        if (!box) return;
        box.hidden = true;
        if (!S.base || !session || !(k === 'as' ? canSeeAs(me) : canSee(me))) return;
        try {
          var d = await fetchView(v);
          if (!d) return;
          v.data = d;
          mount(v);
          bind(v);
          box.hidden = false;
          render(v);
          watch(v);
          if (v.visible) runGeo();
        } catch {
          box.hidden = true;
        }
      })
    );
  }

  window.SeganSiteMap = {
    KINDS: KINDS,
    VIEW: VIEW,
    TEXT: TEXT,
    SCHEDULE_STATUS: SCHEDULE_STATUS,
    STATUS_OPTIONS: STATUS_OPTIONS,
    AS_STATE: AS_STATE,
    GEO_MAX: GEO_MAX,
    shared: S,
    stateOf: function (kind) {
      return V[kind];
    },
    kstToday: kstToday,
    weekOf: weekOf,
    dayTitle: dayTitle,
    scheduledAtOf: scheduledAtOf,
    canSee: canSee,
    canSeeAs: canSeeAs,
    dataOf: dataOf,
    coordOf: coordOf,
    regionOf: regionOf,
    visitOf: visitOf,
    teamOf: teamOf,
    pinTone: pinTone,
    tabsOf: tabsOf,
    filterItems: filterItems,
    teamsOf: teamsOf,
    regionsOf: regionsOf,
    geoTargets: geoTargets,
    patchOf: patchOf,
    visitBodyOf: visitBodyOf,
    groupPins: groupPins,
    nextKey: nextKey,
    load: load,
    reload: reload,
  };
})();
