/**
 * Dadam Cabinet 타입 정의
 * 전역 타입 및 인터페이스
 */

// ============================================
// 기본 타입
// ============================================

/** 카테고리 ID */
export type CategoryId = 'sink' | 'wardrobe' | 'fridge' | 'vanity' | 'shoe' | 'storage';

/** 회원 등급 */
export type UserTier = 'standard' | 'expert' | 'business';

/** 설계 상태 */
export type DesignStatus = 'draft' | 'submitted' | 'in_review' | 'completed' | 'feedback_done';

/** 도어 색상 */
export type DoorColor =
  | 'white'
  | 'ivory'
  | 'cream'
  | 'beige'
  | 'gray'
  | 'dark-gray'
  | 'navy'
  | 'black'
  | 'wood'
  | 'dark-wood';

// ============================================
// 아이템 및 모듈
// ============================================

/** 기본 아이템 */
export interface DesignItem {
  uniqueId: number;
  category: CategoryId;
  name?: string;
  width: number;
  height: number;
  depth: number;
  specs: ItemSpecs;
  modules: Module[];
}

/** 아이템 스펙 */
export interface ItemSpecs {
  doorColor?: DoorColor;
  upperHeight?: number;
  lowerHeight?: number;
  tallHeight?: number;
  doorType?: 'swing' | 'sliding';
  finishType?: 'molding' | 'filler' | 'ep' | 'none';
  [key: string]: unknown;
}

/** 모듈 기본 구조 */
export interface Module {
  id: number;
  type: string;
  w: number;
  h?: number;
  d?: number;
  pos?: number;
  fixed?: boolean;
  doors?: number;
  drawers?: number;
  shelves?: number;
  [key: string]: unknown;
}

/** 싱크대 모듈 */
export interface SinkModule extends Module {
  type: 'drawer' | 'door' | 'sink' | 'cooktop' | 'open';
  section?: 'upper' | 'lower' | 'tall';
}

/** 붙박이장 모듈 */
export interface WardrobeModule extends Module {
  type: 'hanging' | 'shelf' | 'drawer' | 'mixed';
  rodHeight?: number;
  shelfCount?: number;
}

/** 냉장고장 모듈 */
export interface FridgeModule extends Module {
  type: 'fridge' | 'side' | 'upper' | 'el';
  brand?: string;
  model?: string;
}

// ============================================
// 사용자 및 인증
// ============================================

/** 사용자 프로필 */
export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  tier: UserTier;
  sido?: string;
  gugun?: string;
  marketingAgreed?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Supabase 세션 */
export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    user_metadata: {
      tier?: UserTier;
      name?: string;
    };
  };
}

// ============================================
// 설계 데이터
// ============================================

/** 설계 메타데이터 */
export interface Design {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: DesignStatus;
  totalItems: number;
  totalModules: number;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

/** 설계 내보내기 데이터 */
export interface DesignExport {
  appVersion: string;
  exportDate: string;
  items: DesignItem[];
}

/** 설계 저장 요청 */
export interface SaveDesignRequest {
  designId: string;
  name: string;
  items: DesignItem[];
  appVersion: string;
}

// ============================================
// API 응답
// ============================================

/** API 응답 기본 구조 */
export interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
}

/** API 에러 */
export interface ApiError {
  message: string;
  code?: string;
  details?: unknown;
}

/** AI 설계 응답 */
export interface AIDesignResponse {
  success: boolean;
  images: {
    original: string;
    doorsClosed: string;
    doorsOpen: string;
  };
  wallAnalysis?: {
    dimensions: {
      width: number;
      height: number;
    };
    obstacles: string[];
  };
}

// ============================================
// 이벤트
// ============================================

/** 이벤트 타입 */
export type EventType =
  | 'state:changed'
  | 'item:added'
  | 'item:removed'
  | 'item:updated'
  | 'module:added'
  | 'module:removed'
  | 'module:updated'
  | 'ui:render_requested'
  | 'ui:step_changed'
  | 'auth:state_changed'
  | 'auth:logged_in'
  | 'auth:logged_out'
  | 'save:started'
  | 'save:completed'
  | 'save:failed'
  | 'design:loaded';

/** 이벤트 핸들러 */
export type EventHandler<T = unknown> = (data: T) => void;

// ============================================
// 상수
// ============================================

/** 카테고리 정보 */
export interface CategoryInfo {
  id: CategoryId;
  name: string;
  icon: string;
  hasUpper: boolean;
  hasLower: boolean;
  hasTall: boolean;
}

