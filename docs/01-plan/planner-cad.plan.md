# 다담 플래너 CAD 적용 계획 (울트라 플랜)

- 작성: 2026-10-19, 에이전트 10명 (코드 지도 5 · 구조안 3 · 심사·종합 1 · 비평 1)
- 보고서: 비공개 아티팩트 (사장님 계정)
- 실행 환경: Claude Code 프로젝트(베타) — `docs/01-plan/cad-beta/README.md`
- 상태: **1주차 진행** — D11 승인 (2026-10-18), D6 일부 확정 (2026-10-18, 아래 "결정 반영")

## 한 줄 결론

build123d·cadgen 을 사이트에 올리지 않는다. 오늘 CAD 로 실제로 한 일 — 규칙으로 판재 하나하나의 정확한 위치를 정하고 서로 부딪히는지 검사 — 을 플래너 안의 JS 로 옮긴다. 규칙 한 표(`assembly-rules.js`) → 조립 명세(`bom-assembly.js`) → BOM · 플래너 3D · 겹침 검사 · 도면이 모두 이 명세 하나를 읽는다. build123d 는 CI 에서 합성 골든으로만 결과를 맞춰 보는 검산기다. 새 서버 없음, 추가 비용 월 0원 수준.

## 개정 사항 (비평 16건 반영 — 아래 본문보다 우선)

| # | 문제 | 고친 방법 |
|---|---|---|
| 1 | 저장소가 **공개** — Actions 로그·산출물을 누구나 본다 | CI 검산기는 합성 골든만. 실제 주문 STEP 은 비공개 런타임에서만 (PR21). 규칙 코드는 이미 공개 JS — 감출 것은 주문별 설계 데이터와 화면 |
| 2 | `cad` 버킷에 renders 정책을 복사하면 고객이 올리고 지울 수 있다 | 쓰기는 서비스 역할·관리자만, 읽기는 관리자·서명 URL, 고객용은 `exterior/` 접두사, `design_cad_artifacts` RLS, 해시 검증된 것만 동결본 |
| 3 | 선반을 모두 D−15 로 쓰면 BOM·골든과 어긋남 (상부는 D−34, 사쿠리) | 하부 D−T, 상부 D−34 그대로. 결정 D12 추가 |
| 4 | 같은 규칙 파일을 페이지마다 다른 `?v=` 로 부른다 (플래너 40.x · detaildesign 36.x) | 같은 src 같은 `?v=` 시험, PLANNER_DONE 에 `rulesVersion`, 워커 최소 버전 거부, 규칙 PR 마다 CDN 비우기. BOM PR 이 mockup-structure.html `?v=` 를 올리는 공동 소유 명시 |
| 5 | #832 회귀 시험이 아무것도 증명 못 할 수 있다 (크기만 되돌리면 겹침이 아니라 틈) | 옛 경로 전체(안쪽 배치 + 옛 크기)를 심는다. 빈틈·덮개·접촉 검사 추가 |
| 6 | 네스팅 `partId#k` 는 0부터 | 공통 k 순서 함수 하나. 조각마다 다른 행(경첩 방향·엣지 좌우)은 나누거나 조각별 특징 |
| 7 | PR6~PR12 사이 위치 계산이 두 벌 | PR6 부터 명세 AABB = 3D AABB 시험(PR1 의 matrixWorld 도구), 원장 래칫도 PR6 부터 |
| 8 | PR1 픽스처로는 서랍장 처짐방지목 충돌(D2)을 못 찾는다 | 서랍장·다칸·붙박이장·18T 픽스처 추가, drawerBox 특수 처리 |
| 9 | 다칸 모듈 배지가 3D 에 없는 칸별 몸통을 검사 | "BOM 기준" 표시 또는 D1 선결. D1(b) 는 BOM·견적 변경임을 명시 |
| 10 | 줄 단위 부재 기준선이 다르다 (플래너 40 은 상판 앞선 기준, 샘플 50 은 몸통 앞면 기준) | `runs[].frame`·천장 높이를 명세에 |
| 11 | 플래너에 관리자 확인이 없다 (`AdminAccess` 미로딩, 클라이언트 확인은 겉치레) | 부모 창이 역할을 postMessage 로. 게이트(PR0a)·외관 도면(PR0b)을 1주차로 |
| 12 | 소유자 없는 파일 (`workflow-client.js`, 새 파일들) | D11 을 PR2·3 **전에** 승인. 워커 검증 먼저 배포 후 클라이언트 |
| 13 | PR5 의 `${section}-${n}` 은 지운 번호를 재사용 | 품목마다 올라가기만 하는 카운터, 불러온 id 유지 |
| 14 | 되돌리기 수단 없음 | `?asm=0` 로 옛 그리기, 옛 코드 한 릴리스 유지, 검사 끄기, SQL 은 추가만 + drop 스크립트 |
| 15 | 확인 안 된 가정 (검사 50ms, 명세 30~80KB, Worker CPU) | PR7·PR10 완료 기준에 실측. 아파트 한 채 150~300KB |
| 16 | 눈에 보이는 결과가 3주차 | 1주차 성과 4가지 (아래 단계 0) |

### 결정 반영 (사장님 답 — 본문·개정 표보다 우선)

| # | 날짜 | 결정 | 계획에 미치는 것 |
|---|---|---|---|
| D6 (일부) | 2026-10-18 | 상세설계 화면은 **구독 플랜 standard 이상 고객**에게 제공. 관리자는 항상 열림 | PR0a 게이트 기준은 "관리자 + 파트너"가 아니라 "관리자 + 구독 standard 이상". 파트너 접근은 미정 |
| D6 (남음) | — | 파트너의 상세설계 접근, 고객 확인서에 외관 정면도·아이소 포함 여부, 파트너 외관 파일 제공 | 미정 — PR0b 는 이 답을 받은 뒤 |
| D11 | 2026-10-18 | 승인: BOM = `assembly-rules.js` · `bom-assembly.js` · `assembly-check.js` · `tools/cad/**` · `cad-oracle.yml` / 플래너 = `planner-assembly-mesh.js` · `planner-export.js` / 워크플로 = `part-drawing.js` · `module-section.js` · `dxf-writer.js` · `js/detaildesign/workflow-client.js` | CLAUDE.md 도메인 표에 반영. 이 PR 머지 뒤부터 PR2·PR3 시작 가능. `planner-bridge.js` 는 D11 목록에 없어 아직 소유자 없음 |

### 단계 0 (1주차) — 개정판

