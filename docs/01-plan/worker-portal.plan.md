# 다담 작업자 포털 (작업 게시 · 신청 · 배정 승인 · 마이페이지 · 작업 보고 · 평가) — 울트라 플랜

- 작성: 2026-10-20, 에이전트 10명 (조사 5 · 설계안 3 · 심사·종합 1 · 비평 1, 인용 40곳 이상 대조)
- 상태: **계획 — 사장님 결정 대기** (아래 "1주차 전에 필요한 결정")
- 원칙: 금액·벌칙·기간 같은 사업 규칙은 지어 넣지 않는다 (CLAUDE.md "설계 규칙 임의 생성 금지"). 숫자가 적힌 곳은 모두 **제안**이며 사장님 확정 전에는 코드에 넣지 않는다.

## 한 줄 결론

새 서버 없이 `workers/workflow-api` 에 `src/work/` 모듈을 붙이고, 모든 쓰기는 워커(service_role)가 권한을 검사한 뒤 한다. 사장님이 지금 전화·카톡으로 부르는 일(설치·A/S·조립 추가 인원)부터 **게시 → 신청 → 승인·배정 → 마이페이지 → 진행·완료 보고 → 검수·평가** 로 돌린다. 1주차는 글 보고까지, 2주차 사진·평가, 3주차 현장 일정 연결, 4주차 이후 공장 토큰 링크 이전. 고객 주소·연락처는 배정된 사람에게만, 정해진 기간 동안만, 복사 없이 보여 준다.

## 개정 사항 (비평 21건 — 아래 본문보다 우선)

| # | 문제 | 고친 방법 |
|---|---|---|
| 1 | 카카오톡 안에서 연 링크(인앱 브라우저)는 구글 로그인이 막힌다 (`disallowed_useragent`) | 카카오 로그인을 먼저 두고, 카카오톡 인앱이면 "외부 브라우저로 열기" 안내. 초대 토큰은 OAuth 왕복 중 sessionStorage 에 보관 (PR0 시험) |
| 2 | 루트가 아닌 `redirectTo` 는 Supabase Auth Redirect URLs 허용 목록에 있어야 한다. 카카오는 사업자 인증 없이는 이메일을 안 줄 수 있다 | 사장님 대시보드 작업으로 추가: Redirect URL 등록, 카카오 공급자 설정 확인 (PR0 전) |
| 3 | 초대 링크는 가진 사람 누구나 쓸 수 있다 — 단톡방에 퍼지면 처음 누른 사람이 작업자가 된다 | 초대로 가입해도 `pending` 으로 두고 관리자가 확인(공급자·이메일 표시) 후 승인. 만료는 사장님 결정 |
| 4 | `isAdmin` 은 `support`·`moderator` 도 참 → 고객 주소·평가·관리자 메모가 보인다 | 현장 정보·`worker_notes`·평가는 `EDITOR_ROLES`(super_admin·admin)만. 시험: support 역할은 현장 정보 404 |
| 5 | 평가의 "재작업 필요" → `addRework` 는 디자인 소유자 검사(`orders.js:164-168`)에 막히고, `rework_logs.order_id` 는 NOT NULL | 관리자 경로를 따로 두고(`getDocumentForPrint` 방식), 주문이 연결된 작업에서만 체크박스를 보인다 |
| 6 | `work_reports` kind 를 `work-jobs.sql` 에서 바꾸면 `work-reports.sql` 재실행 때 지워진다 | 한 PR 에서 `work-reports.sql` 자체, `__tests__/work-reports-sql.test.js` KINDS, `record.js` `REPORT_KINDS`·`KIND_LABEL`, `admin/work-reports.html` 탭을 함께 고친다 |
| 7 | 07:00 cron 은 평일만 돈다 (`0 22 * * SUN-THU`) — 토요일 설치 요약 없음, 금·주말 마감이 월요일까지 안 바뀜 | 마감(`expired`)은 읽을 때 `apply_deadline < now()` 로 판정. cron 은 요약만 |
| 8 | "한 회사, `is_admin()`" 가정이 증명되지 않았다 — 일정·주문 경로가 디자인 소유자를 검사하고 소유자가 여럿일 수 있다 | 실제 DB 에서 주문 있는 `designs.user_id` 개수를 확인한 뒤 `owner_id` 생략 여부 결정. 일정에서 만들기는 관리자 경로로 |
| 9 | 공장 작업은 "각자 자기 작업만 하고 스스로 검수" (`work-order-stage.plan.md:79`, 대표 결정) | 검수·평가 상태는 현장·외주 작업에만. 공장 작업은 완료 보고로 끝 (바꾸려면 사장님 결정) |
| 10 | 탈퇴해도 `display_name`·`phone`·`worker_name_snapshot` 이 남는다 (`SET NULL`) | account-api 탈퇴 흐름 또는 트리거로 익명화. account-api 소유자 지정 필요 |
| 11 | 개인정보보호법: 위탁 사실 공개만으로 부족 — 제26조 위탁 계약서가 외주 기사마다 필요, 고객에게 집 사진 촬영 고지 필요 | 결정 13 에 추가. `privacy.html` 을 현장 작업 공개 전 별도 PR 로 |
| 12 | 1주차가 결정 ★7(주소 공개 기간)에 막힌다 | PR2 는 ★7 전까지 주소를 공개하지 않는다. 1주차 필요 결정은 ★1·★3·★4·★5·★15. 1주차에는 작업자 푸시 알림이 없다 — 사장님이 카톡 단톡방에 링크를 직접 공유, 앱 배지는 페이지를 열 때만 |
| 13 | Web Share API 는 PC 파이어폭스에 없고 윈도 크롬은 들쭉날쭉 | 클립보드 복사 대체 버튼 |
| 14 | 소유권 충돌: `login.html`·`signup.html` 은 사이트 전체 인증 파일, `mypage.html`·`admin/*.html`·`js/admin-shell.js`·`production.html` 은 소유자 없음. `ADMIN_NAV` 수정은 관리자 13쪽 `?v=` 를 올려야 함 | PR0 은 인증 전용 PR. 소유권 행을 사장님이 먼저 승인 (결정 16) |
| 15 | `assignee_name` 이 두 군데서 쓰인다 (Slack `slack.js:60`, 설치지시서 `installation-order.js:174`, 사장님 손 입력) | 어느 쪽이 이기는지 결정, 포기 시 지움 |
| 16 | 빠진 완료 기준 | 루트 CI 의 `html-validate`·`linkinator` 통과, work-reports-sql 시험 갱신, `version` 잠금 경쟁 시험, HEIC·해독 불가 이미지의 분명한 오류, support 역할 404 |
| 17 | 되돌리기 계획 없음 | `database/work-jobs-rollback.sql` (역순 DROP). `/work/me` 가 표 없음을 돌려주면 메뉴·마이페이지 섹션 숨김 |
| 18 | 지어 넣은 값: "승인 후 7일", 10MB, `slots 1–10`, 1600px | 모두 **제안**으로 표시하고 사장님 확정. 1600px 은 mypage 선례가 있음 |
| 19 | 작업자 계정이 고객 권한을 함께 얻는다 (`detaildesign-access.js:28` minTier → 상세설계·이미지 도구), `signup.html` 은 마케팅 동의·`interest_tier` 를 받는다 | 작업자 전용 가입 화면 (`worker.html` 신청서), 사장님 확인 |
| 20 | 기존 저장형 XSS: `admin/users.html:939-940` 이 이름·이메일을 이스케이프 없이 넣는다 — 작업자 이름이 관리자 화면에 나온다 | 작업자 포털 공개 전에 고친다 (PR0 과 같은 주) |
| 21 | 공장 화면의 고객 실명(`service.js:156,415`)·일당 문구(`planner.js:286`) 누출 | 결정 15 를 ★(1주차)로 올리고 PR9 전에 정리 |

### 1주차 순서 (개정)

| 순서 | PR | 내용 | 결정 |
|---|---|---|---|
| 0 | (사장님) | Supabase Redirect URLs 등록, 카카오 공급자 확인, 소유권 행 승인 | 16 |
| 1 | PR0 `agent/auth-login-redirect` | 열린 리다이렉트 수정, `redirectTo` 유지, login 에 카카오, 인앱 브라우저 안내 + `admin/users.html` XSS 수정 | — |
| 2 | PR1 `agent/worker-sql-core` | `work-jobs.sql` + rollback + SQL 시험 (work_reports kind 는 PR5 에서 따로) | ★1 |
| 3 | PR2 `agent/workflow-work-core-api` | 작업자 등록(초대 → pending), 게시·신청·승인·배정·시작·글 완료 보고, 주소 **비공개**, EDITOR_ROLES 범위 | ★3 ★4 ★5 |
| 4 | PR3 · PR4 | 관리자 보드, `worker.html`·마이페이지 요약 (복사 버튼 대체) | — |
| 5 | (누출 정리) | 공장 화면 고객 실명·일당 문구 | ★15 |

