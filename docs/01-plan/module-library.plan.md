# 모듈 라이브러리 — 계획·백로그·질문

> 상태: 1단계 진행 (2026-10-24 사장님 승인). 도메인 **Module Library** (`agent/modlib-*`, CLAUDE.md 도메인 표).
> 에이전트: `.claude/agents/module-library.md` · 역할 파일 `.claude/skills/agents/modlib/{engineer,designer,qa}.md`.
> **2026-10-24 사장님: 라이브러리를 별도 저장소로** — 모듈 정의 정본은 `dadamfurniture-source/dadam-module-library` (비공개, 50종). §9.

## 0. 왜

싱크대에 들어갈 가구 모듈을 **미리 많이 만들어 둔다.** 크기는 기본값으로 고정하고 내부 구조만 다양하게 한다
(여닫이 1도어 하부장, 1도어 상부장, 서랍장, 키큰장, 오픈장, 밥솥장 …). 만든 모듈은 Text-to-CAD(build123d)로
검산해 보고, 다담 플래너에 그대로 넣을 수 있어야 한다.

플래너는 외부 3D 파일(GLB/STEP)을 읽지 않는다. BOM·플래너 3D·관리자 CAD GLB·CI 검산기는 모두 같은
**설계 모듈 데이터**에서 출발한다. 그래서 라이브러리는 **선택값만 담은 데이터**이고, 판재 치수는 언제나 기존 규칙이 낸다.

```
모듈 정의 (선택값)  js/module-library/module-library.js
   │  structureOf(entry) — 플래너 구조 레코드 (서랍 비율 → DadamDrawerRules.gradesFromRatio)
   ▼
플래너 payload → 실제 브리지 _convertPlannerModules (ui-step1.js)        ← 플래너 적용 증거
   ▼
MaterialExtractor / HardwareExtractor → BOM (모듈별 골든)
   ▼
plannerExportCadSpec (planner-export.js) → DadamAssembly.of → dadam.assembly/1
   ├─ DadamAssemblyCheck.check — 겹침·뒷판·떨어진 판 0
   └─ [Text-to-CAD] tools/cad/build_from_spec.py (build123d) → <모듈>.step / .glb + OCC 대조
        ▼
   모듈 카드 보고서 (정면도 SVG · GLB 3D · BOM 요약 · 검사 결과) — 내부용
```

## 1. 사장님 결정 (2026-10-23)

| 항목 | 결정 |
|---|---|
| 기본 폭 | 1도어 **450**, 2도어 **900**, 서랍장 **600**, 키큰장·EL·홈카페 **600**, 밥솥장 **450**, 오픈장 **450** |
| 높이·깊이 | 기존 규칙 그대로 — 하부 870(몸통 708 + 다리 150 + 상판 12)·몸통 D 550 / 상부 몸통 720·D 295 / 키큰장 2300 |
| 서랍 "N단" | **전면 장수** — 서랍 2단 = 전면 2장(맨 위 칸 + 서랍 1, 870 기준 324/324). 2~5단 |
| 이번 범위 | **개별 모듈을 여러 개 만드는 일** — 데이터, BOM·조립 검증, STEP/GLB, 보고서 |
| 다음 (범위 밖) | 2단계 플래너 "라이브러리에서 추가" 버튼 · 3단계 여러 모듈을 한 라인에 배치(조합) |

## 2. 모듈 정의 형식 — 선택값만

```js
{ id: 'LB-D1-450-L', rev: 1, group: 'lower-door', section: 'lower', W: 450,
  name: '여닫이 1도어 하부장 (좌경첩)',
  choice: { doors: 1, hinge: 'left' },
  // 서랍장: choice: { drawer: { ratio: '2:1:1', rail: 'under', sakuri: false } }
  // 오픈:   choice: { kind: 'open' } 또는 { cell: 'open' }
  ruleRefs: ['extractors.js extractSink', 'planner-engine.js distributeModules'],
  status: 'verified' }
```

- **치수 숫자를 적지 않는다.** W 는 `APPROVED_WIDTHS` (1절 결정) 안에서만 고른다. H·D·판재 치수는 규칙이 낸다.
- `structureOf(entry)` 는 플래너 `defaultStructure()` (mockup-structure.html) 의 키만 쓴다. 선반 높이는
  `calcDefaultShelves(section, 몸통 H)` (planner-engine.js) — 플래너 `addModuleToArea` 가 넣는 값과 같다.
- 검증용 영역: 깊이 = max(플래너 섹션 기본 깊이, 규칙 몸통 D + 물받이 10 + 도어 자리 20). 하부 650 → 몸통 550, 상부 325 → 몸통 295.
- 품목 스펙은 원장 시험의 `LEDGER_SPECS` (test-utils/bom-parts.js — data-constants DEFAULT_SPECS 싱크 부분)에서
  **좌·우 마감만 None** 으로 둔다. 좌·우 마감재는 모듈이 아니라 라인(3단계)의 것이다.
