/* ============================================================
   segan/consult.js — ④ 상담 신청 (consult.html?g=<연출컷 id>)

   저장은 consultation.html 과 같은 길이다: Supabase consultations 에 insert. 새 엔드포인트를 만들지 않는다.
   상담은 모두 다담 본사로 들어간다 (company_id 기본값 · 넣기 정책 — DB 가 정한다). 본사가 확인한 뒤
   가까운 업체(다담 협력업체 · 다담 공장)에 나눠 준다. 그래서 고객이 상담받을 곳을 고르지 않고,
   접수 화면은 특정 업체를 약속하지 않는다.

   고객이 적는 것: 이름 · 연락처(필수, 프로필에서 채움), 시공 지역(시/도 · 시/군/구, 필수 — signup.html 과
   같은 목록), 품목(여러 개, 필수 — consultation.html 가구 종류와 같은 키 → furniture_categories.
   연출컷 품목 키가 그 목록에 똑같이 있을 때만 미리 골라 둔다 — 다른 키를 바꾸는 규칙은 없다),
   원하는 도어 마감 · 철거 필요 · 원하는 가격대(필수, 「모름」 있음), 연락 받기 좋은 시간
   (consultation.html 과 같은 값), 요청 사항, 동의 둘:
     개인정보 수집 · 이용 (필수) → privacy_agreed_at
     다담 협력업체 목록 중 다담이 정한 업체에 제공 (선택) → third_party_agreed_at · consent_version 'v1'
       동의하지 않아도 신청은 간다 — 다담 본사가 직접 상담한다 (두 칸은 비운다).
   저절로 채우는 것: 이메일(로그인 계정), 상담 제목(「AI 연출컷 상담 — 품목」), 상담 유형 'ai-design',
   이 연출컷(generation_id)과 그 예상 견적(quote).
   「지금 전화하기」는 저장하지 않고 대표 전화(사업자 정보와 같은 번호)를 연다.

   앱 칸(generation_id · quote · sido · gugun)은 database/consultations-app.sql, 도어 마감 · 철거 · 가격대 ·
   업체 제공 동의 칸은 database/migrations/0019 가 더한다. 그 칸이 아직 없으면 신청서 대신
   「아직 받을 수 없습니다」 + 전화를 보인다.
   ============================================================ */
