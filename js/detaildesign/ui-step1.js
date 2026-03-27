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
          // ★ 레이아웃 템플릿 프리셋 (B1)
          newItem.specs.layoutTemplates = {
            standard: { label: '표준형 (3m)', desc: '개수대+가스대+수납 3종', w: 3000 },
            compact: { label: '소형 (2.4m)', desc: '개수대+가스대 최소', w: 2400 },
            large: { label: '대형 (4m)', desc: '개수대+가스대+식세기+수납', w: 4000 },
          };
        }

        if (cat.id === 'wardrobe') {
          // ★ 붙박이장 템플릿 (B1)
          newItem.specs.layoutTemplates = {
            balanced: { label: '균형형', desc: '짧은옷2 + 긴옷1 + 선반1' },
            hangOnly: { label: '행거 중심', desc: '짧은옷2 + 긴옷2' },
            shelfOnly: { label: '선반 중심', desc: '선반3 + 짧은옷1' },
          };
        }

        if (cat.id === 'fridge') {
          // ★ 냉장고장 템플릿 (B1)
          newItem.specs.layoutTemplates = {
            standard: { label: '냉장고+키큰장', desc: '냉장고 좌측, 키큰장 우측' },
            withCafe: { label: '냉장고+홈카페', desc: '냉장고 좌측, 홈카페 우측' },
            dual: { label: '양문형', desc: '키큰장+냉장고+키큰장' },
          };
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
        try {

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
          sinkModuleSvg += `<rect x="${upperStartX}" y="${upperY}" width="${modW}" height="${upperH_s}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="2" data-mod-index="${upperModIdx}" data-drag-mod="${upperModIdx}" data-uid="${item.uniqueId}" data-mod-pos="upper" style="cursor:grab;" />
      <text x="${upperStartX + modW / 2}" y="${upperY + upperH_s / 2 - 8}" text-anchor="middle" font-size="11" fill="${mod.type === 'hood' ? '#b45309' : '#1d4ed8'}" font-weight="bold" pointer-events="none">${icon}</text>
      <text x="${upperStartX + modW / 2}" y="${upperY + upperH_s / 2 + 8}" text-anchor="middle" font-size="9" fill="#666" pointer-events="none">${mod.w}</text>`;
          upperStartX += modW;
        });

        // 상부장 빈 공간에 + 버튼
        {
          const upperEndX = offsetX + drawW - finishR_s;
          const gapThreshold = DOOR_MIN_WIDTH * scale;
          if (upperStartX < upperEndX - gapThreshold) {
            const gapW = upperEndX - upperStartX;
            const gapCx = upperStartX + gapW / 2;
            const gapCy = upperY + upperH_s / 2;
            sinkModuleSvg += `
              <rect x="${upperStartX}" y="${upperY}" width="${gapW}" height="${upperH_s}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="6" rx="4" style="cursor:pointer;" onclick="addModuleAtGap(${item.uniqueId}, 'upper', ${Math.round(gapW / scale)})"/>
              <circle cx="${gapCx}" cy="${gapCy}" r="12" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1.5" style="cursor:pointer;pointer-events:none;"/>
              <text x="${gapCx}" y="${gapCy + 5}" text-anchor="middle" font-size="16" fill="#64748b" font-weight="bold" pointer-events="none">+</text>`;
          }
        }

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
          sinkModuleSvg += `<rect x="${lowerStartX}" y="${modY}" width="${modW}" height="${modH_s}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" rx="2" data-mod-index="${lowerModIdx}" data-drag-mod="${lowerModIdx}" data-uid="${item.uniqueId}" data-mod-pos="lower" style="cursor:grab;" />`;

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

        // 하부장 빈 공간에 + 버튼
        {
          const lowerEndX = offsetX + drawW - finishR_s;
          const gapThreshold = DOOR_MIN_WIDTH * scale;
          if (lowerStartX < lowerEndX - gapThreshold) {
            const gapW = lowerEndX - lowerStartX;
            const gapCx = lowerStartX + gapW / 2;
            const gapCy = lowerY + (lowerH_s + legH_s) / 2;
            sinkModuleSvg += `
              <rect x="${lowerStartX}" y="${lowerY}" width="${gapW}" height="${lowerH_s + legH_s}" fill="#fefce8" stroke="#d4a574" stroke-width="1" stroke-dasharray="6" rx="4" style="cursor:pointer;" onclick="addModuleAtGap(${item.uniqueId}, 'lower', ${Math.round(gapW / scale)})"/>
              <circle cx="${gapCx}" cy="${gapCy}" r="12" fill="#fef3c7" stroke="#d97706" stroke-width="1.5" style="cursor:pointer;pointer-events:none;"/>
              <text x="${gapCx}" y="${gapCy + 5}" text-anchor="middle" font-size="16" fill="#92400e" font-weight="bold" pointer-events="none">+</text>`;
          }
        }

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
        const distStart = parseFloat(item.specs.distributorStart) || Math.round(sinkW * 0.15);
        const distEnd = parseFloat(item.specs.distributorEnd) || Math.round(sinkW * 0.15 + 700);
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

        // 유틸리티 클램핑 경계
        const drawLeft = offsetX + finishL_s;
        const drawRight = offsetX + drawW - finishR_s;

        // 분배기 — 하부장 하단 (배관 그림 + 치수 + 클릭 팝업 + 드래그)
        {
          const pipeY = lowerY + lowerH_s - 16;
          const dsx = Math.max(drawLeft, Math.min(drawRight, offsetX + distStart * scale));
          const dex = Math.max(drawLeft, Math.min(drawRight, offsetX + distEnd * scale));
          // 클릭 영역 (배관 라인 → 팝업)
          utilityMarkers += `
            <rect x="${Math.min(dsx, dex) - 5}" y="${pipeY - 8}" width="${Math.abs(dex - dsx) + 10}" height="24" fill="transparent" style="cursor:pointer;" onclick="openUtilityPopup(${uid}, 'distributor')"/>`;
          // 배관 그림
          utilityMarkers += `
            <line x1="${dsx}" y1="${pipeY + 8}" x2="${dex}" y2="${pipeY + 8}" stroke="#60a5fa" stroke-width="3" stroke-linecap="round" opacity="0.5" pointer-events="none"/>
            <line x1="${dsx}" y1="${pipeY}" x2="${dsx}" y2="${pipeY + 8}" stroke="#2563eb" stroke-width="2" opacity="0.6" pointer-events="none"/>
            <line x1="${dex}" y1="${pipeY}" x2="${dex}" y2="${pipeY + 8}" stroke="#2563eb" stroke-width="2" opacity="0.6" pointer-events="none"/>
            <text x="${dsx}" y="${pipeY - 3}" text-anchor="middle" font-size="7" fill="#2563eb" pointer-events="none">${distStart}</text>
            <text x="${dex}" y="${pipeY - 3}" text-anchor="middle" font-size="7" fill="#2563eb" pointer-events="none">${distEnd}</text>`;
          // 드래그 핸들 (원)
          utilityMarkers += `
            <circle cx="${dsx}" cy="${pipeY + 8}" r="5" fill="#2563eb" stroke="#fff" stroke-width="1.5" style="cursor:ew-resize;" data-drag="distributorStart" data-uid="${uid}"/>
            <circle cx="${dex}" cy="${pipeY + 8}" r="5" fill="#2563eb" stroke="#fff" stroke-width="1.5" style="cursor:ew-resize;" data-drag="distributorEnd" data-uid="${uid}"/>`;
        }

        // 환풍구 — 상부장 상단 (덕트 그림 + 치수 + 클릭 팝업 + 드래그)
        {
          const ductY = upperY + 3;
          const vx = Math.max(drawLeft + 14, Math.min(drawRight - 14, offsetX + ventPos * scale));
          // 클릭 영역 (덕트 → 팝업, 드래그보다 뒤에 렌더)
          utilityMarkers += `
            <rect x="${vx - 20}" y="${ductY - 4}" width="40" height="30" fill="transparent" style="cursor:pointer;" onclick="openUtilityPopup(${uid}, 'vent')"/>`;
          // 덕트 그림 (드래그 가능)
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
        <div class="spec-row">
          <div class="spec-field"><label>현장 실측 W</label><input type="number" placeholder="mm" value="${item.w}" onchange="updateItemValue(${item.uniqueId}, 'w', this.value); renderWorkspaceContent(getItem(${item.uniqueId}))"></div>
          <div class="spec-field"><label>H</label><input type="number" placeholder="mm" value="${item.h}" onchange="updateItemValue(${item.uniqueId}, 'h', this.value); renderWorkspaceContent(getItem(${item.uniqueId}))"></div>
          <div class="spec-field"><label>D</label><input type="number" placeholder="mm" value="${item.d || ''}" onchange="updateItemValue(${item.uniqueId}, 'd', this.value)"></div>
          <div class="spec-field"><label>사진</label>
            <div style="display:flex;align-items:center;gap:4px;">
              <button onclick="document.getElementById('ws-file-${item.uniqueId}').click()" style="padding:3px 8px;font-size:10px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer;">${item.image && item.image !== 'loading' ? '📷 변경' : '📷 업로드'}</button>
              ${item.image && item.image !== 'loading' ? `<img src="${item.image}" style="height:24px;border-radius:3px;" alt="">` : ''}
              <input type="file" id="ws-file-${item.uniqueId}" style="display:none" accept="image/*" onchange="handleItemPhoto(${item.uniqueId}, event)">
            </div>
          </div>
        </div>
        ${(() => {
          const lShape = item.specs.lowerLayoutShape || item.specs.layoutShape || 'I';
          if (lShape === 'I') return '';
          const secLH = item.specs.lowerSecondaryH || item.specs.lowerH || 870;
          const secUH = item.specs.upperSecondaryH || item.specs.upperH || 720;
          const secLD = item.specs.lowerSecondaryD || item.d || item.defaultD || '';
          const secUD = item.specs.upperSecondaryD || item.specs.upperPrimeD || 295;
          const secUpperOn = item.specs.secondaryUpperEnabled !== false;
          return `
        <div style="padding:6px;background:#f9f9f9;border-radius:6px;margin-top:4px;">
          <div style="font-size:11px;font-weight:600;color:#888;margin-bottom:4px;">Secondary Line</div>
          <div style="padding:4px 6px;border-left:2px solid #b8956c;margin-bottom:4px;">
            <div style="font-size:9px;font-weight:600;color:#b8956c;margin-bottom:2px;">하부장</div>
            <div class="spec-row">
              <div class="spec-field"><label>W</label><input type="number" value="${item.specs.lowerSecondaryW || ''}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryW', this.value)"></div>
              <div class="spec-field"><label>H</label><input type="number" value="${secLH}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryH', this.value)"></div>
              <div class="spec-field"><label>D</label><input type="number" value="${secLD}" onchange="updateSpec(${item.uniqueId}, 'lowerSecondaryD', this.value)"></div>
            </div>
          </div>
          <div style="padding:4px 6px;border-left:2px solid ${secUpperOn ? '#5a7fa0' : '#ccc'};${secUpperOn ? '' : 'opacity:0.5;'}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
              <span style="font-size:9px;font-weight:600;color:${secUpperOn ? '#5a7fa0' : '#aaa'};">상부장</span>
              <label style="font-size:9px;color:#666;cursor:pointer;display:flex;align-items:center;gap:2px;">
                <input type="checkbox" ${secUpperOn ? 'checked' : ''} onchange="updateSpec(${item.uniqueId}, 'secondaryUpperEnabled', this.checked); renderWorkspaceContent(getItem(${item.uniqueId}))" style="margin:0;width:12px;height:12px;">
                <span>사용</span>
              </label>
            </div>
            <div class="spec-row">
              <div class="spec-field"><label>W</label><input type="number" value="${item.specs.upperSecondaryW || ''}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryW', this.value)" ${secUpperOn ? '' : 'disabled'}></div>
              <div class="spec-field"><label>H</label><input type="number" value="${secUH}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryH', this.value)" ${secUpperOn ? '' : 'disabled'}></div>
              <div class="spec-field"><label>D</label><input type="number" value="${secUD}" onchange="updateSpec(${item.uniqueId}, 'upperSecondaryD', this.value)" ${secUpperOn ? '' : 'disabled'}></div>
            </div>
          </div>
        </div>`;
        })()}
    </div>

    <!-- ★ 레이아웃 템플릿 (B1) -->
    ${item.specs.layoutTemplates && item.modules.length === 0 ? `
    <div style="display:flex;gap:6px;margin-bottom:8px;padding:10px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
      <span style="font-size:11px;color:#16a34a;font-weight:600;white-space:nowrap;line-height:28px;">📋 템플릿:</span>
      ${Object.entries(item.specs.layoutTemplates).map(([key, t]) => `
        <button onclick="applyLayoutTemplate(${item.uniqueId}, '${key}')" style="padding:4px 12px;font-size:11px;border:1px solid #86efac;border-radius:6px;background:#fff;cursor:pointer;color:#166534;" title="${t.desc}">${t.label}</button>
      `).join('')}
    </div>
    ` : ''}

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
      <button onclick="clearAllModules(${item.uniqueId})" style="padding:6px 12px;font-size:11px;border:1px solid #f5c6cb;border-radius:6px;background:#fff;cursor:pointer;color:#dc3545;">🗑 전체 제거</button>
      <span style="font-size:11px;color:#888;">상부: <span style="color:${getRemainColor(upperRemaining)}">${Math.round(upperRemaining)}mm</span> | 하부: <span style="color:${getRemainColor(lowerRemaining)}">${Math.round(lowerRemaining)}mm</span></span>
    </div>

    <!-- ★ 컨스트레인트 경고 (B3) -->
    ${(() => {
      const warnings = [];
      if (upperRemaining < -5) warnings.push(`⚠️ 상부장 ${Math.abs(Math.round(upperRemaining))}mm 초과`);
      if (lowerRemaining < -5) warnings.push(`⚠️ 하부장 ${Math.abs(Math.round(lowerRemaining))}mm 초과`);
      if (item.categoryId === 'sink') {
        const hasSink = lowerModules.some(m => m.type === 'sink' || m.hasSink || m.has_sink);
        const hasCook = lowerModules.some(m => m.type === 'cook' || m.hasCooktop || m.has_cooktop);
        if (!hasSink && lowerModules.length > 0) warnings.push('🚰 개수대 모듈 미배치');
        if (!hasCook && lowerModules.length > 0) warnings.push('🔥 가스대 모듈 미배치');
      }
      const wideMods = [...upperModules, ...lowerModules].filter(m => {
        const w = parseFloat(m.w) || 0;
        const doors = m.doorCount || Math.ceil(w / 550);
        return (w / doors) > 600;
      });
      if (wideMods.length > 0) wideMods.forEach(m => { const dw = Math.round(parseFloat(m.w) / (m.doorCount || Math.ceil(parseFloat(m.w)/550))); warnings.push(`📏 ${m.name || m.type} (도어 ${dw}mm) — 600mm 초과`); });
      if (warnings.length === 0) return '';
      return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;padding:6px 10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;">${warnings.map(w => `<span style="font-size:11px;color:#dc2626;">${w}</span>`).join('<span style="color:#fca5a5;">|</span>')}</div>`;
    })()}

    <!-- ★ 3컬럼: 좌측(치수+옵션) / 중앙(도면) / 우측(HW+액세서리) -->
    <div style="display:flex;gap:8px;flex:1;min-height:0;">
      <!-- 좌측: 치수 + 색상 + 상판 + 마감 -->
      <div style="width:150px;min-width:150px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:calc(100vh - 300px);">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#3b82f6;margin-bottom:4px;">⬆ 상부장</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div><label style="font-size:9px;color:#666;">높이</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.specs.upperH}" onchange="updateSpecValue(${item.uniqueId}, 'upperH', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">깊이</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.specs.upperPrimeD || 295}" onchange="updateSpec(${item.uniqueId}, 'upperPrimeD', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">오버랩</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.specs.upperDoorOverlap}" onchange="updateSpecValue(${item.uniqueId}, 'upperDoorOverlap', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">도어색상</label><div style="display:flex;gap:2px;"><select style="flex:1;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'doorFinishUpper', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_finish', item.specs.doorFinishUpper, 'sink')}</select><select style="flex:1;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'doorColorUpper', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_color', item.specs.doorColorUpper, 'sink')}</select></div></div>
          </div>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#b45309;margin-bottom:4px;">⬇ 하부장</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div><label style="font-size:9px;color:#666;">높이</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.specs.lowerH}" onchange="updateSpecValue(${item.uniqueId}, 'lowerH', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">깊이</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.d || item.defaultD || ''}" onchange="updateItemValue(${item.uniqueId}, 'd', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">다리발</label><select style="width:100%;font-size:11px;padding:2px 4px;" onchange="updateSpec(${item.uniqueId}, 'sinkLegHeight', this.value)"><option value="120" ${item.specs.sinkLegHeight == 120 ? 'selected' : ''}>120</option><option value="150" ${item.specs.sinkLegHeight == 150 ? 'selected' : ''}>150</option></select></div>
            <div><label style="font-size:9px;color:#666;">도어색상</label><div style="display:flex;gap:2px;"><select style="flex:1;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'doorFinishLower', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_finish', item.specs.doorFinishLower, 'sink')}</select><select style="flex:1;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'doorColorLower', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('door_color', item.specs.doorColorLower, 'sink')}</select></div></div>
          </div>
        </div>
        <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#666;margin-bottom:4px;">상판</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div><label style="font-size:9px;color:#666;">색상</label><select style="width:100%;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'topColor', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('countertop', item.specs.topColor)}</select></div>
            <div><label style="font-size:9px;color:#666;">두께(T)</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.specs.topThickness}" onchange="updateSpecValue(${item.uniqueId}, 'topThickness', this.value)"></div>
          </div>
        </div>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#666;margin-bottom:4px;">마감</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div><label style="font-size:9px;color:#666;">상몰딩</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.specs.moldingH}" onchange="updateSpecValue(${item.uniqueId}, 'moldingH', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">좌측</label><div style="display:flex;gap:2px;"><select style="flex:1;font-size:10px;" onchange="updateFinishType(${item.uniqueId}, 'Left', this.value)"><option value="Molding" ${item.specs.finishLeftType === 'Molding' ? 'selected' : ''}>몰딩</option><option value="Filler" ${item.specs.finishLeftType === 'Filler' ? 'selected' : ''}>휠라</option><option value="EP" ${item.specs.finishLeftType === 'EP' ? 'selected' : ''}>EP</option><option value="None" ${item.specs.finishLeftType === 'None' ? 'selected' : ''}>없음</option></select><input type="number" style="width:40px;font-size:10px;padding:1px;" value="${item.specs.finishLeftWidth}" onchange="updateSpecValue(${item.uniqueId}, 'finishLeftWidth', this.value)"></div></div>
            <div><label style="font-size:9px;color:#666;">우측</label><div style="display:flex;gap:2px;"><select style="flex:1;font-size:10px;" onchange="updateFinishType(${item.uniqueId}, 'Right', this.value)"><option value="Molding" ${item.specs.finishRightType === 'Molding' ? 'selected' : ''}>몰딩</option><option value="Filler" ${item.specs.finishRightType === 'Filler' ? 'selected' : ''}>휠라</option><option value="EP" ${item.specs.finishRightType === 'EP' ? 'selected' : ''}>EP</option><option value="None" ${item.specs.finishRightType === 'None' ? 'selected' : ''}>없음</option></select><input type="number" style="width:40px;font-size:10px;padding:1px;" value="${item.specs.finishRightWidth}" onchange="updateSpecValue(${item.uniqueId}, 'finishRightWidth', this.value)"></div></div>
          </div>
        </div>
      </div>
      <!-- 우측: Front View 도면 -->
      <div style="flex:1;background:#fff;border:1px solid #eee;border-radius:8px;padding:8px;display:flex;flex-direction:column;min-width:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:13px;font-weight:bold;color:#333;">🎮 3D View</span>
            <span style="font-size:10px;color:#aaa;">모듈 클릭 → 편집 | 드래그 → 회전 | 스크롤 → 줌</span>
          </div>
          <div style="display:flex;gap:4px;">
            <button onclick="toggleSinkDoors(${item.uniqueId})" class="toggle-btn ${showDoors ? 'active' : ''}" style="padding:3px 10px;font-size:10px;">🚪 도어</button>
          </div>
        </div>
        <div id="view-container-${item.uniqueId}" style="flex:1;width:100%;overflow:auto;position:relative;min-height:450px;">
          <div id="three-canvas-${item.uniqueId}" style="width:100%;height:450px;border-radius:8px;overflow:hidden;"></div>
        </div>
        <!-- 분배기/환풍구는 도면 내부 그림으로만 표시 (슬라이더 제거) -->
        <div style="display:none;">
        </div>
      </div>
      <!-- 우측: HW + 액세서리 -->
      <div style="width:150px;min-width:150px;display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:calc(100vh - 300px);">
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#16a34a;margin-bottom:4px;">Hardware</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div><label style="font-size:9px;color:#666;">손잡이</label><select style="width:100%;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'handle', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('handle', item.specs.handle, 'sink')}</select></div>
            <div><label style="font-size:9px;color:#666;">씽크볼</label><select style="width:100%;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'sink', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('sink', item.specs.sink)}</select></div>
            <div><label style="font-size:9px;color:#666;">수전</label><select style="width:100%;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'faucet', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('faucet', item.specs.faucet)}</select></div>
            <div><label style="font-size:9px;color:#666;">후드</label><select style="width:100%;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'hood', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('hood', item.specs.hood)}</select></div>
            <div><label style="font-size:9px;color:#666;">쿡탑</label><select style="width:100%;font-size:10px;padding:1px;" onchange="updateSpec(${item.uniqueId}, 'cooktop', this.value)">${FurnitureOptionCatalog.buildOptionsHtml('cooktop', item.specs.cooktop)}</select></div>
            <div><label style="font-size:9px;color:#666;">식기세척기</label><select style="width:100%;font-size:10px;padding:1px;" onchange="onDishwasherChange(${item.uniqueId}, this.value)"><option value="None" ${item.specs.dishwasher === 'None' ? 'selected' : ''}>없음</option><option value="BuiltIn" ${item.specs.dishwasher === 'BuiltIn' ? 'selected' : ''}>빌트인</option><option value="FreeStanding" ${item.specs.dishwasher === 'FreeStanding' ? 'selected' : ''}>프리스탠딩</option></select></div>
          </div>
        </div>
        <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#7c3aed;margin-bottom:4px;">액세서리</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            ${(item.specs.accessories || []).map(acc => `<div style="display:flex;gap:2px;"><select style="flex:1;font-size:10px;padding:1px;" onchange="updateAccessory(${item.uniqueId},${acc.id},this.value)"><option value="LTMesh" ${acc.type==='LTMesh'?'selected':''}>LT망장</option><option value="CircleMesh" ${acc.type==='CircleMesh'?'selected':''}>원망장</option><option value="Cutlery" ${acc.type==='Cutlery'?'selected':''}>수저분리함</option><option value="Knife" ${acc.type==='Knife'?'selected':''}>칼꽂이</option><option value="DishRack" ${acc.type==='DishRack'?'selected':''}>식기건조대</option></select><button style="font-size:10px;border:1px solid #eee;background:#fff;border-radius:3px;cursor:pointer;padding:0 4px;" onclick="removeAccessory(${item.uniqueId},${acc.id})">×</button></div>`).join('')}
            <button style="width:100%;padding:3px;font-size:9px;border:1px dashed #ccc;background:#fff;border-radius:3px;cursor:pointer;color:#888;" onclick="addAccessory(${item.uniqueId})">+ 추가</button>
          </div>
        </div>
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#2563eb;margin-bottom:4px;">배관 위치 (mm)</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div style="display:flex;align-items:center;gap:4px;">
              <input type="checkbox" ${(item.specs.distributorStart > 0 || item.specs.distributorEnd > 0) ? 'checked' : ''} onchange="togglePlumbing(${item.uniqueId},'distributor',this.checked)" style="margin:0;">
              <label style="font-size:9px;color:#666;flex:1;">분배기 시작</label>
              <input type="number" style="width:60px;font-size:10px;padding:1px;" value="${item.specs.distributorStart || 0}" onchange="updateSpec(${item.uniqueId},'distributorStart',parseFloat(this.value)||0)" ${!(item.specs.distributorStart > 0 || item.specs.distributorEnd > 0) ? 'disabled' : ''}>
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
              <div style="width:13px;"></div>
              <label style="font-size:9px;color:#666;flex:1;">분배기 끝</label>
              <input type="number" style="width:60px;font-size:10px;padding:1px;" value="${item.specs.distributorEnd || 0}" onchange="updateSpec(${item.uniqueId},'distributorEnd',parseFloat(this.value)||0)" ${!(item.specs.distributorStart > 0 || item.specs.distributorEnd > 0) ? 'disabled' : ''}>
            </div>
            <div style="display:flex;align-items:center;gap:4px;">
              <input type="checkbox" ${item.specs.ventStart > 0 ? 'checked' : ''} onchange="togglePlumbing(${item.uniqueId},'vent',this.checked)" style="margin:0;">
              <label style="font-size:9px;color:#666;flex:1;">환풍구</label>
              <input type="number" style="width:60px;font-size:10px;padding:1px;" value="${item.specs.ventStart || 0}" onchange="updateSpec(${item.uniqueId},'ventStart',parseFloat(this.value)||0)" ${!item.specs.ventStart ? 'disabled' : ''}>
            </div>
          </div>
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

        // ★ 3D 뷰 실시간 업데이트 — 항상 render3DView 호출 (DOM 교체 감지 + 재초기화)
        if (typeof ThreeRenderer !== 'undefined') {
          const tryInit3D = (retries) => {
            const container = document.getElementById('three-canvas-' + item.uniqueId);
            if (container && container.clientWidth > 0) {
              const upperModules = item.modules.filter(m => m.pos === 'upper');
              const lowerModules = item.modules.filter(m => m.pos === 'lower');
              // 항상 render3DView 호출 — 내부에서 container 변경 감지 → dispose + init
              ThreeRenderer.render3DView(container, item, upperModules, lowerModules, item.specs.showDoors || false);
              if (!ThreeRenderer._frontViewDone) { ThreeRenderer.setFrontView(); ThreeRenderer._frontViewDone = true; }
            } else if (retries > 0) {
              setTimeout(() => tryInit3D(retries - 1), 100);
            }
          };
          setTimeout(() => tryInit3D(5), 50);
        }

        } catch(err) {
          console.error('[Workspace] 렌더링 에러:', err);
          const ws2 = document.getElementById('designWorkspace');
          if (ws2) ws2.innerHTML = `<div style="padding:40px;text-align:center;color:#e74c3c;"><p>렌더링 에러: ${err.message}</p><button onclick="renderWorkspaceContent(getItem(${item.uniqueId}))" style="margin-top:12px;padding:8px 16px;border:1px solid #ddd;border-radius:6px;cursor:pointer;">다시 시도</button></div>`;
        }
      }

      // ============================================================
      // 뷰 모드 토글 + 아이소메트릭 뷰
      // ============================================================

      function toggleViewMode(itemUniqueId) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        const modes = ['front', 'iso', 'top'];
        const idx = modes.indexOf(item.specs.viewMode || 'front');
        item.specs.viewMode = modes[(idx + 1) % modes.length];
        renderWorkspaceContent(item);
      }

      // ★ 레이아웃 템플릿 적용 (B1)
      function applyLayoutTemplate(itemUniqueId, templateKey) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (typeof pushUndo === 'function') pushUndo(item);

        const W = parseFloat(item.w) || 3000;
        const specLowerH = parseFloat(item.specs.lowerH) || 870;
        const specLegH = parseFloat(item.specs.sinkLegHeight) || 150;
        const specTopT = parseFloat(item.specs.topThickness) || 12;
        const specUpperH = parseFloat(item.specs.upperH) || 720;
        const specOverlap = parseFloat(item.specs.upperDoorOverlap) || 15;
        const lh = specLowerH - specTopT - specLegH;
        const uh = specUpperH - specOverlap;
        const ld = parseFloat(item.d) || 550;
        const ud = 295;
        let nextId = (item.modules.length > 0 ? Math.max(...item.modules.map(m => m.id || 0)) : 0) + 1;

        const mkMod = (pos, type, w, extra = {}) => ({
          id: nextId++, pos, type, w, h: pos === 'upper' ? uh : lh, d: pos === 'upper' ? ud : ld,
          name: type === 'sink' ? '개수대' : type === 'cook' ? '가스대' : type === 'hood' ? '후드' : type === 'storage' ? '수납장' : '모듈',
          isDrawer: false, isFixed: type === 'sink' || type === 'cook',
          hasSink: type === 'sink', hasCooktop: type === 'cook',
          ...extra,
        });

        if (item.categoryId === 'sink') {
          if (templateKey === 'standard') {
            item.w = item.w || '3000';
            item.modules = [
              mkMod('upper', 'storage', 600), mkMod('upper', 'storage', 800),
              mkMod('upper', 'hood', 600), mkMod('upper', 'storage', 600),
              mkMod('lower', 'storage', 600), mkMod('lower', 'sink', 800, { hasSink: true }),
              mkMod('lower', 'cook', 600, { hasCooktop: true }), mkMod('lower', 'storage', 600),
            ];
          } else if (templateKey === 'compact') {
            item.w = item.w || '2400';
            item.modules = [
              mkMod('upper', 'storage', 600), mkMod('upper', 'storage', 600),
              mkMod('upper', 'hood', 600), mkMod('upper', 'storage', 600),
              mkMod('lower', 'storage', 600), mkMod('lower', 'sink', 600, { hasSink: true }),
              mkMod('lower', 'cook', 600, { hasCooktop: true }), mkMod('lower', 'storage', 600),
            ];
          } else if (templateKey === 'large') {
            item.w = item.w || '4000';
            item.modules = [
              mkMod('upper', 'storage', 600), mkMod('upper', 'storage', 800),
              mkMod('upper', 'hood', 800), mkMod('upper', 'storage', 800), mkMod('upper', 'storage', 600),
              mkMod('lower', 'storage', 600), mkMod('lower', 'sink', 800, { hasSink: true }),
              mkMod('lower', 'storage', 600, { isDrawer: true }),
              mkMod('lower', 'cook', 800, { hasCooktop: true }), mkMod('lower', 'storage', 600),
            ];
          }
        }
        renderWorkspaceContent(item);
      }

      function switchViewMode(itemUniqueId, mode) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;

        // 3D → 다른 뷰로 전환 시 Three.js 해제
        if (item.specs.viewMode === '3d' && mode !== '3d' && typeof ThreeRenderer !== 'undefined') {
          ThreeRenderer.dispose();
        }

        item.specs.viewMode = mode;
        renderWorkspaceContent(item);

        // 3D 뷰 활성화 시 Three.js 렌더링 (debounce 30ms + DOM 안정화 대기)
        if (mode === '3d' && typeof ThreeRenderer !== 'undefined') {
          const tryInit3D = (retries) => {
            const container = document.getElementById('three-canvas-' + itemUniqueId);
            if (container && container.clientWidth > 0) {
              const upperModules = item.modules.filter(m => m.pos === 'upper');
              const lowerModules = item.modules.filter(m => m.pos === 'lower');
              ThreeRenderer.render3DView(container, item, upperModules, lowerModules, item.specs.showDoors || false);
            } else if (retries > 0) {
              setTimeout(() => tryInit3D(retries - 1), 100);
            }
          };
          setTimeout(() => tryInit3D(5), 50);
        }
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

          const modIdx = item.modules.indexOf(mod);
          svg += isoBox(lx, my, 0, mw, mh, md, fillF, fillT, fillS, sc);
          // 클릭/드래그 영역 (전면에 투명 오버레이)
          const fbl = proj(lx, my, 0);
          const fbr = proj(lx + mw, my, 0);
          const ftr = proj(lx + mw, my + mh, 0);
          const ftl = proj(lx, my + mh, 0);
          svg += `<polygon points="${fbl.join(',')},${fbr.join(',')},${ftr.join(',')},${ftl.join(',')}" fill="transparent" style="cursor:grab;" data-mod-index="${modIdx}" data-drag-mod="${modIdx}" data-uid="${item.uniqueId}" data-mod-pos="lower"/>`;

          const icons = { sink: '🚰', cook: '🔥', tall: '↕️', storage: '🗄️' };
          const icon = icons[mod.type] || '📦';
          const [cx, cy] = proj(lx + mw / 2, my + mh / 2, 0);
          svg += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="11" font-weight="bold" pointer-events="none">${icon}</text>`;
          svg += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="8" fill="#555" pointer-events="none">${mw}</text>`;
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
          const uModIdx = item.modules.indexOf(mod);
          svg += isoBox(ux, uY, 0, mw, upperH, upperD, fillF, fillT, fillS, mod.type === 'hood' ? '#f59e0b' : '#3b82f6');
          // 클릭/드래그 오버레이
          const ufbl = proj(ux, uY, 0);
          const ufbr = proj(ux + mw, uY, 0);
          const uftr = proj(ux + mw, uY + upperH, 0);
          const uftl = proj(ux, uY + upperH, 0);
          svg += `<polygon points="${ufbl.join(',')},${ufbr.join(',')},${uftr.join(',')},${uftl.join(',')}" fill="transparent" style="cursor:grab;" data-mod-index="${uModIdx}" data-drag-mod="${uModIdx}" data-uid="${item.uniqueId}" data-mod-pos="upper"/>`;
          const [cx, cy] = proj(ux + mw / 2, uY + upperH / 2, 0);
          const icon = mod.type === 'hood' ? '🌀' : '📦';
          svg += `<text x="${cx}" y="${cy - 5}" text-anchor="middle" font-size="11" font-weight="bold" pointer-events="none">${icon}</text>`;
          svg += `<text x="${cx}" y="${cy + 9}" text-anchor="middle" font-size="8" fill="#555" pointer-events="none">${mw}</text>`;
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

        // ── 분배기/환풍구 마커 (Iso뷰) ──
        {
          const distStart = parseFloat(item.specs.distributorStart) || 0;
          const distEnd = parseFloat(item.specs.distributorEnd) || 0;
          const ventPos = parseFloat(item.specs.ventStart) || 0;
          // 분배기 (하부장 전면 하단)
          if (distStart > 0 || distEnd > 0) {
            const [ps] = proj(Math.min(W, distStart), lY, 0);
            const [pe] = proj(Math.min(W, distEnd), lY, 0);
            const [_, psy] = proj(0, lY, 0);
            svg += `<line x1="${ps}" y1="${psy + 3}" x2="${pe}" y2="${psy + 3}" stroke="#60a5fa" stroke-width="3" opacity="0.6"/>`;
            svg += `<circle cx="${ps}" cy="${psy + 3}" r="4" fill="#2563eb" stroke="#fff" stroke-width="1"/>`;
            svg += `<circle cx="${pe}" cy="${psy + 3}" r="4" fill="#2563eb" stroke="#fff" stroke-width="1"/>`;
          }
          // 환풍구 (상부장 전면 상단)
          if (ventPos > 0) {
            const [vx, vy] = proj(Math.min(W, ventPos), uY + upperH, 0);
            svg += `<rect x="${vx - 8}" y="${vy - 12}" width="16" height="10" fill="#fef2f2" stroke="#ef4444" stroke-width="1" rx="2"/>`;
          }
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

      // ============================================================
      // Top View (상면도) — 상부장/하부장 분리
      // ============================================================
      function renderTopView(item, upperModules, lowerModules) {
        const W = parseFloat(item.w) || 3000;
        const D = parseFloat(item.d) || 600;
        const upperD = Math.round(D * 0.55);
        const topT = 30;
        const finishL = item.specs.finishLeftType !== 'None' ? (parseFloat(item.specs.finishLeftWidth) || 0) : 0;
        const lShape = item.specs.lowerLayoutShape || item.specs.layoutShape || 'I';
        const secW = parseFloat(item.specs.lowerSecondaryW) || 0;

        const svgW = 650, sectionGap = 40, pad = 50, innerPad = 15;
        const scale = (svgW - pad * 2) / W;
        const upperDrawD = upperD * scale, lowerDrawD = D * scale, topDrawT = topT * scale;
        const dimOff = 20;

        // ㄱ자형/ㄷ자형이면 세컨더리 라인 영역 추가
        const secH = (lShape !== 'I' && secW > 0) ? (secW * scale + 60) : 0;
        const svgH = pad + upperDrawD + dimOff + 20 + sectionGap + lowerDrawD + topDrawT + dimOff + 40 + secH + pad;
        let svg = '';
        const ox = pad;

        // ═══ 상부장 라벨 (좌측, Front View 스타일) ═══
        let uy = pad;
        svg += `<text x="${ox - 5}" y="${uy - 8}" font-size="11" fill="#333" font-weight="bold">상부장</text>`;
        svg += `<text x="${ox + 42}" y="${uy - 8}" font-size="9" fill="#999">(깊이 ${upperD}mm)</text>`;

        // 상부장 외곽
        svg += `<rect x="${ox}" y="${uy}" width="${W*scale}" height="${upperDrawD}" fill="#f8f9fa" stroke="#999" stroke-width="1.5"/>`;

        // 상부장 모듈 (Front View 색상 통일)
        if (upperModules.length > 0) {
          let ux = ox + finishL * scale;
          for (const mod of upperModules) {
            const mw = (parseFloat(mod.w) || 600) * scale;
            const tModIdx = item.modules.indexOf(mod);
            const fill = mod.type === 'hood' ? '#fef3c7' : '#eff6ff';
            const stroke = mod.type === 'hood' ? '#f59e0b' : '#3b82f6';
            const icon = mod.type === 'hood' ? '🌀' : '📦';
            svg += `<rect x="${ux}" y="${uy}" width="${mw}" height="${upperDrawD}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" rx="2" data-mod-index="${tModIdx}" data-drag-mod="${tModIdx}" data-uid="${item.uniqueId}" data-mod-pos="upper" style="cursor:grab;"/>`;
            svg += `<text x="${ux+mw/2}" y="${uy+upperDrawD/2-4}" text-anchor="middle" font-size="10" pointer-events="none">${icon}</text>`;
            svg += `<text x="${ux+mw/2}" y="${uy+upperDrawD/2+10}" text-anchor="middle" font-size="9" fill="#666" pointer-events="none">${mod.w||''}</text>`;
            ux += mw;
          }
          // 환풍구 마커 (상부장 상단)
          const ventPos = parseFloat(item.specs.ventStart) || 0;
          if (ventPos > 0) {
            const vx = ox + Math.min(W, ventPos) * scale;
            svg += `<rect x="${vx-8}" y="${uy}" width="16" height="10" fill="#fef2f2" stroke="#ef4444" stroke-width="1" rx="2"/>`;
            svg += `<text x="${vx}" y="${uy+8}" text-anchor="middle" font-size="6" fill="#dc2626" pointer-events="none">${ventPos}</text>`;
          }
        }

        // 상부장 치수선 — 상단 (전체 폭)
        svg += `<line x1="${ox}" y1="${uy - 15}" x2="${ox + W*scale}" y2="${uy - 15}" stroke="#666" stroke-width="1"/>`;
        svg += `<line x1="${ox}" y1="${uy - 20}" x2="${ox}" y2="${uy - 10}" stroke="#666"/>`;
        svg += `<line x1="${ox + W*scale}" y1="${uy - 20}" x2="${ox + W*scale}" y2="${uy - 10}" stroke="#666"/>`;
        svg += `<text x="${ox + W*scale/2}" y="${uy - 22}" text-anchor="middle" font-size="11" fill="#333" font-weight="bold">${W}mm</text>`;

        // 상부장 치수선 — 하단 모듈별
        if (upperModules.length > 0) {
          let ux = ox + finishL * scale;
          const dimY = uy + upperDrawD + 12;
          for (const mod of upperModules) {
            const mw = (parseFloat(mod.w) || 600) * scale;
            svg += `<line x1="${ux}" y1="${dimY}" x2="${ux + mw}" y2="${dimY}" stroke="#666" stroke-width="0.8"/>`;
            svg += `<line x1="${ux}" y1="${dimY - 4}" x2="${ux}" y2="${dimY + 4}" stroke="#666"/>`;
            svg += `<line x1="${ux + mw}" y1="${dimY - 4}" x2="${ux + mw}" y2="${dimY + 4}" stroke="#666"/>`;
            svg += `<text x="${ux + mw/2}" y="${dimY + 14}" text-anchor="middle" font-size="9" fill="#666">${mod.w||''}</text>`;
            ux += mw;
          }
        }

        // ═══ 구분선 (벽면) ═══
        const sepY = uy + upperDrawD + dimOff + 20 + sectionGap / 2;
        svg += `<line x1="${ox}" y1="${sepY}" x2="${ox + W*scale}" y2="${sepY}" stroke="#ccc" stroke-width="1" stroke-dasharray="6,3"/>`;

        // ═══ 하부장 라벨 ═══
        let ly = sepY + sectionGap / 2;
        svg += `<text x="${ox - 5}" y="${ly - 8}" font-size="11" fill="#333" font-weight="bold">하부장</text>`;
        svg += `<text x="${ox + 42}" y="${ly - 8}" font-size="9" fill="#999">(깊이 ${D}mm)</text>`;

        // 상판 윤곽
        svg += `<rect x="${ox - topDrawT}" y="${ly - topDrawT}" width="${W*scale + topDrawT*2}" height="${lowerDrawD + topDrawT*2}" fill="none" stroke="#aaa" stroke-width="1" stroke-dasharray="4,2" rx="1"/>`;

        // 하부장 외곽
        svg += `<rect x="${ox}" y="${ly}" width="${W*scale}" height="${lowerDrawD}" fill="#f8f9fa" stroke="#999" stroke-width="1.5"/>`;

        // 하부장 모듈
        if (lowerModules.length > 0) {
          let lx = ox + finishL * scale;
          for (const mod of lowerModules) {
            const mw = (parseFloat(mod.w) || 600) * scale;
            const isSink = mod.type === 'sink';
            const isCook = mod.type === 'cook';
            const isDrawer = mod.isDrawer;
            // Front View 통일 색상
            let fill = '#f3f4f6', stroke = '#6b7280';
            if (isSink) { fill = '#dbeafe'; stroke = '#3b82f6'; }
            else if (isCook) { fill = '#fee2e2'; stroke = '#ef4444'; }
            else if (isDrawer) { fill = '#fef3c7'; stroke = '#f59e0b'; }
            const tLModIdx = item.modules.indexOf(mod);
            svg += `<rect x="${lx}" y="${ly}" width="${mw}" height="${lowerDrawD}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" rx="2" data-mod-index="${tLModIdx}" data-drag-mod="${tLModIdx}" data-uid="${item.uniqueId}" data-mod-pos="lower" style="cursor:grab;"/>`;

            // 싱크볼
            if (isSink) {
              const bw = mw * 0.5, bd = lowerDrawD * 0.4;
              svg += `<ellipse cx="${lx+mw/2}" cy="${ly+lowerDrawD/2+4}" rx="${bw/2}" ry="${bd/2}" fill="#cfd8dc" stroke="#90a4ae" stroke-width="1.5"/>`;
              // 수전
              svg += `<circle cx="${lx+mw/2}" cy="${ly+10}" r="4" fill="#64b5f6" stroke="#1e88e5" stroke-width="1"/>`;
              svg += `<text x="${lx+mw/2}" y="${ly+lowerDrawD/2-10}" text-anchor="middle" font-size="9" fill="#333">싱크</text>`;
            }
            // 쿡탑 버너
            else if (isCook) {
              const cx = lx+mw/2, cy = ly+lowerDrawD/2, br = Math.min(mw,lowerDrawD)*0.12;
              svg += `<circle cx="${cx-br*1.5}" cy="${cy-br*1.2}" r="${br}" fill="none" stroke="#e65100" stroke-width="1.5"/>`;
              svg += `<circle cx="${cx+br*1.5}" cy="${cy-br*1.2}" r="${br}" fill="none" stroke="#e65100" stroke-width="1.5"/>`;
              svg += `<circle cx="${cx-br*1.5}" cy="${cy+br*1.2}" r="${br*0.8}" fill="none" stroke="#e65100" stroke-width="1.5"/>`;
              svg += `<circle cx="${cx+br*1.5}" cy="${cy+br*1.2}" r="${br*0.8}" fill="none" stroke="#e65100" stroke-width="1.5"/>`;
              svg += `<text x="${cx}" y="${cy-br*2-4}" text-anchor="middle" font-size="9" fill="#333">쿡탑</text>`;
            }
            else {
              svg += `<text x="${lx+mw/2}" y="${ly+lowerDrawD/2+3}" text-anchor="middle" font-size="10" fill="#333">${mod.w||''}</text>`;
            }
            lx += mw;
          }
          // 분배기 마커 (하부장 하단)
          const distStart = parseFloat(item.specs.distributorStart) || 0;
          const distEnd = parseFloat(item.specs.distributorEnd) || 0;
          if (distStart > 0 || distEnd > 0) {
            const dsx = ox + Math.min(W, distStart) * scale;
            const dex = ox + Math.min(W, distEnd) * scale;
            const pipeY = ly + lowerDrawD - 8;
            svg += `<line x1="${dsx}" y1="${pipeY}" x2="${dex}" y2="${pipeY}" stroke="#60a5fa" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`;
            svg += `<circle cx="${dsx}" cy="${pipeY}" r="4" fill="#2563eb" stroke="#fff" stroke-width="1"/>`;
            svg += `<circle cx="${dex}" cy="${pipeY}" r="4" fill="#2563eb" stroke="#fff" stroke-width="1"/>`;
            svg += `<text x="${dsx}" y="${pipeY-5}" text-anchor="middle" font-size="7" fill="#2563eb">${distStart}</text>`;
            svg += `<text x="${dex}" y="${pipeY-5}" text-anchor="middle" font-size="7" fill="#2563eb">${distEnd}</text>`;
          }
        }

        // 하부장 치수선 — 하단 모듈별
        if (lowerModules.length > 0) {
          let lx = ox + finishL * scale;
          const dimY = ly + lowerDrawD + 12;
          for (const mod of lowerModules) {
            const mw = (parseFloat(mod.w) || 600) * scale;
            svg += `<line x1="${lx}" y1="${dimY}" x2="${lx + mw}" y2="${dimY}" stroke="#666" stroke-width="0.8"/>`;
            svg += `<line x1="${lx}" y1="${dimY - 4}" x2="${lx}" y2="${dimY + 4}" stroke="#666"/>`;
            svg += `<line x1="${lx + mw}" y1="${dimY - 4}" x2="${lx + mw}" y2="${dimY + 4}" stroke="#666"/>`;
            svg += `<text x="${lx + mw/2}" y="${dimY + 14}" text-anchor="middle" font-size="9" fill="#666">${mod.w||''}</text>`;
            lx += mw;
          }
        }

        // 배관 마커 (Front View와 동일 스타일)
        const wX = ox + (W*(item.specs.waterPosition||30)/100)*scale;
        const gX = ox + (W*(item.specs.gasPosition||70)/100)*scale;
        const markerY = ly + lowerDrawD + 32;
        svg += `<line x1="${wX}" y1="${ly+lowerDrawD}" x2="${wX}" y2="${markerY - 6}" stroke="#2196f3" stroke-width="1" stroke-dasharray="3"/>`;
        svg += `<circle cx="${wX}" cy="${markerY}" r="4" fill="#2196f3"/>`;
        svg += `<text x="${wX}" y="${markerY + 14}" text-anchor="middle" font-size="8" fill="#1976d2">급수 ${item.specs.waterPosition||30}%</text>`;
        svg += `<line x1="${gX}" y1="${ly+lowerDrawD}" x2="${gX}" y2="${markerY - 6}" stroke="#ff9800" stroke-width="1" stroke-dasharray="3"/>`;
        svg += `<circle cx="${gX}" cy="${markerY}" r="4" fill="#ff9800"/>`;
        svg += `<text x="${gX}" y="${markerY + 14}" text-anchor="middle" font-size="8" fill="#e65100">가스 ${item.specs.gasPosition||70}%</text>`;

        // ═══ 세컨더리 라인 (ㄱ자/ㄷ자형) ═══
        if (lShape !== 'I' && secW > 0) {
          const secStartY = markerY + 30;
          const secDrawW = secW * scale;
          const secD = parseFloat(item.specs.lowerSecondaryD) || D;
          const secDrawD = secD * scale;
          const isRefLeft = item.specs.measurementBase === 'Left';

          // Secondary 라벨
          svg += `<text x="${ox - 5}" y="${secStartY}" font-size="11" fill="#b8956c" font-weight="bold">Secondary Line</text>`;
          svg += `<text x="${ox + 100}" y="${secStartY}" font-size="9" fill="#999">(${lShape === 'L' ? 'ㄱ자' : 'ㄷ자'} W${secW}mm)</text>`;

          const secY = secStartY + 10;

          // L자 연결선 (프라임↔세컨더리 연결)
          const connX = isRefLeft ? ox + W * scale : ox;
          svg += `<line x1="${connX}" y1="${ly}" x2="${connX}" y2="${secY + secDrawD}" stroke="#b8956c" stroke-width="2" stroke-dasharray="6,3"/>`;

          // 세컨더리 하부장 외곽 (90도 회전 — 수직 배치)
          const secOx = isRefLeft ? ox + W * scale - secDrawD : ox;
          svg += `<rect x="${secOx}" y="${secY}" width="${secDrawD}" height="${secDrawW}" fill="#faf8f5" stroke="#b8956c" stroke-width="1.5" rx="1"/>`;

          // 세컨더리 상판
          svg += `<rect x="${secOx - topDrawT}" y="${secY - topDrawT}" width="${secDrawD + topDrawT*2}" height="${secDrawW + topDrawT*2}" fill="none" stroke="#ccc" stroke-width="1" stroke-dasharray="4,2" rx="1"/>`;

          // 세컨더리 치수선 — 세로 (W)
          const secDimX = isRefLeft ? secOx + secDrawD + 10 : secOx - 10;
          svg += `<line x1="${secDimX}" y1="${secY}" x2="${secDimX}" y2="${secY + secDrawW}" stroke="#b8956c" stroke-width="0.8"/>`;
          svg += `<line x1="${secDimX - 4}" y1="${secY}" x2="${secDimX + 4}" y2="${secY}" stroke="#b8956c"/>`;
          svg += `<line x1="${secDimX - 4}" y1="${secY + secDrawW}" x2="${secDimX + 4}" y2="${secY + secDrawW}" stroke="#b8956c"/>`;
          svg += `<text x="${secDimX + (isRefLeft ? 8 : -8)}" y="${secY + secDrawW/2 + 3}" text-anchor="${isRefLeft ? 'start' : 'end'}" font-size="9" fill="#b8956c" font-weight="600">${secW}mm</text>`;

          // 세컨더리 치수선 — 가로 (D)
          svg += `<line x1="${secOx}" y1="${secY + secDrawW + 10}" x2="${secOx + secDrawD}" y2="${secY + secDrawW + 10}" stroke="#666" stroke-width="0.8"/>`;
          svg += `<text x="${secOx + secDrawD/2}" y="${secY + secDrawW + 22}" text-anchor="middle" font-size="9" fill="#666">${secD}mm</text>`;

          // L자형 코너 표시
          svg += `<rect x="${connX - 3}" y="${ly - 3}" width="6" height="6" fill="#b8956c" rx="1"/>`;
        }

        // ★ 워크 트라이앵글 (B4) — 싱크↔쿡탑 거리 표시
        if (item.categoryId === 'sink' && lowerModules.length > 0) {
          let sinkCx = null, cookCx = null;
          let lx2 = ox + finishL * scale;
          for (const mod of lowerModules) {
            const mw = (parseFloat(mod.w) || 600) * scale;
            if (mod.type === 'sink' || mod.hasSink || mod.has_sink) sinkCx = lx2 + mw / 2;
            if (mod.type === 'cook' || mod.hasCooktop || mod.has_cooktop) cookCx = lx2 + mw / 2;
            lx2 += mw;
          }
          if (sinkCx && cookCx) {
            const triY = ly + lowerDrawD / 2;
            const distMm = Math.round(Math.abs(cookCx - sinkCx) / scale);
            const color = distMm < 900 ? '#ef4444' : distMm > 2700 ? '#f59e0b' : '#22c55e';
            svg += `<line x1="${sinkCx}" y1="${triY}" x2="${cookCx}" y2="${triY}" stroke="${color}" stroke-width="2" stroke-dasharray="6,3" opacity="0.6"/>`;
            svg += `<text x="${(sinkCx + cookCx) / 2}" y="${triY - 6}" text-anchor="middle" font-size="9" fill="${color}" font-weight="600">${distMm}mm</text>`;
          }
        }

        return `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" style="background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;">${svg}</svg>`;
      }

