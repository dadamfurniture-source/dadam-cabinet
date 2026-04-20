# dadam-generate-api — 배포 가이드

## 배포 경로

### A. 자동 배포 (권장)

`main` 브랜치에 `workers/generate-api/**` 하위 파일 변경이 푸시되면 GitHub Actions 가 자동으로 `wrangler deploy` 실행.

**필수 secret 2개 (GitHub repo Settings → Secrets and variables → Actions)**:

| Key | 값 얻는 곳 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare 대시보드 → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" 템플릿 선택 → 생성된 토큰 복사 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 대시보드 우측 사이드바의 Account ID (wrangler.toml 에도 박혀있음: `8bd8e054dfc7bcdc577f9bb79edd3284`) |

secret 등록 후 푸시하면 자동 배포. 진행 상황은 GitHub → Actions 탭에서 확인.

### B. 수동 배포 (긴급·로컬 검증)

```bash
cd workers/generate-api
npx wrangler login       # 최초 1회, 브라우저 인증
npx wrangler deploy      # 배포
```

배포 성공 시 `https://dadam-generate-api.dadamfurniture.workers.dev/` 로 즉시 반영.

## 배포 확인

```bash
curl https://dadam-generate-api.dadamfurniture.workers.dev/health
# → {"status":"ok","service":"dadam-generate-api","worker":true}
```

## 주의

- `GEMINI_API_KEY` 는 Cloudflare secret 으로 별도 등록 (wrangler.toml 에 넣지 않음):
  ```
  npx wrangler secret put GEMINI_API_KEY
  ```
- `main` 에 머지만 한다고 Worker 에 반영 안 됨 — 위 A 또는 B 과정 필요.