### 1주차 전에 필요한 결정 (개정)

★1 첫 작업 종류 · ★3 가입 방식 · ★4 배정 방식 · ★5 "작업을 했던 유저라면 회사에서 작업 내용을 업데이트" 의 뜻 · ★15 공장 화면 누출 정리 · 16 소유권 행. 주소 공개 기간(★7)은 현장 정보를 여는 PR 전까지.

## 본문 (2026-10-20 종합안 — 위 개정 사항이 우선)

> 2026-10-20 작성. 저장소를 읽기만 하고 조사했으며 코드는 고치지 않았습니다. 세 안을 심사한 뒤 하나로 합친 안입니다.
> 추측한 부분에는 **가정**이라고 적었습니다. 금액, 벌칙, 공개 기간처럼 사업 규칙에 해당하는 것은 정하지 않고 모두 §14 사장님 결정으로 남겼습니다.

---

## 1. 한 줄 결론과 추천 구조

**결론.** 새 서버를 만들지 않고 기존 `workers/workflow-api`에 `src/work/` 모듈을 붙입니다. 사장님이 지금 전화나 카톡으로 부르는 일부터 다음 흐름에 올립니다.

> 작업 게시 → 작업자 신청 → 사장님 승인·배정 → 마이페이지에 표시 → 결과 보고 → 검수·평가

- 1주차: 게시부터 완료 보고(글)까지 한 바퀴를 실제로 돌립니다.
- 2주차: 사진과 평가를 붙입니다.
- 그 뒤: 일정, 생산 계획, 공장 토큰 링크를 잇습니다.

뼈대는 **3안(운영 우선 MVP)**입니다. 여기에 1안에서 공개 사다리(`reveal.js`), 초대 링크, 토큰 링크 이전, 이벤트 기록을 가져오고, 2안에서 동의 기록, 관리자 전용 메모, 주소 열람 기록, SQL 문자열 시험을 가져왔습니다.

```
[작업자 폰]  worker.html  ·  mypage.html #myWorkSection (요약 카드)
     │  Bearer JWT (카카오·구글·이메일 로그인)
     ▼
[workflow-api]  src/work/*   ← 모든 쓰기, 권한 검사, 주소 공개 판단(reveal.js), 사진 서명 URL
     │ service_role                         │ postToWebhook → 사장님 Slack (개인정보 없음)
     ▼                                      ▼
[Supabase]  workers · worker_invites · worker_notes · work_jobs · work_applications
            work_assignments · work_updates · work_photos · work_reviews · work_job_events
            RLS = 관리자 SELECT 만, 쓰기 정책 없음   +  비공개 버킷 work-results
     ▲ 읽기만 연결 (초안 만들기, 현장 정보 실시간 조회)
[기존]  design_schedules · design_site_info · production_assignments · rework_logs · work_reports
[관리자 화면]  admin/work-jobs.html (작업 보드 탭 + 작업자 탭)
```

**다섯 가지 원칙**

| 원칙 | 내용 |
|---|---|
| 쓰기는 Worker만 | 모든 쓰기는 Worker(service_role)에서만 합니다. 브라우저는 API로만 읽습니다. 지금의 `work_reports`, `production_*`와 같은 방식입니다 (`database/work-reports.sql:62-68`, `database/workflow-production.sql:69-87`). |
| 작업자 자격은 별도 표 | 새 `workers` 표에 둡니다. `profiles`는 본인이 모든 열을 고칠 수 있고(`database/profiles-schema.sql:56-58`), `admin_roles`는 행이 하나만 있어도 `is_admin()`이 참이 되므로 둘 다 쓰지 않습니다. |
| 주소·연락처는 복사하지 않음 | 배정된 작업자에게, 공개 기간 안에서만, `design_site_info`에서 그때그때 읽어 줍니다 (`src/site-info.js:66`). |
| 기록은 덮어쓰지 않음 | 작업자 보고와 회사 정정이 한 작업의 타임라인에 쌓입니다. |
| 기존 생산 시스템은 그대로 | `production_*`와 `production-worker.html`은 1~3주차 동안 쓰기를 건드리지 않습니다. 읽어서 초안을 만드는 연결만 합니다. |

---

## 2. 왜 이 구조인가

### 심사 점수 (1–10)

| 기준 | 1안 생산 시스템 확장 | 2안 Supabase 직접(RPC) | **3안 운영 우선 MVP** |
|---|---|---|---|
| 사장님 가치 (배정 속도, 품질 관리, 전화 감소) | 8 | 7 | **9** |
| 현재 스택·팀 적합 (정적 사이트 + Supabase + Workers, 사장님 1명 + AI 에이전트) | 9 | 5 | **9** |
| 보안·개인정보 | 8 | 6 | **9** |
| 비용·운영 부담 | 7 | 7 | **8** |
| 단계적 배포 | 6 | 6 | **9** |
| **합계 /50** | 38 | 31 | **44** |

### 다른 안을 뼈대로 쓰지 않은 이유

**1안 (생산 시스템 확장)**
- 가장 완전하지만 MVP에 공장 작업, 현장 작업, 토큰 링크 이전을 한꺼번에 넣었습니다. 작업자가 처음 화면을 보기까지 PR이 5개 필요합니다.
- 모든 표에 `owner_id`(사장님 계정)를 들고 다녀야 합니다. 생산 표는 `user_id` = 사장님 계정이 기준이어서(`production_settings.user_id` PK), 다른 관리자가 승인하면 범위가 꼬입니다.

**2안 (Supabase 직접)**
- 서버 배포는 줄어듭니다.
- 하지만 상태 전이가 plpgsql `SECURITY DEFINER` 함수에 들어갑니다. CI에는 DB가 없어 이 로직이 한 번도 실행 검증되지 않고, 함수 버그가 곧 권한 상승이 됩니다.
- 표 단위 SELECT 권한은 열을 가릴 수 없습니다(`database/credits-schema.sql:80-85`). 그래서 금액 숨김(`pay_visible`)과 주소 공개 기간을 RLS로 표현하기 어렵습니다.
- PR마다 사장님이 SQL을 실행해야 하고, 로직이 SQL과 workflow-api 두 곳으로 갈라집니다.

**3안의 약점과 보완**
- 첫 대상을 "외주 설치 기사"로 고정했는데, 이는 결정 2(설치가 외주인지)와 기사들이 계정을 만들지에 달려 있습니다.
- 그래서 작업 종류는 고정하지 않고 사장님이 고르는 목록(CHECK)으로 바꿨습니다. "조립 추가 인원"도 첫 대상 후보에 넣었습니다.

### 접목한 것

| 가져온 것 | 출처 | 이유 |
|---|---|---|
| `reveal.js`: 보는 사람과 단계에 따라 작업 JSON을 깎는 순수 함수 + 시험 | 1안 | 주소·금액 누출을 한 곳에서 막고 시험으로 고정합니다 |
| `worker_invites`: 해시 초대 링크 (`SHARE_TOKEN_PEPPER`, `'worker-invite'` 네임스페이스) | 1안 | 아는 사람은 승인 절차 없이 바로 연결합니다. 새 시크릿이 필요 없습니다 |
| 토큰 링크 → 계정 연결 경로 (`/public/production/claim`) | 1안 | 공장 작업 기록을 잃지 않고 옮깁니다 |
| 마감 지난 모집을 cron이 `expired`로 처리 | 1안 | 신청 0명인 작업을 놓치지 않습니다 |
| 사람별 완료 (배정 행마다 상태) | 1·3안 | 지금은 아무 링크나 남의 지시를 완료 처리할 수 있습니다 (`worker-access.js:169-175`) |
| `consent_version`, `photo_consent` (사진 동의 따로) | 2안 | 개인정보 동의를 증빙합니다 |
| `worker_notes`: 관리자 전용 메모 표 | 2안 | 나중에 작업자 본인 읽기 정책을 열어도 메모가 새지 않습니다 |
| `visible_to_worker`: 회사 정정을 작업자에게 보일지 | 2안 | "회사가 기록을 고친다"는 해석을 지원합니다 |
| `site_viewed` 이벤트: 주소를 볼 때마다 기록 | 2안 | 제3자(외주)에게 개인정보를 넘긴 증빙이 됩니다 |
| SQL 문자열 시험 (멱등, 쓰기 정책 없음, SET NULL, 주민번호·계좌 열 없음) | 2안 | DB 없이도 CI에서 실수를 잡습니다 |
| 낙관적 잠금 `work_jobs.version` | 2안의 `FOR UPDATE` 대체 | 두 관리자가 동시에 승인해도 정원을 넘지 않습니다 |

