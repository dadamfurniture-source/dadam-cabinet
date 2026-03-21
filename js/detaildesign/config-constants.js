      // ============================================================
      // 앱 설정 및 버전 정보
      // ============================================================
      const APP_CONFIG = {
        version: '33.0',
        versionName: 'Material Extractor V2',
        lastUpdate: '2026-01-16',
        features: ['싱크대', '붙박이장', '냉장고장', 'AI 어시스턴트', '자재추출 V2'],
      };

      // ============================================================
      // AI 에이전트 인터페이스
      // ============================================================
      const AIAgentInterface = {
        // 현재 설계 상태 가져오기
        getDesignState: () => ({
          selectedItems: selectedItems,
          currentStep: document.getElementById('step-dot-1').classList.contains('active') ? 1 : 2,
        }),

        // 아이템 추가
        addItem: (category, dimensions) => {
          const categoryData = CATEGORIES.find((c) => c.id === category);
          if (!categoryData) return { success: false, error: 'Invalid category' };

          const newItem = {
            uniqueId: Date.now(),
            category: category,
            name: categoryData.name,
            w: dimensions.w || 0,
            h: dimensions.h || 0,
            d: dimensions.d || categoryData.defaultD,
            specs: { ...DEFAULT_SPECS },
            modules: [],
          };
          selectedItems.push(newItem);
          return { success: true, item: newItem };
        },

        // 아이템 조회
        getItem: (itemId) => getItem(itemId),

        // 모듈 추가
        addModule: (itemId, moduleData) => {
          const item = getItem(itemId);
          if (!item) return { success: false, error: 'Item not found' };

          const newModule = {
            id: Date.now(),
            ...moduleData,
          };
          item.modules.push(newModule);
          return { success: true, module: newModule };
        },

        // 자동 계산 실행
        runAutoCalc: (itemId, section) => {
          const item = getItem(itemId);
          if (!item) return { success: false, error: 'Item not found' };

          // ★ categoryId 사용
          const category = item.categoryId || item.category;
          if (category === 'sink') {
            if (section === 'upper') runAutoCalcUpper(itemId);
            else if (section === 'lower') runAutoCalcLower(itemId);
          } else if (category === 'wardrobe') {
            runWardrobeAutoCalc(itemId);
          } else if (category === 'fridge') {
            autoCalculateFridge(itemId);
          }
          return { success: true };
        },

        // 스펙 업데이트
        updateSpec: (itemId, field, value) => {
          const item = updateItemSpec(itemId, field, value, false);
          return item ? { success: true } : { success: false, error: 'Item not found' };
        },

        // 설계 내보내기 (JSON)
        exportDesign: () => ({
          appVersion: APP_CONFIG.version,
          exportDate: new Date().toISOString(),
          items: selectedItems.map((item) => ({
            ...item,
            specs: { ...item.specs },
            modules: (item.modules || []).map((m) => ({ ...m })),
          })),
        }),

        // 설계 가져오기
        importDesign: (designData) => {
          try {
            if (designData.items) {
              selectedItems = designData.items;
              updateUI();
              return { success: true };
            }
            return { success: false, error: 'Invalid design data' };
          } catch (e) {
            return { success: false, error: e.message };
          }
        },
      };

      // 전역으로 노출 (AI 에이전트 접근용)
      window.DadamAgent = AIAgentInterface;

      // ============================================================
      // FurnitureOptionCatalog - Supabase 옵션 카탈로그
      // ============================================================
      const FurnitureOptionCatalog = {
        options: {},   // { door_color: [...], handle: [...], ... }
        loaded: false,

        // materials 테이블 카테고리 → 기존 카테고리 매핑
        _categoryMap: { 'door': 'door_color', 'door_finish': 'door_finish' },

        async load() {
          try {
            const client = typeof SupabaseUtils !== 'undefined' && SupabaseUtils.client;
            if (!client) { this._loadFallback(); return; }

            // materials 테이블에서 로드 (v3 동적 프롬프트)
            const { data, error } = await client
              .from('materials').select('*')
              .eq('is_active', true).order('sort_order');

            if (error) throw error;
            if (!data || data.length === 0) {
              // materials 테이블이 비어있으면 기존 furniture_options 시도
              const { data: foData, error: foError } = await client
                .from('furniture_options').select('*')
                .eq('is_active', true).order('sort_order');
              if (foError) throw foError;
              this._loadFromFurnitureOptions(foData || []);
              return;
            }

            this.options = {};
            for (const m of data) {
              // materials 카테고리를 기존 카테고리로 변환 (door → door_color)
              const cat = this._categoryMap[m.category] || m.category;
              if (!this.options[cat]) this.options[cat] = [];
              this.options[cat].push({
                name_ko: m.color_name,
                name_en: m.color_name_en || '',
                color_hex: m.color_hex || null,
                prompt_description: m.texture_prompt,
                texture_prompt: m.texture_prompt,
                applicable_to: m.applicable_to || [],
                texture_url: m.thumbnail_url || null,
                image_public_url: m.thumbnail_url || null,
                finish: m.finish || null,
              });
            }
            this.loaded = true;
            console.log('[Catalog] Loaded', data.length, 'materials from Supabase (v3)');
          } catch (e) {
            console.warn('[Catalog] Load failed, using hardcoded fallback:', e.message);
            this._loadFallback();
          }
        },

        _loadFromFurnitureOptions(data) {
          this.options = {};
          for (const opt of data) {
            if (!this.options[opt.category]) this.options[opt.category] = [];
            this.options[opt.category].push(opt);
          }
          this.loaded = true;
          console.log('[Catalog] Loaded', data.length, 'options from furniture_options (legacy)');
        },

        _loadFallback() {
          this.options = {
            door_color: [
              { name_ko: '화이트', name_en: 'white', color_hex: '#f5f5f5', prompt_description: 'pure white, smooth flat surface with zero wood grain, dead matte finish with no reflection, uniform solid color', texture_prompt: 'pure white, smooth flat surface with zero wood grain, dead matte finish with no reflection, uniform solid color', applicable_to: ['sink','wardrobe','fridge'], texture_url: null },
              { name_ko: '그레이', name_en: 'gray', color_hex: '#9e9e9e', prompt_description: 'neutral medium gray, smooth flat surface with zero wood grain, matte finish, uniform solid color', texture_prompt: 'neutral medium gray, smooth flat surface with zero wood grain, matte finish, uniform solid color without warm or cool cast', applicable_to: ['sink','wardrobe','fridge'], texture_url: null },
              { name_ko: '베이지', name_en: 'beige', color_hex: '#d4c4b0', prompt_description: 'warm beige with subtle sand undertone, smooth flat surface, soft matte finish', texture_prompt: 'warm beige with subtle sand undertone, smooth flat surface with zero wood grain, soft matte finish, uniform solid color', applicable_to: ['sink','wardrobe','fridge'], texture_url: null },
              { name_ko: '월넛', name_en: 'walnut', color_hex: '#5d4037', prompt_description: 'dark walnut wood grain laminate, realistic horizontal wood grain pattern, rich brown tones', texture_prompt: 'dark walnut wood grain laminate, realistic horizontal wood grain pattern, rich brown tones, matte natural wood finish', applicable_to: ['sink','wardrobe'], texture_url: null },
              { name_ko: '오크', name_en: 'oak', color_hex: '#c4a35a', prompt_description: 'natural light oak wood grain laminate, visible straight grain pattern, warm honey tones', texture_prompt: 'natural light oak wood grain laminate, visible straight grain pattern, warm honey tones, matte oiled wood finish', applicable_to: ['sink','wardrobe'], texture_url: null },
              { name_ko: '네이비', name_en: 'navy', color_hex: '#1a237e', prompt_description: 'deep navy blue, smooth flat surface with zero wood grain, dead matte finish', texture_prompt: 'deep navy blue, smooth flat surface with zero wood grain, dead matte finish with no reflection, rich saturated color', applicable_to: ['sink'], texture_url: null },
              { name_ko: '블랙', name_en: 'black', color_hex: '#2c2c2c', prompt_description: 'matte black, smooth flat surface with zero wood grain, dead matte finish', texture_prompt: 'matte black, smooth flat surface with zero wood grain, dead matte finish absorbing light, deep solid black', applicable_to: ['sink','wardrobe','fridge'], texture_url: null },
            ],
            door_finish: [
              { name_ko: '무광', name_en: 'matte', prompt_description: 'dead matte finish with zero reflection, smooth flat surface', texture_prompt: 'dead matte finish with zero reflection, smooth flat surface, no sheen under any lighting angle', applicable_to: ['sink','wardrobe','fridge'] },
              { name_ko: '유광', name_en: 'glossy', prompt_description: 'high-gloss mirror-like finish with sharp reflections', texture_prompt: 'high-gloss mirror-like finish with sharp reflections, smooth polished surface, visible light bounce', applicable_to: ['sink','wardrobe','fridge'] },
              { name_ko: '엠보', name_en: 'embossed', prompt_description: 'textured embossed surface with subtle tactile pattern', texture_prompt: 'textured embossed surface with subtle tactile pattern, low sheen satin finish, visible micro-texture under raking light', applicable_to: ['sink','wardrobe'] },
            ],
            handle: [
              { name_ko: '찬넬 (목찬넬)', name_en: 'channel', prompt_description: 'routed wooden channel handle at door top edge, 52mm front depth x 40mm underside grip, shadow gap underneath', texture_prompt: 'routed wooden channel handle at door top edge, 52mm front depth x 40mm underside grip, shadow gap underneath, same finish as door face', applicable_to: ['sink'] },
              { name_ko: 'C찬넬', name_en: 'c-channel', prompt_description: 'aluminum C-channel recessed handle, anodized silver finish, slim integrated profile', texture_prompt: 'aluminum C-channel recessed handle at door top edge, anodized silver finish, slim integrated profile creating shadow line', applicable_to: ['sink'] },
              { name_ko: '스마트바', name_en: 'smartbar', prompt_description: 'aluminum smart bar handle, slim rectangular cross-section, matte silver', texture_prompt: 'aluminum smart bar handle, slim rectangular cross-section, matte silver anodized finish, 128mm center-to-center mounting', applicable_to: ['sink','wardrobe'] },
              { name_ko: '푸쉬 도어', name_en: 'push-open', prompt_description: 'handleless push-to-open, completely flat door surface, no visible hardware', texture_prompt: 'handleless push-to-open mechanism, completely flat door surface, no visible hardware, 3mm shadow gap between doors', applicable_to: ['sink','wardrobe'] },
            ],
            sink: [
              { name_ko: '사각볼 850', name_en: 'square-850', prompt_description: 'stainless steel rectangular undermount sink bowl 850mm wide, brushed satin finish', texture_prompt: 'stainless steel rectangular undermount sink bowl 850mm wide, brushed satin finish, sharp square corners, single deep basin' },
              { name_ko: '사각볼 800', name_en: 'square-800', prompt_description: 'stainless steel rectangular undermount sink bowl 800mm wide, brushed satin finish', texture_prompt: 'stainless steel rectangular undermount sink bowl 800mm wide, brushed satin finish, sharp square corners, single deep basin' },
              { name_ko: '라운드볼', name_en: 'round', prompt_description: 'stainless steel round undermount sink bowl 480mm diameter, brushed satin finish', texture_prompt: 'stainless steel round undermount sink bowl 480mm diameter, brushed satin finish, smooth curved basin' },
            ],
            faucet: [
              { name_ko: '거위목 수전', name_en: 'gooseneck', prompt_description: 'tall gooseneck kitchen faucet, arched spout, single lever pull-down sprayer', texture_prompt: 'tall gooseneck kitchen faucet, arched spout, chrome or matte black finish, single lever pull-down sprayer' },
              { name_ko: 'ㄱ자 수전', name_en: 'l-shaped', prompt_description: 'L-shaped angular kitchen faucet, 90-degree bent spout, chrome finish', texture_prompt: 'L-shaped angular kitchen faucet, 90-degree bent spout, chrome finish, single lever control' },
              { name_ko: '일반 수전', name_en: 'standard', prompt_description: 'standard straight kitchen faucet, simple upright spout, chrome finish', texture_prompt: 'standard straight kitchen faucet, simple upright spout, chrome finish, single lever control' },
            ],
            hood: [
              { name_ko: '히든 후드', name_en: 'hidden', prompt_description: 'built-in concealed range hood hidden inside upper cabinet, NOT visible externally', texture_prompt: 'built-in concealed range hood hidden inside upper cabinet, NOT visible externally, cabinet door covers the hood completely' },
              { name_ko: '침니 후드', name_en: 'chimney', prompt_description: 'wall-mounted chimney range hood, stainless steel canopy with vertical duct cover', texture_prompt: 'wall-mounted chimney range hood, stainless steel canopy with vertical duct cover to ceiling, modern pyramid shape' },
              { name_ko: '슬라이딩 후드', name_en: 'sliding', prompt_description: 'slide-out range hood under upper cabinet, thin profile, pull-out visor panel', texture_prompt: 'slide-out range hood under upper cabinet, thin profile, pull-out visor panel, stainless steel or matching cabinet finish' },
            ],
            cooktop: [
              { name_ko: '인덕션', name_en: 'induction', prompt_description: 'flush-mount induction cooktop with smooth black ceramic glass surface', texture_prompt: 'flush-mount induction cooktop with smooth black ceramic glass surface, white printed zone markings, touch controls at front edge' },
              { name_ko: '가스쿡탑', name_en: 'gas', prompt_description: 'built-in gas cooktop with cast iron grates, stainless steel surface', texture_prompt: 'built-in gas cooktop with cast iron grates, stainless steel surface, 3 or 4 burners with metal knob controls' },
              { name_ko: '하이라이트', name_en: 'highlight', prompt_description: 'electric radiant highlight cooktop with smooth black ceramic glass surface', texture_prompt: 'electric radiant highlight cooktop with smooth black ceramic glass surface, glowing red heating zones, touch controls' },
            ],
            countertop: [
              { name_ko: '스노우', name_en: 'snow white', color_hex: '#FAFAFA', prompt_description: 'pure white engineered quartz countertop with subtle micro-flecks, polished surface', texture_prompt: 'pure white engineered quartz countertop with subtle micro-flecks, polished surface, clean bullnose edge profile, 20mm overhang', texture_url: null },
              { name_ko: '마블화이트', name_en: 'marble white', color_hex: '#F0F0F0', prompt_description: 'white marble-look engineered stone countertop with delicate grey veining', texture_prompt: 'white marble-look engineered stone countertop with delicate grey veining, polished surface, natural stone appearance, bullnose edge', texture_url: null },
              { name_ko: '그레이마블', name_en: 'gray marble', color_hex: '#B0B0B0', prompt_description: 'gray marble-look engineered stone countertop with dramatic veining', texture_prompt: 'gray marble-look engineered stone countertop with dramatic white and charcoal veining, polished surface, bullnose edge', texture_url: null },
              { name_ko: '차콜', name_en: 'charcoal', color_hex: '#404040', prompt_description: 'dark charcoal engineered stone countertop, matte honed finish', texture_prompt: 'dark charcoal engineered stone countertop, near-black with subtle aggregate texture, matte honed finish, bullnose edge', texture_url: null },
            ],
          };
          this.loaded = true;
        },

        getOptions(category, furnitureType) {
          const opts = this.options[category] || [];
          if (!furnitureType) return opts;
          return opts.filter(o => !o.applicable_to?.length || o.applicable_to.includes(furnitureType));
        },

        buildOptionsHtml(category, selectedValue, furnitureType) {
          return this.getOptions(category, furnitureType)
            .map(o => `<option value="${o.name_ko}" ${o.name_ko === selectedValue ? 'selected' : ''}>${o.name_ko}</option>`)
            .join('');
        },

        getPromptDescription(category, nameKo) {
          return (this.options[category] || []).find(o => o.name_ko === nameKo)?.prompt_description || nameKo;
        },

        getTexturePrompt(category, nameKo) {
          const opt = (this.options[category] || []).find(o => o.name_ko === nameKo);
          return opt?.texture_prompt || opt?.prompt_description || nameKo;
        },

        getImageUrl(category, nameKo) {
          return (this.options[category] || []).find(o => o.name_ko === nameKo)?.image_public_url || null;
        },

        getColorHex(category, nameKo) {
          return (this.options[category] || []).find(o => o.name_ko === nameKo)?.color_hex || null;
        },

        getTextureUrl(category, nameKo) {
          return (this.options[category] || []).find(o => o.name_ko === nameKo)?.texture_url || null;
        }
      };

      // 초기 폴백 로드 (Supabase 연결 전에도 렌더링 가능하도록)
      FurnitureOptionCatalog._loadFallback();

      // ============================================================
      // LayoutRenderer - 수치 기반 Canvas 레이아웃 렌더러 (v2: 텍스처 + 마스크)
      // mm 데이터 → 정규화 비율 → Canvas 픽셀 → base64 PNG
      // Stage 1: 프로그래밍 구조 렌더링 (텍스처 패턴 + 3D 패널 효과)
      // Stage 2: AI 인페인팅용 마스크 생성 (가구 표면 = 흰색, 나머지 = 검정)
      // ============================================================
      const LayoutRenderer = {
        _textureCache: {},   // { url: HTMLImageElement } - 로드된 텍스처 캐시
        _loadingPromises: {}, // 진행 중인 로드 방지

        // ─── 텍스처 이미지 프리로드 ───
        async _loadTexture(url) {
          if (!url) return null;
          if (this._textureCache[url]) return this._textureCache[url];
          if (this._loadingPromises[url]) return this._loadingPromises[url];

          this._loadingPromises[url] = new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              this._textureCache[url] = img;
              delete this._loadingPromises[url];
              resolve(img);
            };
            img.onerror = () => {
              delete this._loadingPromises[url];
              resolve(null); // 실패 시 null → 폴백 색상 사용
            };
            img.src = url;
          });
          return this._loadingPromises[url];
        },

        // ─── 모든 필요한 텍스처 프리로드 ───
        async _preloadTextures(specs) {
          const urls = [];
          const upperTex = FurnitureOptionCatalog.getTextureUrl('door_color', specs.doorColorUpper);
          const lowerTex = FurnitureOptionCatalog.getTextureUrl('door_color', specs.doorColorLower);
          const countertopTex = FurnitureOptionCatalog.getTextureUrl('countertop', specs.topColor);
          if (upperTex) urls.push(upperTex);
          if (lowerTex) urls.push(lowerTex);
          if (countertopTex) urls.push(countertopTex);
          await Promise.all(urls.map(u => this._loadTexture(u)));
          return { upperTex, lowerTex, countertopTex };
        },

        // ─── 수치 데이터 → 정규화 좌표 (0~1) 변환 ───
        computeLayout(cabinetSpecs, upperModules, lowerModules) {
          const totalW = cabinetSpecs.total_width_mm || 3600;
          const totalH = cabinetSpecs.total_height_mm || 2400;

          const moldingH = cabinetSpecs.molding_height || 60;
          const upperH = cabinetSpecs.upper_cabinet_height || 720;
          const lowerH = cabinetSpecs.lower_cabinet_height || 870;
          const toeKickH = cabinetSpecs.leg_height || 150;
          const countertopH = cabinetSpecs.countertop_thickness || 12;
          const backsplashH = totalH - moldingH - upperH - lowerH - toeKickH - countertopH;

          const ny = (mm) => mm / totalH;
          const nx = (mm) => mm / totalW;

          let y = 0;
          const layout = {
            aspectRatio: totalW / totalH,
            totalW_mm: totalW,
            totalH_mm: totalH,
            molding:     { y: y, h: ny(moldingH) },
            upper:       { y: (y += ny(moldingH)), h: ny(upperH), modules: [] },
            backsplash:  { y: (y += ny(upperH)), h: ny(Math.max(backsplashH, 0)) },
            countertop:  { y: (y += ny(Math.max(backsplashH, 0))), h: ny(countertopH) },
            lower:       { y: (y += ny(countertopH)), h: ny(lowerH), modules: [] },
            toeKick:     { y: (y += ny(lowerH)), h: ny(toeKickH) },
          };

          // 상부 모듈 정규화
          for (const m of (upperModules || [])) {
            layout.upper.modules.push({
              x: nx(m.position_from_left_mm || 0),
              w: nx(m.width_mm || parseInt(m.w) || 0),
              type: m.is_drawer ? 'drawer' : 'door',
              doorCount: m.door_count || 1,
              name: m.name || '',
            });
          }

          // 하부 모듈 정규화
          for (const m of (lowerModules || [])) {
            layout.lower.modules.push({
              x: nx(m.position_from_left_mm || 0),
              w: nx(m.width_mm || parseInt(m.w) || 0),
              type: m.is_drawer ? 'drawer' : 'door',
              doorCount: m.door_count || 1,
              hasSink: m.has_sink || false,
              hasCooktop: m.has_cooktop || false,
              name: m.name || '',
            });
          }

          return layout;
        },

        // ─── 메인 렌더링 (async: 텍스처 지원) ───
        // 동기 폴백: 텍스처 없이 즉시 렌더링 (기존 호환)
        render(cabinetSpecs, upperModules, lowerModules, specs) {
          return this._renderInternal(cabinetSpecs, upperModules, lowerModules, specs, {}, false);
        },

        // 비동기 텍스처 렌더링 (프리미엄 프리뷰용)
        async renderWithTextures(cabinetSpecs, upperModules, lowerModules, specs) {
          const texUrls = await this._preloadTextures(specs);
          return this._renderInternal(cabinetSpecs, upperModules, lowerModules, specs, texUrls, false);
        },

        // ─── 마스크 렌더링 (가구=흰색, 나머지=검정) ───
        renderMask(cabinetSpecs, upperModules, lowerModules, specs) {
          return this._renderInternal(cabinetSpecs, upperModules, lowerModules, specs, {}, true);
        },

        // ─── ControlNet 라인아트 렌더링 (흑백 구조선만) ───
        renderLineart(cabinetSpecs, upperModules, lowerModules, specs) {
          const layout = this.computeLayout(cabinetSpecs, upperModules, lowerModules);

          const canvasW = 1024;
          const canvasH = Math.round(canvasW / layout.aspectRatio);

          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d');

          const pxY = (n) => Math.round(n * canvasH);
          const pxX = (n) => Math.round(n * canvasW);

          // 흰색 배경
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvasW, canvasH);

          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 2.5;

          // ── 몰딩 외곽 ──
          const moldY = pxY(layout.molding.y), moldH = pxY(layout.molding.h);
          ctx.strokeRect(0, moldY, canvasW, moldH);

          // ── 상부장 모듈 ──
          const upperY = pxY(layout.upper.y);
          const upperH = pxY(layout.upper.h);
          if (layout.upper.modules.length > 0) {
            for (const mod of layout.upper.modules) {
              const x = pxX(mod.x), w = pxX(mod.w);
              // 캐비닛 외곽
              ctx.lineWidth = 2.5;
              ctx.strokeRect(x, upperY, w, upperH);
              // 도어 구분선
              ctx.lineWidth = 1.5;
              const doorCount = mod.doorCount || mod.doors || 1;
              if (doorCount > 1) {
                const dw = w / doorCount;
                for (let d = 1; d < doorCount; d++) {
                  ctx.beginPath();
                  ctx.moveTo(x + d * dw, upperY);
                  ctx.lineTo(x + d * dw, upperY + upperH);
                  ctx.stroke();
                }
              }
            }
          } else {
            ctx.lineWidth = 2.5;
            ctx.strokeRect(0, upperY, canvasW, upperH);
          }

          // ── 상판 ──
          const ctY = pxY(layout.countertop.y);
          const ctH = Math.max(pxY(layout.countertop.h), 4);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(0, ctY, canvasW, ctH);

          // ── 하부장 모듈 ──
          const lowerY = pxY(layout.lower.y);
          const lowerH = pxY(layout.lower.h);
          if (layout.lower.modules.length > 0) {
            for (const mod of layout.lower.modules) {
              const x = pxX(mod.x), w = pxX(mod.w);
              // 캐비닛 외곽
              ctx.lineWidth = 2.5;
              ctx.strokeRect(x, lowerY, w, lowerH);
              // 도어/서랍 구분선
              ctx.lineWidth = 1.5;
              if (mod.type === 'drawer') {
                // 서랍 수평 구분선
                const drawerCount = mod.drawerCount || 3;
                const dh = lowerH / drawerCount;
                for (let d = 1; d < drawerCount; d++) {
                  ctx.beginPath();
                  ctx.moveTo(x, lowerY + d * dh);
                  ctx.lineTo(x + w, lowerY + d * dh);
                  ctx.stroke();
                }
              } else {
                const doorCount = mod.doorCount || mod.doors || 1;
                if (doorCount > 1) {
                  const dw = w / doorCount;
                  for (let d = 1; d < doorCount; d++) {
                    ctx.beginPath();
                    ctx.moveTo(x + d * dw, lowerY);
                    ctx.lineTo(x + d * dw, lowerY + lowerH);
                    ctx.stroke();
                  }
                }
              }
            }
          } else {
            ctx.lineWidth = 2.5;
            ctx.strokeRect(0, lowerY, canvasW, lowerH);
          }

          // ── 토킥 ──
          const tkY = pxY(layout.toeKick.y);
          const tkH = pxY(layout.toeKick.h);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(0, tkY, canvasW, tkH);

          const dataUrl = canvas.toDataURL('image/png');
          return dataUrl.split(',')[1];
        },

        // ─── 내부 렌더링 엔진 ───
        _renderInternal(cabinetSpecs, upperModules, lowerModules, specs, texUrls, isMask) {
          const layout = this.computeLayout(cabinetSpecs, upperModules, lowerModules);

          const canvasW = 1024;
          const canvasH = Math.round(canvasW / layout.aspectRatio);

          const canvas = document.createElement('canvas');
          canvas.width = canvasW;
          canvas.height = canvasH;
          const ctx = canvas.getContext('2d');

          // 픽셀 변환 헬퍼
          const pxY = (n) => Math.round(n * canvasH);
          const pxX = (n) => Math.round(n * canvasW);

          if (isMask) {
            // 마스크 모드: 배경 검정
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvasW, canvasH);
          } else {
            ctx.clearRect(0, 0, canvasW, canvasH);
          }

          // 카탈로그에서 색상 가져오기
          const upperColor = FurnitureOptionCatalog.getColorHex('door_color', specs.doorColorUpper) || '#f5f5f5';
          const lowerColor = FurnitureOptionCatalog.getColorHex('door_color', specs.doorColorLower) || '#f5f5f5';
          const countertopColor = FurnitureOptionCatalog.getColorHex('countertop', specs.topColor) || '#FAFAFA';

          // 텍스처 패턴 생성 헬퍼
          const getPattern = (texUrl, fallbackColor) => {
            if (isMask) return '#ffffff';
            const img = texUrl ? this._textureCache[texUrl] : null;
            if (img) {
              try { return ctx.createPattern(img, 'repeat') || fallbackColor; }
              catch (e) { return fallbackColor; }
            }
            return fallbackColor;
          };

          const upperFill = getPattern(texUrls.upperTex, upperColor);
          const lowerFill = getPattern(texUrls.lowerTex, lowerColor);
          const countertopFill = getPattern(texUrls.countertopTex, countertopColor);

          // ═══ 몰딩 ═══
          const moldY = pxY(layout.molding.y), moldH = pxY(layout.molding.h);
          if (isMask) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, moldY, canvasW, moldH);
          } else {
            // 몰딩 그라디언트 (약간 입체감)
            const moldGrad = ctx.createLinearGradient(0, moldY, 0, moldY + moldH);
            moldGrad.addColorStop(0, '#e0e0e0');
            moldGrad.addColorStop(0.5, '#c8c8c8');
            moldGrad.addColorStop(1, '#b8b8b8');
            ctx.fillStyle = moldGrad;
            ctx.fillRect(0, moldY, canvasW, moldH);
            this._drawBorder(ctx, 0, moldY, canvasW, moldH);
          }

          // ═══ 상부장 모듈 ═══
          const upperY = pxY(layout.upper.y);
          const upperH = pxY(layout.upper.h);
          if (layout.upper.modules.length > 0) {
            for (const mod of layout.upper.modules) {
              const x = pxX(mod.x), w = pxX(mod.w);
              if (isMask) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x, upperY, w, upperH);
              } else {
                ctx.fillStyle = upperFill;
                ctx.fillRect(x, upperY, w, upperH);
                this._drawPanelEffect(ctx, x, upperY, w, upperH, upperColor);
                this._drawDoorLines(ctx, mod, x, upperY, w, upperH);
                // 도어별 손잡이
                this._drawHandles(ctx, mod, x, upperY, w, upperH, specs.handle);
              }
            }
          } else {
            ctx.fillStyle = isMask ? '#ffffff' : upperFill;
            ctx.fillRect(0, upperY, canvasW, upperH);
            if (!isMask) this._drawPanelEffect(ctx, 0, upperY, canvasW, upperH, upperColor);
          }

          // ═══ 백스플래시 (벽면 노출) ═══
          const bsY = pxY(layout.backsplash.y);
          const bsH = pxY(layout.backsplash.h);
          if (bsH > 0 && !isMask) {
            // 타일 패턴 (격자 느낌)
            ctx.fillStyle = 'rgba(240, 240, 240, 0.5)';
            ctx.fillRect(0, bsY, canvasW, bsH);
            ctx.strokeStyle = 'rgba(220, 220, 220, 0.6)';
            ctx.lineWidth = 0.5;
            const tileSize = 24;
            for (let tx = 0; tx < canvasW; tx += tileSize) {
              ctx.beginPath(); ctx.moveTo(tx, bsY); ctx.lineTo(tx, bsY + bsH); ctx.stroke();
            }
            for (let ty = bsY; ty < bsY + bsH; ty += tileSize) {
              ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(canvasW, ty); ctx.stroke();
            }
          }
          // 마스크: 백스플래시는 검정 (벽이므로 인페인트 불필요)

          // ═══ 상판 ═══
          const ctY = pxY(layout.countertop.y);
          const ctH = Math.max(pxY(layout.countertop.h), 4);
          if (isMask) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, ctY, canvasW, ctH);
          } else {
            ctx.fillStyle = countertopFill;
            ctx.fillRect(0, ctY, canvasW, ctH);
            // 상판 엣지 하이라이트
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(0, ctY, canvasW, 1);
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(0, ctY + ctH - 1, canvasW, 1);
            ctx.strokeStyle = '#999';
            ctx.lineWidth = 1;
            ctx.strokeRect(0, ctY, canvasW, ctH);
          }

          // ═══ 하부장 모듈 ═══
          const lowerY = pxY(layout.lower.y);
          const lowerH = pxY(layout.lower.h);
          if (layout.lower.modules.length > 0) {
            for (const mod of layout.lower.modules) {
              const x = pxX(mod.x), w = pxX(mod.w);

              if (isMask) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(x, lowerY, w, lowerH);
              } else {
                ctx.fillStyle = lowerFill;
                ctx.fillRect(x, lowerY, w, lowerH);
                this._drawPanelEffect(ctx, x, lowerY, w, lowerH, lowerColor);

                if (mod.type === 'drawer') {
                  this._drawDrawerLines(ctx, x, lowerY, w, lowerH, specs.handle);
                } else {
                  this._drawDoorLines(ctx, mod, x, lowerY, w, lowerH);
                  this._drawHandles(ctx, mod, x, lowerY, w, lowerH, specs.handle);
                }
              }

              // 싱크볼 (마스크에서는 흰색)
              if (mod.hasSink) {
                if (isMask) {
                  // 싱크도 가구 표면 영역으로 포함
                } else {
                  this._drawSink(ctx, mod, x, w, ctY, lowerH, specs);
                }
              }

              // 쿡탑 (마스크에서는 흰색)
              if (mod.hasCooktop) {
                if (isMask) {
                  // 쿡탑도 가구 표면 영역으로 포함
                } else {
                  this._drawCooktop(ctx, mod, x, w, ctY, lowerH, specs);
                }
              }
            }
          } else {
            ctx.fillStyle = isMask ? '#ffffff' : lowerFill;
            ctx.fillRect(0, lowerY, canvasW, lowerH);
            if (!isMask) this._drawPanelEffect(ctx, 0, lowerY, canvasW, lowerH, lowerColor);
          }

          // ═══ 토킥 ═══
          const tkY = pxY(layout.toeKick.y);
          const tkH = pxY(layout.toeKick.h);
          if (isMask) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, tkY, canvasW, tkH);
          } else {
            const tkGrad = ctx.createLinearGradient(0, tkY, 0, tkY + tkH);
            tkGrad.addColorStop(0, '#333');
            tkGrad.addColorStop(1, '#1a1a1a');
            ctx.fillStyle = tkGrad;
            ctx.fillRect(0, tkY, canvasW, tkH);
          }

          // ═══ 치수 라벨 (마스크에는 표시 안함) ═══
          if (!isMask) {
            this._drawDimensionLabels(ctx, layout, canvasW, canvasH);
          }

          const dataUrl = canvas.toDataURL('image/png');
          return dataUrl.split(',')[1];
        },

        // ─── 3D 패널 효과 (베벨 + 그림자) ───
        _drawPanelEffect(ctx, x, y, w, h, baseColor) {
          // 인셋 패딩 (도어 패널 느낌)
          const pad = 3;
          // 상단 하이라이트
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(x + pad, y + pad, w - pad * 2, 2);
          // 좌측 하이라이트
          ctx.fillRect(x + pad, y + pad, 2, h - pad * 2);
          // 하단 그림자
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(x + pad, y + h - pad - 2, w - pad * 2, 2);
          // 우측 그림자
          ctx.fillRect(x + w - pad - 2, y + pad, 2, h - pad * 2);
          // 테두리
          this._drawBorder(ctx, x, y, w, h);
        },

        // ─── 손잡이 렌더링 ───
        _drawHandles(ctx, mod, x, y, w, h, handleType) {
          const count = mod.doorCount || 1;
          const doorW = w / count;
          const handleH = Math.min(h * 0.12, 40);
          const handleW = 3;

          for (let i = 0; i < count; i++) {
            const doorX = x + doorW * i;
            let hx, hy;

            if (handleType === '푸쉬 도어' || handleType === 'push-open') {
              continue; // 핸들리스
            }

            if (handleType === '스마트바' || handleType === 'smartbar') {
              // 상단 가로 바
              const barW = doorW * 0.6;
              hx = doorX + (doorW - barW) / 2;
              hy = y + 6;
              ctx.fillStyle = '#aaa';
              ctx.fillRect(hx, hy, barW, 3);
              ctx.fillStyle = 'rgba(255,255,255,0.3)';
              ctx.fillRect(hx, hy, barW, 1);
              continue;
            }

            // 기본 세로 핸들 (찬넬 / C찬넬)
            // 도어 중앙부에 세로 핸들
            if (count > 1) {
              // 2도어: 중앙 경계 부근
              hx = (i === 0) ? doorX + doorW - 12 : doorX + 8;
            } else {
              hx = doorX + doorW / 2;
            }
            hy = y + (h - handleH) / 2;

            // 그림자
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(hx + 1, hy + 1, handleW, handleH);
            // 핸들 본체
            const hGrad = ctx.createLinearGradient(hx, hy, hx + handleW, hy);
            hGrad.addColorStop(0, '#c0c0c0');
            hGrad.addColorStop(0.5, '#e8e8e8');
            hGrad.addColorStop(1, '#a0a0a0');
            ctx.fillStyle = hGrad;
            ctx.fillRect(hx, hy, handleW, handleH);
          }
        },

        // ─── 싱크볼 (개선) ───
        _drawSink(ctx, mod, modX, modW, countertopY, lowerH, specs) {
          const sw = modW * 0.65, sh = lowerH * 0.09;
          const sx = modX + (modW - sw) / 2;
          const sy = countertopY - sh - 1;

          // 싱크 본체 (스테인리스 그라디언트)
          const sGrad = ctx.createLinearGradient(sx, sy, sx, sy + sh);
          sGrad.addColorStop(0, '#c8cdd2');
          sGrad.addColorStop(0.3, '#b8bfc6');
          sGrad.addColorStop(0.7, '#a8b0b8');
          sGrad.addColorStop(1, '#98a0a8');
          ctx.fillStyle = sGrad;
          this._roundRect(ctx, sx, sy, sw, sh, 4);
          ctx.fill();

          // 싱크 내부 홈
          const innerPad = 4;
          ctx.fillStyle = 'rgba(0,0,0,0.08)';
          this._roundRect(ctx, sx + innerPad, sy + innerPad, sw - innerPad * 2, sh - innerPad * 2, 2);
          ctx.fill();

          // 배수구
          const drainX = sx + sw / 2, drainY = sy + sh * 0.6;
          ctx.beginPath();
          ctx.arc(drainX, drainY, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#707880';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(drainX, drainY, 2, 0, Math.PI * 2);
          ctx.fillStyle = '#505860';
          ctx.fill();

          // 테두리
          ctx.strokeStyle = '#8890a0';
          ctx.lineWidth = 1;
          this._roundRect(ctx, sx, sy, sw, sh, 4);
          ctx.stroke();

          // 수전 (거위목 스타일)
          const faucetX = modX + modW / 2;
          const faucetBaseY = sy - 2;

          // 수전 베이스
          ctx.fillStyle = '#b0b0b0';
          ctx.fillRect(faucetX - 4, faucetBaseY - 4, 8, 6);

          // 수전 기둥
          const fGrad = ctx.createLinearGradient(faucetX - 3, 0, faucetX + 3, 0);
          fGrad.addColorStop(0, '#a0a0a0');
          fGrad.addColorStop(0.5, '#d0d0d0');
          fGrad.addColorStop(1, '#909090');
          ctx.fillStyle = fGrad;
          ctx.fillRect(faucetX - 2, faucetBaseY - 18, 4, 16);

          // 수전 목 (곡선)
          ctx.strokeStyle = '#b8b8b8';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(faucetX, faucetBaseY - 18);
          ctx.quadraticCurveTo(faucetX + 12, faucetBaseY - 22, faucetX + 10, faucetBaseY - 12);
          ctx.stroke();

          // 수전 하이라이트
          ctx.strokeStyle = 'rgba(255,255,255,0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(faucetX - 1, faucetBaseY - 16);
          ctx.lineTo(faucetX - 1, faucetBaseY - 4);
          ctx.stroke();
        },

        // ─── 쿡탑 (개선) ───
        _drawCooktop(ctx, mod, modX, modW, countertopY, lowerH, specs) {
          const cw = modW * 0.65, ch = lowerH * 0.07;
          const cx = modX + (modW - cw) / 2;
          const cy = countertopY - ch - 1;

          // 쿡탑 글래스 표면
          const cGrad = ctx.createLinearGradient(cx, cy, cx, cy + ch);
          cGrad.addColorStop(0, '#1a1a1a');
          cGrad.addColorStop(0.5, '#2a2a2a');
          cGrad.addColorStop(1, '#111');
          ctx.fillStyle = cGrad;
          this._roundRect(ctx, cx, cy, cw, ch, 4);
          ctx.fill();

          // 글래스 반사
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          this._roundRect(ctx, cx + 2, cy + 1, cw - 4, ch / 2, 3);
          ctx.fill();

          // 버너 원형 4개 (동심원)
          const spacing = cw / 5;
          const burnerR = ch * 0.32;
          for (let i = 1; i <= 4; i++) {
            const bx = cx + spacing * i, by = cy + ch / 2;
            // 외부 링
            ctx.strokeStyle = 'rgba(100,100,100,0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(bx, by, burnerR, 0, Math.PI * 2);
            ctx.stroke();
            // 내부 링
            ctx.strokeStyle = 'rgba(80,80,80,0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(bx, by, burnerR * 0.55, 0, Math.PI * 2);
            ctx.stroke();
            // 중앙 점
            ctx.beginPath();
            ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(60,60,60,0.8)';
            ctx.fill();
          }

          // 테두리
          ctx.strokeStyle = 'rgba(60,60,60,0.5)';
          ctx.lineWidth = 1;
          this._roundRect(ctx, cx, cy, cw, ch, 4);
          ctx.stroke();
        },

        // ─── 헬퍼: 테두리 ───
        _drawBorder(ctx, x, y, w, h) {
          ctx.strokeStyle = 'rgba(0,0,0,0.2)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        },

        // ─── 헬퍼: 도어 분할선 ───
        _drawDoorLines(ctx, mod, x, y, w, h) {
          const count = mod.doorCount || 1;
          if (count <= 1) return;
          const doorW = w / count;
          for (let i = 1; i < count; i++) {
            const lx = x + doorW * i;
            // 그림자 (오른쪽)
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(lx + 1, y + 2);
            ctx.lineTo(lx + 1, y + h - 2);
            ctx.stroke();
            // 주 분할선
            ctx.strokeStyle = 'rgba(0,0,0,0.25)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lx + 0.5, y);
            ctx.lineTo(lx + 0.5, y + h);
            ctx.stroke();
            // 하이라이트 (왼쪽)
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lx - 0.5, y + 2);
            ctx.lineTo(lx - 0.5, y + h - 2);
            ctx.stroke();
          }
        },

        // ─── 헬퍼: 서랍 수평선 ───
        _drawDrawerLines(ctx, x, y, w, h, handleType) {
          const drawerCount = Math.max(Math.round(h / 60), 2);
          const dh = h / drawerCount;
          for (let i = 1; i < drawerCount; i++) {
            const ly = y + dh * i;
            // 그림자
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x + 4, ly + 1);
            ctx.lineTo(x + w - 4, ly + 1);
            ctx.stroke();
            // 주 분할선
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 4, ly + 0.5);
            ctx.lineTo(x + w - 4, ly + 0.5);
            ctx.stroke();
            // 하이라이트
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 4, ly - 0.5);
            ctx.lineTo(x + w - 4, ly - 0.5);
            ctx.stroke();
          }

          // 서랍 손잡이 (각 서랍 중앙)
          if (handleType === '푸쉬 도어' || handleType === 'push-open') return;
          for (let i = 0; i < drawerCount; i++) {
            const dy = y + dh * i;
            const centerX = x + w / 2;
            const centerY = dy + dh / 2;

            if (handleType === '스마트바' || handleType === 'smartbar') {
              // 가로 스마트바
              const barW = w * 0.4;
              ctx.fillStyle = '#aaa';
              ctx.fillRect(centerX - barW / 2, centerY - 1.5, barW, 3);
              ctx.fillStyle = 'rgba(255,255,255,0.3)';
              ctx.fillRect(centerX - barW / 2, centerY - 1.5, barW, 1);
            } else {
              // 기본 가로 핸들
              const barW = Math.min(w * 0.25, 60);
              const hGrad = ctx.createLinearGradient(0, centerY - 1.5, 0, centerY + 1.5);
              hGrad.addColorStop(0, '#d0d0d0');
              hGrad.addColorStop(1, '#a0a0a0');
              ctx.fillStyle = hGrad;
              ctx.fillRect(centerX - barW / 2, centerY - 1.5, barW, 3);
            }
          }
        },

        // ─── 헬퍼: 둥근 사각형 ───
        _roundRect(ctx, x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + r);
          ctx.lineTo(x + w, y + h - r);
          ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          ctx.lineTo(x + r, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - r);
          ctx.lineTo(x, y + r);
          ctx.quadraticCurveTo(x, y, x + r, y);
          ctx.closePath();
        },

        // ─── 헬퍼: 치수 라벨 ───
        _drawDimensionLabels(ctx, layout, canvasW, canvasH) {
          ctx.font = '11px Arial';
          ctx.fillStyle = '#e74c3c';
          ctx.textAlign = 'left';
          const lx = canvasW - 80;

          const labels = [
            { name: 'molding', text: Math.round(layout.totalH_mm * layout.molding.h) + '' },
            { name: 'upper', text: Math.round(layout.totalH_mm * layout.upper.h) + '' },
            { name: 'countertop', text: Math.round(layout.totalH_mm * layout.countertop.h) + '' },
            { name: 'lower', text: Math.round(layout.totalH_mm * layout.lower.h) + '' },
            { name: 'toeKick', text: Math.round(layout.totalH_mm * layout.toeKick.h) + '' },
          ];

          for (const l of labels) {
            const sec = layout[l.name];
            const midY = Math.round((sec.y + sec.h / 2) * canvasH);
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(lx - 4, midY - 8, 78, 16);
            ctx.fillStyle = '#fff';
            ctx.fillText(l.text + 'mm', lx, midY + 4);
          }

          // 전체 너비 라벨 (하단)
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(canvasW / 2 - 40, canvasH - 20, 80, 18);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(layout.totalW_mm + 'mm', canvasW / 2, canvasH - 6);
        },

        // ─── 정규화 레이아웃 데이터 JSON ───
        getLayoutData(cabinetSpecs, upperModules, lowerModules) {
          return this.computeLayout(cabinetSpecs, upperModules, lowerModules);
        }
      };

