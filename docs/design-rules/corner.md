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

## 3. 멍장 (Blind Corner Module)

### 3.1 정의
멍장(LT망장)은 코너 교차 지점에 반드시 배치되는 **고정 모듈**로, 두 Line의 오버랩 영역을 처리한다.

### 3.2 규칙

| 항목 | 값 | 비고 |
|------|-----|------|
| 이름 | `LT망장` | type: storage, isDrawer: true |
| 위치 | 코너 교차점 | prime line의 시작 또는 끝 |
| W (폭) | = 인접 Line의 **깊이(D)** | 예: secondaryD = 600 → 멍장 W = 600 |
| H (높이) | = 하부 높이 - 상판 두께 - 다리 높이 | 자동 계산 |
| D (깊이) | = prime line 깊이 | 예: primeD = 550 → 멍장 D = 550 |
| 고정 여부 | `isFixed: true` | 자동계산에서 제거/이동 불가 |
| orientation | `'secondary'` 또는 `'tertiary'` | 소속 Line 표시 |

### 3.3 멍장 배치 위치

| secondaryStartSide | 멍장 위치 (Prime Line 기준) |
|--------------------|---------------------------|
| `left` | Prime Line **맨 앞** (unshift) |
| `right` | Prime Line **맨 뒤** (splice) |

### 3.4 상부장 멍장
- 하부장과 동일한 위치에 상부장 멍장도 자동 생성
- 상부장 멍장 W = 상부장 prime depth (`upperPrimeD`, 기본 295mm)

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

## 7. 구현 파일

| 파일 | 기능 |
|------|------|
| `js/detaildesign/ui-workspace.js` | `changeLowerLayoutShape()`, `changeUpperLayoutShape()` — 구조 전환 + 멍장 삽입 |
| `js/detaildesign/ui-step1.js` | `_appendSecondaryModules()` — 3D 플래너 secondary/tertiary 모듈 생성 |
| `js/detaildesign/calc-engine.js` | 자동계산 시 secondary/tertiary orientation 보존 |
