/* global module */
// ============================================================
// 설계 유전체 — 대수적 연관분석 (오프라인 연구 도구, 2026-10-25)
//
//   1. 대수통계   2원표 정확검정 — 주변합이 같은 표들(fiber)을 Markov basis 이동으로 돈다
//                 (Diaconis–Sturmfels 1998). 기본 이동 = 2×2 소행렬식 모양 (+1 −1 / −1 +1).
//                 엔진이 금지한 칸(구조적 영)은 0 으로 묶고, 기본 이동만으로 안 이어지면
//                 차수 3 고리(3×3 순환)를 더한다 (Aoki–Takemura 의 준독립 모형).
//                 Benjamini–Hochberg FDR.
//   2. Möbius 반전 부분집합 격자 위의 상호작용 계수 (로그선형 · Beerenwinkel–Pachter–Sturmfels 상위성 좌표)
//   3. 형식 개념 분석(FCA) 갈루아 연결 · NextClosure · Duquenne–Guigues 기저(배경 함의 포함) ·
//                 Luxenburger 기저(이웃 개념 사이 부분 규칙)
//   4. 생성함수   폭 합이 L 인 모듈 열의 수 · 확률 질량 = 다항식 계수
//
// 플래너에 싣지 않는다. 연구 도구(tools/genome/evaluate.js)와 시험만 쓴다.
// ============================================================
'use strict';

// ── 1. 대수통계 ──────────────────────────────────────────────

/** 2×2 소행렬식 p11·p22 − p12·p21 (확률표면 LD 의 D). */
function minor2x2(t) {
  return t[0][0] * t[1][1] - t[0][1] * t[1][0];
}

function margins(table) {
  const rows = table.map((r) => r.reduce((a, b) => a + b, 0));
  const cols = table[0].map((_, j) => table.reduce((a, r) => a + r[j], 0));
  return { rows, cols };
}

const logFact = (() => {
  const memo = [0];
  return (n) => {
    for (let i = memo.length; i <= n; i++) memo.push(memo[i - 1] + Math.log(i));
    return memo[n];
  };
})();

/** 독립(또는 준독립) 모형에서 주변합을 고정했을 때 표의 로그확률 (상수 제외): −Σ log t_ij! */
function logWeight(table) {
  let s = 0;
  table.forEach((r) => r.forEach((v) => { s -= logFact(v); }));
  return s;
}

/**
 * 주변합이 같은 표를 전부 센다 (작은 표 전용 — 시험과 정확 p값 확인용).
 * @param {number[]} rows @param {number[]} cols
 * @param {boolean[][]} [zeros] true 인 칸은 구조적 영 (언제나 0)
 */
function enumerateFiber(rows, cols, zeros) {
  const R = rows.length, C = cols.length;
  const out = [];
  const t = rows.map(() => new Array(C).fill(0));
  const colLeft = cols.slice();
  const fillRow = (i, j, left) => {
    if (i === R) {
      if (colLeft.every((c) => c === 0)) out.push(t.map((r) => r.slice()));
      return;
    }
    if (j === C - 1) {
      if (zeros && zeros[i][j] && left > 0) return;
      if (left > colLeft[j]) return;
      t[i][j] = left; colLeft[j] -= left;
      fillRow(i + 1, 0, i + 1 < R ? rows[i + 1] : 0);
      colLeft[j] += left; t[i][j] = 0;
      return;
    }
    const hi = zeros && zeros[i][j] ? 0 : Math.min(left, colLeft[j]);
    for (let v = 0; v <= hi; v++) {
      t[i][j] = v; colLeft[j] -= v;
      fillRow(i, j + 1, left - v);
      colLeft[j] += v; t[i][j] = 0;
    }
  };
  fillRow(0, 0, rows[0]);
  return out;
}

/**
 * Markov 이동 목록. 기본 이동(차수 2)과, 구조적 영이 있으면 차수 3 고리.
 * 이동 = [[i, j, ±1], …] — 행합·열합을 바꾸지 않는다. 구조적 영 칸을 건드리는 이동은 뺀다.
 */
