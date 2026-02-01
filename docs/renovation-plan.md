# 다담AI 구조 개편 계획서

> 버전: 1.0
> 작성일: 2026-02-01
> 목표: n8n 워크플로우 → Claude Code 스킬 + MCP 기반 에이전트 워크플로우 전환

---

## 1. 프로젝트 개요

### 1.1 배경

현재 다담AI는 n8n 워크플로우 엔진을 통해 AI 가구 설계 자동화를 구현하고 있습니다.
그러나 다음과 같은 한계가 있습니다:

- n8n 클라우드 의존성 (외부 서비스)
- 워크플로우 수정 시 n8n 에디터 필요
- 로직과 프롬프트가 JSON에 하드코딩
- 확장성 및 유지보수성 제한

### 1.2 개편 목표

| 목표 | 설명 |
|------|------|
| **탈중앙화** | n8n 클라우드 의존성 제거 |
| **에이전트화** | Claude Code 스킬 기반 자율 에이전트 |
| **모듈화** | MCP 도구로 기능 분리 |
| **확장성** | 새로운 AI 모델/기능 추가 용이 |
| **개발 경험** | TypeScript 기반 코드로 관리 |

### 1.3 범위

**포함:**
- n8n 워크플로우 2개 전환 (dadam-interior-v4, design-to-image)
- MCP 서버 구축
- Claude Code 스킬 개발
- 프론트엔드 API 호출 수정

**제외:**
- Supabase 백엔드 변경 (유지)
- 기존 HTML 페이지 UI 변경 (유지)
- 데이터베이스 스키마 변경 (유지)

---

## 2. 현재 상태 분석 (AS-IS)

### 2.1 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    현재 아키텍처 (AS-IS)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   [프론트엔드 HTML]                                          │
│         │                                                    │
│         ▼                                                    │
│   [n8n Cloud Webhook]  ←── 외부 의존성                       │
│         │                                                    │
│         ├─→ [Supabase RAG] ─→ 설계 규칙 검색                 │
│         │                                                    │
│         ├─→ [Gemini Vision] ─→ 벽 분석                      │
│         │                                                    │
│         └─→ [Gemini Image] ─→ 가구 이미지 생성              │
│                  │                                           │
│                  ▼                                           │
│         [JSON Response]                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 기술 스택

| 구성 요소 | 현재 기술 |
|----------|----------|
| 워크플로우 엔진 | n8n Cloud |
| 비즈니스 로직 | JavaScript (n8n Code 노드) |
| API 호출 | n8n HTTP Request 노드 |
| 프롬프트 관리 | 하드코딩 (n8n JSON) |
| 에러 처리 | n8n 기본 에러 핸들링 |

### 2.3 워크플로우 분석 요약

**워크플로우 1: dadam-interior-v4**
- 노드 수: 14개
- 주요 기능: 방 사진 → AI 가구 렌더링
- AI 호출: Gemini 3회 (분석 1, 이미지 2)

**워크플로우 2: design-to-image**
- 노드 수: 6개
- 주요 기능: 설계 데이터 → AI 이미지
- AI 호출: Gemini 1회

### 2.4 현재 문제점

| 문제 | 영향 |
|------|------|
| n8n 클라우드 비용 | 월 사용량 제한, 추가 비용 |
| 버전 관리 어려움 | JSON 파일 변경 추적 복잡 |
| 테스트 어려움 | 단위 테스트 불가 |
| 프롬프트 산재 | 각 노드에 분산되어 관리 어려움 |
| 디버깅 제한 | n8n 실행 로그에 의존 |

---

## 3. 목표 상태 (TO-BE)

### 3.1 새 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    목표 아키텍처 (TO-BE)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   [프론트엔드 HTML]                                          │
│         │                                                    │
│         ▼                                                    │
│   [MCP Server] ←── 자체 호스팅                               │
│         │                                                    │
│         ▼                                                    │
│   [Claude Code Agent]                                        │
│         │                                                    │
│         ├─→ [Tool: supabase-rag] ─→ 설계 규칙 검색          │
│         │                                                    │
│         ├─→ [Tool: gemini-vision] ─→ 벽 분석                │
│         │                                                    │
│         ├─→ [Tool: gemini-image] ─→ 이미지 생성             │
│         │                                                    │
│         └─→ [Skill: dadam-design] ─→ 오케스트레이션         │
│                  │                                           │
│                  ▼                                           │
│         [JSON Response]                                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 새 기술 스택

