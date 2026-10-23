#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, process, global */
/**
 * 모듈 라이브러리 → 모듈 카드 보고서 (docs/01-plan/module-library.plan.md §4).
 *
 * 모듈마다 정면도(조립 명세 판재를 앞에서 본 x-y 투영, 치수선) · 3D(build123d GLB) · 게이트 · 자재표 · 철물을 한 장에 싣는다.
 * GLB 와 OCC 대조 결과(report.json)는 tools/cad/build_from_spec.py 가 같은 폴더에 쓴 것을 읽는다 — 없으면 "미실행".
 * GLB 는 base64 로 페이지 안에 싣는다 — 파일 하나로 열리고(file:// · 아티팩트 모두), 따로 내려받을 것이 없다.
 *
 *   node tools/module-library/report.js <outDir> [id…] [--samples] [--label 1회차]
 *     → <outDir>/index.html
 *
 * **내부용** — 뒷판·처짐방지목·따내기·밴드 같은 내부 구조가 보인다. Pages·고객 화면에 올리지 않는다 (handoff 5-6).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

global.dlog = global.dlog || (() => {});
const pipeline = require('../../test-utils/module-library/pipeline.js');
const { targetsOf } = require('./dump-library.js');

const THREE_VER = '0.160.0';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

/** 판재 이름 → 정면도 칠 (CSS 클래스). 색은 페이지 토큰이 정한다. */
function partClassOf(p) {
  const n = String(p.part || '');
  if (n === '도어' || n === '서랍도어') return 'p-front';
  if (n === '상판') return 'p-top';
  if (n === '걸레받이') return 'p-kick';
  if (/목찬넬/.test(n)) return 'p-channel';
  if (n === '상몰딩') return 'p-molding';
  return p.material === 'MDF' ? 'p-mdf' : 'p-pb';
}

/** 명세 모듈 하나 + 그 모듈에 붙은 라인 부재 + 다리발 → 정면도 사각형 (모듈 로컬 mm, +x 오른쪽 · +y 위 · +z 앞). */
function rectsOf(spec) {
  const it = spec.items[0];
  const m = it.modules[0];
  const rects = [];
  const add = (p, cls) => rects.push({
    x0: p.box.min[0], x1: p.box.max[0], y0: p.box.min[1], y1: p.box.max[1], z: p.box.max[2], cls, part: p.part,
  });
  m.parts.forEach((p) => add(p, partClassOf(p)));
  (it.runs || []).filter((r) => r.hostModuleKey === m.moduleKey).forEach((r) => (r.parts || []).forEach((p) => add(p, partClassOf(p))));
  (m.hardware || []).filter((h) => h.kind === 'leg' && h.at && h.size).forEach((h) => rects.push({
    x0: h.at[0] - h.size[0] / 2, x1: h.at[0] + h.size[0] / 2, y0: h.at[1], y1: h.at[1] + h.size[1],
    z: h.at[2] + h.size[2] / 2, cls: 'p-leg', part: '다리발',
  }));
  rects.sort((a, b) => a.z - b.z);   // 뒤에서 앞으로 — 앞판이 마지막에 덮는다
  const hinges = (m.hardware || []).filter((h) => h.kind === 'hinge' && h.at).map((h) => ({ x: h.at[0], y: h.at[1], r: (h.cupD || 35) / 2 }));
  return { m, rects, hinges };
}

