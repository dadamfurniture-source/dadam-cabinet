# 다담AI 프로젝트 — Claude Code 규칙

## 작업 분리 규칙 (필수)

### main 브랜치 직접 커밋 금지
- 모든 변경은 **워크트리 또는 브랜치**에서 작업 후 PR로 머지
- 긴급 핫픽스만 main 직접 커밋 허용

### 파일 소유권 (동시 수정 금지)
다른 에이전트가 같은 파일을 수정하면 충돌 발생. 아래 규칙을 따를 것:

| 영역 | 파일 패턴 | 담당 |
|------|----------|------|
| 싱크대 설계 UI | `js/detaildesign/ui-step1.js` | 한 세션만 수정 |
| 붙박이장 설계 UI | `js/detaildesign/ui-workspace.js` (wardrobe 부분) | 한 세션만 수정 |
| 냉장고장 설계 UI | `js/detaildesign/ui-fridge-el.js` | 한 세션만 수정 |
| 설계 엔진 | `js/detaildesign/calc-engine.js` | 한 세션만 수정 |
| AI 이미지 생성 | `ai-design.html` | 한 세션만 수정 |
| MCP 서버 | `mcp-server/src/**` | 한 세션만 수정 |

### 커밋 전 확인
1. `git pull origin main` 으로 최신 코드 동기화
2. 충돌 확인 후 커밋
3. 푸시 실패 시 `git pull --rebase` 후 재시도

## 설계 규칙 임의 생성 금지
- 코드·문서에 정의되지 않은 규칙을 지어내 넣지 않는다. 먼저 정본을 확인한다: `js/detaildesign/data-constants.js`, `js/detaildesign/bom-*-rules.js`, `docs/design-rules/*.md`
- fallback 로직이나 "안전장치"도 임의로 만들지 않는다
- 정본에 없거나 불확실하면 사용자에게 먼저 묻는다
- 이유: 150~349mm 서랍 모듈 규칙을 지어내 넣었다가 사용자가 발견해 삭제를 요청했다. 없는 규칙이 섞이면 동작을 예측할 수 없고 디버깅이 어려워진다

## 프로젝트 구조

- `*.html` — 정적 HTML 페이지 (GitHub Pages 배포)
- `js/detaildesign/` — 상세 설계 프론트엔드
- `css/detaildesign/` — 상세 설계 스타일
- `mcp-server/` — TypeScript MCP 서버 (Express)

## 기술 스택

- 프론트엔드: 정적 HTML + Vanilla JS (프레임워크 없음)
- 이미지 생성: Gemini 3.1 Flash Image (직접 API 호출)
- DB: Supabase (PostgreSQL + Auth + Storage)
- 배포: GitHub Pages + Cloudflare CDN
- MCP 서버: TypeScript + Express (포트 3200)

## 이미지 생성 (연출컷 v2, 2026-09-09)
- 이미지: `gemini-3-pro-image` 2K, 브리프·품질검사: `gemini-3.8-flash` (`workers/generate-api/wrangler.toml` 의 `GEMINI_IMAGE_MODEL`/`GEMINI_TEXT_MODEL`)
- 비동기: `POST /api/generate` → 202, 잡은 Durable Object `GenerateJob`(미국 콜로, `src/job.js`) 이 실행. 상태 정본은 `generations` 행
- 프롬프트는 `src/prompts.js` 한 파일. 품목 차이는 `CATEGORIES[key].spec` 한 문단뿐. 견적은 `src/quote.js`
- 결과는 버킷 `generations`, 이력은 `my-designs.html`(내 연출컷), 공유는 `design-share.html#t=`
- 워커 시크릿: `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SHARE_TOKEN_PEPPER` (배포 문서 `workers/generate-api/DEPLOY.md`)
- n8n·Claude: 이미지 생성 경로에서 더 이상 사용하지 않음

## 배포 주의사항
- main 푸시 → GitHub Pages 자동 배포 (1-2분 소요)
- Cloudflare CDN 캐시: 변경 후 Purge Everything 필요할 수 있음
- 로컬 css·js 참조의 `?v=` 는 손으로 올리지 않는다 — `npm run asset-version` 이 사이트 전체를 한 값(`scripts/asset-version.json`)으로 찍는다. 어긋나면 `__tests__/asset-version.test.js` 가 막는다
- `segan/` 파일(sw.js 빼고)을 바꾼 PR 은 `npm run asset-version` 으로 버전도 올린다 — 서비스 워커가 `?v=` 셸 파일을 캐시 먼저로 주기 때문. 버전을 올릴 때 적는 segan/ 해시와 다르면 같은 시험이 막는다
- DB 변경은 `database/migrations/` 에 다음 번호 파일로 넣는다 (`database/migrations/README.md` — `database/*.sql` 은 옛 기록이라 고치지 않는다)
- `.gitignore`에 포함된 파일: `.env`, `gcp-service-account.json`, `.claude/worktrees/`

