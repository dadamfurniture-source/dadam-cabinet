/* ============================================================
   segan/partner-eval.js — 마이페이지 관리 › 플랫폼 › 「팩토리 평가」 (segan/me.html #partnerEval, 주소 #partner-eval)

   PC 화면 admin/partner-eval.html(팩토리 평가)을 마이페이지 안으로 옮긴 것 — 서버 · 권한은 그대로, 화면만.
   (마이페이지 B안 4단계 — 화면마다 PR 하나)

   누가 보나  사이트 관리자(is_admin — 셸 판정 roles.admin)만. segan/me.js 가 업체 칸을 읽은 뒤
             SeganPartnerEval.load(sb, session, partnerMe, { admin }) 를 부른다. 관리자가 아니면 묻지도 않는다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message } — 서버가 관리자를 다시 가린다)
               GET /admin/companies?pool=1            { items[{ id, name, kind, plan, sido, gugun, grade, evaluated_at,
                                                        docs_ok, settings_ok }] } — 활동 중인 Expert · Agent 팩토리 · 다담 공장
               GET /admin/companies/:id/evaluation    { company, evaluation, score, catalog, metrics, history }
               PUT /admin/companies/:id/evaluation    평가표 저장 — 등급은 서버가 평가표 점수로 매긴다 (본문에 싣지 않는다)
   화면      목록 — 팩토리마다 이름 · 종류 · 지역 · 평가일 · 등급 · 서류 · 상담 설정.
             누르면 그 팩토리의 평가표 (같은 화면 안 — 「‹ 팩토리 평가」 로 목록):
               설비 · 인력 · 마감 · 자재(거래 회사 줄 + 분야별 메모) · 설계 · 가격대 · 품질 · 서비스 · 신뢰 · 서류 ·
               본사 소통 · 본사 등급(보기만) · 메모 → 「저장」 → 평가 이력.
             항목 이름은 서버가 주는 catalog 를 그대로 쓴다 — 서버 상수에 항목을 더하면 이 화면도 따라온다.
             저장하지 않고 목록으로 가려 하면 그 자리에서 한 번 묻는다 (확인 창을 띄우지 않는다).
   못 읽으면  목록을 못 읽으면 칸째 감춘다 (오류 · 끊김 · 권한 없음 · 서버에 기능 없음) — 관리자에게는 PC 화면 줄이 남는다.
             평가표를 못 읽거나 저장이 안 되면 서버 글을 그 자리에 적는다.
   정보      평가 · 메모 · 평가한 사람 이메일은 화면에만 그린다 — 알림 · 주소 · 기기 저장에 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  // 고르는 값 — admin/partner-eval.html 과 같다 (DB 0018 칸 값)
  var EQUIP_CHOICES = [
    ['have', '있음'],
    ['outsource', '외주'],
    ['none', '없음'],
  ];
  var PRICE_TIERS = [
    ['basic', '보급'],
    ['mid', '중급'],
    ['high', '고급'],
  ];
  /** 서류 — 서버 catalog 에 docs 가 없을 때 쓰는 두 가지 (거르기 조건: 둘 다 본사 확인) */
  var DOC_ITEMS = [
    { key: 'insurance', name: '배상 책임 보험' },
    { key: 'contract', name: '표준 계약서' },
  ];
  var KIND_LABEL = { hq: '다담 공장' };
  var PLAN_LABEL = { agent: 'Agent', expert: 'Expert', manager: 'Manager' };
  /** 서버가 주는 자동 지표 이름 — 모르는 키는 키 그대로 보인다 */
  var METRIC_LABEL = {
    satisfaction: '고객 만족',
    response_rate: '24시간 안 받기',
    rework_free_rate: '재작업 없는 수주',
    rework_rate: '재작업 수주',
    orders_done: '완료 수주',
  };
  /** 협력 팩토리 월 회계 보고서 (같은 앱 안 화면) — ?company=<팩토리 id>, 새 탭 */
  var LEDGER_REPORT = 'ledger-report.html';
  var NOTE_MAX = 2000;
  var FINISH_NOTE_MAX = 500;

  var TEXT = {
    title: '팩토리 평가',
    lead: '상담 분배 순위의 본사 평가와 서류 확인 근거입니다. 팩토리 풀은 활동 중인 Expert · Agent 팩토리와 다담 공장입니다.',
    count: '곳',
    empty: '팩토리 풀이 비었습니다.',
    back: '‹ 팩토리 평가',
    loading: '불러오는 중',
    generic: '처리하지 못했습니다. 잠시 뒤 다시 해 주세요.',
    noName: '이름 없음',
    gradeNone: '등급 없음',
    notYet: '평가 전',
    docsOk: '서류 확인됨',
    docsNo: '서류 미확인',
    setOk: '상담 설정 마침',
    setNo: '상담 설정 안 함',
    lastEval: '마지막 평가',
    none: '없음',
    report: '장부 보고서 ↗',
    noCatalog: '서버가 항목 목록을 주지 않았습니다.',
    pickCompany: '회사 고르기',
    custom: '직접 적기',
    notListed: '목록에 없는 회사',
    companyName: '회사 이름',
    main: '주력',
    remove: '빼기',
    addCompany: '+ 회사 더하기',
    dedicated: '전담',
    people: '명',
    months: '개월',
    asMonths: 'A/S 기간',
    warrantyMonths: '하자 보증 기간',
    checked: '확인',
    checkedDate: '확인 날짜',
    hqComm: '본사 소통 점수',
    points: '점',
    total: '합계',
    notGraded: '아직 평가하지 않았습니다. 저장하면 등급이 매겨집니다.',
    noData: '자료 없음',
    memo: '메모',
    save: '저장',
    saving: '저장하는 중…',
    saved: '저장했습니다.',
    history: '평가 이력',
    noHistory: '이력이 없습니다.',
    grade: '등급',
    dirty: '저장하지 않은 내용이 있습니다.',
    discard: '버리고 나가기',
    keep: '계속 고치기',
  };

  var GROUP = {
    equipment: ['설비', ''],
    staff: ['인력', '실제 사람 수와 직무별 인원'],
    staffDed: ['인력', '실제 사람 수 · 직무별 인원 · 전담'],
    finishes: ['마감 · 자재', '거래 회사 · 주력 (점수에 쓰지 않습니다)'],
    design: ['설계', ''],
    price: ['가격대', ''],
    quality: ['품질 · 서비스', ''],
    docs: ['신뢰 · 서류', '둘 다 확인해야 상담을 받습니다'],
    hq_comm: ['본사 소통', '본사 설계 · 구성에 맞을수록 높게'],
    grade: ['본사 등급', '저장할 때 평가표 점수로 매깁니다'],
    note: ['메모', ''],
  };

  var E = {
    base: '',
    sb: null,
    session: null,
    ready: false,
    companies: [],
    id: '', // 연 팩토리 ('' = 목록)
    data: null, // 그 팩토리의 평가표 답
    failed: '', // 평가표를 못 읽은 까닭
    dirty: false,
    busy: false,
    asking: false, // 저장하지 않고 나가려 해서 묻는 중
    msg: '',
    err: '',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function has(o, k) {
    return Boolean(o) && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  }

  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  function arr(v) {
    return Array.isArray(v) ? v : [];
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function fmtDate(iso) {
    var d = new Date(iso || '');
    if (Number.isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function fmtDateTime(iso) {
    var d = new Date(iso || '');
    if (Number.isNaN(d.getTime())) return '-';
    return fmtDate(iso) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** 서류 확인 날짜 (YYYY-MM-DD) — 시각까지 있으면 이 브라우저의 날짜로 */
  function docDay(v) {
    if (typeof v !== 'string' || !v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    return fmtDate(v) === '-' ? '' : fmtDate(v);
  }

  function today() {
    return fmtDate(new Date(Date.now()).toISOString());
  }

  /** 종류 — 다담 공장 · 등급 이름 */
  function kindText(c) {
    var x = obj(c);
    if (has(KIND_LABEL, x.kind)) return KIND_LABEL[x.kind];
    return has(PLAN_LABEL, x.plan) ? PLAN_LABEL[x.plan] : x.plan || x.kind || '-';
  }

  /** catalog 항목 → [{ key, name, group }] — { key, name } · { key, label } · [key, name] · 'key' 모두 받는다 */
  function entries(list) {
    return arr(list)
      .map(function (e) {
        if (Array.isArray(e))
          return {
            key: String(e[0] == null ? '' : e[0]),
            name: String(e[1] == null ? (e[0] == null ? '' : e[0]) : e[1]),
            group: e[2],
          };
        if (e && typeof e === 'object') {
          var key = String(e.key == null ? (e.id == null ? '' : e.id) : e.key);
          return {
            key: key,
            name: String(e.name == null ? (e.label == null ? key : e.label) : e.name),
            group: e.group,
          };
        }
        return { key: String(e == null ? '' : e), name: String(e == null ? '' : e) };
      })
      .filter(function (e) {
        return e.key;
      });
  }

  /** 목록 줄 하나 — id 없는 줄은 버린다 */
  function rowOf(v) {
    var r = obj(v);
    var id = typeof r.id === 'string' ? r.id : '';
    if (!id) return null;
    return {
      id: id,
      name: typeof r.name === 'string' ? r.name : '',
      kind: typeof r.kind === 'string' ? r.kind : '',
      plan: typeof r.plan === 'string' ? r.plan : '',
      sido: typeof r.sido === 'string' ? r.sido : '',
      gugun: typeof r.gugun === 'string' ? r.gugun : '',
      grade: typeof r.grade === 'string' ? r.grade : '',
      evaluated_at: typeof r.evaluated_at === 'string' ? r.evaluated_at : '',
      docs_ok: r.docs_ok === true,
      settings_ok: r.settings_ok === true,
    };
  }

  /** 목록 — 배열이 아니면 null (이상한 답 → 칸을 감춘다) */
  function listOf(data) {
    var items = obj(data).items;
    if (!Array.isArray(items)) return null;
    return items.map(rowOf).filter(Boolean);
  }

  /** 목록 줄 아랫글 — 종류 · 지역 · 평가일 */
  function subOf(c) {
    return [
      kindText(c),
      [c.sido, c.gugun].filter(Boolean).join(' '),
      c.evaluated_at ? '평가 ' + fmtDate(c.evaluated_at) : TEXT.notYet,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** 자동 지표 한 칸의 글 */
  function metricText(key, v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return TEXT.noData;
    if (/_rate$/.test(key)) return Math.round(v * 100) + '%';
    if (key === 'satisfaction') return Math.round(v * 10) / 10 + ' / 5';
    return String(v);
  }

  async function token() {
    try {
      var r = E.sb && (await E.sb.auth.getSession());
      var s = r && r.data && r.data.session;
      if (s && s.access_token) return s.access_token;
    } catch {
      /* 아래 세션으로 */
    }
    return E.session ? E.session.access_token : '';
  }

  async function call(method, path, body) {
    if (!E.base) return { ok: false, status: 0, body: {} };
    var headers = { Authorization: 'Bearer ' + (await token()) };
    if (body) headers['Content-Type'] = 'application/json';
    var res;
    try {
      res = await fetch(E.base + path, {
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

  function evalPath(id) {
    return '/admin/companies/' + encodeURIComponent(id) + '/evaluation';
  }

  function sec() {
    return $('partnerEval');
  }

  function box() {
    return $('partnerEvalBody');
  }

  function companyOf(id) {
    return (
      E.companies.filter(function (c) {
        return c.id === id;
      })[0] || null
    );
  }

  // ── 그리기: 목록 ───────────────────────────────────────
  function badge(text) {
    return '<span class="me-badge pe-badge">' + esc(text) + '</span>';
  }

  function listHtml() {
    var list = E.companies;
    var head =
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p><p class="pe-count" data-pe="count">' +
      esc('팩토리 ' + list.length + TEXT.count) +
      '</p>';
    if (!list.length) return head + '<p class="me-empty">' + esc(TEXT.empty) + '</p>';
    return (
      head +
      '<ul class="sg-rows pe-list">' +
      list
        .map(function (c) {
          return (
            '<li><button type="button" class="sg-row me-hc-row pe-rowbtn" data-co="' +
            esc(c.id) +
            '"><span class="me-c-main"><b>' +
            esc(c.name || TEXT.noName) +
            '</b><small>' +
            esc(subOf(c)) +
            '</small></span><span class="pe-badges">' +
            badge(c.grade ? TEXT.grade + ' ' + c.grade : TEXT.gradeNone) +
            badge(c.docs_ok ? TEXT.docsOk : TEXT.docsNo) +
            badge(c.settings_ok ? TEXT.setOk : TEXT.setNo) +
            '</span></button></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  // ── 그리기: 평가표 ─────────────────────────────────────
  function group(key, body, name) {
    var g = GROUP[name || key];
    return (
      '<section class="pe-group" data-group="' +
      key +
      '"><h4 class="od-h">' +
      esc(g[0]) +
      (g[1] ? ' <small class="pe-hint">' + esc(g[1]) + '</small>' : '') +
      '</h4>' +
      body +
      '</section>'
    );
  }

  function emptyCatalog() {
    return '<p class="me-empty">' + esc(TEXT.noCatalog) + '</p>';
  }

  function line(name, ctl) {
    return (
      '<div class="pe-row"><span class="pe-name">' +
      esc(name) +
      '</span><span class="pe-ctl">' +
      ctl +
      '</span></div>'
    );
  }

  /** 하나 고르기 — name 이 같은 radio 묶음 */
  function seg(name, label, choices, value, attrs) {
    return (
      '<span class="pe-seg" role="radiogroup" aria-label="' +
      esc(label) +
      '">' +
      choices
        .map(function (c) {
          return (
            '<label class="pe-opt"><input type="radio" name="' +
            name +
            '" value="' +
            esc(c[0]) +
            '"' +
            (value === c[0] ? ' checked' : '') +
            (attrs || '') +
            '><span>' +
            esc(c[1]) +
            '</span></label>'
          );
        })
        .join('') +
      '</span>'
    );
  }

  function numInput(attrs, value, label) {
    var v = typeof value === 'number' && Number.isFinite(value) ? value : '';
    return (
      '<input class="pe-num" type="number" min="0" step="1" inputmode="numeric" ' +
      attrs +
      ' value="' +
      esc(v) +
      '" aria-label="' +
      esc(label) +
      '">'
    );
  }

  function check(attrs, on, label) {
    return (
      '<label class="pe-check"><input type="checkbox" ' +
      attrs +
      (on ? ' checked' : '') +
      '><span>' +
      esc(label) +
      '</span></label>'
    );
  }

  /**
   * 마감 · 자재 거래 회사 한 줄 — g: catalog suppliers 의 분야 { key, name, companies }, row: { key | name, main } (새 줄은 {}).
   * nameMax: 직접 적는 이름 글자 수 (catalog limits.supplier_name)
   */
  function supRowHtml(g, row, nameMax) {
    var companies = arr(g.companies).map(obj);
    var custom = typeof row.name === 'string';
    var pick = custom ? 'custom' : typeof row.key === 'string' ? 'key:' + row.key : '';
    var known = companies.some(function (c) {
      return 'key:' + c.key === pick;
    });
    var options = ['<option value="">' + esc(TEXT.pickCompany) + '</option>']
      .concat(
        companies.map(function (c) {
          return (
            '<option value="key:' +
            esc(c.key) +
            '"' +
            (pick === 'key:' + c.key ? ' selected' : '') +
            '>' +
            esc(c.name) +
            (c.kind ? ' — ' + esc(c.kind) : '') +
            '</option>'
          );
        })
      )
      // 목록에서 빠진 회사 — 그대로 보내면 서버가 「목록에 없는 항목」으로 알린다
      .concat(
        pick.indexOf('key:') === 0 && !known
          ? [
              '<option value="' +
                esc(pick) +
                '" selected>' +
                esc(TEXT.notListed + ' (' + row.key + ')') +
                '</option>',
            ]
          : []
      )
      .concat([
        '<option value="custom"' +
          (custom ? ' selected' : '') +
          '>' +
          esc(TEXT.custom) +
          '</option>',
      ])
      .join('');
    var max = Number.isInteger(nameMax) ? ' maxlength="' + nameMax + '"' : '';
    return (
      '<div class="pe-sup" data-sup-row><select data-sup-pick aria-label="' +
      esc(g.name + ' 회사') +
      '">' +
      options +
      '</select><input type="text" data-sup-name' +
      max +
      ' placeholder="' +
      esc(TEXT.companyName) +
      '" aria-label="' +
      esc(g.name + ' ' + TEXT.companyName) +
      '" value="' +
      esc(custom ? row.name : '') +
      '"' +
      (custom ? '' : ' hidden') +
      '>' +
      check('data-sup-main', row.main === true, TEXT.main) +
      '<button type="button" class="mk-btn pe-mini" data-act="sup-del">' +
      esc(TEXT.remove) +
      '</button></div>'
    );
  }

  /** 본사 등급 — 서버가 매긴 score { areas[{ key, name, points, max }], total, max, grade } (없으면 아직 평가 전) */
  function gradeHtml(score) {
    var s = obj(score);
    var n = function (v) {
      return typeof v === 'number' && Number.isFinite(v) ? String(v) : '-';
    };
    if (!s.grade) return '<p class="mk-note" data-pe="grade">' + esc(TEXT.notGraded) + '</p>';
    return (
      '<div data-pe="grade"><p class="pe-gradeline"><b class="pe-grade">' +
      esc(s.grade) +
      '</b> ' +
      esc(TEXT.total + ' ' + n(s.total) + ' / ' + n(s.max) + TEXT.points) +
      '</p>' +
      arr(s.areas)
        .map(function (a) {
          var x = obj(a);
          return (
            '<div class="pe-row"><span class="pe-name">' +
            esc(x.name || x.key || '') +
            '</span><span class="pe-ctl pe-score">' +
            esc(n(x.points) + ' / ' + n(x.max)) +
            '</span></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function formHtml(d) {
    var ev = obj(d.evaluation);
    var cat = obj(d.catalog);
    var equipment = entries(cat.equipment);
    var staff = entries(cat.staff_roles);
    // 전체 인원(실제 사람 수) — staff.total. 직무별 인원은 겸직이면 직무마다 센다
    var staffTotal = entries(cat.staff_total);
    // 전담 — staff.dedicated (그 일만 하는 사람이 있는 직무). catalog 에 칸이 있을 때만 직무마다 체크
    var staffDed = entries(cat.staff_dedicated);
    var dedKey = staffDed.length ? staffDed[0].key : null;
    var suppliers = arr(cat.suppliers).filter(function (g) {
      return g && g.key;
    });
    var limits = obj(cat.limits);
    var design = entries(cat.design);
    var docs = Array.isArray(cat.docs) && cat.docs.length ? entries(cat.docs) : DOC_ITEMS;
    var eq = obj(ev.equipment);
    var st = obj(ev.staff);
    var dedNow = dedKey && Array.isArray(st[dedKey]) ? st[dedKey] : [];
    var fi = obj(ev.finishes);
    var ds = obj(ev.design);
    var dc = obj(ev.docs);
    // 마감 · 자재 분야별 메모 — finishes.notes { 분야 키: 글 }, 칸은 catalog finish_notes 에 있는 분야만
    var fNotes = obj(fi.notes);
    var noteGroups = entries(cat.finish_notes);
    var noteMax = Number.isInteger(limits.finish_note) ? limits.finish_note : FINISH_NOTE_MAX;
    var noteBox = function (key) {
      var n = noteGroups.filter(function (x) {
        return x.key === key;
      })[0];
      if (!n) return '';
      var text = typeof fNotes[n.key] === 'string' ? fNotes[n.key] : '';
      return (
        '<textarea class="pe-text" data-finish-note="' +
        esc(n.key) +
        '" maxlength="' +
        noteMax +
        '" placeholder="' +
        esc(n.name + ' ' + TEXT.memo) +
        '" aria-label="' +
        esc(n.name + ' ' + TEXT.memo) +
        '">' +
        esc(text) +
        '</textarea>'
      );
    };
    // 마감 · 자재: 분야마다 지금 거래 회사 줄 (없으면 빈 줄 하나)
    var supRows = function (g) {
      var list = Array.isArray(fi[g.key]) ? fi[g.key].map(obj) : [];
      return (list.length ? list : [{}])
        .map(function (r) {
          return supRowHtml(g, r, limits.supplier_name);
        })
        .join('');
    };
    var hqMax = Number.isInteger(limits.hq_comm) ? limits.hq_comm : null;
    var metrics = obj(d.metrics || ev.metrics);
    var metricKeys = Object.keys(metrics);
    var metricHtml = metricKeys.length
      ? '<p class="pe-metrics" data-pe="metrics">' +
        metricKeys
          .map(function (k) {
            return (
              '<span>' +
              esc(has(METRIC_LABEL, k) ? METRIC_LABEL[k] : k) +
              ' <b>' +
              esc(metricText(k, metrics[k])) +
              '</b></span>'
            );
          })
          .join('') +
        '</p>'
      : '';

    return [
      group(
        'equipment',
        equipment.length
          ? equipment
              .map(function (e, i) {
                return line(
                  e.name,
                  seg(
                    'pe-eq-' + i,
                    e.name,
                    EQUIP_CHOICES,
                    eq[e.key],
                    ' data-key="' + esc(e.key) + '"'
                  )
                );
              })
              .join('')
          : emptyCatalog()
      ),
      group(
        'staff',
        staff.length
          ? staffTotal
              .map(function (e) {
                return line(
                  e.name,
                  numInput('data-staff-total="' + esc(e.key) + '"', st[e.key], e.name) +
                    ' ' +
                    esc(TEXT.people)
                );
              })
              .join('') +
              (staffTotal.length
                ? '<p class="pe-sub">' +
                  esc(
                    '직무별 (겸직이면 직무마다 셉니다' +
                      (dedKey ? ' · 그 일만 하는 사람이 있으면 전담' : '') +
                      ')'
                  ) +
                  '</p>'
                : '') +
              staff
                .map(function (e) {
                  return line(
                    e.name,
                    numInput('data-staff="' + esc(e.key) + '"', st[e.key], e.name) +
                      ' ' +
                      esc(TEXT.people) +
                      (dedKey
                        ? ' ' +
                          check(
                            'data-staff-ded="' + esc(e.key) + '"',
                            dedNow.indexOf(e.key) >= 0,
                            staffDed[0].name
                          )
                        : '')
                  );
                })
                .join('')
          : emptyCatalog(),
        dedKey ? 'staffDed' : 'staff'
      ),
      group(
        'finishes',
        suppliers.length
          ? suppliers
              .map(function (g) {
                return (
                  '<p class="pe-sub">' +
                  esc(g.name) +
                  '</p><div class="pe-sups" data-sup-group="' +
                  esc(g.key) +
                  '">' +
                  supRows(g) +
                  '</div><button type="button" class="mk-btn pe-mini" data-act="sup-add" data-key="' +
                  esc(g.key) +
                  '">' +
                  esc(TEXT.addCompany) +
                  '</button>' +
                  noteBox(g.key)
                );
              })
              .join('')
          : emptyCatalog()
      ),
      group(
        'design',
        design.length
          ? '<div class="pe-checks">' +
              design
                .map(function (e) {
                  return check('data-design="' + esc(e.key) + '"', ds[e.key] === true, e.name);
                })
                .join('') +
              '</div>'
          : emptyCatalog()
      ),
      group('price', seg('pe-price', GROUP.price[0], PRICE_TIERS, ev.price_tier, '')),
      group(
        'quality',
        line(
          TEXT.asMonths,
          numInput('id="peAsMonths"', ev.as_months, TEXT.asMonths + ' (' + TEXT.months + ')') +
            ' ' +
            esc(TEXT.months)
        ) +
          line(
            TEXT.warrantyMonths,
            numInput(
              'id="peWarrantyMonths"',
              ev.warranty_months,
              TEXT.warrantyMonths + ' (' + TEXT.months + ')'
            ) +
              ' ' +
              esc(TEXT.months)
          ) +
          metricHtml
      ),
      group(
        'docs',
        docs
          .map(function (e) {
            var day = docDay(obj(dc[e.key]).checked_at);
            return (
              '<div class="pe-row">' +
              check('data-doc="' + esc(e.key) + '"', !!day, e.name + ' ' + TEXT.checked) +
              '<span class="pe-ctl"><input class="pe-date" type="date" data-doc-date="' +
              esc(e.key) +
              '" value="' +
              esc(day) +
              '" aria-label="' +
              esc(e.name + ' ' + TEXT.checkedDate) +
              '"></span></div>'
            );
          })
          .join('')
      ),
      hqMax !== null
        ? group(
            'hq_comm',
            line(
              TEXT.hqComm,
              numInput('id="peHqComm" max="' + hqMax + '"', obj(ev.hq_comm).score, TEXT.hqComm) +
                ' / ' +
                hqMax +
                esc(TEXT.points)
            )
          )
        : '',
      group('grade', gradeHtml(d.score)),
      group(
        'note',
        '<textarea class="pe-text pe-text--tall" id="peNote" maxlength="' +
          NOTE_MAX +
          '" aria-label="' +
          esc(TEXT.memo) +
          '">' +
          esc(ev.note || '') +
          '</textarea>'
      ),
    ].join('');
  }

  function historyHtml(d) {
    var hist = arr(d.history).map(obj);
    return (
      '<section class="pe-group" data-group="history"><h4 class="od-h">' +
      esc(TEXT.history) +
      '</h4>' +
      (hist.length
        ? '<ol class="pe-history">' +
          hist
            .map(function (h) {
              return (
                '<li><span>' +
                esc(fmtDateTime(h.evaluated_at)) +
                '</span><span>' +
                esc(TEXT.grade + ' ' + (h.grade || TEXT.none)) +
                '</span>' +
                (h.evaluated_by_email
                  ? '<span class="pe-who">' + esc(h.evaluated_by_email) + '</span>'
                  : '') +
                '</li>'
              );
            })
            .join('') +
          '</ol>'
        : '<p class="me-empty">' + esc(TEXT.noHistory) + '</p>') +
      '</section>'
    );
  }

  function askHtml() {
    return (
      '<div class="pe-ask" data-pe="ask" role="alert"' +
      (E.asking ? '' : ' hidden') +
      '><span>' +
      esc(TEXT.dirty) +
      '</span><button type="button" class="mk-btn pe-mini" data-act="discard">' +
      esc(TEXT.discard) +
      '</button><button type="button" class="mk-btn pe-mini" data-act="keep">' +
      esc(TEXT.keep) +
      '</button></div>'
    );
  }

  function oneHtml() {
    var c = companyOf(E.id) || {};
    var head =
      '<button type="button" class="mk-link me-hc-back" data-act="back">' +
      esc(TEXT.back) +
      '</button>' +
      askHtml() +
      '<h3 class="me-pt-sub me-hc-name" id="partnerEvalName">' +
      esc(c.name || TEXT.noName) +
      '</h3>';
    if (E.failed)
      return head + '<p class="mk-error" data-pe="failed" role="alert">' + esc(E.failed) + '</p>';
    if (!E.data)
      return (
        head + '<p class="mk-note" data-pe="loading" role="status">' + esc(TEXT.loading) + '</p>'
      );
    var ev = obj(E.data.evaluation);
    return (
      head +
      '<p class="mk-note" data-pe="sub">' +
      esc(
        kindText(c) +
          ' · ' +
          TEXT.lastEval +
          ' ' +
          (ev.evaluated_at ? fmtDateTime(ev.evaluated_at) : TEXT.none)
      ) +
      '</p>' +
      // 협력 팩토리만 — 그 팩토리의 월 회계 보고서 (본사 보기 · 보고서만)
      (c.kind === 'partner'
        ? '<p class="pe-links"><a class="mk-link" data-pe="report" href="' +
          esc(LEDGER_REPORT + '?company=' + encodeURIComponent(c.id)) +
          '" target="_blank" rel="noopener">' +
          esc(TEXT.report) +
          '</a></p>'
        : '') +
      '<div class="pe-form" data-pe="form">' +
      formHtml(E.data) +
      '</div><p class="mk-error" data-pe="err" role="alert"' +
      (E.err ? '' : ' hidden') +
      '>' +
      esc(E.err) +
      '</p><div class="ps-bar pe-bar"><button type="button" class="mk-btn mk-btn--solid" data-act="save"' +
      (E.busy ? ' disabled' : '') +
      '>' +
      esc(TEXT.save) +
      '</button><p class="me-pt-msg ps-msg" data-pe="msg" role="status">' +
      esc(E.msg) +
      '</p></div>' +
      historyHtml(E.data)
    );
  }

  function render() {
    var b = box();
    var s = sec();
    if (!b || !s || !E.ready) return;
    b.innerHTML = E.id ? oneHtml() : listHtml();
    if (E.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    s.hidden = false;
  }

  function part(name) {
    var b = box();
    return b ? b.querySelector('[data-pe="' + name + '"]') : null;
  }

  /** 저장 줄의 글 · 오류 — 다시 그리지 않는다 (적던 칸이 그대로) */
  function say(msg, err) {
    E.msg = msg || '';
    E.err = err || '';
    var m = part('msg');
    var e = part('err');
    if (m) m.textContent = E.msg;
    if (e) {
      e.textContent = E.err;
      e.hidden = !E.err;
    }
  }

  function setBusy(on) {
    E.busy = on;
    var b = box();
    if (!b) return;
    if (on) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    var save = b.querySelector('[data-act="save"]');
    if (save) save.disabled = on;
  }

  function setAsking(on) {
    E.asking = on;
    var a = part('ask');
    if (a) a.hidden = !on;
  }

  function focusOn(sel) {
    var b = box();
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  function toTop() {
    var s = sec();
    if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start' });
  }

  function hide() {
    var b = box();
    var s = sec();
    if (b) {
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    if (s) s.hidden = true;
    E.ready = false;
  }

  // ── 입력 칸 → PUT 본문 ─────────────────────────────────
  function all(root, sel) {
    return Array.prototype.slice.call(root.querySelectorAll(sel));
  }

  function byAttr(root, sel, attr, key) {
    return (
      all(root, sel).filter(function (n) {
        return n.getAttribute(attr) === key;
      })[0] || null
    );
  }

  /**
   * 입력 칸 → PUT 본문. catalog 에 있는 키만 보낸다 (밖의 키는 서버가 422) — admin/partner-eval.html collect 와 같다.
   * 틀린 칸이 있으면 까닭을 던진다. form = 평가표 칸을 감싼 요소, d = 평가표 답
   */
  function collect(form, d) {
    var ev = obj(obj(d).evaluation);
    var cat = obj(obj(d).catalog);
    var checked = function (name) {
      var n = form.querySelector('input[name="' + name + '"]:checked');
      return n ? n.value : null;
    };
    var intOf = function (input, label) {
      var raw = String(input ? input.value : '').trim();
      if (raw === '') return null;
      var n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw new Error(label + ': 0 이상의 정수로 넣어 주세요.');
      return n;
    };

    var equipment = {};
    entries(cat.equipment).forEach(function (e, i) {
      var v = checked('pe-eq-' + i);
      if (v) equipment[e.key] = v;
    });
    var staff = {};
    entries(cat.staff_roles).forEach(function (e) {
      var v = intOf(byAttr(form, 'input[data-staff]', 'data-staff', e.key), '인력 ' + e.name);
      if (v !== null) staff[e.key] = v;
    });
    entries(cat.staff_total).forEach(function (e) {
      var v = intOf(byAttr(form, 'input[data-staff-total]', 'data-staff-total', e.key), e.name);
      if (v !== null) staff[e.key] = v;
    });
    // 전담 — 체크한 직무만 (인원이 있어야 하고, 전체 인원보다 많을 수 없다 — 서버도 같은 검사)
    var dedKey = entries(cat.staff_dedicated).map(function (e) {
      return e.key;
    })[0];
    if (dedKey) {
      var ded = [];
      entries(cat.staff_roles).forEach(function (e) {
        var b = byAttr(form, 'input[data-staff-ded]', 'data-staff-ded', e.key);
        if (!b || !b.checked) return;
        if (!(staff[e.key] >= 1))
          throw new Error('인력 ' + e.name + ': 전담이면 인원을 1명 이상 넣어 주세요.');
        ded.push(e.key);
      });
      var total = entries(cat.staff_total)
        .map(function (e) {
          return staff[e.key];
        })
        .filter(function (v) {
          return Number.isInteger(v);
        })[0];
      if (Number.isInteger(total) && ded.length > total)
        throw new Error(
          '인력: 전담 직무(' + ded.length + '개)가 전체 인원(' + total + '명)보다 많습니다.'
        );
      if (ded.length) staff[dedKey] = ded;
    }
    // 마감 · 자재 — 분야마다 고른 줄만 (고르지 않은 줄 · 이름을 안 적은 직접 적기는 보내지 않는다)
    var finishes = {};
    var supGroups = arr(cat.suppliers);
    all(form, '[data-sup-group]').forEach(function (grp) {
      var key = grp.getAttribute('data-sup-group');
      var g = obj(
        supGroups.filter(function (x) {
          return x && x.key === key;
        })[0]
      );
      var rows = [];
      var seen = {};
      all(grp, '[data-sup-row]').forEach(function (r) {
        var pick = r.querySelector('select[data-sup-pick]').value;
        var main = r.querySelector('input[data-sup-main]').checked;
        var row = null;
        if (pick === 'custom') {
          var name = r.querySelector('input[data-sup-name]').value.trim();
          if (name) row = { name: name, main: main };
        } else if (pick.indexOf('key:') === 0) row = { key: pick.slice(4), main: main };
        if (!row) return;
        var id = row.key !== undefined ? 'key:' + row.key : 'name:' + row.name;
        if (has(seen, id)) throw new Error((g.name || key) + ': 같은 회사를 두 번 넣었습니다.');
        seen[id] = true;
        rows.push(row);
      });
      if (rows.length) finishes[key] = rows;
    });
    var notes = {};
    all(form, 'textarea[data-finish-note]').forEach(function (n) {
      var v = n.value.trim();
      if (v) notes[n.getAttribute('data-finish-note')] = v;
    });
    if (Object.keys(notes).length) finishes.notes = notes;
    var design = {};
    all(form, 'input[data-design]').forEach(function (n) {
      design[n.getAttribute('data-design')] = n.checked;
    });

    var docs = {};
    var prevDocs = obj(ev.docs);
    all(form, 'input[data-doc]').forEach(function (n) {
      if (!n.checked) return;
      var key = n.getAttribute('data-doc');
      var dateInput = byAttr(form, 'input[data-doc-date]', 'data-doc-date', key);
      var day = (dateInput && dateInput.value) || today();
      var prev = obj(prevDocs[key]);
      // 날짜를 그대로 두면 확인한 사람 · 시각을 그대로 보낸다
      docs[key] = docDay(prev.checked_at) === day ? prev : { checked_at: day };
    });

    // 본사 소통 — 칸이 있을 때만 (catalog limits.hq_comm)
    var hqInput = form.querySelector('#peHqComm');
    var hqScore = hqInput ? intOf(hqInput, '본사 소통') : null;
    var hqMax = obj(cat.limits).hq_comm;
    if (hqScore !== null && hqScore > hqMax)
      throw new Error('본사 소통: 0~' + hqMax + '점으로 넣어 주세요.');
    var noteEl = form.querySelector('#peNote');
    var note = noteEl ? noteEl.value.trim() : '';
    var body = { equipment: equipment, staff: staff, finishes: finishes, design: design };
    if (hqInput) body.hq_comm = hqScore === null ? {} : { score: hqScore };
    body.price_tier = checked('pe-price');
    body.docs = docs;
    body.as_months = intOf(form.querySelector('#peAsMonths'), 'A/S 기간');
    body.warranty_months = intOf(form.querySelector('#peWarrantyMonths'), '하자 보증 기간');
    body.note = note || null;
    return body;
  }

  // ── 누른 일 ────────────────────────────────────────────
  /** 목록을 다시 읽는다 — 배열로 답했을 때만 true */
  async function reloadList() {
    var r = await call('GET', '/admin/companies?pool=1');
    var list = r.ok ? listOf(r.body.data) : null;
    if (!list) return false;
    E.companies = list;
    return true;
  }

  async function open(id) {
    if (!companyOf(id) || E.busy) return;
    E.id = id;
    E.data = null;
    E.failed = '';
    E.dirty = false;
    E.asking = false;
    E.msg = '';
    E.err = '';
    render();
    toTop();
    focusOn('[data-act="back"]');
    var r = await call('GET', evalPath(id));
    if (E.id !== id) return; // 그 사이 다른 곳으로 갔다
    if (r.ok) E.data = obj(r.body.data);
    else E.failed = errText(r);
    render();
  }

  function toList() {
    var id = E.id;
    E.id = '';
    E.data = null;
    E.failed = '';
    E.dirty = false;
    E.asking = false;
    E.msg = '';
    E.err = '';
    render();
    toTop();
    focusOn('[data-co="' + String(id).replace(/["\\]/g, '\\$&') + '"]');
  }

  function back() {
    if (E.busy) return;
    if (E.dirty) {
      setAsking(true);
      focusOn('[data-act="keep"]');
      return;
    }
    toList();
  }

  async function save() {
    if (!E.data || E.busy) return;
    var form = part('form');
    if (!form) return;
    var body;
    try {
      body = collect(form, E.data);
    } catch (e) {
      say('', e && e.message ? e.message : TEXT.generic);
      return;
    }
    var id = E.id;
    setAsking(false);
    setBusy(true);
    say(TEXT.saving, '');
    var r = await call('PUT', evalPath(id), body);
    if (!r.ok) {
      setBusy(false);
      say('', errText(r));
      return;
    }
    E.dirty = false;
    await reloadList();
    var again = await call('GET', evalPath(id));
    E.busy = false;
    if (E.id !== id) return;
    E.msg = TEXT.saved;
    E.err = '';
    if (again.ok) {
      E.data = obj(again.body.data);
      render();
      focusOn('[data-act="save"]');
    } else {
      // 다시 읽지 못했다 — 적은 칸은 그대로 두고 저장됐다는 글만
      setBusy(false);
      say(TEXT.saved, '');
    }
  }

  function supAdd(key) {
    var form = part('form');
    if (!form || !E.data) return;
    var cat = obj(E.data.catalog);
    var limits = obj(cat.limits);
    var g = obj(
      arr(cat.suppliers).filter(function (x) {
        return x && x.key === key;
      })[0]
    );
    var grp = byAttr(form, '[data-sup-group]', 'data-sup-group', key);
    if (!grp) return;
    if (
      Number.isInteger(limits.supplier_rows) &&
      grp.querySelectorAll('[data-sup-row]').length >= limits.supplier_rows
    ) {
      say('', (g.name || key) + ': 회사는 ' + limits.supplier_rows + '곳까지 넣을 수 있습니다.');
      return;
    }
    grp.insertAdjacentHTML('beforeend', supRowHtml(g, {}, limits.supplier_name));
    E.dirty = true;
    var added = grp.lastElementChild && grp.lastElementChild.querySelector('select');
    if (added && added.focus) added.focus();
  }

  function onClick(e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var co = t.closest('[data-co]');
    if (co && !E.id) {
      open(co.getAttribute('data-co'));
      return;
    }
    var el = t.closest('[data-act]');
    if (!el || el.disabled) return;
    var act = el.getAttribute('data-act');
    if (act === 'back') back();
    else if (act === 'discard') toList();
    else if (act === 'keep') {
      setAsking(false);
      focusOn('[data-act="save"]');
    } else if (E.busy) return;
    else if (act === 'save') save();
    else if (act === 'sup-add') supAdd(el.getAttribute('data-key') || '');
    else if (act === 'sup-del') {
      var row = el.closest('[data-sup-row]');
      if (row) row.remove();
      E.dirty = true;
    }
  }

  function inForm(el) {
    var form = part('form');
    return !!(form && el && form.contains(el));
  }

  function onInput(e) {
    if (inForm(e.target)) E.dirty = true;
  }

  function onChange(e) {
    var t = e.target;
    if (!inForm(t) || !t.matches) return;
    E.dirty = true;
    var form = part('form');
    // 거래 회사 「직접 적기」를 고르면 이름 칸
    if (t.matches('select[data-sup-pick]')) {
      var name = t.closest('[data-sup-row]').querySelector('input[data-sup-name]');
      name.hidden = t.value !== 'custom';
      if (!name.hidden) name.focus();
    }
    // 서류 날짜를 넣으면 확인 체크, 확인을 켜면 비어 있는 날짜에 오늘
    if (t.matches('input[data-doc-date]') && t.value) {
      var b = byAttr(form, 'input[data-doc]', 'data-doc', t.getAttribute('data-doc-date'));
      if (b) b.checked = true;
    }
    if (t.matches('input[data-doc]') && t.checked) {
      var date = byAttr(form, 'input[data-doc-date]', 'data-doc-date', t.getAttribute('data-doc'));
      if (date && !date.value) date.value = today();
    }
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('input', onInput);
    b.addEventListener('change', onChange);
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 관리자가 아니거나 못 읽으면 칸을 감춘 채 둔다 */
  async function load(sb, session, me, opts) {
    hide();
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.workflowApi;
    E.base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    E.sb = sb || null;
    E.session = session || null;
    E.companies = [];
    E.id = '';
    E.data = null;
    E.failed = '';
    E.dirty = false;
    E.busy = false;
    E.asking = false;
    E.msg = '';
    E.err = '';
    if (!E.base || !session || !(opts && opts.admin === true)) return;
    try {
      if (!(await reloadList())) return;
      bind();
      E.ready = true;
      render();
    } catch {
      hide();
    }
  }

  window.SeganPartnerEval = {
    EQUIP_CHOICES: EQUIP_CHOICES,
    PRICE_TIERS: PRICE_TIERS,
    DOC_ITEMS: DOC_ITEMS,
    METRIC_LABEL: METRIC_LABEL,
    TEXT: TEXT,
    GROUP: GROUP,
    entries: entries,
    rowOf: rowOf,
    listOf: listOf,
    subOf: subOf,
    kindText: kindText,
    metricText: metricText,
    docDay: docDay,
    collect: collect,
    state: E,
    load: load,
  };
})();
