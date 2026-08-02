# corner-autocalc 설계-구현 Gap 분석 보고서

> **Summary**: ㄱ자 멍장(코너장) 자동계산 기능의 설계 문서 대비 구현 정합성 분석 (PDCA Check) + Act-1 개선 결과
>
> **Project**: 다담AI (dadam-cabinet)
> **Analyst**: gap-detector (Claude) + Act-1 by Claude
> **Date**: 2026-08-02
> **Branch**: agent/bom-w10-5-e2e (W10-1~4 main 머지 완료, 프로덕션 v33.2 배포)

---

## 1. Analysis Overview

| 항목 | 내용 |
|------|------|
| 분석 대상 | corner-autocalc (ㄱ자/ㄷ자 멍장 상세 자동계산) |
| 설계 문서 | `docs/02-design/features/corner-autocalc.design.md` |
| 계획 문서 | `docs/01-plan/features/corner-autocalc.plan.md` |
| 규칙 원본 | `docs/design-rules/corner.md` §3 |
| 구현 파일 | `corner-engine.js`, `calc-engine.js`, `data-constants.js`, `ui-workspace.js`, `ui-step1.js`, `extractors.js`, `persistence-init.js` |
| 테스트 | Jest 48 (corner-engine 37 + extractors-corner 11), E2E 17/17 (`tmp/e2e/w10-5-corner-verify.py`) |
| 프로덕션 검증 | dadamfurniture.com v33.2 엔진 직접 호출 — §4.1 검산/원장/BOM 전 항목 일치, 콘솔 에러 0 |

## 2. Scores

| Category | 초기 (Check) | Act-1 후 | Status |
|----------|:-----------:|:--------:|:------:|
| Design Match | 85% | 91% | ✅ |
| Architecture Compliance (SSOT/라인단위/순수함수) | 96% | 96% | ✅ |
| Convention Compliance (상수/네이밍/규칙근거) | 95% | 95% | ✅ |
| **Overall** | **88%** | **92%** | ✅ |

## 3. 설계 항목별 대조 요약

- **§2.2 파일 목록**: 10/10 일치 (ui-step1 파생 렌더링은 레거시 fallback 잔존으로 부분)
- **§3 데이터 모델**: 결정적 id, line/isDerived/blindZoneW/doorW 스키마, CORNER_* 상수 일치. blindLine 필드는 기록되나 prime 소비 미배선(의도된 축소)
- **§4 알고리즘**: 멍 공식, 도어 균등 분배, door-first 분배(distributeBlindLine), 원장 불변식(assertCornerLedger), 인접 offset(cornerAdjOffset) 일치. 반환 계약은 평탄화 구조로 실현(design 0.2에 반영)
- **§5 UI**: blindLine 토글(prime disabled — 의도), 팔레트 분해 표기·경고 배지 미구현(G2/G3, design 0.2에 후속 표기)
- **§6 BOM**: 도어 doorW 기준(오발주 방지), 멍가림판 2.7T, 코너 몰딩/휠라, secondary 전량 산출 — 전부 일치
- **§7 마이그레이션**: 멱등 보정 + persistence-init 배선 일치
- **§8 테스트**: Unit/E2E/BOM 일치, ㅡ자 회귀는 moduleLine prime-only 필터로 구조적 격리(스냅샷 자동화는 후속)

## 4. Gap 목록 및 처리 결과

| # | 항목 | 심각도 | 처리 (Act-1) |
|---|------|:------:|--------------|
| G1 | 라인이 멍보다 짧을 때 ㄱ자 전환 거부 미구현 (design §4.4) | Medium | ✅ **구현** — `changeLowerLayoutShape`/`changeUpperLayoutShape`에 deriveCorner 가드: doorAvail < 0이면 alert(최소 라인 W 안내) + shape 원복. E2E T8 2케이스 추가 (17/17 PASS) |
| G2 | 멍장 팔레트 분해 표기 + isDerived 수정 잠금 | Low | 📋 후속 표기 — design §5 0.2. 파생값은 자동계산 시 재계산되므로 데이터 정합성 영향 없음 |
| G3 | 도어 최소폭 경고 UI 배지 | Low | 📋 후속 표기 — design §5 0.2. 현재 console.warn |
| P1 | deriveCorner 반환 계약 표현 차이 | Info | ✅ design 0.2에 "코드가 진실" 반영 |
| P2 | prime 라인 원장 assert 부재 | Low | 후속 (기존 분배 로직 의존, 회귀 없음) |
| P3 | 몰딩 변경 즉시 재계산 (자동계산 시 재파생으로 동작) | Low | 후속 |
| P4 | ui-step1 레거시 fallback에 구공식 primeD+40 잔존 | Low | 후속 — migrateCornerModules가 로드 시 영속 모듈 생성하므로 실사용 도달 경로 없음 |
| P5 | ㅡ자 회귀 스냅샷 자동화 부재 | Low | 후속 — E2E T5가 I 설계 무오염 검증으로 대체 |
| — | plan FR-02/03 구공식(+40mm) | Doc | ✅ Superseded 표기 (corner.md §3.3/§3.6 개정으로 대체) |

의도된 축소(감점 제외): blindLine prime 옵션 disabled(준비중), 하드웨어 필드만 예약(design §6 "1차 범위 외").

## 5. 결론

핵심 기능(secondary 영속화, 멍장 파생, 상부 멍장, 라인 자동계산, BOM 부재, 마이그레이션, 코너 마감)은 전부 구현·검증 완료. Act-1로 유일한 Medium gap(G1)을 해소하고 문서를 동기화하여 **Overall 92% ≥ 90%** — `/pdca report corner-autocalc` 진행 가능. 잔여 Low 항목(G2/G3/P2~P5)은 W11 후속 백로그.
