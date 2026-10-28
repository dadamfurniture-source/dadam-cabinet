# dadam-payments-api — 배포 가이드

토스페이먼츠 빌링 구독 결제 백엔드 (Cloudflare Worker).

## 자동 배포 (권장)

`main` 브랜치에 `workers/payments-api/**` 변경이 푸시되면 GitHub Actions 가 시험(`node --test`)을 돌린 뒤 자동으로 `wrangler deploy` 실행. PR 에서는 시험만 돈다.

> **DB 먼저.** `database/payments-lifecycle.sql` 을 Supabase 에 적용한 **뒤에** 머지한다.
> 워커가 그 칸(`failed_attempts` · `first_failed_at` · `cancel_reason` · `ended_at` · `refunded_*`)을 읽고 쓴다 — 없으면 `/subscription` 과 cron 이 실패한다.
> 업체 구독은 `database/migrations/0011_partner_signup.sql` 이 먼저다 (`subscriptions.company_id` · `companies.next_plan` · `company_credits` · `partner_applications` · 등급 맞추기 트리거).

## 업체 구독

Expert · Agent 결제는 모두 협력업체(`companies.kind = 'partner'`)의 구독이다 (`src/company.js`).

- 등급(`profiles.tier`)은 DB 트리거가 업체 plan · status 로 맞춘다 — 워커는 `profiles` 를 쓰지 않는다.
- 크레딧은 업체 통장(`company_credits`) 하나를 구성원이 함께 쓴다. 새 달 크레딧 = 업체 통장 기간 끊기.
- `/issue-billing-key` `{ auth_key, customer_key, plan, company?: { name, sido, gugun } }` — 결제 전에 막는다:
  본사 구성원 409 `hq_member` · 협력업체 실장/직원 403 `not_owner` · 업체에 살아 있는 구독 409 `already_subscribed` ·
  업체 등급과 다른 plan 409 `plan_mismatch` · Expert 업체 이름/지역 없음 422 `invalid`(+`field`) · Agent 승인 없음 403 `agent_not_approved`.
  - 구성원이 아니면 결제 뒤 업체(active) → 대표 구성원 → (Agent) 승인된 신청 `used_at` → 구독 행 → 업체 이력 `subscribed`.
  - 협력업체 대표면 그 업체로 (정지 · 해지였으면 active 로, 업체 통장 기간 끊기).
- `/subscription` — 대표: 업체 구독 + `company` + `role`, 실장 · 직원: `data: null` + `company` + `role`.
- `/subscription/retry` · `/subscription/card` · `/cancel` — 업체 구독은 대표만 (403 `not_owner`).

### 1회 Secret 등록 (이미 등록됐으면 스킵)

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 대시보드 → My Profile → API Tokens → Create Token → **"Edit Cloudflare Workers"** 템플릿 → Create → 생성된 토큰 복사 |
| `CLOUDFLARE_ACCOUNT_ID` | `8bd8e054dfc7bcdc577f9bb79edd3284` (wrangler.toml 에 박혀있음) |

`generate-api` 워커와 동일한 시크릿을 재사용합니다 (별도 추가 불필요).

### Cloudflare 대시보드 Secret 등록 (Worker 환경변수)

`wrangler.toml [vars]` 에 들어 있지 않은 민감 키는 별도 Secret 으로 등록:

```bash
cd workers/payments-api
npx wrangler login                                # 최초 1회만
npx wrangler secret put TOSS_CLIENT_KEY           # test_ck_* / live_ck_*
npx wrangler secret put TOSS_SECRET_KEY           # test_sk_* / live_sk_*
npx wrangler secret put SUPABASE_URL              # https://*.supabase.co
npx wrangler secret put SUPABASE_ANON_KEY         # JWT 검증용
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY # DB write 용
```

또는 Cloudflare 대시보드 → Workers & Pages → `dadam-payments-api` → Settings → Variables → Secret 으로 등록.

### 수동 트리거

GitHub → **Actions → Deploy Cloudflare Worker (payments-api) → Run workflow**.

## 수동 배포 (로컬 검증)

```powershell
cd C:\Users\hchan\dadam-cabinet\workers\payments-api
npx wrangler login
npx wrangler deploy
```

배포 성공 시 `https://dadam-payments-api.dadamfurniture.workers.dev/` 로 즉시 반영.

## 배포 확인

```powershell
curl https://dadam-payments-api.dadamfurniture.workers.dev/health
# → {"status":"ok","service":"dadam-payments-api","worker":true}

curl https://dadam-payments-api.dadamfurniture.workers.dev/plans
# → {"success":true,"data":{"client_key":"test_ck_...","plans":[...]}}
```

## 엔드포인트

