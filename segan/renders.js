/* ============================================================
   segan/renders.js — 「내 연출컷」 탭 (segan/renders.html) — 목록만

   사이트 my-designs.html 과 같은 데이터 · 같은 호출을 쓴다 (my-designs.html 은 고치지 않는다):
     목록   generations (본인, 내부 확인용 internal_only 제외, 최신순 200개) — 같은 칸 · 같은 거르기
     이미지 js/storage-urls.js signUrls (버킷 generations) — 비공개 버킷도 본인 세션으로 열린다
     진행   진행 중(queued · analyzing · rendering · qc · variants, 12분 안)이면 5초마다 다시 읽는다
     시공사례 collection_posts (본인 · source ai_render) 가 있으면 카드에 「시공사례」 표시
   하나를 누르면 만들기 ③ 결과 화면(./?g=<id>#result)으로 간다 — 연출컷 결과 화면은 그것 하나다.
   컷 · 예상 견적 · 「상담 신청」 · 공유 링크 · 시공사례에서 내리기 · 학습 동의 · 다시 생성 · 삭제는
   그 화면(segan/make.js)에 있다.
   옛 「하나 열기」 주소(renders.html?g=<id>)는 목록을 그리기 전에 그 결과 주소로 넘긴다.
   만들지 못한 연출컷은 크레딧을 돌려드린다는 안내를 붙인다 (워커가 기본안 없이 끝나면 환불한다).

   로그인 · 클라이언트는 segan/shell.js 가 맡는다 (SeganShell.ready 의 sb · session).
   ============================================================ */