function markovMoves(R, C, zeros, opt) {
  const z = (i, j) => !!(zeros && zeros[i][j]);
  const moves = [];
  for (let i = 0; i < R; i++) for (let k = i + 1; k < R; k++) {
    for (let j = 0; j < C; j++) for (let l = j + 1; l < C; l++) {
      const mv = [[i, j, 1], [k, l, 1], [i, l, -1], [k, j, -1]];
      if (mv.every(([a, b]) => !z(a, b))) moves.push(mv);
    }
  }
  const withLoops = (opt && opt.degree3) != null ? opt.degree3 : !!zeros;
  if (withLoops && R >= 3 && C >= 3) {
    // 3×3 순환: (r0,c0)+ (r0,c1)− (r1,c1)+ (r1,c2)− (r2,c2)+ (r2,c0)−
    const perms3 = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (let a = 0; a < R; a++) for (let b = a + 1; b < R; b++) for (let c = b + 1; c < R; c++) {
      for (let x = 0; x < C; x++) for (let y = x + 1; y < C; y++) for (let w = y + 1; w < C; w++) {
        const rs = [a, b, c], cs = [x, y, w];
        perms3.forEach((p) => {
          const r0 = rs[p[0]], r1 = rs[p[1]], r2 = rs[p[2]];
          const mv = [[r0, cs[0], 1], [r0, cs[1], -1], [r1, cs[1], 1], [r1, cs[2], -1], [r2, cs[2], 1], [r2, cs[0], -1]];
          if (mv.every(([i, j]) => !z(i, j))) moves.push(mv);
        });
      }
    }
  }
  return moves;
}

function applyMove(t, mv, sign) {
  for (const [i, j, d] of mv) if (t[i][j] + sign * d < 0) return null;
  const n = t.map((r) => r.slice());
  for (const [i, j, d] of mv) n[i][j] += sign * d;
  return n;
}

/** 이동으로 닿는 표 전부 (BFS) — fiber 와 같으면 이동 집합이 그 fiber 를 잇는다. */
function reachable(start, moves) {
  const key = (t) => t.map((r) => r.join(',')).join(';');
  const seen = new Map([[key(start), start]]);
  const queue = [start];
  while (queue.length) {
    const t = queue.shift();
    for (const mv of moves) for (const sg of [1, -1]) {
      const n = applyMove(t, mv, sg);
      if (n && !seen.has(key(n))) { seen.set(key(n), n); queue.push(n); }
    }
  }
  return [...seen.values()];
}

/** 결정적 의사난수 (mulberry32) — 같은 seed 면 같은 p값. */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 정확검정 (확률 기준, Fisher 정확검정의 일반화): p = Σ_{P(T') ≤ P(T)} P(T').
 * fiber 가 작으면 전부 세고, 크면 Markov basis 위 Metropolis 연쇄로 추정한다.
 * @param {number[][]} table
 * @param {{zeros?:boolean[][], iters?:number, burn?:number, seed?:number, enumerateMax?:number}} [opt]
 * @returns {{p:number, method:'enumerate'|'mcmc', fiberSize?:number, moves:number}}
 */
function exactTest(table, opt) {
  const o = Object.assign({ iters: 20000, burn: 2000, seed: 7, enumerateMax: 20000 }, opt || {});
  const { rows, cols } = margins(table);
  const obs = logWeight(table);
  const eps = 1e-9;
  const moves = markovMoves(rows.length, cols.length, o.zeros);
  // 작은 fiber 는 정확하게
  const size = fiberSizeBound(rows, cols);
  if (size <= o.enumerateMax) {
    const fiber = enumerateFiber(rows, cols, o.zeros);
    const lw = fiber.map(logWeight);
    const m = Math.max(...lw);
    const z = lw.reduce((a, v) => a + Math.exp(v - m), 0);
    const tail = lw.reduce((a, v) => a + (v <= obs + eps ? Math.exp(v - m) : 0), 0);
    return { p: tail / z, method: 'enumerate', fiberSize: fiber.length, moves: moves.length };
  }
  const rand = rng(o.seed);
  let t = table.map((r) => r.slice());
  let cur = obs;
  let hit = 0, n = 0;
  for (let it = 0; it < o.iters + o.burn; it++) {
    if (moves.length) {
      const mv = moves[Math.floor(rand() * moves.length)];
      const nt = applyMove(t, mv, rand() < 0.5 ? 1 : -1);
      if (nt) {
        const lw = logWeight(nt);
        if (Math.log(rand()) < lw - cur) { t = nt; cur = lw; }
      }
    }
    if (it >= o.burn) { n++; if (cur <= obs + eps) hit++; }
  }
  return { p: hit / n, method: 'mcmc', moves: moves.length };
}

/** fiber 크기 위쪽 어림 (전부 셀지 정하는 데만 쓴다). */
function fiberSizeBound(rows, cols) {
  let b = 1;
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols.length - 1; j++) {
    b *= Math.min(rows[i], cols[j]) + 1;
    if (b > 1e9) return b;
  }
  return b;
}

