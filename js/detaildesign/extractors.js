      // ============================================================
      // 자재 추출 클래스 (Material Extractor) V2.0
      // SKILL: material-extractor-v2.md 기반
      // ============================================================
      class MaterialExtractor {
        constructor(config = {}) {
          this.PANEL_W = 1220;
          this.PANEL_H = 2440;
          this.T = config.thickness || 15; // 몸통 두께 (PB 15T 기본)
        }

        // ========================================
        // 메인 추출 함수
        // ========================================
        extract(designData) {
          const materials = [];
          const items = designData.items || [];

          // ★ 같은 카테고리 아이템 카운트 (싱크대 2개 등)
          const categoryCounts = {};
          const categoryTotals = {};
          items.forEach(item => {
            const cat = item.categoryId || item.category;
            categoryTotals[cat] = (categoryTotals[cat] || 0) + 1;
          });

          console.log('[MaterialExtractor] 추출 시작, 아이템 수:', items.length, 'categoryTotals:', JSON.stringify(categoryTotals));

          items.forEach((item) => {
            // ★ categoryId 사용 (category가 아님!)
            const category = item.categoryId || item.category;
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            // ★ 같은 카테고리 2개 이상이면 #1, #2 접두사 부여
            const prefix = categoryTotals[category] > 1 ? `#${categoryCounts[category]} ` : '';
            // ★ 품목 라벨 (아이템 구분용)
            const catNames = { sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장' };
            const itemLabel = item.labelName || `${prefix}${catNames[category] || category}`;
            const mods = item.modules || [];
            console.log(`[BOM-TRACE] === 아이템 처리: ${itemLabel} ===`);
            console.log(`[BOM-TRACE]   모듈 수: ${mods.length}`);
            console.log(`[BOM-TRACE]   상부장: ${mods.filter(m=>m.pos==='upper').length}개, 하부장: ${mods.filter(m=>m.pos==='lower').length}개`);
            console.log(`[BOM-TRACE]   모듈 상세:`, mods.map(m => `${m.pos}/${m.type}/${m.name}(${m.w})`));
            const beforeLen = materials.length;

            switch (category) {
              case 'sink':
                this.extractSink(item, materials, prefix);
                break;
              case 'wardrobe':
                this.extractWardrobe(item, materials, prefix);
                break;
              case 'fridge':
                this.extractFridge(item, materials, prefix);
                break;
            }
            // ★ 새로 추가된 자재에 품목 라벨 태깅
            for (let i = beforeLen; i < materials.length; i++) {
              materials[i].itemLabel = itemLabel;
            }
            console.log(`[BOM-TRACE]   → 추출된 자재: ${materials.length - beforeLen}개 (누적 ${materials.length}개)`);
          });

          console.log('[MaterialExtractor] 추출 완료, 자재 수:', materials.length, '전체 모듈 목록:', materials.map(m => m.module).filter((v,i,a) => a.indexOf(v)===i));

          return {
            materials,
            summary: this.calculateSummary(materials),
            extractDate: new Date().toISOString(),
          };
        }

        // ========================================
        // 자재 추가 헬퍼
        // ========================================
        add(arr, module, part, material, thickness, w, h, qty, edge, note = '') {
          arr.push({
            module,
            part,
            material,
            thickness,
            w: Math.round(w),
            h: Math.round(h),
            qty,
            edge,
            note,
          });
        }

        // ========================================
        // 싱크대 자재 추출
        // ========================================
        extractSink(item, materials, prefix = '') {
          const specs = item.specs || {};
          const T = this.T;
          const defaultUpperD = 295; // 상부장 기본 깊이
          const defaultLowerD = 550; // 하부장 기본 깊이
          const isWoodChannel = (specs.handle || '').includes('목찬넬');
          const legH = specs.sinkLegHeight || 150;

          // ===== 상부장 모듈 =====
          const upperModules = (item.modules || []).filter((m) => m.pos === 'upper' && m.type !== 'hood');
          console.log('[Sink] 상부장 모듈:', upperModules.length);

          upperModules.forEach((mod, idx) => {
            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 600;
            const H = parseFloat(mod.h) || specs.upperH || 720;
            const modD = parseFloat(mod.d) || defaultUpperD;
            const name = mod.name || `${W}/${mod.doorCount || 1}도어`;
            const modLabel = `${prefix}상부장-${name}`;

            // 측판 2개 (사쿠리홈)
            this.add(materials, modLabel, '측판', 'PB', T, modD, H, 2, '3면', 'sakuri(15→3mm)');
            // 천판 (사쿠리 반영 D-18)
            this.add(materials, modLabel, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
            // 지판 (사쿠리 반영 D-18)
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
            // 뒷판 (사쿠리홈에 끼움 W-20)
            this.add(materials, modLabel, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
            // 밴드(보강목) 2개
            this.add(materials, modLabel, '밴드(보강목)', 'PB', T, W - T * 2, 70, 2, '2면(장)');
            // 밴드(처짐방지목) - W>=700이면 2개
            const bandQty = W >= 700 ? 2 : 1;
            this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, 70, H - T * 2, bandQty, '2면(장)');
            // 선반 2개 (사쿠리 반영 D-34)
            this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - 34, 2, '1면(전)');
            // 도어 (H + overlap)
            const doorCount = mod.doorCount || 1;
            if (doorCount > 0) {
              const overlap = parseFloat(specs.upperDoorOverlap) || 15;
              const doorW = Math.floor(W / doorCount) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, H + overlap, doorCount, '4면');
            }
          });

          // ===== 하부장 모듈 =====
          const lowerModules = (item.modules || []).filter((m) => m.pos === 'lower' && m.type !== 'cook');
          console.log('[Sink] 하부장 모듈:', lowerModules.length);

          lowerModules.forEach((mod, idx) => {
            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 600;
            const topT = parseFloat(specs.topThickness) || 12;
            const H = parseFloat(mod.h) || (specs.lowerH || 870) - topT - legH;
            const modD = parseFloat(mod.d) || defaultLowerD;
            const name = mod.name || `${W}/${mod.doorCount || 1}도어`;
            const modLabel = `${prefix}하부장-${name}`;
            const isDrawer = mod.isDrawer || false;
            const isEL = mod.isEL || false;
            const isOpen = mod.isOpen || false;

            // 측판 2개 (하부장: 사쿠리 없음)
            this.add(materials, modLabel, '측판', 'PB', T, modD, H, 2, '3면');
            // 지판 (하부장: 사쿠리 없음, D 그대로)
            this.add(materials, modLabel, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
            // 밴드 2개
            this.add(materials, modLabel, '밴드', 'PB', T, 70, W - T * 2, 2, '2면(장)');
            // 뒷판 (하부장: 사쿠리 없음)
            this.add(materials, modLabel, '뒷판', 'MDF', 2.7, W - T * 2, H - T, 1, '-');
            // 밴드(처짐방지목) - 목찬넬이면 -70, W>=800이면 2개
            const bandH = isWoodChannel ? H - T * 2 - 70 : H - T * 2;
            const bandQty = W >= 800 ? 2 : 1;
            this.add(materials, modLabel, '밴드(처짐방지)', 'PB', T, 70, bandH, bandQty, '2면(장)');
            // 선반 (서랍/EL/오픈장 없으면 1개, 하부장: 사쿠리 없음)
            if (!isDrawer && !isEL && !isOpen && mod.type !== 'sink') {
              this.add(materials, modLabel, '선반', 'PB', T, W - T * 2, modD - T, 1, '1면(전)');
            }
            // 도어 (H - 30)
            const doorCount = mod.doorCount || 0;
            if (isDrawer) {
              // ★ 서랍장: 서랍 + 여닫이 도어 + 목찬넬
              const drawerCount = mod.drawerCount || 1;
              const drawerH = 220; // 서랍 1개 높이
              const totalDrawerH = drawerH * drawerCount;
              const hingeDoorH = H - totalDrawerH - 30;

              // 서랍 자재
              const drawerFBW = W - 30 - 42;
              this.add(materials, modLabel, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
              this.add(materials, modLabel, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
              this.add(materials, modLabel, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
              if (drawerFBW > 600) {
                this.add(materials, modLabel, '서랍 하단보강', 'PB', T, 440, 60, drawerCount, '2면(장)');
              }

              // 서랍 도어 (각 서랍 전면) — 1개일 때 250mm 기본
              const drawerDoorW = W - 4;
              const drawerDoorH = drawerCount === 1 ? 250 : Math.floor((totalDrawerH - 20) / drawerCount);
              this.add(materials, modLabel, '서랍도어', 'MDF', 18, drawerDoorW, drawerDoorH, drawerCount, '4면');

              // 여닫이 도어 (서랍 아래)
              if (hingeDoorH > 50) {
                const hingeDoorCount = Math.max(1, Math.round(W / 450));
                const hingeDoorW = Math.floor(W / hingeDoorCount) - 4;
                this.add(materials, modLabel, '도어', 'MDF', 18, hingeDoorW, hingeDoorH, hingeDoorCount, '4면');
              }

              // 목찬넬 (120 × W) — 서랍장 1개당 1개
              this.add(materials, modLabel, '목찬넬', 'MDF', 18, 120, W, 1, '2면(장)');
            } else if (doorCount > 0) {
              const doorW = Math.floor(W / doorCount) - 4;
              this.add(materials, modLabel, '도어', 'MDF', 18, doorW, H - 30, doorCount, '4면');
            }
          });

          // ===== EP (마감재) =====
          const epLabel = `${prefix}EP`;
          const totalLowerW = lowerModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          const totalUpperW = upperModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
          const effectiveW = totalLowerW || item.w - 120;
          const moldingH = parseFloat(specs.moldingH) || 60;
          const lowerH = (specs.lowerH || 870) - legH;
          const totalH = parseFloat(item.h) || 2400;

          // 상몰딩 (moldingH >= 20이면 산출)
          if (moldingH >= 20 && (totalUpperW || effectiveW) > 0) {
            const moldingW = totalUpperW || effectiveW;
            const moldingEdge = moldingW > 2000 ? '2면(장)' : '4면';
            this.add(materials, epLabel, '상몰딩', 'MDF', 18, moldingH, moldingW, 1, moldingEdge);
          }

          // 걸레받이
          this.add(materials, epLabel, '걸레받이', 'MDF', 18, effectiveW, legH - 5, 1, '2면(장)');

          // 목찬넬
          if (isWoodChannel) {
            this.add(materials, epLabel, '목찬넬(전면)', 'MDF', 18, 52, effectiveW, 1, '2면(장)');
            this.add(materials, epLabel, '목찬넬(지면)', 'MDF', 18, 40, effectiveW, 1, '2면(장)');
          }

          // 좌측 마감 (몰딩/휠라/EP)
          if (specs.finishLeftType !== 'None' && specs.finishLeftWidth > 0) {
            const finishName = specs.finishLeftType === 'Filler' ? '휠라(좌)' : specs.finishLeftType === 'EP' ? 'EP(좌)' : '몰딩(좌)';
            this.add(materials, epLabel, finishName, 'MDF', 18, specs.finishLeftWidth, totalH - legH, 1, '4면');
          }
          // 우측 마감 (몰딩/휠라/EP)
          if (specs.finishRightType !== 'None' && specs.finishRightWidth > 0) {
            const finishName = specs.finishRightType === 'Filler' ? '휠라(우)' : specs.finishRightType === 'EP' ? 'EP(우)' : '몰딩(우)';
            this.add(materials, epLabel, finishName, 'MDF', 18, specs.finishRightWidth, totalH - legH, 1, '4면');
          }
        }

        // ========================================
        // 붙박이장 자재 추출
        // ========================================
        extractWardrobe(item, materials, prefix = '') {
          const specs = item.specs || {};
          const T = this.T;
          const D = parseFloat(item.d) || 600;
          const pedestalH = parseFloat(specs.wardrobePedestal) || 60;
          const moldingH = parseFloat(specs.wardrobeMoldingH) || 15;
          const totalH = parseFloat(item.h) || 2300;
          const bodyH = totalH - pedestalH - moldingH;

          console.log('[Wardrobe] ===== 붙박이장 자재 추출 시작 =====');
          console.log('[Wardrobe] item: w=%s, h=%s, d=%s, bodyH=%s', item.w, item.h, item.d, bodyH);

          // ★ 붙박이장 모듈만 필터 (pos=wardrobe)
          const modules = (item.modules || []).filter(m => m.pos === 'wardrobe');

          console.log('[Wardrobe] 모듈 수:', modules.length);

          if (modules.length === 0) {
            console.warn('[Wardrobe] ⚠️ 모듈이 없습니다!');
            return;
          }

          let totalW = 0;

          modules.forEach((mod, idx) => {
            const modType = mod.moduleType || 'long';
            const isDivided = modType === 'short' || modType === 'shelf';
            const rawName = mod.name || `${idx + 1}번`;
            const name = `${prefix}${rawName}`;

            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 900;
            const modD = parseFloat(mod.d) || D;
            const drawerCount = mod.drawerCount || 0;
            const isExternalDrawer = mod.isExternalDrawer || false;
            const doorCount = mod.doorCount || Math.max(1, Math.round(W / 450));

            totalW += W;

            if (isDivided) {
              // ===== 상하분리형 (short/shelf): 상부장·하부장 각각 독립 캐비닛 =====
              const DRAWER_MOD_H = 350;
              const externalDrawerH = (isExternalDrawer && drawerCount > 0) ? drawerCount * DRAWER_MOD_H : 0;
              const availableH = bodyH - externalDrawerH;
              const upperH = parseFloat(mod.upperH) || Math.floor(availableH / 2);
              const lowerH = parseFloat(mod.lowerH) || Math.floor(availableH / 2);

              console.log(`[Wardrobe] 모듈 ${name}: type=${modType}, W=${W}, upperH=${upperH}, lowerH=${lowerH}, D=${modD}, doors=${doorCount}, extDrawerH=${externalDrawerH}`);

              // --- 상부장 ---
              this.add(materials, `${name}-상부장`, '측판', 'PB', T, modD, upperH, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${name}-상부장`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}-상부장`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}-상부장`, '뒷판', 'MDF', 2.7, W - 20, upperH - 1, 1, '-');
              const shelfUpper = mod.shelfCountUpper || 0;
              if (shelfUpper > 0) {
                this.add(materials, `${name}-상부장`, '선반', 'PB', T, W - T * 2, modD - 18 - 70, shelfUpper, '1면(전)');
              }

              // --- 하부장 ---
              this.add(materials, `${name}-하부장`, '측판', 'PB', T, modD, lowerH, 2, '3면');
              this.add(materials, `${name}-하부장`, '천판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.add(materials, `${name}-하부장`, '지판', 'PB', T, W - T * 2, modD, 1, '1면(전)');
              this.add(materials, `${name}-하부장`, '뒷판', 'MDF', 2.7, W - T * 2, lowerH - T, 1, '-');
              const shelfLower = mod.shelfCountLower || 0;
              if (shelfLower > 0) {
                this.add(materials, `${name}-하부장`, '선반', 'PB', T, W - T * 2, modD - T, shelfLower, '1면(전)');
              }

              // 서랍
              if (drawerCount > 0) {
                const drawerFBW = isExternalDrawer ? W - 30 - 42 : W - 30 - 42 - 120;
                if (isExternalDrawer) {
                  // 외부 서랍 모듈 본체 (별도 제작)
                  const drawerModH = drawerCount * DRAWER_MOD_H;
                  this.add(materials, `${name}-서랍모듈`, '측판', 'PB', T, modD, drawerModH, 2, '3면', 'sakuri(15→3mm)');
                  this.add(materials, `${name}-서랍모듈`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '뒷판', 'MDF', 2.7, W - 20, drawerModH - 1, 1, '-');
                  this.add(materials, `${name}-서랍모듈`, '밴드', 'PB', T, W - T * 2, 70, 2, '2면(장)');
                  // 외부 서랍 자재
                  this.add(materials, `${name}-서랍모듈`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                } else {
                  // 내부 서랍 자재 (전후판 -120 추가)
                  this.add(materials, `${name}`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                  // 내부 서랍모듈 프레임 (모듈 기준 엣지)
                  this.add(materials, `${name}`, '내부서랍 상판', 'PB', T, W - 30, 520, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 측판', 'PB', T, 350, 500, 2, '3면');
                  this.add(materials, `${name}`, '내부서랍 지판', 'PB', T, W - 30 - 120, 500, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 밴드', 'PB', T, W - 30 - 120, 70, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 좌우몰딩', 'PB', T, 350, 60, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 전면판', 'PB', T, W - 30 - 120 - 6, 298, 1, '4면');
                }
                // 서랍 전후판 가로 600 초과 시 하단 보강재
                const bogangModule = isExternalDrawer ? `${name}-서랍모듈` : `${name}`;
                if (drawerFBW > 600) {
                  this.add(materials, bogangModule, '서랍 하단보강', 'PB', T, 440, 60, drawerCount, '2면(장)');
                }
              }

              // 도어 (좌대+bodyH-20 통일 — 짧은옷/긴옷 모두 동일 높이)
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                const doorH = pedestalH + bodyH - 20;
                if (isExternalDrawer && drawerCount > 0) {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH - drawerCount * DRAWER_MOD_H, doorCount, '4면');
                  // 외부 서랍 도어 (목찬넬, 서랍수별 높이)
                  const drawerDoorW = W - 4;
                  const drawerModTotal = drawerCount * DRAWER_MOD_H + pedestalH;
                  let drawerDoorH, drawerDoorQty;
                  if (drawerCount === 1) {
                    drawerDoorH = drawerModTotal - 30 - 20;
                    drawerDoorQty = 1;
                  } else if (drawerCount === 2) {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30) / 2);
                    drawerDoorQty = 2;
                  } else {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30) / 3);
                    drawerDoorQty = 3;
                  }
                  this.add(materials, `${name}-서랍모듈`, '서랍도어', 'MDF', 18, drawerDoorW, drawerDoorH, drawerDoorQty, '4면');
                } else {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH, doorCount, '4면');
                }
              }

            } else {
              // ===== 긴옷(long): 단일 캐비닛 =====
              const DRAWER_MOD_H_LONG = 350;
              const externalDrawerH = (isExternalDrawer && drawerCount > 0) ? drawerCount * DRAWER_MOD_H_LONG : 0;
              const modH = (parseFloat(mod.h) || bodyH) - externalDrawerH;

              console.log(`[Wardrobe] 모듈 ${name}: type=${modType}, W=${W}, H=${modH}, D=${modD}, doors=${doorCount}, extDrawerH=${externalDrawerH}`);

              this.add(materials, `${name}`, '측판', 'PB', T, modD, modH, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${name}`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
              this.add(materials, `${name}`, '뒷판', 'MDF', 2.7, W - 20, modH - 1, 1, '-');

              const shelfCount = mod.shelfCount || 1;
              if (shelfCount > 0) {
                this.add(materials, `${name}`, '선반', 'PB', T, W - T * 2, modD - 18 - 70, shelfCount, '1면(전)');
              }
              if (drawerCount > 0) {
                const drawerFBW = isExternalDrawer ? W - 30 - 42 : W - 30 - 42 - 120;
                if (isExternalDrawer) {
                  // 외부 서랍 모듈 본체 (별도 제작)
                  const drawerModH = drawerCount * DRAWER_MOD_H_LONG;
                  this.add(materials, `${name}-서랍모듈`, '측판', 'PB', T, modD, drawerModH, 2, '3면', 'sakuri(15→3mm)');
                  this.add(materials, `${name}-서랍모듈`, '천판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '지판', 'PB', T, W - T * 2, modD - 18, 1, '1면(전)');
                  this.add(materials, `${name}-서랍모듈`, '뒷판', 'MDF', 2.7, W - 20, drawerModH - 1, 1, '-');
                  this.add(materials, `${name}-서랍모듈`, '밴드', 'PB', T, W - T * 2, 70, 2, '2면(장)');
                  // 외부 서랍 자재
                  this.add(materials, `${name}-서랍모듈`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}-서랍모듈`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                } else {
                  // 내부 서랍 자재 (전후판 -120 추가)
                  this.add(materials, `${name}`, '서랍전후판', 'PB', T, drawerFBW, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍측판', 'PB', T, 440, 180, drawerCount * 2, '1면(장)');
                  this.add(materials, `${name}`, '서랍밑판', 'MDF', 2.7, W - 30 - 13, 449, drawerCount, '-');
                  // 내부 서랍모듈 프레임 (모듈 기준 엣지)
                  this.add(materials, `${name}`, '내부서랍 상판', 'PB', T, W - 30, 520, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 측판', 'PB', T, 350, 500, 2, '3면');
                  this.add(materials, `${name}`, '내부서랍 지판', 'PB', T, W - 30 - 120, 500, 1, '1면(전)');
                  this.add(materials, `${name}`, '내부서랍 밴드', 'PB', T, W - 30 - 120, 70, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 좌우몰딩', 'PB', T, 350, 60, 2, '2면(장)');
                  this.add(materials, `${name}`, '내부서랍 전면판', 'PB', T, W - 30 - 120 - 6, 298, 1, '4면');
                }
                // 서랍 전후판 가로 600 초과 시 하단 보강재
                const bogangModule = isExternalDrawer ? `${name}-서랍모듈` : `${name}`;
                if (drawerFBW > 600) {
                  this.add(materials, bogangModule, '서랍 하단보강', 'PB', T, 440, 60, drawerCount, '2면(장)');
                }
              }

              // 도어 (좌대+bodyH-20 통일 — 짧은옷/긴옷 모두 동일 높이)
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                const doorH = pedestalH + bodyH - 20;
                if (isExternalDrawer && drawerCount > 0) {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH - drawerCount * DRAWER_MOD_H_LONG, doorCount, '4면');
                  // 외부 서랍 도어 (목찬넬, 서랍수별 높이)
                  const drawerDoorW = W - 4;
                  const drawerModTotal = drawerCount * DRAWER_MOD_H_LONG + pedestalH;
                  let drawerDoorH, drawerDoorQty;
                  if (drawerCount === 1) {
                    drawerDoorH = drawerModTotal - 30 - 20;
                    drawerDoorQty = 1;
                  } else if (drawerCount === 2) {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30) / 2);
                    drawerDoorQty = 2;
                  } else {
                    drawerDoorH = Math.floor((drawerModTotal - 20 - 30 - 30) / 3);
                    drawerDoorQty = 3;
                  }
                  this.add(materials, `${name}-서랍모듈`, '서랍도어', 'MDF', 18, drawerDoorW, drawerDoorH, drawerDoorQty, '4면');
                } else {
                  this.add(materials, `${name}`, '도어', 'MDF', 18, doorW, doorH, doorCount, '4면');
                }
              }
            }
          });

          console.log('[Wardrobe] 모듈 합계 너비:', totalW);

          // ===== EP (마감재) =====
          const finishLeftType = specs.finishLeftType || 'Molding';
          const finishLeftW = parseFloat(specs.finishLeftWidth) || 60;
          const finishRightType = specs.finishRightType || 'Molding';
          const finishRightW = parseFloat(specs.finishRightWidth) || 60;

          // 몰딩 EP 세로 고정 2440, 초과 시 2장
          const EP_H = 2440;
          const epQty = (len) => len > EP_H ? 2 : 1;

          // 상몰딩 (60 이상만 산출, 미만은 무몰딩)
          if (moldingH >= 60 && totalW > 0) {
            this.add(materials, 'EP', '상몰딩', 'MDF', 18, moldingH, EP_H, epQty(totalW), '2면(장)');
          }

          // 좌측 몰딩
          if (finishLeftType !== 'None' && finishLeftW > 0) {
            this.add(materials, 'EP', '좌측몰딩', 'MDF', 18, finishLeftW, EP_H, epQty(bodyH), '2면(장)');
            if (finishLeftW >= 20) {
              this.add(materials, 'EP', '좌측몰딩 덧대', 'MDF', 18, 30, EP_H, epQty(bodyH), '2면(장)');
            }
          }

          // 우측 몰딩
          if (finishRightType !== 'None' && finishRightW > 0) {
            this.add(materials, 'EP', '우측몰딩', 'MDF', 18, finishRightW, EP_H, epQty(bodyH), '2면(장)');
            if (finishRightW >= 20) {
              this.add(materials, 'EP', '우측몰딩 덧대', 'MDF', 18, 30, EP_H, epQty(bodyH), '2면(장)');
            }
          }

          // 좌대 EP (전면 걸레받이)
          if (pedestalH > 0 && totalW > 0) {
            this.add(materials, 'EP', '좌대 걸레받이', 'MDF', 18, pedestalH, EP_H, epQty(totalW), '2면(장)');
          }

          // 외부 서랍 목찬넬 EP
          modules.forEach((mod, idx) => {
            const drawerCount = mod.drawerCount || 0;
            const isExternalDrawer = mod.isExternalDrawer || false;
            if (!isExternalDrawer || drawerCount <= 0) return;
            const modW = parseFloat(mod.w) || 900;
            if (drawerCount === 1) {
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 100, modW, 1, '2면(장)');
            } else if (drawerCount === 2) {
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 120, modW, 1, '2면(장)');
            } else if (drawerCount >= 3) {
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 100, modW, 1, '2면(장)');
              this.add(materials, 'EP', '목찬넬', 'MDF', 18, 120, modW, 1, '2면(장)');
            }
          });

          // 좌대 (모듈별 본체)
          if (pedestalH > 0) {
            modules.forEach((mod, idx) => {
              const modW = parseFloat(mod.w) || 900;
              const modD = parseFloat(mod.d) || D;
              const pName = `${prefix}${mod.name || `${idx + 1}번`}`;
              this.add(materials, `${pName}-좌대`, '좌대 전후', 'PB', T, modW - 30, pedestalH, 2, '1면(전)');
              this.add(materials, `${pName}-좌대`, '좌대 측', 'PB', T, modD - 35, pedestalH, 2, '1면(전)');
              if (modW >= 700) {
                this.add(materials, `${pName}-좌대`, '좌대 중간보강', 'PB', T, modD - 35 - 30, pedestalH, 1, '1면(전)');
              }
            });
          }

          console.log('[Wardrobe] ===== 추출 완료, 자재 수:', materials.length, '=====');
        }

        // ========================================
        // 냉장고장 자재 추출
        // ========================================
        extractFridge(item, materials, prefix = '') {
          const specs = item.specs || {};
          const T = this.T;
          const modules = item.modules || [];

          console.log('[Fridge] 모듈:', modules.length);

          if (modules.length === 0) return;

          modules.forEach((mod, idx) => {
            const modType = mod.type || '';
            if (modType === 'fridge') return; // 냉장고 자체는 제외

            // ★ 모듈 치수가 BOM의 근거
            const W = parseFloat(mod.w) || 600;
            const H = parseFloat(mod.h) || 2000;
            const D = parseFloat(mod.d) || specs.fridgeModuleD || 550;
            const name = mod.name || modType;

            console.log(`[Fridge] 모듈: ${modType}, W=${W}, H=${H}, D=${D}`);

            // 키큰장 (tall) — PB 구조
            const pf = prefix; // 같은 카테고리 복수 아이템 구분용
            if (modType === 'tall') {
              this.add(materials, `${pf}키큰장`, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${pf}키큰장`, '천판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}키큰장`, '지판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}키큰장`, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
              this.add(materials, `${pf}키큰장`, '선반', 'PB', T, W - T * 2, D - 34, 3, '1면(전)');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}키큰장`, '도어', 'MDF', 18, doorW, H + 20, doorCount, '4면');
              }
            }
            // 홈카페장 (homecafe) - 오픈장 규칙: MDF 18T 전체
            else if (modType === 'homecafe') {
              this.add(materials, `${pf}홈카페장`, '측판', 'MDF', 18, D + 20, H, 2, '3면');
              this.add(materials, `${pf}홈카페장`, '천판', 'MDF', 18, W - 36, D, 1, '2면(가로)');
              this.add(materials, `${pf}홈카페장`, '지판', 'MDF', 18, W - 36, D, 1, '2면(가로)');
              this.add(materials, `${pf}홈카페장`, '뒷판', 'MDF', 18, W - 36, H, 1, '2면(가로)'); // 18T!
              this.add(materials, `${pf}홈카페장`, '선반', 'MDF', 18, W - 36, D - 15, 2, '1면(전)');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}홈카페장`, '도어', 'MDF', 18, doorW, H + 20, doorCount, '4면');
              }
            }
            // 상부장 (upper) — PB 구조
            else if (modType === 'upper') {
              this.add(materials, `${pf}냉장고상부장`, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${pf}냉장고상부장`, '천판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}냉장고상부장`, '지판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}냉장고상부장`, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}냉장고상부장`, '도어', 'MDF', 18, doorW, H + 20, doorCount, '4면');
              }
            }
            // 하부장 (lower) — PB 구조
            else if (modType === 'lower') {
              this.add(materials, `${pf}냉장고하부장`, '측판', 'PB', T, D, H, 2, '3면');
              this.add(materials, `${pf}냉장고하부장`, '천판', 'PB', T, W - T * 2, D, 1, '1면(전)');
              this.add(materials, `${pf}냉장고하부장`, '지판', 'PB', T, W - T * 2, D, 1, '1면(전)');
              this.add(materials, `${pf}냉장고하부장`, '뒷판', 'MDF', 2.7, W - T * 2, H - T, 1, '-');
              const doorCount = mod.doorCount || 1;
              if (doorCount > 0) {
                const doorW = Math.floor(W / doorCount) - 4;
                this.add(materials, `${pf}냉장고하부장`, '도어', 'MDF', 18, doorW, H - 30, doorCount, '4면');
              }
            }
            // EL장 (el) — PB 구조 (뒷판만)
            else if (modType === 'el') {
              this.add(materials, `${pf}EL장`, '측판', 'PB', T, D, H, 2, '3면', 'sakuri(15→3mm)');
              this.add(materials, `${pf}EL장`, '천판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}EL장`, '지판', 'PB', T, W - T * 2, D - 18, 1, '1면(전)');
              this.add(materials, `${pf}EL장`, '뒷판', 'MDF', 2.7, W - 20, H - 1, 1, '-');
            }
          });
        }

        // ========================================
        // 요약 계산
        // ========================================
        calculateSummary(materials) {
          const summary = {};
          materials.forEach((m) => {
            const key = `${m.material}_${m.thickness}`;
            if (!summary[key]) {
              summary[key] = { material: m.material, thickness: m.thickness, totalArea: 0, panelCount: 0 };
            }
            summary[key].totalArea += m.w * m.h * m.qty;
          });

          const panelArea = this.PANEL_W * this.PANEL_H;
          Object.values(summary).forEach((s) => {
            s.panelCount = Math.ceil(s.totalArea / panelArea);
          });

          return summary;
        }

        // ========================================
        // CSV 출력
        // ========================================
        toCSV(materials) {
          let csv = '모듈,부품,자재,두께,가로,세로,수량,엣지,비고\n';
          materials.forEach((m) => {
            csv += `${m.module},${m.part},${m.material},${m.thickness},${m.w},${m.h},${m.qty},${m.edge},${m.note || ''}\n`;
          });
          return csv;
        }

        // ========================================
        // CNC 출력
        // ========================================
        toCNC(materials) {
          let csv = '품목,자재,두께,가로,세로,수량,엣지L,엣지R,엣지T,엣지B\n';
          materials.forEach((m) => {
            let el = 0,
              er = 0,
              et = 0,
              eb = 0;
            if (m.edge === '4면') {
              el = er = et = eb = 1;
            } else if (m.edge.includes('2면')) {
              if (m.w > m.h) {
                el = er = 1;
              } else {
                et = eb = 1;
              }
            } else if (m.edge.includes('1면')) {
              el = 1;
            }
            csv += `${m.part},${m.material},${m.thickness},${m.w},${m.h},${m.qty},${el},${er},${et},${eb}\n`;
          });
          return csv;
        }
      }

      // ============================================================
      // 부자재 추출 클래스 (Hardware Extractor) v1.0
      // ============================================================
      class HardwareExtractor {
        constructor() {
          this.hingeRules = { 900: 2, 1600: 3, 9999: 4 }; // 높이별 경첩 수
        }

        extract(designData) {
          const hardware = [];
          const items = designData.items || [];

          // 품목 라벨 생성 (MaterialExtractor와 동일 로직)
          const catNames = { sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장' };
          const categoryTotals = {};
          const categoryCounts = {};
          items.forEach(item => {
            const cat = item.categoryId || item.category;
            categoryTotals[cat] = (categoryTotals[cat] || 0) + 1;
          });

          items.forEach((item) => {
            const category = item.categoryId || item.category;
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
            const prefix = categoryTotals[category] > 1 ? `#${categoryCounts[category]} ` : '';
            const itemLabel = item.labelName || `${prefix}${catNames[category] || category}`;
            const beforeLen = hardware.length;

            this.extractHinges(item, hardware);
            this.extractRails(item, hardware);
            this.extractHandles(item, hardware);
            this.extractLegs(item, hardware);
            this.extractBrackets(item, hardware);
            this.extractOthers(item, hardware);

            // 새로 추가된 부자재에 품목 라벨 태깅
            for (let i = beforeLen; i < hardware.length; i++) {
              hardware[i].itemLabel = itemLabel;
            }
          });

          return {
            hardware,
            summary: this.calculateSummary(hardware),
            extractDate: new Date().toISOString(),
          };
        }

        // 경첩 수 계산
        getHingeCount(doorH) {
          if (doorH <= 900) return 2;
          if (doorH <= 1600) return 3;
          return 4;
        }

        // 보링 위치 계산
        getBoringPositions(doorH) {
          const count = this.getHingeCount(doorH);
          if (count === 2) return [110, doorH - 110];
          if (count === 3) return [110, Math.round(doorH / 2), doorH - 110];
          return [110, Math.round(doorH / 3), Math.round((doorH * 2) / 3), doorH - 110];
        }

        // 경첩 추출
        extractHinges(item, hardware) {
          const specs = item.specs || {};
          (item.modules || []).forEach((mod) => {
            const doorCount = mod.doorCount || 0;
            if (doorCount === 0) return;

            let doorH;
            const upperOverlap = parseFloat(specs.upperDoorOverlap) || 15;
            if (mod.pos === 'upper') doorH = (mod.h || specs.upperH - upperOverlap) + upperOverlap;
            else if (mod.pos === 'lower') doorH = (mod.h || (specs.lowerH || 870) - (parseFloat(specs.topThickness) || 12) - (parseFloat(specs.sinkLegHeight) || 150)) - 30;
            else doorH = mod.h || 700;

            const hingesPerDoor = this.getHingeCount(doorH);
            const boring = this.getBoringPositions(doorH);

            hardware.push({
              category: '경첩',
              item: '문주 110도 약압 경첩',
              manufacturer: '문주',
              spec: `${hingesPerDoor}구`,
              qty: hingesPerDoor * doorCount,
              unit: 'EA',
              note: `${mod.name || mod.type} (보링: ${boring.join(', ')})`,
            });
          });
        }

        // 레일 추출
        extractRails(item, hardware) {
          const category = item.categoryId || item.category;

          // 붙박이장: 모듈별 drawerCount 기준
          if (category === 'wardrobe') {
            (item.modules || []).forEach((mod) => {
              const drawerCount = mod.drawerCount || 0;
              if (drawerCount <= 0) return;
              hardware.push({
                category: '레일',
                item: '문주 언더레일',
                manufacturer: '문주',
                spec: '450mm',
                qty: drawerCount,
                unit: 'SET',
                note: mod.name || mod.type,
              });
            });
            return;
          }

          // 기타 카테고리
          (item.modules || []).forEach((mod) => {
            if (!mod.isDrawer) return;
            const depth = mod.d || 550;
            let railLength = 500;
            if (depth <= 350) railLength = 350;
            else if (depth <= 450) railLength = 450;

            hardware.push({
              category: '레일',
              item: '소프트클로즈 서랍레일',
              manufacturer: '블룸',
              spec: `${railLength}mm`,
              qty: 1,
              unit: 'SET',
              note: mod.name || mod.type,
            });
          });
        }

        // 손잡이 추출
        extractHandles(item, hardware) {
          const specs = item.specs || {};
          const category = item.categoryId || item.category;
          let totalDoors = 0;

          (item.modules || []).forEach((mod) => {
            totalDoors += mod.doorCount || 0;
          });

          if (totalDoors === 0) return;

          // 붙박이장: handleType (push/smartbar/round)
          if (category === 'wardrobe') {
            const ht = specs.handleType || 'push';
            const nameMap = { push: '푸쉬', smartbar: '스마트바', round: '라운드' };
            // 푸쉬: 도어당 1EA, 스마트바: 모듈당 1EA, 라운드: 모듈당 1EA
            const totalModules = (item.modules || []).length;
            const qty = ht === 'push' ? totalDoors : totalModules;
            hardware.push({
              category: '손잡이',
              item: nameMap[ht] || ht,
              manufacturer: '-',
              spec: ht === 'smartbar' ? '30mm' : '-',
              qty: qty,
              unit: 'EA',
              note: item.category,
            });
          } else {
            // 기타 카테고리
            const handleType = specs.handle || '찬넬';
            hardware.push({
              category: '손잡이',
              item: handleType.includes('스마트바')
                ? '스마트바'
                : handleType.includes('목찬넬')
                  ? '목찬넬'
                  : handleType,
              manufacturer: '-',
              spec: '-',
              qty: handleType.includes('스마트바') ? (item.modules || []).length : totalDoors,
              unit: 'EA',
              note: item.category,
            });
          }
        }

        // 다리발 추출
        extractLegs(item, hardware) {
          const category = item.categoryId || item.category;
          if (category !== 'sink') return;
          const specs = item.specs || {};
          const legH = specs.sinkLegHeight || 150;
          let totalLegs = 0;

          (item.modules || [])
            .filter((m) => m.pos === 'lower')
            .forEach((mod) => {
              const w = mod.w || 600;
              if (w <= 600) totalLegs += 4;
              else if (w <= 900) totalLegs += 6;
              else totalLegs += 8;
            });

          if (totalLegs > 0) {
            hardware.push({
              category: '다리발',
              item: '조절 다리발',
              manufacturer: '-',
              spec: `${legH}mm`,
              qty: totalLegs,
              unit: 'EA',
              note: '하부장',
            });
          }
        }

        // 선반 브라켓 추출
        extractBrackets(item, hardware) {
          let shelfCount = 0;
          (item.modules || []).forEach((mod) => {
            if (mod.pos === 'upper' && mod.type !== 'hood') shelfCount += 2;
            else if (mod.pos === 'lower' && !mod.isDrawer && mod.type !== 'sink' && mod.type !== 'cook')
              shelfCount += 1;
          });

          if (shelfCount > 0) {
            hardware.push({
              category: '브라켓',
              item: '선반 브라켓 (핀타입)',
              manufacturer: '-',
              spec: 'Φ5mm',
              qty: shelfCount * 4,
              unit: 'EA',
              note: `선반 ${shelfCount}개 × 4`,
            });
          }
        }

        // 기타 부자재
        extractOthers(item, hardware) {
          // 도어 댐퍼 미사용 (사내 규정)
        }

        // 요약
        calculateSummary(hardware) {
          const summary = {};
          hardware.forEach((h) => {
            if (!summary[h.category]) summary[h.category] = 0;
            summary[h.category] += h.qty;
          });
          return summary;
        }

        // CSV 생성
        toCSV(hardware) {
          let csv = '분류,품목,제조사,스펙,수량,단위,비고\n';
          hardware.forEach((h) => {
            csv += `${h.category},${h.item},${h.manufacturer},${h.spec},${h.qty},${h.unit},${h.note}\n`;
          });
          return csv;
        }
      }

      // ============================================================
      // 도면 시각화 클래스 (Drawing Visualizer) v1.0
      // ============================================================
      class DrawingVisualizer {
        constructor() {
          this.PANEL_W = 1220;
          this.PANEL_H = 2440;
          this.KERF = 4;
        }

        // 재단 도면 생성
        generateCuttingLayout(materials, mode = 'material') {
          const groups = this.groupByMaterial(materials);
          const panels = {};

          Object.keys(groups).forEach((key) => {
            panels[key] = this.packParts(groups[key], mode);
          });

          return panels;
        }

        // 자재별 그룹화
        groupByMaterial(materials) {
          const groups = {};
          materials.forEach((m) => {
            const key = `${m.material}_${m.thickness}T`;
            if (!groups[key]) groups[key] = [];
            for (let i = 0; i < m.qty; i++) {
              groups[key].push({ ...m, qty: 1 });
            }
          });
          return groups;
        }

        // Bin Packing
        packParts(parts, mode) {
          const sorted = [...parts].sort((a, b) => b.w * b.h - a.w * a.h);
          const panels = [];
          let panelId = 1;

          sorted.forEach((part) => {
            let placed = false;
            for (const panel of panels) {
              if (this.tryPlace(panel, part)) {
                placed = true;
                break;
              }
            }
            if (!placed) {
              const newPanel = this.createPanel(panelId++);
              this.tryPlace(newPanel, part);
              panels.push(newPanel);
            }
          });

          return panels;
        }

        createPanel(id) {
          return {
            id,
            w: this.PANEL_W,
            h: this.PANEL_H,
            parts: [],
            freeRects: [{ x: 0, y: 0, w: this.PANEL_W, h: this.PANEL_H }],
          };
        }

        tryPlace(panel, part) {
          const orientations = [
            { w: part.w, h: part.h, rotated: false },
            { w: part.h, h: part.w, rotated: true },
          ];

          for (const orient of orientations) {
            for (let i = 0; i < panel.freeRects.length; i++) {
              const rect = panel.freeRects[i];
              if (orient.w + this.KERF <= rect.w && orient.h + this.KERF <= rect.h) {
                const placed = {
                  ...part,
                  x: rect.x,
                  y: rect.y,
                  w: orient.w,
                  h: orient.h,
                  rotated: orient.rotated,
                };
                panel.parts.push(placed);
                this.splitRect(panel, rect, orient.w, orient.h);
                return true;
              }
            }
          }
          return false;
        }

        splitRect(panel, rect, usedW, usedH) {
          const idx = panel.freeRects.indexOf(rect);
          panel.freeRects.splice(idx, 1);

          const rightW = rect.w - usedW - this.KERF;
          if (rightW > 100) {
            panel.freeRects.push({ x: rect.x + usedW + this.KERF, y: rect.y, w: rightW, h: rect.h });
          }

          const bottomH = rect.h - usedH - this.KERF;
          if (bottomH > 100) {
            panel.freeRects.push({ x: rect.x, y: rect.y + usedH + this.KERF, w: usedW, h: bottomH });
          }

          panel.freeRects.sort((a, b) => b.w * b.h - a.w * a.h);
        }

        getEfficiency(panel) {
          const used = panel.parts.reduce((sum, p) => sum + p.w * p.h, 0);
          return ((used / (panel.w * panel.h)) * 100).toFixed(1);
        }

        // SVG 생성
        generateSVG(panel, matKey, scale = 0.25) {
          const svgW = Math.round(this.PANEL_W * scale);
          const svgH = Math.round(this.PANEL_H * scale);
          const eff = this.getEfficiency(panel);

          let svg = `<svg width="${svgW + 40}" height="${svgH + 60}" viewBox="0 0 ${svgW + 40} ${svgH + 60}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .panel { fill: #f5f5f5; stroke: #333; stroke-width: 2; }
        .part { fill: #e3f2fd; stroke: #1976d2; stroke-width: 1; }
        .door { fill: #fff3e0; stroke: #f57c00; stroke-width: 1; }
        .back { fill: #f3e5f5; stroke: #7b1fa2; stroke-width: 1; }
        .label { font-family: Arial; font-size: 9px; fill: #333; }
        .dim { font-family: Arial; font-size: 7px; fill: #666; }
        .title { font-family: Arial; font-size: 11px; font-weight: bold; fill: #333; }
      </style>
      <text x="20" y="18" class="title">패널 #${panel.id} (${matKey}) - 효율: ${eff}%</text>
      <rect x="20" y="30" width="${svgW}" height="${svgH}" class="panel"/>`;

          panel.parts.forEach((part) => {
            const x = Math.round(part.x * scale) + 20;
            const y = Math.round(part.y * scale) + 30;
            const w = Math.round(part.w * scale);
            const h = Math.round(part.h * scale);
            const cls = part.part.includes('도어') ? 'door' : part.part.includes('뒷판') ? 'back' : 'part';

            svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"/>`;
            svg += `<text x="${x + w / 2}" y="${y + h / 2 - 4}" class="label" text-anchor="middle">${part.part}</text>`;
            svg += `<text x="${x + w / 2}" y="${y + h / 2 + 8}" class="dim" text-anchor="middle">${part.w}×${part.h}</text>`;
            if (part.rotated) svg += `<text x="${x + 3}" y="${y + 12}" class="dim">↻</text>`;
          });

          svg += `</svg>`;
          return svg;
        }

        // HTML 리포트 생성
        generateReport(panelGroups) {
          let html = `<div style="font-family:Arial;padding:20px;">
      <h2 style="color:#1976d2;">🪵 재단 도면</h2>
      <p>생성일: ${new Date().toLocaleString('ko-KR')}</p>`;

          let totalPanels = 0;
          Object.keys(panelGroups).forEach((key) => {
            const panels = panelGroups[key];
            totalPanels += panels.length;
            html += `<h3>${key}: ${panels.length}장</h3>`;
            panels.forEach((panel) => {
              html += `<div style="margin:10px 0;border:1px solid #ddd;padding:10px;border-radius:8px;">`;
              html += this.generateSVG(panel, key);
              html += `<p style="font-size:12px;color:#666;">부품 ${panel.parts.length}개</p></div>`;
            });
          });

          html += `<h3>총 패널: ${totalPanels}장</h3></div>`;
          return html;
        }
      }

      // ============================================================
      // 전역 인스턴스 생성
      // ============================================================
      const materialExtractor = new MaterialExtractor();
      const hardwareExtractor = new HardwareExtractor();
      const drawingVisualizer = new DrawingVisualizer();

      // DadamAgent에 추출 기능 추가
      window.DadamAgent.extractMaterials = function () {
        const design = window.DadamAgent.exportDesign();
        return materialExtractor.extract(design);
      };

      window.DadamAgent.extractHardware = function () {
        const design = window.DadamAgent.exportDesign();
        return hardwareExtractor.extract(design);
      };

      window.DadamAgent.generateDrawings = function (mode = 'material') {
        const design = window.DadamAgent.exportDesign();
        const matResult = materialExtractor.extract(design);
        return drawingVisualizer.generateCuttingLayout(matResult.materials, mode);
      };

