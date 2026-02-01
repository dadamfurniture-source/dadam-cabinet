// ═══════════════════════════════════════════════════════════════
// Parse Input - 사용자 입력 파싱 및 트리거 생성
// ═══════════════════════════════════════════════════════════════

export type Category = 'sink' | 'wardrobe' | 'fridge' | 'vanity' | 'shoe' | 'storage';

export interface ParsedInput {
  category: Category;
  style: string;
  roomImage: string;
  imageType: string;
  triggers: string[];
  materialCodes: string[];
  colorKeywords: string[];
  hasMaterialRequest: boolean;
}

export interface RawInput {
  category?: string;
  style?: string;
  design_style?: string;
  room_image?: string;
  image_type?: string;
}

// ─────────────────────────────────────────────────────────────────
// 카테고리별 RAG 트리거 맵
// ─────────────────────────────────────────────────────────────────

const TRIGGER_MAP: Record<Category, string[]> = {
  sink: ['상부장', '하부장', '걸레받이', '도어규격', '몰딩', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  wardrobe: ['붙박이장', '좌대', '상몰딩', '짧은옷', '긴옷', '서랍', '스마트바', '배경보정', '벽면마감'],
  fridge: ['냉장고장', '상부장', 'EL장', '홈카페', '배경보정', '벽면마감', '천장마감', '바닥마감'],
  vanity: ['화장대', '거울', '서랍', '조명', '배경보정', '벽면마감'],
  shoe: ['신발장', '좌대', '도어', '환기구', '배경보정', '벽면마감'],
  storage: ['수납장', '선반', '도어', '서랍', '배경보정', '벽면마감'],
};

// ─────────────────────────────────────────────────────────────────
// 자재코드 패턴
// ─────────────────────────────────────────────────────────────────

const MATERIAL_PATTERNS: RegExp[] = [
  /YPG-\d+/gi,     // Prestige Glass
  /YPA-\d+/gi,     // Prestige Acryl
  /YPW-\d+/gi,     // Prestige PP
  /SM-\d+/gi,      // Supreme PET Matt
  /SG-\d+/gi,      // Supreme PET Glossy
  /CP-\d+/gi,      // Supreme PP Calacatta
  /PW-\d+/gi,      // Supreme PP Wood
  /LC-\d+/gi,      // Supreme PP Concrete
  /PL-\d+/gi,      // Supreme PP Leather
  /PM-\d+/gi,      // Prestige PET Matt
  /PE-\d+/gi,      // Prestige PET Emboss
  /AM-\d+/gi,      // Prestige Acryl Matt
  /LP-\d+/gi,      // Lux Pearl
  /HS\d+/gi,       // Deco PVC Solid
  /HC\d+/gi,       // Deco PVC Solid (Antibacterial)
  /HP\d+/gi,       // Deco PVC Solid
  /HW\d+/gi,       // Deco PVC Wood
  /MFB-\d+/gi,     // Prime MFB
  /LS-\d+/gi,      // Prime UV
];

// ─────────────────────────────────────────────────────────────────
// 색상/스타일 키워드
// ─────────────────────────────────────────────────────────────────

const COLOR_KEYWORDS: string[] = [
  // 한글 키워드
  '화이트', '그레이', '블랙', '아이보리', '베이지', '브라운',
  '오크', '월넛', '체리', '애쉬',
  '네이비', '블루', '그린', '핑크', '레드', '옐로우',
  '무광', '유광', '펄', '매트', '글로시',
  '마블', '스톤', '콘크리트', '우드', '가죽', '레더',
  '비스포크', '뉴트로', '플레이', '북유럽', '모던', '미니멀',
  // 영문 키워드
  'white', 'grey', 'gray', 'black', 'ivory', 'beige', 'brown',
  'oak', 'walnut', 'matte', 'glossy', 'pearl',
  'marble', 'stone', 'wood', 'bespoke', 'modern', 'minimal',
];

// ─────────────────────────────────────────────────────────────────
// 자재코드 감지 함수
// ─────────────────────────────────────────────────────────────────

export function detectMaterialCodes(styleText: string): string[] {
  if (!styleText) return [];

  const detectedCodes: string[] = [];
  for (const pattern of MATERIAL_PATTERNS) {
    const matches = styleText.match(pattern);
    if (matches) {
      detectedCodes.push(...matches.map(m => m.toUpperCase()));
    }
  }
  return [...new Set(detectedCodes)];
}

// ─────────────────────────────────────────────────────────────────
// 색상 키워드 감지 함수
// ─────────────────────────────────────────────────────────────────

export function detectColorKeywords(styleText: string): string[] {
  if (!styleText) return [];

  const detected: string[] = [];
  const lowerStyle = styleText.toLowerCase();

  for (const keyword of COLOR_KEYWORDS) {
    if (styleText.includes(keyword) || lowerStyle.includes(keyword.toLowerCase())) {
      detected.push(keyword);
    }
  }
  return [...new Set(detected)];
}

// ─────────────────────────────────────────────────────────────────
// 메인 파싱 함수
// ─────────────────────────────────────────────────────────────────

export function parseInput(input: RawInput): ParsedInput {
  const category = (input.category || 'sink') as Category;
  const style = input.style || input.design_style || 'modern';
  const roomImage = input.room_image || '';
  const imageType = input.image_type || 'image/jpeg';

  // 자재코드 및 색상 감지
  const materialCodes = detectMaterialCodes(style);
  const colorKeywords = detectColorKeywords(style);

  // 트리거 조합
  let triggers = [...(TRIGGER_MAP[category] || TRIGGER_MAP.sink)];

  if (materialCodes.length > 0) {
    triggers = [...triggers, ...materialCodes];
  }

  if (colorKeywords.length > 0) {
    triggers = [...triggers, ...colorKeywords.slice(0, 5)];
  }

  return {
    category,
    style,
    roomImage,
    imageType,
    triggers,
    materialCodes,
    colorKeywords,
    hasMaterialRequest: materialCodes.length > 0 || colorKeywords.length > 0,
  };
}
