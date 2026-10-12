/**
 * 치수 정면도 — 동결된 설계(`design_payload.items[].modules[]`)로 서버가 그린다
 * (계획 docs/01-plan/work-order-stage.plan.md §4.4).
 *
 * 플래너 화면의 SVG 를 떼어 오지 않는 이유: 편집 화면(눈금자는 HTML 오버레이)이라 떼기 어렵고,
 * 올린 그림과 동결 BOM 의 rev 가 갈릴 수 있다. 여기서 그리면 그림과 자재표가 늘 같은 rev 다.
 *
 * 읽는 모듈 필드 (플래너 브리지 ui-step1.js _convertPlannerModules 가 싣는다):
 *   pos 'lower'|'upper'|'wardrobe' · type 'tall'|'wardrobe'|… · name · w · h(몸통) · d
 *   totalH(전체 높이) · heightParts {legH, topT} | {moldingH} | {moldingH, pedestalH}
 *   _x(배치 좌표의 왼쪽 끝) · doorCount · is2door · isDrawer · drawerCount · isOpen · shelfCount
 * 옛 설계(플래너 이전)는 _x·totalH·heightParts 가 없다 — 순서대로 붙이고 몸통만 그린다.
 *
 * 세로 위치: 하부·키큰장·붙박이장은 바닥에서, 상부장은 천장(item.h)에 매단다 (플래너의 천장 기준).
 * 브리지가 플래너의 세로 좌표를 넘기지 않으므로 상부장 아래 끝은 천장 − 전체 높이다.
 *
 * 검증을 그림에 남긴다: 모듈이 품목 폭을 넘거나, 위치가 없어 폭 합을 대조하는데 어긋나면
 * 그 자리에 빨간 글을 그린다 — 그림이 BOM 의 문제를 감추지 않게.
 */

import { esc, num } from './html.js';

const DEFAULT_CEILING = 2300;

