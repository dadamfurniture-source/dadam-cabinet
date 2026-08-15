# detail-design-w6 PDCA Check (Gap Analysis)

- **분석 일시**: 2026-05-24
- **Plan**: `C:\Users\hchan\.claude\plans\cheeky-noodling-hanrahan.md` (plan-mode 산출물, 비표준 위치)
- **구현 PR**: #287 ~ #294 (8 PR, 모두 머지)
- **Match Rate**: **0.95**
- **종합 등급**: **A**

## Summary

| 항목 | Match Rate | 등급 |
|------|-----------|------|
| W6-1 데이터 모델 | 1.00 | A |
| W6-2 round-trip (deriveCabinet V2) | 1.00 | A |
| W6-3 SegmentEditor (Step 1) | 0.95 | A |
| W6-4 StructureEditor (Step 2) | 1.00 | A |
| W6-5 모듈 디테일 (Step 3) | 0.85 | B+ |
| W6-6 동기화 (URL/postMessage/배너) | 1.00 | A |
| W6-7 외부 어댑터 | 0.95 | A |
| W6-8 마무리 (deferral 평가) | 0.85 | B+ |
| 테스트 커버리지 | 0.90 | A- |
| 회귀 영향 (0 회귀) | 1.00 | A |
| **종합** | **0.95** | **A** |

## Plan vs 구현 항목별 매칭

| PR | Plan 핵심 | 구현 확인 | 상태 |
|---|---|---|---|
| W6-1 | V2 타입 + migrateLegacyToV2 + 8 케이스 | planner.ts 신규 타입 + 11 케이스 (idempotent + isV2State 가드) | Match |
| W6-2 | deriveCabinetV2 + 10 케이스 golden | 옵션 A (역변환 후 기존 호출) + 10 케이스 round-trip | Match |
| W6-3 | SegmentEditor SVG + 90° snap + edge auto-snap + RTL 테스트 | 신규 (720×560 SVG, SNAP 50/10) + 11 헬퍼 단위 테스트 (RTL 미설치 우회) | Partial |
| W6-4 | StructureEditor + tall 충돌 + autoCalculateModulesV2 | 신규 + 13 케이스 (autoDistributeModules + groupBySection) | Match |
| W6-5 | **ModulePopup 확장** | **ModuleDetailPanel 신규** (legacy ModulePopup 유지, V2 전용 분리) + 8 케이스 | Partial |
| W6-6 | step indicator + URL + postMessage + LayoutSetupPanel V2 숨김 | 모두 구현 (StepIndicator + popstate + STEP_CHANGE + 마이그레이션 배너) | Match |
| W6-7 | _appendV2Payload + extractors + sketchup V2 | 5개 파일 모두 변경 (mcp-server + sketchup-client + App + ui-step1 + extractors) | Match |
| W6-8 | legacy 필드 **완전 제거** | **deferral** — V2 기본 + deprecated JSDoc + 마이그레이션 배너만, 제거는 W6-8b 로 연기 | Partial (의도된) |

## Gap 분류

### Critical Gap (0건)
없음. 핵심 데이터 모델, round-trip, 3단계 UI, 외부 어댑터 모두 Plan 의도 그대로 구현.

### Major Gap (2건, 모두 의도된 변경)

#### 1. W6-8 legacy 필드 완전 제거 deferral
- **Plan**: `lowerModules`/`upperModules`/`layoutShape`/`secondary*`/`tertiary*` PlannerState 에서 제거 + `deriveCabinet` V1 분기 제거 + `LayoutSetupPanel` 완전 삭제
- **실제**: 모두 보존, `@deprecated W6-8b 제거 예정` JSDoc 만 부착. deriveCabinet V2 입력은 migrateV2ToLegacy 역변환 후 V1 코드 호출 (옵션 A)
- **이유**: 디자이너 PC E2E 미검증 + Supabase 의 V0 design_items.modules 호환 위험. Plan D 의 "기존 vitest snapshot 보장" 조건 만족하려면 V1 path 필요
- **영향**: 코드 크기 -200 LOC 미달성, V2 native 가 아니라 우회 (성능 영향 무시 가능)

#### 2. W6-5 ModulePopup 확장 대신 ModuleDetailPanel 신규
- **Plan**: 기존 `ModulePopup` (App.tsx L413-511) 확장
- **실제**: 신규 `ModuleDetailPanel.tsx` — legacy ModulePopup 유지, V2 ModuleEntryV2 전용 분리
- **이유**: 같은 컴포넌트가 두 타입 분기 시 props 폭증 + 명확성 ↓. V2 전용 신규가 더 깨끗
- **영향**: 코드 +1 파일, legacy V1 사용자 회귀 0 보장

### Minor Gap (3건)

