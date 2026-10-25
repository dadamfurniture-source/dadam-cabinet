#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, process, console */
// ============================================================
// 설계 유전체 — 자동완성 평가 (연구용, 2026-10-25)
//
// 설계 하나씩 빼고(leave-one-design-out) 나머지를 참조 패널로 두고, 가린 자리의 구조를 맞히는지 잰다.
//
//   가림   autocalc  고정 아닌 자리 전부 (자동계산 직후 — 폭·앵커만 안다)   ← 주 과제 A
//          random30  고정 아닌 자리의 30% (사용자가 일부를 이미 고침)
//          suffix    라인 오른쪽 절반 (왼쪽부터 고쳐 오는 중)
//   방법   B0 자동계산 기본값 · B1 전체 최빈 · B2 사용자 최빈 · B3 이웃 조건부(bigram)
//          M1 LS-HMM 집단 패널 · M2 LS-HMM 개인+집단(λ 0.7, Balding–Nichols) · M2a = M2 + λ = n/(n+κ) ·
//          M3 = M2 + 미러 보강(Z₂)
//   지표   자리별 top-1 · top-3 · 라인 완전 일치 · 고칠 칸 감소(클릭 절약) · 문턱 τ 별 coverage/정확도 ·
//          보정도(ECE) · 학습 곡선 · FCA 규칙 회수 · 연관 스캔 · 라이브러리 choice 일치
//
//   node tools/genome/evaluate.js --out <폴더> [--synthetic] [--users 20 --designs 24 --seed 1]
//        [--sink-hitl <cases 폴더>] [--export <가명화 json>] [--library <dadam-module-library 폴더>] [--maxOthers 150]
//
// 결과 파일(results.json · results.md)은 저장소 밖 폴더에 쓴다.
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const G = require('../../js/planner/planner-genome.js');
const { MASTER_RULES } = require('../../js/planner/planner-engine.js');
const A = require('./algebra.js');
const P = require('./popgen.js');
const { simulate } = require('./simulate.js');
const { fromSinkHitl, fromSupabaseExport } = require('./adapt.js');

const WIDE = MASTER_RULES.DOOR_W_MAX;   // 자동계산은 이보다 넓은 칸을 양문으로 둔다
const SCHEMES = ['autocalc', 'random30', 'suffix'];
const METHODS = ['B0', 'B1', 'B2', 'B3', 'M1', 'M2', 'M3'];
const TAUS = [0.3, 0.5, 0.7, 0.9];

const wc = (W) => (W > WIDE ? 'L' : 'S');

// ── 데이터 ──────────────────────────────────────────────────

function plannerDataset(name, designs) {
  return {
    name, hasUsers: true,
    records: designs.map((d) => ({ user: d.user, id: d.id, t: d.t, weight: d.weight || 1, genome: G.plannerGenomeOf(d), truth: d.truth })),
    // 자동계산 직후의 값 — 넓은 칸 양문, 좁은 칸 단문 경첩 left, 키큰장 도어 단 셋 (autocalc-rules.md §10: 단문은 전부 left)
    defaultAllele: (l, section) => (section === 'tall' || section === 'fridge' ? 'T:DDD/L' : l.W > WIDE ? 'D2' : 'D1/L'),
  };
}

function sinkDataset(dir) {
  const { genomes, generatedBy } = fromSinkHitl(dir);
  return {
    name: 'sink-hitl', hasUsers: false, generatedBy,
    records: genomes.map((g) => ({ user: null, id: g.id, t: g.t, weight: 1, genome: g })),
    defaultAllele: (l) => `door:${l.W > WIDE ? 2 : 1}`,
  };
}

// ── 가림 ────────────────────────────────────────────────────

function maskLine(line, scheme, seed) {
  const free = line.loci.filter((l) => !l.fixed).map((l) => l.i);
  let masked = [];
  if (scheme === 'autocalc') masked = free;
  if (scheme === 'suffix') masked = free.filter((i) => i >= Math.ceil(line.loci.length / 2));
  if (scheme === 'random30') {
    const rand = A.rng(seed);
    masked = free.filter(() => rand() < 0.3);
    if (!masked.length && free.length) masked = [free[Math.floor(rand() * free.length)]];
  }
  const set = new Set(masked);
  const query = { section: line.section, loci: line.loci.map((l) => (set.has(l.i) ? Object.assign({}, l, { allele: null }) : l)) };
  return { query, masked };
}

