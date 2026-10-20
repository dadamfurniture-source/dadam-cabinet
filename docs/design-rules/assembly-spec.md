# 조립 명세 `dadam.assembly/1`

- 코드: `js/detaildesign/bom-assembly.js` (`DadamAssembly.of(design, opts)`), 숫자: `js/detaildesign/assembly-rules.js`
- 계획: `docs/01-plan/planner-cad.plan.md` §4-2 (스키마), §6 PR6
- 시험: `__tests__/bom-assembly.test.js`

BOM 행마다 판재 조각의 **자리**를 붙인다. 재단 치수는 BOM 행 그대로이고, 명세는 크기를 새로 셈하지 않는다.
플래너 3D·GLB·겹침 검사·도면이 모두 이 명세를 읽게 된다.

## 좌표

모듈 로컬, mm. x 오른쪽 · y 위 · z 앞(+z 정면). 원점은 몸통 바닥 가운데. 다리발·좌대는 넣지 않는다.
모듈을 세우는 자리(`place`)는 부르는 쪽이 넘긴다.

## 판재

| 필드 | 뜻 |
|---|---|
| `id` | `${rowPartId}#${k}` — k 는 0부터, 왼→오 · 아래→위 |
| `rowPartId` | BOM 행 partId |
| `cut` | `{w, h}` = BOM 행 |
| `t` | 두께 |
| `frame` | `{o, u, v, n}` — 꼭짓점 o 에서 u 로 cut.w, v 로 cut.h, n 으로 t. 축은 `'+x'` 같은 부호 있는 축 |
| `box` | frame 이 덮는 상자 |
| `features` | `notch`(관통 따내기), `groove`(홈, 깊이 미정) |

## 지금 자리를 정하는 부재 (PR6)

싱크 라인과 같은 몸통(상부장 · 하부장 · 키큰장 단, 간단 카테고리 포함)의 측판 · 지판 · 천판 · 뒷판 · 선반 · 처짐방지목.

