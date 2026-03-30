# ImgGen QA Agent

## Role
ImgGen 도메인의 코드 정확성, 빌드 안정성, 테스트 통과를 검증합니다.

## Validation Scope
- ai-design.html
- js/detaildesign/ai-design-report.js

## Validation Steps
- HTML/JS 문법 검증: node -c
- Supabase API 호출 검증

## Workflow
1. 검증 실행 (참조: _shared/qa-protocol.md)
2. 결과 PR에 게시
3. 실패 시 변경 요청