| PR | 브랜치 | 내용 | 결정 |
|---|---|---|---|
| PR0a | `agent/designui-access-gate` | `detaildesign.html:103` 의 `return;` 제거 또는 역할 게이트 — 관리자 + 구독 standard 이상 고객만 상세설계 (D6 일부 확정, 파트너는 미정) | D6 |
| PR0b | `agent/workflow-confirm-exterior` | 고객 확인서(`customer-confirmation.js`)에 지금 있는 `elevationSvg`/`isoSvg` 외관 도면 | D6 |
| PR1 | `agent/planner-scene-overlap` | 지금 3D 장면 겹침 시험 (시험 전용, 픽스처 추가는 #8) | — |
| PR1b | `agent/planner-glb-approx` | 관리자 전용 "근사" GLB 내보내기 (역할은 postMessage) | D6 |
| — | — | **D11 승인됨 2026-10-18** (CLAUDE.md 도메인 소유 행) — PR2·PR3 시작 전 | D11 |

### 결정 목록 (개정)

D1 다칸 모듈 구조 · D2 서랍장 처짐방지목 위치 · D3 상판 깊이·기준 · D4 걸레받이·몰딩·목찬넬 재단 단위 · D5 사쿠리 홈 깊이·경첩 컵 · D6 공개 범위 · D7 벤더 파일 형식 · D8 검사 오류 강도 · D9 휠라 기준 · D10 18T 사용 · D11 도메인 소유 · **D12 선반 "−15" 가 상수인가 T 인가** (신규). 급함: D6·D11 (1주차), D8·D2·D12 (2주차).

## 본문 (2026-10-19 초안 — 위 개정 사항이 우선)

## 1. 한 줄 결론과 추천 구조

**결론: cadgen·build123d를 사이트에 그대로 올리지 않습니다. 오늘 CAD로 해낸 일을 플래너 안의 JS로 옮깁니다. 그 일은 "규칙으로 모든 판재의 정확한 위치를 계산하고, 서로 부딪히는지 검사하는 것"입니다. build123d는 CI(리눅스)에서 매일 결과를 맞춰 보는 검산기로 씁니다.**

추천 구조는 "규칙 먼저" 안(3안)을 뼈대로 하고, 나머지 두 안에서 좋은 점을 가져왔습니다.

```
규칙 표 하나 (assembly-rules.js)
  → 조립 명세 (bom-assembly.js: 판재마다 partId·위치·따내기·홈·보링)
      ├─ BOM 행          (명세를 partId로 묶은 결과. 골든으로 고정)
      ├─ 플래너 3D       (명세를 그대로 그림. 3D와 BOM 차이 184건 → 0~8건)
      ├─ 겹침·간섭·DFM 검사 (동결 직전 + 플래너 배지 + Jest)
      └─ 산출물          (GLB는 브라우저, 부재 도면은 Worker SVG, STEP은 CI 검산기, DXF는 벤더 형식 확인 후)
```

**오늘 쓴 CAD 도구는 각각 이렇게 쓰입니다**

| 오늘 쓴 것 | 계획에서의 자리 | 이유 |
|---|---|---|
| build123d 스크립트 (`docs/01-plan/cad-beta/cad-prototype/sink_set.py`) | `tools/cad/build_from_spec.py`. 숫자 없이 명세 JSON만 읽어 STEP/GLB를 만들고 정확한 겹침 부피를 잼. GitHub Actions(우분투)에서 실행 | `sink_set.py`에 이미 규칙이 어긋나 있음. `KICK_SETBACK = 50`(sink_set.py:70)인데 플래너는 40(`mockup-structure.html:8018`). `TOP_D = 600`(:62)인데 BOM은 `item.d \|\| 650`(`extractors.js:1399`). 파이썬에 숫자를 두면 규칙 사본이 하나 더 생김 |
| `export_set.py` 쌍별 겹침 검사 | JS `assembly-check.js`. 판재를 상자로 쪼개 교차 부피를 계산하므로 OpenCascade가 필요 없음 | 모든 판재가 직사각형 윤곽에서 따내기를 뺀 모양을 두께만큼 밀어낸 것이라 브라우저에서 수 ms면 끝남 (가정: 싱크 한 세트 50ms 이하) |
| cadgen 모델 러너, CAD Viewer | 사장님 PC 연구용으로만 사용 | 이 PC(Windows)에서는 import 오류로 러너가 돌지 않음. 뷰어는 127.0.0.1에서만 열림. 모델 계약이 "모델은 인자를 받지 않는다"여서 주문마다 스크립트를 새로 써야 함 |
| cadgen DFM | 쓰지 않음. 가구용 DFM은 자체 규칙으로 만듦 | cadgen DFM은 판금·CNC 절삭·사출만 다룸 |
| cadgen 기술도면 PDF | Worker의 SVG A4 도면으로 대신함 (PDF로 인쇄 가능) | 파이썬과 matplotlib이 필요함. 작업지시서는 이미 SVG A4를 인쇄하고 있음 |

---

## 2. 왜 이 구조인가

### 심사 점수 (10점 만점, 높을수록 좋음)

| 기준 | 1안 서버 Python | 2안 브라우저 JS | 3안 규칙 먼저 |
|---|---|---|---|
| 사업 가치 (재단 정확도, 재단 오류 감소, 작업지시서 속도) | 8 | 8 | **9** |
| 현재 스택 적합성 (Pages·Supabase·CF, 사장님 1인 + AI) | 4 | 7 | **9** |
| 비용·운영 부담 (가벼울수록 높음) | 4 | **9** | **9** |
| 위험 (안전할수록 높음) | 5 | 6 | **8** |
| 단계별 납품 | 6 | 7 | 7 → 접목 후 **9** |
| **합계 /50** | **27** | **37** | **42** |

### 각 안의 판정

**3안 "규칙 먼저"를 뼈대로 고른 이유**
- PR #832에서 뒷판 크기 버그를 실제로 찾아낸 것은 "정확한 위치 + 겹침 검사"였습니다. 3안은 바로 이것을 맨 앞에 둡니다.
- 런타임이 새로 생기지 않습니다. JS만 Pages와 Workers에 올라갑니다.
- 3D와 BOM의 차이 목록(`test-utils/ledger-allowlist.json`, 지금 184건)을 늘리지 못하게 하고, 부재를 옮길 때마다 줄여 갑니다.
- 약점: 플래너에서 눈에 보이는 변화가 늦게 나옵니다. 그래서 두 가지를 접목했습니다.
  - 첫 PR에서 지금의 3D 장면부터 바로 충돌을 검사합니다.
  - 3D를 다시 그리기 전에 검사 배지부터 플래너에 붙입니다.

**2안 "브라우저 JS"는 근소한 차이로 2위입니다. 다음을 가져옵니다.**
- 접근 권한 게이트 PR
- 기본값 하나의 표(topT, legH, bodyT)
- 화면용 메시를 `userData.display`로 표시하는 방식
- 부재 순번 k를 정하는 결정적 규칙
- #832 이전 뒷판 공식을 다시 넣어 검사가 실패하는지 보는 회귀 시험
- npm three와 importmap 버전을 맞추는 주의

**2안에서 미룬 것:** 직접 쓰는 STEP 작성기(약 400줄)와 브라우저 DXF·zip입니다. 이 공장에는 STEP을 읽을 CAD/CAM 사용자가 없고, 벤더 형식도 아직 확인되지 않았습니다.

**1안 "서버 Python"은 정밀 STEP과 숨은선 도면이 강점이지만 비용이 큽니다.**
- 새 언어 하나와 새 서비스가 생깁니다: Cloud Run, Workload Identity 배포, 시크릿, Durable Object.
- "머지했는데 라이브가 아닌" 워커 CI 함정이 두 군데로 늘어납니다.
- 그렇게 만드는 산출물(STEP)이 이 공장에서는 가치가 낮습니다.

**1안에서 가져오는 것:**
- `unplaced[]`: 아직 위치를 못 정한 부재를 숨기지 않고 드러냄
- 검사 문턱값을 데이터로 두기 (`checkParams` 개념)
- `vis: exterior/interior` 표시
- 모든 도면에 rev와 `content_hash` 찍기
- CAD가 아직 없으면 인쇄할 때 "CAD 도면 준비 중"으로 넘어가기
- 산출물을 `(content_hash, generator_version)`로 결정적으로 만들기
- `design_cad_artifacts` 테이블과 비공개 `cad` 버킷
- 파이썬 쪽에 숫자 리터럴이 없는지 보는 grep 시험
- Cloud Run 경로는 탈출구로만 문서에 남김

---

## 3. 목표 / 비목표

### 목표
1. **규칙 정본을 하나로 만듭니다.** 지금 같은 숫자가 3~4곳에 있습니다.
   - `MASTER_RULES` (`js/planner/planner-engine.js:25-145`)
   - `BOM_*` 상수 (`extractors.js:183-256`, 함수 안 지역 상수)
   - `DRAWER_RULES` (`bom-drawer-rules.js:71-74`)
   - 플래너 지역 상수 `BODY_T` (`mockup-structure.html:4718`), `KICK_*` (:8017-8019)

   이것을 `assembly-rules.js` 한 표로 모읍니다.
2. **조립 명세(assembly spec) 하나가 모든 판재의 정확한 형상을 정합니다.** BOM, 플래너 3D, 검사, 내보내기가 모두 이 명세에서 나옵니다.
3. **동결 전에 반드시 겹침·간섭·DFM 검사를 거칩니다.** `BomPreflight` 안에서 돌고, 플래너에서는 모듈 배지로 보입니다.
4. **플래너 3D가 실제로 재단되는 판재를 그대로 보여줍니다.** 밴드, 사쿠리 홈, 실제 서랍통, 선반 깊이(BOM 규칙: 하부 D−T · 상부 D−34)가 보이고, 3D와 BOM 차이 목록은 0~8건(결정 사항만)으로 줄어듭니다.
5. **산출물은 동결된 스냅샷에서만 만들고, rev와 해시를 찍습니다.** 재단 기사와 조립 담당은 부재 도면을, 사장님은 GLB를 받습니다.
6. **새 런타임 없이 갑니다.** 추가 비용은 월 0원 수준입니다.

### 비목표
- 플래너에 CAD 편집 모드를 넣지 않습니다. 편집은 지금처럼 배치 → 구조 → 디테일에서만 합니다.
- 운영 경로(Pages, Workers, 브라우저)에서 Python/OpenCascade를 쓰지 않습니다. 동결이나 인쇄가 CAD를 기다리지 않습니다.
- 고객에게 STEP/DXF를 주지 않고, 내부 구조도 보여주지 않습니다.
- 곡면이나 자유 형상은 다루지 않습니다.
- 휴대폰용 CAD 화면은 만들지 않습니다.
- `planner-vite`(레거시), SketchUp 브리지(`mcp-server/src/services/sketchup-*`), cadgen 모델 러너 위에는 아무것도 짓지 않습니다.
- MCP 서버의 규칙 사본은 고치지 않고 폐기 예정 표시만 남깁니다. `mcp-server/src/.../bom-rules.defaults.ts`의 `band_width 60`, `shelf_depth_reduction 20`이 이미 낡아 있습니다.

---

## 4. 전체 구조

### 4-1. 데이터 흐름

```
[배치] mockup-shell.html ──dadam_layout_v1──▶ [구조·디테일] mockup-structure.html (m + s)
                                                   │ buildPlannerPayload (MS:7440)
                                                   ▼
        js/detaildesign/planner-bridge.js   DadamPlannerBridge.convert(payload, specs)
        (ui-step1.js 892–1534 에서 이사: _convertPlannerModules·_carcassHeight·_heightPartsOf·
         _drawerRulesOf·_wardrobeFieldsOf·_plannerPlaceOf / 각 모듈에 src{plannerId,cell} 추가)
                                                   ▼
        js/detaildesign/assembly-rules.js   숫자 정본 한 표 (+ 검사 문턱·기본값)
        js/detaildesign/bom-assembly.js     DadamAssembly.of(item, itemIdx) → 조립 명세 v1
           │                │                       │                         │
           ▼                ▼                       ▼                         ▼
     플래너 3D          extractors.js          assembly-check.js         내보내기
     js/planner/        BOM 행 = 부재를        겹침·간섭·DFM             GLB: 브라우저 GLTFExporter
     planner-assembly-  rowPartId 로 묶은 것   → BomPreflight issues     STEP·정밀 겹침: CI build123d
     mesh.js            (골든 9종으로 고정)    → 플래너 모듈 배지         DXF: 벤더 형식 확정 후
     (userData.partId)
                              │
        workflow-client.js createSnapshot (675–750) → bom_payload.assembly (동결·해시 포함)
                              ▼
        workflow-api: snapshots.js 검증만 (재계산 안 함 — 헤더 10–14 원칙 유지)
        templates/part-drawing.js (?pack=cut), templates/module-section.js (?pack=assembly)
```

**설계 원칙**
- 플래너는 `mockup-structure.html:662-666`에서 규칙 파일들을 직접 불러옵니다. 그래서 iframe 안에서 브리지 → 명세 → 검사를 바로 계산할 수 있습니다. 부모 창을 거칠 필요가 없습니다.
- Worker는 동결된 JSON을 읽고 검증만 합니다. UMD 파일을 Worker로 번들할 필요가 없습니다.
- BOM은 실제로 재단되는 것이므로, 명세는 BOM과 같은 규칙에서 나옵니다. 사장님 결정 전의 다칸 모듈도 BOM 방식(칸마다 별도 통)을 따릅니다.

### 4-2. 조립 명세 스키마 초안 `dadam.assembly/1`

```js
{
  schema: 'dadam.assembly/1',
  rulesVersion: 'asm-2026.10.1',          // assembly-rules.js 의 버전 문자열 (해시에 포함)
  units: 'mm',
  items: [{
    itemIdx: 0, uniqueId: '…', label: '싱크대',
    modules: [{
      moduleKey: '0-planner-lower-3-0',    // = BOM 행 moduleKey (`${itemIdx}-${moduleId}`)
      src: { plannerId: 'lower-3', cell: 0 },  // 브리지가 붙임 (블라인드 코너도, ui-step1.js:1349 개명 대체)
      kind: 'lower',                       // lower|upper|tall|wardrobe|open|blind|fridge
      box: { W: 800, H: 708, D: 550, T: 15 },   // 몸통. T 는 item specs (thicknessFor), 15 고정 아님
      place: { cx, cy, z0, rotDeg },       // 평면 mm. planeBoxOf(MS:1844) 결과 — 회전 각도 제한 없음
      parts: [ Part, … ],
      hardware: [{ kind: 'leg'|'hinge'|'rail', at: [x, y, z], spec: 'H052W-5' }]
    }],
    runs: [{ runKey: '0-area-lower-0', kind: 'kick'|'molding'|'channel'|'top', parts: [ Part ] }]
  }],
  unplaced: [{ rowPartId, qty, reason }]   // 아직 위치를 못 정한 BOM 행 — 조용히 빠지지 않는다
}

Part = {
  id:        '0-planner-lower-3-0-body:side-0#1',  // `${rowPartId}#${k}` — 네스팅 조각·라벨 QR 과 같은 키
  rowPartId: '0-planner-lower-3-0-body:side-0',    // = extractors partId (bom-protocol.md §7-1)
  family: 'side', key3d: 'body:right', slot: 'body',
  part: '측판', material: 'PB', t: 15, finishCode: '',
  cut:   { w: 550, h: 708 },                       // BOM 행 w,h 와 반드시 같음
  frame: { o: [385, 150, -275], u: '+z', v: '+y', n: '+x' },
         // 모듈 로컬. o = 재단면 (u=0,v=0,n=0) 꼭짓점. u,v,n 은 부호 있는 축 순열 (회전 없음)
  outline: null,                                   // null = 직사각형, 아니면 직교 다각형 [[u,v],…] 반시계
  features: [
    { type: 'notch',  u0: 510, u1: 550, v0: 638, v1: 708, src: 'channel-top' }, // 70×40 관통 (하부장 앞 위)
    { type: 'notch',  u0: 510, u1: 550, v0: 380, v1: 470, src: 'channel-mid' }, // 90×40, v 는 layout.channels[].y
    // 상부장 측판 예: { type:'groove', face:'-n', u0:15, u1:18, v0:0, v1:H, depth: SAKURI_DEPTH, src:'sakuri' }
    // 도어 예:       { type:'bore', face:'-n', u: <backset>, v: 110, d: 35, depth: <cup>, src:'hinge-cup' }
  ],
  edges: { L: true, R: false, T: true, B: true }, edgeT: 0.6,   // BOM 행 규약 그대로
  vis: 'interior',                                 // exterior | interior (고객용 GLB 거름망)
  tags: { cell: 0, shelfIdx: null, drawerIdx: null, mid: null }
}
```

**좌표계**
- **모듈 로컬 좌표** = `createModuleMesh`(MS:9398) 그룹 좌표 그대로입니다. 단위 mm, 원점은 모듈 바닥 가운데, x는 오른쪽, y는 위, +z는 앞(몸통 앞면 z = D/2)입니다. 가장 자주 쓰는 소비자(플래너)는 변환이 전혀 필요 없습니다.
- **월드 배치**는 `renderAll3D`(MS:9222)와 같습니다. 위치 `(cx − origin.x, z0, cy − origin.y)`, `rotation.y = −rotDeg`입니다. `_plannerPlaceOf`는 직각이 아니면 null을 내므로 쓰지 않고, `planeBoxOf` 결과를 직접 저장합니다.
- **내보내기 변환은 산출물마다 한 번씩만** 합니다.
  - GLB: 루트에 0.001 배율
  - build123d·STEP·DXF(Z-up): `(X, Y, Z) = (x, −z, y)`
  - 작업지시서 아이소메트릭: 지금처럼 `place`/`_place`로 평면 좌표

**partId 연결**
- `rowPartId`는 지금 BOM partId(`${itemIdx}-${moduleId}-${partKey}-${n}`)와 같고, 바뀌지 않습니다.
- `id = rowPartId#k`는 이미 쓰는 규약입니다(네스팅 `cutPlan.parts[].partId#k`, 라벨, bom-protocol §7-4).
- 그래서 한 판재가 어디서나 같은 이름을 씁니다: 재단 조각, 라벨 QR, 3D 메시(`userData.partId`), GLB 노드 이름, STEP 솔리드 라벨, DXF 파일 이름.
- **k 순서는 결정적입니다:** 왼→오, 아래→위, 앞→뒤. k 는 네스팅과 같이 **0부터**입니다. 예를 들어 측판 qty 2는 `#0`이 왼쪽, `#1`이 오른쪽이고, 합쳐진 서랍 전면은 y 순입니다.
- 이렇게 하면 지금의 키 충돌이 사라집니다.
  - 서랍 전면이 전부 `drawer#b0`이 되는 문제 (`addFrontPanel` MS:8807에서 `drawerIdx`를 버림)
  - 중간 목찬넬과 위 목찬넬이 `channel:channelFace`를 같이 쓰는 문제
  - 붙박이장 패널이 전부 `body:panel`이 되는 문제
  - `drawerBox`·`openCabinet`·`wardrobe*`에 키가 아예 없는 문제
