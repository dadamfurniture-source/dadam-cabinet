# BOM 자재 코드 매핑 (doorFinish × doorColor → 자재 코드)

> W6 cycle 후속. ModuleDetailPanel (W6-5) 의 doorFinish (7) × doorColor (7) 카탈로그 → BOM 산출 시 실제 자재 코드 반영.

## Context

**현재 상태**:
- W6-5 ModuleDetailPanel 이 49 조합 (7×7) 카탈로그 정의, 그러나:
  - `extractors.js` 가 모든 도어를 `MDF, 18mm, 4면` 단일 자재로 처리 (L132/195/202/...)
  - planner V2 modulesV2.doorFinish/doorColor → detaildesign item.modules 동기화 안 됨 (단방향: detail→planner 만)
  - mcp-server bom-rules 도 finish/color 카탈로그 인식 없음

**목표**:
- doorFinish + doorColor → 자재 코드 매트릭스 도입
- planner V2 입력 → detaildesign 양방향 동기화 → BOM 산출 시 실 자재 코드 반영

## PR 시리즈 (W7-1 ~ W7-4, 총 2일)

### W7-1: 자재 코드 매트릭스 + 카탈로그 단일 소스 (0.5일)

신규 `js/detaildesign/bom-finish-color.js`:
- `DOOR_FINISH_CATALOG` = 7 finish (코드 + 라벨 + 단가 hint)
- `DOOR_COLOR_CATALOG` = 7 color (코드 + 라벨 + 톤)
- `FINISH_COLOR_MATRIX(finish, color)` → 자재 코드 (예: `PET-OAK-M`)
- 명명 규칙: `{FINISH-3}{COLOR-3}-{TONE}` (예: PET-OAK-M = PET 매트 + 오크)

ModuleDetailPanel.tsx 의 인라인 옵션은 유지 (UI 단일 책임), W7-2 에서 V2 동기화 시 카탈로그 참조.

테스트: 49 조합 매트릭스 무결성 + 코드 충돌 없음.

### W7-2: V2 ↔ detaildesign item.modules 양방향 동기화 (0.5일)

- planner-vite App.tsx: planner state 변경 시 부모로 `V2_MODULES_CHANGE` postMessage
- detaildesign ui-step1.js: 메시지 수신 시 item.modules 의 doorFinish/doorColor 갱신
- 양방향 sync 무한 루프 방지 (origin guard)

테스트: postMessage 직렬화 + V2 → detaildesign 매핑.

### W7-3: extractors.js 도어 자재 코드 적용 (0.5일)

- 각 도어 `this.add(materials, label, '도어', ...)` 호출에 자재 코드 추가 인자
- 모듈의 doorFinish/doorColor 가 있으면 FINISH_COLOR_MATRIX 매핑, 없으면 default MDF
- 카테고리 별 분기 (싱크 / 벽장 / 키큰장 / 신발 / 냉장고 / 화장대 / 수납)

테스트: 기존 BOM snapshot + finish/color 적용 시 자재 코드 변경.

### W7-4: bom-rules.* 확장 + BOM 산출 통합 (0.5일)

- mcp-server `bom-rules.defaults.ts`: finish/color 카탈로그 + 단가 매트릭스
- BOM tool 의 도어 항목 자재 코드 인식
- 자재 코드 → 단가 산출

테스트: 자재 코드 별 BOM 산출 정확성 + 기존 단가 회귀 0.

## Critical Files

| 파일 | 변경 | 단계 |
|------|------|------|
| `js/detaildesign/bom-finish-color.js` | 신규 | W7-1 |
| `planner-vite/src/components/ModuleDetailPanel.tsx` | 카탈로그 참조 | W7-2 |
| `planner-vite/src/App.tsx` | postMessage V2_MODULES_CHANGE | W7-2 |
| `js/detaildesign/ui-step1.js` | 메시지 수신 + item.modules 갱신 | W7-2 |
| `js/detaildesign/extractors.js` | 도어 자재 코드 인자 추가 | W7-3 |
| `mcp-server/src/config/bom-rules.defaults.ts` | finish/color 카탈로그 + 단가 | W7-4 |
| `mcp-server/src/tools/bom-rules.tool.ts` | 자재 코드 인식 | W7-4 |

## 검증

- vitest: bom-finish-color 49 조합 + W7-3 BOM snapshot
- 외부 detaildesign: 기존 가구 BOM 산출 회귀 0 (default MDF fallback)
- production: planner UI 에서 도어 색상 변경 → BOM 산출 자재 코드 갱신

## 예상 일정

W7-1: 0.5일 / W7-2: 0.5일 / W7-3: 0.5일 / W7-4: 0.5일 = **총 2일**

## Out of Scope

- 단가 자동 적용 (자재 마트 가격 변동 — 별 cycle, 사용자 결정)
- 실제 발주 시스템 통합
- 자재 재고 관리
- 도어 무늬 (목재 결, PVC 패턴) — RGB 외 텍스처
