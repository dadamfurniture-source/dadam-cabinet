#!/usr/bin/env node
// ============================================================
// ESLint 현황 요약 — `npm run lint` 과 같은 설정으로 돌리고, 문제 수를 묶어서 찍는다.
//
// `npm run lint` 은 문제를 한 줄씩 수만 줄 찍어서 어디가 얼마나 남았는지 보기 어렵다.
// 이 스크립트는 고치지 않고 세기만 한다:
//
//   규칙별      — 오류 · 경고 · 자동 수정 가능 수
//   영역별      — 최상위 폴더 (workers/ · mcp-server/ 는 한 단계 더)
//   담당 영역별 — CLAUDE.md 「도메인별 에이전트 소유권」 표의 파일 패턴.
//                 __tests__/ 는 파일 이름 앞부분(planner- · segan- …)으로 나눈다.
//                 「검사 파일 0」 이면 깨끗한 것이 아니라 eslint 설정이 그 파일을 보지 않는 것이다.
//   문제가 많은 파일 상위 N 개
//
// 언제나 exit 0 (보고만 한다). 게이트는 `npm run lint` 이 맡는다.
//
// 쓰는 법: node scripts/lint-report.mjs [--json] [--top N]
//          npm run lint:report
// ============================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const topIdx = args.indexOf('--top');
const TOP = topIdx >= 0 ? Number(args[topIdx + 1]) || 15 : 15;

// CLAUDE.md 「도메인별 에이전트 소유권」 — 표가 바뀌면 여기도 맞춘다. 위에서부터 처음 맞는 것.
const base = (p) => p.slice(p.lastIndexOf('/') + 1);
const DOMAINS = [
  ['Image Gen', (p) => p === 'ai-design.html' || p === 'js/detaildesign/ai-design-report.js'],
  [
    'BOM/Materials',
    (p) =>
      [
        'calc-engine.js',
        'extractors.js',
        'bom.service.ts',
        'bom.tool.ts',
        'assembly-rules.js',
        'bom-assembly.js',
        'assembly-check.js',
      ].includes(base(p)) ||
      base(p).startsWith('bom-rules.') ||
      p.startsWith('tools/cad/'),
  ],
  ['Design UI', (p) => ['ui-step1.js', 'ui-workspace.js', 'ui-fridge-el.js'].includes(base(p))],
  ['Collection', (p) => p === 'collection.html' || p === 'database/collection-schema.sql'],
  ['MCP Server', (p) => p.startsWith('mcp-server/src/')],
  [
    'Planner',
    (p) =>
      p === 'mockup-shell.html' || p === 'mockup-structure.html' || p.startsWith('js/planner/'),
  ],
  [
    'Workflow Worker',
    (p) => p.startsWith('workers/workflow-api/') || p === 'js/detaildesign/workflow-client.js',
  ],
  [
    'Worker Portal',
    (p) =>
      ['worker.html', 'js/worker-portal.js', 'js/mypage-work.js', 'admin/work-jobs.html'].includes(
        p
      ) || /^database\/work-jobs.*\.sql$/.test(p),
  ],
  ['Site Auth', (p) => p === 'login.html' || p === 'signup.html'],
  [
    'App Shell (SEGAN)',
    (p) =>
      p.startsWith('segan/') ||
      [
        'scripts/stamp-asset-version.mjs',
        'scripts/asset-version.json',
        'scripts/segan-icons.mjs',
      ].includes(p),
  ],
  ['3D Planner (legacy)', (p) => p.startsWith('planner/embed/')],
];
// __tests__/<앞부분>-*.test.js → 담당 영역 (이름 규칙에 기댄 추정)
const TEST_PREFIX = [
  ['planner-', 'Planner'],
  ['segan-', 'App Shell (SEGAN)'],
  ['designui-', 'Design UI'],
  ['bom-', 'BOM/Materials'],
  ['ai-design-', 'Image Gen'],
  ['collection-', 'Collection'],
  ['workflow-', 'Workflow Worker'],
  ['worker-portal', 'Worker Portal'],
  ['work-jobs', 'Worker Portal'],
];
const NO_OWNER = '(no single owner)';

function domainOf(p) {
  for (const [name, test] of DOMAINS) if (test(p)) return name;
  if (p.startsWith('__tests__/')) {
    const hit = TEST_PREFIX.find(([prefix]) => base(p).startsWith(prefix));
    if (hit) return `${hit[1]} — tests`;
  }
  return NO_OWNER;
}

