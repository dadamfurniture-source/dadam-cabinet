# 작업자 포털 1주차 계약서 (데이터 · API · 화면)

- 정본 계획: `docs/01-plan/worker-portal.plan.md` (개정 사항 우선). 이 문서는 1주차 구현이 **서로 맞도록** 정한 계약이다 — 서버·화면 PR 은 이 문서를 따르고, 바꾸려면 이 문서를 먼저 고친다.
- 결정 (2026-10-20 사장님 "추천대로, ★5 는 가·나 둘 다"):
  - ★1 작업 종류 `install`(설치) · `as`(A/S) · `assembly`(조립 추가 인원). 월급 재단은 게시판에 올리지 않는다
  - ★3 가입: 초대 링크 + 공개 신청, **둘 다 사장님 승인** 전까지 `pending`
  - ★4 배정: 신청자 중 편집자가 선정 + 직접 지정(초대). 선착순 없음
  - ★5 (가) 작업자 보고 + (나) 회사 정정. 둘 다 같은 작업 기록에 **추가만** (덮어쓰기·삭제 없음)
  - ★6 금액: 작업마다 `pay_visible` (기본 숨김), 금액은 편집자가 매번 입력 (단가 자동 채움 없음)
  - ★15 공장 작업자 화면의 고객 실명·일당 문구 정리
  - 16 소유권: CLAUDE.md "Worker Portal" · "Site Auth" 행
  - 미정(이 주에는 쓰지 않음): ★7 주소 공개 기간 → **1주차는 현장 주소·연락처를 어디에도 내보내지 않는다**, 8 평가 항목·이의 기간, 9 필수 사진·보관 기간, 14 노쇼 규칙
- 공장 작업(`assembly`)은 "각자 스스로 검수"(work-order-stage.plan.md) → 검수 단계 없이 완료 보고로 끝난다. 검수(`review`)는 `install`·`as` 만.

## 1. 상태

| 대상 | 상태 | 비고 |
|---|---|---|
| `workers.status` | `pending` → `approved` / `rejected`, `approved` ↔ `suspended` | 초대로 와도 `pending` |
| `work_jobs.status` | `draft` → `open` → `filled` → `in_progress` → `review`(install·as) → `done` → `closed`, 어디서나(`done` 전) → `cancelled` | `expired` 는 **저장하지 않는다**: `open` 이고 `apply_deadline < now()` 면 API 가 `effective_status: 'expired'` 로 돌려준다 |
| `work_applications.status` | `applied` → `approved` / `rejected` / `withdrawn` | `UNIQUE(job_id, worker_id)` |
| `work_assignments.status` | 신청 승인 → `confirmed` · 직접 지정 → `offered` → `confirmed`/`declined` · `confirmed` → `started` → `submitted` → `accepted` (install·as 는 편집자 승인, assembly 는 완료 보고 즉시) · `submitted` → `revision` → `submitted` · `confirmed`/`started` → `released`(작업자 포기) · 편집자 → `removed`(no_show 표시 가능) | 활성 = `offered, confirmed, started, submitted, revision, accepted` 중 정원 계산은 `confirmed, started, submitted, revision, accepted` |

작업 상태 자동 전이 (서버가 배정 변화 뒤 다시 계산):
- `open`/`filled`: 정원 계산 수 = `slots` 이면 `filled`, 모자라면 `open` (`draft`·`cancelled` 이후는 건드리지 않음)
- 첫 `started` → `in_progress`
- 정원 계산 배정이 모두 `submitted`/`accepted` 이고 install·as 이면 `review`, 모두 `accepted` 면 `done` — 응답 없는 초대(`offered`)는 보지 않는다 (정원이 찬 뒤 남은 초대는 수락이 409 라 작업이 `in_progress` 에 갇힌다). 남은 초대를 저절로 정리하지는 않는다
- `closed` 는 편집자만

모든 전이는 `work_job_events` 에 한 줄 (`type`, `from_status`, `to_status`, `actor_kind`, `note`).

