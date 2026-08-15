# planner-ui-redesign-w8 PDCA Check (Gap Analysis)

- **분석 일시**: 2026-05-24
- **Plan**: `C:\Users\hchan\.claude\plans\cheeky-noodling-hanrahan.md` (W8-2 → W8-5 두 차례 작성, W8-3/4/6/7/8 은 plan 외 진행)
- **구현 PR**: #300 (W8-2) ~ #306 (W8-8), 총 7개 (모두 머지)
- **Match Rate**: **0.92**
- **종합 등급**: **A**

## Summary

| PR | 작업 | Match | 등급 |
|----|------|-------|------|
| #300 W8-2 | 메인 화면 재구성 (Step inline + Legacy 제거 + View toggle) | 1.00 | A |
| #301 W8-3 | 좌우 여백 최소화 (fullscreen) | 1.00 | A |
| #302 W8-4 | UI 단순화 + 화면 꽉 채우기 + Step 2 W/H/D 입력 | 0.95 | A |
| #303 W8-5 | SketchUp 3-column shell + collapsible panels | 1.00 | A |
| #304 W8-6 | LeftToolbar counts badge sync | 1.00 | A |
| #305 W8-7 | RightPanel 4 sections 편집 기능 | 1.00 | A |
| #306 W8-8 | 모바일/태블릿 layout (≤768px) | 0.90 | A- |
| 테스트 커버리지 | 88/88 유지 (W6 88 → W8 88, +0 신규 컴포넌트 unit test 없음) | 0.70 | B |
| 회귀 영향 | 0 (모든 단계 vitest + tsc 통과) | 1.00 | A |
| **종합** | | **0.92** | **A** |

## Plan vs 구현 매칭

