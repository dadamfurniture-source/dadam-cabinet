/**
 * Dadam Modules - 메인 모듈 로더
 * 모든 모듈을 통합하여 내보내기
 */

// 코어 모듈
export { EventBus, Events, eventBus } from './event-bus.js';
export { StateManager, stateManager } from './state-manager.js';

// 유틸리티
export * from './utils.js';

// 상수
export * from './constants.js';

// 서비스
export { SupabaseService, supabaseService } from './services/supabase-service.js';

/**
 * 모듈 초기화 함수
 * @param {Object} options - 초기화 옵션
 */
export async function initDadamModules(options = {}) {
  const { supabaseUrl, supabaseKey } = options;

  // Supabase 서비스 초기화
  const { supabaseService } = await import('./services/supabase-service.js');
  await supabaseService.init(supabaseUrl, supabaseKey);

  // 전역 이벤트 버스 노출
  if (typeof window !== 'undefined') {
    const { eventBus, Events } = await import('./event-bus.js');
    const { stateManager } = await import('./state-manager.js');

    window.Dadam = {
      eventBus,
      Events,
      stateManager,
      supabaseService,
    };
  }

  console.log('Dadam Modules initialized');
}

// UMD 스타일 전역 노출 (ES Modules 미지원 환경용)
if (typeof window !== 'undefined') {
  window.DadamModules = {
    initDadamModules,
  };
}
