# 붙박이장 (Wardrobe) 설계 규칙

> categoryId: `wardrobe`

## 1. 기본 치수

| 항목 | 기본값 |
|------|--------|
| 기본 깊이 | 650mm |
| 좌대 높이 | 60mm |
| 상몰딩 높이 | 15mm |
| 커튼박스 | W=0, H=0 (비활성) |

## 2. 높이 계산

```
유효높이(bodyH) = 전체높이(H) - 좌대(60) - 상몰딩(15)
상부장 높이(halfH) = floor(유효높이 / 2)
하부장 높이(halfH) = floor(유효높이 / 2)
```

## 3. 유효공간 (가로)

```
자동계산: W - 좌측마감너비 - 우측마감너비
수동입력: specs.wardrobeEffectiveW (우선 적용)
```

마감재 기본값: 몰딩=60, 휠라=60, EP=20, 없음=0

## 4. 모듈 타입

| moduleType | 이름 | 구조 | 기본값 |
|-----------|------|------|--------|
| short | 짧은옷(2단) | 상부장 + 하부장 분리 | 상/하 각 halfH, 서랍 0 |
| long | 긴옷(1단) | 단일 통 | 전체 effectiveH, 서랍 1, 선반 1 |
| shelf | 선반형 | 상부장 + 하부장 분리 | 선반 상부2 + 하부2 |

### 모듈 기본 생성값
```javascript
{
  w: 900,
  d: item.d || 650,
  moduleType: 'short',
  isDivided: true,
  drawerCount: 0,
  shelfCount: 0,
  shelfCountUpper: 0,
  shelfCountLower: 0,
  hasMirror: false,
  isExternalDrawer: false,
}
```

## 5. 내부 구성 상수

| 상수 | 값 | 설명 |
|------|-----|------|
| PANEL_THICKNESS | 15mm | 천판/지판/선반 두께 |
| ROD_OFFSET | 75mm | 옷봉 위치 (상단에서) |
| LONG_FIRST_SHELF | 315mm | 긴옷 첫 선반 (상단에서) |
| DRAWER_HEIGHT | 300mm | 서랍 높이 (고정) |
| SMARTBAR_WIDTH | 30mm | 스마트바 너비 |

## 6. 선반 깊이·위치 계산

### 선반 깊이
```
선반 깊이 = 천저판 깊이 - 70
         = (modD - 18) - 70
         = modD - 88
```
- 천저판: 사쿠리 반영으로 modD - 18
- 선반: 천저판보다 70mm 짧게 (전면 여유)

### 선반 위치

### 일반 선반 (짧은옷/선반형)
```
usableH = moduleH - 천판(15) - 지판(15) - 선반갯수 * 15
spacing = usableH / (선반갯수 + 1)
```

### 긴옷 선반
- 첫 선반: 상단에서 -315mm 고정
- 나머지: 첫 선반 아래 균등 분배

## 7. 서랍 규칙

- 높이: 300mm 고정
- 최대: 5개 (drawerCount: 0~5)
- 내부형(isExternalDrawer=false): 모듈 내부에 배치
- 외부형(isExternalDrawer=true): 도어 영역에서 분리 표시
- 서랍 손잡이: 중앙에 30mm 바 핸들

## 8. 선반형 모듈 배타적 규칙

선반형(shelf)에서 **선반과 옷봉은 배타적**:
- 상부장: 선반 추가 시 → 옷봉 자동 제거 / 옷봉 추가 시 → 선반 자동 제거
- 하부장: (선반 또는 서랍) 추가 시 → 옷봉 자동 제거 / 옷봉 추가 시 → 선반+서랍 자동 제거
- 옷봉은 최대 1개

## 9. 자동계산 (runWardrobeAutoCalc)

### 일반 모드 (bar/cchannel/push 핸들)

1. 유효공간에 대해 `distributeModules()` 호출
2. 600mm 기준으로 2D/1D 판별
3. 모듈 타입 자동 할당 (getModuleTypeDefaults):

| 구성 | 모듈 배치 |
|------|----------|
| 2통 (2D, 2D) | 짧은옷, 긴옷 |
| 3통 (2D, 2D, 2D) | 짧은옷, 짧은옷, 긴옷 |
| 4통 (2D, 2D, 2D, 2D) | 짧은옷, 짧은옷, 긴옷, 선반형 |
| 2D+1D (2+1) | 짧은옷, 긴옷, [1D=선반형] |
| 3D+1D (3+1) | 짧은옷, 짧은옷, 긴옷, [1D=선반형] |
| 1D만 | 선반형 |

### 스마트바 모드

1. 총 도어 수 = round(effectiveW / 480)
2. 2D 우선: `modules2D = floor(totalDoors / 2)`, `modules1D = totalDoors % 2`
3. 스마트바 총 너비 = totalModules * 30
4. 도어 공간 균등 배분: `doorWidth = floor((effectiveW - smartbarTotal) / totalDoors)`
5. 모듈 너비: 2D = `doorWidth * 2 + 30`, 1D = `doorWidth + 30`
6. 시공 여유 허용: 10mm

## 10. 하드웨어 옵션

| 항목 | 선택지 |
|------|--------|
| 손잡이 | 일자 손잡이 / C찬넬 / 푸쉬 도어 / 스마트바 |
| 레일 | 소프트클로징 / 일반 레일 / 풀익스텐션 |
| 실측 기준 | 좌측 / 우측 |

## 11. BOM 자재 추출 (붙박이장)

| 부품 | 자재 | 두께 | 크기 | 수량 | 엣지 |
|------|------|------|------|------|------|
| 측판 | PB | 18T | D x bodyH | 2 | 4면 |
| 천판 | PB | 18T | (W-36) x D | 1 | 1면(전) |
| 지판 | PB | 18T | (W-36) x D | 1 | 1면(전) |
| 뒷판 | MDF | 2.7T | (W-1) x (bodyH-1) | 1 | - |
| 중간칸막이 | PB | 18T | (W-36) x D | 1 (짧은옷만) | 1면(전) |
| 선반 | PB | 18T | (W-36) x (천저판D - 70) | 선반형=4개, 기타=1개 | 1면(전) |
| 도어 | MDF | 18T | ((W-4)/doorCount) x (bodyH+20) | doorCount | 4면 |

### EP
| 부품 | 자재 | 두께 | 크기 |
|------|------|------|------|
| 상몰딩 | MDF | 18T | totalW x moldingH |
| 좌대 | PB | 18T | totalW x pedestalH |

## 12. MCP 서버 규칙 (bom-rules.json)

```json
{
  "wardrobe": {
    "unit_width_min": 750,
    "unit_width_max": 1050,
    "allow_half_units": true,
    "shelf_per_section": 1
  }
}
```
