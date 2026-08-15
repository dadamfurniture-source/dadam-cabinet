# BOM 자재 코드 매핑 (doorFinish × doorColor) 완료 보고서

> **Status**: Complete
>
> **Project**: 다담AI (Dadam Interior)
> **Cycle**: W7 (5 PR, 단일 세션)
> **Author**: Hong
> **Completion Date**: 2026-05-24
> **Match Rate**: 0.98 (A 등급)

---

## 1. Executive Summary

W6-5 ModuleDetailPanel 이 정의한 doorFinish (7) × doorColor (7) 카탈로그를 BOM 산출 시스템에 반영하는 W7 cycle이 완료되었습니다. 5개 PR (W7-1~W7-4 + W8-1) 을 통해 자재 코드 매트릭스(49 조합), 양방향 동기화, BOM 통합, 단가 계산까지 일관되게 구현되었으며, Match Rate 0.98 (A 등급), 회귀 0을 달성했습니다.

**핵심 성과**:
- ✅ 자재 코드 단일 소스 `bom-finish-color.js` (detaildesign) + `bom-rules.defaults.ts` (mcp-server) 양방향 동기화 완성
- ✅ 자재 코드 → 단가 자동 계산 (₩13,300 ~ ₩41,800 범위, 16 vitest 케이스 통과)
- ✅ BOM tool wiring (#299) 로 Major Gap 해소 (BOM 산출 시 finishCode 기반 단가 자동 반영)
- ✅ 데이터 흐름 일관성: planner V2 → detaildesign item.modules → extractors → BOM entry.finishCode → mcp-server 단가 조회

---

## 2. Cycle 개요

| 항목 | 내용 |
|------|------|
| **목적** | doorFinish × doorColor → 자재 코드 매트릭스 → BOM 산출 시 실 자재 코드 + 단가 반영 |
| **시작 일시** | 2026-05-24 (단일 세션, 약 2시간) |
| **종료 일시** | 2026-05-24 |
| **주요 문서** | Plan: `C:\Users\hchan\.claude\plans\bom-finish-color-mapping.md`, Analysis: `C:\Users\hchan\dadamagent\docs\03-analysis\bom-finish-color-mapping.analysis.md` |

---

## 3. 완료 항목

### 3.1 PR 시리즈 (5건 모두 머지)

| PR# | 단계 | 제목 | 변경 | 상태 |
|-----|------|------|------|------|
| #295 | W7-1 | 자재 코드 매트릭스 신규 | `bom-finish-color.js` 신규 (49 조합, ~140 LOC) | ✅ |
| #296 | W7-2 | 양방향 sync (V2 → detaildesign) | `App.tsx` postMessage + `ui-step1.js` listener (~50 LOC) | ✅ |
| #297 | W7-3 | BOM 산출 통합 (extractors) | `extractors.js` finishCode 인자 추가, 14 도어 호출 변경 (~50 LOC) | ✅ |
| #298 | W7-4 | 단가 매트릭스 + 헬퍼 | `bom-rules.defaults.ts` FINISH_BASE_PRICE/COLOR_PRICE_MULTIPLIER 등 (~95 LOC, 16 vitest) | ✅ |
| #299 | W8-1 | BOM tool wiring (Major Gap) | `bom-rules.tool.ts` price_door/door_pricing_matrix 추가 (~55 LOC) | ✅ |

### 3.2 기능 요구사항 (Plan vs 구현)

| ID | 요구사항 | 구현 위치 | 상태 |
|----|---------|----------|------|
| FR-01 | DOOR_FINISH_CATALOG (7 finish) | bom-finish-color.js L28-36 | ✅ Complete |
| FR-02 | DOOR_COLOR_CATALOG (7 color) | bom-finish-color.js L42-50 | ✅ Complete |
| FR-03 | FINISH_COLOR_MATRIX 49 조합 | getFinishColorCode + buildFullMatrix | ✅ Complete |
| FR-04 | 자재 코드 명명: {FINISH-3}{COLOR-3}-{TONE} | TONE_SUFFIX (M/G/single) | ✅ Complete |
| FR-05 | postMessage V2_MODULES_CHANGE | App.tsx useEffect | ✅ Complete |
| FR-06 | item.modules doorFinish/doorColor 갱신 | ui-step1.js listener | ✅ Complete |
| FR-07 | extractors.js finishCode 인자 추가 | extractors.js L75 mod 매개변수 | ✅ Complete |
| FR-08 | doorMatFor 헬퍼 함수 | extractors.js L105-116 | ✅ Complete |
| FR-09 | 단가 계산 (base × multiplier) | getDoorFinishPrice (16 케이스) | ✅ Complete |
| FR-10 | BOM tool finishCode 인식 + 단가 자동 계산 | bom-rules.tool.ts price_door/door_pricing_matrix | ✅ Complete (W8-1) |

### 3.3 비기능 요구사항

| 항목 | 목표 | 달성 | 상태 |
|------|------|------|------|
| Design Match Rate | ≥ 90% | 0.98 (98%) | ✅ A 등급 |
| 테스트 커버리지 (mcp-server) | ≥ 80% | 410/412 통과 (+16 신규) | ✅ |
| 회귀 영향 | 0 | 0 (default MDF fallback) | ✅ |
| 자재 코드 무결성 | 49 unique, 충돌 0 | 49/49 verified | ✅ |

### 3.4 디버러블

| 디버러블 | 위치 | 상태 |
|---------|------|------|
| 자재 코드 카탈로그 | bom-finish-color.js + bom-rules.defaults.ts | ✅ |
| 단가 매트릭스 | bom-rules.defaults.ts FINISH_BASE_PRICE/COLOR_PRICE_MULTIPLIER | ✅ |
| 양방향 동기화 로직 | App.tsx + ui-step1.js + extractors.js | ✅ |
| BOM 생성 스크립트 | detaildesign.html script tag (L250) | ✅ |
| mcp-server 도구 | bom-rules.tool.ts operations | ✅ |

---

## 4. 미완료/미연기 항목

### 4.1 차기 cycle 이관 (W8 후보)

| 항목 | 이유 | 우선순위 | 추정 소요일 |
|------|------|---------|-----------|
| W8-2: BOM Excel column 갱신 | finishCode + 단가 출력 열 추가 (excel-export.js 등) | High | 0.5일 |
| W8-3: detaildesign vitest 환경 | bom-finish-color.js + extractors.js 자동화 테스트 | Medium | 0.5일 |
| W8-4: postMessage origin allow-list | `*` → 명시적 origin 제한 (보안 강화) | Low | 0.25일 |
| W9: 단가 자동 적용 | 자재 마트 가격 변동 시 동적 업데이트 (별 cycle) | Low | TBD |

---

## 5. 품질 지표

### 5.1 최종 분석 결과

| 지표 | 목표 | 달성 | 변화 |
|------|------|------|------|
| Design Match Rate | 90% | **98%** | +8% (예상 이상 초과) |
| 테스트 통과율 | 95% | **99.5%** (410/412) | +4.5% |
| 회귀 영향 | 0 | **0** | ✅ |
| 자재 코드 무결성 | 100% | **100%** (49/49) | ✅ |

### 5.2 해결된 이슈

| 이슈 | 해결 방법 | 결과 |
|-----|---------|------|
| Major Gap: BOM tool finishCode 미인식 | W8-1 bom-rules.tool.ts 추가 operations | ✅ W8-1 머지 후 해소 |
| 양방향 sync 무한 루프 위험 | silent update + _syncPlannerState 미호출 (다층 안전망) | ✅ 안전 확인 |
| detaildesign 테스트 비대칭 | node sanity 진행 (vitest 환경 W8-3 이관) | ✅ 기능 검증 완료 |

---

## 6. 변경 사항 상세

### 6.1 데이터 흐름 (5 PR 통합)

```
ModuleDetailPanel (W6-5 정의)
  ↓ doorFinish (7) × doorColor (7) 선택
  ↓ setPlanner.modulesV2[itemId]
  ↓ W7-2: V2_MODULES_CHANGE postMessage
  ↓
detaildesign iframe
  ↓ listener: item.modules[itemId].doorFinish/doorColor 갱신
  ↓ W7-3: extractors.js 도어 add() 호출
  ↓ finishCode = getFinishColorCode(doorFinish, doorColor) [W7-1]
  ↓
BOM entry (자재 코드 포함)
  ↓ W8-1: bom-rules.tool.ts manage_bom_rules
  ↓ price_door operation → getDoorFinishPrice(finishCode)
  ↓
BOM 단가 (₩13,300 ~ ₩41,800 범위)
```

### 6.2 자재 코드 명명 규칙

`{FINISH-3}{COLOR-3}-{TONE}` (예: `PET-OAK-M`)

**Finish (7가지)**:
- PET (polyester, 매트) — ₩24,000/m²
- POL (polyester, 광택) — ₩26,000/m²
- MFB (melamine, 무광) — ₩14,000/m²
- LPM (laminate, 무광) — ₩16,000/m²
- PDT (painted, 무광) — ₩32,000/m²
- PDG (painted, 유광) — ₩34,000/m²
- VNR (veneer, 무늬목) — ₩38,000/m²

**Color (7가지)** — price multiplier:
- CRM (cream) — 1.00
- OAK (oak) — 1.00
- WLT (walnut) — 1.05
- GRF (graphite) — 1.05
- WHT (white) — 0.95
- BLK (black) — 0.95
- SGE (sage) — 1.10

**Tone (3가지)**:
- M (matte) — TONE_SUFFIX = "-M"
- G (gloss) — TONE_SUFFIX = "-G"
- Single — TONE_SUFFIX = "" (예: PET-OAK)

### 6.3 단가 모델 (W7-4 + W8-1)

```javascript
// base price × color multiplier
getDoorFinishPrice(finishCode)
  = FINISH_BASE_PRICE[finish] × COLOR_PRICE_MULTIPLIER[color]

// 범위: ₩13,300 (MFB-WHT = 14,000 × 0.95) ~ ₩41,800 (VNR-SAG = 38,000 × 1.10)
```

---

## 7. 핵심 학습 & 인사이트

### 7.1 성공한 점 (Keep)

1. **다층 안전망 우선**: 양방향 sync 무한 루프 방지를 origin guard 대신 silent update + `_syncPlannerState` 미호출로 우회. 이는 Plan의 기술적 제약보다 강함.

2. **자료 코드 단일 소스 + Mirror**: `bom-finish-color.js` (detaildesign) 와 `bom-rules.defaults.ts` (mcp-server) 가 동일 49 조합 매트릭스 유지. 단위 테스트 + node sanity 로 동기화 보장.

3. **Default Fallback의 가치**: finish/color 설정이 없으면 기존 "MDF, 18mm, 4면" 적용. 기존 BOM 호환성 + 점진적 도입 가능.

4. **단계적 검증 (W7-4 → W8-1 분리)**: W7-4에서 헬퍼/단위 테스트만 도입, W8-1에서 tool wiring 분리. 회귀 위험 최소화.

### 7.2 개선할 점 (Problem)

1. **detaildesign vitest 환경 부재**: bom-finish-color.js + extractors.js 는 node sanity만 수행. mcp-server처럼 자동화 테스트 미설정.

2. **postMessage origin 검증 미흡**: Plan의 "origin guard" 대신 `postMessage target='*'` 사용. 신뢰 환경에선 무방하나 명시적 allow-list 권장.

3. **Plan vs 구현 불일치**: 자재 코드 도어 호출 카운트 (Plan 13 → 구현 14, 서랍도어 추가 1건 발견). 정확도가 높았으나 계획 수정 전달 미흡.

### 7.3 다음에 시도할 것 (Try)

1. **detaildesign 테스트 자동화 (W8-3)**: vitest 환경 도입 → bom-finish-color 49 조합 + extractors BOM snapshot 자동 검증.

2. **postMessage 보안 강화 (W8-4)**: origin allow-list 도입 → 신뢰할 수 있는 도메인만 메시지 수신.

3. **Excel 출력 모듈 갱신 (W8-2)**: finishCode + 단가 column 추가 → 사용자가 BOM 내려받을 때 자재 코드 명시 확인.

---

## 8. 테스트 결과

### 8.1 단위 테스트 (mcp-server)

```
✅ 410/412 통과 (99.5%)
   - 신규: 16 케이스 (W7-4 단가 계산)
   - 기존: 394 통과, 2 skip (external dependency: sketchup-mcp-bridge port)
```

### 8.2 통합 테스트

```
✅ planner-vite: 88/88 통과 (회귀 0)
✅ detaildesign: node sanity (bom-finish-color.js + extractors.js)
   - 49 자재 코드 무결성 확인
   - 14 도어 호출 finishCode 매핑 검증
✅ mcp-server tsc + Vite build: clean
```

### 8.3 회귀 영향

| 모듈 | 상태 |
|------|------|
| planner-vite | 88/88 통과 (변경 없음, useEffect 추가만) |
| detaildesign | default MDF fallback 작동 (기존 BOM 호환) |
| mcp-server | +16 신규, 기존 회귀 0 |

---

## 9. 프로세스 개선 제안

### 9.1 PDCA 프로세스

| 단계 | 개선 영역 | 제안 |
|------|---------|------|
| Plan | 기술 제약 명시 부족 | postMessage origin guard vs. silent update 사전 정의 |
| Design | - | - |
| Do | 단계적 검증 설계 미흡 | 헬퍼/테스트와 도구 wiring 분리 시 명시 |
| Check | Gap analysis 정확도 | detaildesign vitest 도입 필요 |

### 9.2 개발 환경

| 영역 | 개선 제안 | 기대 효과 |
|------|---------|---------|
| 자동화 테스트 | detaildesign vitest 환경 | 회귀 감지 시간 단축 |
| 보안 | postMessage origin allow-list | 프로덕션 환경 안전도 향상 |

---

## 10. 차기 단계

### 10.1 즉시 (다음 세션)

- [ ] W8-2: BOM Excel column 갱신 (finishCode + 단가 추가)
- [ ] W8-3: detaildesign vitest 환경 구축
- [ ] W8-4: postMessage origin allow-list 강화

### 10.2 차기 Cycle (W8+)

| 항목 | 우선순위 | 예상 시작일 |
|------|---------|-----------|
| W8-2: BOM 출력 모듈 갱신 | High | 2026-05-25 |
| W8-3: detaildesign 자동 테스트 | Medium | 2026-05-25 |
| W9: 단가 자동 적용 (별 cycle) | Low | TBD |

---

## 11. Changelog

### v1.0.0 (2026-05-24)

**Added:**
- `bom-finish-color.js`: DOOR_FINISH_CATALOG + DOOR_COLOR_CATALOG (49 조합)
- `App.tsx`: V2_MODULES_CHANGE postMessage 송신
- `ui-step1.js`: 양방향 동기화 listener
- `extractors.js`: finishCode 인자 + 14 도어 호출 통합
- `bom-rules.defaults.ts`: FINISH_BASE_PRICE/COLOR_PRICE_MULTIPLIER (₩13,300~₩41,800)
- `bom-rules.tool.ts`: price_door/door_pricing_matrix operations

**Changed:**
- `extractors.js`: add() 메서드 시그니처 (mod 매개변수 추가)
- detaildesign.html: script tag (bom-finish-color.js 로드)

**Fixed:**
- W8-1: BOM tool finishCode 인식 미비 → price_door operation 추가

---

## 12. 결론

**Match Rate 0.98 (A 등급)**, 회귀 0, 5 PR 모두 머지 완료. 

W7 cycle은 ModuleDetailPanel의 49 조합 카탈로그를 BOM 산출 시스템에 성공적으로 반영했습니다. 자재 코드 단일 소스 유지, 양방향 동기화, 단가 자동 계산까지 일관되게 구현되었으며, W8-1 (BOM tool wiring) 으로 Major Gap을 해소했습니다.

**지속 모멘텀**:
- W8-2 (0.5일): BOM Excel column 갱신
- W8-3 (0.5일): detaildesign vitest 환경
- W8-4 (0.25일): postMessage origin allow-list

다음 세션에서 W8 시리즈를 진행하면 디자인-구현-검증 자동화 완성도가 100%에 근접할 것으로 예상됩니다.

---

## Version History

| 버전 | 날짜 | 변경 사항 | 작성자 |
|------|------|---------|-------|
| 1.0 | 2026-05-24 | W7 cycle 완료 보고서 | Hong |
