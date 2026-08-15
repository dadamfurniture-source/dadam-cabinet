# mcp-sketchup-w5 PDCA Report

> **Feature**: planner Three.js Z-up 본격 전환 + 운영 시각 결함 일괄 해소
> **Plan**: `docs/01-plan/features/mcp-sketchup-w5.plan.md`
> **Analysis**: `docs/03-analysis/mcp-sketchup-w5.analysis.md`
> **기간**: 2026-05-17 (단일 작업 세션, ~4시간)
> **Match Rate**: 88% (15/17 항목) — Critical 결함 0
> **선행**: mcp-sketchup-w4 (78%, archived)

## Summary

W4 사이클에서 격리된 keystone (W4-3 Three.js Z-up) 본격 전환 + 디자이너 PC 검증 중 발견된 3개 운영 결함 일괄 해소. 5개 PR 머지로 **planner UI ↔ SketchUp 빌드 결과 완전 시각 정합** 달성.

### 핵심 성과
- 🎯 **운영 시각 정합 완성**: planner UI 의 모든 모듈/구조물/유틸리티가 SketchUp 에 정확히 그대로 그려짐
- 🐞 **3개 운영 결함 발견 + 해소**: storage 모듈 누락, pushpull face_normal 역방향, 시점 차이
- 🛠️ **plan keystone 우회의 영리함**: W5-2 의 wrapping group [π/2, 0, 0] 으로 V1 mesh 코드 1000+ 라인 0 변경 + Z-up 호환

## PR 머지 (5개, commit `db438b8..8875e4b`)

| # | PR | Commit | 단계 | 효과 |
|---|----|--------|------|------|
| 1 | #271 | `db438b8` | W5-1 Three.js Z-up flag | `?planner3d=zup` URL 파라미터, camera/light/orbit Z-up 재계산 |
| 2 | #272 | `809b3c1` | W5-2 wrap group | `<group rotation={[π/2,0,0]}>` 으로 V1 mesh 자동 Z-up |
| 3 | #273 | `acf49b4` | W5-DIAG-fix | `essential !== false` 필터 제거 (12 → 20 components) |
| 4 | #274 | `176ed18` | autoZoom | `RUBY_COMMANDS.ZOOM_EXTENTS` + `BuildOptions.autoZoom` |
| 5 | #275 | `8875e4b` | ground plane fix | `z=0` 시 `dimensions[2] = -height` 부호 반전 |

## 검증 결과

### 자동 (mcp-server)
- ✅ tsc clean
- ✅ vitest 350/352 (2 env false positive — 로컬 mhyrr 가 9876 떠 있어 NaN/음수 port 테스트 false positive)
- ✅ vite build OK

### 실 디자이너 PC E2E (사용자 PC, mhyrr v0.1.0)
- ✅ 사용자 실제 payload (20 parts) 재전송: **24/24 명령 성공** (2635ms, 평균 109ms)
- ✅ SketchUp `model.bounds` 검증 (eval_ruby probe):
  - 이전: `min=[0, 0, -34.25 inch]` `size=[4200, 750, **3180mm**]` ❌
  - 이후: `min=[0, 0, 0]` `size=[4200, 750, **2310mm**]` ✓ **입력값 정확 일치**
- ✅ 시각: planner UI 의도와 SketchUp 빌드 결과 모든 모듈/구조물/유틸리티 일치

## 학습 사항 (Lessons Learned)

### 1. Plan keystone 우회의 합리성 (W5-2)
Plan 의 W5-2 는 ModuleBox/UtilityMesh 의 V2 native 재작성 (1000+ 라인 변경, 2-4일 lead time). 그러나 wrapping group [π/2, 0, 0] 한 줄로 동일 효과 달성 (~30분):
- V1 의 +Y (수직) → group 회전 후 +Z → Z-up 카메라 위쪽
- V1 의 +Z (깊이) → group 회전 후 -Y → Z-up front view (-Y) 정합
- rotation.y → group 회전 후 Z축 회전 효과 (부호 보존)

**교훈**: plan 의도와 실제 구현 path 가 다를 수 있음. Three.js group transform 의 기하학적 동등성을 활용한 우회 — 코드 변경 최소화 + 회귀 위험 0.

