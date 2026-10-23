/**
 * 판재 도면 (CAD 베타 PR17) — 재단 묶음(?pack=cut · all)에 따내기 · 홈이 있는 판재를 SVG 로 그린다.
 *
 * 입력은 동결된 조립 명세 `snapshot.bom_payload.assembly` (dadam.assembly/1, js/detaildesign/bom-assembly.js) 뿐이다.
 * 워커는 명세를 다시 계산하지 않는다 (snapshots.js 헤더 원칙). 명세가 없는 옛 스냅샷이면 이 쪽은 통째로 빠진다.
 *
 * 판재 좌표 (명세 frame): 재단면에서 u 로 cut.w, v 로 cut.h. 따내기(notch)는 관통 — (u0..u1 × v0..v1) 을 판에서 뺀다.
 *   홈(groove)은 깊이가 미정(결정 D5)이라 자리 · 폭만 점선으로 그리고 "깊이 미정" 을 적는다.
 *   끝 이름은 frame 축으로 — u 가 '+z' 면 u 끝이 앞, '-z' 면 뒤 (플래너 좌표: x 오른쪽 · y 위 · z 앞).
 * 같은 판(크기 · 특징 · 끝 방향이 같은 것)은 한 도면에 모아 장수를 적는다.
 * 숫자는 명세 값 그대로 — 새 규칙을 두지 않는다.
 */
import { esc, num } from './html.js';

const END_NAMES = {
  '+x': ['왼쪽', '오른쪽'], '-x': ['오른쪽', '왼쪽'],
  '+y': ['아래', '위'], '-y': ['위', '아래'],
  '+z': ['뒤', '앞'], '-z': ['앞', '뒤'],
};

const r1 = (v) => Math.round(Number(v) * 10) / 10;

/** 명세 판재 전부 (모듈 부재 + 라인 부재) */
export function specParts(assembly) {
  const out = [];
  ((assembly && assembly.items) || []).forEach((it) => {
    if (!it) return;
    (it.modules || []).forEach((m) => (m.parts || []).forEach((p) => out.push({ p, moduleKey: m.moduleKey })));
    (it.runs || []).forEach((r) => (r.parts || []).forEach((p) => out.push({ p, moduleKey: r.hostModuleKey })));
  });
  return out;
}

/** 도면에 그릴 특징 — 따내기 · 홈 (판 좌표, 0.1mm 반올림) */
export function featuresOf(p) {
  return (p.features || [])
    .filter((f) => f && (f.type === 'notch' || f.type === 'groove'))
    .map((f) => ({ type: f.type, u0: r1(f.u0), u1: r1(f.u1), v0: r1(f.v0), v1: r1(f.v1), face: f.face || null, depth: f.depth == null ? null : r1(f.depth) }))
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : a.u0 - b.u0 || a.v0 - b.v0 || a.u1 - b.u1 || a.v1 - b.v1));
}

/**
 * 판재 도면 묶음 — 따내기 · 홈이 있는 판재만, 같은 도면끼리 모은다.
 * @param {object} assembly   동결 명세
 * @param {Array} materials   BOM 자재 행 (partId · part · material · module …)
 * @param {{ include?: (row) => boolean }} [opts]  그릴 행 (재단 묶음은 사내 재단 행만)
 * @returns {Array<{ key, part, material, w, h, t, u, v, features, pieces: Array<{id, rowPartId, module}> }>}
 */
export function partDrawingGroups(assembly, materials, opts = {}) {
  const rowById = new Map((materials || []).map((m) => [String(m.partId), m]));
  const include = typeof opts.include === 'function' ? opts.include : () => true;
  const groups = new Map();
  specParts(assembly).forEach(({ p }) => {
    const feats = featuresOf(p);
    if (!feats.length) return;
    const row = rowById.get(String(p.rowPartId));
    if (!row || !include(row)) return;
    const w = r1(p.cut && p.cut.w), h = r1(p.cut && p.cut.h), t = r1(p.t);
    const u = p.frame && p.frame.u, v = p.frame && p.frame.v;
    const key = JSON.stringify([row.part || p.part, row.material || p.material, w, h, t, u, v, feats]);
    if (!groups.has(key)) groups.set(key, { key, part: row.part || p.part || '', material: row.material || p.material || '', w, h, t, u, v, features: feats, pieces: [] });
    groups.get(key).pieces.push({ id: p.id, rowPartId: p.rowPartId, module: row.module || '' });
  });
  return [...groups.values()];
}

/**
 * 판 윤곽 — 사각형에서 따내기를 뺀 경계 선분들 (격자 칸으로 판정, 따내기는 직사각형).
 * @returns {Array<[number, number, number, number]>}  [u0, v0, u1, v1]
 */