- 상태: `backlog → verified` 또는 `needs-rule:<사유>` (질문 표 7절에 올린다). allowlist 로 통과시키지 않는다.

## 3. 모듈마다 통과해야 할 게이트

1. `distributeModules(W)` 가 정확히 `[{w: W, is2D: doors === 2}]` — 플래너 자동계산과 같은 모양.
2. `verticalCount === 1` — 3칸 이상은 `needs-rule:D1`. 2도어 900 은 한 통이라 D1 이 아니다.
3. 브리지 `_convertPlannerModules` 경고 0건.
4. BOM 자재 행 ≥ 1, 모듈별 골든과 같다 (`test-utils/module-library/golden/<id>.golden.json`, `UPDATE_MODLIB_GOLDEN=1`).
5. `DadamAssemblyCheck.check` 오류 0건.
6. 모듈 몫 미배치 0건 — 그 모듈의 `unplaced` 행, `module.pending`, `hardware[].pending` 이 비어 있다.
   품목 단위 라인 부재(`ep` 행: 상판·걸레받이·목찬넬·상몰딩)는 3단계(배치) 몫이라 게이트가 아니라 보고서에 적는다.
7. Text-to-CAD — build123d 판 수·부피(±0.1%)·겹침 쌍이 JS 와 같다 (OCC 불일치 0).
8. 드리프트 — `structureOf` 키가 플래너 `defaultStructure()` 키 집합 안에 있다.
9. 왕복 — 실제 플래너 하네스(`bootPlanner3D(layout, {autoCalc:false, assembly:true})`)에 `addModuleToArea` 로 넣고
   구조를 덮은 뒤 `plannerCadSpec` 을 읽으면, 순수 경로와 같은 명세·BOM 이 나온다.

## 4. Text-to-CAD

- 로컬: `node tools/module-library/dump-library.js tmp/modlib/dump [id…]` →
  `uv run --no-project --python 3.13 --with build123d==0.11.1 --with cadquery-ocp-novtk==7.9.3.1.1 python -I tools/cad/build_from_spec.py tmp/modlib/dump --out tmp/modlib/out`.
  Windows 는 `UV_CACHE_DIR=%USERPROFILE%\.cache\uv`. build_from_spec.py 는 평범한 build123d 스크립트라 cadgen 러너 문제를 피한다.
- 보고서: `node tools/module-library/report.js tmp/modlib/out [id…] [--label 1회차]` → `tmp/modlib/out/index.html`
  (정면도 · 같은 폴더 GLB 3D · 게이트 칩 · 자재표 · 철물). 견본은 `--samples`, CI 는 `--with-samples` (verified + 견본).
- CI: `.github/workflows/module-library-cad.yml` (보고만, 산출물 `modlib-cad-<sha>` — STEP · GLB · report.json · index.html). 2주 초록이면 게이트로 올린다.
- build123d GLB 는 판재를 메시 하나로 합친다 — 보고서 3D 는 판재 색 하나 + 모서리 선. 판재별 색은 정면도가 맡는다.
- 새 파이썬은 만들지 않는다. 덤프는 판재만 싣는다 (런 부재·철물 없음 — dump-assembly.js 와 같다).
- 보기: 회차마다 모듈 카드 보고서. STEP 은 데스크톱 앱 text-to-cad 플러그인 `cad_show` 로도 연다.
  내부 구조(뒷판·처짐방지목·따내기)가 보이므로 Pages·고객 화면에는 올리지 않는다.

## 5. PR 순서 (1단계)

| # | 브랜치 | 도메인 | 내용 |
|---|---|---|---|
| 0 | `agent/docs-modlib` | 문서 | 이 문서, CLAUDE.md 도메인 행, 역할 파일, 에이전트 정의 |
| 1 | `agent/bom-cad-dump-spec` | BOM | `tools/cad/dump-assembly.js` 의 `dumpOf(name)` 에서 `dumpSpecOf(name, spec)` 분리 (동작 같음) |
| 2 | `agent/modlib-foundation` | modlib | 라이브러리 파일 · `test-utils/module-library/{pipeline,harness,golden,samples}.js` · 게이트 시험 `__tests__/module-library{,-roundtrip}.test.js` |
| 3 | `agent/modlib-cad` | modlib | `tools/module-library/*` · `module-library-cad.yml` |
| 4~ | `agent/modlib-round-N` | modlib | 모듈 회차 (6절) — 회차마다 PR 하나 · 보고서 하나 |

## 6. 백로그

시제품(2026-10-24)으로 게이트를 미리 돌려 본 결과를 함께 적는다.

