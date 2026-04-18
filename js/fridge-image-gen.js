/**
 * 냉장고장 이미지 생성 전용 — 클라이언트 헬퍼
 *
 * ai-design.html 의 냉장고장 카테고리 생성 흐름에서 다음을 담당:
 *   1) Supabase furniture_images 에서 관리자가 올린 포트폴리오 조회
 *   2) 각 public URL 을 base64 로 변환 (Worker 가 Gemini multi-image 로 전달)
 *   3) /api/generate 에 실릴 reference_images 페이로드 최종 조립
 *
 * UI 로직 (state.fridgeOptions 수집 등) 은 페이지에 남기고, 생성 파이프라인만 분리.
 *
 * 사용:
 *   <script src="js/fridge-image-gen.js"></script>
 *   const refs = await FridgeImageGen.buildReferencePayload(supabaseClient, 5);
 *   fetch('/api/generate', { body: JSON.stringify({ ..., reference_images: refs }) });
 */
(function () {
  'use strict';

  const CATEGORY_IDS = ['fridge_cabinet', 'fridge'];
  const DEFAULT_LIMIT = 5;

  /**
   * 포트폴리오 메타데이터 조회.
   * trainingOnly=true 이면 is_training=true 만 먼저 시도하고, 결과 0장일 때 폴백으로
   * 전체 fridge 포트폴리오를 재조회한다.
   * @param {*} supabaseClient
   * @param {number} limit
   * @param {{ trainingOnly?: boolean }} [opts]
   * @returns {Promise<Array<{image_url, description?, style?}>>}
   */
  async function fetchReferenceImages(supabaseClient, limit = DEFAULT_LIMIT, opts = {}) {
    if (!supabaseClient) return [];
    const trainingOnly = !!opts.trainingOnly;

    async function runQuery({ trainingOnly: onlyTraining }) {
      let q = supabaseClient
        .from('furniture_images')
        .select('image_url, description, style, is_training, created_at')
        .in('category', CATEGORY_IDS)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (onlyTraining) q = q.eq('is_training', true);
      const { data, error } = await q;
      if (error) {
        console.warn('[FridgeImageGen] fetch 실패:', error.message);
        return [];
      }
      return (data || []).filter((r) => r && r.image_url);
    }

    try {
      if (trainingOnly) {
        const rows = await runQuery({ trainingOnly: true });
        if (rows.length > 0) {
          console.log(`[FridgeImageGen] training=${rows.length}`);
          return rows;
        }
        // 폴백: 학습용 0장 → 전체 포트폴리오 재조회
        const fallback = await runQuery({ trainingOnly: false });
        console.log(`[FridgeImageGen] training=0, fallback=${fallback.length}`);
        return fallback;
      }
      const rows = await runQuery({ trainingOnly: false });
      console.log(`[FridgeImageGen] portfolio=${rows.length}`);
      return rows;
    } catch (e) {
      console.warn('[FridgeImageGen] fetch 예외:', e.message);
      return [];
    }
  }

  /**
   * public URL → { base64, mimeType }
   */
  async function urlToBase64(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const mimeType = blob.type || 'image/jpeg';
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { base64, mimeType };
    } catch (e) {
      console.warn('[FridgeImageGen] base64 변환 실패:', url, e.message);
      return null;
    }
  }

  /**
   * Worker /api/generate 의 reference_images 페이로드 조립.
   * 실패한 항목은 자동으로 제외된다.
   *
   * @param {*} supabaseClient
   * @param {number} limit
   * @param {{ trainingOnly?: boolean }} [opts]  trainingOnly=true 권장 — 학습용 0장이면 자동 폴백
   * @returns {Promise<Array<{base64, mimeType, description}>>}
   */
  async function buildReferencePayload(supabaseClient, limit = DEFAULT_LIMIT, opts = {}) {
    const rows = await fetchReferenceImages(supabaseClient, limit, opts);
    if (rows.length === 0) return [];
    const converted = await Promise.all(rows.map(async (r) => {
      const img = await urlToBase64(r.image_url);
      if (!img) return null;
      return { ...img, description: r.description || r.style || '' };
    }));
    return converted.filter(Boolean);
  }

  window.FridgeImageGen = {
    fetchReferenceImages,
    urlToBase64,
    buildReferencePayload,
    CATEGORY_IDS,
    DEFAULT_LIMIT,
  };
})();
