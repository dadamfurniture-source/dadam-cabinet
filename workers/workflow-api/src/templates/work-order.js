/**
 * 작업지시서 — 공장 A4 인쇄용.
 *
 * 서버 렌더인 이유:
 *   1) 공장은 계정이 없다. 링크 하나로 열려야 실무가 굴러간다.
 *   2) 인쇄물은 동결된 문서다. 프론트 리팩터나 ?v= 캐시 스큐가 과거
 *      작업지시서의 내용을 바꾸면 안 된다.
 *
 * ★ 금액을 표시하지 않는다. 고객확인서와의 결정적 차이.
 *
 * v2 (B5, 계획 §4.6 · §5 B5) — 같은 work_order 문서에 섹션을 더했다:
 *   ① 표지: 기존 + 품목별 정면 렌더 + 색 스와치 범례
 *   ② 모듈별 키팅 시트 (partId · 치수 · 마감 칩 · 엣지 면 도식 · 그 모듈의 철물)
 *   ③ 시트별 재단표 (배치 SVG 축소판 + 부재 표 + 잔재)
 *   ④ 철물·체결구 (기존)
 *   ⑤ (꾸러미 개편에서 ⑩ 로 옮김 — 보링 공정이 없고 컵 보링은 도어 외주처가 한다)
 *   ⑥ 조립 순서 체크
 *   ⑦ 이전 rev 와의 차이
 *   ⑧ 부재 라벨 부록 (partId QR)
 *
 * 꾸러미 (계획 work-order-stage.plan.md §4.3) — 같은 동결 문서를 사람별로 골라 찍는다 (`?pack=`):
 *   cut       재단·엣지 지시서 — ③ 에 엣지 변 표시·엣지 합계를 합쳤다. 사내 재단(본체·뒷판)만.
 *             엣지 붙일 변 표시는 재단 기사가 자르면서 한다 (2026-10-13 사장님).
 *   cut-vendor 같은 재단·엣지를 외주처(일성합판)로 보낼 때 — 고객 이름·설계 제목·특기사항·정면도·시간 없음
 *   assembly  조립 지시서 — 모듈 명세 · ② 키팅 · ④ 철물 · ⑥ 조립 체크 · ⑦ 차이
 *   door      ⑩ 도어재 발주서 — 도어 그룹(도어·몰딩·걸레받이·목찬넬·마감) 부재 + 경첩 컵 위치. 고객 이름 없음
 *   labels    ⑧ 라벨 — 사내 부재 먼저, 도어재는 뒤 (입고 시 부착)
 *   all       전부 (사무실 보관)
 * 불변: 사내 재단 부재 + 도어재 부재 = 자재 행 전체 (partClassOf 하나로 가른다).
 * 자료는 발행 시 `render_payload` 에 동결된 것만 읽는다 (work-order-data.js). v1 문서(그 필드가 없는
 * 것)도 열려야 하므로 모든 섹션은 자료가 없으면 안내 문구로 내려앉는다.
 */

import { esc, num, ymd, tr, thead, documentShell } from './html.js';
import { countertopSheets } from './countertop-order.js';
import { hasCountertop } from '../countertop.js';
import { PRINT_CSS, PRINT_TOOLBAR } from './print-css.js';
import { qrSvg } from '../util/qr.js';
import {
  materialsOf,
  hardwareOf,
  partIdOf,
  distinctFinishCodes,
  normalizeHex,
  parseBoringNote,
  doorHeightFromBoring,
  doorRowsForHinge,
  moduleNameOf,
  partClassOf,
  isDoorClass,
  pieceBaseId,
} from '../work-order-data.js';
import { laborEstimate, fmtMinutes } from '../labor-standards.js';
import { elevationSvg, elevationModel, moduleDrawingSvg } from './elevation.js';
import { isCornerItem, isoSvg, runLengths } from './isometric.js';

const CATEGORY_NAMES = {
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  fridge: '냉장고장',
  shoerack: '신발장',
  vanity: '화장대',
  storage: '수납장',
  warehouse: '창고장',
  tvcabinet: 'TV장',
  door: '도어교체',
  custom: '비규격장',
};

const MODULE_POS = { upper: '상부', lower: '하부', wardrobe: '붙박이' };

export const LABELS_PER_SHEET = 24; // 3 × 8

function itemLabel(item, index) {
  return (
    item.labelName ||
    CATEGORY_NAMES[item.categoryId || item.category] ||
    item.name ||
    `품목 ${index + 1}`
  );
}

/** 문서·스냅샷에서 섹션들이 공통으로 쓰는 값. v1 문서는 v2 필드가 없다 — 전부 폴백을 둔다. */
function buildContext(doc, snapshot, renderUrls) {
  const rp = (doc && doc.render_payload) || {};
  const design = (snapshot && snapshot.design_payload) || {};
  const items = Array.isArray(design.items) ? design.items : [];
  const materials = materialsOf(snapshot);
  const hardware = hardwareOf(snapshot);

  const cutPlan = rp.cut_plan !== undefined
    ? rp.cut_plan
    : (snapshot && snapshot.cut_plan_payload) || null;

  let swatches = Array.isArray(rp.swatches) ? rp.swatches : null;
  if (!swatches) {
    // v1 문서: 카탈로그 조회가 없었다 — 코드만 범례로
    swatches = distinctFinishCodes(materials).map((code) => ({
      code, known: false, color_name: code, color_hex: null, vendor_code: null, series: null, finish: null, tone: null,
    }));
  }

  return {
    doc,
    snapshot,
    items,
    materials,
    hardware,
    renders: Array.isArray(rp.renders) ? rp.renders : null,
    renderUrls: renderUrls instanceof Map ? renderUrls : new Map(Object.entries(renderUrls || {})),
    swatches,
    swatchByCode: new Map(swatches.map((s) => [s.code, s])),
    cutPlan: cutPlan && typeof cutPlan === 'object' && Array.isArray(cutPlan.sheets) ? cutPlan : null,
    prevRev: rp.prev_rev, // undefined = v1 문서(비교 안 함), null = 첫 발행
    isV2: Number(rp.work_order_version) >= 2,
    labor: rp.labor && typeof rp.labor === 'object' ? rp.labor : null, // 없으면(옛 문서) 예상 시간 생략
    rowById: new Map(materials.map((m, i) => [partIdOf(m, i), { row: m, index: i }])),
  };
}

// ── 꾸러미 ───────────────────────────────────────────────────────

export const WORK_ORDER_PACKS = {
  all: { title: '작업지시서', who: '사무실 보관 — 전체' },
  cut: { title: '재단·엣지 지시서', who: '재단 기사 — 자르면서 엣지 붙일 변 표시' },
  // 2026-10-13 사장님 Q2: 재단·엣지를 가끔 외주(일성합판)로 보낸다 — 같은 내용, 고객 이름·설계 제목·특기사항·시간 없음
  'cut-vendor': { title: '재단·엣지 의뢰서', who: '재단·엣지 외주처' },
  assembly: { title: '조립 지시서', who: '조립 기사 — 통 조립 · 도어 달기 · 서랍 · 검수·포장' },
  door: { title: '도어재 발주서', who: '도어 외주처' },
  // 2026-10-18 사장님: 인조대리석 · 엔지니어드 스톤 · 세라믹 상판 발주 요청서 — 고객 이름·금액 없음 (보관함 §2.2)
  top: { title: '상판 발주 요청서', who: '상판 업체' },
  labels: { title: '부재 라벨', who: '재단 기사 — 재단 직후 부착 (도어재는 입고 시)' },
};

/** `?pack=` 값 → 키. 비면 'all', 모르는 값이면 null. */
export function normalizePack(v) {
  if (v === undefined || v === null || v === '') return 'all';
  const k = String(v).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(WORK_ORDER_PACKS, k) ? k : null;
}

function qtyOf(m) {
  return Math.max(0, Math.round(Number(m && m.qty) || 0));
}

function isDoorRow(m) {
  return m.slot ? m.slot === 'door' : /^도어/.test(String(m.part || ''));
}

function isDrawerFrontRow(m) {
  return m.slot ? m.slot === 'drawerFront' : /서랍.*(전면|도어)/.test(String(m.part || ''));
}

