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
 *   ⑤ 보링 좌표표 (경첩 비고의 보링 위치 → 도어 partId)
 *   ⑥ 조립 순서 체크
 *   ⑦ 이전 rev 와의 차이
 *   ⑧ 부재 라벨 부록 (partId QR)
 * 자료는 발행 시 `render_payload` 에 동결된 것만 읽는다 (work-order-data.js). v1 문서(그 필드가 없는
 * 것)도 열려야 하므로 모든 섹션은 자료가 없으면 안내 문구로 내려앉는다.
 */

import { esc, num, ymd, tr, thead, documentShell } from './html.js';
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
} from '../work-order-data.js';

const CATEGORY_NAMES = {
  sink: '싱크대',
  island: '아일랜드',
  wardrobe: '붙박이장',
  fridge: '냉장고장',
  shoerack: '신발장',
  vanity: '화장대',
  storage: '수납장',
  warehouse: '창고장',
  door: '도어교체',
  custom: '비규격장',
};

const MODULE_POS = { upper: '상부', lower: '하부' };

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
  };
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
    <dt>재단 시트</dt><dd>${sheetCount === null || sheetCount === undefined ? '배치 없음' : `${num(sheetCount)}장`}</dd>
    <dt>라벨 수</dt><dd>${num(labelCount)}</dd>
    <dt>설계 해시</dt><dd class="doc-no">${esc(String(snapshot.content_hash).slice(0, 12))}</dd>
  </dl>

  <div class="section-title">정면 렌더</div>
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
      return modules.map((m) =>
        tr(
          [
            esc(label),
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
          ['', '', '', 'num', 'num', ''],
        ),
      );
    })
    .join('');

  return `
<div class="sheet">
  <div class="section-title">모듈 명세</div>
  <table>
    ${thead(['품목', '위치', '모듈', 'W × H × D (mm)', '도어', '비고'], ['', '', '', 'num', 'num', ''])}
    <tbody>${rows}</tbody>
  </table>
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
    const modKey = m.module || '';
    if (!modules.has(modKey)) modules.set(modKey, { module: modKey, rows: [] });
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
          const hn = hardwareModuleName(h);
          if (hn === null || hn !== name || name === '') return false;
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

// ── ③ 시트별 재단표 ──────────────────────────────────────────────

function fmtPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '-';
}

/** 배치 축소판. 트림 영역은 회색, 조각은 흰 사각형 + 부품명 (+ partId, 자리가 있을 때). */
export function sheetSvg(sheet) {
  const W = Number(sheet.size && sheet.size.w) || 0;
  const H = Number(sheet.size && sheet.size.h) || 0;
  if (W <= 0 || H <= 0) return '';
  const trim = Number.isFinite(Number(sheet.trim)) ? Number(sheet.trim) : 10;
  const parts = Array.isArray(sheet.parts) ? sheet.parts : [];
  const strokeW = Math.max(2, Math.round(W / 400));

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
      return `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" fill="#fff" stroke="#000" stroke-width="${strokeW}"/>${text}${p.rot ? `<text x="${x + pw - fs * 0.9}" y="${y + fs}" font-size="${fs}" fill="#444">↻</text>` : ''}`;
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

function cutSheetBlock(sheet) {
  const parts = Array.isArray(sheet.parts) ? sheet.parts : [];
  const rows = parts
    .map((p) =>
      tr(
        [
          `<span class="mono">${esc(p.partId || '')}</span>`,
          esc(p.part || ''),
          `${num(p.w)} × ${num(p.h)}`,
          num(p.x),
          num(p.y),
          p.rot ? '↻' : '-',
        ],
        ['', '', 'num', 'num', 'num', ''],
      ),
    )
    .join('');
  const layout = sheet.layout && sheet.layout.stack > 1 ? ` · 겹침 ${num(sheet.layout.stack)}장 중 ${num(sheet.layout.index)}` : '';
  return `
  <div class="cut-head">
    <b>시트 #${num(sheet.no)}</b> ${esc(sheet.material || '')} ${num(sheet.thickness)}T · ${esc(sheet.partClass || '')}
    · 원판 ${num(sheet.size && sheet.size.w)} × ${num(sheet.size && sheet.size.h)} · 조각 ${num(parts.length)} · 수율 ${fmtPct(sheet.yield)}${layout}
  </div>
  <div class="cut-sheet">
    <div class="cut-svg">${sheetSvg(sheet)}</div>
    <div class="cut-parts">
      <table class="compact">${thead(['partId', '부품', 'w × h', 'x', 'y', '회전'], ['', '', 'num', 'num', 'num', ''])}<tbody>${rows}</tbody></table>
    </div>
  </div>`;
}

