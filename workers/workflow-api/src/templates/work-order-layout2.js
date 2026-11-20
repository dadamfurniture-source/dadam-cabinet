/**
 * 작업지시서 새 틀 (sheet_layout 2 — 앞선 작업지시서 v2(B5)와 다른 판) — 재단 · 엣지 지시서 · 도어재 발주서
 *   (2026-11-20 사장님 「재단: 도면은 필요없음, 재단, 엣지 지시서 정리(원장 내용 : 자재종류, 두께, 색상, 수량, 엣지길이 집계), 표를 삭제하고,
 *    원장표시를 크게 해서 부재 안에 수치와 엣지 표시 되도록, 엣지 표시는 굵은 선을 부재 외곽선 보다 안으로 오프셋해서 표시 되도록
 *    (엣지 표시가 다 연결 되지 않고, 끊겨서 보이도록해서 인식잘되게.) 어떤 모듈인지도 표시, 재단선도 옅게 표시해주셈. 그리고 도어가 발주라면
 *    발주에만 생성, 내수라면 재단지시서에 포함되어 생성, 도어에 보링이 있다면 보링도 표시, 판재 도면은 필요없음. 엣지_부재마다 붙일 변 도 필요없음」 ·
 *    「도어재 발주 : 재단지시서와 같은 형식」).
 *
 * 발행(documents.js docPayloadOf)이 render_payload.sheet_layout = 2 를 고정한 문서 · 미리보기만 이 판으로 그린다 — 옛 문서는 예전 틀 그대로.
 * 숫자는 재단 배치 · 자재 행 · 경첩 보링 행 그대로 옮긴다 (치수 규칙 없음). 그림 크기 · 선 굵기 · 글자 크기는 그림용 값이다.
 *
 * 원장 그림 (bigSheetSvg):
 *   - 원장 한 장 = 종이 한 쪽, 쪽에 꽉 차게 (재단기 파일이 있는 원장은 재단기 화면 방향 — screenSheetOf)
 *   - 조각 안: 라벨 번호(왼쪽 위) · 「#모듈 부품」 · 치수(가로 × 세로, 굵게) — 자리가 모자라면 글을 줄이고 좁고 긴 조각은 세워 쓴다
 *   - 엣지: 조각 외곽선보다 안쪽으로 물린 굵은 선, 모서리에서 끊는다 (변마다 따로 보이게). 0.6 = 굵은 선 한 줄 · 1.0 = 두 줄
 *   - 재단선: 톱이 끝까지 지나가는 자리를 옅은 점선으로 (조각 네모만 보고 찾는다 — guillotineCuts)
 *   - 도어 보링: 경첩 컵 자리(상단 기준 mm, 플랩은 윗변)를 원으로 — 발주서 앞모습 그림과 같은 변 (doorDrawingSvg)
 */
import { esc, num, tr, thead } from './html.js';
import {
  workCounts,
  routeOf,
  rowOfPiece,
  rowEdges,
  drawnEdges,
  screenSheetOf,
  cncOf,
  orderChecksBlock,
  specialNotesBox,
  swatchChip,
  flatMaterialTable,
  pieceLabelText,
  boringRows,
  bandCutsOf,
  edgeLenOf,
  uncoveredInHouse,
  qtyOf,
  fmtMeters,
} from './work-order.js';
import { itemsFor } from '../work/check-items.js';
import { partIdOf, moduleNameOf, DEFAULT_PROCESSING, pieceBaseId } from '../work-order-data.js';

/** 이 문서가 새 판인가 (발행 때 고정) */
export const isLayoutV2 = (ctx) => Number(ctx && ctx.layoutVersion) >= 2;

/** 경첩 컵 — 도어 끝에서 컵 가운데까지 · 컵 지름 (그림용 — 발주서 앞모습 그림과 같은 값) */
const CUP_INSET = 22;
const CUP_D = 35;

const V2_CSS = `<style>
.v2-sum { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: 10pt; }
.v2-sum th, .v2-sum td { border: 0.4pt solid #000; padding: 3pt 5pt; }
.v2-sum th { background: #eee; }
.v2-sum td.num, .v2-sum th.num { text-align: right; font-variant-numeric: tabular-nums; }
.v2-sheet-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4pt 10pt; font-size: 10.5pt; border-bottom: 1pt solid #000; padding-bottom: 2pt; margin-bottom: 4pt; }
.v2-sheet-head b { font-size: 12pt; }
.v2-sheet-head .checks { margin-left: auto; font-size: 10pt; letter-spacing: .4pt; }
.v2-sheet-svg { text-align: center; }
.v2-sheet-svg svg { display: inline-block; width: auto; height: auto; max-width: 100%; max-height: 236mm; }
.v2-legend { font-size: 8.5pt; color: #444; margin: 2pt 0 6pt; }
.v2-band svg { display: block; width: 100%; height: auto; margin: 2pt 0 6pt; }
</style>`;

