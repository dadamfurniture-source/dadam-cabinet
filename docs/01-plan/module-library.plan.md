# 모듈 라이브러리 — 계획·백로그·질문

> 상태: 1단계 진행 (2026-10-24 사장님 승인). 도메인 **Module Library** (`agent/modlib-*`, CLAUDE.md 도메인 표).
> 에이전트: `.claude/agents/module-library.md` · 역할 파일 `.claude/skills/agents/modlib/{engineer,designer,qa}.md`.

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
- CI: `.github/workflows/module-library-cad.yml` (보고만, 산출물 `modlib-cad-<sha>`). 2주 초록이면 게이트로 올린다.
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

### 1회차 — 도어장
| id | 모듈 | 폭 | 시제품 |
|---|---|---|---|
| LB-D1-450-L / -R | 여닫이 1도어 하부장 좌·우경첩 | 450 | 통과 (판 8 · 철물 6) |
| LB-D2-900 | 여닫이 2도어 하부장 | 900 | 통과 (판 10 · 처짐방지목 포함) |
| UB-D1-450-L / -R | 1도어 상부장 좌·우경첩 | 450 | 통과 (판 10) |
| UB-D2-900 | 2도어 상부장 | 900 | 통과 (판 12) |
| UB-FLAP-450 | 플랩 상부장 (위로 열림) | 450 | 통과 |

### 2회차 — 서랍장 600 (전면 장수)
| id | 모듈 | 전면 비율 | 시제품 |
|---|---|---|---|
| LB-DR2-600 | 서랍 2단 | 2:2 | 통과 |
| LB-DR3-600 | 서랍 3단 | 2:2:2 | 통과 |
| LB-DR3-600-211 | 서랍 3단 (큰 위 칸) | 2:1:1 | 통과 |
| LB-DR4-600 | 서랍 4단 | 2:2:2:2 | 통과 |
| LB-DR3-600-BALL | 서랍 3단 볼레일 | 2:2:2 | 통과 |
| LB-DR3-600-SAKURI | 서랍 3단 사쿠리 서랍 | 2:2:2 | 통과 |
| LB-DR5-600 | 서랍 5단 | 2:2:2:2:2 | **겹침 8건** — 중간 목찬넬 따내기와 서랍 박스(측판·전후판)가 1~7mm 파고든다 → Q1 |

### 3회차 — 오픈장 450
| id | 모듈 | 시제품 |
|---|---|---|
| UB-OPEN-450 | 상부 오픈 칸 (`areaTypes:['open']`) | 통과 (판 9) |
| LB-OPEN-450 | 하부 오픈장 (`moduleKind:'open'`, MDF 18T) | **막힘** — 조립 명세가 오픈장 다리발 자리를 아직 안 정한다(`leg-tall-tier`), BOM 라인 폭에서도 빠진다 → Q2 |

### 4회차 — 키큰장·EL·홈카페·밥솥장 (선행 조건)
| 모듈 | 막힌 이유 |
|---|---|
| 키큰장 600×2300 3단 | 단 높이 계산이 mockup-structure.html 안(`tallTiers`)에 있어 순수 경로가 없다 — 왕복(하네스) 경로로만 검증하거나 플래너 도메인이 계산을 엔진으로 옮긴 뒤 |
| 홈카페장 · EL장 600 | ~~`PLANNER_EXPORT_CELL_RE` 가 `-homecafe` · `-el` id 를 못 잡음~~ — #1018 (PR14b) 에서 풀림. 홈카페장은 냉장고장 전용 모듈(extractFridge)이라 싱크대 품목에서 되는지 확인 필요, EL 크기 `[확인 필요]` |
| 밥솥장 450 | 바로 밑에 서랍이 있어야 한다(경고) — 단독 모듈이 아니라 묶음. 자리·높이 미정, 선반 규격 `[확인 필요]` |

### 보류 — 규칙 없음
쿡탑 하부장 · 식기세척기장 · 오븐/전자렌지장 · 위 칸 없는 순수 서랍장 · W≥800 서랍장(D2) · 3칸 이상(D1) ·
18T 몸통(D10) · 개수대 하부장(싱크 표시와 함께) · 코너장.

## 7. 질문 (사장님)

| # | 질문 | 선택지 (추천 먼저) |
|---|---|---|
| Q1 | 서랍 5단(위 칸 + 서랍 4)은 870 에서 중간 목찬넬과 서랍 박스가 겹친다 | ① 라이브러리에서 5단을 빼고 4단까지만 (추천 — 규칙 그대로) ② BOM 도메인에 박스 높이·따내기 규칙 검토 요청 |
| Q2 | 하부 오픈장의 다리발 자리·걸레받이·상판 | ① BOM 도메인에 오픈장 다리발 자리 구현 요청 후 진행 (추천) ② 하부 오픈장은 보류 |
| Q3 | 상부 기본 배치 깊이 320 이면 몸통이 290 으로 앉는다 (규칙 295) | ① 라이브러리는 295 로 검증하고 차이는 플래너 도메인에 보고 (지금 방식) ② 상부 기본 배치 깊이를 325 로 |

## 8. 알려 둘 차이 (고치지 않고 보고만)
- 선반: `addModuleToArea` 는 몸통 708 기준 [354], `autoCalcModule` 은 720 기준 [360].
- 상부장만 있는 품목: BOM 이 "하부 모듈 없는 옛 설계" 대체 경로(품목 폭 − 120)로 걸레받이·목찬넬·상판을 낸다 — 라인(3단계) 몫이라 모듈 게이트에서 뺀다.
