/* ============================================================
   segan/hq-companies.js — 마이페이지 본사 › 업체관리 › 등록 업체 (segan/me.html #hqCompanies, 주소 #companies)

   누가 보나  다담 본사 구성원 (account-api GET /partner/me 의 platform_member) — 서버가 본사 대표 · 실장만 연다.
             segan/me.js 가 업체 칸을 읽은 뒤 SeganHqCompanies.load(sb, session, partnerMe) 를 부른다.
             못 읽으면(403 not_platform · 404 · 오류 · 끊김 · 모양이 틀림) 칸째 감춘다 — 메뉴 줄도 없다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data })
               GET /hq/companies                 { items[{ id, kind, name, plan, status, sido, gugun, members, projects, ledger }] }
               GET /hq/companies/:id/projects    { company, items[{ id, title, status, created_at, stage, order_status,
                                                   design_count, assignee { name, role } | null }] }
               GET /hq/companies/:id/members     { company, items[{ name, role, status, joined_at }] }
   화면      목록 — 업체마다 이름 · 종류(다담 공장 · 등급) · 지역 · 상태(이용 중은 적지 않는다) · 구성원 수 · 프로젝트 수.
             누르면 그 업체 (같은 화면 안 — 「‹ 등록 업체」 로 목록), 탭 셋:
               프로젝트  단계별 수(상담 ~ 설치 — segan/partner-projects.js menuStage) · 줄(이름 · 단계 · 상태 · 설계 수 · 담당)
               회계      협력업체 = 월 장부 보고서 새 탭(ledger-report.html?company=), 다담 공장 = 장부 보기(ledger.html?company=),
                         장부가 없으면 안내 한 줄 (보고서 · 장부 화면이 본사 대표 · 실장을 다시 가린다 — workflow-api ledger/access.js)
               인력      구성원 — 이름 · 직책 · 상태 · 들어온 날
             고객 이름 · 전화 · 금액 · 이메일은 서버가 싣지 않는다.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PLAN_NAME = { manager: 'Manager', expert: 'Expert', agent: 'Agent' }; // 등급 (company.plan)
  var ROLE_NAME = { owner: '대표', manager: '실장', staff: '직원' }; // 업체 안 직책 — manager 는 「실장」
  var COMPANY_STATUS = { suspended: '결제 멈춤', closed: '해지됨' }; // active 는 적지 않는다
  var PROJECT_STATUS = { closed: '끝남', cancelled: '취소', handed_over: '넘김' }; // segan/me.js 와 같다
  var MEMBER_STATUS = { removed: '내보냄' };
  var STAGES = [
    ['consult', '상담'],
    ['design', '설계'],
    ['quote', '견적'],
    ['contract', '계약'],
    ['make', '제작'],
    ['install', '설치'],
  ];
  var TABS = [
    ['projects', '프로젝트'],
    ['ledger', '회계'],
    ['people', '인력'],
  ];
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  var TEXT = {
    lead: '등록 업체를 누르면 그 업체의 프로젝트 · 회계 · 인력을 봅니다. 보기만 합니다.',
    empty: '등록 업체가 없습니다.',
    back: '‹ 등록 업체',
    loading: '불러오는 중',
    fail: '불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
    noProjects: '프로젝트가 없습니다.',
    noPeople: '구성원이 없습니다.',
    noLedger: '이 업체는 장부를 쓰지 않습니다 (회계 관리는 Agent 등급부터).',
    report: '월 장부 보고서 열기',
    reportNote: '그 업체의 월 보고서만 봅니다 — 장부 줄 · 영수증 사진은 열지 않습니다.',
    factoryLedger: '공장 장부 보기',
    factoryNote: '다담 공장 장부를 보기만 합니다.',
    noAssignee: '담당자 없음',
  };

  var C = {
    sb: null,
    session: null,
    base: '', // workflow-api
    list: null, // GET /hq/companies items
    co: '', // 고른 업체 id
    tab: 'projects',
    detail: {}, // id → { projects, people } (한 번 읽은 것)
    busy: false,
    err: '',
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** 한국 시간 날짜 */
  function kstDay(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate());
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  /** 다담 본사 구성원 — /partner/me 가 platform_member 로 준다 */
  function canSee(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.platform_member === true;
  }

  /** 프로젝트 → 하위 메뉴 단계 (segan/partner-projects.js menuStage — 없으면 상담) */
  function stageOf(p) {
    var PP = window.SeganPartnerProjects;
    return PP && PP.menuStage ? PP.menuStage(p.stage, p.order_status) : 'consult';
  }

  /** 종류 이름 — 다담 공장 · 협력업체 등급 */
  function kindName(c) {
    return c.kind === 'hq' ? '다담 공장' : PLAN_NAME[c.plan] || '협력업체';
  }

  /** GET 본문 → items 배열 (id 가 uuid 인 업체 · 프로젝트만) | null */
  function itemsOf(body, needId) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || !Array.isArray(d.items)) return null;
    return d.items.filter(function (x) {
      return x && typeof x === 'object' && (!needId || UUID_RE.test(String(x.id || '')));
    });
  }

  /** 단계별 프로젝트 수 — [[단계 이름, 수]] (상담 ~ 설치) */
  function stageCounts(projects) {
    var n = {};
    (projects || []).forEach(function (p) {
      var k = stageOf(p);
      n[k] = (n[k] || 0) + 1;
    });
    return STAGES.map(function (s) {
      return [s[1], n[s[0]] || 0];
    });
  }

  // ── 그리기 ─────────────────────────────────────────────
  function listHtml() {
    var list = C.list || [];
    if (!list.length) return '<p class="me-empty">' + esc(TEXT.empty) + '</p>';
    return (
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p><ul class="sg-rows me-hc-list">' +
      list
        .map(function (c) {
          var sub = [
            kindName(c),
            [c.sido, c.gugun].filter(Boolean).join(' '),
            '구성원 ' + (Number(c.members) || 0) + '명',
            '프로젝트 ' + (Number(c.projects) || 0) + '건',
          ]
            .filter(Boolean)
            .join(' · ');
          var status = COMPANY_STATUS[c.status] || '';
          return (
            '<li><button type="button" class="sg-row me-hc-row" data-co="' +
            esc(c.id) +
            '"><span class="me-c-main"><b>' +
            esc(c.name || '이름 없음') +
            '</b><small>' +
            esc(sub) +
            '</small></span>' +
            (status ? '<span class="me-badge">' + esc(status) + '</span>' : '') +
            '</button></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function projectsHtml(projects) {
    var counts = stageCounts(projects);
    return (
      '<dl class="me-facts me-hc-stages">' +
      counts
        .map(function (s) {
          return '<div><dt>' + esc(s[0]) + '</dt><dd>' + s[1] + '</dd></div>';
        })
        .join('') +
      '</dl>' +
      (projects.length
        ? '<ul class="sg-rows">' +
          projects
            .map(function (p) {
              var label = '';
              STAGES.forEach(function (s) {
                if (s[0] === stageOf(p)) label = s[1];
              });
              var who = p.assignee
                ? '담당 ' +
                  (p.assignee.name || '') +
                  (ROLE_NAME[p.assignee.role] ? ' (' + ROLE_NAME[p.assignee.role] + ')' : '')
                : TEXT.noAssignee;
              var sub = [
                label,
                kstDay(p.created_at),
                '설계 ' + (Number(p.design_count) || 0) + '개',
                who,
              ]
                .filter(Boolean)
                .join(' · ');
              var status = PROJECT_STATUS[p.status] || '';
              return (
                '<li class="me-hc-item"><span class="me-c-main"><b>' +
                esc(p.title || '프로젝트') +
                '</b><small>' +
                esc(sub) +
                '</small></span>' +
                (status ? '<span class="me-badge">' + esc(status) + '</span>' : '') +
                '</li>'
              );
            })
            .join('') +
          '</ul>'
        : '<p class="me-empty">' + esc(TEXT.noProjects) + '</p>')
    );
  }

  function ledgerHtml(c) {
    if (c.ledger !== 'full' && c.ledger !== 'read')
      return '<p class="me-empty">' + esc(TEXT.noLedger) + '</p>';
    var hq = c.kind === 'hq';
    var href = (hq ? 'ledger.html' : 'ledger-report.html') + '?company=' + encodeURIComponent(c.id);
    return (
      '<p class="mk-note">' +
      esc(hq ? TEXT.factoryNote : TEXT.reportNote) +
      '</p><ul class="sg-rows"><li><a class="sg-row" href="' +
      esc(href) +
      '"' +
      (hq ? '' : ' target="_blank" rel="noopener"') +
      '>' +
      esc(hq ? TEXT.factoryLedger : TEXT.report) +
      '</a></li></ul>'
    );
  }

  function peopleHtml(people) {
    if (!people.length) return '<p class="me-empty">' + esc(TEXT.noPeople) + '</p>';
    return (
      '<ul class="sg-rows">' +
      people
        .map(function (m) {
          var sub = [
            ROLE_NAME[m.role] || '',
            kstDay(m.joined_at) ? kstDay(m.joined_at) + ' 들어옴' : '',
          ]
            .filter(Boolean)
            .join(' · ');
          var status = MEMBER_STATUS[m.status] || '';
          return (
            '<li class="me-hc-item"><span class="me-c-main"><b>' +
            esc(m.name || ROLE_NAME[m.role] || '이름 없음') +
            '</b><small>' +
            esc(sub) +
            '</small></span>' +
            (status ? '<span class="me-badge">' + esc(status) + '</span>' : '') +
            '</li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  function detailHtml(c) {
    var d = C.detail[c.id] || {};
    var body = '';
    if (C.err) body = '<p class="mk-error" role="alert">' + esc(C.err) + '</p>';
    else if (C.tab === 'ledger') body = ledgerHtml(c);
    else if (C.tab === 'people')
      body = d.people ? peopleHtml(d.people) : '<p class="me-empty">' + esc(TEXT.loading) + '</p>';
    else
      body = d.projects
        ? projectsHtml(d.projects)
        : '<p class="me-empty">' + esc(TEXT.loading) + '</p>';
    var sub = [
      kindName(c),
      [c.sido, c.gugun].filter(Boolean).join(' '),
      COMPANY_STATUS[c.status] || '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      '<button type="button" class="mk-link me-hc-back" data-act="back">' +
      esc(TEXT.back) +
      '</button>' +
      '<h3 class="me-pt-sub me-hc-name">' +
      esc(c.name || '이름 없음') +
      '</h3><p class="mk-note">' +
      esc(sub) +
      '</p><div class="me-hc-tabs" role="tablist">' +
      TABS.map(function (t) {
        return (
          '<button type="button" role="tab" data-tab="' +
          t[0] +
          '" aria-selected="' +
          (C.tab === t[0]) +
          '">' +
          esc(t[1]) +
          '</button>'
        );
      }).join('') +
      '</div><div class="me-hc-body" role="tabpanel">' +
      body +
      '</div>'
    );
  }

  function current() {
    var list = C.list || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === C.co) return list[i];
    return null;
  }

  function render() {
    var box = $('hqCompaniesBody');
    if (!box) return;
    var c = current();
    box.innerHTML = c ? detailHtml(c) : listHtml();
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

  async function get(path) {
    try {
      var res = await fetch(C.base + path, {
        headers: { Authorization: 'Bearer ' + (await token()) },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /** 고른 업체의 그 탭 — 처음 열 때만 읽는다 */
  async function fill(id, tab) {
    var d = C.detail[id] || (C.detail[id] = {});
    var key = tab === 'people' ? 'people' : tab === 'projects' ? 'projects' : '';
    if (!key || d[key]) return;
    var body = await get(
      '/hq/companies/' + encodeURIComponent(id) + (key === 'people' ? '/members' : '/projects')
    );
    var items = itemsOf(body, key === 'projects');
    if (C.co !== id) return; // 그사이 다른 업체로
    if (!items) C.err = TEXT.fail;
    else d[key] = items;
    render();
  }

  function open(id) {
    C.co = id;
    C.tab = 'projects';
    C.err = '';
    render();
    fill(id, 'projects');
  }

  function onClick(e) {
    var el =
      e.target && e.target.closest ? e.target.closest('[data-co],[data-tab],[data-act]') : null;
    if (!el) return;
    if (el.getAttribute('data-co')) return open(el.getAttribute('data-co'));
    if (el.getAttribute('data-act') === 'back') {
      C.co = '';
      C.err = '';
      render();
      return;
    }
    var tab = el.getAttribute('data-tab');
    if (tab && C.co) {
      C.tab = tab;
      C.err = '';
      render();
      fill(C.co, tab);
    }
  }

  /** 등록 업체 칸 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var section = $('hqCompanies');
    var box = $('hqCompaniesBody');
    if (!section || !box) return;
    section.hidden = true;
    var cfg = window.DADAM_CONFIG || {};
    C.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    C.sb = sb;
    C.session = session;
    C.list = null;
    C.co = '';
    C.detail = {};
    C.err = '';
    if (!C.base || !session || !canSee(me)) return;
    try {
      var items = itemsOf(await get('/hq/companies'), true);
      if (!items) return; // 403 not_platform · 404 · 오류 — 칸째 감춘다
      C.list = items;
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
      }
      render(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
      section.hidden = false;
    } catch {
      section.hidden = true;
      box.innerHTML = '';
    }
  }

  window.SeganHqCompanies = {
    TEXT: TEXT,
    state: C,
    canSee: canSee,
    itemsOf: itemsOf,
    stageCounts: stageCounts,
    load: load,
  };
})();
