# Worktree Protocol — 에이전트 코드 수정 공통 절차

## 절차

1. **워크트리 생성**: `git worktree add .claude/worktrees/agent-{domain}-{slug} -b agent/{domain}-{slug}`
2. **최신 동기화**: `git pull origin main`
3. **파일 소유권 확인**: CLAUDE.md 소유권 테이블에서 본인 도메인 파일만 수정
4. **코드 수정**: 소유 파일 범위 내에서만 변경
5. **검증**: 문법 체크 (JS: `node -c`, TS: `npx tsc --noEmit`)
6. **커밋**: `git add {파일} && git commit -m "{type}({domain}): {설명}"`
   - type: feat, fix, refactor, docs, test
7. **푸시**: `git push origin agent/{domain}-{slug}`
8. **PR 생성**: `gh pr create --title "{type}({domain}): {설명}" --base main`

## 커밋 메시지 형식

```
{type}({domain}): {한줄 설명}

{상세 내용}

Co-Authored-By: Claude Agent ({domain}) <noreply@anthropic.com>
```

## PR 본문 형식

```markdown
## Summary
- 변경 사항 요약

## Files Changed
- 수정된 파일 목록

## Validation
- [ ] 문법 검증 통과
- [ ] 타입 검증 통과 (TS)
- [ ] 기능 테스트 확인

## Domain
{domain}
```

## 금지 사항

- 소유권 밖 파일 수정 금지
- main 브랜치 직접 커밋 금지
- data-constants.js에 없는 규칙 임의 생성 금지
