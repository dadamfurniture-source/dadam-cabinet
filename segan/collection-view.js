/* ============================================================
   segan/collection-view.js — 시공사례 사진 한 장 (타일 · 사진 보기 · 좋아요) — window.SeganPostView

   시공사례 탭(segan/collection.js)과 마이페이지 「좋아요」(segan/me.js #likes)가 같이 쓴다.

   사진 한 장 (post) — 화면이 쓰는 모양 하나로 맞춘다
     DB 게시물   collection_posts 의 id · image_url · place_label · door_color · company_id · like_count · source · created_at
                 + 업체 이름 RPC collection_post_companies (본사 · 활동 중 협력업체만 — DB 0049)
     내 좋아요   RPC collection_my_likes 한 줄 (업체 이름이 같이 온다)
     AI 연출 사진  앱에 넣어 둔 36장 (app/portfolio/). 2026-11-21 대표님 「하트 달아주고」 → DB 0076 이 게시물 행으로 넣었다
                 (image_url = https://dadamfurniture.com/app/portfolio/<이름>.jpg, source 'ai_render'). fromRow 가 그 주소를
                 알아보고 타일은 가벼운 사본(app/portfolio/display/), 크게 볼 때는 원본을 앱 안 경로로 쓴다 — 좋아요가 된다.
                 DB 를 못 읽거나 그 행이 없으면 segan/collection.js STATIC 으로 그린다 (id 가 없다 — 좋아요 없음)
   글 규칙
     업체  업체 이름 → 없고 AI 연출컷(source 'ai_render')이면 「AI 연출컷」 → 아니면 그 줄을 보이지 않는다
           (직접 올린 사진에 「다담가구」를 붙이지 않는다 — 누구의 일인지는 DB company_id 가 정한다)
     장소  place_label (비면 줄 없음) · 색상 door_color (비면 줄 없음)
     AI 연출컷은 타일 귀퉁이에 「AI」, 사진 보기 제목도 「AI 연출컷」 — 실제 시공 사진으로 오해하지 않게
   「이 스타일로 연출컷」 — 만들기(./)를 그 사진을 참고 사진으로 담고 연다 (segan/make.js takeLinkRefs)
     DB 게시물 ./?ref=<게시물 id> · AI 연출 사진 ./?ref=<파일 이름>(게시물 행이든 STATIC 이든) · AI 연출컷은 단추 없음
     (만들기가 AI 연출컷 ref 를 건너뛴다)
   타일 (2026-11-21 대표님 「사진 위에 색상 정보를 적지 말고 밑에 색상 정보 영역을 만들어서 개별로」)
     칸(.cl-cell) = 사진 단추(.cl-tile — 정사각, 누르면 사진 보기) + 사진 아래 색상 영역(.cl-info)
     색상 영역 = 색상을 하나씩 한 줄에(.cl-colors — 예림 자재 이름이면 작은 색 칸, MATERIAL_HEX) + ♡ 단추
     좋아요를 저장할 수 없는 사진(DB 게시물이 아닌 것)은 ♡ 없이. 색상을 몰라도 영역은 둔다 (줄 높이가 맞는다)
   사진 보기 (open — 같은 날 「사진을 클릭하면 바로 확대 사진이 나오지 말고 색상정보, 견적, 업체 정보」.
              견적은 바로 뒤에 「견적은 일단 빼자」 — 예상 견적 칸은 뺐다. 넣었던 모습은 #1682)
     SeganShell.sheet kind 'sheet' (폰 아래 시트 · PC 1100px~ 오른쪽 옆 패널, 뒤로 가기가 닫는다, 주소 그대로)
     사진(누르면 전체 화면) · 장소와 좋아요 한 줄 · 색상 · 업체 정보 · 「이 스타일로 연출컷」
     (장소 · 색상 · 업체는 아는 것만 — 모르는 칸은 보이지 않는다)
   전체 화면 (full) — 사진만 화면 가득. SeganShell.sheet 의 가운데 창 층(kind 'dialog')을 화면 가득 채워 쓴다
     (뒤로 가기 · Esc · 닫기가 닫는다, 주소 그대로). 사진 보기의 사진을 누르면 연다 — 사진 보기 위에 겹친다.
     사진을 누르면 「닫기」를 감췄다 보였다, 사진 바깥(어두운 자리)을 누르면 닫는다
   좋아요 (♡ — aria-pressed) — 로그인한 사람만, 본인 줄만 (DB 0049 RLS). 타일의 ♡ 와 사진 보기의 ♡ 가 같은 일을 한다
     누르기  collection_likes insert { user_id, post_id } (이미 있으면 23505 — 좋아한 것으로 본다)
     풀기    collection_likes delete .eq('post_id', id)
     숫자는 먼저 바꿔 보이고, 실패하면 되돌린다. 로그인 전이면 가운데 작은 창으로 로그인을 권한다 (kind 'dialog')
   이미지는 img loading="lazy" + width · height (자리를 먼저 잡는다). 다운로드 단추 · 링크는 두지 않는다 —
   길게 눌러 저장 · 끌기 · 오른쪽 단추 메뉴도 막는다 (예전 배경 그림과 같은 정도)
   ============================================================ */
