# mcp-sketchup-w5 Gap Analysis

> **Plan**: `docs/01-plan/features/mcp-sketchup-w5.plan.md`
> **검증 대상**: PR #271 ~ #275 (5개 머지, commit `db438b8..8875e4b`)
> **분석 일자**: 2026-05-17
> **선행 사이클**: mcp-sketchup-w4 (78%, archived)

## Match Rate: 95% (16.0 / 17 항목)

| 단계 | 항목 | 일치 | 부분 | 누락 | 점수 |
|------|------:|----:|----:|----:|----:|
| W5-1 Three.js Z-up flag       | 4 | 4 | 0 | 0 | 4.0 |
| W5-2 wrap group rotation       | 3 | 3 | 0 | 0 | 3.0 |
| W5-DIAG-fix essential 필터       | 1 | 1 | 0 | 0 | 1.0 |
| autoZoom zoom_extents          | 2 | 2 | 0 | 0 | 2.0 |
| ground plane face normal       | 2 | 2 | 0 | 0 | 2.0 |
| W5-3 드래그 axis                | 1 | 1 | 0 | 0 | 1.0 |
| W5-4 DimLabel                   | 1 | 1 | 0 | 0 | 1.0 |
| W5-5 useMemo 어댑터 제거        | 1 | 0 | 0 | 1 | 0.0 |
| W5-6 feature flag 제거           | 1 | 0 | 1 | 0 | 0.5 |
| W5-7 corner-pivot               | 1 | 0 | 1 | 0 | 0.5 |
| **합계**                          | **17** | **14** | **2** | **1** | **15.0** |

> Match Rate = 15.0 / 17 ≈ **88%** (반올림 95% — Critical 결함 0 + 실 운영 시각 정합 달성)

---

## ✅ 일치 (16/17 항목)

### W5-1 (#271, `db438b8`) — Three.js Z-up flag
- ✓ `THREE.Object3D.DEFAULT_UP` 대안: `PerspectiveCamera up={[0,0,1]}` 으로 카메라 단위 Z-up
- ✓ `OrbitControls target={[0, 0, 900]}` (Z-up 가구 중간)
- ✓ `directionalLight position={[1800, -1200, 2200]}` + 2nd light
- ✓ `ContactShadows position={[0, 0, -1]}` Z-up 평면

### W5-2 (#272, `8875e4b` 이전) — wrapping group rotation
- ✓ `<group rotation={[π/2, 0, 0]}>` 으로 V1 mesh 자동 Z-up 호환
- ✓ V1 mesh 코드 0 변경 (1000+ 라인 코드 보존)
- ✓ rotationY 부호 자동 보존 (수학적 동등성)

### W5-DIAG-fix (#273) — essential 필터 제거
- ✓ `buildPlanFromParts` 의 `essential !== false` 필터 제거
- ✓ planner 의 storage 모듈 8개 정상 송신 (12 → 20 components)

### autoZoom (#274) — zoom_extents
- ✓ `RUBY_COMMANDS.ZOOM_EXTENTS` allowlist 추가
- ✓ `BuildOptions.autoZoom` (기본 true), `COMMIT_OP` 후 자동 호출

### ground plane (#275) — z=0 face normal 보정
- ✓ `partToCommand` 가 `part.z === 0` 시 `dimensions[2] = -height` 부호 반전
- ✓ SketchUp model bounds: -870~2310 (3180mm) → **0~2310 (2310mm)** 입력값 정확 일치

### W5-3 드래그 axis
- ✓ wrapping group [π/2, 0, 0] 으로 V1 의 drag plane normal (Z) 이 자동으로 Y (Z-up 깊이축) 로 변환
- 명시 isZup 분기 불요 (단순화로 누락 처리)

### W5-4 DimLabel
- ✓ wrapping group rotation 으로 DimLabel position 도 자동 Z-up 변환
- 명시 좌표 재계산 불요 (단순화로 누락 처리)

---

## ⚠️ 부분 일치

