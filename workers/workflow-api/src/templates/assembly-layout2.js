/**
 * 조립 지시서 새 틀 (sheet_layout 2) — 모듈마다 3D 제작도 + 모듈 내용
 *   (2026-11-20 사장님 「3.조립 : 치수 숫자 더 크고 굵게 다른 그림에 겹치지 않게 구분이 확실히 되도, 모듈 명세 필요없음. 모듈 제작도 3d 도면으로
 *    크게 표시, 정면, 측면도는 없음, 모듈 내용 추가(색상, 부재정보, 목찬넬 따내기 지점, 다리발 또는 좌대, 철물, 가전정보 등) 조립순서 체크 필요없음」 ·
 *    질문 창 「모듈마다 앱이 조립 명세로 그림」)
 *
 * 제작도는 동결본의 조립 명세(bom_payload.assembly)를 3면도(정면 · 우측면 · 평면) + 등각으로 그린다 — cad-views.js moduleCadSvg
 *   (2026-11-21 사장님 「조립 도면 … 캐드 스킬 등을 사용해서 정확하게」 · 질문 창 「3D 등각 + 3면도」). 판 자리 · 치수를 새로 만들지 않는다.
 * 모듈 내용은 그 모듈의 자재 행 · 철물 행 · 명세의 따내기(features)에서 센다. 명세가 없는 모듈은 카드에 「조립 명세 없음」.
 * 그림 크기 · 선 · 글자 크기 · 칠은 그림용 값이다.
 */
import { esc, num } from './html.js';
import { unitNameOf } from '../hardware-units.js';
import { moduleCadSvg } from './cad-views.js';

const FRONT_RE = /^(도어|서랍도어)$/;

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

/** 같은 것끼리 수량을 더해 「이름 × n단위」 (2026-11-21 단위 — 개 · 세트 · 조) */
function tally(list) {
  const map = new Map();
  for (const { key, qty, unit } of list) {
    const k = `${key}\u0000${unit || ''}`;
    map.set(k, (map.get(k) || 0) + qty);
  }
  return [...map.entries()].map(([k, n]) => {
    const [name, unit] = k.split('\u0000');
    return `${name} × ${num(n)}${unit ? esc(unitNameOf(unit)) : ''}`;
  });
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
  const metal = tally(hardware.filter((h) => !isElec(h) && h.category !== '다리발').map((h) => ({ key: `${esc(h.category || '')} ${esc(h.item || '')}${h.spec && h.spec !== '-' ? ` ${esc(h.spec)}` : ''}`, qty: Number(h.qty) || 0, unit: h.unit })));
  const elec = tally(hardware.filter(isElec).map((h) => ({ key: `${esc(h.item || '')}${h.spec && h.spec !== '-' ? ` ${esc(h.spec)}` : ''}`, qty: Number(h.qty) || 0, unit: h.unit })));
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
.asm-card { border: 0.6pt solid #000; padding: 3mm; margin: 0 0 4mm; display: grid; grid-template-columns: 1fr; gap: 3mm; break-inside: avoid; page-break-inside: avoid; }
.asm-card h3 { grid-column: 1 / -1; margin: 0; font-size: 13pt; }
.asm-card h3 small { font-size: 9.5pt; font-weight: 400; color: #444; }
.asm-card .asm-3d svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
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
    if (m.siteBar) continue;   // 현장 재단 막대 — 모듈 카드가 아니라 현장 재단표 (installation-order.js siteCutBlock)
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
    const svg = mod ? moduleCadSvg(mod) : '';
    const lab = labelOf.get(k);
    const size = mod && mod.box ? `몸통 ${num(mod.box.W)} × ${num(mod.box.H)} × ${num(mod.box.D)} · ${num(mod.box.T)}T` : '';
    const info = moduleInfoRows({ rows, hardware, mod, colorName }).map(([h, d]) => `<tr><th>${esc(h)}</th><td>${d}</td></tr>`).join('');
    return `<div class="asm-card"><h3>${esc(lab.module || k)} <small>${esc(lab.item)}${size ? ` · ${esc(size)}` : ''}</small></h3><div class="asm-3d">${svg || '<div class="ph">조립 명세 없음 — 플래너에서 다시 보내 주세요</div>'}</div><table>${info}</table></div>`;
  });
  if (!cards.length) return '';
  const pages = [];
  // 한 쪽에 한 모듈 — 3면도 + 등각이 축척대로 들어가게
  cards.forEach((c, i) => pages.push(`<div class="sheet">${i === 0 ? '<div class="section-title">모듈 제작도 <span class="muted">3면도 (3각법) + 등각 · 조립 명세 그대로 · mm</span></div>' : ''}${c}</div>`));
  return ASM_CSS + pages.join('');
}