/** Benjamini–Hochberg — q 수준에서 기각되는가 + 보정 p. */
function benjaminiHochberg(pvals, q) {
  const m = pvals.length;
  const order = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const adj = new Array(m);
  let minSoFar = 1;
  for (let r = m - 1; r >= 0; r--) {
    const [p, i] = order[r];
    minSoFar = Math.min(minSoFar, (p * m) / (r + 1));
    adj[i] = minSoFar;
  }
  return { adjusted: adj, reject: adj.map((a) => a <= (q == null ? 0.1 : q)) };
}

// ── 2. Möbius 반전 ───────────────────────────────────────────

/** f(U) (U = 비트마스크, 길이 2^n) → 상호작용 u(T) = Σ_{U⊆T} (−1)^{|T∖U|} f(U). */
function mobius(f) {
  const u = f.slice();
  const n = Math.log2(f.length);
  for (let b = 0; b < n; b++) for (let m = 0; m < f.length; m++) if (m & (1 << b)) u[m] -= u[m ^ (1 << b)];
  return u;
}

/** 역변환 (zeta): f(T) = Σ_{U⊆T} u(U). zeta(mobius(f)) = f. */
function zeta(u) {
  const f = u.slice();
  const n = Math.log2(u.length);
  for (let b = 0; b < n; b++) for (let m = 0; m < u.length; m++) if (m & (1 << b)) f[m] += f[m ^ (1 << b)];
  return f;
}

/**
 * 이진 선택 n 개의 개수표(비트마스크 → 개수) → 로그선형 상호작용 계수.
 * 0 칸은 pseudo 를 더한다 (로그 0 방지). u[0b11] = 로그 오즈비, u[0b111] = 3차 상위성.
 */
function interactions(counts, pseudo) {
  const ps = pseudo == null ? 0.5 : pseudo;
  return mobius(counts.map((c) => Math.log(c + ps)));
}

// ── 3. 형식 개념 분석 ────────────────────────────────────────

/**
 * 형식 맥락 — 대상(설계) × 속성. 속성 집합은 비트마스크(BigInt 없이 32개 이하) 대신 정렬 배열 번호 집합으로 둔다.
 * @param {string[][]} objects 대상마다 속성 이름 배열
 * @param {string[]} [attributes] 속성 순서 (없으면 이름순)
 */
function context(objects, attributes) {
  const M = attributes || [...new Set(objects.flat())].sort();
  const idx = new Map(M.map((m, i) => [m, i]));
  const rows = objects.map((o) => new Set(o.map((a) => idx.get(a))));
  return { M, idx, rows };
}

/** B' = B 를 모두 가진 대상들. */
function extentOf(ctx, B) {
  const out = [];
  ctx.rows.forEach((r, g) => { if (B.every((b) => r.has(b))) out.push(g); });
  return out;
}