function areaOf(p) {
  const parts = p.split('/');
  if (parts.length === 1) return '(root files)';
  if ((parts[0] === 'workers' || parts[0] === 'mcp-server') && parts.length > 2)
    return `${parts[0]}/${parts[1]}`;
  if (parts[0] === 'mcp-server') return 'mcp-server (root files)';
  return parts[0];
}

function bump(map, key, msg) {
  const row = map.get(key) || { files: new Set(), errors: 0, warnings: 0, fixable: 0 };
  if (msg) {
    if (msg.severity === 2) row.errors++;
    else row.warnings++;
    if (msg.fix) row.fixable++;
  }
  map.set(key, row);
  return row;
}

// `npm run lint` = eslint . --report-unused-disable-directives --max-warnings 0
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: { linterOptions: { reportUnusedDisableDirectives: 'error' } },
});
const results = await eslint.lintFiles(['.']);

const byRule = new Map();
const byArea = new Map();
const byDomain = new Map();
const byFile = [];
let errors = 0;
let warnings = 0;
let fixable = 0;
for (const [name] of DOMAINS) bump(byDomain, name); // 검사 파일이 없는 영역도 0 으로 보이게

for (const r of results) {
  const rel = path.relative(ROOT, r.filePath).split(path.sep).join('/');
  const area = areaOf(rel);
  const domain = domainOf(rel);
  bump(byArea, area).files.add(rel);
  bump(byDomain, domain).files.add(rel);
  for (const m of r.messages) {
    if (m.severity === 2) errors++;
    else warnings++;
    if (m.fix) fixable++;
    bump(byRule, m.ruleId || '(unused disable directive / parse)', m).files.add(rel);
    bump(byArea, area, m);
    bump(byDomain, domain, m);
  }
  if (r.messages.length)
    byFile.push({ file: rel, domain, errors: r.errorCount, warnings: r.warningCount });
}

const rows = (map) =>
  [...map.entries()]
    .map(([key, v]) => ({
      key,
      files: v.files.size,
      errors: v.errors,
      warnings: v.warnings,
      fixable: v.fixable,
    }))
    .sort(
      (a, b) =>
        b.errors + b.warnings - (a.errors + a.warnings) ||
        b.files - a.files ||
        a.key.localeCompare(b.key)
    );
const topFiles = byFile
  .sort((a, b) => b.errors + b.warnings - (a.errors + a.warnings))
  .slice(0, TOP);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        files: results.length,
        filesWithProblems: byFile.length,
        errors,
        warnings,
        fixable,
        byRule: rows(byRule),
        byArea: rows(byArea),
        byDomain: rows(byDomain),
        topFiles,
      },
      null,
      2
    )
  );
} else {
  const table = (title, keyName, list, fileLabel) => {
    const w = Math.max(keyName.length, ...list.map((r) => r.key.length));
    const n = (x) => String(x).padStart(7);
    console.log(`\n${title}`);
    console.log(
      `  ${keyName.padEnd(w)} ${'errors'.padStart(7)} ${'warns'.padStart(7)} ${'fixable'.padStart(7)} ${fileLabel.padStart(7)}`
    );
    for (const r of list)
      console.log(
        `  ${r.key.padEnd(w)} ${n(r.errors)} ${n(r.warnings)} ${n(r.fixable)} ${n(r.files)}`
      );
  };
  console.log(
    `ESLint (npm run lint 과 같은 설정): 검사 파일 ${results.length} · 문제 있는 파일 ${byFile.length}`
  );
  console.log(`  오류 ${errors} · 경고 ${warnings} · 자동 수정 가능 ${fixable}`);
  table('규칙별', 'rule', rows(byRule), 'files');
  table('영역별', 'area', rows(byArea), 'linted');
  table(
    '담당 영역별 (CLAUDE.md 소유권 표 · 검사 파일 0 = eslint 가 보지 않음)',
    'domain',
    rows(byDomain),
    'linted'
  );
  console.log(`\n문제가 많은 파일 상위 ${topFiles.length}`);
  for (const f of topFiles)
    console.log(`  ${String(f.errors + f.warnings).padStart(6)}  ${f.file}  [${f.domain}]`);
}
