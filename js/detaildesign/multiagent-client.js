      // ============================================================
      // MultiagentAPI — dadam_multiagent FastAPI 백엔드 클라이언트
      // ============================================================

      const CATEGORY_MAP = {
        sink: 'sink',
        island: 'island',
        wardrobe: 'closet',
        fridge: 'fridge_cabinet',
        homecafe: 'utility_closet',
      };

      const MultiagentAPI = {
        get BASE_URL() {
          return (window.DADAM_CONFIG?.multiagent?.apiUrl || '').replace(/\/$/, '');
        },

        get enabled() {
          return !!this.BASE_URL;
        },

        _getToken() {
          return typeof SupabaseUtils !== 'undefined'
            ? SupabaseUtils.client?.auth?.getSession?.()
                ?.then(r => r?.data?.session?.access_token)
            : Promise.resolve(null);
        },

        async _headers() {
          const token = await this._getToken();
          const h = { Accept: 'application/json' };
          if (token) h['Authorization'] = `Bearer ${token}`;
          return h;
        },

        mapCategory(localCat) {
          return CATEGORY_MAP[localCat] || localCat;
        },

        // ── 프로젝트 생성 (이미지 업로드) ──
        async createProject(imageFile, category, style, budget) {
          const fd = new FormData();
          fd.append('image', imageFile);
          fd.append('category', this.mapCategory(category));
          if (style) fd.append('style', style);
          if (budget) fd.append('budget', String(budget));

          const headers = await this._headers();
          delete headers['Accept']; // FormData sets its own content-type

          const resp = await fetch(`${this.BASE_URL}/projects`, {
            method: 'POST',
            headers,
            body: fd,
          });

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `프로젝트 생성 실패 (${resp.status})`);
          }
          return resp.json();
        },

        // ── 파이프라인 실행 시작 ──
        async runPipeline(projectId) {
          const headers = await this._headers();
          const resp = await fetch(`${this.BASE_URL}/projects/${projectId}/run`, {
            method: 'POST',
            headers,
          });

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `파이프라인 시작 실패 (${resp.status})`);
          }
          return resp.json();
        },

        // ── SSE 스트리밍 (진행 상황 모니터링) ──
        streamProgress(projectId, { onStage, onError, onComplete }) {
          return this._getToken().then(token => {
            const url = `${this.BASE_URL}/projects/${projectId}/stream?token=${encodeURIComponent(token || '')}`;
            const es = new EventSource(url);

            es.onmessage = (evt) => {
              try {
                const data = JSON.parse(evt.data);
                if (data.type === 'status') {
                  if (data.stage === 'completed') {
                    es.close();
                    if (onComplete) onComplete();
                  } else {
                    if (onStage) onStage(data.stage);
                  }
                } else if (data.type === 'error') {
                  es.close();
                  if (onError) onError(data.error);
                }
              } catch (e) {
                console.warn('SSE parse error:', e);
              }
            };

            es.onerror = () => {
              es.close();
              if (onError) onError('SSE 연결이 끊어졌습니다.');
            };

            return es; // 호출자가 es.close() 가능
          });
        },

        // ── 프로젝트 결과 조회 ──
        async getProject(projectId) {
          const headers = await this._headers();
          const resp = await fetch(`${this.BASE_URL}/projects/${projectId}`, { headers });

          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || `프로젝트 조회 실패 (${resp.status})`);
          }
          return resp.json();
        },

        // ── 전체 파이프라인 실행 (생성 + 실행 + 스트리밍 + 결과) ──
        async runFullPipeline(imageFile, category, style, budget, callbacks = {}) {
          const { onStage, onError, onComplete } = callbacks;
          const stageLabels = {
            started: '시작 중...',
            space_analysis: '벽면 분석 중...',
            design: '모듈 배치 계산 중...',
            image_gen: '가구 이미지 생성 중...',
            quote: '견적 계산 중...',
            completed: '완료!',
          };

          try {
            // 1. 프로젝트 생성
            if (onStage) onStage('uploading', '사진 업로드 중...');
            const createResult = await this.createProject(imageFile, category, style, budget);
            const projectId = createResult.data.project_id;

            // 2. 파이프라인 시작
            if (onStage) onStage('started', '파이프라인 시작 중...');
            await this.runPipeline(projectId);

            // 3. SSE 스트리밍
            await new Promise((resolve, reject) => {
              this.streamProgress(projectId, {
                onStage: (stage) => {
                  if (onStage) onStage(stage, stageLabels[stage] || stage);
                },
                onError: (err) => {
                  if (onError) onError(err);
                  reject(new Error(err));
                },
                onComplete: () => resolve(),
              });
            });

            // 4. 결과 조회
            if (onStage) onStage('fetching', '결과 불러오는 중...');
            const result = await this.getProject(projectId);

            if (onComplete) onComplete(result.data);
            return result.data;
          } catch (err) {
            if (onError) onError(err.message);
            throw err;
          }
        },
      };
