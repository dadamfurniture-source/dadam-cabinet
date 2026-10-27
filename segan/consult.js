/* ============================================================
   segan/consult.js — ④ 상담 신청 (consult.html?g=<연출컷 id>)

   저장은 consultation.html 과 같은 길이다: Supabase consultations 에 insert
   (→ on_new_consultation 트리거가 관리자 알림 로그를 남긴다). 새 엔드포인트를 만들지 않는다.

   고객이 적는 것: 이름 · 연락처(필수, 프로필에서 채움), 시공 지역(시/도 · 시/군/구 — signup.html 과
   같은 목록), 연락 받기 좋은 시간(consultation.html 과 같은 값), 요청 사항, 개인정보 동의(필수).
   저절로 채우는 것: 이메일(로그인 계정), 상담 제목(「AI 연출컷 상담 — 품목」), 상담 유형 'ai-design',
   이 연출컷(generation_id)과 그 예상 견적(quote), 동의 시각(privacy_agreed_at).
   상담받을 곳(본사 · 협력업체)은 고객의 선택만 남긴다 — 협력업체 연결은 아직 하지 않는다.
   「지금 전화하기」는 저장하지 않고 대표 전화(사업자 정보와 같은 번호)를 연다.

   새 칸(generation_id · quote · sido · gugun · consult_target)은 database/consultations-app.sql 이
   더한다. 그 칸이 아직 없으면 신청서 대신 「아직 받을 수 없습니다」 + 전화를 보인다.
   ============================================================ */
/* global window, document, location, fetch, URLSearchParams */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var NEW_COLUMNS = 'generation_id,quote,sido,gugun,consult_target,privacy_agreed_at';
  var LOGIN_PAGE = '../login.html';

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
    var partner = picked('target') === 'partner';
    $('csFields').hidden = call;
    $('csCall').hidden = !call;
    $('csSubmit').hidden = call;
    $('csTel').hidden = !call;
    $('csCallPartner').hidden = !partner;
    $('csSidoLabel').textContent = partner ? '시공 지역 · 시/도 · 필수' : '시공 지역 · 시/도';
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
  /** consultations 한 줄 — consultation.html 이 쓰는 칸 + 앱 칸 */
  function buildRow() {
    var u = C.session.user || {};
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
      privacy_agreed_at: new Date().toISOString(),
      generation_id: C.id,
      quote: (C.gen && C.gen.quote) || null,
      sido: $('csSido').value || null,
      gugun: $('csGugun').value || null,
      consult_target: picked('target') === 'partner' ? 'partner' : 'hq',
    };
  }

  function check(row) {
    if (!row.name) return '이름을 적어 주세요.';
    if (!row.phone) return '연락처를 적어 주세요.';
    if (row.consult_target === 'partner' && !(row.sido && row.gugun))
      return '협력업체를 찾으려면 시공 지역을 골라 주세요.';
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
    $('csDonePartner').hidden = row.consult_target !== 'partner';
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

    document.querySelectorAll('input[name="how"], input[name="target"]').forEach(function (el) {
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
    await prefill();
    show('form');
  }

  var api = { genId: genId, telHref: telHref, titleFor: titleFor, buildRow: buildRow, state: C };
  window.SeganConsult = api;
  api.ready = new Promise(function (resolve) {
    var go = function () {
      init().then(resolve, resolve);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  });
})();
