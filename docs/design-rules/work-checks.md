# 작업자 필수 확인 목록

> 2026-11-04 사장님 「각 작업자에 작업지시서로 분배되어야 하고, 작업자들에게 필수 확인사항도 포함」 (승인 계획 2 · 3-3).
> 코드 정본: `workers/workflow-api/src/work/check-items.js` — 아래 표와 같아야 한다 (`workers/workflow-api/test/check-items.test.js` 가 대조한다).

## 쓰는 곳

- 종이 작업지시서: 재단 꾸러미 원장마다 체크 칸 · 주문 확인 칸(`templates/work-order.js cutSheetBlock` · `orderChecksBlock`), ⑥ 조립 순서 체크(`assemblySheet`), 시공 지시서 설치 확인 · 서명 칸(`templates/installation-order.js`).
- 작업자 포털 체크: 작업자가 자기 역할 꾸러미를 열고 항목을 체크하면 DB `work_checks`(0035)에 한 줄씩 쌓인다. 사진은 비공개 버킷 `work-check-photos`(0037).
- 발행 때 그 판을 문서(`design_documents.render_payload.check_list`)에 고정한다. 판이 올라가도 이미 낸 문서는 낸 때 목록 그대로. 목록이 없는 옛 문서는 v0.
- 완료 막기: 판의 막기가 `must` 이면 그 역할의 필수가 남았을 때 설치 · 조립 · 철거 · 납품 작업 「완료 보고」가 409 (`work/check-state.js assertDesignChecksDone` · 작업의 설계마다 `work/job-links.js assertJobChecksDone` — 철거 · 납품은 v3 부터).
  - 2026-11-06 사장님 「여러 날 걸리는 주문 — 주문 끝 완료를 따로 둠」: 공장 하루 「완료 기록」은 막지 않는다. v2 의 주문 끝 항목(`finish` — 「이 주문 재단 · 엣지 끝」 · 「이 주문 조립 끝」)은 그 역할의 필수가 남았으면 체크가 409 (`work/checks.js`). 주문 끝 항목은 권장(필수 아님)으로 적혀 필수 수에 들지 않는다.

## 작업의 지시서 — 설계로 찾는다 (2026-11-19 사장님 「수주 없이도 작업」 · 「한 작업에 모든 설계」)

배정받은 작업(프로젝트 「작업 배정」 · 일정에서 생긴 작업)의 지시서와 필수 확인은 **그 작업의 설계**로 찾는다 (`work/job-links.js`).

| 작업 | 여는 설계 |
|------|-----------|
| 프로젝트 「작업 배정」의 작업 (철거 · 재단 · 엣지 · 조립) | 그 팩토리가 그 프로젝트에 이은 설계 **모두** — 먼저 만든 것부터. 작업자는 `?design=` 로 고른다 (없으면 첫 설계) |
| 일정에서 생긴 작업 (납품 · 설치) | 그 일정의 설계 하나 |
| 수주가 적힌 그 밖의 작업 | 그 수주의 설계 (예전 그대로) |

- **수주가 없어도 연다** — 프로젝트에 이은 설계면 배정을 수락한 작업자가 바로 지시서를 열고 체크한다. 프로젝트에 잇지 않은 설계는 수주가 있을 때만.
- 수주 전 작업의 이름표는 「수주 전 · 문서 번호」다 (수주가 있으면 가린 주문 이름 · 주문 번호). 작업자 화면의 설계 이름은 품목 이름뿐이다.
- 체크는 문서에 달린다 (`work_checks.document_id`) — 수주 전 체크는 수주 칸(`order_id`)을 비우고 작업 칸(`job_id`)을 적는다 (DB 0072). 수주가 나중에 생겨도 같은 문서의 체크가 그대로 이어진다.
  - DB 0072 전: 수주가 있는 체크는 작업 칸 없이 예전처럼 적히고, 수주 없는 체크는 409 `db_pending`.
- 완료 막기는 그 작업이 여는 **설계 모두**에서 본다 (`assertJobChecksDone`) — 수주 전 작업은 DB 0072 전이면 막지 않는다 (체크를 적을 수 없다).
- 주소 · 연락처 · 현장 사진을 여는 때(수락 ~ 끝나고 7일, 현장 일만)와 꾸러미 권한(내 공정만)은 그대로다. 다른 팩토리의 설계는 열리지 않는다.

