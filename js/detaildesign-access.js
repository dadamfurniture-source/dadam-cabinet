/**
 * 상세설계(detaildesign) 접근 권한 유틸리티
 *
 * 정책(D6, 2026-10-18 사장님): 상세설계 화면은 구독 플랜이 POLICY.minTier 이상인 고객에게 연다.
 *   - 관리자(admin_roles)는 언제나 연다.
 *   - 본사 승인(profiles.detaildesign_approved)을 받은 계정은 POLICY.approvedBypassesPlan 이
 *     true 일 때 플랜과 상관없이 연다. 파트너는 이 승인으로 연다 — 파트너 정책이 정해지면
 *     이 한 줄만 바꾼다.
 *   - 등급(profiles.tier)은 관리자·결제 서비스만 바꿀 수 있다 (database/tier-agent.sql
 *     block_self_tier_change). 클라이언트가 보낸 metadata 의 tier 는 믿지 않는다.
 *
 * 로드 순서:
 *   <script src="js/config.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45"></script>
 *   <script src="js/detaildesign-access.js"></script>
 *
 * API:
 *   const { approved, reason, tier, requestedAt } = await DetailDesignAccess.fetchStatus(client, userId);
 *   const { allowed, reason } = DetailDesignAccess.decide({ isAdmin, tier, approved });
 *   const approved = await DetailDesignAccess.updateNavVisibility(client, user);
 *   const { ok, error } = await DetailDesignAccess.requestApproval(client, userId);
 */
(function () {
  'use strict';

  // ── 정책: 여기 한 곳만 고친다 ──
  const POLICY = Object.freeze({
    minTier: 'standard',          // D6 (2026-10-19 사장님: 모든 회원) — 이 등급 이상에게 연다. standard 는 무료 가입 등급
    approvedBypassesPlan: true,   // 본사 승인(파트너 등)은 플랜과 상관없이 연다
  });
  // profiles_tier_check 의 등급 순서 (database/tier-agent.sql)
  const TIER_RANK = Object.freeze({ standard: 0, expert: 1, agent: 2 });

  // v2: 판정 기준이 '승인'에서 '플랜 + 승인'으로 바뀌어 옛 캐시를 버린다
  const STORAGE_KEY = 'dd_approval_cache_v2';
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

  function writeCache(userId, approved, requestedAt, reason, tier) {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ userId, approved, requestedAt, reason, tier, ts: Date.now() })
      );
    } catch (e) {
      /* sessionStorage unavailable — safe to ignore */
    }
  }

  function clearCache() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  /**
   * 접근 판정 (순수 함수). 모르는 등급은 막는다.
   * @returns {{allowed:boolean, reason:'admin'|'plan'|'approved'|'plan_required'}}
   */
  function decide({ isAdmin, tier, approved } = {}) {
    if (isAdmin) return { allowed: true, reason: 'admin' };
    const rank = Object.prototype.hasOwnProperty.call(TIER_RANK, tier) ? TIER_RANK[tier] : -1;
    if (rank >= TIER_RANK[POLICY.minTier]) return { allowed: true, reason: 'plan' };
    if (POLICY.approvedBypassesPlan && approved) return { allowed: true, reason: 'approved' };
    return { allowed: false, reason: 'plan_required' };
  }

  /**
   * 현재 사용자가 상세설계를 쓸 수 있는지 조회. fail-closed.
   * @param {object} supabaseClient - window.supabase.createClient() 결과
   * @param {string} userId
   * @returns {Promise<{approved:boolean, reason:string, tier:?string, requestedAt:?string}>}
   *   approved — 들어갈 수 있는가 (본사 승인 여부만이 아니다)
   */
  async function fetchStatus(supabaseClient, userId) {
    const denied = { approved: false, reason: 'plan_required', tier: null, requestedAt: null };
    if (!supabaseClient || !userId) return denied;

    // W12-23: 참(허용)만 캐시한다. 조회가 한 번 실패했다고 1분간 막힘으로
    // 눌러앉으면, 허용된 사용자가 이유 없이 막힌다.
    const cached = readCache(userId);
    if (cached && cached.approved) {
      return { approved: true, reason: cached.reason || 'plan', tier: cached.tier || null, requestedAt: cached.requestedAt || null };
    }

    // W12-23: **관리자는 언제나 연다.** 상세설계뿐 아니라 nav 노출까지
    // 같은 판정을 쓰므로, 여기서 한 번 통과시키면 모든 서비스 기능이 열린다.
    try {
      if (window.AdminAccess && (await window.AdminAccess.isAdmin(supabaseClient))) {
        writeCache(userId, true, null, 'admin', null);
        return { approved: true, reason: 'admin', tier: null, requestedAt: null };
      }
    } catch (e) { /* 관리자 판정 실패는 일반 사용자로 흘려보낸다 */ }

    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('tier, detaildesign_approved, detaildesign_requested_at')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn('[DetailDesignAccess] profiles 조회 실패:', error.message);
        return denied; // fail-closed
      }

      const tier = (data && data.tier) || null;
      const requestedAt = (data && data.detaildesign_requested_at) || null;
      const { allowed, reason } = decide({ tier, approved: Boolean(data && data.detaildesign_approved) });
      if (allowed) writeCache(userId, true, requestedAt, reason, tier);   // W12-23: 참만 캐시
      return { approved: allowed, reason, tier, requestedAt };
    } catch (e) {
      console.warn('[DetailDesignAccess] profiles 조회 예외:', e.message);
      return denied;
    }
  }

  /**
   * 네비게이션(Detail Design 탭) 표시 여부를 접근 판정에 맞춰 토글.
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
    POLICY,
    decide,
    fetchStatus,
    updateNavVisibility,
    requestApproval,
    clearCache,
  };
})();
