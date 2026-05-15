#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// sync-planner — lib/planner.ts ↔ mcp-server/src/types/planner.types.ts drift 검증
//
// 배경:
//   mcp-server 는 stdio 환경이라 Three.js/React 의존 불가 → planner 타입의
//   일부만 미러 (`src/types/planner.types.ts`). 원본 (`lib/planner.ts`) 변경 시
//   미러본이 stale 이 되면 SketchUp 빌더 등 mcp-server 도구가 잘못된 데이터로
//   동작할 위험.
//
// 동작:
//   1) lib/planner.ts 와 mcp-server/src/types/planner.types.ts 를 TS AST 로 파싱
//   2) 미러본의 EXPORTS_TO_SYNC 각 항목을 원본에서 찾아 정규화된 source 비교
//   3) drift 있으면 exit 1 + 차이 출력. 없으면 exit 0
//
// 옵션:
//   --write   : drift 있으면 자동으로 미러본 갱신 (커밋 전 검토 권장)
//   --quiet   : 일치 시 stdout 출력 생략 (CI 용)
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SOURCE_PATH = resolve(REPO_ROOT, 'lib', 'planner.ts');
const MIRROR_PATH = resolve(__dirname, '..', 'src', 'types', 'planner.types.ts');

// 미러본이 보존해야 하는 export 목록 — 새 export 추가 시 여기 등록.
const EXPORTS_TO_SYNC = [
  'CabinetCategory',
  'MaterialTone',
  'ModuleSection',
  'ModuleKind',
  'ModuleType',
  'ColorKey',
  'CabinetPart',
  'MaterialPalette',
  'MATERIALS',
];

const args = process.argv.slice(2);
const opts = {
  write: args.includes('--write'),
  quiet: args.includes('--quiet'),
};

// ───────────────────────────────────────────────────────────────
// AST 파싱 + export 추출
// ───────────────────────────────────────────────────────────────

function parse(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const sf = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  return { src, sf };
}

/**
 * 주어진 SourceFile 에서 EXPORTS_TO_SYNC 의 각 이름에 해당하는
 * top-level type/interface/const declaration 의 원본 텍스트를 추출한다.
 * 발견된 항목은 { [name]: text } 로 반환. 누락은 결과 객체에서 빠진다.
 */
function extractExports(sf, names) {
  const map = {};
  const want = new Set(names);

  sf.forEachChild((node) => {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExport) return;

    let name = null;
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      name = node.name.text;
    } else if (ts.isVariableStatement(node)) {
      // export const Name = ...
      const decl = node.declarationList.declarations[0];
      if (decl && ts.isIdentifier(decl.name)) name = decl.name.text;
    }
    if (name && want.has(name)) {
      map[name] = node.getText(sf);
    }
  });

  return map;
}

// ───────────────────────────────────────────────────────────────
// 정규화 — whitespace / trailing comma / 주석 차이 무시
// ───────────────────────────────────────────────────────────────

function normalize(text) {
  return text
    .replace(/\/\/[^\n]*\n/g, '\n')         // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
    .replace(/\s+/g, ' ')                    // collapse whitespace
    .replace(/,\s*([}\]])/g, '$1')          // trailing comma
    .trim();
}

// ───────────────────────────────────────────────────────────────
// 비교 + 결과 출력
// ───────────────────────────────────────────────────────────────

function diff(name, sourceText, mirrorText) {
  const sourceNorm = normalize(sourceText);
  const mirrorNorm = normalize(mirrorText);
  return sourceNorm === mirrorNorm ? null : { sourceNorm, mirrorNorm };
}

const { src: sourceSrc, sf: sourceSf } = parse(SOURCE_PATH);
const { src: mirrorSrc, sf: mirrorSf } = parse(MIRROR_PATH);

const sourceExports = extractExports(sourceSf, EXPORTS_TO_SYNC);
const mirrorExports = extractExports(mirrorSf, EXPORTS_TO_SYNC);

