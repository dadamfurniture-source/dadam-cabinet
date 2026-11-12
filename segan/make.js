/* ============================================================
   segan/make.js — 만들기 탭, 진행 단계 6칸:
     1 사진 → 2 품목 → 3 참고 사진 → 4 생성 → 5 견적서 → 6 상담 신청
   화면 단계는 넷이다 (주소 # — photo · kind · refs · result). 4 생성 · 5 견적서는 결과 화면 안에서 차례로 켜지고
   (진행 → 완료 + 예상 견적서), 6 상담 신청은 consult.html?g=<id> 로 간다 (결과의 「상담 신청」 버튼과 같다).

   생성 백엔드는 ai-design.html 이 쓰는 그대로다 (generate-api: POST /api/generate → 202, GET 으로 읽기).
   품목 · 스타일 · 도어 색 · 냉장고 · 치수 값도 ai-design.html 과 같은 목록이다 (시험이 둘을 비교한다).
   새 API 칸 · 품목 · 선택지를 만들지 않는다.

   ① 사진 — 고른 사진은 칸 안에 원본 전체가 보이게 그린다(전체 보기, 기본). 채워 보기는 보기만 바꾼다 —
   올리는 사진은 자르지 않는다 (긴 변 1600 JPEG 로 줄이기만 한다, ai-design.html 과 같다).

   ③ 참고 사진 (고르지 않아도 된다) — 시트(SeganShell.sheet)의 두 칸에서 최대 5장 (워커 MAX_REFS 와 같다):
     시공사례  collection_posts (AI 연출컷 source 'ai_render' 는 뺀다 — ai-design.html loadGallery 와 같다) + 자체 시공
               사진(segan/collection.js STATIC 과 같은 목록). 고른 품목의 사례가 있으면 그것만, 없으면 전체
     테마      theme_images (관리자가 고른 것 — status approved · is_active, 누구나 읽는다) 썸네일
   보낼 때 사진을 받아 방 사진처럼 긴 변 1600 JPEG 로 줄여 reference_images 로 싣는다 (ai-design.html run() 과 같은 모양):
     { base64, mimeType, role: 'style'(시공사례) | 'theme'(테마), note?(테마 설명 — 테마일 때만) }
   못 받은 사진은 빼고 만든다 (그렇다고 알린다). 크레딧은 그대로 한 번 단가다.
   고른 것은 이 기기(sessionStorage)에 id · 주소 · 이름만 담는다 — 그림 자료는 담지 않는다.
   ?ref=<시공사례 id> (또는 ?refs=a,b — 자체 시공 사진은 파일 이름, 예: kitchen-n1-1) 로 열면 그 사진을 미리 담는다.

   결과(./?g=<id>#result)가 연출컷 결과 화면 하나다 — 방금 만든 것도, 내 연출컷 목록(renders.html)에서
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

   로그인 문 — 누구나 사진 · 품목 · 참고 사진을 고를 수 있다. 크레딧을 쓰는 버튼(연출컷 생성)을 누를 때
   로그인이 없으면, 사진과 고른 값을 이 기기(sessionStorage)에만 담고 기존 login.html 로 보낸다
   (돌아올 곳 = 이 페이지). 돌아오면 같은 단계 · 같은 사진 · 같은 선택으로 되살린다 — 다시 한 번
   누르기만 하면 된다. 저절로 생성하지 않는다. 로그인 전에는 아무것도 올리지 않는다.
   담아 둔 사진은 생성이 시작되면, 또는 사진을 버리면(다시 선택) 지운다.

   쓰는 페이지: segan/make.html (data-tab="make")
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
  // ③ 시공사례를 고른 품목으로 거를 때 쓰는 collection_posts.category (ai-design.html KINDS[].collection 과 같다)
  var CASE_KINDS = {
    sink: ['kitchen'],
    island: ['kitchen'],
    wardrobe: ['builtin'],
    storage: ['storage'],
    fridge: ['kitchen'],
    vanity: ['interior'],
    shoe: ['builtin'],
    office: ['other'],
    study: ['other'],
    bedroom: ['builtin'],
  };
  // 자체 시공 사진 — segan/collection.js STATIC 과 같은 사진 · 지역 (분류는 ai-design.html CASE_STATIC 과 같다)
  var CASE_STATIC = [
    { image_url: '../app/portfolio/kitchen-n1-1.jpg', region: '서울 논현', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n1-2.jpg', region: '서울 성수', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n1-3.jpg', region: '서울 성수', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n1-4.jpg', region: '서울 반포', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n3-2.jpg', region: '성남 분당', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n3-3.jpg', region: '인천 송도', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n4-1.jpg', region: '성남 판교', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n6-1.jpg', region: '고양 일산', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n6-2.jpg', region: '용인 수지', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n6-3.jpg', region: '고양 일산', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n7-1.jpg', region: '하남 위례', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n7-2.jpg', region: '수원 광교', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n7-3.jpg', region: '서울 마포', category: 'kitchen' },
    { image_url: '../app/portfolio/kitchen-n7-4.jpg', region: '수원 광교', category: 'kitchen' },
    { image_url: '../app/portfolio/funiture-n4-1.jpg', region: '서울 논현', category: 'builtin' },
  ];

  var MAX_BYTES = 20 * 1024 * 1024;
  var MAX_EDGE = 1600; // 업로드 전 축소 (ai-design.html 과 같다)
  var DRAFT_KEY = 'segan.make.draft.v1';
  var LOGIN_PAGE = '../login.html';
  var RETURN_TARGET = 'segan/make.html'; // login.html ?redirect= — js/auth-redirect.js 가 받는 같은 사이트 *.html
  var STEPS = ['photo', 'kind', 'refs', 'result'];
  // 진행 단계 줄 6칸 — 4 생성 · 5 견적서는 결과 화면(result) 안, 6 상담 신청은 consult.html
  var MARKS = ['photo', 'kind', 'refs', 'make', 'quote', 'consult'];
  var CONSULT_PAGE = 'consult.html';

  // ③ 참고 사진
  var MAX_REFS = 5; // generate-api worker.js MAX_REFS 와 같다 (넘는 것은 워커가 버린다)
  var REF_EDGE = MAX_EDGE; // 보내기 전 긴 변 — 방 사진과 같은 1600 JPEG (ai-design.html 업로드 참고 이미지와 같다)
  var REF_PAGE = 12; // 고르기 창에 한 번에 그리는 장 수 (「더 보기」마다 더)
  var REF_ROWS = 300; // 서버에서 읽는 줄 수 (ai-design.html loadGallery 와 같다)
  var THEME_BUCKET = 'theme-images'; // js/reference-images.js BUCKET 과 같다
  var REF_FULL = '최대 ' + MAX_REFS + '장까지 고를 수 있습니다';
  var REF_ID_RE = /^(c:[0-9a-f-]{36}|t:[0-9a-f-]{36}|s:[a-z0-9-]{1,40})$/i;
  var STATIC_STEM_RE = /^[a-z0-9-]{1,40}$/i;

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
    fit: 'contain', // ① 사진 보기 — contain(전체 보기) | cover(채워 보기). 보기만 바꾼다
    choices: Object.assign({}, DEFAULTS),
    refs: [], // ③ 고른 참고 사진 (고른 차례) — [{ id, src, label, note? }]. id: c:<게시물> · s:<자체 사진> · t:<테마>
    cases: null, // 시공사례 목록 (읽기 전 null) — [{ id, src, label, category }]
    themes: null, // 테마 목록 (읽기 전 null) — [{ id, src, label, note? }]
    casesFailed: false, // 지난번에 못 읽었다 — 고르기 창을 다시 열면 다시 읽는다
    themesFailed: false,
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

  /** 담아 둔 참고 사진 — id · 주소 · 이름(· 테마 설명)만. 모양이 이상한 것은 버린다 (최대 5장, 같은 id 는 하나) */
  function cleanRefs(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (r) {
      if (out.length >= MAX_REFS || !r || typeof r !== 'object') return;
      if (typeof r.id !== 'string' || !REF_ID_RE.test(r.id) || refIndexIn(out, r.id) >= 0) return;
      if (!safeSrc(r.src)) return;
      var ref = {
        id: r.id,
        src: r.src,
        label: typeof r.label === 'string' ? r.label.slice(0, 80) : '',
      };
      if (refRole(ref) === 'theme' && typeof r.note === 'string' && r.note)
        ref.note = r.note.slice(0, 200);
      out.push(ref);
    });
    return out;
  }

  function readDraft() {
    try {
      var d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (!d || d.v !== 1) return null;
      return {
        step: STEPS.indexOf(d.step) >= 0 && d.step !== 'result' ? d.step : 'photo',
        choices: cleanChoices(d.choices),
        photo: cleanPhoto(d.photo),
        refs: cleanRefs(d.refs),
      };
    } catch {
      return null;
    }
  }

  /** 지금 상태를 담는다. 사진이 너무 커서 못 담으면 고른 값만 담고 false. 참고 사진은 id · 주소만 */
  function saveDraft() {
    var base = {
      v: 1,
      step: S.step === 'result' ? 'refs' : S.step,
      choices: S.choices,
      refs: cleanRefs(S.refs),
    };
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

  /** 담아 둔 사진만 지운다 (고른 값 · 참고 사진은 남긴다) */
  function dropDraftPhoto() {
    var d = readDraft();
    try {
      if (!d) sessionStorage.removeItem(DRAFT_KEY);
      else
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ v: 1, step: 'photo', choices: d.choices, refs: d.refs, photo: null })
        );
    } catch {
      /* noop */
    }
  }

  // ── ③ 참고 사진 — 공용 ────────────────────────────────
  /** 시공사례(c: · s:)는 설치 참고 'style', 테마(t:)는 색감만 'theme' (워커 normalizeRefs 의 두 역할) */
  function refRole(r) {
    return /^t:/.test(r.id) ? 'theme' : 'style';
  }

  function refIndexIn(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return i;
    return -1;
  }

  function refIndex(id) {
    return refIndexIn(S.refs, id);
  }

  /** 담거나 그릴 수 있는 주소 — https 주소 또는 자체 시공 사진(../app/portfolio/…) */
  function safeSrc(u) {
    return (
      typeof u === 'string' &&
      u.length <= 1000 &&
      (/^https:\/\/[^\s"'()\\<>]+$/.test(u) || /^\.\.\/app\/portfolio\/[\w.-]+\.jpg$/.test(u))
    );
  }

  /** CSS url() 안에 넣을 주소 — 따옴표 · 괄호 · 역슬래시를 막는다 (segan/collection.js 와 같다) */
  function cssUrl(u) {
    return 'url("' + String(u || '').replace(/["\\\n\r()]/g, encodeURIComponent) + '")';
  }

  /** 화면에 그리는 작은 그림 — 자체 시공 사진은 가벼운 사본(app/portfolio/display/), 그 밖은 그대로 */
  function refThumb(r) {
    var m = /^s:(.+)$/.exec(r.id);
    return m ? '../app/portfolio/display/' + m[1] + '.jpg' : r.src;
  }

  function caseLabel(region) {
    var g = String(region || '').trim();
    return g ? '다담가구 · ' + g : '다담가구'; // ai-design.html caseLabel 과 같다
  }

  function staticCase(row) {
    var stem = row.image_url.replace(/^.*\//, '').replace(/\.jpg$/, '');
    return {
      id: 's:' + stem,
      src: row.image_url,
      label: caseLabel(row.region),
      category: row.category,
    };
  }

  function themeLabel(key) {
    var R = window.DadamRefImages;
    if (R && typeof R.themeLabel === 'function') return R.themeLabel(key) || '테마';
    return String(key || '') || '테마';
  }

  /** 테마 썸네일 공개 주소 (버킷 theme-images 는 공개 — ai-design.html 이 getPublicUrl 로 만드는 것과 같은 주소) */
  function themeUrl(path) {
    var base =
      window.DADAM_CONFIG && window.DADAM_CONFIG.supabase && window.DADAM_CONFIG.supabase.url;
    if (!base || !path) return '';
    var bucket = (window.DadamRefImages && window.DadamRefImages.BUCKET) || THEME_BUCKET;
    return (
      String(base).replace(/\/+$/, '') +
      '/storage/v1/object/public/' +
      bucket +
      '/' +
      String(path).split('/').map(encodeURIComponent).join('/')
    );
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

  /** 진행 단계 줄에서 지금 칸 — 결과 화면은 끝나고 견적서가 오면 5, 그 전(진행 · 실패)은 4 */
  function currentMark() {
    if (S.step !== 'result') return S.step;
    return S.phase === 'done' && S.quote ? 'quote' : 'make';
  }

  function consultHref() {
    return CONSULT_PAGE + '?g=' + encodeURIComponent(S.genId);
  }

  function renderSteps() {
    var at = STEPS.indexOf(S.step);
    var mark = MARKS.indexOf(currentMark());
    document.querySelectorAll('[data-mark]').forEach(function (b) {
      var i = MARKS.indexOf(b.getAttribute('data-mark'));
      b.classList.toggle('mk-stepnav--done', i <= mark);
      if (i === mark) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      var to = b.getAttribute('data-goto');
      if (to === 'consult') {
        // 6 상담 신청 — 연출컷이 끝난 뒤에만 (결과의 「상담 신청」 버튼과 같은 곳으로 간다)
        b.disabled = !(S.phase === 'done' && S.genId);
        return;
      }
      // 지나온 단계만 누를 수 있다 (되돌아가기). 결과(4 · 5)는 생성이 시작된 뒤에는 다시 갈 수 있다
      var t = STEPS.indexOf(to);
      b.disabled = t === at || (t > at && !(to === 'result' && S.genId));
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
    $('mkFitRow').hidden = !p;
    $('mkDrop').classList.toggle('mk-drop--photo', !!p);
    // 칸은 늘 같은 모양(4:3) — 원본 전체를 칸 안에 보인다(contain). 채워 보기(cover)는 보기만 바꾼다
    $('mkDrop').classList.toggle('mk-drop--fill', !!p && S.fit === 'cover');
    $('mkFit')
      .querySelectorAll('[data-fit]')
      .forEach(function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-fit') === S.fit));
      });
    if (p) {
      $('mkPhoto').src = 'data:' + p.mime + ';base64,' + p.base64;
      $('mkFile').textContent = p.name + ' · 준비됨';
    } else {
      $('mkPhoto').removeAttribute('src');
      $('mkFile').textContent = '';
    }
    var n = S.refs.length;
    $('mkRefNote').hidden = !n;
    $('mkRefNote').textContent = n
      ? '참고 사진 ' + n + '장을 담아 두었습니다 · 3 참고 사진에서 바꿀 수 있습니다'
      : '';
  }

  // ── ③ 참고 사진 ────────────────────────────────────────
  function renderRefs() {
    var box = $('mkRefs');
    if (!box) return;
    $('mkRefCount').textContent = S.refs.length + ' / ' + MAX_REFS;
    box.innerHTML = S.refs.length
      ? S.refs
          .map(function (r) {
            var kind = refRole(r) === 'theme' ? '테마' : '시공사례';
            return (
              '<figure class="mk-ref"><span class="mk-ref-img" style="background-image:' +
              esc(cssUrl(refThumb(r))) +
              '"></span><figcaption class="mk-ref-cap">' +
              esc(kind + (r.label ? ' · ' + r.label : '')) +
              '</figcaption><button type="button" class="mk-btn mk-ref-x" data-unref="' +
              esc(r.id) +
              '" aria-label="' +
              esc(kind + ' ' + (r.label || '사진') + ' 빼기') +
              '">빼기</button></figure>'
            );
          })
          .join('')
      : '<p class="mk-note mk-refs-empty">고른 사진이 없습니다</p>';
  }

  function removeRef(id) {
    var i = refIndex(id);
    if (i < 0) return;
    S.refs.splice(i, 1);
    saveDraft();
    renderRefs();
    renderPhoto();
    syncPicker();
  }

  /**
   * 시공사례 — collection_posts 최신순 (AI 연출컷은 뺀다 · ai-design.html loadGallery 와 같다) + 자체 시공 사진.
   * 못 읽으면 자체 시공 사진만 보이고, 다음에 창을 열 때 다시 읽는다.
   */
  async function loadCases() {
    if (S.cases) return S.cases;
    var rows = [];
    var failed = false;
    if (S.sb) {
      try {
        var res = await S.sb
          .from('collection_posts')
          .select('id, image_url, region, category, source')
          .neq('source', 'ai_render')
          .order('created_at', { ascending: false })
          .limit(REF_ROWS);
        if (res && !res.error) rows = res.data || [];
        else failed = true;
      } catch {
        failed = true; // 자체 시공 사진만
      }
    }
    S.cases = rows
      .filter(function (r) {
        return r && UUID_RE.test(r.id) && safeSrc(r.image_url) && r.source !== 'ai_render';
      })
      .map(function (r) {
        return {
          id: 'c:' + r.id,
          src: r.image_url,
          label: caseLabel(r.region),
          category: r.category || '',
        };
      })
      .concat(CASE_STATIC.map(staticCase));
    S.casesFailed = failed;
    return S.cases;
  }

  /** 테마 — theme_images (관리자가 고른 것만 · 누구나 읽는다). 썸네일을 그리고, 그것을 보낸다 (ai-design.html 과 같다) */
  async function loadThemes() {
    if (S.themes) return S.themes;
    var rows = [];
    var failed = !S.sb;
    if (S.sb) {
      try {
        var res = await S.sb
          .from('theme_images')
          .select('id, theme, thumb_path, note')
          .eq('status', 'approved')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(REF_ROWS);
        if (res && !res.error) rows = res.data || [];
        else failed = true;
      } catch {
        failed = true;
      }
    }
    S.themes = rows
      .filter(function (r) {
        return r && UUID_RE.test(r.id) && r.thumb_path;
      })
      .map(function (r) {
        var t = { id: 't:' + r.id, src: themeUrl(r.thumb_path), label: themeLabel(r.theme) };
        if (r.note) t.note = String(r.note).slice(0, 200); // 관리자가 적은 사진 설명 — 색감을 뽑을 때 힌트
        return t;
      })
      .filter(function (t) {
        return safeSrc(t.src);
      });
    S.themesFailed = failed;
    return S.themes;
  }

  /** 고른 품목의 시공사례만 — 없으면 전체 (ai-design.html caseByKind 와 같다) */
  function caseScope() {
    var all = S.cases || [];
    var cats = CASE_KINDS[S.choices.kind] || [];
    var hit = all.filter(function (r) {
      return cats.indexOf(r.category) >= 0;
    });
    return hit.length ? { list: hit, filtered: true } : { list: all, filtered: false };
  }

  function kindLabel() {
    for (var i = 0; i < KINDS.length; i++)
      if (KINDS[i].key === S.choices.kind) return KINDS[i].label;
    return '';
  }

  // 고르기 창 (시트 · PC 옆 패널) — 열려 있는 동안만 P 가 있다
  var P = null;

  function pickTile(r) {
    return (
      '<button type="button" class="mk-pick-tile" data-ref="' +
      esc(r.id) +
      '" aria-pressed="false" aria-label="' +
      esc(r.label || '사진') +
      '"><span class="mk-pick-img" style="background-image:' +
      esc(cssUrl(refThumb(r))) +
      '"></span><span class="mk-pick-cap">' +
      esc(r.label) +
      '</span><span class="mk-pick-no" aria-hidden="true"></span></button>'
    );
  }

  function pickList(tab) {
    if (tab === 'theme') return S.themes;
    return S.cases ? caseScope().list : null;
  }

  /** 지금 칸을 다시 그린다 (칸을 바꿨거나 목록이 왔을 때) */
  function paintPicker() {
    if (!P) return;
    var b = P.body;
    var tab = P.tab;
    b.querySelectorAll('[data-reftab]').forEach(function (t) {
      t.setAttribute('aria-selected', String(t.getAttribute('data-reftab') === tab));
    });
    b.querySelector('[data-pick-about]').textContent =
      tab === 'theme'
        ? '분위기 · 색감만 빌려 추천안 한 장을 만듭니다. 다담이 고른 사진만 씁니다.'
        : '다담가구 시공 사진 — 도어 색 · 마감 · 분위기를 참고합니다.';
    var list = pickList(tab);
    var grid = b.querySelector('[data-pick-grid]');
    var hint = b.querySelector('[data-pick-hint]');
    var more = b.querySelector('[data-pick-more]');
    if (!list) {
      grid.innerHTML = '';
      hint.textContent = '불러오는 중…';
      more.hidden = true;
      return;
    }
    var shown = list.slice(0, P.shown[tab]);
    grid.innerHTML = shown.map(pickTile).join('');
    P.drawn[tab] = shown.length;
    paintHint();
    syncPicker();
  }

  function paintHint() {
    var b = P.body;
    var tab = P.tab;
    var list = pickList(tab) || [];
    var n = P.drawn[tab];
    var hint = b.querySelector('[data-pick-hint]');
    if (!list.length) {
      hint.textContent =
        tab === 'theme'
          ? S.themesFailed
            ? '테마 사진을 불러오지 못했습니다 · 창을 다시 열면 다시 읽습니다'
            : '아직 준비된 테마 사진이 없습니다'
          : '아직 시공사례가 없습니다';
    } else if (tab === 'case') {
      var scope = caseScope();
      var k = kindLabel();
      hint.textContent =
        (scope.filtered ? k + ' 사례 ' : k ? k + ' 사례가 아직 없어 전체 ' : '전체 ') +
        n +
        ' / ' +
        list.length;
    } else {
      hint.textContent = n + ' / ' + list.length;
    }
    b.querySelector('[data-pick-more]').hidden = n >= list.length;
  }

  /** 누른 표시 · 고른 차례 번호 · 장수 — 그림판은 다시 그리지 않는다 (다시 그리면 스크롤이 맨 위로 튄다) */
  function syncPicker() {
    if (!P) return;
    P.body.querySelectorAll('[data-ref]').forEach(function (t) {
      var i = refIndex(t.getAttribute('data-ref'));
      t.setAttribute('aria-pressed', String(i >= 0));
      t.querySelector('.mk-pick-no').textContent = i >= 0 ? String(i + 1) : '';
    });
    P.body.querySelector('[data-pick-count]').textContent =
      S.refs.length + ' / ' + MAX_REFS + ' 선택';
    var msg = P.body.querySelector('[data-pick-msg]');
    msg.textContent = P.msg;
    msg.hidden = !P.msg;
  }

  function findRef(id) {
    var lists = [S.cases || [], S.themes || []];
    for (var k = 0; k < lists.length; k++) {
      var i = refIndexIn(lists[k], id);
      if (i >= 0) return lists[k][i];
    }
    return null;
  }

  function toggleRef(id) {
    var i = refIndex(id);
    P.msg = '';
    if (i >= 0) S.refs.splice(i, 1);
    else if (S.refs.length >= MAX_REFS) P.msg = REF_FULL;
    else {
      var r = findRef(id);
      if (!r) return;
      var ref = { id: r.id, src: r.src, label: r.label };
      if (r.note) ref.note = r.note;
      S.refs.push(ref);
    }
    saveDraft();
    syncPicker();
    renderRefs();
    renderPhoto();
  }

  async function pickTab(tab) {
    if (!P) return;
    P.tab = tab;
    P.msg = '';
    paintPicker();
    if (pickList(tab)) return;
    await (tab === 'theme' ? loadThemes() : loadCases());
    if (P && P.tab === tab) paintPicker();
  }

  function onPickClick(e) {
    var t = e.target.closest('[data-reftab]');
    if (t) {
      api.picking = pickTab(t.getAttribute('data-reftab'));
      return;
    }
    var tile = e.target.closest('[data-ref]');
    if (tile) {
      toggleRef(tile.getAttribute('data-ref'));
      return;
    }
    if (e.target.closest('[data-pick-more]')) {
      var list = pickList(P.tab) || [];
      var from = P.drawn[P.tab];
      var next = list.slice(from, from + REF_PAGE);
      P.body
        .querySelector('[data-pick-grid]')
        .insertAdjacentHTML('beforeend', next.map(pickTile).join(''));
      P.drawn[P.tab] = from + next.length;
      P.shown[P.tab] = P.drawn[P.tab];
      paintHint();
      syncPicker();
      return;
    }
    if (e.target.closest('[data-pick-done]')) P.h.close();
  }

  /** 「참고 사진 고르기」 — 시트(폰) · 옆 패널(PC). 뒤로 가기는 창만 닫는다 (셸이 기록 칸을 맡는다) */
  function openPicker() {
    var sheet = window.SeganShell && window.SeganShell.sheet;
    if (!sheet || P) return null;
    // 지난번에 못 읽은 목록은 다시 읽는다
    if (S.casesFailed) S.cases = null;
    if (S.themesFailed) S.themes = null;
    var body = document.createElement('div');
    body.className = 'mk-pick';
    body.innerHTML =
      '<div class="cl-seg" role="tablist" aria-label="참고 사진 종류">' +
      '<button type="button" role="tab" data-reftab="case" aria-selected="true">시공사례</button>' +
      '<button type="button" role="tab" data-reftab="theme" aria-selected="false">테마</button>' +
      '</div>' +
      '<p class="mk-note" data-pick-about></p>' +
      '<div class="mk-pick-grid" data-pick-grid></div>' +
      '<p class="mk-note" data-pick-hint></p>' +
      '<button type="button" class="mk-btn mk-btn--wide" data-pick-more hidden>더 보기</button>' +
      '<div class="mk-pick-foot">' +
      '<span class="mk-pick-count" data-pick-count aria-live="polite"></span>' +
      '<span class="mk-pick-msg" data-pick-msg role="status" hidden></span>' +
      '<button type="button" class="mk-btn mk-btn--solid" data-pick-done>완료</button>' +
      '</div>';
    P = {
      body: body,
      tab: 'case',
      shown: { case: REF_PAGE, theme: REF_PAGE },
      drawn: { case: 0, theme: 0 },
      msg: '',
    };
    body.addEventListener('click', onPickClick);
    var mine = P;
    P.h = sheet.open({
      title: '참고 사진 고르기',
      body: body,
      kind: 'sheet',
      onClose: function () {
        if (P === mine) P = null;
        renderRefs();
      },
    });
    api.picking = pickTab('case');
    return P.h;
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
    var refs = S.step === 'refs';
    // ① → ② → ③ 은 「다음」, ③ 에서 「연출컷 생성」 (참고 사진은 고르지 않아도 된다)
    $('mkNext').hidden = !(S.step === 'photo' || kind);
    $('mkNext').disabled = !S.photo;
    $('mkNext').textContent = kind ? '다음 · 참고 사진 고르기' : '다음 · 품목 고르기';
    $('mkRun').hidden = !refs;
    // 참고 사진을 준비하거나 요청을 보내는 동안은 막는다 (시작된 뒤 누르면 결과 화면으로 간다)
    $('mkRun').disabled = !S.photo || (S.phase === 'loading' && !S.genId);
    $('mkPost').hidden = !refs;
    var cost = refs ? costText() : '';
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
    renderRefs();
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
      api.go('make.html?g=' + encodeURIComponent(data.id) + '#result');
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

  /** 5 견적서 (예상 견적) — ai-design.html 과 같은 줄(품목 · 금액)과 합계 (VAT 포함) */
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
    $('mkConsult').setAttribute('href', consultHref());
  }

  // ── 단계 이동 ───────────────────────────────────────────
  /** popstate 가 시트 · 옆 패널의 기록 칸인가 (segan/shell.js SeganShell.sheet.isSheetState) */
  function sheetEntry(e) {
    var sheet = window.SeganShell && window.SeganShell.sheet;
    return !!(sheet && sheet.isSheetState(e && e.state));
  }

  function setStep(step, push) {
    if (step === 'result' && !S.genId) step = 'refs';
    if ((step === 'kind' || step === 'refs') && !S.photo) step = 'photo';
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
    S.fit = 'contain'; // 새 사진은 전체 보기부터
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
      // 로그인 전: 이 기기에만 담고 로그인하러 간다. 돌아오면 같은 단계로 되살린다 (참고 사진은 id · 주소만).
      S.step = 'refs';
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

  /**
   * 요청 본문 — ai-design.html run() 과 같은 칸. 상세 요청(customer_request)은 앱에서 뺐다.
   * refs: 보낼 참고 사진 (encodeRefs) — [{ base64, mimeType, role, note? }]. 없으면 칸째 뺀다 (예전과 같은 본문)
   */
  function buildBody(refs) {
    var c = S.choices;
    var p = S.photo;
    var kitchen = KITCHEN_KINDS.indexOf(c.kind) >= 0;
    var body = {
      room_image: p.base64,
      image_type: p.mime,
      category: c.kind,
      design_style: c.style,
      door_color: c.door,
      reference_images: refs && refs.length ? refs : undefined,
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

  /** 긴 변을 max 까지 줄인 크기 (키우지는 않는다) — js/reference-images.js fitLongEdge 와 같은 셈 */
  function fitEdge(w, h, max) {
    var long = Math.max(w, h);
    if (!long || long <= max) return { w: Math.round(w), h: Math.round(h) };
    var k = max / long;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  /** 그림 파일(Blob) → 긴 변 REF_EDGE 의 JPEG base64. 투명한 곳은 흰 바탕 (JPEG 는 투명이 없다) */
  function shrinkBlob(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob); // 같은 출처 주소라 캔버스가 더럽혀지지 않는다
      var img = new Image();
      var done = function () {
        URL.revokeObjectURL(url);
      };
      img.onerror = function () {
        done();
        reject(new Error('이미지를 열지 못했습니다'));
      };
      img.onload = function () {
        try {
          var size = fitEdge(img.naturalWidth, img.naturalHeight, REF_EDGE);
          var cv = document.createElement('canvas');
          cv.width = size.w;
          cv.height = size.h;
          var ctx = cv.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, size.w, size.h);
          ctx.drawImage(img, 0, 0, size.w, size.h);
          resolve({
            base64: cv.toDataURL('image/jpeg', 0.9).split(',')[1],
            mimeType: 'image/jpeg',
          });
        } catch (e) {
          reject(e);
        }
        done();
      };
      img.src = url;
    });
  }

  /**
   * 참고 사진 하나 → { base64, mimeType }. 주소에서 받아(ai-design.html fetchAsBase64 와 같이) 줄인다.
   * 시험이 바꿔 끼운다 (api.readRef)
   */
  async function readRef(ref) {
    var res = await fetch(ref.src, { cache: 'force-cache' });
    if (!res.ok) throw new Error('참고 사진을 받지 못했습니다');
    return shrinkBlob(await res.blob());
  }

  /**
   * 고른 참고 사진을 보낼 모양으로 (고른 차례) — 못 받은 것은 뺀다. { list, skipped }
   * 한 장씩 차례로 줄인다 — 폰에서 큰 사진 다섯 장을 한꺼번에 풀면 메모리가 모자랄 수 있다
   */
  async function encodeRefs() {
    var picked = S.refs.slice(0, MAX_REFS);
    var list = [];
    for (var i = 0; i < picked.length; i++) {
      var r = picked[i];
      try {
        var img = await api.readRef(r);
        if (!img || typeof img.base64 !== 'string' || !img.base64) continue;
        var role = refRole(r);
        var ref = { base64: img.base64, mimeType: img.mimeType || 'image/jpeg', role: role };
        // 테마 사진의 설명은 색감을 뽑을 때 힌트로 쓴다 (워커 cleanThemeNote — 테마일 때만 받는다)
        if (role === 'theme' && r.note) ref.note = r.note;
        list.push(ref);
      } catch {
        /* 이 한 장만 뺀다 */
      }
    }
    return { list: list, skipped: picked.length - list.length };
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
    // 참고 사진을 받아 줄이는 동안 — 버튼은 막고 안내한다 (renderBar)
    S.notice = S.refs.length ? '참고 사진을 준비하는 중' : '';
    renderBar();
    try {
      $('mkRun').disabled = true;
      var refs = await encodeRefs();
      var body = buildBody(refs.list);
      S.notice = '';
      renderBar();
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
      if (refs.skipped) S.resMsg = '참고 사진 ' + refs.skipped + '장을 불러오지 못해 빼고 만듭니다';
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
        // 시작도 못 했다 — 생성 버튼이 있는 참고 사진 단계에서 안내하고 다시 누를 수 있게
        S.phase = 'idle';
        S.notice = S.error;
        S.step = 'refs';
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
    // 전체 보기 · 채워 보기 — 보기만 바꾼다
    $('mkFit').onclick = function (e) {
      var b = e.target.closest('[data-fit]');
      if (!b) return;
      S.fit = b.getAttribute('data-fit') === 'cover' ? 'cover' : 'contain';
      renderPhoto();
    };

    $('mkNext').onclick = function () {
      if (!S.photo) return;
      if (S.step === 'photo') setStep('kind', true);
      else if (S.step === 'kind') setStep('refs', true);
    };
    $('mkRun').onclick = run;

    // ③ 참고 사진
    $('mkRefPick').onclick = openPicker;
    $('mkRefs').onclick = function (e) {
      var b = e.target.closest('[data-unref]');
      if (b) removeRef(b.getAttribute('data-unref'));
    };

    // 진행 단계 줄 — 누를 수 있는 칸만 (renderSteps). 6 상담 신청은 consult.html 로
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.onclick = function () {
        if (b.disabled) return;
        var to = b.getAttribute('data-goto');
        if (to === 'consult') {
          if (S.genId && S.phase === 'done') api.go(consultHref());
          return;
        }
        if (to !== S.step) setStep(to, true);
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
      setStep(S.photo ? 'refs' : 'photo', true);
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

  /**
   * ?ref=<시공사례 id> · ?refs=a,b — 시공사례 화면의 「이 스타일로 연출컷」. 읽고 주소에서 뗀다
   * (새로 고쳐도 다시 담지 않게 — 고른 것은 이 기기에 담는다). 자체 시공 사진은 파일 이름(kitchen-n1-1)
   */
  function takeLinkRefs() {
    var q = new URLSearchParams(location.search);
    var raw = [];
    ['ref', 'refs'].forEach(function (k) {
      q.getAll(k).forEach(function (v) {
        String(v || '')
          .split(',')
          .forEach(function (t) {
            t = t.trim();
            if (t && raw.indexOf(t) < 0) raw.push(t);
          });
      });
      q.delete(k);
    });
    if (!raw.length) return [];
    try {
      var rest = q.toString();
      history.replaceState(
        history.state,
        '',
        location.pathname + (rest ? '?' + rest : '') + location.hash
      );
    } catch {
      /* noop */
    }
    return raw.slice(0, MAX_REFS * 2);
  }

  /** 주소로 받은 시공사례를 고른 차례대로 담는다 — AI 연출컷 · 없는 글은 건너뛴다. 담은 장수 */
  async function addLinkRefs(tokens) {
    var ids = tokens.filter(function (t) {
      return UUID_RE.test(t);
    });
    var rows = {};
    if (ids.length && S.sb) {
      try {
        var res = await S.sb
          .from('collection_posts')
          .select('id, image_url, region, category, source')
          .in('id', ids);
        ((res && !res.error && res.data) || []).forEach(function (r) {
          if (r && r.source !== 'ai_render' && safeSrc(r.image_url))
            rows[String(r.id).toLowerCase()] = r;
        });
      } catch {
        /* 못 읽으면 담지 않는다 */
      }
    }
    var added = 0;
    tokens.forEach(function (t) {
      if (S.refs.length >= MAX_REFS) return;
      var ref = null;
      if (UUID_RE.test(t)) {
        var r = rows[t.toLowerCase()];
        if (r) ref = { id: 'c:' + r.id, src: r.image_url, label: caseLabel(r.region) };
      } else {
        var stem = t.replace(/^s:/, '');
        if (STATIC_STEM_RE.test(stem)) {
          CASE_STATIC.forEach(function (row) {
            var c = staticCase(row);
            if (c.id === 's:' + stem) ref = { id: c.id, src: c.src, label: c.label };
          });
        }
      }
      if (ref && refIndex(ref.id) < 0) {
        S.refs.push(ref);
        added++;
      }
    });
    return added;
  }

  async function init() {
    if (!$('mkDrop')) return;
    var d = readDraft();
    if (d) {
      S.choices = d.choices;
      S.photo = d.photo;
      S.refs = d.refs;
      S.step = d.photo && d.step !== 'photo' ? d.step : 'photo';
    }
    var linked = takeLinkRefs();
    bind();
    S.sb = client();
    setStep(S.step, false);
    if (linked.length && (await addLinkRefs(linked))) {
      saveDraft();
      render();
    }
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
    STEPS: STEPS,
    MARKS: MARKS,
    MAX_REFS: MAX_REFS,
    REF_EDGE: REF_EDGE,
    CASE_KINDS: CASE_KINDS,
    CASE_STATIC: CASE_STATIC,
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
    /** ③ 참고 사진 — 고르기 창 열기 · 사진 하나 받기(시험이 바꿔 끼운다) · 긴 변 줄이기 */
    openPicker: openPicker,
    readRef: readRef,
    fitEdge: fitEdge,
    picking: null, // 고르기 창의 목록 읽기 (시험이 기다린다)
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
