/**
 * StateManager - 중앙 상태 관리
 * 설계 데이터의 상태를 중앙에서 관리
 */

import { eventBus, Events } from './event-bus.js';

class StateManager {
  constructor() {
    this.items = [];
    this.currentDesignId = null;
    this.hasUnsavedChanges = false;
    this.autoCalcHistory = new Map(); // 자동 계산 히스토리 (Undo용)
  }

  /**
   * 상태 초기화
   */
  reset() {
    this.items = [];
    this.currentDesignId = null;
    this.hasUnsavedChanges = false;
    this.autoCalcHistory.clear();
    eventBus.emit(Events.STATE_CHANGED, { action: 'reset' });
  }

  /**
   * 아이템 추가
   * @param {Object} item - 아이템 데이터
   * @returns {Object} 추가된 아이템
   */
  addItem(item) {
    const newItem = {
      uniqueId: item.uniqueId || Date.now(),
      category: item.category,
      name: item.name || '',
      width: item.width || 0,
      height: item.height || 0,
      depth: item.depth || 0,
      specs: item.specs || {},
      modules: item.modules || [],
      ...item,
    };

    this.items.push(newItem);
    this.markChanged();
    eventBus.emit(Events.ITEM_ADDED, newItem);
    return newItem;
  }

  /**
   * 아이템 제거
   * @param {number} uniqueId - 아이템 고유 ID
   * @returns {boolean} 제거 성공 여부
   */
  removeItem(uniqueId) {
    const index = this.items.findIndex((item) => item.uniqueId === uniqueId);
    if (index !== -1) {
      const removed = this.items.splice(index, 1)[0];
      this.markChanged();
      eventBus.emit(Events.ITEM_REMOVED, removed);
      return true;
    }
    return false;
  }

  /**
   * 아이템 조회
   * @param {number} uniqueId - 아이템 고유 ID
   * @returns {Object|undefined} 아이템 또는 undefined
   */
  getItem(uniqueId) {
    return this.items.find((item) => item.uniqueId === uniqueId);
  }

  /**
   * 아이템 업데이트
   * @param {number} uniqueId - 아이템 고유 ID
   * @param {Object} updates - 업데이트할 데이터
   * @param {Object} options - 옵션 { skipRender: boolean }
   * @returns {Object|null} 업데이트된 아이템 또는 null
   */
  updateItem(uniqueId, updates, options = {}) {
    const item = this.getItem(uniqueId);
    if (!item) return null;

    Object.assign(item, updates);
    this.markChanged();

    if (!options.skipRender) {
      eventBus.emit(Events.ITEM_UPDATED, { item, updates, options });
    }
    return item;
  }

  /**
   * 아이템 스펙 업데이트
   * @param {number} uniqueId - 아이템 고유 ID
   * @param {string} key - 스펙 키
   * @param {*} value - 스펙 값
   * @param {Object} options - 옵션
   * @returns {Object|null} 업데이트된 아이템
   */
  updateItemSpec(uniqueId, key, value, options = {}) {
    const item = this.getItem(uniqueId);
    if (!item) return null;

    if (!item.specs) item.specs = {};
    item.specs[key] = value;
    this.markChanged();

    if (!options.skipRender) {
      eventBus.emit(Events.ITEM_UPDATED, { item, updates: { specs: { [key]: value } }, options });
    }
    return item;
  }

  /**
   * 모듈 조회
   * @param {number} itemId - 아이템 고유 ID
   * @param {number} modId - 모듈 ID
   * @returns {Object|undefined} 모듈 또는 undefined
   */
  getModule(itemId, modId) {
    const item = this.getItem(itemId);
    if (!item || !item.modules) return undefined;
    return item.modules.find((m) => m.id === modId);
  }

  /**
   * 모듈 추가
   * @param {number} itemId - 아이템 고유 ID
   * @param {Object} module - 모듈 데이터
   * @returns {Object|null} 추가된 모듈 또는 null
   */
  addModule(itemId, module) {
    const item = this.getItem(itemId);
    if (!item) return null;

    if (!item.modules) item.modules = [];

    const newModule = {
      id: module.id || Date.now(),
      type: module.type || 'default',
      ...module,
    };

    item.modules.push(newModule);
    this.markChanged();
    eventBus.emit(Events.MODULE_ADDED, { itemId, module: newModule });
    return newModule;
  }