## 2. SQL — `database/work-jobs.sql` (멱등, BEGIN…COMMIT) + `database/work-jobs-rollback.sql`

규칙: `auth.users` FK 는 모두 `ON DELETE SET NULL` · `REVOKE ALL … FROM anon` · RLS 켬 · 정책은 `FOR SELECT TO authenticated USING (public.is_admin())` 하나 (쓰기 정책 없음, 쓰기는 Worker service_role) · 글자 수 CHECK · **주민번호·계좌 열 금지**.
예외: `worker_notes` 는 정책을 두지 않는다 — `is_admin()` 은 support·moderator 도 참이라 브라우저 anon 키 + 본인 JWT 로 메모를 읽을 수 있다. RLS 만 켜 두면 authenticated 는 못 읽고, 읽기는 API(편집자 검사 → service_role)로만.

```
workers            id uuid pk, user_id uuid unique null → auth.users, display_name text not null (≤30),
                   phone text null (≤30), kinds text[] not null default '{}' (각 원소 ∈ install|as|assembly),
                   region_label text null (≤40), status text not null default 'pending' (pending|approved|suspended|rejected),
                   consent_version text not null, consent_at timestamptz not null default now(), photo_consent bool not null default false,
                   approved_by uuid null, approved_at timestamptz null, reject_reason text null (≤200),
                   invited_via uuid null → worker_invites, last_seen_at timestamptz null, created_at, updated_at
worker_invites     id, token_hash text unique not null, kinds_preset text[], display_name_preset text null (≤30),
                   expires_at timestamptz not null, used_at null, used_by uuid null, created_by uuid null, created_at
worker_notes       id, worker_id → workers on delete cascade, author uuid null, note text not null (≤1000), created_at
work_jobs          id, kind text not null (install|as|assembly), status text not null default 'draft',
                   title text not null (≤80), detail text null (≤2000), region_label text null (≤40),
                   starts_at timestamptz null, ends_at timestamptz null, apply_deadline timestamptz null,
                   slots int not null default 1 check (slots >= 1), mode text not null default 'open' (open|invite|direct),
                   pay_amount int null check (>=0), pay_unit text null (day|hour|meter|job), pay_visible bool not null default false,
                   order_id uuid null, design_id uuid null, version int not null default 0,
                   cancel_reason text null (≤200), created_by uuid null, created_at, updated_at
                   -- 주소·연락처·고객 실명 열 없음
work_applications  id, job_id → work_jobs cascade, worker_id → workers cascade, status text default 'applied',
                   message text null (≤300), decided_by uuid null, decided_at null, decide_reason text null (≤200),
                   created_at, unique(job_id, worker_id)
work_assignments   id, job_id → work_jobs cascade, worker_id → workers cascade, application_id null → work_applications set null,
                   via text not null (application|invite), status text not null, started_at, submitted_at, accepted_at,
                   revision_count int default 0, no_show bool default false, release_reason text null (≤200),
                   worker_name_snapshot text null (≤30), created_by uuid null, created_at, updated_at
                   partial unique (job_id, worker_id) where status in (offered,confirmed,started,submitted,revision,accepted)
work_updates       id, job_id → work_jobs cascade, assignment_id null → work_assignments set null,
                   author_user_id uuid null, author_role text not null (worker|company),
                   kind text not null (progress|issue|result|correction|note), body text not null (≤1000),
                   issue_chips text[] default '{}', amends_id uuid null → work_updates set null,
                   visible_to_worker bool not null default true, created_at   -- 추가만
work_photos        id, update_id null → work_updates, job_id, assignment_id, path text not null, bytes int, width int, height int,
                   uploaded_by uuid null, committed_at null, created_at          -- 2주차에 사용 (표만 미리)
work_reviews       id, assignment_id → work_assignments cascade, direction text (company_to_worker|worker_to_company),
                   reviewer_id uuid null, score int null (1–5), reason_chips text[], comment text null (≤500),
                   status text default 'draft' (draft|published), published_at, reply text null (≤500),
                   objection text null (≤500), objection_at, resolved_at, frozen_at, created_at, unique(assignment_id, direction)
                   -- 2주차에 사용 (표만 미리)
work_job_events    id, job_id → work_jobs cascade, assignment_id null, actor_user_id uuid null,
                   actor_kind text not null (worker|admin|system), type text not null, from_status text null, to_status text null,
                   note text null (≤300), payload jsonb not null default '{}', notified_at null, created_at   -- 추가만, 개인정보 없음
```

