# 간단 카테고리 설계 규칙 (신발장 / 화장대 / 수납장 / 창고장)

> 이 카테고리들은 싱크대와 동일한 **범용 워크스페이스** (상부+하부 2행)를 사용합니다.
> 별도의 전용 워크스페이스가 없으며, sink-style로 렌더링됩니다.

## 1. 카테고리별 기본 치수

| categoryId | 이름 | 기본 깊이(mm) | 비고 |
|------------|------|---------------|------|
| shoerack | 신발장 | 350 | |
| vanity | 화장대 | 500 | |
| storage | 수납장 | 400 | |
| warehouse | 창고장 | 450 | |

## 2. 공유 스펙 (DEFAULT_SPECS)

모든 간단 카테고리는 같은 DEFAULT_SPECS를 상속:
- 상부장 높이: 720mm
- 하부장 높이: 870mm
- 상몰딩: 60mm
- 다리발: 150mm
- 마감: 좌/우 모두 Filler 60mm

## 3. 워크스페이스 구조

sink-style 범용 워크스페이스:
- **상부장 영역** (pos: 'upper')
- **하부장 영역** (pos: 'lower')
- 각각 독립적 유효공간 관리
- `distributeModules()` 공통 알고리즘으로 자동계산

## 4. 모듈 추가 기본값

### 상부장/하부장 모듈 추가 시
```javascript
{
  w: 600,
  h: type === 'upper' ? (upperH - 20) : (lowerH - legH),
  d: type === 'upper' ? 295 : 550,
  isDrawer: false,
  isEL: false,
  isFixed: false,
}
```

### 키큰장(TL) 추가 시
```javascript
{
  w: 600,
  h: spaceH - moldingH - 60,
  d: 550,
  isDrawer: false,
  isEL: false,
  isFixed: false,
  doorCount: 1,
  elCount: 0,
}
```

## 5. 특화 가능 항목

현재는 범용이지만, 향후 전용 워크스페이스 분리 시 고려할 카테고리별 특성:

### 신발장 (shoerack)
- 모듈 타입: 틸트도어, 오픈선반, 서랍, 일반수납
- 깊이 350mm (얕은 깊이)
- 통풍 고려 필요

### 화장대 (vanity)
- 모듈 타입: 거울장, 서랍, 수납, 오픈
- 깊이 500mm

### 수납장 (storage)
- 모듈 타입: 일반, 서랍, 선반
- 깊이 400mm

### 창고장 (warehouse)
- 모듈 타입: 키큰장, 일반, 서랍
- 깊이 450mm

## 6. BOM 규칙 (B3, `extractors.js extractSimpleBox`)

> 코드 위치: `js/detaildesign/extractors.js` `BOM_SIMPLE_CATEGORY_RULES` (카테고리 상수표) · `MaterialExtractor.extractSimpleBox`
> · `HardwareExtractor` 의 `simpleRules` 가지. 골든: `test-utils/bom-golden/{shoerack,vanity,storage,warehouse}.golden.json`
> (`__tests__/bom-golden-simple.test.js`). 계획: `docs/01-plan/detail-bom-deepening.plan.md` §5 B3.

네 카테고리는 §3 대로 싱크대와 **같은 범용 워크스페이스**(상부 + 하부 + 키큰장)를 쓰고 §2 의 DEFAULT_SPECS 를 상속하므로,
몸통 부재표는 **싱크대 규칙(`bom-protocol.md` §3-1 · `sink.md` §5.1 키큰장 단)을 준용**한다. 추출기는 하나이고 카테고리 차이는
아래 상수뿐이다. 싱크대에만 있는 것 — 개수대·쿡탑·후드 가지, 상판, 코너 마감 — 은 내지 않는다.

`categoryId` 는 `data-constants.js CATEGORIES` 의 id 그대로다: `shoerack` · `vanity` · `storage` · `warehouse`.
플래너 프리셋 이름 `shoe`(`ui-step1.js fullHeightPresets`, `planner-engine.js` section) 는 품목 id 가 아니다.

