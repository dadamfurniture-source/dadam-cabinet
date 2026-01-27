/**
 * SupabaseService - Supabase 통신 서비스
 * 인증, 데이터베이스 CRUD, 스토리지 관리
 */

import { eventBus, Events } from '../event-bus.js';
import { API_ENDPOINTS } from '../constants.js';

class SupabaseService {
  constructor() {
    this.client = null;
    this.currentUser = null;
    this.userProfile = null;
    this.initialized = false;
  }

  /**
   * Supabase 클라이언트 초기화
   * @param {string} url - Supabase URL
   * @param {string} anonKey - Supabase Anon Key
   */
  async init(url = null, anonKey = null) {
    if (this.initialized) return;

    const supabaseUrl = url || API_ENDPOINTS.SUPABASE_URL;
    const supabaseKey =
      anonKey || (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) || 'your-anon-key';

    if (typeof window !== 'undefined' && window.supabase) {
      this.client = window.supabase.createClient(supabaseUrl, supabaseKey);
      this.initialized = true;

      // 인증 상태 변경 감지
      this.client.auth.onAuthStateChange((event, session) => {
        this.currentUser = session?.user || null;
        eventBus.emit(Events.AUTH_STATE_CHANGED, { event, user: this.currentUser });

        if (event === 'SIGNED_IN') {
          eventBus.emit(Events.USER_LOGGED_IN, this.currentUser);
          this.loadUserProfile();
        } else if (event === 'SIGNED_OUT') {
          this.userProfile = null;
          eventBus.emit(Events.USER_LOGGED_OUT);
        }
      });
    }
  }

  /**
   * 현재 세션 확인
   * @returns {Object|null} 세션 정보
   */
  async getSession() {
    if (!this.client) return null;
    const { data } = await this.client.auth.getSession();
    return data.session;
  }

  /**
   * 현재 사용자 가져오기
   * @returns {Object|null} 사용자 정보
   */
  async getCurrentUser() {
    if (!this.client) return null;
    const { data } = await this.client.auth.getUser();
    this.currentUser = data.user;
    return this.currentUser;
  }

