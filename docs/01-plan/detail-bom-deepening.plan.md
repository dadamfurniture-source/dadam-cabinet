# 디테일 단계 · BOM 심화 개발 계획 (울트라플랜)

> 작성: 2026-09-13 / 기준 커밋: `4147a9e` (origin/main)
>
> 표기 관례는 `planner-rewrite.plan.md` 를 따른다.
> - **[확인]** — 코드에 근거가 있다. `파일:줄` 을 병기한다.
> - **[결정]** — 이 계획이 새로 정하는 것. 근거를 적는다.
> - **[확인 필요]** — 공장·사용자만 답할 수 있는 값. 지어내지 않는다.

---

## 0. 한 문단 요약

디테일 단계는 지금 **버튼만 있고 화면이 없다**. 색상·마감은 상세설계 품목 사양에 상/하 두 값으로만
있고, 3D 는 그 값을 읽지 않는다. BOM 은 싱크·붙박이·냉장고 세 카테고리의 판재와 일부 철물만 내고,
상판·엣지밴딩 길이·체결구는 빠져 있으며, 재단 배치는 브라우저 안에서만 계산되고 저장되지 않는다.
작업지시서는 워커에 이미 있으나 평면 목록이다.

이 계획은 두 축을 하나의 **부재(part) 모델**로 묶는다.
- **D 축 (디테일)**: 부재 단위 마감 지정 → 3D 실시간 재질 → 고품질 스냅샷 → (선택) AI 연출.
- **B 축 (BOM)**: 부재 식별자 + 마감 코드 → 누락 자재 보강 → 네스팅 단일화·저장 → 작업지시서 v2.
- **C 축 (공통)**: 마감 카탈로그 정본 하나, 도면↔BOM 원장(ledger) 검사.

"도면에 나타난 모든 자재를 정확히" 는 결국 **3D 가 그리는 부재와 BOM 이 세는 부재가 같은 목록**이어야
성립한다. C1 원장 검사가 그 보증 장치다.

---

## 1. 현재 상태 [확인]

### 1.1 플래너와 디테일 단계

| 항목 | 상태 | 근거 |
|---|---|---|
| 활성 플래너 | `mockup-shell.html`(배치) · `mockup-structure.html`(구조) + `js/planner/*` | 최근 60커밋 중 15건이 mockup-structure |
| 디테일 단계 화면 | **없음**. 🎨 3.디테일 버튼에 핸들러 없음 | `mockup-shell.html:236`, `mockup-structure.html:268` |
| 디테일 저장 키 | 비어 있음. 정본은 `design_items` | `js/planner/planner-store.js:41-45` |
| 스냅샷 표 | `planner_snapshots(stage IN layout/structure/detail, payload JSONB)` | `database/planner-snapshots-schema.sql:19-47` |
| 구조 단계 데이터 | 모듈 `W/H/D/x/y/rotation`, `structures[id]`(칸·서랍·선반·손잡이), 마감재(ep/molding/filler/gap) | `mockup-structure.html:543-563` |
| 색상 필드 | 플래너 모델에 **전혀 없음**. 섹션별 도식 색만 | `js/planner/planner-sections.js:49-84, 94-99` |
| 3D | three.js r0.183 CDN, `makeBox(w,h,d,color)` 단색 MeshStandardMaterial, 검은 외곽선 | `mockup-structure.html:452-466, 5705-5722` |
| 조명·색공간 | Ambient + Directional 2, 환경맵·톤매핑·outputColorSpace 없음 | `mockup-structure.html:5451-5545` |
| 렌더 내보내기 | 없음 (`preserveDrawingBuffer`·`toDataURL`·GLTF 모두 0건) | grep 결과 |
| 부재 피킹 | 있음. `userData.entityKind` = carcass/door/shelf/top-panel/toe-kick/pedestal/molding/handle/leg/blind/blindfin/finishing … | `mockup-structure.html:5522-5545` raycaster |
| 플래너→상세설계 | `buildPlannerPayload` (색 없음). 골든 바이트 불변 시험이 지킨다 | `mockup-structure.html:5293-5342`, `test-utils/planner-golden.js` |
| 상세설계→플래너 | `DADAM_RESTORE_DETAIL` 단방향 | `mockup-structure.html:5133-5140` |
| 레거시 | `planner-vite/` 는 W9 이후 정지. 단, 모듈별 `doorColor/doorFinish` 모델과 `V2_MODULES_CHANGE` 수신부는 살아 있음 | `planner-vite/src/lib/planner.ts:104-107`, `js/detaildesign/ui-step1.js:1470-1483` |

