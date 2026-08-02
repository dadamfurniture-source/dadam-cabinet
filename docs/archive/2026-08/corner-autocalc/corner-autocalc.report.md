# corner-autocalc 완료 보고서 (PDCA Report)

> **Summary**: ㄱ자/ㄷ자 멍장(코너장) 상세 자동계산 — 단일 파생 엔진 + 라인 단위 계산 + BOM 연동 완성
>
> **Project**: 다담AI (dadam-cabinet)
> **기간**: 2026-07-16 ~ 2026-08-02
> **최종 Match Rate**: 92% (Check 88% → Act-1 후 92%)
> **프로덕션**: dadamfurniture.com v33.2 배포·검증 완료

---

## 1. 목표 (Plan)

멍장 치수가 UI/3D/BOM 각각에서 다른 공식으로 즉석 계산되던 문제를 해소:
- 멍장 치수를 **단일 순수 함수 `deriveCorner()`** 에서만 파생
- secondary 라인 전체를 `item.modules`에 영속화 (자동계산·3D·BOM 동일 데이터)
- 도어 균등 분배 원칙 (라인 원장 방식), prime 경로 무변경

## 2. 진행 내역 (Do) — PR #423~428

| 단계 | PR | 내용 |
|------|-----|------|
| W10-0 | #423 | 제작 규칙 확정 — corner.md §3 개정 + Plan/Design 문서 |
| W10-1 | #424 | corner-engine.js 신규 (deriveCorner/seed/migrate) + secondary 영속화 + 마이그레이션 |
| W10-2 | #425 | 상부장 멍장 영속화 + 멍장 위치 토글 UI (prime은 준비중) |
| W10-3 | #426 | 라인 단위 자동계산 — distributeBlindLine(door-first) + assertCornerLedger(원장 불변식) + moduleLine SSOT |
| W10-4 | #427 | BOM — 멍장 도어 doorW 기준(오발주 방지), 멍가림판 2.7T 신규, 코너 몰딩/휠라 |
| chore | #428 | 캐시 버전 범프 v33.1→v33.2 (CDN 구버전 서빙 방지) |
| W10-5 | (본 PR) | E2E 17케이스 + gap 분석 + G1(라인 부족 전환 거부) 구현 + 문서 동기화 |

## 3. 검증 (Check)

| 종류 | 결과 |
|------|------|
| Jest 단위 | corner-engine 37 + extractors-corner 11 = **48 passed** |
| E2E (Playwright, file://) | `tmp/e2e/w10-5-corner-verify.py` **17/17 PASS** — §4.1 검산·원장·I 회귀·멱등성·BOM·G1 거부 |
| 프로덕션 (v33.2 실서빙 코드) | 엔진 직접 호출 검증 — 멍장 1100/700/400, 상부 830/380/450, 원장 diff 0, BOM 396/446·700/380·몰딩60, 콘솔 에러 0 |
| 확정 예시 검산 | 1970 = EP20 + 400×2 + 멍장1100 + 여유50 ✓ / 1800 = EP20 + 450×2 + 830 + 50 ✓ |
| Gap 분석 | 88% → Act-1(G1 구현 + 문서 동기화) → **92%** |

## 4. 개선 (Act-1)

- **G1 (Medium)**: 라인 W가 멍보다 짧으면 ㄱ자 전환 거부 + 최소 라인 W 안내 (`ui-workspace.js` changeLower/UpperLayoutShape 가드, E2E T8)
- 문서 동기화: plan FR-02/03 Superseded(구공식 +40mm → corner.md §3 개정 공식), design 0.2 (§4.4 구현 표기, §5 G2/G3 후속 표기, 반환 계약 코드 우선)

## 5. 잔여 백로그 (W11 후속, Low)

- G2: 멍장 팔레트 `1100 (멍700+도어400)` 분해 표기 + isDerived 수정 잠금
- G3: 도어 최소폭 경고 UI 배지 (현재 console.warn)
- P2: prime 라인 원장 assert / P3: 몰딩 변경 즉시 재파생 / P4: ui-step1 레거시 fallback 구공식 제거 / P5: ㅡ자 회귀 스냅샷 자동화
- blindLine 'prime' 옵션 활성화 (엔진 소비 배선)
- 프로덕션 로그인 후 UI 클릭 경로 수동 확인 (자동 검증은 엔진 레벨까지 완료 — 로그인 필요로 미자동화)

## 6. 배운 점

- **"Derive, don't store" + 결정적 id**가 멱등성·가드 단순화·마이그레이션을 동시에 해결 — 이후 파생 모듈 설계의 기준 패턴
- 라인 = 계산 단위 원칙 덕에 prime 경로 무변경으로 회귀 위험 최소화 (moduleLine 필터 교체만)
- BOM 오발주(도어 1096 vs 396)는 단위 테스트가 아닌 **설계 문서의 명시적 경고**(§6 "카카스 W 아님")에서 잡힘 — 규칙 문서화 선행 원칙의 실효 확인
- 캐시 버스팅 파라미터는 코드 변경 PR에 포함시킬 것 (별도 chore로 뒤늦게 범프하면 구버전 서빙 공백 발생)
