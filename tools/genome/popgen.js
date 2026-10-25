/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module */
// ============================================================
// 설계 유전체 — 집단유전 통계 (연구용, 2026-10-25)
//
//   estimateF          사용자–전체 분화 Fst (Hudson 식 — 표본 잡음 보정). Balding–Nichols 축소의 F 로 쓴다.
//   designFeatures     설계 한 건 → 속성 집합 (FCA 맥락 · 연관 검사용 '형질')
//   associationScan    속성 쌍마다 2×2 표 → LD(D·D′·r²) + 정확검정 p + BH-FDR (GWAS 의 연관 스캔)
//   ENGINE_BACKGROUND  엔진 규칙에서 바로 나오는 함의 — FCA 배경 지식 (학습 대상이 아니다)
// ============================================================
'use strict';

const G = require('../../js/planner/planner-genome.js');
const A = require('./algebra.js');

/**
 * Fst — 대립유전자마다 (사용자 간 빈도 분산 − 표본 분산) / p̄(1−p̄) 를 모아 비로 낸다.
 * @param {Map<string,number>[]} userCounts 사용자마다 대립유전자 개수
 * @returns {number} 0.01 ~ 0.99
 */
function estimateF(userCounts) {
  const users = userCounts.filter((m) => [...m.values()].reduce((a, b) => a + b, 0) >= 2);
  if (users.length < 2) return 0.2;
  const keys = new Set(users.flatMap((m) => [...m.keys()]));
  let num = 0, den = 0;
  keys.forEach((k) => {
    const ps = users.map((m) => {
      const n = [...m.values()].reduce((a, b) => a + b, 0);
      return { p: (m.get(k) || 0) / n, n };
    });
    const pbar = ps.reduce((a, x) => a + x.p, 0) / ps.length;
    const varU = ps.reduce((a, x) => a + (x.p - pbar) ** 2, 0) / (ps.length - 1);
    const samp = ps.reduce((a, x) => a + (x.p * (1 - x.p)) / Math.max(1, x.n - 1), 0) / ps.length;
    num += varU - samp;
    den += pbar * (1 - pbar);
  });
  if (den <= 0) return 0.2;
  return Math.min(0.99, Math.max(0.01, num / den));
}

/** 엔진 규칙에서 바로 나오는 함의 (lib/library.js · bom-rice-cabinet-rules: 밥솥장은 아래 단 서랍, 라이브러리 서랍은 사쿠리). */
const ENGINE_BACKGROUND = [
  [['tall:mid=R'], ['tall:low=S']],
  [['lower:DR'], ['lower:sakuri']],
];

/**
 * 설계 한 건의 속성 집합. 이름 = '<섹션>:<무엇>'.
 *   lower:DR · lower:rail=ball · lower:boxT=18 · lower:sakuri · lower:drawer@sink+1 · lower:open-end
 *   lower:hinge=wall|room (다수) · upper:hood=flap · upper:open-end · tall:<서명> · tall:low=S · tall:mid=R
 *   g:handleType=… · g:legH=…
 */