### 6.0 카테고리 상수 (`BOM_SIMPLE_CATEGORY_RULES`)

| categoryId | label | 하부 깊이 폴백 `defaultD` | 상부 깊이 폴백 `upperD` | 선반 기본 개수 규칙 `shelfSpace` |
|------------|-------|------|------|------|
| shoerack | 신발장 | 350 (§1) | 295 | **180~350 분배** — `planner-engine.js calcDefaultShelves` 의 `SHELF_SPACE_MIN/MAX_SHOE` 와 같은 식 |
| vanity | 화장대 | 500 (§1) | 295 | 싱크 규칙 (상부 2 · 하부 1 · 키큰장 통짜 1) |
| storage | 수납장 | 400 (§1) | 295 | 싱크 규칙 |
| warehouse | 창고장 | 450 (§1) | 295 | 싱크 규칙 |

- 깊이: `mod.d` → `item.d` → `defaultD` (상부는 `mod.d` → 295). 싱크대의 550 고정 폴백을 타지 않는다 — 신발장 350 에 550 짜리 측판이 나가면 안 된다.
- 선반 수 (`bomSimpleShelfQtyOf`): `mod.shelfCount` 가 숫자면 **그대로** (0 이면 없음, 오픈 칸이라도 지정값이 있으면 낸다 — 신발장 "오픈선반").
  없으면 서랍·EL·오픈(`isOpen` 또는 `doorCount 0`) 은 0, 그 밖은 위 기본 규칙 + 비고 `[확인 필요]`.
  신발장 분배: `n = floor(H/180) − 1`, `H/(n+1) > 350` 이면 `n = ceil(H/350) − 1` (705 → 2, 2190 → 11).
- 도어 수 (`bomSimpleDoorCountOf`): `mod.doorCount` 가 숫자면 그대로(0 존중), `isOpen` 은 0, 없으면 `max(1, round(W/450))`
  (붙박이장 규칙 준용 → 비고 `[확인 필요]`). 상세설계 화면의 `addStorageModule`/`addModuleAtGap` 은 doorCount 를 안 넣으므로 이 폴백을 자주 탄다.
- 선반 브라켓·경첩·손잡이는 **자재 행과 같은 함수**로 센다 (`bomSimpleShelfQtyOf` · `bomSimpleHingeDoorsOf`) — 골든 시험이 대조한다.

### 6.1 상부장 (`pos:'upper'`) — `bom-protocol.md` §3-1 상부장과 같다 (사쿠리)

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 측판 | PB | T | D(295) × H | 2 | 3면 | sakuri(15→3mm) |
| 천판 | PB | T | (W−2T) × (D−18) | 1 | 1면(전) | |
| 지판 | PB | T | (W−2T) × (D−18) | 1 | 1면(전) | |
| 뒷판 | MDF | 2.7T | (W−20) × (H−1) | 1 | - | |
| 밴드(보강목) | PB | T | (W−2T) × 70 | 2 | 2면(장) | |
| 밴드(처짐방지) | PB | T | 70 × (H−2T) | W≥700: 2 / 1 | 2면(장) | |
| 선반 | PB | T | (W−2T) × (D−34) | §6.0 선반 수 | 1면(전) | 기본값이면 `[확인 필요]` |
| 도어 | MDF | 18T | (W/doorCount−4) × (H+overlap) | §6.0 도어 수 | 4면 | overlap 기본 15. 폴백이면 `[확인 필요]` |

> 상부 모듈의 `isDrawer` 는 싱크대와 같이 무시한다 (도어만). H 폴백 = `upperH − overlap`.