| 구성 요소 | 새 기술 |
|----------|---------|
| 에이전트 엔진 | Claude Code + MCP |
| 비즈니스 로직 | TypeScript |
| API 호출 | MCP Tools |
| 프롬프트 관리 | 모듈화된 템플릿 파일 |
| 에러 처리 | 구조화된 예외 처리 |

### 3.3 기대 효과

| 효과 | 설명 |
|------|------|
| 비용 절감 | n8n 클라우드 비용 제거 |
| 개발 생산성 | TypeScript + IDE 지원 |
| 테스트 용이 | 단위/통합 테스트 가능 |
| 버전 관리 | Git으로 완전한 추적 |
| 확장성 | 새 도구/스킬 쉽게 추가 |
| 디버깅 | 로컬 디버깅 가능 |

---

## 4. 시스템 설계

### 4.1 디렉토리 구조

```
dadamagent/
├── .claude/
│   ├── settings.json
│   └── skills/
│       └── dadam-design/
│           ├── skill.json           # 스킬 메타데이터
│           ├── index.ts             # 메인 진입점
│           ├── handlers/
│           │   ├── room-to-design.ts    # 방 사진 → 설계
│           │   └── design-to-image.ts   # 설계 → 이미지
│           ├── services/
│           │   ├── supabase-rag.ts      # RAG 검색
│           │   ├── gemini-vision.ts     # 벽 분석
│           │   └── gemini-image.ts      # 이미지 생성
│           ├── prompts/
│           │   ├── wall-analysis.ts     # 벽 분석 프롬프트
│           │   ├── closed-door.ts       # 닫힌 도어 프롬프트
│           │   └── open-door.ts         # 열린 도어 프롬프트
│           ├── utils/
│           │   ├── parse-input.ts       # 입력 파싱
│           │   ├── material-codes.ts    # 자재코드 감지
│           │   └── color-map.ts         # 색상 매핑
│           └── types/
│               └── index.ts             # 타입 정의
│
├── mcp-server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # MCP 서버 진입점
│   │   ├── tools/
│   │   │   ├── supabase-rag.ts      # RAG 검색 도구
│   │   │   ├── gemini-vision.ts     # Vision 분석 도구
│   │   │   └── gemini-image.ts      # 이미지 생성 도구
│   │   └── utils/
│   │       └── api-client.ts        # HTTP 클라이언트
│   └── tests/
│       └── tools.test.ts
│
├── docs/
│   ├── n8n-workflow-analysis.md     # 기존 분석
│   ├── renovation-plan.md           # 이 문서
│   └── api-reference.md             # API 문서
│
├── dadam-cabinet/                   # 기존 프로젝트
│   └── ...
│
└── .env                             # 환경 변수
```

### 4.2 MCP 도구 설계

#### Tool 1: supabase-rag

```typescript
interface SupabaseRagTool {
  name: "supabase_rag_search";
  description: "Supabase에서 설계 규칙을 RAG 검색합니다";
  inputSchema: {
    triggers: string[];      // 검색 트리거 키워드
    category: string;        // sink | wardrobe | fridge
    limit: number;           // 결과 개수 (기본 25)
  };
  output: {
    rules: DesignRule[];     // 설계 규칙 배열
  };
}
```

#### Tool 2: gemini-vision

```typescript
interface GeminiVisionTool {
  name: "gemini_wall_analysis";
  description: "Gemini Vision으로 벽 구조를 분석합니다";
  inputSchema: {
    image: string;           // Base64 이미지
    imageType: string;       // MIME 타입
  };
  output: {
    wallData: WallAnalysis;  // 벽 분석 결과
  };
}
```

#### Tool 3: gemini-image

```typescript
interface GeminiImageTool {
  name: "gemini_generate_image";
  description: "Gemini로 가구 이미지를 생성합니다";
  inputSchema: {
    prompt: string;          // 생성 프롬프트
    referenceImage?: string; // 참조 이미지 (선택)
    imageType?: string;      // MIME 타입
  };
  output: {
    image: string;           // Base64 생성 이미지
    mimeType: string;
  };
}
```

### 4.3 스킬 설계

#### skill.json

