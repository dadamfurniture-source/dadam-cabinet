# SaaS 구독 결제 시스템 설계 문서

> **상태**: 설계 준비 단계 — 실제 구현은 후속 스프린트에서 진행
> **브랜치**: `claude/prepare-payment-system-6LyO9`
> **작성일**: 2026-04-20

## Context

다담가구의 SaaS 구독 결제(free / basic / pro / enterprise)를 고객에게 공개하기 위한 준비 단계.

**현재 상태**:
- 백엔드 `multiagent/api/routes/payments.py` — Stripe 기반 구독 플로우(checkout / change / cancel / webhook) 완성
- DB `subscriptions`, `profiles` 테이블은 존재하나 Stripe 전용 컬럼만 보유
- **누락**: 한국 간편결제 지원, 고객 노출용 프론트 UI, 결제 이력 / 영수증 인프라

**이번 작업 범위**: 코드 구현 없음. **설계 문서 + 준비 체크리스트만** 확정하여 후속 구현 스프린트 언블록.

## 결정 사항

| 항목 | 결정 |
|------|------|
| 결제 유형 | SaaS 구독 플랜 (free / basic / pro / enterprise) |
| PG사 | Stripe + 토스페이먼츠 이중 지원 (provider 추상화) |
| UI | Next.js App Router (`/app/pricing`, `/app/account/billing`) |
| 범위 | 설계 문서 + 준비 체크리스트 |

## 1. Payment Provider 추상화

**신규 모듈**: `multiagent/shared/payment_providers/`

```
payment_providers/
  __init__.py        # 레지스트리 + get_provider(hint, user) 리졸버
  base.py            # PaymentProvider ABC + CheckoutResult / ChargeResult dataclasses
  stripe_provider.py # 기존 payments.py 로직 이관
  toss_provider.py   # Toss REST API (httpx)
```

**인터페이스 (base.py)**

```python
class PaymentProvider(ABC):
    name: str  # "stripe" | "toss"
    async def create_checkout(user, plan, success_url, cancel_url) -> CheckoutResult
    async def change_plan(sub_row, new_plan) -> None
    async def cancel(sub_row, at_period_end=True) -> None
    async def verify_webhook(raw_body, headers) -> dict  # 정규화된 이벤트
    async def handle_event(event, db) -> None            # 멱등 DB 동기화
    # Toss 전용:
    async def issue_billing_key(user, auth_key, customer_key) -> str
    async def charge_billing_key(sub_row) -> ChargeResult
```

`CheckoutResult` 는 `redirect_url | client_payload` 양쪽을 허용 → 프론트가 Stripe(리다이렉트)와 Toss(위젯) 통일된 방식 처리.

**Provider 선택 규칙** (`get_provider`):
1. 명시적 선택(UI 라디오)
2. 국가 / 로케일 (한국 → toss)
3. 기본값 (`default_payment_provider` env)
4. `subscriptions.provider` 컬럼에 기록 → 이후 change / cancel 자동 라우팅

## 2. DB 스키마 마이그레이션

**신규 파일**: `multiagent/db/migrations/002_payment_providers.sql`

기존 `subscriptions` 테이블은 `stripe_customer_id` / `stripe_subscription_id` 만 보유. **권장안: Generic 컬럼 추가 + 기존 stripe_* 유지** (백필 후 후속 마이그레이션에서 drop).

**추가 컬럼**:
- `provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe','toss'))`
- `provider_customer_id TEXT` (Stripe customer ID 또는 Toss customerKey)
- `provider_subscription_id TEXT`
- `billing_key TEXT` (Toss 전용, pgcrypto 암호화)
- `next_charge_at TIMESTAMPTZ` (Toss 스케줄러 대상)

**신규 테이블**:
- `payment_events` — 웹훅 멱등성 (`provider`, `event_id UNIQUE`, `payload JSONB`, `processed_at`)
- `payment_history` — 결제별 이력 (`user_id`, `provider`, `amount_krw`, `tax_amount`, `status`, `receipt_url`, `order_id`, `created_at`) → 빌링 페이지 "결제 내역" 데이터 소스

**인덱스**:
```sql
CREATE INDEX idx_subscriptions_next_charge
  ON subscriptions(next_charge_at)
  WHERE provider='toss' AND status='active';
```

**백필**:
```sql
UPDATE subscriptions
SET provider='stripe',
    provider_customer_id = stripe_customer_id,
    provider_subscription_id = stripe_subscription_id
WHERE stripe_customer_id IS NOT NULL;
```

## 3. 토스페이먼츠 통합 핵심

> **중요**: Toss 는 Stripe 와 달리 **서버사이드 구독 수명주기를 관리하지 않음**. 앱이 직접 월별 과금 스케줄러를 돌려야 함.

### 3-1. 빌링키 발급 플로우