/* global window, document, location, fetch, URLSearchParams */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // 넣는 칸 중 consultation.html 에 없는 것 — 하나라도 없으면 신청서를 열지 않는다
  var NEW_COLUMNS =
    'generation_id,quote,sido,gugun,privacy_agreed_at,' +
    'door_finish,demolition_needed,wanted_price_tier,third_party_agreed_at,consent_version';
  var LOGIN_PAGE = '../login.html';
  // 업체 제공 동의 문구 판 — consult.html 「제공하는 내용 보기」를 바꾸면 올린다
  var CONSENT_VERSION = 'v1';
  // 품목 — consultation.html 가구 종류 = workflow-api consult-notify.js FURNITURE_LABELS 키 (시험이 같은지 본다)
  var ITEM_KEYS = [
    'sink',
    'island',
    'wardrobe',
    'fridge',
    'shoerack',
    'vanity',
    'storage',
    'other',
  ];
  // consultations CHECK 값 (도어 마감 · 가격대)
  var DOOR_FINISHES = ['pet', 'highgloss', 'paint', 'veneer', 'ceramic', 'unknown'];
  var PRICE_TIERS = ['basic', 'mid', 'high', 'unknown'];
  var DONE_TEXT = {
    partner: '다담 본사가 확인한 뒤 가까운 업체를 연결해 드립니다.',
    hq: '다담 본사가 확인한 뒤 남기신 연락처로 직접 연락드립니다.',
  };

  var C = {
    id: '',
    sb: null,
    session: null,
    gen: null,
    sending: false,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function genId() {
    var g = new URLSearchParams(location.search).get('g');
    return g && UUID_RE.test(g) ? g : '';
  }

  function telHref(tel) {
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }

  function biz() {
    return (window.SeganShell && window.SeganShell.BIZ) || {};
  }

  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }

  function labelOf(list, value, key) {
    var k = key || 'value';
    for (var i = 0; i < (list || []).length; i++) if (list[i][k] === value) return list[i].label;
    return '';
  }

  function kindLabel(category) {
    var M = window.SeganMake || {};
    return labelOf(M.KINDS, category, 'key') || '가구';
  }

  /** 상담 제목 — 고객이 적지 않는다 */
  function titleFor(gen) {
    return 'AI 연출컷 상담 — ' + kindLabel(gen && gen.category);
  }

  function show(view) {
    document.querySelectorAll('[data-cs-view]').forEach(function (el) {
      el.hidden = el.getAttribute('data-cs-view') !== view;
    });
    // 신청서 · 접수 화면 밖에서도 전화는 언제나 보인다
    var line = $('csTelLine');
    var tel = biz().tel;
    line.hidden = !tel || view === 'form' || view === 'done' || view === 'checking';
    if (tel)
      line.innerHTML =
        '전화 상담 <a href="' +
        telHref(tel) +
        '">' +
        tel +
        '</a>' +
        (biz().hours ? ' · ' + biz().hours : '');
  }

  // ── 시공 지역 ──────────────────────────────────────────
  function fillSido(selected) {
    var R = window.SeganRegions || {};
    var sel = $('csSido');
    sel.innerHTML =
      '<option value="">시/도 선택</option>' +
      Object.keys(R)
        .map(function (s) {
          return '<option value="' + s + '">' + s + '</option>';
        })
        .join('');
    sel.value = R[selected] ? selected : '';
  }

  function fillGugun(selected) {
    var R = window.SeganRegions || {};
    var list = R[$('csSido').value] || [];
    var sel = $('csGugun');
    sel.innerHTML =
      '<option value="">시/군/구 선택</option>' +
      list
        .map(function (g) {
          return '<option value="' + g + '">' + g + '</option>';
        })
        .join('');
    sel.disabled = !list.length;
    sel.value = list.indexOf(selected) >= 0 ? selected : '';
  }

  // ── 고른 값에 따라 ─────────────────────────────────────
  function picked(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }

  function renderHow() {
    var call = picked('how') === 'call';
    $('csFields').hidden = call;
    $('csCall').hidden = !call;
    $('csSubmit').hidden = call;
    $('csTel').hidden = !call;
    $('csError').hidden = true;
  }

  function error(msg) {
    $('csError').textContent = msg;
    $('csError').hidden = !msg;
  }

  // ── 불러오기 ───────────────────────────────────────────
  function client() {
    try {
      if (window.DADAM_CONFIG && window.supabase) {
        return window.supabase.createClient(
          window.DADAM_CONFIG.supabase.url,
          window.DADAM_CONFIG.supabase.anonKey
        );
      }
    } catch {
      /* 없으면 로그인 안 된 것으로 */
    }
    return null;
  }

  function apiBase() {
    var url =
      (window.DADAM_CONFIG &&
        window.DADAM_CONFIG.generateApi &&
        window.DADAM_CONFIG.generateApi.url) ||
      'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate';
    return url.replace(/\/api\/generate\/?$/, '');
  }

  /** 연출컷 — generate-api 의 본인 조회 (만들기 ③ 과 같은 GET) */
  async function loadGeneration(id) {
    var res = await fetch(apiBase() + '/api/generate/' + id, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + C.session.access_token,
      },
    });
    var data = await res.json();
    if (!res.ok || !data.success || !data.generation) return null;
    return data.generation;
  }

  /** 새 칸이 있는가 — 없으면 PostgREST 가 칸 이름 오류를 낸다 (행은 읽지 않는다) */
  async function columnsReady() {
    try {
      var r = await C.sb.from('consultations').select(NEW_COLUMNS).limit(1);
      return !r.error;
    } catch {
      return false;
    }
  }

  /** 이름 · 연락처 · 지역 — 프로필, 없으면 가입 정보 (consultation.html 과 같은 출처) */
  async function prefill() {
    var u = C.session.user || {};
    var meta = u.user_metadata || {};
    var p = null;
    try {
      var r = await C.sb
        .from('profiles')
        .select('name, phone, sido, gugun')
        .eq('id', u.id)
        .maybeSingle();
      p = r && r.data;
    } catch {
      p = null;
    }
    $('csName').value = (p && p.name) || meta.name || meta.full_name || '';
    $('csPhone').value = (p && p.phone) || meta.phone || '';
    fillSido((p && p.sido) || meta.sido || '');
    fillGugun((p && p.gugun) || meta.gugun || '');
  }

  function renderSummary(g) {
    var o = g.options || {};
    var M = window.SeganMake || {};
    var parts = [
      kindLabel(g.category),
      labelOf(M.STYLES, o.design_style),
      labelOf(M.DOORS, o.door_color),
    ].filter(Boolean);
    $('csSumLine1').textContent = parts.join(' · ');
    var n = (g.images || []).length;
    $('csSumLine2').textContent =
      (g.quote ? '예상 견적 ' + won(g.quote.total) + ' · ' : '') + '연출컷 ' + n + '장';
    var first = (g.images || [])[0];
    $('csThumb').hidden = !first;
    if (first) {
      $('csThumb').src = first.url;
      $('csThumb').alt = (first.label || '연출컷') + ' (보낼 연출컷)';
    }
  }

  // ── 보내기 ─────────────────────────────────────────────
  /** 고른 값이 목록 안이면 그 값, 아니면 null */
  function oneOf(list, v) {
    return list.indexOf(v) >= 0 ? v : null;
  }

  /** 고른 품목 — 목록 차례대로, 목록 안 값만 */
  function pickedItems() {
    var on = [];
    document.querySelectorAll('input[name="item"]:checked').forEach(function (el) {
      on.push(el.value);
    });
    return ITEM_KEYS.filter(function (k) {
      return on.indexOf(k) >= 0;
    });
  }

  /** 연출컷 품목 키가 품목 목록에 똑같이 있을 때만 미리 골라 둔다 (다른 키는 바꾸지 않는다) */
  function preselectItem(category) {
    if (ITEM_KEYS.indexOf(category) < 0) return;
    var el = document.querySelector('input[name="item"][value="' + category + '"]');
    if (el) el.checked = true;
  }

  /** consultations 한 줄 — consultation.html 이 쓰는 칸 + 앱 칸 */
  function buildRow() {
    var u = C.session.user || {};
    var now = new Date().toISOString();
    var demolition = picked('demolition');
    var third = $('csAgreeThird').checked;
    return {
      user_id: u.id || null,
      name: $('csName').value.trim(),
      email: u.email || '',
      phone: $('csPhone').value.trim(),
      consultation_type: 'ai-design',
      title: titleFor(C.gen),
      description: $('csDesc').value.trim() || null,
      preferred_time: $('csTime').value || null,
      status: 'pending',
      privacy_agreed_at: now,
      generation_id: C.id,
      quote: (C.gen && C.gen.quote) || null,
      sido: $('csSido').value || null,
      gugun: $('csGugun').value || null,
      furniture_categories: pickedItems(),
      door_finish: oneOf(DOOR_FINISHES, picked('doorFinish')),
      demolition_needed: demolition === 'yes' ? true : demolition === 'no' ? false : null,
      wanted_price_tier: oneOf(PRICE_TIERS, picked('priceTier')),
      // 업체 제공 동의 — 안 하면 둘 다 비운다 (다담 본사가 직접 상담)
      third_party_agreed_at: third ? now : null,
      consent_version: third ? CONSENT_VERSION : null,
    };
  }

  function check(row) {
    if (!row.name) return '이름을 적어 주세요.';
    if (!row.phone) return '연락처를 적어 주세요.';
    if (!(row.sido && row.gugun)) return '시공 지역(시/도 · 시/군/구)을 골라 주세요.';
    if (!row.furniture_categories.length) return '품목을 하나 이상 골라 주세요.';
    if (!row.door_finish) return '원하는 도어 마감을 골라 주세요.';
    if (row.demolition_needed == null) return '철거가 필요한지 골라 주세요.';
    if (!row.wanted_price_tier) return '원하는 가격대를 골라 주세요.';
    if (!$('csAgree').checked) return '개인정보 수집·이용에 동의해 주세요.';
    if (!row.email) return '로그인 계정의 이메일을 읽지 못했습니다. 다시 로그인해 주세요.';
    return '';
  }

  async function submit(e) {
    if (e) e.preventDefault();
    if (C.sending || picked('how') === 'call') return;
    var row = buildRow();
    var msg = check(row);
    if (msg) return error(msg);
    error('');
    C.sending = true;
    $('csSubmit').disabled = true;
    $('csSubmit').textContent = '보내는 중…';
    try {
      var r = await C.sb.from('consultations').insert(row);
      if (r && r.error) throw r.error;
      done(row);
    } catch (err) {
      error(
        '신청을 보내지 못했습니다. 잠시 뒤 다시 시도하거나 전화로 연락해 주세요.' +
          (err && err.message ? ' (' + err.message + ')' : '')
      );
    }
    C.sending = false;
    $('csSubmit').disabled = false;
    $('csSubmit').textContent = '상담 신청하기';
  }

  function done(row) {
    show('done');
    // 특정 업체를 약속하지 않는다 — 업체 제공에 동의하지 않았으면 본사가 직접
    $('csDoneText').textContent = row.third_party_agreed_at ? DONE_TEXT.partner : DONE_TEXT.hq;
    var b = biz();
    $('csDoneTel').innerHTML = b.tel
      ? '급하시면 전화 주세요: <a href="' +
        telHref(b.tel) +
        '">' +
        b.tel +
        '</a>' +
        (b.hours ? ' (' + b.hours + ')' : '')
      : '';
    $('csDoneBack').setAttribute('href', './?g=' + encodeURIComponent(C.id) + '#result');
  }

  // ── 시작 ───────────────────────────────────────────────
  async function init() {
    C.id = genId();
    $('csBack').setAttribute('href', C.id ? './?g=' + encodeURIComponent(C.id) + '#result' : './');
    var b = biz();
    if (b.tel) {
      $('csTel').setAttribute('href', telHref(b.tel));
      $('csCallNum').textContent = b.tel;
    }
    if (b.hours) $('csHoursNote').textContent = '남겨 주시면 ' + b.hours + ' 사이에 연락드립니다.';

    document.querySelectorAll('input[name="how"]').forEach(function (el) {
      el.addEventListener('change', renderHow);
    });
    $('csSido').addEventListener('change', function () {
      fillGugun('');
    });
    $('csForm').addEventListener('submit', submit);
    renderHow();

    C.sb = client();
    if (C.sb) {
      try {
        var r = await C.sb.auth.getSession();
        C.session = (r && r.data && r.data.session) || null;
      } catch {
        C.session = null;
      }
    }
    if (!C.session) {
      $('csLogin').setAttribute(
        'href',
        LOGIN_PAGE +
          '?redirect=' +
          encodeURIComponent('segan/consult.html' + (C.id ? '?g=' + C.id : ''))
      );
      return show('signed-out');
    }
    if (!C.id) return show('no-gen');
    if (!(await columnsReady())) return show('unavailable');
    try {
      C.gen = await loadGeneration(C.id);
    } catch {
      C.gen = null;
    }
    if (!C.gen) {
      $('csNoGenTitle').textContent = '연출컷을 찾지 못했습니다';
      return show('no-gen');
    }
    renderSummary(C.gen);
    preselectItem(C.gen.category);
    await prefill();
    show('form');
  }

  var api = {
    CONSENT_VERSION: CONSENT_VERSION,
    ITEM_KEYS: ITEM_KEYS,
    DOOR_FINISHES: DOOR_FINISHES,
    PRICE_TIERS: PRICE_TIERS,
    DONE_TEXT: DONE_TEXT,
    genId: genId,
    telHref: telHref,
    titleFor: titleFor,
    buildRow: buildRow,
    state: C,
  };
  window.SeganConsult = api;
  api.ready = new Promise(function (resolve) {
    var go = function () {
      init().then(resolve, resolve);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  });
})();