/** 정면도 SVG — 치수선: 아래 전체 폭 · 오른쪽 전체 높이(바닥~맨 위) · 왼쪽 전면 높이마다. */
function elevationSvg(spec, entry) {
  const { m, rects, hinges } = rectsOf(spec);
  const xs = rects.flatMap((r) => [r.x0, r.x1]);
  const ys = rects.flatMap((r) => [r.y0, r.y1]);
  const X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
  const fronts = rects.filter((r) => r.cls === 'p-front').sort((a, b) => a.y0 - b.y0);
  const PAD = { l: fronts.length ? 150 : 60, r: 150, t: 50, b: 130 };
  const vw = X1 - X0 + PAD.l + PAD.r, vh = Y1 - Y0 + PAD.t + PAD.b;
  const sx = (x) => x - X0 + PAD.l;
  const sy = (y) => Y1 - y + PAD.t;
  const out = [];
  out.push(`<svg class="elev" viewBox="0 0 ${fmt(vw)} ${fmt(vh)}" role="img" aria-label="${esc(entry.name)} 정면도">`);
  rects.forEach((r) => {
    out.push(`<rect class="${r.cls}" x="${fmt(sx(r.x0))}" y="${fmt(sy(r.y1))}" width="${fmt(r.x1 - r.x0)}" height="${fmt(r.y1 - r.y0)}"><title>${esc(r.part)} ${fmt(r.x1 - r.x0)}×${fmt(r.y1 - r.y0)}</title></rect>`);
  });
  hinges.forEach((h) => out.push(`<circle class="hinge" cx="${fmt(sx(h.x))}" cy="${fmt(sy(h.y))}" r="${fmt(h.r)}"><title>경첩 컵</title></circle>`));
  // 치수선
  const dimH = (x0, x1, y, label) => {
    out.push(`<line class="dim" x1="${fmt(sx(x0))}" y1="${fmt(y)}" x2="${fmt(sx(x1))}" y2="${fmt(y)}"/>`);
    [x0, x1].forEach((x) => out.push(`<line class="ext" x1="${fmt(sx(x))}" y1="${fmt(y - 14)}" x2="${fmt(sx(x))}" y2="${fmt(y + 14)}"/>`));
    out.push(`<text class="dim-t" x="${fmt((sx(x0) + sx(x1)) / 2)}" y="${fmt(y + 40)}" text-anchor="middle">${label}</text>`);
  };
  const dimV = (y0, y1, x, label, side) => {
    out.push(`<line class="dim" x1="${fmt(x)}" y1="${fmt(sy(y0))}" x2="${fmt(x)}" y2="${fmt(sy(y1))}"/>`);
    [y0, y1].forEach((y) => out.push(`<line class="ext" x1="${fmt(x - 14)}" y1="${fmt(sy(y))}" x2="${fmt(x + 14)}" y2="${fmt(sy(y))}"/>`));
    const tx = side === 'l' ? x - 22 : x + 22;
    out.push(`<text class="dim-t" x="${fmt(tx)}" y="${fmt((sy(y0) + sy(y1)) / 2 + 9)}" text-anchor="${side === 'l' ? 'end' : 'start'}">${label}</text>`);
  };
  dimH(X0, X1, sy(Y0) + 60, fmt(X1 - X0));
  dimV(Y0, Y1, sx(X1) + 50, fmt(Y1 - Y0), 'r');
  fronts.forEach((f) => dimV(f.y0, f.y1, sx(X0) - 40, fmt(f.y1 - f.y0), 'l'));
  out.push('</svg>');
  return { svg: out.join(''), box: m.box, overall: { W: X1 - X0, H: Y1 - Y0 } };
}

const GATE_LABEL = {
  'G1-split': '플래너 분할',
  'G2-single-cell': '칸 하나',
  'G3-bridge-warnings': '브리지 경고',
  'G4-bom': 'BOM',
  'G5-check': '조립 검사',
  'G6-unplaced': '자리 미정',
};

function gateChips(r, occ) {
  const chips = r.gates.map((g) => ({ code: g.code.slice(0, 2), label: GATE_LABEL[g.code] || g.code, state: g.ok ? 'ok' : 'bad', detail: g.ok ? '' : g.detail }));
  chips.push(occ
    ? { code: 'G7', label: 'Text-to-CAD', state: occ.problems.length ? 'bad' : 'ok', detail: occ.problems.join(' | ') }
    : { code: 'G7', label: 'Text-to-CAD', state: 'none', detail: 'build_from_spec.py 미실행' });
  chips.push({ code: 'G8·9', label: '플래너 왕복', state: 'ci', detail: 'jest module-library-roundtrip' });
  return chips.map((c) => `<li class="chip chip-${c.state}" title="${esc(c.detail)}"><b>${c.code}</b> ${esc(c.label)}${c.detail && c.state === 'bad' ? `<span class="chip-why">${esc(c.detail)}</span>` : ''}</li>`).join('');
}