// ── 방법 ────────────────────────────────────────────────────

function countsBy(lines, keyFns, weightOf) {
  const maps = keyFns.map(() => new Map());
  lines.forEach((ln) => ln.line.loci.forEach((l) => {
    if (!l.allele) return;
    keyFns.forEach((kf, k) => {
      const key = kf(l, ln.line);
      if (!maps[k].has(key)) maps[k].set(key, new Map());
      const m = maps[k].get(key);
      m.set(l.allele.sig, (m.get(l.allele.sig) || 0) + weightOf(ln));
    });
  }));
  return maps;
}

function distOf(m) {
  if (!m || !m.size) return null;
  const z = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()].map(([sig, w]) => ({ sig, p: w / z })).sort((a, b) => b.p - a.p || (a.sig < b.sig ? -1 : 1));
}

const BACKOFF = [(l) => `${wc(l.W)}|${(l.anchors || []).join(',')}`, (l) => wc(l.W), () => '*'];

function backoffDist(maps, l) {
  for (let k = 0; k < maps.length; k++) {
    const d = distOf(maps[k].get(BACKOFF[k](l)));
    if (d) return d;
  }
  return null;
}

function runMethod(method, ds, query, own, others, opts) {
  const masked = query.loci.filter((l) => !l.allele);
  if (method === 'B0') return masked.map((l) => [{ sig: ds.defaultAllele(l, query.section), p: 1 }]);
  if (method === 'B1') {
    const maps = countsBy(own.concat(others), BACKOFF, () => 1);
    return masked.map((l) => backoffDist(maps, l) || [{ sig: ds.defaultAllele(l, query.section), p: 1 }]);
  }
  if (method === 'B2') {
    const mine = countsBy(own, BACKOFF, () => 1);
    const all = countsBy(own.concat(others), BACKOFF, () => 1);
    return masked.map((l) => backoffDist(mine, l) || backoffDist(all, l) || [{ sig: ds.defaultAllele(l, query.section), p: 1 }]);
  }
  if (method === 'B3') {
    // 왼쪽 이웃 조건부 — 본인 설계에 3배 가중. 가린 이웃은 앞에서 고른 값을 쓴다 (탐욕).
    const big = new Map();
    const add = (k, sig, w) => { if (!big.has(k)) big.set(k, new Map()); big.get(k).set(sig, (big.get(k).get(sig) || 0) + w); };
    own.concat(others).forEach((ln) => {
      const w = ln.own ? 3 : 1;
      ln.line.loci.forEach((l, i) => {
        if (!l.allele) return;
        const prev = i > 0 && ln.line.loci[i - 1].allele ? ln.line.loci[i - 1].allele.sig : '^';
        add(`${wc(l.W)}|${prev}`, l.allele.sig, w);
      });
    });
    const mine = countsBy(own, BACKOFF, () => 1);
    const all = countsBy(own.concat(others), BACKOFF, () => 1);
    const out = [];
    let prev = '^';
    query.loci.forEach((l) => {
      if (l.allele) { prev = l.allele.sig; return; }
      const d = distOf(big.get(`${wc(l.W)}|${prev}`)) || backoffDist(mine, l) || backoffDist(all, l) || [{ sig: ds.defaultAllele(l, query.section), p: 1 }];
      out.push(d);
      prev = d[0].sig;
    });
    return out;
  }
  const panel = method === 'M1'
    ? own.concat(others).map((ln) => ({ line: ln.line, own: false, weight: ln.weight }))
    : own.concat(others).map((ln) => ({ line: ln.line, own: ln.own, weight: ln.weight }));
  if (method === 'M3') {
    own.concat(others).forEach((ln) => panel.push({ line: G.plannerGenomeMirrorLine(ln.line), own: ln.own, weight: 0.5 * ln.weight }));
  }
  const r = G.plannerGenomeImpute(query, panel, Object.assign({ k: 0 }, opts, method === 'M2a' ? { lambda: 'auto' } : {}));
  return r.loci.filter((l) => !l.observed).map((l) => (l.dist.length ? l.dist : [{ sig: ds.defaultAllele(query.loci[l.i], query.section), p: 1 }]));
}

// ── 집계 ────────────────────────────────────────────────────