| 부재 | 자리 | 근거 |
|---|---|---|
| 측판 | 모듈 양 끝. 사쿠리면 뒤끝 15~18 홈, 목찬넬이면 앞 위 70×40 따내기 | 확정 사실, `bom-drawer-rules.js` |
| 지판·천판 | 측판 사이. 사쿠리면 홈 앞까지 D−18 (앞선 맞춤), 아니면 D 전체 | 확정 사실 |
| 뒷판 | 사쿠리면 홈 속, 아니면 측판 뒤끝 밖에 덮음. 높이 H−1 은 가운데 | PR #832 |
| 처짐방지목 | 폭 가운데, 측판 앞선 맞춤(도어 바로 뒤), 지판 위부터 | 확정 사실 |
| 상부장 보강목 | 사쿠리 홈 뒤 장의 맨 뒤(판이 서서 뒤를 봄). 아래 1장 지판 바로 위, 위 1장 천판 바로 아래. 폭 60, 판은 몸통과 상관없이 15T | 사장님 2026-10-20 |
| 선반 | 처짐방지목 뒤 — 뒤로 붙임 (깊이가 "D − T, 처짐방지목 몫"). 높이는 부르는 쪽이 넘긴 값(`opts.shelfY`, 플래너 `s.shelves`) | 확정 사실 |
| 도어 (여닫이) | 측판 앞선에 붙어 밖으로 (z = D/2 … D/2+18). 가로: 1장 = W−4 가운데(좌우 2), 2장 = W/2−4 양쪽에 가운데 갭 4. 세로: 상부장은 윗변 = 몸통 상단, 내림만큼 아래로 / 하부장은 밑단 = 몸통 바닥 (장H−30) / 장H−4 면 위아래 2. 그 밖의 장수·폭은 `door-layout-unknown` | 플래너 `addFrontPanel` (3D 장면 대조 시험), `CARCASS.DOOR_GAP` |
| 서랍장 전면 (도어·서랍도어) | 서랍 레이아웃(`MaterialExtractor.drawerLayoutOf` → `bom-drawer-rules.js`)의 전면 y0..y1 (몸통 상단에서 아래로)을 뒤집어 세로 자리, 서랍도어 가로 W−4 가운데 | 플래너 `frontSpanOf` (3D 장면 대조 시험) |
| 서랍 박스 판 | 외경은 플래너 `addDrawerBoxes` 자리 (가로 가운데, 앞면 = 몸통 앞선, 바닥 = 존 바닥 + 레일 아래 여유). 측판 양 끝 · 앞뒷판 사이 · 우라 밑면 덮음(사쿠리면 측판 홈 15~18, `mount: groove`) · 하단보강 우라 아래 가운데 앞뒤로 | 사장님 2026-10-20 "박스 아래 덮음" · 홈 "15mm", `drawerBoxDims` (3D 장면 박스 외경 대조 시험) |
| 서랍장 중간 목찬넬 ㄴ자 | 측판 앞 중간 따내기(90×40) 바닥에 지면판 40, 그 위 따낸 자리 안쪽 끝에 전면판 72 (앞 22 가 손 자리). 모듈 폭 전체. 측판 특징에 중간 따내기 `channel-mid` | 플래너 `addMidChannels` · `notchesOf`, `bom-drawer-rules.js` |
| 붙박이장 통 | 몸통이 여럿 — BOM 행 module 이름(`-서랍모듈` · `-하부장` · 통 · `-상부장`)으로 묶어 **아래→위로 쌓는다** (외부 서랍 몸통이 맨 아래). 몸통마다 측판·천지판·뒷판은 위 짜임 그대로 (사쿠리 여부는 측판 비고). 부재에 `tags.carcass`, 모듈에 `carcasses[]`. 선반 — 통 구조 블록이 있으면 규칙 파일 배치(`layoutWardrobeModule`)의 선반 자리 (몸통 높이가 BOM 과 다르면 `shelf-height-unknown`), 없으면 wardrobe.md §6 (`shelfPositions`: 긴옷 상단 315 아래, 그 밖 균등). 앞뒤는 천지판 뒤끝 맞춤 (§6 전면 여유 70). 칸막이(세로·수평) — 규칙 파일 배치(`dividersOf`)의 자리, 깊이는 천지판과 같아 천지판 뒤끝 맞춤 (배치가 없거나 BOM 과 다르면 `divider-layout-unknown`). 좌대 상자 — 몸통 아래(y −좌대H…0), **뒤 맞춤** (상자 뒷면 = 몸통 뒷면, 앞이 50 들어가 걸레받이 18T 자리, 2026-10-20 사장님 카드). 측판은 전후판 사이, 중간보강은 폭 가운데. 부재에 `tags.pedestal` (측판에 `tags.side` 를 쓰지 않는다 — 검사가 몸통 측판으로 읽는다). 도어 — 좌대를 덮고 바닥에서 20 뜬다, 윗변 = 몸통 상단 (BOM 좌대H + 몸통 − 20, 2026-10-20 사장님 카드 "바닥 20 띄움", 서랍 규칙 `SUPPORT_PEDESTAL_GAP`). 외부 서랍 통은 서랍 몸통 상단부터 몸통 상단까지 (몸통 − 서랍모듈H, 카드 "도어 1580"). 외부 서랍 전면 (1~3단) — 좌대를 덮고 바닥에서 20 위부터 쌓는다, 가로 W−4 가운데. 목찬넬 틈 30 은 2단이면 서랍마다 위에, 그 밖은 서랍 규칙 `assignChannels` (상단 1 + 중간 최소). 전면을 내림한 나머지는 맨 위 틈에 남는다. 서랍모듈 측판 앞선 따내기 — 싱크 서랍장처럼 상단 70×40 (`channel-top`), 중간 90×40 은 윗선 = 위 전면 아랫단 + 20 (`channel-mid`, 2026-10-20 카드 "싱크처럼 따냄"). 서랍모듈은 천판이 없고 (카드 "천판 빼기"), 목찬넬 EP ㄴ자 — 따낸 자리 바닥에 지면판 40, 그 위 안쪽 끝에 전면판 (상단 52, 중간 72), 모듈 폭 전체. 목찬넬 없는 전면 사이는 4 (카드 "4 띄움"). 외부 서랍 박스 — 싱크 서랍 박스 짜임·자리 (카드 "싱크 규칙": 언더레일, 측판 밑단 = 서랍 자리 바닥 + 30, 가로 가운데, 앞끝 = 몸통 앞선) | `bom-wardrobe-rules.js` `layoutWardrobeModule` · `cabinetsOf` (3D 장면 측판·선반 대조 시험). 3D 는 뒷판을 측판 사이에, 천지판을 D−T 로, 선반을 깊이 가운데에 그린다 — 명세는 BOM 재단 치수를 따른다 |
| 오픈장 · 밥솥장 | 18T MDF 상자 (모듈 타입이라 어느 품목에든 붙는다). 측판 양 끝 깊이 전체, 천지판 측판 사이 **앞선 맞춤** (뒤에 뒷판 자리 20), 18T 뒷판 측판 사이 **뒤끝 맞춤** 몸통 높이 전체 (`mount: 'between-sides'` — 뒷판 덮개 검사 대상 아님). 밥솥장 도어 (W−4)×(H−4) 는 측판 앞선에 붙어 가운데 (위아래·좌우 2) | `bom-open-cabinet-rules.js` · `bom-rice-cabinet-rules.js`, 플래너 `buildOpenCabinetMesh` · `buildRiceCabinetMesh` 와 같은 자리 |