/** B'' — 개념 닫힘. 대상이 없으면 전체 속성. */
function closure(ctx, B) {
  const ext = extentOf(ctx, B);
  if (!ext.length) return ctx.M.map((_, i) => i);
  return ctx.M.map((_, i) => i).filter((m) => ext.every((g) => ctx.rows[g].has(m)));
}

/** 함의 집합 L 로 닫기 (A → B 가 A ⊆ X 면 X ∪= B). */
function implicationClosure(L, X) {
  const S = new Set(X);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of L) {
      if (a.every((x) => S.has(x)) && b.some((y) => !S.has(y))) { b.forEach((y) => S.add(y)); changed = true; }
    }
  }
  return [...S].sort((p, q) => p - q);
}

/**
 * NextClosure (Ganter) — 닫힘 연산 cl 에 대해 A 다음의 닫힌 집합 (lectic 순서). 없으면 null.
 * 속성 번호가 작을수록 '앞'이다.
 */
function nextClosure(A, m, cl) {
  const has = new Set(A);
  for (let i = m - 1; i >= 0; i--) {
    if (has.has(i)) { has.delete(i); continue; }
    const B = cl([...has, i].sort((p, q) => p - q));
    if (B.every((b) => b >= i || has.has(b))) return B;
  }
  return null;
}

/** 모든 개념 내포(intent) — 개념 격자의 원소. */
function allIntents(ctx) {
  const m = ctx.M.length;
  const cl = (X) => closure(ctx, X);
  const out = [];
  let A = cl([]);
  while (A) {
    out.push(A);
    if (A.length === m) break;
    A = nextClosure(A, m, cl);
  }
  return out;
}

/**
 * Duquenne–Guigues 기저 (stem base) — 신뢰도 100% 함의의 최소 완전 집합.
 * background(배경 함의, 이름으로)를 주면 그것으로 따라 나오는 함의는 내지 않는다 (엔진 규칙 빼기).
 * @returns {{premise:string[], conclusion:string[], support:number}[]}
 */
function stemBase(ctx, background) {
  const m = ctx.M.length;
  const K = backgroundIn(ctx, background);
  const L = [];
  const cl = (X) => implicationClosure(K.concat(L), X);
  let A = cl([]);
  while (A) {
    const AA = closure(ctx, A);
    if (AA.length !== A.length) L.push([A, AA.filter((x) => A.indexOf(x) < 0)]);
    if (A.length === m) break;
    A = nextClosure(A, m, cl);
  }
  // 읽기용 — 배경 함의로 따라 나오는 결론 속성은 뺀다 (기저 ∪ 배경 의 닫힘은 그대로다)
  //   하나씩 차례로 뺀다 — 서로를 낳는 배경 함의가 있어도 둘 다 지워지지 않는다
  const reduce = (a, b) => {
    let keep = b.slice();
    b.forEach((x) => {
      const rest = a.concat(keep.filter((y) => y !== x));
      if (implicationClosure(K, rest).indexOf(x) >= 0) keep = keep.filter((y) => y !== x);
    });
    return keep;
  };
  return L.map(([a, b]) => ({
    premise: a.map((i) => ctx.M[i]),
    conclusion: reduce(a, b).map((i) => ctx.M[i]),
    support: extentOf(ctx, a).length,
  })).filter((r) => r.conclusion.length);
}

/**
 * 배경 함의를 이 맥락의 번호로. 전제 속성이 하나라도 맥락에 없으면 그 함의는 뺀다 —
 * 빠진 속성을 지우고 남기면 전제가 줄어 (빈 전제면 언제나) 잘못 발동한다.
 */
function backgroundIn(ctx, background) {
  return (background || [])
    .filter(([a]) => a.every((x) => ctx.idx.has(x)))
    .map(([a, b]) => [a.map((x) => ctx.idx.get(x)).sort((p, q) => p - q), b.filter((x) => ctx.idx.has(x)).map((x) => ctx.idx.get(x))])
    .filter(([, b]) => b.length);
}