export function outlineSegments(w, h, notches) {
  const us = [...new Set([0, w].concat(...notches.map((n) => [n.u0, n.u1])))].filter((x) => x >= 0 && x <= w).sort((a, b) => a - b);
  const vs = [...new Set([0, h].concat(...notches.map((n) => [n.v0, n.v1])))].filter((x) => x >= 0 && x <= h).sort((a, b) => a - b);
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= us.length - 1 || j >= vs.length - 1) return false;
    const cu = (us[i] + us[i + 1]) / 2, cv = (vs[j] + vs[j + 1]) / 2;
    return !notches.some((n) => cu > n.u0 && cu < n.u1 && cv > n.v0 && cv < n.v1);
  };
  const segs = [];
  for (let i = 0; i < us.length - 1; i++) {
    for (let j = 0; j < vs.length - 1; j++) {
      if (!inside(i, j)) continue;
      if (!inside(i - 1, j)) segs.push([us[i], vs[j], us[i], vs[j + 1]]);
      if (!inside(i + 1, j)) segs.push([us[i + 1], vs[j], us[i + 1], vs[j + 1]]);
      if (!inside(i, j - 1)) segs.push([us[i], vs[j], us[i + 1], vs[j]]);
      if (!inside(i, j + 1)) segs.push([us[i], vs[j + 1], us[i + 1], vs[j + 1]]);
    }
  }
  return segs;
}

/** 특징 하나의 설명 — 크기와 가까운 끝에서의 자리 */
export function featureLabel(f, g) {
  const fw = r1(f.u1 - f.u0), fh = r1(f.v1 - f.v0);
  const [uLo, uHi] = END_NAMES[g.u] || ['u 0', 'u 끝'];
  const [vLo, vHi] = END_NAMES[g.v] || ['v 0', 'v 끝'];
  const at = [];
  if (f.u0 > 0 && f.u1 < g.w) at.push(f.u0 <= g.w - f.u1 ? `${uLo}에서 ${num(f.u0)}` : `${uHi}에서 ${num(r1(g.w - f.u1))}`);
  else at.push(f.u0 <= 0 ? `${uLo} 끝` : `${uHi} 끝`);
  if (f.v0 > 0 && f.v1 < g.h) at.push(f.v0 <= g.h - f.v1 ? `${vLo}에서 ${num(f.v0)}` : `${vHi}에서 ${num(r1(g.h - f.v1))}`);
  else at.push(f.v0 <= 0 ? `${vLo} 끝` : `${vHi} 끝`);
  if (f.type === 'notch') return `따내기 ${num(fw)} × ${num(fh)} (${at.join(' · ')})`;
  const face = f.face === 'inner' ? '안쪽 면' : f.face ? esc(f.face) : '';
  const width = Math.min(fw, fh);
  return `홈 폭 ${num(width)} (${at.join(' · ')})${face ? ` · ${face}` : ''} · 깊이 ${f.depth == null ? '미정 (D5)' : num(f.depth)}`;
}

/** 판재 도면 한 장 (SVG). 판 좌표 v 는 위로, SVG y 는 아래로 — 뒤집어 그린다. */
export function partDrawingSvg(g) {
  const W = 360, H = 220, M = 34;
  const s = Math.min((W - 2 * M) / g.w, (H - 2 * M) / g.h);
  const ox = (W - g.w * s) / 2, oy = (H - g.h * s) / 2;
  const X = (u) => r1(ox + u * s), Y = (v) => r1(oy + (g.h - v) * s);
  const notches = g.features.filter((f) => f.type === 'notch');
  const grooves = g.features.filter((f) => f.type === 'groove');
  const lines = outlineSegments(g.w, g.h, notches)
    .map(([u0, v0, u1, v1]) => `<line x1="${X(u0)}" y1="${Y(v0)}" x2="${X(u1)}" y2="${Y(v1)}"/>`).join('');
  const notchMarks = notches.map((f, i) => {
    const x = X(f.u0), y = Y(f.v1), w = r1((f.u1 - f.u0) * s), h = r1((f.v1 - f.v0) * s);
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="pd-notch"/><text x="${r1(x + w / 2)}" y="${r1(y + h / 2 + 3)}" class="pd-tag">${i + 1}</text>`;
  }).join('');
  const grooveMarks = grooves.map((f, i) => {
    const x = X(f.u0), y = Y(f.v1), w = Math.max(1, r1((f.u1 - f.u0) * s)), h = Math.max(1, r1((f.v1 - f.v0) * s));
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="pd-groove"/><text x="${r1(x + w / 2 + 4)}" y="${r1(oy + 10)}" class="pd-tag">${String.fromCharCode(65 + i)}</text>`;
  }).join('');
  const [uLo, uHi] = END_NAMES[g.u] || ['', ''];
  const [vLo, vHi] = END_NAMES[g.v] || ['', ''];
  const bx = ox, by = oy + g.h * s, rx = ox + g.w * s;
  const dims = `
    <line x1="${r1(bx)}" y1="${r1(by + 12)}" x2="${r1(rx)}" y2="${r1(by + 12)}" class="pd-dim"/>
    <text x="${r1((bx + rx) / 2)}" y="${r1(by + 24)}" class="pd-num">${num(g.w)}</text>
    <line x1="${r1(ox - 12)}" y1="${r1(oy)}" x2="${r1(ox - 12)}" y2="${r1(by)}" class="pd-dim"/>
    <text x="${r1(ox - 16)}" y="${r1((oy + by) / 2)}" class="pd-num" transform="rotate(-90 ${r1(ox - 16)} ${r1((oy + by) / 2)})">${num(g.h)}</text>
    <text x="${r1(bx)}" y="${r1(by + 24)}" class="pd-end" text-anchor="start">${esc(uLo)}</text>
    <text x="${r1(rx)}" y="${r1(by + 24)}" class="pd-end" text-anchor="end">${esc(uHi)}</text>
    <text x="${r1(rx + 4)}" y="${r1(oy + 8)}" class="pd-end" text-anchor="start">${esc(vHi)}</text>
    <text x="${r1(rx + 4)}" y="${r1(by)}" class="pd-end" text-anchor="start">${esc(vLo)}</text>`;
  return `<svg class="part-drawing" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(g.part)} ${num(g.w)}×${num(g.h)}">
  <g class="pd-outline">${lines}</g>${notchMarks}${grooveMarks}${dims}
</svg>`;
}

