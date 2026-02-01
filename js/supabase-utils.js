/**
 * Supabase 공유 유틸리티
 * 모든 HTML 페이지에서 공통으로 사용하는 Supabase 기능
 *
 * 주의: js/config.js 파일이 먼저 로드되어야 합니다.
 * <script src="js/config.js"></script>
 * <script src="js/supabase-utils.js"></script>
 */

// 설정은 window.DADAM_CONFIG에서 가져옴 (js/config.js에서 정의)
const SUPABASE_CONFIG = {
  get url() {
    if (!window.DADAM_CONFIG?.supabase?.url) {
      console.error('Supabase URL이 설정되지 않았습니다. js/config.js 파일을 확인하세요.');
      return '';
    }
    return window.DADAM_CONFIG.supabase.url;
  },
  get anonKey() {
    if (!window.DADAM_CONFIG?.supabase?.anonKey) {
      console.error('Supabase Anon Key가 설정되지 않았습니다. js/config.js 파일을 확인하세요.');
      return '';
    }
    return window.DADAM_CONFIG.supabase.anonKey;
  },
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

  // ============================================================
  // 이미지 관리 (현장 사진 / AI 생성 이미지 구분)
  // 계정당 20개 제한, 초과 시 가장 오래된 이미지 자동 삭제
  // ============================================================

  MAX_IMAGES_PER_USER: 20,

  /**
   * 현장 사진 이미지 업로드 (계정당 20개 제한, 초과 시 자동 삭제)
   * @param {File} file - 업로드할 파일
   * @param {string} userId - 사용자 ID
   * @returns {Promise<Object>} { publicUrl, imageId }
   */
  async uploadSitePhoto(file, userId) {
    return this.uploadImageWithType(file, userId, 'site_photo');
  },

  /**
   * AI 생성 이미지 저장 (계정당 20개 제한, 초과 시 자동 삭제)
   * @param {string} base64Data - Base64 인코딩된 이미지 데이터
   * @param {string} userId - 사용자 ID
   * @param {Object} options - 추가 옵션 { designId, doorState, metadata }
   * @returns {Promise<Object>} { publicUrl, imageId }
   */
  async saveAIGeneratedImage(base64Data, userId, options = {}) {
    if (!this.client) {
      throw new Error('Supabase 연결이 필요합니다.');
    }

    // 이미지 개수 확인 및 자동 삭제
    await this.ensureImageLimit(userId);

    // Base64를 Blob으로 변환
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    // 파일명 생성 (userId/ai_generated/timestamp.png)
    const timestamp = Date.now();
    const storagePath = `${userId}/ai_generated/${timestamp}.png`;

    // Storage에 업로드
    const { data, error } = await this.client.storage
      .from('design-images')
      .upload(storagePath, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/png',
      });

    if (error) throw error;

    // 공개 URL 가져오기
    const { data: urlData } = this.client.storage.from('design-images').getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    // 메타데이터 테이블에 저장
    const { data: imageRecord, error: dbError } = await this.client
      .from('user_images')
      .insert({
        user_id: userId,
        image_type: 'ai_generated',
        storage_path: storagePath,
        public_url: publicUrl,
        file_name: `${timestamp}.png`,
        file_size_bytes: blob.size,
        mime_type: 'image/png',
        design_id: options.designId || null,
        door_state: options.doorState || null,
        metadata: options.metadata || {},
      })
      .select()
      .single();

    if (dbError) {
      console.error('이미지 메타데이터 저장 실패:', dbError);
    }

    return {
      publicUrl,
      imageId: imageRecord?.id || null,
      storagePath,
    };
  },

  /**
   * 이미지 업로드 (타입 지정)
   * @param {File} file - 업로드할 파일
   * @param {string} userId - 사용자 ID
   * @param {string} imageType - 'site_photo' 또는 'ai_generated'
   * @returns {Promise<Object>} { publicUrl, imageId }
   */
  async uploadImageWithType(file, userId, imageType) {
    if (!this.client) {
      throw new Error('Supabase 연결이 필요합니다.');
    }

    // 이미지 개수 확인 및 자동 삭제
    await this.ensureImageLimit(userId);

    // 파일명 생성 (userId/site_photo/timestamp.ext)
    const ext = file.name.split('.').pop();
    const timestamp = Date.now();
    const storagePath = `${userId}/${imageType}/${timestamp}.${ext}`;

    const { data, error } = await this.client.storage
      .from('design-images')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) throw error;

    // 공개 URL 가져오기
    const { data: urlData } = this.client.storage.from('design-images').getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    // 메타데이터 테이블에 저장
    const { data: imageRecord, error: dbError } = await this.client
      .from('user_images')
      .insert({
        user_id: userId,
        image_type: imageType,
        storage_path: storagePath,
        public_url: publicUrl,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type || 'image/jpeg',
      })
      .select()
      .single();

    if (dbError) {
      console.error('이미지 메타데이터 저장 실패:', dbError);
    }

    return {
      publicUrl,
      imageId: imageRecord?.id || null,
      storagePath,
    };
  },

  /**
   * 이미지 개수 제한 확인 및 초과 시 가장 오래된 이미지 자동 삭제
   * @param {string} userId - 사용자 ID
   */
  async ensureImageLimit(userId) {
    if (!this.client) return;

    // 현재 이미지 개수 확인 (메타데이터 테이블 기준)
    const { data: images, error } = await this.client
      .from('user_images')
      .select('id, storage_path, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('이미지 목록 조회 실패:', error);
      return;
    }

    // 제한 초과 시 가장 오래된 이미지 삭제
    if (images && images.length >= this.MAX_IMAGES_PER_USER) {
      const oldestImage = images[0];
      console.log(`이미지 개수 제한(${this.MAX_IMAGES_PER_USER}개) 도달. 가장 오래된 이미지 삭제:`, oldestImage.storage_path);

      await this.deleteImage(oldestImage.id, oldestImage.storage_path);
    }
  },

  /**
   * 이미지 삭제 (Storage + 메타데이터)
   * @param {string} imageId - 이미지 메타데이터 ID
   * @param {string} storagePath - Storage 경로
   */
  async deleteImage(imageId, storagePath) {
    if (!this.client) return;

    // Storage에서 삭제
    if (storagePath) {
      const { error: storageError } = await this.client.storage
        .from('design-images')
        .remove([storagePath]);

      if (storageError) {
        console.error('Storage 이미지 삭제 실패:', storageError);
      }
    }

    // 메타데이터 테이블에서 삭제
    if (imageId) {
      const { error: dbError } = await this.client
        .from('user_images')
        .delete()
        .eq('id', imageId);

      if (dbError) {
        console.error('이미지 메타데이터 삭제 실패:', dbError);
      }
    }
  },

  /**
   * 사용자의 이미지 목록 조회
   * @param {string} userId - 사용자 ID
   * @param {Object} options - { imageType: 'site_photo' | 'ai_generated' | null }
   * @returns {Promise<Array>} 이미지 목록
   */
  async getUserImages(userId, options = {}) {
    if (!this.client) return [];

    let query = this.client
      .from('user_images')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (options.imageType) {
      query = query.eq('image_type', options.imageType);
    }

    const { data, error } = await query;

    if (error) {
      console.error('이미지 목록 조회 실패:', error);
      return [];
    }

    return data || [];
  },

  /**
   * 레거시 호환: 기존 uploadImage 함수 (현장 사진으로 처리)
   * @param {File} file - 업로드할 파일
   * @param {string} userId - 사용자 ID
   * @returns {Promise<string>} 공개 URL
   */
  async uploadImage(file, userId) {
    const result = await this.uploadSitePhoto(file, userId);
    return result.publicUrl;
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
