# sketchup-import Plan — SketchUp → planner 역변환

> **목적**: SketchUp 파일/씬 → planner UI 의 PlannerState 복원
> **선행**: mcp-sketchup-w4/w5 (planner → SketchUp 출력 완성)
> **단계**: PDCA Plan 만 (구현은 사용자 승인 후 별 PR)

## 사용자 가치

### 시나리오 1 — 자체 export 한 파일 재활용 (Primary)
1. 디자이너가 planner UI 에서 가구 설계 → SketchUp export
2. SketchUp 에서 미세 조정 (예: 도어 위치 미세 수정, 코너 정밀화)
3. 수정된 파일을 다시 planner 로 import → BOM 산출, 가격 재계산, 카탈로그 등록

### 시나리오 2 — 협업 파일 검토 (Secondary)
- 외부 업체로부터 SketchUp 파일 받음 → planner 로 import → 다담 시스템 호환성 검증 (BOM, 자재 추산)

### 시나리오 3 — 마이그레이션 (Tertiary)
- 과거 SketchUp 만 사용한 디자이너의 누적 파일을 planner DB 로 마이그레이션

## 기술 분석

### 데이터 흐름 (목표)
```
.skp 파일 또는 활성 SketchUp 씬
   ↓ mhyrr eval_ruby (entities dump)
SketchUp entities (group + bbox + name + material)
   ↓ mcp-server /api/sketchup/import
{ parts: V2[] }  (planner-vite 의 sketchup-client 와 같은 형식)
   ↓ V2 → PlannerState 역추적
PlannerState (preset, width/height/depth, modules, layoutShape, ...)
   ↓ planner UI 표시
사용자 편집 가능 상태
```

### 핵심 도전 — V2 parts → PlannerState 역추적

**쉬운 부분 (단순 측정)**:
- 전체 가구 bbox → width / height / depth
- 걸레받이 entity → toeKickH
- 몰딩 entity → moldingH
- 좌/우 마감재 → finishLeftW / finishRightW
- 분배기/환풍구 → distributorStart/End / ventStart

**중간 부분 (이름 기반 분류)**:
- 우리 export 한 파일은 outliner name `dadam.{category}.{partId}` 마킹
- `partId` 의 prefix (`lower-door`, `upper-door`, `molding-top`, `finish-left-lower`, `utility-distributor`...) 로 의도 분류 가능
- moduleType 매핑: `sink/cook/hood/storage/drawer/blind`

**어려운 부분 (의도 복원)**:
- `layoutShape` ('I'/'L'/'U') — 차선/3차선 체인 존재 여부로 판별
- `secondaryStartSide` — 차선 모듈의 X 위치 (좌측 또는 우측) 분석
- `tertiaryStartFrom` — 차선/3차선 의 위상 관계
- `distributorStart/End` — 분배기 entity 의 X 위치
- `lowerModules[].kind` / `doorCount` / `drawerCount` — 모듈 단위 X 분포 분석 + 도어/서랍 구분 (이름 또는 material 기반)

**불가능한 부분 (외부 파일)**:
- dadam 마킹 없는 임의 SketchUp 파일은 단순 박스 좌표만 추출 가능
- 본체/도어/구조물 분류는 휴리스틱 + Vision API (Gemini) 필요

## 단계별 PR 분할 (Si-1 ~ Si-6)

### Si-1 — mhyrr entities dump 도구 (~1일)
- `mcp-server/src/tools/sketchup-scene-dump.tool.ts` 신규
- `RUBY_COMMANDS.DUMP_ENTITIES` allowlist 추가 — 모든 group 의 (name, bounds, transformation, material) JSON 반환
- HTTP route `GET /api/sketchup/scene` — 인증 + JSON 응답
- 단위 테스트 + e2e (사용자 현재 SketchUp 씬 dump 확인)
- **회귀 위험**: 0 (조회 전용 + 별 도구)