---

## 3. 목표 / 비목표

### 목표 (MVP)
1. 사장님(관리자 편집자)이 작업을 올리는 세 가지 방식을 지원합니다: 모집, 지정 초대, 직접 배정.
2. 승인된 작업자가 로그인해 신청합니다. 사장님이 골라 확정합니다. 한 작업에 여러 자리(`slots`)를 둘 수 있습니다.
3. 작업자는 로그인 후 마이페이지 요약 카드와 모바일 `worker.html`에서 **모집중 · 내 작업 · 완료·평가**를 봅니다.
4. 배정된 작업자는 시작, 진행·문제 보고, 사진, 완료 보고를 올립니다. 회사는 같은 타임라인에 정정과 메모를 남깁니다. 어느 쪽도 덮어쓰지 않습니다.
5. 회사는 결과를 검수(승인 또는 보완요청)하고 평가합니다. 작업자는 답글이나 이의를 달 수 있고, 선택하면 회사를 평가할 수 있습니다.
6. 고객 주소와 연락처는 배정된 사람에게만, 정해진 기간 동안만 보입니다.

### 비목표 (MVP에서 하지 않음)
- 정산과 지급, 3.3% 계산, 세무 신고
- 계좌번호 수집. **주민등록번호는 어느 단계에서도 저장하지 않습니다.**
- GPS 출퇴근
- 공개 구인 마켓
- 자동 벌점·제재
- 알림톡 (업체 결정 후)
- 외주 발주 (일성합판, 상일, 상판): 지금처럼 `reports/outsource.js` 흐름에 남깁니다
- `production-worker.html` 교체 (4주차 이후 계정 연결로 옮김)
- 생산 계획(`decideProposal`, `src/production/service.js:291-325`) 변경

---

## 4. 사용자와 권한

| 역할 | 정해지는 방법 | 볼 수 있는 것 | 할 수 있는 것 |
|---|---|---|---|
| 비로그인 | – | 없음. `worker.html`은 로그인 안내만 보여 줍니다 | 로그인·가입 |
| 로그인 고객 | auth 계정, `workers` 행 없음 | 기존 마이페이지만. 작업 섹션은 `hidden` | 작업자 신청서 제출 (동의 포함), 초대 링크 사용 |
| 신청 대기 | `workers.status = pending` | 대기 화면, 내 신청 정보 | 신청 정보 수정·철회 |
| 승인 작업자 | `status = approved` | 내 작업 종류에 맞는 모집중 작업: 종류, 시/구, 날짜·시간, 범위(m, 수량), 금액(`pay_visible`일 때만) | 신청·철회, 초대 수락·거절 |
| 배정 작업자 | 활성 `work_assignments` | 위 내용 + 주문번호, 가린 이름(`maskName`, `src/share.js:134`). 현장 작업이면 공개 기간 안에서 주소·층·엘리베이터·출입·연락처 | 시작, 진행·문제 보고, 사진, 완료 보고, 포기(사유) |
| 지난 작업자 | 끝난 배정 | 내 사진, 타임라인, 공개된 평가. 주소·연락처는 볼 수 없음 | 추가 보고(결정 5의 기간 안), 평가 답글·이의, 회사 평가(선택) |
| 정지 작업자 | `status = suspended` | 내 지난 기록만 | 없음 |
| 관리자 (조회) | `admin_roles` 아무 역할 → `isAdmin` (`src/reports/admin.js:39`) | 전부 | 조회만 |
| 관리자 편집자 | `super_admin`, `admin` (`EDITOR_ROLES`, `src/reports/admin.js:15`; `assertAdminEditor` :48) | 전부 | 게시, 선정, 초대, 직접 배정, 검수, 정정, 평가·공개, 작업자 승인·정지, 초대 링크 발급 |

**운영 메모**
- 한 계정이 고객이면서 작업자이거나, 관리자이면서 작업자일 수 있습니다. 그래서 마이페이지 섹션은 `.user-only`(CSS `mypage.html:128-135`)가 아니라 `hidden` 토글로 엽니다.
- 실제 DB의 `admin_roles` 역할 CHECK는 확인되지 않았습니다. 정의가 두 벌입니다: `database/admin-schema.sql:87-95`와 `database/rls-enhanced.sql:10-17`. 그러니 새 역할 값을 추가하지 않습니다. 작업자는 `admin_roles`와 무관합니다.

---

## 5. 작업 흐름 (상태 기계)

### 5-1. 작업 상태 (`work_jobs.status`)

```
draft 초안 ──게시──▶ open 모집중 ──정원 참──▶ filled 배정완료 ──첫 시작──▶ in_progress 작업중
   │                  │   ▲                    │  ▲                         │ 모든 활성 배정이 완료보고
   │ 직접 배정 ────────┼───┼──────────────────▶ │  │                         ▼
   │                  │   └── 포기·거절·제외로 빈 자리 생김            review 검수대기
   │                  └─ 신청 마감, 지원 0 ─▶ expired 마감 (cron)              │  보완요청 → in_progress
   └── done 전 어느 단계에서나 ─취소(사유)─▶ cancelled                          ▼ 전원 승인
                                                                     done 검수완료 ─평가 저장/건너뜀─▶ closed
```

| 전이 | 누가 | 조건 |
|---|---|---|
| draft → open | 편집자 | 종류, 날짜, `region_label`(시/구), `slots` ≥ 1 |
| draft/open → filled (직접 배정) | 편집자 | 배정 행 생성 (`offered`, 또는 직원이면 편집자가 고르면 바로 `confirmed`) |
| open → filled | 시스템 | 확정된 배정 수 = `slots`. `version` 낙관적 잠금으로 초과하면 409 |
| filled → open | 시스템 | 포기, 거절, 제외로 자리가 빔 |
| open → expired | cron | `apply_deadline` 지남. 이후 사장님이 초대, 직접 배정, 일정 조정 중에서 고릅니다 |
| filled → in_progress | 배정 작업자 (또는 편집자) | 배정이 `confirmed` |
| in_progress → review | 시스템 | 모든 활성 배정이 `submitted` |
| review → in_progress | 편집자 (보완요청) | 사유 칩 필수 |
| review → done | 편집자 | 전원 `accepted` |
| done → closed | 편집자 | 평가 저장 또는 건너뜀 |
| → cancelled | 편집자 | 사유 칩. `done` 이후는 불가. 배정자에게 알림 |

### 5-2. 배정 상태 (`work_assignments.status`)

```
(신청 승인) ───────────────▶ confirmed 확정 ─시작─▶ started ─완료보고─▶ submitted ─승인─▶ accepted
(초대·직접 배정) ▶ offered ─수락─▶ confirmed                     ▲               │
                   └─거절─▶ declined                            └── revision ◀──┘ 보완요청
confirmed/started ─작업자 포기(사유)─▶ released      편집자 ─제외(사유, no_show 표시 가능)─▶ removed
```

- 신청이 승인되면 바로 `confirmed`입니다. 신청한 것 자체가 하겠다는 뜻이라 수락 단계를 한 번 줄였습니다. 마음이 바뀌면 `released`로 빠집니다.
- 포기 마감 시각, 늦은 취소 수수료, 노쇼 결과는 **정하지 않았습니다.** MVP는 사실만 기록하고 벌칙은 없습니다 (결정 14).

### 5-3. 신청 상태 (`work_applications.status`)

`applied → approved | rejected | withdrawn`

모든 전이는 `work_job_events`에 한 줄씩 남습니다: 누가, 이전 상태, 다음 상태, 사유, 시각. 이 기록은 나중에 경영 대시보드의 적시성 지표로 쓸 수 있습니다.

---

## 6. 데이터 구조

### 6-1. SQL 파일

새 파일 `database/work-jobs.sql` 하나로 만듭니다. 사장님이 SQL을 실행하는 횟수를 1회로 줄이려고 사진과 평가 표도 처음부터 넣습니다.

집안 규칙을 그대로 따릅니다.
- `BEGIN…COMMIT`, 멱등, `DROP POLICY IF EXISTS`
- `REVOKE ALL … FROM anon`
- 글자 수 CHECK
- `auth.users` 참조 FK는 모두 `ON DELETE SET NULL` (회원탈퇴가 FK에 막히지 않게, `database/account-deletion.sql`)

