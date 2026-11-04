# 작업자 필수 확인 목록

> 2026-11-04 사장님 「각 작업자에 작업지시서로 분배되어야 하고, 작업자들에게 필수 확인사항도 포함」 (승인 계획 2 · 3-3).
> 코드 정본: `workers/workflow-api/src/work/check-items.js` — 아래 표와 같아야 한다 (`workers/workflow-api/test/check-items.test.js` 가 대조한다).

## 쓰는 곳

- 종이 작업지시서: 재단 꾸러미 원장마다 체크 칸(`templates/work-order.js cutSheetBlock`), ⑥ 조립 순서 체크(`assemblySheet`), 시공 지시서 서명 칸(`templates/installation-order.js`).
- 작업자 포털 체크: 작업자가 자기 역할 꾸러미를 열고 항목을 체크하면 DB `work_checks`(0035)에 한 줄씩 쌓인다.
- 발행 때 그 판을 문서(`design_documents.render_payload.check_list`)에 고정한다. 판이 올라가도 이미 낸 문서는 낸 때 목록 그대로. 목록이 없는 옛 문서는 v0.

## 낱말

- 범위: `sheet` 원장마다 (재단 배치의 원장 번호) · `module` 모듈마다 (품목 · 모듈 차례) · `order` 주문에 한 번.
- 조건: `door` 도어 있는 모듈만 · `drawer` 서랍 있는 모듈만 (종이의 「—」 칸).
- 필수: 예 = 필수 · 아니오 = 권장. 사진: `none` 없음 · `opt` 선택 · `need` 필수.
- 항목 키: 소문자 · 숫자 · `-` (DB `work_checks.item_key` 모양).

## v0 — 지금 종이에 인쇄되는 체크 그대로

| 판 | 역할 | 키 | 항목 | 범위 | 조건 | 필수 | 사진 |
|---|---|---|---|---|---|---|---|
| v0 | cut | cut-sheet-cut | 재단 | sheet | | 예 | none |
| v0 | cut | cut-sheet-edgemark | 엣지 표시 | sheet | | 예 | none |
| v0 | assembly | asm-module-cut | 재단 | module | | 예 | none |
| v0 | assembly | asm-module-edge | 엣지 | module | | 예 | none |
| v0 | assembly | asm-module-build | 조립 | module | | 예 | none |
| v0 | assembly | asm-module-door | 도어 달기 | module | door | 예 | none |
| v0 | assembly | asm-module-drawer | 서랍 | module | drawer | 예 | none |
| v0 | assembly | asm-module-pack | 검수·포장 | module | | 예 | none |
| v0 | install | inst-order-sign | 설치 담당 | order | | 예 | none |
| v0 | install | inst-order-inspect | 검수 | order | | 예 | none |
| v0 | install | inst-order-customer | 고객 확인 | order | | 예 | none |

엣지(edge) 역할은 v0 에 따로 칸이 없다 — 재단 기사가 원장마다 「엣지 표시」를 한다.

## v1 — 사장님 확정 대기

추천안: https://claude.ai/artifact/7iRm4orYo2dQS496We24oW (역할별 항목 · 필수 · 사진, 정할 것 셋 — 필수가 남으면 완료 기록을 막을지 · 엣지 기사 칸을 따로 둘지 · 사진을 어떻게 받을지).
확정하면 이 표에 v1 을 더하고 `CHECK_LIST_VERSION` 을 올린다. 확정 전에는 지어내지 않는다.
