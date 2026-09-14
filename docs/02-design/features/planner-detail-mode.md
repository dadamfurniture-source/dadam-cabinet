# 플래너 디테일 모드 (D0 — 뼈대)

> 계획: `docs/01-plan/detail-bom-deepening.plan.md` §4.1 · §4.2 · §5 D0 (PR #632).
> 브랜치 `agent/planner-detail-mode`. 3D Planner 도메인.

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

## 미룬 것

- **D1 상세설계 왕복** (Design UI 도메인): 부모가 `PLANNER_DETAIL_CHANGE` 를 받아 `design_items.detail` 저장 + `specs.doorColorUpper/Lower` 미러,
  다시 열 때 `DADAM_DETAIL_SET` 으로 되돌려 주기.
- **D2 R1 실시간 재질**: 텍스처·광택·조명·색공간. 지금은 단색 `material.color` 뿐이다.
- 정면도(2D SVG)에는 마감 색을 칠하지 않는다 — 3D 만.
- BOM 이 `plannerFinishResolve` 를 읽는 것은 B 축.
