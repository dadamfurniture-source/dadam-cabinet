# dadam-generate-api — 배포 가이드

## 자동 배포 (권장)

`main` 브랜치에 `workers/generate-api/**` 하위 파일 변경이 푸시되면 GitHub Actions 가 자동으로 `wrangler deploy` 실행.

### 1회 Secret 등록 (이미 등록됐으면 스킵)

GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 대시보드 → My Profile → API Tokens → Create Token → **"Edit Cloudflare Workers"** 템플릿 → Create → 생성된 토큰 복사 |
| `CLOUDFLARE_ACCOUNT_ID` | `8bd8e054dfc7bcdc577f9bb79edd3284` (wrangler.toml 에 박혀있음) |

등록 후 main 으로 푸시 → 자동 배포. 진행 상황은 GitHub → **Actions** 탭.

### 수동 트리거
GitHub → **Actions → Deploy Cloudflare Worker (generate-api) → Run workflow**.

## 수동 배포 (로컬 검증·긴급)

```powershell
cd C:\Users\hchan\dadam-cabinet\workers\generate-api
npx wrangler login       # 최초 1회만, 브라우저 인증
npx wrangler deploy
```

배포 성공 시 `https://dadam-generate-api.dadamfurniture.workers.dev/` 로 즉시 반영.

## 배포 확인

```powershell
curl https://dadam-generate-api.dadamfurniture.workers.dev/health
# → {"status":"ok","service":"dadam-generate-api","worker":true}
```

## 환경 변수 (Secret)

`GEMINI_API_KEY` 는 Cloudflare 대시보드에서 secret 으로 별도 등록 (wrangler.toml 에 넣지 않음):

```powershell
npx wrangler secret put GEMINI_API_KEY
# 프롬프트에 키 값 붙여넣기
```
