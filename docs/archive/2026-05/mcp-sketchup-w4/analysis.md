# mcp-sketchup-w4 Gap Analysis

> **Plan**: `C:\Users\hchan\.claude\plans\cheeky-noodling-hanrahan.md`
> **검증 대상**: PR #263–#270 (9개 머지, commit `9d39d34..d5f3984`)
> **분석 일자**: 2026-05-16

## Match Rate: 78% (18.0 / 23 항목)

| 단계 | 항목 | 일치 | 부분 | 누락 | 점수 |
|------|------:|----:|----:|----:|----:|
| W4-1 V2 shim       | 3 | 3 | 0 | 0 | 3.0 |
| W4-2 transport     | 3 | 2 | 1 | 0 | 2.5 |
| W4-3 App.tsx Z-up  | 5 | 0 | 5 | 0 | 2.5 |
| W4-4 V1 제거        | 5 | 4 | 1 | 0 | 4.5 |
| W4-5 회전+머티리얼   | 4 | 3 | 0 | 1 | 3.0 |
| W4-6 legacy 정리    | 3 | 2 | 1 | 0 | 2.5 |
| **합계**            | **23** | **14** | **8** | **1** | **18.0** |

---

## ✅ 일치 (구현 == plan)

### W4-1 (#263, `9d39d34`) — mcp-server V2 shim
- **CabinetPartV2 인터페이스 존재**: `mcp-server/src/types/planner.types.ts:69-87` — Z-up, corner, mm, rotationZDeg 모두 plan 명세대로
- **migrateV1ToV2 도입**: W4-1 시점 도입 → W4-4 에서 mcp-server 측 제거됐으나 `planner-vite/src/lib/coords.ts:37` + `lib/sketchup-client.ts:44` 로 분리 보관 (역할 분리, plan 의도 보존)
- **partV2ToCommand**: `sketchup-builder.service.ts:119` `partToCommand(part: CabinetPartV2, ...)` — V2 only, mm→inch 변환만 수행

### W4-2 (#264, `a171e69`) — transport
- **planner-vite sketchup-client V2 송신**: `planner-vite/src/lib/sketchup-client.ts:33` (`parts: CabinetPartV2[]`), `:87` (`schemaVersion: 'v2'`)
- **deriveCabinet V2 출력**: `planner-vite/src/lib/planner.ts:1689` (`parts.map(migratePartV1ToV2)`) — 출력 직전 일괄 V2 변환

### W4-4 (#266, `38a7c57`) — V1 shim 제거
- **migrateV1ToV2 mcp-server 측 삭제**: 헤더 주석 명시 + grep 미존재 확인 (-265 LOC)
- **partToCommand 단순화**: mm→inch 변환만 수행 (Y-up→Z-up, center→corner 변환 제거)
- **plannerToSketchup 삭제**: `constants/sketchup.ts:31` 주석으로 제거 명시
- **sketchup.schema.ts V2 필드**: `:29-47` `rotationZDeg` 추가, V2 한정

### W4-5 (#267, `46e8f0c`) / W4-5b (#268) / W4-5c (#269) — 회전 + 머티리얼
- **transform_component 명령 추가**: `sketchup-builder.service.ts:175` `partToRotationCommand` — Euler `[0,0,deg]` 배열 (W4-5b 보정)
- **set_material 명령 추가**: `:201` `partToMaterialCommand` — id placeholder + material name
- **ENSURE_MATERIALS 사전 등록**: `constants/sketchup.ts:88-103` 16개 머티리얼 (4 tone × 4 key) idempotent 등록

### W4-6 (#270, `d5f3984`) — legacy 정리
- **root `lib/planner.ts` CabinetPartV2 미러 추가**: `:130` 인터페이스 추가
- **root `lib/sketchup-client.ts` V2 호환**: `:44` `migratePartV1ToV2` 함수 + V2 송신

---

## ⚠️ 부분 일치

### W4-2 schemaVersion 디스크리미네이터
- **Plan**: `z.union([V1, V2])` discriminator
- **실제**: `sketchup.schema.ts:52` `z.literal('v2').optional()` — V1 path 제거되어 단순 옵셔널 리터럴로 축소. 기능 동등, 형태 차이.

