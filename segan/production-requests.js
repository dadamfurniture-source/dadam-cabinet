/* ============================================================
   segan/production-requests.js — 「내 정보 › 업체 › 제작 의뢰」 (segan/me.html#production-requests)

   2026-11-08 제작 의뢰: Manager 등급 업체(인테리어 업체)가 간편 플래너 설계를 다담 본사에 보낸다 →
   본사가 검토해 팩토리를 추천(보통 3곳, 많아야 5곳) → Manager 가 한 곳을 고른다 → 고른 팩토리가 24시간 안에
   받기 · 못 받음 (못 받음 · 답 없음이면 본사가 다시 추천) → 받으면 팩토리 쪽 프로젝트 · 설계 사본으로 이어진다.

   누가 보나  Manager 등급(company.plan manager) 협력업체 구성원 — account-api GET /partner/me 로 가린다.
             ★ company.plan 의 manager(등급)와 company.role 의 manager(실장)는 다르다 — 둘을 견주지 않는다.
             목록은 구성원 모두. 의뢰 내기 · 고르기 · 거두기는 서버 응답(can_create · can_choose · can_cancel)을 따른다
             (대표 · 실장이고 업체가 이용 중일 때 — 워커 production-requests/manager.js).
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganProduction.load(sb, session, partnerMe) 를 부른다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /production-requests              { ready, can_act, can_create, items[] }
               POST /production-requests              { draft_id, project_id?, note?, sido?, gugun?, wanted_done_date? } → 201
               GET  /production-requests/:id          의뢰 하나 + hq_note · recommendations[] · offers[]
               POST /production-requests/:id/choose   { company_id } — 추천 팩토리 하나 고르기
               POST /production-requests/:id/cancel   거두기 (팩토리가 받기 전에는 언제든)
               GET  /planner/drafts                   의뢰할 설계 고르기 (내 업체 간편 플래너 설계)
               GET  /company/projects                 이어 둘 프로젝트 고르기 (진행 중만 — 고르지 않아도 된다)
   화면      목록 — 의뢰 한 줄마다 품목 · 설계 이름 · 현장 지역 · 의뢰일 · 상태. 답 기다림이면 답 기한 · 남은 시간
               (기한은 목록 줄의 expires_at — 펼친 의뢰만 더 읽는다)
             「제작 의뢰」 — 시트(폰) · 옆 패널(PC, SeganShell.sheet)로 설계 · 프로젝트 · 현장 지역(팩토리 주소로 채운다) ·
               시공 완료 희망 날짜 · 요청 메모. 플래너 설계는 팩토리에 사본으로 가고 사진은 보내지 않는다
               (워커 production-requests/factory.js copyDraftToFactory).
             줄을 누르면 그 자리에 단계 · 의뢰 내용 · 본사 말 · 추천 팩토리 · 고른 기록 · 거두기.
               추천 팩토리 — 이름 · 다담 공장/팩토리 · 지역 · 본사가 적은 예상 가격대 · 제작 기간 한 줄
               (「가격대 1,200만~1,500만 원 · 제작 기간 약 20일」, 적은 값만 — 서버 price_min · price_max(원) · lead_days(일),
               DB 0055. 서버가 주지 않으면 그 줄이 없다) · 하는 품목 · 본사 소개. 의뢰 품목 · 현장 지역과 다르면
               확인 한 줄만 (막지 않는다).
               고르기 · 거두기는 가운데 창으로 한 번 더 묻는다 (SeganShell.sheet kind dialog — 막는 확인만).
             팩토리가 못 받은 사유는 본사만 본다 — 서버도 싣지 않고 이 화면도 그리지 않는다.
   못 읽으면  처음(403 · 404 · 오류 · 끊김 · ready false — DB 0050 전) → 칸째 감춘다.
   알림      추천 도착 · 팩토리 답 알림이 me.html#production-requests 를 연다 (워커 push/messages.js PRODUCTION_REQUESTS_URL).
             앱이 열린 채 주소의 # 만 바뀌면 목록을 다시 읽는다.
   ============================================================ */
