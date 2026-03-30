
      // ============================================================
      // 최적화: 공통 모듈 조작 함수들
      // ============================================================

      /**
       * 모듈 옵션 토글 (체크박스용 - 기존 toggleOption과 병행)
       */
      function toggleModuleOption(itemUniqueId, modId, field, checked) {
        const mod = getModule(itemUniqueId, modId);
        if (mod) {
          mod[field] = checked;
          renderWorkspaceContent(getItem(itemUniqueId));
        }
      }

      /**
       * 모듈 값 조절 (+/- 버튼용)
       */
      function adjustModuleValue(itemUniqueId, modId, field, delta, min = 0) {
        const mod = getModule(itemUniqueId, modId);
        if (mod) {
          mod[field] = Math.max(min, (mod[field] || 0) + delta);
          renderWorkspaceContent(getItem(itemUniqueId));
        }
      }

      /**
       * 모듈 타입 설정
       */
      function setModuleType(itemUniqueId, modId, typeField, value) {
        const mod = getModule(itemUniqueId, modId);
        if (mod) {
          mod[typeField] = value;
          renderWorkspaceContent(getItem(itemUniqueId));
        }
      }

      /**
       * 아이템 스펙 토글
       */
      function toggleItemSpec(itemUniqueId, field) {
        const item = getItem(itemUniqueId);
        if (item && item.specs) {
          item.specs[field] = !item.specs[field];
          renderWorkspaceContent(item);
        }
      }

      // ============================================================
      // 최적화: 렌더링 헬퍼 함수들
      // ============================================================

      /**
       * 토글 버튼 그룹 렌더링
       * @param {number} itemId - 아이템 ID
       * @param {number} modId - 모듈 ID
       * @param {Array} options - [{value, label}] 배열
       * @param {string} currentValue - 현재 선택된 값
       * @param {string} colorClass - 색상 클래스 (green, blue, orange, purple)
       * @param {string} typeField - 타입 필드명
       */
      function renderToggleButtons(itemId, modId, options, currentValue, colorClass, typeField = 'type') {
        return `<div class="toggle-group">${options
          .map(
            (opt) =>
              `<button class="btn-toggle ${colorClass} ${currentValue === opt.value ? 'active' : ''}"
       data-action="setType" data-item="${itemId}" data-mod="${modId}"
       data-field="${typeField}" data-value="${opt.value}">${opt.label}</button>`
          )
          .join('')}</div>`;
      }

      /**
       * 조절 컨트롤 렌더링 (+/- 버튼)
       * @param {number} itemId - 아이템 ID
       * @param {number} modId - 모듈 ID
       * @param {string} field - 필드명
       * @param {number} value - 현재 값
       * @param {string} label - 라벨 (선택)
       */
      function renderAdjustControl(itemId, modId, field, value, label = '') {
        return `<div class="adjust-control">
    ${label ? `<span>${label}</span>` : ''}
    <button class="btn-adjust" data-action="adjust" data-item="${itemId}"
      data-mod="${modId}" data-field="${field}" data-delta="-1">−</button>
    <span class="value">${value}</span>
    <button class="btn-adjust" data-action="adjust" data-item="${itemId}"
      data-mod="${modId}" data-field="${field}" data-delta="1">+</button>
  </div>`;
      }

      /**
       * 체크박스 렌더링
       */
      function renderCheckbox(itemId, modId, field, checked, label) {
        return `<label class="checkbox-label">
    <input type="checkbox" ${checked ? 'checked' : ''}
      data-action="toggle" data-item="${itemId}" data-mod="${modId}" data-field="${field}">
    ${label}
  </label>`;
      }

      /**
       * 숫자 입력 필드 렌더링
       */
      function renderNumberInput(itemId, modId, field, value, width = '50px') {
        return `<input type="number" class="spec-input-sm" value="${value}"
    data-item="${itemId}" data-mod="${modId}" data-field="${field}"
    style="width:${width}">`;
      }

      // ============================================================
      // 핵심 계산 함수들
      // ============================================================

      /**
       * 도어 너비 최적화 (v28 업데이트)
       * 최우선: 4mm ≤ 잔여공간 ≤ 10mm
       * 차선: 0mm ≤ 잔여공간 < 4mm (정확히 나누어 떨어지는 경우)
       * 그 다음: 10의 단위 > 짝수
       * 제약: 350mm ≤ 도어 너비 ≤ 600mm
       */
      function findBestDoorWidth(totalSpace, doorCount, preferExact) {
        const rawWidth = totalSpace / doorCount;

        // ★ 도어 최소/최대 너비 제약 확인
        if (rawWidth > DOOR_MAX_WIDTH) return null;
        if (rawWidth < DOOR_MIN_WIDTH) return null;

        // ★ ACTIVE_RULES: 몰딩/비몰딩 구분 없이 잔여 ≤10mm 모두 허용
        const validCandidates = [];

        // 10의 단위 후보 (내림, 올림)
        const tenFloor = Math.floor(rawWidth / 10) * 10;
        const tenCeil = Math.ceil(rawWidth / 10) * 10;

        // 짝수 후보 (내림, 올림)
        const evenFloor = Math.floor(rawWidth / 2) * 2;
        const evenCeil = Math.ceil(rawWidth / 2) * 2;

        // 균등 분배 후보
        const evenDiv = Math.floor(rawWidth);

        const allCandidates = [
          { width: tenFloor, priority: 1 },
          { width: tenCeil, priority: 1 },
          { width: evenFloor, priority: 2 },
          { width: evenCeil, priority: 2 },
          { width: evenDiv, priority: 3 },
        ];

        for (const cand of allCandidates) {
          if (cand.width < DOOR_MIN_WIDTH || cand.width > DOOR_MAX_WIDTH) continue;
          const used = cand.width * doorCount;
          const gap = totalSpace - used;
          if (gap < 0 || gap > MAX_REMAINDER) continue;
          validCandidates.push({ ...cand, gap });
        }

        // 정렬: priority → gap 작은 순
        validCandidates.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.gap - b.gap;
        });

        if (validCandidates.length > 0) {
          return validCandidates[0].width;
        }

        return null;
      }

      /**
       * 모듈 균등 분배 함수 (v28 업데이트)
       * - 최우선: 4mm ≤ 잔여공간 ≤ 10mm
       * - 차선: 0mm ≤ 잔여공간 < 4mm
       * - 제약: 350mm ≤ 도어 너비 ≤ 600mm, 목표 ≈ 450mm
       * - 도어개수/2 → 몫*2D, 나머지*1D
       */
      function distributeModules(totalSpace, preferExact) {
        if (totalSpace < 100) return { modules: [], doorWidth: 0, doorCount: 0 };

        // ★ 도어 개수 범위 설정 (최소/최대 도어 너비 반영)
        const minCount = Math.max(1, Math.ceil(totalSpace / DOOR_MAX_WIDTH));
        const maxDoorCount = Math.floor(totalSpace / DOOR_MIN_WIDTH);
        const baseCount = Math.round(totalSpace / DOOR_TARGET_WIDTH);
        const maxCount = Math.min(maxDoorCount, Math.max(baseCount + 3, minCount + 5));

        // ★ 도어 균등 분배 최우선: 모든 도어가 동일 너비, 잔여 ≤10mm
        let allResults = [];

        for (let count = minCount; count <= maxCount; count++) {
          // 균등 분배: totalSpace를 count로 나눈 도어 너비
          const evenWidth = Math.floor(totalSpace / count);
          const evenGap = totalSpace - evenWidth * count;

          // 도어 너비 범위 체크
          if (evenWidth >= DOOR_MIN_WIDTH && evenWidth <= DOOR_MAX_WIDTH && evenGap >= 0 && evenGap <= MAX_REMAINDER) {
            allResults.push({
              doorCount: count,
              doorWidth: evenWidth,
              gap: evenGap,
              targetDiff: Math.abs(evenWidth - DOOR_TARGET_WIDTH),
            });
          }

          // 10단위 내림 후보
          const floorWidth = Math.floor(totalSpace / count / 10) * 10;
          if (floorWidth >= DOOR_MIN_WIDTH && floorWidth <= DOOR_MAX_WIDTH) {
            const floorGap = totalSpace - floorWidth * count;
            if (floorGap >= 0 && floorGap <= MAX_REMAINDER) {
              allResults.push({
                doorCount: count,
                doorWidth: floorWidth,
                gap: floorGap,
                targetDiff: Math.abs(floorWidth - DOOR_TARGET_WIDTH),
              });
            }
          }

          // 짝수 내림 후보
          const evenFloor = Math.floor(totalSpace / count / 2) * 2;
          if (evenFloor >= DOOR_MIN_WIDTH && evenFloor <= DOOR_MAX_WIDTH && evenFloor !== floorWidth) {
            const eg = totalSpace - evenFloor * count;
            if (eg >= 0 && eg <= MAX_REMAINDER) {
              allResults.push({
                doorCount: count,
                doorWidth: evenFloor,
                gap: eg,
                targetDiff: Math.abs(evenFloor - DOOR_TARGET_WIDTH),
              });
            }
          }
        }

        // ★ 정렬: 목표 450mm 근접 최우선 → 잔여 작은 순 → 도어 수 적은 순
        allResults.sort((a, b) => {
          // 1. 목표 도어 너비(450mm)에 가장 가까운 것 최우선
          if (a.targetDiff !== b.targetDiff) return a.targetDiff - b.targetDiff;
          // 2. 잔여 작은 것
          if (a.gap !== b.gap) return a.gap - b.gap;
          // 3. 도어 수 적은 것 (동점일 때만)
          return a.doorCount - b.doorCount;
        });

        let bestResult = allResults.length > 0 ? allResults[0] : null;

        // 폴백: 결과 없으면 모듈 생성 불가 (갭 흡수 대상)
        if (!bestResult) {
          return { modules: [], doorWidth: 0, doorCount: 0 };
        }

        const { doorCount, doorWidth } = bestResult;
        const quotient = Math.floor(doorCount / 2);
        const remainder = doorCount % 2;

        const modules = [];
        // 2D 모듈 (몫 개)
        for (let i = 0; i < quotient; i++) {
          modules.push({ w: doorWidth * 2, is2D: true });
        }
        // 1D 모듈 (나머지 개)
        if (remainder > 0) {
          modules.push({ w: doorWidth, is2D: false });
        }

        return { modules, doorWidth, doorCount };
      }

      /**
       * 유효 공간 계산
       */
      function calcEffectiveSpace(item) {
        const W = parseFloat(item.w) || 0;
        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const fR = item.specs.finishRightType !== 'None' ? parseFloat(item.specs.finishRightWidth) || 0 : 0;
        const fC1 =
          item.specs.layoutShape !== 'I' && item.specs.finishCorner1Type !== 'None'
            ? parseFloat(item.specs.finishCorner1Width) || 0
            : 0;
        const fC2 =
          item.specs.layoutShape === 'U' && item.specs.finishCorner2Type !== 'None'
            ? parseFloat(item.specs.finishCorner2Width) || 0
            : 0;
        return W - fL - fR - fC1 - fC2;
      }

      function getEffectiveSpace(item, section) {
        const manualValue = section === 'upper' ? item.specs.effectiveUpperW : item.specs.effectiveLowerW;
        if (manualValue !== null && manualValue !== '') return parseFloat(manualValue) || 0;
        return calcEffectiveSpace(item);
      }

      /**
       * 고정 모듈 위치 조정 (경계 내로)
       */
      function adjustFixedPositions(fixedList, startBound, endBound) {
        fixedList.sort((a, b) => a.x - b.x);

        // 고정 모듈별 최소 너비 결정
        function getMinW(mod) {
          if (mod.type === 'sink') return SINK_DEFAULT_W_SMALL;
          if (mod.type === 'cook') return COOK_FIXED_W;
          if (mod.name === 'LT망장') return LT_FIXED_W;
          return DOOR_MIN_WIDTH;
        }

        // 왼쪽에서 오른쪽으로 겹침 방지
        let cursor = startBound;
        fixedList.forEach((mod) => {
          if (mod.x < cursor) {
            mod.x = cursor;
          }
          // ★ endBound 초과 방지
          if (mod.x + parseFloat(mod.w) > endBound) {
            const minW = getMinW(mod);
            mod.w = Math.max(minW, endBound - mod.x);
            if (mod.x + mod.w > endBound) mod.x = endBound - mod.w;
            if (mod.x < startBound) mod.x = startBound;
          }
          mod.endX = mod.x + parseFloat(mod.w);
          cursor = mod.endX;
        });

        // 오른쪽에서 왼쪽으로 경계 조정
        let rightCursor = endBound;
        for (let i = fixedList.length - 1; i >= 0; i--) {
          const mod = fixedList[i];
          if (mod.endX > rightCursor) {
            mod.endX = rightCursor;
            const minW = getMinW(mod);
            mod.x = Math.max(startBound, mod.endX - Math.max(minW, parseFloat(mod.w)));
            mod.w = mod.endX - mod.x;
          }
          rightCursor = mod.x;
        }

        return fixedList;
      }

      /**
       * 빈 공간(Gap) 계산
       */
      function calculateGaps(fixedList, startBound, endBound) {
        const gaps = [];
        let cursor = startBound;

        for (const fixed of fixedList) {
          if (fixed.x > cursor + 1) {
            gaps.push({ start: cursor, end: fixed.x, width: fixed.x - cursor });
          }
          cursor = fixed.endX;
        }
        if (cursor < endBound - 1) {
          gaps.push({ start: cursor, end: endBound, width: endBound - cursor });
        }

        return gaps;
      }

      /**
       * Gap을 모듈로 채우기 (v28 업데이트: 후드 제외 모든 도어 동일 크기)
       * @param {Object} gap - { start, end, width }
       * @param {string} section - 'upper' | 'lower'
       * @param {number} defaultH - 기본 높이
       * @param {number} defaultD - 기본 깊이
       * @param {string} edgeMode - 'none' | 'left' | 'right' | 'both' (대칭 배치 모드)
       * @param {boolean} preferExact - true이면 잔여 0mm 우선 (몰딩 마감)
       */
      function fillSpaceWithModules(space, section, defaultH, defaultD, preferExact = false) {
        const newModules = [];
        const namePrefix = section === 'upper' ? '상부장' : '하부장';

        const result = distributeModules(space.width, preferExact);
        if (!result.doorWidth || result.doorCount < 1) return newModules;

        const { doorWidth, doorCount } = result;
        let dx = space.start;

        // 2D 먼저 + 1D 나중
        const quotient = Math.floor(doorCount / 2);
        const mod1D = doorCount % 2;
        for (let i = 0; i < quotient; i++) {
          newModules.push(createModule(section, namePrefix, doorWidth * 2, defaultH, defaultD, true, dx));
          dx += doorWidth * 2;
        }
        if (mod1D > 0) {
          newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
          dx += doorWidth;
        }

        return newModules;
      }


      /**
       * 모듈 객체 생성 헬퍼
       */
      function createModule(pos, namePrefix, w, h, d, is2D, x) {
        return {
          id: Date.now() + Math.random(),
          type: 'storage',
          name: `${namePrefix}(${is2D ? '2D' : '1D'})`,
          pos,
          w,
          h,
          d,
          doorCount: is2D ? 2 : 1,
          isDrawer: false,
          isEL: false,
          isFixed: false,
          _x: x,
        };
      }

      /**
       * 잔여 공간 색상 (v28: 0~10mm가 녹색)
       */
      function getRemainColor(remaining) {
        if (remaining < 0 || remaining > MAX_REMAINDER + 5) return '#ff4d4f'; // 음수 또는 15mm 초과
        if (remaining >= 0 && remaining <= MAX_REMAINDER) return '#00c853'; // 0~10mm 녹색
        return '#4a7dff'; // 11~15mm 파란색
      }

      // ============================================================
      // 섹션 자동 계산 함수
      // ============================================================

      /**
       * 자동계산 로직 요약 (v28 업데이트):
       *
       * 1. 유효공간 = 전체너비 - 마감들
       * 2. 고정 모듈 수집 및 위치 결정
       *    - 하부: 개수대(분배기시작-100), 가스대(환풍구중앙), LT망장(가스대옆+먼쪽)
       *    - 상부: 후드(환풍구중앙), 기준상부장(개수대 중앙 정렬, 2D)
       * 3. 개수대 논리조건 검증: 시작<분배기시작 AND 끝>분배기끝
       * 4. Gap 계산 및 균등분배
       *    - 최우선: 4mm ≤ 잔여 ≤ 10mm
       *    - 차선: 0mm ≤ 잔여 < 4mm
       *    - 도어: 350~600mm, 목표 ≈ 450mm
       *    - 도어개수/2 → 몫*2D + 나머지*1D
       */

      // ★ 필수장 토글 버튼
      function toggleEssentialBtn(el, itemUniqueId, section, type) {
        const isActive = el.classList.toggle('active');
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        const key = section === 'upper' ? 'essentialUpper' : 'essentialLower';
        if (!item.specs[key]) item.specs[key] = {};
        item.specs[key][type] = isActive;
      }
      // ★ 레거시 호환
      function toggleEssential(itemUniqueId, section, type, checked) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        const key = section === 'upper' ? 'essentialUpper' : 'essentialLower';
        if (!item.specs[key]) item.specs[key] = {};
        item.specs[key][type] = checked;
      }

      // ★ 자동계산 전 필수장 주입
      function injectEssentialModules(item, section) {
        const specLowerH = parseFloat(item.specs.lowerH) || 870;
        const specLegH = parseFloat(item.specs.sinkLegHeight) || 150;
        const specTopT = parseFloat(item.specs.topThickness) || 12;
        const lowerBodyH = specLowerH - specTopT - specLegH; // 상판 + 다리발 제외
        const specUpperH = parseFloat(item.specs.upperH) || 720;
        const specOverlap = parseFloat(item.specs.upperDoorOverlap) || 15;
        const upperBodyH = specUpperH - specOverlap; // 오버랩 제외

        const ESSENTIAL_DEFS = {
          sink:  { type: 'sink',    name: '개수대',  pos: 'lower', w: 1000, d: 600, isDrawer: false, matchFn: m => m.type === 'sink' },
          cook:  { type: 'cook',    name: '가스대',  pos: 'lower', w: 600,  d: 550, isDrawer: false, matchFn: m => m.type === 'cook' },
          lt:    { type: 'storage', name: 'LT망장',  pos: 'lower', w: 200,  d: 550, isDrawer: true,  matchFn: m => m.type === 'storage' && m.name === 'LT망장' },
          hood:  { type: 'hood',    name: '후드장',  pos: 'upper', w: 800,  d: 295, isDrawer: false, matchFn: m => m.type === 'hood' },
        };

        const essentialMap = section === 'upper' ? item.specs.essentialUpper : item.specs.essentialLower;
        if (!essentialMap) return;

        const sectionModules = item.modules.filter(m => m.pos === section);

        Object.entries(essentialMap).forEach(([key, checked]) => {
          if (!checked) return;
          const def = ESSENTIAL_DEFS[key];
          if (!def || def.pos !== section) return;
          // 이미 존재하면 건너뜀
          if (sectionModules.some(def.matchFn)) return;
          const h = section === 'upper' ? upperBodyH : lowerBodyH;
          item.modules.push({
            id: Date.now() + Math.random(),
            type: def.type,
            name: def.name,
            pos: def.pos,
            w: def.w,
            h: h,
            d: def.d,
            isDrawer: def.isDrawer,
            isEL: false,
            isFixed: true,
          });
        });
      }

      function runAutoCalcSection(itemUniqueId, section) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (typeof pushUndo === 'function') pushUndo(item); // ★ Undo

        // ★ 싱크대: 자동계산 전 필수장 주입
        if (item.categoryId === 'sink') {
          injectEssentialModules(item, section);
        }

        if (section === 'upper') {
          item.prevUpperModules = JSON.parse(JSON.stringify(item.modules.filter((m) => m.pos === 'upper')));
          runAutoCalcUpper(item);
        } else {
          item.prevLowerModules = JSON.parse(JSON.stringify(item.modules.filter((m) => m.pos === 'lower')));
          runAutoCalcLower(item);
        }

        renderWorkspaceContent(item);
      }

      function runAutoCalcUpper(item) {
        const W = parseFloat(item.w) || 0;
        const effectiveW = getEffectiveSpace(item, 'upper');

        if (effectiveW <= 0) {
          alert('상부장 유효 공간이 부족합니다.');
          return;
        }

        const specUpperH = parseFloat(item.specs.upperH) || 720;
        const specOverlap = parseFloat(item.specs.upperDoorOverlap) || 15;
        const upperBodyH = specUpperH - specOverlap;
        const isRefLeft = item.specs.measurementBase === 'Left';
        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const startBound = fL;
        const endBound = startBound + effectiveW;

        // ★ Step 1: 하부장 위치 맵 생성 (후드 위치 결정용)
        const lowerModules = item.modules.filter((m) => m.pos === 'lower');
        const lowerPosMap = {};
        let lowerCursor = startBound;
        lowerModules.forEach((m) => {
          const mw = parseFloat(m.w) || 0;
          if (!lowerPosMap[m.type]) {
            lowerPosMap[m.type] = { x: lowerCursor, w: mw, centerX: lowerCursor + mw / 2 };
          }
          lowerCursor += mw;
        });

        // ★ Step 2: 후드장 배치 (환풍구 위치 우선 → 가스대 위 폴백)
        let fixedOccupied = [];
        const existingHood = item.modules.find((m) => m.pos === 'upper' && m.type === 'hood' && m.isFixed);
        if (existingHood) {
          const hoodW = parseFloat(existingHood.w) || 800;
          let hoodX = startBound;
          // ventStart null → 기본값 초기화
          if (item.specs.ventStart == null) {
            item.specs.ventStart = Math.round((W <= 2500 ? SINK_DEFAULT_W_SMALL : SINK_DEFAULT_W_LARGE) * 0.7);
          }
          const ventPos = parseFloat(item.specs.ventStart) || 0;
          if (ventPos > 0) {
            // 환풍구 위치 중심에 후드장 배치
            const ventAbs = isRefLeft ? startBound + ventPos : endBound - ventPos;
            hoodX = ventAbs - hoodW / 2;
          } else if (lowerPosMap.cook) {
            // 환풍구 미입력 → 가스대 위 중앙
            hoodX = lowerPosMap.cook.centerX - hoodW / 2;
          }
          hoodX = Math.max(startBound, Math.min(endBound - hoodW, hoodX));
          fixedOccupied.push({ ...existingHood, x: hoodX, endX: hoodX + hoodW, pos: 'upper' });
          console.log(`[AutoCalc] 후드장: 환풍구=${ventPos}mm, 후드X=${hoodX}`);
        }

        // ★ 기준상부장 (개수대 중앙 정렬, 2D) — 개수대 위에 2도어 상부장 고정 배치
        // 기존 기준상부장이 있으면 제거 (중복 방지)
        item.modules = item.modules.filter(m => !(m.pos === 'upper' && m.name === '기준상부장(2D)'));
        if (lowerPosMap.sink) {
          const sinkCenter = lowerPosMap.sink.centerX;
          const sinkW = lowerPosMap.sink.w;
          // 기준상부장 너비 = 개수대 너비 (최대 SINK_MAX_W)
          const refUpperW = Math.min(SINK_MAX_W, sinkW);
          let refUpperX = sinkCenter - refUpperW / 2;
          refUpperX = Math.max(startBound, Math.min(endBound - refUpperW, refUpperX));

          // 후드장과 겹치지 않는지 확인
          const hoodEntry = fixedOccupied.find(f => f.type === 'hood');
          const overlapsHood = hoodEntry && refUpperX < hoodEntry.endX && (refUpperX + refUpperW) > hoodEntry.x;

          if (!overlapsHood) {
            fixedOccupied.push({
              id: Date.now() + Math.random(),
              type: 'storage',
              name: '기준상부장(2D)',
              pos: 'upper',
              w: refUpperW,
              h: upperBodyH,
              d: 295,
              isFixed: true,
              is2door: true,
              x: refUpperX,
              endX: refUpperX + refUpperW,
            });
            console.log(`[AutoCalc] 기준상부장(2D): 개수대중앙=${sinkCenter}, X=${refUpperX}, W=${refUpperW}`);
          } else {
            console.log(`[AutoCalc] 기준상부장(2D): 후드장과 겹침 → 생략`);
          }
        }

        // 기타 고정 모듈 (후드, 기준상부장 제외)
        const upperModules = item.modules.filter((m) => m.pos === 'upper');
        let otherCursor = startBound;
        upperModules.forEach((m) => {
          const mw = parseFloat(m.w) || 0;
          if (m.isFixed && m.type !== 'hood' && m.name !== '기준상부장(2D)') {
            fixedOccupied.push({ ...m, x: otherCursor, endX: otherCursor + mw, pos: 'upper' });
          }
          otherCursor += mw;
        });

        // ★ Step 3: 비고정 모듈 제거 → 고정 모듈 기준으로 재계산
        item.modules = item.modules.filter((m) => m.pos !== 'upper');

        const fixedTotalW = fixedOccupied.reduce((sum, f) => sum + (parseFloat(f.w) || 0), 0);
        fixedOccupied = adjustFixedPositions(fixedOccupied, startBound, endBound);

        let newModules = [];

        if (fixedTotalW >= effectiveW) {
          // ★ 고정 모듈이 유효공간을 초과/가득 참 → 고정 모듈만 배치
          console.warn(`[AutoCalc] 상부장: 고정 모듈(${fixedTotalW}mm) >= 유효공간(${effectiveW}mm) — 고정 모듈만 배치`);
        } else {
          const spaces = calculateGaps(fixedOccupied, startBound, endBound);
          const hasMoldingUpper = item.specs.finishLeftType === 'Molding' || item.specs.finishRightType === 'Molding';
          const preferExactUpper = hasMoldingUpper;

          // ★ 빈 공간 분류: 모듈 생성 가능(≥350) vs 갭(<350)
          const fillable = [];
          const smallGaps = [];
          spaces.forEach((s) => {
            if (s.width >= DOOR_MIN_WIDTH) fillable.push(s);
            else if (s.width > 0) smallGaps.push(s);
          });

          fillable.forEach((space) => {
            newModules = newModules.concat(fillSpaceWithModules(space, 'upper', upperBodyH, 295, preferExactUpper));
          });

          // ★ 갭 흡수: 도어 너비가 450에서 가장 먼 모듈부터 흡수
          if (smallGaps.length > 0) {
            const totalGap = smallGaps.reduce((s, g) => s + g.width, 0);
            const absorbable = [...newModules, ...fixedOccupied.filter(f => f.name === '기준상부장(2D)')];
            absorbable.sort((a, b) => {
              const aw = parseFloat(a.w) || 0;
              const bw = parseFloat(b.w) || 0;
              const aDoorW = a.is2door || a.is2D ? aw / 2 : aw;
              const bDoorW = b.is2door || b.is2D ? bw / 2 : bw;
              return Math.abs(bDoorW - DOOR_TARGET_WIDTH) - Math.abs(aDoorW - DOOR_TARGET_WIDTH);
            });
            if (absorbable.length > 0) {
              absorbable[0].w = (parseFloat(absorbable[0].w) || 0) + totalGap;
              if (absorbable[0].endX !== undefined) absorbable[0].endX = absorbable[0].x + parseFloat(absorbable[0].w);
              console.log(`[AutoCalc] 상부장 갭 흡수: ${totalGap}mm → ${absorbable[0].name || absorbable[0].type}`);
            }
          }

          console.log(`상부장: 고정모듈=${fixedOccupied.length}개, 가용공간=${effectiveW - fixedTotalW}mm`);
        }

        // 고정 모듈 추가 (후드 등)
        fixedOccupied.forEach((fixed) => {
          newModules.push({
            id: fixed.id || Date.now() + Math.random(),
            type: fixed.type,
            name: fixed.name,
            pos: 'upper',
            w: fixed.w,
            h: fixed.h || upperBodyH,
            d: fixed.d || 295,
            doorCount: fixed.doorCount,
            isDrawer: fixed.isDrawer || false,
            isEL: fixed.isEL || false,
            isFixed: true,
            isBase: fixed.isBase || false,
            _x: fixed.x,
          });
        });

        // 정렬 및 저장
        newModules.sort((a, b) => a._x - b._x);
        newModules.forEach((m) => delete m._x);
        if (!isRefLeft) newModules.reverse();

        // ★ 안전장치: 비정상 모듈 수 방지 (최대 30개)
        if (newModules.length > 30) {
          console.error(`[AutoCalc] 상부장: 비정상 모듈 수 ${newModules.length}개 → 고정 모듈만 유지`);
          newModules = newModules.filter(m => m.isFixed);
        }

        item.modules = item.modules.concat(newModules);
      }

      function runAutoCalcLower(item) {
        const W = parseFloat(item.w) || 0;
        const effectiveW = getEffectiveSpace(item, 'lower');

        if (effectiveW <= 0) { alert('하부장 유효 공간이 부족합니다.'); return; }

        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const startBound = fL;
        const endBound = startBound + effectiveW;
        const isRefLeft = item.specs.measurementBase === 'Left';

        const specLowerH = parseFloat(item.specs.lowerH) || 870;
        const specLegH = parseFloat(item.specs.sinkLegHeight) || 150;
        const specTopT = parseFloat(item.specs.topThickness) || 12;
        const defaultLowerH = specLowerH - specTopT - specLegH;

        // ── 개수대 상수 (W 기준) ──
        const SINK_MIN_W = 950;
        const SINK_DEF_W = W <= 2500 ? 950 : 1000;
        const SINK_MAX  = 1100;
        const LT_DEF_W  = 200;
        const LT_MAX_W  = 300;
        const SIDE_PANEL = 15;

        // ★ 고정 모듈 수집
        const currentModules = item.modules.filter(m => m.pos === 'lower');
        let fixedOccupied = [];
        let cursor = startBound;
        currentModules.forEach(m => {
          const mw = parseFloat(m.w) || 0;
          if (m.isFixed) fixedOccupied.push({ ...m, x: cursor, endX: cursor + mw, pos: 'lower' });
          cursor += mw;
        });

        // ═══════════════════════════════════════════════════════════
        // ★ 환풍구/분배기 기준 고정모듈 배치 규칙
        // ═══════════════════════════════════════════════════════════
        //  ① 가스대: 환풍구 포함 (환풍구 중심 배치)
        //  ② 개수대: 분배기 포함
        //  ③ LT망장: 가스대와 가까운 벽 사이
        //  좌/우 기준 = 실측 기준과 동일

        // ── null 초기화 ──
        if (item.specs.distributorStart == null) {
          item.specs.distributorStart = Math.round(SINK_DEF_W * 0.15);
          item.specs.distributorEnd = Math.round(SINK_DEF_W * 0.15 + 700);
        }
        if (item.specs.ventStart == null) {
          item.specs.ventStart = Math.round(SINK_DEF_W * 0.7);
        }

        const distStart = parseFloat(item.specs.distributorStart) || 0;
        const distEnd   = parseFloat(item.specs.distributorEnd) || 0;
        const ventPos   = parseFloat(item.specs.ventStart) || 0;

        // ── 분배기 절대좌표 ──
        let dStartAbs = 0, dEndAbs = 0;
        if (distStart > 0 && distEnd > distStart) {
          if (isRefLeft) { dStartAbs = startBound + distStart; dEndAbs = startBound + distEnd; }
          else           { dStartAbs = endBound - distEnd;     dEndAbs = endBound - distStart; }
          dStartAbs = Math.max(startBound, Math.min(endBound, dStartAbs));
          dEndAbs   = Math.max(startBound, Math.min(endBound, dEndAbs));
        }

        // ── 환풍구 절대좌표 ──
        const ventAbs = ventPos > 0
          ? Math.max(startBound, Math.min(endBound, isRefLeft ? startBound + ventPos : endBound - ventPos))
          : 0;

        const sinkMod = fixedOccupied.find(m => m.type === 'sink');
        const cookMod = fixedOccupied.find(m => m.type === 'cook');

        // ════════════════════════════════════════
        // ① 가스대: 환풍구 포함 (중심 배치)
        // ════════════════════════════════════════
        if (cookMod) {
          const cookW = parseFloat(cookMod.w) || COOK_FIXED_W;
          let cookX;
          if (ventAbs > 0) {
            cookX = ventAbs - cookW / 2;
          } else {
            // 환풍구 없음 → 기준 반대쪽 끝
            cookX = isRefLeft ? endBound - cookW : startBound;
          }
          cookX = Math.max(startBound, Math.min(endBound - cookW, cookX));
          cookMod.x = cookX;
          cookMod.endX = cookX + cookW;
        }

        // ════════════════════════════════════════
        // ③ LT망장: 가스대와 가까운 벽 사이
        // ════════════════════════════════════════
        //  좌측기준: 가스대=우측 → LT는 가스대 우측~endBound 사이
        //  우측기준: 가스대=좌측 → LT는 startBound~가스대 좌측 사이
        let ltMod = fixedOccupied.find(m => m.name === 'LT망장' || (m.type === 'storage' && m.isDrawer && parseFloat(m.w) <= 250));
        if (!ltMod && sinkMod) {
          ltMod = { id: Date.now() + Math.random(), type: 'storage', name: 'LT망장', pos: 'lower', w: LT_DEF_W, d: 550, isDrawer: true, isFixed: true, x: 0, endX: 0 };
          fixedOccupied.push(ltMod);
        }
        if (ltMod && cookMod) {
          ltMod.w = LT_DEF_W;
          if (isRefLeft) {
            // 좌측기준: LT = 가스대 우측 (cook.endX ~ endBound)
            ltMod.x = cookMod.endX;
          } else {
            // 우측기준: LT = 가스대 좌측 (startBound ~ cook.x)
            ltMod.x = cookMod.x - LT_DEF_W;
          }
          ltMod.x = Math.max(startBound, Math.min(endBound - LT_DEF_W, ltMod.x));
          ltMod.endX = ltMod.x + LT_DEF_W;
        }

        // ════════════════════════════════════════
        // ② 개수대: 분배기 포함
        // ════════════════════════════════════════
        //  개수대 영역: 가스대+LT를 제외한 나머지 공간
        if (sinkMod) {
          let sinkZoneStart, sinkZoneEnd;
          if (isRefLeft) {
            // 좌측기준: 개수대 = startBound ~ cook.x (가스대 좌측)
            sinkZoneStart = startBound;
            sinkZoneEnd = cookMod ? cookMod.x : endBound;
          } else {
            // 우측기준: 개수대 = (ltMod ? ltMod.endX : cook.endX) ~ endBound
            sinkZoneStart = ltMod ? ltMod.endX : (cookMod ? cookMod.endX : startBound);
            sinkZoneEnd = endBound;
          }
          const zoneW = sinkZoneEnd - sinkZoneStart;

          let sinkW, sinkX;
          if (dStartAbs > 0 && dEndAbs > dStartAbs) {
            const distSpan = dEndAbs - dStartAbs;
            sinkW = Math.max(SINK_MIN_W, Math.min(SINK_MAX, distSpan + SIDE_PANEL * 2));
            if (sinkW > zoneW && zoneW > 0) sinkW = zoneW;
            sinkX = Math.max(sinkZoneStart, dStartAbs - SIDE_PANEL);
            sinkX = Math.max(sinkZoneStart, Math.min(sinkZoneEnd - sinkW, sinkX));
            // 분배기 포함 검증
            if (dStartAbs < sinkX + SIDE_PANEL) sinkX = Math.max(sinkZoneStart, dStartAbs - SIDE_PANEL);
            if (dEndAbs > sinkX + sinkW - SIDE_PANEL) sinkX = Math.max(sinkZoneStart, Math.min(sinkZoneEnd - sinkW, dEndAbs - sinkW + SIDE_PANEL));
          } else {
            sinkW = SINK_DEF_W;
            if (sinkW > zoneW && zoneW > 0) sinkW = zoneW;
            sinkX = isRefLeft ? sinkZoneStart : Math.max(sinkZoneStart, sinkZoneEnd - sinkW);
          }
          sinkX = Math.max(sinkZoneStart, Math.min(sinkZoneEnd - sinkW, sinkX));
          sinkMod.x = sinkX;
          sinkMod.w = sinkW;
          sinkMod.endX = sinkX + sinkW;
        }

        // ════════════════════════════════════════
        // ★ 겹침 방지: 고정모듈 간 겹침 해소
        // ════════════════════════════════════════
        //  우선순위: 환풍구(가스대) > 분배기(개수대) > LT
        //  겹침 시 낮은 우선순위 모듈이 양보 (위치 이동 또는 축소)
        fixedOccupied.sort((a, b) => a.x - b.x);
        for (let i = 1; i < fixedOccupied.length; i++) {
          const prev = fixedOccupied[i - 1];
          const curr = fixedOccupied[i];
          const overlap = prev.endX - curr.x;
          if (overlap > 0) {
            // 가스대는 환풍구 기준이므로 절대 이동하지 않음
            if (curr.type === 'cook') {
              // prev가 양보: 너비 축소
              prev.w = Math.max(0, parseFloat(prev.w) - overlap);
              prev.endX = prev.x + prev.w;
            } else if (prev.type === 'cook') {
              // curr가 양보: 우측으로 밀기
              curr.x = prev.endX;
              curr.endX = curr.x + parseFloat(curr.w);
              // endBound 초과 시 너비 축소
              if (curr.endX > endBound) {
                curr.w = Math.max(0, endBound - curr.x);
                curr.endX = curr.x + curr.w;
              }
            } else {
              // 둘 다 비가스대: 뒤쪽 모듈이 밀림
              curr.x = prev.endX;
              curr.endX = curr.x + parseFloat(curr.w);
              if (curr.endX > endBound) {
                curr.w = Math.max(0, endBound - curr.x);
                curr.endX = curr.x + curr.w;
              }
            }
            console.log(`[AutoCalc] 겹침해소: ${prev.name||prev.type}↔${curr.name||curr.type}, overlap=${overlap}mm`);
          }
        }

        console.log(`[AutoCalc] 하부장: W=${W}, 유효=${effectiveW}, 환풍구=${ventPos}(abs=${ventAbs}), 분배기=${distStart}~${distEnd}(abs=${dStartAbs}~${dEndAbs})`);
        console.log(`[AutoCalc] 배치: ${fixedOccupied.sort((a,b)=>a.x-b.x).map(m => `${m.name||m.type}(${Math.round(m.x)}~${Math.round(m.endX)})`).join(' | ')}`);

        // ★ 비고정 모듈 제거 → 고정 모듈 기준으로 빈 공간 채우기
        item.modules = item.modules.filter(m => m.pos !== 'lower');
        const fixedTotalW = fixedOccupied.reduce((sum, f) => sum + (parseFloat(f.w) || 0), 0);

        let newModules = [];

        if (fixedTotalW >= effectiveW) {
          console.warn(`[AutoCalc] 하부장: 고정 모듈(${fixedTotalW}mm) >= 유효공간(${effectiveW}mm) — 고정 모듈만 배치`);
        } else {
          const spaces = calculateGaps(fixedOccupied, startBound, endBound);
          const hasMolding = item.specs.finishLeftType === 'Molding' || item.specs.finishRightType === 'Molding';
          const preferExact = hasMolding;

          const fillable = [];
          const smallGaps = [];
          spaces.forEach(s => {
            if (s.width >= DOOR_MIN_WIDTH) fillable.push(s);
            else if (s.width > 0) smallGaps.push(s);
          });

          // 빈 공간 채우기
          fillable.forEach(space => {
            newModules = newModules.concat(fillSpaceWithModules(space, 'lower', defaultLowerH, 550, preferExact));
          });

          // ★ 갭 흡수 (<350mm): 1순위 일반모듈 → 2순위 개수대 → 3순위 LT망장
          if (smallGaps.length > 0) {
            let remaining = smallGaps.reduce((s, g) => s + g.width, 0);
            const sinkFixed = fixedOccupied.find(f => f.type === 'sink');
            const ltFixed = fixedOccupied.find(f => f.name === 'LT망장');

            // 1순위: 일반모듈 (도어 450mm 기준 편차 큰 순)
            const generals = [...newModules].sort((a, b) => {
              const aDoorW = a.is2door || a.is2D ? parseFloat(a.w)/2 : parseFloat(a.w);
              const bDoorW = b.is2door || b.is2D ? parseFloat(b.w)/2 : parseFloat(b.w);
              return Math.abs(bDoorW - DOOR_TARGET_WIDTH) - Math.abs(aDoorW - DOOR_TARGET_WIDTH);
            });
            for (const mod of generals) {
              if (remaining <= 0) break;
              mod.w = (parseFloat(mod.w) || 0) + remaining;
              if (mod.endX !== undefined) mod.endX = mod.x + parseFloat(mod.w);
              console.log(`[AutoCalc] 갭 흡수: ${remaining}mm → ${mod.name} (일반모듈)`);
              remaining = 0;
            }

            // 2순위: 개수대 (SINK_MAX 이내)
            if (remaining > 0 && sinkFixed) {
              const curW = parseFloat(sinkFixed.w) || 0;
              const canAbsorb = Math.min(remaining, SINK_MAX - curW);
              if (canAbsorb > 0) {
                sinkFixed.w = curW + canAbsorb;
                sinkFixed.endX = sinkFixed.x + sinkFixed.w;
                remaining -= canAbsorb;
                console.log(`[AutoCalc] 갭 흡수: ${canAbsorb}mm → 개수대`);
              }
            }

            // 3순위: LT망장 (LT_MAX_W 이내)
            if (remaining > 0 && ltFixed) {
              const curW = parseFloat(ltFixed.w) || 0;
              const canAbsorb = Math.min(remaining, LT_MAX_W - curW);
              if (canAbsorb > 0) {
                ltFixed.w = curW + canAbsorb;
                ltFixed.endX = ltFixed.x + ltFixed.w;
                remaining -= canAbsorb;
                console.log(`[AutoCalc] 갭 흡수: ${canAbsorb}mm → LT망장`);
              }
            }
          }
        }

        // 고정 모듈 추가
        fixedOccupied.forEach(fixed => {
          newModules.push({
            id: fixed.id || Date.now() + Math.random(),
            type: fixed.type, name: fixed.name, pos: 'lower',
            w: fixed.w, h: fixed.h, d: fixed.d,
            isDrawer: fixed.isDrawer || false, isEL: fixed.isEL || false,
            isFixed: true, _x: fixed.x,
          });
        });

        // 정렬 및 저장
        newModules.sort((a, b) => a._x - b._x);
        newModules.forEach(m => delete m._x);
        if (!isRefLeft) newModules.reverse();

        if (newModules.length > 30) {
          console.error(`[AutoCalc] 하부장: 비정상 모듈 수 ${newModules.length}개 → 고정 모듈만 유지`);
          newModules = newModules.filter(m => m.isFixed);
        }

        item.modules = item.modules.concat(newModules);
      }

      function undoAutoCalc(itemUniqueId, section) {
        const item = selectedItems.find((i) => i.uniqueId === itemUniqueId);
        if (!item) return;

        if (section === 'upper' && item.prevUpperModules) {
          item.modules = item.modules.filter((m) => m.pos !== 'upper').concat(item.prevUpperModules);
          item.prevUpperModules = null;
        } else if (section === 'lower' && item.prevLowerModules) {
          item.modules = item.modules.filter((m) => m.pos !== 'lower').concat(item.prevLowerModules);
          item.prevLowerModules = null;
        }
        renderWorkspaceContent(item);
      }

      function clearAllModules(itemUniqueId) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item) return;
        if (!confirm('상부장 + 하부장 모듈을 모두 제거하시겠습니까?')) return;
        pushUndo(item);
        item.modules = [];
        renderWorkspaceContent(item);
      }

      // ★ 경량 재배치: 모듈 삭제 없이 고정 모듈 위치만 재정렬
      function repositionFixedModules(itemUniqueId) {
        const item = selectedItems.find(i => i.uniqueId === itemUniqueId);
        if (!item || item.modules.length === 0) return;

        const isRefLeft = item.specs.measurementBase === 'Left';
        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const effectiveW = calcEffectiveSpace(item);
        const startBound = fL;
        const endBound = startBound + effectiveW;
        const distStart = parseFloat(item.specs.distributorStart) || 0;
        const distEnd = parseFloat(item.specs.distributorEnd) || 0;
        const ventPos = parseFloat(item.specs.ventStart) || 0;

        // ── 하부장: 개수대/가스대 위치 기반 재정렬 ──
        const lowerMods = item.modules.filter(m => m.pos === 'lower');
        const sinkMod = lowerMods.find(m => m.type === 'sink');
        const cookMod = lowerMods.find(m => m.type === 'cook');

        lowerMods.forEach(m => { m._tx = -1; });

        if (sinkMod && distStart > 0 && distEnd > distStart) {
          const dAbs = Math.max(startBound, Math.min(endBound, isRefLeft ? startBound + distStart : endBound - distEnd));
          sinkMod._tx = Math.max(startBound, dAbs - 100);
        }
        if (cookMod && ventPos > 0) {
          const cw = parseFloat(cookMod.w) || 600;
          const vAbs = Math.max(startBound, Math.min(endBound, isRefLeft ? startBound + ventPos : endBound - ventPos));
          cookMod._tx = Math.max(startBound, Math.min(endBound - cw, vAbs - cw / 2));
        }

        const targeted = lowerMods.filter(m => m._tx >= 0).sort((a, b) => a._tx - b._tx);
        const others = lowerMods.filter(m => m._tx < 0);
        const merged = [];
        let tIdx = 0, oIdx = 0, cursor = startBound;
        while (tIdx < targeted.length || oIdx < others.length) {
          if (tIdx < targeted.length && (oIdx >= others.length || targeted[tIdx]._tx <= cursor)) {
            merged.push(targeted[tIdx]);
            cursor = targeted[tIdx]._tx + (parseFloat(targeted[tIdx].w) || 0);
            tIdx++;
          } else if (oIdx < others.length) {
            merged.push(others[oIdx]);
            cursor += parseFloat(others[oIdx].w) || 0;
            oIdx++;
          } else break;
        }
        merged.forEach(m => delete m._tx);

        // ── 상부장: 후드 → 환풍구 위치 ──
        const upperMods = item.modules.filter(m => m.pos === 'upper');
        const hoodMod = upperMods.find(m => m.type === 'hood');
        let upperSorted = [...upperMods];
        if (hoodMod && ventPos > 0) {
          const hw = parseFloat(hoodMod.w) || 800;
          const vAbs = isRefLeft ? startBound + ventPos : endBound - ventPos;
          const hoodX = Math.max(startBound, Math.min(endBound - hw, vAbs - hw / 2));
          const without = upperMods.filter(m => m !== hoodMod);
          let ins = without.length, c = startBound;
          for (let i = 0; i < without.length; i++) {
            if (hoodX < c + (parseFloat(without[i].w) || 0) / 2) { ins = i; break; }
            c += parseFloat(without[i].w) || 0;
          }
          without.splice(ins, 0, hoodMod);
          upperSorted = without;
        }

        item.modules = item.modules.filter(m => m.pos !== 'lower' && m.pos !== 'upper').concat(merged).concat(upperSorted);

        // ★ 분배기/환풍구 절대좌표를 item.specs에 저장 (3D 뷰에서 표시)
        // distributorStart=0이면 저장 안 함 (삭제 상태 유지)
        if (dStartAbs > 0 && dEndAbs > dStartAbs) {
          item.specs.waterSupplyPosition = Math.round((dStartAbs + dEndAbs) / 2);
          item.specs.distributorStartAbs = Math.round(dStartAbs);
          item.specs.distributorEndAbs = Math.round(dEndAbs);
        }
        if (ventPos > 0) {
          const ventAbs2 = isRefLeft ? startBound + ventPos : endBound - ventPos;
          item.specs.exhaustPosition = Math.round(ventAbs2);
        }

        renderWorkspaceContent(item);
      }

