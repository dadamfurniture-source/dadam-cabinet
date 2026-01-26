/**
 * EventBus - 전역 이벤트 시스템
 * 모듈 간 통신을 위한 중앙 이벤트 버스
 */
class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * 이벤트 리스너 등록
   * @param {string} event - 이벤트 이름
   * @param {Function} handler - 핸들러 함수
   * @returns {Function} 구독 해제 함수
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);

    // 구독 해제 함수 반환
    return () => this.off(event, handler);
  }

  /**
   * 일회성 이벤트 리스너 등록
   * @param {string} event - 이벤트 이름
   * @param {Function} handler - 핸들러 함수
   */
  once(event, handler) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    this.on(event, wrapper);
  }

  /**
   * 이벤트 리스너 제거
   * @param {string} event - 이벤트 이름
   * @param {Function} handler - 핸들러 함수
   */
  off(event, handler) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(handler);
    }
  }

  /**
   * 이벤트 발생
   * @param {string} event - 이벤트 이름
   * @param {*} data - 전달할 데이터
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`EventBus: Error in handler for "${event}"`, error);
        }
      });
    }
  }

  /**
   * 특정 이벤트의 모든 리스너 제거
   * @param {string} event - 이벤트 이름
   */
  clear(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

// 이벤트 타입 상수
const Events = {
  // 상태 변경
  STATE_CHANGED: 'state:changed',
  ITEM_ADDED: 'item:added',
  ITEM_REMOVED: 'item:removed',
  ITEM_UPDATED: 'item:updated',
  MODULE_ADDED: 'module:added',
  MODULE_REMOVED: 'module:removed',
  MODULE_UPDATED: 'module:updated',

  // UI 이벤트
  RENDER_REQUESTED: 'ui:render_requested',
  STEP_CHANGED: 'ui:step_changed',
  BOOKMARK_SELECTED: 'ui:bookmark_selected',
  MODAL_OPENED: 'ui:modal_opened',
  MODAL_CLOSED: 'ui:modal_closed',

  // 인증
  AUTH_STATE_CHANGED: 'auth:state_changed',
  USER_LOGGED_IN: 'auth:logged_in',
  USER_LOGGED_OUT: 'auth:logged_out',

  // 저장
  SAVE_STARTED: 'save:started',
  SAVE_COMPLETED: 'save:completed',
  SAVE_FAILED: 'save:failed',
  DESIGN_LOADED: 'design:loaded',

  // AI
  AI_REQUEST_STARTED: 'ai:request_started',
  AI_REQUEST_COMPLETED: 'ai:request_completed',
  AI_MESSAGE_RECEIVED: 'ai:message_received',

  // 계산
  AUTO_CALC_STARTED: 'calc:started',
  AUTO_CALC_COMPLETED: 'calc:completed',
};

// 싱글톤 인스턴스
const eventBus = new EventBus();

// 전역 노출 (레거시 코드 호환)
if (typeof window !== 'undefined') {
  window.DadamEventBus = eventBus;
  window.DadamEvents = Events;
}

export { EventBus, Events, eventBus };
export default eventBus;