/** 꾸러미 머리 숫자의 재료 — 사내/도어재 시트·행, 통·서랍·도어 수. (순수, 시험용으로 노출) */
export function workCounts(ctx) {
  const sheets = ctx.cutPlan ? ctx.cutPlan.sheets : null;
  const inHouseSheets = sheets ? sheets.filter((s) => s.partClass !== '도어') : null;
  const doorSheets = sheets ? sheets.filter((s) => s.partClass === '도어') : null;
  const inHouseRows = ctx.materials.filter((m) => !isDoorClass(m));
  const doorRows = ctx.materials.filter((m) => isDoorClass(m));
  return {
    inHouseSheets,
    doorSheets,
    bodySheets: inHouseSheets ? inHouseSheets.filter((s) => s.partClass === '본체').length : null,
    edgeFaces: inHouseRows.reduce((s, m) => { const e = rowEdges(m); return s + ['L', 'R', 'T', 'B'].filter((k) => e[k]).length * qtyOf(m); }, 0),
    inHouseRows,
    doorRows,
    cabinets: ctx.items.reduce((s, it) => s + (Array.isArray(it.modules) ? it.modules.length : 0), 0),
    drawers: ctx.materials.filter(isDrawerFrontRow).reduce((s, m) => s + qtyOf(m), 0),
    doors: ctx.materials.filter(isDoorRow).reduce((s, m) => s + qtyOf(m), 0),
  };
}

/**
 * 외주 발주 내역의 수량 요약 (work-reports-archive.plan.md §2.1) — 종이에 찍힌 숫자와 같은 출처.
 * door: 도어재 부재 장 · 원장 · 도어 짝 / cut-vendor: 사내 원판 · 엣지 m · 부재 장
 */
export function outsourceCounts(doc, snapshot, pack) {
  const c = workCounts(buildContext(doc, snapshot, new Map()));
  const parts = (rows) => rows.reduce((s, m) => s + qtyOf(m), 0);
  if (pack === 'door') {
    return { doorParts: parts(c.doorRows), doorSheets: c.doorSheets ? c.doorSheets.length : null, doors: c.doors, drawers: c.drawers };
  }
  if (pack === 'cut-vendor') {
    const mm = edgeTotals(c.inHouseRows).reduce((s, g) => s + g.mm, 0);
    return { sheets: c.inHouseSheets ? c.inHouseSheets.length : null, edgeM: Math.round(mm / 100) / 10, parts: parts(c.inHouseRows) };
  }
  return {};
}

function laborOf(ctx, counts) {
  return laborEstimate(ctx.labor, {
    cutSheets: counts.inHouseSheets ? counts.inHouseSheets.length : 0,
    bodySheets: counts.bodySheets || 0,
    edgeFaces: counts.edgeFaces || 0,
    cabinets: counts.cabinets,
    drawers: counts.drawers,
    doors: counts.doors,
  });
}

// ── 공통 조각 ────────────────────────────────────────────────────

/** 마감 칩 + 코드. hex 는 저장값이라도 다시 검증해서 style 에 넣는다. */
function swatchChip(ctx, code) {
  if (!code) return '<span class="muted">-</span>';
  const s = ctx.swatchByCode.get(code);
  const hex = normalizeHex(s && s.color_hex);
  const chip = hex
    ? `<span class="chip" style="background:${hex}"></span>`
    : '<span class="chip none"></span>';
  return `${chip}<span class="mono">${esc(code)}</span>`;
}

/**
 * 옛 행(B1 이전, `edges` 없음)의 문자열 edge → 변. bom-protocol.md §7-2 와 같은 규칙:
 * 세로가 길면(h > w) 긴 변은 L/R, 아니면 T/B.
 */
export function edgesFromLegacy(edge, w, h) {
  const tall = Number(h) > Number(w);
  const long2 = tall ? { L: true, R: true } : { T: true, B: true };
  const short2 = tall ? { T: true, B: true } : { L: true, R: true };
  const long1 = tall ? { L: true } : { T: true };
  const none = { L: false, R: false, T: false, B: false };
  const s = String(edge || '').trim();
  if (s === '4면') return { L: true, R: true, T: true, B: true };
  if (s === '3면') return { ...none, ...long1, ...short2 };
  if (s === '2면(장)') return { ...none, ...long2 };
  if (s === '2면(가로)') return { ...none, T: true, B: true };
  if (s === '1면(전)' || s === '1면(장)') return { ...none, ...long1 };
  return none;
}

/** 엣지 면 도식 — 굵은 변이 밴딩. */
export function edgeSvg(edges) {
  const e = edges || {};
  const line = (x1, y1, x2, y2, on) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${on ? 2.6 : 0.5}"${on ? '' : ' stroke-dasharray="1.2 1.2"'}/>`;
  return (
    '<svg class="edge-svg" viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg">' +
    line(2, 2, 22, 2, e.T) + line(2, 14, 22, 14, e.B) + line(2, 2, 2, 14, e.L) + line(22, 2, 22, 14, e.R) +
    '</svg>'
  );
}

function edgeCell(m) {
  const edges = m.edges && typeof m.edges === 'object' ? m.edges : edgesFromLegacy(m.edge, m.w, m.h);
  const bits = [];
  if (m.edgeT) bits.push(`${esc(m.edgeT)}T`);
  if (m.edge) bits.push(esc(m.edge));
  return `${edgeSvg(edges)}<span class="muted">${bits.join(' ')}</span>`;
}

function dims3(w, h, d) {
  return `${num(w)} × ${num(h)} × ${num(d)}`;
}

// ── 엣지 (재단·엣지 지시서 · 도어재 발주서 · 라벨 공용) ──────────

function rowEdges(m) {
  return m.edges && typeof m.edges === 'object' ? m.edges : edgesFromLegacy(m.edge, m.w, m.h);
}

/** 장당 엣지 길이 mm — B1 의 edgeLen, 없으면 변에서 (L/R → h, T/B → w, bom-protocol §7-2). */
export function edgeLenOf(m) {
  if (m.edgeLen !== undefined && m.edgeLen !== null && m.edgeLen !== '' && Number.isFinite(Number(m.edgeLen))) {
    return Number(m.edgeLen);
  }
  const e = rowEdges(m);
  const w = Number(m.w) || 0;
  const h = Number(m.h) || 0;
  return (e.L ? h : 0) + (e.R ? h : 0) + (e.T ? w : 0) + (e.B ? w : 0);
}

/**
 * 붙일 변을 길이로 — "720×1 · 550×2". 원판 위에서 돌려 놓아도 길이는 그대로라
 * 재단 기사가 부재를 손에 들고 바로 맞춰 볼 수 있다.
 */
export function edgeSidesText(m) {
  const e = rowEdges(m);
  const nh = (e.L ? 1 : 0) + (e.R ? 1 : 0);
  const nw = (e.T ? 1 : 0) + (e.B ? 1 : 0);
  const out = [];
  if (nh) out.push(`${num(m.h)}×${nh}`);
  if (nw) out.push(`${num(m.w)}×${nw}`);
  return out.join(' · ') || '없음';
}

/** 엣지 합계 — 두께 × 엣지 코드별 길이·부재 수 (붙일 변이 있는 행만). 두께 큰 것 먼저. */
export function edgeTotals(rows) {
  const map = new Map();
  for (const m of rows || []) {
    const per = edgeLenOf(m);
    const qty = qtyOf(m);
    if (per <= 0 || qty <= 0) continue;
    const t = Number(m.edgeT) || 0.6;
    const code = m.edgeCode || '';
    const key = `${t}|${code}`;
    if (!map.has(key)) map.set(key, { edgeT: t, code, mm: 0, parts: 0 });
    const g = map.get(key);
    g.mm += per * qty;
    g.parts += qty;
  }
  return [...map.values()].sort((a, b) => b.edgeT - a.edgeT || String(a.code).localeCompare(String(b.code)));
}

function edgeText(m) {
  const sides = edgeSidesText(m);
  if (sides === '없음') return '<span class="muted">없음</span>';
  return `${fmtEdgeT(m.edgeT)} · ${esc(sides)}${m.edgeCode ? ` · <span class="mono">${esc(m.edgeCode)}</span>` : ''}`;
}

/** 엣지 두께 표기 — 0.6 / 1.0 (값이 없으면 몸통 기본 0.6). */
function fmtEdgeT(t) {
  return (Number(t) || 0.6).toFixed(1);
}

function fmtMeters(mm) {
  const v = (Number(mm) || 0) / 1000;
  return `${v.toFixed(1)} m`;
}

// ── ① 표지 ───────────────────────────────────────────────────────

function renderBoxes(ctx) {
  const boxes = ctx.items.map((item, i) => {
    const r = ctx.renders ? ctx.renders.find((x) => x && x.item_index === i) : null;
    const url = r && r.path ? ctx.renderUrls.get(r.path) : null;
    const label = esc(itemLabel(item, i));
    if (url) {
      return `<div class="render-box"><img src="${esc(url)}" alt="${label} 정면 렌더">` +
        `<div>${label} · 정면${r.width && r.height ? ` ${num(r.width)}×${num(r.height)}px` : ''}${r.created_at ? ` · ${esc(ymd(r.created_at))}` : ''}</div></div>`;
    }
    const why = r && r.path ? '렌더를 불러올 수 없음' : '정면 렌더 없음';
    return `<div class="render-box"><div class="ph">${why}</div><div>${label}</div></div>`;
  });
  return `<div class="render-grid">${boxes.join('')}</div>`;
}

