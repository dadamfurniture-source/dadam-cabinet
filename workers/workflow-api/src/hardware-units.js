/**
 * 철물 수량 단위 — 화면 · 문서에 보이는 이름 (2026-11-21 사장님 「수량 단위도 정확하게 표현 해줘」).
 *
 * 엔진 철물 행의 단위 코드(EA · SET · 조)는 그대로 둔다 — 재고 · 가격 키가 그 값을 쓴다. 보일 때만 이름으로 바꾼다.
 *   EA  개
 *   SET 세트 — 레일은 좌우 한 쌍이 한 세트 (docs/design-rules/hardware.md 단위 열의 약속)
 *   PAIR 쌍
 *   조  조 — 슬라이딩 상 · 하레일 한 벌
 * 모르는 단위는 받은 글 그대로 (없으면 개).
 */
export const UNIT_NAME = Object.freeze({ EA: '개', SET: '세트', PAIR: '쌍' });

/** @param {unknown} u 엔진 행의 unit @returns {string} */
export function unitNameOf(u) {
  const s = String(u == null ? '' : u).trim();
  return UNIT_NAME[s.toUpperCase()] || s.slice(0, 8) || '개';
}
