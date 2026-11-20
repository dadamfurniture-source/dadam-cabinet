/**
 * 조립 지시서 새 틀 (sheet_layout 2) — 모듈마다 3D 제작도 + 모듈 내용
 *   (2026-11-20 사장님 「3.조립 : 치수 숫자 더 크고 굵게 다른 그림에 겹치지 않게 구분이 확실히 되도, 모듈 명세 필요없음. 모듈 제작도 3d 도면으로
 *    크게 표시, 정면, 측면도는 없음, 모듈 내용 추가(색상, 부재정보, 목찬넬 따내기 지점, 다리발 또는 좌대, 철물, 가전정보 등) 조립순서 체크 필요없음」 ·
 *    질문 창 「모듈마다 앱이 조립 명세로 그림」)
 *
 * 3D 는 동결본의 조립 명세(bom_payload.assembly — 판마다 자리 box{min,max} · 다리발 자리)를 그대로 비스듬히 위에서 본 그림으로 옮긴다
 *   (오른쪽 앞 위에서 본 등각 — 앞(+z) · 오른쪽(+x) · 윗면이 보인다). 도어 · 서랍 앞판은 속이 보이게 투명한 선으로. 판 자리 · 치수를 새로 만들지 않는다.
 * 모듈 내용은 그 모듈의 자재 행 · 철물 행 · 명세의 따내기(features)에서 센다. 명세가 없는 모듈은 카드에 「조립 명세 없음」.
 * 그림 크기 · 선 · 글자 크기 · 칠은 그림용 값이다.
 */
import { esc, num } from './html.js';

const COS30 = Math.cos(Math.PI / 6);

/** 등각 투영 — 오른쪽 앞 위에서 (x 오른쪽, y 위, z 앞) → 그림 (sx 오른쪽, sy 아래) */
const proj = (x, y, z) => [(x - z) * COS30, (x + z) * 0.5 - y];

const FRONT_RE = /^(도어|서랍도어)$/;

/** 판 하나의 보이는 세 면 (윗면 · 앞면 · 오른쪽면) */
function faces(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  return [
    { k: 'top', pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
    { k: 'front', pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { k: 'right', pts: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]] },
  ];
}

const FILL = { top: '#f1f1f1', front: '#ffffff', right: '#dcdcdc' };

/**
 * 모듈 하나 3D (조립 명세 그대로) — 폭 · 높이 · 깊이 치수는 굵고 크게, 그림 밖에 (겹치지 않게)
 * @param {object} mod 조립 명세의 모듈 { box{W,H,D}, parts[{part, box{min,max}}], hardware[{kind:'leg', at, size}] }
 * @returns {string} svg ('' = 그릴 판 없음)
 */
