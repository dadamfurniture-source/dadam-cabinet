      // ============================================================
      // Floorplan Bridge — 부모 측 iframe 통신 (vanilla JS, M1)
      //
      // M1 산출물의 부모 측 진입점. 다음을 제공:
      //   - PlannerBridge.create(itemUniqueId, iframeWindow) — 인스턴스 생성
      //   - sendFloorplan(floorplan, modules, specs) — 자식에 평면 전송
      //   - sendCameraView(view) / sendEditMode(mode) — 보조 메시지
      //   - onFloorplanChanged(handler) — 자식이 평면 변경 시 콜백
      //
      // 보안:
      //   - postMessage targetOrigin = location.origin (동일 origin 가정)
      //   - 수신 시 e.origin === location.origin 검증
      //   - payload type guard로 잘못된 메시지 무시
      //   - nonce echo 차단으로 ping-pong 방지
      //
      // 의존: lib/floorplan-types.ts 의 schemaVersion=2 Floorplan
      //   본 파일은 vanilla JS이므로 type guard는 인라인으로 복제 (lib 측 schema와 동기 필요)
      // ============================================================

      (function () {
        const ALLOWED_ORIGIN = (typeof window !== 'undefined' && window.location && window.location.origin) || '*';

        function isObj(v) {
          return typeof v === 'object' && v !== null;
        }

        function isString(v) {
          return typeof v === 'string';
        }

        function isFloorplan(v) {
          return (
            isObj(v) &&
            v.schemaVersion === 2 &&
            Array.isArray(v.spaces) &&
            Array.isArray(v.junctions) &&
            Array.isArray(v.trimmedSpaces)
          );
        }

        const VALID_TRIGGERS = new Set(['drag', 'rotate', 'add', 'delete', 'resize', 'zindex', 'init']);

        function isFloorplanChangedMessage(v) {
          return (
            isObj(v) &&
            v.type === 'FLOORPLAN_CHANGED' &&
            isObj(v.payload) &&
            isFloorplan(v.payload.floorplan) &&
            isString(v.payload.trigger) &&
            VALID_TRIGGERS.has(v.payload.trigger) &&
            isString(v.nonce)
          );
        }

        function isModuleChangedMessage(v) {
          return (
            isObj(v) &&
            v.type === 'MODULE_CHANGED' &&
            isObj(v.payload) &&
            Array.isArray(v.payload.modules) &&
            isString(v.nonce)
          );
        }

        function isPlannerReadyMessage(v) {
          return isObj(v) && v.type === 'PLANNER_READY' && isString(v.version);
        }

        function isPlannerErrorMessage(v) {
          return isObj(v) && v.type === 'PLANNER_ERROR' && isString(v.code) && isString(v.message);
        }

        function generateNonce() {
          return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-8);
        }

        // 송신한 nonce 추적 — 자식이 echo로 같은 nonce를 보내면 무시
        const _sentNonces = new Set();
        const NONCE_GC_LIMIT = 100;

        function trackNonce(nonce) {
          _sentNonces.add(nonce);
          if (_sentNonces.size > NONCE_GC_LIMIT) {
            // 가장 오래된 것부터 제거 (Set은 삽입 순서 보존)
            const first = _sentNonces.values().next().value;
            _sentNonces.delete(first);
          }
        }

        function isEcho(nonce) {
          return _sentNonces.has(nonce);
        }

        // ──────────────────────────────────────────────────────
        // PlannerBridge 클래스
        // ──────────────────────────────────────────────────────
        function PlannerBridge(itemUniqueId, iframeWindow) {
          this.itemUniqueId = itemUniqueId;
          this.iframeWindow = iframeWindow;
          this._handlers = {
            floorplanChanged: [],
            moduleChanged: [],
            ready: [],
            error: [],
          };
          this._messageListener = this._onMessage.bind(this);
          window.addEventListener('message', this._messageListener);
        }

        PlannerBridge.prototype._onMessage = function (event) {
          if (event.origin !== ALLOWED_ORIGIN) return;
          // 자식 iframe에서 온 메시지인지 source 비교 (강한 격리)
          if (this.iframeWindow && event.source !== this.iframeWindow) return;

          const data = event.data;
          if (!isObj(data)) return;

          // echo 차단
          if (isString(data.nonce) && isEcho(data.nonce)) return;

          if (isFloorplanChangedMessage(data)) {
            this._dispatch('floorplanChanged', data.payload);
          } else if (isModuleChangedMessage(data)) {
            this._dispatch('moduleChanged', data.payload);
          } else if (isPlannerReadyMessage(data)) {
            this._dispatch('ready', { version: data.version });
          } else if (isPlannerErrorMessage(data)) {
            this._dispatch('error', { code: data.code, message: data.message });
          }
          // 알 수 없는 type은 silent ignore (forward-compat)
        };

        PlannerBridge.prototype._dispatch = function (eventName, payload) {
          const handlers = this._handlers[eventName] || [];
          for (let i = 0; i < handlers.length; i++) {
            try {
              handlers[i](payload);
            } catch (err) {
              console.error('[PlannerBridge] handler 예외:', err);
            }
          }
        };

        PlannerBridge.prototype._post = function (message) {
          if (!this.iframeWindow || typeof this.iframeWindow.postMessage !== 'function') return;
          try {
            this.iframeWindow.postMessage(message, ALLOWED_ORIGIN);
          } catch (err) {
            console.warn('[PlannerBridge] postMessage 실패:', err);
          }
        };

        // ── 송신 API ──
        PlannerBridge.prototype.sendFloorplan = function (floorplan, modules, specs) {
          if (!isFloorplan(floorplan)) {
            console.warn('[PlannerBridge] sendFloorplan: 잘못된 floorplan');
            return;
          }
          const nonce = generateNonce();
          trackNonce(nonce);
          this._post({
            type: 'UPDATE_FLOORPLAN',
            payload: {
              schemaVersion: 2,
              itemId: this.itemUniqueId,
              floorplan: floorplan,
              modules: modules || [],
              specs: specs || {},
            },
            nonce: nonce,
          });
        };

        PlannerBridge.prototype.sendCameraView = function (view) {
          if (!['top', 'front', 'perspective'].includes(view)) return;
          this._post({ type: 'SET_CAMERA_VIEW', view: view });
        };

        PlannerBridge.prototype.sendEditMode = function (mode) {
          if (!['view', 'edit', 'readonly'].includes(mode)) return;
          this._post({ type: 'SET_EDIT_MODE', mode: mode });
        };

        PlannerBridge.prototype.ping = function () {
          const nonce = generateNonce();
          trackNonce(nonce);
          this._post({ type: 'PING', nonce: nonce });
          return nonce;
        };

        // ── 수신 콜백 등록 ──
        PlannerBridge.prototype.onFloorplanChanged = function (handler) {
          this._handlers.floorplanChanged.push(handler);
          return this;
        };

        PlannerBridge.prototype.onModuleChanged = function (handler) {
          this._handlers.moduleChanged.push(handler);
          return this;
        };

        PlannerBridge.prototype.onReady = function (handler) {
          this._handlers.ready.push(handler);
          return this;
        };

        PlannerBridge.prototype.onError = function (handler) {
          this._handlers.error.push(handler);
          return this;
        };

        // ── 정리 ──
        PlannerBridge.prototype.destroy = function () {
          window.removeEventListener('message', this._messageListener);
          this._handlers = { floorplanChanged: [], moduleChanged: [], ready: [], error: [] };
          this.iframeWindow = null;
        };

        // ──────────────────────────────────────────────────────
        // Public API
        // ──────────────────────────────────────────────────────
        window.PlannerBridge = {
          create: function (itemUniqueId, iframeWindow) {
            return new PlannerBridge(itemUniqueId, iframeWindow);
          },
          // 헬퍼 — 외부에서 직접 검증이 필요할 때
          isFloorplan: isFloorplan,
          generateNonce: generateNonce,
          ALLOWED_ORIGIN: ALLOWED_ORIGIN,
        };
      })();