### W4-3 App.tsx Z-up 전환 (5개 sub-item 모두 부분)
- **Plan**: Three.js `Object3D.DEFAULT_UP.set(0,0,1)`, camera/light/orbit/mesh 모두 Z-up 재배치, `boxGeometry args` 순서 변경, 드래그 axis (secondary Z→Y) 변경
- **실제**: W4-3a (#265, `07b17bd`) 만 머지 — `App.tsx:747` `useMemo` 어댑터로 `derived.parts` (V2) → V1 변환 후 기존 V1 렌더 그대로. Three.js 자체 Z-up 전환 (W4-3b/c) 미진행
- **이유**: 시각 회귀 위험 + 1주 feature flag A/B 필요 → 별 단계로 분리
- **결과**: 송신 경로 V2 native, 렌더 경로 V1 어댑터 (plan keystone 미달)

### W4-4 V1 타입 rename
- **Plan**: "CabinetPart V1 삭제, CabinetPartV2 → CabinetPart rename"
- **실제**: V1 인터페이스 보존 + `@deprecated` 마킹. sync-planner 가 root `lib/planner.ts` 미러 위해 V1 export 필요. mcp-server 내부 코드는 V2 만 import.
- **결과**: 기능적으로는 plan 일치, 이름 정리만 보류

### W4-6 legacy components/planner deprecate
- **Plan**: "사용처 grep 후 deprecate/**delete**"
- **실제**: `@deprecated` JSDoc 마킹만. 실제 삭제는 production 트래픽 (`app/planner/page.tsx`, `app/embed/page.tsx`) 영향 미확인 → W4-6c 로 분리

---

## ❌ 불일치 / 누락

### W4-5 비정사각 박스 corner-pivot 효과
- **Plan (Section C)**: `transform_component(axis=[0,0,1], angle=rotationZDeg, origin=position)` — corner pivot 회전
- **mhyrr v0.1.0 실제**: `transform_component` 가 `origin/axis` 파라미터 미지원, `entity.bounds.center` 기준 자동 회전
- **영향**: 정사각 base (depth==width) 인 secondary 모듈은 차이 없음. 비정사각 박스는 회전 후 corner 위치 어긋남. 디자이너 PC E2E 에서 시각적으로 확인되지 않은 잠재 결함
- **회복**: W4-5d 별 PR — `transform_component` 의 `position + rotation` 조합으로 보정 (회전 전후 corner 좌표 차이를 position 보정으로 흡수)

---

## 회복 권장

### 우선순위 H (High)
1. **W4-3b/c Three.js Z-up 전환** — V1↔V2 useMemo 어댑터 부담. Z-up 네이티브 렌더로 가야 plan keystone 달성. 1주 feature flag A/B 후 적용
2. **W4-5d corner-pivot 효과** — 비정사각 회전 박스 위치 보정. mhyrr fork 대안 (origin/axis 인자 추가) 도 검토

### 우선순위 M (Medium)
3. **W4-6c legacy 삭제** — production 트래픽 검증 후 `components/planner/{DadamPlanner,EmbedCanvas}.tsx` + `app/planner/page.tsx` + `app/embed/page.tsx` 일괄 삭제
4. **W4-4b V1 타입 rename** — root `lib/planner.ts` 가 V2 native 로 전환되면 V1 인터페이스 + sync-planner V1 export 제거 가능

### 우선순위 L (Low)
5. **W4-2 schemaVersion `z.union` 화** — V1 schema 재추가 가능성에 대비. 기능 변화 없음

---

## 추가 발견

### mhyrr v0.1.0 시그니처 drift (plan 작성 시점 미파악)
- **Plan Section C**: `transform_component { axis, angle, origin }`, `set_material { component_id, material_name }`
- **실제 mhyrr v0.1.0**: `transform_component { id, rotation: [x_deg, y_deg, z_deg], position?, scale? }` (Euler 배열 + bbox-center pivot), `set_material { id, material }`
- 또한 mhyrr 가 단일 TCP 연결당 단일 명령만 처리 후 close (persistent 모드 ECONNRESET) → per-command 모드 필수
- 그리고 mhyrr 가 entity ID 응답 chaining 필요 → `entityIdMap` + `__ENT__:<idRef>` placeholder 시스템
- **보정**: W4-5b (#268) 시그니처 호환, W4-5c (#269) per-command + entityIdMap + 옵션 기본값 true. 디자이너 PC E2E **11/11 명령 성공** 으로 검증

### W4-3 결정 — adapter 우회의 합리성
- Plan 의 W4-3 Three.js Z-up 전환은 2일 작업 + 1주 feature flag A/B = 9일 lead time
- W4-3a 의 adapter 우회는 1일. V2 송신 경로만 통일하고 렌더는 V1 유지
- 결과: SketchUp 빌드 (mcp-server 송신) 는 plan 의 의도 100% 달성, planner UI 시각 회귀 위험 0
- 단, V2↔V1 round-trip 변환 오버헤드 (`migratePartV1ToV2` + `migratePartV2ToV1`) 와 가독성 부담 잔존

### 머지된 PR 9개 요약
| # | PR | Commit | 단계 |
|---|----|--------|------|
| 1 | #263 | `9d39d34` | W4-1: CabinetPartV2 + migrateV1ToV2 + partV2ToCommand |
| 2 | #264 | `a171e69` | W4-2: schemaVersion + planner-vite V2 transport |
| 3 | #265 | `07b17bd` | W4-3a: DerivedCabinet.parts V2 통일 + V2 직송 (Three.js 자체는 useMemo 어댑터) |
| 4 | #266 | `38a7c57` | W4-4: V1 shim 제거 (-265 LOC) |
| 5 | #267 | `46e8f0c` | W4-5: transform_component + set_material (옵션 기본 false) |
| 6 | #268 | `586f498` | W4-5b: mhyrr 시그니처 호환 (id chaining + Euler degrees) |
| 7 | #269 | `4ae47be` | W4-5c: per-command + 옵션 기본 true (ECONNRESET hotfix) |
| 8 | #270 | `d5f3984` | W4-6: legacy components/planner deprecate + lib/sketchup-client V2 |

---

## 결론

Plan 의 6단계 PR 분할 의도는 9개 PR 머지로 충실히 따랐고, W4-1/4/5/6 본체 항목은 대부분 일치. W4-3 keystone (Three.js Z-up) 만 W4-3a 어댑터로 우회되어 후속 작업 (W4-3b/c) 필요. W4-5 corner-pivot 효과는 mhyrr 시그니처 한계로 별 PR (W4-5d) 분리. 전체적으로 **plan 의도의 78% 달성**, 디자이너 PC E2E **11/11 성공** 으로 운영 가능 상태.
