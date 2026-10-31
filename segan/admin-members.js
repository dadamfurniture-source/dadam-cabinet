/* ============================================================
   segan/admin-members.js — 「관리 › 회원」 (segan/admin.html#members, 보기만)

   누가      관리자 — segan/admin.js 가 관리자일 때만 부른다. 읽기는 PC admin/users.html 과 같이 Supabase 표를
             관리자 권한(RLS)으로 바로 읽는다 — 새 서버 주소 · 권한은 없다
   읽는 것    profiles (최근 가입 순 20명, 이름 · 이메일 찾기) + subscriptions · user_credits (그 20명 것만 한 번에)
   화면      회원마다 이름 · 이메일 · 등급(결제로 오른 등급이면 「결제」) · 구독(상태 · 요금제 · 금액) · 크레딧 잔액
             (~ 끝나는 날) · 상세설계 승인 · 지역 · 가입 방법 · 가입일. 등급 바꾸기 · 환불 · 승인 · 지우기는 PC에서.
   이름      구독 상태 · 가입 방법 = admin/users.html SUB_KO · getProviderLabel
   못 읽으면  목록 자리에 한 줄 안내. 구독 · 크레딧만 못 읽으면 그 칸은 「-」 (회원 목록은 그대로)
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  var PAGE_SIZE = 20; // admin/users.html pageSize 와 같다
  var SUB_KO = {
    active: '이용 중',
    cancelled: '해지 예약',
    past_due: '결제 실패',
    expired: '종료',
  }; // admin/users.html
  var PROVIDER_LABEL = { google: 'Google', kakao: 'Kakao', email: 'Email' }; // admin/users.html getProviderLabel
  var PC_PAGE = '../admin/users.html';
  var Q_MAX = 50;
  var TEXT = {
    loadFail: '회원을 불러오지 못했습니다.',
    empty: '맞는 회원이 없습니다.',
  };

  var M = { sb: null, q: '', items: null, subs: {}, credits: {}, busy: false };

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

  /** 한국 시간 'YYYY.MM.DD' */
  function kstDay(iso) {
    var t = Date.parse(iso || '');
    if (isNaN(t)) return '-';
    var k = new Date(t + 9 * 3600 * 1000);
    return k.getUTCFullYear() + '.' + pad(k.getUTCMonth() + 1) + '.' + pad(k.getUTCDate());
  }

  /** 찾는 글 → PostgREST or 거르기 안에 넣어도 되는 글 (쉼표 · 괄호 · 따옴표 · 별표 · 퍼센트는 빈칸) */
  function cleanQuery(q) {
    return String(q || '')
      .replace(/[,()"'*%\\]/g, ' ')
      .trim()
      .slice(0, Q_MAX);
  }

  // ── 판정 (순수 함수 — 시험이 직접 부른다) ─────────────────
  /** 구독 상태 — 해지 뒤 등급까지 내렸으면(ended_at) 「종료」 (admin/users.html 과 같다) */
  function subKey(sub) {
    if (!sub) return '';
    return sub.status === 'cancelled' && sub.ended_at ? 'expired' : sub.status;
  }

  function tierName(tier) {
    var t = tier || 'standard';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function ddText(u) {
    if (u.detaildesign_approved) return '승인됨';
    if (u.detaildesign_requested_at) return '검토중';
    return '미신청';
  }

  // ── 그리기 ─────────────────────────────────────────────
  function fact(label, text) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + esc(text) + '</dd></div>';
  }

  function memberHtml(u) {
    // 구독 · 크레딧을 못 읽었으면(null) 그 칸만 「-」
    var sub = M.subs ? M.subs[u.id] : null;
    var key = subKey(sub);
    var cr = M.credits ? M.credits[u.id] : null;
    var subText = sub
      ? (SUB_KO[key] || key) +
        ' · ' +
        (sub.plan || '-') +
        ' · ' +
        Number(sub.amount_krw || 0).toLocaleString('ko-KR') +
        '원'
      : '-';
    var creditText =
      M.credits === null
        ? '-'
        : cr == null
          ? '미사용'
          : Number(cr.balance).toLocaleString('ko-KR') + ' (~ ' + kstDay(cr.period_end) + ')';
    var provider = u.provider || 'email';
    return (
      '<li class="me-cs-item" data-member="' +
      esc(u.id) +
      '"><div class="me-pt-line"><span class="me-c-main"><b>' +
      esc(u.name || '이름 없음') +
      '</b><small>' +
      esc(u.email || '') +
      '</small></span><span class="ad-status">' +
      esc(tierName(u.tier) + (u.tier_source === 'subscription' ? ' · 결제' : '')) +
      '</span></div><dl class="me-facts">' +
      fact('구독', M.subs === null ? '-' : subText) +
      fact('크레딧', creditText) +
      fact('상세설계', ddText(u)) +
      fact('지역', u.sido && u.gugun ? u.sido + ' ' + u.gugun : '-') +
      fact('가입', (PROVIDER_LABEL[provider] || provider) + ' · ' + kstDay(u.created_at)) +
      '</dl></li>'
    );
  }

  function render() {
    var box = $('adMembersBody');
    if (!box) return;
    var list;
    if (M.items === null)
      list = '<p class="me-pt-msg" role="status">' + esc(TEXT.loadFail) + '</p>';
    else if (!M.items.length) list = '<p class="me-empty">' + esc(TEXT.empty) + '</p>';
    else list = '<ul class="me-cs-list ad-list">' + M.items.map(memberHtml).join('') + '</ul>';
    box.innerHTML =
      '<form class="ad-search" data-form="search" role="search">' +
      '<label class="mk-input"><span>이름 · 이메일 찾기</span><input name="q" type="search" maxlength="' +
      Q_MAX +
      '" autocomplete="off" value="' +
      esc(M.q) +
      '" /></label>' +
      '<div class="rd-acts"><button type="submit" class="mk-btn mk-btn--solid"' +
      (M.busy ? ' disabled' : '') +
      '>찾기</button></div></form>' +
      '<p class="sg-note">' +
      esc(
        M.q
          ? '「' + M.q + '」 찾은 회원 (최근 가입 순 ' + PAGE_SIZE + '명까지)'
          : '최근 가입 ' + PAGE_SIZE + '명'
      ) +
      '</p>' +
      list +
      '<ul class="sg-rows ad-more"><li><a class="sg-row" href="' +
      PC_PAGE +
      '">등급 바꾸기 · 환불 · 상세설계 승인은 PC에서</a></li></ul>';
  }

  // ── 읽기 ───────────────────────────────────────────────
  async function fetchMembers(q) {
    try {
      var query = M.sb
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (q) query = query.or('email.ilike.*' + q + '*,name.ilike.*' + q + '*');
      var r = await query;
      if (!r || r.error || !Array.isArray(r.data)) return null;
      return r.data.filter(function (u) {
        return u && typeof u === 'object' && typeof u.id === 'string' && u.id;
      });
    } catch {
      return null;
    }
  }

  /** 그 회원들의 구독 · 크레딧 — 못 읽으면 null (그 칸만 「-」) */
  async function fetchBilling(ids) {
    if (!ids.length) return [{}, {}];
    var byUser = function (r) {
      if (!r || r.error || !Array.isArray(r.data)) return null;
      var out = {};
      r.data.forEach(function (row) {
        if (row && row.user_id) out[row.user_id] = row;
      });
      return out;
    };
    try {
      var got = await Promise.all([
        M.sb
          .from('subscriptions')
          .select('user_id, plan, status, amount_krw, current_period_end, ended_at')
          .in('user_id', ids),
        M.sb.from('user_credits').select('user_id, balance, period_end').in('user_id', ids),
      ]);
      return [byUser(got[0]), byUser(got[1])];
    } catch {
      return [null, null];
    }
  }

  async function search(q) {
    M.busy = true;
    M.q = q;
    render();
    M.items = await fetchMembers(q);
    var billing = await fetchBilling(
      (M.items || []).map(function (u) {
        return u.id;
      })
    );
    M.subs = billing[0];
    M.credits = billing[1];
    M.busy = false;
    render();
  }

  function onSubmit(e) {
    var form = e.target;
    if (!form || form.getAttribute('data-form') !== 'search') return;
    e.preventDefault();
    if (M.busy) return;
    var input = form.querySelector('input[name="q"]');
    search(cleanQuery(input ? input.value : ''));
  }

  /** 회원 칸 채우기 — admin.js 가 #members 로 올 때 부른다 */
  async function load(sb) {
    var box = $('adMembersBody');
    if (!box || !sb) return;
    M.sb = sb;
    M.busy = false;
    if (!box.getAttribute('data-bound')) {
      box.setAttribute('data-bound', '1');
      box.addEventListener('submit', onSubmit);
    }
    box.innerHTML = '<p class="sg-note">불러오는 중…</p>';
    await search('');
  }

  window.SeganAdminMembers = {
    PAGE_SIZE: PAGE_SIZE,
    SUB_KO: SUB_KO,
    PROVIDER_LABEL: PROVIDER_LABEL,
    state: M,
    subKey: subKey,
    cleanQuery: cleanQuery,
    load: load,
  };
})();