  /**
   * 사용자 프로필 로드
   * @returns {Object|null} 프로필 정보
   */
  async loadUserProfile() {
    if (!this.client || !this.currentUser) return null;

    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('id', this.currentUser.id)
        .single();

      if (error) throw error;
      this.userProfile = data;
      return data;
    } catch (error) {
      console.error('프로필 로드 실패:', error);
      return null;
    }
  }

  /**
   * 이메일 로그인
   * @param {string} email - 이메일
   * @param {string} password - 비밀번호
   * @returns {Object} 결과
   */
  async signInWithEmail(email, password) {
    if (!this.client) return { error: 'Client not initialized' };

    const { data, error } = await this.client.auth.signInWithPassword({
      email,
      password,
    });

    return { data, error };
  }

  /**
   * OAuth 로그인
   * @param {string} provider - 제공자 (google, kakao)
   * @param {string} redirectTo - 리다이렉트 URL
   */
  async signInWithOAuth(provider, redirectTo = window.location.origin) {
    if (!this.client) return;

    await this.client.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });
  }

  /**
   * 로그아웃
   * @param {string} redirectUrl - 리다이렉트 URL
   */
  async signOut(redirectUrl = '/login.html') {
    if (!this.client) return;

    await this.client.auth.signOut();
    if (redirectUrl && typeof window !== 'undefined') {
      window.location.href = redirectUrl;
    }
  }

  /**
   * 설계 저장
   * @param {string} designId - 설계 ID
   * @param {string} name - 설계 이름
   * @param {Array} items - 아이템 배열
   * @param {string} appVersion - 앱 버전
   * @returns {Object} 저장 결과
   */
  async saveDesign(designId, name, items, appVersion = '1.0.0') {
    if (!this.client || !this.currentUser) {
      return { error: 'Not authenticated' };
    }

    eventBus.emit(Events.SAVE_STARTED);

    try {
      // 설계 메타데이터 저장
      const designData = {
        id: designId,
        user_id: this.currentUser.id,
        name: name || '새 설계',
        total_items: items.length,
        total_modules: items.reduce((sum, item) => sum + (item.modules?.length || 0), 0),
        app_version: appVersion,
        updated_at: new Date().toISOString(),
      };

      const { data: design, error: designError } = await this.client
        .from('designs')
        .upsert(designData)
        .select()
        .single();

      if (designError) throw designError;

      // 기존 아이템 삭제
      await this.client.from('design_items').delete().eq('design_id', designId);

      // 새 아이템 저장
      if (items.length > 0) {
        const itemsData = items.map((item, index) => ({
          design_id: designId,
          category: item.category,
          name: item.name || '',
          unique_id: item.uniqueId,
          width: item.width || 0,
          height: item.height || 0,
          depth: item.depth || 0,
          specs: item.specs || {},
          modules: item.modules || [],
          item_order: index,
        }));

        const { error: itemsError } = await this.client.from('design_items').insert(itemsData);

        if (itemsError) throw itemsError;
      }

      eventBus.emit(Events.SAVE_COMPLETED, { designId, name });
      return { data: design, error: null };
    } catch (error) {
      console.error('설계 저장 실패:', error);
      eventBus.emit(Events.SAVE_FAILED, error);
      return { data: null, error };
    }
  }

  /**
   * 설계 로드
   * @param {string} designId - 설계 ID
   * @returns {Object} 설계 데이터
   */
  async loadDesign(designId) {
    if (!this.client) return { error: 'Client not initialized' };

    try {
      // 설계 메타데이터 로드
      const { data: design, error: designError } = await this.client
        .from('designs')
        .select('*')
        .eq('id', designId)
        .single();

      if (designError) throw designError;

      // 아이템 로드
      const { data: items, error: itemsError } = await this.client
        .from('design_items')
        .select('*')
        .eq('design_id', designId)
        .order('item_order');

      if (itemsError) throw itemsError;

      // 아이템 형식 변환
      const formattedItems = items.map((item) => ({
        uniqueId: item.unique_id,
        category: item.category,
        name: item.name,
        width: item.width,
        height: item.height,
        depth: item.depth,
        specs: item.specs || {},
        modules: item.modules || [],
      }));

      eventBus.emit(Events.DESIGN_LOADED, { design, items: formattedItems });
      return { data: { design, items: formattedItems }, error: null };
    } catch (error) {
      console.error('설계 로드 실패:', error);
      return { data: null, error };
    }
  }

  /**
   * 내 설계 목록 조회
   * @param {Object} options - 옵션 { limit, offset, status }
   * @returns {Array} 설계 목록
   */
  async getMyDesigns(options = {}) {
    if (!this.client || !this.currentUser) {
      return { data: [], error: 'Not authenticated' };
    }

    const { limit = 20, offset = 0, status = null } = options;

    try {
      let query = this.client
        .from('designs')
        .select('*')
        .eq('user_id', this.currentUser.id)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('설계 목록 조회 실패:', error);
      return { data: [], error };
    }
  }

  /**
   * 설계 삭제
   * @param {string} designId - 설계 ID
   * @returns {Object} 삭제 결과
   */
  async deleteDesign(designId) {
    if (!this.client || !this.currentUser) {
      return { error: 'Not authenticated' };
    }

    try {
      // 아이템 먼저 삭제
      await this.client.from('design_items').delete().eq('design_id', designId);

      // 설계 삭제
      const { error } = await this.client.from('designs').delete().eq('id', designId);

      if (error) throw error;

      return { error: null };
    } catch (error) {
      console.error('설계 삭제 실패:', error);
      return { error };
    }
  }

  /**
   * 이미지 업로드
   * @param {File} file - 파일
   * @param {string} userId - 사용자 ID
   * @returns {Object} 업로드 결과
   */
  async uploadImage(file, userId = null) {
    if (!this.client) return { error: 'Client not initialized' };

    const uid = userId || this.currentUser?.id;
    if (!uid) return { error: 'User not authenticated' };

    const fileExt = file.name.split('.').pop();
    const fileName = `${uid}/${Date.now()}.${fileExt}`;

    try {
      const { data, error } = await this.client.storage
        .from('design-images')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) throw error;

      // Public URL 생성
      const {
        data: { publicUrl },
      } = this.client.storage.from('design-images').getPublicUrl(fileName);

      return { data: { path: data.path, url: publicUrl }, error: null };
    } catch (error) {
      console.error('이미지 업로드 실패:', error);
      return { data: null, error };
    }
  }
}

// 싱글톤 인스턴스
const supabaseService = new SupabaseService();

// 전역 노출 (레거시 코드 호환)
if (typeof window !== 'undefined') {
  window.DadamSupabaseService = supabaseService;
}

export { SupabaseService, supabaseService };
export default supabaseService;
