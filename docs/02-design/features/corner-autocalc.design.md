# corner-autocalc Design Document

> **Summary**: ㄱ자 멍장(코너장) 상세 자동계산 — deriveCorner 단일 파생 함수 + 도어 균등 분배 + 라인 단위 계산 + BOM 연동
>
> **Project**: 다담AI (dadam-cabinet)
> **Author**: hong + Claude
> **Date**: 2026-07-17
> **Status**: Draft
> **Planning Doc**: [corner-autocalc.plan.md](../../01-plan/features/corner-autocalc.plan.md)
> **규칙 원본**: [corner.md §3](../../design-rules/corner.md) (2026-07-17 확정, PR #423)

---

## 1. Overview

### 1.1 Design Goals

1. 멍장 치수를 **단일 순수 함수 `deriveCorner()`** 에서만 파생 — 공식 불일치의 구조적 차단
2. secondary 라인 전체(멍장 + 수납 모듈)를 `item.modules`에 영속화 — 자동계산·3D·BOM이 같은 데이터 사용
3. **도어 균등 분배 원칙**으로 멍장 도어 W 산출 (라인 원장 방식)
4. prime 경로 코드 무변경 — 라인 단위 계산으로 회귀 위험 최소화

### 1.2 Design Principles

- **Derive, don't store**: 파생값(`isDerived: true`)은 specs 변경 시 항상 재계산, 직접 수정 금지
- **임의 규칙 생성 금지**: 모든 상수는 `data-constants.js`에 정의하고 corner.md 근거 주석 명기
- **라인 = 계산 단위**: 분배·갭 흡수는 라인 내부에서만, 라인 간 이동 금지

---

## 2. Architecture

### 2.1 Data Flow

```
specs (사용자 입력: 라인 W/D, blindLine 선택, 몰딩/EP)
   │
   ▼
deriveCorner(specs)                    ← corner-engine.js (신규, 순수 함수)
   │  { blind{w,doorW,blindZoneW,h,d}, budgets{...}, doorW }
   ▼
item.modules (SSOT — 멍장 + 양 라인 수납 모듈 영속화)
   │
   ├──▶ calc-engine.js   runAutoCalc* : 라인별 분배/갭흡수
   ├──▶ ui-step1.js      3D payload   : modules에서 파생 (즉석 생성 제거)
   └──▶ extractors.js    BOM          : 라인 순회 + blind 전용 부재
```

### 2.2 신규/수정 파일

| 파일 | 변경 | 도메인 | 단계 |
|------|------|--------|------|
| `js/detaildesign/corner-engine.js` | **신규** — deriveCorner, 원장 검증. 브라우저 전역 + CommonJS 이중 export (Jest 테스트용) | designui | W10-1 |
| `js/detaildesign/data-constants.js` | 코너 상수 추가 (§3.3) | bom | W10-1 |
| `js/detaildesign/ui-workspace.js` | `changeLowerLayoutShape()`(:1541) 멍장+secondary 시드 생성, `changeUpperLayoutShape()`(:1623) 상부 멍장 추가, blindLine 선택 UI | designui | W10-1, W10-2 |
| `js/detaildesign/ui-step1.js` | `_appendSecondaryModules()`(:414~602) → `item.modules` 파생 렌더링으로 교체 | designui | W10-1 |
| `js/detaildesign/calc-engine.js` | 라인 단위 계산 (:655/726/737/1018/1202 필터 교체), `hasSecondaryLT` 가드(:919) id 기반 단순화 | bom | W10-3 |
| `js/detaildesign/extractors.js` | 라인 순회 + blind 부재 전략 (:121~290 extractSink) | bom | W10-4 |
| `js/detaildesign/persistence-init.js` | 로드 시 마이그레이션 보정 | designui | W10-1 |
| `__tests__/corner-engine.test.js` | **신규** — deriveCorner 단위 테스트 (root Jest) | bom | W10-3 |

---

## 3. Data Model

### 3.1 specs 확장

```js
// item.specs 추가 필드
{
  blindLine: 'secondary',      // 'prime' | 'secondary' — 멍장 소속 라인 (사용자 결정, 기본 secondary)
  // 기존: lowerSecondaryW/D, upperPrimeD, finishCorner1Width(몰딩 60), finishLeft/Right ...
}
```

### 3.2 멍장 모듈 (deriveCorner가 생성/갱신)

```js
{
  id: 'corner-blind-lower',        // 결정적 id — 재전환 시 중복 방지, 가드 단순화
  name: 'LT망장', type: 'storage', pos: 'lower',
  line: 'secondary',               // ★신규 — 계산 소속 (blindLine 값)
  orientation: 'secondary',        // 기존 — 3D 회전 표현 (유지)
  w: 1100,                         // = blindZoneW(700) + doorW(400) — 파생
  h: 730, d: 550,
  isFixed: true,                   // 분배 제외 (치수는 deriveCorner가 재계산)
  isDerived: true,                 // ★신규 — specs 변경 시 재계산 대상
  blindZoneW: 700,                 // 멍 폭 — BOM MDF 가림판 치수
  doorW: 400, doorCount: 1,        // 도어 부재 치수 (카카스 W 아님!)
}
```

- 일반 모듈: `line` 필드 부재 시 `'prime'`으로 간주 (하위 호환)
- 상부 멍장: `id: 'corner-blind-upper'`, `blindZoneW: 380` (= 320 + 몰딩 60)

### 3.3 상수 (data-constants.js 추가 — corner.md §3 근거)

```js
const CORNER_DRIP = 10;          // 물끊기 (corner.md §3.3)
const CORNER_WALL_GAP = 50;      // 멍장 측판-벽 여유 (corner.md §3.4)
const CORNER_MIN_DOOR_W = 350;   // 도어 최소 폭 (corner.md §3.4)
const CORNER_UPPER_MODULE = 320; // 상부 멍 모듈값: 몸통295+도어18→관례320 (corner.md §3.6)
const CORNER_BLIND_COVER_T = 2.7;// 멍 가림 MDF 두께 (corner.md §3.5)
// 몰딩: 기존 finishCorner1Width(60) 재사용. EP: 기존 finish 체계의 EP(20) 재사용 — W10-1에서 정의 위치 확인
```

---

## 4. Core Algorithm — deriveCorner()

### 4.1 명세

```js
/**
 * @param specs  item.specs (blindLine, 라인 W/D, 몰딩, EP, 높이)
 * @returns { blind, upperBlind, budgets, doorW }  — 모든 값 mm 정수
 */
function deriveCorner(specs) {
  const molding = num(specs.finishCorner1Width, 60);
  const blindLine = specs.blindLine || 'secondary';
  const adj = blindLine === 'secondary' ? 'prime' : 'secondary';

  // ① 멍 — 하부: 인접 상판깊이 − 물끊기 + 몰딩 / 상부: 320 + 몰딩
  const blindZoneW = topD(adj) - CORNER_DRIP + molding;          // 650−10+60 = 700
  const upperBlindZoneW = CORNER_UPPER_MODULE + molding;         // 320+60 = 380

  // ② 도어 균등 분배 — 멍장 라인 원장
  const doorAvail = lineW(blindLine) - EP_W - CORNER_WALL_GAP - blindZoneW;  // 1970−20−50−700 = 1200
  const nDoors = Math.max(1, Math.floor(doorAvail / CORNER_MIN_DOOR_W));    // 최소 350 만족 최대 수 = 3
  const doorW = Math.floor(doorAvail / nDoors);                             // 400

  // ③ 예산
  const budgets = {
    [blindLine]: doorAvail - doorW,               // 멍장 도어 1개 제외한 나머지 도어 폭 = 800
    [adj]: lineW(adj) - (topD(blindLine) - CORNER_DRIP + molding),  // 인접 시작 offset 차감
  };

  return { blind: {...}, upperBlind: {...}, budgets, doorW };
}
```

### 4.2 멍장 라인 분배 (calc-engine, W10-3)

멍장 라인은 **도어 우선(door-first)** 분배: 모듈 W = (모듈 도어 수) × doorW.

```
1. deriveCorner → doorW (라인 공통 도어 폭)
2. 멍장 제외 수납 모듈들의 도어 수 합 = nDoors − 1
3. 각 모듈 W = 도어수 × doorW  (예: 2도어장 = 800)
4. 반올림 잔여는 마지막 모듈이 흡수 (W9 관례)
```

인접 라인은 **기존 분배 로직 무변경** — 예산만 `budgets[adj]`로 교체.

### 4.3 원장 불변식 (자동계산 후 assert)

```
멍장 라인:  EP + Σ(수납 모듈 W) + 멍장 W + CORNER_WALL_GAP === lineW  (±1)
인접 라인:  시작offset + Σ(모듈 W) === lineW  (±1)
```

위반 시 콘솔 경고 + 마지막 모듈 보정 (프로덕션), 개발 모드 throw.

### 4.4 엣지 케이스

| 케이스 | 조건 | 처리 |
|--------|------|------|
| 도어 1개도 불가 | doorAvail < 350 | nDoors=1, doorW=doorAvail, `console.warn` + UI 경고 배지 |
| 라인이 멍보다 짧음 | lineW − EP − 50 < blindZoneW | ㄱ자 전환 거부 + 안내 (최소 라인 W 제시) |
| 몰딩 사용자 변경 | finishCorner1Width ≠ 60 | deriveCorner 재실행 — 멍/도어 연동 재계산 |
| 상부 secondary 없음 | secondaryUpperEnabled=false | upperBlind 생성 생략 |

---

## 5. UI 변경 (W10-1, W10-2 — designui)

| 항목 | 위치 | 내용 |
|------|------|------|
| blindLine 선택 | ui-workspace 구조 전환 패널 | "멍장 위치: prime / secondary" 토글 (기본 secondary). 변경 시 deriveCorner 재실행 + 재분배 |
| 멍장 팔레트 표기 | 모듈 상세 패널 | W 표시를 `1100 (멍 700 + 도어 400)` 분해 표기, 치수 직접 수정 비활성 (isDerived) |
| 도어 최소폭 경고 | 자동계산 결과 | doorW < 350 근접 시 경고 배지 |
| 3D/정면도 | ui-step1 | payload를 item.modules에서 파생. `sec-auto-*` id 체계는 W9 정면도 호환 위해 유지 |

## 6. BOM 부재 산출 (W10-4 — extractors.js)

멍장 1100×730×550 (하부, 예시) 기준 — 표준 카카스 산식 재사용 + blind 전용 3항목:

| 부재 | 치수 근거 | 비고 |
|------|----------|------|
| 측판/천판/지판/뒷판/선반(기본 1) | 기존 extractSink 표준 산식 (W=1100 기준) | 재사용 — 신규 산식 없음 |
| **도어 1짝** | `doorW × 도어H` = 400 기준 | ★ 카카스 W(1100) 아님 — 기존 로직이라면 오발주 |
| **멍 가림판** | `2.7T MDF, blindZoneW(700) × 몸통H` | ★ 신규 부재 항목 |
| **몰딩** | finishCorner 60 | 기존 finish 체계 |
| EP | 20 | 기존 finish 체계 |
| 하드웨어 | 옵션 (회전 선반 등) | 1차 범위 외 — 필드만 예약 |

secondary 수납 모듈: 기존 표준 산식으로 전량 산출 (현재 누락분 해소).

## 7. 마이그레이션 (persistence-init.js — 멱등)

1. layout L(또는 U) && `line:'secondary'` 수납 모듈 0개 → deriveCorner + 시드 분배로 생성
2. 구식 멍장(`w === secondaryD` 또는 `primeD+40`, isDerived 없음) → `isDerived`/`blindZoneW`/`doorW` 부여 후 재계산
3. `line` 없는 모듈 → orientation으로 역추론 (orientation 없음 = prime)

같은 설계 2회 로드 = 동일 결과 (결정적 id로 보장).

## 8. Test Plan

| 종류 | 대상 | 도구 | 케이스 |
|------|------|------|--------|
| Unit | corner-engine.js | root Jest (`__tests__/corner-engine.test.js`) | 확정 예시(1970→1100/400), 몰딩 변경 연동, doorAvail<350, 라인 부족 거부, blindLine=prime 대칭, 상부 380 |
| 회귀 | ㅡ자 자동계산 | 스냅샷 비교 | 전/후 diff = 0 (prime 경로 무변경 증명) |
| E2E | ㄱ자 전체 흐름 | `tmp/e2e/` 스크립트 (W9 패턴) | 설정→자동계산→정면도→BOM 수량이 §4.1 검산과 일치 |
| 호환 | 기존 저장 설계 | 로드→보정→재저장→재로드 | 멱등성 + 콘솔 에러 0 |

## 9. Implementation Order

1. [ ] **W10-1** (designui, `agent/designui-w10-1-corner-persist`): corner-engine.js + 상수 + ui-workspace 시드 생성 + ui-step1 파생 전환 + 마이그레이션
2. [ ] **W10-2** (designui, `agent/designui-w10-2-upper-blind`): 상부 멍장 + blindLine 토글 UI
3. [ ] **W10-3** (bom, `agent/bom-w10-3-secondary-autocalc`): calc-engine 라인 단위 계산 + 불변식 + Jest 테스트
4. [ ] **W10-4** (bom, `agent/bom-w10-4-corner-bom`): extractors blind 부재 + secondary 산출
5. [ ] **W10-5**: E2E 검증 + `/pdca analyze corner-autocalc`

각 단계 독립 PR, 같은 도메인 순차 실행 (CLAUDE.md).

### 구현 중 확인 항목 (규칙 아님 — 코드 대조)
- [ ] EP(20)의 기존 정의 위치 (finish 체계 vs 신규 상수)
- [ ] 도어 수 규칙 해석 검증: "최소 350 만족 최대 수" — calc-engine 기존 도어 분배와 대조, 어긋나면 사용자 재확인
- [ ] 상부장 도어 최소폭도 350 적용 여부

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-17 | 확정 규칙(corner.md §3) 기반 초안 | hong + Claude |
