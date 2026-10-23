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
| 하부장 · 키큰장 단 밴드 | 천판 대신 상단 앞·뒤에 **눕는다** (70 이 앞뒤 방향, 측판 사이, 두께 = 몸통 T). 앞 밴드는 목찬넬 ㄴ자 지면판 바로 아래 (따내기 70 아래 — 처짐방지목 윗끝이 닿는다, BOM `bandH = H−2T−70`), 목찬넬이 없으면 윗면 = 몸통 상단. 뒤 밴드는 윗면 = 몸통 상단, 뒤끝 (사쿠리면 천지판처럼 홈 앞). 붙박이장 서랍모듈·내부 서랍장 밴드도 같다 | 사장님 2026-10-20 "뒤 눕힘, 두께는 몸통과 같게", 프로젝트 지침(앞 밴드 지면판 아래) |
| 키큰장 단 (좌대 · 걸레받이 · 목찬넬) | 바닥 단의 좌대 상자는 붙박이장과 같은 자리 — 몸통 아래(y −좌대H…0), **뒤 맞춤** (상자 뒷면 = 몸통 뒷면, 앞이 50 들어감), 측판은 전후판 사이, 중간보강은 폭 가운데. 좌대 걸레받이 MDF 18T 는 상자 앞면에 붙어 선다 (앞에 32 남음). 목찬넬 단은 측판 앞 위를 70×40 따내고(측판 비고 "목찬넬 따내기 상단") 그 단의 폭으로 ㄴ자 — 따낸 바닥에 지면판 40, 그 위 안쪽 끝에 전면판 52. 상부단 상몰딩 띠(MDF 18T, 몰딩H × W)는 몸통 위(y H…H+몰딩H), 앞면 = 도어 앞면(z D/2+18), 뒷면 = 몸통 앞선(z D/2) | 사장님 2026-10-20 카드 "뒤 맞춤" (붙박이장·키큰장 좌대 상자) · "도어 앞면 맞춤" (상몰딩 띠), sink.md §5.1 |
| 선반 | 처짐방지목 뒤 — 뒤로 붙임 (깊이가 "D − T, 처짐방지목 몫"). 높이는 부르는 쪽이 넘긴 값(`opts.shelfY`, 플래너 `s.shelves`) | 확정 사실 |
| 도어 (여닫이) | 측판 앞선에 붙어 밖으로 (z = D/2 … D/2+18). 가로: 1장 = W−4 가운데(좌우 2), 2장 = W/2−4 양쪽에 가운데 갭 4. 세로: 상부장은 윗변 = 몸통 상단, 내림만큼 아래로 / 하부장은 밑단 = 몸통 바닥 (장H−30) / 장H−4 면 위아래 2. 그 밖의 장수·폭은 `door-layout-unknown` | 플래너 `addFrontPanel` (3D 장면 대조 시험), `CARCASS.DOOR_GAP` |
| 서랍장 전면 (도어·서랍도어) | 서랍 레이아웃(`MaterialExtractor.drawerLayoutOf` → `bom-drawer-rules.js`)의 전면 y0..y1 (몸통 상단에서 아래로)을 뒤집어 세로 자리, 서랍도어 가로 W−4 가운데 | 플래너 `frontSpanOf` (3D 장면 대조 시험) |
| 서랍 박스 판 | 외경은 플래너 `addDrawerBoxes` 자리 (가로 가운데, 앞면 = 몸통 앞선, 바닥 = 존 바닥 + 레일 아래 여유). 측판 양 끝 · 앞뒷판 사이 · 우라 밑면 덮음(사쿠리면 측판 홈 15~18, `mount: groove`) · 하단보강 우라 아래 가운데 앞뒤로 | 사장님 2026-10-20 "박스 아래 덮음" · 홈 "15mm", `drawerBoxDims` (3D 장면 박스 외경 대조 시험) |
| 서랍장 중간 목찬넬 ㄴ자 | 측판 앞 중간 따내기(90×40) 바닥에 지면판 40, 그 위 따낸 자리 안쪽 끝에 전면판 72 (앞 22 가 손 자리). 모듈 폭 전체. 측판 특징에 중간 따내기 `channel-mid` | 플래너 `addMidChannels` · `notchesOf`, `bom-drawer-rules.js` |
| 멍장 (코너) | 몸통(측판·천지판·뒷판·밴드·처짐방지목·선반 D−75)은 위 짜임 그대로. 정면은 벽(코너) 쪽부터 `[멍가림판 멍W−15][도어 자리 doorW+15]` (corner.md §3.5.1) — 멍장이 라인의 어느 끝인지는 `specs.secondaryStartSide` ('left' 기본 = 벽이 왼쪽, 도어가 오른쪽). 멍가림판 MDF 2.7T 는 앞선에 붙어 밖으로 (z D/2…D/2+2.7), 멍판 마감재(휠라·몰딩 150 × H × 18)는 멍가림판 위에 겹쳐 도어 쪽 끝 맞춤 (자리 60 + 겹침 90, §3.3.1), 도어(doorW+11)는 마감재 바로 다음 갭 2 부터 목대를 덮는다 (§3.5.2). ㄱ자 경첩목대(15T × 60 × H−2T, 목찬넬 몸통은 H−2T−70 — 2026-10-22 사장님 "천판과 지판 사이")는 지판 위 y T 부터: 앞다리는 멍판 바로 뒤(z D/2−15…D/2) 멍 폭 끝에서 멍 쪽으로 60, 옆다리는 멍 폭 끝 15 자리에서 앞다리 뒤로 깊이 60 (z D/2−75…D/2−15) (§3.5.0). 모듈에 `blind: {zoneW, doorW, doorRight}` | corner.md §3.3·§3.5, corner-engine.js seedCornerModules, 3D addBlindBatten·addFrontPanel |
| 붙박이장 통 | 몸통이 여럿 — BOM 행 module 이름(`-서랍모듈` · `-하부장` · 통 · `-상부장`)으로 묶어 **아래→위로 쌓는다** (외부 서랍 몸통이 맨 아래). 몸통마다 측판·천지판·뒷판은 위 짜임 그대로 (사쿠리 여부는 측판 비고). 부재에 `tags.carcass`, 모듈에 `carcasses[]`. 선반 — 통 구조 블록이 있으면 규칙 파일 배치(`layoutWardrobeModule`)의 선반 자리 (몸통 높이가 BOM 과 다르면 `shelf-height-unknown`), 없으면 wardrobe.md §6 (`shelfPositions`: 긴옷 상단 315 아래, 그 밖 균등). 앞뒤는 천지판 뒤끝 맞춤 (§6 전면 여유 70). 칸막이(세로·수평) — 규칙 파일 배치(`dividersOf`)의 자리, 깊이는 천지판과 같아 천지판 뒤끝 맞춤 (배치가 없거나 BOM 과 다르면 `divider-layout-unknown`). 좌대 상자 — 몸통 아래(y −좌대H…0), **뒤 맞춤** (상자 뒷면 = 몸통 뒷면, 앞이 50 들어가 걸레받이 18T 자리, 2026-10-20 사장님 카드). 측판은 전후판 사이, 중간보강은 폭 가운데. 부재에 `tags.pedestal` (측판에 `tags.side` 를 쓰지 않는다 — 검사가 몸통 측판으로 읽는다). 도어 — 좌대를 덮고 바닥에서 20 뜬다, 윗변 = 몸통 상단 (BOM 좌대H + 몸통 − 20, 2026-10-20 사장님 카드 "바닥 20 띄움", 서랍 규칙 `SUPPORT_PEDESTAL_GAP`). 외부 서랍 통은 서랍 몸통 상단부터 몸통 상단까지 (몸통 − 서랍모듈H, 카드 "도어 1580"). 외부 서랍 전면 (1~3단) — 좌대를 덮고 바닥에서 20 위부터 쌓는다, 가로 W−4 가운데. 목찬넬 틈 30 은 2단이면 서랍마다 위에, 그 밖은 서랍 규칙 `assignChannels` (상단 1 + 중간 최소). 전면을 내림한 나머지는 맨 위 틈에 남는다. 서랍모듈 측판 앞선 따내기 — 싱크 서랍장처럼 상단 70×40 (`channel-top`), 중간 90×40 은 윗선 = 위 전면 아랫단 + 20 (`channel-mid`, 2026-10-20 카드 "싱크처럼 따냄"). 서랍모듈은 천판이 없고 (카드 "천판 빼기"), 목찬넬 EP ㄴ자 — 따낸 자리 바닥에 지면판 40, 그 위 안쪽 끝에 전면판 (상단 52, 중간 72), 모듈 폭 전체. 목찬넬 없는 전면 사이는 4 (카드 "4 띄움"). 외부 서랍 박스 — 싱크 서랍 박스 짜임·자리 (카드 "싱크 규칙": 언더레일, 측판 밑단 = 서랍 자리 바닥 + 30, 가로 가운데, 앞끝 = 몸통 앞선). 내부 서랍장 (규칙 블록 배치 `innerDrawerLayout`) — 통 지판 위, 모듈 W = 통 내경 − 120 가운데, 서랍 도어·좌우몰딩 앞면 = 통 앞선 − 70, 모듈은 그 뒤 (앞선 − 70 − 도어 두께), 상판 앞선 = 앞선 − 70 (2026-10-20 카드 "도어 앞선−70"). 밴드 2장은 상단 앞·뒤에 눕는다 (윗면 = 모듈 상단, 70 이 앞뒤, 사장님 "뒤 눕힘"). 부재에 `tags.innerDrawer`, 검사용 `tags.carcass: 'inner'`. 내부 서랍장 박스 — 서랍 자리(자기 도어 높이 구간, 맨 아래는 지판 윗면부터) 바닥 + 30, 가로 가운데, 앞끝 = 모듈 앞선 (카드 "싱크 규칙 바닥+30") | `bom-wardrobe-rules.js` `layoutWardrobeModule` · `cabinetsOf` (3D 장면 측판·선반 대조 시험). 3D 는 뒷판을 측판 사이에, 천지판을 D−T 로, 선반을 깊이 가운데에 그린다 — 명세는 BOM 재단 치수를 따른다 |
| 오픈장 · 밥솥장 | 18T MDF 상자 (모듈 타입이라 어느 품목에든 붙는다). 측판 양 끝 깊이 전체, 천지판 측판 사이 **앞선 맞춤** (뒤에 뒷판 자리 20), 18T 뒷판 측판 사이 **뒤끝 맞춤** 몸통 높이 전체 (`mount: 'between-sides'` — 뒷판 덮개 검사 대상 아님). 밥솥장 도어 (W−4)×(H−4) 는 측판 앞선에 붙어 가운데 (위아래·좌우 2) | `bom-open-cabinet-rules.js` · `bom-rice-cabinet-rules.js`, 플래너 `buildOpenCabinetMesh` · `buildRiceCabinetMesh` 와 같은 자리 |
| 냉장고장 (옛 화면, `type` 모듈) | 플래너 냉장고장(`pos` 있음)은 싱크 규칙 그대로 위 짜임. 옛 화면 모듈은 type 으로 자리를 읽는다 — 2026-10-22 사장님: **냉장고상부장 = 15T 사쿠리 + 보강목 2장**(싱크 상부장과 같다, 냉장고 상부장에만), 키큰장·EL장 = 사쿠리 몸통에 천판(보강목 없음), 냉장고하부장 = 뒤 덮음 뒷판 + 천판. **도어 H+20 은 아래로 20**(윗변 = 몸통 상단, 2026-10-22 카드), 하부장 도어 H−30 은 밑단 = 몸통 바닥. 홈카페장은 18T 상자(오픈장과 같은 짜임: 측판 D+20, 천지판 D 앞선 맞춤, 18T 뒷판 측판 사이 뒤끝) + 도어 n장 아래로 20. 선반은 높이 모름 | fridge.md §11, extractors.js extractFridge, bom-homecafe-rules.js |
| 라인 부재 (품목 단위 `-ep` 행, `runs[]`) | 부르는 쪽이 벽마다 모듈 x 를 넘기면(`opts.lines`) 호스트 모듈(구간 첫 모듈) 좌표로 놓는다. **상판** — 하부 라인(쿡탑장 포함, 키큰장 단 제외) 폭 합 + 좌·우 마감 폭 한 장, 몸통 위(y H…H+t), 뒤 = 벽, 깊이 = 행 h (2026-10-18 사장님: 배치 깊이, 오버행 없음). **상몰딩** — 상부 라인(후드 제외) 위 띠, 키큰장 상몰딩과 같은 자리 (몸통 위 y H…H+몰딩H, 앞면 = 도어 앞면 z D/2…D/2+18). **목찬넬 EP** (전면 52 · 지면 40 × 하부 폭 합, 쿡탑장 제외) — 측판 따내기 70×40 자리의 ㄴ자, 키큰장 단 ㄴ자와 같다 (모든 하부 측판에 따내기가 있을 때). **걸레받이** (MDF 18T, 벽 길이 × (다리발 − 5)) — 벽마다 하부 라인(쿡탑장·키큰장 단 제외, BOM 벽 길이와 같다) 폭 한 장, 바닥에 붙여 세운다 (y −다리발…−5; 몸통 밑단과의 틈 5 는 캐쳐(걸레받이 홀더)로 — 2026-10-22 사장님 "바닥에서 5 띄울 필요 없음"; 3D 는 바닥에서 5 띄워 그린다, 다른 그림), 앞면 = 몸통 앞선 − 32 (z D/2−50…D/2−32, 2026-10-22 사장님 카드 "몸통 앞선에서 32 안쪽" — 좌대 걸레받이와 같은 자리). 2440 을 넘는 벽은 2440 단위 조각 — **왼쪽부터 2440, 남는 조각은 오른쪽 끝** (2026-10-22 사장님 카드 "1"). BOM 행은 길이별 수량이라 모든 벽의 조각 중 행 길이와 같은 것이 행 수량만큼일 때 놓는다 (아니면 `run-layout-unknown`). **좌·우 마감재** (휠라·몰딩·EP, MDF 18T, 폭 × (품목 H − 다리발)) — 하부 라인 양 끝 밖에 세로로 (x 구간 끝 − 폭 / 구간 끝 + 폭), 밑단 = 하부 몸통 바닥 (y 0…h), 앞면 = 도어 앞면 (2026-10-22 사장님 카드 "앞면 = 도어 앞면"; 도어 앞 z 는 호스트와 같은 깊이의 하부 도어·서랍도어 상자 앞). 하부 라인이 한 벽에만 있어야 하고, 상부 라인이 하부 구간 밖으로 나가면 못 놓는다. 구간은 한 벽 안에서 붙어 있고 높이가 같아야 한다. 코너 마감재(휠라·몰딩 코너1·2)는 자리 미정 — 2026-10-22 사장님: 몰딩·휠라로 나뉘며 크기는 도면이 생기면 정함. 걸레받이 재단 규칙도 나중 | sink.md EP·상판·걸레받이, 2026-10-20 상몰딩 카드, 2026-10-22 카드 "몸통 앞선에서 32 안쪽"·"앞면 = 도어 앞면" |