| 표 | 핵심 열 | 비고 |
|---|---|---|
| `workers` | `id`, `user_id UNIQUE NULL → auth.users`, `display_name ≤30`, `kinds text[]` (사장님 확정 목록 CHECK), `employment staff/daily/contractor` (가정, 결정 1), `phone NULL ≤30`, `region_label NULL`, `status pending/approved/suspended/rejected`, `consent_version`, `consent_at`, `photo_consent bool`, `approved_by/at`, `reject_reason ≤200`, `counterparty_id NULL → counterparties`, `production_link_id NULL → production_worker_links` (4주차), `last_seen_at` | 주민번호·계좌 열 없음. 시험으로 강제 |
| `worker_notes` | `worker_id`, `author`, `note ≤1000` | 관리자 전용. API가 작업자에게 절대 돌려주지 않음 |
| `worker_invites` | `token_hash UNIQUE`, `kinds_preset`, `display_name_preset`, `expires_at`, `used_at`, `used_by`, `created_by` | `pepperedHash(SHARE_TOKEN_PEPPER,'worker-invite',…)`. 1회용, 만료 |
| `work_jobs` | `kind` CHECK, `status` CHECK, `title ≤80`, `detail ≤2000`, `region_label ≤40`, `starts_at`, `ends_at`, `apply_deadline`, `slots 1–10`, `mode open/invite/direct`, `pay_amount int NULL`, `pay_unit NULL`, `pay_visible bool default false`, `photo_checklist text[]`, `source manual/schedule/assignment/rework`, `order_id`·`design_id`·`design_schedule_id`·`production_assignment_id`·`rework_log_id` (모두 NULL, SET NULL), `version int`, `revision_count`, `created_by` | **주소, 연락처, 고객 실명 열이 없습니다** |
| `work_applications` | `job_id`, `worker_id`, `status`, `message ≤300`, `decided_by/at`, `UNIQUE(job_id, worker_id)` | 중복 신청은 409 |
| `work_assignments` | `job_id`, `worker_id`, `application_id NULL`, `via application/invite/direct`, `status`, `started_at`, `submitted_at`, `accepted_at`, `revision_count`, `no_show bool`, `release_reason ≤200`, `worker_name_snapshot` | 부분 UNIQUE(`job_id`, `worker_id`) WHERE 활성 |
| `work_updates` | `job_id`, `assignment_id NULL`, `author_user_id`, `author_role worker/company`, `kind progress/issue/result/correction/note`, `body ≤1000`, `issue_chips text[]`, `amends_id → work_updates NULL`, `visible_to_worker bool default true` | 추가만 합니다. API에 수정·삭제 경로가 없습니다 |
| `work_photos` | `update_id`, `job_id`, `assignment_id`, `path` (URL 아님), `bytes`, `width`, `height`, `uploaded_by`, `committed_at` | 비공개 버킷 `work-results` |
| `work_reviews` | `assignment_id`, `direction company_to_worker/worker_to_company`, `reviewer_id`, `score 1–5`, `scores jsonb NULL` (항목별, 나중 단계), `reason_chips text[]`, `comment ≤500`, `status draft/published`, `published_at`, `reply ≤500`, `objection ≤500`, `objection_at`, `resolved_at`, `frozen_at`, `rework_log_id NULL`, `UNIQUE(assignment_id, direction)` | |
| `work_job_events` | `job_id`, `assignment_id`, `actor_user_id`, `actor_kind worker/admin/system`, `type`, `from_status`, `to_status`, `note ≤300`, `payload jsonb` (개인정보 없음), `notified_at`, `created_at` | 추가만. `site_viewed`도 여기에 기록 |
| `work_reports` CHECK 변경 | 새 kind `work_assignment`, `work_review` 추가 (`database/work-reports.sql:40-43`) | 기존 kind 목록을 그대로 두고 더하기만 합니다 |

### 6-2. RLS 요약
- 모든 새 표: `FOR SELECT TO authenticated USING (public.is_admin())` 하나만 둡니다. 쓰기 정책은 없습니다. `is_admin()`은 `database/fix-admin-rls-recursion.sql:20-67`의 것을 쓰고, `admin_roles`를 정책 안에서 직접 읽지 않습니다(42P17 재귀 방지).
- 작업자의 읽기는 전부 API를 거칩니다. 그래야 `pay_visible`과 주소 공개 기간이 항상 적용됩니다.
- 나중에 Realtime이 필요해지면 그때 `public.is_worker()`와 본인 SELECT 정책을 추가합니다.
- 버킷 `work-results`: 비공개, 10MB, `image/jpeg|png|webp`만 받습니다. `authenticated` 정책은 없습니다. 대시보드에서 만듭니다(`database/design-renders.sql:20-22`의 경고).
- 정책 값(공개 기간 N일, 이의 기간 N일, 종류별 필수 사진 등)은 `src/work/policy.js`에 "2026-xx-xx 대표 확정" 주석과 함께 둡니다(`standards.js:112`과 같은 방식). **정해지지 않은 값은 기본값을 지어 넣지 않습니다.** 결정 전에는 그 기능의 PR을 머지하지 않습니다.

### 6-3. 기존 시스템과의 관계

| 기존 | 지금 의미 | 작업자 포털과의 관계 | 시점 |
|---|---|---|---|
| `production_assignments` (`database/workflow-production.sql:45-61`) | 역할별 인원·시간 지시. **사람이 없습니다** | "작업으로 올리기"로 초안을 만듭니다 (`asm_call`/`asm_extra` → 조립, `edge_overtime` → 엣지, `people` → `slots`). 문구는 새로 쓰고 기존 `text`는 복사하지 않습니다 | 4주차 PR9 |
| 생산 계획 승인 `decideProposal` | 사장님 승인 → Slack 지시 | 바꾸지 않습니다 | – |
| `design_schedules` (installation, as_visit, measurement, delivery; `database/workflow-schema.sql:217-226`) | 현장 일정. `assignee_name`은 자유 글 (:231) | 일정에서 초안을 만듭니다. 확정되면 `assignee_name`에 `display_name`을 써서 옛 화면도 그대로 동작하게 합니다 | 3주차 PR8 |
| `design_site_info` (`database/cd4-install-domain.sql:31-50`) | 주소, 층, 엘리베이터, 출입, 연락처 | `getSiteInfo`(`src/site-info.js:66`)로 공개 기간 안에서만 실시간으로 읽습니다. 복사하지 않습니다 | 1주차부터 |
| `rework_logs` (`database/management-phase2.sql:102-114`) | 재작업 원인 | 평가의 "재작업 필요" → `addRework`(`src/rework.js:60`). 원인은 편집자가 `REWORK_CAUSES`(:14)에서 고릅니다. 자동 매핑하지 않습니다 | 2주차 PR5 |
| `work_reports` 보관함 | 작업 지시 보고 | 배정·평가를 `safeRecord`로 기록합니다 (`REPORT_KINDS`, `src/reports/record.js:10`) | 2주차 PR5 |
| `counterparties` (category `install`) | 외주 거래처 | `workers.counterparty_id`로 외주 팀과 연결합니다 | 1주차 열만, 쓰는 건 나중 |
| `production_worklogs` / `calibration.js` | 토큰 링크 시간 기록, 표준시간 보정 | NULL 허용 `worker_id`를 더합니다. 보정 결과는 변하지 않아야 합니다 | 4주차 PR9 |
| `production_worker_links` / `production-worker.html` | 계정 없는 토큰 링크 | 그대로 유지합니다. 4주차에 "계정 연결" 버튼을 붙입니다 | 4주차 PR9 |
| `install_feedback` | 고객 0–10점 | 사장님이 본 뒤 요약만 기사 평가에 참고합니다 (고객 이름·주소 없이) | 나중 |
| `order_costs` | 원가 장부 | 승인된 유급 작업 → 지급 초안 (결정 후) | 나중 |

**회사 범위**
- 새 표에는 `owner_id`가 없습니다. 한 회사이고 관리자 전원이 같은 회사라고 보고 `is_admin()`으로 가립니다 (**가정**, 결정 12).
- 생산 표에 쓸 때(4주차)만 `env.COMPANY_OWNER_ID` 시크릿이 필요합니다. 생산 표는 사장님 계정 `user_id` 기준이기 때문입니다.

---

## 7. 화면 (모바일 기준)

### 7-1. 관리자 작업 게시판: `admin/work-jobs.html`

`ADMIN_NAV`의 `work-reports.html` 줄 다음(`js/admin-shell.js:26`)에 `{ href:'work-jobs.html', icon:'🧰', label:'작업 배정' }`을 추가합니다.

**보드 탭**
- 열: 초안 / 모집중 / 배정 / 진행 / 검수대기 / 완료. 종류·날짜로 거를 수 있습니다.
- 카드: 날짜, 종류, 시/구, `확정 1/2`, 신청 수, D-day.

**작업 만들기 서랍**
- 입력: 종류, 제목, 범위, 시/구, 시간, 정원, 모집 방식, 신청 마감, 금액과 공개 여부, 필수 사진.
- 주소·연락처 칸은 일부러 없습니다.

