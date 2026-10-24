/**
 * 모듈 단면도 (CAD 베타 PR17b) — 조립 묶음(?pack=assembly · all)에 모듈마다 옆 단면을 SVG 로 그린다.
 *
 * 입력은 동결된 조립 명세 `snapshot.bom_payload.assembly` (dadam.assembly/1) 뿐이다. 워커는 명세를 다시 계산하지 않는다.
 *   명세가 없는 옛 스냅샷이면 이 쪽은 통째로 빠진다.
 *
 * 자르는 면: 모듈 로컬 x = 0 (모듈 가운데, 명세 좌표는 몸통 가운데가 0 — bom-assembly.js 헤더). 왼쪽에서 본다 —
 *   가로 = z (왼쪽 뒤 → 오른쪽 앞), 세로 = y (0 = 몸통 바닥, 위로).
 *   - 면에 걸리는 판재(box 가 x = 0 을 지나는 것): 단면으로 칠하고 번호를 단다 (뒷판 · 밴드 · 처짐방지 · 선반 · 서랍통 · 목찬넬 …)
 *   - 앞판(도어 · 서랍 전면, tags.doorIdx · drawerIdx): 면에 안 걸려도 옆에서 본 윤곽을 가는 선으로
 *   - 왼쪽 측판: 면 너머 배경 — 윤곽 − 따내기, 홈은 점선 (판재 도면과 같은 특징)
 * 라인 부재(걸레받이 · 상판 · 몰딩, items[].runs)는 여러 모듈에 걸쳐 그리지 않는다 — 정면도.
 * 같은 단면(모듈 크기 · 그린 판재가 같은 것)은 한 장에 모아 모듈 이름을 적는다. 숫자는 명세 값 그대로 — 새 규칙을 두지 않는다.
 */
import { esc, num } from './html.js';
import { outlineSegments } from './part-drawing.js';

const r1 = (v) => Math.round(Number(v) * 10) / 10;
const AXIS = { x: 0, y: 1, z: 2 };

/** 판 좌표 (u, v) → 모듈 로컬 한 축 값. frame 축 이름 ('+z' …) 기준. */
function along(frame, axisName, local, coord) {
  const a = frame && frame[axisName];
  if (!a || a[1] !== coord) return null;
  const o = Number(frame.o[AXIS[coord]]);
  return a[0] === '-' ? o - local : o + local;
}

const isFront = (p) => !!p.tags && (p.tags.doorIdx != null || p.tags.drawerIdx != null);
const isCut = (p) => p.box && Number(p.box.min[0]) < 0 && Number(p.box.max[0]) > 0;
const isLeftSide = (p) => /-body:side-/.test(String(p.id || '')) && p.tags && p.tags.side === 'left';

/** 왼쪽 측판 → 옆에서 본 윤곽 + 특징 (z, y). frame u·v 가 z·y 가 아니면 사각형만. */
function sidePanelView(p) {
  const z0 = Number(p.box.min[2]), z1 = Number(p.box.max[2]), y0 = Number(p.box.min[1]), y1 = Number(p.box.max[1]);
  const feats = [];
  (p.features || []).forEach((f) => {
    if (!f || (f.type !== 'notch' && f.type !== 'groove')) return;
    const za = along(p.frame, 'u', Number(f.u0), 'z'), zb = along(p.frame, 'u', Number(f.u1), 'z');
    const ya = along(p.frame, 'v', Number(f.v0), 'y'), yb = along(p.frame, 'v', Number(f.v1), 'y');
    if ([za, zb, ya, yb].some((x) => x == null)) return;
    feats.push({ type: f.type, z0: r1(Math.min(za, zb)), z1: r1(Math.max(za, zb)), y0: r1(Math.min(ya, yb)), y1: r1(Math.max(ya, yb)) });
  });
  return { z0: r1(z0), z1: r1(z1), y0: r1(y0), y1: r1(y1), features: feats };
}

/**
 * 모듈 하나의 단면 자료.
 * @returns {{ moduleKey, kind, box, back, front, cut: Array<{part, t, z0, z1, y0, y1, id}>, fronts: Array<{z0,z1,y0,y1,part}>, sides: Array }}
 */
