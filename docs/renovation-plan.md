# 다담AI 아키텍처 계획서

> 버전: 2.0
> 작성일: 2026-02-08
> 상태: 확정

---

## 1. 아키텍처 결정 요약

### 확정 사항

| 항목 | 결정 |
|------|------|
| **n8n 워크플로우** | 운영 엔진으로 유지 (v8) |
| **벽면 분석** | Claude API 사용 (n8n v8과 동기화) |
| **프론트엔드** | HTML 페이지 유지 (Next.js 마이그레이션 안 함) |
| **MCP 서버 역할** | 내부 AI 에이전트 도구 플랫폼 |
| **개발 인력** | 1인 + AI (Claude Code) |

### 핵심 원칙

- **고객 대면 = n8n** (안정적, 검증됨, 현재 운영 중)
- **내부/신규 기능 = MCP 서버** (확장 가능, TypeScript, 테스트 가능)
- **점진적 전환**: 새 기능이 안정되면 n8n에서 MCP HTTP 엔드포인트 호출

---

## 2. 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    확정 아키텍처 (v2)                              │
├─────────────────────────────────────────────────────────────────┤
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
│         ├─→ Gemini API ─→ 이미지 생성 (배경정리 + 가구 + 열린문)     │
│         └─→ Supabase ─→ 데이터 저장                               │
│                                                                  │
│  ─────────────────── 분리선 ───────────────────                   │
│                                                                  │
│  [내부 AI 에이전트] (Claude Code + MCP 서버)                       │
│         │                                                        │
│         ├─→ MCP 도구: RAG 검색, 벽면 분석, 이미지 생성              │
│         ├─→ [Phase 2] 설계 데이터 구조화 도구                       │
│         ├─→ [Phase 3] BOM 추출 도구                                │
│         ├─→ [Phase 4] 재단 계산 도구                                │
│         └─→ [Phase 5] 도면 생성 / 일정 관리 도구                    │
│                                                                  │
│  [Supabase] ── DB, Auth, Storage, Vector Search (공용)            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### MCP 서버 역할 정의

| 역할 | 설명 |
|------|------|
| 개발/테스트 환경 | Claude Code로 프롬프트 개선, 기능 테스트 시 사용 |
| BOM/도면 도구 플랫폼 | 사업계획서의 후반부 기능(BOM, 재단, 도면)은 MCP 도구로 개발 |
| n8n 연동 가능 | n8n에서 HTTP로 MCP 서버의 새 기능 호출 가능 |
| 향후 확장 기반 | B2B SaaS 전환 시 API 서버로 전환 가능 |

---

## 3. 현재 기술 스택

| 구성 요소 | 기술 |
|----------|------|
| 프론트엔드 | HTML/CSS/JavaScript |
| 워크플로우 엔진 | n8n Cloud (v8) |
| MCP 서버 | TypeScript + Express |
| AI 벽면 분석 | Claude API (Sonnet) |
| AI 이미지 생성 | Gemini 3 Pro |
| 데이터베이스 | Supabase PostgreSQL |
| 벡터 검색 | Supabase Vector Search |
| CDN/Proxy | Cloudflare Workers |
| 인증 | Supabase Auth |

---

## 4. n8n 워크플로우 현황

### 운영 중

| 워크플로우 | 파일 | 설명 |
|-----------|------|------|
| v8 Claude Analysis | `workflows/v8-claude-analysis.json` | Claude 벽면 분석 + Gemini 이미지 생성 |
| v1 Fast Generation | `workflows/v1-fast-generation.json` | 설계 데이터 → 이미지 빠른 생성 |

### 아카이브

| 워크플로우 | 파일 | 비고 |
|-----------|------|------|
| v5 Wall Analysis | `workflows/archive/v5-wall-analysis.json` | Gemini 단일 분석 |
| v6 Few-Shot | `workflows/archive/v6-fewshot-wall-analysis.json` | 참조 이미지 도입 |
| v7 2-Stage | `workflows/archive/v7-2stage-generation.json` | 2단계 이미지 생성 |

---

## 5. 개발 로드맵

### Phase 1: 기반 안정화 (현재)

- [x] 디렉토리/코드 정리 (dadam-cabinet 삭제, 워크플로우 정리)
- [x] MCP 서버 벽면 분석 Claude 동기화
- [x] 보안 정리 (.mcp.json API 키 제거)
- [x] 문서 갱신 (README, 아키텍처 계획서)
- [ ] 기존 n8n v8 워크플로우 안정성 확인

### Phase 2: 설계 데이터 구조화

- [ ] `design_data_extractor` MCP 도구 개발
- [ ] 구조화된 설계 데이터 JSON 스키마 정의
- [ ] n8n 워크플로우에 설계 데이터 JSON 포함

### Phase 3: BOM (자재 목록) 추출

- [ ] `bom_extractor` MCP 도구 개발
- [ ] Supabase `materials_db`, `bom_results` 테이블 추가
- [ ] 자재 마스터 데이터 구축

### Phase 4: 재단 도면

- [ ] `cutting_plan_generator` MCP 도구 개발
- [ ] 네스팅 알고리즘 구현
- [ ] SVG/PDF 도면 출력

### Phase 5: 조립/설치 도면 및 일정관리

- [ ] 조립 순서도 생성
- [ ] 설치 도면 (현장 배치도)
- [ ] 프로젝트 일정 자동 생성

---

## 6. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|------|------|----------|
| 1.0 | 2026-02-01 | 초안 작성 (n8n 탈피 계획) |
| 2.0 | 2026-02-08 | n8n 유지 결정, MCP 역할 재정의, 아키텍처 확정 |

---

*이 문서는 다담AI 프로젝트의 확정 아키텍처 및 개발 로드맵입니다.*