/* global window, document, location, setTimeout, clearTimeout, URLSearchParams */
(function () {
  'use strict';

  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** 연출컷 결과 화면 — 만들기 ③ (segan/index.html) */
  function resultHref(id) {
    return './?g=' + encodeURIComponent(id) + '#result';
  }

  // 옛 「하나 열기」 주소 — 기록 칸을 바꿔 넘긴다 (뒤로 가기가 다시 여기로 오지 않게)
  var oldId = new URLSearchParams(location.search).get('g');
  if (oldId && UUID_RE.test(oldId)) {
    location.replace(resultHref(oldId));
    return;
  }

  var ACTIVE = ['queued', 'analyzing', 'rendering', 'qc', 'variants']; // my-designs.html 과 같다
  var STALE_MS = 12 * 60000; // 12분 넘게 진행 중이면 멈춘 잡으로 본다 (워커와 같은 기준)
  var POLL_MS = 5000;
  // 목록 카드가 쓰는 칸만 (견적 · 학습 동의 · 설정은 결과 화면이 읽는다)
  var COLUMNS =
    'id,status,progress,step_label,category,title,images,share_expires_at,share_revoked_at,created_at';
  var REFUND_NOTE = '만들지 못한 연출컷의 크레딧은 돌려드립니다.';

  var R = {
    sb: null,
    session: null,
    rows: [],
    posts: {}, // generation id → { id, storage_path }
    timer: null,
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cssUrl(u) {
    return 'url("' + String(u || '').replace(/["\\\n\r()]/g, encodeURIComponent) + '")';
  }

  function when(iso) {
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

  function kindLabel(category) {
    var K = (window.SeganMake && window.SeganMake.KINDS) || [];
    for (var i = 0; i < K.length; i++) if (K[i].key === category) return K[i].label;
    return category || '가구';
  }

  function label(r) {
    return r.title || kindLabel(r.category) + ' 연출컷';
  }

  function isActive(r) {
    return (
      ACTIVE.indexOf(r.status) >= 0 && Date.now() - new Date(r.created_at).getTime() < STALE_MS
    );
  }

  function isFailed(r) {
    return r.status === 'failed' || (ACTIVE.indexOf(r.status) >= 0 && !isActive(r));
  }

  function isShared(r) {
    return !!(
      r.share_expires_at &&
      !r.share_revoked_at &&
      new Date(r.share_expires_at) > new Date()
    );
  }

  // ── 데이터 ─────────────────────────────────────────────
  /** 이미지 url → 서명 URL (my-designs.html signImages 와 같다). 화면 값만 바꾼다 */
  async function signImages(list) {
    var U = window.DadamStorageUrls;
    if (!U) return;
    var ims = [];
    list.forEach(function (r) {
      (r.images || []).forEach(function (im) {
        if (im) ims.push(im);
      });
    });
    if (!ims.length) return;
    var urls = await U.signUrls(
      R.sb,
      ims.map(function (im) {
        return im.url || im.path;
      }),
      { bucket: 'generations' }
    );
    ims.forEach(function (im, i) {
      im.url = urls[i];
    });
  }

  /** 시공사례에 자동으로 올라간 내 연출컷 — 못 읽으면 표시를 그리지 않는다 */
  async function loadPosts() {
    try {
      var res = await R.sb
        .from('collection_posts')
        .select('id, generation_id, storage_path')
        .eq('user_id', R.session.user.id)
        .eq('source', 'ai_render');
      if (res.error) throw res.error;
      var map = {};
      (res.data || []).forEach(function (p) {
        if (p.generation_id) map[p.generation_id] = p;
      });
      R.posts = map;
    } catch {
      R.posts = {};
    }
  }

  async function load(silent) {
    if (!silent) $('rdState').textContent = '불러오는 중';
    var res = await R.sb
      .from('generations')
      .select(COLUMNS)
      .eq('user_id', R.session.user.id)
      // 내부 확인용(options.internal_only)은 내지 않는다 — my-designs.html 과 같은 거르기
      .or('options->>internal_only.is.null,options->>internal_only.neq.true')
      .order('created_at', { ascending: false })
      .limit(200);
    if (res.error) {
      $('rdState').textContent = '불러오지 못했습니다 — ' + res.error.message;
      return;
    }
    R.rows = res.data || [];
    await signImages(R.rows);
    await loadPosts();
    $('rdState').textContent = R.rows.length ? R.rows.length + '건' : '';
    render();
    clearTimeout(R.timer);
    if (R.rows.some(isActive)) {
      R.timer = setTimeout(function () {
        load(true);
      }, POLL_MS);
    }
  }

  // ── 목록 ───────────────────────────────────────────────
  function badgeHTML(r) {
    if (isActive(r))
      return (
        '<span class="rd-badge">' +
        esc(r.step_label || '생성 중') +
        ' · ' +
        (r.progress || 0) +
        '%</span>'
      );
    if (isFailed(r)) return '<span class="rd-badge rd-badge--fail">실패</span>';
    if (r.status === 'done' && r.images && r.images.length < 4)
      return '<span class="rd-badge">' + r.images.length + ' / 4</span>';
    return '';
  }

  function cardHTML(r) {
    var first = r.images && r.images[0];
    return (
      '<article class="rd-card">' +
      '<a class="rd-thumb" href="' +
      esc(resultHref(r.id)) +
      '" data-id="' +
      esc(r.id) +
      '" aria-label="' +
      esc(label(r)) +
      ' 열기"' +
      (first ? ' style="background-image:' + esc(cssUrl(first.url)) + '"' : '') +
      '>' +
      badgeHTML(r) +
      '</a>' +
      '<div class="rd-cap"><b>' +
      esc(label(r)) +
      '</b><span>' +
      esc(when(r.created_at)) +
      (isShared(r) ? ' · 공유 중' : '') +
      (R.posts[r.id] ? ' · 시공사례' : '') +
      '</span>' +
      (isFailed(r) ? '<span class="rd-fail-note">' + esc(REFUND_NOTE) + '</span>' : '') +
      '</div></article>'
    );
  }

  function render() {
    $('rdGrid').innerHTML = R.rows.map(cardHTML).join('');
    $('rdEmpty').hidden = R.rows.length > 0;
  }

  // ── 시작 ───────────────────────────────────────────────
  async function start(auth) {
    if (!auth || !auth.session || !auth.sb || !$('rdGrid')) return;
    R.sb = auth.sb;
    R.session = auth.session;
    await load(false);
  }

  var api = {
    state: R,
    load: load,
    resultHref: resultHref,
    REFUND_NOTE: REFUND_NOTE,
  };
  window.SeganRenders = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
