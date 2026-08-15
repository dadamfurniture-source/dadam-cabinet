---
template: design
version: 1.2
feature: mcp-sketchup-w3
date: 2026-05-15
author: hong
project: dadam-mcp-server
version_label: v1.5.0 (예정)
---

# mcp-sketchup-w3 Design Document

> **Summary**: SketchUp 빌더의 HTTP/SSE 노출, 실 E2E, M3/M4 정리, 메트릭 로깅의 기술 설계
>
> **Project**: dadam-mcp-server
> **Version**: v1.5.0 (예정)
> **Author**: hong
> **Date**: 2026-05-15
> **Status**: Draft
> **Planning Doc**: [mcp-sketchup-w3.plan.md](../../01-plan/features/mcp-sketchup-w3.plan.md)

---

## 1. Overview

### 1.1 Design Goals

- **외부 노출 일관성** — `agent/chat`, `bom`, `interior` 와 동일한 Express 라우트 + SSE 패턴 재사용
- **트랜잭션 정합성** — SSE 단절 / 클라이언트 abort 시에도 `abort_operation` 으로 SketchUp 측 부분 빌드 방지
- **관측 가능성** — pino 구조화 로그로 RTT/실패율/명령수를 검색 가능하게 기록
- **회귀 0** — W1/W2 의 36 단위 테스트와 `build_sketchup_scene` MCP 도구 인터페이스 무변경
- **invariant 강화** — `eval_ruby` 의 유일 게이트웨이가 `evalRubySafe` 라는 W2 gap-close 결과 유지

### 1.2 Design Principles

1. **Reuse over reinvent** — SSE 는 `agent.route.ts` 의 `sendSSE` 헬퍼 시그니처를 그대로 차용
2. **Single source of truth** — 라우트 → tool 로직 재호출 X, 라우트가 직접 builder/bridge 사용 (도구는 라우트와 별도 진입점)
3. **Fail closed on auth** — 모든 신규 라우트 `requireAuth` 강제, 헬스체크만 예외
4. **Local-only by default** — `SKETCHUP_BRIDGE_HOST` 미설정 시 `127.0.0.1` — prod 외부 노출 가드

---

## 2. Architecture

### 2.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                       Designer / Frontend                    │
│  POST /api/sketchup/build/stream  (SSE)                      │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│         Express Router  (sketchup.route.ts) [NEW]           │
│   • requireAuth                                             │
│   • zod validation                                          │
│   • sketchupRateLimit  (5/min, per-route)                   │
└───┬──────────────────────────────────────────────────────┬──┘
    │                                                      │
    ▼ buildPlanFromParts                                   ▼ sendBatch (SSE-aware)
┌──────────────────────────┐                ┌────────────────────────────┐
│ sketchup-builder.service │                │  sketchup-mcp-bridge.svc   │
│  (변경 없음)              │                │  PersistentConnection      │
│                          │                │  + perInstance reqId (M3)  │
│                          │                │  + dispatchLine debug (M4) │
│                          │                │  + metrics emit (FR-06)    │
└──────────────────────────┘                └─────────┬──────────────────┘
                                                      │ TCP JSON-RPC 2.0
                                                      ▼
                                       ┌──────────────────────────────────┐
                                       │  mhyrr/sketchup-mcp (Ruby ext)   │
                                       │  127.0.0.1:9876 (디자이너 PC)    │
                                       └──────────────────────────────────┘
```

### 2.2 Data Flow

```
1. POST /api/sketchup/build/stream
   ↓
2. requireAuth → zod parse → sketchupRateLimit
   ↓
3. pingSketchup (sketchup_unavailable 이벤트로 단락)
   ↓
4. buildPlanFromParts(parts, options)   → BuildCommand[]
   ↓
5. sendBatchWithProgress(commands, onProgress)
   ├─ onProgress({ index, tool }) → SSE event "command_sent"
   ├─ onResult({ index, ok, error }) → SSE event "command_ack"
   ├─ on first failure → SSE event "aborted" → ABORT_OP 동봉
   └─ on completion → SSE event "complete" + metrics summary
   ↓