/**
 * Luxenburger 기저 — 이웃 개념 B₁ ⊂ B₂ 사이의 부분 규칙 B₁ → B₂∖B₁ (신뢰도 |B₂'| / |B₁'|).
 * @param {{minConf?:number, minSupport?:number}} [opt]
 */
function luxenburgerBase(ctx, opt) {
  const o = Object.assign({ minConf: 0.5, minSupport: 2 }, opt || {});
  const intents = allIntents(ctx);
  const ext = intents.map((B) => extentOf(ctx, B).length);
  const sub = (a, b) => a.length < b.length && a.every((x) => b.indexOf(x) >= 0);
  const rules = [];
  intents.forEach((B1, i) => {
    intents.forEach((B2, j) => {
      if (!sub(B1, B2) || !ext[i]) return;
      // 이웃인가 — 사이에 다른 내포가 없어야 한다
      if (intents.some((C) => sub(B1, C) && sub(C, B2))) return;
      const conf = ext[j] / ext[i];
      if (conf >= 1 || conf < o.minConf || ext[j] < o.minSupport) return;
      rules.push({
        premise: B1.map((x) => ctx.M[x]),
        conclusion: B2.filter((x) => B1.indexOf(x) < 0).map((x) => ctx.M[x]),
        confidence: conf,
        support: ext[j],
      });
    });
  });
  return rules.sort((a, b) => b.confidence - a.confidence || b.support - a.support);
}

/** 함의 A → B 가 맥락에서 성립하는가 (A 를 가진 모든 대상이 B 도 가진다). */
function holds(ctx, premise, conclusion) {
  const a = premise.map((x) => ctx.idx.get(x));
  const b = conclusion.map((x) => ctx.idx.get(x));
  return ctx.rows.every((r) => !a.every((x) => r.has(x)) || b.every((y) => r.has(y)));
}

// ── 4. 생성함수 ──────────────────────────────────────────────

/**
 * 모듈 수를 정하지 않은 열 — [x^L] 1/(1 − Σ_m p_m x^{W_m}). p 를 1 로 두면 '폭 합이 L 인 열의 수'.
 * @param {{W:number, p?:number}[]} items
 * @param {number} L
 * @param {number} [step] 폭 공약수 (계산 크기 줄이기)
 */
function sequenceCoefficient(items, L, step) {
  const s = step || 1;
  const n = Math.round(L / s);
  const f = new Array(n + 1).fill(0);
  f[0] = 1;
  for (let k = 1; k <= n; k++) {
    for (const it of items) {
      const w = Math.round(it.W / s);
      if (w <= k) f[k] += (it.p == null ? 1 : it.p) * f[k - w];
    }
  }
  return f[n];
}

/**
 * 자리 수가 정해진 열 — [x^L] Π_j (Σ_m p_{j,m} x^{W_m}). slots[j] = 그 자리 후보.
 */
function slotsCoefficient(slots, L, step) {
  const s = step || 1;
  const n = Math.round(L / s);
  let poly = new Array(n + 1).fill(0);
  poly[0] = 1;
  for (const cands of slots) {
    const next = new Array(n + 1).fill(0);
    for (let k = 0; k <= n; k++) {
      if (!poly[k]) continue;
      for (const c of cands) {
        const w = Math.round(c.W / s);
        if (k + w <= n) next[k + w] += poly[k] * (c.p == null ? 1 : c.p);
      }
    }
    poly = next;
  }
  return poly[n];
}

module.exports = {
  minor2x2, margins, logWeight, enumerateFiber, markovMoves, reachable, exactTest, benjaminiHochberg, rng,
  mobius, zeta, interactions,
  context, extentOf, closure, implicationClosure, nextClosure, allIntents, stemBase, backgroundIn, luxenburgerBase, holds,
  sequenceCoefficient, slotsCoefficient,
};
