# 다담 CAD 베타 — 프로젝트 지침 (Project settings > Memory > Project instructions 에 그대로 붙여넣기)

## 누구와 어떻게
- 사용자는 다담가구 대표(사장님)다. 모든 답변·진행 보고·PR 설명은 **한국어**로 쓴다.
- 보고는 글만 늘어놓지 않는다. 표·치수 그림·전후 비교 중심으로, 가능하면 HTML 아티팩트로 만든다.
- 사장님 결정이 필요한 것은 선택지와 추천을 붙여 한 번에 묻는다. 결정을 추측으로 채우지 않는다.
- 사장님이 결정하거나 "확정"이라고 하면: 이 지침의 결정 표·확정 사실을 고치고, **프로젝트 메모리에 기억**하고, 저장소 사본(`docs/01-plan/cad-beta/project-instructions.md`, `docs/01-plan/planner-cad.plan.md`)은 문서 스레드 PR 로 맞춘다.

## 이 프로젝트의 목표
- 정본 계획: `docs/01-plan/planner-cad.plan.md` (맨 위 "개정 사항"이 본문보다 우선 — 본문 §6 과 다르면 개정 사항을 따른다).
- 오늘 CAD 로 한 일(규칙으로 판재마다 정확한 위치를 정하고 겹침을 검사)을 플래너 안의 JS 로 옮긴다:
  규칙 한 표 `js/detaildesign/assembly-rules.js` → 조립 명세 `js/detaildesign/bom-assembly.js` (`dadam.assembly/1`)
  → BOM · 플래너 3D · 겹침/간섭/DFM 검사 `assembly-check.js` · 산출물(GLB 브라우저, 판재 도면 Worker SVG, DXF 는 벤더 형식 확인 후).
- build123d·cadgen 은 사이트에 올리지 않는다. build123d 는 CI 검산기(합성 골든만)로만 쓴다.

## 저장소 규칙 (CLAUDE.md 가 정본 — 아래는 꼭 지킬 것만)
- main 직접 커밋 금지. 브랜치 → PR → CI → 머지. 브랜치 prefix 는 CLAUDE.md 도메인 표 (BOM `agent/bom-*`, 플래너 `agent/planner-*`, 상세설계 UI `agent/designui-*`, 워크플로 워커 `agent/workflow-*`, MCP `agent/mcp-*`). `docs/**` 만 고치는 문서 스레드는 `agent/docs-*`.
- **같은 도메인 스레드는 동시에 돌리지 않는다** (같은 파일 충돌). 도메인이 다르면 병렬 가능. 문서 스레드는 이 제한 밖. 코디네이터는 스레드를 시작하기 전에 도메인을 확인한다.
- 소유자 없는 새 파일(`assembly-*.js`, `planner-bridge.js`, `tools/cad/**`, `.github/workflows/cad-oracle.yml`)과 `js/detaildesign/workflow-client.js` 는 **결정 D11 승인 전에는 만들거나 고치지 않는다**. (D11 승인됨 2026-10-18 — CLAUDE.md 도메인 표 반영 PR 머지 뒤부터 해당 도메인 스레드가 만든다.)
- 클라우드 스레드는 자기 클론에서 일한다 — **git worktree 를 만들지 않는다** (jest 가 `.claude/worktrees/` 를 제외하지 않아 시험이 두 번 돈다).
- **머지 (사장님 상시 승인 2026-10-08 — CI 통과하면 묻지 않고 머지)**:
  - 클라우드에서 `gh pr …` 는 GraphQL 이라 프록시가 403 으로 막는다. REST 를 쓴다.
  - CI 확인: `gh api repos/dadamfurniture-source/dadam-cabinet/commits/<head sha>/check-runs --jq '.check_runs[]|[.name,.status,.conclusion]|@tsv'`
  - 머지 조건: **Run Tests · TypeScript Check · Build 가 모두 conclusion=success**. skipped 는 실패로 친다 (Run Tests 가 실패하면 Build 가 skipped 되고, 필수 체크가 Build·TypeScript Check 뿐이라 그냥 머지될 수 있다).
  - 머지: `gh api -X PUT repos/dadamfurniture-source/dadam-cabinet/pulls/<번호>/merge -f merge_method=merge`
