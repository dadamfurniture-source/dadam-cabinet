# 다담 CAD 베타 — 첫 메시지와 스레드 묶음

프로젝트를 만들고 설정을 마친 뒤(README 1~3단계) **프로젝트 대화(코디네이터) 입력창**에 아래 "첫 메시지"를 그대로 보낸다.
코디네이터는 스레드가 보고한 것을 보고 판단하므로, 결정 질문의 선택지는 첫 메시지에 직접 담았다.

---

## 첫 메시지 (복사해서 보내기)

```
다담 CAD 베타 1주차를 시작해 줘. 계획은 저장소의 docs/01-plan/planner-cad.plan.md (맨 위 개정 사항 우선),
스레드 묶음은 docs/01-plan/cad-beta/threads.md 에 있다.

1) 먼저 나에게 아래 두 결정을 물어봐 (선택지와 추천 포함):
   - D6 공개 범위: (a) 상세설계 화면을 관리자 + 파트너만 보게 잠금 [추천] / (b) 관리자만 / (c) 지금처럼 열어 둠.
     고객 확인서에 외관 정면도·아이소를 넣을지 (추천: 넣음, 3D 는 나중), 파트너에게 외관 파일을 줄지 (추천: 승인 뒤 외관만).
   - D11 도메인 소유: assembly-rules.js · bom-assembly.js · assembly-check.js · tools/cad/** · cad-oracle.yml → BOM 도메인,
     planner-assembly-mesh.js · planner-export.js → 플래너 도메인, part-drawing.js · module-section.js · dxf-writer.js ·
     js/detaildesign/workflow-client.js → 워크플로 도메인. 이대로 CLAUDE.md 에 추가할지 (추천: 승인).
2) 결정이 필요 없는 스레드 T1(지금 3D 장면 겹침 목록)은 바로 시작해.
3) D6·D11 답을 받으면 T2~T4 를 도메인이 겹치지 않게 시작하고, 문서 스레드 T5 로 결정을 반영해 줘.
   결정은 프로젝트 지침의 결정 표에도 고치고 프로젝트 메모리에 기억해.
4) 같은 도메인 스레드는 동시에 돌리지 마. 머지는 지침의 REST 명령으로, Run Tests·TypeScript Check·Build 가 모두 success 일 때만.
   워커 PR 은 워커 시험을 직접 돌리고 배포 런까지 확인해.
스레드를 시작하기 전에 어떤 스레드를 어떤 순서로 돌릴지 표로 먼저 보여 줘.
```

---

## 스레드 묶음

모든 스레드는 프로젝트 지침과 계획 문서의 개정 사항을 따른다. 클라우드 스레드는 자기 클론에서 일한다 (워크트리 금지).