6. pino info log (batch summary)
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|------------|---------|
| `sketchup.route.ts` (NEW) | builder.service, bridge.service, auth middleware, rateLimit middleware, zod | HTTP/SSE 엔트리 |
| `bridge.service` (변경) | `pino`, `evalRubySafe` (builder), `RUBY_COMMANDS` | TCP + 메트릭 |
| `e2e-sketchup-build.mjs` (NEW) | node:fs, builder.service, bridge.service | 실 mhyrr 종단 검증 |

---

## 3. Data Model

### 3.1 Request / Event Schemas

#### `BuildRequest` (모든 라우트 공통)

```typescript
interface BuildRequest {
  parts: CabinetPart[];           // 최소 1개
  category: CabinetCategory;       // 'sink' | 'wardrobe' | 'vanity' | 'shoe' | 'fridge' | 'storage'
  materialTone: MaterialTone;      // 'cream' | 'oak' | 'walnut' | 'graphite'
  clearExisting?: boolean;         // 기본 false
  transactional?: boolean;         // 기본 true
  host?: string;                   // 기본 SKETCHUP_BRIDGE_HOST
  port?: number;                   // 기본 SKETCHUP_BRIDGE_PORT
  timeoutMs?: number;              // 기본 SKETCHUP_BRIDGE_TIMEOUT_MS
}
```

→ zod 스키마는 `tools/sketchup-build.tool.ts` 의 `inputSchema` 를 `export` 하여 라우트와 도구가 공유.

#### SSE `BuildStreamEvent`

```typescript
type BuildStreamEvent =
  | { event: 'build_started';  data: { componentCount: number; transactional: boolean; clearExisting: boolean } }
  | { event: 'command_sent';   data: { index: number; tool: MhyrrToolName; name?: string } }
  | { event: 'command_ack';    data: { index: number; ok: boolean; durationMs: number; error?: { message: string } } }
  | { event: 'aborted';        data: { failedIndex: number; reason: string } }
  | { event: 'complete';       data: BatchSummary }
  | { event: 'error';          data: { code: SketchupErrorCode; message: string } };

interface BatchSummary {
  totalSent: number;
  successCount: number;
  failures: Array<{ index: number; error: { message: string } }>;
  durationMs: number;
  averageRttMs: number;
  aborted: boolean;
}
```

→ Non-SSE 라우트(`POST /api/sketchup/build`) 는 `BatchSummary` 를 JSON 으로 직접 반환.

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth | Rate Limit |
|--------|------|-------------|------|------------|
| POST | `/api/sketchup/build` | 동기 빌드 (`BatchSummary` JSON 반환) | requireAuth | sketchupRateLimit (5/min) |
| POST | `/api/sketchup/build/stream` | 비동기 빌드 (SSE 진행률) | requireAuth | sketchupRateLimit (5/min) |
| GET  | `/api/sketchup/ping` | mhyrr 가용성 확인 (200/503) | requireAuth | globalRateLimit |

### 4.2 Detailed Specification

#### `POST /api/sketchup/build`

**Request body**: `BuildRequest`

**Response 200**:
```json
{
  "success": true,
  "summary": {
    "totalSent": 30,
    "successCount": 30,
    "failures": [],
    "durationMs": 4230,
    "averageRttMs": 141,
    "aborted": false
  }
}
```

**Errors**:
- `400 SKETCHUP_INVALID_INPUT` — zod parse 실패
- `401` — JWT 누락/무효
- `429 SKETCHUP_RATE_LIMITED`
- `503 SKETCHUP_UNAVAILABLE` — mhyrr ping 실패
- `502 SKETCHUP_BUILD_FAILED` — 빌드 도중 실패 (summary 동봉)

#### `POST /api/sketchup/build/stream`

**Headers**: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`

**SSE 이벤트 순서**:
```
event: build_started
data: {"componentCount":30,"transactional":true,"clearExisting":false}