function bomTable(r) {
  const keys = pipeline.moduleKeysOf(r.spec);
  const rows = r.materials.map((m) => `<tr class="${keys.has(m.moduleKey) ? '' : 'row-line'}"><td>${esc(m.part)}</td><td>${esc(m.material)}</td><td class="num">${m.thickness}T</td><td class="num">${fmt(m.w)} × ${fmt(m.h)}</td><td class="num">${m.qty}</td><td class="note">${esc(keys.has(m.moduleKey) ? m.note : '라인 부재 (품목 단위)')}</td></tr>`);
  return `<table class="bom"><thead><tr><th>부재</th><th>자재</th><th>두께</th><th>재단 (mm)</th><th>수량</th><th>비고</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function hardwareList(r) {
  return r.hardware.map((h) => `<li><span>${esc(h.category)}</span> ${esc(h.item)}${h.spec && h.spec !== '-' ? ` · ${esc(h.spec)}` : ''} <b class="num">× ${h.qty}</b></li>`).join('');
}

function choiceText(e) {
  const c = e.choice;
  if (c.drawer) {
    const parts = [`전면 비율 ${c.drawer.ratio}`, c.drawer.rail === 'ball' ? '볼레일' : '언더레일'];
    if (c.drawer.sakuri) parts.push('사쿠리 서랍');
    return parts.join(' · ');
  }
  if (c.kind === 'open') return '오픈장 상자 (MDF 18T)';
  if (c.cell === 'open') return '오픈 칸';
  if (c.doors === 2) return '도어 2 (한 통)';
  return { left: '도어 1 · 좌경첩', right: '도어 1 · 우경첩', up: '도어 1 · 플랩 (위로 열림)' }[c.hinge] || '도어 1';
}

function cardHtml(t, r, occ, hasGlb) {
  const e = t.entry;
  const el = elevationSvg(r.spec, e);
  const pm = r.payload.modules[0];
  const parts = r.spec.items[0].modules[0].parts.length;
  const anchor = t.name;
  return `<article class="card" id="${esc(anchor)}">
  <header class="card-h">
    <p class="mid">${esc(e.id)}</p>
    <h2>${esc(e.name)}</h2>
    <p class="dims"><span>폭 ${pm.W}</span><span>배치 높이 ${pm.H}</span><span>몸통 ${el.box.W}×${el.box.H}×${el.box.D}</span><span>${el.box.T}T</span></p>
    <p class="choice">${esc(choiceText(e))}</p>
  </header>
  <div class="views">
    <figure class="fig-elev">${el.svg}<figcaption>정면도 · 판재 ${parts}장 · 경첩 컵은 점선 원</figcaption></figure>
    <figure class="fig-3d">
      <div class="stage" data-glb="${hasGlb ? esc(t.name) : ''}">
        ${hasGlb ? `<button type="button" class="load3d" id="btn-${esc(anchor)}">3D 보기</button>` : '<p class="no3d">GLB 없음 — Text-to-CAD(build_from_spec.py)를 먼저 돌린다</p>'}
      </div>
      <figcaption>build123d · ${hasGlb ? esc(`${t.name}.glb`) : '—'} · 끌어서 돌리기</figcaption>
    </figure>
  </div>
  <ul class="chips">${gateChips(r, occ)}</ul>
  <details><summary>자재표 ${r.materials.length}행</summary><div class="scroll">${bomTable(r)}</div></details>
  <details><summary>철물 ${r.hardware.length}종</summary><ul class="hw">${hardwareList(r)}</ul></details>
</article>`;
}

function summaryRows(rows) {
  return rows.map(({ t, r, occ }) => {
    const e = t.entry;
    const bad = r.gates.filter((g) => !g.ok).length + (occ && occ.problems.length ? 1 : 0);
    const state = bad ? `<span class="pill pill-bad">걸림 ${bad}</span>` : '<span class="pill pill-ok">통과</span>';
    return `<tr><td><a href="#${esc(t.name)}">${esc(e.id)}</a></td><td>${esc(e.name)}</td><td class="num">${e.W}</td><td class="num">${r.spec.items[0].modules[0].parts.length}</td><td>${state}</td><td class="num">${occ ? occ.problems.length : '—'}</td></tr>`;
  }).join('');
}

function gitShort() {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return '?'; }
}

function pageHtml(rows, meta) {
  const okCount = rows.filter(({ r, occ }) => r.ok && (!occ || !occ.problems.length)).length;
  return `<title>다담 모듈 라이브러리</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Noto+Serif+KR:wght@600&family=Fira+Code:wght@400;500&display=swap">
<style>
/* 배치: 머리말(요약 표) → 모듈 카드 목록. 카드 안은 정면도 | 3D 두 칸, 좁으면 한 칸. 다담 디자인 시스템(--d-*) 값을 따른다 */
:root {
  --bg: #f6f4f0; --surface: #ffffff; --surface-dim: #faf8f5; --ink: #2d2a26; --ink-soft: #4a4640;
  --muted: #8b8680; --line: #e8e3db; --accent: #b8956c; --ok: #5a9a6b; --bad: #c4564a; --info: #5b8fb9;
  --pb: #d9c4a3; --mdf: #bdb5a8; --front: #efebe4; --stone: #d6d3cd; --kick: #6f6a63; --channel: #8f877c; --hw: #6b6b6b; --draw: #2d2a26;
  --font-body: 'Pretendard', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-display: 'Noto Serif KR', 'Cormorant Garamond', Georgia, serif;
  --font-mono: 'Fira Code', 'SF Mono', ui-monospace, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #1c1a18; --surface: #252220; --surface-dim: #2a2724; --ink: #ece7df; --ink-soft: #cfc8bd;
  --muted: #9a938a; --line: #3a3530; --accent: #c9a77e; --ok: #7bb68b; --bad: #e07a6e; --info: #86b0d4;
  --pb: #8a7558; --mdf: #6e6860; --front: #4a4540; --stone: #5d5a56; --kick: #2e2b28; --channel: #3a3632; --hw: #9a9a9a; --draw: #e0d9cf;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #1c1a18; --surface: #252220; --surface-dim: #2a2724; --ink: #ece7df; --ink-soft: #cfc8bd;
  --muted: #9a938a; --line: #3a3530; --accent: #c9a77e; --ok: #7bb68b; --bad: #e07a6e; --info: #86b0d4;
  --pb: #8a7558; --mdf: #6e6860; --front: #4a4540; --stone: #5d5a56; --kick: #2e2b28; --channel: #3a3632; --hw: #9a9a9a; --draw: #e0d9cf;
  color-scheme: dark; }
body { background: var(--bg); color: var(--ink); font-family: var(--font-body); font-size: 15px; line-height: 1.6; }
.wrap { max-width: 1120px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 40px 64px; display: grid; gap: 32px; }
.top { display: grid; gap: 14px; }
.eyebrow { margin: 0; font-size: 12px; letter-spacing: .08em; color: var(--accent); font-weight: 700; }
h1 { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: clamp(28px, 4vw, 38px); line-height: 1.2; text-wrap: balance; }
.lede { margin: 0; max-width: 65ch; color: var(--ink-soft); }
.meta { margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; font-family: var(--font-mono); font-size: 12px; color: var(--muted); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 500; color: var(--muted); font-size: 12px; letter-spacing: .04em; }
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
a { color: var(--ink); text-decoration-color: var(--accent); text-underline-offset: 3px; }
a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pill { display: inline-block; font-size: 12px; padding: 1px 9px; border-radius: 999px; border: 1px solid currentColor; }
.pill-ok { color: var(--ok); } .pill-bad { color: var(--bad); }
.cards { display: grid; gap: 28px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 22px; display: grid; gap: 16px; min-width: 0; }
.card-h { display: grid; gap: 4px; }
.card-h h2 { margin: 0; font-size: 19px; font-weight: 700; text-wrap: balance; }
.mid { margin: 0; font-family: var(--font-mono); font-size: 12px; color: var(--accent); letter-spacing: .03em; }
.dims { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-family: var(--font-mono); font-size: 12.5px; color: var(--ink-soft); }
.choice { margin: 0; color: var(--muted); font-size: 13.5px; }
.views { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
@media (max-width: 760px) { .views { grid-template-columns: minmax(0, 1fr); } }
figure { margin: 0; display: grid; gap: 6px; min-width: 0; }
figcaption { font-size: 12px; color: var(--muted); }
.fig-elev, .stage { background: var(--surface-dim); border: 1px solid var(--line); border-radius: 8px; }
.fig-elev { padding: 10px; }
svg.elev { width: 100%; height: auto; max-height: 420px; display: block; }
svg.elev rect { stroke: var(--draw); stroke-width: 1.6; vector-effect: non-scaling-stroke; }
.p-pb { fill: var(--pb); } .p-mdf { fill: var(--mdf); } .p-front { fill: var(--front); } .p-top { fill: var(--stone); }
.p-kick { fill: var(--kick); } .p-channel { fill: var(--channel); } .p-molding { fill: var(--mdf); } .p-leg { fill: var(--hw); }
svg.elev .hinge { fill: none; stroke: var(--accent); stroke-width: 1.4; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
svg.elev .dim, svg.elev .ext { stroke: var(--muted); stroke-width: 1; vector-effect: non-scaling-stroke; }
svg.elev .dim-t { fill: var(--ink-soft); font-family: var(--font-mono); font-size: 26px; }
.stage { position: relative; aspect-ratio: 4 / 3; max-width: 100%; display: grid; place-items: center; overflow: hidden; }
.stage canvas { width: 100% !important; height: 100% !important; display: block; touch-action: none; }
.load3d { font: inherit; font-size: 14px; padding: 9px 18px; border-radius: 999px; border: 1px solid var(--accent); background: var(--surface); color: var(--ink); cursor: pointer; }
.load3d:hover { background: var(--accent); color: var(--surface); }
.no3d { margin: 0; padding: 16px; color: var(--muted); font-size: 13px; text-align: center; }
.chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid var(--line); color: var(--ink-soft); display: inline-flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
.chip b { font-family: var(--font-mono); font-weight: 500; }
.chip-ok b { color: var(--ok); } .chip-bad { border-color: var(--bad); } .chip-bad b { color: var(--bad); }
.chip-none b, .chip-ci b { color: var(--muted); }
.chip-why { flex-basis: 100%; color: var(--bad); font-size: 11.5px; }
details { border-top: 1px solid var(--line); padding-top: 10px; }
summary { cursor: pointer; font-size: 13.5px; font-weight: 500; color: var(--ink-soft); }
details[open] summary { margin-bottom: 8px; }
.bom .note { color: var(--muted); font-size: 12px; min-width: 12em; }
.row-line td { color: var(--muted); }
.hw { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 13px; }
.hw span { color: var(--muted); display: inline-block; min-width: 4.5em; }
.foot { color: var(--muted); font-size: 13px; display: grid; gap: 4px; max-width: 75ch; }
.foot p { margin: 0; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>
<div class="wrap">
  <header class="top">
    <p class="eyebrow">모듈 라이브러리 · ${esc(meta.label)}</p>
    <h1>다담 모듈 라이브러리</h1>
    <p class="lede">고정 폭에 내부 구조만 다른 싱크대 개별 모듈입니다. 모듈마다 실제 플래너 브리지, BOM, 조립 검사, build123d(Text-to-CAD) 대조를 통과했는지 보여 줍니다. 판재 치수는 모두 기존 규칙이 냈습니다.</p>
    <p class="meta"><span>모듈 ${rows.length}개 · 통과 ${okCount}</span><span>규칙판 ${esc(meta.rulesVersion)}</span><span>main ${esc(meta.sha)}</span><span>${esc(meta.date)}</span></p>
    <div class="scroll"><table class="summary"><thead><tr><th>모듈</th><th>이름</th><th>폭</th><th>판재</th><th>게이트</th><th>CAD 불일치</th></tr></thead><tbody>${summaryRows(rows)}</tbody></table></div>
  </header>
  <main class="cards">
${rows.map(({ t, r, occ, hasGlb }) => cardHtml(t, r, occ, hasGlb)).join('\n')}
  </main>
  <footer class="foot">
    <p>정면도는 조립 명세 판재를 앞에서 본 그림입니다. 라인 부재(상판·걸레받이·목찬넬·상몰딩)는 품목 단위라, 모듈 하나만 놓았을 때의 모양입니다.</p>
    <p>3D는 판재만 지었습니다 (철물·라인 부재 없음). 내부 구조가 보이는 내부용 자료라 고객 화면에는 올리지 않습니다.</p>
  </footer>
</div>
<script type="application/json" id="glb-data">${JSON.stringify(meta.glb || {})}</script>
<script type="importmap">{ "imports": { "three": "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/build/three.module.js", "three/addons/": "https://cdn.jsdelivr.net/npm/three@${THREE_VER}/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// build_from_spec.py 의 GLB 는 판재를 메시 하나로 합친다 — 판재 색 하나 + 모서리 선으로 그린다
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
// GLB 는 페이지 안에 base64 로 실려 있다 — 파일 하나로 열리고(file:// 포함) 따로 내려받을 것이 없다
const GLB = JSON.parse(document.getElementById('glb-data').textContent || '{}');
const bytesOf = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)).buffer;

function view(stage, name) {
  stage.textContent = '';
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(css('--surface-dim'));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x887766, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(32, 4 / 3, 1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  const size = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(size).observe(stage);
  size();
  new GLTFLoader().parse(bytesOf(GLB[name] || ''), '', (gltf) => {
    const root = gltf.scene;
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshStandardMaterial({ color: css('--pb'), roughness: 0.85 });
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), new THREE.LineBasicMaterial({ color: css('--draw') }));
      o.add(edges);
    });
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(c);
    camera.position.set(c.x + r * 0.55, c.y + r * 0.35, c.z + r * 1.25);
    camera.near = r / 100; camera.far = r * 20; camera.updateProjectionMatrix();
    controls.update();
  }, () => { stage.innerHTML = '<p class="no3d">GLB 를 읽지 못했습니다 — build_from_spec.py 출력을 다시 만드세요</p>'; });
  const loop = () => { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); };
  loop();
}