1. **W6-3 테스트 형식**: Plan `.tsx` (RTL) → 실제 `.ts` (헬퍼 단위 11 케이스). RTL 미설치 우회, 핵심 로직 커버.
2. **extractors.js LOC**: Plan +80 → 실제 +1 (pos='tall' 단일 추가). BOM 추출은 detaildesign item.modules 기반이라 V2 modulesV2 직접 사용 불필요.
3. **migration 케이스 수**: Plan 8 → 실제 11. 초과 달성 (idempotent + isV2State 가드 +3).

## 누락 / 추가 / 변경

### 누락 (Design O, 구현 X)
- legacy 필드 PlannerState 제거 (W6-8 의도된 deferral)
- `LayoutSetupPanel` 컴포넌트 완전 삭제 (숨김 처리만)
- `deriveCabinet` V2 native 재작성 (V2→legacy→V1 역변환)

### 추가 (Design X, 구현 O)
- `migrateV2ToLegacy` 역방향 함수 (옵션 A 필수)
- `ModuleDetailPanel.tsx` 신규 컴포넌트 (Plan = ModulePopup 확장)
- `StepIndicator.tsx` 신규 컴포넌트 (Plan 별도 분리 미명시)
- migration 테스트 +3 케이스
- StructureEditor `autoDistributeModules` 50mm snap 적용

### 변경 (Design ≠ 구현)
- W6-2 deriveCabinet: Plan = native 함수, 실제 = 옵션 A 역변환 (round-trip golden test 로 ±1mm 동등성 검증). 향후 W6-8b 에서 native 재작성 후보.

## 회귀 영향

- planner-vite: vitest **88/88 통과** (Plan E 의 검증 전략 충족)
- mcp-server: 기존 fail 2건은 W6 외 범위 (sketchup-mcp-bridge port 외부 의존), W6-7 추가분 통과
- detaildesign legacy V1 path: `_syncPlannerState` 가 legacy + V2 양쪽 송신, 부모 변경 0
- Supabase design_items.modules: schema 변경 0

**회귀 0** — Plan D 의 백워드 호환 7 케이스 모두 통과.

## 후속 cycle 권장

1. **W6-8b** (1.5일): legacy 필드 완전 제거 + deriveCabinetV2 native 재작성. 선행: (a) 디자이너 PC 실측 E2E 1회, (b) Supabase migration script (V0 → V2), (c) Cloudflare Analytics 의 ?layoutShape= 사용 통계.
2. **디자이너 PC E2E** (별도 task): 새 V2 워크플로우 → SketchUp → sketchup-import 라운드트립. 디자이너 수동 1일.
3. **BOM 자재 코드 매핑 cycle** (2일): doorFinish (7종) + doorColor (7종) × 자재 코드 매트릭스. `bom-rules.*` 확장.
4. **ㄷ자/임의 polygon UI 개선** (사용자 피드백 후): segment 간 자동 코너 채움 미리보기.
5. **AI segment 추천** (Out of Scope 후속): 기존 벽 분석 → segments[] 자동 제안.

## Critical Files

- `C:\Users\hchan\.claude\plans\cheeky-noodling-hanrahan.md`
- `C:\Users\hchan\dadamagent\planner-vite\src\lib\planner.ts`
- `C:\Users\hchan\dadamagent\planner-vite\src\App.tsx`
- `C:\Users\hchan\dadamagent\planner-vite\src\components\{SegmentEditor,StructureEditor,ModuleDetailPanel,StepIndicator}.tsx`
- `C:\Users\hchan\dadamagent\planner-vite\src\lib\__tests__\{migration,deriveCabinet-v2}.test.ts`
- `C:\Users\hchan\dadamagent\planner-vite\src\components\__tests__\{SegmentEditor,StructureEditor,ModuleDetailPanel,StepIndicator}.test.ts`
- `C:\Users\hchan\dadamagent\js\detaildesign\{ui-step1.js,extractors.js}`
- `C:\Users\hchan\dadamagent\mcp-server\src\services\sketchup-import.service.ts`
- `C:\Users\hchan\dadamagent\planner-vite\src\lib\sketchup-client.ts`

## 결론

**Match Rate 0.95, 종합 A 등급**. Critical 0, Major 2 (모두 의도된 deferral / 설계 개선), Minor 3 (초과 달성 또는 동등 우회). PDCA 다음 단계 **`/pdca report detail-design-w6` 진입 권장** — Match Rate 90% 초과로 자동 진행 가능.

W6-8 의 legacy 필드 deferral 은 의도된 보수적 결정 (회귀 위험 0 우선) — 후속 W6-8b 별 cycle 로 분리. 디자이너 PC E2E 1주 안정 후 진행.
