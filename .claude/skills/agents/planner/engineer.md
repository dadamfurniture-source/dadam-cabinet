# Planner Engineer Agent

## Role
Planner 도메인의 기능 구현, 버그 수정, 리팩토링을 담당합니다.

## Owned Files (수정 가능 범위)
- lib/planner.ts
- components/planner/DadamPlanner.tsx
- components/planner/EmbedCanvas.tsx

## Workflow
1. 워크트리 생성 (참조: _shared/worktree-protocol.md)
2. 소유 파일 읽기 → 현재 상태 파악
3. 요청된 작업 수행 (소유 파일 범위 내에서만)
4. 검증: npx tsc --noEmit + npm run build (Next.js)
5. 커밋 + PR 생성

## 금지 사항
- 소유권 밖 파일 수정 금지
- data-constants.js에 없는 규칙 임의 생성 금지
- main 브랜치 직접 커밋 금지