**작업 상세**
- 신청자 목록: 작업자별 실적("4.6 · 12건"), 체크박스, [선정].
- [초대]: 함께 일한 작업자 필터. 해석 (다)를 지원합니다.
- [직접 배정].
- 타임라인: 작업자 보고와 회사 메모를 구분해 보여 줍니다.
- 사진 격자: 1시간 서명 URL.
- [승인] / [보완요청(사유 칩)]. 평가 모달은 `mypage.html:2456-2612`의 시공 평가 모달을 본뜹니다.

**공유**
- [카톡으로 공유] 버튼: Web Share API로 작업 링크와 요약만 보냅니다. 주소·이름은 없습니다.

**작업자 탭**
- 신청 대기 목록과 승인·반려·정지
- 종류 지정
- 초대 링크 발급(1회용)
- 관리자 메모
- 외주 거래처 연결

모든 출력은 `esc()`로 이스케이프합니다 (`production.html:215`의 것을 복사).

### 7-2. 작업자 화면: `worker.html` + `js/worker-portal.js`

- `production-worker.html`의 틀을 가져옵니다: 560px 열, 16–17px 글자, 전체 폭 버튼, `noindex`·`no-referrer` 메타(:6-7).
- 상태별로 다른 화면을 보여 줍니다: 미로그인 → 로그인 안내 / 미등록 → 신청서 / 대기 → 대기 화면 / 승인 → 탭.

```
┌ 다담 작업자 ─────────────── 김기사 ┐
│ [모집중 3] [내 작업 2] [완료·평가] [내 정보] │
├────────────────────────────────┤
│ D-1  설치 · 서울 송파구              │
│ 10/21(화) 09:00 · 싱크 3.2m          │
│ 확정 ● [현장 정보] [시작]             │
├────────────────────────────────┤
│ 보완요청 · A/S · 성남 분당구          │
│ 사유: 문짝 수평   [사진 다시 올리기]   │
└────────────────────────────────┘
```

**탭 구성**
- **모집중**: 내 종류만 보입니다. 카드에 시/구, 날짜, 범위, (공개 시) 금액이 있고 [지원] 한 번 탭으로 신청합니다.
- **내 작업**: 초대 받음([수락]/[거절]), 확정, 오늘, 보완요청. D-day와 색 칩으로 표시합니다.
- **완료·평가**: 지난 작업, 공개된 평가, 답글·이의, 회사 평가(선택).
- **내 정보**: 이름, 휴대폰, 종류, 지역, 동의 내역, 탈퇴 안내.

**작업 상세 (`worker.html#job=<id>`)**
- 확정 전: 종류, 날짜·시간, D-day, 시/구, 범위, 금액(`pay_visible`일 때), 작업 코드.
- 확정 후 공개 기간 안: [현장 정보] 버튼으로 주소, 층, 엘리베이터, 출입, 연락처, 지도 링크, `tel:` 버튼이 열립니다. 열 때마다 `site_viewed`가 기록됩니다.
- 공장 작업은 4주차에 작업지시서 해당 묶음 링크(금액 없음)를 붙입니다.

**신청**
- 한 번 탭으로 신청하고 메모는 선택(≤300자)입니다. 신청 후 [철회]할 수 있습니다.

**진행 업데이트·사진 제출**
1. [시작]
2. [진행 보고] / [문제 보고]: 문제 칩은 도면 오류, 부품 누락, 현장 조건 다름, 고객 요청 변경 등이며 목록은 결정 8에서 정합니다. 짧은 글을 붙입니다.
3. [완료 보고]: `<input type=file accept="image/*" capture="environment" multiple>`, 종류별 필수 사진 체크리스트(결정 9).

사진 처리 규칙:
- 사진은 **항상** 캔버스로 약 1600px JPEG로 다시 인코딩합니다. 이렇게 해야 EXIF와 GPS가 지워집니다. `mypage.html:2440`처럼 작은 파일은 원본을 그대로 쓰는 지름길은 복사하지 않습니다.
- 업로드 대기열에서 재시도합니다. 지하나 신축 현장은 전파가 약합니다.

**평가·피드백**
- 공개된 내 평가만 보입니다. [답글], [이의 제기(N일 안)].
- 선택: 회사 평가(도면·지시 정확도, 자재 준비, 일정 통보)와 칩. 익명이 아니라고 화면에 적습니다.

### 7-3. 마이페이지 요약: `mypage.html`

- 계정 정보 섹션 끝(:1197) 다음에 `<section id="myWorkSection" hidden>`을 넣습니다.
- `await loadMyProjects();`(:1663) 다음에 `loadMyWork()`를 호출합니다.
- 로직은 새 파일 `js/mypage-work.js`에 둡니다. 2,959줄짜리 mypage를 더 키우지 않고, mypage에는 없는 `esc` 함수도 여기에 둡니다.
- `GET /work/me`가 작업자 행을 돌려줄 때만 섹션을 엽니다.
- 카드 내용: 예정 n · 보완요청 n · 새 평가 n, 다음 작업 한 줄, [작업자 페이지 열기].
- 아직 작업자가 아니면 [작업자 신청하기] 링크만 보여 줍니다 (결정 3에 따라).

---

## 8. 알림

| 사건 | 사장님 Slack (`SLACK_WEBHOOK_URL`, `postToWebhook` `src/slack.js:134`) | 작업자 | 나중 (결정 10) |
|---|---|---|---|
| 작업자 신청 | ● 이름만 | – | – |
| 작업 신청·철회 | ● | – | – |
| 초대·직접 배정 | – | 앱 배지 + 사장님이 [카톡으로 공유] | 알림톡 |
| 확정 | (선택) 생산 채널에 표시 이름 명단 | 앱 배지 | 알림톡 |
| 포기·거절 | ● | – | – |
| 완료 보고 | ● 검수 링크 | – | – |
| 보완요청, 검수 결과, 평가 공개 | – | 앱 배지 | 알림톡 |
| 이의 제기 | ● | – | – |
| 취소 | ● | 앱 배지 | 알림톡 |

**규칙**
- Slack과 공유 문구에는 **주소, 연락처, 고객 실명을 절대 넣지 않습니다.** URL 버튼만 둡니다(`admin/work-jobs.html?job=`). 웹훅이라 버튼은 링크만 가능합니다 (`src/production/notify.js:7`).
- cron은 새로 만들지 않고 기존 `scheduled()`(`src/worker.js` 약 840행, `wrangler.toml:8`, 평일 07:00 KST)에 더합니다:
  - 오늘·내일 확정 작업 요약
  - 마감 지난 모집을 `expired`로
  - 마감이 다가오는데 지원 0명인 모집
  - 검수 대기 건수
- 앱 배지는 `/work/me`의 건수와 `workers.last_seen_at` 이후 이벤트로 셉니다.
- 알림톡은 업체와 비즈니스 채널을 정한 뒤 붙입니다.
  - npm 의존성 없이 `fetch`와 HMAC으로 호출합니다. 배포 워크플로 시험 단계에 `npm ci`가 없어서 의존성을 추가하면 배포가 깨집니다.
  - 시크릿이 없으면 조용히 건너뜁니다 (Slack과 같은 방식, `src/slack.js:136-140`).
- 웹 푸시는 iOS에서 홈 화면 추가 후에만 동작하므로 기대지 않습니다.

---

## 9. 개인정보·보안

### 9-1. 공개 사다리 (`src/work/reveal.js`, 순수 함수 + 시험)

| 보는 사람 / 단계 | 보이는 것 | 절대 안 보이는 것 |
|---|---|---|
| 승인 작업자, 모집중 | 종류, 제목, 시/구, 날짜·시간, 범위, 작업 코드, 금액(`pay_visible`일 때만) | 고객 이름, 주소, 연락처, 주문 금액, 원가, 다른 신청자 |
| 배정 작업자, 공장 작업 | + 주문번호, 가린 이름(홍*동), (4주차) 금액 없는 작업지시서 묶음 | 연락처 |
| 배정 작업자, 현장 작업, 공개 기간 안 (결정 7) | + 주소·상세, 층, 엘리베이터, 출입, 연락처 이름·번호 (`design_site_info`에서 실시간, 열람마다 `site_viewed`) | 금액, 마진 |
| 공개 기간 후 | 시/구, 가린 이름, 내 사진·타임라인·평가 | 주소, 연락처 |
| 관리자 | 전부 | – |
| Slack, 공유 문구 | 종류, 시/구, 날짜, 링크 | 주소, 연락처, 실명 |

### 9-2. 저장하지 않는 것
- **주민등록번호는 어떤 표, 어떤 단계에도 저장하지 않습니다.** 원천징수 신고(지급명세서)에 필요한 식별정보는 세무사가 시스템 밖에서 받습니다.
- 계좌번호도 MVP에서는 받지 않습니다.
- SQL 시험이 `rrn`, `주민`, `bank`, `account_no` 같은 열 이름이 생기면 실패하게 합니다.

