#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// W3-4: SketchUp 빌더 E2E 스크립트
//
// 실 mhyrr/sketchup-mcp 확장과 종단 검증. 디자이너 PC 환경에서 수동 실행:
//   1) SketchUp 데스크탑 앱 기동
//   2) mhyrr/sketchup-mcp Ruby 확장 활성화 (기본 127.0.0.1:9876)
//   3) cd mcp-server && npm run build
//   4) SKETCHUP_E2E=1 node scripts/e2e-sketchup-build.mjs
//
// 카테고리 옵션:
//   --category sink|wardrobe|fridge|all (기본 all)
//   --host    호스트 (기본 127.0.0.1)
//   --port    포트  (기본 9876)
//   --keep    빌드 후 SketchUp 에 결과 유지 (clearExisting=false, 기본)
//   --clear   빌드 전 active_entities 비우기 (clearExisting=true)
//   --no-transactional  START/COMMIT 미사용 (단발 디버깅용)
//
// CI 가드: SKETCHUP_E2E=1 환경변수가 없으면 즉시 skip + exit 0.
// (CI 는 mhyrr 가 없으므로 항상 fail 할 것 — 사용자 의도 명시한 경우만 실행)
// ═══════════════════════════════════════════════════════════════

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ───────────────────────────────────────────────────────────────
// CI / 가이드 가드
// ───────────────────────────────────────────────────────────────

if (process.env.SKETCHUP_E2E !== '1') {
  console.log('───────────────────────────────────────────────────');
  console.log(' SketchUp E2E skipped');
  console.log('───────────────────────────────────────────────────');
  console.log(' 이 스크립트는 디자이너 PC 에서 mhyrr/sketchup-mcp');
  console.log(' 확장과 직접 통신합니다. CI/일반 환경에서는 skip 됩니다.');
  console.log('');
  console.log(' 실행 방법:');
  console.log('   1) SketchUp 기동 후 mhyrr/sketchup-mcp 확장 활성화');
  console.log('   2) cd mcp-server && npm run build');
  console.log('   3) SKETCHUP_E2E=1 node scripts/e2e-sketchup-build.mjs [옵션]');
  console.log('');
  console.log(' 옵션:');
  console.log('   --category sink|wardrobe|fridge|all  (기본 all)');
  console.log('   --host 127.0.0.1');
  console.log('   --port 9876');
  console.log('   --clear   빌드 전 씬 비우기');
  console.log('   --no-transactional');
  console.log('───────────────────────────────────────────────────');
  process.exit(0);
}

// ───────────────────────────────────────────────────────────────
// dist 산출물 사용 — tsc 빌드 후 실행 가정
// ───────────────────────────────────────────────────────────────

const distRoot = resolve(__dirname, '..', 'dist');

// Windows ESM 호환: 절대 경로 → file:// URL 변환 필수
const builderModule = await import(
  pathToFileURL(resolve(distRoot, 'services', 'sketchup-builder.service.js')).href
);
const bridgeModule = await import(
  pathToFileURL(resolve(distRoot, 'services', 'sketchup-mcp-bridge.service.js')).href
);

const { buildPlanFromParts } = builderModule;
const { sendBatch, pingSketchup } = bridgeModule;

// ───────────────────────────────────────────────────────────────
// 인자 파싱
// ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    category: 'all',
    host: '127.0.0.1',
    port: 9876,
    clear: false,
    transactional: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--category') args.category = argv[++i];
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--clear') args.clear = true;
    else if (a === '--keep') args.clear = false;
    else if (a === '--no-transactional') args.transactional = false;
    else if (a === '-h' || a === '--help') {
      console.log('see header comment');
      process.exit(0);
    }
  }
  return args;
}

const ARGS = parseArgs(process.argv);

// ───────────────────────────────────────────────────────────────
// 카테고리별 sample fixtures
//
// 좌표/치수는 mm 단위, planner Y-up 좌표계 (x=가로, y=수직, z=깊이).
// 디자이너가 SketchUp outliner 에서 dadam.{category}.* 로 확인 가능.
// ───────────────────────────────────────────────────────────────

const SINK_FIXTURE = {
  category: 'sink',
  materialTone: 'cream',
  parts: [
    // 본체 3 모듈
    { id: 'sink-l-body',  label: 'sink left',   x: 0,     y: 0,   z: 0,   width: 800,  height: 720, depth: 600, colorKey: 'body' },
    { id: 'sink-c-body',  label: 'sink center', x: 800,   y: 0,   z: 0,   width: 900,  height: 720, depth: 600, colorKey: 'body' },
    { id: 'sink-r-body',  label: 'sink right',  x: 1700,  y: 0,   z: 0,   width: 800,  height: 720, depth: 600, colorKey: 'body' },
    // 도어 (앞면)
    { id: 'sink-l-door', label: 'door L', x: 0,    y: 0, z: 600, width: 800, height: 720, depth: 18, colorKey: 'accent',
      isDoor: true, parentModuleId: 'sink-l-body', doorIndex: 0, openDirection: 'left' },
    { id: 'sink-r-door', label: 'door R', x: 1700, y: 0, z: 600, width: 800, height: 720, depth: 18, colorKey: 'accent',
      isDoor: true, parentModuleId: 'sink-r-body', doorIndex: 0, openDirection: 'right' },
  ],
};

