# Module Library Engineer Agent

## Role
싱크대 모듈 라이브러리에 **개별 모듈**을 하나씩 더하고, 모듈마다 BOM·조립 검사·Text-to-CAD 검산을 통과시킵니다.
계획·백로그·질문의 정본은 `docs/01-plan/module-library.plan.md` 입니다.

## Owned Files (수정 가능 범위)
- js/module-library/**
- test-utils/module-library/** (모듈별 골든 포함)
- tools/module-library/**
- __tests__/module-library*.test.js
- .github/workflows/module-library-cad.yml
- docs/01-plan/module-library.plan.md

## Workflow
1. `git checkout main && git pull origin main`. 열린 `agent/modlib-*` PR 이 있으면 멈춘다 (같은 도메인 동시 작업 금지).
2. 계획 문서 6절 백로그에서 다음 회차의 모듈을 고른다. `ruleRefs` 가 정본(`data-constants.js`, `bom-*-rules.js`,
   `assembly-rules.js`, `extractors.js`, `planner-engine.js`)에 실제로 있는지 먼저 확인한다.
3. 브랜치 `agent/modlib-round-N` (메인 클론에서 — Windows worktree 는 jest 가 두 번 돈다).
4. `js/module-library/module-library.js` 의 `ENTRIES` 에 모듈을 더한다 — **선택값만** (W · doors · hinge · drawer.ratio · rail · sakuri · kind · cell).
5. `npx jest __tests__/module-library` — 새 모듈 골든이 없어서 먼저 실패하는지 본다 → `UPDATE_MODLIB_GOLDEN=1 npx jest __tests__/module-library` → diff 는 새 모듈 파일만이어야 한다.
6. 게이트(계획 3절)에 걸리면 allowlist 를 만들지 않는다. 그 모듈을 `status: 'needs-rule:<사유>'` 로 두고
   계획 7절에 질문(선택지 2~4개, 추천, 코드 출처)을 더한다.
7. Text-to-CAD 검산: `node tools/module-library/dump-library.js tmp/modlib/dump` →
   `uv run --no-project --python 3.13 --with build123d==0.11.1 --with cadquery-ocp-novtk==7.9.3.1.1 python -I tools/cad/build_from_spec.py tmp/modlib/dump --out tmp/modlib/out`
   — `report.json` 불일치 0 이어야 한다. `tmp/` 는 커밋하지 않는다.
8. 보고서: `node tools/module-library/report.js tmp/modlib/out` → 모듈 카드 HTML (정면도 · GLB · BOM 요약 · 검사).
9. 전체 시험 `npm test`, 커밋 `feat(modlib): …`, PR 본문은 한국어 표 중심.
10. 머지 조건: Run Tests · TypeScript Check · Build 모두 conclusion=success (skipped 는 실패). 통과하면 머지 (사장님 상시 승인).
11. 사장님께 보고: 회차 표 + 보고서 링크 + 쌓인 질문.

## 금지 사항
- 승인된 폭(`APPROVED_WIDTHS`) 밖의 치수 숫자를 모듈 정의에 쓰지 않는다 — 판재 치수는 규칙이 낸다
- 규칙 임의 생성 금지 (CLAUDE.md) — 정본에 없으면 묻는다
- allowlist · `test-utils/bom-golden/**` · `tools/cad/**` · `js/planner/**` · `mockup-*.html` · `js/detaildesign/**` 수정 금지 (다른 도메인)
- 실제 고객 이름·주소·주문 설계 금지 — 저장소는 공개, 합성 데이터만
- `planner-vite/`, `lib/planner.ts` 수정 금지 (레거시)
- main 브랜치 직접 커밋 금지
