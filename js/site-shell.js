/* ============================================================
   site-shell.js — v5 공용 헤더·푸터 주입기
   디자인 원본: design_handoff_v5/README.md §A-1, §A-5

   왜 주입기인가:
     내비가 index/collection/material/ai-design 네 파일에 **복제**돼 있었고
     이미 어긋나 있었다 — index 의 Collection 링크는 죽은 `#`, `구독 플랜` 은
     index 에만, 드롭다운 id 는 서로 달랐다. 푸터는 아예 3종이었다.
     한 곳에서 만들면 그 부류의 어긋남이 생길 자리가 없어진다.

   쓰는 법:
     <body class="v5-page">
       <div data-site-shell="header" data-nav="ai"></div>   <!-- ai | collection | material -->
       ...
       <div data-site-shell="footer"></div>
     <script src="js/site-shell.js" defer></script>

   의존: js/config.js · supabase-js · js/detaildesign-access.js · js/admin-access.js
        (없어도 셸은 그려진다 — 로그인 표시만 생략된다)
   ============================================================ */
(function () {
  'use strict';

  // ── 정본 ─────────────────────────────────────────────
  // 링크를 한 곳에만 적는다. 페이지마다 적으면 또 어긋난다.
  var NAV = [
    { key: 'ai', label: 'AI DESIGN', href: 'ai-design.html' },
    { key: 'collection', label: 'COLLECTION', href: 'collection.html' },
    { key: 'material', label: 'MATERIAL', href: 'material.html' },
  ];

  var FOOT_MENU = [
    { label: 'AI Design', href: 'ai-design.html' },
    { label: 'Collection', href: 'collection.html' },
    { label: 'Material', href: 'material.html' },
  ];

  var FOOT_SUPPORT = [
    { label: '자주 묻는 질문', href: 'consultation.html' },
    { label: '이용 약관', href: 'terms.html' },
    { label: '개인정보처리방침', href: 'privacy.html' },
  ];

  // 사업자 정보 — index.html 에 있던 값을 그대로 옮겼다.
  // TODO(사업자): 전화·이메일·주소·등록번호가 전부 플레이스홀더다. 실값 확인 필요.
  var BIZ = {
    desc: '공간을 읽고 가구를 짓습니다. 맞춤 제작 가구의 설계부터 시공까지.',
    tel: '02-1234-5678',
    email: 'info@dadam.com',
    addr: '서울시 강남구 논현동 123-45',
    hours: '평일 09:00 - 18:00',
    copy: '© 2026 다담가구. All rights reserved.',
    biz: '사업자등록번호: 123-45-67890 | 대표: 홍길동',
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── 헤더 ─────────────────────────────────────────────
  function headerHTML(current) {
    var links = NAV.map(function (n) {
      var on = n.key === current;
      return '<a href="' + n.href + '"' + (on ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a>';
    }).join('');

    return (
      '<header class="v5-header">' +
        '<a class="v5-mark" href="index.html" aria-label="다담가구 홈">' +
          '<span class="v5-mark-ko">다담</span>' +
          '<span class="v5-mark-rule" aria-hidden="true"></span>' +
          '<span class="v5-mark-en">FURNITURE</span>' +
        '</a>' +
        '<nav class="v5-nav">' + links + '</nav>' +
        '<div class="v5-header-end">' +
          // 잔여 횟수는 크레딧 API 가 생기기 전까지 감춰 둔다.
          // 자리만 잡아 두면 0 회인지 미구현인지 알 수 없다.
          '<span class="v5-credit" id="shellCredit" hidden></span>' +
          '<span class="v5-sep" id="shellSep" hidden aria-hidden="true"></span>' +
          '<a href="login.html" id="shellLogin">로그인</a>' +
          '<button type="button" id="shellLogout" hidden>로그아웃</button>' +
          '<a href="detaildesign.html" id="navDetailDesign" hidden>DETAIL</a>' +
          '<a href="admin/index.html" id="navAdminLink" hidden>ADMIN</a>' +
        '</div>' +
      '</header>'
    );
  }

  // ── 푸터 ─────────────────────────────────────────────
  function list(items) {
    return '<ul>' + items.map(function (i) {
      return '<li><a href="' + i.href + '">' + esc(i.label) + '</a></li>';
    }).join('') + '</ul>';
  }

  function footerHTML() {
    return (
      '<footer class="v5-footer">' +
        '<div class="v5-footer-in">' +
          '<div>' +
            '<div class="v5-footer-brand">다담가구</div>' +
            '<p class="v5-footer-desc">' + esc(BIZ.desc) + '</p>' +
            '<p class="v5-footer-desc">' +
              esc(BIZ.tel) + '<br>' + esc(BIZ.email) + '<br>' +
              esc(BIZ.addr) + '<br>' + esc(BIZ.hours) +
            '</p>' +
          '</div>' +
          '<div><h3>MENU</h3>' + list(FOOT_MENU) + '</div>' +
          '<div><h3>SUPPORT</h3>' + list(FOOT_SUPPORT) + '</div>' +
        '</div>' +
        '<div class="v5-footer-bottom"><div class="v5-footer-bottom-in">' +
          '<span>' + esc(BIZ.copy) + '</span><span>' + esc(BIZ.biz) + '</span>' +
        '</div></div>' +
      '</footer>'
    );
  }

  // ── 로그인 상태 ───────────────────────────────────────
  // 예전엔 이 로직이 페이지마다 인라인으로 복제돼 있었다. 여기로 흡수한다.
  function client() {
    try {
      if (window.DADAM_CONFIG && window.supabase) {
        return window.supabase.createClient(
          window.DADAM_CONFIG.supabase.url,
          window.DADAM_CONFIG.supabase.anonKey
        );
      }
    } catch (e) { console.warn('[shell] supabase init:', e); }
    return null;
  }

  async function applyAuth() {
    var sb = client();
    if (!sb) return;
    var session = null;
    try {
      var r = await sb.auth.getSession();
      session = r && r.data ? r.data.session : null;
    } catch (e) { return; }

    var login = document.getElementById('shellLogin');
    var logout = document.getElementById('shellLogout');
    if (!session) return;

    if (login) login.hidden = true;
    if (logout) {
      logout.hidden = false;
      logout.onclick = async function () {
        try { await sb.auth.signOut(); } catch (e) {}
        location.reload();
      };
    }

    // 상세설계 탭은 본사 승인 사용자에게만 (기존 정책 그대로)
    try {
      if (window.DetailDesignAccess) {
        await window.DetailDesignAccess.updateNavVisibility(sb, session.user);
      }
    } catch (e) {}
    try {
      if (window.AdminAccess) {
        var isAdmin = await window.AdminAccess.isAdmin(sb);
        window.AdminAccess.updateNavLinks(isAdmin);
      }
    } catch (e) {}

    // 셸이 만든 링크는 hidden 속성을 쓰므로, display 로 토글하는
    // 기존 헬퍼와 둘 다 통하도록 여기서 한 번 더 맞춘다.
    ['navDetailDesign', 'navAdminLink'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.style.display && el.style.display !== 'none') el.hidden = false;
    });

    window.dispatchEvent(new CustomEvent('shell:auth', { detail: { sb: sb, session: session } }));
  }

  // ── 주입 ─────────────────────────────────────────────
  function mount() {
    var slots = document.querySelectorAll('[data-site-shell]');
    if (!slots.length) return;
    slots.forEach(function (slot) {
      var kind = slot.getAttribute('data-site-shell');
      if (kind === 'header') slot.outerHTML = headerHTML(slot.getAttribute('data-nav') || '');
      else if (kind === 'footer') slot.outerHTML = footerHTML();
    });
    applyAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.DadamShell = { NAV: NAV, mount: mount };
})();
