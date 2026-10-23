/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * 골든 픽스처(합성) → 조립 명세. 조립 검사 시험과 CAD 검산기 덤프(tools/cad/dump-assembly.js)가 같은 입력을 쓴다.
 * 선반 높이는 플래너 기본값 (__tests__/bom-assembly.test.js 와 같다).
 */
const engine = require('../js/planner/planner-engine.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const { MaterialExtractor } = require('../js/detaildesign/extractors.js');
const { FIXTURES } = require('./bom-golden/fixtures.js');

const NAMES = ['sink15', 'sink18', 'sinkCorner', 'shoerack', 'vanity', 'storage', 'warehouse', 'wardrobe', 'fridge'];

/** 플래너 기본 선반 높이 — 사쿠리 몸통은 안쪽 균등, 아니면 몸통 높이 균등. */
function shelfYOf(materials) {
  const out = {};
  const byMk = {};
  materials.forEach((r) => { (byMk[r.moduleKey] = byMk[r.moduleKey] || []).push(r); });
  Object.keys(byMk).forEach((mk) => {
    const rows = byMk[mk];
    const side = rows.find((r) => r.part === '측판');
    const n = rows.filter((r) => r.part === '선반').reduce((s, r) => s + r.qty, 0);
    if (!side || !n) return;
    const H = side.h, T = side.thickness;
    out[mk] = /sakuri/.test(side.note || '')
      ? engine.shelvesEvenInner(H, n, T)
      : Array.from({ length: n }, (_, i) => Math.round((H / (n + 1)) * (i + 1)));
  });
  return out;
}

/** @returns {{design, materials, spec}} */
function specOf(name) {
  const design = { items: [FIXTURES[name]] };
  const materials = new MaterialExtractor().extract(design).materials;
  return { design, materials, spec: Asm.of(design, { materials, shelfY: shelfYOf(materials) }) };
}

module.exports = { NAMES, shelfYOf, specOf };