## `unplaced` 이유

| 이유 | 뜻 |
|---|---|
| `band-position-pending` | 밴드 행이 정한 짜임(2장 · 70 × W−2T · 몸통 T)과 다르다 — 자리를 지어내지 않는다 |
| `pending-owner D2` | 서랍장 처짐방지목 자리 (결정 D2) |
| `molding-layout-unknown` | 키큰장 상부단 상몰딩 행이 띠 1장 × 몸통 폭이 아니다 |
| `pedestal-layout-unknown` | 좌대 상자·걸레받이 행이 정한 짜임(전후 2 · 측 2 · 보강 ≤1 · 걸레받이 좌대H × W)과 다르다 |
| `channel-layout-unknown` | 키큰장 단 목찬넬 행이 측판 따내기나 정한 치수(전면 52 · 지면 40 × 모듈 W, 18T)와 다르다 |
| `shelf-height-unknown` | 선반 높이를 넘기지 않음 — 지어내지 않는다 |
| `blind-layout-unknown` | 멍장 행이 corner.md 짜임과 다르다 (멍 W + doorW ≠ 몸통 W, 멍가림판 ≠ 멍W−15 × H, 마감재 ≠ 150 × H, 도어 ≠ doorW+11, 경첩목대 ≠ 15T × 60 × H−2T(목찬넬 −70)) |
| `module-not-yet` | 붙박이장 몸통 행이 짜임과 맞지 않음, 또는 짜임 자리를 모르는 모듈 — 다음 단계 |
| `door-layout-unknown` | 도어 장수·폭이 플래너 칸 규칙(1장 W−4, 2장 W/2−4)과 다름, 또는 서랍장 도어 높이가 레이아웃 전면과 다름. 붙박이장 — 도어 높이가 좌대H + 몸통 − 20 (외부 서랍 통은 몸통 − 서랍모듈H) 과 다름 |
| `drawer-layout-unknown` | 서랍 전면·중간 목찬넬·박스 판 행이 서랍 레이아웃·`drawerBoxDims` 와 맞지 않음 (간단 카테고리의 옛 서랍 식 등) 또는 레이아웃을 못 구함 |
| `divider-layout-unknown` | 붙박이장 칸막이 행이 규칙 파일 배치와 맞지 않음 (통 구조 블록 없음 · 몸통 높이 다름) |
| `not-yet` | 싱크 상단 목찬넬 EP · 붙박이장 서랍 박스 · 내부 서랍 등 — PR9 |
| `run-part` | 품목 단위 행 — 부르는 쪽이 `opts.lines`(벽마다 모듈 x)를 넘기지 않아 라인 자리를 모른다 |
| `run-layout-unknown` | 라인 부재 행이 벽의 모듈 구간과 맞지 않는다 — 구간이 두 벽에 걸침(ㄱ·ㄷ자 한 장 상판), 사이가 비거나(후드·안 세는 모듈) 높이가 다름, 치수 불일치 |
| `run-cut-blank` | 2440 재단 장수로 낸 행(붙박이장 상몰딩·좌대 걸레받이 qty > 1) — 설치 길이가 아니라 자리를 못 정한다 |
| `finish-position-pending` | 코너 마감재(휠라·몰딩 코너1·2) 꺾임 자리 미정 |