function swatchLegend(ctx) {
  if (ctx.swatches.length === 0) return '<div class="muted">마감 코드가 지정된 부재 없음 (기본 자재)</div>';
  const rows = ctx.swatches
    .map((s) =>
      tr([
        swatchChip(ctx, s.code),
        esc(s.color_name || s.code),
        esc([s.series, s.finish, s.tone].filter(Boolean).join(' · ') || (s.known ? '' : '카탈로그에 없음')),
        esc(s.vendor_code || '-'),
      ]),
    )
    .join('');
  return `<table class="compact">${thead(['색 / 코드', '이름', '시리즈 · 소재 · 톤', '발주 코드'])}<tbody>${rows}</tbody></table>`;
}

/** 표지 — 문서 정보 + 정면 렌더 + 스와치 범례 + 품목 요약 + 서명란. */
function coverSheet(ctx) {
  const { doc, snapshot, items } = ctx;
  const totals = (doc && doc.totals) || {};

  const summaryRows = items
    .map((item, i) =>
      tr(
        [
          esc(itemLabel(item, i)),
          esc(CATEGORY_NAMES[item.categoryId || item.category] || item.categoryId || '-'),
          dims3(item.w, item.h, item.d),
          num(Array.isArray(item.modules) ? item.modules.length : 0),
        ],
        ['', '', 'num', 'num'],
      ),
    )
    .join('');

  const sheetCount = ctx.cutPlan ? ctx.cutPlan.sheets.length : totals.sheet_count;
  const labelCount = totals.label_count ?? ctx.materials.reduce((s, m) => s + (Number(m.qty) || 0), 0);
  const counts = workCounts(ctx);
  const labor = laborOf(ctx, counts);
  const laborRows = labor
    ? `<dt>예상 시간</dt><dd>재단 ${fmtMinutes(labor.cutMin)} · 엣지 ${fmtMinutes(labor.edgeMin)} · 조립 ${fmtMinutes(labor.assemblyMin)}</dd>`
    : '';
  const sheetSplit = counts.inHouseSheets
    ? ` <span class="muted">(사내 ${num(counts.inHouseSheets.length)} · 도어재 ${num(counts.doorSheets.length)})</span>`
    : '';

  return `
<div class="sheet">
  <div class="doc-header">
    <div>
      <h1>작 업 지 시 서</h1>
      <div>${esc(doc.title)}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(doc.doc_no)}</div>
      <div>Rev. ${esc(doc.rev)}</div>
      <div>발행 ${esc(ymd(doc.created_at))}</div>
    </div>
  </div>

  <div class="section-title">기본 정보</div>
  <dl class="kv">
    <dt>고객</dt><dd>${esc(doc.customer_name || doc.customer_name_masked || '-')}</dd>
    <dt>설계 rev</dt><dd>${esc(snapshot.rev)}</dd>
    <dt>품목 수</dt><dd>${num(snapshot.item_count)}</dd>
    <dt>모듈 수</dt><dd>${num(snapshot.module_count)}</dd>
    <dt>부재 수</dt><dd>${num(snapshot.panel_count)}</dd>
    <dt>재단 시트</dt><dd>${sheetCount === null || sheetCount === undefined ? '배치 없음' : `${num(sheetCount)}장`}${sheetSplit}</dd>
    <dt>라벨 수</dt><dd>${num(labelCount)}</dd>
    ${laborRows}
    <dt>설계 해시</dt><dd class="doc-no">${esc(String(snapshot.content_hash).slice(0, 12))}</dd>
  </dl>

  <div class="section-title">정면도</div>
  ${elevationBlock(ctx)}

  <div class="section-title">정면 렌더 <span class="muted">참고</span></div>
  ${renderBoxes(ctx)}

  <div class="section-title">색 스와치 범례</div>
  ${swatchLegend(ctx)}

  <div class="section-title">품목 요약</div>
  <table>
    ${thead(['품목', '분류', 'W × H × D (mm)', '모듈'], ['', '', 'num', 'num'])}
    <tbody>${summaryRows || tr(['품목 없음', '', '', ''])}</tbody>
  </table>

  <div class="section-title">특기사항</div>
  <div class="note" style="min-height:18mm; border:0.4pt solid #999; padding:6pt;">
    ${esc(doc.render_payload?.instructions || '')}
  </div>

  <div class="sign-box no-break">
    <div>제작 담당<br><br></div>
    <div>검수<br><br></div>
    <div>출고<br><br></div>
  </div>
</div>`;
}

