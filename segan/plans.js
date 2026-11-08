/* ============================================================
   segan/plans.js — 「구독」 (segan/plans.html) — 등급 넷 비교

   등급 · 도구 목록은 plans.html 에 적혀 있다 (검색 · 스크립트 없이도 보인다). 이 파일은 숫자만 채운다:
     이름 · 월 금액   payments-api GET /plans  { data: { plans: [{ id, name, price_krw }] } }
                      (segan/partner.js · billing.js 와 같은 주소 — DADAM_CONFIG.paymentsApi.url)
     월 크레딧        credit_plans (tier → monthly_credits) — partner.js 와 같은 표
     연출컷 횟수      credit_costs (action generate) — 한 번 만드는 데 드는 크레딧으로 나눈다 — make.js · pricing.html 과 같은 출처
   금액 · 크레딧을 이 파일에 적어 두지 않는다. /plans 를 못 읽으면(또는 등급 하나라도 금액이 없으면)
   금액 없이 표만 두고 「가격을 불러오지 못했습니다」를 알린다. 크레딧을 못 읽으면 그 줄만 비운다.
   Standard 는 결제 대상이 아니라 /plans 에 없다 — 「무료」는 plans.html 에 적혀 있다.

   가입 단추: Manager · Expert 「결제하고 시작」, Agent 「신청하기」 — 모두 me.html#partner
   (결제 · 신청 흐름은 마이페이지 팩토리 칸 segan/partner.js. 로그인이 없으면 그 화면의 로그인 안내가
   돌아올 곳에 #partner 를 붙인다 — partner.js keepHashOnGate).
   ============================================================ */
/* global window, document, fetch */
(function () {
  'use strict';

  var PAID = ['manager', 'expert', 'agent'];
  var TIERS = ['standard'].concat(PAID);
  var SIGNUP = 'me.html#partner';
  var PRICE_FAIL = '가격을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.';

  var $ = function (id) {
    return document.getElementById(id);
  };

  function num(n) {
    return Number(n).toLocaleString('ko-KR');
  }

  /** 월 금액 글 — 숫자가 아니면 '' (지어내지 않는다) */
  function priceText(price) {
    return typeof price === 'number' && isFinite(price) && price >= 0
      ? '월 ' + num(price) + '원'
      : '';
  }

  /** 「월 N 크레딧 · 연출컷 M회」 — 크레딧을 모르면 '', 한 번 드는 크레딧을 모르면 크레딧만 */
  function creditText(credits, cost) {
    if (typeof credits !== 'number' || !isFinite(credits) || credits < 0) return '';
    var line = '월 ' + num(credits) + ' 크레딧';
    if (typeof cost === 'number' && cost > 0)
      line += ' · 연출컷 ' + num(Math.floor(credits / cost)) + '회';
    return line;
  }

  function config() {
    return window.DADAM_CONFIG || {};
  }

  /** GET /plans → [{ id, name, price_krw }] · 못 읽으면 null */
  async function loadPlans() {
    var base = (config().paymentsApi && config().paymentsApi.url) || '';
    if (!base) return null;
    try {
      var res = await fetch(base + '/plans');
      var body = await res.json();
      var list = res.ok && body && body.data && body.data.plans;
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  }

  function client() {
    try {
      var cfg = config();
      if (cfg.supabase && window.supabase) {
        return window.supabase.createClient(cfg.supabase.url, cfg.supabase.anonKey);
      }
    } catch {
      /* 크레딧 줄만 비운다 */
    }
    return null;
  }

  /** credit_plans · credit_costs — { credits: { tier: n }, cost } · 못 읽은 것은 빈 값 */
  async function loadCredits() {
    var out = { credits: {}, cost: null };
    var sb = client();
    if (!sb) return out;
    try {
      var r = await sb.from('credit_plans').select('tier, monthly_credits');
      (Array.isArray(r && r.data) ? r.data : []).forEach(function (x) {
        if (x && x.tier) out.credits[x.tier] = x.monthly_credits;
      });
    } catch {
      /* 크레딧 줄만 비운다 */
    }
    try {
      var c = await sb
        .from('credit_costs')
        .select('credits')
        .eq('action', 'generate')
        .maybeSingle();
      if (c && c.data && typeof c.data.credits === 'number') out.cost = c.data.credits;
    } catch {
      /* 횟수만 뺀다 */
    }
    return out;
  }

  function slot(attr, tier) {
    return document.querySelector('[' + attr + '="' + tier + '"]');
  }

  /** 받은 값으로 칸을 채운다 — plans 가 null 이면 금액 없이 */
  function render(plans, got) {
    var byId = {};
    (plans || []).forEach(function (p) {
      if (p && typeof p.id === 'string') byId[p.id] = p;
    });
    var missing = false;
    PAID.forEach(function (tier) {
      var p = byId[tier];
      var name = slot('data-name', tier);
      if (name && p && typeof p.name === 'string' && p.name.trim())
        name.textContent = p.name.trim();
      var text = priceText(p && p.price_krw);
      var price = slot('data-price', tier);
      if (price) price.textContent = text;
      if (!text) missing = true;
    });
    TIERS.forEach(function (tier) {
      var c = slot('data-credit', tier);
      if (c) c.textContent = creditText(got.credits[tier], got.cost);
    });
    document.querySelectorAll('[data-signup]').forEach(function (a) {
      a.setAttribute('href', SIGNUP);
    });
    var state = $('plState');
    if (state) state.textContent = missing ? PRICE_FAIL : '';
    return { missing: missing };
  }

  async function start() {
    if (!$('plTiers')) return null;
    var got = await Promise.all([loadPlans(), loadCredits()]);
    return render(got[0], got[1]);
  }

  var api = {
    PAID: PAID,
    SIGNUP: SIGNUP,
    PRICE_FAIL: PRICE_FAIL,
    priceText: priceText,
    creditText: creditText,
    render: render,
  };
  window.SeganPlans = api;
  api.ready = new Promise(function (resolve) {
    var go = function () {
      start().then(resolve, function () {
        resolve(null);
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  });
})();