## 3. API — `workers/workflow-api/src/work/*`, 라우트는 `src/worker.js` 에 `auth:'jwt'`

공통:
- 경로 id 가 UUID 가 아니면 **422**. 남의 행·없는 행은 **404** (403 아님). 표가 아직 없으면(`isMissingRelation`) 목록은 빈 결과, `/work/me` 는 `{ ready:false }`.
- 개인정보가 담길 수 있는 응답은 `Cache-Control: no-store`.
- 작업자 라우트: 호출자의 `workers` 행이 `approved` 여야 한다 (`/work/me`, `/work/register`, `/work/claim-invite` 제외) — 아니면 403.
- 관리자 라우트: 읽기 `isAdmin`, 쓰기 `assertAdminEditor` (super_admin·admin). `worker_notes` 는 편집자만 읽는다 (support·moderator 제외).
- 상태 바꾸는 쓰기는 `work_jobs.version` 낙관적 잠금 (`updateBy(… id=eq.X&version=eq.N)` 결과가 비면 409).
- Slack(`postToWebhook`, 실패해도 요청은 성공): 작업자 가입 신청, 작업 신청·철회, 배정 거절·포기, 완료 보고, 문제 보고. 문구에 **고객 이름·주소·연락처·금액 없음** — 작업 종류·제목·작업자 표시 이름·관리자 화면 링크만.

### 작업자

| 메서드 · 경로 | 요청 | 응답 (`data`) |
|---|---|---|
| `GET /work/me` | – | `{ ready, worker: null \| WorkerSelf, counts: { open, mine, revision, newEvents } }` |
| `POST /work/register` | `{ display_name, phone?, kinds[], region_label?, consent_version, photo_consent }` | `WorkerSelf` (`pending`). 이미 행 있으면 409 |
| `POST /work/claim-invite` | `{ token }` | `WorkerSelf` (`pending`, 프리셋 적용). 만료·사용됨 410, 이미 작업자면 409 |
| `GET /work/jobs?tab=open\|mine\|done` | – | `{ items: JobCard[] }` — open: `open` 이고 마감 전, 내 `kinds` 에 맞는 것. mine: 내 활성 배정. done: 끝난 내 배정 |
| `GET /work/jobs/:id` | – | `JobDetail` — 모집중 작업이거나 내 신청·배정이 있는 작업만, 아니면 404 |
| `POST /work/jobs/:id/apply` | `{ message? }` | `Application`. 중복 409, 모집 아님·마감·종류 불일치 409 |
| `POST /work/applications/:id/withdraw` | – | `Application` (`applied` 만) |
| `POST /work/assignments/:id/confirm` · `decline` | `{ reason? }` | `Assignment` (`offered` 만) |
| `POST /work/assignments/:id/start` | – | `Assignment` (`confirmed` 만) |
| `POST /work/assignments/:id/release` | `{ reason }` (필수) | `Assignment` (`confirmed`·`started`) |
| `POST /work/assignments/:id/updates` | `{ kind: progress\|issue\|result, body, issue_chips? }` | `Update`. `result` 는 `started`·`revision` 에서 `submitted`(assembly 는 바로 `accepted`). `progress`·`issue` 는 작업이 `closed`·`cancelled` 가 아니면 언제든 (★5 가 — 끝난 뒤 추가 보고 포함) |

### 관리자

