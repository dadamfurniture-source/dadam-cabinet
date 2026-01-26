/**
 * Utils - 공통 유틸리티 함수
 * debounce, throttle, DOM 헬퍼 등
 */

/**
 * Debounce 함수 - 연속 호출 시 마지막 호출만 실행
 * @param {Function} func - 실행할 함수
 * @param {number} wait - 대기 시간 (ms)
 * @param {boolean} immediate - 즉시 실행 여부
 * @returns {Function} debounce된 함수
 */
export function debounce(func, wait = 100, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const context = this;
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

/**
 * Throttle 함수 - 지정 시간 동안 최대 1회만 실행
 * @param {Function} func - 실행할 함수
 * @param {number} limit - 제한 시간 (ms)
 * @returns {Function} throttle된 함수
 */
export function throttle(func, limit = 100) {
  let inThrottle;
  return function executedFunction(...args) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * 포커스 상태 저장
 * @returns {Object} 포커스 정보
 */
export function saveFocusState() {
  const activeElement = document.activeElement;
  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT')) {
    return {
      element: activeElement,
      name: activeElement.name,
      id: activeElement.id,
      selectionStart: activeElement.selectionStart,
      selectionEnd: activeElement.selectionEnd,
      value: activeElement.value,
    };
  }
  return null;
}

/**
 * 포커스 상태 복원
 * @param {Object} focusState - 저장된 포커스 정보
 */
export function restoreFocusState(focusState) {
  if (!focusState) return;

  setTimeout(() => {
    // ID로 먼저 찾기
    let element = focusState.id ? document.getElementById(focusState.id) : null;

    // name으로 찾기
    if (!element && focusState.name) {
      element = document.querySelector(`[name="${focusState.name}"]`);
    }

    if (element && element.tagName) {
      element.focus();

      // 입력 필드의 경우 커서 위치 복원
      if (element.tagName === 'INPUT' && element.type === 'text') {
        try {
          if (focusState.selectionStart !== undefined) {
            element.setSelectionRange(focusState.selectionStart, focusState.selectionEnd);
          }
        } catch (e) {
          // setSelectionRange 지원하지 않는 입력 타입
        }
      }
    }
  }, 0);
}

/**
 * SVG 사각형 생성
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {number} w - 너비
 * @param {number} h - 높이
 * @param {string} fill - 채우기 색상
 * @param {string} stroke - 테두리 색상
 * @param {number} strokeWidth - 테두리 두께
 * @returns {string} SVG rect 요소 문자열
 */
export function svgRect(x, y, w, h, fill = '#e8e8e8', stroke = '#666', strokeWidth = 1) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

/**
 * SVG 텍스트 생성
 * @param {number} x - X 좌표
 * @param {number} y - Y 좌표
 * @param {string} content - 텍스트 내용
 * @param {Object} options - 옵션 { fontSize, fill, anchor, weight }
 * @returns {string} SVG text 요소 문자열
 */
export function svgText(x, y, content, options = {}) {
  const {
    fontSize = 10,
    fill = '#333',
    anchor = 'middle',
    weight = 'normal',
    dominantBaseline = 'middle',
  } = options;

  return `<text x="${x}" y="${y}" font-size="${fontSize}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" dominant-baseline="${dominantBaseline}">${content}</text>`;
}

/**
 * SVG 선 생성
 * @param {number} x1 - 시작 X
 * @param {number} y1 - 시작 Y
 * @param {number} x2 - 끝 X
 * @param {number} y2 - 끝 Y
 * @param {string} stroke - 선 색상
 * @param {number} strokeWidth - 선 두께
 * @param {string} dashArray - 점선 패턴
 * @returns {string} SVG line 요소 문자열
 */
export function svgLine(x1, y1, x2, y2, stroke = '#666', strokeWidth = 1, dashArray = '') {
  const dash = dashArray ? `stroke-dasharray="${dashArray}"` : '';
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" ${dash}/>`;
}

/**
 * 버튼 HTML 생성
 * @param {string} label - 버튼 텍스트
 * @param {string} action - data-action 값
 * @param {Object} dataAttrs - 추가 data 속성들
 * @param {string} className - CSS 클래스
 * @returns {string} 버튼 HTML
 */
export function createButton(label, action, dataAttrs = {}, className = 'btn-sm') {
  const dataStr = Object.entries(dataAttrs)
    .map(([key, value]) => `data-${key}="${value}"`)
    .join(' ');
  return `<button class="${className}" data-action="${action}" ${dataStr}>${label}</button>`;
}

/**
 * 숫자 입력 필드 HTML 생성
 * @param {string} name - 입력 필드 name
 * @param {number} value - 현재 값
 * @param {Object} options - 옵션 { min, max, step, className, dataAttrs }
 * @returns {string} 입력 필드 HTML
 */
export function createNumberInput(name, value, options = {}) {
  const { min = 0, max = 9999, step = 1, className = 'input-sm', dataAttrs = {} } = options;

  const dataStr = Object.entries(dataAttrs)
    .map(([key, value]) => `data-${key}="${value}"`)
    .join(' ');

  return `<input type="number" name="${name}" value="${value}" min="${min}" max="${max}" step="${step}" class="${className}" ${dataStr}>`;
}

/**
 * Select 요소 HTML 생성
 * @param {string} name - select name
 * @param {Array} options - 옵션 배열 [{ value, label, selected }]
 * @param {Object} attrs - 추가 속성
 * @returns {string} select HTML
 */
export function createSelect(name, options, attrs = {}) {
  const attrStr = Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ');

  const optionsHtml = options
    .map((opt) => `<option value="${opt.value}" ${opt.selected ? 'selected' : ''}>${opt.label}</option>`)
    .join('');

  return `<select name="${name}" ${attrStr}>${optionsHtml}</select>`;
}

/**
 * 숫자 포맷팅 (천단위 콤마)
 * @param {number} num - 숫자
 * @returns {string} 포맷된 문자열
 */
export function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 안전한 숫자 파싱
 * @param {*} value - 파싱할 값
 * @param {number} defaultValue - 기본값
 * @returns {number} 파싱된 숫자
 */
export function safeParseInt(value, defaultValue = 0) {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * 안전한 실수 파싱
 * @param {*} value - 파싱할 값
 * @param {number} defaultValue - 기본값
 * @returns {number} 파싱된 숫자
 */
export function safeParseFloat(value, defaultValue = 0) {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * UUID 생성
 * @returns {string} UUID
 */
export function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 깊은 복사
 * @param {*} obj - 복사할 객체
 * @returns {*} 복사된 객체
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 토스트 메시지 표시
 * @param {string} message - 메시지
 * @param {string} type - 타입 (success, error, warning, info)
 * @param {number} duration - 표시 시간 (ms)
 */
export function showToast(message, type = 'info', duration = 3000) {
  // 기존 토스트 제거
  const existingToast = document.querySelector('.toast-notification');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 24px;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    background-color: ${
      type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6'
    };
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// 전역 노출 (레거시 코드 호환)
if (typeof window !== 'undefined') {
  window.DadamUtils = {
    debounce,
    throttle,
    saveFocusState,
    restoreFocusState,
    svgRect,
    svgText,
    svgLine,
    createButton,
    createNumberInput,
    createSelect,
    formatNumber,
    safeParseInt,
    safeParseFloat,
    generateUUID,
    deepClone,
    showToast,
  };
}