### 1.2 색상·마감 카탈로그 (세 갈래로 갈라져 있음)

| 소스 | 내용 | 소비자 |
|---|---|---|
| `js/detaildesign/bom-finish-color.js:29-51` | 마감 7 × 색 7 → 코드 `PET-OAK-M`, 단가 `:142-147` | `extractors.js:107` (모듈 필드를 읽지만 플래너가 안 씀) |
| `materials` / `furniture_options` 표 | `color_hex, finish, texture_prompt, thumbnail_url, applicable_to[]`, 가격 없음 | `FurnitureOptionCatalog` (`config-constants.js:121-200`) → 상세설계 UI, AI 프롬프트 |
| `data-constants.js:979-997` | `DOOR_COLOR_MAP` 5색 | 2D 도식 |

두 7색 목록이 **다르다** (cream/oak/walnut/graphite/white/black/sage vs 화이트/그레이/베이지/월넛/오크/네이비/블랙).
`furniture_options.texture_url` 은 컬럼만 있고 시드는 전부 주석 (`database/add-texture-url.sql`).

### 1.3 BOM

| 항목 | 상태 | 근거 |
|---|---|---|
| 정본 | `MaterialExtractor.extract()` (프론트). 워커가 `bom_payload` 로 저장 | `extractors.js:45`, `workflow-schema.sql:101` |
| 카테고리 | sink · wardrobe · fridge 만. 나머지 7종은 0건 | `extractors.js:75`, `simple-categories.md:84` |
| 행 형태 | `{module, part, material, thickness, w, h, qty, edge(문자열), note, finishCode, itemLabel}` | `extractors.js:105` |
| 엣지밴딩 | 문자열(`4면`, `1면(전)`). 길이·두께(0.6/1.0) 미구현 | `bom-protocol.md:24` 명세만 존재 |
| 상판 | **미산출** (좌대·걸레받이·몰딩만) | 조사 결과 |
| 철물 | 경첩(높이로 개수)·레일·손잡이·다리발·브라켓. 체결구 없음(`extractOthers` 빈 함수) | `extractors.js:837-1062` |
| 레일 수량 | 서랍 모듈당 1 (drawerCount 무시) — 과소 | `extractors.js:955` |
| 원판 추정 | `ceil(면적/원판)` — 커프·로스·네스팅 없음 | `extractors.js:773` |
| 네스팅 | 세 벌: `DrawingVisualizer.packParts`(`:1089`), `calcCuttingPlan`(`ai-design-report.js:1297-2114`), `NestingOptimizer`(`persistence-init.js:9`). 결이 없고 저장 안 됨 | 조사 결과 |
| 내보내기 | XLSX(SheetJS CDN) · CSV · CNC 텍스트 · `.doc` · `window.print()`. PDF 없음 | `ai-design-report.js:2860-3194`, `persistence-init.js:802` |
| MCP `bom.service.ts` | 독립 재구현, 값이 다름(18T·밴드60·경첩2). 호출처 없음 | `mcp-server/src/services/bom.service.ts:20` |
| 상수 드리프트 | 멍판 마감재 재단폭은 W12-72 에서 100→150 (`data-constants.js:89`). 폴백 100 (`extractors.js:159`) 과 Node 시험은 옛 값에 남아 있어, 브라우저 150 · 시험 100 으로 갈린다 | 정리 항목 (B0) |
| 시험 | 코너·멍장·본체두께는 깊음. 표준 부재표·철물·요약·네스팅은 **0** | `__tests__/bom-*`, `extractors-*` |

### 1.4 작업자 전달 문서

| 항목 | 상태 | 근거 |
|---|---|---|
| 작업지시서 | 워커 서버렌더 A4, 금액 없음. 표지(서명란) + 모듈 명세 + 자재 재단 목록 + 부자재 | `workers/workflow-api/src/templates/work-order.js:40-215` |
| 문서 종류 | `customer_confirmation · work_order · installation_order` (DB CHECK 와 동기) | `documents.js:42`, `workflow-schema.sql:134` |
| 스냅샷 | `design_snapshots(design_payload, bom_payload, hardware_payload, quote_payload, content_hash, rev)` append-only | `workflow-schema.sql:88-128` |
| 서버 검증 | `materials` 면적·부재수 재계산으로 클라이언트 요약과 대조 | `snapshots.js:96-158` |
| 색 → 가격 | `collectDoorAreas`: `finishCode` 별 m² × `door_finish_base` × `door_color_mult` | `adapters.js:92-107`, `workflow-pricing-seed.sql:141-164` |
| 빠진 것 | 시트별 재단표, 부재 라벨/QR, 모듈별 키팅, 보링 좌표표, 조립 순서, rev 간 차이, 기계용 파일, 색 스와치 | 조사 결과 |
| `drawing-viewer.html` | 설계와 연결 안 됨 (정적 SVG fetch) | `drawing-viewer.html:266-306` |