| 메서드 · 경로 | 요청 | 응답 |
|---|---|---|
| `GET /work/admin/jobs?status=` | – | `{ items: AdminJobCard[] }` (신청 수, 확정 수/정원, 다음 날짜) |
| `POST /work/admin/jobs` | `{ kind, title, detail?, region_label?, starts_at?, ends_at?, apply_deadline?, slots, mode, pay_amount?, pay_unit?, pay_visible?, order_id?, design_id? }` | `AdminJob` (`draft`) |
| `PATCH /work/admin/jobs/:id` | 위 필드 일부 + `version` | `draft`·`open` 만 |
| `POST /work/admin/jobs/:id/publish` | – | `draft` → `open` (종류·제목·정원 필수) |
| `POST /work/admin/jobs/:id/cancel` | `{ reason }` | `done` 전만 |
| `POST /work/admin/jobs/:id/close` | – | `done` → `closed` |
| `GET /work/admin/jobs/:id` | – | `AdminJobDetail`: 작업 + 신청 목록(작업자 표시 이름·종류·지역·실적 건수) + 배정 + 기록 전부 + 이벤트 |
| `POST /work/admin/jobs/:id/invite` | `{ worker_id }` | `Assignment` (`offered`, via `invite`). 승인 작업자만, 종류 맞아야 |
| `POST /work/admin/applications/:id/approve` · `reject` | `{ reason? }` | approve → 배정 `confirmed` (정원 넘으면 409) |
| `POST /work/admin/assignments/:id/accept` | – | `submitted` → `accepted` (install·as) |
| `POST /work/admin/assignments/:id/revision` | `{ reason }` (필수) | `submitted` → `revision` |
| `POST /work/admin/assignments/:id/remove` | `{ reason, no_show? }` | → `removed` |
| `POST /work/admin/jobs/:id/updates` | `{ kind: correction\|note, body, assignment_id?, amends_id?, visible_to_worker }` | `Update` (★5 나 — 회사 정정. 원본은 그대로) |
| `GET /work/admin/workers?status=` | – | `{ items: WorkerAdmin[] }` |
| `PATCH /work/admin/workers/:id` | `{ status?, kinds?, reject_reason? }` | 승인·반려·정지·종류 지정 |
| `GET /work/admin/workers/:id/notes` · `POST` `{ note }` | – | 편집자만 |
| `POST /work/admin/invites` | `{ kinds_preset[], display_name_preset?, expires_at }` (만료일은 편집자가 고른다) | `{ id, url, expires_at }` — 토큰은 응답에만, DB 에는 `pepperedHash(SHARE_TOKEN_PEPPER, 'worker-invite', token)` |

### 응답 모양 (작업자에게 가는 것은 `src/work/reveal.js` 한 곳에서 깎는다)

- `WorkerSelf`: `{ id, status, display_name, phone, kinds, region_label, photo_consent, consent_version, reject_reason }`
- `JobCard`: `{ id, kind, title, region_label, starts_at, ends_at, apply_deadline, slots, filled, effective_status, pay?: { amount, unit } (pay_visible 일 때만), my: { application_status?, assignment_id?, assignment_status? } }`
- `JobDetail`: `JobCard` + `{ detail, order_no?, customer_masked?, site: null, site_note, timeline: Update[] (visible_to_worker 만, 내 배정 관련 + 작업 전체 회사 공지) }`
  - `order_no`·`customer_masked`(maskName) 는 **내 배정이 활성일 때만**. `site` 는 1주차 항상 `null`, `site_note: '현장 주소·연락처는 공개 기간이 정해지면 열립니다'`
  - 다른 작업자의 이름·신청·메모는 없다
- 관리자 응답에는 전부 (단, 1주차에도 현장 주소는 이 API 에서 내보내지 않는다 — 기존 현장 정보 화면에서 본다)
- 금지 키 (작업자 응답에 절대 없음, 시험으로 고정): `address`, `phone`(작업자 본인 것 제외), `customer_name`, `cost`, `margin`, `note`(관리자 메모)

## 4. 화면

