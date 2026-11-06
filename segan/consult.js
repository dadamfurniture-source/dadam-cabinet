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
   (consultation.html 과 같은 값), 시공 완료 희망 날짜(예: 입주 날, 선택 → wanted_done_date), 요청 사항, 동의 둘:
     개인정보 수집 · 이용 (필수) → privacy_agreed_at
     다담 협력업체 목록 중 다담이 정한 업체에 제공 (선택) → third_party_agreed_at · consent_version 'v2'
     시공 사진 학습 활용 (선택, 2026-11-06 작업 분배 ⑥) → photo_learn_agreed_at (DB 0044) — 동의한 수주의 완료 사진만 학습에 쓴다
       (v2 = 제공 항목에 시공 완료 희망 날짜를 더한 판)
       동의하지 않아도 신청은 간다 — 다담 본사가 직접 상담한다 (두 칸은 비운다).
   저절로 채우는 것: 이메일(로그인 계정), 상담 제목(「AI 연출컷 상담 — 품목」), 상담 유형 'ai-design',
   이 연출컷(generation_id)과 그 예상 견적(quote).
   「지금 전화하기」는 저장하지 않고 대표 전화(사업자 정보와 같은 번호)를 연다.

   앱 칸(generation_id · quote · sido · gugun)은 database/consultations-app.sql, 도어 마감 · 철거 · 가격대 ·
   업체 제공 동의 칸은 database/migrations/0019, 시공 완료 희망 날짜 칸은 0021 이 더한다. 그 칸이 아직 없으면 신청서 대신
   「아직 받을 수 없습니다」 + 전화를 보인다.

   일반 상담 (주소에 ?g= 가 없을 때 — 연출컷 없이): 사이트 consultation.html 과 같은 신청서다.
     같은 칸 — 상담 유형(ai-design · detail-design · estimate · other) · 이름 · 연락처 · 이메일 · 시공 지역 ·
       도어 마감 · 철거 · 가격대 · 상담 제목 · 상세 내용 · 가구 종류 · 설치 공간 · 예산 범위 · 공간 크기 · 선호 스타일 ·
       시공 완료 희망 날짜 · 희망 날짜 · 시간대
       (consultation.html 의 「상세설계 권한 신청」만 앱에 두지 않는다 — request_detail_design 은 보내지 않고
        DB 기본값(false), profiles.detaildesign_requested_at 도 적지 않는다)
     같은 검사 · 같은 글 (consultation.html missingMessage), 같은 동의 둘 (수집 · 이용 필수, 업체 제공 선택 — v2)
     같은 저장 — consultations insert 한 줄 (같은 칸 이름 · 같은 값, 위 한 칸만 빼고)
     로그인 없이도 보낸다 (user_id 없음 — insert 정책이 받는다). 로그인했으면 가입 정보(user_metadata)로
       이름 · 이메일 · 연락처 · 거주지역을 채운다 (consultation.html checkAuthState)
   ============================================================ */