// ── 재단선 — 톱이 끝까지 지나가는 자리 ─────────────────────────────

/**
 * 조각 네모만 보고 톱이 처음부터 끝까지 지나가는 자리를 찾는다 (위 → 아래로 나누어 가며).
 *   rects [{x, y, w, h}] (원장 좌표) · box = 나눌 영역. 같은 판이면 늘 같은 선이 나온다. 선은 조각 사이 틈 가운데.
 * @returns {{x1:number, y1:number, x2:number, y2:number}[]}
 */
export function guillotineCuts(rects, box, depth = 0) {
  const inside = rects.filter((r) => r.x >= box.x - 0.5 && r.y >= box.y - 0.5 && r.x + r.w <= box.x + box.w + 0.5 && r.y + r.h <= box.y + box.h + 0.5);
  if (inside.length < 2 || depth > 12) return [];
  const tryAxis = (vertical) => {
    const ends = [...new Set(inside.map((r) => (vertical ? r.x + r.w : r.y + r.h)))].sort((a, b) => a - b);
    for (const e of ends) {
      const before = inside.filter((r) => (vertical ? r.x + r.w : r.y + r.h) <= e + 0.5);
      const after = inside.filter((r) => (vertical ? r.x : r.y) >= e - 0.5);
      if (!before.length || !after.length || before.length + after.length !== inside.length) continue;
      const next = Math.min(...after.map((r) => (vertical ? r.x : r.y)));
      const at = (e + next) / 2;
      const line = vertical ? { x1: at, y1: box.y, x2: at, y2: box.y + box.h } : { x1: box.x, y1: at, x2: box.x + box.w, y2: at };
      const a = vertical ? { x: box.x, y: box.y, w: at - box.x, h: box.h } : { x: box.x, y: box.y, w: box.w, h: at - box.y };
      const b = vertical ? { x: at, y: box.y, w: box.x + box.w - at, h: box.h } : { x: box.x, y: at, w: box.w, h: box.y + box.h - at };
      return [line, ...guillotineCuts(before, a, depth + 1), ...guillotineCuts(after, b, depth + 1)];
    }
    return null;
  };
  return tryAxis(true) || tryAxis(false) || [];
}

// ── 원장 그림 ─────────────────────────────────────────────────────

/** 조각의 원장 위 네모 (눕힘이면 가로 · 세로가 바뀐다) */
const rectOf = (p) => {
  const w = Number(p.rot ? p.h : p.w) || 0;
  const h = Number(p.rot ? p.w : p.h) || 0;
  return { x: Number(p.x) || 0, y: Number(p.y) || 0, w, h };
};

/**
 * 원장 한 장 그림 — 크게, 조각 안에 번호 · 모듈 · 부품 · 치수 · 엣지 · 보링, 재단선 옅게.
 * @param {object} sheet 재단 배치의 원장 (재단기 화면 방향으로 돌린 것)
 * @param {(p:object)=>{no?:number|null, title?:string, w:number, h:number, edges?:object, edgeT?:number, cups?:{positions:number[], side:string|null}|null}|null} infoOf
 */
