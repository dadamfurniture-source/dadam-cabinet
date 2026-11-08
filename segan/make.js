/* ============================================================
   segan/make.js — 만들기 탭: ① 사진 → ② 가구 → ③ 결과

   생성 백엔드는 ai-design.html 이 쓰는 그대로다 (generate-api: POST /api/generate → 202, GET 으로 읽기).
   품목 · 스타일 · 도어 색 · 냉장고 · 치수 값도 ai-design.html 과 같은 목록이다 (시험이 둘을 비교한다).
   새 API 칸 · 품목 · 선택지를 만들지 않는다.

   ③ 결과(./?g=<id>#result)가 연출컷 결과 화면 하나다 — 방금 만든 것도, 내 연출컷 목록(renders.html)에서
   연 것도 여기서 본다. 내 연출컷에 있던 관리는 이 화면으로 옮겼다 (같은 호출 · 같은 글, my-designs.html 과 같다):
     공유 링크  POST /api/generate/:id/share (만들기 · 새로 만들면 예전 링크는 막힌다), DELETE 같은 경로 (중단)
     시공사례   collection_posts (본인 · source ai_render) 가 있으면 「시공사례에서 내리기」 — 가운데 창으로 묻고
                행을 먼저 지우고 collection 버킷 파일을 지운다
     학습 동의  generations.consent_training 을 켜고 끈다
     다시 생성  POST /api/generate { parent_id, design_style, door_color } (ai-design.html ?regen=1 과 같은 호출,
                크레딧이 다시 든다 — 화면 안에서 단가 · 남은 횟수를 보이고 한 번 더 묻는다) → 새 결과 주소로
     삭제       DELETE /api/generate/:id (워커가 공유 링크 · 시공사례 게시물 · 파일까지 지운다) — 가운데 창으로 묻고
                내 연출컷 목록으로 (목록이 「삭제했습니다」를 한 번 보인다 — sessionStorage LIST_NOTICE_KEY)
     다시 생성 · 삭제 칸은 생성이 끝나거나 실패한 뒤에만 보인다 (진행 중에는 감춘다)
     내려받기   받기 직전에 서명 URL 을 다시 확인한다 (js/storage-urls.js)
   만들지 못한 연출컷(실패 · 12분 넘게 멈춘 잡)은 크레딧을 돌려드린다는 안내를 붙인다.
   로그인 없이 결과 주소를 열면 로그인으로 보내고, 로그인하면 같은 결과 주소로 돌아온다.

   로그인 문 — 누구나 사진을 고르고 가구를 고를 수 있다. 크레딧을 쓰는 버튼(연출컷 생성)을 누를 때
   로그인이 없으면, 사진과 고른 값을 이 기기(sessionStorage)에만 담고 기존 login.html 로 보낸다
   (돌아올 곳 = 이 페이지). 돌아오면 같은 단계 · 같은 사진 · 같은 선택으로 되살린다 — 다시 한 번
   누르기만 하면 된다. 저절로 생성하지 않는다. 로그인 전에는 아무것도 올리지 않는다.
   담아 둔 사진은 생성이 시작되면, 또는 사진을 버리면(다시 선택) 지운다.

   쓰는 페이지: segan/index.html (data-tab="make")
   의존: js/config.js · supabase-js (없으면 로그인 안 된 것으로 본다)
   ============================================================ */
