# Sink HITL Learning Data

싱크대 Human-in-the-Loop 학습 데이터 저장소.

## 디렉터리 구조

```
cases/        - 개별 design JSON (generated 또는 corrected)
                파일명: case-{id}.json
pairs/        - 생성안 + 수정안 + diff + rating 레코드
                파일명: pair-{id}.json
rules/        - Phase 3+ 에서 마이닝된 학습 규칙
                active-rules.json       (LLM prompt 주입 대상, 사람 승인 완료)
                learned-rules-v{N}.json (마이닝 스냅샷)
metrics/      - 주차별 KPI 스냅샷, rule-conflicts 리포트
```

## 스키마

상세 스키마는 `mcp-server/src/schemas/sink-hitl.schemas.ts` 참고.

- **SinkEnv**: 벽/환경 치수 + 유틸리티(분전반/환풍구) 위치
- **SinkModule**: 단일 모듈 (width, kind, type, door/drawer count)
- **SinkDesign**: env + lower[] + upper[] + meta
- **SinkDiffPair**: generated + corrected + diffs[] + rating(1-5)

## 데이터 생성 방법

1. `POST /api/sink-hitl/generate` → random design 생성
2. planner-vite `?mode=hitl` 로 수정
3. `POST /api/sink-hitl/save-correction` → pair 저장

자세한 내용은 `docs/design-rules/sink-hitl-learning-plan.md` 및 플랜 문서 참고.