---

## 2. 목표와 완료 정의

### D 축 — 디테일 단계
1. 구조 단계에서 확정된 도면 위에 **부재 단위**로 마감(재질)·색을 지정한다.
2. 3D 가 그 마감을 **텍스처·광택으로 즉시** 보여준다.
3. 정면·3/4·모듈별 **고해상 스냅샷**을 계정에 저장하고 문서에 싣는다.
4. (선택) 스냅샷을 씨앗으로 AI 연출컷을 만든다.

**완료**: 디테일 스냅샷을 다시 열면 같은 색으로 복원되고, 같은 값이 BOM `finishCode` 와 작업지시서 스와치에 나타난다.

### B 축 — BOM
1. 도면의 **모든 부재**(판재·상판·마감재·철물·체결구)를 산출한다.
2. 부재마다 **식별자**가 있어 BOM → 재단표 → 라벨 → 조립까지 추적된다.
3. 네스팅 결과를 **저장**해 문서가 동결된다.
4. 작업자가 **그 문서만 보고** 재단·조립·검수할 수 있다.

**완료**: C1 원장 검사가 3D 부재 목록과 BOM 목록의 1:1 대응을 통과하고, 작업지시서 v2 가 공장 검토를 통과한다.

---

## 3. 불변조건 (지켜야 깨지지 않는 것)

| # | 불변조건 | 이유 |
|---|---|---|
| I1 | `buildPlannerPayload` 골든 바이트 동일 (`test-utils/planner-golden.js`) | 구조 단계 회귀 0 원칙. **디테일 데이터는 이 페이로드에 넣지 않는다** |
| I2 | 구조 단계의 화면·피킹 색은 그대로 (`planner-pick-highlight.test.js`, `planner-view-keep.test.js`) | 디테일 재질은 **디테일 모드에서만** 켠다 |
| I3 | `design_snapshots` · `design_documents` 는 append-only, `render_payload` 동결 | 과거 작업지시서가 바뀌면 안 된다 (`work-order.js:1-10`) |
| I4 | `bom_payload.materials[]` 기존 필드는 유지, 필드 **추가만** | 워커 검증(`snapshots.js:64-93`)과 과거 스냅샷 호환 |
| I5 | 파일 소유권 (CLAUDE.md). 같은 도메인 병렬 금지 | 충돌 방지 |
| I6 | 카탈로그 값은 **더하기만**, 코드 이름 변경 금지 | `finishCode` 가 과거 문서·가격에 박혀 있다 |

---

## 4. 핵심 설계 결정 [결정]

### 4.1 디테일 UI 는 구조 페이지 안의 **모드**로 시작한다
- 근거: 부재 피킹(raycaster + `entityKind`)과 3D 씬이 이미 `mockup-structure.html` 에 있다. 별도 페이지를 만들면 7,000줄을 복제한다.
- 🎨 버튼 → `?stage=detail` 모드 전환. 모드에서는 (a) 좌측 팔레트가 마감 카탈로그로 바뀌고, (b) 클릭한 부재에 마감을 칠하고, (c) 3D 가 재질 모드로 전환된다.
- 로직은 `js/planner/planner-detail.js` (신규, 클래식 스크립트) 에 두고 HTML 인라인은 이벤트 연결만 한다. 이후 페이지 분리가 필요하면 그때 뗀다.