/* global window, document, location, fetch, URLSearchParams */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // 넣는 칸 중 consultation.html 에 없는 것 — 하나라도 없으면 신청서를 열지 않는다
  var NEW_COLUMNS =
    'generation_id,quote,sido,gugun,privacy_agreed_at,' +
    'door_finish,demolition_needed,wanted_price_tier,third_party_agreed_at,consent_version,wanted_done_date,' +
    'photo_learn_agreed_at';
  var LOGIN_PAGE = '../login.html';
  // 업체 제공 동의 문구 판 — consult.html 「제공하는 내용 보기」를 바꾸면 올린다
  var CONSENT_VERSION = 'v2';
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
    partner: '다담 본사가 확인한 뒤 가까운 팩토리를 연결해 드립니다.',
    hq: '다담 본사가 확인한 뒤 남기신 연락처로 직접 연락드립니다.',
  };
  // 일반 상담 — consultation.html 의 상담 유형 값 · 검사 글 · 저장 실패 글
  var CONSULT_TYPES = ['ai-design', 'detail-design', 'estimate', 'other'];
  var GENERAL_ERR = {
    required: '필수 항목을 모두 입력해주세요.',
    region: '시공 지역(시/도 · 시/군/구)을 골라 주세요.',
    door: '원하는 도어 마감을 골라 주세요.',
    demolition: '철거가 필요한지 골라 주세요.',
    price: '원하는 가격대를 골라 주세요.',
    privacy: '개인정보 수집·이용에 동의해 주세요.',
    noTable: '상담 신청 기능을 이용하려면 관리자에게 문의하세요. (데이터베이스 설정 필요)',
    failed: '신청 중 오류가 발생했습니다: ',
    noClient: '서비스에 연결할 수 없습니다.',
  };

  var C = {
    id: '',
    general: false, // 주소에 ?g= 가 없다 — 일반 상담
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

  /** 주소에 ?g= 가 있는가 — 없으면 일반 상담 (값이 틀리면 연출컷 상담의 「찾지 못했습니다」) */
  function hasGen() {
    return new URLSearchParams(location.search).has('g');
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
  function fillSido(selected, id) {
    var R = window.SeganRegions || {};
    var sel = $(id || 'csSido');
    sel.innerHTML =
      '<option value="">시/도 선택</option>' +
      Object.keys(R)
        .map(function (s) {
          return '<option value="' + s + '">' + s + '</option>';
        })
        .join('');
    sel.value = R[selected] ? selected : '';
  }

  function fillGugun(selected, sidoId, gugunId) {
    var R = window.SeganRegions || {};
    var list = R[$(sidoId || 'csSido').value] || [];
    var sel = $(gugunId || 'csGugun');
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

  /** 오늘(KST) 'YYYY-MM-DD' — 시공 완료 희망 날짜는 오늘부터 고른다 */
  function kstToday() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }

  /** consultations 한 줄 — consultation.html 이 쓰는 칸 + 앱 칸 */
  function buildRow() {
    var u = C.session.user || {};
    var now = new Date().toISOString();
    var demolition = picked('demolition');
    var third = $('csAgreeThird').checked;
    var photoLearn = $('csAgreePhoto').checked;
    return {
      user_id: u.id || null,
      name: $('csName').value.trim(),
      email: u.email || '',
      phone: $('csPhone').value.trim(),
      consultation_type: 'ai-design',
      title: titleFor(C.gen),
      description: $('csDesc').value.trim() || null,
      preferred_time: $('csTime').value || null,
      // 시공 완료 희망 날짜 — 다담 본사가 업체를 고를 때 업체의 「고객 확정 ~ 시공 완료 기간」과 견준다
      wanted_done_date: DATE_RE.test($('csWantDate').value) ? $('csWantDate').value : null,
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
      // 시공 사진 학습 활용 동의 — 안 하면 비운다 (상담 · 시공은 똑같다)
      photo_learn_agreed_at: photoLearn ? now : null,
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
    if (row.wanted_done_date && row.wanted_done_date < kstToday())
      return '시공 완료 희망 날짜는 오늘이나 그 뒤로 골라 주세요.';
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
    if (C.general) {
      $('csDoneBack').setAttribute('href', './');
      $('csDoneBack').textContent = '만들기로 가기';
    } else {
      $('csDoneBack').setAttribute('href', './?g=' + encodeURIComponent(C.id) + '#result');
    }
  }

  // ── 일반 상담 (연출컷 없이) — consultation.html 과 같은 칸 · 검사 · 동의 · 저장 ─────
  /** 고른 라디오 값 — 목록 안 값만, 없으면 null (consultation.html pickedValue) */
  function pickedIn(name, allowed) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el && allowed.indexOf(el.value) >= 0 ? el.value : null;
  }

  /** 숫자 칸 — consultation.html 과 같이 parseInt, 못 읽거나 0 이면 null */
  function intOrNull(id) {
    return parseInt($(id).value, 10) || null;
  }

  /** consultations 한 줄 — consultation.html submitConsultation 의 insert 와 같은 칸 · 같은 값
   *  (request_detail_design 만 뺀다) */
  function buildGeneralRow() {
    var u = (C.session && C.session.user) || null;
    var now = new Date().toISOString();
    var third = $('csgAgreeThird').checked;
    var items = [];
    document.querySelectorAll('input[name="csgItem"]:checked').forEach(function (el) {
      items.push(el.value);
    });
    return {
      user_id: (u && u.id) || null,
      name: $('csgName').value.trim(),
      email: $('csgEmail').value.trim(),
      phone: $('csgPhone').value.trim(),
      consultation_type: pickedIn('csgType', CONSULT_TYPES),
      title: $('csgTitle').value.trim(),
      description: $('csgDesc').value.trim() || null,
      preferred_date: $('csgPrefDate').value || null,
      preferred_time: $('csgTime').value || null,
      wanted_done_date: $('csgWantDate').value || null,
      status: 'pending',
      furniture_categories: items.length ? items : null,
      space_type: $('csgSpace').value || null,
      space_width_mm: intOrNull('csgWidth'),
      space_height_mm: intOrNull('csgHeight'),
      space_depth_mm: intOrNull('csgDepth'),
      budget_range: $('csgBudget').value || null,
      style_preference: $('csgStyle').value || null,
      sido: $('csgSido').value,
      gugun: $('csgGugun').value,
      door_finish: pickedIn('csgDoor', DOOR_FINISHES),
      demolition_needed: pickedIn('csgDemolition', ['yes', 'no']) === 'yes',
      wanted_price_tier: pickedIn('csgPrice', PRICE_TIERS),
      privacy_agreed_at: now,
      // 업체 제공 동의 — 안 하면 둘 다 비운다 (다담 본사가 직접 상담)
      third_party_agreed_at: third ? now : null,
      consent_version: third ? CONSENT_VERSION : null,
    };
  }

  /** 빠진 필수 항목 — consultation.html missingMessage 와 같은 차례 · 같은 글, 다 있으면 '' */
  function checkGeneral(row) {
    if (!row.name || !row.phone || !row.email || !row.title) return GENERAL_ERR.required;
    if (!(row.sido && row.gugun)) return GENERAL_ERR.region;
    if (!row.door_finish) return GENERAL_ERR.door;
    if (!pickedIn('csgDemolition', ['yes', 'no'])) return GENERAL_ERR.demolition;
    if (!row.wanted_price_tier) return GENERAL_ERR.price;
    if (!$('csgAgree').checked) return GENERAL_ERR.privacy;
    return '';
  }

  function generalError(msg) {
    $('csgError').textContent = msg || '';
    $('csgError').hidden = !msg;
  }

  async function submitGeneral(e) {
    if (e) e.preventDefault();
    if (C.sending) return;
    var row = buildGeneralRow();
    var msg = checkGeneral(row);
    if (msg) return generalError(msg);
    if (!C.sb) return generalError(GENERAL_ERR.failed + GENERAL_ERR.noClient);
    generalError('');
    C.sending = true;
    $('csgSubmit').disabled = true;
    $('csgSubmit').textContent = '신청 중...';
    try {
      var r = await C.sb.from('consultations').insert(row);
      if (r && r.error) throw r.error;
      done(row);
    } catch (err) {
      var m = (err && err.message) || '';
      generalError(m.indexOf('consultations') >= 0 ? GENERAL_ERR.noTable : GENERAL_ERR.failed + m);
    }
    C.sending = false;
    $('csgSubmit').disabled = false;
    $('csgSubmit').textContent = '상담 신청하기';
  }

  /** 로그인했으면 가입 정보로 채운다 — 거주지역은 목록에 있을 때만 (consultation.html checkAuthState) */
  function prefillGeneral() {
    var u = C.session && C.session.user;
    if (!u) return;
    var meta = u.user_metadata || {};
    $('csgName').value = meta.name || meta.full_name || '';
    $('csgEmail').value = u.email || '';
    $('csgPhone').value = meta.phone || '';
    var R = window.SeganRegions || {};
    if (meta.sido && R[meta.sido]) {
      fillSido(meta.sido, 'csgSido');
      fillGugun(meta.gugun, 'csgSido', 'csgGugun');
    }
  }

  function startGeneral() {
    C.general = true;
    $('csTitle').textContent = '상담 신청';
    $('csBack').hidden = true;
    fillSido('', 'csgSido');
    fillGugun('', 'csgSido', 'csgGugun');
    $('csgSido').addEventListener('change', function () {
      fillGugun('', 'csgSido', 'csgGugun');
    });
    $('csgWantDate').min = kstToday();
    $('csgPrefDate').min = kstToday();
    $('csgForm').addEventListener('submit', submitGeneral);
    prefillGeneral();
    show('general');
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
    $('csWantDate').min = kstToday();

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
    // ?g= 가 없으면 일반 상담 — 로그인 없이도 받는다 (consultation.html 과 같다)
    if (!hasGen()) return startGeneral();
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
    CONSULT_TYPES: CONSULT_TYPES,
    GENERAL_ERR: GENERAL_ERR,
    buildGeneralRow: buildGeneralRow,
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
