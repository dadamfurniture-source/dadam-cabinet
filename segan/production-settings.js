/* ============================================================
   segan/production-settings.js — 「생산 › 생산 설정」 (segan/me.html #productionSettings)

   PC 화면 production.html(생산 현황판)의 「표준시간 · 인력 설정」을 앱 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만.
   (마이페이지 B안 4단계 — 화면마다 PR 하나)

   누가 보나  다담 공장 구성원(account-api GET /partner/me 의 hq_member) · 협력업체의 대표 · 실장 가운데
             서버가 설정을 내주는 사람 (GET /production/settings — 원가 설정은 대표 · 실장 · 공장 관리자만, 나머지는 403).
             다담 본사 구성원 · 업체 직원 · 고객에게는 그려지지 않는다.
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganProductionSettings.load(sb, session, partnerMe) 를
             부른다. 이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /production/settings   { settings(기본값을 채운 것), saved(저장된 그대로 · 없으면 null), hq }
                                           hq === false 면 협력업체 설정 (견적 · 외주 발주에만 쓰인다)
               POST /production/settings   { standards, crew, costs, leads, quote, vendors, countertop [, holidays] }
                                           → { settings, saved } — 서버는 보낸 묶음만 남긴다 (과세 설정 tax 만 지킨다)
   화면      묶음 일곱(표준시간 · 인력 · 인건비 · 외주 단가 · 외주 업체 · 상판 · 납기 · 견적) — 칸 이름은 production.html 과 같다.
             「설정 저장」은 위 · 아래에 하나씩 (칸이 많다), 결과 글은 단추 옆에.
   저장      production.html 과 같은 꼴로 보낸다 — 빈 숫자 칸은 빼고(서버 기본값으로 돌아간다), 상판 업체는 빈 글도 보낸다.
             이 화면에 칸이 없는 값(공휴일 holidays · 원판 기준 quote.sheetBasis)은 저장돼 있던 그대로 다시 실어 지킨다.
   못 읽으면  칸째 감춘다 (403 · 오류 · 끊김). 저장이 안 되면 서버 글을 단추 옆에, 서버가 짚은 칸에 표시한다.
   정보      원가 · 마진 · 업체 이름은 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  // 묶음 차례 · 칸 이름 — production.html LABELS 와 같다
  var GROUPS = ['standards', 'crew', 'costs', 'vendors', 'countertop', 'leads', 'quote'];
  var GROUP_TITLE = {
    standards: '표준시간 (초)',
    crew: '인력',
    costs: '인건비 · 외주 단가 (원)',
    vendors: '외주 업체',
    countertop: '상판',
    leads: '납기',
    quote: '견적',
  };
  var LABELS = {
    standards: {
      cutPerSheet: '재단 원판 1장',
      cutPerJob: '현장당 자재 피킹',
      edgePerFace: '엣지 부재 1면',
      asmPerBox: '통 조립 1통',
      asmPerDrawer: '서랍 1개',
      asmPerDoor: '도어 1짝 (검수+달기)',
      asmPerShelf: '선반 1장',
      asmPerLeg: '다리발 1개',
      asmPerRod: '옷봉 1개',
      packPerBox: '완성 검수·포장 1통',
    },
    crew: {
      hoursPerDay: '하루 근무시간',
      util: '실작업 비율 (0~1)',
      cutters: '재단 기사 (명)',
      edgeMachines: '엣지밴더 (대)',
      edgeMaxOvertimeHours: '알바 연장 최대 (시간)',
      assemblers: '조립 기사 기본 (명)',
      assemblersMaxExtra: '조립 추가 최대 (명)',
    },
    costs: {
      assemblerDay: '조립 일당',
      partTimeHourly: '알바 시급',
      outsourceCutEdgePerSheet: '재단+엣지 외주 (PB 1장)',
    },
    vendors: {
      door: '도어 외주 업체',
      cutEdge: '재단+엣지 외주 업체',
      topMarble: '인조대리석 상판 업체',
      topStone: '엔지니어드 스톤 상판 업체',
      topCeramic: '세라믹 상판 업체',
    },
    countertop: {
      backsplash: '상판 뒷턱 기본 (1 있음 · 0 없음)',
      backsplashH: '뒷턱 높이 (mm)',
      frontLip: '앞턱(등뜨기) 기본 (1 · 0, 12T 만)',
      frontLipH: '앞턱 높이 (mm)',
      drip: '물끊기 기본 (1 · 0)',
    },
    leads: {
      doorLeadDays: '도어 외주 납기 (근무일)',
      outsourceLeadDays: '재단+엣지 외주 납기',
      defaultLeadDays: '설치일 없을 때 기본 (근무일)',
      topLeadDays: '상판 주문 마감 (설치 몇 근무일 전)',
    },
    quote: {
      marginRate: '고객 마진율 (0.2 = 20%)',
      partnerMarginRate: '거래처 마진율 (0.1 = 10%)',
      pbSheet: '몸통 PB 15T 원판',
      backSheet: '뒷판 MDF 2.7T 원판',
      edgeRoll: '0.6T 엣지 1롤',
      edgeRollMeters: '엣지 1롤 길이 (m)',
      doorSheet: '도어 외주 원장 1장',
      hinge: '경첩 1개',
      rail: '서랍 레일 1조',
      drawerBox: '서랍 박스 (개당 원가)',
      leg: '다리발 1개',
      shelfPin: '선반 다보 1개',
      rod: '옷봉 1개',
      fastenerPerBox: '체결 부속 (통당)',
      cutterMonthly: '재단 기사 월급',
      workDays: '월 근무일',
      overheadPerHour: '간접비 배분 (공장 1시간당, 0 = 매출 전체에서 충당)',
      fixedPerPbSheet: '고정비 회수 (몸통 PB 1장당 원가에 더함)',
      installPerMeter: '시공 외주 (시공 m당)',
      countertopPerMeter: '인조대리석 상판 원가 (m당)',
      pbYield: '원판 수율 PB·뒷판 (0.8 = 80%)',
      doorYield: '도어 원판 수율 (0.5장 단위 청구)',
      overheadMonthly: '월 고정비 — 월세·운영비·식대·전기·4대보험·퇴직 (손익 요약에서만 뺌)',
      sinkBowl: '싱크볼 원가',
      faucet: '수전 원가',
      hood: '후드 원가',
      demolitionPerMeter: '철거 원가 (m당)',
    },
  };
  var SHEET_BASIS = ['area', 'nested']; // quote.sheetBasis — 이 화면에 칸이 없다 (저장된 값을 지킨다)
  var FIELD_RE = /(standards|crew|costs|leads|quote|vendors|countertop)\.([A-Za-z]+)/;
  var MONEY_ROLES = ['owner', 'manager']; // 원가 설정 — 대표 · 실장 (서버 settingsCompanyOf 와 같다)

  var TEXT = {
    title: '생산 설정',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    working: '저장하는 중입니다.',
    save: '설정 저장',
    units: '시간은 초, 금액은 원(부가세 별도).',
    hqHelp:
      '실제로 재 보고 바꾸면 추천이 정확해집니다. 저장한 뒤 생산 계획에서 「지금 다시 계산」을 누르세요.',
    partnerHelp:
      '우리 업체의 견적 · 외주 발주 설정입니다. 생산 계획 · 인력 추천 · Slack 지시는 다담 공장만 씁니다.',
    quoteHelp:
      '아래 「견적」 묶음은 상세설계 견적(장당 계산: BOM 수량 × 실제 원가 × (1 + 마진율))에 쓰입니다. 바꾸면 다음 스냅샷부터 반영됩니다.',
    emptyHelp: '숫자 칸을 비우고 저장하면 그 값은 기본값으로 돌아갑니다.',
    hqSaved: '설정을 저장했습니다. 생산 계획에서 「지금 다시 계산」을 누르면 반영됩니다.',
    partnerSaved: '설정을 저장했습니다.',
  };

  var J = {
    base: '',
    sb: null,
    session: null,
    me: null,
    ready: false, // 처음 읽기를 마쳤다 (칸을 그렸다)
    settings: null, // 기본값을 채운 설정 (못 읽으면 null — 칸째 감춘다)
    saved: null, // 저장된 그대로 (없으면 null)
    partner: false, // 협력업체 설정 (서버 hq === false)
    busy: false, // 저장하는 중
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
  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  /** 다담 공장 구성원이거나 협력업체의 대표 · 실장인가 — 다담 본사 구성원 · 업체 직원은 아니다 */
  function canSee(me) {
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    if (me.platform_member === true) return false;
    if (me.hq_member === true) return true;
    var c = me.company;
    return !!c && typeof c === 'object' && !Array.isArray(c) && MONEY_ROLES.indexOf(c.role) >= 0;
  }

  /** 칸에 적을 값 — 숫자 칸은 유한한 수만, 업체 칸은 글자만 */
  function valueOf(group, key) {
    var g = obj(obj(J.settings)[group]);
    var v = g[key];
    if (group === 'vendors') return str(v);
    if (v == null || v === '') return '';
    return isFinite(Number(v)) ? String(Number(v)) : '';
  }

  /**
   * 보낼 묶음 — production.html saveSettings 와 같다:
   * 빈 숫자 칸은 뺀다 · 상판 업체(vendors.top*)는 빈 글도 보낸다 · 그 밖의 업체는 적은 것만.
   * 이 화면에 칸이 없는 공휴일 · 원판 기준은 저장돼 있던 그대로 싣는다 (서버는 보낸 묶음만 남긴다)
   */
  function bodyOf(inputs, saved) {
    var body = {
      standards: {},
      crew: {},
      costs: {},
      leads: {},
      quote: {},
      vendors: {},
      countertop: {},
    };
    Array.prototype.forEach.call(inputs || [], function (i) {
      var g = i.getAttribute('data-g');
      var k = i.getAttribute('data-k');
      if (!own(LABELS, g) || !own(LABELS[g], k)) return;
      var v = String(i.value == null ? '' : i.value).trim();
      if (g === 'vendors' && /^top/.test(k)) body[g][k] = v;
      else if (v !== '') body[g][k] = g === 'vendors' ? v : Number(v);
    });
    saved = obj(saved);
    var basis = obj(saved.quote).sheetBasis;
    if (SHEET_BASIS.indexOf(basis) >= 0) body.quote.sheetBasis = basis;
    if (Array.isArray(saved.holidays) && saved.holidays.length)
      body.holidays = saved.holidays.slice();
    return body;
  }

  /** 서버 글이 짚은 칸 — { group, key } (없으면 null) */
  function fieldOf(message) {
    var m = FIELD_RE.exec(str(message));
    return m && own(LABELS[m[1]], m[2]) ? { group: m[1], key: m[2] } : null;
  }

  // ── 서버 ────────────────────────────────────────────
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

  /** 받은 설정을 담는다 — 묶음이 하나도 없으면 못 읽은 것으로 본다 */
  function take(d) {
    d = obj(d);
    var s = d.settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    J.settings = s;
    J.saved = d.saved && typeof d.saved === 'object' && !Array.isArray(d.saved) ? d.saved : null;
    return true;
  }
  async function read() {
    J.settings = null;
    J.saved = null;
    var r = await call('GET', '/production/settings');
    if (r.ok && take(r.body.data)) J.partner = obj(r.body.data).hq === false;
    return r;
  }

  // ── 그리기 ──────────────────────────────────────────
  function fieldHtml(group, key) {
    var id = 'ps-' + group + '-' + key;
    var text = group === 'vendors';
    return (
      '<label class="mk-input ps-field" for="' +
      id +
      '"><span>' +
      esc(LABELS[group][key]) +
      '</span><input id="' +
      id +
      '" ' +
      (text
        ? 'type="text" maxlength="40" autocomplete="off"'
        : 'type="number" step="any" inputmode="decimal"') +
      ' data-g="' +
      group +
      '" data-k="' +
      key +
      '" value="' +
      esc(valueOf(group, key)) +
      '"></label>'
    );
  }
  function groupHtml(group) {
    return (
      '<div class="od-sec ps-sec" data-ps-group="' +
      group +
      '"><h4 class="od-h">' +
      esc(GROUP_TITLE[group]) +
      '</h4><div class="ps-grid">' +
      Object.keys(LABELS[group])
        .map(function (key) {
          return fieldHtml(group, key);
        })
        .join('') +
      '</div></div>'
    );
  }
  /** 저장 줄 — 단추와 결과 글 (위는 알림 줄, 아래는 같은 글을 눈으로만) */
  function barHtml(top) {
    return (
      '<div class="ps-bar"><button type="button" class="mk-btn mk-btn--solid" data-act="save">' +
      esc(TEXT.save) +
      '</button><p class="me-pt-msg ps-msg" data-ps="msg"' +
      (top ? ' role="status"' : ' aria-hidden="true"') +
      '></p></div>'
    );
  }
  function say(text) {
    var box = $('productionSettings');
    if (!box) return;
    box.querySelectorAll('[data-ps="msg"]').forEach(function (el) {
      el.textContent = text || '';
    });
  }
  /** 다담 공장 구성원은 업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다 */
  function showSection() {
    var section = $('partner');
    var box = $('productionSettings');
    if (section && box && !box.hidden) section.hidden = false;
  }
  function render() {
    var box = $('productionSettings');
    if (!box) return;
    box.innerHTML =
      '<h3 class="me-pt-sub" id="productionSettingsTitle">' +
      esc(TEXT.title) +
      '</h3><p class="mk-note">' +
      esc(TEXT.units + ' ' + (J.partner ? TEXT.partnerHelp : TEXT.hqHelp)) +
      '</p><p class="mk-note">' +
      esc(TEXT.quoteHelp) +
      '</p><p class="mk-note">' +
      esc(TEXT.emptyHelp) +
      '</p>' +
      barHtml(true) +
      GROUPS.map(groupHtml).join('') +
      barHtml(false);
    box.hidden = false;
    showSection();
  }

  // ── 누른 일 ─────────────────────────────────────────
  function inputs() {
    var box = $('productionSettings');
    return box ? box.querySelectorAll('input[data-g][data-k]') : [];
  }
  /** 짚은 칸의 표시와 그 아래 까닭 글을 지운다 (칸을 주지 않으면 모두) */
  function unflag(el) {
    var box = $('productionSettings');
    if (!box) return;
    Array.prototype.forEach.call(el ? [el] : inputs(), function (i) {
      i.removeAttribute('aria-invalid');
      i.removeAttribute('aria-describedby');
    });
    (el ? el.parentNode : box).querySelectorAll('.ps-err').forEach(function (why) {
      why.remove();
    });
  }
  /** 서버가 짚은 칸에 표시하고 그리로 간다 — 단추 옆 글 앞에 칸 이름을 붙이고, 칸 아래에도 까닭을 적는다 (단추가 화면 밖일 수 있다) */
  function flag(message) {
    var f = fieldOf(message);
    var el = f ? $('ps-' + f.group + '-' + f.key) : null;
    if (!el) return message;
    var why = document.createElement('span');
    why.className = 'ps-err';
    why.id = 'ps-err';
    why.textContent = message;
    el.parentNode.appendChild(why);
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', 'ps-err');
    if (el.focus) el.focus();
    return '「' + LABELS[f.group][f.key] + '」 — ' + message;
  }
  async function save() {
    if (J.busy || !J.ready) return;
    J.busy = true;
    var box = $('productionSettings');
    if (box) box.setAttribute('aria-busy', 'true');
    unflag();
    say(TEXT.working);
    try {
      var r = await call('POST', '/production/settings', bodyOf(inputs(), J.saved));
      if (!r.ok) {
        say(flag(errText(r)));
        return;
      }
      if (take(r.body.data)) render();
      say(J.partner ? TEXT.partnerSaved : TEXT.hqSaved);
    } catch {
      say(TEXT.generic);
    } finally {
      J.busy = false;
      if (box) box.removeAttribute('aria-busy');
    }
  }

  function onClick(e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-act="save"]') : null;
    if (!btn || btn.disabled || J.busy) return;
    save();
  }
  /** 고치기 시작하면 그 칸의 표시를 지운다 */
  function onInput(e) {
    var el = e.target;
    if (el && el.getAttribute && el.getAttribute('aria-invalid')) unflag(el);
  }

  /**
   * 업체 칸을 읽은 뒤 부른다 (segan/me.js). 다담 공장 구성원 · 협력업체 대표 · 실장만 — 설정을 못 읽으면(403 · 오류) 칸째 감춘다.
   * 읽기만 한다 — 여는 것만으로는 아무것도 바꾸거나 보내지 않는다
   */
  async function load(sb, session, me) {
    var box = $('productionSettings');
    if (!box) return;
    var hide = function () {
      box.hidden = true;
      box.innerHTML = '';
      J.ready = false;
    };
    hide();
    var cfg = window.DADAM_CONFIG || {};
    J.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    J.sb = sb;
    J.session = session;
    J.me = me;
    J.settings = null;
    J.saved = null;
    J.partner = false;
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      await read();
      if (!J.settings) return;
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
        box.addEventListener('input', onInput);
      }
      J.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganProductionSettings = {
    GROUPS: GROUPS,
    GROUP_TITLE: GROUP_TITLE,
    LABELS: LABELS,
    TEXT: TEXT,
    canSee: canSee,
    bodyOf: bodyOf,
    fieldOf: fieldOf,
    state: J,
    load: load,
  };
})();