export function bigSheetSvg(sheet, infoOf) {
  const W = Number(sheet.size && sheet.size.w) || 0;
  const H = Number(sheet.size && sheet.size.h) || 0;
  if (W <= 0 || H <= 0) return '';
  const trim = Number.isFinite(Number(sheet.trim)) ? Number(sheet.trim) : 10;
  const parts = Array.isArray(sheet.parts) ? sheet.parts : [];
  const unit = Math.max(W, H) / 2440;        // 원장 크기에 맞춘 그림 단위 (2440 원장 = 1)
  const line = 3 * unit;                      // 조각 외곽선
  const ew = 11 * unit;                       // 엣지 굵기
  // 엣지 표시 — 외곽선에서 안으로 물리고(2026-11-20 사장님 「외곽변에서 더 안쪽으로 띄워주고」) 변 가운데 70% 만 (「변의 70% 길이 정도」 — 모서리에서 끊겨 보인다)
  const inset = 34 * unit;                    // 엣지를 외곽선에서 안으로 물리는 값 (좁은 조각은 짧은 변의 18% 까지)
  const EDGE_SPAN = 0.7;                      // 엣지 선 길이 = 변 길이 × 0.7, 가운데
  const rects = parts.map((p) => ({ p, r: rectOf(p) })).filter(({ r }) => r.w > 0 && r.h > 0);
  const cuts = guillotineCuts(rects.map(({ r }) => r), { x: trim, y: trim, w: W - trim * 2, h: H - trim * 2 });

  const edgeSegs = (r, sides, double) => {
    const base = Math.min(inset, Math.min(r.w, r.h) * 0.18);
    const offs = double ? [base, base + ew * 1.3] : [base];
    const sw = double ? ew * 0.6 : ew;
    const mw = (r.w * (1 - EDGE_SPAN)) / 2;   // 가로 변 양끝에서 비우는 길이
    const mh = (r.h * (1 - EDGE_SPAN)) / 2;   // 세로 변 양끝에서 비우는 길이
    const out = [];
    for (const o of offs) {
      if (sides.T) out.push([r.x + mw, r.y + o, r.x + r.w - mw, r.y + o]);
      if (sides.B) out.push([r.x + mw, r.y + r.h - o, r.x + r.w - mw, r.y + r.h - o]);
      if (sides.L) out.push([r.x + o, r.y + mh, r.x + o, r.y + r.h - mh]);
      if (sides.R) out.push([r.x + r.w - o, r.y + mh, r.x + r.w - o, r.y + r.h - mh]);
    }
    return out.map(([x1, y1, x2, y2]) => `<line class="edge-mark" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#000" stroke-width="${sw.toFixed(1)}" stroke-linecap="butt"/>`).join('');
  };

  /** 도어 경첩 컵 — 도어 자리(u 가로 · v 세로, 도어 왼쪽 위 기준)를 원장 그림 자리로 */
  const cupMarks = (p, r, cups) => {
    if (!cups || !Array.isArray(cups.positions) || !cups.positions.length) return '';
    const flap = cups.side === 'top';
    const at = (u, v) => (p.rot ? [r.x + r.w - v, r.y + u] : [r.x + u, r.y + v]);
    const rad = (CUP_D / 2) * Math.max(unit, 0.6);
    return cups.positions.map((pos) => {
      const n = Number(pos);
      if (!Number.isFinite(n)) return '';
      const [cx, cy] = flap ? at(n, CUP_INSET) : at(CUP_INSET, n);
      return `<circle class="cup" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="#fff" stroke="#1d4f91" stroke-width="${(4 * unit).toFixed(1)}"/>`;
    }).join('');
  };

  const textOf = (r, info) => {
    const dims = `${num(info.w)} × ${num(info.h)}`;
    const title = String(info.title || '');
    const vertical = r.h > r.w * 1.6 && r.w < 330 * unit;
    const span = vertical ? r.h : r.w;
    const across = vertical ? r.w : r.h;
    const fsDims = Math.max(18 * unit, Math.min(58 * unit, span / (dims.length * 0.62), across * 0.3));
    const fsTitle = Math.max(15 * unit, Math.min(40 * unit, fsDims * 0.72));
    const lines = [];
    const fits = (t, fs) => t.length * fs * 0.62 <= span - inset * 2;
    if (title && across >= (fsDims + fsTitle) * 1.35 && fits(title, fsTitle)) lines.push({ t: title, fs: fsTitle, w: 400 });
    if (fits(dims, fsDims) && across >= fsDims * 1.1) lines.push({ t: dims, fs: fsDims, w: 700 });
    if (!lines.length) return '';
    const total = lines.reduce((s, l) => s + l.fs * 1.15, 0);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    let off = -total / 2;
    const body = lines.map((l) => {
      off += l.fs * 1.15;
      const y = off - l.fs * 0.28;
      return `<text x="0" y="${y.toFixed(1)}" font-size="${l.fs.toFixed(1)}" font-weight="${l.w}" text-anchor="middle">${esc(l.t)}</text>`;
    }).join('');
    return `<g transform="translate(${cx.toFixed(1)} ${cy.toFixed(1)})${vertical ? ' rotate(-90)' : ''}">${body}</g>`;
  };

  const pieces = rects.map(({ p, r }) => {
    const info = infoOf(p) || { w: p.w, h: p.h };
    const sides = drawnEdges(info.edges || {}, p.rot);
    const marks = info.edges ? edgeSegs(r, sides, Number(info.edgeT) >= 1) : '';
    const fsNo = Math.max(18 * unit, Math.min(34 * unit, Math.min(r.w, r.h) * 0.22));
    const no = info.no != null && r.w >= fsNo * 2 && r.h >= fsNo * 1.6
      ? `<text x="${(r.x + inset + ew + 6 * unit).toFixed(1)}" y="${(r.y + inset + ew + fsNo).toFixed(1)}" font-size="${fsNo.toFixed(1)}" font-weight="700">${num(info.no)}</text>`
      : '';
    return `<g><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="#fff" stroke="#000" stroke-width="${line.toFixed(1)}"/>${marks}${cupMarks(p, r, info.cups)}${textOf(r, info)}${no}${p.rot ? `<text x="${(r.x + r.w - 30 * unit).toFixed(1)}" y="${(r.y + 34 * unit).toFixed(1)}" font-size="${(26 * unit).toFixed(1)}" fill="#666">↻</text>` : ''}</g>`;
  }).join('');
  // 재단선은 원장 밖까지 조금 내어 그린다 (조각 외곽선과 겹친 자리에서도 톱 자리가 보이게)
  const pad = 34 * unit;
  const ext = (c) => (c.x1 === c.x2 ? { x1: c.x1, y1: c.y1 <= trim + 0.5 ? -pad * 0.8 : c.y1, x2: c.x2, y2: c.y2 >= H - trim - 0.5 ? H + pad * 0.8 : c.y2 } : { x1: c.x1 <= trim + 0.5 ? -pad * 0.8 : c.x1, y1: c.y1, x2: c.x2 >= W - trim - 0.5 ? W + pad * 0.8 : c.x2, y2: c.y2 });
  const cutLines = cuts.map(ext).map((c) => `<line class="cut-line" x1="${c.x1.toFixed(1)}" y1="${c.y1.toFixed(1)}" x2="${c.x2.toFixed(1)}" y2="${c.y2.toFixed(1)}" stroke="#8c8c8c" stroke-width="${(3 * unit).toFixed(1)}" stroke-dasharray="${(16 * unit).toFixed(1)} ${(10 * unit).toFixed(1)}"/>`).join('');
  return `<svg viewBox="${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}" width="${W + pad * 2}" height="${H + pad * 2}" xmlns="http://www.w3.org/2000/svg" font-family="'Malgun Gothic', 'Pretendard', sans-serif">`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="#ececec" stroke="#000" stroke-width="${line.toFixed(1)}"/>`
    + `<rect x="${trim}" y="${trim}" width="${Math.max(0, W - trim * 2)}" height="${Math.max(0, H - trim * 2)}" fill="#f7f7f7"/>`
    + pieces + cutLines + '</svg>';
}

// ── 조각 정보 · 원장 묶음 ──────────────────────────────────────────

/** 「#3」 처럼 모듈 번호만 (없으면 모듈 짧은 이름) */
function moduleTagOf(m) {
  const label = String((m && m.module) || '');
  const hit = label.match(/#\s*\d+/);
  if (hit) return hit[0].replace(/\s+/g, '');
  const name = moduleNameOf(label) || label;
  return name.length > 8 ? name.slice(0, 8) : name;
}

/** 원장 그림 조각 정보 — 자재 행 · 라벨 번호 · 보링 (도어) */
function pieceInfoOf(ctx, boringById) {
  return (p) => {
    const m = rowOfPiece(ctx, p);
    const no = ctx.labelNo.get(p.partId) || null;
    if (!m) return { no, title: String(p.part || ''), w: p.w, h: p.h };
    const tag = moduleTagOf(m);
    const pid = pieceBaseId(p.partId);
    const b = boringById ? boringById.get(pid) : null;
    return {
      no,
      title: `${tag ? `${tag} ` : ''}${m.part || p.part || ''}`.trim(),
      w: Number(m.w) || p.w,
      h: Number(m.h) || p.h,
      edges: rowEdges(m),
      edgeT: m.edgeT,
      cups: b ? { positions: b.positions, side: b.side } : null,
    };
  };
}

/** 보링 행 → 부재 ID 마다 (도어) */
function boringMapOf(ctx) {
  const out = new Map();
  for (const b of boringRows(ctx.materials, ctx.hardware)) if (b.partId) out.set(b.partId, b);
  return out;
}

/** 원장들을 묶음(자재 · 두께 · 구분 · 색)으로 — 묶음마다 원장 수 · 조각 수 · 엣지 길이(두께마다) */
function sheetGroupsOf(ctx, sheets) {
  const groups = [];
  for (const s of sheets) {
    const key = `${s.material || ''}|${s.thickness ?? ''}|${s.partClass || ''}|${s.color || ''}`;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, material: s.material, thickness: s.thickness, partClass: s.partClass, color: s.color || '', sheets: [], pieces: 0, edge: new Map() }; groups.push(g); }
    g.sheets.push(s);
    for (const p of Array.isArray(s.parts) ? s.parts : []) {
      g.pieces += 1;
      const m = rowOfPiece(ctx, p);
      if (!m) continue;
      const mm = edgeLenOf(m);
      if (mm > 0) {
        const t = (Number(m.edgeT) || 0.6).toFixed(1);
        g.edge.set(t, (g.edge.get(t) || 0) + mm);
      }
    }
  }
  return groups;
}

/** 원장 내용 집계 표 — 자재 · 두께 · 구분 · 색상 · 원장 수 · 조각 · 엣지 길이 (두께마다) */
function summaryTable(groups, { colorLabel = (c) => esc(c) } = {}) {
  if (!groups.length) return '';
  const ts = [...new Set(groups.flatMap((g) => [...g.edge.keys()]))].sort();
  const head = ['자재', '두께', '구분', '색상', '원장', '조각', ...ts.map((t) => `엣지 ${t}`)];
  const cls = ['', 'num', '', '', 'num', 'num', ...ts.map(() => 'num')];
  const rows = groups.map((g) => tr([esc(g.material || ''), `${num(g.thickness)}T`, esc(g.partClass || ''), g.color ? colorLabel(g.color) : '<span class="muted">—</span>', `${num(g.sheets.length)}장`, num(g.pieces), ...ts.map((t) => (g.edge.get(t) ? fmtMeters(g.edge.get(t)) : '—'))], cls)).join('');
  const sum = (f) => groups.reduce((s, g) => s + f(g), 0);
  const foot = tr(['<b>합계</b>', '', '', '', `<b>${num(sum((g) => g.sheets.length))}장</b>`, `<b>${num(sum((g) => g.pieces))}</b>`, ...ts.map((t) => `<b>${fmtMeters(sum((g) => g.edge.get(t) || 0))}</b>`)], cls);
  return `<table class="v2-sum">${thead(head, cls)}<tbody>${rows}${groups.length > 1 ? foot : ''}</tbody></table>`;
}

/** 원장 한 쪽 — 머리(번호 · 자재 · 색 · 재단기 파일 · 확인 칸) + 큰 그림 */
function sheetPage(ctx, raw, info, { checks = true } = {}) {
  const cnc = cncOf(ctx, raw);
  const sheet = screenSheetOf(raw, cnc.file);
  const parts = Array.isArray(sheet.parts) ? sheet.parts : [];
  const file = cnc.file ? ` · 재단기 파일 <b class="mono">${esc(cnc.file.name)}</b> · 길이 ${num(cnc.file.length)} × 넓이 ${num(cnc.file.width)} · 선재단 ${num(cnc.file.lead)}` : cnc.problem ? ` · <span class="warn">재단기 파일 없음 — ${esc(cnc.problem.reason || '')}</span>` : '';
  const checkLine = checks ? `<span class="checks">${itemsFor(ctx.checkList, 'cut', 'sheet').map((x) => `${esc(x.short || x.label)} ☐`).join(' ')}</span>` : '';
  return `
<div class="sheet">
  <div class="v2-sheet-head"><b>원장 #${num(sheet.no)}</b> ${esc(sheet.material || '')} ${num(sheet.thickness)}T · ${esc(sheet.partClass || '')}${sheet.color ? ` · ${esc(sheet.color)}` : ''} · ${num(sheet.size && sheet.size.w)} × ${num(sheet.size && sheet.size.h)} · 조각 ${num(parts.length)}${file}${checkLine}</div>
  <div class="v2-sheet-svg">${bigSheetSvg(sheet, info)}</div>
</div>`;
}

const LEGEND = '<div class="v2-legend">조각 안 굵은 선 = 엣지 붙일 변 (한 줄 0.6 · 두 줄 1.0) · 굵은 숫자 = 가로 × 세로 (부재 기준) · 왼쪽 위 번호 = 라벨 번호 · 「#n」 = 모듈 번호 · 파란 원 = 경첩 컵 · 옅은 점선 = 재단선 · ↻ = 눕혀 놓음</div>';

/** 재고 밴드 본 그림 (2026-11-20 — 플래너 재단 탭 그림과 같은 모양) */
function bandStripsHtml(ctx, plan) {
  const bs = plan && plan.bandStock && typeof plan.bandStock === 'object' ? plan.bandStock : null;
  if (!bs) return '';
  const cuts = bandCutsOf(plan).map((c) => ({ ...c, pieces: c.pieces.filter((p) => { const m = rowOfPiece(ctx, p); return m ? routeOf(ctx, m) === 'in' : true; }) })).filter((c) => c.pieces.length);
  if (!cuts.length) return '';
  const L = Number(bs.length) || 2440;
  const kerf = Number(bs.kerf) || 0;
  const strip = (c) => {
    const k = 1000 / L;
    let x = 0;
    const g = c.pieces.map((p, i) => {
      const w = (Number(p.len) || 0) * k;
      const no = ctx.labelNo.get(p.partId);
      const m = rowOfPiece(ctx, p);
      const tag = m ? moduleTagOf(m) : '';
      const s = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="40" fill="#fff" stroke="#000" stroke-width="1"/><text x="${(x + w / 2).toFixed(1)}" y="17" font-size="11" text-anchor="middle">${no ? `${num(no)} · ` : ''}${esc(`${tag} ${p.part || ''}`.trim())}</text><text x="${(x + w / 2).toFixed(1)}" y="33" font-size="12" font-weight="700" text-anchor="middle">${num(p.len)}</text>`;
      x += w + (i < c.pieces.length - 1 ? kerf * k : 0);
      return s;
    }).join('');
    const rest = L - (Number(c.used) || 0);
    const restEl = rest > 0 ? `<rect x="${(1000 - rest * k).toFixed(1)}" y="0" width="${(rest * k).toFixed(1)}" height="40" fill="#eee" stroke="#999" stroke-dasharray="4 3"/><text x="${(1000 - (rest * k) / 2).toFixed(1)}" y="25" font-size="11" text-anchor="middle" fill="#555">남음 ${num(Math.round(rest))}</text>` : '';
    return `<div class="muted">${esc(c.color || '색 없음')} ${num(c.no)} · ${num(c.used)} / ${num(L)}</div><svg viewBox="0 0 1000 40" xmlns="http://www.w3.org/2000/svg" font-family="'Malgun Gothic', sans-serif">${g}${restEl}</svg>`;
  };
  return `<div class="sheet v2-band"><div class="section-title">밴드 재고에서 꺼낼 것 <span class="muted">${esc(bs.material || '')} ${num(bs.thickness)}T · ${num(bs.width)} × ${num(L)} 본 — 원장에서 켜지 않는다</span></div>${cuts.map(strip).join('')}</div>`;
}

