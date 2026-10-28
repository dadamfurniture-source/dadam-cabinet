/* ============================================================
   segan/me.js — 「내 정보」 탭의 내 프로젝트 · 상담 내역 · 크레딧 · 구독 (segan/me.html)

   역할 메뉴 · 로그아웃 · 사업자 정보는 segan/shell.js 가 그린다. 업체 칸은 segan/partner.js 가 그린다
   (여기서 로그인 뒤 SeganPartner.load 를 부른다). 여기서는 넷을 채운다:
     내 프로젝트 workflow-api GET /me/projects (본인 토큰). 단계 6칸 · 끝난 상태 · 계약 금액 ·
                다음 결제(안 낸 것 중 낼 날이 가장 이른 것 — 워커 payments.js 와 같은 due_on 오름차순 ·
                빈 날 뒤) · 설치일. 수금 단계 이름은 erp.html PAY_STAGE_LABELS · 워커 payments.js 와 같다.
                못 읽으면(오류 · 404 · 주소 없음) 칸째 감춘다 — 가짜 값을 그리지 않는다
     상담 내역  consultations (본인 — RLS 「Users can view own consultations」), 최신순.
                상태 이름은 admin/consultations.html STATUS_LABELS 와 같다
     크레딧    RPC my_credit_wallet (업체 구성원이면 업체 통장, 아니면 내 통장) + credit_costs 로 「생성 N회」
                — segan/make.js 의 loadWallet 을 한 번 불러 업체 칸과 함께 쓴다
     구독      billing.html 과 같은 payments-api GET /subscription, 등급은 profiles.tier.
                상태 이름은 billing.html STATUS_KO 와 같다. 바꾸기는 billing.html(구독 관리)에서.
                업체 실장 · 직원은 구독 칸 없이 company 만 온다 — 「업체 구독은 대표가 관리합니다」
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var CONSULT_STATUS = { pending: '대기', confirmed: '확정', completed: '완료', cancelled: '취소' }; // admin/consultations.html
  var SUB_STATUS = {
    active: '이용 중',
    cancelled: '해지 예약됨',
    past_due: '결제 실패 · 재시도 중',
    expired: '종료됨',
  }; // billing.html
  var LIMIT = 20;

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
      '</li>'
    );
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
      $('meProjects').innerHTML = rows.map(projectHtml).join(''); // 모양이 틀린 행은 던진다 → 칸째 감춘다
      $('meProjectEmpty').hidden = rows.length > 0;
      section.hidden = false;
    } catch {
      section.hidden = true;
    }
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
      var p = await sb.from('profiles').select('tier').eq('id', session.user.id).maybeSingle();
      if (p && p.data && p.data.tier) tier = p.data.tier;
    } catch {
      /* 등급을 못 읽으면 standard 로 적는다 (billing.html 과 같다) */
    }
    $('meTier').textContent = tier.toUpperCase();

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
        $('meSub').textContent = '업체 구독은 대표가 관리합니다';
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

  async function start(auth) {
    var Partner = window.SeganPartner;
    if (!auth || !auth.session || !auth.sb || !$('meConsults')) {
      if (Partner && Partner.keepHashOnGate) Partner.keepHashOnGate(); // me.html#partner → 로그인 뒤 같은 곳
      return;
    }
    // 크레딧 통장 — 크레딧 줄과 업체 칸이 같은 값을 쓴다 (한 번만 묻는다)
    var M = window.SeganMake;
    var wallet = Promise.resolve(M && M.loadWallet ? M.loadWallet(auth.sb) : null).catch(
      function () {
        return null;
      }
    );
    await Promise.all([
      loadProjects(auth.session),
      Partner && Partner.load ? Partner.load(auth.sb, auth.session, wallet) : null,
      loadConsults(auth.sb, auth.session),
      loadPlan(auth.sb, auth.session, wallet),
    ]);
  }

  var api = {
    CONSULT_STATUS: CONSULT_STATUS,
    SUB_STATUS: SUB_STATUS,
    PROJECT_STAGES: PROJECT_STAGES,
    PROJECT_STATUS: PROJECT_STATUS,
    PAY_STAGE: PAY_STAGE,
    subLabel: subLabel,
    nextPayment: nextPayment,
    projectHtml: projectHtml,
  };
  window.SeganMe = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
