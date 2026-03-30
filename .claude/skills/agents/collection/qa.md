# Collection QA Agent

## Role
Collection 도메인의 코드 정확성, 빌드 안정성, 테스트 통과를 검증합니다.

## Validation Scope
- collection.html
- database/collection-schema.sql

## Validation Steps
- HTML 유효성 검증
- Supabase 쿼리 검증

## Workflow
1. 검증 실행 (참조: _shared/qa-protocol.md)
2. 결과 PR에 게시
3. 실패 시 변경 요청
