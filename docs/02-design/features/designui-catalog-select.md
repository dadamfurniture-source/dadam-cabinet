# 상세설계 도어 마감 셀렉트 — 카탈로그 코드 기준 (C2 · C2b)

> 앞선 작업: C0 카탈로그 정본(#634) · D1 디테일 왕복(#637) · B1 부재 식별자(#638) · 예림 LUX 시드(#636).
> 브랜치 `agent/designui-catalog-select`(C2, #642) → `agent/designui-compat-tones`(C2b). Design UI 도메인.
> C2b (2026-09-15): 기타(호환) 그룹이 옛 7색 × 무광·유광 = 14 옵션이 됐다 — 과거 `화이트 · 유광` 설계가 유광을 잃지 않도록. 아래 [기타(호환) 그룹](#기타호환-그룹-c2b) 참고.
> C2c (2026-09-15, `agent/designui-followups`): 냉장고장(`ui-fridge-el.js`)도 같은 한 칸을 쓴다. 아래 [냉장고장](#냉장고장-c2c) 참고.

## 무엇이 바뀌었나

싱크대(팝업 `ui-step1.js`, 워크스페이스 `ui-workspace.js`)와 붙박이장(`ui-workspace.js`)의 도어 색 입력이
**마감 셀렉트 + 색 셀렉트 두 개**에서 **카탈로그 코드 하나를 고르는 셀렉트 한 개**로 바뀌었다.
냉장고장(`ui-fridge-el.js`)은 도어 마감 입력이 아예 없었는데(사양 기본값 `화이트 · 무광` 만 BOM 으로 갔다) C2c 에서 같은 한 칸이 생겼다.

- 마크업은 `FurnitureOptionCatalog.buildDoorMaterialFieldHtml(uniqueId, group, specs, furnitureType, selectStyle)` 한 곳에서 그린다
  — 색 견본(`door-swatch`, 고른 행의 `color_hex`) + `<select>`.
- `<optgroup>` 은 **공급사 시리즈·소재별** (`예림 Supreme · PET Matt`, `예림 Prestige · Acryl` …), 마지막에 **기타(호환)**.
- `<option value>` 는 `materials.code` (`YR-SM-01`, `PET-OAK-M`) — 단 기타(호환)의 옛 색은 C2b 부터 **합성 코드** `WHT-M` / `WHT-G` (아래).
  라벨은 `color_name (vendor_code)`, 공급사 코드가 없으면 이름만, 합성 옵션은 `화이트 · 무광` / `화이트 · 유광`.
- 바꾸면 `updateDoorMaterial(uniqueId, 'upper'|'lower'|'item', code)` (`ui-step1.js`, 전역) 가 받는다.
  붙박이장은 도어 묶음이 하나라 `'item'` 으로 상·하를 같이 적는다.

## 사양 키

| 키 | 값 | 누가 읽나 |
|---|---|---|
| `specs.doorMaterialUpper` / `doorMaterialLower` | **새 정본.** `materials.code` **또는** 기타(호환) 합성 코드 `WHT-M`/`WHT-G`(C2b). `null` = 옛 방식(아래 한글 키가 정본) | 셀렉트 미리 고르기, 플래너 미러 |
| `specs.doorColorUpper` / `doorColorLower` | 코드에서 **파생**한 `color_name` (`'매트 화이트'`, `'화이트'`) | AI 연출컷(`ai-design-report.js`), 견적, BOM 옛 경로, `LayoutRenderer` |
| `specs.doorFinishUpper` / `doorFinishLower` | 코드에서 **파생**한 `'무광'` \| `'유광'` | 같음 |

`DEFAULT_SPECS`(`data-constants.js`) 는 `doorMaterialUpper: null, doorMaterialLower: null` 을 더했고 옛 키 기본값(`화이트`/`무광`)은 그대로다.

## 파생 규칙 (`FurnitureOptionCatalog.doorSpecForCode(code)`)

```
row = byCode(code)              // 카탈로그 행 (YR-SM-01 · PET-OAK-M · WHT)
  color  = row.color_name (name_ko)
  finish = row.tone === 'gloss' ? '유광' : '무광'   // matte · single · null → 무광 (사용자 결정 2026-09-15)
행이 없으면 (C2b) 합성 코드 파싱: /^([A-Z0-9]+)-([MG])$/ 이고 앞 조각이 옛 색 행(WHT…)이면
  color  = 그 색 행의 color_name ('화이트'), finish = M → '무광' / G → '유광', hex = 색 행의 color_hex
그 밖 → null, 아무것도 바꾸지 않는다  (NOPE-G · WHT-E · PET-OAK-G · YR-SM-01-G 는 모두 null)
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
| `WHT-G` (C2b 합성 코드, 행 없음) | `'WHT-G'` | `doorSpecForCode` — `화이트` · `유광` (`parseFinishColorCode` 는 `WHT` 를 기판으로 모르므로 null → 카탈로그 파생으로) |
| `WHT` (옛 색 코드 그대로) | `'WHT'` | `화이트` · `무광` (행에 톤이 없다). 셀렉트는 `doorSelectCode` 가 `doorFinish*` 를 붙여 `WHT-M`/`WHT-G` 를 고른다 |
| 모르는 코드 | `null` | 둘 다 안 건드림 |

우리가 보낸 모델의 메아리는 D1 규칙대로 수정됨으로 표시하지 않는다.

## 기타(호환) 그룹 (C2b)

`vendor` 가 없는 행 전부가 이 그룹이다 — 내장 폴백 7색(`WHT GRY BGE WNT OAK NVY BLK`), `materials-catalog-v2.sql` 의 `PET-OAK-M` 계열 (DB 에 있을 때).

### 옛 색 행은 무광·유광 두 옵션 — 합성 코드 `{COLOR}-M` / `{COLOR}-G`

옛 색 행(`WHT` …)은 `tone` 이 없어서 C2 에서는 고르면 `doorFinish*` 가 무조건 `'무광'` 이 됐다 — 과거 `화이트 · 유광` 설계가
셀렉트를 한 번 건드리면 유광을 잃었다. **사용자 결정(2026-09-15)**: 기타(호환)에는 각 옛 색을 **무광·유광 둘 다** 낸다.

| | |
|---|---|
| 옵션 | 옛 색 행 하나 → `WHT-M` `화이트 · 무광`, `WHT-G` `화이트 · 유광` (색 안에서 무광 → 유광 순). 폴백 7색이면 **14 옵션** |
| 견본 | 두 옵션 다 그 색 행의 `color_hex`. `data-tone` 은 `matte` / `gloss` |
| 옛 색 행 판정 | `_isLegacyColorRow`: `vendor` 없음 · `tone` 없음 · 코드에 `-` 없음. `PET-OAK-M`(톤 있음)은 제 코드 그대로 한 옵션 |
| **합성 코드는 `materials.code` 가 아니다** | `WHT-M`/`WHT-G` 행은 DB 에 없다 (`byCode('WHT-G') → null`). 클라이언트(`config-constants.js`)가 만들고 `doorSpecForCode` 가 해석한다. **DB 시드는 바꾸지 않았다.** |
| 어디 실리나 | `specs.doorMaterial*` 과 `item.detail…door.code` 에 그대로 (`'WHT-G'`). 파생 키는 `doorColor*='화이트'`, `doorFinish*='유광'` |
| 옛 코드 `WHT` 자체 | 더 이상 옵션이 아니다 (톤을 잃는 선택을 막는다). `doorMaterial*` 에 `WHT` 가 그대로 있으면(플래너가 보낸 경우) `doorSelectCode` 가 `doorFinish*` 를 붙여 `WHT-M`/`WHT-G` 를 미리 고른다 |
| 톤만 있는 행 | `door_finish` 버킷(`TONE-M/G/E`)은 v2 SQL 이 `slot=['door']` 를 주지만 마감재가 아니므로 도어 셀렉트에 내지 않는다 (`optgroupsFor` 가 거른다) |

### 옛 설계 미리 고르기 (`doorSelectCode`)

- `doorMaterial*` 없음 + `doorColorUpper: '화이트'` + `doorFinishUpper: '유광'` → `codeFor('door_color','화이트') = WHT` + `유광` → **`WHT-G`**.
  `'무광'`·`'엠보'`·없음 → `-M`. 아는 색이 없으면(`핑크`) `null` → `— 선택 —` 안내 option.
- 그래서 과거 `화이트 · 유광` 품목은 셀렉트를 열면 `화이트 · 유광` 이 골라져 있고, 그대로 두거나 다시 골라도 `doorFinish*='유광'` 이 남는다.
- 그룹 순서: 공급사 그룹은 행의 `sort`(`sort_order`) 순으로 먼저, 기타(호환) 은 언제나 마지막. `sort` 가 없는 행(내장 폴백)은 원래 순서.

### 합성 코드가 다른 경로에 미치는 것 (검증)

| 경로 | 결과 |
|---|---|
| `extractors.js` 옛 경로 (`item.detail` 없음) | `legacyDoorEntryFor` 가 `doorFinishUpper/doorColorUpper` 한글 이름을 읽는다 — 우리가 여전히 파생하므로 **그대로 동작** |
| `extractors.js` 디테일 경로 (`item.detail…door.code='WHT-G'`) | `resolveDoorMaterial({doorMaterialCode:'WHT-G'})` → `parseFinishColorCode` null → 기판 미정 → MDF 기본. C2 의 `WHT` 와 **같은 결과**(깨지지 않는다). 코드에서 색·톤을 뽑는 건 BOM 도메인 TODO |
| `bom-finish-color.js` | 손대지 않았다. `LEGACY_FINISH_MAP` 이 파생된 `'유광'` 을 톤 `gloss` 로 읽는다 |
| 플래너 팔레트 (`js/planner/planner-finish.js` `plannerFinishLookup`, PR #645 기준) | `e.code === code` 정확 일치라 `WHT-G` 를 **못 찾는다** → `plannerFinishHex` null → 그 부재는 구조 단계 색 그대로(무채색). 허용 범위 — 플래너 도메인 TODO |

## 냉장고장 (C2c)

`renderFridgeWorkspace`(`ui-fridge-el.js`) 스펙 패널의 「설정」과 「마감 설정」 사이에 **「도어 마감」** 그룹이 생겼다.

- 마크업: `FurnitureOptionCatalog.buildDoorMaterialFieldHtml(item.uniqueId, 'item', item.specs, 'fridge', 'font-size:12px;')` —
  붙박이장처럼 도어 묶음이 하나라 `'item'` 이다. `furnitureType 'fridge'` 라 `applicable_to` 에 `fridge` 가 없는 행(옛 `OAK` 등)은 안 나온다.
- 변경은 그대로 전역 `updateDoorMaterial(uid, 'item', code)` 로 간다 — 냉장고장 쪽에 새 함수는 없다.
  `specs.doorMaterialUpper/Lower` 둘 다 코드, `doorColor*/doorFinish*` 둘 다 파생, `item.detail.item.door = {code}`.
  **상·하 키를 둘 다 채워야 하는 이유**: BOM 의 `legacyDoorEntryFor(section)`(`extractors.js`) 은 섹션 그룹으로 `Upper`/`Lower` 키를 고르는데
  냉장고장 추출은 섹션이 `null`(→ Lower)이고 상부장 부재는 Upper 로 갈 수 있다. 한쪽만 적으면 절반이 기본값 `화이트 · 무광` 으로 발주된다.
- 냉장고장은 플래너로 설계하지 않으므로(`NATIVE_ONLY_CATEGORIES`) `__planner-overlay-{uid}` 가 없다 → `DADAM_DETAIL_SET` 은 안 나가고 `renderWorkspaceContent(item)` 만 돈다.
- 미리 고르기·견본·되돌리기·수정됨 표시는 싱크/붙박이장과 같다 (`doorSelectCode(specs, 'upper')`).

## 카탈로그 API (`config-constants.js`)

| 함수 | 설명 |
|---|---|
| `load()` | C0 컬럼에 더해 `vendor · series · vendor_code · image_url · sort` 보존 |
| `optgroupsFor(slot, category?, furnitureType?)` | `[{label, options:[{code,label,name,hex,tone,vendor}]}]` — `applicable_to` 로 거른다 |
| `buildOptgroupsHtml(slot, selectedCode, category?, furnitureType?)` | `<optgroup><option value=code data-hex data-tone>` HTML |
| `doorSpecForCode(code)` | `{code, color, finish, hex, tone}` \| `null` — 카탈로그 행 우선, 없으면 합성 코드 `WHT-M/G` 파싱 (C2b) |
| `doorSelectCode(specs, group)` | 미리 고를 코드 — `doorMaterial*`(옛 색 코드면 `doorFinish*` 붙여 `-M/-G`) → `codeFor('door_color', doorColor*)` + `doorFinish*` → 합성 코드 → `null` |
| `doorSwatchHtml(code)` / `buildDoorMaterialFieldHtml(...)` | 견본(합성 코드도 색 행 hex) / 한 칸 전체 |
| `COMPAT_TONES` · `_isLegacyColorRow(row)` · `_compatCodeOf(colorCode, finish)` · `_parseCompatCode(code)` · `_compatOptionsOf(row)` | C2b 합성 코드 내부 — `[{suffix:'M',tone:'matte',finish:'무광'},{suffix:'G',…}]`, 옛 색 행 판정, `WHT`+`유광`→`WHT-G`, `WHT-G`→`{row, tone}`, 행→두 옵션 |

## 시험

- `__tests__/furniture-option-catalog.test.js` — `optgroupsFor` · `buildOptgroupsHtml` · `doorSpecForCode` · `doorSelectCode` · 필드 HTML.
  C2b: 폴백 14 옵션(7색 × M/G, 순서), `WHT-G` 파싱과 거짓 양성(`NOPE-G` `WHT-E` `PET-OAK-G` `YR-SM-01-G`), `화이트+유광 → WHT-G`,
  `doorMaterial*='WHT'` + 유광 → `WHT-G`, `TONE-M/G/E` 행 제외, 합성 코드 견본
- `__tests__/designui-catalog-select.test.js` — 셀렉트 변경(코드 + 파생 + detail + `DADAM_DETAIL_SET`), 옛 품목 미리 고르기,
  `PLANNER_DETAIL_CHANGE` 의 `YR-SM-01` 미러, 메아리, 소스 규약.
  C2b: `WHT-G` 고르면 `doorColorUpper='화이트'` · `doorFinishUpper='유광'` · detail `{code:'WHT-G'}`, 과거 `화이트·유광` 품목이 `WHT-G` 미리 골라지고 다시 골라도 유광 유지,
  플래너가 `WHT-G`/`OAK-M` 을 보내면 `doorMaterial*` 에 그대로 + 파생, 플래너가 `WHT` 를 보내면 셀렉트는 `WHT-M`
- `__tests__/designui-fridge-door-select.test.js` (C2c) — `renderFridgeWorkspace` 를 실제로 평가해 `.door-material-select[data-group=item]` 한 칸과
  `onchange="updateDoorMaterial(42, 'item', this.value)"`, `fridge` 필터(`OAK` 제외), 옛 품목 `WHT-M` 미리 고르기, `doorMaterialUpper` 우선;
  `updateDoorMaterial(uid,'item',…)` 이 상·하 키 6개 + `detail.item.door` 를 적고 플래너 없이 재렌더만 하는 것, 같은 코드·모르는 코드는 무시; 소스 규약
- `__tests__/designui-detail-sync.test.js` (D1) 는 그대로 통과한다

## 미룬 것 (TODO)

- ~~냉장고장 셀렉트~~ — C2c 에서 끝났다 (위 [냉장고장](#냉장고장-c2c)).
- **BOM 옛 경로가 `doorMaterial*` 코드를 직접 읽기** — 지금은 `extractors.js` 가 `item.detail`(있으면) 또는 파생된 한글 `doorColor*/doorFinish*` 를 읽는다.
  `doorMaterial*` 을 직접 읽으면 한글 이름 왕복 없이 코드로 바로 자재를 뽑을 수 있다 (BOM 도메인).
- **플래너 팔레트가 합성 코드 `WHT-G` 를 모른다** (플래너 도메인, `js/planner/**` 는 이 PR 에서 손대지 않았다) — `plannerFinishLookup` 이 `code` 정확 일치라
  `plannerFinishHex(catalog, 'WHT-G')` 는 `null`, 그 부재는 구조 단계 색 그대로다. 플래너 호환 그룹(`plannerCatalogCompatEntry`, PR #645)이 `{COLOR}-M/G` 를
  옛 색 행 hex 로 풀거나, `DADAM_DETAIL_SET` 을 받을 때 `WHT-G` → 가장 가까운 로컬 코드(`PNT-WHT-G` 등)로 대응하면 된다. 그 전까지는 무채색으로 보인다.
- **BOM 디테일 경로가 합성 코드에서 색·톤을 읽기** (BOM 도메인) — `item.detail…door.code='WHT-G'` 는 `resolveDoorMaterial` 이 기판 미정으로 보고 MDF 기본을 준다
  (C2 의 `WHT` 와 같다). `parseFinishColorCode` 나 `resolveDoorMaterial` 이 `{COLOR}-M/G` 를 `LEGACY_COLOR_MAP` + 톤으로 풀면 옛 경로와 같은 정보를 얻는다.
- **검증** — 실제 Supabase(예림 144 행) 에서 optgroup 개수·순서·라벨 육안 확인. `finish` 가 `series` 로 시작하지 않는 행이 생기면 그룹 라벨이 `예림 {series} · {finish}` 로 길어진다.
  기타(호환) 이 `WHT-M … BLK-G` 14 + `PET-…` 로 보이는지, `TONE-M/G/E` 가 안 보이는지도 같이 본다.
- `ai-design-report.js` 의 `colorMap` 은 옛 7색 이름만 안다 — 예림 `color_name`(`매트 화이트`) 은 프롬프트 스타일에 매핑되지 않는다 (Image Gen 도메인).