### 1회차 — 도어장 · #1021 (verified 7)
| id | 모듈 | 폭 | 시제품 |
|---|---|---|---|
| LB-D1-450-L / -R | 여닫이 1도어 하부장 좌·우경첩 | 450 | 통과 (판 8 · 철물 6) |
| LB-D2-900 | 여닫이 2도어 하부장 | 900 | 통과 (판 10 · 처짐방지목 포함) |
| UB-D1-450-L / -R | 1도어 상부장 좌·우경첩 | 450 | 통과 (판 10) |
| UB-D2-900 | 2도어 상부장 | 900 | 통과 (판 12) |
| UB-FLAP-450 | 플랩 상부장 (위로 열림) | 450 | 통과 |

### 2회차 — 서랍장 600 (전면 장수) · #1022 (verified 9)
| id | 모듈 | 전면 비율 | 전면 높이 (위→아래) | 결과 |
|---|---|---|---|---|
| LB-DR2-600 | 서랍 2단 | 2:2 | 324 / 324 | verified |
| LB-DR2-600-12 | 서랍 2단 (작은 위 칸) | 1:2 | 216 / 432 | verified |
| LB-DR3-600 | 서랍 3단 | 2:2:2 | 216 × 3 | verified |
| LB-DR3-600-211 | 서랍 3단 (큰 위 칸) | 2:1:1 | 324 / 162 / 162 | verified |
| LB-DR3-600-122 | 서랍 3단 (작은 위 칸) | 1:2:2 | 129 / 259 / 260 | verified |
| LB-DR4-600 | 서랍 4단 | 2:2:2:2 | 154 / 154 / 154 / 156 | verified |
| LB-DR4-600-1222 | 서랍 4단 (작은 위 칸) | 1:2:2:2 | 88 / 176 / 176 / 178 | verified |
| LB-DR3-600-BALL | 서랍 3단 볼레일 | 2:2:2 | 216 × 3 | verified |
| LB-DR3-600-SAKURI | 서랍 3단 사쿠리 서랍 | 2:2:2 | 216 × 3 | verified |
| ~~LB-DR5-600~~ | 서랍 5단 | 2:2:2:2:2 | 123 × 4 / 126 | 겹침 8쌍 → **Q1 결정으로 뺌** |
| ~~LB-DR4-600-2111~~ | 서랍 4단 (큰 위 칸) | 2:1:1:1 | 247 / 123 / 123 / 125 | 겹침 8쌍 → **Q1 결정으로 뺌** |

겹침은 JS 조립 검사와 build123d(OCC) 솔리드가 같은 8쌍을 찾았다 (불일치 0) — 실제 형상 충돌이다.
중간 목찬넬(전면·지면)이 그 아래 서랍 박스의 측판·전후판에 1~7mm 파고든다. 전면이 123 안팎일 때만 생긴다.

### 3회차 — 오픈장 450 · #1023 (verified 3)
| id | 모듈 | 결과 |
|---|---|---|
| UB-OPEN-450 | 오픈장 상부 (MDF 18T 상자, `moduleKind:'open'`) | verified (판 5) |
| UB-SHELF-450 | 오픈 칸 상부장 (`areaTypes:['open']`, 선반 2) | verified (판 9) |
| LB-SHELF-450 | 오픈 칸 하부장 (도어 없음, 선반 없음) | verified |
| LB-OPEN-450 | 오픈장 하부 (MDF 18T 상자) | **needs-rule:Q2** — 조립 명세가 오픈장 다리발 자리를 아직 안 정한다(`leg-tall-tier`) |

오픈장 상자는 플래너 모듈 타입 선택에 섹션 제한이 없어 상부에도 둔다 (처음 계획의 "하부만"은 정본에 없는 제한이라 뺐다).

### 4회차 — 키큰장·EL·홈카페·밥솥장 (2026-10-24 시험 결과 — 모두 다른 도메인 작업이나 결정이 먼저)
| 모듈 | 시험 결과 | 막힌 이유 |
|---|---|---|
| 밥솥장 450 (도어 없음 · 여닫이 …) | G6 `leg-tall-tier` (+ 여닫이는 `hinge-side-unknown`) | 오픈장 상자 계열이라 하부 라인 다리발 자리가 없다 (Q2 와 같다). 상자 모듈의 외짝 경첩 방향을 브리지가 안 싣는다. 밑에 서랍이 있어야 한다(경고) — 단독 모듈이 아니다 |
| 홈카페장 600 | G6 `shelf-height-unknown` · `hinge-side-unknown` · `leg-tall-tier` | 냉장고장 전용 모듈(extractFridge)이 싱크대 하부에 놓인 꼴 — 선반 2 고정인데 플래너 선반 1, 경첩 방향·다리발 없음 → Q5 |
| EL장 600 | 게이트 통과, 그러나 도어 · 선반 행이 없다 | EL 크기·도어 규칙 `[확인 필요]` (bom-el-rules) → Q5 |
| 키큰장 600×2300 | — | 한 영역에 3단(모듈 3개)이 쌓이는 묶음 — 개별 모듈이 아니라 3단계(배치) 몫. 단 높이 계산도 mockup-structure.html 안(`tallTiers`) |

