/* ============================================================
   segan/renders.js — 「내 연출컷」 탭 (segan/renders.html)

   사이트 my-designs.html 과 같은 데이터 · 같은 호출을 쓴다 (my-designs.html 은 고치지 않는다):
     목록   generations (본인, 내부 확인용 internal_only 제외, 최신순 200개) — 같은 칸 · 같은 거르기
     이미지 js/storage-urls.js signUrls (버킷 generations) — 비공개 버킷도 본인 세션으로 열린다
     진행   진행 중(queued · analyzing · rendering · qc · variants, 12분 안)이면 5초마다 다시 읽는다
     공유   POST /api/generate/:id/share (만들기 · 새로 만들면 예전 링크는 막힌다), DELETE 같은 경로 (중단)
     시공사례 collection_posts (본인 · source ai_render) 가 있으면 「시공사례에서 내리기」:
            행을 먼저 지우고 collection 버킷 파일을 지운다 (my-designs.html 과 같은 순서)
   하나를 열면(renders.html?g=<id>) 컷 · 예상 견적 · 「상담 신청」(④ 단계로 그 연출컷 id) · 공유 · 내리기.
   만들지 못한 연출컷은 크레딧을 돌려드린다는 안내를 붙인다 (워커가 기본안 없이 끝나면 환불한다).

   로그인 · 클라이언트는 segan/shell.js 가 맡는다 (SeganShell.ready 의 sb · session).
   ============================================================ */
