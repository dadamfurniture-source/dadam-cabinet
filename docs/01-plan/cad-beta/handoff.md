# 다담 CAD 베타 — 터미널 인수인계 (2026-10-23)

이 문서 하나만 읽고 **사장님 PC 터미널의 Claude Code** 가 클라우드 프로젝트(다담 CAD 베타)에서 하던 일을 이어 가도록 정리했다.
클라우드 프로젝트 메모리·지침은 터미널에서 보이지 않으므로 필요한 것은 모두 여기에 옮겼다. 저장소 규칙의 정본은 루트 `CLAUDE.md` 이고, 이 문서는 CAD 베타 작업분을 덧붙인다.

> 기준 시점: main `7bb5af7` (PR #1000 머지, 2026-10-22). 이후 머지는 `git log --merges` 로 확인한다.

---

## 1. 목표와 구조

- 정본 계획: [`docs/01-plan/planner-cad.plan.md`](../planner-cad.plan.md) — 맨 위 "개정 사항"·"결정 반영"이 본문보다 우선.
- 한 줄 요약: CAD 로 한 일(규칙으로 판재마다 정확한 위치를 정하고 겹침을 검사)을 **플래너 안의 JS** 로 옮긴다. build123d·cadgen 은 사이트에 올리지 않고, build123d 는 CI 검산기(합성 골든만)로만 쓴다.

```
규칙 한 표  js/detaildesign/assembly-rules.js
   → 조립 명세  js/detaildesign/bom-assembly.js   (스키마 dadam.assembly/1: modules[] · runs[] · hardware[] · drawerBoxes …)
      → BOM (extractors.js + bom-*-rules.js — BOM 정본)
      → 플래너 관리자 CAD GLB (js/planner/planner-export.js)
      → 겹침·간섭·DFM 검사 js/detaildesign/assembly-check.js → 작업지시서 발행 확인창 (D8)
      → (예정) 판재 도면 Worker SVG, DXF(벤더 형식 확인 뒤), CI 검산기 tools/cad/** (아직 없음)
```

| 영역 | 파일 | 도메인 (브랜치 prefix) |
|---|---|---|
| 규칙·명세·검사 | `assembly-rules.js`, `bom-assembly.js`, `assembly-check.js`, `tools/cad/**`, `.github/workflows/cad-oracle.yml` | BOM `agent/bom-*` |
| 플래너 GLB | `js/planner/planner-export.js`, `planner-assembly-mesh.js` | 플래너 `agent/planner-*` |
| 작업지시서 도면 | `workers/workflow-api/**` (`part-drawing.js`·`module-section.js`·`dxf-writer.js`), `js/detaildesign/workflow-client.js` | 워크플로 `agent/workflow-*` |
| 문서 | `docs/**` 만 | `agent/docs-*` (도메인 제한 밖) |

주요 시험: `__tests__/assembly-rules.test.js`, `bom-assembly.test.js`, `assembly-check.test.js`, `scene-overlap.test.js`, `scene-bom-ledger.test.js`, `bom-golden-*.test.js`, `workflow-assembly-confirm.test.js`.

---

## 2. 머지된 PR 흐름 (#857 ~ #1000, CAD 베타 관련만)

| PR | 날짜 | 내용 |
|---|---|---|
| #857 | 10-18 | 문서: D6 일부·D11 승인, CLAUDE.md 도메인 표 |
| #858 | 10-19 | T1 3D 장면 판재 겹침 시험 (`scene-overlap`) |
| #860 | 10-19 | 상세설계 접근 = 로그인한 모든 회원 (D6) |
| #868 · #880 | 10-19 | 문서: D6 보충, 고객 확인서 외관 도면 |
| #888 | 10-19 | 몸통 조립 규칙 한 표 `assembly-rules.js` (PR3) |
| #891 | 10-20 | 조립 명세 `bom-assembly.js` 몸통 판재 자리 (PR6) |
| #894 | 10-20 | 명세에서 바로 짓는 관리자 CAD GLB |
| #902 · #906 · #911 · #919 | 10-20 | 문서: D12·D8, 보강목, 서랍 박스 결정 |
| #905 · #912 | 10-20 | 상부장 보강목 60 · 15T 고정 · 자리 |
| #915 | 10-20 | 조립 검사 + 도어·서랍 전면·중간 목찬넬·서랍 박스 (PR7·PR9 1단계) |
| #924 | 10-20 | 작업지시서 발행 확인창에 조립 검사 (D8) |
| #926 · #930 · #933 | 10-20 | 붙박이장 통·선반, 칸막이, 오픈장·밥솥장 |
| #934 · #940 · #943 | 10-20 | 붙박이장 좌대·도어·외부 서랍(1~3단, 따내기, 목찬넬) |
| #952 · #969 | 10-20 | 외부 서랍 박스 싱크 규칙, 내부 서랍장 앞뒤 자리·바닥+30 |
| #980 | 10-20 | 하부장 밴드: 뒤 눕힘, 두께 T |
| #987 · #990 | 10-20 | 키큰장 단 좌대·걸레받이·목찬넬, 상몰딩 띠 |
| #992 · #994 | 10-22 | 멍장 (멍가림판·마감재·도어), 경첩목대 높이, 찬넬 손잡이 서랍장 |
| #993 | 10-22 | 신발장·수납장·화장대 서랍장 전면 = 싱크 규칙 |
| #995 | 10-22 | 냉장고장(옛 화면): 상부장 15T 사쿠리 + 보강목, 도어 H+20 아래로 20 |
| #996 | 10-22 | 라인 부재 `runs[]` (상판·상몰딩·목찬넬 EP) + GLB |
| #997 · #998 | 10-22 | 걸레받이·좌우 마감재 라인 부재, 걸레받이 바닥에 붙임 |
| #999 | 10-22 | 철물 `hardware[]` — 다리발 4 코너·언더레일·경첩 변·컵 높이 |
| #1000 | 10-22 | 붙박이장 서랍 레일 자리, GLB 다리발 상자 |

전체 목록: `git log --oneline --merges origin/main | grep -E "bom-assembly|docs-cad|planner-scene|designui-access|workflow-assembly"`.

---

## 3. 사장님 결정 (확정 — 바꾸려면 다시 묻는다)

| 항목 | 날짜 | 결정 | PR |
|---|---|---|---|
| D6 공개 범위 | 10-18·19 | 상세설계 화면 = 로그인한 모든 회원(무료 standard 포함), 비로그인만 막음, 관리자는 항상. 고객 확인서 = 외관 정면도·아이소만, 3D 는 나중 | #860 |
| D11 도메인 소유 | 10-18 | 1절 표대로. `planner-bridge.js` 는 소유자 없음 | #857 |
| D12 하부 선반 | 10-20 | 하부 선반 = 측판 깊이 − T (15T −15, 18T −18). 상부 선반 D−34 | #902 |
| D8 검사 강도 | 10-20 | 오류가 있으면 작업지시서 발행 전 확인창, 확인을 눌러야 발행 | #924 |
| 뒷판 | 10-19 | 우라 MDF 3T. 사쿠리(측판 홈: 뒤끝 15, 폭 3) 있으면 (W−20)×(H−1) 끼움·천지판 D−18 — 상부장·키큰장·EL장·냉장고 상부/키큰장·붙박이장 통·외부 서랍모듈(선반 D−88). 없으면 측판 뒤끝에 덮어 (W−1)×(H−1) — 싱크 하부장(서랍장 포함)·키큰장 단·단순 하부장·냉장고 하부장·붙박이장 내부 서랍장 | #832 |
| 상부장 보강목 | 10-20 | 2장, (W−2T)×60, 판은 몸통 두께와 상관없이 15T, 사쿠리 홈 뒤 장의 맨 뒤. 위 1장 천판 바로 아래, 아래 1장 지판 바로 위 | #905 #912 |
| 처짐방지목 | 확정 사실 | 상부 W≥700, 하부/키큰장 단 W≥800 에만 1장, 폭 중앙, 측판 앞선에 맞대어 도어 바로 뒤. 70×(H−2T), 목찬넬이면 −70 | — |
| 목찬넬 | 확정 사실 | 측판 위 앞 모서리 70×40 따냄. MDF 18T ㄴ자(지면판 40, 전면판 52 안쪽, 앞 22 손 홈). 하부 도어 H−30 | — |
| 하부장 밴드 | 10-20 13:50 | 2장 70×(W−2T), 두께 = 몸통 T, 둘 다 눕힘(70 앞뒤, 측판 사이). 앞 = 목찬넬 지면판 바로 아래(없으면 윗면=몸통 상단). 뒤 = 윗면 몸통 상단·뒤끝, 사쿠리 몸통은 홈 앞에서 | #980 |
| 서랍 | 확정 사실 | 박스 높이 60/120/180, 중간 따내기 90×40, 볼레일 +20/언더레일 +40, 최소 전면 50, 최대 4단 — 숫자는 `bom-drawer-rules.js` 에서만 | — |
| 서랍 박스 조립 | 10-20 | 밑판(우라 3T)은 측판·앞뒷판 밑면에 덮음, 하단보강은 밑판 아래 폭 가운데 앞뒤로 눕힘. 사쿠리 서랍 측판 홈 = 바닥에서 15 | #915 #919 |
| 서랍장 전면 | 확정 사실 | 맨 위 칸까지 마이다 (경첩·보링 없음). 붙박이장 외부 서랍 위 도어는 예외 | — |
| 키큰장·붙박이장 좌대 | 10-20 07:44 | 뒤 맞춤 — 상자 뒷면=몸통 뒷면, 앞 50 들어감, 그 자리에 걸레받이 MDF 18T, 32 남음. 측판은 전후판 사이 | #934 #987 |
| 키큰장 상몰딩 띠 | 10-20 14:47 | MDF 18T 60×W, 몸통 위 y=H..H+60, 앞면 = 도어 앞면, 뒷면 = 몸통 앞선 (3D 는 다르게 그림, 안 고침) | #990 |
| 붙박이장 도어 세로 | 10-20 08:22 | 바닥 20 띄움 — 좌대 40 덮고, 윗변 = 몸통 상단 | #934 |
| 붙박이장 외부 서랍 | 10-20 | 서랍 위 도어는 서랍모듈 위에만. 목찬넬 2단에서만 서랍 위 각 1개, EP 100×W + 120×W. 3단은 위 두 전면 사이 4 → 342×3. 측판 따내기 70×40 + 90×40, 천판 빼기, 박스 = 싱크 규칙(레일 500, 측판 490, 바닥+30) | #940 #943 #952 |
| 목찬넬 EP 제작 | 10-20 08:57 | 100 → 40+52, 120 → 40+72 ㄴ자 | #943 |
| 붙박이장 내부 서랍장 | 10-20 | 도어 앞면 = 통 앞선 −70, 모듈 앞선 −85, 박스 = 자리 바닥+30, 가로 가운데 | #952 #969 |
| 서랍장 전면 통일 | 10-22 08:26 | 신발장·수납장·화장대·창고장 서랍장 전면 = 싱크 규칙 | #993 |
| 찬넬(알루미늄) 손잡이 서랍장 | 10-22 08:40 | 도어 재단은 싱크와 같음, 측판 따내기·ㄴ자 목찬넬 없음 | #994 |
| 멍장 ㄱ자 경첩목대 | 10-22 08:36 | 천판·지판 사이 H−2T, 목찬넬 몸통은 따내기 70 + 밴드 아래까지 → 15T 기준 H−100 (18T H−106) | #994 |
| 냉장고장 | 10-22 | 냉장고상부장 = 15T 사쿠리 + 보강목 2장(상부장에만). 도어 (W−4)/n × (H+20), 아래로 20 (윗변=몸통 상단) | #995 |
| 걸레받이 앞면 | 10-22 카드 1-1 | 몸통 앞선 −32, 바닥에 붙임 (틈 5 는 위, 캐쳐 몫) | #997 #998 |
| 휠라·몰딩·EP 앞면 | 10-22 카드 2-1 | 도어 앞면 (하부 라인 양 끝 밖) | #997 |
| 라인 부재 조각 순서 | 10-22 카드 1 | 왼쪽부터 2440, 남는 조각은 오른쪽 끝 | #997 |
| 경첩 컵 자리 (4-1 A, D5 일부) | 10-23 | 도어 변에서 컵 가장자리 4 → 컵 중심 21.5, 깊이 12.5 (추천대로 — 실측이 오면 `HINGE_CUP_EDGE`·`HINGE_CUP_DEPTH` 만 고친다) | #1002 |
| 가운데 다리발 (4-1 B) | 10-23 | 6·8개면 앞줄·뒷줄마다 두 코너 다리 사이 균등 분할 | #1002 |
| 외짝 도어 경첩 방향 (4-1 C) | 10-23 | 설계 화면의 좌개/우개 = 플래너 칸 열림 방향 좌 ◀ / 우 ▶ (◀ = 왼쪽 경첩). 브리지가 `hingeSide` 로 싣는다. 고르지 않은 칸 기본은 좌 | #1002 #1003 |
| 볼레일 높이 (4-1 D) | 10-23 | 측판 밑단 맞춤 — 박스 측판 바깥에 두께 14, 밑단 = 박스 측판 밑단 | #1002 |
| 서랍장 맨 위 칸 (모듈 라이브러리 Q4) | 10-24 | **위 칸도 서랍이다** — 맨 위 칸 전면(마이다) 뒤에도 서랍 박스·레일. 지금 BOM 은 위 칸 박스를 안 낸다 (서랍 2단 = 전면 2장 · 박스 1개). 아직 반영 전 (4-4) | #1024 |
| 상부장 몸통 깊이 (모듈 라이브러리 Q3) | 10-24 | **295 가 맞다** — 플래너 상부 기본 배치 깊이 320 에서는 몸통이 290 으로 앉는다 (앞 자리 30 을 뺀다). 아직 반영 전 (4-4) | #1024 |

표준 높이: 싱크 하부 몸통 708 + 다리발 150 + 상판 12 = 870, 상부장 720·깊이 295, 상몰딩 60.

---

## 4. 남은 질문과 미정

### 4-1. 답 받음 (2026-10-22 에 물음 → 2026-10-23 "전부 추천대로", 3절 표 · #1002 · #1003 에 반영)
| # | 질문 | 추천 | 비고 |
|---|---|---|---|
| A | 경첩 컵 백셋·깊이 (D5 일부) | 가장자리에서 4 (컵 중심 21.5), 깊이 12.5 | 실측 값이면 그 값 |
| B | 6·8개 다리발의 가운데 자리 | 균등 분할 | 지금은 4 코너만 놓음 |
| C | 외짝 도어 경첩 방향 | 설계 화면에 좌개/우개 항목 추가 | 화면 변경은 Design UI 도메인 |
| D | 볼레일 높이 | 측판 밑단 맞춤 | 언더레일은 놓음 |

### 4-2. 나중으로 미룸 (사장님이 "지금 묻지 않음")
- 코너 마감재 자리 — 몰딩·휠라로 나뉨, 크기는 도면이 생긴 뒤.
- 걸레받이 재단 규칙.
- ㄱ자 하부 라인의 좌우 마감재 벽 끝 처리.
- 옛 설계의 내부 서랍(w3) — 의도적으로 아직 안 놓음.

### 4-3. 결정 표 미정
| # | 질문 |
|---|---|
| D1 | 다칸 모듈: 칸마다 통 vs 한 통 + 칸막이 |
| D2 | 서랍장 처짐방지목 위치 (지금은 경고만) |
| D3 | 상판 깊이 600/650 과 기준 |
| D4 | 걸레받이·몰딩·목찬넬 재단 단위 |
| D5 | 사쿠리 홈 깊이 (실측) — 서랍 측판 홈 높이 15 는 확정, 경첩 컵 자리는 2026-10-23 추천값으로 정함 (실측이 오면 고침) |
| D6 남음 | 파트너의 상세설계 접근, 파트너 외관 파일 |
| D7 | 벤더 파일 형식 (DXF 등) |
| D9 | 휠라 도면 vs 스펙 |
| D10 | 18T 몸통 실사용 — 18T 상부 선반 D−34 가 처짐방지목에 2mm 파고드는 "알려진 겹침"과 함께 |

### 4-4. 기타 남은 일 (사장님 지시가 있어야 시작)
- T1 보고서의 플래너 3D 버그 3건.
- 모듈 라이브러리(`docs/01-plan/module-library.plan.md` §7, 2026-10-24 결정)가 기다리는 다른 도메인 일:
  - BOM: 서랍장 맨 위 칸 서랍 박스·레일 (Q4 — `extractors.js drawerLayoutOf` · `bom-drawer-rules.js layoutByGrades`, 정본에 `drawerLayout:'all'` 경로가 있다. 서랍장 골든이 바뀐다), 하부 상자 모듈(오픈장·밥솥장·홈카페) 다리발 자리 (Q2 — `bom-assembly.js` 의 `leg-tall-tier`)
  - Design UI(브리지): 상자 모듈(밥솥장·홈카페) 외짝 도어 `hingeSide` (Q5 — `ui-step1.js` 는 칸 모듈에만 싣는다)
  - 플래너: 상부 기본 배치에서 몸통 295 (Q3), 홈카페장 선반 자리 (Q5 — 플래너 선반 1 · 규칙 2)
- 작업지시서 발행 API 가 플랜(요금제)을 확인하지 않음 (워크플로 도메인).
- 플래너 3D 원장 (PR15): 명세로 그린 판재 486장은 id 로 맞고(±0.5mm), 예전 그리기와 BOM 은 213건 다르다 (`test-utils/ledger-baseline.json` 래칫, 픽스처 7벌). **3D 를 근거로 BOM 을 고치지 않는다.**
- 다음 계획 단계: ~~PR8 CI 검산기~~ (보고만 단계로 시작, 2주 초록이면 게이트), ~~PR10 동결~~ (워커 `validateAssembly` #1006 → 클라이언트 `createSnapshot` 이 `bom.assembly` 를 보냄), ~~PR11 플래너 검사 배지~~ (관리자 전용, `planner-cad-check.js`), ~~PR12 3D 몸통을 명세로~~ (원장 186→105, `?asm=0` 되돌리기) → ~~PR13 앞판·중간 목찬넬·서랍통~~ (서랍 전면 id 별도, 상단 목찬넬은 라인 부재라 PR14) → ~~PR15 원장 id 대조 + 래칫~~ → ~~PR14a 걸레받이·상단 목찬넬·상몰딩~~ (상판 뒤 기준·스펙 마감재 D9 는 확인 대기) → ~~PR14b 붙박이장·오픈장·밥솥장~~ (원장 114) → ~~PR17a 판재 도면~~ (재단 묶음) → ~~PR17b 모듈 단면도~~ (조립 묶음 ⑪-2) → PR16a GLB 외관 거름망 · 명세 해시 · SQL(`database/design-cad-artifacts.sql`, 사장님 실행 대기) → PR16b 워커 동결본 올리기 · 서명 URL (SQL 실행 뒤), CAD 검산기 `--strict` 승격 (2026-11-06 무렵).

---

## 5. 터미널 작업 방식

### 5-1. 묻는 법
- 모든 답변·보고·PR 설명은 **한국어**. 보고는 표·치수 중심.
- **근거 없는 위치·치수는 지어내지 않는다.** 정본(`data-constants.js`, `bom-*-rules.js`, `assembly-rules.js`, `docs/design-rules/*.md`)에 없으면 멈추고, 선택지 2~4개와 추천·이유를 붙여 한 번에 묻는다. 답 전까지 그 부재는 명세에서 `unplaced`.
- 치수를 물을 때는 문서 자재표나 3D 그림이 아니라 **코드 산출(`extractors.js`·규칙 파일)** 을 기준으로 쓰고 출처를 밝힌다 (`sink.md` 자재표에 옛 값이 있다).
- 결정이 나면: 이 문서 3절, `docs/01-plan/cad-beta/project-instructions.md` 결정 표, `planner-cad.plan.md` 결정 반영을 `agent/docs-*` PR 로 고친다.

### 5-2. 저장소 규칙
- main 직접 커밋 금지. 브랜치(1절 prefix) → PR → CI → 머지.
- 같은 도메인 작업을 동시에 두 곳에서 하지 않는다 (같은 파일 충돌). 클라우드 프로젝트 스레드가 아직 돌고 있으면 그 도메인은 피한다.
- 새 시험은 **고치기 전 코드에서 먼저 실패하는지** 확인한다.
- 정규식·역슬래시가 든 내용은 셸 heredoc 대신 편집 도구로 쓴다 (`\b` 가 백스페이스로 박힌 사고).
- 커밋 전 `git pull origin main`, 푸시 실패 시 `git pull --rebase` 후 재시도.

### 5-3. 머지 (사장님 상시 승인: CI 통과하면 묻지 않고 머지, 결정이 나올 때까지 계속 진행)
- 조건: **Run Tests · TypeScript Check · Build 가 모두 conclusion=success**. skipped 는 실패로 친다 (Run Tests 실패 시 Build 가 skipped 되고, 필수 체크가 Build·TypeScript Check 뿐이라 그냥 머지될 수 있다).
- CI 확인:
  `gh api repos/dadamfurniture-source/dadam-cabinet/commits/<head sha>/check-runs --jq '.check_runs[]|[.name,.status,.conclusion]|@tsv'`
- 머지:
  `gh api -X PUT repos/dadamfurniture-source/dadam-cabinet/pulls/<번호>/merge -f merge_method=merge`
  (터미널에서는 `gh pr merge <번호> --merge` 도 된다. 클라우드에서는 GraphQL 이 막혀 REST 를 썼다.)
- CI 가 변경과 무관하게 실패하면 빈 커밋으로 다시 돌리지 않는다 — main 을 합쳐 푸시하거나 Actions 에서 "Re-run failed jobs".
- **워커(`workers/*`) PR**: PR CI 는 워커 시험을 안 돌린다 → 머지 전에 직접 돌리고 결과를 PR 본문에. 머지만으로 라이브가 아니다 → 배포 런 확인:
  `gh api "repos/dadamfurniture-source/dadam-cabinet/actions/workflows/workflow-api-deploy.yml/runs?branch=main&per_page=1" --jq '.workflow_runs[0]|[.head_sha,.conclusion]'`

### 5-4. 정적 페이지 `?v=` 규칙
- main 푸시 → GitHub Pages 1~2분. JS 를 바꾸면 그 스크립트를 싣는 HTML 의 `?v=` 를 올린다.
- `mockup-shell.html` 과 `mockup-structure.html` 은 같은 `?v=` 를 쓴다 (`__tests__/planner-assets.test.js`) — 둘 다 같은 값으로.
- `detaildesign.html` 은 따로 버전. 같은 규칙 파일이 두 쪽에 실리면 양쪽 다 올린다.
- `?v=` 는 **머지 직전에 main 을 다시 받아 그때 값 + 0.1**. (2026-10-23 기준 플래너 `44.6`.)
- 규칙 파일을 바꾼 PR 은 보고에 "Cloudflare Purge 필요할 수 있음".

### 5-5. 시험 명령
```bash
# 루트 (jest — planner-vite/, mcp-server/, workers/ 는 제외됨). CI 는 Node 24.
npm ci --prefer-offline && npm test

# BOM 골든 — 값이 의도적으로 바뀔 때만, 커밋 메시지에 이유
UPDATE_GOLDEN=1 npx jest __tests__/bom-golden
UPDATE_BASE_DIGEST=1 npx jest __tests__/bom-golden-addonly.test.js

# 도면↔BOM 원장 — 늘어나는 차이는 이유 확인, 줄어들면 좋은 신호
UPDATE_LEDGER_ALLOWLIST=1 npx jest __tests__/scene-bom-ledger.test.js

# 워커 workflow-api (lockfile 없음 — npm ci 금지)
cd workers/workflow-api && node --test "test/*.test.js"
# 워커 generate-api
cd workers/generate-api && npm ci && node --test "test/*.test.js"
# MCP 서버 (vitest)
cd mcp-server && npm ci && npm test
```
CAD 검산기 (PR8, 보고만): `node tools/cad/dump-assembly.js cad-oracle/dump` 다음 `uv run --no-project --python 3.13 --with build123d==0.11.1 --with cadquery-ocp-novtk==7.9.3.1.1 python -I tools/cad/build_from_spec.py cad-oracle/dump --out cad-oracle/out` — 파이썬 소스는 ASCII 만, 도메인 숫자 리터럴 금지(명세 JSON 만 읽는다). 설명은 `docs/design-rules/assembly-spec.md` "CAD 검산기".

### 5-6. 보안·공개
- **저장소는 공개다.** 고객 이름·주소·전화·실제 주문 설계, 개인 PC 경로를 커밋·Actions 로그·산출물·PR 본문에 넣지 않는다. 시험 픽스처는 합성 데이터만.
- `.env`, `gcp-service-account.json` 은 커밋하지 않는다 (`.gitignore`).
- Supabase SQL 은 Claude 가 실행하지 않는다. `database/*.sql` 로 만들고(추가만, drop 스크립트 함께) 전문을 보고에 붙여 사장님이 실행한다.
- 고객 화면에는 뒷판·처짐방지목·따내기·밴드·partId·보링 같은 내부 구조를 보이지 않는다 (상세설계 화면은 D6 예외). 그 밖의 CAD 기능은 관리자 전용.

### 5-7. Windows 로컬 주의
- `git worktree` 를 쓰면 jest 가 `.claude/worktrees/` 를 제외하지 않아 시험이 두 번 돈다 — 메인 클론에서 브랜치만 바꿔 일하거나, 워크트리 안에서는 그 워크트리 기준으로만 jest 를 돌린다.
- 워크트리에서 `node_modules` 를 정션으로 연결하지 않는다 — 재귀 삭제가 메인 `node_modules` 를 지운 사고가 있었다. 워크트리마다 `npm ci`.
- 줄바꿈은 LF (`.gitattributes` 고정). 에디터가 CRLF 로 바꾸지 않게 한다.
- cadgen 모델 러너는 Windows 에서 import 오류로 안 돈다 → 평범한 build123d 스크립트 + `bd.export_step/export_gltf` 로 우회. 소스는 ASCII 만(cadgen 이 cp949 로 읽음), `UV_CACHE_DIR=%USERPROFILE%\.cache\uv`.
- 로컬 MCP 서버(`localhost:3200`)와 사장님 PC 의 자료(견적서·거래명세서 등)는 터미널에서 쓸 수 있지만 내용을 저장소에 커밋하지 않는다.
- 옛 참고 프로토타입 `cad-prototype/` 은 PR8 검산기로 대체하고 지웠다 (숫자가 들어 있어 규칙 정본이 아니었다). 결과를 뷰어로 보려면 Actions 산출물 `cad-oracle-<sha>` 의 STEP 을 받아 text-to-cad `cad_show` 로 연다.

---

## 6. 터미널 첫 명령

```bash
cd dadam-cabinet                      # 클론 위치
git checkout main && git pull origin main
node -v                               # 24 권장 (22 도 동작)
npm ci --prefer-offline
npm test                              # 모두 통과하는지 먼저 확인
git log --oneline --merges -15        # #1000 이후 머지 확인
```

Claude Code 에 줄 첫 말 예시:

```
docs/01-plan/cad-beta/handoff.md 를 읽고 CAD 베타를 이어 가자.
4-1 의 답: A=…, B=…, C=…, D=… (모르면 4-1 을 선택지·추천으로 다시 물어봐).
답을 반영해 agent/bom-* 브랜치에서 bom-assembly.js 를 고치고, 시험 통과 → PR → CI 초록이면 머지까지 해 줘.
```
