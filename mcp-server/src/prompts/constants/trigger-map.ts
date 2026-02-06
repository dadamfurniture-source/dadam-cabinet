// ═══════════════════════════════════════════════════════════════
// Trigger Map - 카테고리별 RAG 트리거 키워드 (Single Source of Truth)
// 기존: http-server.ts 536~543줄
// ═══════════════════════════════════════════════════════════════

export const TRIGGER_MAP: Record<string, string[]> = {
  sink: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  wardrobe: ['붙박이장', '좌대', '상몰딩', '짧은옷', '긴옷', '서랍', '스마트바', '배경보정', '벽면마감'],
  fridge: ['냉장고장', '상부장', 'EL장', '홈카페', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  vanity: ['화장대', '서랍', '미러', '배경보정', '벽면마감'],
  shoe: ['신발장', '서랍', '선반', '배경보정', '벽면마감'],
  storage: ['수납장', '선반', '서랍', '배경보정', '벽면마감'],
};

const COLOR_KEYWORDS = ['화이트', '그레이', '블랙', '오크', '월넛', '무광', '유광', 'white', 'gray', 'oak'];

export function extractColorKeywords(text: string): string[] {
  return COLOR_KEYWORDS.filter(k => text.toLowerCase().includes(k.toLowerCase()));
}

export function getTriggers(category: string, style: string): string[] {
  const baseTriggers = TRIGGER_MAP[category] || TRIGGER_MAP.sink;
  const colorKeywords = extractColorKeywords(style);
  return [...baseTriggers, ...colorKeywords.slice(0, 5)];
}
