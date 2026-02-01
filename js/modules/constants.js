/**
 * Constants - 전역 상수 정의
 * 카테고리, 도어 규칙, 색상 매핑 등
 */

// 앱 설정
export const APP_CONFIG = {
  version: '1.0.0',
  name: '다담가구 상세설계',
  autoSaveInterval: 30000, // 30초
  maxUndoHistory: 10,
};

// 카테고리 정의
export const CATEGORIES = [
  {
    id: 'sink',
    name: '싱크대',
    icon: '🍳',
    hasUpper: true,
    hasLower: true,
    hasTall: true,
  },
  {
    id: 'wardrobe',
    name: '붙박이장',
    icon: '🚪',
    hasUpper: false,
    hasLower: false,
    hasTall: false,
  },
  {
    id: 'fridge',
    name: '냉장고장',
    icon: '❄️',
    hasUpper: false,
    hasLower: false,
    hasTall: true,
  },
  {
    id: 'vanity',
    name: '화장대',
    icon: '💄',
    hasUpper: false,
    hasLower: false,
    hasTall: false,
  },
  {
    id: 'shoe',
    name: '신발장',
    icon: '👟',
    hasUpper: false,
    hasLower: false,
    hasTall: false,
  },
  {
    id: 'storage',
    name: '수납장',
    icon: '📦',
    hasUpper: false,
    hasLower: false,
    hasTall: false,
  },
];

// 도어 너비 규칙
export const DOOR_RULES = {
  TARGET_WIDTH: 450, // 목표 도어 너비 (mm)
  MAX_WIDTH: 600, // 최대 도어 너비 (mm)
  MIN_WIDTH: 350, // 최소 도어 너비 (mm)
  MIN_REMAINDER: 4, // 최소 잔여 (mm)
  MAX_REMAINDER: 10, // 최대 잔여 (mm)
};

// 기본 스펙
export const DEFAULT_SPECS = {
  sink: {
    doorColor: 'white',
    upperHeight: 720,
    lowerHeight: 830,
    tallHeight: 2100,
    depth: 350,
    lowerDepth: 570,
  },
  wardrobe: {
    doorColor: 'white',
    height: 2400,
    depth: 600,
    doorType: 'swing', // swing, sliding
  },
  fridge: {
    doorColor: 'white',
    height: 2100,
    depth: 600,
    brand: 'lg',
  },
};

// 도어 색상 매핑
export const DOOR_COLOR_MAP = {
  white: { name: '화이트', hex: '#FFFFFF', textColor: '#333' },
  ivory: { name: '아이보리', hex: '#FFFFF0', textColor: '#333' },
  cream: { name: '크림', hex: '#FFFDD0', textColor: '#333' },
  beige: { name: '베이지', hex: '#F5F5DC', textColor: '#333' },
  gray: { name: '그레이', hex: '#808080', textColor: '#FFF' },
  'dark-gray': { name: '다크그레이', hex: '#4A4A4A', textColor: '#FFF' },
  navy: { name: '네이비', hex: '#000080', textColor: '#FFF' },
  black: { name: '블랙', hex: '#2C2C2C', textColor: '#FFF' },
  wood: { name: '우드', hex: '#DEB887', textColor: '#333' },
  'dark-wood': { name: '다크우드', hex: '#8B4513', textColor: '#FFF' },
};

// 냉장고 브랜드 및 모델 데이터
export const FRIDGE_DATA = {
  lg: {
    name: 'LG',
    models: [
      { id: 'lg-dios-820', name: 'DIOS 820L', width: 912, height: 1793, depth: 907 },
      { id: 'lg-dios-870', name: 'DIOS 870L', width: 912, height: 1793, depth: 907 },
      { id: 'lg-dios-636', name: 'DIOS 636L', width: 912, height: 1793, depth: 733 },
    ],
  },
  samsung: {
    name: 'Samsung',
    models: [
      { id: 'samsung-bespoke-870', name: 'BESPOKE 870L', width: 912, height: 1853, depth: 908 },
      { id: 'samsung-bespoke-615', name: 'BESPOKE 615L', width: 912, height: 1853, depth: 734 },
    ],
  },
  other: {
    name: '기타',
    models: [{ id: 'custom', name: '직접 입력', width: 0, height: 0, depth: 0 }],
  },
};

// 냉장고 다리 타입
export const FRIDGE_LEG_TYPES = [
  { id: 'none', name: '없음', height: 0 },
  { id: 'standard', name: '기본 다리', height: 100 },
  { id: 'high', name: '높은 다리', height: 150 },
];

// 하부장 모듈 타입
export const LOWER_MODULE_TYPES = [
  { id: 'drawer', name: '서랍', icon: '🗄️' },
  { id: 'door', name: '도어', icon: '🚪' },
  { id: 'sink', name: '싱크볼', icon: '🚰' },
  { id: 'cooktop', name: '쿡탑', icon: '🔥' },
  { id: 'open', name: '오픈장', icon: '📦' },
];

// EL장 (키큰장) 도어 타입
export const EL_DOOR_TYPES = [
  { id: 'single', name: '단문', doors: 1 },
  { id: 'double', name: '양문', doors: 2 },
  { id: 'sliding', name: '슬라이딩', doors: 2 },
];

// 도어 구분 타입
export const DOOR_DIVISION_TYPES = [
  { id: 'full', name: '풀도어' },
  { id: 'upper-lower', name: '상하분리' },
  { id: 'asymmetric', name: '비대칭' },
];

// 마감 타입
export const FINISH_TYPES = [
  { id: 'molding', name: '몰딩', addHeight: 50 },
  { id: 'filler', name: '휠라', addHeight: 30 },
  { id: 'ep', name: 'EP', addHeight: 0 },
  { id: 'none', name: '없음', addHeight: 0 },
];

// 붙박이장 섹션 타입
export const WARDROBE_SECTION_TYPES = [
  { id: 'hanging', name: '행거', icon: '👔' },
  { id: 'shelf', name: '선반', icon: '📚' },
  { id: 'drawer', name: '서랍', icon: '🗄️' },
  { id: 'mixed', name: '혼합', icon: '🔀' },
];

// API 엔드포인트 (Cloudflare Proxy 경유 - CORS 해결)
export const API_ENDPOINTS = {
  N8N_CHAT: 'https://dadam-proxy.dadamfurniture.workers.dev/webhook/chat',
  N8N_AI_DESIGN: 'https://dadam-proxy.dadamfurniture.workers.dev/webhook/design-to-image',
  N8N_WALL_ANALYSIS: 'https://dadam-proxy.dadamfurniture.workers.dev/webhook/dadam-interior-v4',
  SUPABASE_URL: 'https://vvqrvgcgnlfpiqqndsve.supabase.co',
};

// 전역 노출 (레거시 코드 호환)
if (typeof window !== 'undefined') {
  window.DadamConstants = {
    APP_CONFIG,
    CATEGORIES,
    DOOR_RULES,
    DEFAULT_SPECS,
    DOOR_COLOR_MAP,
    FRIDGE_DATA,
    FRIDGE_LEG_TYPES,
    LOWER_MODULE_TYPES,
    EL_DOOR_TYPES,
    DOOR_DIVISION_TYPES,
    FINISH_TYPES,
    WARDROBE_SECTION_TYPES,
    API_ENDPOINTS,
  };
}
