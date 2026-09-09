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

Cloudflare 대시보드에서 secret 으로 별도 등록 (wrangler.toml 에 넣지 않음):

### 1. `GEMINI_API_KEY` (필수)
모든 카테고리의 생성에 필요.
```powershell
npx wrangler secret put GEMINI_API_KEY
# 프롬프트에 키 값 붙여넣기
```

### 2. 모델 변경
`wrangler.toml` 의 `GEMINI_MODEL` 한 값이 분석·설치·변형 전부에 쓰인다. Claude 는 더 이상 호출하지 않으므로 `ANTHROPIC_API_KEY` 는 필요 없다.

## 파이프라인 (2026-09 단일화)

| 단계 | 호출 | 결과 |
|---|---|---|
| 1 분석 | Gemini 텍스트 1회 | 벽 폭·높이·급수·후드 위치 JSON (벽 폭 직접 입력 시 생략) |
| 2 설치 | Gemini 이미지 1회 | 기본안 (문 닫힘) |
| 3 변형 | Gemini 이미지 3회 병렬 | 마감만 바꾼 추천안 3장 |

품목별 차이는 `src/prompts.js` 의 `CATEGORIES` 한 문단, 단가는 `src/quote.js` 한 줄이다.

## Gemini 호출 경로 (지역 차단)

Cloudflare 워커는 HKG·KIX 콜로에서 뜨고, 거기서 Google AI Studio 는 게이트웨이·직접 호출을 모두
`400 User location is not supported` 로 막는다 (2026-09-09 `/diag` 실측). 그래서 `locationHint: 'enam'`
으로 만든 Durable Object `GeminiProxy` 가 Google 호출을 대신하고, `GEMINI_VIA = "proxy"` 로 그 경로만 쓴다.

- `/diag` — 워커 콜로, 경로별(gateway/direct/proxy) Gemini 텍스트 호출 상태
- `/health` — 모델·콜로
