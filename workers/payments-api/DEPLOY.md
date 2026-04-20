# dadam-payments-api — 배포 가이드

토스페이먼츠 빌링 구독 결제 백엔드 (Cloudflare Worker).

## 자동 배포 (권장)

`main` 브랜치에 `workers/payments-api/**` 변경이 푸시되면 GitHub Actions 가 자동으로 `wrangler deploy` 실행.

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
| POST | `/charge` | Bearer | 수동 재시도 |
| POST | `/cancel` | Bearer | 구독 취소 |
| POST | `/webhook` | 없음 | Toss 웹훅 (가상계좌 입금 등) |

## 토스 웹훅 등록

토스 대시보드 → 개발 연동 → 웹훅 → URL 등록:

```
https://dadam-payments-api.dadamfurniture.workers.dev/webhook
```

또는 커스텀 도메인 연결 후 `https://api.dadam.kr/webhook`.

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
