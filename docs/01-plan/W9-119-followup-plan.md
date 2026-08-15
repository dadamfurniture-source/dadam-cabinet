# W9-119 follow-up — ruler 버튼 UX 보강

## Context

W9-118 (PR #417) 머지로 정면도 ruler bar 외경 치수 버튼이 도입됨. 머지 전 `bkit:code-analyzer` 리뷰에서 발견된 HIGH/MEDIUM/LOW 6건은 두 번째 커밋(`481e4ab`)에서 해소됨. 다만 머지 시점에서 아래 2 가지는 명시적 별도 PR 로 미뤄둠:

1. **Mobile/touch 입력 대응** — 현재 desktop click 만 가정. touch 환경에서 hover/tap 분기 필요
2. **Y 그룹 시각 동기화** — 동일 H 그룹은 우측 ruler 에 모듈 Y 마다 N 개 버튼이 표시되는데, 시각적으로 묶여 보이지 않음. hover 시 같은 그룹 강조 + 클릭 시 popup 1 회 동기 호출이 필요

## 기대 결과

- 모바일/태블릿 사용자가 ruler 버튼을 정확히 탭 + 치수 입력 가능
- 동일 H 그룹의 버튼 N 개가 시각적으로 한 그룹임을 즉시 인지 (hover 강조 + 버튼에 group-id badge)

---

## 작업 1 — Mobile/touch 대응

### 핵심 문제점
- `.ruler-btn` width/height 24px — touch target 권장(44×44px) 미달
- popup editor 가 anchor 기준 absolute 배치 — 모바일 viewport 작을 때 입력 폼이 가상 키보드 뒤로 숨음
- `input type=number` 기본 키패드 — iOS Safari 에서 소수점 입력 키 부재 (현재 step=1 이라 영향 없음)

### 변경
- **파일**: `mockup-structure.html`
  - CSS `@media (pointer: coarse)` 분기 — `.ruler-btn` 크기 32px, hit area 패딩 +12px (`::after` 가상 요소)
  - JS `openDimEditor` — `window.matchMedia('(max-width: 640px)')` 일 때 popup 을 화면 중앙 modal 로 전환 (배경 dim + 닫기 버튼)
  - `pointerdown` + `pointerup` 이벤트 통합 (mouse + touch 양립)

### 검증
- iPhone Safari (실기/시뮬레이터) — ruler 버튼 탭 → modal 표시 → input focus → 키패드 노출 → 적용 → 모듈 갱신
- iPad Pencil — 동일

---

## 작업 2 — Y 그룹 시각 동기화

### 핵심 문제점
현재 `renderRulerButtons` 의 H 그룹 처리:
```js
for (const g of hGroups) {
  for (const item of g.modules) {
    // 각 모듈 Y 위치마다 별도 버튼 생성
  }
}
```
- 동일 H=820mm 모듈 3 개 → 우측 ruler 에 3 개 버튼이 따로 표시. 사용자는 "왜 같은 숫자 3번 나오지?" 혼란
- 한 버튼 hover 해도 같은 그룹 다른 버튼은 무변화

### 변경
- **파일**: `mockup-structure.html`
  - `renderRulerButtons` 의 H 버튼 생성 시 `dataset.groupId = g.H` 부여
  - CSS:
    ```css
    .ruler-right .ruler-btn { transition: outline .12s ease; }
    .ruler-right .ruler-btn.peer-hover { outline: 2px solid #b8956c; outline-offset: -1px; }
    ```
  - JS: `mouseenter` / `mouseleave` 핸들러 추가
    ```js
    btn.onmouseenter = () => {
      rulerRight.querySelectorAll(`.ruler-btn[data-group-id="${g.H}"]`).forEach(b => b.classList.add('peer-hover'));
    };
    btn.onmouseleave = () => {
      rulerRight.querySelectorAll('.ruler-btn.peer-hover').forEach(b => b.classList.remove('peer-hover'));
    };
    ```
  - (선택) H 그룹 모듈 수 ≥ 2 시 버튼 라벨에 카운트 배지 (예: `820 ×3`)

### 검증
- 정면도 세트 모드 진입 → 같은 H 모듈 2개 이상인 세트에서 한 버튼 hover → 같은 H 다른 버튼들 outline 강조
- 클릭은 기존대로 `openDimEditor` 1회 호출 (변경 없음)

---

## 작업 3 — 추가 발견 항목 (시간 여유 시)

### Low-priority
- **버튼 라벨 단위 표기** — 현재 숫자만 (`820`). 작은 버튼이지만 hover tooltip 의 `title` 속성에 이미 mm 명시 — UX 검증 후 결정
- **H 변경 시 baseY 영향 시각화** — `m.H` 가 변경되면 `getBaseY` 의존 좌표가 `upper`(천장 매달림)에서 재계산됨. `applyDimChange` 후 `renderFrontView` 호출에서 자동 반영되지만, 사용자에게 baseY 변경 사실을 알리는 sub-toast 추가 검토
- **redistribute 시각화** — 자동계산 후 어떤 모듈이 재분배되었는지 잠시 강조 (1.5s outline pulse)

---

## 핵심 파일

### 수정
- `mockup-structure.html`
  - CSS `.ruler-btn` / `.ruler-btn-editor` 모바일 분기 추가
  - `renderRulerButtons` H 버튼에 dataset + hover 핸들러
  - `openDimEditor` 모바일 modal 전환

### 재사용
- 기존 W9-118 의 모든 함수 (`buildRulerGroups`, `applyDimChange`, `absorbAdjacentW`, `redistributeNonFixedWidths`) 변경 없음

---

## 영향 / 위험

| 항목 | 위험 | 완화 |
|---|---|---|
| `@media (pointer: coarse)` 분기 | 일부 hybrid 노트북(터치 + 마우스)에서 큰 버튼이 desktop 에서도 적용 | `(pointer: coarse) and (max-width: 1024px)` 로 조건 강화 |
| `dataset.groupId` 충돌 | H 값이 dataset 키로 그대로 들어감 (숫자 string) — selector escaping 필요 없음 | 정수 값 보장 (`Math.round`) |
| AbortController + pointerdown | 일부 Safari 14 미만에서 AbortSignal pointer event 지원 미흡 | 폴리필 없이 진행, `try/catch` 로 graceful degrade |

---

## 검증 (Verification)

### 수동 E2E
- desktop chrome: 기존 W9-118 회귀 0 확인
- desktop chrome (DevTools mobile emulation iPhone 14): tap → modal → 적용
- 실기 iPhone Safari + iPad: tap → modal → 적용 + 키패드 표시
- desktop chrome: 동일 H 그룹 2개 이상 세트에서 hover 시 peer 강조

### 회귀
- W9-118 의 7개 미체크 항목이 W9-119 진행 전에 우선 manual E2E 권장
- 머지 후 `/pdca iterate` 호출 시점에 함께 검증

---

## 별도 작업 (이 PR 범위 밖)
- ruler 버튼 우클릭 → 컨텍스트 메뉴 (모듈 분할 / 제거 / 복사)
- 자동계산 마스터 규칙(W9-90) 의 redistribute 와 통합 (현재 W9-118 redistributeNonFixedWidths 는 단독 구현)