## `unplaced` 이유

| 이유 | 뜻 |
|---|---|
| `band-position-pending` | 하부장 · 붙박이장 서랍모듈 밴드 2장의 자리 — 사장님 확인 대기 |
| `pending-owner D2` | 서랍장 처짐방지목 자리 (결정 D2) |
| `shelf-height-unknown` | 선반 높이를 넘기지 않음 — 지어내지 않는다 |
| `blind-pending` | 멍장 (목대·멍가림판) — 다음 단계 |
| `module-not-yet` | 냉장고장 · 붙박이장 몸통 행이 짜임과 맞지 않음 — 다음 단계 |
| `door-layout-unknown` | 도어 장수·폭이 플래너 칸 규칙(1장 W−4, 2장 W/2−4)과 다름, 또는 서랍장 도어 높이가 레이아웃 전면과 다름. 붙박이장 — 도어 높이가 좌대H + 몸통 − 20 (외부 서랍 통은 몸통 − 서랍모듈H) 과 다름 |
| `drawer-layout-unknown` | 서랍 전면·중간 목찬넬·박스 판 행이 서랍 레이아웃·`drawerBoxDims` 와 맞지 않음 (간단 카테고리의 옛 서랍 식 등) 또는 레이아웃을 못 구함 |
| `divider-layout-unknown` | 붙박이장 칸막이 행이 규칙 파일 배치와 맞지 않음 (통 구조 블록 없음 · 몸통 높이 다름) |
| `not-yet` | 싱크 상단 목찬넬 EP · 붙박이장 서랍 박스 · 내부 서랍 등 — PR9 |
| `run-part` | 품목 단위 행 (걸레받이·몰딩·상판·휠라) — PR9 `runs[]` |

`unplaced` 항목은 `{ rowPartId, moduleKey, part, qty, reason }` 이다 (`moduleKey` 는 조립 검사가 모듈별로 묶을 때 쓴다).

모듈 `pending` 에는 자리는 정했지만 특징이 빠진 것(예: 레이아웃을 못 구한 서랍장 중간 따내기 `channel-mid-notch`)을 적는다.