```json
{
  "name": "dadam-design",
  "version": "1.0.0",
  "description": "다담AI 가구 설계 에이전트 스킬",
  "triggers": [
    "가구 설계", "AI 설계", "싱크대", "붙박이장", "냉장고장",
    "room design", "furniture", "kitchen cabinet"
  ],
  "tools": [
    "supabase_rag_search",
    "gemini_wall_analysis",
    "gemini_generate_image"
  ],
  "entrypoint": "index.ts"
}
```

#### 핵심 핸들러

```typescript
// handlers/room-to-design.ts
export async function handleRoomToDesign(input: RoomDesignInput) {
  // 1. 입력 파싱
  const parsed = parseInput(input);

  // 2. RAG 검색
  const rules = await supabaseRag.search(parsed.triggers, parsed.category);

  // 3. 벽 분석
  const wallData = await geminiVision.analyzeWall(parsed.roomImage);

  // 4. 프롬프트 조립
  const prompts = buildPrompts(parsed, rules, wallData);

  // 5. 닫힌 도어 이미지 생성
  const closedImage = await geminiImage.generate(prompts.closed, parsed.roomImage);

  // 6. 열린 도어 이미지 생성
  const openImage = await geminiImage.generate(prompts.open, closedImage);

  // 7. 응답 반환
  return {
    success: true,
    category: parsed.category,
    generated_image: {
      closed: { base64: closedImage, mime_type: "image/png" },
      open: { base64: openImage, mime_type: "image/png" }
    }
  };
}
```

### 4.4 프롬프트 관리

```typescript
// prompts/wall-analysis.ts
export const wallAnalysisPrompt = `
[TASK: WALL STRUCTURE & UTILITY POSITION ANALYSIS]

${TILE_REFERENCE_SECTION}

${UTILITY_DETECTION_SECTION}

${OUTPUT_FORMAT_SECTION}
`;

// prompts/closed-door.ts
export function buildClosedDoorPrompt(params: PromptParams): string {
  return `
[TASK: KOREAN BUILT-IN KITCHEN RENDERING - PHOTOREALISTIC]

${buildWallMeasurementSection(params.wallData)}

${buildUtilityPlacementSection(params.wallData)}

${buildStyleSection(params.style)}

${buildMaterialSection(params.materials)}

${buildBackgroundRulesSection(params.ragRules.background)}

${buildModuleRulesSection(params.ragRules.modules)}

${buildDoorSpecsSection(params.ragRules.doors)}

${CRITICAL_REQUIREMENTS_SECTION}
`;
}
```

---

## 5. 단계별 실행 계획

### Phase 1: 기반 구축

**목표:** MCP 서버 기본 구조 및 개발 환경 설정

| 태스크 | 설명 | 산출물 |
|--------|------|--------|
| 1.1 | 프로젝트 초기화 | package.json, tsconfig.json |
| 1.2 | MCP SDK 설치 | 의존성 설치 |
| 1.3 | 기본 서버 구조 | src/index.ts |
| 1.4 | 환경 변수 설정 | .env, .env.example |
| 1.5 | 타입 정의 | types/index.ts |

**검증:**
- MCP 서버 로컬 실행 확인
- Claude Code에서 연결 테스트

### Phase 2: MCP 도구 구현

**목표:** 3개 핵심 도구 구현

| 태스크 | 설명 | 산출물 |
|--------|------|--------|
| 2.1 | Supabase RAG 도구 | tools/supabase-rag.ts |
| 2.2 | Gemini Vision 도구 | tools/gemini-vision.ts |
| 2.3 | Gemini Image 도구 | tools/gemini-image.ts |
| 2.4 | 단위 테스트 | tests/tools.test.ts |

**검증:**
- 각 도구 개별 테스트
- Claude Code에서 도구 호출 테스트

### Phase 3: 프롬프트 모듈화

**목표:** n8n에서 프롬프트 추출 및 모듈화

| 태스크 | 설명 | 산출물 |
|--------|------|--------|
| 3.1 | 벽 분석 프롬프트 | prompts/wall-analysis.ts |
| 3.2 | 닫힌 도어 프롬프트 | prompts/closed-door.ts |
| 3.3 | 열린 도어 프롬프트 | prompts/open-door.ts |
| 3.4 | 설계→이미지 프롬프트 | prompts/design-to-image.ts |
| 3.5 | 프롬프트 빌더 | utils/prompt-builder.ts |