export function moduleIsoSvg(mod) {
  const boxes = [];
  for (const p of Array.isArray(mod && mod.parts) ? mod.parts : []) {
    const b = p && p.box;
    if (!b || !Array.isArray(b.min) || !Array.isArray(b.max)) continue;
    boxes.push({ min: b.min.map(Number), max: b.max.map(Number), front: FRONT_RE.test(String(p.part || '')), part: p.part });
  }
  for (const h of Array.isArray(mod && mod.hardware) ? mod.hardware : []) {
    if (!h || h.kind !== 'leg' || !Array.isArray(h.at) || !Array.isArray(h.size)) continue;
    const [ax, ay, az] = h.at.map(Number);
    const [sx, sy, sz] = h.size.map(Number);
    boxes.push({ min: [ax - sx / 2, ay, az - sz / 2], max: [ax + sx / 2, ay + sy, az + sz / 2], leg: true });
  }
  if (!boxes.length || boxes.some((b) => [...b.min, ...b.max].some((v) => !Number.isFinite(v)))) return '';
  const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i])));
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const fs = Math.max(70, span * 0.085);            // 치수 글자 (그림 단위 mm)
  const sw = Math.max(1.6, span * 0.0022);
  // 먼 판부터 (화면 깊이 = x + z 가 작고 y 가 낮은 것) — 겹쳐 그리기
  const depth = (b) => (b.min[0] + b.max[0]) / 2 + (b.min[2] + b.max[2]) / 2 + (b.min[1] + b.max[1]) / 2 * 0.2;
  const order = boxes.slice().sort((a, b) => (a.front === b.front ? depth(a) - depth(b) : a.front ? 1 : -1));
  const poly = (pts) => pts.map((p) => proj(...p).map((v) => v.toFixed(1)).join(',')).join(' ');
  const body = order.map((b) => faces(b.min, b.max).map((f) => (b.front
    ? `<polygon points="${poly(f.pts)}" fill="#1d4f91" fill-opacity="0.04" stroke="#1d4f91" stroke-width="${(sw * 0.8).toFixed(1)}" stroke-dasharray="${(sw * 5).toFixed(1)} ${(sw * 3).toFixed(1)}"/>`
    : `<polygon points="${poly(f.pts)}" fill="${b.leg ? '#bdbdbd' : FILL[f.k]}" stroke="#000" stroke-width="${sw.toFixed(1)}" stroke-linejoin="round"/>`)).join('')).join('');

  // 치수 — 몸통(box) 값을 적는다 (없으면 판 범위). 선은 몸통 모서리 바깥으로
  const W = Number(mod.box && mod.box.W) || hi[0] - lo[0];
  const H = Number(mod.box && mod.box.H) || hi[1] - lo[1];
  const D = Number(mod.box && mod.box.D) || hi[2] - lo[2];
  const x0 = -W / 2, x1 = W / 2, z0 = -D / 2, z1 = D / 2;
  const off = fs * 2.2;
  const dim = (a, b, n, label) => {
    // a → b 를 그림 위에서 n(그림 단위 법선) 쪽으로 off 만큼 띄운 치수선
    const [ax, ay] = proj(...a);
    const [bx, by] = proj(...b);
    const ox = n[0] * off, oy = n[1] * off;
    const mx = (ax + bx) / 2 + ox + n[0] * fs * 0.9, my = (ay + by) / 2 + oy + n[1] * fs * 0.9;
    return `<line x1="${(ax + ox).toFixed(1)}" y1="${(ay + oy).toFixed(1)}" x2="${(bx + ox).toFixed(1)}" y2="${(by + oy).toFixed(1)}" stroke="#1d4f91" stroke-width="${(sw * 1.2).toFixed(1)}"/>`
      + `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${(ax + ox * 1.15).toFixed(1)}" y2="${(ay + oy * 1.15).toFixed(1)}" stroke="#1d4f91" stroke-width="${(sw * 0.7).toFixed(1)}"/>`
      + `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${(bx + ox * 1.15).toFixed(1)}" y2="${(by + oy * 1.15).toFixed(1)}" stroke="#1d4f91" stroke-width="${(sw * 0.7).toFixed(1)}"/>`
      + `<text x="${mx.toFixed(1)}" y="${(my + fs * 0.35).toFixed(1)}" font-size="${fs.toFixed(1)}" font-weight="700" text-anchor="middle" fill="#0b2545" paint-order="stroke" stroke="#fff" stroke-width="${(fs * 0.18).toFixed(1)}">${label}</text>`;
  };
  const yb = 0;
  const dims = [
    // 폭 — 앞 아래 모서리, 아래쪽 왼편으로
    dim([x0, yb, z1], [x1, yb, z1], [-0.5, 0.866], `W ${num(W)}`),
    // 깊이 — 오른쪽 아래 모서리, 아래쪽 오른편으로
    dim([x1, yb, z1], [x1, yb, z0], [0.5, 0.866], `D ${num(D)}`),
    // 높이 — 앞 왼쪽 세로 모서리, 왼쪽으로
    dim([x0, yb, z1], [x0, H, z1], [-1, 0], `H ${num(H)}`),
  ].join('');
  const pts = boxes.flatMap((b) => faces(b.min, b.max).flatMap((f) => f.pts.map((p) => proj(...p))));
  const minX = Math.min(...pts.map((p) => p[0])) - off - fs * 4;
  const maxX = Math.max(...pts.map((p) => p[0])) + off + fs * 4;
  const minY = Math.min(...pts.map((p) => p[1])) - fs * 1.5;
  const maxY = Math.max(...pts.map((p) => p[1])) + off + fs * 2.5;
  const vw = maxX - minX, vh = maxY - minY;
  return `<svg class="mod-iso" viewBox="${minX.toFixed(0)} ${minY.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}" xmlns="http://www.w3.org/2000/svg" font-family="'Malgun Gothic', 'Pretendard', sans-serif">${body}${dims}</svg>`;
}

// ── 모듈 내용 ─────────────────────────────────────────────────────