## 손잡이 프롬프트
- 모든 카테고리: handleless (매립형)
- "Lower cabinet doors can be opened by reaching behind the door"
- Chrome bar handles, push-to-open 사용 금지

## AI 에이전트 팀

### 도메인별 에이전트 소유권 (확장)

| 도메인 | Engineer 소유 파일 | 브랜치 prefix |
|--------|-------------------|--------------|
| Image Gen | `ai-design.html`, `js/detaildesign/ai-design-report.js` | `agent/imggen-*` |
| BOM/Materials | `calc-engine.js`, `extractors.js`, `bom.service.ts`, `bom.tool.ts`, `bom-rules.*`, `assembly-rules.js`, `bom-assembly.js`, `assembly-check.js`, `tools/cad/**`, `.github/workflows/cad-oracle.yml` | `agent/bom-*` |
| Design UI | `ui-step1.js`, `ui-workspace.js`, `ui-fridge-el.js` | `agent/designui-*` |
| Collection | `collection.html`, `database/collection-schema.sql` | `agent/collection-*` |
| MCP Server | `mcp-server/src/**` (BOM 파일 제외) | `agent/mcp-*` |
| Planner (활성) | `mockup-shell.html`, `mockup-structure.html`, `js/planner/*` (`planner-assembly-mesh.js`, `planner-export.js` 포함) | `agent/planner-*` |
| Workflow Worker | `workers/workflow-api/**` (작업지시서·스냅샷·견적, `part-drawing.js`·`module-section.js`·`dxf-writer.js` 포함), `js/detaildesign/workflow-client.js` | `agent/workflow-*` |
| Worker Portal | `worker.html`, `js/worker-portal.js`, `js/mypage-work.js`, `admin/work-jobs.html`, `mypage.html` 의 `#myWorkSection` 부분, `database/work-jobs*.sql` | `agent/worker-*` |
| Site Auth | `login.html`, `signup.html` (리다이렉트·OAuth·로그인 수단) | `agent/auth-*` |
| Module Library | `docs/01-plan/module-library.plan.md` — 모듈 정의 · 검증은 별도 저장소 `dadamfurniture-source/dadam-module-library` (비공개, 이 저장소를 `engine/` 서브모듈로 쓴다) | `agent/modlib-*` |
| App Shell (SEGAN) | `segan/**`, `scripts/stamp-asset-version.mjs`, `scripts/asset-version.json`, `scripts/segan-icons.mjs` | `agent/app-*` |
| Database migrations | `database/migrations/**`, `database/probes/**`, `scripts/db-*.mjs`, `scripts/rls-probe.mjs` | `agent/db-*` |

CAD 베타 파일 소유는 결정 D11 (2026-10-18 승인, `docs/01-plan/planner-cad.plan.md`).
모듈 라이브러리 소유는 2026-10-24 사장님 계획 승인 (`docs/01-plan/module-library.plan.md`). 같은 날 사장님 지시로 별도 저장소로 옮겼다 — 라이브러리는 선택값만 담고, 플래너·BOM·CAD 규칙은 이 저장소의 각 도메인이 고친다.
작업자 포털 소유는 2026-10-20 사장님 결정 16 (`docs/01-plan/worker-portal.plan.md`). 서버 `workers/workflow-api/src/work/**` 는 Workflow Worker 영역.

### 역할별 실행 순서
1. **Engineer** → 코드 수정 + PR 생성
2. **Designer** → PR 리뷰 코멘트
3. **QA** → 빌드/테스트 검증 결과 게시

같은 도메인 내 병렬 실행 금지 (순차만 허용)

### 스킬 파일 위치
`.claude/skills/agents/{domain}/{role}.md`

### Scheduled Tasks
- `qa-nightly-bom`: 매일 2시 BOM 문법 검증
- `qa-nightly-mcp`: 매일 3시 MCP 빌드 검증
- `designer-weekly-ui`: 매주 월 9시 UI 일관성 감사
- `designer-weekly-collection`: 매주 수 10시 Collection UX 감사
