/**
 * 페이지 전환 부드럽게 처리 (fade-out → 이동 → fade-in)
 * + 네비게이션 링크 prefetch
 */
(function () {
  // ── Prefetch: nav 링크 페이지를 미리 로드 ──
  document.addEventListener('DOMContentLoaded', function () {
    var links = document.querySelectorAll('.nav-menu a[href], .mobile-menu a[href]');
    var seen = {};
    links.forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || href === '#' || href.startsWith('javascript') || seen[href]) return;
      seen[href] = true;
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = href;
      document.head.appendChild(link);
    });
  });

  // ── Fade-out: 내부 링크 클릭 시 fade-out 후 이동 ──
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href]');
    if (!a) return;

    var href = a.getAttribute('href');
    // 외부 링크, 앵커, 빈 링크는 무시
    if (!href || href === '#' || href.startsWith('http') || href.startsWith('javascript') || href.startsWith('mailto') || href.startsWith('tel')) return;
    // 새 탭 열기는 무시
    if (a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return;

    e.preventDefault();
    document.body.style.transition = 'opacity 0.1s ease-out';
    document.body.style.opacity = '0';

    setTimeout(function () {
      window.location.href = href;
    }, 100);
  });
})();
