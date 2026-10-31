/* ============================================================
   segan/partner-consults.js — 「내 정보 › 업체」 안의 상담 · 상담 설정 · 내 평가 (segan/me.html)

   누가 보나  다담 본사가 상담을 나누는 업체 풀의 구성원 — account-api GET /partner/me 로 가린다.
               Agent 협력업체 구성원 (company.plan agent): 상담 목록은 구성원 모두, 내 평가 · 상담 설정은 대표 · 실장만.
               다담 공장 구성원 (hq_member — company 없이 온다): 세 칸을 모두 묻고 서버가 가린다
                 (403 이면 그 칸만 감춘다). 결제 · 구성원 같은 협력업체 칸(segan/partner.js)은 그대로 감추고,
                 업체 칸(#partner)은 이 세 칸 중 하나라도 그렸을 때만 보인다.
             받기 · 못 받음 · 설정 저장 단추: 서버 응답(목록 · 설정)의 can_act 를 따른다. 없으면 대표 · 실장이고
               업체가 이용 중(active)일 때 — 정지 · 해지된 업체는 읽기만 (segan/partner.js 「결제가 멈춰 있어
               읽기만 됩니다」와 같다). 다담 공장 구성원은 역할을 모르므로 can_act 가 없으면 읽기만.
             업체 없음 · Expert 업체는 칸이 없다 (업체 풀은 Agent 업체 + 다담 공장).
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganPartnerConsults.load(sb, session, partnerMe) 를
             부른다 (/partner/me 를 두 번 묻지 않는다).
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /company/consults               { items[], can_act? } 내 업체에 배정된 상담 (본사 상담의 사본)
               POST /company/consults/:id/accept    받기 → { customer_id, project_id } (업체 고객 · 프로젝트를 만든다)
               POST /company/consults/:id/decline   못 받음 { reason } → 204
               GET/PUT /company/service-settings    { regions[{sido,gugun}], items{품목: do|outsource|no},
                                                      monthly_limit, lead_days, can_act? }
               GET  /company/my-score               { grade, satisfaction(0~5|null), response_rate(0~1|null) }
   화면
     상담 (#partner-consults)
       상담 한 건마다 품목 · 시/군/구 · 희망 시기(시공 완료 희망 날짜) · 희망 상담일 · 연락 시간 · 도어 마감 ·
       철거 · 가격대 · 예상 견적 ·
       상세 설계 요청 · 요청 사항 · 연출컷 · 이름 · 전화 · 남은 시간(배정 기록의 expires_at — 배정 뒤 24시간)
       기다리는 상담(assignment.state assigned): 「받기」 · 「못 받음」(까닭을 적는 칸이 그 자리에서 열린다)
       돌려보낸 상담(status returned · 못 받음 · 시간 넘김): 연락처 없이 흐리게 (서버도 연락처를 지워서 준다)
     내 평가 — 상담 칸 위 한 줄: 등급 · 고객 만족 · 응답률 (못 읽으면 줄째 뺀다)
     상담 설정 — 상담 받는 지역(시/도 · 시/군/구 여러 개, segan/regions.js) · 하는 품목(함 · 외주 · 안 함) ·
       한 달 한도 · 고객 확정 ~ 시공 완료 기간(최소 제작 기간 1~14일 중 고름, 비면 상담을 배정받지 않는다)
   이름      품목 = workflow-api consult-notify.js FURNITURE_LABELS (consultation.html 가구 종류와 같은 키)
             연락 시간 = consult-notify.js TIME_LABELS (consult.html · consultation.html 의 선택지)
   못 읽으면  처음(403 · 404 · 오류 · 끊김 · 모양이 틀림) → 그 칸째 감춘다 (가짜 값을 그리지 않는다)
   알림      새 상담 알림은 /segan/me.html#partner-consults 를 연다 — 읽은 뒤 상담 칸으로 내려간다.
             앱이 이미 열려 있어 주소의 # 만 바뀌면 목록을 다시 읽고 내려간다.
   ============================================================ */