event: command_sent
data: {"index":0,"tool":"eval_ruby","name":null}    ← START_OP

event: command_ack
data: {"index":0,"ok":true,"durationMs":12}

event: command_sent
data: {"index":1,"tool":"create_component","name":"dadam.sink.body-01"}

event: command_ack
data: {"index":1,"ok":true,"durationMs":98}

...

event: complete
data: { ...BatchSummary }
```

**클라이언트 단절 처리** — 서버는 `req.on('close')` 에서:
1. 현재 진행 중인 batch 에 `aborted=true` 신호 전파
2. `PersistentConnection.destroy()` 호출 → mhyrr 측 close
3. 진행 중 트랜잭션이 있으면 즉시 `ABORT_OP` 발사 (`autoAbortOnFailure` 와 동일 경로)

#### `GET /api/sketchup/ping`

**Response 200**: `{ "ok": true, "host": "127.0.0.1", "port": 9876, "rttMs": 12 }`
**Response 503**: `{ "ok": false, "error": "SketchUp bridge timeout after 3000ms" }`

---

## 5. Bridge Service 변경 (M3 / M4 / FR-06)

### 5.1 PersistentConnection — 인스턴스별 request id (M3)

```typescript
// before (W2)
let nextRequestId = 1; // module-level

// after (W3)
class PersistentConnection {
  private nextRequestId = 1; // instance field
  // ...
}
```

`sendCommand` 의 단발 호출은 동일하게 모듈 전역 카운터를 유지하되, 함수 진입 시 별도 짧은 클래스로 격리하지 않고 **모듈 클로저 안 함수 스코프 카운터** 로 분리. 두 경로(단발 vs persistent) 의 id 공간이 충돌해도 mhyrr 가 id 매칭하지 않으므로 기능 영향 0.

### 5.2 dispatchLine — silent drop 대체 (M4)

```typescript
private dispatchLine(line: string): void {
  const pending = this.queue.shift();
  if (!pending) {
    this.unmatchedResponseCount++;
    this.log.debug({ line: line.slice(0, 200), unmatched: this.unmatchedResponseCount }, 'unmatched bridge response — queue empty');
    return;
  }
  // ...
}
```

→ `pino` debug 레벨로 첫 200자만 로깅 (PII / 응답 본문 폭주 방지). `unmatchedResponseCount` 는 destroy 시점 info 로그에 포함.

### 5.3 sendBatchWithProgress — 콜백 시그니처 (FR-03 기반)

```typescript
export interface SendBatchProgress {
  onSent?: (index: number, command: BuildCommand) => void;
  onResult?: (index: number, result: BridgeResult, durationMs: number) => void;
}

