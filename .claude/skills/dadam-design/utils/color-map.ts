// ═══════════════════════════════════════════════════════════════
// Color & Material Mapping - 색상 및 자재 매핑
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
// 색상 매핑 (한글 → 영문 + HEX)
// ─────────────────────────────────────────────────────────────────

export const COLOR_MAP: Record<string, string> = {
  '화이트': 'pure white (#FFFFFF)',
  '그레이': 'warm gray (#9E9E9E)',
  '블랙': 'matte black (#2D2D2D)',
  '아이보리': 'soft ivory (#FFFFF0)',
  '베이지': 'warm beige (#F5F5DC)',
  '브라운': 'deep brown (#8B4513)',
  '오크': 'natural oak wood grain',
  '월넛': 'dark walnut wood grain',
  '체리': 'cherry wood grain',
  '애쉬': 'light ash wood grain',
  '스노우': 'snow white (#FAFAFA)',
  '네이비': 'navy blue (#000080)',
  '블루': 'sky blue (#87CEEB)',
  '그린': 'sage green (#9DC183)',
  '핑크': 'blush pink (#FFB6C1)',
  '레드': 'burgundy red (#800020)',
  '옐로우': 'warm yellow (#FFD700)',
};

// ─────────────────────────────────────────────────────────────────
// 마감 매핑
// ─────────────────────────────────────────────────────────────────

export const FINISH_MAP: Record<string, string> = {
  '무광': 'matte (no reflection)',
  '유광': 'high-gloss (reflective)',
  '펄': 'pearl shimmer',
  '매트': 'matte finish',
  '글로시': 'glossy finish',
  '엠보': 'embossed texture',
  '새틴': 'satin finish',
};

// ─────────────────────────────────────────────────────────────────
// 핸들 타입 매핑
// ─────────────────────────────────────────────────────────────────

export const HANDLE_MAP: Record<string, string> = {
  '푸시오픈': 'push-to-open (handleless)',
  'push-open': 'push-to-open (handleless)',
  '찬넬 (목찬넬)': 'wooden channel handle',
  '찬넬': 'channel handle',
  'J핸들': 'J-profile handle',
  '스마트바': 'slim bar handle',
  '라운드바': 'round bar handle',
  '플랫바': 'flat bar handle',
  '가죽핸들': 'leather strap handle',
};

// ─────────────────────────────────────────────────────────────────
// 카테고리 매핑
// ─────────────────────────────────────────────────────────────────

export interface CategoryInfo {
  en: string;
  ko: string;
  room: string;
}

export const CATEGORY_MAP: Record<string, CategoryInfo> = {
  sink: { en: 'Kitchen Cabinet', ko: '싱크대', room: 'kitchen' },
  wardrobe: { en: 'Built-in Wardrobe', ko: '붙박이장', room: 'bedroom' },
  fridge: { en: 'Refrigerator Cabinet', ko: '냉장고장', room: 'kitchen' },
  shoerack: { en: 'Shoe Cabinet', ko: '신발장', room: 'entrance' },
  shoe: { en: 'Shoe Cabinet', ko: '신발장', room: 'entrance' },
  vanity: { en: 'Vanity Cabinet', ko: '화장대', room: 'bedroom' },
  storage: { en: 'Storage Cabinet', ko: '수납장', room: 'living room' },
  island: { en: 'Kitchen Island', ko: '아일랜드', room: 'kitchen' },
};

// ─────────────────────────────────────────────────────────────────
// 헬퍼 함수들
// ─────────────────────────────────────────────────────────────────

export function mapColor(koreanColor: string): string {
  return COLOR_MAP[koreanColor] || koreanColor;
}

export function mapFinish(koreanFinish: string): string {
  return FINISH_MAP[koreanFinish] || koreanFinish;
}

export function mapHandle(koreanHandle: string): string {
  return HANDLE_MAP[koreanHandle] || koreanHandle;
}

export function getCategoryInfo(category: string): CategoryInfo {
  return CATEGORY_MAP[category] || CATEGORY_MAP.sink;
}

// ─────────────────────────────────────────────────────────────────
// 카테고리별 내용물 (열린 도어용)
// ─────────────────────────────────────────────────────────────────

export const CATEGORY_CONTENTS: Record<string, string> = {
  wardrobe: `- 행거에 걸린 셔츠, 블라우스, 재킷, 코트
- 접힌 스웨터, 니트, 티셔츠
- 청바지, 면바지 등 하의류
- 서랍 속 속옷, 양말 정리함
- 가방, 모자, 스카프 액세서리`,

  sink: `- 그릇, 접시, 밥공기, 국그릇
- 컵, 머그잔, 유리잔
- 냄비, 프라이팬, 조리도구
- 양념통, 오일병
- 도마, 주걱, 국자`,

  fridge: `- 커피머신, 전자레인지
- 토스터, 믹서기
- 식료품, 시리얼
- 컵, 머그잔`,

  vanity: `- 화장품, 스킨케어 제품
- 메이크업 브러시, 파우치
- 향수, 로션
- 헤어드라이어`,

  shoe: `- 운동화, 스니커즈
- 구두, 로퍼, 힐
- 샌들, 슬리퍼
- 부츠`,

  storage: `- 책, 잡지, 문서
- 수납박스, 바구니
- 이불, 침구류
- 여행가방`,
};

export function getCategoryContents(category: string): string {
  return CATEGORY_CONTENTS[category] || CATEGORY_CONTENTS.storage;
}