/** 아이템별 모듈 명세 (v1 그대로). */
function moduleSheets(ctx) {
  const { items } = ctx;
  if (items.length === 0) return '';

  const rows = items
    .flatMap((item, i) => {
      const label = itemLabel(item, i);
      const modules = Array.isArray(item.modules) ? item.modules : [];
      return modules.map((m, mi) =>
        tr(
          [
            esc(label),
            `<b>${num(mi + 1)}</b>`,
            esc(MODULE_POS[m.pos] || m.pos || '-'),
            esc(m.name || m.type || '-'),
            dims3(m.w, m.h, m.d),
            num(m.doorCount || 0),
            esc(
              [
                m.isDrawer ? '서랍' : '',
                m.isEL ? 'EL' : '',
                m.isFixed ? '고정' : '',
                m.isDerived ? '멍장파생' : '',
                m.line || m.orientation ? `라인:${m.line || m.orientation}` : '',
                m.doorFinish ? `마감:${m.doorFinish}` : '',
                m.doorColor ? `색:${m.doorColor}` : '',
              ]
                .filter(Boolean)
                .join(' · '),
            ),
          ],
          ['', 'num', '', '', 'num', 'num', ''],
        ),
      );
    })
    .join('');

  return `
<div class="sheet">
  <div class="section-title">모듈 명세 <span class="muted">번호 = 정면도 동그라미 번호</span></div>
  <table>
    ${thead(['품목', '번호', '위치', '모듈', 'W × H × D (mm)', '도어', '비고'], ['', 'num', '', '', 'num', 'num', ''])}
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

// ── 정면도 · ⑪ 모듈 치수도 (elevation.js) ─────────────────────────

/** 품목마다 치수 정면도 + 안내(위치 정보 없음 등). 빨간 검증 경고는 그림 안에 있다. */
function elevationBlock(ctx) {
  if (ctx.items.length === 0) return '<div class="muted">품목 없음</div>';
  return ctx.items
    .map((item, i) => {
      const label = esc(itemLabel(item, i));
      // 사장님 결정 Q4: 벽이 둘 이상인 코너 품목은 아이소메트릭 (isometric.js)
      if (isCornerItem(item)) {
        const runs = runLengths(item)
          .map((r) => `${num(r.nos[0])}~${num(r.nos[r.nos.length - 1])}번 줄 ${num(r.length)}`)
          .join(' · ');
        return `<div class="elev-box">${isoSvg(item)}<div class="elev-cap">${label} · 아이소메트릭 (코너 · mm) · 번호 = 모듈 명세 번호${runs ? ` · <b>${esc(runs)}</b>` : ''}</div></div>`;
      }
      const svg = elevationSvg(item);
      if (!svg) return `<div class="elev-box"><div class="ph">모듈 없음</div><div>${label}</div></div>`;
      const infos = elevationModel(item).notes.filter((x) => x.level !== 'error');
      return `<div class="elev-box">${svg}<div class="elev-cap">${label} · 정면도 (mm)${infos.map((x) => ` · <span class="muted">${esc(x.text)}</span>`).join('')}</div></div>`;
    })
    .join('');
}

/** ⑪ 모듈 치수도 — 모듈마다 정면(W × 몸통 H) + 측면(D). 번호는 정면도·⑥ 과 같다. */
function moduleDrawingsSheet(ctx) {
  const cards = ctx.items.flatMap((item, i) => {
    const label = itemLabel(item, i);
    const modules = Array.isArray(item.modules) ? item.modules : [];
    const frame = {
      w: Math.max(0, ...modules.map((m) => (Number(m.w) || 0) + (Number(m.d) || 0))),
      h: Math.max(0, ...modules.map((m) => Number(m.h) || 0)),
    };
    return modules.map((m, mi) => {
      const svg = moduleDrawingSvg(m, frame);
      const bits = [
        m.isOpen ? '오픈' : Number(m.doorCount) > 0 ? `도어 ${num(m.doorCount)}` : '',
        m.isDrawer ? `서랍 ${num(Number(m.drawerCount) || 1)}단` : '',
        Number(m.shelfCount) > 0 ? `선반 ${num(m.shelfCount)}` : '',
      ].filter(Boolean);
      return `
    <div class="module-card">
      <div class="mc-head"><b>${num(mi + 1)}</b> ${esc(label)} · ${esc(MODULE_POS[m.pos] || m.pos || '-')} ${esc(m.name || m.type || '-')}</div>
      ${svg || '<div class="ph">치수 없음</div>'}
      <div class="mc-foot">몸통 ${dims3(m.w, m.h, m.d)}${bits.length ? ` · ${esc(bits.join(' · '))}` : ''}</div>
    </div>`;
    });
  });
  if (cards.length === 0) return '';
  return `
<div class="sheet">
  <div class="section-title">⑪ 모듈 치수도 <span class="muted">몸통 기준 mm — 다리·상판·몰딩은 정면도</span></div>
  <div class="module-grid">${cards.join('')}</div>
</div>`;
}

// ── ② 모듈별 키팅 ────────────────────────────────────────────────

/** 자재 행을 품목 → 모듈 순서(첫 등장 순)로 묶는다. */
export function groupByItemModule(materials) {
  const items = new Map();
  materials.forEach((m, index) => {
    const itemKey = m.itemLabel || '';
    if (!items.has(itemKey)) items.set(itemKey, { itemLabel: itemKey, modules: new Map() });
    const modules = items.get(itemKey).modules;
    // B4: moduleKey 가 있으면 그것으로 묶는다 — 이름이 같은 모듈(하부장 여러 칸)이 한 묶음으로 섞이지 않게
    const modKey = m.moduleKey ? `key:${m.moduleKey}` : `name:${m.module || ''}`;
    if (!modules.has(modKey)) modules.set(modKey, { module: m.module || '', moduleKey: m.moduleKey || null, rows: [] });
    modules.get(modKey).rows.push({ row: m, index });
  });
  return [...items.values()].map((it) => ({ itemLabel: it.itemLabel, modules: [...it.modules.values()] }));
}

/** 철물 행이 어느 모듈 것인지 — 경첩 비고의 모듈명, 또는 행의 module 필드. 못 찾으면 null. */
function hardwareModuleName(h) {
  if (h.module) return moduleNameOf(h.module);
  const parsed = parseBoringNote(h);
  if (parsed && parsed.moduleName) return parsed.moduleName;
  return null;
}

function partsTable(ctx, rows) {
  const body = rows
    .map(({ row: m, index }) =>
      tr(
        [
          `<span class="mono">${esc(partIdOf(m, index))}</span>`,
          esc(m.part || ''),
          `${esc(m.material || '')} ${num(m.thickness)}T`,
          `${num(m.w)} × ${num(m.h)}`,
          num(m.qty),
          swatchChip(ctx, m.finishCode),
          edgeCell(m),
          esc(m.note || ''),
        ],
        ['', '', '', 'num', 'num', '', '', ''],
      ),
    )
    .join('');
  return `<table class="compact">${thead(
    ['partId', '부품', '자재', '가로 × 세로', '수량', '마감', '엣지', '비고'],
    ['', '', '', 'num', 'num', '', '', ''],
  )}<tbody>${body}</tbody></table>`;
}

function hardwareRowsTable(rows) {
  if (rows.length === 0) return '';
  const body = rows
    .map((h) => tr([esc(h.category || ''), esc(h.item || ''), esc(h.spec || ''), num(h.qty), esc(h.unit || ''), esc(h.note || '')], ['', '', '', 'num', '', '']))
    .join('');
  return `<table class="compact">${thead(['철물', '품목', '규격', '수량', '단위', '비고'], ['', '', '', 'num', '', ''])}<tbody>${body}</tbody></table>`;
}

function kittingSheets(ctx) {
  const groups = groupByItemModule(ctx.materials);
  if (groups.length === 0) {
    return `<div class="sheet"><div class="section-title">② 모듈별 키팅</div><div class="muted">자재 행 없음</div></div>`;
  }

  return groups
    .map((g) => {
      const itemHardware = ctx.hardware.filter((h) => !h.itemLabel || !g.itemLabel || h.itemLabel === g.itemLabel);
      const used = new Set();
      const blocks = g.modules.map((mod) => {
        const name = moduleNameOf(mod.module);
        const hw = itemHardware.filter((h) => {
          if (used.has(h)) return false;
          // B4: 키가 양쪽에 있으면 키로만 — 같은 이름의 다른 모듈로 새지 않는다
          if (h.moduleKey && mod.moduleKey) {
            if (h.moduleKey !== mod.moduleKey) return false;
          } else {
            const hn = hardwareModuleName(h);
            if (hn === null || hn !== name || name === '') return false;
          }
          used.add(h);
          return true;
        });
        const qtySum = mod.rows.reduce((s, { row }) => s + (Number(row.qty) || 0), 0);
        return `
  <div class="kit-module">
    <div class="sub-title">${esc(mod.module || '(모듈 미지정)')} <span class="muted">부재 ${num(mod.rows.length)}종 · ${num(qtySum)}장</span></div>
    ${partsTable(ctx, mod.rows)}
    ${hardwareRowsTable(hw)}
  </div>`;
      });
      const rest = itemHardware.filter((h) => !used.has(h));
      const restBlock = rest.length
        ? `<div class="kit-module"><div class="sub-title">기타 철물 <span class="muted">모듈 미지정</span></div>${hardwareRowsTable(rest)}</div>`
        : '';
      return `
<div class="sheet">
  <div class="section-title">② 모듈별 키팅 — ${esc(g.itemLabel || '품목')}</div>
  ${blocks.join('')}
  ${restBlock}
</div>`;
    })
    .join('');
}

// ── ③ 재단·엣지 지시서 (사내 재단 — 본체·뒷판) ───────────────────

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '-';
}

/**
 * 부재 기준 변(L/R = 세로 h 변, T/B = 가로 w 변) → 원판 위에 그려진 변.
 * 회전 조각은 발자국이 h×w 다 — 시계 방향 90° 로 본다: 부재 L → 위, T → 오른쪽, R → 아래, B → 왼쪽.
 * 길이가 맞는 변끼리 옮기는 것이라 어느 쪽으로 돌렸는지와 무관하게 "어느 길이의 변에 몇 개" 는 같다.
 */
export function drawnEdges(edges, rot) {
  const e = edges || {};
  if (!rot) return { L: !!e.L, R: !!e.R, T: !!e.T, B: !!e.B };
  return { T: !!e.L, R: !!e.T, B: !!e.R, L: !!e.B };
}

/**
 * 배치 축소판. 트림 영역은 회색, 조각은 흰 사각형 + 부품명 (+ partId, 자리가 있을 때).
 * opts.edgeOf(piece) → { edges, edgeT } 를 주면 붙일 변을 안쪽에 굵게 그린다 —
 * 0.6 은 굵은 실선, 1.0 은 이중선 (흑백 인쇄에서도 구분되게 선 모양으로).
 * opts.labelNoOf(piece) → 번호를 주면 조각 왼쪽 위에 라벨 번호를 적는다.
 */
export function sheetSvg(sheet, opts = {}) {
  const W = Number(sheet.size && sheet.size.w) || 0;
  const H = Number(sheet.size && sheet.size.h) || 0;
  if (W <= 0 || H <= 0) return '';
  const trim = Number.isFinite(Number(sheet.trim)) ? Number(sheet.trim) : 10;
  const parts = Array.isArray(sheet.parts) ? sheet.parts : [];
  const strokeW = Math.max(2, Math.round(W / 400));
  const ew = Math.max(12, Math.round(W / 80)); // 엣지 표시 굵기
  const edgeOf = typeof opts.edgeOf === 'function' ? opts.edgeOf : null;
  const labelNoOf = typeof opts.labelNoOf === 'function' ? opts.labelNoOf : null;

  const edgeLines = (x, y, pw, ph, sides, thick) => {
    const seg = (o) => {
      const out = [];
      if (sides.T) out.push([x, y + o, x + pw, y + o]);
      if (sides.B) out.push([x, y + ph - o, x + pw, y + ph - o]);
      if (sides.L) out.push([x + o, y, x + o, y + ph]);
      if (sides.R) out.push([x + pw - o, y, x + pw - o, y + ph]);
      return out;
    };
    const lines = thick
      ? [...seg(ew * 0.3), ...seg(ew * 1.1)].map((l) => [...l, ew * 0.45])
      : seg(ew / 2).map((l) => [...l, ew]);
    return lines
      .map(([x1, y1, x2, y2, sw]) => `<line class="edge-mark" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${sw}"/>`)
      .join('');
  };

  const rects = parts
    .map((p) => {
      const pw = Number(p.rot ? p.h : p.w) || 0;
      const ph = Number(p.rot ? p.w : p.h) || 0;
      const x = Number(p.x) || 0;
      const y = Number(p.y) || 0;
      if (pw <= 0 || ph <= 0) return '';
      const fs = Math.max(26, Math.min(56, Math.round(Math.min(pw, ph) * 0.32)));
      const name = String(p.part || '');
      const id = String(p.partId || '');
      const cx = x + pw / 2;
      const lines = [];
      if (name && pw >= name.length * fs * 0.95 && ph >= fs * 1.2) lines.push(name);
      if (id && pw >= id.length * fs * 0.58 && ph >= fs * (lines.length ? 2.6 : 1.2)) lines.push(id);
      const text = lines
        .map((t, i) => {
          const y0 = y + ph / 2 + (i - (lines.length - 1) / 2) * fs * 1.15 + fs * 0.35;
          return `<text x="${cx}" y="${y0}" font-size="${fs}" text-anchor="middle" font-family="Consolas, monospace">${esc(t)}</text>`;
        })
        .join('');
      const info = edgeOf ? edgeOf(p) : null;
      const marks = info ? edgeLines(x, y, pw, ph, drawnEdges(info.edges, p.rot), Number(info.edgeT) >= 1) : '';
      const no = labelNoOf ? labelNoOf(p) : null;
      const noText = no && pw >= fs * 2.2 && ph >= fs * 1.6
        ? `<text x="${x + ew * 1.8}" y="${y + ew * 1.4 + fs * 0.8}" font-size="${fs}" font-weight="700" font-family="Consolas, monospace">${num(no)}</text>`
        : '';
      return `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" fill="#fff" stroke="#000" stroke-width="${strokeW}"/>${marks}${text}${noText}${p.rot ? `<text x="${x + pw - fs * 0.9}" y="${y + fs}" font-size="${fs}" fill="#444">↻</text>` : ''}`;
    })
    .join('');

  return (
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#d9d9d9"/>` +
    `<rect x="${trim}" y="${trim}" width="${Math.max(0, W - trim * 2)}" height="${Math.max(0, H - trim * 2)}" fill="#f3f3f3"/>` +
    rects +
    '</svg>'
  );
}