### W8-2 단일 PR vs 분할 (W8-2-1/2/3)
- **Plan**: 3 단계 분할 (W8-2-1 step inline, W8-2-2 Legacy 제거, W8-2-3 View toggle)
- **실제**: 단일 PR (#300) 통합. 회귀 0 + 일관된 변경.
- **상태**: Match+ (Plan 보다 효율적)

### W8-5 plan vs 구현
- Plan: HTML mockup (W8-5-1) → 컴포넌트 추출 (W8-5-2) → JSX 재구성 (W8-5-3) → 토글 + persist (W8-5-4) 4 단계
- 실제: W8-5-1 (mockup, 사용자 확인) + W8-5-2/3/4 통합 PR (#303)
- 상태: Match+ (사용자 mockup 확인 후 통합 진행)

### W8-3/4/6/7/8 (Plan 외 진행)
- Plan 없이 사용자 요구 → 직접 구현 → PR 머지
- 빠른 반복 (각 PR 30분~1시간)
- Match 측정 어려움 (Plan 부재) → "사용자 요구 충족도" 로 평가:
  - W8-3 좌우 여백 최소화: ✅ 완료
  - W8-4 4 요구 (현장실측/Layout/템플릿 삭제 + 가구배치 W/H/D + 화면 꽉): ✅ 모두 완료
  - W8-6 counts badge: ✅ 완료
  - W8-7 RightPanel 편집: ✅ 완료
  - W8-8 모바일 layout: ✅ 완료 (자동 테스트 부재)

## Gap 분류

### Critical Gap: **0건**

### Major Gap: **0건**

### Minor Gap: **3건**

1. **신규 컴포넌트 unit test 부재** (W8-5 LeftToolbar/RightPanel, W8-8 모바일 분기)
   - 현재: 88/88 (W6 cycle 시 추가된 케이스만)
   - 권장: LeftToolbar/RightPanel/모바일 분기 테스트 추가 (W9 후속)

2. **W8-5 mockup 의 swatch UI 미구현** (도어 색상)
   - mockup: 시각 swatch (4 색상 색칠 사각형)
   - 실제: select drop-down
   - 이유: 7 색상 + select 가 키보드 접근성 ↑

3. **단축키 안내 부재**
   - L/R 키만 있음 (W8-5)
   - 사용자가 모를 수 있음
   - 권장: Footer toast 또는 ? 키 모달 (W9-1 후속)

## 추가 / 변경

### 추가 (Plan 외)
- **W8-3** 좌우 여백 최소화 (사용자 즉시 피드백)
- **W8-4** detaildesign UI 단순화 (현장실측 119 LOC 삭제)
- **W8-6** counts badge sync (사용자 요구)
- **W8-7** RightPanel 편집 (사용자 요구)
- **W8-8** 모바일 layout (사용자 요구)

### 변경 (Plan ≠ 구현)
- W8-2 단일 PR (Plan 3 단계 분할 vs 실제 통합) — 회귀 0 으로 안전
- W8-5 W8-5-2/3/4 통합 (Plan 4 단계 vs 실제 mockup + 통합)

## 회귀 영향

- planner-vite: **88/88 통과** (7 PR 모두)
- planner-vite tsc + Vite build: 모두 클린
- mcp-server: 기존 2 fail (sketchup-mcp-bridge port, W8 무관) + 신규 변경 0
- 외부 detaildesign: 변경 영향 0 (W8-4 의 ui-step1.js 변경 외 무영향)
- 자동 V2 마이그레이션 (W6-7) 안전망 그대로 — legacy V1 입력 호환

## 누적 LOC 변화

| 파일 | W8 시작 | W8 종료 | 차이 |
|------|---------|---------|------|
| `App.tsx` | ~1500 | ~1700 | **+200** |
| `LeftToolbar.tsx` | 0 | 130 | **+130 신규** |
| `RightPanel.tsx` | 0 | 460 | **+460 신규** |
| `base.css` | 65 | 65 | 0 (값만 변경) |
| `ui-step1.js` | ~2700 | ~2580 | **-120** (현장 실측 삭제) |
| `extractors.js` | 1127 | 1127 | 0 |

## 후속 cycle 권장

| 우선순위 | cycle | 분량 |
|---------|-------|------|
| **High** | W9-1: 단축키 확장 (1/2/3/Space/V/Esc/Delete) + 도움말 footer | 1시간 |
| **High** | W9-2: 신규 컴포넌트 unit test (LeftToolbar/RightPanel/모바일 분기) | 2시간 |
| **Medium** | W9-3: App.tsx 분할 (TopBar/BottomBar/StepRouter/Canvas3D 컴포넌트 추출) | 4시간 |
| **Medium** | W9-4: detaildesign vitest 환경 도입 | 1일 |
| **Low** | W9-5: swatch UI (도어 색상 시각 선택) | 30분 |
| **Low** | W6-8b: legacy V1 코드 완전 제거 (production 1주 안정 후) | 1.5일 |

## Critical Files

- `C:\Users\hchan\dadamagent\planner-vite\src\App.tsx` (W8 동안 +200 LOC, ~1700)
- `C:\Users\hchan\dadamagent\planner-vite\src\components\LeftToolbar.tsx` (신규 130 LOC)
- `C:\Users\hchan\dadamagent\planner-vite\src\components\RightPanel.tsx` (신규 460 LOC)
- `C:\Users\hchan\dadamagent\css\detaildesign\base.css` (W8-4 padding 변경)
- `C:\Users\hchan\dadamagent\js\detaildesign\ui-step1.js` (W8-4 현장 실측 삭제 + W8-5 ADD_CATEGORY listener + W8-6 broadcast)
- `C:\Users\hchan\dadamagent\tmp\layout-mockup.html` (W8-5-1 사용자 확인용)

## 결론

**Match Rate 0.92, A 등급**. Critical/Major Gap 0건, Minor 3건 모두 후속 cycle 로 deferral 가능. 7 PR 단일 세션 + 회귀 0 + 사용자 의도 반영. 다음 cycle 은 **refactor 우선** (App.tsx 분할 + 신규 컴포넌트 테스트) 권장.

PDCA 다음: `/pdca report planner-ui-redesign-w8` → `/pdca archive`.