export async function sendBatch(
  commands: BuildCommand[],
  options: BatchOptions = {},
  progress?: SendBatchProgress,
): Promise<BatchResult> { /* ... */ }
```

→ `progress` 미지정이면 W2 동작 그대로 (회귀 X). `BatchResult` 에 `averageRttMs` 신규 필드 추가 — 옵셔널 호환.

### 5.4 메트릭 로그 (FR-06)

배치 종료 시점 1회 info 로그:

```typescript
log.info({
  module: 'sketchup-bridge',
  totalSent,
  successCount,
  failureCount: failures.length,
  durationMs,
  averageRttMs,
  aborted,
  category: opts.category ?? null,
  unmatchedResponses: conn.unmatchedResponseCount,
}, 'sketchup batch complete');
```

명령 단위 debug 로그는 별도. 프로덕션은 info 만 활성, debug 는 `SKETCHUP_BRIDGE_DEBUG=1` 환경변수일 때만.

---

## 6. Error Handling

### 6.1 Error Codes

| Code | HTTP | Cause | Handling |
|------|:----:|-------|----------|
| `SKETCHUP_INVALID_INPUT` | 400 | zod parse 실패 | 클라이언트 재요청 |
| `SKETCHUP_UNAUTHORIZED` | 401 | JWT 무효 | 로그인 재시도 |
| `SKETCHUP_RATE_LIMITED` | 429 | 분당 5회 초과 | 백오프 |
| `SKETCHUP_UNAVAILABLE` | 503 | mhyrr ping 실패 | 디자이너 PC 확장 기동 안내 |
| `SKETCHUP_BUILD_FAILED` | 502 | 빌드 중 명령 실패 (`autoAbort` 후) | 실패 인덱스 + summary 반환 |
| `SKETCHUP_BUILD_ABORTED` | 499 | 클라이언트 단절로 abort | 멱등 재시도 가능 |

### 6.2 Error Response Format

기존 `error-handler.ts` 패턴 유지:

```json
{
  "success": false,
  "error": {
    "code": "SKETCHUP_BUILD_FAILED",
    "message": "command 7 (create_component dadam.sink.door-01) failed: duplicate name",
    "details": {
      "failedIndex": 7,
      "totalSent": 8,
      "aborted": true
    }
  }
}
```

---

## 7. Security Considerations

| 항목 | 적용 |
|------|:----:|
| Input validation (zod) | ✅ |
| JWT 인증 (`requireAuth`) | ✅ 모든 빌드 라우트 |
| `eval_ruby` allowlist invariant | ✅ `evalRubySafe` 만 produce (W2 gap-close 유지) |
| Rate limiting (5/min per user) | ✅ `sketchupRateLimit` 신규 |
| 로컬 전용 fallback (`127.0.0.1`) | ✅ env 미설정 시 |
| HTTPS 강제 | ✅ Railway / Cloudflare 레벨에서 |
| PII 누출 방지 | ✅ debug 로그는 응답 200자 truncate |
| SSE keepalive 헤더 | ✅ `X-Accel-Buffering: no` (nginx/CDN 우회) |

---

## 8. Test Plan

### 8.1 Scope

| Type | Target | Tool |
|------|--------|------|
| Unit | M3/M4 회귀 — 인스턴스 id 카운터, debug 로그 트리거 | vitest |
| Integration | HTTP route — auth, validation, error mapping | vitest + supertest (`agent.route.test.ts` 패턴) |
| Integration | SSE — 이벤트 순서, 단절 시 ABORT | vitest + mock TCP server (W2 패턴) |
| E2E | 실 mhyrr 확장 — sink/wardrobe/fridge | `mcp-server/scripts/e2e-sketchup-build.mjs` (CI skip) |

### 8.2 Key Test Cases

- [ ] **HAPPY**: 30 컴포넌트 빌드 → `complete` 이벤트 + `aborted=false`
- [ ] **AUTH**: JWT 누락 → 401
- [ ] **INVALID**: `parts: []` → 400
- [ ] **UNAVAILABLE**: mhyrr 다운 → 503 + `SKETCHUP_UNAVAILABLE`
- [ ] **PARTIAL FAIL**: 5번째 명령 실패 → `aborted` 이벤트 + ABORT_OP 전송 + 502
- [ ] **CLIENT DISCONNECT**: SSE 도중 클라이언트 close → ABORT_OP 발사, 후속 명령 미발사
- [ ] **RATE LIMIT**: 분당 6회째 → 429
- [ ] **M3 회귀**: 두 PersistentConnection 인스턴스의 id 가 독립적
- [ ] **M4 회귀**: 미매칭 응답 1건 → debug 로그 1건 + 카운터 1 증가
- [ ] **E2E**: sink 12 컴포넌트 실 빌드 → SketchUp outliner 에 `dadam.sink.*` 12 항목 확인 (수동)

---

## 9. Clean Architecture

### 9.1 Layer Assignment

| Component | Layer | Location |
|-----------|-------|----------|
| `sketchup.route.ts` | Presentation (HTTP boundary) | `src/routes/` |
| `sketchup-build.tool.ts` | Presentation (MCP boundary, 무변경) | `src/tools/` |
| `sketchup-builder.service.ts` | Application (순수 변환) | `src/services/` |
| `sketchup-mcp-bridge.service.ts` | Infrastructure (TCP I/O) | `src/services/` |
| `sketchup.ts` (constants) | Domain (프로토콜/상수) | `src/constants/` |
| `e2e-sketchup-build.mjs` | Test (manual) | `scripts/` |

### 9.2 Dependency Rules

- Route → Service (builder, bridge) → Constants
- Bridge → Builder (`evalRubySafe`) — W2 gap-close 의 결정 유지
- Service → Domain (`constants/sketchup.ts`) — 단방향
- No circular deps. 신규 라우트는 도구를 호출하지 않고 service 를 직접 호출 (도구는 MCP-only 진입점).

---

## 10. Coding Convention Reference

| Item | Applied |
|------|---------|
| Naming (camelCase func, PascalCase type) | ✅ |
| File 이름: `kebab-case.ts` | ✅ `sketchup.route.ts`, `e2e-sketchup-build.mjs` |
| Import order: 외부 → internal → type → side-effect | ✅ |
| Env var prefix `SKETCHUP_BRIDGE_*` | ✅ 신규 |
| pino `createLogger('route:sketchup')` | ✅ 기존 패턴 |
| 한국어 주석 + 도메인 영문 토큰 | ✅ 기존 sketchup 파일 컨벤션 |

---

## 11. Implementation Guide

### 11.1 File Structure (예상 변경)

```
mcp-server/src/
├── routes/
│   └── sketchup.route.ts            ★ NEW (FR-02, FR-02b, FR-03)
├── services/
│   └── sketchup-mcp-bridge.service.ts (변경 — M3/M4/FR-06)
├── middleware/
│   └── rate-limiter.ts              (변경 — sketchupRateLimit 추가)
├── http-server.ts                   (변경 — 1 줄 import + app.use)
└── utils/
    └── (logger 변경 없음)