/** 배치가 없을 때의 폴백 — v1 의 자재 재단 목록. */
function flatMaterialTable(ctx) {
  const rows = ctx.materials
    .map((m, i) =>
      tr(
        [
          `<span class="mono">${esc(partIdOf(m, i))}</span>`,
          esc(m.itemLabel || ''),
          esc(m.module || ''),
          esc(m.part || ''),
          esc(m.material || ''),
          num(m.thickness),
          num(m.w),
          num(m.h),
          num(m.qty),
          esc(m.edge || '-'),
        ],
        ['', '', '', '', '', 'num', 'num', 'num', 'num', ''],
      ),
    )
    .join('');
  return `<table class="compact">${thead(
    ['partId', '품목', '모듈', '부품', '자재', '두께', '가로', '세로', '수량', '엣지'],
    ['', '', '', '', '', 'num', 'num', 'num', 'num', ''],
  )}<tbody>${rows}</tbody></table>`;
}

function cutSheets(ctx) {
  const plan = ctx.cutPlan;
  if (!plan) {
    return `
<div class="sheet">
  <div class="section-title">③ 시트별 재단표</div>
  <div class="warn">재단 배치 없음 (스냅샷 재발행 필요) — 배치 없이 자재 목록만 싣는다.</div>
  ${ctx.materials.length ? flatMaterialTable(ctx) : ''}
</div>`;
  }

  const sheets = plan.sheets.map(cutSheetBlock).join('');
  const summary = plan.summary || {};
  const byMat = summary.sheetsByMaterial && typeof summary.sheetsByMaterial === 'object'
    ? Object.entries(summary.sheetsByMaterial).map(([k, v]) => `${esc(k)} ${num(v)}장`).join(' · ')
    : '';

  const offcuts = Array.isArray(plan.offcuts) ? plan.offcuts : [];
  const offRows = offcuts
    .map((o) => tr([num(o.sheetNo), o.kind === 'strip' ? '스트립 잔여' : '원판 잔여', `${num(o.w)} × ${num(o.h)}`, num(o.x), num(o.y), num(o.free)], ['num', '', 'num', 'num', 'num', 'num']))
    .join('');
  const smalls = Array.isArray(plan.smallParts) ? plan.smallParts : [];
  const smallRows = smalls
    .map((s) => tr([`<span class="mono">${esc(s.partId || '')}</span>`, esc(s.part || ''), `${esc(s.material || '')} ${num(s.thickness)}T`, `${num(s.w)} × ${num(s.h)}`, num(s.qty)], ['', '', '', 'num', 'num']))
    .join('');
  const unalloc = Array.isArray(plan.unallocated) ? plan.unallocated : [];
  const unRows = unalloc
    .map((u) => tr([esc(Array.isArray(u.partIds) ? u.partIds.join(', ') : ''), esc(Array.isArray(u.parts) ? u.parts.join(', ') : ''), `${esc(u.material || '')} ${num(u.thickness)}T`, `${num(u.w)} × ${num(u.h)}`, num(u.qty)], ['', '', '', 'num', 'num']))
    .join('');

  return `
<div class="sheet">
  <div class="section-title">③ 시트별 재단표 <span class="muted">원판 ${num(plan.sheets.length)}장${byMat ? ` (${byMat})` : ''} · 톱날 ${num(plan.kerf)} · 트림 ${num(plan.trim)} · 총 수율 ${fmtPct(summary.totalYield)}</span></div>
  ${sheets}
  ${offRows ? `<div class="sub-title">잔재 (60mm 이상)</div><table class="compact">${thead(['시트', '종류', 'w × h', 'x', 'y', '남는 쪽'], ['num', '', 'num', 'num', 'num', 'num'])}<tbody>${offRows}</tbody></table>` : ''}
  ${smallRows ? `<div class="sub-title">소부품 (원판 미배치 — 잔재에서 뽑는다)</div><table class="compact">${thead(['partId', '부품', '자재', 'w × h', '수량'], ['', '', '', 'num', 'num'])}<tbody>${smallRows}</tbody></table>` : ''}
  ${unRows ? `<div class="sub-title">미배치 (원판 초과)</div><div class="warn">원판보다 큰 부재가 있다 — 별도 재단.</div><table class="compact">${thead(['partId', '부품', '자재', 'w × h', '수량'], ['', '', '', 'num', 'num'])}<tbody>${unRows}</tbody></table>` : ''}
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

// ── ⑤ 보링 좌표표 ────────────────────────────────────────────────

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

function boringSheet(ctx) {
  const rows = boringRows(ctx.materials, ctx.hardware);
  const body = rows.length
    ? rows
        .map((r) =>
          tr(
            [
              esc(r.itemLabel),
              esc(r.moduleName),
              r.partId ? `<span class="mono">${esc(r.partId)}</span>` : '<span class="muted">도어 행 미확인</span>',
              num(r.qty),
              num(r.doorH),
              num(r.count),
              esc(r.positions.join(', ')),
            ],
            ['', '', '', 'num', 'num', 'num', ''],
          ),
        )
        .join('')
    : tr(['경첩 보링 정보 없음', '', '', '', '', '', '']);

  return `
<div class="sheet">
  <div class="section-title">⑤ 보링 좌표표 <span class="muted">경첩 컵 위치 — 도어 상단 기준 mm</span></div>
  <table class="compact">
    ${thead(['품목', '모듈', '도어 partId', '도어 수', '도어 H', '구 수', '보링 위치 (mm)'], ['', '', '', 'num', 'num', 'num', ''])}
    <tbody>${body}</tbody>
  </table>
</div>`;
}

// ── ⑥ 조립 순서 체크 ─────────────────────────────────────────────

function assemblySheet(ctx) {
  const rows = ctx.items.flatMap((item, i) => {
    const label = itemLabel(item, i);
    const modules = Array.isArray(item.modules) ? item.modules : [];
    return modules.map((m) =>
      tr(
        [
          esc(label),
          `${esc(MODULE_POS[m.pos] || m.pos || '-')} ${esc(m.name || m.type || '-')} <span class="muted">${num(m.w)}×${num(m.h)}</span>`,
          '☐', '☐', '☐', '☐', '☐', '', '',
        ],
        ['', '', 'box', 'box', 'box', 'box', 'box', 'blank', 'blank'],
      ),
    );
  });

  return `
<div class="sheet">
  <div class="section-title">⑥ 조립 순서 체크</div>
  <table class="check compact">
    ${thead(['품목', '모듈', '재단', '엣지', '보링', '조립', '검수', '완료일', '서명'])}
    <tbody>${rows.join('') || tr(['모듈 없음', '', '', '', '', '', '', '', ''])}</tbody>
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

function labelCell(unit, ctx) {
  const m = unit.row;
  let qr;
  try {
    qr = qrSvg(unit.id);
  } catch {
    qr = '<div class="muted">QR 불가</div>';
  }
  const s = ctx.swatchByCode.get(m.finishCode);
  const hex = normalizeHex(s && s.color_hex);
  return `
  <div class="label">
    ${qr}
    <div class="lt">
      <div class="pid">${esc(unit.id)}</div>
      <div>${esc(m.itemLabel || '')} · ${esc(m.module || '')}</div>
      <div><b>${esc(m.part || '')}</b> · ${esc(m.material || '')}</div>
      <div class="dim">${num(m.w)} × ${num(m.h)} × ${num(m.thickness)}</div>
      <div>${m.finishCode ? `${hex ? `<span class="chip" style="background:${hex}"></span>` : ''}<span class="mono">${esc(m.finishCode)}</span>` : '<span class="muted">마감 기본</span>'}</div>
    </div>
  </div>`;
}

function labelSheets(ctx) {
  const units = labelUnits(ctx.materials);
  if (units.length === 0) return '';
  const pages = [];
  for (let i = 0; i < units.length; i += LABELS_PER_SHEET) {
    const chunk = units.slice(i, i + LABELS_PER_SHEET);
    const pageNo = pages.length + 1;
    pages.push(`
<div class="sheet">
  <div class="section-title">⑧ 부재 라벨 <span class="muted">${num(i + 1)}–${num(i + chunk.length)} / ${num(units.length)} · ${esc(ctx.doc.doc_no)} · ${pageNo}/${Math.ceil(units.length / LABELS_PER_SHEET)}</span></div>
  <div class="label-grid">${chunk.map((u) => labelCell(u, ctx)).join('')}</div>
</div>`);
  }
  return pages.join('');
}

// ── 조립 ─────────────────────────────────────────────────────────

export function renderWorkOrder(doc, snapshot, { toolbar = true, renderUrls = new Map() } = {}) {
  const ctx = buildContext(doc, snapshot, renderUrls);
  const body = [
    toolbar ? PRINT_TOOLBAR : '',
    coverSheet(ctx),
    moduleSheets(ctx),
    kittingSheets(ctx),
    cutSheets(ctx),
    hardwareSheet(ctx),
    boringSheet(ctx),
    assemblySheet(ctx),
    diffSheet(ctx),
    labelSheets(ctx),
  ].join('\n');

  return documentShell({
    title: `작업지시서 ${doc.doc_no}`,
    css: PRINT_CSS,
    body,
  });
}
