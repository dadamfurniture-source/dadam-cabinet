# 다담AI 에이전트 프로젝트

> n8n 워크플로우 → Claude Code 스킬 + MCP 기반 에이전트 전환 프로젝트

## 프로젝트 개요

다담AI는 방 사진을 분석하여 맞춤형 AI 가구 이미지를 생성하는 서비스입니다.
기존 n8n 워크플로우 기반 시스템을 Claude Code 스킬 + MCP 서버 기반으로 전환합니다.

### 전환 목표

| 항목 | 기존 (AS-IS) | 신규 (TO-BE) |
|------|-------------|-------------|
| 워크플로우 엔진 | n8n Cloud | Claude Code + MCP |
| 비즈니스 로직 | JavaScript (n8n 노드) | TypeScript |
| 프롬프트 관리 | JSON 하드코딩 | 모듈화된 템플릿 |
| 테스트 | 불가 | 단위/통합 테스트 |
| 버전 관리 | 어려움 | Git 완전 추적 |

---

## 프로젝트 구조

```
dadamagent/
├── .claude/
│   ├── settings.json               # Claude Code 설정
│   └── skills/dadam-design/        # 다담AI 스킬
│       ├── skill.json              # 스킬 메타데이터
│       ├── index.md                # 스킬 사용 가이드
│       ├── prompts/
│       │   └── prompt-builder.ts   # 프롬프트 빌더
│       └── utils/
│           ├── parse-input.ts      # 입력 파싱
│           └── color-map.ts        # 색상/자재 매핑
│
├── .mcp.json                       # MCP 서버 설정
│
├── mcp-server/                     # MCP 서버
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env                        # 환경 변수 (API 키)
│   ├── .env.example
│   ├── dist/                       # 빌드 결과물
│   ├── src/
│   │   ├── index.ts                # MCP 서버 진입점
│   │   ├── types/index.ts          # 타입 정의
│   │   ├── tools/
│   │   │   ├── supabase-rag.ts     # RAG 검색 도구
│   │   │   ├── gemini-vision.ts    # 벽 분석 도구
│   │   │   └── gemini-image.ts     # 이미지 생성 도구
│   │   └── utils/
│   │       ├── config.ts           # 설정 로드
│   │       └── api-client.ts       # API 클라이언트
│   └── tests/
│       └── test-tools.ts           # 통합 테스트
│
├── docs/
│   ├── n8n-workflow-analysis.md    # n8n 워크플로우 분석
│   └── renovation-plan.md          # 개편 계획서
│
├── dadam-cabinet/                  # 기존 프로젝트 (참조용)
│
└── README.md                       # 이 문서
```

---

## MCP 도구

### 1. supabase_rag_search

설계 규칙 RAG 검색

**입력:**
```json
{
  "triggers": ["상부장", "하부장", "도어규격"],
  "category": "sink",
  "limit": 25
}
```

**출력:**
- 배경 처리 규칙
- 모듈 구성 규칙
- 도어 사양
- 자재 정보

### 2. gemini_wall_analysis

벽 구조 및 유틸리티 위치 분석

**입력:**
```json
{
  "image": "<base64 이미지>",
  "image_type": "image/jpeg"
}
```

**출력:**
- 벽 치수 (타일 기반 계산)
- 급수 분배기 위치 → 싱크대 배치
- 배기 덕트 위치 → 가스대/후드 배치
- 가스 배관 위치

### 3. gemini_generate_image

AI 가구 이미지 생성

**입력:**
```json
{
  "prompt": "<생성 프롬프트>",
  "reference_image": "<base64 참조 이미지>",
  "image_type": "image/jpeg"
}
```

**출력:**
- 생성된 이미지 (Base64)
- 텍스트 응답

---

## 설치 및 실행

### 1. 의존성 설치

```bash
cd mcp-server
npm install
```

### 2. 환경 변수 설정

`.env` 파일에 API 키 설정:

```bash
SUPABASE_URL=https://vvqrvgcgnlfpiqqndsve.supabase.co
SUPABASE_ANON_KEY=<your_supabase_anon_key>
GEMINI_API_KEY=<your_gemini_api_key>
```

### 3. 빌드

```bash
npm run build
```

