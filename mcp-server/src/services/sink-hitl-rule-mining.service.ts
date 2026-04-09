// ═══════════════════════════════════════════════════════════════
// Sink HITL Rule Mining Service
// 수집된 pair diff 데이터에서 반복 패턴을 규칙으로 자동 추출
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { tagHistogram } from './sink-hitl-diff.service.js';
import {
  listPairs,
  saveRules,
  type SinkHitlRule,
} from './sink-hitl-storage.service.js';
import type { SinkDiffOp, SinkDiffPair } from '../schemas/sink-hitl.schemas.js';

const log = createLogger('sink-hitl-rule-mining');

// ─── 설정 ───

/** 규칙 후보로 인정하기 위한 최소 발생 횟수 */
const MIN_OCCURRENCE = 2;

/** 자동 활성화 임계치 (confidence >= 이 값이면 is_active = true) */
const AUTO_ACTIVATE_THRESHOLD = 0.3;

// ─── Tag → Condition/Action 파싱 ───

interface ParsedRule {
  tag: string;
  description: string;
  condition: Record<string, string>;
  action: Record<string, string | number | null>;
}

/**
 * diff tag 문자열에서 condition + action을 추론.
 *
 * 태그 패턴 예시:
 *   "lower-cook-kind-fix-door-to-drawer"
 *   "lower-cook-width-fix"
 *   "lower-module-add-storage"
 *   "lower-module-remove-lt"
 *   "upper-type-swap-storage-to-hood"
 *   "lower-cook-doorcount-fix"
 *   "lower-cook-reorder"
 *   "env-width-fix"
 */
function parseTag(tag: string, representativeOp: SinkDiffOp): ParsedRule | null {
  const parts = tag.split('-');

  // env 필드 변경
  if (parts[0] === 'env') {
    const field = parts[1];
    return {
      tag,
      description: `환경 ${field} 수정이 빈번함`,
      condition: { scope: 'env', field },
      action: { op: 'replace', field },
    };
  }

  const section = parts[0]; // lower | upper
  if (section !== 'lower' && section !== 'upper') return null;

  // module add/remove
  if (parts.includes('module') && parts.includes('add')) {
    const modType = parts[parts.length - 1];
    return {
      tag,
      description: `${section === 'lower' ? '하부장' : '상부장'}에 ${modType} 모듈 추가가 빈번함`,
      condition: { section },
      action: { op: 'add', type: modType },
    };
  }
  if (parts.includes('module') && parts.includes('remove')) {
    const modType = parts[parts.length - 1];
    return {
      tag,
      description: `${section === 'lower' ? '하부장' : '상부장'}에서 ${modType} 모듈 제거가 빈번함`,
      condition: { section },
      action: { op: 'remove', type: modType },
    };
  }

  // type swap
  if (parts.includes('type') && parts.includes('swap')) {
    const toIdx = parts.indexOf('to');
    if (toIdx > 0 && toIdx < parts.length - 1) {
      const fromType = parts[toIdx - 1];
      const toType = parts[toIdx + 1];
      return {
        tag,
        description: `${section} ${fromType} → ${toType} 타입 변경이 빈번함`,
        condition: { section, type: fromType },
        action: { op: 'replace', field: 'type', from: fromType, to: toType },
      };
    }
  }

  // kind fix (door-to-drawer 등)
  if (parts.includes('kind') && parts.includes('fix')) {
    const modType = parts[1]; // e.g. cook
    const toIdx = parts.indexOf('to');
    if (toIdx > 0 && toIdx < parts.length - 1) {
      const fromKind = parts[toIdx - 1];
      const toKind = parts[toIdx + 1];
      return {
        tag,
        description: `${section} ${modType}의 종류(kind)를 ${fromKind}→${toKind}로 수정이 빈번함`,
        condition: { section, type: modType },
        action: { op: 'replace', field: 'kind', from: fromKind, to: toKind },
      };
    }
    // kind-fix without from/to
    return {
      tag,
      description: `${section} ${modType}의 종류(kind) 수정이 빈번함`,
      condition: { section, type: modType },
      action: { op: 'replace', field: 'kind' },
    };
  }

  // width fix
  if (parts.includes('width') && parts.includes('fix')) {
    const modType = parts[1];
    return {
      tag,
      description: `${section} ${modType}의 폭(width) 수정이 빈번함`,
      condition: { section, type: modType },
      action: { op: 'replace', field: 'width' },
    };
  }

  // doorcount / drawercount fix
  if (parts.includes('doorcount') && parts.includes('fix')) {
    const modType = parts[1];
    return {
      tag,
      description: `${section} ${modType}의 도어 수 수정이 빈번함`,
      condition: { section, type: modType },
      action: { op: 'replace', field: 'doorCount' },
    };
  }
  if (parts.includes('drawercount') && parts.includes('fix')) {
    const modType = parts[1];
    return {
      tag,
      description: `${section} ${modType}의 서랍 수 수정이 빈번함`,
      condition: { section, type: modType },
      action: { op: 'replace', field: 'drawerCount' },
    };
  }

  // reorder
  if (parts.includes('reorder')) {
    const modType = parts[1];
    return {
      tag,
      description: `${section} ${modType}의 순서 변경이 빈번함`,
      condition: { section, type: modType },
      action: { op: 'move' },
    };
  }

  // fallback — 파싱 실패시 원본 op에서 추론
  return {
    tag,
    description: `${tag} 패턴 수정이 빈번함`,
    condition: { section, raw_tag: tag },
    action: { op: representativeOp.op, path: representativeOp.path },
  };
}

// ─── 값 통계 수집 (width, kind 등의 "올바른 값" 추론) ───

interface ValueStats {
  /** tag별 corrected 값의 분포 { value: count } */
  [tag: string]: Record<string, number>;
}