### Si-2 — V2 parts ← entities 역추적 (~1일)
- `mcp-server/src/services/sketchup-import.service.ts` 신규
- `parseSketchupEntities(entities) → V2 parts[]`
  - bbox.min → V2 corner
  - bbox.size → V2 width/depth/height
  - name 파싱 → partId, category, isDoor, parentModuleId
  - rotation (transformation 매트릭스 분해) → rotationZDeg
- 단위 테스트: 다양한 entity name 패턴

### Si-3 — V2 parts → PlannerState 역추적 (~2-3일)
- `mcp-server/src/services/sketchup-import.service.ts` 의 `reconstructPlannerState(parts) → PlannerState`
- 알고리즘:
  1. **단순 측정**: 전체 bbox → width/height/depth, toeKickH, moldingH, finishL/R
  2. **preset 추정**: 모듈 type 분포 (sink/cook 있음 → sink, 도어만 → wardrobe/storage 등)
  3. **레이아웃 분류**: 모듈 X 분포 클러스터링 → layoutShape (단일 X 범위 → I, 두 클러스터 → L, 세 클러스터 → U)
  4. **차선 시작 방향**: 차선 모듈의 X 평균값 비교
  5. **모듈 entry 재구성**: 모듈 단위 ModuleEntry (id, kind, width, moduleType)
- 단위 테스트: dadam export 다양한 가구 (sink/wardrobe/vanity/fridge L자/U자)

### Si-4 — HTTP route + MCP tool (~0.5일)
- `POST /api/sketchup/import` (인증 + rate limit)
- body: 옵션 (`host`, `port`, `ping` — 활성 SketchUp 씬 dump)
- 응답: `{ plannerState, parts, warnings }` (warnings: 누락 또는 추정 항목)
- MCP tool `import_sketchup_scene` 동일 기능

### Si-5 — planner UI 업로드 버튼 (~1일)
- `planner-vite/src/App.tsx` 의 detail design 패널에 "SketchUp 에서 가져오기" 버튼 추가
- 클릭 → mcp-server 호출 → 응답의 PlannerState 로 setPlanner(...)
- 경고 모달 (저장된 변경 손실 경고)
- 경고 표시 (preset 추정 신뢰도 < 80% 등)

### Si-6 — 양방향 round-trip 검증 (~0.5일)
- E2E: planner → SketchUp 빌드 → SketchUp scene dump → import → PlannerState 비교
- 정확도 99% 목표 (의도 복원 정확)
- 정확도 < 99% 시 차이 항목 보고

## 우선순위 / 일정

| 단계 | 작업 | 가치 | 위험 | 누적 일 |
|------|------|------|------|--------:|
| Si-1 | mhyrr dump | 진단 시 즉시 유용 | 0 | 1 |
| Si-2 | V2 역변환 | 자체 export 호환 | 저 | 2 |
| Si-3 | PlannerState 역추적 | **핵심 가치** | 중 | 4-5 |
| Si-4 | HTTP/MCP route | 사용자 진입점 | 저 | 4.5-5.5 |
| Si-5 | planner UI 업로드 | 사용자 UX | 저 | 5.5-6.5 |
| Si-6 | round-trip 검증 | 신뢰도 | 저 | 6-7 |

**Total: 6-7 일** (Plan + 구현)

## Critical Files (구현 시 영향)

| 파일 | 영향 |
|------|------|
| `mcp-server/src/constants/sketchup.ts` | `RUBY_COMMANDS.DUMP_ENTITIES` 추가 |
| `mcp-server/src/services/sketchup-import.service.ts` (신규) | 핵심 역변환 로직 |
| `mcp-server/src/routes/sketchup.route.ts` | `POST /api/sketchup/import` 추가 |
| `mcp-server/src/tools/sketchup-import.tool.ts` (신규) | MCP 도구 |
| `planner-vite/src/lib/sketchup-client.ts` | `importFromSketchup()` 함수 추가 |
| `planner-vite/src/App.tsx` | "SketchUp 에서 가져오기" 버튼 + 모달 |

## 위험 / 한계

