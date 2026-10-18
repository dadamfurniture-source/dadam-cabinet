# 관리자 대시보드 「작업 지시 보고」 보관함 (울트라플랜)

> 작성: 2026-10-18 · **사장님 결정 반영: 2026-10-18** (§8 · 외주 발주 내역 · 상판 발주 요청서 추가 §2.1·§2.2) / 기준 커밋: `cb878b8` (origin/main)
> 앞선 문서: `docs/01-plan/work-order-stage.plan.md` (작업지시서 4단계), 생산 계획 시스템 (#755 · #759, `workers/workflow-api/src/production/`).
>
> 표기: **[확인]** 코드 근거 있음 · **[결정]** 이 계획이 정하는 것 · **[확인 필요]** 사장님만 답할 수 있는 것.

---

## 0. 한 문단 요약

사장님 지시 (2026-10-18): "관리자 대시보드에 생산 계획, 인력 추천 등 작업 지시 보고 내용을 정리해서 보관, 저장할 수 있는 카테고리."

지금 작업 지시 관련 보고는 **세 군데에 흩어져 있고, 일부는 아예 남지 않는다.**
① 생산 계획·인력 추천은 `production_proposals` 에 행으로 쌓이지만 **목록을 볼 길이 없다** (최신 1건 또는 id 로만 열린다).
② 아침 07시 요약과 Slack 지시 원문은 **보내고 사라진다** (DB 에 없다).
③ 작업지시서·설치 지시서는 `design_documents` 에 동결돼 있지만 **설계마다 따로** 열어야 한다.
그리고 관리자 대시보드(`admin/*.html`)에는 이 중 어느 것으로도 가는 길이 없다.

그래서 **보고 한 건 = 한 행**인 추가 전용 보관 표 `work_reports` 를 두고, 보고가 생기는 순간(제안 · 승인 · 아침 요약 · 지시서 발행 · 월 마감) 워커가 그 시점 내용을 **동결해 한 행씩 쌓는다.** 관리자 대시보드에 새 카테고리 **「작업 지시 보고」**(`admin/work-reports.html`)를 만들어 기간·종류·상태로 걸러 보고, 열어 보고, 메모·고정·보관 처리하고, A4 로 인쇄(=PDF 저장)한다. 기존 행(제안·문서)은 한 번에 옮겨 담는다(백필).

---

## 1. 지금 있는 것 [확인]

| 보고 | 어디에 | 남나 | 볼 수 있나 |
|---|---|---|---|
| 생산 계획·인력 추천 (제안) | `production_proposals.plan` JSONB — `days[] · jobs[] · suggestions[] · summary` | 남는다. 새 계산 때 이전 pending 은 `superseded` 로 바뀔 뿐 지워지지 않음 (`service.js:176`) | `production.html?p=<id>` 한 건씩. **목록 API 없음** (`GET /production/proposals/:id` 만) |
| 승인한 지시 | `production_assignments` (work_date · role · people · hours · cost · status instructed/done/cancelled) | 남는다 | `GET /production/assignments?from=` (오늘 이후 위주) |
| 승인 때 고른 추천 | — | **안 남는다** (`selected[]` 저장 안 함, 승인자도 없음) | — |
| 아침 07시 요약 | Slack 으로만 (`notify.js buildDailyBlocks`) | **안 남는다** | — |
| 작업자 Slack 지시 원문 | Slack 으로만 | **안 남는다** (`slack_notifications` 는 일정 알림 전용) | — |
| 월 손익 | `GET /production/monthly` 가 그때 계산 | **안 남는다** (마감 시점 숫자가 없다) | production.html 월 손익 카드 |
| 작업지시서 · 설치 지시서 | `design_documents` (render_payload 동결, rev, stale) | 남는다 | 설계별 `GET /designs/:id/documents` 만 (100건 제한). **설계를 가로지르는 목록 없음** |
| 실측 작업 기록 | `production_worklogs` | 남는다 | production.html 실측·보정 |

관리자 쪽 [확인]:
- `admin/*.html` 10개, 정적 HTML, **사이드바·CSS 가 페이지마다 복사**돼 있다 (공용 파일은 `js/admin-access.js` 하나).
- 관리자 판정 정본은 `admin_roles` + `public.is_admin()` (SECURITY DEFINER) · `AdminAccess.isAdmin()`. 그러나 5개 페이지는 아직 하드코딩 `ADMIN_EMAILS` 이고, appliances 는 `'superadmin'` 오타로 `super_admin` 이 막힐 수 있다.
- **워커(`workflow-api`)에는 관리자 검사가 전혀 없다** — 모든 경로가 "본인 데이터" 기준(user_id · 설계 소유자).
- `__tests__/reference-images.test.js` 가 모든 admin 페이지 사이드바를 검사한다 — 새 페이지·새 메뉴도 자동 대상.

---

## 2. 무엇을 보관하나 — 보고 종류 [결정]

| kind | 이름 | 언제 생기나 | 동결 내용 | 목록에 보이는 숫자 |
|---|---|---|---|---|
| `production_plan` | 생산 계획 · 인력 추천 | 제안이 만들어질 때 (새 수주 · 설치일 변경 · 수주 취소 · 수동 재계산 · 아침 점검) | proposal 의 plan 그대로 + 계기(trigger) | 주문 수 · 지연 전→후 · 추가 비용 · 추천 수 |
| `staffing_decision` | 인력 추천 승인/무시 | 대표가 승인·무시할 때 | 고른 추천 목록(`selected`) · 만들어진 지시 행 · 승인자 · 시각 | 지시 건수 · 추가 비용 · 날짜 범위 |
| `daily_brief` | 아침 생산 요약 | 평일 07시 cron 이 보낼 때 | 그날 부하(재단/엣지/조립 %) · 진행 주문 · 오늘 지시 · 도어 발주 마감 · 늦을 주문 · Slack 원문 블록 | 부하 % · 오늘 지시 수 · 지연 수 |
| `work_order` | 제작 작업지시서 | 발행할 때 | 문서 id · doc_no · rev · 설계 · 주문 · totals(원판·라벨·예상 시간) — 본문은 원본 `design_documents` 를 가리킨다 | 원판 · 라벨 · 예상 시간 |
| `installation_order` | 설치 지시서 | 발행할 때 | 문서 id · doc_no · 현장 요약 | 설치일 · 주소(구까지) |
| `monthly_close` | 월 생산 마감 | 매월 1일 07시 (전월) | `GET /production/monthly` 결과 그대로 + 지시 완료율 · 실측 대비 표준시간 | 매출 · 인건비 · 외주 · 완료율 |
| `outsource_order` | **외주 발주 내역** (Q6 추가) | 대표가 외주 꾸러미를 **[발주 처리]** 할 때 — 도어재 · 재단·엣지 의뢰 · 상판 | 업체 · 꾸러미 · 문서번호 · 수량 요약(원장 · 도어 짝 · 원판 · 상판 조각) · 발주일 · 입고 예정일 · 상태(발주 → 입고 / 취소) | 업체 · 수량 · 입고 예정 · 상태 |
| `countertop_order` | **상판 발주 요청서** (Q6 추가) | 작업지시서 발행 때 함께 (상판이 있는 품목) | 재질(인조대리석 · 엔지니어드 스톤 · 세라믹) · 색/코드 · 두께 · 평면 형상과 외곽 치수 · 타공(싱크볼 · 쿡탑 · 수전) 위치 · 앞턱/뒷턱 · 납기 — 본문은 작업지시서 `render_payload` 에 동결, 보관함은 색인 | 재질 · 두께 · 외곽 치수 · 타공 수 |
| `note` | 메모 보고 | 관리자가 직접 | 제목 · 본문 · (선택) 첨부 | — |

- 작업지시서는 **본문을 복사하지 않는다** — 이미 `render_payload` 로 동결돼 있으니 보관함 행은 색인(가리키는 표)이다. 인쇄는 기존 `/documents/:id/print?pack=` 를 그대로 연다.
- 생산 계획·아침 요약·월 마감은 원본이 없거나(요약·월) 덮어쓰이는 원천(설정·실시간 계산)에서 나오므로 **내용을 통째로 동결**한다.

### 2.1 외주 발주 내역 (`outsource_order`)

지금은 외주 종이(도어재 발주서 · 재단·엣지 의뢰서)를 **뽑을 수만 있고, 보냈다는 기록이 없다.** Step 4 의 외주 꾸러미 카드에
**[발주 처리]** 를 둔다 — 누르면 업체·입고 예정일을 받아 한 행을 남긴다. 보관함에서 상태를 **입고**로 바꾼다.

| 꾸러미 | 업체 (기본) | 수량 요약 |
|---|---|---|
| 도어재 발주서 (`door`) | 상일 | 도어재 원장 · 도어 짝 · 부재 장 |
| 재단·엣지 의뢰서 (`cut-vendor`) | 일성합판 | 원판 · 엣지 m |
| 상판 발주 요청서 (`top`, §2.2) | 재질별 업체 (생산 설정, §8.1 Q7) | 외곽 치수 · 타공 수 · 발주 마감 = 설치 − 4일 |

생산 계획의 도어 발주 마감(`door_order` 추천)과 엮는다 — 발주 처리가 된 주문은 아침 요약의 "도어 발주 마감" 경고에서 빠진다.

### 2.2 상판 발주 요청서 (`countertop_order`, 새 문서)

사장님 (2026-10-18): **인조대리석 · 엔지니어드 스톤 · 세라믹** 상판 발주 요청서가 있어야 한다.

지금 [확인]: BOM 은 상판을 **품목당 한 장**, 재질 **인조대리석 하나**, 두께 12 · 50T, 깊이 = 도면, 이음·타공은 업체 판단으로 낸다
(`extractors.js` 상판 블록, 같은 날 사장님 확정). 타공·이음 규칙은 `hardware.md` §8 이 비어 있다.

새 문서는 작업지시서의 꾸러미 하나로 만든다 — `?pack=top` (도어재 발주서와 같은 방식: 같은 동결 문서, 고객 이름·금액 없음):

```
상판 발주 요청서   DD-…-WO-r2 · 발행 10/18 · 발주 마감 10/20 (설치 10/24 − 4일)
업체  ○○스톤 (엔지니어드 스톤 기본 업체)      시공: 설치 당일 또는 다음 날 (현장 결정)
재질  엔지니어드 스톤 · 색 TOP-SNW (업체 코드 …) · 두께 20T (스톤 12 · 20)
형상  ㄱ자 — 평면 치수도 (외곽 2,400 × 2,000, 깊이 600 · 벽쪽 표시)        ← 아이소메트릭과 같은 _place 로 그린 평면
타공  ① 싱크볼  좌측 끝에서 중심 1,000 · 모델 ○○ 타공 760 × 440 R10
      ② 쿡탑    좌측 끝에서 중심 2,000 · 모델 ○○ 타공 560 × 490
      ③ 수전    싱크볼 뒤 중앙 · 지름 [확인 필요]
뒷턱(백가드) 있음 · 높이 ○○    앞턱(등뜨기) 있음 · 높이 ○○    물끊기 있음    옆면 마감: 좌 벽 · 우 노출
이음  업체 판단 (외곽 치수만 준다) · 치수는 도면 치수로 확정 (실측 없이 바로 발주)
```

필요한 일:
1. **재질 3종** — 품목 사양에 `topMaterial` (인조대리석 · 엔지니어드 스톤 · 세라믹)과 재질별 두께 선택지. BOM 상판 행의 재질·두께가 그것을 따른다 (BOM · Design UI 도메인).
2. **타공 위치** — 개수대(`name '개수대'` / sink 구간)·쿡탑(`type 'cook'`) 모듈의 자리(`_x` · `_place`)로 상판 좌측 끝 기준 중심을 계산. 볼·쿡탑 규격은 모델 입력이 없으면 "[확인 필요]".
3. **평면 형상** — 코너 품목은 `_place` 로 평면 외곽을 그린다 (#780 아이소메트릭과 같은 자리 데이터).
4. 꾸러미 `top` · Step 4 카드 · 발주 처리(§2.1) · 보관함 색인.

---

## 3. 데이터 [결정]

### 3.1 표 `work_reports` (`database/work-reports.sql`, 멱등)

```
id            uuid PK
owner_id      uuid  → auth.users   -- 보고의 주인(대표 계정). production_* · designs 의 user_id 와 같다
kind          text  CHECK (위 9종)
title         text                 -- "생산 계획 — 10/19(월) 새 수주 DD-…" 처럼 목록에 그대로
period_start  date                 -- 보고가 다루는 기간 (아침 요약 = 그날, 계획 = 첫~마지막 작업일, 월 = 월초~월말)
period_end    date
status        text                 -- 원천 상태 사본: pending/approved/dismissed/superseded · issued/stale · sent/failed
source_table  text                 -- 'production_proposals' | 'design_documents' | null
source_id     uuid                 -- 원본 행
order_ids     uuid[]               -- 관련 수주 (검색·필터)
design_ids    uuid[]
metrics       jsonb                -- 목록 숫자 (2절 표 마지막 열)
body          jsonb                -- 동결 내용 (작업지시서는 색인만)
note          text                 -- 관리자 메모 (수정 가능한 유일한 본문 필드)
pinned        boolean default false
archived_at   timestamptz          -- '보관 처리' (목록 기본에서 숨김, 지우지 않는다)
created_by    uuid                 -- 승인자 · 메모 작성자 (자동 생성은 null)
created_at    timestamptz default now()
UNIQUE (kind, source_id)           -- 같은 원본을 두 번 담지 않는다 (백필·재시도 멱등)
INDEX (owner_id, created_at DESC), (kind, created_at DESC), GIN(order_ids)
```

- **추가 전용** — body·metrics 는 만든 뒤 바꾸지 않는다. 바뀌는 것은 `note · pinned · archived_at` 과 원천 상태 사본 `status` 뿐(제안이 나중에 superseded 되면 따라 바꾼다).
- 지우지 않는다 [확인 필요 Q2: 보관 기간].

### 3.2 권한 (RLS)
- SELECT: `owner_id = auth.uid()` **또는** `public.is_admin()`.
- INSERT/UPDATE/DELETE: 클라이언트 금지 — 워커(service_role)만. 관리자 화면의 메모·고정·보관도 워커 경로로 간다 (변경 기록을 한곳에).

### 3.3 백필
- `production_proposals` 전부 → `production_plan` (상태 그대로). approved 인 것은 그날 만든 `production_assignments` 로 `staffing_decision` 도 함께 (고른 인덱스는 옛 행엔 없으니 "지시 행으로 재구성" 표시).
- `design_documents` 중 work_order · installation_order → 색인 행.
- 아침 요약·월 마감은 과거분이 없다 — 지난 달 월 마감만 지금 계산해 한 건 넣는다(표시: "백필 — 마감 당시 숫자 아님").

---

## 4. 워커 [결정] (`workers/workflow-api/src/reports/`)

| 파일 | 일 |
|---|---|
| `record.js` | 종류별 순수 빌더 `reportFromProposal · reportFromDecision · reportFromDailyBrief · reportFromDocument · reportFromMonth` → 행 (title · period · metrics · body) |
| `service.js` | `recordReport(env, row)` — upsert on (kind, source_id), 실패해도 원래 흐름을 막지 않는다 (waitUntil + 경고 로그) · `listReports` · `getReport` · `updateReportMeta` · `backfill` |
| `admin.js` | `assertAdmin(env, user)` — service_role 로 `admin_roles` 에서 user_id 조회 (워커 첫 관리자 검사). 결과 60초 캐시 |
| `templates/report-print.js` | 생산 계획 · 승인 · 아침 요약 · 월 마감의 A4 인쇄 HTML (작업지시서는 기존 인쇄로 넘긴다). 날짜별 부하 막대 · 추천 표 · 지시 표 |

기록 지점 (한 줄씩 덧붙임):
- `production/service.js proposePlan` → production_plan · 이전 pending 의 status 동기화
- `decideProposal` → staffing_decision (이제 `selected[]` · 승인자 저장)
- `dailyBrief` → daily_brief (Slack 블록 원문 포함, 보낸 결과)
- `documents.js issueDocument` (work_order · installation_order) → 색인 행, supersede 때 status 동기화
- cron: 매월 1일 → monthly_close (기존 07시 크론에서 날짜 판정)

경로:
| 경로 | 권한 | 일 |
|---|---|---|
| `GET /reports?kind=&from=&to=&status=&order=&q=&pinned=&archived=&page=` | 본인 · 관리자는 `&owner=all` | 목록 (metrics 까지, body 없이) |
| `GET /reports/:id` | 본인 · 관리자 | 한 건 (body 포함) |
| `GET /reports/:id/print` | 본인 · 관리자 | A4 HTML — 작업지시서는 `/documents/:id/print?pack=` 로 넘김 |
| `PATCH /reports/:id` | 본인 · 관리자 | `note · pinned · archived` 만 |
| `POST /reports` | 관리자 | 메모 보고(`note`) |
| `POST /admin/reports/backfill` | 관리자 | 3.3 백필 (멱등) |
| `GET /production/proposals?status=&from=` | 본인 | 덤 — production.html 에서도 지난 제안 목록 |

CORS 는 이미 PUT·DELETE 까지 허용 (#761). PATCH 포함.

---

## 5. 관리자 화면 [결정]

### 5.1 새 카테고리 `admin/work-reports.html` — 「📑 작업 지시 보고」
틀은 `admin/logs.html`(기간 필터 · 페이지 넘김) + `consultations.html`(상세 모달) + 게이트는 `dataset.html` 의 `AdminAccess` 방식. HTML 은 전부 `esc()` 로 이스케이프한다 (기존 admin 페이지의 innerHTML 취약점을 따라가지 않는다).

```
┌ 작업 지시 보고 ──────────────────────────────── 총 128건 ┐
│ [이번 주 지시 14] [미결 제안 1] [지연 주문 2] [이번 달 추가 인건비 60만] │  ← KPI 카드 4
├───────────────────────────────────────────────────────────┤
│ 종류 탭: 전체 · 생산 계획 · 인력 승인 · 아침 요약 · 작업지시서 · 설치 · 외주 발주 · 상판 발주 · 월 마감 · 메모 │
│ 기간 [2026-09-18]~[2026-10-18]  상태 [전체▾]  주문/고객 [   ]  ☐ 보관 포함  [검색] │
├───────────────────────────────────────────────────────────┤
│ 📌 10/19 월 생산 계획 — 새 수주 DD-…   주문 4 · 지연 2→0 · +20만   [승인됨]  │
│    10/19 월 인력 승인 — 조립 일당 +1(10/21) · 알바 연장 2h   지시 3 · 20만     │
│    10/19 월 아침 요약 — 재단 82% · 엣지 104% · 조립 2명   지시 2 · 지연 1   │
│    10/18 일 작업지시서 DD-…-WO-r2 — 원판 6 · 라벨 38           [최신]  │
│ …                                              ‹ 1 / 7 ›   │
└───────────────────────────────────────────────────────────┘
```

상세(모달 · 넓은 판):
- 생산 계획: 날짜별 부하 막대(재단/엣지/조립 · 용량선), 주문별 일정(마감 · 끝 · 지연), 추천 표, 도어 발주 마감. 버튼 [production.html 에서 열기] (pending 일 때 승인으로 이어짐).
- 인력 승인: 고른 추천 · 만들어진 지시와 **지금 상태**(instructed/done/cancelled — 원천에서 살아 있는 값을 같이 보여 준다).
- 아침 요약: Slack 으로 나간 그대로 + 보낸 결과.
- 작업지시서: 꾸러미 버튼 6개(재단·엣지 · 의뢰서 · 조립 · 도어재 · 라벨 · 전체) → 기존 인쇄.
- 공통: 메모 편집, 📌 고정, 보관 처리/되돌리기, [인쇄 · PDF 저장].

### 5.2 사이드바
- 11개 admin 페이지 사이드바에 `<li><a href="work-reports.html"><span class="nav-icon">📑</span>작업 지시 보고</a></li>` 를 **활동 로그 앞**에 넣는다.
- 손대는 김에 사이드바를 맞춘다: 5개 페이지에 빠진 「시공사례 관리」 링크, appliances 의 다른 로고 마크업. 시험(`reference-images.test.js` 사이드바 검사)에 "작업 지시 보고 링크가 모든 페이지에 정확히 1개"를 더한다.
- (선택 · 별도 PR) 사이드바를 `js/admin-shell.js` 한 파일로 — 지금 같은 복사 11벌을 없앤다 [확인 필요 아님, 규모 판단 — 5절 마지막 PR].

### 5.3 대시보드(`admin/index.html`) 위젯
「최근 작업 지시 보고」 카드 — 최근 5건 + 미결 제안 배지, 클릭하면 보관함 그 행.

### 5.4 기존 화면 연결
- `production.html` 상단에 [보관함] 링크 + 지난 제안 목록(`GET /production/proposals`).
- `erp.html` 수주 상세에 "이 주문의 보고" (order_ids 필터 링크).

---

## 6. PR 순서

| # | 브랜치 | 도메인 | 내용 | 시험 |
|---|---|---|---|---|
| 1 | `agent/workflow-reports-db` | DB | `database/work-reports.sql` (표 · 인덱스 · RLS · 멱등) — **사장님이 Supabase 에서 실행** | SQL 정적 검사 (멱등 구문 · RLS · CHECK) |
| 2 | `agent/workflow-reports-api` | Workflow | `reports/` 빌더 · 서비스 · `assertAdmin` · 경로 · 기록 지점 5곳 · 인쇄 템플릿 · 백필 · 제안 목록 | 빌더 골든 · 권한(본인/관리자/타인 403) · 멱등 upsert · 기록 실패가 원래 흐름을 막지 않음 |
| 3 | `agent/admin-work-reports` | Admin | `admin/work-reports.html` · 사이드바 11벌 · 대시보드 위젯 | jsdom: 게이트 · 목록 · 필터 · 상세 · 메모 · 이스케이프 · 사이드바 |
| 4 | `agent/workflow-reports-monthly` | Workflow | 월 마감 cron · production.html/erp.html 연결 | 월 경계 · 근무일 |
| 5 | `agent/workflow-outsource-orders` | Workflow + Design UI | 외주 발주 내역 §2.1 — Step 4 [발주 처리] · 입고 처리 · 아침 요약 도어 발주 경고 연동 | 발주/입고 상태 · 중복 발주 경고 |
| 6 | `agent/bom-countertop-material` → `agent/workflow-countertop-order` | BOM · Design UI → Workflow · Admin | 상판 발주 요청서 §2.2 · §8.1 — 재질 3종·두께 · 뒷턱/앞턱/물끊기/옆면 사양 → `appliance_models` 타공 칸 + 관리자 입력 · 개수대/쿡탑 모델 선택 → 꾸러미 `top`(형상 · 타공 위치·크기) · 재질별 업체 · 발주 마감(설치 − 4일) 추천 | 재질별 BOM 상판 행 · 타공 중심/크기 · 코너 형상 · 마감 계산 · 금액·고객명 없음 |
| 7 (선택) | `agent/admin-shell` | Admin | 사이드바 공용화 · ADMIN_EMAILS 하드코딩 5곳 → AdminAccess · appliances `superadmin` 오타 | 사이드바 시험 |

1 → 2 → 3 순서 (2 가 라이브여야 3 이 동작). 6 은 §8.1 결정(2026-10-18)대로 간다 — 재질·두께가 BOM 값을 바꾸므로 BOM 골든 절차를 따른다. 2·4 는 워커라 **머지 후 배포 런 확인**. 1 은 SQL 실행 전엔 워커가 표 없음 경고만 남기고 원래 흐름은 그대로 간다(기록 실패 무시).

---

## 7. 판정

1. 새 수주 하나를 넣으면 보관함에 생산 계획 1건, 승인하면 인력 승인 1건, 다음 근무일 07시에 아침 요약 1건이 **저절로** 생긴다.
2. 같은 제안·문서를 두 번 기록해도 1건 (UNIQUE). 백필을 두 번 돌려도 같다.
3. 관리자 아닌 계정은 남의 보고를 못 본다 (워커 403 · RLS).
4. 보고 기록이 실패해도(표 없음 · DB 오류) 제안·승인·발행·Slack 은 그대로 된다.
5. 생산 계획 보고를 열면 그때의 부하·추천이 보인다 — 이후 설정·주문이 바뀌어도 그대로다 (동결).
6. 모든 admin 페이지 사이드바에 「작업 지시 보고」가 정확히 1개.

---

## 8. 사장님 결정 (2026-10-18 채팅 선택)

| # | 질문 | 결정 |
|---|---|---|
| Q1 | 누가 보나 | **관리자 전원** (admin_roles) — 메모·보관 처리는 admin 이상 |
| Q2 | 보관 기간 | **영구** — 지우지 않고 '보관 처리'로 숨김만 |
| Q3 | 아침 요약 저장 | **매일 저장** (근무일마다 1건) |
| Q4 | 월 마감 | **매월 1일 자동** |
| Q5 | PDF 파일 보관 | **아니오** — 동결 데이터로 언제든 같은 인쇄 |
| Q6 | 종류 | 7종 + **외주 발주 내역** + **상판 발주 요청서(인조대리석 · 엔지니어드 스톤 · 세라믹)** — §2.1 · §2.2 |

### 8.1 상판 발주 요청서 — 사장님 결정 (2026-10-18 채팅 선택)

| # | 질문 | 결정 | 반영 |
|---|---|---|---|
| Q7 | 재질별 업체 | **재질마다 다르다** | 생산 설정에 재질별 상판 업체(인조대리석 · 엔지니어드 스톤 · 세라믹) — 발주 처리의 업체 기본값 |
| Q8 | 두께 | 인조대리석 **12 · 50T**, 엔지니어드 스톤 **12 · 20T**, 세라믹 **12T** | 사양 `topMaterial` 에 따라 두께 선택지가 바뀐다 · BOM 상판 행 재질·두께 |
| Q9 | 요청서 항목 | **뒷턱(백가드) · 앞턱(등뜨기) · 물끊기 · 옆면 마감** 모두 | 품목 사양에 네 항목(유무 · 높이 · 좌/우 노출) → 요청서 칸 |
| Q10 | 타공 규격 | **모델 입력** | `appliance_models`(이미 sink · cooktop 종류가 있다)에 타공 칸 `cutout_w_mm · cutout_d_mm · cutout_r_mm` 추가, 관리자 가전 모델 화면에서 입력. 설계에서 개수대 · 쿡탑 모듈에 모델을 고르면 요청서에 크기, 안 고르면 "[확인 필요] 모델 미지정". 수전 타공 지름은 [확인 필요] |
| Q11 | 납기 | **상판은 설치 당일 또는 다음 날 시공 중에 정한다 — 주문은 최소 4일 전** | 발주 마감 = 설치일 − 4일. 생산 계획의 `door_order` 와 같은 방식으로 `top_order` 마감 추천 · 아침 요약 경고 ("상판 발주 마감 D-n"). 요청서 머리에 "시공일: 설치 당일 또는 다음 날(현장 결정)" |
| Q12 | 발주 시점 | **도면 치수로 바로 발주** | 실측 후 확정 칸 없음 — 작업지시서 발행 때 요청서 치수가 확정 치수 |

남은 [확인 필요]: "최소 4일 전"이 달력 날인지 근무일인지 (기본: 달력 4일), 수전 타공 지름, 뒷턱 · 앞턱 기본 높이.
