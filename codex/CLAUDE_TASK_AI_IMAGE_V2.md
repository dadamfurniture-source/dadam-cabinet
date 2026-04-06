# Claude Task: AI Image Generation V2 — 구현 현황

이 문서는 AI 이미지 생성 개선 작업의 지시서 + 구현 현황이다.

---

## 구현 완료 항목

### 1. 색상 랜덤 조합 ✅

**구현 위치**: `dadam_multiagent/agents/tools/compositor_tools.py`

```python
_NEUTRAL_COLORS = [
    "sand gray flat-panel",
    "fog gray flat-panel",
    "milk white flat-panel",
    "cashmere flat-panel",
    "warm gray flat-panel",
    "ivory white flat-panel",
]

def _get_neutral_style() -> str:
    return random.choice(_NEUTRAL_COLORS)
```

- 기본 이미지: 무채색 6종 중 랜덤 (검정 제외)
- 대체 스타일: 하부장 컬러 6종 + 상부장 무채색 5종 랜덤 투톤
- 참고 이미지(ref_images) 비활성화 → 색상 고정 문제 해결

**대체 스타일 컬러 풀** (`orchestrator.py`):
- 하부장: deep green, deep blue, nature oak, walnut, ceramic gray, concrete gray
- 상부장: milk white, fog gray, sand gray, cashmere, ivory white

### 2. 위치 고정 ✅ (부분)

**현재 방식**: 3D Blender 렌더 → Gemini 가이드 이미지
- Layout Engine이 벽면 분석 결과로 모듈 위치 계산
- Blender가 3D 렌더 생성 (정확한 위치)
- Gemini에 3D 가이드 + 텍스트 프롬프트 전달
- 텍스트에 `At X% from left: sink/cooktop` 모듈 설명 포함

**한계**: Gemini가 가이드 이미지를 100% 따르지 않음 (개수대/쿡탑 위치 교환 발생)
**대응**: 테스트 이미지 품질 개선으로 벽면 분석 정확도 향상 시도 중

### 3. 프롬프트 현황 ✅

**기본 이미지 생성** (`compositor_tools.py:generate_closed_door`):
```
이 사진을 편집해: 사람, 공구, 공사 장비, 잔해를 제거해.
공사 중인 방이면: 바닥→마루, 천장→도배, 구멍→매립조명, 현대식 아파트로 마감.
기존 벽 타일과 백스플래시 유지.
{랜덤 무채색} {카테고리} 설치.
손잡이 없는 플랫 패널 도어, 핑거 그루브.
상부장 천장까지, 하부장 상판 포함, 벽 전체.
{모듈 배치 설명}
2번째 이미지 = 3D 레이아웃 가이드, 위치 정확히 복사.
싱크볼, 수전, 쿡탑, 후드를 새것으로 교체.
쿡탑은 매립형 빌트인 (평평, 상판 내장).
쿡탑 캐비닛: 아래 2단 서랍.
깨끗한 바닥.
```

**보정 패스** (`orchestrator.py:_correction_pass`):
```
쿡탑 아래 흰 영역에 동일 높이 서랍 2단 채우기.
쿡탑 매립형 유지.
카메라/원근감 동일. 나머지 동일. 깨끗한 바닥.
```

**대체 스타일** (`orchestrator.py`):
```
하부장 도어/서랍을 {컬러} 플랫 패널로 변경.
상부장 도어를 {무채색} 플랫 패널로 변경.
하부장과 상부장 반드시 다른 색 (투톤).
구조/레이아웃/위치/싱크/쿡탑 유지.
```

### 4. 벽면 분석 정확도 개선 ✅

**구현 위치**: `dadam_multiagent/agents/tools/measurement_tools.py`

- 듀얼 모델 교차 검증 (Claude Sonnet 4 + Gemini Flash 병렬)
- 이미지 1024px 리사이즈 (Vision 비용 75% 절감)
- 원근 보정 (focal_length 기반)
- 다중 높이 타일 카운팅 (3개 행 독립 측정)
- 수치 confidence (0.0~1.0) + tolerance 분기
- 배관 식별 프롬프트 강화 (앵글밸브, 플렉시블호스, 가려진 배관)

### 5. 견적 산출 ✅

- ㄱ자/ㄷ자/대면형 지원 (보조 벽면 모듈 + 상판 전체 합산)
- 코너 모듈 할증 20%
- 설치비 할증: ㄱ자 +20%, ㄷ자 +40%, 대면형 +30%
- AI 이미지 역분석 제거 → Layout Engine 직접 사용
- 실측 보정 테이블 (measurement_calibrations)

### 6. 공사 중 이미지 마감 ✅

- 시멘트 바닥 → 마루
- 노출 천장/목재 → 도배
- 천장 구멍 → 매립 LED 조명
- 공사 장비/잔해 제거

---

## 수정된 파일 목록

### 백엔드 (dadam_multiagent)
| 파일 | 변경 |
|------|------|
| `agents/orchestrator.py` | 듀얼 검증, 보정, 색상 랜덤, 참고이미지 비활성화, 프롬프트 |
| `agents/tools/compositor_tools.py` | 무채색 랜덤, 프롬프트, 새것 교체 |
| `agents/tools/measurement_tools.py` | **신규** — 듀얼 모델 검증 + 원근 보정 + 리사이즈 |
| `agents/tools/calibration_tools.py` | **신규** — 실측 보정 |
| `agents/tools/pricing_tools.py` | ㄱ자/ㄷ자/대면형 견적 |
| `agents/tools/image_tools.py` | JSON 스키마 강제 |
| `agents/prompts.py` | 다중 타일 카운팅, 배관 식별, ㄱ자/대면형 |
| `agents/blender/renderer.py` | 라벨 오버레이 (현재 비활성) |
| `db/migrations/007_measurement_calibration.sql` | **신규** — 보정 테이블 |

### 프론트엔드 (dadam-cabinet)
| 파일 | 변경 |
|------|------|
| `js/detaildesign/ai-design-report.js` | 대체 스타일 탭 + 다운로드 버튼 |

---

## 미구현 / 향후 작업

### payload 구조화 (작업 3 — 미구현)
- `layout_constraints` 구조화된 JSON payload 미적용
- 현재: 텍스트 프롬프트 + 3D Blender 가이드 이미지 방식
- 향후: MCP 서버 라우트에 `layout_constraints`, `mask_image` 전달

### 색상 UI
- `랜덤 색상 사용` / `색상 다시 뽑기` 버튼 미추가
- 현재: 서버 자동 랜덤 (로그에 선택 색상 기록)
- 향후: 프론트엔드에서 색상 미리보기 + 재선택 UI

### seeded random
- 현재: 요청마다 완전 랜덤 (`random.choice`)
- 향후: `design_id` 기반 seeded random으로 재현 가능하게

---

## 비용

| 항목 | 비용/건 |
|------|---------|
| 벽면 분석 (Claude + Gemini) | ~$0.45 |
| 가구 이미지 생성 (Gemini Image) | ~$0.04 |
| 보정 패스 (Gemini Image) | ~$0.04 |
| 대체 스타일 (Gemini Image) | ~$0.04 |
| **합계** | **~$0.57/건** |

---

## 완료 조건 체크

- [x] 색상 조합이 랜덤 선택된다
- [x] 선택된 색상이 프롬프트에 반영된다
- [ ] payload에 `layout_constraints` 구조화 (향후)
- [x] 싱크/쿡탑/후드 위치가 3D 가이드로 전달된다
- [ ] `maskImageBase64` 전송 (향후)
- [x] 기존 생성 흐름이 깨지지 않는다
