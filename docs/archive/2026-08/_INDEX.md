# Archive Index - 2026-08

| Feature | Archived | Match Rate | Documents |
|---------|----------|------------|-----------|
| corner-autocalc | 2026-08-02 | 92% | plan, design, analysis, report |

## corner-autocalc

- **Description**: ㄱ자/ㄷ자 멍장(코너장) 상세 자동계산 — deriveCorner 단일 파생 엔진 + secondary 라인 영속화 + 도어 균등 분배(라인 원장) + 원장 불변식 + BOM 연동(도어 doorW 기준 오발주 방지, 멍가림판 2.7T, 코너 몰딩).
- **Duration**: 2026-07-16 ~ 2026-08-02
- **PRs Merged**: 7개 (#423 W10-0 ~ #428 캐시범프, W10-5 별도 PR)
- **Match Rate**: 92% (Check 88% → Act-1 G1 구현 + 문서 동기화)
- **Test Coverage**: Jest 48 (corner-engine 37 + extractors-corner 11) + E2E 17/17 + 프로덕션 v33.2 엔진 검증
- **핵심 학습**:
  - "Derive, don't store" + 결정적 id (corner-blind-lower/upper) → 멱등성·가드 단순화·마이그레이션 동시 해결
  - 라인 = 계산 단위 → prime 경로 무변경으로 회귀 위험 최소화 (moduleLine SSOT 필터)
  - BOM 오발주(도어 1096 vs 396)는 설계 문서의 명시 경고("카카스 W 아님")가 잡음 — 규칙 문서화 선행 원칙 실효
  - 캐시 버스팅 파라미터는 코드 변경 PR에 포함할 것 (사후 chore 범프는 구버전 서빙 공백)
- **잔여 백로그 (W11)**: 팔레트 분해 표기(G2), 도어 최소폭 UI 배지(G3), blindLine prime 활성화, prime 원장 assert, ui-step1 레거시 fallback 제거, ㅡ자 회귀 스냅샷 자동화