/* global window, document, location, history, navigator, sessionStorage, FileReader, Image, URL, URLSearchParams, atob, fetch, setTimeout, CustomEvent */
(function () {
  'use strict';

  // ── 정본 — ai-design.html 과 같은 값 ─────────────────────
  // 화면 라벨 → 생성 API 카테고리 (worker prompts.js CATEGORIES 키와 1:1)
  var KINDS = [
    { key: 'sink', label: '싱크대' },
    { key: 'island', label: '아일랜드' },
    { key: 'wardrobe', label: '붙박이장' },
    { key: 'storage', label: '수납장' },
    { key: 'fridge', label: '냉장고장' },
    { key: 'vanity', label: '화장대' },
    { key: 'shoe', label: '신발장' },
    { key: 'office', label: '사무실' },
    { key: 'study', label: '서재' },
    { key: 'bedroom', label: '침실' },
  ];
  // ai-design.html #style
  var STYLES = [
    { value: 'modern-minimal', label: '모던 미니멀' },
    { value: 'scandinavian', label: '스칸디나비안' },
    { value: 'industrial', label: '인더스트리얼' },
    { value: 'classic', label: '클래식' },
    { value: 'luxury', label: '럭셔리' },
  ];
  // ai-design.html #doorColor
  var DOORS = [
    { value: 'white', label: '화이트' },
    { value: 'cream', label: '크림' },
    { value: 'light grey', label: '라이트 그레이' },
    { value: 'greige', label: '그레이지' },
    { value: 'oak woodgrain', label: '오크' },
    { value: 'walnut woodgrain', label: '월넛' },
    { value: 'charcoal', label: '차콜' },
  ];
  // ai-design.html #fBrand · #fPos
  var FRIDGE_BRANDS = [
    { value: 'samsung', label: '삼성' },
    { value: 'lg', label: 'LG' },
  ];
  var FRIDGE_POS = [
    { value: 'left', label: '좌측' },
    { value: 'right', label: '우측' },
  ];
  // 급수 · 배기 실측값은 주방(싱크대 · 아일랜드)만 워커가 받는다
  var KITCHEN_KINDS = ['sink', 'island'];

  var MAX_BYTES = 20 * 1024 * 1024;
  var MAX_EDGE = 1600; // 업로드 전 축소 (ai-design.html 과 같다)
  var DRAFT_KEY = 'segan.make.draft.v1';
  var LOGIN_PAGE = '../login.html';
  var RETURN_TARGET = 'segan/index.html'; // login.html ?redirect= — js/auth-redirect.js 가 받는 같은 사이트 *.html
  var STEPS = ['photo', 'kind', 'result'];

  // 생성 API — ai-design.html 과 같은 주소 · 같은 흐름 (POST → 202 + id, GET 으로 3초마다 읽기)
  var API =
    (window.DADAM_CONFIG &&
      window.DADAM_CONFIG.generateApi &&
      window.DADAM_CONFIG.generateApi.url) ||
    'https://dadam-generate-api.dadamfurniture.workers.dev/api/generate';
  var API_BASE = API.replace(/\/api\/generate\/?$/, '');
  var POLL_MS = 3000;
  var MAX_SHOTS = 4; // 기본안 + 추천안 (ai-design.html 과 같이 넷까지)
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var LIST_PAGE = 'renders.html'; // 내 연출컷 목록
  // 목록에 한 번 보일 알림 — segan/renders.js 가 읽고 바로 지운다 (같은 열쇠 · 같은 코드)
  var LIST_NOTICE_KEY = 'segan.renders.notice';
  var ACTIVE = ['queued', 'analyzing', 'rendering', 'qc', 'variants']; // my-designs.html 과 같다
  var STALE_MS = 12 * 60000; // 12분 넘게 진행 중이면 멈춘 잡으로 본다 (워커와 같은 기준)
  var REFUND_NOTE = '만들지 못한 연출컷의 크레딧은 돌려드립니다.';
  // my-designs.html 과 같은 글
  var CONSENT_ON = '이 연출컷과 함께 올린 사진이 다담 AI 학습에 쓰입니다. 누르면 끕니다.';
  var CONSENT_OFF = '학습에 쓰이지 않습니다. 누르면 켭니다.';
  var DELETE_ASK =
    '이 연출컷을 삭제할까요? 이미지와 공유 링크, 시공사례에 올라간 사진이 함께 사라집니다.';
  var UNPOST_ASK = '내린 뒤에는 다시 올릴 수 없습니다. 내릴까요?';
  var REGEN_ASK = '같은 사진 · 같은 설정으로 다시 만듭니다.';

  var DEFAULTS = {
    kind: 'sink',
    style: 'modern-minimal',
    door: 'white',
    wallW: '',
    water: '',
    exhaust: '',
    fBrand: 'samsung',
    fPos: 'left',
    fModel: '',
    fKimchi: '',
  };

  var S = {
    step: 'photo',
    photo: null, // { base64, mime, name, width, height, focal35 }
    choices: Object.assign({}, DEFAULTS),
    sb: null,
    session: null,
    cost: null, // 생성 1회 크레딧 — credit_costs (ai-design.html 과 같은 출처)
    balance: null, // 남은 크레딧 — RPC my_credit_wallet (업체 구성원이면 업체 통장)
    notice: '',
    fridgeRows: null,
    // ③ 결과
    phase: 'idle', // idle | loading | done | failed | signin (로그인 없이 결과 주소를 열었다)
    genId: null,
    results: [], // [{ src, path, label }]
    sel: 0, // 크게 보는 컷
    quote: null,
    progress: 0,
    progressLabel: '',
    error: '',
    resMsg: '',
    // 결과 관리 (예전 내 연출컷 하나 열기)
    gen: null, // 서버가 준 행 — { id, status, error, category, title, options, created_at, share_* }
    consent: null, // generations.consent_training — 못 읽으면 null (칸을 감춘다)
    post: null, // 시공사례에 올라간 게시물 — { id, storage_path } | null
    shareUrl: '', // 방금 만든 공유 링크 (예전 링크는 다시 볼 수 없다 — 토큰은 해시로만 남는다)
    regenAsk: '', // 다시 생성 확인 글 — 비어 있으면 감춘다
    boxMsg: '',
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function has(list, value, key) {
    var k = key || 'value';
    return list.some(function (x) {
      return x[k] === value;
    });
  }

  // ── 사진 — 축소 후 base64 (ai-design.html readImage · exifFocal35 와 같은 처리) ──
  // 사진 EXIF 의 35mm 환산 초점거리 (태그 0xA405). 캔버스로 줄이면 EXIF 가 사라지므로 원본에서 먼저 읽는다.
  function exifFocal35(dataUrl) {
    try {
      var b64 = String(dataUrl).split(',')[1] || '';
      var bin = atob(b64.slice(0, 174760));
      var u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      if (u[0] !== 0xff || u[1] !== 0xd8) return null;
      var p = 2;
      while (p + 4 < u.length) {
        if (u[p] !== 0xff) return null;
        var marker = u[p + 1];
        var len = (u[p + 2] << 8) | u[p + 3];
        if (
          marker === 0xe1 &&
          u[p + 4] === 0x45 &&
          u[p + 5] === 0x78 &&
          u[p + 6] === 0x69 &&
          u[p + 7] === 0x66
        ) {
          var t = p + 10;
          var le = u[t] === 0x49;
          var r16 = function (o) {
            return le ? u[t + o] | (u[t + o + 1] << 8) : (u[t + o] << 8) | u[t + o + 1];
          };
          var r32 = function (o) {
            return le
              ? (u[t + o] | (u[t + o + 1] << 8) | (u[t + o + 2] << 16) | (u[t + o + 3] << 24)) >>> 0
              : ((u[t + o] << 24) | (u[t + o + 1] << 16) | (u[t + o + 2] << 8) | u[t + o + 3]) >>>
                  0;
          };
          var find = function (ifd, tag) {
            var n = r16(ifd);
            for (var k = 0; k < n; k++) {
              var e = ifd + 2 + k * 12;
              if (r16(e) === tag) return e;
            }
            return -1;
          };
          var ptr = find(r32(4), 0x8769);
          if (ptr < 0) return null;
          var e = find(r32(ptr + 8), 0xa405);
          if (e < 0) return null;
          var f = r16(e + 8);
          return f >= 8 && f <= 200 ? f : null;
        }
        if (marker === 0xda) return null;
        p += 2 + len;
      }
    } catch {
      /* EXIF 를 못 읽으면 없는 것으로 */
    }
    return null;
  }

  /**
   * 파일 → { base64, mime, name, width, height, focal35 }. 긴 변 1600px JPEG 로 다시 그린다.
   * 앨범은 JPG · PNG 만 받는다 (ai-design.html 과 같다). 카메라로 찍은 사진은 기기가 주는 형식을
   * 브라우저가 열 수 있으면 받는다 — 어차피 JPEG 로 다시 그려 보낸다.
   */
  function readImage(file, fromCamera) {
    return new Promise(function (resolve, reject) {
      var okType =
        /^image\/(jpeg|png)$/.test(file.type) ||
        (fromCamera && /^image\//.test(file.type || 'image/'));
      if (!okType) return reject(new Error('JPG · PNG 만 올릴 수 있습니다'));
      if (file.size > MAX_BYTES) return reject(new Error('20MB 이하만 올릴 수 있습니다'));
      var fr = new FileReader();
      fr.onerror = function () {
        reject(new Error('파일을 읽지 못했습니다'));
      };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () {
          reject(new Error('이미지를 열지 못했습니다'));
        };
        img.onload = function () {
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
          var cw = Math.round(w * scale);
          var ch = Math.round(h * scale);
          var cv = document.createElement('canvas');
          cv.width = cw;
          cv.height = ch;
          cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          var url = cv.toDataURL('image/jpeg', 0.9);
          resolve({
            base64: url.split(',')[1],
            mime: 'image/jpeg',
            name: file.name || '사진',
            width: cw,
            height: ch,
            focal35: exifFocal35(fr.result),
          });
        };
        img.src = String(fr.result);
      };
      fr.readAsDataURL(file);
    });
  }

  // ── 이 기기에 담기 (sessionStorage) ─────────────────────
  function cleanChoices(c) {
    var o = Object.assign({}, DEFAULTS);
    if (!c || typeof c !== 'object') return o;
    if (has(KINDS, c.kind, 'key')) o.kind = c.kind;
    if (has(STYLES, c.style)) o.style = c.style;
    if (has(DOORS, c.door)) o.door = c.door;
    if (has(FRIDGE_BRANDS, c.fBrand)) o.fBrand = c.fBrand;
    if (has(FRIDGE_POS, c.fPos)) o.fPos = c.fPos;
    ['wallW', 'water', 'exhaust'].forEach(function (k) {
      if (/^\d{1,5}$/.test(String(c[k] || ''))) o[k] = String(c[k]);
    });
    ['fModel', 'fKimchi'].forEach(function (k) {
      if (/^[A-Za-z0-9][A-Za-z0-9._()-]{0,39}$/.test(String(c[k] || ''))) o[k] = String(c[k]);
    });
    return o;
  }

  function cleanPhoto(p) {
    if (!p || typeof p !== 'object' || typeof p.base64 !== 'string' || !p.base64) return null;
    if (!/^image\/(jpeg|png)$/.test(p.mime)) return null;
    return {
      base64: p.base64,
      mime: p.mime,
      name: typeof p.name === 'string' ? p.name.slice(0, 120) : '사진',
      width: Number(p.width) || null,
      height: Number(p.height) || null,
      focal35: Number(p.focal35) || null,
    };
  }

  function readDraft() {
    try {
      var d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (!d || d.v !== 1) return null;
      return {
        step: STEPS.indexOf(d.step) >= 0 ? d.step : 'photo',
        choices: cleanChoices(d.choices),
        photo: cleanPhoto(d.photo),
      };
    } catch {
      return null;
    }
  }

  /** 지금 상태를 담는다. 사진이 너무 커서 못 담으면 고른 값만 담고 false */
  function saveDraft() {
    var base = { v: 1, step: S.step === 'result' ? 'kind' : S.step, choices: S.choices };
    var started = S.genId && S.phase !== 'signin'; // 로그인 전에 연 결과 주소는 시작한 생성이 아니다
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify(Object.assign({}, base, { photo: started ? null : S.photo })) // 생성이 시작되면 사진은 다시 담지 않는다
      );
      return true;
    } catch {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(Object.assign({}, base, { photo: null })));
      } catch {
        /* 저장소가 막힌 기기 — 담지 못한다 */
      }
      return false;
    }
  }

  /** 담아 둔 사진만 지운다 (고른 값은 남긴다) */
  function dropDraftPhoto() {
    var d = readDraft();
    try {
      if (!d) sessionStorage.removeItem(DRAFT_KEY);
      else
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ v: 1, step: 'photo', choices: d.choices, photo: null })
        );
    } catch {
      /* noop */
    }
  }

  // ── 화면 ────────────────────────────────────────────────
  function chips(list, current, attr, key) {
    var k = key || 'value';
    return list
      .map(function (x) {
        return (
          '<button type="button" class="mk-chip" ' +
          attr +
          '="' +
          esc(x[k]) +
          '" aria-pressed="' +
          (x[k] === current) +
          '">' +
          esc(x.label) +
          '</button>'
        );
      })
      .join('');
  }

  function renderSteps() {
    var at = STEPS.indexOf(S.step);
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      var i = STEPS.indexOf(b.getAttribute('data-goto'));
      b.classList.toggle('mk-stepnav--done', i <= at);
      if (i === at) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      // 지나온 단계만 누를 수 있다 (되돌아가기). 결과는 생성이 시작된 뒤에는 다시 갈 수 있다
      b.disabled = i === at || (i > at && !(STEPS[i] === 'result' && S.genId));
    });
    document.querySelectorAll('[data-step]').forEach(function (sec) {
      sec.hidden = sec.getAttribute('data-step') !== S.step;
    });
  }

  function renderPhoto() {
    var p = S.photo;
    $('mkEmpty').hidden = !!p;
    $('mkPhoto').hidden = !p;
    $('mkFileRow').hidden = !p;
    $('mkDrop').classList.toggle('mk-drop--photo', !!p);
    if (p) {
      $('mkPhoto').src = 'data:' + p.mime + ';base64,' + p.base64;
      $('mkDrop').style.aspectRatio = p.width && p.height ? p.width + ' / ' + p.height : '';
      $('mkFile').textContent = p.name + ' · 준비됨';
    } else {
      $('mkPhoto').removeAttribute('src');
      $('mkDrop').style.aspectRatio = '';
      $('mkFile').textContent = '';
    }
  }

  function renderKind() {
    var c = S.choices;
    $('mkKinds').innerHTML = chips(KINDS, c.kind, 'data-kind', 'key');
    $('mkStyles').innerHTML = chips(STYLES, c.style, 'data-style');
    $('mkDoors').innerHTML = chips(DOORS, c.door, 'data-door');
    $('mkFBrands').innerHTML = chips(FRIDGE_BRANDS, c.fBrand, 'data-fbrand');
    $('mkFPos').innerHTML = chips(FRIDGE_POS, c.fPos, 'data-fpos');
    $('mkFridge').hidden = c.kind !== 'fridge';
    $('mkPlumbing').hidden = KITCHEN_KINDS.indexOf(c.kind) < 0;
    $('mkWallW').value = c.wallW;
    $('mkWater').value = c.water;
    $('mkExhaust').value = c.exhaust;
    if (c.kind === 'fridge') loadFridgeModels();
  }

  function costText() {
    if (!S.cost) return '';
    var t = S.cost + ' 크레딧 차감';
    if (!S.session) return t + ' · 로그인하면 생성할 수 있습니다';
    if (S.balance != null) t += ' · 남은 ' + Math.floor(S.balance / S.cost) + '회';
    return t;
  }

  function renderBar() {
    var kind = S.step === 'kind';
    $('mkNext').hidden = S.step !== 'photo';
    $('mkNext').disabled = !S.photo;
    $('mkRun').hidden = !kind;
    $('mkRun').disabled = !S.photo;
    $('mkPost').hidden = !kind;
    var cost = kind ? costText() : '';
    $('mkCost').hidden = !cost;
    $('mkCost').textContent = cost;
    $('mkNotice').textContent = S.notice;
    $('mkNotice').hidden = !S.notice;
    $('mkBar').hidden = S.step === 'result';
  }

  function render() {
    renderSteps();
    renderPhoto();
    renderKind();
    renderBar();
    renderResult();
  }

  // ── ③ 결과 ─────────────────────────────────────────────
  function won(n) {
    return Number(n || 0).toLocaleString('ko-KR') + '원';
  }

  function shotLabel(r) {
    return r && r.label ? r.label : '연출컷';
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

  /** 연출컷 이름 — 제목, 없으면 「품목 연출컷」 (내 연출컷 목록과 같다) */
  function genLabel(g) {
    if (g.title) return g.title;
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i].key === g.category) return KINDS[i].label + ' 연출컷';
    }
    return (g.category || '가구') + ' 연출컷';
  }

  /** 12분 넘게 진행 중인 잡 — 멈춘 것으로 본다 (내 연출컷 목록 · 워커와 같은 기준) */
  function staleJob(g) {
    return (
      ACTIVE.indexOf(g.status) >= 0 && Date.now() - new Date(g.created_at).getTime() >= STALE_MS
    );
  }

  function jobFailed(g) {
    return !!g && (g.status === 'failed' || staleJob(g));
  }

  function isShared(g) {
    return !!(
      g.share_expires_at &&
      !g.share_revoked_at &&
      new Date(g.share_expires_at) > new Date()
    );
  }

  /** 로그인하면 돌아올 곳 — 같은 결과 주소 (js/auth-redirect.js 가 받는 같은 사이트 *.html) */
  function resultLoginHref(id) {
    return (
      LOGIN_PAGE +
      '?redirect=' +
      encodeURIComponent(RETURN_TARGET + '?g=' + encodeURIComponent(id) + '#result')
    );
  }

  function renderResult() {
    var box = $('mkShots');
    if (!box) return;
    var loading = S.phase === 'loading';
    var done = S.phase === 'done';
    var gate = S.phase === 'signin';
    var n = S.results.length;
    if (S.sel >= n) S.sel = 0;

    // 로그인 없이 연 결과 주소 — 로그인 안내만
    $('mkResGate').hidden = !gate;
    if (gate) $('mkResLogin').setAttribute('href', resultLoginHref(S.genId));
    $('mkResInfo').hidden = !S.gen;
    $('mkResInfo').textContent = S.gen
      ? genLabel(S.gen) + (S.gen.created_at ? ' · ' + when(S.gen.created_at) : '')
      : '';

    // 만드는 중에는 진행 줄(서버의 단계 안내 · 진행률)만, 끝나면 장수
    $('mkResState').textContent = loading ? '약 1~2분 걸립니다' : done ? n + ' / ' + MAX_SHOTS : '';
    $('mkResActs').hidden = !(done && n);
    $('mkProgress').hidden = !loading;
    $('mkProgressBar').style.width = Math.max(4, Math.min(100, S.progress || 0)) + '%';
    $('mkProgressLabel').textContent = S.progressLabel || '생성을 요청하는 중';

    var main = S.results[S.sel];
    var thumbs = [];
    for (var i = 0; i < MAX_SHOTS; i++) {
      if (i === S.sel && main) continue;
      thumbs.push(i);
    }
    var mainHTML = main
      ? '<figure class="mk-shot mk-shot--main"><img src="' +
        esc(main.src) +
        '" alt="' +
        esc(shotLabel(main)) +
        '" /><figcaption>' +
        esc(shotLabel(main)) +
        '</figcaption></figure>'
      : '<div class="mk-shot mk-shot--main mk-shot--wait" aria-hidden="true"></div>';
    var thumbHTML = thumbs
      .slice(0, MAX_SHOTS - 1)
      .map(function (i) {
        var r = S.results[i];
        return r
          ? '<button type="button" class="mk-thumb" data-shot="' +
              i +
              '" aria-label="' +
              esc(shotLabel(r)) +
              ' 크게 보기"><img src="' +
              esc(r.src) +
              '" alt="" /></button>'
          : '<span class="mk-thumb mk-thumb--wait" aria-hidden="true"></span>';
      })
      .join('');
    box.innerHTML = mainHTML + '<div class="mk-thumbs">' + thumbHTML + '</div>';
    box.hidden = gate || (S.phase === 'failed' && !n);

    var err = $('mkResError');
    err.hidden = S.phase !== 'failed';
    err.textContent = S.error;
    // 잡이 실패했거나 멈췄으면 크레딧을 돌려드린다 (워커가 기본안 없이 끝나면 환불한다)
    $('mkRefund').hidden = !(S.phase === 'failed' && jobFailed(S.gen));
    $('mkRefund').textContent = REFUND_NOTE;
    $('mkRetry').hidden = S.phase !== 'failed';
    $('mkResMsg').textContent = S.resMsg;
    $('mkResMsg').hidden = !S.resMsg;

    renderQuote();
    renderManage();
    $('mkResFoot').hidden = !(done || S.phase === 'failed');
  }

  // ── 결과 관리 — 공유 링크 · 시공사례 · AI 학습 · 다시 생성 · 삭제 ──
  function paintConsent(on) {
    var b = $('mkConsent');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = on ? 'AI 학습 허용' : 'AI 학습 안 함';
    $('mkConsentNote').textContent = on ? CONSENT_ON : CONSENT_OFF;
  }

  function renderManage() {
    var g = S.gen;
    var on = !!g && S.phase !== 'signin';
    var done = on && S.phase === 'done';

    // 공유 링크 — 완료된 것만 (워커도 그렇게 막는다)
    $('mkShareBox').hidden = !done;
    if (done) {
      var shared = isShared(g);
      $('mkShareState').textContent = S.shareUrl
        ? '아래 링크를 보내면 로그인 없이 볼 수 있습니다 · ' + when(g.share_expires_at) + ' 까지'
        : shared
          ? '공유 중 · ' +
            when(g.share_expires_at) +
            ' 까지. 링크를 다시 보려면 새로 만드세요 (예전 링크는 막힙니다).'
          : '링크를 만들면 로그인 없이 이 연출컷을 볼 수 있습니다.';
      $('mkLinkRow').hidden = !S.shareUrl;
      $('mkLink').value = S.shareUrl;
      $('mkShareMake').textContent = shared || S.shareUrl ? '새 링크 만들기' : '공유 링크 만들기';
      $('mkShareStop').hidden = !shared;
    }

    // 시공사례에서 내리기 · AI 학습 동의 — 읽은 것만 그린다
    $('mkPostBox').hidden = !(on && S.post);
    $('mkConsentBox').hidden = !(on && S.consent !== null);
    if (S.consent !== null) paintConsent(S.consent);

    // 다시 생성 · 삭제 — 진행 중에는 칸째 감추고, 끝나거나(완료) 실패하면 보인다
    // (my-designs.html 은 막아 두지만, 누를 수 없는 버튼을 보이지 않는다)
    var settled = on && (S.phase === 'done' || S.phase === 'failed');
    $('mkManage').hidden = !settled;
    $('mkRegenAsk').hidden = !(settled && S.regenAsk);
    $('mkRegenText').textContent = S.regenAsk;
    $('mkBoxMsg').textContent = S.boxMsg;
    $('mkBoxMsg').hidden = !S.boxMsg;
  }

  function boxMsg(text) {
    S.boxMsg = text || '';
    renderManage();
  }

  /** 시공사례 게시물 · 학습 동의 — 생성 API 가 싣지 않는 칸이라 Supabase 에서 읽는다 (내 연출컷과 같은 표) */
  async function loadExtras() {
    var g = S.gen;
    if (!g || !S.sb || !S.session || !S.session.user) return;
    var uid = S.session.user.id;
    var consent = null;
    var post = null;
    try {
      var c = await S.sb
        .from('generations')
        .select('consent_training')
        .eq('id', g.id)
        .eq('user_id', uid)
        .maybeSingle();
      if (c && !c.error && c.data) consent = c.data.consent_training === true;
    } catch {
      /* 못 읽으면 칸을 감춘다 */
    }
    try {
      var p = await S.sb
        .from('collection_posts')
        .select('id, generation_id, storage_path')
        .eq('user_id', uid)
        .eq('source', 'ai_render')
        .eq('generation_id', g.id);
      if (p && !p.error && Array.isArray(p.data)) post = p.data[0] || null;
    } catch {
      /* 못 읽으면 내리기를 그리지 않는다 */
    }
    if (S.gen !== g) return; // 그 사이 다른 결과로 바뀌었다
    S.consent = consent;
    S.post = post;
  }

  /** 가운데 작은 창으로 묻는다 (segan/shell.js SeganShell.sheet, kind 'dialog') — 막는 확인만 */
  function confirmDialog(title, text, yesLabel, onYes) {
    var sheet = window.SeganShell && window.SeganShell.sheet;
    if (!sheet) return null;
    var body = document.createElement('div');
    body.className = 'mk-confirm';
    var p = document.createElement('p');
    p.className = 'mk-note';
    p.textContent = text;
    var acts = document.createElement('div');
    acts.className = 'mk-acts';
    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'mk-btn mk-btn--solid';
    yes.setAttribute('data-confirm', 'yes');
    yes.textContent = yesLabel;
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'mk-btn';
    no.setAttribute('data-confirm', 'no');
    no.textContent = '취소';
    acts.appendChild(yes);
    acts.appendChild(no);
    body.appendChild(p);
    body.appendChild(acts);
    var h = sheet.open({ title: title, body: body, kind: 'dialog', initialFocus: no });
    no.addEventListener('click', function () {
      h.close();
    });
    yes.addEventListener('click', function () {
      yes.disabled = true;
      no.disabled = true;
      onYes(h);
    });
    return h;
  }

  // 공유 링크 — 만들기 · 복사 · 중단
  async function makeShare() {
    var g = S.gen;
    if (!g || S.phase !== 'done') return;
    $('mkShareMake').disabled = true;
    try {
      var res = await fetch(API_BASE + '/api/generate/' + g.id + '/share', {
        method: 'POST',
        headers: await authHeaders(),
        body: '{}',
      });
      var data = await res.json();
      if (!res.ok || !data.share_url)
        throw new Error(data.error || '공유 링크를 만들지 못했습니다');
      S.shareUrl = data.share_url;
      g.share_expires_at = data.expires_at || g.share_expires_at;
      g.share_revoked_at = null;
      S.boxMsg = '';
    } catch (e) {
      S.boxMsg = e.message || '공유 링크를 만들지 못했습니다';
    }
    $('mkShareMake').disabled = false;
    renderManage();
  }

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(S.shareUrl);
      boxMsg('공유 링크를 복사했습니다');
    } catch {
      $('mkLink').select();
      boxMsg('링크를 길게 눌러 복사해 주세요');
    }
  }

  async function stopShare() {
    var g = S.gen;
    if (!g) return;
    $('mkShareStop').disabled = true;
    try {
      var res = await fetch(API_BASE + '/api/generate/' + g.id + '/share', {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.error || '공유를 중단하지 못했습니다');
      g.share_revoked_at = new Date().toISOString();
      S.shareUrl = '';
      S.boxMsg = '공유를 중단했습니다 — 보낸 링크는 더 이상 열리지 않습니다';
    } catch (e) {
      S.boxMsg = e.message || '공유를 중단하지 못했습니다';
    }
    $('mkShareStop').disabled = false;
    renderManage();
  }

  // 시공사례에서 내리기 (my-designs.html unpost 와 같은 순서 — 행을 먼저 지우고 파일을 지운다)
  function askUnpost() {
    if (!S.gen || !S.post) return;
    confirmDialog('시공사례에서 내리기', UNPOST_ASK, '내리기', unpost);
  }

  async function unpost(h) {
    var post = S.post;
    var fail = '';
    try {
      var res = await S.sb.from('collection_posts').delete().eq('id', post.id).select('id');
      if (res.error || !res.data || !res.data.length)
        fail = '시공사례에서 내리지 못했습니다' + (res.error ? ' — ' + res.error.message : '');
    } catch (e) {
      fail = '시공사례에서 내리지 못했습니다' + (e && e.message ? ' — ' + e.message : '');
    }
    if (!fail && post.storage_path) {
      try {
        await S.sb.storage.from('collection').remove([post.storage_path]);
      } catch {
        /* 행은 지웠다 — 파일이 남아도 목록에는 안 보인다 */
      }
    }
    await h.close();
    if (!fail && S.post === post) S.post = null;
    boxMsg(fail || '시공사례에서 내렸습니다');
  }

  // AI 학습 동의 (my-designs.html toggleConsent 와 같은 칸 · 같은 글)
  async function toggleConsent() {
    var g = S.gen;
    if (!g || S.consent === null) return;
    var prev = S.consent;
    var next = !prev;
    S.consent = next;
    paintConsent(next);
    $('mkConsent').disabled = true;
    var res;
    try {
      res = await S.sb.from('generations').update({ consent_training: next }).eq('id', g.id);
    } catch (e) {
      res = { error: e };
    }
    $('mkConsent').disabled = false;
    if (S.gen !== g) return;
    if (res && res.error) {
      S.consent = prev;
      boxMsg('학습 동의를 바꾸지 못했습니다');
      return;
    }
    boxMsg(next ? '학습에 사용하도록 켰습니다' : '학습에서 뺐습니다');
  }

  // 다시 생성 — 크레딧이 다시 든다. 단가 · 남은 횟수는 만들기 ② 와 같은 출처 (credit_costs · my_credit_wallet)
  async function askRegen() {
    var g = S.gen;
    if (!g || S.phase === 'loading') return;
    S.regenAsk = REGEN_ASK + ' 크레딧이 다시 차감됩니다.';
    renderManage();
    try {
      var cc = await S.sb
        .from('credit_costs')
        .select('credits')
        .eq('action', 'generate')
        .maybeSingle();
      var cost = cc && cc.data ? cc.data.credits : null;
      var left = await loadBalance(S.sb);
      if (left != null) S.balance = left;
      if (cost && S.regenAsk && S.gen === g) {
        S.regenAsk =
          REGEN_ASK +
          ' ' +
          cost +
          ' 크레딧이 차감됩니다' +
          (left != null ? ' · 남은 ' + Math.floor(left / cost) + '회' : '') +
          '.';
      }
    } catch {
      /* 단가를 못 읽으면 일반 안내 */
    }
    renderManage();
  }

  /** ai-design.html ?regen=1 과 같은 호출 — parent_id 와 원본의 스타일 · 도어 색 */
  async function regen() {
    var g = S.gen;
    if (!g || S.phase === 'loading') return;
    var o = g.options || {};
    $('mkRegenYes').disabled = true;
    try {
      var res = await fetch(API, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          parent_id: g.id,
          design_style: o.design_style || 'modern-minimal',
          door_color: o.door_color || 'white',
        }),
      });
      // 402 — 크레딧 부족 · 업체 구독 멈춤 (생성과 같은 안내)
      if (res.status === 402) throw await paymentRequiredError(res);
      if (res.status === 409)
        throw new Error('이미 생성 중인 작업이 있습니다. 끝난 뒤 다시 시도해 주세요.');
      var data = await res.json();
      if (!res.ok || !data.success || !data.id)
        throw new Error((data && data.error) || '다시 생성하지 못했습니다');
      // 새 결과 주소 — 이 화면이 읽어 진행을 보여 준다 (읽기만 한다)
      api.go('./?g=' + encodeURIComponent(data.id) + '#result');
    } catch (e) {
      S.regenAsk = '';
      boxMsg(e.message || '다시 생성하지 못했습니다');
    }
    $('mkRegenYes').disabled = false;
  }

  // 삭제 (my-designs.html remove 와 같은 경로 · 같은 확인 글) — 지우면 내 연출컷 목록으로
  function askDelete() {
    if (!S.gen || S.phase === 'loading') return;
    S.regenAsk = '';
    renderManage();
    confirmDialog('연출컷 삭제', DELETE_ASK, '삭제', remove);
  }

  async function remove(h) {
    var g = S.gen;
    var fail = '';
    try {
      var res = await fetch(API_BASE + '/api/generate/' + g.id, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) fail = data.error || '삭제하지 못했습니다';
    } catch (e) {
      fail = (e && e.message) || '삭제하지 못했습니다';
    }
    // 창의 기록 칸을 먼저 되돌린다 — 그 뒤에 주소를 바꾼다
    await h.close();
    if (fail) {
      boxMsg(fail);
      return;
    }
    // 목록에서 「삭제했습니다」를 한 번 보인다
    try {
      sessionStorage.setItem(LIST_NOTICE_KEY, 'deleted');
    } catch {
      /* 알림 없이 목록으로 간다 */
    }
    // 지운 결과로 뒤로 가지 않게 지금 칸을 목록으로 바꾼다
    api.go(LIST_PAGE, true);
  }

  /** 예상 견적 — ai-design.html 과 같은 줄(품목 · 금액)과 합계 (VAT 포함) */
  function renderQuote() {
    var q = S.quote;
    var box = $('mkQuote');
    var show = S.phase === 'done' && !!q;
    box.hidden = !show;
    if (!show) return;
    $('mkQuoteRows').innerHTML = (q.items || [])
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
    $('mkQuoteTotal').textContent = won(q.total);
    $('mkConsult').setAttribute('href', 'consult.html?g=' + encodeURIComponent(S.genId));
  }

  // ── 단계 이동 ───────────────────────────────────────────
  /** popstate 가 시트 · 옆 패널의 기록 칸인가 (segan/shell.js SeganShell.sheet.isSheetState) */
  function sheetEntry(e) {
    var sheet = window.SeganShell && window.SeganShell.sheet;
    return !!(sheet && sheet.isSheetState(e && e.state));
  }

  function setStep(step, push) {
    if (step === 'result' && !S.genId) step = 'kind';
    if (step === 'kind' && !S.photo) step = 'photo';
    S.step = step;
    S.notice = '';
    var hash = step === 'photo' ? '' : '#' + step;
    try {
      var url = location.pathname + location.search + hash;
      if (push) history.pushState({ mk: step }, '', url);
      else history.replaceState({ mk: step }, '', url);
    } catch {
      /* noop */
    }
    saveDraft();
    render();
    // 새 단계는 맨 위(진행 단계 줄)부터 보인다 — 위 막대가 sticky 라 요소로 스크롤하면 줄이 가려진다
    if (push && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(0, 0);
      } catch {
        /* jsdom */
      }
    }
  }

  async function setPhoto(file, fromCamera) {
    $('mkPhotoError').hidden = true;
    try {
      S.photo = await api.readImage(file, fromCamera);
    } catch (e) {
      $('mkPhotoError').textContent = e.message;
      $('mkPhotoError').hidden = false;
      return;
    }
    saveDraft();
    render();
  }

  function clearPhoto() {
    S.photo = null;
    $('mkCameraInput').value = '';
    $('mkAlbumInput').value = '';
    dropDraftPhoto();
    if (S.step !== 'photo') setStep('photo', false);
    else render();
  }

  function setChoice(key, value) {
    S.choices[key] = value;
    saveDraft();
    renderKind();
    renderBar();
  }

  // ── 크레딧을 쓰는 버튼 ──────────────────────────────────
  function loginHref() {
    return LOGIN_PAGE + '?redirect=' + encodeURIComponent(RETURN_TARGET);
  }

  async function run() {
    if (S.phase === 'loading') {
      setStep('result', true); // 이미 만드는 중 — 두 번 차감하지 않는다
      return;
    }
    if (!S.photo) return;
    if (!S.session) {
      // 로그인 전: 이 기기에만 담고 로그인하러 간다. 돌아오면 같은 단계로 되살린다.
      S.step = 'kind';
      if (!saveDraft()) {
        S.notice =
          '사진이 커서 이 기기에 잠시 담지 못했습니다. 로그인한 뒤 사진을 다시 골라 주세요.';
        renderBar();
      }
      api.go(loginHref());
      return;
    }
    await api.start();
  }

  // ── 생성 (ai-design.html 과 같은 요청 · 같은 흐름) ──────
  async function authHeaders() {
    var h = { 'Content-Type': 'application/json' };
    try {
      if (S.sb) {
        var r = await S.sb.auth.getSession();
        var t = r && r.data && r.data.session && r.data.session.access_token;
        if (t) h.Authorization = 'Bearer ' + t;
      }
    } catch {
      /* 토큰이 없으면 서버가 401 */
    }
    return h;
  }

  /** 요청 본문 — ai-design.html run() 과 같은 칸 (참고 이미지 · 상세 요청은 앱에서 뺐다) */
  function buildBody() {
    var c = S.choices;
    var p = S.photo;
    var kitchen = KITCHEN_KINDS.indexOf(c.kind) >= 0;
    var body = {
      room_image: p.base64,
      image_type: p.mime,
      category: c.kind,
      design_style: c.style,
      door_color: c.door,
      wall_width_override: c.wallW || undefined,
      room_focal35: p.focal35 || undefined,
      water_from_left_override: (kitchen && c.water) || undefined,
      exhaust_from_left_override: (kitchen && c.exhaust) || undefined,
    };
    if (c.kind === 'fridge') {
      body.fridge_options = { brand: c.fBrand, position: c.fPos };
      var models = [c.fModel, c.fKimchi].filter(Boolean);
      if (models.length) body.fridge_options.models = models;
    }
    return body;
  }

  function wait(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  /** 서버 행 → 화면 상태 (ai-design.html applyGeneration 과 같다). 서명 URL 은 같은 파일이면 처음 주소를 둔다 */
  function applyGeneration(g) {
    S.genId = g.id;
    var had = {};
    S.results.forEach(function (r) {
      if (r.path) had[r.path] = r.src;
    });
    S.results = (g.images || []).slice(0, MAX_SHOTS).map(function (im) {
      return {
        src: (im.path && had[im.path]) || im.url,
        path: im.path || null,
        label: im.label || '',
      };
    });
    S.quote = g.quote || null;
    S.progress = Number(g.progress) || 0;
    // 결과 관리에 쓰는 칸 (생성 API GET 이 싣는 그대로)
    S.gen = {
      id: g.id,
      status: g.status,
      error: g.error || '',
      category: g.category || null,
      title: g.title || null,
      options: g.options || {},
      created_at: g.created_at || null,
      share_expires_at: g.share_expires_at || null,
      share_revoked_at: g.share_revoked_at || null,
    };
  }

  /** 결과 화면 상태를 비운다 (새 생성 · 다른 결과 열기 · 처음부터) */
  function resetResult() {
    S.results = [];
    S.quote = null;
    S.sel = 0;
    S.progress = 0;
    S.error = '';
    S.resMsg = '';
    S.gen = null;
    S.consent = null;
    S.post = null;
    S.shareUrl = '';
    S.regenAsk = '';
    S.boxMsg = '';
  }

  /** 멈춘 잡(12분 넘게 진행 중)은 실패로 본다 — 더 읽지 않는다 */
  function failIfStale(g) {
    if (staleJob(g)) throw new Error(g.error || '연출컷을 만들지 못했습니다');
  }

  /** 잡이 끝날 때까지 3초마다 읽는다 */
  async function poll(id) {
    for (;;) {
      await wait(POLL_MS);
      var res = await fetch(API_BASE + '/api/generate/' + id, { headers: await authHeaders() });
      if (res.status === 404) throw new Error('생성 결과를 찾을 수 없습니다');
      var data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data && data.error ? data.error : '상태를 읽지 못했습니다');
      var g = data.generation;
      applyGeneration(g);
      if (g.status === 'done') {
        S.phase = 'done';
        S.progressLabel = '';
        return;
      }
      if (g.status === 'failed') throw new Error(g.error || '생성에 실패했습니다');
      failIfStale(g);
      S.progressLabel = (g.step_label || '생성 중') + ' · ' + (g.progress || 0) + '%';
      renderResult();
    }
  }

  function failed(e) {
    S.phase = 'failed';
    S.error = (e && e.message) || '생성에 실패했습니다';
    S.progressLabel = '';
  }

  /** 크레딧을 쓰는 곳 — 로그인한 사람이 버튼을 눌렀을 때만 온다 */
  async function start() {
    if (S.phase === 'loading' || !S.photo || !S.session) return;
    S.phase = 'loading';
    S.genId = null;
    resetResult();
    S.progressLabel = '생성을 요청하는 중';
    var body = buildBody();
    renderBar();
    try {
      $('mkRun').disabled = true;
      var res = await fetch(API, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      // 402 는 크레딧 소진(업체 구독이 멈춘 업체면 그 안내), 409 는 이미 만드는 중 (ai-design.html 과 같은 문구)
      if (res.status === 402) throw await paymentRequiredError(res);
      if (res.status === 409)
        throw new Error('이미 생성 중인 작업이 있습니다. 끝난 뒤 다시 시도해 주세요.');
      var data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data && data.error ? data.error : '생성에 실패했습니다');
      if (res.status !== 202 || !data.id) throw new Error('생성에 실패했습니다');
      S.genId = data.id;
      if (data.credit && data.credit.balance != null) S.balance = data.credit.balance;
      // 시작됐다 — 이 기기에 담아 둔 사진을 지운다 (화면의 사진은 실패 때 다시 시도하려고 남긴다)
      dropDraftPhoto();
      try {
        history.replaceState(
          { mk: 'result' },
          '',
          location.pathname + '?g=' + encodeURIComponent(data.id) + '#result'
        );
      } catch {
        /* noop */
      }
      setStep('result', true);
      await poll(data.id);
    } catch (e) {
      failed(e);
      if (!S.genId) {
        // 시작도 못 했다 — 가구 단계에서 안내하고 다시 누를 수 있게
        S.phase = 'idle';
        S.notice = S.error;
        S.step = 'kind';
        render();
        return;
      }
    }
    await loadExtras(); // 끝나면 시공사례에 올라간다 — 그 게시물 · 학습 동의를 읽는다
    render();
  }

  /** 저장된 결과 열기 (?g=<id>) — 읽기만 한다. 크레딧을 쓰지 않는다 */
  async function openGeneration(id) {
    S.genId = id;
    S.phase = 'loading';
    resetResult();
    S.progressLabel = '불러오는 중';
    setStep('result', false);
    try {
      var res = await fetch(API_BASE + '/api/generate/' + id, { headers: await authHeaders() });
      var data = await res.json();
      if (!res.ok || !data.success)
        throw new Error(data && data.error ? data.error : '불러오지 못했습니다');
      var g = data.generation;
      applyGeneration(g);
      await loadExtras();
      if (g.status === 'done') S.phase = 'done';
      else if (g.status === 'failed') failed(new Error(g.error || '생성에 실패했습니다'));
      else {
        failIfStale(g);
        S.progressLabel = (g.step_label || '생성 중') + ' · ' + (g.progress || 0) + '%';
        renderResult();
        await poll(id);
        await loadExtras();
      }
    } catch (e) {
      failed(e);
    }
    render();
  }

  /** 로그인 없이 결과 주소를 열었다 — 로그인 안내만 (로그인하면 같은 주소로 돌아온다) */
  function showSignin(id) {
    S.genId = id;
    S.phase = 'signin';
    resetResult();
    setStep('result', false);
  }

  /** 다른 사진으로 다시 만들기 — 처음부터 (고른 가구 · 설정은 남긴다) */
  function restart() {
    S.photo = null;
    S.genId = null;
    S.phase = 'idle';
    resetResult();
    dropDraftPhoto();
    try {
      history.replaceState({ mk: 'photo' }, '', location.pathname);
    } catch {
      /* noop */
    }
    setStep('photo', false);
  }

  async function download() {
    var i = S.sel;
    var r = S.results[i];
    if (!r) return;
    // 오래 열어 둔 화면이면 서명이 낡았을 수 있다 — 받기 직전에 다시 확인한다 (js/storage-urls.js)
    var src = r.src;
    if (window.DadamStorageUrls && S.sb) {
      try {
        src = (await window.DadamStorageUrls.signUrl(S.sb, r.src)) || r.src;
      } catch {
        src = r.src;
      }
    }
    var kind = (S.gen && S.gen.category) || S.choices.kind;
    try {
      var blob = await (await fetch(src)).blob();
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      // 기본안은 segan-<품목>, 추천안은 -2 · -3 …
      a.download =
        'segan-' + kind + (i ? '-' + (i + 1) : '') + (blob.type === 'image/png' ? '.png' : '.jpg');
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 10000);
    } catch {
      window.open(src, '_blank');
    }
  }

  /** 공유 — ai-design.html 과 같은 POST /api/generate/:id/share 로 공유 주소를 받는다 */
  async function share() {
    if (!S.genId || S.phase !== 'done') return;
    try {
      var res = await fetch(API_BASE + '/api/generate/' + S.genId + '/share', {
        method: 'POST',
        headers: await authHeaders(),
        body: '{}',
      });
      var data = await res.json();
      if (!res.ok || !data.share_url) throw new Error('공유 링크를 만들지 못했습니다');
      // 새 링크를 만들면 예전 링크는 막힌다 — 아래 공유 링크 칸도 이 링크로 바꾼다
      S.shareUrl = data.share_url;
      if (S.gen) {
        S.gen.share_expires_at = data.expires_at || S.gen.share_expires_at;
        S.gen.share_revoked_at = null;
      }
      renderManage();
      if (navigator.share) {
        await navigator.share({ title: 'SEGAN 연출컷', url: data.share_url });
      } else {
        await navigator.clipboard.writeText(data.share_url);
        S.resMsg = '공유 링크를 복사했습니다';
        renderResult();
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 공유 창을 닫았다
      S.resMsg = '공유 링크를 만들지 못했습니다';
      renderResult();
    }
  }

  // ── 데이터 (Supabase) ───────────────────────────────────
  function client() {
    try {
      if (window.DADAM_CONFIG && window.supabase) {
        return window.supabase.createClient(
          window.DADAM_CONFIG.supabase.url,
          window.DADAM_CONFIG.supabase.anonKey
        );
      }
    } catch {
      /* 없으면 로그인 안 된 것으로 */
    }
    return null;
  }

  /**
   * 지금 쓰는 크레딧 통장 — RPC my_credit_wallet (협력업체 구성원이면 업체 통장, 아니면 내 통장).
   * { scope: 'company' | 'personal', company_id, plan, balance, monthly, period_end, usable } | null.
   * 기간이 끝났으면 DB 가 월 지급량을 돌려준다 — 화면은 다시 계산하지 않는다
   */
  async function loadWallet(sb) {
    var r = await sb.rpc('my_credit_wallet');
    if (r && r.error) throw r.error;
    var rows = r ? r.data : null;
    var w = Array.isArray(rows) ? rows[0] : rows;
    return w && typeof w === 'object' ? w : null;
  }

  /** 남은 크레딧 — 지금 쓰는 통장의 잔액 (못 읽으면 null) */
  async function loadBalance(sb) {
    var w = await loadWallet(sb);
    return w && w.balance != null ? Number(w.balance) : null;
  }

  /** 402 — 업체 구독이 멈춘 업체(company_inactive)면 서버 문구, 그 밖은 크레딧 부족 */
  async function paymentRequiredError(res) {
    var body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (body && body.code === 'company_inactive')
      return new Error(
        body.error || '팩토리 구독이 멈춰 있어 연출컷을 만들 수 없습니다. 결제를 확인해 주세요.'
      );
    return new Error('크레딧이 부족합니다. 구독을 올리면 더 만들 수 있습니다.');
  }

  async function loadAccount() {
    var sb = S.sb;
    if (!sb) return;
    try {
      var r = await sb.auth.getSession();
      S.session = (r && r.data && r.data.session) || null;
    } catch {
      S.session = null;
    }
    try {
      // 생성 1회 단가 — 화면에 숫자를 적어 두지 않고 표에서 읽는다 (ai-design.html 과 같다)
      var cc = await sb
        .from('credit_costs')
        .select('credits')
        .eq('action', 'generate')
        .maybeSingle();
      if (cc && cc.data) S.cost = cc.data.credits;
    } catch {
      /* 단가를 못 읽으면 줄을 감춘다 */
    }
    if (S.session) {
      try {
        S.balance = await loadBalance(sb, S.session);
      } catch {
        S.balance = null;
      }
    }
    renderBar();
  }

  // 냉장고 모델 (ai-design.html loadFridgeModels 와 같은 조회) — 못 받으면 「기본 모델」만
  var fridgeLoading = null;
  function loadFridgeModels() {
    if (S.fridgeRows) return fillFridgeModels();
    if (fridgeLoading || !S.sb) return fillFridgeModels();
    fridgeLoading = Promise.resolve(
      S.sb
        .from('appliance_models')
        .select('brand,model_name,model_code,subtype,width_mm,height_mm,depth_mm,image_path')
        .in('brand', ['삼성', 'LG'])
        .in('subtype', ['french_4door', 'kimchi_stand'])
        .eq('discontinued', false)
        .eq('verified', true)
        .order('width_mm')
    )
      .then(function (res) {
        if (res.error) throw res.error;
        S.fridgeRows = res.data || [];
        fillFridgeModels();
      })
      .catch(function () {
        fridgeLoading = null;
      });
    fillFridgeModels();
  }

  function fillFridgeModels() {
    var brand = S.choices.fBrand === 'lg' ? 'LG' : '삼성';
    [
      ['mkFModel', 'french_4door', 'fModel'],
      ['mkFKimchi', 'kimchi_stand', 'fKimchi'],
    ].forEach(function (t) {
      var sel = $(t[0]);
      var rows = (S.fridgeRows || []).filter(function (m) {
        return m.brand === brand && m.subtype === t[1];
      });
      sel.innerHTML =
        '<option value="">기본 모델</option>' +
        rows
          .map(function (m) {
            return (
              '<option value="' +
              esc(m.model_code) +
              '">' +
              esc(m.model_name + ' · ' + m.width_mm + '×' + m.height_mm + '×' + m.depth_mm) +
              '</option>'
            );
          })
          .join('');
      var keep = S.choices[t[2]];
      sel.value = rows.some(function (m) {
        return m.model_code === keep;
      })
        ? keep
        : '';
    });
  }

  // ── 연결 ────────────────────────────────────────────────
  function bindDrop(el) {
    ['dragenter', 'dragover'].forEach(function (t) {
      el.addEventListener(t, function (e) {
        e.preventDefault();
        el.classList.add('mk-drop--over');
      });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      el.addEventListener(t, function (e) {
        e.preventDefault();
        el.classList.remove('mk-drop--over');
      });
    });
    el.addEventListener('drop', function (e) {
      var fs = e.dataTransfer && e.dataTransfer.files;
      if (fs && fs.length) setPhoto(fs[0], false);
    });
  }

  function bind() {
    $('mkCamera').onclick = function () {
      $('mkCameraInput').click();
    };
    $('mkAlbum').onclick = function () {
      $('mkAlbumInput').click();
    };
    $('mkCameraInput').onchange = function (e) {
      if (e.target.files && e.target.files[0]) setPhoto(e.target.files[0], true);
    };
    $('mkAlbumInput').onchange = function (e) {
      if (e.target.files && e.target.files[0]) setPhoto(e.target.files[0], false);
    };
    $('mkClear').onclick = clearPhoto;
    bindDrop($('mkDrop'));

    $('mkNext').onclick = function () {
      if (S.photo) setStep('kind', true);
    };
    $('mkRun').onclick = run;

    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.onclick = function () {
        var to = b.getAttribute('data-goto');
        if (STEPS.indexOf(to) < STEPS.indexOf(S.step)) setStep(to, true);
      };
    });

    var pick = function (id, attr, key) {
      $(id).onclick = function (e) {
        var b = e.target.closest('[' + attr + ']');
        if (b) setChoice(key, b.getAttribute(attr));
      };
    };
    pick('mkKinds', 'data-kind', 'kind');
    pick('mkStyles', 'data-style', 'style');
    pick('mkDoors', 'data-door', 'door');
    pick('mkFBrands', 'data-fbrand', 'fBrand');
    pick('mkFPos', 'data-fpos', 'fPos');

    [
      ['mkWallW', 'wallW'],
      ['mkWater', 'water'],
      ['mkExhaust', 'exhaust'],
    ].forEach(function (t) {
      $(t[0]).oninput = function (e) {
        S.choices[t[1]] = String(e.target.value || '')
          .replace(/\D/g, '')
          .slice(0, 5);
        saveDraft();
      };
    });
    [
      ['mkFModel', 'fModel'],
      ['mkFKimchi', 'fKimchi'],
    ].forEach(function (t) {
      $(t[0]).onchange = function (e) {
        S.choices[t[1]] = e.target.value;
        saveDraft();
      };
    });

    // ③ 결과
    $('mkShots').onclick = function (e) {
      var b = e.target.closest('[data-shot]');
      if (!b) return;
      S.sel = Number(b.getAttribute('data-shot')) || 0;
      renderResult();
    };
    $('mkDownload').onclick = download;
    $('mkShare').onclick = share;
    $('mkAgain').onclick = restart;
    $('mkRetry').onclick = function () {
      setStep(S.photo ? 'kind' : 'photo', true);
    };
    // 결과 관리
    $('mkShareMake').onclick = makeShare;
    $('mkCopy').onclick = copyShare;
    $('mkShareStop').onclick = stopShare;
    $('mkUnpost').onclick = askUnpost;
    $('mkConsent').onclick = toggleConsent;
    $('mkRegen').onclick = askRegen;
    $('mkRegenNo').onclick = function () {
      S.regenAsk = '';
      renderManage();
    };
    $('mkRegenYes').onclick = regen;
    $('mkDelete').onclick = askDelete;

    window.addEventListener('popstate', function (e) {
      // 시트 · 옆 패널이 넣은 기록 칸 (shell.js SeganShell.sheet) — 주소가 그대로라 단계를 바꾸지 않는다
      if (sheetEntry(e)) return;
      var to = (location.hash || '').slice(1);
      setStep(STEPS.indexOf(to) >= 0 ? to : 'photo', false);
    });
  }

  async function init() {
    if (!$('mkDrop')) return;
    var d = readDraft();
    if (d) {
      S.choices = d.choices;
      S.photo = d.photo;
      S.step = d.photo && d.step !== 'photo' ? 'kind' : 'photo';
    }
    bind();
    S.sb = client();
    setStep(S.step, false);
    await loadAccount();
    // 저장된 결과 (?g=<id>) — 생성 직후 새로 고쳤거나, 내 연출컷 목록 · 상담 신청에서 돌아왔을 때. 읽기만 한다
    var g = new URLSearchParams(location.search).get('g');
    if (g && UUID_RE.test(g)) {
      if (S.session) api.opening = openGeneration(g);
      else showSignin(g);
    }
    window.dispatchEvent(new CustomEvent('segan:make-ready'));
  }

  var api = {
    KINDS: KINDS,
    STYLES: STYLES,
    DOORS: DOORS,
    FRIDGE_BRANDS: FRIDGE_BRANDS,
    FRIDGE_POS: FRIDGE_POS,
    DRAFT_KEY: DRAFT_KEY,
    REFUND_NOTE: REFUND_NOTE,
    DELETE_ASK: DELETE_ASK,
    LIST_NOTICE_KEY: LIST_NOTICE_KEY,
    state: S,
    readImage: readImage,
    exifFocal35: exifFocal35,
    /** 크레딧 통장 · 남은 크레딧 — my_credit_wallet (내 정보 탭도 쓴다) */
    loadWallet: loadWallet,
    loadBalance: loadBalance,
    paymentRequiredError: paymentRequiredError,
    loginHref: loginHref,
    /** 페이지 이동 — replace 면 지금 기록 칸을 바꾼다. 시험이 바꿔 끼운다 */
    go: function (url, replace) {
      if (replace) location.replace(url);
      else location.assign(url);
    },
    start: start,
    buildBody: buildBody,
    setPhoto: setPhoto,
    ready: null,
  };
  window.SeganMake = api;

  api.ready = new Promise(function (resolve) {
    var go = function () {
      init().then(resolve, resolve);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  });
})();