1. 프론트 `@tosspayments/payment-sdk` 로드 → `requestBillingAuth({ customerKey })` 호출
2. 카드 인증 후 Toss 가 `authKey` 를 success URL 로 반환
3. 프론트 → 백엔드 `POST /payments/toss/issue-billing-key { authKey, customerKey, plan }`
4. 백엔드 → Toss `POST /v1/billing/authorizations/issue` → `billingKey` 수신
5. `billing_key` 를 pgcrypto 로 암호화 저장, 즉시 1 회차 과금, `next_charge_at = now()+30d`

### 3-2. 반복 과금 스케줄러

**신규 파일**: `multiagent/agents/scheduler/toss_billing_cron.py`

- 매시간 실행
- 쿼리: `SELECT * FROM subscriptions WHERE provider='toss' AND status='active' AND next_charge_at <= now()`
- 각 건마다 Toss `POST /v1/billing/{billingKey}` 호출 (`customerKey`, `amount`, `orderId=uuid()`, `orderName`)
- 성공: `next_charge_at += 1 month`, `payment_history` insert, 영수증 URL 저장
- 실패: `status=past_due`, 재시도 스케줄 (3 / 7 / 14 일), 알림 발송
- Redis 락으로 동시 실행 방지

### 3-3. 신규 엔드포인트

**신규 파일**: `multiagent/api/routes/payments_toss.py`

- `POST /payments/toss/issue-billing-key` — authKey → billingKey 교환
- `POST /payments/toss/charge` — 관리자 수동 재시도
- `POST /payments/toss/webhook` — 가상계좌 입금 / 실패 이벤트 (서명 검증)

## 4. Config / Env

**수정**: `multiagent/shared/config.py` — `Settings` 에 추가

```python
toss_client_key: str = ""
toss_secret_key: str = ""
toss_webhook_secret: str = ""
toss_price_basic_krw: int = 9900
toss_price_pro_krw: int = 29900
toss_price_enterprise_krw: int = 99000
default_payment_provider: str = "toss"
```

**수정**: `.env.local.example` (프론트)

```
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_...
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_test_...
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

## 5. Next.js 프론트 구조

```
app/pricing/page.tsx              # 플랜 비교 카드 + PG 토글 + "구독 시작"
app/pricing/PlanCard.tsx          # 서버 컴포넌트
app/pricing/CheckoutButton.tsx    # 'use client' — Stripe / Toss 분기

app/account/billing/page.tsx              # 현재 플랜 / 다음 결제일 / 결제 이력
app/account/billing/ChangePlanModal.tsx   # 플랜 변경
app/account/billing/CancelDialog.tsx      # 구독 취소

app/billing/success/page.tsx      # ?session_id / ?orderId 검증 후 완료
app/billing/cancel/page.tsx       # 취소 안내

app/lib/api.ts                    # fetch wrapper (Supabase JWT 첨부)
app/lib/payments.ts               # createCheckout / changePlan / cancel / issueBillingKey
app/lib/supabase.ts               # 재사용 (기존 app/login/page.tsx 패턴)
```

**인증**: 기존 `app/login/page.tsx` 의 Supabase 브라우저 클라이언트 재사용. `api.ts` 가 `session.access_token` 을 `Authorization: Bearer` 헤더로 첨부 → FastAPI `get_current_user` 그대로 작동.

**Toss 위젯 통합**: `CheckoutButton.tsx` 가 provider=toss 일 때 `@tosspayments/payment-sdk` 동적 import → `requestBillingAuth({ successUrl: '/billing/success?provider=toss' })`. Stripe 경로는 `window.location = checkout_url`.

## 6. 한국 UX 요건

- **가격 표기**: `₩9,900/월 (VAT 포함)` — `payment_history.tax_amount` 별도 저장
- **결제수단 배지**: 카드 / 계좌이체 / 가상계좌 / 간편결제 (카카오페이 · 네이버페이 · 페이코) — Toss 위젯이 모두 커버
- **전자영수증**: Toss 과금 응답의 `receipt.url` 을 `payment_history.receipt_url` 에 저장, 빌링 페이지에 노출
- **현금영수증** (Phase 2): `/payments/toss/cash-receipt` 엔드포인트, Toss `POST /v1/cash-receipts` 호출
- **세금계산서**: business 고객 (`profiles.company_type` in 'interior' / 'factory') 에게 발행 옵션 — 기존 `revenue_entries.invoice_number` 연계

## 7. 준비 체크리스트

### 계정 / 인프라

- [ ] 토스페이먼츠 가맹점 계약 (테스트 키 즉시 / 실서비스 심사 필요)
- [ ] Stripe 대시보드에서 `stripe_price_basic / pro / enterprise` env 확인
- [ ] Supabase service role key 확인
- [ ] Redis 가용성 확인 (Toss 스케줄러 락)
- [ ] 운영 도메인에 Toss 웹훅 URL 등록: `https://api.dadam.kr/payments/toss/webhook`

