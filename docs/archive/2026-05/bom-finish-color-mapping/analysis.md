# bom-finish-color-mapping (W7) PDCA Check (Gap Analysis)

- **분석 일시**: 2026-05-24
- **Plan**: `C:\Users\hchan\.claude\plans\bom-finish-color-mapping.md` (plan-mode 산출물, 비표준 위치)
- **구현 PR**: #295 W7-1 / #296 W7-2 / #297 W7-3 / #298 W7-4 (모두 머지)
- **Match Rate**: **0.98** (W8-1 #299 머지 후 갱신, 2026-05-24)
- **종합 등급**: **A**

## Summary

| 항목 | Match Rate | 등급 |
|------|-----------|------|
| W7-1 자재 코드 매트릭스 | 1.00 | A |
| W7-2 양방향 sync | 0.95 | A |
| W7-3 BOM 산출 통합 | 1.00 | A |
| W7-4 단가 매트릭스 + W8-1 tool wiring | 1.00 | A (Major Gap 해소) |
| 테스트 커버리지 | 0.85 | A- (mcp-server 16, detaildesign node sanity) |
| 회귀 영향 | 1.00 | A (default MDF fallback) |
| **종합** | **0.98** | **A** |

## W8-1 후속 PR (#299, Major Gap 해소)

`mcp-server/src/tools/bom-rules.tool.ts` 에 단가 조회 operation 2개 추가:
- `price_door`: finishCode → ₩/m² 조회
- `door_pricing_matrix`: 49 조합 전체 매트릭스 반환

W7-4 의 "BOM tool 자재 코드 인식 / 단가 산출 통합" 항목 달성.

## Plan vs 구현 항목별 표

| PR | Plan 항목 | 구현 위치 | 상태 |
|----|----------|----------|------|
| W7-1 | DOOR_FINISH_CATALOG (7) | bom-finish-color.js L28-36 | Match |
| W7-1 | DOOR_COLOR_CATALOG (7) | bom-finish-color.js L42-50 | Match |
| W7-1 | FINISH_COLOR_MATRIX 49 조합 | getFinishColorCode + buildFullMatrix | Match |
| W7-1 | 명명 {FINISH-3}{COLOR-3}-{TONE} | TONE_SUFFIX (M/G/single) | Match |
| W7-1 | 49 조합 vitest 테스트 | node sanity 만 (vitest 환경 미설정) | Partial |
| W7-2 | postMessage V2_MODULES_CHANGE | App.tsx useEffect | Match |
| W7-2 | itemId 라우팅 | App.tsx itemIdParam + ui-step1.js iframe src param | Match |
| W7-2 | item.modules 갱신 | ui-step1.js message listener | Match |
| W7-2 | 무한 루프 방지 (origin guard) | silent update + _syncPlannerState 미호출 (다층 안전망) | Match+ |
| W7-3 | add() 시그니처 mod 인자 | extractors.js L75 | Match |
| W7-3 | doorMatFor 헬퍼 | extractors.js L105-116 | Match |
| W7-3 | 13 도어 호출 변경 | **14 호출** (12 도어 + 2 서랍도어) — Plan +1 | Match+ |
| W7-3 | finishCode 필드 추가 | BOM entry 에 finishCode 출력 | Match+ |
| W7-3 | bom-finish-color.js script tag | detaildesign.html L250 | Match |
| W7-3 | BOM snapshot test | node sanity 만 — detaildesign vitest 미설정 | Partial |
| W7-4 | FINISH_BASE_PRICE 7 키 | bom-rules.defaults.ts | Match |
| W7-4 | COLOR_PRICE_MULTIPLIER 7 키 | bom-rules.defaults.ts | Match |
| W7-4 | getDoorFinishPrice (49 조합) | ₩13,300 ~ ₩41,800 | Match |
| W7-4 | buildDoorPricingMatrix | export 완료 | Match |
| W7-4 | 16 단위 케이스 | bom-rules.defaults.test.ts | Match |
| W7-4 | **BOM tool 자재 코드 인식** | **미구현** — bom-rules.tool.ts 변경 X | **Miss** |
| W7-4 | **BOM tool 단가 산출 통합** | **미구현** | **Miss** |

## Gap 분류

### Critical Gap (0건)
없음. 모든 핵심 데이터 플로우 (UI → postMessage → item.modules → extractors → BOM entry.finishCode) 완결.

### Major Gap (1건)
- **W7-4 BOM tool 통합 미완**: `mcp-server/src/tools/bom-rules.tool.ts` 가 `getDoorFinishPrice` 호출 안 함. BOM 산출 시점에 자재 코드 → 단가 변환이 자동 적용되지 않음. 매트릭스/헬퍼만 도입, 후속 cycle 에서 wiring 필요.

### Minor Gap (3건)
1. **테스트 비대칭**: mcp-server (vitest 16건) 만 자동화, detaildesign (bom-finish-color.js + extractors.js) 는 node sanity 만. detaildesign vitest 환경 미설정.
2. **도어 호출 카운트 오차** (positive): Plan = 13, 구현 = 14 (서랍도어 추가 1건 — Plan 보다 정확).
3. **양방향 sync 무한 루프 방지가 Plan 보다 약**: Plan = "origin guard", 구현 = "silent update + _syncPlannerState 미호출" (postMessage origin 검증 없음, `*` target). 신뢰 환경에선 안전, 보안 관점 origin allow-list 권장.

## 누락 / 추가 / 변경

### 누락 (Plan O, 구현 X)
- BOM tool wiring (`bom-rules.tool.ts` 단가 자동 계산) — W7-4 절반
- detaildesign vitest 환경 (W7-1/W7-3 자동 테스트)
- postMessage origin 검증

### 추가 (Plan X, 구현 O)
- BOM entry `finishCode` 출력 필드 (Plan 명시 X, Excel column 갱신 위해 사전 도입)
- `heightOverride` / `doorCount` / `drawerCount` 추가 sync 필드 (finish/color 외 V2 정합성 보강)

### 변경 (Plan ≠ 구현)
- 단가 범위: Plan 추정 ₩9,500~₩41,800 → 구현 ₩13,300~₩41,800 (MFB-WHT 0.95×14,000)
- 무한 루프 방지 메커니즘: origin guard → silent update (다층 안전망 우회)

## 회귀 영향

- **planner-vite**: 88/88 vitest 통과 (변경 없음, useEffect 추가만)
- **mcp-server**: +16 신규 (단가 계산), 기존 회귀 0
- **detaildesign**: default MDF fallback (`window.DadamBomFinishColor` 미로드 또는 finish/color 미설정 시 기존 'MDF, 18mm, 4면' → 기존 BOM 회귀 0)

## 후속 cycle 권장 (W8 후보)

1. **W8-1 BOM tool wiring** (0.5일, **High**) — bom-rules.tool.ts 에 getDoorFinishPrice 호출 통합 → 단가 자동 계산 → BOM 합계 반영. W7-4 누락 절반 완성.
2. **W8-2 BOM Excel column 갱신** (0.5일) — excel-export.js 에 finishCode/단가 column 추가.
3. **W8-3 detaildesign vitest 환경** (0.5일) — bom-finish-color 49 조합 + extractors BOM snapshot 자동화.
4. **W8-4 postMessage origin allow-list** (0.25일, Minor) — `*` → 명시적 origin 제한.
5. **W9 단가 자동 적용 cycle** (별 cycle, Plan Out of Scope 명시) — 자재 마트 가격 변동 시 FINISH_BASE_PRICE 동적 업데이트.

## Critical Files

- `C:\Users\hchan\dadamagent\js\detaildesign\bom-finish-color.js` (W7-1 + W7-4 mirror)
- `C:\Users\hchan\dadamagent\planner-vite\src\App.tsx` (W7-2)
- `C:\Users\hchan\dadamagent\js\detaildesign\ui-step1.js` (W7-2 + W7-3)
- `C:\Users\hchan\dadamagent\js\detaildesign\extractors.js` (W7-3, 14 도어 호출)
- `C:\Users\hchan\dadamagent\detaildesign.html` (W7-3 script tag)
- `C:\Users\hchan\dadamagent\mcp-server\src\config\bom-rules.defaults.ts` (W7-4)
- `C:\Users\hchan\dadamagent\mcp-server\tests\bom-rules.defaults.test.ts` (W7-4, 16 케이스)

## 결론

**Match Rate 0.92, A- 등급**. 핵심 데이터 흐름 완결 (UI → postMessage → BOM entry.finishCode). 단가 계산은 헬퍼/단위 테스트까지만 — 즉시 BOM 산출에 반영되려면 **W8-1 (BOM tool wiring)** 후속 필수. 회귀 0 확인.

PDCA 다음 단계: Match 90% 초과로 **`/pdca report bom-finish-color-mapping` 진입 가능** (Major Gap 1건은 W8-1 별 cycle 로 deferral 명시). 또는 W8-1 즉시 진행으로 Major Gap 해소 후 100% 달성.