  /**
   * 모듈 제거
   * @param {number} itemId - 아이템 고유 ID
   * @param {number} modId - 모듈 ID
   * @returns {boolean} 제거 성공 여부
   */
  removeModule(itemId, modId) {
    const item = this.getItem(itemId);
    if (!item || !item.modules) return false;

    const index = item.modules.findIndex((m) => m.id === modId);
    if (index !== -1) {
      const removed = item.modules.splice(index, 1)[0];
      this.markChanged();
      eventBus.emit(Events.MODULE_REMOVED, { itemId, module: removed });
      return true;
    }
    return false;
  }

  /**
   * 모듈 업데이트
   * @param {number} itemId - 아이템 고유 ID
   * @param {number} modId - 모듈 ID
   * @param {Object} updates - 업데이트할 데이터
   * @param {Object} options - 옵션
   * @returns {Object|null} 업데이트된 모듈 또는 null
   */
  updateModule(itemId, modId, updates, options = {}) {
    const module = this.getModule(itemId, modId);
    if (!module) return null;

    Object.assign(module, updates);
    this.markChanged();

    if (!options.skipRender) {
      eventBus.emit(Events.MODULE_UPDATED, { itemId, module, updates, options });
    }
    return module;
  }

  /**
   * 모듈 이동
   * @param {number} itemId - 아이템 고유 ID
   * @param {number} modId - 모듈 ID
   * @param {number} direction - 이동 방향 (-1: 위, 1: 아래)
   * @returns {boolean} 이동 성공 여부
   */
  moveModule(itemId, modId, direction) {
    const item = this.getItem(itemId);
    if (!item || !item.modules) return false;

    const index = item.modules.findIndex((m) => m.id === modId);
    if (index === -1) return false;

    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= item.modules.length) return false;

    // 배열에서 위치 교환
    [item.modules[index], item.modules[newIndex]] = [item.modules[newIndex], item.modules[index]];

    this.markChanged();
    eventBus.emit(Events.MODULE_UPDATED, { itemId, action: 'move', direction });
    return true;
  }

  /**
   * 모든 아이템 조회
   * @returns {Array} 아이템 배열
   */
  getAllItems() {
    return [...this.items];
  }

  /**
   * 카테고리별 아이템 조회
   * @param {string} category - 카테고리 ID
   * @returns {Array} 해당 카테고리 아이템 배열
   */
  getItemsByCategory(category) {
    return this.items.filter((item) => item.category === category);
  }

  /**
   * 현재 상태를 JSON으로 내보내기
   * @returns {Object} 상태 JSON
   */
  exportState() {
    return {
      designId: this.currentDesignId,
      items: JSON.parse(JSON.stringify(this.items)),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * JSON에서 상태 가져오기
   * @param {Object} state - 상태 JSON
   */
  importState(state) {
    if (state.items) {
      this.items = state.items;
    }
    if (state.designId) {
      this.currentDesignId = state.designId;
    }
    this.hasUnsavedChanges = false;
    eventBus.emit(Events.STATE_CHANGED, { action: 'import' });
    eventBus.emit(Events.DESIGN_LOADED, state);
  }

  /**
   * 변경 표시
   */
  markChanged() {
    this.hasUnsavedChanges = true;
  }

  /**
   * 저장 완료 표시
   */
  markSaved() {
    this.hasUnsavedChanges = false;
  }

  /**
   * 자동 계산 히스토리 저장 (Undo용)
   * @param {number} itemId - 아이템 ID
   */
  saveAutoCalcHistory(itemId) {
    const item = this.getItem(itemId);
    if (item) {
      this.autoCalcHistory.set(itemId, JSON.parse(JSON.stringify(item.modules)));
    }
  }

  /**
   * 자동 계산 취소 (Undo)
   * @param {number} itemId - 아이템 ID
   * @returns {boolean} 복원 성공 여부
   */
  undoAutoCalc(itemId) {
    if (this.autoCalcHistory.has(itemId)) {
      const item = this.getItem(itemId);
      if (item) {
        item.modules = this.autoCalcHistory.get(itemId);
        this.autoCalcHistory.delete(itemId);
        this.markChanged();
        eventBus.emit(Events.ITEM_UPDATED, { item, action: 'undo' });
        return true;
      }
    }
    return false;
  }
}

// 싱글톤 인스턴스
const stateManager = new StateManager();

// 전역 노출 (레거시 코드 호환)
if (typeof window !== 'undefined') {
  window.DadamStateManager = stateManager;
}

export { StateManager, stateManager };
export default stateManager;
