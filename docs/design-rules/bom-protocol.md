# BOM 산출 프로토콜

> Bill of Materials 산출 기준, 공식, 카테고리별 규칙 종합

## 1. 지원 카테고리 & 처리 계층

| 계층 | 위치 | 지원 카테고리 | 지위 |
|------|------|-------------|------|
| **프론트엔드** | `js/detaildesign/extractors.js` `MaterialExtractor` · `HardwareExtractor` | sink, wardrobe, fridge, **shoerack, vanity, storage, warehouse** (B3) | **정본**. 상세설계 → 스냅샷 `bom_payload` → 작업지시서가 이 출력을 쓴다 |
| **MCP 서버** | `mcp-server/src/services/bom.service.ts` | sink, wardrobe, fridge, vanity, shoe, storage | **프로토타입**. MCP 도구(`generate_bom`·도면 렌더)만 호출하고, 상세설계·워커·문서 어느 생산 경로도 호출하지 않는다. 값이 정본과 다르다(18T·밴드 60·경첩 2) |
| **설계 규칙** | `docs/design-rules/` | 6개 문서 (common, sink, wardrobe, fridge, etc.) | 규칙 원본 |

> 신발장·화장대·수납장·창고장은 B3(계획 §5)부터 프론트엔드가 낸다 — `extractors.js extractSimpleBox`, 부재표는 §3-4 → `simple-categories.md` §6.
> `categoryId` 는 `data-constants.js CATEGORIES` 그대로(`shoerack`·`vanity`·`storage`·`warehouse`); MCP 의 `shoe` 는 별개 이름이다.
> 아일랜드(`island`)·도어교체(`door`)·비규격장(`custom`)은 아직 없다.
>
> **정본 선언 (2026-09, 계획 B0)** — 이 문서의 부재표·철물 규칙과 어긋나는 코드가 있으면
> `extractors.js` 가 기준이고, 문서를 코드에 맞춘다. 표준 3종 출력은 `test-utils/bom-golden/*.golden.json`
> 에 동결돼 있다 (`__tests__/bom-golden-*.test.js`, 갱신은 `UPDATE_GOLDEN=1`). `bom.service.ts` 는
> 래퍼화 또는 값 동기가 끝날 때까지 프로토타입이며, AI 답변에 그 값이 섞이면 안 된다.

## 2. 공통 자재 기준

| 항목 | 값 |
|------|-----|
| 원판 규격 | 1220 × 2440mm (`data-constants.js` `SHEET_W`/`SHEET_H` 가 정본, 추출기·재단 도면은 같은 값으로 폴백) |
| 멍판 마감재 재단 폭 | **150mm** = 자리 60 + 멍판 위 겹침 90 (`CORNER_FINISH_PART_W`, W12-72: 100 → 150. `corner.md` §3.3) |
| 멍장 도어 재단 폭 | **doorW + 11** = 도어 자리(doorW + 목대 15) − 갭 4. 도어가 경첩목대를 **덮는다** (2026-09-15 결정, `corner.md` §3.5.1). doorW 는 라인 균등 분배 폭(§3.4), 카카스 W 가 아니다. `corner-engine.js blindDoorPartW` · `extractors.js blindDoorPartW` |
| 본체 자재 | **PB `T`** — 설계별 선택값. 기본 15T, 18T 선택 가능 |
| 도어 자재 | **MDF 18T** (본체 두께와 무관한 별개 값) |
| 뒷판 자재 | **MDF 2.7T** |
| 도어 엣지밴딩 | 1mm |
| 본체 엣지밴딩 | 0.6mm |
| 도어자재 상판(countertop) | 18mm |
| 인조대리석 자재 상판(countertop) | 12mm, 50mm |
| 원판 소요 추정 | `(총면적 × 1.15) / (1220 × 2440)` — 15% 로스율 |

### 2-1. 마감 코드 정본 = `materials.code` (`database/materials-catalog-v2.sql`)

도어 마감·색의 자재 코드는 Supabase `materials` 표의 `code` 컬럼이 정본이다 (C0, 계획서 §4.3).
`js/detaildesign/bom-finish-color.js` 는 그 위의 얇은 해석기 + 오프라인 폴백이고,
`FurnitureOptionCatalog`(config-constants.js) 가 표를 한 번 읽어 `byCode()` / `forSlot()` / `codeFor()` 로 내준다.

| 종류 | 형식 | 예 |
|------|------|-----|
| 도어 마감 × 색 | `{FINISH}-{COLOR}[-{M\|G}]` | `PET-OAK-M`, `MFB-WHT`, `PNT-BLK-G` |
| 상판 | `TOP-{XXX}` | `TOP-SNW` 스노우, `TOP-MWH` 마블화이트, `TOP-GMB` 그레이마블, `TOP-CHC` 차콜 |
| 색만 (기존 `door` 행) | `{COLOR}` | `WHT`, `GRY`, `OAK` |
| 톤만 (기존 `door_finish` 행) | `TONE-{M\|G\|E}` | `TONE-M` 무광, `TONE-G` 유광, `TONE-E` 엠보 |