### 6.2 하부장 (`pos:'lower'`, 키큰장 아님) — `bom-protocol.md` §3-1 하부장과 같다 (사쿠리 없음)

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 측판 | PB | T | D × H | 2 | 3면 | D = §6.0 깊이 |
| 지판 | PB | T | (W−2T) × D | 1 | 1면(전) | |
| 밴드 | PB | T | 70 × (W−2T) | 2 | 2면(장) | |
| 뒷판 | MDF | 2.7T | (W−2T) × (H−T) | 1 | - | |
| 밴드(처짐방지) | PB | T | 70 × bandH | W≥800: 2 / 1 | 2면(장) | 목찬넬 손잡이면 bandH = H−2T−70, 아니면 H−2T |
| 선반 | PB | T | (W−2T) × (D−T) | §6.0 선반 수 | 1면(전) | 서랍·EL·오픈은 0 (지정값 없을 때) |
| 도어 | MDF | 18T | (W/doorCount−4) × (H−30) | §6.0 도어 수 | 4면 | 서랍장이 아닐 때 |

H 폴백 = `lowerH − topThickness − legH` (870 − 12 − 150 = 708, `ui-workspace.js` 와 같다).

**서랍장 (`isDrawer`)** — 싱크 하부장 서랍 규칙(서랍 220 · 상자 180 · 1개면 전판 250 · 아래 여닫이 · 목찬넬 120)을 **깊이만 환산**해 준용.
싱크 상자(측판 440 · 밑판 449)는 D 550 = 레일 500 을 전제하므로 `레일 = bomSimpleRailLenOf(D)` (§4-2: ≤350→350, ≤450→450, >450→500),
`측판 = 레일 − 60`, `밑판 = 측판 + 9` 로 잡는다 (D350: 290·299, D400·450: 390·399, D500: 440·449).

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 서랍전후판 | PB | T | (W−72) × 180 | 서랍×2 | 1면(장) | `[확인 필요]` 환산 근거를 비고에 |
| 서랍측판 | PB | T | (레일−60) × 180 | 서랍×2 | 1면(장) | `[확인 필요]` |
| 서랍밑판 | MDF | 2.7T | (W−43) × (레일−51) | 서랍 | - | `[확인 필요]` |
| 서랍 하단보강 | PB | T | (레일−60) × 60 | 서랍 | 2면(장) | 전후판 > 600 일 때만 |
| 서랍도어 | MDF | 18T | (W−4) × (서랍 1: 250 / (220·n−20)/n) | 서랍 | 4면 | |
| 도어 | MDF | 18T | (W/round(W/450)−4) × (H−220·n−30) | round(W/450) | 4면 | 높이 > 50 일 때만 |
| 목찬넬 | MDF | 18T | 120 × W | 1 | 2면(장) | 손잡이 종류와 무관 (싱크와 같다) |

### 6.3 키큰장 (`type:'tall'`) — `sink.md` §5.1 단 부재표 그대로 (`addTallTierParts`)

통짜(`heightParts` 없음)·하부단·중간단·상부단 판별, 도어 H(목찬넬 단 H−30 / 푸쉬 단 H−4), 좌대 상자(`[확인 필요]` wardrobe 준용)·상몰딩·목찬넬이
싱크대 키큰장과 같다. 다른 것은 **선반 기본값**뿐 — `shelfCount` 가 없으면 §6.0 규칙(신발장은 180~350 분배, 그 밖은 1).
라인 폭(걸레받이·목찬넬)과 다리발에서 키큰장 단은 뺀다 — 좌대가 받친다.

### 6.4 EP (마감재) — 싱크대 EP 준용, 상판·코너 마감 없음

| 부품 | 자재 | 두께 | 크기 | 조건 |
|------|------|------|------|------|
| 상몰딩 | MDF | 18T | moldingH(60) × 상부장 폭 합 | 상부장이 있을 때만. > 2000 이면 2면(장), 아니면 4면 |
| 걸레받이 | MDF | 18T | 하부장 폭 합 × (legH−5) | 하부장(키큰장 제외)이 있을 때만 |
| 목찬넬(전면) | MDF | 18T | 52 × 하부장 폭 합 | 목찬넬 손잡이 |
| 목찬넬(지면) | MDF | 18T | 40 × 하부장 폭 합 | 목찬넬 손잡이 |
| 휠라/몰딩/EP(좌·우) | MDF | 18T | finishWidth × (품목 H − legH) | 타입·폭이 비어 있으면 §2 기본 Filler 60. None 이면 없음 |

