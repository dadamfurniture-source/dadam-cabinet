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

## 프로젝트 구조

- `*.html` — 정적 HTML 페이지 (GitHub Pages 배포)
- `js/detaildesign/` — 상세 설계 프론트엔드
- `css/detaildesign/` — 상세 설계 스타일
- `mcp-server/` — TypeScript MCP 서버 (Express)
- `workflows/` — n8n 워크플로우 JSON (레거시)

## 기술 스택

- 프론트엔드: 정적 HTML + Vanilla JS (프레임워크 없음)
- 이미지 생성: Gemini 3.1 Flash Image (직접 API 호출)
- DB: Supabase (PostgreSQL + Auth + Storage)
- 배포: GitHub Pages + Cloudflare CDN
- MCP 서버: TypeScript + Express (포트 3200)

## Gemini 모델
- 벽분석 + 이미지 생성: `gemini-3.1-flash-image-preview`
- n8n: 더 이상 사용하지 않음 (MCP 서버 직접 호출)

## 배포 주의사항
- main 푸시 → GitHub Pages 자동 배포 (1-2분 소요)
- Cloudflare CDN 캐시: 변경 후 Purge Everything 필요할 수 있음
- `.gitignore`에 포함된 파일: `.env`, `gcp-service-account.json`, `.claude/worktrees/`

## 손잡이 프롬프트
- 모든 카테고리: handleless (매립형)
- "Lower cabinet doors can be opened by reaching behind the door"
- Chrome bar handles, push-to-open 사용 금지