- `FINISH`: `PET`(PET 필름) `MFB`(멜라민) `LPM` `PNT`(도장) `VNR`(무늬목)
- `COLOR`: `CRM OAK WNT GRP WHT BLK SAG` (bom-finish-color 원래 7색) + `GRY BGE NVY` (상세설계 폴백 3색)
- 접미사: `tone=matte → -M`, `gloss → -G`, `single`(단톤 자재 MFB/LPM/VNR) → 없음
- `price_key`(`PET-M`, `MFB` …) 로만 단가표(`FINISH_BASE_PRICE` / `pricing_rules`)에 연결. 가격은 카탈로그에 두지 않는다.
- **불변조건 I6**: 코드는 더하기만. 이름 변경·삭제 금지 — 과거 작업지시서·단가에 박혀 있다.
- 기존 한글 사양값(`specs.doorColorUpper='화이트'`, `doorFinishUpper='무광'`)은 계속 읽힌다. 단 `'무광'` 은 기판(PET/도장…)을 모르므로 코드를 짐작하지 않고 `MDF-DEFAULT` 로 두며 톤·색 코드만 채운다 — 판매 라인이 정해지면 `LEGACY_FINISH_MAP` 한 줄로 기본 기판을 지정한다 [확인 필요].
- **행의 `finishCode` 우선순위 (B1, `extractors.js add()`)**: ① 디테일 마감 모델 `item.detail` (부재 > 모듈 > 섹션 > 품목 — `planner-finish.js plannerFinishResolve` 와 같은 해석, §7-1 의 partKey 로 부재를 가리킨다) → ② 모듈 `mod.doorFinish/doorColor/doorMaterialCode` → ③ 품목 사양 `specs.doorFinishUpper/Lower + doorColorUpper/Lower` (상/하 묶음은 `upper·hood → Upper`, 나머지 `Lower`). ②③ 은 도어·서랍도어에만 적용되고 `resolveDoorMaterial` 을 거치므로 한글 값은 코드가 비어 있다. 몸통·상판·손잡이·마감재·걸레받이는 ① 이 정한 때만 코드가 있고, 뒷판·서랍밑판(`slot: back`)은 언제나 빈 값이다.

## 3. 카테고리별 BOM 산출 공식

> **`T` = 본체 두께** (기본 15, 설계에서 18 선택 가능 — `specs.bodyThickness`).
> 몸통 부재 폭이 `W-2T` 로 파생되므로 15T 는 `W-30`, 18T 는 `W-36` 이 된다.
> 과거 이 문서(`W-30`)와 `ACTIVE_RULES.md`(`W-36`)가 모순돼 보였던 것은
> 서로 다른 두께의 결과를 각각 적어둔 탓이다. 이제 `T` 로 통일해 표기한다.
> 도어 MDF 18T 는 `T` 를 따라가지 않는 별개 값이다.

### 3-1. 싱크대 (sink)

#### 상부장

> 코드 위치: `js/detaildesign/extractors.js` `extractSink()` 상부장 루프

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 측판 | PB | T | D(295) × H | 2 | 3면 | sakuri(15→3mm) |
| 천판 | PB | T | (W-2T) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 지판 | PB | T | (W-2T) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | 사쿠리홈 끼움 |
| 밴드(보강목) | PB | T | (W-2T) × 70 | 2 | 2면(장) | |
| 밴드(처짐방지) | PB | T | 70 × (H-2T) | **W≥700:2 / 1** | 2면(장) | |
| 선반 | PB | T | (W-2T) × (D-34) | 2 | 1면(전) | |
| 도어 | MDF | 18T | (W/doorCount-4) × (H+overlap) | doorCount | 4면 | overlap 기본 15 |

#### 하부장

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 조건 |
|------|------|------|----------|------|------|------|
| 측판 | PB | T | D × H | 2 | 3면 | 하부장은 사쿠리 없음 |
| 지판 | PB | T | (W-2T) × D | 1 | 1면(전) | D 그대로 |
| 밴드 | PB | T | 70 × (W-2T) | 2 | 2면(장) | |
| 뒷판 | MDF | 2.7T | (W-2T) × (H-T) | 1 | - | |
| 밴드(처짐방지) | PB | T | 70 × bandH | **W≥800:2 / 1** | 2면(장) | 목찬넬시 bandH=H-2T-70 |
| 선반 | PB | T | (W-2T) × (D-T) | 1 | 1면(전) | **서랍/EL/오픈/싱크 제외** |
| 도어 | MDF | 18T | (W/doorCount-4) × (H-30) | doorCount | 4면 | |

> **2026-08 정정** — 위 표는 `extractors.js` 실제 산출과 대조해 맞춘 값이다.
> 이전 판의 오기: 밴드 폭 50(실제 70), 하부장 지판 `D-18`(실제 `D`),
> 하부장 뒷판 `(W-20)×(H-1)`(실제 `(W-2T)×(H-T)`), 하부장 선반 `D-34`(실제 `D-T`),
> 측판 엣지 4면(실제 3면). 밴드 폭은 `ACTIVE_RULES.md`·`bom-rules.json` 의 60 과도
> 다르며, **생산 실적이 있는 코드값 70 을 정본으로 삼는다.**

#### EP (마감재)