- `key3d`는 디테일 칠하기(`planner-finish.js:337`)에만 남깁니다.

**불변식 (시험으로 고정)**
- `groupBy(parts, rowPartId)`를 하면 BOM 행마다 `{w, h, t, qty}`가 정확히 같아야 합니다.
- 아직 못 옮긴 행은 `unplaced[]`에 넣습니다.
- 같은 입력이면 `JSON.stringify`가 같아야 합니다.

**가공 특징의 출처 (규칙을 새로 만들지 않고 이미 있는 데서 가져옴)**

| 특징 | 출처 |
|---|---|
| 목찬넬 위 따내기 70×40 | `notchesOf` (MS:8194), `CHANNEL_NOTCH_*` |
| 중간 따내기 90×40 | `bom-drawer-rules.js:263`의 `layout.channels[].y`. 지금 BOM은 이 값을 버리고 비고 글만 남김 |
| 사쿠리 홈 | 뒤에서 15, 폭 3(`BACK_PANEL_T`). 깊이는 상부 뒷판 폭이 W−20이고 안쪽 폭이 W−30이므로 한쪽에 5mm씩 들어감 → **5 이상이어야 함. 정확한 값은 사장님 확인 필요** |
| 경첩 컵 | 철물 행의 `boring[]`과 `boringSide` (`extractors.js:2371-2382`). 컵 지름 35. 백셋과 깊이는 미정 (결정 D5) |
| 엣지 | BOM의 L/R/T/B를 그대로 쓰고, 재단면 u/v 변으로 옮기는 **계열별 대응표**를 둠 (예: 측판 L = 앞 = u1) |

