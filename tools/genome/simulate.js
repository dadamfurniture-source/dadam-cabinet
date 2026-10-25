#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, process, console */
// ============================================================
// 설계 유전체 — 합성 사용자 생성기 (연구용, 2026-10-25)
//
// 유전학에서 방법을 시험하는 방식 그대로: 정답(심은 패턴)을 알고 데이터를 만든 뒤
// 방법이 그 패턴을 되찾는지 본다. 실제 고객 데이터는 쓰지 않는다.
//
// 집단 구조: 원형(archetype) 셋 A·B·C 가 집단에 섞여 있고, 사용자는 원형 하나를 물려받은 뒤
// 속성 몇 개가 집단 풀에서 다시 뽑힌다(개인 변이). 설계마다 좌위가 ε 확률로 흔들린다(돌연변이).
//
// 라인 만들기 — 플래너 자동계산과 같은 폭: 개수대 장(분배기 자리) 양옆 빈자리를
// planner-engine.js distributeModules 로 나눈다. 그 폭 위에 사용자 스타일대로 대립유전자를 고른다.
// 결과는 플래너 구조 단계와 같은 모양 {modules, structures} — plannerGenomeOf 로 읽는다.
//
//   node tools/genome/simulate.js --out <폴더> [--users 20] [--designs 24] [--seed 1]
// ============================================================
'use strict';

const path = require('path');
const fs = require('fs');
const Engine = require('../../js/planner/planner-engine.js');
const DrawerRules = require('../../js/detaildesign/bom-drawer-rules.js');
const { rng } = require('./algebra.js');

/** 원형 — 집단에 섞인 스타일. 숫자는 합성용 확률일 뿐 설계 규칙이 아니다. */
const ARCHETYPES = {
  A: { share: 0.45, drawerSide: 1, pDrawer: 0.9, ratio: '2:1:1', rail: 'ball', boxT: 18, hinge: 'wall', pOpenEnd: 0.15, upperOpenFollows: false, hoodFlap: true, pTall: 0.6, tall: { lower: 'drawer', middle: 'rice', upper: 'door', riceDoor: 'swing' }, handleType: 'wood-channel', legH: 150 },
  B: { share: 0.35, drawerSide: -1, pDrawer: 0.75, ratio: '1:1:2', rail: 'under', boxT: 0, hinge: 'sink', pOpenEnd: 0.6, upperOpenFollows: true, hoodFlap: false, pTall: 0.4, tall: { lower: 'drawer', middle: 'open', upper: 'open' }, handleType: 'channel', legH: 120 },
  C: { share: 0.2, drawerSide: 2, pDrawer: 0.5, ratio: '2:2', rail: 'under', boxT: 0, hinge: 'left', pOpenEnd: 0.05, upperOpenFollows: false, hoodFlap: false, pTall: 0.2, tall: { lower: 'door', middle: 'door', upper: 'flap' }, handleType: 'c-channel', legH: 150 },
};
const POOL = {
  drawerSide: [1, -1, 2, -2], ratio: ['2:1:1', '1:1:2', '2:2', '2:2:2', '1:2:1'], rail: ['ball', 'under'], boxT: [18, 0],
  hinge: ['wall', 'sink', 'left'], handleType: ['wood-channel', 'channel', 'c-channel'], legH: [150, 120],
};

function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

/** 사용자 스타일 — 원형 + 개인 변이 (속성마다 pVar 확률로 집단 풀에서 다시 뽑기). */
function userStyle(rand, pVar) {
  const r = rand();
  let acc = 0, arche = 'A';
  for (const [k, a] of Object.entries(ARCHETYPES)) { acc += a.share; if (r < acc) { arche = k; break; } }
  const s = JSON.parse(JSON.stringify(ARCHETYPES[arche]));
  s.archetype = arche;
  Object.keys(POOL).forEach((k) => { if (rand() < pVar) s[k] = pick(rand, POOL[k]); });
  return s;
}