function newAcc() {
  return { n: 0, top1: 0, top3: 0, lines: 0, linesExact: 0, fixes: 0, bins: Array.from({ length: 10 }, () => ({ n: 0, conf: 0, ok: 0 })), tau: Object.fromEntries(TAUS.map((t) => [t, { n: 0, ok: 0 }])) };
}

function record(acc, dists, truths) {
  let exact = true;
  dists.forEach((d, k) => {
    const truth = truths[k];
    const ok = d[0].sig === truth;
    acc.n++;
    if (ok) acc.top1++; else { acc.fixes++; exact = false; }
    if (d.slice(0, 3).some((x) => x.sig === truth)) acc.top3++;
    const c = d[0].p;
    const b = acc.bins[Math.min(9, Math.floor(c * 10))];
    b.n++; b.conf += c; b.ok += ok ? 1 : 0;
    TAUS.forEach((t) => { if (c >= t) { acc.tau[t].n++; acc.tau[t].ok += ok ? 1 : 0; } });
  });
  if (dists.length) { acc.lines++; if (exact) acc.linesExact++; }
}

function summarize(acc) {
  const ece = acc.bins.reduce((a, b) => a + (b.n ? (b.n / acc.n) * Math.abs(b.ok / b.n - b.conf / b.n) : 0), 0);
  return {
    n: acc.n,
    top1: acc.n ? acc.top1 / acc.n : 0,
    top3: acc.n ? acc.top3 / acc.n : 0,
    lineExact: acc.lines ? acc.linesExact / acc.lines : 0,
    fixes: acc.fixes,
    ece,
    tau: Object.fromEntries(TAUS.map((t) => [t, { coverage: acc.n ? acc.tau[t].n / acc.n : 0, accuracy: acc.tau[t].n ? acc.tau[t].ok / acc.tau[t].n : null }])),
  };
}

// ── 패널 ────────────────────────────────────────────────────

function panelIndex(ds, maxOthers, seed) {
  const bySection = new Map();
  ds.records.forEach((r) => r.genome.lines.forEach((line) => {
    if (!bySection.has(line.section)) bySection.set(line.section, []);
    bySection.get(line.section).push({ rec: r, line, weight: r.weight });
  }));
  const rand = A.rng(seed);
  bySection.forEach((list) => {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = list[i]; list[i] = list[j]; list[j] = t; }
  });
  return (rec, section, ownFilter) => {
    const list = bySection.get(section) || [];
    const own = ds.hasUsers ? list.filter((x) => x.rec.user === rec.user && x.rec.id !== rec.id && (!ownFilter || ownFilter(x.rec))).map((x) => Object.assign({ own: true }, x)) : [];
    const others = [];
    for (const x of list) {
      if (others.length >= maxOthers) break;
      if (x.rec.id === rec.id || (ds.hasUsers && x.rec.user === rec.user)) continue;
      others.push(Object.assign({ own: false }, x));
    }
    return { own, others };
  };
}

// ── 평가 본체 ───────────────────────────────────────────────