### 코드 / 설정

- [ ] `002_payment_providers.sql` 스테이징 적용 + 백필 검증
- [ ] `.env` (multiagent) + `.env.local` (Next.js) 키 업데이트
- [ ] `pgcrypto` 확장 활성화 + `billing_key` 암호화 래퍼
- [ ] 스케줄러 런너에 `toss_billing_cron` 등록 (`multiagent/agents/scheduler/` 구조 확인 필요)

### 문서

- [ ] Toss 테스트 카드: https://docs.tosspayments.com/reference/test-card-code
- [ ] Stripe 테스트 카드: `4242 4242 4242 4242`
- [ ] Phase 2 항목 (현금영수증 / 세금계산서) 별도 백로그 등록

## 8. 수정 / 생성 파일 목록

### 신규 (NEW)

- `multiagent/shared/payment_providers/__init__.py`
- `multiagent/shared/payment_providers/base.py`
- `multiagent/shared/payment_providers/stripe_provider.py`
- `multiagent/shared/payment_providers/toss_provider.py`
- `multiagent/api/routes/payments_toss.py`
- `multiagent/db/migrations/002_payment_providers.sql`
- `multiagent/agents/scheduler/toss_billing_cron.py`
- `app/pricing/page.tsx`
- `app/pricing/PlanCard.tsx`
- `app/pricing/CheckoutButton.tsx`
- `app/account/billing/page.tsx`
- `app/account/billing/ChangePlanModal.tsx`
- `app/account/billing/CancelDialog.tsx`
- `app/billing/success/page.tsx`
- `app/billing/cancel/page.tsx`
- `app/lib/payments.ts`
- `app/lib/api.ts` (없을 경우)

### 수정 (MODIFY)

- `multiagent/api/routes/payments.py` — `get_provider(sub.provider)` 디스패치로 리팩토링, URL 경로 유지 (하위 호환), Stripe 전용 로직을 `stripe_provider.py` 로 이관
- `multiagent/shared/config.py` — Toss 설정 추가 (§4)
- `.env.example` (repo root) + `multiagent/.env.example` — 신규 키 문서화
- `multiagent/db/migrations/001_foundation.sql` 은 건드리지 않음 (신규 마이그레이션으로만)

## 9. 검증 계획

### 개발 환경

- Stripe 테스트 모드: `stripe listen --forward-to localhost:8000/payments/webhook`
- Toss 테스트: `test_ck_*` / `test_sk_*` + ngrok 으로 웹훅 터널

### 테스트 시나리오 (양쪽 PG)

1. 신규 구독: free → pricing → 플랜 선택 → checkout 완료 → `subscriptions` row 생성, `profiles.plan` 업데이트, success 페이지 렌더
2. 업그레이드 (basic → pro): Stripe 비례배분, Toss 차액 즉시 과금 + `payment_history` 기록
3. 다운그레이드 (pro → basic): 기간 종료 후 반영, `next_charge_at` 새 금액 반영
4. 취소: `cancel_at_period_end=true`, `current_period_end` 이후 `cancelled` 전환
5. 결제 실패: Stripe `4000 0000 0000 0341`, Toss 실패 테스트 카드 → `past_due`, 재시도 스케줄
6. 갱신: Stripe 자동 (웹훅), Toss → `next_charge_at` 을 과거로 수동 이동 후 크론 실행 → 과금 + 날짜 증가
7. 웹훅 멱등성: 같은 이벤트 재전송 → `payment_events.event_id UNIQUE` 가 중복 처리 차단
8. PG 스위칭: Stripe 활성 사용자가 Toss 선택 시 차단 또는 Stripe-cancel → Toss-subscribe 마이그레이션 플로우
9. RLS: A 사용자가 B JWT 로 `/subscription` 호출 → 401
10. 한국 UX: KRW 포맷, VAT 라인, Toss 성공 후 영수증 링크 노출 확인

### Critical Files

- `multiagent/api/routes/payments.py` (리팩토링)
- `multiagent/shared/payment_providers/base.py` (신규 인터페이스)
- `multiagent/db/migrations/002_payment_providers.sql` (스키마 기반)
- `multiagent/agents/scheduler/toss_billing_cron.py` (Toss 반복 과금 핵심)
- `app/pricing/page.tsx` (고객 진입점)
- `app/account/billing/page.tsx` (구독 관리 UX)

## Out of Scope (후속 스프린트)

- 실제 코드 구현 (이번 단계는 설계 문서만)
- 싱크대 가구 **주문 결제** (3 단계 계약금 / 중도금 / 잔금) — 별도 플랜으로 분리
- A/S 수수료 결제
- 관리자 결제 대시보드
- 현금영수증 / 세금계산서 자동 발행
- 이메일 영수증 발송 시스템