/** 조각 → 자재 행 (partId#k 의 partId 로). 못 찾으면 null — 엣지 표시 없이 그린다. */
function rowOfPiece(ctx, piece) {
  const hit = ctx.rowById.get(pieceBaseId(piece && piece.partId));
  return hit ? hit.row : null;
}

function cutSheetBlock(ctx, sheet, labelNo) {
  const parts = Array.isArray(sheet.parts) ? sheet.parts : [];
  const rows = parts
    .map((p) => {
      const m = rowOfPiece(ctx, p);
      const no = labelNo.get(p.partId);
      return tr(
        [
          no ? num(no) : '',
          `<span class="mono">${esc(p.partId || '')}</span>`,
          esc(p.part || ''),
          `${num(p.w)} × ${num(p.h)}`,
          num(p.x),
          num(p.y),
          p.rot ? '↻' : '-',
          m ? `${edgeSvg(rowEdges(m))}${edgeText(m)}` : '<span class="muted">행 미확인</span>',
        ],
        ['num', '', '', 'num', 'num', 'num', '', ''],
      );
    })
    .join('');
  const layout = sheet.layout && sheet.layout.stack > 1 ? ` · 겹침 ${num(sheet.layout.stack)}장 중 ${num(sheet.layout.index)}` : '';
  const svg = sheetSvg(sheet, {
    edgeOf: (p) => {
      const m = rowOfPiece(ctx, p);
      return m ? { edges: rowEdges(m), edgeT: m.edgeT } : null;
    },
    labelNoOf: (p) => labelNo.get(p.partId) || null,
  });
  return `
  <div class="cut-head">
    <b>시트 #${num(sheet.no)}</b> ${esc(sheet.material || '')} ${num(sheet.thickness)}T · ${esc(sheet.partClass || '')}
    · 원판 ${num(sheet.size && sheet.size.w)} × ${num(sheet.size && sheet.size.h)} · 조각 ${num(parts.length)} · 수율 ${fmtPct(sheet.yield)}${layout}
    <span class="checks">재단 ☐ 엣지 표시 ☐</span>
  </div>
  <div class="cut-sheet">
    <div class="cut-svg">${svg}</div>
    <div class="cut-parts">
      <table class="compact">${thead(['라벨', 'partId', '부품', 'w × h', 'x', 'y', '회전', '엣지 (두께 · 변 길이×개수)'], ['num', '', '', 'num', 'num', 'num', '', ''])}<tbody>${rows}</tbody></table>
    </div>
  </div>`;
}

/** 배치가 없을 때의 폴백 — 자재 재단 목록 (+ 엣지). */
function flatMaterialTable(ctx, rows) {
  const body = rows
    .map(({ row: m, index }) =>
      tr(
        [
          `<span class="mono">${esc(partIdOf(m, index))}</span>`,
          esc(m.itemLabel || ''),
          esc(m.module || ''),
          esc(m.part || ''),
          esc(m.material || ''),
          num(m.thickness),
          num(m.w),
          num(m.h),
          num(m.qty),
          `${edgeSvg(rowEdges(m))}${edgeText(m)}`,
        ],
        ['', '', '', '', '', 'num', 'num', 'num', 'num', ''],
      ),
    )
    .join('');
  return `<table class="compact">${thead(
    ['partId', '품목', '모듈', '부품', '자재', '두께', '가로', '세로', '수량', '엣지'],
    ['', '', '', '', '', 'num', 'num', 'num', 'num', ''],
  )}<tbody>${body}</tbody></table>`;
}

/**
 * 배치에 없는 사내 부재 — 시트 조각 · 소부품 · 미배치 어디에도 없는 `partId#k`.
 * 배치와 자재표가 어긋나면(옛 스냅샷, 손으로 고친 행) 부재가 재단 종이에서 조용히 빠지지 않게 따로 싣는다.
 * 반환: [{ row, index, missing: [k…] }] (순수, 시험용으로 노출)
 */
export function uncoveredInHouse(materials, plan) {
  if (!plan || !Array.isArray(plan.sheets)) return [];
  const covered = new Set();
  for (const s of plan.sheets) for (const p of Array.isArray(s.parts) ? s.parts : []) covered.add(String(p.partId));
  for (const u of Array.isArray(plan.unallocated) ? plan.unallocated : []) {
    for (const id of Array.isArray(u.partIds) ? u.partIds : []) covered.add(String(id));
  }
  for (const sp of Array.isArray(plan.smallParts) ? plan.smallParts : []) {
    const q = qtyOf(sp);
    for (let k = 0; k < q; k++) covered.add(`${sp.partId}#${k}`);
  }
  const out = [];
  materials.forEach((row, index) => {
    if (isDoorClass(row)) return;
    const base = partIdOf(row, index);
    const missing = [];
    for (let k = 0; k < qtyOf(row); k++) if (!covered.has(`${base}#${k}`)) missing.push(k);
    if (missing.length) out.push({ row, index, missing });
  });
  return out;
}

function edgeTotalsTable(rows) {
  const totals = edgeTotals(rows);
  if (totals.length === 0) return '<div class="muted">엣지 붙일 부재 없음</div>';
  const body = totals
    .map((g) => tr([fmtEdgeT(g.edgeT), g.code ? `<span class="mono">${esc(g.code)}</span>` : '몸통 기본', num(g.parts), fmtMeters(g.mm)], ['num', '', 'num', 'num']))
    .join('');
  return `<table class="compact">${thead(['두께', '엣지 코드', '부재 수', '길이'], ['num', '', 'num', 'num'])}<tbody>${body}</tbody></table>`;
}

