/**
 * 상세설계(detaildesign) 접근 권한 유틸리티
 *
 * 정책(MVP): 로그인 만으로는 detaildesign 페이지를 사용할 수 없고,
 *           본사(홍회장)가 profiles.detaildesign_approved = TRUE 로 승인해 준 사용자만 접근 가능.
 *
 * 로드 순서:
 *   <script src="js/config.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45"></script>
 *   <script src="js/detaildesign-access.js"></script>
 *
 * API:
 *   const { approved, requestedAt } = await DetailDesignAccess.fetchStatus(client, userId);
 *   const approved = await DetailDesignAccess.updateNavVisibility(client, user);
 *   const { ok, error } = await DetailDesignAccess.requestApproval(client, userId);
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'dd_approval_cache_v1';
  const CACHE_TTL_MS = 60 * 1000; // 1분 — 승인 직후 UX 반영은 페이지 새로고침/캐시 무효화로 처리

  function readCache(userId) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.userId !== userId) return null;
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeCache(userId, approved, requestedAt) {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userId, approved, requestedAt, ts: Date.now() })
      );
    } catch (e) {
      /* sessionStorage unavailable — safe to ignore */
    }
  }

  function clearCache() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  /**
   * 현재 사용자의 상세설계 승인 상태를 조회.
   * @param {object} supabaseClient - window.supabase.createClient() 결과
   * @param {string} userId
   * @returns {Promise<{approved:boolean, requestedAt:?string}>}
   */
  async function fetchStatus(supabaseClient, userId) {
    if (!supabaseClient || !userId) {
      return { approved: false, requestedAt: null };
    }

    // W12-23: 참(승인)만 캐시한다. 조회가 한 번 실패했다고 1분간 미승인으로
    // 눌러앉으면, 승인된 사용자가 이유 없이 막힌다.
    const cached = readCache(userId);
    if (cached && cached.approved) {
      return { approved: true, requestedAt: cached.requestedAt || null };
    }

    // W12-23: **관리자는 언제나 승인으로 본다.** 상세설계뿐 아니라 nav 노출까지
    // 같은 판정을 쓰므로, 여기서 한 번 통과시키면 모든 서비스 기능이 열린다.
    try {
      if (window.AdminAccess && (await window.AdminAccess.isAdmin(supabaseClient))) {
        writeCache(userId, true, null);
        return { approved: true, requestedAt: null };
      }
    } catch (e) { /* 관리자 판정 실패는 일반 사용자로 흘려보낸다 */ }

    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('detaildesign_approved, detaildesign_requested_at')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('[DetailDesignAccess] profiles 조회 실패:', error.message);
        // fail-closed: 조회 실패 시 미승인 취급
        return { approved: false, requestedAt: null };
      }

      const approved = Boolean(data && data.detaildesign_approved);
      const requestedAt = (data && data.detaildesign_requested_at) || null;
      if (approved) writeCache(userId, true, requestedAt);   // W12-23: 참만 캐시
      return { approved, requestedAt };
    } catch (e) {
      console.warn('[DetailDesignAccess] profiles 조회 예외:', e.message);
      return { approved: false, requestedAt: null };
    }
  }

  /**
   * 네비게이션(Detail Design 탭) 표시 여부를 승인 상태에 맞춰 토글.
   * 모든 페이지에서 로그인 성공 후 호출.
   * @returns {Promise<boolean>} approved 여부
   */
  async function updateNavVisibility(supabaseClient, user) {
    const userId = (user && user.id) || null;
    const { approved } = userId
      ? await fetchStatus(supabaseClient, userId)
      : { approved: false };

    ['#navDetailDesign', '#mobileDetailDesign'].forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.style.display = approved ? '' : 'none';
      });
    });
    return approved;
  }

  /**
   * 사용자가 상세설계 권한을 신청 (profiles.detaildesign_requested_at = now()).
   * 실제 승인은 관리자가 수행.
   */
  async function requestApproval(supabaseClient, userId) {
    if (!supabaseClient || !userId) {
      return { ok: false, error: 'not_authenticated' };
    }
    try {
      const { error } = await supabaseClient
        .from('profiles')
        .update({ detaildesign_requested_at: new Date().toISOString() })
        .eq('id', userId);
      if (error) throw error;
      clearCache();
      return { ok: true };
    } catch (e) {
      console.error('[DetailDesignAccess] requestApproval 실패:', e.message);
      return { ok: false, error: e.message };
    }
  }

  window.DetailDesignAccess = {
    fetchStatus,
    updateNavVisibility,
    requestApproval,
    clearCache,
  };
})();