| Method | Path | Auth | 설명 |
|--------|------|------|------|
| GET | `/health` | 없음 | 헬스체크 |
| GET | `/plans` | 없음 | 플랜 + Toss client_key |
| GET | `/subscription` | Bearer | 현재 구독 조회 |
| POST | `/issue-billing-key` | Bearer | authKey → billingKey + 첫 과금 |
| POST | `/subscription/retry` | Bearer | 지금 다시 결제 — 결제 실패 재시도 중(`past_due`)인 본인 구독만 (아래) |
| POST | `/subscription/card` | Bearer | 카드 바꾸기 — `{ auth_key, customer_key }` → 새 빌링키, 재시도 중이면 바로 결제 (아래) |
| POST | `/charge` | Bearer | 예전 경로 — `/subscription/retry` 와 같다 |
| POST | `/cancel` | Bearer | 구독 취소 (이용 중 · 결제 실패 재시도 중) |
| POST | `/admin/refund` | Bearer (관리자) | 결제 1건 환불 — `{ payment_id, reason?, override? }` (아래) |
| POST | `/webhook` | 없음 | Toss 웹훅 — `PAYMENT_STATUS_CHANGED` 만 기록 (아래) |

## 구독 수명주기 (cron)

`wrangler.toml [triggers] crons = ["0 19 * * *"]` — 하루 한 번 **KST 04:00**. 코드는 `src/lifecycle.js`.

| 상황 | 하는 일 |
|------|---------|
| 이용 중, `next_charge_at <= 지금` | 저장된 빌링키로 결제. 성공 → `payment_history` done, 기간 +30일(지난 기간 끝에서), 등급 그대로, 크레딧 기간 끊기(다음 사용 때 월 지급량으로 채움) |
| 결제 실패 | `past_due`, 첫 실패 **1일 뒤** · **3일 뒤** 재시도. 그동안 등급 유지 |
| 마지막 재시도도 실패 | 해지(`cancel_reason = payment_failed`) → 결제로 받은 등급(`tier_source = 'subscription'`)이면 standard |
| 고객 해지 | 이번 기간 끝(`current_period_end`)까지 등급 유지, 지나면 standard (결제로 받은 등급만), `ended_at` 기록 |

- standard 로 내릴 때(마지막 실패 · 해지 만료 · 환불) `tier_source` 도 `'manual'` 로 돌린다. 본사 승인 등급(`manual`)은 처음부터 건드리지 않는다.
- 업체 구독: 결제 금액은 업체 `next_plan`(없으면 `plan`) 등급의 값. 성공하면 구독 `plan` · `amount_krw` 와 업체 `plan` 을 옮기고 `next_plan` 을 비운다 (실패면 그대로).
  등급 대신 업체 status 를 바꾼다 — 마지막 실패 `suspended`, 해지 기간 끝 · 환불 `closed` (그 업체에 살아 있는 다른 구독이 있으면 그대로).
  환불의 크레딧 사용 확인은 업체 통장 줄(`credit_ledger.company_id`)로.
- 정기 결제 주문번호는 `dadam-sub-{user}-{기간끝 UTC yyyymmddHHMM}-{회차}` — 같은 기간·회차면 같은 값이고 토스 `Idempotency-Key` 로도 쓴다. 응답을 못 받고 끊기면 다음 날 같은 키로 다시 보내 두 번 결제되지 않는다.
- 결과를 모르는 오류(연결 끊김 · JSON 아닌 응답 · `IDEMPOTENT_REQUEST_PROCESSING`)와 가맹점 키 오류(`UNAUTHORIZED_KEY` 등)는 카드 실패로 세지 않고 다음 날 다시 한다.
- 결제 실패·해지 안내는 `billing.html` 이 구독 상태로 보여 준다 (메일·문자 알림은 아직 없음).
- 로그: `npx wrangler tail` 에서 `[payments] lifecycle {...}` 요약 한 줄.

## 지금 다시 결제 · 카드 바꾸기

`billing.html` 은 구독이 결제 실패로 재시도 중(`past_due`)일 때만 두 버튼을 보여 준다.

- **지금 다시 결제** `POST /subscription/retry` — 저장된 빌링키로 cron 과 같은 길(`chargePastDueNow` → `chargeOnce`)로 결제.
  - 성공: cron 재시도 성공과 같다 (`active`, `failed_attempts = 0`, `first_failed_at = null`, 기간 +30일, `next_charge_at`, 결제 기록, 새 달 크레딧).
  - 거절: 결제 기록(`failed`)만 남기고 재시도 일정(+1일 · +3일)·횟수·등급은 그대로. 402 + 토스 실패 문구.
  - 이용 중(`active`)이면 409 `NOT_PAST_DUE`.