// ── 구조 (lib/library.js structureOf 와 같은 펼침 — 서랍 등급은 엔진이 낸다) ──
function cell(W, dir, is2D) {
  return { moduleKind: 'normal', verticalCount: 1, horizontalLayout: 'doorOnly', areaTypes: ['door'], areaDirections: [dir], areaWidths: [W], areaIs2D: [!!is2D], shelves: [] };
}
function drawerStructure(W, d) {
  const r = DrawerRules.gradesFromRatio(d.ratio, { topDrawer: true });
  return Object.assign(cell(W, 'left', false), {
    horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerCount: r.drawerCount,
    drawer: { rail: d.rail, sakuri: true, boxT: d.boxT, grades: r.grades, doorGrade: r.doorGrade, topDrawer: true },
  });
}
function tallTier(W, kind, t, hinge) {
  if (kind === 'flap') return cell(W, 'up', false);
  if (kind === 'door') return cell(W, hinge, false);
  if (kind === 'drawer') return drawerStructure(W, { ratio: '2:2', rail: 'under', boxT: 0 });
  if (kind === 'open') return Object.assign(cell(W, 'left', false), { moduleKind: 'open' });
  return Object.assign(cell(W, t.riceDoor === 'swing' ? hinge : 'left', false), { moduleKind: 'rice', rice: { door: t.riceDoor } });
}

/** 경첩 — 스타일 규칙대로 (벽 쪽 · 개수대 쪽 · 언제나 왼쪽). plannerGenomeHingeRel 과 같은 뜻. */
function hingeFor(rule, i, n, sinkAt) {
  if (rule === 'left') return 'left';
  if (rule === 'sink' && sinkAt != null && i !== sinkAt) return i > sinkAt ? 'left' : 'right';
  return i < (n - 1) / 2 ? 'left' : 'right';   // 'wall' (가까운 끝 쪽에 경첩)
}

/** 한 칸 [x0, x1] 을 자동계산 폭으로 나눈다. */
function segment(x0, x1) {
  const L = Math.round(x1 - x0);
  if (L < 350) return [];
  const r = Engine.distributeModules(L);
  const out = [];
  let x = x0;
  r.modules.forEach((m) => { out.push({ x, W: m.w, is2D: m.is2D }); x += m.w; });
  return out;
}

/**
 * 설계 한 건.
 * @returns {{modules:object[], structures:object, truth:object}}
 */
