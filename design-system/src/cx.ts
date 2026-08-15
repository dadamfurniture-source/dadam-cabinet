/** 클래스명 결합 헬퍼 — falsy 값은 버리고 공백으로 잇는다. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