### 4.2 디테일 데이터 모델 — 새 저장 키, 우선순위 4단
```
dadam_detail_v1::{design}:{item} = {
  version: 1,
  item:     { door:{code}, drawerFront:{code}, body:{code}, top:{code}, handle:{code}, finishing:{code}, kick:{code} },
  sections: { upper:{ door:{code} }, lower:{ door:{code} } },          // 상/하 재정의 (기존 specs 상/하 값과 호환)
  modules:  { [moduleId]: { door:{code}, body:{code}, drawerFront:{code} } },
  parts:    { [moduleId]: { [partKey]: {code} } }                      // 예: door#2 만 다른 색
}
```
- 해석 순서 **부재 > 모듈 > 섹션 > 품목 > 카탈로그 기본**. 해석 함수는 `resolveFinish(slot, moduleId, section, partKey)` 하나이고 3D 와 BOM 이 **같은 함수**를 쓴다 (`js/planner/planner-finish.js`, `planner-sections.js` 처럼 두 페이지가 공유).
- `code` 는 카탈로그 정본 코드 (`PET-OAK-M`). 화면 표시명·hex·텍스처는 코드로 카탈로그에서 찾는다.
- `PLANNER_STAGE_KEYS.detail = { detail: 'dadam_detail_v1' }` 로 채워 `planner_snapshots(stage='detail')` 이 진짜 저장본이 된다. 기존 `{specs, modules}` 복사본은 `plannerSnapshotSummary` 가 계속 읽는다 (호환).
- 상세설계 쪽 정본: `design_items.detail JSONB` 컬럼 추가 (NULL 허용). `specs.doorColorUpper/Lower` 등 기존 키는 **파생 미러**로 계속 채운다 (AI 연출컷·견적이 읽는다).

### 4.3 마감 카탈로그 정본은 `materials` 표 하나
- `materials` 에 컬럼 추가: `code TEXT UNIQUE`, `finish_code`, `color_code`, `tone(matte|gloss|single)`, `slot[]`(door/body/top/handle/finishing/kick), `roughness`, `metalness`, `clearcoat`, `texture_url`, `normal_url`, `tile_mm`, `grain(none|h|v)`, `price_key`, `vendor_code`, `sort`, `active`.
- 시드: `bom-finish-color.js` 7×7 + `FurnitureOptionCatalog` 폴백 + 상판 4종. **두 7색 목록 중 무엇이 실제 제품군인지 [확인 필요]**.
- `bom-finish-color.js` 는 카탈로그 위의 얇은 해석기 + 오프라인 폴백으로 축소. `FurnitureOptionCatalog.load()` 가 한 번 읽어 플래너(iframe)에도 `postMessage` 로 넘긴다 (플래너는 Supabase 를 직접 읽지 않아도 된다).
- 가격은 계속 `pricing_rules` (`door_finish_base`·`door_color_mult`). `price_key` 로만 연결.

### 4.4 렌더링은 3층
| 층 | 내용 | 필수 |
|---|---|---|
| R1 실시간 | `makeBox` → `makeMaterial(code)`: 코드별 재질 캐시, `TextureLoader` + mm 단위 `repeat`(tile_mm), 결 방향, gloss 는 `MeshPhysicalMaterial.clearcoat`, `outputColorSpace=SRGB`, ACES 톤매핑, `RoomEnvironment` PMREM. **디테일 모드에서만** 켠다 (I2) | 예 |
| R2 스냅샷 | 캡처용 별도 `WebGLRenderTarget` 2K/4K → PNG → Storage 버킷 `renders/{design}/{item}/…` → 새 표 `design_renders`. 카메라 프리셋: 정면 입면·3/4·모듈별·평면 | 예 |
| R3 AI 연출 | R2 정면 스냅샷 + 카탈로그 `texture_prompt` → `generate-api` 신규 경로 `POST /api/generate/render` (같은 DO). 기하 유지 지시 | 선택 |

### 4.5 BOM 은 **부재 모델**로 수렴한다 (단계적)
- 지금: 3D 빌더(`createModuleMesh` 계열)와 `extractors.js` 가 **각자** 부재를 만든다. 둘이 어긋나면 "도면과 다른 BOM" 이 된다.
- C1a (빠름): 두 출력을 **원장(ledger)** 으로 대조하는 시험을 먼저 놓는다. 3D 씬을 순회해 `{moduleId, entityKind, w,h,d}` 목록을 뽑고 BOM `{module, part, w,h,qty}` 와 1:1 대응을 검사한다. 어긋나는 것이 곧 버그 목록이다.
- C1b (느림): `js/planner/part-model.js` 가 modules+structures+detail 에서 부재 목록을 만들고, 3D 도 BOM 도 그것을 소비하도록 옮긴다. 코너 한 부재씩 옮겨온 최근 흐름(`97d07df`, `f367fdd`)의 연장이다.

