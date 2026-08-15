---
template: plan
version: 1.2
feature: mcp-sketchup-w3
date: 2026-05-15
author: hong
project: dadam-mcp-server
version_label: v1.5.0 (예정)
---

# mcp-sketchup-w3 Planning Document

> **Summary**: mhyrr/sketchup-mcp 실 연결 E2E 검증 + HTTP/SSE 외부 노출 + W2 gap-detector 잔여 항목(M3/M4) 정리
>
> **Project**: dadam-mcp-server
> **Version**: v1.5.0 (예정)
> **Author**: hong
> **Date**: 2026-05-15
> **Status**: Draft
> **Predecessors**: W1 (PR #248) → W1.1 (PR #249) → W2 (PR #250)

---

## 1. Overview

### 1.1 Purpose

W1–W2 에서 구축한 **CabinetPart → SketchUp 빌더 코어**를 디자이너 실사용 환경에 연결한다.
지금까지는 단위 테스트와 mock TCP 서버까지만 검증됐고 **실제 SketchUp 확장(mhyrr/sketchup-mcp)** 과의 종단 연결, 그리고 LLM agent 외 일반 백엔드(HTTP)에서의 호출 경로가 없다.

### 1.2 Background

- W2 완료 시점 gap-detector 96% — Critical/Major 0건, Minor 5건 잔존
- M3 (`nextRequestId` 전역 카운터), M4 (`dispatchLine` silent drop) 는 W3 정리 예정으로 deferral
- M5 (E2E with mhyrr) 는 디자이너 PC 환경 필요 — W3 의 핵심 항목
- 현재 `build_sketchup_scene` 은 MCP 도구로만 노출 → 다른 서비스(예: 디자인 UI에서 직접 빌드 트리거)에서 호출하려면 HTTP route 필요
- BOM/이미지 생성 도구들은 SSE 진행률 스트림을 제공 → SketchUp 빌더만 누락 (대량 빌드 시 UX 부재)

### 1.3 Related Documents

- W1/W2 보고서: `docs/04-report/features/mcp-server.report.md` (v4 SketchUp Builder 섹션)
- W2 gap-detector 결과: 같은 보고서 Section 4 + 본 세션 분석 결과
- mhyrr 프로토콜: `mcp-server/src/constants/sketchup.ts` 주석 + 참조 (mhyrr/sketchup-mcp src/sketchup_mcp/server.py)
- 코드 진입점: `mcp-server/src/services/sketchup-mcp-bridge.service.ts`, `mcp-server/src/tools/sketchup-build.tool.ts`

---

## 2. Scope

### 2.1 In Scope

- [ ] **FR-01 E2E 검증** — 디자이너 PC에서 mhyrr/sketchup-mcp 확장 띄우고 `build_sketchup_scene` 도구로 sink/wardrobe/fridge 3개 카테고리 실 빌드 검증 (수동 + 자동화 스크립트)
- [ ] **FR-02 HTTP route 노출** — `POST /api/sketchup/build` (`requireAuth` + 표준 input-validator), `GET /api/sketchup/ping` (헬스체크)
- [ ] **FR-03 SSE 빌드 진행률** — `POST /api/sketchup/build/stream` 으로 `command_sent`, `command_ack`, `aborted`, `complete` 이벤트 송신
- [ ] **FR-04 (M3) 연결별 request id 카운터** — 모듈 전역 `nextRequestId` 를 `PersistentConnection` 인스턴스 필드로 분리
- [ ] **FR-05 (M4) 미매칭 응답 debug 로그** — `dispatchLine` 큐 비었을 때 silent drop → pino debug 로그 + 카운터
- [ ] **FR-06 빌드 메트릭 수집** — 평균 명령 RTT, 빌드당 컴포넌트 수, 실패율을 pino 구조화 로그로 기록

### 2.2 Out of Scope

- Cloudflare Workers 빌드 실패 (`Workers Builds: dadamai`, `dadam-cabinet`) — main 사전 문제, 별건 이슈로 분리
- SketchUp 측 Ruby 확장 본체 수정 (mhyrr 업스트림) — 본 프로젝트 범위 외
- 빌드 결과의 SKP 파일 다운로드/저장 — 별도 피처(추후 W4 후보)
- SSE 클라이언트 (디자인 UI 측) 구현 — 백엔드 노출까지만, UI는 별도 사이클
- 동시 빌드 큐잉/동시성 제한 — 디자이너 1인 사용 가정 (W4 후보)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | 디자이너 PC에서 실 mhyrr 확장과 3개 카테고리 E2E 빌드 성공 | High | Pending |
| FR-02 | `POST /api/sketchup/build` 라우트 — JWT 인증 + zod 입력 검증 + 표준 에러 응답 | High | Pending |
| FR-02b | `GET /api/sketchup/ping` 라우트 — 가용성 헬스체크 | Medium | Pending |
| FR-03 | `POST /api/sketchup/build/stream` SSE — 명령별 진행 이벤트 | Medium | Pending |
| FR-04 | `PersistentConnection` 인스턴스별 request id 카운터 분리 (M3) | Medium | Pending |
| FR-05 | 미매칭 응답 silent drop → pino debug 로그 + 누적 카운터 (M4) | Low | Pending |
| FR-06 | 빌드 메트릭 구조화 로깅 (RTT, 컴포넌트 수, 실패율) | Low | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| Performance | 30개 컴포넌트 빌드 < 10초 (실 mhyrr 환경) | E2E 스크립트 timing |
| Security | `eval_ruby` allowlist invariant 유지, JWT 인증 강제 | code-analyzer + 단위 테스트 |
| Reliability | 빌드 중 1건 실패 시 부분 빌드 0건 보장 (transactional+autoAbort) | mock + 실 E2E |
| Observability | 빌드 메트릭이 pino 구조화 로그로 100% 기록 | log grep + 카운트 검증 |
| Compatibility | 기존 `build_sketchup_scene` MCP 도구 인터페이스 무변경 | 회귀 테스트 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] FR-01~06 모두 구현 또는 명시적 deferral 결정
- [ ] vitest 신규 테스트 추가 (HTTP route, SSE, M3/M4) — 전체 suite 300+/300+ 통과
- [ ] `tsc` clean build
- [ ] gap-detector ≥ 96% 유지 (W2 기준선 회귀 없음)
- [ ] E2E 스크립트 (`mcp-server/scripts/e2e-sketchup-build.mjs`) 가 sink/wardrobe/fridge 3개 카테고리에서 성공
- [ ] HTTP route `OpenAPI` 또는 README 의 라우트 표에 추가