function evaluate(ds, opt) {
  const o = Object.assign({ maxOthers: 150, seed: 3, methods: METHODS, schemes: SCHEMES, impute: {} }, opt || {});
  const panels = panelIndex(ds, o.maxOthers, o.seed);
  // F — 사용자 간 분화 (하부 라인 대립유전자)
  const byUser = new Map();
  if (ds.hasUsers) {
    ds.records.forEach((r) => r.genome.lines.forEach((ln) => ln.loci.forEach((l) => {
      if (!l.allele) return;
      const key = `${r.user}|${ln.section}`;
      if (!byUser.has(key)) byUser.set(key, new Map());
      byUser.get(key).set(l.allele.sig, (byUser.get(key).get(l.allele.sig) || 0) + 1);
    })));
  }
  const sections = [...new Set(ds.records.flatMap((r) => r.genome.lines.map((l) => l.section)))].sort();
  const Fst = Object.fromEntries(sections.map((s) => [s, ds.hasUsers ? P.estimateF([...byUser.entries()].filter(([k]) => k.endsWith(`|${s}`)).map(([, m]) => m)) : null]));
  const accs = {}, bySection = {};
  const main = o.methods.indexOf('M2') >= 0 ? 'M2' : o.methods.indexOf('M3') >= 0 ? 'M3' : 'M1';
  const completion = { lines: 0, top1: 0, top3: 0 };
  const libHits = { n: 0, inLib: 0, truthN: 0, truthInLib: 0 };
  SCHEMES.forEach((s) => METHODS.forEach((m) => { accs[`${s}|${m}`] = newAcc(); }));
  ds.records.forEach((rec, ri) => {
    rec.genome.lines.forEach((line, li) => {
      const { own, others } = panels(rec, line.section);
      const F = Fst[line.section] == null ? 0.2 : Fst[line.section];
      o.schemes.forEach((scheme) => {
        const { query, masked } = maskLine(line, scheme, 1000 * ri + li + 1);
        if (!masked.length) return;
        const truths = masked.map((i) => line.loci[i].allele.sig);
        o.methods.forEach((method) => {
          const dists = runMethod(method, ds, query, own, others, Object.assign({ F }, o.impute));
          record(accs[`${scheme}|${method}`], dists, truths);
          if (scheme === 'autocalc' && (method === main || method === 'B0')) {
            const key = `${line.section}|${method}`;
            if (!bySection[key]) bySection[key] = newAcc();
            record(bySection[key], dists, truths);
          }
          if (scheme === 'autocalc' && method === 'M2' && o.library) {
            dists.forEach((d, k) => {
              libHits.truthN++;
              if (o.library.has(`${line.section}|${truths[k]}`)) libHits.truthInLib++;
              if (d[0].p >= 0.5) { libHits.n++; if (o.library.has(`${line.section}|${d[0].sig}`)) libHits.inLib++; }
            });
          }
        });
        if (scheme === 'autocalc' && o.methods.indexOf('M2') >= 0) {
          const panel = own.concat(others).map((ln) => ({ line: ln.line, own: ln.own, weight: ln.weight }));
          const r = G.plannerGenomeImpute(query, panel, { F, k: 3 });
          const want = line.loci.map((l) => l.allele.sig).join(' ');
          completion.lines++;
          if (r.completions[0] && r.completions[0].sigs.join(' ') === want) completion.top1++;
          if (r.completions.some((c) => c.sigs.join(' ') === want)) completion.top3++;
        }
      });
    });
  });
  const results = {};
  Object.entries(accs).forEach(([k, a]) => { if (a.n) results[k] = summarize(a); });
  const sec = {};
  Object.entries(bySection).forEach(([k, a]) => { sec[k] = summarize(a); });
  return {
    name: ds.name,
    size: {
      designs: ds.records.length,
      users: ds.hasUsers ? new Set(ds.records.map((r) => r.user)).size : 0,
      lines: ds.records.reduce((a, r) => a + r.genome.lines.length, 0),
      loci: ds.records.reduce((a, r) => a + r.genome.lines.reduce((b, l) => b + l.loci.length, 0), 0),
    },
    Fst, results, bySection: sec, main,
    completion: completion.lines ? { lines: completion.lines, top1: completion.top1 / completion.lines, top3: completion.top3 / completion.lines } : null,
    library: o.library ? { suggestions: libHits.n, inLibrary: libHits.n ? libHits.inLib / libHits.n : null, truthInLibrary: libHits.truthN ? libHits.truthInLib / libHits.truthN : null } : null,
  };
}

/** 학습 곡선 — 본인 설계 앞 N 건만 패널에 두고 뒤쪽 설계를 맞힌다 (autocalc 가림). */
function learningCurve(ds, opt) {
  const o = Object.assign({ Ns: [0, 1, 2, 4, 8, 16], testFrom: 16, maxOthers: 150, seed: 3, methods: ['B1', 'B2', 'M1', 'M2', 'M2a'] }, opt || {});
  const panels = panelIndex(ds, o.maxOthers, o.seed);
  const out = {};
  o.Ns.forEach((N) => {
    const accs = Object.fromEntries(o.methods.map((m) => [m, newAcc()]));
    ds.records.filter((r) => r.t >= o.testFrom).forEach((rec, ri) => {
      rec.genome.lines.forEach((line, li) => {
        const { own, others } = panels(rec, line.section, (r) => r.t < N);
        const { query, masked } = maskLine(line, 'autocalc', 1000 * ri + li + 1);
        if (!masked.length) return;
        const truths = masked.map((i) => line.loci[i].allele.sig);
        o.methods.forEach((m) => record(accs[m], runMethod(m, ds, query, own, others, { F: o.F }), truths));
      });
    });
    out[N] = Object.fromEntries(o.methods.map((m) => [m, summarize(accs[m]).top1]));
  });
  return out;
}

