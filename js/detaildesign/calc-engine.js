
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

        const primaryCandidates = []; // preferExact ? 0mm : 4~10mm
        const secondaryCandidates = []; // preferExact ? 4~10mm : 0~3mm

        // 10의 단위 후보 (내림, 올림)
        const tenFloor = Math.floor(rawWidth / 10) * 10;
        const tenCeil = Math.ceil(rawWidth / 10) * 10;

        // 짝수 후보 (내림, 올림)
        const evenFloor = Math.floor(rawWidth / 2) * 2;
        const evenCeil = Math.ceil(rawWidth / 2) * 2;

        // 후보들과 우선순위 (priority 낮을수록 우선)
        const allCandidates = [
          { width: tenFloor, priority: 1 },
          { width: tenCeil, priority: 1 },
          { width: evenFloor, priority: 2 },
          { width: evenCeil, priority: 2 },
        ];

        // 후보 분류
        for (const cand of allCandidates) {
          if (cand.width < DOOR_MIN_WIDTH || cand.width > DOOR_MAX_WIDTH) continue;
          const used = cand.width * doorCount;
          const gap = totalSpace - used;
          if (gap < 0) continue;

          if (preferExact) {
            // 몰딩 마감: 잔여 0mm 최우선
            if (gap >= 0 && gap < MIN_REMAINDER) {
              primaryCandidates.push({ ...cand, gap });
            } else if (gap >= MIN_REMAINDER && gap <= MAX_REMAINDER) {
              secondaryCandidates.push({ ...cand, gap });
            }
          } else {
            // 비몰딩: 4~10mm 잔여 최우선
            if (gap >= MIN_REMAINDER && gap <= MAX_REMAINDER) {
              primaryCandidates.push({ ...cand, gap });
            } else if (gap >= 0 && gap < MIN_REMAINDER) {
              secondaryCandidates.push({ ...cand, gap });
            }
          }
        }

        // 우선순위 정렬 함수
        const sortCandidates = (arr) => {
          arr.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return a.gap - b.gap;
          });
        };

        // 우선 후보 선택
        if (primaryCandidates.length > 0) {
          sortCandidates(primaryCandidates);
          return primaryCandidates[0].width;
        }

        // 차선 후보 선택 (0~3mm)
        if (secondaryCandidates.length > 0) {
          sortCandidates(secondaryCandidates);
          return secondaryCandidates[0].width;
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

        // 모든 유효한 조합 수집
        let allResults = [];

        for (let count = minCount; count <= maxCount; count++) {
          const width = findBestDoorWidth(totalSpace, count, preferExact);
          if (width !== null) {
            const gap = totalSpace - width * count;
            const targetDiff = Math.abs(width - DOOR_TARGET_WIDTH);
            const isPrimary = preferExact
              ? (gap >= 0 && gap < MIN_REMAINDER)
              : (gap >= MIN_REMAINDER && gap <= MAX_REMAINDER);

            allResults.push({
              doorCount: count,
              doorWidth: width,
              gap,
              targetDiff,
              isPrimary, // 4~10mm 조건 만족 여부
            });
          }
        }

        // 정렬: isPrimary 우선 → targetDiff 작은 순 → gap 작은 순
        allResults.sort((a, b) => {
          // 1. 4~10mm 조건 만족하는 것 우선
          if (a.isPrimary !== b.isPrimary) return b.isPrimary - a.isPrimary;
          // 2. 목표 도어 너비(450mm)에 가까운 것 우선
          if (a.targetDiff !== b.targetDiff) return a.targetDiff - b.targetDiff;
          // 3. 잔여 작은 것 우선
          return a.gap - b.gap;
        });

        let bestResult = allResults.length > 0 ? allResults[0] : null;

        // 결과가 없으면 강제 계산
        if (!bestResult) {
          // 목표 도어 너비에 가장 가까운 도어 개수 계산
          const idealCount = Math.round(totalSpace / DOOR_TARGET_WIDTH);
          const count = Math.max(minCount, Math.min(maxDoorCount, idealCount));
          let width = Math.floor(totalSpace / count / 2) * 2;
          width = Math.max(DOOR_MIN_WIDTH, Math.min(DOOR_MAX_WIDTH, width));
          bestResult = { doorCount: count, doorWidth: width, gap: totalSpace - width * count };
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

        // 왼쪽에서 오른쪽으로 겹침 방지
        let cursor = startBound;
        fixedList.forEach((mod) => {
          if (mod.x < cursor) {
            mod.x = cursor;
          }
          // ★ endBound 초과 방지: 너비 클램핑
          if (mod.x + parseFloat(mod.w) > endBound) {
            mod.w = Math.max(0, endBound - mod.x);
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
            mod.x = Math.max(startBound, mod.endX - parseFloat(mod.w));
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
      function fillGapWithModules(gap, section, defaultH, defaultD, edgeMode = 'none', preferExact = false) {
        const newModules = [];
        const namePrefix = section === 'upper' ? '상부장' : '하부장';

        // ★ RAG 규칙: 갭 < DOOR_MIN_WIDTH → 모듈 생성 안 함 (인접 모듈에 흡수 대상)
        if (gap.width < DOOR_MIN_WIDTH) return newModules;

        // ★ 각 갭을 독립적으로 distributeModules 호출 (fixedDoorWidth 기반 분할 제거)
        const result = distributeModules(gap.width, preferExact);
        let doorWidth = result.doorWidth;
        let doorCount = result.doorCount;

        if (!doorWidth || doorCount < 1) return newModules;

        let dx = gap.start;
        const gapEnd = gap.start + gap.width;
        const canFit = (w) => dx + w <= gapEnd + 1;

        // ★ 상부장 대칭 배치: 1D 가장자리 + 2D 중앙
        if (edgeMode !== 'none' && doorCount >= 3) {
          const hasLeft = (edgeMode === 'both' || edgeMode === 'left');
          const hasRight = (edgeMode === 'both' || edgeMode === 'right');
          const edgeDoors = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);
          const centerDoors = doorCount - edgeDoors;
          const center2D = Math.floor(centerDoors / 2);
          const centerMod1D = centerDoors % 2;

          if (hasLeft && canFit(doorWidth)) {
            newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
            dx += doorWidth;
          }
          for (let i = 0; i < center2D; i++) {
            if (!canFit(doorWidth * 2)) {
              // ★ 2D가 안 들어가면 1D 2개로 폴백
              if (canFit(doorWidth)) {
                newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
                dx += doorWidth;
              }
              if (canFit(doorWidth)) {
                newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
                dx += doorWidth;
              }
              continue;
            }
            newModules.push(createModule(section, namePrefix, doorWidth * 2, defaultH, defaultD, true, dx));
            dx += doorWidth * 2;
          }
          if (centerMod1D > 0 && canFit(doorWidth)) {
            newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
            dx += doorWidth;
          }
          if (hasRight && canFit(doorWidth)) {
            newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
            dx += doorWidth;
          }
        } else {
          // 하부장 또는 기본: 2D 먼저 + 1D 나중
          const quotient = Math.floor(doorCount / 2);
          const mod1D = doorCount % 2;
          for (let i = 0; i < quotient; i++) {
            if (!canFit(doorWidth * 2)) {
              // ★ 2D가 안 들어가면 1D 2개로 폴백
              if (canFit(doorWidth)) {
                newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
                dx += doorWidth;
              }
              if (canFit(doorWidth)) {
                newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
                dx += doorWidth;
              }
              continue;
            }
            newModules.push(createModule(section, namePrefix, doorWidth * 2, defaultH, defaultD, true, dx));
            dx += doorWidth * 2;
          }
          if (mod1D > 0 && canFit(doorWidth)) {
            newModules.push(createModule(section, namePrefix, doorWidth, defaultH, defaultD, false, dx));
            dx += doorWidth;
          }
        }

        // ★ 폴백: 모듈 생성 실패 또는 큰 잔여 → 갭 전체를 1D 모듈로 재생성
        {
          const usedSoFar = newModules.reduce((s, m) => s + m.w, 0);
          const leftoverSoFar = gap.width - usedSoFar;
          if (gap.width >= DOOR_MIN_WIDTH && (newModules.length === 0 || leftoverSoFar > MAX_REMAINDER + 20)) {
            // 기존 모듈 버리고 갭 전체를 1D로 생성 (dead zone: 601~689mm 등)
            newModules.length = 0;
            newModules.push(createModule(section, namePrefix, gap.width, defaultH, defaultD, false, gap.start));
          }
        }

        // ★ 잔여공간 완전 흡수: 마지막 모듈에 남은 공간 추가 (낭비 0mm)
        if (newModules.length > 0) {
          const totalUsed = newModules.reduce((s, m) => s + m.w, 0);
          const leftover = gap.width - totalUsed;
          if (leftover > 0 && leftover <= MAX_REMAINDER + 20) {
            newModules[newModules.length - 1].w += leftover;
          }
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
          // 기준상부장 너비 = 개수대 너비 (2D 모듈)
          const refUpperW = sinkW;
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

        // ★ Step 3: 비고정 모듈 먼저 제거 → 고정 모듈 기준으로 재계산
        item.modules = item.modules.filter((m) => m.pos !== 'upper');

        const fixedTotalW = fixedOccupied.reduce((sum, f) => sum + (parseFloat(f.w) || 0), 0);
        fixedOccupied = adjustFixedPositions(fixedOccupied, startBound, endBound);

        let newModules = [];

        if (fixedTotalW >= effectiveW) {
          // ★ 고정 모듈이 유효공간을 초과/가득 참 → 고정 모듈만 배치
          console.warn(`[AutoCalc] 상부장: 고정 모듈(${fixedTotalW}mm) >= 유효공간(${effectiveW}mm) — 고정 모듈만 배치`);
        } else {
          // ★ 가용 공간 있음 → Gap 계산 → 모듈 생성
          const gaps = calculateGaps(fixedOccupied, startBound, endBound);

          // 마감이 몰딩이면 잔여 0mm 우선
          const hasMoldingUpper = item.specs.finishLeftType === 'Molding' || item.specs.finishRightType === 'Molding';
          const preferExactUpper = hasMoldingUpper;

          // RAG 규칙: 작은 갭(< DOOR_MIN_WIDTH)을 큰 갭에 흡수
          const largeGapsUpper = [];
          let smallGapTotalUpper = 0;
          gaps.forEach(g => {
            if (g.width >= DOOR_MIN_WIDTH) {
              largeGapsUpper.push({ ...g });
            } else {
              smallGapTotalUpper += g.width;
            }
          });
          if (smallGapTotalUpper > 0 && largeGapsUpper.length > 0) {
            const extra = Math.floor(smallGapTotalUpper / largeGapsUpper.length);
            const rem = smallGapTotalUpper - extra * largeGapsUpper.length;
            largeGapsUpper.forEach((g, i) => {
              g.width += extra + (i < rem ? 1 : 0);
            });
          } else if (smallGapTotalUpper > 0 && largeGapsUpper.length === 0 && fixedOccupied.length > 0) {
            // ★ 큰 갭 없음 → 소규격 갭을 인접 고정 모듈에 흡수
            gaps.forEach(g => {
              if (g.width >= DOOR_MIN_WIDTH) return;
              const rightFixed = fixedOccupied.find(f => Math.abs(f.x - g.end) <= 1);
              const leftFixed = fixedOccupied.find(f => Math.abs(f.endX - g.start) <= 1);
              if (rightFixed) {
                rightFixed.x -= g.width;
                rightFixed.w = parseFloat(rightFixed.w) + g.width;
              } else if (leftFixed) {
                leftFixed.w = parseFloat(leftFixed.w) + g.width;
                leftFixed.endX = leftFixed.x + parseFloat(leftFixed.w);
              }
            });
            console.log(`[AutoCalc] 상부장: 소규격 갭(${smallGapTotalUpper}mm)을 고정 모듈에 흡수`);
          }

          // 대칭 분배 (각 갭 독립 distributeModules 호출)
          if (largeGapsUpper.length === 1) {
            newModules = fillGapWithModules(largeGapsUpper[0], 'upper', upperBodyH, 295, 'both', preferExactUpper);
          } else if (largeGapsUpper.length > 1) {
            largeGapsUpper.forEach((gap, idx) => {
              let edgeMode = 'none';
              if (idx === 0) edgeMode = 'left';
              else if (idx === largeGapsUpper.length - 1) edgeMode = 'right';
              newModules = newModules.concat(fillGapWithModules(gap, 'upper', upperBodyH, 295, edgeMode, preferExactUpper));
            });
          }

          const totalAvailableUpper = largeGapsUpper.reduce((s, g) => s + g.width, 0);
          console.log(`상부장: 고정모듈=${fixedOccupied.length}개, 가용공간=${totalAvailableUpper}mm, 작은갭흡수=${smallGapTotalUpper}mm`);
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

        item.modules = item.modules.concat(newModules);
      }

      function runAutoCalcLower(item) {
        const W = parseFloat(item.w) || 0;
        const effectiveW = getEffectiveSpace(item, 'lower');

        if (effectiveW <= 0) {
          alert('하부장 유효 공간이 부족합니다.');
          return;
        }

        const fL = item.specs.finishLeftType !== 'None' ? parseFloat(item.specs.finishLeftWidth) || 0 : 0;
        const startBound = fL;
        const endBound = startBound + effectiveW;
        const isRefLeft = item.specs.measurementBase === 'Left';

        const specLowerH = parseFloat(item.specs.lowerH) || 870;
        const specLegH = parseFloat(item.specs.sinkLegHeight) || 150;
        const specTopT = parseFloat(item.specs.topThickness) || 12;
        const defaultLowerH = specLowerH - specTopT - specLegH;

        // ★ 고정 모듈만 수집 (isFixed=true인 모듈의 현재 위치 계산)
        const currentModules = item.modules.filter((m) => m.pos === 'lower');
        let fixedOccupied = [];
        let cursor = startBound;
        currentModules.forEach((m) => {
          const mw = parseFloat(m.w) || 0;
          if (m.isFixed) {
            fixedOccupied.push({
              ...m,
              x: cursor,
              endX: cursor + mw,
              pos: 'lower',
            });
          }
          cursor += mw;
        });

        // ★ 분배기 절대좌표 계산 (개수대 배치 + 검증에서 재사용)
        const distStart = parseFloat(item.specs.distributorStart) || 0;
        const distEnd = parseFloat(item.specs.distributorEnd) || 0;
        let dStartAbs = 0, dEndAbs = 0;

        const sinkMod = fixedOccupied.find(m => m.type === 'sink');

        if (distStart > 0 && distEnd > distStart) {
          if (isRefLeft) {
            dStartAbs = startBound + distStart;
            dEndAbs = startBound + distEnd;
          } else {
            dStartAbs = endBound - distEnd;
            dEndAbs = endBound - distStart;
          }

          if (sinkMod) {
            // 개수대: 분배기 시작 -100mm ~ 분배기 끝 +100mm 커버
            const sinkX = Math.max(startBound, dStartAbs - 100);
            const minEnd = Math.min(endBound, dEndAbs + 100);
            const minW = minEnd - sinkX;
            const sinkW = Math.min(Math.max(parseFloat(sinkMod.w) || 1000, minW), endBound - sinkX);

            sinkMod.x = sinkX;
            sinkMod.w = sinkW;
            sinkMod.endX = sinkX + sinkW;
          }
        } else {
          // ★ 분배기 미입력 시: 기준 방향에 따라 개수대 기본 위치 결정
          if (sinkMod) {
            const sinkW = parseFloat(sinkMod.w) || 1000;
            if (isRefLeft) {
              sinkMod.x = startBound;
            } else {
              sinkMod.x = Math.max(startBound, endBound - sinkW);
            }
            sinkMod.endX = sinkMod.x + sinkW;
          }
        }

        // ★ 환풍구 → 가스대 위치 연동
        const ventPos = parseFloat(item.specs.ventStart) || 0;
        const cookMod = fixedOccupied.find(m => m.type === 'cook');
        if (cookMod) {
          const cookW_val = parseFloat(cookMod.w) || 600;
          if (ventPos > 0) {
            // 환풍구 위치 중심에 가스대 배치
            let ventAbs = isRefLeft ? startBound + ventPos : endBound - ventPos;
            let cookX = ventAbs - cookW_val / 2;
            cookX = Math.max(startBound, Math.min(endBound - cookW_val, cookX));
            cookMod.x = cookX;
            cookMod.endX = cookX + cookW_val;
            console.log(`[AutoCalc] 가스대: 환풍구=${ventPos}mm → cookX=${cookX}`);
          } else {
            // 환풍구 미입력: 기준 반대쪽에 배치
            if (isRefLeft) {
              cookMod.x = Math.max(startBound, endBound - cookW_val);
            } else {
              cookMod.x = startBound;
            }
            cookMod.endX = cookMod.x + cookW_val;
          }
        }

        // ★ LT망장 → 가스대 바로 우측에 배치
        const ltMod = fixedOccupied.find(m => m.name === 'LT망장' || (m.type === 'storage' && m.isDrawer && parseFloat(m.w) <= 250));
        if (ltMod && cookMod) {
          const ltW = parseFloat(ltMod.w) || 200;
          ltMod.x = cookMod.endX;
          ltMod.endX = ltMod.x + ltW;
          // 경계 초과 방지
          if (ltMod.endX > endBound) {
            ltMod.x = endBound - ltW;
            ltMod.endX = endBound;
          }
          console.log(`[AutoCalc] LT망장: 가스대 우측 X=${ltMod.x}`);
        }

        // 고정 모듈 총 너비
        // ★ 비고정 모듈 먼저 제거 → 고정 모듈 기준으로 재계산
        item.modules = item.modules.filter((m) => m.pos !== 'lower');

        const fixedTotalW = fixedOccupied.reduce((sum, f) => sum + (parseFloat(f.w) || 0), 0);

        // 위치 조정
        fixedOccupied = adjustFixedPositions(fixedOccupied, startBound, endBound);

        // ★ 분배기-개수대 제약 재적용 (adjustFixedPositions가 위치를 밀었을 수 있음)
        if (dStartAbs > 0 && dEndAbs > 0) {
          const sinkMod2 = fixedOccupied.find(m => m.type === 'sink');
          if (sinkMod2) {
            if (sinkMod2.x >= dStartAbs) {
              sinkMod2.x = Math.max(startBound, dStartAbs - 100);
            }
            const curEnd = sinkMod2.x + parseFloat(sinkMod2.w);
            if (curEnd <= dEndAbs) {
              sinkMod2.w = Math.min(endBound, dEndAbs + 100) - sinkMod2.x;
            }
            if (sinkMod2.x + parseFloat(sinkMod2.w) > endBound) {
              sinkMod2.w = endBound - sinkMod2.x;
            }
            sinkMod2.endX = sinkMod2.x + parseFloat(sinkMod2.w);
          }
        }

        let newModules = [];

        if (fixedTotalW >= effectiveW) {
          // ★ 고정 모듈이 유효공간을 초과/가득 참 → 고정 모듈만 배치
          console.warn(`[AutoCalc] 하부장: 고정 모듈(${fixedTotalW}mm) >= 유효공간(${effectiveW}mm) — 고정 모듈만 배치`);
        } else {
          const gaps = calculateGaps(fixedOccupied, startBound, endBound);

          // 마감이 몰딩이면 잔여 0mm 우선
          const hasMolding = item.specs.finishLeftType === 'Molding' || item.specs.finishRightType === 'Molding';
          const preferExact = hasMolding;

          // RAG 규칙: 작은 갭(< DOOR_MIN_WIDTH)을 큰 갭에 흡수
          const largeGaps = [];
          let smallGapTotal = 0;
          gaps.forEach(g => {
            if (g.width >= DOOR_MIN_WIDTH) {
              largeGaps.push({ ...g });
            } else {
              smallGapTotal += g.width;
            }
          });
          if (smallGapTotal > 0 && largeGaps.length > 0) {
            const extra = Math.floor(smallGapTotal / largeGaps.length);
            const rem = smallGapTotal - extra * largeGaps.length;
            largeGaps.forEach((g, i) => {
              g.width += extra + (i < rem ? 1 : 0);
            });
          } else if (smallGapTotal > 0 && largeGaps.length === 0 && fixedOccupied.length > 0) {
            // ★ 큰 갭 없음 → 소규격 갭을 인접 고정 모듈에 흡수
            // 각 소규격 갭에 인접한 고정 모듈(오른쪽 우선, 없으면 왼쪽)의 너비를 확장
            gaps.forEach(g => {
              if (g.width >= DOOR_MIN_WIDTH) return;
              const rightFixed = fixedOccupied.find(f => Math.abs(f.x - g.end) <= 1);
              const leftFixed = fixedOccupied.find(f => Math.abs(f.endX - g.start) <= 1);
              if (rightFixed) {
                rightFixed.x -= g.width;
                rightFixed.w = parseFloat(rightFixed.w) + g.width;
              } else if (leftFixed) {
                leftFixed.w = parseFloat(leftFixed.w) + g.width;
                leftFixed.endX = leftFixed.x + parseFloat(leftFixed.w);
              }
            });
            console.log(`[AutoCalc] 하부장: 소규격 갭(${smallGapTotal}mm)을 고정 모듈에 흡수`);
          }

          // 모듈 생성 (각 갭 독립 distributeModules 호출)
          largeGaps.forEach((gap) => {
            newModules = newModules.concat(fillGapWithModules(gap, 'lower', defaultLowerH, 550, 'none', preferExact));
          });

          console.log(`하부장: 고정모듈=${fixedOccupied.length}개, 가용공간=${effectiveW - fixedTotalW}mm`);
        }

        // 고정 모듈 추가
        fixedOccupied.forEach((fixed) => {
          newModules.push({
            id: fixed.id || Date.now() + Math.random(),
            type: fixed.type,
            name: fixed.name,
            pos: 'lower',
            w: fixed.w,
            h: fixed.h,
            d: fixed.d,
            isDrawer: fixed.isDrawer || false,
            isEL: fixed.isEL || false,
            isFixed: true,
            _x: fixed.x,
          });
        });

        // 정렬 및 저장
        newModules.sort((a, b) => a._x - b._x);
        newModules.forEach((m) => delete m._x);
        if (!isRefLeft) newModules.reverse();

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

