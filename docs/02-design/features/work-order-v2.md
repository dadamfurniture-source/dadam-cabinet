# 작업지시서 v2 (B5) — 렌더·스와치·키팅·시트별 재단표·보링·조립 체크·rev 차이·QR 라벨

> 계획: `docs/01-plan/detail-bom-deepening.plan.md` §1.4 · §4.6 · §5 B5. Workflow Worker 도메인 (`workers/workflow-api`).
> 같은 `work_order` 문서 종류에 **섹션을 더한다** — 새 doc_type 은 없다 (§4.6, `documents.js DOC_TYPES` · DB CHECK 동시 수정 부담).
> 금액은 여전히 싣지 않는다.

## 1. 무엇이 바뀌었나

| | v1 | v2 |
|---|---|---|
| 표지 | 문서 정보 · 품목 요약 · 특기사항 · 서명란 | + 품목별 **정면 렌더** (D3) + **색 스와치 범례** (hex 칩 · 이름 · 코드 · 시리즈·소재·톤 · 발주 코드) + 재단 시트 수 · 라벨 수 |
| 모듈 명세 | 있음 | 그대로 |
| 자재 목록 | 자재 순 평면 표 | **② 모듈별 키팅** — 품목 → 모듈 묶음, partId · 자재/두께 · 가로×세로 · 수량 · 마감 칩 · **엣지 면 도식** · 그 모듈의 철물 |
| 재단 | 없음 | **③ 시트별 재단표** — 시트마다 머리(번호·자재·원판·수율) + 배치 SVG 축소판(트림 음영·조각·partId) + 부재 표(x, y, 회전) · 잔재 · 소부품 · 미배치 |
| 철물 | 평면 표 | **④** 분류별 묶음 + 합계 |
| 보링 | 경첩 비고 안의 자유문 | **⑤ 보링 좌표표** — 도어 partId · 도어 수 · 도어 H · 구 수 · 위치(mm) |
| 조립 | 없음 | **⑥ 조립 순서 체크** — 모듈마다 재단 ☐ 엣지 ☐ 보링 ☐ 조립 ☐ 검수 ☐ + 완료일 · 서명 |
| rev | 없음 | **⑦ 이전 rev 와의 차이** — partId 기준 추가 / 삭제 / 변경(가로·세로·두께·수량·마감·자재) |
| 라벨 | 없음 | **⑧ 부재 라벨 부록** — A4 3×8 = 24장, 부재 낱개마다 **QR(partId#k)** + partId + 품목/모듈/부품 + w×h×t + 마감 코드 |

## 2. 섹션별 데이터 출처

| 섹션 | 읽는 곳 | 없으면 |
|---|---|---|
| ① 정면 렌더 | `render_payload.renders[]` (발행 시 `design_renders` 최신 `kind='front'`, `path·width·height`) → 인쇄 시 서명 URL | 상자에 "정면 렌더 없음" (경로는 있는데 서명이 실패하면 "렌더를 불러올 수 없음") |
| ① 스와치 | `render_payload.swatches[]` (발행 시 `materials` 표를 `code` 로 조회: `color_name color_hex vendor_code series finish tone`) | 카탈로그에 없는 코드는 빗금 칩 + 이름 = 코드; v1 문서는 자재 행의 `finishCode` 고유값만 |
| ② 키팅 | `snapshot.bom_payload.materials[]` (B1 필드 `partId slot edges edgeLen edgeT edgeCode finishCode`) · `hardware_payload.hardware[]` | `partId` 없는 옛 행은 `row-<index>`, 문자열 `edge` 를 §7-2 규칙으로 변으로 바꿔 도식을 그린다 |
| ③ 재단표 | `render_payload.cut_plan` (= 발행 시 `snapshot.cut_plan_payload`) | "재단 배치 없음 (스냅샷 재발행 필요)" + v1 의 평면 자재 목록. `cut_plan` 키 자체가 없는 문서(v1)는 스냅샷의 `cut_plan_payload` 를 대신 읽는다 |
| ④ 철물 | `hardware_payload.hardware[]` | 섹션 생략 |
| ⑤ 보링 | 경첩 행 `note` = `${모듈명} (보링: 110, 358, 606)` (`extractors.js extractHinges`) — 구조화 `boring[]` 필드가 있으면 우선 | "경첩 보링 정보 없음". 도어 행을 못 찾으면 partId 자리에 "도어 행 미확인" |
| ⑥ 조립 체크 | `design_payload.items[].modules[]` | "모듈 없음" |
| ⑦ rev 차이 | `render_payload.prev_rev` (발행 시 계산·동결) | `null` → "첫 발행", 키 자체가 없음(v1) → "비교 자료 없음" |
| ⑧ 라벨 | `materials[]` 를 수량으로 전개 (`partId#k`, k = 0..qty−1 — 재단 배치 `parts[].partId` 와 같은 id) | 자재 없으면 생략 |

도어 partId 매칭(⑤·②): 경첩 비고의 모듈명 = `mod.name` 이고 자재 행의 `module` 은 `#1 하부장-개수대` 꼴이라
`moduleNameOf()` 가 품목 접두 `#n ` · `상부장-`/`하부장-` 접두 · `(단)` 접미를 떼고 비교한다. 품목 라벨이 둘 다 있으면 같아야 한다.

## 3. 동결 규칙 (`render_payload`)

발행(`POST /snapshots/:id/documents`, `doc_type=work_order`) 시 `documents.js` 가 `work-order-data.js gatherWorkOrderPayload()` 로 아래를 모아
`design_documents.render_payload` 에 넣는다. 문서는 append-only 라 그 뒤로 바뀌지 않는다 (불변조건 I3).

```
render_payload = {
  quote, instructions, issued_by,          // v1 그대로
  work_order_version: 2,
  renders:  [{ item_index, item_unique_id, path, width, height, created_at }],   // 품목마다 한 줄, 없으면 path null
  swatches: [{ code, known, color_name, color_hex, vendor_code, series, finish, tone }],
  cut_plan: <snapshot.cut_plan_payload> | null,
  parts_digest: [{ partId, itemLabel, module, part, material, thickness, w, h, qty, finishCode }],
  prev_rev: null | { document_id, rev, doc_no, snapshot_rev, diff: { added[], removed[], changed[{…, changes:[{field, from, to}]}] } },
}
totals += { sheet_count, label_count }      // 시트 수(배치 없으면 snapshot.sheet_count, 그것도 없으면 null) · Σ qty
```

- **렌더**: `design_renders` 에서 `design_id` + `item_unique_id`(= `Math.floor(item.uniqueId)`, persistence-init 과 같은 규칙) + `kind='front'` 의 최신 행. **경로만** 저장한다.
  서명 URL 은 만료되는 값이라 인쇄 때마다 `storage.js createSignedUrls()` 가 service role 로 1시간짜리를 만든다 (`GET /documents/:id/print`).
  나중에 렌더를 다시 찍어도 이미 발행된 문서는 발행 당시의 그림을 가리킨다. 파일이 지워지면 "렌더를 불러올 수 없음".
- **스와치**: 발행 시점의 카탈로그 값. 이름·hex 가 나중에 바뀌어도 문서는 그대로 (I6 와 같은 취지).
- **재단 배치**: 스냅샷 값을 복사한다. 스냅샷도 불변이지만 문서가 자기 안에 전부 가지고 있어야 한다는 원칙을 따른다.
- **부재 요약** `parts_digest`: 다음 rev 가 이 문서와 비교할 때 읽는다. 스냅샷을 다시 열지 않아도 된다.
- **이전 rev**: 같은 설계의 직전 `work_order`(rev 최대)와 partId 로 비교해 **결과를 동결**한다. 직전 문서가 v1(요약 없음)이면 그 문서의 스냅샷 자재로 요약을 만든다.
  partId 가 없는 옛 행끼리는 `품목/모듈/부품#k` 로 맞춘다 (순번이 밀려도 전부 바뀐 것으로 보이지 않게).

표·컬럼이 없는 DB 에서도 발행은 멈추지 않는다: `design_renders` 가 없으면(PGRST205/42P01) 렌더 전부 `path null`,
`materials.series` 가 없으면(42703) 그 컬럼만 빼고 다시 조회, 둘 다 경고 로그. 다른 오류는 그대로 던진다.

## 4. 구 문서 호환

`GET /documents/:id/print` 는 v1 문서(`render_payload` 에 v2 키가 없음)도 그대로 연다. `work-order.js buildContext()` 가 키마다 폴백을 둔다 —
렌더 없음 · 코드만 있는 범례 · 스냅샷의 `cut_plan_payload`(있으면) · `row-N` partId · 문자열 `edge` → 변 · "비교 자료 없음".
`renders`/`prev_rev` 는 **발행 시점에만** 모으므로 v1 문서를 열 때 DB 를 다시 조회하지 않는다 — 새 자료를 실으려면 재발행한다.

## 5. 적용 · 재발행

1. 워커 배포: `cd workers/workflow-api && npm run deploy`. 새 시크릿·환경변수 없음 (`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY` 가 Storage 서명에도 쓰인다).
2. 재단표를 실으려면 스냅샷에 배치가 있어야 한다: `database/workflow-cut-plan.sql` 적용 → 상세설계에서 **스냅샷을 다시 만들고** 그 스냅샷으로 발행.
   (배치는 `content_hash` 에 안 들어가므로 같은 설계면 같은 rev 가 재사용된다 — 배치 없는 옛 스냅샷이 재사용되면 배치가 안 실린다. 그때는 설계를 한 번 저장해 새 rev 를 만든다.)
3. 정면 렌더를 실으려면 `database/design-renders.sql` + 비공개 버킷 `renders` 적용 → 플래너 디테일 모드에서 📷 렌더 저장 → 발행.
4. 스와치 이름·hex 는 `database/materials-catalog-v2.sql` (+ `materials-yerim-lux-seed.sql` 의 `series`) 가 있어야 채워진다. 없으면 코드만.
5. 이미 발행된 문서는 바뀌지 않는다. 새 섹션 자료를 실으려면 **재발행**(같은 스냅샷이어도 된다) — 이전 rev 는 자동으로 superseded 처리된다 (`supersedePriorRevisions`).

## 6. QR 인코더 (`src/util/qr.js`)

워커에 의존성이 없고 공장 네트워크가 CDN 을 막을 수 있어 서버가 SVG 로 그린다.
바이트 모드(UTF-8) · 버전 1~10 · 오류정정 M · ISO 18004 벌점으로 마스크 선택(옵션으로 고정) · 출력은 `<path d>` 한 줄.
용량은 버전 10-M 213 바이트 — partId 는 20자 안팎이라 버전 2~3 이다. 시험 벡터(`test/fixtures/qr-vectors.json`)는 node-qrcode 1.5.4 와
python qrcode 8 두 구현으로 만들어 대조했다 (고정 마스크 행렬은 둘이 같고, 자동 마스크는 node-qrcode 의 선택과 같다).

## 7. 파일

| 파일 | 역할 |
|---|---|
| `workers/workflow-api/src/work-order-data.js` | 발행 시 수집(`gatherWorkOrderPayload`) · 요약 · rev 차이 · 보링 파싱 · 모듈명 매칭 |
| `workers/workflow-api/src/storage.js` | Storage 서명 URL (`createSignedUrls`) |
| `workers/workflow-api/src/documents.js` | 발행 시 `render_payload`·`totals` 합류, 인쇄 시 `resolvePrintAssets` |
| `workers/workflow-api/src/worker.js` | `GET /documents/:id/print` 가 서명 URL 을 만들어 템플릿에 넘긴다 |
| `workers/workflow-api/src/templates/work-order.js` | 섹션 ①~⑧ 렌더 |
| `workers/workflow-api/src/templates/print-css.js` | v2 스타일 (렌더 상자 · 칩 · 엣지 도식 · 재단표 · 체크 · 라벨 격자) |
| `workers/workflow-api/src/util/qr.js` | QR 인코더 |
| `workers/workflow-api/test/work-order-v2.test.js` · `qr.test.js` · `fixtures/` | 시험 |

## 8. 남은 것

- 라벨 시트를 별도 `label_sheet` 문서로 뗄지는 계획 §4.6 대로 **보류** — 지금은 work_order 의 부록이다.
- 보링 위치는 경첩 비고 자유문을 파싱한다. `extractHinges` 가 구조화 `boring[]` 을 실으면(BOM 도메인) 파서가 그것을 우선 읽는다 — 이미 준비돼 있다.
- 경첩 외 철물(레일·손잡이)은 모듈 정보가 비고에 없어 키팅에서 "기타 철물" 로 내려간다. 철물 행에 `module` 필드가 생기면 그대로 묶인다.
- `drawing-viewer.html` 의 `?snapshot=` 연결(계획 B5 마지막 줄)은 프런트 작업이라 이 PR 에 없다.
