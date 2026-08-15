# 플래너 재작성 계획 (P0–P11) — 코드 근거 재구성본

> **이 문서의 성격을 먼저 읽을 것.**
>
> 원래 계획 문서는 저장소에 존재한 적이 없다. P0(#464)·P1(#465) 을 진행하던 대화 컨텍스트에만
> 있었고 그 컨텍스트는 사라졌다. 이 문서는 **머지된 코드·테스트·PR 본문에 실제로 남아 있는
> 참조만 모아 재구성한 것**이다.
>
> - **[확인]** — 코드나 PR 본문에 근거가 있다. 파일:줄 을 병기한다.
> - **[추정]** — 근거는 있으나 단계 번호가 명시되지 않았다. 추정임을 밝힌다.
> - **[미상]** — 아무 근거도 남아 있지 않다. **지어내지 않는다.**
>
> 재구성 시점: 2026-08-15 / 기준 커밋: `b1965bf`

---

## 최종 목표 [확인]

> "플래너를 SketchUp/ArchiWood 조작 모델로 개조하기 전에 놓는 안전판."
> — PR #464 (P0) 본문

즉 이 계획 전체의 목적지는 **플래너의 조작 모델을 SketchUp/ArchiWood 방식으로 바꾸는 것**이다.
P0~P1 은 그 개조를 견딜 안전판과 토대에 해당한다.

## 대상 파일

| 파일 | 역할 |
|---|---|
| `mockup-shell.html` | 배치 단계 |
| `mockup-structure.html` | 구조 단계 |
| `js/planner/planner-scope.js` | 저장 스코프 정본 (P1 산출) |
| `js/planner/planner-sections.js` | 섹션 정의 정본 (P1 산출) |
| `js/planner/planner-view.js` | 뷰 상태 + 좌표변환 (P1 산출) |
| `test-utils/planner-harness.js` | jsdom 부팅 하네스 (P0 산출) |
| `test-utils/planner-golden.js` | 골든 픽스처 3종 (P0 산출) |
| `test-utils/js-scan.js` | 최상위 선언 추출기 (P1 산출) |

---

## 불변식

계획에는 번호가 붙은 불변식이 있었다. 코드에 인용된 것은 **1번과 4번뿐**이다.

### 불변식 1 [확인] — 골든 바이트 동일

> "payload 가 골든 3종에 대해 바이트 동일"
> — `test-utils/planner-golden.js:4`

`buildPlannerPayload()` 의 출력이 `straight` / `lShape` / `oblique` 세 픽스처에 대해
바이트 단위로 같아야 한다. **엔진 분리·모델 전환·런 도입 등 모든 리팩터 단계가 이 비교를
통과해야 한다.** 의도적으로 바꾸는 단계만 골든을 갱신하고, 그 갱신은 **별도 커밋**으로 분리해
diff 가 리뷰에 드러나게 한다.

### 불변식 2 [미상]
### 불변식 3 [미상]

### 불변식 4 [확인] — deprecated 마킹 금지

> "옮기고 남겨두면 어느 쪽이 정본인지 알 수 없게 된다."
> — `__tests__/planner-assets.test.js:148`

추출과 원본 삭제가 **같은 커밋**에 있어야 한다. 원본을 남긴 채 "deprecated" 로 표시하는 방식을
금지한다. `planner-assets.test.js` 가 옮겨간 4종(`PLANNER_SCOPE` / `scopedKey` / `view` /
`SECTION_CONFIG`)이 두 HTML 에 남아 있지 않은지 매번 검사한다.

---

## 단계

### P0 — 테스트 하네스 + 골든 픽스처 + 거짓통과 가드 ✅ [확인]

PR #464 · 머지 완료. 프로덕션 코드는 한 줄도 바꾸지 않았다(테스트 1건 경계 버그 수정 제외).

**왜 이것부터인가**: 여러 플래너 테스트가 소스를 문자열로 잘라 검사한다
(`SRC.slice(SRC.indexOf('function heightPartsOf'), ...)`). 함수를 다른 파일로 옮기면
`indexOf` 가 `-1` 을 반환하고 `slice(-1, N)` 이 빈 문자열이 되어 `not.toMatch` 계열이
**초록으로 통과**한다. 엔진을 분리하는 순간 테스트가 깨지는 게 아니라 **거짓말을 시작한다.**
9개 파일이 이 패턴을 쓴다.

산출물:
- `test-utils/planner-harness.js` — 두 mockup 페이지를 jsdom 으로 실제 부팅. Playwright 불필요
  (`getBBox`/`getScreenCTM`/`createSVGPoint` 사용 0건, three.js 는 스스로 skip,
  `setPointerCapture` 6곳만 폴리필)
- `test-utils/planner-golden.js` — 골든 3종: `straight`(직선) / `lShape`(회전 0·90 혼재) /
  `oblique`(135° 사선)
- `__tests__/test-marker-guard.test.js` — 슬라이스 마커가 어느 소스에도 없으면 실패시킨다
- `sink-prompt.test.js` 경계 버그 수정 — CRLF 체크아웃 때문에 `\n` 마커가 `-1` 을 반환,
  900자여야 할 구간이 3,204자였다

### P1 — `js/planner/` 개설: 공통 정본 추출 + 좌표변환 신설 ✅ [확인]

PR #465 · 머지 완료.

계획은 6개를 "중복" 으로 지목했으나 **실제 중복은 2개뿐**이었다. 이 괴리 자체가 기록할 가치가
있다 — 계획의 사전 판단을 코드 대조 없이 신뢰하면 안 된다는 근거다.

| 대상 | 실제 | 처리 |
|---|---|---|
| `PLANNER_SCOPE`·`scopedKey` | 글자까지 동일 | 추출 |
| `view` | 초기값 동일 | 추출 |
| `applyView` | **다름** (셀렉터·후속 호출) | 각 파일에 남기고 공통분모만 정본화 |
| `SECTION_CONFIG` | **다름** ("동일" 이라 적혀 있었으나 아니었다) | 8종 정본화 + `SECTION_PALETTE_3D` 분리 |
| `ceilingHeight` | 두 파일에서 의미가 다름 | 손대지 않음 |

좌표변환 신설(`toScene` / `zoomAtPoint` / `fitViewTo` / `clampZoom`)의 목적은 중복 제거가
아니라 **P4/P5 준비**다 — `js/planner/planner-view.js:10`.

### P2 — 엔진을 `js/planner/` 로 분리 ⬅ **다음 단계** [확인]

> "엔진을 `js/planner/` 로 분리하는 것이 이 계획의 P1~P2 다."
> — `__tests__/test-marker-guard.test.js:12`

P1 이 **상태·설정·변환**을 옮겼다면 P2 는 **엔진(계산 로직)** 을 옮긴다.
P0 의 안전판이 정확히 이 단계를 위해 깔렸다:
- 불변식 1(골든 바이트 동일)이 회귀를 막는다
- `test-marker-guard` 가 슬라이스 테스트의 거짓 통과를 막는다
- 마커를 잃은 테스트는 **하네스 기반으로 이관**한다 (마커 되살리기는 임시방편 —
  `test-marker-guard.test.js:20`)

**범위 미상**: 어떤 함수가 "엔진" 에 속하는지 계획에 열거돼 있었는지는 남아 있지 않다.
착수 시 `buildSets` / `autoCalcForSet` / `buildPlannerPayload` 를 기준으로 실제 의존성을
대조해 확정할 것.

### P3 [미상]

번호만 존재하고 내용 근거가 없다.
**[추정]** — `test-utils/planner-golden.js:4` 이 단계를 "엔진 분리 · **모델 전환** · 런 도입"
순으로 나열한다. P2 가 엔진 분리, P7 이 런 도입이므로 그 사이의 "모델 전환" 이 P3~P6 중
어딘가에 해당할 가능성이 있다. 번호 대응은 확인되지 않았다.

### P4 / P5 — 스냅 · 추론 · 도구 [확인]

> "앞으로 붙일 스냅·추론·도구(P4/P5)가 **전부** 화면 픽셀을 도면 mm 로 되돌려야 하는데,
> 변환식이 흩어져 있으면 스냅 허용오차를 '화면상 8px' 로 정의하는 순간 zoom 마다 다른 값이 된다."
> — `js/planner/planner-view.js:10`

확인되는 사실:
- 스냅 허용오차의 기준 단위는 **화면상 픽셀**이다 (도면 mm 가 아니다)
- 언급된 구체값은 **8px** 이다
- P1 의 `toScene()` / `clampZoom()` 이 이 단계의 전제조건이다

P4 와 P5 중 무엇이 스냅이고 무엇이 도구인지는 [미상].

### P6 [미상]

### P7 — 런(Run) 도입 [확인]

> "buildSets 는 회전각을 키로 쓴다 → 0° 와 135° 가 서로 다른 세트가 된다.
> 실제로는 이어진 하나의 런인데 정면도·자동계산이 쪼개진다."
> — `__tests__/planner-golden.test.js:73`

**풀어야 할 문제**: `buildSets` 가 회전각을 세트 키로 쓰기 때문에, 이어진 하나의 런이
각도별로 파편화된다. 이 결함은 P0 에서 `oblique` 골든 픽스처로 **실행 가능한 증거**로
고정해 두었다.

**목표**: 세트 그룹핑을 회전각 기반에서 **런(Run) 기반**으로 대체한다.

⚠ P7 은 골든 스냅샷을 **의도적으로 바꾸는** 단계다. 불변식 1 에 따라 골든 갱신을
**별도 커밋**으로 분리한다 (`planner-golden.test.js:68`).

### P8 [미상]

### P9 — 135° 사선 [확인]

`__tests__/planner-golden.test.js:65` 의 describe 제목이 `골든 — 135° 사선 (P9 목표)`.
P7 의 런 도입이 선행돼야 사선이 하나의 런으로 다뤄진다.
P7 과 P9 의 역할 분담(무엇이 런이고 무엇이 사선 처리인지)은 [미상].

### P10 [미상]

### P11 — wardrobe 를 배치 단계로 확장 [확인]

> "확장은 P11 에서." — `js/planner/planner-sections.js:18`

현재 상태와 막힌 지점:
1. 배치 단계는 `if (!SECTION_CONFIG[m.section]) return;` 때문에 붙박이장 모듈을 **버린다**
2. `mockup-structure.html:2425` 가 "wardrobe 카테고리는 mockup 에서 다른 section 사용
   (추후 확장)" 이라고 못박아, 배치 단계가 wardrobe 사각형을 만드는 경로 자체가 없다
   (PR #465 본문은 이 주석을 `:2442` 로 인용했으나 재구성 시점 실제 위치는 `:2425` 다.
   `mockup-structure.html:367` 의 "아래 2442 주석" 상호참조도 같이 어긋나 있다 — 별건으로 수정 필요)
3. **배치 폭(`w`) 의 정본이 어디에도 없다** — `data-constants.js` 는 깊이 600 · 높이 2310 만
   정의한다. 수치를 지어내지 않는다는 규칙 때문에 P1 에서 구조 전용으로 남겼다

⚠ `SECTION_CONFIG` 의 키는 단순 조회 대상이 아니라
`Array.from(g.classList).find(c => SECTION_CONFIG[c])` 형태로 **클래스 판별기**로도 쓰인다
(shell 4곳). 키 추가는 항상 의도적이어야 한다.

---

## 재구성으로 채우지 못한 것

| 항목 | 상태 |
|---|---|
| 불변식 2 · 3 | 내용 전무 |
| P3 · P6 · P8 · P10 | 내용 전무 |
| P2 의 "엔진" 범위 | 어떤 함수가 포함되는지 미상 |
| P4/P5 의 역할 분담 | 스냅/추론/도구 중 무엇이 어느 번호인지 미상 |
| P7 vs P9 경계 | 런 도입과 사선 처리의 분담 미상 |
| 전체 단계 수 | P11 이 마지막인지 불명 |

이 빈칸을 추측으로 메우지 않는다. 다음 단계를 설계할 때 **현재 코드를 근거로 새로 정의**하고,
그때 이 문서를 갱신한다.

## 현재 기준선 (2026-08-15)

- 테스트 **310/313 통과**. 실패 3건은 전부 `__tests__/i18n.test.js` 의
  `localStorage.getItem.mockReturnValue is not a function` — `jest.setup.js` 의 전역 목이
  `jest.fn()` 이라 저장이 안 되는 기존 문제. 플래너와 무관하다.
- 골든 스냅샷 3종 통과.
- `js/planner/` 모듈 3개 (`planner-scope` / `planner-sections` / `planner-view`).