/** 형식 개념 분석 — 사용자마다 기저를 짓고, 심은 규칙을 되찾는지 · 엔진 규칙이 빠지는지. */
function fcaStudy(ds, users) {
  const rows = [];
  const byUser = new Map();
  ds.records.forEach((r) => { if (!byUser.has(r.user)) byUser.set(r.user, []); byUser.get(r.user).push(P.designFeatures(r.genome)); });
  let planted = 0, recovered = 0, engineNoBg = 0, engineBg = 0;
  byUser.forEach((sets, user) => {
    const style = users[user];
    const ctx = A.context(sets);
    const basisBg = A.stemBase(ctx, P.ENGINE_BACKGROUND);
    const basisNo = A.stemBase(ctx);
    const lux = A.luxenburgerBase(ctx, { minConf: 0.8, minSupport: 3 });
    const idx = (names) => names.map((x) => ctx.idx.get(x)).filter((v) => v != null);
    const L = basisBg.concat(lux).map((r) => [idx(r.premise), idx(r.conclusion)]).concat(A.backgroundIn(ctx, P.ENGINE_BACKGROUND));
    const rules = [];
    const letter = { door: 'D', drawer: 'S', open: 'O', rice: 'R', flap: 'F' };
    rules.push([['lower:DR'], [`lower:rail=${style.rail}`, `lower:boxT=${style.boxT}`, `lower:ratio=${style.ratio}`]]);
    if (style.upperOpenFollows) rules.push([['lower:open-end'], ['upper:open-end']]);
    const t = style.tall;
    rules.push([[`tall:low=${letter[t.lower || 'door']}`], [`tall:mid=${letter[t.middle || 'door']}`, `tall:up=${letter[t.upper || 'door']}`]]);
    rules.push([[], [`g:handleType=${style.handleType}`]]);
    let p = 0, r = 0;
    rules.forEach(([prem, concl]) => {
      const support = sets.filter((s) => prem.every((x) => s.indexOf(x) >= 0)).length;
      if (support < 2 || prem.some((x) => !ctx.idx.has(x))) return;
      p++;
      const cl = A.implicationClosure(L, idx(prem));
      if (concl.every((c) => ctx.idx.has(c) && cl.indexOf(ctx.idx.get(c)) >= 0)) r++;
    });
    planted += p; recovered += r;
    const isEngine = (rule) => (rule.conclusion.indexOf('lower:sakuri') >= 0)
      || (rule.premise.indexOf('tall:mid=R') >= 0 && rule.conclusion.indexOf('tall:low=S') >= 0);
    engineNoBg += basisNo.filter(isEngine).length;
    engineBg += basisBg.filter(isEngine).length;
    rows.push({ user, archetype: style.archetype, designs: sets.length, basis: basisBg.length, lux: lux.length, planted: p, recovered: r });
  });
  return { users: rows, planted, recovered, recall: planted ? recovered / planted : null, engineRulesWithoutBackground: engineNoBg, engineRulesWithBackground: engineBg };
}

function associationStudy(ds) {
  const sets = ds.records.map((r) => P.designFeatures(r.genome));
  const pooled = P.associationScan(sets, { minCount: 10, q: 0.05 });
  const byUser = new Map();
  ds.records.forEach((r, i) => { if (!byUser.has(r.user)) byUser.set(r.user, []); byUser.get(r.user).push(sets[i]); });
  // 사용자 안(층화) — 집단 구조(원형)로 생긴 연관은 사용자 안에서는 사라진다. 쌍마다 유의했던 사용자 수.
  const withinPairs = new Map();
  const within = [...byUser.values()].map((s) => {
    const sig = P.associationScan(s, { minCount: 3, q: 0.05 }).filter((x) => x.significant);
    sig.forEach((x) => { const k = `${x.a} ~ ${x.b}`; withinPairs.set(k, (withinPairs.get(k) || 0) + 1); });
    return sig.length;
  });
  const sigPooled = pooled.filter((x) => x.significant);
  return {
    tests: pooled.length,
    significant: sigPooled.length,
    top: sigPooled.slice(0, 10).map((x) => ({ a: x.a, b: x.b, D: x.D, Dprime: x.Dprime, r2: x.r2, p: x.p, q: x.q, withinUsers: withinPairs.get(`${x.a} ~ ${x.b}`) || 0 })),
    withinUserMeanSignificant: within.length ? within.reduce((a, b) => a + b, 0) / within.length : 0,
    withinTop: [...withinPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pair, users]) => ({ pair, users })),
    users: byUser.size,
  };
}

