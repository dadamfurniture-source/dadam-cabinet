---
name: planner-qa
description: 다담 플래너(배치·구조·BOM)를 브라우저로 직접 써 보며 점검할 때. 서버 띄우기, 로그인 막 걷기, 품목 추가부터 BOM 숫자 뽑기까지 한 번에.
---

# 플래너 점검 (planner-qa)

플래너를 사용자처럼 처음부터 끝까지 써 보고, 막히는 곳·틀린 숫자·헷갈리는 곳을 찾을 때 쓴다.
브라우저 조작 일반은 `.claude/skills/webapp-testing/SKILL.md`(Python Playwright)를 따르고,
여기에는 이 저장소에만 있는 길만 적는다.

## 1. 띄우기

```bash
python3 .claude/skills/planner-qa/scripts/serve.py &          # http://127.0.0.1:8765/
python3 .claude/skills/planner-qa/scripts/planner_flow.py --help
```

- `python -m http.server` 는 쓰지 않는다. `detaildesign.html` 이 iframe 주소를 확장자 없이(`mockup-shell?preset=...`) 써서 404 가 난다.
- 크롬: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. 3D 는 `--use-gl=swiftshader` 로 돈다.
- CDN 은 막혀 있다. `planner_flow.py` 가 three·supabase-js 를 `node_modules` 로 돌려준다(`npm ci` 먼저).

## 2. 실제 사용자 경로

| 단계 | 화면 | 누르는 것 |
|---|---|---|
| 0 | `detaildesign.html` | 로그인 막(`#authOverlay`). 점검 때만 `hidden` 클래스를 붙여 걷는다 |
| 1 배치 | iframe `mockup-shell` | `#catPickerBtn` → `#catBtn-<품목id>` → 빠른 배치 `.preset-btn[data-preset=I|L|U]` 또는 장 버튼 `.rect-btn[data-section=lower|upper|tall|wardrobe|fridge]` |
| 2 구조 | iframe `mockup-structure` | `#nextStepBtn` → '전체 자동계산' |
| 3 BOM | 부모 페이지 | 'BOM 산출 →' → 표 탭 `🪵 본체` · `🚪 도어` |
| 4 작업지시서·견적 | 워커 | 로그인 + 워커 키가 필요하다. 이 컨테이너에서는 못 한다 — 건너뛰고 보고서에 적는다 |

- 품목 드롭다운은 iframe 이 부모 안에 있을 때만 보인다. `mockup-shell.html` 을 바로 열면 품목이 없다.
- 냉장고장(`fridge`)도 2026-10-20 부터 플래너다. 빠른 배치가 없어 장 버튼으로 놓는다: `--place fridge,tall` (냉장고장 + 키큰장). 장 버튼은 줄 끝에 이어 붙는다.
- 품목 id 와 기본 치수 정본: `js/detaildesign/data-constants.js CATEGORIES`.
- 배치 저장 키: `dadam_layout_v1::local:<itemId>` (localStorage). 구조는 `dadam_structure_v1::...`.
  배치를 손으로 넣을 때는 이 키에 쓰고 '📥 도면 불러오기 → ↩ 마지막 저장'.

## 3. 숫자 읽기

- 배치 사각형: `w` = 폭, `h` = **깊이**(평면도), `moduleH` = 전체 높이. 회전 0 = 앞이 아래, 90 = 앞이 왼쪽, 270 = 앞이 오른쪽.
- 구조 단계 모듈 깊이 = 자리 깊이 − (물끊기 10 + 도어 자리 20) (`planner-engine.js MASTER_RULES`).
- BOM 정본은 `js/detaildesign/extractors.js`. 품목마다 분기가 있다(`MaterialExtractor.extract` switch).
- "BOM 으로 안 넘어간다"는 보고는 품목 수부터 본다 — 좌측 배치 사각형은 품목이 아니다.
- 사전 검사(빨강 오류·주황 경고): `js/detaildesign/bom-preflight.js`.

## 4. 점검 순서 (한 품목)

1. `planner_flow.py --category <id> --preset I --shots <폴더>` 로 끝까지 가는지, 클릭 수와 부품 수를 본다.
2. 측판 깊이·높이가 정본과 같은지 본다 (`docs/design-rules/*.md`, `bom-*-rules.js`). 정본에 없는 숫자는 [확인 필요]로 적고 지어내지 않는다.
3. ㄱ자·ㄷ자(`--preset L|U`), 서랍장·오픈장·밥솥장(구조 단계 모듈 패널 '타입')을 한 번씩.
4. 스크린샷을 보고 겹치는 글자·화면 밖 사각형·말없이 사라지는 값을 적는다.

## 5. 함정

- 영역 멤버십은 `areaIdOfModule(m)` / `modulesOfArea(area)` 로만 본다. `m.areaId` 직접 비교 금지.
- 개별 모듈 패널은 초안이다 — '적용' 전에는 저장·3D·BOM 에 안 들어간다(다른 모듈을 고르면 자동 적용).
- 칸 타입 '서랍'은 칸이 하나일 때만 있고, 모듈을 하부 서랍 구성으로 바꾼다. BOM 브리지가 서랍으로 읽는 모양은 그것뿐이다.
- 구조 단계에서 BOM 에 갔다 오면 브리지 경고 띠(`#plannerBridgeWarnings`)가 클릭을 가로챈다. 닫고 누른다.
- 레거시 플래너(`lib/planner.ts`)는 고치지 않는다.

## 6. 시험

jsdom 하네스 `test-utils/planner-harness.js`(`bootPlanner('mockup-structure.html', {search})`)로
브라우저 없이 화면을 부팅할 수 있다. 버그를 고치면 고치기 전 코드에서 실패하는 시험을 같이 둔다.
예: `__tests__/planner-qa-2026-10-20.test.js`.
