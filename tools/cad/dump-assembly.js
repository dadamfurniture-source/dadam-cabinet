#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * CAD 검산기 입력 덤프 (다담 CAD 베타 PR8 — docs/01-plan/planner-cad.plan.md §PR8).
 *
 * 골든 픽스처(합성 데이터만 — 저장소가 공개)마다 조립 명세를 만들어 JSON 으로 쓴다.
 * build_from_spec.py 가 이 JSON 만 읽어 판재를 OCC 솔리드로 짓고, JS 검사기 답과 대조한다.
 * 파이썬에 규칙 숫자를 두지 않으려고 축 벡터 · 겹침 문턱 · 허용 오차도 여기서 싣는다.
 *
 *   node tools/cad/dump-assembly.js <outDir> [fixture…]     (픽스처를 안 주면 전부)
 *
 * 출력 <outDir>/<fixture>.json — 스키마 dadam.cad-oracle/1:
 *   axes       { '+x': [1,0,0], … }  frame 축 이름 → 벡터 (bom-assembly AXES 와 같다)
 *   limits     겹침 문턱 { minVolume mm³, minDepth mm } (assembly-check DEFAULT_LIMITS)
 *   tolerance  { volumeRel } 부피 대조 상대 오차 (계획 PR8 완료 기준 ±0.1%)
 *   modules[]  { moduleKey, parts[], overlaps[] }
 *     parts[]    { id, part, t, cut {w,h}, frame {o,u,v,n}, notches [{u0,u1,v0,v1}], volume }
 *                volume = JS 가 판을 상자로 쪼갠 부피 합 (관통 따내기를 뺀 값, 홈은 깊이 미정이라 안 뺀다)
 *     overlaps[] { a, b, volume, depth }  JS findOverlaps 의 쌍 — 홈 끼움 제외 전 (OCC 는 홈 규칙을 모른다)
 */
const fs = require('fs');
const path = require('path');

global.dlog = global.dlog || (() => {});
const Asm = require('../../js/detaildesign/bom-assembly.js');
const Check = require('../../js/detaildesign/assembly-check.js');
const { NAMES, specOf } = require('../../test-utils/assembly-fixtures.js');

const SCHEMA = 'dadam.cad-oracle/1';
// 계획 PR8 완료 기준: 부피가 Σw·h·t 에서 특징을 뺀 값과 ±0.1% 안에서 맞는다
const VOLUME_REL = 0.001;

const boxVolume = (s) => [0, 1, 2].reduce((v, k) => v * (s.max[k] - s.min[k]), 1);

/** 골든 픽스처 하나의 덤프. */
function dumpOf(name) {
  return dumpSpecOf(name, specOf(name).spec);
}

/**
 * 조립 명세 하나의 덤프 — 골든 픽스처 밖의 명세(모듈 라이브러리, docs/01-plan/module-library.plan.md §4)도 같은 형식으로 쓴다.
 * @param {string} name  덤프의 fixture 이름 (출력 파일 이름)
 * @param {object} spec  dadam.assembly/1
 */
function dumpSpecOf(name, spec) {
  const modules = [];
  (spec.items || []).forEach((it) => (it.modules || []).forEach((m) => {
    const parts = (m.parts || []).map((p) => {
      const solids = Asm.solidsOf(p);
      return {
        id: p.id,
        part: p.part,
        t: p.t,
        cut: { w: p.cut.w, h: p.cut.h },
        frame: p.frame,
        notches: (p.features || []).filter((f) => f.type === 'notch').map((f) => ({ u0: f.u0, u1: f.u1, v0: f.v0, v1: f.v1 })),
        volume: solids.reduce((s, b) => s + boxVolume(b), 0),
      };
    });
    const pieces = (m.parts || []).map((p) => ({ id: p.id, solids: Asm.solidsOf(p).map((s) => Object.assign({ m: Check.IDENTITY }, s)) }));
    const overlaps = Check.findOverlaps(pieces).map((r) => ({ a: r.a.id, b: r.b.id, volume: r.volume, depth: r.depth }));
    modules.push({ moduleKey: m.moduleKey, parts, overlaps });
  }));
  return {
    schema: SCHEMA,
    fixture: name,
    rulesVersion: spec.rulesVersion,
    axes: Asm.AXES,
    limits: Object.assign({}, Check.DEFAULT_LIMITS),
    tolerance: { volumeRel: VOLUME_REL },
    modules,
  };
}

function main(argv) {
  const [outDir, ...names] = argv;
  if (!outDir) {
    process.stderr.write('usage: node tools/cad/dump-assembly.js <outDir> [fixture...]\n');
    return 2;
  }
  const list = names.length ? names : NAMES;
  const unknown = list.filter((n) => !NAMES.includes(n));
  if (unknown.length) {
    process.stderr.write(`unknown fixture: ${unknown.join(', ')} (known: ${NAMES.join(', ')})\n`);
    return 2;
  }
  fs.mkdirSync(outDir, { recursive: true });
  list.forEach((name) => {
    const d = dumpOf(name);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(d, null, 1) + '\n');
    const parts = d.modules.reduce((s, m) => s + m.parts.length, 0);
    const pairs = d.modules.reduce((s, m) => s + m.overlaps.length, 0);
    process.stdout.write(`${name}: modules ${d.modules.length} · parts ${parts} · js overlaps ${pairs}\n`);
  });
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { SCHEMA, VOLUME_REL, dumpOf, dumpSpecOf, main };