| 부품 | 자재 | 두께 | 크기 |
|------|------|------|------|
| 상몰딩 | MDF | 18T | moldingH × 상부장 폭 합 — **상부장이 있을 때만** (P1-2; 예전엔 `totalUpperW \|\| effectiveW` 로 하부 폭에 떨어졌다) |
| 걸레받이 | MDF | 18T | effectiveW × (legH-5) |
| 목찬넬(전면) | MDF | 18T | 52 × effectiveW |
| 목찬넬(지면) | MDF | 18T | 40 × effectiveW |
| 휠라(좌) | MDF | 18T | finishLeftWidth × lowerH |
| 휠라(우) | MDF | 18T | finishRightWidth × lowerH |
| 상판 | 18 → MDF(도어자재) / 12·50 → 인조대리석 | `specs.topThickness` | (하부 폭 합 + 좌·우 마감 폭) × 품목 D · **품목당 1장** · 코드 `TOP-*` (§2-1) — P1-3, `sink.md` §9 상판. 품목당 한 장은 사용자 결정(2026-09-15)이다 — ㄱ·ㄷ자도 폭 합 한 장, 런(배치 공간)마다 나누지 않는다. 3D 가 런마다 한 장 그리는 것은 표시용 단순화 |

> `effectiveW` = 하부장 모듈 폭 합. **키큰장 단(`type:'tall'`)과 쿡탑장은 뺀다** (P1-1). 키큰장은 하부장 규칙이 아니라
> `sink.md` §5.1 단별 부재표(단별 도어 H · shelfCount · 좌대 상자 · 상몰딩 · 목찬넬)를 탄다 — `extractors.js addTallTierParts`.

---

### 3-2. 붙박이장 (wardrobe)

> 코드 위치: `detaildesign.html` MaterialExtractor.extractWardrobe
> 모듈 데이터 소스: `mod.w`, `mod.d`, `mod.upperH`, `mod.lowerH`, `mod.h`, `mod.moduleType`
> 기본 깊이: **600mm**

**공통 높이/깊이 계산:**
```
bodyH = 전체H - 좌대H(60) - 상몰딩H(15)
D     = mod.d || item.d || 600         // 모듈 깊이 우선, 없으면 아이템 깊이
doorCount = mod.doorCount || max(1, round(W / 450))  // SVG 프론트뷰와 동일
```

**BOM 근거 원칙:** 모듈 객체의 치수(`mod.w`, `mod.d`, `mod.upperH`, `mod.lowerH`, `mod.h`)가 BOM의 근거. item-level 독자 계산 아님.

#### 짧은옷 2단 (short) / 선반형 (shelf) — 상하분리

> **상부장·하부장 각각 독립 캐비닛으로 산출** (측판·천판·지판·뒷판 분리)

**상부장** — 높이 = `mod.upperH`

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 측판 | PB | 15T | D × upperH | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | |
| 뒷판 | MDF | 2.7T | (W-20) × (upperH-1) | 1 | - | |
| 선반 | PB | 15T | (W-30) × (D-34) | shelfCountUpper | 1면(전) | short 기본 0, shelf 기본 2 |

**하부장** — 높이 = `mod.lowerH`

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 측판 | PB | 15T | D × lowerH | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | |
| 뒷판 | MDF | 2.7T | (W-20) × (lowerH-1) | 1 | - | |
| 선반 | PB | 15T | (W-30) × (D-34) | shelfCountLower | 1면(전) | short 기본 0, shelf 기본 2 |
| 서랍측판 | PB | 15T | (D-30) × 300 | drawerCount×2 | 1면(전) | 외부서랍일 때만 |
| 서랍전판 | MDF | 18T | (W-4) × 300 | drawerCount | 4면 | 외부서랍일 때만 |

**도어** — 좌대+bodyH-20 통일 (짧은옷/긴옷 모두 동일 높이)

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 |
|------|------|------|----------|------|------|
| 도어 | MDF | 18T | (W/doorCount-4) × **(좌대H + bodyH - 20)** | doorCount | 4면 |

> 외부서랍 시: 도어 높이 = 좌대H + bodyH - 20 - drawerCount×300
> **규칙: 도어 높이 = 다리발(좌대)높이 + 모듈높이(bodyH) - 20 → 모든 모듈 통일**

#### 긴옷 1단 (long) — 단일 캐비닛

> 높이 = `mod.h`

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 측판 | PB | 15T | D × H | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | |
| 선반 | PB | 15T | (W-30) × (D-34) | shelfCount (기본 1) | 1면(전) | |
| 서랍측판 | PB | 15T | (D-30) × 300 | drawerCount×2 | 1면(전) | 서랍 높이 300mm 고정 |
| 서랍전판 | MDF | 18T | (W-4) × 300 | drawerCount | 4면 | |
| 도어 | MDF | 18T | (W/doorCount-4) × **(좌대H+bodyH-20)** | doorCount | 4면 | 좌대+bodyH-20 통일 |

#### EP

| 부품 | 자재 | 두께 | 크기 | 엣지 |
|------|------|------|------|------|
| 상몰딩 | MDF | 18T | totalW × moldingH | 2면(장) |
| 좌대 | PB | 15T | totalW × pedestalH | 1면(전) |

---

### 3-3. 냉장고장 (fridge)

#### 상부장 (upper)

| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 | 비고 |
|------|------|------|------|------|------|------|
| 측판 | PB | 15T | D × H | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | |
| 도어 | MDF | 18T | (W-4) × (H+20) | 1 | 4면 | 도어 1장 (분할 없음) |

**상부장 높이 자동계산:**
```
상부장H = min(MAX_UPPER_H(400), 전체H - 냉장고H - TOP_GAP(15) - MOLDING_H)
```

#### 키큰장 (tall) — 표준 PB 구조

| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 | 비고 |
|------|------|------|------|------|------|------|
| 측판 | PB | 15T | D × H | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | |
| 선반 | PB | 15T | (W-30) × (D-34) | 3 | 1면(전) | |
| 도어 | MDF | 18T | (W/doorCount-4) × (H+20) | doorCount | 4면 | |