### 4.2 Quality Criteria

- [ ] sketchup 관련 신규 라인의 단위 테스트 커버리지 ≥ 80%
- [ ] zero TypeScript `any` 도입 (zod 추론 또는 명시 타입)
- [ ] `eval_ruby` 직접 객체 리터럴 0건 (모두 `evalRubySafe` 경유)
- [ ] PR 단위 커밋 컨벤션 유지: `feat(mcp/sketchup): W3 — …`

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 디자이너 PC mhyrr 확장 설치 환경 불일치 | High | Medium | W1 코드 주석의 mhyrr 프로토콜 명세를 기준으로 검증, 실패 시 `pingSketchup` 진단 로그로 격리 |
| SSE 스트림 도중 클라이언트 단절 → 트랜잭션 미커밋 | High | Medium | `PersistentConnection.destroy()` 가 자동 ABORT 트리거하도록 보장 (현재는 단순 close — 검증 필요) |
| 인증 누락된 HTTP route 가 prod 노출 | Critical | Low | `requireAuth` 미들웨어 강제, security-review 스킬로 머지 전 검증 |
| 메트릭 로깅 과다 → 로그 비용 증가 | Medium | Low | 명령 단위 debug 레벨, 배치 단위만 info 레벨로 분리 |
| M3/M4 리팩터가 기존 36 테스트 회귀 유발 | Medium | Medium | 변경 전 vitest --watch 로 회귀 즉시 감지, 인스턴스 카운터는 기존 전역 동작과 동일 시나리오 추가 검증 |

---

## 6. Architecture Considerations

### 6.1 Project Level Selection

| Level | Characteristics | Recommended For | Selected |
|-------|-----------------|-----------------|:--------:|
| Starter | 단순 구조 | 정적 사이트, 포트폴리오 | ☐ |
| **Dynamic** | Feature 모듈 + services layer | 백엔드 있는 웹앱, SaaS MVP | ☑ |
| Enterprise | 엄격한 레이어 분리, DI, 마이크로서비스 | 고트래픽, 복잡 아키텍처 | ☐ |

→ `mcp-server` 는 이미 Dynamic 레벨로 구축돼 있음. W3 도 동일 레벨 유지.