function collectValueStats(pairs: SinkDiffPair[]): ValueStats {
  const stats: ValueStats = {};
  for (const pair of pairs) {
    for (const diff of pair.diffs) {
      if (diff.op !== 'replace' || diff.to == null) continue;
      if (!stats[diff.tag]) stats[diff.tag] = {};
      const val = String(diff.to);
      stats[diff.tag][val] = (stats[diff.tag][val] ?? 0) + 1;
    }
  }
  return stats;
}

function mostFrequentValue(dist: Record<string, number>): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [val, count] of Object.entries(dist)) {
    if (count > bestCount) { best = val; bestCount = count; }
  }
  return best;
}

// ─── 메인 마이닝 로직 ───

export interface MineRulesResult {
  totalPairsScanned: number;
  rulesExtracted: number;
  rulesActivated: number;
  rules: Array<{
    tag: string;
    description: string;
    confidence: number;
    sample_count: number;
    is_active: boolean;
    preferred_value: string | null;
  }>;
}

export async function mineRules(): Promise<MineRulesResult> {
  log.info('Starting rule mining...');

  const pairs = await listPairs(1000); // 최대 1000개 pair 스캔
  if (pairs.length === 0) {
    log.info('No pairs to mine');
    return { totalPairsScanned: 0, rulesExtracted: 0, rulesActivated: 0, rules: [] };
  }

  // 1. 전체 tag 히스토그램
  const globalHist: Record<string, number> = {};
  const tagRepresentativeOp: Record<string, SinkDiffOp> = {};

  for (const pair of pairs) {
    const hist = tagHistogram(pair.diffs);
    for (const [tag, count] of Object.entries(hist)) {
      globalHist[tag] = (globalHist[tag] ?? 0) + count;
      if (!tagRepresentativeOp[tag] && pair.diffs.length > 0) {
        tagRepresentativeOp[tag] = pair.diffs.find((d: SinkDiffOp) => d.tag === tag)!;
      }
    }
  }

  // 2. 값 통계 수집
  const valueStats = collectValueStats(pairs);

  // 3. 빈도 >= MIN_OCCURRENCE인 태그만 규칙으로
  const totalPairs = pairs.length;
  const ruleRows: Omit<SinkHitlRule, 'created_at' | 'updated_at'>[] = [];
  const rulesSummary: MineRulesResult['rules'] = [];

  for (const [tag, count] of Object.entries(globalHist)) {
    if (count < MIN_OCCURRENCE) continue;

    const repOp = tagRepresentativeOp[tag];
    if (!repOp) continue;

    const parsed = parseTag(tag, repOp);
    if (!parsed) continue;

    const confidence = count / totalPairs;
    const isActive = confidence >= AUTO_ACTIVATE_THRESHOLD;

    // 선호 값 (replace 작업에서 가장 많이 선택된 corrected 값)
    const preferredValue = valueStats[tag] ? mostFrequentValue(valueStats[tag]) : null;

    // action에 preferred_value 추가
    const enrichedAction = { ...parsed.action };
    if (preferredValue != null) {
      enrichedAction.preferred_value = preferredValue;
    }

    const ruleId = `rule-${tag}`;
    ruleRows.push({
      rule_id: ruleId,
      tag,
      description: parsed.description,
      condition: parsed.condition,
      action: enrichedAction,
      confidence: Math.round(confidence * 1000) / 1000,
      sample_count: count,
      is_active: isActive,
    });

    rulesSummary.push({
      tag,
      description: parsed.description,
      confidence: Math.round(confidence * 1000) / 1000,
      sample_count: count,
      is_active: isActive,
      preferred_value: preferredValue,
    });
  }

  // 4. Supabase에 upsert
  const savedCount = await saveRules(ruleRows);
  const activatedCount = rulesSummary.filter(r => r.is_active).length;

  log.info(
    { pairs: totalPairs, rules: savedCount, activated: activatedCount },
    'Rule mining complete',
  );

  return {
    totalPairsScanned: totalPairs,
    rulesExtracted: savedCount,
    rulesActivated: activatedCount,
    rules: rulesSummary.sort((a, b) => b.confidence - a.confidence),
  };
}

// ─── 피드백 요약 (대시보드용) ───

export interface FeedbackSummary {
  totalPairs: number;
  activeRuleCount: number;
  avgAiRating: number;
  topCorrectionTags: Array<{ tag: string; count: number; description: string }>;
}

export async function getFeedbackSummary(): Promise<FeedbackSummary> {
  const pairs = await listPairs(500);

  // AI 생성 pair만 필터
  const aiPairs = pairs.filter(p => p.generated.meta.generated_by === 'ai_design');
  const avgAiRating = aiPairs.length > 0
    ? aiPairs.reduce((s, p) => s + p.rating, 0) / aiPairs.length
    : 0;

  // 전체 tag 집계
  const globalHist: Record<string, number> = {};
  for (const pair of pairs) {
    const hist = tagHistogram(pair.diffs);
    for (const [tag, count] of Object.entries(hist)) {
      globalHist[tag] = (globalHist[tag] ?? 0) + count;
    }
  }

  // Top 5
  const topTags = Object.entries(globalHist)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tag, count]) => {
      const repOp: SinkDiffOp = { op: 'replace', path: '', tag };
      const parsed = parseTag(tag, repOp);
      return { tag, count, description: parsed?.description ?? tag };
    });

  // active rules는 Supabase에서 직접 가져옴
  const { getActiveRules } = await import('./sink-hitl-storage.service.js');
  const activeRules = await getActiveRules();

  return {
    totalPairs: pairs.length,
    activeRuleCount: activeRules.length,
    avgAiRating: Math.round(avgAiRating * 10) / 10,
    topCorrectionTags: topTags,
  };
}
