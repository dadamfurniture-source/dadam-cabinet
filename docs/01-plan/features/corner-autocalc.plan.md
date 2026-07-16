# corner-autocalc Planning Document

> **Summary**: ㄱ자(L형) 배치에서 멍장(코너장/LT망장) 포함 secondary 라인 전체를 데이터 모델에 영속화하고, 상세 자동계산 + BOM 산출까지 연결
>
> **Project**: 다담AI (dadam-cabinet)
> **Author**: hong + Claude
> **Date**: 2026-07-16
> **Status**: Draft

---

## 1. Overview

### 1.1 Purpose

detail design 페이지의 ㄱ자 배치에서 멍장(코너장)과 secondary 라인(분기 벽면)이 자동계산·BOM에서 제외되는 구조적 문제를 해소한다. 최종 목표는 ㄱ자 설계 → 자동계산 → BOM 산출이 prime 라인과 동일한 정확도로 동작하는 것.

### 1.2 Background (2026-07-16 코드 조사 결과)

**구조적 원인 — 코너의 이중 표현:**

| 표현 | 위치 | 내용 | 문제 |
|------|------|------|------|
| 데이터 모델 (`item.modules`) | `ui-workspace.js:1541~1583` | ㄱ자 전환 시 `LT망장` 1개만 삽입 (W=secondaryD, isFixed, orientation:'secondary') | secondary 수납 모듈 없음 |
| 3D 미리보기 payload | `ui-step1.js:428~451` | 멍장(W=primeD+40) + 수납모듈 N개 즉석 생성 (`sec-auto-*`) | payload 전용, 저장 안 됨 |

**파생 문제:**
- 자동계산이 secondary 라인 전체를 스킵: `calc-engine.js:655/726/1202`의 `!m.orientation` 필터로 제외 후 무변경 재부착. 분배·갭 흡수 없음
- BOM 누락: `extractors.js`는 `item.modules`만 읽음 → 멍장 1개만 일반 카카스로 추출, secondary 수납 모듈 부재 산출 0
- 상부장 멍장 미영속화: `changeUpperLayoutShape()`(ui-workspace.js:1623)는 specs만 설정, 모듈 미생성 (corner.md §3.4 미구현)
- 멍장 W 공식 불일치: 데이터 모델 `secondaryD` vs 3D `primeD + 40`

### 1.3 확정된 결정사항 (2026-07-16 사용자 확인)

| 항목 | 결정 |
|------|------|
| 멍장 W 공식 | **인접 라인 깊이 + 40mm** (3D 미리보기 공식으로 통일, corner.md §3.2 업데이트 필요) |
| 멍장 내부 구조 | **규칙 문서화 선행** — 제작 규칙을 corner.md에 추가한 뒤 구현 (임의 규칙 생성 금지 원칙) |
| Secondary 라인 | **전체 영속화** — 멍장+수납 모듈을 `item.modules`에 저장, 자동계산/BOM 포함, 3D는 데이터에서 파생 |

### 1.4 Related Documents

- 도메인 규칙: `docs/design-rules/corner.md` (§3 멍장, §4 회전 — W 공식 개정 필요)
- 관련 코드: `ui-workspace.js`, `ui-step1.js`, `calc-engine.js`, `extractors.js`, `data-constants.js`
- 참고: mcp-server `sink-hitl-random.service.ts:335~379` (blindAnchorIdx 방식의 별도 코너 구현 — 개념 참고용)

---

## 2. Scope

### 2.1 In Scope

- [ ] **W10-0** corner.md 규칙 개정: 멍장 W = 인접깊이+40 확정 반영, 멍장 내부 구조(측판/선반/서랍/데드존) 제작 규칙 추가 ← **사용자 제작 규칙 입력 필요 (blocker)**
- [ ] **W10-1** [designui] secondary 라인 영속화: `changeLowerLayoutShape()`가 멍장+수납 모듈 전체를 `item.modules`에 생성, `_appendSecondaryModules()`는 데이터 모델 파생 렌더링으로 전환, W 공식 통일
- [ ] **W10-2** [designui] 상부장 멍장 영속화: `changeUpperLayoutShape()`에 upper 멍장(W=upperPrimeD+40) 생성 + upper secondary 수납 모듈
- [ ] **W10-3** [bom] calc-engine 확장: secondary 라인 자동계산 (prime과 동일한 분배/갭 흡수 규칙을 라인 단위로 적용), 멍장은 isFixed로 보호
- [ ] **W10-4** [bom] extractors 확장: 멍장 내부 구조 부재(W10-0 규칙 기반), secondary 모듈 부재, 코너 마감(finishCorner1/2, 기본 Filler 60mm) BOM 산출
- [ ] **W10-5** E2E 검증: ㄱ자 설정 → 자동계산 → 3D/정면도 → BOM 전체 흐름 + 기존 저장 설계 로드 호환

### 2.2 Out of Scope

- ㄷ자(U형) tertiary 라인 — ㄱ자 완성 후 동일 패턴으로 후속 (W11 후보)
- 멍장 도어 힌지 방향/회전의 2D 도면 표현 개선 (orientation 전달 방식 유지)
- mcp-server sink-hitl 파이프라인과의 통합 (별도 시스템)

---

## 3. Requirements