### Si-3 의 정확도 한계
- **preset 추정**: 모듈 type 분포로 추정. fridge vs sink 의 경계 모호 (둘 다 주방, 냉장고 모듈 유무로 구분)
- **layoutShape 추정**: 클러스터링 임계값 설정 어려움. 사용자가 명시 확인 권장 (모달)
- **secondaryStartSide**: 단일 차선만 있으면 명확. 복수 차선 시 모호
- **모듈 도어/서랍 분류**: SketchUp 의 도어 entity (isDoor=true 마킹) 가 있어도 사용자가 SketchUp 에서 서랍을 도어로 수정했을 가능성 — material/shape 기반 휴리스틱 필요

### 외부 파일 (dadam 마킹 없음)
- Si-1~Si-6 은 dadam export 한 파일만 가정. 임의 파일은 Si-2 의 name 파싱이 실패 → 사용자에게 "지원 안 되는 파일" 경고
- 외부 파일 지원은 별 cycle (Vision API + ML 분류)

### round-trip 손실
- SketchUp 에서 미세 좌표 수정 → import 시 PlannerState 의 width/finishL/finishR 등이 정확히 복원되지 못할 가능성
- mm 단위 ±2mm 오차 허용 (clamp 이전 raw 측정)

## 성공 기준

- ✅ 자체 export 한 SketchUp 파일 import → PlannerState 정확 복원 (>= 99%)
- ✅ planner UI 에서 "SketchUp 에서 가져오기" 버튼 작동
- ✅ round-trip (planner → SketchUp → planner) 차이 < 5mm
- ✅ 추정 신뢰도 < 80% 시 사용자에게 경고 표시

## Phase 2 — Template 배포 (옵션 2, +3-5일)

Phase 1 완료 후 진행. 외부 자료를 다담 시스템과 호환되게 하는 가장 비용-효과적 경로.

### T-1: dadam-template.skp 작성 (~1일)
- 6 preset 별 outer Group (`dadam.sink`, `dadam.wardrobe`, ...)
- 각 Group 내부 component library (도어/본체/마감재 견본)
- mhyrr 호환 outliner name 규칙 안내 layer

### T-2: SketchUp Ruby Plugin (~2-3일)
- `dadam-mark.rbz` (auto-mark plugin)
- Group 안 entity 가 추가/이동될 때 outliner name 자동 갱신
- partId 자동 생성 (timestamp + 카운터)
- 메뉴: `Extensions > 다담 자동마킹`
- `RUBY_COMMANDS` allowlist 확장 또는 별 plugin 도구
- 배포: `.rbz` 다담 사용자 PC 자동 설치 스크립트 (mhyrr 배포 패턴 참고)

### T-3: 사용 가이드 (~0.5일)
- README + 비디오 (template 사용법 + cut-paste 마이그레이션)
- planner UI 의 import 모달에 안내 메시지

## Phase 3a — 수동 매핑 UI (옵션 3, +1주)

외부 파일 import 가 소수 + 신뢰도 100% 필수 시.

### M-1: entity 목록 UI (~2일)
- `planner-vite/src/components/SketchupImportPanel.tsx` 신규
- mcp-server 의 dump 응답을 받아 entity 목록 표시
- 각 entity 의 bbox 미니 SVG 미리보기

### M-2: 모듈 타입 분류 UI (~2일)
- 드롭다운: moduleType (sink/cook/hood/storage/drawer/blind)
- isDoor 토글, parentModuleId 선택
- category 선택 (sink/wardrobe/...)
- 단축키: 키보드 (↑/↓ 이동, Enter 확정)

### M-3: 자동 추론 (~1일)
- bbox 크기 기반 휴리스틱:
  - depth ≤ 25mm + colorKey=accent → 도어 자동 추정
  - height ≤ 80mm + 가로 가구 폭 → 걸레받이/몰딩
  - 가로 폭 ≤ 60mm → 마감재
- "추론 결과 적용" 버튼 (사용자 검토)

### M-4: PlannerState 구성 (~1일)
- 분류된 entities → ModuleEntry[]
- 자동 측정 (width/height/depth/finishL/R/toeKickH/moldingH)
- planner UI 에 상태 적용

## Phase 3b — AI 자동 분류 (옵션 4, +2-3주)

