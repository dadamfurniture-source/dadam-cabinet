      let selectedItems = [];

      // ============================================================
      // 공통 유틸리티 함수들
      // ============================================================

      /**
       * debounce 유틸리티 - 연속 호출 시 마지막 호출만 실행
       * 렌더링 성능 최적화를 위해 사용
       */
      function debounce(func, wait = 50) {
        let timeoutId = null;
        return function (...args) {
          if (timeoutId) clearTimeout(timeoutId);
          timeoutId = setTimeout(() => {
            func.apply(this, args);
            timeoutId = null;
          }, wait);
        };
      }

      /**
       * throttle 유틸리티 - 지정 시간 동안 최대 1회만 실행
       */
      function throttle(func, limit = 100) {
        let inThrottle = false;
        return function (...args) {
          if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
          }
        };
      }

      /**
       * 포커스 복원 함수 - 렌더링 후 입력 필드 포커스 복원
       */
      function _restoreFocus(container, focusInfo) {
        if (!focusInfo) return;

        // requestAnimationFrame으로 DOM 업데이트 후 포커스 복원
        requestAnimationFrame(() => {
          let targetEl = null;
          if (focusInfo.onchange) {
            targetEl = container.querySelector(`input[onchange="${focusInfo.onchange}"]`);
          } else if (focusInfo.onblur) {
            targetEl = container.querySelector(`input[onblur="${focusInfo.onblur}"]`);
          }

          if (targetEl) {
            targetEl.focus({ preventScroll: true });
            if (focusInfo.selectionStart !== null && targetEl.type !== 'number') {
              try {
                targetEl.setSelectionRange(focusInfo.selectionStart, focusInfo.selectionEnd);
              } catch (e) {}
            }
          }
        });
      }

      // ★ 스크롤 위치 복원 (패널 + 페이지 모두)
      function _restoreScroll(container, scrollInfo) {
        if (!scrollInfo) return;
        const apply = () => {
          const sp = container.querySelector('.spec-panel');
          const mp = container.querySelector('.module-panel');
          if (sp && scrollInfo.specPanel) sp.scrollTop = scrollInfo.specPanel;
          if (mp && scrollInfo.modulePanel) mp.scrollTop = scrollInfo.modulePanel;
          if (scrollInfo.pageY) window.scrollTo(0, scrollInfo.pageY);
        };
        apply();
        setTimeout(apply, 0);
        requestAnimationFrame(apply);
      }

      /**
       * 아이템 조회 헬퍼
       */
      function getItem(itemUniqueId) {
        return selectedItems.find((i) => i.uniqueId === itemUniqueId);
      }

      /**
       * 모듈 조회 헬퍼
       */
      function getModule(itemUniqueId, modId) {
        const item = getItem(itemUniqueId);
        return item ? item.modules.find((m) => m.id === modId) : null;
      }

      /**
       * 스펙 업데이트 공통 함수
       */
      function updateItemSpec(itemUniqueId, field, value, shouldRender = true) {
        const item = getItem(itemUniqueId);
        if (!item) return null;
        item.specs[field] = isNaN(parseFloat(value)) ? value : parseFloat(value);
        if (shouldRender) renderWorkspaceContent(item);
        return item;
      }

      /**
       * 모듈 업데이트 공통 함수
       */
      function updateModuleField(itemUniqueId, modId, field, value, shouldRender = true) {
        const item = getItem(itemUniqueId);
        if (!item) return null;
        const mod = item.modules.find((m) => m.id === modId);
        if (!mod) return null;
        mod[field] = isNaN(parseFloat(value)) ? value : parseFloat(value);
        if (shouldRender) renderWorkspaceContent(item);
        return { item, mod };
      }

      /**
       * SVG 사각형 생성 헬퍼
       */
      function svgRect(x, y, w, h, fill, stroke, strokeWidth = 1, rx = 0) {
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="${rx}"/>`;
      }

      /**
       * SVG 텍스트 생성 헬퍼
       */
      function svgText(x, y, text, opts = {}) {
        const anchor = opts.anchor || 'middle';
        const fontSize = opts.fontSize || 10;
        const fill = opts.fill || '#333';
        const fontWeight = opts.fontWeight || 'normal';
        return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${fontSize}" fill="${fill}" font-weight="${fontWeight}">${text}</text>`;
      }

      /**
       * 버튼 HTML 생성 헬퍼
       */
      function createButton(label, onclick, className = '', style = '') {
        return `<button class="${className}" onclick="${onclick}" style="${style}">${label}</button>`;
      }

      /**
       * 인풋 HTML 생성 헬퍼
       */
      function createNumberInput(value, onchange, style = 'width:60px;') {
        return `<input type="number" value="${value}" onchange="${onchange}" style="${style}">`;
      }
