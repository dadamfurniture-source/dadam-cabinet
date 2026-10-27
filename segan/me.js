/* ============================================================
   segan/me.js — 「내 정보」 탭의 상담 내역 · 크레딧 · 구독 (segan/me.html)

   역할 메뉴 · 로그아웃 · 사업자 정보는 segan/shell.js 가 그린다. 여기서는 셋만 채운다 — 모두 기존 출처:
     상담 내역  consultations (본인 — RLS 「Users can view own consultations」), 최신순.
                상태 이름은 admin/consultations.html STATUS_LABELS 와 같다
     크레딧    js/site-shell.js 헤더와 같은 규칙 (user_credits, 없으면 등급 지급량) + credit_costs 로 「생성 N회」
                — segan/make.js 의 loadBalance 를 쓴다
     구독      billing.html 과 같은 payments-api GET /subscription, 등급은 profiles.tier.
                상태 이름은 billing.html STATUS_KO 와 같다. 바꾸기는 billing.html(구독 관리)에서
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

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function day(iso) {
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
  async function loadPlan(sb, session) {
    var tier = 'standard';
    try {
      var p = await sb.from('profiles').select('tier').eq('id', session.user.id).maybeSingle();
      if (p && p.data && p.data.tier) tier = p.data.tier;
    } catch {
      /* 등급을 못 읽으면 standard 로 적는다 (billing.html 과 같다) */
    }
    $('meTier').textContent = tier.toUpperCase();

    var M = window.SeganMake;
    try {
      var left = M && M.loadBalance ? await M.loadBalance(sb, session) : null;
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
      if (!sub || sub.plan === 'free') {
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
    if (!auth || !auth.session || !auth.sb || !$('meConsults')) return;
    await Promise.all([loadConsults(auth.sb, auth.session), loadPlan(auth.sb, auth.session)]);
  }

  var api = { CONSULT_STATUS: CONSULT_STATUS, SUB_STATUS: SUB_STATUS, subLabel: subLabel };
  window.SeganMe = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
