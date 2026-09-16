/**
 * A4 인쇄용 CSS.
 *
 * 인라인 <style> 로 임베드한다 — 외부 요청이 0회라 공장 네트워크가 CDN 을
 * 막아도 렌더되고, ?v= 캐시 스큐도 없다.
 *
 * 저장소에 PDF 생성 라이브러리가 없고 Workers 에는 headless 브라우저가 없으므로
 * 출력 경로는 브라우저 인쇄(Ctrl+P → PDF 로 저장)다. UI 문구도 "PDF 다운로드"가
 * 아니라 "인쇄 / PDF로 저장" 이어야 한다.
 */

export const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm 10mm 14mm 10mm; }

html, body {
  margin: 0; padding: 0;
  font-family: 'Pretendard', 'Malgun Gothic', '맑은 고딕', -apple-system, sans-serif;
  font-size: 10.5pt; line-height: 1.45; color: #000;
}

.sheet { page-break-after: always; break-after: page; }
.sheet:last-child { page-break-after: auto; break-after: auto; }

/* 여러 장에 걸친 자재 목록에서 표 머리를 반복한다 — 공장 인쇄물 필수 */
thead { display: table-header-group; }
tfoot { display: table-footer-group; }
tr, .no-break { break-inside: avoid; page-break-inside: avoid; }

table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; }
th, td { border: 0.4pt solid #000; padding: 3pt 4pt; text-align: left; vertical-align: top; }
/* 공장 프린터는 흑백 — 배경 대신 테두리·굵기로 대비를 만든다 */
th { background: #eee; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }

.doc-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  border-bottom: 1.2pt solid #000; padding-bottom: 5pt; margin-bottom: 10pt;
}
.doc-header h1 { font-size: 17pt; margin: 0 0 3pt; letter-spacing: 2pt; }
.doc-meta { text-align: right; font-size: 8.5pt; line-height: 1.6; }
.doc-no { font-family: 'Consolas', monospace; font-size: 9pt; }

.section-title {
  font-size: 12pt; font-weight: 700; margin: 12pt 0 4pt;
  border-left: 3pt solid #000; padding-left: 5pt;
}

.kv { display: grid; grid-template-columns: 70pt 1fr 70pt 1fr; gap: 3pt 6pt; font-size: 10pt; }
.kv dt { font-weight: 700; color: #333; }
.kv dd { margin: 0; }

.totals { margin-left: auto; width: 62%; }
.totals td { border: none; border-bottom: 0.4pt solid #ccc; padding: 4pt; }
.totals tr.grand td {
  border-top: 1pt solid #000; border-bottom: 2.4pt double #000;
  font-size: 13pt; font-weight: 700; padding-top: 6pt;
}

.sign-box { display: flex; gap: 0; margin-top: 12pt; }
.sign-box div { flex: 1; border: 0.4pt solid #000; height: 22mm; padding: 2pt 4pt; font-size: 8.5pt; }

.note { font-size: 9pt; color: #444; margin-top: 8pt; line-height: 1.6; }
.stamp {
  display: inline-block; border: 1.6pt solid #147a3d; color: #147a3d;
  padding: 5pt 12pt; font-weight: 700; border-radius: 3pt; margin-top: 8pt;
}
.warn { border: 1pt solid #a00; color: #a00; padding: 6pt 8pt; margin: 8pt 0; font-size: 9.5pt; }

/* ── 작업지시서 v2 (B5) ─────────────────────────────────────── */
table.compact th, table.compact td { padding: 2pt 3pt; font-size: 8.5pt; }
.muted { color: #666; font-size: 9pt; }
.sub-title { font-size: 10pt; font-weight: 700; margin: 8pt 0 2pt; border-bottom: 0.8pt solid #000; padding-bottom: 1pt; }
.mono { font-family: 'Consolas', monospace; font-size: 8pt; word-break: break-all; }

/* 표지 — 품목별 정면 렌더 */
.render-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6pt; margin: 4pt 0 8pt; }
.render-box { border: 0.4pt solid #000; padding: 4pt; text-align: center; font-size: 8.5pt; break-inside: avoid; }
.render-box img { display: block; max-width: 100%; max-height: 58mm; object-fit: contain; margin: 0 auto 2pt; }
.render-box .ph {
  height: 34mm; display: flex; align-items: center; justify-content: center;
  color: #666; border: 0.4pt dashed #999; margin-bottom: 2pt;
}

/* 색 스와치 칩 — 흑백 프린터에서도 코드·이름이 남도록 칩은 보조다 */
.chip {
  display: inline-block; width: 11pt; height: 11pt; border: 0.4pt solid #000; vertical-align: middle;
  margin-right: 3pt; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.chip.none { background: repeating-linear-gradient(45deg, #fff 0 2pt, #bbb 2pt 3pt); }

/* 엣지 면 도식 — 굵은 변이 밴딩 */
.edge-svg { width: 22pt; height: 14pt; vertical-align: middle; margin-right: 2pt; }

/* 시트별 재단표 — 배치 축소판 + 부재 표 나란히 */
.cut-sheet { display: flex; gap: 8pt; align-items: flex-start; margin: 4pt 0 10pt; break-inside: avoid; page-break-inside: avoid; }
.cut-sheet .cut-svg { flex: 0 0 36%; }
.cut-sheet .cut-svg svg { width: 100%; height: auto; max-height: 150mm; border: 0.4pt solid #000; display: block; }
.cut-sheet .cut-parts { flex: 1 1 auto; min-width: 0; }
.cut-head { font-size: 9pt; margin: 6pt 0 2pt; }
.cut-head b { margin-right: 6pt; }

/* 조립 순서 체크 */
table.check td.box { text-align: center; font-size: 12pt; width: 8%; }
table.check td.blank { width: 12%; }

/* 부재 라벨 부록 — A4 3×8 = 24장 (라벨 63×32mm) */
.label-grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 32mm; gap: 1mm; }
.label {
  border: 0.4pt dashed #888; padding: 1.5mm; display: flex; gap: 1.5mm; align-items: center;
  overflow: hidden; break-inside: avoid; page-break-inside: avoid;
}
.label svg.qr { width: 24mm; height: 24mm; flex: 0 0 24mm; }
.label .lt { font-size: 7.5pt; line-height: 1.3; min-width: 0; }
.label .lt .pid { font-family: 'Consolas', monospace; font-size: 7pt; word-break: break-all; }
.label .lt .dim { font-size: 10pt; font-weight: 700; }

/* 화면에서는 A4 용지처럼 보이게 */
@media screen {
  body { background: #525659; padding: 20px 0; }
  .sheet {
    width: 210mm; min-height: 297mm; margin: 0 auto 16px;
    padding: 12mm 10mm; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.4);
  }
  .toolbar {
    position: sticky; top: 0; z-index: 10; background: #2d2f31; color: #fff;
    padding: 10px 16px; display: flex; gap: 10px; align-items: center;
    justify-content: center; margin-bottom: 16px;
  }
  .toolbar button {
    background: #4a8cf7; color: #fff; border: 0; border-radius: 5px;
    padding: 8px 16px; font-size: 14px; cursor: pointer;
  }
  .toolbar button:hover { background: #3a7ce7; }
}

@media print { .no-print { display: none !important; } }
`;

/** 인쇄 버튼 — 화면에서만 보인다. */
export const PRINT_TOOLBAR = `
<div class="toolbar no-print">
  <span>Ctrl+P → 대상을 "PDF로 저장"으로 선택하면 PDF 파일로 받을 수 있습니다.</span>
  <button type="button" onclick="window.print()">인쇄 / PDF로 저장</button>
</div>
`;