#### 하부장 (lower)

| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 | 비고 |
|------|------|------|------|------|------|------|
| 측판 | PB | 15T | D × H | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | |
| 도어 | MDF | 18T | (W/doorCount-4) × (H-30) | doorCount | 4면 | |

#### EL장 (el) — 간소 구조 (뒷판만)

| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 | 비고 |
|------|------|------|------|------|------|------|
| 측판 | PB | 15T | D × H | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | |

> EL장은 도어/선반 없음 (전동수납 전용 공간)

#### 홈카페장 (homecafe) — 전체 MDF 18T 특수 규칙

| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 | 차이점 |
|------|------|------|------|------|------|--------|
| 측판 | **MDF** | 18T | **(D+20)** × H | 2 | 4면 | PB→MDF, 깊이+20 |
| 천판 | **MDF** | 18T | (W-36) × D | 1 | **2면(가로)** | 1면→2면 |
| 지판 | **MDF** | 18T | (W-36) × D | 1 | **2면(가로)** | 1면→2면 |
| 뒷판 | **MDF** | **18T** | (W-36) × H | 1 | **2면(가로)** | **2.7T→18T!** |
| 선반 | **MDF** | 18T | (W-36) × (D-15) | 2 | 1면(전) | 3→2개 |
| 도어 | MDF | 18T | (W/doorCount-4) × (H+20) | doorCount | 4면 | |

#### 냉장고 설치 스펙

**높이 자동계산:**
```
상부장H  = min(400, 전체H - 냉장고H - TOP_GAP(15) - MOLDING_H)
모듈본체H = 전체H - MOLDING_H - 상부장H - PEDESTAL_H(60)
중간장H  = floor(모듈본체H × 0.55)
하부장H  = floor(모듈본체H - 중간장H)
```
> 냉장고는 바닥에서 시작 (좌대 영역 무관)

**브랜드별 여유공간:**

| 브랜드/타입 | 좌우 간격(sideGap) | 유닛 간 간격(betweenGap) |
|------------|-------------------|----------------------|
| LG 빌트인 (Fit&Max) | 4mm | 8mm |
| LG 빌트인 (Built-in) | 22mm | 11mm |
| LG 프리스탠딩 | 50mm | 0mm |
| Samsung Bespoke | 12mm | 10mm |
| Samsung Infinite | 5mm | 10mm |
| Samsung 프리스탠딩 | 50mm | 0mm |

**냉장고 총너비 계산:**
```
냉장고W = sideGap×2 + Σ(unit.w) + (unitCount-1) × betweenGap
```

**주요 모델 치수 (72개 모델 중 대표):**

| 모델 | W(mm) | H(mm) | D(mm) |
|------|-------|-------|-------|
| LG 단독 300L | 595 | 1780 | 680 |
| LG 단독 500L | 700 | 1850 | 730 |
| LG 단독 600L | 700 | 1920 | 730 |
| LG 빌트인 냉장+1도어 | 1568 | 1860 | 698 |
| LG 프리스탠딩 양문 | 913 | 1790 | 738 |
| SS Bespoke 1도어 | 595 | 1853 | 688 |
| SS Bespoke 4도어 | 912 | 1853 | 688 |
| SS Infinite 1도어 | 595 | 1855 | 688 |
| SS 양문형 RS84 | 912 | 1825 | 738 |
| SS 김치 스탠드 4도어 | 595 | 1530 | 688 |

---

### 3-4. 신발장 · 화장대 · 수납장 · 창고장 (shoerack · vanity · storage · warehouse) — B3

> 코드 위치: `extractors.js` `BOM_SIMPLE_CATEGORY_RULES` + `MaterialExtractor.extractSimpleBox`. 부재표 정본: `simple-categories.md` §6.
> 골든: `test-utils/bom-golden/{shoerack,vanity,storage,warehouse}.golden.json` (`__tests__/bom-golden-simple.test.js`).

네 카테고리는 싱크대와 같은 범용 워크스페이스(상부 + 하부 + 키큰장)를 쓰므로 **§3-1 상부장·하부장 표와 `sink.md` §5.1 키큰장 단 표를 그대로 탄다.**
추출기는 하나이고 카테고리 차이는 상수뿐이다:

| categoryId | 하부 깊이 폴백 (`mod.d` → `item.d` → 이 값) | 선반 기본 개수 (`shelfCount` 없을 때) |
|------------|------|------|
| shoerack 신발장 | 350 | 플래너 신발장 분배 180~350 (`planner-engine.js calcDefaultShelves`) — 705 → 2, 2190 → 11 |
| vanity 화장대 | 500 | 싱크 규칙 상부 2 · 하부 1 · 키큰장 1 |
| storage 수납장 | 400 | 싱크 규칙 |
| warehouse 창고장 | 450 | 싱크 규칙 |

싱크대와 다른 점 — 깊이 폴백(550 고정이 아니다), `shelfCount`·`doorCount` 를 존중(없으면 폴백 + `[확인 필요]` 비고: 도어 `round(W/450)` 은 붙박이장 준용),
서랍 상자를 레일 길이로 환산(측판 = 레일 − 60 · 밑판 = 측판 + 9; D550 이면 싱크와 같은 440·449), 상판·코너 마감·개수대·쿡탑·후드 없음.
철물(경첩·손잡이·브라켓)은 자재 행과 같은 함수(`bomSimpleHingeDoorsOf` · `bomSimpleShelfQtyOf`)로 센다. 빌린 규칙 목록은 `simple-categories.md` §6.5.

