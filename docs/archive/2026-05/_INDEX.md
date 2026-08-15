# Archive Index - 2026-05

| Feature | Archived | Match Rate | Documents |
|---------|----------|------------|-----------|
| mcp-server | 2026-05-15 | 96% | analysis, report |
| mcp-sketchup-w3 | 2026-05-15 | 97% | plan, design, analysis, report |
| mcp-sketchup-w4 | 2026-05-16 | 78% (강행) | plan, analysis, report |
| mcp-sketchup-w5 | 2026-05-17 | 88% | plan, analysis, report |
| sketchup-import | 2026-05-23 | 95% | plan, analysis, report |
| detail-design-w6 | 2026-05-24 | 95% | plan, analysis, report |
| bom-finish-color-mapping | 2026-05-24 | 98% | plan, analysis, report |
| planner-ui-redesign-w8 | 2026-05-24 | 92% | plan, analysis, report |

## planner-ui-redesign-w8

- **Description**: planner-vite UI 를 SketchUp 2026 스타일 minimal UI 로 재구성. 3-column shell (LeftToolbar 48px + 가운데 캔버스 + RightPanel 280px) + collapsible panels + 모바일 반응형 (≤768px overlay) + 단축키 L/R + localStorage persist.
- **Duration**: 2026-05-24 (단일 세션, ~6시간)
- **PRs Merged**: 7개 (#300 W8-2 ~ #306 W8-8)
- **Match Rate**: 92% (Critical 0, Major 0, Minor 3 — 모두 W9 deferral)
- **Test Coverage**: planner-vite 88/88 유지 (회귀 0, W9-2 에서 신규 컴포넌트 unit test 추가 예정)
- **신규 컴포넌트**: LeftToolbar (130 LOC) + RightPanel (460 LOC), 총 +590 LOC
- **App.tsx 변경**: ~1500 → ~1700 LOC (+200, 모바일 분기 + 단축키 + categoryCounts state)
- **detaildesign 변경**: ui-step1.js -120 LOC (현장실측 + Layout 삭제), base.css 화면 100vw
- **핵심 학습**:
  - HTML mockup 우선 (W8-5-1): 사용자 확인 후 React 구현 → 의도 불일치 회피
  - postMessage 다층 안전망 (ADD_CATEGORY + PLANNER_READY + CATEGORY_COUNTS): 무한 루프 차단 + 초기 sync
  - 단일 PR 통합 효율: W8-2 의 3 단계 분할 plan → 단일 PR 통합으로 일관 + 회귀 0
  - 반응형 매트릭스 패턴 (W8-8): matchMedia + setState 자동 갱신 + breakpoint 진입 시 자동 collapsed
  - 사용자 요구 빠른 반복: W8-3/4/6/7/8 plan 외 직접 구현, 각 30분~1시간
- **미해결 (W9 후속)**:
  - W9-1: 단축키 확장 (1/2/3 step + Space + V + Esc + Delete) + 도움말 footer
  - W9-2: 신규 컴포넌트 unit test (LeftToolbar/RightPanel/모바일 분기)
  - W9-3: App.tsx 분할 (TopBar/BottomBar/StepRouter/Canvas3D 컴포넌트 추출) — 1700 LOC 비대화 해소
  - W9-4: detaildesign vitest 환경 도입
  - W9-5: swatch UI (도어 색상 시각 선택)
  - W6-8b: legacy V1 코드 완전 제거 (production 1주 안정 후)
  - 디자이너 PC 실 사용자 인터랙션 검증
- **Documents**:
  - [Plan](planner-ui-redesign-w8/plan.md) — W8-2 + W8-5 (2 차례 작성)
  - [Analysis](planner-ui-redesign-w8/analysis.md) — Match 0.92
  - [Report](planner-ui-redesign-w8/report.md)
- **Successor**: W9 refactor cycle 권장 (App.tsx 분할 + 신규 컴포넌트 테스트)

## bom-finish-color-mapping

- **Description**: W6-5 ModuleDetailPanel 의 doorFinish (7) × doorColor (7) → BOM 산출 시 자재 코드 + 단가 자동 반영. 49 조합 매트릭스 + 양방향 sync + extractors 통합 + mcp-server 단가 tool wiring.
- **Duration**: 2026-05-24 (단일 세션, ~2시간)
- **PRs Merged**: 5개 (#295 W7-1 ~ #299 W8-1)
- **Match Rate**: 98% (Critical 0, Major 0 — W8-1 즉시 진행으로 해소)
- **자재 코드**: 49 unique (`{FINISH-3}{COLOR-3}-{TONE}`)
- **단가 범위**: ₩13,300 (MFB-WHT) ~ ₩41,800 (VNR-SAG)
- **Test Coverage**: mcp-server +16 신규 (vitest), planner-vite 88/88 회귀 0
- **핵심 학습**:
  - 다층 안전망 (양방향 sync 무한 루프 방지: silent update + _syncPlannerState 미호출, origin guard 대체)
  - 자재 코드 단일 소스 + mirror (detaildesign ↔ mcp-server 동기 매트릭스)
  - Default fallback 가치 (기존 BOM 호환 + 점진적 도입)
  - 헬퍼 분리 → tool wiring 분리 (W7-4 → W8-1 단계적, 회귀 위험 최소화)
- **미해결**:
  - W8-2 (0.5일): BOM Excel column 갱신 (excel-export.js 에 finishCode + 단가 column)
  - W8-3 (0.5일): detaildesign vitest 환경 도입
  - W8-4 (0.25일, Minor): postMessage origin allow-list
  - W9 (별 cycle, Out of Scope): 단가 자동 적용 (자재 마트 가격 변동 시 동적 업데이트)
- **Documents**:
  - [Plan](bom-finish-color-mapping/plan.md) — 4 PR 시리즈 (W7-1~W7-4)
  - [Analysis](bom-finish-color-mapping/analysis.md) — W8-1 후속 포함
  - [Report](bom-finish-color-mapping/report.md)
- **Successor**: W8-2/3/4 별 cycle (production 안정 후) 또는 디자이너 PC E2E 검증

## detail-design-w6

- **Description**: detail design 워크플로우 재구성 — "Top View 가구 배치 (segments) → 모듈 구조 (lower/upper/tall) → 디테일 (높이/도어/색상)" 3단계. preset.fullHeight binary 제약 제거, ㄱ자/ㄷ자/임의 polygon 자유 구성, 모듈 단위 heightOverride.
- **Duration**: 2026-05-24 (단일 세션, ~5시간)
- **PRs Merged**: 8개 (#287~#294)
- **Match Rate**: 95% (Critical 0, Major 2 모두 의도된 deferral)
- **Test Coverage**: planner-vite 88/88 (W6 시작 32 → +56 신규)
- **핵심 학습**:
  - 옵션 A (V2→legacy 역변환 후 기존 호출) 채택으로 deriveCabinet 1700 LOC 미변경 + round-trip 동등성 자동 보장
  - 백워드 호환 안전망 다층화 (ui-step1 명시 송신 + App.tsx 자동 migrate)
  - V2 전용 컴포넌트 신규 분리 (ModuleDetailPanel) — props 폭증 회피 + legacy 회귀 0
  - deferral 의 명시적 표기 (@deprecated JSDoc + W6-8b 후속 cycle 명문화)
- **미해결**:
  - W6-8b: legacy 필드 완전 제거 + deriveCabinetV2 native 재작성 (디자이너 PC E2E 1주 안정 후)
  - 디자이너 PC E2E 수동 검증 (V2 → SketchUp → import 라운드트립)
  - BOM 자재 코드 매핑 (doorFinish 7종 × doorColor 7종)
  - ㄷ자/임의 polygon UI 개선 (segment 자동 코너 채움 미리보기)
  - AI segment 추천 (벽 분석 → segments[] 자동 제안, 장기)
- **Documents**:
  - [Plan](detail-design-w6/plan.md) — 8 PR 시리즈 (W6-1~W6-8)
  - [Analysis](detail-design-w6/analysis.md)
  - [Report](detail-design-w6/report.md)
- **Successor**: W6-8b (legacy 제거) + BOM 매핑 cycle (즉시 시작 가능)

## sketchup-import

- **Description**: SketchUp → planner 역방향 import (양방향 통합 완성). 4가지 시나리오: ① 자체 export 재import ② 다담 plugin (Template + 자동 마킹) ③ 수동 매핑 UI ④ Gemini Vision AI 자동 분류.
- **Duration**: 2026-05-23 (단일 작업 세션, ~10시간)
- **PRs Merged**: 10개 (#276~#285)
- **Match Rate**: 95% (18/19 plan 항목, Critical 결함 0)
- **E2E**: 사용자 SketchUp 활성 모델 20 entities → 19 정확 복원, 95% 신뢰
- **핵심 학습**:
  - mhyrr v0.1.0 name 무시 결함 → Si-1b SET_NAMES (옵션 A) hotfix 로 즉시 보정
  - 단순 휴리스틱이 80-90% 정확도 (Phase 3a 자동 추론) → AI 는 보조
  - Few-Shot prompt + fallback heuristic 의 안전망 패턴 (Phase 3b)
  - 양방향 통합으로 디자이너 워크플로우 자유도 크게 향상
- **미해결**:
  - Phase 2 Observer 패턴 (Group 자동 감지)
  - Phase 3b 다중 view PNG (본체/도어 구분 정확도 ↑)
  - metric 대시보드 / AI 학습 데이터 수집
- **Documents**:
  - [Plan](sketchup-import/plan.md) — 4 옵션 통합 기획
  - [Analysis](sketchup-import/analysis.md)
  - [Report](sketchup-import/report.md)
- **Successor**: 별 cycle (Phase 후속 작업 또는 다른 도메인)

## mcp-sketchup-w5

- **Description**: planner Three.js Z-up 본격 전환 + 디자이너 PC E2E 에서 발견된 3개 운영 결함 (essential 필터 / pushpull face_normal / 시점 차이) 일괄 해소. W4 의 keystone (W4-3 Z-up) 완료.
- **Duration**: 2026-05-17 (단일 세션 ~4시간)
- **PRs Merged**: 5개 (#271 W5-1, #272 W5-2, #273 W5-DIAG-fix, #274 autoZoom, #275 ground plane fix)
- **Match Rate**: 88% (15/17 plan 항목, Critical 결함 0)
- **E2E**: 사용자 실제 payload 24/24 명령 성공, SketchUp bounds 0~2310mm (입력값 정확 일치)
- **핵심 학습**:
  - W5-2 wrapping group [π/2,0,0] 으로 V1 mesh 코드 1000+ 라인 0 변경 (plan 의 V2 native 재작성 우회)
  - eval_ruby 직접 진단으로 mhyrr 의 black-box 동작 파악 (pushpull = -face_normal 방향)
  - 디자이너 PC 실 E2E 가 단위 테스트만으로 발견 불가한 3개 결함 노출
- **미해결**:
  - W5-5 useMemo 어댑터 제거 (prod 1주 안정 후)
  - W5-6 feature flag 기본 활성화 (사용자 인정 후)
  - W5-7 비정사각 corner-pivot (필요 시)
- **Documents**:
  - [Plan](mcp-sketchup-w5/plan.md)
  - [Analysis](mcp-sketchup-w5/analysis.md)
  - [Report](mcp-sketchup-w5/report.md)
- **Successor**: W5-5/W5-6 별 사이클 (prod 안정 후) 또는 다른 도메인

## mcp-sketchup-w4

- **Description**: planner → SketchUp 데이터 모델 V2 전면 재설계 (Z-up corner-anchor). W3 후속 사이클. mhyrr v0.1.0 시그니처 호환 + transform_component + set_material + ENSURE_MATERIALS 도입.
- **Duration**: 2026-05-15 ~ 2026-05-16 (2일)
- **PRs Merged**: 9개 (#263 W4-1, #264 W4-2, #265 W4-3a, #266 W4-4, #267 W4-5, #268 W4-5b, #269 W4-5c, #270 W4-6)
- **Match Rate**: 78% (강행 보고서 — 90% 미달이나 E2E 운영 검증 통과)
- **E2E**: 디자이너 PC mhyrr v0.1.0 11/11 명령 성공 (1233ms, 평균 112ms)
- **Critical 갭 (H)**: 2개 — W4-3b/c Three.js Z-up 미전환, W4-5d 비정사각 corner-pivot
- **Test Coverage**: vitest 350/352 (mcp-server) + 32/32 (planner-vite)
- **LOC**: mcp-server V1 dead code 제거 -265 LOC
- **Documents**:
  - [Plan](mcp-sketchup-w4/plan.md) — `cheeky-noodling-hanrahan.md` 복사본
  - [Analysis](mcp-sketchup-w4/analysis.md)
  - [Report](mcp-sketchup-w4/report.md)
- **후속 작업**: W4-3b/c (Three.js Z-up, 9일 lead time), W4-5d (corner-pivot 1일), W4-6c (legacy 일괄 삭제, production 검증 후)
- **Successor**: 별 PDCA cycle 권장 (W4-3 Z-up 전환을 keystone 으로)

## mcp-server

- **Description**: TypeScript Express MCP/HTTP 서버 + Agent Chat 시스템. 11 MCP 도구, 19 HTTP 라우트, 미들웨어 (JWT/CORS/rate-limit/security-headers), Docker + GitHub Actions CI/CD. v1 (77%) → v2 (90%) → v3 (96%) → v4 (96% — SketchUp 빌더 W1/W1.1/W2 통합).
- **Duration**: 2026-02-01 ~ 2026-05-15 (약 3개월)
- **PDCA Cycle**: #4 (Plan/Design 은 code-comment + commit-message 기반, formal .md 없음)
- **PRs Merged (선별)**: #121 (color randomness), #248 (W1 SketchUp), #249 (W1.1 hotfix), #250 (W2 트랜잭션)
- **Match Rate**: 96% (v3 mark, v4 W2 까지 동일 유지)
- **Critical / Major / Minor**: 0 / 0 / 5 (M1/M2 W2 시점 해소, M3/M4/M5 → W3 에서 처리/deferral)
- **Test Coverage**: 27 files / 299 passing (W2 종료 시점)
- **Successor**: `mcp-sketchup-w3` (M3/M4 처리 + HTTP/SSE + E2E 추가)
- **Documents**:
  - [Analysis](mcp-server/analysis.md)
  - [Report](mcp-server/report.md)
- **Note**: Plan/Design 은 W1/W1.1/W2 모두 code-comment 와 commit-message 로 스펙 관리됨 (formal .md 없음). W3 부터 formal PDCA 문서 도입.

## mcp-sketchup-w3

- **Description**: SketchUp 빌더 W3 사이클 — E2E 검증 + HTTP/SSE 라우트 + W2 gap 잔여 항목(M3/M4) 정리 + 빌드 메트릭. W1/W1.1/W2 (PR #248~#250) 의 후속 사이클.
- **Duration**: 2026-05-15 (단일 작업 세션)
- **PRs Merged**: #251 (W3-1 bridge cleanup), #252 (W3-2 HTTP routes), #253 (W3-3 SSE stream), #254 (W3-4 E2E script)
- **Match Rate**: 97% (W2 baseline 96% → +1pt)
- **Critical / Major / Minor**: 0 / 0 / 3 (all documentation-level)
- **Test Coverage**: 28 files / 325 passing (W2 27/299 → +1/+26)
- **Predecessor**: `mcp-server` cycle (W1/W1.1/W2, Match 96%)
- **Documents**:
  - [Plan](mcp-sketchup-w3/plan.md)
  - [Design](mcp-sketchup-w3/design.md)
  - [Analysis](mcp-sketchup-w3/analysis.md)
  - [Report](mcp-sketchup-w3/report.md)
- **Highlights**:
  - 4 PR 시리즈 분할 (회귀 0 — 각 PR 후 vitest 모두 통과)
  - SSE 6 이벤트 + 클라이언트 단절 시 자동 `ABORT_OP` 발사 (트랜잭션 안전)
  - Express 5 호환 정확성 수정 (`req.on('close')` → `res.on('close')` + `mainDone` 플래그)
  - W2 `eval_ruby` allowlist invariant 유지
- **Outstanding (W4 후보)**:
  - N1 에러 코드 prefix 일관화 (Design 갱신)
  - N2 `SKETCHUP_BUILD_ABORTED 499` SSE 부적합 (Design note)
  - N3 `SKETCHUP_BRIDGE_*` env var 미구현 (Plan 항목 제거 or fallback 추가)
  - 디자이너 PC 실 mhyrr E2E 수동 검증 (별도 환경 필요)
