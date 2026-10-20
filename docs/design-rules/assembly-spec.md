# 조립 명세 `dadam.assembly/1`

- 코드: `js/detaildesign/bom-assembly.js` (`DadamAssembly.of(design, opts)`), 숫자: `js/detaildesign/assembly-rules.js`
- 계획: `docs/01-plan/planner-cad.plan.md` §4-2 (스키마), §6 PR6
- 시험: `__tests__/bom-assembly.test.js`

BOM 행마다 판재 조각의 **자리**를 붙인다. 재단 치수는 BOM 행 그대로이고, 명세는 크기를 새로 셈하지 않는다.
플래너 3D·GLB·겹침 검사·도면이 모두 이 명세를 읽게 된다.

## 좌표

모듈 로컬, mm. x 오른쪽 · y 위 · z 앞(+z 정면). 원점은 몸통 바닥 가운데. 다리발·좌대는 넣지 않는다.
모듈을 세우는 자리(`place`)는 부르는 쪽이 넘긴다.

## 판재

| 필드 | 뜻 |
|---|---|
| `id` | `${rowPartId}#${k}` — k 는 0부터, 왼→오 · 아래→위 |
| `rowPartId` | BOM 행 partId |
| `cut` | `{w, h}` = BOM 행 |
| `t` | 두께 |
| `frame` | `{o, u, v, n}` — 꼭짓점 o 에서 u 로 cut.w, v 로 cut.h, n 으로 t. 축은 `'+x'` 같은 부호 있는 축 |
| `box` | frame 이 덮는 상자 |
| `features` | `notch`(관통 따내기), `groove`(홈, 깊이 미정) |

## 지금 자리를 정하는 부재 (PR6)

싱크 라인과 같은 몸통(상부장 · 하부장 · 키큰장 단, 간단 카테고리 포함)의 측판 · 지판 · 천판 · 뒷판 · 선반 · 처짐방지목.

| 부재 | 자리 | 근거 |
|---|---|---|
| 측판 | 모듈 양 끝. 사쿠리면 뒤끝 15~18 홈, 목찬넬이면 앞 위 70×40 따내기 | 확정 사실, `bom-drawer-rules.js` |
| 지판·천판 | 측판 사이. 사쿠리면 홈 앞까지 D−18 (앞선 맞춤), 아니면 D 전체 | 확정 사실 |
| 뒷판 | 사쿠리면 홈 속, 아니면 측판 뒤끝 밖에 덮음. 높이 H−1 은 가운데 | PR #832 |
| 처짐방지목 | 폭 가운데, 측판 앞선 맞춤(도어 바로 뒤), 지판 위부터 | 확정 사실 |
| 상부장 보강목 | 사쿠리 홈 뒤 장의 맨 뒤(판이 서서 뒤를 봄). 아래 1장 지판 바로 위, 위 1장 천판 바로 아래. 폭 60 | 사장님 2026-10-20 |
| 선반 | 처짐방지목 뒤 — 뒤로 붙임 (깊이가 "D − T, 처짐방지목 몫"). 높이는 부르는 쪽이 넘긴 값(`opts.shelfY`, 플래너 `s.shelves`) | 확정 사실 |

## `unplaced` 이유

| 이유 | 뜻 |
|---|---|
| `band-position-pending` | 하부장 밴드 2장의 자리 — 사장님 확인 대기 |
| `upper-band-18t-pending` | 18T 상부장 보강목 — 판(18)이 홈 뒤 자리(15)보다 두꺼움, 사장님 확인 대기 |
| `pending-owner D2` | 서랍장 처짐방지목 자리 (결정 D2) |
| `shelf-height-unknown` | 선반 높이를 넘기지 않음 — 지어내지 않는다 |
| `blind-pending` | 멍장 (목대·멍가림판) — 다음 단계 |
| `module-not-yet` | 붙박이장·냉장고장 — 다음 단계 |
| `not-yet` | 도어·서랍·목찬넬 부재 등 — PR9 |
| `run-part` | 품목 단위 행 (걸레받이·몰딩·상판·휠라) — PR9 `runs[]` |

모듈 `pending` 에는 자리는 정했지만 특징이 빠진 것(예: 서랍장 중간 따내기 `channel-mid-notch`)을 적는다.

## 알려진 겹침

- **18T 상부장 선반 ↔ 처짐방지목 2mm.** 상부 선반 깊이가 상수 D−34 라, 18T 에서는 홈 앞 18 + 선반 + 처짐방지목 18 = D + 2.
  15T 에서는 1mm 가 남는다. 결정 D10(18T 실사용)·D12(선반 감산이 상수인가 T 인가)와 함께 사장님 확인 대기.

## CAD GLB (관리자 전용)

- 코드: `js/planner/planner-export.js` (`plannerExportCadSpec` · `plannerExportCadScene`), 버튼: `mockup-structure.html` 🧊 CAD GLB
- 시험: `__tests__/planner-export-cad.test.js`

플래너 구조 페이지가 부모 창(상세설계)의 변환(`_convertPlannerModules`)과 `MaterialExtractor` 로 BOM 을 내고, 이 명세를 만들어 판재를 그대로 GLB 로 쓴다.
3D 장면은 베끼지 않는다. 모듈을 세우는 자리만 3D 모듈 그룹에서 가져온다 (그룹 자리 · 칸 오프셋 · 다리발/좌대 높이).

- 노드: 루트 `dadam-planner-cad`(배율 0.001, mm → m) ▸ `module·<moduleKey>` ▸ 판재 `<partId>#k`. 따낸 판은 상자 여럿.
- 판재 extras: `rowPartId · part · material · t · cutW · cutH · moduleKey · vis`. 루트 extras: `schema · rulesVersion · unplaced`(자리 미정 행 수).
- `unplaced` 행(도어·서랍·밴드 자리 등)은 GLB 에 없다.
- 선반 높이는 플래너 구조의 `s.shelves`. BOM 선반 장수와 다르면 선반은 놓지 않는다.
