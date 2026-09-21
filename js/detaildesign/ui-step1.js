      // ============================================================
      // UI 관련 함수들
      // ============================================================

      // W12-2: initCategoryGrid() 삭제 — 품목 선택 페이지(Step1)가 제거됐다.
      // 품목 카드 그리드가 하던 일은 플래너 좌측 '품목' 아이콘(mockup-shell.html)이 대신한다.
      //   클릭   → postMessage ADD_CATEGORY    → incrementCategory
      //   우클릭 → postMessage REMOVE_CATEGORY → decrementCategory
      //   배지   → 부모가 보내는 CATEGORY_COUNTS

      function incrementCategory(catId) {
        const cat = CATEGORIES.find((c) => c.id === catId);
        const specLegH = 150;
        const specLowerH = 870;
        const specUpperH = 720;
        const specTopT = 12;
        const specOverlap = 15;
        const lowerBodyH = specLowerH - specTopT - specLegH;
        const upperBodyH = specUpperH - specOverlap;

        // W8-4: 가구 추가 시 default w/d 자동 적용 — Step 2 워크스페이스에서 수정 (사용자 친화적)
        const defaultWByCategory = {
          sink: 3000, island: 2400, wardrobe: 3600, fridge: 1900, shoerack: 1800,
          vanity: 1400, storage: 2400, warehouse: 2000, door: 600, custom: 1200,
        };
        const newItem = {
          uniqueId: Date.now() + Math.random(),
          categoryId: cat.id,
          name: cat.name,
          defaultD: cat.defaultD,
          defaultH: cat.defaultH,
          w: defaultWByCategory[cat.id] || 2400,
          h: cat.defaultH || 2310,
          d: cat.defaultD || 600,
          image: null,
          specs: deepClone(DEFAULT_SPECS),
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
        // W8-4: layoutTemplates 정의 (표준형/소형/대형) 삭제 — UI 단순화

        selectedItems.push(newItem);
        updateUI();
        // W9-4: 가구 카드 클릭 = 카운트 +1 만. "다음 단계" 버튼 클릭 시에만 Step 2 진입.
        // (W9-3 의 자동 goToStep2 제거 — 사용자가 명시적으로 다음 버튼 눌러야 mockup layout 진입)
      }

      function decrementCategory(catId) {
        const targets = selectedItems.filter((item) => item.categoryId === catId);
        if (targets.length > 0) removeInstance(targets[targets.length - 1].uniqueId);
      }

      function removeInstance(uniqueId) {
        selectedItems = selectedItems.filter((item) => item.uniqueId !== uniqueId);
        updateUI();
      }

      // W8-6: 카테고리별 카운트 dict → 모든 planner iframe 으로 broadcast
      function _broadcastCategoryCounts() {
        const counts = {};
        CATEGORIES.forEach((cat) => {
          counts[cat.id] = selectedItems.filter((item) => item.categoryId === cat.id).length;
        });
        document.querySelectorAll('iframe[data-planner]').forEach((iframe) => {
          try {
            iframe.contentWindow && iframe.contentWindow.postMessage(
              { type: 'CATEGORY_COUNTS', counts },
              '*'
            );
          } catch {}
        });
      }

      /**
       * W12-2: 품목 데이터 정규화 — DOM 과 무관한 부분만 모았다.
       *
       * Step1(품목 선택 페이지)이 제거되면서 updateUI() 의 DOM 조작부는 거의 사라지지만,
       * 아래 정규화는 **화면과 무관하게 반드시 돌아야 한다**:
       *   - labelName  : BOM 자재표(extractors.js:51)와 리포트 제목(ai-design-report.js)의 유일한 출처
       *   - topSizes   : 문자열 → 객체 마이그레이션 (구 저장 설계 호환)
       *   - lowerLayoutShape : layoutShape 승계
       * 플래너 결과 반영(_applyPlannerResult)과 설계 불러오기(loadDesign)도 이 경로를 탄다.
       */
      function normalizeItems() {
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

        // 마이그레이션 처리
        selectedItems.forEach((item) => {
          if (!item.specs.lowerLayoutShape && item.specs.layoutShape) {
            item.specs.lowerLayoutShape = item.specs.layoutShape;
          }
        });
      }

      /**
       * W12-2: 품목 상태가 바뀐 뒤의 갱신 진입점.
       *
       * 예전에는 Step1 화면(카드 카운터·요약 태그·다음 버튼)을 그리는 함수였다.
       * Step1 이 제거되면서 하는 일은 세 가지로 줄었다:
       *   1) 데이터 정규화 (labelName 등 — BOM 이 여기에 의존한다)
       *   2) 플래너 품목 아이콘 배지 동기화
       *   3) 품목이 0개↔1개 이상으로 바뀔 때 플래너 마운트 상태 보정
       * 호출자가 16곳이라 이름은 그대로 둔다.
       */
      function updateUI() {
        normalizeItems();

        // W8-6: 카테고리 카운트 변경 시 플래너 품목 아이콘 배지 갱신
        _broadcastCategoryCounts();

        // 2026-09-19: 툴바 책갈피도 여기서 다시 그린다 — 품목이 늘고 주는 길목은 여기뿐이다.
        //   _syncStep2Mount 는 품목 0개면 곧바로 돌아가므로, 마지막 하나를 지웠을 때
        //   지워진 품목의 책갈피가 그대로 남았다. normalizeItems 가 labelName(#1·#2)을
        //   다시 매기므로 순서도 이 뒤라야 맞다.
        if (typeof _renderStep2ItemTabs === 'function') _renderStep2ItemTabs();

        // W12-2: 첫 품목이 생기면 부트스트랩 플래너를 실제 품목 워크스페이스로 넘긴다.
        //        마지막 품목이 지워지면 다시 부트스트랩으로 돌아간다.
        if (typeof _syncStep2Mount === 'function') _syncStep2Mount();
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
          // W12-2: #btnNext(Step1 "다음 단계") 는 제거됐다. 치수 유효성은 BOM 산출 시점에 본다.
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

      // ============================================================
      // W11-9/W11-10: Step 2 화면 모드
      //
      // Step 2 의 정식 UI 는 planner(mockup-shell) iframe 이다.
      // W9-2(#308) "기존 layout 완전 숨김", W9-6(#312) "Step 2 mockup HTML 전면 교체",
      // W9-7(#313) "designWorkspace 내부 UI 완전 숨김" 으로 확정된 방향이므로
      // 구 워크스페이스로 되돌아가는 토글은 두지 않는다.
      //
      // 다만 base.css 의 전체 숨김이 BOM 산출 버튼(.ws-header 안)까지 삼켜
      // Step 3 로 갈 수단이 사라졌고, 빠져나올 방법도 없었다.
      // → body 직속 #step2Toolbar 가 그 두 경로를 담당한다.
      //
      // step2-native 는 예외 처리용이다. 냉장고장은
      // _renderWorkspaceContentImpl 이 early return 하여 planner overlay 를
      // 만들지 않으므로, fullscreen 을 걸면 화면이 백지가 된다.
      // planner 가 그 카테고리를 지원하기 전까지의 임시 조치다.
      // (붙박이장은 2026-09-17 에 플래너로 옮겼다 — wardrobe.md §1.4)
      // ============================================================

      /**
       * planner 가 아직 지원하지 않는 카테고리.
       * _renderWorkspaceContentImpl 이 이것을 early return 으로 처리해
       * planner overlay 를 만들지 않는다. fullscreen 을 걸면 백지가 되므로
       * 예외적으로 구 워크스페이스를 노출한다.
       *
       * 2026-09-17: **붙박이장을 뺐다.** 플래너가 통 구조(프리셋·칸·칸막이·옷봉·서랍)를 담고
       * 자재표까지 이어진다 (wardrobe.md §1.3·§1.4). 이제 붙박이장도 싱크대와 같은 화면이다.
       * 냉장고장은 모듈 type 분기를 플래너가 만들지 못해 그대로 남는다.
       */
      const NATIVE_ONLY_CATEGORIES = ['fridge'];

      function _isNativeOnly(item) {
        return !!item && NATIVE_ONLY_CATEGORIES.includes(item.categoryId);
      }

      /**
       * 플래너 **결과**를 받지 못하는 카테고리. 화면 선택(_isNativeOnly)과 다른 축이다.
       *
       * 2026-09-17: 붙박이장을 풀었다 — 브리지가 통 구조를 pos 'wardrobe' 모듈로 옮기고
       * extractWardrobe 가 칸막이·선반·옷봉까지 낸다. 냉장고장은 아직 모듈 type 분기를
       * 플래너가 만들지 못해 그대로 막는다.
       */
      const PLANNER_RESULT_BLOCKED = ['fridge'];

      function _plannerResultBlocked(item) {
        return !!item && PLANNER_RESULT_BLOCKED.includes(item.categoryId);
      }

      function _setStep2Mode(mode) {
        const body = document.body;
        body.classList.toggle('step2-fullscreen', mode === 'planner');
        body.classList.toggle('step2-native', mode === 'native');
      }

      /** 현재 북마크로 선택된 아이템. renderBookmarks 가 currentItemId 를 설정한다(:414, :420). */
      function _currentStep2Item() {
        if (typeof currentItemId !== 'undefined' && currentItemId) {
          const found = selectedItems.find((i) => String(i.uniqueId) === String(currentItemId));
          if (found) return found;
        }
        return selectedItems[0] || null;
      }

      /** 현재 아이템에 맞는 모드를 적용하고 툴바 제목을 갱신한다. */
      function _applyStep2Chrome(item) {
        const target = item || _currentStep2Item();
        const title = document.getElementById('s2Title');
        if (title) {
          title.textContent = target
            ? `${target.labelName || target.name || '설계'} · ${target.w || '?'}×${target.h || '?'}×${target.d || '?'}`
            : '설계';
        }
        // planner 미지원 카테고리만 예외적으로 구 워크스페이스를 노출한다
        _setStep2Mode(_isNativeOnly(target) ? 'native' : 'planner');
      }

      function goToStep2() {
        // W12-2: Step1(품목 선택 페이지) 은 제거됐다. 남은 참조는 전부 옵셔널.
        const step1 = document.getElementById('step1-content');
        if (step1) step1.style.display = 'none';
        document.getElementById('step2-content').style.display = 'block';
        document.getElementById('step-dot-1')?.classList.remove('active');
        document.getElementById('step-dot-2')?.classList.add('active');
        // W9-1: Step 2 진입 시 외곽 (navbar + header + stepper + section-label + bookmark-tabs + 입력 수정하기) 숨김
        // W11-9: 카테고리에 따라 planner/native 모드를 결정한다
        _applyStep2Chrome(_currentStep2Item());
        // W12-2: 품목 0개면 부트스트랩 플래너를 띄워 품목 아이콘을 쓸 수 있게 한다
        _syncStep2Mount();
        if (selectedItems.length > 0) renderBookmarks();
        _renderStep2ItemTabs();
        _pbwSyncPlacement(); // 브리지 경고 배너 — 툴바 아래로
        // W9-1: fullscreen reflow 후 iframe overlay 위치 재계산 (designWorkspace 가 100vh)
        setTimeout(() => {
          document.querySelectorAll('[id^="__planner-overlay-"]').forEach((overlay) => {
            const id = overlay.id.replace('__planner-overlay-', '');
            const item = selectedItems.find((i) => String(i.uniqueId) === String(id));
            if (!item) return;
            const ws = document.getElementById('designWorkspace');
            if (ws) _positionPlannerOverlay(overlay.id, ws);
          });
        }, 50);
      }

      function goToStep3() {
        document.getElementById('step2-content').style.display = 'none';
        document.getElementById('step3-content').style.display = 'block';
        document.getElementById('step-dot-2')?.classList.remove('active');
        document.getElementById('step-dot-3')?.classList.add('active');
        // W12-2: BOM 화면에서는 플래너 오버레이가 위를 덮으면 안 된다
        _removeBootstrapPlanner();
        // 2026-09-22: 부트스트랩만 지우면 **품목별 오버레이**가 남아 보고서를 덮을 수 있었다
        _showOnlyPlannerOverlay(null);
        // W9-1: Step 3 진입 시 fullscreen 해제 (BOM 보고서는 외곽 필요)
        document.body.classList.remove('step2-fullscreen');
        document.body.classList.remove('step2-native');
        _pbwSyncPlacement(); // 브리지 경고 배너 — 보고서 위로
      }

      function backToStep2() {
        document.getElementById('step3-content').style.display = 'none';
        document.getElementById('step2-content').style.display = 'block';
        document.getElementById('step-dot-3').classList.remove('active');
        document.getElementById('step-dot-2').classList.add('active');
        // W9-1: Step 2 복귀 시 fullscreen 재활성
        // W11-9: 카테고리에 맞는 모드로 복귀 (붙박이장/냉장고장은 네이티브)
        _applyStep2Chrome(_currentStep2Item());
        _showOnlyPlannerOverlayFor(_currentStep2Item());   // 2026-09-22: 지금 품목 것만 켠다
        _pbwSyncPlacement(); // 브리지 경고 배너 — 툴바 아래로
      }

      function proceedToBOM() {
        // 1. AI 결과 모달 닫기
        const modal = document.querySelector('.ai-design-result-modal');
        if (modal) modal.remove();

        // ★ 디버그: BOM 시작 시 selectedItems 상태 확인
        dlog('[BOM] === proceedToBOM 시작 ===');
        selectedItems.forEach((item, idx) => {
          dlog(`[BOM] selectedItems[${idx}]: categoryId=${item.categoryId}, modules=${item.modules?.length}, upper=${item.modules?.filter(m=>m.pos==='upper').length}, lower=${item.modules?.filter(m=>m.pos==='lower').length}`);
        });

        // 2. 설계 데이터 추출
        const design = window.DadamAgent.exportDesign();
        if (!design.items || design.items.length === 0) {
          alert('설계 데이터가 없습니다.');
          return;
        }

        // ★ 디버그: exportDesign 후 복사본 확인
        design.items.forEach((item, idx) => {
          dlog(`[BOM] design.items[${idx}]: modules=${item.modules?.length}, upper=${item.modules?.filter(m=>m.pos==='upper').length}, lower=${item.modules?.filter(m=>m.pos==='lower').length}`);
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

      // ★ 3D 뷰 카메라 전환 + 2D/3D 토글
      function set3DView(itemUniqueId, view, btn) {
        const threeCanvas = document.getElementById('three-canvas-' + itemUniqueId);
        const viewLabel = document.getElementById('view-label-' + itemUniqueId);
        const viewHint = document.getElementById('view-hint-' + itemUniqueId);

        if (threeCanvas) threeCanvas.style.display = 'block';
        if (viewLabel) viewLabel.textContent = '🎮 3D View';
        if (viewHint) viewHint.textContent = '드래그 → 회전 | 스크롤 → 줌';
        // 카메라 전환 (iframe은 body 레벨 오버레이에 있음)
        const overlay = document.getElementById('__planner-overlay-' + itemUniqueId);
        const iframe = overlay?.querySelector('iframe[data-planner]');
        if (iframe) {
          iframe.contentWindow?.postMessage({ type: 'SET_CAMERA_VIEW', view }, '*');
        }
        // 버튼 active 토글
        const group = btn.closest('.view3d-btns');
        if (group) {
          group.querySelectorAll('.v3d-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      }

      // ★ R3F 3D 플래너 임베드 로드
      // W9-6/W9-8: mockup HTML 전면 교체. Cloudflare Pages 가 .html 확장자 자동 제거 (308 redirect)
      // → '/mockup-shell' (확장자 없이) 로 직접 접근. iframe 의 308 redirect 실패 회피.
      const PLANNER_BASE_URL = '/mockup-shell';
      /**
       * ㄱ자/ㄷ자 secondary 모듈을 payload에 동적 추가 (공통 헬퍼)
       */
      function _appendSecondaryModules(payload, specs, itemD, itemModules) {
        const lShape = specs.lowerLayoutShape || specs.layoutShape || 'I';
        dlog('[CornerDebug] _appendSecondaryModules called', {
          lShape,
          upperSecondaryW: specs.upperSecondaryW,
          upperSecondaryD: specs.upperSecondaryD,
          secondaryUpperEnabled: specs.secondaryUpperEnabled,
          dimensionMode: specs.dimensionMode,
          upperLayoutShape: specs.upperLayoutShape,
          lowerSecondaryW: specs.lowerSecondaryW,
          primaryModCount: { lower: payload.lowerModules.length, upper: payload.upperModules.length },
        });
        if (lShape === 'I') return;
        if (!specs.lowerSecondaryW) specs.lowerSecondaryW = '1800';
        const secW = parseFloat(specs.lowerSecondaryW) || 600;
        const secD = parseFloat(specs.lowerSecondaryD) || parseFloat(itemD) || 600;
        const primeD = parseFloat(itemD) || 600;
        const startSide = specs.secondaryStartSide || 'left';
        // W10-1: 영속화된 secondary 모듈(item.modules)이 있으면 그것을 payload로 파생 — 데이터 모델이 SSOT
        // id 체계(blind-corner-auto / sec-auto-*)는 W9 정면도 호환을 위해 유지
        const persistedSec = (itemModules || []).filter(
          m => m.pos === 'lower' && (m.line === 'secondary' || m.orientation === 'secondary')
        );
        let blindMod, secMods;
        if (persistedSec.length > 0) {
          const pBlind = persistedSec.find(m => m.id === 'corner-blind-lower' || m.name === 'LT망장');
          const pSecs = persistedSec.filter(m => m !== pBlind);
          blindMod = {
            id: 'blind-corner-auto', kind: 'door',
            width: parseFloat(pBlind && pBlind.w) || (primeD + 40),
            moduleType: 'blind', doorCount: 1, orientation: 'secondary',
          };
          secMods = pSecs.map((m, i) => ({
            id: `sec-auto-${i}`, kind: 'door', width: parseFloat(m.w) || 600,
            moduleType: 'storage', doorCount: m.doorCount || 1, orientation: 'secondary',
          }));
        } else {
          // 레거시 fallback (영속화 이전 설계): 멍판 너비 = 인접 상판 깊이 + 40mm
          const blindW = primeD + 40;
          blindMod = {
            id: 'blind-corner-auto', kind: 'door', width: blindW,
            moduleType: 'blind', doorCount: 1, orientation: 'secondary',
          };
          const availableSecW = Math.max(0, secW - blindW);
          const secModCount = availableSecW > 0 ? Math.max(1, Math.round(availableSecW / 600)) : 0;
          const secModW = secModCount > 0 ? Math.round(availableSecW / secModCount) : 0;
          secMods = Array.from({ length: secModCount }, (_, i) => ({
            id: `sec-auto-${i}`, kind: 'door', width: secModW,
            moduleType: 'storage', doorCount: 1, orientation: 'secondary',
          }));
        }
        if (startSide === 'left') {
          payload.lowerModules = [blindMod, ...secMods, ...payload.lowerModules];
        } else {
          payload.lowerModules = [...payload.lowerModules, blindMod, ...secMods];
        }
        payload.lowerCount = payload.lowerModules.length;
        // 상부장 secondary — upperSecondaryW 없으면 기본 1800mm
        dlog('[CornerDebug] 상부장 secondary 체크', {
          secondaryUpperEnabled: specs.secondaryUpperEnabled,
          upperSecondaryW_before: specs.upperSecondaryW,
          condition: specs.secondaryUpperEnabled !== false,
        });
        if (specs.secondaryUpperEnabled !== false) {
          if (!specs.upperSecondaryW) specs.upperSecondaryW = '1800';
          dlog('[CornerDebug] 상부장 secondary 생성 진입', { upperSecondaryW: specs.upperSecondaryW });
          const uSecW = parseFloat(specs.upperSecondaryW) || secW;
          const uPrimeD = parseFloat(specs.upperPrimeD) || 295;
          const uSecD = parseFloat(specs.upperSecondaryD) || uPrimeD;
          // W10-2: 영속화된 상부 secondary 모듈 우선 — 데이터 모델이 SSOT
          const persistedUpperSec = (itemModules || []).filter(
            m => m.pos === 'upper' && (m.line === 'secondary' || m.orientation === 'secondary')
          );
          let uBlindMod, uSecMods;
          if (persistedUpperSec.length > 0) {
            const puBlind = persistedUpperSec.find(m => m.id === 'corner-blind-upper' || m.name === 'LT망장');
            const puSecs = persistedUpperSec.filter(m => m !== puBlind);
            uBlindMod = {
              id: 'blind-corner-upper-auto', kind: 'door',
              width: parseFloat(puBlind && puBlind.w) || (uPrimeD + 40),
              moduleType: 'blind', doorCount: 1, orientation: 'secondary',
            };
            uSecMods = puSecs.map((m, i) => ({
              id: `sec-upper-auto-${i}`, kind: 'door', width: parseFloat(m.w) || 600,
              moduleType: 'storage', doorCount: m.doorCount || 1, orientation: 'secondary',
            }));
          } else {
            // 레거시 fallback: 멍판 너비 = upper prime depth + 40mm
            const uBlindW = uPrimeD + 40;
            uBlindMod = {
              id: 'blind-corner-upper-auto', kind: 'door', width: uBlindW,
              moduleType: 'blind', doorCount: 1, orientation: 'secondary',
            };
            const uAvailableSecW = Math.max(0, uSecW - uBlindW);
            const uSecModCount = uAvailableSecW > 0 ? Math.max(1, Math.round(uAvailableSecW / 600)) : 0;
            const uSecModW = uSecModCount > 0 ? Math.round(uAvailableSecW / uSecModCount) : 0;
            uSecMods = Array.from({ length: uSecModCount }, (_, i) => ({
              id: `sec-upper-auto-${i}`, kind: 'door', width: uSecModW,
              moduleType: 'storage', doorCount: 1, orientation: 'secondary',
            }));
          }
          if (startSide === 'left') {
            payload.upperModules = [uBlindMod, ...uSecMods, ...payload.upperModules];
          } else {
            payload.upperModules = [...payload.upperModules, uBlindMod, ...uSecMods];
          }
          payload.upperCount = payload.upperModules.length;
          dlog('[CornerDebug] 상부장 secondary 생성 완료', {
            upperModules: payload.upperModules.map(m => ({ id: m.id, w: m.width, orient: m.orientation })),
            upperCount: payload.upperCount,
          });
        }
        // ★ ㄷ자형: tertiary line
        if (lShape === 'U') {
          if (!specs.lowerTertiaryW) specs.lowerTertiaryW = specs.lowerSecondaryW || '1800';
          const terW = parseFloat(specs.lowerTertiaryW) || secW;
          const terFrom = specs.tertiaryStartFrom || 'prime';
          const terD = parseFloat(specs.lowerTertiaryD) || primeD;

          if (terFrom === 'secondary') {
            // ★ secondary line 끝에서 시작 — secondary 마지막 모듈을 멍장으로 변경
            // 멍장 width = tertiary depth (코너 오버랩)
            const secModsInPayload = payload.lowerModules.filter(m => m.orientation === 'secondary');
            if (secModsInPayload.length > 0) {
              const lastSec = secModsInPayload[secModsInPayload.length - 1];
              lastSec.kind = 'door';
              lastSec.width = terD;
              lastSec.id = 'blind-corner-sec-ter-auto';
              lastSec.doorCount = 1;
            }
            // tertiary 모듈: prime line과 평행하게 secondary 끝에서 배치
            const terModCount = terW > 0 ? Math.max(1, Math.round(terW / 600)) : 0;
            const terModW = terModCount > 0 ? Math.round(terW / terModCount) : 0;
            const terMods = Array.from({ length: terModCount }, (_, i) => ({
              id: `ter-auto-${i}`, kind: 'door', width: terModW,
              moduleType: 'storage', doorCount: 1, orientation: 'tertiary',
            }));
            // tertiary는 secondary 뒤에 배치 (startSide 동일)
            if (startSide === 'left') {
              // secondary가 앞에 있으므로 tertiary도 앞에 (secondary 뒤)
              const secEndIdx = payload.lowerModules.lastIndexOf(secModsInPayload[secModsInPayload.length - 1]);
              payload.lowerModules.splice(secEndIdx + 1, 0, ...terMods);
            } else {
              const secStartIdx = payload.lowerModules.indexOf(secModsInPayload[0]);
              payload.lowerModules.splice(secStartIdx, 0, ...terMods);
            }
            payload.lowerCount = payload.lowerModules.length;
            // 상부장 tertiary (from secondary)
            if (specs.secondaryUpperEnabled !== false) {
              if (!specs.upperTertiaryW) specs.upperTertiaryW = specs.upperSecondaryW || '1800';
            }
            if (specs.secondaryUpperEnabled !== false && specs.upperTertiaryW) {
              const uTerW = parseFloat(specs.upperTertiaryW) || terW;
              const uTerD = parseFloat(specs.upperTertiaryD) || parseFloat(specs.upperSecondaryD) || 295;
              const uSecModsInPayload = payload.upperModules.filter(m => m.orientation === 'secondary');
              if (uSecModsInPayload.length > 0) {
                const lastUSec = uSecModsInPayload[uSecModsInPayload.length - 1];
                lastUSec.kind = 'door';
                lastUSec.width = uTerD;
                lastUSec.id = 'blind-corner-upper-sec-ter-auto';
                lastUSec.doorCount = 1;
              }
              const uTerModCount = uTerW > 0 ? Math.max(1, Math.round(uTerW / 600)) : 0;
              const uTerModW = uTerModCount > 0 ? Math.round(uTerW / uTerModCount) : 0;
              const uTerMods = Array.from({ length: uTerModCount }, (_, i) => ({
                id: `ter-upper-auto-${i}`, kind: 'door', width: uTerModW,
                moduleType: 'storage', doorCount: 1, orientation: 'tertiary',
              }));
              if (startSide === 'left') {
                const uSecEndIdx = payload.upperModules.lastIndexOf(uSecModsInPayload[uSecModsInPayload.length - 1]);
                payload.upperModules.splice(uSecEndIdx + 1, 0, ...uTerMods);
              } else {
                const uSecStartIdx = payload.upperModules.indexOf(uSecModsInPayload[0]);
                payload.upperModules.splice(uSecStartIdx, 0, ...uTerMods);
              }
              payload.upperCount = payload.upperModules.length;
            }
          } else {
            // ★ prime line 반대편 — 기존 로직 (secondary와 평행)
            const terStartSide = startSide === 'left' ? 'right' : 'left';
            const terBlindMod = {
              id: 'blind-corner-ter-auto', kind: 'door', width: primeD,
              moduleType: 'blind', doorCount: 1, orientation: 'tertiary',
            };
            // 실측 기준: terW = primeD + 나머지 모듈
            const availableTerW = Math.max(0, terW - primeD);
            const terModCount = availableTerW > 0 ? Math.max(1, Math.round(availableTerW / 600)) : 0;
            const terModW = terModCount > 0 ? Math.round(availableTerW / terModCount) : 0;
            const terMods = Array.from({ length: terModCount }, (_, i) => ({
              id: `ter-auto-${i}`, kind: 'door', width: terModW,
              moduleType: 'storage', doorCount: 1, orientation: 'tertiary',
            }));
            if (terStartSide === 'left') {
              payload.lowerModules = [terBlindMod, ...terMods, ...payload.lowerModules];
            } else {
              payload.lowerModules = [...payload.lowerModules, terBlindMod, ...terMods];
            }
            payload.lowerCount = payload.lowerModules.length;
            // 상부장 tertiary (from prime)
            if (specs.secondaryUpperEnabled !== false) {
              if (!specs.upperTertiaryW) specs.upperTertiaryW = specs.upperSecondaryW || '1800';
            }
            if (specs.secondaryUpperEnabled !== false && specs.upperTertiaryW) {
              const uTerW = parseFloat(specs.upperTertiaryW) || terW;
              const uTerPrimeD = parseFloat(specs.upperPrimeD) || 295;
              const uTerBlindMod = {
                id: 'blind-corner-upper-ter-auto', kind: 'door', width: uTerPrimeD,
                moduleType: 'blind', doorCount: 1, orientation: 'tertiary',
              };
              const uAvailableTerW = Math.max(0, uTerW - uTerPrimeD);
              const uTerModCount = uAvailableTerW > 0 ? Math.max(1, Math.round(uAvailableTerW / 600)) : 0;
              const uTerModW = uTerModCount > 0 ? Math.round(uAvailableTerW / uTerModCount) : 0;
              const uTerMods = Array.from({ length: uTerModCount }, (_, i) => ({
                id: `ter-upper-auto-${i}`, kind: 'door', width: uTerModW,
                moduleType: 'storage', doorCount: 1, orientation: 'tertiary',
              }));
              if (terStartSide === 'left') {
                payload.upperModules = [uTerBlindMod, ...uTerMods, ...payload.upperModules];
              } else {
                payload.upperModules = [...payload.upperModules, uTerBlindMod, ...uTerMods];
              }
              payload.upperCount = payload.upperModules.length;
            }
          }
        }
      }

      /**
       * 실측/스펙 변경 시 3D iframe에 직접 postMessage (DOM 리렌더 없이)
       */
      window._syncPlannerState = _syncPlannerState; // 전역 노출 (ui-workspace.js에서 접근)
      function _syncPlannerState(item) {
        // iframe은 body 레벨 오버레이에 있음 (workspace 안에 없음)
        const overlay = document.getElementById('__planner-overlay-' + item.uniqueId);
        const iframe = overlay?.querySelector('iframe[data-planner]');
        if (!iframe || !iframe.contentWindow) return;
        const specs = item.specs || {};
        const lowerMods = (item.modules || []).filter(m => m.pos === 'lower' && !m.orientation);
        const upperMods = (item.modules || []).filter(m => m.pos === 'upper' && !m.orientation);
        const payload = {
          presetId: item.categoryId || 'sink',
          width: parseFloat(item.w) || 3000,
          height: parseFloat(item.h) || 2310,
          depth: parseFloat(item.d) || 600,
          lowerCount: lowerMods.length,
          upperCount: upperMods.length,
          lowerModules: lowerMods.map(m => ({
            id: String(m.id), kind: m.isDrawer ? 'drawer' : (m.type === 'open' ? 'open' : 'door'),
            width: parseFloat(m.w) || 600, moduleType: m.type === 'sink' ? 'sink' : m.type === 'cook' ? 'cook' : 'storage',
            doorCount: m.doorCount || (m.is2door ? 2 : 1),
          })),
          upperModules: upperMods.map(m => ({
            id: String(m.id), kind: m.type === 'open' ? 'open' : 'door',
            width: parseFloat(m.w) || 600, moduleType: m.type === 'hood' ? 'hood' : 'storage',
            doorCount: m.doorCount || (m.is2door ? 2 : 1),
          })),
          moldingH: parseFloat(specs.moldingH) || 60,
          toeKickH: parseFloat(specs.sinkLegHeight || specs.wardrobePedestalH) || 150,
          finishLeftW: specs.finishLeftType !== 'None' ? (parseFloat(specs.finishLeftWidth) || 60) : 0,
          finishRightW: specs.finishRightType !== 'None' ? (parseFloat(specs.finishRightWidth) || 60) : 0,
          material: specs.materialTone || 'cream',
          distributorStart: specs.distributorStart != null ? parseFloat(specs.distributorStart) : null,
          distributorEnd: specs.distributorEnd != null ? parseFloat(specs.distributorEnd) : null,
          ventStart: specs.ventStart != null ? parseFloat(specs.ventStart) : null,
          layoutShape: specs.lowerLayoutShape || specs.layoutShape || 'I',
          secondaryW: parseFloat(specs.lowerSecondaryW) || 0,
          secondaryD: parseFloat(specs.lowerSecondaryD) || parseFloat(item.d) || 0,
          tertiaryW: parseFloat(specs.lowerTertiaryW) || 0,
          tertiaryD: parseFloat(specs.lowerTertiaryD) || parseFloat(item.d) || 0,
          secondaryStartSide: specs.secondaryStartSide || undefined,
          tertiaryStartFrom: specs.tertiaryStartFrom || undefined,
        };
        // ㄱ자/ㄷ자: secondary 모듈을 lowerModules에 추가 (W10-1: 영속화 모듈 우선)
        _appendSecondaryModules(payload, specs, item.d, item.modules);
        // W6-7: V2 (3단계 워크플로우) 페이로드 동시 송신 — segments[] + modulesV2[]
        _appendV2Payload(payload);
        iframe.contentWindow.postMessage({ type: 'UPDATE_PLANNER', payload }, '*');
      }

      // W6-7: legacy payload → V2 (segments + modulesV2) 합성.
      // App.tsx 의 자동 migrate 와 동일 로직 — 명시적 송신으로 즉시 V2 인식.
      // ============================================================
      // W11-11: planner(mockup-shell/structure) 결과 → selectedItems.modules
      //
      // 플래너가 BOM 의 정본이다. "다음" 을 누르면 거기서 배치·자동계산한 결과가
      // 현재 품목의 modules 를 대체하고, 그 상태로 BOM 이 산출된다.
      // 이전에는 structures 가 localStorage 에만 남아 BOM 에 전혀 반영되지 않았다.
      //
      // 매핑은 전부 플래너 데이터에서 도출한다 (임의 규칙 없음):
      //   doorCount  = Σ areaTypes[i]==='door' ? (areaIs2D[i] ? 2 : 1) : 0
      //   isDrawer   = horizontalLayout==='doorTopDrawerBottom' && bottomType==='drawer'
      //   shelfCount = shelves.length
      //   pos        = section 'upper' → upper, 그 외(lower/tall/wardrobe) → lower
      //                ('tall' 이 lower 인 것은 _appendV2Payload 의 lowerSection 매핑의 역)
      //   type       = 항상 'storage' (아래 W11-12 참조)
      //   name       = 가전과 겹치면 '개수대'/'후드장' — 표시용 라벨일 뿐 BOM 규칙과 무관
      //
      // ★ W11-12: type 을 'hood'/'sink' 로 주면 안 된다.
      //   detaildesign 에서 'hood' 는 가구가 아니라 "후드가 들어갈 빈 영역" 이라
      //   extractors.js:132 가 상부장 목록에서 아예 걸러낸다
      //   (`m.pos === 'upper' && m.type !== 'hood'`).
      //   docs/design-rules/sink.md:37 "hood | 후드 영역 (도어 없음)",
      //   :27 "상부장: 후드 위치 제외", common.md:149 "선반 2개 (후드 제외)".
      //   → 후드와 겹친 상부 캐비닛을 'hood' 로 표시하면 몸통(측판/천판/지판/뒷판)까지
      //     BOM 에서 통째로 사라져 제작 누락이 된다.
      //
      //   플래너는 이미 이 문제를 다르게(정확하게) 풀고 있다.
      //   splitModuleByAppliance 가 가전 X 범위를 kind:'open' 으로 잘라
      //   areaTypes 에 'open' 을 넣으므로, 그 구간에는 도어가 잡히지 않는다.
      //   즉 "가전 영역은 도어 없음" 이 이미 areaTypes 로 표현돼 있고,
      //   캐비닛 몸통은 그대로 제작 대상이다. type 으로 또 표시할 필요가 없다.
      // ============================================================

      /** 플래너에서 캐비닛으로 취급하는 section. 나머지는 가전/마감재다. */
      const PLANNER_CABINET_SECTIONS = ['lower', 'upper', 'tall', 'wardrobe'];
      /** 캐비닛이 아니라 X 범위 판정에만 쓰는 가전 section. */
      const PLANNER_APPLIANCE_SECTIONS = ['sink', 'hood', 'dishwasher', 'fridge', 'refrigerator'];

      function _xOverlaps(a, b) {
        const a0 = Number(a.x) || 0;
        const a1 = a0 + (Number(a.W) || 0);
        const b0 = Number(b.x) || 0;
        const b1 = b0 + (Number(b.W) || 0);
        return a0 < b1 && b0 < a1;
      }

      /**
       * 플래너 사각형 하나를 셀(제작 모듈) 목록으로 편다.
       *
       * ★ 플래너의 사각형은 도면상의 구획이지 제작 단위가 아니다.
       *   autoCalcModule 이 distributeModules(segW) 로 셀을 나누고
       *   areaWidths[i] 에 각 셀의 폭을 넣는다. 그 셀 하나가 제작 모듈 하나다.
       *   (사각형 1개 = 모듈 1개로 보면 4미터짜리 캐비닛이 만들어져
       *    원판 1220×2440 으로 제작 자체가 불가능해진다.)
       *
       * @returns {Array<{w:number, kind:string, is2D:boolean, x:number}>}
       */
      function _cellsOfPlannerModule(m, s) {
        const W = Number(m.W) || 0;
        const baseX = Number(m.x) || 0;

        const widths = s && Array.isArray(s.areaWidths) ? s.areaWidths : [];
        const types = s && Array.isArray(s.areaTypes) ? s.areaTypes : [];
        const is2Ds = s && Array.isArray(s.areaIs2D) ? s.areaIs2D : [];

        // 자동계산 전이면 areaWidths 가 비어 있다 → 분배 정보가 없다.
        // 임의로 쪼개지 않고 통짜 1개로 두되, 호출부가 경고할 수 있게 flag 를 남긴다.
        if (widths.length === 0 || widths.length !== types.length) {
          return [{ w: W, kind: types[0] || 'door', is2D: !!is2Ds[0], x: baseX, noAutoCalc: true }];
        }

        const cells = [];
        let cursor = baseX;
        widths.forEach((w, i) => {
          const cw = Number(w) || 0;
          cells.push({ w: cw, kind: types[i] || 'door', is2D: !!is2Ds[i], x: cursor });
          cursor += cw;
        });
        return cells;
      }

      /**
       * CD-1: 플래너 H(전체 높이) → 몸통(카카스) 높이.
       *
       * 플래너 도면의 사각형 높이는 다리발·상판·상몰딩을 **포함한** 전체 높이다
       * (`mockup-structure.html:3138` 이 선반 계산에서 H 에서 다리발·몰딩을 빼는 것이 근거).
       * 반면 `extractors.js` 는 `mod.h` 를 몸통 높이로 그대로 쓴다.
       * 이 변환이 없으면 하부장 측판·뒷판·도어가 162mm, 상부장이 60mm 크게 재단된다.
       *
       * 규칙 출처
       *   하부장  몸통 = 전체 - 상판두께 - 다리발      (extractors.js 의 비-플래너 공식과 동일)
       *   상부장  몸통 = 전체 - 상몰딩                 (ACTIVE_RULES.md:203 과 같은 패턴)
       *   키큰장  몸통 = 전체 - 상몰딩 - 좌대           (docs/design-rules/sink.md §5)
       *
       * specs 는 설계별 값이며, 없으면 표준 기본값으로 떨어진다
       * (Jest 는 이 블록만 잘라 평가하므로 전역 상수를 참조할 수 없다).
       */
      function _carcassHeight(totalH, section, specs, parts) {
        const H = Number(totalH) || 0;
        if (H <= 0) return 0;
        const sp = specs || {};
        // CD-2: 플래너 '높이 구성' 패널에서 모듈마다 지정한 값이 있으면 그게 우선.
        // 없으면 설계 스펙, 그것도 없으면 표준 기본값 순으로 떨어진다.
        const p = parts || {};
        const n = (v, d) => {
          const x = parseFloat(v);
          return Number.isFinite(x) && x >= 0 ? x : d;
        };
        // 2026-09-17: 붙박이장 상몰딩은 **20** 이고 스펙 키도 다르다 (wardrobeMoldingH).
        //   일반 상몰딩 기본 60 으로 떨어지면 몸통이 40mm 짧아져 측판·뒷판·도어가 다 틀어진다.
        //   붙박이장이 플래너 결과를 못 받던 동안(CD-3) 이 자리가 한 번도 쓰이지 않아 드러나지 않았다.
        const molding = section === 'wardrobe'
          ? n(p.moldingH, n(sp.wardrobeMoldingH, 20))
          : n(p.moldingH, n(sp.moldingH, 60));
        if (section === 'upper') return Math.max(0, H - molding);
        if (section === 'tall' || section === 'wardrobe') {
          return Math.max(0, H - molding - n(p.pedestalH, n(sp.wardrobePedestal, 60)));
        }
        // lower
        return Math.max(
          0,
          H - n(p.topT, n(sp.topThickness, 12)) - n(p.legH, n(sp.sinkLegHeight, 150))
        );
      }

      /**
       * CD-2: 모듈에 실제로 적용된 높이 부위 값.
       * `_carcassHeight` 와 같은 우선순위(모듈 → 스펙 → 표준)를 쓴다.
       * 작업지시서·도면이 "이 몸통 높이가 어떻게 나왔는지" 설명할 수 있어야 하고,
       * CD-6 학습 데이터에도 그대로 쌓인다.
       */
      function _heightPartsOf(section, specs, parts) {
        const sp = specs || {};
        const p = parts || {};
        const n = (v, d) => {
          const x = parseFloat(v);
          return Number.isFinite(x) && x >= 0 ? x : d;
        };
        // 붙박이장 상몰딩은 20 · 스펙 키 wardrobeMoldingH — _carcassHeight 와 같은 규칙을 쓴다.
        const molding = section === 'wardrobe'
          ? n(p.moldingH, n(sp.wardrobeMoldingH, 20))
          : n(p.moldingH, n(sp.moldingH, 60));
        if (section === 'upper') return { moldingH: molding };
        if (section === 'tall' || section === 'wardrobe') {
          return { moldingH: molding, pedestalH: n(p.pedestalH, n(sp.wardrobePedestal, 60)) };
        }
        return {
          legH: n(p.legH, n(sp.sinkLegHeight, 150)),
          topT: n(p.topT, n(sp.topThickness, 12)),
        };
      }

      /**
       * CD-6: 자동계산 값 ↔ 사용자 최종값 차이 (학습 신호).
       *
       * "자동 모듈 분배 품질" 을 학습하려면 **자동계산이 뭘 냈는지**와
       * **사용자가 뭘로 바꿨는지**가 둘 다 있어야 한다. 지금까지는 최종값만
       * 남아서, 자동 분배가 어디서 왜 틀렸는지 알 방법이 없었다.
       *
       * 기준선(`_autoCalc`)은 플래너가 자동계산 직후에 심는다.
       * 기준선이 없으면(자동계산을 안 돌렸으면) null 을 돌려 "모름" 과
       * "안 고침" 을 구분한다 — 둘을 섞으면 학습이 오염된다.
       */
      function _plannerEditDiff(m, s) {
        const base = s && s._autoCalc;
        if (!base) return null;
        const arr = (a) => (Array.isArray(a) ? a : []);
        const same = (a, b) => JSON.stringify(arr(a)) === JSON.stringify(arr(b));
        const num = (v, d) => {
          const x = parseFloat(v);
          return Number.isFinite(x) ? x : d;
        };

        const final = {
          W: num(m.W, 0),
          H: num(m.H, 0),
          verticalCount: num(s.verticalCount, 0),
          areaWidths: arr(s.areaWidths).slice(),
          areaTypes: arr(s.areaTypes).slice(),
          areaIs2D: arr(s.areaIs2D).slice(),
          shelves: arr(s.shelves).slice(),
          drawerHeight: num(s.drawerHeight, 0),
          drawerCount: num(s.drawerCount, 1),
          horizontalLayout: s.horizontalLayout || '',
          bottomType: s.bottomType || '',
        };

        const edited = [];
        if (final.W !== base.W) edited.push('W');
        if (final.H !== base.H) edited.push('H');
        if (final.verticalCount !== base.verticalCount) edited.push('verticalCount');
        if (!same(final.areaWidths, base.areaWidths)) edited.push('areaWidths');
        if (!same(final.areaTypes, base.areaTypes)) edited.push('areaTypes');
        if (!same(final.areaIs2D, base.areaIs2D)) edited.push('areaIs2D');
        if (!same(final.shelves, base.shelves)) edited.push('shelves');
        if (final.drawerHeight !== base.drawerHeight) edited.push('drawerHeight');
        if (final.drawerCount !== base.drawerCount) edited.push('drawerCount');
        if (final.horizontalLayout !== base.horizontalLayout) edited.push('horizontalLayout');
        if (final.bottomType !== base.bottomType) edited.push('bottomType');

        return { edited, auto: base, final };
      }

      /**
       * CD-6: 설계 1건의 플래너 학습 기록.
       * 설계 스냅샷 payload 에 `_learning` 으로 실려 서버에 그대로 쌓인다.
       * `_` 로 시작하는 키라 content_hash 에서 제외되므로,
       * 이 값이 달라져도 같은 설계의 rev 를 늘리지 않는다.
       */
      function _buildPlannerLearning(payload) {
        const src = Array.isArray(payload.modules) ? payload.modules : [];
        const structures = payload.structures || {};
        const modules = [];
        let withBaseline = 0;
        let editedCount = 0;
        const editedFields = {};

        src.forEach((m) => {
          if (!PLANNER_CABINET_SECTIONS.includes(m.section)) return;
          const s = structures[m.id] || null;
          const diff = _plannerEditDiff(m, s);
          if (!diff) {
            modules.push({ id: m.id, section: m.section, hasBaseline: false });
            return;
          }
          withBaseline++;
          if (diff.edited.length > 0) {
            editedCount++;
            diff.edited.forEach((f) => { editedFields[f] = (editedFields[f] || 0) + 1; });
          }
          modules.push({
            id: m.id,
            section: m.section,
            hasBaseline: true,
            isFixed: !!m.isFixed,
            edited: diff.edited,
            auto: diff.auto,
            final: diff.final,
          });
        });

        return {
          source: 'planner',
          moduleCount: modules.length,
          withBaseline,
          editedCount,
          editedFields,
        modules,
        };
      }

      /**
       * PLANNER_DONE payload → detaildesign 모듈 배열.
       * @param {object} payload  플래너가 보낸 상태
       * @param {object} [specs]  대상 품목의 specs — 전체높이→몸통 변환에 쓴다
       * @returns {{modules: Array, warnings: string[]}}
       */
      /**
       * W12-61: 플래너 마감재 구분 → BOM 자재명 구분.
       *
       * 플래너는 소문자 섹션('molding'/'filler')을, 자재 산출은 스펙 표기
       * ('Molding'/'Filler')를 쓴다. 미지정(옛 저장 설계)이면 휠라로 떨어진다 —
       * 멍 폭에 마감재 자리 60 은 이미 들어가 있어서, 안 내면 그 자리가
       * 멍가림판 MDF 로 발주된다 (corner.md §3.3).
       */
      function _blindFinishType(finish) {
        return (finish && finish.section) === 'molding' ? 'Molding' : 'Filler';
      }

      /**
       * 2026-09-15: 서랍 규칙 블록 — 플래너 구조 `s.drawer` {rail, sakuri, boxT} 를 정규화해 BOM 모듈 `drawer` 로 넘긴다.
       *   rail 'under'(댐핑 언더레일) | 'ball'(댐핑 볼레일) · sakuri 측판 사쿠리 · boxT 서랍 자재 두께 15/18 (0 = 몸통 두께).
       *   옛 평면 필드 s.drawerRail 도 읽는다. extractors.js drawerRulesOf 가 같은 모양을 받는다.
       */
      function _drawerRulesOf(s) {
        const d = (s && s.drawer) || {};
        const railRaw = d.rail || (s && s.drawerRail);
        const GRADES = ['small', 'medium', 'large'];
        // 2026-09-16: 전면 등급 — 서랍마다 소·중·대, 도어는 따로. 모르는 값은 버리고 규칙 파일 기본값에 맡긴다.
        const grades = Array.isArray(d.grades)
          ? d.grades.map((g) => (GRADES.includes(g) ? g : null)).filter((g) => g !== null)
          : [];
        const out = {
          rail: railRaw === 'ball' ? 'ball' : 'under',
          sakuri: !!d.sakuri,
          boxT: [15, 18].includes(Number(d.boxT)) ? Number(d.boxT) : 0,
        };
        if (grades.length) out.grades = grades;
        if (GRADES.includes(d.doorGrade)) out.doorGrade = d.doorGrade;
        return out;
      }

      /** 붙박이장 규칙 파일 (detaildesign.html 이 extractors.js 앞에 싣는다). */
      function _wardrobeRules() {
        if (typeof DadamWardrobeRules !== 'undefined') return DadamWardrobeRules;
        return (typeof window !== 'undefined' && window.DadamWardrobeRules) || null;
      }

      /**
       * 붙박이장 통 하나를 **옛 모듈 필드**로 옮긴다 — extractWardrobe 가 읽는 이름들.
       *
       * 통 구조 정본은 규칙 파일(bom-wardrobe-rules.js)이다. 여기서는 그 결과(carcasses·cells)를
       * 옛 이름에 맞춰 적을 뿐이다. `moduleType` 과 몸통 수는 반드시 맞아야 한다 —
       * extractWardrobe 가 `isDivided = moduleType === 'short' || 'shelf'` 로 상·하 두 벌을 낸다.
       *
       * 새 부재(칸막이·선반·옷봉)는 `wardrobe` 블록으로 같이 넘긴다.
       */
      function _wardrobeFieldsOf(m, s, cellW, bodyH, presetFallback) {
        const WR = _wardrobeRules();
        if (!WR) return null;
        const block = WR.normalizeBlock(s && s.wardrobe);
        const L = WR.layoutWardrobeModule({
          W: Number(cellW) || 0,
          D: Number(m.D) || 0,
          bodyH: Number(bodyH) || 0,
          preset: block.preset || presetFallback,
          cells: block.cells,
          drawers: block.drawers,
          externalDrawer: block.externalDrawer,
        });
        const cabs = WR.cabinetsOf(L);
        if (!cabs.length) return null;
        const divided = cabs.length > 1;
        const nShelf = (car) => (car.shelves || []).length;
        const nRod = (car) => (car.rods || []).length;
        const out = {
          moduleType: L.moduleType || (divided ? 'short' : 'long'),
          isDivided: divided,
          drawerCount: L.drawers,
          isExternalDrawer: L.external,
          shelfCount: divided ? 0 : nShelf(cabs[0]),
          shelfCountUpper: divided ? nShelf(cabs[1]) : 0,
          shelfCountLower: divided ? nShelf(cabs[0]) : 0,
          rodCountUpper: divided ? nRod(cabs[1]) : nRod(cabs[0]),
          rodCountLower: divided ? nRod(cabs[0]) : 0,
          // 통 구조 — BOM 이 칸막이·선반·옷봉을 이 블록으로 낸다
          wardrobe: { preset: L.preset, drawers: L.drawers, externalDrawer: L.external },
        };
        if (block.cells) out.wardrobe.cells = block.cells;
        if (divided) { out.lowerH = cabs[0].h; out.upperH = cabs[1].h; }
        return out;
      }

      function _convertPlannerModules(payload, specs) {
        const src = Array.isArray(payload.modules) ? payload.modules : [];
        const structures = payload.structures || {};
        const appliances = src.filter((m) => PLANNER_APPLIANCE_SECTIONS.includes(m.section));
        const sinkRanges = appliances.filter((m) => m.section === 'sink');
        const hoodRanges = appliances.filter((m) => m.section === 'hood');

        const out = [];
        const warnings = [];
        let blankDropped = 0;
        // 2026-09-17: 붙박이장 통 번호 — 구조를 고르지 않은 통은 **번호로** 기본형 프리셋이 정해진다
        //   (플래너 wardrobeIndexOf 와 같은 규칙: x 순서).
        const wardrobeOrder = src
          .filter((x) => x.section === 'wardrobe')
          .sort((a, b) => (Number(a.x) || 0) - (Number(b.x) || 0))
          .map((x) => x.id);
        // W12-53: 멍장 id 는 extractors.js 가 알아보는 이름이어야 한다.
        // ㄷ자는 한 단에 둘까지 나오므로 두 번째부터 번호를 붙인다.
        const blindSeq = { lower: 0, upper: 0 };

        src.forEach((m) => {
          if (!PLANNER_CABINET_SECTIONS.includes(m.section)) return;

          const s = structures[m.id] || null;
          // 2026-09-17: 붙박이장은 pos 'wardrobe' 다 — extractWardrobe 가 그 pos 만 본다.
          //   'lower' 로 넘기면 싱크 하부장 규칙으로 산출돼 통째로 어긋난다.
          const pos = m.section === 'upper' ? 'upper' : m.section === 'wardrobe' ? 'wardrobe' : 'lower';
          // 플래너 자동계산은 하부 모듈을 doorTopDrawerBottom(하부 서랍 1단)으로 만든다
          const drawerAtBottom = !!(s && s.horizontalLayout === 'doorTopDrawerBottom' && s.bottomType === 'drawer');
          // CD-2: 플래너 '분할' 패널에서 지정한 서랍 단수. 미지정이면 1단.
          const rawDrawerCount = parseInt(s && s.drawerCount, 10);
          // 2026-09-15: 최대 4단 (bom-drawer-rules.js MAX_COUNT) — 5 는 규칙 밖.
          const drawerCount = Number.isFinite(rawDrawerCount) && rawDrawerCount > 0
            ? Math.min(4, rawDrawerCount)
            : 1;
          const shelfCount = s && Array.isArray(s.shelves) ? s.shelves.length : 0;

          // W12-53: 멍장은 셀로 쪼개지 않는다.
          //
          // 자동계산은 멍장 정면을 [먹장 = 멍][도어] 두 칸으로 적는다. 셀 규칙을
          // 그대로 태우면 먹장 칸이 '350mm 미만 잔여' 로 버려지고, 카카스가 도어
          // 폭짜리 장으로 줄어든다 — 1106 짜리 코너장이 406 으로 발주된다.
          // 멍장은 카카스 하나에 도어 한 장이 달린 **한 모듈**이다.
          //
          // id 를 `corner-blind-{pos}` 로 맞추는 이유: extractors.js 가 그 id 로
          // 멍장을 알아보고 도어를 doorW 기준으로, 멍가림판을 2.7T 로 낸다 (W10-4).
          if (m.blind) {
            // W12-64: 멍장은 셀로 안 쪼개져 아래 "셀 폭 합" 검사를 지나친다. 카카스 폭이
            //   부품(멍 + 도어)과 어긋나면 상자에 안 들어가는 자재가 나가므로 여기서 잡는다.
            //   (코너 끝에 마감재를 붙이면 멍장 폭이 60 깎이던 결함이 이 그물을 빠져나갔다)
            const partsW = (Number(m.blind.zoneW) || 0) + (Number(m.blind.doorW) || 0);
            if (partsW > 0 && Math.abs((Number(m.W) || 0) - partsW) > 1) {
              warnings.push(
                `${m.id}: 멍장 폭 ${Math.round(m.W)}mm 이 멍 ${m.blind.zoneW} + 도어 ${m.blind.doorW} = ${partsW}mm 과 다릅니다 — 자동계산을 다시 실행하세요`
              );
            }
            const seq = blindSeq[pos]++;
            out.push({
              id: seq === 0 ? `corner-blind-${pos}` : `corner-blind-${pos}-${seq + 1}`,
              type: 'storage',
              name: 'LT망장',                 // corner.md §3.8 — 코드 호환용 명칭
              pos,
              w: Number(m.W) || 0,            // 카카스 폭이다. 도어 폭이 아니다
              h: _carcassHeight(m.H, m.section, specs, s),
              totalH: Number(m.H) || 0,
              heightParts: _heightPartsOf(m.section, specs, s),
              d: Number(m.D) || 0,
              doorCount: 1,
              is2door: false,
              doorW: Number(m.blind.doorW) || 0,       // 도어는 이 폭으로 발주된다
              blindZoneW: Number(m.blind.zoneW) || 0,  // 멍 폭 (목대 15 포함 — 재단은 extractors 가 뺀다)
              // W12-61: 멍판 마감재 — 라인 마감을 따라온 종류와 **재단** 폭.
              //   재단(100)은 멍 공식의 자리(60)보다 넓다. 멍가림판 위를 덮기 때문이다.
              blindFinishType: m.blind.ep ? 'None' : _blindFinishType(m.blind.finish),
              blindFinishW: m.blind.ep ? 0 : (Number(m.blind.finish && m.blind.finish.partW) || 0),
              // W12-65: 키큰장 멍장 — 멍 구간을 2.7T 가림판이 아니라 **멍판 EP 18T 한 장**으로 덮는다.
              //   가리는 면은 하나라 단(3개) 중 첫 단에서만 내고, 높이는 장 전체(좌대 포함)다.
              //   마감재 100 은 없다 — EP 가 이미 마감된 판이다. 경첩목대는 단마다 그대로.
              blindKind: m.blind.ep ? 'tall' : 'std',
              blindEpOnce: !!(m.blind.ep && (m.blind.tier || 0) === 0),
              blindEpW: m.blind.ep ? Number(m.blind.ep.W) || 0 : 0,
              blindEpH: m.blind.ep ? Number(m.blind.ep.H) || 0 : 0,
              isDrawer: false,
              drawerCount: 0,
              isOpen: false,
              shelfCount,
              isEL: false,
              isFixed: !!m.isFixed,
              _x: Number(m.x) || 0,
            });
            return;
          }

          const cells = _cellsOfPlannerModule(m, s);
          if (cells.length === 1 && cells[0].noAutoCalc) {
            // 키큰장은 세로 스택(단)이라 자동계산이 셀(areaWidths)을 나누지 않는다 —
            // 단 하나가 모듈 폭 그대로 한 장(통짜)인 것이 **정상**이다. 여기서 경고하면
            // 자동계산을 돌려도 사라지지 않는 헛경고가 된다 (사용자 결정 2026-09-15).
            // 표시 section(sink·hood)은 PLANNER_CABINET_SECTIONS 에 없어 여기까지 오지 않는다.
            if (m.section !== 'tall') {
              warnings.push(`${m.id}: 자동계산 전이라 ${cells[0].w}mm 통짜로 잡혔습니다`);
            }
          } else {
            // 셀 폭 합이 사각형 폭과 크게 다르면 분배 정보가 낡은 것이다
            // (배치를 고친 뒤 자동계산을 다시 돌리지 않은 경우).
            // 그대로 두면 BOM 이 실제보다 좁게/넓게 나온다.
            const sum = cells.reduce((a, c) => a + (Number(c.w) || 0), 0);
            const W = Number(m.W) || 0;
            if (W > 0 && Math.abs(sum - W) > 10) {
              warnings.push(
                `${m.id}: 셀 폭 합 ${sum}mm 이 모듈 폭 ${W}mm 과 다릅니다 — 자동계산을 다시 실행하세요`
              );
            }
          }

          cells.forEach((c, i) => {
            // blank = 350mm 미만 잔여 조각 (MASTER_RULES.BLANK_THRESHOLD).
            // 캐비닛으로 제작하지 않고 휠라/마감으로 처리되므로 모듈에서 뺀다.
            if (c.kind === 'blank' || c.w <= 0) {
              if (c.kind === 'blank') blankDropped++;
              return;
            }
            // W12-58: 멍 칸이 여기까지 오면 멍장으로 못 알아본 것이다 (위 m.blind
            //   분기가 잡았어야 한다). 그대로 두면 가려진 구간이 도어 달린 장으로
            //   발주된다 — 캐비닛으로 만들지 않고 알린다.
            // W12-61: 멍판 마감재 칸(blindfin)도 같이 막는다 — 멍장 안에서만 뜻이 있는
            //   파생 칸이라, 여기까지 오면 멍장으로 못 알아본 것이다.
            if (c.kind === 'blind' || c.kind === 'blindfin') {
              warnings.push(`${m.id}: 멍 구간을 멍장으로 인식하지 못했습니다 — 자동계산을 다시 실행하세요`);
              return;
            }

            const isOpen = c.kind === 'open';

            // type 은 항상 'storage' — 'hood' 로 주면 extractors.js:132 가
            // 그 캐비닛을 BOM 에서 통째로 제외한다 (W11-12).
            // CD-3: 키큰장은 정체성을 남긴다. pos 는 'lower' 가 맞다
            // (docs/design-rules/sink.md §3 — 키큰장은 하부 라인에 배치된다).
            // type 이 'storage' 로 뭉개지면 BOM·정면도에서 일반 하부장과 구분되지 않는다.
            const isTall = m.section === 'tall';
            const isWardrobe = m.section === 'wardrobe';
            // 붙박이장 통 이름은 옛 화면과 같은 "N번" 이다 (extractWardrobe 기본 이름과 같은 모양).
            let name = isWardrobe ? `${wardrobeOrder.indexOf(m.id) + 1}번`
              : isTall ? '키큰장' : pos === 'upper' ? '상부장' : '하부장';
            const cellRect = { x: c.x, W: c.w };
            if (isWardrobe) {
              // 붙박이장은 싱크 라인이 아니다 — 개수대·후드와 겹칠 일이 없다
            } else if (pos === 'lower' && sinkRanges.some((r) => _xOverlaps(cellRect, r))) {
              name = '개수대';
            } else if (pos === 'upper' && hoodRanges.some((r) => _xOverlaps(cellRect, r))) {
              name = '후드장';
            }

            out.push({
              id: `planner-${m.id}-${i}`,
              // 'hood' 로 주면 extractors.js 가 그 캐비닛을 BOM 에서 통째로
              // 제외한다 (W11-12). 'tall' 은 제외 대상이 아니라 안전하다.
              type: isWardrobe ? 'wardrobe' : isTall ? 'tall' : 'storage',
              name,
              pos,
              w: c.w,
              // CD-1: 플래너 H 는 전체 높이 → 몸통 높이로 변환해서 넘긴다
              // CD-2: 모듈별 높이 구성(다리발·상판·상몰딩·좌대)이 있으면 그것을 쓴다
              h: _carcassHeight(m.H, m.section, specs, s),
              totalH: Number(m.H) || 0, // 전체 높이도 보존 — 도면·검증·학습 데이터용
              // 부위별 값도 함께 넘긴다 — 작업지시서·도면과 CD-6 학습 데이터에 쓴다
              heightParts: _heightPartsOf(m.section, specs, s),
              d: Number(m.D) || 0,
              doorCount: isOpen ? 0 : c.is2D ? 2 : 1,
              is2door: !!c.is2D,
              // 오픈 구간은 가전 자리라 서랍을 넣지 않는다
              isDrawer: !isOpen && drawerAtBottom,
              // CD-2: 플래너에서 정한 서랍 단수를 그대로 쓴다 (예전엔 항상 1단).
              // 1단마다 전후판 2·측판 2·밑판 1 이 산출되므로 BOM 수량이 달라진다.
              drawerCount: !isOpen && drawerAtBottom ? drawerCount : 0,
              isOpen,
              shelfCount,
              isEL: false,
              isFixed: false,
              _x: c.x,
            });
            // 2026-09-15: 서랍 규칙(레일·사쿠리·서랍 자재 두께·전면 등급)은 서랍이 있는 셀에만 — 없는 모듈의 payload 는 예전과 같다.
            if (!isOpen && drawerAtBottom) out[out.length - 1].drawer = _drawerRulesOf(s);
            // 2026-09-16: 전면 배분식의 기준높이는 **배치(영역) 높이**다 — 플래너가 payload 에 실어 보낸다.
            //   없으면 BOM 이 totalH(모듈 전체 높이) 로 떨어진다. 옛 저장 설계가 그 경우다.
            if (Number(m.areaH) > 0) out[out.length - 1].areaH = Number(m.areaH);
            // 2026-09-17: 붙박이장 통 구조 — 몸통 수·선반·옷봉·서랍을 옛 필드로 옮기고 블록도 같이 싣는다.
            if (isWardrobe) {
              // 2026-09-17: 거울은 통마다 (옛 화면 hasMirror). 아직 부재로 나오지 않지만 값은 나른다.
              if (m.hasMirror) out[out.length - 1].hasMirror = true;
              const WR = _wardrobeRules();
              const fb = WR ? WR.samplePresetFor(wardrobeOrder.indexOf(m.id), wardrobeOrder.length) : null;
              const wf = _wardrobeFieldsOf(m, s, c.w, _carcassHeight(m.H, m.section, specs, s), fb);
              if (wf) Object.assign(out[out.length - 1], wf);
              else warnings.push(`${m.id}: 붙박이장 통 구조를 읽지 못했습니다 — 구조 단계에서 통 구조를 고르세요`);
            }
          });
        });

        // 2026-09-17: 커튼박스는 품목 스펙이다 (배치 공간에서 정하고 플래너가 payload 에 싣는다).
        //   옛 붙박이장 화면이 하던 자리 — 지금은 자재로 산출되지 않지만 값은 스펙에 남긴다.
        const curtain = src.find((m) => m.section === 'wardrobe'
          && (Number(m.curtainBoxW) > 0 || Number(m.curtainBoxH) > 0));
        if (curtain && specs) {
          if (Number(curtain.curtainBoxW) > 0) specs.curtainBoxW = Number(curtain.curtainBoxW);
          if (Number(curtain.curtainBoxH) > 0) specs.curtainBoxH = Number(curtain.curtainBoxH);
        }

        if (blankDropped > 0) {
          warnings.push(`350mm 미만 잔여 ${blankDropped}칸은 캐비닛에서 제외했습니다 (휠라/마감 처리)`);
        }

        // CD-3: 도면에 마감재를 붙였는데 스펙엔 '없음' 이면 BOM 에 안 잡힌다.
        // EP·몰딩·휠라 자재는 모듈이 아니라 specs.finishLeft/RightType 에서 나오므로,
        // 플래너에 그린 것만으로는 발주되지 않는다. 조용히 빠지지 않게 알린다.
        // W12-62: 비움은 자재가 아니다 — 자리만 비워 둔 것이라 스펙과 무관하다.
        //   세면 "마감재를 그렸는데 발주가 안 된다" 는 헛경고가 뜬다.
        const plannerFinishings = src.reduce(
          (n, m) => n + (m.finishings || []).filter((f) => (f && f.section) !== 'gap').length, 0);
        if (plannerFinishings > 0) {
          const sp = specs || {};
          const noneL = !sp.finishLeftType || sp.finishLeftType === 'None';
          const noneR = !sp.finishRightType || sp.finishRightType === 'None';
          if (noneL && noneR) {
            warnings.push(
              `도면에 마감재 ${plannerFinishings}개가 있지만 좌·우 마감이 '없음' 으로 설정돼 ` +
                `자재에 반영되지 않습니다 — 스펙에서 몰딩/휠라/EP 를 지정하세요`
            );
          }
        }

        // 배치 순서(x)대로 정렬 — 정면도/BOM 라벨 순서를 도면과 맞춘다
        out.sort((a, b) => (a.pos === b.pos ? a._x - b._x : a.pos === 'upper' ? -1 : 1));
        return { modules: out, warnings };
      }

      // W11-14: 툴바 "BOM 산출" 이 플래너에 현재 상태를 요청할 때 쓰는 대기 슬롯.
      let _pendingPlannerRequest = null;

      /** 현재 열려 있는 planner iframe (없으면 null). */
      function _plannerFrame() {
        const overlay = document.querySelector('[id^="__planner-overlay-"]');
        return overlay ? overlay.querySelector('iframe') : null;
      }

      /**
       * 플래너에 현재 배치+구조를 요청한다.
       * 플래너가 없거나 응답하지 않으면 null 로 끝난다 (BOM 은 기존 modules 로 진행).
       */
      function _awaitPlannerState(timeoutMs) {
        const frame = _plannerFrame();
        if (!frame || !frame.contentWindow) return Promise.resolve(null);
        return new Promise((resolve) => {
          let done = false;
          const finish = (v) => {
            if (done) return;
            done = true;
            _pendingPlannerRequest = null;
            resolve(v);
          };
          _pendingPlannerRequest = finish;
          try {
            frame.contentWindow.postMessage({ type: 'REQUEST_PLANNER_STATE' }, '*');
          } catch (e) {
            finish(null);
            return;
          }
          setTimeout(() => finish(null), timeoutMs || 1500);
        });
      }

      /**
       * 툴바 "BOM 산출" — 플래너가 열려 있으면 그 상태를 먼저 가져와 반영한 뒤 산출한다.
       * "다음" 을 누르지 않아도 BOM 으로 갈 수 있어야 하기 때문이다.
       */
      async function proceedToBOMWithPlanner() {
        try {
          const state = await _awaitPlannerState(1500);
          if (state) _applyPlannerResult(state);
        } catch (err) {
          console.error('[Planner] 결과 반영 실패:', err);
          alert('플래너 결과를 반영하지 못했습니다.\n\n' + err.message);
          return;
        }
        if (typeof proceedToBOM === 'function') proceedToBOM();
      }

      /** PLANNER_DONE 을 현재 품목에 반영한다. */
      function _applyPlannerResult(payload) {
        const item = _currentStep2Item();
        // 2026-09-18: 예전 문구는 "대상 품목을 찾을 수 없습니다." 뿐이었다. 원인은 거의 늘
        //   **품목이 0개**인 것인데, 그 말로는 무엇을 해야 하는지 알 수 없어 BOM 앞에서 막힌 것처럼 보였다.
        //   자재표는 품목에 붙는다 — 품목이 없으면 배치·구조를 다 해도 산출할 대상이 없다.
        if (!item) {
          throw new Error(
            '품목이 없습니다 — 자재표는 품목에 붙습니다.\n\n' +
              '플래너 상단 \'품목\' 드롭다운에서 붙박이장(또는 만들 품목)을 추가한 뒤 다시 눌러 주세요.\n' +
              '(좌측 아이콘으로 놓는 배치 사각형은 품목이 아닙니다)'
          );
        }

        // CD-3: 플래너가 표현하지 못하는 카테고리에는 결과를 적용하지 않는다.
        //
        // 2026-09-17: 붙박이장은 풀렸다 — 브리지가 통 구조를 pos 'wardrobe' 모듈로 옮기고
        // extractWardrobe 가 칸막이·선반·옷봉까지 낸다 (wardrobe.md §1.4).
        // 냉장고장만 남았다 — 모듈 type 분기를 플래너가 만들지 못한다 (extractFridge 는 mod.type 만 본다).
        //
        // 예전엔 카테고리를 안 보고 item.modules 를 통째로 교체해서, 붙박이장 품목에 플래너
        // 결과가 들어오면 기존 모듈이 지워지고 BOM 이 **조용히 0건**이 됐다. 그 사고는 아래
        // 두 가드(통 0개 · 카테고리 어긋남)가 이어서 막는다.
        if (_plannerResultBlocked(item)) {
          throw new Error(
            `${item.labelName || item.name} 은(는) 플래너로 설계하지 않습니다.\n\n` +
              '냉장고장은 전용 화면에서 모듈을 구성해 주세요.\n' +
              '(플래너 결과를 적용하면 기존 모듈이 지워지고 자재가 산출되지 않습니다)'
          );
        }

        // CD-1: specs 를 넘겨야 전체높이→몸통 변환이 설계별 값(다리발·상판·상몰딩)을 쓴다
        const { modules, warnings } = _convertPlannerModules(payload, item.specs);
        // 2026-09-17: 차단(CD-3)을 풀면서 그 차단이 막던 사고를 여기서 막는다 —
        //   붙박이장 품목에 붙박이장 통이 하나도 없는 결과가 들어오면 기존 모듈이 지워지고
        //   extractWardrobe 가 pos 'wardrobe' 를 못 찾아 **자재표가 조용히 0건**이 된다.
        if (item.categoryId === 'wardrobe' && !modules.some((x) => x.pos === 'wardrobe')) {
          throw new Error(
            '플래너 결과에 붙박이장 통이 없습니다.\n\n' +
              '1.배치 화면에서 붙박이장을 놓고, 2.구조 화면에서 자동계산으로 통을 세워 주세요.\n' +
              '(그대로 적용하면 기존 모듈이 지워지고 자재가 산출되지 않습니다)'
          );
        }
        // 2026-09-18: 반대 방향도 막는다 — **붙박이장만 그렸는데 대상 품목이 붙박이장이 아닌** 경우.
        //   `_currentStep2Item()` 은 currentItemId 가 없으면 selectedItems[0] 로 떨어진다. 품목이
        //   싱크대 + 붙박이장 둘인데 붙박이장이 뒤에 있으면 붙박이장 통이 **싱크대 품목**에 쓰인다.
        //   extractSink 는 pos 'wardrobe' 를 보지 않으므로 그 품목의 자재표가 조용히 0건이 된다.
        //   (하부장·상부장은 아일랜드·신발장 등 여러 카테고리가 같이 쓰므로 그쪽은 판정하지 않는다.)
        if (item.categoryId !== 'wardrobe' && modules.length > 0
            && modules.every((x) => x.pos === 'wardrobe')) {
          throw new Error(
            `플래너에는 붙박이장만 있는데 지금 품목은 ${item.labelName || item.name || '다른 품목'} 입니다.\n\n` +
              '상단 품목 드롭다운에서 붙박이장 품목을 고른 뒤 다시 눌러 주세요.\n' +
              '(그대로 적용하면 이 품목의 자재가 산출되지 않습니다)'
          );
        }
        if (modules.length === 0) {
          const placed = (payload.modules || []).length;
          throw new Error(
            placed === 0
              ? '플래너에 배치된 모듈이 없습니다.\n\n1.배치 화면에서 하부장·상부장을 먼저 놓아 주세요.'
              : `배치된 ${placed}개 중 제작 대상 캐비닛이 없습니다.\n\n` +
                `하부장·상부장·키큰장만 자재로 산출됩니다 (분배기·후드·냉장고 등 가전과 마감재는 제외).`
          );
        }

        // 자동계산을 안 돌리면 사각형이 통짜 1개로 잡혀 BOM 이 실제와 크게 달라진다.
        // 조용히 넘기지 않고 진행 여부를 묻는다.
        if (payload.hasStructures === false) {
          const ok = window.confirm(
            '자동계산을 실행하지 않았습니다.\n\n' +
              '구조 화면에서 [⚡ 세트 일괄 자동계산] 을 먼저 돌리면\n' +
              '도어 개수·서랍·선반이 모듈별로 반영됩니다.\n\n' +
              '지금 상태로 BOM 을 산출할까요? (배치된 사각형이 통째로 1개 모듈이 됩니다)'
          );
          if (!ok) throw new Error('자동계산 후 다시 시도해 주세요.');
        }

        const before = (item.modules || []).length;
        item.modules = modules;
        item.specs = item.specs || {};
        item.specs.autoCalculated = true;

        // CD-6: 자동계산이 낸 값과 사용자가 고친 값을 함께 남긴다.
        // 설계 스냅샷 payload 를 타고 서버에 쌓여 "자동 분배 품질" 학습의 재료가 된다.
        // '_' 로 시작하는 키라 content_hash 에서 제외되어 rev 를 늘리지 않는다.
        item._learning = Object.assign({}, item._learning, {
          planner: _buildPlannerLearning(payload),
        });

        const upper = modules.filter((m) => m.pos === 'upper').length;
        const lower = modules.filter((m) => m.pos === 'lower').length;
        const doors = modules.reduce((s, m) => s + (m.doorCount || 0), 0);

        dlog('[Planner→BOM] 모듈 반영', { item: item.labelName, before, after: modules.length, upper, lower });
        if (warnings.length) console.warn('[Planner→BOM] 경고:', warnings.join(' / '));
        // 2026-09-16: 콘솔·토스트만으로는 못 본다 — 화면에 남는 배너 (+ BOM 버튼·3번 점 배지).
        // 배너는 부가 UI 다 — 못 그려도 반영·산출을 막지 않는다 (바깥 try 가 alert 로 바꿔 버리므로 여기서 삼킨다).
        try {
          _showBridgeWarnings(warnings, _plannerScopeParams(item));
        } catch (e) {
          console.error('[Planner→BOM] 경고 배너 표시 실패:', e);
        }

        // 무엇이 반영됐는지 화면에서 보이게 한다 — 실패/이상을 조용히 넘기지 않기 위해.
        _showPlannerSummary(
          `모듈 ${modules.length}개 반영 (상부 ${upper} · 하부 ${lower} · 도어 ${doors}장)`,
          warnings
        );

        if (typeof updateUI === 'function') updateUI();
      }

      /** 반영 결과 요약 배너. ai-design-report.js 의 showToast 가 있으면 그것을 쓴다. */
      function _showPlannerSummary(message, warnings) {
        const full = warnings && warnings.length ? `${message}\n⚠ ${warnings.join('\n⚠ ')}` : message;
        if (typeof showToast === 'function') {
          showToast(full);
          return;
        }
        const el = document.createElement('div');
        el.setAttribute('role', 'status');
        el.style.cssText =
          'position:fixed;left:50%;transform:translateX(-50%);bottom:24px;z-index:200;' +
          'background:rgba(28,26,24,.94);color:#f5f0eb;padding:12px 18px;border-radius:10px;' +
          'font-size:13px;line-height:1.6;white-space:pre-line;max-width:80vw;box-shadow:0 4px 16px rgba(0,0,0,.3)';
        el.textContent = full;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), warnings && warnings.length ? 9000 : 4000);
      }

      // ============================================================
      // 2026-09-16: 플래너 → 상세설계 브리지 경고 배너 (pbw)
      //
      // _convertPlannerModules 가 내는 경고(자동계산 전 통짜 · 멍 구간 미인식 ·
      // 350mm 미만 잔여 제외 …)는 console.warn 과 몇 초 뒤 사라지는 토스트로만 나가
      // 사용자가 사실상 못 봤다. BOM 이 실제와 달라지는 원인이므로 화면에 남는
      // 배너로 보여 준다. console.warn 은 그대로 둔다.
      //
      //  - 컨테이너 #plannerBridgeWarnings 는 JS 로 만든다 (detaildesign.html 은 손대지 않는다).
      //    Step 2(planner/native 모드)에서는 #step2Toolbar 형제로 두고 툴바 바로 아래에
      //    fixed 로 띄운다 (overlay z-index:100 위). PLANNER_DONE / 툴바 "BOM 산출" 은
      //    반영 직후 곧바로 Step 3 로 가므로 Step 2 에만 두면 결국 못 본다 —
      //    Step 3 에서는 #step3-content 의 보고서(#step3-report-area) 위로 옮긴다.
      //  - 심각도: 자동계산을 다시 돌려야 없어지는 것(자동계산 전 통짜 · 멍 구간 ·
      //    멍장 폭 / 셀 폭 불일치) = 경고, 그 밖(350mm 미만 제외 · 마감 스펙) = 안내.
      //  - 닫기(✕)는 설계+품목 단위(_plannerScopeParams) 로 sessionStorage 에 경고 묶음의
      //    서명을 기억한다. 경고 내용이 바뀌면 서명이 달라져 다시 뜬다.
      //  - 건수는 툴바 "BOM 산출" 버튼과 스테퍼 3번 점에 배지로 미러한다.
      //
      // __tests__/designui-bridge-warnings.test.js 가 아래 PBW_ID 상수부터 _appendV2Payload
      // 직전까지 잘라 평가한다 — 이 블록은 document / sessionStorage 말고는 바깥 전역을
      // 직접 참조하지 않는다 (backToStep2 는 typeof 로 확인). 다른 하네스(planner-bridge-roundtrip)
      // 도 변환기와 함께 이 블록을 잘라 가므로 여기에 그 슬라이스 마커 문자열을 그대로 적지 않는다.
      // ============================================================
      const PBW_ID = 'plannerBridgeWarnings';
      const PBW_STYLE_ID = 'pbw-style';
      const PBW_STORAGE_PREFIX = 'pbw:dismissed:';
      /** 자동계산을 다시 돌려야 없어지는 경고 — 그 밖은 안내 */
      const PBW_WARN_PATTERNS = ['자동계산 전', '멍 구간', '멍장 폭', '셀 폭 합'];
      const PBW_HINT_WARN = '구조 단계에서 ⚡ 전체 자동계산 후 다시 넘기기 — 🎨 배치를 고쳤다면 구조에서 ⚡ 를 다시 돌려야 셀이 맞습니다';
      const PBW_HINT_INFO = '안내만 있습니다 — 그대로 산출해도 됩니다. 잔여 구간·마감재는 사양(스펙)에서 확인하세요';
      /** 품목(scope)별 마지막 경고 묶음 — 품목을 바꾸면 그 품목 것으로 다시 그린다 */
      const _pbwByScope = {};

      function _pbwScopeKey(scope) {
        const s = scope || {};
        return `${s.design || 'local'}:${s.item || 'bootstrap'}`;
      }

      /** 경고 묶음의 서명 — 순서가 달라도 같은 내용이면 같은 값 */
      function _pbwSignature(warnings) {
        return (warnings || []).map(String).slice().sort().join('\n');
      }

      /** 'warn'(경고) | 'info'(안내) */
      function _pbwSeverity(text) {
        const t = String(text || '');
        if (PBW_WARN_PATTERNS.some((p) => t.includes(p))) return 'warn';
        return t.includes('자동계산') ? 'warn' : 'info';
      }

      function _pbwEscape(s) {
        return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      }

      function _pbwStorageGet(key) {
        try { return sessionStorage.getItem(PBW_STORAGE_PREFIX + key); } catch (e) { return null; }
      }
      function _pbwStorageSet(key, val) {
        try { sessionStorage.setItem(PBW_STORAGE_PREFIX + key, val); } catch (e) { /* 저장소 없음 — 이번 화면에서만 닫힌다 */ }
      }

      /** 배너·배지 스타일 — 한 번만 주입. 전부 .pbw- 접두 */
      function _pbwEnsureStyle() {
        if (document.getElementById(PBW_STYLE_ID)) return;
        const st = document.createElement('style');
        st.id = PBW_STYLE_ID;
        st.textContent = `
          #${PBW_ID} { display: none; box-sizing: border-box; font-size: 13px; line-height: 1.55; color: #3b2f1e;
            background: #fff7e6; border: 1px solid #f0c36d; }
          /* Step 2: 툴바(44px) 바로 아래, 플래너 overlay(z-index:100) 위 */
          body.step2-fullscreen #${PBW_ID}, body.step2-native #${PBW_ID} { display: block; position: fixed;
            top: calc(var(--v5-header, 88px) + 44px); left: 0; right: 0; z-index: 101;
            border-width: 0 0 1px; padding: 8px 14px; box-shadow: 0 4px 14px rgba(0, 0, 0, .18); max-height: 40vh; overflow: auto; }
          /* Step 3: 보고서 위, 문서 흐름 안 */
          #step3-content #${PBW_ID} { display: block; position: static; border-radius: 10px; padding: 10px 14px; margin: 0 0 12px; }
          .pbw-head { display: flex; align-items: center; gap: 10px; }
          .pbw-title { font-weight: 700; flex: 1; }
          .pbw-close { border: 0; background: transparent; color: #8a6d3b; font-size: 15px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
          .pbw-close:hover { background: rgba(0, 0, 0, .06); color: #3b2f1e; }
          .pbw-list { list-style: none; margin: 6px 0 0; padding: 0; }
          .pbw-item { display: flex; align-items: flex-start; gap: 6px; padding: 2px 0; }
          .pbw-icon { flex: none; }
          .pbw-sev { flex: none; font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; margin-top: 2px; }
          .pbw-warn .pbw-sev { background: #fde3c8; color: #b45309; }
          .pbw-info .pbw-sev { background: #dbeafe; color: #1d4ed8; }
          .pbw-warn .pbw-text { color: #7c2d12; }
          .pbw-hint { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #f0c36d; color: #6b5330; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
          .pbw-hint-label { font-weight: 700; }
          .pbw-back { display: none; border: 1px solid #b45309; background: #fff; color: #b45309; font-size: 12px; padding: 3px 10px; border-radius: 6px; cursor: pointer; }
          .pbw-in-step3 .pbw-back { display: inline-block; }
          .pbw-back:hover { background: #fde3c8; }
          .pbw-badge { display: inline-block; min-width: 18px; height: 18px; line-height: 18px; padding: 0 5px; margin-left: 6px;
            border-radius: 9px; background: #f59e0b; color: #1c1a18; font-size: 11px; font-weight: 700; text-align: center; vertical-align: middle; }
          .pbw-badge-host { position: relative; }
          .step-dot .pbw-badge { position: absolute; top: -8px; right: -10px; margin: 0; }
        `;
        (document.head || document.body).appendChild(st);
      }

      /**
       * 배너를 지금 단계에 맞는 자리에 둔다.
       *   Step 3 표시 중 → #step3-content 안, 보고서(#step3-report-area) 바로 위
       *   그 밖         → #step2Toolbar 의 형제(툴바 바로 다음) — CSS 가 fixed 로 띄운다
       */
      function _pbwPlace(el) {
        if (!el) return;
        const step3 = document.getElementById('step3-content');
        const inStep3 = !!step3 && step3.style.display === 'block';
        if (inStep3) {
          const anchor = document.getElementById('step3-report-area');
          if (anchor && anchor.parentNode === step3) {
            if (el.nextSibling !== anchor || el.parentNode !== step3) step3.insertBefore(el, anchor);
          } else if (el.parentNode !== step3) {
            step3.insertBefore(el, step3.firstChild);
          }
          el.classList.add('pbw-in-step3');
          return;
        }
        const toolbar = document.getElementById('step2Toolbar');
        const host = toolbar && toolbar.parentNode ? toolbar.parentNode : document.body;
        const wantBefore = toolbar ? toolbar.nextSibling : null;
        if (el.parentNode !== host || (toolbar && el.previousSibling !== toolbar)) host.insertBefore(el, wantBefore);
        el.classList.remove('pbw-in-step3');
      }

      /** 툴바 "BOM 산출" 버튼과 스테퍼 3번 점에 건수 배지 (0 이면 제거) */
      function _pbwUpdateBadges(count, warnings) {
        const hosts = [];
        const toolbar = document.getElementById('step2Toolbar');
        if (toolbar) {
          const bomBtn = toolbar.querySelector('button.primary');
          if (bomBtn) hosts.push(bomBtn);
        }
        const dot = document.getElementById('step-dot-3');
        if (dot) hosts.push(dot);
        const title = (warnings || []).join('\n');
        hosts.forEach((host) => {
          let badge = host.querySelector('.pbw-badge');
          if (!count) {
            if (badge) badge.remove();
            host.classList.remove('pbw-badge-host');
            return;
          }
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'pbw-badge';
            host.appendChild(badge);
          }
          badge.textContent = String(count);
          badge.title = `플래너 → 상세설계 확인 사항 ${count}건\n${title}`;
          host.classList.add('pbw-badge-host');
        });
      }

      /** scope 의 경고 묶음으로 배너를 그린다 (닫힌 묶음·0건이면 배너와 배지를 없앤다) */
      function _pbwRender(scope) {
        const key = _pbwScopeKey(scope);
        const warnings = _pbwByScope[key] || [];
        const sig = _pbwSignature(warnings);
        const dismissed = warnings.length > 0 && _pbwStorageGet(key) === sig;
        const show = warnings.length > 0 && !dismissed;
        _pbwUpdateBadges(show ? warnings.length : 0, warnings);

        let el = document.getElementById(PBW_ID);
        if (!show) {
          if (el) el.remove();
          return null;
        }
        _pbwEnsureStyle();
        if (!el) {
          el = document.createElement('div');
          el.id = PBW_ID;
          el.className = 'pbw-banner';
          el.setAttribute('role', 'alert');
        }
        el.dataset.scope = key;

        const items = warnings.map((w) => ({ text: String(w), sev: _pbwSeverity(w) }));
        const warnCount = items.filter((i) => i.sev === 'warn').length;
        el.innerHTML =
          `<div class="pbw-head">` +
            `<span class="pbw-title">플래너 → 상세설계 확인 사항 (${warnings.length})</span>` +
            `<button type="button" class="pbw-close" aria-label="닫기" title="닫기 — 경고 내용이 바뀌면 다시 표시됩니다">✕</button>` +
          `</div>` +
          `<ul class="pbw-list">` +
            items.map((i) =>
              `<li class="pbw-item pbw-${i.sev}">` +
                `<span class="pbw-icon" aria-hidden="true">${i.sev === 'warn' ? '⚠️' : 'ℹ️'}</span>` +
                `<span class="pbw-sev">${i.sev === 'warn' ? '경고' : '안내'}</span>` +
                `<span class="pbw-text">${_pbwEscape(i.text)}</span>` +
              `</li>`).join('') +
          `</ul>` +
          `<div class="pbw-hint">` +
            `<span class="pbw-hint-label">다시 확인:</span>` +
            `<span class="pbw-hint-text">${warnCount ? PBW_HINT_WARN : PBW_HINT_INFO}</span>` +
            `<button type="button" class="pbw-back">← 설계(플래너)로 돌아가기</button>` +
          `</div>`;

        el.querySelector('.pbw-close').addEventListener('click', () => {
          _pbwStorageSet(key, sig);
          _pbwRender(scope);
        });
        el.querySelector('.pbw-back').addEventListener('click', () => {
          if (typeof backToStep2 === 'function') backToStep2();
        });
        _pbwPlace(el);
        return el;
      }

      /**
       * _applyPlannerResult 가 부른다 — 이 품목(scope)의 경고 묶음을 기억하고 배너를 그린다.
       * 빈 배열이면 배너·배지를 지운다.
       */
      function _showBridgeWarnings(warnings, scope) {
        _pbwByScope[_pbwScopeKey(scope)] = (warnings || []).map(String);
        return _pbwRender(scope);
      }

      /** 품목 전환 뒤 — 그 품목의 묶음으로 다시 그린다 (없으면 배너를 치운다) */
      function _pbwSync(scope) {
        return _pbwRender(scope);
      }

      /** 단계 이동 뒤 배너 자리만 다시 맞춘다 (경고 묶음은 그대로) */
      function _pbwSyncPlacement() {
        const el = document.getElementById(PBW_ID);
        if (el) _pbwPlace(el);
      }

      function _appendV2Payload(payload) {
        const layoutShape = payload.layoutShape || 'I';
        const segments = [
          { id: 'prime', x: 0, y: 0, width: payload.width, depth: payload.depth, rotationDeg: 0, label: '주선' },
        ];
        if ((layoutShape === 'L' || layoutShape === 'U') && payload.secondaryW > 0) {
          segments.push({
            id: 'secondary',
            x: payload.secondaryStartSide === 'left' ? -payload.secondaryD : payload.width,
            y: 0,
            width: payload.secondaryD,
            depth: payload.secondaryW,
            rotationDeg: 0,
            label: '차선',
          });
        }
        if (layoutShape === 'U' && payload.tertiaryW > 0) {
          const secondary = segments[1];
          let tx, ty = 0;
          if (payload.tertiaryStartFrom === 'secondary' && secondary) {
            tx = secondary.x;
            ty = secondary.y + secondary.depth;
          } else {
            tx = payload.secondaryStartSide === 'left' ? payload.width : -payload.tertiaryD;
          }
          segments.push({
            id: 'tertiary',
            x: tx,
            y: ty,
            width: payload.tertiaryD,
            depth: payload.tertiaryW,
            rotationDeg: 0,
            label: '3차선',
          });
        }

        // preset.fullHeight 4개 (W6-1 migrateLegacyToV2 와 동일 매핑)
        const fullHeightPresets = new Set(['wardrobe', 'shoe', 'fridge', 'storage']);
        const lowerSection = fullHeightPresets.has(payload.presetId) ? 'tall' : 'lower';

        const segmentIdFor = (m) => {
          if (m.orientation === 'secondary') return 'secondary';
          if (m.orientation === 'tertiary') return 'tertiary';
          return 'prime';
        };
        const isCornerFiller = (m) => m.moduleType === 'blind-corner' || m.moduleType === 'corner-filler';

        const modulesV2 = [];
        for (const m of payload.lowerModules || []) {
          if (isCornerFiller(m)) continue;
          modulesV2.push({
            id: m.id, segmentId: segmentIdFor(m), section: lowerSection,
            kind: m.kind, width: m.width, moduleType: m.moduleType, doorCount: m.doorCount,
          });
        }
        for (const m of payload.upperModules || []) {
          if (isCornerFiller(m)) continue;
          modulesV2.push({
            id: m.id, segmentId: segmentIdFor(m), section: 'upper',
            kind: m.kind, width: m.width, moduleType: m.moduleType, doorCount: m.doorCount,
          });
        }

        payload.schemaVersion = 2;
        payload.segments = segments;
        payload.modulesV2 = modulesV2;
      }

      // W8-5: planner iframe LeftToolbar → ADD_CATEGORY 수신 → incrementCategory 호출
      // W8-6: PLANNER_READY 수신 → 해당 iframe 에 CATEGORY_COUNTS 즉시 응답
      window.addEventListener('message', function (e) {
        if (!e.data) return;
        // 2026-09-13: 플래너가 도면을 계정에 저장하려는데 설계가 아직 저장되지 않았다.
        //   여기서 설계를 저장하고(이름은 saveDesign 이 묻는다) 새 id 를 그 iframe 에 돌려준다.
        //   iframe 은 local 키를 새 스코프로 옮기고 같은 단계를 다시 연 뒤 미룬 저장을 이어서 한다.
        if (e.data.type === 'DADAM_REQUEST_SAVE_DESIGN') {
          if (e.origin !== location.origin) return;
          const src = e.source;
          const reply = (type, extra) => {
            try { src.postMessage(Object.assign({ type }, extra || {}), location.origin); } catch (err) {}
          };
          (async () => {
            try {
              if (typeof currentDesignId !== 'undefined' && currentDesignId) {
                reply('DADAM_DESIGN_SAVED', { designId: currentDesignId });
                return;
              }
              // 2026-09-13: 품목이 없으면 saveDesign 이 alert("저장할 설계 내용이 없습니다") 로 끝난다 —
              //   그 alert 대신 사유를 돌려줘 플래너가 "품목을 먼저 추가" 를 말하게 한다.
              if (typeof selectedItems !== 'undefined' && (!selectedItems || selectedItems.length === 0)) {
                reply('DADAM_DESIGN_SAVE_CANCELED', { reason: 'no-items' });
                return;
              }
              if (typeof saveDesign !== 'function') { reply('DADAM_DESIGN_SAVE_CANCELED'); return; }
              await saveDesign();
              if (typeof currentDesignId !== 'undefined' && currentDesignId) reply('DADAM_DESIGN_SAVED', { designId: currentDesignId });
              else reply('DADAM_DESIGN_SAVE_CANCELED');
            } catch (err) {
              console.error('[Planner] 설계 저장 요청 실패:', err);
              reply('DADAM_DESIGN_SAVE_CANCELED');
            }
          })();
          return;
        }
        if (e.data.type === 'ADD_CATEGORY') {
          const catId = e.data.categoryId;
          if (!catId) return;
          if (typeof incrementCategory === 'function') {
            incrementCategory(catId);
          }
        }
        // W12-2: 플래너 품목 아이콘 우클릭 → 마지막 1개 제거.
        // Step1 카드의 '−' 스테퍼를 대체한다 (잘못 추가한 품목을 지울 유일한 수단).
        if (e.data.type === 'REMOVE_CATEGORY') {
          const catId = e.data.categoryId;
          if (!catId) return;
          if (typeof decrementCategory === 'function') {
            decrementCategory(catId);
          }
        }
        // W12-71: 플래너의 '📥 도면 불러오기 → 디테일' 이 보낸 복원 요청.
        //   디테일 데이터의 정본은 design_items 이고 플래너는 그것을 쓸 수 없다.
        //   그래서 플래너는 **요청만** 보내고, 실제 교체는 품목을 소유한 여기서 한다.
        //
        //   저장까지 하지는 않는다 — 복원이 마음에 안 들면 저장하지 않고 되돌릴
        //   길이 있어야 한다. 대신 '수정됨' 으로 표시해 저장이 필요함을 알린다.
        if (e.data.type === 'DADAM_RESTORE_DETAIL') {
          if (e.origin !== location.origin) return;   // 같은 오리진 iframe 만
          const uid = Number(e.data.itemUniqueId);
          const item = selectedItems.find((it) => Math.floor(it.uniqueId) === uid);
          if (!item) { alert('복원할 품목을 찾지 못했습니다.'); return; }
          // 2026-09-13: 디테일 단계 도면 불러오기와 같은 되쓰기 (detail-drawing.js)
          if (typeof applyDetailSnapshotToItem === 'function') {
            applyDetailSnapshotToItem(item, e.data.specs, e.data.modules);
          } else {
            if (e.data.specs) item.specs = e.data.specs;
            if (Array.isArray(e.data.modules)) item.modules = e.data.modules;
            if (typeof updateUI === 'function') updateUI();
          }
          alert(`"${item.name}" 의 디테일을 저장된 도면으로 되돌렸습니다.

확인 후 '저장' 을 눌러 반영하세요.`);
          return;
        }
        // W11-9/W11-11/W11-14: planner 의 배치+구조를 selectedItems.modules 로 반영.
        //   PLANNER_DONE  — 플래너 "다음" (반영 후 곧바로 BOM 산출)
        //   PLANNER_STATE — 툴바 "BOM 산출" 이 요청한 응답 (_awaitPlannerState 가 처리)
        if (e.data.type === 'PLANNER_DONE' || e.data.type === 'PLANNER_STATE') {
          const goBom = e.data.type === 'PLANNER_DONE';
          if (_pendingPlannerRequest) {
            // 툴바에서 요청한 응답 — 대기 중인 쪽이 이어서 처리한다
            const resolve = _pendingPlannerRequest;
            _pendingPlannerRequest = null;
            resolve(e.data);
            return;
          }
          try {
            _applyPlannerResult(e.data);
          } catch (err) {
            console.error('[Planner] 결과 반영 실패:', err);
            alert('플래너 결과를 반영하지 못했습니다.\n\n' + err.message);
            return;
          }
          if (goBom && typeof proceedToBOM === 'function') proceedToBOM();
          return;
        }
        if (e.data.type === 'PLANNER_READY') {
          // 해당 iframe 에만 송신 (전체 broadcast 대신 source 활용)
          const counts = {};
          CATEGORIES.forEach((cat) => {
            counts[cat.id] = selectedItems.filter((item) => item.categoryId === cat.id).length;
          });
          try {
            e.source && e.source.postMessage({ type: 'CATEGORY_COUNTS', counts }, '*');
          } catch {}
        }
      });

      // W7-2: planner iframe → V2_MODULES_CHANGE 수신 → item.modules 의
      // doorFinish/doorColor/heightOverride 갱신 (silent — _syncPlannerState 재호출 X 로 무한 루프 방지).
      // BOM 산출 시 W7-3 의 extractors.js 가 갱신된 finish/color 인식.
      window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'V2_MODULES_CHANGE') return;
        const itemId = parseFloat(e.data.itemId);
        if (!itemId || isNaN(itemId)) return;
        const item = (window.selectedItems || selectedItems).find(it => it.uniqueId === itemId);
        if (!item || !Array.isArray(e.data.modulesV2)) return;
        let changed = 0;
        for (const v2 of e.data.modulesV2) {
          const m = (item.modules || []).find(mm => String(mm.id) === String(v2.id));
          if (!m) continue;
          if (v2.doorFinish !== undefined && m.doorFinish !== v2.doorFinish) { m.doorFinish = v2.doorFinish; changed++; }
          if (v2.doorColor !== undefined && m.doorColor !== v2.doorColor) { m.doorColor = v2.doorColor; changed++; }
          if (v2.heightOverride !== undefined && parseFloat(m.h) !== v2.heightOverride) { m.h = String(v2.heightOverride); changed++; }
          if (v2.doorCount !== undefined && m.doorCount !== v2.doorCount) { m.doorCount = v2.doorCount; changed++; }
          if (v2.drawerCount !== undefined && m.drawerCount !== v2.drawerCount) { m.drawerCount = v2.drawerCount; changed++; }
        }
        if (changed > 0) {
          // 사용자 BOM 산출 시점에 갱신된 finish/color 반영. UI 재렌더 X (무한 루프 방지).
          if (window.console && window.console.debug) {
            console.debug('[W7-2] V2_MODULES_CHANGE applied:', { itemId, changedFields: changed });
          }
        }
      });

      // ============================================================
      // D1: 플래너 디테일(마감) 모델 왕복 — item.detail (계획서 §4.2 / §5 D1)
      //
      //   플래너(mockup-structure.html?stage=detail, js/planner/planner-detail.js)는 칠할 때마다
      //   부모에 { type:'PLANNER_DETAIL_CHANGE', detail } 을 보낸다. 정본은 여기 품목의
      //   item.detail 이고 design_items.detail 에 저장된다 (persistence-init.js).
      //
      //   detail 형식은 js/planner/planner-finish.js 그대로다:
      //     { version:1, item:{door:{code}…}, sections:{upper:{door:{code}}, lower:{…}}, modules:{…}, parts:{…} }
      //
      //   미러: 상/하 도어 마감은 specs.doorColorUpper/Lower · doorFinishUpper/Lower 로도 계속 채운다 —
      //   AI 연출컷·견적·기존 셀렉트가 그 키를 읽는다. 품목/섹션 단계만 미러한다. 모듈·부재 재정의는
      //   "이 도어 하나만 다른 색" 이라 품목 사양 한 값으로 표현할 수 없다 (BOM 은 detail 을 직접 읽는다).
      //   코드 → 한글 사양값이 없으면(단톤 자재의 마감, 셀렉트에 없는 색) 그 키는 건드리지 않는다.
      //
      //   V2_MODULES_CHANGE 처럼 화면을 다시 그리지 않는다 — 플래너 iframe 이 살아 있는 채로
      //   워크스페이스를 리빌드하면 iframe 이 숨었다 나타나고 UPDATE_PLANNER 가 되돌아간다.
      //   셀렉트는 다음에 그려질 때 item.specs 를 읽는다.
      // ============================================================

      /**
       * 섹션 묶음 → 미러할 specs 키 (planner-finish.js 의 upper|lower 와 같은 구분).
       * C2: material = 카탈로그 코드 그대로 (specs.doorMaterialUpper/Lower). 카탈로그가 모르는 코드면 null(=옛 방식).
       */
      const PLANNER_DETAIL_MIRROR_KEYS = [
        { group: 'upper', material: 'doorMaterialUpper', color: 'doorColorUpper', finish: 'doorFinishUpper' },
        { group: 'lower', material: 'doorMaterialLower', color: 'doorColorLower', finish: 'doorFinishLower' },
      ];

      /** 톤 → 기존 door_finish 셀렉트 값. 카탈로그 행(TONE-M/G)이 있으면 그 name_ko 를 우선한다. */
      const PLANNER_DETAIL_TONE_CODE = { matte: 'TONE-M', gloss: 'TONE-G' };
      const PLANNER_DETAIL_TONE_NAME = { matte: '무광', gloss: '유광' };

      /** 키 순서에 무관한 JSON — DB(JSONB)를 다녀오면 키 순서가 바뀌므로 같은 모델인지 이걸로 본다 */
      function _plannerDetailStable(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(_plannerDetailStable).join(',') + ']';
        return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + _plannerDetailStable(v[k])).join(',') + '}';
      }

      /** 플래너가 보낸 detail 이 모델처럼 생겼는가 — 객체이고 version 이 있다 */
      function _isPlannerDetail(d) {
        return !!d && typeof d === 'object' && !Array.isArray(d) && d.version != null;
      }

      /**
       * 섹션 묶음(upper|lower)의 도어 마감 코드. 품목/섹션 단계만 본다 (모듈·부재는 미러 대상이 아니다).
       * planner-finish.js 가 실려 있으면 그 해석 함수를 쓰고, 없으면 같은 순서(섹션 > 품목)로 직접 찾는다.
       */
      function _plannerDetailDoorOf(detail, group) {
        if (typeof window.plannerFinishResolve === 'function') {
          return window.plannerFinishResolve(detail, 'door', null, group);
        }
        const sec = detail.sections && detail.sections[group] && detail.sections[group].door;
        if (sec && typeof sec.code === 'string' && sec.code.trim()) return { code: sec.code.trim(), level: 'section' };
        const it = detail.item && detail.item.door;
        if (it && typeof it.code === 'string' && it.code.trim()) return { code: it.code.trim(), level: 'item' };
        return null;
      }

      /**
       * 마감 코드(PET-OAK-M) → 기존 한글 사양값 { color:'오크'|null, finish:'무광'|'유광'|null }.
       *   색: FurnitureOptionCatalog 행(name_ko, 셀렉트가 쓰는 값) → bom-finish-color 라벨 순.
       *   마감: 톤(matte/gloss)만 대응한다. single(멜라민·LPM·무늬목)은 '무광/유광' 어느 쪽도 아니므로 null.
       * 모르는 코드는 둘 다 null — 짐작해서 사양을 바꾸지 않는다.
       */
      function _plannerDetailCodeToSpec(code) {
        const out = { color: null, finish: null };
        const fc = window.DadamBomFinishColor;
        const parsed = fc && typeof fc.parseFinishColorCode === 'function' ? fc.parseFinishColorCode(code) : null;
        const cat = window.FurnitureOptionCatalog;
        if (!parsed) {
          // C2: PET-OAK-M 꼴이 아닌 코드(예림 YR-SM-01, 옛 WHT) 는 카탈로그 행에서 파생 — color_name · 톤(gloss→유광, 그 밖→무광)
          // C2b: 기타(호환) 합성 코드 WHT-M / WHT-G 도 여기 — parseFinishColorCode 는 'WHT' 를 기판 코드로 모르므로 null 이 된다
          const spec = cat && typeof cat.doorSpecForCode === 'function' ? cat.doorSpecForCode(code) : null;
          if (spec) { out.color = spec.color; out.finish = spec.finish; }
          return out;
        }
        const byCode = cat && typeof cat.byCode === 'function' ? (c) => cat.byCode(c) : () => null;
        const colorCode = String(code).trim().toUpperCase().split('-')[1];
        const colorRow = byCode(colorCode);
        if (colorRow && colorRow.name_ko) out.color = colorRow.name_ko;
        else {
          const c = (fc.DOOR_COLOR_CATALOG || []).find((x) => x.value === parsed.colorValue);
          if (c && c.label) out.color = c.label;
        }
        const toneCode = PLANNER_DETAIL_TONE_CODE[parsed.tone];
        if (toneCode) {
          const toneRow = byCode(toneCode);
          out.finish = (toneRow && toneRow.name_ko) || PLANNER_DETAIL_TONE_NAME[parsed.tone] || null;
        }
        return out;
      }

      /**
       * detail 의 상/하 도어 마감을 specs 에 미러한다. 지정이 없는 묶음은 건드리지 않는다.
       * @returns {string[]} 실제로 바뀐 specs 키
       */
      function _mirrorPlannerDetailToSpecs(item, detail) {
        const changed = [];
        if (!item || !_isPlannerDetail(detail)) return changed;
        item.specs = item.specs || {};
        PLANNER_DETAIL_MIRROR_KEYS.forEach((m) => {
          const r = _plannerDetailDoorOf(detail, m.group);
          if (!r || !r.code) return;
          const names = _plannerDetailCodeToSpec(r.code);
          // C2: 카탈로그가 아는 코드면 새 키에 그대로, 모르면 null(옛 방식 — 한글 이름으로 기타(호환)을 고른다)
          const material = _plannerDetailMaterialOf(r.code);
          if ((item.specs[m.material] || null) !== material) { item.specs[m.material] = material; changed.push(m.material); }
          if (names.color && item.specs[m.color] !== names.color) { item.specs[m.color] = names.color; changed.push(m.color); }
          if (names.finish && item.specs[m.finish] !== names.finish) { item.specs[m.finish] = names.finish; changed.push(m.finish); }
        });
        return changed;
      }

      // ============================================================
      // C2: 도어 마감 셀렉트 (카탈로그 코드 하나) ↔ 플래너 디테일 양방향
      //
      //   셀렉트(ui-step1 싱크 팝업 · ui-workspace 싱크/붙박이장 · ui-fridge-el 냉장고장)는 FurnitureOptionCatalog.buildDoorMaterialFieldHtml 이
      //   그리고, 바꾸면 updateDoorMaterial(uniqueId, 'upper'|'lower'|'item', code) 이 온다.
      //   붙박이장·냉장고장은 도어 묶음이 하나라 'item' 으로 상·하를 같이 적는다 (BOM 의 legacyDoorEntryFor 가 섹션별 키를 읽으므로 둘 다 채워야 한다).
      //     specs.doorMaterialUpper/Lower = code (새 정본)
      //     specs.doorColorUpper/Lower · doorFinishUpper/Lower = 코드에서 파생 (연출컷·견적·옛 경로가 읽는다)
      //     item.detail.sections[group].door = {code} ('item' 은 item.door) → DADAM_DETAIL_SET 으로 플래너에
      //   반대 방향(PLANNER_DETAIL_CHANGE)은 위 _mirrorPlannerDetailToSpecs 가 doorMaterial* 까지 채운다.
      // ============================================================

      /** 카탈로그가 아는 코드면 그 행의 code(정규화), 기타(호환) 합성 코드(C2b, WHT-G)면 그 코드(정규화), 모르면 null */
      function _plannerDetailMaterialOf(code) {
        const cat = window.FurnitureOptionCatalog;
        const spec = cat && typeof cat.doorSpecForCode === 'function' ? cat.doorSpecForCode(code) : null;
        return spec && spec.code ? String(spec.code) : null;
      }

      /** 품목의 플래너 iframe (`__planner-overlay-{uniqueId}` 안). 없으면 null */
      function _plannerFrameOfItem(uniqueId) {
        const overlay = document.getElementById('__planner-overlay-' + uniqueId);
        return overlay ? overlay.querySelector('iframe[data-planner]') : null;
      }

      /** 빈 디테일 모델 — planner-finish.js 가 실려 있으면 그것, 아니면 같은 모양의 리터럴 */
      function _plannerDetailEmpty() {
        if (typeof window.plannerFinishEmpty === 'function') return window.plannerFinishEmpty();
        return { version: 1, item: {}, sections: { upper: {}, lower: {} }, modules: {}, parts: {} };
      }

      /**
       * item.detail 의 도어 마감을 적는다. group 'upper'|'lower' 는 섹션 재정의, 'item' 은 품목 기본값
       * (이때 섹션의 door 재정의는 지운다 — 셀렉트 하나가 상·하를 같이 뜻하므로).
       * @returns {boolean} 실제로 바뀌었는가
       */
      function _setPlannerDetailDoor(item, group, code) {
        const c = String(code || '').trim();
        if (!item || !c) return false;
        const before = _isPlannerDetail(item.detail) ? _plannerDetailStable(item.detail) : null;
        const detail = _isPlannerDetail(item.detail) ? item.detail : _plannerDetailEmpty();
        if (group === 'item') {
          if (typeof window.plannerFinishSet === 'function') window.plannerFinishSet(detail, 'item', 'door', c);
          else { detail.item = detail.item || {}; detail.item.door = { code: c }; }
          ['upper', 'lower'].forEach((g) => { if (detail.sections && detail.sections[g]) delete detail.sections[g].door; });
        } else {
          const g = group === 'upper' ? 'upper' : 'lower';
          if (typeof window.plannerFinishSet === 'function') window.plannerFinishSet(detail, 'section', 'door', c, { section: g });
          else { detail.sections = detail.sections || {}; detail.sections[g] = detail.sections[g] || {}; detail.sections[g].door = { code: c }; }
        }
        item.detail = detail;
        return before !== _plannerDetailStable(detail);
      }

      /**
       * 도어 마감 셀렉트 onchange. 모르는 코드는 아무것도 바꾸지 않는다.
       * @param {number} itemUniqueId
       * @param {'upper'|'lower'|'item'} group
       * @param {string} code  materials.code (YR-SM-01 · PET-OAK-M) 또는 기타(호환) 합성 코드 (C2b, WHT-M · WHT-G)
       */
      function updateDoorMaterial(itemUniqueId, group, code) {
        const items = window.selectedItems || selectedItems;
        const item = items.find((i) => String(i.uniqueId) === String(itemUniqueId));
        const cat = window.FurnitureOptionCatalog;
        const spec = item && cat && typeof cat.doorSpecForCode === 'function' ? cat.doorSpecForCode(code) : null;
        if (!spec) return false;
        const groups = group === 'item' ? ['upper', 'lower'] : [group === 'upper' ? 'upper' : 'lower'];
        item.specs = item.specs || {};
        const keys = groups.map((g) => PLANNER_DETAIL_MIRROR_KEYS.find((m) => m.group === g));
        const specChanged = keys.some((k) => item.specs[k.material] !== spec.code || item.specs[k.color] !== spec.color || item.specs[k.finish] !== spec.finish);
        const doorNow = _isPlannerDetail(item.detail) ? groups.map((g) => _plannerDetailDoorOf(item.detail, g)) : [];
        const detailSame = doorNow.length === groups.length && doorNow.every((r) => r && r.code === spec.code);
        if (!specChanged && detailSame) return false;

        if (typeof pushUndo === 'function') pushUndo(item);
        keys.forEach((k) => { item.specs[k.material] = spec.code; item.specs[k.color] = spec.color; item.specs[k.finish] = spec.finish; });
        _setPlannerDetailDoor(item, group, spec.code);
        _markDesignDirty();
        const frame = _plannerFrameOfItem(item.uniqueId);
        if (frame) _sendPlannerDetail(frame, item);
        if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
        return true;
      }
      if (typeof window !== 'undefined') window.updateDoorMaterial = updateDoorMaterial;

      /** 다른 편집과 같은 '수정됨' 표시 (persistence-init.js 의 hasUnsavedChanges / updateSaveStatus) */
      function _markDesignDirty() {
        try { hasUnsavedChanges = true; } catch (err) { /* persistence-init.js 가 아직 없다 */ }
        try { if (typeof updateSaveStatus === 'function') updateSaveStatus('saving', '수정됨'); } catch (err) { /* 표시는 선택 */ }
      }

      /**
       * 플래너가 보낸 detail 을 품목에 받는다.
       * 우리가 DADAM_DETAIL_SET 으로 보낸 것의 메아리(같은 모델)면 저장 상태를 건드리지 않는다.
       * @returns {{changed:boolean, mirrored:string[]}}
       */
      function _applyPlannerDetailChange(item, detail) {
        const same = !!item.detail && _plannerDetailStable(item.detail) === _plannerDetailStable(detail);
        const mirrored = _mirrorPlannerDetailToSpecs(item, detail);
        if (same && !mirrored.length) return { changed: false, mirrored };
        item.detail = detail;
        _markDesignDirty();
        return { changed: true, mirrored };
      }

      /** 메시지를 보낸 플래너 iframe. 없으면 null */
      function _plannerFrameOfSource(source) {
        if (!source) return null;
        const frames = document.querySelectorAll('iframe[data-planner]');
        for (let i = 0; i < frames.length; i++) if (frames[i].contentWindow === source) return frames[i];
        return null;
      }

      /** iframe 의 저장 스코프(?item=<uniqueId>, _plannerScopeParams)로 품목을 고른다. 부트스트랩·모르는 품목은 null */
      function _plannerItemOfFrame(frame) {
        if (!frame) return null;
        let param = null;
        try { param = new URL(frame.src, location.href).searchParams.get('item'); } catch (err) { param = null; }
        if (!param || param === 'bootstrap') return null;
        const items = window.selectedItems || selectedItems;
        return items.find((it) => String(it.uniqueId) === param) || null;
      }

      /** 플래너에 마지막으로 넘겨 준(또는 받은) 모델의 키 정렬 JSON — 같은 모델을 다시 보내 되돌리기 이력을 더럽히지 않기 위해 */
      const _plannerDetailSynced = new WeakMap();
      /** 이번 문서(load 이후)에서 플래너가 detail 을 한 번이라도 보내 왔는가 — 재전송 여부 판단 */
      const _plannerDetailAcked = new WeakSet();
      /** 보낸 뒤 메아리(PLANNER_DETAIL_CHANGE)가 안 오면 한 번 더 보내기까지의 간격 */
      const PLANNER_DETAIL_RESEND_MS = 400;

      window.addEventListener('message', function (e) {
        if (!e.data || e.data.type !== 'PLANNER_DETAIL_CHANGE') return;
        if (e.origin !== location.origin) return;   // 같은 오리진 iframe 만
        if (!_isPlannerDetail(e.data.detail)) return;
        const frame = _plannerFrameOfSource(e.source);
        const item = _plannerItemOfFrame(frame);
        if (!item) return;
        _plannerDetailAcked.add(frame);
        _plannerDetailSynced.set(frame, _plannerDetailStable(e.data.detail));
        _applyPlannerDetailChange(item, e.data.detail);
      });

      /**
       * 품목의 detail 을 플래너에 되돌려 준다 (DADAM_DETAIL_SET, 같은 오리진).
       * detail 이 없는 품목은 보내지 않는다 — 플래너는 자기 localStorage 로 시작한다.
       * force 가 아니면 이미 맞춰 둔 모델은 다시 보내지 않는다 (플래너 replace 는 되돌리기 한 장을 쓴다).
       */
      function _sendPlannerDetail(iframe, item, force) {
        if (!iframe || !iframe.contentWindow || !item || !_isPlannerDetail(item.detail)) return false;
        const stable = _plannerDetailStable(item.detail);
        if (!force && _plannerDetailSynced.get(iframe) === stable) return false;
        try {
          iframe.contentWindow.postMessage({ type: 'DADAM_DETAIL_SET', detail: item.detail }, location.origin);
        } catch (err) {
          return false;
        }
        _plannerDetailSynced.set(iframe, stable);
        return true;
      }

      /**
       * 플래너 iframe 이 문서를 열 때마다 detail 을 보낸다.
       * 플래너는 iframe 안에서 배치(mockup-shell) → 구조(mockup-structure) 로 스스로 이동하고,
       * 수신부(PlannerDetail.mount)는 구조 페이지에만 있으며 따로 "준비됨" 신호를 보내지 않는다.
       * 그래서 이동할 때마다 다시 뜨는 load 이벤트에 건다 — 배치 페이지는 이 메시지를 무시하고,
       * 구조 페이지는 인라인에서 동기로 mount 하므로 load 시점엔 이미 듣고 있다.
       * 메아리가 안 오면 한 번 더 보낸다 (스크립트가 늦게 붙는 경우 대비).
       * 품목 객체는 보낼 때 찾는다 — 불러오기가 selectedItems 를 통째로 바꿔도 새 객체를 본다.
       */
      function _attachPlannerDetailSender(iframe, uniqueId) {
        const itemOf = () => (window.selectedItems || selectedItems).find((it) => String(it.uniqueId) === String(uniqueId)) || null;
        iframe.addEventListener('load', () => {
          _plannerDetailSynced.delete(iframe);   // 새 문서 — 이전에 맞춰 둔 것은 잊는다
          _plannerDetailAcked.delete(iframe);
          if (!_sendPlannerDetail(iframe, itemOf(), true)) return;
          setTimeout(() => {
            if (!_plannerDetailAcked.has(iframe)) _sendPlannerDetail(iframe, itemOf(), true);
          }, PLANNER_DETAIL_RESEND_MS);
        });
      }

      function _loadPlannerEmbed(container, item) {
        // 이미 iframe이 로드되어 있으면 postMessage로 업데이트
        const specs = item.specs || {};
        const lowerMods = (item.modules || []).filter(m => m.pos === 'lower' && !m.orientation);
        const upperMods = (item.modules || []).filter(m => m.pos === 'upper' && !m.orientation);
        // item.modules → R3F lowerModules/upperModules 변환
        const toLowerModules = lowerMods.map(m => ({
          id: String(m.id || Date.now() + Math.random()),
          kind: m.isDrawer || m.type === 'drawer' ? 'drawer' : (m.type === 'open' ? 'open' : 'door'),
          width: parseFloat(m.w) || 600,
          moduleType: m.type === 'sink' ? 'sink' : m.type === 'cook' ? 'cook' : (m.name === 'LT망장' ? 'storage' : 'storage'),
          doorCount: m.doorCount || (m.is2door ? 2 : 1),
          drawerCount: m.drawerCount || (m.isDrawer ? 3 : 0),
        }));
        const toUpperModules = upperMods.map(m => ({
          id: String(m.id || Date.now() + Math.random()),
          kind: m.type === 'open' ? 'open' : 'door',
          width: parseFloat(m.w) || 600,
          moduleType: m.type === 'hood' ? 'hood' : 'storage',
          doorCount: m.doorCount || (m.is2door ? 2 : 1),
        }));
        const finishPayload = {
          presetId: item.categoryId || 'sink',
          width: parseFloat(item.w) || 3000,
          height: parseFloat(item.h) || 2310,
          depth: parseFloat(item.d) || 600,
          lowerCount: lowerMods.length,
          upperCount: upperMods.length,
          lowerModules: toLowerModules,
          upperModules: toUpperModules,
          moldingH: parseFloat(specs.moldingH) || 60,
          toeKickH: parseFloat(specs.sinkLegHeight || specs.wardrobePedestalH) || 150,
          finishLeftW: specs.finishLeftType !== 'None' ? (parseFloat(specs.finishLeftWidth) || 60) : 0,
          finishRightW: specs.finishRightType !== 'None' ? (parseFloat(specs.finishRightWidth) || 60) : 0,
          // 실측 유틸리티 정보
          material: specs.materialTone || 'cream',
          distributorStart: specs.distributorStart != null ? parseFloat(specs.distributorStart) : null,
          distributorEnd: specs.distributorEnd != null ? parseFloat(specs.distributorEnd) : null,
          ventStart: specs.ventStart != null ? parseFloat(specs.ventStart) : null,
          layoutShape: specs.lowerLayoutShape || specs.layoutShape || 'I',
          secondaryW: parseFloat(specs.lowerSecondaryW) || 0,
          secondaryD: parseFloat(specs.lowerSecondaryD) || parseFloat(item.d) || 0,
          tertiaryW: parseFloat(specs.lowerTertiaryW) || 0,
          tertiaryD: parseFloat(specs.lowerTertiaryD) || parseFloat(item.d) || 0,
          secondaryStartSide: specs.secondaryStartSide || undefined,
          tertiaryStartFrom: specs.tertiaryStartFrom || undefined,
        };
        // ㄱ자/ㄷ자: secondary 모듈을 lowerModules에 추가 (W10-1: 영속화 모듈 우선)
        _appendSecondaryModules(finishPayload, specs, item.d, item.modules);
        const existing = container.querySelector('iframe[data-planner]');
        if (existing) {
          const sendUpdate = () => {
            if (existing.contentWindow) {
              existing.contentWindow.postMessage({
                type: 'UPDATE_PLANNER',
                payload: finishPayload,
              }, '*');
              _sendPlannerDetail(existing, item);   // D1: 품목 쪽 detail 이 바뀌었으면 같이 맞춘다
            } else {
              console.warn('[Planner] contentWindow null — 100ms 후 재시도');
              setTimeout(sendUpdate, 100);
            }
          };
          sendUpdate();
          return;
        }
        // 새 iframe 생성
        const params = new URLSearchParams({
          preset: finishPayload.presetId,
          w: String(finishPayload.width),
          h: String(finishPayload.height),
          d: String(finishPayload.depth),
          lowerCount: String(finishPayload.lowerCount),
          upperCount: String(finishPayload.upperCount),
          material: finishPayload.material,
          moldingH: String(finishPayload.moldingH),
          toeKickH: String(finishPayload.toeKickH),
          finishLeftW: String(finishPayload.finishLeftW),
          finishRightW: String(finishPayload.finishRightW),
          // W7-2: V2_MODULES_CHANGE 메시지의 itemId 라우팅용
          itemId: String(item.uniqueId),
          // CD-3: 플래너 저장 스코프. 이게 없으면 모든 품목이 같은 localStorage 를
          //       공유해 배치를 서로 덮어쓰고, 자재가 2배로 산출된다.
          ..._plannerScopeParams(item),
          ...(finishPayload.distributorStart != null ? { distStart: String(finishPayload.distributorStart) } : {}),
          ...(finishPayload.distributorEnd != null ? { distEnd: String(finishPayload.distributorEnd) } : {}),
          ...(finishPayload.ventStart != null ? { ventStart: String(finishPayload.ventStart) } : {}),
        });
        container.innerHTML = '';
        const iframe = document.createElement('iframe');
        iframe.src = PLANNER_BASE_URL + '?' + params.toString();
        iframe.dataset.planner = 'true';
        iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:8px;';
        iframe.allow = 'accelerometer; autoplay; fullscreen';
        _attachPlannerDetailSender(iframe, item.uniqueId);   // D1: 문서를 열 때마다 detail 을 되돌려 준다
        container.appendChild(iframe);
      }

      // ★ 3D 플래너 오버레이 — iframe을 body 레벨에 고정 (DOM 이동 없이 리로드 방지)
      /**
       * 2026-09-22: 플래너 오버레이는 **한 번에 하나만** 보인다.
       *
       * 품목마다 오버레이가 하나씩 생기는데(`__planner-overlay-{uniqueId}`), base.css 의
       * `body.step2-fullscreen [id^="__planner-overlay-"] { display:block !important }` 가
       * **전부** 켜 버렸다. 코드가 감추려 해도 !important 에 막혀 먹히지 않아, 품목을 바꿔도
       * 이전 품목의 플래너가 DOM 순서대로 위에 남았다 — 화면이 깜빡이고 남의 배치가 보였다.
       * BOM 화면(Step 3)으로 넘어가도 같은 이유로 오버레이가 보고서를 덮을 수 있었다.
       *
       * 이제 활성 표시가 붙은 하나만 보인다. **표시를 붙이는 곳은 이 함수 하나뿐이다** —
       * 여러 곳에서 display 를 만지면 다시 갈라진다.
       *
       * @param overlayId 보일 오버레이 id. null 이면 **전부 감춘다** (Step 3 등).
       */
      const PLANNER_OVERLAY_ACTIVE = 'planner-overlay-active';
      function _showOnlyPlannerOverlay(overlayId) {
        document.querySelectorAll('[id^="__planner-overlay-"]').forEach((el) => {
          el.classList.toggle(PLANNER_OVERLAY_ACTIVE, !!overlayId && el.id === overlayId);
        });
      }

      /** 품목 id 로 부르는 편의 함수 — 품목이 없으면 전부 감춘다. */
      function _showOnlyPlannerOverlayFor(item) {
        _showOnlyPlannerOverlay(item && item.uniqueId ? '__planner-overlay-' + item.uniqueId : null);
      }

      function _positionPlannerOverlay(overlayId, targetContainer) {
        const overlay = document.getElementById(overlayId);
        if (!overlay || !targetContainer) return;
        const rect = targetContainer.getBoundingClientRect();
        overlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:10;pointer-events:auto;display:block;border-radius:8px;overflow:hidden;`;
        // 자리를 잡는다 = 이 오버레이가 지금 보여야 할 것이다
        _showOnlyPlannerOverlay(overlayId);
      }

      function _createPlannerOverlay(overlayId, targetContainer, item) {
        // 기존 오버레이 제거
        const old = document.getElementById(overlayId);
        if (old) old.remove();
        // 새 오버레이 생성
        const overlay = document.createElement('div');
        overlay.id = overlayId;
        document.body.appendChild(overlay);
        const rect = targetContainer.getBoundingClientRect();
        overlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:10;pointer-events:auto;border-radius:8px;overflow:hidden;`;
        _showOnlyPlannerOverlay(overlayId);
        // iframe 생성
        _loadPlannerEmbed(overlay, item);
      }

      // ============================================================
      // W12-2: 품목 0개일 때의 부트스트랩 플래너
      //
      // 품목 선택이 플래너 안 아이콘으로 들어가면서 닭-달걀 문제가 생긴다:
      // 기존 플래너 오버레이는 품목마다(`__planner-overlay-{uniqueId}`) 만들어지므로
      // 품목이 0개면 플래너가 없고 → 아이콘도 없고 → 품목을 만들 수 없다.
      // 그래서 품목이 없을 때만 뜨는 오버레이를 하나 둔다.
      //
      // 플래너는 URL 파라미터를 읽지 않으므로(mockup-shell.html 에 URLSearchParams 0건)
      // 품목별 오버레이와 내용이 동일하다 — 파라미터 없이 띄워도 무방하다.
      // ============================================================
      /**
       * CD-3: 플래너 저장 스코프 파라미터.
       * 플래너는 이걸로 localStorage 키를 나눠 품목별 배치를 격리한다.
       *
       * `currentDesignId` 는 나중에 로드되는 persistence-init.js 의 전역이라
       * 스크립트 평가 시점에 참조하면 TDZ ReferenceError 가 날 수 있다 —
       * (ui-fridge-el.js 가 최상위에서 goToStep2 를 부른다) 그래서 try 로 감싼다.
       */
      function _plannerScopeParams(item) {
        let design = 'local';
        try {
          if (currentDesignId) design = String(currentDesignId);
        } catch (e) {
          /* 아직 정의 전 — 저장 전 설계이므로 local 로 둔다 */
        }
        return { design, item: item ? String(item.uniqueId) : 'bootstrap' };
      }

      const BOOTSTRAP_PLANNER_ID = '__planner-overlay-bootstrap';

      function _ensureBootstrapPlanner() {
        if (document.getElementById(BOOTSTRAP_PLANNER_ID)) return;
        const ws = document.getElementById('designWorkspace');
        if (!ws) return;
        const overlay = document.createElement('div');
        overlay.id = BOOTSTRAP_PLANNER_ID;
        document.body.appendChild(overlay);
        const rect = ws.getBoundingClientRect();
        overlay.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:10;pointer-events:auto;border-radius:8px;overflow:hidden;`;
        const iframe = document.createElement('iframe');
        // CD-3: 부트스트랩도 자기 스코프를 갖는다 — 품목이 생기기 전 그린 배치가
        // 첫 품목의 배치를 덮어쓰지 않게 한다
        iframe.src = PLANNER_BASE_URL + '?' + new URLSearchParams(_plannerScopeParams(null)).toString();
        iframe.dataset.planner = 'true';
        iframe.style.cssText = 'width:100%;height:100%;border:none;border-radius:8px;';
        iframe.allow = 'accelerometer; autoplay; fullscreen';
        overlay.appendChild(iframe);
        // 2026-09-22: 부트스트랩도 같은 규칙을 탄다 — 활성 표시가 없으면 CSS 가 감춘다
        _showOnlyPlannerOverlay(overlay.id);
      }

      function _removeBootstrapPlanner() {
        const el = document.getElementById(BOOTSTRAP_PLANNER_ID);
        if (el) el.remove();
      }

      /**
       * 2026-09-13: 품목이 없을 때(부트스트랩) 그린 배치를 첫 품목의 스코프로 넘긴다.
       *   부트스트랩 스코프는 `::local:bootstrap`, 품목 스코프는 `::local:<uniqueId>` 다.
       *   안 넘기면 품목을 추가하는 순간 그려 둔 배치가 사라진다. 품목 쪽에 이미 값이 있으면 건드리지 않는다.
       *   옮긴 뒤 fromStructure 토큰을 남겨 새 iframe 이 자동 복원한다 (mockup-shell autoRestore).
       */
      function _adoptBootstrapPlannerScope(item) {
        if (!item || typeof PLANNER_STAGE_KEYS === 'undefined') return [];
        const moved = [];
        const bases = [];
        Object.keys(PLANNER_STAGE_KEYS).forEach((st) => {
          Object.keys(PLANNER_STAGE_KEYS[st] || {}).forEach((f) => bases.push(PLANNER_STAGE_KEYS[st][f]));
        });
        try {
          bases.forEach((base) => {
            const from = `${base}::local:bootstrap`;
            const to = `${base}::local:${String(item.uniqueId)}`;
            const val = localStorage.getItem(from);
            if (val == null) return;
            if (localStorage.getItem(to) == null) { localStorage.setItem(to, val); moved.push(base); }
            localStorage.removeItem(from);
          });
          if (moved.includes('dadam_layout_v1')) sessionStorage.setItem('fromStructure', '1');
        } catch (e) { /* 저장소가 없으면 넘길 것도 없다 */ }
        return moved;
      }

      /**
       * 품목 수에 맞춰 Step2 마운트 상태를 맞춘다.
       * 0개 → 부트스트랩 플래너(아이콘만 쓰는 용도)
       * 1개 이상 → 부트스트랩 제거 후 현재 품목 워크스페이스
       */
      function _syncStep2Mount() {
        const step2 = document.getElementById('step2-content');
        if (!step2 || step2.style.display === 'none') return;

        if (selectedItems.length === 0) {
          _setStep2Mode('planner');
          _ensureBootstrapPlanner();
          return;
        }
        const hadBootstrap = !!document.getElementById(BOOTSTRAP_PLANNER_ID);
        _removeBootstrapPlanner();
        const item = _currentStep2Item();
        if (!item) return;
        _applyStep2Chrome(item);
        _renderStep2ItemTabs();
        // renderBookmarks() 는 부르지 않는다 — 그 함수는 항상 selectedItems[0] 로
        // currentItemId 를 되돌려서 품목을 추가할 때마다 선택이 튄다.

        // 워크스페이스를 다시 그리면 플래너 iframe 이 새로 뜰 수 있다.
        // 품목을 추가할 때마다 리로드되면 작업 중이던 배치가 날아가므로,
        // 현재 품목의 오버레이가 아직 없을 때(= 부트스트랩에서 막 넘어왔거나
        // 불러오기 직후)만 렌더한다.
        const hasOverlay = !!document.getElementById('__planner-overlay-' + item.uniqueId);
        if (hadBootstrap) _adoptBootstrapPlannerScope(item);   // 부트스트랩에서 그린 배치를 잃지 않는다
        if ((hadBootstrap || !hasOverlay) && typeof renderWorkspaceContent === 'function') {
          renderWorkspaceContent(item);
        }
      }

      /**
       * W12-2: 툴바 품목 전환.
       * 플래너 모드에서는 북마크 탭이 CSS 로 숨겨져 있어(base.css `.bookmark-tabs`)
       * 품목이 2개 이상일 때 전환 수단이 화면에 없었다. 아이콘으로 품목을 여러 개
       * 만들 수 있게 된 이상 전환 수단이 반드시 있어야 한다.
       *
       * 2026-09-19: 셀렉트(구 #s2ItemSelect)를 **책갈피**로 폈다. 드롭다운은 열기 전에는
       * 품목이 몇인지·무엇인지 보이지 않아, 만들어 놓고도 만든 줄 모르는 일이 있었다.
       * 그래서 1개일 때도 숨기지 않는다 — 품목을 만들었다는 사실 자체가 보여야 한다.
       * (셀렉트는 2개 이상일 때만 떴다.)
       */
      function _renderStep2ItemTabs() {
        const host = document.getElementById('s2ItemTabs');
        if (!host) return;
        host.innerHTML = '';
        if (!selectedItems.length) {
          host.hidden = true;
          return;
        }
        host.hidden = false;
        const cur = _currentStep2Item();
        selectedItems.forEach((it) => {
          const on = !!cur && String(it.uniqueId) === String(cur.uniqueId);
          const tab = document.createElement('button');
          tab.type = 'button';
          tab.className = 's2-tab';
          tab.id = 's2Tab-' + it.uniqueId;
          tab.dataset.uid = String(it.uniqueId);
          tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-selected', on ? 'true' : 'false');
          tab.textContent = it.labelName || it.name || '품목';
          tab.title = `${it.labelName || it.name || '품목'} — W ${it.w || '?'} × H ${it.h || '?'} × D ${it.d || '?'}`;
          tab.addEventListener('click', () => switchStep2Item(it.uniqueId));
          host.appendChild(tab);
        });
        // 책갈피가 많아 가로로 넘치면 고른 것이 밖에 있을 수 있다 — 안으로 끌어온다.
        const active = host.querySelector('.s2-tab[aria-selected="true"]');
        if (active && typeof active.scrollIntoView === 'function') {
          active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        // 넘칠 때만 오른쪽 끝을 흐린다 — 드롭다운과 달리 책갈피는 잘리면 있는 줄도 모른다.
        host.classList.toggle('overflowing', host.scrollWidth > host.clientWidth + 1);
      }

      function switchStep2Item(uniqueId) {
        const item = selectedItems.find((i) => String(i.uniqueId) === String(uniqueId));
        if (!item) return;
        currentItemId = item.uniqueId;
        _applyStep2Chrome(item);
        _renderStep2ItemTabs();   // 고른 책갈피를 앞으로 (셀렉트는 스스로 했지만 탭은 다시 그려야 한다)
        if (typeof renderWorkspaceContent === 'function') renderWorkspaceContent(item);
        _pbwSync(_plannerScopeParams(item)); // 브리지 경고 배너 — 이 품목의 것으로
      }

      // 스크롤/리사이즈 시 오버레이 위치 동기화
      let _overlayRAF = null;
      function _syncAllPlannerOverlays() {
        if (_overlayRAF) return;
        _overlayRAF = requestAnimationFrame(() => {
          _overlayRAF = null;
          document.querySelectorAll('[id^="__planner-overlay-"]').forEach(overlay => {
            const uid = overlay.id.replace('__planner-overlay-', '');
            const target = document.getElementById('three-canvas-' + uid);
            if (target && overlay.style.display !== 'none') {
              const rect = target.getBoundingClientRect();
              overlay.style.left = rect.left + 'px';
              overlay.style.top = rect.top + 'px';
              overlay.style.width = rect.width + 'px';
              overlay.style.height = rect.height + 'px';
            }
          });
        });
      }
      window.addEventListener('scroll', _syncAllPlannerOverlays, true);
      window.addEventListener('resize', _syncAllPlannerOverlays);

      // 실제 렌더링 구현
      function _renderWorkspaceContentImpl(item) {
        const ws = document.getElementById('designWorkspace');
        if (!ws) return;
        try {

        // ★ 3D iframe 보존 — body 레벨 오버레이 컨테이너 (DOM 이동 없음 → 리로드 방지)
        // iframe을 DOM에서 이동하면 브라우저가 리로드함 → 절대 이동하지 않고 body에 고정
        const plannerOverlayId = '__planner-overlay-' + item.uniqueId;
        let plannerOverlay = document.getElementById(plannerOverlayId);
        const existingIframe = plannerOverlay?.querySelector('iframe[data-planner]');
        const savedIframe = existingIframe || null;
        // 2026-09-22: 예전엔 여기서 오버레이를 감췄다. 두 가지가 틀렸다 —
        //   (1) base.css 의 `display:block !important` 에 막혀 **먹히지도 않았고**,
        //   (2) 먹혔다면 아래 50ms 뒤 재배치까지 빈 화면이 남아 그게 곧 깜빡임이다.
        //   오버레이는 body 직속 fixed 라 designWorkspace 를 다시 그려도 영향을 받지 않는다.
        //   그대로 둔 채 아래에서 자리만 다시 잡으면 한 프레임 안에 바뀐다.

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

        // W11-9: 이 아이템에 맞는 Step2 모드/제목을 적용한다.
        // 북마크 전환으로 냉장고장↔싱크대를 오갈 때 모드가 따라와야 한다
        // (냉장고장은 planner overlay 를 만들지 않으므로 fullscreen 이면 백지가 된다).
        if (document.body.classList.contains('step2-fullscreen') || document.body.classList.contains('step2-native')) {
          _applyStep2Chrome(item);
        }

        // 2026-09-17: 붙박이장 분기를 걷었다 — 아래 일반 경로(플래너 오버레이)를 탄다.
        //   옛 전용 화면(renderWardrobeWorkspace)은 함수로 남아 있지만 더 이상 불리지 않는다.
        //   통 구조·선반·옷봉·서랍은 플래너 구조 단계가 정본이다 (wardrobe.md §1.3).

        // ★ 냉장고장인 경우 별도 렌더링
        if (item.categoryId === 'fridge') {
          renderFridgeWorkspace(item);
          _restoreScroll(ws, scrollInfo);
          _restoreFocus(ws, focusInfo);
          return;
        }

        const upperModules = item.modules.filter((m) => m.pos === 'upper' && !m.orientation);
        const lowerModules = item.modules.filter((m) => m.pos === 'lower' && !m.orientation);

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

          // ★ 클래스 결정: 타입별 > 키큰장 > 기준모듈 > 고정모듈
          let cardClass = 'module-card';
          if (mod.type === 'sink') cardClass += ' type-sink';
          else if (mod.type === 'cook') cardClass += ' type-cook';
          else if (mod.type === 'hood') cardClass += ' type-hood';
          else if (isTall) cardClass += ' tall-type';
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
        const sinkH = parseFloat(item.h) || 2310;
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

        // 도어 오버랩 (상부장 도어 높이 계산용 — BOM에서 사용)
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

          // 아이콘 & 텍스트
          {
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

        // 걸레받이 (하부장에 설치 — 항상 표시)
        {
          const baseboardH = legH - 5; // 걸레받이 높이 = 다리발 높이 - 5mm
          const baseboardH_s = baseboardH * scale;
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
        // ★ 0은 "삭제됨" 상태 — undefined/null만 초기값 생성
        // ★ 값은 모두 실측 기준 벽으로부터의 상대 거리 (mm)
        //   - 분배기 시작: 기준벽에서 1500mm (너비 협소 시 sinkW-700으로 클램프)
        //   - 분배기 끝: 시작 + 700mm
        //   - 환풍구: 기준벽 반대편 끝 (far wall에서 150mm 안쪽)
        const _dsRaw = item.specs.distributorStart;
        const _deRaw = item.specs.distributorEnd;
        const _vsRaw = item.specs.ventStart;
        const DEF_DIST_OFFSET = 1500;
        const DEF_DIST_WIDTH = 700;
        const DEF_VENT_MARGIN = 150;
        const defDistStart = Math.max(0, Math.min(DEF_DIST_OFFSET, sinkW - DEF_DIST_WIDTH));
        const defDistEnd = Math.max(defDistStart, Math.min(sinkW, defDistStart + DEF_DIST_WIDTH));
        const defVentPos = Math.max(0, sinkW - DEF_VENT_MARGIN);
        const distStart = (_dsRaw != null && _dsRaw !== undefined) ? parseFloat(_dsRaw) : defDistStart;
        const distEnd = (_deRaw != null && _deRaw !== undefined) ? parseFloat(_deRaw) : defDistEnd;
        const ventPos = (_vsRaw != null && _vsRaw !== undefined) ? parseFloat(_vsRaw) : defVentPos;
        // 초기값 저장 (undefined/null일 때만 — 0은 삭제 상태이므로 덮어쓰지 않음)
        if (item.specs.distributorStart == null) item.specs.distributorStart = distStart;
        if (item.specs.distributorEnd == null) item.specs.distributorEnd = distEnd;
        if (item.specs.ventStart == null) item.specs.ventStart = ventPos;

        let utilityMarkers = '';
        const uid = item.uniqueId;

        // 실측 기준 방향
        const isRefLeft = item.specs.measurementBase === 'Left';
        const refLabel = isRefLeft ? '좌' : '우';

        // 유틸리티 클램핑 경계
        const drawLeft = offsetX + finishL_s;
        const drawRight = offsetX + drawW - finishR_s;

        // 분배기 — 하부장 하단 (배관 그림 + 치수 + 클릭 팝업 + 드래그)
        // ★ distStart=0, distEnd=0이면 삭제 상태 → 마커 숨김
        if (distStart > 0 && distEnd > distStart) {
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
        // ★ ventPos=0이면 삭제 상태 → 마커 숨김
        if (ventPos > 0) {
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

        // 2D SVG 제거 — R3F 3D planner로 대체
        const sinkFrontViewSvg = '';

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
    <!-- W8-4: 현장 실측 & Layout 패널 통째 삭제 (W/H/D 입력 + 구조 형태 + Secondary/Tertiary Line) -->
    <!-- → Step 2 워크스페이스 (planner iframe) 에서 W/H/D + segment 직접 편집 -->
    <!-- → ㄱ자/ㄷ자/임의 polygon 은 SegmentEditor 가 대체 -->

    <!-- W8-4: 레이아웃 템플릿 (표준형/소형/대형) 버튼 삭제 — 사용자 친화적 UI 단순화 -->

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
      <span style="width:1px;height:16px;background:#ddd;margin:0 4px;"></span>
      ${item.categoryId === 'sink' ? `
      <button onclick="togglePlumbing(${item.uniqueId},'distributor',!(${item.specs.distributorStart > 0 || item.specs.distributorEnd > 0}))" style="padding:4px 10px;font-size:11px;border:1px solid #90caf9;border-radius:6px;background:${(item.specs.distributorStart > 0 || item.specs.distributorEnd > 0) ? '#e3f2fd' : '#f5f5f5'};color:${(item.specs.distributorStart > 0 || item.specs.distributorEnd > 0) ? '#1565c0' : '#999'};cursor:pointer;">💧 분배기</button>
      <button onclick="togglePlumbing(${item.uniqueId},'vent',!(${item.specs.ventStart > 0}))" style="padding:4px 10px;font-size:11px;border:1px solid #b0bec5;border-radius:6px;background:${item.specs.ventStart > 0 ? '#eceff1' : '#f5f5f5'};color:${item.specs.ventStart > 0 ? '#546e7a' : '#999'};cursor:pointer;">🌀 환풍구</button>
      ` : ''}
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
            <div><label style="font-size:9px;color:#666;">도어 마감</label>${FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'upper', item.specs, 'sink', 'font-size:10px;padding:1px;')}</div>
          </div>
        </div>
        <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:6px;padding:6px;">
          <div style="font-size:10px;font-weight:700;color:#b45309;margin-bottom:4px;">⬇ 하부장</div>
          <div style="display:flex;flex-direction:column;gap:3px;">
            <div><label style="font-size:9px;color:#666;">높이</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.specs.lowerH}" onchange="updateSpecValue(${item.uniqueId}, 'lowerH', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">깊이</label><input type="number" style="width:100%;font-size:11px;padding:2px 4px;" value="${item.d || item.defaultD || ''}" onchange="updateItemValue(${item.uniqueId}, 'd', this.value)"></div>
            <div><label style="font-size:9px;color:#666;">다리발</label><select style="width:100%;font-size:11px;padding:2px 4px;" onchange="updateSpec(${item.uniqueId}, 'sinkLegHeight', this.value)"><option value="120" ${item.specs.sinkLegHeight == 120 ? 'selected' : ''}>120</option><option value="150" ${item.specs.sinkLegHeight == 150 ? 'selected' : ''}>150</option></select></div>
            <div><label style="font-size:9px;color:#666;">도어 마감</label>${FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'lower', item.specs, 'sink', 'font-size:10px;padding:1px;')}</div>
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
            <span id="view-label-${item.uniqueId}" style="font-size:13px;font-weight:bold;color:#333;">🎮 3D View</span>
            <span id="view-hint-${item.uniqueId}" style="font-size:10px;color:#aaa;">모듈 클릭 → 편집 | 드래그 → 회전 | 스크롤 → 줌</span>
          </div>
          <div style="display:flex;gap:4px;align-items:center;">
            <div class="view3d-btns" data-uid="${item.uniqueId}">
              <button class="v3d-btn active" data-view="perspective" onclick="set3DView(${item.uniqueId},'perspective',this)">3D</button>
              <button class="v3d-btn" data-view="front" onclick="set3DView(${item.uniqueId},'front',this)">정면</button>
              <button class="v3d-btn" data-view="top" onclick="set3DView(${item.uniqueId},'top',this)">평면</button>
            </div>
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
          <div style="font-size:10px;font-weight:700;color:#2563eb;margin-bottom:4px;">설비 위치 (mm)</div>
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

        // ★ 3D 뷰 — body 레벨 오버레이로 iframe 유지 (DOM 이동 없음)
        // W9-9: step2-fullscreen 시 three-canvas 가 숨겨져 clientWidth=0 → CSS 가 위치 강제 (uses designWorkspace 대체)
        {
          const tryInit3D = (retries) => {
            let container = document.getElementById('three-canvas-' + item.uniqueId);
            const isFullscreen = document.body.classList.contains('step2-fullscreen');
            // fullscreen 일 때 three-canvas 가 숨겨져 0×0 → designWorkspace 대체 (CSS 가 100vw×100vh 강제)
            if (isFullscreen) {
              container = container || document.getElementById('designWorkspace');
            }
            // 조건 완화: fullscreen 이면 container 만 있으면 OK (clientWidth 무관)
            if (container && (isFullscreen || container.clientWidth > 0)) {
              if (savedIframe) {
                _positionPlannerOverlay(plannerOverlayId, container);
                _syncPlannerState(item);
                _sendPlannerDetail(savedIframe, item);   // D1: 품목 전환·되쓰기 뒤 detail 이 달라졌으면 맞춘다
              } else {
                _createPlannerOverlay(plannerOverlayId, container, item);
              }
              return true;
            }
            if (retries > 0) setTimeout(() => tryInit3D(retries - 1), 100);
            return false;
          };
          // 2026-09-22: **즉시 한 번** 해 본다. designWorkspace 는 방금 innerHTML 로 만들어졌고
          //   getBoundingClientRect 가 레이아웃을 강제하므로 대개 여기서 끝난다.
          //   예전엔 무조건 50ms 뒤였다 — 그 사이 이전 품목 플래너가 남아 **깜빡였다.**
          //   자리가 아직 안 잡히는 경우(숨은 컨테이너 등)만 예전 재시도로 넘어간다.
          if (!tryInit3D(0)) setTimeout(() => tryInit3D(5), 50);
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

        // 3D → 다른 뷰로 전환 시 오버레이 숨김
        //   2026-09-22: style.display 는 base.css 의 !important 에 막혔다 — 활성 표시로 끈다
        if (item.specs.viewMode === '3d' && mode !== '3d') {
          _showOnlyPlannerOverlay(null);
        }

        item.specs.viewMode = mode;
        renderWorkspaceContent(item);

        // 3D 뷰 활성화 시 R3F 임베드 로드
        if (mode === '3d') {
          const tryInit3D = (retries) => {
            const container = document.getElementById('three-canvas-' + itemUniqueId);
            if (container && container.clientWidth > 0) {
              _loadPlannerEmbed(container, item);
            } else if (retries > 0) {
              setTimeout(() => tryInit3D(retries - 1), 100);
            }
          };
          setTimeout(() => tryInit3D(5), 50);
        }
      }

      function renderIsometricView(item, upperModules, lowerModules) {
        const W = parseFloat(item.w) || 3000;
        const H = parseFloat(item.h) || 2310;
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