**검증:**
- 프롬프트 생성 결과 비교 (n8n vs 새 모듈)

### Phase 4: 스킬 개발

**목표:** Claude Code 스킬 구현

| 태스크 | 설명 | 산출물 |
|--------|------|--------|
| 4.1 | 스킬 메타데이터 | skill.json |
| 4.2 | 입력 파싱 유틸 | utils/parse-input.ts |
| 4.3 | 자재코드 감지 | utils/material-codes.ts |
| 4.4 | 색상 매핑 | utils/color-map.ts |
| 4.5 | 방→설계 핸들러 | handlers/room-to-design.ts |
| 4.6 | 설계→이미지 핸들러 | handlers/design-to-image.ts |
| 4.7 | 메인 진입점 | index.ts |

**검증:**
- 전체 플로우 E2E 테스트
- n8n 결과와 품질 비교

### Phase 5: 통합 및 테스트

**목표:** 프론트엔드 연동 및 통합 테스트

| 태스크 | 설명 | 산출물 |
|--------|------|--------|
| 5.1 | API 엔드포인트 설정 | HTTP 라우팅 |
| 5.2 | 프론트엔드 수정 | fetch URL 변경 |
| 5.3 | 통합 테스트 | 테스트 케이스 |
| 5.4 | 성능 테스트 | 벤치마크 결과 |
| 5.5 | 에러 핸들링 보완 | 에러 처리 로직 |

**검증:**
- ai-design.html 정상 동작
- detaildesign.html 정상 동작

### Phase 6: 배포 및 전환

**목표:** 프로덕션 배포 및 n8n 종료

| 태스크 | 설명 | 산출물 |
|--------|------|--------|
| 6.1 | 배포 환경 구성 | 서버 설정 |
| 6.2 | 스테이징 테스트 | QA 결과 |
| 6.3 | 프로덕션 배포 | 배포 완료 |
| 6.4 | 모니터링 설정 | 로그/알림 |
| 6.5 | n8n 워크플로우 비활성화 | 전환 완료 |
| 6.6 | 문서화 | 운영 가이드 |

**검증:**
- 프로덕션 정상 동작 확인
- 모니터링 대시보드 확인

---

## 6. 기술 상세

### 6.1 n8n 노드 → TypeScript 변환

| n8n 노드 | TypeScript 함수 |
|----------|-----------------|
| Parse Input | `parseInput(body)` |
| Supabase RAG Search | `supabaseRag.search(triggers, category)` |
| Wall Analysis | `buildWallAnalysisPrompt()` |
| Gemini Wall Vision | `geminiVision.analyze(image, prompt)` |
| Parse Wall Data | `parseWallData(response)` |
| Build Prompts | `buildPrompts(params)` |
| Gemini Closed Door | `geminiImage.generate(prompt, image)` |
| Parse Closed + Prep Open | `parseClosedImage(response)` |
| Has Closed Image? | `if (closedImage) { ... }` |
| Gemini Open Door | `geminiImage.generate(openPrompt, closedImage)` |
| Format Response | `formatResponse(data)` |
| Respond | `return response` |

### 6.2 API 클라이언트

```typescript
// utils/api-client.ts
export class ApiClient {
  private supabaseUrl: string;
  private supabaseKey: string;
  private geminiKey: string;

  async supabaseRpc(functionName: string, params: object) {
    return fetch(`${this.supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        'apikey': this.supabaseKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(params)
    });
  }

  async geminiGenerate(model: string, body: object) {
    return fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
  }
}
```

### 6.3 타입 정의

```typescript
// types/index.ts
export interface RoomDesignInput {
  category: 'sink' | 'wardrobe' | 'fridge';
  style: string;
  room_image: string;  // Base64
  image_type: string;  // MIME type
}

export interface WallAnalysis {
  tile_detected: boolean;
  tile_type: string;
  tile_size_mm: { width: number; height: number };
  wall_dimensions_mm: { width: number; height: number };
  utility_positions: {
    water_supply?: UtilityPosition;
    exhaust_duct?: UtilityPosition;
    gas_line?: UtilityPosition;
  };
  confidence: 'high' | 'medium' | 'low';
}

export interface UtilityPosition {
  detected: boolean;
  from_left_mm: number;
  from_left_percent: number;
  height_mm?: number;
  description: string;
}