### 6.5 [확인 필요] — 이 문서에 없어 빌린 규칙 (행 비고에 같은 문구)

| 항목 | 빌린 곳 | 행 비고 |
|------|--------|--------|
| 도어 수 폴백 `round(W/450)` (doorCount 미지정) | 붙박이장 `doorCount \|\| round(W/450)` | `[확인 필요] simple-categories.md 에 없음 — 붙박이장 규칙 준용 (doorCount 미지정 → round(W/450))` |
| 선반 기본 개수 — 화장대·수납장·창고장 (상부 2 · 하부 1 · 키큰장 1) | 싱크대 §3-1 · sink.md §5.1 | `[확인 필요] simple-categories.md 에 없음 — 싱크대 규칙 준용 (shelfCount 미지정 → 상부 2 · 하부 1)` |
| 선반 기본 개수 — 신발장 180~350 분배 | 플래너 `calcDefaultShelves` (`MASTER_RULES.SHELF_SPACE_*_SHOE`) | `[확인 필요] shelfCount 미지정 — 신발장 선반 분배 180~350 (planner-engine.js) 준용` |
| 서랍 상자 깊이 환산 (측판 = 레일 − 60 · 밑판 = 측판 + 9) | 싱크 서랍(D550: 440·449) + §4-2 레일 문턱 | `[확인 필요] simple-categories.md 에 없음 — 싱크대 규칙 준용 (D… → 레일 …: 측판 … · 밑판 …)` |
| 키큰장 좌대 상자 구성 | wardrobe.md 좌대 (sink.md §5.1 과 같은 차용) | `[확인 필요] 키큰장 좌대 상자 — wardrobe.md 좌대 규칙을 빌림 …` |
| 몸통 부재표 전체(측판·천판·지판·뒷판·밴드·처짐방지·도어 H) | 싱크대 §3-1 — 같은 워크스페이스·같은 스펙이라 행 비고 없이 준용 | (없음 — §6.1·6.2 가 정본) |
| **상판** — 하부 모듈 h 가 `lowerH − topT − legH` 라 상판 두께 자리(12)는 비어 있으나 상판 규칙이 없다 | — | 내지 않는다 |
| **화장대 거울장·거울** (§5 모듈 타입) — 모듈 필드가 없다 | — | 내지 않는다 |
| **신발장 틸트도어·통풍**(§5) — 경첩·타공 규칙이 없다 (여닫이 도어로 낸다) | — | 내지 않는다 |
| **창고장 선반 깊이·하중** — 일반 선반(D−T / D−34)으로 낸다 | — | — |
| 상부 모듈의 `isDrawer` (팝업 토글로 켤 수 있다) — 싱크대와 같이 무시 | 싱크대 | — |
| 코너 마감 — §3 은 I자뿐이라 내지 않는다 | — | — |

### 6.6 철물 (`HardwareExtractor`)

| 항목 | 규칙 |
|------|------|
| 경첩 | 도어 수·재단 높이를 자재 행과 같은 함수(`bomSimpleHingeDoorsOf`)로 — 상부 H+overlap, 하부 H−30, 서랍장 아래 여닫이 hingeDoorH, 키큰장 단 `bomTallTierDoorH`. 개수 문턱은 §4-1 |
| 레일 | 하부 서랍장마다 **서랍 개수** SET, 길이는 §6.0 깊이로 §4-2 문턱 (싱크의 모듈당 1 SET 과소는 골든에 묶여 그대로 — 계획 B2) |
| 손잡이 | `specs.handle` 그대로(목찬넬·스마트바·찬넬), 수량 = 자재 도어 행 합 (경첩과 같은 함수) |
| 다리발 | 하부장(키큰장 단 제외) W≤600: 4 / ≤900: 6 / 8, 높이 `sinkLegHeight`(150) |
| 선반 브라켓 | 자재 선반 행 수량 합 × 4 (`bomSimpleShelfQtyOf`) |