---

## 4. 하드웨어 산출 규칙

> 코드 위치: `detaildesign.html` HardwareExtractor 클래스, `docs/design-rules/common.md`

### 4-1. 경첩

| 도어 높이 | 경첩 수 | 보링 위치 |
|-----------|---------|----------|
| ≤900mm | 2구 | [110, H-110] |
| ≤1600mm | 3구 | [110, H/2, H-110] |
| >1600mm | 4구 | [110, H/3, H×2/3, H-110] |

여기서 H 는 **재단 도어 높이** — 자재 행(`MaterialExtractor`)이 낸 도어 h 와 같아야 한다. 몸통 H 가 아니다.
`HardwareExtractor.extractHinges` 가 모듈 종류별로 같은 식을 쓴다 (`agent/bom-followups`, 시험 `__tests__/bom-followups.test.js`):

| 모듈 | 도어 높이 H | 근거 |
|------|------|------|
| 상부장 (`pos:'upper'`) | 몸통 H + 내림(`upperDoorOverlap`, 기본 15) | §3-1 상부장 |
| 하부장 (`pos:'lower'`) | 몸통 H − 30 (목찬넬 틈) | §3-1 하부장 |
| 키큰장 단 (싱크 하부 라인 `type:'tall'`, `sink.md` §5.1) | 목찬넬 단(하부단·통짜 + 목찬넬 손잡이) H − 30 / 푸쉬 단(중간·상부단, 또는 푸쉬 손잡이) H − 4 — `extractors.js bomTallTierDoorH`, 자재 행과 같은 함수 | `sink.md` §5.1 |
| 붙박이·냉장고장 (`pos` 없음) | 몸통 H 그대로 (예전과 같다) | §3-2 · §3-3 |

> 예전엔 키큰장 단도 `pos:'lower'` 라 H−30 으로 셈해, 푸쉬 단(H−4)에서 몸통 H 905~930 · 1605~1630 구간의 경첩이 도어마다 하나 빠지고
> 보링 위치가 26mm 어긋났다. 문턱이 그대로라도 **도어 높이의 출처**가 자재 행과 같아야 한다.

### 4-2. 서랍레일

| 규칙 | 값 |
|------|----|
| 규격 | 250 · 300 · 350 · 400 · 450 · 500 |
| 선택 | **모듈 깊이 − 50 이하의 최대 규격** (D550 → 500, D500 → 450, D450 → 400). 예전 깊이 구간표(≤350→350, ≤450→450, 그외 500)는 폐기 |
| 볼레일 두께 | 14 (한쪽) — 앞뒷판 가로에서 ×2 를 뺀다 |
| 언더레일 | 앞뒷판 가로 −12, 측판 길이 = 레일 − 10 |

- 수량: **서랍 단수만큼** (SET). 2026-09-15 이전엔 모듈당 1 세트로 나갔다.
- 종류: `mod.drawerRail` — `under` **댐핑 언더레일**(기본, 박스 아래 30 · 위 10 여유) / `ball` **댐핑 볼레일**(아래 10 · 위 10).
  여유는 박스 크기 선택에 쓴다 (`sink.md` 하부장 · 서랍장, 정본 `js/detaildesign/bom-drawer-rules.js`).

> 수량: 붙박이장은 모듈 `drawerCount` SET, 단순 카테고리(§3-4)도 서랍장마다 `drawerCount` SET (깊이는 자재 행과 같은 폴백 `bomSimpleDepthOf`).
> 싱크대는 서랍장 모듈당 1 SET 로 과소다 — 골든에 묶여 있어 그대로 두고 계획 B2 에서 고친다.

### 4-3. 기타 하드웨어

| 항목 | 규칙 |
|------|------|
| 핸들 | 도어 수량 = 핸들 수량 (단순 카테고리는 자재 도어 행과 같은 함수 `bomSimpleHingeDoorsOf` 로 센다 — doorCount 폴백·서랍장 아래 여닫이 포함) |
| 다리발 | W≤600→4개, W≤900→6개, W>900→8개 (`extractLegs` 실제 문턱). 싱크대 + 단순 카테고리(§3-4) 의 하부장. 단순 카테고리는 키큰장 단을 뺀다(좌대) — 싱크대는 골든에 묶여 옛 셈(단 포함) 그대로 |
| 선반 브래킷 | 선반당 4개 (Φ5mm 핀 타입) |
| 도어 댐퍼 | 도어당 2개 |

---

## 5. 설비 항목 (싱크대 전용)

| 설비 | 주요 속성 |
|------|----------|
| 싱크볼 | 타입, 너비 |
| 수전 | 타입 |
| 쿡탑 | 너비, H=60mm, D=520mm |
| 레인지후드 | 너비, H=300mm, D=350mm |

---

## 6. 부속 항목

| 부품 | 자재 | 규칙 |
|------|------|------|
| 걸레받이 | PVC | 전체 너비 × 다리발 높이 |
| 상부몰딩 | PVC | 전체 너비 × 몰딩 높이 |
| 조절다리 | - | (캐비닛 수 + 1) × 2 |

---

## 7. 출력 포맷

### CSV

```
모듈,부품,자재,두께,가로,세로,수량,엣지,비고
상부장-수납600,측판,PB,15,295,720,2,4면,sakuri(15mm→3mm)
상부장-수납600,도어,MDF,18,296,740,2,4면,
```

### CNC