### 9-3. 서버 규칙
- service_role은 RLS를 우회합니다. 그래서 **모든 라우트가 직접 행을 불러와 호출자와 비교**합니다.
- 남의 행은 403이 아니라 **404**를 돌려줍니다 (`revokeWorkerLink` 방식, `worker-access.js:59-60`).
- 경로의 id가 UUID가 아니면 422를 돌려줍니다. 라우터는 검증하지 않습니다(`router.js:25`).
- 라우트마다 시험을 하나씩 둡니다.
- 개인정보가 담긴 응답에는 `Cache-Control: no-store`를 붙입니다 (`jsonResponse`, `cors.js:41`).
- 새 헤더 `X-Invite-Token`을 `cors.js:30-31`의 허용 목록에 추가합니다.
- 새 표가 아직 없으면 500 대신 빈 결과를 돌려줍니다 (`isMissingRelation`, `work-order-data.js:31`).
- 사진 업로드:
  - 서버가 고른 경로 `{job}/{assignment}/{uuid}.jpg`에 대해서만 서명 업로드 URL을 줍니다 (`POST /storage/v1/object/upload/sign/...`).
  - commit 단계에서 파일이 실제로 있는지 확인하고, 경로만 저장합니다.
  - 읽기는 관리자와 해당 배정 작업자에게만 1시간 서명 URL로 줍니다 (`src/storage.js:18-43`).

### 9-4. 화면 규칙
- 작업자가 쓴 글은 관리자 화면에, 관리자가 쓴 글은 작업자 화면에 나옵니다. 모두 `esc()`로 이스케이프합니다.
- Supabase 세션과 `dadamWorkerToken`이 둘 다 localStorage에 있습니다. 사이트 어디든 XSS가 한 군데만 있어도 둘 다 털립니다.
- **0번 PR에서 `login.html:867-870`의 열린 리다이렉트를 먼저 고칩니다.** 같은 사이트의 상대 `*.html` 경로만 허용합니다. 그 전에는 작업자에게 로그인 링크를 보내지 않습니다.
- OAuth `redirectTo`가 `/index.html`로 고정돼 있습니다(`login.html:854`, `signup.html:1361,1378`). 이를 고쳐 원래 가려던 페이지로 돌아오게 합니다.
- `login.html`에는 카카오 버튼이 없습니다(가입 화면 `signup.html:1376`에만 있음). 카카오 버튼을 추가합니다.

### 9-5. 공개 저장소
- 시험, 시드, PR 본문, Actions 로그에 실제 작업자나 고객의 이름·전화번호를 넣지 않습니다.
- 새 시크릿(알림톡 키, `COMPANY_OWNER_ID`)은 `wrangler secret put`으로 넣고, `wrangler.toml`에는 주석으로 이름만 적습니다.

### 9-6. 법·동의 (노무사·세무사 확인 필요)
- 가입 시 수집 항목, 목적, 보관 기간을 나열한 동의를 받습니다. 사진 동의는 따로 받습니다.
- `privacy.html`과 `terms.html`은 아직 없습니다(`login.html:692`이 링크만 걸고 있음). 외주 기사에게 고객 정보를 넘기는 것은 개인정보 처리 위탁이므로 처리방침에 공개해야 합니다.
- 근로자성: 3.3% 외주에게 의무 일일 보고, GPS, 거절 벌칙, 태도 평가를 하면 근로자로 볼 위험이 커집니다. 그래서 **결과물 검수**로만 평가하고 거절은 자유롭게 둡니다.
- 사진에는 고객 집이 찍힙니다. 비공개 버킷에 두고 보관 기간을 정합니다 (결정 9).

### 9-7. 이미 있는 누출 (사장님 확인 후 정리, 결정 15)
- 공장 작업자 화면에 고객 실명이 나옵니다: `src/production/service.js:156,415`의 `${customer_name} (${order_no})`가 `production-worker.html`과 `order_label`로 흘러갑니다.
- `src/production/planner.js:286`의 문구 `(일당 ${assemblerDay/10000}만)`이 `production_assignments.text`를 거쳐 작업자 화면에 나옵니다. 코드 규칙 "금액(일당·비용)은 작업자 화면에 내보내지 않는다"(`worker-access.js:7`)와 어긋납니다.
- 새 포털은 이 문구들을 **복사하지 않고** 새로 씁니다.

---

## 10. 평가·피드백 설계

| 항목 | MVP (2주차) | 나중 |
|---|---|---|
| 회사 → 작업자 | 검수 승인(`accepted`) 후에만. 총점 1–5와 코멘트. 2점 이하면 사유 칩 필수. "재작업 필요" 체크 시 `addRework`로 `rework_logs` 한 행을 만들고 `rework_log_id`에 연결 | 항목별(`scores jsonb`): 품질, 일정, 현장 정리, 소통 중 사장님이 고른 것. 종류별로 맞는 항목만 표시 |
| 공개 | 초안으로 저장하고 사장님이 [공개]를 눌러야 작업자에게 보입니다. 자동 공개 시간 규칙은 두지 않습니다 | – |
| 작업자가 보는 것 | 공개된 **내 평가만**. 순위표 없음 | – |
| 관리자가 보는 것 | 작업자별 평균과 건수("4.6 · 12건"). 한 건이 평균을 좌우하지 않게 건수를 같이 보여 줌 | 경영 대시보드에 외주 성적표 (`admin/management.html`) |
| 분쟁 | 작업자가 답글이나 이의를 답니다(기간 N일은 결정 8). 편집자가 해결하면 `frozen_at`이 찍히고 이벤트로 남습니다. 평가는 항상 사진과 이벤트로 추적 가능 | – |
| 작업자 → 회사 (선택, 결정 8) | 1–5점 + 칩 (도면·지시 정확도, 자재 준비, 일정 변경 통보). 익명 아님. 관리자만 읽음 | 칩을 `rework_logs.cause`의 `design`/`measure`/`material`/`customer`와 묶어 원인 통계로 |
| 직원 (재단 월급 등) | 평가하지 않음 (결정 8) | 사장님이 원하면 비공개 인사 메모 |
| 고객 평가 | 연결하지 않음 | `install_feedback` 점수를 사장님이 본 뒤 요약해 기사 실적에 참고 (이름·주소 없이) |

---

## 11. 단계별 PR 계획

### 11-1. 먼저 할 일: CLAUDE.md 소유권 행 추가 (사장님 승인)

| 도메인 | 소유 파일 | 브랜치 prefix |
|---|---|---|
| **Worker Portal (새로)** | `worker.html`, `js/worker-portal.js`, `js/mypage-work.js`, `admin/work-jobs.html`, `mypage.html`의 `#myWorkSection` 부분, `database/work-jobs*.sql`, `login.html`·`signup.html`의 리다이렉트 부분 (0번 PR) | `agent/worker-*` |
| Workflow Worker (기존) | `workers/workflow-api/src/work/**`, `production.html` 버튼, `production-worker.html` 연결 버튼 | `agent/workflow-*` |

