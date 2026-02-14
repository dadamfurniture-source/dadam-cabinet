// ═══════════════════════════════════════════════════════════════
// BOM Rules Loader - JSON 파일 로드 + 기본값 병합
// config/bom-rules.json → 검증 → 캐시
// ═══════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import { DEFAULT_BOM_RULES, type BomRules } from './bom-rules.defaults.js';

const log = createLogger('bom-rules');

// ESM에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// config/ 디렉토리 경로 (src/config/ → mcp-server/config/)
const RULES_PATH = join(__dirname, '..', '..', 'config', 'bom-rules.json');

let cachedRules: BomRules | null = null;

/**
 * 규칙 로드: JSON 파일 → 기본값과 병합
 * JSON이 없거나 파싱 실패 시 기본값 반환
 */
export function loadBomRules(): BomRules {
  try {
    const raw = readFileSync(RULES_PATH, 'utf-8');
    const json = JSON.parse(raw);
    const merged = deepMerge(
      DEFAULT_BOM_RULES as unknown as Record<string, unknown>,
      json as Record<string, unknown>,
    ) as unknown as BomRules;
    cachedRules = merged;
    log.info('BOM rules loaded from config/bom-rules.json');
    return merged;
  } catch (error) {
    log.warn({ error }, 'Failed to load bom-rules.json, using defaults');
    cachedRules = { ...DEFAULT_BOM_RULES };
    return cachedRules;
  }
}

/**
 * 캐시된 규칙 반환 (없으면 로드)
 */
export function getBomRules(): BomRules {
  if (!cachedRules) {
    return loadBomRules();
  }
  return cachedRules;
}

/**
 * 규칙 저장 (JSON 파일에 기록)
 */
export function saveBomRules(rules: BomRules): void {
  const json = JSON.stringify(rules, null, 2);
  writeFileSync(RULES_PATH, json, 'utf-8');
  cachedRules = rules;
  log.info('BOM rules saved to config/bom-rules.json');
}

/**
 * 기본값으로 리셋
 */
export function resetBomRules(): BomRules {
  saveBomRules(DEFAULT_BOM_RULES);
  return DEFAULT_BOM_RULES;
}

/**
 * 캐시 무효화 (테스트용)
 */
export function clearBomRulesCache(): void {
  cachedRules = null;
}

/**
 * 규칙 파일 경로 반환
 */
export function getBomRulesPath(): string {
  return RULES_PATH;
}

// ─────────────────────────────────────────────────────────────────
// Deep merge utility
// ─────────────────────────────────────────────────────────────────

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}
