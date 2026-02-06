// ═══════════════════════════════════════════════════════════════
// RAG Search Service - 트리거 생성, RAG 검색, 규칙 분류
// ═══════════════════════════════════════════════════════════════

import { createLogger } from '../utils/logger.js';
import { searchRagRules } from '../clients/supabase.client.js';
import { getCachedRagResults, setCachedRagResults } from '../cache/rag-cache.js';
import { classifyRules, type ClassifiedRules } from '../mappers/rule-classifier.js';
import { getTriggers } from '../prompts/constants/trigger-map.js';
import type { DesignRule } from '../types/index.js';

const log = createLogger('rag-search');

export interface RagSearchResult {
  rules: DesignRule[];
  classified: ClassifiedRules;
  triggers: string[];
}

export async function searchAndClassifyRules(
  category: string,
  style: string,
  limit: number = 25
): Promise<RagSearchResult> {
  const triggers = getTriggers(category, style);

  // 캐시 확인
  const cached = getCachedRagResults(category, triggers);
  if (cached) {
    log.info({ category, count: cached.length }, 'Using cached RAG results');
    return {
      rules: cached,
      classified: classifyRules(cached),
      triggers,
    };
  }

  // Supabase RAG 검색
  let rules: DesignRule[] = [];
  try {
    rules = await searchRagRules({
      query_triggers: triggers,
      filter_category: category,
      limit_count: limit,
    });
    log.info({ category, count: rules.length }, 'RAG search complete');

    // 결과 캐싱
    setCachedRagResults(category, triggers, rules);
  } catch (error) {
    log.warn({ category, error }, 'RAG search failed, using defaults');
  }

  return {
    rules,
    classified: classifyRules(rules),
    triggers,
  };
}