/* global window, document, location, fetch, setInterval */
(function () {
  'use strict';

  var ROLES = ['owner', 'manager']; // 대표 · 실장 — 받기 · 못 받음 · 설정 · 내 평가
  var MEMBER_ROLES = ['owner', 'manager', 'staff'];
  var HASH = '#partner-consults';

  // 품목 — workflow-api consult-notify.js FURNITURE_LABELS (시험이 같은지 본다)
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
  var ITEM_MODES = [
    ['do', '함'],
    ['outsource', '외주'],
    ['no', '안 함'],
  ];
  // 고객이 고른 도어 마감 · 가격대 (consultations.door_finish · wanted_price_tier 값)
  var DOOR_FINISH = {
    pet: 'PET',
    highgloss: '하이그로시',
    paint: '도장',
    veneer: '무늬목',
    ceramic: '세라믹',
    unknown: '모름',
  };
  var PRICE_TIER = { basic: '보급', mid: '중급', high: '고급', unknown: '모름' };
  // 연락 시간 — consult-notify.js TIME_LABELS
  var TIME_LABELS = {
    '09:00-12:00': '오전 (09:00~12:00)',
    '12:00-15:00': '점심 (12:00~15:00)',
    '15:00-18:00': '오후 (15:00~18:00)',
    '18:00-21:00': '저녁 (18:00~21:00)',
  };
  // 배정 기록 state
  var STATE_LABEL = {
    assigned: '새 상담',
    accepted: '받음',
    declined: '못 받음',
    expired: '시간 넘김',
  };
  var GRADES = ['S', 'A', 'B', 'C'];

  var LIMIT_MAX = 1000; // company_service_settings.monthly_limit CHECK 0~1000
  var LEAD_MIN = 1; // company_service_settings.lead_days CHECK 1~14 (최소 제작 기간, 일 단위)
  var LEAD_MAX = 14;
  var REGION_MAX = 300; // company_service_settings regions 길이 CHECK
  var REASON_MAX = 500; // consult_assignments.reason CHECK
  var TICK_MS = 30000;

  var TEXT = {
    lead: '다담 본사가 배정한 상담입니다. 배정 뒤 24시간 안에 받거나 못 받음을 눌러 주세요.',
    leadStaff: '받기 · 못 받음은 대표 · 실장이 합니다.',
    empty: '아직 배정된 상담이 없습니다.',
    accepted: '받았습니다 · 고객 · 프로젝트를 만들었습니다.',
    declined: '못 받음으로 돌려보냈습니다.',
    reasonEmpty: '못 받는 까닭을 적어 주세요.',
    reasonLong: '까닭은 ' + REASON_MAX + '자까지 적을 수 있습니다.',
    late: '응답 시간이 지났습니다',
    settingsLead: '설정을 마쳐야 상담을 배정받을 수 있어요.',
    regionsEmpty: '비워 두면 업체 주소의 시/군/구 상담만 받습니다.',
    regionPick: '시/도와 시/군/구를 골라 주세요.',
    regionMax: '지역은 ' + REGION_MAX + '곳까지 둘 수 있습니다.',
    limitBad: '한 달 한도는 0~' + LIMIT_MAX + ' 사이 숫자로 적어 주세요.',
    leadBad: '고객 확정 ~ 시공 완료 기간은 ' + LEAD_MIN + '~' + LEAD_MAX + '일 중에서 골라 주세요.',
    leadNote:
      '고객 확정 ~ 시공 완료 기간 — 고객이 확정한 날부터 시공을 마칠 때까지 가장 짧게 걸리는 날(최소 제작 기간)을 골라 주세요. 고르지 않으면 상담을 배정받지 않습니다. 쉬실 때는 한 달 한도를 0으로 두세요.',
    saved: '상담 설정을 저장했습니다.',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var P = {
    sb: null,
    session: null,
    base: '', // workflow-api
    me: null, // GET /partner/me data
    act: false, // 받기 · 못 받음을 할 수 있나 (목록 응답 can_act, 없으면 대표 · 실장 · 업체 active)
    setAct: false, // 상담 설정을 저장할 수 있나 (설정 응답 can_act, 없으면 위와 같은 판정)
    items: null, // GET /company/consults items (못 읽으면 null)
    score: null, // GET /company/my-score data (못 읽으면 null)
    settings: null, // GET /company/service-settings (못 읽으면 null)
    draft: null, // 상담 설정 고치는 중인 값
    decline: '', // 못 받음 까닭 칸을 연 상담 id
    note: null, // { id, text, error } — 그 상담 안에 보일 한 줄 (id 가 없으면 칸 위)
    setMsg: '',
    setErr: '',
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

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function won(n) {
    return Number(n).toLocaleString('ko-KR') + '원';
  }

  /** 'YYYY-MM-DD' → 'YYYY.MM.DD' (날짜만 온 값 — Date 로 바꾸면 시간대에 따라 하루 밀린다) */
  function day(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s == null ? '' : s));
    return m ? m[1] + '.' + m[2] + '.' + m[3] : '';
  }

  /** 한국 시간 날짜 (ISO UTC 로 온 시각) */
  function kstDay(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate());
  }

  function has(obj, k) {
    return typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
  }

  function telHref(tel) {
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  function companyOf(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me) || me.hq_member) return null;
    var c = me.company;
    return c && typeof c === 'object' && !Array.isArray(c) ? c : null;
  }

  /** 다담 공장 구성원 — /partner/me 가 company 없이 hq_member 로 준다 */
  function isHq(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }

  /** 상담 칸을 보이나 — Agent 협력업체 구성원 · 다담 공장 구성원 */
  function canSee(me) {
    if (isHq(me)) return true;
    var c = companyOf(me);
    return !!(c && c.plan === 'agent' && MEMBER_ROLES.indexOf(c.role) >= 0);
  }

  /** 협력업체 대표 · 실장 (company.role) */
  function isManager(me) {
    var c = companyOf(me);
    return canSee(me) && !!c && ROLES.indexOf(c.role) >= 0;
  }

  /** 내 평가 · 상담 설정을 묻나 — 협력업체 대표 · 실장, 다담 공장 구성원(역할을 몰라 묻고 서버가 가린다) */
  function asksManagerViews(me) {
    return isManager(me) || isHq(me);
  }

  /** 받기 · 못 받음 · 설정 저장 (서버가 can_act 를 주지 않을 때) — 대표 · 실장이고 업체가 이용 중(active) */
  function canAct(me) {
    var c = companyOf(me);
    return isManager(me) && c.status === 'active';
  }

  /** 응답 data 의 can_act (참 · 거짓일 때만), 없으면 company.role 로 */
  function actOf(d, me) {
    return d && typeof d === 'object' && typeof d.can_act === 'boolean' ? d.can_act : canAct(me);
  }

  /** 정지 · 해지된 협력업체 — 읽기만 (단추가 없는 까닭이 역할이 아니다) */
  function isPaused(me) {
    var c = companyOf(me);
    return !!c && c.status !== 'active';
  }

  /** GET /company/consults 본문 → 상담 목록 | null (id 가 uuid 인 것만) */
  function listOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return d.items.filter(function (x) {
      return x && typeof x === 'object' && UUID_RE.test(String(x.id || ''));
    });
  }

  /** GET /company/my-score 본문 → { grade, satisfaction, response_rate } | null */
  function scoreOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
    var num = function (v, max) {
      var n = typeof v === 'number' ? v : NaN;
      return isFinite(n) && n >= 0 && n <= max ? n : null;
    };
    return {
      grade: GRADES.indexOf(d.grade) >= 0 ? d.grade : null,
      satisfaction: num(d.satisfaction, 5),
      response_rate: num(d.response_rate, 1),
    };
  }

  /** 내 평가 한 줄 — 값이 없으면 「-」 */
  function scoreText(s) {
    if (!s) return '';
    return [
      '등급 ' + (s.grade || '-'),
      '고객 만족 ' + (s.satisfaction == null ? '-' : s.satisfaction.toFixed(1) + ' / 5'),
      '응답률 ' + (s.response_rate == null ? '-' : Math.round(s.response_rate * 100) + '%'),
    ].join(' · ');
  }

  function regionOk(r) {
    return (
      !!r &&
      typeof r === 'object' &&
      typeof r.sido === 'string' &&
      typeof r.gugun === 'string' &&
      r.sido.length > 0 &&
      r.sido.length <= 20 &&
      r.gugun.length > 0 &&
      r.gugun.length <= 40
    );
  }

  /** GET · PUT /company/service-settings data → 고르게 맞춘 설정 (모양이 틀린 칸은 비운다) */
  function settingsOf(d) {
    var x = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    var items = {};
    var src = x.items && typeof x.items === 'object' && !Array.isArray(x.items) ? x.items : {};
    Object.keys(ITEMS).forEach(function (k) {
      var v = src[k];
      items[k] = v === 'do' || v === 'outsource' || v === 'no' ? v : 'no';
    });
    var seen = {};
    var regions = (Array.isArray(x.regions) ? x.regions : []).filter(function (r) {
      if (!regionOk(r)) return false;
      var key = r.sido + '|' + r.gugun;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    var limit = x.monthly_limit;
    var lead = x.lead_days;
    return {
      regions: regions.map(function (r) {
        return { sido: r.sido, gugun: r.gugun };
      }),
      items: items,
      monthly_limit:
        typeof limit === 'number' && Number.isInteger(limit) && limit >= 0 && limit <= LIMIT_MAX
          ? limit
          : null,
      lead_days:
        typeof lead === 'number' && Number.isInteger(lead) && lead >= LEAD_MIN && lead <= LEAD_MAX
          ? lead
          : null,
    };
  }

  /**
   * PUT 본문 — v = { regions, items, monthly_limit(글자), lead_days(글자) }
   * → { body } | { field, error }
   */
  function settingsBody(v) {
    var x = v || {};
    var regions = (Array.isArray(x.regions) ? x.regions : []).filter(regionOk);
    if (regions.length > REGION_MAX) return { field: 'sido', error: TEXT.regionMax };
    var items = {};
    Object.keys(ITEMS).forEach(function (k) {
      var m = x.items && x.items[k];
      items[k] = m === 'do' || m === 'outsource' ? m : 'no';
    });
    var rawLimit = String(x.monthly_limit == null ? '' : x.monthly_limit).trim();
    var limit = null;
    if (rawLimit) {
      if (!/^\d{1,4}$/.test(rawLimit) || Number(rawLimit) > LIMIT_MAX)
        return { field: 'monthly_limit', error: TEXT.limitBad };
      limit = Number(rawLimit);
    }
    var rawLead = String(x.lead_days == null ? '' : x.lead_days).trim();
    var lead = null;
    if (rawLead) {
      if (!/^\d{1,3}$/.test(rawLead) || Number(rawLead) < LEAD_MIN || Number(rawLead) > LEAD_MAX)
        return { field: 'lead_days', error: TEXT.leadBad };
      lead = Number(rawLead);
    }
    return {
      body: {
        regions: regions.map(function (r) {
          return { sido: r.sido, gugun: r.gugun };
        }),
        items: items,
        monthly_limit: limit,
        lead_days: lead,
      },
    };
  }

  /** 남은 시간 — 배정 기록 expires_at 까지 (지났으면 「응답 시간이 지났습니다」) */
  function leftText(expires, now) {
    var t = Date.parse(expires);
    if (isNaN(t)) return '';
    var ms = t - (now == null ? Date.now() : now);
    if (ms <= 0) return TEXT.late;
    var mins = Math.ceil(ms / 60000);
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return '남은 시간 ' + (h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분');
  }

  function assignmentOf(x) {
    var a = x && x.assignment;
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  }

  /** 돌려보낸 상담 — 연락처 없이 흐리게 */
  function isReturned(x) {
    var s = assignmentOf(x).state;
    return x.status === 'returned' || s === 'declined' || s === 'expired';
  }

  /** 답을 기다리는 상담 — 받기 · 못 받음 */
  function isWaiting(x) {
    return !isReturned(x) && assignmentOf(x).state === 'assigned';
  }

  function itemText(cats) {
    var out = [];
    (Array.isArray(cats) ? cats : []).forEach(function (c) {
      if (has(ITEMS, c) && out.indexOf(ITEMS[c]) < 0) out.push(ITEMS[c]);
    });
    return out.length ? out.join(' · ') : '품목 미정';
  }

  // ── 그리기 ─────────────────────────────────────────────
  function fact(label, html) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + html + '</dd></div>';
  }

  function btn(act, label, solid, id) {
    return (
      '<button type="button" class="mk-btn' +
      (solid ? ' mk-btn--solid' : '') +
      '" data-act="' +
      act +
      '"' +
      (id ? ' data-id="' + esc(id) + '"' : '') +
      (P.busy ? ' disabled' : '') +
      '>' +
      esc(label) +
      '</button>'
    );
  }

  function noteHtml(n) {
    if (!n || !n.text) return '';
    return n.error
      ? '<p class="mk-error" role="alert">' + esc(n.text) + '</p>'
      : '<p class="me-pt-msg" role="status">' + esc(n.text) + '</p>';
  }

  function factsHtml(x, returned) {
    var f = [];
    // 희망 시기 = 시공 완료 희망 날짜 (분배가 업체 기간과 견주는 날). 희망 상담일은 연락 일정
    if (day(x.wanted_done_date))
      f.push(fact('희망 시기', esc(day(x.wanted_done_date)) + ' 시공 완료'));
    if (day(x.preferred_date)) f.push(fact('희망 상담일', esc(day(x.preferred_date))));
    if (typeof x.preferred_time === 'string' && x.preferred_time)
      f.push(fact('연락 시간', esc(TIME_LABELS[x.preferred_time] || x.preferred_time)));
    if (has(DOOR_FINISH, x.door_finish)) f.push(fact('도어 마감', esc(DOOR_FINISH[x.door_finish])));
    if (x.demolition_needed === true || x.demolition_needed === false)
      f.push(fact('철거', x.demolition_needed ? '필요' : '필요 없음'));
    if (has(PRICE_TIER, x.wanted_price_tier))
      f.push(fact('가격대', esc(PRICE_TIER[x.wanted_price_tier])));
    if (x.quote_total != null && x.quote_total !== '' && isFinite(Number(x.quote_total)))
      f.push(fact('예상 견적', esc(won(x.quote_total))));
    if (x.request_detail_design === true) f.push(fact('상세 설계', '요청'));
    if (typeof x.description === 'string' && x.description.trim())
      f.push(
        '<div class="me-cs-desc"><dt>요청 사항</dt><dd>' + esc(x.description.trim()) + '</dd></div>'
      );
    if (!returned) {
      if (typeof x.name === 'string' && x.name) f.push(fact('이름', esc(x.name)));
      if (typeof x.phone === 'string' && /[0-9]/.test(x.phone))
        f.push(fact('전화', '<a href="' + esc(telHref(x.phone)) + '">' + esc(x.phone) + '</a>'));
    }
    return f.length ? '<dl class="me-facts">' + f.join('') + '</dl>' : '';
  }

  function shotHtml(x) {
    var u = x.generation_image_url;
    if (typeof u !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(u)) return '';
    return (
      '<a class="me-cs-shotlink" href="' +
      esc(u) +
      '" target="_blank" rel="noopener"><img class="me-cs-shot" src="' +
      esc(u) +
      '" alt="고객 연출컷" loading="lazy" /></a>'
    );
  }

  function actsHtml(x) {
    if (P.decline === x.id) {
      return (
        '<div class="me-cs-decline" data-form="decline" data-id="' +
        esc(x.id) +
        '"><label class="mk-input"><span>못 받는 까닭</span><textarea name="reason" rows="3" maxlength="' +
        REASON_MAX +
        '" placeholder="예: 이번 달 일정이 꽉 찼습니다."></textarea></label>' +
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

  function consultHtml(x, now) {
    var a = assignmentOf(x);
    var returned = isReturned(x);
    var waiting = isWaiting(x);
    var badge = STATE_LABEL[a.state] || (returned ? '돌려보냄' : '');
    var sub = [[x.sido, x.gugun].filter(Boolean).join(' '), kstDay(x.created_at)]
      .filter(Boolean)
      .join(' · ');
    var left = waiting ? leftText(a.expires_at, now) : '';
    return (
      '<li class="me-cs-item' +
      (returned ? ' me-cs-item--off' : '') +
      '" data-consult="' +
      esc(x.id) +
      '"><div class="me-pt-line"><span class="me-c-main"><b>' +
      esc(itemText(x.furniture_categories)) +
      '</b>' +
      (sub ? '<small>' + esc(sub) + '</small>' : '') +
      '</span>' +
      (badge ? '<span class="me-badge">' + esc(badge) + '</span>' : '') +
      '</div>' +
      (left
        ? '<p class="me-cs-left" data-expires="' + esc(a.expires_at) + '">' + esc(left) + '</p>'
        : '') +
      shotHtml(x) +
      factsHtml(x, returned) +
      (P.note && P.note.id === x.id ? noteHtml(P.note) : '') +
      (waiting && P.act ? actsHtml(x) : '') +
      '</li>'
    );
  }

  function renderList() {
    var box = $('partner-consults');
    if (!box) return;
    if (!P.items) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var now = Date.now();
    var matched =
      P.note &&
      P.items.some(function (x) {
        return x.id === P.note.id;
      });
    var score = P.score ? scoreText(P.score) : '';
    // 단추가 없는 까닭이 역할일 때만 「대표 · 실장이 합니다」 (정지 · 해지된 업체는 업체 칸이 이미 알린다)
    var staff = !P.act && !isPaused(P.me);
    box.innerHTML =
      '<h3 class="me-pt-sub" id="partnerConsultsTitle">상담</h3>' +
      (score ? '<p class="me-cs-score" data-score>내 평가 · ' + esc(score) + '</p>' : '') +
      '<p class="mk-note">' +
      esc(TEXT.lead + (staff ? ' ' + TEXT.leadStaff : '')) +
      '</p>' +
      (P.note && !matched ? noteHtml(P.note) : '') +
      (P.items.length
        ? '<ul class="me-cs-list">' +
          P.items
            .map(function (x) {
              return consultHtml(x, now);
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' + esc(TEXT.empty) + '</p>');
    box.hidden = false;
    startTick();
  }

  // ── 상담 설정 ──────────────────────────────────────────
  /** 고객 확정 ~ 시공 완료 기간 — 최소 제작 기간을 1~14일 중 하루 단위로 고른다 (고르지 않으면 빈 값) */
  function leadSelectHtml(value) {
    var html = '<option value="">기간 선택</option>';
    for (var n = LEAD_MIN; n <= LEAD_MAX; n++) {
      html +=
        '<option value="' +
        n +
        '"' +
        (String(n) === value ? ' selected' : '') +
        '>' +
        n +
        '일</option>';
    }
    return '<select name="lead_days">' + html + '</select>';
  }

  function regionSelectHtml() {
    var R = window.SeganRegions || {};
    return (
      '<div class="cs-region"><label class="mk-input"><span>시/도</span><select name="sido">' +
      '<option value="">시/도 선택</option>' +
      Object.keys(R)
        .map(function (s) {
          return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
        })
        .join('') +
      '</select></label><label class="mk-input"><span>시/군/구</span><select name="gugun" disabled>' +
      '<option value="">시/군/구 선택</option></select></label></div>'
    );
  }

  function fillGugun(form) {
    var R = window.SeganRegions || {};
    var sido = form.querySelector('select[name="sido"]');
    var gugun = form.querySelector('select[name="gugun"]');
    if (!sido || !gugun) return;
    var list = R[sido.value] || [];
    gugun.innerHTML =
      '<option value="">시/군/구 선택</option>' +
      (list.length ? '<option value="*">모두 (' + list.length + '곳)</option>' : '') +
      list
        .map(function (g) {
          return '<option value="' + esc(g) + '">' + esc(g) + '</option>';
        })
        .join('');
    gugun.disabled = !list.length;
  }

  function regionsHtml(regions) {
    if (!regions.length) return '<p class="me-empty">' + esc(TEXT.regionsEmpty) + '</p>';
    return (
      '<ul class="me-cs-regions">' +
      regions
        .map(function (r, i) {
          var name = r.sido + ' ' + r.gugun;
          return (
            '<li><span>' +
            esc(name) +
            '</span><button type="button" data-act="region-remove" data-i="' +
            i +
            '" aria-label="' +
            esc(name + ' 빼기') +
            '">빼기</button></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function itemsHtml(items) {
    return Object.keys(ITEMS)
      .map(function (k) {
        return (
          '<div class="me-cs-itemrow" role="radiogroup" aria-label="' +
          esc(ITEMS[k]) +
          '"><span class="me-cs-itemname">' +
          esc(ITEMS[k]) +
          '</span><span class="cs-choices">' +
          ITEM_MODES.map(function (m) {
            return (
              '<label class="cs-choice"><input type="radio" name="item-' +
              k +
              '" value="' +
              m[0] +
              '"' +
              (items[k] === m[0] ? ' checked' : '') +
              ' /><span>' +
              esc(m[1]) +
              '</span></label>'
            );
          }).join('') +
          '</span></div>'
        );
      })
      .join('');
  }

  function renderSettings() {
    var box = $('partnerConsultSettings');
    if (!box) return;
    if (!P.settings || !P.draft) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var d = P.draft;
    box.innerHTML =
      '<h3 class="me-pt-sub" id="partnerConsultSettingsTitle">상담 설정</h3>' +
      '<form class="me-pt-form me-cs-set" data-form="settings" novalidate>' +
      '<p class="me-pt-warn">' +
      esc(TEXT.settingsLead) +
      '</p>' +
      '<fieldset class="me-cs-fields"' +
      (P.setAct ? '' : ' disabled') +
      '>' +
      '<div class="me-cs-field"><p class="me-pt-title">상담 받는 지역</p>' +
      regionsHtml(d.regions) +
      (P.setAct
        ? regionSelectHtml() + '<div class="rd-acts">' + btn('region-add', '지역 더하기') + '</div>'
        : '') +
      '</div>' +
      '<div class="me-cs-field"><p class="me-pt-title">하는 품목</p>' +
      itemsHtml(d.items) +
      '</div>' +
      '<div class="cs-region">' +
      '<label class="mk-input"><span>한 달 한도 (건)</span><input name="monthly_limit" type="number" inputmode="numeric" min="0" max="' +
      LIMIT_MAX +
      '" step="1" value="' +
      esc(d.monthly_limit) +
      '" /></label>' +
      '<label class="mk-input"><span>고객 확정 ~ 시공 완료 기간</span>' +
      leadSelectHtml(d.lead_days) +
      '</label>' +
      '</div>' +
      '<p class="mk-note" data-lead-note>' +
      esc(TEXT.leadNote) +
      '</p>' +
      '</fieldset>' +
      '<p class="mk-error" data-err role="alert"' +
      (P.setErr ? '' : ' hidden') +
      '>' +
      esc(P.setErr) +
      '</p>' +
      (P.setMsg ? '<p class="me-pt-msg" role="status">' + esc(P.setMsg) + '</p>' : '') +
      (P.setAct
        ? '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid"' +
          (P.busy ? ' disabled' : '') +
          '>설정 저장</button></div>'
        : '') +
      '</form>';
    box.hidden = false;
  }

  /** 설정 → 고치는 값 (한도는 입력 칸 글자 · 기간은 고른 값 글자) */
  function draftOf(s) {
    var items = {};
    Object.keys(ITEMS).forEach(function (k) {
      items[k] = s.items[k];
    });
    return {
      regions: s.regions.slice(),
      items: items,
      monthly_limit: s.monthly_limit == null ? '' : String(s.monthly_limit),
      lead_days: s.lead_days == null ? '' : String(s.lead_days),
    };
  }

  /** 다시 그리기 전에 입력 칸 값을 고치는 값에 옮긴다 (지역은 P.draft.regions 가 정본) */
  function syncDraft() {
    var box = $('partnerConsultSettings');
    var form = box && box.querySelector('form[data-form="settings"]');
    if (!form || !P.draft) return;
    Object.keys(ITEMS).forEach(function (k) {
      var on = form.querySelector('input[name="item-' + k + '"]:checked');
      if (on) P.draft.items[k] = on.value;
    });
    var limit = form.querySelector('input[name="monthly_limit"]');
    var lead = form.querySelector('select[name="lead_days"]');
    if (limit) P.draft.monthly_limit = limit.value;
    if (lead) P.draft.lead_days = lead.value;
  }

  function settingsError(text, field) {
    var box = $('partnerConsultSettings');
    var form = box && box.querySelector('form[data-form="settings"]');
    if (!form) return;
    var el = form.querySelector('[data-err]');
    if (el) {
      el.textContent = text;
      el.hidden = !text;
    }
    form.querySelectorAll('[aria-invalid]').forEach(function (x) {
      x.removeAttribute('aria-invalid');
    });
    var f = /^[a-z_]{1,40}$/.test(String(field || ''))
      ? form.querySelector('[name="' + field + '"]')
      : null;
    if (f) {
      f.setAttribute('aria-invalid', 'true');
      if (f.focus) f.focus();
    }
  }

  function addRegion() {
    var box = $('partnerConsultSettings');
    var form = box && box.querySelector('form[data-form="settings"]');
    if (!form || !P.draft) return;
    var R = window.SeganRegions || {};
    var sido = form.querySelector('select[name="sido"]').value;
    var gugun = form.querySelector('select[name="gugun"]').value;
    var list = R[sido] || [];
    var pick = gugun === '*' ? list.slice() : list.indexOf(gugun) >= 0 ? [gugun] : [];
    if (!pick.length) return settingsError(TEXT.regionPick, 'sido');
    syncDraft();
    var have = {};
    P.draft.regions.forEach(function (r) {
      have[r.sido + '|' + r.gugun] = true;
    });
    var next = P.draft.regions.slice();
    pick.forEach(function (g) {
      if (!have[sido + '|' + g]) next.push({ sido: sido, gugun: g });
    });
    if (next.length > REGION_MAX) return settingsError(TEXT.regionMax, 'sido');
    P.draft.regions = next;
    P.setMsg = '';
    P.setErr = '';
    renderSettings();
  }

  function removeRegion(i) {
    if (!P.draft || !(i >= 0 && i < P.draft.regions.length)) return;
    syncDraft();
    P.draft.regions.splice(i, 1);
    P.setMsg = '';
    P.setErr = '';
    renderSettings();
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

  /** workflow-api 호출 → { ok, status, body } (끊기면 status 0 · 204 는 ok) */
  async function call(method, path, body) {
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
    if (res.status === 204) return { ok: true, status: 204, body: {} };
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

  /** GET /company/consults → { items, act } | null */
  async function fetchList() {
    var r = await call('GET', '/company/consults');
    var items = r.ok ? listOf(r.body) : null;
    return items ? { items: items, act: actOf(r.body.data, P.me) } : null;
  }

  async function fetchScore() {
    var r = await call('GET', '/company/my-score');
    return r.ok ? scoreOf(r.body) : null;
  }

  /** GET /company/service-settings → { settings, act } | null */
  async function fetchSettings() {
    var r = await call('GET', '/company/service-settings');
    if (!r.ok || !('data' in r.body)) return null;
    var d = r.body.data;
    if (d != null && (typeof d !== 'object' || Array.isArray(d))) return null;
    // 아직 한 번도 저장하지 않았으면(data null) 빈 설정
    return { settings: settingsOf(d), act: actOf(d, P.me) };
  }

  /** 목록 응답을 옮긴다 (못 읽었으면 지금 것을 둔다) */
  function takeList(got) {
    if (!got) return;
    P.items = got.items;
    P.act = got.act;
  }

  // ── 동작 ───────────────────────────────────────────────
  function setBusy(on) {
    P.busy = on;
    ['partner-consults', 'partnerConsultSettings'].forEach(function (id) {
      var root = $(id);
      if (!root) return;
      root.querySelectorAll('button, input, select, textarea').forEach(function (el) {
        if (on && !el.disabled) {
          el.setAttribute('data-busy', '');
          el.disabled = true;
        } else if (!on && el.hasAttribute('data-busy')) {
          el.removeAttribute('data-busy');
          el.disabled = false;
        }
      });
    });
  }

  /** 목록을 다시 읽고 그린다 (못 읽으면 지금 목록을 그대로 두고 한 줄) */
  async function refreshList(note) {
    takeList(await fetchList());
    P.note = note || null;
    P.decline = '';
    renderList();
  }

  async function accept(id) {
    if (!UUID_RE.test(id) || P.busy) return;
    setBusy(true);
    var r = await call('POST', '/company/consults/' + encodeURIComponent(id) + '/accept');
    setBusy(false);
    await refreshList(
      r.ok ? { id: id, text: TEXT.accepted } : { id: id, text: errText(r), error: true }
    );
  }

  function declineBox(id) {
    var root = $('partner-consults');
    var boxes = root ? root.querySelectorAll('[data-form="decline"]') : [];
    for (var i = 0; i < boxes.length; i++)
      if (boxes[i].getAttribute('data-id') === id) return boxes[i];
    return null;
  }

  async function sendDecline(id) {
    if (!UUID_RE.test(id) || P.busy) return;
    var box = declineBox(id);
    var field = box && box.querySelector('textarea[name="reason"]');
    var reason = field ? field.value.trim() : '';
    var err = box && box.querySelector('[data-err]');
    var bad = !reason ? TEXT.reasonEmpty : reason.length > REASON_MAX ? TEXT.reasonLong : '';
    if (bad) {
      if (err) {
        err.textContent = bad;
        err.hidden = false;
      }
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        if (field.focus) field.focus();
      }
      return;
    }
    setBusy(true);
    var r = await call('POST', '/company/consults/' + encodeURIComponent(id) + '/decline', {
      reason: reason,
    });
    setBusy(false);
    if (!r.ok && (r.status === 0 || r.status >= 500 || r.status === 422)) {
      // 다시 보낼 수 있게 까닭 칸을 둔다
      if (err) {
        err.textContent = errText(r);
        err.hidden = false;
      }
      return;
    }
    await refreshList(
      r.ok ? { id: id, text: TEXT.declined } : { id: id, text: errText(r), error: true }
    );
  }

  async function saveSettings() {
    if (P.busy || !P.setAct) return;
    syncDraft();
    var v = settingsBody(P.draft);
    if (v.error) return settingsError(v.error, v.field);
    settingsError('');
    setBusy(true);
    var r = await call('PUT', '/company/service-settings', v.body);
    setBusy(false);
    if (!r.ok) {
      P.setMsg = '';
      return settingsError(errText(r), r.status === 422 ? r.body.field : null);
    }
    var d = r.body.data;
    var saved = d && typeof d === 'object' && !Array.isArray(d);
    P.settings = saved ? settingsOf(d) : settingsOf(v.body);
    if (saved && typeof d.can_act === 'boolean') P.setAct = d.can_act;
    P.draft = draftOf(P.settings);
    P.setErr = '';
    P.setMsg = TEXT.saved;
    renderSettings();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || P.busy) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id') || '';
    if (act === 'accept') return accept(id);
    if (act === 'decline-open' || act === 'decline-cancel') {
      P.decline = act === 'decline-open' ? id : '';
      P.note = null;
      renderList();
      var t = P.decline && declineBox(id);
      var f = t && t.querySelector('textarea');
      if (f && f.focus) f.focus();
      return;
    }
    if (act === 'decline-send') return sendDecline(id);
    if (act === 'region-add') return addRegion();
    if (act === 'region-remove') return removeRegion(Number(el.getAttribute('data-i')));
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || !form.getAttribute || form.getAttribute('data-form') !== 'settings') return;
    e.preventDefault();
    saveSettings();
  }

  function onChange(e) {
    var el = e.target;
    if (el && el.name === 'sido' && el.closest) {
      var form = el.closest('form[data-form="settings"]');
      if (form) fillGugun(form);
    }
  }

  /** 남은 시간 글자만 바꾼다 (목록을 다시 그리지 않는다 — 적던 까닭이 지워지지 않게) */
  function tick() {
    var now = Date.now();
    var root = $('partner-consults');
    if (!root) return;
    root.querySelectorAll('[data-expires]').forEach(function (el) {
      var t = leftText(el.getAttribute('data-expires'), now);
      if (t && el.textContent !== t) el.textContent = t;
    });
  }

  function startTick() {
    if (P.timer || !$('partner-consults') || !$('partner-consults').querySelector('[data-expires]'))
      return;
    P.timer = setInterval(tick, TICK_MS);
  }

  function scrollIfAsked() {
    var box = $('partner-consults');
    if (!box || box.hidden || location.hash !== HASH) return;
    if (box.scrollIntoView) box.scrollIntoView({ block: 'start' });
  }

  /** 앱이 열린 채 알림을 눌러 주소의 # 만 바뀌었다 — 새 상담을 다시 읽고 내려간다 */
  async function onHash() {
    if (location.hash !== HASH || !P.base || !canSee(P.me) || P.busy) return;
    var got = await fetchList();
    if (got) {
      takeList(got);
      renderList();
      showSection();
    }
    scrollIfAsked();
  }

  /**
   * 다담 공장 구성원 — 업체 칸(#partner)은 segan/partner.js 가 감춰 둔다(협력업체 칸이 없으므로).
   * 이 파일의 칸을 하나라도 그렸으면 업체 칸을 보이고(협력업체 내용 #mePartner 는 비어 있다), 아니면 감춘다.
   */
  function showSection() {
    if (!isHq(P.me)) return;
    var section = $('partner');
    var list = $('partner-consults');
    var set = $('partnerConsultSettings');
    var projects = $('partnerProjects'); // segan/partner-projects.js 도 이 칸을 연다
    if (section)
      section.hidden = !(
        (list && !list.hidden) ||
        (set && !set.hidden) ||
        (projects && !projects.hidden)
      );
  }

  function bind() {
    ['partner-consults', 'partnerConsultSettings'].forEach(function (id) {
      var root = $(id);
      if (!root || root.getAttribute('data-bound')) return;
      root.setAttribute('data-bound', '1');
      root.addEventListener('click', onClick);
      root.addEventListener('submit', onSubmit);
      root.addEventListener('change', onChange);
    });
    if (!window.__seganConsultHash) {
      window.__seganConsultHash = true;
      window.addEventListener('hashchange', function () {
        var api = window.SeganPartnerConsults;
        if (api && api.onHash) api.onHash();
      });
    }
  }

  /** 상담 · 상담 설정 칸 채우기 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var list = $('partner-consults');
    var set = $('partnerConsultSettings');
    if (!list) return;
    list.hidden = true;
    list.innerHTML = '';
    if (set) {
      set.hidden = true;
      set.innerHTML = '';
    }
    var cfg = window.DADAM_CONFIG || {};
    P.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    P.sb = sb;
    P.session = session;
    P.me = me;
    P.items = null;
    P.score = null;
    P.settings = null;
    P.draft = null;
    P.note = null;
    P.decline = '';
    P.setMsg = '';
    P.setErr = '';
    P.act = false;
    P.setAct = false;
    if (!P.base || !session || !canSee(me)) return;
    var managerViews = asksManagerViews(me);
    try {
      var got = await Promise.all([
        fetchList(),
        managerViews ? fetchScore() : null,
        managerViews ? fetchSettings() : null,
      ]);
      takeList(got[0]);
      P.score = got[1];
      P.settings = got[2] ? got[2].settings : null;
      P.setAct = got[2] ? got[2].act : false;
      P.draft = P.settings ? draftOf(P.settings) : null;
      bind();
      renderList(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
      renderSettings();
      showSection();
      scrollIfAsked();
    } catch {
      list.hidden = true;
      list.innerHTML = '';
      if (set) {
        set.hidden = true;
        set.innerHTML = '';
      }
      showSection();
    }
  }

  window.SeganPartnerConsults = {
    HASH: HASH,
    ROLES: ROLES,
    ITEMS: ITEMS,
    ITEM_MODES: ITEM_MODES,
    DOOR_FINISH: DOOR_FINISH,
    PRICE_TIER: PRICE_TIER,
    TIME_LABELS: TIME_LABELS,
    STATE_LABEL: STATE_LABEL,
    TEXT: TEXT,
    state: P,
    canSee: canSee,
    isManager: isManager,
    canAct: canAct,
    actOf: actOf,
    listOf: listOf,
    scoreOf: scoreOf,
    scoreText: scoreText,
    settingsOf: settingsOf,
    settingsBody: settingsBody,
    leftText: leftText,
    onHash: onHash,
    load: load,
  };
})();