### 4.6 작업지시서 v2 는 같은 `work_order` 문서에 **섹션을 더한다**
- 새 doc_type 을 늘리지 않는다 (DB CHECK·렌더 분기 동시 수정 부담, `documents.js:42`). 라벨 시트만 `label_sheet` 로 분리 검토.
- 스냅샷에 `cut_plan_payload JSONB` (시트별 배치) 와 `render_refs JSONB` (스냅샷 이미지 경로) 를 추가해 문서가 그것만 읽게 한다 (I3).

---

## 5. 단계별 로드맵

각 항목: **목표 → 변경 파일(소유 도메인) → 시험 → 완료 기준 → 브랜치**. 크기는 PR 기준(S ≤ 300줄, M ≤ 800, L 그 이상).

### C 축 — 공통 (먼저)

**C0. 마감 카탈로그 정본** (M) `agent/catalog-unify`
- `database/materials-catalog-v2.sql`: 컬럼 추가 + 시드 + `get_materials_catalog()` RPC. 두 번 실행 안전 (IF NOT EXISTS 관례, `dataset-schema.test.js` 방식으로 시험).
- `js/detaildesign/config-constants.js` `FurnitureOptionCatalog`: `byCode()`, `forSlot(slot, category)`, 플래너로 `DADAM_CATALOG` postMessage.
- `js/detaildesign/bom-finish-color.js`: 카탈로그 우선, 내장 표는 폴백. 기존 `getFinishColorCode` 결과 불변 시험.
- 완료: 상세설계 도어색 셀렉트가 카탈로그 코드로 저장되고 기존 한글 값(`'화이트'`)도 읽힌다.

**C1a. 도면↔BOM 원장 시험** (M) `agent/bom-ledger`
- `test-utils/scene-parts.js`: jsdom + three 로 `renderAll3D` 결과를 순회해 부재 목록화 (기존 `planner-to-bom.test.js` 의 다리 재사용).
- `__tests__/scene-bom-ledger.test.js`: 골든 3벌 + 코너 픽스처에서 3D 부재 ↔ BOM 행 대응. 처음엔 **알려진 차이를 허용 목록**으로 두고 시작, 항목마다 이슈화.
- 완료: 허용 목록이 문서화되고 CI 게이트가 된다.

**C1b. 부재 모델로 이전** (L, 3단계 이후) `agent/part-model-*`
- 코너/멍장 → 도어·서랍전판 → 몸통 순으로 옮긴다. 각 이전마다 C1a 허용 목록이 줄어야 한다.

### D 축 — 디테일

**D0. 디테일 모드 뼈대** (M) `agent/planner-detail-mode`
- `mockup-structure.html`: 🎨 버튼 → `?stage=detail`, 모드 플래그, 좌측 팔레트 교체 자리, 우측 패널 "선택 부재 마감" 카드.
- `js/planner/planner-detail.js` (신규): 상태 `detail`, `resolveFinish` 는 `planner-finish.js` 로 분리, 부재 클릭 → 슬롯 판정(`entityKind` → door/body/top/handle/finishing/kick), 일괄 적용(품목/섹션/모듈), 되돌리기.
- `js/planner/planner-store.js`: `PLANNER_STAGE_KEYS.detail` 채움, 디테일 저장 버튼 활성 (`mockup-structure.html:5194-5196` 조건 제거).
- 시험: 골든 I1 그대로. `planner-detail.test.js` (해석 우선순위, 저장/복원 왕복).
- 완료: 색을 칠하고 저장·불러오기가 왕복한다 (3D 는 아직 단색이어도 됨).

**D1. 상세설계 왕복** (S) `agent/designui-detail-sync` — Design UI 도메인
- 플래너 → 부모 `PLANNER_DETAIL_CHANGE {detail}`; 부모는 `item.detail` 저장 + `specs.doorColorUpper/Lower` 미러 갱신. 수신 코드는 `ui-step1.js:1470-1483` 패턴 재사용.
- `persistence-init.js`: `design_items.detail` 저장/로드. `database/design-items-detail.sql`.
- 완료: 상세설계 저장 → 다시 열기 → 플래너 디테일 모드가 같은 색.

**D2. R1 실시간 재질** (M) `agent/planner-materials`
- `js/planner/planner-materials.js` (신규): `makeMaterial(code)` 캐시, 텍스처 로더, tile/grain, gloss.
- `mockup-structure.html`: `init3D` 에 색공간·톤매핑·환경맵, `makeBox` 에 `material` 옵션. 디테일 모드에서만 적용 (I2).
- 텍스처 자산: `materials.texture_url` 시드 (Storage `materials/`), 512~1024px 타일. **실제 자재 사진 [확인 필요]**.
- 완료: 오크·PET 광택·도장 무광이 구분되어 보인다. 구조 모드 화면 시험 통과.