/** vendor: 외주처용 판 — 사내 안내(도어재 행방·알바 메모)를 빼고 제목을 바꾼다. 부재·배치·엣지는 같다. */
function cutSheets(ctx, { vendor = false } = {}) {
  const counts = workCounts(ctx);
  const labelNo = labelNumbers(ctx.materials);
  const inHouse = ctx.materials
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !isDoorClass(row));
  const doorNote = !vendor && counts.doorRows.length
    ? `<div class="muted">도어재 ${num(counts.doorRows.reduce((s, m) => s + qtyOf(m), 0))}장${counts.doorSheets ? ` (원장 ${num(counts.doorSheets.length)}장)` : ''} 은 외주 — ⑩ 도어재 발주서.</div>`
    : '';
  const totalsBlock = `<div class="sub-title">엣지 합계 <span class="muted">${vendor ? '두께 · 엣지 코드별' : '사내 재단 부재 — 알바가 롤을 미리 챙긴다'}</span></div>${edgeTotalsTable(counts.inHouseRows)}`;
  const title = vendor ? '재단·엣지 목록' : '③ 재단·엣지 지시서';

  const plan = ctx.cutPlan;
  if (!plan) {
    return `
<div class="sheet">
  <div class="section-title">${title}</div>
  <div class="warn">재단 배치 없음 (스냅샷 재발행 필요) — 배치 없이 자재 목록만 싣는다.</div>
  ${inHouse.length ? flatMaterialTable(ctx, inHouse) : ''}
  ${doorNote}
  ${totalsBlock}
</div>`;
  }

  const sheets = counts.inHouseSheets;
  const sheetNos = new Set(sheets.map((s) => s.no));
  const byMatMap = new Map();
  for (const s of sheets) {
    const k = `${s.material || ''}_${s.thickness ?? ''}`;
    byMatMap.set(k, (byMatMap.get(k) || 0) + 1);
  }
  const byMat = [...byMatMap.entries()].map(([k, v]) => `${esc(k)} ${num(v)}장`).join(' · ');

  const offcuts = (Array.isArray(plan.offcuts) ? plan.offcuts : []).filter((o) => sheetNos.has(o.sheetNo));
  const offRows = offcuts
    .map((o) => tr([num(o.sheetNo), o.kind === 'strip' ? '스트립 잔여' : '원판 잔여', `${num(o.w)} × ${num(o.h)}`, num(o.x), num(o.y), num(o.free)], ['num', '', 'num', 'num', 'num', 'num']))
    .join('');
  const smalls = (Array.isArray(plan.smallParts) ? plan.smallParts : []).filter((s) => (s.partClass || partClassOf(s.part)) !== '도어');
  const smallRows = smalls
    .map((s) => {
      const hit = ctx.rowById.get(s.partId);
      return tr([`<span class="mono">${esc(s.partId || '')}</span>`, esc(s.part || ''), `${esc(s.material || '')} ${num(s.thickness)}T`, `${num(s.w)} × ${num(s.h)}`, num(s.qty), hit ? edgeText(hit.row) : ''], ['', '', '', 'num', 'num', '']);
    })
    .join('');
  const missingRows = uncoveredInHouse(ctx.materials, plan);
  const unalloc = (Array.isArray(plan.unallocated) ? plan.unallocated : []).filter((u) => u.partClass !== '도어');
  const unRows = unalloc
    .map((u) => tr([esc(Array.isArray(u.partIds) ? u.partIds.join(', ') : ''), esc(Array.isArray(u.parts) ? u.parts.join(', ') : ''), `${esc(u.material || '')} ${num(u.thickness)}T`, `${num(u.w)} × ${num(u.h)}`, num(u.qty)], ['', '', '', 'num', 'num']))
    .join('');

  return `
<div class="sheet">
  <div class="section-title">${title} <span class="muted">사내 원판 ${num(sheets.length)}장${byMat ? ` (${byMat})` : ''} · 톱날 ${num(plan.kerf)} · 트림 ${num(plan.trim)}</span></div>
  <div class="muted">굵은 실선 = 엣지 0.6 · 이중선 = 엣지 1.0 · 선 없음 = 엣지 없음 · 굵은 숫자 = 라벨 번호. 표의 변 길이는 부재 기준 (회전해도 같다).</div>
  ${doorNote}
  ${sheets.map((s) => cutSheetBlock(ctx, s, labelNo)).join('')}
  ${offRows ? `<div class="sub-title">잔재 (60mm 이상)</div><table class="compact">${thead(['시트', '종류', 'w × h', 'x', 'y', '남는 쪽'], ['num', '', 'num', 'num', 'num', 'num'])}<tbody>${offRows}</tbody></table>` : ''}
  ${smallRows ? `<div class="sub-title">소부품 (원판 미배치 — 잔재에서 뽑는다)</div><table class="compact">${thead(['partId', '부품', '자재', 'w × h', '수량', '엣지'], ['', '', '', 'num', 'num', ''])}<tbody>${smallRows}</tbody></table>` : ''}
  ${unRows ? `<div class="sub-title">미배치 (원판 초과)</div><div class="warn">원판보다 큰 부재가 있다 — 별도 재단.</div><table class="compact">${thead(['partId', '부품', '자재', 'w × h', '수량'], ['', '', '', 'num', 'num'])}<tbody>${unRows}</tbody></table>` : ''}
  ${missingRows.length ? `<div class="sub-title">배치에 없는 부재</div><div class="warn">재단 배치와 자재표가 어긋난다 (스냅샷 재발행 권장) — 아래 부재는 목록대로 따로 재단.</div>${flatMaterialTable(ctx, missingRows.map(({ row, index, missing }) => ({ row: { ...row, qty: missing.length }, index })))}` : ''}
  ${totalsBlock}
</div>`;
}

// ── ④ 철물·체결구 ────────────────────────────────────────────────

/** 부자재 목록 — 분류별로 묶는다. */
function hardwareSheet(ctx) {
  const hardware = ctx.hardware;
  if (hardware.length === 0) return '';

  const groups = new Map();
  for (const h of hardware) {
    const key = h.category || '기타';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }

  const blocks = [...groups.entries()]
    .map(([category, rows]) => {
      const body = rows
        .map((h) =>
          tr(
            [esc(h.itemLabel || ''), esc(h.item || ''), esc(h.manufacturer || ''), esc(h.spec || ''), num(h.qty), esc(h.unit || ''), esc(h.note || '')],
            ['', '', '', '', 'num', '', ''],
          ),
        )
        .join('');
      const total = rows.reduce((s, h) => s + (Number(h.qty) || 0), 0);
      return `
  <div class="sub-title">${esc(category)} <span class="muted">${num(rows.length)}건 · ${num(total)}</span></div>
  <table class="compact">
    ${thead(['품목', '철물', '제조사', '규격', '수량', '단위', '비고'], ['', '', '', '', 'num', '', ''])}
    <tbody>${body}</tbody>
  </table>`;
    })
    .join('');

  return `
<div class="sheet">
  <div class="section-title">④ 철물·체결구 (${num(hardware.length)}건)</div>
  ${blocks}
</div>`;
}

// ── 경첩 보링 (⑩ 도어재 발주서가 읽는다) ─────────────────────────

/** 경첩 행 → 보링 표 행들 (순수, 시험용으로 노출). */
export function boringRows(materials, hardware) {
  const out = [];
  for (const h of hardware) {
    const parsed = parseBoringNote(h);
    if (!parsed) continue;
    const doors = doorRowsForHinge(materials, h);
    const doorH = doorHeightFromBoring(parsed.positions);
    const base = {
      itemLabel: h.itemLabel || '',
      moduleName: parsed.moduleName,
      count: parsed.positions.length,
      positions: parsed.positions,
      hingeQty: Number(h.qty) || null,
      spec: h.spec || '',
      side: h.boringSide || null, // B4: 'top' = 플랩 — 도어 폭 변(천판 쪽)
      warn: (String(h.note || '').match(/\[확인 필요\].*/) || [null])[0], // 짧은 도어 컵 간격 등 — 발주서에 그대로 보인다
    };
    if (doors.length === 0) {
      out.push({ ...base, partId: null, doorH, qty: null });
      continue;
    }
    for (const { row, index } of doors) {
      out.push({ ...base, partId: partIdOf(row, index), doorH: Number(row.h) || doorH, qty: Number(row.qty) || null });
    }
  }
  return out;
}

// ── ⑥ 조립 순서 체크 ─────────────────────────────────────────────

/** 공장 단계 — 각자 자기 작업을 스스로 검수한다. 보링 공정은 없다 (컵 보링은 도어 외주). */
export const ASSEMBLY_STEPS = ['재단', '엣지', '조립', '도어 달기', '서랍', '검수·포장'];

function assemblySheet(ctx) {
  const box = '☐';
  const na = '—';
  const rows = ctx.items.flatMap((item, i) => {
    const label = itemLabel(item, i);
    const modules = Array.isArray(item.modules) ? item.modules : [];
    return modules.map((m, mi) => {
      const hasDoor = Number(m.doorCount) > 0;
      const hasDrawer = Boolean(m.isDrawer);
      return tr(
        [
          esc(label),
          `<b>${num(mi + 1)}</b> ${esc(MODULE_POS[m.pos] || m.pos || '-')} ${esc(m.name || m.type || '-')} <span class="muted">${num(m.w)}×${num(m.h)}</span>`,
          box, box, box,
          hasDoor ? box : na,
          hasDrawer ? box : na,
          box,
          '', '',
        ],
        ['', '', 'box', 'box', 'box', hasDoor ? 'box' : 'na', hasDrawer ? 'box' : 'na', 'box', 'blank', 'blank'],
      );
    });
  });

  return `
<div class="sheet">
  <div class="section-title">⑥ 조립 순서 체크 <span class="muted">— 칸은 해당 없음</span></div>
  <table class="check compact">
    ${thead(['품목', '모듈', ...ASSEMBLY_STEPS, '완료일', '서명'])}
    <tbody>${rows.join('') || tr(['모듈 없음', '', '', '', '', '', '', '', '', ''])}</tbody>
  </table>
</div>`;
}

// ── ⑦ 이전 rev 와의 차이 ─────────────────────────────────────────

const FIELD_LABEL = { w: '가로', h: '세로', thickness: '두께', qty: '수량', finishCode: '마감', material: '자재' };