### T1 · 지금 3D 장면 겹침 목록 — `agent/planner-scene-overlap` (PR1) · 결정 불필요 · 클라우드
- 목표: 운영 코드를 건드리지 않고, 지금 플래너 3D 장면에서 판재끼리 파고드는 곳을 숫자로 찾는다.
- 파일: `test-utils/scene-parts.js`(`collectSceneParts` 에 matrixWorld·모듈 로컬 AABB·`makeNotchedPanel` 윤곽), 새 `test-utils/box-overlap.js`, `__tests__/scene-overlap.test.js`, `test-utils/overlap-allowlist.json`.
- 픽스처: `test-utils/planner-golden.js` 의 straight·lShape·oblique + **서랍장·다칸·붙박이장·18T** (개정 #8). `drawerBox` 는 한 덩어리 외피라 따로 다룬다. 화면용 메시는 기존 SKIP 목록으로 뺀다.
- 겹침 기준: 부피 > 1mm³ **이고** 파고든 깊이 > 0.1mm. 면 접촉(부피 0)은 허용.
- 완료: 합성 쌍 시험(겹침·면 접촉·따내기 안쪽) 통과, 찾은 겹침은 고치거나 이유를 달아 allowlist (서랍장 처짐방지목↔서랍 = `pending-owner D2`), **겹침 목록을 표·그림으로 사장님께 보고**.

### T2 · 상세설계 잠금 — `agent/designui-access-gate` (PR0a) · D6 후 · 클라우드
- 목표: `detaildesign.html:103` 의 `return;` 때문에 누구나 상세설계(내부 구조)를 볼 수 있는 문제를 막는다. D6 답대로 게이트.
- 참고: `js/detaildesign-access.js`, `js/admin-access.js`. 클라이언트 확인만으로는 겉치레 — 서버 쪽 데이터 접근(RLS)과 함께 점검해 보고.
- 완료: 고객 계정·비로그인에서 막힘, 관리자에서 열림 (수동 확인 절차를 PR 에 적기). `detaildesign.html` 의 `?v=` 갱신.

### T3 · 고객 확인서 외관 도면 — `agent/workflow-confirm-exterior` (PR0b) · D6 후 · 클라우드
- 목표: 작업지시서에 이미 있는 외관 정면도·아이소(`workers/workflow-api/src/templates/elevation.js` `elevationSvg`, `templates/isometric.js`)를 고객 확인서(`templates/customer-confirmation.js`)에 넣는다. 내부 부재(뒷판·처짐방지목·따내기·밴드)는 그리지 않는다.
- 완료: `node --test "test/*.test.js"` 통과(결과를 PR 본문에), 확인서 HTML 골든, **배포 런 초록 확인**.

### T4 · 관리자 근사 GLB — `agent/planner-glb-approx` (PR1b) · D6 후 · 클라우드
- 목표: 지금 3D 장면을 "근사"라고 표시한 GLB 로 내보내기 (메뉴 `pdm-wrap`). 관리자만 — 역할은 부모 창이 postMessage 로 넘긴다 (`mockup-structure.html` 은 `AdminAccess` 를 싣지 않는다).
- three 는 importmap `three@0.183.0` 의 `GLTFExporter`. 화면용 메시(바닥·그리드·치수선 등)는 뺀다. 노드 이름은 entityKind·moduleId.
- 완료: jsdom 시험(노드 수, 화면용 메시 0, 배율 0.001), 두 플래너 HTML 의 `?v=` 동일 (머지 직전 main 기준 +0.1).
- T1 과 같은 플래너 도메인 → T1 머지 뒤에 시작.

### T5 · 결정 반영 문서 — `agent/docs-cad-decisions` · 결정마다 · 클라우드 (도메인 제한 밖)
- 사장님 답을 받을 때마다 `docs/01-plan/planner-cad.plan.md` 개정 사항과 `docs/01-plan/cad-beta/project-instructions.md` 결정 표를 갱신. D11 이면 CLAUDE.md 도메인 표에 행 추가.

### 2주차 이후 (계획 §6 순서, 개정 사항 반영)
PR2 브리지 분리(`agent/designui-bridge-extract`) ∥ PR3 규칙 표(`agent/bom-assembly-rules`) — 둘 다 D11 뒤 → PR4 · PR5 → PR6 명세 몸통(AABB 시험·원장 래칫 시작) → PR7 검사(빈틈·덮개 포함) → PR8 CI 검산기(합성 골든만) → PR9 특징 → PR10 동결(워커 검증 먼저 배포, 다음 PR 에 클라이언트) · PR11 배지 → PR12~15 3D 를 명세로(`?asm=0` 되돌리기) → PR16 GLB · PR17 도면.
같은 도메인끼리는 순서대로. 각 단계 완료 기준은 계획 문서에 있다.

---

## 로컬 스레드로 돌릴 것 ("Work locally", Worktree 옵션 켜기)
| 일 | 이유 |
|---|---|
| CAD 뷰어로 모델 보여 주기, text-to-cad 플러그인 | 뷰어가 127.0.0.1 에서만 열린다 |
| `docs/01-plan/cad-beta/cad-prototype` 실행해 비교 그림 만들기 | 클라우드도 되지만 결과를 뷰어로 보려면 로컬 |
| Supabase SQL 실행 | 사장님이 직접 (스레드는 SQL 파일과 전문만) |
| OneDrive 견적서·거래명세서, `D:\ohouse` | 사장님 PC 에만 있다 |