export function moduleSectionOf(mod, rowById) {
  const parts = (mod && mod.parts) || [];
  const partName = (p) => {
    const row = rowById.get(String(p.rowPartId));
    return (row && row.part) || p.part || '';
  };
  const rect = (p) => ({ z0: r1(p.box.min[2]), z1: r1(p.box.max[2]), y0: r1(p.box.min[1]), y1: r1(p.box.max[1]) });
  const sides = parts.filter((p) => p.box && isLeftSide(p)).map(sidePanelView);
  const cut = parts.filter((p) => p.box && !isFront(p) && isCut(p))
    .map((p) => Object.assign(rect(p), { part: partName(p), t: r1(p.t), id: p.id }))
    .sort((a, b) => a.y0 - b.y0 || a.z0 - b.z0 || (a.part < b.part ? -1 : a.part > b.part ? 1 : 0));
  const fronts = parts.filter((p) => p.box && isFront(p)).map((p) => Object.assign(rect(p), { part: partName(p) }))
    .sort((a, b) => a.y0 - b.y0 || a.z0 - b.z0);
  // 몸통 뒤 · 앞 = 측판 z 끝 (자리 글 기준). 측판이 없으면 그린 판재 전체
  const zs = sides.length ? sides : cut;
  const back = zs.length ? Math.min(...zs.map((s) => s.z0)) : 0;
  const front = zs.length ? Math.max(...zs.map((s) => s.z1)) : 0;
  return { moduleKey: mod.moduleKey, kind: mod.kind || '', box: mod.box || {}, back, front, cut, fronts, sides };
}

/** 같은 단면끼리 모은다 — 모듈 이름은 BOM 행 module. */
export function moduleSectionGroups(assembly, materials) {
  const rows = materials || [];
  const rowById = new Map(rows.map((m) => [String(m.partId), m]));
  const nameOf = new Map();
  rows.forEach((m) => { if (m.moduleKey && !nameOf.has(String(m.moduleKey))) nameOf.set(String(m.moduleKey), m.module || ''); });
  const groups = new Map();
  ((assembly && assembly.items) || []).forEach((it) => {
    if (!it) return;
    (it.modules || []).forEach((mod) => {
      const s = moduleSectionOf(mod, rowById);
      if (!s.cut.length && !s.sides.length) return;
      const strip = (x) => Object.assign({}, x, { id: undefined });
      const key = JSON.stringify([s.kind, s.box, s.cut.map(strip), s.fronts, s.sides]);
      if (!groups.has(key)) groups.set(key, Object.assign(s, { key, modules: [] }));
      groups.get(key).modules.push({ moduleKey: mod.moduleKey, name: nameOf.get(String(mod.moduleKey)) || mod.moduleKey, itemLabel: it.label || '' });
    });
  });
  return [...groups.values()];
}