```
품목,자재,두께,가로,세로,수량,엣지L,엣지R,엣지T,엣지B
측판,PB,15,295,720,2,1,1,1,1
도어,MDF,18,296,740,2,1,1,1,1
```

엣지 매핑 (`toCNC()` 실제 출력 — 2026-09 코드 대조로 정정):
- `4면` → L=1, R=1, T=1, B=1
- `3면` → L=1, R=0, T=1, B=1 (측판: 앞 + 위·아래, 뒤 없음. B1 에서 가지가 추가됐다 — 그 전엔 0,0,0,0 으로 나갔다)
- `1면(전)`·`1면(장)` → L=1 (코드는 전면을 L 로 본다. 이전 판 문서의 "B=1" 은 오기)
- `2면(장)`·`2면(가로)` → `w > h` 면 L=1, R=1 / 아니면 T=1, B=1
- `-` → 없음

> 위 1면·2면 열은 옛 관례를 그대로 둔 것이다. 기하로 보면 `w > h` 인 판의 긴 변은 T/B 인데 코드는 L/R 을 찍고,
> `2면(가로)` 도 `2면(장)` 과 같이 처리된다. CNC 기종·파일 관례를 확인하기 전엔 바꾸지 않는다 [확인 필요].
> 길이·요약은 아래 §7-2 의 `edges` 를 쓴다 — 그쪽은 기하 정의다.

### 7-1. 부재 식별자 `partId` · `slot` (B1, `bom_payload.materials[]` 행에 추가)

`MaterialExtractor.add()` 가 내는 **모든** 자재 행에 붙는다. 기존 필드는 그대로다 (불변조건 I4).

```
partId = `${itemIdx}-${moduleId}-${partKey}-${n}`     예: 0-l2-drawer#0-0, 1-w1-body:side-1, 3-corner-blind-lower-blindfin#0-0
```

| 조각 | 뜻 |
|------|-----|
| `itemIdx` | `design.items` 의 순번 (BOM 이 없는 품목도 센다 — 문서·플래너와 같은 번호) |
| `moduleId` | `mod.id` (플래너/상세설계 모듈 id). 없으면 `${pos\|type}-${idx}`. 품목 단위 마감재(EP) 행은 `ep`. id 에 `-` 가 들어갈 수 있으므로 partId 를 쪼개 읽지 않는다 |
| `partKey` | 부재 종류의 안정된 키. 같은 종류가 한 모듈에 여럿이면 `#k` (0부터) |
| `n` | 같은 (품목, 모듈, partKey) 되풀이 순번 — 보통 0. 붙박이 short/shelf 의 상·하부장 측판이 여기서 갈린다 |

`partKey` 는 플래너 디테일 모델(`js/planner/planner-finish.js` `plannerFinishPartKeyOf`)과 **같은 이름**을 쓴다.
부재 이름 → 키·슬롯 표는 `extractors.js` `BOM_PART_DEFS` 가 정본이다 (표에 없는 이름은 `part:<이름>` 폴백으로 떨어지며 시험이 막는다).

| 슬롯 | partKey | 부재 |
|------|---------|------|
| `door` | `door#k` | 도어 |
| `drawerFront` | `drawer#k` | 서랍도어 |
| `body` | `body:side` `body:top` `body:bottom` `shelf#k` `body:band#k` `body:brace#k` `body:batten-front/side` `drawerbox:fb/side/brace` `innerdrawer:*` | 측판(좌·우 한 행) · 천판 · 지판 · 선반 · 밴드 · 처짐방지 · 경첩목대 · 서랍 상자 · 내부서랍 |
| `back` | `back` `drawerbox:bottom` | 뒷판 · 서랍밑판 (2.7T — 칠하지 않는다) |
| `handle` | `channel:front` `channel:back` | 목찬넬(전면·지면) |
| `finishing` | `molding` `molding:left/right[-pad]` `molding:corner1/2` `filler:left/right/corner1/2` `ep:left/right` `blind#k` `blindfin#k` | 상몰딩 · 좌우 몰딩·덧대 · 휠라 · EP · 멍가림판/멍판 EP · 멍판 마감재 |
| `kick` | `kick` `pedestal:fb/side/brace` | 걸레받이 · 좌대 |
| `top` | `top` | 상판 (P1-3 — 품목 단위 `ep` 한 장, `partId 0-ep-top-0`. 품목당 한 장은 결정 사항(2026-09-15)이라 런 번호가 붙지 않는다. 마감 코드는 디테일 `top` 슬롯 > `specs.topColor` 의 `TOP-*`; `edgeCode` 는 없다) |

BOM 행은 수량으로 묶여 있어(측판 qty 2 = 좌+우) 한 행이 플래너 부재 여럿을 대표한다. 디테일 모델의 부재 단위 지정이 행에 닿도록
`extractors.js` `bomFinishCandidates` 가 후보를 늘어놓는다: `body:side ← body:left/right`, `door#k ← door#k-0/1`(양문),
플래너 셀 모듈 `planner-X-i ← X 의 door#i · drawer#i · drawer#bi · X 의 모듈 지정`. 같은 단계면 앞선 후보가 이긴다.

### 7-2. 엣지밴딩 길이 (B1)

문자열 `edge` 는 그대로 두고 아래를 더한다. 변은 **기하**로 정한다 — `L/R` 은 세로(`h`) 변, `T/B` 는 가로(`w`) 변.