const issues = [];

for (const name of EXPORTS_TO_SYNC) {
  const inSource = sourceExports[name];
  const inMirror = mirrorExports[name];

  if (!inSource) {
    issues.push({ name, kind: 'missing-in-source', message: `${name} not found in lib/planner.ts` });
    continue;
  }
  if (!inMirror) {
    issues.push({ name, kind: 'missing-in-mirror', message: `${name} not found in mirror — add it manually or use --write` });
    continue;
  }

  const d = diff(name, inSource, inMirror);
  if (d) {
    issues.push({
      name,
      kind: 'drift',
      message: `${name} drifted`,
      source: inSource,
      mirror: inMirror,
    });
  }
}

if (issues.length === 0) {
  if (!opts.quiet) {
    console.log(`✓ planner mirror in sync (${EXPORTS_TO_SYNC.length} exports verified)`);
  }
  process.exit(0);
}

// drift 보고
console.error('───────────────────────────────────────────────────');
console.error(' planner mirror DRIFT detected');
console.error('───────────────────────────────────────────────────');
console.error(` source:  ${SOURCE_PATH}`);
console.error(` mirror:  ${MIRROR_PATH}`);
console.error(` checked: ${EXPORTS_TO_SYNC.length} exports`);
console.error(` issues:  ${issues.length}`);
console.error('');

for (const issue of issues) {
  console.error(`✗ [${issue.kind}] ${issue.name}`);
  if (issue.kind === 'drift') {
    console.error('  --- source ---');
    console.error('  ' + issue.source.split('\n').join('\n  '));
    console.error('  --- mirror ---');
    console.error('  ' + issue.mirror.split('\n').join('\n  '));
    console.error('');
  } else {
    console.error(`  ${issue.message}`);
    console.error('');
  }
}

if (!opts.write) {
  console.error('Hint: rerun with --write to regenerate the mirror from source.');
  console.error('      또는 src/types/planner.types.ts 를 수동으로 lib/planner.ts 와 맞춰 수정.');
  process.exit(1);
}

// ───────────────────────────────────────────────────────────────
// --write 모드 — drift 항목만 source 의 text 로 미러본을 갱신
// ───────────────────────────────────────────────────────────────

console.error('→ --write: applying source values to mirror...');

let updatedMirror = mirrorSrc;
let appliedCount = 0;

for (const issue of issues) {
  if (issue.kind === 'missing-in-source') {
    console.error(`  skip ${issue.name} (not in source — manual cleanup needed)`);
    continue;
  }
  const sourceText = sourceExports[issue.name];
  if (!sourceText) continue;

  if (issue.kind === 'missing-in-mirror') {
    // 파일 끝에 append (수동으로 위치 조정 권장)
    updatedMirror = updatedMirror.replace(/\s*$/, '\n\n' + sourceText + '\n');
    appliedCount++;
    console.error(`  added  ${issue.name}`);
  } else {
    const mirrorText = mirrorExports[issue.name];
    if (!mirrorText) continue;
    // 미러본 안에서 mirrorText 를 sourceText 로 치환 (1회 한정)
    const idx = updatedMirror.indexOf(mirrorText);
    if (idx === -1) {
      console.error(`  skip ${issue.name} (mirror text not found by literal match — please update manually)`);
      continue;
    }
    updatedMirror = updatedMirror.slice(0, idx) + sourceText + updatedMirror.slice(idx + mirrorText.length);
    appliedCount++;
    console.error(`  fixed  ${issue.name}`);
  }
}

if (appliedCount > 0) {
  writeFileSync(MIRROR_PATH, updatedMirror);
  console.error(`✓ wrote ${MIRROR_PATH} (${appliedCount} export(s) updated)`);
  process.exit(0);
} else {
  console.error('✗ no changes applied — manual intervention required');
  process.exit(1);
}
