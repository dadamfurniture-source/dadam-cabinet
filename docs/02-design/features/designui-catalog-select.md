# 상세설계 도어 마감 셀렉트 — 카탈로그 코드 기준 (C2)

> 앞선 작업: C0 카탈로그 정본(#634) · D1 디테일 왕복(#637) · B1 부재 식별자(#638) · 예림 LUX 시드(#636).
> 브랜치 `agent/designui-catalog-select`. Design UI 도메인.

## 무엇이 바뀌었나

싱크대(팝업 `ui-step1.js`, 워크스페이스 `ui-workspace.js`)와 붙박이장(`ui-workspace.js`)의 도어 색 입력이
**마감 셀렉트 + 색 셀렉트 두 개**에서 **카탈로그 코드 하나를 고르는 셀렉트 한 개**로 바뀌었다.

- 마크업은 `FurnitureOptionCatalog.buildDoorMaterialFieldHtml(uniqueId, group, specs, furnitureType, selectStyle)` 한 곳에서 그린다
  — 색 견본(`door-swatch`, 고른 행의 `color_hex`) + `<select>`.
- `<optgroup>` 은 **공급사 시리즈·소재별** (`예림 Supreme · PET Matt`, `예림 Prestige · Acryl` …), 마지막에 **기타(호환)**.
- `<option value>` 는 언제나 `materials.code` (`YR-SM-01`, `WHT`, `PET-OAK-M`). 라벨은 `color_name (vendor_code)`, 공급사 코드가 없으면 이름만.
- 바꾸면 `updateDoorMaterial(uniqueId, 'upper'|'lower'|'item', code)` (`ui-step1.js`, 전역) 가 받는다.
  붙박이장은 도어 묶음이 하나라 `'item'` 으로 상·하를 같이 적는다.

## 사양 키

| 키 | 값 | 누가 읽나 |
|---|---|---|
| `specs.doorMaterialUpper` / `doorMaterialLower` | **새 정본.** `materials.code`. `null` = 옛 방식(아래 한글 키가 정본) | 셀렉트 미리 고르기, 플래너 미러 |
| `specs.doorColorUpper` / `doorColorLower` | 코드에서 **파생**한 `color_name` (`'매트 화이트'`, `'화이트'`) | AI 연출컷(`ai-design-report.js`), 견적, BOM 옛 경로, `LayoutRenderer` |
| `specs.doorFinishUpper` / `doorFinishLower` | 코드에서 **파생**한 `'무광'` \| `'유광'` | 같음 |

`DEFAULT_SPECS`(`data-constants.js`) 는 `doorMaterialUpper: null, doorMaterialLower: null` 을 더했고 옛 키 기본값(`화이트`/`무광`)은 그대로다.

## 파생 규칙 (`FurnitureOptionCatalog.doorSpecForCode(code)`)

```
row = byCode(code)              // 모르는 코드 → null, 아무것도 바꾸지 않는다
color  = row.color_name (name_ko)
finish = row.tone === 'gloss' ? '유광' : '무광'   // matte · single · null → 무광 (사용자 결정 2026-09-15)
```

- 예림 시드의 `tone` 은 `matte`(Acryl·PET Matt) / `gloss`(PET Glossy·Glass·MFB 1행) / `single`(PP·PET·PVC·MFB·UV·Body).
- 셀렉트 변경 흐름 (`updateDoorMaterial`):
  1. `pushUndo(item)` (있으면)
  2. `specs.doorMaterial* = code`, `doorColor* = color`, `doorFinish* = finish` — 그룹의 키만 (`'item'` 은 상·하 둘 다)
  3. `item.detail` 에 `sections[group].door = {code}` (`'item'` 은 `item.door`, 이때 섹션의 `door` 재정의는 지운다).
     `item.detail` 이 없으면 `window.plannerFinishEmpty()` 로, 그것도 없으면 같은 모양의 리터럴로 만든다
  4. 수정됨 표시 → 품목의 플래너 iframe(`__planner-overlay-{uniqueId}`)에 `DADAM_DETAIL_SET` → `renderWorkspaceContent(item)`
  5. 같은 코드를 다시 고르면(사양·detail 모두 같음) 아무것도 하지 않는다 — 되돌리기 이력·플래너 replace 를 더럽히지 않는다

## 플래너 → 부모 (D1 미러 확장)

`PLANNER_DETAIL_CHANGE` 의 상/하 도어 코드가 오면 `_mirrorPlannerDetailToSpecs` 가 세 키를 같이 채운다.

| 코드 | `doorMaterial*` | `doorColor*` / `doorFinish*` |
|---|---|---|
| `YR-SM-01` (카탈로그 행 있음) | `'YR-SM-01'` | `doorSpecForCode` — `매트 화이트` · `무광` |
| `PET-OAK-M`, v2 행 **있음** | `'PET-OAK-M'` | 기존 D1 해석 그대로 — `오크` · `무광` |
| `PET-OAK-M`, v2 행 **없음** (내장 폴백) | `null` (옛 방식으로) | `오크` · `무광` |
| `MFB-BLK` (단톤) | 행 있으면 코드, 없으면 `null` | `블랙` · (마감 안 건드림 — D1 그대로) |
| 모르는 코드 | `null` | 둘 다 안 건드림 |

우리가 보낸 모델의 메아리는 D1 규칙대로 수정됨으로 표시하지 않는다.

## 기타(호환) 그룹

- `vendor` 가 없는 행 전부: 내장 폴백 7색(`WHT GRY BGE WNT OAK NVY BLK`), `materials-catalog-v2.sql` 의 `PET-OAK-M` 계열 (DB 에 있을 때).
- **옛 설계** (`doorMaterial*` 없음, `doorColorUpper: '화이트'`) 는 `codeFor('door_color', '화이트') → WHT` 로 이 그룹의 옵션을 미리 고른다.
  아는 색이 없으면 `— 선택 —` 안내 option.
- 기타(호환) 을 고르면 `doorFinish*` 는 `'무광'` 이 된다 (옛 색 행은 `tone` 이 없다). 옛 `유광` 선택은 예림 PET Glossy 등 `gloss` 행으로 옮긴다.
- 그룹 순서: 공급사 그룹은 행의 `sort`(`sort_order`) 순으로 먼저, 기타(호환) 은 언제나 마지막. `sort` 가 없는 행(내장 폴백)은 원래 순서.

## 카탈로그 API (`config-constants.js`)

| 함수 | 설명 |
|---|---|
| `load()` | C0 컬럼에 더해 `vendor · series · vendor_code · image_url · sort` 보존 |
| `optgroupsFor(slot, category?, furnitureType?)` | `[{label, options:[{code,label,name,hex,tone,vendor}]}]` — `applicable_to` 로 거른다 |
| `buildOptgroupsHtml(slot, selectedCode, category?, furnitureType?)` | `<optgroup><option value=code data-hex data-tone>` HTML |
| `doorSpecForCode(code)` | `{code, color, finish, hex, tone}` \| `null` |
| `doorSelectCode(specs, group)` | 미리 고를 코드 — `doorMaterial*` → `codeFor('door_color', doorColor*)` → `null` |
| `doorSwatchHtml(code)` / `buildDoorMaterialFieldHtml(...)` | 견본 / 한 칸 전체 |

## 시험

- `__tests__/furniture-option-catalog.test.js` — `optgroupsFor` · `buildOptgroupsHtml` · `doorSpecForCode` · `doorSelectCode` · 필드 HTML
- `__tests__/designui-catalog-select.test.js` — 셀렉트 변경(코드 + 파생 + detail + `DADAM_DETAIL_SET`), 옛 품목 미리 고르기,
  `PLANNER_DETAIL_CHANGE` 의 `YR-SM-01` 미러, 메아리, 소스 규약
- `__tests__/designui-detail-sync.test.js` (D1) 는 그대로 통과한다

## 미룬 것 (TODO)

- **냉장고장 셀렉트** (`ui-fridge-el.js`) — 이번에 손대지 않았다. 같은 `buildDoorMaterialFieldHtml(uid, 'item', specs, 'fridge')` 를 쓰면 된다.
- **BOM 옛 경로가 `doorMaterial*` 코드를 직접 읽기** — 지금은 `extractors.js` 가 `item.detail`(있으면) 또는 파생된 한글 `doorColor*/doorFinish*` 를 읽는다.
  `doorMaterial*` 을 직접 읽으면 한글 이름 왕복 없이 코드로 바로 자재를 뽑을 수 있다 (BOM 도메인).
- **검증** — 실제 Supabase(예림 144 행) 에서 optgroup 개수·순서·라벨 육안 확인. `finish` 가 `series` 로 시작하지 않는 행이 생기면 그룹 라벨이 `예림 {series} · {finish}` 로 길어진다.
- `ai-design-report.js` 의 `colorMap` 은 옛 7색 이름만 안다 — 예림 `color_name`(`매트 화이트`) 은 프롬프트 스타일에 매핑되지 않는다 (Image Gen 도메인).