`unplaced` 항목은 `{ rowPartId, moduleKey, part, qty, reason }` 이다 (`moduleKey` 는 조립 검사가 모듈별로 묶을 때 쓴다).

모듈 `pending` 에는 자리는 정했지만 특징이 빠진 것(예: 레이아웃을 못 구한 서랍장 중간 따내기 `channel-mid-notch`)을 적는다.

`Asm.of(design, { MaterialExtractor })` — 서랍 레이아웃을 BOM 과 같은 추출기로 구한다. 플래너 iframe 은 추출기가 부모 창에 있어 넘겨 준다.

## 철물 (`modules[].hardware[]`, 2026-10-22 · 4-1 A~D 반영 2026-10-23)

철물 행(`HardwareExtractor`)을 모듈마다 `hardware[]` 로 놓는다. 항목은 `{ hwIdx, category, item, spec, kind, at, … }` — `at` 는 모듈 로컬 [x, y, z], 근거가 없으면 `at: null` 에 `pending` 이유. 부르는 쪽이 `opts.hardware` 로 철물 행을 넘기거나 추출기를 두면 되고, 없으면 `hardware[]` 는 빈다 (플래너는 부모 창 `HardwareExtractor`).

| 철물 | 자리 | 근거 |
|---|---|---|
| 다리발 (`leg`) | 하부 모듈마다 폭으로 4·6·8 (`extractLegs` 와 같은 셈, 품목 행 수량과 맞아야 한다). **4 코너** = 플래너 3D `addLegs` 자리 — 모듈 외곽에서 25 안쪽, 42 각 (`LEG_INSET` · `LEG_SIZE`, planner-engine `MASTER_RULES` 와 같은 값), 앞줄은 걸레받이 바로 뒤 (z D/2 − 32 − 18 − 21), 뒷줄 z −D/2 + 46. `at` = 밑면 가운데 (y −다리발), `size` [42, 다리발, 42]. 6·8개면 가운데 다리를 앞줄·뒷줄마다 두 코너 다리 중심 사이에 균등 분할 (`tags.side` `midFront`·`midBack`, `tags.mid` 1…; 2026-10-23 사장님 4-1 B). 키큰장 단은 `leg-tall-tier` | planner-engine.js `LEG_SIZE`·`LEG_INSET`, mockup-structure.html `addLegs` (3D 의 앞줄은 제 걸레받이 −40 뒤라 다르다) |
| 레일 (`rail`) | 서랍 박스마다 왼·오 2개 (`tags.box`·`side`). 언더레일 — 박스 측판 밑 여유 30 (`RAIL_CLEARANCE.under.below`) 에, x = 박스 바깥면, 앞끝 = 박스 앞끝, `len` = 규격. 볼레일 — 박스 측판 바깥면(x = ±박스 외폭/2)에서 밖으로 `thickness` 14, 밑단 = 박스 측판 밑단 (`at[1]` = 박스 `y0`), 앞끝 = 박스 앞끝 (2026-10-23 사장님 4-1 D, `tags.rail` `ball`). 붙박이장은 서랍모듈 박스(외부 서랍)와 내부 서랍장 박스(`innerDrawer`) 둘 다 `drawerBoxes` 로 넘긴다. 박스를 못 놓은 몸통(구조 블록 없는 옛 설계 등) → `rail-box-unknown` | bom-drawer-rules.js `RAIL_CLEARANCE`, 서랍 박스 자리(`drawerBoxes`) |
| 경첩 (`hinge`) | 도어마다 (`partId`·`doorIdx`): `edge` 경첩 변 — 양문은 왼 도어 왼쪽·오른 도어 오른쪽, 멍장 도어는 목대 쪽, 플랩은 윗변; 외짝 여닫이는 설계 모듈의 `hingeSide` `'left'`·`'right'` (좌개·우개, 2026-10-23 사장님 4-1 C) — 없거나 다른 값이면 도어마다 한 항목 `at: null`, `hinge-side-unknown` (`cups`·`qty`). 변이 정해지면 **컵마다 한 항목** (`cupIdx`·`cup` = 행 `boring[]` 값 — 옆 변은 도어 상단에서, 플랩 윗변은 도어 왼쪽 끝에서, hardware.md §1 끝 110): `at` = 컵 중심, 도어 뒷면 위 (z = 도어 `box.min[2]`), 변에서 `backset` 21.5 (컵 가장자리 4 + 반지름 17.5), `depth` 12.5 (뒷면에서 앞으로), `cupD` 35 (2026-10-23 사장님 4-1 A) | hardware.md §1, assembly-rules `HINGE_CUP_EDGE`·`HINGE_CUP_DEPTH` (결정 D5 의 경첩 부분 — 실측이 오면 두 값만 고친다) |

