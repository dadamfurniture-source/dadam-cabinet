/* ============================================================
   segan/me.js — 「마이」 탭 마이페이지 (segan/me.html) — 메뉴(첫 화면) + 하위 화면

   메뉴 (주소에 # 없음 · PC 1100px~ 에서는 왼쪽에 늘 보인다) — 쓸 수 있는 줄만 연다
     내 정보    이름(profiles.name) · 이메일 · 등급(profiles.tier — segan/billing.js PLAN_KO 와 같은 이름,
                업체 직책 「실장」과 다르다) · 남은 크레딧 · 업체 구성원이면 업체 이름 · 내 역할
     오늘 작업  작업자만 — 셸 판정 roles.workMe(GET /work/me) 의 건수 · 다음 작업을 js/mypage-work.js
                (summaryCounts · nextJobText · SUSPENDED_NOTE) 로 적는다, 누르면 작업 화면(work.html)
     메뉴 나무 — B안 (2026-11-10 대표님 승인, 캔버스 「SEGAN 관리 메뉴 — 안 B」). 다담 공장은 Agent 업체처럼, 다담 본사는 따로.
       큰 메뉴 이름을 누르면 그 대시보드(#dash-이름), 옆 ▾ 는 하위 줄만 접고 편다 — 폰 · PC 모두 한 번에 하나
       (처음엔 지금 화면이 든 큰 메뉴, 없으면 처음 보이는 큰 메뉴, 고른 것은 이 탭 동안 sessionStorage).
       보이는 하위 줄이 없으면 큰 메뉴 · 묶음째 감춘다.
       업무 (머리글은 업체 구성원 · 본사 구성원만)
         홈            관리자 — 오늘 현황 · 경영 대시보드 조각(이익 · 목표 · 손익 분석 · 현금 · 미수 · 매출 예측은 앱 화면
                        segan/hq-board.html#조각, 고객 흐름 · 공정 · 품질은 PC 화면 admin/management.html?part=)
         프로젝트 관리  영업 · 설계 · 생산 · 설치 · A/S — 줄 하나가 화면 여럿을 묶는다 (SUBS, 화면 위 구역 단추 #meParts):
                        영업 = 상담 #p-consult · 견적 · 계약 · 수금 · 고객(수금 · 고객은 업체만, 준비 중), 설계 = #p-design (+ 플래너 단추),
                        생산 = #p-make · 생산 계획 #p-plan (다담 공장), 설치 = #p-install, A/S = #p-as. 고객은 「상담 · 계약」 · 「제작」 이라 적는다 (data-customer).
                        고객: 상담 = 내 상담 내역, 견적 ~ 설치 = 내 프로젝트를 그 단계로 거름, A/S = 내 A/S 접수
                        업체: 상담 = 배정 상담 · 상담 단계 프로젝트 · 상담 설정 (팩토리 = 다담 공장 · Expert · Agent,
                        Manager 는 상담 단계 프로젝트만), 견적 ~ 설치 = 업체 프로젝트를 그 단계로 거름,
                        제작 = 팩토리는 받은 제작 의뢰도 · Manager 는 제작 의뢰도, A/S = 팩토리 A/S함 · Manager 는 준비 중
                        설치 = 설치 현장 지도 + 표(#siteInstall) 가 프로젝트 위에, A/S = A/S 현장 지도 + 표(#siteAs) 가 A/S함 위에
                        (segan/site-map.js — 카카오맵)
                        생산 계획 = 추천 · 주문별 일정 · 날짜별 부하 · 지시 내역 · 월 손익 (#productionPlan —
                        segan/production-plan.js, 다담 공장 구성원만)
                        단계 = 프로젝트 단계 + 최신 수주 상태 (menuStage — segan/partner-projects.js 와 같다).
                        대시보드(#dash-project) = 단계별 수 + 업무 달력(#meCalendar — 업체 구성원만, segan/calendar.js) + 프로젝트 목록.
                        다담 본사 구성원은 업체 프로젝트가 없다 — 플래너(셸 판정 roles.planner)를 쓰면 설계 = 플래너 페이지
       관리
         구매 · 재고   팩토리 — 기본 자재 · 자투리 자재 · 철물 (준비 중 — 안내 한 줄), 관리자 — 거래처 · 공급처
         회계          segan/books.js ledgerKind — 장부(full · read)면 한눈에 · 매출 · 매입 · 사진 · 보고서 (+ 업체는 설정),
                        사진만 올리면 영수증 올리기 (업체만). 본사 대표 · 실장은 본사 장부 — 공장 장부는 플랫폼 › 등록 업체 › 다담 공장 › 회계
         인사          Agent 대표 · 실장 · 다담 공장 — 직원(#staff — 업체 칸 안 직원 · 초대, Agent 대표) ·
                        작업 분배(#assign — 진행 중 프로젝트 담당자, 대표 · 실장) · 근무 일정(준비 중) · 작업자(공장은 PC 생산 계획),
                        관리자 — 작업자 · 작업 배정 · 작업 지시 보고
         기준정보      관리자 — 시공사례 · 참고 이미지 · 학습 데이터셋 · 가전 모델 (PC 관리자 화면)
         플랫폼        등록 업체(#companies — 본사 대표 · 실장, segan/hq-companies.js — 업체마다 프로젝트 · 회계 · 인력),
                        관리자 — 팩토리 신청 · 평가 · 상담 배정 · 제작 의뢰 추천 · 완료 보고 · A/S 현황 · 거래처 · 공급처 성적 ·
                        회원 · 관리자 계정 · 활동 로그 (앱 관리 admin.html#… 또는 PC 관리자 화면)
       내 계정 (누구나) — 내 연출컷 · 좋아요 #likes · 크레딧 · 구독(billing.html) · 내 팩토리 #partner(업체가 없으면
         「팩토리로 시작하기」, 신청 중이면 「팩토리 신청」, 다담 공장 · 본사 구성원은 없다) · 내 활동 · 알림 #notify · 설정
       맨 아래 로그아웃
   대시보드 (#dash-이름 — 칸 #meDash) — 그 큰 메뉴의 보이는 하위 줄마다 칸 하나 (누르면 그 줄과 같다).
     프로젝트 관리는 칸마다 그 단계 프로젝트 수 · A/S 는 처리 중(접수 · 받음) 수 — 이미 읽은 목록으로 센다 (새로 묻지 않는다).
     아래에 그 메뉴의 칸을 더 붙인다: 프로젝트 관리 = 프로젝트 목록(모든 단계), 회계 = 회계 요약(segan/books.js, 대표 · 실장)
   하위 화면 (SCREENS — 주소 #이름)
     폰 · 태블릿은 하나만 (메뉴를 감추고 위에 「‹ 마이페이지」 · 그 화면 이름), PC 는 오른쪽 칸 —
     # 가 없으면 처음 보이는 큰 메뉴의 대시보드. 다른 페이지(연출컷 · 구독 · 설정 · 활동 · 회계 · 작업 · 관리 · 플래너)는
     그대로 페이지 이동 (플래너 · PC 관리자 화면은 PC 브라우저에서만 새 탭 — SeganShell.desktopTab).
     알림 · 결제가 여는 옛 주소(me.html#partner · #partner-consults · #as · #production-requests · #factory-requests ·
     #partner-projects · #consults · #projects-mine · #as-mine · ?failed=1)는 그대로 그 화면이다 (메뉴 · 구역은 ALIAS 의 화면을 밝힌다).
     폰 · 태블릿은 화면이 바뀔 때 들어온 쪽으로 — 하위 화면은 오른쪽에서, 메뉴는 왼쪽에서 들어온다
     (segan/motion.js 를 실었을 때만 · 동작 줄이기면 흐려지기만, CLAUDE.md 「SEGAN 모션 규칙」).
     메뉴에서 누르면 기록을 하나 넣는다(pushState — 뒤로 가기가 메뉴로 돌아온다). 「‹ 마이페이지」 는 메뉴에서 왔으면
     뒤로, 알림 · 새로 고침으로 바로 왔으면 그 기록을 메뉴로 바꾼다(replaceState). 칸마다 「읽은 뒤에만 보인다」(hidden)는
     각 모듈이 정한다 — 메뉴 줄은 그 칸이 보일 때만 열고, 못 여는 화면으로 오면 「볼 수 있는 내용이 없습니다」.

   업체 칸은 segan/partner.js 가 그린다 (여기서 로그인 뒤 SeganPartner.load 를 부른다). 업체 › 상담 · 상담 설정은
   segan/partner-consults.js, 업체 › 회계는 segan/books.js, 업체 › 제작 의뢰 · 제작 의뢰함은
   segan/production-requests.js · factory-requests.js, 알림 칸은 segan/push.js 가 그린다 (업체 칸을 읽은 뒤
   SeganPartnerConsults.load · SeganBooks.load · SeganProduction.load · SeganFactoryRequests.load · SeganPush.load 에
   그 /partner/me 를 넘긴다). 로그아웃 · 사업자 정보는
   segan/shell.js. 여기서는 다섯을 채운다:
     내 프로젝트 workflow-api GET /me/projects (본인 토큰). 단계 6칸 · 끝난 상태 · 계약 금액 ·
                다음 결제(안 낸 것 중 낼 날이 가장 이른 것 — 워커 payments.js 와 같은 due_on 오름차순 ·
                빈 날 뒤) · 설치일. 수금 단계 이름은 erp.html PAY_STAGE_LABELS · 워커 payments.js 와 같다.
                다음 결제 줄 아래 결제 칸 — 결제 버튼 · 가상계좌 입금 안내 · 확인 중 (segan/pay.js, 다담 공장 수주만)
                못 읽으면(오류 · 404 · 주소 없음) 칸째 감춘다 — 가짜 값을 그리지 않는다
                시공 완료 줄 아래 「A/S 신청」 · 「A/S 접수」 칸 · 팩토리 A/S함은 segan/as-requests.js
     좋아요    시공사례에서 ♡ 한 사진 — RPC collection_my_likes (DB 0049 — 본인 것만, 좋아한 때 liked_at 최신순).
                30장씩, 다음 쪽은 마지막 liked_at 을 p_before 로. 화면(#likes)을 처음 열 때 읽는다.
                타일 · 사진 보기 · ♡ 는 시공사례와 같다 (segan/collection-view.js SeganPostView) — ♡ 를 풀고 닫으면 뺀다
     상담 내역  consultations (본인 — RLS 「Users can view own consultations」), 최신순.
                상태 이름은 admin/consultations.html STATUS_LABELS 와 같다
     크레딧    RPC my_credit_wallet (업체 구성원이면 업체 통장, 아니면 내 통장) + credit_costs 로 「생성 N회」
                — segan/make.js 의 loadWallet 을 한 번 불러 업체 칸과 함께 쓴다
     구독      billing.html 과 같은 payments-api GET /subscription, 등급 · 이름은 profiles.
                상태 이름은 billing.html STATUS_KO 와 같다. 바꾸기는 앱 안 구독 관리(segan/billing.html)에서.
                업체 실장 · 직원은 구독 칸 없이 company 만 온다 — 「팩토리 구독은 대표가 관리합니다」
   ============================================================ */
