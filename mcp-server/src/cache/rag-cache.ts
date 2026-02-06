// ═══════════════════════════════════════════════════════════════
// RAG Cache - RAG 검색 결과 캐시 (Supabase 호출 ~30% 절감)
// ═══════════════════════════════════════════════════════════════

import { MemoryCache } from './memory-cache.js';
import type { DesignRule } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('rag-cache');

const RAG_CACHE_TTL = 5 * 60 * 1000; // 5분
const ragCache = new MemoryCache<DesignRule[]>(RAG_CACHE_TTL, 100);

export function buildRagCacheKey(category: string, triggers: string[]): string {
  return `${category}:${triggers.sort().join(',')}`;
}

export function getCachedRagResults(category: string, triggers: string[]): DesignRule[] | undefined {
  const key = buildRagCacheKey(category, triggers);
  const cached = ragCache.get(key);
  if (cached) {
    log.debug({ category, key }, 'RAG cache hit');
  }
  return cached;
}

export function setCachedRagResults(category: string, triggers: string[], rules: DesignRule[]): void {
  const key = buildRagCacheKey(category, triggers);
  ragCache.set(key, rules);
  log.debug({ category, key, count: rules.length }, 'RAG results cached');
}

export function clearRagCache(): void {
  ragCache.clear();
  log.info('RAG cache cleared');
}
