---
template: analysis
version: 1.0
feature: mcp-sketchup-w3
date: 2026-05-15
author: gap-detector
project: dadam-mcp-server
---

# mcp-sketchup-w3 — PDCA Check Phase Gap Analysis

> **Date**: 2026-05-15
> **Feature**: mcp-sketchup-w3
> **Plan**: [mcp-sketchup-w3.plan.md](../01-plan/features/mcp-sketchup-w3.plan.md)
> **Design**: [mcp-sketchup-w3.design.md](../02-design/features/mcp-sketchup-w3.design.md)
> **Predecessor baseline**: W2 96%
> **Test base**: vitest 28 files, 325/325 passing, tsc clean

---

## 1. Overall Scores

| Category | Score | Status |
|---|:---:|:---:|
| FR coverage (FR-01..06) | 100% | ✅ |
| Design spec match (SSE events, errors, metrics) | 96% | ✅ |
| Architecture compliance (layers, deps) | 100% | ✅ |
| Convention compliance (naming, env, imports) | 100% | ✅ |
| Test coverage (Design 10 cases → impl) | 100% | ✅ |
| Invariant preservation (`eval_ruby` allowlist) | 100% | ✅ |
| **Overall Match Rate** | **97%** | **✅ +1pt vs W2** |

---

## 2. FR Mapping

| FR | Design Location | Implementation | Status |
|---|---|---|:---:|
| FR-01 E2E sink/wardrobe/fridge | Design 8.1 | `mcp-server/scripts/e2e-sketchup-build.mjs` + `scripts/README-sketchup-e2e.md` (PR #254) | ✅ |
| FR-02 `POST /api/sketchup/build` | Design 4.2 | `src/routes/sketchup.route.ts:72-166` (PR #252) | ✅ |
| FR-02b `GET /api/sketchup/ping` | Design 4.2 | `src/routes/sketchup.route.ts:34-66` (PR #252) | ✅ |
| FR-03 `POST /api/sketchup/build/stream` SSE | Design 4.2, 5.3 | `src/routes/sketchup.route.ts:189-373` (PR #253) | ✅ |
| FR-04 (M3) per-instance `nextRequestId` | Design 5.1 | `src/services/sketchup-mcp-bridge.service.ts:195` (PR #251) | ✅ |
| FR-05 (M4) `dispatchLine` debug + counter | Design 5.2 | `bridge.service.ts:197, 276-288` (PR #251) | ✅ |
| FR-06 batch metrics | Design 5.4 | `bridge.service.ts:517-532` (PR #251) | ✅ |

---

## 3. Design Spec Match

- **SSE Events (6/6)**: `build_started` / `command_sent` / `command_ack` / `aborted` / `complete` / `error` — 모두 `sketchup.route.ts:274-347` 구현됨.
- **Metric log keys**: `sketchup_batch_complete` (info), `sketchup_connect_failed` (warn) — Design 5.4 와 정확히 일치. 필드 `totalSent` / `successCount` / `failureCount` / `durationMs` / `averageRttMs` / `aborted` / `unmatchedResponses` 모두 존재.
- **Middleware order**: `requireAuth` → `sketchupRateLimit` → handler — Design 4.1 일치.
- **Security 8 항목**: zod validation, JWT auth, `eval_ruby` allowlist (`evalRubySafe`), 5/min rate limit, `127.0.0.1` fallback, HTTPS (인프라), 200-char debug truncate, `X-Accel-Buffering: no` — 모두 확인.

---

## 4. Intentional Plan/Design Deviations (Justified)

1. **`req.on('close')` → `res.on('close')`** (Design 4.2 stream vs `sketchup.route.ts:225-233`):
   - **이유**: Express 5 의 `req 'close'` 가 request body 소비 완료 직후 발화 → SSE 의 모든 정상 요청에서 false-positive abort 발생
   - **해결**: `res 'close'` 는 응답 stream 종료 시점에만 발화. `mainDone` 플래그로 정상 종료/단절 구분.
   - **정당성**: 정확성 수정이며 회귀 아님. 코드 주석에 명시.

2. **`supertest` → `node:http` + `fetch` + `vi.mock`**:
   - Design 8.1 은 supertest 언급. 실제 구현은 native 도구.
   - **이유**: 패키지 의존성 미설치 (`package.json` 확인). 기능 등가.
   - Match rate 영향 없음.

---

## 5. Test Coverage (Design 10 cases → vitest)

- `sketchup.route.test.ts` — 17 케이스: ping ×3, build ×7, rate-limit ×1, SSE ×6
- `sketchup-mcp-bridge.service.test.ts` — 24+ 케이스 (W3-1 +9 회귀: M3 격리 ×2, M4 미매칭 ×2, progress ×2, averageRttMs ×3)
- **W1/W1.1/W2 회귀**: 28 파일 모두 통과 — newline 파서, eval_ruby allowlist, partId 이스케이프 등 기존 invariant 보존

---

## 6. Critical / Major / Minor Gaps

### Critical: 0
### Major: 0

### Minor

| # | 항목 | 위치 | 권장 조치 |
|---|------|------|----------|
| **N1** | 에러 코드 prefix 불일치 (cosmetic) | Design 6.1 vs `sketchup.route.ts` | Design 6.1 을 갱신 — 실제로는 `VALIDATION_ERROR` / `AUTHENTICATION_ERROR` / `RATE_LIMIT` 의 generic prefix 사용 (다른 라우트와 일관). 5분 작업. |
| **N2** | `SKETCHUP_BUILD_ABORTED` HTTP 499 미사용 | Design 6.1 | SSE 경로에선 status 이미 200 — Design 에 "499 는 미래의 non-SSE abort 경로용" 주석 추가 권장. |
| **N3** | `SKETCHUP_BRIDGE_HOST/PORT/TIMEOUT_MS` env var 미구현 | Plan 7.3 vs `bridge.service.ts` | 옵션 (a) `process.env.SKETCHUP_BRIDGE_*` fallback chain 추가, 또는 (b) Plan 7.3 항목 제거. 현재 코드는 요청별 `host`/`port` body override 만 지원. |

---

## 7. Recommended Actions

| 우선순위 | 작업 | 소요 |
|---------|------|:---:|
| **즉시** | N1 — Design 6.1 에러 코드 표를 실제 구현에 맞춰 갱신 | 5분 |
| **곧** | N3 — env var 지원 결정 (구현 or Plan 항목 제거) | 30분 |
| **W4 후보** | N2 — non-SSE abort 경로 도입 시에만 의미 | — |
| **유지** | W2 invariant (eval_ruby allowlist, newline 파서, partId 이스케이프) — 추가 조치 없음 | — |

---

## 8. Conclusion

W3 가 7개 FR 모두를 제공하고 W2 invariant 를 보존하며 Match Rate 를 96% → **97%** 로 +1pt 향상.
유일한 `req.on('close')` → `res.on('close')` deviation 은 Express 5 호환을 위한 문서화된 정확성 수정이며 회귀 아님.

- **Critical 0 / Major 0 / Minor 3** (모두 문서 수준 또는 옵셔널 env 와이어링)
- **다음 권장**: `/pdca report mcp-sketchup-w3` 로 사이클 마무리 (iterate 불필요)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-05-15 | gap-detector agent 결과 — Match Rate 97% | gap-detector |
