      // ============================================================
      // 재단 최적화 클래스 (Nesting Optimizer) v1.0
      // ============================================================
      // 그룹1: 측판, 지판 → 실시간 재단 도면
      // 그룹2: 서랍재 (H60, H120, H180) → 재고 운영
      // 그룹3: 보강목, 쫄대 (W60, W70) → 재고 운영
      // ============================================================

      class NestingOptimizer {
        constructor() {
          this.PANEL_W = 1220; // 패널 너비
          this.PANEL_H = 2440; // 패널 높이
          this.KERF = 4; // 톱날 두께
          this.MARGIN = 10; // 패널 가장자리 여유
        }

        // ========================================
        // 메인: 자재 분류 및 재단 최적화
        // ========================================
        process(materials) {
          // 1. 자재 그룹 분류
          const grouped = this.classifyMaterials(materials);

          // 2. 그룹1 재단 최적화 (측판, 지판 등)
          const nestingResult = this.optimizeNesting(grouped.group1);

          // 3. 결과 반환
          return {
            group1: grouped.group1, // 재단 대상
            group2: grouped.group2, // 서랍재 (재고)
            group3: grouped.group3, // 보강목/쫄대 (재고)
            doors: grouped.doors, // 도어재
            backs: grouped.backs, // 뒷판
            eps: grouped.eps, // EP (걸레받이 등)
            nesting: nestingResult, // 재단 결과
            summary: this.calculateSummary(grouped, nestingResult),
          };
        }

        // ========================================
        // 자재 그룹 분류
        // ========================================
        classifyMaterials(materials) {
          const result = {
            group1: [], // 측판, 지판, 천판, 선반, 중간칸막이
            group2: [], // 서랍재 (H: 60, 120, 180)
            group3: [], // 보강목, 쫄대, 밴드 (W: 60, 70)
            doors: [], // 도어
            backs: [], // 뒷판
            eps: [], // EP (걸레받이, 휠라, 목찬넬, 상몰딩, 좌대)
          };

          materials.forEach((m) => {
            const part = m.part;
            const h = m.h;
            const w = m.w;

            // 도어
            if (part.includes('도어')) {
              result.doors.push(m);
            }
            // 뒷판
            else if (part.includes('뒷판')) {
              result.backs.push(m);
            }
            // EP류
            else if (['걸레받이', '휠라', '목찬넬', '상몰딩', '좌대'].some((ep) => part.includes(ep))) {
              result.eps.push(m);
            }
            // 그룹2: 서랍재 (높이 60, 120, 180)
            else if (part.includes('서랍') || [60, 120, 180].includes(h)) {
              result.group2.push(m);
            }
            // 그룹3: 보강목, 쫄대, 밴드 (폭 60, 70)
            else if (part.includes('밴드') || part.includes('보강') || part.includes('쫄대') || [60, 70].includes(w)) {
              result.group3.push(m);
            }
            // 그룹1: 측판, 지판, 천판, 선반 등 (재단 대상)
            else {
              result.group1.push(m);
            }
          });

          return result;
        }

        // ========================================
        // 그룹1 재단 최적화 (Guillotine Cut)
        // ========================================
        optimizeNesting(parts) {
          if (!parts || parts.length === 0) {
            return { sheets: [], totalSheets: 0, efficiency: 0 };
          }

          // 자재+두께별 분류
          const byMaterial = {};
          parts.forEach((p) => {
            const key = `${p.material}_${p.thickness}T`;
            if (!byMaterial[key]) byMaterial[key] = [];
            // 수량만큼 개별 부품으로 확장
            for (let i = 0; i < p.qty; i++) {
              byMaterial[key].push({
                ...p,
                partId: `${p.module}_${p.part}_${i + 1}`,
                qty: 1,
              });
            }
          });

          const allSheets = [];

          // 자재별 재단
          Object.entries(byMaterial).forEach(([matKey, matParts]) => {
            const [material, thickness] = matKey.split('_');
            const sheets = this.nestParts(matParts, material, thickness);
            allSheets.push(...sheets);
          });

          // 전체 효율 계산
          let totalUsed = 0,
            totalPanel = 0;
          allSheets.forEach((s) => {
            totalUsed += s.usedArea;
            totalPanel += this.PANEL_W * this.PANEL_H;
          });

          return {
            sheets: allSheets,
            totalSheets: allSheets.length,
            efficiency: totalPanel > 0 ? Math.round((totalUsed / totalPanel) * 1000) / 10 : 0,
          };
        }

        // ========================================
        // Guillotine Nesting (최소 재단 횟수)
        // ========================================
        nestParts(parts, material, thickness) {
          const sheets = [];

          // 면적 기준 내림차순 정렬 (큰 것 먼저)
          const sorted = [...parts].sort((a, b) => {
            const areaA = a.w * a.h;
            const areaB = b.w * b.h;
            if (areaA !== areaB) return areaB - areaA;
            return b.h - a.h; // 높이 큰 것 우선
          });

          const remaining = [...sorted];

          while (remaining.length > 0) {
            const sheet = this.createSheet(material, thickness);

            // 사용 가능한 영역 초기화
            sheet.freeRects = [
              {
                x: this.MARGIN,
                y: this.MARGIN,
                w: this.PANEL_W - this.MARGIN * 2,
                h: this.PANEL_H - this.MARGIN * 2,
              },
            ];

            // 부품 배치
            const placed = [];
            for (let i = remaining.length - 1; i >= 0; i--) {
              const part = remaining[i];
              const placement = this.placePart(sheet, part);
              if (placement) {
                sheet.placements.push(placement);
                placed.push(i);
              }
            }

            // 배치된 부품 제거
            placed.forEach((idx) => remaining.splice(idx, 1));

            // 재단선 계산
            sheet.cuts = this.calculateCuts(sheet.placements);

            // 사용 면적 계산
            sheet.usedArea = sheet.placements.reduce((sum, p) => sum + p.w * p.h, 0);
            sheet.efficiency = Math.round((sheet.usedArea / (this.PANEL_W * this.PANEL_H)) * 1000) / 10;

            sheets.push(sheet);

            // 무한루프 방지
            if (placed.length === 0) {
              console.warn('배치 불가능한 부품:', remaining[0]);
              break;
            }
          }

          return sheets;
        }

        createSheet(material, thickness) {
          return {
            sheetId: Date.now() + Math.random(),
            material,
            thickness,
            width: this.PANEL_W,
            height: this.PANEL_H,
            placements: [],
            cuts: [],
            freeRects: [],
            usedArea: 0,
            efficiency: 0,
          };
        }

        // ========================================
        // 부품 배치 (Best Fit)
        // ========================================
        placePart(sheet, part) {
          let bestRect = null;
          let bestFit = Infinity;
          let bestIdx = -1;

          // 가장 적합한 빈 공간 찾기
          for (let i = 0; i < sheet.freeRects.length; i++) {
            const rect = sheet.freeRects[i];

            // 회전 없이 배치 가능?
            if (part.w <= rect.w && part.h <= rect.h) {
              const fit = rect.w * rect.h - part.w * part.h;
              if (fit < bestFit) {
                bestFit = fit;
                bestRect = { ...rect, rotated: false };
                bestIdx = i;
              }
            }

            // 회전해서 배치 가능? (뒷판만 회전 허용)
            if (part.part && part.part.includes('뒷판')) {
              if (part.h <= rect.w && part.w <= rect.h) {
                const fit = rect.w * rect.h - part.w * part.h;
                if (fit < bestFit) {
                  bestFit = fit;
                  bestRect = { ...rect, rotated: true };
                  bestIdx = i;
                }
              }
            }
          }

          if (!bestRect) return null;

          // 부품 배치
          const placement = {
            partId: part.partId || `${part.module}_${part.part}`,
            name: part.part,
            module: part.module,
            x: bestRect.x,
            y: bestRect.y,
            w: bestRect.rotated ? part.h : part.w,
            h: bestRect.rotated ? part.w : part.h,
            originalW: part.w,
            originalH: part.h,
            rotated: bestRect.rotated,
            edge: part.edge,
            material: part.material,
            thickness: part.thickness,
          };

          // 빈 공간에서 제거
          sheet.freeRects.splice(bestIdx, 1);

          // Guillotine 분할 (최소 재단 횟수 위해 수평 우선)
          this.splitRect(sheet, bestRect, placement);

          return placement;
        }

        // ========================================
        // Guillotine 분할 (수평 우선 - 재단 횟수 최소화)
        // ========================================
        splitRect(sheet, rect, placement) {
          const rightW = rect.w - placement.w - this.KERF;
          const topH = rect.h - placement.h - this.KERF;

          // 수평 분할 우선 (긴 수평선 하나로 여러 부품 재단 가능)
          if (topH > 50) {
            sheet.freeRects.push({
              x: rect.x,
              y: rect.y + placement.h + this.KERF,
              w: rect.w,
              h: topH,
            });
          }
          if (rightW > 50) {
            sheet.freeRects.push({
              x: rect.x + placement.w + this.KERF,
              y: rect.y,
              w: rightW,
              h: placement.h,
            });
          }

          // 빈 공간 정렬 (작은 것 우선 사용)
          sheet.freeRects.sort((a, b) => a.w * a.h - b.w * b.h);
        }

        // ========================================
        // 재단선 계산
        // ========================================
        calculateCuts(placements) {
          const cuts = [];
          const horizontalY = new Set();
          const verticalX = new Set();

          placements.forEach((p) => {
            // 수평 재단선 (부품 상단)
            horizontalY.add(p.y + p.h + this.KERF / 2);
            // 수직 재단선 (부품 우측)
            verticalX.add(p.x + p.w + this.KERF / 2);
          });

          horizontalY.forEach((y) => {
            if (y < this.PANEL_H - this.MARGIN) {
              cuts.push({ type: 'horizontal', y, x1: 0, x2: this.PANEL_W });
            }
          });

          verticalX.forEach((x) => {
            if (x < this.PANEL_W - this.MARGIN) {
              cuts.push({ type: 'vertical', x, y1: 0, y2: this.PANEL_H });
            }
          });

          return cuts;
        }

        // ========================================
        // 요약 계산
        // ========================================
        calculateSummary(grouped, nesting) {
          const countParts = (arr) => arr.reduce((sum, p) => sum + (p.qty || 1), 0);

          return {
            group1Count: countParts(grouped.group1),
            group2Count: countParts(grouped.group2),
            group3Count: countParts(grouped.group3),
            doorCount: countParts(grouped.doors),
            backCount: countParts(grouped.backs),
            epCount: countParts(grouped.eps),
            totalSheets: nesting.totalSheets,
            efficiency: nesting.efficiency,
          };
        }

        // ========================================
        // Canvas 렌더링 (재단 도면)
        // ========================================
        renderSheet(canvas, sheet, scale = 0.25) {
          const ctx = canvas.getContext('2d');
          const W = this.PANEL_W * scale;
          const H = this.PANEL_H * scale;

          canvas.width = W + 40;
          canvas.height = H + 60;

          ctx.fillStyle = '#f5f5f5';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // 패널 배경
          ctx.fillStyle = '#fff8e1';
          ctx.fillRect(20, 20, W, H);
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 2;
          ctx.strokeRect(20, 20, W, H);

          // 패널 크기 표시
          ctx.fillStyle = '#333';
          ctx.font = '11px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(`${this.PANEL_W}mm`, 20 + W / 2, 15);
          ctx.save();
          ctx.translate(12, 20 + H / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(`${this.PANEL_H}mm`, 0, 0);
          ctx.restore();

          // 색상 팔레트
          const colors = ['#81d4fa', '#a5d6a7', '#ffe082', '#ef9a9a', '#ce93d8', '#80cbc4', '#ffcc80', '#b39ddb'];

          // 부품 렌더링
          sheet.placements.forEach((p, idx) => {
            const x = 20 + p.x * scale;
            const y = 20 + (this.PANEL_H - p.y - p.h) * scale; // Y축 반전
            const w = p.w * scale;
            const h = p.h * scale;

            // 부품 배경
            ctx.fillStyle = colors[idx % colors.length];
            ctx.fillRect(x, y, w, h);

            // 부품 테두리
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);

            // 엣지 표시
            this.renderEdge(ctx, x, y, w, h, p.edge);

            // 부품명
            ctx.fillStyle = '#000';
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const label = p.name.length > 6 ? p.name.substring(0, 6) : p.name;
            ctx.fillText(label, x + w / 2, y + h / 2 - 6);

            ctx.font = '9px Arial';
            ctx.fillText(`${p.originalW}×${p.originalH}`, x + w / 2, y + h / 2 + 6);
          });

          // 재단선 렌더링
          ctx.strokeStyle = '#e53935';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 3]);

          sheet.cuts.forEach((cut) => {
            ctx.beginPath();
            if (cut.type === 'horizontal') {
              const y = 20 + (this.PANEL_H - cut.y) * scale;
              ctx.moveTo(20, y);
              ctx.lineTo(20 + W, y);
            } else {
              const x = 20 + cut.x * scale;
              ctx.moveTo(x, 20);
              ctx.lineTo(x, 20 + H);
            }
            ctx.stroke();
          });

          ctx.setLineDash([]);

          // 정보 표시
          ctx.fillStyle = '#333';
          ctx.font = '11px Arial';
          ctx.textAlign = 'left';
          ctx.fillText(
            `${sheet.material} ${sheet.thickness}  |  효율: ${sheet.efficiency}%  |  부품: ${sheet.placements.length}개  |  재단선: ${sheet.cuts.length}개`,
            20,
            H + 50
          );
        }

        // ========================================
        // 엣지 표시 렌더링
        // ========================================
        renderEdge(ctx, x, y, w, h, edge) {
          if (!edge || edge === '-') return;

          ctx.strokeStyle = '#d32f2f';
          ctx.lineWidth = 3;

          const edgeStr = edge.toString();

          // 4면 엣지
          if (edgeStr.includes('4면')) {
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            return;
          }

          // 1면(전) - 앞면만
          if (edgeStr.includes('1면(전)') || edgeStr.includes('1면')) {
            ctx.beginPath();
            ctx.moveTo(x, y + h);
            ctx.lineTo(x + w, y + h);
            ctx.stroke();
            return;
          }

          // 2면(장) - 긴면 2개
          if (edgeStr.includes('2면(장)')) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + w, y);
            ctx.moveTo(x, y + h);
            ctx.lineTo(x + w, y + h);
            ctx.stroke();
            return;
          }

          // 2면(단) - 짧은면 2개
          if (edgeStr.includes('2면(단)')) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x, y + h);
            ctx.moveTo(x + w, y);
            ctx.lineTo(x + w, y + h);
            ctx.stroke();
          }
        }
      }

      // 전역 인스턴스
      const nestingOptimizer = new NestingOptimizer();

      // ============================================================
      // 재단 최적화 UI
      // ============================================================
      function showNestingOptimizer() {
        const design = window.DadamAgent.exportDesign();
        if (!design.items || design.items.length === 0) {
          alert('설계 데이터가 없습니다.');
          return;
        }

        // 자재 추출
        const matResult = materialExtractor.extract(design);
        if (!matResult.materials.length) {
          alert('추출된 자재가 없습니다.');
          return;
        }

        // 재단 최적화
        const result = nestingOptimizer.process(matResult.materials);
        dlog('[Nesting] 결과:', result);

        // 팝업 생성
        showNestingModal(result, design);
      }

      function showNestingModal(result, design) {
        const existingModal = document.getElementById('nestingModal');
        if (existingModal) existingModal.remove();

        const item = design.items[0];
        const projectName = `${item.name || item.categoryId} ${item.w}×${item.h}`;

        // 자재 테이블 생성
        const group1Table = generateMaterialTable(result.group1, '그룹1: 재단 대상 (측판, 지판, 천판, 선반 등)');
        const group2Table = generateMaterialTable(result.group2, '그룹2: 서랍재 (재고 운영)');
        const group3Table = generateMaterialTable(result.group3, '그룹3: 보강목/쫄대 (재고 운영)');
        const doorTable = generateMaterialTable(result.doors, '도어재');
        const backTable = generateMaterialTable(result.backs, '뒷판');
        const epTable = generateMaterialTable(result.eps, 'EP (걸레받이, 휠라 등)');

        // 재단 도면 캔버스 생성
        let sheetCanvases = '';
        if (result.nesting.sheets.length > 0) {
          result.nesting.sheets.forEach((sheet, idx) => {
            sheetCanvases += `
        <div style="margin-bottom:20px;padding:15px;background:#fafafa;border-radius:8px;">
          <h4 style="margin:0 0 10px 0;color:#1976d2;">📐 패널 #${idx + 1} - ${sheet.material} ${sheet.thickness}</h4>
          <canvas id="nestingCanvas_${idx}" style="border:1px solid #ddd;border-radius:4px;"></canvas>
        </div>
      `;
          });
        } else {
          sheetCanvases = '<p style="color:#666;text-align:center;padding:40px;">재단 대상 부품이 없습니다.</p>';
        }

        const modal = document.createElement('div');
        modal.id = 'nestingModal';
        modal.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);">
      <div style="background:white;border-radius:16px;width:95%;max-width:1200px;max-height:90vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="background:linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%);color:white;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;font-size:20px;display:flex;align-items:center;gap:10px;">🪵 재단 최적화 - ${projectName}</h3>
          <button onclick="document.getElementById('nestingModal').remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:20px;cursor:pointer;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;">&times;</button>
        </div>
        
        <div style="display:flex;border-bottom:1px solid #e0e0e0;">
          <button class="nesting-tab active" onclick="switchNestingTab(this, 'summary')" style="flex:1;padding:12px;border:none;background:#e8f5e9;color:#2e7d32;font-weight:bold;cursor:pointer;">📊 요약</button>
          <button class="nesting-tab" onclick="switchNestingTab(this, 'cutting')" style="flex:1;padding:12px;border:none;background:#f5f5f5;color:#666;font-weight:bold;cursor:pointer;">📐 재단도면</button>
          <button class="nesting-tab" onclick="switchNestingTab(this, 'materials')" style="flex:1;padding:12px;border:none;background:#f5f5f5;color:#666;font-weight:bold;cursor:pointer;">📋 전체자재</button>
        </div>
        
        <div style="padding:20px;overflow-y:auto;max-height:calc(90vh - 180px);">
          <!-- 요약 탭 -->
          <div id="nesting-tab-summary" class="nesting-content">
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:15px;margin-bottom:20px;">
              <div style="background:linear-gradient(135deg, #42a5f5 0%, #1976d2 100%);color:white;padding:20px;border-radius:12px;text-align:center;">
                <div style="font-size:32px;font-weight:bold;">${result.nesting.totalSheets}</div>
                <div style="font-size:12px;opacity:0.9;">필요 패널 수</div>
              </div>
              <div style="background:linear-gradient(135deg, #66bb6a 0%, #43a047 100%);color:white;padding:20px;border-radius:12px;text-align:center;">
                <div style="font-size:32px;font-weight:bold;">${result.nesting.efficiency}%</div>
                <div style="font-size:12px;opacity:0.9;">재단 효율</div>
              </div>
              <div style="background:linear-gradient(135deg, #ffca28 0%, #ffa000 100%);color:white;padding:20px;border-radius:12px;text-align:center;">
                <div style="font-size:32px;font-weight:bold;">${result.summary.group1Count}</div>
                <div style="font-size:12px;opacity:0.9;">재단 부품</div>
              </div>
              <div style="background:linear-gradient(135deg, #ab47bc 0%, #7b1fa2 100%);color:white;padding:20px;border-radius:12px;text-align:center;">
                <div style="font-size:32px;font-weight:bold;">${result.summary.doorCount}</div>
                <div style="font-size:12px;opacity:0.9;">도어 수</div>
              </div>
            </div>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
              <div style="background:#e3f2fd;padding:15px;border-radius:10px;">
                <h4 style="margin:0 0 10px 0;color:#1565c0;">🔧 재고 운영 부품</h4>
                <div style="font-size:13px;color:#333;">
                  <div style="margin-bottom:5px;">• 서랍재 (그룹2): <strong>${result.summary.group2Count}개</strong></div>
                  <div>• 보강목/쫄대 (그룹3): <strong>${result.summary.group3Count}개</strong></div>
                </div>
              </div>
              <div style="background:#fce4ec;padding:15px;border-radius:10px;">
                <h4 style="margin:0 0 10px 0;color:#c2185b;">📦 기타 자재</h4>
                <div style="font-size:13px;color:#333;">
                  <div style="margin-bottom:5px;">• 뒷판: <strong>${result.summary.backCount}개</strong></div>
                  <div>• EP (걸레받이 등): <strong>${result.summary.epCount}개</strong></div>
                </div>
              </div>
            </div>
            
            <div style="margin-top:20px;background:#fff3e0;padding:15px;border-radius:10px;border:1px solid #ffe0b2;">
              <h4 style="margin:0 0 10px 0;color:#e65100;">💡 엣지 표시 안내</h4>
              <div style="display:flex;gap:20px;font-size:12px;">
                <span><span style="display:inline-block;width:20px;height:3px;background:#d32f2f;vertical-align:middle;margin-right:5px;"></span> 빨간 굵은선 = 엣지 처리면</span>
                <span><span style="display:inline-block;width:20px;height:1px;background:#e53935;border-style:dashed;vertical-align:middle;margin-right:5px;"></span> 빨간 점선 = 재단선</span>
              </div>
            </div>
          </div>
          
          <!-- 재단도면 탭 -->
          <div id="nesting-tab-cutting" class="nesting-content" style="display:none;">
            ${sheetCanvases}
          </div>
          
          <!-- 전체자재 탭 -->
          <div id="nesting-tab-materials" class="nesting-content" style="display:none;">
            ${group1Table}
            ${doorTable}
            ${group2Table}
            ${group3Table}
            ${backTable}
            ${epTable}
          </div>
        </div>
        
        <div style="padding:15px 24px;border-top:1px solid #eee;background:#f9f9f9;display:flex;gap:10px;justify-content:space-between;">
          <div style="display:flex;gap:8px;">
            <button onclick="downloadNestingCSV()" style="background:linear-gradient(135deg, #4caf50 0%, #388e3c 100%);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;">📄 재단목록 CSV</button>
            <button onclick="downloadNestingPDF()" style="background:linear-gradient(135deg, #2196f3 0%, #1976d2 100%);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;">📋 재단지시서</button>
            <button onclick="printNestingSheets()" style="background:linear-gradient(135deg, #ff9800 0%, #f57c00 100%);color:white;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;">🖨️ 인쇄</button>
          </div>
          <button onclick="document.getElementById('nestingModal').remove()" style="background:#eee;border:none;padding:10px 16px;border-radius:8px;cursor:pointer;font-weight:bold;font-size:13px;">닫기</button>
        </div>
      </div>
    </div>
  `;

        document.body.appendChild(modal);

        // 전역 데이터 저장
        window._nestingResult = result;

        // Canvas 렌더링
        setTimeout(() => {
          result.nesting.sheets.forEach((sheet, idx) => {
            const canvas = document.getElementById(`nestingCanvas_${idx}`);
            if (canvas) {
              nestingOptimizer.renderSheet(canvas, sheet, 0.28);
            }
          });
        }, 100);
      }

      // 탭 전환
      function switchNestingTab(btn, tabId) {
        document.querySelectorAll('.nesting-tab').forEach((t) => {
          t.style.background = '#f5f5f5';
          t.style.color = '#666';
          t.classList.remove('active');
        });
        btn.style.background = '#e8f5e9';
        btn.style.color = '#2e7d32';
        btn.classList.add('active');

        document.querySelectorAll('.nesting-content').forEach((c) => (c.style.display = 'none'));
        document.getElementById('nesting-tab-' + tabId).style.display = 'block';

        // 재단도면 탭 선택시 Canvas 다시 렌더링
        if (tabId === 'cutting' && window._nestingResult) {
          setTimeout(() => {
            window._nestingResult.nesting.sheets.forEach((sheet, idx) => {
              const canvas = document.getElementById(`nestingCanvas_${idx}`);
              if (canvas) {
                nestingOptimizer.renderSheet(canvas, sheet, 0.28);
              }
            });
          }, 50);
        }
      }

      // 자재 테이블 생성
      function generateMaterialTable(materials, title) {
        if (!materials || materials.length === 0) {
          return `<div style="margin-bottom:20px;"><h4 style="color:#666;margin-bottom:10px;">${title}</h4><p style="color:#999;font-size:13px;">해당 자재 없음</p></div>`;
        }

        let html = `
    <div style="margin-bottom:25px;">
      <h4 style="color:#333;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #4caf50;">${title}</h4>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead style="background:#e8f5e9;">
          <tr>
            <th style="border:1px solid #ddd;padding:8px;text-align:center;">No</th>
            <th style="border:1px solid #ddd;padding:8px;">모듈</th>
            <th style="border:1px solid #ddd;padding:8px;">부품</th>
            <th style="border:1px solid #ddd;padding:8px;text-align:center;">자재</th>
            <th style="border:1px solid #ddd;padding:8px;text-align:center;">두께</th>
            <th style="border:1px solid #ddd;padding:8px;text-align:right;">가로</th>
            <th style="border:1px solid #ddd;padding:8px;text-align:right;">세로</th>
            <th style="border:1px solid #ddd;padding:8px;text-align:center;">수량</th>
            <th style="border:1px solid #ddd;padding:8px;text-align:center;">엣지</th>
          </tr>
        </thead>
        <tbody>
  `;

        materials.forEach((m, idx) => {
          html += `
      <tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9f9'};">
        <td style="border:1px solid #ddd;padding:6px;text-align:center;">${idx + 1}</td>
        <td style="border:1px solid #ddd;padding:6px;">${m.module}</td>
        <td style="border:1px solid #ddd;padding:6px;">${m.part}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:center;">${m.material}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:center;">${m.thickness}T</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:right;">${m.w}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:right;">${m.h}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:center;">${m.qty}</td>
        <td style="border:1px solid #ddd;padding:6px;text-align:center;color:#d32f2f;font-weight:bold;">${m.edge}</td>
      </tr>
    `;
        });

        html += '</tbody></table></div>';
        return html;
      }

      // CSV 다운로드
      function downloadNestingCSV() {
        if (!window._nestingResult) return;

        const result = window._nestingResult;
        let csv = '\uFEFF'; // BOM
        csv += '그룹,모듈,부품,자재,두께,가로,세로,수량,엣지\n';

        const addRows = (group, groupName) => {
          group.forEach((m) => {
            csv += `${groupName},${m.module},${m.part},${m.material},${m.thickness},${m.w},${m.h},${m.qty},${m.edge}\n`;
          });
        };

        addRows(result.group1, '그룹1(재단)');
        addRows(result.doors, '도어재');
        addRows(result.group2, '그룹2(서랍)');
        addRows(result.group3, '그룹3(보강)');
        addRows(result.backs, '뒷판');
        addRows(result.eps, 'EP');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `재단목록_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
      }

      // 재단 지시서 (간단 버전)
      function downloadNestingPDF() {
        if (!window._nestingResult) return;

        const result = window._nestingResult;
        let content = '═══════════════════════════════════════════════════════\n';
        content += '              다담 가구 - 재단 지시서\n';
        content += '═══════════════════════════════════════════════════════\n';
        content += `작성일시: ${new Date().toLocaleString('ko-KR')}\n`;
        content += `필요 패널: ${result.nesting.totalSheets}장  |  효율: ${result.nesting.efficiency}%\n`;
        content += '───────────────────────────────────────────────────────\n\n';

        result.nesting.sheets.forEach((sheet, idx) => {
          content += `[패널 #${idx + 1}] ${sheet.material} ${sheet.thickness} (${sheet.width}×${sheet.height}mm)\n`;
          content += `효율: ${sheet.efficiency}%  |  재단선: ${sheet.cuts.length}개\n`;
          content += '───────────────────────────────────────────────────────\n';

          sheet.placements.forEach((p, pIdx) => {
            content += `  ${pIdx + 1}. ${p.name} (${p.originalW}×${p.originalH})\n`;
            content += `     위치: X=${p.x}, Y=${p.y}  |  엣지: ${p.edge}\n`;
            content += `     모듈: ${p.module}\n\n`;
          });
          content += '\n';
        });

        const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `재단지시서_${new Date().toISOString().slice(0, 10)}.txt`;
        a.click();
      }

      // 인쇄
      function printNestingSheets() {
        window.print();
      }

      // ============================================================
      // Supabase 인증 및 데이터 저장 시스템
      // ============================================================
      // (Supabase 설정은 js/supabase-utils.js에서 관리)

      // n8n Webhook URL (설정 필요)
      const N8N_WEBHOOK_URL = ''; // 예: 'https://your-n8n.com/webhook/design-save'

      // AI 디자인 생성 API URL (설계 데이터 기반 - Fast Generation)
      // Cloudflare Proxy 경유 (CORS 해결)
      const N8N_AI_DESIGN_URL = 'https://dadam.app.n8n.cloud/webhook/design-to-image';
      const N8N_CHAT_URL = 'https://dadam.app.n8n.cloud/webhook/chat';

      // ═══════════════════════════════════════════════════════════════
      // 채팅 기록 저장/불러오기 (Supabase)
      // ═══════════════════════════════════════════════════════════════

      // 세션 ID 생성/가져오기 (비로그인 사용자용)
      function getChatSessionId() {
        let sessionId = sessionStorage.getItem('chat_session_id');
        if (!sessionId) {
          sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          sessionStorage.setItem('chat_session_id', sessionId);
        }
        return sessionId;
      }

      // 메시지 저장
      async function saveChatMessage(content, role) {
        if (!supabaseClient) return;

        try {
          const userId = currentUser?.id || null;
          const sessionId = userId ? null : getChatSessionId();

          await supabaseClient.from('chat_messages').insert({
            user_id: userId,
            session_id: sessionId,
            role: role,
            content: content,
            page_source: 'detail-design'
          });
        } catch (error) {
          dlog('메시지 저장 실패:', error.message);
        }
      }

      // 대화 기록 불러오기
      async function loadChatHistory() {
        if (!supabaseClient) return;

        try {
          const userId = currentUser?.id;
          const sessionId = getChatSessionId();

          let query = supabaseClient
            .from('chat_messages')
            .select('*')
            .eq('page_source', 'detail-design')
            .order('created_at', { ascending: true })
            .limit(50);

          if (userId) {
            query = query.eq('user_id', userId);
          } else {
            query = query.eq('session_id', sessionId);
          }

          const { data, error } = await query;

          if (error) throw error;

          if (data && data.length > 0) {
            data.forEach(msg => {
              addChatMessage(msg.content, msg.role === 'user', null, false);
            });
          }
        } catch (error) {
          dlog('대화 기록 불러오기 실패:', error.message);
        }
      }

      // 이미지를 Supabase Storage에 업로드 (SupabaseUtils 위임)
      async function uploadImageToStorage(file, userId) {
        return SupabaseUtils.uploadImage(file, userId);
      }

      let supabaseClient = null;
      let currentUser = null;
      let userProfile = null;
      let currentDesignId = null;
      let autoSaveTimer = null;
      let hasUnsavedChanges = false;

      // Supabase 초기화 및 인증 확인 (SupabaseUtils 통합)
      async function initAuth() {
        // SupabaseUtils 사용 (js/supabase-utils.js)
        const session = await SupabaseUtils.init();

        // 카탈로그 로드 (Supabase 연결 후)
        FurnitureOptionCatalog.load().catch(e => console.warn('[Catalog] async load error:', e));

        // 로컬 참조 동기화 (하위 호환성)
        supabaseClient = SupabaseUtils.client;

        if (!session) {
          showAuthOverlay();
          return;
        }

        currentUser = SupabaseUtils.currentUser;
        await loadUserProfile();
      }

      // 사용자 프로필 로드
      async function loadUserProfile() {
        // profiles 테이블에서 조회 (또는 auth.users metadata 사용)
        const fallbackProfile = () => ({
          id: currentUser.id,
          email: currentUser.email,
          tier: currentUser.user_metadata?.tier || 'standard',
          name: currentUser.user_metadata?.name || currentUser.email.split('@')[0],
        });

        try {
          const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();

          if (!error && data) {
            userProfile = data;
          } else {
            console.warn('[Auth] profiles 조회 실패, metadata 폴백:', error?.message);
            userProfile = fallbackProfile();
          }
        } catch (e) {
          console.warn('[Auth] profiles 조회 예외, metadata 폴백:', e.message);
          userProfile = fallbackProfile();
        }

        // 인증 성공 - UI 업데이트 (등급 제한 제거 - ai-design.html에서 리디렉트 처리)
        hideAuthOverlay();
        document.getElementById('toolbarUser').textContent = currentUser.email;

        // 네비게이션 사용자 정보 표시
        const name = userProfile.name || currentUser.email.split('@')[0];
        document.getElementById('navUserAvatar').textContent = name.charAt(0).toUpperCase();
        document.getElementById('navUserName').textContent = name;

        // URL에서 설계 ID 확인 (수정 모드)
        const urlParams = new URLSearchParams(window.location.search);
        const designId = urlParams.get('id');
        if (designId) {
          await loadDesign(designId);
        }

        // 자동 저장 설정 (5분마다)
        setupAutoSave();

        // 이전 대화 기록 불러오기
        loadChatHistory();
      }

      // 인증 오버레이 표시/숨김
      function showAuthOverlay() {
        document.getElementById('authOverlay')?.classList.remove('hidden');
        document.getElementById('topToolbar')?.classList.add('hidden');
      }

      function hideAuthOverlay() {
        document.getElementById('authOverlay')?.classList.add('hidden');
        document.getElementById('topToolbar')?.classList.remove('hidden');
      }

      // 모바일 메뉴 토글
      function toggleMobileMenu() {
        const hamburger = document.querySelector('.hamburger');
        const mobileMenu = document.getElementById('mobileMenu');
        hamburger.classList.toggle('active');
        mobileMenu.classList.toggle('active');
      }

      // 네비게이션 로그아웃
      async function logoutNav() {
        await SupabaseUtils.signOut('index.html');
      }

      // 설계 저장
      async function saveDesign() {
        if (!currentUser || !supabaseClient) {
          alert('로그인이 필요합니다.');
          return;
        }

        if (selectedItems.length === 0) {
          alert('저장할 설계 내용이 없습니다.');
          return;
        }

        updateSaveStatus('saving', '저장 중...');

        try {
          // 설계 데이터 준비
          const designData = window.DadamAgent.exportDesign();
          const designName = prompt(
            '설계 이름을 입력하세요:',
            currentDesignId ? '기존 설계' : `설계_${new Date().toLocaleDateString('ko-KR')}`
          );

          if (!designName) {
            updateSaveStatus('saved', '저장됨');
            return;
          }

          // 신규 또는 업데이트
          if (currentDesignId) {
            // 기존 설계 업데이트
            const { error } = await supabaseClient
              .from('designs')
              .update({
                name: designName,
                total_items: selectedItems.length,
                total_modules: selectedItems.reduce((sum, item) => sum + (item.modules?.length || 0), 0),
                app_version: APP_CONFIG.version,
                updated_at: new Date().toISOString(),
              })
              .eq('id', currentDesignId);

            if (error) throw error;

            // 기존 아이템 삭제 후 재삽입
            await supabaseClient.from('design_items').delete().eq('design_id', currentDesignId);

            await saveDesignItems(currentDesignId);
          } else {
            // 신규 설계 생성
            const { data: newDesign, error } = await supabaseClient
              .from('designs')
              .insert({
                user_id: currentUser.id,
                name: designName,
                status: 'draft',
                total_items: selectedItems.length,
                total_modules: selectedItems.reduce((sum, item) => sum + (item.modules?.length || 0), 0),
                app_version: APP_CONFIG.version,
              })
              .select()
              .single();

            if (error) throw error;

            currentDesignId = newDesign.id;
            await saveDesignItems(currentDesignId);

            // URL 업데이트
            window.history.replaceState({}, '', `?id=${currentDesignId}`);
          }

          // n8n Webhook 호출 (설정된 경우)
          if (N8N_WEBHOOK_URL) {
            await sendToN8N(designData);
          }

          hasUnsavedChanges = false;
          updateSaveStatus('saved', '저장됨');
        } catch (error) {
          console.error('저장 실패:', error);
          updateSaveStatus('error', '저장 실패');
          alert('저장 중 오류가 발생했습니다: ' + error.message);
        }
      }

      // 설계 아이템 저장
      async function saveDesignItems(designId) {
        const itemsToInsert = selectedItems.map((item, index) => ({
          design_id: designId,
          category: item.category || item.categoryId,
          name: item.name,
          unique_id: Math.floor(item.uniqueId), // bigint 호환을 위해 정수로 변환
          width: item.w,
          height: item.h,
          depth: item.d,
          specs: {
            ...(item.specs || {}),
            imageUrl: (item.imageUrl || item.image) !== 'loading' ? item.imageUrl || item.image || null : null,
          },
          modules: item.modules || [],
          item_order: index,
        }));

        const { error } = await supabaseClient.from('design_items').insert(itemsToInsert);

        if (error) throw error;
      }

      // 설계 불러오기
      async function loadDesign(designId) {
        try {
          // 설계 메타 정보
          const { data: design, error: designError } = await supabaseClient
            .from('designs')
            .select('*')
            .eq('id', designId)
            .eq('user_id', currentUser.id)
            .single();

          if (designError || !design) {
            throw new Error('설계를 찾을 수 없습니다.');
          }

          // 설계 아이템
          const { data: items, error: itemsError } = await supabaseClient
            .from('design_items')
            .select('*')
            .eq('design_id', designId)
            .order('item_order');

          if (itemsError) throw itemsError;

          // 데이터 복원
          currentDesignId = designId;
          selectedItems = items.map((item) => ({
            uniqueId: item.unique_id || Date.now(),
            category: item.category,
            categoryId: item.category,
            name: item.name,
            w: item.width,
            h: item.height,
            d: item.depth,
            specs: item.specs || { ...DEFAULT_SPECS },
            modules: item.modules || [],
            image: item.specs?.imageUrl || item.specs?.image || null,
            imageUrl: item.specs?.imageUrl || item.specs?.image || null,
          }));

          // UI 업데이트
          updateUI();
          updateSaveStatus('saved', '불러옴');
        } catch (error) {
          console.error('불러오기 실패:', error);
          alert('설계를 불러오는 중 오류가 발생했습니다: ' + error.message);
        }
      }

      // 설계 목록 불러오기 (팝업 모달)
      async function loadDesignList() {
        if (!currentUser || !supabaseClient) {
          alert('로그인이 필요합니다.');
          return;
        }

        try {
          const { data: designs, error } = await supabaseClient
            .from('designs')
            .select('id, name, status, total_items, total_modules, created_at, updated_at')
            .eq('user_id', currentUser.id)
            .order('updated_at', { ascending: false })
            .limit(30);

          if (error) throw error;

          // 모달 생성
          const modal = document.createElement('div');
          modal.className = 'load-modal-overlay';
          modal.id = 'loadDesignModal';
          modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
          };

          const statusLabels = {
            draft: '임시저장',
            submitted: '제출됨',
            in_review: '검토중',
            completed: '완료',
            feedback_done: '피드백완료',
          };

          modal.innerHTML = `
      <div class="load-modal">
        <div class="load-modal-header">
          <h3>📂 저장된 설계 불러오기</h3>
          <button class="load-modal-close" onclick="closeLoadModal()">&times;</button>
        </div>
        <div class="load-modal-body">
          ${
            designs.length === 0
              ? `
            <div class="load-modal-empty">
              <div style="font-size:48px;margin-bottom:16px;">📋</div>
              <p>저장된 설계가 없습니다.</p>
            </div>
          `
              : designs
                  .map(
                    (d) => `
            <div class="design-list-item" onclick="selectDesign('${d.id}')">
              <div class="info">
                <div class="name">${d.name || '제목 없음'}</div>
                <div class="meta">
                  <span>🪑 ${d.total_items || 0}개 가구</span>
                  <span>📅 ${new Date(d.updated_at).toLocaleDateString('ko-KR')}</span>
                  <span class="status ${d.status}">${statusLabels[d.status] || d.status}</span>
                </div>
              </div>
              <button class="delete-btn" onclick="event.stopPropagation();deleteDesignFromList('${d.id}','${(d.name || '').replace(/'/g, "\\'")}')">🗑️</button>
            </div>
          `
                  )
                  .join('')
          }
        </div>
      </div>
    `;

          document.body.appendChild(modal);
        } catch (error) {
          console.error('목록 로드 실패:', error);
          alert('설계 목록을 불러오는 중 오류가 발생했습니다.');
        }
      }

      // 불러오기 모달 닫기
      function closeLoadModal() {
        const modal = document.getElementById('loadDesignModal');
        if (modal) modal.remove();
      }

      // 설계 선택 (새 창으로 열기)
      function selectDesign(designId) {
        closeLoadModal();
        window.open(`detaildesign.html?id=${designId}`, '_blank');
      }

      // 설계 삭제 (목록에서)
      async function deleteDesignFromList(designId, designName) {
        if (!confirm(`"${designName}" 설계를 삭제하시겠습니까?\n삭제된 설계는 복구할 수 없습니다.`)) return;

        try {
          const { error } = await supabaseClient
            .from('designs')
            .delete()
            .eq('id', designId)
            .eq('user_id', currentUser.id);

          if (error) throw error;

          // 모달에서 해당 항목 제거
          const item = document.querySelector(`.design-list-item[onclick*="${designId}"]`);
          if (item) item.remove();

          // 목록이 비었으면 빈 상태 표시
          const body = document.querySelector('.load-modal-body');
          if (body && !body.querySelector('.design-list-item')) {
            body.innerHTML = `
        <div class="load-modal-empty">
          <div style="font-size:48px;margin-bottom:16px;">📋</div>
          <p>저장된 설계가 없습니다.</p>
        </div>
      `;
          }

          // 현재 편집 중인 설계가 삭제된 경우
          if (currentDesignId === designId) {
            currentDesignId = null;
            hasUnsavedChanges = true;
          }
        } catch (error) {
          console.error('삭제 실패:', error);
          alert('설계 삭제 중 오류가 발생했습니다.');
        }
      }

      // 설계 제출 (검토 요청)
      async function submitDesign() {
        if (!currentDesignId) {
          alert('먼저 설계를 저장해주세요.');
          return;
        }

        if (!confirm('설계를 제출하시겠습니까?\n제출 후에도 수정이 가능합니다.')) return;

        try {
          const { error } = await supabaseClient
            .from('designs')
            .update({
              status: 'submitted',
              submitted_at: new Date().toISOString(),
            })
            .eq('id', currentDesignId);

          if (error) throw error;

          // n8n으로 제출 알림
          if (N8N_WEBHOOK_URL) {
            const designData = window.DadamAgent.exportDesign();
            await sendToN8N({ ...designData, action: 'submit', designId: currentDesignId });
          }

          alert('설계가 제출되었습니다.');
        } catch (error) {
          console.error('제출 실패:', error);
          alert('제출 중 오류가 발생했습니다: ' + error.message);
        }
      }

      // n8n Webhook 전송
      async function sendToN8N(data) {
        if (!N8N_WEBHOOK_URL) return;

        try {
          const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              timestamp: new Date().toISOString(),
              userId: currentUser.id,
              userEmail: currentUser.email,
              designId: currentDesignId,
              appVersion: APP_CONFIG.version,
              data: data,
            }),
          });

          if (!response.ok) {
            console.warn('n8n Webhook 응답 오류:', response.status);
          }
        } catch (error) {
          console.warn('n8n Webhook 전송 실패:', error);
        }
      }

      // 저장 상태 UI 업데이트
      function updateSaveStatus(status, text) {
        const statusEl = document.getElementById('saveStatus');
        const iconEl = document.getElementById('saveStatusIcon');
        const textEl = document.getElementById('saveStatusText');

        statusEl.classList.remove('hidden', 'saving', 'saved', 'error');
        statusEl.classList.add(status);

        if (status === 'saving') {
          iconEl.textContent = '⏳';
        } else if (status === 'saved') {
          iconEl.textContent = '✓';
        } else if (status === 'error') {
          iconEl.textContent = '✕';
        }

        textEl.textContent = text;
      }

      // 자동 저장 설정
      function setupAutoSave() {
        // 변경 감지
        const originalUpdateUI = window.updateUI;
        window.updateUI = function () {
          if (originalUpdateUI) originalUpdateUI.apply(this, arguments);
          hasUnsavedChanges = true;
          updateSaveStatus('saving', '수정됨');
        };

        // 5분마다 자동 저장
        autoSaveTimer = setInterval(
          () => {
            if (hasUnsavedChanges && currentDesignId) {
              dlog('자동 저장 실행...');
              // 자동 저장은 조용히 실행
              saveDesignQuiet();
            }
          },
          5 * 60 * 1000
        );

        // 페이지 떠날 때 경고
        window.addEventListener('beforeunload', (e) => {
          if (hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = '';
          }
        });
      }

      // 조용한 저장 (프롬프트 없이)
      async function saveDesignQuiet() {
        if (!currentUser || !supabaseClient || !currentDesignId) return;

        try {
          await supabaseClient
            .from('designs')
            .update({
              total_items: selectedItems.length,
              total_modules: selectedItems.reduce((sum, item) => sum + (item.modules?.length || 0), 0),
              updated_at: new Date().toISOString(),
            })
            .eq('id', currentDesignId);

          await supabaseClient.from('design_items').delete().eq('design_id', currentDesignId);

          await saveDesignItems(currentDesignId);

          hasUnsavedChanges = false;
          updateSaveStatus('saved', '자동 저장됨');
        } catch (error) {
          console.error('자동 저장 실패:', error);
        }
      }

      // ============================================================
      // AI 채팅 시스템
      // ============================================================
      function toggleAIChat() {
        const panel = document.getElementById('aiChatPanel');
        const btn = document.getElementById('aiChatToggle');
        if (panel.style.display === 'none' || !panel.style.display) {
          panel.style.display = 'flex';
          btn.innerHTML = '✕';
          btn.style.background = '#2D2A26';
        } else {
          panel.style.display = 'none';
          btn.innerHTML = '💬 AI 상담';
          btn.style.background = 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)';
        }
      }

      async function sendChatMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        if (!message) return;

        // 사용자 메시지 표시 및 저장
        addChatMessage(message, true);
        input.value = '';

        // 로딩 표시
        const loadingId = 'loading-' + Date.now();
        addChatMessage(
          '<div style="display:flex;align-items:center;gap:8px;"><span class="chat-loading"></span> 응답 중...</div>',
          false,
          loadingId,
          false
        );

        // 현재 설계 데이터 포함
        const design = window.DadamAgent?.exportDesign() || { items: [] };

        try {
          const response = await fetch(N8N_CHAT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: message,
              context: {
                page: 'detaildesign',
                designData: design,
                itemCount: design.items?.length || 0,
              },
            }),
          });

          // 로딩 메시지 제거
          const loadingMsg = document.getElementById(loadingId);
          if (loadingMsg) loadingMsg.remove();

          const data = await response.json();
          const aiResponse = data.response || data.output || '응답을 처리할 수 없습니다.';
          addChatMessage(aiResponse, false);
        } catch (error) {
          // 로딩 메시지 제거
          const loadingMsg = document.getElementById(loadingId);
          if (loadingMsg) loadingMsg.remove();
          addChatMessage('죄송합니다. 연결 오류가 발생했습니다.', false);
        }
      }

      function addChatMessage(text, isUser, msgId, shouldSave = true) {
        const container = document.getElementById('chatMessages');
        const msg = document.createElement('div');
        if (msgId) msg.id = msgId;
        msg.className = `chat-msg ${isUser ? 'user' : 'ai'}`;
        msg.innerHTML = text;
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;

        // DB에 저장 (shouldSave가 true일 때만)
        if (shouldSave && !msgId) {
          saveChatMessage(text, isUser ? 'user' : 'assistant');
        }
      }

      // ============================================================
      // 최적화: 이벤트 위임 핸들러
      // ============================================================

      function setupEventDelegation() {
        const workspace = document.getElementById('step2-content');
        if (!workspace) return;

        // 클릭 이벤트 위임
        workspace.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-action]');
          if (!btn) return;

          const { action, item, mod, field, delta, value } = btn.dataset;
          const itemId = parseFloat(item);
          const modId = parseFloat(mod);

          switch (action) {
            case 'adjust':
              adjustModuleValue(itemId, modId, field, parseInt(delta));
              break;
            case 'setType':
              setModuleType(itemId, modId, field, value);
              break;
            case 'toggle':
              toggleModuleOption(
                itemId,
                modId,
                field,
                btn.checked !== undefined ? btn.checked : !btn.classList.contains('active')
              );
              break;
            // Wardrobe 전용 액션
            case 'moveWdrb':
              moveWardrobeModule(itemId, modId, btn.dataset.dir);
              break;
            case 'setWdrbType':
              setWardrobeModuleType(itemId, modId, btn.dataset.type);
              break;
            case 'removeWdrb':
              removeWardrobeModule(itemId, modId);
              break;
            case 'setDrawerType':
              toggleWardrobeDrawerType(itemId, modId, btn.dataset.value === 'true');
              break;
          }
        });

        // Change 이벤트 위임 (input, select)
        workspace.addEventListener('change', (e) => {
          const input = e.target;
          if (!input.dataset.item) return;

          const { item, mod, field } = input.dataset;
          const itemId = parseFloat(item);
          const modId = mod ? parseFloat(mod) : null;
          const value = input.type === 'checkbox' ? input.checked : input.value;

          if (modId) {
            updateModuleField(itemId, modId, field, value);
          } else if (field) {
            updateItemSpec(itemId, field, value);
          }
        });

        // Input 이벤트 위임 (실시간 업데이트)
        workspace.addEventListener('input', (e) => {
          const input = e.target;
          if (!input.dataset.item || input.type === 'checkbox') return;

          // 디바운스 처리
          clearTimeout(input._debounceTimer);
          input._debounceTimer = setTimeout(() => {
            const { item, mod, field } = input.dataset;
            const itemId = parseFloat(item);
            const modId = mod ? parseFloat(mod) : null;

            if (modId) {
              updateModuleField(itemId, modId, field, input.value, false);
            } else if (field) {
              updateItemSpec(itemId, field, input.value, false);
            }
          }, 300);
        });
      }

      // 페이지 로드 시 초기화
      document.addEventListener('DOMContentLoaded', () => {
        initAuth();
        setupEventDelegation();
      });