| 필드 | 값 |
|------|-----|
| `edges` | `{L,R,T,B}` 불리언. `4면` 전부 · `3면` 긴 변 하나 + 짧은 변 둘(측판 앞·위·아래) · `2면(장)` 긴 변 둘 · `2면(가로)` T·B · `1면(전)`/`1면(장)` 긴 변 하나(전면) · `-` 없음. 세로가 길면(`h > w`) 긴 변은 L/R, 아니면 T/B |
| `edgeLen` | 장당 mm = Σ 붙이는 변의 치수 (`L/R → h`, `T/B → w`) |
| `edgeT` | 밴드 두께: 도어·서랍도어(`door`/`drawerFront`) **1.0**, 나머지 **0.6** (§2) |
| `edgeCode` | 밴드 마감: `door`/`drawerFront`/`finishing` 은 그 행의 `finishCode` (비면 `null`), 몸통·바닥·손잡이는 `null` |
| `extract().edgeBanding` | `{ '1': mm, '0.6': mm }` = 두께별 Σ `edgeLen × qty`. `summary` 안이 아니라 형제 키다 — `ai-design-report.js`·워커가 `summary` 값을 전부 자재 그룹으로 순회하기 때문 |

`1면(전)` 을 "긴 변 하나" 로 보는 것은 근사다 — 좌대 측처럼 짧은 변이 앞인 부재는 길이가 조금 과하다 [확인 필요].

### 7-3. 재단 배치 `cutPlan` (B4, `design_snapshots.cut_plan_payload`)

`js/detaildesign/nesting-engine.js` `NestingEngine.plan(materials, opts)` 의 출력이다. CNC 탭(`ai-design-report.js`)이 그리는 것과
스냅샷 동결 시 `workflow-client.js` 가 POST 본문 `cutPlan` 으로 싣는 것이 **같은 함수·같은 입력**이라 같은 값이다.
같은 `materials` 면 입력 순서와 무관하게 같은 JSON 이 나온다(결정적). 알고리즘·옵션은 `docs/02-design/features/nesting-engine.md`.

```
cutPlan = {
  version: 1,
  sheetSize: {w, h},          // 기본 원판 (data-constants SHEET_W/H = 1220×2440)
  kerf: 4, trim: 10,          // 톱날 · 네 변 가장자리 트림(mm)
  sheets: [ {                 // 낱장 — 겹침 재단(stack)도 한 장씩 늘어놓는다
    no,                       // 1부터, 전체 고유
    material, thickness, partClass,   // partClass ∈ 본체 | 도어 | 뒷판 (원판을 섞지 않는 그룹)
    size: {w, h}, trim,
    layout: { no, stack, index, dir, rotated },   // 같은 그룹에서 같은 layout.no = 같은 배치를 stack 장 겹침. dir ∈ H(가로→세로) | V
    strips: [ { no, offset, size, used, remain } ],  // 1차 재단 스트립 (H: offset=y·size=높이, V: offset=x·size=너비)
    parts: [ { partId, part, w, h, x, y, rot, grain, strip, edge?, itemLabel?, fromRemainder? } ],
    usedArea, yield           // Σ w×h / (size.w×size.h)
  } ],
  offcuts: [ { sheetNo, kind, x, y, w, h, free } ],  // kind ∈ strip | sheet. free = 잘려 남은 쪽 치수. 60mm 이상만
  groups:  [ { key, material, thickness, partClass, sheetSize, sheetCount, firstSheetNo, needed, placed } ],
  smallParts:  [ { partId, part, material, thickness, partClass, w, h, qty, itemLabel } ],  // 한 변 ≤ 70 — 원판에 놓지 않는다
  unallocated: [ { material, thickness, partClass, w, h, qty, parts, partIds } ],           // 원판보다 큰 부재 등
  summary: { sheetsByMaterial: {'PB_15': n}, sheetCount, totalYield, partsTotal, partsPlaced, smallCount, unallocatedCount }
}
```

| 필드 | 뜻 |
|------|-----|
| `parts[].partId` | `${자재 행 partId}#${k}`, k = 0..qty-1 — 수량을 낱개로 전개한 식별자. 행 partId 자체에 `#`(`door#0`) 이 있으므로 **마지막 `#숫자`** 만 뗀다 (`NestingEngine.basePartId`). partId 가 없는 옛 행은 `row-<index>` |
| `parts[].w, h` | 부재 자체 치수 — BOM 행 그대로 |
| `parts[].rot` | true 면 눕혀 놓았다: 원판 위 발자국은 `h × w`. 결 부재(`grain !== 'none'`)와 회전 금지 자재(무늬목·우드·결 PET)는 항상 false |
| `parts[].x, y` | 원판 좌상단 기준 절대 mm — 트림만큼 밀려 시작한다 (기본 10) |
| `parts[].strip` | 속한 1차 재단 스트립 번호 (1부터) |
| `parts[].fromRemainder` | 스트립 1차 배치가 끝난 뒤 남는 자리에 넣은 더 작은 부재 |
| `offcuts[].free` | 스트립 잔여는 스트립 방향(H 면 w), 원판 잔여는 스트립을 쌓는 방향(H 면 h). 60~70 = 자투리(밴드), 70 초과 = 잔재(소부품 추출·재활용) |