function diffSheet(ctx) {
  const title = '<div class="section-title">⑦ 이전 rev 와의 차이</div>';
  if (ctx.prevRev === undefined) {
    return `<div class="sheet">${title}<div class="muted">${ctx.isV2 ? '비교 자료 없음' : 'v1 발행 문서 — 비교 자료 없음 (재발행하면 이전 rev 와 비교한다)'}</div></div>`;
  }
  if (!ctx.prevRev) {
    return `<div class="sheet">${title}<div class="muted">첫 발행</div></div>`;
  }
  const p = ctx.prevRev;
  const d = p.diff || { added: [], removed: [], changed: [] };
  const partRow = (r) =>
    tr([`<span class="mono">${esc(r.partId || r.key || '')}</span>`, esc(r.itemLabel || ''), esc(r.module || ''), esc(r.part || ''), `${num(r.w)} × ${num(r.h)} × ${num(r.thickness)}`, num(r.qty), esc(r.finishCode || '-')], ['', '', '', '', 'num', 'num', '']);
  const head = thead(['partId', '품목', '모듈', '부품', 'w × h × t', '수량', '마감'], ['', '', '', '', 'num', 'num', '']);
  const changedRows = (d.changed || [])
    .map((r) =>
      tr([
        `<span class="mono">${esc(r.partId || r.key || '')}</span>`,
        esc(r.module || ''),
        esc(r.part || ''),
        esc((r.changes || []).map((c) => `${FIELD_LABEL[c.field] || c.field}: ${c.from ?? '-'} → ${c.to ?? '-'}`).join(' · ')),
      ]),
    )
    .join('');
  const nothing = !(d.added || []).length && !(d.removed || []).length && !(d.changed || []).length;

  return `
<div class="sheet">
  ${title}
  <div class="muted">비교 대상: ${esc(p.doc_no || `rev ${p.rev}`)} (Rev. ${esc(p.rev)}) → 이 문서 Rev. ${esc(ctx.doc.rev)}</div>
  ${nothing ? '<div class="muted" style="margin-top:6pt">부재 변경 없음</div>' : ''}
  ${(d.added || []).length ? `<div class="sub-title">추가 (${num(d.added.length)})</div><table class="compact">${head}<tbody>${d.added.map(partRow).join('')}</tbody></table>` : ''}
  ${(d.removed || []).length ? `<div class="sub-title">삭제 (${num(d.removed.length)})</div><table class="compact">${head}<tbody>${d.removed.map(partRow).join('')}</tbody></table>` : ''}
  ${(d.changed || []).length ? `<div class="sub-title">변경 (${num(d.changed.length)})</div><table class="compact">${thead(['partId', '모듈', '부품', '변경'])}<tbody>${changedRows}</tbody></table>` : ''}
</div>`;
}

// ── ⑧ 부재 라벨 부록 ─────────────────────────────────────────────

/** 자재 행을 낱개로 전개 — 라벨 하나 = 부재 하나 (`partId#k`, 재단 배치의 조각 id 와 같다). */
export function labelUnits(materials) {
  const units = [];
  materials.forEach((m, index) => {
    const base = partIdOf(m, index);
    const qty = Math.max(0, Math.round(Number(m.qty) || 0));
    for (let k = 0; k < qty; k++) {
      units.push({ id: `${base}#${k}`, row: m });
    }
  });
  return units;
}

/** 라벨 순서 — 사내 재단 부재 먼저(재단 직후 부착), 도어재는 뒤(입고 시 부착). */
export function labelGroups(materials) {
  const units = labelUnits(materials);
  return {
    inHouse: units.filter((u) => !isDoorClass(u.row)),
    door: units.filter((u) => isDoorClass(u.row)),
  };
}

/** 조각 id → 라벨 번호 (1부터, labelGroups 순서). 재단표와 라벨이 같은 번호를 쓴다. */
export function labelNumbers(materials) {
  const { inHouse, door } = labelGroups(materials);
  return new Map([...inHouse, ...door].map((u, i) => [u.id, i + 1]));
}

function labelCell(unit, no, ctx) {
  const m = unit.row;
  let qr;
  try {
    qr = qrSvg(unit.id);
  } catch {
    qr = '<div class="muted">QR 불가</div>';
  }
  const s = ctx.swatchByCode.get(m.finishCode);
  const hex = normalizeHex(s && s.color_hex);
  const sides = edgeSidesText(m);
  return `
  <div class="label">
    ${qr}
    <div class="lt">
      <div class="pid"><b>${num(no)}</b> · ${esc(unit.id)}</div>
      <div>${esc(m.itemLabel || '')} · ${esc(m.module || '')}</div>
      <div><b>${esc(m.part || '')}</b> · ${esc(m.material || '')}</div>
      <div class="dim">${num(m.w)} × ${num(m.h)} × ${num(m.thickness)}</div>
      <div>${m.finishCode ? `${hex ? `<span class="chip" style="background:${hex}"></span>` : ''}<span class="mono">${esc(m.finishCode)}</span>` : '<span class="muted">마감 기본</span>'}</div>
      <div class="edge-line">${edgeSvg(rowEdges(m))}${sides === '없음' ? '엣지 없음' : `${fmtEdgeT(m.edgeT)} · ${esc(sides)}`}</div>
    </div>
  </div>`;
}

function labelSheets(ctx) {
  const { inHouse, door } = labelGroups(ctx.materials);
  const total = inHouse.length + door.length;
  if (total === 0) return '';
  const pages = [];
  const pageCount = Math.ceil(inHouse.length / LABELS_PER_SHEET) + Math.ceil(door.length / LABELS_PER_SHEET);
  const emit = (units, offset, heading) => {
    for (let i = 0; i < units.length; i += LABELS_PER_SHEET) {
      const chunk = units.slice(i, i + LABELS_PER_SHEET);
      const first = offset + i + 1;
      pages.push(`
<div class="sheet">
  <div class="section-title">⑧ 부재 라벨 — ${heading} <span class="muted">${num(first)}–${num(first + chunk.length - 1)} / ${num(total)} · ${esc(ctx.doc.doc_no)} · ${pages.length + 1}/${pageCount}</span></div>
  <div class="label-grid">${chunk.map((u, j) => labelCell(u, first + j, ctx)).join('')}</div>
</div>`);
    }
  };
  emit(inHouse, 0, '사내 재단 (재단 직후 부착)');
  emit(door, inHouse.length, '도어재 (입고 시 부착)');
  return pages.join('');
}

// ── ⑩ 도어재 발주서 ──────────────────────────────────────────────

/**
 * 서랍장 전면 = "마이다" — 보링하지 않는다 (2026-10-18 사장님, 맨 위 칸 전면까지 전부).
 * 서랍도어 행이거나, 같은 모듈(moduleKey **와** 모듈 라벨)에 서랍도어가 있는 도어 행 — 싱크·단순 카테고리 서랍장.
 * 붙박이장 외부 서랍은 서랍도어 라벨이 `…-서랍모듈` 로 따로라, 그 위 긴 여닫이 도어는 마이다가 아니다 (경첩 있음).
 * BOM 도 서랍장 모듈에는 경첩을 내지 않는다 (extractors.js bomIsMaidaModule). (순수, 시험용으로 노출)
 */
export function isMaidaRow(materials, row) {
  if (!row) return false;
  if (row.slot === 'drawerFront' || row.part === '서랍도어') return true;
  if (!(row.slot === 'door' || row.part === '도어') || !row.moduleKey) return false;
  return (materials || []).some((m) => m && m.moduleKey === row.moduleKey && m.module === row.module
    && (m.slot === 'drawerFront' || m.part === '서랍도어'));
}

/**
 * 도어 외주처로 가는 종이. 도어 그룹(도어·몰딩·걸레받이·목찬넬·마감) 부재를 마감별로 묶고,
 * 도어 행에는 경첩 컵 위치(경첩 비고의 보링, 도어 상단 기준 mm)를 붙인다.
 * 금액도 고객 이름도 싣지 않는다 — 문서번호만.
 */