/** 머리 — 제목 · 문서 · 설계 · 원장 내용 집계 */
function headV2(ctx, title, who, summary, extra = '') {
  const { doc } = ctx;
  return `
<div class="doc-header">
  <div><h1>${esc(title)}</h1><div>${esc(who)}</div></div>
  <div class="doc-meta"><div class="doc-no">${esc(doc.doc_no)}</div><div>Rev. ${esc(doc.rev)}</div></div>
</div>
${extra}
<div class="section-title">원장 내용</div>
${summary}`;
}

// ── 재단 · 엣지 지시서 ─────────────────────────────────────────────

/** 재단 꾸러미 새 판 — 사내에서 자르는 원장(도어재를 내수로 하면 도어 원장도)만, 도어재 외주 원장은 발주서에만 */
export function cutPackV2(ctx, { vendor = false } = {}) {
  const plan = ctx.cutPlan;
  const counts = workCounts(ctx);
  const doorIn = (ctx.processing || DEFAULT_PROCESSING).door === 'in';
  const boringById = doorIn ? boringMapOf(ctx) : null;
  const info = pieceInfoOf(ctx, boringById);
  const designLine = vendor ? '' : `<dl class="kv"><dt>설계</dt><dd>${esc(ctx.worker ? ctx.worker.orderLabel : ctx.doc.title)} · 설계 rev ${esc(ctx.snapshot.rev)}</dd>${plan ? `<dt>톱날 · 여백</dt><dd>${num(plan.kerf)} · ${num(plan.trim)}</dd>` : ''}</dl>`;
  const notes = vendor ? '' : `${specialNotesBox(ctx.specialNotes, ['cut'])}${ctx.doc.render_payload && ctx.doc.render_payload.instructions ? `<div class="section-title">특기사항</div><div class="note">${esc(ctx.doc.render_payload.instructions)}</div>` : ''}`;
  const title = vendor ? '재단·엣지 의뢰서' : '재단·엣지 지시서';
  if (!plan) {
    const inHouse = ctx.materials.map((row, index) => ({ row, index })).filter(({ row }) => routeOf(ctx, row) === 'in');
    return `${V2_CSS}<div class="sheet">${headV2(ctx, title, vendor ? '재단·엣지 외주처' : '재단 기사', '<div class="warn">재단 배치 없음 — 자재 목록만 싣는다 (플래너에서 다시 보내 주세요).</div>', designLine)}${notes}${inHouse.length ? flatMaterialTable(ctx, inHouse) : ''}</div>`;
  }
  const sheets = counts.inHouseSheets || [];
  const groups = sheetGroupsOf(ctx, sheets);
  const doorNote = !vendor && !doorIn && counts.doorRows.length ? `<div class="muted">도어재 ${num(counts.doorRows.reduce((s, m) => s + qtyOf(m), 0))}장${counts.doorSheets ? ` (원장 ${num(counts.doorSheets.length)}장)` : ''} 은 외주 — 도어재 발주서.</div>` : '';
  // 재단 외주로 가는 판 · 원장에 못 놓은 부재 · 배치에 없는 부재 — 목록으로 (그림이 없다)
  const outsourced = ctx.materials.map((row, index) => ({ row, index })).filter(({ row }) => routeOf(ctx, row) === 'cut');
  const unalloc = (Array.isArray(plan.unallocated) ? plan.unallocated : []).filter((u) => (Array.isArray(u.partIds) ? u.partIds : []).some((id) => { const m = rowOfPiece(ctx, { partId: id }); return m ? routeOf(ctx, m) === 'in' : false; }));
  const smalls = (Array.isArray(plan.smallParts) ? plan.smallParts : []).filter((s) => { const hit = ctx.rowById.get(s.partId); return hit ? routeOf(ctx, hit.row) === 'in' : false; });
  const missing = uncoveredInHouse(ctx.materials, plan, ctx.processing || DEFAULT_PROCESSING);
  const lists = [
    smalls.length ? `<div class="sub-title">소부품 (원장 밖)</div><table class="compact">${thead(['라벨', '모듈 · 부품', '자재', 'w × h', '수량'], ['num', '', '', 'num', 'num'])}<tbody>${smalls.map((s) => { const hit = ctx.rowById.get(s.partId); return tr([pieceLabelText(ctx, [s.partId], qtyOf(s)), esc(`${hit ? moduleTagOf(hit.row) : ''} ${s.part || ''}`.trim()), `${esc(s.material || '')} ${num(s.thickness)}T`, `${num(s.w)} × ${num(s.h)}`, num(s.qty)], ['num', '', '', 'num', 'num']); }).join('')}</tbody></table>` : '',
    unalloc.length ? `<div class="sub-title">원장보다 큰 부재 — 따로 재단</div><table class="compact">${thead(['라벨', '부품', '자재', 'w × h', '수량'], ['num', '', '', 'num', 'num'])}<tbody>${unalloc.map((u) => tr([pieceLabelText(ctx, u.partIds || []), esc((u.parts || []).join(', ')), `${esc(u.material || '')} ${num(u.thickness)}T`, `${num(u.w)} × ${num(u.h)}`, num(u.qty)], ['num', '', '', 'num', 'num'])).join('')}</tbody></table>` : '',
    outsourced.length ? `<div class="sub-title">재단 외주 <span class="muted">사내에서 자르지 않는다 · 입고 후 사내 조립</span></div>${flatMaterialTable(ctx, outsourced)}` : '',
    missing.length ? `<div class="sub-title">배치에 없는 부재</div><div class="warn">재단 배치와 자재표가 어긋난다 — 아래 부재는 목록대로 따로 재단.</div>${flatMaterialTable(ctx, missing.map(({ row, index, missing: ks }) => ({ row: { ...row, qty: ks.length }, index, ks })))}` : '',
  ].join('');
  const first = `
<div class="sheet">
  ${headV2(ctx, title, vendor ? '재단·엣지 외주처' : '재단 기사 — 원장 그림대로 자르고 굵은 선 변에 엣지', summaryTable(groups), designLine)}
  ${doorNote}${notes}${vendor ? '' : orderChecksBlock(ctx, 'cut')}
  ${LEGEND}
  ${lists}
</div>`;
  const pages = groups.flatMap((g) => g.sheets.map((s) => sheetPage(ctx, s, info, { checks: !vendor }))).join('');
  return `${V2_CSS}${first}${pages}${vendor ? '' : bandStripsHtml(ctx, plan)}`;
}