수량이 모듈·도어·박스 수와 맞지 않는 행은 `hardware-count-mismatch`. 서랍장(마이다 전면)은 BOM 이 경첩 행을 안 내므로 위 도어가 있어도 경첩 항목이 없다. GLB 에는 자리(`at`)와 치수(`size`)가 둘 다 있는 다리발만 상자로 싣는다 (아래 CAD GLB).

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

## CAD 검산기 (PR8, `tools/cad/**` · `.github/workflows/cad-oracle.yml`)

JS 조립 검사가 맞는지 실제 CAD 커널(build123d / OCC)로 따로 확인한다. **처음엔 보고만 한다** — 불일치가 있어도 CI 를 막지 않고 Actions 요약과 `report.json` 에 남긴다. 2주 동안 불일치 0 이면 `--strict` 를 붙여 게이트로 올린다.

1. `node tools/cad/dump-assembly.js <dir> [fixture…]` — 골든 픽스처(합성만, 저장소가 공개)마다 명세를 JSON 으로 쓴다 (스키마 `dadam.cad-oracle/1`). 부재마다 `frame · cut · t · notches · volume`, 모듈마다 JS `findOverlaps` 쌍 (홈 끼움 제외 **전**), 그리고 축 벡터(`AXES`) · 겹침 문턱(`DEFAULT_LIMITS`) · 부피 허용 오차(±0.1%)를 함께 싣는다. 입력 만들기는 `test-utils/assembly-fixtures.js` (조립 검사 시험과 같다).
2. `uv run --no-project --python 3.13 --with build123d==0.11.1 --with cadquery-ocp-novtk==7.9.3.1.1 python -I tools/cad/build_from_spec.py <dir> --out <out> [--strict] [--no-export]` — JSON 만 읽어 판재를 솔리드로 짓고(관통 따내기를 뺀다, 홈은 깊이 미정이라 안 뺀다) 대조한다.