document.querySelectorAll('.stage[data-glb]').forEach((stage) => {
  const btn = stage.querySelector('.load3d');
  if (btn && stage.dataset.glb) btn.addEventListener('click', () => view(stage, stage.dataset.glb));
});
</script>
`;
}

function main(argv) {
  const [outDir, ...rest] = argv;
  if (!outDir) {
    process.stderr.write('usage: node tools/module-library/report.js <outDir> [id...] [--samples] [--label <회차>]\n');
    return 2;
  }
  const li = rest.indexOf('--label');
  const label = li >= 0 ? rest[li + 1] : '검증 보고서';
  const args = li >= 0 ? rest.filter((_, i) => i !== li && i !== li + 1) : rest;
  const targets = targetsOf(args);
  if (targets.some((t) => !t.entry)) {
    process.stderr.write(`unknown module: ${targets.filter((t) => !t.entry).map((t) => t.name).join(', ')}\n`);
    return 2;
  }
  const occFile = path.join(outDir, 'report.json');
  const occ = fs.existsSync(occFile) ? JSON.parse(fs.readFileSync(occFile, 'utf8')).results || [] : [];
  const rows = targets.map((t) => ({
    t,
    r: pipeline.runEntry(t.entry),
    occ: occ.find((o) => o.fixture === t.name) || null,
    hasGlb: fs.existsSync(path.join(outDir, `${t.name}.glb`)),
  }));
  const glb = {};
  rows.filter((x) => x.hasGlb).forEach(({ t }) => { glb[t.name] = fs.readFileSync(path.join(outDir, `${t.name}.glb`)).toString('base64'); });
  const meta = {
    label,
    rulesVersion: rows.length ? rows[0].r.spec.rulesVersion : '-',
    sha: gitShort(),
    date: new Date().toISOString().slice(0, 10),
    glb,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'index.html');
  fs.writeFileSync(file, pageHtml(rows, meta));
  process.stdout.write(`${file}: 모듈 ${rows.length}개\n`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { partClassOf, rectsOf, elevationSvg, pageHtml, main };