export interface DesignRule {
  id: string;
  rule_type: 'background' | 'module' | 'door' | 'material';
  content: string;
  triggers: string[];
  metadata?: Record<string, any>;
}

export interface GeneratedImage {
  closed: { base64: string; mime_type: string };
  open: { base64: string; mime_type: string } | null;
}

export interface DesignResponse {
  success: boolean;
  message: string;
  category: string;
  style: string;
  rag_rules_count: number;
  generated_image: GeneratedImage;
}
```

---

## 7. 리스크 및 대응

| 리스크 | 영향 | 확률 | 대응 방안 |
|--------|------|------|----------|
| Gemini API 변경 | 높음 | 중간 | 버전 고정, 모듈화로 빠른 대응 |
| 프롬프트 품질 차이 | 중간 | 높음 | A/B 테스트, 점진적 전환 |
| MCP 서버 안정성 | 높음 | 낮음 | 헬스체크, 자동 재시작 |
| 전환 기간 서비스 중단 | 높음 | 낮음 | 병렬 운영, 롤백 계획 |
| API 키 노출 | 높음 | 낮음 | 환경 변수, 시크릿 관리 |

### 롤백 계획

1. n8n 워크플로우는 즉시 삭제하지 않고 비활성화만
2. 프론트엔드에서 엔드포인트 스위칭 가능하도록 설정
3. 문제 발생 시 DNS/라우팅으로 빠른 롤백

---

## 8. 환경 변수

```bash
# .env.example

# Supabase
SUPABASE_URL=https://vvqrvgcgnlfpiqqndsve.supabase.co
SUPABASE_ANON_KEY=your_anon_key

# Gemini
GEMINI_API_KEY=your_gemini_key

# MCP Server
MCP_SERVER_PORT=3100
MCP_SERVER_HOST=localhost

# Logging
LOG_LEVEL=info
```

---

## 9. 성공 지표

| 지표 | 현재 (n8n) | 목표 |
|------|-----------|------|
| 이미지 생성 성공률 | 95% | 98%+ |
| 평균 응답 시간 | ~45초 | ~40초 |
| 에러 추적 가능성 | 낮음 | 높음 |
| 코드 테스트 커버리지 | 0% | 80%+ |
| 배포 시간 | 수동 | 자동화 |

---

## 10. 체크리스트

### Phase 1 체크리스트
- [ ] 프로젝트 디렉토리 생성
- [ ] package.json 초기화
- [ ] TypeScript 설정
- [ ] MCP SDK 설치
- [ ] 환경 변수 파일 생성
- [ ] 기본 서버 구조 작성
- [ ] 로컬 실행 테스트

### Phase 2 체크리스트
- [ ] Supabase RAG 도구 구현
- [ ] Gemini Vision 도구 구현
- [ ] Gemini Image 도구 구현
- [ ] 도구별 단위 테스트
- [ ] Claude Code 연동 테스트

### Phase 3 체크리스트
- [ ] 벽 분석 프롬프트 추출
- [ ] 닫힌 도어 프롬프트 추출
- [ ] 열린 도어 프롬프트 추출
- [ ] 프롬프트 빌더 구현
- [ ] 프롬프트 품질 검증

### Phase 4 체크리스트
- [ ] skill.json 작성
- [ ] 유틸리티 함수 구현
- [ ] 핸들러 구현
- [ ] 메인 진입점 작성
- [ ] E2E 테스트

### Phase 5 체크리스트
- [ ] API 엔드포인트 설정
- [ ] 프론트엔드 수정
- [ ] 통합 테스트 실행
- [ ] 성능 벤치마크
- [ ] 에러 핸들링 검증

### Phase 6 체크리스트
- [ ] 배포 환경 구성
- [ ] 스테이징 테스트
- [ ] 프로덕션 배포
- [ ] 모니터링 설정
- [ ] n8n 비활성화
- [ ] 문서 완료

---

## 11. 참고 문서

- [n8n 워크플로우 분석](./n8n-workflow-analysis.md)
- [MCP 공식 문서](https://modelcontextprotocol.io/)
- [Claude Code 스킬 가이드](https://docs.anthropic.com/claude-code)
- [Gemini API 문서](https://ai.google.dev/docs)
- [Supabase 문서](https://supabase.com/docs)

---

*이 문서는 다담AI 프로젝트의 n8n → Claude Code/MCP 전환을 위한 계획서입니다.*
