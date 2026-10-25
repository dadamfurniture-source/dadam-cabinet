# 다담AI 에이전트 프로젝트

> AI 기반 맞춤형 가구 설계 자동화 시스템

## 프로젝트 개요

다담AI는 고객의 방 사진을 분석하여 맞춤형 AI 가구 디자인 이미지를 생성하는 서비스입니다.

### 사업 파이프라인 (최종 목표)

```
고객 방 사진 → AI 디자인 이미지 → 설계 데이터 → BOM 추출 → 재단 도면 → 조립 도면 → 설치 도면 → 일정관리
```

---

## 아키텍처

### 확정 아키텍처 (v2)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  [고객용 프론트엔드]                                               │
│  HTML Pages (ai-design, detaildesign, etc.)                      │
│         │                                                        │
│         ▼                                                        │
│  [Cloudflare Workers Proxy]                                      │
│         │                                                        │
│         ▼                                                        │
│  [n8n Cloud] ─── 고객 대면 워크플로우 (운영)                        │
│         │                                                        │
│         ├─→ Claude API ─→ 벽면/배관 분석                           │
│         ├─→ Supabase RAG ─→ 설계 규칙 검색                        │
│         ├─→ Gemini API ─→ 이미지 생성                              │
│         └─→ Supabase ─→ 데이터 저장                               │
│                                                                  │
│  ─────────────────── 분리선 ───────────────────                   │
│                                                                  │
│  [내부 AI 에이전트] (Claude Code + MCP 서버)                       │
│         │                                                        │
│         ├─→ MCP 도구: RAG 검색, 벽면 분석, 이미지 생성              │
│         ├─→ [신규] BOM 추출 도구                                   │
│         ├─→ [신규] 재단 계산 도구                                   │
│         └─→ [신규] 도면 생성 도구                                   │
│                                                                  │
│  [Supabase] ── DB, Auth, Storage, Vector Search (공용)            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 역할 분담

| 역할 | 시스템 | 설명 |
|------|--------|------|
| **고객 대면** | n8n Cloud | 안정적인 운영 워크플로우 (v8) |
| **내부/신규 기능** | MCP 서버 | 개발/테스트, BOM/도면 등 신규 기능 |
| **AI 분석** | Claude API | 벽면/배관 분석 (n8n + MCP 공통) |
| **이미지 생성** | Gemini API | 가구 디자인 이미지 생성 |
| **데이터** | Supabase | DB, Auth, Storage, Vector Search |

---

## 프로젝트 구조

```
dadamagent/
├── .claude/skills/dadam-design/   # Claude Code 스킬
├── .github/workflows/             # CI/CD
├── mcp-server/                    # MCP 서버 (내부 AI 에이전트)
│   ├── src/
│   │   ├── index.ts               # MCP 서버 진입점
│   │   ├── http-server.ts         # HTTP API 서버
│   │   ├── clients/               # API 클라이언트 (Claude, Gemini, Supabase)
│   │   ├── services/              # 비즈니스 로직
│   │   ├── tools/                 # MCP 도구 정의
│   │   ├── prompts/               # 프롬프트 템플릿
│   │   ├── routes/                # HTTP 라우트
│   │   └── utils/                 # 유틸리티
│   └── .env                       # 환경 변수 (API 키)
├── admin/                         # 관리자 HTML 페이지
├── css/                           # 스타일시트
├── database/                      # Supabase 스키마
├── docs/                          # 문서
├── js/                            # 프론트엔드 JS 모듈
├── lib/                           # 공유 라이브러리
├── sql/                           # SQL 스크립트
├── types/                         # 공유 타입
├── __tests__/                     # 테스트
├── [HTML 페이지들]                 # 프론트엔드 (index, ai-design, detaildesign 등)
└── [설정 파일들]                    # package.json, tsconfig 등
```

---

## MCP 도구

### 1. supabase_rag_search

설계 규칙 RAG 검색

```json
{
  "triggers": ["상부장", "하부장", "도어규격"],
  "category": "sink",
  "limit": 25
}
```

### 2. gemini_wall_analysis

벽 구조 및 유틸리티 위치 분석 (Claude 또는 Gemini 선택 가능)

```json
{
  "image": "<base64 이미지>",
  "image_type": "image/jpeg",
  "provider": "claude"
}
```

- `provider`: `"claude"` (기본, ANTHROPIC_API_KEY 있을 때) 또는 `"gemini"`

### 3. gemini_generate_image

AI 가구 이미지 생성

```json
{
  "prompt": "<생성 프롬프트>",
  "reference_image": "<base64 참조 이미지>",
  "image_type": "image/jpeg"
}
```

---

## 설치 및 실행

### 1. MCP 서버 설치

```bash
cd mcp-server
npm install
```

### 2. 환경 변수 설정

`mcp-server/.env` 파일에 API 키 설정:

```bash
cp .env.example .env
# .env 파일 편집하여 API 키 입력
```

필수 환경 변수:
- `SUPABASE_URL` - Supabase 프로젝트 URL
- `SUPABASE_ANON_KEY` - Supabase anon key
- `GEMINI_API_KEY` - Google Gemini API key
- `ANTHROPIC_API_KEY` - Anthropic Claude API key (벽면 분석용)

### 3. 빌드

```bash
npm run build
```

### 4. 실행

```bash
# MCP 서버 (Claude Code 연동용)
npm start

# HTTP API 서버 (프론트엔드 연동용)
npm run start:http
```

### 5. 헬스 체크

```bash
curl http://localhost:3200/health
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

## 개발 로드맵

| Phase | 상태 | 설명 |
|-------|------|------|
| Phase 1 | 🔄 진행 중 | 아키텍처 정리, 코드베이스 클린업 |
| Phase 2 | ⏳ 대기 | 설계 데이터 구조화 (JSON) |
| Phase 3 | ⏳ 대기 | BOM (자재 목록) 추출 |
| Phase 4 | ⏳ 대기 | 재단 도면 생성 |
| Phase 5 | ⏳ 대기 | 조립/설치 도면 및 일정관리 |

---

## 참고 문서

- [아키텍처 계획서](./docs/renovation-plan.md)
- [MCP 공식 문서](https://modelcontextprotocol.io/)

---

## 라이선스

다담가구 내부 프로젝트
