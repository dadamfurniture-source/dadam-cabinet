#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, process, global */
/**
 * 모듈 라이브러리 → Text-to-CAD 입력 덤프 (docs/01-plan/module-library.plan.md §4).
 *
 * 모듈마다 순수 경로(test-utils/module-library/pipeline.js — 실제 브리지 · BOM · 조립 명세)로 명세를 만들고
 * CAD 검산기와 같은 형식(dadam.cad-oracle/1, tools/cad/dump-assembly.js dumpSpecOf)으로 쓴다.
 * 그 폴더를 tools/cad/build_from_spec.py(build123d)가 그대로 읽어 모듈마다 STEP · GLB 를 짓고 OCC 로 대조한다.
 *
 *   node tools/module-library/dump-library.js <outDir> [id…]            (id 를 안 주면 verified 모듈 전부)
 *   node tools/module-library/dump-library.js <outDir> --samples        (시험 견본만 — 라이브러리가 비어도 경로를 본다)
 *   node tools/module-library/dump-library.js <outDir> --with-samples   (verified 모듈 + 견본 — CI)
 *
 * 출력 <outDir>/<id>.json (견본은 sample-<id>.json). 판재만 싣는다 — 라인 부재·철물은 dump-assembly 와 같이 뺀다.
 */
const fs = require('fs');
const path = require('path');

global.dlog = global.dlog || (() => {});
const Lib = require('../../js/module-library/module-library.js');
const pipeline = require('../../test-utils/module-library/pipeline.js');
const { SAMPLES } = require('../../test-utils/module-library/samples.js');
const { dumpSpecOf } = require('../cad/dump-assembly.js');

/** @returns {{ name: string, entry: object }[]} */
function targetsOf(args) {
  const samples = SAMPLES.map((e) => ({ name: `sample-${e.id}`, entry: e }));
  if (args.includes('--samples')) return samples;
  const ids = args.filter((a) => !a.startsWith('--'));
  const picked = ids.length
    ? ids.map((id) => ({ name: id, entry: Lib.byId(id) }))
    : Lib.list({ status: 'verified' }).map((e) => ({ name: e.id, entry: e }));
  return args.includes('--with-samples') ? picked.concat(samples) : picked;
}

function main(argv) {
  const [outDir, ...args] = argv;
  if (!outDir) {
    process.stderr.write('usage: node tools/module-library/dump-library.js <outDir> [id...] | --samples\n');
    return 2;
  }
  const targets = targetsOf(args);
  const unknown = targets.filter((t) => !t.entry).map((t) => t.name);
  if (unknown.length) {
    process.stderr.write(`unknown module: ${unknown.join(', ')}\n`);
    return 2;
  }
  fs.mkdirSync(outDir, { recursive: true });
  if (!targets.length) process.stdout.write('verified 모듈이 없습니다 — 덤프할 것이 없다\n');
  targets.forEach(({ name, entry }) => {
    const r = pipeline.runEntry(entry);
    const d = dumpSpecOf(name, r.spec);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(d, null, 1) + '\n');
    const parts = d.modules.reduce((s, m) => s + m.parts.length, 0);
    const bad = r.gates.filter((g) => !g.ok).map((g) => g.code);
    process.stdout.write(`${name}: parts ${parts} · gates ${bad.length ? 'FAIL ' + bad.join(',') : 'ok'}\n`);
  });
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { targetsOf, main };