외부 자료 대량 + 사용자 시간 절약 필수 시.

### A-1: mhyrr export_scene PNG 검증 (~1일)
- mhyrr v0.1.0 의 export_scene 정확한 시그니처 확인 (PNG 옵션 / 해상도)
- 정면/측면/평면 view 자동 캡처
- 실패 시 eval_ruby 로 직접 view export

### A-2: Gemini Vision prompt 작성 (~3일)
- `wall-analysis.service.ts` 패턴 참고 (Few-Shot)
- 가구 카테고리 추정 prompt
- entity 분류 prompt (bbox + 렌더 이미지)
- 신뢰도 점수 산출 (0~1)
- prompt 튜닝 + 검증 (6 preset × 3 layout 데이터셋)

### A-3: AI 응답 parsing + PlannerState 변환 (~2일)
- Gemini 응답 JSON parse
- 신뢰도 80% 임계값 분기
- PlannerState 자동 구성

### A-4: 사용자 보정 모달 (~3일)
- 신뢰도 < 80% 시 모달 표시
- Phase 3a 의 수동 매핑 UI 재사용 (보정용)
- AI 분류 결과 vs 사용자 보정 차이 학습 데이터 수집 (옵션)

### A-5: 비용 + 응답 시간 모니터링 (~1일)
- mcp-server logger 에 Gemini API call count + cost 추가
- 응답 시간 metric

## Out of Scope (Phase 4 이후)

- **양방향 실시간 sync** (SketchUp 편집 자동 반영) — 별 cycle (~2주)
- **.skp 파일 직접 파서** (mhyrr 없이 파일만 받음) — 별 cycle, 외부 라이브러리 필요
- **학습 데이터 활용** (사용자 보정 → AI 재학습)

## 다음 단계 (구현 순서)

1. **Phase 1 (옵션 1) Si-1 ~ Si-6** — 6-7일 (즉시 시작)
2. **Phase 2 (옵션 2) T-1 ~ T-3** — Phase 1 완료 + 사용자 검증 후
3. **Phase 3a 또는 3b** — Phase 1+2 운영 결과 본 후 선택

## 참고 (Phase 1 구현 자료)

### 재사용 가능
- `mhyrr eval_ruby` 진단 패턴 (`tmp/probe-*.mjs`)
- `wall-analysis.service.ts` (Few-Shot prompt 패턴 — Phase 3b 에서)
- `planner-vite/src/lib/coords.ts` 의 `migratePartV2ToV1` (V2 → V1 역변환 활용)
- `js/detaildesign/persistence-init.js` 의 SupabaseUtils.uploadImage (Phase 3a/3b 의 file upload)

### 새로 만들어야
- `mcp-server/src/services/sketchup-import.service.ts` (entities → V2 → PlannerState)
- `mcp-server/src/tools/sketchup-import.tool.ts`
- `mcp-server/src/constants/sketchup.ts` 의 `RUBY_COMMANDS.DUMP_ENTITIES`
- `mcp-server/src/routes/sketchup.route.ts` 에 import 라우트 추가
- `planner-vite/src/lib/sketchup-client.ts` 의 `importFromSketchup()`
- `planner-vite/src/App.tsx` 의 "SketchUp 에서 가져오기" 버튼

### Phase 3a 한정
- `planner-vite/src/components/SketchupImportPanel.tsx` (수동 매핑 UI)

### Phase 3b 한정
- `mcp-server/src/services/sketchup-import-ai.service.ts` (Gemini Vision 통합)
- `RUBY_COMMANDS.EXPORT_VIEW_PNG` (3-view PNG 캡처)

## 참고

- W4-5b 진단에서 사용한 `mhyrr eval_ruby` 로 entity dump 기법 활용 (tmp/probe-bounds.mjs)
- W5-DIAG-fix 의 essential 필터 발견에 사용한 last-build-request.json 패턴 — import 의 역방향 검증 가능
- planner-vite/src/lib/coords.ts 의 V1↔V2 변환 로직 (Si-2 에서 V2→V1 역방향 활용)