/** 도어 색상 정보 */
export interface DoorColorInfo {
  name: string;
  hex: string;
  textColor: string;
}

/** 냉장고 모델 정보 */
export interface FridgeModel {
  id: string;
  name: string;
  width: number;
  height: number;
  depth: number;
}

/** 냉장고 브랜드 정보 */
export interface FridgeBrand {
  name: string;
  models: FridgeModel[];
}

// ============================================
// 전역 윈도우 확장
// ============================================

declare global {
  interface Window {
    // Supabase
    supabase: {
      createClient: (url: string, key: string) => SupabaseClient;
    };
    SUPABASE_ANON_KEY?: string;

    // Dadam 모듈
    Dadam: {
      eventBus: EventBus;
      Events: typeof Events;
      stateManager: StateManager;
      supabaseService: SupabaseService;
    };

    // 레거시 호환
    DadamSupabase: DadamSupabaseUtils;
    DadamEventBus: EventBus;
    DadamEvents: typeof Events;
    DadamStateManager: StateManager;
    DadamUtils: DadamUtilsInterface;
    DadamConstants: DadamConstantsInterface;
    DadamImages: DadamImagesInterface;
  }
}

// ============================================
// 유틸리티 인터페이스
// ============================================

export interface EventBus {
  on(event: EventType, handler: EventHandler): () => void;
  once(event: EventType, handler: EventHandler): void;
  off(event: EventType, handler: EventHandler): void;
  emit(event: EventType, data?: unknown): void;
  clear(event?: EventType): void;
}

export interface StateManager {
  items: DesignItem[];
  currentDesignId: string | null;
  hasUnsavedChanges: boolean;

  reset(): void;
  addItem(item: Partial<DesignItem>): DesignItem;
  removeItem(uniqueId: number): boolean;
  getItem(uniqueId: number): DesignItem | undefined;
  updateItem(
    uniqueId: number,
    updates: Partial<DesignItem>,
    options?: { skipRender?: boolean }
  ): DesignItem | null;
  updateItemSpec(
    uniqueId: number,
    key: string,
    value: unknown,
    options?: { skipRender?: boolean }
  ): DesignItem | null;
  getModule(itemId: number, modId: number): Module | undefined;
  addModule(itemId: number, module: Partial<Module>): Module | null;
  removeModule(itemId: number, modId: number): boolean;
  updateModule(
    itemId: number,
    modId: number,
    updates: Partial<Module>,
    options?: { skipRender?: boolean }
  ): Module | null;
  moveModule(itemId: number, modId: number, direction: number): boolean;
  getAllItems(): DesignItem[];
  getItemsByCategory(category: CategoryId): DesignItem[];
  exportState(): { designId: string | null; items: DesignItem[]; exportedAt: string };
  importState(state: { items?: DesignItem[]; designId?: string }): void;
  markChanged(): void;
  markSaved(): void;
}

export interface SupabaseService {
  init(url?: string, anonKey?: string): Promise<void>;
  getSession(): Promise<AuthSession | null>;
  getCurrentUser(): Promise<{ id: string; email: string } | null>;
  loadUserProfile(): Promise<UserProfile | null>;
  signInWithEmail(email: string, password: string): Promise<ApiResponse<AuthSession>>;
  signInWithOAuth(provider: 'google' | 'kakao', redirectTo?: string): Promise<void>;
  signOut(redirectUrl?: string): Promise<void>;
  saveDesign(
    designId: string,
    name: string,
    items: DesignItem[],
    appVersion?: string
  ): Promise<ApiResponse<Design>>;
  loadDesign(designId: string): Promise<ApiResponse<{ design: Design; items: DesignItem[] }>>;
  getMyDesigns(options?: {
    limit?: number;
    offset?: number;
    status?: DesignStatus;
  }): Promise<ApiResponse<Design[]>>;
  deleteDesign(designId: string): Promise<ApiResponse<void>>;
  uploadImage(file: File, userId?: string): Promise<ApiResponse<{ path: string; url: string }>>;
}

export interface DadamSupabaseUtils {
  init(): void;
  signOut(redirectUrl?: string): Promise<void>;
  loadProfile(): Promise<UserProfile | null>;
  uploadImage(file: File, userId: string): Promise<string | null>;
  saveDesign(
    designId: string,
    name: string,
    items: DesignItem[],
    appVersion: string
  ): Promise<boolean>;
  loadDesign(designId: string): Promise<{ design: Design; items: DesignItem[] } | null>;
  getMyDesigns(options?: { limit?: number; offset?: number }): Promise<Design[]>;
  deleteDesign(designId: string): Promise<boolean>;
  submitDesign(designId: string): Promise<boolean>;
}