/** 단면 SVG. y 는 위로, SVG 는 아래로 — 뒤집어 그린다. */
export function moduleSectionSvg(s) {
  const all = [].concat(s.cut, s.fronts, s.sides);
  const zMin = Math.min(...all.map((r) => r.z0)), zMax = Math.max(...all.map((r) => r.z1));
  const yMin = Math.min(...all.map((r) => r.y0)), yMax = Math.max(...all.map((r) => r.y1));
  const dw = Math.max(1, zMax - zMin), dh = Math.max(1, yMax - yMin);
  const H = 300, M = 30;
  const s0 = (H - 2 * M) / dh;
  const W = Math.max(160, Math.min(320, r1(dw * s0 + 2 * M + 20)));
  const sc = Math.min((W - 2 * M - 20) / dw, s0);
  const ox = M, oy = (H - dh * sc) / 2;
  const X = (z) => r1(ox + (z - zMin) * sc), Y = (y) => r1(oy + (yMax - y) * sc);
  const box = (r, cls) => `<rect x="${X(r.z0)}" y="${Y(r.y1)}" width="${Math.max(0.6, r1((r.z1 - r.z0) * sc))}" height="${Math.max(0.6, r1((r.y1 - r.y0) * sc))}" class="${cls}"/>`;
  const sides = s.sides.map((sd) => {
    const notches = sd.features.filter((f) => f.type === 'notch')
      .map((f) => ({ u0: r1(f.z0 - sd.z0), u1: r1(f.z1 - sd.z0), v0: r1(f.y0 - sd.y0), v1: r1(f.y1 - sd.y0) }));
    const lines = outlineSegments(r1(sd.z1 - sd.z0), r1(sd.y1 - sd.y0), notches)
      .map(([u0, v0, u1, v1]) => `<line x1="${X(sd.z0 + u0)}" y1="${Y(sd.y0 + v0)}" x2="${X(sd.z0 + u1)}" y2="${Y(sd.y0 + v1)}"/>`).join('');
    const grooves = sd.features.filter((f) => f.type === 'groove').map((f) => box(f, 'ms-groove')).join('');
    return `<g class="ms-side">${lines}</g>${grooves}`;
  }).join('');
  const fronts = s.fronts.map((r) => box(r, 'ms-front')).join('');
  const cut = s.cut.map((r, i) => {
    const cls = /뒷판/.test(r.part) ? 'ms-cut ms-back' : 'ms-cut';
    const cx = r1((X(r.z0) + X(r.z1)) / 2), cy = r1((Y(r.y0) + Y(r.y1)) / 2 + 3);
    return `${box(r, cls)}<text x="${cx}" y="${cy}" class="ms-tag">${i + 1}</text>`;
  }).join('');
  // 세로 치수는 몸통 높이 (측판 y 끝) — 도어 · 좌대가 내려와도 몸통 기준
  const ys = s.sides.length ? s.sides : all;
  const cy0 = Math.min(...ys.map((r) => r.y0)), cy1 = Math.max(...ys.map((r) => r.y1));
  const bx0 = X(s.back), bx1 = X(s.front), by = r1(oy + dh * sc);
  const dims = `
    <line x1="${bx0}" y1="${r1(by + 10)}" x2="${bx1}" y2="${r1(by + 10)}" class="ms-dim"/>
    <text x="${r1((bx0 + bx1) / 2)}" y="${r1(by + 21)}" class="ms-num">${num(r1(s.front - s.back))}</text>
    <text x="${bx0}" y="${r1(by + 21)}" class="ms-end" text-anchor="start">뒤</text>
    <text x="${bx1}" y="${r1(by + 21)}" class="ms-end" text-anchor="end">앞</text>
    <line x1="${r1(ox - 10)}" y1="${Y(cy1)}" x2="${r1(ox - 10)}" y2="${Y(cy0)}" class="ms-dim"/>
    <text x="${r1(ox - 14)}" y="${r1((Y(cy1) + Y(cy0)) / 2)}" class="ms-num" transform="rotate(-90 ${r1(ox - 14)} ${r1((Y(cy1) + Y(cy0)) / 2)})">${num(r1(cy1 - cy0))}</text>`;
  return `<svg class="module-section" viewBox="0 0 ${num(W)} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="단면 ${esc(s.moduleKey)}">
  ${sides}${fronts}${cut}${dims}
</svg>`;
}

export const MODULE_SECTION_CSS = `
.module-sections { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt 10pt; }
.module-section-card { border: 0.6pt solid #000; padding: 3pt 4pt; break-inside: avoid; page-break-inside: avoid; }
.module-section-card .ms-title { font-weight: 700; font-size: 9pt; }
.module-section-card .ms-meta { font-size: 7.5pt; color: #333; }
.module-section-card .ms-body { display: block; }
.module-section-card .ms-body svg { max-height: 78mm; margin: 2pt auto; }
.module-section-card table.ms-parts { width: 100%; margin: 2pt 0 0; border-collapse: collapse; font-size: 7pt; }
.module-section-card table.ms-parts td, .module-section-card table.ms-parts th { border: 0.4pt solid #999; padding: 0 1.5pt; text-align: left; }
.module-section-card table.ms-parts th { white-space: nowrap; }
svg.module-section { width: 100%; height: auto; display: block; }
svg.module-section .ms-side line { stroke: #888; stroke-width: 0.8; }
svg.module-section .ms-groove { fill: none; stroke: #888; stroke-width: 0.5; stroke-dasharray: 3 2; }
svg.module-section .ms-front { fill: none; stroke: #555; stroke-width: 0.5; stroke-dasharray: 1.5 1.5; }
svg.module-section .ms-cut { fill: #cfcfcf; stroke: #000; stroke-width: 0.8; }
svg.module-section .ms-back { fill: #8a8a8a; }
svg.module-section .ms-dim { stroke: #000; stroke-width: 0.5; }
svg.module-section text { font-family: sans-serif; }
svg.module-section .ms-num { font-size: 9px; text-anchor: middle; }
svg.module-section .ms-tag { font-size: 8px; font-weight: 700; text-anchor: middle; }
svg.module-section .ms-end { font-size: 8px; fill: #444; }
`;