function doorOrderSheet(ctx) {
  const counts = workCounts(ctx);
  const title = '⑩ 도어재 발주서';
  const rows = ctx.materials.map((row, index) => ({ row, index })).filter(({ row }) => isDoorClass(row));
  if (rows.length === 0) {
    return `<div class="sheet"><div class="section-title">${title}</div><div class="muted">도어재 부재 없음</div></div>`;
  }

  const borings = boringRows(ctx.materials, ctx.hardware);
  const boringById = new Map();
  for (const b of borings) if (b.partId) boringById.set(b.partId, b);
  const orphans = borings.filter((b) => !b.partId);

  const groups = new Map();
  for (const r of rows) {
    const key = r.row.finishCode || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const blocks = [...groups.entries()]
    .map(([code, list]) => {
      const s = code ? ctx.swatchByCode.get(code) : null;
      const pieces = list.reduce((sum, { row }) => sum + qtyOf(row), 0);
      const head = code
        ? `${swatchChip(ctx, code)} ${esc((s && s.color_name) || '')}${s && s.vendor_code ? ` · 발주 코드 <span class="mono">${esc(s.vendor_code)}</span>` : ''}`
        : '마감 코드 없음 (기본 자재)';
      const body = list
        .map(({ row: m, index }) => {
          const pid = partIdOf(m, index);
          const b = boringById.get(pid);
          return tr(
            [
              `<span class="mono">${esc(pid)}</span>`,
              `${esc(m.itemLabel || '')} · ${esc(moduleNameOf(m.module) || m.module || '')}`,
              esc(m.part || ''),
              `${num(m.w)} × ${num(m.h)} × ${num(m.thickness)}`,
              num(m.qty),
              `${edgeSvg(rowEdges(m))}${edgeText(m)}`,
              b ? `${num(b.count)}구 · ${esc(b.positions.join(', '))}${b.side === 'top' ? ' <span class="muted">(플랩 — 천판 쪽 폭 변)</span>' : ''}${b.warn ? ` <span class="warn">${esc(b.warn)}</span>` : ''}`
                : isMaidaRow(ctx.materials, m) ? '<span class="muted">마이다 — 보링 없음</span>' : '',
            ],
            ['', '', '', 'num', 'num', '', ''],
          );
        })
        .join('');
      return `
  <div class="sub-title">${head} <span class="muted">${num(list.length)}종 · ${num(pieces)}장</span></div>
  <table class="compact">${thead(['partId', '품목 · 모듈', '부품', '가로 × 세로 × 두께', '수량', '엣지', '경첩 컵 (상단 기준 mm)'], ['', '', '', 'num', 'num', '', ''])}<tbody>${body}</tbody></table>`;
    })
    .join('');

  const orphanBlock = orphans.length
    ? `<div class="sub-title">도어 행을 못 찾은 경첩</div><div class="warn">아래 모듈의 도어는 표에서 직접 맞춰 주세요.</div><table class="compact">${thead(['품목', '모듈', '도어 H', '구 수', '컵 위치 (mm)'], ['', '', 'num', 'num', ''])}<tbody>${orphans
        .map((b) => tr([esc(b.itemLabel), esc(b.moduleName), num(b.doorH), num(b.count), esc(b.positions.join(', '))], ['', '', 'num', 'num', '']))
        .join('')}</tbody></table>`
    : '';

  const pieces = rows.reduce((s, { row }) => s + qtyOf(row), 0);
  return `
<div class="sheet">
  <div class="section-title">${title} <span class="muted">금액 없음</span></div>
  <dl class="kv">
    <dt>문서</dt><dd class="doc-no">${esc(ctx.doc.doc_no)} · Rev. ${esc(ctx.doc.rev)} · 발행 ${esc(ymd(ctx.doc.created_at))}</dd>
    <dt>도어재 원장</dt><dd>${counts.doorSheets ? `${num(counts.doorSheets.length)}장 (1220×2440 기준 배치)` : '배치 없음'}</dd>
    <dt>도어</dt><dd>${num(counts.doors)}짝</dd>
    <dt>도어재 부재</dt><dd>${num(rows.length)}종 · ${num(pieces)}장</dd>
  </dl>
  ${blocks}
  ${orphanBlock}
</div>`;
}

// ── 꾸러미 머리 ──────────────────────────────────────────────────

function packHeader(ctx, pack) {
  const { doc } = ctx;
  const p = WORK_ORDER_PACKS[pack];
  const counts = workCounts(ctx);
  const labor = laborOf(ctx, counts);
  const facts = [];
  const vendor = pack === 'cut-vendor';
  if (pack === 'cut' || vendor) {
    const totals = edgeTotals(counts.inHouseRows);
    const thin = totals.filter((g) => g.edgeT < 1).reduce((s, g) => s + g.mm, 0);
    const thick = totals.filter((g) => g.edgeT >= 1).reduce((s, g) => s + g.mm, 0);
    facts.push([vendor ? '원판' : '사내 원판', counts.inHouseSheets ? `${num(counts.inHouseSheets.length)}장 (본체 ${num(counts.bodySheets)})` : '배치 없음']);
    facts.push(['엣지', `0.6 ${fmtMeters(thin)} · 1.0 ${fmtMeters(thick)}`]);
    if (labor && !vendor) facts.push(['예상 시간', `재단 ${fmtMinutes(labor.cutMin)} · 엣지 ${fmtMinutes(labor.edgeMin)} (알바)`]);
  } else if (pack === 'assembly') {
    facts.push(['통 · 서랍 · 도어', `${num(counts.cabinets)}통 · 서랍 ${num(counts.drawers)} · 도어 ${num(counts.doors)}짝`]);
    if (labor) facts.push(['예상 시간', `조립 ${fmtMinutes(labor.assemblyMin)}`]);
  } else if (pack === 'labels') {
    const g = labelGroups(ctx.materials);
    facts.push(['라벨', `사내 ${num(g.inHouse.length)} · 도어재 ${num(g.door.length)} (A4 ${num(Math.ceil(g.inHouse.length / LABELS_PER_SHEET) + Math.ceil(g.door.length / LABELS_PER_SHEET))}쪽)`]);
  }
  const showRenders = pack === 'assembly'; // 재단은 치수 정면도만 — 3D 렌더는 조립 참고용
  return `
<div class="pack-head">
  <div class="doc-header">
    <div>
      <h1>${esc(p.title)}</h1>
      <div>${esc(p.who)}</div>
    </div>
    <div class="doc-meta">
      <div class="doc-no">${esc(doc.doc_no)}</div>
      <div>Rev. ${esc(doc.rev)}</div>
      <div>발행 ${esc(ymd(doc.created_at))}</div>
    </div>
  </div>
  <dl class="kv">
    ${vendor ? '' : `<dt>설계</dt><dd>${esc(doc.title)} · 설계 rev ${esc(ctx.snapshot.rev)}</dd>`}
    ${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}
  </dl>
  ${pack === 'cut' || pack === 'assembly' ? `<div class="section-title">정면도</div>${elevationBlock(ctx)}` : ''}
  ${showRenders ? `<div class="section-title">정면 렌더 <span class="muted">참고</span></div>${renderBoxes(ctx)}` : ''}
  ${!vendor && doc.render_payload?.instructions ? `<div class="section-title">특기사항</div><div class="note">${esc(doc.render_payload.instructions)}</div>` : ''}
</div>`;
}

// ── 조립 ─────────────────────────────────────────────────────────

const PACK_SECTIONS = {
  all: [coverSheet, moduleSheets, moduleDrawingsSheet, kittingSheets, (ctx) => cutSheets(ctx), hardwareSheet, assemblySheet, diffSheet, doorOrderSheet, labelSheets, (ctx) => (hasCountertop(ctx.snapshot && ctx.snapshot.bom_payload) ? countertopSheets(ctx) : '')],
  cut: [(ctx) => packHeader(ctx, 'cut'), (ctx) => cutSheets(ctx)],
  // 외주처 종이 — 고객 이름·설계 제목·특기사항·정면도·시간 없음 (door 와 같은 원칙)
  'cut-vendor': [(ctx) => packHeader(ctx, 'cut-vendor'), (ctx) => cutSheets(ctx, { vendor: true })],
  assembly: [(ctx) => packHeader(ctx, 'assembly'), moduleSheets, moduleDrawingsSheet, kittingSheets, hardwareSheet, assemblySheet, diffSheet],
  door: [doorOrderSheet], // 외주처 종이 — 고객 정보가 든 머리를 붙이지 않는다
  top: [countertopSheets], // 상판 업체 종이 — 도어재 발주서와 같은 원칙
  labels: [(ctx) => packHeader(ctx, 'labels'), labelSheets],
};

export function renderWorkOrder(doc, snapshot, { toolbar = true, renderUrls = new Map(), pack = 'all', top = null } = {}) {
  const key = normalizePack(pack) || 'all';
  const ctx = buildContext(doc, snapshot, renderUrls);
  ctx.top = top; // 상판 요청서 — 발주 마감 · 업체 · 가전 모델 (인쇄 시점, worker.js)
  const parts = PACK_SECTIONS[key].map((fn) => fn(ctx));
  // 꾸러미 머리는 따로 한 쪽을 쓰지 않는다 — 첫 섹션 쪽의 맨 위에 넣는다 (종이 한 장 아끼기)
  if (parts.length > 1 && parts[0].includes('class="pack-head"')) {
    const head = parts.shift();
    const open = '<div class="sheet">';
    const at = parts[0].indexOf(open);
    parts[0] = at >= 0
      ? `${parts[0].slice(0, at)}${open}${head}${parts[0].slice(at + open.length)}`
      : `${open}${head}</div>${parts[0]}`;
  }
  const body = [toolbar ? PRINT_TOOLBAR : '', ...parts].join('\n');
  return documentShell({
    title: `${WORK_ORDER_PACKS[key].title} ${doc.doc_no}`,
    css: PRINT_CSS,
    body,
  });
}
