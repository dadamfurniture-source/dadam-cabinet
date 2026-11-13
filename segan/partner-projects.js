/* ============================================================
   segan/partner-projects.js — 「내 정보 › 업체」 안의 프로젝트 (segan/me.html #partnerProjects)

   누가 보나  다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원 — account-api GET /partner/me 로 가린다.
             (프로젝트 저장은 Manager 이상 — 2026-11-08 DB 0047. company.plan 의 manager 는 등급, role 의 manager 는 실장)
             목록은 구성원 모두, 「새 고객 · 프로젝트」는 서버 응답의 can_manage(대표 · 실장)일 때만.
             서버가 403(다담 본사 · 멈춘 업체 · 구성원 아님)이면 칸째 감춘다.
             segan/me.js 가 업체 칸(segan/partner.js)을 읽은 뒤 SeganPartnerProjects.load(sb, session, partnerMe) 를
             부른다 (/partner/me 를 두 번 묻지 않는다). 다담 공장 구성원이면 이 칸을 그렸을 때 업체 칸(#partner)을 연다.
   서버      workflow-api (본인 토큰 · 응답은 { success, data } · 오류는 { success:false, message, code })
               GET  /company/projects   { company, can_manage, assignee_ready, members[{ user_id, name, role }],
                                          items[{ id, title, status, created_at, closed_at,
                                          customer { id, name, phone } | null, design_count, assignee | null,
                                          stage, order { id, order_no, status } | null }] }
               POST /company/projects   { title, customer: { name, phone } } | { title, customer_id }
                                        → 201 { project_id, customer_id }
               PUT  /company/projects/:id/assignee  { assignee_id | null } (대표 · 실장 — DB 0042)
   화면      마이페이지 메뉴가 고른 보기 (segan/me.js 가 setView 로 넘긴다):
               프로젝트 관리 › 상담 ~ 설치 = 그 단계 프로젝트만 (단계 = menuStage — segan/me.js 와 같다),
               인력 관리 › 작업 분배 = 진행 중 프로젝트 모두 (담당자 고르기), 옛 주소 #partner-projects = 모두.
               「새 고객 · 프로젝트」는 모두 · 상담 보기에서만. 견적 ~ 설치 보기는 상세가 PC 화면이라는 안내 한 줄.
             프로젝트 한 줄마다 이름 · 상태(진행 중은 적지 않는다) · (모두 보기면 단계) · 고객 이름 · 전화 · 만든 날 · 이어진 설계 수 · 담당자
             담당자 (2026-11-06 작업 분배 ① Expert · Agent 모두 ② 프로젝트에 한 명 ③ 대표 · 실장 · 직원):
               대표 · 실장은 줄의 「담당자」 → 지금 구성원 중 고르기 · 비우기 (Agent 의 비서 추천은 비서 대화의 승인 카드).
               서버가 담당자 칸을 아직 못 받으면(assignee_ready false — DB 0042 전) 담당자를 적지도 고르지도 않는다.
             새 고객 · 프로젝트 — 프로젝트 이름 + 「새 고객」(이름 · 전화) 또는 「있는 고객」(목록에 나온 고객 중 고르기)
             작업 배정 (2026-11-13 「작업자 한 길」 — 작업 종류 → 작업자 → 배정 → 승인(작업자 수락) → 연결):
               인사를 쓰는 팩토리(다담 공장 · Agent)의 진행 중 프로젝트 줄마다 「작업 배정」(직원은 「작업자 보기」) →
               그 줄 아래에 종류 줄(철거 · 재단 · 엣지 · 조립 · 설치 · A/S) 표. 그리기 · 서버는 segan/project-work.js.
   이름      상태 = segan/me.js PROJECT_STATUS 와 같다 (active 는 적지 않는다)
   못 읽으면  처음(403 · 404 · 오류 · 끊김 · 모양이 틀림) → 칸째 감춘다. 만들기를 못 하면 서버 글을 그 자리에.
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var MEMBER_ROLES = ['owner', 'manager', 'staff'];
  var PLANS = ['manager', 'expert', 'agent']; // 프로젝트를 가지는 협력업체 (Manager 이상) — 워커 company-projects.js PROJECT_PLANS
  var PROJECT_STATUS = { closed: '끝남', cancelled: '취소', handed_over: '넘김' }; // segan/me.js 와 같다
  var ROLE_NAME = { owner: '대표', manager: '실장', staff: '직원' }; // 업체 안 역할 — manager 는 화면 「실장」
  var TITLE_MAX = 100; // 워커 PROJECT_TITLE_MAX
  var NAME_MAX = 50; // 워커 CUSTOMER_NAME_MAX
  var PHONE_RE = /^[0-9][0-9-]{7,19}$/; // 워커 PHONE_RE (account-api partner.js 와 같은 꼴)
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // 프로젝트 관리 하위 메뉴 단계 이름 — segan/me.js MENU_STAGES 와 같다
  var STAGE_LABEL = {
    consult: '상담',
    design: '설계',
    quote: '견적',
    contract: '계약',
    make: '제작',
    install: '설치',
  };
  var PC_STAGES = ['quote', 'contract', 'make', 'install']; // 상세(견적서 · 수주 · 수금 · 완료 보고)가 PC 화면인 단계

  var TEXT = {
    lead: '상담에서 받은 고객과 전화 · 방문 고객의 프로젝트입니다. 설계는 프로젝트에 이어 저장합니다.',
    empty: '아직 프로젝트가 없습니다.',
    stageEmpty: '이 단계의 프로젝트가 없습니다.',
    assignEmpty: '진행 중인 프로젝트가 없습니다.',
    assignLead: '진행 중인 프로젝트마다 담당자를 정합니다.',
    pcNote: '견적서 · 원가 · 완료 보고의 상세는 PC 화면(상세설계 · 수주)에서 봅니다.',
    titleEmpty: '프로젝트 이름을 적어 주세요.',
    titleLong: '프로젝트 이름은 ' + TITLE_MAX + '자까지 적을 수 있습니다.',
    nameEmpty: '고객 이름을 적어 주세요.',
    nameLong: '고객 이름은 ' + NAME_MAX + '자까지 적을 수 있습니다.',
    phoneBad: '전화는 숫자와 - 로 8~20자로 적어 주세요.',
    pickCustomer: '고객을 골라 주세요.',
    created: '프로젝트를 만들었습니다.',
    assigned: '담당자를 정했습니다.',
    unassigned: '담당자를 비웠습니다.',
    noAssignee: '담당자 없음',
    generic: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var J = {
    sb: null,
    session: null,
    base: '', // workflow-api
    me: null,
    data: null, // { company, can_manage, items }
    open: false, // 새 고객 · 프로젝트 칸
    assignFor: '', // 담당자를 고르는 프로젝트 id
    workFor: '', // 작업 배정 칸을 펼친 프로젝트 id (segan/project-work.js)
    mode: 'new', // new | existing
    err: '',
    msg: '',
    busy: false,
    view: { stage: '', assign: false }, // 마이페이지 메뉴가 고른 보기 (setView)
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

  /** 한국 시간 날짜 (ISO UTC 로 온 시각) */
  function kstDay(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var k = new Date(t + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate());
  }

  function telHref(tel) {
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }

  // ── 판정 · 본문 (순수 함수 — 시험이 직접 부른다) ─────────
  /** 프로젝트 → 하위 메뉴 단계 (segan/me.js menuStage 와 같다): 연출컷 · 설계 = 설계, 수주는 상태로 계약 · 제작 · 설치 */
  function menuStage(stage, orderStatus) {
    if (stage === 'installed') return 'install';
    if (stage === 'order') {
      if (orderStatus === 'in_production') return 'make';
      if (orderStatus === 'delivered' || orderStatus === 'completed') return 'install';
      return 'contract';
    }
    if (stage === 'quote') return 'quote';
    if (stage === 'design' || stage === 'render') return 'design';
    return 'consult';
  }

  function stageOf(p) {
    return menuStage(
      p && p.stage,
      p && p.order && typeof p.order === 'object' ? p.order.status : ''
    );
  }

  /** 지금 보기에 들 프로젝트 — 단계 보기면 그 단계, 작업 분배면 진행 중(active), 아니면 모두 */
  function inView(p, view) {
    if (view && view.assign) return p.status === 'active';
    if (view && view.stage) return stageOf(p) === view.stage;
    return true;
  }
  /** 다담 공장 구성원 — /partner/me 가 company 없이 hq_member 로 준다 */
  function isHq(me) {
    return !!me && typeof me === 'object' && !Array.isArray(me) && me.hq_member === true;
  }

  /** 프로젝트 칸을 보이나 — 다담 공장 구성원 · Manager · Expert · Agent 협력업체 구성원 */
  function canSee(me) {
    if (isHq(me)) return true;
    if (!me || typeof me !== 'object' || Array.isArray(me)) return false;
    var c = me.company;
    return !!(
      c &&
      typeof c === 'object' &&
      PLANS.indexOf(c.plan) >= 0 &&
      MEMBER_ROLES.indexOf(c.role) >= 0
    );
  }

  /** GET /company/projects 본문 → { company, manage, items } | null (id 가 uuid 인 프로젝트만) */
  function listOf(body) {
    var d = body && body.success === true ? body.data : null;
    if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.items)) return null;
    return {
      company: d.company && typeof d.company === 'object' ? d.company : null,
      manage: d.can_manage === true,
      // 담당자 칸 — 서버가 assignee_ready true 로 답할 때만 (DB 0042 전 · 옛 서버면 없음)
      assignee: d.assignee_ready === true,
      members: (Array.isArray(d.members) ? d.members : []).filter(function (m) {
        return m && typeof m === 'object' && UUID_RE.test(String(m.user_id || ''));
      }),
      items: d.items.filter(function (p) {
        return p && typeof p === 'object' && UUID_RE.test(String(p.id || ''));
      }),
    };
  }

  /** 사람 이름표 — 이름(없으면 역할) · 역할 */
  function personLabel(m) {
    if (!m || typeof m !== 'object') return '';
    var role = ROLE_NAME[m.role] || '';
    if (m.name) return role ? m.name + ' (' + role + ')' : String(m.name);
    return role || '나간 구성원';
  }

  /** 담당자 고르기 칸 값 → 보낼 본문 (빈 값 = 비우기) | { error } */
  function assignBodyOf(value, members) {
    var v = String(value || '');
    if (!v) return { body: { assignee_id: null } };
    var ok = (members || []).some(function (m) {
      return m && m.user_id === v;
    });
    return ok ? { body: { assignee_id: v } } : { error: TEXT.generic };
  }

  /** 목록에 나온 고객 (id 차례 그대로, 한 번씩) — 「있는 고객」 고르기 */
  function customersOf(items) {
    var seen = {};
    var out = [];
    (items || []).forEach(function (p) {
      var c = p && p.customer;
      if (!c || typeof c !== 'object' || !UUID_RE.test(String(c.id || '')) || seen[c.id]) return;
      seen[c.id] = true;
      out.push(c);
    });
    return out;
  }

  /**
   * 새 고객 · 프로젝트 칸 값 → 보낼 본문 | { error } (서버와 같은 검사)
   * v = { title, mode: 'new' | 'existing', name, phone, customer_id }
   */
  function bodyOf(v) {
    var title = String(v.title || '').trim();
    if (!title) return { error: TEXT.titleEmpty, field: 'title' };
    if (title.length > TITLE_MAX) return { error: TEXT.titleLong, field: 'title' };
    if (v.mode === 'existing') {
      if (!UUID_RE.test(String(v.customer_id || '')))
        return { error: TEXT.pickCustomer, field: 'customer_id' };
      return { body: { title: title, customer_id: v.customer_id } };
    }
    var name = String(v.name || '').trim();
    if (!name) return { error: TEXT.nameEmpty, field: 'name' };
    if (name.length > NAME_MAX) return { error: TEXT.nameLong, field: 'name' };
    var phone = String(v.phone || '').trim();
    if (phone && !PHONE_RE.test(phone)) return { error: TEXT.phoneBad, field: 'phone' };
    return { body: { title: title, customer: { name: name, phone: phone || null } } };
  }

  // ── 그리기 ─────────────────────────────────────────────
  function rowHtml(p) {
    var d = J.data || {};
    var c = p.customer && typeof p.customer === 'object' ? p.customer : null;
    var who = c && c.name ? String(c.name) : '';
    var sub = [
      J.view.stage ? '' : STAGE_LABEL[stageOf(p)] || '',
      who,
      kstDay(p.created_at),
      '설계 ' + (Number(p.design_count) || 0) + '개',
    ]
      .filter(Boolean)
      .join(' · ');
    var status = PROJECT_STATUS[p.status] || '';
    var owner = d.assignee
      ? '<small class="me-pt-owner" data-assignee>' +
        esc(p.assignee ? '담당 ' + personLabel(p.assignee) : TEXT.noAssignee) +
        '</small>'
      : '';
    var canAssign = d.assignee && d.manage;
    // 작업 배정 — 인사를 쓰는 팩토리의 진행 중 프로젝트 (담당자 고르는 보기에서는 뺀다)
    var canWork = canWorkOn(p);
    var working = canWork && J.workFor === p.id;
    var acts =
      (canAssign && J.assignFor !== p.id
        ? '<button type="button" class="mk-btn" data-act="assign" data-for="' + esc(p.id) + '">담당자</button>'
        : '') +
      (canWork
        ? '<button type="button" class="mk-btn' +
          (working ? ' mk-btn--solid' : '') +
          '" data-act="' +
          (working ? 'work-close' : 'work') +
          '" data-for="' +
          esc(p.id) +
          '" aria-expanded="' +
          working +
          '">' +
          esc(working ? '작업 배정 닫기' : d.manage ? '작업 배정' : '작업자 보기') +
          '</button>'
        : '');
    return (
      '<li class="me-pt-row" data-project="' +
      esc(p.id) +
      '"><span class="me-pt-line"><span class="me-c-main"><b>' +
      esc(p.title || '프로젝트') +
      '</b><small>' +
      esc(sub) +
      '</small>' +
      (c && c.phone
        ? '<small><a href="' + esc(telHref(c.phone)) + '">' + esc(c.phone) + '</a></small>'
        : '') +
      owner +
      '</span>' +
      (status ? '<span class="me-pr-status">' + esc(status) + '</span>' : '') +
      '</span>' +
      (acts ? '<div class="rd-acts">' + acts + '</div>' : '') +
      (canAssign && J.assignFor === p.id ? assignHtml(p) : '') +
      (working ? '<div class="pjw" data-pj-work="' + esc(p.id) + '"></div>' : '') +
      '</li>'
    );
  }

  /** 담당자 고르기 — 지금 구성원(역할 차례) · 비우기 */
  function assignHtml(p) {
    var cur = p.assignee && p.assignee.user_id ? p.assignee.user_id : '';
    var members = (J.data && J.data.members) || [];
    return (
      '<form class="me-pt-form me-pr-form" data-form="assign" data-for="' +
      esc(p.id) +
      '" novalidate>' +
      '<label class="mk-input"><span>담당자</span><select name="assignee_id"><option value="">' +
      esc(TEXT.noAssignee) +
      '</option>' +
      members
        .map(function (m) {
          return (
            '<option value="' +
            esc(m.user_id) +
            '"' +
            (m.user_id === cur ? ' selected' : '') +
            '>' +
            esc(personLabel(m)) +
            '</option>'
          );
        })
        .join('') +
      '</select></label>' +
      '<p class="mk-error" data-err role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p>' +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid"' +
      (J.busy ? ' disabled' : '') +
      '>저장</button><button type="button" class="mk-btn" data-act="assign-close"' +
      (J.busy ? ' disabled' : '') +
      '>닫기</button></div>' +
      '</form>'
    );
  }

  function choiceHtml(value, label) {
    return (
      '<label class="cs-choice"><input type="radio" name="mode" value="' +
      value +
      '"' +
      (J.mode === value ? ' checked' : '') +
      ' /><span>' +
      esc(label) +
      '</span></label>'
    );
  }

  function formHtml(customers) {
    var existing = J.mode === 'existing';
    return (
      '<form class="me-pt-form me-pr-form" data-form="project" novalidate>' +
      '<label class="mk-input"><span>프로젝트 이름</span><input name="title" type="text" maxlength="' +
      TITLE_MAX +
      '" autocomplete="off" /></label>' +
      '<div class="cs-choices" role="radiogroup" aria-label="고객">' +
      choiceHtml('new', '새 고객') +
      (customers.length ? choiceHtml('existing', '있는 고객') : '') +
      '</div>' +
      (existing
        ? '<label class="mk-input"><span>고객</span><select name="customer_id"><option value="">고객 고르기</option>' +
          customers
            .map(function (c) {
              return (
                '<option value="' +
                esc(c.id) +
                '">' +
                esc([c.name || '이름 없음', c.phone || ''].filter(Boolean).join(' · ')) +
                '</option>'
              );
            })
            .join('') +
          '</select></label>'
        : '<label class="mk-input"><span>고객 이름</span><input name="name" type="text" maxlength="' +
          NAME_MAX +
          '" autocomplete="off" /></label>' +
          '<label class="mk-input"><span>전화 (없으면 비워 두세요)</span><input name="phone" type="tel" inputmode="tel" maxlength="20" autocomplete="off" /></label>') +
      '<p class="mk-error" data-err role="alert"' +
      (J.err ? '' : ' hidden') +
      '>' +
      esc(J.err) +
      '</p>' +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid"' +
      (J.busy ? ' disabled' : '') +
      '>만들기</button><button type="button" class="mk-btn" data-act="close"' +
      (J.busy ? ' disabled' : '') +
      '>닫기</button></div>' +
      '</form>'
    );
  }

  function render() {
    var box = $('partnerProjects');
    if (!box) return;
    var d = J.data;
    var v = J.view;
    var items = d.items.filter(function (p) {
      return inView(p, v);
    });
    var title = v.assign
      ? '작업 분배'
      : v.stage
        ? STAGE_LABEL[v.stage] + ' 단계 프로젝트'
        : '프로젝트';
    var lead = v.assign ? TEXT.assignLead : v.stage ? '' : TEXT.lead;
    var empty = v.assign ? TEXT.assignEmpty : v.stage ? TEXT.stageEmpty : TEXT.empty;
    // 새 고객 · 프로젝트 — 모두 · 상담 보기에서만 (새 프로젝트는 상담 단계로 들어온다)
    var canCreate = d.manage && !v.assign && (!v.stage || v.stage === 'consult');
    box.innerHTML =
      '<h3 class="me-pt-sub" id="partnerProjectsTitle">' +
      esc(title) +
      '</h3>' +
      (lead ? '<p class="mk-note">' + esc(lead) + '</p>' : '') +
      (J.msg ? '<p class="me-pt-msg" role="status">' + esc(J.msg) + '</p>' : '') +
      (items.length
        ? '<ul class="me-pt-list me-pr-list">' + items.map(rowHtml).join('') + '</ul>'
        : '<p class="me-empty">' + esc(empty) + '</p>') +
      (PC_STAGES.indexOf(v.stage) >= 0 ? '<p class="mk-note">' + esc(TEXT.pcNote) + '</p>' : '') +
      (canCreate
        ? J.open
          ? formHtml(customersOf(items))
          : '<div class="rd-acts"><button type="button" class="mk-btn" data-act="open">새 고객 · 프로젝트</button></div>'
        : '');
    box.hidden = false;
    mountWork(box);
  }

  /** 그 프로젝트에 「작업 배정」 단추가 있나 — 인사를 쓰는 팩토리의 진행 중 프로젝트 (담당자 고르는 보기에서는 뺀다) */
  function canWorkOn(p) {
    var PW = window.SeganProjectWork;
    return !!PW && PW.canSee(J.me) && !J.view.assign && (p.status === 'active' || !p.status);
  }

  /**
   * 그 프로젝트의 「작업 배정」 칸을 연다 — 업무 달력의 작업 줄에서 부른다 (segan/calendar.js).
   * 지금 보기에 그 프로젝트 줄이 있고 단추가 있을 때만 — 열었으면(이미 열려 있어도) true, 아니면 false.
   * 그 줄로 옮기고(움직임 없이) 닫기 단추에 초점을 둔다.
   */
  function openWork(id) {
    var box = $('partnerProjects');
    if (!box || box.hidden || !J.data || !id) return false;
    var p = J.data.items.filter(function (x) {
      return x.id === id && inView(x, J.view);
    })[0];
    if (!p || !canWorkOn(p)) return false;
    if (J.workFor !== id) {
      window.SeganProjectWork.unmount();
      J.workFor = id;
      J.open = false;
      J.assignFor = '';
      J.err = '';
      J.msg = '';
      render();
    }
    var row = Array.prototype.filter.call(box.querySelectorAll('[data-project]'), function (el) {
      return el.getAttribute('data-project') === id;
    })[0];
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'start' });
    var btn = row && row.querySelector('[data-act="work-close"]');
    if (btn && typeof btn.focus === 'function') btn.focus({ preventScroll: true });
    return true;
  }

  /** 펼쳐 둔 「작업 배정」 자리에 칸을 올린다 — 목록을 다시 그릴 때마다 (읽어 둔 것은 그 모듈이 기억한다) */
  function mountWork(box) {
    var PW = window.SeganProjectWork;
    if (!PW) return;
    var host = J.workFor ? box.querySelector('[data-pj-work]') : null;
    if (!host) {
      // 그 프로젝트가 이 보기에 없다(다른 단계로 갔다) — 닫는다
      if (J.workFor) PW.unmount();
      J.workFor = '';
      return;
    }
    PW.mount(host, { id: J.workFor, sb: J.sb, session: J.session });
  }

  /** 다담 공장 구성원은 업체 칸에 협력업체 내용이 없다 — 이 칸을 그렸으면 업체 칸을 연다 */
  function showSection() {
    if (!isHq(J.me)) return;
    var section = $('partner');
    var box = $('partnerProjects');
    if (section && box && !box.hidden) section.hidden = false;
  }

  // ── 서버 ───────────────────────────────────────────────
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

  /** GET /company/projects → { company, manage, items } | null */
  async function fetchList() {
    var r = await call('GET', '/company/projects');
    return r.ok ? listOf(r.body) : null;
  }

  // ── 고치기 ─────────────────────────────────────────────
  function formOf() {
    var box = $('partnerProjects');
    return box && box.querySelector('form[data-form="project"]');
  }

  /** 다시 그려도 적던 값이 남게 */
  function valuesOf(form) {
    var get = function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? el.value : '';
    };
    return {
      title: get('title'),
      mode: J.mode,
      name: get('name'),
      phone: get('phone'),
      customer_id: get('customer_id'),
    };
  }

  function restore(v) {
    var form = formOf();
    if (!form || !v) return;
    ['title', 'name', 'phone', 'customer_id'].forEach(function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      if (el && v[name] != null) el.value = v[name];
    });
  }

  function focusField(field) {
    var form = formOf();
    var el = form && form.querySelector('[name="' + field + '"]');
    if (!el) return;
    el.setAttribute('aria-invalid', 'true');
    if (el.focus) el.focus();
  }

  /** 담당자 저장 — PUT /company/projects/:id/assignee → 목록 다시 읽기 */
  async function submitAssign(form) {
    if (J.busy) return;
    var id = form.getAttribute('data-for') || '';
    var sel = form.querySelector('[name="assignee_id"]');
    var got = assignBodyOf(sel ? sel.value : '', (J.data && J.data.members) || []);
    if (!UUID_RE.test(id) || got.error) {
      J.err = got.error || TEXT.generic;
      render();
      return;
    }
    J.busy = true;
    J.err = '';
    render();
    var r = await call('PUT', '/company/projects/' + id + '/assignee', got.body);
    if (!r.ok) {
      J.busy = false;
      J.err = errText(r);
      render();
      return;
    }
    var list = await fetchList();
    J.busy = false;
    J.assignFor = '';
    J.msg = got.body.assignee_id ? TEXT.assigned : TEXT.unassigned;
    if (list) J.data = list;
    render();
  }

  async function submit(form) {
    if (J.busy) return;
    var v = valuesOf(form);
    var got = bodyOf(v);
    if (got.error) {
      J.err = got.error;
      render();
      restore(v);
      focusField(got.field);
      return;
    }
    J.busy = true;
    J.err = '';
    render();
    restore(v);
    var r = await call('POST', '/company/projects', got.body);
    if (!r.ok) {
      J.busy = false;
      J.err = errText(r);
      render();
      restore(v);
      return;
    }
    var list = await fetchList();
    J.busy = false;
    J.open = false;
    J.mode = 'new';
    J.msg = TEXT.created;
    if (list) J.data = list;
    render();
  }

  function onClick(e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || J.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'open') {
      J.open = true;
      J.mode = 'new';
      J.err = '';
      J.msg = '';
      render();
      var form = formOf();
      var title = form && form.querySelector('[name="title"]');
      if (title && title.focus) title.focus();
    } else if (act === 'close') {
      J.open = false;
      J.err = '';
      render();
    } else if (act === 'assign') {
      J.assignFor = el.getAttribute('data-for') || '';
      J.open = false;
      J.err = '';
      J.msg = '';
      render();
    } else if (act === 'assign-close') {
      J.assignFor = '';
      J.err = '';
      render();
    } else if (act === 'work' || act === 'work-close') {
      var PW = window.SeganProjectWork;
      if (PW) PW.unmount();
      J.workFor = act === 'work' ? el.getAttribute('data-for') || '' : '';
      J.open = false;
      J.assignFor = '';
      J.err = '';
      J.msg = '';
      render();
    }
  }

  function onChange(e) {
    var el = e.target;
    if (!el || el.name !== 'mode' || J.busy) return;
    var form = formOf();
    var v = form ? valuesOf(form) : null;
    J.mode = el.value === 'existing' ? 'existing' : 'new';
    J.err = '';
    render();
    restore(v);
  }

  function onSubmit(e) {
    var form = e.target;
    var kind = form && form.getAttribute('data-form');
    if (kind === 'assign') {
      e.preventDefault();
      submitAssign(form);
      return;
    }
    if (kind !== 'project') return;
    e.preventDefault();
    submit(form);
  }

  /** 프로젝트 칸 채우기 — me.js 가 업체 칸을 읽은 뒤 부른다. me = GET /partner/me data */
  async function load(sb, session, me) {
    var box = $('partnerProjects');
    if (!box) return;
    box.hidden = true;
    box.innerHTML = '';
    var cfg = window.DADAM_CONFIG || {};
    J.base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    J.sb = sb;
    J.session = session;
    J.me = me;
    J.data = null;
    J.open = false;
    J.assignFor = '';
    J.workFor = '';
    if (window.SeganProjectWork) window.SeganProjectWork.unmount();
    J.mode = 'new';
    J.err = '';
    J.msg = '';
    J.busy = false;
    if (!J.base || !session || !canSee(me)) return;
    try {
      var list = await fetchList();
      if (!list) return; // 403 · 404 · 오류 — 칸째 감춘다
      J.data = list;
      if (!box.getAttribute('data-bound')) {
        box.setAttribute('data-bound', '1');
        box.addEventListener('click', onClick);
        box.addEventListener('change', onChange);
        box.addEventListener('submit', onSubmit);
      }
      render(); // 모양이 틀린 응답은 여기서 던진다 → 칸째 감춘다
      showSection();
    } catch {
      box.hidden = true;
      box.innerHTML = '';
    }
  }

  /**
   * 마이페이지 메뉴가 고른 보기 — { stage: '' | 'consult' … 'install', assign: 작업 분배 }.
   * 같은 보기면 그대로 (칸을 다시 그리면 메뉴가 다시 맞추므로 되풀이하지 않게)
   */
  function setView(v) {
    var next = { stage: (v && v.stage) || '', assign: !!(v && v.assign) };
    if (next.stage === J.view.stage && next.assign === J.view.assign) return;
    J.view = next;
    J.open = false;
    J.assignFor = '';
    J.err = '';
    J.msg = '';
    if (J.data) render();
  }

  /** 담당자를 고를 수 있나 — 대표 · 실장이고 서버가 담당자 칸을 받을 때 (인력 관리 › 작업 분배) */
  function canAssign() {
    return !!(J.data && J.data.manage && J.data.assignee);
  }

  window.SeganPartnerProjects = {
    PROJECT_STATUS: PROJECT_STATUS,
    TITLE_MAX: TITLE_MAX,
    NAME_MAX: NAME_MAX,
    PHONE_RE: PHONE_RE,
    state: J,
    canSee: canSee,
    listOf: listOf,
    customersOf: customersOf,
    bodyOf: bodyOf,
    personLabel: personLabel,
    assignBodyOf: assignBodyOf,
    menuStage: menuStage,
    STAGE_LABEL: STAGE_LABEL,
    setView: setView,
    canAssign: canAssign,
    openWork: openWork,
    load: load,
  };
})();
