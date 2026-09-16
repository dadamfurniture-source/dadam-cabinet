# 플래너 디테일 모드 (D0 — 뼈대 · D2 — 실시간 재질 · D3 — 렌더 스냅샷 · D4 — 선택 범위)

> 계획: `docs/01-plan/detail-bom-deepening.plan.md` §4.1 · §4.2 · §5 D0 (PR #632) · §4.4 R1 · §5 D2 (`agent/planner-materials`)
> · §4.4 R2 · §5 D3 (`agent/planner-render-capture`) · D4 선택 범위 (`agent/planner-detail-scope-ui`, 2026-09-16).
> 3D Planner 도메인. D2 · D3 · D4 절은 이 문서 끝에 있다.

## 무엇인가

🎨 **3.디테일** 버튼에 처음으로 핸들러가 생겼다. 별도 페이지가 아니라 **구조 페이지(`mockup-structure.html`) 안의 모드**다
(§4.1 — 부재 피킹과 3D 씬이 이미 그 페이지에 있으므로 7,000줄을 복제하지 않는다).

- 진입: 🎨 버튼, 또는 `?stage=detail` (배치 페이지의 🎨 는 이 URL 로 넘어온다). 다시 누르거나 📦 2.구조 를 누르면 나온다.
  URL 의 `stage=detail` 은 `history.replaceState` 로 따라다니고, 배치로 돌아갈 때 뗀다.
- 모드에서:
  1. 좌측 모듈 목록 자리가 **마감 팔레트**로 바뀐다 — 카탈로그 7 마감 × 7 색 스와치(hex·라벨·코드), 슬롯 선택
     (도어/서랍 앞판/몸통/상판/손잡이/마감재/걸레받이·좌대), 일괄 적용 줄(품목 전체/상부 전체/하부 전체/이 모듈), 되돌리기(10장).
     → **D4 에서 바뀌었다**: 팔레트는 **우측**으로 가고 좌측은 구조 단계와 같은 전체/배치/개별 목록(= 칠할 범위)이 됐다.
  2. 3D 부재를 누르면 고른 마감을 **그 부재**에 칠한다. Shift+클릭은 그 모듈의 같은 슬롯 전부.
     고른 마감이 없으면 카드만 보여 준다(스포이드).
     → **D4 에서 넓어졌다**: 배치 상자·모듈·품목도 고를 수 있고, 고른 뒤 색을 누르면 그 범위 전체가 칠해진다.
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
- **D2 R1 실시간 재질**: 텍스처·광택·조명·색공간. → **아래 D2 절.** 텍스처도 2026-09-16 에 들어왔다.
- **좌측 팔레트 · 부재 단위 칠하기**: → **아래 D4 절 (2026-09-16).** 팔레트는 우측으로 가고, 좌측은 칠할 범위가 됐다.
- 정면도(2D SVG)에는 마감 색을 칠하지 않는다 — 3D 만.
- BOM 이 `plannerFinishResolve` 를 읽는 것은 B 축. → **#638 (B1) 에서 됐다.**

---

# D2 — 실시간 재질 (R1): 카탈로그 팔레트 + PBR(색·광택) + 환경광

> 계획 §4.4 R1 · §5 D2. 사용자 결정(2026-09-15): **팔레트 정본 = 예림 LUX 144**, ~~색 + 광택만, 텍스처 없음~~(훅만 준비),
> 톤이 없는 행은 **무광**, 상판은 C0 의 `countertop` 행. 구조 모드는 바이트 하나 달라지지 않는다 (I2).
> 2026-09-16 (사용자 "색상에 무늬는 표현이 안되는 건가?"): **텍스처를 넣었다** — 예림 스와치 144장을 타일로 만들어
> 저장소에 두고 `texture_url · tile_mm` 을 채웠다. 아래 "PBR 매핑 · 텍스처" 와 `yerim-textures.md`.

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

**텍스처** (`forMesh(entry, mesh)`, 2026-09-16 부터 실제 타일이 있다 — #PR):
`textureUrl` 이 있으면 `TextureLoader` 로 한 번 읽어 캐시(`colorSpace = SRGBColorSpace`, `wrapS/T = RepeatWrapping`), mesh 마다 재질 사본에
`repeat = 면(mm) / tile_mm`, 결이 세로(`grain:'v'`)인 자재를 누운 부재(선반·상판·지판)에 쓰면 90° 돌린다(`plannerMaterialsRepeatFor`).
면 크기는 `BoxGeometry.parameters` 에서 — 선 부재는 가로×높이, 누운 부재는 가로×깊이(`plannerMaterialsFaceOf`).
`textureUrl` 이 없는 항목(구 7×7 호환 코드 등)은 로더를 만들지도 않고 공유 재질 그대로다(no-op). 로더가 실패해도 공유 재질로 물러선다.
mesh 사본(재질 + 그 `map`)은 `_perMesh` 에 쌓여 **`dispose()` 가 같이 놓는다** — 공유 재질만 놓으면 사본이 GPU 에 남는다.

- **타일은 어디 있나**: `assets/materials/yerim/<code>.jpg` (512×512, JPEG q82, 144장 합계 3.6 MB). 저장소 안이라
  플래너 페이지(GitHub Pages)와 **같은 출처** — CORS 도 Storage 자격증명도 필요 없다. `materials.texture_url` 이 이 상대경로를 담는다.
- **다시 만들기**: `node scripts/fetch-yerim-textures.mjs --write-seed` → `node scripts/build-yerim-sql.mjs`.
  파이프라인(내려받기 → 흰 테두리 잘라내기 → 512 타일 → 선형광 평균색)은 `docs/02-design/features/yerim-textures.md` 참조.
- **`tile_mm`**: 우드 계열(PP·PVC·MFB·MFC) **600mm**, 무지(Acryl·Glass·PET·PET Matt·PET Glossy·UV) **300mm**.
- **`color_hex` 의 자리**: 이제 **대체색**이다. 텍스처를 못 읽었을 때만 보인다. 값도 2026-09-16 에 잘라낸 타일 전체의
  **선형광 평균**으로 다시 계산했다(전에는 sRGB 값을 그대로 평균해 어두운 쪽으로 치우쳤다).
- ⚠ **저작권**: 타일은 예림 제품 사진을 잘라 저장소에 다시 올린 것이다. 공개 운영 전에 예림 동의를 받아야 한다.
  빼는 것은 폴더를 지우고 `UPDATE materials SET texture_url = NULL WHERE vendor = 'yerim';` 이면 끝이다.

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
- `planner-materials.test.js`: tone 별 파라미터·행 값 우선, 캐시·dispose, sRGB→linear, 텍스처 no-op / 있을 때 repeat·회전·색공간,
  로더 실패 시 공유 재질로 물러서기, `dispose` 가 mesh 사본까지 놓기 (three.cjs).
- `materials-yerim-seed.test.js` · `materials-yerim-textures-sql.test.js`: 시드/갱신 SQL 의 멱등성·무파괴, 144 코드 1:1,
  `texture_url` 이 가리키는 타일 파일이 실제로 저장소에 있는지.
- `planner-detail-mode.test.js` D2 절: 그룹 렌더·슬롯 필터·검색·접힘 유지·loadCatalog 갈아 끼우기, enter/exit 의 renderer·scene·조명 복원,
  PBR 스왑과 `_origMaterial` 복원, I2. D0 시험은 손대지 않았다(팔레트 머리 `카탈로그 7×10` 그대로).
- `planner-assets.test.js`: 새 스크립트 2개의 순서(finish → catalog·materials → detail, store 뒤), 전역 이름 충돌 없음, `?v=38.8` 통일.

## 미룬 것 (D2 시점)

- ~~**텍스처 시드**: `materials.texture_url · tile_mm` 이 전부 null~~ → 2026-09-16 에 됐다 (예림 144종, 저장소 안 타일).
  남은 것: 타일이 **이음매 없는(seamless)** 타일은 아니다 — 스와치 사진을 그대로 잘라 썼으므로 `repeat` 가 2 를 넘는 큰 면에서는
  이음이 보일 수 있다. 우드 결의 방향(`grain`)도 여전히 이름으로 추정한 값이다 **[확인 필요]**.
- 정면도(2D SVG)는 여전히 마감 색을 칠하지 않는다.
- D3 스냅샷 저장(R2), D4 렌더 품질(그림자·벽·바닥).
- `materials` 표의 anon `select` RLS 가 막혀 있으면 팔레트는 호환 그룹만 보인다(`폴백`) — 배포 후 확인.

---

# D3 — 렌더 스냅샷 저장 (R2): 오프스크린 캡처 → Storage `renders` + `design_renders`

> 계획 §4.4 R2 · §5 D3. 디테일 룩(마감·광택·환경광)으로 찍은 PNG 를 계정에 남긴다. 작업지시서 표지(B5)가 정면을 싣는다.
> 화면은 바이트 하나 달라지지 않는다 — `preserveDrawingBuffer` 를 켜지 않고, 캔버스 크기·pixelRatio·카메라·OrbitControls 를 건드리지 않는다.

## 어디서

- 상단 우측 도면 메뉴 옆 **📷 렌더 저장** (정면·3/4·평면, 긴 변 2048px) 과 **📷▾** (4096px · 이 모듈). 디테일 모드에서만 보인다 (`pd-only`).
- 우측 패널 **최근 렌더** 섹션(`data-sec="detail-renders"`) — 이 품목의 최근 12장을 서명 URL 썸네일로. 모드에 들어올 때와 저장 뒤에 갱신.
- 진행 중엔 버튼이 잠기고 `📷 정면 1/3` · `☁ 올리는 중 2/3` 로 바뀐다. 두 번 누르면 `busy`.

## 캡처 (`js/planner/planner-capture.js`)

three 는 **렌더타깃에 그릴 때 톤매핑·sRGB 출력을 하지 않는다** (`WebGLPrograms`: `currentRenderTarget !== null → NoToneMapping · LinearSRGB`).
그래서 두 패스다.

| 단계 | 무엇 |
|---|---|
| 룩 | `PlannerDetail.pushLook()` — 구조 모드면 `applyScene(true)` + `paintScene({force})` 로 디테일 룩을 켜고 토큰에 "내가 켰다" 를 적는다. 디테일 모드면 아무것도 되돌리지 않는 토큰. `enter/exit` 와 같은 함수를 타므로 두 벌이 아니다 |
| ① | 씬 → `rtA` (`WebGLRenderTarget`, HalfFloat, MSAA 4, depth) — 새 `PerspectiveCamera` (프리셋) |
| ② | `OutputPass.render(renderer, rtB, rtA)` — `renderer.toneMapping`(ACES) · `outputColorSpace`(sRGB) 를 그대로 입힌다. `rtB` 는 UnsignedByte |
| ③ | `readRenderTargetPixels(rtB)` → 위아래 뒤집기 · 알파 255 → canvas 2D `putImageData` → `toBlob('image/png')` |
| 복원 | `finally`: `setRenderTarget(이전 값)` · `rtA/rtB.dispose()` · `PlannerDetail.popLook(token)` |

- `OutputPass` 는 importmap 모듈 스크립트가 `window.OutputPass` 로 올린다 (`RoomEnvironment` 와 같은 패턴). 없으면 ①을 UnsignedByte 로 찍고
  CPU 에서 sRGB 곡선만 입힌다 (톤매핑 없음 — `toneMapped:false`, 토스트에 `톤매핑 없음`).
- `capturePixels` 는 **동기**(픽셀 읽기까지)라 `animate` 루프가 사이에 화면을 그릴 수 없다 — 구조 모드에서 눌러도 화면은 한 프레임도 디테일 룩이 되지 않는다.
  PNG 인코딩(`toBlob`)만 비동기. 여러 장은 한 장씩 차례로 (픽셀 버퍼를 겹쳐 들지 않는다).
- 크기: 긴 변 2048 기본 / 4096 옵션, `renderer.capabilities.maxTextureSize` 로 자른다. 다른 변은 프리셋 종횡비로.

## 카메라 프리셋 (`plannerCaptureFrame`, 순수)

경계는 `moduleGroup` 의 **mesh 만** 센다 — 배치 공간 상자(`area`)·선택 테두리(`pick`)·원점 마커(선)는 뺀다. 여백 8% (`PLANNER_CAPTURE_MARGIN`).

| kind | 카메라 | fov | 종횡비 |
|---|---|---|---|
| `front` | 경계 중심을 −Z 로. 앞면(max.z)에서 H·W 가 다 들어오는 거리 | 12° (직교에 가깝다) | 경계 W/H (0.5~3) |
| `iso` | `fitCameraToBounds` 와 같은 (0.7, 0.5, 1) × size×1.4 | 45° | 화면 캔버스 (없으면 3:2) |
| `plan` | 위(+Y)에서 −Y, `up = −Z` (뒷벽이 그림 위쪽) | 12° | 경계 W/D (0.5~3) |
| `module:<id>` | 그 모듈 그룹(`userData.entityKind='module'`)의 경계로 iso | 45° | 화면 캔버스 |

`design_renders.camera` 에 `{kind, fov, aspect, position, target, up, longEdge, moduleId?}` (정수 mm) 로 남는다 — 같은 각도로 다시 찍을 수 있게.

## 저장 구조

- Storage 버킷 **`renders` (비공개)**. 키 `{design_id}/{item_unique_id}/{kind}-{yyyymmddHHMMss}.png`, 모듈은 `module-{module_id}-{stamp}.png`.
  `upsert:false` — 파일명에 시각이 있어 덮어쓸 일이 없다. 첫 폴더가 `design_id` 라 Storage 정책이 `designs.user_id` 로 소유자를 판정한다.
- 표 **`design_renders`** (`database/design-renders.sql`): `id · design_id(→designs, CASCADE) · item_unique_id · kind(front|iso|plan|module) · module_id · path(버킷 안 키) ·
  width · height · camera JSONB · detail_hash · created_at`. 인덱스 `(design_id, item_unique_id, created_at DESC)`.
- `detail_hash` = 마감 모델(`dadam_detail_v1`) JSON 을 **키 정렬**해 sha-256 (순수 JS, 동기). 같은 지정이면 같은 값 — 렌더가 어느 마감 상태였는지 맞춰 본다.
- RLS: `planner_snapshots` 와 같은 방식 — 소유자 `FOR ALL` (USING + WITH CHECK, `designs.user_id`) + 관리자 SELECT. Storage 도 같은 판정
  (`renders_select_own · renders_insert_own · renders_delete_own · renders_select_admin`). 공개 읽기 없음, UPDATE 정책 없음.
- 흐름 (`PlannerCapture.saveAll` → `PlannerStore.saveRender`): `ready()` → 캡처 → 업로드 → 행 삽입(`select id`). 행이 거절되면 올린 파일을 지운다.
  `Bucket not found` 는 `reason:'no-bucket'` → 토스트가 "비공개 버킷 renders 를 만들고 design-renders.sql 을 실행하세요" 로 안내하고 렌더는 내려받게 한다.
- **스코프가 없으면**(`design=local` · 품목 없음 · 로그인 전 · SDK 없음) `<a download>` 로 이 브라우저에 내려받는다 — 이 페이지는 앱 페이지라 된다.
  토스트가 이유를 말한다 ("설계를 저장한 뒤 다시 누르면 계정에 올라갑니다").
- 목록 `PlannerStore.listRenders(ids, {kind, limit, signed, ttl})` — 최근 순 + `createSignedUrls`(1시간) → `rows[i].url`.

## B5 (작업지시서 표지) 가 정면을 찾는 법

`design_renders` 에서 `design_id = :design AND item_unique_id = :item AND kind = 'front' ORDER BY created_at DESC LIMIT 1` — 인덱스가 그 순서다.
`path` 는 버킷 `renders` 안의 키이므로 워커(service_role, RLS 우회)는 `storage.from('renders').download(path)` 또는 `createSignedUrl(path, ttl)` 로 읽는다.
`detail_hash` 를 지금 `design_items.detail` 의 해시와 비교하면 "마감을 바꾼 뒤 다시 찍지 않았다" 를 표지에 표시할 수 있다 (프런트와 같은 키 정렬 규칙).

## 적용

1. Supabase → Storage → New bucket → `renders`, **Public 끔**. (SQL 의 `INSERT INTO storage.buckets` 가 같은 일을 하지만 SQL Editor 역할에 storage 쓰기 권한이 없는 프로젝트가 있다.)
2. SQL Editor 에서 `database/design-renders.sql` 전체 실행 (두 번 실행해도 안전). 선행: `designs-schema.sql`, `admin-schema.sql`.
3. 확인: `SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'renders_%';` 4행.
4. 배포 후 디테일 모드에서 📷 렌더 저장 → 우측 "최근 렌더" 에 3장.

## 시험

- `planner-capture.test.js`: 프리셋 프레이밍(경계가 화면에 꽉 차는 거리, 축·up), 경로·파일명·스코프 없음 → null, sha-256 을 node crypto 와 대조·키 순서 무관,
  파이프라인 호출 순서(rtA → OutputPass → rtB → read → 복원·dispose, 폴백 sRGB), 경계에서 area·pick 제외, 상태 복원(구조 모드: 찍는 순간엔 디테일 룩·끝나면 전부 원래 값·
  setSize/setPixelRatio 안 부름 / 디테일 모드: 룩 유지·exit 가 되돌림), saveAll(다운로드·업로드 3번·모듈·버킷 없음·busy), 메뉴, `PlannerStore.saveRender/listRenders` 호출 모양, 띠, HTML 배선.
- `design-renders-sql.test.js`: 컬럼·CHECK·인덱스·RLS·Storage 정책·파괴 문장 없음·안내문.
- `planner-assets.test.js`: `planner-capture.js` 순서(detail·store 뒤), 배치 페이지에 없음, `OutputPass` 노출, 전역 이름 충돌 없음.
- 골든 I1 · 화면 I2 (`planner-golden` · `planner-pick-highlight` · `planner-view-keep`) 그대로.
- **실제 브라우저에서 PNG 가 비어 있지 않은지는 jsdom 으로 볼 수 없다** (WebGL 없음) — 배포 후 한 번 눌러 확인한다. 위 시험은 호출 순서와 상태 복원을 대신 본다.

## 미룬 것 (D3 시점)

- `my-designs.html` 은 연출컷(`generations`) 이력이라 설계 카드가 없다 — 렌더 썸네일은 싣지 않았다. 설계 목록 카드(상세설계 `persistence-init.js`, Design UI 도메인)에
  최신 정면을 보이려면 `listRenders(ids, {kind:'front', limit:1})` 한 줄이면 된다.
- 렌더 삭제 UI 없음 (RLS 는 소유자 DELETE 를 허용한다). 오래된 렌더 정리 정책 **[확인 필요]**.
- D4 렌더 품질(그림자·벽·바닥) · D5 AI 연출(정면 렌더를 입력으로).

---

# D4 — 선택 범위 (2026-09-16): 배치·모듈·품목을 고르면 그 범위 전체가 칠해진다

> 사용자 요구 세 줄: ① 3D 에서 **배치를 눌러 고른 뒤** 색을 고르면 그 배치 전체가 칠해진다.
> ② 모듈도 마찬가지다. ③ **마감 팔레트는 우측**으로, **좌측은 구조 단계와 같은 전체 / 배치 / 개별**.

## 범위 = 좌측 목록

`PlannerDetail.scope` 는 `'part' | 'module' | 'area' | 'item'` 넷이다. 좌측 목록의 전체·배치·개별 과 **같은 것**이다 —
둘은 한 쌍으로 움직인다.

| 좌측 목록 | 범위 | 다음 색 클릭이 칠하는 것 |
|---|---|---|
| 전체 | `item` | 품목 전체 |
| 배치 | `area` | 고른 배치 안 모듈 전부 |
| 개별 (목록에서 모듈을 고름) | `module` | 그 모듈 전부 |
| 개별 (3D 에서 부재를 누름) | `part` | 그 부재 하나 |

- 목록 → 범위: `setViewMode` 가 `PlannerDetail.onListMode(mode)` 를 부른다.
  모듈·배치 선택도 마찬가지다 — `setActiveModule` → `onModulePick`, `setActiveArea` → `onAreaPick`.
  선택 표시(배치 노란 윤곽선 `AREA_PICK_COLOR_3D` · 모듈 파란 테두리)의 정본은 그대로 페이지에 있고
  `PlannerDetail` 은 읽고 부르기만 한다 — 표시를 두 벌로 만들지 않기 위해서다.
- 범위 → 목록: `syncListMode()` 가 `setViewMode` 를 되부른다. `part`·`module` 은 둘 다 `single` 이라
  부재를 고른 뒤 목록이 되돌아가지 않는다.
- 3D 클릭은 **지금 목록이 보고 있는 넓이**로 읽는다: 배치 상자 → 그 배치 / 배치 모드에서 부재 → 그 부재의 배치 /
  전체 모드에서 부재 → 품목 / 개별 모드에서 부재 → 그 부재 (Shift = 그 모듈의 **같은 슬롯**, D0 지름길 그대로).
- 범위를 고른 뒤 팔레트에서 색을 누르면 **곧 칠해진다** (`selectCode` → `applyScope`). 범위가 비어 있으면
  예전처럼 고르기만 하고, 그 뒤 3D 를 누르면 칠해진다.

## 왜 모델에 '배치' 단계를 만들지 않았나

`PLANNER_FINISH_LEVELS` 는 여전히 **부재 > 모듈 > 섹션 > 품목** 넷이다. 배치 범위는 저장할 때
**그 배치 안 모듈마다 `module` 단계로 펼쳐** 적는다.

- `js/detaildesign/extractors.js`(BOM 도메인)가 같은 4단계 우선순위를 **자기 쪽에 한 벌 더** 갖고 있고,
  `design_items.detail` 은 D1 로 왕복한다. 단계를 하나 더 만들면 BOM 과 도면이 조용히 갈라진다.
- 모듈 단계로 펼치면 BOM·3D·저장본이 **같은 것**을 본다. 배치는 화면의 개념으로만 남는다.

## 칠할 때 지우는 것 (안 지우면 "전체" 가 거짓말이 된다)

| 범위 | 적는 곳 | 지우는 곳 |
|---|---|---|
| 부재 | `parts[moduleId][partKey]` | — |
| 모듈 | `modules[moduleId][slot]` | 그 모듈의 `parts` |
| 배치 | 배치 안 **모듈마다** `modules[id][slot]` | 그 모듈들의 `parts` |
| 품목 | `item[slot]` | 모든 `modules[*][slot]` · `sections.{upper,lower}[slot]` · `parts` |

지우기는 `plannerFinishClear` 한 함수로 한다. **한 범위 = 되돌리기 한 장** (`pushUndo` 를 맨 앞에서 한 번).

## 슬롯 — '전체' 가 기본

- 슬롯 줄 맨 앞에 **전체**(`PLANNER_DETAIL_SLOT_ALL = 'all'`)가 생겼다. 모듈·배치·품목 범위의 기본값이고,
  개별 슬롯을 누르면 **좁히는 필터**가 된다. 부재 범위는 D0 그대로 누른 부재의 슬롯 하나다.
- 어느 슬롯이 실제로 있는지는 **3D mesh 에서** 읽는다 (`scanPaintMap` → `plannerFinishPaintSlotOf`).
  상판이 없는 모듈에 `top` 지정을 적지 않기 위해서다. 표는 `paintScene` 이 그릴 때마다 갱신한다.
  `plannerFinishPartKeyOf` 로 부재 키→슬롯도 같이 모아, 슬롯을 좁혔을 때 **그 슬롯의 부재 지정만** 지운다.
- 3D 를 아직 못 읽었고(빈 표) 슬롯도 고르지 않았으면 **적지 않고** 이유를 말한다 —
  무엇이 있는지 모르는 채로 7슬롯을 다 적으면 BOM 에 없는 지정이 쌓인다. 슬롯을 하나 고르면 그것만은 적는다.

## 패널 배치

- **우측**: `data-sec="detail-palette"`(마감 팔레트) → `data-sec="detail"`(선택 부재 마감) → `data-sec="detail-renders"`(최근 렌더).
  고르는 곳이 먼저다. 팔레트 머리에 **범위 한 줄**(`배치 "하부장 W1400" 전체 (모듈 3개)` / `모듈 lower-1 전체` /
  `부재 door#0` / `품목 전체`)과 되돌리기가 붙고, 스와치 묶음(`.pd-groups`)만 따로 구른다.
  일괄 적용 줄에는 **상부 전체 / 하부 전체** 둘만 남았다 — '품목 전체'·'이 모듈' 은 이제 범위다
  (`applyBulk('item'|'module')` 은 프로그램용으로 남아 있다).
  우측 패널 제목은 디테일 모드에서 `마감 · 디테일`.
- **좌측**: 구조 단계와 **같은** 전체/배치/개별 목록 그대로. 예전의 `body.detail-mode #mlBody{display:none}` 규칙을 없앴다.
- **숨기는 것은 개별 모듈 패널(`#modulePanel`) 하나뿐이다.** 그 안의 '적용' 은 분할·칸·선반·손잡이를 바꾸는
  구조 편집이라 마감을 고르러 온 화면에 있으면 안 된다 (CSS 로 숨기고, `applyModuleDraft` 에도 문을 막았다).
  우측의 구조 섹션(크기·높이 구성·영역 마감)은 D0 때부터 이미 디테일 모드에서 숨어 있다.

## 시험

- `planner-detail-scope.test.js`: 배치 클릭 → 범위·목록·노란 윤곽선, 배치 전체가 모듈 단계로 펼쳐지는 것,
  상판 없는 모듈에 `top` 이 안 적히는 것, 부재 지정 청소(전체/슬롯별), 되돌리기 한 장, 모듈·품목 범위,
  Shift 지름길, 3D 없을 때의 거절, 패널 배치·CSS·HTML 배선, I1/I2, 옛 저장본 읽기.
- `planner-detail-mode.test.js`: 좌측 머리말(`칠할 범위`), 슬롯 8칸(전체+7), '품목 전체' 는 범위로 —
  D2 팔레트 절은 기본 슬롯을 `door` 로 맞춰 두고 슬롯 필터를 그대로 본다.
- 골든 I1 · 구조 화면 I2 는 그대로 (`planner-golden` · `planner-pick-highlight` · `planner-view-keep` ·
  `planner-area-*` · `planner-front-cell-click` · `planner-module-finish` · `scene-bom-ledger`).

## 미룬 것 (D4 시점)

- 범위 안에서 **부분만 되돌리기**(배치를 칠한 뒤 모듈 하나만 옛 색으로)는 없다 — 되돌리기 한 장을 쓰고 다시 칠한다.
- 섹션(상/하)은 목록에 없는 묶음이라 버튼으로 남았다. 좌측에 '섹션' 탭을 만들 계획은 없다 **[확인 필요]**.
- 정면도(2D SVG)는 여전히 마감 색을 칠하지 않는다.