- **워커(workers/*) PR**: PR CI 는 워커 시험을 돌리지 않는다 → 머지 전에 스레드가 직접 돌리고 결과를 PR 본문에 붙인다. 머지만으로 라이브가 아니다 → 배포 런 확인:
  `gh api "repos/dadamfurniture-source/dadam-cabinet/actions/workflows/workflow-api-deploy.yml/runs?branch=main&per_page=1" --jq '.workflow_runs[0]|[.head_sha,.conclusion]'` (워커마다 해당 deploy 워크플로)
- 정적 페이지는 main 푸시 → GitHub Pages 1~2분. JS 를 바꾸면 그 스크립트를 싣는 HTML 의 `?v=` 를 올린다.
  - `mockup-shell.html` 과 `mockup-structure.html` 은 `?v=` 를 같이 쓴다 (`__tests__/planner-assets.test.js`). 둘 다 같은 값으로 올린다.
  - `detaildesign.html` 은 따로 버전을 쓴다. 같은 규칙 파일(예: `bom-drawer-rules.js`, `bom-wardrobe-rules.js`)이 두 쪽에서 실리면 양쪽 다 올린다.
  - `?v=` 는 **머지 직전에 main 을 다시 받아 그때 값 + 0.1** 로 올린다. mockup-*.html 을 고치는 다른 스레드가 돌고 있으면 코디네이터가 순서를 정한다.
  - 규칙 파일을 바꾼 PR 은 보고에 "Cloudflare Purge 필요할 수 있음"을 적는다.
- 새 시험은 **고치기 전 코드에서 먼저 실패하는지** 확인한다.
- 정규식·역슬래시가 든 내용은 셸 heredoc 대신 파일 쓰기 도구로 쓴다 (`\b` 가 백스페이스로 박힌 사고가 있었다).

## 시험 명령 (Ubuntu 클라우드 스레드)
- Node: CI 는 24. 있으면 먼저 `export PATH=/opt/node24/bin:$PATH` (셋업 스크립트가 설치; 없으면 기본 node 22 로도 된다).
- 루트: `npm ci --prefer-offline && npm test` (jest — `planner-vite/`, `mcp-server/`, `workers/` 는 jest 설정에서 제외됨).
- BOM 골든: 값이 **의도적으로** 바뀌면 `UPDATE_GOLDEN=1 npx jest __tests__/bom-golden` → `UPDATE_BASE_DIGEST=1 npx jest __tests__/bom-golden-addonly.test.js`. 커밋 메시지에 이유를 적는다.
- 도면↔BOM 원장: `UPDATE_LEDGER_ALLOWLIST=1 npx jest __tests__/scene-bom-ledger.test.js`. 늘어나는 차이는 이유를 확인하고, 줄어드는 차이는 좋은 신호다.
- 워커 workflow-api: 설치 없이 `cd workers/workflow-api && node --test "test/*.test.js"` (lockfile 없음 — `npm ci` 금지). generate-api: `cd workers/generate-api && npm ci && node --test "test/*.test.js"`.
- MCP 서버: `cd mcp-server && npm ci && npm test` (vitest). 클라우드에서 `.mcp.json` 의 `dadam` MCP 연결 실패는 정상 (`dist/` 빌드 없음).
- CAD 검산기(만들어진 뒤): `uv run --no-project --python 3.13 --with build123d==0.11.1 --with cadquery-ocp-novtk==7.9.3.1.1 python tools/cad/build_from_spec.py ...` — 파이썬 소스는 ASCII 만, 도메인 숫자 리터럴 금지(명세 JSON 만 읽는다).

## 보안·공개
- **저장소는 공개다.** 고객 이름·주소·전화·실제 주문 설계, 개인 PC 경로를 커밋, Actions 로그, 산출물, PR 본문에 넣지 않는다. 시험 픽스처는 합성 데이터만.
- 키·토큰은 환경변수에 넣지 않는다 (네트워크 시크릿). `.env`, `gcp-service-account.json` 은 저장소에 없다.
- Supabase SQL 은 스레드가 실행하지 않는다. `database/*.sql` 파일로 만들고, 실행할 SQL 전문을 보고에 붙여 사장님이 실행하게 한다 (추가만, 되돌리는 drop 스크립트 함께).
- 고객 화면에는 뒷판·처짐방지목·따내기·밴드·partId·보링 같은 내부 구조를 보이지 않는다. 예외: 상세설계 화면은 구독 standard 이상 고객에게 제공 (D6). 그 밖의 CAD 기능은 관리자 전용.

## 확정된 사실 (사장님 확정 — 바꾸려면 다시 묻는다)
- 플래너는 `mockup-shell.html`(배치) + `mockup-structure.html`(구조·디테일) + `js/planner/*` 가 활성이다. `planner-vite/` 는 레거시 — 수정 금지.
- 모듈의 영역 소속은 `areaIdOfModule` 이 정본 (m.areaId 직접 비교 금지).
- BOM 정본은 `js/detaildesign/extractors.js` 와 규칙 파일들(`bom-drawer-rules.js`, `bom-wardrobe-rules.js`, `bom-open-cabinet-rules.js`). 품목이 0개면 BOM 단계로 못 간다.
- 플래너 3D 는 아직 BOM 과 **184건 다르다** (`test-utils/ledger-allowlist.json` — 예: 3D 는 천판, BOM 은 밴드 2장). 3D 를 근거로 BOM 을 고치지 않는다.
- **뒷판 크기는 측판 사쿠리가 정한다** (2026-10-19, PR #832, `bomBackPanelSize`). 뒷판은 우라 MDF 3T. 홈카페장·오픈장 18T 통판은 규칙 밖.
  - 사쿠리 있음 — 측판 홈(뒤끝에서 15, 폭 3)에 끼움 (W−20)×(H−1), 천지판 D−18: 상부장·키큰장·EL장·냉장고 상부/키큰장(선반 D−34), **붙박이장 통·붙박이장 외부 서랍모듈**(선반 D−18−70 = D−88).
  - 사쿠리 없음 — **측판 뒤끝에 덮어 붙임** (W−1)×(H−1), 측판 깊이를 먹지 않음: 싱크 하부장(**서랍장 포함**)·키큰장 단·단순 하부장·냉장고 하부장·붙박이장 내부 서랍장.
- 모듈 깊이 = 측판 깊이. 하부 선반 = 측판 깊이 − 15 (처짐방지목 몫, 15T 기준 — 18T 일 때는 결정 D12).
- **처짐방지목**: 상부 W≥700 · 하부/키큰장 단 W≥800 인 모듈에만 1장, 모듈 폭 중앙. **측판 앞선에 맞대어 도어 바로 뒤**. 길이 70 × (H − 2T), 목찬넬이면 −70. 서랍장에서의 위치는 미정(D2).
- **목찬넬(손잡이 없는 하부장)**: 측판 위 앞 모서리를 70(높이)×40(깊이) 따낸다. MDF 18T ㄴ자 — 지면판 40 이 따낸 바닥에, 전면판 52 가 따낸 자리 **안쪽**에 서서 앞 22mm 가 손 넣는 홈. 하부 도어 높이 = 몸통 H − 30. **앞 밴드는 목찬넬 ㄴ자 지면판 바로 아래**에 눕혀 조립하고, 처짐방지목 윗끝이 앞 밴드 아랫면에 닿는다.
- 서랍: 박스 높이 소 60 · 중 120 · 대 180, 중간 목찬넬 따내기 90×40 (전면판 72 + 지면판 18), 레일 여유 볼레일 +20 / 언더레일 +40, 최소 전면 50, 최대 4단. 숫자는 `bom-drawer-rules.js` 에서만 읽는다.
- 서랍장 전면은 맨 위 칸까지 마이다(경첩·보링 없음). 붙박이장 외부 서랍 위 도어는 예외.
- 표준 높이: 싱크 하부 몸통 708 + 다리발 150 + 상판 12 = 870, 상부장 720·깊이 295, 상몰딩 60. 상판 깊이 600/650 은 미정(D3).
- 견적: 장당 견적 `workers/workflow-api/src/quote-sheet.js` (BOM 면적 기준 원판 장수 × 실제 원가 × 마진, 고정비 회수 `fixedPerPbSheet`). 엣지 표준시간은 면당 20초.

## 결정 상태 (답을 받으면 이 표·프로젝트 메모리·저장소 사본을 갱신)
| # | 질문 | 상태 |
|---|---|---|
| D6 | 공개 범위 (상세설계 잠금, 고객 외관 도면·3D, 파트너 외관 파일) | 일부 확정 (2026-10-18): 상세설계 화면은 구독 standard 이상 고객에게 제공, 관리자는 항상. 파트너 접근·고객 확인서 외관 도면·파트너 외관 파일은 미정 |
| D11 | CLAUDE.md 도메인 소유 행 추가 | 승인 (2026-10-18): BOM = assembly-rules.js · bom-assembly.js · assembly-check.js · tools/cad/** · cad-oracle.yml / 플래너 = planner-assembly-mesh.js · planner-export.js / 워크플로 = part-drawing.js · module-section.js · dxf-writer.js · js/detaildesign/workflow-client.js |
| D8 | 검사 오류 강도 (확인창 → 발행 차단) | 미정 |
| D2 | 서랍장 처짐방지목 위치 | 미정 (경고로만 표시) |
| D12 | 선반 −15 가 상수인가 T 인가 | 미정 |
| D1 | 다칸 모듈: 칸마다 통 vs 한 통 + 칸막이 | 미정 |
| D3 | 상판 깊이 600/650 과 기준 | 미정 |
| D4 | 걸레받이·몰딩·목찬넬 재단 단위 | 미정 |
| D5 | 사쿠리 홈 깊이, 경첩 컵 백셋·깊이 | 미정 (실측) |
| D7 | 벤더 파일 형식 | 미정 |
| D9 | 휠라 도면 vs 스펙 | 미정 |
| D10 | 18T 몸통 실사용 | 미정 |

## 클라우드에서 못 하는 일 → "Work locally" 스레드
- CAD 뷰어(cadgen, 127.0.0.1 전용)로 모델 보여 주기, text-to-cad 플러그인.
- 사장님 PC 에만 있는 것: `D:\ohouse` 데이터, OneDrive 견적서·거래명세서, MCP 서버 localhost:3200.
- 로컬 스레드는 프로젝트 메모리를 싣지 않는다 — 필요한 결정은 메시지에 적어 준다. 폴더 허용 카드에서 **Worktree** 옵션을 켜고 그 안에서 `npm ci` (node_modules 정션 금지 — 재귀 삭제가 메인 node_modules 를 지운 사고).
- Windows 에서 cadgen 모델 러너는 import 오류로 안 돈다 — 평범한 build123d 스크립트 + `bd.export_step/export_gltf` 로 우회, 소스는 ASCII 만(cadgen 이 cp949 로 읽음), `UV_CACHE_DIR=%USERPROFILE%\.cache\uv`.
- 참고 프로토타입: `docs/01-plan/cad-beta/cad-prototype/` (숫자가 들어 있어 규칙 정본이 아니다 — PR8 에서 명세 기반 스크립트로 대체).