function designFeatures(genome) {
  const f = new Set();
  genome.lines.forEach((line) => {
    const sec = line.section;
    const hinge = { wall: 0, room: 0 };
    line.loci.forEach((l, i) => {
      if (!l.allele) return;
      const sig = l.allele.sig;
      const head = G.plannerGenomeHead(sig);
      if (head === 'DR') {
        f.add(`${sec}:DR`);
        const tail = sig.split('|');
        f.add(`${sec}:rail=${tail[1]}`);
        f.add(`${sec}:boxT=${tail[2]}`);
        if (tail[3] === 'sk') f.add(`${sec}:sakuri`);
        f.add(`${sec}:ratio=${tail[0].slice(3)}`);
        if (l.fromSink != null) f.add(`${sec}:drawer@sink${l.fromSink >= 0 ? '+' : ''}${l.fromSink}`);
      }
      if (sig === 'OPEN' && i === line.loci.length - 1) f.add(`${sec}:open-end`);
      if (sig === 'OPEN' && i === 0) f.add(`${sec}:open-start`);
      if (sig === 'D1/U' && l.anchors.indexOf('hood') >= 0) f.add(`${sec}:hood=flap`);
      if (head === 'T') {
        f.add(`tall:${sig.replace(/\/[LR]$/, '')}`);
        const letters = sig.slice(2, 5);
        f.add(`tall:low=${letters[0]}`);
        if (letters[1]) f.add(`tall:mid=${letters[1]}`);
        if (letters[2]) f.add(`tall:up=${letters[2]}`);
      }
      const rel = G.plannerGenomeHingeRel(l);
      if (rel.wall) hinge[rel.wall]++;
    });
    if (hinge.wall + hinge.room >= 2) f.add(`${sec}:hinge=${hinge.wall >= hinge.room ? 'wall' : 'room'}`);
  });
  Object.entries(genome.globals || {}).forEach(([k, v]) => f.add(`g:${k}=${v}`));
  return [...f].sort();
}

/**
 * 속성 가족 — 같은 대립유전자에서 갈라져 나온 속성(서랍장의 비율·레일·자재, 키큰장의 단들)은 한 가족이다.
 * 가족 안 쌍은 연관이 정의로 생기므로 스캔하지 않는다. 같은 속성의 다른 값(=)도 한 가족(늘 배타).
 */
function familyOf(f) {
  const [sec, rest] = [f.slice(0, f.indexOf(':')), f.slice(f.indexOf(':') + 1)];
  if (sec === 'tall') return 'tall';
  if (/^(DR|rail=|boxT=|ratio=|sakuri|drawer@)/.test(rest)) return `${sec}:drawer`;
  return f.split('=')[0];
}

/**
 * 연관 스캔 — 속성 쌍마다 2×2 표.
 * @param {string[][]} sets 설계마다 속성
 * @param {{minCount?:number, q?:number}} [opt]
 * @returns {{a:string, b:string, n11:number, D:number, Dprime:number, r2:number, p:number, q:number, significant:boolean}[]}
 */
function associationScan(sets, opt) {
  const o = Object.assign({ minCount: 5, q: 0.05 }, opt || {});
  const N = sets.length;
  const count = new Map();
  sets.forEach((s) => s.forEach((x) => count.set(x, (count.get(x) || 0) + 1)));
  const feats = [...count.keys()].filter((x) => count.get(x) >= o.minCount && count.get(x) <= N - o.minCount).sort();
  const has = sets.map((s) => new Set(s));
  const out = [];
  for (let i = 0; i < feats.length; i++) for (let j = i + 1; j < feats.length; j++) {
    const a = feats[i], b = feats[j];
    if (familyOf(a) === familyOf(b)) continue;   // 같은 모듈에서 나온 속성끼리는 정의상 묶여 있다
    let n11 = 0, n12 = 0, n21 = 0, n22 = 0;
    has.forEach((h) => {
      const x = h.has(a), y = h.has(b);
      if (x && y) n11++; else if (x) n12++; else if (y) n21++; else n22++;
    });
    const ld = G.plannerGenomeLD(n11, n12, n21, n22);
    const p = A.exactTest([[n11, n12], [n21, n22]]).p;
    out.push({ a, b, n11, n12, n21, n22, D: ld.D, Dprime: ld.Dprime, r2: ld.r2, p });
  }
  const bh = A.benjaminiHochberg(out.map((r) => r.p), o.q);
  out.forEach((r, k) => { r.q = bh.adjusted[k]; r.significant = bh.reject[k]; });
  return out.sort((x, y) => x.p - y.p || y.r2 - x.r2);
}

module.exports = { estimateF, designFeatures, associationScan, familyOf, ENGINE_BACKGROUND };
