/**
 * 관리자 사이드바 메뉴 — 한 곳에서 관리한다 (work-reports-archive.plan.md PR7).
 *
 * 예전엔 관리자 페이지 11곳이 메뉴를 각자 들고 있어, 메뉴 하나를 더할 때마다 11곳을 고쳤다.
 * 이제 각 페이지는 빈 목록과 이 스크립트만 둔다 (스크립트는 목록 바로 뒤에서 동기로 실행 — 깜빡임 없음):
 *
 *   <ul class="nav-menu" id="adminNav"></ul>
 *   <script src="../js/admin-shell.js"></script>
 *
 * 메뉴를 더하거나 순서를 바꾸려면 ADMIN_NAV 만 고친다. 지금 페이지는 주소의 파일 이름으로 표시한다.
 */
(function () {
  'use strict';

  const ADMIN_NAV = [
    { href: 'index.html', icon: '📊', label: '대시보드' },
    { href: 'management.html', icon: '📈', label: '경영 대시보드' },
    { href: 'users.html', icon: '👥', label: '회원 관리' },
    { href: 'gallery.html', icon: '🖼️', label: '시공사례 관리' },
    { href: 'reference-images.html', icon: '🎨', label: '참고 이미지' },
    { href: 'dataset.html', icon: '🧠', label: '학습 데이터셋' },
    { href: 'expert-requests.html', icon: '⭐', label: 'Expert 승급 관리' },
    { href: 'consultations.html', icon: '💬', label: '상담 관리' },
    { href: 'appliances.html', icon: '🧊', label: '가전 모델 관리' },
    { href: 'work-reports.html', icon: '📑', label: '작업 지시 보고' },
    { href: 'logs.html', icon: '📋', label: '활동 로그' },
    { href: 'settings.html', icon: '⚙️', label: '설정' },
  ];

  /**
   * 주소 → 메뉴 파일 이름. '/admin/' 처럼 끝이 / 면 index.html,
   * '/admin/logs' 처럼 확장자가 없으면(GitHub Pages · serve 의 깔끔한 주소) .html 을 붙인다.
   */
  function currentPage(pathname) {
    const last = String(pathname || '').split('/').pop();
    if (!last) return 'index.html';
    return /\.html?$/i.test(last) ? last : `${last}.html`;
  }

  function render(ul, pathname) {
    if (!ul) return;
    const here = currentPage(pathname);
    ul.innerHTML = '';
    for (const item of ADMIN_NAV) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.href;
      if (item.href === here) {
        a.className = 'active';
        a.setAttribute('aria-current', 'page');
      }
      const icon = document.createElement('span');
      icon.className = 'nav-icon';
      icon.textContent = item.icon;
      a.appendChild(icon);
      a.appendChild(document.createTextNode(item.label));
      li.appendChild(a);
      ul.appendChild(li);
    }
  }

  window.AdminShell = { ADMIN_NAV, currentPage, render };
  render(document.getElementById('adminNav'), window.location.pathname);
})();