export interface DadamUtilsInterface {
  debounce<T extends (...args: unknown[]) => unknown>(
    func: T,
    wait?: number,
    immediate?: boolean
  ): T;
  throttle<T extends (...args: unknown[]) => unknown>(func: T, limit?: number): T;
  saveFocusState(): { element: Element; name: string; id: string } | null;
  restoreFocusState(state: { name?: string; id?: string } | null): void;
  svgRect(
    x: number,
    y: number,
    w: number,
    h: number,
    fill?: string,
    stroke?: string,
    strokeWidth?: number
  ): string;
  svgText(
    x: number,
    y: number,
    content: string,
    options?: { fontSize?: number; fill?: string; anchor?: string }
  ): string;
  svgLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    stroke?: string,
    strokeWidth?: number
  ): string;
  createButton(
    label: string,
    action: string,
    dataAttrs?: Record<string, string>,
    className?: string
  ): string;
  createNumberInput(
    name: string,
    value: number,
    options?: { min?: number; max?: number; step?: number }
  ): string;
  formatNumber(num: number): string;
  safeParseInt(value: unknown, defaultValue?: number): number;
  safeParseFloat(value: unknown, defaultValue?: number): number;
  generateUUID(): string;
  deepClone<T>(obj: T): T;
  showToast(
    message: string,
    type?: 'info' | 'success' | 'error' | 'warning',
    duration?: number
  ): void;
}

export interface DadamConstantsInterface {
  APP_CONFIG: { version: string; name: string; autoSaveInterval: number };
  CATEGORIES: CategoryInfo[];
  DOOR_RULES: { TARGET_WIDTH: number; MAX_WIDTH: number; MIN_WIDTH: number };
  DEFAULT_SPECS: Record<CategoryId, ItemSpecs>;
  DOOR_COLOR_MAP: Record<DoorColor, DoorColorInfo>;
  FRIDGE_DATA: Record<string, FridgeBrand>;
  API_ENDPOINTS: { N8N_CHAT: string; N8N_AI_DESIGN: string; SUPABASE_URL: string };
}

export interface DadamImagesInterface {
  webPSupported: boolean;
  lazyLoader: {
    refresh(): void;
    destroy(): void;
  };
  supportsWebP(): Promise<boolean>;
  getOptimalSource(src: string, webPSupported: boolean): string;
  preloadImage(src: string): Promise<HTMLImageElement>;
  preloadCriticalImages(sources: string[]): void;
  refresh(): void;
}

// ============================================
// 외부 라이브러리 타입
// ============================================

export interface SupabaseClient {
  auth: {
    getSession(): Promise<{ data: { session: AuthSession | null } }>;
    getUser(): Promise<{ data: { user: { id: string; email: string } | null } }>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ data: { session: AuthSession } | null; error: ApiError | null }>;
    signInWithOAuth(options: {
      provider: string;
      options?: { redirectTo?: string };
    }): Promise<void>;
    signOut(): Promise<void>;
    onAuthStateChange(callback: (event: string, session: AuthSession | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
  };
  from(table: string): SupabaseQueryBuilder;
  storage: {
    from(bucket: string): SupabaseStorageBuilder;
  };
}

export interface SupabaseQueryBuilder {
  select(columns?: string): SupabaseQueryBuilder;
  insert(data: unknown): SupabaseQueryBuilder;
  update(data: unknown): SupabaseQueryBuilder;
  upsert(data: unknown): SupabaseQueryBuilder;
  delete(): SupabaseQueryBuilder;
  eq(column: string, value: unknown): SupabaseQueryBuilder;
  order(column: string, options?: { ascending?: boolean }): SupabaseQueryBuilder;
  range(from: number, to: number): SupabaseQueryBuilder;
  single(): Promise<{ data: unknown; error: ApiError | null }>;
  then(resolve: (result: { data: unknown; error: ApiError | null }) => void): void;
}

export interface SupabaseStorageBuilder {
  upload(
    path: string,
    file: File,
    options?: { cacheControl?: string; upsert?: boolean }
  ): Promise<{ data: { path: string } | null; error: ApiError | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

export {};
