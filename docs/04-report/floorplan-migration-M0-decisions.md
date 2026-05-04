# Floorplan 마이그레이션 — M0 결정 합의서

**작성일**: 2026-05-04
**브랜치**: `claude/review-detail-design-t1VAC`
**관련**: 3D 플래너 Top View 기반 공간 배치 도입 마이그레이션 계획

본 문서는 마이그레이션 M0 단계의 산출물로, 후속 마일스톤(M1~M7)이 의존하는 결정 항목을 못박는다. 변경 시 별도 합의 후 본 문서를 갱신해야 한다.

---

## 1. 변경 개요

현재 `item = { w, h, d } + specs.layoutShape ('I'|'L'|'U') + secondary/tertiary 보조 필드`로 표현되는 단일 박스 모델을, **N개의 사각형 공간(Space)이 Top View 평면 위에서 자유 배치되는** Floorplan 모델로 전환한다.

`item.floorplan = { spaces: Space[], junctions, trimmedSpaces, schemaVersion: 2 }`

## 2. 결정 항목 (M0 확정)

| ID | 항목 | 확정 결정 | 이유 |
|----|------|----------|------|
| **A** | 회전 단위 | **90° 스냅** | 직각 분석적 트리밍(옵션 c) 가능 → 외부 라이브러리 0 + BOM 정확도 안전 |
| **B** | 공간 간 각도 제약 | **직각만(M3 1차 출시)** | 비직각 벽은 후속 릴리스 |
| **C** | 트리밍 의미 | **시각 + BOM 모두**. 단 카운터탑/몰딩은 트리밍 전 길이 사용 | BOM 정확도 |
| **D** | 다중 공간 N | **모델은 N**, M3 UX 1차 출시는 ≤2(ㄱ자) | 데이터 모델은 N으로 일반화, 1차 UX는 검증 가능한 범위 |
| **E** | 분배기/환풍구 | **space별 별도** | ㄱ자 부엌 실제 케이스 — 분배기는 한 벽에만, 환풍구는 가스대 위에만 |
| **F** | 카테고리 호환 | **모든 카테고리(우선순위 차등)**. 1차 출시 sink, 후속 wardrobe/fridge | 데이터 모델은 통일, 카테고리별 derive 룰만 분리 |
| **G** | v1 호환 | **마이그레이션 + feature flag로 v1 fallback**(M6까지 유지) | 기존 사용자 무중단 |
| **H** | 회전 중심 | **사각형 중심** | 90° 스냅과 자연스러움 |
| **I** | 기존 W/H/D 인라인 폼 | **인스펙터 패널로 이동, 카드 본문에서 제거** | UX 단순성 |
| **J** | 우클릭 동작 | **즉시 90° 시계방향 회전** | 결정 A=90° 스냅과 일관 |

## 3. 트리밍 알고리즘 — 옵션 (c) 직각 분석적 트리밍 채택

- 모든 공간 회전을 90°×k로 강제 → 두 사각형은 항상 축 정렬 상태에서 겹침 → 결과는 항상 사각형/L폴리곤.
- 외부 라이브러리 0. 부동소수 좌표는 **1mm 반올림 후 정수 비교**로 robustness 확보.
- 트리밍 변의 길이 = `min(겹침 길이, 상대 깊이)` 만큼 줄어듦.
- BOM 매핑:
  - 측판/지판/뒷판/도어 → **트리밍 후 길이**
  - 카운터탑/몰딩 → **트리밍 전 길이**(외곽선 기준)
- 옵션 (a) z-order occlusion / (b) CSG는 채택하지 않음(이유는 마이그레이션 계획 §3 참조).

## 4. iframe postMessage 계약 변경

현 `UPDATE_PLANNER` 단방향 + dead `PLANNER_STATE` 송신 → 다음으로 교체:

**부모 → 자식**:
- `UPDATE_FLOORPLAN`(payload: FloorplanMessage, nonce)
- `SET_CAMERA_VIEW`('top'|'front'|'perspective')
- `SET_EDIT_MODE`('view'|'edit'|'readonly')
- `LOAD_HITL_CASE`
- `PING`(nonce)

**자식 → 부모**:
- `FLOORPLAN_CHANGED`(payload: { floorplan, trigger }, nonce)
- `MODULE_CHANGED`(payload: { modules }, nonce)
- `PLANNER_READY`(version)
- `PLANNER_ERROR`(code, message)
- `PONG`(nonce)

검증:
- `ALLOWED_ORIGIN = window.location.origin` (정적 사이트, 동일 origin 가정)
- 부모/자식 양쪽에 origin 가드 + payload schema 가드(수동 type guard 또는 zod)
- nonce 일치 시 echo ignore (양방향 ping-pong 차단)

## 5. Next 트랙 archive 결정

- `lib/planner.ts`(Next, 854줄), `app/planner/`, `app/embed/`, `components/planner/*` 는 **사용 경로 0건** 확인 (유일한 임베드 경로는 `planner-vite/` 빌드 산출물 `/planner/embed/`).
- `archive/next-planner/`로 `git mv` 하고 README에 사유 명시. main에서 즉시 archive.
- 사유: 두 트랙(Next 18 / Vite 19) 동시 마이그레이션은 일정 50% 증가, 위험 2배. dead path 유지 비용 0.