### 11-2. 모든 PR 공통
- 워크트리에서 작업하고 main에 직접 커밋하지 않습니다.
- Worker PR은 열기 전에 `workers/workflow-api`에서 `node --test "test/*.test.js"`를 돌립니다. 루트 jest는 `workers/`를 건너뛰기 때문입니다(`jest.config.js`).
- 머지한 뒤 `gh run list --workflow="Deploy Cloudflare Worker (workflow-api)" -L 1`과 `/health`를 확인합니다 (#683 함정).
- 공용 JS를 바꾸면 그 JS를 쓰는 **모든 페이지**의 `?v=`를 올립니다.
- 같은 도메인 안에서는 순차로 진행합니다. 백엔드(workflow)와 UI(worker)는 서로 다른 도메인이라 겹쳐 진행할 수 있습니다.

### 11-3. PR 목록

**1주차: 게시 → 신청 → 승인 → 마이페이지 → 완료 보고(글)**

**PR0 · `agent/worker-login-redirect`**
- 범위:
  - `login.html:867-870` 리다이렉트 허용 목록
  - OAuth `redirectTo`가 리다이렉트를 유지하도록 (`login.html:854`, `signup.html:1361,1378`)
  - `login.html`에 카카오 버튼
- 완료 기준·시험:
  - `__tests__/login-redirect.test.js`: `javascript:…`, `//evil`, `https://evil`은 `index.html`로 갑니다.
  - `worker.html`은 구글·카카오 로그인 뒤에도 유지됩니다.

**PR1 · `agent/worker-sql-core`**
- 범위:
  - `database/work-jobs.sql` 전체: 표 10개, `work_reports` kind 추가, RLS
  - `__tests__/work-jobs-sql.test.js`
- 사장님 할 일: SQL 실행 1회, `work-results` 버킷 생성.
- 완료 기준·시험:
  - 다시 실행해도 안전합니다(멱등).
  - 쓰기 정책이 없습니다.
  - 정책이 `is_admin()`만 호출합니다.
  - FK가 `SET NULL`입니다.
  - 주민번호·계좌 열이 없습니다.
  - 글자 수 CHECK가 있습니다.
  - `anon`이 REVOKE됐습니다.

**PR2 · `agent/workflow-work-core-api`**
- 범위:
  - `src/work/{access,workers,invites,jobs,assignments,updates,reveal,notify,policy}.js`
  - 라우트 (§11-4)
  - 글로만 하는 완료 보고
  - 사장님 Slack 알림
  - `test/work.test.js`
- 완료 기준·시험:
  - 대기 작업자가 신청하면 403입니다.
  - 중복 신청은 409입니다.
  - 정원을 넘겨 승인하면 409입니다(`version` 잠금).
  - 남의 배정은 404입니다.
  - 모집중 JSON에 `address`, `phone`, `customer_name`, `cost` 키가 없습니다.
  - `pay_visible=false`면 금액이 없습니다.
  - 잘못된 UUID는 422입니다.
  - 초대 링크는 1회용이고 만료됩니다.
  - 고객 계정이 `/work/admin/*`을 부르면 403입니다.
  - Slack 문구에 주소가 없습니다.

**PR3 · `agent/worker-admin-board`**
- 범위: `admin/work-jobs.html`(보드 + 작업자 탭), `ADMIN_NAV` 한 줄, `?v=` 올림
- 완료 기준·시험:
  - 관리자 셸 jest가 메뉴를 잡습니다.
  - 관리자가 아니면 `showAccessDenied`가 뜹니다.
  - 이름에 `<script>`를 넣어도 글자로 나옵니다.

**PR4 · `agent/worker-portal-ui`**
- 범위: `worker.html`, `js/worker-portal.js`, `js/mypage-work.js`, mypage 섹션
- 완료 기준·시험:
  - 작업자 행이 없는 고객에게는 섹션이 안 보입니다.
  - 375px에서 가로 스크롤이 없습니다.
  - 모든 칸이 `esc()`를 거칩니다.
  - noindex·no-referrer 메타가 있습니다.

**2주차: 사진, 검수, 평가**

**PR5 · `agent/workflow-work-photos-reviews`**
- 범위:
  - 사진 서명·commit
  - 보완요청·승인
  - 회사 정정(`amends_id`, `visible_to_worker`)
  - 평가 초안·공개·답글·이의·해결
  - `addRework` 연결, `safeRecord` 보관
- 완료 기준·시험:
  - 서명받지 않은 경로는 commit이 거부됩니다.
  - 배정되지 않은 작업의 사진 요청은 404입니다.
  - 회사 정정 후에도 원본 행이 그대로입니다.
  - 공개 전 평가는 작업자에게 안 보입니다.
  - 동결된 평가는 수정이 거부됩니다.
  - "재작업 필요"는 `rework_logs`를 정확히 1행 만듭니다.

**PR6 · `agent/worker-submit-review-ui`**
- 범위: 사진 제출(재인코딩, 대기열), 관리자 검수 격자, 평가 모달, 작업자 평가 탭
- 완료 기준·시험:
  - 재인코딩한 JPEG에 EXIF가 없습니다.
  - 재인코딩 코드에 "원본 그대로 반환" 분기가 없습니다.
  - 오프라인에서 돌아오면 대기열이 재시도합니다.

**3주차: 알림 정리, 현장 일정 연결**

**PR7 · `agent/workflow-work-notify`**
- 범위: `scheduled()` 요약, 마감 처리. 알림톡 어댑터는 결정 10 이후에.
- 완료 기준·시험:
  - 시크릿이 없어도 요청은 성공하고 아무것도 보내지 않습니다.
  - 같은 이벤트를 두 번 보내지 않습니다(`notified_at`).

**PR8 · `agent/workflow-work-schedule`**
- 범위:
  - 일정에서 초안 만들기
  - `assignee_name` 동기화
  - 공개 기간 안 설치지시서 인쇄 권한 (`getDocumentForPrint`, `src/worker.js:259-270` 확장)
- 완료 기준·시험:
  - 공개 기간 밖에서 인쇄 요청하면 404입니다.
  - 초안 문구에 금액과 실명이 없습니다.

**4주차 이후: 공장 연결, 토큰 링크 이전**

**PR9 · `agent/workflow-work-factory`**
- 범위:
  - 생산 지시에서 초안 만들기
  - 사람별 완료 → `production_assignments.done` 반영
  - `production_worklogs.worker_id`
  - `COMPANY_OWNER_ID`
  - `production-worker.html`의 "계정 연결"
  - 이미 있는 누출 정리 (결정 15)
  - 사장님 SQL 2회차
- 완료 기준·시험:
  - 보정(`calibration.js`) 결과가 변하지 않습니다.
  - 토큰 링크와 JWT로 한 번만 연결되고, 다른 사용자가 다시 연결하면 409입니다.
  - 옛 기록이 연결된 작업자 아래에 보입니다.

**PR10+ · 결정에 따라**
- 범위: 알림톡, 항목별 평가, 외주 성적표, 가능일 달력, 정산 초안(`order_costs`)

### 11-4. 라우트 요약 (`src/worker.js`의 기존 라우트 763-790 근처에 등록)

**작업자** (`auth:'jwt'` + `requireWorker`)
- `POST /work/register`, `POST /work/claim-invite`
- `GET /work/me`
- `GET /work/jobs?tab=open|mine|done`, `GET /work/jobs/:id`
- `POST /work/jobs/:id/apply`, `POST /work/applications/:id/withdraw`
- `POST /work/assignments/:id/{confirm,decline,start,release}`
- `POST /work/assignments/:id/updates`
- `POST /work/assignments/:id/photos/sign`, `POST /work/assignments/:id/photos/commit`
- `GET /work/reviews`, `POST /work/reviews/:id/{reply,object}`
- `POST /work/assignments/:id/review-company`

**관리자** (읽기 `isAdmin`, 쓰기 `assertAdminEditor`)
- `GET|PATCH /work/admin/workers[/:id]`, `POST /work/admin/invites`
- `GET|POST /work/admin/jobs`, `PATCH /work/admin/jobs/:id`
- `POST /work/admin/jobs/:id/{publish,cancel,close,assign,invite,updates}`
- `POST /work/admin/applications/:id/{approve,reject}`
- `POST /work/admin/assignments/:id/{accept,revision,remove,review}`
- `POST /work/admin/reviews/:id/{publish,resolve}`
- (3·4주차) `POST /work/admin/jobs/from-schedule/:id`, `POST /work/admin/jobs/from-assignment/:id`

---

## 12. 인프라·비용

| 항목 | 새로 필요한가 | 비용·부담 |
|---|---|---|
| 서버 | 없음. 기존 workflow-api에 모듈만 추가 | 요청량이 미미합니다 (**가정**: 현재 Workers 요금제 한도 안) |
| DB | 표 10개, SQL 실행 2회 (PR1, PR9) | 행 수가 적어 요금 영향은 무시할 수준 (**가정**) |
| 사진 저장 | 비공개 버킷 1개, 대시보드에서 생성 | **가정**: 월 40건 × 8장 × 0.4MB ≈ 월 130MB. Supabase 요금제의 저장 한도 확인 필요 (무료 1GB, Pro 포함량은 요금제 확인) |
| 시크릿 | MVP: 없음 (`SHARE_TOKEN_PEPPER`, `SLACK_WEBHOOK_URL` 재사용). PR9: `COMPANY_OWNER_ID` | – |
| 알림 | MVP: Slack, 앱 배지, 카톡 공유 버튼 (무료) | 알림톡은 건당 약 ₩7–15 (업체 확인 필요), 비즈니스 채널 인증, 템플릿 심사 1–3영업일 |
| cron | 새로 만들지 않고 기존 07:00에 추가 | – |
| 의존성 | npm 패키지 추가 없음 | 배포 워크플로 시험 단계에 `npm ci`가 없어 패키지를 추가하면 배포가 깨집니다 |
| 사장님 운영 시간 | SQL 실행 2회, 버킷 1회, 결정, 작업 게시·검수 | 전화·카톡 배정이 줄어드는 만큼 상쇄 (**가정**) |

---

## 13. 위험과 대응

| 위험 | 대응 |
|---|---|
| service_role이 RLS를 우회해 남의 작업이 보임 | 라우트마다 소유 검사, 404, 라우트별 시험 (PR2, PR5) |
| 외주 기사에게 고객 정보 과다 노출 | 공개 사다리, 공개 기간, `site_viewed` 기록, 처리방침에 위탁 공개 (`privacy.html` 작성) |
| XSS로 세션 탈취 | 양방향 `esc()`, 시험. 기존 관리자 페이지 XSS(`admin/users.html:939-940`, `admin/expert-requests.html:742-789`)는 별도 작업으로 정리 권장 |
| 로그인 열린 리다이렉트로 피싱 | PR0을 가장 먼저 |
| Worker 시험이 PR에서 돌지 않아 배포가 조용히 건너뛰어짐 | PR 전 `node --test`, 머지 후 배포 런과 `/health` 확인 |
| 근로자성 재분류 | 결과물 검수만, GPS 없음, 거절 자유, 자동 벌칙 없음. 노무사·세무사 확인 |
| 설치 기사가 계정 만들기를 꺼림 | 카카오 로그인, 초대 링크(신청서 자동 채움), 카톡 공유. 전화 방식도 병행 |
| 실제 DB의 `admin_roles` CHECK 불명 | 역할 값을 추가하지 않습니다. `EDITOR_ROLES`만 씁니다 |
| 두 관리자가 동시에 승인해 정원 초과 | `work_jobs.version` 낙관적 잠금, 409 |
| 사장님에게 승인이 몰림 | 직원은 직접 배정, 초대 모드, 07:00 요약으로 한 번에 처리 |
| 같은 작업 폴더를 여러 세션이 함께 씀 | 워크트리 사용. 워크트리에 `node_modules` 정션 금지(`npm ci`) |
| 규칙을 지어 넣을 위험 (금액, 벌칙, 기간) | `policy.js`에는 사장님이 확정한 값만 넣습니다. 미정이면 해당 PR을 보류합니다 |

---

## 14. 사장님이 정해야 할 것

★ 표시는 **1주차 시작 전에 꼭** 필요한 결정입니다.

| # | 질문 | 선택지 | 추천 |
|---|---|---|---|
| ★1 | 첫 대상 작업자와 작업 종류 (`kind` 목록, CHECK에 들어감) | (가) 외주 설치·A/S (나) + 조립 일당 추가 인원, 엣지 연장 (다) 전부 | 지금 전화·카톡으로 부르는 일부터: 설치, A/S, 조립 추가 인원. 월급 재단은 직접 배정만 |
| ★2 | 설치는 외주인가, 자체+외주인가? | `standards.js:110` "시공 외주" vs `docs/01-plan/work-order-stage.plan.md:77` "설치 자체+외주"가 어긋남 | 현재 기준을 알려 주세요 |
| ★3 | 작업자 가입 방식 | 초대만 / 공개 신청 + 승인 / 둘 다 | 둘 다. 아는 사람은 초대 링크로 바로, 그 외는 신청 후 승인 |
| ★4 | 배정 방식 | 사장님 선택 / 선착순 / 직접 지정 | 사장님 선택 + 직접 지정. 선착순은 쓰지 않음 |
| ★5 | **"작업을 했던 유저라면 회사에서 작업 내용을 업데이트"의 뜻** | (가) **작업자 보고**: 작업한 사람이 진행·결과·사진·추가 사항을 회사에 올림. 끝난 뒤 N일까지 추가 보고 (가)와 (나) 모두 같은 작업 타임라인에 덮어쓰지 않고 쌓입니다.<br>(나) **회사 정정**: 회사가 그 작업자의 기록(시간·수량·품질 메모·나중에 발견된 재작업)을 고침. 원본은 남기고 정정 기록으로 쌓음. 작업자에게 보일지 매번 선택<br>(다) **경력자 우선**: 다담 일을 해 본 적 있는 작업자에게만 회사가 새 작업 소식을 보여 주거나 보냄 | 셋 다 지원 가능합니다. 1주차는 (가)+(나), (다)는 초대 모드의 "함께 일한 작업자" 필터로 2주차. 어느 뜻이었는지와 (가)의 N일을 알려 주세요 |
| ★6 | 공고에 금액을 보일지, 단위는 | 숨김 / 그 작업의 지급액만 / 항상. 단위: 일, 시간, m, 건 | 작업마다 `pay_visible`로 고름 (기본 숨김). 원가·마진은 절대 안 보임. 금액은 매번 사장님이 입력하고 `standards.js` 단가를 자동으로 채우지 않음 |
| ★7 | 주소·연락처 공개 기간 | 확정 즉시부터 / D-1부터 ~ 승인 후 N일까지 | **사장님 결정** (제안: 확정 ~ 승인 후 7일 — 정본 규칙 아님). 결정 전에는 주소를 공개하지 않음 |
| 8 | 평가: 방향, 항목, 작업자 열람, 이의 기간, 직원 평가 여부, 문제·사유 칩 목록 | 단방향 / 양방향 | 회사→작업자는 사장님 공개 후 열람. 작업자→회사는 선택·비익명. 직원은 MVP에서 평가 안 함. 항목·칩·N은 사장님이 정함 |
| 9 | 종류별 필수 사진, 사진 보관 기간 | 90일 / 1년 / A/S 보증 기간 | 필수 사진은 사장님이 종류별로 지정. 보관은 A/S 기간에 맞추기를 권함 |
| 10 | 작업자 알림 채널 | 앱 배지 + 카톡 공유 / 알림톡(업체·채널) / SMS | MVP는 앱 배지 + Slack + 카톡 공유. 알림톡은 업체·비즈니스 채널·발신번호를 정한 뒤 |
| 11 | 공장 토큰 링크 (`production-worker.html`) | 유지 / 계정으로 이전 | 4주차까지 유지하고, 그 뒤 계정 연결 후 새 발급 중단, 최대 365일 만료로 자연 종료 |
| 12 | 회사 범위 | 관리자 전원 / 사장님 계정만 | 조회는 관리자 전원, 쓰기는 `super_admin`·`admin` (2026-10-18 보고 보관함과 같은 방식) |
| 13 | 수집 개인정보와 동의 문구 | – | 이름, 휴대폰(선택 여부 결정), 종류, 활동 지역, 사진(별도 동의). 주민번호는 절대 받지 않음, 계좌는 MVP 제외. `privacy.html` 작성 |
| 14 | 취소·포기·노쇼 규칙 | 기록만 / 마감 시각 / 수수료 / 제재 | MVP는 기록만. 규칙은 운영해 본 뒤 결정 |
| 15 | 공장 화면의 고객 실명과 일당 문구 정리 (`service.js:156,415`, `planner.js:286`) | 그대로 / 가린 이름 + 금액 제거 | 정리를 권합니다 (코드 규칙 `worker-access.js:7`과 일치) |
| 16 | CLAUDE.md "Worker Portal" 소유권 행 | §11-1 표 | 승인해 주세요 |
| 17 | 조립 일당의 세무 구분 (세무사 확인) | 일용근로 6.6% / 사업소득 3.3% | 정산 단계 전에 세무사 확인 (시스템 밖) |

---

## 15. 일정 추정

**가정**
- 최근 경영 대시보드 1~3단계(#824~#879)가 며칠 만에 머지된 에이전트 속도를 기준으로 합니다.
- 같은 도메인 안의 PR은 순차로 진행합니다.
- 병목은 개발이 아니라 **사장님 결정과 SQL 실행**입니다.

| 시기 | 개발 | 사장님 할 일 | 결과 |
|---|---|---|---|
| 0일차 | 계획 확정 | ★결정 1–7, 소유권 행 승인 | – |
| 1주차 (5영업일) | PR0 → PR1 → PR2 (백엔드), PR3·PR4 (UI는 PR2 머지 뒤 겹쳐 진행) | SQL 1회 실행, 버킷 생성, 작업자 2–3명 초대, 시범 작업 1–2건 게시 | **게시 → 신청 → 승인 → 마이페이지 → 시작 → 완료 보고(글)** 사용 가능 |
| 2주차 | PR5 → PR6 | 필수 사진, 평가 항목·칩, 이의 기간 확정 | 사진 제출, 검수(보완요청), 평가·답글 |
| 3주차 | PR7, PR8 | 일정 연동 확인, 알림톡 여부 결정 | 07:00 요약, 일정에서 작업 만들기, 설치지시서 열람 |
| 4주차 이후 | PR9, PR10+ | SQL 2회차, 토큰 링크 이전과 누출 정리 결정, 알림톡 업체·채널 (심사 1–3영업일 별도) | 공장 작업 연결, 기록 이전, 알림톡 |

**합계**
- 첫 사용: 약 **1주**
- 사진·평가까지: 약 **2주**
- 현장 일정 연결까지: 약 **3주**
- 공장·알림톡까지: **4주 이상** (결정 시점에 따라 달라짐)