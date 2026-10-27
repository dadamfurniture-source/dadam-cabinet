/* ============================================================
   segan/make.js — 만들기 탭: ① 사진 → ② 가구 → ③ 결과

   생성 백엔드는 ai-design.html 이 쓰는 그대로다 (generate-api: POST /api/generate → 202, GET 으로 읽기).
   품목 · 스타일 · 도어 색 · 냉장고 · 치수 값도 ai-design.html 과 같은 목록이다 (시험이 둘을 비교한다).
   새 API 칸 · 품목 · 선택지를 만들지 않는다.

   로그인 문 — 누구나 사진을 고르고 가구를 고를 수 있다. 크레딧을 쓰는 버튼(연출컷 생성)을 누를 때
   로그인이 없으면, 사진과 고른 값을 이 기기(sessionStorage)에만 담고 기존 login.html 로 보낸다
   (돌아올 곳 = 이 페이지). 돌아오면 같은 단계 · 같은 사진 · 같은 선택으로 되살린다 — 다시 한 번
   누르기만 하면 된다. 저절로 생성하지 않는다. 로그인 전에는 아무것도 올리지 않는다.
   담아 둔 사진은 생성이 시작되면, 또는 사진을 버리면(다시 선택) 지운다.

   쓰는 페이지: segan/index.html (data-tab="make")
   의존: js/config.js · supabase-js (없으면 로그인 안 된 것으로 본다)
   ============================================================ */
/* global window, document, location, history, sessionStorage, FileReader, Image, atob, CustomEvent */
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
    balance: null, // 남은 크레딧 — user_credits, 없으면 등급 지급량 (js/site-shell.js 와 같은 규칙)
    notice: '',
    fridgeRows: null,
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
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify(Object.assign({}, base, { photo: S.photo }))
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
      // 지나온 단계만 누를 수 있다 (되돌아가기)
      b.disabled = i >= at;
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
  }

  // ── 단계 이동 ───────────────────────────────────────────
  function setStep(step, push) {
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

  /** 생성 시작 — 결과 단계는 다음 작업에서 붙는다. 지금은 안내만 */
  async function startPlaceholder() {
    S.notice = '연출컷 생성은 곧 열립니다.';
    renderBar();
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

  /** 남은 크레딧 — js/site-shell.js 와 같은 규칙 (행이 없으면 등급 지급량) */
  async function loadBalance(sb, session) {
    var credit = await sb.from('user_credits').select('balance').maybeSingle();
    var left = credit && credit.data ? credit.data.balance : null;
    if (left === null) {
      var prof = await sb.from('profiles').select('tier').eq('id', session.user.id).maybeSingle();
      var tier = prof && prof.data ? prof.data.tier : 'standard';
      var plan = await sb
        .from('credit_plans')
        .select('monthly_credits')
        .eq('tier', tier)
        .maybeSingle();
      left = plan && plan.data ? plan.data.monthly_credits : null;
    }
    return left;
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

    window.addEventListener('popstate', function () {
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
    window.dispatchEvent(new CustomEvent('segan:make-ready'));
  }

  var api = {
    KINDS: KINDS,
    STYLES: STYLES,
    DOORS: DOORS,
    FRIDGE_BRANDS: FRIDGE_BRANDS,
    FRIDGE_POS: FRIDGE_POS,
    DRAFT_KEY: DRAFT_KEY,
    state: S,
    readImage: readImage,
    exifFocal35: exifFocal35,
    loginHref: loginHref,
    /** 페이지 이동 — 시험이 바꿔 끼운다 */
    go: function (url) {
      location.assign(url);
    },
    start: startPlaceholder,
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