**D3. R2 스냅샷 저장** (M) `agent/planner-render-capture`
- 캡처 렌더타깃, 카메라 프리셋, PNG 업로드, `database/design-renders.sql` (`design_renders`: design_id, item_unique_id, kind, path, url, camera JSONB, detail_hash, created_at; RLS 는 `designs.user_id` 경유).
- `my-designs.html` 에 렌더 썸네일. 작업지시서 표지에 정면 렌더(B5 에서 소비).
- 완료: 버튼 한 번에 4장이 저장되고 문서에서 열린다.

**D4. 렌더 품질** (S~M) `agent/planner-render-quality`
- 그림자 해상도, 접촉 그림자, 벽·바닥 재질(배치 단계 `person`·벽 정보 재사용), 상판 물끊기·엣지 표현.

**D5. R3 AI 연출 (선택)** (M) `agent/imggen-render` — Image Gen 도메인
- `workers/generate-api`: `render` 잡 종류, 입력 이미지 = D3 정면, 프롬프트 = 카탈로그 `texture_prompt`. `generations.design_id`·`item_unique_id` 컬럼 추가로 설계와 연결 (지금은 끊겨 있음).

### B 축 — BOM

**B0. 정본 확정과 안전판** (M) `agent/bom-golden`
- `__tests__/bom-golden-{sink,wardrobe,fridge}.test.js`: 현재 출력을 골든으로 동결 (표준 부재표 시험 0 → 커버).
- 드리프트 정리: 멍판 마감재 폴백 100 → 150 으로 맞추고 시험 픽스처 갱신 (정본은 `data-constants.js:89` 의 150). `DrawingVisualizer` 의 1220×2440 하드코딩 → `SHEET_W/H`.
- MCP `bom.service.ts`: `generate_bom` 을 프론트 `MaterialExtractor` 호출 래퍼로 바꾸거나 "프로토타입" 명시 + 값 동기 (MCP 도메인, 별도 PR).
- `docs/design-rules/bom-protocol.md` §1 표에 정본 선언.

**B1. 부재 식별자 · 마감 코드 · 엣지 길이** (M) `agent/bom-part-id`
- `extractors.js add()`: `partId = {itemIdx}-{moduleId}-{partKey}-{n}`, `slot`, `finishCode = resolveFinish(...)` (D0 의 같은 함수), `edges:{L,R,T,B}`, `edgeLen mm`, `edgeT (0.6|1.0)`, `edgeCode`. 기존 문자열 `edge` 유지 (I4).
- 몸통 노출 측판(끝 모듈)도 마감 코드를 받는다 (`body` 슬롯).
- 완료: 골든 갱신 diff 가 "필드 추가만" 이다.

**B2. 누락 자재 보강** (L, 여러 PR) `agent/bom-missing-*`

| 항목 | 규칙 소스 | 상태 |
|---|---|---|
| 상판 (PT18 / 인조대리석 12·50), 개수대·쿡탑 타공, 물끊기, 백스플래시 | `bom-protocol.md §2` 두께만 있음 · `sink.md §9` 상판 | 양식 `hardware.md` §8 — 공장 값 **[확인 필요]** |
| 냉장고장 좌대·마감재·EP | fridge 분기가 생략 | `fridge.md` 로 명문화 · 양식 `hardware.md` §9 |
| 경첩: 도어 폭·높이·오버레이별 개수·종류, EL 리프트업, 댐퍼 | `extractors.js:1474` 높이만 | 양식 `hardware.md` §1 — 공장 값 **[확인 필요]** |
| 레일: `drawerCount` 반영, 언더/사이드, 내부서랍 | `extractors.js:1526` 과소 | 즉시 수정 · 양식 `hardware.md` §2 |
| 체결구: 미니픽스·목다보·스크류·타카·본드 | `extractOthers` 빈 함수 | 양식 `hardware.md` §3·§4 — 공장 값 **[확인 필요]** |
| 선반핀·걸레받이 클립·다리발 개수 | 부분 | 보강 · 양식 `hardware.md` §5·§6 |
| 손잡이·목찬넬 최소 수 · 좌대 | `extractHandles` · 좌대는 wardrobe 분기만 | 양식 `hardware.md` §7·§9 |