## 낱말

- 범위: `sheet` 원장마다 (재단 배치의 원장 번호) · `module` 모듈마다 (품목 · 모듈 차례) · `order` 주문에 한 번.
- 조건: `door` 도어 있는 모듈만 · `drawer` 서랍 있는 모듈만 (종이의 「—」 칸) · `confirm` 지시서 BOM 에 [확인 필요]가 있을 때만 · `outlet` 콘센트를 넣은 하부장이 있을 때만 (부자재 「전기」) · `band` 재단 배치에 밴드 재고 본이 있을 때만 (소부품 「빼기」 팩토리 — 「더하기」 문서에는 없다).
- 때: `start` 주문 시작 전 · `end` 주문 끝 (주문 범위 항목을 종이에 나눠 적는다).
- 서명: `sign` — 종이에서는 서명 칸.
- 필수: 예 = 필수 · 아니오 = 권장. 사진: `none` 없음 · `opt` 선택 · `need` 필수.
- 짧은 이름: 종이 칸 머리.
- 주문 끝: `finish` — 그 역할의 필수를 다 체크해야 체크되는 마지막 항목 (키가 `-order-done` 으로 끝난다).
- 항목 키: 소문자 · 숫자 · `-` (DB `work_checks.item_key` 모양).

## 판

| 판 | 막기 | 근거 |
|---|---|---|
| v0 | none | 정본 전에 종이에 인쇄되던 체크 그대로 |
| v1 | must | 2026-11-04 12:14 사장님 확정 — [추천안](https://claude.ai/artifact/7iRm4orYo2dQS496We24oW) 항목 전부 넣음 (필수 · 사진은 추천 그대로), 정할 것: 필수가 남으면 완료 기록을 막는다 · 엣지 항목은 재단 기사 목록에 (엣지 역할 칸 없음) · 사진은 「사진 필수」 항목만 받는다 |
| v2 | must | 2026-11-06 사장님 확정 — 작업지시서 마무리 「여러 날 걸리는 주문」: 주문 끝 「완료」를 따로 둠 (v1 + 주문 끝 항목 둘, 공장 하루 기록은 막지 않음) |
| v3 | must | 2026-11-17 사장님 확정 — 「각 작업자에게 보낼 작업지시서 … 철거 · 납품 지시서를 새로 · 따로 발행」: v2 + 역할 둘 (철거 「철거 뒤 사진 확인」 · 납품 「납품 확인 — 수량 + 내린 뒤 사진」). 재단 · 조립 · 설치 항목은 v2 그대로 |
| v4 | must | 2026-11-20 사장님 「지금 로직에 맞게 변경」 — 소부품 더하기(원장에 놓기) · 빼기(밴드 재고): v3 에서 재단 「소부품(한 변 70 이하)을 잔재에서 뽑았다」를 빼고 그 자리에 「밴드를 재고에서 꺼냈다」(조건 `band` — 빼기 팩토리 문서에만). 나머지는 v3 그대로 |

## 항목

| 판 | 역할 | 키 | 항목 | 짧은 이름 | 범위 | 조건 | 때 | 서명 | 필수 | 사진 |
|---|---|---|---|---|---|---|---|---|---|---|
| v0 | cut | cut-sheet-cut | 재단 | 재단 | sheet | | | | 예 | none |
| v0 | cut | cut-sheet-edgemark | 엣지 표시 | 엣지 표시 | sheet | | | | 예 | none |
| v0 | assembly | asm-module-cut | 재단 | 재단 | module | | | | 예 | none |
| v0 | assembly | asm-module-edge | 엣지 | 엣지 | module | | | | 예 | none |
| v0 | assembly | asm-module-build | 조립 | 조립 | module | | | | 예 | none |
| v0 | assembly | asm-module-door | 도어 달기 | 도어 달기 | module | door | | | 예 | none |
| v0 | assembly | asm-module-drawer | 서랍 | 서랍 | module | drawer | | | 예 | none |
| v0 | assembly | asm-module-pack | 검수·포장 | 검수·포장 | module | | | | 예 | none |
| v0 | install | inst-order-sign | 설치 담당 | 설치 담당 | order | | | sign | 예 | none |
| v0 | install | inst-order-inspect | 검수 | 검수 | order | | | sign | 예 | none |
| v0 | install | inst-order-customer | 고객 확인 | 고객 확인 | order | | | sign | 예 | none |
| v1 | cut | cut-order-material | 원장 자재 · 두께 · 색이 지시서와 같다 | 원장 자재 · 두께 · 색이 지시서와 같다 | order | | start | | 예 | opt |
| v1 | cut | edge-order-thickness | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | order | | start | | 예 | none |
| v1 | cut | edge-order-color | 엣지 색이 판 색과 같다 | 엣지 색이 판 색과 같다 | order | | start | | 예 | opt |
| v1 | cut | cut-sheet-cut | 재단 | 재단 | sheet | | | | 예 | none |
| v1 | cut | cut-sheet-edgemark | 엣지 표시 (붙일 면) | 엣지 표시 | sheet | | | | 예 | none |
| v1 | cut | cut-sheet-label | 조각마다 부재 라벨을 붙였다 | 라벨 | sheet | | | | 예 | none |
| v1 | cut | cut-sheet-grain | ↻ 표시 없는 결 판 조각은 돌리지 않았다 | 결 | sheet | | | | 아니오 | none |
| v1 | cut | edge-sheet-mark | 엣지 표시대로 붙였다 | 엣지 붙임 | sheet | | | | 예 | none |
| v1 | cut | cut-order-small | 소부품(한 변 70 이하)을 잔재에서 뽑았다 | 소부품(한 변 70 이하)을 잔재에서 뽑았다 | order | | end | | 예 | none |
| v1 | cut | edge-order-finish | 끝 마감 · 들뜸 없음 | 끝 마감 · 들뜸 없음 | order | | end | | 예 | opt |
| v1 | cut | cut-order-offcut | 쓸 만한 잔재에 크기를 적어 보관 | 쓸 만한 잔재에 크기를 적어 보관 | order | | end | | 아니오 | none |
| v1 | assembly | asm-module-kit | 키팅 — 모듈 부재 · 부자재가 다 있다 | 키팅 | module | | | | 예 | none |
| v1 | assembly | asm-module-cut | 재단 | 재단 | module | | | | 예 | none |
| v1 | assembly | asm-module-edge | 엣지 | 엣지 | module | | | | 예 | none |
| v1 | assembly | asm-module-build | 조립 | 조립 | module | | | | 예 | none |
| v1 | assembly | asm-module-hinge | 경첩 자리 = 지시서 보링 자리 (받은 도어 확인) | 경첩 자리 | module | door | | | 예 | none |
| v1 | assembly | asm-module-door | 도어 달기 | 도어 달기 | module | door | | | 예 | none |
| v1 | assembly | asm-module-drawer | 서랍 | 서랍 | module | drawer | | | 예 | none |
| v1 | assembly | asm-module-gap | 도어 · 서랍 간격 · 높이 맞춤 | 간격 · 높이 | module | | | | 예 | none |
| v1 | assembly | asm-module-pack | 검수·포장 | 검수·포장 | module | | | | 예 | none |
| v1 | assembly | asm-module-photo | 포장 전 정면 사진 | 사진 | module | | | | 아니오 | need |
| v1 | assembly | asm-order-confirm | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | order | confirm | | | 예 | none |
| v1 | install | inst-order-arrive | 반입 전 모듈 수 · 파손 확인 | 반입 전 모듈 수 · 파손 확인 | order | | | | 예 | opt |
| v1 | install | inst-order-level | 수평 · 벽 고정 | 수평 · 벽 고정 | order | | | | 예 | none |
| v1 | install | inst-order-adjust | 도어 · 서랍 조정 | 도어 · 서랍 조정 | order | | | | 예 | none |
| v1 | install | inst-order-trim | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | order | | | | 예 | none |
| v1 | install | inst-order-outlet | 콘센트 타공 자리 | 콘센트 타공 자리 | order | outlet | | | 아니오 | none |
| v1 | install | inst-order-photo | 완료 사진 (정면) | 완료 사진 (정면) | order | | | | 예 | need |
| v1 | install | inst-order-sign | 설치 담당 | 설치 담당 | order | | | sign | 예 | none |
| v1 | install | inst-order-inspect | 검수 | 검수 | order | | | sign | 예 | none |
| v1 | install | inst-order-customer | 고객 확인 | 고객 확인 | order | | | sign | 예 | none |
| v2 | cut | cut-order-material | 원장 자재 · 두께 · 색이 지시서와 같다 | 원장 자재 · 두께 · 색이 지시서와 같다 | order |  | start |  | 예 | opt |
| v2 | cut | edge-order-thickness | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | order |  | start |  | 예 | none |
| v2 | cut | edge-order-color | 엣지 색이 판 색과 같다 | 엣지 색이 판 색과 같다 | order |  | start |  | 예 | opt |
| v2 | cut | cut-sheet-cut | 재단 | 재단 | sheet |  |  |  | 예 | none |
| v2 | cut | cut-sheet-edgemark | 엣지 표시 (붙일 면) | 엣지 표시 | sheet |  |  |  | 예 | none |
| v2 | cut | cut-sheet-label | 조각마다 부재 라벨을 붙였다 | 라벨 | sheet |  |  |  | 예 | none |
| v2 | cut | cut-sheet-grain | ↻ 표시 없는 결 판 조각은 돌리지 않았다 | 결 | sheet |  |  |  | 아니오 | none |
| v2 | cut | edge-sheet-mark | 엣지 표시대로 붙였다 | 엣지 붙임 | sheet |  |  |  | 예 | none |
| v2 | cut | cut-order-small | 소부품(한 변 70 이하)을 잔재에서 뽑았다 | 소부품(한 변 70 이하)을 잔재에서 뽑았다 | order |  | end |  | 예 | none |
| v2 | cut | edge-order-finish | 끝 마감 · 들뜸 없음 | 끝 마감 · 들뜸 없음 | order |  | end |  | 예 | opt |
| v2 | cut | cut-order-offcut | 쓸 만한 잔재에 크기를 적어 보관 | 쓸 만한 잔재에 크기를 적어 보관 | order |  | end |  | 아니오 | none |
| v2 | cut | cut-order-done | 이 주문 재단 · 엣지 끝 | 재단 끝 | order |  | end |  | 아니오 | none |
| v2 | assembly | asm-module-kit | 키팅 — 모듈 부재 · 부자재가 다 있다 | 키팅 | module |  |  |  | 예 | none |
| v2 | assembly | asm-module-cut | 재단 | 재단 | module |  |  |  | 예 | none |
| v2 | assembly | asm-module-edge | 엣지 | 엣지 | module |  |  |  | 예 | none |
| v2 | assembly | asm-module-build | 조립 | 조립 | module |  |  |  | 예 | none |
| v2 | assembly | asm-module-hinge | 경첩 자리 = 지시서 보링 자리 (받은 도어 확인) | 경첩 자리 | module | door |  |  | 예 | none |
| v2 | assembly | asm-module-door | 도어 달기 | 도어 달기 | module | door |  |  | 예 | none |
| v2 | assembly | asm-module-drawer | 서랍 | 서랍 | module | drawer |  |  | 예 | none |
| v2 | assembly | asm-module-gap | 도어 · 서랍 간격 · 높이 맞춤 | 간격 · 높이 | module |  |  |  | 예 | none |
| v2 | assembly | asm-module-pack | 검수·포장 | 검수·포장 | module |  |  |  | 예 | none |
| v2 | assembly | asm-module-photo | 포장 전 정면 사진 | 사진 | module |  |  |  | 아니오 | need |
| v2 | assembly | asm-order-confirm | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | order | confirm |  |  | 예 | none |
| v2 | assembly | asm-order-done | 이 주문 조립 끝 | 조립 끝 | order |  | end |  | 아니오 | none |
| v2 | install | inst-order-arrive | 반입 전 모듈 수 · 파손 확인 | 반입 전 모듈 수 · 파손 확인 | order |  |  |  | 예 | opt |
| v2 | install | inst-order-level | 수평 · 벽 고정 | 수평 · 벽 고정 | order |  |  |  | 예 | none |
| v2 | install | inst-order-adjust | 도어 · 서랍 조정 | 도어 · 서랍 조정 | order |  |  |  | 예 | none |
| v2 | install | inst-order-trim | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | order |  |  |  | 예 | none |
| v2 | install | inst-order-outlet | 콘센트 타공 자리 | 콘센트 타공 자리 | order | outlet |  |  | 아니오 | none |
| v2 | install | inst-order-photo | 완료 사진 (정면) | 완료 사진 (정면) | order |  |  |  | 예 | need |
| v2 | install | inst-order-sign | 설치 담당 | 설치 담당 | order |  |  | sign | 예 | none |
| v2 | install | inst-order-inspect | 검수 | 검수 | order |  |  | sign | 예 | none |
| v2 | install | inst-order-customer | 고객 확인 | 고객 확인 | order |  |  | sign | 예 | none |
| v3 | cut | cut-order-material | 원장 자재 · 두께 · 색이 지시서와 같다 | 원장 자재 · 두께 · 색이 지시서와 같다 | order |  | start |  | 예 | opt |
| v3 | cut | edge-order-thickness | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | order |  | start |  | 예 | none |
| v3 | cut | edge-order-color | 엣지 색이 판 색과 같다 | 엣지 색이 판 색과 같다 | order |  | start |  | 예 | opt |
| v3 | cut | cut-sheet-cut | 재단 | 재단 | sheet |  |  |  | 예 | none |
| v3 | cut | cut-sheet-edgemark | 엣지 표시 (붙일 면) | 엣지 표시 | sheet |  |  |  | 예 | none |
| v3 | cut | cut-sheet-label | 조각마다 부재 라벨을 붙였다 | 라벨 | sheet |  |  |  | 예 | none |
| v3 | cut | cut-sheet-grain | ↻ 표시 없는 결 판 조각은 돌리지 않았다 | 결 | sheet |  |  |  | 아니오 | none |
| v3 | cut | edge-sheet-mark | 엣지 표시대로 붙였다 | 엣지 붙임 | sheet |  |  |  | 예 | none |
| v3 | cut | cut-order-small | 소부품(한 변 70 이하)을 잔재에서 뽑았다 | 소부품(한 변 70 이하)을 잔재에서 뽑았다 | order |  | end |  | 예 | none |
| v3 | cut | edge-order-finish | 끝 마감 · 들뜸 없음 | 끝 마감 · 들뜸 없음 | order |  | end |  | 예 | opt |
| v3 | cut | cut-order-offcut | 쓸 만한 잔재에 크기를 적어 보관 | 쓸 만한 잔재에 크기를 적어 보관 | order |  | end |  | 아니오 | none |
| v3 | cut | cut-order-done | 이 주문 재단 · 엣지 끝 | 재단 끝 | order |  | end |  | 아니오 | none |
| v3 | assembly | asm-module-kit | 키팅 — 모듈 부재 · 부자재가 다 있다 | 키팅 | module |  |  |  | 예 | none |
| v3 | assembly | asm-module-cut | 재단 | 재단 | module |  |  |  | 예 | none |
| v3 | assembly | asm-module-edge | 엣지 | 엣지 | module |  |  |  | 예 | none |
| v3 | assembly | asm-module-build | 조립 | 조립 | module |  |  |  | 예 | none |
| v3 | assembly | asm-module-hinge | 경첩 자리 = 지시서 보링 자리 (받은 도어 확인) | 경첩 자리 | module | door |  |  | 예 | none |
| v3 | assembly | asm-module-door | 도어 달기 | 도어 달기 | module | door |  |  | 예 | none |
| v3 | assembly | asm-module-drawer | 서랍 | 서랍 | module | drawer |  |  | 예 | none |
| v3 | assembly | asm-module-gap | 도어 · 서랍 간격 · 높이 맞춤 | 간격 · 높이 | module |  |  |  | 예 | none |
| v3 | assembly | asm-module-pack | 검수·포장 | 검수·포장 | module |  |  |  | 예 | none |
| v3 | assembly | asm-module-photo | 포장 전 정면 사진 | 사진 | module |  |  |  | 아니오 | need |
| v3 | assembly | asm-order-confirm | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | order | confirm |  |  | 예 | none |
| v3 | assembly | asm-order-done | 이 주문 조립 끝 | 조립 끝 | order |  | end |  | 아니오 | none |
| v3 | install | inst-order-arrive | 반입 전 모듈 수 · 파손 확인 | 반입 전 모듈 수 · 파손 확인 | order |  |  |  | 예 | opt |
| v3 | install | inst-order-level | 수평 · 벽 고정 | 수평 · 벽 고정 | order |  |  |  | 예 | none |
| v3 | install | inst-order-adjust | 도어 · 서랍 조정 | 도어 · 서랍 조정 | order |  |  |  | 예 | none |
| v3 | install | inst-order-trim | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | order |  |  |  | 예 | none |
| v3 | install | inst-order-outlet | 콘센트 타공 자리 | 콘센트 타공 자리 | order | outlet |  |  | 아니오 | none |
| v3 | install | inst-order-photo | 완료 사진 (정면) | 완료 사진 (정면) | order |  |  |  | 예 | need |
| v3 | install | inst-order-sign | 설치 담당 | 설치 담당 | order |  |  | sign | 예 | none |
| v3 | install | inst-order-inspect | 검수 | 검수 | order |  |  | sign | 예 | none |
| v3 | install | inst-order-customer | 고객 확인 | 고객 확인 | order |  |  | sign | 예 | none |
| v3 | demolition | demo-order-photo | 철거 후 사진 | 철거 후 사진 | order |  |  |  | 예 | need |
| v3 | delivery | dlv-order-count | 납품 수량 확인 | 납품 수량 확인 | order |  |  |  | 예 | none |
| v3 | delivery | dlv-order-photo | 하차 후 사진 | 하차 후 사진 | order |  |  |  | 예 | need |
| v4 | cut | cut-order-material | 원장 자재 · 두께 · 색이 지시서와 같다 | 원장 자재 · 두께 · 색이 지시서와 같다 | order |  | start |  | 예 | opt |
| v4 | cut | edge-order-thickness | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | 엣지 두께 — 도어 · 서랍 전면 1.0, 나머지 0.6 | order |  | start |  | 예 | none |
| v4 | cut | edge-order-color | 엣지 색이 판 색과 같다 | 엣지 색이 판 색과 같다 | order |  | start |  | 예 | opt |
| v4 | cut | cut-sheet-cut | 재단 | 재단 | sheet |  |  |  | 예 | none |
| v4 | cut | cut-sheet-edgemark | 엣지 표시 (붙일 면) | 엣지 표시 | sheet |  |  |  | 예 | none |
| v4 | cut | cut-sheet-label | 조각마다 부재 라벨을 붙였다 | 라벨 | sheet |  |  |  | 예 | none |
| v4 | cut | cut-sheet-grain | ↻ 표시 없는 결 판 조각은 돌리지 않았다 | 결 | sheet |  |  |  | 아니오 | none |
| v4 | cut | edge-sheet-mark | 엣지 표시대로 붙였다 | 엣지 붙임 | sheet |  |  |  | 예 | none |
| v4 | cut | cut-order-band | 밴드를 재고에서 꺼냈다 | 밴드를 재고에서 꺼냈다 | order | band | end |  | 예 | none |
| v4 | cut | edge-order-finish | 끝 마감 · 들뜸 없음 | 끝 마감 · 들뜸 없음 | order |  | end |  | 예 | opt |
| v4 | cut | cut-order-offcut | 쓸 만한 잔재에 크기를 적어 보관 | 쓸 만한 잔재에 크기를 적어 보관 | order |  | end |  | 아니오 | none |
| v4 | cut | cut-order-done | 이 주문 재단 · 엣지 끝 | 재단 끝 | order |  | end |  | 아니오 | none |
| v4 | assembly | asm-module-kit | 키팅 — 모듈 부재 · 부자재가 다 있다 | 키팅 | module |  |  |  | 예 | none |
| v4 | assembly | asm-module-cut | 재단 | 재단 | module |  |  |  | 예 | none |
| v4 | assembly | asm-module-edge | 엣지 | 엣지 | module |  |  |  | 예 | none |
| v4 | assembly | asm-module-build | 조립 | 조립 | module |  |  |  | 예 | none |
| v4 | assembly | asm-module-hinge | 경첩 자리 = 지시서 보링 자리 (받은 도어 확인) | 경첩 자리 | module | door |  |  | 예 | none |
| v4 | assembly | asm-module-door | 도어 달기 | 도어 달기 | module | door |  |  | 예 | none |
| v4 | assembly | asm-module-drawer | 서랍 | 서랍 | module | drawer |  |  | 예 | none |
| v4 | assembly | asm-module-gap | 도어 · 서랍 간격 · 높이 맞춤 | 간격 · 높이 | module |  |  |  | 예 | none |
| v4 | assembly | asm-module-pack | 검수·포장 | 검수·포장 | module |  |  |  | 예 | none |
| v4 | assembly | asm-module-photo | 포장 전 정면 사진 | 사진 | module |  |  |  | 아니오 | need |
| v4 | assembly | asm-order-confirm | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | [확인 필요] 줄은 담당자에게 물어 답을 받았다 | order | confirm |  |  | 예 | none |
| v4 | assembly | asm-order-done | 이 주문 조립 끝 | 조립 끝 | order |  | end |  | 아니오 | none |
| v4 | install | inst-order-arrive | 반입 전 모듈 수 · 파손 확인 | 반입 전 모듈 수 · 파손 확인 | order |  |  |  | 예 | opt |
| v4 | install | inst-order-level | 수평 · 벽 고정 | 수평 · 벽 고정 | order |  |  |  | 예 | none |
| v4 | install | inst-order-adjust | 도어 · 서랍 조정 | 도어 · 서랍 조정 | order |  |  |  | 예 | none |
| v4 | install | inst-order-trim | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | 상판 · 걸레받이 · 몰딩 · 마감재 마감 | order |  |  |  | 예 | none |
| v4 | install | inst-order-outlet | 콘센트 타공 자리 | 콘센트 타공 자리 | order | outlet |  |  | 아니오 | none |
| v4 | install | inst-order-photo | 완료 사진 (정면) | 완료 사진 (정면) | order |  |  |  | 예 | need |
| v4 | install | inst-order-sign | 설치 담당 | 설치 담당 | order |  |  | sign | 예 | none |
| v4 | install | inst-order-inspect | 검수 | 검수 | order |  |  | sign | 예 | none |
| v4 | install | inst-order-customer | 고객 확인 | 고객 확인 | order |  |  | sign | 예 | none |
| v4 | demolition | demo-order-photo | 철거 후 사진 | 철거 후 사진 | order |  |  |  | 예 | need |
| v4 | delivery | dlv-order-count | 납품 수량 확인 | 납품 수량 확인 | order |  |  |  | 예 | none |
| v4 | delivery | dlv-order-photo | 하차 후 사진 | 하차 후 사진 | order |  |  |  | 예 | need |

철거(demolition) · 납품(delivery) 역할은 v3 부터다 (DB 0068 이 `work_checks.role` 에 둘을 더했다) — 철거 지시서 · 납품 지시서(`templates/site-order.js`)의 확인 칸과 작업자 체크가 이 항목을 쓴다. 앞 판(v0 ~ v2)에는 두 역할의 항목이 없다.

철거 지시서에는 팩토리가 그 설계에 올려 둔 현장 사진이 같이 실린다 (`work/job-sheet.js sitePhotosOf` — 간편 플래너 설계의 「현장사진」 가운데 지우지 않은 것, 열 때마다 읽는 1시간 서명 주소 · 문서에 고정하지 않는다). 사무실 인쇄에는 늘, 작업자에게는 주소 · 연락처와 같은 때(수락한 때부터 작업이 끝나고 7일까지 — `work/reveal.js siteOpenFor`)에만 싣는다. 납품 지시서 · 설치 지시서에는 싣지 않는다. 확인 항목 「철거 후 사진」과는 다른 것이다 (그쪽은 작업자가 찍어 올리는 사진).

엣지(edge) 역할은 모든 판에 따로 칸이 없다 — v1 은 2026-11-04 사장님 「재단 기사가 같이」로 엣지 항목을 재단 기사 목록에 둔다.