### 4. 테스트

```bash
npx tsx tests/test-tools.ts
```

예상 결과:
```
═══════════════════════════════════════════════════════════
Test Summary:
  Supabase RAG: ✅ PASS
  Gemini API:   ✅ PASS
═══════════════════════════════════════════════════════════
```

### 5. MCP 서버 실행

```bash
npm start
```

---

## Claude Code 연동

### MCP 서버 활성화

`.mcp.json` 파일이 프로젝트 루트에 설정되어 있습니다.
Claude Code 시작 시 `dadam` MCP 서버가 자동으로 사용 가능합니다.

### 스킬 사용

다담AI 스킬은 다음 트리거로 활성화됩니다:
- "다담", "dadam", "가구 설계", "AI 설계"
- "싱크대", "붙박이장", "냉장고장", "신발장", "화장대"
- "kitchen cabinet", "wardrobe", "furniture design"

---

## 워크플로우

### 방 사진 → AI 가구 설계

```
1. 입력 파싱
   └─ 카테고리, 스타일, 자재코드 추출

2. RAG 검색 (supabase_rag_search)
   └─ 설계 규칙 25개 조회

3. 벽 분석 (gemini_wall_analysis)
   └─ 타일 기반 치수 계산
   └─ 유틸리티 위치 감지

4. 프롬프트 조립
   └─ 벽 측정 섹션
   └─ 유틸리티 배치 섹션
   └─ 스타일/자재 섹션

5. 이미지 생성 (gemini_generate_image)
   └─ 닫힌 도어 이미지
   └─ 열린 도어 이미지

6. 응답 반환
   └─ closed: Base64 이미지
   └─ open: Base64 이미지
```

---

## 지원 카테고리

| 카테고리 | 설명 | RAG 트리거 |
|---------|------|-----------|
| sink | 싱크대/주방가구 | 상부장, 하부장, 도어규격 |
| wardrobe | 붙박이장 | 붙박이장, 좌대, 서랍 |
| fridge | 냉장고장 | 냉장고장, EL장, 홈카페 |
| vanity | 화장대 | 화장대, 거울, 조명 |
| shoe | 신발장 | 신발장, 환기구 |
| storage | 수납장 | 수납장, 선반 |

---

## 자재코드 지원

지원하는 자재코드 패턴:
- `YPG-xxx` - Prestige Glass
- `SM-xxx` - Supreme PET Matt
- `SG-xxx` - Supreme PET Glossy
- `PW-xxx` - Supreme PP Wood
- `CP-xxx` - Supreme PP Calacatta
- 등 19개 패턴

---

## 색상 지원

| 한글 | 영문 변환 |
|------|----------|
| 화이트 | pure white (#FFFFFF) |
| 그레이 | warm gray (#9E9E9E) |
| 블랙 | matte black (#2D2D2D) |
| 오크 | natural oak wood grain |
| 월넛 | dark walnut wood grain |

---

## 진행 상태

| Phase | 상태 | 설명 |
|-------|------|------|
| Phase 1 | ✅ 완료 | MCP 서버 기반 구축 |
| Phase 2 | ✅ 완료 | 프롬프트 모듈화, 스킬 개발 |
| Phase 3 | ✅ 완료 | 환경 설정, API 테스트 |
| Phase 4 | 🔄 진행 중 | MCP 서버 연동 |
| Phase 5 | ⏳ 대기 | 프론트엔드 연동 |
| Phase 6 | ⏳ 대기 | 배포 및 n8n 전환 |

---

## 다음 단계

1. **HTTP 엔드포인트 추가** - 프론트엔드에서 직접 호출 가능한 REST API
2. **프론트엔드 연동** - ai-design.html, detaildesign.html의 API 호출 수정
3. **배포** - 프로덕션 환경 구성
4. **n8n 비활성화** - 기존 워크플로우 종료

---

## 참고 문서

- [n8n 워크플로우 분석](./docs/n8n-workflow-analysis.md)
- [개편 계획서](./docs/renovation-plan.md)
- [MCP 공식 문서](https://modelcontextprotocol.io/)
- [Claude Code 문서](https://docs.anthropic.com/claude-code)

---

## 라이선스

다담가구 내부 프로젝트
