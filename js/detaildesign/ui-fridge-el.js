      // ============================================================
      // ★ 냉장고장 전용 워크스페이스 렌더링 (v30 규칙 기반)
      // ============================================================
      function renderFridgeWorkspace(item) {
        const ws = document.getElementById('designWorkspace');
        const W = parseFloat(item.w) || 0;
        const H = parseFloat(item.h) || 0;
        const D = parseFloat(item.d) || 700;

        if (!item.modules) item.modules = [];

        // 규칙 상수
        const MOLDING_H = parseFloat(item.specs.fridgeMoldingH) || FRIDGE_RULES.MOLDING_H;
        const PEDESTAL_H = parseFloat(item.specs.fridgePedestal) || FRIDGE_RULES.PEDESTAL_H;
        const MODULE_D = parseFloat(item.specs.fridgeModuleD) || FRIDGE_RULES.MODULE_D;
        const TOP_GAP = FRIDGE_RULES.TOP_GAP;

        // 마감 계산
        const fL =
          item.specs.finishLeftType !== 'None'
            ? item.specs.finishLeftType === 'EP'
              ? 20
              : parseFloat(item.specs.finishLeftWidth) || 60
            : 0;
        const fR =
          item.specs.finishRightType !== 'None'
            ? item.specs.finishRightType === 'EP'
              ? 20
              : parseFloat(item.specs.finishRightWidth) || 60
            : 0;
        const effectiveW = W - fL - fR;

        // 모듈들을 order 순으로 정렬
        const allModules = item.modules.sort((a, b) => (a.order || 0) - (b.order || 0));
        const fridgeMod = allModules.find((m) => m.type === 'fridge');

        // ★ 냉장고 기준 상부장 높이 자동 계산 (냉장고는 바닥에서 시작, 좌대 무관)
        const fridgeH = fridgeMod ? fridgeMod.h : 0;
        const calcUpperH = fridgeMod
          ? Math.max(0, Math.min(FRIDGE_RULES.MAX_UPPER_H, H - fridgeH - TOP_GAP - MOLDING_H))
          : 0;

        // 상부장 높이 (계산값 사용, 수동 입력은 recalcFridgeHeights에서 처리)
        const upperDoorH = item.specs.fridgeUpperH !== undefined ? parseFloat(item.specs.fridgeUpperH) : calcUpperH;

        // 중간장/하부장 높이 계산 (모듈 영역 = H - 상몰딩 - 상부장 - 좌대)
        const moduleBodyH = H - MOLDING_H - upperDoorH - PEDESTAL_H;
        const middleH =
          item.specs.fridgeMiddleH !== undefined
            ? parseFloat(item.specs.fridgeMiddleH)
            : Math.floor(moduleBodyH * 0.55);
        const lowerH =
          item.specs.fridgeLowerH !== undefined
            ? parseFloat(item.specs.fridgeLowerH)
            : Math.floor(moduleBodyH - middleH);

        // 사용 너비 계산
        let totalUsedW = 0;
        allModules.forEach((m) => {
          if (m.type === 'fridge') {
            const sideGap = m.sideGap || 50;
            const betweenGap = m.betweenGap || 0;
            const units = m.units || [{ w: m.w }];
            totalUsedW += sideGap * 2;
            units.forEach((u, idx) => {
              totalUsedW += u.w;
              if (idx < units.length - 1) totalUsedW += betweenGap;
            });
          } else {
            totalUsedW += parseFloat(m.w) || 0;
          }
        });
        const remaining = effectiveW - totalUsedW;
        const isOverflow = remaining < 0;

        // SVG 설정
        const svgWidth = 720;
        const svgHeight = 560;
        const scale = Math.min((svgWidth - 100) / W, (svgHeight - 160) / H);
        const drawW = W * scale;
        const drawH = H * scale;
        const offsetX = (svgWidth - drawW) / 2;
        const offsetY = 50;

        let moduleSvg = '';

        // 상몰딩
        moduleSvg += `<rect x="${offsetX}" y="${offsetY}" width="${drawW}" height="${MOLDING_H * scale}" fill="#d4a574" stroke="#a67c52" stroke-width="1"/>
    <text x="${offsetX + drawW / 2}" y="${offsetY + (MOLDING_H * scale) / 2 + 4}" text-anchor="middle" font-size="9" fill="#fff">상몰딩 ${MOLDING_H}</text>`;

        // 좌측 마감
        if (fL > 0) {
          moduleSvg += `<rect x="${offsetX}" y="${offsetY + MOLDING_H * scale}" width="${fL * scale}" height="${drawH - MOLDING_H * scale}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>
      <text x="${offsetX + (fL * scale) / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="9" fill="#666">${fL}</text>`;
        }
        // 우측 마감
        if (fR > 0) {
          moduleSvg += `<rect x="${offsetX + drawW - fR * scale}" y="${offsetY + MOLDING_H * scale}" width="${fR * scale}" height="${drawH - MOLDING_H * scale}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>
      <text x="${offsetX + drawW - (fR * scale) / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="9" fill="#666">${fR}</text>`;
        }

        // 상부장 결합
        const contentStartY = offsetY + MOLDING_H * scale;
        const upperH_scaled = upperDoorH * scale;
        let upperX = offsetX + fL * scale;

        // 상부장 정보 수집
        let upperCabinets = [];
        allModules.forEach((mod) => {
          if (mod.type === 'fridge') {
            const sideGap = mod.sideGap || 50;
            const betweenGap = mod.betweenGap || 0;
            const units = mod.units || [{ name: mod.name, w: mod.w }];
            units.forEach((unit, unitIdx) => {
              let upperW = unit.w;
              if (unitIdx === 0) upperW += sideGap;
              if (unitIdx < units.length - 1) upperW += betweenGap / 2;
              if (unitIdx === units.length - 1) upperW += sideGap;
              if (unitIdx > 0) upperW += betweenGap / 2;
              upperCabinets.push({ type: 'fridge', name: unit.name, w: upperW });
            });
          } else {
            upperCabinets.push({ type: mod.type, name: mod.type === 'tall' ? '키큰장' : '홈카페', w: mod.w });
          }
        });

        // 상부장 연속 그리기
        upperCabinets.forEach((cab) => {
          const cabW = cab.w * scale;
          moduleSvg += `<rect x="${upperX}" y="${contentStartY}" width="${cabW}" height="${upperH_scaled}" fill="#dbeafe" stroke="#3b82f6" stroke-width="2" rx="2"/>
      <text x="${upperX + cabW / 2}" y="${contentStartY + upperH_scaled / 2 - 2}" text-anchor="middle" font-size="8" fill="#1d4ed8">상부장</text>
      <text x="${upperX + cabW / 2}" y="${contentStartY + upperH_scaled / 2 + 10}" text-anchor="middle" font-size="7" fill="#666">${Math.round(cab.w)}mm</text>`;
          upperX += cabW;
        });

        // 본체 영역 그리기
        let currentX = offsetX + fL * scale;
        const bodyStartY = contentStartY + upperH_scaled;
        const middleH_scaled = middleH * scale;
        const lowerH_scaled = lowerH * scale;
        const pedestalH_scaled = PEDESTAL_H * scale;

        allModules.forEach((mod) => {
          if (mod.type === 'fridge') {
            const sideGap = mod.sideGap || 50;
            const betweenGap = mod.betweenGap || 0;
            const units = mod.units || [{ name: mod.name, w: mod.w }];
            const fridgeDrawH = mod.h * scale;
            // ★ 냉장고는 바닥에서 시작 (좌대 영역까지 차지)
            const fridgeContentH = drawH - MOLDING_H * scale - upperH_scaled;
            const gapW = sideGap * scale;

            // 좌측 측면공간
            moduleSvg += `<rect x="${currentX}" y="${bodyStartY}" width="${gapW}" height="${fridgeContentH}" fill="#fef3c7" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3"/>
        <text x="${currentX + gapW / 2}" y="${bodyStartY + 12}" text-anchor="middle" font-size="7" fill="#b45309">${sideGap}</text>`;
            currentX += gapW;

            // 각 냉장고 유닛 (바닥까지)
            units.forEach((unit, unitIdx) => {
              const unitW = unit.w * scale;
              moduleSvg += `<rect x="${currentX}" y="${bodyStartY}" width="${unitW}" height="${fridgeDrawH}" fill="#e0f2fe" stroke="#0ea5e9" stroke-width="2" rx="3"/>
          <text x="${currentX + unitW / 2}" y="${bodyStartY + fridgeDrawH / 2 - 6}" text-anchor="middle" font-size="10" fill="#0369a1" font-weight="bold">🧊 ${unit.name}</text>
          <text x="${currentX + unitW / 2}" y="${bodyStartY + fridgeDrawH / 2 + 10}" text-anchor="middle" font-size="8" fill="#666">${unit.w}×${mod.h}</text>`;
              moduleSvg += `<text x="${currentX + unitW / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="9" fill="#0ea5e9">${unit.w}</text>`;
              currentX += unitW;

              if (unitIdx < units.length - 1 && betweenGap > 0) {
                const bGapW = betweenGap * scale;
                moduleSvg += `<rect x="${currentX}" y="${bodyStartY}" width="${bGapW}" height="${fridgeContentH}" fill="#fed7aa" stroke="#ea580c" stroke-width="1" stroke-dasharray="2"/>
            <text x="${currentX + bGapW / 2}" y="${bodyStartY + fridgeContentH / 2}" text-anchor="middle" font-size="7" fill="#c2410c" transform="rotate(-90, ${currentX + bGapW / 2}, ${bodyStartY + fridgeContentH / 2})">${betweenGap}</text>`;
                currentX += bGapW;
              }
            });

            // 우측 측면공간
            moduleSvg += `<rect x="${currentX}" y="${bodyStartY}" width="${gapW}" height="${fridgeContentH}" fill="#fef3c7" stroke="#f59e0b" stroke-width="1" stroke-dasharray="3"/>
        <text x="${currentX + gapW / 2}" y="${bodyStartY + 12}" text-anchor="middle" font-size="7" fill="#b45309">${sideGap}</text>`;
            currentX += gapW;
          } else {
            // 키큰장/홈카페장
            const modW = mod.w * scale;
            const isEL = mod.isEL;

            if (mod.type === 'tall') {
              // 키큰장: 중간장 + 하부장 + 좌대
              // EL 모듈들이 있으면 개별 렌더링, 없으면 기본 중간장 표시
              if (mod.elModules && mod.elModules.length > 0) {
                let elY = bodyStartY;
                let usedH = 0;
                mod.elModules.forEach((elMod, elIdx) => {
                  const elModH_scaled = (elMod.h / middleH) * middleH_scaled;
                  const isOpen = elMod.type === 'open';
                  const isEL = elMod.isEL === true; // 기본값 false (기본모듈)
                  let fillColor, strokeColor, label, labelColor;
                  if (isOpen) {
                    fillColor = '#fef3c7';
                    strokeColor = '#f59e0b';
                    label = '📂';
                    labelColor = '#b45309';
                  } else if (isEL) {
                    fillColor = '#dcfce7';
                    strokeColor = '#10b981';
                    label = '⚡';
                    labelColor = '#065f46';
                  } else {
                    fillColor = '#f3f4f6';
                    strokeColor = '#9ca3af';
                    label = '📦';
                    labelColor = '#4b5563';
                  }
                  moduleSvg += `<rect x="${currentX}" y="${elY}" width="${modW}" height="${elModH_scaled}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="2"/>
              <text x="${currentX + modW / 2}" y="${elY + elModH_scaled / 2}" text-anchor="middle" font-size="9" fill="${labelColor}" font-weight="bold">${label} ${elMod.h}</text>`;
                  elY += elModH_scaled;
                  usedH += elMod.h;
                });
                // 남은 중간장 공간
                const remainingH = middleH - usedH;
                if (remainingH > 0) {
                  const remainingH_scaled = (remainingH / middleH) * middleH_scaled;
                  moduleSvg += `<rect x="${currentX}" y="${elY}" width="${modW}" height="${remainingH_scaled}" fill="#f0fdf4" stroke="#86efac" stroke-width="1" stroke-dasharray="3"/>
              <text x="${currentX + modW / 2}" y="${elY + remainingH_scaled / 2}" text-anchor="middle" font-size="7" fill="#16a34a">잔여 ${remainingH}</text>`;
                }
              } else {
                // EL 모듈 없을 때 기본 중간장 표시
                const midColor = mod.isEL ? '#dcfce7' : '#dcfce7';
                const midLabel = mod.isEL ? '⚡ EL장' : '🗄️ 중간장';
                moduleSvg += `<rect x="${currentX}" y="${bodyStartY}" width="${modW}" height="${middleH_scaled}" fill="${midColor}" stroke="#10b981" stroke-width="2" rx="2"/>
            <text x="${currentX + modW / 2}" y="${bodyStartY + middleH_scaled / 2 - 8}" text-anchor="middle" font-size="10" fill="#065f46" font-weight="bold">${midLabel}</text>
            <text x="${currentX + modW / 2}" y="${bodyStartY + middleH_scaled / 2 + 6}" text-anchor="middle" font-size="8" fill="#666">${mod.w}×${middleH}</text>
            <text x="${currentX + modW / 2}" y="${bodyStartY + middleH_scaled - 8}" text-anchor="middle" font-size="7" fill="#888">${EL_DOOR_TYPES.find((t) => t.id === mod.doorType)?.name || '여닫이'}</text>`;
              }

              // 하부장
              const lowerColor =
                mod.lowerType === 'robot'
                  ? '#fef3c7'
                  : mod.lowerType === 'rice'
                    ? '#fee2e2'
                    : mod.lowerType === 'foodwaste'
                      ? '#dcfce7'
                      : '#f3f4f6';
              const lowerStroke =
                mod.lowerType === 'robot'
                  ? '#f59e0b'
                  : mod.lowerType === 'rice'
                    ? '#ef4444'
                    : mod.lowerType === 'foodwaste'
                      ? '#22c55e'
                      : '#6b7280';
              const lowerIcon = LOWER_MODULE_TYPES.find((t) => t.id === mod.lowerType)?.icon || '🗄️';
              moduleSvg += `<rect x="${currentX}" y="${bodyStartY + middleH_scaled}" width="${modW}" height="${lowerH_scaled}" fill="${lowerColor}" stroke="${lowerStroke}" stroke-width="2" rx="2"/>
          <text x="${currentX + modW / 2}" y="${bodyStartY + middleH_scaled + lowerH_scaled / 2}" text-anchor="middle" font-size="9" fill="${lowerStroke}">${lowerIcon} 하부장</text>`;

              moduleSvg += `<rect x="${currentX}" y="${bodyStartY + middleH_scaled + lowerH_scaled}" width="${modW}" height="${pedestalH_scaled}" fill="#d1d5db" stroke="#9ca3af" stroke-width="1"/>`;
              moduleSvg += `<text x="${currentX + modW / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="9" fill="#10b981">${mod.w}${mod.isFixed ? '🔒' : ''}</text>`;

            } else if (mod.type === 'homecafe') {
              // 홈카페장: 중간장 + 하부장 + 좌대 (키큰장과 동일 구조)
              // EL 모듈들이 있으면 개별 렌더링, 없으면 기본 표시
              if (mod.elModules && mod.elModules.length > 0) {
                let elY = bodyStartY;
                let usedH = 0;
                mod.elModules.forEach((elMod, elIdx) => {
                  const elModH_scaled = (elMod.h / middleH) * middleH_scaled;
                  const isOpen = elMod.type === 'open';
                  const isEL = elMod.isEL === true; // 기본값 false (기본모듈)
                  let fillColor, strokeColor, label, labelColor;
                  if (isOpen) {
                    fillColor = '#fef3c7';
                    strokeColor = '#f59e0b';
                    label = '📂';
                    labelColor = '#b45309';
                  } else if (isEL) {
                    fillColor = '#f3e8ff';
                    strokeColor = '#8b5cf6';
                    label = '⚡';
                    labelColor = '#6b21a8';
                  } else {
                    fillColor = '#f3f4f6';
                    strokeColor = '#9ca3af';
                    label = '📦';
                    labelColor = '#4b5563';
                  }
                  moduleSvg += `<rect x="${currentX}" y="${elY}" width="${modW}" height="${elModH_scaled}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="2"/>
              <text x="${currentX + modW / 2}" y="${elY + elModH_scaled / 2}" text-anchor="middle" font-size="9" fill="${labelColor}" font-weight="bold">${label} ${elMod.h}</text>`;
                  elY += elModH_scaled;
                  usedH += elMod.h;
                });
                const remainingH = middleH - usedH;
                if (remainingH > 0) {
                  const remainingH_scaled = (remainingH / middleH) * middleH_scaled;
                  moduleSvg += `<rect x="${currentX}" y="${elY}" width="${modW}" height="${remainingH_scaled}" fill="#faf5ff" stroke="#c4b5fd" stroke-width="1" stroke-dasharray="3"/>
              <text x="${currentX + modW / 2}" y="${elY + remainingH_scaled / 2}" text-anchor="middle" font-size="7" fill="#7c3aed">잔여 ${remainingH}</text>`;
                }
              } else {
                const midColor = '#f3e8ff';
                const midStroke = '#8b5cf6';
                const midLabel = '☕ 홈카페';
                moduleSvg += `<rect x="${currentX}" y="${bodyStartY}" width="${modW}" height="${middleH_scaled}" fill="${midColor}" stroke="${midStroke}" stroke-width="2" rx="2"/>
            <text x="${currentX + modW / 2}" y="${bodyStartY + middleH_scaled / 2 - 4}" text-anchor="middle" font-size="10" fill="#6b21a8" font-weight="bold">${midLabel}</text>
            <text x="${currentX + modW / 2}" y="${bodyStartY + middleH_scaled / 2 + 10}" text-anchor="middle" font-size="8" fill="#666">${mod.w}×${middleH}</text>`;
              }

              // 홈카페 하부장
              const cafeLowerColor =
                mod.lowerType === 'robot'
                  ? '#fef3c7'
                  : mod.lowerType === 'rice'
                    ? '#fee2e2'
                    : mod.lowerType === 'foodwaste'
                      ? '#dcfce7'
                      : '#ede9fe';
              const cafeLowerStroke =
                mod.lowerType === 'robot'
                  ? '#f59e0b'
                  : mod.lowerType === 'rice'
                    ? '#ef4444'
                    : mod.lowerType === 'foodwaste'
                      ? '#22c55e'
                      : '#a78bfa';
              const cafeLowerIcon = LOWER_MODULE_TYPES.find((t) => t.id === mod.lowerType)?.icon || '🗄️';
              moduleSvg += `<rect x="${currentX}" y="${bodyStartY + middleH_scaled}" width="${modW}" height="${lowerH_scaled}" fill="${cafeLowerColor}" stroke="${cafeLowerStroke}" stroke-width="2" rx="2"/>
          <text x="${currentX + modW / 2}" y="${bodyStartY + middleH_scaled + lowerH_scaled / 2}" text-anchor="middle" font-size="9" fill="${cafeLowerStroke}">${cafeLowerIcon} 하부장</text>`;

              moduleSvg += `<rect x="${currentX}" y="${bodyStartY + middleH_scaled + lowerH_scaled}" width="${modW}" height="${pedestalH_scaled}" fill="#d1d5db" stroke="#9ca3af" stroke-width="1"/>`;
              moduleSvg += `<text x="${currentX + modW / 2}" y="${offsetY + drawH + 15}" text-anchor="middle" font-size="9" fill="#8b5cf6">${mod.w}${mod.isFixed ? '🔒' : ''}</text>`;

            }
            currentX += modW;
          }
        });

        // 총 너비
        moduleSvg += `<line x1="${offsetX}" y1="${offsetY + drawH + 35}" x2="${offsetX + drawW}" y2="${offsetY + drawH + 35}" stroke="#333" stroke-width="1" marker-start="url(#arrowL)" marker-end="url(#arrowR)"/>
    <text x="${offsetX + drawW / 2}" y="${offsetY + drawH + 50}" text-anchor="middle" font-size="12" fill="#333" font-weight="bold">${W}mm</text>`;

        // 냉장고 모델 목록
        const brand = item.specs.fridgeBrand || 'LG';
        const brandData = FRIDGE_DATA[brand];

        let fridgeButtonsHtml = '';
        Object.keys(brandData.categories).forEach((catName) => {
          fridgeButtonsHtml += `<div class="fridge-cat-group"><div class="fridge-cat-title">${catName}</div><div class="fridge-btn-row">`;
          brandData.categories[catName].forEach((model) => {
            const isSelected = fridgeMod && fridgeMod.modelId === model.id;
            fridgeButtonsHtml += `<button class="fridge-model-btn ${isSelected ? 'selected' : ''}" onclick="selectFridgeModel(${item.uniqueId}, '${model.id}')">${model.name}<br><span style="font-size:9px;color:#999;">${model.w}×${model.h}</span></button>`;
          });
          fridgeButtonsHtml += `</div></div>`;
        });

        // 모듈 카드 HTML
        const moduleCardsHtml = allModules
          .map((mod, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === allModules.length - 1;

            if (mod.type === 'fridge') {
              const sideGap = mod.sideGap || 50;
              const betweenGap = mod.betweenGap || 0;
              const units = mod.units || [{ w: mod.w }];
              let upperInfo = units
                .map((u, i) => {
                  let uw = u.w;
                  if (i === 0) uw += sideGap;
                  if (i < units.length - 1) uw += betweenGap / 2;
                  if (i === units.length - 1) uw += sideGap;
                  if (i > 0) uw += betweenGap / 2;
                  return Math.round(uw);
                })
                .join('+');

              return `<div class="module-card" style="border-left:3px solid #0ea5e9;">
        <div class="module-order-btns">
          <button class="order-btn" onclick="moveFridgeModule(${item.uniqueId}, ${mod.id}, -1)" ${isFirst ? 'disabled' : ''}>▲</button>
          <button class="order-btn" onclick="moveFridgeModule(${item.uniqueId}, ${mod.id}, 1)" ${isLast ? 'disabled' : ''}>▼</button>
        </div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:12px;">🧊 ${mod.name}</div>
          <div style="font-size:10px;color:#666;">${mod.w} × ${mod.h}mm | 유닛: ${units.length}개</div>
          <div style="font-size:9px;color:#888;">측면: ${sideGap}mm | 사이: ${betweenGap}mm</div>
          <div style="font-size:9px;color:#3b82f6;">상부장: ${upperInfo}mm</div>
        </div>
        <button class="btn-delete" onclick="removeFridgeModule(${item.uniqueId}, ${mod.id})">×</button>
      </div>`;
            } else {
              const typeInfo =
                mod.type === 'tall'
                  ? { name: '키큰장', icon: '🗄️', color: '#10b981' }
                  : { name: '홈카페장', icon: '☕', color: '#8b5cf6' };
              const fixedClass = mod.isFixed ? 'active' : '';

              return `<div class="module-card" style="border-left:3px solid ${typeInfo.color};">
        <div class="module-order-btns">
          <button class="order-btn" onclick="moveFridgeModule(${item.uniqueId}, ${mod.id}, -1)" ${isFirst ? 'disabled' : ''}>▲</button>
          <button class="order-btn" onclick="moveFridgeModule(${item.uniqueId}, ${mod.id}, 1)" ${isLast ? 'disabled' : ''}>▼</button>
        </div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            <span style="font-weight:700;font-size:12px;">${typeInfo.icon} ${typeInfo.name}</span>
            <button class="toggle-btn ${fixedClass}" onclick="toggleFridgeModuleFixed(${item.uniqueId}, ${mod.id})">고정</button>
            <button class="el-config-btn" onclick="openELPopup(${item.uniqueId}, ${mod.id})">⚙️ 설정</button>
          </div>
          <div class="module-inline-inputs">
            <label>W</label><input type="number" value="${mod.w}" style="width:55px;" onchange="updateFridgeModuleW(${item.uniqueId}, ${mod.id}, this.value)">
            <label>도어 구분</label><select onchange="updateFridgeDoorDivision(${item.uniqueId}, ${mod.id}, this.value)">${DOOR_DIVISION_TYPES.map((t) => `<option value="${t.id}" ${mod.doorDivision === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
            <label>하부</label><select onchange="updateFridgeSideModule(${item.uniqueId}, ${mod.id}, 'lowerType', this.value)">${LOWER_MODULE_TYPES.map((t) => `<option value="${t.id}" ${mod.lowerType === t.id ? 'selected' : ''}>${t.icon}</option>`).join('')}</select>
          </div>
          ${mod.elModules && mod.elModules.length > 0 ? `<div style="font-size:9px;color:#10b981;margin-top:4px;">⚡ 모듈: ${mod.elModules.length}개</div>` : ''}
        </div>
        <button class="btn-delete" onclick="removeFridgeModule(${item.uniqueId}, ${mod.id})">×</button>
      </div>`;
            }
          })
          .join('');

        const leftDisabled =
          item.specs.finishLeftType === 'EP' || item.specs.finishLeftType === 'None' ? 'disabled' : '';
        const rightDisabled =
          item.specs.finishRightType === 'EP' || item.specs.finishRightType === 'None' ? 'disabled' : '';
        const leftWidthVal =
          item.specs.finishLeftType === 'EP'
            ? 20
            : item.specs.finishLeftType === 'None'
              ? 0
              : item.specs.finishLeftWidth || 60;
        const rightWidthVal =
          item.specs.finishRightType === 'EP'
            ? 20
            : item.specs.finishRightType === 'None'
              ? 0
              : item.specs.finishRightWidth || 60;

        ws.innerHTML = `
    <style>
      .fridge-brand-tabs{display:flex;gap:8px;margin-bottom:12px}.fridge-brand-tab{padding:8px 20px;border:2px solid #ddd;border-radius:8px;background:#f9f9f9;cursor:pointer;font-weight:600;font-size:13px}.fridge-brand-tab.active{border-color:#0ea5e9;background:#e0f2fe;color:#0369a1}.fridge-cat-group{margin-bottom:10px}.fridge-cat-title{font-size:11px;font-weight:700;color:#666;margin-bottom:5px}.fridge-btn-row{display:flex;flex-wrap:wrap;gap:5px}.fridge-model-btn{padding:5px 8px;border:1px solid #ddd;border-radius:5px;background:white;font-size:10px;cursor:pointer;min-width:80px}.fridge-model-btn:hover{border-color:#0ea5e9;background:#f0f9ff}.fridge-model-btn.selected{border-color:#0ea5e9;background:#0ea5e9;color:white}.fridge-model-btn.selected span{color:#e0f2fe!important}.module-add-btns{display:flex;gap:8px;margin-bottom:12px}.module-add-btn{flex:1;padding:10px;border:2px dashed #ccc;border-radius:8px;background:white;font-size:12px;cursor:pointer;font-weight:600}.module-add-btn:hover{border-style:solid}.module-add-btn.tall{color:#10b981;border-color:#10b981}.module-add-btn.tall:hover{background:#dcfce7}.module-add-btn.homecafe{color:#8b5cf6;border-color:#8b5cf6}.module-add-btn.homecafe:hover{background:#f3e8ff}.auto-calc-btn{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:white;border:none;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;width:100%;margin-bottom:15px}.auto-calc-btn:hover{opacity:0.9}.auto-calc-btn:disabled{background:#ccc;cursor:not-allowed}.overflow-warning{background:#fee2e2;color:#b91c1c;padding:8px 12px;border-radius:6px;font-size:11px;margin-bottom:10px}.module-inline-inputs{display:flex;align-items:center;gap:4px;font-size:10px;margin-top:4px}.module-inline-inputs input,.module-inline-inputs select{padding:2px 4px;font-size:10px;border:1px solid #ddd;border-radius:4px}.module-order-btns{display:flex;flex-direction:column;gap:2px;margin-right:8px}.order-btn{width:24px;height:20px;border:1px solid #ddd;border-radius:4px;background:#f9f9f9;cursor:pointer;font-size:10px;padding:0}.order-btn:hover:not(:disabled){background:#e0e0e0}.order-btn:disabled{opacity:0.3;cursor:not-allowed}.module-card{display:flex;align-items:center;padding:10px;background:#f9fafb;border-radius:8px;margin-bottom:8px}.height-inputs{display:flex;gap:8px;margin-top:8px;padding:8px;background:#f0f9ff;border-radius:6px;font-size:10px}.height-inputs label{color:#0369a1;font-weight:600}.height-inputs input{width:50px;padding:2px 4px;border:1px solid #0ea5e9;border-radius:4px;font-size:10px}.toggle-btn{padding:2px 6px;border:1px solid #ccc;border-radius:4px;background:#f9f9f9;font-size:9px;cursor:pointer}.toggle-btn:hover{background:#e5e5e5}.toggle-btn.active{background:#ef4444;color:white;border-color:#ef4444}.toggle-btn.el{border-color:#10b981;color:#10b981}.toggle-btn.el.active{background:#10b981;color:white}.el-config-btn{padding:2px 8px;border:1px solid #10b981;border-radius:4px;background:linear-gradient(135deg,#dcfce7 0%,#bbf7d0 100%);font-size:9px;cursor:pointer;color:#065f46;font-weight:600}.el-config-btn:hover{background:linear-gradient(135deg,#bbf7d0 0%,#86efac 100%)}.auto-calc-btn-sm{background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:white;border:none;padding:4px 10px;border-radius:6px;font-weight:600;cursor:pointer;font-size:10px}.auto-calc-btn-sm:hover{opacity:0.9}.auto-calc-btn-sm:disabled{background:#ccc;cursor:not-allowed}.fridge-position-tabs{display:flex;gap:6px;margin-bottom:12px}.fridge-position-tab{flex:1;padding:8px 10px;border:2px solid #ddd;border-radius:8px;background:#f9f9f9;cursor:pointer;font-weight:600;font-size:12px;text-align:center}.fridge-position-tab.active{border-color:#0ea5e9;background:#e0f2fe;color:#0369a1}.fridge-appliance-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:12px}.fridge-appliance-chip{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1.5px solid #e5e7eb;border-radius:6px;background:#fafafa;cursor:pointer;font-size:11px;user-select:none}.fridge-appliance-chip:hover{border-color:#9ca3af}.fridge-appliance-chip.active{border-color:#10b981;background:#ecfdf5;color:#065f46;font-weight:600}.fridge-appliance-chip input{display:none}.fridge-appliance-chip .chip-icon{font-size:14px}
    </style>
    <div class="ws-header">
      <div class="ws-title">🧊 ${item.labelName || item.name} <span class="ws-info-badge">${W} × ${H} × ${D}</span></div>
      <div style="display:flex;gap:8px;">
        <button class="btn-purple-gradient" onclick="generateAIDesign()" title="AI 디자인 이미지 생성">🎨 AI 디자인 생성</button>
        <button onclick="proceedToBOM()" style="background:linear-gradient(135deg,#4caf50,#388e3c);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;" title="자재/부자재 산출">📋 BOM 산출</button>
        <button style="background:var(--primary-color);color:white;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;" onclick="saveDesignToFile()">💾 저장</button>
        <button class="btn-back" onclick="goBackToStep1()">← 목록</button>
      </div>
    </div>
    <div class="ws-layout">
      <div class="spec-panel">
        <div class="spec-group-title">브랜드 선택</div>
        <div class="fridge-brand-tabs">
          <div class="fridge-brand-tab ${brand === 'LG' ? 'active' : ''}" onclick="changeFridgeBrand(${item.uniqueId}, 'LG')">LG</div>
          <div class="fridge-brand-tab ${brand === 'Samsung' ? 'active' : ''}" onclick="changeFridgeBrand(${item.uniqueId}, 'Samsung')">삼성</div>
        </div>
        <div class="spec-group-title">냉장고 모델 선택</div>
        <div style="max-height:200px;overflow-y:auto;padding-right:6px;margin-bottom:12px;">${fridgeButtonsHtml}</div>
        <div class="spec-group-title">설정</div>
        <div class="spec-row">
          <div class="spec-field"><label>상몰딩</label><input type="number" value="${MOLDING_H}" onchange="updateFridgeSpecWithRecalc(${item.uniqueId}, 'fridgeMoldingH', this.value)"></div>
          <div class="spec-field"><label>깊이</label><input type="number" value="${MODULE_D}" onchange="updateFridgeSpec(${item.uniqueId}, 'fridgeModuleD', this.value)"></div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>하부 다리</label><select onchange="updateFridgeLegType(${item.uniqueId}, this.value)">${FRIDGE_LEG_TYPES.map((t) => `<option value="${t.id}" ${(item.specs.fridgeLegType || 'pedestal') === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div>
          <div class="spec-field"><label>높이</label><input type="number" value="${PEDESTAL_H}" onchange="updateFridgeSpecWithRecalc(${item.uniqueId}, 'fridgePedestal', this.value)"></div>
        </div>
        <div class="spec-group-title">냉장고 위치</div>
        <div class="fridge-position-tabs">
          ${FRIDGE_POSITIONS.map((p) => `<div class="fridge-position-tab ${(item.specs.fridgePosition || 'left') === p.id ? 'active' : ''}" onclick="updateFridgePosition(${item.uniqueId}, '${p.id}')">${p.icon} ${p.name}</div>`).join('')}
        </div>
        <div class="spec-group-title">전자기기 <span style="font-size:10px;color:#888;font-weight:normal;">(이미지 생성 참고)</span></div>
        <div class="fridge-appliance-grid">
          ${FRIDGE_APPLIANCES.map((a) => {
            const selected = (item.specs.fridgeAppliances || []).includes(a.id);
            return `<label class="fridge-appliance-chip ${selected ? 'active' : ''}"><input type="checkbox" ${selected ? 'checked' : ''} onchange="toggleFridgeAppliance(${item.uniqueId}, '${a.id}')"><span class="chip-icon">${a.icon}</span><span>${a.name}</span></label>`;
          }).join('')}
        </div>
        <div class="spec-group-title">마감 설정</div>
        <div class="spec-row">
          <div class="spec-field"><label>좌측</label><select onchange="updateFridgeFinish(${item.uniqueId}, 'Left', this.value)">${FINISH_TYPES.map((t) => `<option value="${t.id}" ${item.specs.finishLeftType === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div>
          <div class="spec-field"><label>길이</label><input type="number" value="${leftWidthVal}" onchange="updateFridgeSpec(${item.uniqueId}, 'finishLeftWidth', this.value)" ${leftDisabled}></div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>우측</label><select onchange="updateFridgeFinish(${item.uniqueId}, 'Right', this.value)">${FINISH_TYPES.map((t) => `<option value="${t.id}" ${item.specs.finishRightType === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div>
          <div class="spec-field"><label>길이</label><input type="number" value="${rightWidthVal}" onchange="updateFridgeSpec(${item.uniqueId}, 'finishRightWidth', this.value)" ${rightDisabled}></div>
        </div>
        <div style="font-size:9px;color:#888;margin-top:4px;">※ 기본값: 몰딩=60, 휠라=60, EP=20, 없음=0</div>
      </div>
      <div class="module-panel">
        <div class="front-view-section" style="margin-bottom:12px;">
          <div style="font-size:14px;font-weight:bold;color:#333;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span>📐 ${item.specs.fridgeViewMode === 'top' ? 'Top View' : 'Front View'}</span>
              <span style="font-size:11px;color:#888;font-weight:normal;">${item.specs.fridgeViewMode === 'top' ? '(상면도)' : '(도어 기준)'}</span>
            </div>
            <div style="display:flex;gap:4px;">
              <button onclick="switchFridgeView(${item.uniqueId}, 'front')" class="toggle-btn ${item.specs.fridgeViewMode !== 'top' ? 'active' : ''}" style="padding:3px 10px;font-size:10px;">📐 Front</button>
              <button onclick="switchFridgeView(${item.uniqueId}, 'top')" class="toggle-btn ${item.specs.fridgeViewMode === 'top' ? 'active' : ''}" style="padding:3px 10px;font-size:10px;">⬇️ Top</button>
            </div>
          </div>
          ${item.specs.fridgeViewMode === 'top' ? renderFridgeTopView(item) : `<div style="text-align:center;">
            <svg width="${svgWidth}" height="${svgHeight + 20}" style="background:#fafafa;border-radius:8px;border:1px solid #eee;">
              <defs><marker id="arrowL" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M6,0 L0,3 L6,6" fill="none" stroke="#333"/></marker><marker id="arrowR" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#333"/></marker></defs>
              ${moduleSvg}
            </svg>
          </div>`}
        </div>
        ${isOverflow ? `<div class="overflow-warning">⚠️ 유효공간(${effectiveW}mm)을 ${Math.abs(remaining)}mm 초과!</div>` : ''}
        <div class="module-section">
          <div class="module-section-header" style="background:linear-gradient(135deg,#e0f2fe,#f0f9ff);color:#0369a1;border-left:4px solid #0ea5e9;">
            <div class="section-title-row" style="display:flex;align-items:center;justify-content:space-between;width:100%;">
              <div><span>📦 모듈 구성</span><span style="font-size:11px;font-weight:normal;color:#666;margin-left:8px;">유효: ${effectiveW}mm</span></div>
              <div style="display:flex;align-items:center;gap:8px;">
                <span class="section-remaining" style="color:${isOverflow ? '#ef4444' : '#10b981'};font-size:11px;">잔여: ${remaining}mm</span>
                <button class="auto-calc-btn-sm" onclick="autoCalculateFridge(${item.uniqueId})" ${allModules.length === 0 ? 'disabled' : ''}>⚡ 자동계산</button>
                <button class="auto-calc-btn-sm" onclick="clearAllModules(${item.uniqueId})" style="background:#fff;color:#dc3545;border:1px solid #f5c6cb;">🗑 전체 제거</button>
              </div>
            </div>
          </div>
          <div class="height-inputs">
            <label>상부장H</label><input type="number" value="${Math.round(upperDoorH)}" onchange="updateFridgeHeightWithRecalc(${item.uniqueId}, 'fridgeUpperH', this.value)">
            <label>중간장H</label><input type="number" value="${Math.round(middleH)}" onchange="updateFridgeHeightWithRecalc(${item.uniqueId}, 'fridgeMiddleH', this.value)">
            <label>하부장H</label><input type="number" value="${Math.round(lowerH)}" onchange="updateFridgeHeightWithRecalc(${item.uniqueId}, 'fridgeLowerH', this.value)">
          </div>
          <div class="module-add-btns" style="margin-top:10px;">
            <button class="module-add-btn tall" onclick="addFridgeSideModule(${item.uniqueId}, 'tall')">🗄️ + 키큰장</button>
            <button class="module-add-btn homecafe" onclick="addFridgeSideModule(${item.uniqueId}, 'homecafe')">☕ + 홈카페장</button>
          </div>
          ${moduleCardsHtml || '<div style="padding:15px;text-align:center;color:#999;font-size:11px;">냉장고를 선택하거나 모듈을 추가하세요</div>'}
        </div>
      </div>
    </div>
  `;
      }

      function changeFridgeBrand(itemUniqueId, brand) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          item.specs.fridgeBrand = brand;
          item.modules = item.modules.filter((m) => m.type !== 'fridge');
          renderWorkspaceContent(item);
        }
      }

      function selectFridgeModel(itemUniqueId, modelId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const brand = item.specs.fridgeBrand || 'LG';
        let model = null;
        Object.values(FRIDGE_DATA[brand].categories).forEach((cat) => {
          const found = cat.find((m) => m.id === modelId);
          if (found) model = found;
        });
        if (!model) return;

        item.modules = item.modules.filter((m) => m.type !== 'fridge');
        const existingModules = item.modules.sort((a, b) => (a.order || 0) - (b.order || 0));
        const position = item.specs.fridgePosition || 'left';
        // 왼쪽: 냉장고가 order=1, 나머지는 뒤로. 오른쪽: 냉장고가 마지막.
        const fridgeOrder = position === 'left' ? 1 : existingModules.length + 1;
        existingModules.forEach((m, idx) => {
          m.order = position === 'left' ? idx + 2 : idx + 1;
        });

        item.modules.push({
          id: Date.now(),
          modelId: model.id,
          type: 'fridge',
          name: model.name,
          w: model.w,
          h: model.h,
          d: model.d,
          line: model.line,
          sideGap: model.sideGap,
          betweenGap: model.betweenGap,
          units: model.units,
          order: fridgeOrder,
        });

        // 높이 자동 재계산
        recalcFridgeHeights(item);
        renderWorkspaceContent(item);
      }

      // ★ 높이 자동 재계산 함수
      function recalcFridgeHeights(item) {
        const H = parseFloat(item.h) || 0;
        const MOLDING_H = parseFloat(item.specs.fridgeMoldingH) || FRIDGE_RULES.MOLDING_H;
        const PEDESTAL_H = parseFloat(item.specs.fridgePedestal) || FRIDGE_RULES.PEDESTAL_H;
        const fridgeMod = item.modules.find((m) => m.type === 'fridge');

        if (fridgeMod) {
          // 상부장 높이 = 전체 - 냉장고높이 - 상단간격 - 상몰딩
          const calcUpperH = Math.max(
            0,
            Math.min(FRIDGE_RULES.MAX_UPPER_H, H - fridgeMod.h - FRIDGE_RULES.TOP_GAP - MOLDING_H)
          );
          item.specs.fridgeUpperH = calcUpperH;

          // 모듈 본체 영역 = 전체 - 상몰딩 - 상부장 - 좌대
          const moduleBodyH = H - MOLDING_H - calcUpperH - PEDESTAL_H;
          item.specs.fridgeMiddleH = Math.floor(moduleBodyH * 0.55);
          item.specs.fridgeLowerH = Math.floor(moduleBodyH - item.specs.fridgeMiddleH);
        }
      }

      function removeFridgeModule(itemUniqueId, modId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          item.modules = item.modules.filter((m) => m.id !== modId);
          item.modules.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((m, idx) => (m.order = idx + 1));
          renderWorkspaceContent(item);
        }
      }

      function addFridgeSideModule(itemUniqueId, type) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const H = parseFloat(item.h) || 2290;
        const MODULE_D = parseFloat(item.specs.fridgeModuleD) || FRIDGE_RULES.MODULE_D;
        const defaultW = type === 'tall' ? FRIDGE_RULES.EL_W : FRIDGE_RULES.HOMECAFE_W;
        const maxOrder = item.modules.length > 0 ? Math.max(...item.modules.map((m) => m.order || 0)) : 0;
        item.modules.push({
          id: Date.now(),
          type: type,
          name: type === 'tall' ? '키큰장' : '홈카페장',
          order: maxOrder + 1,
          w: defaultW,
          h: H,
          d: MODULE_D,
          doorType: 'swing',
          lowerType: 'default',
          isFixed: false,
          isEL: false,
        });
        renderWorkspaceContent(item);
      }

      function moveFridgeModule(itemUniqueId, modId, direction) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const modules = item.modules.sort((a, b) => (a.order || 0) - (b.order || 0));
        const idx = modules.findIndex((m) => m.id === modId);
        if (idx === -1) return;
        if (direction === -1 && idx === 0) return;
        if (direction === 1 && idx === modules.length - 1) return;
        const swapIdx = idx + direction;
        const tempOrder = modules[idx].order;
        modules[idx].order = modules[swapIdx].order;
        modules[swapIdx].order = tempOrder;
        renderWorkspaceContent(item);
      }

      function updateFridgeModuleW(itemUniqueId, modId, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod.w = parseFloat(value) || 0;
          mod.isFixed = true;
          renderWorkspaceContent(item);
        }
      }

      function toggleFridgeModuleFixed(itemUniqueId, modId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod.isFixed = !mod.isFixed;
          renderWorkspaceContent(item);
        }
      }

      function updateFridgeSideModule(itemUniqueId, modId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod[field] = value;
          renderWorkspaceContent(item);
        }
      }

      function updateFridgeDoorDivision(itemUniqueId, modId, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod.doorDivision = value;
          renderWorkspaceContent(item);
        }
      }

      function toggleFridgeModuleEL(itemUniqueId, modId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (mod) {
          mod.hasEL = !mod.hasEL;
          // EL장이 없을 때 활성화하면 기본 EL모듈 추가
          if (mod.hasEL && (!mod.elModules || mod.elModules.length === 0)) {
            mod.elModules = [{ id: 1, type: 'open', h: 450 }];
          }
          renderWorkspaceContent(item);
        }
      }

      function updateFridgeSpec(itemUniqueId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          item.specs[field] = parseFloat(value) || value;
          renderWorkspaceContent(item);
        }
      }

      // 상몰딩, 좌대 변경 시 높이 재계산
      function updateFridgeSpecWithRecalc(itemUniqueId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (item) {
          item.specs[field] = parseFloat(value) || value;
          recalcFridgeHeights(item);
          renderWorkspaceContent(item);
        }
      }

      // 높이 값 변경 시 연동 계산
      function updateFridgeHeightWithRecalc(itemUniqueId, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        const H = parseFloat(item.h) || 0;
        const MOLDING_H = parseFloat(item.specs.fridgeMoldingH) || FRIDGE_RULES.MOLDING_H;
        const PEDESTAL_H = parseFloat(item.specs.fridgePedestal) || FRIDGE_RULES.PEDESTAL_H;
        const newVal = parseFloat(value) || 0;

        if (field === 'fridgeUpperH') {
          item.specs.fridgeUpperH = newVal;
          const moduleBodyH = H - MOLDING_H - newVal - PEDESTAL_H;
          item.specs.fridgeMiddleH = Math.floor(moduleBodyH * 0.55);
          item.specs.fridgeLowerH = Math.floor(moduleBodyH - item.specs.fridgeMiddleH);
        } else if (field === 'fridgeMiddleH') {
          item.specs.fridgeMiddleH = newVal;
          const upperH = parseFloat(item.specs.fridgeUpperH) || 0;
          const moduleBodyH = H - MOLDING_H - upperH - PEDESTAL_H;
          item.specs.fridgeLowerH = Math.floor(moduleBodyH - newVal);
        } else if (field === 'fridgeLowerH') {
          item.specs.fridgeLowerH = newVal;
          const upperH = parseFloat(item.specs.fridgeUpperH) || 0;
          const moduleBodyH = H - MOLDING_H - upperH - PEDESTAL_H;
          item.specs.fridgeMiddleH = Math.floor(moduleBodyH - newVal);
        }

        renderWorkspaceContent(item);
      }

      function updateFridgeFinish(itemUniqueId, side, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs[`finish${side}Type`] = value;
        // 마감재 기본값: 몰딩=60, 휠라=60, EP=20, 없음=0
        const finishType = FINISH_TYPES.find((t) => t.id === value);
        if (finishType) item.specs[`finish${side}Width`] = finishType.defaultW;
        renderWorkspaceContent(item);
      }

      function updateFridgeLegType(itemUniqueId, value) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs.fridgeLegType = value;
        const legType = FRIDGE_LEG_TYPES.find((t) => t.id === value);
        if (legType) item.specs.fridgePedestal = legType.defaultH;
        recalcFridgeHeights(item);
        renderWorkspaceContent(item);
      }

      // ★ 냉장고 위치 변경: 기존 냉장고 모듈을 해당 끝으로 이동
      function updateFridgePosition(itemUniqueId, position) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs.fridgePosition = position;
        const fridgeMod = item.modules.find((m) => m.type === 'fridge');
        if (fridgeMod) {
          const others = item.modules
            .filter((m) => m.type !== 'fridge')
            .sort((a, b) => (a.order || 0) - (b.order || 0));
          if (position === 'left') {
            fridgeMod.order = 1;
            others.forEach((m, idx) => (m.order = idx + 2));
          } else {
            others.forEach((m, idx) => (m.order = idx + 1));
            fridgeMod.order = others.length + 1;
          }
        }
        renderWorkspaceContent(item);
      }

      // ★ 전자기기 선택 토글
      function toggleFridgeAppliance(itemUniqueId, applianceId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (!Array.isArray(item.specs.fridgeAppliances)) item.specs.fridgeAppliances = [];
        const idx = item.specs.fridgeAppliances.indexOf(applianceId);
        if (idx === -1) item.specs.fridgeAppliances.push(applianceId);
        else item.specs.fridgeAppliances.splice(idx, 1);
        renderWorkspaceContent(item);
      }

      function autoCalculateFridge(itemUniqueId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item || item.modules.length === 0) {
          alert('모듈을 먼저 추가해주세요.');
          return;
        }

        const W = parseFloat(item.w) || 0;
        const fL =
          item.specs.finishLeftType !== 'None'
            ? item.specs.finishLeftType === 'EP'
              ? 20
              : parseFloat(item.specs.finishLeftWidth) || 60
            : 0;
        const fR =
          item.specs.finishRightType !== 'None'
            ? item.specs.finishRightType === 'EP'
              ? 20
              : parseFloat(item.specs.finishRightWidth) || 60
            : 0;
        const effectiveW = W - fL - fR;

        const modules = item.modules.sort((a, b) => (a.order || 0) - (b.order || 0));
        let fixedW = 0,
          adjustableCount = 0;

        modules.forEach((mod) => {
          if (mod.type === 'fridge') {
            const sideGap = mod.sideGap || 50;
            const betweenGap = mod.betweenGap || 0;
            const units = mod.units || [{ w: mod.w }];
            fixedW += sideGap * 2;
            units.forEach((u, idx) => {
              fixedW += u.w;
              if (idx < units.length - 1) fixedW += betweenGap;
            });
          } else if (mod.isFixed) {
            fixedW += parseFloat(mod.w) || 0;
          } else {
            adjustableCount++;
          }
        });

        if (adjustableCount === 0) {
          alert('조절 가능한 모듈이 없습니다.');
          return;
        }
        const remainingW = effectiveW - fixedW;
        if (remainingW <= 0) {
          alert('유효공간이 부족합니다.');
          return;
        }
        const perModuleW = Math.floor(remainingW / adjustableCount);
        if (perModuleW < 300) {
          alert(`각 모듈에 ${perModuleW}mm만 할당 가능합니다.`);
          return;
        }

        modules.forEach((mod) => {
          if (mod.type !== 'fridge' && !mod.isFixed) mod.w = perModuleW;
        });
        renderWorkspaceContent(item);
      }

      // 초기화
      initCategoryGrid();

      // ============================================================
      // EL장 팝업 기능
      // ============================================================
      let currentELPopup = { itemId: null, modId: null };

      function openELPopup(itemUniqueId, modId) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === modId);
        if (!mod) return;

        currentELPopup = { itemId: itemUniqueId, modId: modId };

        // EL 모듈 배열 초기화
        if (!mod.elModules) mod.elModules = [];

        // 팝업 HTML 생성
        renderELPopup(item, mod);
      }

      function renderELPopup(item, mod) {
        // 기존 팝업 제거
        const existingPopup = document.getElementById('el-popup-overlay');
        if (existingPopup) existingPopup.remove();

        // 키큰장 전체 크기 계산
        const H = parseFloat(item.h) || 0;
        const MOLDING_H = parseFloat(item.specs.fridgeMoldingH) || 50;
        const PEDESTAL_H = parseFloat(item.specs.fridgePedestal) || 60;
        const upperDoorH = parseFloat(item.specs.fridgeUpperH) || 300;
        const moduleBodyH = H - MOLDING_H - upperDoorH - PEDESTAL_H;
        const middleH = parseFloat(item.specs.fridgeMiddleH) || Math.floor(moduleBodyH * 0.55);
        const lowerH = parseFloat(item.specs.fridgeLowerH) || Math.floor(moduleBodyH * 0.45);
        const modW = mod.w;

        // 하부장 높이 (870mm = 하부장 + 좌대)
        const lowerWithPedestal = lowerH + PEDESTAL_H;

        // 키큰장 전체 높이 (상부장 제외, 중간장 + 하부장 + 좌대)
        const tallTotalH = middleH + lowerH + PEDESTAL_H;

        // SVG 프론트뷰 생성 - 크기 최적화
        const svgWidth = 220;
        const svgHeight = 480;
        const scale = Math.min((svgWidth - 40) / modW, (svgHeight - 100) / tallTotalH);
        const drawW = modW * scale;
        const offsetX = (svgWidth - drawW) / 2;
        const offsetY = 50;

        // 스케일된 높이
        const middleH_s = middleH * scale;
        const lowerH_s = lowerH * scale;
        const pedestalH_s = PEDESTAL_H * scale;

        let moduleSvg = '';
        let currentY = offsetY;
        let usedH = 0;

        // 중간장 영역 - EL 모듈들 그리기
        if (mod.elModules && mod.elModules.length > 0) {
          mod.elModules.forEach((elMod, idx) => {
            const elModH = elMod.h * scale;
            const isOpen = elMod.type === 'open';
            const isEL = elMod.isEL === true; // 기본값 false (기본모듈)
            // EL장: 녹색, 기본모듈: 회색, 오픈장: 노란색
            let fillColor, strokeColor, labelColor, icon, label;
            if (isOpen) {
              fillColor = '#fef3c7';
              strokeColor = '#f59e0b';
              labelColor = '#b45309';
              icon = '📂';
              label = '오픈장';
            } else if (isEL) {
              fillColor = '#dcfce7';
              strokeColor = '#10b981';
              labelColor = '#065f46';
              icon = '⚡';
              label = 'EL장';
            } else {
              fillColor = '#f3f4f6';
              strokeColor = '#9ca3af';
              labelColor = '#4b5563';
              icon = '📦';
              label = '모듈';
            }
            const doorName = EL_DOOR_TYPES.find((t) => t.id === elMod.doorType)?.name || '여닫이';

            moduleSvg += `
        <rect x="${offsetX}" y="${currentY}" width="${drawW}" height="${elModH}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="4"/>
        <text x="${offsetX + drawW / 2}" y="${currentY + elModH / 2 - 6}" text-anchor="middle" font-size="11" fill="${labelColor}" font-weight="bold">${icon} ${label}</text>
        <text x="${offsetX + drawW / 2}" y="${currentY + elModH / 2 + 8}" text-anchor="middle" font-size="9" fill="#666">${!isOpen && isEL ? doorName + ' | ' : ''}${elMod.h}mm</text>
      `;
            currentY += elModH;
            usedH += elMod.h;
          });
        }

        // 중간장 남은 공간
        const remainingH = middleH - usedH;
        if (remainingH > 0) {
          const remainingScaled = remainingH * scale;
          moduleSvg += `
      <rect x="${offsetX}" y="${currentY}" width="${drawW}" height="${remainingScaled}" fill="#f0fdf4" stroke="#86efac" stroke-width="1" stroke-dasharray="4"/>
      <text x="${offsetX + drawW / 2}" y="${currentY + remainingScaled / 2}" text-anchor="middle" font-size="11" fill="#16a34a">중간장 잔여: ${Math.round(remainingH)}mm</text>
    `;
          currentY += remainingScaled;
        }

        // 하부장
        const lowerIcon = LOWER_MODULE_TYPES.find((t) => t.id === mod.lowerType)?.icon || '🗄️';
        const lowerName = LOWER_MODULE_TYPES.find((t) => t.id === mod.lowerType)?.name || '기본';
        moduleSvg += `
    <rect x="${offsetX}" y="${currentY}" width="${drawW}" height="${lowerH_s}" fill="#f3f4f6" stroke="#6b7280" stroke-width="2" rx="4"/>
    <text x="${offsetX + drawW / 2}" y="${currentY + lowerH_s / 2 - 4}" text-anchor="middle" font-size="11" fill="#374151" font-weight="bold">${lowerIcon} 하부장</text>
    <text x="${offsetX + drawW / 2}" y="${currentY + lowerH_s / 2 + 12}" text-anchor="middle" font-size="9" fill="#666">${lowerH}mm</text>
  `;
        currentY += lowerH_s;

        // 좌대
        moduleSvg += `
    <rect x="${offsetX}" y="${currentY}" width="${drawW}" height="${pedestalH_s}" fill="#d1d5db" stroke="#9ca3af" stroke-width="1" rx="2"/>
    <text x="${offsetX + drawW / 2}" y="${currentY + pedestalH_s / 2 + 3}" text-anchor="middle" font-size="8" fill="#6b7280">좌대 ${PEDESTAL_H}mm</text>
  `;

        // 치수선
        const totalDrawH = middleH_s + lowerH_s + pedestalH_s;
        moduleSvg += `
    <line x1="${offsetX + drawW + 15}" y1="${offsetY}" x2="${offsetX + drawW + 15}" y2="${offsetY + middleH_s}" stroke="#10b981" stroke-width="1"/>
    <text x="${offsetX + drawW + 20}" y="${offsetY + middleH_s / 2}" font-size="9" fill="#10b981" dominant-baseline="middle">중간장 ${middleH}</text>
    <line x1="${offsetX + drawW + 15}" y1="${offsetY + middleH_s}" x2="${offsetX + drawW + 15}" y2="${offsetY + middleH_s + lowerH_s + pedestalH_s}" stroke="#6b7280" stroke-width="1"/>
    <text x="${offsetX + drawW + 20}" y="${offsetY + middleH_s + (lowerH_s + pedestalH_s) / 2}" font-size="9" fill="#6b7280" dominant-baseline="middle">하부 ${lowerWithPedestal}</text>
  `;

        // EL 모듈 카드 HTML - 이동버튼 좌측, 고정버튼 추가, EL장 토글
        const elModuleCards = (mod.elModules || [])
          .map((elMod, idx) => {
            const isOpen = elMod.type === 'open';
            const isEL = elMod.isEL === true; // 기본값 false (기본모듈)
            const isFixed = elMod.isFixed || false;
            const fixedClass = isFixed ? 'fixed-active' : '';
            const elClass = isEL ? 'active' : '';
            return `
      <div class="el-module-card" style="border-left:4px solid ${isOpen ? '#f59e0b' : isEL ? '#10b981' : '#9ca3af'};">
        <div class="el-module-move-btns">
          <button onclick="moveELModule(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button onclick="moveELModule(${idx}, 1)" ${idx === mod.elModules.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-weight:700;font-size:12px;">${isOpen ? '📂 오픈장' : '📦 모듈'}</span>
            ${!isOpen ? `<button class="toggle-btn el ${elClass}" onclick="toggleELModuleIsEL(${idx})" style="margin-left:auto;">EL장</button>` : ''}
          </div>
          <div class="el-module-inputs">
            <label>높이</label>
            <input type="number" value="${elMod.h}" onchange="updateELModule(${idx}, 'h', this.value)">
            <span>mm</span>
            ${
              !isOpen
                ? `
              <label>도어</label>
              <select onchange="updateELModule(${idx}, 'doorType', this.value)" ${mod.doorDivision && mod.doorDivision !== 'individual' ? 'disabled style="opacity:0.5;"' : ''}>
                ${EL_DOOR_TYPES.map((t) => `<option value="${t.id}" ${elMod.doorType === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
              </select>
              ${mod.doorDivision && mod.doorDivision !== 'individual' ? '<span style="font-size:8px;color:#888;">(도어 구분 적용)</span>' : ''}
            `
                : ''
            }
          </div>
        </div>
        <div class="el-module-action-btns">
          <button onclick="toggleELModuleFixed(${idx})" class="fixed-btn ${fixedClass}">고정</button>
          <button onclick="removeELModule(${idx})" class="del-btn">×</button>
        </div>
      </div>
    `;
          })
          .join('');

        const modTypeName = mod.type === 'tall' ? '키큰장' : '홈카페장';

        const popupHtml = `
    <div id="el-popup-overlay" class="el-popup-overlay" onclick="if(event.target===this)closeELPopup()">
      <div class="el-popup">
        <div class="el-popup-header">
          <span>⚡ ${modTypeName} 설정 (${mod.w}mm)</span>
          <button onclick="closeELPopup()" class="el-popup-close">✕</button>
        </div>
        <div class="el-popup-body">
          <div class="el-popup-preview">
            <svg width="${svgWidth}" height="${svgHeight}" style="background:#fafafa;border-radius:12px;border:1px solid #e5e7eb;">
              <text x="${svgWidth / 2}" y="25" text-anchor="middle" font-size="14" font-weight="bold" fill="#333">${modTypeName} Front View</text>
              <text x="${svgWidth / 2}" y="${svgHeight - 15}" text-anchor="middle" font-size="10" fill="#666">W: ${modW}mm</text>
              ${moduleSvg}
            </svg>
          </div>
          <div class="el-popup-controls">
            <div class="el-popup-info">
              <div class="info-row"><span class="info-label">유효공간</span><span class="info-value">${middleH}mm</span></div>
              <div class="info-row"><span class="info-label">EL 사용</span><span class="info-value">${usedH}mm</span></div>
              <div class="info-row highlight"><span class="info-label">잔여</span><span class="info-value ${remainingH < 0 ? 'over' : ''}">${remainingH}mm</span></div>
              <div class="info-row auto-calc-row"><button onclick="autoCalculateELModules()" class="el-auto-calc-btn">⚡ 자동계산</button></div>
            </div>
            <div class="el-popup-section-title">EL 모듈 추가</div>
            <div class="el-add-btns">
              <button class="el-add-btn el-type" onclick="addELSubModule('el')">⚡ 모듈 추가</button>
              <button class="el-add-btn open-type" onclick="addELSubModule('open')">📂 오픈장 추가</button>
            </div>
            <div class="el-popup-section-title">모듈 목록 (${mod.elModules?.length || 0}개)</div>
            <div class="el-module-list">
              ${elModuleCards || '<div class="empty-msg">모듈을 추가하세요</div>'}
            </div>
            <div class="el-popup-section-title">하부장 설정</div>
            <div class="el-lower-selector">
              ${LOWER_MODULE_TYPES.map(
                (t) => `
                <button onclick="updateELLowerType('${t.id}')" class="el-lower-btn ${mod.lowerType === t.id ? 'active' : ''}" data-type="${t.id}">
                  <span class="lower-icon">${t.icon}</span>
                  <span class="lower-name">${t.name}</span>
                </button>
              `
              ).join('')}
            </div>
          </div>
        </div>
        <div class="el-popup-footer">
          <div class="footer-info">💡 EL장: 전동 가전수납 | 오픈장: 도어 없음</div>
          <button onclick="applyELPopupAndClose()" class="el-popup-save-btn">완료</button>
        </div>
      </div>
    </div>
    <style>
      .el-popup-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center}
      .el-popup{background:white;border-radius:20px;width:720px;max-width:95vw;max-height:90vh;overflow:hidden;box-shadow:0 25px 80px rgba(0,0,0,0.35)}
      .el-popup-header{display:flex;justify-content:space-between;align-items:center;padding:18px 24px;background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:white;font-weight:700;font-size:16px}
      .el-popup-close{background:none;border:none;color:white;font-size:24px;cursor:pointer;padding:0 4px}
      .el-popup-body{display:flex;gap:24px;padding:24px;max-height:calc(90vh - 160px);overflow-y:auto}
      .el-popup-preview{flex:0 0 auto}
      .el-popup-controls{flex:1;min-width:0}
      .el-popup-info{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px;padding:12px;background:#f0fdf4;border-radius:10px}
      .info-row{display:flex;flex-direction:column;align-items:center;padding:8px}
      .info-row.highlight{background:#dcfce7;border-radius:8px}
      .info-row.auto-calc-row{justify-content:center}
      .info-label{font-size:10px;color:#666;margin-bottom:2px}
      .info-value{font-size:16px;font-weight:700;color:#065f46}
      .info-value.over{color:#ef4444}
      .el-auto-calc-btn{padding:8px 14px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer}
      .el-auto-calc-btn:hover{opacity:0.9}
      .el-popup-section-title{font-size:13px;font-weight:700;color:#333;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e5e7eb}
      .el-add-btns{display:flex;gap:10px;margin-bottom:16px}
      .el-add-btn{flex:1;padding:14px;border:2px dashed #ccc;border-radius:10px;background:white;font-size:13px;cursor:pointer;font-weight:700;transition:all 0.2s}
      .el-add-btn.el-type{color:#10b981;border-color:#10b981}.el-add-btn.el-type:hover{background:#dcfce7;border-style:solid}
      .el-add-btn.open-type{color:#f59e0b;border-color:#f59e0b}.el-add-btn.open-type:hover{background:#fef3c7;border-style:solid}
      .el-module-list{max-height:220px;overflow-y:auto}
      .el-module-card{display:flex;align-items:center;gap:10px;padding:12px;background:#f9fafb;border-radius:10px;margin-bottom:10px}
      .el-module-move-btns{display:flex;flex-direction:column;gap:4px}
      .el-module-move-btns button{width:26px;height:26px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;cursor:pointer;font-size:11px}
      .el-module-move-btns button:hover:not(:disabled){background:#e5e5e5}
      .el-module-move-btns button:disabled{opacity:0.3}
      .el-module-inputs{display:flex;align-items:center;gap:8px;font-size:11px;flex-wrap:wrap}
      .el-module-inputs label{font-weight:600;color:#555}
      .el-module-inputs input{width:70px;padding:6px 8px;font-size:12px;border:1px solid #ddd;border-radius:6px}
      .el-module-inputs select{padding:6px 8px;font-size:12px;border:1px solid #ddd;border-radius:6px}
      .el-module-inputs span{color:#888}
      .el-module-action-btns{display:flex;gap:6px;margin-left:auto}
      .el-module-action-btns button{height:28px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;cursor:pointer;font-size:11px}
      .el-module-action-btns .fixed-btn{padding:0 10px;color:#6b7280;border-color:#d1d5db}
      .el-module-action-btns .fixed-btn:hover{background:#e5e5e5}
      .el-module-action-btns .fixed-btn.fixed-active{background:#dbeafe;color:#2563eb;border-color:#3b82f6;font-weight:700}
      .el-module-action-btns .del-btn{width:28px;color:#ef4444;border-color:#fecaca}
      .el-module-action-btns .del-btn:hover{background:#fee2e2}
      .empty-msg{padding:20px;text-align:center;color:#999;font-size:12px;background:#f9fafb;border-radius:8px}
      .el-lower-selector{display:flex;gap:10px;margin-bottom:16px}
      .el-lower-btn{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;border:2px solid #e5e7eb;border-radius:10px;background:white;cursor:pointer;transition:all 0.2s}
      .el-lower-btn:hover{border-color:#6b7280;background:#f9fafb}
      .el-lower-btn.active{border-color:#3b82f6;background:#eff6ff}
      .el-lower-btn .lower-icon{font-size:20px}
      .el-lower-btn .lower-name{font-size:11px;font-weight:600;color:#374151}
      .el-lower-btn.active .lower-name{color:#2563eb}
      .el-popup-footer{display:flex;justify-content:space-between;align-items:center;padding:14px 24px;border-top:1px solid #e5e7eb;background:#f9fafb}
      .footer-info{font-size:11px;color:#666}
      .el-popup-save-btn{padding:12px 28px;background:linear-gradient(135deg,#10b981 0%,#059669 100%);color:white;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer}
      .el-popup-save-btn:hover{opacity:0.9}
    </style>
  `;

        document.body.insertAdjacentHTML('beforeend', popupHtml);
      }

      function closeELPopup() {
        const popup = document.getElementById('el-popup-overlay');
        if (popup) popup.remove();
        currentELPopup = { itemId: null, modId: null };
      }

      // EL 팝업 완료 시 프론트뷰 반영
      function applyELPopupAndClose() {
        const popup = document.getElementById('el-popup-overlay');
        if (popup) popup.remove();

        // 메인 워크스페이스 다시 렌더링하여 프론트뷰 반영
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (item) {
          renderWorkspaceContent(item);
        }

        currentELPopup = { itemId: null, modId: null };
      }

      // EL 팝업에서 하부장 타입 변경
      function updateELLowerType(typeId) {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod) return;

        mod.lowerType = typeId;
        renderELPopup(item, mod);
      }

      function addELSubModule(type) {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod) return;

        if (!mod.elModules) mod.elModules = [];

        // 기본 높이 계산 (잔여 높이 또는 300mm)
        const H = parseFloat(item.h) || 0;
        const MOLDING_H = parseFloat(item.specs.fridgeMoldingH) || 50;
        const PEDESTAL_H = parseFloat(item.specs.fridgePedestal) || 60;
        const upperDoorH = parseFloat(item.specs.fridgeUpperH) || 300;
        const moduleBodyH = H - MOLDING_H - upperDoorH - PEDESTAL_H;
        const middleH = parseFloat(item.specs.fridgeMiddleH) || Math.floor(moduleBodyH * 0.55);

        const usedH = mod.elModules.reduce((sum, m) => sum + m.h, 0);
        const remainingH = middleH - usedH;
        // 오픈장은 450mm 기본값, EL장은 잔여 높이 기반
        const defaultH = type === 'open' ? 450 : Math.min(300, Math.max(100, remainingH));

        mod.elModules.push({
          id: Date.now(),
          type: type,
          h: defaultH,
          doorType: type === 'el' ? 'swing' : null, // 오픈장은 도어 없음
          isFixed: false, // 고정 여부
          isEL: false, // 기본값: 기본모듈 (EL장 아님)
        });

        renderELPopup(item, mod);
      }

      function removeELModule(idx) {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod || !mod.elModules) return;

        mod.elModules.splice(idx, 1);
        renderELPopup(item, mod);
      }

      function updateELModule(idx, field, value) {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod || !mod.elModules || !mod.elModules[idx]) return;

        if (field === 'h') {
          mod.elModules[idx].h = parseFloat(value) || 100;
        } else {
          mod.elModules[idx][field] = value;
        }

        renderELPopup(item, mod);
      }

      function moveELModule(idx, direction) {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod || !mod.elModules) return;

        const newIdx = idx + direction;
        if (newIdx < 0 || newIdx >= mod.elModules.length) return;

        [mod.elModules[idx], mod.elModules[newIdx]] = [mod.elModules[newIdx], mod.elModules[idx]];
        renderELPopup(item, mod);
      }

      // EL 모듈 고정 토글
      function toggleELModuleFixed(idx) {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod || !mod.elModules || !mod.elModules[idx]) return;

        mod.elModules[idx].isFixed = !mod.elModules[idx].isFixed;
        renderELPopup(item, mod);
      }

      // EL 모듈 EL장/기본모듈 토글
      function toggleELModuleIsEL(idx) {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod || !mod.elModules || !mod.elModules[idx]) return;

        // 토글: true면 false로, false/undefined면 true로
        mod.elModules[idx].isEL = !mod.elModules[idx].isEL;
        renderELPopup(item, mod);
      }

      // EL 모듈 자동 계산 (고정되지 않은 모듈의 높이 균등 배분)
      function autoCalculateELModules() {
        const item = selectedItems.find((i) => i.uniqueId === currentELPopup.itemId);
        if (!item) return;
        const mod = item.modules.find((m) => m.id === currentELPopup.modId);
        if (!mod || !mod.elModules || mod.elModules.length === 0) return;

        // 중간장 유효 높이 계산
        const H = parseFloat(item.h) || 0;
        const MOLDING_H = parseFloat(item.specs.fridgeMoldingH) || 50;
        const PEDESTAL_H = parseFloat(item.specs.fridgePedestal) || 60;
        const upperDoorH = parseFloat(item.specs.fridgeUpperH) || 300;
        const moduleBodyH = H - MOLDING_H - upperDoorH - PEDESTAL_H;
        const middleH = parseFloat(item.specs.fridgeMiddleH) || Math.floor(moduleBodyH * 0.55);

        // 고정된 모듈과 고정되지 않은 모듈 분리
        const fixedModules = mod.elModules.filter((m) => m.isFixed);
        const unfixedModules = mod.elModules.filter((m) => !m.isFixed);

        // 고정된 모듈이 사용하는 높이
        const fixedHeight = fixedModules.reduce((sum, m) => sum + m.h, 0);

        // 고정되지 않은 모듈에 배분할 높이
        const availableHeight = middleH - fixedHeight;

        if (unfixedModules.length > 0 && availableHeight > 0) {
          const heightPerModule = Math.floor(availableHeight / unfixedModules.length);
          unfixedModules.forEach((m) => {
            m.h = heightPerModule;
          });
        }

        renderELPopup(item, mod);
      }

      // ============================================================
      // AI 어시스턴트 (부가 기능)
      // ============================================================
      (function () {
        // AI 버튼 및 모달 HTML 삽입
        const aiHTML = `
    <!-- AI Floating Button -->
    <div id="ai-fab" onclick="toggleAIPanel()" title="AI 어시스턴트">
      <span>AI</span>
      <div class="ai-pulse"></div>
    </div>

    <!-- AI Chat Panel -->
    <div id="ai-panel" class="ai-panel-hidden">
      <div class="ai-header">
        <span>🤖 다담 AI 어시스턴트</span>
        <button onclick="toggleAIPanel()" class="ai-close">✕</button>
      </div>
      <div id="ai-messages" class="ai-messages">
        <div class="ai-msg ai-bot">안녕하세요! 가구 설계에 도움이 필요하시면 말씀해주세요.</div>
      </div>
      <div class="ai-input-area">
        <button id="ai-voice-btn" onclick="toggleVoiceInput()" class="ai-voice-btn" title="음성 입력">🎤</button>
        <input type="text" id="ai-input" placeholder="메시지를 입력하세요..." onkeypress="if(event.key==='Enter')sendAIMessage()">
        <button onclick="sendAIMessage()" class="ai-send-btn">전송</button>
      </div>
    </div>
  `;

        // AI 스타일 삽입
        const aiStyles = `
    <style>
      #ai-fab {
        position: fixed;
        bottom: 30px;
        right: 30px;
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
        z-index: 9999;
        transition: all 0.3s ease;
      }
      #ai-fab:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 30px rgba(102, 126, 234, 0.6);
      }
      #ai-fab span {
        color: white;
        font-weight: bold;
        font-size: 18px;
        z-index: 1;
      }
      #ai-fab .ai-pulse {
        position: absolute;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background: rgba(102, 126, 234, 0.4);
        animation: ai-pulse-anim 2s infinite;
      }
      @keyframes ai-pulse-anim {
        0% { transform: scale(1); opacity: 0.8; }
        100% { transform: scale(1.5); opacity: 0; }
      }

      #ai-panel {
        position: fixed;
        bottom: 100px;
        right: 30px;
        width: 360px;
        height: 480px;
        background: white;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        z-index: 9998;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: all 0.3s ease;
      }
      .ai-panel-hidden {
        opacity: 0;
        transform: translateY(20px) scale(0.95);
        pointer-events: none !important;
      }
      .ai-header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 600;
      }
      .ai-close {
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        padding: 0;
        line-height: 1;
      }
      .ai-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        background: #f8f9fa;
      }
      .ai-msg {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 16px;
        font-size: 14px;
        line-height: 1.5;
        word-break: break-word;
      }
      .ai-bot {
        background: white;
        align-self: flex-start;
        border: 1px solid #e9ecef;
        border-bottom-left-radius: 4px;
      }
      .ai-user {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        align-self: flex-end;
        border-bottom-right-radius: 4px;
      }
      .ai-input-area {
        display: flex;
        padding: 12px;
        gap: 8px;
        border-top: 1px solid #e9ecef;
        background: white;
      }
      #ai-input {
        flex: 1;
        border: 1px solid #dee2e6;
        border-radius: 20px;
        padding: 10px 16px;
        font-size: 14px;
        outline: none;
      }
      #ai-input:focus {
        border-color: #667eea;
      }
      .ai-voice-btn {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: 1px solid #dee2e6;
        background: white;
        cursor: pointer;
        font-size: 18px;
        transition: all 0.2s;
      }
      .ai-voice-btn:hover {
        background: #f8f9fa;
      }
      .ai-voice-btn.listening {
        background: #dc3545;
        border-color: #dc3545;
        animation: pulse 1s infinite;
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }
      .ai-send-btn {
        padding: 10px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        font-weight: 500;
        transition: all 0.2s;
      }
      .ai-send-btn:hover {
        opacity: 0.9;
      }
      .ai-typing {
        display: flex;
        gap: 4px;
        padding: 10px 14px;
        background: white;
        border-radius: 16px;
        border: 1px solid #e9ecef;
        align-self: flex-start;
      }
      .ai-typing span {
        width: 8px;
        height: 8px;
        background: #adb5bd;
        border-radius: 50%;
        animation: typing 1.4s infinite;
      }
      .ai-typing span:nth-child(2) { animation-delay: 0.2s; }
      .ai-typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typing {
        0%, 60%, 100% { transform: translateY(0); }
        30% { transform: translateY(-8px); }
      }
    </style>
  `;

        document.head.insertAdjacentHTML('beforeend', aiStyles);
        document.body.insertAdjacentHTML('beforeend', aiHTML);
      })();

      // AI 패널 토글
      let aiPanelOpen = false;
      function toggleAIPanel() {
        const panel = document.getElementById('ai-panel');
        aiPanelOpen = !aiPanelOpen;
        if (aiPanelOpen) {
          panel.classList.remove('ai-panel-hidden');
        } else {
          panel.classList.add('ai-panel-hidden');
        }
      }

      // AI 세션 ID
      let aiSessionId = null;

      // AI 메시지 전송
      async function sendAIMessage() {
        const input = document.getElementById('ai-input');
        const msg = input.value.trim();
        if (!msg) return;

        input.value = '';
        addAIMessage(msg, 'user');

        // 타이핑 표시
        const messagesDiv = document.getElementById('ai-messages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'ai-typing';
        typingDiv.innerHTML = '<span></span><span></span><span></span>';
        messagesDiv.appendChild(typingDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: msg,
              session_id: aiSessionId,
              context: getCurrentDesignContext(),
            }),
          });

          const data = await response.json();
          typingDiv.remove();

          if (data.session_id) aiSessionId = data.session_id;
          addAIMessage(data.message || data.error || '응답을 받지 못했습니다.', 'bot');

          // TTS (선택적)
          if (window.speechSynthesis && data.message) {
            speakAI(data.message);
          }
        } catch (err) {
          typingDiv.remove();
          addAIMessage('서버 연결 오류가 발생했습니다.', 'bot');
        }
      }

      function addAIMessage(text, type) {
        const messagesDiv = document.getElementById('ai-messages');
        const msgDiv = document.createElement('div');
        msgDiv.className = `ai-msg ai-${type}`;
        msgDiv.textContent = text;
        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }

      // 현재 설계 컨텍스트 가져오기
      function getCurrentDesignContext() {
        if (selectedItems.length === 0) return null;
        const item = selectedItems[selectedItems.length - 1];
        return {
          category: item.category,
          name: item.name,
          dimensions: { width: item.w, height: item.h, depth: item.d },
          modules: item.modules,
        };
      }

      // 음성 인식
      let recognition = null;
      let isListening = false;

      function toggleVoiceInput() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          alert('이 브라우저는 음성 인식을 지원하지 않습니다.');
          return;
        }

        const btn = document.getElementById('ai-voice-btn');

        if (isListening) {
          recognition.stop();
          return;
        }

        if (!recognition) {
          const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          recognition = new SpeechRecognition();
          recognition.lang = 'ko-KR';
          recognition.continuous = false;
          recognition.interimResults = true;

          recognition.onstart = () => {
            isListening = true;
            btn.classList.add('listening');
            btn.textContent = '🔴';
          };

          recognition.onresult = (event) => {
            const result = event.results[event.resultIndex];
            const text = result[0].transcript;
            document.getElementById('ai-input').value = text;

            if (result.isFinal) {
              setTimeout(() => sendAIMessage(), 300);
            }
          };

          recognition.onend = () => {
            isListening = false;
            btn.classList.remove('listening');
            btn.textContent = '🎤';
          };

          recognition.onerror = () => {
            isListening = false;
            btn.classList.remove('listening');
            btn.textContent = '🎤';
          };
        }

        recognition.start();
      }

      // TTS
      function speakAI(text) {
        const synth = window.speechSynthesis;
        synth.cancel();

        const cleanText = text
          .replace(/\*\*/g, '')
          .replace(/\*/g, '')
          .replace(/#{1,6}\s/g, '')
          .replace(/\n+/g, '. ')
          .trim();

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'ko-KR';
        utterance.rate = 1.1;
        synth.speak(utterance);
      }

      // ★ 냉장고장 뷰 전환
      function switchFridgeView(itemUniqueId, mode) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs.fridgeViewMode = mode;
        renderWorkspaceContent(item);
      }

      // ★ 냉장고장 Top View (위에서 내려다보기)
      function renderFridgeTopView(item) {
        const W = parseFloat(item.w) || 1800;
        const D = parseFloat(item.d) || 700;
        const modules = item.modules || [];

        const svgW = 620, pad = 50;
        const scale = (svgW - pad * 2) / W;
        const drawD = D * scale;
        const svgH = pad + drawD + 60 + pad;
        let svg = '';
        const ox = pad, oy = pad;

        // 라벨
        svg += `<text x="${ox - 5}" y="${oy - 8}" font-size="11" fill="#333" font-weight="bold">냉장고장</text>`;
        svg += `<text x="${ox + 55}" y="${oy - 8}" font-size="9" fill="#999">(깊이 ${D}mm)</text>`;

        // 외곽
        svg += `<rect x="${ox}" y="${oy}" width="${W*scale}" height="${drawD}" fill="#f8f9fa" stroke="#999" stroke-width="1.5"/>`;

        // 치수선 — 상단
        svg += `<line x1="${ox}" y1="${oy - 15}" x2="${ox + W*scale}" y2="${oy - 15}" stroke="#666" stroke-width="1"/>`;
        svg += `<line x1="${ox}" y1="${oy - 20}" x2="${ox}" y2="${oy - 10}" stroke="#666"/>`;
        svg += `<line x1="${ox + W*scale}" y1="${oy - 20}" x2="${ox + W*scale}" y2="${oy - 10}" stroke="#666"/>`;
        svg += `<text x="${ox + W*scale/2}" y="${oy - 22}" text-anchor="middle" font-size="11" fill="#333" font-weight="bold">${W}mm</text>`;

        // 모듈 배치
        let mx = ox;
        for (const mod of modules) {
          const mw = (parseFloat(mod.w) || 600) * scale;
          const isFridge = mod.type === 'fridge';
          const isTall = mod.type === 'tall';
          const isHomecafe = mod.type === 'homecafe';
          const fill = isFridge ? '#e0f2fe' : isTall ? '#fef3c7' : isHomecafe ? '#fce7f3' : '#f0f0f0';
          const label = isFridge ? '🧊 냉장고' : isTall ? '키큰장' : isHomecafe ? '☕ 홈카페' : `${mod.w||''}`;

          svg += `<rect x="${mx}" y="${oy}" width="${mw}" height="${drawD}" fill="${fill}" stroke="#666" stroke-width="1"/>`;
          svg += `<text x="${mx + mw/2}" y="${oy + drawD/2 + 3}" text-anchor="middle" font-size="9" fill="#333">${label}</text>`;
          svg += `<text x="${mx + mw/2}" y="${oy + drawD + 14}" text-anchor="middle" font-size="8" fill="#666">${mod.w||''}mm</text>`;
          mx += mw;
        }

        return `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" style="background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;">${svg}</svg>`;
      }