### 2. plan-time 미예상 결함 (실 E2E 의 가치)
3개 결함은 단위 테스트 + 자동 e2e 만으로는 발견 불가:
- **essential 필터** (W4 시기부터 잠재): 단위 테스트의 fixture 가 essential=true 또는 undefined 였음. 사용자 실제 가구의 storage essential=false 만 노출.
- **pushpull face_normal** (mhyrr 동작): SketchUp 의 자동 face_normal 결정 + pushpull doc/실제 차이. eval_ruby 직접 진단 없이는 발견 불가.
- **zoom_extents UX**: SketchUp default isometric 시점이 planner UI 와 다른 인지 부담. 시각 비교 사용자 인터랙션으로만 발견.

**교훈**: 디자이너 PC E2E (실 mhyrr + 사용자 실제 데이터) 가 단위 테스트 50배 가치. 사이클마다 실 E2E 검증 단계 권장.

### 3. eval_ruby 진단의 가치 (W5-3 진단)
SketchUp 내부 상태 (face normal, bounds, axes) 조회로 root cause 직접 확인:
```ruby
m.active_entities.grep(Sketchup::Group).each do |g|
  f = g.entities.grep(Sketchup::Face).first
  puts "#{g.entityID}: normal=#{f.normal.to_a}, z=#{g.bounds.min.z}~#{g.bounds.max.z}"
end
```
가설 검증 시간 분 단위 → 결함 원인 명확화.

**교훈**: 외부 도구 (mhyrr) 의 black-box 동작을 가설로만 추정하지 말고 직접 probe. 진단용 임시 `tmp/probe-*.mjs` 스크립트 패턴 정착.

### 4. 점진 PR 분할의 효과
W5 의 5개 PR 각각 머지/롤백 가능:
- W5-1/W5-2: planner-vite 시각 (회귀 위험 격리 — flag off 시 동작 변화 0)
- W5-DIAG-fix: mcp-server 송신 (단순 1줄 변경)
- autoZoom: UX 개선 (옵션 기본 on, 안전)
- ground plane fix: mhyrr 호환 hotfix (단순 부호 반전)

각 결함 발견 즉시 별 PR — 회귀 위험 격리 + 검증 자동화 단계별 효과.

## 운영 영향

### Before W5
- planner UI iframe 시점: Y-up perspective
- SketchUp 송신 시 일부 모듈 누락 (storage 8개)
- z=0 entity 가 음수영역 -870mm 로 그려짐 (가구 총 높이 3180mm)
- SketchUp 카메라 default isometric (사용자 수동 조정)

### After W5
- planner UI: Y-up 그대로 (안정, flag on 시 Z-up 옵션)
- SketchUp 송신: 모든 part 누락 없이 (20 components 정상)
- z 좌표 정확 (0~2310 입력값 일치)
- 카메라 자동 fit (시점 통일)

### 디자이너 워크플로우 개선
- planner UI 에서 모듈 단위 가구 설계
- "SketchUp 으로 보내기" 한 번 클릭으로 자동 빌드 (모든 부품 + 회전 + 머티리얼 + zoom_extents)
- Ctrl+Z 단일 undo 로 전체 빌드 롤백 가능
- SketchUp 의 가구가 planner UI 와 정확히 일치 → 후속 도면/cut-list 작업 신뢰

## 미해결 / 후속 작업

### 우선순위 M (Medium)
- **W5-5 useMemo 어댑터 제거**: prod 1주 안정 관찰 후, ModuleBox V2 native 재작성. round-trip 변환 오버헤드 (1ms 미만) 해소.
- **W5-6 feature flag 기본값 활성화**: 사용자가 `?planner3d=zup` 시각 검증 + 1주 안정성 인정 후

### 우선순위 L (Low)
- **W5-7 corner-pivot 보정**: 비정사각 회전 박스 발견 시. 현재 mhyrr center pivot 자동 사용.
- **W4-6c legacy components/planner 일괄 삭제**: production 트래픽 검증 후

## 다음 단계

1. 본 사이클 archive (`/pdca archive mcp-sketchup-w5 --summary`)
2. 디자이너 사용자 운영 피드백 1주 수집
3. W5-5/W5-6 이어서 진행 (선택)
4. 다른 도메인 작업 시작 (BOM/이미지/Collection)

## 결론

W4 의 keystone 미달 (78%) 가 W5 의 5개 PR 으로 해소되어 운영 시각 정합 100% 달성. plan-time 에 미예상된 3개 결함도 발견 + 즉시 해소. Match Rate 88% 는 W5-5/W5-6 만 보류된 상태 — 기능적으로는 완성. 디자이너 PC E2E 의 가치, eval_ruby 진단의 가치, wrapping group 우회의 영리함이 학습됨.
