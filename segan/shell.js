/* ============================================================
   segan/shell.js — SEGAN 앱 셸 공용 스크립트

   서비스 워커 등록 — 범위는 /segan/ 하나뿐이다.
   기존 사이트(루트 · admin)는 서비스 워커를 쓰지 않는다. 이 파일은 segan/ 페이지만 싣는다.
   ============================================================ */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/segan/sw.js', { scope: '/segan/' }).catch(function () {
      // 등록 실패해도 앱은 그대로 쓴다 (오프라인 화면만 없다)
    });
  });
})();
