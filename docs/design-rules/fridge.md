# 냉장고장 (Fridge) 설계 규칙

> categoryId: `fridge`

## 1. 기본 치수 및 규칙 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| MAX_UPPER_H | 400mm | 상부장 최대 높이 |
| PEDESTAL_H | 60mm | 좌대 기본 높이 |
| LEG_H | 60mm | 다리발 높이 |
| LOWER_BODY_H | 810mm | 하부장 모듈 높이 (다리 제외) |
| MODULE_D | 550mm | 모듈 기본 깊이 |
| INSTALL_D | 700mm | 설치 필요 깊이 |
| TOP_GAP | 15mm | 냉장고 상단 간격 (고정) |
| MOLDING_H | 50mm | 상몰딩 기본 높이 |
| EL_W | 600mm | 키큰장/EL장 기본 폭 |
| HOMECAFE_W | 600mm | 홈카페장 기본 폭 |

## 2. 높이 자동 계산

```
상부장 높이 = min(MAX_UPPER_H, 전체H - 냉장고H - TOP_GAP(15) - MOLDING_H)
모듈본체H = 전체H - MOLDING_H - 상부장H - PEDESTAL_H
중간장 높이 = floor(모듈본체H * 0.55)
하부장 높이 = floor(모듈본체H - 중간장H)
```

> 냉장고는 바닥에서 시작 (좌대 영역 무관)

높이 연동 규칙:
- 상부장H 변경 시 → 중간장/하부장 55:45 재분배
- 중간장H 변경 시 → 하부장H = 모듈본체H - 중간장H
- 하부장H 변경 시 → 중간장H = 모듈본체H - 하부장H

## 3. 하부 다리 타입

| ID | 이름 | 기본 높이 |
|----|------|-----------|
| pedestal | 좌대 | 60mm |
| leg | 다리발 | 60mm |

## 4. 냉장고 모델 데이터 구조

```javascript
{
  id: 'lg_300l',
  name: '단독 300L',
  w: 595,             // 냉장고 본체 너비
  h: 1780,            // 냉장고 본체 높이
  d: 680,             // 냉장고 본체 깊이
  type: 'builtin',    // builtin / freestanding
  line: 'fitmax',     // 제품 라인
  sideGap: 4,         // 좌우 여유 간격
  betweenGap: 8,      // 유닛 간 간격 (멀티도어)
  units: [            // 개별 유닛 정보
    { name: '300L', w: 595 }
  ]
}
```

## 5. 여유공간 기본값 (브랜드별)

| 키 | 좌우 간격 | 유닛 간 간격 |
|----|-----------|-------------|
| LG_BUILTIN | 4mm | 8mm |
| LG_FREESTANDING | 50mm | 0mm |
| SS_BESPOKE | 12mm | 10mm |
| SS_INFINITE | 5mm | 10mm |
| SS_FREESTANDING | 50mm | 0mm |

## 6. 모듈 구성

### 냉장고 모듈 (type: 'fridge')
- 냉장고 자체 크기 + 좌우 sideGap + units 간 betweenGap
- 냉장고 너비 = sideGap*2 + sum(unit.w) + (units.length-1)*betweenGap
- 냉장고는 BOM 자재 추출에서 제외

### 키큰장 (type: 'tall')
- 중간장 + 하부장 + 좌대 구조
- EL 모듈(elModules) 배열로 중간장 내부 구성
- 기본 너비: 600mm

### 홈카페장 (type: 'homecafe')
- 키큰장과 동일 구조
- 오픈형 중간장 (도어 없음, 중간장에만)
- 기본 너비: 600mm

## 7. EL 모듈 (중간장 내부)

### 모듈 타입
| type | 설명 | 기본 높이 |
|------|------|-----------|
| el | 기본 모듈/EL장 | 300mm (잔여높이 기반) |
| open | 오픈장 (도어 없음) | 450mm |

### 속성
- `isEL`: true면 EL장(전동수납), false면 기본모듈
- `isFixed`: 자동계산 시 높이 고정 여부
- `doorType`: swing(여닫이) / slide(슬라이딩) / lift(리프트업) — 오픈장은 null

### EL 자동계산 (autoCalculateELModules)
1. 고정 모듈의 높이 합계 계산
2. 비고정 모듈에 잔여 높이 균등 분배: `heightPerModule = floor(available / unfixedCount)`

## 8. 도어 구분 (doorDivision)

| ID | 이름 | 설명 |
|----|------|------|
| individual | 개별 | EL 모듈별 도어 (오픈장 제외) + 하부장 도어 |
| midLower | 중간장/하부장 | 중간장 통합 도어 + 하부장 분리 도어 |
| all | 전체 | 중간장+하부장 통합 도어 |

## 9. 하부장 모듈 타입 (LOWER_MODULE_TYPES)

| ID | 이름 | 아이콘 |
|----|------|--------|
| default | 기본 | 🗄️ |
| robot | 로봇청소기 | 🤖 |
| rice | 쌀통 | 🍚 |
| foodwaste | 음식물쓰레기 | ♻️ |

## 10. 자동계산 (autoCalculateFridge)

1. 냉장고 모듈(type='fridge')과 고정 모듈(isFixed)의 너비 합산
2. 잔여공간 = effectiveW - fixedW
3. 비고정 모듈에 균등 분배: `perModuleW = floor(remainingW / adjustableCount)`
4. 최소 모듈 너비: 300mm

## 11. BOM 자재 추출 (냉장고장)

### 키큰장
| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 |
|------|------|------|------|------|------|
| 측판 | PB | 18T | D x H | 2 | 4면 |
| 천판 | PB | 18T | (W-36) x D | 1 | 1면(전) |
| 지판 | PB | 18T | (W-36) x D | 1 | 1면(전) |
| 뒷판 | MDF | 2.7T | (W-1) x (H-1) | 1 | - |
| 선반 | PB | 18T | (W-36) x (D-15) | 3 | 1면(전) |
| 도어 | MDF | 18T | ((W-4)/doorCount) x (H+20) | doorCount | 4면 |

### 홈카페장
| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 |
|------|------|------|------|------|------|
| 측판 | MDF | 18T | (D+20) x H | 2 | 4면 |
| 천판 | MDF | 18T | (W-36) x D | 1 | 2면(가로) |
| 지판 | MDF | 18T | (W-36) x D | 1 | 2면(가로) |
| 뒷판 | MDF | **18T** | (W-36) x H | 1 | 2면(가로) |
| 선반 | MDF | 18T | (W-36) x (D-15) | 2 | 1면(전) |
| 도어 | MDF | 18T | ((W-4)/doorCount) x (H+20) | doorCount | 4면 |

> 홈카페장 뒷판은 18T MDF (일반 2.7T가 아님!)

### 상부장 / 하부장 / EL장
상부장/하부장은 표준 PB 구조, EL장은 뒷판만 있는 간소 구조.
