      // ============================================================
      // UI 관련 함수들
      // ============================================================

      function initCategoryGrid() {
        const gridEl = document.getElementById('categoryGrid');
        CATEGORIES.forEach((cat) => {
          const btn = document.createElement('div');
          btn.className = 'category-card';
          btn.id = `btn-${cat.id}`;
          btn.innerHTML = `
      <div class="category-name">${cat.name}</div>
      <div class="card-stepper" onclick="event.stopPropagation()">
        <button class="stepper-btn" onclick="decrementCategory('${cat.id}')">－</button>
        <span class="stepper-count" id="count-${cat.id}">0</span>
        <button class="stepper-btn" onclick="incrementCategory('${cat.id}')">＋</button>
      </div>
    `;
          btn.addEventListener('click', () => incrementCategory(cat.id));
          gridEl.appendChild(btn);
        });
      }

      function incrementCategory(catId) {
        const cat = CATEGORIES.find((c) => c.id === catId);
        const specLegH = 150;
        const specLowerH = 870;
        const specUpperH = 720;
        const specTopT = 12;
        const specOverlap = 15;
        const lowerBodyH = specLowerH - specTopT - specLegH;
        const upperBodyH = specUpperH - specOverlap;

        const newItem = {
          uniqueId: Date.now() + Math.random(),
          categoryId: cat.id,
          name: cat.name,
          defaultD: cat.defaultD,
          w: '',
          h: '',
          d: '',
          image: null,
          specs: JSON.parse(JSON.stringify(DEFAULT_SPECS)),
          modules: [],
          prevUpperModules: null,
          prevLowerModules: null,
        };

        // ★ 붙박이장: 기본 마감을 몰딩으로 설정
        if (cat.id === 'wardrobe') {
          newItem.specs.finishLeftType = 'Molding';
          newItem.specs.finishRightType = 'Molding';
        }

        // ★ 냉장고장: 규칙 기반 초기화 (업데이트)
        if (cat.id === 'fridge') {
          newItem.specs.fridgeBrand = 'LG';
          newItem.specs.fridgeMoldingH = FRIDGE_RULES.MOLDING_H; // 상몰딩 높이
          newItem.specs.fridgePedestal = FRIDGE_RULES.PEDESTAL_H; // 좌대 높이
          newItem.specs.fridgeModuleD = FRIDGE_RULES.MODULE_D; // 모듈 깊이 기본 550
          newItem.specs.finishLeftType = 'molding'; // 몰딩 기본
          newItem.specs.finishRightType = 'molding'; // 몰딩 기본
          newItem.specs.finishLeftWidth = 60;
          newItem.specs.finishRightWidth = 60;
          // 자동계산 관련
          newItem.specs.autoCalculated = false;
        }

        if (cat.id === 'sink') {
          newItem.modules = []; // 빈 상태로 시작 — 자동계산 또는 수동 추가
        }

        selectedItems.push(newItem);
        updateUI();
      }

      function decrementCategory(catId) {
        const targets = selectedItems.filter((item) => item.categoryId === catId);
        if (targets.length > 0) removeInstance(targets[targets.length - 1].uniqueId);
      }

      function removeInstance(uniqueId) {
        selectedItems = selectedItems.filter((item) => item.uniqueId !== uniqueId);
        updateUI();
      }

      function updateUI() {
        const container = document.getElementById('dynamicInputList');
        const detailSection = document.getElementById('detailInputSection');

        detailSection.style.display = selectedItems.length > 0 ? 'block' : 'none';

        CATEGORIES.forEach((cat) => {
          const count = selectedItems.filter((item) => item.categoryId === cat.id).length;
          document.getElementById(`count-${cat.id}`).innerText = count;
          const btn = document.getElementById(`btn-${cat.id}`);
          btn.classList.toggle('active', count > 0);
        });

        // labelName 갱신
        const typeCounter = {};
        selectedItems.forEach((item) => {
          typeCounter[item.categoryId] = (typeCounter[item.categoryId] || 0) + 1;
          item.labelName = `${item.name} #${typeCounter[item.categoryId]}`;
          if (!item.d && item.defaultD > 0) item.d = item.defaultD;

          // topSizes 마이그레이션
          if (typeof item.specs.topSizes[0] === 'string') {
            item.specs.topSizes = item.specs.topSizes.map(s => {
              if (typeof s === 'string' && s.includes('x')) {
                const [w, d] = s.split('x').map(v => v.trim());
                return { w: w || '', d: d || '' };
              }
              return typeof s === 'object' && s ? s : { w: '', d: '' };
            });
          }
          if (item.specs.layoutShape === 'I' && !item.specs.topSizes[0]?.w && item.w && item.d) {
            item.specs.topSizes[0] = { w: String(item.w), d: String(item.d) };
          }
        });

        // 선택된 품목 요약 표시
        container.innerHTML = '';
        const summary = {};
        selectedItems.forEach((item) => {
          summary[item.categoryId] = (summary[item.categoryId] || 0) + 1;
        });
        if (Object.keys(summary).length > 0) {
          const summaryEl = document.createElement('div');
          summaryEl.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
          Object.entries(summary).forEach(([catId, count]) => {
            const cat = CATEGORIES.find(c => c.id === catId);
            if (!cat) return;
            const tag = document.createElement('span');
            tag.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#f5f0eb;border:1px solid #e0d6cc;border-radius:8px;font-size:13px;color:#2d2a26;';
            tag.innerHTML = `<strong>${cat.name}</strong> × ${count}`;
            summaryEl.appendChild(tag);
          });
          container.appendChild(summaryEl);
        }

        // 마이그레이션 처리
        selectedItems.forEach((item) => {
          if (!item.specs.lowerLayoutShape && item.specs.layoutShape) {
            item.specs.lowerLayoutShape = item.specs.layoutShape;
          }
        });

        document.getElementById('btnNext').disabled = selectedItems.length === 0;
        document.getElementById('aiGuideText').innerHTML =
          selectedItems.length > 0
            ? `총 <strong>${selectedItems.length}개</strong>의 가구 설정 중...`
            : '가구를 추가하면 입력창이 생성됩니다.';
      }

      function updateItemValue(uniqueId, field, value) {
        const target = selectedItems.find((item) => item.uniqueId === uniqueId);
        if (target) {
          target[field] = value;
          if (target.specs.layoutShape === 'I' && (field === 'w' || field === 'd')) {
            if (!target.specs.topSizes[0] || typeof target.specs.topSizes[0] === 'string') {
              target.specs.topSizes[0] = { w: '', d: '' };
            }
            target.specs.topSizes[0].w = String(target.w || '');
            target.specs.topSizes[0].d = String(target.d || '');
          }
          // ★ 붙박이장: 가로(W) 변경 시 유효공간 자동 재계산
          if (target.categoryId === 'wardrobe' && field === 'w') {
            const W = parseFloat(value) || 0;
            const fL = target.specs.finishLeftType !== 'None' ? parseFloat(target.specs.finishLeftWidth) || 0 : 0;
            const fR = target.specs.finishRightType !== 'None' ? parseFloat(target.specs.finishRightWidth) || 0 : 0;
            target.specs.wardrobeEffectiveW = W - fL - fR;
          }
          document.getElementById('btnNext').disabled = !selectedItems.every((item) => item.w && item.h && item.d);
        }
      }

      async function handleItemPhoto(uniqueId, event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!currentUser) {
          alert('이미지 업로드를 위해 로그인이 필요합니다.');
          return;
        }

        const target = selectedItems.find((item) => item.uniqueId === uniqueId);
        if (!target) return;

        // 로딩 표시
        target.image = 'loading';
        updateUI();

        try {
          const imageUrl = await uploadImageToStorage(file, currentUser.id);
          target.image = imageUrl;
          target.imageUrl = imageUrl;
          updateUI();
          hasUnsavedChanges = true;
        } catch (error) {
          console.error('이미지 업로드 실패:', error);
          alert(error.message || '이미지 업로드에 실패했습니다.');
          target.image = null;
          updateUI();
        }
      }

      function goToStep2() {
        document.getElementById('step1-content').style.display = 'none';
        document.getElementById('step2-content').style.display = 'block';
        document.getElementById('step-dot-1').classList.remove('active');
        document.getElementById('step-dot-2').classList.add('active');
        renderBookmarks();
      }

      function backToStep1() {
        document.getElementById('step1-content').style.display = 'block';
        document.getElementById('step2-content').style.display = 'none';
        document.getElementById('step-dot-1').classList.add('active');
        document.getElementById('step-dot-2').classList.remove('active');
        updateUI();
      }

      function goToStep3() {
        document.getElementById('step2-content').style.display = 'none';
        document.getElementById('step3-content').style.display = 'block';
        document.getElementById('step-dot-2').classList.remove('active');
        document.getElementById('step-dot-3').classList.add('active');
      }

      function backToStep2() {
        document.getElementById('step3-content').style.display = 'none';
        document.getElementById('step2-content').style.display = 'block';
        document.getElementById('step-dot-3').classList.remove('active');
        document.getElementById('step-dot-2').classList.add('active');
      }

      function proceedToBOM() {
        // 1. AI 결과 모달 닫기
        const modal = document.querySelector('.ai-design-result-modal');
        if (modal) modal.remove();

        // ★ 디버그: BOM 시작 시 selectedItems 상태 확인
        console.log('[BOM] === proceedToBOM 시작 ===');
        selectedItems.forEach((item, idx) => {
          console.log(`[BOM] selectedItems[${idx}]: categoryId=${item.categoryId}, modules=${item.modules?.length}, upper=${item.modules?.filter(m=>m.pos==='upper').length}, lower=${item.modules?.filter(m=>m.pos==='lower').length}`);
        });

        // 2. 설계 데이터 추출
        const design = window.DadamAgent.exportDesign();
        if (!design.items || design.items.length === 0) {
          alert('설계 데이터가 없습니다.');
          return;
        }

        // ★ 디버그: exportDesign 후 복사본 확인
        design.items.forEach((item, idx) => {
          console.log(`[BOM] design.items[${idx}]: modules=${item.modules?.length}, upper=${item.modules?.filter(m=>m.pos==='upper').length}, lower=${item.modules?.filter(m=>m.pos==='lower').length}`);
        });

        // 3. Step 3로 이동
        goToStep3();

        // 4. 자재 추출
        const matResult = materialExtractor.extract(design);
        const hwResult = hardwareExtractor.extract(design);

        // 5. 전역 데이터 저장 (다운로드용)
        window._reportData = {
          design,
          materials: matResult,
          hardware: hwResult,
          csvMaterial: materialExtractor.toCSV(matResult.materials),
          cncMaterial: materialExtractor.toCNC(matResult.materials),
          csvHardware: hardwareExtractor.toCSV(hwResult.hardware)
        };

        // 6. 탭 콘텐츠 생성 후 Step 3 영역에 렌더링
        const tabContent = generateReportTabs(matResult, hwResult, design);
        document.getElementById('step3-report-area').innerHTML = tabContent;
      }

      function renderBookmarks() {
        const tabsContainer = document.getElementById('bookmarkTabs');
        tabsContainer.innerHTML = '';
        selectedItems.forEach((item, index) => {
          const tab = document.createElement('div');
          tab.className = 'bookmark-tab' + (index === 0 ? ' active' : '');
          tab.innerText = item.labelName;
          tab.onclick = () => {
            document.querySelectorAll('.bookmark-tab').forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');
            currentItemId = item.uniqueId;
            renderWorkspaceContent(item);
          };
          tabsContainer.appendChild(tab);
        });
        if (selectedItems.length > 0) {
          currentItemId = selectedItems[0].uniqueId;
          renderWorkspaceContent(selectedItems[0]);
        }
      }

      // 렌더링 debounce를 위한 타이머 저장소
      const _renderTimers = new Map();
      const _pendingScroll = new Map(); // ★ debounce 전 스크롤 위치 저장

      function renderWorkspaceContent(item) {
        if (!item || !item.uniqueId) return;

        const itemId = item.uniqueId;

        // ★ debounce 전에 스크롤 위치 즉시 저장 (이벤트 발생 시점의 정확한 값)
        if (!_pendingScroll.has(itemId)) {
          const ws = document.getElementById('designWorkspace');
          const sp = ws?.querySelector('.spec-panel');
          const mp = ws?.querySelector('.module-panel');
          _pendingScroll.set(itemId, {
            specPanel: sp ? sp.scrollTop : 0,
            modulePanel: mp ? mp.scrollTop : 0,
            pageY: window.scrollY || window.pageYOffset || 0,
          });
        }

        if (_renderTimers.has(itemId)) {
          clearTimeout(_renderTimers.get(itemId));
        }

        _renderTimers.set(
          itemId,
          setTimeout(() => {
            _renderTimers.delete(itemId);
            _renderWorkspaceContentImpl(item);
          }, 30)
        );
      }

      // 실제 렌더링 구현
      function _renderWorkspaceContentImpl(item) {
        const ws = document.getElementById('designWorkspace');
        if (!ws) return;

        // ★ 포커스 복원을 위한 정보 저장
        const activeEl = document.activeElement;
        let focusInfo = null;
        if (activeEl && activeEl.tagName === 'INPUT' && ws.contains(activeEl)) {
          focusInfo = {
            type: activeEl.type,
            value: activeEl.value,
            selectionStart: activeEl.selectionStart,
            selectionEnd: activeEl.selectionEnd,
            onchange: activeEl.getAttribute('onchange'),
            onblur: activeEl.getAttribute('onblur'),
            parentClass: activeEl.closest('.dim-group, .spec-field, .effective-space-group')?.className,
          };
        }

        // ★ 스크롤 위치 가져오기 (renderWorkspaceContent에서 미리 저장한 값)
        const scrollInfo = _pendingScroll.get(item.uniqueId) || { specPanel: 0, modulePanel: 0 };
        _pendingScroll.delete(item.uniqueId);

        // ★ 붙박이장인 경우 별도 렌더링
        if (item.categoryId === 'wardrobe') {
          renderWardrobeWorkspace(item);
          _restoreScroll(ws, scrollInfo);
          _restoreFocus(ws, focusInfo);
          return;
        }

        // ★ 냉장고장인 경우 별도 렌더링
        if (item.categoryId === 'fridge') {
          renderFridgeWorkspace(item);
          _restoreScroll(ws, scrollInfo);
          _restoreFocus(ws, focusInfo);
          return;
        }

        const upperModules = item.modules.filter((m) => m.pos === 'upper');
        const lowerModules = item.modules.filter((m) => m.pos === 'lower');

        const autoEffectiveW = calcEffectiveSpace(item);
        const upperEffectiveW = getEffectiveSpace(item, 'upper');
        const lowerEffectiveW = getEffectiveSpace(item, 'lower');

        const upperUsedW = upperModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
        const lowerUsedW = lowerModules.reduce((sum, m) => sum + (parseFloat(m.w) || 0), 0);
        const upperRemaining = upperEffectiveW - upperUsedW;
        const lowerRemaining = lowerEffectiveW - lowerUsedW;

        const renderModuleCard = (mod, idx, section, totalCount) => {
          const icons = { sink: '🚰', cook: '🔥', hood: '🌀', tall: '↕️', storage: mod.pos === 'upper' ? '⬆️' : '⬇️' };
          const icon = icons[mod.type] || '📦';
          const isTall = mod.type === 'tall';
          const isBase = mod.isBase; // ★ 기준 모듈 확인

          const options =
            mod.pos === 'lower' && (mod.type === 'storage' || mod.type === 'tall')
              ? `
      <div class="module-options">
        <label class="module-chk"><input type="checkbox" ${mod.isDrawer ? 'checked' : ''} onchange="toggleOption(${item.uniqueId}, ${mod.id}, 'isDrawer', this.checked)"> 서랍장</label>
        <label class="module-chk"><input type="checkbox" ${mod.isEL ? 'checked' : ''} onchange="toggleOption(${item.uniqueId}, ${mod.id}, 'isEL', this.checked)"> EL장</label>
        ${
          isTall
            ? `<div style="margin-top:4px;display:flex;gap:8px;">
          <label class="module-chk">도어수: <input type="number" style="width:40px;padding:2px;font-size:11px;border:1px solid #ddd;border-radius:3px;" value="${mod.doorCount || 1}" onchange="updateModuleDetail(${item.uniqueId}, ${mod.id}, 'doorCount', this.value)"></label>
          <label class="module-chk">EL수: <input type="number" style="width:40px;padding:2px;font-size:11px;border:1px solid #ddd;border-radius:3px;" value="${mod.elCount || 0}" onchange="updateModuleDetail(${item.uniqueId}, ${mod.id}, 'elCount', this.value)"></label>
        </div>`
            : ''
        }
      </div>
    `
              : '';

          // ★ 클래스 결정: 키큰장 > 기준모듈 > 고정모듈
          let cardClass = 'module-card';
          if (isTall) cardClass += ' tall-type';
          else if (isBase) cardClass += ' base-module';
          else if (mod.isFixed) cardClass += ' fixed-module';

          const fixedClass = mod.isFixed ? 'active' : '';
          return `
      <div class="${cardClass}" data-module-id="${mod.id}">
        <div class="move-buttons">
          <button class="btn-move" onclick="moveModule(${item.uniqueId}, ${mod.id}, 'up')" ${idx === 0 ? 'disabled' : ''}>▲</button>
          <button class="btn-move" onclick="moveModule(${item.uniqueId}, ${mod.id}, 'down')" ${idx === totalCount - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <div class="module-icon">${icon}</div>
        <div class="module-info">
          <div class="module-header">
            <span class="module-title">${mod.name}</span>
            ${isTall ? '<span class="module-type-badge">키큰장</span>' : ''}
            <button class="toggle-btn ${fixedClass}" style="margin-left:auto;font-size:9px;padding:2px 6px;" onclick="toggleSinkModuleFixed(${item.uniqueId}, ${mod.id})">고정</button>
            ${item.categoryId === 'sink' ? `<button class="btn-module-settings" onclick="openSinkModuleTypePopup(${item.uniqueId},${mod.id})">⚙️</button>` : ''}
          </div>
          <div class="module-dims">
            <div class="dim-group"><label class="dim-label">W</label><input type="number" class="dim-input" value="${mod.w}" onchange="updateModuleDim(${item.uniqueId}, ${mod.id}, 'w', this.value)"></div>
            <div class="dim-group"><label class="dim-label">H</label><input type="number" class="dim-input" value="${mod.h}" onchange="updateModuleDim(${item.uniqueId}, ${mod.id}, 'h', this.value)"></div>
            <div class="dim-group"><label class="dim-label">D</label><input type="number" class="dim-input" value="${mod.d}" onchange="updateModuleDim(${item.uniqueId}, ${mod.id}, 'd', this.value)"></div>
          </div>
          ${options}
        </div>
        <button class="btn-delete-module" onclick="removeModule(${item.uniqueId}, ${mod.id})">×</button>
      </div>
    `;
        };

        const upperModulesHtml = upperModules
          .map((m, i) => renderModuleCard(m, i, 'upper', upperModules.length))
          .join('');
        const lowerModulesHtml = lowerModules
          .map((m, i) => renderModuleCard(m, i, 'lower', lowerModules.length))
          .join('');

        const upperEffDisplay =
          item.specs.effectiveUpperW !== null ? item.specs.effectiveUpperW : Math.round(autoEffectiveW);
        const lowerEffDisplay =
          item.specs.effectiveLowerW !== null ? item.specs.effectiveLowerW : Math.round(autoEffectiveW);

        // ★ 싱크대 Front View SVG 생성
        const sinkW = parseFloat(item.w) || 3000;
        const sinkH = parseFloat(item.h) || 2400;
        const upperH = parseFloat(item.specs.upperH) || 720;
        const lowerH = parseFloat(item.specs.lowerH) || 870;
        const moldingH = parseFloat(item.specs.moldingH) || 60;
        const legH = parseFloat(item.specs.sinkLegHeight) || 120;
        const finishL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const finishR = item.specs.finishRightType !== 'None' ? parseFloat(item.specs.finishRightWidth) || 0 : 0;

        const svgWidth = 600;
        const svgHeight = 380;
        const scaleX = (svgWidth - 100) / sinkW;
        const scaleY = (svgHeight - 100) / sinkH;
        const scale = Math.min(scaleX, scaleY);
        const drawW = sinkW * scale;
        const drawH = sinkH * scale;
        const offsetX = (svgWidth - drawW) / 2;
        const offsetY = 50;

        // 각 영역 높이 (스케일 적용)
        const moldingH_s = moldingH * scale;
        const upperH_s = upperH * scale;
        const lowerH_s = lowerH * scale;
        const legH_s = legH * scale;

        let sinkModuleSvg = '';

        // 좌우 마감 (몰딩/휠라) 폭
        const finishL_s = finishL * scale;
        const finishR_s = finishR * scale;
        const finishLType = item.specs.finishLeftType || 'Filler';
        const finishRType = item.specs.finishRightType || 'Filler';

        // 상몰딩 (ㄷ자 형태: 상단 + 좌측 + 우측)
        sinkModuleSvg += `<rect x="${offsetX}" y="${offsetY}" width="${drawW}" height="${moldingH_s}" fill="#e5e7eb" stroke="#9ca3af" stroke-width="1"/>
    <text x="${offsetX + drawW / 2}" y="${offsetY + moldingH_s / 2 + 3}" text-anchor="middle" font-size="9" fill="#666">상몰딩 ${moldingH}</text>`;

        // 좌측 마감 (상몰딩 아래~하부장 끝까지)
        if (finishL > 0) {
          const fLY = offsetY + moldingH_s;
          const fLH = drawH - moldingH_s;
          sinkModuleSvg += `<rect x="${offsetX}" y="${fLY}" width="${finishL_s}" height="${fLH}" fill="#d1d5db" stroke="#9ca3af" stroke-width="1" opacity="0.6"/>
    <text x="${offsetX + finishL_s / 2}" y="${fLY + fLH / 2}" text-anchor="middle" font-size="7" fill="#555" transform="rotate(-90 ${offsetX + finishL_s / 2} ${fLY + fLH / 2})">${finishLType} ${finishL}</text>`;
        }

        // 우측 마감
        if (finishR > 0) {
          const fRX = offsetX + drawW - finishR_s;
          const fRY = offsetY + moldingH_s;
          const fRH = drawH - moldingH_s;
          sinkModuleSvg += `<rect x="${fRX}" y="${fRY}" width="${finishR_s}" height="${fRH}" fill="#d1d5db" stroke="#9ca3af" stroke-width="1" opacity="0.6"/>
    <text x="${fRX + finishR_s / 2}" y="${fRY + fRH / 2}" text-anchor="middle" font-size="7" fill="#555" transform="rotate(-90 ${fRX + finishR_s / 2} ${fRY + fRH / 2})">${finishRType} ${finishR}</text>`;
        }

        // 도어 색상 및 간격 설정
        const showDoors = item.specs.showDoors || false;
        const doorColorU = getDoorColor(item.specs.doorColorUpper || '화이트');
        const doorColorL = getDoorColor(item.specs.doorColorLower || '화이트');
        const doorGap = 3 * scale; // 3mm 간격
        const upperOverlap_s = (parseFloat(item.specs.upperDoorOverlap) || 15) * scale;

        // 상부장 모듈들
        let upperStartX = offsetX + finishL * scale;
        const upperY = offsetY + moldingH_s;
        upperModules.forEach((mod, idx) => {
          const modW = parseFloat(mod.w) * scale;
          const icons = { hood: '🌀', storage: '📦' };
          const icon = icons[mod.type] || '📦';
          const fillColor = mod.type === 'hood' ? '#fef3c7' : '#eff6ff';
          const strokeColor = mod.type === 'hood' ? '#f59e0b' : '#3b82f6';
          const upperModIdx = item.modules.indexOf(mod);
          sinkModuleSvg += `<rect x="${upperStartX}" y="${upperY}" width="${modW}" height="${upperH_s}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="2" data-mod-index="${upperModIdx}" style="cursor:pointer;" />
      <text x="${upperStartX + modW / 2}" y="${upperY + upperH_s / 2 - 8}" text-anchor="middle" font-size="11" fill="${mod.type === 'hood' ? '#b45309' : '#1d4ed8'}" font-weight="bold" pointer-events="none">${icon}</text>
      <text x="${upperStartX + modW / 2}" y="${upperY + upperH_s / 2 + 8}" text-anchor="middle" font-size="9" fill="#666" pointer-events="none">${mod.w}</text>`;
          upperStartX += modW;
        });

        // ★ 상부장 도어 표시 (도어 높이 = 몸체 + 오버랩)
        if (showDoors) {
          let upperDoorX = offsetX + finishL * scale;
          upperModules.forEach((mod, idx) => {
            const modW = parseFloat(mod.w) * scale;
            const doorCount = Math.max(1, Math.round(mod.w / 450));
            const dW = modW / doorCount;
            const doorH = mod.type === 'hood' ? upperH_s - doorGap : upperH_s + upperOverlap_s - doorGap;
            for (let d = 0; d < doorCount; d++) {
              const dX = upperDoorX + d * dW + doorGap / 2;
              sinkModuleSvg += `<rect x="${dX}" y="${upperY + doorGap / 2}" width="${dW - doorGap}" height="${doorH}" fill="${doorColorU}" stroke="#333" stroke-width="1" rx="2"/>`;
            }
            upperDoorX += modW;
          });
        }

        // 중간 공간 (상판 + 백스플래시 영역)
        const middleY = upperY + upperH_s;
        const middleH_s = drawH - moldingH_s - upperH_s - lowerH_s - legH_s;
        const topT = parseFloat(item.specs.topThickness) || 12;
        const topT_s_raw = topT * scale;
        const topT_s_min = 8; // 최소 표시 높이 8px
        const topT_s = Math.min(Math.max(topT_s_raw, topT_s_min), middleH_s);
        const backSplashH_s = Math.max(0, middleH_s - topT_s);
        if (backSplashH_s > 1) {
          sinkModuleSvg += `<rect x="${offsetX}" y="${middleY}" width="${drawW}" height="${backSplashH_s}" fill="#fafafa" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4"/>`;
        }
        // ★ 상판 표시 (최소 8px 보장)
        if (topT_s > 0) {
          const countertopY = middleY + backSplashH_s;
          sinkModuleSvg += `<rect x="${offsetX}" y="${countertopY}" width="${drawW}" height="${topT_s}" fill="#d4a574" stroke="#b8956a" stroke-width="1.5"/>`;
          sinkModuleSvg += `<text x="${offsetX + drawW / 2}" y="${countertopY + topT_s / 2 + 3}" text-anchor="middle" font-size="${topT_s >= 12 ? 9 : 7}" fill="#fff" font-weight="bold">상판 ${topT}mm</text>`;
        }

        // 하부장 모듈들 + 다리발 연동
        let lowerStartX = offsetX + finishL * scale;
        const lowerY = middleY + middleH_s;

        lowerModules.forEach((mod, idx) => {
          const modW = parseFloat(mod.w) * scale;
          const isTall = mod.type === 'tall';
          // 키큰장은 상부장~하부장, 일반 하부장은 하부장+다리발
          const modH_s = isTall ? upperH_s + middleH_s + lowerH_s : lowerH_s + legH_s;
          const modY = isTall ? upperY : lowerY;

          const icons = { sink: '🚰', cook: '🔥', tall: '↕️', storage: '🗄️' };
          const icon = icons[mod.type] || '📦';
          let fillColor = '#f3f4f6';
          let strokeColor = '#6b7280';
          if (mod.type === 'sink') {
            fillColor = '#dbeafe';
            strokeColor = '#3b82f6';
          } else if (mod.type === 'cook') {
            fillColor = '#fee2e2';
            strokeColor = '#ef4444';
          } else if (isTall) {
            fillColor = '#dcfce7';
            strokeColor = '#10b981';
          } else if (mod.isDrawer) {
            fillColor = '#fef3c7';
            strokeColor = '#f59e0b';
          }

          // 모듈 본체 (다리발 포함 높이) — 클릭 가능
          const lowerModIdx = item.modules.indexOf(mod);
          sinkModuleSvg += `<rect x="${lowerStartX}" y="${modY}" width="${modW}" height="${modH_s}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="2" data-mod-index="${lowerModIdx}" style="cursor:pointer;" />`;

          // 다리발 구분선 (키큰장 제외)
          if (!isTall) {
            const legLineY = lowerY + lowerH_s;
            sinkModuleSvg += `<line x1="${lowerStartX}" y1="${legLineY}" x2="${lowerStartX + modW}" y2="${legLineY}" stroke="${strokeColor}" stroke-width="1" stroke-dasharray="3"/>`;
            sinkModuleSvg += `<text x="${lowerStartX + modW / 2}" y="${legLineY + legH_s / 2 + 3}" text-anchor="middle" font-size="7" fill="#888">${legH}</text>`;
          }

          // 도어 표시 (showDoors가 true일 때)
          if (showDoors && !isTall) {
            if (mod.isDrawer) {
              // ★ 서랍장: 상단 서랍 + 하단 여닫이 도어
              const dCount = mod.drawerCount || 1;
              const drawerH = 250; // 서랍 1개 높이 250mm
              const totalDrawerH = drawerH * dCount;
              const totalDrawerH_s = totalDrawerH * scale;
              const hingeDoorH_s = lowerH_s - totalDrawerH_s;

              // 서랍 영역 (상단)
              for (let dr = 0; dr < dCount; dr++) {
                const drY = modY + doorGap / 2 + dr * (totalDrawerH_s / dCount);
                const drH = totalDrawerH_s / dCount - doorGap;
                sinkModuleSvg += `<rect x="${lowerStartX + doorGap / 2}" y="${drY}" width="${modW - doorGap}" height="${drH}" fill="${doorColorL}" stroke="#333" stroke-width="1" rx="2"/>`;
                // 서랍 손잡이 (가로선)
                const handleY = drY + drH / 2;
                const handleW = modW * 0.35;
                sinkModuleSvg += `<line x1="${lowerStartX + modW / 2 - handleW / 2}" y1="${handleY}" x2="${lowerStartX + modW / 2 + handleW / 2}" y2="${handleY}" stroke="#666" stroke-width="2" stroke-linecap="round"/>`;
              }

              // 여닫이 도어 (하단) - 남은 공간
              if (hingeDoorH_s > doorGap * 2) {
                const hingeDoorY = modY + totalDrawerH_s + doorGap / 2;
                const hingeDoorCount = Math.max(1, Math.round(mod.w / 450));
                const dW = modW / hingeDoorCount;
                for (let d = 0; d < hingeDoorCount; d++) {
                  const dX = lowerStartX + d * dW + doorGap / 2;
                  sinkModuleSvg += `<rect x="${dX}" y="${hingeDoorY}" width="${dW - doorGap}" height="${hingeDoorH_s - doorGap}" fill="${doorColorL}" stroke="#333" stroke-width="1" rx="2"/>`;
                }
              }
            } else {
              // 일반 하부장: 전체 여닫이 도어
              const doorCount = Math.max(1, Math.round(mod.w / 450));
              const dW = modW / doorCount;
              for (let d = 0; d < doorCount; d++) {
                const dX = lowerStartX + d * dW + doorGap / 2;
                sinkModuleSvg += `<rect x="${dX}" y="${modY + doorGap / 2}" width="${dW - doorGap}" height="${lowerH_s - doorGap}" fill="${doorColorL}" stroke="#333" stroke-width="1" rx="2"/>`;
              }
            }
          }

          // 아이콘 & 텍스트 (도어 표시시 일반 하부장 아이콘 숨김, 키큰장/서랍장은 항상 표시)
          if (!showDoors || isTall) {
            const drawerLabel = mod.isDrawer ? ` 서랍${mod.drawerCount || 1}` : '';
            sinkModuleSvg += `<text x="${lowerStartX + modW / 2}" y="${modY + (isTall ? modH_s : lowerH_s) / 2 - 8}" text-anchor="middle" font-size="12" fill="${strokeColor}" font-weight="bold" pointer-events="none">${mod.isDrawer ? '🗄️' : icon}</text>
        <text x="${lowerStartX + modW / 2}" y="${modY + (isTall ? modH_s : lowerH_s) / 2 + 8}" text-anchor="middle" font-size="9" fill="#666" pointer-events="none">${mod.w}${isTall ? ' (TL)' : ''}${drawerLabel}</text>`;
          }
          lowerStartX += modW;
        });

        // 다리발 (전체 영역 - 마감 포함)
        const legY = lowerY + lowerH_s;
        // 마감 영역 아래에도 다리발 표시
        if (finishL > 0) {
          sinkModuleSvg += `<rect x="${offsetX}" y="${legY}" width="${finishL * scale}" height="${legH_s}" fill="#d1d5db" stroke="#9ca3af" stroke-width="1"/>`;
        }
        if (finishR > 0) {
          sinkModuleSvg += `<rect x="${offsetX + drawW - finishR * scale}" y="${legY}" width="${finishR * scale}" height="${legH_s}" fill="#d1d5db" stroke="#9ca3af" stroke-width="1"/>`;
        }

        // 좌측 마감 (상부장+상몰딩 높이 / 하부장+다리발 높이)
        if (finishL > 0) {
          const fLw = finishL * scale;
          const fLx = offsetX;
          // 상부장 영역 마감 (상부장 + 상몰딩)
          const fLUpperH = upperH_s + moldingH_s;
          const fLUpperY = upperY - moldingH_s; // 몰딩 상단부터 시작 (= moldingY)
          sinkModuleSvg += `<rect x="${fLx}" y="${fLUpperY}" width="${fLw}" height="${fLUpperH}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>`;
          if (fLUpperH > 20) sinkModuleSvg += `<text x="${fLx + fLw / 2}" y="${fLUpperY + fLUpperH / 2}" text-anchor="middle" font-size="7" fill="#666" transform="rotate(-90 ${fLx + fLw / 2} ${fLUpperY + fLUpperH / 2})">${finishL}</text>`;
          // 하부장 영역 마감 (다리발 + 하부장 모듈)
          const fLLowerH = lowerH_s + legH_s;
          sinkModuleSvg += `<rect x="${fLx}" y="${lowerY}" width="${fLw}" height="${fLLowerH}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>`;
          if (fLLowerH > 20) sinkModuleSvg += `<text x="${fLx + fLw / 2}" y="${lowerY + fLLowerH / 2}" text-anchor="middle" font-size="7" fill="#666" transform="rotate(-90 ${fLx + fLw / 2} ${lowerY + fLLowerH / 2})">${finishL}</text>`;
        }
        // 우측 마감 (상부장+상몰딩 높이 / 하부장+다리발 높이)
        if (finishR > 0) {
          const fRw = finishR * scale;
          const fRx = offsetX + drawW - fRw;
          // 상부장 영역 마감 (상부장 + 상몰딩)
          const fRUpperH = upperH_s + moldingH_s;
          const fRUpperY = upperY - moldingH_s;
          sinkModuleSvg += `<rect x="${fRx}" y="${fRUpperY}" width="${fRw}" height="${fRUpperH}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>`;
          if (fRUpperH > 20) sinkModuleSvg += `<text x="${fRx + fRw / 2}" y="${fRUpperY + fRUpperH / 2}" text-anchor="middle" font-size="7" fill="#666" transform="rotate(-90 ${fRx + fRw / 2} ${fRUpperY + fRUpperH / 2})">${finishR}</text>`;
          // 하부장 영역 마감 (다리발 + 하부장 모듈)
          const fRLowerH = lowerH_s + legH_s;
          sinkModuleSvg += `<rect x="${fRx}" y="${lowerY}" width="${fRw}" height="${fRLowerH}" fill="#e0e0e0" stroke="#999" stroke-width="1"/>`;
          if (fRLowerH > 20) sinkModuleSvg += `<text x="${fRx + fRw / 2}" y="${lowerY + fRLowerH / 2}" text-anchor="middle" font-size="7" fill="#666" transform="rotate(-90 ${fRx + fRw / 2} ${lowerY + fRLowerH / 2})">${finishR}</text>`;
        }

        // ★ 걸레받이 (도어 표시시에만, 하부장에 설치)
        if (showDoors) {
          const baseboardH = legH - 5; // 걸레받이 높이 = 다리발 높이 - 5mm
          const baseboardH_s = baseboardH * scale;
          // 하부장 너비 합계 (키큰장 제외)
          const lowerTotalW = lowerModules
            .filter((m) => m.type !== 'tall')
            .reduce((sum, m) => sum + parseFloat(m.w), 0);

          if (lowerTotalW > 0 && baseboardH > 0) {
            const MAX_BASEBOARD_W = 2400;
            const baseboardCount = Math.ceil(lowerTotalW / MAX_BASEBOARD_W);
            const baseboardY = legY + (legH_s - baseboardH_s);
            let currentX = offsetX + finishL * scale;
            let remainingW = lowerTotalW;

            for (let i = 0; i < baseboardCount; i++) {
              const thisW = Math.min(remainingW, MAX_BASEBOARD_W);
              const thisW_s = thisW * scale;
              sinkModuleSvg += `<rect x="${currentX}" y="${baseboardY}" width="${thisW_s}" height="${baseboardH_s}" fill="#8b5cf6" stroke="#6d28d9" stroke-width="1.5" rx="1"/>
          <text x="${currentX + thisW_s / 2}" y="${baseboardY + baseboardH_s / 2 + 3}" text-anchor="middle" font-size="7" fill="#fff" font-weight="bold">걸레받이 ${thisW}×${baseboardH}</text>`;
              currentX += thisW_s;
              remainingW -= thisW;
            }
          }
        }

        // 분배기/환풍구 위치 마커 (항상 표시, 드래그 이동)
        const distStart = parseFloat(item.specs.distributorStart) || Math.round(sinkW * 0.2);
        const distEnd = parseFloat(item.specs.distributorEnd) || Math.round(sinkW * 0.5);
        const ventPos = parseFloat(item.specs.ventStart) || Math.round(sinkW * 0.7);
        // 초기값 저장
        if (!item.specs.distributorStart) item.specs.distributorStart = distStart;
        if (!item.specs.distributorEnd) item.specs.distributorEnd = distEnd;
        if (!item.specs.ventStart) item.specs.ventStart = ventPos;

        let utilityMarkers = '';
        const uid = item.uniqueId;

        // 실측 기준 방향
        const isRefLeft = item.specs.measurementBase === 'Left';
        const refLabel = isRefLeft ? '좌' : '우';

        // 분배기 — 하부장 하단 (배관 그림 + 치수)
        {
          const pipeY = lowerY + lowerH_s - 16;
          const dsx = offsetX + distStart * scale;
          const dex = offsetX + distEnd * scale;
          utilityMarkers += `
            <line x1="${dsx}" y1="${pipeY + 8}" x2="${dex}" y2="${pipeY + 8}" stroke="#60a5fa" stroke-width="3" stroke-linecap="round" opacity="0.5"/>
            <line x1="${dsx}" y1="${pipeY}" x2="${dsx}" y2="${pipeY + 8}" stroke="#2563eb" stroke-width="2" opacity="0.6"/>
            <line x1="${dex}" y1="${pipeY}" x2="${dex}" y2="${pipeY + 8}" stroke="#2563eb" stroke-width="2" opacity="0.6"/>
            <circle cx="${dsx}" cy="${pipeY + 8}" r="5" fill="#2563eb" stroke="#fff" stroke-width="1.5" style="cursor:ew-resize;" data-drag="distributorStart" data-uid="${uid}"/>
            <circle cx="${dex}" cy="${pipeY + 8}" r="5" fill="#2563eb" stroke="#fff" stroke-width="1.5" style="cursor:ew-resize;" data-drag="distributorEnd" data-uid="${uid}"/>
            <text x="${dsx}" y="${pipeY - 3}" text-anchor="middle" font-size="7" fill="#2563eb" pointer-events="none">${distStart}</text>
            <text x="${dex}" y="${pipeY - 3}" text-anchor="middle" font-size="7" fill="#2563eb" pointer-events="none">${distEnd}</text>`;
        }

        // 환풍구 — 상부장 상단 (덕트 그림 + 치수)
        {
          const ductY = upperY + 3;
          const vx = offsetX + ventPos * scale;
          utilityMarkers += `
            <g style="cursor:ew-resize;" data-drag="ventStart" data-uid="${uid}">
              <rect x="${vx - 12}" y="${ductY}" width="24" height="14" fill="#fef2f2" stroke="#ef4444" stroke-width="1.5" rx="3"/>
              <line x1="${vx - 7}" y1="${ductY + 3}" x2="${vx - 7}" y2="${ductY + 11}" stroke="#ef4444" stroke-width="1"/>
              <line x1="${vx - 2}" y1="${ductY + 3}" x2="${vx - 2}" y2="${ductY + 11}" stroke="#ef4444" stroke-width="1"/>
              <line x1="${vx + 3}" y1="${ductY + 3}" x2="${vx + 3}" y2="${ductY + 11}" stroke="#ef4444" stroke-width="1"/>
              <line x1="${vx + 8}" y1="${ductY + 3}" x2="${vx + 8}" y2="${ductY + 11}" stroke="#ef4444" stroke-width="1"/>
            </g>
            <text x="${vx}" y="${ductY + 24}" text-anchor="middle" font-size="7" fill="#dc2626" pointer-events="none">${ventPos}</text>`;
        }

        // 실측 기준 표시 (도면 하단)
        {
          const refX = isRefLeft ? offsetX : offsetX + drawW;
          const refY = offsetY + drawH + 15;
          utilityMarkers += `
            <line x1="${refX}" y1="${offsetY}" x2="${refX}" y2="${refY - 4}" stroke="#b8956c" stroke-width="1" stroke-dasharray="4" opacity="0.5"/>
            <text x="${refX}" y="${refY + 2}" text-anchor="middle" font-size="8" fill="#b8956c" font-weight="bold">▲ ${refLabel} 기준</text>`;
        }

        const sinkFrontViewSvg = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" preserveAspectRatio="xMidYMid meet" style="background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;">
      <!-- 치수선 - 상단 -->
      <line x1="${offsetX}" y1="${offsetY - 15}" x2="${offsetX + drawW}" y2="${offsetY - 15}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX}" y1="${offsetY - 20}" x2="${offsetX}" y2="${offsetY - 10}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX + drawW}" y1="${offsetY - 20}" x2="${offsetX + drawW}" y2="${offsetY - 10}" stroke="#666" stroke-width="1"/>
      <text x="${offsetX + drawW / 2}" y="${offsetY - 25}" text-anchor="middle" font-size="12" fill="#333" font-weight="bold">${sinkW}mm</text>

      <!-- 치수선 - 좌측 -->
      <line x1="${offsetX - 15}" y1="${offsetY}" x2="${offsetX - 15}" y2="${offsetY + drawH}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX - 20}" y1="${offsetY}" x2="${offsetX - 10}" y2="${offsetY}" stroke="#666" stroke-width="1"/>
      <line x1="${offsetX - 20}" y1="${offsetY + drawH}" x2="${offsetX - 10}" y2="${offsetY + drawH}" stroke="#666" stroke-width="1"/>
      <text x="${offsetX - 25}" y="${offsetY + drawH / 2}" text-anchor="middle" font-size="12" fill="#333" font-weight="bold" transform="rotate(-90 ${offsetX - 25} ${offsetY + drawH / 2})">${sinkH}mm</text>

      <!-- 모듈들 -->
      ${sinkModuleSvg}

      <!-- 분배기/환풍구 마커 -->
      ${utilityMarkers}
    </svg>
  `;

        // 마감 설정
        let cornerHtml = '';
        if (item.specs.layoutShape === 'L') {
          cornerHtml = `<div class="spec-row"><div class="spec-field"><label>코너 마감</label><select onchange="updateSpecNoRender(${item.uniqueId}, 'finishCorner1Type', this.value)"><option value="Molding" ${item.specs.finishCorner1Type === 'Molding' ? 'selected' : ''}>몰딩</option><option value="Filler" ${item.specs.finishCorner1Type === 'Filler' ? 'selected' : ''}>휠라</option></select></div><div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishCorner1Width}" onchange="updateSpecValue(${item.uniqueId}, 'finishCorner1Width', this.value)"></div></div>`;
        } else if (item.specs.layoutShape === 'U') {
          cornerHtml = `<div class="spec-row"><div class="spec-field"><label>코너1 마감</label><select onchange="updateSpecNoRender(${item.uniqueId}, 'finishCorner1Type', this.value)"><option value="Molding" ${item.specs.finishCorner1Type === 'Molding' ? 'selected' : ''}>몰딩</option><option value="Filler" ${item.specs.finishCorner1Type === 'Filler' ? 'selected' : ''}>휠라</option></select></div><div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishCorner1Width}" onchange="updateSpecValue(${item.uniqueId}, 'finishCorner1Width', this.value)"></div></div>
    <div class="spec-row"><div class="spec-field"><label>코너2 마감</label><select onchange="updateSpecNoRender(${item.uniqueId}, 'finishCorner2Type', this.value)"><option value="Molding" ${item.specs.finishCorner2Type === 'Molding' ? 'selected' : ''}>몰딩</option><option value="Filler" ${item.specs.finishCorner2Type === 'Filler' ? 'selected' : ''}>휠라</option></select></div><div class="spec-field"><label>길이(mm)</label><input type="number" value="${item.specs.finishCorner2Width}" onchange="updateSpecValue(${item.uniqueId}, 'finishCorner2Width', this.value)"></div></div>`;
        }

        const shapes = { I: 'ㅡ자형 (1개)', L: 'ㄱ자형 (2개)', U: 'ㄷ자형 (3개)' };
        const topCount = item.specs.layoutShape === 'U' ? 3 : item.specs.layoutShape === 'L' ? 2 : 1;
        let topSizeInputs = '';
        for (let i = 0; i < topCount; i++) {
          const ts = item.specs.topSizes[i] || { w: '', d: '' };
          const label = topCount > 1 ? `#${i + 1} ` : '';
          topSizeInputs += `<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;">
            <span style="font-size:11px;color:#888;min-width:20px;">${label}</span>
            <input type="number" placeholder="길이(W)" value="${ts.w || ''}" onchange="updateTopSizeDim(${item.uniqueId}, ${i}, 'w', this.value)" style="flex:1;min-width:0;">
            <span style="font-size:11px;color:#999;">×</span>
            <input type="number" placeholder="폭(D)" value="${ts.d || ''}" onchange="updateTopSizeDim(${item.uniqueId}, ${i}, 'd', this.value)" style="flex:1;min-width:0;">
          </div>`;
        }

        const accHtml = item.specs.accessories
          .map(
            (acc) => `
    <div class="acc-item">
      <select style="flex:1;" onchange="updateAccessory(${item.uniqueId}, ${acc.id}, this.value)">
        <option value="LTMesh" ${acc.type === 'LTMesh' ? 'selected' : ''}>LT망장</option>
        <option value="CircleMesh" ${acc.type === 'CircleMesh' ? 'selected' : ''}>원망장</option>
        <option value="Cutlery" ${acc.type === 'Cutlery' ? 'selected' : ''}>수저분리함</option>
        <option value="Knife" ${acc.type === 'Knife' ? 'selected' : ''}>칼꽂이</option>
        <option value="DishRack" ${acc.type === 'DishRack' ? 'selected' : ''}>식기건조대</option>
        <option value="Etc" ${acc.type === 'Etc' ? 'selected' : ''}>기타</option>
      </select>
      <button class="btn-del-acc" onclick="removeAccessory(${item.uniqueId}, ${acc.id})">×</button>
    </div>
  `
          )
          .join('');

        ws.innerHTML = `
    <div class="ws-header">
      <div class="ws-title">${item.labelName} 상세 설계 <span class="ws-info-badge">W ${item.w} x H ${item.h} x D ${item.d}</span>${(item.specs.lowerLayoutShape || item.specs.layoutShape) !== 'I' && item.specs.lowerSecondaryW ? `<span class="ws-info-badge" style="margin-left:4px;">Sec: W ${item.specs.lowerSecondaryW}</span>` : ''}</div>
      <div style="display:flex;gap:8px;">
        <button class="btn-purple-gradient" onclick="generateAIDesign()" title="AI 디자인 이미지 생성">🎨 AI 디자인 생성</button>
        <button onclick="proceedToBOM()" style="background:linear-gradient(135deg,#4caf50,#388e3c);color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:bold;cursor:pointer;" title="자재/부자재 산출">📋 BOM 산출</button>
      </div>
    </div>
    <!-- 현장 실측 & Layout — 풀 너비 패널 -->
    <div style="background:#f8f9fa;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:700;color:var(--primary-color);">현장 실측 & Layout</div>
          <div style="display:flex;gap:3px;">
            <button style="padding:2px 8px;font-size:10px;border-radius:3px;border:${(item.specs.dimensionMode || 'unified') === 'unified' ? 'none;background:#b8956c;color:#fff' : '1px solid #ccc;background:#fff;color:#888'};cursor:pointer;" onclick="${(item.specs.dimensionMode || 'unified') !== 'unified' ? `toggleDimensionMode(${item.uniqueId})` : ''}" ${(item.specs.dimensionMode || 'unified') === 'unified' ? 'disabled' : ''}>통합</button>
            <button style="padding:2px 8px;font-size:10px;border-radius:3px;border:${(item.specs.dimensionMode || 'unified') === 'split' ? 'none;background:#b8956c;color:#fff' : '1px solid #ccc;background:#fff;color:#888'};cursor:pointer;" onclick="${(item.specs.dimensionMode || 'unified') !== 'split' ? `toggleDimensionMode(${item.uniqueId})` : ''}" ${(item.specs.dimensionMode || 'unified') === 'split' ? 'disabled' : ''}>분리</button>
          </div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>실측 기준</label>
            <select onchange="updateSpec(${item.uniqueId}, 'measurementBase', this.value)">
              <option value="Left" ${item.specs.measurementBase === 'Left' ? 'selected' : ''}>좌측</option>
              <option value="Right" ${item.specs.measurementBase === 'Right' ? 'selected' : ''}>우측</option>
            </select>
          </div>
          <div class="spec-field"><label>구조 형태</label>
            <select onchange="changeLowerLayoutShape(${item.uniqueId}, this.value)">
              <option value="I" ${(item.specs.lowerLayoutShape || item.specs.layoutShape) === 'I' ? 'selected' : ''}>ㅡ자형</option>
              <option value="L" ${(item.specs.lowerLayoutShape || item.specs.layoutShape) === 'L' ? 'selected' : ''}>ㄱ자형</option>
              <option value="U" ${(item.specs.lowerLayoutShape || item.specs.layoutShape) === 'U' ? 'selected' : ''}>ㄷ자형</option>
            </select>
          </div>
        </div>
        <div class="spec-row" style="margin-bottom:2px;">
          <div class="spec-field" style="flex:2"><label>현장 실측 치수</label></div>
          <div class="spec-field"><label>현장 사진</label></div>
        </div>
        <div class="spec-row">
          <div class="spec-field"><label>W</label><input type="number" placeholder="mm" value="${item.w}" onchange="updateItemValue(${item.uniqueId}, 'w', this.value); renderWorkspaceContent(getItem(${item.uniqueId}))"></div>
          <div class="spec-field"><label>H</label><input type="number" placeholder="mm" value="${item.h}" onchange="updateItemValue(${item.uniqueId}, 'h', this.value); renderWorkspaceContent(getItem(${item.uniqueId}))"></div>
          <div class="spec-field"><label>D</label><input type="number" placeholder="mm" value="${item.d || ''}" onchange="updateItemValue(${item.uniqueId}, 'd', this.value)"></div>
          <div class="spec-field">
            <div style="display:flex;align-items:center;gap:4px;">
              <button onclick="document.getElementById('ws-file-${item.uniqueId}').click()" style="padding:4px 10px;font-size:11px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;">${item.image && item.image !== 'loading' ? '변경' : '📷'}</button>
              ${item.image && item.image !== 'loading' ? `<img src="${item.image}" style="height:28px;border-radius:3px;" alt="">` : ''}
              <input type="file" id="ws-file-${item.uniqueId}" style="display:none" accept="image/*" onchange="handleItemPhoto(${item.uniqueId}, event)">
            </div>
          </div>
        </div>
        ${(() => {
          const lShape = item.specs.lowerLayoutShape || item.specs.layoutShape || 'I';
          if (lShape === 'I') return '';
          const secMode = item.specs.secondaryDimensionMode || 'unified';
          const secLH = item.specs.lowerSecondaryH || item.specs.lowerH || 870;
          const secUH = item.specs.upperSecondaryH || item.specs.upperH || 720;
          const secLD = item.specs.lowerSecondaryD || item.d || item.defaultD || '';
          const secUD = item.specs.upperSecondaryD || item.specs.upperPrimeD || 295;
          return `
        <div style="padding:6px;background:#f9f9f9;border-radius:6px;margin-top:4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <span style="font-size:11px;font-weight:600;color:#888;">Secondary Line</span>
            <div style="display:flex;gap:3px;">
              <button style="padding:2px 6px;font-size:9px;border-radius:3px;border:${secMode === 'unified' ? 'none;background:#888;color:#fff' : '1px solid #ccc;background:#fff;color:#888'};cursor:pointer;" onclick="${secMode !== 'unified' ? `toggleSecondaryDimensionMode(${item.uniqueId})` : ''}" ${secMode === 'unified' ? 'disabled' : ''}>통합</button>
              <button style="padding:2px 6px;font-size:9px;border-radius:3px;border:${secMode === 'split' ? 'none;background:#888;color:#fff' : '1px solid #ccc;background:#fff;color:#888'};cursor:pointer;" onclick="${secMode !== 'split' ? `toggleSecondaryDimensionMode(${item.uniqueId})` : ''}" ${secMode === 'split' ? 'disabled' : ''}>분리</button>
            </div>
          </div>
          ${secMode === 'unified' ? `
          <div class="spec-row">
            <div class="spec-field"><label>가로(W)</label><input type="number" placeholder="mm" value="${item.specs.lowerSecondaryW || ''}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryW', this.value); updateSpec(${item.uniqueId}, 'upperSecondaryW', this.value)"></div>
          </div>
          <div class="spec-row">
            <div class="spec-field"><label>하부 H</label><input type="number" value="${secLH}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryH', this.value)"></div>
            <div class="spec-field"><label>하부 D</label><input type="number" value="${secLD}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryD', this.value)"></div>
            <div class="spec-field"><label>상부 H</label><input type="number" value="${secUH}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryH', this.value)"></div>
            <div class="spec-field"><label>상부 D</label><input type="number" value="${secUD}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryD', this.value)"></div>
          </div>
          ` : `
          <div style="padding:4px 6px;border-left:2px solid #b8956c;margin-bottom:4px;">
            <div style="font-size:9px;font-weight:600;color:#b8956c;margin-bottom:2px;">하부장</div>
            <div class="spec-row">
              <div class="spec-field"><label>W</label><input type="number" value="${item.specs.lowerSecondaryW || ''}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryW', this.value)"></div>
              <div class="spec-field"><label>H</label><input type="number" value="${secLH}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryH', this.value)"></div>
              <div class="spec-field"><label>D</label><input type="number" value="${secLD}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryD', this.value)"></div>
            </div>
          </div>
          <div style="padding:4px 6px;border-left:2px solid #5a7fa0;">
            <div style="font-size:9px;font-weight:600;color:#5a7fa0;margin-bottom:2px;">상부장</div>
            <div class="spec-row">
              <div class="spec-field"><label>W</label><input type="number" value="${item.specs.upperSecondaryW || ''}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryW', this.value)"></div>
              <div class="spec-field"><label>H</label><input type="number" value="${secUH}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryH', this.value)"></div>
              <div class="spec-field"><label>D</label><input type="number" value="${secUD}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryD', this.value)"></div>
            </div>
          </div>
          `}
        </div>`;
        })()}
    </div>

    <!-- ★ 자동계산 바 -->
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center;padding:8px 12px;background:#faf8f5;border:1px solid #e8e0d8;border-radius:6px;">
      ${item.categoryId === 'sink' ? `
      <span style="font-size:11px;color:#888;">필수장:</span>
      <span class="essential-toggle ${item.specs.essentialLower?.sink !== false ? 'active' : ''}" onclick="toggleEssentialBtn(this,${item.uniqueId},'lower','sink')" style="padding:3px 8px;font-size:11px;border-radius:4px;cursor:pointer;">🚰 개수대</span>
      <span class="essential-toggle ${item.specs.essentialLower?.cook !== false ? 'active' : ''}" onclick="toggleEssentialBtn(this,${item.uniqueId},'lower','cook')" style="padding:3px 8px;font-size:11px;border-radius:4px;cursor:pointer;">🔥 가스대</span>
      <span style="width:1px;height:16px;background:#ddd;margin:0 4px;"></span>
      ` : ''}
      <button onclick="runAutoCalcSection(${item.uniqueId}, 'upper'); runAutoCalcSection(${item.uniqueId}, 'lower')" style="padding:6px 16px;font-size:12px;border:none;border-radius:6px;background:linear-gradient(135deg,#b8956c,#d4b896);color:#fff;cursor:pointer;font-weight:600;">⚡ 자동계산</button>
      <button onclick="undoAutoCalc(${item.uniqueId}, 'upper'); undoAutoCalc(${item.uniqueId}, 'lower')" style="padding:6px 12px;font-size:11px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;color:#888;" ${item.prevUpperModules || item.prevLowerModules ? '' : 'disabled'}>↩ 되돌리기</button>
      <span style="font-size:11px;color:#888;">상부: <span style="color:${getRemainColor(upperRemaining)}">${Math.round(upperRemaining)}mm</span> | 하부: <span style="color:${getRemainColor(lowerRemaining)}">${Math.round(lowerRemaining)}mm</span></span>
      <div style="flex:1;"></div>
      <button onclick="openSpecPopup(${item.uniqueId}, 'dimensions')" style="padding:4px 10px;font-size:10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;color:#666;">📏 치수</button>
      <button onclick="openSpecPopup(${item.uniqueId}, 'hardware')" style="padding:4px 10px;font-size:10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;color:#666;">🔧 HW</button>
      <button onclick="openSpecPopup(${item.uniqueId}, 'colors')" style="padding:4px 10px;font-size:10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;color:#666;">🎨 색상</button>
      <button onclick="openSpecPopup(${item.uniqueId}, 'countertop')" style="padding:4px 10px;font-size:10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;color:#666;">🪨 상판</button>
      <button onclick="openSpecPopup(${item.uniqueId}, 'finish')" style="padding:4px 10px;font-size:10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;color:#666;">✂️ 마감</button>
    </div>

    <!-- ★ Front View + 좌측 치수 패널 -->
    <div style="display:flex;gap:12px;flex:1;min-height:0;">
      <!-- 좌측: 상하부장 치수 -->
      <div style="width:140px;min-width:140px;display:flex;flex-direction:column;gap:8px;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:8px;">
          <div style="font-size:10px;font-weight:700;color:#3b82f6;margin-bottom:6px;">⬆ 상부장</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <div><label style="font-size:9px;color:#666;">높이(H)</label><input type="number" style="width:100%;font-size:12px;padding:3px 6px;" value="${item.specs.upperH}" onchange="updateSpecValue(${item.uniqueId}, 'upperH', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">깊이(D)</label><input type="number" style="width:100%;font-size:12px;padding:3px 6px;" value="${item.specs.upperPrimeD || 295}" onchange="updateSpec(${item.uniqueId}, 'upperPrimeD', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">오버랩</label><input type="number" style="width:100%;font-size:12px;padding:3px 6px;" value="${item.specs.upperDoorOverlap}" onchange="updateSpecValue(${item.uniqueId}, 'upperDoorOverlap', this.value)"></div>
          </div>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:8px;">
          <div style="font-size:10px;font-weight:700;color:#b45309;margin-bottom:6px;">⬇ 하부장</div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            <div><label style="font-size:9px;color:#666;">높이(H)</label><input type="number" style="width:100%;font-size:12px;padding:3px 6px;" value="${item.specs.lowerH}" onchange="updateSpecValue(${item.uniqueId}, 'lowerH', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">깊이(D)</label><input type="number" style="width:100%;font-size:12px;padding:3px 6px;" value="${item.d || item.defaultD || ''}" onchange="updateItemValue(${item.uniqueId}, 'd', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">다리발</label>
              <select style="width:100%;font-size:12px;padding:3px 6px;" onchange="updateSpec(${item.uniqueId}, 'sinkLegHeight', this.value)">
                <option value="120" ${item.specs.sinkLegHeight == 120 ? 'selected' : ''}>120</option>
                <option value="150" ${item.specs.sinkLegHeight == 150 ? 'selected' : ''}>150</option>
              </select>
            </div>
          </div>
        </div>
        <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:8px;">
          <div style="font-size:10px;font-weight:700;color:#666;margin-bottom:6px;">상몰딩</div>
          <div><input type="number" style="width:100%;font-size:12px;padding:3px 6px;" value="${item.specs.moldingH}" onchange="updateSpecValue(${item.uniqueId}, 'moldingH', this.value)"></div>
        </div>
      </div>
      <!-- 우측: Front View 도면 -->
      <div style="flex:1;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px;display:flex;flex-direction:column;min-width:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:13px;font-weight:bold;color:#333;">📐 Front View</span>
            <span style="font-size:10px;color:#aaa;">모듈 클릭 → 편집</span>
          </div>
          <div style="display:flex;gap:4px;">
            <button onclick="toggleViewMode(${item.uniqueId})" class="toggle-btn ${item.specs.viewMode === 'iso' ? 'active' : ''}" style="padding:3px 10px;font-size:10px;">${item.specs.viewMode === 'iso' ? '📐 Front' : '🧊 Iso'}</button>
            <button onclick="toggleSinkDoors(${item.uniqueId})" class="toggle-btn ${showDoors ? 'active' : ''}" style="padding:3px 10px;font-size:10px;">🚪 도어</button>
          </div>
        </div>
        <div style="flex:1;width:100%;overflow:auto;position:relative;" onclick="handleFrontViewClick(event, ${item.uniqueId})">
          ${item.specs.viewMode === 'iso' ? renderIsometricView(item, upperModules, lowerModules, showDoors) : sinkFrontViewSvg}
        </div>
        <!-- 분배기/환풍구는 도면 내부 그림으로만 표시 (슬라이더 제거) -->
        <div style="display:none;">
        </div>
      </div>
    </div>

    <!-- ★ 팝업 모달 -->
    <div id="spec-popup-${item.uniqueId}" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:2000;align-items:center;justify-content:center;" onclick="if(event.target===this)closeSpecPopup(${item.uniqueId})">
      <div style="background:#fff;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div id="spec-popup-title-${item.uniqueId}" style="font-size:16px;font-weight:700;color:#333;"></div>
          <button onclick="closeSpecPopup(${item.uniqueId})" style="background:none;border:none;font-size:20px;cursor:pointer;color:#999;">×</button>
        </div>
        <div id="spec-popup-body-${item.uniqueId}" class="spec-panel" style="background:none;border:none;padding:0;max-height:none;overflow:visible;"></div>
      </div>
    </div>
  `;

        // ★ 스크롤 복원
        _restoreScroll(ws, scrollInfo);
        _restoreFocus(ws, focusInfo);
      }

      // ============================================================
      // 뷰 모드 토글 + 아이소메트릭 뷰
      // ============================================================

      function toggleViewMode(itemUniqueId) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        item.specs.viewMode = item.specs.viewMode === 'iso' ? 'front' : 'iso';
        renderWorkspaceContent(item);
      }

      function renderIsometricView(item, upperModules, lowerModules, showDoors) {
        const W = parseFloat(item.w) || 3000;
        const H = parseFloat(item.h) || 2400;
        const D = parseFloat(item.d) || 650;
        const upperH = parseFloat(item.specs.upperH) || 720;
        const lowerH = parseFloat(item.specs.lowerH) || 870;
        const moldingH = parseFloat(item.specs.moldingH) || 60;
        const legH = parseFloat(item.specs.sinkLegHeight) || 120;
        const topT = parseFloat(item.specs.topThickness) || 12;
        const finishL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const finishR = item.specs.finishRightType !== 'None' ? parseFloat(item.specs.finishRightWidth) || 0 : 0;
        const upperD = 295;
        const lowerD = 550;

        // 아이소메트릭 투영 파라미터
        const svgW = 720, svgH = 500;
        const angle = Math.PI / 6; // 30°
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        const depthScale = 0.45;

        // 스케일 계산 — 전면(W×H) + 깊이 오프셋이 SVG에 맞도록
        const dOffsetX = D * depthScale * cosA;
        const dOffsetY = D * depthScale * sinA;
        const maxW = W + dOffsetX;
        const maxH = H + dOffsetY;
        const sx = (svgW - 130) / maxW;
        const sy = (svgH - 90) / maxH;
        const s = Math.min(sx, sy);

        // 원점 (전면 좌하단)
        const ox = 60;
        const oy = svgH - 50 + dOffsetY * s;

        // 투영 함수: (x, y, z) → SVG (px, py) — y는 위로+, z는 깊이
        function proj(x, y, z) {
          const px = ox + x * s + z * depthScale * cosA * s;
          const py = oy - y * s - z * depthScale * sinA * s;
          return [px, py];
        }

        // 3D 박스 → SVG polygon (전면, 상면, 측면)
        function isoBox(x, y, z, w, h, d, fillF, fillT, fillS, strokeCol = '#555', sw = 1) {
          // 8개 꼭짓점
          const fbl = proj(x, y, z);         // front-bottom-left
          const fbr = proj(x + w, y, z);     // front-bottom-right
          const ftl = proj(x, y + h, z);     // front-top-left
          const ftr = proj(x + w, y + h, z); // front-top-right
          const bbl = proj(x, y, z + d);
          const bbr = proj(x + w, y, z + d);
          const btl = proj(x, y + h, z + d);
          const btr = proj(x + w, y + h, z + d);

          let svg = '';
          // 전면 (front face)
          svg += `<polygon points="${fbl.join(',')},${fbr.join(',')},${ftr.join(',')},${ftl.join(',')}" fill="${fillF}" stroke="${strokeCol}" stroke-width="${sw}"/>`;
          // 상면 (top face)
          svg += `<polygon points="${ftl.join(',')},${ftr.join(',')},${btr.join(',')},${btl.join(',')}" fill="${fillT}" stroke="${strokeCol}" stroke-width="${sw}"/>`;
          // 우측면 (right side face)
          svg += `<polygon points="${fbr.join(',')},${bbr.join(',')},${btr.join(',')},${ftr.join(',')}" fill="${fillS}" stroke="${strokeCol}" stroke-width="${sw}"/>`;
          return svg;
        }

        let svg = '';
        const midH = H - moldingH - upperH - lowerH - legH;
        const midY = legH + lowerH;
        const uY = H - moldingH - upperH;
        const lY = legH;
        const kickboardRecess = 60; // 걸레받이 뒤로 들어가는 깊이

        // ── ① 좌측 마감재 (모듈 뒤에 가림 → 먼저 렌더) ──
        if (finishL > 0) {
          // 하부장 영역: 다리발 + 하부장 모듈 높이, 깊이=상판(D)
          svg += isoBox(0, 0, 0, finishL, legH + lowerH, D, '#e0e0e0', '#d4d4d4', '#c8c8c8', '#999');
          // 상부장 영역: 상부장 + 상몰딩 높이
          svg += isoBox(0, uY, 0, finishL, upperH + moldingH, upperD, '#e0e0e0', '#d4d4d4', '#c8c8c8', '#999');
        }

        // ── ② 걸레받이 (하부장 하단, 뒤로 60mm 들어감) ──
        const kickW = W - finishL - finishR; // 마감재 제외 너비
        svg += isoBox(finishL, 0, kickboardRecess, kickW, legH, lowerD - kickboardRecess, '#d1d5db', '#c4c4c4', '#b0b0b0', '#9ca3af');

        // ── ③ 하부장 모듈 ──
        let lx = finishL;
        lowerModules.forEach(mod => {
          const mw = parseFloat(mod.w) || 0;
          const isTall = mod.type === 'tall';
          const mh = isTall ? upperH + midH + lowerH : lowerH;
          const my = isTall ? uY : lY;
          const md = isTall ? lowerD : lowerD;

          let fillF = '#f3f4f6', fillT = '#e5e7eb', fillS = '#d1d5db', sc = '#6b7280';
          if (mod.type === 'sink') { fillF = '#dbeafe'; fillT = '#bfdbfe'; fillS = '#93c5fd'; sc = '#3b82f6'; }
          else if (mod.type === 'cook') { fillF = '#fee2e2'; fillT = '#fecaca'; fillS = '#fca5a5'; sc = '#ef4444'; }
          else if (isTall) { fillF = '#dcfce7'; fillT = '#bbf7d0'; fillS = '#86efac'; sc = '#10b981'; }
          else if (mod.isDrawer) { fillF = '#fef3c7'; fillT = '#fde68a'; fillS = '#fcd34d'; sc = '#f59e0b'; }

          svg += isoBox(lx, my, 0, mw, mh, md, fillF, fillT, fillS, sc);

          const icons = { sink: '🚰', cook: '🔥', tall: '↕️', storage: '🗄️' };
          const icon = icons[mod.type] || '📦';
          const [cx, cy] = proj(lx + mw / 2, my + mh / 2, 0);
          svg += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="11" font-weight="bold">${icon}</text>`;
          svg += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="8" fill="#555">${mw}</text>`;
          lx += mw;
        });

        // ── ③-2 우측 하부장 마감재 (모듈 뒤에 보이도록, 상판에 덮이도록) ──
        if (finishR > 0) {
          svg += isoBox(W - finishR, 0, 0, finishR, legH + lowerH, D, '#e0e0e0', '#d4d4d4', '#c8c8c8', '#999');
        }

        // ── ④ 상판 ──
        svg += isoBox(0, midY, 0, W, topT, D, '#d4a574', '#c89660', '#b8865a', '#8b6914', 1.5);
        const [tpx, tpy] = proj(W / 2, midY + topT / 2, 0);
        svg += `<text x="${tpx}" y="${tpy + 3}" text-anchor="middle" font-size="8" fill="#fff" font-weight="bold">상판 ${topT}mm</text>`;

        // ── ④-1 상판 위 설비 (싱크볼+수전, 가스레인지) ──
        const equipY = midY + topT; // 상판 상면
        let eqX = finishL;
        lowerModules.forEach(mod => {
          const mw = parseFloat(mod.w) || 0;
          if (mod.type === 'sink') {
            // 싱크볼: 상판 위에 오목한 사각 박스
            const bowlW = mw * 0.65, bowlD = D * 0.45;
            const bowlX = eqX + (mw - bowlW) / 2;
            const bowlZ = (D - bowlD) / 2;
            const bowlH = 8; // 볼 깊이 (얕은 박스)
            svg += isoBox(bowlX, equipY, bowlZ, bowlW, bowlH, bowlD, '#c0d8f0', '#a8c8e8', '#90b8e0', '#5b8db8', 1);
            // 싱크볼 내부 (물색)
            const innerM = 15;
            svg += isoBox(bowlX + innerM, equipY + 1, bowlZ + innerM, bowlW - innerM * 2, bowlH - 1, bowlD - innerM * 2, '#bde0fe', '#9ecffa', '#7ebef6', '#5b8db8', 0.5);
            // 거위목 수전 — 싱크볼 중앙 안쪽(뒤쪽) 상판 위
            const fCenterX = bowlX + bowlW * 0.5 - 15; // 볼 중앙
            const fBackZ = bowlZ + bowlD * 0.85; // 안쪽(뒤쪽) 상판 위
            // 베이스 (원형 근사)
            svg += isoBox(fCenterX, equipY, fBackZ, 30, 8, 30, '#c8c8c8', '#b8b8b8', '#a8a8a8', '#999');
            // 수직 기둥 (굵게)
            svg += isoBox(fCenterX + 8, equipY + 8, fBackZ + 8, 14, 80, 14, '#d4d4d4', '#c4c4c4', '#b4b4b4', '#999');
            // 거위목 커브 — 뒤에서 앞으로 휘어지는 목 (위쪽 가로)
            svg += isoBox(fCenterX + 6, equipY + 80, fBackZ - 20, 18, 14, 40, '#d0d0d0', '#c0c0c0', '#b0b0b0', '#999');
            // 토출구 (아래로 꺾임 — 앞쪽 끝)
            svg += isoBox(fCenterX + 8, equipY + 65, fBackZ - 22, 14, 15, 10, '#ccc', '#bbb', '#aaa', '#999');
            // 토출구 끝 (물 나오는 부분)
            const [spX, spY] = proj(fCenterX + 15, equipY + 65, fBackZ - 18);
            svg += `<circle cx="${spX}" cy="${spY}" r="2.5" fill="#60a5fa" opacity="0.7"/>`;
          }
          if (mod.type === 'cook') {
            // 가스레인지: 상판 위 박스 + 버너 표시
            const rangeW = mw * 0.8, rangeD = D * 0.5;
            const rangeX = eqX + (mw - rangeW) / 2;
            const rangeZ = (D - rangeD) / 2;
            // 레인지 본체
            svg += isoBox(rangeX, equipY, rangeZ, rangeW, 6, rangeD, '#333', '#2a2a2a', '#222', '#111', 1);
            // 버너 2개 (원형 근사 — 작은 사각형)
            const burnerR = Math.min(rangeW * 0.18, rangeD * 0.25);
            const b1x = rangeX + rangeW * 0.3 - burnerR;
            const b2x = rangeX + rangeW * 0.7 - burnerR;
            const bz = rangeZ + rangeD * 0.5 - burnerR;
            svg += isoBox(b1x, equipY + 6, bz, burnerR * 2, 2, burnerR * 2, '#555', '#4a4a4a', '#404040', '#666', 0.5);
            svg += isoBox(b2x, equipY + 6, bz, burnerR * 2, 2, burnerR * 2, '#555', '#4a4a4a', '#404040', '#666', 0.5);
            // 버너 가운데 점
            const [c1x, c1y] = proj(b1x + burnerR, equipY + 8, bz + burnerR);
            const [c2x, c2y] = proj(b2x + burnerR, equipY + 8, bz + burnerR);
            svg += `<circle cx="${c1x}" cy="${c1y}" r="2" fill="#f97316"/>`;
            svg += `<circle cx="${c2x}" cy="${c2y}" r="2" fill="#f97316"/>`;
          }
          eqX += mw;
        });

        // ── ⑤ 중간 빈 공간 (백스플래시) — Iso뷰에서는 생략 ──

        // ── ⑥ 상부장 모듈 ──
        let ux = finishL;
        upperModules.forEach(mod => {
          const mw = parseFloat(mod.w) || 0;
          const fillF = mod.type === 'hood' ? '#fef3c7' : '#dbeafe';
          const fillT = mod.type === 'hood' ? '#fde68a' : '#bfdbfe';
          const fillS = mod.type === 'hood' ? '#fcd34d' : '#93c5fd';
          svg += isoBox(ux, uY, 0, mw, upperH, upperD, fillF, fillT, fillS, mod.type === 'hood' ? '#f59e0b' : '#3b82f6');
          const [cx, cy] = proj(ux + mw / 2, uY + upperH / 2, 0);
          const icon = mod.type === 'hood' ? '🌀' : '📦';
          svg += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="11" font-weight="bold">${icon}</text>`;
          svg += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="8" fill="#555">${mw}</text>`;
          ux += mw;
        });

        // ── ⑥-1 도어 표시 (showDoors) ──
        if (showDoors) {
          const doorColorU = getDoorColor(item.specs.doorColorUpper || '화이트');
          const doorColorL = getDoorColor(item.specs.doorColorLower || '화이트');
          const doorT = 3; // 도어 두께 3mm
          const dGap = 3; // 도어 간 간격 3mm
          const upperOverlap = parseFloat(item.specs.upperDoorOverlap) || 15;

          // 상부장 도어
          let udx = finishL;
          upperModules.forEach(mod => {
            const mw = parseFloat(mod.w) || 0;
            const doorCount = Math.max(1, Math.round(mw / 450));
            const dw = mw / doorCount;
            const dh = mod.type === 'hood' ? upperH - dGap * 2 : upperH + upperOverlap - dGap * 2;
            const dy = mod.type === 'hood' ? uY + dGap : uY - upperOverlap + dGap;
            for (let d = 0; d < doorCount; d++) {
              const dx = udx + d * dw + dGap;
              svg += isoBox(dx, dy, -doorT, dw - dGap * 2, dh, doorT, doorColorU, doorColorU, doorColorU, '#555', 0.8);
            }
            udx += mw;
          });

          // 하부장 도어
          let ldx = finishL;
          lowerModules.forEach(mod => {
            const mw = parseFloat(mod.w) || 0;
            const isTall = mod.type === 'tall';
            if (isTall) { ldx += mw; return; }

            if (mod.isDrawer) {
              // 서랍장: 상단 서랍 + 하단 여닫이
              const dCount = mod.drawerCount || 1;
              const drawerH = 250;
              const totalDrawerH = drawerH * dCount;
              // 서랍
              for (let dr = 0; dr < dCount; dr++) {
                const drY = lY + lowerH - totalDrawerH + dr * drawerH + dGap;
                svg += isoBox(ldx + dGap, drY, -doorT, mw - dGap * 2, drawerH - dGap * 2, doorT, doorColorL, doorColorL, doorColorL, '#555', 0.8);
                // 서랍 손잡이 (가로 라인)
                const [hl, hly] = proj(ldx + mw * 0.3, drY + drawerH / 2, -doorT);
                const [hr, hry] = proj(ldx + mw * 0.7, drY + drawerH / 2, -doorT);
                svg += `<line x1="${hl}" y1="${hly}" x2="${hr}" y2="${hry}" stroke="#888" stroke-width="1.5" stroke-linecap="round"/>`;
              }
              // 하단 여닫이
              const hingeDoorH = lowerH - totalDrawerH;
              if (hingeDoorH > dGap * 2) {
                const hingeDoorCount = Math.max(1, Math.round(mw / 450));
                const hdw = mw / hingeDoorCount;
                for (let d = 0; d < hingeDoorCount; d++) {
                  svg += isoBox(ldx + d * hdw + dGap, lY + dGap, -doorT, hdw - dGap * 2, hingeDoorH - dGap * 2, doorT, doorColorL, doorColorL, doorColorL, '#555', 0.8);
                }
              }
            } else {
              // 일반 하부장: 여닫이 도어
              const doorCount = Math.max(1, Math.round(mw / 450));
              const dw = mw / doorCount;
              for (let d = 0; d < doorCount; d++) {
                svg += isoBox(ldx + d * dw + dGap, lY + dGap, -doorT, dw - dGap * 2, lowerH - dGap * 2, doorT, doorColorL, doorColorL, doorColorL, '#555', 0.8);
              }
            }
            ldx += mw;
          });
        }

        // ── ⑦ 상몰딩 (상부장 상단 앞면에 딱 맞게, 깊이=상부장 깊이) ──
        const moldY = H - moldingH;
        svg += isoBox(finishL, moldY, 0, W - finishL - finishR, moldingH, upperD, '#e5e7eb', '#d1d5db', '#c9c9c9', '#9ca3af');

        // ── ⑧ 우측 상부장 마감재 (하부장은 ①-2에서 이미 렌더) ──
        if (finishR > 0) {
          svg += isoBox(W - finishR, uY, 0, finishR, upperH + moldingH, upperD, '#e0e0e0', '#d4d4d4', '#c8c8c8', '#999');
        }

        // ── 치수선 ──
        // W (하단)
        const [wl, wly] = proj(0, -60, 0);
        const [wr, wry] = proj(W, -60, 0);
        svg += `<line x1="${wl}" y1="${wly}" x2="${wr}" y2="${wry}" stroke="#666" stroke-width="1"/>`;
        svg += `<line x1="${wl}" y1="${wly - 5}" x2="${wl}" y2="${wly + 5}" stroke="#666"/>`;
        svg += `<line x1="${wr}" y1="${wry - 5}" x2="${wr}" y2="${wry + 5}" stroke="#666"/>`;
        const [wm, wmy] = proj(W / 2, -60, 0);
        svg += `<text x="${wm}" y="${wmy - 8}" text-anchor="middle" font-size="12" fill="#333" font-weight="bold">${W}mm</text>`;

        // H (좌측)
        const [hl, hly] = proj(-50, 0, 0);
        const [ht, hty] = proj(-50, H, 0);
        svg += `<line x1="${hl}" y1="${hly}" x2="${ht}" y2="${hty}" stroke="#666" stroke-width="1"/>`;
        svg += `<line x1="${hl - 5}" y1="${hly}" x2="${hl + 5}" y2="${hly}" stroke="#666"/>`;
        svg += `<line x1="${ht - 5}" y1="${hty}" x2="${ht + 5}" y2="${hty}" stroke="#666"/>`;
        const [hm, hmy] = proj(-50, H / 2, 0);
        svg += `<text x="${hm - 10}" y="${hmy}" text-anchor="middle" font-size="12" fill="#333" font-weight="bold" transform="rotate(-90 ${hm - 10} ${hmy})">${H}mm</text>`;

        // D (깊이 축)
        const [dl, dly] = proj(W + 20, 0, 0);
        const [dr, dry] = proj(W + 20, 0, D);
        svg += `<line x1="${dl}" y1="${dly}" x2="${dr}" y2="${dry}" stroke="#666" stroke-width="1"/>`;
        svg += `<line x1="${dl - 3}" y1="${dly - 3}" x2="${dl + 3}" y2="${dly + 3}" stroke="#666"/>`;
        svg += `<line x1="${dr - 3}" y1="${dry - 3}" x2="${dr + 3}" y2="${dry + 3}" stroke="#666"/>`;
        const [dm, dmy] = proj(W + 20, 0, D / 2);
        svg += `<text x="${dm + 5}" y="${dmy - 8}" text-anchor="start" font-size="10" fill="#333" font-weight="bold">${D}mm</text>`;

        return `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" style="background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;">${svg}</svg>`;
      }