const WARDROBE_FIXTURE = {
  category: 'wardrobe',
  materialTone: 'walnut',
  parts: [
    { id: 'wd-l-body', label: 'wardrobe L', x: 0,    y: 0, z: 0,   width: 900, height: 2400, depth: 600, colorKey: 'body' },
    { id: 'wd-c-body', label: 'wardrobe C', x: 900,  y: 0, z: 0,   width: 900, height: 2400, depth: 600, colorKey: 'body' },
    { id: 'wd-r-body', label: 'wardrobe R', x: 1800, y: 0, z: 0,   width: 900, height: 2400, depth: 600, colorKey: 'body' },
    { id: 'wd-l-door', label: 'wd door L',  x: 0,    y: 0, z: 600, width: 900, height: 2400, depth: 18,  colorKey: 'accent',
      isDoor: true, parentModuleId: 'wd-l-body', doorIndex: 0, openDirection: 'left' },
    { id: 'wd-c-door', label: 'wd door C',  x: 900,  y: 0, z: 600, width: 900, height: 2400, depth: 18,  colorKey: 'accent',
      isDoor: true, parentModuleId: 'wd-c-body', doorIndex: 0, openDirection: 'right' },
    { id: 'wd-r-door', label: 'wd door R',  x: 1800, y: 0, z: 600, width: 900, height: 2400, depth: 18,  colorKey: 'accent',
      isDoor: true, parentModuleId: 'wd-r-body', doorIndex: 0, openDirection: 'right' },
  ],
};

const FRIDGE_FIXTURE = {
  category: 'fridge',
  materialTone: 'oak',
  parts: [
    { id: 'fr-tower',     label: 'fridge tower',  x: 0, y: 0,    z: 0, width: 750, height: 2300, depth: 700, colorKey: 'body' },
    { id: 'fr-top-shelf', label: 'fridge shelf',  x: 0, y: 2300, z: 0, width: 750, height: 350,  depth: 700, colorKey: 'shadow' },
    { id: 'fr-door',      label: 'fridge door',   x: 0, y: 0,    z: 700, width: 750, height: 2300, depth: 18,  colorKey: 'accent',
      isDoor: true, parentModuleId: 'fr-tower', doorIndex: 0, openDirection: 'right' },
  ],
};

const FIXTURES = {
  sink: SINK_FIXTURE,
  wardrobe: WARDROBE_FIXTURE,
  fridge: FRIDGE_FIXTURE,
};

// ───────────────────────────────────────────────────────────────
// 1 카테고리 빌드 + 결과 출력
// ───────────────────────────────────────────────────────────────

async function buildCategory(name) {
  const fx = FIXTURES[name];
  if (!fx) {
    console.error(`✗ unknown category: ${name}`);
    return { ok: false, summary: null };
  }

  console.log('');
  console.log(`▶ [${name}] build start — ${fx.parts.length} parts`);

  const plan = buildPlanFromParts(fx.parts, {
    category: fx.category,
    materialTone: fx.materialTone,
    clearExisting: ARGS.clear,
    transactional: ARGS.transactional,
  });

  console.log(`  plan: ${plan.commands.length} commands, ${plan.componentCount} components`);

  const start = Date.now();
  const result = await sendBatch(plan.commands, {
    host: ARGS.host,
    port: ARGS.port,
    autoAbortOnFailure: ARGS.transactional,
    stopOnFirstFailure: ARGS.transactional,
    emitMetrics: false,
    // mhyrr v0.1.0 는 한 연결당 한 명령만 처리 (main.rb 의 client.close).
    // 실 mhyrr 와 호환을 위해 per-command 모드 사용. persistent 모드는
    // mhyrr fork (while loop) 가 적용된 환경에서만 동작.
    connectionMode: 'per-command',
  });
  const elapsedMs = Date.now() - start;

  const okSign = result.failures.length === 0 ? '✓' : '✗';
  console.log(
    `  ${okSign} sent=${result.totalSent}  success=${result.successCount}  failures=${result.failures.length}  aborted=${result.aborted}  avgRtt=${result.averageRttMs}ms  elapsed=${elapsedMs}ms`,
  );

  if (result.failures.length > 0) {
    for (const f of result.failures.slice(0, 5)) {
      console.log(`    fail[${f.index}]: ${f.error.message}`);
    }
  }

  return { ok: result.failures.length === 0, summary: { ...result, elapsedMs } };
}

// ───────────────────────────────────────────────────────────────
// 메인
// ───────────────────────────────────────────────────────────────

console.log('───────────────────────────────────────────────────');
console.log(' SketchUp E2E build');
console.log('───────────────────────────────────────────────────');
console.log(` host: ${ARGS.host}:${ARGS.port}`);
console.log(` category: ${ARGS.category}`);
console.log(` clearExisting: ${ARGS.clear}  transactional: ${ARGS.transactional}`);

// ping
console.log('');
console.log('▶ ping mhyrr/sketchup-mcp');
const probe = await pingSketchup({ host: ARGS.host, port: ARGS.port, timeoutMs: 3000 });
if (!probe.ok) {
  console.error(`✗ bridge unavailable: ${probe.error?.message}`);
  console.error('  디자이너 PC 에서 SketchUp + mhyrr/sketchup-mcp 확장이 떠 있는지 확인하세요.');
  process.exit(2);
}
console.log(`  ✓ pong (result: ${JSON.stringify(probe.result).slice(0, 80)}...)`);

// 카테고리 선택
const targets =
  ARGS.category === 'all'
    ? ['sink', 'wardrobe', 'fridge']
    : ARGS.category.split(',').map((s) => s.trim());

let exitCode = 0;
for (const cat of targets) {
  const r = await buildCategory(cat);
  if (!r.ok) exitCode = 1;
}

console.log('');
console.log('───────────────────────────────────────────────────');
console.log(exitCode === 0 ? ' ✓ E2E complete' : ' ✗ E2E had failures');
console.log('───────────────────────────────────────────────────');
process.exit(exitCode);