function loadLibrary(dir) {
  const set = new Set();
  const root = path.join(dir, 'modules');
  if (!fs.existsSync(root)) return null;
  fs.readdirSync(root).forEach((group) => {
    const gdir = path.join(root, group);
    if (!fs.statSync(gdir).isDirectory()) return;
    fs.readdirSync(gdir).forEach((id) => {
      const f = path.join(gdir, id, 'module.json');
      if (!fs.existsSync(f)) return;
      const e = JSON.parse(fs.readFileSync(f, 'utf8'));
      set.add(`${e.section}|${G.plannerGenomeChoiceAllele(e.choice).sig}`);
    });
  });
  return set;
}

// ── 보고서 ──────────────────────────────────────────────────

const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);

function markdown(all) {
  const L = [];
  L.push('# 설계 유전체 자동완성 평가', '', `생성: ${all.generatedAt}`, '');
  all.datasets.forEach((r) => {
    L.push(`## ${r.name}`, '', `설계 ${r.size.designs} · 사용자 ${r.size.users} · 라인 ${r.size.lines} · 좌위 ${r.size.loci}`, '');
    if (r.Fst) L.push(`Fst: ${Object.entries(r.Fst).map(([s, f]) => `${s} ${f == null ? '—' : f.toFixed(3)}`).join(' · ')}`, '');
    SCHEMES.forEach((s) => {
      const rows = METHODS.filter((m) => r.results[`${s}|${m}`]);
      if (!rows.length) return;
      const b0 = r.results[`${s}|B0`];
      L.push(`### 가림 ${s}`, '', '| 방법 | 자리 수 | top-1 | top-3 | 라인 완전 일치 | 고칠 칸 | 클릭 절약 (B0 대비) | ECE |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
      rows.forEach((m) => {
        const x = r.results[`${s}|${m}`];
        const save = b0 && b0.fixes ? 1 - x.fixes / b0.fixes : null;
        L.push(`| ${m} | ${x.n} | ${pct(x.top1)} | ${pct(x.top3)} | ${pct(x.lineExact)} | ${x.fixes} | ${pct(save)} | ${x.ece.toFixed(3)} |`);
      });
      L.push('');
    });
    const m2 = r.results['autocalc|M2'];
    if (m2) {
      L.push('### M2 확신 문턱 (autocalc)', '', '| τ | 제안 비율 | 제안 정확도 |', '| --- | --- | --- |');
      TAUS.forEach((t) => L.push(`| ${t} | ${pct(m2.tau[t].coverage)} | ${pct(m2.tau[t].accuracy)} |`));
      L.push('');
    }
    const secs = Object.keys(r.bySection).map((k) => k.split('|')[0]).filter((v, i, a) => a.indexOf(v) === i);
    if (secs.length) {
      L.push('### 섹션별 (autocalc)', '', `| 섹션 | B0 top-1 | ${r.main} top-1 | 자리 수 |`, '| --- | --- | --- | --- |');
      secs.forEach((s) => {
        const b = r.bySection[`${s}|B0`], m = r.bySection[`${s}|${r.main}`];
        L.push(`| ${s} | ${pct(b && b.top1)} | ${pct(m && m.top1)} | ${m ? m.n : 0} |`);
      });
      L.push('');
    }
    if (r.completion) L.push(`라인 전체 완성(M2 k-best, autocalc): 1안 일치 ${pct(r.completion.top1)} · 3안 안 ${pct(r.completion.top3)} (${r.completion.lines} 라인)`, '');
    if (r.library) L.push(`라이브러리 choice 일치: 확신 ≥ 0.5 제안 ${r.library.suggestions}건 중 ${pct(r.library.inLibrary)} · 정답 대립유전자 중 ${pct(r.library.truthInLibrary)}`, '');
    if (r.learningCurve) {
      const ms = Object.keys(Object.values(r.learningCurve)[0]);
      L.push('### 학습 곡선 (본인 설계 N 건, autocalc top-1)', '', `| N | ${ms.join(' | ')} |`, `| --- | ${ms.map(() => '---').join(' | ')} |`);
      Object.entries(r.learningCurve).forEach(([N, row]) => L.push(`| ${N} | ${ms.map((m) => pct(row[m])).join(' | ')} |`));
      L.push('');
    }
    if (r.fca) {
      L.push('### 형식 개념 분석', '', `심은 규칙 ${r.fca.planted}개 중 ${r.fca.recovered}개 회수 (${pct(r.fca.recall)}). 엔진 규칙이 기저에 나온 수: 배경 없음 ${r.fca.engineRulesWithoutBackground} → 배경 함의 ${r.fca.engineRulesWithBackground}.`, '');
      L.push('| 사용자 | 원형 | 설계 | DG 기저 | Luxenburger | 심은 규칙 | 회수 |', '| --- | --- | --- | --- | --- | --- | --- |');
      r.fca.users.forEach((u) => L.push(`| ${u.user} | ${u.archetype} | ${u.designs} | ${u.basis} | ${u.lux} | ${u.planted} | ${u.recovered} |`));
      L.push('');
    }
    if (r.association) {
      L.push('### 연관 스캔 (설계 단위 속성 쌍, 정확검정 + BH q 0.05)', '', `검정 ${r.association.tests} · 유의 ${r.association.significant} · 사용자 안에서 평균 유의 ${r.association.withinUserMeanSignificant.toFixed(1)}`, '');
      L.push('| 속성 A | 속성 B | D | D′ | r² | p | q | 사용자 안 유의 |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
      r.association.top.forEach((x) => L.push(`| ${x.a} | ${x.b} | ${x.D.toFixed(3)} | ${x.Dprime.toFixed(2)} | ${x.r2.toFixed(2)} | ${x.p.toExponential(1)} | ${x.q.toExponential(1)} | ${x.withinUsers}/${r.association.users} |`));
      L.push('', '사용자 안에서 자주 유의한 쌍:', '');
      r.association.withinTop.forEach((x) => L.push(`- ${x.pair} — ${x.users}명`));
      L.push('');
    }
  });
  return L.join('\n');
}

module.exports = { evaluate, learningCurve, fcaStudy, associationStudy, plannerDataset, sinkDataset, maskLine, runMethod };

if (require.main === module) {
  const has = (k) => process.argv.indexOf(`--${k}`) > 0;
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const out = arg('out');
  if (!out) { console.error('사용법: node tools/genome/evaluate.js --out <폴더> [--synthetic] [--sink-hitl <폴더>] [--export <json>] [--library <폴더>]'); process.exit(1); }
  const library = arg('library') ? loadLibrary(arg('library')) : null;
  const maxOthers = +arg('maxOthers', 150);
  const all = { generatedAt: new Date().toISOString(), datasets: [] };
  const t0 = Date.now();
  if (has('synthetic')) {
    const sim = simulate({ users: +arg('users', 20), designs: +arg('designs', 24), seed: +arg('seed', 1) });
    const ds = plannerDataset('합성 (원형 A·B·C, ε 0.08)', sim.designs);
    const r = evaluate(ds, { library, maxOthers });
    r.learningCurve = learningCurve(ds, { maxOthers, F: r.Fst.lower });
    r.fca = fcaStudy(ds, sim.users);
    r.association = associationStudy(ds);
    all.datasets.push(r);
    console.log(`합성 평가 끝 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  if (arg('sink-hitl')) {
    const ds = sinkDataset(arg('sink-hitl'));
    const r = evaluate(ds, { maxOthers, methods: ['B0', 'B1', 'B3', 'M1', 'M3'] });
    r.generatedBy = ds.generatedBy;
    all.datasets.push(r);
    console.log(`싱크 케이스 평가 끝 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  if (arg('export')) {
    const designs = fromSupabaseExport(arg('export'));
    const users = new Map();
    designs.forEach((d) => { users.set(d.user, (users.get(d.user) || 0) + 1); });
    // 시간 순 번호 — 학습 곡선이 '앞 N 건' 을 고를 수 있게
    const seen = new Map();
    designs.forEach((d) => { d.t = seen.get(d.user) || 0; seen.set(d.user, d.t + 1); });
    const ds = plannerDataset('실데이터 (가명화)', designs.filter((d) => users.get(d.user) >= 2));
    all.datasets.push(evaluate(ds, { library, maxOthers }));
    console.log(`실데이터 평가 끝 (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(all, null, 1));
  fs.writeFileSync(path.join(out, 'results.md'), markdown(all));
  console.log(`→ ${path.join(out, 'results.md')}`);
}
