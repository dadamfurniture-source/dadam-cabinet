# 공통 설계 규칙 (Common Design Rules)

## 1. 카테고리 목록

| ID | 이름 | 기본 깊이(mm) |
|----|------|---------------|
| sink | 싱크대 | 650 |
| island | 아일랜드 | 800 |
| wardrobe | 붙박이장 | 650 |
| fridge | 냉장고장 | 700 |
| shoerack | 신발장 | 350 |
| vanity | 화장대 | 500 |
| storage | 수납장 | 400 |
| warehouse | 창고장 | 450 |
| door | 도어교체 | 18 |
| custom | 비규격장 | 0 |

## 2. 도어 너비 최적화 알고리즘 (v28)

### 상수
- `DOOR_TARGET_WIDTH` = 450mm (목표 도어 너비)
- `DOOR_MAX_WIDTH` = 600mm (최대)
- `DOOR_MIN_WIDTH` = 350mm (최소)
- `MIN_REMAINDER` = 4mm (최소 잔여)
- `MAX_REMAINDER` = 10mm (최대 잔여)

### findBestDoorWidth(totalSpace, doorCount)

도어 너비 후보를 산출 후 우선순위로 선택:

마감 타입에 따라 우선순위가 변경:

**몰딩 마감 (좌/우 중 하나라도 Molding):**
1. **최우선**: 0mm <= 잔여공간 < 4mm (빈틈 없이 채움)
2. **차선**: 4mm <= 잔여공간 <= 10mm

**비몰딩 마감 (Filler/EP/None):**
1. **최우선**: 4mm <= 잔여공간 <= 10mm (시공 공차)
2. **차선**: 0mm <= 잔여공간 < 4mm (정확히 나누어 떨어지는 경우)

후보 생성 방식:
- 10의 단위 내림/올림 (priority 1)
- 짝수 내림/올림 (priority 2)
- 범위: `DOOR_MIN_WIDTH` <= 후보 <= `DOOR_MAX_WIDTH`

동점 시: priority 낮은 것 > gap 작은 것

### distributeModules(totalSpace)

**각 갭(gap)을 독립적으로** 균등 배분:

1. 고정 모듈 사이 갭(gap) 목록 계산
2. 작은 갭(< DOOR_MIN_WIDTH=350mm) → 모듈 생성 불가 → 큰 갭에 흡수
3. 흡수: 작은 갭 총 너비를 큰 갭에 균등 분배
4. 각 큰 갭에 대해 독립적으로 `findBestDoorWidth()` 호출
5. 정렬: isPrimary 우선 > 목표너비(450)에 가까운 순 > 잔여 작은 순
6. **2D/1D 모듈 패턴**: `doorCount / 2 = 몫(2D모듈) + 나머지(1D모듈)`
   - 2D 모듈: `doorWidth * 2` mm
   - 1D 모듈: `doorWidth` mm

## 3. 유효공간 계산

```
유효공간 = 전체너비 - 좌측마감 - 우측마감 - 코너1마감 - 코너2마감
```

- I형: 코너마감 없음
- L형: 코너1마감 적용
- U형: 코너1 + 코너2마감 적용

수동 입력 시 수동값 우선 (effectiveUpperW / effectiveLowerW)

## 4. 마감 타입 및 기본값

| 타입 | 기본 너비(mm) | 설명 |
|------|--------------|------|
| Molding (몰딩) | 60 | |
| Filler (휠라) | 60 | |
| EP | 20 | 고정값 |
| None (없음) | 0 | |

## 5. 실측 기준

- `measurementBase`: Left(좌측) 또는 Right(우측)
- 분배기 시작(distributorStart), 분배기 끝(distributorEnd), 환기 시작(ventStart) 등 설비 관련 위치도 기록

## 6. 기본 스펙 (DEFAULT_SPECS)

```javascript
{
  layoutShape: 'I',           // I / L / U
  doorColorUpper: '화이트',
  doorFinishUpper: '무광',
  doorColorLower: '화이트',
  doorFinishLower: '무광',
  topColor: '스노우',
  topThickness: 12,
  upperH: 720,               // 상부장 높이
  lowerH: 870,               // 하부장 높이
  moldingH: 60,              // 상몰딩 높이
  sinkLegHeight: 150,        // 다리발 높이
  handle: '찬넬 (목찬넬)',
  measurementBase: 'Left',
  finishLeftType: 'Filler',
  finishLeftWidth: 60,
  finishRightType: 'Filler',
  finishRightWidth: 60,
}
```

## 7. BOM 자재 기본값

| 항목 | 자재 | 두께 |
|------|------|------|
| 몸통(측판/천판/지판) | PB | 18T |
| 도어 | MDF | 18T |
| 뒷판 | MDF | 2.7T |
| 원판 크기 | - | 1220 x 2440mm |

## 8. 부자재(Hardware) 공통 규칙

### 경첩
| 도어 높이 | 경첩 수 |
|-----------|---------|
| ~900mm | 2개 |
| 901~1600mm | 3개 |
| 1601mm~ | 4개 |

보링 위치:
- 2구: [110, H-110]
- 3구: [110, H/2, H-110]
- 4구: [110, H/3, H*2/3, H-110]

### 레일 (서랍장)
| 깊이 | 레일 길이 |
|------|-----------|
| ~350mm | 350mm |
| 351~450mm | 450mm |
| 451mm~ | 500mm |

### 다리발 (싱크대 하부장)
| 모듈 너비 | 다리발 수 |
|-----------|-----------|
| ~600mm | 4개 |
| 601~900mm | 6개 |
| 901mm~ | 8개 |

### 선반 브라켓
- 상부장: 모듈당 선반 2개 (후드 제외)
- 하부장: 모듈당 선반 1개 (서랍/싱크/쿡탑 제외)
- 브라켓: 선반 1개당 4개 (핀타입 Φ5mm)

### 도어 댐퍼
- 도어 1개당 2개