/* global window, document, location, history, navigator, fetch, setTimeout, clearTimeout, URLSearchParams */
(function () {
  'use strict';

  var ACTIVE = ['queued', 'analyzing', 'rendering', 'qc', 'variants']; // my-designs.html 과 같다
  var STALE_MS = 12 * 60000; // 12분 넘게 진행 중이면 멈춘 잡으로 본다 (워커와 같은 기준)
  var POLL_MS = 5000;
  var COLUMNS =
    'id,status,progress,step_label,error,category,title,options,quote,images,share_expires_at,share_revoked_at,created_at,completed_at';
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var REFUND_NOTE = '만들지 못한 연출컷의 크레딧은 돌려드립니다.';

  var R = {
    sb: null,
    session: null,
    rows: [],
    posts: {}, // generation id → { id, storage_path }
    open: null, // 열어 둔 연출컷 id
    timer: null,
    shareUrl: '', // 방금 만든 공유 링크 (예전 링크는 다시 볼 수 없다 — 토큰은 해시로만 남는다)
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

  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
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

  function byId(id) {
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].id === id) return R.rows[i];
    return null;
  }

  function msg(text) {
    $('rdMsg').textContent = text || '';
    $('rdMsg').hidden = !text;
  }

  // ── 데이터 ─────────────────────────────────────────────
  async function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try {
      var s = await R.sb.auth.getSession();
      var t = s && s.data && s.data.session && s.data.session.access_token;
      if (t) h.Authorization = 'Bearer ' + t;
    } catch {
      /* 토큰이 없으면 서버가 401 */
    }
    return h;
  }

  function apiBase() {
    var url =
      (window.DADAM_CONFIG &&
        window.DADAM_CONFIG.generateApi &&
        window.DADAM_CONFIG.generateApi.url) ||
      'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate';
    return url.replace(/\/api\/generate\/?$/, '');
  }

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

  /** 시공사례에 자동으로 올라간 내 연출컷 — 못 읽으면 내리기를 그리지 않는다 */
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
      '<button type="button" class="rd-thumb" data-open="' +
      esc(r.id) +
      '" aria-label="' +
      esc(label(r)) +
      ' 열기"' +
      (first ? ' style="background-image:' + esc(cssUrl(first.url)) + '"' : '') +
      '>' +
      badgeHTML(r) +
      '</button>' +
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
    if (R.open) renderDetail();
  }

  // ── 하나 열기 ──────────────────────────────────────────
  function showDetail(id, push) {
    R.open = id;
    R.shareUrl = '';
    msg('');
    $('rdList').hidden = true;
    $('rdDetail').hidden = false;
    try {
      var url = location.pathname + '?g=' + encodeURIComponent(id);
      if (push) history.pushState({ rd: id }, '', url);
      else history.replaceState({ rd: id }, '', url);
    } catch {
      /* noop */
    }
    renderDetail();
    try {
      window.scrollTo(0, 0);
    } catch {
      /* jsdom */
    }
  }

  function showList(push) {
    R.open = null;
    $('rdDetail').hidden = true;
    $('rdList').hidden = false;
    try {
      if (push) history.pushState({}, '', location.pathname);
    } catch {
      /* noop */
    }
  }

  function renderDetail() {
    var r = byId(R.open);
    if (!r) {
      $('rdTitle').textContent = '연출컷을 찾지 못했습니다';
      $('rdSub').textContent = '';
      ['rdShots', 'rdQuoteRows'].forEach(function (id) {
        $(id).innerHTML = '';
      });
      ['rdQuote', 'rdShare', 'rdPost', 'rdProgress', 'rdError'].forEach(function (id) {
        $(id).hidden = true;
      });
      return;
    }
    var done = r.status === 'done';
    $('rdTitle').textContent = label(r);
    $('rdSub').textContent =
      when(r.created_at) +
      (r.images && r.images.length ? ' · 연출컷 ' + r.images.length + '장' : '');
    $('rdProgress').hidden = !isActive(r);
    $('rdProgress').textContent = (r.step_label || '생성 중') + ' · ' + (r.progress || 0) + '%';
    $('rdError').hidden = !isFailed(r);
    $('rdError').textContent = (r.error || '연출컷을 만들지 못했습니다') + ' · ' + REFUND_NOTE;

    $('rdShots').innerHTML = (r.images || [])
      .map(function (im) {
        return (
          '<figure class="rd-shot"><img src="' +
          esc(im.url) +
          '" alt="' +
          esc(im.label || label(r)) +
          '" loading="lazy" /><figcaption>' +
          esc(im.label || '') +
          '</figcaption></figure>'
        );
      })
      .join('');

    // 예상 견적 + 상담 신청 (④ 단계로 이 연출컷 id)
    var q = r.quote;
    $('rdQuote').hidden = !(done && q);
    if (done && q) {
      $('rdQuoteRows').innerHTML = (q.items || [])
        .map(function (it) {
          return (
            '<div class="mk-qrow"><span>' +
            esc(it.name || it.label || '') +
            '</span><span>' +
            won(it.total != null ? it.total : it.price || it.amount) +
            '</span></div>'
          );
        })
        .join('');
      $('rdQuoteTotal').textContent = won(q.total);
      $('rdConsult').setAttribute('href', 'consult.html?g=' + encodeURIComponent(r.id));
    }

    // 공유 — 완료된 것만 (워커도 그렇게 막는다)
    $('rdShare').hidden = !done;
    var shared = isShared(r);
    $('rdShareState').textContent = R.shareUrl
      ? '아래 링크를 보내면 로그인 없이 볼 수 있습니다 · ' + when(r.share_expires_at) + ' 까지'
      : shared
        ? '공유 중 · ' +
          when(r.share_expires_at) +
          ' 까지. 링크를 다시 보려면 새로 만드세요 (예전 링크는 막힙니다).'
        : '링크를 만들면 로그인 없이 이 연출컷을 볼 수 있습니다.';
    $('rdLinkRow').hidden = !R.shareUrl;
    $('rdLink').value = R.shareUrl;
    $('rdShareMake').textContent = shared || R.shareUrl ? '새 링크 만들기' : '공유 링크 만들기';
    $('rdShareStop').hidden = !shared;

    // 시공사례에서 내리기
    $('rdPost').hidden = !R.posts[r.id];
    $('rdUnpostAsk').hidden = true;
    $('rdUnpost').hidden = false;
  }

  // ── 공유 ───────────────────────────────────────────────
  async function makeShare() {
    var r = byId(R.open);
    if (!r || r.status !== 'done') return;
    $('rdShareMake').disabled = true;
    try {
      var res = await fetch(apiBase() + '/api/generate/' + r.id + '/share', {
        method: 'POST',
        headers: await authHeaders(),
        body: '{}',
      });
      var data = await res.json();
      if (!res.ok || !data.share_url)
        throw new Error(data.error || '공유 링크를 만들지 못했습니다');
      R.shareUrl = data.share_url;
      r.share_expires_at = data.expires_at || r.share_expires_at;
      r.share_revoked_at = null;
      msg('');
    } catch (e) {
      msg(e.message || '공유 링크를 만들지 못했습니다');
    }
    $('rdShareMake').disabled = false;
    renderDetail();
    $('rdGrid').innerHTML = R.rows.map(cardHTML).join('');
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(R.shareUrl);
      msg('공유 링크를 복사했습니다');
    } catch {
      $('rdLink').select();
      msg('링크를 길게 눌러 복사해 주세요');
    }
  }

  async function stopShare() {
    var r = byId(R.open);
    if (!r) return;
    $('rdShareStop').disabled = true;
    try {
      var res = await fetch(apiBase() + '/api/generate/' + r.id + '/share', {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || '공유를 중단하지 못했습니다');
      r.share_revoked_at = new Date().toISOString();
      R.shareUrl = '';
      msg('공유를 중단했습니다 — 보낸 링크는 더 이상 열리지 않습니다');
    } catch (e) {
      msg(e.message || '공유를 중단하지 못했습니다');
    }
    $('rdShareStop').disabled = false;
    renderDetail();
    $('rdGrid').innerHTML = R.rows.map(cardHTML).join('');
  }

  // ── 시공사례에서 내리기 (my-designs.html unpost 와 같은 순서) ──
  async function unpost() {
    var r = byId(R.open);
    var post = r && R.posts[r.id];
    if (!post) return;
    $('rdUnpostYes').disabled = true;
    var res = await R.sb.from('collection_posts').delete().eq('id', post.id).select('id');
    $('rdUnpostYes').disabled = false;
    if (res.error || !res.data || !res.data.length) {
      msg('시공사례에서 내리지 못했습니다' + (res.error ? ' — ' + res.error.message : ''));
      return;
    }
    if (post.storage_path) {
      try {
        await R.sb.storage.from('collection').remove([post.storage_path]);
      } catch {
        /* 행은 지웠다 — 파일이 남아도 목록에는 안 보인다 */
      }
    }
    delete R.posts[r.id];
    msg('시공사례에서 내렸습니다');
    render();
  }

  // ── 시작 ───────────────────────────────────────────────
  function bind() {
    $('rdGrid').addEventListener('click', function (e) {
      var b = e.target.closest('[data-open]');
      if (b) showDetail(b.getAttribute('data-open'), true);
    });
    $('rdBack').addEventListener('click', function () {
      showList(true);
    });
    $('rdShareMake').addEventListener('click', makeShare);
    $('rdCopy').addEventListener('click', copyShare);
    $('rdShareStop').addEventListener('click', stopShare);
    $('rdUnpost').addEventListener('click', function () {
      $('rdUnpost').hidden = true;
      $('rdUnpostAsk').hidden = false;
    });
    $('rdUnpostNo').addEventListener('click', function () {
      $('rdUnpost').hidden = false;
      $('rdUnpostAsk').hidden = true;
    });
    $('rdUnpostYes').addEventListener('click', unpost);
    window.addEventListener('popstate', function () {
      var g = new URLSearchParams(location.search).get('g');
      if (g && UUID_RE.test(g)) showDetail(g, false);
      else showList(false);
    });
  }

  async function start(auth) {
    if (!auth || !auth.session || !auth.sb || !$('rdGrid')) return;
    R.sb = auth.sb;
    R.session = auth.session;
    bind();
    await load(false);
    var g = new URLSearchParams(location.search).get('g');
    if (g && UUID_RE.test(g)) showDetail(g, false);
  }

  var api = { state: R, load: load, REFUND_NOTE: REFUND_NOTE };
  window.SeganRenders = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