`Asm.of(design, { MaterialExtractor })` — 서랍 레이아웃을 BOM 과 같은 추출기로 구한다. 플래너 iframe 은 추출기가 부모 창에 있어 넘겨 준다.

## 알려진 겹침

- **18T 상부장 선반 ↔ 처짐방지목 2mm.** 상부 선반 깊이가 상수 D−34 라, 18T 에서는 홈 앞 18 + 선반 + 처짐방지목 18 = D + 2.
  15T 에서는 1mm 가 남는다. 결정 D10(18T 실사용)·D12(선반 감산이 상수인가 T 인가)와 함께 사장님 확인 대기.

## 조립 검사 (PR7, `js/detaildesign/assembly-check.js`)

규칙을 새로 정하지 않고 명세가 정한 자리끼리 맞는지만 본다. 모듈 로컬에서 모듈마다.

| code | 수준 | 뜻 |
|---|---|---|
| `part-overlap` | error | 두 판재가 파고든다 — 부피 > 1mm³ **이고** 깊이 > 0.1mm (T1 기준). 사쿠리 뒷판이 측판 홈 자리 안에서만 겹치는 것은 뺀다 |
| `back-cover` | error | 뒷판이 양쪽 측판 안쪽 면을 넘지 않는다 (#832 이전 옛 크기 W−2T). 붙박이장은 몸통(`tags.carcass`)마다 본다 |
| `back-contact` | error | 뒷판이 홈 안(`mount: groove`) 또는 측판 뒤끝 면(`behind-sides`)에 있지 않다 |
| `part-detached` | error | 어느 판재에도 닿지 않는 판재 |
| `assembly-unplaced` | warning | 자리 못 정한 행 — 모듈마다 한 줄, 사유별 개수 |

- 이슈 모양: `{ level, code, message, partId, other, moduleKey, volumeMm3, depthMm }`.
- 뒷판 덮개·접촉은 몸통 판만 본다 (서랍 박스 판은 `tags.box` 가 있다).
- `bom-preflight.js` 의 `check(materials, hardware, { assembly })` 에 명세를 넘기면 이 이슈가 더해진다. error 는 동결 확인창(결정 D8)으로 간다.
- 아직 없는 검사: `clearance` (도어·서랍 틈 문턱이 정본에 없음), `dfm-*`.
- 시험 허용 목록 `test-utils/assembly-allowlist.json` — 사장님 미결 질문만 (지금은 위 18T 선반 겹침). 운영 검사는 그대로 error.
- 겹침 판정 핵심(옛 `test-utils/box-overlap.js`)은 이 파일로 옮겼고, test-utils 는 같은 함수를 다시 내보낸다.

## CAD GLB (관리자 전용)

- 코드: `js/planner/planner-export.js` (`plannerExportCadSpec` · `plannerExportCadScene`), 버튼: `mockup-structure.html` 🧊 CAD GLB
- 시험: `__tests__/planner-export-cad.test.js`

플래너 구조 페이지가 부모 창(상세설계)의 변환(`_convertPlannerModules`)과 `MaterialExtractor` 로 BOM 을 내고, 이 명세를 만들어 판재를 그대로 GLB 로 쓴다.
3D 장면은 베끼지 않는다. 모듈을 세우는 자리만 3D 모듈 그룹에서 가져온다 (그룹 자리 · 칸 오프셋 · 다리발/좌대 높이).

- 노드: 루트 `dadam-planner-cad`(배율 0.001, mm → m) ▸ `module·<moduleKey>` ▸ 판재 `<partId>#k`. 따낸 판은 상자 여럿.
- 판재 extras: `rowPartId · part · material · t · cutW · cutH · moduleKey · vis`. 루트 extras: `schema · rulesVersion · unplaced`(자리 미정 행 수).
- `unplaced` 행(도어·서랍·밴드 자리 등)은 GLB 에 없다.
- 선반 높이는 플래너 구조의 `s.shelves`. BOM 선반 장수와 다르면 선반은 놓지 않는다.