| code | 뜻 |
|---|---|
| `solid-count` | 판 하나가 솔리드 하나가 아니다 (따내기가 판을 갈랐다) |
| `volume` | OCC 부피 ≠ JS 부피 (±0.1% 밖) |
| `overlap-occ-only` · `overlap-js-only` | 겹침 쌍(부피 > 1mm³ · 깊이 > 0.1mm) 이 한쪽에만 있다 |
| `overlap-volume` | 같은 쌍인데 겹침 부피가 다르다 |

- 산출물: 픽스처마다 `<fixture>.step` · `.glb` (모듈을 x 로 나란히), `report.json`, 덤프 JSON — Actions 산출물 `cad-oracle-<sha>` (14일).
- 파이썬은 ASCII 만, 숫자 리터럴은 축 번호 0·1·2 만 — 규칙 숫자는 명세 JSON 에서만 온다. `__tests__/cad-oracle-source.test.js` 가 지킨다 (옛 `cad-prototype/` 은 걸레받이 들임 50 · 상판 600 을 파이썬에 적어 규칙과 어긋났다 — 이 PR 로 지웠다).
- 2026-10-23 첫 실행: 골든 9종 불일치 0 (솔리드 수 · 부피 · 겹침 쌍).

## 동결 (PR10, `workers/workflow-api/src/snapshots.js` `validateAssembly`)