// ── 도어재 발주서 ─────────────────────────────────────────────────

/** 도어재 발주서 새 판 — 재단 지시서와 같은 형식 (원장 내용 · 원장 그림에 치수 · 엣지 · 경첩 컵). 도어재를 내수로 하면 발주가 없다 */
export function doorPackV2(ctx) {
  const counts = workCounts(ctx);
  const rows = ctx.materials.map((row, index) => ({ row, index })).filter(({ row }) => routeOf(ctx, row) === 'door');
  const title = '도어재 발주서';
  if (!rows.length) {
    const inHouse = (ctx.processing || DEFAULT_PROCESSING).door === 'in';
    return `${V2_CSS}<div class="sheet"><div class="section-title">${title}</div><div class="muted">${inHouse ? '도어재 발주 없음 — 내수가공 (재단 지시서의 원장)' : '도어재 부재 없음'}</div></div>`;
  }
  const boringById = boringMapOf(ctx);
  const orphans = boringRows(ctx.materials, ctx.hardware).filter((b) => !b.partId);
  const sheets = counts.doorSheets || [];
  const groups = sheetGroupsOf(ctx, sheets);
  const colorLabel = (code) => {
    const s = ctx.swatchByCode.get(code);
    return `${swatchChip(ctx, code)} ${esc((s && s.color_name) || code)}${s && s.vendor_code ? ` · 발주 코드 <span class="mono">${esc(s.vendor_code)}</span>` : ''}`;
  };
  const pieces = rows.reduce((s, { row }) => s + qtyOf(row), 0);
  const meta = `<dl class="kv"><dt>도어</dt><dd>${num(counts.doors)}짝 · 서랍 앞판 ${num(counts.drawers)}</dd><dt>도어재 부재</dt><dd>${num(rows.length)}종 · ${num(pieces)}장</dd></dl>`;
  const orphanBlock = orphans.length
    ? `<div class="sub-title">도어 행을 못 찾은 경첩</div><div class="warn">아래 모듈의 도어는 직접 맞춰 주세요.</div><table class="compact">${thead(['품목', '모듈', '도어 H', '구 수', '컵 위치 (mm)'], ['', '', 'num', 'num', ''])}<tbody>${orphans.map((b) => tr([esc(b.itemLabel), esc(b.moduleName), num(b.doorH), num(b.count), esc(b.positions.join(', '))], ['', '', 'num', 'num', ''])).join('')}</tbody></table>`
    : '';
  // 원장에 없는 도어재 (배치가 없거나 원장 밖 — 몰딩 등 긴 부재) — 목록으로
  const onSheets = new Set(sheets.flatMap((s) => (s.parts || []).map((p) => pieceBaseId(p.partId))));
  const loose = rows.filter(({ row, index }) => !onSheets.has(partIdOf(row, index)));
  const looseBlock = loose.length ? `<div class="sub-title">원장 밖 도어재</div>${flatMaterialTable(ctx, loose)}` : '';
  const first = `
<div class="sheet">
  ${headV2(ctx, title, '도어 외주처 — 원장 그림대로 재단 · 엣지 · 경첩 컵 보링', groups.length ? summaryTable(groups, { colorLabel }) : '<div class="muted">재단 배치 없음</div>', meta)}
  ${specialNotesBox(ctx.specialNotes, ['door'])}
  ${LEGEND}
  ${orphanBlock}${looseBlock}
</div>`;
  const info = pieceInfoOf(ctx, boringById);
  const pages = groups.flatMap((g) => g.sheets.map((s) => sheetPage(ctx, s, info, { checks: false }))).join('');
  return `${V2_CSS}${first}${pages}`;
}