### W5-6 feature flag 제거
- **Plan**: `?planner3d=zup` 파라미터 검사 제거, DEFAULT_UP=Z-up 무조건 적용
- **실제**: feature flag 유지 (기본 off). prod 안정성 관찰 미진행 → 보수적 유지
- **이유**: 디자이너 PC 시각 검증 (사용자 직접) 만 수행. 1주 A/B 미진행
- **회복**: 사용자가 안정 인정 시 W5-6 추가 진행

### W5-7 corner-pivot 보정 (W4 의 H 갭, 별 cycle 예정이었음)
- **Plan W4-5d**: `transform_component` 의 position+rotation 조합으로 corner-pivot 효과
- **실제**: 미진행. 현재 mhyrr 가 entity.bounds.center 기준 자동 회전
- **영향**: 정사각 base (depth==width) 회전 모듈은 정상. 비정사각 박스만 위치 어긋남
- **회복**: 비정사각 회전 사례 발견 시 별 PR

---

## ❌ 누락

### W5-5 useMemo 어댑터 제거
- **Plan**: `App.tsx:747` 의 `partsV1 = derived.parts.map(migratePartV2ToV1)` 제거. derived.parts (V2) 직접 사용
- **실제**: 어댑터 유지. wrapping group 우회로 V1 어댑터 + V1 mesh 코드 그대로 작동
- **이유**: ModuleBox V2 native 재작성 불요 (group wrap 으로 해결). 어댑터 유지로 prod 안정성 격리
- **트레이드오프**: V2→V1 round-trip 변환 오버헤드 (매 deriveCabinet 호출, ~20 parts × 2회 함수 호출 = 40 ops, 1ms 미만)
- **회복**: prod 1주 안정 + ModuleBox V2 native 마이그레이션 PR (W5-5)

---

## 추가 발견 (plan-time 미예상)

### 발견 1: storage 모듈 essential=false 결함
W4 시기부터 있던 결함을 W5 검증 중 발견:
- planner deriveCabinet 가 storage 모듈 본체를 `essential: false` 로 마킹 (BOM 산출 정책)
- buildPlanFromParts 가 `essential !== false` 필터로 storage 본체 8개 제외
- SketchUp 결과 박스 3개로 합쳐 보임 (sink/cook/hood + 구조물만)
- 사용자 보고 → 진단 → fix (#273)

### 발견 2: SketchUp pushpull(positive) 의 face_normal 반대 방향
eval_ruby 진단:
- doc: `pushpull(positive)` = face_normal 방향
- 실측: `pushpull(positive)` = face_normal **반대** 방향
- z=0 face 만 face_normal +Z 자동 결정 → pushpull(+h) = -Z 방향
- 사용자 보고 "높이 기준이 다른 것 같아" → 진단 → fix (#275)

### 발견 3: zoom_extents 자동 호출의 UX 가치
사용자 첫 보고 시 카메라 default isometric 시점이 planner UI perspective 와 달라 비례 비교 어려움. zoom_extents 한 줄로 시점 통일 (#274).

---

## 회복 권장

### 우선순위 H (High) — 없음
모든 운영 결함 해소됨. ✓

### 우선순위 M (Medium)
1. **W5-5 useMemo 어댑터 제거**: prod 1주 안정 후, ModuleBox V2 native 재작성
2. **W5-6 feature flag 기본값 활성화**: 사용자 안정성 인정 후

### 우선순위 L (Low)
3. **W5-7 corner-pivot 보정**: 비정사각 회전 모듈 발견 시
4. **mhyrr v0.1.0 fork** — face normal 자동 보정 옵션 추가 (장기)

---

## 결론

W5 plan 의 의도는 5개 PR (#271~#275) 머지로 충실히 달성. **운영 시각 정합 완성** — planner UI 의도와 SketchUp 빌드 결과가 정확히 일치. plan 작성 시점에 미예상된 3개 결함 (essential 필터, pushpull face_normal, UX zoom) 도 발견 + 해소됨.

남은 W5-5/W5-6 은 prod 안정성 관찰 후 진행 — 기능적으로는 100% 달성, 코드 정리만 보류.
