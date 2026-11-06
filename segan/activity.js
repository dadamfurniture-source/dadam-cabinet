/* ============================================================
   segan/activity.js — 「내 활동」 화면 (segan/activity.html — 내 정보 › 내 활동)

   사이트 mypage.html 의 세 칸을 그대로 옮겼다. 같은 표 · 같은 읽기 · 같은 쓰기 · 같은 규칙:
     저장한 추천 팩토리  saved_partners (본인, 최신순) + partners(회사 이름 · 확인 · 종류 · 지역 · 전문 품목 · 전화).
                        지우기 = saved_partners delete (id). 관리자에게는 감춘다 (mypage.html user-only)
     시공 완료 · 평가    내 설계(designs.user_id) 중 수주가 끝난 것(orders.status = 'completed', 끝난 날 최신순 50개).
                        「내 것」은 RLS 에 맡기지 않는다 — 회사 구성원은 자기 회사 수주를 모두 읽을 수 있어서
                        먼저 내 설계를 읽고 그 설계의 수주만 묻는다. 없으면 칸째 감춘다.
                        평가 = design_feedback insert (본인 이름, 점수 1~5, 고쳤다고 했을 때만 사유,
                        그 설계의 시공사례 사진을 고르면 post_id)
     내 시공사례         collection_posts (본인, source 가 ai_render 가 아닌 것 — 연출컷은 내 연출컷에서 내린다).
                        올리기 = 사진(JPG · PNG, 20MB 이하, 긴 변 1600 으로 줄여) → 'collection' 버킷
                        <본인 id>/<시각>-<무작위>.<확장자> → 공개 주소로 collection_posts insert
                        (지역 「시/도 줄임 시/군/구」 · 구분 · 고른 설계 design_id · 학습 동의 consent_training =
                        체크했을 때만 true). 줄을 못 넣으면 올린 파일을 지운다.
                        학습 동의 켜고 끄기 = consent_training update (true 일 때만 켜진 것)
                        내리기 = 줄을 먼저 지우고 파일을 지운다 (반대면 줄만 남고 사진이 깨진다)
   mypage.html 의 confirm 창은 앱에서 확인 칸으로 한 번 더 묻는다 (같은 뜻의 글).
   통계 카드 · 등급 토글 · 최근 설계 칸은 옮기지 않는다.
   ============================================================ */