### 6.2 Key Architectural Decisions

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| HTTP route 위치 | 신규 `routes/sketchup.route.ts` / 기존 도구 안 | **신규 라우트 파일** | `bom.route.ts`, `interior.route.ts` 등 패턴 일치 |
| SSE 구현 | Express SSE 헬퍼 / 수동 `res.write` | **수동 `res.write`** | `agent/chat.route.ts` 의 SSE 패턴 재사용 |
| 메트릭 라이브러리 | pino 만 / pino + prom-client | **pino 만** | 기존 인프라 유지, 외부 시스템 의존 없음 |
| E2E 자동화 | 신규 `scripts/e2e-sketchup-build.mjs` / vitest tag | **신규 스크립트** | E2E 는 mhyrr 환경 필요 — CI 에서 skip 되어야 |
| Request ID 분리 | 인스턴스 필드 / WeakMap | **인스턴스 필드** | 단순함, GC 자연스러움 |

### 6.3 Folder Structure Impact

```
mcp-server/src/
├── routes/
│   └── sketchup.route.ts          (신규 — FR-02, FR-02b, FR-03)
├── services/
│   ├── sketchup-builder.service.ts (변경 없음)
│   └── sketchup-mcp-bridge.service.ts (변경 — M3 인스턴스 필드, M4 debug 로그, FR-06 메트릭)
├── tools/
│   └── sketchup-build.tool.ts     (변경 없음 또는 내부 호출 일부)
└── tests/
    ├── sketchup-mcp-bridge.service.test.ts (변경 — M3/M4 회귀 케이스)
    └── sketchup.route.test.ts     (신규)

mcp-server/scripts/
└── e2e-sketchup-build.mjs         (신규 — FR-01)
```

---

## 7. Convention Prerequisites

### 7.1 Existing Project Conventions

- [x] `CLAUDE.md` — 다담AI 프로젝트 규칙 (작업 분리, 파일 소유권, 자동 커밋 규칙)
- [x] ESLint, TypeScript 설정 mcp-server 에 구축됨
- [x] vitest + Docker CI 파이프라인 존재 (`.github/workflows/mcp-server-ci.yml`)
- [x] pino 구조화 로깅 컨벤션 (`module` 필드 + 이벤트별 키)
- [x] Express 미들웨어 체인: `requireAuth` / `optionalAuth` / `inputValidator` / `rateLimit`

### 7.2 Conventions to Define/Verify

| Category | Current State | To Define | Priority |
|----------|---------------|-----------|:--------:|
| HTTP route 명명 | 존재 (`/api/{resource}`) | `/api/sketchup/*` 적용 | High |
| SSE 이벤트 명명 | `agent/chat` 패턴 존재 | `command_sent`, `command_ack`, `aborted`, `complete` | High |
| 메트릭 로그 키 | pino `module: "sketchup-build"` | `commandCount`, `rttMs`, `failures`, `aborted` | Medium |
| E2E 스크립트 구조 | `scripts/deploy-*.mjs` 패턴 | `scripts/e2e-sketchup-build.mjs` (테스트 케이스 배열) | Medium |

### 7.3 Environment Variables Needed

| Variable | Purpose | Scope | To Be Created |
|----------|---------|-------|:-------------:|
| `SKETCHUP_BRIDGE_HOST` | mhyrr 호스트 (기본 127.0.0.1) | Server | ☑ |
| `SKETCHUP_BRIDGE_PORT` | mhyrr 포트 (기본 9876) | Server | ☑ |
| `SKETCHUP_BRIDGE_TIMEOUT_MS` | 명령 타임아웃 (기본 15000) | Server | ☑ |

→ 모두 `BridgeOptions` 의 기본값으로 fallback, env 미설정 시 동작 보장.

### 7.4 Pipeline Integration

본 W3 는 mcp-server 의 후속 사이클이라 9-phase pipeline 의 처음부터 수행할 필요 없음.
관련 phase만 부분 적용:
- Phase 4 (API) — HTTP route 설계, FR-02/FR-02b/FR-03
- Phase 8 (Review) — code-review + security-review 스킬로 머지 전 검증

---

## 8. Next Steps

1. [ ] `/pdca design mcp-sketchup-w3` — Design 문서 (route schema, SSE 이벤트 페이로드, M3/M4 인터페이스 변경 명세)
2. [ ] PR 시리즈 분할 결정: 단일 PR (`W3` 통합) vs 다중 PR (`W3-routes`, `W3-sse`, `W3-cleanup`)
3. [ ] 디자이너 PC mhyrr 환경 준비 일정 — FR-01 E2E 검증을 위한 외부 의존성
4. [ ] 구현 시작 (`/pdca do mcp-sketchup-w3`)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-15 | 초안 — W1/W2 후속 W3 스코프 정의 (E2E + HTTP/SSE + M3/M4 + 메트릭) | hong |
