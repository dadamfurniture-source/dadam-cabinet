      // ============================================================
      // UI 함수: 모달 표시
      // ============================================================
      function showExtractorModal(title, content) {
        const existingModal = document.getElementById('extractorModal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'extractorModal';
        modal.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;">
      <div style="background:white;border-radius:12px;width:90%;max-width:900px;max-height:85vh;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,0.3);">
        <div style="background:#1976d2;color:white;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:18px;">${title}</h3>
          <button onclick="document.getElementById('extractorModal').remove()" style="background:none;border:none;color:white;font-size:24px;cursor:pointer;">&times;</button>
        </div>
        <div style="padding:20px;overflow-y:auto;max-height:calc(85vh - 120px);">
          ${content}
        </div>
        <div style="padding:12px 20px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="downloadExtractorData()" style="background:#4caf50;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;">📥 다운로드</button>
          <button onclick="document.getElementById('extractorModal').remove()" style="background:#eee;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">닫기</button>
        </div>
      </div>
    </div>
  `;
        document.body.appendChild(modal);
      }

      // 자재 추출 UI
      function showMaterialExtractor() {
        const result = window.DadamAgent.extractMaterials();
        if (!result.materials.length) {
          alert('추출할 자재가 없습니다. 먼저 설계를 완료하세요.');
          return;
        }

        let tableHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead style="background:#e3f2fd;">
      <tr>
        <th style="border:1px solid #ddd;padding:8px;">No</th>
        <th style="border:1px solid #ddd;padding:8px;">모듈</th>
        <th style="border:1px solid #ddd;padding:8px;">부품</th>
        <th style="border:1px solid #ddd;padding:8px;">자재</th>
        <th style="border:1px solid #ddd;padding:8px;">두께</th>
        <th style="border:1px solid #ddd;padding:8px;">가로</th>
        <th style="border:1px solid #ddd;padding:8px;">세로</th>
        <th style="border:1px solid #ddd;padding:8px;">수량</th>
        <th style="border:1px solid #ddd;padding:8px;">엣지</th>
      </tr>
    </thead><tbody>`;

        result.materials.forEach((m, i) => {
          tableHTML += `<tr>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${i + 1}</td>
      <td style="border:1px solid #ddd;padding:6px;">${m.module}</td>
      <td style="border:1px solid #ddd;padding:6px;">${m.part}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${m.material}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${m.thickness}T</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${m.w}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:right;">${m.h}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${m.qty}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${m.edge}</td>
    </tr>`;
        });
        tableHTML += `</tbody></table>`;

        // 요약
        let summaryHTML = `<div style="margin-top:20px;padding:15px;background:#f5f5f5;border-radius:8px;">
    <h4 style="margin:0 0 10px 0;">📊 자재 요약</h4><table style="width:100%;font-size:13px;">
    <tr style="background:#e8f5e9;"><th style="padding:8px;text-align:left;">자재</th><th>총면적</th><th>패널 수</th></tr>`;
        Object.values(result.summary).forEach((s) => {
          summaryHTML += `<tr><td style="padding:6px;">${s.material} ${s.thickness}T</td>
      <td style="text-align:right;">${(s.totalArea / 1000000).toFixed(2)} ㎡</td>
      <td style="text-align:center;font-weight:bold;">${s.panelCount}장</td></tr>`;
        });
        summaryHTML += `</table></div>`;

        window._extractorData = {
          type: 'material',
          csv: materialExtractor.toCSV(result.materials),
          cnc: materialExtractor.toCNC(result.materials),
        };
        showExtractorModal('📦 자재 추출 결과', tableHTML + summaryHTML);
      }

      // 부자재 추출 UI
      function showHardwareExtractor() {
        const result = window.DadamAgent.extractHardware();
        if (!result.hardware.length) {
          alert('추출할 부자재가 없습니다. 먼저 설계를 완료하세요.');
          return;
        }

        let tableHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px;">
    <thead style="background:#e8f5e9;">
      <tr>
        <th style="border:1px solid #ddd;padding:8px;">No</th>
        <th style="border:1px solid #ddd;padding:8px;">분류</th>
        <th style="border:1px solid #ddd;padding:8px;">품목</th>
        <th style="border:1px solid #ddd;padding:8px;">제조사</th>
        <th style="border:1px solid #ddd;padding:8px;">스펙</th>
        <th style="border:1px solid #ddd;padding:8px;">수량</th>
        <th style="border:1px solid #ddd;padding:8px;">단위</th>
        <th style="border:1px solid #ddd;padding:8px;">비고</th>
      </tr>
    </thead><tbody>`;

        result.hardware.forEach((h, i) => {
          tableHTML += `<tr>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${i + 1}</td>
      <td style="border:1px solid #ddd;padding:6px;">${h.category}</td>
      <td style="border:1px solid #ddd;padding:6px;">${h.item}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${h.manufacturer}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${h.spec}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;font-weight:bold;">${h.qty}</td>
      <td style="border:1px solid #ddd;padding:6px;text-align:center;">${h.unit}</td>
      <td style="border:1px solid #ddd;padding:6px;font-size:11px;">${h.note}</td>
    </tr>`;
        });
        tableHTML += `</tbody></table>`;

        // 요약
        let summaryHTML = `<div style="margin-top:20px;padding:15px;background:#f5f5f5;border-radius:8px;">
    <h4 style="margin:0 0 10px 0;">🔩 부자재 요약</h4><div style="display:flex;gap:15px;flex-wrap:wrap;">`;
        Object.entries(result.summary).forEach(([cat, qty]) => {
          summaryHTML += `<div style="background:white;padding:10px 15px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
      <div style="font-size:11px;color:#666;">${cat}</div>
      <div style="font-size:18px;font-weight:bold;color:#1976d2;">${qty}</div></div>`;
        });
        summaryHTML += `</div></div>`;

        window._extractorData = { type: 'hardware', csv: hardwareExtractor.toCSV(result.hardware) };
        showExtractorModal('🔩 부자재 추출 결과', tableHTML + summaryHTML);
      }

      // 재단 도면 UI
      function showDrawingVisualizer() {
        const result = window.DadamAgent.extractMaterials();
        if (!result.materials.length) {
          alert('생성할 도면이 없습니다. 먼저 설계를 완료하세요.');
          return;
        }

        const panels = drawingVisualizer.generateCuttingLayout(result.materials);
        const reportHTML = drawingVisualizer.generateReport(panels);

        window._extractorData = { type: 'drawing', panels };
        showExtractorModal('🪵 재단 도면', reportHTML);
      }

      // 다운로드 함수
      function downloadExtractorData() {
        if (!window._extractorData) return;

        const data = window._extractorData;
        let blob, filename;

        if (data.type === 'material') {
          blob = new Blob(['\uFEFF' + data.csv], { type: 'text/csv;charset=utf-8;' });
          filename = `자재목록_${new Date().toISOString().slice(0, 10)}.csv`;
        } else if (data.type === 'hardware') {
          blob = new Blob(['\uFEFF' + data.csv], { type: 'text/csv;charset=utf-8;' });
          filename = `부자재목록_${new Date().toISOString().slice(0, 10)}.csv`;
        } else if (data.type === 'drawing') {
          const html = drawingVisualizer.generateReport(data.panels);
          blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
          filename = `재단도면_${new Date().toISOString().slice(0, 10)}.html`;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      // ============================================================
      // 설계 저장 함수 (JSON 파일 다운로드)
      // ============================================================
      function saveDesignToFile() {
        const design = window.DadamAgent.exportDesign();

        if (!design.items || design.items.length === 0) {
          alert('저장할 설계가 없습니다.');
          return;
        }

        // 파일명 생성 (첫번째 아이템 기준)
        const firstItem = design.items[0];
        const categoryName = firstItem.category || 'design';
        const dateStr = new Date().toISOString().slice(0, 10);
        const filename = `다담_${categoryName}_${firstItem.w}x${firstItem.h}_${dateStr}.json`;

        // JSON 파일 다운로드
        const jsonStr = JSON.stringify(design, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        alert(`설계가 저장되었습니다.\n파일명: ${filename}`);
      }

      // ============================================================
      // AI 디자인 생성 시스템 (설계 데이터 기반 - Fast Generation)
      // ============================================================

      // 스타일 추출 헬퍼 함수
      function extractStyleFromSpecs(specs) {
        if (!specs) return 'modern minimal white';
        const styles = [];

        // 마감재 스타일
        if (specs.doorFinishUpper === '무광' || specs.doorFinishLower === '무광') {
          styles.push('matte');
        } else if (specs.doorFinishUpper === '유광') {
          styles.push('glossy');
        }

        // 색상 스타일
        const colorMap = {
          '화이트': 'white', '그레이': 'gray', '블랙': 'black',
          '아이보리': 'ivory', '오크': 'oak', '월넛': 'walnut'
        };
        if (specs.doorColorUpper && colorMap[specs.doorColorUpper]) {
          styles.push(colorMap[specs.doorColorUpper]);
        }

        // 핸들 스타일
        if (specs.handle?.includes('푸시') || specs.handle?.includes('push')) {
          styles.push('handleless');
        }

        return `modern minimal korean ${styles.join(' ')}`.trim();
      }

      // 이미지 생성용 상세 프롬프트 생성 (v3: texture_prompt 활용)
      function buildDesignPrompt(specs, cabinetSpecs) {
        const cat = FurnitureOptionCatalog;

        // v3: getTexturePrompt로 상세 질감 프롬프트 사용
        const upperColor = cat.getTexturePrompt('door_color', cabinetSpecs.door_color_upper);
        const lowerColor = cat.getTexturePrompt('door_color', cabinetSpecs.door_color_lower);
        const upperFinish = cat.getTexturePrompt('door_finish', cabinetSpecs.door_finish_upper);
        const lowerFinish = cat.getTexturePrompt('door_finish', cabinetSpecs.door_finish_lower);
        const topDesc = cat.getTexturePrompt('countertop', cabinetSpecs.countertop_color);
        const handleDesc = cat.getTexturePrompt('handle', cabinetSpecs.handle_type);
        const hoodDesc = cat.getTexturePrompt('hood', cabinetSpecs.hood_type);
        const cooktopDesc = cat.getTexturePrompt('cooktop', cabinetSpecs.cooktop_type);
        const sinkDesc = cat.getTexturePrompt('sink', cabinetSpecs.sink_type);
        const faucetDesc = cat.getTexturePrompt('faucet', cabinetSpecs.faucet_type);

        const lines = [];
        lines.push(`Korean built-in kitchen cabinet, photorealistic interior photograph.`);
        lines.push(`Upper cabinet doors: ${upperColor}, ${upperFinish}.`);
        lines.push(`Lower cabinet doors: ${lowerColor}, ${lowerFinish}.`);
        lines.push(`Countertop: ${topDesc}.`);
        lines.push(`Hardware: ${handleDesc}.`);

        if (cabinetSpecs.hood_type) {
          lines.push(`Range hood: ${hoodDesc}.`);
        }
        if (cabinetSpecs.cooktop_type) {
          lines.push(`Cooktop: ${cooktopDesc}.`);
        }
        if (cabinetSpecs.sink_type) {
          lines.push(`Sink: ${sinkDesc}.`);
        }
        if (cabinetSpecs.faucet_type) {
          lines.push(`Faucet: ${faucetDesc}.`);
        }

        const negatives = [];
        negatives.push('NO exposed hood duct');
        negatives.push('NO hood ventilation pipe');
        negatives.push('NO external ductwork');
        negatives.push('NO visible exhaust pipe on wall or ceiling');
        negatives.push('NO silver/metallic duct tube');

        return {
          prompt: lines.join(' '),
          negative_prompt: negatives.join(', ')
        };
      }

      // 모듈 위치 계산 헬퍼 함수
      function calculateModulePositions(modules, section) {
        let currentPos = 0;
        return modules
          .filter(m => m.pos === section)
          .map(m => {
            const moduleWithPos = {
              ...m,
              position_from_left_mm: currentPos,
              width_mm: parseInt(m.w) || 0,
              height_mm: parseInt(m.h) || 0,
              depth_mm: parseInt(m.d) || 0,
              is_drawer: m.isDrawer || false,
              door_count: m.doorCount || 1,
              has_sink: m.moduleType === 'sink' || m.name?.includes('싱크'),
              has_cooktop: m.moduleType === 'cooktop' || m.name?.includes('쿡탑') || m.name?.includes('인덕션'),
            };
            currentPos += parseInt(m.w) || 0;
            return moduleWithPos;
          });
      }

      // 이미지 URL을 base64로 변환하는 함수
      async function fetchImageAsBase64(imageUrl) {
        try {
          const response = await fetch(imageUrl);
          if (!response.ok) throw new Error('이미지 로드 실패');

          const blob = await response.blob();
          const mimeType = blob.type || 'image/jpeg';

          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result.split(',')[1]; // data:image/...;base64, 제거
              resolve({ base64, type: mimeType });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          console.error('이미지 변환 실패:', error);
          return null;
        }
      }

      async function generateAIDesign() {
        // 1. 설계 데이터 추출
        const design = window.DadamAgent.exportDesign();

        if (!design.items || design.items.length === 0) {
          alert('AI 디자인을 생성할 설계가 없습니다.\n먼저 캐비넷을 추가해주세요.');
          return;
        }

        // ── MultiagentAPI 경로 (설정된 경우) ──
        if (typeof MultiagentAPI !== 'undefined' && MultiagentAPI.enabled) {
          return generateAIDesignMultiagent(design);
        }

        // 2. 로딩 UI 표시 (레거시 n8n 경로)
        showAIGeneratingModal();

        try {
          // 3. 첫 번째 아이템 기준으로 상세 사양 추출
          const mainItem = design.items[0];
          const specs = mainItem.specs || {};
          const modules = mainItem.modules || [];

          // 4. 카테고리 및 스타일 결정
          const category = mainItem.categoryId || mainItem.category || 'sink';
          const style = extractStyleFromSpecs(specs);

          // 5. 상세 캐비넷 사양 구성
          const cabinetSpecs = {
            // 기본 치수
            total_width_mm: parseInt(mainItem.w) || 0,
            total_height_mm: parseInt(mainItem.h) || 0,
            depth_mm: parseInt(mainItem.d) || 0,

            // 높이 세부 사항
            upper_cabinet_height: specs.upperH || 720,
            lower_cabinet_height: specs.lowerH || 870,
            molding_height: specs.moldingH || 60,
            leg_height: specs.sinkLegHeight || specs.legH || 150,
            countertop_thickness: specs.topThickness || 12,
            upper_door_overlap: specs.upperDoorOverlap || 15,

            // 색상 및 마감
            door_color_upper: specs.doorColorUpper || '화이트',
            door_color_lower: specs.doorColorLower || '화이트',
            door_finish_upper: specs.doorFinishUpper || '무광',
            door_finish_lower: specs.doorFinishLower || '무광',
            countertop_color: specs.topColor || '스노우',

            // 하드웨어
            handle_type: specs.handle || 'push-open',

            // 가전 (싱크대/아일랜드)
            sink_type: specs.sink || null,
            faucet_type: specs.faucet || null,
            hood_type: specs.hood || null,
            cooktop_type: specs.cooktop || null,

            // 마감 (좌우)
            finish_left_type: specs.finishLeftType || 'Molding',
            finish_left_width: specs.finishLeftWidth || 60,
            finish_right_type: specs.finishRightType || 'Molding',
            finish_right_width: specs.finishRightWidth || 60,
          };

          // 6. 모듈 레이아웃 구성
          const upperModules = calculateModulePositions(modules, 'upper');
          const lowerModules = calculateModulePositions(modules, 'lower');

          // 싱크대/쿡탑 위치 찾기
          const sinkModule = lowerModules.find(m => m.has_sink);
          const cooktopModule = lowerModules.find(m => m.has_cooktop);

          if (sinkModule) {
            cabinetSpecs.sink_position_mm = sinkModule.position_from_left_mm;
          }
          if (cooktopModule) {
            cabinetSpecs.cooktop_position_mm = cooktopModule.position_from_left_mm;
          }

          // 6-2. 레퍼런스 이미지 URL + prompt_description 수집
          const referenceImages = {};
          const materialDescriptions = {};
          const optMappings = [
            { spec: 'doorColorUpper', cat: 'door_color', descKey: 'upper_door_color' },
            { spec: 'doorColorLower', cat: 'door_color', descKey: 'lower_door_color' },
            { spec: 'doorFinishUpper', cat: 'door_finish', descKey: 'upper_door_finish' },
            { spec: 'doorFinishLower', cat: 'door_finish', descKey: 'lower_door_finish' },
            { spec: 'handle', cat: 'handle', descKey: 'handle' },
            { spec: 'topColor', cat: 'countertop', descKey: 'countertop' },
            { spec: 'hood', cat: 'hood', descKey: 'hood' },
            { spec: 'cooktop', cat: 'cooktop', descKey: 'cooktop' },
            { spec: 'sink', cat: 'sink', descKey: 'sink' },
            { spec: 'faucet', cat: 'faucet', descKey: 'faucet' },
          ];
          for (const m of optMappings) {
            const val = specs[m.spec];
            if (val) {
              const url = FurnitureOptionCatalog.getImageUrl(m.cat, val);
              const desc = FurnitureOptionCatalog.getPromptDescription(m.cat, val);
              const texPrompt = FurnitureOptionCatalog.getTexturePrompt(m.cat, val);
              if (url) referenceImages[m.spec] = { url, prompt_description: desc };
              materialDescriptions[m.descKey] = texPrompt;
            }
          }

          // 6-3. LayoutRenderer로 수치 기반 레이아웃 블루프린트 생성
          //   - 텍스처 렌더링 (async) + 마스크 생성 (AI 인페인팅용)
          let layoutImageBase64 = null;
          let layoutData = null;
          let maskImageBase64 = null;
          try {
            // 텍스처 포함 렌더링 시도 (실패 시 동기 폴백)
            try {
              layoutImageBase64 = await LayoutRenderer.renderWithTextures(cabinetSpecs, upperModules, lowerModules, specs);
              console.log('[LayoutRenderer] 텍스처 렌더링 완료');
            } catch (texErr) {
              console.warn('[LayoutRenderer] 텍스처 렌더링 실패, 기본 렌더링 사용:', texErr.message);
              layoutImageBase64 = LayoutRenderer.render(cabinetSpecs, upperModules, lowerModules, specs);
            }
            layoutData = LayoutRenderer.getLayoutData(cabinetSpecs, upperModules, lowerModules);

            // 마스크 이미지 생성 (가구 표면=흰색, 나머지=검정 → AI 인페인팅용)
            maskImageBase64 = LayoutRenderer.renderMask(cabinetSpecs, upperModules, lowerModules, specs);

            console.log('[LayoutRenderer] 블루프린트 + 마스크 생성 완료:', {
              canvasSize: Math.round(1024 / layoutData.aspectRatio) + 'x1024',
              upperModules: layoutData.upper.modules.length,
              lowerModules: layoutData.lower.modules.length,
              hasMask: !!maskImageBase64,
            });
          } catch (e) {
            console.warn('[LayoutRenderer] 블루프린트 생성 실패:', e.message);
          }

          // 7. 현장 사진 확인 및 변환
          let roomImageData = null;
          const sitePhotoUrl = mainItem.imageUrl || mainItem.image;

          if (sitePhotoUrl && sitePhotoUrl !== 'loading') {
            console.log('현장 사진 발견:', sitePhotoUrl);
            roomImageData = await fetchImageAsBase64(sitePhotoUrl);
            if (roomImageData) {
              console.log('현장 사진 변환 성공:', roomImageData.type);
            }
          }

          // 8. 엔드포인트 결정 (이미지 유무에 따라)
          // 이미지가 있으면 메인 워크플로우 (Wall Analysis 포함), 없으면 design-to-image
          const apiEndpoint = roomImageData
            ? 'https://dadam.app.n8n.cloud/webhook/dadam-interior-v4'  // 메인 워크플로우 (Wall Analysis)
            : N8N_AI_DESIGN_URL;  // design-to-image 워크플로우

          // 8-1. 상세 프롬프트 생성
          const designPrompt = buildDesignPrompt(specs, cabinetSpecs);

          console.log('AI 디자인 생성 요청:', {
            category,
            style,
            prompt: designPrompt.prompt,
            negative_prompt: designPrompt.negative_prompt,
            cabinetSpecs,
            upperModules: upperModules.length,
            lowerModules: lowerModules.length,
            hasRoomImage: !!roomImageData,
            hasLayoutImage: !!layoutImageBase64,
            hasMaskImage: !!maskImageBase64,
            layoutData: layoutData,
            endpoint: apiEndpoint
          });

          // 9. n8n 워크플로우 호출 (강화된 페이로드)
          const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // 설계 ID (저장된 경우)
              design_id: currentDesignId || null,

              // 현장 사진 (있는 경우)
              room_image: roomImageData?.base64 || '',
              image_type: roomImageData?.type || 'image/jpeg',

              // 기본 정보
              category: category,
              style: style,
              design_style: style,

              // 상세 디자인 프롬프트
              prompt: designPrompt.prompt,
              negative_prompt: designPrompt.negative_prompt,

              // 상세 캐비넷 사양
              cabinet_specs: cabinetSpecs,

              // 레퍼런스 이미지 + 자재 설명
              reference_images: referenceImages,
              material_descriptions: materialDescriptions,

              // 수치 기반 레이아웃 블루프린트 (Canvas 렌더링 + 텍스처)
              layout_image: layoutImageBase64 || '',
              layout_data: layoutData || {},

              // AI 인페인팅용 마스크 (가구 표면=흰색, 나머지=검정)
              mask_image: maskImageBase64 || '',

              // 모듈 레이아웃
              modules: {
                upper: upperModules,
                lower: lowerModules,
                upper_count: upperModules.length,
                lower_count: lowerModules.length,
              },

              // 레거시 호환 (기존 Parse Design Data 노드)
              design_data: design,
              items: design.items.map((item) => ({
                categoryId: item.categoryId || item.category,
                category: item.categoryId || item.category,
                name: item.name,
                w: parseInt(item.w) || 0,
                h: parseInt(item.h) || 0,
                d: parseInt(item.d) || 0,
                specs: item.specs,
                modules: item.modules,
              })),
            }),
          });

          if (!response.ok) throw new Error(`서버 오류: HTTP ${response.status}`);

          // 응답 텍스트 먼저 확인
          const responseText = await response.text();
          if (!responseText || responseText.trim() === '') {
            throw new Error('AI 서버에서 빈 응답을 받았습니다.\nn8n 워크플로우를 확인해주세요.');
          }

          // JSON 파싱 시도
          let data;
          try {
            data = JSON.parse(responseText);
            if (Array.isArray(data)) data = data[0];
          } catch (parseError) {
            console.error('JSON 파싱 실패:', responseText);
            throw new Error('AI 서버 응답을 처리할 수 없습니다.\n응답: ' + responseText.substring(0, 100));
          }

          // 4. 결과 확인 및 표시
          if (data.success === false) {
            throw new Error(data.error || data.message || '이미지 생성에 실패했습니다.');
          }

          showAIDesignResult(data);
        } catch (error) {
          console.error('AI 디자인 생성 오류:', error);
          alert('AI 디자인 생성 중 오류가 발생했습니다.\n' + error.message);
        } finally {
          hideAIGeneratingModal();
        }
      }

      // ============================================================
      // MultiagentAPI 경로: 전체 파이프라인 (Space Analysis → Layout → Image → Quote)
      // ============================================================
      async function generateAIDesignMultiagent(design) {
        const mainItem = design.items[0];
        const category = mainItem.categoryId || mainItem.category || 'sink';
        const specs = mainItem.specs || {};
        const style = extractStyleFromSpecs(specs);

        // 현장 사진 가져오기 (필수)
        const sitePhotoUrl = mainItem.imageUrl || mainItem.image;
        if (!sitePhotoUrl || sitePhotoUrl === 'loading') {
          alert('Multiagent 파이프라인은 현장 사진이 필요합니다.\n가구 입력에서 현장 사진을 업로드해주세요.');
          return;
        }

        // 이미지 URL → File 객체로 변환
        let imageFile;
        try {
          const resp = await fetch(sitePhotoUrl);
          const blob = await resp.blob();
          imageFile = new File([blob], 'room.jpg', { type: blob.type || 'image/jpeg' });
        } catch (e) {
          alert('현장 사진을 불러올 수 없습니다: ' + e.message);
          return;
        }

        // 진행 모달 표시
        showMultiagentProgressModal();

        try {
          const result = await MultiagentAPI.runFullPipeline(
            imageFile,
            category,
            style,
            null, // budget
            {
              onStage: (stage, label) => updateMultiagentProgress(stage, label),
              onError: (err) => {
                hideMultiagentProgressModal();
                alert('AI 파이프라인 오류: ' + err);
              },
              onComplete: (data) => {
                hideMultiagentProgressModal();
                showMultiagentResult(data);
              },
            }
          );
        } catch (error) {
          console.error('Multiagent pipeline error:', error);
          hideMultiagentProgressModal();
          alert('AI 파이프라인 오류: ' + error.message);
        }
      }

      function showMultiagentProgressModal() {
        const existing = document.getElementById('multiagentProgressModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'multiagentProgressModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:40px 60px;text-align:center;max-width:480px;width:90%;">
      <div style="width:60px;height:60px;margin:0 auto 20px;border:4px solid #EBE8E2;border-top-color:#6366F1;border-radius:50%;animation:spin 1s linear infinite;"></div>
      <h3 style="font-size:18px;margin:0 0 16px;color:#2D2A26;">🤖 AI 시뮬레이션 진행 중</h3>
      <div id="multiagentStages" style="text-align:left;margin:0 auto;max-width:280px;">
        <div class="ma-stage" data-stage="uploading" style="padding:6px 0;color:#aaa;font-size:13px;">⏳ 사진 업로드</div>
        <div class="ma-stage" data-stage="space_analysis" style="padding:6px 0;color:#aaa;font-size:13px;">⏳ 벽면 분석</div>
        <div class="ma-stage" data-stage="design" style="padding:6px 0;color:#aaa;font-size:13px;">⏳ 모듈 배치 계산</div>
        <div class="ma-stage" data-stage="image_gen" style="padding:6px 0;color:#aaa;font-size:13px;">⏳ 가구 이미지 생성</div>
        <div class="ma-stage" data-stage="quote" style="padding:6px 0;color:#aaa;font-size:13px;">⏳ 견적 계산</div>
      </div>
      <p id="multiagentCurrentLabel" style="color:#6366F1;margin:16px 0 0;font-size:14px;font-weight:500;">시작 중...</p>
    </div>
  `;
        document.body.appendChild(modal);
      }

      function updateMultiagentProgress(stage, label) {
        const stages = document.querySelectorAll('#multiagentStages .ma-stage');
        let found = false;
        stages.forEach(el => {
          if (el.dataset.stage === stage) {
            el.style.color = '#6366F1';
            el.style.fontWeight = '600';
            el.textContent = '🔄 ' + el.textContent.substring(2);
            found = true;
          } else if (!found) {
            el.style.color = '#10b981';
            el.textContent = '✅ ' + el.textContent.substring(2);
          }
        });
        const labelEl = document.getElementById('multiagentCurrentLabel');
        if (labelEl && label) labelEl.textContent = label;
      }

      function hideMultiagentProgressModal() {
        const modal = document.getElementById('multiagentProgressModal');
        if (modal) modal.remove();
      }

      function showMultiagentResult(data) {
        const existing = document.querySelector('.ai-design-result-modal');
        if (existing) existing.remove();

        // 이미지 추출
        const images = data.images || [];
        const furnitureImg = images.find(i => i.type === 'furniture');
        const openImg = images.find(i => i.type === 'open');
        const altStyleImg = images.find(i => i.type === 'alt_style');
        const originalImg = images.find(i => i.type === 'original');

        const closedImageUrl = furnitureImg?.image_url || '';
        const openImageUrl = openImg?.image_url || '';
        const altStyleUrl = altStyleImg?.image_url || '';
        const hasOpenImage = !!openImageUrl;
        const hasAltStyle = !!altStyleUrl;

        // 분석 데이터
        const spaceAnalysis = data.space_analysis;
        const layout = data.layout;
        const quote = data.quote;

        const modal = document.createElement('div');
        modal.className = 'ai-design-result-modal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';

        // 탭 구성
        const tabs = ['가구 이미지'];
        if (hasAltStyle) tabs.push('대체 스타일');
        if (hasOpenImage) tabs.push('오픈도어');
        if (spaceAnalysis) tabs.push('벽면 분석');
        if (layout) tabs.push('레이아웃');
        if (quote) tabs.push('견적');

        const tabButtons = tabs.map((t, i) =>
          `<button onclick="switchMultiagentTab(${i})" class="ma-tab-btn${i === 0 ? ' active' : ''}" style="padding:8px 16px;border:none;background:${i === 0 ? '#6366F1' : '#f3f4f6'};color:${i === 0 ? '#fff' : '#666'};border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">${t}</button>`
        ).join('');

        // 견적 테이블 HTML
        let quoteHtml = '';
        if (quote) {
          const breakdown = quote.breakdown || {};
          const rows = Object.entries(breakdown).map(([k, v]) =>
            `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;">${k}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${(v || 0).toLocaleString()}원</td></tr>`
          ).join('');
          quoteHtml = `
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr><th style="padding:8px 12px;text-align:left;background:#f9fafb;border-bottom:2px solid #e5e7eb;">항목</th><th style="padding:8px 12px;text-align:right;background:#f9fafb;border-bottom:2px solid #e5e7eb;">금액</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td style="padding:12px;font-weight:700;font-size:16px;border-top:2px solid #333;">합계</td><td style="padding:12px;text-align:right;font-weight:700;font-size:16px;border-top:2px solid #333;color:#6366F1;">${(quote.total || 0).toLocaleString()}원</td></tr></tfoot>
      </table>`;
        }

        // 벽면 분석 HTML
        let analysisHtml = '';
        if (spaceAnalysis) {
          const pipes = spaceAnalysis.pipes || spaceAnalysis.utilities || [];
          const pipeRows = (Array.isArray(pipes) ? pipes : []).map(p =>
            `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">
              <span>${p.type || p.name || '배관'}</span>
              <span style="font-weight:600;">${p.from_origin_mm || p.position || '-'}mm</span>
            </div>`
          ).join('');
          analysisHtml = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:#f0f9ff;padding:12px;border-radius:8px;"><span style="font-size:11px;color:#666;">벽면 너비</span><div style="font-size:20px;font-weight:700;color:#0369a1;">${spaceAnalysis.wall_width_mm || '-'}mm</div></div>
        <div style="background:#f0fdf4;padding:12px;border-radius:8px;"><span style="font-size:11px;color:#666;">벽 형태</span><div style="font-size:20px;font-weight:700;color:#065f46;">${spaceAnalysis.wall_layout || '-'}</div></div>
      </div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">배관 위치</div>
      ${pipeRows || '<div style="color:#999;font-size:13px;">감지된 배관 없음</div>'}`;
        }

        // 레이아웃 HTML
        let layoutHtml = '';
        if (layout) {
          const modules = layout.modules || [];
          const moduleRows = modules.map((m, i) =>
            `<div style="display:flex;align-items:center;gap:8px;padding:8px;background:${i % 2 === 0 ? '#f9fafb' : '#fff'};border-radius:6px;">
              <span style="width:24px;height:24px;background:#6366F1;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;">${i + 1}</span>
              <span style="flex:1;font-size:13px;">${m.type || '모듈'}</span>
              <span style="font-weight:600;font-size:13px;">${m.width || '-'}mm</span>
            </div>`
          ).join('');
          layoutHtml = `
      <div style="margin-bottom:12px;background:#f0f9ff;padding:12px;border-radius:8px;">
        <span style="font-size:11px;color:#666;">총 너비</span>
        <div style="font-size:20px;font-weight:700;color:#0369a1;">${layout.total_width || '-'}mm</div>
      </div>
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">모듈 구성</div>
      ${moduleRows || '<div style="color:#999;">모듈 정보 없음</div>'}`;
        }

        modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:900px;width:95%;max-height:95vh;overflow:hidden;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid #EBE8E2;">
        <h3 style="margin:0;font-size:18px;color:#2D2A26;">🤖 AI 시뮬레이션 결과</h3>
        <button onclick="this.closest('.ai-design-result-modal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#8B8680;line-height:1;">&times;</button>
      </div>
      <div style="display:flex;gap:8px;padding:12px 24px;border-bottom:1px solid #f3f4f6;flex-wrap:wrap;">
        ${tabButtons}
      </div>
      <div style="padding:24px;overflow-y:auto;flex:1;">
        <div class="ma-tab-content" data-tab="0">
          ${closedImageUrl ? `<img src="${closedImageUrl}" style="width:100%;border-radius:12px;max-height:500px;object-fit:contain;" alt="가구 이미지">` : '<p style="text-align:center;color:#999;">이미지가 생성되지 않았습니다.</p>'}
        </div>
        ${hasAltStyle ? `<div class="ma-tab-content" data-tab="${tabs.indexOf('대체 스타일')}" style="display:none;">
          <img src="${altStyleUrl}" style="width:100%;border-radius:12px;max-height:500px;object-fit:contain;" alt="대체 스타일">
          <p style="text-align:center;color:#888;font-size:12px;margin-top:8px;">하부장 컬러 + 상부장 무채색 투톤 스타일</p>
        </div>` : ''}
        ${hasOpenImage ? `<div class="ma-tab-content" data-tab="${tabs.indexOf('오픈도어')}" style="display:none;">
          <img src="${openImageUrl}" style="width:100%;border-radius:12px;max-height:500px;object-fit:contain;" alt="오픈도어 이미지">
        </div>` : ''}
        ${spaceAnalysis ? `<div class="ma-tab-content" data-tab="${tabs.indexOf('벽면 분석')}" style="display:none;">${analysisHtml}</div>` : ''}
        ${layout ? `<div class="ma-tab-content" data-tab="${tabs.indexOf('레이아웃')}" style="display:none;">${layoutHtml}</div>` : ''}
        ${quote ? `<div class="ma-tab-content" data-tab="${tabs.indexOf('견적')}" style="display:none;">${quoteHtml}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;padding:16px 24px;border-top:1px solid #EBE8E2;justify-content:flex-end;">
        ${closedImageUrl ? `<button onclick="downloadMultiagentImage('${closedImageUrl}', 'furniture')" style="padding:10px 20px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">📥 가구 이미지 저장</button>` : ''}
        ${hasAltStyle ? `<button onclick="downloadMultiagentImage('${altStyleUrl}', 'alt_style')" style="padding:10px 20px;background:#f59e0b;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">📥 대체 스타일 저장</button>` : ''}
        ${hasOpenImage ? `<button onclick="downloadMultiagentImage('${openImageUrl}', 'open')" style="padding:10px 20px;background:#6366F1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">📥 오픈도어 저장</button>` : ''}
        <button onclick="this.closest('.ai-design-result-modal').remove()" style="padding:10px 20px;background:#f3f4f6;color:#666;border:none;border-radius:8px;cursor:pointer;font-weight:600;">닫기</button>
      </div>
    </div>
  `;
        document.body.appendChild(modal);
      }

      function switchMultiagentTab(idx) {
        document.querySelectorAll('.ma-tab-content').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.ma-tab-btn').forEach((btn, i) => {
          btn.style.background = i === idx ? '#6366F1' : '#f3f4f6';
          btn.style.color = i === idx ? '#fff' : '#666';
          if (i === idx) btn.classList.add('active');
          else btn.classList.remove('active');
        });
        const target = document.querySelector(`.ma-tab-content[data-tab="${idx}"]`);
        if (target) target.style.display = 'block';
      }

      function downloadMultiagentImage(url, type) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `dadam_${type}_${Date.now()}.png`;
        a.click();
      }

      // AI 생성 로딩 모달 표시
      function showAIGeneratingModal() {
        // 기존 모달 제거
        const existing = document.getElementById('aiGeneratingModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'aiGeneratingModal';
        modal.style.cssText =
          'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:40px 60px;text-align:center;max-width:400px;">
      <div style="width:60px;height:60px;margin:0 auto 20px;border:4px solid #EBE8E2;border-top-color:#6366F1;border-radius:50%;animation:spin 1s linear infinite;"></div>
      <h3 style="font-size:18px;margin:0 0 12px;color:#2D2A26;">🎨 AI 디자인 생성 중...</h3>
      <p style="color:#8B8680;margin:0;font-size:14px;">설계 데이터를 분석하고 있습니다</p>
    </div>
  `;
        document.body.appendChild(modal);
      }

      // AI 생성 로딩 모달 숨기기
      function hideAIGeneratingModal() {
        const modal = document.getElementById('aiGeneratingModal');
        if (modal) modal.remove();
      }

      // AI 디자인 결과 표시
      function showAIDesignResult(data) {
        // 기존 모달 제거
        const existing = document.querySelector('.ai-design-result-modal');
        if (existing) existing.remove();

        // 이미지 URL 추출
        let closedImageUrl = '';
        let openImageUrl = '';

        if (data.generated_image) {
          // 닫힌 도어 이미지
          if (data.generated_image.closed && data.generated_image.closed.base64) {
            const mimeType = data.generated_image.closed.mime_type || 'image/png';
            closedImageUrl = `data:${mimeType};base64,${data.generated_image.closed.base64}`;
          } else if (data.generated_image.base64) {
            const mimeType = data.generated_image.mime_type || 'image/png';
            closedImageUrl = `data:${mimeType};base64,${data.generated_image.base64}`;
          }
          // 열린 도어 이미지
          if (data.generated_image.open && data.generated_image.open.base64) {
            const mimeType = data.generated_image.open.mime_type || 'image/png';
            openImageUrl = `data:${mimeType};base64,${data.generated_image.open.base64}`;
          }
        } else if (data.image_url) {
          closedImageUrl = data.image_url;
        }

        const hasOpenImage = !!openImageUrl;

        const modal = document.createElement('div');
        modal.className = 'ai-design-result-modal';
        modal.style.cssText =
          'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:10000;';
        modal.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:900px;width:95%;max-height:95vh;overflow:hidden;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid #EBE8E2;">
        <h3 style="margin:0;font-size:18px;color:#2D2A26;">🎨 AI 디자인 결과</h3>
        <button onclick="this.closest('.ai-design-result-modal').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#8B8680;line-height:1;">&times;</button>
      </div>
      <div style="padding:24px;overflow-y:auto;flex:1;">
        ${closedImageUrl ? `
        <!-- 이미지 뷰어 -->
        <div style="position:relative;margin-bottom:16px;">
          <!-- 상태 표시 -->
          <div style="display:flex;justify-content:center;gap:8px;margin-bottom:12px;">
            <span id="aiResultStatus" style="background:#6366F1;color:#fff;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:500;">
              🚪 닫힌 도어
            </span>
          </div>

          <!-- 이미지 컨테이너 -->
          <div style="position:relative;display:flex;align-items:center;justify-content:center;">
            ${hasOpenImage ? `<button onclick="aiResultPrevImage()" style="position:absolute;left:8px;z-index:10;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.9);border:none;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);">◀</button>` : ''}
            <img id="aiResultImage"
                 src="${closedImageUrl}"
                 data-closed="${closedImageUrl}"
                 data-open="${openImageUrl}"
                 data-state="closed"
                 style="width:100%;max-height:60vh;object-fit:contain;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.1);">
            ${hasOpenImage ? `<button onclick="aiResultNextImage()" style="position:absolute;right:8px;z-index:10;width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.9);border:none;font-size:18px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.15);">▶</button>` : ''}
          </div>

          ${hasOpenImage ? `
          <!-- 인디케이터 -->
          <div style="display:flex;justify-content:center;gap:8px;margin-top:12px;">
            <div id="aiDot0" onclick="aiResultGoToImage(0)" style="width:10px;height:10px;border-radius:50%;background:#6366F1;cursor:pointer;transition:all 0.2s;"></div>
            <div id="aiDot1" onclick="aiResultGoToImage(1)" style="width:10px;height:10px;border-radius:50%;background:#D1D5DB;cursor:pointer;transition:all 0.2s;"></div>
          </div>
          <div style="text-align:center;margin-top:8px;font-size:12px;color:#8B8680;">
            ◀ ▶ 화살표로 닫힌 도어 / 열린 도어 전환
          </div>
          ` : ''}
        </div>
        ` : ''}

        <div style="background:#F8F7F4;padding:16px;border-radius:12px;color:#2D2A26;line-height:1.7;">
          ${data.analysis || data.message || data.output || '디자인이 생성되었습니다.'}
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:12px;padding:16px 24px;border-top:1px solid #EBE8E2;">
        ${closedImageUrl ? `
          <button onclick="downloadAIDesignImage('closed')" style="padding:12px 24px;background:#6366F1;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">💾 닫힌 도어 저장</button>
          ${hasOpenImage ? `<button onclick="downloadAIDesignImage('open')" style="padding:12px 24px;background:#10B981;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">💾 열린 도어 저장</button>` : ''}
        ` : ''}
        <button onclick="proceedToBOM()" style="padding:12px 24px;background:linear-gradient(135deg,#6366F1,#4F46E5);color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;font-weight:bold;">📋 BOM 산출하기 →</button>
        <button onclick="this.closest('.ai-design-result-modal').remove()" style="padding:12px 24px;background:#EBE8E2;color:#2D2A26;border:none;border-radius:10px;font-size:14px;cursor:pointer;">닫기</button>
      </div>
    </div>
  `;

        // 결과 데이터 저장 (다운로드용)
        window._aiDesignResult = data;
        window._aiDesignImages = { closed: closedImageUrl, open: openImageUrl };

        document.body.appendChild(modal);

        // 모달 외부 클릭시 닫기 - 비활성화 (이미지 확인 중 실수로 닫히는 것 방지)
        // modal.addEventListener('click', (e) => {
        //   if (e.target === modal) modal.remove();
        // });
      }

      // AI 결과 이미지 네비게이션
      function aiResultGoToImage(index) {
        const img = document.getElementById('aiResultImage');
        const status = document.getElementById('aiResultStatus');
        if (!img) return;

        const closedUrl = img.dataset.closed;
        const openUrl = img.dataset.open;

        if (index === 0) {
          img.src = closedUrl;
          img.dataset.state = 'closed';
          status.innerHTML = '🚪 닫힌 도어';
          status.style.background = '#6366F1';
        } else if (index === 1 && openUrl) {
          img.src = openUrl;
          img.dataset.state = 'open';
          status.innerHTML = '🚪 열린 도어';
          status.style.background = '#10B981';
        }

        // 인디케이터 업데이트
        document.getElementById('aiDot0').style.background = index === 0 ? '#6366F1' : '#D1D5DB';
        document.getElementById('aiDot1').style.background = index === 1 ? '#10B981' : '#D1D5DB';
      }

      function aiResultNextImage() {
        const img = document.getElementById('aiResultImage');
        if (!img) return;
        const currentState = img.dataset.state;
        aiResultGoToImage(currentState === 'closed' ? 1 : 0);
      }

      function aiResultPrevImage() {
        const img = document.getElementById('aiResultImage');
        if (!img) return;
        const currentState = img.dataset.state;
        aiResultGoToImage(currentState === 'closed' ? 1 : 0);
      }

      // AI 디자인 이미지 다운로드
      function downloadAIDesignImage(type = 'closed') {
        const images = window._aiDesignImages;
        if (!images) return;

        const imageUrl = type === 'open' ? images.open : images.closed;
        if (!imageUrl) return;

        const suffix = type === 'open' ? '-open' : '-closed';
        const a = document.createElement('a');
        a.href = imageUrl;
        a.download = `ai-design${suffix}-${new Date().toISOString().slice(0, 10)}.png`;
        a.click();
      }

      // ============================================================
      // 설계 완료 보고서 (통합 자재 추출 시스템 V2)
      // ============================================================
      function showDesignCompleteReport() {
        proceedToBOM();
      }

      // 보고서 탭 생성
      function generateReportTabs(matResult, hwResult, design) {
        const catNames = { sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장' };
        const projectName = design.items.length > 1
          ? design.items.map(it => it.labelName || catNames[it.categoryId || it.category] || it.category).join(' + ')
          : `${design.items[0].name || design.items[0].category} ${design.items[0].w}×${design.items[0].h}`;

        // 6. CNC 재단 목록 탭 (먼저 생성 — window._cncData를 요약 탭에서 참조)
        const cncTab = generateCNCTab(matResult.materials);

        // 1. 요약 탭 (CNC 결과 반영)
        const summaryTab = generateSummaryTab(matResult, hwResult, design);

        // 2. 본체 자재 탭
        const bodyTab = generateBodyMaterialTab(matResult.materials);

        // 3. 도어 자재 탭
        const doorTab = generateDoorMaterialTab(matResult.materials);

        // 4. EP 자재 탭
        const epTab = generateEPMaterialTab(matResult.materials);

        // 5. 부자재 탭
        const hardwareTab = generateHardwareTab(hwResult);

        return `
    <div style="margin-bottom:15px;">
      <div style="font-size:20px;font-weight:bold;color:#1976d2;margin-bottom:5px;">📋 설계 완료 보고서</div>
      <div style="font-size:13px;color:#666;">프로젝트: ${projectName} | 추출일시: ${new Date().toLocaleString('ko-KR')}</div>
    </div>
    <div class="report-tabs" style="display:flex;border-bottom:2px solid #1976d2;margin-bottom:15px;">
      <button class="report-tab active" onclick="switchReportTab(this, 'summary')" style="padding:10px 20px;border:none;background:#1976d2;color:white;font-weight:bold;cursor:pointer;border-radius:8px 8px 0 0;">📊 요약</button>
      <button class="report-tab" onclick="switchReportTab(this, 'body')" style="padding:10px 20px;border:none;background:#e3f2fd;color:#1976d2;font-weight:bold;cursor:pointer;border-radius:8px 8px 0 0;margin-left:4px;">🪵 본체</button>
      <button class="report-tab" onclick="switchReportTab(this, 'door')" style="padding:10px 20px;border:none;background:#e3f2fd;color:#1976d2;font-weight:bold;cursor:pointer;border-radius:8px 8px 0 0;margin-left:4px;">🚪 도어</button>
      <button class="report-tab" onclick="switchReportTab(this, 'ep')" style="padding:10px 20px;border:none;background:#e3f2fd;color:#1976d2;font-weight:bold;cursor:pointer;border-radius:8px 8px 0 0;margin-left:4px;">📐 EP</button>
      <button class="report-tab" onclick="switchReportTab(this, 'hardware')" style="padding:10px 20px;border:none;background:#e3f2fd;color:#1976d2;font-weight:bold;cursor:pointer;border-radius:8px 8px 0 0;margin-left:4px;">🔩 부자재</button>
      <button class="report-tab" onclick="switchReportTab(this, 'cnc')" style="padding:10px 20px;border:none;background:#e3f2fd;color:#1976d2;font-weight:bold;cursor:pointer;border-radius:8px 8px 0 0;margin-left:4px;">✂️ CNC 재단</button>
    </div>
    <div id="report-content-summary" class="report-content">${summaryTab}</div>
    <div id="report-content-body" class="report-content" style="display:none;">${bodyTab}</div>
    <div id="report-content-door" class="report-content" style="display:none;">${doorTab}</div>
    <div id="report-content-ep" class="report-content" style="display:none;">${epTab}</div>
    <div id="report-content-hardware" class="report-content" style="display:none;">${hardwareTab}</div>
    <div id="report-content-cnc" class="report-content" style="display:none;">${cncTab}</div>
  `;
      }

      // 탭 전환
      function switchReportTab(btn, tabId) {
        // 모든 탭 버튼 비활성화
        document.querySelectorAll('.report-tab').forEach((t) => {
          t.style.background = '#e3f2fd';
          t.style.color = '#1976d2';
          t.classList.remove('active');
        });
        // 클릭된 탭 활성화
        btn.style.background = '#1976d2';
        btn.style.color = 'white';
        btn.classList.add('active');

        // 모든 콘텐츠 숨김
        document.querySelectorAll('.report-content').forEach((c) => (c.style.display = 'none'));
        // 선택된 콘텐츠 표시
        document.getElementById('report-content-' + tabId).style.display = 'block';
      }

      // 요약 탭 생성
      function generateSummaryTab(matResult, hwResult, design) {
        const summary = matResult.summary;
        const allItems = design.items || [];
        const item = allItems[0];
        // ★ categoryId 사용
        const category = item.categoryId || item.category;

        // 패널 사용량 카드 (CNC 재단 결과 기반)
        let panelCards = '';
        const cncData = window._cncData;
        if (Object.keys(summary).length === 0) {
          panelCards = '<div style="color:#999;font-size:13px;">자재 정보 없음</div>';
        } else if (cncData && cncData.panelDetails) {
          // 실제 재단 결과 — 자재별(PB/MDF) 그룹 분리 표시
          const groupMap = new Map();
          cncData.panelDetails.forEach(p => {
            // "MDF 2.7T [뒷판]" → 자재키 "MDF 2.7T"
            const matKey = p.group.replace(/\s*\[.*\]$/, '');
            if (!groupMap.has(matKey)) groupMap.set(matKey, { panels: 0, produced: 0, needed: 0 });
            const g = groupMap.get(matKey);
            g.panels += p.stack;
            p.strips.forEach(st => st.pieces.forEach(pc => { g.produced += pc.count * p.stack; }));
          });
          // needed는 sorted에서 계산
          cncData.sorted.forEach(m => {
            const matKey = `${m.material} ${m.thickness}T`;
            if (groupMap.has(matKey)) groupMap.get(matKey).needed += m.qty;
          });
          const colors = { 'PB': ['#667eea', '#764ba2'], 'MDF 18': ['#f57c00', '#e65100'], 'MDF 2.7': ['#43a047', '#2e7d32'] };
          groupMap.forEach((g, matKey) => {
            const sheetArea = g.panels * 1220 * 2440;
            const colorKey = Object.keys(colors).find(k => matKey.startsWith(k)) || 'PB';
            const [c1, c2] = colors[colorKey];
            panelCards += `
        <div style="background:linear-gradient(135deg, ${c1} 0%, ${c2} 100%);color:white;padding:15px;border-radius:10px;min-width:130px;">
          <div style="font-size:12px;opacity:0.9;">${matKey}</div>
          <div style="font-size:28px;font-weight:bold;margin:5px 0;">${g.panels}장</div>
          <div style="font-size:10px;opacity:0.7;margin-top:4px;">생산 ${g.produced}/${g.needed}개</div>
        </div>
      `;
          });
        } else {
          // 폴백: 면적 기반 추정
          Object.values(summary).forEach((s) => {
            const area = (s.totalArea / 1000000).toFixed(2);
            const efficiency = ((s.totalArea / (s.panelCount * 1220 * 2440)) * 100).toFixed(1);
            panelCards += `
        <div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);color:white;padding:15px;border-radius:10px;min-width:150px;">
          <div style="font-size:12px;opacity:0.9;">${s.material} ${s.thickness}T</div>
          <div style="font-size:28px;font-weight:bold;margin:5px 0;">${s.panelCount}장</div>
          <div style="font-size:11px;opacity:0.8;">${area}㎡ (효율 ${efficiency}%)</div>
        </div>
      `;
          });
        }

        // 부자재 요약
        let hwSummary = '';
        Object.entries(hwResult.summary || {}).forEach(([cat, qty]) => {
          hwSummary += `<span style="background:#fff3e0;color:#e65100;padding:4px 10px;border-radius:15px;font-size:12px;margin-right:5px;">${cat}: ${qty}</span>`;
        });

        // 모듈 수 계산 (카테고리별)
        let moduleInfo = '';
        if (category === 'sink') {
          const upperCount = (item.modules || []).filter((m) => m.pos === 'upper').length;
          const lowerCount = (item.modules || []).filter((m) => m.pos === 'lower').length;
          moduleInfo = `
      <div><span style="color:#666;">상부장 수:</span> <strong>${upperCount}개</strong></div>
      <div><span style="color:#666;">하부장 수:</span> <strong>${lowerCount}개</strong></div>
    `;
        } else if (category === 'wardrobe') {
          const wardrobeCount = (item.modules || []).filter(
            (m) => m.pos === 'wardrobe' || m.type === 'wardrobe'
          ).length;
          const shortCount = (item.modules || []).filter((m) => m.moduleType === 'short').length;
          const longCount = (item.modules || []).filter((m) => m.moduleType === 'long').length;
          const shelfCount = (item.modules || []).filter((m) => m.moduleType === 'shelf').length;
          moduleInfo = `
      <div><span style="color:#666;">총 모듈 수:</span> <strong>${wardrobeCount}개</strong></div>
      <div><span style="color:#666;">짧은옷/긴옷/선반:</span> <strong>${shortCount}/${longCount}/${shelfCount}</strong></div>
    `;
        } else if (category === 'fridge') {
          const moduleCount = (item.modules || []).filter((m) => m.type !== 'fridge').length;
          moduleInfo = `
      <div><span style="color:#666;">모듈 수:</span> <strong>${moduleCount}개</strong></div>
      <div><span style="color:#666;">냉장고 타입:</span> <strong>${item.specs?.fridgeModel || '-'}</strong></div>
    `;
        }

        const totalParts = matResult.materials.length;

        // 품목 목록 (여러 품목 지원)
        const catNames = { sink: '싱크대', wardrobe: '붙박이장', fridge: '냉장고장' };
        let itemListHTML = '';
        if (allItems.length > 1) {
          itemListHTML = `
      <div style="background:#f8f9fa;padding:20px;border-radius:12px;border:1px solid #e0e0e0;grid-column:1/-1;">
        <h4 style="margin:0 0 15px 0;color:#333;">📋 포함 품목 (${allItems.length}개)</h4>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">`;
          allItems.forEach((it, idx) => {
            const cat = it.categoryId || it.category;
            const label = it.labelName || catNames[cat] || cat;
            const upperCnt = (it.modules || []).filter(m => m.pos === 'upper').length;
            const lowerCnt = (it.modules || []).filter(m => m.pos === 'lower' || m.pos === 'wardrobe').length;
            const matCount = matResult.materials.filter(m => m.itemLabel === label).length;
            itemListHTML += `
          <div style="background:white;border:1px solid #e0e0e0;border-radius:8px;padding:12px;min-width:200px;">
            <div style="font-weight:bold;color:#1976d2;margin-bottom:4px;">${label}</div>
            <div style="font-size:12px;color:#666;">크기: ${it.w}×${it.h}×${it.d}</div>
            <div style="font-size:12px;color:#666;">모듈: 상부 ${upperCnt} / 하부 ${lowerCnt}</div>
            <div style="font-size:12px;color:#666;">부품: ${matCount}개</div>
          </div>`;
          });
          itemListHTML += `</div></div>`;
        }

        return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:20px;">
      ${itemListHTML}
      <div style="background:#f8f9fa;padding:20px;border-radius:12px;border:1px solid #e0e0e0;">
        <h4 style="margin:0 0 15px 0;color:#333;display:flex;align-items:center;gap:8px;">📦 패널 사용량</h4>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">${panelCards}</div>
      </div>

      <div style="background:#f8f9fa;padding:20px;border-radius:12px;border:1px solid #e0e0e0;">
        <h4 style="margin:0 0 15px 0;color:#333;display:flex;align-items:center;gap:8px;">📐 설계 정보</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;">
          <div><span style="color:#666;">가구 유형:</span> <strong>${allItems.length > 1 ? allItems.length + '개 품목' : (item.name || item.category)}</strong></div>
          <div><span style="color:#666;">전체 크기:</span> <strong>${item.w} × ${item.h} × ${item.d}</strong></div>
          ${moduleInfo}
          <div><span style="color:#666;">총 부품 수:</span> <strong>${totalParts}개</strong></div>
          <div><span style="color:#666;">부자재 품목:</span> <strong>${hwResult.hardware?.length || 0}개</strong></div>
        </div>
      </div>
    </div>
    
    <div style="margin-top:20px;background:#e8f5e9;padding:15px;border-radius:10px;border:1px solid #c8e6c9;">
      <h4 style="margin:0 0 10px 0;color:#2e7d32;">🔩 부자재 요약</h4>
      <div>${hwSummary || '<span style="color:#666;">부자재 정보 없음</span>'}</div>
    </div>
    
    <div style="margin-top:20px;background:#fff8e1;padding:15px;border-radius:10px;border:1px solid #ffe082;">
      <h4 style="margin:0 0 10px 0;color:#f57c00;">💡 참고사항</h4>
      <ul style="margin:0;padding-left:20px;font-size:12px;color:#666;">
        <li>패널 규격: 1220 × 2440 mm (4×8 합판 기준)</li>
        <li>본체 자재: PB (파티클보드) 18T 기준</li>
        <li>도어 자재: MDF 18T 기준</li>
        <li>뒷판 자재: MDF 2.7T 기준 (홈카페/오픈장은 18T)</li>
      </ul>
    </div>
  `;
      }

      // CNC 재단 목록 탭
      // 부품명 → 원판 유형 분류 (본체/도어/뒷판)
      function getPartType(partName) {
        if (/도어/.test(partName)) return '도어';
        if (/뒷판|서랍밑판/.test(partName)) return '뒷판';
        if (/몰딩|걸레받이|목찬넬|마감/.test(partName)) return '도어';
        return '본체';
      }

      function generateCNCTab(materials) {
        // 70mm 이하 얇은 부품(밴드, 보강재 등) 분리
        const cncParts = materials.filter(m => m.w > 70 && m.h > 70);
        // 소부품(보강목, 덧대 등) 수집 — 잔재에서 추출 대상
        const smallParts = materials.filter(m => (m.w <= 70 || m.h <= 70) && m.w > 0 && m.h > 0);
        const smallByGroup = new Map();
        smallParts.forEach(m => {
          const gKey = `${m.material} ${m.thickness}T [${getPartType(m.part)}]`;
          if (!smallByGroup.has(gKey)) smallByGroup.set(gKey, []);
          const list = smallByGroup.get(gKey);
          const existing = list.find(s => s.part === m.part && s.w === m.w && s.h === m.h);
          if (existing) { existing.qty += m.qty; existing.remain += m.qty; }
          else { list.push({ part: m.part, module: m.module || '', w: m.w, h: m.h, qty: m.qty, remain: m.qty }); }
        });

        if (cncParts.length === 0)
          return '<p style="color:#666;text-align:center;padding:40px;">CNC 재단 대상 자재가 없습니다.</p>';

        // 자재+두께+유형+가로+세로 기준으로 합산 (엣지도 보존)
        const map = new Map();
        cncParts.forEach(m => {
          const pType = getPartType(m.part);
          const key = `${m.material}|${m.thickness}|${pType}|${m.w}|${m.h}`;
          if (map.has(key)) {
            const agg = map.get(key);
            agg.qty += m.qty;
            if (!agg.parts.includes(m.part)) agg.parts.push(m.part);
            // 엣지 병합
            if (m.edge && m.edge !== '-' && !agg.edges.includes(m.edge)) agg.edges.push(m.edge);
            // 품목 라벨 병합
            if (m.itemLabel && !agg.itemLabels.includes(m.itemLabel)) agg.itemLabels.push(m.itemLabel);
          } else {
            map.set(key, {
              material: m.material,
              thickness: m.thickness,
              partType: pType,
              w: m.w,
              h: m.h,
              qty: m.qty,
              parts: [m.part],
              edges: (m.edge && m.edge !== '-') ? [m.edge] : [],
              itemLabels: m.itemLabel ? [m.itemLabel] : []
            });
          }
        });

        // 정렬: 자재 → 두께 → 가로(큰 순) → 세로(큰 순)
        const sorted = [...map.values()].sort((a, b) =>
          a.material.localeCompare(b.material) || a.thickness - b.thickness || b.w - a.w || b.h - a.h
        );

        // 자재+두께+유형 그룹별 소계 (본체/도어/뒷판 원판 분리)
        const groups = new Map();
        sorted.forEach(m => {
          const gk = `${m.material} ${m.thickness}T [${m.partType}]`;
          if (!groups.has(gk)) groups.set(gk, []);
          groups.get(gk).push(m);
        });

        // totalCuts는 테이블 렌더 후 totalHCuts + totalVCuts로 계산

        let tableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#fce4ec;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">자재</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">두께</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">가로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">세로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">총수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">겹침</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">가로재단</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">세로재단</th>
          <th style="border:1px solid #ddd;padding:10px;">용도</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">엣지</th>
        </tr>
      </thead>
      <tbody>`;

        let no = 0;
        let totalHCuts = 0, totalVCuts = 0;
        groups.forEach((items, groupName) => {
          // 그룹 헤더
          tableHTML += `
      <tr style="background:#f8bbd0;">
        <td colspan="11" style="border:1px solid #ddd;padding:8px;font-weight:bold;color:#c2185b;">📦 ${groupName} (${items.length}종)</td>
      </tr>`;
          items.forEach(m => {
            no++;
            const stack = Math.min(m.qty, 5);
            const rounds = Math.ceil(m.qty / 5);
            // 가로재단: 세로(H)방향 절단 → 스트립 분리 (1회 × rounds)
            const hCuts = rounds;
            // 세로재단: 가로(W)방향 절단 → 부품 분리 (부품수 × rounds)
            // 한 스트립에서 동일 부품 몇 개 나오는지 계산
            const perStrip = Math.floor(1220 / m.w) || 1;
            const vCuts = rounds * Math.min(perStrip, Math.ceil(m.qty / rounds));
            totalHCuts += hCuts;
            totalVCuts += vCuts;
            tableHTML += `
      <tr style="background:${no % 2 === 0 ? '#fff' : '#f9f9f9'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${no}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#1976d2;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${stack}장</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;color:#e65100;">${hCuts}회</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;color:#c2185b;font-weight:bold;">${vCuts}회</td>
        <td style="border:1px solid #ddd;padding:8px;font-size:11px;">${m.parts.join(', ')}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-size:11px;">${m.edges.length > 0 ? m.edges.join(', ') : '-'}</td>
      </tr>`;
          });
        });

        tableHTML += '</tbody></table>';

        // ===== 원판 배치 계획 (겹침 재단 + 나머지 활용) =====
        const PANEL_W = 1220, PANEL_H = 2440;
        let planHTML = '';
        let totalPanels = 0;
        let totalProduced = 0;
        let totalNeeded = 0;
        let totalHPanels = 0, totalVPanels = 0;
        let totalThinLen = 0;
        const allRemnants = [];   // 전체 잔재 수집
        const allThinStrips = []; // 전체 자투리(60~70mm) 수집
        const panelDetails = [];  // 엑셀 다운로드용 패널 상세
        let cncAllocResults = []; // 엑셀용 소부품 추출 결과
        let cncStillNeeded = [];  // 엑셀용 미충족 목록

        groups.forEach((items, groupName) => {
          const groupNeeded = items.reduce((s, m) => s + m.qty, 0);
          totalNeeded += groupNeeded;
          const groupSmalls = smallByGroup.get(groupName) || [];
          const { panels, unallocated } = calcCuttingPlan(items, PANEL_W, PANEL_H, groupSmalls);
          const groupPanelCount = panels.reduce((s, p) => s + p.stack, 0);
          totalPanels += groupPanelCount;

          // 그룹별 생산 수량 집계
          let groupProduced = 0;
          panels.forEach(panel => {
            panel.strips.forEach(strip => {
              strip.pieces.forEach(p => { groupProduced += p.count * panel.stack; });
            });
          });
          totalProduced += groupProduced;

          planHTML += `<div style="margin-bottom:20px;">`;
          // 그룹 전체 절단 횟수 합산
          let groupTotalCuts = 0;
          panels.forEach(p => {
            const sc = p.strips.length;
            let pc = 0;
            p.strips.forEach(st => { const tp = st.pieces.reduce((s, pp) => s + pp.count, 0); pc += Math.max(0, tp - 1); });
            groupTotalCuts += sc + pc;
          });
          planHTML += `<div style="font-weight:bold;color:#c2185b;font-size:13px;margin-bottom:8px;">📦 ${groupName} — 원판 ${groupPanelCount}장 (${panels.length}종 배치, ${groupProduced}/${groupNeeded}개 생산, ✂ ${groupTotalCuts}회 절단)</div>`;

          panels.forEach(panel => {
            const usedPct = ((panel.usedArea / (PANEL_W * PANEL_H)) * 100).toFixed(1);
            const stackLabel = panel.stack > 1 ? `${panel.stack}장 겹침` : '1장';
            const dirLabel = panel.dir === 'H' ? '가로→세로' : '세로→가로';
            const rotLabel = panel.rotated ? ' 회전' : '';
            const dirColor = panel.dir === 'H' ? '#1976d2' : '#7b1fa2';
            if (panel.dir === 'H') totalHPanels += panel.stack; else totalVPanels += panel.stack;
            const totalCuts = panel.strips.length + panel.strips.reduce((s, st) => s + st.pieces.reduce((ss, p) => ss + p.count, 0), 0);

            planHTML += `<div style="margin:8px 0;padding:10px;background:#f5f5f5;border-radius:8px;border-left:4px solid ${dirColor};">`;
            // 잔재/자투리 데이터 수집 (텍스트 출력 없이)
            const remnants = [];
            const thinList = [];

            if (panel.dir === 'H') {
              let trackH = PANEL_H;
              panel.strips.forEach(strip => {
                trackH -= strip.height;
                if (strip.remainW >= 60 && strip.remainW <= 70) thinList.push({ w: strip.remainW, h: strip.height, type: '세로자투리' });
                else if (strip.remainW > 70) remnants.push({ w: strip.remainW, h: strip.height });
                if (trackH >= 60 && trackH <= 70) thinList.push({ w: PANEL_W, h: trackH, type: '가로자투리' });
              });
              if (panel.panelRemain >= 60 && panel.panelRemain <= 70) thinList.push({ w: PANEL_W, h: panel.panelRemain, type: '가로자투리' });
              else if (panel.panelRemain > 70) remnants.push({ w: PANEL_W, h: panel.panelRemain });
            } else {
              let trackW = PANEL_W;
              panel.strips.forEach(strip => {
                trackW -= strip.width;
                if (strip.remainH >= 60 && strip.remainH <= 70) thinList.push({ w: strip.width, h: strip.remainH, type: '가로자투리' });
                else if (strip.remainH > 70) remnants.push({ w: strip.width, h: strip.remainH });
                if (trackW >= 60 && trackW <= 70) thinList.push({ w: trackW, h: PANEL_H, type: '세로자투리' });
              });
              if (panel.panelRemain >= 60 && panel.panelRemain <= 70) thinList.push({ w: panel.panelRemain, h: PANEL_H, type: '세로자투리' });
              else if (panel.panelRemain > 70) remnants.push({ w: panel.panelRemain, h: PANEL_H });
            }

            if (remnants.length > 0) remnants.forEach(r => allRemnants.push({ w: r.w, h: r.h, qty: panel.stack, group: groupName, panelId: panel.id }));
            if (thinList.length > 0) {
              const thinTotalLen = thinList.reduce((s, t) => s + Math.max(t.w, t.h), 0);
              totalThinLen += thinTotalLen * panel.stack;
              thinList.forEach(t => allThinStrips.push({ w: t.w, h: t.h, qty: panel.stack, group: groupName, panelId: panel.id, type: t.type }));
            }

            // SVG 재단 배치도만 표시
            planHTML += `<div style="text-align:center;">${renderCuttingPlanSVG(panel, groupName, PANEL_W, PANEL_H)}</div>`;

            planHTML += `</div>`;

            // 엑셀용 패널 상세 수집
            panelDetails.push({
              group: groupName, id: panel.id, stack: panel.stack,
              dir: panel.dir === 'H' ? '가로→세로' : '세로→가로',
              rotated: panel.rotated ? 'Y' : 'N',
              strips: panel.strips, remnants, thinList
            });
          });

          // 미배치 부품 경고
          if (unallocated.length > 0) {
            planHTML += `<div style="padding:8px;background:#ffebee;border-radius:6px;font-size:12px;color:#c62828;">`;
            planHTML += `⚠️ 미배치: ` + unallocated.map(u => `${u.parts.join(',')} ${u.w}×${u.h} ×${u.remain}`).join(', ');
            planHTML += `</div>`;
          }

          planHTML += `</div>`;
        });

        // ===== 잔재 종합 정리 =====
        if (allRemnants.length > 0 || allThinStrips.length > 0) {
          planHTML += `<div style="margin:16px 0;padding:12px;background:#fff8e1;border-radius:8px;border:1px solid #ffe082;">`;
          planHTML += `<div style="font-weight:bold;font-size:13px;margin-bottom:8px;color:#e65100;">📦 재단 잔재 종합</div>`;

          // 잔재(>70mm) 동일 규격 합산
          if (allRemnants.length > 0) {
            const remMap = new Map();
            allRemnants.forEach(r => {
              const key = `${r.group}|${r.w}×${r.h}`;
              const existing = remMap.get(key);
              if (existing) { existing.qty += r.qty; }
              else { remMap.set(key, { group: r.group, w: r.w, h: r.h, qty: r.qty }); }
            });
            const remList = [...remMap.values()].sort((a, b) => (b.w * b.h) - (a.w * a.h));
            const totalRemArea = remList.reduce((s, r) => s + r.w * r.h * r.qty, 0);

            planHTML += `<div style="font-size:12px;font-weight:bold;margin:6px 0 4px;color:#bf360c;">📐 잔여 조각 (>70mm)</div>`;
            planHTML += `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">`;
            planHTML += `<tr style="background:#fff3e0;"><th style="padding:3px 6px;text-align:left;border-bottom:1px solid #ffe082;">자재</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #ffe082;">가로</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #ffe082;">세로</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #ffe082;">수량</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #ffe082;">면적(㎠)</th><th style="padding:3px 6px;text-align:left;border-bottom:1px solid #ffe082;">활용</th></tr>`;
            remList.forEach(r => {
              const area = r.w * r.h * r.qty;
              // 잔재에서 추출 가능한 소부품 확인
              const smalls = smallByGroup.get(r.group) || [];
              const fittable = smalls.filter(sp => {
                const cA = Math.floor(r.w / sp.w) * Math.floor(r.h / sp.h);
                const cB = Math.floor(r.w / sp.h) * Math.floor(r.h / sp.w);
                return Math.max(cA, cB) > 0;
              });
              let reuse, reuseColor;
              if (fittable.length > 0) {
                reuse = fittable.map(f => f.part).filter((v, i, a) => a.indexOf(v) === i).join(', ');
                reuseColor = '#1565c0';
              } else if (r.w >= 200 && r.h >= 200) { reuse = '재활용 가능'; reuseColor = '#2e7d32'; }
              else if (Math.min(r.w, r.h) >= 60 && Math.min(r.w, r.h) <= 70) { reuse = '밴드 가능'; reuseColor = '#1976d2'; }
              else { reuse = '폐기'; reuseColor = '#999'; }
              planHTML += `<tr><td style="padding:3px 6px;border-bottom:1px solid #f5f5f5;">${r.group}</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${r.w}</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${r.h}</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${r.qty}장</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${(area / 100).toFixed(0)}</td><td style="padding:3px 6px;border-bottom:1px solid #f5f5f5;color:${reuseColor};font-weight:bold;">${reuse}</td></tr>`;
            });
            planHTML += `<tr style="background:#fff3e0;font-weight:bold;"><td colspan="4" style="padding:3px 6px;">합계 ${remList.reduce((s, r) => s + r.qty, 0)}장</td><td style="padding:3px 6px;text-align:right;">${(totalRemArea / 100).toFixed(0)}㎠</td><td></td></tr>`;
            planHTML += `</table>`;
          }

          // 자투리(60~70mm) 합산
          if (allThinStrips.length > 0) {
            const thinMap = new Map();
            allThinStrips.forEach(t => {
              const key = `${t.group}|${t.w}×${t.h}`;
              const existing = thinMap.get(key);
              if (existing) { existing.qty += t.qty; }
              else { thinMap.set(key, { group: t.group, w: t.w, h: t.h, qty: t.qty, type: t.type }); }
            });
            const thinList = [...thinMap.values()].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));

            planHTML += `<div style="font-size:12px;font-weight:bold;margin:6px 0 4px;color:#2e7d32;">🪵 자투리 (60~70mm) — 밴드/보강재 활용</div>`;
            planHTML += `<table style="width:100%;border-collapse:collapse;font-size:11px;">`;
            planHTML += `<tr style="background:#e8f5e9;"><th style="padding:3px 6px;text-align:left;border-bottom:1px solid #c8e6c9;">자재</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #c8e6c9;">가로</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #c8e6c9;">세로</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #c8e6c9;">수량</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #c8e6c9;">길이합(mm)</th><th style="padding:3px 6px;text-align:left;border-bottom:1px solid #c8e6c9;">종류</th></tr>`;
            let totalLen = 0;
            thinList.forEach(t => {
              const len = Math.max(t.w, t.h) * t.qty;
              totalLen += len;
              planHTML += `<tr><td style="padding:3px 6px;border-bottom:1px solid #f5f5f5;">${t.group}</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${t.w}</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${t.h}</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${t.qty}장</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #f5f5f5;">${len}</td><td style="padding:3px 6px;border-bottom:1px solid #f5f5f5;">${t.type}</td></tr>`;
            });
            planHTML += `<tr style="background:#e8f5e9;font-weight:bold;"><td colspan="4" style="padding:3px 6px;">합계 ${thinList.reduce((s, t) => s + t.qty, 0)}장</td><td style="padding:3px 6px;text-align:right;">${totalLen}mm</td><td></td></tr>`;
            planHTML += `</table>`;
          }

          // ===== 잔재→보강목/덧대 추출 최적화 =====
          if (smallByGroup.size > 0 && allRemnants.length > 0) {
            // 잔재를 면적 큰 순으로 정렬 (복사본)
            const remForAlloc = [];
            const remAggMap = new Map();
            allRemnants.forEach(r => {
              const key = `${r.group}|${r.w}×${r.h}`;
              const ex = remAggMap.get(key);
              if (ex) { ex.qty += r.qty; }
              else { const obj = { group: r.group, w: r.w, h: r.h, qty: r.qty }; remAggMap.set(key, obj); remForAlloc.push(obj); }
            });
            remForAlloc.sort((a, b) => (b.w * b.h) - (a.w * a.h));

            const allocResults = []; // { remnant, parts: [{part,w,h,produced}] }
            let totalAllocated = 0;

            remForAlloc.forEach(rem => {
              const smalls = smallByGroup.get(rem.group);
              if (!smalls || smalls.every(s => s.remain <= 0)) return;

              const parts = [];
              // 큰 부품부터 배치 (면적 순)
              smalls.filter(s => s.remain > 0).sort((a, b) => (b.w * b.h) - (a.w * a.h)).forEach(sp => {
                // 잔재 1장당 재단 가능 수량 (2방향 중 최대)
                const cntA = Math.floor(rem.w / sp.w) * Math.floor(rem.h / sp.h);
                const cntB = Math.floor(rem.w / sp.h) * Math.floor(rem.h / sp.w);
                const perSheet = Math.max(cntA, cntB);
                if (perSheet <= 0) return;

                const canProduce = perSheet * rem.qty;
                const willProduce = Math.min(canProduce, sp.remain);
                if (willProduce > 0) {
                  sp.remain -= willProduce;
                  totalAllocated += willProduce;
                  parts.push({ part: sp.part, w: sp.w, h: sp.h, produced: willProduce, perSheet });
                }
              });

              if (parts.length > 0) {
                allocResults.push({ w: rem.w, h: rem.h, qty: rem.qty, group: rem.group, parts });
              }
            });

            cncAllocResults = allocResults; // 엑셀용 캡처

            if (allocResults.length > 0 || smallByGroup.size > 0) {
              planHTML += `<div style="font-size:12px;font-weight:bold;margin:10px 0 4px;color:#1565c0;">🔧 잔재 → 보강목/덧대 추출</div>`;

              if (allocResults.length > 0) {
                planHTML += `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px;">`;
                planHTML += `<tr style="background:#e3f2fd;"><th style="padding:3px 6px;text-align:left;border-bottom:1px solid #90caf9;">잔재(자재)</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #90caf9;">잔재규격</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #90caf9;">잔재수</th><th style="padding:3px 6px;text-align:left;border-bottom:1px solid #90caf9;">추출부품</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #90caf9;">부품규격</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #90caf9;">장당</th><th style="padding:3px 6px;text-align:right;border-bottom:1px solid #90caf9;">추출수량</th></tr>`;
                allocResults.forEach(alloc => {
                  alloc.parts.forEach((p, pi) => {
                    const rowBg = pi === 0 ? '' : 'background:#f8fbff;';
                    planHTML += `<tr style="${rowBg}">`;
                    if (pi === 0) {
                      planHTML += `<td style="padding:3px 6px;border-bottom:1px solid #e3f2fd;" rowspan="${alloc.parts.length}">${alloc.group}</td>`;
                      planHTML += `<td style="padding:3px 6px;text-align:right;border-bottom:1px solid #e3f2fd;" rowspan="${alloc.parts.length}">${alloc.w}×${alloc.h}</td>`;
                      planHTML += `<td style="padding:3px 6px;text-align:right;border-bottom:1px solid #e3f2fd;" rowspan="${alloc.parts.length}">${alloc.qty}장</td>`;
                    }
                    planHTML += `<td style="padding:3px 6px;border-bottom:1px solid #e3f2fd;">${p.part}</td>`;
                    planHTML += `<td style="padding:3px 6px;text-align:right;border-bottom:1px solid #e3f2fd;">${p.w}×${p.h}</td>`;
                    planHTML += `<td style="padding:3px 6px;text-align:right;border-bottom:1px solid #e3f2fd;">${p.perSheet}개</td>`;
                    planHTML += `<td style="padding:3px 6px;text-align:right;border-bottom:1px solid #e3f2fd;color:#1565c0;font-weight:bold;">${p.produced}개</td>`;
                    planHTML += `</tr>`;
                  });
                });
                planHTML += `<tr style="background:#e3f2fd;font-weight:bold;"><td colspan="6" style="padding:3px 6px;">잔재에서 추출 합계</td><td style="padding:3px 6px;text-align:right;color:#1565c0;">${totalAllocated}개</td></tr>`;
                planHTML += `</table>`;
              }

              // 미충족 잔량 (별도 원판 재단 필요)
              const stillNeeded = [];
              smallByGroup.forEach((smalls, gKey) => {
                smalls.forEach(s => {
                  stillNeeded.push({ group: gKey, part: s.part, w: s.w, h: s.h, total: s.qty, remain: s.remain, allocated: s.qty - s.remain });
                });
              });

              cncStillNeeded = stillNeeded; // 엑셀용 캡처

              if (stillNeeded.some(s => s.remain > 0)) {
                planHTML += `<div style="font-size:11px;margin-top:4px;padding:6px 8px;background:#fff3e0;border-radius:4px;border:1px solid #ffe082;">`;
                planHTML += `<strong style="color:#e65100;">⚠️ 별도 재단 필요:</strong> `;
                planHTML += stillNeeded.filter(s => s.remain > 0).map(s =>
                  `${s.part} ${s.w}×${s.h} <strong>${s.remain}개</strong> (${s.group})`
                ).join(', ');
                planHTML += `</div>`;
              }

              // 전체 소부품 충족 현황
              const totalSmall = stillNeeded.reduce((s, n) => s + n.total, 0);
              const totalFilled = stillNeeded.reduce((s, n) => s + n.allocated, 0);
              if (totalFilled > 0) {
                planHTML += `<div style="font-size:11px;margin-top:4px;color:#1565c0;">✅ 보강목/덧대 ${totalSmall}개 중 <strong>${totalFilled}개</strong> 잔재 활용 (${(totalFilled / totalSmall * 100).toFixed(0)}%)</div>`;
              }
            }
          }

          planHTML += `</div>`;
        }

        // 전체 요약
        planHTML += `<div style="padding:12px;background:#e8f5e9;border-radius:8px;border:1px solid #c8e6c9;font-size:13px;">`;
        planHTML += `<strong>📋 요약:</strong> 총 원판 ${totalPanels}장`;
        if (totalHPanels > 0 && totalVPanels > 0) {
          planHTML += ` (<span style="color:#1976d2;">가로→세로 ${totalHPanels}장</span> + <span style="color:#7b1fa2;">세로→가로 ${totalVPanels}장</span>)`;
        } else if (totalVPanels > 0) {
          planHTML += ` (<span style="color:#7b1fa2;">세로→가로 ${totalVPanels}장</span>)`;
        } else {
          planHTML += ` (<span style="color:#1976d2;">가로→세로 ${totalHPanels}장</span>)`;
        }
        planHTML += ` | 생산 ${totalProduced}/${totalNeeded}개`;
        if (totalProduced >= totalNeeded) planHTML += ` | <span style="color:#2e7d32;">✅ 전체 자재 추출 완료</span>`;
        else planHTML += ` | <span style="color:#c62828;">❌ 미배치 ${totalNeeded - totalProduced}개</span>`;
        if (totalThinLen > 0) planHTML += `<br><span style="color:#2e7d32;">🪵 자투리(60~70mm) 총 길이: ${totalThinLen}mm — 밴드/보강재 활용</span>`;
        planHTML += `</div>`;

        // 엑셀 다운로드용 데이터 저장
        window._cncData = {
          sorted,
          panelDetails,
          allRemnants,
          allThinStrips,
          allocResults: cncAllocResults,
          stillNeeded: cncStillNeeded,
          summary: { totalPanels, totalHPanels, totalVPanels, totalProduced, totalNeeded, totalThinLen }
        };

        return `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:14px;font-weight:bold;color:#333;">✂️ CNC 재단 목록 (${sorted.length}종, 가로 ${totalHCuts}회 + 세로 ${totalVCuts}회)</span>
      <div style="display:flex;gap:4px;">
        <button onclick="switchBomView('cnc','module',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#1976d2;color:#fff;font-weight:bold;">규격 목록</button>
        <button onclick="switchBomView('cnc','spec',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#e0e0e0;color:#666;font-weight:normal;">원판 배치 (${totalPanels}장)</button>
        <button onclick="downloadBOMExcel()" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#2e7d32;color:#fff;font-weight:bold;">📊 엑셀</button>
        <button onclick="downloadBOMWordSpec()" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#1565c0;color:#fff;font-weight:bold;">📄 규격 워드</button>
        <button onclick="downloadBOMWordPanel()" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#7b1fa2;color:#fff;font-weight:bold;">📄 배치 워드</button>
      </div>
    </div>
    <div style="margin-bottom:10px;padding:10px;background:#fff3e0;border-radius:8px;border:1px solid #ffe082;font-size:12px;color:#e65100;">
      💡 방향 자동최적화: H/V × 정방향/회전 4가지 중 최적 선택 | 잔재→보강목/덧대 추출 반영 | 60~70mm 자투리 최대화 | 최대 5장 겹침 | 원판: ${PANEL_W}×${PANEL_H}mm
    </div>
    <div id="cnc-module-view" style="max-height:500px;overflow-y:auto;">${tableHTML}</div>
    <div id="cnc-spec-view" style="display:none;max-height:500px;overflow-y:auto;">${planHTML}</div>
  `;
      }

      const CUT_KERF = 4; // 톱날 두께 (mm)

      // 재단 배치도 SVG 렌더링
      function renderCuttingPlanSVG(panel, groupName, PW, PH) {
        const scale = 0.25;
        const margin = { top: 50, left: 30, right: 30, bottom: 20 };
        const panelW = Math.round(PW * scale);
        const panelH = Math.round(PH * scale);
        const svgW = panelW + margin.left + margin.right;
        const svgH = panelH + margin.top + margin.bottom;
        const ox = margin.left, oy = margin.top;

        const colors = {
          panel: '#f5f5f5',
          body: '#e3f2fd',
          door: '#fff3e0',
          back: '#f3e5f5',
          ep: '#e8f5e9'
        };

        function partColor(partName) {
          if (/도어|서랍/.test(partName)) return colors.door;
          if (/뒷판/.test(partName)) return colors.back;
          if (/몰딩|걸레|마감|찬넬|EP/.test(partName)) return colors.ep;
          return colors.body;
        }

        function partStroke(partName) {
          if (/도어|서랍/.test(partName)) return '#f57c00';
          if (/뒷판/.test(partName)) return '#7b1fa2';
          if (/몰딩|걸레|마감|찬넬|EP/.test(partName)) return '#388e3c';
          return '#1976d2';
        }

        // 부품 rect + 각 변에 치수 라벨 렌더링
        // 엣지 문자열 → 상/하/좌/우 boolean 파싱 (치수 기반 장변/단변 동적 결정)
        // pw = SVG 가로 치수(mm), ph = SVG 세로 치수(mm)
        function parseEdges(edgeArr, pw, ph) {
          const e = { top: false, bottom: false, left: false, right: false };
          if (!edgeArr || edgeArr.length === 0) return e;
          const str = edgeArr.join(' ');
          if (/4면/.test(str)) { e.top = e.bottom = e.left = e.right = true; }
          else {
            // 장변 = 긴 쪽, 단변 = 짧은 쪽 (SVG 기준 동적 결정)
            const isWider = (pw || 1) >= (ph || 1); // pw >= ph → 가로가 장변
            const longA  = isWider ? 'top' : 'left';      // 장변 앞면
            const longB  = isWider ? 'bottom' : 'right';   // 장변 뒷면
            const shortA = isWider ? 'left' : 'top';       // 단변 A
            const shortB = isWider ? 'right' : 'bottom';   // 단변 B

            if (/1면\(전\)|1면전/.test(str)) { e[longA] = true; }  // 전면 = 장변 1면
            if (/1면\(장\)|1면장/.test(str)) { e[longA] = true; }  // 장변 1면
            if (/2면\(장\)|2면장/.test(str)) { e[longA] = true; e[longB] = true; } // 장변 양쪽
            if (/2면\(단\)|2면단/.test(str)) { e[shortA] = true; e[shortB] = true; } // 단변 양쪽
            if (/3면/.test(str)) { e[longA] = true; e[shortA] = true; e[shortB] = true; } // 장변1면(전면) + 단변2면
          }
          return e;
        }

        function renderPiece(rx, ry, rw, rh, pw, ph, partName, itemLabel, edges) {
          const fill = partColor(partName);
          const stroke = partStroke(partName);
          let s = `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`;

          // 엣지 표시 — 안쪽, 중앙 정렬, 각 변 길이의 70%
          const eg = parseEdges(edges, pw, ph);
          const ew = 3; // 엣지 선 두께
          const ec = '#ff6f00'; // 주황색
          const inset = Math.max(3, Math.min(6, Math.round(Math.min(rw, rh) * 0.06))); // 안쪽 여백 — rect 크기에 비례 (3~6px)
          const ratio = 0.7; // 70% 길이
          const hGap = rw * (1 - ratio) / 2; // 가로 변 양쪽 여백
          const vGap = rh * (1 - ratio) / 2; // 세로 변 양쪽 여백
          if (eg.top)    s += `<line x1="${rx + hGap}" y1="${ry + inset}" x2="${rx + rw - hGap}" y2="${ry + inset}" stroke="${ec}" stroke-width="${ew}"/>`;
          if (eg.bottom) s += `<line x1="${rx + hGap}" y1="${ry + rh - inset}" x2="${rx + rw - hGap}" y2="${ry + rh - inset}" stroke="${ec}" stroke-width="${ew}"/>`;
          if (eg.left)   s += `<line x1="${rx + inset}" y1="${ry + vGap}" x2="${rx + inset}" y2="${ry + rh - vGap}" stroke="${ec}" stroke-width="${ew}"/>`;
          if (eg.right)  s += `<line x1="${rx + rw - inset}" y1="${ry + vGap}" x2="${rx + rw - inset}" y2="${ry + rh - vGap}" stroke="${ec}" stroke-width="${ew}"/>`;

          // 동적 폰트 크기: rect 크기에 비례 (최소 7px ~ 최대 18px)
          const minDim = Math.min(rw, rh);
          const partFs = Math.max(7, Math.min(18, Math.round(minDim * 0.14)));
          const itemFs = Math.max(6, Math.min(12, Math.round(minDim * 0.09)));
          const dimFs = Math.max(7, Math.min(14, Math.round(minDim * 0.11)));

          // 부품명 표시에 필요한 최소 공간
          if (rw > 30 && rh > 18) {
            const maxChars = Math.max(2, Math.floor(rw / (partFs * 0.6)));
            const shortPart = partName.length > maxChars ? partName.substring(0, maxChars) + '..' : partName;
            const labelY = (itemLabel && rh > partFs + itemFs + 8) ? ry + rh / 2 - 1 : ry + rh / 2 + partFs * 0.35;
            s += `<text x="${rx + rw / 2}" y="${labelY}" text-anchor="middle" style="font-family:Arial,sans-serif;font-size:${partFs}px;fill:#333;font-weight:bold;">${shortPart}</text>`;
            // 품목 라벨 (부품명 아래, 공간 있을 때)
            if (itemLabel && rh > partFs + itemFs + 8) {
              const maxLabelChars = Math.max(2, Math.floor(rw / (itemFs * 0.6)));
              const shortLabel = itemLabel.length > maxLabelChars ? itemLabel.substring(0, maxLabelChars) + '..' : itemLabel;
              s += `<text x="${rx + rw / 2}" y="${ry + rh / 2 + partFs * 0.6 + 2}" text-anchor="middle" style="font-family:Arial,sans-serif;font-size:${itemFs}px;fill:#1565c0;">${shortLabel}</text>`;
            }
          }

          // 상변: 가로 치수 (mm)
          if (rw > 22) {
            s += `<text x="${rx + rw / 2}" y="${ry + dimFs * 0.7}" text-anchor="middle" style="font-family:Arial,sans-serif;font-size:${dimFs}px;fill:#e53935;font-weight:bold;">${pw}</text>`;
          }

          // 좌변: 세로 치수 (mm) — 세로 회전 텍스트
          if (rh > 22) {
            s += `<text x="${rx + dimFs * 0.6}" y="${ry + rh / 2}" text-anchor="middle" transform="rotate(-90, ${rx + dimFs * 0.6}, ${ry + rh / 2})" style="font-family:Arial,sans-serif;font-size:${dimFs}px;fill:#e53935;font-weight:bold;">${ph}</text>`;
          }

          return s;
        }

        const stackLabel = panel.stack > 1 ? ` x${panel.stack}장 겹침` : '';
        const dirLabel = panel.dir === 'H' ? '가로→세로' : '세로→가로';
        const rotLabel = panel.rotated ? ' (회전)' : '';
        const eff = ((panel.usedArea / (PW * PH)) * 100).toFixed(1);

        let svg = `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:8px auto;">
      <style>
        .cp-title { font-family: Arial, sans-serif; font-size: 11px; font-weight: bold; fill: #333; }
        .cp-label { font-family: Arial, sans-serif; font-size: 14px; fill: #333; font-weight: bold; }
        .cp-item { font-family: Arial, sans-serif; font-size: 10px; fill: #1565c0; }
        .cp-edge { font-family: Arial, sans-serif; font-size: 12px; fill: #e53935; font-weight: bold; }
        .cp-dim { font-family: Arial, sans-serif; font-size: 7px; fill: #666; }
        .cp-cut { stroke: #e53935; stroke-width: 1; stroke-dasharray: 4 2; }
        .cp-stack { font-family: Arial, sans-serif; font-size: 9px; fill: #fff; font-weight: bold; }
      </style>
      <text x="${svgW / 2}" y="14" class="cp-title" text-anchor="middle">#${panel.id} ${groupName} | ${dirLabel}${rotLabel} | ${eff}%${stackLabel}</text>
      <text x="${svgW / 2}" y="28" class="cp-dim" text-anchor="middle">${PW} x ${PH} mm</text>`;

        // 원판 배경 + clipPath로 넘침 방지
        svg += `<defs>`;
        svg += `<clipPath id="clip-${panel.id}"><rect x="${ox}" y="${oy}" width="${panelW}" height="${panelH}"/></clipPath>`;
        svg += `<pattern id="hatch-${panel.id}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#ddd" stroke-width="1"/></pattern>`;
        svg += `</defs>`;
        svg += `<rect x="${ox}" y="${oy}" width="${panelW}" height="${panelH}" fill="${colors.panel}" stroke="#333" stroke-width="2"/>`;

        // 부품을 clipPath 안에서 렌더링
        svg += `<g clip-path="url(#clip-${panel.id})">`;

        if (panel.dir === 'H') {
          // 가로→세로: y축으로 strip, x축으로 piece
          let curY = 0;
          panel.strips.forEach((strip, si) => {
            let curX = 0;
            if (si > 0) {
              const lineY = oy + Math.round(curY * scale);
              svg += `<line x1="${ox}" y1="${lineY}" x2="${ox + panelW}" y2="${lineY}" class="cp-cut"/>`;
            }

            strip.pieces.forEach(p => {
              for (let c = 0; c < p.count; c++) {
                const rx = ox + Math.round(curX * scale);
                const ry = oy + Math.round(curY * scale);
                const rw = Math.round(p.w * scale);
                const rh = Math.round(strip.height * scale);
                svg += renderPiece(rx, ry, rw, rh, p.w, strip.height, p.part, (p.itemLabels || []).join('/'), p.edges);
                curX += p.w + CUT_KERF;
              }
            });

            // strip 내 잔여 영역 — 원판 경계까지만
            const usedX = curX - CUT_KERF; // 마지막 KERF 제거
            if (PW - usedX > 10) {
              const rx = ox + Math.round(usedX * scale);
              const rw = panelW - Math.round(usedX * scale);
              const rh = Math.round(strip.height * scale);
              svg += `<rect x="${rx}" y="${oy + Math.round(curY * scale)}" width="${rw}" height="${rh}" fill="url(#hatch-${panel.id})" stroke="#ccc" stroke-width="0.5"/>`;
              if (rw > 20 && rh > 12) {
                svg += `<text x="${rx + rw / 2}" y="${oy + Math.round(curY * scale) + rh / 2 + 3}" class="cp-dim" text-anchor="middle" fill="#999">${PW - usedX}</text>`;
              }
            }

            curY += strip.height + CUT_KERF;
          });

          // 하단 잔여 영역 — 원판 하단까지
          const usedY = curY - CUT_KERF;
          const remainH = PH - usedY;
          if (remainH > 10) {
            const ry = oy + Math.round(usedY * scale);
            const rh = panelH - Math.round(usedY * scale);
            svg += `<rect x="${ox}" y="${ry}" width="${panelW}" height="${rh}" fill="url(#hatch-${panel.id})" stroke="#ccc" stroke-width="0.5"/>`;
            if (rh > 12) {
              svg += `<text x="${ox + panelW / 2}" y="${ry + rh / 2 + 3}" class="cp-dim" text-anchor="middle" fill="#999">${PW}x${remainH}</text>`;
            }
          }
        } else {
          // 세로→가로: x축으로 strip, y축으로 piece
          let curX = 0;
          panel.strips.forEach((strip, si) => {
            let curY = 0;
            if (si > 0) {
              const lineX = ox + Math.round(curX * scale);
              svg += `<line x1="${lineX}" y1="${oy}" x2="${lineX}" y2="${oy + panelH}" class="cp-cut"/>`;
            }

            strip.pieces.forEach(p => {
              for (let c = 0; c < p.count; c++) {
                const rx = ox + Math.round(curX * scale);
                const ry = oy + Math.round(curY * scale);
                const rw = Math.round(strip.width * scale);
                const rh = Math.round(p.h * scale);
                svg += renderPiece(rx, ry, rw, rh, strip.width, p.h, p.part, (p.itemLabels || []).join('/'), p.edges);
                curY += p.h + CUT_KERF;
              }
            });

            // strip 내 잔여 영역 — 원판 하단까지
            const usedY = curY - CUT_KERF;
            if (PH - usedY > 10) {
              const ry = oy + Math.round(usedY * scale);
              const rw = Math.round(strip.width * scale);
              const rh = panelH - Math.round(usedY * scale);
              svg += `<rect x="${ox + Math.round(curX * scale)}" y="${ry}" width="${rw}" height="${rh}" fill="url(#hatch-${panel.id})" stroke="#ccc" stroke-width="0.5"/>`;
              if (rw > 20 && rh > 12) {
                svg += `<text x="${ox + Math.round(curX * scale) + rw / 2}" y="${ry + rh / 2 + 3}" class="cp-dim" text-anchor="middle" fill="#999">${PH - usedY}</text>`;
              }
            }

            curX += strip.width + CUT_KERF;
          });

          // 우측 잔여 영역 — 원판 우측까지
          const usedX = curX - CUT_KERF;
          const remainW = PW - usedX;
          if (remainW > 10) {
            const rx = ox + Math.round(usedX * scale);
            const rw = panelW - Math.round(usedX * scale);
            svg += `<rect x="${rx}" y="${oy}" width="${rw}" height="${panelH}" fill="url(#hatch-${panel.id})" stroke="#ccc" stroke-width="0.5"/>`;
            if (rw > 12) {
              svg += `<text x="${rx + rw / 2}" y="${oy + panelH / 2}" class="cp-dim" text-anchor="middle" fill="#999">${remainW}x${PH}</text>`;
            }
          }
        }

        svg += `</g>`; // clip group 닫기

        // 겹침 배지
        if (panel.stack > 1) {
          const bx = ox + panelW - 30;
          svg += `<rect x="${bx}" y="${oy + 4}" width="26" height="16" rx="3" fill="#e53935"/>`;
          svg += `<text x="${bx + 13}" y="${oy + 15}" class="cp-stack" text-anchor="middle">x${panel.stack}</text>`;
        }

        // 재단 횟수 배지
        const stripCuts = panel.strips.length;
        let pieceCuts = 0;
        panel.strips.forEach(st => {
          const totalInStrip = st.pieces.reduce((s, p) => s + p.count, 0);
          pieceCuts += Math.max(0, totalInStrip - 1);
        });
        const totalCuts = stripCuts + pieceCuts;
        const cutBadgeX = ox + panelW - (panel.stack > 1 ? 68 : 38);
        svg += `<rect x="${cutBadgeX}" y="${oy + 4}" width="34" height="16" rx="3" fill="#1565c0"/>`;
        svg += `<text x="${cutBadgeX + 17}" y="${oy + 15}" class="cp-stack" text-anchor="middle">✂${totalCuts}</text>`;

        // 회전 표시
        if (panel.rotated) {
          svg += `<text x="${ox + 6}" y="${oy + 14}" class="cp-dim" fill="#e65100">↻</text>`;
        }

        svg += `</svg>`;
        return svg;
      }

      // 원판 배치 계산 (방향 자동최적화 + 겹침 재단 + 나머지 활용)
      function calcCuttingPlan(items, PW, PH, groupSmalls) {
        const needs = items.map((item, i) => ({
          idx: i, w: item.w, h: item.h,
          parts: item.parts, edges: item.edges,
          itemLabels: item.itemLabels || [],
          remain: item.qty
        }));

        // Step 1: 수량 많은 순 → 면적 큰 순 정렬 (스택 극대화)
        needs.sort((a, b) => b.remain - a.remain || (b.w * b.h) - (a.w * a.h));
        needs.forEach((n, i) => { n.idx = i; }); // 정렬 후 idx 재할당

        const panels = [];

        // Step 2: 동일 치수 부품 단독 패널 우선 배치 (Homogeneous Panel)
        // 같은 부품만으로 원판을 채워 스택을 최대화
        needs.forEach(n => {
          if (n.remain < 2) return;
          const soloLayout = chooseCutDirection([n], PW, PH, groupSmalls);
          if (soloLayout.totalPieces === 0) return;
          const fullStacks = Math.floor(n.remain / soloLayout.totalPieces);
          if (fullStacks < 2) return; // 2장 미만이면 혼합 패널로 처리
          const useStacks = Math.min(fullStacks, 5);
          n.remain -= soloLayout.totalPieces * useStacks;
          panels.push({
            id: panels.length + 1,
            stack: useStacks,
            dir: soloLayout.dir,
            rotated: soloLayout.rotated || false,
            strips: soloLayout.strips,
            usedArea: soloLayout.usedArea,
            panelRemain: soloLayout.dir === 'H' ? soloLayout.remainH : soloLayout.remainW,
            smallYield: soloLayout.smallYield || 0
          });
        });

        // Step 3: 나머지 부품 혼합 배치 (기존 로직)
        let safety = 0;
        while (needs.some(n => n.remain > 0) && safety++ < 30) {
          const layout = chooseCutDirection(needs, PW, PH, groupSmalls);
          if (layout.totalPieces === 0) break;

          let stack = 5;
          layout.pieceCounts.forEach((count, idx) => {
            stack = Math.min(stack, Math.floor(needs[idx].remain / count));
          });
          stack = Math.max(1, stack);

          layout.pieceCounts.forEach((count, idx) => {
            needs[idx].remain -= count * stack;
          });

          panels.push({
            id: panels.length + 1,
            stack,
            dir: layout.dir,
            rotated: layout.rotated || false,
            strips: layout.strips,
            usedArea: layout.usedArea,
            panelRemain: layout.dir === 'H' ? layout.remainH : layout.remainW,
            smallYield: layout.smallYield || 0
          });
        }

        return { panels, unallocated: needs.filter(n => n.remain > 0) };
      }

      // 방향 자동선택: H/V × 정방향/회전 = 4가지 중 최적 선택
      function chooseCutDirection(needs, PW, PH, groupSmalls) {
        // 정방향 (w×h 그대로)
        const h = designLayoutH(needs, PW, PH);
        const v = designLayoutV(needs, PW, PH);
        h.rotated = false; v.rotated = false;

        // 회전 배치 (w↔h 교환: 더 넓은 면을 strip 방향으로 활용)
        const rotNeeds = needs.map(n => ({ ...n, w: n.h, h: n.w }));
        const hr = designLayoutH(rotNeeds, PW, PH);
        const vr = designLayoutV(rotNeeds, PW, PH);
        hr.rotated = true; vr.rotated = true;

        // 각 방향별 잔재에서 소부품 추출 가능 수량 산출 + 예상 스택 계산
        const candidates = [h, v, hr, vr];
        candidates.forEach(c => {
          c.smallYield = calcSmallYield(c, PW, PH, groupSmalls);
          // 예상 스택: 이 레이아웃을 몇 장 겹칠 수 있는지
          let estStack = 5;
          const srcNeeds = c.rotated ? rotNeeds : needs;
          const needsById = new Map(srcNeeds.map(n => [n.idx, n]));
          c.pieceCounts.forEach((count, idx) => {
            const n = needsById.get(idx);
            if (n) estStack = Math.min(estStack, Math.floor(n.remain / count));
          });
          c.estStack = Math.max(1, estStack);
          c.effectivePieces = c.totalPieces * c.estStack; // 실제 생산량
        });

        // 우선순위: 실제생산량(배치×스택) → 소부품추출수 → 자투리길이 → 활용면적 → strip수(↓)
        candidates.sort((a, b) => {
          if (b.effectivePieces !== a.effectivePieces) return b.effectivePieces - a.effectivePieces;
          if (b.totalPieces !== a.totalPieces) return b.totalPieces - a.totalPieces;
          if (b.smallYield !== a.smallYield) return b.smallYield - a.smallYield;
          if (b.thinLen !== a.thinLen) return b.thinLen - a.thinLen;
          if (b.usedArea !== a.usedArea) return b.usedArea - a.usedArea;
          return a.strips.length - b.strips.length;
        });
        return candidates[0];
      }

      // 잔재에서 소부품(보강목/덧대/좌대) 추출 가능 수량 시뮬레이션
      function calcSmallYield(layout, PW, PH, smalls) {
        if (!smalls || smalls.length === 0) return 0;

        // 이 레이아웃의 잔재 조각 수집
        const rems = [];
        if (layout.dir === 'H') {
          layout.strips.forEach(s => {
            if (s.remainW > 70) rems.push({ w: s.remainW, h: s.height });
          });
          if (layout.remainH > 70) rems.push({ w: PW, h: layout.remainH });
        } else {
          layout.strips.forEach(s => {
            if (s.remainH > 70) rems.push({ w: s.width, h: s.remainH });
          });
          if (layout.remainW > 70) rems.push({ w: layout.remainW, h: PH });
        }

        if (rems.length === 0) return 0;

        // 탐욕법: 필요 수량 한도 내에서 추출 시뮬레이션
        const needs = smalls.map(s => ({ w: s.w, h: s.h, tmpRemain: s.qty }));
        let total = 0;

        for (const rem of rems) {
          for (const sp of needs) {
            if (sp.tmpRemain <= 0) continue;
            const cntA = Math.floor(rem.w / sp.w) * Math.floor(rem.h / sp.h);
            const cntB = Math.floor(rem.w / sp.h) * Math.floor(rem.h / sp.w);
            const can = Math.max(cntA, cntB);
            const use = Math.min(can, sp.tmpRemain);
            if (use > 0) {
              total += use;
              sp.tmpRemain -= use;
            }
          }
        }

        return total;
      }

      // 가로→세로 레이아웃 (가로재단으로 strip 분리 → 세로재단으로 부품 분리)
      function designLayoutH(needs, PW, PH) {
        const pieceCounts = new Map();
        let usedArea = 0;
        const strips = [];
        let availH = PH;

        // Step 4: 높이 → 너비 내림차순 정렬 (같은 치수 부품 클러스터링)
        const sorted = [...needs].sort((a, b) => b.h - a.h || b.w - a.w);

        while (availH > 70) {
          let stripH = 0;
          for (const n of sorted) {
            const avail = n.remain - (pieceCounts.get(n.idx) || 0);
            if (avail > 0 && n.h <= availH) { stripH = n.h; break; }
          }
          if (stripH === 0) break;

          const strip = { height: stripH, pieces: [], usedW: 0 };

          // Pass 1: 정확히 같은 높이 부품만 배치 (재단 횟수 최소화)
          for (const n of sorted) {
            const placed = pieceCounts.get(n.idx) || 0;
            const avail = n.remain - placed;
            if (avail <= 0 || n.h !== stripH || n.w > PW - strip.usedW) continue;
            const fitCount = Math.min(avail, Math.floor((PW - strip.usedW + CUT_KERF) / (n.w + CUT_KERF)));
            if (fitCount <= 0) continue;
            strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, part: n.parts.join(', '), itemLabels: n.itemLabels || [], edges: n.edges || [], count: fitCount });
            strip.usedW += (n.w + CUT_KERF) * fitCount - CUT_KERF;
            pieceCounts.set(n.idx, placed + fitCount);
            usedArea += n.w * n.h * fitCount;
          }

          // Pass 2: 잔여 공간에 더 짧은 부품 배치 (공간 활용)
          if (PW - strip.usedW > 70) {
            for (const n of sorted) {
              const placed = pieceCounts.get(n.idx) || 0;
              const avail = n.remain - placed;
              const spaceLeft = PW - strip.usedW - CUT_KERF;
              if (avail <= 0 || n.h > stripH || n.h === stripH || n.w > spaceLeft) continue;
              const fitCount = Math.min(avail, Math.floor((spaceLeft + CUT_KERF) / (n.w + CUT_KERF)));
              if (fitCount <= 0) continue;
              strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, part: n.parts.join(', '), itemLabels: n.itemLabels || [], edges: n.edges || [], count: fitCount, fromRemainder: true });
              strip.usedW += CUT_KERF + (n.w + CUT_KERF) * fitCount - CUT_KERF;
              pieceCounts.set(n.idx, placed + fitCount);
              usedArea += n.w * n.h * fitCount;
            }
          }

          if (strip.pieces.length === 0) break;

          // Step 2: 스트립 내 너비 순 정렬 (같은 너비 연속 → 톱날 설정 최소화)
          strip.pieces.sort((a, b) => b.w - a.w || b.count - a.count);

          strip.remainW = PW - strip.usedW;
          strips.push(strip);
          availH -= stripH + CUT_KERF;
        }

        let totalPieces = 0;
        pieceCounts.forEach(c => totalPieces += c);
        let thinLen = 0;
        for (const s of strips) {
          if (s.remainW >= 60 && s.remainW <= 70) thinLen += s.height;
        }
        if (availH >= 60 && availH <= 70) thinLen += PW;

        return { dir: 'H', strips, pieceCounts, usedArea, remainH: availH, totalPieces, thinLen };
      }

      // 세로→가로 레이아웃 (세로재단으로 strip 분리 → 가로재단으로 부품 분리)
      function designLayoutV(needs, PW, PH) {
        const pieceCounts = new Map();
        let usedArea = 0;
        const strips = [];
        let availW = PW;

        // Step 4: 너비 → 높이 내림차순 정렬 (같은 치수 부품 클러스터링)
        const sorted = [...needs].sort((a, b) => b.w - a.w || b.h - a.h);

        while (availW > 70) {
          let stripW = 0;
          for (const n of sorted) {
            const avail = n.remain - (pieceCounts.get(n.idx) || 0);
            if (avail > 0 && n.w <= availW) { stripW = n.w; break; }
          }
          if (stripW === 0) break;

          const strip = { width: stripW, pieces: [], usedH: 0 };

          // Pass 1: 정확히 같은 너비 부품만 배치 (재단 횟수 최소화)
          for (const n of sorted) {
            const placed = pieceCounts.get(n.idx) || 0;
            const avail = n.remain - placed;
            if (avail <= 0 || n.w !== stripW || n.h > PH - strip.usedH) continue;
            const fitCount = Math.min(avail, Math.floor((PH - strip.usedH + CUT_KERF) / (n.h + CUT_KERF)));
            if (fitCount <= 0) continue;
            strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, part: n.parts.join(', '), itemLabels: n.itemLabels || [], edges: n.edges || [], count: fitCount });
            strip.usedH += (n.h + CUT_KERF) * fitCount - CUT_KERF;
            pieceCounts.set(n.idx, placed + fitCount);
            usedArea += n.w * n.h * fitCount;
          }

          // Pass 2: 잔여 공간에 더 좁은 부품 배치 (공간 활용)
          if (PH - strip.usedH > 70) {
            for (const n of sorted) {
              const placed = pieceCounts.get(n.idx) || 0;
              const avail = n.remain - placed;
              const spaceLeft = PH - strip.usedH - CUT_KERF;
              if (avail <= 0 || n.w > stripW || n.w === stripW || n.h > spaceLeft) continue;
              const fitCount = Math.min(avail, Math.floor((spaceLeft + CUT_KERF) / (n.h + CUT_KERF)));
              if (fitCount <= 0) continue;
              strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, part: n.parts.join(', '), itemLabels: n.itemLabels || [], edges: n.edges || [], count: fitCount, fromRemainder: true });
              strip.usedH += CUT_KERF + (n.h + CUT_KERF) * fitCount - CUT_KERF;
              pieceCounts.set(n.idx, placed + fitCount);
              usedArea += n.w * n.h * fitCount;
            }
          }

          if (strip.pieces.length === 0) break;

          // Step 2: 스트립 내 높이 순 정렬 (같은 높이 연속 → 톱날 설정 최소화)
          strip.pieces.sort((a, b) => b.h - a.h || b.count - a.count);

          strip.remainH = PH - strip.usedH;
          strips.push(strip);
          availW -= stripW + CUT_KERF;
        }

        let totalPieces = 0;
        pieceCounts.forEach(c => totalPieces += c);
        let thinLen = 0;
        for (const s of strips) {
          if (s.remainH >= 60 && s.remainH <= 70) thinLen += s.width;
        }
        if (availW >= 60 && availW <= 70) thinLen += PH;

        return { dir: 'V', strips, pieceCounts, usedArea, remainW: availW, totalPieces, thinLen };
      }

      // 규격별 집계 함수 (자재+두께+가로+세로+엣지 기준으로 합산)
      function aggregateMaterials(materials) {
        const map = new Map();
        materials.forEach(m => {
          const key = `${m.material}|${m.thickness}|${m.w}|${m.h}|${m.edge}`;
          if (map.has(key)) {
            const agg = map.get(key);
            agg.qty += m.qty;
            if (!agg.parts.includes(m.part)) agg.parts.push(m.part);
            if (!agg.modules.includes(m.module)) agg.modules.push(m.module);
          } else {
            map.set(key, { ...m, qty: m.qty, parts: [m.part], modules: [m.module] });
          }
        });
        return [...map.values()].sort((a, b) =>
          a.material.localeCompare(b.material) || a.thickness - b.thickness || b.w - a.w || b.h - a.h
        );
      }

      // BOM 뷰 전환 함수
      function switchBomView(tabName, view, btn) {
        const moduleView = document.getElementById(tabName + '-module-view');
        const specView = document.getElementById(tabName + '-spec-view');
        if (!moduleView || !specView) return;
        if (view === 'module') {
          moduleView.style.display = '';
          specView.style.display = 'none';
        } else {
          moduleView.style.display = 'none';
          specView.style.display = '';
        }
        // 버튼 active 상태 변경
        const container = btn.parentElement;
        container.querySelectorAll('button').forEach(b => {
          b.style.background = '#e0e0e0';
          b.style.color = '#666';
          b.style.fontWeight = 'normal';
        });
        btn.style.background = '#1976d2';
        btn.style.color = '#fff';
        btn.style.fontWeight = 'bold';
      }

      // 본체 자재 탭
      function generateBodyMaterialTab(materials) {
        const epKeywords = ['걸레받이', '휠라', '목찬넬', '상몰딩', '몰딩', '덧대'];
        const bodyParts = materials.filter(
          (m) => !m.part.includes('도어') &&
                 !epKeywords.some((p) => m.part.includes(p)) &&
                 m.module !== 'EP' && !m.module.includes('EP')
        );

        if (bodyParts.length === 0)
          return '<p style="color:#666;text-align:center;padding:40px;">본체 자재가 없습니다.</p>';

        // 모듈별 테이블
        let moduleTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#e3f2fd;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">모듈</th>
          <th style="border:1px solid #ddd;padding:10px;">부품</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">자재</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">두께</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">가로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">세로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">엣지</th>
          <th style="border:1px solid #ddd;padding:10px;">비고</th>
        </tr>
      </thead>
      <tbody>`;

        // 품목별 그룹화
        let lastItemLabel = '';
        let no = 0;
        bodyParts.forEach((m) => {
          if (m.itemLabel && m.itemLabel !== lastItemLabel) {
            lastItemLabel = m.itemLabel;
            moduleTableHTML += `
      <tr style="background:#e8eaf6;">
        <td colspan="10" style="border:1px solid #ddd;padding:8px;font-weight:bold;color:#283593;">📦 ${m.itemLabel}</td>
      </tr>`;
          }
          no++;
          moduleTableHTML += `
      <tr style="background:${no % 2 === 0 ? '#fff' : '#f9f9f9'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${no}</td>
        <td style="border:1px solid #ddd;padding:8px;">${m.module}</td>
        <td style="border:1px solid #ddd;padding:8px;font-weight:600;">${m.part}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#1976d2;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-size:11px;">${m.edge}</td>
        <td style="border:1px solid #ddd;padding:8px;font-size:11px;color:#666;">${m.note || ''}</td>
      </tr>`;
        });
        moduleTableHTML += '</tbody></table>';

        // 규격별 테이블
        const aggBody = aggregateMaterials(bodyParts);
        let specTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#e3f2fd;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">부품</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">자재</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">두께</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">가로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">세로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">엣지</th>
          <th style="border:1px solid #ddd;padding:10px;">출처</th>
        </tr>
      </thead>
      <tbody>`;

        aggBody.forEach((m, i) => {
          specTableHTML += `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${i + 1}</td>
        <td style="border:1px solid #ddd;padding:8px;font-weight:600;">${m.parts.join(', ')}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#1976d2;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-size:11px;">${m.edge}</td>
        <td style="border:1px solid #ddd;padding:8px;font-size:11px;color:#666;">${m.modules.join(', ')}</td>
      </tr>`;
        });
        specTableHTML += '</tbody></table>';

        return `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:14px;font-weight:bold;color:#333;">🪵 본체 자재 목록 (${bodyParts.length}개 품목)</span>
      <div style="display:flex;gap:4px;">
        <button onclick="switchBomView('body','module',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#1976d2;color:#fff;font-weight:bold;">모듈별</button>
        <button onclick="switchBomView('body','spec',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#e0e0e0;color:#666;font-weight:normal;">규격별 (${aggBody.length})</button>
      </div>
    </div>
    <div id="body-module-view" style="max-height:400px;overflow-y:auto;">${moduleTableHTML}</div>
    <div id="body-spec-view" style="display:none;max-height:400px;overflow-y:auto;">${specTableHTML}</div>
  `;
      }

      // 도어 자재 탭
      function generateDoorMaterialTab(materials) {
        const doorParts = materials.filter((m) => m.part.includes('도어') && m.material !== 'PB');

        if (doorParts.length === 0)
          return '<p style="color:#666;text-align:center;padding:40px;">도어 자재가 없습니다.</p>';

        // 모듈별 테이블
        let moduleTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#fff3e0;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">모듈</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">자재</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">두께</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">가로(W)</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">세로(H)</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">엣지</th>
        </tr>
      </thead>
      <tbody>`;

        let lastDoorItemLabel = '';
        let doorNo = 0;
        doorParts.forEach((m) => {
          if (m.itemLabel && m.itemLabel !== lastDoorItemLabel) {
            lastDoorItemLabel = m.itemLabel;
            moduleTableHTML += `
      <tr style="background:#fff3e0;">
        <td colspan="8" style="border:1px solid #ddd;padding:8px;font-weight:bold;color:#e65100;">📦 ${m.itemLabel}</td>
      </tr>`;
          }
          doorNo++;
          moduleTableHTML += `
      <tr style="background:${doorNo % 2 === 0 ? '#fff' : '#fff8e1'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${doorNo}</td>
        <td style="border:1px solid #ddd;padding:8px;">${m.module}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:600;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:600;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#e65100;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.edge}</td>
      </tr>`;
        });
        moduleTableHTML += '</tbody></table>';

        // 규격별 테이블
        const aggDoor = aggregateMaterials(doorParts);
        let specTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#fff3e0;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">부품</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">자재</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">두께</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">가로(W)</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">세로(H)</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">엣지</th>
          <th style="border:1px solid #ddd;padding:10px;">출처</th>
        </tr>
      </thead>
      <tbody>`;

        aggDoor.forEach((m, i) => {
          specTableHTML += `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#fff8e1'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${i + 1}</td>
        <td style="border:1px solid #ddd;padding:8px;font-weight:600;">${m.parts.join(', ')}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:600;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:600;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#e65100;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.edge}</td>
        <td style="border:1px solid #ddd;padding:8px;font-size:11px;color:#666;">${m.modules.join(', ')}</td>
      </tr>`;
        });
        specTableHTML += '</tbody></table>';

        // 도어 총 수량 계산
        const totalDoors = doorParts.reduce((sum, m) => sum + m.qty, 0);

        return `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:14px;font-weight:bold;color:#333;">🚪 도어 자재 목록</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="display:flex;gap:4px;">
          <button onclick="switchBomView('door','module',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#1976d2;color:#fff;font-weight:bold;">모듈별</button>
          <button onclick="switchBomView('door','spec',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#e0e0e0;color:#666;font-weight:normal;">규격별 (${aggDoor.length})</button>
        </div>
        <span style="background:#ff9800;color:white;padding:4px 12px;border-radius:15px;font-size:12px;">총 ${totalDoors}개</span>
      </div>
    </div>
    <div id="door-module-view" style="max-height:400px;overflow-y:auto;">${moduleTableHTML}</div>
    <div id="door-spec-view" style="display:none;max-height:400px;overflow-y:auto;">${specTableHTML}</div>
    <div style="margin-top:15px;padding:12px;background:#f5f5f5;border-radius:8px;font-size:12px;color:#666;">
      <strong>📌 도어 규칙:</strong> 상부장 도어 = 상부장 높이(설정값) / 하부장 모듈 = 하부장높이 - 상판 - 다리발 / 너비 = 모듈너비 - 4mm
    </div>
  `;
      }

      // EP 자재 탭
      function generateEPMaterialTab(materials) {
        const epParts = materials.filter((m) =>
          ['걸레받이', '휠라', '목찬넬', '상몰딩', '몰딩', '덧대', 'EP'].some((p) => m.module.includes(p) || m.part.includes(p))
          && m.material !== 'PB'
        );

        if (epParts.length === 0)
          return '<p style="color:#666;text-align:center;padding:40px;">EP(마감재) 자재가 없습니다.</p>';

        // 모듈별 테이블
        let moduleTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#e8f5e9;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">품목</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">자재</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">두께</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">가로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">세로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">엣지</th>
        </tr>
      </thead>
      <tbody>`;

        let lastEpItemLabel = '';
        let epNo = 0;
        epParts.forEach((m) => {
          if (m.itemLabel && m.itemLabel !== lastEpItemLabel) {
            lastEpItemLabel = m.itemLabel;
            moduleTableHTML += `
      <tr style="background:#c8e6c9;">
        <td colspan="8" style="border:1px solid #ddd;padding:8px;font-weight:bold;color:#1b5e20;">📦 ${m.itemLabel}</td>
      </tr>`;
          }
          epNo++;
          moduleTableHTML += `
      <tr style="background:${epNo % 2 === 0 ? '#fff' : '#e8f5e9'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${epNo}</td>
        <td style="border:1px solid #ddd;padding:8px;font-weight:600;">${m.part}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#2e7d32;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.edge}</td>
      </tr>`;
        });
        moduleTableHTML += '</tbody></table>';

        // 규격별 테이블
        const aggEP = aggregateMaterials(epParts);
        let specTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#e8f5e9;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">품목</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">자재</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">두께</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">가로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:right;">세로</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">엣지</th>
          <th style="border:1px solid #ddd;padding:10px;">출처</th>
        </tr>
      </thead>
      <tbody>`;

        aggEP.forEach((m, i) => {
          specTableHTML += `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#e8f5e9'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${i + 1}</td>
        <td style="border:1px solid #ddd;padding:8px;font-weight:600;">${m.parts.join(', ')}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#2e7d32;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${m.edge}</td>
        <td style="border:1px solid #ddd;padding:8px;font-size:11px;color:#666;">${m.modules.join(', ')}</td>
      </tr>`;
        });
        specTableHTML += '</tbody></table>';

        return `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:14px;font-weight:bold;color:#333;">📐 EP(마감재) 자재 목록 (${epParts.length}개 품목)</span>
      <div style="display:flex;gap:4px;">
        <button onclick="switchBomView('ep','module',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#1976d2;color:#fff;font-weight:bold;">모듈별</button>
        <button onclick="switchBomView('ep','spec',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#e0e0e0;color:#666;font-weight:normal;">규격별 (${aggEP.length})</button>
      </div>
    </div>
    <div id="ep-module-view" style="max-height:400px;overflow-y:auto;">${moduleTableHTML}</div>
    <div id="ep-spec-view" style="display:none;max-height:400px;overflow-y:auto;">${specTableHTML}</div>
  `;
      }

      // 부자재 규격별 집계
      function aggregateHardware(hardware) {
        const map = new Map();
        hardware.forEach(h => {
          const key = `${h.category}|${h.item}|${h.spec || ''}|${h.manufacturer || ''}|${h.unit}`;
          if (map.has(key)) {
            const agg = map.get(key);
            agg.qty += h.qty;
            if (h.note && !agg.notes.includes(h.note)) agg.notes.push(h.note);
          } else {
            map.set(key, { ...h, qty: h.qty, notes: h.note ? [h.note] : [] });
          }
        });
        return [...map.values()].sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item));
      }

      // 부자재 탭
      function generateHardwareTab(hwResult) {
        if (!hwResult.hardware || hwResult.hardware.length === 0) {
          return '<p style="color:#666;text-align:center;padding:40px;">부자재 정보가 없습니다.</p>';
        }

        // 모듈별 테이블
        let moduleTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#fce4ec;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">분류</th>
          <th style="border:1px solid #ddd;padding:10px;">품목</th>
          <th style="border:1px solid #ddd;padding:10px;">제조사</th>
          <th style="border:1px solid #ddd;padding:10px;">스펙</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">단위</th>
          <th style="border:1px solid #ddd;padding:10px;">비고</th>
        </tr>
      </thead>
      <tbody>`;

        let lastHwItemLabel = '';
        let hwNo = 0;
        hwResult.hardware.forEach((h) => {
          if (h.itemLabel && h.itemLabel !== lastHwItemLabel) {
            lastHwItemLabel = h.itemLabel;
            moduleTableHTML += `
      <tr style="background:#f8bbd0;">
        <td colspan="8" style="border:1px solid #ddd;padding:8px;font-weight:bold;color:#880e4f;">📦 ${h.itemLabel}</td>
      </tr>`;
          }
          hwNo++;
          moduleTableHTML += `
      <tr style="background:${hwNo % 2 === 0 ? '#fff' : '#fce4ec'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${hwNo}</td>
        <td style="border:1px solid #ddd;padding:8px;">${h.category}</td>
        <td style="border:1px solid #ddd;padding:8px;font-weight:600;">${h.item}</td>
        <td style="border:1px solid #ddd;padding:8px;">${h.manufacturer || '-'}</td>
        <td style="border:1px solid #ddd;padding:8px;">${h.spec || '-'}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#c2185b;">${h.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${h.unit}</td>
        <td style="border:1px solid #ddd;padding:8px;font-size:11px;color:#666;">${h.note || ''}</td>
      </tr>`;
        });
        moduleTableHTML += '</tbody></table>';

        // 규격별 테이블
        const aggHW = aggregateHardware(hwResult.hardware);
        let specTableHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead style="background:#fce4ec;">
        <tr>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">No</th>
          <th style="border:1px solid #ddd;padding:10px;">분류</th>
          <th style="border:1px solid #ddd;padding:10px;">품목</th>
          <th style="border:1px solid #ddd;padding:10px;">제조사</th>
          <th style="border:1px solid #ddd;padding:10px;">스펙</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">수량</th>
          <th style="border:1px solid #ddd;padding:10px;text-align:center;">단위</th>
          <th style="border:1px solid #ddd;padding:10px;">비고</th>
        </tr>
      </thead>
      <tbody>`;

        aggHW.forEach((h, i) => {
          specTableHTML += `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#fce4ec'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${i + 1}</td>
        <td style="border:1px solid #ddd;padding:8px;">${h.category}</td>
        <td style="border:1px solid #ddd;padding:8px;font-weight:600;">${h.item}</td>
        <td style="border:1px solid #ddd;padding:8px;">${h.manufacturer || '-'}</td>
        <td style="border:1px solid #ddd;padding:8px;">${h.spec || '-'}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:bold;color:#c2185b;">${h.qty}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${h.unit}</td>
        <td style="border:1px solid #ddd;padding:8px;font-size:11px;color:#666;">${h.notes.join(', ')}</td>
      </tr>`;
        });
        specTableHTML += '</tbody></table>';

        return `
    <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:14px;font-weight:bold;color:#333;">🔩 부자재 목록 (${hwResult.hardware.length}개 품목)</span>
      <div style="display:flex;gap:4px;">
        <button onclick="switchBomView('hw','module',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#1976d2;color:#fff;font-weight:bold;">품목별</button>
        <button onclick="switchBomView('hw','spec',this)" style="padding:4px 12px;border:none;border-radius:4px;cursor:pointer;font-size:11px;background:#e0e0e0;color:#666;font-weight:normal;">규격별 (${aggHW.length})</button>
      </div>
    </div>
    <div id="hw-module-view" style="max-height:400px;overflow-y:auto;">${moduleTableHTML}</div>
    <div id="hw-spec-view" style="display:none;max-height:400px;overflow-y:auto;">${specTableHTML}</div>
  `;
      }

      // 보고서 모달 표시
      function showReportModal(content) {
        const existingModal = document.getElementById('reportModal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'reportModal';
        modal.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);">
      <div style="background:white;border-radius:16px;width:95%;max-width:1100px;max-height:90vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="background:linear-gradient(135deg, #1976d2 0%, #1565c0 100%);color:white;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:20px;display:flex;align-items:center;gap:10px;">✅ 설계 완료 - 자재 추출 보고서</h3>
          <button onclick="document.getElementById('reportModal').remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:20px;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;">&times;</button>
        </div>
        <div style="padding:24px;overflow-y:auto;max-height:calc(90vh - 180px);">
          ${content}
        </div>
        <div style="padding:15px 24px;border-top:1px solid #eee;background:#f9f9f9;">
          <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;">
            <div style="display:flex;gap:8px;">
              <button onclick="downloadReportExcel()" style="background:linear-gradient(135deg, #4caf50 0%, #388e3c 100%);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;display:flex;align-items:center;gap:5px;">
                📊 엑셀 다운로드
              </button>
              <button onclick="downloadReportCSV()" style="background:linear-gradient(135deg, #2196f3 0%, #1976d2 100%);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;display:flex;align-items:center;gap:5px;">
                📄 CSV 다운로드
              </button>
              <button onclick="downloadReportCNC()" style="background:linear-gradient(135deg, #ff9800 0%, #f57c00 100%);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;display:flex;align-items:center;gap:5px;">
                🔧 CNC 파일
              </button>
            </div>
            <div style="display:flex;gap:8px;">
              <button onclick="generateDrawingFromReport()" style="background:linear-gradient(135deg, #9c27b0 0%, #7b1fa2 100%);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;display:flex;align-items:center;gap:5px;">
                📐 도면 생성
              </button>
              <button onclick="document.getElementById('reportModal').remove()" style="background:#eee;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;">닫기</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
        document.body.appendChild(modal);
      }

      // 보고서에서 재단 최적화 실행
      function generateDrawingFromReport() {
        // 팝업 닫기
        document.getElementById('reportModal')?.remove();
        // 재단 최적화 실행
        showNestingOptimizer();
      }

      // 엑셀 다운로드 (CSV를 엑셀 호환 형식으로)
      function downloadReportExcel() {
        if (!window._reportData) return;

        const data = window._reportData;
        const dateStr = new Date().toISOString().slice(0, 10);

        // 엑셀 호환 CSV (UTF-8 BOM + Tab 구분)
        let excelContent = '\uFEFF'; // BOM

        // 헤더 정보
        const item = data.design.items[0];
        excelContent += `다담 캐비넷 - 자재 추출 보고서\n`;
        excelContent += `프로젝트\t${item.name || item.category}\n`;
        excelContent += `크기\t${item.w} × ${item.h} × ${item.d}\n`;
        excelContent += `추출일시\t${new Date().toLocaleString('ko-KR')}\n\n`;

        // 자재 목록
        excelContent += `[본체 및 도어 자재]\n`;
        excelContent += `모듈\t부품\t자재\t두께(T)\t가로(mm)\t세로(mm)\t수량\t엣지\t비고\n`;
        data.materials.materials.forEach((m) => {
          excelContent += `${m.module}\t${m.part}\t${m.material}\t${m.thickness}\t${m.w}\t${m.h}\t${m.qty}\t${m.edge}\t${m.note || ''}\n`;
        });

        excelContent += `\n[패널 사용량 요약]\n`;
        excelContent += `자재\t총면적(㎡)\t필요 패널 수\n`;
        Object.values(data.materials.summary).forEach((s) => {
          excelContent += `${s.material} ${s.thickness}T\t${(s.totalArea / 1000000).toFixed(2)}\t${s.panelCount}장\n`;
        });

        // 부자재 목록
        if (data.hardware.hardware && data.hardware.hardware.length > 0) {
          excelContent += `\n[부자재]\n`;
          excelContent += `분류\t품목\t제조사\t스펙\t수량\t단위\t비고\n`;
          data.hardware.hardware.forEach((h) => {
            excelContent += `${h.category}\t${h.item}\t${h.manufacturer || ''}\t${h.spec || ''}\t${h.qty}\t${h.unit}\t${h.note || ''}\n`;
          });
        }

        const blob = new Blob([excelContent], { type: 'application/vnd.ms-excel;charset=utf-8;' });
        const filename = `자재보고서_${item.category}_${dateStr}.xls`;
        downloadBlob(blob, filename);

        showToast('📊 엑셀 파일이 다운로드되었습니다.');
      }

      // BOM 엑셀 다운로드 (SheetJS 다중 시트)
      function downloadBOMExcel() {
        if (!window._cncData || !window._reportData) {
          showToast('BOM 데이터가 없습니다. 먼저 BOM 산출을 실행하세요.');
          return;
        }
        if (typeof XLSX === 'undefined') {
          showToast('SheetJS 라이브러리를 로드할 수 없습니다. 네트워크를 확인하세요.');
          return;
        }

        try {
          const cnc = window._cncData;
          const rpt = window._reportData;
          const wb = XLSX.utils.book_new();

          // === 시트 1: CNC 규격목록 ===
          const s1Data = [['No', '자재', '두께(T)', '가로(mm)', '세로(mm)', '총수량', '겹침(최대5)', '재단횟수', '용도', '엣지']];
          cnc.sorted.forEach((m, i) => {
            const stack = Math.min(m.qty, 5);
            const rounds = Math.ceil(m.qty / 5);
            const perStrip = Math.floor(1220 / m.w) || 1;
            const hCuts = rounds;
            const vCuts = rounds * Math.min(perStrip, Math.ceil(m.qty / rounds));
            s1Data.push([
              i + 1, m.material, m.thickness, m.w, m.h, m.qty,
              stack, hCuts + vCuts,
              m.parts.join(', '),
              m.edges.length > 0 ? m.edges.join(', ') : '-'
            ]);
          });
          const ws1 = XLSX.utils.aoa_to_sheet(s1Data);
          ws1['!cols'] = [{wch:5},{wch:12},{wch:8},{wch:10},{wch:10},{wch:8},{wch:10},{wch:10},{wch:30},{wch:15}];
          XLSX.utils.book_append_sheet(wb, ws1, 'CNC 규격목록');

          // === 시트 2: 원판 배치 ===
          // panelDetails에서 flat rows로 변환
          const s2Data = [['자재그룹','원판#','겹침장수','방향','회전','strip#','1차재단(mm)','부품명','부품규격(mm)','수량','잔여활용','strip잔여(mm)']];
          (cnc.panelDetails || []).forEach(pd => {
            const isH = (pd.dir === '가로→세로');
            (pd.strips || []).forEach((strip, si) => {
              // strip별 1차재단 치수
              const firstCut = isH ? (strip.height || 0) : (strip.width || 0);
              // strip 잔여
              const stripRem = isH ? (strip.remainW || 0) : (strip.remainH || 0);
              const stripDimH = isH ? strip.height : 0;
              const stripDimW = isH ? 0 : strip.width;
              const remStr = stripRem > 0 ? (isH ? stripRem + 'x' + (strip.height||0) : (strip.width||0) + 'x' + stripRem) : '';

              (strip.pieces || []).forEach((p, pi) => {
                const total = (p.count || 0) * (pd.stack || 1);
                s2Data.push([
                  pi === 0 && si === 0 ? pd.group : '',
                  pi === 0 && si === 0 ? pd.id : '',
                  pi === 0 && si === 0 ? pd.stack : '',
                  pi === 0 && si === 0 ? pd.dir : '',
                  pi === 0 && si === 0 ? pd.rotated : '',
                  pi === 0 ? (si + 1) : '',
                  pi === 0 ? firstCut : '',
                  p.part || '',
                  (p.w || 0) + 'x' + (p.h || 0),
                  total,
                  p.fromRemainder ? '잔여활용' : '',
                  pi === 0 ? remStr : ''
                ]);
              });
            });
          });
          const ws2 = XLSX.utils.aoa_to_sheet(s2Data);
          ws2['!cols'] = [{wch:14},{wch:7},{wch:9},{wch:11},{wch:6},{wch:7},{wch:12},{wch:18},{wch:14},{wch:7},{wch:10},{wch:14}];
          XLSX.utils.book_append_sheet(wb, ws2, '원판 배치');

          // === 시트 3: 잔재·소부품 ===
          const s3Data = [];

          // 섹션 A - 잔여 조각
          s3Data.push(['[A] 잔여 조각 (>70mm)', '', '', '', '', '']);
          s3Data.push(['자재', '가로(mm)', '세로(mm)', '수량', '면적(㎠)', '활용']);
          if (cnc.allRemnants && cnc.allRemnants.length > 0) {
            const remMap = new Map();
            cnc.allRemnants.forEach(r => {
              const key = r.group + '|' + r.w + 'x' + r.h;
              const ex = remMap.get(key);
              if (ex) ex.qty += r.qty;
              else remMap.set(key, { group: r.group, w: r.w, h: r.h, qty: r.qty });
            });
            [...remMap.values()].sort((a, b) => (b.w * b.h) - (a.w * a.h)).forEach(r => {
              const area = Math.round(r.w * r.h * r.qty / 100);
              let reuse = (r.w >= 200 && r.h >= 200) ? '재활용 가능' : '폐기';
              if (Math.min(r.w, r.h) >= 60 && Math.min(r.w, r.h) <= 70) reuse = '밴드 가능';
              s3Data.push([r.group, r.w, r.h, r.qty, area, reuse]);
            });
          }
          s3Data.push(['', '', '', '', '', '']);

          // 섹션 B - 자투리
          s3Data.push(['[B] 자투리 (60~70mm)', '', '', '', '', '']);
          s3Data.push(['자재', '가로(mm)', '세로(mm)', '수량', '길이합(mm)', '종류']);
          if (cnc.allThinStrips && cnc.allThinStrips.length > 0) {
            const thinMap = new Map();
            cnc.allThinStrips.forEach(t => {
              const key = t.group + '|' + t.w + 'x' + t.h;
              const ex = thinMap.get(key);
              if (ex) ex.qty += t.qty;
              else thinMap.set(key, { group: t.group, w: t.w, h: t.h, qty: t.qty, type: t.type });
            });
            [...thinMap.values()].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h)).forEach(t => {
              s3Data.push([t.group, t.w, t.h, t.qty, Math.max(t.w, t.h) * t.qty, t.type]);
            });
          }
          s3Data.push(['', '', '', '', '', '']);

          // 섹션 C - 소부품 추출
          if (cnc.allocResults && cnc.allocResults.length > 0) {
            s3Data.push(['[C] 소부품 추출 (잔재 활용)', '', '', '', '', '', '']);
            s3Data.push(['잔재자재', '잔재규격', '잔재수', '추출부품', '부품규격', '장당', '추출수량']);
            cnc.allocResults.forEach(alloc => {
              alloc.parts.forEach((p, pi) => {
                s3Data.push([
                  pi === 0 ? alloc.group : '',
                  pi === 0 ? alloc.w + 'x' + alloc.h : '',
                  pi === 0 ? alloc.qty : '',
                  p.part, p.w + 'x' + p.h, p.perSheet, p.produced
                ]);
              });
            });
            s3Data.push(['', '', '', '', '', '', '']);
          }

          // 섹션 D - 미충족
          const unmet = (cnc.stillNeeded || []).filter(s => s.remain > 0);
          if (unmet.length > 0) {
            s3Data.push(['[D] 미충족 (별도 재단 필요)', '', '', '', '']);
            s3Data.push(['부품명', '규격', '자재', '필요', '미충족']);
            unmet.forEach(s => {
              s3Data.push([s.part, s.w + 'x' + s.h, s.group, s.total, s.remain]);
            });
          }

          const ws3 = XLSX.utils.aoa_to_sheet(s3Data);
          ws3['!cols'] = [{wch:14},{wch:12},{wch:12},{wch:10},{wch:12},{wch:10},{wch:10}];
          XLSX.utils.book_append_sheet(wb, ws3, '잔재·소부품');

          // === 시트 4: 전체 자재 ===
          const s4Data = [['모듈','부품','자재','두께(T)','가로(mm)','세로(mm)','수량','엣지','비고']];
          rpt.materials.materials.forEach(m => {
            s4Data.push([m.module, m.part, m.material, m.thickness, m.w, m.h, m.qty, m.edge || '-', m.note || '']);
          });
          const ws4 = XLSX.utils.aoa_to_sheet(s4Data);
          ws4['!cols'] = [{wch:12},{wch:15},{wch:10},{wch:8},{wch:10},{wch:10},{wch:6},{wch:12},{wch:15}];
          XLSX.utils.book_append_sheet(wb, ws4, '전체 자재');

          // === 시트 5: 부자재 ===
          const hwList = (rpt.hardware && rpt.hardware.hardware) || [];
          if (hwList.length > 0) {
            const s5Data = [['분류','품목','스펙','수량','단위','비고']];
            hwList.forEach(h => {
              s5Data.push([h.category, h.item, h.spec || '', h.qty, h.unit, h.note || '']);
            });
            const ws5 = XLSX.utils.aoa_to_sheet(s5Data);
            ws5['!cols'] = [{wch:12},{wch:20},{wch:20},{wch:8},{wch:8},{wch:20}];
            XLSX.utils.book_append_sheet(wb, ws5, '부자재');
          }

          // Blob 기반 다운로드 (브라우저 호환성)
          const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const dateStr = new Date().toISOString().slice(0, 10);
          const item = rpt.design.items[0];
          const filename = 'BOM_' + (item.category || item.name || 'report') + '_' + dateStr + '.xlsx';
          downloadBlob(blob, filename);

          showToast('📊 BOM 엑셀(.xlsx) ' + (cnc.panelDetails || []).length + '패널 포함 다운로드 완료');
        } catch (e) {
          console.error('BOM Excel error:', e);
          showToast('엑셀 생성 오류: ' + e.message);
        }
      }

      // 워드 다운로드 공통 헬퍼
      function _buildWordHTML(title, content, landscape) {
        const rpt = window._reportData;
        const item = rpt && rpt.design ? rpt.design.items[0] : {};
        const projectName = (item.name || item.category || '') + ' ' + (item.w || '') + '×' + (item.h || '');
        const dateStr = new Date().toLocaleString('ko-KR');
        const pageSize = landscape ? 'A4 landscape' : 'A4';
        return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  @page { size: ${pageSize}; margin: 15mm; }
  body { font-family: '맑은 고딕', 'Malgun Gothic', sans-serif; font-size: 14px; color: #333; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; }
  th { background: #e3f2fd; font-weight: bold; }
</style></head>
<body>
  <h2 style="color:#1976d2;">${title}</h2>
  <p style="font-size:13px;color:#666;">프로젝트: ${projectName} | 출력일시: ${dateStr}</p>
  <hr style="border:1px solid #1976d2;margin-bottom:16px;">
  ${content}
</body></html>`;
      }

      // 규격 목록 워드 다운로드
      function downloadBOMWordSpec() {
        const moduleView = document.getElementById('cnc-module-view');
        if (!moduleView || !moduleView.innerHTML.trim()) {
          showToast('규격 목록 데이터가 없습니다.');
          return;
        }
        const item = window._reportData?.design?.items?.[0] || {};
        const html = _buildWordHTML('✂️ CNC 규격 목록', moduleView.innerHTML, true);
        const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8' });
        const filename = 'CNC_규격목록_' + (item.category || 'report') + '_' + new Date().toISOString().slice(0, 10) + '.doc';
        downloadBlob(blob, filename);
        showToast('📄 규격 목록 워드 파일이 다운로드되었습니다.');
      }

      // 원판 배치 워드 다운로드 (SVG → PNG 이미지 포함)
      async function downloadBOMWordPanel() {
        const specView = document.getElementById('cnc-spec-view');
        if (!specView || !specView.innerHTML.trim()) {
          showToast('원판 배치 데이터가 없습니다.');
          return;
        }

        showToast('📄 워드 파일 생성 중... (이미지 변환)');

        try {
          // SVG → PNG base64 변환
          const svgs = specView.querySelectorAll('svg');
          const imgMap = new Map(); // svg element → base64 img tag

          for (const svg of svgs) {
            try {
              const svgData = new XMLSerializer().serializeToString(svg);
              const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
              const url = URL.createObjectURL(svgBlob);

              const img = new Image();
              await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
              });

              // 2배 해상도로 렌더링 (선명도 향상)
              const scale = 2;
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth * scale;
              canvas.height = img.naturalHeight * scale;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.scale(scale, scale);
              ctx.drawImage(img, 0, 0);

              const base64 = canvas.toDataURL('image/png');
              const imgTag = `<img src="${base64}" width="${img.naturalWidth}" height="${img.naturalHeight}" style="display:block;margin:8px auto;max-width:100%;">`;
              imgMap.set(svg, imgTag);

              URL.revokeObjectURL(url);
            } catch (e) {
              console.warn('[Word] SVG 변환 실패:', e);
            }
          }

          // HTML 복사본에서 SVG를 IMG로 교체
          const clone = specView.cloneNode(true);
          const cloneSvgs = clone.querySelectorAll('svg');
          const origSvgs = specView.querySelectorAll('svg');
          cloneSvgs.forEach((csvg, idx) => {
            const origSvg = origSvgs[idx];
            const imgTag = imgMap.get(origSvg);
            if (imgTag) {
              const wrapper = document.createElement('div');
              wrapper.innerHTML = imgTag;
              csvg.parentNode.replaceChild(wrapper.firstChild, csvg);
            }
          });

          const item = window._reportData?.design?.items?.[0] || {};
          const html = _buildWordHTML('✂️ CNC 원판 배치 계획', clone.innerHTML, true);
          const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8' });
          const filename = 'CNC_원판배치_' + (item.category || 'report') + '_' + new Date().toISOString().slice(0, 10) + '.doc';
          downloadBlob(blob, filename);
          showToast('📄 원판 배치 워드 파일이 다운로드되었습니다. (이미지 포함)');
        } catch (e) {
          console.error('[Word] 워드 생성 오류:', e);
          // 폴백: 이미지 없이 기존 방식
          const item = window._reportData?.design?.items?.[0] || {};
          const html = _buildWordHTML('✂️ CNC 원판 배치 계획', specView.innerHTML, true);
          const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8' });
          const filename = 'CNC_원판배치_' + (item.category || 'report') + '_' + new Date().toISOString().slice(0, 10) + '.doc';
          downloadBlob(blob, filename);
          showToast('📄 워드 파일 다운로드 (이미지 변환 실패, 텍스트만)');
        }
      }

      // CSV 다운로드
      function downloadReportCSV() {
        if (!window._reportData) return;

        const data = window._reportData;
        const dateStr = new Date().toISOString().slice(0, 10);
        const item = data.design.items[0];

        const blob = new Blob(['\uFEFF' + data.csvMaterial], { type: 'text/csv;charset=utf-8;' });
        const filename = `자재목록_${item.category}_${dateStr}.csv`;
        downloadBlob(blob, filename);

        showToast('📄 CSV 파일이 다운로드되었습니다.');
      }

      // CNC 파일 다운로드
      function downloadReportCNC() {
        if (!window._reportData) return;

        const data = window._reportData;
        const dateStr = new Date().toISOString().slice(0, 10);
        const item = data.design.items[0];

        const blob = new Blob(['\uFEFF' + data.cncMaterial], { type: 'text/csv;charset=utf-8;' });
        const filename = `CNC재단_${item.category}_${dateStr}.csv`;
        downloadBlob(blob, filename);

        showToast('🔧 CNC 파일이 다운로드되었습니다.');
      }

      // 파일 다운로드 헬퍼
      function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      // 토스트 메시지
      function showToast(message) {
        const existing = document.querySelector('.toast-message');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast-message';
        toast.style.cssText =
          'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:12px 24px;border-radius:8px;font-size:14px;z-index:20000;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:fadeIn 0.3s ease;';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
          toast.style.opacity = '0';
          toast.style.transition = 'opacity 0.3s ease';
          setTimeout(() => toast.remove(), 300);
        }, 2500);
      }

      // ============================================================
      // 설계 불러오기 함수
      // ============================================================
      function loadDesignFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;

          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const design = JSON.parse(event.target.result);
              const result = window.DadamAgent.importDesign(design);
              if (result.success) {
                alert('설계를 불러왔습니다.');
                location.reload();
              } else {
                alert('설계 불러오기 실패: ' + result.error);
              }
            } catch (err) {
              alert('파일 형식 오류: ' + err.message);
            }
          };
          reader.readAsText(file);
        };
        input.click();
      }

