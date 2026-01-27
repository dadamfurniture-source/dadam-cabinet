/**
 * Supabase 공유 유틸리티
 * 모든 HTML 페이지에서 공통으로 사용하는 Supabase 기능
 */

const SUPABASE_CONFIG = {
  url: 'https://vvqrvgcgnlfpiqqndsve.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2cXJ2Z2NnbmxmcGlxcW5kc3ZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NTYyMjYsImV4cCI6MjA4MzQzMjIyNn0.WvMdB2bojqRUjYWdljAcxP1yHqQZJwuyv2equltyWWQ',
};

const SupabaseUtils = {
  client: null,
  currentUser: null,
  userProfile: null,

  /**
   * Supabase 클라이언트 초기화 및 세션 확인
   * @returns {Promise<Object|null>} 세션 객체 또는 null
   */
  async init() {
    if (typeof window.supabase === 'undefined') {
      console.error('Supabase 라이브러리가 로드되지 않았습니다.');
      return null;
    }

    this.client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    const {
      data: { session },
    } = await this.client.auth.getSession();

    if (session) {
      this.currentUser = session.user;
    }

    return session;
  },

  /**
   * 로그아웃
   * @param {string} redirectUrl - 로그아웃 후 리다이렉트 URL (기본: index.html)
   */
  async signOut(redirectUrl = 'index.html') {
    if (!this.client) return;
    await this.client.auth.signOut();
    window.location.href = redirectUrl;
  },

  /**
   * 사용자 프로필 로드
   * @returns {Promise<Object>} 프로필 객체
   */
  async loadProfile() {
    if (!this.currentUser) return null;

    try {
      const { data, error } = await this.client
        .from('profiles')
        .select('*')
        .eq('id', this.currentUser.id)
        .single();

      if (!error && data) {
        this.userProfile = data;
      } else {
        // profiles 테이블 조회 실패 시 auth.users metadata 사용
        this.userProfile = {
          id: this.currentUser.id,
          email: this.currentUser.email,
          tier: this.currentUser.user_metadata?.tier || 'standard',
          name: this.currentUser.user_metadata?.name || this.currentUser.email.split('@')[0],
        };
      }
    } catch (e) {
      // 폴백: auth.users metadata 사용
      this.userProfile = {
        id: this.currentUser.id,
        email: this.currentUser.email,
        tier: this.currentUser.user_metadata?.tier || 'standard',
        name: this.currentUser.user_metadata?.name || this.currentUser.email.split('@')[0],
      };
    }

    return this.userProfile;
  },

  /**
   * 이미지를 Supabase Storage에 업로드 (계정당 20개 제한)
   * @param {File} file - 업로드할 파일
   * @param {string} userId - 사용자 ID
   * @returns {Promise<string>} 공개 URL
   */
  async uploadImage(file, userId) {
    if (!this.client) {
      throw new Error('Supabase 연결이 필요합니다.');
    }

    // 사용자 폴더 내 이미지 개수 확인
    const { data: existingImages, error: listError } = await this.client.storage
      .from('design-images')
      .list(userId);

    if (listError) {
      console.error('이미지 목록 조회 실패:', listError);
    }

    if (existingImages && existingImages.length >= 20) {
      throw new Error(
        '이미지는 계정당 최대 20개까지 저장할 수 있습니다.\n기존 이미지를 삭제하고 다시 시도해주세요.'
      );
    }

    // 파일명 생성 (userId/timestamp.ext)
    const ext = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}.${ext}`;

    const { data, error } = await this.client.storage.from('design-images').upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });

    if (error) throw error;

    // 공개 URL 반환
    const { data: urlData } = this.client.storage.from('design-images').getPublicUrl(fileName);

    return urlData.publicUrl;
  },

  // ============================================================
  // 설계 관련 CRUD
  // ============================================================

  /**
   * 설계 저장 (신규 또는 업데이트)
   * @param {Object} params - 저장 파라미터
   * @returns {Promise<Object>} 저장된 설계 객체
   */
  async saveDesign({ designId, name, items, appVersion }) {
    if (!this.client || !this.currentUser) {
      throw new Error('로그인이 필요합니다.');
    }

    const totalItems = items.length;
    const totalModules = items.reduce((sum, item) => sum + (item.modules?.length || 0), 0);

    if (designId) {
      // 기존 설계 업데이트
      const { error } = await this.client
        .from('designs')
        .update({
          name,
          total_items: totalItems,
          total_modules: totalModules,
          app_version: appVersion,
          updated_at: new Date().toISOString(),
        })
        .eq('id', designId);

      if (error) throw error;

      // 기존 아이템 삭제 후 재삽입
      await this.client.from('design_items').delete().eq('design_id', designId);

      await this.saveDesignItems(designId, items);

      return { id: designId, isNew: false };
    } else {
      // 신규 설계 생성
      const { data: newDesign, error } = await this.client
        .from('designs')
        .insert({
          user_id: this.currentUser.id,
          name,
          status: 'draft',
          total_items: totalItems,
          total_modules: totalModules,
          app_version: appVersion,
        })
        .select()
        .single();

      if (error) throw error;

      await this.saveDesignItems(newDesign.id, items);

      return { id: newDesign.id, isNew: true };
    }
  },

  /**
   * 설계 아이템 저장
   * @param {string} designId - 설계 ID
   * @param {Array} items - 아이템 배열
   */
  async saveDesignItems(designId, items) {
    const itemsToInsert = items.map((item, index) => ({
      design_id: designId,
      category: item.category || item.categoryId,
      name: item.name,
      unique_id: Math.floor(item.uniqueId),
      width: item.w,
      height: item.h,
      depth: item.d,
      specs: {
        ...(item.specs || {}),
        imageUrl:
          (item.imageUrl || item.image) !== 'loading' ? item.imageUrl || item.image || null : null,
      },
      modules: item.modules || [],
      item_order: index,
    }));

    const { error } = await this.client.from('design_items').insert(itemsToInsert);

    if (error) throw error;
  },

  /**
   * 설계 불러오기
   * @param {string} designId - 설계 ID
   * @returns {Promise<Object>} 설계 및 아이템 데이터
   */
  async loadDesign(designId) {
    if (!this.client || !this.currentUser) {
      throw new Error('로그인이 필요합니다.');
    }

    const { data: design, error: designError } = await this.client
      .from('designs')
      .select('*')
      .eq('id', designId)
      .eq('user_id', this.currentUser.id)
      .single();

    if (designError) throw designError;

    const { data: items, error: itemsError } = await this.client
      .from('design_items')
      .select('*')
      .eq('design_id', designId)
      .order('item_order');

    if (itemsError) throw itemsError;

    return { design, items };
  },

  /**
   * 내 설계 목록 가져오기
   * @param {Object} options - 옵션 (status, limit 등)
   * @returns {Promise<Array>} 설계 목록
   */
  async getMyDesigns(options = {}) {
    if (!this.client || !this.currentUser) {
      throw new Error('로그인이 필요합니다.');
    }

    let query = this.client
      .from('designs')
      .select('*')
      .eq('user_id', this.currentUser.id)
      .order('updated_at', { ascending: false });

    if (options.status) {
      query = query.eq('status', options.status);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data;
  },

  /**
   * 설계 삭제
   * @param {string} designId - 설계 ID
   */
  async deleteDesign(designId) {
    if (!this.client || !this.currentUser) {
      throw new Error('로그인이 필요합니다.');
    }

    // 아이템 먼저 삭제
    await this.client.from('design_items').delete().eq('design_id', designId);

    // 설계 삭제
    const { error } = await this.client
      .from('designs')
      .delete()
      .eq('id', designId)
      .eq('user_id', this.currentUser.id);

    if (error) throw error;
  },

  /**
   * 설계 제출
   * @param {string} designId - 설계 ID
   */
  async submitDesign(designId) {
    if (!this.client || !this.currentUser) {
      throw new Error('로그인이 필요합니다.');
    }

    const { error } = await this.client
      .from('designs')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', designId)
      .eq('user_id', this.currentUser.id);

    if (error) throw error;
  },
};

// 전역 객체로 노출
window.SupabaseUtils = SupabaseUtils;
