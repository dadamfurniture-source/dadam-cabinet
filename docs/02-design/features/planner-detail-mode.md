# 플래너 디테일 모드 (D0 — 뼈대 · D2 — 실시간 재질)

> 계획: `docs/01-plan/detail-bom-deepening.plan.md` §4.1 · §4.2 · §5 D0 (PR #632) · §4.4 R1 · §5 D2 (`agent/planner-materials`).
> 3D Planner 도메인. D2 절은 이 문서 끝에 있다.

## 무엇인가

🎨 **3.디테일** 버튼에 처음으로 핸들러가 생겼다. 별도 페이지가 아니라 **구조 페이지(`mockup-structure.html`) 안의 모드**다
(§4.1 — 부재 피킹과 3D 씬이 이미 그 페이지에 있으므로 7,000줄을 복제하지 않는다).

- 진입: 🎨 버튼, 또는 `?stage=detail` (배치 페이지의 🎨 는 이 URL 로 넘어온다). 다시 누르거나 📦 2.구조 를 누르면 나온다.
  URL 의 `stage=detail` 은 `history.replaceState` 로 따라다니고, 배치로 돌아갈 때 뗀다.
- 모드에서:
  1. 좌측 모듈 목록 자리가 **마감 팔레트**로 바뀐다 — 카탈로그 7 마감 × 7 색 스와치(hex·라벨·코드), 슬롯 선택
     (도어/서랍 앞판/몸통/상판/손잡이/마감재/걸레받이·좌대), 일괄 적용 줄(품목 전체/상부 전체/하부 전체/이 모듈), 되돌리기(10장).
  2. 3D 부재를 누르면 고른 마감을 **그 부재**에 칠한다. Shift+클릭은 그 모듈의 같은 슬롯 전부.
     고른 마감이 없으면 카드만 보여 준다(스포이드).
  3. 우측 패널에 **선택 부재 마감** 카드 — 해석된 코드·라벨·hex 와 그것이 어느 단계(부재/모듈/섹션/품목)에서 정해졌는지,
     적용·해제 버튼, 품목 기본값 목록.
  4. 3D 는 `renderAll3D` 뒤의 후처리(`PlannerDetail.paintScene`)로 부재 `material.color` 를 카탈로그 hex 로 덮는다 — 단색.
- 모드 밖에서는 **아무것도 하지 않는다.** 훅 두 줄(`handleEntityClick` 맨 앞, `renderAll3D` 끝)은 `isActive()` 가 거짓이면
  바로 빠진다. 구조 단계의 색·피킹은 그대로다 (불변조건 I2).

## 데이터 모델 (`js/planner/planner-finish.js`, 순수)

저장 키 `dadam_detail_v1` (스코프 키 `::{design}:{item}` — `scopedKey`), `PLANNER_STAGE_KEYS.detail = { detail: 'dadam_detail_v1' }`.

```
{
  version: 1,
  item:     { door:{code}, drawerFront:{code}, body:{code}, top:{code}, handle:{code}, finishing:{code}, kick:{code} },
  sections: { upper:{ [slot]:{code} }, lower:{ [slot]:{code} } },
  modules:  { [moduleId]: { [slot]:{code} } },
  parts:    { [moduleId]: { [partKey]: {code} } },
}
```

- 해석 `plannerFinishResolve(detail, slot, moduleId, section, partKey)` → `{code, level}` | `null`.
  순서 **부재 > 모듈 > 섹션 > 품목 > null**. 섹션 묶음은 상/하 둘 — `upper|hood → upper`, 나머지 → `lower`
  (상세설계의 `doorColorUpper/Lower` 와 같은 구분).
- `code` 는 카탈로그 정본 코드(`PET-OAK-M`, `js/detaildesign/bom-finish-color.js`). 모델에는 코드만 둔다 (I6).
- `entityKind → slot`: door·doorEdge·blank → door / carcass·shelf·brace → body / top-panel → top / handle → handle /
  finishing·blind·blindfin·molding → finishing / toe-kick·pedestal → kick / leg·area·module·pick·edge·reveal·carcass-line → null.
  `carcass` 는 `side`/`areaType` 로 다시 가른다 (front+drawer → drawerFront, front+door → door, finish → finishing,
  channelBase/Face → handle). 이유는 파일 주석에.
- 부재 키 `plannerFinishPartKeyOf(userData)`: `door#1`, `door#1-0`(양문 왼쪽), `drawer#0`, `drawer#b0`(하단 서랍줄),
  `body:left`, `body:divider#1`, `shelf#0-2`, `top`, `kick`, `pedestal`, `molding`, `handle`, `leg#3`, `blind#0`, `finishing#0` …
  3D 빌더에는 `addFrontPanel` 의 `carcassMeta` 에 `areaIdx·areaPos·cellIdx` 를 **userData 로만** 더했다 (기하·색 불변).
- 칠하기에서 빼는 종류(`PLANNER_FINISH_PAINT_SKIP`): edge·reveal·doorEdge·carcass-line·pick·area·module·leg —
  도어 테두리·그림자판을 칠하면 도어 사이 갭 표시가 사라진다.
- 카탈로그: `window.DadamBomFinishColor` 를 script 태그로 싣는다 (IIFE 라 전역 이름 충돌 없음). 없으면 같은 코드의 폴백
  (`PLANNER_FINISH_FALLBACK`) — 시험이 `buildFullMatrix()` 와 대조한다.

## 저장·불러오기

- 칠할 때마다 localStorage → `plannerAutosave('detail')`(1.5초 디바운스 → `PlannerStore.save('detail', {autosave})`) →
  부모에 `postMessage({type:'PLANNER_DETAIL_CHANGE', detail})`. 부모가 아직 받지 않아도 무해하다.
- 상단 우측 **📥 마감 불러오기 / 💾 마감 저장** (디테일 모드에서만 보임) — `planner-drawing-menu.js` 를 `stage:'detail'` 로 한 번 더 마운트.
  되쓰기는 페이지를 다시 열지 않고 `PlannerDetail.reload()` 로 제자리 갱신.
- 옛 `{specs, modules}` 저장본: 목록 요약은 계속 `모듈 N개`, 되쓰기는 `DADAM_RESTORE_DETAIL` 로 부모에 넘긴다.
  새 형식 요약은 `마감 지정 N건`.
- 부모 → 플래너 수신부 `DADAM_DETAIL_SET {detail}` (같은 오리진만) 를 미리 두었다 — D1 이 쓴다.

## 불변조건 확인

- I1 골든: `planner-golden.test.js` 스냅샷 3종 그대로. `planner-detail-mode.test.js` 가 칠한 뒤 `buildPlannerPayload` 바이트 동일 +
  `detail`/코드가 payload 에 없음을 본다.
- I2 화면·피킹: `planner-pick-highlight` · `planner-view-keep` 그대로. 정면도 SVG 는 모드와 무관하게 같고, `paintScene` 은 모드 밖에서 0.
- `planner-assets.test.js`: 새 스크립트 3개(카탈로그·finish·detail) 순서, 배치 페이지에는 싣지 않음, 전역 이름 충돌 없음.

## 미룬 것 (D0 시점)

- **D1 상세설계 왕복** (Design UI 도메인): 부모가 `PLANNER_DETAIL_CHANGE` 를 받아 `design_items.detail` 저장 + `specs.doorColorUpper/Lower` 미러,
  다시 열 때 `DADAM_DETAIL_SET` 으로 되돌려 주기. → **#637 에서 됐다.**
- **D2 R1 실시간 재질**: 텍스처·광택·조명·색공간. → **아래 D2 절.** 텍스처만 남았다.
- 정면도(2D SVG)에는 마감 색을 칠하지 않는다 — 3D 만.
- BOM 이 `plannerFinishResolve` 를 읽는 것은 B 축. → **#638 (B1) 에서 됐다.**

---

# D2 — 실시간 재질 (R1): 카탈로그 팔레트 + PBR(색·광택) + 환경광

> 계획 §4.4 R1 · §5 D2. 사용자 결정(2026-09-15): **팔레트 정본 = 예림 LUX 144**, **색 + 광택만, 텍스처 없음**(훅만 준비),
> 톤이 없는 행은 **무광**, 상판은 C0 의 `countertop` 행. 구조 모드는 바이트 하나 달라지지 않는다 (I2).

## 카탈로그 소스 (`js/planner/planner-catalog.js`)

- `PlannerCatalog.load()` 가 `materials` 표를 읽는다 — `PlannerStore.client()` 와 같은 Supabase 클라이언트(anon, 부모 세션 공유).
  `select code, vendor, vendor_code, series, finish, tone, color_name, color_hex, roughness, metalness, clearcoat, grain, texture_url, tile_mm, slot, category, sort
   where active = true order by sort`.
- 읽는 순서: **sessionStorage 캐시** `dadam_catalog_v1`(행 원본 + 시각, 1시간) → DB → 낡은 캐시 → 로컬 정본. 언제나 resolve 한다.
  예림 행이 0 인 DB 는 캐시하지 않는다(시드가 들어오면 바로 보이게). `PlannerCatalog.sync()` 는 네트워크 없이 캐시/로컬 정본으로
  즉시 만든다 — `PlannerDetail.mount` 가 그걸로 먼저 그리고 `load()` 가 끝나면 갈아 끼운다(나중에 시작한 load 가 이긴다).
- 그룹(`groups[]`): 예림 행은 `series → finish` (`Supreme · PET Matt`, `Body · PVC` …; `finish` 열의 series 접두를 뗀다), 순서는
  Prestige → Supreme → Deco → Prime → Body, 안에서는 `sort`. 그 다음 **상판**(`countertop`, `TOP-*`), 맨 뒤 **기타(호환)** —
  `plannerFinishCatalog(window.DadamBomFinishColor)` 의 `PET-OAK-M` 코드들 **+ C2b 호환 코드 `{COLOR}-M` / `{COLOR}-G`**
  (`WHT-G` …, 색 목록 옛 7색 + GRY BGE NVY × 무광·유광 = 20 — `plannerCatalogCompatToneEntries`, P2 #PR). 부모 셀렉트가
  `specs.doorMaterial*` 에 싣는 합성 코드라 `materials.code` 에는 없다 — 여기 없으면 `plannerFinishLookup` 이 못 찾아 그 부재가
  색을 잃는다 (designui-catalog-select.md "합성 코드가 다른 경로에 미치는 것"). 라벨은 부모와 같은 '기타(호환)'.
  호환 그룹은 예림이 있을 때만 접혀 있고 슬롯 전부를 가진다 (손잡이·마감재·걸레받이 슬롯은 DB 에 category 가 없어 이 그룹뿐이다).
  같은 코드가 두 번 오면 앞의 것.
- 항목(`entries[]`)은 D0 필드(`code·label·hex·finish·finishLabel·tone·color·colorLabel`)를 그대로 두고 **더하기만** 했다:
  `roughness·metalness·clearcoat·grain·slots[]·group·series·vendor·vendorCode·textureUrl·tileMm·category·sort`. `byCode` 사전도 준다.
  `plannerFinishLookup / plannerFinishHex` 가 그대로 읽는다. DB 의 `drawer_front` 슬롯은 `drawerFront` 로, `slot` 이 비면 category 로
  (door_material → door·drawerFront, body_material → body, countertop → top).
- `source: 'db' | 'local' | 'builtin'`, `fallback = source !== 'db'`. 팔레트 머리: `예림 LUX 144` / `카탈로그 7×10` / `폴백 목록`.

## 팔레트 UI

- 그룹은 `<details>` 접이식 섹션(제목 · 개수). 접힘 상태는 `PlannerDetail.groupOpen` 에 남아 다시 그려도 유지된다.
- 스와치 = hex 칩 + 색 이름 + 공급사 코드(`SM-01`; 구 코드는 코드 그대로). 4열 그리드(좌측 패널 220px).
- **슬롯 필터**: 지금 슬롯이 그룹의 `slots` 에 없으면 숨긴다 — 몸통 → body_material, 상판 → countertop, 도어·서랍 앞판 → door_material.
- **검색**(이름·코드·공급사 코드 부분 일치): 입력칸은 다시 만들지 않고 그룹만 다시 그린다(포커스 유지). 검색 중에는 맞는 그룹을 펼친다.
- 일괄 적용 줄·되돌리기·"선택 부재" 카드는 D0 그대로. DB 코드(`YR-SG-01`)도 같은 모델·저장·해석 길을 탄다.

## PBR 매핑 (`js/planner/planner-materials.js`)

`PlannerMaterials.get(entry)` → 코드별 `THREE.MeshPhysicalMaterial` 하나(캐시). 카탈로그를 다시 읽으면 `dispose()`.

| 입력 | 재질 |
|---|---|
| `color_hex` | `color.setStyle(hex)` — `ColorManagement.enabled = true` 라 sRGB → linear 는 three 가 한다 |
| `tone = matte` / `single` / null | roughness **0.75**, metalness 0, clearcoat 0 |
| `tone = gloss` | roughness **0.25**, metalness 0, clearcoat **0.6**, clearcoatRoughness **0.15** |
| 행의 `roughness · metalness · clearcoat` | 있으면 tone 기본값보다 우선 (0~1 로 자른다). 예림 시드는 matte 0.75/0/0, gloss 0.25/0/0.6, single 0.6/0/0 |
| sheen | 0 |
| `name` / `userData` | `finish:{code}` / `{code, tone, hex}` |

**텍스처 훅** (`forMesh(entry, mesh)`): `textureUrl` 이 없으면 — 지금은 전부 없다 — 로더를 만들지도 않고 공유 재질을 그대로 돌려준다(no-op).
있으면 `TextureLoader` 로 한 번 읽어 캐시(`colorSpace = SRGBColorSpace`, `wrapS/T = RepeatWrapping`), mesh 마다 재질 사본에
`repeat = 면(mm) / tile_mm`, 결이 세로(`grain:'v'`)인 자재를 누운 부재(선반·상판·지판)에 쓰면 90° 돌린다(`plannerMaterialsRepeatFor`).
면 크기는 `BoxGeometry.parameters` 에서 — 선 부재는 가로×높이, 누운 부재는 가로×깊이(`plannerMaterialsFaceOf`).

## 모드 진입·이탈이 바꾸는 것 (`PlannerDetail.applyScene`)

| | 진입 (`enter`) | 이탈 (`exit`) |
|---|---|---|
| `renderer.outputColorSpace` | `SRGBColorSpace` | 저장해 둔 값 |
| `renderer.toneMapping` / `toneMappingExposure` | `ACESFilmicToneMapping` / 1.0 | 저장해 둔 값 |
| `scene.environment` | `RoomEnvironment` → `PMREMGenerator.fromScene(room, 0.04)` | 저장해 둔 값, PMREM target `dispose()` |
| 조명 (`AmbientLight` · `DirectionalLight` · `HemisphereLight`, 씬 직속) | `intensity × 0.5` (환경광이 채운다) | 저장해 둔 값 |
| 부재 재질 | `paintScene` 이 `mesh.material` 을 코드별 PBR 로 **바꿔 끼움**, 원래 것은 `userData._origMaterial` | `unpaintScene` 이 되돌린 뒤 `renderAll3D` |

- `RoomEnvironment` 는 importmap 모듈 스크립트가 `three/addons/environments/RoomEnvironment.js` 에서 `window.RoomEnvironment` 로 올린다
  (OrbitControls 와 같은 CDN 패턴). 없거나 WebGL 이 없으면 환경맵만 건너뛴다.
- `three` 묶음은 `PlannerDetail.mount({ three: () => three })` 로 받는다. `init3D` 가 `three-ready` 뒤에 늦게 오면 `enter` 시점엔 null 이라
  **첫 `paintScene`** 이 씬을 켠다(`_sceneSaved` 가 없을 때만). 두 번 켜거나 두 번 꺼도 무해.
- 테두리(`LineSegments`)는 mesh 가 아니라 손대지 않는다 — 도어 사이 갭 표시가 남는다. `PLANNER_FINISH_PAINT_SKIP` 도 그대로.
- `window.THREE` 가 없으면(jsdom) D0 처럼 `material.color` 만 덮는다.
- 구조 모드: `paintScene` 0, `applyScene` 안 켬, `makeBox`·빌더 불변 — `planner-detail-mode.test.js` 의 I2 시험이 three 를 실어 확인한다.

## 시험

- `planner-catalog.test.js`: 행 → 항목/그룹, 폴백(local·builtin), 캐시(TTL·force·낡은 캐시·깨진 캐시), 슬롯 필터, 검색, 클라이언트 선택.
- `planner-materials.test.js`: tone 별 파라미터·행 값 우선, 캐시·dispose, sRGB→linear, 텍스처 no-op / 있을 때 repeat·회전(three.cjs).
- `planner-detail-mode.test.js` D2 절: 그룹 렌더·슬롯 필터·검색·접힘 유지·loadCatalog 갈아 끼우기, enter/exit 의 renderer·scene·조명 복원,
  PBR 스왑과 `_origMaterial` 복원, I2. D0 시험은 손대지 않았다(팔레트 머리 `카탈로그 7×10` 그대로).
- `planner-assets.test.js`: 새 스크립트 2개의 순서(finish → catalog·materials → detail, store 뒤), 전역 이름 충돌 없음, `?v=38.8` 통일.

## 미룬 것 (D2 시점)

- **텍스처 시드**: `materials.texture_url · tile_mm` 이 전부 null. 실제 자재 타일(512~1024px, Storage `materials/`) **[확인 필요]** — 훅만 있다.
- 정면도(2D SVG)는 여전히 마감 색을 칠하지 않는다.
- D3 스냅샷 저장(R2), D4 렌더 품질(그림자·벽·바닥).
- `materials` 표의 anon `select` RLS 가 막혀 있으면 팔레트는 호환 그룹만 보인다(`폴백`) — 배포 후 확인.
