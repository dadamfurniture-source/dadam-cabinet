      // ============================================================
      // 디버그 로깅 (localhost/127.0.0.1에서만 활성)
      // ============================================================
      const DEBUG =
        typeof location !== 'undefined' &&
        (location.hostname === 'localhost' ||
          location.hostname === '127.0.0.1' ||
          location.search.includes('debug=1'));
      const dlog = (...args) => { if (DEBUG) console.log(...args); };
      const dwarn = (...args) => { if (DEBUG) console.warn(...args); };

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
            specs: deepClone(DEFAULT_SPECS),
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
            dlog('[Catalog] Loaded', data.length, 'materials from Supabase (v3)');
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
          dlog('[Catalog] Loaded', data.length, 'options from furniture_options (legacy)');
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


