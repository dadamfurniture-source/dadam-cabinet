# 다담 CAD 베타 — Claude Code 프로젝트(베타) 준비물

Claude 데스크톱 앱 Code 탭 왼쪽 패널 위의 **프로젝트(베타)** 에서 플래너 CAD 계획을 돌리기 위한 묶음이다.
프로젝트는 대화 하나(코디네이터)가 여러 작업 스레드를 시작·추적하는 기능이고, 스레드는 **클라우드에서 GitHub 저장소를 받아** 일한다.
그래서 사장님 PC 의 메모(로컬 메모리)나 `tmp/` 파일은 스레드가 볼 수 없다 — 필요한 것은 모두 이 폴더와 저장소 문서에 넣었다.

| 파일 | 쓰는 곳 |
|---|---|
| `project-instructions.md` | Project settings > Memory > **Project instructions** 에 붙여넣기 (16,000자 제한, 지금 약 7,200자) |
| `setup.sh` | 클라우드 환경 `dadam-cad` 의 **Setup script** 에 붙여넣기 (2단계) |
| `threads.md` | 프로젝트 대화에 보낼 **첫 메시지**와 스레드 묶음 |
| `cad-prototype/` | 2026-10-19 에 만든 build123d 모델 (참고용, 규칙 정본 아님) |
| `../planner-cad.plan.md` | 정본 계획 (맨 위 개정 사항 16건이 본문보다 우선) |

## 준비 순서 (사장님이 앱에서 할 일)

### 0. 전제 확인
- [ ] 왼쪽 패널에 **프로젝트(Projects)** 가 보인다 (Pro·Max 공개 베타, 순차 배포. 없으면 대기 명단).
- [ ] GitHub 계정 `dadamfurniture-source`(개인 계정이다 — 조직 아님)의 https://github.com/settings/installations 에서 **Claude** 앱의 Repository access 에 `dadam-cabinet` 이 있다. claude.ai 에 연결한 GitHub 계정이 이 저장소에 push 권한을 가져야 한다.
- [ ] 이 PR(프로젝트 준비물)이 main 에 머지됐다 — 스레드는 main 을 받는다.

### 1. 클라우드 환경 먼저 만들기 (Default 환경은 건드리지 않는다)
셋업 스크립트와 네트워크는 프로젝트가 아니라 **클라우드 환경**에 붙는다. Default 를 고치면 다른 클라우드 세션 전부에 적용된다.
1. claude.ai/code (또는 데스크톱 앱의 클라우드 새 세션 화면) 환경 선택기 → **New environment** → 이름 `dadam-cad`
2. 네트워크: **Custom** 을 고르고 **Also include default list of common package managers 를 반드시 체크**. 추가 도메인:
   - `*.astral.sh` (uv 의 Python 내려받기)
   - `*.dadamfurniture.workers.dev` (워커 배포 뒤 `/health` 확인)
   - `dadamfurniture.com` (배포된 사이트 확인)
3. Setup script: `setup.sh` 전문 붙여넣기 (줄바꿈이 LF 인지 확인 — 저장소는 `.gitattributes` 로 LF 고정).
4. 환경변수·시크릿: **지금은 필요 없다.** 워커 배포는 GitHub Actions 시크릿으로 되고, Supabase SQL 은 사장님이 직접 실행한다. 나중에 키가 필요하면 환경변수가 아니라 **네트워크 시크릿**으로 넣는다 (환경변수는 환경을 쓰는 사람 모두가 읽는다).

### 2. 프로젝트 만들기
1. 프로젝트 → **New project**
2. Name: `다담 CAD 베타`
3. Goal: `플래너에 조립 명세·겹침 검사·CAD 산출물 넣기 (docs/01-plan/planner-cad.plan.md)`
4. Context → Add → GitHub 저장소 `dadamfurniture-source/dadam-cabinet` **하나만**
5. Create project
6. **바로 대화창에 "설정을 마칠 때까지 스레드를 시작하지 마" 를 보낸다.** 첫 프로젝트는 만들자마자 Claude 가 스스로 저장소를 탐색하거나 Setup recommendations 를 낸다 — 추천 저장소·루틴은 켜지 않는다.

### 3. 설정 채우기 (Project settings)
- **Memory > Project instructions**: `project-instructions.md` 전문 붙여넣기.
- **Environment**: 1단계에서 만든 `dadam-cad` 선택.
- **General**: Coordinator model Opus, Thread effort high (기본값 유지).
- **Plugins**: 비워 둔다. text-to-cad(CAD 뷰어)는 127.0.0.1 전용이라 클라우드 스레드에서 쓸모가 없다 — 로컬 스레드에서 데스크톱 앱의 플러그인을 쓴다.

### 4. 로컬 스레드 켜기 (CAD 뷰어·사장님 PC 파일이 필요할 때만)
- 데스크톱 앱 Settings > Claude Code > **Use this computer from your phone and claude.ai** 를 켜고 `dadam-cabinet` 저장소 폴더를 추가 (데스크톱 내장 Claude Code 2.1.280 이상 필요).
- 스레드 입력창 **+** → **Work locally** → 카드에서 폴더 허용. 이때 **Worktree** 옵션을 켠다 — 이 폴더는 다른 로컬 세션들과 같이 쓰는 메인 작업 폴더라, 그대로 쓰면 서로 덮어쓴다. 컴퓨터가 켜져 있어야 한다.
- 로컬 스레드는 프로젝트 메모리를 싣지 않는다. 결정 사항은 메시지에 적어 준다.

### 5. 시작
`threads.md` 의 **첫 메시지**를 프로젝트 대화에 보낸다. 코디네이터가 D6·D11 을 먼저 묻고, 결정이 필요 없는 T1(겹침 목록)부터 시작한다.

## 결정이 났을 때
프로젝트 대화에 "프로젝트 지침의 결정 표를 D6=… 로 고치고 이 결정을 프로젝트 메모리에 기억해" 라고 보낸다 (Claude 가 지침을 고칠 수 있다).
저장소 사본(`project-instructions.md`, 계획 문서)은 문서 스레드(T5) PR 로 맞춘다.

## 알아 둘 것
- 저장소는 **공개**다. 실제 고객 설계·이름·개인 PC 경로는 커밋·Actions·PR 에 넣지 않는다 (지침에 적어 둠).
- 클라우드에서 `gh pr …` 명령은 막힌다 (GraphQL). 지침의 REST 명령으로 CI 확인·머지를 한다.
- 클라우드 스레드에서 `dadam` MCP 서버 연결 실패가 뜨는 것은 정상이다 (`.mcp.json` 이 빌드되지 않은 `mcp-server/dist` 를 가리킨다).
- 프로젝트 사용량은 플랜 한도를 빠르게 쓴다. 스레드를 한 번에 많이 열지 않는다 (같은 도메인은 어차피 순서대로).
- 지금까지 이 PC 의 로컬 세션에서 해 온 일(사이드바 그룹 "플래너·설계", "BOM·작업지시서" 등)은 그대로 둔다. 로컬 세션은 프로젝트로 옮길 수 없다.
- 따로 정리할 것: `.claude/settings.local.json` 이 git 에 올라가 있다 (예전 PC 의 Windows 경로·허용 규칙). 공개 저장소에서 빼는 정리 PR 이 필요하다.
