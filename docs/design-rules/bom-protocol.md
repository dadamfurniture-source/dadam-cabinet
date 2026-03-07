# BOM 산출 프로토콜

> Bill of Materials 산출 기준, 공식, 카테고리별 규칙 종합

## 1. 지원 카테고리 & 처리 계층

| 계층 | 위치 | 지원 카테고리 |
|------|------|-------------|
| **프론트엔드** | `detaildesign.html` MaterialExtractor | sink, wardrobe, fridge |
| **MCP 서버** | `bom.service.ts` | sink, wardrobe, fridge, vanity, shoe, storage |
| **설계 규칙** | `docs/design-rules/` | 6개 문서 (common, sink, wardrobe, fridge, etc.) |

> 신발장/화장대/수납장/창고장은 프론트엔드 BOM 미지원 (MCP 서버만 가능)

## 2. 공통 자재 기준

| 항목 | 값 |
|------|-----|
| 원판 규격 | 1220 × 2440mm |
| 본체 자재 | **PB 15T** (Particle Board) |
| 도어 자재 | **MDF 18T** |
| 뒷판 자재 | **MDF 2.7T** |
| 도어 엣지밴딩 | 1mm |
| 본체 엣지밴딩 | 0.6mm |
| 도어자재 상판(countertop) | 18mm |
| 인조대리석 자재 상판(countertop) | 12mm, 50mm |
| 원판 소요 추정 | `(총면적 × 1.15) / (1220 × 2440)` — 15% 로스율 |

## 3. 카테고리별 BOM 산출 공식

### 3-1. 싱크대 (sink)

#### 상부장

> 코드 위치: `detaildesign.html` MaterialExtractor 내 상부장 처리 블록

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 비고 |
|------|------|------|----------|------|------|------|
| 측판 | PB | 15T | D(295) × H | 2 | 4면 | sakuri(15→3mm) |
| 천판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | |
| 밴드(보강목) | PB | 15T | (W-30) × 50 | 2 | 2면(장) | |
| 밴드(처짐방지) | PB | 15T | 70 × (H-30) | **W≥700:2 / 1** | 2면(장) | |
| 선반 | PB | 15T | (W-30) × (D-34) | 2 | 1면(전) | |
| 도어 | MDF | 18T | (W/doorCount-4) × (H+20) | doorCount | 4면 | |

#### 하부장

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 | 조건 |
|------|------|------|----------|------|------|------|
| 측판 | PB | 15T | D × H | 2 | 4면 | sakuri(15→3mm) |
| 지판 | PB | 15T | (W-30) × (D-18) | 1 | 1면(전) | sakuri 감소 |
| 밴드 | PB | 15T | 50 × (W-30) | 2 | 2면(장) | |
| 뒷판 | MDF | 2.7T | (W-20) × (H-1) | 1 | - | |
| 밴드(처짐방지) | PB | 15T | 70 × bandH | **W≥800:2 / 1** | 2면(장) | 목찬넬시 bandH=H-30-70 |
| 선반 | PB | 15T | (W-30) × (D-34) | 1 | 1면(전) | **서랍/EL/오픈/싱크 제외** |
| 도어 | MDF | 18T | (W/doorCount-4) × (H-30) | doorCount | 4면 | |

#### EP (마감재)

| 부품 | 자재 | 두께 | 크기 |
|------|------|------|------|
| 걸레받이 | MDF | 18T | effectiveW × (legH-5) |
| 목찬넬(전면) | MDF | 18T | 52 × effectiveW |
| 목찬넬(지면) | MDF | 18T | 40 × effectiveW |
| 휠라(좌) | MDF | 18T | finishLeftWidth × lowerH |
| 휠라(우) | MDF | 18T | finishRightWidth × lowerH |

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

**도어** — 통합 (상부+하부 전체 높이)

| 부품 | 자재 | 두께 | 크기(W×H) | 수량 | 엣지 |
|------|------|------|----------|------|------|
| 도어 | MDF | 18T | (W/doorCount-4) × (upperH+lowerH+20) | doorCount | 4면 |

> 외부서랍 시: 도어 높이 = upperH+lowerH - drawerCount×300 + 20

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
| 도어 | MDF | 18T | (W/doorCount-4) × (H+20) | doorCount | 4면 | |

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

## 4. 하드웨어 산출 규칙

> 코드 위치: `detaildesign.html` HardwareExtractor 클래스, `docs/design-rules/common.md`

### 4-1. 경첩

| 도어 높이 | 경첩 수 | 보링 위치 |
|-----------|---------|----------|
| ≤900mm | 2구 | [110, H-110] |
| ≤1600mm | 3구 | [110, H/2, H-110] |
| >1600mm | 4구 | [110, H/3, H×2/3, H-110] |

### 4-2. 서랍레일

| 캐비닛 깊이 | 레일 길이 | 타입 |
|-------------|----------|------|
| ≤350mm | 350mm | 소프트클로징 |
| ≤450mm | 450mm | 소프트클로징 |
| >450mm | 500mm | 소프트클로징 |

### 4-3. 기타 하드웨어

| 항목 | 규칙 |
|------|------|
| 핸들 | 도어 수량 = 핸들 수량 |
| 다리발 | W≤600→4개, W≤1200→6개, W>1200→8개 |
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

엣지 매핑:
- `4면` → L=1, R=1, T=1, B=1
- `1면(전)` → L=0, R=0, T=0, B=1 (전면만)
- `2면(장)` → L=1, R=1, T=0, B=0 (좌우 장변만)
- `2면(가로)` → L=0, R=0, T=1, B=1 (상하 가로변만)
- `-` → L=0, R=0, T=0, B=0 (없음)

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