- **카드 바꾸기**: `billing.html` → 토스 `requestBillingAuth('CARD')` → `billing.html?card=ok&authKey&customerKey` → `POST /subscription/card`.
  - `customer_key` 가 이 구독의 `provider_customer_id`(= `dadam-{user}`)와 다르면 400 `CUSTOMER_KEY_MISMATCH` — 토스를 부르지 않는다.
  - 새 빌링키로 `billing_key` 를 바꾸고, 재시도 중이면 바로 새 카드로 결제해 결과를 `data.charge` 로 돌려준다.
  - 예전 빌링키는 응답·로그 어디에도 없다.
- 응답의 구독은 `/subscription` 과 같은 공개 칸만 (`billing_key` · 잠금 · 주문번호 없음).

### 결제 잠금 (두 번 누름 · cron 과 겹침)

결제하는 길(cron · 지금 다시 결제 · 카드 바꾼 뒤 결제)은 모두 먼저 구독 행을 잠근다 — 조건부 PATCH 한 번:
`charge_lock_until` 이 비었거나 지났고, 상태가 기대한 그대로이고, `charge_order_id` 도 읽은 그대로일 때만 잠금(5분)과 주문번호를 쓴다. 0행이면 409(이미 결제 중).

- 결과가 확정되면(성공·거절) 같은 PATCH 안에서 잠금을 푼다.
- 결과를 모르면(연결 끊김) 잠금과 주문번호를 남긴다. 다음 결제는 그 주문번호부터 토스에 묻는다(`GET /v1/payments/orders/{orderId}`) — 이미 됐으면 기록만 하고 다시 결제하지 않는다.
- 결제 중이면 해지·카드 바꾸기도 409 로 잠시 막는다.
- 고객이 누른 결제의 주문번호는 누를 때마다 새로 만든다 — 정기 결제 주문번호와 겹치면 실패 응답이 멱등키에 남아 예정된 재시도가 카드를 다시 긁지 못한다.

## 관리자 환불

`admin/users.html` → 회원 상세 → 「구독 · 결제」의 **환불** 버튼. 서버가 호출자 토큰으로 `is_admin()` 을 다시 확인한다.

- 약관 제9조: 결제 후 **7일 이내** 그리고 그 결제 뒤 **크레딧 사용 없음**(원장의 되돌려지지 않은 차감이 없음) → 전액 환불.
- 조건을 벗어나면 409 `REFUND_NOT_ELIGIBLE` + `reasons`. `override: true` 로 다시 보내야만 진행하고 `payment_history.refund_override = true` 로 남는다.
- 환불하면: 토스 결제 취소(`POST /v1/payments/{paymentKey}/cancel`, 멱등키 `dadam-refund-{id}`) → 구독 즉시 종료(`cancel_reason = refunded`) → 결제로 받은 등급이면 standard → 결제 기록 `refunded`.

## 첫 결제 되돌리기

`/issue-billing-key` 는 토스 결제 뒤 DB 저장(결제 기록 → 업체 → 대표 구성원 → 신청 · 업체 status → 구독 행)이 실패하면 그 결제를 토스에서 취소하고(멱등키 `dadam-undo-{orderId}`) 만든 행을 지운다 (구독 → 신청 되돌림 → 업체 status 되돌림 → 구성원 → 업체). 업체 이력은 지울 수 없어 저장이 다 끝난 뒤에 넣는다. 취소마저 실패하면 `AUTO-CANCEL FAILED — manual refund needed` 로그가 남는다 — 토스 대시보드에서 직접 취소할 것.

## 토스 웹훅 등록

토스 대시보드 → 개발 연동 → 웹훅 → URL 등록:

```
https://dadam-payments-api.dadamfurniture.workers.dev/webhook
```

또는 커스텀 도메인 연결 후 `https://api.dadam.kr/webhook`.

이벤트는 **`PAYMENT_STATUS_CHANGED`** 를 고른다. 워커는 이 이벤트만 기록하고 나머지는 200 으로 넘긴다.

- 이 이벤트에는 서명 헤더가 없다. 워커가 본문의 `paymentKey` 로 결제 조회 API(`GET /v1/payments/{paymentKey}`)를 `TOSS_SECRET_KEY` 로 다시 불러, 그 응답만 `payment_events` 에 남긴다. 토스에 없는 결제거나 주문번호·금액이 다르면 401.
- 본문은 64KB 까지만 받는다 (넘으면 413).
- 새 시크릿·환경변수는 없다 — 이미 있는 `TOSS_SECRET_KEY` 를 쓴다.
- 문서: https://docs.tosspayments.com/reference/using-api/webhook-events

## 프론트엔드 연결

Vercel/로컬 `.env.local` 에:

```
NEXT_PUBLIC_API_BASE=https://dadam-payments-api.dadamfurniture.workers.dev
```

> `app/lib/payments.ts` 가 `${NEXT_PUBLIC_API_BASE}/plans` 같은 경로로 호출하도록 작성되어 있음.

## 로그 보기

```powershell
cd workers/payments-api
npx wrangler tail
```