| 파일 | 소유 | 내용 |
|---|---|---|
| `admin/work-jobs.html` | Worker Portal | 보드 탭(초안·모집중·배정·진행·검수대기·완료 열, 카드: 날짜·종류·시구·확정 n/정원·신청 수), 작업 만들기 서랍(주소·연락처 칸 없음), 작업 상세(신청자 선정, 초대, 배정 승인·보완요청·제외, 기록 타임라인, 회사 정정·메모 입력 + 작업자에게 보이기 체크), 작업자 탭(대기 승인·반려·정지·종류, 초대 링크 발급(만료일 선택) + 복사, 메모), [카톡으로 공유]은 Web Share 없으면 복사 |
| `js/admin-shell.js` | (공용) | `ADMIN_NAV` 에 `{ href:'work-jobs.html', icon:'🧰', label:'작업 배정' }` 한 줄 — 관리자 페이지 `?v=` 모두 올림 |
| `worker.html` + `js/worker-portal.js` | Worker Portal | 상태별 화면: 미로그인 → 로그인 안내(카카오 먼저, `login.html?redirect=worker.html…`) / 미등록 → 작업자 신청서(동의 항목 나열, 사진 동의 따로, 주민번호·계좌 받지 않음) / `pending` → 대기 / `approved` → 탭(모집중·내 작업·완료·내 정보). 작업 상세 `worker.html#job=<id>`, 초대 링크 `worker.html#invite=<token>` (토큰은 sessionStorage 에 보관해 로그인 왕복 뒤 사용). 560px 열, 16px 이상 글자, 전체 폭 버튼, `noindex`·`no-referrer` |
| `js/mypage-work.js` + `mypage.html` `#myWorkSection` | Worker Portal (그 섹션) | `/work/me` 가 작업자 행을 주면 요약 카드(예정·보완요청·새 소식, 다음 작업 한 줄, [작업자 페이지 열기]), 아니면 숨김. `ready:false` 도 숨김 |
| 모든 화면 | – | 사용자 입력은 `esc()` 로 출력, API 주소·토큰은 기존 화면(production.html)과 같은 방식 |

## 5. 로그인 (Site Auth, PR0)

- `login.html` 리다이렉트: 같은 사이트 상대 경로 `*.html`(+ `?…`·`#…`)만 허용, `javascript:`·`//`·`http(s)://` 는 `index.html`
- OAuth `redirectTo` 가 원래 리다이렉트를 유지 (`login.html`, `signup.html`)
- `login.html` 에 카카오 버튼
- 카카오톡 인앱 브라우저(UA `KAKAOTALK`)에서 "외부 브라우저로 열기" 안내
- `admin/users.html` 이름·이메일 이스케이프
- 사장님 할 일: Supabase Auth Redirect URLs 에 `worker.html` 경로 추가, 카카오 공급자 이메일 제공 설정 확인

## 6. 시험 (완료 기준)

- 서버 `workers/workflow-api/test/work.test.js` (node --test): 대기 작업자 신청 403 · 중복 신청 409 · 정원 초과 승인 409(버전 경쟁) · 남의 배정 404 · 잘못된 UUID 422 · 작업자 응답에 금지 키 없음 · `pay_visible=false` 면 금액 없음 · 초대 1회용·만료 410 · 고객이 `/work/admin/*` 403 · support 역할이 메모 403 · Slack 문구에 주소·실명·금액 없음 · assembly 완료 보고는 바로 accepted · 회사 정정 후 원본 행 그대로 · `closed` 작업에 보고 409
- SQL `__tests__/work-jobs-sql.test.js` (jest): 멱등 구문 · 쓰기 정책 없음 · 정책이 `is_admin()` 만 (`worker_notes` 는 정책 없음) · auth FK SET NULL · 주민·계좌 열 없음 · anon REVOKE · 글자 수 CHECK · rollback 파일이 모든 표를 역순 DROP
- 화면: `html-validate`·`linkinator` 통과, 렌더 함수 jest(이름에 `<script>` → 글자), 375px 가로 스크롤 없음(수동 확인 절차 PR 에 기록)