mcp-server/tests/
├── sketchup-mcp-bridge.service.test.ts (변경 — M3/M4 회귀 케이스)
└── sketchup.route.test.ts            ★ NEW (supertest)

mcp-server/scripts/
└── e2e-sketchup-build.mjs            ★ NEW (FR-01)
```

### 11.2 Implementation Order

PR 시리즈로 분할 (Plan 의 옵션 B):

1. **PR W3-1: M3/M4/FR-06 (bridge cleanup)** — 라우트와 무관한 service-level 정리. 회귀 위험 최소.
2. **PR W3-2: HTTP routes** — `/api/sketchup/build`, `/api/sketchup/ping` + `sketchupRateLimit` (FR-02, FR-02b)
3. **PR W3-3: SSE stream** — `/api/sketchup/build/stream` + `sendBatchWithProgress` 콜백 (FR-03)
4. **PR W3-4: E2E script** — `scripts/e2e-sketchup-build.mjs` + README (FR-01)

각 PR 종료 시 vitest --watch, build, gap-detector 96% 유지 확인.

---

## 12. Open Decisions (Design 단계에서 확정 필요)

- [ ] SSE 이벤트 명을 snake_case 로 (예: `build_started`) 유지할지, `agent/chat` 의 dot.case (`message.delta`) 와 통일할지 → **결정: snake_case** (다른 백엔드 SSE 도 snake_case 일관)
- [ ] `BatchResult.averageRttMs` 를 W3 에서 도입하면 W2 의 단위 테스트 (totalSent/successCount/failures/durationMs/aborted 5필드 기대) 와 충돌하는가? → 옵셔널 필드라 호환. 단 type 가 변하므로 시그니처 확장만 (breaking X).
- [ ] `sketchupRateLimit` 임계값 5/min 이 디자이너 작업 빈도에 맞는가? → 운영 데이터 없으므로 보수적으로 5/min 시작, 실사용 후 조정.
- [ ] `e2e-sketchup-build.mjs` 가 SKP 산출물을 검증하는가? → W3 범위 외 (mhyrr 측 outliner 항목 수만 확인). SKP 파일 검증은 W4.

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-15 | 초안 — HTTP/SSE 라우트 명세, M3/M4 인터페이스, 테스트 계획 | hong |