- 각 항목이 독립 PR. 규칙 값은 `bom-rules.json` 과 문서에 함께 적는다.
- **규칙 값 입력 양식** `docs/design-rules/hardware.md` (B2 준비, 2026-09-16): 항목마다 「현재 코드 값(파일:줄) · 공장 값(빈칸)」.
  `bom-rules.json` `hardware` 블록이 같은 키를 `null` 로 들고 있고 `__tests__/bom-rules-hardware-form.test.js` 가 양식 ↔ JSON 동기를 잠근다.
  값이 오면 문서 → JSON → extractors PR → 골든 재생성 순으로 반영한다 (양식 "적용 절차").

**B3. 카테고리 확장** (M×n) `agent/bom-category-*`
- 신발장·화장대·수납장·창고장(`simple-categories.md`), 아일랜드, 도어교체(도어만), 비규격장(사용자 부재표). 각각 골든 시험과 함께.

**B4. 네스팅 단일화 · 저장** (L) `agent/bom-nesting`
- `js/detaildesign/nesting-engine.js` (신규, 순수 함수): `calcCuttingPlan` 을 옮기고 `DrawingVisualizer.packParts`·`NestingOptimizer` 제거. 결 방향·자재별 원판 크기·가장자리 트림·회전 금지 플래그(무늬목·PET)·커프.
- 출력 `cutPlan = { sheets:[{no, material, thickness, size, parts:[{partId, x,y,w,h,rot}], yield}], offcuts:[…] }`.
- `workflow-client.js` 스냅샷 POST 에 `cutPlan` 동봉 → 워커 `snapshots.js` 검증(부재 합 = materials 수량) → `design_snapshots.cut_plan_payload`.
- 시험: 결정성(같은 입력 같은 배치), 수량 보존, 겹침 없음.

**B5. 작업지시서 v2** (L) `agent/workflow-workorder-v2` — 워커
- `work-order.js` 섹션 추가: ① 표지에 정면 렌더(D3) + 색 스와치 범례(hex + 이름 + 코드), ② **모듈별 키팅 시트**(부재 partId·치수·마감·엣지 면 도식·수량), ③ **시트별 재단표**(시트 번호, 배치 SVG 축소판, 부재 표), ④ 철물·체결구, ⑤ 보링 좌표표(`hardware.note` 자유문 → 구조화), ⑥ 조립 순서 체크박스, ⑦ 이전 rev 와의 차이.
- 라벨: 부재당 QR(partId) — 외부 CDN 불가 환경이므로 워커 내 소형 QR 인코더 모듈. `label_sheet` doc_type 은 **[결정 보류]** (우선 work_order 부록).
- `drawing-viewer.html` 을 `?snapshot=` 으로 연결해 동일 데이터를 보게 한다.
- 완료: 공장 검토 1회 반영.

**B6. 기계용 출력** (M, 후순위) `agent/workflow-machine-export`
- 서버 생성 CSV/XLSX(문서 동결), 필요 시 DXF. **판넬쏘·CNC 기종·포맷 [확인 필요]**.

---

## 6. 순서와 병렬성

```
1단계 (토대)      C0 ─┬─ D0 ─ D1
                     └─ B0 ─ B1 ─ C1a
2단계 (본체)      D2 ─ D3        B2(항목별) ─ B4
3단계 (전달)      D4             B5 ─ B3 ─ drawing-viewer
4단계 (확장)      D5(선택)       B6 · C1b
```
- 도메인별로 **동시에 하나**만 연다 (CLAUDE.md). 플래너(D)·BOM(B)·워커(B5,B6)·Design UI(D1)·Image Gen(D5)·MCP(B0 일부)는 서로 다른 도메인이라 병렬 가능.
- C0 은 D0·B1 의 전제. B0 골든은 B1 이전에 반드시.
- 제안: CLAUDE.md 소유권 표에 **플래너 행 추가** (`mockup-*.html`, `js/planner/*` → `agent/planner-*`) 와 **워커 행 추가** (`workers/workflow-api/**` → `agent/workflow-*`). 현재 표의 3D Planner 행(`lib/planner.ts`)은 정지된 코드다.

대략 규모: 1단계 5 PR, 2단계 8~10 PR, 3단계 5~6 PR, 4단계 4 PR. 한 세션이 하루 1~2 PR 을 낸다고 보면 3~4주에 1~3단계.

---

## 7. 시험 전략

