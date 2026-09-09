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

`wrangler secret put` 으로 등록한다 (wrangler.toml 에 넣지 않음).

| 이름 | 용도 |
|---|---|
| `GEMINI_API_KEY` | 필수 |
| `SUPABASE_SERVICE_ROLE_KEY` | `generations` 행·버킷 쓰기, 잡 안 환불(`refund_credit_svc`) |
| `SHARE_TOKEN_PEPPER` | 공유 토큰 해시. 32바이트 이상 랜덤 문자열 |

```powershell
cd workers/generate-api
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SHARE_TOKEN_PEPPER
```

로컬 `wrangler dev` 는 같은 폴더의 `.dev.vars` (gitignore) 에서 읽는다.

## 파이프라인 (2026-09 v2 · 비동기)

`POST /api/generate` 는 202 와 잡 id 만 돌려주고, 생성은 미국 콜로 Durable Object `GenerateJob`(src/job.js) 이
alarm 으로 실행한다. 진행 상태의 정본은 `generations` 행이고 클라이언트는 `GET /api/generate/:id` 를 3초마다 읽는다.

| 단계 | 모델 | 결과 |
|---|---|---|
| 1 분석 | gemini-3.8-flash | 벽 치수 + 방 브리프 + 철거 대상 (벽 폭 직접 입력 시 치수만 덮어씀) |
| 2 설치 | gemini-3-pro-image 2K | 기본안 (문 닫힘) |
| 3 검사 | gemini-3.8-flash | 규칙 위반 판정, 실패 시 FIX 붙여 2단계 1회 재시도 |
| 4 변형 | gemini-3-pro-image 2K ×3 병렬 | 마감만 바꾼 추천안, 끝나는 대로 저장 |
| 5 마무리 | — | 견적, done |

- 기본안이 나왔으면 추천안이 모자라도 `done`. 기본안 실패만 환불.
- 잡 상한 10분(환불 창 30분 안). alarm 재시도 2회.
- 출력은 버킷 `generations/{uid}/{genId}/base.jpg, v1..3.jpg`, 입력은 `room.jpg, ref-N.jpg`.

## 엔드포인트

| | 인증 | |
|---|---|---|
| `POST /api/generate` | JWT | 202 `{id, status, credit:{balance,cost}}`. `parent_id` 면 재생성. 실행 중 잡이 있으면 409 |
| `GET /api/generate/:id` | JWT | `{generation:{status,progress,step_label,images[],quote,…}}` |
| `DELETE /api/generate/:id` | JWT | 파일·행 삭제 (실행 중이면 409) |
| `POST /api/generate/:id/share` | JWT | `{share_url, expires_at}` — 토큰은 1회만, 다시 부르면 회전 |
| `DELETE /api/generate/:id/share` | JWT | 회수 |
| `GET /api/share` | `X-Share-Token` | 이미지·견적. 만료·회수 410 |
| `GET /health`, `GET /diag` | — | 모델·콜로 / 경로별 Gemini 상태 |

## Gemini 호출 경로 (지역 차단)

Cloudflare 워커는 HKG·KIX 콜로에서 뜨고, 거기서 Google AI Studio 는 게이트웨이·직접 호출을 모두
`400 User location is not supported` 로 막는다 (2026-09-09 `/diag` 실측). 잡 DO 는 `locationHint: 'enam'` 으로
미국에서 뜨므로 직접 호출이 통하고, 막히면 `gemini.js` 가 gateway → direct → proxy(`GeminiProxy`) 순으로 넘어간다.
