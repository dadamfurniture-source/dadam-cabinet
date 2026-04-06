// ═══════════════════════════════════════════════════════════════
// Sink HITL Diff Service - Semantic diff between generated/corrected
// JSON Patch 스타일 + 규칙 마이닝용 tag 추론
// ═══════════════════════════════════════════════════════════════

import type { SinkDesign, SinkDiffOp, SinkModule, SinkEnv } from '../schemas/sink-hitl.schemas.js';

// ─── env 필드 diff ───

const ENV_FIELDS: (keyof SinkEnv)[] = [
  'width', 'height', 'depth',
  'finishLeftW', 'finishRightW', 'moldingH', 'toeKickH',
  'distributorStart', 'distributorEnd', 'ventStart', 'ventEnd',
  'measurementBase',
];

function diffEnv(g: SinkEnv, c: SinkEnv): SinkDiffOp[] {
  const ops: SinkDiffOp[] = [];
  for (const key of ENV_FIELDS) {
    const gv = g[key];
    const cv = c[key];
    if (gv !== cv) {
      ops.push({
        op: 'replace',
        path: `/env/${String(key)}`,
        from: gv,
        to: cv,
        tag: `env-${String(key)}-fix`,
      });
    }
  }
  return ops;
}

// ─── 모듈 매칭 (idx 기반 greedy, type 고려) ───

interface ModuleMatch {
  g?: SinkModule;
  c?: SinkModule;
  gIdx?: number;
  cIdx?: number;
}

/**
 * 두 모듈 리스트를 매칭:
 * 1. 같은 (type, kind) 조합을 순서대로 페어링 시도
 * 2. 남은 것들은 순서 기반 greedy
 * 3. 매칭되지 못한 것은 add/remove
 */
function matchModules(gList: SinkModule[], cList: SinkModule[]): ModuleMatch[] {
  const matches: ModuleMatch[] = [];
  const gUsed = new Set<number>();
  const cUsed = new Set<number>();

  // 1차: same type + same kind 순서 매칭
  for (let gi = 0; gi < gList.length; gi++) {
    if (gUsed.has(gi)) continue;
    const g = gList[gi];
    for (let ci = 0; ci < cList.length; ci++) {
      if (cUsed.has(ci)) continue;
      const c = cList[ci];
      if (g.type === c.type && g.kind === c.kind) {
        matches.push({ g, c, gIdx: gi, cIdx: ci });
        gUsed.add(gi);
        cUsed.add(ci);
        break;
      }
    }
  }

  // 2차: same type (kind 무관)
  for (let gi = 0; gi < gList.length; gi++) {
    if (gUsed.has(gi)) continue;
    const g = gList[gi];
    for (let ci = 0; ci < cList.length; ci++) {
      if (cUsed.has(ci)) continue;
      const c = cList[ci];
      if (g.type === c.type) {
        matches.push({ g, c, gIdx: gi, cIdx: ci });
        gUsed.add(gi);
        cUsed.add(ci);
        break;
      }
    }
  }

  // 남은 generated → remove
  for (let gi = 0; gi < gList.length; gi++) {
    if (!gUsed.has(gi)) matches.push({ g: gList[gi], gIdx: gi });
  }
  // 남은 corrected → add
  for (let ci = 0; ci < cList.length; ci++) {
    if (!cUsed.has(ci)) matches.push({ c: cList[ci], cIdx: ci });
  }

  return matches;
}

function diffModule(
  section: 'lower' | 'upper',
  match: ModuleMatch,
): SinkDiffOp[] {
  const ops: SinkDiffOp[] = [];
  const { g, c, gIdx, cIdx } = match;

  if (g && !c) {
    ops.push({
      op: 'remove',
      path: `/${section}/${gIdx}`,
      from: g,
      tag: `${section}-module-remove-${g.type}`,
    });
    return ops;
  }
  if (!g && c) {
    ops.push({
      op: 'add',
      path: `/${section}/${cIdx}`,
      to: c,
      tag: `${section}-module-add-${c.type}`,
    });
    return ops;
  }
  if (!g || !c) return ops;

  if (g.width !== c.width) {
    ops.push({
      op: 'replace',
      path: `/${section}/${gIdx}/width`,
      from: g.width,
      to: c.width,
      tag: `${section}-${g.type}-width-fix`,
    });
  }
  if (g.kind !== c.kind) {
    ops.push({
      op: 'replace',
      path: `/${section}/${gIdx}/kind`,
      from: g.kind,
      to: c.kind,
      tag: `${section}-${g.type}-kind-fix-${g.kind}-to-${c.kind}`,
    });
  }
  if (g.type !== c.type) {
    ops.push({
      op: 'replace',
      path: `/${section}/${gIdx}/type`,
      from: g.type,
      to: c.type,
      tag: `${section}-type-swap-${g.type}-to-${c.type}`,
    });
  }
  if ((g.doorCount ?? null) !== (c.doorCount ?? null)) {
    ops.push({
      op: 'replace',
      path: `/${section}/${gIdx}/doorCount`,
      from: g.doorCount,
      to: c.doorCount,
      tag: `${section}-${g.type}-doorcount-fix`,
    });
  }
  if ((g.drawerCount ?? null) !== (c.drawerCount ?? null)) {
    ops.push({
      op: 'replace',
      path: `/${section}/${gIdx}/drawerCount`,
      from: g.drawerCount,
      to: c.drawerCount,
      tag: `${section}-${g.type}-drawercount-fix`,
    });
  }
  if (gIdx !== cIdx) {
    ops.push({
      op: 'move',
      path: `/${section}/${gIdx}->${cIdx}`,
      from: gIdx,
      to: cIdx,
      tag: `${section}-${g.type}-reorder`,
    });
  }

  return ops;
}

// ─── 메인 엔트리 ───

export function computeSinkDiff(generated: SinkDesign, corrected: SinkDesign): SinkDiffOp[] {
  const ops: SinkDiffOp[] = [];

  ops.push(...diffEnv(generated.env, corrected.env));

  const lowerMatches = matchModules(generated.lower, corrected.lower);
  for (const m of lowerMatches) ops.push(...diffModule('lower', m));

  const upperMatches = matchModules(generated.upper, corrected.upper);
  for (const m of upperMatches) ops.push(...diffModule('upper', m));

  return ops;
}

/**
 * diff → tag 집계 (규칙 마이닝용)
 */
export function tagHistogram(ops: SinkDiffOp[]): Record<string, number> {
  const hist: Record<string, number> = {};
  for (const op of ops) {
    hist[op.tag] = (hist[op.tag] ?? 0) + 1;
  }
  return hist;
}