**사장님이 확인해 준 조립 사실을 그대로 명세에 넣습니다**
- 처짐방지목은 측판 앞선과 같은 면, 도어 뒤에 둡니다.
- 앞 밴드는 목찬넬 L 받침 아래에 놓입니다.
- 선반 깊이는 BOM 그대로입니다: 하부 = 측판 깊이 − T (15T면 −15), 상부 = D − 34 (사쿠리). "−15 가 상수인지 T 인지"는 결정 D12.
- 하부 뒷판은 측판 뒤에 붙이고 크기는 (W−1)×(H−1)입니다 (`bomBackPanelSize`, `extractors.js:255`).

---

## 5. 산출물별 계획

| 산출물 | 무엇 | 어디서 만드나 | 누가, 어디서 보나 | 단계 |
|---|---|---|---|---|
| **겹침·간섭 검사** | 판재를 상자로 쪼갠 뒤 AABB 쓸기와 정확한 교차 부피를 계산. 면 접촉(부피 0)은 허용. 오류 기준은 부피 > 1mm³ **이고** 파고든 깊이 > 0.1mm. 회전된 런은 모듈 로컬 좌표에서 검사하고, 모듈 사이는 같은 회전끼리만 검사 | `js/detaildesign/assembly-check.js` (브라우저), Jest CI | 사장님. 동결 확인창(`workflow-client.js:700-728`), 플래너 구조 단계 배지 | 2~3 |
| **간섭 여유 표** (코드가 아니라 데이터) | 처짐방지목↔서랍통 ≥ 미정(그때까지 `warn`), 서랍통↔측판 = 레일 여유(`bom-drawer-rules.js` 정본), 뒷판이 홈 안에 있음, 앞 밴드가 L 받침 아래에서 접촉, 선반 = BOM 규칙(하부 D−T · 상부 D−34, 개정 #3), 처짐방지목이 앞선과 같은 면 | `assembly-rules.js` 안의 `checkParams` | 사장님 | 2 |
| **가구 DFM** | 따내기 뒤 남는 살 최소값, 홈 깊이 < T/2, 컵 보링이 판 끝에서 떨어진 거리, 최소 전면 50, 도어 폭 ≤ 600(`DOOR_W_MAX`) | 같은 파일. 코드 `dfm-*` | 사장님 | 2 |
| **플래너 검사 배지, 부재 카드** | 모듈마다 정상/경고/오류 배지. 목록을 누르면 `src.plannerId`로 그 모듈을 선택. 3D에서 판재를 누르면 partId, 재단 치수, 가공 목록을 보여줌 | `mockup-structure.html` 구조 단계, 관리자만 | 사장님 | 3 (카드는 4) |
| **3D 뷰어 정합** | `createModuleMesh`가 명세의 판재를 그대로 그림: 밴드 2장, 홈, 실제 서랍통 5판, 줄 단위 부재. 보기 좋게 넣은 오프셋(−4mm 등)은 형상에서 빼고 재질 설정(`polygonOffset`)으로 옮김 | `js/planner/planner-assembly-mesh.js` | 사장님, 파트너 | 4 |
| **GLB** | 노드 이름 = partId, extras = {part, material, t, finishCode, moduleKey}. 화면용 메시는 자동으로 빠짐(partId가 없으므로) | 브라우저 `GLTFExporter` (importmap `three@0.183.0`, MS:622-626), 메뉴 `pdm-wrap`(MS:364-378) "CAD 내보내기", 관리자만 | 내부용 전체: 사장님. 외관만(`vis:'exterior'`, 1MB 이하): 나중에 고객·파트너 (결정 D6) | 5 |
| **STEP** | 명세 JSON을 build123d로 지어 STEP을 만들고 정확한 `overlap_volume`을 잼 | GitHub Actions `cad-oracle.yml` 산출물. 필요할 때만 `repository_dispatch`로 `cad` 버킷에 올림 | 사장님 연구용. 파트너 외관 STEP은 결정 후 | 2(CI) / 6 |
| **치수 부재 도면** (PDF 대체) | 판재별 SVG(따내기, 홈, 보링 치수)와 모듈 단면(뒷판, 처짐방지목, 밴드, 따내기). 지금의 상자만 그리는 `moduleDrawingSvg`(`elevation.js:335`)를 보강 | `workers/workflow-api/src/templates/part-drawing.js`, `module-section.js`. 동결된 `bom_payload.assembly`를 읽음. A4로 인쇄하면 PDF | 재단 기사(`?pack=cut`), 조립 담당(`?pack=assembly`) | 5 |
| **부재별 DXF** | 도어(컵 보링 35), 상판(싱크·쿡탑 타공), 외주 재단 부재. R2007 UTF-8, 레이어 OUTLINE/NOTCH/GROOVE/BORE | `workers/workflow-api/src/cad/dxf-writer.js` | 벤더(상일, 상판 업체, 일성합판). **형식이 확인된 벤더에게만** | 6 |
| **기술도면 PDF (cadgen)** | 만들지 않음 | — | — | — |

**역할별로 보는 것**

| 역할 | 보는 것 |
|---|---|
| 사장님 | 전부 |
| 재단 기사 | 재단 묶음의 판재 도면 |
| 조립 담당 | 모듈 단면 |
| 벤더 | 자기 부재 파일만 (지금처럼 고객명·가격 없음) |
| 파트너 | 외관만 |
| 고객 | 외관 도면과 외관 3D (결정 후). 뒷판·처짐방지목·따내기·밴드·partId·보링은 절대 보여주지 않음 |

---

## 6. 단계별 PR 계획

공통 규칙 (CLAUDE.md와 메모리 기준):
- 클라우드 스레드는 자기 클론에서 일합니다 (워크트리 금지 — jest 가 `.claude/worktrees/` 를 제외하지 않음). 로컬 스레드는 Worktree 옵션 + `npm ci`, node_modules 정션은 쓰지 않습니다.
- 시작 전에 `git status`로 남의 미커밋 작업이 섞이지 않았는지 봅니다.
- 순서는 Engineer → Designer 리뷰 → QA입니다.
- CI가 통과하면 머지합니다. 워커 PR은 배포 런까지 확인합니다.
- 같은 도메인 안에서는 차례대로만 진행합니다. 도메인이 다르면 동시에 해도 됩니다.
- 새 시험은 고치기 전 코드에서 먼저 실패하는지 확인합니다.

### 단계 0: 지금 3D 장면의 충돌 목록 (1~2일)

**PR1 `agent/planner-scene-overlap`** (시험 전용, 운영 코드는 건드리지 않음)
- **파일:**
  - `test-utils/scene-parts.js`: `collectSceneParts`(:141)에 `matrixWorld`, 모듈 로컬 AABB, `makeNotchedPanel` 윤곽(ExtrudeGeometry의 shape 점)을 추가
  - 새 파일 `test-utils/box-overlap.js`: 직교 윤곽을 상자로 쪼개기, AABB 쓸기, 교차 부피
  - 새 파일 `__tests__/scene-overlap.test.js`
  - 새 파일 `test-utils/overlap-allowlist.json`
- **내용:** `bootPlanner3D`(:81)로 `planner-golden.js`의 FIXTURES(straight, lShape, oblique)에 **서랍장·다칸·붙박이장·18T 픽스처를 더해**(개정 #8, drawerBox 는 외피라 특수 처리) 띄웁니다. 각 모듈 그룹 안에서 실제 부재끼리 겹치는지 검사합니다. 화면용 메시는 기존 SKIP 목록으로 뺍니다.
- **완료 기준:**
  - 합성 쌍 시험이 통과합니다 (겹침, 면 접촉, 따내기 안쪽).
  - 찾은 겹침은 모두 고치거나 이유를 달아 allowlist에 넣습니다. 서랍장 처짐방지목↔서랍은 `pending-owner`입니다.
  - 결과 목록을 사장님께 보고합니다.
- **가치:** 첫날부터 "지금 플래너가 어디서 부딪히는지"가 숫자로 나옵니다. 여기서 만든 알고리즘은 PR7에서 운영 코드로 옮겨집니다.

### 단계 1: 규칙과 입력을 한 곳으로 (3~5일)

**PR2 `agent/designui-bridge-extract`**
- **파일:**
  - `js/detaildesign/ui-step1.js`: 892–1534(`PLANNER_CABINET_SECTIONS` 부터)에 있는 순수 함수 6개를 내보냄
  - 새 파일 `js/detaildesign/planner-bridge.js` (`window.DadamPlannerBridge` + CommonJS)
  - `test-utils/bom-parts.js`: `loadConverter`(33–41)가 문자열 자르기 대신 `require`를 쓰고, `src`가 생기므로 `bomModuleMapOf`(71–89)를 삭제
- **내용:**
  - 모든 출력 모듈에 `src:{plannerId, cell}`을 붙입니다.
  - 부모 창이 iframe에 `item.specs`를 보내는 메시지를 추가합니다 (topThickness 12 vs 50처럼 기본값이 갈리는 문제를 PR4에서 해소하기 위한 준비).
- **완료 기준:**
  - `test-utils/bom-golden/` 9종(sink15, sink18, sinkCorner, fridge, wardrobe, storage, vanity, shoerack, warehouse)이 한 글자도 달라지지 않습니다.
  - 원장(ledger) 시험이 그대로 통과합니다.
  - 스냅샷 해시가 한 번 새 rev를 만든다는 점을 공지합니다 (`src`가 해시에 들어가기 때문).

**PR3 `agent/bom-assembly-rules`** (PR2와 동시에 진행 가능)
- **파일:**
  - 새 파일 `js/detaildesign/assembly-rules.js` (UMD, DOM 없음, `detaildesign.html`에서 `extractors.js`보다 먼저 불러옴)
  - `extractors.js`: 183–256의 상수와 1154·1376 등의 리터럴을 이 표에서 읽음
  - `bom-drawer-rules.js`: 71–74를 이 표의 별칭으로
- **내용:**
  - `DEFAULTS` 표: topT, legH, bodyT, kickSetback 40
  - `checkParams`
  - `rulesVersion`
  - 같은 src 는 같은 `?v=` 인지 보는 시험, PLANNER_DONE 의 `rulesVersion` 확인. 공유 규칙을 고친 BOM PR 은 `mockup-structure.html` 의 `?v=` 도 올린다 (공동 소유, 개정 #4)
- **완료 기준:**
  - 골든이 같습니다.
  - `__tests__/assembly-rules.test.js`가 같은 숫자 리터럴이 두 곳에 남아 있지 않은지 검사합니다 (`planner-area-bounds.test.js:189`의 정규식 시험을 대체).

**PR4 `agent/planner-assembly-rules`**
- **파일:**
  - `js/planner/planner-engine.js`: `MASTER_RULES`(25–145)의 키를 표의 별칭으로
  - `mockup-structure.html`: `BODY_T`(4718)와 `KICK_*`(8017–8019) 제거, 662–666 옆에 `assembly-rules.js` 불러오기
- **내용:** 몸통 두께를 item specs에서 받습니다.
- **완료 기준:**
  - 15T에서는 플래너 골든 I1이 그대로입니다.
  - 18T 픽스처에서는 측판이 18T로 그려집니다.

**PR5 `agent/bom-stable-module-ids`**
- **파일:** `js/detaildesign/calc-engine.js:518`
- **내용:** `Date.now()+Math.random()` 대신 품목마다 **올라가기만 하는 카운터**로 결정적 id 를 씁니다. 불러온 설계의 id 는 유지합니다 (개정 #13 — `${section}-${n}` 은 지운 번호를 재사용함).
- **완료 기준:** 자동계산을 다시 해도 partId가 그대로라 rev 비교가 흔들리지 않습니다.

### 단계 2: 조립 명세 + 검사 + 검산기 (BOM 도메인, 5~8일)

**PR6 `agent/bom-assembly-shell`**
- **파일:**
  - 새 파일 `js/detaildesign/bom-assembly.js` (`DadamAssembly.of`)
  - `test-utils/assembly-golden/*.json`
  - `docs/design-rules/assembly-spec.md`
- **내용:** 1칸 모듈의 몸통 계열을 옮깁니다.
  - 측판, 지판
  - 하부·키큰·블라인드 코너의 밴드 2장(천판 대신), 상부 밴드
  - 뒷판 (상부는 홈 포함)
  - 선반 (하부 D−T · 상부 D−34 — BOM 그대로, 골든 불변)
  - 처짐방지목 (상부 700 / 하부 800 이상 모듈에만 1장, 모듈 중앙)

  나머지는 `unplaced`에 넣습니다.
- **완료 기준:**
  - 옮긴 계열에서 행↔부재 불변식이 맞습니다.
  - 결정적입니다.
  - `frame`이 부호 있는 순열입니다.
  - 윤곽이 닫힙니다.
  - 옮긴 계열마다 명세 AABB = 3D 장면 AABB (PR1 의 matrixWorld 도구), 원장 래칫을 여기서 시작합니다 (개정 #7).

**PR7 `agent/bom-assembly-check`**
- **파일:**
  - 새 파일 `js/detaildesign/assembly-check.js` (PR1의 `box-overlap.js`를 옮김)
  - `bom-preflight.js`: `check(materials, hardware, {cutPlan, assembly})`(:115)
  - `test-utils/assembly-allowlist.json` (사장님 미결 질문만, `warn` 수준)
- **내용:** 검사 코드는 `part-overlap`(error), `clearance`(warning), `assembly-unplaced`(warning), `dfm-*`입니다. 출력 모양은 기존 `{code, level, message, partId, moduleKey}`에 `other`와 `volumeMm3`를 더한 것입니다.
- **완료 기준:**
  1. #832 이전 경로 **전체**(측판 사이 배치 + 옛 크기 `(W−2T)×(H−T)`)를 심으면 검사가 실패합니다. 크기만 되돌리면 겹침이 아니라 틈이 생기므로 **빈틈·덮개·접촉 검사**도 함께 둡니다 (개정 #5). 고치기 전 코드로 실패를 먼저 확인합니다.
  2. 골든 9종과 플래너 FIXTURES에서 error가 0입니다.
  3. 싱크 한 세트에 50ms 이하입니다 (가정).

**PR8 `agent/bom-cad-oracle`** (처음엔 보고만 함)
- **파일:**
  - `tools/cad/dump-assembly.js` (Node)
  - `tools/cad/build_from_spec.py` (일반 build123d, ASCII 소스, 한글은 `chr()`)
  - `.github/workflows/cad-oracle.yml` (ubuntu, uv, `build123d==0.11.1`, `cadquery-ocp-novtk==7.9.3.1.1`, 경로 필터 + 야간)
- **완료 기준:**
  - OCC가 찾은 겹침 쌍 집합이 JS 검사기와 같습니다.
  - 솔리드 수가 부재 수와 같습니다.
  - 부피가 Σw·h·t에서 특징을 뺀 값과 ±0.1% 안에서 맞습니다.
  - STEP과 GLB를 Actions 산출물로 올립니다 (**합성 골든만** — 저장소가 공개).
  - 파이썬 파일에 도메인 숫자 리터럴이 없는지 grep 시험을 합니다.
  - 2주 동안 계속 초록이면 게이트로 올립니다.
  - `docs/01-plan/cad-beta/cad-prototype/` 은 이 PR로 은퇴합니다.

**PR9 `agent/bom-assembly-features`**
- **내용:** 다음을 명세에 넣습니다.
  - 목찬넬 L 부재와 위·중간 따내기 (`layout.channels[].y`)
  - 도어와 서랍 전면 (`#k`, 경첩 보링)
  - 서랍통 (`drawerBoxDims`)
  - 붙박이장 (`layoutWardrobeModule`), 오픈장 (`innerOf`/`partsOf`)
  - 줄 단위 부재 (`runs[]`)
  - 다리와 경첩 (`hardware[]`)
- **완료 기준:** 골든 9종에서 `unplaced`가 비어 있습니다 (결정 대기 항목은 문서화).

### 단계 3: 동결에 연결 + 플래너에 처음 보이기 (2~4일)

**PR10 `agent/workflow-assembly-freeze`** (개정 #12: 워커 `validateAssembly` 를 먼저 머지·배포하고, 클라이언트 `createSnapshot` 연결은 다음 PR 로)
- **파일:**
  - `js/detaildesign/workflow-client.js` `createSnapshot`(675–750): 명세를 만들고 preflight에 넘기고 `bom.assembly`를 보냄
  - `workers/workflow-api/src/snapshots.js`: `validateSnapshotInput`(85–129) 옆에 `validateAssembly` 추가
- **검증 내용:** rowPartId가 materials partId 안에 있어야 하고, 행마다 조각 수 = qty이며, 크기 상한이 있습니다.
- **완료 기준:**
  - `assembly`가 없는 옛 클라이언트도 받아줍니다.
  - 바뀌지 않은 설계를 다시 동결하면 같은 rev를 씁니다.
  - 워커 시험이 통과하고 **배포 런이 초록**입니다.

**PR11 `agent/planner-cad-check-badge`**
- **파일:** `mockup-structure.html`
- **내용:**
  - 브리지, 규칙, 명세, 검사 스크립트를 불러옵니다.
  - 구조가 바뀌면 (디바운스 후) `buildPlannerPayload('PLANNER_STATE')` → 브리지 → 명세 → 검사를 돌립니다.
  - 모듈 목록(397–411)에 배지를 붙이고, 겹침 목록을 누르면 그 모듈을 선택합니다.
  - 관리자만 볼 수 있습니다. `mockup-structure.html` 은 `AdminAccess` 를 싣지 않으므로 부모 창(`detaildesign.html`)이 역할을 postMessage 로 넘깁니다 (개정 #11).
  - 3D 그리기는 아직 바꾸지 않습니다.
- **완료 기준:**
  - 수동 확인: sink15에서 배지가 모두 정상입니다.
  - 옛 뒷판 규칙을 심으면 겹침이 뜨고 모듈이 선택됩니다.

### 단계 4: 플래너 3D를 명세로 그리기 (8~12일)

**PR12 `agent/planner-assembly-shell`**
- **파일:**
  - 새 파일 `js/planner/planner-assembly-mesh.js` (`meshOfPart`: 윤곽을 밀어내고, 홈을 그림. `makeNotchedPanel` MS:8159를 일반화)
  - `addCarcassShell`(8205), `addBraces`(8277), 선반 루프(9469)를 명세 기반으로 교체
- **내용:**
  - 메시에 `userData.{partId, rowPartId, key3d}`를 붙이고, 화면용 메시에는 `display:true`를 붙입니다.
  - 부재 카드를 추가합니다.
  - 모듈별로 구조 해시를 키로 캐시합니다.
- **완료 기준:**
  - 원장 **−84건** (천판↔밴드 46, 선반 30, 밴드 미표현 8). 184 → 100.
  - 메시 AABB가 부재 AABB와 ±0.01mm 안에서 맞습니다.
  - 정면·iso 캡처를 비교합니다.
  - 다칸 모듈은 결정 D1 전까지 지금 방식을 유지합니다.

**PR13 `agent/planner-assembly-channel-fronts`**
- **내용:** 다음을 명세로 그립니다.
  - 목찬넬 (`addWoodChannel` 8307, `addMidChannels` 8389)
  - 앞판 (`addFrontPanel` 8765, 블라인드 덮개 포함)
  - 실제 서랍통 5판 (`addDrawerBoxes` 8564를 대체)
- **완료 기준:**
  - 서랍 전면마다 id가 하나씩 다릅니다.
  - `collectSceneParts`가 `userData.partId`를 읽습니다.

**PR14 `agent/planner-assembly-runs-wardrobe`** (결정 D4·D5 후)
- **내용:**
  - 걸레받이, 몰딩, 좌대, 상판, 휠라를 명세로 그립니다.
  - 붙박이장은 몸통 안쪽의 15T 뒷판을 BOM처럼 3T로 바꿉니다 (`addWardrobeCarcasses` 8426).
  - 오픈장 (`buildOpenCabinetMesh` 9362).
- **완료 기준:** 원장 −92건 (87 + 4 + 1). 남는 것은 결정 D9에 따른 스펙 마감재 8건 이하입니다.

**PR15 `agent/bom-ledger-partid`**
- **파일:** `test-utils/ledger-diff.js`
- **내용:**
  - 크기 다중집합 대신 `id`로 맞추고, AABB는 ±0.5mm 안이어야 합니다.
  - 래칫을 둡니다: `test-utils/ledger-baseline.json`의 개수보다 늘어나면 실패합니다.
  - `docs/02-design/features/scene-bom-ledger.md` §3/§5를 다시 씁니다 (§3 #3은 이미 낡음).
- **완료 기준:** 다칸, 서랍, 붙박이장 픽스처가 원장에 들어옵니다.

### 단계 5: 산출물 (5~8일)

**PR16 `agent/planner-glb-export`**
- **파일:**
  - 새 파일 `js/planner/planner-export.js`
  - 메뉴 `pdm-wrap`(MS:364–378)
  - 새 파일 `database/design-cad-artifacts.sql`
- **내용:**
  - `design_cad_artifacts(design_id, snapshot_id, content_hash, kind, path, bytes, sha256, generator_version, rules_version, …)` 테이블
  - 비공개 버킷 `cad`. **renders 정책을 복사하지 않습니다** (고객이 올리고 지울 수 있음). 쓰기는 서비스 역할·관리자만, 읽기는 관리자와 Worker 서명 URL, 고객용은 `exterior/` 접두사. `design_cad_artifacts` 에도 RLS. 브라우저가 올린 GLB 는 `bom_payload.assembly` 해시가 맞아야 동결본으로 인정
- **완료 기준:**
  - jsdom에서 내보낸 노드 수가 명세 부재 수와 같습니다.
  - 화면용 메시가 0개입니다.
  - 배율이 0.001입니다.
  - 외관 거름망(`vis:'exterior'`) 결과가 1MB 이하입니다.

**PR17 `agent/workflow-part-drawings`**
- **파일:**
  - 새 파일 `templates/part-drawing.js`, `templates/module-section.js`
  - `work-order.js` `PACK_SECTIONS`(1285–)
  - `work-order-data.js` `gatherWorkOrderPayload`(377)에서 `render_payload.cad`를 동결
- **완료 기준:**
  - 명세가 없는 옛 스냅샷은 지금 페이지로 넘어갑니다.
  - 도면마다 rev와 `content_hash`가 찍힙니다.
  - 묶음 HTML 골든이 통과합니다.
  - 배포 런을 확인합니다.

### 단계 6: 결정에 따라 진행 (결정마다 2~4일)

| PR | 브랜치 | 조건 | 내용 |
|---|---|---|---|
| PR18 | (단계 0 PR0a 로 이동) | D6 | 상세설계 게이트는 1주차 PR0a `agent/designui-access-gate` |
| PR19 | `agent/workflow-dxf` | D7 | 벤더 형식이 확인된 묶음만 DXF와 QR |
| PR20 | (단계 0 PR0b 로 이동) | D6 | 확인서 외관 도면은 1주차 PR0b `agent/workflow-confirm-exterior`. 고객용 외관 GLB 는 PR16 뒤 별도 |
| PR21 | `agent/bom-cad-step-private` | 수요 생기면 | 실제 주문 STEP 은 **비공개 런타임**(사장님 PC 대기열 또는 Cloud Run)에서만. 저장소가 공개라 Actions 로그·산출물은 누구나 봄 — 주문 데이터를 Actions 에 넣지 않음 |

**도메인 소유 추가 (CLAUDE.md 표, 사장님 승인 후):**
- BOM 도메인(`agent/bom-*`): `assembly-rules.js`, `bom-assembly.js`, `assembly-check.js`, `tools/cad/**`
- Planner 도메인: `planner-assembly-mesh.js`, `planner-export.js`
- Workflow 도메인: `part-drawing.js`, `module-section.js`, `dxf-writer.js`

**의존 순서:**
```
PR0a·PR0b (D6) ∥ PR1 ∥ PR1b (D6)
D11 승인 → PR2 ∥ PR3
PR3 → PR4, PR5
PR2·PR3 → PR6 → PR7 → PR8 → PR9
PR7 → PR10 · PR11
PR9·PR11 → PR12 → PR13 → PR14 → PR15
PR10·PR12 → PR16
PR10·PR9 → PR17
```

---

## 7. 인프라와 비용

| 항목 | 월 비용 | 근거·가정 |
|---|---|---|
| 런타임 (Pages 정적 JS, 약 60KB 추가, Workers 검증·SVG) | **0원 추가** | 새 서버 없음 |
| `bom_payload.assembly` JSON (싱크 한 세트 약 45KB, 아파트 한 채 150~300KB — 개정 #15, Worker CPU 실측 필요) | 0원 | 가정. 추가 마이그레이션 없음 |
| Supabase Storage `cad` 버킷 (GLB 약 0.7MB × 주문 5~7건) | 사실상 0원 | 측정값은 build123d 샘플 GLB 722KB. 기존 한도 안이라고 가정 |
| GitHub Actions 검산기 (약 3분 × (경로 필터 PR + 야간 30회) ≈ 100~150분) | 0원 | 가정: 공개 저장소면 무료, 비공개면 무료 한도(2,000분) 안 |
| 탈출구: Cloud Run Python 서비스 (1안) | 쓰면 월 $2 미만 | 1안의 추정. 외부에서 STEP을 수시로 원할 때만 |
| 사람 시간 | 결정 회의 약 2시간 + PR 리뷰 | — |

**운영 메모**
- 사장님 PC에서 cadgen을 계속 쓴다면 `uvx cadgen telemetry off`를 권장합니다 (고객 설계가 있는 PC이므로).
- cadgen의 Windows import 오류는 상류(upstream)에 이슈로 올릴 만합니다. 이 계획에는 영향이 없습니다 (검산기는 리눅스에서 돌기 때문).

---

## 8. 위험과 대응

| 위험 | 대응 |
|---|---|
| 옮기는 동안 규칙이 두 길로 갈라짐 | 계열 하나씩 옮기고, 골든 9종은 바이트 단위로 같아야 함. 행↔부재 불변식 시험. 규칙 표 중복 리터럴 시험 |
| 파이썬에 규칙 사본이 다시 생김 (`sink_set.py`가 이미 어긋남) | 검산기는 JSON만 읽음. 숫자 리터럴 grep 시험. `cad-prototype/` 은 은퇴 |
| 3D·BOM·CAD가 서로 달라 신뢰를 잃음 | 하나의 명세에서 모두 나옴. 원장 래칫은 줄어들기만 함. 산출물은 동결본에서만 만들고 rev와 해시를 찍음 |
| 스냅샷 해시가 바뀌어 rev가 새로 생김 (`src`, `assembly`, `rulesVersion`) | 한 번만 생기도록 PR2와 PR10 때 공지. PR5로 partId가 흔들리는 것을 막음 |
| 다칸 모듈의 실제 판재가 다름 (BOM = 칸마다 통, 3D = 칸막이) | 결정 D1 전까지 명세는 BOM을 따르고, 3D는 1칸 모듈만 옮김 |
| 플래너 화면이 퇴행함 | 플래너 골든 I1, 정면·iso 캡처 비교, 보기용 오프셋은 재질 설정으로 |
| 성능 (`renderAll3D`가 매번 전부 다시 지음) | 명세를 모듈 구조 해시로 캐시. 검사는 디바운스 |
| 미결 질문 때문에 동결이 막힘 | 미결 항목은 `warn` 수준 allowlist에 두어 보이되 막지 않음 |
| 머지했는데 라이브가 아님 (워커 CI 함정) | 워커 PR은 배포 런과 `/health`까지 확인 |
| 내부 구조가 고객에게 새어 나감 (지금도 Step 3가 열려 있음, `detaildesign.html:103`) | CAD 산출물은 관리자 전용. `vis` 거름망. 고객 쪽은 PR0a 게이트 이후 |
| 같은 작업 폴더를 세션들이 같이 씀, 단일 세션 파일 (`ui-step1.js`, MS) | PR마다 워크트리 + `npm ci`. `ui-step1.js`는 PR2 한 번에만 손댐. 같은 도메인은 순차 |
| npm three(0.186)와 importmap(0.183) 버전 차이 | 시험 devDependency를 0.183.0으로 고정 |
| 직각이 아닌 회전 (`_place`가 null을 냄) | `planeBoxOf` 결과를 직접 저장. 모듈 사이 검사는 같은 회전끼리만 하고, 나머지는 OBB 경고 |
| 범위가 커짐 (21개 PR) | 단계마다 그 자체로 쓸 만한 결과가 나옴. 단계 3이 끝나면 멈춰도 가치가 남음 |

---

## 9. 사장님이 정해야 할 것

| # | 질문 | 선택지 | 추천 |
|---|---|---|---|
| D1 | 칸이 여럿인 모듈은 실제로 어떻게 짜나요? | (a) 칸마다 별도 통 (지금 BOM) / (b) 한 통 + 칸막이 (지금 3D) | 공장에서 실제로 하는 쪽. 확인 전까지 명세는 (a). **PR12 전에 필요** |
| D2 | 서랍장의 처짐방지목은 어디에 두나요? (앞에 두면 서랍과 부딪힘) | (a) 뒤로 물림 / (b) 맨 위 목찬넬이 대신하므로 생략 / (c) 다른 위치 + 서랍과의 최소 여유 | 정하실 때까지 `warn`으로만 표시 |
| D3 | 상판 깊이와 기준은? | 600 / 650, 그리고 배치 영역 깊이 기준인지 `item.d`인지 | 배치 영역을 정본으로 하고 기본값은 하나. 값은 사장님이 결정 |
| D4 | 걸레받이·몰딩·목찬넬은 어떻게 재단하나요? | 줄 단위 (원판 길이에서 이음) / 품목 단위 | 실제 재단 방식. 원장 87건이 이 결정에 걸려 있음 |
| D5 | 세부 치수 | 선반 폭 W−2T인지 W−2T−4인지. 사쿠리 홈 깊이 (계산상 5 이상). 경첩 컵 백셋·깊이 | 선반 W−2T(BOM과 같게), 홈 깊이와 컵 값은 실측으로 확인 |
| D6 | 공개 범위 | 상세설계 게이트를 다시 잠글지. 고객 확인서에 외관 도면·3D를 넣을지. 파트너에게 외관 STEP·DXF를 줄지 | 게이트는 다시 잠금(관리자 + 파트너). 고객은 외관 도면부터, 3D는 나중. 파트너는 승인 뒤 외관만 **→ 일부 확정 2026-10-18: 상세설계는 관리자 + 구독 standard 이상 고객. 나머지 미정** |
| D7 | 벤더 파일 형식 | 일성합판 CSV/DXF? 상일 도어 DXF + 보링? 상판 업체 DXF? | 형식을 확인한 업체에만 PR19 |
| D8 | 검사 오류의 강도 | 경고만 / 동결 확인창 / 작업지시서 발행 차단 | 처음 2주는 확인창(지금 BomPreflight 방식), 오탐이 없으면 error는 발행 차단 |
| D9 | 좌우 휠라는 무엇을 따르나요? | 도면 / 스펙 | 도면 (원장 마지막 8건 해소) |
| D10 | 18T 몸통을 실제로 쓰나요? | 예 / 아니오 | 쓰면 PR4에서 그리기까지 지원 |
| D11 | CLAUDE.md에 도메인 소유 행 추가 | — | 6장 끝의 목록대로 승인 **→ 승인 2026-10-18** |

**가장 급한 것:** D6·D11 은 1주차, D2·D8·D12 는 단계 2와 3에서, D1·D3·D4 는 단계 4 전에 필요합니다 (개정판).

---

## 10. 일정 추정

가정:
- AI 에이전트가 하루에 PR 0.5~1개를 처리합니다.
- 도메인이 다른 PR은 동시에 진행합니다.
- 사장님 결정 D1~D4가 3주차 안에 나옵니다.

| 주차 | PR | 이정표 (사장님이 보는 것) |
|---|---|---|
| 1주 | PR1~PR3 | **M1:** 지금 플래너 3D에서 부딪히는 곳 목록 보고. 규칙 표 하나 |
| 2주 | PR4~PR7 | **M2:** 골든 사례 겹침 검사가 CI에서 돌고, #832 회귀를 잡는 것을 증명 |
| 3주 | PR8~PR11 | **M3:** 동결 전 겹침 검사. **플래너 구조 단계에 검사 배지가 처음 보임.** CI에서 STEP/GLB 산출물 |
| 4~6주 | PR12~PR15 | **M4:** 플래너 3D가 조립 명세 그대로 (밴드, 홈, 서랍통). 원장 184 → 0~8. 부재 카드 |
| 6~8주 | PR16~PR17 | **M5:** GLB 내보내기. 재단 묶음과 조립 묶음에 판재·단면 도면 |
| 그 뒤 | PR19·PR21 | 결정에 따라 벤더 DXF, 실제 주문 STEP(비공개 런타임). 게이트·외관 도면은 단계 0 으로 이동 |

**핵심 경로:** "동결 전 검사 + 플래너 배지"까지 약 3주, "플래너 3D = 실제 판재"까지 약 6주, 산출물까지 포함하면 약 8주입니다 (가정, 결정이 늦어지면 단계 4가 밀림).

---

**참조 파일 (저장소 루트 기준)**

| 영역 | 파일 |
|---|---|
| 플래너 | `mockup-structure.html`, `js/planner/planner-engine.js`, `js/planner/planner-finish.js` |
| 상세설계·BOM | `detaildesign.html`, `js/detaildesign/ui-step1.js`, `js/detaildesign/extractors.js`, `js/detaildesign/bom-drawer-rules.js`, `js/detaildesign/bom-preflight.js`, `js/detaildesign/workflow-client.js`, `js/detaildesign/calc-engine.js` |
| 시험 | `test-utils/scene-parts.js`, `test-utils/bom-parts.js`, `test-utils/ledger-diff.js`, `test-utils/ledger-allowlist.json` (확인한 개수 184), `test-utils/planner-golden.js`, `test-utils/bom-golden/` |
| 워커 | `workers/workflow-api/src/snapshots.js`, `workers/workflow-api/src/work-order-data.js`, `workers/workflow-api/src/templates/elevation.js`, `workers/workflow-api/src/templates/work-order.js` |
| DB | `database/design-renders.sql` |
| CAD 샘플 | `docs/01-plan/cad-beta/cad-prototype/sink_set.py` (`KICK_SETBACK=50`, `TOP_D=600`. 플래너의 40과 BOM의 650과 다름을 확인) |