/* global window, document, fetch, location, history, MutationObserver, sessionStorage */
(function () {
  'use strict';

  var CONSULT_STATUS = { pending: '대기', confirmed: '확정', completed: '완료', cancelled: '취소' }; // admin/consultations.html
  var SUB_STATUS = {
    active: '이용 중',
    cancelled: '해지 예약됨',
    past_due: '결제 실패 · 재시도 중',
    expired: '종료됨',
  }; // billing.html
  // 등급 이름 — segan/billing.js PLAN_KO · segan/plans.html 과 같다 (profiles.tier, DB 0047)
  var TIER_NAME = { standard: 'Standard', manager: 'Manager', expert: 'Expert', agent: 'Agent' };
  var LIMIT = 20;
  var LIKE_PAGE = 30; // 좋아요 한 쪽 (collection_my_likes p_limit)
  var LIKE_RETURN = 'segan/me.html#likes'; // 좋아요 화면 로그인 뒤 돌아올 곳

  // 내 프로젝트 — GET /me/projects 의 stage 순서 그대로 (상담 → 시공 완료)
  var PROJECT_STAGES = [
    ['consult', '상담'],
    ['render', '연출컷'],
    ['design', '설계'],
    ['quote', '견적'],
    ['order', '수주'],
    ['installed', '시공 완료'],
  ];
  var PROJECT_STATUS = { closed: '끝남', cancelled: '취소', handed_over: '넘김' }; // active 는 적지 않는다
  var PAY_STAGE = { deposit: '계약금', interim: '중도금', balance: '잔금', other: '기타' }; // erp.html · 워커 payments.js

  // 프로젝트 관리 하위 메뉴 단계 (고객 · 업체 같은 이름) — 프로젝트 단계(워커 projects.js PROJECT_STAGES)와 최신 수주 상태로 나눈다.
  // segan/partner-projects.js menuStage 와 같다
  var MENU_STAGES = [
    ['consult', '상담'],
    ['design', '설계'],
    ['quote', '견적'],
    ['contract', '계약'],
    ['make', '제작'],
    ['install', '설치'],
    ['as', 'A/S'],
  ];

  /** 프로젝트 → 하위 메뉴 단계: 연출컷 · 설계 = 설계, 수주는 상태로 계약(접수) · 제작(생산 중) · 설치(배송 · 완료) */
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

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function day(iso) {
    // 날짜만 온 값(due_on 'YYYY-MM-DD')은 그대로 읽는다 — Date 로 바꾸면 시간대에 따라 하루 밀린다
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso));
    if (m) return m[1] + '.' + m[2] + '.' + m[3];
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return (
      d.getFullYear() +
      '.' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '.' +
      String(d.getDate()).padStart(2, '0')
    );
  }

  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }

  /** billing.html statusLabel 과 같다 — 해지 후 ended_at 이 찍혔으면 「종료됨」 */
  function subLabel(sub) {
    if (sub.status === 'cancelled' && sub.ended_at) return '종료됨';
    return SUB_STATUS[sub.status] || sub.status || '';
  }

  // ── 내 프로젝트 ────────────────────────────────────────
  /** 다음 결제 — 안 낸 것(paid_on 없음) 중 낼 날이 가장 이른 것. 날이 없는 것은 뒤, 같으면 받은 순서 */
  function nextPayment(payments) {
    var best = null;
    (Array.isArray(payments) ? payments : []).forEach(function (x) {
      if (!x || x.paid_on) return;
      if (!best) best = x;
      else if (x.due_on && (!best.due_on || String(x.due_on) < String(best.due_on))) best = x;
    });
    return best;
  }

  /** 단계 6칸 — 지금 단계까지 막대를 채운다 (만들기 탭 단계 막대와 같은 모양) */
  function stepsHtml(stage) {
    var at = -1;
    PROJECT_STAGES.forEach(function (s, i) {
      if (s[0] === stage) at = i;
    });
    return (
      '<ol class="me-steps" aria-label="진행 단계">' +
      PROJECT_STAGES.map(function (s, i) {
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

  function factHtml(label, value) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>';
  }

  /** 프로젝트 한 줄 — 제목 · 회사 · 상태(active 아니면) · 단계 · 계약 금액 · 다음 결제 · 설치일 */
  function projectHtml(p) {
    var facts = [];
    var order = p.order || null;
    if (order && order.contract_amount != null) {
      facts.push(factHtml('계약 금액', won(order.contract_amount)));
    }
    var pay = nextPayment(p.payments);
    if (pay) {
      var t = PAY_STAGE[pay.stage] || pay.stage || '';
      if (pay.amount != null) t += (t ? ' ' : '') + won(pay.amount);
      if (pay.due_on) t += (t ? ' · ' : '') + day(pay.due_on);
      facts.push(factHtml('다음 결제', t));
    }
    if (p.install_at) facts.push(factHtml('설치일', day(p.install_at)));
    var payBox = pay && window.SeganPay ? window.SeganPay.boxHtml(pay) : '';
    var status = p.status && p.status !== 'active' ? PROJECT_STATUS[p.status] || p.status : '';
    return (
      '<li class="me-project"><span class="me-p-head"><span class="me-c-main"><b>' +
      esc(p.title || '프로젝트') +
      '</b>' +
      (p.company_name ? '<small>' + esc(p.company_name) + '</small>' : '') +
      '</span>' +
      (status ? '<span class="me-badge">' + esc(status) + '</span>' : '') +
      '</span>' +
      stepsHtml(p.stage) +
      (facts.length ? '<dl class="me-facts">' + facts.join('') + '</dl>' : '') +
      payBox +
      (window.SeganAs ? window.SeganAs.slotHtml(p) : '') +
      '</li>'
    );
  }

  var payBound = false;
  /** 다음 결제 줄의 결제 버튼 (segan/pay.js) — 막히면 칸 아래 글로. 입금 기다림 · 이미 받음(409)이면 칸을 다시 받는다 */
  function bindPay(session) {
    var list = $('meProjects');
    if (!list || payBound || !window.SeganPay) return;
    payBound = true;
    list.addEventListener('click', async function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-pay-id]') : null;
      if (!b) return;
      var err = $('mePayError');
      if (err) err.hidden = true;
      b.disabled = true;
      var r = await window.SeganPay.start(
        session,
        b.getAttribute('data-pay-id'),
        b.getAttribute('data-pay-method')
      );
      b.disabled = false;
      if (r.ok) return;
      if (err) {
        err.textContent = r.message;
        err.hidden = false;
      }
      if (r.reload) loadProjects(session);
    });
  }

  async function loadProjects(session) {
    var section = $('meProjectSection');
    if (!section) return;
    section.hidden = true;
    var cfg = window.DADAM_CONFIG || {};
    var base = (cfg.workflowApi && cfg.workflowApi.url) || '';
    if (!base) return;
    try {
      var res = await fetch(base + '/me/projects', {
        headers: { Authorization: 'Bearer ' + session.access_token },
        cache: 'no-store',
      });
      if (!res.ok) return; // 404(아직 없는 주소) · 오류 — 칸째 감춘다
      var body = await res.json();
      if (!body || body.success !== true || !Array.isArray(body.data)) return;
      var rows = body.data;
      H.projects = rows;
      H.projectStage = null;
      renderMyProjects(''); // 모양이 틀린 행은 던진다 → 칸째 감춘다
      section.hidden = false;
      bindPay(session);
    } catch {
      H.projects = null;
      section.hidden = true;
    }
  }

  /** 내 프로젝트를 하위 메뉴 단계로 거른다 ('' = 모두 — 옛 주소 #projects-mine). title = 칸 머리글 */
  function renderMyProjects(stage, title) {
    var list = $('meProjects');
    if (!list || !Array.isArray(H.projects) || H.projectStage === stage) return;
    H.projectStage = stage;
    var rows = H.projects.filter(function (p) {
      return !stage || menuStage(p.stage, p.order && p.order.status) === stage;
    });
    list.innerHTML = rows.map(projectHtml).join('');
    var empty = $('meProjectEmpty');
    empty.textContent = stage ? TEXT.stageEmpty : TEXT.projectEmpty;
    empty.hidden = rows.length > 0;
    var h = $('meProjectTitle');
    if (h) h.textContent = title || '내 프로젝트';
  }

  // ── 상담 내역 ──────────────────────────────────────────
  async function loadConsults(sb, session) {
    var list = $('meConsults');
    try {
      var res = await sb
        .from('consultations')
        .select('id, title, status, created_at')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (res.error) throw res.error;
      var rows = res.data || [];
      list.innerHTML = rows
        .map(function (c) {
          return (
            '<li><span class="sg-row me-consult"><span class="me-c-main"><b>' +
            esc(c.title || '상담') +
            '</b><small>' +
            esc(day(c.created_at)) +
            '</small></span><span class="me-badge me-badge--' +
            esc(c.status || 'pending') +
            '">' +
            esc(CONSULT_STATUS[c.status] || c.status || '대기') +
            '</span></span></li>'
          );
        })
        .join('');
      $('meConsultEmpty').hidden = rows.length > 0;
    } catch {
      list.innerHTML = '';
      $('meConsultEmpty').hidden = false;
      $('meConsultEmpty').textContent = '상담 내역을 불러오지 못했습니다.';
    }
  }

  // ── 크레딧 · 구독 ──────────────────────────────────────
  async function loadPlan(sb, session, wallet) {
    var tier = 'standard';
    try {
      var p = await sb
        .from('profiles')
        .select('tier, name')
        .eq('id', session.user.id)
        .maybeSingle();
      if (p && p.data && p.data.tier) tier = p.data.tier;
      var name = p && p.data && typeof p.data.name === 'string' ? p.data.name.trim() : '';
      $('meName').textContent = name;
      $('meName').hidden = !name;
    } catch {
      /* 등급을 못 읽으면 standard 로 적는다 (billing.html 과 같다) */
    }
    $('meTier').textContent = TIER_NAME[tier] || String(tier).toUpperCase();

    try {
      var w = await wallet;
      var left = w && w.balance != null ? Number(w.balance) : null;
      var cc = await sb
        .from('credit_costs')
        .select('credits')
        .eq('action', 'generate')
        .maybeSingle();
      var cost = cc && cc.data ? cc.data.credits : null;
      $('meCredits').textContent =
        left == null
          ? '-'
          : left.toLocaleString('ko-KR') +
            ' 크레딧' +
            (cost > 0 ? ' · 생성 ' + Math.floor(left / cost) + '회' : '');
    } catch {
      $('meCredits').textContent = '-';
    }

    var cfg = window.DADAM_CONFIG || {};
    var api = (cfg.paymentsApi && cfg.paymentsApi.url) || '';
    try {
      if (!api) throw new Error('no api');
      var res = await fetch(api + '/subscription', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
      var body = await res.json();
      var sub = body && body.data ? body.data : null;
      if (!sub && body && body.company) {
        $('meSub').textContent = '팩토리 구독은 대표가 관리합니다';
      } else if (!sub || sub.plan === 'free') {
        $('meSub').textContent = '없음';
      } else {
        var t = subLabel(sub);
        if (sub.status === 'active' && sub.next_charge_at)
          t += ' · 다음 결제 ' + day(sub.next_charge_at);
        else if (sub.amount_krw) t += ' · 월 ' + won(sub.amount_krw);
        $('meSub').textContent = t;
      }
    } catch {
      $('meSub').textContent = '불러오지 못했습니다';
    }
  }

  // ── 좋아요 (#likes) ─────────────────────────────────────
  // posts = 그린 차례 (♡ 를 풀고 닫은 것은 null — 타일 차례 번호를 그대로 둔다), before = 다음 쪽 기준 liked_at
  var LK = { posts: [], before: null, done: false, loading: false, started: false, failed: false };

  function likeUser() {
    return (H.session && H.session.user && H.session.user.id) || '';
  }

  function paintLikes() {
    var left = LK.posts.filter(Boolean).length;
    $('meLikeEmpty').hidden = LK.loading || LK.failed || !LK.done || left > 0;
    $('meLikeState').textContent = LK.loading ? TEXT.likesLoading : LK.failed ? TEXT.likesFail : '';
    var more = $('meLikeMore');
    more.hidden = LK.loading || (LK.done && !LK.failed);
    more.textContent = LK.failed ? TEXT.likesRetry : TEXT.likesMore;
  }

  /** 다음 쪽 — collection_my_likes(p_limit, p_before). 못 읽으면 「다시 불러오기」 */
  async function loadLikes() {
    var PV = window.SeganPostView;
    if (!H.sb || !PV || !$('meLikes') || LK.loading || (LK.done && !LK.failed)) return;
    LK.started = true;
    LK.loading = true;
    LK.failed = false;
    paintLikes();
    var args = { p_limit: LIKE_PAGE };
    if (LK.before) args.p_before = LK.before;
    var rows = null;
    try {
      var res = await H.sb.rpc('collection_my_likes', args);
      if (res && !res.error && Array.isArray(res.data)) rows = res.data;
    } catch {
      rows = null;
    }
    LK.loading = false;
    if (!rows) {
      LK.failed = true;
      paintLikes();
      return;
    }
    var last = rows.length ? rows[rows.length - 1].liked_at : null;
    if (last) LK.before = last;
    // 한 쪽이 덜 찼거나 · 다음 쪽 기준이 없으면 끝
    LK.done = rows.length < LIKE_PAGE || !last;
    var from = LK.posts.length;
    rows.forEach(function (r) {
      if (r && r.post_id && r.image_url) LK.posts.push(PV.fromLike(r));
    });
    var html = '';
    for (var i = from; i < LK.posts.length; i++) html += PV.tileHTML(LK.posts[i], i);
    $('meLikes').insertAdjacentHTML('beforeend', html);
    paintLikes();
  }

  /** 타일을 누르면 사진 보기 — ♡ 를 풀고 닫으면 목록에서 뺀다 */
  function onLikesClick(e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-open]') : null;
    var PV = window.SeganPostView;
    if (!b || !PV) return;
    var i = Number(b.getAttribute('data-open'));
    var p = LK.posts[i];
    if (!p) return;
    PV.open(p, {
      sb: H.sb,
      userId: likeUser(),
      liked: true,
      loginHref: '../login.html?redirect=' + encodeURIComponent(LIKE_RETURN),
      img: b.querySelector('img'),
      onClose: function (why, liked) {
        if (liked) return;
        LK.posts[i] = null;
        if (b.parentNode) b.parentNode.removeChild(b);
        paintLikes();
      },
    });
  }

  function bindLikes() {
    var grid = $('meLikes');
    if (!grid || grid.getAttribute('data-bound')) return;
    grid.setAttribute('data-bound', '1');
    grid.addEventListener('click', onLikesClick);
    if (window.SeganPostView) window.SeganPostView.guardImages(grid);
    var more = $('meLikeMore');
    if (more) more.addEventListener('click', loadLikes);
  }

  // ── 메뉴 · 하위 화면 ─────────────────────────────────────
  // section = 그 화면의 칸 · parts = 업체 칸(#partner) 안에서 보일 부분(그중 하나가 보여야 연다) ·
  // filled = 이 칸이 비어 있지 않아야 연다 (공장 구성원은 업체 내용 없이 상담 · 프로젝트 · A/S함만 온다) ·
  // needs = 이 칸 안에 이것이 있어야 연다 · label = 업체 칸 이름을 그 화면 제목으로 (모듈이 그리는 h3) ·
  // stage = 프로젝트를 이 단계로 거른다 ('' = 모두) · view = 업체 칸의 data-me-view (직원 화면은 업체 내용 안 직원만) ·
  // soon = 준비 중 안내 (칸 없이) · empty = 칸이 없을 때 「볼 수 있는 내용이 없습니다」 대신 · pick = 보는 사람마다 고른다
  var SCREENS = {
    // 대시보드 — 큰 메뉴 이름을 누르면 (dash = 그 큰 메뉴 data-menu)
    'dash-home': { title: '홈', dash: 'home', section: 'meDash' },
    'dash-project': {
      title: '프로젝트 관리',
      dash: 'project',
      section: 'meDash',
      pick: projectDash,
    },
    'dash-stock': { title: '구매 · 재고', dash: 'stock', section: 'meDash' },
    'dash-ledger': {
      title: '회계',
      dash: 'ledger',
      section: 'meDash',
      extra: { section: 'partner', parts: ['meBooks'] },
    },
    'dash-people': { title: '인사', dash: 'people', section: 'meDash' },
    'dash-master': { title: '기준정보', dash: 'master', section: 'meDash' },
    'dash-platform': { title: '플랫폼', dash: 'platform', section: 'meDash' },
    'dash-basic': { title: '내 계정', dash: 'basic', section: 'meDash' },
    // 프로젝트 관리 — 고객은 내 것, 업체 구성원은 업체 것 (pick)
    'p-consult': { title: '상담', pick: stageScreen('consult') },
    'p-design': { title: '설계', pick: stageScreen('design') },
    'p-quote': { title: '견적', pick: stageScreen('quote') },
    'p-contract': { title: '계약', pick: stageScreen('contract') },
    'p-make': { title: '제작', pick: stageScreen('make') },
    'p-install': { title: '설치', pick: stageScreen('install') },
    'p-as': { title: 'A/S', pick: stageScreen('as') },
    // 생산 › 생산 계획 (다담 공장) — 추천 · 일정 · 부하 · 지시 · 월 손익 (segan/production-plan.js)
    'p-plan': {
      title: '생산 계획',
      section: 'partner',
      parts: ['productionPlan'],
      label: 'productionPlanTitle',
    },
    // 영업 › 수금 (업체) — 수금 표 (segan/orders.js)
    'p-collect': { title: '수금', pick: collectScreen },
    // 영업 › 고객 (업체) — 준비 중
    'p-customers': {
      title: '고객',
      soon: '고객 목록은 준비 중입니다. 업체 고객의 연락처와 프로젝트를 모아 보고 고치게 됩니다.',
    },
    // 구매 · 재고 (Expert 이상 · 공장) — 준비 중
    'stock-board': {
      title: '기본 자재',
      soon: '재고 관리는 준비 중입니다. 보드 · 판재 재고를 여기서 관리하게 됩니다.',
    },
    'stock-scrap': {
      title: '자투리 자재',
      soon: '재고 관리는 준비 중입니다. 남은 조각 크기를 모아 다시 쓰게 됩니다.',
    },
    'stock-hardware': {
      title: '철물',
      soon: '재고 관리는 준비 중입니다. 경첩 · 서랍 레일 · 리프트업 철물 수량을 관리하게 됩니다.',
    },
    // 인사 (Agent · 공장)
    staff: {
      title: '직원',
      section: 'partner',
      parts: ['mePartner'],
      needs: '#mePartner .me-pt-staff',
      view: 'staff',
    },
    assign: {
      title: '작업 분배',
      section: 'partner',
      parts: ['partnerProjects'],
      label: 'partnerProjectsTitle',
      stage: '',
      assign: true,
    },
    schedule: {
      title: '근무 일정',
      soon: '근무 일정은 준비 중입니다. 직원 · 작업자의 근무와 쉬는 날을 한 표로 보게 됩니다.',
    },
    workers: {
      title: '작업자',
      soon: '작업자는 준비 중입니다. 설치 · A/S 외부 작업자를 모으고 배정하게 됩니다.',
    },
    // 플랫폼 — 등록 업체 (segan/hq-companies.js)
    companies: { title: '등록 업체', section: 'hqCompanies' },
    // 내 계정
    partner: {
      title: '내 팩토리',
      section: 'partner',
      parts: ['mePartnerTitle', 'mePartner', 'meBooks'],
      filled: 'mePartner',
    },
    likes: { title: '좋아요', section: 'meLikeSection' },
    notify: { title: '알림', section: 'mePush' },
    // 옛 주소 — 알림 · 결제 · 다른 화면이 여는 # 는 그대로 그 화면 (메뉴 줄은 위 하위 메뉴가 맡는다)
    'partner-consults': {
      title: '상담',
      section: 'partner',
      parts: ['partner-consults', 'partnerConsultSettings'],
      label: 'partnerConsultsTitle',
    },
    'partner-projects': {
      title: '프로젝트',
      section: 'partner',
      parts: ['partnerProjects'],
      label: 'partnerProjectsTitle',
      stage: '',
    },
    'production-requests': {
      title: '제작 의뢰',
      section: 'partner',
      parts: ['production-requests'],
      label: 'productionTitle',
    },
    'factory-requests': {
      title: '제작 의뢰함',
      section: 'partner',
      parts: ['factory-requests'],
      label: 'factoryRequestsTitle',
    },
    as: { title: 'A/S함', section: 'partner', parts: ['siteAs', 'as'], label: 'asTitle' },
    consults: { title: '상담 내역', section: 'meConsultSection' },
    'projects-mine': { title: '내 프로젝트', section: 'meProjectSection', stage: '' },
    'as-mine': { title: 'A/S 접수', section: 'meAsSection' },
  };
  // 옛 주소로 왔을 때 메뉴 · 구역에서 밝힐 화면
  var ALIAS = {
    'partner-consults': 'p-consult',
    'factory-requests': 'p-make',
    consults: 'p-consult',
    'production-requests': 'p-make',
    as: 'p-as',
    'as-mine': 'p-as',
  };
  // 프로젝트 관리 하위 줄(data-me-item) → 묶은 화면 (차례 = 화면 위 구역 단추 차례, 첫 화면이 줄의 주소)
  var SUBS = {
    'pj-sales': ['p-consult', 'p-quote', 'p-contract', 'p-collect', 'p-customers'],
    'pj-design': ['p-design'],
    'pj-make': ['p-make', 'p-plan'],
    'pj-install': ['p-install'],
    'pj-as': ['p-as'],
  };
  var MEMBER_PARTS = ['p-collect', 'p-customers']; // 업체 구성원만 (수금 = 수금 표 · 고객 = 준비 중)
  // 대시보드 칸 — 프로젝트 관리 하위 줄마다 셀 단계 · 작은 글 (A/S 는 처리 중 접수)
  var DASH_COUNT = {
    'pj-sales': { stages: ['consult', 'quote', 'contract'], note: '상담 · 견적 · 계약' },
    'pj-design': { stages: ['design'], note: '설계 · 연출컷' },
    'pj-make': { stages: ['make'], note: '제작 중' },
    'pj-install': { stages: ['install'], note: '배송 · 설치' },
    'pj-as': { as: true, note: '처리 중' },
  };
  var AS_OPEN = ['requested', 'received']; // 접수 · 받음 (segan/as-requests.js STATE_LABEL)
  var SECTIONS = [
    'meDash',
    'hqCompanies',
    'meProjectSection',
    'meAsSection',
    'partner',
    'meLikeSection',
    'meConsultSection',
    'mePush',
  ];
  var PARTNER_PARTS = [
    'mePartnerTitle',
    'mePartner',
    'partner-consults',
    'factory-requests',
    'production-requests',
    'productionPlan',
    'siteInstall',
    'orders',
    'ordersCollect',
    'partnerProjects',
    'partnerConsultSettings',
    'siteAs',
    'as',
    'meBooks',
  ];
  var GROUPS = ['meGroupWork', 'meGroupManage', 'meGroupMine'];
  var FACTORY_PLANS = ['expert', 'agent']; // 상담 배정 · 받은 제작 의뢰 · A/S함 · 구매 · 재고 (+ 다담 공장)
  var PEOPLE_PLANS = ['agent']; // 인사 (+ 다담 공장) — account-api STAFF_TOOL_PLANS
  var MONEY_ROLES = ['owner', 'manager']; // 대표 · 실장
  var OPEN_KEY = 'segan.me.open'; // 펼친 큰 메뉴 (sessionStorage)
  var WIDE = '(min-width: 1100px)'; // shell.css 두 칸 — 시트가 옆 패널이 되는 폭과 같다
  var HUB_TITLE = '마이페이지';
  var TEXT = {
    wait: '확인하는 중…',
    none: '볼 수 있는 내용이 없습니다.',
    factory: '내 팩토리',
    start: '팩토리로 시작하기',
    applying: '팩토리 신청',
    noAsMine: '접수한 A/S가 없습니다. 설치가 끝난 프로젝트의 「설치」 화면에서 A/S를 신청합니다.',
    managerAs:
      'A/S는 준비 중입니다. 내 고객의 A/S 접수를 확인하고 제작한 팩토리로 전달하게 됩니다.',
    noCollect: '수금을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.',
    stageEmpty: '이 단계의 프로젝트가 없습니다.',
    projectEmpty: '진행 중인 프로젝트가 없습니다.',
    noJob: '없음',
    seeMine: '작업 화면 「내 작업」에서 확인하세요',
    pending: '승인 대기 — 회사가 확인하면 작업을 볼 수 있습니다', // js/mypage-work.js summaryHtml 과 같은 글
    rejected: '신청이 승인되지 않았습니다',
    likesLoading: '불러오는 중',
    likesFail: '좋아요를 불러오지 못했습니다.',
    likesMore: '더 보기',
    likesRetry: '다시 불러오기',
    planner: '플래너 열기',
    dashEmpty: '이 메뉴에서 볼 수 있는 화면이 없습니다.',
    open: '열기',
  };
  var ROLE_NAME = { owner: '대표', manager: '실장', staff: '직원' }; // 업체 안 직책 (등급 Manager 와 다르다)

  var H = {
    on: false, // 로그인해 메뉴를 그렸다
    loaded: false, // 칸을 모두 읽었다 (못 여는 화면 안내를 그때부터)
    partnerKnown: false, // /partner/me 를 읽었다 (PC 첫 칸을 그때 고른다)
    roles: null, // 셸 판정
    sb: null, // 로그인한 클라이언트 · 세션 (좋아요 화면이 쓴다)
    session: null,
    projects: null, // GET /me/projects 의 줄 (고객 프로젝트 관리 — 단계로 거른다)
    projectStage: null, // 지금 그린 고객 프로젝트 단계 (null = 아직 안 그림)
    open: '', // 펼친 큰 메뉴 (data-menu)
    touched: false, // 사람이 큰 메뉴를 골랐다 (전에는 지금 화면이 든 · 처음 보이는 큰 메뉴를 펼친다)
    shown: null, // 지난번에 보인 화면 (# — '' = 메뉴, null = 아직 안 그림)
  };

  /** 움직임 — segan/motion.js 를 실은 화면만 (없으면 움직이지 않는다) */
  function motion() {
    return window.SeganMotion || null;
  }

  /** 폰 · 태블릿 화면 바꾸기 — 하위 화면은 오른쪽에서, 메뉴는 왼쪽에서 (들어온 쪽으로 나간다) */
  function slideIn(toPane) {
    var M = motion();
    var el = $(toPane ? 'mePane' : 'meHub');
    if (M && el)
      M.enter(el, { transform: 'translateX(' + (toPane ? 28 : -28) + 'px)', opacity: 0.3 });
  }

  function shown(id) {
    var el = $(id);
    return !!el && !el.hidden;
  }

  function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  /** 업체 칸 판정 (segan/partner.js) → { me, view } */
  function partnerOf() {
    var P = window.SeganPartner;
    var me = P && P.state ? P.state.me : null;
    return { me: me, view: P && P.viewOf ? P.viewOf(me) : 'hidden' };
  }

  /**
   * 보는 사람 — /partner/me 로 가린다.
   * company = 협력업체(plan · role) · hq = 다담 공장 구성원 · platform = 다담 본사 구성원 ·
   * factory = 상담 배정 · 제작 의뢰함 · A/S함을 받는 팩토리 (다담 공장 · Expert · Agent)
   */
  function viewer() {
    var p = partnerOf();
    var me = p.me && typeof p.me === 'object' ? p.me : {};
    var c =
      p.view === 'company' && me.company && typeof me.company === 'object' ? me.company : null;
    var hq = me.hq_member === true;
    var plan = c ? c.plan : '';
    return {
      company: c,
      hq: hq,
      platform: me.platform_member === true,
      member: !!c || hq,
      plan: plan,
      role: c ? c.role : '',
      factory: hq || FACTORY_PLANS.indexOf(plan) >= 0,
      people: hq || (PEOPLE_PLANS.indexOf(plan) >= 0 && MONEY_ROLES.indexOf(c.role) >= 0),
    };
  }

  /**
   * 프로젝트 관리 하위 화면 — 고객은 내 상담 · 내 프로젝트 · 내 A/S, 업체 구성원은 업체 칸.
   *   상담: 팩토리 = 배정 상담 · 상담 단계 프로젝트 · 상담 설정, Manager = 상담 단계 프로젝트
   *   계약: 수주 표 · 계약 단계 프로젝트
   *   제작: 팩토리 = 받은 제작 의뢰 · 제작 단계 프로젝트, Manager = 제작 의뢰 · 제작 단계 프로젝트
   *   설치: 설치 현장 지도 + 표 · 설치 단계 프로젝트
   *   A/S: 팩토리 = A/S 현장 지도 + 표 · A/S함, Manager = 준비 중
   */
  function stageScreen(stage) {
    return function () {
      var title = SCREENS['p-' + stage].title;
      var v = viewer();
      if (!v.member) {
        if (stage === 'consult') return { title: title, section: 'meConsultSection' };
        if (stage === 'as') return { title: title, section: 'meAsSection', empty: TEXT.noAsMine };
        return { title: title, section: 'meProjectSection', stage: stage };
      }
      var parts = ['partnerProjects'];
      if (stage === 'consult' && v.factory)
        parts = ['partner-consults', 'partnerProjects', 'partnerConsultSettings'];
      if (stage === 'make')
        parts = [v.factory ? 'factory-requests' : 'production-requests', 'partnerProjects'];
      // 계약 = 수주 표(누르면 상세 시트) · 계약 단계 프로젝트 (segan/orders.js)
      if (stage === 'contract') parts = ['orders', 'partnerProjects'];
      // 설치 = 설치 현장 지도 + 표 · 설치 단계 프로젝트, A/S = A/S 현장 지도 + 표 · A/S함 (segan/site-map.js)
      if (stage === 'install') parts = ['siteInstall', 'partnerProjects'];
      if (stage === 'as')
        return v.factory
          ? { title: title, section: 'partner', parts: ['siteAs', 'as'], label: 'asTitle' }
          : { title: title, soon: TEXT.managerAs };
      return { title: title, section: 'partner', parts: parts, stage: stage };
    };
  }

  /** 영업 › 수금 — 업체 구성원의 수금 표 (segan/orders.js). 못 읽으면 그 말을, 구성원이 아니면 「볼 수 있는 내용이 없습니다」 */
  function collectScreen() {
    var s = {
      title: SCREENS['p-collect'].title,
      section: 'partner',
      parts: ['ordersCollect'],
      label: 'ordersCollectTitle',
    };
    if (viewer().member) s.empty = TEXT.noCollect;
    return s;
  }

  /** 프로젝트 관리 대시보드 — 아래에 모든 단계 프로젝트 (고객은 내 프로젝트, 업체는 업체 프로젝트) */
  function projectDash() {
    var base = { title: SCREENS['dash-project'].title, dash: 'project', section: 'meDash' };
    base.extra = viewer().member
      ? { section: 'partner', parts: ['partnerProjects'], stage: '' }
      : { section: 'meProjectSection', stage: '' };
    return base;
  }

  /** 화면 정의 — 보는 사람마다 고르는 것(pick)은 지금 판정으로 */
  function defOf(name) {
    var s = own(SCREENS, name) ? SCREENS[name] : null;
    if (!s) return null;
    return typeof s.pick === 'function' ? s.pick() : s;
  }

  /** 큰 메뉴 (li[data-menu]) */
  function menuEl(key) {
    return key ? document.querySelector('#meHub [data-menu="' + key + '"]') : null;
  }

  /** 그 화면을 보일 수 있나 — 칸을 그 모듈이 열었을 때만 (준비 중은 늘, 대시보드는 그 큰 메뉴가 보일 때) */
  function available(name) {
    var s = defOf(name);
    if (!s) return false;
    if (s.soon) return true;
    if (s.dash) {
      var m = menuEl(s.dash);
      return !!m && !m.hidden;
    }
    if (!shown(s.section)) return false;
    if (s.filled) {
      var f = $(s.filled);
      return !!f && f.children.length > 0;
    }
    if (s.needs) return !!document.querySelector(s.needs);
    if (s.parts) return s.parts.some(shown);
    return true;
  }

  function isWide() {
    try {
      return typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;
    } catch {
      return false;
    }
  }

  /** 주소의 # 가 고른 화면 — 모르는 # 는 메뉴 */
  function askedScreen() {
    var h = String(location.hash || '').slice(1);
    return own(SCREENS, h) ? h : '';
  }

  /** 메뉴 줄 — data-me-item 이 그 이름인 li */
  function item(key) {
    return document.querySelector('#meHub [data-me-item="' + key + '"]');
  }

  /** 옛 주소는 그것이 여는 화면으로 */
  function aliasOf(name) {
    return own(ALIAS, name) ? ALIAS[name] : name;
  }

  /** 화면 → 밝힐 하위 줄(data-me-item) — 프로젝트 관리 화면은 그것을 묶은 줄 */
  function rowKeyOf(name) {
    var n = aliasOf(name);
    for (var k in SUBS) if (own(SUBS, k) && SUBS[k].indexOf(n) >= 0) return k;
    return n;
  }

  /** 그 화면이 든 큰 메뉴 — 대시보드는 그 메뉴, 나머지는 밝힐 하위 줄이 든 메뉴 */
  function menuOf(name) {
    var s = own(SCREENS, name) ? SCREENS[name] : null;
    if (s && s.dash) return s.dash;
    var li = item(rowKeyOf(name));
    var menu = li && li.closest ? li.closest('[data-menu]') : null;
    return menu ? menu.getAttribute('data-menu') : '';
  }

  /** PC 에서 # 없이 열면 — 처음 보이는 큰 메뉴의 대시보드 */
  function defaultScreen() {
    var m = document.querySelector('#meHub .me-group:not([hidden]) [data-menu]:not([hidden])');
    return 'dash-' + (m ? m.getAttribute('data-menu') : 'basic');
  }

  function off(id, yes) {
    var el = $(id);
    if (el) el.classList.toggle('me-off', yes);
  }

  /** 프로젝트 칸을 그 화면의 단계로 — 고객은 이 파일이, 업체는 segan/partner-projects.js 가 거른다 */
  function showStage(s) {
    if (!s) return;
    if (s.section === 'meProjectSection') renderMyProjects(s.stage || '', s.stage ? s.title : '');
    var PP = window.SeganPartnerProjects;
    if (s.parts && s.parts.indexOf('partnerProjects') >= 0 && PP && PP.setView)
      PP.setView({ stage: s.stage || '', assign: !!s.assign });
  }

  /** 플래너 주소 — SeganShell.ROLE_LINKS planner (한 곳에서 정한다) */
  function plannerHref() {
    var links = (window.SeganShell && window.SeganShell.ROLE_LINKS) || [];
    for (var i = 0; i < links.length; i++) if (links[i].key === 'planner') return links[i].href;
    return '';
  }

  /** data-desktop-tab 링크 — PC 브라우저에서만 새 탭 (SeganShell.desktopTab) */
  function linkTargets(root) {
    var Shell = window.SeganShell || {};
    if (!root || !Shell.applyLinkTarget) return;
    root.querySelectorAll('a[data-desktop-tab]').forEach(function (a) {
      Shell.applyLinkTarget(a);
    });
  }

  /** 글이 바뀔 때만 다시 그린다 (누른 칸의 초점을 지키게) */
  function paint(el, html) {
    if (el.__meHtml === html) return;
    el.__meHtml = html;
    el.innerHTML = html;
    linkTargets(el);
  }

  /**
   * 화면 위 구역 단추 — 그 화면을 묶은 하위 줄의 화면들 (수금 · 고객은 업체 구성원만), 설계는 플래너 단추도.
   * 둘 이상일 때만 보인다
   */
  function renderParts(name) {
    var nav = $('meParts');
    if (!nav) return;
    var n = aliasOf(name);
    var key = name ? rowKeyOf(name) : '';
    var v = viewer();
    var html = (own(SUBS, key) ? SUBS[key] : [])
      .filter(function (p) {
        return MEMBER_PARTS.indexOf(p) >= 0 ? v.member : available(p);
      })
      .map(function (p) {
        var s = defOf(p);
        return (
          '<a class="me-part' +
          (s.soon ? ' me-part-soon' : '') +
          '" href="#' +
          p +
          '" data-me-part="' +
          p +
          '"' +
          (p === n ? ' aria-current="page"' : '') +
          '>' +
          esc(s.title) +
          '</a>'
        );
      });
    var href = key === 'pj-design' && (H.roles || {}).planner === true ? plannerHref() : '';
    if (href)
      html.push(
        '<a class="me-part me-part-link" href="' +
          esc(href) +
          '" data-desktop-tab>' +
          esc(TEXT.planner) +
          '</a>'
      );
    paint(nav, html.length > 1 ? html.join('') : '');
    nav.hidden = html.length < 2;
  }

  /** 프로젝트 단계별 수 — 고객은 내 프로젝트, 업체는 업체 프로젝트 (읽지 못했으면 null) */
  function stageCounts(v) {
    var PP = window.SeganPartnerProjects;
    var d = v.member && PP && PP.state ? PP.state.data : null;
    var list = v.member ? d && d.items : H.projects;
    if (!Array.isArray(list)) return null;
    var n = {};
    list.forEach(function (p) {
      var k = menuStage(
        p && p.stage,
        p && p.order && typeof p.order === 'object' ? p.order.status : ''
      );
      n[k] = (n[k] || 0) + 1;
    });
    return n;
  }

  /** 처리 중(접수 · 받음) A/S 수 — 업체는 A/S함, 고객은 내 접수 (읽지 못했으면 null) */
  function asCount(v) {
    var A = window.SeganAs;
    var list = A && A.state ? (v.member ? A.state.box : A.state.mine) : null;
    if (!Array.isArray(list)) return null;
    return list.filter(function (x) {
      return !!x && AS_OPEN.indexOf(x.state) >= 0;
    }).length;
  }

  /** 대시보드 칸의 수 — 프로젝트 관리 하위 줄만 (모르면 null) */
  function countOf(key, v) {
    var c = own(DASH_COUNT, key) ? DASH_COUNT[key] : null;
    if (!c) return null;
    if (c.as) return asCount(v);
    var n = stageCounts(v);
    if (!n) return null;
    return c.stages.reduce(function (sum, k) {
      return sum + (n[k] || 0);
    }, 0);
  }

  /** 대시보드 칸 하나 — 그 하위 줄과 같은 곳으로 (글 · 값은 줄에서, 수는 프로젝트 관리만) */
  function tileHtml(li, v) {
    var a = li.querySelector('a.sg-row');
    if (!a) return '';
    var key = li.getAttribute('data-me-item');
    var first = a.querySelector('span');
    var val = a.querySelector('.me-val');
    var soon = a.classList.contains('me-row-soon');
    var go = a.getAttribute('data-me-go');
    var n = countOf(key, v);
    var note = n !== null ? DASH_COUNT[key].note : soon ? '준비 중' : val ? val.textContent : '';
    return (
      '<a class="me-tile' +
      (soon ? ' me-tile-soon' : '') +
      '" href="' +
      esc(a.getAttribute('href') || '#') +
      '"' +
      (go ? ' data-me-go="' + esc(go) + '"' : '') +
      (a.hasAttribute('data-desktop-tab') ? ' data-desktop-tab' : '') +
      '><span class="me-tile-k">' +
      esc((first || a).textContent) +
      '</span>' +
      (n !== null ? '<span class="me-tile-n">' + esc(String(n)) + '</span>' : '') +
      (note ? '<span class="me-tile-d">' + esc(note) + '</span>' : '') +
      '</a>'
    );
  }

  /** 대시보드 — 그 큰 메뉴의 보이는 하위 줄마다 칸 하나 */
  function renderDash(key) {
    var body = $('meDashBody');
    if (!body) return;
    var m = menuEl(key);
    var v = viewer();
    var rows = m ? [].slice.call(m.querySelectorAll('li[data-me-item]:not([hidden])')) : [];
    var title = $('meDashTitle');
    if (title) title.textContent = SCREENS['dash-' + key].title;
    paint(
      body,
      rows.length
        ? '<div class="me-tiles">' +
            rows
              .map(function (li) {
                return tileHtml(li, v);
              })
              .join('') +
            '</div>'
        : '<p class="me-empty">' + esc(TEXT.dashEmpty) + '</p>'
    );
  }

  /** 지금 주소 · 폭에 맞는 화면을 보인다 ('' = 메뉴만, 폰 · 태블릿) */
  function apply() {
    var main = $('main');
    if (!main || !H.on) return;
    var asked = askedScreen();
    var wide = isWide();
    var name = asked || (wide && H.partnerKnown ? defaultScreen() : '');
    var s = name ? defOf(name) : null;
    var open = !!s && !s.soon && available(name); // 못 여는 화면 · 준비 중이면 칸 없이 안내만
    // 아래에 붙일 칸 (대시보드) — 그 모듈이 연 때만
    var x = open && s.extra && shown(s.extra.section) ? s.extra : null;
    if (x && x.parts && !x.parts.some(shown)) x = null;
    var parts = (s && s.parts ? s.parts : []).concat(x && x.parts ? x.parts : []);
    main.setAttribute('data-me-screen', name);
    SECTIONS.forEach(function (id) {
      off(id, !open || (s.section !== id && !(x && x.section === id)));
    });
    PARTNER_PARTS.forEach(function (id) {
      off(id, parts.indexOf(id) < 0);
    });
    var sec = $('partner');
    if (sec) {
      sec.setAttribute('aria-labelledby', s && s.label && $(s.label) ? s.label : 'mePartnerTitle');
      sec.setAttribute('data-me-view', (open && s.view) || '');
    }
    if (open) showStage(s);
    if (x) showStage(x);
    if (open && s.dash) renderDash(s.dash);
    off('meCalendar', !(open && s.dash === 'project')); // 업무 달력 — 프로젝트 관리 대시보드에서만
    renderParts(name);
    var note = $('mePaneNote');
    if (note) {
      var text = '';
      if (s && s.soon) text = s.soon;
      else if (name && !open) text = H.loaded ? s.empty || TEXT.none : TEXT.wait;
      else if (!name && wide) text = TEXT.wait; // PC — 업체 칸을 읽는 동안 첫 칸을 고르지 않는다
      note.textContent = text;
      note.hidden = !text;
      note.classList.toggle('me-soon', !!(s && s.soon));
    }
    // 밝힐 줄 — 하위 줄(프로젝트 관리는 화면을 묶은 줄) · 대시보드면 큰 메뉴 이름
    var lit = name ? rowKeyOf(name) : '';
    document.querySelectorAll('#meHub li[data-me-item] > a.sg-row').forEach(function (a) {
      if (lit && a.parentNode.getAttribute('data-me-item') === lit)
        a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var dash = s && s.dash ? s.dash : '';
    document.querySelectorAll('#meHub [data-me-dash]').forEach(function (b) {
      if (dash && b.getAttribute('data-me-dash') === dash) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    var back = $('meBack');
    if (back) back.hidden = !asked;
    var title = $('meTitle');
    var askedTitle = asked ? (defOf(asked) || {}).title || '' : '';
    // PC 는 왼쪽 메뉴가 늘 보여 「마이페이지」 그대로, 폰 · 태블릿은 그 화면 이름
    if (title) title.textContent = asked && !wide ? askedTitle : HUB_TITLE;
    document.title = (asked ? askedTitle + ' · ' : '') + HUB_TITLE + ' · SEGAN';
    if (open && name === 'likes' && !LK.started) loadLikes(); // 좋아요 — 처음 열 때 읽는다
    if (H.shown !== null && H.shown !== asked && !wide) slideIn(!!asked);
    H.shown = asked;
  }

  function toTop() {
    var se = document.scrollingElement || document.documentElement;
    if (se) se.scrollTop = 0;
  }

  /** 펼친 큰 메뉴 — 폰 · PC 모두 하나만. chosen = 사람이 골랐다 (이 탭 동안 기억) */
  function setOpen(key, chosen) {
    H.open = key || '';
    if (chosen) {
      H.touched = true;
      try {
        sessionStorage.setItem(OPEN_KEY, H.open);
      } catch {
        /* 저장 못 해도 이번 화면은 그대로 */
      }
    }
    document.querySelectorAll('#meHub [data-menu]').forEach(function (li) {
      var on = li.getAttribute('data-menu') === H.open;
      li.classList.toggle('is-open', on);
      var b = li.querySelector('[data-menu-toggle]');
      if (b) b.setAttribute('aria-expanded', String(on));
    });
  }

  /**
   * 메뉴에서 그 화면으로 — 그 화면이 든 큰 메뉴를 펼치고 기록을 하나 넣는다 (meFrom = 넣기 전 화면, '' 이면 메뉴).
   * replace = 구역 단추 — 같은 기록을 바꾼다 (뒤로 가기는 구역마다가 아니라 메뉴로)
   */
  function go(name, replace) {
    var from = askedScreen();
    var menu = menuOf(name);
    if (menu) setOpen(menu, true);
    if (name === from) return;
    try {
      if (replace) history.replaceState(history.state, '', '#' + name);
      else history.pushState({ meFrom: from }, '', '#' + name);
    } catch {
      location.hash = name;
      return;
    }
    apply();
    toTop();
  }

  /** 구역 단추 — 같은 기록 안에서, 폰 · 태블릿은 단추 차례대로 좌우에서 들어온다 */
  function goPart(name) {
    var from = askedScreen();
    var list = SUBS[rowKeyOf(name)] || [];
    if (!from || name === from) {
      go(name);
      return;
    }
    var dir = list.indexOf(name) > list.indexOf(aliasOf(from)) ? 1 : -1;
    H.shown = name; // apply 의 화면 바꾸기 움직임 대신 아래 좌우 움직임
    go(name, true);
    var M = motion();
    var el = $('mePane');
    if (M && el && !isWide())
      M.enter(el, { transform: 'translateX(' + dir * 28 + 'px)', opacity: 0.3 });
  }

  /** 「‹ 마이페이지」 — 메뉴에서 왔으면 뒤로, 아니면(알림 · 새로 고침) 이 기록을 메뉴로 바꾼다 */
  function backToHub(e) {
    if (e) e.preventDefault();
    var menu = menuOf(askedScreen());
    if (menu) setOpen(menu, true); // 돌아온 메뉴에서 그 화면이 든 큰 메뉴를 펼쳐 둔다
    var st = history.state;
    if (st && typeof st === 'object' && st.meFrom === '') {
      history.back(); // popstate → apply
      return;
    }
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch {
      /* 그래도 메뉴를 보인다 */
    }
    apply();
    toTop();
  }

  /** 누름 — 새 탭 · 다른 단추로 누르면 브라우저에 맡긴다 */
  function plainClick(e) {
    return !(e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
  }

  function onHubClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-menu-toggle]') : null;
    if (t) {
      var key = t.getAttribute('data-menu-toggle');
      setOpen(H.open === key ? '' : key, true);
      // 펼친 하위 줄이 위에서 차례로 내려온다
      var M = motion();
      var menu = t.closest('[data-menu]');
      var subs =
        H.open === key && menu ? menu.querySelectorAll('li[data-me-item]:not([hidden])') : [];
      if (M)
        [].forEach.call(subs, function (li, i) {
          M.enter(li, { transform: 'translateY(-6px)', opacity: 0.2 }, i * 28);
        });
      return;
    }
    // 큰 메뉴 이름 — 그 대시보드
    var d = e.target && e.target.closest ? e.target.closest('[data-me-dash]') : null;
    if (d) {
      go('dash-' + d.getAttribute('data-me-dash'));
      return;
    }
    var a = e.target && e.target.closest ? e.target.closest('a[data-me-go]') : null;
    if (!a || !plainClick(e)) return;
    e.preventDefault();
    go(a.getAttribute('data-me-go'));
  }

  /** 하위 화면 안 — 구역 단추 · 대시보드 칸 */
  function onPaneClick(e) {
    var a =
      e.target && e.target.closest ? e.target.closest('a[data-me-part], a[data-me-go]') : null;
    if (!a || !a.closest('#meParts, #meDash') || !plainClick(e)) return;
    e.preventDefault();
    if (a.hasAttribute('data-me-part')) goPart(a.getAttribute('data-me-part'));
    else go(a.getAttribute('data-me-go'));
  }

  function onPop(e) {
    var Shell = window.SeganShell;
    if (Shell && Shell.sheet && Shell.sheet.isSheetState(e && e.state)) return; // 시트 표시 칸 (segan/shell.js)
    apply();
  }

  /** 로그인 안내의 로그인 단추 — 하위 화면 주소(#partner · 알림의 #partner-consults · #as 등)로 왔으면 그 # 로 돌아온다 */
  function keepHashOnGate() {
    var name = askedScreen();
    if (!name) return;
    var a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
    if (a)
      a.setAttribute(
        'href',
        '../login.html?redirect=' + encodeURIComponent('segan/me.html#' + name)
      );
  }

  /**
   * 메뉴 링크 손질 — data-role-link 는 SeganShell.ROLE_LINKS 의 그 key 주소 (플래너 — 한 곳에서 정한다),
   * data-desktop-tab 은 PC 브라우저에서만 새 탭 (플래너 · PC 관리자 화면 — SeganShell.desktopTab)
   */
  function hubLinks() {
    var links = (window.SeganShell && window.SeganShell.ROLE_LINKS) || [];
    document.querySelectorAll('#meHub a[data-role-link]').forEach(function (a) {
      for (var i = 0; i < links.length; i++)
        if (links[i].key === a.getAttribute('data-role-link'))
          a.setAttribute('href', links[i].href);
    });
    linkTargets($('meHub'));
  }

  /** 오늘 작업 — GET /work/me 요약 (js/mypage-work.js 의 건수 · 다음 작업 글) */
  function workLines(me) {
    var W = window.DadamMyPageWork;
    var w = (me && me.worker) || {};
    if (!W) return [];
    if (w.status === 'approved' || w.status === 'suspended') {
      var c = W.summaryCounts(me);
      var lines = [
        '예정 · 진행 ' +
          c.mine +
          '건 · 보완요청 ' +
          c.revision +
          '건 · 새 소식 ' +
          c.newEvents +
          '건' +
          (w.status === 'suspended' ? '' : ' · 모집중 ' + c.open + '건'),
      ];
      if (w.status === 'suspended') lines.push(W.SUSPENDED_NOTE);
      var job = me.next_job;
      var next = TEXT.noJob;
      if (job && typeof job === 'object') next = W.nextJobText(job);
      else if (c.mine > 0) next = TEXT.seeMine;
      lines.push('다음 작업 ' + next);
      return lines;
    }
    if (w.status === 'pending') return [TEXT.pending];
    if (w.status === 'rejected') return [TEXT.rejected];
    return [];
  }

  function renderWork(roles) {
    var card = $('meWork');
    if (!card) return;
    var me = roles && roles.workMe;
    card.hidden = !me;
    if (!me) return;
    var link = (window.SeganShell && window.SeganShell.ROLE_LINKS) || [];
    for (var i = 0; i < link.length; i++)
      if (link[i].group === 'work') card.setAttribute('href', link[i].href);
    try {
      $('meWorkBody').innerHTML = workLines(me)
        .map(function (t) {
          return '<span class="me-work-line">' + esc(t) + '</span>';
        })
        .join('');
    } catch {
      $('meWorkBody').innerHTML = ''; // 모양이 틀린 응답 — 제목 · 링크만
    }
  }

  /**
   * 하위 줄을 보이나 — 화면 줄(data-me-go)은 그 화면을 열 수 있을 때, 페이지 줄은 판정으로.
   * v = viewer(), roles = 셸 판정, ledger = segan/books.js ledgerKind ('book' · 'upload' · '')
   */
  function rowOn(key, v, roles, ledger) {
    var pr = shown('partnerProjects');
    // 견적 ~ 설치 — 단계로 거를 프로젝트를 읽었을 때 (본사 구성원은 업체 프로젝트가 없다)
    var staged = !v.platform && (v.member ? pr : shown('meProjectSection'));
    switch (key) {
      // 프로젝트 관리
      case 'pj-sales':
        return !v.platform && (v.member ? available('p-consult') : true);
      case 'pj-design':
      case 'pj-make':
      case 'pj-install':
        return staged;
      case 'pj-planner': // 설계 화면이 없고 플래너를 쓰면 (본사 · 관리자) — 설계 = 플래너
        return roles.planner === true && !staged;
      case 'pj-as':
        if (v.platform) return false;
        if (!v.member) return shown('meProjectSection') || shown('meAsSection');
        return v.factory ? shown('as') : pr;
      // 구매 · 재고 — 준비 중 (Expert 이상 · 공장)
      case 'stock-board':
      case 'stock-scrap':
      case 'stock-hardware':
        return v.factory && !v.platform;
      // 회계 — 장부를 열면 (본사 대표 · 실장은 본사 장부), 설정 · 영수증 올리기는 업체만
      case 'lg-board':
      case 'lg-sales':
      case 'lg-buys':
      case 'lg-photos':
      case 'lg-report':
        return ledger === 'book';
      case 'lg-settings':
        return ledger === 'book' && !v.platform;
      case 'lg-upload':
        return ledger === 'upload' && !v.platform;
      // 인사 — Agent 대표 · 실장 · 다담 공장
      case 'staff':
        return v.people && available(key);
      case 'assign':
        return (
          v.people &&
          pr &&
          !!(window.SeganPartnerProjects && window.SeganPartnerProjects.canAssign())
        );
      case 'schedule':
        return v.people;
      case 'workers':
        return v.people && !v.hq;
      case 'workers-hq':
        return v.people && v.hq;
      // 플랫폼 › 등록 업체 — 본사 대표 · 실장 (칸을 연 때만)
      case 'companies':
        return v.platform && available(key);
      // 내 계정
      case 'partner':
      case 'likes':
      case 'notify':
        return available(key);
      case 'renders':
      case 'billing':
      case 'activity':
      case 'settings':
        return true;
      default:
        return false;
    }
  }

  /** 관리자 줄 — data-need admin (is_admin) */
  function needOn(need, roles) {
    return need === 'admin' && roles.admin === true;
  }

  /** 메뉴 줄 · 큰 메뉴 · 묶음을 지금 칸 상태에 맞춘다 (모듈이 칸을 열고 닫을 때마다) */
  function sync() {
    if (!H.on) return;
    var v = viewer();
    var roles = H.roles || {};
    var B = window.SeganBooks;
    var ledger = B && B.state ? B.state.ledgerKind : '';
    document.querySelectorAll('#meHub li[data-me-item]').forEach(function (li) {
      var need = li.getAttribute('data-need');
      var key = li.getAttribute('data-me-item');
      li.hidden = !(need ? needOn(need, roles) : rowOn(key, v, roles, ledger));
    });
    // 프로젝트 관리 — 고객에게는 「상담 · 계약」 · 「제작」 (data-customer), 업체 · 본사는 「영업」 · 「생산」
    document.querySelectorAll('#meHub a[data-customer]').forEach(function (a) {
      if (!a.hasAttribute('data-label')) a.setAttribute('data-label', a.textContent);
      a.textContent = a.getAttribute(v.member || v.platform ? 'data-label' : 'data-customer');
    });
    // 내 계정 › 내 팩토리 — 업체 이름, 업체가 없으면 「팩토리로 시작하기」, 신청 중이면 「팩토리 신청」
    var p = partnerOf();
    var label = $('mePartnerLabel');
    if (label)
      label.textContent =
        p.view === 'start'
          ? TEXT.start
          : p.view === 'company' || p.view === 'hidden'
            ? TEXT.factory
            : TEXT.applying;
    var val = $('mePartnerVal');
    if (val)
      val.textContent =
        p.view === 'company' && p.me.company && p.me.company.name ? p.me.company.name : '';
    // 내 정보 — 업체 이름 · 내 역할
    var co = $('meCompany');
    if (co) {
      var t = v.company
        ? [v.company.name, ROLE_NAME[v.role] || ''].filter(Boolean).join(' · ')
        : v.hq
          ? '다담 공장'
          : v.platform
            ? '다담 본사'
            : '';
      co.textContent = t;
      co.hidden = !t;
    }
    // 큰 메뉴 — 보이는 하위 줄이 없으면 감춘다, 묶음도 같게
    document.querySelectorAll('#meHub [data-menu]').forEach(function (m) {
      m.hidden = !m.querySelector('li[data-me-item]:not([hidden])');
    });
    GROUPS.forEach(function (id) {
      var g = $(id);
      if (g) g.hidden = !g.querySelector('[data-menu]:not([hidden])');
    });
    // 업무 머리글 — 업체 · 본사 구성원에게만 (고객은 프로젝트 관리 하나라 머리글 없이)
    var wt = $('meGroupWorkTitle');
    if (wt) wt.hidden = !v.member && !v.platform;
    // 펼칠 큰 메뉴 — 사람이 고르기 전에는 지금 화면이 든 큰 메뉴(없으면 처음 보이는 것), 고른 메뉴가 사라졌으면 처음 것
    var first = document.querySelector('#meHub .me-group:not([hidden]) [data-menu]:not([hidden])');
    var cur = menuEl(H.open);
    if (!H.touched || (H.open && (!cur || cur.hidden))) {
      var here = menuEl(menuOf(askedScreen() || (isWide() ? defaultScreen() : '')));
      H.open =
        here && !here.hidden
          ? here.getAttribute('data-menu')
          : first
            ? first.getAttribute('data-menu')
            : '';
    }
    setOpen(H.open, false);
    apply();
  }

  /** 모듈이 칸을 열고 닫으면(hidden) · 업체 내용을 다시 그리면 메뉴를 맞춘다 */
  function watch() {
    if (typeof MutationObserver !== 'function') return;
    var mo = new MutationObserver(sync);
    SECTIONS.concat(PARTNER_PARTS).forEach(function (id) {
      var el = $(id);
      if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] });
    });
    if ($('mePartner')) mo.observe($('mePartner'), { childList: true });
  }

  /** 로그인 뒤 한 번 — 메뉴를 그리고 주소 · 폭 · 칸 변화를 듣는다 */
  function initHub(auth) {
    H.on = true;
    H.roles = auth.roles || null;
    renderWork(H.roles);
    hubLinks();
    var kept = null;
    try {
      kept = sessionStorage.getItem(OPEN_KEY);
    } catch {
      kept = null;
    }
    H.touched = kept !== null; // 이 탭에서 전에 고른 큰 메뉴 ('' = 모두 접음)
    H.open = kept || '';
    var hub = $('meHub');
    if (hub && !hub.getAttribute('data-bound')) {
      hub.setAttribute('data-bound', '1');
      hub.addEventListener('click', onHubClick);
    }
    var pane = $('mePane');
    if (pane && !pane.getAttribute('data-bound')) {
      pane.setAttribute('data-bound', '1');
      pane.addEventListener('click', onPaneClick);
    }
    if ($('meDash')) $('meDash').hidden = false; // 대시보드 칸은 이 파일이 그린다 (보이기는 me-off 로)
    var back = $('meBack');
    if (back && !back.getAttribute('data-bound')) {
      back.setAttribute('data-bound', '1');
      back.addEventListener('click', backToHub);
    }
    // 손잡이는 하나만 (스크립트를 다시 실어도 겹치지 않게)
    if (window.__seganMeOff) window.__seganMeOff();
    var mq = null;
    try {
      mq = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null;
    } catch {
      mq = null;
    }
    var onWide = function () {
      setOpen(H.open, false);
      apply();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', apply);
    if (mq && mq.addEventListener) mq.addEventListener('change', onWide);
    else if (mq && mq.addListener) mq.addListener(onWide);
    window.__seganMeOff = function () {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', apply);
      if (mq && mq.removeEventListener) mq.removeEventListener('change', onWide);
      else if (mq && mq.removeListener) mq.removeListener(onWide);
    };
    watch();
    sync();
  }

  /** 모듈 하나를 다 읽으면 메뉴를 맞춘다 (상태만 바뀌는 것 — 회계 자격 · 업체 판정) */
  function synced(p) {
    return Promise.resolve(p).then(function (v) {
      sync();
      return v;
    });
  }

  async function start(auth) {
    var Partner = window.SeganPartner;
    if (!auth || !auth.session || !auth.sb || !$('meConsults')) {
      // me.html#partner · #partner-consults · #as 등 → 로그인 뒤 같은 화면
      keepHashOnGate();
      return;
    }
    H.sb = auth.sb;
    H.session = auth.session;
    bindLikes();
    initHub(auth);
    // 크레딧 통장 — 크레딧 줄과 업체 칸이 같은 값을 쓴다 (한 번만 묻는다)
    var M = window.SeganMake;
    var wallet = Promise.resolve(M && M.loadWallet ? M.loadWallet(auth.sb) : null).catch(
      function () {
        return null;
      }
    );
    var partner = Partner && Partner.load ? Partner.load(auth.sb, auth.session, wallet) : null;
    apply(); // 업체 칸이 ?failed=1 을 #partner 로 바꾼 뒤 — 그 화면부터
    var Consults = window.SeganPartnerConsults;
    var Books = window.SeganBooks;
    var Projects = window.SeganPartnerProjects;
    var Cal = window.SeganCalendar;
    var SiteMap = window.SeganSiteMap;
    var Push = window.SeganPush;
    var As = window.SeganAs;
    var Production = window.SeganProduction;
    var Factory = window.SeganFactoryRequests;
    var HqCo = window.SeganHqCompanies;
    var Orders = window.SeganOrders;
    var Plan = window.SeganProductionPlan;
    await Promise.all([
      synced(loadProjects(auth.session)),
      // 내 A/S 접수 — 업체 칸과 상관없다 (segan/as-requests.js)
      synced(As && As.loadMine ? As.loadMine(auth.sb, auth.session) : null),
      // 업체 › 상담 · 회계 · 알림 — 업체 칸이 읽은 /partner/me 로 가린다
      //   상담 = Expert · Agent 업체 · 다담 공장 구성원 (segan/partner-consults.js), 회계 = 대표 · 실장 (segan/books.js),
      //   프로젝트 = 다담 공장 · Manager · Expert · Agent 업체 구성원 (segan/partner-projects.js),
      //   알림 = 업체 구성원 · 본사 · 신청 중 (segan/push.js)
      Promise.resolve(partner).then(function () {
        H.partnerKnown = true;
        sync();
        var me = Partner && Partner.state ? Partner.state.me : null;
        return Promise.all([
          synced(Consults && Consults.load ? Consults.load(auth.sb, auth.session, me) : null),
          synced(Books && Books.load ? Books.load(auth.sb, auth.session, me) : null),
          synced(Projects && Projects.load ? Projects.load(auth.sb, auth.session, me) : null),
          // 수주 · 수금 = 프로젝트를 보는 사람과 같다, 금액은 대표 · 실장 (segan/orders.js — 계약 · 수금 화면)
          synced(Orders && Orders.load ? Orders.load(auth.sb, auth.session, me) : null),
          // 생산 계획 = 다담 공장 구성원 (segan/production-plan.js — 생산 › 생산 계획 화면)
          synced(Plan && Plan.load ? Plan.load(auth.sb, auth.session, me) : null),
          // 업무 달력 = 프로젝트를 보는 사람과 같다 (segan/calendar.js — 프로젝트 관리 대시보드)
          synced(Cal && Cal.load ? Cal.load(auth.sb, auth.session, me) : null),
          // 설치 · A/S 지도 + 표 = 업무 달력 · A/S함을 보는 사람 (segan/site-map.js — 설치 · A/S 화면)
          synced(SiteMap && SiteMap.load ? SiteMap.load(auth.sb, auth.session, me) : null),
          // A/S함 = 다담 공장 · Expert · Agent 구성원 (segan/as-requests.js)
          synced(As && As.load ? As.load(auth.sb, auth.session, me) : null),
          // 제작 의뢰 = Manager 등급 업체 구성원 (segan/production-requests.js),
          // 제작 의뢰함 = 다담 공장 · Expert · Agent 구성원 (segan/factory-requests.js)
          synced(Production && Production.load ? Production.load(auth.sb, auth.session, me) : null),
          synced(Factory && Factory.load ? Factory.load(auth.sb, auth.session, me) : null),
          // 등록 업체 = 다담 본사 구성원 (segan/hq-companies.js — 서버가 대표 · 실장만)
          synced(HqCo && HqCo.load ? HqCo.load(auth.sb, auth.session, me) : null),
          // 작업자도 알림 칸 — 셸의 작업 탭 판정을 그대로 넘긴다
          synced(
            Push && Push.load
              ? Push.load(auth.sb, auth.session, me, {
                  worker: !!(auth.roles && auth.roles.worker),
                })
              : null
          ),
        ]);
      }),
      loadConsults(auth.sb, auth.session),
      loadPlan(auth.sb, auth.session, wallet),
    ]);
    H.loaded = true;
    H.partnerKnown = true;
    sync();
  }

  var api = {
    SCREENS: SCREENS,
    ALIAS: ALIAS,
    SUBS: SUBS,
    MENU_STAGES: MENU_STAGES,
    menuStage: menuStage,
    defOf: defOf,
    viewer: viewer,
    TEXT: TEXT,
    state: H,
    available: available,
    apply: apply,
    CONSULT_STATUS: CONSULT_STATUS,
    SUB_STATUS: SUB_STATUS,
    PROJECT_STAGES: PROJECT_STAGES,
    PROJECT_STATUS: PROJECT_STATUS,
    PAY_STAGE: PAY_STAGE,
    subLabel: subLabel,
    nextPayment: nextPayment,
    likes: LK,
    loadLikes: loadLikes,
    projectHtml: projectHtml,
  };
  window.SeganMe = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