function makeDesign(rand, style, eps, idx) {
  const L = 2400 + Math.round(rand() * 180) * 10;             // 벽 2400~4200
  const sinkW = pick(rand, [800, 900, 1000]);
  const sinkX = Math.round((L * (0.25 + rand() * 0.3)) / 10) * 10;
  const hasTall = rand() < style.pTall && L >= 3000;
  const lineEnd = hasTall ? L - 600 : L;
  const modules = [], structures = {};
  let k = 0;
  const add = (section, x, W, s, extra) => {
    const id = `${section}-${k++}`;
    modules.push(Object.assign({ id, areaId: `area-${section}-0`, section, x, W, rotation: 0 }, extra || {}));
    if (s) structures[id] = Object.assign(s, { handleType: style.handleType }, section === 'lower' ? { legH: style.legH } : {});
    return id;
  };
  // 하부 라인: 왼쪽 빈자리 · 개수대 장 · 오른쪽 빈자리
  const slots = segment(0, sinkX).concat([{ x: sinkX, W: sinkW, is2D: true, sink: true }], segment(sinkX + sinkW, lineEnd));
  const n = slots.length;
  const sinkAt = slots.findIndex((s) => s.sink);
  const truth = { lowerOpenEnd: false, drawerAt: null };
  const openEnd = rand() < style.pOpenEnd;
  const drawerAt = rand() < style.pDrawer ? sinkAt + style.drawerSide : -1;
  slots.forEach((sl, i) => {
    let s;
    const noisy = rand() < eps;
    if (i === drawerAt && !sl.sink && !noisy) {
      s = drawerStructure(sl.W, style);
      truth.drawerAt = i - sinkAt;
    } else if (openEnd && i === n - 1 && !sl.sink && !noisy) {
      s = Object.assign(cell(sl.W, 'left', false), { moduleKind: 'open' });
      truth.lowerOpenEnd = true;
    } else if (sl.is2D) {
      s = cell(sl.W, 'left', true);
    } else {
      const h = hingeFor(noisy ? pick(rand, POOL.hinge) : style.hinge, i, n, sinkAt);
      s = cell(sl.W, h, false);
    }
    add('lower', sl.x, sl.W, s);
  });
  add('sink', sinkX, sinkW, null, { areaId: 'area-sink-0' });
  // 상부 라인: 후드 자리(개수대 장 끝에서 600 떨어진 곳, 오른쪽에 한 칸 이상 남긴다) · 나머지
  const hoodX = Math.min(lineEnd - 900 - 450, sinkX + sinkW + 600);
  const uSlots = segment(0, hoodX).concat([{ x: hoodX, W: 900, is2D: true, hood: true }], segment(hoodX + 900, lineEnd));
  const un = uSlots.length;
  const uOpen = style.upperOpenFollows ? truth.lowerOpenEnd : rand() < 0.1;
  uSlots.forEach((sl, i) => {
    let s;
    const noisy = rand() < eps;
    if (sl.hood && style.hoodFlap && !noisy) s = cell(sl.W, 'up', false);
    else if (uOpen && i === un - 1 && !sl.hood && !noisy) s = Object.assign(cell(sl.W, 'left', false), { moduleKind: 'open' });
    else if (sl.is2D) s = cell(sl.W, 'left', true);
    else s = cell(sl.W, hingeFor(noisy ? pick(rand, POOL.hinge) : style.hinge, i, un, null), false);
    add('upper', sl.x, sl.W, s);
  });
  add('hood', hoodX, 900, null, { areaId: 'area-hood-0' });
  // 키큰장 한 통 (오른쪽 끝)
  if (hasTall) {
    const t = rand() < eps ? pick(rand, Object.values(ARCHETYPES)).tall : style.tall;
    const hinge = style.hinge === 'left' ? 'left' : 'right';  // 오른쪽 끝 통 — 벽 쪽 경첩
    [['lower', 0, '하부장'], ['middle', 900, '중간장'], ['upper', 1400, '상부장']].forEach(([key, baseY, part]) => {
      add('tall', L - 600, 600, tallTier(600, t[key] || 'door', t, hinge), { baseY, part });
    });
  }
  return { modules, structures, truth: Object.assign(truth, { L, idx }) };
}

/**
 * @param {{users?:number, designs?:number, seed?:number, eps?:number, pVar?:number}} [opt]
 * @returns {{designs:object[], users:object}}
 */
function simulate(opt) {
  const o = Object.assign({ users: 20, designs: 24, seed: 1, eps: 0.08, pVar: 0.25 }, opt || {});
  const rand = rng(o.seed);
  const designs = [];
  const users = {};
  for (let u = 0; u < o.users; u++) {
    const user = `u${String(u).padStart(2, '0')}`;
    const style = userStyle(rand, o.pVar);
    users[user] = style;
    for (let d = 0; d < o.designs; d++) {
      const des = makeDesign(rand, style, o.eps, d);
      designs.push({ user, id: `${user}-d${String(d).padStart(2, '0')}`, t: d, weight: 1, modules: des.modules, structures: des.structures, truth: des.truth });
    }
  }
  return { designs, users, opt: o };
}

module.exports = { simulate, userStyle, makeDesign, ARCHETYPES, POOL };

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const out = arg('out');
  if (!out) { console.error('사용법: node tools/genome/simulate.js --out <폴더> [--users 20] [--designs 24] [--seed 1]'); process.exit(1); }
  const res = simulate({ users: +arg('users', 20), designs: +arg('designs', 24), seed: +arg('seed', 1) });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'synthetic.json'), JSON.stringify(res));
  console.log(`합성 설계 ${res.designs.length}건 (사용자 ${Object.keys(res.users).length}명) → ${path.join(out, 'synthetic.json')}`);
}