워커(`workers/workflow-api/src/snapshots.js` `validateCutPlan`)는 배치를 **다시 계산하지 않고** 검증만 한다: `version === 1`, 시트 `no` 고유·`size` 양수·`material` 비지 않음,
모든 `partId` 의 기본 partId 가 `bom.materials` 에 있고 행별 배치 개수 ≤ `qty`, `rot` 을 반영한 발자국이 원판 안, 같은 시트에서 겹침 없음.
통과하면 `cut_plan_payload` 에 그대로, `sheet_count = sheets.length` 로 저장한다 (`database/workflow-cut-plan.sql`). `cutPlan` 이 없으면 둘 다 NULL.
`content_hash` 는 design+bom 만으로 계산하므로 배치는 rev 판정에 영향이 없다 — 같은 BOM 이면 같은 배치가 나온다.

### 7-4. 작업지시서 v2 가 읽는 것 (B5, `workers/workflow-api`)

문서는 `docs/02-design/features/work-order-v2.md`. 작업지시서는 위 필드를 이렇게 쓴다 — BOM 쪽에서 이름을 바꾸면 문서가 깨진다.

| 문서 섹션 | 읽는 필드 |
|---|---|
| ② 모듈별 키팅 · ⑧ 라벨 | `materials[].partId slot finishCode edges edgeT edge itemLabel module part material thickness w h qty note`. 라벨 id 는 `partId#k` (k = 0..qty−1) — §7-3 의 `parts[].partId` 와 같다. partId 없는 옛 행은 `row-<index>` |
| ③ 시트별 재단표 | `cutPlan.sheets[].{no material thickness partClass size trim layout parts[].{partId part w h x y rot} yield}` · `offcuts` · `smallParts` · `unallocated` · `summary.sheetsByMaterial totalYield` · `kerf trim` |
| ⑤ 보링 좌표표 | 경첩 행 `hardware[].note` = `${mod.name} (보링: 110, 358, 606)` (`HardwareExtractor.extractHinges`). 구조화 `boring[]` 필드가 생기면 그것을 우선 읽는다. 도어 행 매칭은 `itemLabel` + `module` 라벨에서 `#n `·`상부장-/하부장-`·`(단)` 을 뗀 이름 = `mod.name` |
| ⑦ rev 차이 | `partId` 로 맞춰 `w h thickness qty finishCode material` 비교 |
| ① 스와치 | `finishCode` 고유값 → `materials.code` (`color_name color_hex vendor_code series finish tone`) — §2-1 정본 |

---

## 8. 핵심 공식 요약

```
내부 폭 (PB)  = W - (15 × 2) = W - 30       // 천판/지판/선반 (본체 PB 15T)
내부 폭 (MDF) = W - (18 × 2) = W - 36       // 홈카페장 등 MDF 18T 본체
천판/지판 깊이 = D - 18                      // sakuri 감소 (15mm 측판에 3mm 홈)
선반 깊이      = D - 34                      // sakuri(18) + 여유(16)
뒷판 크기     = (W - 20) × (H - 1)          // sakuri홈 끼움 (좌우 10mm씩)
도어 폭       = W / doorCount - 4            // 4mm 간격
원판 소요     = (총면적 × 1.15) / (1220 × 2440)  // 15% 로스율
엣지밴딩 (도어) = Σ(도어 둘레 × doorCount)    // 1mm, mm 단위
엣지밴딩 (본체) = Σ(본체 둘레)               // 0.6mm, mm 단위
bodyH (붙박이) = 전체H - 좌대H - 상몰딩H
```

---

## 9. MCP 서버 BOM 규칙 설정 (bom-rules.json)

```json
{
  "materials": {
    "sheet_size": [1220, 2440],
    "body": "15T PB",
    "door": "18T MDF",
    "back_panel": "2.7T MDF",
    "edge_band_door": "1mm",
    "edge_band_body": "0.6mm",
    "countertop_door": "18mm",
    "countertop_stone": "12mm, 50mm"
  },
  "construction": {
    "side_panel_qty": 2,
    "bottom_panel_qty": 1,
    "band_qty": 2,
    "band_width": 50,
    "back_panel_qty": 1,
    "back_panel_clearance": 1,
    "door_gap": 4,
    "shelf_depth_reduction": 20
  },
  "upper_cabinet": {
    "depth_ratio": 0.55,
    "top_panel": true
  },
  "hardware": {
    "hinges_per_door": 2,
    "hinge_type": "soft-close",
    "slide_type": "soft-close"
  },
  "wardrobe": {
    "unit_width_min": 750,
    "unit_width_max": 1050,
    "allow_half_units": true,
    "shelf_per_section": 1
  }
}
```

---

## 10. BOM 타입 정의 (TypeScript)

```typescript
type BomPartCategory =
  | 'panel'      // 도어, 측판, 선반
  | 'board'      // 천판, 지판, 뒷판
  | 'hardware'   // 경첩, 레일, 핸들
  | 'countertop' // 상판
  | 'equipment'  // 싱크, 쿡탑, 후드
  | 'accessory'  // 몰딩, 다리발, 필러
  | 'finish';    // 엣지밴딩

interface BomItem {
  id: string;
  part_category: BomPartCategory;
  name: string;
  material: string;
  width_mm: number;
  height_mm: number;
  depth_mm: number;
  quantity: number;
  unit: string;           // "ea" | "mm" | "set"
  cabinet_ref?: string;   // "lower_0", "upper_2"
  notes?: string;
}

interface BomSummary {
  total_items: number;
  total_panels: number;
  total_hardware: number;
  total_equipment: number;
  categories: Record<BomPartCategory, number>;
  sheet_estimate?: number; // 1220×2440 원판 소요 매수
}
```