## 6. 즉시 시작 작업 — 진행 결과

| # | 작업 | 위험 | 진행 상태 |
|---|------|------|----------|
| 1 | postMessage origin 검증 추가 | 0 | ✅ 적용 (커밋 `5aa3695`) |
| 2 | schema 가드 추가 | 매우 낮음 | ✅ 자식 측 type guard + VALID_VIEWS 화이트리스트 |
| 3 | Next 트랙 archive | 낮음 | ✅ 완료. 사장님이 운영 사이트(dadamfurniture.com)의 `/portfolio`, `/pricing`을 직접 확인 → 두 경로 모두 정적 `index.html`의 메인 hero가 표시됨 → **Next 빌드 산출물(`out/`)이 운영에 배포되지 않음 확정**. `app/`(전체), `components/`, `lib/planner.ts`, `lib/supabase.ts`, `next.config.js`, `tailwind.config.js`, `postcss.config.js`, `next-env.d.ts`를 `archive/next-planner/`로 이동(README 동봉). tsconfig `exclude`에 `archive`/`planner-vite` 추가. CI의 Next build/lighthouse-build-needs/deploy-needs 정리. 후속: `index.html`의 `/pricing`·`/account/billing` 죽은 링크 정리 + `package.json` Next 의존 제거(별도 PR) |
| 4 | dead `PLANNER_STATE`/`HITL_STATE` 송신 정리 | 0 | ✅ 자식 측 useEffect 제거 (커밋 `5aa3695`) |
| 5 | 모듈 ID 네임스페이스화 | 낮음 | ✅ 부모 `_appendSecondaryModules`의 6개 고정 ID(`blind-corner-*-auto`)에 `i${itemUniqueId}-` prefix 적용. 다중 item React key 충돌 차단. 더 광범위한 ID prefix 표준화(24개 위치 `Date.now()+Math.random()`)는 회귀 위험으로 M1로 이관 |
| 6 | LIVE 골든 마스터 캡처 (Supabase 100건) | 0 (read-only) | ⏸ **보류 — 사용자 Supabase 액세스 필요**. M5 BOM 회귀 검증의 비교 기준이므로 M1 시작 전 확보 필요 |
| 7 | calc-utils 통합 테스트 추가 | 0 | ⏸ **보류** — `planner-vite/src/lib/__tests__/calc-utils.test.ts` 17건 외 `runAutoCalcLower`/`runAutoCalcUpper` 통합 테스트는 현재 vanilla JS(`js/detaildesign/calc-engine.js`)에 살아 있어 vitest로 테스트하려면 ESM/모듈 추출이 선행되어야 함. M1 자료 모델 정의 시 calc-engine을 `.ts`로 추출하면서 테스트 동시 작성이 효율적 |
| 8 | 빌드 산출물 git 커밋 정책 재검토 | 낮음 | ⏸ **결정 대기** — `planner/embed/assets/index-Ct6xrK34.js` (1.18MB) 정책: (a) GitHub Actions 자동 빌드 + commit 또는 (b) Git LFS 또는 (c) release artifact + 별도 CDN. M2 시작 전 결정 필요 |

## 7. 일정 (보수)

| 단계 | 산출물 | 공수 |
|------|-------|------|
| M0 | 본 합의서 + 사전 작업 8건 | 1주 |
| M1 | floorplan-types/migration/bridge | 2주 |
| M2 | Top View + 1자형 + 90° 회전 | 3주 |
| M3 | 공간 추가 + ㄱ자 + 직각 트리밍 | 4주 |
| M4 | 자동계산 다중 공간 | 3주 |
| M5 | BOM 다중 공간 + LIVE 100건 비교 | 4주 |
| M6 | persistence 마이그레이션 + UI 정리 | 2주 |
| M7 | 회귀 매트릭스 + 알파 + 시범 발주 | 3주 |
| **합계** | | **18주, 풀타임 1.5~2명** |

**LIVE 배포 게이트**: M5 통과 전까지 LIVE 차단. feature flag로 v1/v2 동시 운영.

## 8. 위험 등록부 (사업 임팩트 순)

| 순위 | 위험 | 대응 |
|------|------|------|
| 1 | **BOM 정확도 회귀** — 발주 직결 | LIVE 100건 골든 마스터 + diff 도메인 사인 + M5 게이트 |
| 2 | secondary/tertiary 마이그레이션 의미 해석 | v1 BOM과 비교 검증 + 변환 실패 시 v1 보존 |
| 3 | 부동소수 좌표 오차 | 1mm 반올림 후 정수 비교 + 90° 스냅 |
| 4 | LIVE 사용자 세션 중 스키마 변경 | feature flag + 점진 배포 |
| 5 | Top View 회전 좌표계 버그 | M2 시각 회귀 50 케이스 |

## 9. 참고

- 마이그레이션 계획 원문: 이전 세션(plan agent) 산출물
- 점검 보고서: detaildesign / planner 점검 보고 (이전 세션)
- 영향 파일: §10 마이그레이션 계획 참조
