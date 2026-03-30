// ═══════════════════════════════════════════════════════════════
// Sanitize - 프롬프트 인젝션 방지 유틸리티
// ═══════════════════════════════════════════════════════════════

/**
 * 프롬프트에 삽입되는 사용자 입력에서 위험한 패턴을 제거합니다.
 * - 시스템 프롬프트 오버라이드 패턴
 * - 제어 문자
 * - 과도하게 긴 문자열 (maxLen 제한)
 */
export function sanitizePromptInput(input: string | undefined, maxLen: number = 500): string {
  if (!input) return '';

  let safe = input
    // 제어 문자 제거 (탭/줄바꿈은 공백으로)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[\t\r\n]+/g, ' ')
    // 시스템 프롬프트 오버라이드 패턴 제거
    .replace(/\[SYSTEM\]/gi, '')
    .replace(/\[INST\]/gi, '')
    .replace(/<<SYS>>/gi, '')
    .replace(/<\/SYS>/gi, '')
    .replace(/ignore\s+(previous|above|all)\s+(instructions?|prompt)/gi, '')
    .replace(/forget\s+(everything|all|previous)/gi, '')
    .replace(/you\s+are\s+now/gi, '')
    .replace(/new\s+instructions?:/gi, '')
    .trim();

  // 길이 제한
  if (safe.length > maxLen) {
    safe = safe.slice(0, maxLen);
  }

  return safe;
}
