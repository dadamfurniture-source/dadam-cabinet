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

## 6. BOM 규칙

현재 MaterialExtractor는 `sink`, `wardrobe`, `fridge` 3개만 처리.
간단 카테고리는 BOM 추출 미지원 (향후 추가 필요).
