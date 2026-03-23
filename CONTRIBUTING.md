# 배포 규칙 (Deployment Rules)

## main 브랜치 보호
- `main` 브랜치에 **직접 푸시 금지**
- 모든 변경은 **PR(Pull Request)**을 통해 머지
- PR 머지 시 자동으로 GitHub Pages 배포

## 워크플로우
```
1. 브랜치 생성: git checkout -b feature/my-change
2. 작업 + 커밋
3. 푸시: git push origin feature/my-change
4. GitHub에서 PR 생성 → main으로 머지
5. 머지 완료 → 자동 배포
```

## Claude Code 에이전트 규칙
- 워크트리에서 작업 → PR로 머지
- `main` 직접 커밋 금지
- 다른 에이전트와 같은 파일 수정 시 충돌 주의

## 긴급 배포 (Hotfix)
- `hotfix/` 브랜치에서 작업 → 즉시 PR → 머지
