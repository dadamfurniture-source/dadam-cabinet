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

## 1주차 후속 (2026-10-20)

사장님: "추천대로 진행하고, 지원 종료일도 설정하고 표시 되도록 해줘". 1주차 코드(#945 #946 #947 #949 #954) 위에 얹는 결정이다 — 아래 본문(§1–§4)도 이 절에 맞춰 고쳤고, 둘이 다르면 이 절이 우선한다.

| | 결정 | 담당 PR |
|---|---|---|
| 0 지원 종료일 | 이미 있는 `work_jobs.apply_deadline`(선택)의 화면 이름을 **"지원 종료일"** 로. "신청 마감" 글자는 모두 "지원 종료일", `effective_status: 'expired'` 의 화면 이름은 **"지원 종료"** (관리자 보드 "마감 (신청 마감 지남)" 칸도 "지원 종료"). 작업 상태 `closed` 의 "마감/닫힘" 표현은 그대로. 설정은 관리자 작업 만들기·고치기 폼(`jDeadline`, datetime-local, KST), 필수 아님 — 빈 칸 도움말 "비워 두면 정원이 찰 때까지 받습니다", 지난 시각은 막지 않고 경고 "지원 종료일이 이미 지났습니다 — 게시하면 바로 '지원 종료'로 보입니다". 지원 종료된 작업도 지원 종료일을 뒤로 고치면 다시 모집중 (서버는 이미 `open` 작업 PATCH 를 허용). 표시는 KST `10/25(토) 18:00`, 꼬리표는 KST 날짜 기준 `D-n`(n≥1) · 같은 날이고 아직 전이면 "오늘 종료" · 지났으면 "지원 종료". 서버 409 문구 **"지원 종료일이 지났습니다"**. 새 검증 규칙은 만들지 않는다 (시작일보다 늦어도 막지 않음) | S(서버 문구) · W1 · W2 |
| A 관리자 화면 XSS | `admin/consultations.html` · `admin/logs.html` · `admin/expert-requests.html` 외 `admin/*.html`(work-jobs 제외) · `js/admin-*.js` 에서 DB 값이 HTML · 속성 · 인라인 onclick 에 들어가는 곳을 막는다. `admin_logs` 의 `"System can insert logs"`(WITH CHECK true) 정책을 지우고 쓰는 트리거 함수를 SECURITY DEFINER 로 — `database/fix-admin-logs-insert-policy.sql` | X |
| B 마이페이지 다음 작업 | `GET /work/me` 응답에 `next_job: JobCard \| null` (승인·정지 작업자). 고르는 규칙 = `js/mypage-work.js` `pickNextJob`: 내 작업 탭 배정의 작업 중 보완요청 먼저, 아니면 KST 오늘 이후 시작일이 가장 이른 것, 아니면 내 작업 탭 첫 줄(시작일 오름차순, 없는 것은 뒤). **읽음 처리(`last_seen_at`)는 건드리지 않는다.** 마이페이지는 `/work/me` 하나만 부른다 | S · W2 |
| C 닫기·취소 때 남은 초대 | 정원 계산 배정이 다 보고하면 review/done 은 그대로 (응답 없는 초대는 보지 않는다). 추가: 닫기(`done→closed`)·취소(`→cancelled`)가 성공하면 그 작업의 `offered` 배정을 모두 `declined` 로 — `release_reason` 닫기 "작업이 마감돼 초대가 끝났습니다" · 취소 "작업이 취소돼 초대가 끝났습니다", 배정마다 이벤트 `assignment_auto_declined`(system, offered→declined, note 같은 문구, payload `{ worker_id, reason: 'job_closed' \| 'job_cancelled' }`), 응답에 `auto_declined: 건수`. 확정·진행 중 배정과 대기 신청은 건드리지 않는다. 겹친 수락·거절·제외·초대로 정리에서 빠진 초대는 서버가 작업을 다시 읽어 끝내고, 정리 쓰기가 실패하면 같은 닫기·취소를 다시 불러 정리만 할 수 있다 (§1). 관리자 확인 문구에 응답 없는 초대 수, 작업자 지난 작업 탭에 `release_reason` | S · W1 · W2 |
| D 정지된 작업자 | 새 신청·수락만 막고 지난 기록은 보이게 (§3 표). 관리자 초대·신청 승인은 승인 작업자만 (정지·대기·반려 모두 409 "정지된 작업자는 배정할 수 없습니다"). `GET /work/admin/workers` 에 `active_count`. 관리자 정지 확인 문구 "정지하면 새 작업 신청·초대 수락을 못 합니다. 진행 중인 배정 N건은 그대로 남으니 필요하면 작업에서 제외하세요." (N=0 이면 뒷문장 생략). 작업자 화면은 맨 위 안내 "계정이 정지되어 새 작업 신청·수락을 할 수 없습니다. 지난 기록은 볼 수 있습니다.", 모집중 탭·신청·수락 버튼 숨김 | S · W1 · W2 |
| E 로그인 마무리 | 이메일 가입 `emailRedirectTo` = `login.html?redirect=<원래 목적지>`, 인앱 브라우저 안내를 카카오톡 밖(네이버·인스타그램·페이스북·라인·다음·밴드)으로 — `js/auth-redirect.js` `inAppBrowser` · `externalOpenUrl` | A1 |
| F 공장 작업자 예시 · 작업자 이력 | `production-worker.html` "다른 작업 기록" 예시를 고객 이름 대신 주문번호 + 품목으로. 새 표 `worker_events`(§2) — 가입 신청 · 상태 변경 · 종류 변경을 서버가 기록 (실패해도 요청은 계속), `GET /work/admin/workers/:id/events`, 관리자 작업자 탭 "이력". 관리자 상태 변경 409 는 한국어 상태 이름 ("'승인' 상태에서 '반려'(으)로 바꿀 수 없습니다") | S · W1(SQL · 화면) |

PR: **S 서버** `agent/workflow-work-followup` (`workers/workflow-api/src/work/**` · 라우트 · 시험, `production-worker.html`, 이 문서) · **W1 관리자 화면 + SQL** `agent/worker-admin-followup` · **W2 작업자 화면** `agent/worker-portal-followup` · **A1 로그인** `agent/auth-inapp-email` · **X 관리자 보안** `agent/admin-xss-sweep`.

## 1. 상태

| 대상 | 상태 | 비고 |
|---|---|---|
| `workers.status` | `pending` → `approved` / `rejected`, `approved` ↔ `suspended` | 초대로 와도 `pending`. **`suspended`(정지)는 새 작업 보기·신청·초대 수락만 막는다** — 지난 기록 보기와 진행 중인 일 정리(신청 철회, 초대 거절, 시작, 포기, 보고)는 된다. 관리자는 정지 작업자에게 초대·신청 승인 불가(409). 바뀔 때마다 `worker_events` 한 줄 |
| `work_jobs.status` | `draft` → `open` → `filled` → `in_progress` → `review`(install·as) → `done` → `closed`, 어디서나(`done` 전) → `cancelled` | `expired` 는 **저장하지 않는다**: `open` 이고 `apply_deadline`(지원 종료일) `< now()` 면 API 가 `effective_status: 'expired'` 로 돌려준다 — 화면 이름 **"지원 종료"**. 지원 종료일을 뒤로 고치면 다시 `open` |
| `work_applications.status` | `applied` → `approved` / `rejected` / `withdrawn` | `UNIQUE(job_id, worker_id)` |
| `work_assignments.status` | 신청 승인 → `confirmed` · 직접 지정 → `offered` → `confirmed`/`declined` · `confirmed` → `started` → `submitted` → `accepted` (install·as 는 편집자 승인, assembly 는 완료 보고 즉시) · `submitted` → `revision` → `submitted` · `confirmed`/`started` → `released`(작업자 포기) · 편집자 → `removed`(no_show 표시 가능) · 작업 닫기·취소 → 남은 `offered` 는 `declined`(system, `release_reason` 안내 문구) | 활성 = `offered, confirmed, started, submitted, revision, accepted` 중 정원 계산은 `confirmed, started, submitted, revision, accepted` |

작업 상태 자동 전이 (서버가 배정 변화 뒤 다시 계산):
- `open`/`filled`: 정원 계산 수 = `slots` 이면 `filled`, 모자라면 `open` (`draft`·`cancelled` 이후는 건드리지 않음)
- 첫 `started` → `in_progress`
- 정원 계산 배정이 모두 `submitted`/`accepted` 이고 install·as 이면 `review`, 모두 `accepted` 면 `done` — 응답 없는 초대(`offered`)는 보지 않는다 (정원이 찬 뒤 남은 초대는 수락이 409 라 작업이 `in_progress` 에 갇힌다)
- `closed` 는 편집자만
- **닫기(`closed`)·취소(`cancelled`)가 성공하면** 그 작업의 남은 `offered` 배정을 모두 `declined` 로 (1주차 후속 C). 확정·진행 중 배정과 대기 신청(`applied`)은 건드리지 않는다
  - 정리는 작업 잠금과 따로 하는 쓰기라 빠지는 초대가 생길 수 있어 두 길을 막는다: (1) 같은 순간의 수락·거절·제외가 작업 잠금에 져서 배정을 `offered` 로 되돌릴 때, 또는 초대를 넣는 사이 작업이 끝났을 때 — 작업을 다시 읽어 `closed`·`cancelled` 면 같은 문구·이벤트로 `declined` (2) 정리 쓰기가 DB 오류로 실패하면(작업은 이미 끝났는데 500) — 같은 닫기·취소를 다시 부르면 정리만 하고 `auto_declined` 를 돌려준다 (남은 초대가 없으면 원래대로 409)

모든 전이는 `work_job_events` 에 한 줄 (`type`, `from_status`, `to_status`, `actor_kind`, `note`). 작업자 가입 신청·상태 변경·종류 변경은 `worker_events` 에 한 줄.

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
worker_events      id uuid pk default gen_random_uuid(), worker_id uuid not null → workers on delete cascade,
                   actor_user_id uuid null → auth.users on delete set null, actor_kind text not null (worker|admin|system),
                   type text not null (≤40), from_status text null (≤20), to_status text null (≤20), note text null (≤300),
                   payload jsonb not null default '{}', created_at timestamptz not null default now()
                   -- 1주차 후속 F. 추가만, 이름·연락처·주소는 payload 에 넣지 않는다. 인덱스 (worker_id, created_at desc)
                   -- 정책은 work_job_events 와 같다 (FOR SELECT TO authenticated USING (public.is_admin()))
work_jobs          id, kind text not null (install|as|assembly), status text not null default 'draft',
                   title text not null (≤80), detail text null (≤2000), region_label text null (≤40),
                   starts_at timestamptz null, ends_at timestamptz null, apply_deadline timestamptz null (화면 이름 "지원 종료일"),
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

`worker_events` 에 서버가 쓰는 줄 (실패해도 요청은 계속 — 표가 아직 없으면 경고만):

| 요청 | `type` | `actor_kind` | `from` → `to` | `note` · `payload` |
|---|---|---|---|---|
| `POST /work/register` | `registered` | `worker` | – → `pending` | `{ via: 'public' }` |
| `POST /work/claim-invite` | `registered` | `worker` | – → `pending` | `{ via: 'invite', invite_id }` |
| `PATCH /work/admin/workers/:id` 상태 변경 | `status_changed` | `admin` | 이전 → 다음 | note = 반려 사유(반려일 때, 있으면) |
| `PATCH /work/admin/workers/:id` 종류 변경 | `kinds_changed` | `admin` | – | `{ kinds }` (같은 종류 묶음이면 줄 없음) |

## 3. API — `workers/workflow-api/src/work/*`, 라우트는 `src/worker.js` 에 `auth:'jwt'`

공통:
- 경로 id 가 UUID 가 아니면 **422**. 남의 행·없는 행은 **404** (403 아님). 표가 아직 없으면(`isMissingRelation`) 목록은 빈 결과, `/work/me` 는 `{ ready:false }`.
- 개인정보가 담길 수 있는 응답은 `Cache-Control: no-store`.
- 작업자 라우트: 호출자의 `workers` 행이 `approved` 또는 `suspended` 여야 한다 (`/work/me`, `/work/register`, `/work/claim-invite` 제외) — `pending`·`rejected`·미등록은 모든 작업자 라우트 403. `suspended` 는 아래 표의 **정지** 칸대로 (`src/work/access.js` 의 `requireWorker` · `requireApprovedWorker(action)`).
- 관리자 라우트: 읽기 `isAdmin`, 쓰기 `assertAdminEditor` (super_admin·admin). `worker_notes` 는 편집자만 읽는다 (support·moderator 제외).
- 상태 바꾸는 쓰기는 `work_jobs.version` 낙관적 잠금 (`updateBy(… id=eq.X&version=eq.N)` 결과가 비면 409).
- Slack(`postToWebhook`, 실패해도 요청은 성공): 작업자 가입 신청, 작업 신청·철회, 배정 거절·포기, 완료 보고, 문제 보고. 문구에 **고객 이름·주소·연락처·금액 없음** — 작업 종류·제목·작업자 표시 이름·관리자 화면 링크만.

### 작업자

| 메서드 · 경로 | 요청 | 응답 (`data`) | 정지(`suspended`) |
|---|---|---|---|
| `GET /work/me` | – | `{ ready, worker: null \| WorkerSelf, counts: { open, mine, revision, newEvents }, next_job: JobCard \| null }` — `next_job` 은 승인·정지 작업자의 다음 작업 (B 규칙, **읽음 처리 안 함**), 그 밖은 `null` | 허용, `counts.open = 0` |
| `POST /work/register` | `{ display_name, phone?, kinds[], region_label?, consent_version, photo_consent }` | `WorkerSelf` (`pending`). 이미 행 있으면 409 | – |
| `POST /work/claim-invite` | `{ token }` | `WorkerSelf` (`pending`, 프리셋 적용). 만료·사용됨 410, 이미 작업자면 409 | – |
| `GET /work/jobs?tab=open\|mine\|done` | – | `{ items: JobCard[] }` — open: `open` 이고 지원 종료일 전, 내 `kinds` 에 맞는 것. mine: 내 활성 배정(시작일 오름차순, 없는 것은 뒤 — 열면 `last_seen_at` 갱신). done: 끝난 내 배정 | `open`(및 tab 없음) **403** "정지된 계정은 새 작업을 볼 수 없습니다", `mine`·`done` 허용 |
| `GET /work/jobs/:id` | – | `JobDetail` — 모집중 작업이거나 내 신청·배정이 있는 작업만, 아니면 404 | 내 신청·배정이 있는 작업만 (모집중 열람 경로 없음 → 404) |
| `POST /work/jobs/:id/apply` | `{ message? }` | `Application`. 중복 409, 모집 아님·종류 불일치 409, 지원 종료일 지남 409 **"지원 종료일이 지났습니다"** | **403** "정지된 계정은 새 작업에 신청할 수 없습니다" |
| `POST /work/applications/:id/withdraw` | – | `Application` (`applied` 만) | 허용 |
| `POST /work/assignments/:id/confirm` | – | `Assignment` (`offered` 만) | **403** "정지된 계정은 새 작업을 수락할 수 없습니다" |
| `POST /work/assignments/:id/decline` | `{ reason? }` | `Assignment` (`offered` 만) | 허용 |
| `POST /work/assignments/:id/start` | – | `Assignment` (`confirmed` 만) | 허용 |
| `POST /work/assignments/:id/release` | `{ reason }` (필수) | `Assignment` (`confirmed`·`started`) | 허용 |
| `POST /work/assignments/:id/updates` | `{ kind: progress\|issue\|result, body, issue_chips? }` | `Update`. `result` 는 `started`·`revision` 에서 `submitted`(assembly 는 바로 `accepted`). `progress`·`issue` 는 작업이 `closed`·`cancelled` 가 아니면 언제든 (★5 가 — 끝난 뒤 추가 보고 포함) | 허용 |

`next_job` 고르는 규칙 (`src/work/jobs.js` `pickNextJob` = `js/mypage-work.js` `pickNextJob`): 내 작업 탭 카드(위 순서) 중 `my.assignment_status === 'revision'` 첫 장 → 없으면 KST 날짜로 오늘 이후(오늘 포함) 시작일 중 가장 이른 것 → 없으면 내 작업 탭 첫 줄 → 카드가 없으면 `null`.

### 관리자

| 메서드 · 경로 | 요청 | 응답 |
|---|---|---|
| `GET /work/admin/jobs?status=` | – | `{ items: AdminJobCard[] }` (신청 수, 확정 수/정원, 다음 날짜). `status=expired` 는 지원 종료된 `open` 작업 |
| `POST /work/admin/jobs` | `{ kind, title, detail?, region_label?, starts_at?, ends_at?, apply_deadline?, slots, mode, pay_amount?, pay_unit?, pay_visible?, order_id?, design_id? }` | `AdminJob` (`draft`). `apply_deadline` = 지원 종료일 (선택, 지난 시각도 받는다) |
| `PATCH /work/admin/jobs/:id` | 위 필드 일부 + `version` | `draft`·`open` 만 (지원 종료된 `open` 작업 포함 — 지원 종료일을 뒤로 고치면 다시 모집중) |
| `POST /work/admin/jobs/:id/publish` | – | `draft` → `open` (종류·제목·정원 필수) |
| `POST /work/admin/jobs/:id/cancel` | `{ reason }` | `done` 전만. `AdminJob + { auto_declined: 건수 }` — 남은 `offered` 배정은 `declined` ("작업이 취소돼 초대가 끝났습니다"). 이미 `cancelled` 인 작업이면 남은 `offered` 가 있을 때만 정리만 다시 하고 200 (취소 사유는 그대로), 없으면 409 |
| `POST /work/admin/jobs/:id/close` | – | `done` → `closed`. `AdminJob + { auto_declined: 건수 }` — 남은 `offered` 배정은 `declined` ("작업이 마감돼 초대가 끝났습니다"). 이미 `closed` 인 작업이면 남은 `offered` 가 있을 때만 정리만 다시 하고 200, 없으면 409 |
| `GET /work/admin/jobs/:id` | – | `AdminJobDetail`: 작업 + 신청 목록(작업자 표시 이름·종류·지역·실적 건수) + 배정 + 기록 전부 + 이벤트 (`assignment_auto_declined` 포함) |
| `POST /work/admin/jobs/:id/invite` | `{ worker_id }` | `Assignment` (`offered`, via `invite`). 승인 작업자만 — 정지·대기·반려면 409 "정지된 작업자는 배정할 수 없습니다". 종류 맞아야. 넣는 사이 작업이 닫히거나 취소됐으면 그 초대도 자동 종료하고 409 "더 이상 사람을 받지 않는 작업입니다" |
| `POST /work/admin/applications/:id/approve` · `reject` | `{ reason? }` | approve → 배정 `confirmed` (정원 넘으면 409, 신청자가 승인 상태가 아니면 409 "정지된 작업자는 배정할 수 없습니다") |
| `POST /work/admin/assignments/:id/accept` | – | `submitted` → `accepted` (install·as) |
| `POST /work/admin/assignments/:id/revision` | `{ reason }` (필수) | `submitted` → `revision` |
| `POST /work/admin/assignments/:id/remove` | `{ reason, no_show? }` | → `removed` |
| `POST /work/admin/jobs/:id/updates` | `{ kind: correction\|note, body, assignment_id?, amends_id?, visible_to_worker }` | `Update` (★5 나 — 회사 정정. 원본은 그대로) |
| `GET /work/admin/workers?status=` | – | `{ items: WorkerAdmin[] }` — 행마다 `done_count`(accepted 배정 수) · `active_count`(offered·confirmed·started·submitted·revision 배정 수) |
| `PATCH /work/admin/workers/:id` | `{ status?, kinds?, reject_reason? }` | 승인·반려·정지·종류 지정. 안 되는 전이는 409 "'승인' 상태에서 '반려'(으)로 바꿀 수 없습니다" (대기 `pending` · 승인 `approved` · 정지 `suspended` · 반려 `rejected`). 바뀌면 `worker_events` |
| `GET /work/admin/workers/:id/events` | – | `{ items: WorkerEvent[] }` 최근순 200개 (관리자 읽기 — support·moderator 포함). 표가 없으면 `{ items: [] }`, 없는 작업자 404 |
| `GET /work/admin/workers/:id/notes` · `POST` `{ note }` | – | 편집자만 |
| `POST /work/admin/invites` | `{ kinds_preset[], display_name_preset?, expires_at }` (만료일은 편집자가 고른다) | `{ id, url, expires_at }` — 토큰은 응답에만, DB 에는 `pepperedHash(SHARE_TOKEN_PEPPER, 'worker-invite', token)` |

### 응답 모양 (작업자에게 가는 것은 `src/work/reveal.js` 한 곳에서 깎는다)

- `WorkerSelf`: `{ id, status, display_name, phone, kinds, region_label, photo_consent, consent_version, reject_reason }`
- `JobCard`: `{ id, kind, title, region_label, starts_at, ends_at, apply_deadline, slots, filled, effective_status, pay?: { amount, unit } (pay_visible 일 때만), my: { application_id?, application_status?, assignment_id?, assignment_status?, release_reason? } }`
  - `apply_deadline` 은 지원 종료일 (없으면 `null` — 정원이 차면 마감)
  - `my.release_reason`: 내 배정이 거절·포기로 끝났을 때 내가 적은 사유, 또는 작업 닫기·취소로 끝난 초대의 안내 문구. 편집자 제외(`removed`) 사유는 여기 없다 (이벤트에만)
- `JobDetail`: `JobCard` + `{ detail, order_no?, customer_masked?, site: null, site_note, timeline: Update[] (visible_to_worker 만, 내 배정 관련 + 작업 전체 회사 공지) }`
  - `order_no`·`customer_masked`(maskName) 는 **내 배정이 활성일 때만**. `site` 는 1주차 항상 `null`, `site_note: '현장 주소·연락처는 공개 기간이 정해지면 열립니다'`
  - 다른 작업자의 이름·신청·메모는 없다
- `WorkerEvent` (관리자): `worker_events` 행 그대로 `{ id, worker_id, actor_user_id, actor_kind, type, from_status, to_status, note, payload, created_at }`
- 관리자 응답에는 전부 (단, 1주차에도 현장 주소는 이 API 에서 내보내지 않는다 — 기존 현장 정보 화면에서 본다)
- 금지 키 (작업자 응답에 절대 없음, 시험으로 고정): `address`, `phone`(작업자 본인 것 제외), `customer_name`, `cost`, `margin`, `note`(관리자 메모)

## 4. 화면

| 파일 | 소유 | 내용 |
|---|---|---|
| `admin/work-jobs.html` + `js/work-jobs-admin.js` | Worker Portal | 보드 탭(초안·모집중·**지원 종료**·배정·진행·검수대기·완료 열, 카드: 날짜·종류·시구·확정 n/정원·신청 수 — 초안·모집중·지원 종료 카드에 "지원 종료 10/25(토) 18:00 · D-3"), 작업 만들기 서랍(주소·연락처 칸 없음, **지원 종료일** datetime-local KST · 비우면 "비워 두면 정원이 찰 때까지 받습니다" · 지난 시각은 경고만), 작업 상세(신청자 선정, 초대, 배정 승인·보완요청·제외, 기록 타임라인, 회사 정정·메모 입력 + 작업자에게 보이기 체크, 행 "지원 종료일"(없으면 "정하지 않음"), 이벤트 `assignment_auto_declined` = "응답 없는 초대 자동 종료"), 닫기·취소 확인 문구에 "응답 없는 초대 N건은 자동으로 끝납니다"(0이면 생략, 조립 작업 닫기 문구는 "검수가 끝난" 이라 하지 않음), 작업자 탭(대기 승인·반려·정지·종류, 정지 확인 문구에 `active_count`, 작업자마다 **이력**(가입 신청 (공개 신청/초대 링크) · 상태 변경 "대기 → 승인" · 종류 변경 "작업 종류: 설치·A/S", 404·빈 목록이면 "기록 없음"), 초대 링크 발급(만료일 선택) + 복사, 메모), [카톡으로 공유]은 Web Share 없으면 복사 — 지원 종료일이 있으면 한 줄 "지원 종료일 10/25(토) 18:00" |
| `js/admin-shell.js` | (공용) | `ADMIN_NAV` 에 `{ href:'work-jobs.html', icon:'🧰', label:'작업 배정' }` 한 줄 — 관리자 페이지 `?v=` 모두 올림 |
| `worker.html` + `js/worker-portal.js` | Worker Portal | 상태별 화면: 미로그인 → 로그인 안내(카카오 먼저, `login.html?redirect=worker.html…`) / 미등록 → 작업자 신청서(동의 항목 나열, 사진 동의 따로, 주민번호·계좌 받지 않음) / `pending` → 대기 / `approved` → 탭(모집중·내 작업·완료·내 정보) / **`suspended` → 맨 위 안내 "계정이 정지되어 새 작업 신청·수락을 할 수 없습니다. 지난 기록은 볼 수 있습니다." + 모집중 탭·신청·수락 버튼 숨김, 나머지 버튼 그대로**. 모집중 카드에 지원 종료일이 있으면 "지원 종료일 10/25(토) 18:00 · D-3"(오늘 종료는 눈에 띄게), 작업 상세 사실 행 "지원 종료일" + 꼬리표(없으면 "정하지 않음 (정원이 차면 마감)"), 화면 시각으로 지원 종료일이 지났으면 신청 버튼 비활성 + "지원 종료". 지난 작업 탭에서 `declined` + `my.release_reason`. 작업 상세 `worker.html#job=<id>`, 초대 링크 `worker.html#invite=<token>` (토큰은 sessionStorage 에 보관해 로그인 왕복 뒤 사용). 560px 열, 16px 이상 글자, 전체 폭 버튼, `noindex`·`no-referrer` |
| `js/mypage-work.js` + `mypage.html` `#myWorkSection` | Worker Portal (그 섹션) | `/work/me` **하나만** 부른다. 작업자 행을 주면 요약 카드(예정·보완요청·새 소식, 다음 작업 한 줄 = `me.next_job` → `worker.html#job=<id>` 링크, `next_job` 이 없고 내 작업이 있으면 "작업자 페이지 '내 작업'에서 확인하세요", [작업자 페이지 열기]), 정지 작업자도 요약 카드(모집중 줄 대신 정지 안내 한 줄), 아니면 숨김. `ready:false` 도 숨김 |
| `production-worker.html` | Workflow Worker | "다른 작업 기록" 자유 입력칸 예시는 주문번호(`orders.js` `buildOrderNo` 모양 `SO-YYYYMMDD-XXXX`) + 품목 — 고객 이름을 적게 유도하지 않는다 |
| 모든 화면 | – | 사용자 입력은 `esc()` 로 출력, API 주소·토큰은 기존 화면(production.html)과 같은 방식 |

## 5. 로그인 (Site Auth, PR0)

- `login.html` 리다이렉트: 같은 사이트 상대 경로 `*.html`(+ `?…`·`#…`)만 허용, `javascript:`·`//`·`http(s)://` 는 `index.html`
- OAuth `redirectTo` 가 원래 리다이렉트를 유지 (`login.html`, `signup.html`)
- `login.html` 에 카카오 버튼
- 카카오톡 인앱 브라우저(UA `KAKAOTALK`)에서 "외부 브라우저로 열기" 안내 — 1주차 후속 E 에서 네이버·인스타그램·페이스북·라인·다음·밴드로 넓힌다
- `admin/users.html` 이름·이메일 이스케이프
- 사장님 할 일: Supabase Auth Redirect URLs 에 `worker.html` 경로 추가, 카카오 공급자 이메일 제공 설정 확인

## 6. 시험 (완료 기준)

- 서버 `workers/workflow-api/test/work.test.js` (node --test): 대기 작업자 신청 403 · 중복 신청 409 · 정원 초과 승인 409(버전 경쟁) · 남의 배정 404 · 잘못된 UUID 422 · 작업자 응답에 금지 키 없음 · `pay_visible=false` 면 금액 없음 · 초대 1회용·만료 410 · 고객이 `/work/admin/*` 403 · support 역할이 메모 403 · Slack 문구에 주소·실명·금액 없음 · assembly 완료 보고는 바로 accepted · 회사 정정 후 원본 행 그대로 · `closed` 작업에 보고 409
  - 1주차 후속: 정지 작업자 라우트별 허용/403(문구) · 관리자 초대·신청 승인 409 · `next_job` 규칙(순수 + 라우트)과 `last_seen_at` 미변경 · 닫기·취소의 `auto_declined` 와 이벤트 payload · 수락·거절·초대와 취소가 겹쳐도 `offered` 가 남지 않음 · 정리 실패 뒤 같은 닫기·취소 재호출은 정리만 · `active_count` · `worker_events` 행(개인정보 없음) · 이력 라우트 권한·404·표 없음 · 409 한국어 문구("지원 종료일이 지났습니다", "'승인' 상태에서 '반려'(으)로 …")
- SQL `__tests__/work-jobs-sql.test.js` (jest): 멱등 구문 · 쓰기 정책 없음 · 정책이 `is_admin()` 만 (`worker_notes` 는 정책 없음) · auth FK SET NULL · 주민·계좌 열 없음 · anon REVOKE · 글자 수 CHECK · rollback 파일이 모든 표를 역순 DROP
- 화면: `html-validate`·`linkinator` 통과, 렌더 함수 jest(이름에 `<script>` → 글자), 375px 가로 스크롤 없음(수동 확인 절차 PR 에 기록)
