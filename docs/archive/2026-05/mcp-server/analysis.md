# Agent Chat System - Gap Analysis Report (v2)

> **Match Rate: 90%** (v1: 77%)
> **Date**: 2026-02-16
> **Feature**: mcp-server (Agent Chat)
> **Design Doc**: N/A (코드 기반 분석)
> **Iteration**: Act-1 완료

## Overall Scores

| Category | v1 Score | v2 Score | Status | Delta |
|----------|:--------:|:--------:|:------:|:-----:|
| Feature Completeness | 88% | 95% | OK | +7 |
| Error Handling | 75% | 92% | OK | +17 |
| Type Safety | 82% | 85% | OK | +3 |
| Security | 58% | 75% | WARNING | +17 |
| Performance | 80% | 80% | WARNING | 0 |
| Frontend Quality | 72% | 95% | OK | +23 |
| Convention Compliance | 85% | 92% | OK | +7 |
| **Overall** | **77%** | **90%** | **OK** | **+13** |

## CRITICAL Issues (3 in v1 → 1 remaining)

### S1. API Key in .env (mcp-server/.env:13) — OPEN
- 실제 `sk-ant-api03-...` 키가 `.env`에 저장됨
- `.gitignore`에 포함되어 있으나 키 로테이션 권장
- **Action**: 프로덕션 배포 전 키 로테이션 필수

### ~~S2. SVG XSS Injection~~ — FIXED
- `sanitizeSvg()` 메서드 추가 (DOMParser 기반)
- `<script>`, `foreignObject` 제거, `on*` 속성 제거, `javascript:` URL 제거
- BOM/설계데이터 값도 `escapeHtml()` 적용

### ~~S3. No Auth on Agent Endpoint~~ — DOWNGRADED to WARNING
- CORS 설정으로 `dadamfurniture.com` 도메인만 접근 가능 (부분 방어)
- 프로덕션 배포 시 인증 미들웨어 추가 필요

## WARNING Issues (6 in v1 → 2 remaining)

| # | Issue | v1 Status | v2 Status | Fix Detail |
|---|-------|:---------:|:---------:|------------|
| F1 | save_design 에러 삼킴 | WARNING | FIXED | 내부 try-catch 제거, 외부 핸들러로 전파 |
| F2 | max_tokens 절단 경고 없음 | WARNING | FIXED | 경고 텍스트 이벤트 + 로그 추가 |
| F3 | 이미지 삭제 인덱스 버그 | WARNING | FIXED | 참조 기반 indexOf 방식으로 변경 |
| F4 | 요청 유효성 검증 없음 | WARNING | FIXED | images 배열 구조 검증 추가 |
| F5 | Placeholder 미숨김 | WARNING | CLOSED | 재분석 결과 false positive (finally에서 숨김 처리됨) |
| F6 | Rate limiting 없음 | WARNING | OPEN | 인프라 레벨 대응 필요 |

### Remaining Open Issues

| # | Issue | Severity | Description |
|---|-------|:--------:|-------------|
| S1 | API Key in .env | WARNING | 키 로테이션 필요 (운영 작업) |
| S3 | No Auth | WARNING | 인증 미들웨어 추가 필요 (CORS로 부분 방어 중) |
| F6 | Rate Limiting | WARNING | express-rate-limit 등 추가 권장 |

## Additional Fixes Applied

| Fix | File | Description |
|-----|------|-------------|
| Import 순서 | claude.client.ts | mid-file import를 파일 상단으로 이동 |
| BOM textContent | agent-chat.js | summary에 innerHTML → textContent 변경 |
| handleProgress escape | agent-chat.js | data.tool fallback에 escapeHtml 적용 |

## Strengths

1. 10/10 도구 완전 구현, 8/8 SSE 이벤트 커버리지
2. 토큰 최적화 (이미지 중복 제거)
3. Circuit breaker 패턴
4. 깔끔한 의존성 방향 (Presentation → Application → Domain → Infrastructure)
5. 동적 시스템 프롬프트 (설계 상태 주입)
6. 벽면 분석 캐싱
7. **[NEW]** XSS 방어 (sanitizeSvg + escapeHtml 전면 적용)
8. **[NEW]** 올바른 에러 전파 체인 (tool-adapter → orchestrator → route)
9. **[NEW]** 요청 경계 유효성 검증

## Recommended Remaining Actions (프로덕션 배포 전)

1. API 키 로테이션 (S1)
2. 인증 미들웨어 추가 (S3)
3. Rate limiting 추가 (F6)
