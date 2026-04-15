/**
 * 관리자 접근 권한 유틸리티
 *
 * 정책: admin_roles 테이블에 등록된 user_id 만 관리자. 판별은 반드시
 *       SECURITY DEFINER 함수 public.is_admin() (RLS 우회) 를 통해 수행.
 *       ADMIN_EMAILS 하드코딩 상수 사용 금지.
 *
 * 로드 순서:
 *   <script src="js/config.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45"></script>
 *   <script src="js/admin-access.js"></script>
 *
 * API:
 *   const isAdmin = await AdminAccess.isAdmin(supabaseClient);
 *   const role    = await AdminAccess.getRole(supabaseClient, userId); // 'super_admin'|'admin'|null
 *   AdminAccess.updateNavLinks(isAdmin); // #navAdminLink / #mobileAdminLink 토글
 *   AdminAccess.clearCache();            // 로그아웃 직후 호출
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'admin_access_cache_v1';
  const CACHE_TTL_MS = 60 * 1000;

  function readCache() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed) return null;
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeCache(isAdmin, role) {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ isAdmin, role, ts: Date.now() })
      );
    } catch (e) {
      /* noop */
    }
  }

  function clearCache() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
  }

  /**
   * 현재 세션 사용자가 관리자인지 확인. fail-closed.
   */
  async function isAdmin(supabaseClient) {
    if (!supabaseClient) return false;

    const cached = readCache();
    if (cached && typeof cached.isAdmin === 'boolean') {
      return cached.isAdmin;
    }

    try {
      const { data, error } = await supabaseClient.rpc('is_admin');
      if (error) {
        console.warn('[AdminAccess] is_admin RPC 실패:', error.message);
        writeCache(false, null);
        return false;
      }
      const result = Boolean(data);
      writeCache(result, cached ? cached.role : null);
      return result;
    } catch (e) {
      console.warn('[AdminAccess] is_admin 예외:', e?.message);
      return false;
    }
  }

  /**
   * 관리자 역할 문자열 조회. 일반 사용자면 null.
   * admin_roles RLS "Users can view own role" 정책에 의해 본인 행은 읽을 수 있음.
   */
  async function getRole(supabaseClient, userId) {
    if (!supabaseClient || !userId) return null;

    const cached = readCache();
    if (cached && cached.role !== undefined) {
      return cached.role;
    }

    try {
      const { data, error } = await supabaseClient
        .from('admin_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('[AdminAccess] admin_roles 조회 실패:', error.message);
        return null;
      }
      const role = data ? data.role : null;
      writeCache(cached ? cached.isAdmin : Boolean(role), role);
      return role;
    } catch (e) {
      console.warn('[AdminAccess] getRole 예외:', e?.message);
      return null;
    }
  }

  /**
   * 공용 nav 에 "관리자 페이지" 링크 토글.
   * 대상 ID: #navAdminLink (desktop dropdown), #mobileAdminLink (mobile menu).
   * 각 페이지의 DOM 에 해당 id 가 있으면 display 를 제어. 없으면 조용히 무시.
   */
  function updateNavLinks(isAdminFlag) {
    ['#navAdminLink', '#mobileAdminLink'].forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.style.display = isAdminFlag ? '' : 'none';
      });
    });
  }

  window.AdminAccess = {
    isAdmin,
    getRole,
    updateNavLinks,
    clearCache,
  };
})();