/** 목찬넬 따내기 자리 — 명세 features(src 에 channel) 를 「측판 위 앞 40 × 70」 처럼 */
export function notchLinesOf(mod) {
  const out = [];
  const seen = new Set();
  for (const p of Array.isArray(mod && mod.parts) ? mod.parts : []) {
    const cut = p && p.cut;
    for (const f of Array.isArray(p && p.features) ? p.features : []) {
      if (!f || f.type !== 'notch') continue;
      const w = Math.round(Number(f.u1) - Number(f.u0));
      const h = Math.round(Number(f.v1) - Number(f.v0));
      if (!(w > 0) || !(h > 0)) continue;
      const vTop = cut && Math.abs(Number(f.v1) - Number(cut.h)) < 0.6;
      const vBot = Math.abs(Number(f.v0)) < 0.6;
      const uFront = cut && Math.abs(Number(f.u1) - Number(cut.w)) < 0.6;
      const where = `${vTop ? '위' : vBot ? '아래' : `밑에서 ${num(Math.round(Number(f.v0)))}`} ${uFront ? '앞' : Math.abs(Number(f.u0)) < 0.6 ? '뒤' : ''}`.trim();
      const what = /channel/.test(String(f.src || '')) ? '목찬넬 따내기' : '따내기';
      const key = `${p.part}|${what}|${where}|${w}|${h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${what} — ${p.part} ${where} ${num(w)} × ${num(h)}`);
    }
  }
  return out;
}

/** 같은 것끼리 수량을 더해 「이름 × n」 */
function tally(list) {
  const map = new Map();
  for (const { key, qty } of list) map.set(key, (map.get(key) || 0) + qty);
  return [...map.entries()].map(([k, n]) => `${k} × ${num(n)}`);
}

/**
 * 모듈 카드 표 — 색상 · 부재 · 목찬넬 따내기 · 다리발 / 좌대 · 철물 · 전기 · 가전
 * @param {{rows:object[], hardware:object[], mod:object|null, colorName:(code:string)=>string}} o
 */
export function moduleInfoRows({ rows, hardware, mod, colorName }) {
  const body = [...new Set(rows.filter((m) => m.partClass === '본체' && m.color).map((m) => m.color))];
  const doorCodes = [...new Set(rows.filter((m) => FRONT_RE.test(String(m.part || '')) || m.partClass === '도어').map((m) => m.finishCode || m.color).filter(Boolean))];
  const back = [...new Set(rows.filter((m) => m.partClass === '뒷판' && m.color).map((m) => m.color))];
  const color = [
    body.length ? `몸통 ${body.map(esc).join(' · ')}` : '',
    doorCodes.length ? `도어 ${doorCodes.map((c) => esc(colorName(c))).join(' · ')}` : '',
    back.length ? `우라 ${back.map(esc).join(' · ')}` : '',
  ].filter(Boolean).join(' / ');
  const parts = rows.filter((m) => !/좌대/.test(String(m.part || ''))).map((m) => `${esc(m.part || '')} ${num(m.w)}×${num(m.h)} ${esc(m.material || '')}${num(m.thickness)}T × ${num(m.qty)}`);
  const notches = mod ? notchLinesOf(mod) : [];
  const legs = (mod && Array.isArray(mod.hardware) ? mod.hardware : []).filter((h) => h && h.kind === 'leg');
  const pedestal = rows.filter((m) => /좌대/.test(String(m.part || '')));
  const support = [
    legs.length ? `다리발 ${esc(legs[0].spec || legs[0].item || '')} × ${num(legs.length)}` : '',
    pedestal.length ? `좌대 ${pedestal.map((m) => `${num(m.w)}×${num(m.h)} × ${num(m.qty)}`).join(' · ')}` : '',
  ].filter(Boolean).join(' · ');
  const isElec = (h) => h.category === '전기';
  const metal = tally(hardware.filter((h) => !isElec(h) && h.category !== '다리발').map((h) => ({ key: `${esc(h.category || '')} ${esc(h.item || '')}${h.spec && h.spec !== '-' ? ` ${esc(h.spec)}` : ''}`, qty: Number(h.qty) || 0 })));
  const elec = tally(hardware.filter(isElec).map((h) => ({ key: `${esc(h.item || '')}${h.spec && h.spec !== '-' ? ` ${esc(h.spec)}` : ''}`, qty: Number(h.qty) || 0 })));
  return [
    ['색상', color || '<span class="muted">—</span>'],
    ['부재', parts.length ? parts.join('<br>') : '<span class="muted">—</span>'],
    ['목찬넬 따내기', notches.length ? notches.map(esc).join('<br>') : '<span class="muted">없음</span>'],
    ['다리발 · 좌대', support || '<span class="muted">없음</span>'],
    ['철물', metal.length ? metal.join('<br>') : '<span class="muted">없음</span>'],
    ['전기 · 가전', elec.length ? elec.join('<br>') : '<span class="muted">없음</span>'],
  ];
}

