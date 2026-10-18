# 관리자 대시보드 「작업 지시 보고」 보관함 (울트라플랜)

> 작성: 2026-10-18 / 기준 커밋: `cb878b8` (origin/main)
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
| `note` | 메모 보고 | 관리자가 직접 | 제목 · 본문 · (선택) 첨부 | — |

- 작업지시서는 **본문을 복사하지 않는다** — 이미 `render_payload` 로 동결돼 있으니 보관함 행은 색인(가리키는 표)이다. 인쇄는 기존 `/documents/:id/print?pack=` 를 그대로 연다.
- 생산 계획·아침 요약·월 마감은 원본이 없거나(요약·월) 덮어쓰이는 원천(설정·실시간 계산)에서 나오므로 **내용을 통째로 동결**한다.

---

## 3. 데이터 [결정]

### 3.1 표 `work_reports` (`database/work-reports.sql`, 멱등)

```
id            uuid PK
owner_id      uuid  → auth.users   -- 보고의 주인(대표 계정). production_* · designs 의 user_id 와 같다
kind          text  CHECK (위 7종)
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
│ 종류 탭: 전체 · 생산 계획 · 인력 승인 · 아침 요약 · 작업지시서 · 설치 · 월 마감 · 메모 │
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
| 5 (선택) | `agent/admin-shell` | Admin | 사이드바 공용화 · ADMIN_EMAILS 하드코딩 5곳 → AdminAccess · appliances `superadmin` 오타 | 사이드바 시험 |

1 → 2 → 3 순서 (2 가 라이브여야 3 이 동작). 2·4 는 워커라 **머지 후 배포 런 확인**. 1 은 SQL 실행 전엔 워커가 표 없음 경고만 남기고 원래 흐름은 그대로 간다(기록 실패 무시).

---

## 7. 판정

1. 새 수주 하나를 넣으면 보관함에 생산 계획 1건, 승인하면 인력 승인 1건, 다음 근무일 07시에 아침 요약 1건이 **저절로** 생긴다.
2. 같은 제안·문서를 두 번 기록해도 1건 (UNIQUE). 백필을 두 번 돌려도 같다.
3. 관리자 아닌 계정은 남의 보고를 못 본다 (워커 403 · RLS).
4. 보고 기록이 실패해도(표 없음 · DB 오류) 제안·승인·발행·Slack 은 그대로 된다.
5. 생산 계획 보고를 열면 그때의 부하·추천이 보인다 — 이후 설정·주문이 바뀌어도 그대로다 (동결).
6. 모든 admin 페이지 사이드바에 「작업 지시 보고」가 정확히 1개.

---

## 8. 사장님께 여쭐 것 [확인 필요]

| # | 질문 | 왜 | 기본값 |
|---|---|---|---|
| Q1 | 누가 보나? 대표만 / 관리자 전원(admin_roles 4역할) / manager 이상 | 워커·RLS 권한 | 관리자 전원 — 메모·보관은 admin 이상 |
| Q2 | 보관 기간? 영구 / N년 | 지우는 기능을 둘지 | 영구 (지우지 않고 '보관 처리'로 숨김만) |
| Q3 | 아침 요약을 매일 저장할까? (근무일마다 1건) | 건수가 가장 많다 | 저장 |
| Q4 | 월 마감 보고를 매월 1일 자동으로? | 4번 PR | 자동 |
| Q5 | PDF 파일로도 보관? (지금은 화면에서 인쇄 → PDF 저장) | 파일 저장소(버킷) 필요 | 아니오 — 동결 데이터로 언제든 같은 인쇄가 나온다 |
| Q6 | 종류(카테고리) 구성이 2절 7종이면 되나? 더 필요한 것(실측 작업 기록 · 외주 발주 내역 · 원가) | 탭 구성 | 7종 |
