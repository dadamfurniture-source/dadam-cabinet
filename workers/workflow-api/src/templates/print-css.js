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
.pack-head { margin-bottom: 8pt; padding-bottom: 4pt; border-bottom: 0.8pt solid #000; }
.cut-head .checks { float: right; font-size: 10pt; letter-spacing: .5pt; }

/* 도어재 발주서 — 도어마다 앞모습 (2026-11-05) */
.door-grid { display: flex; flex-wrap: wrap; gap: 6pt 10pt; align-items: flex-end; }
.door-card { break-inside: avoid; page-break-inside: avoid; max-width: 48%; }
.door-card svg.door-drawing { display: block; max-width: 100%; height: auto; }
.door-card .door-cap { max-width: 60mm; }
.door-card .door-cap { font-size: 8pt; line-height: 1.35; }

/* 특별 지시 — 지시서 맨 위 빨간 상자 (2026-11-05 사장님 「자동 + 사무실 글」) */
.special-notes { border: 1.6pt solid #b3261e; padding: 4pt 7pt; margin: 4pt 0 8pt; break-inside: avoid; page-break-inside: avoid; }
.special-notes .sn-title { font-weight: 700; color: #b3261e; margin-bottom: 1pt; }
.special-notes .sn-item { font-size: 10pt; line-height: 1.6; }
.special-notes .sn-src { font-size: 7.5pt; color: #555; border: 0.5pt solid #999; border-radius: 2pt; padding: 0 3pt; margin-left: 3pt; }

/* 재단 원장 묶음 — 묶음마다 새 쪽 · 화면에서 [그림] [표] [둘 다] · [이 묶음만 인쇄] (2026-11-05 사장님) */
.cut-group-next { break-before: page; page-break-before: always; }
.cut-group-head { display: flex; align-items: baseline; gap: 6pt; flex-wrap: wrap; border-bottom: 1pt solid #000; padding-bottom: 2pt; margin: 8pt 0 4pt; }
.cut-btns { margin-left: auto; display: inline-flex; gap: 3pt; flex-wrap: wrap; }
.cut-btns button { font: inherit; font-size: 8.5pt; padding: 1pt 7pt; border: 0.6pt solid #1d4f91; background: #fff; color: #1d4f91; border-radius: 3pt; cursor: pointer; }
.cut-btns button[aria-pressed="true"] { background: #1d4f91; color: #fff; }
.cut-tabs { display: flex; flex-wrap: wrap; gap: 4pt; margin: 4pt 0; }
.cut-tabs a { font-size: 8.5pt; border: 0.6pt solid #888; border-radius: 3pt; padding: 1pt 6pt; color: #000; text-decoration: none; }
.cut-group[data-view="draw"] .cut-parts { display: none; }
.cut-group[data-view="draw"] .cut-sheet .cut-svg { flex: 1 1 100%; }
.cut-group[data-view="draw"] .cut-sheet .cut-svg svg { max-height: 230mm; }
.cut-group[data-view="table"] .cut-svg { display: none; }
@media print {
  body.print-group .sheet:not(:has(.print-target)) { display: none !important; }
  body.print-group .cut-group:not(.print-target) { display: none !important; }
  body.print-group .print-target.cut-group-next { break-before: auto; page-break-before: auto; }
}

/* 치수 정면도 · 모듈 치수도 카드 (elevation.js) */
.elev-box { border: 0.4pt solid #000; padding: 3pt; margin: 2pt 0 6pt; break-inside: avoid; page-break-inside: avoid; font-size: 8.5pt; }
.elev-box svg.elevation { display: block; width: 100%; height: auto; max-height: 120mm; }
.elev-box .ph { height: 20mm; display: flex; align-items: center; justify-content: center; color: #888; }
.elev-cap { margin-top: 2pt; }
.module-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
.module-card { border: 0.4pt solid #000; padding: 2mm; font-size: 8pt; break-inside: avoid; page-break-inside: avoid; }
.module-card svg.module-drawing { display: block; width: 100%; height: auto; max-height: 55mm; }
.module-card .mc-head, .module-card .mc-foot { margin: 1pt 0; }

/* 조립 순서 체크 */
table.check td.box { text-align: center; font-size: 12pt; width: 8%; }
table.check td.blank { width: 12%; }
table.check td.na { text-align: center; color: #666; background: repeating-linear-gradient(45deg, #fff 0 2pt, #ddd 2pt 3pt); }

/* 부재 라벨 부록 — A4 3×8 = 24장 (라벨 63×32mm) */
.label-grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-auto-rows: 32mm; gap: 1mm; }
.label {
  border: 0.4pt dashed #888; padding: 1.5mm; display: flex; gap: 1.5mm; align-items: center;
  overflow: hidden; break-inside: avoid; page-break-inside: avoid;
}
.label svg.qr { width: 24mm; height: 24mm; flex: 0 0 24mm; }
.label .lt { font-size: 7.5pt; line-height: 1.3; min-width: 0; flex: 1 1 auto; }
.label .lt .no { display: flex; align-items: baseline; gap: 1.5mm; min-width: 0; }
.label .lt .no b { font-size: 16pt; line-height: 1.05; font-variant-numeric: tabular-nums; }
.label .lt .no .mod { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.label .lt .dim { font-size: 10pt; font-weight: 700; }
.label .lt .edge-line .edge-svg { width: 14pt; height: 9pt; }

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

/**
 * 재단 원장 묶음 단추 — [그림] [표] [둘 다] 는 그 묶음의 data-view, [이 묶음만 인쇄] 는 그 묶음만 남기고 인쇄 (끝나면 되돌린다).
 * 문서는 document.write · blob 으로 열려 인라인 스크립트가 돈다 (documentShell 에 CSP 없음).
 */
export const CUT_VIEW_SCRIPT = `
<script>
(function () {
  document.addEventListener('click', function (e) {
    var t = e.target;
    var v = t && t.closest && t.closest('[data-cut-view]');
    if (v) {
      var g = v.closest('.cut-group');
      g.setAttribute('data-view', v.getAttribute('data-cut-view'));
      g.querySelectorAll('[data-cut-view]').forEach(function (b) { b.setAttribute('aria-pressed', b === v ? 'true' : 'false'); });
      return;
    }
    var p = t && t.closest && t.closest('[data-cut-print]');
    if (p) {
      var target = p.closest('.cut-group');
      target.classList.add('print-target');
      document.body.classList.add('print-group');
      var done = function () { target.classList.remove('print-target'); document.body.classList.remove('print-group'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      window.print();
    }
  });
})();
</script>
`;

/** 인쇄 버튼 — 화면에서만 보인다. */
export const PRINT_TOOLBAR = `
<div class="toolbar no-print">
  <span>Ctrl+P → 대상을 "PDF로 저장"으로 선택하면 PDF 파일로 받을 수 있습니다.</span>
  <button type="button" onclick="window.print()">인쇄 / PDF로 저장</button>
</div>
`;