스냅샷 동결(`POST /designs/:id/snapshots`) 때 클라이언트가 `bom.assembly` 에 명세를 실어 보내면 워커가 형태와 BOM 정합만 본다 (다시 계산하지 않는다 — 규칙 파일은 브라우저에 있다). 어긋나면 422, INSERT 전에 멈춘다.

- 머리: `schema = dadam.assembly/1`, `rulesVersion`, `items[]`, `unplaced[]` · 크기 ≤ 1MiB (계획 §7 추정 아파트 한 채 150~300KB 의 3배 남짓)
- 판재(`items[].modules[].parts[]` · `items[].runs[].parts[]`)마다 `rowPartId` 가 `bom.materials` 에 있고 `id` 가 겹치지 않는다
- 놓인 행은 판재 수 = qty, `unplaced[].rowPartId` 도 `bom.materials` 에 있다
- `bom.assembly` 가 없으면(옛 클라이언트) 그냥 받는다. 명세는 `bom_payload` 에 실려 `content_hash` 에 든다 — 명세가 결정적이라 바뀌지 않은 설계를 다시 동결하면 같은 rev
- 실측 (2026-10-23, 로컬): 싱크 세트 8벌 314KB · 판재 712 장 검증 4.4ms
- 클라이언트(`workflow-client.js` `createSnapshot`, PR10b)는 조립 검사에 쓰는 명세(`DadamAssembly.of(design, { materials })`)를 그대로 `bom.assembly` 로 보낸다. 명세를 못 만들면(옛 캐시, 생성 실패) 명세 없이 동결한다. 워커(#1006)를 먼저 배포했다 (개정 #12)
- 명세가 해시에 들어가므로 기존 설계는 PR10b 뒤 처음 동결할 때 한 번 새 rev 가 생긴다. 규칙 버전(`rulesVersion`)이 바뀌어도 새 rev

## 플래너 검사 배지 (PR11, `js/planner/planner-cad-check.js`, 관리자 전용)

구조 화면(`mockup-structure.html`) 좌측 모듈 목록에 모듈마다 조립 검사 배지를 단다 — `✓` 정상, `⚠ n` 오류 n건 (자리 미정 경고 수는 배지 제목에). 목록 아래 오류 칸의 줄을 누르면 그 모듈을 고른다.

- 명세는 CAD GLB 와 같은 함수 `plannerCadSpec()` (부모 창 변환·BOM → `plannerExportCadSpec`), 판정은 `assembly-check.js` 그대로 — 새 규칙 없음
- 3D 를 다시 지을 때(`renderAll3D`) 400ms 디바운스로 다시 돈다. 싱크 한 세트 추출 + 명세 + 검사 약 3ms (로컬)
- 관리자만 — 역할은 `PlannerExport` 가 부모 창에서 받아 `onAdmin` 으로 넘긴다. 관리자가 아니면 검사도 돌지 않는다
- 상세설계 밖에서 연 플래너처럼 명세를 못 만들면 오류 칸에 이유만 적는다
- 3D 그리기는 아직 바꾸지 않는다 (PR12~)

## 플래너 3D 몸통 (PR12, `js/planner/planner-assembly-mesh.js`)

플래너 구조 화면이 몸통 · 처짐방지목 · 선반을 플래너가 따로 셈하지 않고 명세 판재로 그린다 (BOM 재단 치수 · 명세 자리).

- 명세는 CAD GLB · 검사 배지와 같은 `plannerCadSpec()` (부모 창 변환·추출기). `renderAll3D` 마다 배치·구조·품목 스펙이 같으면 다시 만들지 않는다
- 명세로 그리는 모듈: 한 칸 · 멍장 아님 · 붙박이장 통·오픈장·밥솥장 아님 · 기둥 따내기 없음 · 그 모듈의 몸통·처짐방지목·선반 행이 unplaced 에 없음. 아니면 예전 그리기 (다칸은 결정 D1 전까지)
- 판재: 따내기 없으면 box 크기 BoxGeometry, 따내기(notch)는 윤곽에서 빼고 frame 으로 누른다. 홈(groove)은 깊이 미정(D5)이라 안 그린다
- 메시 userData: `partId · rowPartId · key3d · assembly:true` + 원장 이름(측판 left/right · `band#k` · back · brace · shelf). 테두리 선은 `display:true`
- 도어 · 서랍 · 목찬넬 · 서랍 박스는 아직 예전 그리기 (PR13)
- 되돌리기: `mockup-structure.html?…&asm=0`. 부모 창이 없거나(플래너만 연 것) 명세를 못 만들면 예전 그리기

## CAD GLB (관리자 전용)

- 코드: `js/planner/planner-export.js` (`plannerExportCadSpec` · `plannerExportCadScene`), 버튼: `mockup-structure.html` 🧊 CAD GLB
- 시험: `__tests__/planner-export-cad.test.js`

플래너 구조 페이지가 부모 창(상세설계)의 변환(`_convertPlannerModules`)과 `MaterialExtractor` 로 BOM 을 내고, 이 명세를 만들어 판재를 그대로 GLB 로 쓴다.
3D 장면은 베끼지 않는다. 모듈을 세우는 자리만 3D 모듈 그룹에서 가져온다 (그룹 자리 · 칸 오프셋 · 다리발/좌대 높이).

- 노드: 루트 `dadam-planner-cad`(배율 0.001, mm → m) ▸ `module·<moduleKey>` ▸ 판재 `<partId>#k`. 따낸 판은 상자 여럿.
- 판재 extras: `rowPartId · part · material · t · cutW · cutH · moduleKey · vis`. 루트 extras: `schema · rulesVersion · unplaced`(자리 미정 행 수).
- `unplaced` 행(도어·서랍·밴드 자리 등)은 GLB 에 없다.
- 철물(2026-10-22): `hardware[]` 중 `at`·`size` 가 있는 다리발을 모듈 노드 아래 상자(`<moduleKey>·leg#k`, extras `hardware: 'leg'`·`category`·`item`·`spec`·`tags`)로 싣는다. `at` 은 밑면 가운데라 상자 가운데 y = `at[1] + size[1]/2`. 레일(언더레일 두께 0, 볼레일은 높이 치수가 규칙에 없음)·경첩(컵 자리만, 철물 치수 없음)은 상자 치수가 없어 싣지 않는다 — 루트 extras `hardware` 에 실은 수.
- 라인 부재(`items[].runs[]`, 2026-10-22): 플래너가 벽(같은 각·같은 뒷선 y 의 배치 공간 묶음)마다 모듈 x 를 `lines` 로 넘기고, 명세는 상판·상몰딩·목찬넬 EP·걸레받이·좌우 마감재를 호스트 모듈(구간 첫 모듈) 좌표로 낸다 (걸레받이는 벽마다 run 하나). GLB 는 그 판을 호스트 모듈 노드 아래에 싣고 extras `run` 에 벽 키, `moduleKey` 는 `<품목>-ep`.
- 선반 높이는 플래너 구조의 `s.shelves`. BOM 선반 장수와 다르면 선반은 놓지 않는다.
