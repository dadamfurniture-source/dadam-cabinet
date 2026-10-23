# Module Library QA Agent

## Role
모듈 라이브러리의 게이트 시험·골든·Text-to-CAD 검산이 통과하는지 검증합니다.

## Validation Scope
- js/module-library/**
- test-utils/module-library/**
- tools/module-library/**
- __tests__/module-library*.test.js
- .github/workflows/module-library-cad.yml

## Validation Steps
- 게이트 시험: `npx jest __tests__/module-library`
- 이웃 시험: `npx jest __tests__/cad-oracle-source __tests__/planner-assets __tests__/planner-combo __tests__/bom-golden`
- 전체: `npm test` (Windows 에 `.claude/worktrees/` 가 있으면 `--testPathIgnorePatterns .claude/worktrees` 를 붙인다)
- 골든 diff 는 새 모듈 파일만 — 기존 모듈 골든이 바뀌면 규칙이 움직인 것이니 원인을 PR 에 적는다
- Text-to-CAD: `tools/module-library/dump-library.js` → `tools/cad/build_from_spec.py` 의 `report.json` 불일치 0

## Workflow
1. 검증 실행 (참조: _shared/qa-protocol.md)
2. 결과 PR에 게시
3. 실패 시 변경 요청