function n(v) {
  const x = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

function pos0(v) {
  const x = n(v);
  return x !== null && x > 0 ? x : 0;
}

/** 모듈 → 줄. 바닥에 서는 것(하부·키큰장·붙박이장)과 천장에 매다는 것(상부). */
export function lineOf(m) {
  return m && m.pos === 'upper' ? 'upper' : 'floor';
}

function kindOf(m) {
  if (m.pos === 'upper') return 'upper';
  if (m.pos === 'wardrobe' || m.type === 'wardrobe') return 'wardrobe';
  if (m.type === 'tall') return 'tall';
  return 'lower';
}

/**
 * 모듈 하나의 세로 띠 (아래에서 위로, mm). 전체 높이와 몸통 구간을 함께 낸다.
 *   lower    다리(legH) · 몸통 · 상판(topT)
 *   tall/wr  좌대(pedestalH) · 몸통 · 상몰딩(moldingH)
 *   upper    몸통 · 상몰딩(moldingH)  (천장에 붙는다)
 * heightParts 가 없으면 몸통 한 띠 (높이 = totalH 또는 h).
 */
export function bandsOf(m) {
  const kind = kindOf(m);
  const hp = m.heightParts && typeof m.heightParts === 'object' ? m.heightParts : null;
  const body = pos0(m.h);
  const bands = [];
  if (hp && kind === 'lower' && (n(hp.legH) !== null || n(hp.topT) !== null)) {
    bands.push({ part: 'leg', h: pos0(hp.legH) }, { part: 'body', h: body }, { part: 'top', h: pos0(hp.topT) });
  } else if (hp && (kind === 'tall' || kind === 'wardrobe') && (n(hp.pedestalH) !== null || n(hp.moldingH) !== null)) {
    bands.push({ part: 'pedestal', h: pos0(hp.pedestalH) }, { part: 'body', h: body }, { part: 'molding', h: pos0(hp.moldingH) });
  } else if (hp && kind === 'upper' && n(hp.moldingH) !== null) {
    bands.push({ part: 'body', h: body }, { part: 'molding', h: pos0(hp.moldingH) });
  } else {
    bands.push({ part: 'body', h: pos0(m.totalH) || body });
  }
  const total = bands.reduce((s, b) => s + b.h, 0);
  return { kind, bands: bands.filter((b) => b.h > 0), total };
}

/**
 * 품목 → 정면도 모델 (순수, 시험용으로 노출).
 * 반환: { W, H, itemW, placed:[{m, no, line, kind, x, w, y0, total, bands}], positioned, notes:[{level, text}] }
 *   y0 = 바닥에서 모듈 아래 끝까지 (mm)
 */
export function elevationModel(item) {
  const modules = Array.isArray(item && item.modules) ? item.modules : [];
  const itemW = pos0(item && item.w);
  const notes = [];

  const entries = modules
    .map((m, i) => ({ m, no: i + 1, line: lineOf(m), w: pos0(m && m.w), ...bandsOf(m || {}) }))
    .filter((e) => e.w > 0 && e.total > 0);

  // 가로 위치 — 모두 _x 가 있고 줄마다 겹치지 않을 때만 배치 좌표를 믿는다
  const xsKnown = entries.length > 0 && entries.every((e) => n(e.m._x) !== null);
  let positioned = false;
  if (xsKnown) {
    const minX = Math.min(...entries.map((e) => n(e.m._x)));
    entries.forEach((e) => { e.x = n(e.m._x) - minX; });
    positioned = ['floor', 'upper'].every((line) => {
      const row = entries.filter((e) => e.line === line).sort((a, b) => a.x - b.x);
      return row.every((e, i) => i === 0 || e.x >= row[i - 1].x + row[i - 1].w - 2);
    });
  }
  if (!positioned) {
    for (const line of ['floor', 'upper']) {
      let x = 0;
      entries.filter((e) => e.line === line).forEach((e) => { e.x = x; x += e.w; });
    }
    if (entries.length) {
      notes.push({
        level: 'info',
        text: xsKnown ? '배치 위치가 겹쳐(코너·다른 벽) 순서대로 붙여 그렸습니다 — 틈·코너는 표시되지 않습니다' : '배치 위치 정보가 없어 순서대로 붙여 그렸습니다 — 틈은 표시되지 않습니다',
      });
    }
  }

  // 폭 검증
  for (const line of ['floor', 'upper']) {
    const row = entries.filter((e) => e.line === line);
    if (!row.length || itemW <= 0) continue;
    const end = Math.max(...row.map((e) => e.x + e.w));
    const label = line === 'upper' ? '상부' : '하부';
    if (end > itemW + 1) {
      notes.push({ level: 'error', line, text: `${label} 모듈 끝 ${num(end)} 이 품목 폭 ${num(itemW)} 을 넘습니다 (Δ ${num(end - itemW)})` });
    } else if (!positioned && line === 'floor' && Math.abs(end - itemW) > 1) {
      notes.push({ level: 'error', line, text: `${label} 모듈 폭 합 ${num(end)} ≠ 품목 폭 ${num(itemW)} (Δ ${num(end - itemW)})` });
    }
  }

  // 세로
  const floorTop = Math.max(0, ...entries.filter((e) => e.line === 'floor').map((e) => e.total));
  const upperTotal = Math.max(0, ...entries.filter((e) => e.line === 'upper').map((e) => e.total));
  const H = pos0(item && item.h) || Math.max(DEFAULT_CEILING, floorTop + upperTotal);
  entries.forEach((e) => { e.y0 = e.line === 'upper' ? H - e.total : 0; });

  const lowers = entries.filter((e) => e.kind === 'lower');
  const uppers = entries.filter((e) => e.line === 'upper');
  for (const u of uppers) {
    const clash = lowers.find((l) => u.x < l.x + l.w && l.x < u.x + u.w && u.y0 < l.total);
    if (clash) {
      notes.push({ level: 'error', text: `상부 ${u.no} 아래 끝(${num(u.y0)})이 하부 ${clash.no} 위 끝(${num(clash.total)})보다 낮습니다` });
    }
  }

  const ends = entries.map((e) => e.x + e.w);
  const W = Math.max(itemW, ...(ends.length ? ends : [0]));
  return { W, H, itemW, placed: entries, positioned, notes };
}

// ── 그리기 ───────────────────────────────────────────────────────

const BAND_FILL = { leg: '#fff', pedestal: '#fff', top: '#bbb', molding: '#e6e6e6' };
const BAND_NAME = { leg: '다리', pedestal: '좌대', top: '상판', molding: '몰딩' };

/** 가로 치수 사슬 — segs=[{x, w, label, muted}] 를 y 에 그린다. */
function hChain(segs, y, fs, { ext0, ext1 } = {}) {
  const tick = fs * 0.45;
  return segs
    .map((s) => {
      const color = s.muted ? '#777' : '#1d4f91';
      const ext = ext0 !== undefined
        ? `<line x1="${s.x}" y1="${ext0}" x2="${s.x}" y2="${ext1}" stroke="#9db4d6" stroke-width="${fs * 0.04}"/><line x1="${s.x + s.w}" y1="${ext0}" x2="${s.x + s.w}" y2="${ext1}" stroke="#9db4d6" stroke-width="${fs * 0.04}"/>`
        : '';
      return (
        ext +
        `<line x1="${s.x}" y1="${y}" x2="${s.x + s.w}" y2="${y}" stroke="${color}" stroke-width="${fs * 0.06}"/>` +
        `<line x1="${s.x}" y1="${y - tick}" x2="${s.x}" y2="${y + tick}" stroke="${color}" stroke-width="${fs * 0.06}"/>` +
        `<line x1="${s.x + s.w}" y1="${y - tick}" x2="${s.x + s.w}" y2="${y + tick}" stroke="${color}" stroke-width="${fs * 0.06}"/>` +
        (s.w >= fs * String(s.label).length * 0.55
          ? `<text x="${s.x + s.w / 2}" y="${y - fs * 0.3}" font-size="${fs}" text-anchor="middle" fill="${color}"${s.muted ? ' font-style="italic"' : ''}>${esc(s.label)}</text>`
          : '')
      );
    })
    .join('');
}

/** 세로 치수 사슬 — segs=[{y0, h, label}] (바닥 기준 mm) 을 x 에 그린다. toY 는 화면 y 변환. */
function vChain(segs, x, fs, toY) {
  const tick = fs * 0.45;
  return segs
    .filter((s) => s.h > 0)
    .map((s) => {
      const ya = toY(s.y0 + s.h);
      const yb = toY(s.y0);
      const color = s.muted ? '#777' : '#1d4f91';
      return (
        `<line x1="${x}" y1="${ya}" x2="${x}" y2="${yb}" stroke="${color}" stroke-width="${fs * 0.06}"/>` +
        `<line x1="${x - tick}" y1="${ya}" x2="${x + tick}" y2="${ya}" stroke="${color}" stroke-width="${fs * 0.06}"/>` +
        `<line x1="${x - tick}" y1="${yb}" x2="${x + tick}" y2="${yb}" stroke="${color}" stroke-width="${fs * 0.06}"/>` +
        // 얇은 띠(몰딩·좌대·상판)도 값을 적는다 — 글자를 줄여 띠 가운데에. 이웃 띠의 글자는 그 띠 가운데라 겹치지 않는다
        (yb - ya >= fs * 0.9
          ? `<text x="${x + fs * 0.4}" y="${(ya + yb) / 2 + fs * 0.35}" font-size="${fs}" fill="${color}">${esc(s.label)}</text>`
          : `<text x="${x + fs * 0.4}" y="${(ya + yb) / 2 + fs * 0.27}" font-size="${fs * 0.75}" fill="${color}">${esc(s.label)}</text>`)
      );
    })
    .join('');
}

/** 줄의 가로 사슬 — 모듈 폭과 사이 틈(배치 위치를 믿을 때만), 끝까지의 나머지. */
function chainSegs(entries, W, positioned) {
  const row = entries.slice().sort((a, b) => a.x - b.x);
  const segs = [];
  let cur = 0;
  for (const e of row) {
    if (positioned && e.x - cur > 1) segs.push({ x: cur, w: e.x - cur, label: `(${num(e.x - cur)})`, muted: true });
    segs.push({ x: e.x, w: e.w, label: num(e.w) });
    cur = e.x + e.w;
  }
  if (positioned && W - cur > 1) segs.push({ x: cur, w: W - cur, label: `(${num(W - cur)})`, muted: true });
  return segs;
}

function moduleCaption(e) {
  const m = e.m;
  const bits = [];
  if (m.isOpen) bits.push('오픈');
  else if (Number(m.doorCount) > 0) bits.push(`도어 ${num(m.doorCount)}`);
  if (m.isDrawer) bits.push(`서랍 ${num(Number(m.drawerCount) || 1)}단`);
  if (m.blindZoneW) bits.push(`멍 ${num(m.blindZoneW)}`);
  return bits.join(' · ');
}

/**
 * 품목 하나의 정면도 SVG. 단위는 mm (viewBox), 인쇄 폭에 맞춰 줄어든다.
 * 모듈 번호 = item.modules 의 순번(1부터) — ⑥ 조립 체크·⑪ 모듈 치수도와 같은 번호.
 */
export function elevationSvg(item) {
  const model = elevationModel(item);
  const { W, H, placed, positioned } = model;
  if (!placed.length || W <= 0) return '';

  const fs = Math.min(110, Math.max(55, W / 38));
  const floor = placed.filter((e) => e.line === 'floor');
  const upper = placed.filter((e) => e.line === 'upper');
  // 세로 치수의 대표: 일반 하부(없으면 바닥 첫 모듈) · 첫 상부. 둘이 세로로 겹치면 열을 하나 더 쓴다
  const lower = floor.find((e) => e.kind === 'lower') || floor[0];
  const up = upper[0];
  const split = Boolean(lower && up && lower.total > up.y0);
  const ml = fs * 1.5;
  const mr = fs * (split ? 14.8 : 9.2);
  const mt = fs * 3.2;
  const mb = fs * 4.4;
  const vbW = ml + W + mr;
  const vbH = mt + H + mb;
  const toY = (y) => mt + (H - y); // 바닥 기준 mm → 화면

  const sw = Math.max(2, fs * 0.05);
  const parts = [];

  // 바닥·천장
  parts.push(`<line x1="${ml - fs}" y1="${toY(0)}" x2="${ml + W + fs}" y2="${toY(0)}" stroke="#000" stroke-width="${sw * 1.6}"/>`);
  parts.push(`<line x1="${ml - fs}" y1="${toY(H)}" x2="${ml + W + fs}" y2="${toY(H)}" stroke="#888" stroke-width="${sw}" stroke-dasharray="${fs * 0.4} ${fs * 0.25}"/>`);
  parts.push(`<text x="${ml - fs * 1.2}" y="${toY(H) - fs * 0.25}" font-size="${fs * 0.7}" fill="#666">천장</text>`);

  for (const e of placed) {
    const x = ml + e.x;
    let y = e.y0;
    for (const b of e.bands) {
      const top = toY(y + b.h);
      if (b.part === 'body') {
        parts.push(`<rect x="${x}" y="${top}" width="${e.w}" height="${b.h}" fill="#fff" stroke="#000" stroke-width="${sw * 1.4}"/>`);
        if (!e.m.isOpen && Number(e.m.doorCount) === 2) {
          parts.push(`<line x1="${x + e.w / 2}" y1="${top}" x2="${x + e.w / 2}" y2="${top + b.h}" stroke="#000" stroke-width="${sw}"/>`);
        }
        if (e.m.isOpen) {
          parts.push(`<rect x="${x + fs * 0.4}" y="${top + fs * 0.4}" width="${Math.max(0, e.w - fs * 0.8)}" height="${Math.max(0, b.h - fs * 0.8)}" fill="none" stroke="#999" stroke-width="${sw}" stroke-dasharray="${fs * 0.3} ${fs * 0.2}"/>`);
        }
        // 번호 · 이름 · 구성
        const cx = x + e.w / 2;
        const cy = top + b.h / 2;
        const r = fs * 0.75;
        const name = String(e.m.name || e.m.type || '');
        const cap = moduleCaption(e);
        parts.push(`<circle cx="${cx}" cy="${cy - fs * 0.9}" r="${r}" fill="#fff" stroke="#000" stroke-width="${sw}"/>`);
        parts.push(`<text x="${cx}" y="${cy - fs * 0.9 + fs * 0.36}" font-size="${fs}" font-weight="700" text-anchor="middle">${num(e.no)}</text>`);
        if (e.w >= fs * name.length * 0.95) parts.push(`<text x="${cx}" y="${cy + fs * 0.75}" font-size="${fs * 0.9}" text-anchor="middle">${esc(name)}</text>`);
        if (cap && e.w >= fs * cap.length * 0.5) parts.push(`<text x="${cx}" y="${cy + fs * 1.75}" font-size="${fs * 0.7}" text-anchor="middle" fill="#555">${esc(cap)}</text>`);
      } else {
        parts.push(`<rect x="${x}" y="${top}" width="${e.w}" height="${b.h}" fill="${BAND_FILL[b.part]}" stroke="#555" stroke-width="${sw}"${b.part === 'leg' || b.part === 'pedestal' ? ` stroke-dasharray="${fs * 0.3} ${fs * 0.2}"` : ''}/>`);
      }
      y += b.h;
    }
  }

  // 가로 치수: 상부 사슬(위), 하부 사슬 + 전체 폭(아래)
  const shift = (segs) => segs.map((s) => ({ ...s, x: s.x + ml }));
  if (upper.length) parts.push(hChain(shift(chainSegs(upper, W, positioned)), toY(H) - fs * 1.4, fs));
  if (floor.length) parts.push(hChain(shift(chainSegs(floor, W, positioned)), toY(0) + fs * 1.6, fs));
  const overall = model.itemW > 0 ? model.itemW : W;
  parts.push(hChain([{ x: ml, w: overall, label: `W ${num(overall)}` }], toY(0) + fs * 3.4, fs * 1.05));

  // 세로 치수: 대표 하부 · 대표 상부의 띠 + 사이 + 전체 높이
  // 바닥 쪽 대표가 상부와 세로로 겹치면(키큰장·붙박이장 옆 상부장) 상부 사슬을 다음 열로 뺀다
  const colW = fs * 5.6;
  let vx = ml + W + fs * 1.2;
  const bandSegs = (e, bodyName) => {
    const out = [];
    let y = e.y0;
    for (const b of e.bands) {
      out.push({ y0: y, h: b.h, label: `${b.part === 'body' ? bodyName : BAND_NAME[b.part]} ${num(b.h)}` });
      y += b.h;
    }
    return out;
  };
  const lowSegs = lower ? bandSegs(lower, '몸통') : [];
  if (up) {
    const lowTop = lower ? lower.total : 0;
    const upSegs = bandSegs(up, '상부 몸통');
    if (!split) {
      if (up.y0 - lowTop > 0) lowSegs.push({ y0: lowTop, h: up.y0 - lowTop, label: `사이 ${num(up.y0 - lowTop)}`, muted: true });
      lowSegs.push(...upSegs);
    } else {
      parts.push(vChain(lowSegs, vx, fs * 0.85, toY));
      lowSegs.length = 0;
      vx += colW;
      if (up.y0 > 0) upSegs.unshift({ y0: 0, h: up.y0, label: `아래 ${num(up.y0)}`, muted: true });
      lowSegs.push(...upSegs);
    }
  }
  parts.push(vChain(lowSegs, vx, fs * 0.85, toY));
  parts.push(vChain([{ y0: 0, h: H, label: `H ${num(H)}` }], vx + colW, fs * 0.95, toY));

  // 검증 경고 (빨강) — 그림 안 아래
  const errs = model.notes.filter((x) => x.level === 'error');
  errs.forEach((x, i) => {
    parts.push(`<text x="${ml}" y="${toY(0) + fs * (4.4 + i * 1.1)}" font-size="${fs * 0.85}" fill="#c00" font-weight="700">⚠ ${esc(x.text)}</text>`);
  });
  const vbH2 = vbH + errs.length * fs * 1.1;

  return (
    `<svg class="elevation" viewBox="0 0 ${Math.round(vbW)} ${Math.round(vbH2)}" xmlns="http://www.w3.org/2000/svg" font-family="'Malgun Gothic', sans-serif">` +
    parts.join('') +
    '</svg>'
  );
}

/**
 * 모듈 하나의 치수도 (정면 W×몸통 H + 측면 D) — ⑪ 조립 기사용.
 * frame = 같은 품목 모듈들의 { w: max(w+d), h: max(h) } — 주면 viewBox 를 그 크기로 맞춰
 * 품목 안에서 축척이 같다 (600 장과 800 장이 같은 크기로 보이지 않게).
 */
export function moduleDrawingSvg(m, frame = null) {
  const w = pos0(m.w);
  const h = pos0(m.h);
  const d = pos0(m.d);
  if (w <= 0 || h <= 0) return '';
  const fw = Math.max(w + d, pos0(frame && frame.w));
  const fh = Math.max(h, pos0(frame && frame.h));
  const fs = Math.max(40, Math.max(fw, fh) / 14);
  const gap = fs * 2.2;
  const ml = fs * 0.6;
  const vbW = ml + fw + gap + fs * 3.6;
  const vbH = fs * 0.6 + fh + fs * 2.6;
  const mt = vbH - fs * 2.6 - h; // 바닥 맞춤 — 키가 작은 장은 아래에 선다
  const sw = Math.max(2, fs * 0.05);
  const parts = [];
  const top = mt;
  parts.push(`<rect x="${ml}" y="${top}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="${sw * 1.4}"/>`);
  if (!m.isOpen && Number(m.doorCount) === 2) parts.push(`<line x1="${ml + w / 2}" y1="${top}" x2="${ml + w / 2}" y2="${top + h}" stroke="#000" stroke-width="${sw}"/>`);
  if (d > 0) {
    const sx = ml + w + gap;
    parts.push(`<rect x="${sx}" y="${top}" width="${d}" height="${h}" fill="#f4f4f4" stroke="#000" stroke-width="${sw * 1.4}"/>`);
    parts.push(`<text x="${sx + d / 2}" y="${top - fs * 0.15}" font-size="${fs * 0.7}" text-anchor="middle" fill="#555">측면</text>`);
    parts.push(hChain([{ x: sx, w: d, label: `D ${num(d)}` }], top + h + fs * 1.3, fs));
  }
  parts.push(hChain([{ x: ml, w, label: `W ${num(w)}` }], top + h + fs * 1.3, fs));
  parts.push(vChain([{ y0: 0, h, label: num(h) }], ml + w + gap + d + fs * 0.6, fs, (y) => top + (h - y)));
  return (
    `<svg class="module-drawing" viewBox="0 0 ${Math.round(vbW)} ${Math.round(vbH)}" xmlns="http://www.w3.org/2000/svg" font-family="'Malgun Gothic', sans-serif">` +
    parts.join('') +
    '</svg>'
  );
}
