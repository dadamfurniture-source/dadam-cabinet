/* ============================================================
   segan/theme-images-view.js — 마이페이지 관리 › 기준정보 › 「참고 이미지」 (segan/me.html #themeImages, 주소 #ref-images)

   PC 화면 admin/reference-images.html(연출컷 「테마」 탭의 참고 이미지 관리)의 「보기 · 찾기」만 마이페이지 안으로 옮긴 것.
   (마이페이지 B안 4단계 — 2026-11-11 대표님 결정: 남은 관리 화면은 앱에서 보기 · 찾기만.
    업로드 · 추천 불러오기 · 확정 · 거절 · 숨기기 · 수정 · 삭제는 PC 화면에 그대로 — 이 화면 아래 링크로 간다)

   누가 보나  사이트 관리자(is_admin — 셸 판정 roles.admin)만. segan/me.js 가 업체 칸을 읽은 뒤
             SeganThemeImagesView.load(sb, session, partnerMe, { admin }) 를 부른다. 관리자가 아니면 칸을 열지 않는다.
   데이터    Supabase 표 theme_images (PC 화면과 같은 조회 — 새 것부터 많아야 5000줄, 읽기만)
               .from('theme_images').select('*').order('created_at', { ascending: false }).range(0, 4999)
             화면을 실제로 열었을 때 처음 읽는다(마이페이지를 열 때마다 읽지 않는다).
   화면      상태 단추 셋(사용 중 · 검토 대기 · 거절됨 — 장수) · 테마 고르기 → 몇 장 → 사진 칸
             (테마 · 제목 · 설명 · 라이선스 · 만든이 · 출처 링크 · 숨김 / 무채색 / 업로드 표시) → 「더 보기」.
   사진      사용 중(확정)인 사진만 그린다 — 우리 Storage(버킷 theme-images)의 썸네일. 검토 대기 · 거절됨은
             바깥 사이트의 미리보기라 그리지 않고 글로만 적는다 (바깥 서버에 요청을 보내지 않는다).
   못 읽으면  그 자리에 글 + 「다시 읽기」.
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  var BUCKET = 'theme-images'; // js/reference-images.js BUCKET
  // 테마 — js/reference-images.js THEMES (키는 DB 의 theme 값). 새로 만든 테마는 이름 그대로 나온다
  var THEMES = [
    ['animal', '동물'],
    ['flower', '꽃'],
    ['nature', '자연'],
    ['product', '제품'],
    ['painting', '회화'],
    ['ai', 'AI 디자인'],
  ];
  // 상태 — admin/reference-images.html 탭 차례 그대로
  var STATUSES = [
    ['approved', '사용 중'],
    ['pending', '검토 대기'],
    ['rejected', '거절됨'],
  ];
  var GRAY_BELOW = 0.18; // 이보다 채도가 낮으면 「무채색」 (js/reference-images.js colorfulnessFromRGBA)
  var PC_PAGE = '../admin/reference-images.html';
  var HASH = '#ref-images';
  var PAGE = 30;
  var MAX_ROWS = 5000;

  var TEXT = {
    title: '참고 이미지',
    lead: '연출컷 「테마」 탭에서 고르는 참고 이미지 목록입니다. 상태와 테마로 거릅니다. 여기서는 보기만 합니다.',
    status: '상태',
    theme: '테마',
    themeAll: '전체 테마',
    loading: '불러오는 중…',
    fail: '불러오지 못했습니다.',
    retry: '다시 읽기',
    count: '장',
    shown: '보이는',
    all: '전체',
    more: '더 보기',
    left: '남은',
    hidden: '숨김',
    gray: '무채색',
    upload: '업로드',
    source: '출처',
    photo: '참고 이미지',
    noPhoto: '사진은 확정한 뒤 우리 저장소에 들어옵니다',
    emptyApproved: '아직 사용 중인 사진이 없습니다.',
    emptyPending: '검토할 추천이 없습니다.',
    emptyRejected: '거절한 사진이 없습니다.',
    pc: '업로드 · 추천 확정 · 거절 · 숨기기 · 수정 · 삭제는 PC 관리 화면에서 합니다',
    pcLink: 'PC 참고 이미지 관리 열기',
  };

  var T = {
    sb: null,
    ready: false,
    rows: null, // 읽은 줄 (null = 아직)
    failed: '',
    busy: false,
    status: STATUSES[0][0],
    theme: '',
    shown: PAGE,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function str(v) {
    return typeof v === 'string' ? v : '';
  }

  /** 화면에 넣는 주소는 https 만 — 파일에서 온 값이라 javascript: 같은 것을 막는다 */
  function safeUrl(u) {
    return /^https:\/\//.test(str(u)) ? u : '';
  }

  function isStatus(k) {
    return STATUSES.some(function (s) {
      return s[0] === k;
    });
  }

  /** 테마 이름 — 기본 여섯은 한글 이름, 새 테마는 키 그대로 */
  function themeLabel(key) {
    var t = THEMES.filter(function (x) {
      return x[0] === key;
    })[0];
    return t ? t[1] : String(key || '');
  }

  /** 서버가 준 줄 하나 — id 가 없거나 모르는 상태면 버린다 */
  function rowOf(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    var id = typeof v.id === 'string' || typeof v.id === 'number' ? String(v.id) : '';
    if (!id || !isStatus(v.status)) return null;
    return {
      id: id,
      status: v.status,
      theme: str(v.theme).trim(),
      title: str(v.title).trim(),
      note: str(v.note).trim(),
      license: str(v.license).trim(),
      author: str(v.author).trim(),
      sourcePage: safeUrl(v.source_page),
      thumbPath: str(v.thumb_path),
      active: v.is_active !== false,
      gray: typeof v.colorfulness === 'number' && v.colorfulness < GRAY_BELOW,
      upload: v.source === 'upload',
    };
  }

  /** 상태마다 몇 장 */
  function counts(rows) {
    var n = {};
    STATUSES.forEach(function (s) {
      n[s[0]] = 0;
    });
    rows.forEach(function (r) {
      n[r.status] += 1;
    });
    return n;
  }

  /** 테마 선택지 — 기본 여섯 + DB 에 있는 새 테마 (나온 차례) */
  function themeKeys(rows) {
    var keys = THEMES.map(function (t) {
      return t[0];
    });
    rows.forEach(function (r) {
      if (r.theme && keys.indexOf(r.theme) < 0) keys.push(r.theme);
    });
    return keys;
  }

  /** 지금 상태 · 테마에 드는 줄 */
  function visible(rows, status, theme) {
    return rows.filter(function (r) {
      return r.status === status && (!theme || r.theme === theme);
    });
  }

  /** 사용 중인 사진의 썸네일 공개 주소 — 설정이 없거나 확정 전이면 빈 글 */
  function thumbUrl(r) {
    var conf = window.DADAM_CONFIG && window.DADAM_CONFIG.supabase;
    var base = conf && conf.url ? String(conf.url).replace(/\/+$/, '') : '';
    if (!base || r.status !== 'approved' || !r.thumbPath) return '';
    return (
      base +
      '/storage/v1/object/public/' +
      BUCKET +
      '/' +
      r.thumbPath.split('/').map(encodeURIComponent).join('/')
    );
  }

  /** 표시 — 숨김(사용 중인데 끔) · 무채색 · 업로드 */
  function badgesOf(r) {
    var out = [];
    if (r.status === 'approved' && !r.active) out.push(TEXT.hidden);
    if (r.gray) out.push(TEXT.gray);
    if (r.upload) out.push(TEXT.upload);
    return out;
  }

  function countText(shownCount, total) {
    return shownCount < total
      ? TEXT.shown + ' ' + shownCount + TEXT.count + ' / ' + TEXT.all + ' ' + total + TEXT.count
      : total + TEXT.count;
  }

  function emptyText(status) {
    return status === 'pending'
      ? TEXT.emptyPending
      : status === 'rejected'
        ? TEXT.emptyRejected
        : TEXT.emptyApproved;
  }

  function sec() {
    return $('themeImages');
  }

  function box() {
    return $('themeImagesBody');
  }

  // ── 그리기 ─────────────────────────────────────────────
  function tabsHtml() {
    var n = T.rows ? counts(T.rows) : null;
    return (
      '<div class="al-cats" role="group" aria-label="' +
      esc(TEXT.status) +
      '">' +
      STATUSES.map(function (s) {
        return (
          '<button type="button" class="mk-btn dr-day al-cat" data-act="status" data-status="' +
          s[0] +
          '" aria-pressed="' +
          (T.status === s[0] ? 'true' : 'false') +
          '"' +
          (T.busy ? ' disabled' : '') +
          '>' +
          esc(s[1] + (n ? ' ' + n[s[0]] : '')) +
          '</button>'
        );
      }).join('') +
      '</div>'
    );
  }

  function toolsHtml() {
    var keys = themeKeys(T.rows || []);
    return (
      '<div class="al-tools"><label class="mk-input al-field" for="tvTheme"><span>' +
      esc(TEXT.theme) +
      '</span><select id="tvTheme"' +
      (T.busy ? ' disabled' : '') +
      '><option value="">' +
      esc(TEXT.themeAll) +
      '</option>' +
      keys
        .map(function (k) {
          return (
            '<option value="' +
            esc(k) +
            '"' +
            (T.theme === k ? ' selected' : '') +
            '>' +
            esc(themeLabel(k)) +
            '</option>'
          );
        })
        .join('') +
      '</select></label></div>'
    );
  }

  function tileHtml(r, i) {
    var url = thumbUrl(r);
    var name = themeLabel(r.theme) || '-';
    var meta = [r.license, r.author].filter(Boolean).join(' · ');
    return (
      '<li class="gv-tile tv-tile' +
      (r.status === 'approved' && !r.active ? ' tv-off' : '') +
      '" data-tv-row="' +
      esc(r.id) +
      '">' +
      (url
        ? '<span class="tv-pic"><img src="' +
          esc(url) +
          '" alt="' +
          esc((r.title || name) + ' ' + TEXT.photo + ' ' + (i + 1)) +
          '" loading="lazy" decoding="async" width="160" height="160"></span>'
        : '<span class="tv-pic tv-nopic">' + esc(TEXT.noPhoto) + '</span>') +
      '<p class="gv-cap"><b>' +
      esc(name) +
      '</b>' +
      badgesOf(r)
        .map(function (b) {
          return ' <span class="me-badge gv-badge">' + esc(b) + '</span>';
        })
        .join('') +
      (r.title ? '<small class="tv-title">' + esc(r.title) + '</small>' : '') +
      (r.note ? '<small>' + esc(r.note) + '</small>' : '') +
      (meta || r.sourcePage
        ? '<small>' +
          esc(meta) +
          (r.sourcePage
            ? (meta ? ' · ' : '') +
              '<a class="mk-link" href="' +
              esc(r.sourcePage) +
              '" target="_blank" rel="noopener noreferrer">' +
              esc(TEXT.source) +
              '</a>'
            : '') +
          '</small>'
        : '') +
      '</p></li>'
    );
  }

  function listHtml() {
    if (T.failed)
      return (
        '<p class="mk-error" data-tv="failed" role="alert">' +
        esc(T.failed) +
        '</p><button type="button" class="mk-btn" data-act="retry"' +
        (T.busy ? ' disabled' : '') +
        '>' +
        esc(TEXT.retry) +
        '</button>'
      );
    if (!T.rows)
      return '<p class="mk-note" data-tv="loading" role="status">' + esc(TEXT.loading) + '</p>';
    var list = visible(T.rows, T.status, T.theme);
    var head =
      '<p class="me-pt-msg dr-status" data-tv="count" role="status">' +
      esc(countText(Math.min(T.shown, list.length), list.length)) +
      '</p>';
    if (!list.length)
      return head + '<p class="me-empty" data-tv="empty">' + esc(emptyText(T.status)) + '</p>';
    var left = list.length - T.shown;
    return (
      head +
      '<ul class="gv-grid">' +
      list.slice(0, T.shown).map(tileHtml).join('') +
      '</ul>' +
      (left > 0
        ? '<button type="button" class="mk-btn al-more" data-act="more">' +
          esc(TEXT.more + ' (' + TEXT.left + ' ' + left + TEXT.count + ')') +
          '</button>'
        : '')
    );
  }

  function pcHtml() {
    return (
      '<p class="mk-note al-pc">' +
      esc(TEXT.pc) +
      ' — <a class="mk-link" data-tv="pc" href="' +
      PC_PAGE +
      '" data-desktop-tab>' +
      esc(TEXT.pcLink) +
      '</a></p>'
    );
  }

  function render() {
    var b = box();
    var s = sec();
    if (!b || !s || !T.ready) return;
    b.innerHTML =
      '<p class="mk-note">' +
      esc(TEXT.lead) +
      '</p>' +
      tabsHtml() +
      toolsHtml() +
      listHtml() +
      pcHtml();
    if (T.busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
    s.hidden = false;
  }

  function focusOn(sel) {
    var b = box();
    var el = b && b.querySelector(sel);
    if (el && el.focus) el.focus();
  }

  function hide() {
    var b = box();
    var s = sec();
    if (b) {
      b.innerHTML = '';
      b.removeAttribute('aria-busy');
    }
    if (s) s.hidden = true;
    T.ready = false;
  }

  // ── 읽기 ───────────────────────────────────────────────
  async function fetchRows(back) {
    if (!T.ready || T.busy || !T.sb) return;
    T.busy = true;
    T.failed = '';
    T.rows = null;
    render();
    var rows = null;
    var message = '';
    try {
      var res = await T.sb
        .from('theme_images')
        .select('*')
        .order('created_at', { ascending: false })
        .range(0, MAX_ROWS - 1);
      if (res && !res.error && Array.isArray(res.data)) rows = res.data.map(rowOf).filter(Boolean);
      else message = (res && res.error && str(res.error.message)) || '';
    } catch {
      rows = null;
    }
    T.busy = false;
    if (rows) {
      T.rows = rows;
      // 고르던 테마가 사라졌으면 전체로
      if (T.theme && themeKeys(rows).indexOf(T.theme) < 0) T.theme = '';
    } else T.failed = message ? TEXT.fail + ' (' + message + ')' : TEXT.fail;
    render();
    if (back) focusOn(back);
  }

  /** 화면이 열려 있으면 처음 한 번 읽는다 — 마이페이지를 열 때마다 읽지 않으려고 주소로 가린다 */
  function ensure() {
    if (!T.ready || window.location.hash !== HASH) return;
    if (!T.rows && !T.failed && !T.busy) fetchRows('');
  }

  function onClick(e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled || T.busy) return;
    var act = el.getAttribute('data-act');
    if (act === 'status') {
      var st = el.getAttribute('data-status') || '';
      if (!isStatus(st) || st === T.status) return;
      T.status = st;
      T.shown = PAGE;
      render();
      focusOn('[data-act="status"][data-status="' + st + '"]');
    } else if (act === 'retry') fetchRows('[data-act="status"][aria-pressed="true"]');
    else if (act === 'more') {
      var at = T.shown;
      T.shown += PAGE;
      render();
      var b = box();
      var li = b && b.querySelectorAll('li[data-tv-row]')[at];
      if (li) {
        li.setAttribute('tabindex', '-1');
        li.focus();
      }
    }
  }

  function onChange(e) {
    var t = e.target;
    if (!t || t.id !== 'tvTheme' || T.busy) return;
    T.theme = themeKeys(T.rows || []).indexOf(t.value) >= 0 ? t.value : '';
    T.shown = PAGE;
    render();
    focusOn('#tvTheme');
  }

  function bind() {
    var b = box();
    if (!b || b.getAttribute('data-bound')) return;
    b.setAttribute('data-bound', '1');
    b.addEventListener('click', onClick);
    b.addEventListener('change', onChange);
    window.addEventListener('hashchange', ensure);
  }

  /** segan/me.js 가 업체 칸을 읽은 뒤 부른다. 관리자가 아니면 칸을 감춘 채 둔다 */
  async function load(sb, session, me, opts) {
    hide();
    T.sb = sb || null;
    T.rows = null;
    T.failed = '';
    T.busy = false;
    T.status = STATUSES[0][0];
    T.theme = '';
    T.shown = PAGE;
    if (!sb || !session || !(opts && opts.admin === true)) return;
    bind();
    T.ready = true;
    render();
    ensure();
  }

  window.SeganThemeImagesView = {
    BUCKET: BUCKET,
    THEMES: THEMES,
    STATUSES: STATUSES,
    GRAY_BELOW: GRAY_BELOW,
    PAGE: PAGE,
    TEXT: TEXT,
    themeLabel: themeLabel,
    rowOf: rowOf,
    counts: counts,
    themeKeys: themeKeys,
    visible: visible,
    thumbUrl: thumbUrl,
    badgesOf: badgesOf,
    countText: countText,
    state: T,
    load: load,
  };
})();
