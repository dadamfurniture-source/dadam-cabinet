# 플래너 → 상세설계 브리지 경고 배너 (pbw)

> 2026-09-16, 브랜치 `agent/designui-bridge-warnings`. Design UI 도메인 (`js/detaildesign/ui-step1.js` 만 수정).
> 앞선 작업: 플래너→BOM 변환 경고(W12-58 · W12-64 · CD-3), 툴바 BOM 산출(W11-14).

## 무엇이 바뀌었나

플래너(mockup-shell) 결과를 상세설계 모듈로 바꾸는 `_convertPlannerModules` 는 BOM 이 실제와 달라질 수 있는 상황을
`warnings` 로 돌려준다. 지금까지는 `console.warn('[Planner→BOM] 경고:', …)` 과 몇 초 뒤 사라지는 토스트뿐이라
사용자가 사실상 못 봤다. 이제는 **화면에 남는 배너** `#plannerBridgeWarnings` 로 보여 주고, 건수를
툴바 **📋 BOM 산출** 버튼과 스테퍼 **3번 점**에 배지로 미러한다. `console.warn` 은 그대로 남긴다.

- 컨테이너·스타일(`<style id="pbw-style">`, 전부 `.pbw-` 접두)은 JS 가 만든다 — `detaildesign.html` 은 손대지 않았다.
- 자리
  - **Step 2** (planner/native 모드): `#step2Toolbar` 의 형제로 두고 툴바(44px) 바로 아래 `position:fixed`, `z-index:101`
    (플래너 overlay 100 위).
  - **Step 3** (BOM): `#step3-content` 안, 보고서 `#step3-report-area` 바로 위. PLANNER_DONE · 툴바 BOM 산출은 반영 직후
    곧바로 Step 3 로 가므로 Step 2 에만 두면 결국 못 본다. 여기서는 **← 설계(플래너)로 돌아가기** 버튼(`backToStep2`)도 보인다.
  - `goToStep2` · `goToStep3` · `backToStep2` 가 `_pbwSyncPlacement()` 로 자리를 다시 맞춘다.
- 제목 `플래너 → 상세설계 확인 사항 (N)`, 경고마다 한 줄(아이콘 + 심각도 라벨 + 문구), 아래에 **다시 확인** 힌트, 오른쪽 위 ✕.

## 경고 종류와 조치

| 문구 | 심각도 | 왜 뜨나 | 사용자가 할 일 |
|---|---|---|---|
| `lower-0: 자동계산 전이라 1200mm 통짜로 잡혔습니다` | ⚠️ 경고 | 하부장·상부장 사각형에 구조(셀 분배)가 없어 폭 전체가 모듈 1개로 잡혔다. 도어·서랍·선반이 실제와 다르게 나간다. (키큰장은 세로 스택이라 뜨지 않는다) | 구조 단계에서 **⚡ 전체 자동계산** 을 돌린 뒤 다시 넘긴다 |
| `…: 멍 구간을 멍장으로 인식하지 못했습니다 — 자동계산을 다시 실행하세요` | ⚠️ 경고 | 멍(blind)·멍판 마감재(blindfin) 칸이 멍장 모듈 없이 남았다. 가려진 구간이 도어 달린 장으로 발주될 뻔해 캐비닛으로 만들지 않고 알린다 | 구조에서 **⚡ 전체 자동계산** 을 다시 돌린다 (코너·마감을 고쳤다면 특히) |
| `…: 멍장 폭 Wmm 이 멍 A + 도어 B = Cmm 과 다릅니다 — …` | ⚠️ 경고 | 멍장 카카스 폭이 부품(멍 + 도어) 합과 어긋난다 — 상자에 안 들어가는 자재가 나간다 | 같음 |
| `…: 셀 폭 합 Smm 이 모듈 폭 Wmm 과 다릅니다 — …` | ⚠️ 경고 | 🎨 배치를 고친 뒤 구조를 다시 계산하지 않아 분배 정보가 낡았다 | 같음 |
| `350mm 미만 잔여 N칸은 캐비닛에서 제외했습니다 (휠라/마감 처리)` | ℹ️ 안내 | `BLANK_THRESHOLD` 미만 잔여 조각은 캐비닛으로 만들지 않는다 (정상 동작) | 그대로 산출해도 된다. 잔여 구간의 휠라/마감이 사양(스펙)에 잡혀 있는지 확인 |
| `도면에 마감재 N개가 있지만 좌·우 마감이 '없음' …` | ℹ️ 안내 | EP·몰딩·휠라는 모듈이 아니라 `specs.finishLeft/RightType` 에서 나온다 — 그려만 두면 발주되지 않는다 | 사양에서 몰딩/휠라/EP 를 지정 |

심각도 규칙 (`_pbwSeverity`): 문구에 `자동계산 전` · `멍 구간` · `멍장 폭` · `셀 폭 합` 이 있거나 `자동계산` 이 들어 있으면 **경고**, 그 밖은 **안내**.
경고가 하나라도 있으면 힌트는 `구조 단계에서 ⚡ 전체 자동계산 후 다시 넘기기 — 🎨 배치를 고쳤다면 구조에서 ⚡ 를 다시 돌려야 셀이 맞습니다`,
안내만 있으면 `안내만 있습니다 — 그대로 산출해도 됩니다. 잔여 구간·마감재는 사양(스펙)에서 확인하세요`.

## 닫기 동작

- ✕ 를 누르면 배너와 배지가 사라진다.
- 기억 단위는 **설계 + 품목** (`_plannerScopeParams(item)` → `design:item`).
  `sessionStorage['pbw:dismissed:<design>:<item>']` 에 경고 묶음의 **서명**(정렬 후 join)을 넣는다.
- 같은 묶음이 다시 들어오면(재산출 등) 닫힌 채다. **경고 내용이 바뀌면 서명이 달라져 다시 뜬다.**
- 탭을 닫으면 잊는다 (sessionStorage). 저장소가 막혀 있으면 이번 화면에서만 닫힌다.
- 경고가 0건이 되면 배너·배지를 지운다. 품목을 바꾸면(`switchStep2Item`) 그 품목의 묶음으로 다시 그린다.

## 코드 위치

- `js/detaildesign/ui-step1.js` — `_showPlannerSummary` 다음, `const PBW_ID` ~ `_pbwSyncPlacement` 블록.
  진입점 `_showBridgeWarnings(warnings, scope)` 는 `_applyPlannerResult` 가 `console.warn` 직후에 부른다.
- 시험 `__tests__/designui-bridge-warnings.test.js` — 실제 변환기(`_convertPlannerModules`)가 낸 경고로 배너를 그린다.
  자동계산 전 payload → N줄, 심각도 클래스, 닫기 + sessionStorage, 묶음 변경 시 재표시, 0건 → 배너 없음, 배지, 단계별 자리.