export const PART_DRAWING_CSS = `
.part-drawings { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt 10pt; }
.part-drawing-card { border: 0.6pt solid #000; padding: 3pt 4pt; break-inside: avoid; page-break-inside: avoid; }
.part-drawing-card .pd-title { font-weight: 700; font-size: 9pt; }
.part-drawing-card .pd-meta { font-size: 7.5pt; color: #333; }
.part-drawing-card ol { margin: 2pt 0 0 12pt; padding: 0; font-size: 8pt; }
.part-drawing-card ol.pd-grooves { list-style-type: upper-alpha; }
svg.part-drawing { width: 100%; height: auto; display: block; }
svg.part-drawing .pd-outline line { stroke: #000; stroke-width: 1.4; }
svg.part-drawing .pd-notch { fill: none; stroke: #000; stroke-width: 0.6; stroke-dasharray: 2 2; }
svg.part-drawing .pd-groove { fill: #ddd; stroke: #000; stroke-width: 0.6; stroke-dasharray: 3 2; }
svg.part-drawing .pd-dim { stroke: #000; stroke-width: 0.5; }
svg.part-drawing text { font-family: sans-serif; }
svg.part-drawing .pd-num { font-size: 10px; text-anchor: middle; }
svg.part-drawing .pd-tag { font-size: 9px; font-weight: 700; text-anchor: middle; }
svg.part-drawing .pd-end { font-size: 8px; fill: #444; }
`;

/**
 * 판재 도면 쪽 — 명세가 없거나 그릴 판재가 없으면 '' (옛 스냅샷은 쪽 자체가 없다).
 * @param {{ assembly, materials, include?, rev?, contentHash?, title? }} o
 */
export function partDrawingsSheet(o) {
  if (!o || !o.assembly || o.assembly.schema !== 'dadam.assembly/1') return '';
  const groups = partDrawingGroups(o.assembly, o.materials, { include: o.include });
  if (!groups.length) return '';
  const stamp = `rev ${o.rev != null ? num(o.rev) : '-'} · ${esc(String(o.contentHash || '').slice(0, 12) || '-')} · 규칙 ${esc(o.assembly.rulesVersion || '-')}`;
  const pieces = groups.reduce((s, g) => s + g.pieces.length, 0);
  const cards = groups.map((g) => {
    const modules = [...new Set(g.pieces.map((x) => x.module).filter(Boolean))];
    const notchItems = g.features.filter((f) => f.type === 'notch').map((f) => `<li>${featureLabel(f, g)}</li>`).join('');
    const grooveItems = g.features.filter((f) => f.type === 'groove').map((f) => `<li>${featureLabel(f, g)}</li>`).join('');
    return `<div class="part-drawing-card">
  <div class="pd-title">${esc(g.part)} ${num(g.w)} × ${num(g.h)} · ${esc(g.material)} ${num(g.t)}T <span class="muted">× ${num(g.pieces.length)}장</span></div>
  ${partDrawingSvg(g)}
  ${notchItems ? `<ol>${notchItems}</ol>` : ''}${grooveItems ? `<ol class="pd-grooves">${grooveItems}</ol>` : ''}
  <div class="pd-meta">${esc(modules.join(' · '))}</div>
  <div class="pd-meta mono">${esc(g.pieces.map((x) => x.id).join(', '))}</div>
  <div class="pd-meta mono">${stamp}</div>
</div>`;
  }).join('');
  return `
<div class="sheet">
  <style>${PART_DRAWING_CSS}</style>
  <div class="section-title">${esc(o.title || '③-2 판재 도면')} <span class="muted">따내기 · 홈이 있는 판재 ${num(groups.length)}종 ${num(pieces)}장 — 조립 명세 그대로</span></div>
  <div class="muted">굵은 선 = 판 윤곽 · 점선 칸 = 따낸 자리(관통) · 회색 점선 = 홈 (깊이 미정 D5). 치수 mm. 끝 이름은 장에 세웠을 때 기준. ${stamp}</div>
  <div class="part-drawings">${cards}</div>
</div>`;
}
