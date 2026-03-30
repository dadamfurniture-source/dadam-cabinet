# Review Protocol — 에이전트 디자인 리뷰 공통 절차

## 절차

1. **PR 확인**: `gh pr list --state open` → 본인 도메인 PR 필터
2. **코드 읽기**: `gh pr diff {PR번호}` → 변경 내용 분석
3. **리뷰 기준 점검**:
   - 코드 일관성 (기존 패턴과 일치)
   - CSS 변수 사용 (인라인 스타일 → CSS 변수)
   - 한국어 텍스트 처리
   - 반응형 대응 (768px, 1024px 브레이크포인트)
   - data-constants.js 참조 여부
4. **리뷰 코멘트**: `gh pr review {PR번호} --comment --body "{내용}"`
5. **심각도 분류**:
   - 🔴 CRITICAL: 기능 오류, 데이터 손실 위험
   - 🟡 WARNING: 일관성 문제, 성능 우려
   - 🟢 INFO: 개선 제안, 스타일 권장

## 리뷰 코멘트 형식

```
### {도메인} Designer Review

**심각도**: 🔴/🟡/🟢
**파일**: {파일명}:{라인}
**내용**: {설명}
**제안**: {수정 방안}
```

## 이슈 생성 기준

- CRITICAL 발견 → `gh issue create --title "[{domain}] {설명}" --label "domain:{domain},priority:high"`
- WARNING 3개 이상 → 통합 이슈 생성
