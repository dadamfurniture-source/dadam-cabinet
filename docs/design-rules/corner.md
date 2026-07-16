# 코너 구조 규칙 (ㄱ자 / ㄷ자)

## 1. 레이아웃 구조

| 레이아웃 | 코드 | Line 수 | 코너 수 |
|---------|------|---------|--------|
| ㅡ자형 | `I` | 1 (prime) | 0 |
| ㄱ자형 | `L` | 2 (prime + secondary) | 1 |
| ㄷ자형 | `U` | 3 (prime + secondary + tertiary) | 2 |

## 2. Line 정의

| Line | 역할 | 기본 W |
|------|------|--------|
| Prime | 주벽면 (기준선) | 사용자 입력 |
| Secondary | 코너에서 분기되는 첫 번째 벽면 | **1800mm** |
| Tertiary | Secondary 끝에서 분기되는 세 번째 벽면 (U형만) | **1800mm** |

- 하부장/상부장 모두 Secondary W 기본값 = **1800mm**
- Tertiary W 기본값 = Secondary W 또는 1800mm

## 3. 멍장 (Blind Corner Module) — 2026-07-17 규칙 확정

### 3.1 정의
멍장은 코너 교차 지점에 배치되는 모듈이다.
**"멍" = 교차하는 인접 라인에 의해 가려져 도어를 달 수 없는 구간**을 말하며,
멍장은 `멍 구간 + 도어 구간`으로 구성된 하나의 카카스다.

### 3.2 소속 라인 (사용자 결정)
- ㄱ자는 수직으로 회전된 어떤 형태든 가능
- 멍장은 **prime 또는 secondary 어느 라인에도 배치 가능** — 사용자 결정에 따른다
- 이하 공식에서 "인접 라인" = 멍장이 속하지 않은 쪽의 교차 라인

### 3.3 멍 공식 (하부장)

```
멍 W = 인접 라인 상판 깊이 − 10(물끊기) + 몰딩(기본 60)
예:  650 − 10 + 60 = 700
```

- **물끊기 10**: 상판 끝에서 떨어지는 물이 도어에 닿지 않기 위한 여유
- **몰딩 60**: 코너 접합부 마감 (`finishCorner` 기본값과 동일)

### 3.4 멍장 W — 도어 균등 분배 원칙

- 멍장의 코너 벽과 마주보는 측판은 **벽에서 50 이격** (여유공간)
- 멍장 도어 W는 **소속 라인 전체의 도어 균등 분배**로 결정된다
- **도어 최소 W = 350**
- 멍장 W = 멍 + 도어

예 (secondary 라인 1970, 인접 primeD 650, 좌측→코너 순서):

```
EP 20 + W800장(도어 400×2) + 멍장(도어 400 + 멍 700) + 여유공간 50 = 1970
→ 라인의 모든 도어 = 400 균등
→ 멍장 W = 700 + 400 = 1100
```

### 3.5 멍 구간 처리 / 내부 구조
- 멍 구간 정면: **2.7T MDF**로 가린다 (BOM 부재)
- 내부: **단일 수납 공간** (하부장 선반 기본), 하드웨어(회전 선반 등) 장착 가능

### 3.6 상부장 멍장
- 물끊기 없음
- `멍 W = 모듈(몸통 D + 도어 두께) + 몰딩`
- 관례값: **320 + 60 = 380**
  (실제로는 D295 + 도어 18 = 313이나, 여유분과 편의를 위해 320으로 계산)

### 3.7 인접 라인 시작 위치
인접 라인(멍장이 없는 라인)의 첫 모듈은 코너에서
`멍장 라인 상판 깊이 − 10(물끊기) + 몰딩(60)` 지점부터 시작한다.

```
예: 멍장이 secondary에 있고 secondaryD = 650
→ prime 시작 offset = 650 − 10 + 60 = 700
→ prime 분배 예산 = primeW − 700
```

### 3.8 기타 속성 (기존 유지)
| 항목 | 값 | 비고 |
|------|-----|------|
| 이름 | `LT망장` | type: storage (코드 호환용 명칭 유지) |
| H (높이) | = 하부 높이 - 상판 두께 - 다리 높이 | 자동 계산 |
| D (깊이) | = 소속 라인 깊이 | |
| 고정 여부 | `isFixed: true` | 자동계산에서 제거/이동 불가 (치수는 §3.3~3.4로 재계산) |
| orientation | 소속 Line 표시 | 3D 회전 표현용 |

