/* ============================================================
   segan/forward.js — 옛 만들기 주소를 make.html 로 넘긴다

   만들기 화면이 segan/index.html 에서 segan/make.html 로 옮겨 갔다 (index.html 은 홈).
   밖에 남은 옛 주소(공유한 결과 링크 · 즐겨찾기 · 알림)가 끊기지 않게, 홈을 그리기 전에
   주소를 보고 만들기로 바꿔 넘긴다 — 쿼리 · # 은 그대로 들고 간다.

   넘기는 주소 (segan/make.js 가 읽는 것과 같다):
     ?g=<생성 id>                결과 화면
     ?ref=<id> · ?refs=a,b       시공사례 「이 스타일로 연출컷」
     #kind · #refs · #result     만들기 단계 (make.js STEPS — photo 는 # 이 없다)
   하나 더 — 옛 로그인 돌아옴(login.html?redirect=segan/index.html): 로그인 화면에서 왔고
   이 탭에 만들던 사진(sessionStorage segan.make.draft.v1)이 있으면 만들기로 넘긴다.

   쓰는 화면: segan/index.html 머리 (defer 없이 — 그리기 전에 돈다). 다른 화면은 싣지 않는다.
   ============================================================ */
/* global window, document, location, sessionStorage, URLSearchParams */
(function () {
  'use strict';

  var MAKE = 'make.html';
  var KEYS = ['g', 'ref', 'refs'];
  var HASHES = ['kind', 'refs', 'result'];
  var DRAFT_KEY = 'segan.make.draft.v1'; // segan/make.js DRAFT_KEY

  /** 로그인 화면에서 왔나 — 같은 사이트의 login(.html) */
  function fromLogin(referrer, origin) {
    var ref = String(referrer || '');
    if (!ref || ref.indexOf(origin + '/') !== 0) return false;
    return /\/login(\.html)?$/.test(ref.slice(origin.length).split(/[?#]/)[0]);
  }

  /** 담아 둔 글에 만들던 사진이 있나 */
  function hasDraftPhoto(raw) {
    try {
      var d = JSON.parse(raw || 'null');
      return !!(d && d.v === 1 && d.photo);
    } catch {
      return false;
    }
  }

  /**
   * 넘길 주소 — 넘기지 않으면 ''.
   * at = { search, hash, referrer, origin, draft(담아 둔 글 그대로) }
   */
  function target(at) {
    var search = String((at && at.search) || '');
    var hash = String((at && at.hash) || '');
    var q;
    try {
      q = new URLSearchParams(search);
    } catch {
      return '';
    }
    var go =
      KEYS.some(function (k) {
        return q.has(k);
      }) || HASHES.indexOf(hash.replace(/^#/, '')) >= 0;
    if (!go)
      go = fromLogin(at && at.referrer, String((at && at.origin) || '')) && hasDraftPhoto(at.draft);
    return go ? MAKE + search + hash : '';
  }

  function readDraft() {
    try {
      return sessionStorage.getItem(DRAFT_KEY);
    } catch {
      return null;
    }
  }

  var api = { MAKE: MAKE, target: target };
  window.SeganForward = api;

  var to = target({
    search: location.search,
    hash: location.hash,
    referrer: document.referrer,
    origin: location.origin,
    draft: readDraft(),
  });
  if (to) location.replace(to);
})();
