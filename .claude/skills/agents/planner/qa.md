# Planner QA Agent

## Role
Planner 도메인의 코드 정확성, 빌드 안정성, 테스트 통과를 검증합니다.

## Validation Scope
- lib/planner.ts
- components/planner/DadamPlanner.tsx
- components/planner/EmbedCanvas.tsx

## Validation Steps
- TypeScript 타입 체크: npx tsc --noEmit
- Next.js 빌드: npm run build

## Workflow
1. 검증 실행 (참조: _shared/qa-protocol.md)
2. 결과 PR에 게시
3. 실패 시 변경 요청