/* global window, document, location, URL, Image, crypto */
(function () {
  'use strict';

  var LOGIN_PAGE = '../login.html';
  var SELF = 'segan/activity.html';
  var CASE_BUCKET = 'collection';
  var CASE_MAX_BYTES = 20 * 1024 * 1024;
  var CASE_MAX_EDGE = 1600; // 시공사례 타일은 정사각 썸네일이라 이 이상은 낭비다 (mypage.html 과 같다)
  // 캡션이 「다담가구 · 서울 강남구」 처럼 읽히게 시/도를 줄인다 (mypage.html SIDO_SHORT 와 같다)
  var SIDO_SHORT = {
    서울특별시: '서울',
    부산광역시: '부산',
    대구광역시: '대구',
    인천광역시: '인천',
    광주광역시: '광주',
    대전광역시: '대전',
    울산광역시: '울산',
    세종특별자치시: '세종',
    경기도: '경기',
    강원도: '강원',
    충청북도: '충북',
    충청남도: '충남',
    전라북도: '전북',
    전라남도: '전남',
    경상북도: '경북',
    경상남도: '경남',
    제주특별자치도: '제주',
  };
  // 추천 팩토리의 전문 품목 이름 (mypage.html categoryLabels 와 같다)
  var PARTNER_CATEGORY = {
    sink: '싱크대',
    wardrobe: '붙박이장',
    fridge: '냉장고장',
    vanity: '화장대',
    shoe: '신발장',
    storage: '수납장',
  };
  var TEXT = {
    partnerEmpty: '저장한 추천 팩토리가 없습니다.',
    partnerAsk: '이 팩토리를 저장 목록에서 지울까요?',
    caseAsk: '이 사진을 시공사례에서 내릴까요?',
    caseEmpty: '아직 올린 시공사례가 없습니다.',
    noFile: '사진을 선택해주세요.',
    tooBig: '20MB 이하 사진만 올릴 수 있습니다.',
    uploading: '올리는 중…',
    uploadFail: '사진 업로드 실패: ',
    saveFail: '저장 실패: ',
    caseFail: '올리지 못했습니다.',
    sending: '보내는 중…',
    feedbackFail: '저장하지 못했습니다: ',
    consentOn: 'AI 학습 허용',
    consentOff: 'AI 학습 안 함',
    consentOnTitle: '이 사진은 다담 AI 학습에 쓰입니다. 누르면 끕니다.',
    consentOffTitle: '이 사진은 학습에 쓰이지 않습니다. 누르면 켭니다.',
    failed: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  };

  var A = {
    sb: null,
    user: null,
    isAdmin: false,
    caseFile: null,
    projects: [],
    cases: [],
    feedbackTarget: null,
    previewUrl: '',
  };

  var $ = function (id) {
    return document.getElementById(id);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function day(iso) {
    return iso ? new Date(iso).toLocaleDateString('ko-KR') : '';
  }

  function say(id, msg) {
    var el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function telHref(tel) {
    return 'tel:' + String(tel || '').replace(/[^0-9+]/g, '');
  }

  // ── 저장한 추천 팩토리 ─────────────────────────────────
  function partnerHtml(sp) {
    var p = sp.partners;
    if (!p) return '';
    var cats = (p.specialty_categories || [])
      .filter(function (c) {
        return PARTNER_CATEGORY[c];
      })
      .map(function (c) {
        return '<span>' + esc(PARTNER_CATEGORY[c]) + '</span>';
      })
      .join('');
    var typeLabel = p.partner_type === 'interior' ? '인테리어' : '제조공장';
    var place = [p.sido, p.gugun].filter(Boolean).join(' ');
    return (
      '<li class="me-pt-row ac-partner" data-saved="' +
      esc(sp.id) +
      '"><div class="me-pt-line"><b>' +
      esc(p.company_name) +
      '</b>' +
      (p.is_verified ? '<span class="me-badge" title="확인된 팩토리">확인됨</span>' : '') +
      '</div><p class="me-pt-info">' +
      esc(typeLabel) +
      (place ? ' · ' + esc(place) : '') +
      '</p>' +
      (cats ? '<p class="ac-chips">' + cats + '</p>' : '') +
      '<div class="rd-acts" data-acts>' +
      (p.phone ? '<a class="mk-btn" href="' + esc(telHref(p.phone)) + '">전화</a>' : '') +
      '<a class="mk-btn mk-btn--solid" href="consult.html">상담 신청</a>' +
      '<button type="button" class="mk-btn" data-act="ask-partner">지우기</button></div>' +
      '<div class="rd-confirm me-pt-ask" data-ask hidden><p class="mk-note">' +
      esc(TEXT.partnerAsk) +
      '</p><div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="del-partner">지우기</button>' +
      '<button type="button" class="mk-btn" data-act="no">그만두기</button></div></div></li>'
    );
  }

  async function loadPartners() {
    var section = $('partners');
    if (A.isAdmin) {
      section.hidden = true; // 관리자에게는 감춘다 (mypage.html 과 같다)
      return;
    }
    section.hidden = false;
    say('acPartnerError', '');
    var rows = [];
    try {
      var res = await A.sb
        .from('saved_partners')
        .select(
          'id, created_at, partners(id, company_name, is_verified, partner_type, sido, gugun, specialty_categories, phone)'
        )
        .eq('user_id', A.user.id)
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      rows = res.data || [];
    } catch {
      rows = [];
    }
    var html = rows.map(partnerHtml).join('');
    $('acPartners').innerHTML = html;
    $('acPartnerEmpty').textContent = TEXT.partnerEmpty;
    $('acPartnerEmpty').hidden = !!html;
  }

  async function deletePartner(id) {
    try {
      var res = await A.sb.from('saved_partners').delete().eq('id', id);
      if (res && res.error) throw res.error;
    } catch {
      say('acPartnerError', TEXT.failed);
      return;
    }
    await loadPartners();
  }

  // ── 시공 완료 · 평가 ───────────────────────────────────
  function projectHtml(r, i) {
    return (
      '<li class="me-pt-row"><div class="me-pt-line"><span class="me-c-main"><b>' +
      esc(r.name) +
      '</b><small>' +
      esc(
        (r.completed_at ? day(r.completed_at) + ' 시공 완료' : '시공 완료') +
          (r.order_no ? ' · ' + r.order_no : '')
      ) +
      '</small></span>' +
      (r.rated ? '<span class="me-badge">평가함</span>' : '') +
      '</div><div class="rd-acts"><button type="button" class="mk-btn' +
      (r.rated ? '' : ' mk-btn--solid') +
      '" data-rate="' +
      i +
      '">' +
      (r.rated ? '평가 추가' : '평가하기') +
      '</button></div></li>'
    );
  }

  async function loadProjects() {
    var section = $('feedback');
    var orders = [];
    try {
      var mine = await A.sb.from('designs').select('id').eq('user_id', A.user.id);
      if (mine.error) throw mine.error;
      var ids = (mine.data || []).map(function (d) {
        return d.id;
      });
      if (ids.length) {
        var res = await A.sb
          .from('orders')
          .select('design_id, order_no, completed_at')
          .in('design_id', ids)
          .eq('status', 'completed')
          .order('completed_at', { ascending: false })
          .limit(50);
        if (res.error) throw res.error;
        orders = res.data || [];
      }
    } catch {
      // 설계 · 수주를 못 읽는 계정이면 이 칸은 없는 것과 같다 — 조용히 감춘다
      section.hidden = true;
      return;
    }
    if (!orders.length) {
      section.hidden = true;
      return;
    }
    var ids2 = orders.map(function (o) {
      return o.design_id;
    });
    var got = await Promise.all([
      A.sb.from('designs').select('id, name').in('id', ids2),
      A.sb.from('design_feedback').select('design_id, created_at').in('design_id', ids2),
    ]);
    var names = {};
    ((got[0] && got[0].data) || []).forEach(function (d) {
      names[d.id] = d.name;
    });
    var rated = {};
    ((got[1] && got[1].data) || []).forEach(function (f) {
      rated[f.design_id] = true;
    });
    A.projects = orders.map(function (o) {
      return {
        design_id: o.design_id,
        order_no: o.order_no,
        completed_at: o.completed_at,
        name: names[o.design_id] || '이름 없는 설계',
        rated: !!rated[o.design_id],
      };
    });
    $('acProjects').innerHTML = A.projects.map(projectHtml).join('');
    section.hidden = false;
  }

  async function openFeedback(project) {
    A.feedbackTarget = project;
    $('acFbForm').reset();
    $('acFbAccuracyVal').textContent = '3';
    $('acFbUsabilityVal').textContent = '3';
    $('acFbReasonGroup').hidden = true;
    say('acFbStatus', '');
    $('acFbTitleText').textContent = project.name + ' 평가';
    $('acFbForm').hidden = false;
    // 이 설계에 붙은 시공사례 사진이 있으면 고를 수 있게 한다 (선택)
    var sel = $('acFbPost');
    sel.length = 1;
    try {
      var res = await A.sb
        .from('collection_posts')
        .select('id, region, created_at')
        .eq('design_id', project.design_id)
        .order('created_at', { ascending: false });
      ((res && res.data) || []).forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.id;
        o.textContent = (p.region || '지역 미입력') + ' · ' + day(p.created_at);
        sel.appendChild(o);
      });
    } catch {
      /* 사진을 못 읽어도 설계 단위로 평가한다 */
    }
    $('acFbPostGroup').hidden = sel.length <= 1;
  }

  function closeFeedback() {
    $('acFbForm').hidden = true;
    A.feedbackTarget = null;
  }

  async function submitFeedback(e) {
    if (e) e.preventDefault();
    if (!A.feedbackTarget || !A.user) return;
    var btn = $('acFbSubmit');
    btn.disabled = true;
    say('acFbStatus', TEXT.sending);
    var modified = $('acFbModified').checked;
    var row = {
      design_id: A.feedbackTarget.design_id,
      user_id: A.user.id,
      feedback_type: $('acFbType').value,
      accuracy_score: Number($('acFbAccuracy').value),
      usability_score: Number($('acFbUsability').value),
      was_modified: modified,
      modification_reason: modified ? $('acFbReason').value.trim() || null : null,
      feedback_text: $('acFbText').value.trim() || null,
      // 사진을 고르면 그 장에 붙는다. 안 고르면 설계 단위 평가다
      post_id: $('acFbPost').value || null,
    };
    var error = null;
    try {
      var res = await A.sb.from('design_feedback').insert(row);
      error = res && res.error;
    } catch (err) {
      error = err || { message: '' };
    }
    btn.disabled = false;
    if (error) {
      say('acFbStatus', TEXT.feedbackFail + (error.message || ''));
      return;
    }
    closeFeedback();
    await loadProjects();
  }

  // ── 내 시공사례 ────────────────────────────────────────
  function paintConsent(btn, on) {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? TEXT.consentOn : TEXT.consentOff;
    btn.title = on ? TEXT.consentOnTitle : TEXT.consentOffTitle;
  }

  function caseHtml(r, i) {
    var on = r.consent_training === true;
    return (
      '<li class="ac-case" data-case="' +
      i +
      '"><img class="ac-thumb" src="' +
      esc(r.image_url) +
      '" alt="" loading="lazy" /><p class="ac-meta">' +
      esc(r.region || '지역 미입력') +
      (r.design_id ? ' · 설계 연결됨' : '') +
      '</p><div class="rd-acts" data-acts><button type="button" class="mk-btn ac-consent" data-act="consent" aria-pressed="' +
      (on ? 'true' : 'false') +
      '" title="' +
      esc(on ? TEXT.consentOnTitle : TEXT.consentOffTitle) +
      '">' +
      esc(on ? TEXT.consentOn : TEXT.consentOff) +
      '</button><button type="button" class="mk-btn" data-act="ask-case">내리기</button></div>' +
      '<div class="rd-confirm me-pt-ask" data-ask hidden><p class="mk-note">' +
      esc(TEXT.caseAsk) +
      '</p><div class="rd-acts"><button type="button" class="mk-btn mk-btn--solid" data-act="del-case">내리기</button>' +
      '<button type="button" class="mk-btn" data-act="no">그만두기</button></div></div></li>'
    );
  }

  async function loadCases() {
    say('acCaseError', '');
    var res;
    try {
      res = await A.sb
        .from('collection_posts')
        .select('id, image_url, storage_path, region, created_at, consent_training, design_id')
        .eq('user_id', A.user.id)
        // AI 스튜디오 자동 게시(source 'ai_render')는 실제 시공 사진이 아니다 — 내 연출컷에서 내린다.
        //   여기 두면 학습 동의 단추로 연출컷이 실제 사진처럼 데이터셋에 들어갈 수 있다 (mypage.html 과 같다)
        .neq('source', 'ai_render')
        .order('created_at', { ascending: false });
    } catch (e) {
      res = { error: e };
    }
    if (res.error) return; // mypage.html 과 같이 목록을 그대로 둔다
    A.cases = res.data || [];
    $('acCases').innerHTML = A.cases.map(caseHtml).join('');
    $('acCaseEmpty').textContent = TEXT.caseEmpty;
    $('acCaseEmpty').hidden = A.cases.length > 0;
  }

  /** 학습 동의 — 먼저 바꿔 보여주고, 실패하면 되돌린다 (true 일 때만 켜진 것) */
  async function toggleConsent(r, btn) {
    var next = !(r.consent_training === true);
    paintConsent(btn, next);
    btn.disabled = true;
    var error = null;
    try {
      var res = await A.sb
        .from('collection_posts')
        .update({ consent_training: next })
        .eq('id', r.id);
      error = res && res.error;
    } catch (err) {
      error = err || {};
    }
    btn.disabled = false;
    if (error) {
      paintConsent(btn, r.consent_training === true);
      return;
    }
    r.consent_training = next;
  }

  async function deleteCase(r) {
    // 줄을 먼저 지운다. 순서가 반대면 줄은 남고 사진만 깨진다
    var error = null;
    try {
      var res = await A.sb.from('collection_posts').delete().eq('id', r.id);
      error = res && res.error;
    } catch (err) {
      error = err || {};
    }
    if (error) {
      say('acCaseError', TEXT.failed);
      return;
    }
    if (r.storage_path) {
      try {
        await A.sb.storage.from(CASE_BUCKET).remove([r.storage_path]);
      } catch {
        /* 파일을 못 지워도 줄은 이미 내려갔다 */
      }
    }
    await loadCases();
  }

  function option(value, label) {
    var o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  function fillSido() {
    var R = window.SeganRegions || {};
    var sel = $('acCaseSido');
    sel.textContent = '';
    sel.appendChild(option('', '선택하세요'));
    Object.keys(R).forEach(function (k) {
      sel.appendChild(option(k, k));
    });
  }

  /** 시/군/구 — 시/도를 고르기 전에는 안내 한 줄만 (mypage.html updateGugun) */
  function fillGugun() {
    var R = window.SeganRegions || {};
    var list = R[$('acCaseSido').value] || null;
    var sel = $('acCaseGugun');
    sel.textContent = '';
    if (!list) {
      sel.appendChild(option('', '시/도를 먼저 선택하세요'));
      return;
    }
    sel.appendChild(option('', '선택하세요'));
    list.forEach(function (g) {
      sel.appendChild(option(g, g));
    });
  }

  /**
   * 올리기의 설계 목록 — 시공이 끝난 설계(orders.status='completed')를 위로 올리고 표시를 붙인다
   * (학습 데이터가 되는 건 그것뿐이라 고를 때 보여야 한다). 수주를 못 읽어도 목록은 낸다.
   */
  async function loadCaseDesigns() {
    var sel = $('acCaseDesign');
    sel.length = 1; // 「연결 안 함」만 남긴다
    var designs = null;
    try {
      var res = await A.sb
        .from('designs')
        .select('id, name, updated_at')
        .eq('user_id', A.user.id)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (res.error) return;
      designs = res.data || [];
    } catch {
      return;
    }
    if (!designs.length) return;
    var done = {};
    try {
      var o = await A.sb
        .from('orders')
        .select('design_id, status')
        .in(
          'design_id',
          designs.map(function (d) {
            return d.id;
          })
        )
        .eq('status', 'completed');
      ((o && o.data) || []).forEach(function (x) {
        done[x.design_id] = true;
      });
    } catch {
      /* 수주를 못 봐도 목록은 낸다 */
    }
    designs
      .slice()
      .sort(function (a, b) {
        return (done[b.id] ? 1 : 0) - (done[a.id] ? 1 : 0);
      })
      .forEach(function (d) {
        sel.appendChild(
          option(d.id, (done[d.id] ? '✓ 시공 완료 · ' : '') + (d.name || '이름 없는 설계'))
        );
      });
  }

  function openCase() {
    A.caseFile = null;
    $('acCaseForm').reset();
    fillSido();
    fillGugun();
    $('acCasePreview').hidden = true;
    if (A.previewUrl) {
      try {
        URL.revokeObjectURL(A.previewUrl);
      } catch {
        /* noop */
      }
      A.previewUrl = '';
    }
    say('acCaseStatus', '');
    $('acCaseForm').hidden = false;
    $('acCaseOpen').hidden = true;
    loadCaseDesigns();
  }

  function closeCase() {
    $('acCaseForm').hidden = true;
    $('acCaseOpen').hidden = false;
  }

  function onCaseFile(e) {
    var f = (e.target.files || [])[0];
    if (!f) return;
    if (f.size > CASE_MAX_BYTES) {
      say('acCaseStatus', TEXT.tooBig);
      e.target.value = '';
      return;
    }
    A.caseFile = f;
    say('acCaseStatus', '');
    try {
      A.previewUrl = URL.createObjectURL(f);
      $('acCasePreview').src = A.previewUrl;
      $('acCasePreview').hidden = false;
    } catch {
      /* 미리 보기 없이 올린다 */
    }
  }

  /** 긴 변 기준으로 줄여서 올린다 — 줄일 필요가 없거나 못 읽으면 원본 그대로 (mypage.html shrinkImage) */
  function shrinkImage(file, maxEdge) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var long = Math.max(img.naturalWidth, img.naturalHeight);
        if (long <= maxEdge) return resolve(file);
        var r = maxEdge / long;
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * r);
        c.height = Math.round(img.naturalHeight * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(
          function (blob) {
            resolve(blob || file);
          },
          'image/jpeg',
          0.86
        );
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(file); // 못 읽으면 원본 그대로 — 여기서 올리기를 막지는 않는다
      };
      img.src = url;
    });
  }

  function randomPart() {
    var c = typeof crypto !== 'undefined' ? crypto : null;
    var s = c && c.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2);
    return s.replace(/-/g, '');
  }

  async function submitCase(e) {
    if (e) e.preventDefault();
    if (!A.caseFile) {
      say('acCaseStatus', TEXT.noFile);
      return;
    }
    var btn = $('acCaseSubmit');
    btn.disabled = true;
    say('acCaseStatus', TEXT.uploading);
    var sido = $('acCaseSido').value;
    var gugun = $('acCaseGugun').value;
    var region = [SIDO_SHORT[sido] || sido, gugun].filter(Boolean).join(' ');
    try {
      var blob = await api.shrinkImage(A.caseFile, CASE_MAX_EDGE);
      var ext = blob.type === 'image/png' ? 'png' : 'jpg';
      // 첫 칸이 반드시 본인 id 여야 한다 — collection_insert_own 정책이 그걸 본다
      var path = A.user.id + '/' + Date.now() + '-' + randomPart() + '.' + ext;
      var bucket = A.sb.storage.from(CASE_BUCKET);
      var up = await bucket.upload(path, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: blob.type || 'image/jpeg',
      });
      if (up && up.error) throw new Error(TEXT.uploadFail + up.error.message);
      var pub = bucket.getPublicUrl(path);
      var publicUrl = pub && pub.data ? pub.data.publicUrl : '';
      var ins = await A.sb.from('collection_posts').insert({
        user_id: A.user.id,
        image_url: publicUrl,
        storage_path: path,
        region: region,
        category: $('acCaseCategory').value,
        // 학습 동의는 체크했을 때만 true — 안 했으면 false 로 「물어봤고 안 했다」를 남긴다 (NULL 은 옛 글)
        consent_training: $('acCaseConsent').checked,
        // 사슬의 등뼈. 비면 이 사진은 도면 · 견적과 이어지지 않고 학습에도 안 쓰인다
        design_id: $('acCaseDesign').value || null,
      });
      if (ins && ins.error) {
        // 줄이 안 들어가면 올라간 파일은 주인 없는 파일이 된다 — 되돌린다
        try {
          await bucket.remove([path]);
        } catch {
          /* noop */
        }
        throw new Error(TEXT.saveFail + ins.error.message);
      }
      closeCase();
      await loadCases();
    } catch (err) {
      say('acCaseStatus', (err && err.message) || TEXT.caseFail);
    }
    btn.disabled = false;
  }

  // ── 묶기 ───────────────────────────────────────────────
  function askToggle(li, on) {
    var acts = li.querySelector('[data-acts]');
    var ask = li.querySelector('[data-ask]');
    if (acts) acts.hidden = on;
    if (ask) ask.hidden = !on;
  }

  function bind() {
    $('acPartners').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var li = b.closest('[data-saved]');
      var act = b.getAttribute('data-act');
      if (act === 'ask-partner') askToggle(li, true);
      else if (act === 'no') askToggle(li, false);
      else if (act === 'del-partner') {
        b.disabled = true;
        deletePartner(li.getAttribute('data-saved'));
      }
    });
    $('acProjects').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-rate]');
      if (b) openFeedback(A.projects[Number(b.getAttribute('data-rate'))]);
    });
    $('acFbForm').addEventListener('submit', submitFeedback);
    $('acFbCancel').addEventListener('click', closeFeedback);
    $('acFbModified').addEventListener('change', function () {
      $('acFbReasonGroup').hidden = !$('acFbModified').checked;
    });
    $('acFbAccuracy').addEventListener('input', function () {
      $('acFbAccuracyVal').textContent = $('acFbAccuracy').value;
    });
    $('acFbUsability').addEventListener('input', function () {
      $('acFbUsabilityVal').textContent = $('acFbUsability').value;
    });
    $('acCaseOpen').addEventListener('click', openCase);
    $('acCaseCancel').addEventListener('click', closeCase);
    $('acCaseForm').addEventListener('submit', submitCase);
    $('acCaseFile').addEventListener('change', onCaseFile);
    $('acCaseSido').addEventListener('change', fillGugun);
    $('acCases').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var li = b.closest('[data-case]');
      var r = A.cases[Number(li.getAttribute('data-case'))];
      var act = b.getAttribute('data-act');
      if (!r) return;
      if (act === 'consent') toggleConsent(r, b);
      else if (act === 'ask-case') askToggle(li, true);
      else if (act === 'no') askToggle(li, false);
      else if (act === 'del-case') {
        b.disabled = true;
        deleteCase(r);
      }
    });
  }

  async function isAdmin(auth) {
    if (auth.roles && typeof auth.roles.admin === 'boolean') return auth.roles.admin;
    try {
      return window.AdminAccess ? (await window.AdminAccess.isAdmin(auth.sb)) === true : false;
    } catch {
      return false; // 모르면 일반 사용자로 (mypage.html 과 같다)
    }
  }

  async function start(auth) {
    if (!$('acCases')) return;
    if (!auth || !auth.session || !auth.sb) {
      var a = document.querySelector('[data-auth-view="signed-out"] a.sg-btn');
      if (a) a.setAttribute('href', LOGIN_PAGE + '?redirect=' + encodeURIComponent(SELF));
      return;
    }
    A.sb = auth.sb;
    A.user = auth.session.user || {};
    A.isAdmin = await isAdmin(auth);
    bind();
    await Promise.all([loadPartners(), loadProjects(), loadCases()]);
    // activity.html#partners · #feedback · #cases 로 오면 그 칸으로
    var id = (location.hash || '').slice(1);
    var target = id && /^(partners|feedback|cases)$/.test(id) ? $(id) : null;
    if (target && !target.hidden && target.scrollIntoView) target.scrollIntoView();
  }

  var api = {
    TEXT: TEXT,
    SIDO_SHORT: SIDO_SHORT,
    PARTNER_CATEGORY: PARTNER_CATEGORY,
    CASE_MAX_BYTES: CASE_MAX_BYTES,
    CASE_MAX_EDGE: CASE_MAX_EDGE,
    state: A,
    /** 사진 줄이기 — 시험이 바꿔 끼운다 (jsdom 에는 그림 읽기가 없다) */
    shrinkImage: shrinkImage,
  };
  window.SeganActivity = api;
  api.ready = (
    window.SeganShell && window.SeganShell.ready ? window.SeganShell.ready : Promise.resolve(null)
  ).then(start);
})();
