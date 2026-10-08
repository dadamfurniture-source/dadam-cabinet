/**
 * 참고 이미지 공용 — 관리자 화면(admin/reference-images.html)과 연출컷(ai-design.html)이 같이 쓴다.
 * 표·버킷은 database/reference-images.sql.
 *
 * 순수 함수만 둔다 (브라우저 전역 `DadamRefImages`, Node(Jest) 는 module.exports).
 * 이미지를 줄이고 JPEG 로 굽는 것은 canvas 가 필요해 makeJpeg 만 브라우저 전용이다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamRefImages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BUCKET = 'reference-images';

  /** 테마 — 연출컷 「테마」 탭의 갈래. 키는 DB 의 theme 값이다. */
  const THEMES = Object.freeze([
    { key: 'animal', label: '동물' },
    { key: 'flower', label: '꽃' },
    { key: 'nature', label: '자연' },
    { key: 'product', label: '제품' },
    { key: 'painting', label: '회화' },
    { key: 'ai', label: 'AI 디자인' },
  ]);

  /**
   * 테마 값 검사 — DB CHECK(1~32자)와 같다. 기본 여섯은 영문 키, 새로 만든 테마는 이름 그대로(예: '원목').
   * 슬래시·제어문자는 막는다 (경로·표시를 어지럽힌다).
   */
  function isValidTheme(theme) {
    const t = String(theme == null ? '' : theme).trim();
    return t.length >= 1 && t.length <= 32 && !/[\u0000-\u001f\u007f/\\]/.test(t);
  }

  /** 상업적 사용·재배포가 가능한 라이선스만 — 연출컷 화면이 위키미디어에서 거르던 규칙 그대로 */
  const FREE_LICENSE_RE = /^(CC0|Public domain|PDM|No restrictions)/i;

  /** Claude 가 넘기는 추천 파일의 형식 이름 */
  const SUGGESTION_FORMAT = 'dadam-reference-suggestions/v1';

  /** 원본은 긴 변을 여기까지 줄인다 · 썸네일은 이 가로폭 */
  const FULL_LONG_EDGE = 1600;
  const THUMB_WIDTH = 320;

  function themeLabel(key, extra) {
    const t = THEMES.find((x) => x.key === key);
    if (t) return t.label;
    const e = extra && extra[key];
    return e || String(key || '');
  }

  /**
   * 채도 — RGBA 바이트 배열로 잰다. 연출컷 화면의 themeIsColorful 과 같은 셈이다.
   *   score   평균 채도 (0~1) — DB colorfulness 에 남긴다
   *   colorful  평균 0.18 이상이거나 선명한 화소가 25% 이상이면 색감 참고가 된다
   */
  function colorfulnessFromRGBA(data) {
    let sum = 0;
    let vivid = 0;
    let n = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      const sat = mx ? (mx - mn) / mx : 0;
      sum += sat;
      if (sat > 0.3 && mx > 50) vivid++;
      n++;
    }
    const score = n ? sum / n : 0;
    return { score: Math.round(score * 1000) / 1000, colorful: score >= 0.18 || (n ? vivid / n : 0) >= 0.25 };
  }

  /** 긴 변을 maxLong 까지 줄인 크기 (키우지는 않는다) */
  function fitLongEdge(w, h, maxLong) {
    const long = Math.max(w, h);
    if (!long || long <= maxLong) return { w: Math.round(w), h: Math.round(h) };
    const k = maxLong / long;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  /** 가로를 width 로 맞춘 크기 (키우지는 않는다) */
  function fitWidth(w, h, width) {
    if (!w || w <= width) return { w: Math.round(w), h: Math.round(h) };
    const k = width / w;
    return { w: Math.round(width), h: Math.max(1, Math.round(h * k)) };
  }

  /** 버킷 안의 경로 — 행 id 하나에 원본·썸네일 두 장 */
  function pathsFor(id) {
    return { full: id + '/full.jpg', thumb: id + '/thumb.jpg' };
  }

  /**
   * Claude 가 넘긴 추천 파일을 검사한다. 넣을 수 있는 것만 골라 돌려준다.
   *
   * @param {object} json            파일 내용 (JSON.parse 한 것)
   * @param {Set<string>|string[]} known  이미 DB 에 있는 origin_url (pending·approved·rejected 모두) — 중복은 건너뛴다
   * @returns {{ok:boolean, error?:string, items:object[], skipped:{index:number, reason:string}[]}}
   */
  function validateSuggestions(json, known) {
    const seen = new Set(known ? Array.from(known) : []);
    const out = { ok: false, items: [], skipped: [] };
    if (!json || typeof json !== 'object') {
      out.error = 'JSON 파일이 아닙니다';
      return out;
    }
    if (json.format !== SUGGESTION_FORMAT) {
      out.error = '추천 파일 형식이 아닙니다 (format: ' + SUGGESTION_FORMAT + ' 이어야 합니다)';
      return out;
    }
    if (!Array.isArray(json.items) || !json.items.length) {
      out.error = '추천 항목이 없습니다';
      return out;
    }
    json.items.forEach((it, index) => {
      const skip = (reason) => out.skipped.push({ index, reason });
      if (!it || typeof it !== 'object') return skip('항목이 비었습니다');
      const theme = String(it.theme || '').trim();
      if (!isValidTheme(theme)) return skip('테마가 올바르지 않습니다: ' + (theme || '(없음)'));
      const url = String(it.origin_url || '').trim();
      if (!/^https:\/\/\S+$/.test(url)) return skip('원본 주소(https)가 없습니다');
      const httpsOrNull = (v) => {
        const s = String(v || '').trim();
        return /^https:\/\/\S+$/.test(s) ? s : null;
      };
      const license = String(it.license || '').trim();
      if (!FREE_LICENSE_RE.test(license)) return skip('상업 사용이 안 되는 라이선스입니다: ' + (license || '(없음)'));
      if (seen.has(url)) return skip('이미 있는 사진입니다');
      seen.add(url);
      out.items.push({
        theme,
        title: String(it.title || '').trim().slice(0, 120) || null,
        note: String(it.note || '').trim().slice(0, 500) || null,
        origin_url: url,
        preview_url: httpsOrNull(it.preview_url),
        download_url: httpsOrNull(it.download_url),
        source_page: httpsOrNull(it.source_page),
        author: String(it.author || '').trim().slice(0, 200) || null,
        license,
      });
    });
    out.ok = true;
    return out;
  }

  /**
   * 그림을 줄여 JPEG Blob 로 굽는다 (브라우저 전용).
   * @param {HTMLImageElement|ImageBitmap} img
   * @param {{w:number,h:number}} size
   */
  function makeJpeg(img, size, quality) {
    return new Promise((resolve, reject) => {
      try {
        const cv = document.createElement('canvas');
        cv.width = size.w;
        cv.height = size.h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';            // 투명 PNG 는 흰 바탕에 굽는다 (JPEG 는 투명이 없다)
        ctx.fillRect(0, 0, size.w, size.h);
        ctx.drawImage(img, 0, 0, size.w, size.h);
        cv.toBlob((b) => (b ? resolve(b) : reject(new Error('JPEG 로 굽지 못했습니다'))), 'image/jpeg', quality || 0.9);
      } catch (e) {
        reject(e);
      }
    });
  }

  /** 그림의 채도를 잰다 (브라우저 전용) — 24×24 로 줄여 본다 */
  function colorfulnessOfImage(img) {
    const N = 24;
    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, N, N);
    return colorfulnessFromRGBA(ctx.getImageData(0, 0, N, N).data);
  }

  return {
    BUCKET,
    THEMES,
    isValidTheme,
    FREE_LICENSE_RE,
    SUGGESTION_FORMAT,
    FULL_LONG_EDGE,
    THUMB_WIDTH,
    themeLabel,
    colorfulnessFromRGBA,
    fitLongEdge,
    fitWidth,
    pathsFor,
    validateSuggestions,
    makeJpeg,
    colorfulnessOfImage,
  };
});
