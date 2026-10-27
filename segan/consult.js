/* ============================================================
   segan/consult.js — ④ 상담 신청 (지금은 자리표시)

   만들기 ③ 결과의 「상담 신청」 이 consult.html?g=<연출컷 id> 로 온다.
   id 를 받아 두고(상담 신청서가 붙인다), 결과로 돌아가는 길과 대표 전화를 보인다.
   대표 전화는 segan/shell.js 의 사업자 정보(js/site-shell.js 와 같은 값)에서 읽는다.
   ============================================================ */
/* global window, document, location, URLSearchParams */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function genId() {
    var g = new URLSearchParams(location.search).get('g');
    return g && UUID_RE.test(g) ? g : '';
  }

  function telHref(tel) {
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }

  function init() {
    var id = genId();
    var gen = document.getElementById('csGen');
    if (gen) gen.value = id;
    var back = document.getElementById('csBack');
    if (back) back.setAttribute('href', id ? './?g=' + encodeURIComponent(id) + '#result' : './');
    var tel = document.getElementById('csTel');
    var biz = window.SeganShell && window.SeganShell.BIZ;
    if (tel && biz && biz.tel) {
      tel.setAttribute('href', telHref(biz.tel));
      tel.textContent = '전화 걸기 · ' + biz.tel;
    }
  }

  window.SeganConsult = { genId: genId, telHref: telHref };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
