      // ============================================================
      // 전역 Undo/Redo 시스템
      // ============================================================
      const _undoStack = [];
      const _redoStack = [];
      const UNDO_MAX = 5;

      function pushUndo(item) {
        if (!item) return;
        _undoStack.push({
          uniqueId: item.uniqueId,
          modules: JSON.parse(JSON.stringify(item.modules)),
          specs: JSON.parse(JSON.stringify(item.specs)),
          timestamp: Date.now(),
        });
        if (_undoStack.length > UNDO_MAX) _undoStack.shift();
        _redoStack.length = 0; // redo 초기화
      }

      function undo() {
        if (_undoStack.length === 0) return;
        const snapshot = _undoStack.pop();
        const item = selectedItems.find(i => i.uniqueId === snapshot.uniqueId);
        if (!item) return;

        // 현재 상태를 redo에 저장
        _redoStack.push({
          uniqueId: item.uniqueId,
          modules: JSON.parse(JSON.stringify(item.modules)),
          specs: JSON.parse(JSON.stringify(item.specs)),
          timestamp: Date.now(),
        });

        // 복원
        item.modules = snapshot.modules;
        item.specs = snapshot.specs;
        renderWorkspaceContent(item);
        console.log('[Undo] restored to', new Date(snapshot.timestamp).toLocaleTimeString());
      }

      function redo() {
        if (_redoStack.length === 0) return;
        const snapshot = _redoStack.pop();
        const item = selectedItems.find(i => i.uniqueId === snapshot.uniqueId);
        if (!item) return;

        // 현재 상태를 undo에 저장
        _undoStack.push({
          uniqueId: item.uniqueId,
          modules: JSON.parse(JSON.stringify(item.modules)),
          specs: JSON.parse(JSON.stringify(item.specs)),
          timestamp: Date.now(),
        });

        item.modules = snapshot.modules;
        item.specs = snapshot.specs;
        renderWorkspaceContent(item);
        console.log('[Redo] restored to', new Date(snapshot.timestamp).toLocaleTimeString());
      }

      // Ctrl+Z / Ctrl+Y 키보드 바인딩
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
          e.preventDefault();
          redo();
        }
      });

      // ============================================================
      // 이벤트 핸들러 함수들
      // ============================================================

      // ★ 붙박이장 전용 워크스페이스 렌더링
      function renderWardrobeWorkspace(item) {
        const ws = document.getElementById('designWorkspace');
        const W = parseFloat(item.w) || 0;
        const H = parseFloat(item.h) || 0;
        const D = parseFloat(item.d) || 0;
        const curtainW = parseFloat(item.specs.curtainBoxW) || 0;
        const curtainH = parseFloat(item.specs.curtainBoxH) || 0;
        const isRefLeft = item.specs.measurementBase === 'Left';

        // 모듈 초기화 (없으면 기본 모듈 생성)
        if (!item.modules || item.modules.length === 0) {
          item.modules = [];
        }

        const wardrobeModules = item.modules.filter((m) => m.pos === 'wardrobe');
        const usedW = wardrobeModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
        // ★ 유효공간: 직접 입력값 우선, 없으면 자동 계산
        const autoEffectiveW =
          W -
          (item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0) -
          (item.specs.finishRightType !== 'None' ? parseFloat(item.specs.finishRightWidth) || 0 : 0);
        const effectiveW = item.specs.wardrobeEffectiveW || autoEffectiveW;
        const remaining = effectiveW - usedW;

        // Front View SVG 생성 (확대 및 하단 여백 추가)
        const svgWidth = 650;
        const svgHeight = 450;
        const scale = Math.min((svgWidth - 100) / W, (svgHeight - 100) / H);
        const drawW = W * scale;
        const drawH = H * scale;
        const offsetX = (svgWidth - drawW) / 2;
        const offsetY = 40; // 상단 여백 고정

        // 모듈 SVG 그리기
        let moduleSvg = '';
        let currentX = isRefLeft ? 0 : W;

        // 좌측 마감
        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const fR = item.specs.finishRightType !== 'None' ? parseFloat(item.specs.finishRightWidth) || 0 : 0;

        if (fL > 0) {
          moduleSvg += `<rect x="${offsetX}" y="${offsetY}" width="${fL * scale}" height="${drawH}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>
      <text x="${offsetX + (fL * scale) / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="10" fill="#666">${fL}</text>`;
        }

        // 커튼박스 표시
        let curtainSvg = '';
        if (curtainW > 0 && curtainH > 0) {
          const cbX = isRefLeft ? offsetX + fL * scale : offsetX + drawW - fR * scale - curtainW * scale;
          curtainSvg = `<rect x="${cbX}" y="${offsetY}" width="${curtainW * scale}" height="${curtainH * scale}" fill="#ffe4b5" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4"/>
      <text x="${cbX + (curtainW * scale) / 2}" y="${offsetY + (curtainH * scale) / 2 + 4}" text-anchor="middle" font-size="10" fill="#b45309">커튼박스</text>`;
        }

        // 모듈 그리기 (상부장/하부장 구분) + 옷봉/선반/서랍
        let moduleStartX = offsetX + fL * scale;
        const pedestalH = parseFloat(item.specs.wardrobePedestal) || 60;
        const showDoors = item.specs.showDoors || false; // 도어 표시 여부
        const doorColor = getDoorColor(item.specs.doorColorUpper || '화이트');
        const doorGap = 3 * scale; // 3mm 간격
        const moldingH = parseFloat(item.specs.wardrobeMoldingH) || 15;
        const totalModuleH = H - pedestalH - moldingH;
        const pedestalHScaled = pedestalH * scale;
        const moldingHScaled = moldingH * scale;
        const PANEL_THICKNESS = 15; // 천판/지판/선반 두께
        const ROD_OFFSET = 75; // 옷봉 위치: 상단에서 -75mm
        const LONG_FIRST_SHELF = 315; // 긴옷 첫 선반: 상단에서 -315mm
        const DRAWER_HEIGHT = 300; // 서랍 높이 (300mm 고정)
        const SMARTBAR_WIDTH = 30; // 스마트바 너비
        const handleType = item.specs.handleType || 'bar';

        // 선반 위치 계산 함수 (일반): (모듈높이 - 천판(15) - 지판(15) - 선반갯수*15) / (선반갯수+1)
        const calcShelfPositions = (moduleH, shelfCount, startY, scale) => {
          if (shelfCount <= 0) return [];
          const usableH = moduleH - PANEL_THICKNESS * 2 - shelfCount * PANEL_THICKNESS;
          const spacing = usableH / (shelfCount + 1);
          const positions = [];
          for (let i = 1; i <= shelfCount; i++) {
            const shelfY = startY + PANEL_THICKNESS * scale + (i * spacing + (i - 1) * PANEL_THICKNESS) * scale;
            positions.push(shelfY);
          }
          return positions;
        };

        // 긴옷용 선반 위치 계산 (첫 선반은 상단에서 -315mm)
        const calcLongShelfPositions = (moduleH, shelfCount, startY, scale) => {
          if (shelfCount <= 0) return [];
          const positions = [];
          // 첫 선반: 상단에서 -315mm
          const firstShelfY = startY + LONG_FIRST_SHELF * scale;
          positions.push(firstShelfY);

          if (shelfCount > 1) {
            // 나머지 선반: 첫 선반 아래 균등 분배
            const remainingH = moduleH - LONG_FIRST_SHELF - PANEL_THICKNESS;
            const spacing = remainingH / shelfCount;
            for (let i = 2; i <= shelfCount; i++) {
              const shelfY = firstShelfY + (i - 1) * spacing * scale;
              positions.push(shelfY);
            }
          }
          return positions;
        };

        // 서랍 그리기 함수
        const drawDrawers = (x, y, w, drawerCount, isExternal, scale) => {
          if (drawerCount <= 0) return '';
          let svg = '';
          const drawerH = DRAWER_HEIGHT * scale;
          const padding = isExternal ? 0 : 5;

          for (let i = 0; i < drawerCount; i++) {
            const drawerY = y - (i + 1) * drawerH;
            const dx = x + padding;
            const dw = w - padding * 2;

            // 서랍 박스
            svg += `<rect x="${dx}" y="${drawerY}" width="${dw}" height="${drawerH - 2}" fill="#f5f5f5" stroke="#888" stroke-width="1.5"/>`;
            // 서랍 손잡이
            const handleY = drawerY + drawerH / 2 - 3;
            const handleW = 30;
            svg += `<rect x="${dx + dw / 2 - handleW / 2}" y="${handleY}" width="${handleW}" height="6" rx="2" fill="#666"/>`;
          }
          return svg;
        };

        // 스마트바 그리기 함수
        const drawSmartbar = (x, y, h, scale) => {
          const sbW = SMARTBAR_WIDTH * scale;
          const sbH = h * scale;
          return `<rect x="${x}" y="${y}" width="${sbW}" height="${sbH}" fill="#333" stroke="#222" stroke-width="1"/>
      <rect x="${x + 2}" y="${y + sbH * 0.3}" width="${sbW - 4}" height="${sbH * 0.4}" fill="#555" rx="2"/>`;
        };

        wardrobeModules.forEach((mod, idx) => {
          const mW = parseFloat(mod.w) * scale;
          const moduleType = mod.moduleType || 'short';
          const isDivided = moduleType === 'short' || moduleType === 'shelf';
          const isShelfType = moduleType === 'shelf';
          const shelfCountUpper = mod.shelfCountUpper || 0;
          const shelfCountLower = mod.shelfCountLower || 0;
          const shelfCount = mod.shelfCount || 0;
          const drawerCount = mod.drawerCount || 0;
          const isExternalDrawer = mod.isExternalDrawer || false;

          if (isDivided) {
            // 상부장/하부장 분리형
            const upperH = parseFloat(mod.upperH) || Math.round(totalModuleH / 2);
            const lowerH = parseFloat(mod.lowerH) || Math.round(totalModuleH / 2);
            const upperHScaled = upperH * scale;
            const lowerHScaled = lowerH * scale;

            // 하부장 (아래) - 좌대 위에 위치
            const lowerY = offsetY + drawH - pedestalHScaled - lowerHScaled;
            moduleSvg += `<rect x="${moduleStartX}" y="${lowerY}" width="${mW}" height="${lowerHScaled}" fill="${isShelfType ? '#fffbeb' : '#eff6ff'}" stroke="${isShelfType ? '#f59e0b' : '#3b82f6'}" stroke-width="2"/>`;

            // 하부장 옷봉 (선반형 제외) - 상단에서 -75mm
            if (!isShelfType) {
              const rodY = lowerY + ROD_OFFSET * scale;
              moduleSvg += `<line x1="${moduleStartX + 10}" y1="${rodY}" x2="${moduleStartX + mW - 10}" y2="${rodY}" stroke="#666" stroke-width="3" stroke-linecap="round"/>
          <circle cx="${moduleStartX + 15}" cy="${rodY}" r="4" fill="#888"/>
          <circle cx="${moduleStartX + mW - 15}" cy="${rodY}" r="4" fill="#888"/>`;
            }

            // 하부장 선반
            const lowerShelfPositions = calcShelfPositions(lowerH, shelfCountLower, lowerY, scale);
            lowerShelfPositions.forEach((sy) => {
              moduleSvg += `<line x1="${moduleStartX + 3}" y1="${sy}" x2="${moduleStartX + mW - 3}" y2="${sy}" stroke="#999" stroke-width="2"/>`;
            });

            // 하부장 서랍 (하단에서 위로 스택)
            const lowerBottom = lowerY + lowerHScaled;
            moduleSvg += drawDrawers(moduleStartX, lowerBottom, mW, drawerCount, isExternalDrawer, scale);

            // 하부장 텍스트
            moduleSvg += `<text x="${moduleStartX + mW / 2}" y="${lowerY + lowerHScaled / 2 + 15}" text-anchor="middle" font-size="8" fill="#666">${mod.w}×${lowerH}</text>`;

            // 상부장 (위)
            const upperY = lowerY - upperHScaled;
            moduleSvg += `<rect x="${moduleStartX}" y="${upperY}" width="${mW}" height="${upperHScaled}" fill="${isShelfType ? '#fef3c7' : '#ecfdf5'}" stroke="${isShelfType ? '#f59e0b' : '#10b981'}" stroke-width="2"/>`;

            // 상부장 옷봉 (선반형 제외) - 상단에서 -75mm
            if (!isShelfType) {
              const rodY = upperY + ROD_OFFSET * scale;
              moduleSvg += `<line x1="${moduleStartX + 10}" y1="${rodY}" x2="${moduleStartX + mW - 10}" y2="${rodY}" stroke="#666" stroke-width="3" stroke-linecap="round"/>
          <circle cx="${moduleStartX + 15}" cy="${rodY}" r="4" fill="#888"/>
          <circle cx="${moduleStartX + mW - 15}" cy="${rodY}" r="4" fill="#888"/>`;
            }

            // 상부장 선반
            const upperShelfPositions = calcShelfPositions(upperH, shelfCountUpper, upperY, scale);
            upperShelfPositions.forEach((sy) => {
              moduleSvg += `<line x1="${moduleStartX + 3}" y1="${sy}" x2="${moduleStartX + mW - 3}" y2="${sy}" stroke="#999" stroke-width="2"/>`;
            });

            // 상부장 텍스트
            moduleSvg += `<text x="${moduleStartX + mW / 2}" y="${upperY + upperHScaled / 2 + 15}" text-anchor="middle" font-size="8" fill="#666">${mod.w}×${upperH}</text>`;

            // 하단 너비 치수
            moduleSvg += `<text x="${moduleStartX + mW / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="10" fill="#4a7dff">${mod.w}</text>`;
          } else {
            // 긴옷 단일형 - 좌대 위에 위치
            const mH = parseFloat(mod.h) || totalModuleH;
            const mHScaled = mH * scale;
            const mY = offsetY + drawH - pedestalHScaled - mHScaled;

            moduleSvg += `<rect x="${moduleStartX}" y="${mY}" width="${mW}" height="${mHScaled}" fill="#f0f7ff" stroke="#4a7dff" stroke-width="2"/>`;

            // 긴옷 옷봉 - 상단에서 -75mm
            const rodY = mY + ROD_OFFSET * scale;
            moduleSvg += `<line x1="${moduleStartX + 10}" y1="${rodY}" x2="${moduleStartX + mW - 10}" y2="${rodY}" stroke="#666" stroke-width="3" stroke-linecap="round"/>
        <circle cx="${moduleStartX + 15}" cy="${rodY}" r="4" fill="#888"/>
        <circle cx="${moduleStartX + mW - 15}" cy="${rodY}" r="4" fill="#888"/>`;

            // 긴옷 선반 (첫 선반: 상단 -315mm)
            const longShelfPositions = calcLongShelfPositions(mH, shelfCount, mY, scale);
            longShelfPositions.forEach((sy) => {
              moduleSvg += `<line x1="${moduleStartX + 3}" y1="${sy}" x2="${moduleStartX + mW - 3}" y2="${sy}" stroke="#999" stroke-width="2"/>`;
            });

            // 긴옷 서랍 (하단에서 위로 스택)
            const longBottom = mY + mHScaled;
            moduleSvg += drawDrawers(moduleStartX, longBottom, mW, drawerCount, isExternalDrawer, scale);

            // 텍스트
            moduleSvg += `<text x="${moduleStartX + mW / 2}" y="${mY + mHScaled / 2 + 5}" text-anchor="middle" font-size="9" fill="#666">${mod.w}×${mH}</text>
        <text x="${moduleStartX + mW / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="10" fill="#4a7dff">${mod.w}</text>`;

            // 도어 표시 (긴옷)
            if (showDoors) {
              const doorCount = Math.max(1, Math.round(mod.w / 450));
              const dW = mW / doorCount;
              for (let d = 0; d < doorCount; d++) {
                const dX = moduleStartX + d * dW + doorGap / 2;
                moduleSvg += `<rect x="${dX}" y="${mY + doorGap / 2}" width="${dW - doorGap}" height="${mHScaled - doorGap}" fill="${doorColor}" stroke="#333" stroke-width="1" rx="2"/>`;
              }
            }
          }

          // 도어 표시 (상부장/하부장 통합 도어)
          if (showDoors && isDivided) {
            const upperH = parseFloat(mod.upperH) || Math.round(totalModuleH / 2);
            const lowerH = parseFloat(mod.lowerH) || Math.round(totalModuleH / 2);
            const upperHScaled = upperH * scale;
            const lowerHScaled = lowerH * scale;
            const lowerY = offsetY + drawH - pedestalHScaled - lowerHScaled;
            const upperY = lowerY - upperHScaled;

            // 외부 서랍이 있으면 서랍 높이만큼 제외
            const DRAWER_H = 300;
            const externalDrawerH = isExternalDrawer ? drawerCount * DRAWER_H : 0;
            const doorAreaH = upperH + lowerH - externalDrawerH;
            const doorAreaHScaled = doorAreaH * scale;

            // 통합 도어 (상부장 + 하부장, 외부서랍 제외)
            const doorCount = Math.max(1, Math.round(mod.w / 450));
            const dW = mW / doorCount;
            for (let d = 0; d < doorCount; d++) {
              const dX = moduleStartX + d * dW + doorGap / 2;
              moduleSvg += `<rect x="${dX}" y="${upperY + doorGap / 2}" width="${dW - doorGap}" height="${doorAreaHScaled - doorGap}" fill="${doorColor}" stroke="#333" stroke-width="1" rx="2"/>`;
            }

            // 외부 서랍 개별 도어
            if (isExternalDrawer && drawerCount > 0) {
              const drawerHScaled = DRAWER_H * scale;
              for (let i = 0; i < drawerCount; i++) {
                const drawerY = offsetY + drawH - pedestalHScaled - (i + 1) * drawerHScaled;
                moduleSvg += `<rect x="${moduleStartX + doorGap / 2}" y="${drawerY + doorGap / 2}" width="${mW - doorGap}" height="${drawerHScaled - doorGap}" fill="${doorColor}" stroke="#333" stroke-width="1" rx="2"/>`;
              }
            }
          }

          moduleStartX += mW;
        });

        // 우측 마감
        if (fR > 0) {
          moduleSvg += `<rect x="${offsetX + drawW - fR * scale}" y="${offsetY}" width="${fR * scale}" height="${drawH}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>
      <text x="${offsetX + drawW - (fR * scale) / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="10" fill="#666">${fR}</text>`;
        }

        const frontViewSvg = `
    <svg width="${svgWidth}" height="${svgHeight}" style="background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;">
      <!-- 외곽선 -->
      <rect x="${offsetX}" y="${offsetY}" width="${drawW}" height="${drawH}" fill="none" stroke="#333" stroke-width="2"/>

      <!-- 상몰딩 영역 -->
      <rect x="${offsetX + fL * scale}" y="${offsetY}" width="${drawW - fL * scale - fR * scale}" height="${moldingHScaled}" fill="#d4c4a8" stroke="#b8a898" stroke-width="1"/>
      <text x="${offsetX + drawW + 8}" y="${offsetY + moldingHScaled / 2 + 4}" text-anchor="start" font-size="9" fill="#8b7355" font-weight="bold">${moldingH}</text>

      <!-- 좌대 영역 -->
      <rect x="${offsetX + fL * scale}" y="${offsetY + drawH - pedestalHScaled}" width="${drawW - fL * scale - fR * scale}" height="${pedestalHScaled}" fill="#c9c0b8" stroke="#a9a098" stroke-width="1"/>
      <text x="${offsetX + drawW + 8}" y="${offsetY + drawH - pedestalHScaled / 2 + 4}" text-anchor="start" font-size="9" fill="#7a7168" font-weight="bold">${pedestalH}</text>

      <!-- 치수선 - 상단 -->
      <line x1="${offsetX}" y1="${offsetY - 15}" x2="${offsetX + drawW}" y2="${offsetY - 15}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX}" y1="${offsetY - 20}" x2="${offsetX}" y2="${offsetY - 10}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX + drawW}" y1="${offsetY - 20}" x2="${offsetX + drawW}" y2="${offsetY - 10}" stroke="#666" stroke-width="1"/>
      <text x="${offsetX + drawW / 2}" y="${offsetY - 22}" text-anchor="middle" font-size="12" fill="#333" font-weight="bold">${W}mm</text>

      <!-- 치수선 - 좌측 -->
      <line x1="${offsetX - 15}" y1="${offsetY}" x2="${offsetX - 15}" y2="${offsetY + drawH}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX - 20}" y1="${offsetY}" x2="${offsetX - 10}" y2="${offsetY}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX - 20}" y1="${offsetY + drawH}" x2="${offsetX - 10}" y2="${offsetY + drawH}" stroke="#666" stroke-width="1"/>
      <text x="${offsetX - 25}" y="${offsetY + drawH / 2}" text-anchor="middle" font-size="12" fill="#333" font-weight="bold" transform="rotate(-90 ${offsetX - 25} ${offsetY + drawH / 2})">${H}mm</text>

      <!-- 커튼박스 -->
      ${curtainSvg}

      <!-- 모듈들 -->
      ${moduleSvg}

      <!-- 실측 기준 표시 -->
      <text x="${isRefLeft ? offsetX + 10 : offsetX + drawW - 10}" y="${offsetY + drawH - pedestalHScaled - 5}" text-anchor="${isRefLeft ? 'start' : 'end'}" font-size="10" fill="#4a7dff" font-weight="bold">▼ 실측기준</text>
    </svg>
  `;

        // 모듈 카드 렌더링
        const renderWardrobeModuleCard = (mod, idx, totalCount) => {
          const drawerCount = mod.drawerCount || 0;
          const shelfCountUpper = mod.shelfCountUpper || 0;
          const shelfCountLower = mod.shelfCountLower || 0;
          const shelfCount = mod.shelfCount || 0;
          const rodCountUpper = mod.rodCountUpper || 0;
          const rodCountLower = mod.rodCountLower || 0;
          const moduleType = mod.moduleType || 'short';
          const isDivided = moduleType === 'short' || moduleType === 'shelf';
          const isShelfType = moduleType === 'shelf';
          const isExternalDrawer = mod.isExternalDrawer || false;

          // 높이 계산
          const pedestalH = parseFloat(item.specs.wardrobePedestal) || 60;
          const moldingH = parseFloat(item.specs.wardrobeMoldingH) || 15;
          const totalH = parseFloat(item.h) || 0;
          const effectiveH = totalH - pedestalH - moldingH;
          const halfH = Math.floor(effectiveH / 2);

          // 카운터 박스 스타일 (압축형)
          const cBoxStyle =
            'display:flex;flex-direction:column;align-items:center;padding:4px 6px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;';
          const cBtnStyle =
            'width:20px;height:20px;border:1px solid #ddd;background:#fff;border-radius:3px;cursor:pointer;font-size:12px;line-height:1;';
          // 서랍 타입 토글 (압축형)
          const drawerToggle = `
      <div class="wm-drawer-toggle">
        <div class="wm-drawer-label">서랍형</div>
        <div class="wm-drawer-btns">
          <button class="wm-drawer-btn ${!isExternalDrawer ? 'active' : ''}" data-action="setDrawerType" data-item="${item.uniqueId}" data-mod="${mod.id}" data-value="false">내부</button>
          <button class="wm-drawer-btn ${isExternalDrawer ? 'active' : ''}" data-action="setDrawerType" data-item="${item.uniqueId}" data-mod="${mod.id}" data-value="true">외부</button>
        </div>
      </div>
    `;

          return `
      <div class="module-card wm-card" data-module-id="${mod.id}">
        <!-- 좌측: 이동 + 타입 -->
        <div class="wm-left">
          <div class="wm-move-btns">
            <button class="btn-move" data-action="moveWdrb" data-item="${item.uniqueId}" data-mod="${mod.id}" data-dir="up" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button class="btn-move" data-action="moveWdrb" data-item="${item.uniqueId}" data-mod="${mod.id}" data-dir="down" ${idx === totalCount - 1 ? 'disabled' : ''}>▼</button>
          </div>
          <button class="wm-type-btn short ${moduleType === 'short' ? 'active' : ''}" data-action="setWdrbType" data-item="${item.uniqueId}" data-mod="${mod.id}" data-type="short">짧은옷</button>
          <button class="wm-type-btn long ${moduleType === 'long' ? 'active' : ''}" data-action="setWdrbType" data-item="${item.uniqueId}" data-mod="${mod.id}" data-type="long">긴옷</button>
          <button class="wm-type-btn shelf ${moduleType === 'shelf' ? 'active' : ''}" data-action="setWdrbType" data-item="${item.uniqueId}" data-mod="${mod.id}" data-type="shelf">선반형</button>
        </div>

        <!-- 중앙: 모듈 정보 -->
        <div class="wm-center">
          <!-- 헤더 -->
          <div class="wm-header">
            <span class="wm-icon">🚪</span>
            <span class="wm-name">${mod.name}</span>
            <span class="wm-badge ${moduleType}">${moduleType === 'short' ? '짧은옷' : moduleType === 'long' ? '긴옷' : '선반'}</span>
            <label class="checkbox-label" style="margin-left:auto;"><input type="checkbox" ${mod.hasMirror ? 'checked' : ''} data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="hasMirror"> 거울</label>
            <button class="btn-delete-module" data-action="removeWdrb" data-item="${item.uniqueId}" data-mod="${mod.id}">×</button>
          </div>

          ${
            isDivided
              ? `
          <!-- 상부장/하부장 분리형 -->
          <div style="display:flex;flex-direction:column;gap:4px;">
            <!-- 상부장 -->
            <div class="wm-section upper">
              <span class="wm-section-label">상부장</span>
              <span class="wm-dim-label">W</span>
              <input type="number" class="wm-dim-input" value="${mod.w}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="w">
              <span class="wm-dim-label">H</span>
              <input type="number" class="wm-dim-input" value="${mod.upperH || halfH}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="upperH">
              <span class="wm-dim-label">D</span>
              <input type="number" class="wm-dim-input" value="${mod.d}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="d">
              ${moduleType !== 'short' ? `<button class="wm-sett-btn" onclick="openWardrobeSectionSettings(${item.uniqueId}, ${mod.id}, 'upper')">⚙️</button>` : ''}
            </div>
            <!-- 하부장 -->
            <div class="wm-section lower">
              <span class="wm-section-label">하부장</span>
              <span class="wm-dim-label">W</span>
              <input type="number" class="wm-dim-input" value="${mod.w}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="w">
              <span class="wm-dim-label">H</span>
              <input type="number" class="wm-dim-input" value="${mod.lowerH || halfH}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="lowerH">
              <span class="wm-dim-label">D</span>
              <input type="number" class="wm-dim-input" value="${mod.d}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="d">
              <button class="wm-sett-btn" onclick="openWardrobeSectionSettings(${item.uniqueId}, ${mod.id}, 'lower')">⚙️</button>
            </div>
          </div>
          `
              : `
          <!-- 긴옷 단일형 -->
          <div class="wm-section full">
            <span class="wm-section-label">긴옷장</span>
            <span class="wm-dim-label">W</span>
            <input type="number" class="wm-dim-input" value="${mod.w}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="w">
            <span class="wm-dim-label">H</span>
            <input type="number" class="wm-dim-input" value="${mod.h || effectiveH}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="h">
            <span class="wm-dim-label">D</span>
            <input type="number" class="wm-dim-input" value="${mod.d}" data-item="${item.uniqueId}" data-mod="${mod.id}" data-field="d">
            <button class="wm-sett-btn" onclick="openWardrobeSectionSettings(${item.uniqueId}, ${mod.id}, 'full')">⚙️</button>
          </div>
          `
          }
          ${drawerCount > 0 ? drawerToggle : ''}
        </div>
      </div>
    `;
        };

        const modulesHtml = wardrobeModules
          .map((m, i) => renderWardrobeModuleCard(m, i, wardrobeModules.length))
          .join('');

        ws.innerHTML = `
    <div class="ws-header">
      <div class="ws-title">${item.labelName} 상세 설계 <span class="ws-info-badge">W ${W} x H ${H} x D ${D}</span></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-purple-gradient" onclick="generateAIDesign()" title="AI 디자인 이미지 생성">🎨 AI 디자인 생성</button>
        <button onclick="proceedToBOM()" style="background:linear-gradient(135deg,#4caf50,#388e3c);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;" title="자재/부자재 산출">📋 BOM 산출</button>
      </div>
    </div>
    <div class="ws-layout">
      <div class="spec-panel">
        <div class="spec-group-title">1. Dimensions (치수)</div>
        <div class="spec-row">
          <div class="spec-field"><label>전체 높이</label><input type="number" value="${H}" disabled></div>
          <div class="spec-field"><label>전체 깊이</label><input type="number" value="${D}" disabled></div>
          <div class="spec-field"><label>좌대 높이</label><input type="number" value="${item.specs.wardrobePedestal || 60}" onblur="updateWardrobeSpec(${item.uniqueId}, 'wardrobePedestal', this.value)"></div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>커튼박스 가로</label><input type="number" value="${curtainW}" onblur="updateWardrobeSpec(${item.uniqueId}, 'curtainBoxW', this.value)"></div>
          <div class="spec-field"><label>커튼박스 높이</label><input type="number" value="${curtainH}" onblur="updateWardrobeSpec(${item.uniqueId}, 'curtainBoxH', this.value)"></div>
        </div>

        <div class="spec-group-title">2. Hardware</div>
        <div class="spec-row">
          <div class="spec-field"><label>손잡이</label>
            <select onchange="updateWardrobeSpec(${item.uniqueId}, 'handleType', this.value)">
              <option value="push" ${(item.specs.handleType || 'push') === 'push' ? 'selected' : ''}>푸쉬</option>
              <option value="smartbar" ${item.specs.handleType === 'smartbar' ? 'selected' : ''}>스마트바</option>
              <option value="round" ${item.specs.handleType === 'round' ? 'selected' : ''}>라운드</option>
            </select>
          </div>
          <div class="spec-field"><label>레일</label><select><option>소프트클로징</option><option>일반 레일</option><option>풀익스텐션</option></select></div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>실측 기준</label>
            <select onchange="updateWardrobeSpec(${item.uniqueId}, 'measurementBase', this.value)">
              <option value="Left" ${isRefLeft ? 'selected' : ''}>좌측</option>
              <option value="Right" ${!isRefLeft ? 'selected' : ''}>우측</option>
            </select>
          </div>
        </div>

        <div class="spec-group-title">3. Colors (도어)</div>
        <div class="spec-row">
          <div class="spec-field"><label>도어 색상</label>
            <div class="color-select-row">
              <select onchange="updateWardrobeSpec(${item.uniqueId}, 'doorFinishUpper', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_finish', item.specs.doorFinishUpper, 'wardrobe')}</select>
              <select onchange="updateWardrobeSpec(${item.uniqueId}, 'doorColorUpper', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_color', item.specs.doorColorUpper, 'wardrobe')}</select>
            </div>
          </div>
        </div>

        <div class="spec-group-title">4. Finish Settings (마감)</div>
        <div class="spec-row">
          <div class="spec-field"><label>상몰딩 높이(mm)</label><input type="number" value="${item.specs.wardrobeMoldingH || 20}" onblur="updateWardrobeSpec(${item.uniqueId}, 'wardrobeMoldingH', this.value)"></div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>좌측 마감</label><select onchange="updateWardrobeFinishType(${item.uniqueId}, 'Left', this.value)"><option value="Molding" ${item.specs.finishLeftType === 'Molding' ? 'selected' : ''}>몰딩</option><option value="Filler" ${item.specs.finishLeftType === 'Filler' ? 'selected' : ''}>휠라</option><option value="EP" ${item.specs.finishLeftType === 'EP' ? 'selected' : ''}>EP</option><option value="None" ${item.specs.finishLeftType === 'None' ? 'selected' : ''}>없음</option></select></div>
          <div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishLeftWidth}" ${item.specs.finishLeftType === 'EP' || item.specs.finishLeftType === 'None' ? 'disabled' : ''} onblur="updateWardrobeSpec(${item.uniqueId}, 'finishLeftWidth', this.value)"></div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>우측 마감</label><select onchange="updateWardrobeFinishType(${item.uniqueId}, 'Right', this.value)"><option value="Molding" ${item.specs.finishRightType === 'Molding' ? 'selected' : ''}>몰딩</option><option value="Filler" ${item.specs.finishRightType === 'Filler' ? 'selected' : ''}>휠라</option><option value="EP" ${item.specs.finishRightType === 'EP' ? 'selected' : ''}>EP</option><option value="None" ${item.specs.finishRightType === 'None' ? 'selected' : ''}>없음</option></select></div>
          <div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishRightWidth}" ${item.specs.finishRightType === 'EP' || item.specs.finishRightType === 'None' ? 'disabled' : ''} onblur="updateWardrobeSpec(${item.uniqueId}, 'finishRightWidth', this.value)"></div>
        </div>
      </div>

      <div class="module-panel">
        <!-- ★ Front/Top View 도면 -->
        <div class="front-view-section" style="margin-bottom:20px;">
          <div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span>📐 ${item.specs.wardrobeViewMode === 'top' ? 'Top View' : 'Front View'}</span>
              <span style="font-size:11px;color:#888;font-weight:normal;">${item.specs.wardrobeViewMode === 'top' ? '(상면도)' : '(전면부 도면)'}</span>
            </div>
            <div style="display:flex;gap:4px;">
              <button onclick="switchWardrobeView(${item.uniqueId}, 'front')" class="toggle-btn ${item.specs.wardrobeViewMode !== 'top' ? 'active' : ''}" style="padding:3px 10px;font-size:10px;">📐 Front</button>
              <button onclick="switchWardrobeView(${item.uniqueId}, 'top')" class="toggle-btn ${item.specs.wardrobeViewMode === 'top' ? 'active' : ''}" style="padding:3px 10px;font-size:10px;">⬇️ Top</button>
              <button onclick="toggleWardrobeDoors(${item.uniqueId})" class="toggle-btn ${item.specs.showDoors ? 'active' : ''}" style="padding:4px 12px;font-size:11px;">🚪 도어</button>
            </div>
          </div>
          ${item.specs.wardrobeViewMode === 'top' ? renderWardrobeTopView(item, wardrobeModules) : frontViewSvg}
        </div>

        <div class="module-section">
          <div class="module-section-header" style="background:linear-gradient(135deg, #10b981 0%, #059669 100%);">
            <div class="section-title-row"><span>🚪 붙박이장 모듈</span></div>
            <div class="section-info-row">
              <div class="effective-space-group">
                <label>유효공간:</label>
                <input type="number" value="${Math.round(item.specs.wardrobeEffectiveW || effectiveW)}" 
                  onblur="updateWardrobeEffectiveW(${item.uniqueId}, this.value)"
                  style="width:70px;padding:2px 6px;border:1px solid rgba(255,255,255,0.3);border-radius:4px;background:rgba(255,255,255,0.15);color:white;font-weight:bold;font-size:13px;text-align:right;">
                <span style="color:white;">mm</span>
              </div>
              <span class="section-remaining" style="color:${remaining >= 0 && remaining <= 10 ? '#90EE90' : remaining < 0 ? '#ff6b6b' : 'white'}">잔여: ${Math.round(remaining)}mm</span>
              <div class="section-buttons">
                <button class="btn-section-auto" onclick="runWardrobeAutoCalc(${item.uniqueId})">⚡ 자동계산</button>
                <button class="btn-section-auto" onclick="clearAllModules(${item.uniqueId})" style="background:#fff;color:#dc3545;border:1px solid #f5c6cb;">🗑 전체 제거</button>
              </div>
            </div>
          </div>
          <div class="module-list ${wardrobeModules.length === 0 ? 'empty-list' : ''}">${modulesHtml}</div>
        </div>
        
        <div class="module-btn-group">
          <button class="btn-add-split" style="border-color:#10b981;color:#10b981;" onclick="addWardrobeModule(${item.uniqueId})">+ 붙박이장 모듈</button>
        </div>
      </div>
    </div>
  `;
      }

      // 붙박이장 모듈 관련 함수들
      function addWardrobeModule(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        // ★ 높이 계산: (전체높이 - 좌대 - 상몰딩) / 2
        const pedestalH = parseFloat(item.specs.wardrobePedestal) || 60;
        const moldingH = parseFloat(item.specs.wardrobeMoldingH) || 15;
        const totalH = parseFloat(item.h) || 0;
        const effectiveH = totalH - pedestalH - moldingH;
        const halfH = Math.floor(effectiveH / 2);

        item.modules.push({
          id: Date.now(),
          type: 'wardrobe',
          name: '짧은옷(2단)',
          pos: 'wardrobe',
          w: 900,
          h: effectiveH,
          upperH: halfH,
          lowerH: halfH,
          d: parseFloat(item.d) || 600,
          moduleType: 'short',
          isDivided: true,
          drawerCount: 0,
          shelfCount: 0,
          shelfCountUpper: 0,
          shelfCountLower: 0,
          rodCountUpper: 0,
          rodCountLower: 0,
          hasMirror: false,
          isExternalDrawer: false,
        });
        renderWorkspaceContent(item);
      }

      function removeWardrobeModule(itemUniqueId, modId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.modules = item.modules.filter((m) => m.id !== modId);
        renderWorkspaceContent(item);
      }

      function moveWardrobeModule(itemUniqueId, modId, direction) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const modules = item.modules.filter((m) => m.pos === 'wardrobe');
        const idx = modules.findIndex((m) => m.id === modId);
        if (idx === -1) return;

        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= modules.length) return;

        [modules[idx], modules[newIdx]] = [modules[newIdx], modules[idx]];
        item.modules = item.modules.filter((m) => m.pos !== 'wardrobe').concat(modules);
        renderWorkspaceContent(item);
      }

      function updateWardrobeModuleDim(itemUniqueId, modId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod[field] = parseFloat(value) || 0;
          renderWorkspaceContent(item);
        }
      }

      function toggleWardrobeOption(itemUniqueId, modId, field, checked) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod[field] = checked;
          renderWorkspaceContent(item);
        }
      }

      // ★ 서랍 개수 조절 함수
      function adjustWardrobeDrawer(itemUniqueId, modId, delta) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod.drawerCount = Math.max(0, Math.min(5, (mod.drawerCount || 0) + delta));
          renderWorkspaceContent(item);
        }
      }

      // ★ 모듈 타입 설정 함수 (짧은옷2단, 긴옷1단, 선반형)
      function setWardrobeModuleType(itemUniqueId, modId, type) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          // 이미 같은 타입이면 무시
          if (mod.moduleType === type) { console.log('[setWdrbType] same type, skip'); return; }

          mod.moduleType = type;
          // 타입에 따른 이름 변경
          const typeNames = { short: '짧은옷(2단)', long: '긴옷(1단)', shelf: '선반형' };
          mod.name = typeNames[type] || mod.name;

          // ★ 높이 계산
          const pedestalH = parseFloat(item.specs.wardrobePedestal) || 60;
          const moldingH = parseFloat(item.specs.wardrobeMoldingH) || 15;
          const totalH = parseFloat(item.h) || 0;
          const effectiveH = totalH - pedestalH - moldingH;
          const halfH = Math.floor(effectiveH / 2);

          // ★ 타입별 기본값 설정 — 전체 초기화 후 타입별 값 적용
          if (type === 'short') {
            // 짧은옷(2단): 상부장/하부장 2등분, 상하 옷봉만
            mod.isDivided = true;
            mod.h = effectiveH;
            mod.upperH = halfH;
            mod.lowerH = halfH;
            mod.drawerCount = 0;
            mod.shelfCount = 0;
            mod.shelfCountUpper = 0;
            mod.shelfCountLower = 0;
            mod.rodCountUpper = 0;
            mod.rodCountLower = 0;
            mod.isExternalDrawer = false;
          } else if (type === 'long') {
            // 긴옷(1단): 옷봉1 + 선반1 + 서랍1
            mod.isDivided = false;
            mod.h = effectiveH;
            mod.upperH = 0;
            mod.lowerH = 0;
            mod.drawerCount = 1;
            mod.shelfCount = 1;
            mod.shelfCountUpper = 0;
            mod.shelfCountLower = 0;
            mod.rodCountUpper = 0;
            mod.rodCountLower = 0;
            mod.isExternalDrawer = false;
          } else if (type === 'shelf') {
            // 선반형: 상부장/하부장 2등분, 선반 상부2 + 하부2
            mod.isDivided = true;
            mod.h = effectiveH;
            mod.upperH = halfH;
            mod.lowerH = halfH;
            mod.drawerCount = 0;
            mod.shelfCount = 0;
            mod.shelfCountUpper = 2;
            mod.shelfCountLower = 2;
            mod.rodCountUpper = 0;
            mod.rodCountLower = 0;
            mod.isExternalDrawer = false;
          }

          renderWorkspaceContent(item);
        }
      }

      // ★ 선반 개수 조절 함수
      function adjustWardrobeShelf(itemUniqueId, modId, section, delta) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          if (section === 'upper') {
            mod.shelfCountUpper = Math.max(0, Math.min(6, (mod.shelfCountUpper || 0) + delta));
          } else {
            mod.shelfCountLower = Math.max(0, Math.min(6, (mod.shelfCountLower || 0) + delta));
          }
          renderWorkspaceContent(item);
        }
      }

      // ★ 긴옷용 단일 선반 개수 조절 함수
      function adjustWardrobeShelfSingle(itemUniqueId, modId, delta) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod.shelfCount = Math.max(0, Math.min(6, (mod.shelfCount || 0) + delta));
          renderWorkspaceContent(item);
        }
      }

      // ★ 옷봉 개수 조절 함수 (선반형 모듈용)
      function adjustWardrobeRod(itemUniqueId, modId, section, delta) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          if (section === 'upper') {
            mod.rodCountUpper = Math.max(0, Math.min(3, (mod.rodCountUpper || 0) + delta));
          } else {
            mod.rodCountLower = Math.max(0, Math.min(3, (mod.rodCountLower || 0) + delta));
          }
          renderWorkspaceContent(item);
        }
      }

      // ★ 상부장/하부장 설정 팝업 열기
      // 현재 열린 붙박이장 섹션 설정 팝업 상태
      let currentWardrobePopup = { itemId: null, modId: null, section: null };

      function openWardrobeSectionSettings(itemUniqueId, modId, section) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (!mod) return;

        currentWardrobePopup = { itemId: itemUniqueId, modId: modId, section: section };
        renderWardrobeSectionPopup(item, mod, section);
      }

      function renderWardrobeSectionPopup(item, mod, section) {
        const existingPopup = document.getElementById('wardrobe-section-popup');
        if (existingPopup) existingPopup.remove();

        const moduleType = mod.moduleType || 'short'; // short, long, shelf
        const isShortType = moduleType === 'short';
        const isLongType = moduleType === 'long';
        const isShelfType = moduleType === 'shelf';
        const isFullType = section === 'full';

        let sectionName, sectionColor, sectionBg;
        if (section === 'upper') {
          sectionName = '상부장';
          sectionColor = '#10b981';
          sectionBg = '#ecfdf5';
        } else if (section === 'lower') {
          sectionName = '하부장';
          sectionColor = '#3b82f6';
          sectionBg = '#eff6ff';
        } else {
          sectionName = '긴옷장';
          sectionColor = '#4a7dff';
          sectionBg = '#f0f7ff';
        }

        // 서랍 높이 300mm 고정
        const DRAWER_HEIGHT = 300;
        // 선반 내경 300mm
        const SHELF_INNER_HEIGHT = 300;

        let shelfCount, rodCount, drawerCount, hasRod;
        if (isFullType) {
          // 긴옷(1단) - 선반, 서랍 가능
          shelfCount = mod.shelfCount || 0;
          drawerCount = mod.drawerCount || 0;
          rodCount = 1; // 기본 옷봉 1개
          hasRod = true;
        } else if (section === 'upper') {
          shelfCount = mod.shelfCountUpper || 0;
          rodCount = mod.rodCountUpper || 0;
          hasRod = rodCount > 0;
          drawerCount = 0;
        } else {
          shelfCount = mod.shelfCountLower || 0;
          rodCount = mod.rodCountLower || 0;
          hasRod = rodCount > 0;
          drawerCount = mod.drawerCount || 0;
        }

        // 높이 계산
        const pedestalH = parseFloat(item.specs.wardrobePedestal) || 60;
        const moldingH = parseFloat(item.specs.wardrobeMoldingH) || 15;
        const totalH = parseFloat(item.h) || 0;
        const effectiveH = totalH - pedestalH - moldingH;
        const halfH = Math.floor(effectiveH / 2);
        let sectionH;
        if (isFullType) {
          sectionH = mod.h || effectiveH;
        } else {
          sectionH = section === 'upper' ? mod.upperH || halfH : mod.lowerH || halfH;
        }

        // SVG 프론트뷰 생성
        const svgW = 180;
        const svgH = 280;
        const scale = Math.min((svgW - 40) / mod.w, (svgH - 80) / sectionH);
        const drawW = mod.w * scale;
        const drawH = sectionH * scale;
        const offsetX = (svgW - drawW) / 2;
        const offsetY = 40;

        // 서랍/선반/옷봉 그리기
        let contentSvg = '';

        // 서랍 그리기 (300mm 고정 높이, 아래부터)
        const drawerH_scaled = DRAWER_HEIGHT * scale;
        const totalDrawerH = drawerCount * DRAWER_HEIGHT;
        for (let i = 0; i < drawerCount; i++) {
          const y = offsetY + drawH - drawerH_scaled * (i + 1);
          contentSvg += `<rect x="${offsetX + 3}" y="${y}" width="${drawW - 6}" height="${drawerH_scaled - 2}" fill="#e5e7eb" stroke="#6366f1" stroke-width="1.5" rx="2"/>
      <line x1="${offsetX + drawW / 2 - 15}" y1="${y + drawerH_scaled / 2}" x2="${offsetX + drawW / 2 + 15}" y2="${y + drawerH_scaled / 2}" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/>
      <text x="${offsetX + drawW - 8}" y="${y + drawerH_scaled / 2 + 3}" text-anchor="end" font-size="7" fill="#6366f1">${DRAWER_HEIGHT}</text>`;
        }

        // 선반 그리기 (긴옷장은 서랍 위부터, 내경 300mm 간격)
        if (isFullType && shelfCount > 0) {
          const availableH = sectionH - totalDrawerH - 50; // 옷봉 공간 제외
          const shelfStartY = offsetY + 50; // 옷봉 아래
          for (let i = 0; i < shelfCount; i++) {
            const y = offsetY + drawH - totalDrawerH * scale - (i + 1) * SHELF_INNER_HEIGHT * scale;
            if (y > shelfStartY) {
              contentSvg += `<line x1="${offsetX + 5}" y1="${y}" x2="${offsetX + drawW - 5}" y2="${y}" stroke="#9ca3af" stroke-width="2"/>`;
            }
          }
        } else if (!isFullType && shelfCount > 0) {
          const shelfGap = (drawH - totalDrawerH * scale) / (shelfCount + 1);
          for (let i = 1; i <= shelfCount; i++) {
            const y = offsetY + shelfGap * i;
            contentSvg += `<line x1="${offsetX + 5}" y1="${y}" x2="${offsetX + drawW - 5}" y2="${y}" stroke="#9ca3af" stroke-width="2"/>`;
          }
        }

        // 옷봉 표시
        if (isFullType || hasRod) {
          const rodY = offsetY + 25;
          contentSvg += `<line x1="${offsetX + 10}" y1="${rodY}" x2="${offsetX + drawW - 10}" y2="${rodY}" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${offsetX + 10}" cy="${rodY}" r="4" fill="#f59e0b"/>
      <circle cx="${offsetX + drawW - 10}" cy="${rodY}" r="4" fill="#f59e0b"/>`;
        }

        // 컨트롤 생성 - 타입별로 다른 옵션
        let controlsHtml = '';

        if (isShortType && section === 'lower') {
          // 짧은옷 하부장: 서랍만
          controlsHtml = `
      <div class="ws-counter-row">
        <span class="ws-counter-label" style="color:#6366f1;">서랍 (300mm)</span>
        <div class="ws-counter-box" style="border-color:#6366f1;background:#eef2ff;">
          <button onclick="adjustWardrobePopupValue('drawer', -1)">−</button>
          <span id="ws-drawer-count" style="color:#6366f1;">${drawerCount}</span>
          <button onclick="adjustWardrobePopupValue('drawer', 1)">+</button>
        </div>
      </div>
    `;
        } else if (isFullType) {
          // 긴옷(1단): 옷봉 1개 자동(옵션 표시 없음), 선반+서랍 (서랍은 선반 아래)
          controlsHtml = `
      <div style="font-size:10px;color:#b45309;padding:6px 12px;background:#fef3c7;border-radius:4px;margin-bottom:8px;">※ 옷봉 1개 자동 설치 (상단 고정선반 아래)</div>
      <div class="ws-counter-row">
        <span class="ws-counter-label">선반 (내경 300mm)</span>
        <div class="ws-counter-box">
          <button onclick="adjustWardrobePopupValue('shelf', -1)">−</button>
          <span id="ws-shelf-count">${shelfCount}</span>
          <button onclick="adjustWardrobePopupValue('shelf', 1)">+</button>
        </div>
      </div>
      <div class="ws-counter-row">
        <span class="ws-counter-label" style="color:#6366f1;">서랍 (300mm)</span>
        <div class="ws-counter-box" style="border-color:#6366f1;background:#eef2ff;">
          <button onclick="adjustWardrobePopupValue('drawer', -1)">−</button>
          <span id="ws-drawer-count" style="color:#6366f1;">${drawerCount}</span>
          <button onclick="adjustWardrobePopupValue('drawer', 1)">+</button>
        </div>
      </div>
      <div style="font-size:10px;color:#888;padding:4px 12px;background:#f3f4f6;border-radius:4px;">※ 서랍은 선반 아래에 배치됩니다</div>
    `;
        } else if (isShelfType) {
          // 선반형: 배타적 자동 선택 (선반↔옷봉 자동 전환)
          if (section === 'upper') {
            // 상부장: 선반 OR 옷봉 1개 (자동 전환)
            const shelfActive = shelfCount > 0;
            const rodActive = rodCount > 0;
            controlsHtml = `
        <div style="font-size:11px;color:#666;padding:8px;background:#fff7ed;border-radius:6px;margin-bottom:8px;">※ 선반/옷봉 선택 시 반대 항목 자동 해제</div>
        <div class="ws-counter-row" style="${rodActive ? 'opacity:0.5;' : ''}">
          <span class="ws-counter-label">선반</span>
          <div class="ws-counter-box">
            <button onclick="adjustWardrobePopupValue('shelf', -1)">−</button>
            <span id="ws-shelf-count">${shelfCount}</span>
            <button onclick="adjustWardrobePopupValue('shelf', 1)">+</button>
          </div>
        </div>
        <div class="ws-counter-row" style="${shelfActive ? 'opacity:0.5;' : ''}">
          <span class="ws-counter-label" style="color:#b45309;">옷봉 (1개)</span>
          <div class="ws-counter-box" style="border-color:#f59e0b;background:#fef3c7;">
            <button onclick="adjustWardrobePopupValue('rod', -1)">−</button>
            <span id="ws-rod-count" style="color:#b45309;">${rodCount}</span>
            <button onclick="adjustWardrobePopupValue('rod', 1)">+</button>
          </div>
        </div>
      `;
          } else {
            // 하부장: (선반+서랍) OR 옷봉 (자동 전환)
            const rodActive = rodCount > 0;
            const shelfDrawerActive = shelfCount > 0 || drawerCount > 0;
            controlsHtml = `
        <div style="font-size:11px;color:#666;padding:8px;background:#fff7ed;border-radius:6px;margin-bottom:8px;">※ 선반/서랍↔옷봉 선택 시 반대 항목 자동 해제</div>
        <div class="ws-counter-row" style="${rodActive ? 'opacity:0.5;' : ''}">
          <span class="ws-counter-label">선반</span>
          <div class="ws-counter-box">
            <button onclick="adjustWardrobePopupValue('shelf', -1)">−</button>
            <span id="ws-shelf-count">${shelfCount}</span>
            <button onclick="adjustWardrobePopupValue('shelf', 1)">+</button>
          </div>
        </div>
        <div class="ws-counter-row" style="${rodActive ? 'opacity:0.5;' : ''}">
          <span class="ws-counter-label" style="color:#6366f1;">서랍 (300mm)</span>
          <div class="ws-counter-box" style="border-color:#6366f1;background:#eef2ff;">
            <button onclick="adjustWardrobePopupValue('drawer', -1)">−</button>
            <span id="ws-drawer-count" style="color:#6366f1;">${drawerCount}</span>
            <button onclick="adjustWardrobePopupValue('drawer', 1)">+</button>
          </div>
        </div>
        <div class="ws-counter-row" style="${shelfDrawerActive ? 'opacity:0.5;' : ''}">
          <span class="ws-counter-label" style="color:#b45309;">옷봉 (1개)</span>
          <div class="ws-counter-box" style="border-color:#f59e0b;background:#fef3c7;">
            <button onclick="adjustWardrobePopupValue('rod', -1)">−</button>
            <span id="ws-rod-count" style="color:#b45309;">${rodCount}</span>
            <button onclick="adjustWardrobePopupValue('rod', 1)">+</button>
          </div>
        </div>
      `;
          }
        }

        const popupHtml = `
    <div id="wardrobe-section-popup" class="ws-popup-overlay" onclick="if(event.target===this)closeWardrobeSectionPopup()">
      <div class="ws-popup">
        <div class="ws-popup-header" style="background:${sectionColor};">
          <span>🚪 ${mod.name} - ${sectionName} 설정</span>
          <button onclick="closeWardrobeSectionPopup()" class="ws-popup-close">✕</button>
        </div>
        <div class="ws-popup-body">
          <div class="ws-popup-preview">
            <svg width="${svgW}" height="${svgH}" style="background:#fafafa;border-radius:10px;border:1px solid #e5e7eb;">
              <text x="${svgW / 2}" y="20" text-anchor="middle" font-size="12" font-weight="bold" fill="#333">${sectionName} Front View</text>
              <rect x="${offsetX}" y="${offsetY}" width="${drawW}" height="${drawH}" fill="${sectionBg}" stroke="${sectionColor}" stroke-width="2" rx="4"/>
              ${contentSvg}
              <text x="${svgW / 2}" y="${offsetY + drawH + 20}" text-anchor="middle" font-size="10" fill="#666">${mod.w} × ${sectionH}mm</text>
            </svg>
          </div>
          <div class="ws-popup-controls">
            ${controlsHtml}
          </div>
        </div>
        <div class="ws-popup-footer">
          <button onclick="applyWardrobeSectionAndClose()" class="ws-popup-save-btn">완료</button>
        </div>
      </div>
    </div>
    <style>
      .ws-popup-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center}
      .ws-popup{background:white;border-radius:16px;width:420px;max-width:95vw;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
      .ws-popup-header{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;color:white;font-weight:700;font-size:14px}
      .ws-popup-close{background:none;border:none;color:white;font-size:20px;cursor:pointer}
      .ws-popup-body{display:flex;gap:20px;padding:20px}
      .ws-popup-preview{flex:0 0 auto}
      .ws-popup-controls{flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center}
      .ws-counter-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#f9fafb;border-radius:8px}
      .ws-counter-label{font-weight:700;font-size:12px;color:#374151}
      .ws-counter-box{display:flex;align-items:center;gap:8px;padding:6px 10px;border:2px solid #e5e7eb;border-radius:8px;background:white}
      .ws-counter-box button{width:28px;height:28px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-size:16px;font-weight:bold}
      .ws-counter-box button:hover{background:#f3f4f6}
      .ws-counter-box span{min-width:24px;text-align:center;font-weight:bold;font-size:16px}
      .ws-popup-footer{padding:14px 20px;border-top:1px solid #e5e7eb;background:#f9fafb;text-align:right}
      .ws-popup-save-btn{padding:10px 24px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer}
      .ws-popup-save-btn:hover{opacity:0.9}
    </style>
  `;
        document.body.insertAdjacentHTML('beforeend', popupHtml);
      }

      function adjustWardrobePopupValue(type, delta) {
        const item = selectedItems.find((i) => i.uniqueId === currentWardrobePopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentWardrobePopup.modId);
        if (!mod) return;
        const section = currentWardrobePopup.section;
        const isShelfType = mod.moduleType === 'shelf';

        if (type === 'shelf') {
          if (section === 'upper') {
            mod.shelfCountUpper = Math.max(0, Math.min(6, (mod.shelfCountUpper || 0) + delta));
            // 선반형 상부장: 선반 추가시 옷봉 제거
            if (isShelfType && mod.shelfCountUpper > 0) mod.rodCountUpper = 0;
          } else if (section === 'full') {
            mod.shelfCount = Math.max(0, Math.min(6, (mod.shelfCount || 0) + delta));
          } else {
            mod.shelfCountLower = Math.max(0, Math.min(6, (mod.shelfCountLower || 0) + delta));
            // 선반형 하부장: 선반/서랍 추가시 옷봉 제거
            if (isShelfType && mod.shelfCountLower > 0) mod.rodCountLower = 0;
          }
        } else if (type === 'rod') {
          if (section === 'upper') {
            mod.rodCountUpper = Math.max(0, Math.min(1, (mod.rodCountUpper || 0) + delta));
            // 선반형 상부장: 옷봉 추가시 선반 제거
            if (isShelfType && mod.rodCountUpper > 0) mod.shelfCountUpper = 0;
          } else if (section !== 'full') {
            mod.rodCountLower = Math.max(0, Math.min(1, (mod.rodCountLower || 0) + delta));
            // 선반형 하부장: 옷봉 추가시 선반/서랍 제거
            if (isShelfType && mod.rodCountLower > 0) {
              mod.shelfCountLower = 0;
              mod.drawerCount = 0;
            }
          }
        } else if (type === 'drawer') {
          mod.drawerCount = Math.max(0, Math.min(6, (mod.drawerCount || 0) + delta));
          // 선반형 하부장: 서랍 추가시 옷봉 제거
          if (isShelfType && section === 'lower' && mod.drawerCount > 0) {
            mod.rodCountLower = 0;
          }
        }

        renderWardrobeSectionPopup(item, mod, section);
      }

      function closeWardrobeSectionPopup() {
        const popup = document.getElementById('wardrobe-section-popup');
        if (popup) popup.remove();

        // 메인 프론트뷰도 업데이트
        const item = selectedItems.find((i) => i.uniqueId === currentWardrobePopup.itemId);
        if (item) renderWorkspaceContent(item);

        currentWardrobePopup = { itemId: null, modId: null, section: null };
      }

      function applyWardrobeSectionAndClose() {
        const popup = document.getElementById('wardrobe-section-popup');
        if (popup) popup.remove();

        const item = selectedItems.find((i) => i.uniqueId === currentWardrobePopup.itemId);
        if (item) renderWorkspaceContent(item);

        currentWardrobePopup = { itemId: null, modId: null, section: null };
      }

      // ★ 서랍 외부형/내부형 토글 함수
      function toggleWardrobeDrawerType(itemUniqueId, modId, isExternal) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod.isExternalDrawer = isExternal;
          renderWorkspaceContent(item);
        }
      }

      // ★ 마감 타입 변경 함수 (EP 선택 시 길이 20으로 고정)
      function updateWardrobeFinishType(itemUniqueId, side, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        // 타입에 따른 기본 너비: 몰딩 60, 휠라 60, EP 20, 없음 0
        const defaultWidths = { Molding: 60, Filler: 60, EP: 20, None: 0 };
        const defaultWidth = defaultWidths[value] || 0;

        item.specs[`finish${side}Type`] = value;
        item.specs[`finish${side}Width`] = defaultWidth;

        // ★ 유효공간 자동 재계산
        recalcWardrobeEffectiveW(item);

        // 스크롤 위치 저장 후 렌더링
        const specPanel = document.querySelector('.spec-panel');
        const scrollTop = specPanel ? specPanel.scrollTop : 0;
        renderWorkspaceContent(item);
        const newSpecPanel = document.querySelector('.spec-panel');
        if (newSpecPanel) newSpecPanel.scrollTop = scrollTop;
      }

      // ★ 유효공간 자동 재계산 함수
      function recalcWardrobeEffectiveW(item) {
        const W = parseFloat(item.w) || 0;
        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const fR = item.specs.finishRightType !== 'None' ? parseFloat(item.specs.finishRightWidth) || 0 : 0;
        item.specs.wardrobeEffectiveW = W - fL - fR;
      }

      function updateWardrobeSpec(itemUniqueId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs[field] = isNaN(parseFloat(value)) ? value : parseFloat(value);

        // ★ 마감 길이 변경 시 유효공간 재계산
        if (field === 'finishLeftWidth' || field === 'finishRightWidth') {
          recalcWardrobeEffectiveW(item);
        }

        renderWorkspaceContent(item);
      }

      // 붙박이장 도어 표시 토글
      // ★ 붙박이장 뷰 전환
      function switchWardrobeView(itemUniqueId, mode) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs.wardrobeViewMode = mode;
        renderWorkspaceContent(item);
      }

      // ★ 붙박이장 Top View (위에서 내려다보기)
      function renderWardrobeTopView(item, wardrobeModules) {
        const W = parseFloat(item.w) || 2400;
        const D = parseFloat(item.d) || 600;
        const fL = item.specs.finishLeftType !== 'None' ? (parseFloat(item.specs.finishLeftWidth) || 0) : 0;
        const fR = item.specs.finishRightType !== 'None' ? (parseFloat(item.specs.finishRightWidth) || 0) : 0;

        const svgW = 620, pad = 50;
        const scale = (svgW - pad * 2) / W;
        const drawD = D * scale;
        const svgH = pad + drawD + 60 + pad;
        let svg = '';
        const ox = pad;
        const oy = pad;

        // 라벨
        svg += `<text x="${ox - 5}" y="${oy - 8}" font-size="11" fill="#333" font-weight="bold">붙박이장</text>`;
        svg += `<text x="${ox + 55}" y="${oy - 8}" font-size="9" fill="#999">(깊이 ${D}mm)</text>`;

        // 전체 외곽
        svg += `<rect x="${ox}" y="${oy}" width="${W*scale}" height="${drawD}" fill="#f8f9fa" stroke="#999" stroke-width="1.5"/>`;

        // 전체 치수선 — 상단
        svg += `<line x1="${ox}" y1="${oy - 15}" x2="${ox + W*scale}" y2="${oy - 15}" stroke="#666" stroke-width="1"/>`;
        svg += `<line x1="${ox}" y1="${oy - 20}" x2="${ox}" y2="${oy - 10}" stroke="#666"/>`;
        svg += `<line x1="${ox + W*scale}" y1="${oy - 20}" x2="${ox + W*scale}" y2="${oy - 10}" stroke="#666"/>`;
        svg += `<text x="${ox + W*scale/2}" y="${oy - 22}" text-anchor="middle" font-size="11" fill="#333" font-weight="bold">${W}mm</text>`;

        // 좌측 마감
        if (fL > 0) {
          svg += `<rect x="${ox}" y="${oy}" width="${fL*scale}" height="${drawD}" fill="#e8e8e8" stroke="#aaa" stroke-width="1"/>`;
          svg += `<text x="${ox + fL*scale/2}" y="${oy + drawD/2 + 3}" text-anchor="middle" font-size="8" fill="#888">마감 ${fL}</text>`;
        }

        // 우측 마감
        if (fR > 0) {
          const rx = ox + (W - fR) * scale;
          svg += `<rect x="${rx}" y="${oy}" width="${fR*scale}" height="${drawD}" fill="#e8e8e8" stroke="#aaa" stroke-width="1"/>`;
          svg += `<text x="${rx + fR*scale/2}" y="${oy + drawD/2 + 3}" text-anchor="middle" font-size="8" fill="#888">마감 ${fR}</text>`;
        }

        // 모듈 배치
        let mx = ox + fL * scale;
        for (const mod of wardrobeModules) {
          const mw = (parseFloat(mod.w) || 600) * scale;
          const modType = mod.moduleType || mod.type || 'short';
          const fill = modType === 'long' ? '#e8f0fe' : modType === 'shelf' ? '#fef9e7' : '#f0f0f0';
          const label = modType === 'long' ? '긴옷' : modType === 'shelf' ? '선반' : '짧은옷';

          svg += `<rect x="${mx}" y="${oy}" width="${mw}" height="${drawD}" fill="${fill}" stroke="#666" stroke-width="1"/>`;
          svg += `<text x="${mx + mw/2}" y="${oy + drawD/2 + 3}" text-anchor="middle" font-size="9" fill="#333">${label}</text>`;

          // 모듈 치수
          svg += `<text x="${mx + mw/2}" y="${oy + drawD + 14}" text-anchor="middle" font-size="8" fill="#666">${mod.w || ''}mm</text>`;

          mx += mw;
        }

        // 모듈별 치수선 — 하단
        if (wardrobeModules.length > 0) {
          mx = ox + fL * scale;
          const dimY = oy + drawD + 22;
          for (const mod of wardrobeModules) {
            const mw = (parseFloat(mod.w) || 600) * scale;
            svg += `<line x1="${mx}" y1="${dimY}" x2="${mx + mw}" y2="${dimY}" stroke="#666" stroke-width="0.8"/>`;
            svg += `<line x1="${mx}" y1="${dimY - 4}" x2="${mx}" y2="${dimY + 4}" stroke="#666"/>`;
            svg += `<line x1="${mx + mw}" y1="${dimY - 4}" x2="${mx + mw}" y2="${dimY + 4}" stroke="#666"/>`;
            mx += mw;
          }
        }

        return `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" style="background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;">${svg}</svg>`;
      }

      function toggleWardrobeDoors(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (!item.specs) item.specs = {};
        item.specs.showDoors = !item.specs.showDoors;
        renderWorkspaceContent(item);
      }

      // ★ 유효공간 직접 수정 함수
      function updateWardrobeEffectiveW(itemUniqueId, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const newValue = parseFloat(value);
        if (!isNaN(newValue) && newValue > 0) {
          item.specs.wardrobeEffectiveW = newValue;
        } else {
          // 빈 값이면 자동 계산 모드로 복귀
          delete item.specs.wardrobeEffectiveW;
        }
        renderWorkspaceContent(item);
      }

      function runWardrobeAutoCalc(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const W = parseFloat(item.w) || 0;
        const H = parseFloat(item.h) || 0;
        const D = parseFloat(item.d) || 600;

        // ★ 높이 계산: (전체높이 - 좌대 - 상몰딩)
        const pedestalH = parseFloat(item.specs.wardrobePedestal) || 60;
        const moldingH = parseFloat(item.specs.wardrobeMoldingH) || 15;
        const effectiveH = H - pedestalH - moldingH;
        const halfH = Math.floor(effectiveH / 2); // 상부장/하부장 각각 (내림)

        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const fR = item.specs.finishRightType !== 'None' ? parseFloat(item.specs.finishRightWidth) || 0 : 0;
        // ★ 유효공간: 직접 입력값 우선, 없으면 자동 계산
        const effectiveW = item.specs.wardrobeEffectiveW || W - fL - fR;

        if (effectiveW <= 0) {
          alert('유효 공간이 부족합니다.');
          return;
        }

        const handleType = item.specs.handleType || 'bar';
        const SMARTBAR_WIDTH = 30; // 스마트바 너비
        const TARGET_DOOR_WIDTH = 480; // 목표 도어 너비
        const TOLERANCE = 10; // 시공 여유공간

        item.modules = item.modules.filter((m) => m.pos !== 'wardrobe');

        // ★ 모듈 타입 기본값 함수 (업데이트: 2통/3통/4통/반통 규칙)
        const getModuleTypeDefaults = (modules2DCount, modules1DCount, idx, is2D) => {
          // 반통(1D)만 있는 경우: 선반형
          if (!is2D) {
            return { type: 'shelf', name: '선반형', isDivided: true };
          }

          // 2통 (2D, 2D): 짧은옷(2단), 긴옷(1단)
          if (modules2DCount === 2 && modules1DCount === 0) {
            if (idx === 0) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 1) return { type: 'long', name: '긴옷(1단)', isDivided: false };
          }

          // 3통 (2D, 2D, 2D): 짧은옷(2단), 짧은옷(2단), 긴옷(1단)
          if (modules2DCount === 3 && modules1DCount === 0) {
            if (idx === 0) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 1) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 2) return { type: 'long', name: '긴옷(1단)', isDivided: false };
          }

          // 4통 (2D, 2D, 2D, 2D): 짧은옷(2단), 짧은옷(2단), 긴옷(1단), 선반형
          if (modules2DCount === 4 && modules1DCount === 0) {
            if (idx === 0) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 1) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 2) return { type: 'long', name: '긴옷(1단)', isDivided: false };
            if (idx === 3) return { type: 'shelf', name: '선반형', isDivided: true };
          }

          // 2D + 1D 조합: 마지막 1D는 선반형
          if (modules2DCount === 2 && modules1DCount === 1) {
            // 2D, 2D, 1D: 짧은옷, 긴옷, 선반
            if (idx === 0) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 1) return { type: 'long', name: '긴옷(1단)', isDivided: false };
          }

          if (modules2DCount === 3 && modules1DCount === 1) {
            // 2D, 2D, 2D, 1D: 짧은옷, 짧은옷, 긴옷, 선반
            if (idx === 0) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 1) return { type: 'short', name: '짧은옷(2단)', isDivided: true };
            if (idx === 2) return { type: 'long', name: '긴옷(1단)', isDivided: false };
          }

          // 기본값
          return { type: 'short', name: '짧은옷(2단)', isDivided: true };
        };

        // ★ 붙박이장 전용: 3통 반(7 doors) 기본 설정
        const WARDROBE_TARGET_DOORS = 7; // 3.5통 = 3×2D + 1×1D
        const WARDROBE_DOOR_MIN = 300; // 붙박이장 최소 도어 너비
        const WARDROBE_DOOR_MAX = 600; // 붙박이장 최대 도어 너비

        if (handleType === 'smartbar') {
          // ★ 스마트바 모드: 3.5통(7 doors) 기본

          // 1. 총 도어 수 결정 (3.5통 기본, 너비에 따라 조정)
          const calcSmartbarDoorW = (doors) => {
            const mods = Math.floor(doors / 2) + (doors % 2);
            return Math.floor((effectiveW - mods * SMARTBAR_WIDTH) / doors);
          };
          let totalDoors = WARDROBE_TARGET_DOORS;
          while (calcSmartbarDoorW(totalDoors) < WARDROBE_DOOR_MIN && totalDoors > 2) totalDoors--;
          while (calcSmartbarDoorW(totalDoors) > WARDROBE_DOOR_MAX) totalDoors++;

          if (totalDoors <= 0) {
            alert('공간이 너무 작습니다.');
            return;
          }

          // 2. 모듈 조합 결정 (2D 우선)
          const modules2D = Math.floor(totalDoors / 2);
          const modules1D = totalDoors % 2;
          const totalModules = modules2D + modules1D;

          // 3. 스마트바 총 너비
          const smartbarTotal = totalModules * SMARTBAR_WIDTH;

          // 4. 도어 공간 균등분배 (★ 모든 도어 동일 너비)
          const doorSpace = effectiveW - smartbarTotal;
          const doorWidth = Math.floor(doorSpace / totalDoors); // 균등 도어 너비
          const usedDoorSpace = doorWidth * totalDoors;
          const remainder = doorSpace - usedDoorSpace; // 여유공간 (시공 여유)

          // 5. 모듈 생성 (모든 도어 동일 너비)
          let doorIdx = 0;

          // 2D 모듈들
          for (let i = 0; i < modules2D; i++) {
            const modWidth = doorWidth * 2 + SMARTBAR_WIDTH;
            const typeDefaults = getModuleTypeDefaults(modules2D, modules1D, i, true);

            item.modules.push({
              id: Date.now() + i,
              type: 'wardrobe',
              name: typeDefaults.name,
              pos: 'wardrobe',
              w: modWidth,
              doorCount: 2,
              doorWidth: doorWidth,
              hasSmartbar: true,
              h: effectiveH,
              upperH: halfH,
              lowerH: halfH,
              d: D,
              moduleType: typeDefaults.type,
              isDivided: typeDefaults.isDivided,
              drawerCount: typeDefaults.type === 'long' ? 1 : 0,
              shelfCount: typeDefaults.type === 'long' ? 1 : 0,
              shelfCountUpper: typeDefaults.type === 'shelf' ? 2 : 0,
              shelfCountLower: typeDefaults.type === 'shelf' ? 2 : 0,
              hasMirror: false,
              isExternalDrawer: false,
            });
          }

          // 1D 모듈 (있으면)
          if (modules1D > 0) {
            const modWidth = doorWidth + SMARTBAR_WIDTH;
            const typeDefaults = getModuleTypeDefaults(modules2D, modules1D, 0, false);

            item.modules.push({
              id: Date.now() + modules2D,
              type: 'wardrobe',
              name: typeDefaults.name,
              pos: 'wardrobe',
              w: modWidth,
              doorCount: 1,
              doorWidth: doorWidth,
              hasSmartbar: true,
              h: effectiveH,
              upperH: halfH,
              lowerH: halfH,
              d: D,
              moduleType: typeDefaults.type,
              isDivided: typeDefaults.isDivided,
              drawerCount: 0,
              shelfCount: 0,
              shelfCountUpper: typeDefaults.type === 'shelf' ? 2 : 0,
              shelfCountLower: typeDefaults.type === 'shelf' ? 2 : 0,
              hasMirror: false,
              isExternalDrawer: false,
            });
          }

          // 검증 로그
          const totalWidth = item.modules.filter((m) => m.pos === 'wardrobe').reduce((sum, m) => sum + m.w, 0);
          console.log(`스마트바 계산: 도어너비=${doorWidth}mm, 모듈합=${totalWidth}mm, 여유공간=${remainder}mm`);

          if (remainder > TOLERANCE) {
            console.warn(`시공 여유공간 초과: ${remainder}mm (허용: ${TOLERANCE}mm)`);
          }
        } else {
          // ★ 일반 모드: 붙박이장 전용 3.5통(7 doors) 기본
          let targetDoors = WARDROBE_TARGET_DOORS;
          let doorW = Math.floor(effectiveW / targetDoors);

          // 도어 너비 범위에 따라 도어 수 조정
          while (doorW < WARDROBE_DOOR_MIN && targetDoors > 2) {
            targetDoors--;
            doorW = Math.floor(effectiveW / targetDoors);
          }
          while (doorW > WARDROBE_DOOR_MAX) {
            targetDoors++;
            doorW = Math.floor(effectiveW / targetDoors);
          }

          // 짝수 정렬 (미관)
          doorW = Math.floor(doorW / 2) * 2;

          const modules2DCount = Math.floor(targetDoors / 2);
          const modules1DCount = targetDoors % 2;

          // 2D 모듈 생성
          for (let i = 0; i < modules2DCount; i++) {
            const typeDefaults = getModuleTypeDefaults(modules2DCount, modules1DCount, i, true);
            item.modules.push({
              id: Date.now() + i,
              type: 'wardrobe',
              name: typeDefaults.name,
              pos: 'wardrobe',
              w: doorW * 2,
              doorCount: 2,
              h: effectiveH,
              upperH: halfH,
              lowerH: halfH,
              d: D,
              moduleType: typeDefaults.type,
              isDivided: typeDefaults.isDivided,
              drawerCount: typeDefaults.type === 'long' ? 1 : 0,
              shelfCount: typeDefaults.type === 'long' ? 1 : 0,
              shelfCountUpper: typeDefaults.type === 'shelf' ? 2 : 0,
              shelfCountLower: typeDefaults.type === 'shelf' ? 2 : 0,
              hasMirror: false,
              isExternalDrawer: false,
            });
          }

          // 1D 모듈 생성 (있으면)
          if (modules1DCount > 0) {
            const typeDefaults = getModuleTypeDefaults(modules2DCount, modules1DCount, 0, false);
            item.modules.push({
              id: Date.now() + modules2DCount,
              type: 'wardrobe',
              name: typeDefaults.name,
              pos: 'wardrobe',
              w: doorW,
              doorCount: 1,
              h: effectiveH,
              upperH: halfH,
              lowerH: halfH,
              d: D,
              moduleType: typeDefaults.type,
              isDivided: typeDefaults.isDivided,
              drawerCount: 0,
              shelfCount: 0,
              shelfCountUpper: typeDefaults.type === 'shelf' ? 2 : 0,
              shelfCountLower: typeDefaults.type === 'shelf' ? 2 : 0,
              hasMirror: false,
              isExternalDrawer: false,
            });
          }

          console.log(`붙박이장 자동계산: ${modules2DCount}×2D + ${modules1DCount}×1D = ${targetDoors}doors (${modules2DCount + modules1DCount * 0.5}통)`);
        }

        renderWorkspaceContent(item);
      }

      function onEffectiveSpaceBlur(itemUniqueId, section, inputEl) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const value = inputEl.value.trim();
        if (section === 'upper') item.specs.effectiveUpperW = value === '' ? null : parseFloat(value);
        else item.specs.effectiveLowerW = value === '' ? null : parseFloat(value);

        renderWorkspaceContent(item);
      }

      function onDishwasherChange(itemUniqueId, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        item.specs.dishwasher = value;
        if (value === 'BuiltIn' || value === 'FreeStanding') {
          item.specs.sinkLegHeight = 120;
        }
        renderWorkspaceContent(item);
      }

      // ── 레거시 호환: 기존 changeLayoutShape → changeLowerLayoutShape 위임
      function changeLayoutShape(itemUniqueId, shape) {
        changeLowerLayoutShape(itemUniqueId, shape);
      }

      // ── 하부장 구조 변경
      function changeLowerLayoutShape(itemUniqueId, shape) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs.lowerLayoutShape = shape;
        item.specs.layoutShape = shape; // 레거시 호환
        // 상판 크기 배열 확장
        const count = shape === 'U' ? 3 : shape === 'L' ? 2 : 1;
        while (item.specs.topSizes.length < count) {
          item.specs.topSizes.push({ w: '', d: '' });
        }
        // Secondary/Tertiary 기본값
        if (shape !== 'I' && !item.specs.lowerSecondaryW) {
          item.specs.lowerSecondaryW = '1800'; // 기본 1800mm
        }
        if (shape !== 'I' && !item.specs.lowerSecondaryD) {
          item.specs.lowerSecondaryD = item.defaultD || item.d || '';
        }
        // ㄱ자: 멍장(blind corner) 자동 삽입 — secondary line 시작 모듈
        if (shape === 'L' || shape === 'U') {
          const startSide = item.specs.secondaryStartSide || 'left';
          const hasBlind = item.modules.some(m => m.name === 'LT망장' && m.pos === 'lower');
          if (!hasBlind) {
            const specLowerH = parseFloat(item.specs.lowerH) || 870;
            const specLegH = parseFloat(item.specs.sinkLegHeight) || 150;
            const specTopT = parseFloat(item.specs.topThickness) || 12;
            const blindMod = {
              id: Date.now() + Math.random(),
              type: 'storage', name: 'LT망장', pos: 'lower',
              w: parseFloat(item.specs.lowerSecondaryD) || parseFloat(item.d) || 600,
              h: specLowerH - specTopT - specLegH,
              d: parseFloat(item.d) || 550,
              isDrawer: true, isFixed: true,
              orientation: 'secondary',
            };
            if (startSide === 'left') {
              item.modules.unshift(blindMod);
            } else {
              // 하부장 마지막에 추가
              const lastLowerIdx = item.modules.reduce((last, m, i) => m.pos === 'lower' ? i : last, -1);
              item.modules.splice(lastLowerIdx + 1, 0, blindMod);
            }
          }
        }
        if (shape === 'U') {
          if (!item.specs.lowerTertiaryW) item.specs.lowerTertiaryW = item.specs.lowerSecondaryW || '1800';
          if (!item.specs.lowerTertiaryD) item.specs.lowerTertiaryD = item.defaultD || item.d || '';
          if (!item.specs.upperTertiaryW) item.specs.upperTertiaryW = item.specs.upperSecondaryW || '';
          if (!item.specs.upperTertiaryD) item.specs.upperTertiaryD = item.specs.upperSecondaryD || '';
          if (!item.specs.tertiaryStartFrom) item.specs.tertiaryStartFrom = 'prime';
        }
        if (shape === 'I') {
          item.specs.lowerSecondaryW = '';
          item.specs.lowerSecondaryH = '';
          item.specs.lowerSecondaryD = '';
          item.specs.lowerTertiaryW = '';
          item.specs.lowerTertiaryH = '';
          item.specs.lowerTertiaryD = '';
          item.specs.upperTertiaryW = '';
          item.specs.upperTertiaryH = '';
          item.specs.upperTertiaryD = '';
        }
        // 통합 모드: 상부장도 동일 구조로 동기화
        if (item.specs.dimensionMode === 'unified') {
          item.specs.upperLayoutShape = shape;
          if (shape !== 'I' && !item.specs.upperSecondaryW) {
            item.specs.upperSecondaryW = '1800';
          }
          if (shape !== 'I' && !item.specs.upperSecondaryD) {
            item.specs.upperSecondaryD = '295';
          }
          if (shape === 'U') {
            if (!item.specs.upperTertiaryW) item.specs.upperTertiaryW = item.specs.upperSecondaryW || '1800';
            if (!item.specs.upperTertiaryD) item.specs.upperTertiaryD = item.specs.upperSecondaryD || '295';
          }
        }
        updateUI();
        renderWorkspaceContent(item);
        // 3D 플래너에도 반영
        if (typeof _syncPlannerState === 'function') _syncPlannerState(item);
      }

      // ── 상부장 구조 변경 (분리 모드 전용)
      function changeUpperLayoutShape(itemUniqueId, shape) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs.upperLayoutShape = shape;
        if (shape !== 'I' && !item.specs.upperSecondaryD) {
          item.specs.upperSecondaryD = '295';
        }
        if (shape !== 'I' && !item.specs.upperSecondaryW) {
          item.specs.upperSecondaryW = '1800'; // 기본 1800mm
        }
        if (shape === 'U') {
          if (!item.specs.upperTertiaryW) item.specs.upperTertiaryW = item.specs.upperSecondaryW || '1800';
          if (!item.specs.upperTertiaryD) item.specs.upperTertiaryD = item.specs.upperSecondaryD || '295';
        }
        if (shape === 'I') {
          item.specs.upperSecondaryW = '';
          item.specs.upperSecondaryH = '';
          item.specs.upperSecondaryD = '';
        }
        updateUI();
        renderWorkspaceContent(item);
      }

      // ── 통합/분리 모드 전환
      function toggleDimensionMode(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (item.specs.dimensionMode === 'unified') {
          // 통합 → 분리: 공유값을 상부장에 복사
          item.specs.dimensionMode = 'split';
          item.specs.upperPrimeW = item.specs.upperPrimeW || item.w;
          item.specs.upperLayoutShape = item.specs.upperLayoutShape || item.specs.lowerLayoutShape;
        } else {
          // 분리 → 통합: 하부장 기준으로 통합
          item.specs.dimensionMode = 'unified';
        }
        updateUI();
      }

      // ── Secondary Line 통합/분리 전환
      function toggleSecondaryDimensionMode(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (item.specs.secondaryDimensionMode === 'split') {
          // 분리 → 통합: 가로를 하부장 기준으로 통합
          item.specs.secondaryDimensionMode = 'unified';
          item.specs.upperSecondaryW = item.specs.lowerSecondaryW;
        } else {
          // 통합 → 분리: 공유 가로를 상부장에 복사
          item.specs.secondaryDimensionMode = 'split';
          item.specs.upperSecondaryW = item.specs.upperSecondaryW || item.specs.lowerSecondaryW;
        }
        updateUI();
      }

      // ── 세부 설정 팝업 ──
      function openSpecPopup(itemUniqueId, section) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        const popup = document.getElementById(`spec-popup-${itemUniqueId}`);
        const title = document.getElementById(`spec-popup-title-${itemUniqueId}`);
        const body = document.getElementById(`spec-popup-body-${itemUniqueId}`);
        if (!popup || !body) return;

        const uid = itemUniqueId;
        const titles = { dimensions: '📏 모듈 치수', hardware: '🔧 Hardware', colors: '🎨 도어 색상', countertop: '🪨 상판', finish: '✂️ 마감' };
        title.textContent = titles[section] || section;

        const shapes = { I: 'ㅡ자형 (1개)', L: 'ㄱ자형 (2개)', U: 'ㄷ자형 (3개)' };
        const topCount = (item.specs.layoutShape === 'U' || item.specs.lowerLayoutShape === 'U') ? 3 : (item.specs.layoutShape === 'L' || item.specs.lowerLayoutShape === 'L') ? 2 : 1;
        let topSizeInputs = '';
        for (let i = 0; i < topCount; i++) {
          const ts = item.specs.topSizes[i] || { w: '', d: '' };
          const label = topCount > 1 ? `#${i + 1} ` : '';
          topSizeInputs += `<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;"><span style="font-size:11px;color:#888;min-width:20px;">${label}</span><input type="number" placeholder="길이(W)" value="${ts.w || ''}" onchange="updateTopSizeDim(${uid},${i},'w',this.value)" style="flex:1;min-width:0;"><span style="font-size:11px;color:#999;">×</span><input type="number" placeholder="폭(D)" value="${ts.d || ''}" onchange="updateTopSizeDim(${uid},${i},'d',this.value)" style="flex:1;min-width:0;"></div>`;
        }

        const accHtml = (item.specs.accessories || []).map(acc => `<div class="acc-item"><select style="flex:1;" onchange="updateAccessory(${uid},${acc.id},this.value)"><option value="LTMesh" ${acc.type==='LTMesh'?'selected':''}>LT망장</option><option value="CircleMesh" ${acc.type==='CircleMesh'?'selected':''}>원망장</option><option value="Cutlery" ${acc.type==='Cutlery'?'selected':''}>수저분리함</option><option value="Knife" ${acc.type==='Knife'?'selected':''}>칼꽂이</option><option value="DishRack" ${acc.type==='DishRack'?'selected':''}>식기건조대</option><option value="Etc" ${acc.type==='Etc'?'selected':''}>기타</option></select><button class="btn-del-acc" onclick="removeAccessory(${uid},${acc.id})">×</button></div>`).join('');

        const cornerHtml = (() => {
          const ls = item.specs.lowerLayoutShape || item.specs.layoutShape || 'I';
          if (ls === 'L') return `<div class="spec-row"><div class="spec-field"><label>코너 마감</label><select onchange="updateSpecNoRender(${uid},'finishCorner1Type',this.value)"><option value="Molding" ${item.specs.finishCorner1Type==='Molding'?'selected':''}>몰딩</option><option value="Filler" ${item.specs.finishCorner1Type==='Filler'?'selected':''}>휠라</option></select></div><div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishCorner1Width}" onchange="updateSpecValue(${uid},'finishCorner1Width',this.value)"></div></div>`;
          if (ls === 'U') return `<div class="spec-row"><div class="spec-field"><label>코너1</label><select onchange="updateSpecNoRender(${uid},'finishCorner1Type',this.value)"><option value="Molding" ${item.specs.finishCorner1Type==='Molding'?'selected':''}>몰딩</option><option value="Filler" ${item.specs.finishCorner1Type==='Filler'?'selected':''}>휠라</option></select></div><div class="spec-field"><label>길이</label><input type="number" value="${item.specs.finishCorner1Width}" onchange="updateSpecValue(${uid},'finishCorner1Width',this.value)"></div></div><div class="spec-row"><div class="spec-field"><label>코너2</label><select onchange="updateSpecNoRender(${uid},'finishCorner2Type',this.value)"><option value="Molding" ${item.specs.finishCorner2Type==='Molding'?'selected':''}>몰딩</option><option value="Filler" ${item.specs.finishCorner2Type==='Filler'?'selected':''}>휠라</option></select></div><div class="spec-field"><label>길이</label><input type="number" value="${item.specs.finishCorner2Width}" onchange="updateSpecValue(${uid},'finishCorner2Width',this.value)"></div></div>`;
          return '';
        })();

        const contents = {
          dimensions: `
            <div class="spec-row"><div class="spec-field"><label>하부장 높이</label><input type="number" value="${item.specs.lowerH}" onchange="updateSpecValue(${uid},'lowerH',this.value)"></div><div class="spec-field"><label>상부장 높이</label><input type="number" value="${item.specs.upperH}" onchange="updateSpecValue(${uid},'upperH',this.value)"></div></div>
            <div class="spec-row"><div class="spec-field"><label>상부 도어 오버랩</label><input type="number" value="${item.specs.upperDoorOverlap}" onchange="updateSpecValue(${uid},'upperDoorOverlap',this.value)"></div><div class="spec-field"><label>다리발 높이</label><select onchange="updateSpec(${uid},'sinkLegHeight',this.value)"><option value="120" ${item.specs.sinkLegHeight==120?'selected':''}>120mm</option><option value="150" ${item.specs.sinkLegHeight==150?'selected':''}>150mm</option></select></div></div>`,
          hardware: `
            <div class="spec-row"><div class="spec-field"><label>손잡이</label><select onchange="updateSpec(${uid},'handle',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('handle',item.specs.handle,'sink')}</select></div><div class="spec-field"><label>씽크볼</label><select onchange="updateSpec(${uid},'sink',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('sink',item.specs.sink)}</select></div></div>
            <div class="spec-row"><div class="spec-field"><label>수전</label><select onchange="updateSpec(${uid},'faucet',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('faucet',item.specs.faucet)}</select></div><div class="spec-field"><label>후드</label><select onchange="updateSpec(${uid},'hood',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('hood',item.specs.hood)}</select></div></div>
            <div class="spec-row"><div class="spec-field"><label>쿡탑</label><select onchange="updateSpec(${uid},'cooktop',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('cooktop',item.specs.cooktop)}</select></div><div class="spec-field"><label>식기세척기</label><select onchange="onDishwasherChange(${uid},this.value)"><option value="None" ${item.specs.dishwasher==='None'?'selected':''}>없음</option><option value="BuiltIn" ${item.specs.dishwasher==='BuiltIn'?'selected':''}>빌트인</option><option value="FreeStanding" ${item.specs.dishwasher==='FreeStanding'?'selected':''}>프리스탠딩</option></select></div></div>
            <div class="spec-row"><div class="spec-field"><label>액세서리</label><div class="acc-list">${accHtml}</div><button class="btn-add-acc" onclick="addAccessory(${uid})">+ 액세서리 추가</button></div></div>`,
          colors: `
            <div class="spec-row"><div class="spec-field"><label>상부장 도어</label><div class="color-select-row"><select onchange="updateSpec(${uid},'doorFinishUpper',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_finish',item.specs.doorFinishUpper,'sink')}</select><select onchange="updateSpec(${uid},'doorColorUpper',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_color',item.specs.doorColorUpper,'sink')}</select></div></div></div>
            <div class="spec-row"><div class="spec-field"><label>하부장 도어</label><div class="color-select-row"><select onchange="updateSpec(${uid},'doorFinishLower',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_finish',item.specs.doorFinishLower,'sink')}</select><select onchange="updateSpec(${uid},'doorColorLower',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_color',item.specs.doorColorLower,'sink')}</select></div></div></div>`,
          countertop: `
            <div class="spec-row"><div class="spec-field"><label>상판 색상</label><select onchange="updateSpec(${uid},'topColor',this.value)">${FurnitureOptionCatalog.buildOptionsHtml('countertop',item.specs.topColor)}</select></div><div class="spec-field"><label>상판 두께(T)</label><input type="number" value="${item.specs.topThickness}" onchange="updateSpecValue(${uid},'topThickness',this.value)"></div></div>
            <div class="spec-row"><div class="spec-field"><label>상판 크기 (${shapes[item.specs.layoutShape || item.specs.lowerLayoutShape || 'I']})</label>${topSizeInputs}</div></div>`,
          finish: `
            <div class="spec-row"><div class="spec-field"><label>상몰딩 높이</label><input type="number" value="${item.specs.moldingH}" onchange="updateSpecValue(${uid},'moldingH',this.value)"></div></div>
            <div class="spec-row"><div class="spec-field"><label>좌측 마감</label><select onchange="updateFinishType(${uid},'Left',this.value)"><option value="Molding" ${item.specs.finishLeftType==='Molding'?'selected':''}>몰딩</option><option value="Filler" ${item.specs.finishLeftType==='Filler'?'selected':''}>휠라</option><option value="EP" ${item.specs.finishLeftType==='EP'?'selected':''}>EP</option><option value="None" ${item.specs.finishLeftType==='None'?'selected':''}>없음</option></select></div><div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishLeftWidth}" onchange="updateSpecValue(${uid},'finishLeftWidth',this.value)"></div></div>
            <div class="spec-row"><div class="spec-field"><label>우측 마감</label><select onchange="updateFinishType(${uid},'Right',this.value)"><option value="Molding" ${item.specs.finishRightType==='Molding'?'selected':''}>몰딩</option><option value="Filler" ${item.specs.finishRightType==='Filler'?'selected':''}>휠라</option><option value="EP" ${item.specs.finishRightType==='EP'?'selected':''}>EP</option><option value="None" ${item.specs.finishRightType==='None'?'selected':''}>없음</option></select></div><div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishRightWidth}" onchange="updateSpecValue(${uid},'finishRightWidth',this.value)"></div></div>
            ${cornerHtml}`,
        };

        body.innerHTML = contents[section] || '';
        popup.style.display = 'flex';
      }

      function closeSpecPopup(itemUniqueId) {
        const popup = document.getElementById(`spec-popup-${itemUniqueId}`);
        if (popup) popup.style.display = 'none';
        // 팝업 닫을 때 고정 모듈 재배치 + 리렌더
        repositionFixedModules(itemUniqueId);
      }

      // ── Front View 모듈 클릭 → 치수 편집 팝업 ──
      // ★ 선택 모듈 상태 (뷰 동기화용)
      window._selectedModuleIndex = null;

      function handleFrontViewClick(event, itemUniqueId) {
        // 모듈 클릭 팝업 비활성화 — 3D planner로 전환
        return;
      }

      // ★ 선택 모듈 하이라이트 — 모든 뷰(Front/Top/ISO)에서 동기화
      function highlightSelectedModule(itemUniqueId) {
        const ws = document.getElementById('designWorkspace');
        if (!ws) return;
        const idx = window._selectedModuleIndex;

        // 모든 모듈 rect 초기화
        ws.querySelectorAll('[data-mod-index]').forEach(el => {
          el.style.filter = '';
          el.style.opacity = '';
        });

        if (idx === null || idx === undefined) return;

        // 선택 모듈 하이라이트 (모든 뷰에서)
        ws.querySelectorAll(`[data-mod-index="${idx}"]`).forEach(el => {
          el.style.filter = 'drop-shadow(0 0 4px #b8956c)';
          el.style.opacity = '1';
        });

        // 비선택 모듈 흐리게
        ws.querySelectorAll('[data-mod-index]').forEach(el => {
          if (el.dataset.modIndex !== String(idx)) {
            el.style.opacity = '0.6';
          }
        });
      }

      function openModulePopup(itemUniqueId, modId) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules[modId] || item.modules.find(m => m.id == modId);
        if (!mod) return;

        // 기존 팝업 제거
        const existing = document.querySelector('.mod-popup-overlay');
        if (existing) existing.remove();

        const mId = mod.id || modId;
        const posLabel = mod.pos === 'upper' ? '상부' : '하부';
        const isSink = item.categoryId === 'sink' || item.categoryId === 'island';

        // 타입 판별
        let currentType = 'storage';
        if (mod.type === 'sink') currentType = 'sink';
        else if (mod.type === 'cook') currentType = 'cook';
        else if (mod.type === 'hood') currentType = 'hood';
        else if (mod.type === 'storage' && mod.name === 'LT망장') currentType = 'lt';
        else if (mod.type === 'tall') currentType = 'tall';
        else if (mod.isDrawer) currentType = 'drawer';

        // 타입 아이콘/이름
        const typeMap = {
          storage: { icon: '📦', name: '수납장' },
          drawer: { icon: '🗄️', name: '서랍장' },
          sink: { icon: '🚰', name: '개수대' },
          cook: { icon: '🔥', name: '가스대' },
          hood: { icon: '🌀', name: '후드장' },
          lt: { icon: '🔧', name: 'LT망장' },
          tall: { icon: '↕', name: '키큰장' },
        };
        const typeInfo = typeMap[currentType] || typeMap.storage;

        // 싱크대 타입 버튼 (타입 변경 가능)
        let typeSelectHtml = '';
        if (isSink) {
          const allTypes = [
            { value: 'storage', icon: '📦', name: '수납장', pos: ['lower','upper'] },
            { value: 'drawer', icon: '🗄️', name: '서랍장', pos: ['lower'] },
            { value: 'sink', icon: '🚰', name: '개수대', pos: ['lower'] },
            { value: 'cook', icon: '🔥', name: '가스대', pos: ['lower'] },
            { value: 'lt', icon: '🔧', name: 'LT망장', pos: ['lower'] },
            { value: 'hood', icon: '🌀', name: '후드장', pos: ['upper'] },
          ];
          const filtered = allTypes.filter(t => t.pos.includes(mod.pos));
          typeSelectHtml = `
            <div class="mp-section">
              <div class="mp-section-title">타입 변경</div>
              <div class="mp-type-grid">
                ${filtered.map(t => `
                  <button class="mp-type-btn ${currentType === t.value ? 'active' : ''}" data-mp-type="${t.value}"
                    onclick="mpSelectType(this,'${t.value}')">
                    <span>${t.icon}</span><span>${t.name}</span>
                  </button>
                `).join('')}
              </div>
            </div>`;
        }

        // 서랍 개수 (서랍장일 때)
        const drawerCount = mod.drawerCount || 3;
        const drawerCountHtml = `
          <div class="mp-section mp-drawer-section" style="display:${currentType === 'drawer' ? '' : 'none'}">
            <div class="mp-section-title">서랍 개수</div>
            <div class="mp-counter-row">
              ${[1,2,3,4,5].map(n => `
                <button class="mp-count-btn ${drawerCount === n ? 'active' : ''}" data-mp-dcount="${n}"
                  onclick="mpSelectDrawerCount(${n})">${n}</button>
              `).join('')}
            </div>
          </div>`;

        // 도어 개수 (수납장/상부장일 때, 서랍/개수대/가스대 제외)
        const showDoorCount = !mod.isDrawer && mod.type !== 'sink' && mod.type !== 'cook' && mod.type !== 'hood';
        const doorCount = mod.doorCount || Math.ceil((parseFloat(mod.w) || 600) / 450);
        const doorCountHtml = showDoorCount ? `
          <div class="mp-section">
            <div class="mp-section-title">도어 개수</div>
            <div class="mp-counter-row">
              ${[1,2,3,4].map(n => `
                <button class="mp-count-btn ${doorCount === n ? 'active' : ''}" data-mp-door="${n}"
                  onclick="mpSelectDoorCount(${n})">${n}</button>
              `).join('')}
            </div>
          </div>` : '';

        // 토글 옵션
        const togglesHtml = `
          <div class="mp-section">
            <div class="mp-toggles">
              ${!mod.type || mod.type === 'storage' ? `
              <label class="mp-toggle">
                <input type="checkbox" ${mod.isDrawer ? 'checked' : ''} onchange="mpToggleDrawer(this.checked)">
                <span>서랍장</span>
              </label>` : ''}
              <label class="mp-toggle">
                <input type="checkbox" ${mod.isFixed ? 'checked' : ''} onchange="mpToggleFixed(this.checked)">
                <span>위치 고정</span>
              </label>
            </div>
          </div>`;

        const overlay = document.createElement('div');
        overlay.className = 'mod-popup-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) closeModulePopup(itemUniqueId); };
        overlay.innerHTML = `
          <div class="mod-popup">
            <div class="mp-header">
              <div class="mp-header-icon">${typeInfo.icon}</div>
              <div class="mp-header-info">
                <div class="mp-header-name">${mod.name || typeInfo.name}</div>
                <div class="mp-header-badge">${posLabel} · W${mod.w || '?'}mm</div>
              </div>
              <button class="mp-close" onclick="closeModulePopup(${itemUniqueId})">&times;</button>
            </div>

            <div class="mp-body">
              <div class="mp-section">
                <div class="mp-section-title">치수 (mm)</div>
                <div class="mp-dim-row">
                  <div class="mp-dim">
                    <label>W 너비</label>
                    <input type="number" id="mp-w" value="${mod.w || ''}" step="10" min="100" max="2400">
                  </div>
                  <div class="mp-dim">
                    <label>H 높이</label>
                    <input type="number" id="mp-h" value="${mod.h || ''}" step="10" min="100" max="2400">
                  </div>
                  <div class="mp-dim">
                    <label>D 깊이</label>
                    <input type="number" id="mp-d" value="${mod.d || ''}" step="10" min="100" max="800">
                  </div>
                </div>
              </div>
              ${typeSelectHtml}
              ${drawerCountHtml}
              ${doorCountHtml}
              ${togglesHtml}
            </div>

            <div class="mp-footer">
              <button class="mp-btn-delete" onclick="removeModuleById(${itemUniqueId},'${mId}');closeModulePopup(${itemUniqueId})">삭제</button>
              <button class="mp-btn-confirm" onclick="applyModulePopup(${itemUniqueId},'${mId}')">적용</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        // 전역 참조 (적용 시 사용)
        window._mpContext = { itemUniqueId, modId: mId, mod, item };
      }

      // 모듈 팝업 — 타입 선택
      function mpSelectType(btn, typeValue) {
        document.querySelectorAll('.mp-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const ds = document.querySelector('.mp-drawer-section');
        if (ds) ds.style.display = typeValue === 'drawer' ? '' : 'none';
      }

      // 모듈 팝업 — 서랍 개수
      function mpSelectDrawerCount(n) {
        document.querySelectorAll('[data-mp-dcount]').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.mpDcount) === n);
        });
      }

      // 모듈 팝업 — 도어 개수
      function mpSelectDoorCount(n) {
        document.querySelectorAll('[data-mp-door]').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.mpDoor) === n);
        });
      }

      // 모듈 팝업 — 서랍 토글
      function mpToggleDrawer(checked) {
        const ds = document.querySelector('.mp-drawer-section');
        if (ds) ds.style.display = checked ? '' : 'none';
      }

      // 모듈 팝업 — 고정 토글 (UI만, 적용은 applyModulePopup)
      function mpToggleFixed(checked) { /* UI 즉시 반영 불필요 */ }

      // 모듈 팝업 — 적용
      function applyModulePopup(itemUniqueId, modId) {
        const ctx = window._mpContext;
        if (!ctx) { closeModulePopup(itemUniqueId); return; }
        const { mod, item } = ctx;

        // 치수 적용
        const wVal = parseFloat(document.getElementById('mp-w')?.value);
        const hVal = parseFloat(document.getElementById('mp-h')?.value);
        const dVal = parseFloat(document.getElementById('mp-d')?.value);
        if (wVal && wVal > 0) mod.w = wVal;
        if (hVal && hVal > 0) mod.h = hVal;
        if (dVal && dVal > 0) mod.d = dVal;

        // 타입 적용 (싱크대 카테고리)
        const typeBtn = document.querySelector('.mp-type-btn.active');
        if (typeBtn) {
          const typeValue = typeBtn.dataset.mpType;
          switch (typeValue) {
            case 'storage':
              mod.type = 'storage';
              mod.name = mod.pos === 'upper' ? '상부장' : '하부장';
              mod.isDrawer = false; mod.isFixed = false;
              break;
            case 'drawer':
              mod.type = 'storage'; mod.name = '서랍장'; mod.isDrawer = true; mod.isFixed = false;
              const dcBtn = document.querySelector('[data-mp-dcount].active');
              mod.drawerCount = dcBtn ? parseInt(dcBtn.dataset.mpDcount) : 3;
              break;
            case 'sink':
              mod.type = 'sink'; mod.name = '개수대'; mod.w = wVal || 1000; mod.isDrawer = false; mod.isFixed = true;
              break;
            case 'cook':
              mod.type = 'cook'; mod.name = '가스대'; mod.w = wVal || 600; mod.isDrawer = false; mod.isFixed = true;
              break;
            case 'lt':
              mod.type = 'storage'; mod.name = 'LT망장'; mod.w = wVal || 200; mod.isDrawer = true; mod.isFixed = true;
              break;
            case 'hood':
              mod.type = 'hood'; mod.name = '후드장'; mod.w = wVal || 800; mod.isDrawer = false; mod.isFixed = true;
              break;
          }
        }

        // 도어 개수 적용
        const doorBtn = document.querySelector('[data-mp-door].active');
        if (doorBtn) mod.doorCount = parseInt(doorBtn.dataset.mpDoor);

        // 토글 적용
        const drawerChk = document.querySelector('.mp-toggles input[onchange*="mpToggleDrawer"]');
        const fixedChk = document.querySelector('.mp-toggles input[onchange*="mpToggleFixed"]');
        if (drawerChk && !typeBtn) mod.isDrawer = drawerChk.checked;
        if (fixedChk) mod.isFixed = fixedChk.checked;

        closeModulePopup(itemUniqueId);
      }

      // 모듈 팝업 닫기
      function closeModulePopup(itemUniqueId) {
        const overlay = document.querySelector('.mod-popup-overlay');
        if (overlay) overlay.remove();
        window._mpContext = null;
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (item) {
          repositionFixedModules(itemUniqueId);
          renderWorkspaceContent(item);
        }
      }

      // ── 분배기/환풍구 위치 편집 팝업 ──
      function openUtilityPopup(itemUniqueId, type) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        const popup = document.getElementById(`spec-popup-${itemUniqueId}`);
        const title = document.getElementById(`spec-popup-title-${itemUniqueId}`);
        const body = document.getElementById(`spec-popup-body-${itemUniqueId}`);
        if (!popup || !body) return;

        if (type === 'distributor') {
          title.textContent = '💧 분배기 위치';
          body.innerHTML = `
            <div class="spec-row">
              <div class="spec-field"><label>시작 위치(mm)</label><input type="number" value="${item.specs.distributorStart || 0}" onchange="updateSpec(${itemUniqueId}, 'distributorStart', this.value)"></div>
              <div class="spec-field"><label>끝 위치(mm)</label><input type="number" value="${item.specs.distributorEnd || 0}" onchange="updateSpec(${itemUniqueId}, 'distributorEnd', this.value)"></div>
            </div>
            <div style="font-size:11px;color:#888;margin-top:8px;">실측 기준(${item.specs.measurementBase === 'Left' ? '좌측' : '우측'})에서의 거리</div>`;
        } else {
          title.textContent = '🌀 환풍구 위치';
          body.innerHTML = `
            <div class="spec-row">
              <div class="spec-field"><label>위치(mm)</label><input type="number" value="${item.specs.ventStart || 0}" onchange="updateSpec(${itemUniqueId}, 'ventStart', this.value)"></div>
            </div>
            <div style="font-size:11px;color:#888;margin-top:8px;">실측 기준(${item.specs.measurementBase === 'Left' ? '좌측' : '우측'})에서의 거리</div>`;
        }
        popup.style.display = 'flex';
      }

      function removeModuleById(itemUniqueId, modId) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        pushUndo(item); // ★ Undo
        item.modules = item.modules.filter(m => m.id != modId);
      }

      // ── SVG 내 분배기/환풍구 드래그 이동 (실시간 SVG 요소 이동) ──
      (function initUtilityDrag() {
        let dragField = null;
        let dragUid = null;
        let dragSvg = null;
        let dragDrawW = 0;
        let dragOx = 0;
        let dragSinkW = 0;
        let dragAllEls = [];

        function clientToMm(e) {
          const rect = dragSvg.getBoundingClientRect();
          const vb = dragSvg.viewBox.baseVal;
          const svgX = (e.clientX - rect.left) / rect.width * vb.width;
          return Math.round(Math.max(0, Math.min(dragSinkW, (svgX - dragOx) / dragDrawW * dragSinkW)));
        }

        function moveSvgElements(newSvgX) {
          dragAllEls.forEach(el => {
            const tag = el.tagName;
            if (tag === 'circle') {
              el.setAttribute('cx', newSvgX);
            } else if (tag === 'line') {
              // 수직 라인: x1=x2 이동
              if (el.getAttribute('x1') === el.getAttribute('x2')) {
                el.setAttribute('x1', newSvgX);
                el.setAttribute('x2', newSvgX);
              }
            } else if (tag === 'g') {
              // 그룹 전체를 transform으로 이동
              el.setAttribute('transform', `translate(${newSvgX - parseFloat(el.dataset.origX || 0)}, 0)`);
            }
          });
        }

        document.addEventListener('pointerdown', function(e) {
          const el = e.target.closest('[data-drag]');
          if (!el) return;
          dragField = el.dataset.drag;
          dragUid = parseFloat(el.dataset.uid);
          dragSvg = el.closest('svg');
          if (!dragSvg) return;

          const item = selectedItems.find(i => i.uniqueId === dragUid);
          if (!item) return;
          dragSinkW = parseFloat(item.w) || 3000;
          const vb = dragSvg.viewBox.baseVal;
          dragDrawW = vb.width - 100;
          dragOx = (vb.width - dragDrawW) / 2;

          // 드래그 대상 요소 수집
          if (el.tagName === 'circle') {
            // 분배기: 해당 원 + 연결된 수직 라인
            const cx = parseFloat(el.getAttribute('cx'));
            dragAllEls = [el];
            // 같은 x좌표의 수직 라인 찾기
            dragSvg.querySelectorAll('line').forEach(line => {
              if (parseFloat(line.getAttribute('x1')) === cx && line.getAttribute('x1') === line.getAttribute('x2')) {
                if (line.getAttribute('stroke') === '#2563eb') dragAllEls.push(line);
              }
            });
            // 수평 배관 라인도 업데이트 필요 → pointerup에서 리렌더
          } else if (el.tagName === 'g' || el.closest('g[data-drag]')) {
            // 환풍구: g 그룹 전체
            const g = el.tagName === 'g' ? el : el.closest('g[data-drag]');
            const rect = g.querySelector('rect');
            const origX = rect ? parseFloat(rect.getAttribute('x')) + parseFloat(rect.getAttribute('width')) / 2 : 0;
            g.dataset.origX = origX;
            dragAllEls = [g];
          }

          dragSvg.style.cursor = 'ew-resize';
          dragSvg.setPointerCapture(e.pointerId);
          e.preventDefault();
        });

        document.addEventListener('pointermove', function(e) {
          if (!dragField || !dragSvg) return;
          const mmPos = clientToMm(e);
          const newSvgX = dragOx + mmPos / dragSinkW * dragDrawW;

          // SVG 요소 실시간 이동
          moveSvgElements(newSvgX);

          // 데이터 업데이트 (리렌더 없이)
          const item = selectedItems.find(i => i.uniqueId === dragUid);
          if (item) item.specs[dragField] = mmPos;
        });

        document.addEventListener('pointerup', function(e) {
          if (!dragField) return;
          if (dragSvg) {
            dragSvg.style.cursor = '';
            try { dragSvg.releasePointerCapture(e.pointerId); } catch(ex) {}
          }
          dragField = null;
          dragAllEls = [];
          // 드래그 완료 → 고정 모듈 실시간 재배치 + 리렌더
          repositionFixedModules(dragUid);
        });
      })();

      // ── SVG 모듈 드래그 이동 + 자동 재배치 ──
      (function initModuleDrag() {
        let modDragIdx = null;
        let modDragUid = null;
        let modDragPos = null;
        let modDragSvg = null;
        let modDragRect = null;
        let modDragStartX = 0;
        let modOrigX = 0;
        let modDragDrawW = 0;
        let modDragOx = 0;
        let modDragSinkW = 0;
        let modDragged = false; // 실제 드래그가 발생했는지
        const DRAG_THRESHOLD = 10; // px 미만 이동은 클릭으로 간주

        document.addEventListener('pointerdown', function(e) {
          const el = e.target.closest('[data-drag-mod]');
          if (!el) return;
          modDragIdx = parseInt(el.dataset.dragMod);
          modDragUid = parseFloat(el.dataset.uid);
          modDragPos = el.dataset.modPos;
          modDragSvg = el.closest('svg');
          modDragRect = el;
          modDragged = false;
          if (!modDragSvg) return;

          const item = selectedItems.find(i => i.uniqueId === modDragUid);
          if (!item) return;
          modDragSinkW = parseFloat(item.w) || 3000;
          const vb = modDragSvg.viewBox.baseVal;
          modDragDrawW = vb.width - 100;
          modDragOx = (vb.width - modDragDrawW) / 2;
          modOrigX = parseFloat(el.getAttribute('x'));
          modDragStartX = e.clientX;

          modDragSvg.setPointerCapture(e.pointerId);
          e.preventDefault();
          e.stopPropagation();
        });

        // 드롭 위치에서 삽입 인덱스 계산 (드래그 모듈 제외한 filtered 기준)
        function calcInsertIdx(e) {
          const item = selectedItems.find(i => i.uniqueId === modDragUid);
          if (!item) return -1;
          const rect = modDragSvg.getBoundingClientRect();
          const vb = modDragSvg.viewBox.baseVal;
          const svgX = (e.clientX - rect.left) / rect.width * vb.width;
          const dropMm = Math.max(0, Math.min(modDragSinkW, (svgX - modDragOx) / modDragDrawW * modDragSinkW));
          const posModules = item.modules.filter(m => m.pos === modDragPos);
          const draggedMod = item.modules[modDragIdx];
          const filtered = posModules.filter(m => m !== draggedMod);
          const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
          let cursor = fL;
          for (let i = 0; i < filtered.length; i++) {
            const midX = cursor + (parseFloat(filtered[i].w) || 0) / 2;
            if (dropMm < midX) return i;
            cursor += parseFloat(filtered[i].w) || 0;
          }
          return filtered.length;
        }

        // 삽입 위치의 좌우 경계 모듈 하이라이트 + 삽입선 표시
        function highlightAffected(insertIdx) {
          const item = selectedItems.find(i => i.uniqueId === modDragUid);
          if (!item) return;
          const posModules = item.modules.filter(m => m.pos === modDragPos);
          const draggedMod = item.modules[modDragIdx];
          const filtered = posModules.filter(m => m !== draggedMod);

          // 삽입 위치의 좌우 이웃 모듈 (기준 모듈)
          const leftNeighbor = insertIdx > 0 ? filtered[insertIdx - 1] : null;
          const rightNeighbor = insertIdx < filtered.length ? filtered[insertIdx] : null;
          const boundarySet = new Set();
          if (leftNeighbor) boundarySet.add(leftNeighbor);
          if (rightNeighbor) boundarySet.add(rightNeighbor);

          // ★ 삽입선 위치 계산 (mm → SVG 좌표)
          const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
          let insertMm = fL;
          for (let i = 0; i < insertIdx && i < filtered.length; i++) {
            insertMm += parseFloat(filtered[i].w) || 0;
          }
          const insertSvgX = modDragOx + (insertMm / modDragSinkW) * modDragDrawW;

          // 삽입선 (두꺼운 초록색 실선)
          let insertLine = modDragSvg.querySelector('#insert-line');
          if (!insertLine) {
            insertLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            insertLine.id = 'insert-line';
            insertLine.setAttribute('stroke', '#22c55e');
            insertLine.setAttribute('stroke-width', '3');
            insertLine.setAttribute('stroke-linecap', 'round');
            modDragSvg.appendChild(insertLine);
          }
          const vb = modDragSvg.viewBox.baseVal;
          insertLine.setAttribute('x1', insertSvgX);
          insertLine.setAttribute('y1', '2');
          insertLine.setAttribute('x2', insertSvgX);
          insertLine.setAttribute('y2', vb.height - 2);
          insertLine.setAttribute('opacity', '1');

          // ★ 삽입 위치 삼각형 화살표 (위/아래)
          let insertArrow = modDragSvg.querySelector('#insert-arrow');
          if (!insertArrow) {
            insertArrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            insertArrow.id = 'insert-arrow';
            insertArrow.setAttribute('fill', '#22c55e');
            modDragSvg.appendChild(insertArrow);
          }
          const aw = 8; // 화살표 너비
          insertArrow.setAttribute('points',
            `${insertSvgX - aw},0 ${insertSvgX + aw},0 ${insertSvgX},${aw * 1.2}`);

          modDragSvg.querySelectorAll('[data-drag-mod]').forEach(r => {
            if (r === modDragRect) return;
            const idx = parseInt(r.dataset.dragMod);
            const mod = item.modules[idx];
            if (!mod || mod.pos !== modDragPos) {
              r.setAttribute('opacity', '1');
              r.removeAttribute('filter');
              r.setAttribute('stroke-width', '2');
              r.style.stroke = '';
              return;
            }
            if (boundarySet.has(mod)) {
              // 기준 모듈: 진하게 + 두꺼운 초록 테두리
              r.setAttribute('opacity', '1');
              r.setAttribute('filter', 'saturate(1.6) brightness(0.9)');
              r.setAttribute('stroke-width', '4');
              r.style.stroke = '#22c55e';
            } else {
              // 나머지: 연하게
              r.setAttribute('opacity', '0.35');
              r.removeAttribute('filter');
              r.setAttribute('stroke-width', '2');
              r.style.stroke = '';
            }
          });
        }

        document.addEventListener('pointermove', function(e) {
          if (modDragRect === null || !modDragSvg) return;
          const dist = Math.abs(e.clientX - modDragStartX);
          if (!modDragged && dist < DRAG_THRESHOLD) return;

          // 드래그 시작
          if (!modDragged) {
            modDragged = true;
            modDragRect.style.cursor = 'grabbing';
            modDragSvg.style.cursor = 'grabbing';
            // 드래그 모듈: SVG 최앞 + 투명 + 그림자
            modDragRect.parentNode.appendChild(modDragRect);
            modDragRect.setAttribute('opacity', '0.35');
            modDragRect.setAttribute('filter', 'drop-shadow(3px 3px 6px rgba(0,0,0,0.4))');
            modDragRect.setAttribute('stroke-width', '3');
            modDragRect.setAttribute('stroke-dasharray', '6,3');
          }

          // 모듈 위치 이동
          const rect = modDragSvg.getBoundingClientRect();
          const vb = modDragSvg.viewBox.baseVal;
          const dx = (e.clientX - modDragStartX) / rect.width * vb.width;
          modDragRect.setAttribute('x', modOrigX + dx);

          // 삽입 위치 계산 + 경계 모듈 하이라이트 + 삽입선
          const idx = calcInsertIdx(e);
          highlightAffected(idx);
        });

        document.addEventListener('pointerup', function(e) {
          if (modDragRect === null) return;

          const wasDragged = modDragged;
          const savedIdx = modDragIdx;
          const savedUid = modDragUid;

          // 리셋 — 하이라이트 복원 + 삽입선/화살표 제거
          if (modDragSvg) {
            modDragSvg.style.cursor = '';
            const insertLine = modDragSvg.querySelector('#insert-line');
            if (insertLine) insertLine.remove();
            const insertArrow = modDragSvg.querySelector('#insert-arrow');
            if (insertArrow) insertArrow.remove();
            modDragSvg.querySelectorAll('[data-drag-mod]').forEach(r => {
              r.setAttribute('opacity', '1');
              r.removeAttribute('filter');
              r.setAttribute('stroke-width', '2');
              r.removeAttribute('stroke-dasharray');
              r.style.stroke = '';
            });
            try { modDragSvg.releasePointerCapture(e.pointerId); } catch(ex) {}
          }

          // 드래그 안 했으면 → 클릭: 모듈 편집 팝업
          if (!wasDragged) {
            modDragRect = null;
            modDragged = false;
            openModulePopup(savedUid, savedIdx);
            return;
          }

          // 드래그 했으면 → 위치 재정렬 (calcInsertIdx와 동일 로직)
          const item = selectedItems.find(i => i.uniqueId === modDragUid);
          if (!item || !modDragSvg) {
            modDragRect = null;
            modDragged = false;
            return;
          }

          const insertIdx = calcInsertIdx(e);
          const posModules = item.modules.filter(m => m.pos === modDragPos);
          const otherModules = item.modules.filter(m => m.pos !== modDragPos);
          const draggedMod = item.modules[modDragIdx];

          if (draggedMod && posModules.length > 1 && insertIdx >= 0) {
            pushUndo(item); // ★ Undo — 모듈 순서 변경 전 저장
            const filtered = posModules.filter(m => m !== draggedMod);
            filtered.splice(insertIdx, 0, draggedMod);
            item.modules = otherModules.concat(filtered);
          }

          modDragRect = null;
          modDragged = false;
          renderWorkspaceContent(item);
        });
      })();

      // 모듈 편집은 단일 클릭으로 처리 (드래그 핸들러 pointerup에서)

      // ── 빈 공간에 모듈 추가 ──
      function addModuleAtGap(itemUniqueId, pos, gapWidth) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        pushUndo(item); // ★ Undo

        const specLowerH = parseFloat(item.specs.lowerH) || 870;
        const specLegH = parseFloat(item.specs.sinkLegHeight) || 150;
        const specTopT = parseFloat(item.specs.topThickness) || 12;
        const specUpperH = parseFloat(item.specs.upperH) || 720;
        const specOverlap = parseFloat(item.specs.upperDoorOverlap) || 15;

        const h = pos === 'upper' ? specUpperH - specOverlap : specLowerH - specTopT - specLegH;
        const d = pos === 'upper' ? 295 : parseFloat(item.d) || 550;
        const w = Math.min(gapWidth, DOOR_MAX_WIDTH * 2); // 최대 2D 모듈 너비

        item.modules.push({
          id: Date.now() + Math.random(),
          type: 'storage',
          name: '캐비닛',
          pos: pos,
          w: w,
          h: h,
          d: d,
          isDrawer: false,
          isFixed: false,
          isEL: false,
        });

        renderWorkspaceContent(item);
      }

      function updateTopSize(itemUniqueId, index, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) item.specs.topSizes[index] = value;
      }

      function updateTopSizeDim(itemUniqueId, index, dim, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (!item.specs.topSizes[index] || typeof item.specs.topSizes[index] === 'string') {
          item.specs.topSizes[index] = { w: '', d: '' };
        }
        item.specs.topSizes[index][dim] = value;
      }

      function updateSpec(itemUniqueId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          // ★ 값이 동일하면 렌더링 스킵 (blur → onchange로 인한 불필요한 리렌더 방지)
          if (item.specs[field] === value) return;

          pushUndo(item); // ★ Undo 스택에 현재 상태 저장
          item.specs[field] = value;

          // ★ 싱크대: 다리발 높이 등 치수 관련 select 변경 시 모듈 동기화
          if (item.categoryId === 'sink' && ['sinkLegHeight'].includes(field)) {
            const num = parseFloat(value);
            item.specs[field] = isNaN(num) ? value : num;
            syncModuleHeights(item);
          }

          renderWorkspaceContent(item);
          // 3D 플래너에도 반영
          if (typeof _syncPlannerState === 'function') _syncPlannerState(item);
        }
      }

      function togglePlumbing(itemUniqueId, type, checked) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        pushUndo(item);
        if (!checked) {
          // 삭제: 0으로 설정 (0 = 삭제됨 상태)
          if (type === 'distributor') {
            item.specs.distributorStart = 0;
            item.specs.distributorEnd = 0;
            delete item.specs.waterSupplyPosition;
            delete item.specs.distributorStartAbs;
            delete item.specs.distributorEndAbs;
          } else if (type === 'vent') {
            item.specs.ventStart = 0;
            delete item.specs.exhaustPosition;
          }
        } else {
          // 활성화: null로 설정 → 렌더 시 초기값 자동 생성
          if (type === 'distributor') {
            item.specs.distributorStart = null;
            item.specs.distributorEnd = null;
          } else if (type === 'vent') {
            item.specs.ventStart = null;
          }
        }
        renderWorkspaceContent(item);
      }

      function updateSpecNoRender(itemUniqueId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) item.specs[field] = value;
      }

      // 마감재 타입 변경 시 기본 너비도 자동 설정
      function updateFinishType(itemUniqueId, side, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        // 타입에 따른 기본 너비: 휠라 60, 몰딩 60, EP 20, 없음 0
        const defaultWidths = { Filler: 60, Molding: 60, EP: 20, None: 0 };
        const defaultWidth = defaultWidths[value] || 0;

        item.specs[`finish${side}Type`] = value;
        item.specs[`finish${side}Width`] = defaultWidth;

        renderWorkspaceContent(item);
      }

      function updateSpecValue(itemUniqueId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          const num = parseFloat(value);
          const newVal = isNaN(num) ? value : num;

          // ★ 값이 동일하면 렌더링 스킵 (blur → onchange로 인한 불필요한 리렌더 방지)
          if (item.specs[field] === newVal) return;

          item.specs[field] = newVal;

          // ★ 싱크대: 치수 설정 변경 시 모듈 높이 동기화
          if (item.categoryId === 'sink' && ['upperH', 'lowerH', 'sinkLegHeight', 'topThickness', 'upperDoorOverlap'].includes(field)) {
            syncModuleHeights(item);
          }

          renderWorkspaceContent(item);
          // 3D 플래너에도 반영
          if (typeof _syncPlannerState === 'function') _syncPlannerState(item);
        }
      }

      // ★ 싱크대 모듈 높이를 현재 설정값에 동기화
      function syncModuleHeights(item) {
        const specs = item.specs || {};
        const upperH = parseFloat(specs.upperH) || 720;
        const lowerH = parseFloat(specs.lowerH) || 870;
        const legH = parseFloat(specs.sinkLegHeight) || 150;
        const topT = parseFloat(specs.topThickness) || 12;
        const overlap = parseFloat(specs.upperDoorOverlap) || 15;

        (item.modules || []).forEach(mod => {
          if (mod.pos === 'upper' && mod.type !== 'hood') {
            mod.h = upperH - overlap;
          } else if (mod.pos === 'lower' && mod.type !== 'tall') {
            mod.h = lowerH - topT - legH;
          }
        });
      }

      function updateModuleDim(itemUniqueId, moduleId, dim, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const mod = item.modules.find((m) => m.id == moduleId);
        if (!mod) return;

        mod[dim] = parseFloat(value) || 0;
        mod.isFixed = true;

        updateRemainingDisplay(item);
      }

      function updateRemainingDisplay(item) {
        const upperModules = item.modules.filter((m) => m.pos === 'upper');
        const lowerModules = item.modules.filter((m) => m.pos === 'lower');

        const upperEffectiveW = getEffectiveSpace(item, 'upper');
        const lowerEffectiveW = getEffectiveSpace(item, 'lower');

        const upperUsedW = upperModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
        const lowerUsedW = lowerModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);

        const upperRemaining = upperEffectiveW - upperUsedW;
        const lowerRemaining = lowerEffectiveW - lowerUsedW;

        const upperSpan = document.querySelector('.module-section-header.upper .section-remaining');
        const lowerSpan = document.querySelector('.module-section-header.lower .section-remaining');

        if (upperSpan) {
          upperSpan.textContent = `잔여: ${Math.round(upperRemaining)}mm`;
          upperSpan.style.color = getRemainColor(upperRemaining);
        }
        if (lowerSpan) {
          lowerSpan.textContent = `잔여: ${Math.round(lowerRemaining)}mm`;
          lowerSpan.style.color = getRemainColor(lowerRemaining);
        }

        item.modules.forEach((mod) => {
          if (mod.isFixed) {
            const card = document.querySelector(`[data-module-id="${mod.id}"]`);
            if (card && !card.classList.contains('fixed-module')) {
              card.classList.add('fixed-module');
            }
          }
        });
      }

      function updateModuleDetail(itemUniqueId, moduleId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          const mod = item.modules.find((m) => m.id === moduleId);
          if (mod) mod[field] = parseFloat(value) || 0;
        }
      }

      function toggleOption(itemUniqueId, moduleId, field, isChecked) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          const mod = item.modules.find((m) => m.id === moduleId);
          if (mod) {
            mod[field] = isChecked;
            // EL장 활성화 시 하부장 너비 600으로 자동 변경 + 고정장 변환
            if (field === 'isEL' && isChecked && mod.pos === 'lower') {
              mod.w = 600;
              mod.isFixed = true; // EL장은 고정장으로 변환
            }
          }
          renderWorkspaceContent(item);
        }
      }

      function moveModule(itemUniqueId, moduleId, direction) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const module = item.modules.find((m) => m.id === moduleId);
        if (!module) return;

        const sectionModules = item.modules.filter((m) => m.pos === module.pos);
        const currentIndex = sectionModules.findIndex((m) => m.id === moduleId);

        if (
          (direction === 'up' && currentIndex === 0) ||
          (direction === 'down' && currentIndex === sectionModules.length - 1)
        )
          return;

        const globalCurrentIndex = item.modules.findIndex((m) => m.id === moduleId);
        const targetModuleId =
          direction === 'up' ? sectionModules[currentIndex - 1].id : sectionModules[currentIndex + 1].id;
        const globalTargetIndex = item.modules.findIndex((m) => m.id === targetModuleId);

        [item.modules[globalCurrentIndex], item.modules[globalTargetIndex]] = [
          item.modules[globalTargetIndex],
          item.modules[globalCurrentIndex],
        ];
        renderWorkspaceContent(item);
      }

      function removeModule(itemUniqueId, moduleId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          item.modules = item.modules.filter((m) => m.id !== moduleId);
          renderWorkspaceContent(item);
        }
      }

      // 싱크대 모듈 고정 토글
      function toggleSinkModuleFixed(itemUniqueId, moduleId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === moduleId);
        if (mod) {
          mod.isFixed = !mod.isFixed;
          renderWorkspaceContent(item);
        }
      }

      // ★ 싱크대 모듈 타입 선택 팝업 시스템
      let currentSinkModuleTypePopup = { itemId: null, modId: null };

      function openSinkModuleTypePopup(itemUniqueId, modId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (!mod) return;
        currentSinkModuleTypePopup = { itemId: itemUniqueId, modId: modId };
        renderSinkModuleTypePopup(item, mod);
      }

      function renderSinkModuleTypePopup(item, mod) {
        // 기존 팝업 제거
        const existing = document.querySelector('.sink-type-popup-overlay');
        if (existing) existing.remove();

        // 현재 타입 판별
        let currentType = 'storage';
        if (mod.type === 'sink') currentType = 'sink';
        else if (mod.type === 'cook') currentType = 'cook';
        else if (mod.type === 'hood') currentType = 'hood';
        else if (mod.type === 'storage' && mod.name === 'LT망장') currentType = 'lt';
        else if (mod.isDrawer) currentType = 'drawer';

        // 타입 목록 (pos에 따라 필터링)
        const allTypes = [
          { value: 'storage', icon: '📦', name: '일반 수납장', desc: '일반 수납장 (하부장/상부장)', pos: ['lower','upper'] },
          { value: 'drawer', icon: '🗄️', name: '서랍장', desc: '서랍장 (하부장)', pos: ['lower'] },
          { value: 'sink', icon: '🚰', name: '개수대', desc: 'W:1000 D:600 고정모듈', pos: ['lower'] },
          { value: 'cook', icon: '🔥', name: '가스대', desc: 'W:600 D:550 고정모듈', pos: ['lower'] },
          { value: 'lt', icon: '🔧', name: 'LT망장', desc: 'W:200 D:550 서랍 고정모듈', pos: ['lower'] },
          { value: 'hood', icon: '🌀', name: '후드장', desc: 'W:800 D:295 고정모듈', pos: ['upper'] },
        ];
        const filteredTypes = allTypes.filter(t => t.pos.includes(mod.pos));

        const currentDrawerCount = mod.drawerCount || 1;

        const buttonsHtml = filteredTypes.map(t => `
          <button class="sink-type-btn ${currentType === t.value ? 'selected' : ''}" data-type-value="${t.value}" onclick="selectSinkModuleType('${t.value}')">
            <span class="type-icon">${t.icon}</span>
            <div class="type-info">
              <div class="type-name">${t.name}</div>
              <div class="type-desc">${t.desc}</div>
            </div>
          </button>
        `).join('');

        // 서랍 개수 선택 (서랍장 선택시만 표시)
        const drawerCountHtml = `
          <div class="sink-type-drawer-count" style="display:${currentType === 'drawer' ? 'flex' : 'none'};align-items:center;gap:8px;margin-top:8px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;">
            <span style="font-size:13px;color:#92400e;">서랍 개수:</span>
            ${[1,2,3].map(n => `<button class="drawer-count-btn ${currentDrawerCount === n ? 'selected' : ''}" data-count="${n}" onclick="selectDrawerCount(${n})" style="width:32px;height:32px;border:2px solid ${currentDrawerCount === n ? '#f59e0b' : '#e5e7eb'};border-radius:6px;background:${currentDrawerCount === n ? '#fef3c7' : '#fff'};cursor:pointer;font-size:14px;font-weight:600;">${n}</button>`).join('')}
            <span style="font-size:11px;color:#b45309;">× 220mm</span>
          </div>
        `;

        const overlay = document.createElement('div');
        overlay.className = 'sink-type-popup-overlay';
        overlay.onclick = (e) => { if (e.target === overlay) closeSinkModuleTypePopup(); };
        overlay.innerHTML = `
          <div class="sink-type-popup">
            <h3>모듈 타입 선택 (${mod.pos === 'upper' ? '상부' : '하부'} #${mod.id})</h3>
            ${buttonsHtml}
            ${drawerCountHtml}
            <div class="sink-type-popup-actions">
              <button onclick="closeSinkModuleTypePopup()">취소</button>
              <button class="primary" onclick="applySinkModuleType()">적용</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);
      }

      function selectSinkModuleType(typeValue) {
        const btns = document.querySelectorAll('.sink-type-btn');
        btns.forEach(b => b.classList.remove('selected'));
        const target = document.querySelector(`.sink-type-btn[data-type-value="${typeValue}"]`);
        if (target) target.classList.add('selected');
        // 서랍 개수 영역 토글
        const drawerCountEl = document.querySelector('.sink-type-drawer-count');
        if (drawerCountEl) drawerCountEl.style.display = typeValue === 'drawer' ? 'flex' : 'none';
      }

      function selectDrawerCount(count) {
        document.querySelectorAll('.drawer-count-btn').forEach(b => {
          const isSelected = parseInt(b.dataset.count) === count;
          b.classList.toggle('selected', isSelected);
          b.style.borderColor = isSelected ? '#f59e0b' : '#e5e7eb';
          b.style.background = isSelected ? '#fef3c7' : '#fff';
        });
      }

      function applySinkModuleType() {
        const selected = document.querySelector('.sink-type-btn.selected');
        if (!selected) { closeSinkModuleTypePopup(); return; }
        const typeValue = selected.dataset.typeValue;

        const item = selectedItems.find((i) => i.uniqueId === currentSinkModuleTypePopup.itemId);
        if (!item) { closeSinkModuleTypePopup(); return; }
        const mod = item.modules.find((m) => m.id === currentSinkModuleTypePopup.modId);
        if (!mod) { closeSinkModuleTypePopup(); return; }

        // 타입별 기본값 적용
        switch (typeValue) {
          case 'storage':
            mod.type = 'storage';
            mod.name = mod.pos === 'upper' ? '상부장' : '하부장';
            mod.isDrawer = false;
            mod.isFixed = false;
            break;
          case 'drawer':
            mod.type = 'storage';
            mod.name = '서랍장';
            mod.isDrawer = true;
            mod.isFixed = false;
            const countBtn = document.querySelector('.drawer-count-btn.selected');
            mod.drawerCount = countBtn ? parseInt(countBtn.dataset.count) : 1;
            break;
          case 'sink':
            mod.type = 'sink';
            mod.name = '개수대';
            mod.w = 1000;
            mod.d = 600;
            mod.isDrawer = false;
            mod.isFixed = true;
            break;
          case 'cook':
            mod.type = 'cook';
            mod.name = '가스대';
            mod.w = 600;
            mod.d = 550;
            mod.isDrawer = false;
            mod.isFixed = true;
            break;
          case 'lt':
            mod.type = 'storage';
            mod.name = 'LT망장';
            mod.w = 200;
            mod.d = 550;
            mod.isDrawer = true;
            mod.isFixed = true;
            break;
          case 'hood':
            mod.type = 'hood';
            mod.name = '후드장';
            mod.w = 800;
            mod.d = 295;
            mod.isDrawer = false;
            mod.isFixed = true;
            break;
        }

        closeSinkModuleTypePopup();
      }

      function closeSinkModuleTypePopup() {
        const overlay = document.querySelector('.sink-type-popup-overlay');
        if (overlay) overlay.remove();
        const item = selectedItems.find((i) => i.uniqueId === currentSinkModuleTypePopup.itemId);
        if (item) renderWorkspaceContent(item);
        currentSinkModuleTypePopup = { itemId: null, modId: null };
      }

      // 싱크대 도어 표시 토글
      function toggleSinkDoors(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (!item.specs) item.specs = {};
        item.specs.showDoors = !item.specs.showDoors;
        renderWorkspaceContent(item);
      }

      function addStorageModule(itemUniqueId, type) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const specUpperH = parseFloat(item.specs.upperH) || 720;
        const specLowerH = parseFloat(item.specs.lowerH) || 870;
        const specLegH = parseFloat(item.specs.sinkLegHeight) || 150;
        const specTopT = parseFloat(item.specs.topThickness) || 12;
        const specOverlap = parseFloat(item.specs.upperDoorOverlap) || 15;

        const defaultH = type === 'upper' ? specUpperH - specOverlap : specLowerH - specTopT - specLegH;
        const defaultD = type === 'upper' ? 295 : 550;
        const name = type === 'upper' ? '상부장' : '하부장';

        item.modules.push({
          id: Date.now(),
          type: 'storage',
          name,
          pos: type,
          w: 600,
          h: defaultH,
          d: defaultD,
          isDrawer: false,
          isEL: false,
          isFixed: false,
        });
        renderWorkspaceContent(item);
      }

      function addTallModule(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const specMoldingH = parseFloat(item.specs.moldingH) || 60;
        const spaceH = parseFloat(item.h) || 2310;
        const defaultH = spaceH - specMoldingH - 60;

        item.modules.push({
          id: Date.now(),
          type: 'tall',
          name: '키큰장(TL)',
          pos: 'lower',
          w: 600,
          h: defaultH,
          d: 550,
          isDrawer: false,
          isEL: false,
          isFixed: false,
          doorCount: 1,
          elCount: 0,
        });
        renderWorkspaceContent(item);
      }

      function addAccessory(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          item.specs.accessories.push({ id: Date.now(), type: 'LTMesh' });
          renderWorkspaceContent(item);
        }
      }

      function updateAccessory(itemUniqueId, accId, type) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          const acc = item.specs.accessories.find((a) => a.id === accId);
          if (acc) acc.type = type;
        }
      }

      function removeAccessory(itemUniqueId, accId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          item.specs.accessories = item.specs.accessories.filter((a) => a.id !== accId);
          renderWorkspaceContent(item);
        }
      }