> ⚠️ 구버전 규칙 폐기: "멍장 W = 인접 Line의 깊이(D)" 및 "상부 멍장 W = upperPrimeD(295)"는
> 2026-07-17 확정 규칙(§3.3~3.6)으로 대체되었다. `isDrawer: true` 기본도 폐기 — 내부는 선반 기본(§3.5).

## 4. 모듈 회전 규칙 (핵심)

> **코너에서 분기되는 모듈은 도어가 prime line을 향하도록 회전 배치한다.**

### 4.1 원칙
```
┌──────────────────┐
│   Prime Line     │ ← 도어가 이쪽을 향함
│   (기준벽)       │
└──────┬───────────┘
       │ 코너
┌──────┴───────────┐
│   멍장 (Blind)   │ ← 코너 오버랩 영역
├──────────────────┤
│   Secondary 모듈  │ ← 도어 방향: prime line 쪽 (↑)
│   Secondary 모듈  │ ← 도어 방향: prime line 쪽 (↑)
│   ...            │
└──────────────────┘
```

### 4.2 상세 규칙

| 항목 | 설명 |
|------|------|
| Secondary 모듈 도어 방향 | Prime Line 방향으로 회전 |
| Tertiary 모듈 도어 방향 | Secondary Line 방향으로 회전 (= Prime과 평행) |
| 멍장 도어 | 각 Line의 교차 방향으로 개방 |
| 3D 렌더링 | `orientation` 속성으로 회전 각도 결정 |

### 4.3 3D 플래너 적용
- `orientation: 'secondary'` → 모듈을 90° 회전하여 secondary line 방향 배치
- `orientation: 'tertiary'` → 모듈을 tertiary line 방향으로 배치
- 도어 생성 면(front face)은 항상 prime line을 향함

## 5. ㄷ자형 Tertiary Line 추가 규칙

### 5.1 Tertiary 시작 방향 (`tertiaryStartFrom`)

| 값 | 의미 | 멍장 위치 |
|----|------|----------|
| `'secondary'` | Secondary Line 끝에서 분기 | Secondary 마지막 모듈을 멍장으로 변환 |
| `'prime'` | Prime Line 반대쪽 끝에서 분기 | Prime 반대쪽 끝에 멍장 추가 |

### 5.2 코너 2개 처리
```
ㄷ자형 (U) 구조:

   ┌── Tertiary Line ──┐
   │                    │ 코너2
   ├── Secondary Line ──┤
   │ 코너1              │
   └── Prime Line ──────┘
```

- **코너1**: Prime ↔ Secondary 교차 → 멍장1
- **코너2**: Secondary ↔ Tertiary 교차 → 멍장2

## 6. 기본값 요약

| 속성 | 하부장 | 상부장 |
|------|--------|--------|
| Secondary W | 1800mm | 1800mm |
| Secondary D | prime D와 동일 | 295mm |
| Tertiary W | Secondary W 또는 1800mm | Secondary W 또는 1800mm |
| Tertiary D | prime D와 동일 | Secondary D 또는 295mm |
| 코너 마감 | Molding 60mm (기본) | - |
| 멍 (blind zone) | 인접 상판깊이 −10 +몰딩 (예 700) | 320 + 몰딩 = 380 |
| 도어 최소 W | 350 | 350 |
| 코너 벽 여유 | 50 | - |
| 멍 가림 부재 | 2.7T MDF | 2.7T MDF |

## 7. 구현 파일

| 파일 | 기능 |
|------|------|
| `js/detaildesign/ui-workspace.js` | `changeLowerLayoutShape()`, `changeUpperLayoutShape()` — 구조 전환 + 멍장 삽입 |
| `js/detaildesign/ui-step1.js` | `_appendSecondaryModules()` — 3D 플래너 secondary/tertiary 모듈 생성 |
| `js/detaildesign/calc-engine.js` | 자동계산 시 secondary/tertiary orientation 보존 |