/* global window, document, fetch, location, setInterval */
(function () {
  'use strict';

  var PLANS = ['manager']; // 의뢰를 내는 등급 (companies.plan) — 워커 production-requests/common.js REQUEST_PLANS
  var MEMBER_ROLES = ['owner', 'manager', 'staff']; // 구성원 직책 (company.role — manager 는 실장)
  var HASH = '#production-requests';
  var NOTE_MAX = 1000; // 워커 production-requests/common.js NOTE_MAX
  var OFFER_TTL_HOURS = 24; // 워커 OFFER_TTL_HOURS (상담 배정과 같은 24시간)
  var TICK_MS = 30000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DRAFT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{3,80}$/; // 워커 planner-drafts.js DRAFT_ID_RE
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // 품목 — 워커 consult-notify.js FURNITURE_LABELS (플래너 설계의 item 키)
  var ITEMS = {
    sink: '싱크대',
    island: '아일랜드',
    wardrobe: '붙박이장',
    fridge: '냉장고장',
    shoerack: '신발장',
    vanity: '화장대',
    storage: '수납장',
    other: '기타',
  };
  // 의뢰 상태 — 워커 production-requests/common.js STATUS_LABEL
  var STATUS_LABEL = {
    submitted: '접수',
    recommending: '본사 검토 중',
    recommended: '추천 도착',
    chosen: '팩토리 답 기다림',
    accepted: '팩토리가 받음',
    declined: '팩토리가 못 받음',
    expired: '팩토리 답 없음',
    cancelled: '거둠',
  };
  // 단계 막대 — 못 받음 · 답 없음은 본사 차례(다시 추천)라 「본사 검토」 칸에 둔다, 거둠은 칸이 없다
  var STEPS = [
    ['submitted', '접수'],
    ['recommending', '본사 검토'],
    ['recommended', '추천 도착'],
    ['chosen', '팩토리 답 기다림'],
    ['accepted', '받음'],
  ];
  var STEP_OF = {
    submitted: 0,
    recommending: 1,
    declined: 1,
    expired: 1,
    recommended: 2,
    chosen: 3,
    accepted: 4,
  };
  // 고른 팩토리의 답 (offer.state) — 워커 common.js offerState
  var OFFER_LABEL = {
    open: '답 기다림',
    accepted: '받음',
    declined: '못 받음',
    expired: '답 없음',
    cancelled: '거둠',
  };

  var TEXT = {
    lead:
      '플래너 설계를 다담 본사에 보내면 본사가 검토해 팩토리를 추천합니다. 그 가운데 한 곳을 고르면 그 팩토리가 ' +
      OFFER_TTL_HOURS +
      '시간 안에 받기 · 못 받음을 답합니다.',
    leadStaff: '의뢰 · 고르기 · 거두기는 대표 · 실장이 합니다.',
    empty: '아직 제작 의뢰가 없습니다.',
    open: '제작 의뢰',
    formTitle: '제작 의뢰',
    formLead: '다담 본사가 의뢰를 검토해 맞는 팩토리를 추천합니다.',
    photoNote:
      '고른 플래너 설계는 팩토리가 받을 때 사본으로 넘어갑니다. 현장 사진은 보내지 않습니다.',
    regionNote: '팩토리 주소로 채웠습니다. 현장이 다르면 바꿔 주세요.',
    projectNone: '고르지 않음',
    projectNote: '앱으로 보낸 설계면 그 프로젝트가 저절로 이어집니다.',
    noDrafts: '저장한 플래너 설계가 없습니다. 설계(플래너)에서 먼저 저장해 주세요.',
    draftsFail: '플래너 설계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    pickDraft: '의뢰할 설계를 골라 주세요.',
    draftBusy: '이 설계로 이미 열린 제작 의뢰가 있습니다.',
    regionPick: '시/군/구는 시/도와 같이 골라 주세요.',
    dateBad: '시공 완료 희망 날짜를 다시 골라 주세요.',
    noteLong: '요청 메모는 ' + NOTE_MAX + '자까지 적을 수 있습니다.',
    sent: '제작 의뢰를 보냈습니다. 본사가 검토해 팩토리를 추천합니다.',
    detailLoading: '불러오는 중…',
    detailFail: '의뢰를 불러오지 못했습니다.',
    recsTitle: '추천 팩토리',
    recsPick: '추천한 팩토리 가운데 한 곳을 골라 주세요.',
    offersTitle: '고른 기록',
    hqNote: '본사 말',
    choose: '이 팩토리에 맡기기',
    chooseTitle: '팩토리 고르기',
    chosen: '맡겼습니다. 팩토리가 ' + OFFER_TTL_HOURS + '시간 안에 답합니다.',
    cancel: '의뢰 거두기',
    cancelTitle: '제작 의뢰 거두기',
    cancelAsk: '이 제작 의뢰를 거둘까요? 거둔 뒤 같은 설계로 다시 의뢰할 수 있습니다.',
    cancelAskChosen: ' 답을 기다리던 팩토리의 의뢰도 닫힙니다.',
    cancelled: '제작 의뢰를 거뒀습니다.',
    late: '답할 시간이 지났습니다',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };
  // 상태마다 지금 무슨 일인지 한 줄 (팩토리가 못 받은 사유는 싣지 않는다 — 본사만 본다)
  var STATUS_NOTE = {
    submitted: '본사가 의뢰를 받았습니다. 의뢰 내용을 살펴본 뒤 팩토리를 추천합니다.',
    recommending: '본사가 검토하고 있습니다. 추천이 오면 알림으로 알려 드립니다.',
    recommended: '본사가 추천한 팩토리 가운데 한 곳을 골라 주세요.',
    chosen:
      '고른 팩토리의 답을 기다립니다. ' +
      OFFER_TTL_HOURS +
      '시간 안에 답이 없으면 본사가 다시 추천합니다.',
    accepted: '팩토리가 받았습니다. 설계 사본이 팩토리로 넘어갔습니다.',
    declined: '고른 팩토리가 받지 못했습니다. 본사가 다시 추천합니다.',
    expired:
      '고른 팩토리가 ' + OFFER_TTL_HOURS + '시간 안에 답하지 않았습니다. 본사가 다시 추천합니다.',
    cancelled: '거둔 의뢰입니다.',
  };

  var S = {
    sb: null,
    session: null,
    base: '', // workflow-api
    me: null, // GET /partner/me data
    data: null, // { act, create, items } — 못 읽으면 null
    pick: '', // 펼친 의뢰 id
    detail: {}, // 의뢰 id → GET /production-requests/:id data | 'loading' | null(못 읽음)
    msg: '', // 칸 위 한 줄
    note: null, // { id, text, error } — 그 의뢰 안 한 줄
    busy: false,
    sheet: null, // 의뢰 내기 시트 손잡이
    dialog: null, // 고르기 · 거두기 확인 창
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

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 { date: 'YYYY.MM.DD', time: 'HH:MM' } (ISO UTC 로 온 시각) */
  function kst(iso) {
    var t = Date.parse(iso || '');
    if (isNaN(t)) return null;
    var k = new Date(t + 9 * 3600 * 1000);
    return {
      date: k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate()),
      time: pad(k.getUTCHours()) + ':' + pad(k.getUTCMinutes()),
    };
  }

  function kstDay(iso) {
    var k = kst(iso);
    return k ? k.date : '';
  }

  function kstTime(iso) {
    var k = kst(iso);
    return k ? k.date + ' ' + k.time : '';
  }

  /** 'YYYY-MM-DD' → 'YYYY.MM.DD' (날짜만 온 값 — Date 로 바꾸면 시간대에 따라 하루 밀린다) */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s));
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }

  /** 남은 시간 — 서버가 준 기한까지 (segan/partner-consults.js 와 같은 글) */
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

  /** 답 기한 한 줄 — 「답 기한 YYYY.MM.DD HH:MM · 남은 시간 …」 */
  function deadlineText(expires, now) {
    var at = kstTime(expires);
    if (!at) return '';
    return '답 기한 ' + at + ' · ' + leftText(expires, now);
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  function isHq(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }

  /** 제작 의뢰 칸을 보이나 — Manager 등급 협력업체 구성원 (다담 공장 구성원은 팩토리 쪽이다) */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me) || isHq(me)) return false;
    var c = me.company;
    return !!(
      c &&
      typeof c === 'object' &&
      PLANS.indexOf(c.plan) >= 0 &&
      MEMBER_ROLES.indexOf(c.role) >= 0
    );
  }

  /** GET /production-requests 본문 → { act, create, items } | null (ready 가 아니거나 모양이 틀리면 null) */
  function listOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || d.ready !== true || !Array.isArray(d.items)) return null;
    return {
      act: d.can_act === true,
      create: d.can_create === true,
      items: d.items.filter(function (x) {
        return x && typeof x === 'object' && UUID_RE.test(String(x.id || ''));
      }),
    };
  }

  /** 원 → 「1,200만」(만 원으로 떨어질 때) · 「12,345,678」 — 뒤 「원」은 wonUnit */
  function wonText(n) {
    return n > 0 && n % 10000 === 0
      ? (n / 10000).toLocaleString('ko-KR') + '만'
      : n.toLocaleString('ko-KR');
  }

  /** 「1,200만 원」 · 「12,345,678원」 — 만 원으로 떨어지면 띄어 쓴다 */
  function wonUnit(n) {
    return n > 0 && n % 10000 === 0 ? ' 원' : '원';
  }

  /**
   * 본사가 적은 예상 가격대 · 제작 기간 한 줄 — 「가격대 1,200만~1,500만 원 · 제작 기간 약 20일」.
   * 적은 값만: 최소만 「가격대 1,200만 원부터」, 최대만 「가격대 1,500만 원까지」, 둘이 같으면 「가격대 1,200만 원」.
   * 만 원으로 떨어지지 않는 값은 원 그대로 「12,345,678원」.
   * 서버 price_min · price_max(원, 0 이상 정수) · lead_days(일, 1 이상 정수) — 모양이 틀린 값은 적지 않은 것으로 본다. 없으면 ''
   */
  function estimateText(f) {
    var won = function (v) {
      return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
    };
    var lo = won(f && f.price_min);
    var hi = won(f && f.price_max);
    var lead = f && Number.isSafeInteger(f.lead_days) && f.lead_days >= 1 ? f.lead_days : null;
    var out = [];
    if (lo !== null && hi !== null)
      out.push(
        '가격대 ' + (lo === hi ? wonText(lo) : wonText(lo) + '~' + wonText(hi)) + wonUnit(hi)
      );
    else if (lo !== null) out.push('가격대 ' + wonText(lo) + wonUnit(lo) + '부터');
    else if (hi !== null) out.push('가격대 ' + wonText(hi) + wonUnit(hi) + '까지');
    if (lead !== null) out.push('제작 기간 약 ' + lead + '일');
    return out.join(' · ');
  }

  /** 단계 막대에서 지금 칸 (거둠 · 모르는 상태는 -1) */
  function stepIndex(status) {
    return has(STEP_OF, status) ? STEP_OF[status] : -1;
  }

  /** 열린 의뢰(받음 · 거둠 전)가 걸린 플래너 설계 id — 같은 설계로 두 번 의뢰하지 않게 (서버 409 open_request) */
  function busyDrafts(items) {
    var out = {};
    arr(items).forEach(function (x) {
      if (!x || x.status === 'accepted' || x.status === 'cancelled') return;
      var id = x.draft && typeof x.draft === 'object' ? x.draft.id : '';
      if (typeof id === 'string' && id) out[id] = true;
    });
    return out;
  }

  /** 플래너 설계 한 줄 이름 — 「이름 · 품목 · 벽 n · 모듈 n」 */
  function draftLabel(d) {
    if (!d || typeof d !== 'object') return '';
    var parts = [d.name ? String(d.name) : '이름 없는 설계'];
    if (has(ITEMS, d.item)) parts.push(ITEMS[d.item]);
    var walls = Number(d.walls);
    var mods = Number(d.modules);
    if (walls > 0) parts.push('벽 ' + walls);
    if (mods > 0) parts.push('모듈 ' + mods);
    return parts.join(' · ');
  }

  /**
   * 추천 팩토리가 의뢰와 다른 점 — 확인 한 줄씩 (막지 않는다).
   *   품목: 팩토리 「하는 품목」(상담 설정)을 알고, 의뢰 품목이 그 안에 없을 때
   *   지역: 현장 시/도와 팩토리 주소의 시/도가 다를 때 (둘 중 하나를 모르면 적지 않는다)
   */
  function hintsOf(req, f) {
    var out = [];
    var want = req && typeof req.item_label === 'string' ? req.item_label : '';
    var items = arr(f && f.items);
    if (want && items.length && items.indexOf(want) < 0)
      out.push('품목 확인 — 하는 품목에 「' + want + '」 없음');
    var sido = req && typeof req.sido === 'string' ? req.sido : '';
    var region = f && typeof f.region === 'string' ? f.region : '';
    if (sido && region && region.split(' ')[0] !== sido)
      out.push('지역 확인 — 현장 ' + (req.region || sido) + ' · 팩토리 ' + region);
    return out;
  }

  /**
   * 의뢰 칸 값 → 보낼 본문 | { error, field } (서버와 같은 검사)
   * v = { draft_id, project_id, sido, gugun, wanted_done_date, note }, busy = 열린 의뢰가 걸린 설계 id
   */
  function bodyOf(v, busy) {
    var draft = String(v.draft_id || '');
    if (!DRAFT_ID_RE.test(draft)) return { error: TEXT.pickDraft, field: 'draft_id' };
    if (busy && busy[draft]) return { error: TEXT.draftBusy, field: 'draft_id' };
    var out = { draft_id: draft };
    var project = String(v.project_id || '');
    if (project) {
      if (!UUID_RE.test(project)) return { error: TEXT.generic, field: 'project_id' };
      out.project_id = project;
    }
    var sido = String(v.sido || '').trim();
    var gugun = String(v.gugun || '').trim();
    if (gugun && !sido) return { error: TEXT.regionPick, field: 'sido' };
    if (sido) out.sido = sido;
    if (gugun) out.gugun = gugun;
    var date = String(v.wanted_done_date || '').trim();
    if (date) {
      if (!DATE_RE.test(date)) return { error: TEXT.dateBad, field: 'wanted_done_date' };
      out.wanted_done_date = date;
    }
    var note = String(v.note || '').trim();
    if ([...note].length > NOTE_MAX) return { error: TEXT.noteLong, field: 'note' };
    if (note) out.note = note;
    return { body: out };
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

  function titleOf(x) {
    var d = x.draft && typeof x.draft === 'object' ? x.draft : null;
    var name = d && d.name ? String(d.name) : '플래너 설계';
    return x.item_label ? x.item_label + ' · ' + name : name;
  }

  /** 답 기다림 의뢰의 기한 — 목록 줄의 expires_at (workflow-api 목록), 없으면 읽어 둔 의뢰의 고른 팩토리 줄에서 */
  function expiresOf(x) {
    if (x && x.expires_at) return x.expires_at;
    var d = x ? S.detail[x.id] : null;
    if (!d || typeof d !== 'object') return '';
    var recs = arr(d.recommendations);
    for (var i = 0; i < recs.length; i++) {
      var o = recs[i] && recs[i].offer;
      if (recs[i].chosen && o && o.state === 'open' && o.expires_at) return o.expires_at;
    }
    return '';
  }

  function leftHtml(expires, now) {
    var t = deadlineText(expires, now);
    return t ? '<p class="me-cs-left" data-expires="' + esc(expires) + '">' + esc(t) + '</p>' : '';
  }

  function stepsHtml(status) {
    var at = stepIndex(status);
    return (
      '<ol class="me-steps me-steps--5" aria-label="진행 단계">' +
      STEPS.map(function (s, i) {
        return (
          '<li class="me-step' +
          (i <= at ? ' me-step--done' : '') +
          '"' +
          (i === at ? ' aria-current="step"' : '') +
          '>' +
          esc(s[1]) +
          '</li>'
        );
      }).join('') +
      '</ol>'
    );
  }

  function factsHtml(r) {
    var f = [];
    var d = r.draft && typeof r.draft === 'object' ? r.draft : null;
    if (d) {
      var size = [];
      if (Number(d.walls) > 0) size.push('벽 ' + Number(d.walls));
      if (Number(d.modules) > 0) size.push('모듈 ' + Number(d.modules));
      f.push(fact('설계', esc([d.name || '플래너 설계'].concat(size).join(' · '))));
    }
    if (r.project && typeof r.project === 'object')
      f.push(fact('프로젝트', esc(r.project.title || '프로젝트')));
    if (r.item_label) f.push(fact('품목', esc(r.item_label)));
    if (r.region) f.push(fact('현장 지역', esc(r.region)));
    if (day(r.wanted_done_date))
      f.push(fact('희망 시기', esc(day(r.wanted_done_date)) + ' 시공 완료'));
    if (typeof r.note === 'string' && r.note)
      f.push('<div class="me-cs-desc"><dt>요청 메모</dt><dd>' + esc(r.note) + '</dd></div>');
    if (kstDay(r.created_at)) f.push(fact('의뢰일', esc(kstDay(r.created_at))));
    return f.length ? '<dl class="me-facts">' + f.join('') + '</dl>' : '';
  }

  function recHtml(r, f) {
    var hints = hintsOf(r, f);
    var o = f.chosen && f.offer && typeof f.offer === 'object' ? f.offer : null;
    var estimate = estimateText(f);
    var facts = [];
    var items = arr(f.items);
    facts.push(fact('하는 품목', esc(items.length ? items.join(' · ') : '-')));
    if (f.note) facts.push(fact('본사 소개', esc(f.note)));
    // 고른 팩토리 — 답 (답 기한 · 남은 시간은 의뢰 줄 위에 한 번만 적는다)
    var offer = o
      ? '<p class="me-pt-msg" data-offer>' +
        esc(
          ['고름', has(OFFER_LABEL, o.state) ? OFFER_LABEL[o.state] : '']
            .filter(Boolean)
            .join(' · ')
        ) +
        '</p>'
      : '';
    return (
      '<li class="me-prq-rec" data-company="' +
      esc(f.company_id) +
      '"><p class="me-prq-rec-head"><b>' +
      esc(f.name || '팩토리') +
      '</b><span>' +
      esc([f.factory_label || '팩토리', f.region || ''].filter(Boolean).join(' · ')) +
      '</span></p>' +
      (estimate ? '<p class="me-pt-msg" data-estimate>' + esc(estimate) + '</p>' : '') +
      '<dl class="me-facts">' +
      facts.join('') +
      '</dl>' +
      hints
        .map(function (h) {
          return '<p class="me-pt-warn" data-hint>' + esc(h) + '</p>';
        })
        .join('') +
      offer +
      (r.can_choose === true
        ? '<div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="choose" data-id="' +
          esc(r.id) +
          '" data-company="' +
          esc(f.company_id) +
          '"' +
          (S.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.choose) +
          '</button></div>'
        : '') +
      '</li>'
    );
  }

  function offersHtml(list) {
    if (!list.length) return '';
    return (
      '<p class="me-pt-title">' +
      esc(TEXT.offersTitle) +
      '</p><ul class="me-prq-offers" data-offers>' +
      list
        .map(function (o) {
          return (
            '<li>' +
            esc(
              [
                (Number(o.round) > 0 ? Number(o.round) + '차 ' : '') + (o.name || '팩토리'),
                has(OFFER_LABEL, o.state) ? OFFER_LABEL[o.state] : '',
                kstTime(o.chosen_at) ? '고름 ' + kstTime(o.chosen_at) : '',
                kstTime(o.responded_at) ? '답 ' + kstTime(o.responded_at) : '',
              ]
                .filter(Boolean)
                .join(' · ')
            ) +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function detailHtml(id) {
    var r = S.detail[id];
    if (r === 'loading') return '<p class="sg-note">' + esc(TEXT.detailLoading) + '</p>';
    if (!r || typeof r !== 'object')
      return '<p class="me-pt-msg" role="status">' + esc(TEXT.detailFail) + '</p>';
    var recs = arr(r.recommendations).filter(function (f) {
      return f && typeof f === 'object' && UUID_RE.test(String(f.company_id || ''));
    });
    // 추천 팩토리 — 고를 차례이거나 고른 뒤(답 기다림 · 받음)에 보인다. 본사 차례로 돌아오면 다음 추천을 기다린다
    var showRecs = recs.length && ['recommended', 'chosen', 'accepted'].indexOf(r.status) >= 0;
    return (
      '<div class="me-prq-detail">' +
      stepsHtml(r.status) +
      (has(STATUS_NOTE, r.status)
        ? '<p class="me-pt-msg" data-status-note>' + esc(STATUS_NOTE[r.status]) + '</p>'
        : '') +
      factsHtml(r) +
      (r.hq_note
        ? '<dl class="me-facts"><div class="me-cs-desc"><dt>' +
          esc(TEXT.hqNote) +
          '</dt><dd>' +
          esc(r.hq_note) +
          '</dd></div></dl>'
        : '') +
      (showRecs
        ? '<p class="me-pt-title">' +
          esc(TEXT.recsTitle) +
          '</p><ol class="me-prq-recs">' +
          recs
            .map(function (f) {
              return recHtml(r, f);
            })
            .join('') +
          '</ol>'
        : '') +
      offersHtml(arr(r.offers)) +
      (r.can_cancel === true
        ? '<div class="rd-acts"><button type="button" class="mk-btn" data-act="cancel" data-id="' +
          esc(r.id) +
          '"' +
          (S.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.cancel) +
          '</button></div>'
        : '') +
      '</div>'
    );
  }

  function itemHtml(x, now) {
    var sel = S.pick === x.id;
    var sub = [x.region || '', kstDay(x.created_at) ? '의뢰 ' + kstDay(x.created_at) : '']
      .filter(Boolean)
      .join(' · ');
    var line = '';
    if (x.status === 'chosen') {
      var f = x.factory && typeof x.factory === 'object' ? x.factory : null;
      line =
        (f && f.name
          ? '<p class="me-pt-msg">' + esc('「' + f.name + '」 답 기다림') + '</p>'
          : '') + leftHtml(expiresOf(x), now);
    } else if (x.status === 'recommended' && Number(x.recommendation_count) > 0) {
      line =
        '<p class="me-pt-msg">' +
        esc('추천 ' + Number(x.recommendation_count) + '곳 — 골라 주세요') +
        '</p>';
    }
    return (
      '<li class="me-cs-item' +
      (x.status === 'cancelled' ? ' me-cs-item--off' : '') +
      '" data-request="' +
      esc(x.id) +
      '"><button type="button" class="me-prq-pick" data-act="pick" data-id="' +
      esc(x.id) +
      '" aria-expanded="' +
      sel +
      '"><span class="me-c-main"><b>' +
      esc(titleOf(x)) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span><span class="me-badge">' +
      esc(x.label || (has(STATUS_LABEL, x.status) ? STATUS_LABEL[x.status] : '')) +
      '</span></button>' +
      line +
      (S.note && S.note.id === x.id ? noteHtml(S.note) : '') +
      (sel ? detailHtml(x.id) : '') +
      '</li>'
    );
  }

  function render() {
    var box = $('production-requests');
    if (!box) return;
    var d = S.data;
    if (!d) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var now = Date.now();
    var matched =
      S.note &&
      d.items.some(function (x) {
        return x.id === S.note.id;
      });
    box.innerHTML =
      '<h3 class="me-pt-sub" id="productionTitle">제작 의뢰</h3>' +
      '<p class="mk-note">' +
      esc(TEXT.lead + (d.act ? '' : ' ' + TEXT.leadStaff)) +
      '</p>' +
      (S.msg ? '<p class="me-pt-msg" role="status">' + esc(S.msg) + '</p>' : '') +
      (S.note && !matched ? noteHtml(S.note) : '') +
      (d.create
        ? '<div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="new"' +
          (S.busy ? ' disabled' : '') +
          '>' +
          esc(TEXT.open) +
          '</button></div>'
        : '') +
      (d.items.length
        ? '<ul class="me-cs-list me-prq-list">' +
          d.items
            .map(function (x) {
              return itemHtml(x, now);
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>');
    box.hidden = false;
    startTick();
  }

  // ── 의뢰 칸 (시트 · 옆 패널) ─────────────────────────────
  function optionHtml(value, label, selected, disabled) {
    return (
      '<option value="' +
      esc(value) +
      '"' +
      (selected ? ' selected' : '') +
      (disabled ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</option>'
    );
  }

  /** 시/도 · 시/군/구 — segan/regions.js (signup.html 과 같은 목록), 고른 값으로 채운다 */
  function regionHtml(sido, gugun) {
    var R = window.SeganRegions || {};
    var list = has(R, sido) ? R[sido] : [];
    return (
      '<div class="cs-region"><label class="mk-input"><span>시/도</span><select name="sido">' +
      optionHtml('', '시/도 선택', !sido, false) +
      Object.keys(R)
        .map(function (s) {
          return optionHtml(s, s, s === sido, false);
        })
        .join('') +
      '</select></label><label class="mk-input"><span>시/군/구</span><select name="gugun"' +
      (list.length ? '' : ' disabled') +
      '>' +
      optionHtml('', '시/군/구 선택', !gugun, false) +
      list
        .map(function (g) {
          return optionHtml(g, g, g === gugun, false);
        })
        .join('') +
      '</select></label></div>'
    );
  }

  function fillGugun(form) {
    var R = window.SeganRegions || {};
    var sido = form.querySelector('select[name="sido"]');
    var gugun = form.querySelector('select[name="gugun"]');
    if (!sido || !gugun) return;
    var list = has(R, sido.value) ? R[sido.value] : [];
    gugun.innerHTML =
      optionHtml('', '시/군/구 선택', true, false) +
      list
        .map(function (g) {
          return optionHtml(g, g, false, false);
        })
        .join('');
    gugun.disabled = !list.length;
  }

  /** 팩토리 주소 — 목록에 있는 시/도 · 시/군/구만 (없으면 빈 값) */
  function companyRegion() {
    var R = window.SeganRegions || {};
    var c = S.me && S.me.company && typeof S.me.company === 'object' ? S.me.company : {};
    var sido = typeof c.sido === 'string' && has(R, c.sido) ? c.sido : '';
    var gugun = sido && typeof c.gugun === 'string' && R[sido].indexOf(c.gugun) >= 0 ? c.gugun : '';
    return { sido: sido, gugun: gugun };
  }

  function formInner(drafts, projects) {
    if (!drafts.length) return '<p class="me-pt-msg" role="status">' + esc(TEXT.noDrafts) + '</p>';
    var busy = busyDrafts(S.data && S.data.items);
    var reg = companyRegion();
    return (
      '<p class="mk-note">' +
      esc(TEXT.formLead) +
      '</p>' +
      '<label class="mk-input"><span>설계</span><select name="draft_id">' +
      optionHtml('', '설계 고르기', true, false) +
      drafts
        .map(function (d) {
          var on = busy[d.id] === true;
          return optionHtml(d.id, draftLabel(d) + (on ? ' (의뢰 중)' : ''), false, on);
        })
        .join('') +
      '</select></label>' +
      (projects.length
        ? '<label class="mk-input"><span>프로젝트 (고르지 않아도 됩니다)</span><select name="project_id">' +
          optionHtml('', TEXT.projectNone, true, false) +
          projects
            .map(function (p) {
              var who = p.customer && p.customer.name ? ' · ' + p.customer.name : '';
              return optionHtml(p.id, (p.title || '프로젝트') + who, false, false);
            })
            .join('') +
          '</select></label><p class="mk-note">' +
          esc(TEXT.projectNote) +
          '</p>'
        : '') +
      '<fieldset class="cs-set"><legend>현장 지역</legend>' +
      regionHtml(reg.sido, reg.gugun) +
      (reg.sido ? '<p class="mk-note" data-region-note>' + esc(TEXT.regionNote) + '</p>' : '') +
      '</fieldset>' +
      '<label class="mk-input"><span>시공 완료 희망 날짜 (없으면 비워 두세요)</span><input name="wanted_done_date" type="date" /></label>' +
      '<label class="mk-input"><span>요청 메모</span><textarea name="note" rows="4" maxlength="' +
      NOTE_MAX +
      '" placeholder="예: 상판은 세라믹으로 생각하고 있습니다."></textarea></label>' +
      '<p class="me-pt-warn" data-photo-note>' +
      esc(TEXT.photoNote) +
      '</p>' +
      '<p class="mk-error" data-err role="alert" hidden></p>' +
      '<div class="mk-acts"><button type="submit" class="mk-btn mk-btn--solid">본사에 의뢰</button>' +
      '<button type="button" class="mk-btn" data-act="close">닫기</button></div>'
    );
  }

  function formError(form, msg, field) {
    var el = form.querySelector('[data-err]');
    if (el) {
      el.textContent = msg || '';
      el.hidden = !msg;
    }
    form.querySelectorAll('[aria-invalid]').forEach(function (x) {
      x.removeAttribute('aria-invalid');
    });
    var f = field ? form.querySelector('[name="' + field + '"]') : null;
    if (f) {
      f.setAttribute('aria-invalid', 'true');
      if (f.focus) f.focus();
    }
  }

  function setFormBusy(form, busy) {
    form.querySelectorAll('button, select, input, textarea').forEach(function (el) {
      if (busy) {
        if (!el.disabled) el.setAttribute('data-was-on', '1');
        el.disabled = true;
      } else if (el.getAttribute('data-was-on')) {
        el.removeAttribute('data-was-on');
        el.disabled = false;
      }
    });
  }

  function valuesOf(form) {
    var get = function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? el.value : '';
    };
    return {
      draft_id: get('draft_id'),
      project_id: get('project_id'),
      sido: get('sido'),
      gugun: get('gugun'),
      wanted_done_date: get('wanted_done_date'),
      note: get('note'),
    };
  }

  async function submitForm(form) {
    if (S.busy) return;
    var got = bodyOf(valuesOf(form), busyDrafts(S.data && S.data.items));
    if (got.error) return formError(form, got.error, got.field);
    formError(form, '');
    S.busy = true;
    setFormBusy(form, true);
    var r = await call('POST', '/production-requests', got.body);
    S.busy = false;
    if (!r.ok) {
      setFormBusy(form, false);
      formError(form, messageOf(r), r.body && r.body.code === 'open_request' ? 'draft_id' : '');
      return;
    }
    var made = r.body.data && typeof r.body.data === 'object' ? r.body.data : null;
    if (S.sheet) await S.sheet.close();
    S.sheet = null;
    S.msg = TEXT.sent;
    S.note = null;
    S.pick = made && UUID_RE.test(String(made.id || '')) ? made.id : '';
    await reload();
  }

  /** 「제작 의뢰」 — 설계 · 프로젝트를 읽고 시트(폰) · 옆 패널(PC)을 연다 */
  async function openForm() {
    var sheet = window.SeganShell && window.SeganShell.sheet;
    if (!sheet || S.busy) return;
    S.busy = true;
    S.msg = '';
    render();
    var got = await Promise.all([call('GET', '/planner/drafts'), call('GET', '/company/projects')]);
    S.busy = false;
    var dd =
      got[0].ok && got[0].body.data && typeof got[0].body.data === 'object'
        ? got[0].body.data
        : null;
    if (!dd || !Array.isArray(dd.items)) {
      S.msg = TEXT.draftsFail;
      render();
      return;
    }
    var drafts = dd.items.filter(function (d) {
      return d && typeof d === 'object' && DRAFT_ID_RE.test(String(d.id || ''));
    });
    var pd =
      got[1].ok && got[1].body.data && typeof got[1].body.data === 'object'
        ? got[1].body.data
        : null;
    // 진행 중 프로젝트만 이을 수 있다 (워커 manager.js project_closed)
    var projects = (pd && Array.isArray(pd.items) ? pd.items : []).filter(function (p) {
      return (
        p && typeof p === 'object' && UUID_RE.test(String(p.id || '')) && p.status === 'active'
      );
    });
    render();
    var form = document.createElement('form');
    form.className = 'me-prq-form';
    form.setAttribute('data-form', 'production');
    form.noValidate = true;
    form.innerHTML = formInner(drafts, projects);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      submitForm(form);
    });
    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'sido') fillGugun(form);
    });
    form.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-act="close"]') : null;
      if (b && S.sheet && !S.busy) S.sheet.close();
    });
    var h = sheet.open({
      title: TEXT.formTitle,
      body: form,
      kind: 'sheet',
      onClose: function () {
        if (S.sheet === h) S.sheet = null;
      },
    });
    S.sheet = h;
  }

  // ── 가운데 창 (막는 확인만 — segan/make.js confirmDialog 와 같은 모양) ──
  function confirmDialog(title, text, yesLabel, onYes) {
    var sheet = window.SeganShell && window.SeganShell.sheet;
    if (!sheet) return null;
    var body = document.createElement('div');
    body.className = 'mk-confirm';
    var p = document.createElement('p');
    p.className = 'mk-note';
    p.textContent = text;
    var err = document.createElement('p');
    err.className = 'mk-error';
    err.setAttribute('role', 'alert');
    err.setAttribute('data-err', '');
    err.hidden = true;
    var acts = document.createElement('div');
    acts.className = 'mk-acts';
    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'mk-btn mk-btn--solid';
    yes.setAttribute('data-confirm', 'yes');
    yes.textContent = yesLabel;
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'mk-btn';
    no.setAttribute('data-confirm', 'no');
    no.textContent = '그대로 두기';
    acts.appendChild(yes);
    acts.appendChild(no);
    body.appendChild(p);
    body.appendChild(err);
    body.appendChild(acts);
    var h = sheet.open({ title: title, body: body, kind: 'dialog', initialFocus: no });
    no.addEventListener('click', function () {
      h.close();
    });
    yes.addEventListener('click', async function () {
      yes.disabled = true;
      no.disabled = true;
      var msg = await onYes();
      if (!msg) return; // 해냈다 — onYes 가 창을 닫는다
      err.textContent = msg;
      err.hidden = false;
      yes.disabled = false;
      no.disabled = false;
    });
    S.dialog = h;
    return h;
  }

  function askChoose(id, companyId) {
    var r = S.detail[id];
    if (!r || typeof r !== 'object' || r.can_choose !== true) return;
    var f = arr(r.recommendations).filter(function (x) {
      return x && x.company_id === companyId;
    })[0];
    if (!f) return;
    var name = f.name || '팩토리';
    confirmDialog(
      TEXT.chooseTitle,
      '「' +
        name +
        '」에 제작을 맡길까요? 그 팩토리가 ' +
        OFFER_TTL_HOURS +
        '시간 안에 받기 · 못 받음을 답합니다. 답을 기다리는 동안에는 다른 팩토리를 고를 수 없습니다.',
      '맡기기',
      async function () {
        S.busy = true;
        var res = await call('POST', '/production-requests/' + encodeURIComponent(id) + '/choose', {
          company_id: companyId,
        });
        S.busy = false;
        var code = res.body && res.body.code;
        // 그사이 의뢰가 바뀌었으면(stale · 추천 도착 아님) 창을 닫고 다시 읽는다, 다른 실패는 창 안에 적는다
        if (!res.ok && code !== 'stale' && code !== 'not_recommended') return messageOf(res);
        if (S.dialog) await S.dialog.close();
        S.dialog = null;
        S.note = res.ok
          ? { id: id, text: '「' + name + '」에 ' + TEXT.chosen }
          : { id: id, text: messageOf(res), error: true };
        await reload();
        return '';
      }
    );
  }

  function askCancel(id) {
    var r = S.detail[id];
    if (!r || typeof r !== 'object' || r.can_cancel !== true) return;
    confirmDialog(
      TEXT.cancelTitle,
      TEXT.cancelAsk + (r.status === 'chosen' ? TEXT.cancelAskChosen : ''),
      '거두기',
      async function () {
        S.busy = true;
        var res = await call('POST', '/production-requests/' + encodeURIComponent(id) + '/cancel');
        S.busy = false;
        var code = res.body && res.body.code;
        if (!res.ok && code !== 'stale' && code !== 'not_cancellable') return messageOf(res);
        if (S.dialog) await S.dialog.close();
        S.dialog = null;
        S.note = res.ok
          ? { id: id, text: TEXT.cancelled }
          : { id: id, text: messageOf(res), error: true };
        await reload();
        return '';
      }
    );
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
    var r = await call('GET', '/production-requests');
    return r.ok ? listOf(r.body) : null;
  }

  async function fetchDetail(id) {
    var r = await call('GET', '/production-requests/' + encodeURIComponent(id));
    var d = r.ok ? r.body.data : null;
    return d && typeof d === 'object' && d.id === id ? d : null;
  }

  /** 펼친 의뢰를 읽는다 (답 기한은 목록 줄이 준다) */
  async function loadDetails() {
    var items = (S.data && S.data.items) || [];
    var want = items
      .filter(function (x) {
        return x.id === S.pick;
      })
      .map(function (x) {
        return x.id;
      });
    var got = await Promise.all(want.map(fetchDetail));
    var next = {};
    want.forEach(function (id, i) {
      next[id] = got[i];
    });
    S.detail = next;
  }

  /** 목록 · 펼친 의뢰를 다시 읽는다. 못 읽으면 앞서 그린 목록을 두고 한 줄로 알린다 */
  async function reload() {
    var list = await fetchList();
    if (!list) {
      if (!S.note) S.msg = TEXT.generic;
      render();
      return;
    }
    S.data = list;
    if (
      S.pick &&
      !list.items.some(function (x) {
        return x.id === S.pick;
      })
    )
      S.pick = '';
    await loadDetails();
    render();
  }

  async function pick(id) {
    S.note = null;
    S.msg = '';
    if (S.pick === id) {
      S.pick = '';
      render();
      return;
    }
    S.pick = id;
    // 읽어 둔 것이 있으면 먼저 그리고, 늘 새로 읽는다 (그사이 추천 · 답이 왔을 수 있다)
    if (!S.detail[id] || typeof S.detail[id] !== 'object') S.detail[id] = 'loading';
    render();
    var d = await fetchDetail(id);
    if (d || S.detail[id] === 'loading') S.detail[id] = d;
    render();
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || S.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id') || '';
    if (act === 'new') return openForm();
    if (act === 'pick') return pick(id);
    if (act === 'choose') return askChoose(id, el.getAttribute('data-company') || '');
    if (act === 'cancel') return askCancel(id);
  }

  // ── 남은 시간 ─────────────────────────────────────────────
  function tick() {
    var now = Date.now();
    var root = $('production-requests');
    if (!root) return;
    root.querySelectorAll('[data-expires]').forEach(function (el) {
      var t = deadlineText(el.getAttribute('data-expires'), now);
      if (t && el.textContent !== t) el.textContent = t;
    });
  }

  function startTick() {
    var root = $('production-requests');
    if (S.timer || !root || !root.querySelector('[data-expires]')) return;
    S.timer = setInterval(tick, TICK_MS);
  }

  /** 앱이 열린 채 알림을 눌러 주소의 # 만 바뀌었다 — 목록을 다시 읽는다 */
  async function onHash() {
    if (location.hash !== HASH || !S.base || !canSee(S.me) || S.busy || !S.data) return;
    await reload();
  }

  /** 제작 의뢰 칸 채우기 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var box = $('production-requests');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    var cfg = window.DADAM_CONFIG || {};
    S.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    S.sb = sb;
    S.session = session;
    S.me = me;
    S.data = null;
    S.pick = '';
    S.detail = {};
    S.msg = '';
    S.note = null;
    S.busy = false;
    if (!S.base || !session || !canSee(me)) return;
    try {
      var list = await fetchList();
      if (!list) return; // 403 · 404 · 오류 · ready false — 칸째 감춘다
      S.data = list;
      await loadDetails();
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
        window.addEventListener('hashchange', onHash);
      }
      render(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
    } catch {
      S.data = null;
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganProduction = {
    PLANS: PLANS,
    HASH: HASH,
    NOTE_MAX: NOTE_MAX,
    OFFER_TTL_HOURS: OFFER_TTL_HOURS,
    ITEMS: ITEMS,
    STATUS_LABEL: STATUS_LABEL,
    OFFER_LABEL: OFFER_LABEL,
    STEPS: STEPS,
    TEXT: TEXT,
    state: S,
    canSee: canSee,
    listOf: listOf,
    stepIndex: stepIndex,
    busyDrafts: busyDrafts,
    draftLabel: draftLabel,
    hintsOf: hintsOf,
    estimateText: estimateText,
    bodyOf: bodyOf,
    leftText: leftText,
    deadlineText: deadlineText,
    load: load,
  };
})();