### 3.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-01 | ㄱ자 전환 시 secondary 라인 전체(멍장+수납)가 `item.modules`에 영속화된다 | High | Pending |
| FR-02 | 멍장 W = 인접 라인 깊이 + 40mm 로 모든 경로에서 일관 계산된다 | High | Pending |
| FR-03 | 상부장 멍장이 데이터 모델에 생성된다 (W = upperPrimeD + 40) | High | Pending |
| FR-04 | 자동계산이 secondary 라인 수납 모듈을 분배/갭 흡수한다 (멍장 isFixed 보호) | High | Pending |
| FR-05 | BOM이 멍장 내부 구조 부재 + secondary 모듈 부재를 산출한다 | High | Pending |
| FR-06 | 3D 플래너 payload가 데이터 모델에서 파생된다 (이중 생성 제거) | Medium | Pending |
| FR-07 | 기존 저장 설계(secondary 모듈 없는 ㄱ자) 로드 시 자동 보정된다 | Medium | Pending |
| FR-08 | 코너 마감재(finishCorner1/2)가 BOM에 포함된다 | Medium | Pending |

### 3.2 Non-Functional Requirements

| Category | Criteria | Measurement Method |
|----------|----------|-------------------|
| 회귀 안전성 | 기존 ㅡ자(I형) 자동계산 결과 무변화 | 자동계산 전/후 스냅샷 비교 |
| 데이터 호환 | 기존 저장 설계 로드 시 오류 0 | persistence-init 로드 테스트 |
| 규칙 준수 | data-constants.js 정의 외 임의 상수 금지 | 코드 리뷰 체크 |

---

## 4. Success Criteria

### 4.1 Definition of Done

- [ ] FR-01 ~ FR-08 구현 완료
- [ ] ㄱ자 E2E: 설정 → 자동계산 → BOM 결과가 corner.md 규칙과 일치
- [ ] 기존 저장 설계 로드 회귀 통과
- [ ] corner.md가 구현과 100% 동기화
- [ ] PR 리뷰 및 머지

### 4.2 Quality Criteria

- [ ] ㅡ자 자동계산 회귀 0건
- [ ] W9 정면도(orientation 의존) 회귀 0건
- [ ] 콘솔 에러 0건

---

## 5. Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| 멍장 내부 구조 규칙 미확정 (W10-0) | High | High | W10-0을 blocker로 선행. 규칙 확보 전 W10-4의 멍장 부재는 현행(일반 카카스) 유지 |
| 기존 저장 설계와 비호환 | High | Medium | FR-07 로드 시 보정 로직 (secondary 모듈 없으면 재생성) + 로드 테스트 |
| calc-engine(1219줄) 수정 회귀 | High | Medium | 라인 단위 계산으로 분리 (prime 경로 무변경), ㅡ자 스냅샷 비교 |
| W9 정면도가 payload 이중 생성에 의존 | Medium | Medium | W10-1에서 `sec-auto-*` id 체계 유지, 정면도 수동 검증 |
| calc-engine:919 `hasSecondaryLT` 가드와 상부 멍장 충돌 | Medium | Low | W10-2에서 가드 조건에 pos 구분 추가 |
| 도메인 파일 동시 수정 충돌 | Medium | Low | designui(W10-1/2) → bom(W10-3/4) 순차 실행, 브랜치 분리 |

---

## 6. Architecture Considerations

### 6.1 핵심 아키텍처 결정

| Decision | Options | Selected | Rationale |
|----------|---------|----------|-----------|
| Source of Truth | payload 즉석 생성 유지 / **데이터 모델 영속화** | 데이터 모델 | BOM·자동계산·3D가 같은 데이터를 봐야 함 (사용자 확정) |
| 자동계산 단위 | 전체 평면 / **라인(prime/secondary) 단위** | 라인 단위 | prime 로직 무변경으로 회귀 최소화, 라인별 W 예산이 명확 |
| 멍장 보호 방식 | orientation 필터 / **isFixed 플래그** | isFixed | corner.md §3.2 의도와 일치, orientation은 회전 표현에만 사용 |

### 6.2 실행 순서와 도메인 소유권 (CLAUDE.md)

```
W10-0 (docs)     corner.md 개정          ← 사용자 규칙 입력 필요
  ↓
W10-1 (designui) ui-workspace + ui-step1  branch: agent/designui-w10-1-corner-persist
  ↓
W10-2 (designui) 상부장 멍장              branch: agent/designui-w10-2-upper-blind
  ↓
W10-3 (bom)      calc-engine              branch: agent/bom-w10-3-secondary-autocalc
  ↓
W10-4 (bom)      extractors               branch: agent/bom-w10-4-corner-bom
  ↓
W10-5            E2E 검증 + gap analysis
```

같은 도메인 내 순차 실행. 각 단계는 독립 PR로 머지.

---

## 7. Next Steps

1. [ ] **사용자**: 멍장 내부 구조 제작 규칙 제공 (도면/사진/설명) → W10-0
2. [ ] 설계 문서 작성 (`corner-autocalc.design.md`) — 모듈 스키마, 자동계산 알고리즘, 부재 산출식 상세
3. [ ] W10-1 구현 착수

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-07-16 | Initial draft — 코드 조사 + 3개 결정사항 반영 | hong + Claude |
