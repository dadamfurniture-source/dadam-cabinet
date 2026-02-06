// ═══════════════════════════════════════════════════════════════
// JSON Extractor - Gemini 응답에서 안전한 JSON 추출
// ═══════════════════════════════════════════════════════════════

import { createLogger } from './logger.js';

const log = createLogger('json-extractor');

/**
 * 텍스트에서 JSON 객체를 안전하게 추출
 * - 마크다운 코드 블록 (```json ... ```) 처리
 * - 앞뒤 텍스트가 있는 JSON 처리
 * - 중첩 괄호가 있는 JSON 처리
 */
export function extractJsonFromText(text: string): Record<string, unknown> | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  // 1. 마크다운 코드 블록에서 JSON 추출 시도
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    const parsed = tryParse(codeBlockMatch[1].trim());
    if (parsed) return parsed;
  }

  // 2. 가장 바깥쪽 중괄호 매칭 (탐욕적 정규식 대신 괄호 카운팅)
  const jsonStr = extractOutermostJson(text);
  if (jsonStr) {
    const parsed = tryParse(jsonStr);
    if (parsed) return parsed;
  }

  // 3. 폴백: 기존 탐욕적 정규식
  const greedyMatch = text.match(/\{[\s\S]*\}/);
  if (greedyMatch) {
    const parsed = tryParse(greedyMatch[0]);
    if (parsed) return parsed;
  }

  log.warn('Failed to extract JSON from text (length: %d)', text.length);
  return null;
}

function extractOutermostJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function tryParse(str: string): Record<string, unknown> | null {
  try {
    const result = JSON.parse(str);
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