| 층 | 무엇 | 도구 |
|---|---|---|
| 골든 | 플래너 페이로드(I1), BOM 표준 3종(B0), 네스팅 결정성(B4) | jest, `test-utils/planner-golden.js` |
| 원장 | 3D 부재 ↔ BOM 행 1:1 (C1a) | jsdom + three |
| 해석 | `resolveFinish` 우선순위, 저장/복원 왕복, 카탈로그 코드 불변 | jest |
| 서버 | 스냅샷 검증(cutPlan 합), 문서 렌더 스냅샷(HTML 골든), QR 디코드 | `workers/workflow-api/test` (vitest) |
| 화면 | 구조 모드 색 불변(I2), 디테일 모드 재질 적용, 캡처 4장 | 기존 `planner-*.test.js` + 브라우저 확인 |
| SQL | 두 번 실행 안전·파괴 문장 없음 (`dataset-schema.test.js` 방식) | jest |

---

## 8. 리스크

| 리스크 | 대응 |
|---|---|
| `mockup-structure.html` 7,000줄에 디테일 모드가 얹히면 더 무거워진다 | 로직은 전부 `js/planner/planner-detail.js`·`planner-materials.js` 로, HTML 은 연결만. 클래식 스크립트 전역 이름 충돌 주의(파일 머리말 경고) |
| 텍스처 로드로 첫 화면이 느려진다 | 디테일 모드 진입 시에만 로드, 타일 1024px 이하, 코드별 캐시 |
| 골든 갱신이 "왜 바뀌었나" 를 가린다 | 필드 추가 PR 과 값 변경 PR 을 섞지 않는다 (planner-rewrite 원칙) |
| 철물·체결구 규칙 값이 틀리면 공장 신뢰를 잃는다 | 값은 반드시 공장 확인 후 `bom-rules.json` + 문서에 출처·날짜 기재. 확인 전에는 "추정" 배지로 표시 |
| 카탈로그 코드가 실제 발주 코드와 다르다 | C0 에서 `code` 와 별도로 `vendor_code` 컬럼을 둔다 |
| `designs` 스키마 이중 정의 (`schema.sql` vs `designs-schema.sql`) | 새 컬럼은 `design_items`·새 표에만 넣는다. `designs` 는 건드리지 않는다 |
| MCP 서버 BOM 과 값 불일치가 AI 답변에 섞인다 | B0 에서 래퍼화 또는 프로토타입 명시 |

---

## 9. 사용자 결정 필요 [확인 필요]

1. **디테일 UI 위치**: 구조 페이지 내 모드(권장) vs 별도 페이지.
2. **지정 단위**: 품목/섹션/모듈/부재 4단(권장) 중 첫 출시 범위. 부재 단위(도어 한 장만 다른 색)를 1차에 넣을지.
3. **실제 제품군**: 두 7색 목록 중 무엇이 판매 라인인가. 상판·손잡이·몸통(측판 노출면) 카탈로그 범위.
4. **자재 코드**: `PET-OAK-M` 형식이 발주 코드인가, 별도 업체 코드가 있는가.
5. **텍스처 원본**: 자재 실사 타일을 제공할 수 있는가 (없으면 색+광택만으로 시작).
6. **렌더 수준**: R1+R2 필수 확인, R3 AI 연출 포함 여부.
7. **멍판 마감재 재단폭**: 150 이 정본이 맞는지 한 번만 확인 (코드상 W12-72 결정). 맞으면 B0 에서 폴백·시험만 고친다.
8. **철물·체결구 규칙 값**: 경첩 개수표, 미니픽스/목다보/스크류 개수, 레일 종류. — **양식 작성 중** (`docs/design-rules/hardware.md` §1~§7, 공장 값 빈칸).
9. **상판 규칙**: 두께·재질·타공·물끊기·이음 위치. — **양식 작성 중** (`docs/design-rules/hardware.md` §8, 좌대 §9).
10. **작업지시서 우선순위**: 모듈별 키팅 / 시트별 재단표 / QR 라벨 / 보링 좌표 중 공장이 먼저 원하는 것. 기계 포맷.

---

## 10. 첫 주 실행 항목

1. §9 의 1·2·3 답을 받는다 (나머지는 진행 중 받아도 된다).
2. `agent/catalog-unify` (C0) — SQL + 카탈로그 로더 + 시험.
3. `agent/bom-golden` (B0) — 표준 3종 골든 동결, 드리프트 정리.
4. `agent/planner-detail-mode` (D0) — 모드·저장 키·`resolveFinish`.
5. CLAUDE.md 소유권 표에 플래너·워커 행 추가 (문서 PR).