/** 단면 판재 한 줄 — 높이(바닥에서) · 깊이(몸통 뒤에서) */
function partRow(r, i, s) {
  const zb = r1(r.z0 - s.back), ze = r1(r.z1 - s.back);
  return `<tr><td>${i + 1}</td><td>${esc(r.part)}</td><td>${num(r.t)}T</td><td>${num(r.y0)}~${num(r.y1)}</td><td>${num(zb)}~${num(ze)}</td></tr>`;
}

/**
 * 모듈 단면도 쪽 — 명세가 없거나 그릴 모듈이 없으면 '' (옛 스냅샷은 쪽 자체가 없다).
 * @param {{ assembly, materials, rev?, contentHash?, title? }} o
 */
export function moduleSectionsSheet(o) {
  if (!o || !o.assembly || o.assembly.schema !== 'dadam.assembly/1') return '';
  const groups = moduleSectionGroups(o.assembly, o.materials);
  if (!groups.length) return '';
  const stamp = `rev ${o.rev != null ? num(o.rev) : '-'} · ${esc(String(o.contentHash || '').slice(0, 12) || '-')} · 규칙 ${esc(o.assembly.rulesVersion || '-')}`;
  const count = groups.reduce((n, g) => n + g.modules.length, 0);
  const cards = groups.map((g) => {
    const names = g.modules.map((m) => `${m.itemLabel ? `${m.itemLabel} ` : ''}${m.name}`);
    const b = g.box || {};
    return `<div class="module-section-card">
  <div class="ms-title">${esc(names[0])}${names.length > 1 ? ` <span class="muted">외 ${num(names.length - 1)}개 같은 단면</span>` : ''}</div>
  <div class="ms-meta">몸통 ${num(b.W)} × ${num(b.H)} × ${num(b.D)} · ${num(b.T)}T</div>
  <div class="ms-body">${moduleSectionSvg(g)}
  <table class="ms-parts"><tr><th>#</th><th>부재</th><th>두께</th><th>높이</th><th>뒤에서</th></tr>${g.cut.map((r, i) => partRow(r, i, g)).join('')}</table></div>
  ${names.length > 1 ? `<div class="ms-meta">${esc(names.join(' · '))}</div>` : ''}
  <div class="ms-meta mono">${esc(g.modules.map((m) => m.moduleKey).join(', '))} · ${stamp}</div>
</div>`;
  }).join('');
  return `
<div class="sheet">
  <style>${MODULE_SECTION_CSS}</style>
  <div class="section-title">${esc(o.title || '⑪-2 모듈 단면도')} <span class="muted">모듈 가운데를 옆에서 자른 면 ${num(groups.length)}종 ${num(count)}개 — 조립 명세 그대로</span></div>
  <div class="muted">칠한 칸 = 자른 면에 걸리는 판재(진한 칸 = 뒷판) · 회색 선 = 왼쪽 측판(따낸 자리 · 점선 = 홈) · 가는 점선 = 도어 · 서랍 전면. 높이는 몸통 바닥에서, 깊이는 몸통 뒤에서 mm. 걸레받이 · 상판 · 몰딩은 정면도. ${stamp}</div>
  <div class="module-sections">${cards}</div>
</div>`;
}