const ASM_CSS = `<style>
.asm-card { border: 0.6pt solid #000; padding: 3mm; margin: 0 0 4mm; display: grid; grid-template-columns: 58% 1fr; gap: 3mm; break-inside: avoid; page-break-inside: avoid; }
.asm-card h3 { grid-column: 1 / -1; margin: 0; font-size: 13pt; }
.asm-card h3 small { font-size: 9.5pt; font-weight: 400; color: #444; }
.asm-card .asm-3d svg { display: block; width: 100%; height: auto; max-height: 112mm; }
.asm-card .asm-3d .ph { height: 40mm; display: flex; align-items: center; justify-content: center; color: #888; border: 0.4pt dashed #999; }
.asm-card table { width: 100%; border-collapse: collapse; margin: 0; font-size: 9pt; }
.asm-card th { width: 22mm; text-align: left; background: #eee; vertical-align: top; }
.asm-card th, .asm-card td { border: 0.4pt solid #000; padding: 2pt 4pt; }
</style>`;

/**
 * 모듈 카드들 — 품목(벽) · 모듈 차례대로, 쪽에 두 장.
 * @param {object} ctx work-order.js buildContext
 */
export function assemblyCards(ctx) {
  const asm = ctx.snapshot && ctx.snapshot.bom_payload && ctx.snapshot.bom_payload.assembly;
  const specMods = new Map();
  for (const it of asm && Array.isArray(asm.items) ? asm.items : []) for (const m of Array.isArray(it.modules) ? it.modules : []) if (m && m.moduleKey) specMods.set(m.moduleKey, { mod: m, item: it.label || '' });
  // 모듈 차례 — 자재 행에 처음 나온 차례 (앱 정면도 번호 「#n」 차례)
  const keys = [];
  const labelOf = new Map();
  for (const m of ctx.materials) {
    const k = m.moduleKey || null;
    if (!k || labelOf.has(k)) continue;
    labelOf.set(k, { module: m.module || '', item: m.itemLabel || '' });
    keys.push(k);
  }
  for (const k of specMods.keys()) if (!labelOf.has(k)) { labelOf.set(k, { module: '', item: specMods.get(k).item }); keys.push(k); }
  const colorName = (code) => {
    const s = ctx.swatchByCode && ctx.swatchByCode.get(code);
    return s && s.color_name && s.color_name !== code ? `${s.color_name} (${code})` : code;
  };
  const cards = keys.map((k) => {
    const rows = ctx.materials.filter((m) => m.moduleKey === k);
    const hardware = ctx.hardware.filter((h) => h.moduleKey === k);
    const spec = specMods.get(k);
    const mod = spec ? spec.mod : null;
    const svg = mod ? moduleIsoSvg(mod) : '';
    const lab = labelOf.get(k);
    const size = mod && mod.box ? `몸통 ${num(mod.box.W)} × ${num(mod.box.H)} × ${num(mod.box.D)} · ${num(mod.box.T)}T` : '';
    const info = moduleInfoRows({ rows, hardware, mod, colorName }).map(([h, d]) => `<tr><th>${esc(h)}</th><td>${d}</td></tr>`).join('');
    return `<div class="asm-card"><h3>${esc(lab.module || k)} <small>${esc(lab.item)}${size ? ` · ${esc(size)}` : ''}</small></h3><div class="asm-3d">${svg || '<div class="ph">조립 명세 없음 — 플래너에서 다시 보내 주세요</div>'}</div><table>${info}</table></div>`;
  });
  if (!cards.length) return '';
  const pages = [];
  for (let i = 0; i < cards.length; i += 2) pages.push(`<div class="sheet">${i === 0 ? '<div class="section-title">모듈 제작도 <span class="muted">조립 명세 3D · 굵은 숫자 = 몸통 치수 mm · 점선 = 도어 · 서랍 앞판</span></div>' : ''}${cards.slice(i, i + 2).join('')}</div>`);
  return ASM_CSS + pages.join('');
}