/* global window, document */
(function () {
  'use strict';

  var TEXT = {
    ai: 'AI 연출컷',
    title: '시공사례',
    hq: '다담가구',
    staticAi: 'AI 연출', // AI 연출 사진(STATIC) — 실제 시공이 아니므로 업체 대신
    place: '장소',
    color: '색상',
    company: '업체',
    companyInfo: '업체 정보',
    like: '좋아요',
    make: '이 스타일로 연출컷',
    share: '공유',
    shareTitle: '시공사례',
    shareCopied: '주소를 복사했습니다',
    shareFail: '주소를 복사하지 못했습니다',
    open: '정보 보기',
    zoom: '사진 크게 보기',
    likeFail: '좋아요를 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.',
    loginTitle: '로그인',
    loginBody: '로그인하면 좋아요를 저장할 수 있습니다',
    login: '로그인',
  };
  var STATIC_FULL = '../app/portfolio/';
  var STATIC_THUMB = '../app/portfolio/display/'; // 같은 사진의 가벼운 사본 (segan/make.js refThumb 와 같다)
  var TILE = 400; // 타일 img width · height — 정사각 칸 (CSS 가 칸 폭에 맞춘다)
  var COMPANY_IDS = 100; // collection_post_companies 가 받는 앞 100개 (DB 0049)
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var STEM_RE = /^[a-z0-9-]{1,40}$/i; // segan/make.js STATIC_STEM_RE 와 같다
  // DB 로 들어간 AI 연출 사진의 주소 (DB 0076) — 이름만 꺼내 앱 안 경로로 바꾼다
  var PORTFOLIO_RE = /^https:\/\/dadamfurniture\.com\/app\/portfolio\/([a-z0-9-]{1,40})\.jpg$/i;
  // 자재 이름 → 색 값 (색상 영역의 작은 색 칸). app/portfolio/luxe-manifest.json 의 materials 그대로 — 예림 도어 자재.
  // 사진을 더해 새 자재가 생기면 여기도 더한다 (__tests__/segan-collection.test.js 가 목록 파일과 견준다)
  var MATERIAL_HEX = {
    '그레이쉬 오크': '#40352f',
    '글로시 화이트': '#fbfbfb',
    '네이처 오크': '#9c7b5b',
    '매트 그레이': '#989494',
    '매트 다크그레이': '#3b3835',
    '매트 딥그린': '#2f4952',
    '매트 로지핑크': '#f3e9de',
    '매트 미스트그린': '#a5afa0',
    '매트 밀크화이트': '#fffef8',
    '매트 버터스카치': '#cca47c',
    '매트 블랙': '#272727',
    '매트 샌드그레이': '#d4cfc8',
    '매트 스모키올리브': '#474f44',
    '매트 스카이브리즈': '#abc5e2',
    '매트 아이보리': '#f5eddc',
    '매트 인디고': '#2e2f3f',
    '매트 카페브라운': '#6d5d51',
    '매트 캐시미어': '#e3e1d6',
    '매트 타우니레드': '#6e4639',
    '매트 화이트': '#fbfbfb',
    '세라믹 문 브릭': '#77462d',
    세이오크: '#cea875',
    소프트월넛: '#504029',
    슈가엘름: '#d8c8ba',
    '아크 마멀레이드': '#d4612a',
    '아크 미드나잇블루': '#2a293a',
    '아크 샌드듄': '#cdc2b4',
    '아크 포레스트그린': '#2a422e',
    '아크 플라워블루': '#5a687f',
    윈체스터월넛: '#a56c43',
    카카오월넛: '#544135',
    '카타니아 오크': '#433027',
    '콘크리트 그레이': '#c6c2c2',
    프렌치오크: '#bca580',
    피넛오크: '#9a8464',
  };
  var HEART =
    '<svg class="pv-heart" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" aria-hidden="true" focusable="false"><path d="M12 20s-7.5-4.6-7.5-10.1A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  // ── 사진 한 장 ─────────────────────────────────────────
  /** DB 게시물 한 줄 + 업체({ company_name, company_kind } — collection_post_companies) */
  function fromRow(row, company) {
    var c = company && typeof company === 'object' ? company : {};
    var url = str(row.image_url);
    // 앱에 넣어 둔 AI 연출 사진이 게시물로 들어온 것 (DB 0076) — 같은 사진의 가벼운 사본이 앱 안에 있다
    var local = PORTFOLIO_RE.exec(url);
    return {
      id: str(row.id),
      image_url: local ? STATIC_FULL + local[1] + '.jpg' : url,
      thumb: local ? STATIC_THUMB + local[1] + '.jpg' : url,
      place_label: str(row.place_label),
      door_color: str(row.door_color),
      // 본사(다담) 일은 고객에게 「다담가구」로 보인다 — DB 의 본사 업체 이름(다담 공장)은 내부 이름
      company_name: str(c.company_kind) === 'hq' ? TEXT.hq : str(c.company_name),
      company_kind: str(c.company_kind),
      source: str(row.source) || 'upload',
      like_count: num(row.like_count),
      created_at: row.created_at || null,
      stem: local ? local[1] : '',
    };
  }

  /** collection_my_likes 한 줄 — 업체 이름이 같이 온다 (liked_at 은 다음 쪽을 묻는 데 쓴다) */
  function fromLike(row) {
    var p = fromRow(
      {
        id: row.post_id,
        image_url: row.image_url,
        place_label: row.place_label,
        door_color: row.door_color,
        like_count: row.like_count,
        source: row.source,
        created_at: row.created_at,
      },
      { company_name: row.company_name, company_kind: row.company_kind }
    );
    p.liked_at = row.liked_at || null;
    return p;
  }

  /** AI 연출 사진 (segan/collection.js STATIC — { image_url: '../app/portfolio/<이름>.jpg', place, color }).
   *  color = 「자재 이름 · 자재 이름」. DB 를 못 읽었거나 그 사진의 게시물 행이 없을 때만 쓴다 */
  function fromStatic(s) {
    var file = String(s.image_url || '').replace(/^.*\//, '');
    var stem = file.replace(/\.jpg$/i, '');
    return {
      id: '',
      image_url: STATIC_FULL + file,
      thumb: STATIC_THUMB + file,
      place_label: str(s.place),
      door_color: str(s.color),
      company_name: TEXT.staticAi,
      company_kind: '',
      source: 'upload',
      like_count: 0,
      created_at: null,
      stem: STEM_RE.test(stem) ? stem : '',
    };
  }

  /** 화면 글 — { ai, title, company, place, color } (규칙은 머리말).
   *  연출컷(ai_render)은 2026-11-20 대표님 「표시 없이, 업체 칸만 AI 연출」 — 타일 「AI」 표 없음, 제목 「시공사례」,
   *  업체 칸은 늘 「AI 연출」 (본사가 고른 연출컷만 시공사례에 나간다, DB 0075) */
  function labels(p) {
    var ai = p.source === 'ai_render';
    return {
      ai: false,
      title: TEXT.title,
      company: ai ? TEXT.staticAi : p.company_name || '',
      place: p.place_label || '',
      color: p.door_color || '',
    };
  }

  /** 색상 하나씩 — [{ name, hex }]. 색상 글은 「이름 · 이름」, 색 값은 아는 자재 이름만 (MATERIAL_HEX) */
  function colorsOf(p) {
    return String((p && p.door_color) || '')
      .split(' · ')
      .map(function (raw) {
        var name = raw.trim();
        var known = Object.prototype.hasOwnProperty.call(MATERIAL_HEX, name);
        return { name: name, hex: known ? MATERIAL_HEX[name] : '' };
      })
      .filter(function (c) {
        return !!c.name;
      });
  }

  /** 색상 목록 줄 — 색 값을 알면 작은 색 칸을 앞에 (cls = 목록 클래스) */
  function colorsHTML(p, cls) {
    var list = colorsOf(p);
    if (!list.length) return '';
    return (
      '<ul class="' +
      cls +
      '">' +
      list
        .map(function (c) {
          return (
            '<li>' +
            (c.hex
              ? '<span class="cl-chip" style="background: ' + c.hex + '" aria-hidden="true"></span>'
              : '') +
            '<span>' +
            esc(c.name) +
            '</span></li>'
          );
        })
        .join('') +
      '</ul>'
    );
  }

  /** 사진 이름 (타일 단추 · 사진 대체 글) — 「시공사례 · 인천 연수구 · 주방 · 다담가구」 */
  function nameOf(p) {
    var l = labels(p);
    var parts = [l.title];
    if (l.place) parts.push(l.place);
    if (l.company && l.company !== l.title) parts.push(l.company);
    return parts.join(' · ');
  }

  /** 「이 스타일로 연출컷」 주소 — AI 연출컷 · 모르는 것은 '' (단추 없음) */
  function refHref(p) {
    if (!p) return '';
    // 앱에 넣어 둔 AI 연출 사진 — 게시물 행이든 STATIC 이든 파일 이름으로 (만들기가 그 이름을 안다)
    if (p.stem && STEM_RE.test(p.stem)) return 'make.html?ref=' + encodeURIComponent(p.stem);
    if (p.source === 'ai_render') return '';
    if (p.id && UUID_RE.test(p.id)) return 'make.html?ref=' + encodeURIComponent(p.id);
    return '';
  }

  /** 좋아요를 저장할 수 있는 사진인가 — DB 게시물만 (id 가 있다) */
  function canLike(p) {
    return !!(p && p.id && UUID_RE.test(p.id));
  }

  /**
   * 타일 하나 — 칸(.cl-cell) 안에 사진 단추(누르면 사진 보기, data-open = 목록 안 차례)와
   * 사진 아래 색상 영역(.cl-info — 색상 하나씩 한 줄 · ♡ 단추 data-like = 같은 차례). o.liked = 내가 좋아한 사진
   */
  function tileHTML(p, i, o) {
    var l = labels(p);
    var like = canLike(p);
    var cap =
      '<div class="cl-info">' +
      colorsHTML(p, 'cl-colors') +
      (like
        ? '<button type="button" class="cl-like" data-like="' +
          i +
          '" aria-pressed="' +
          (o && o.liked ? 'true' : 'false') +
          '" aria-label="' +
          esc(TEXT.like) +
          '">' +
          HEART +
          '</button>'
        : '') +
      '</div>';
    return (
      '<div class="cl-cell"><button type="button" class="cl-tile' +
      (l.ai ? ' cl-tile--ai' : '') +
      '" data-open="' +
      i +
      '" aria-label="' +
      esc(nameOf(p) + ' ' + TEXT.open) +
      '"><img src="' +
      esc(p.thumb || p.image_url) +
      '" alt="" width="' +
      TILE +
      '" height="' +
      TILE +
      '" loading="lazy" decoding="async" draggable="false" />' +
      (l.ai ? '<span class="cl-mark" aria-hidden="true">AI</span>' : '') +
      '</button>' +
      cap +
      '</div>'
    );
  }

  // ── 서버 ───────────────────────────────────────────────
  /** 업체 이름 — 게시물 id → { company_name, company_kind }. 못 읽으면 빈 표 (업체 줄만 빠진다) */
  async function companies(sb, ids) {
    var out = {};
    var list = (ids || []).filter(function (id) {
      return UUID_RE.test(String(id || ''));
    });
    if (!sb || !list.length) return out;
    for (var i = 0; i < list.length; i += COMPANY_IDS) {
      try {
        var res = await sb.rpc('collection_post_companies', {
          p_post_ids: list.slice(i, i + COMPANY_IDS),
        });
        if (!res || res.error || !Array.isArray(res.data)) continue;
        res.data.forEach(function (r) {
          if (r && r.post_id && str(r.company_name))
            out[r.post_id] = {
              company_name: str(r.company_name),
              company_kind: str(r.company_kind),
            };
        });
      } catch {
        /* 업체 줄 없이 그린다 */
      }
    }
    return out;
  }

  /** 이 중 내가 좋아한 것 — 게시물 id → true (본인 줄만 읽힌다). 로그인 전 · 실패면 빈 표 */
  async function myLikes(sb, userId, ids) {
    var out = {};
    var list = (ids || []).filter(function (id) {
      return UUID_RE.test(String(id || ''));
    });
    if (!sb || !userId || !list.length) return out;
    try {
      var res = await sb.from('collection_likes').select('post_id').in('post_id', list);
      if (res && !res.error && Array.isArray(res.data))
        res.data.forEach(function (r) {
          if (r && r.post_id) out[r.post_id] = true;
        });
    } catch {
      /* 빈 ♡ 로 그린다 */
    }
    return out;
  }

  /** 좋아요 넣기 · 빼기 → { ok } (이미 좋아한 줄이면 23505 — 넣은 것으로 본다) */
  async function setLike(sb, userId, postId, on) {
    if (!sb || !userId || !UUID_RE.test(String(postId || ''))) return { ok: false };
    try {
      var res = on
        ? await sb.from('collection_likes').insert({ user_id: userId, post_id: postId })
        : await sb.from('collection_likes').delete().eq('post_id', postId);
      if (res && res.error) return { ok: on && res.error.code === '23505' };
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // ── 사진 보기 ──────────────────────────────────────────
  function sheetApi() {
    var Shell = window.SeganShell;
    return Shell && Shell.sheet ? Shell.sheet : null;
  }

  /** 로그인 전에 ♡ — 가운데 작은 창 (로그인 단추 = 돌아올 곳 loginHref) */
  function askLogin(loginHref) {
    var sheet = sheetApi();
    if (!sheet) return null;
    var box = document.createElement('div');
    box.className = 'pv-login';
    box.innerHTML =
      '<p class="sg-note">' +
      esc(TEXT.loginBody) +
      '</p><a class="sg-btn" href="' +
      esc(loginHref || '../login.html') +
      '">' +
      esc(TEXT.login) +
      '</a>';
    return sheet.open({ kind: 'dialog', title: TEXT.loginTitle, body: box });
  }

  function factHTML(label, value) {
    return value ? '<div><dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd></div>' : '';
  }

  /** 누른 타일의 그림 크기 (받아 둔 것) — 크게 볼 자리를 먼저 잡는다. 모르면 정사각 */
  function sizeOf(img) {
    var w = img && img.complete ? img.naturalWidth : 0;
    var h = img && img.complete ? img.naturalHeight : 0;
    return w > 0 && h > 0 ? { w: w, h: h } : { w: 1, h: 1 };
  }

  /** 내가 좋아한 사진인가 — o.liked 는 값이거나, 열 때마다 다시 묻는 함수 */
  function likedOf(o) {
    return !!(o && (typeof o.liked === 'function' ? o.liked() : o.liked));
  }

  /**
   * ♡ 한 번 — 먼저 바꿔 보이고(st.liked · st.count → paint), 못 넣으면 되돌리고 fail 을 부른다.
   * 로그인 전이면 로그인을 권하고 끝. 넣는 동안(aria-busy)은 다시 누르지 못한다
   * @returns {Promise<boolean>} 저장됐나
   */
  async function flipLike(p, o, st, btn, paint, fail) {
    o = o || {};
    if (!o.userId) {
      askLogin(o.loginHref);
      return false;
    }
    if (st.busy) return false;
    st.busy = true;
    if (btn) btn.setAttribute('aria-busy', 'true');
    var next = !st.liked;
    st.liked = next;
    st.count = Math.max(0, st.count + (next ? 1 : -1));
    paint();
    var r = await setLike(o.sb, o.userId, p.id, next);
    if (!r.ok) {
      st.liked = !next;
      st.count = Math.max(0, st.count + (next ? -1 : 1));
      paint();
      if (typeof fail === 'function') fail();
    } else {
      p.like_count = st.count;
      if (typeof o.onLike === 'function') o.onLike(p, st.liked);
    }
    st.busy = false;
    if (btn) btn.removeAttribute('aria-busy');
    return !!r.ok;
  }

  /**
   * 타일의 ♡ 를 눌렀다 — 단추의 aria-pressed 가 지금 상태다.
   * @param {Element} btn  .cl-like
   * @param {object} p     그 사진
   * @param {{ sb?, userId?: string, loginHref?: string, onLike?: function(object, boolean), onFail?: function() }} o
   */
  function likeTile(btn, p, o) {
    o = o || {};
    if (!btn || !canLike(p) || btn.getAttribute('aria-busy') === 'true')
      return Promise.resolve(false);
    var st = {
      liked: btn.getAttribute('aria-pressed') === 'true',
      count: num(p.like_count),
      busy: false,
    };
    return flipLike(
      p,
      o,
      st,
      btn,
      function () {
        btn.setAttribute('aria-pressed', st.liked ? 'true' : 'false');
      },
      o.onFail
    );
  }

  /**
   * 사진만 전체 화면으로 — 가운데 창 층을 화면 가득 채운다 (segan/shell.css .pv-full-wrap).
   * 사진을 누르면 「닫기」를 감췄다 보였다, 사진 바깥을 누르면 닫는다. 사진 보기(open)의 사진을 누르면 연다
   * @param {object} p  사진 한 장
   * @param {{ img?: Element, onFullClose?: function(string) }} o  img = 이미 받아 둔 그림 (크기를 먼저 잡는다)
   * @returns 창 손잡이 (SeganShell.sheet.open) — 셸이 없으면 null
   */
  function full(p, o) {
    o = o || {};
    var sheet = sheetApi();
    if (!sheet || !p) return null;
    var size = sizeOf(o.img);
    // 칸에서 이미 받은 사진을 먼저 화면 가득 보이고, 원본을 다 받으면 바꿔 끼운다 (받는 동안 빈 화면이 되지 않게)
    var first = p.thumb || p.image_url;
    var big = p.image_url || p.thumb;
    var box = document.createElement('div');
    box.className = 'pv-full';
    box.innerHTML =
      '<img class="pv-full-img" src="' +
      esc(first) +
      '" alt="' +
      esc(nameOf(p)) +
      '" width="' +
      size.w +
      '" height="' +
      size.h +
      '" decoding="async" draggable="false" />';
    guardImages(box);
    var h = sheet.open({
      kind: 'dialog',
      title: labels(p).title,
      body: box,
      onClose: function (why) {
        if (typeof o.onFullClose === 'function') o.onFullClose(why);
      },
    });
    if (!h) return null;
    if (h.el && h.el.parentNode) h.el.parentNode.classList.add('pv-full-wrap');
    var pic = box.querySelector('.pv-full-img');
    if (big && big !== first && typeof window.Image === 'function') {
      var pre = new window.Image();
      pre.onload = function () {
        if (h.isOpen()) pic.src = big;
      };
      pre.src = big;
    }
    box.addEventListener('click', function (e) {
      var t = e.target;
      // 사진 = 단추를 감췄다 보였다 (사진만 본다) · 사진 바깥의 어두운 자리 = 닫기
      if (t === pic && inPicture(pic, e, size)) {
        if (h.el) h.el.classList.toggle('pv-full--bare');
        return;
      }
      h.close('backdrop');
    });
    return h;
  }

  /**
   * 누른 곳이 사진 그림 안인가 — img 칸은 화면을 가득 채우고 그림은 그 안에 비율대로 놓인다(object-fit: contain).
   * 그림 바깥의 어두운 자리는 「바깥」이다. 칸 크기를 모르면(그리지 않는 곳) 안으로 본다
   */
  function inPicture(img, e, size) {
    var r = img.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return true;
    var ratio =
      img.naturalWidth > 0 && img.naturalHeight > 0
        ? img.naturalWidth / img.naturalHeight
        : size.w / size.h;
    if (!(ratio > 0)) return true;
    var w = Math.min(r.width, r.height * ratio);
    var hgt = w / ratio;
    var x = r.left + (r.width - w) / 2;
    var y = r.top + (r.height - hgt) / 2;
    return e.clientX >= x && e.clientX <= x + w && e.clientY >= y && e.clientY <= y + hgt;
  }

  /**
   * 사진 보기를 연다.
   * @param {object} p  사진 한 장 (fromRow · fromLike · fromStatic)
   * @param {{ sb?, userId?: string, liked?: boolean, loginHref?: string, img?: Element,
   *           onLike?: function(object, boolean), onClose?: function(string) }} o
   * @returns 시트 손잡이 (SeganShell.sheet.open) — 셸이 없으면 null
   */
  // ── 공유 — 사진 한 장 주소 /segan/p/<id> (functions/segan/p/[id].js 가 그 사진으로 미리보기를 준다) ──
  var SITE = 'https://dadamfurniture.com';
  /** 공유할 수 있는 사진 — DB 게시물(uuid)만. 앱 안 AI 연출 사진(STATIC)은 주소가 없다 */
  function canShare(p) {
    return !!(p && UUID_RE.test(str(p.id)));
  }
  /** 공유 주소 — 이 사이트에서 열었으면 그 출처(미리보기 주소 포함), 아니면 실서비스 */
  function shareUrl(p) {
    var o =
      window.location && /^https?:$/.test(window.location.protocol) ? window.location.origin : SITE;
    return o + '/segan/p/' + str(p.id).toLowerCase();
  }
  /** 공유 창(있으면) → 없으면 주소 복사. 결과: 'shared' · 'copied' · 'cancel' · 'fail' */
  async function sharePost(p) {
    if (!canShare(p)) return 'fail';
    var url = shareUrl(p);
    var nav = window.navigator || {};
    try {
      if (typeof nav.share === 'function') {
        await nav.share({ title: nameOf(p) + ' · SEGAN', url: url });
        return 'shared';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancel'; // 공유 창을 닫았다
    }
    try {
      await nav.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'fail';
    }
  }

  function open(p, o) {
    o = o || {};
    var sheet = sheetApi();
    if (!sheet || !p) return null;
    var l = labels(p);
    var size = sizeOf(o.img);
    var st = { liked: likedOf(o), count: num(p.like_count), busy: false };
    var likeable = canLike(p);
    var shareable = canShare(p);
    var href = refHref(p);

    var colors = colorsHTML(p, 'pv-colors');

    var box = document.createElement('article');
    box.className = 'pv';
    box.innerHTML =
      '<button type="button" class="pv-photo" style="aspect-ratio: ' +
      size.w +
      ' / ' +
      size.h +
      '" aria-label="' +
      esc(TEXT.zoom) +
      '"><img src="' +
      esc(p.image_url || p.thumb) +
      '" alt="' +
      esc(nameOf(p)) +
      '" width="' +
      size.w +
      '" height="' +
      size.h +
      '" decoding="async" draggable="false" /></button>' +
      (l.place || likeable || shareable
        ? '<div class="pv-bar">' +
          (l.place ? '<p class="pv-place">' + esc(l.place) + '</p>' : '') +
          (likeable
            ? '<button type="button" class="pv-like" aria-pressed="false">' +
              HEART +
              '<span class="pv-like-text">' +
              esc(TEXT.like) +
              '</span> <span class="pv-count"></span></button>'
            : '') +
          (shareable
            ? '<button type="button" class="pv-share">' + esc(TEXT.share) + '</button>'
            : '') +
          '</div>'
        : '') +
      (likeable ? '<p class="pv-error" role="alert" hidden></p>' : '') +
      (shareable ? '<p class="pv-note" role="status" hidden></p>' : '') +
      (colors
        ? '<section class="pv-sec"><h3 class="pv-h">' +
          esc(TEXT.color) +
          '</h3>' +
          colors +
          '</section>'
        : '') +
      (l.company
        ? '<section class="pv-sec"><h3 class="pv-h">' +
          esc(TEXT.companyInfo) +
          '</h3><dl class="pv-facts">' +
          factHTML(TEXT.company, l.company) +
          '</dl></section>'
        : '') +
      (href ? '<a class="sg-btn pv-make" href="' + esc(href) + '">' + esc(TEXT.make) + '</a>' : '');
    guardImages(box);

    // 사진을 누르면 사진만 전체 화면 — 이 창 위에 겹친다 (닫으면 이 창으로 돌아온다)
    var photo = box.querySelector('.pv-photo');
    photo.addEventListener('click', function () {
      full(p, { img: photo.querySelector('img'), onFullClose: o.onFullClose });
    });

    var shareBtn = box.querySelector('.pv-share');
    var note = box.querySelector('.pv-note');
    if (shareBtn)
      shareBtn.addEventListener('click', function () {
        note.hidden = true;
        sharePost(p).then(function (r) {
          if (r !== 'copied' && r !== 'fail') return;
          note.textContent = r === 'copied' ? TEXT.shareCopied : TEXT.shareFail;
          note.hidden = false;
        });
      });

    var btn = box.querySelector('.pv-like');
    var err = box.querySelector('.pv-error');
    function paint() {
      if (!btn) return;
      btn.setAttribute('aria-pressed', st.liked ? 'true' : 'false');
      btn.querySelector('.pv-count').textContent = String(st.count);
    }
    paint();
    if (btn)
      btn.addEventListener('click', function () {
        if (err) err.hidden = true;
        flipLike(p, o, st, btn, paint, function () {
          if (!err) return;
          err.textContent = TEXT.likeFail;
          err.hidden = false;
        });
      });

    return sheet.open({
      kind: 'sheet',
      title: l.title,
      body: box,
      onClose: function (why) {
        if (typeof o.onClose === 'function') o.onClose(why, st.liked);
      },
    });
  }

  /** 다운로드 막기 — 오른쪽 단추 메뉴 · 끌기 (길게 눌러 저장은 CSS -webkit-touch-callout) */
  function guardImages(root) {
    if (!root || root.getAttribute('data-pv-guard')) return;
    root.setAttribute('data-pv-guard', '1');
    ['contextmenu', 'dragstart'].forEach(function (type) {
      root.addEventListener(type, function (e) {
        if (e.target && e.target.tagName === 'IMG') e.preventDefault();
      });
    });
  }

  window.SeganPostView = {
    TEXT: TEXT,
    TILE: TILE,
    fromRow: fromRow,
    fromLike: fromLike,
    fromStatic: fromStatic,
    labels: labels,
    nameOf: nameOf,
    refHref: refHref,
    tileHTML: tileHTML,
    companies: companies,
    myLikes: myLikes,
    setLike: setLike,
    askLogin: askLogin,
    canLike: canLike,
    canShare: canShare,
    shareUrl: shareUrl,
    sharePost: sharePost,
    likeTile: likeTile,
    full: full,
    open: open,
    colorsOf: colorsOf,
    guardImages: guardImages,
  };
})();