### 보류 — 규칙 없음
쿡탑 하부장 · 식기세척기장 · 오븐/전자렌지장 · 위 칸 없는 순수 서랍장 · W≥800 서랍장(D2) · 3칸 이상(D1) ·
18T 몸통(D10) · 개수대 하부장(싱크 표시와 함께) · 코너장.

## 7. 질문과 결정 (사장님)

| # | 질문 | 결정 (2026-10-24) | 할 일 · 도메인 |
|---|---|---|---|
| Q1 | 서랍 전면이 123 안팎으로 낮아지면(5단 · 2:1:1:1) 중간 목찬넬과 서랍 박스가 겹친다 (JS · OCC 같은 8쌍) | **이런 조합은 빼고 9종을 둔다** | 라이브러리에서 뺐다 (modlib) |
| Q2 | 하부 오픈장 상자의 다리발 자리 (`leg-tall-tier`) | **BOM·플래너 먼저** (Q5 와 같이) | 하부 상자 모듈(오픈장·밥솥장·홈카페) 다리발 자리 — BOM (`bom-assembly.js`) |
| Q3 | 상부 기본 배치 깊이 320 이면 몸통이 290 으로 앉는다 (규칙 295) | **295 가 맞다** | 플래너 상부 기본 배치에서 몸통 295 가 앉게 — 플래너 (`planner-sections.js` · `seatModuleDepth`). 라이브러리는 지금처럼 295 로 검증 |
| Q4 | 서랍장 맨 위 칸 전면(마이다) 뒤에 서랍 박스가 없다 (서랍 2단 = 전면 2장 · 박스 1개) | **위 칸도 서랍이다** | 맨 위 칸에도 서랍 박스·레일 — BOM (`extractors.js drawerLayoutOf` · `bom-drawer-rules.js layoutByGrades`). 정본에 모든 전면이 서랍인 `drawerLayout:'all'` 경로가 이미 있다. 서랍장 골든(라이브러리 9종 · bom-golden sink15/18 l2 · vanity …)이 바뀐다 |
| Q5 | 밥솥장 · 홈카페장 · EL장 · 키큰장 | **BOM·플래너 먼저, 키큰장은 3단계(배치)와 함께** | 상자 모듈 외짝 경첩 방향 `hingeSide` (브리지 — Design UI `ui-step1.js`), 홈카페 선반 자리 (플래너 `planner-export.js` 선반 수), EL 크기 규칙 (사장님) |

## 8. 알려 둘 차이 (고치지 않고 보고만)
- 선반: `addModuleToArea` 는 몸통 708 기준 [354], `autoCalcModule` 은 720 기준 [360].
- 상부장만 있는 품목: BOM 이 "하부 모듈 없는 옛 설계" 대체 경로(품목 폭 − 120)로 걸레받이·목찬넬·상판을 낸다 — 라인(3단계) 몫이라 모듈 게이트에서 뺀다.

## 9. 별도 저장소 (2026-10-24)

사장님 지시 "모듈 라이브러리 저장소를 따로 만들고 50개 먼저"로 라이브러리를 `dadamfurniture-source/dadam-module-library`(비공개)로 옮겼다.

| 항목 | 내용 |
|---|---|
| 규칙 | 새 저장소에는 규칙이 없다. 이 저장소가 `engine/` 서브모듈(커밋 고정)로 들어가 브리지 · BOM · 조립 · 플래너 왕복 · build123d 를 그대로 낸다 |
| 모듈 | `modules/<묶음>/<id>/module.json` (선택값만, 이 문서 §2 형식) + 골든 · 정면도 · cad.json · STEP · GLB |
| 50종 | 도어장 7 · 오픈 3 · 서랍장 40 (모든 레일 · 사쿠리 · 서랍 자재 · 손잡이에서 겹침 없는 전면 배치 13 × 언더레일 · 볼레일 · 사쿠리 + 18T 서랍 자재 1). 보류 1 (하부 오픈장 상자, Q2) |
| 게이트 | 이 문서 §3 의 1~9 그대로 + 싱크대 손잡이 4종 |
| 이 저장소의 `js/module-library` 등 | 그대로 둔다 (20종, 정본 아님). 2단계 "라이브러리에서 추가" 버튼 때 새 저장소 것을 가져오도록 정한다 |

엔진 규칙이 바뀌면(예: Q4 위 칸 서랍 박스) 새 저장소에서 서브모듈을 올리고 골든 · STEP 을 다시 만든다.
