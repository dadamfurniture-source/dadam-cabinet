# W8-5: planner-vite UI SketchUp 2026 스타일 재구성 (3-column shell + collapsible panels)

> 이전 plan (W8-2) 은 단일 PR (#300) 머지 완료. W8-3 (fullscreen), W8-4 (UI 단순화) 도 완료. 본 plan 은 새 task — 사용자가 SketchUp 화면 캡처 (`tmp/sketchuptest/화면 캡처 2026-05-17 202114.png`) 참고로 layout 재구성 요청.

## Context

W8-4 후에도 캔버스 영역이 화면의 50% 정도. SketchUp 2026 의 핵심 UX 원칙:
1. **거대한 캔버스** (화면 75%+)
2. **우측 collapsible Tray** (재질/컴포넌트/스타일/...)
3. **좌측 icon-only toolbar** (48px)
4. **상/하단 bar minimal** (h:32-40)
5. **panel 들 접기/펴기 토글**

다담 워크플로우 (가구 카테고리 → 배치/구조/디테일) 와 자연스럽게 호환:
- 좌측 = 가구 카테고리 도구 모음 (싱크/벽장/냉장고/...)
- 우측 = 선택 모듈/구조 정보 + Hardware + BOM 미리보기 (4 collapsible sections)
- 메인 캔버스 = 60-75% 까지 확장
- TopBar h:56 → 40, BottomBar h:56 → 32

## 새 Layout ASCII

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar h:40 [📐배치─📦구조─🎨디테일] W:4200 H:2310 D:650 ⌬   │
├──┬────────────────────────────────────────────────────┬──────┤
│좌│                                                    │ ▼ 가│
│측│              메인 캔버스 (3D / 도면)                 │  구 │
│도│                  (flex: 1)                          │ 정보│
│구│                                                    │─────│
│  │                                                    │ ▼ 도│
│아│                                                    │ 어/ │
│이│                                                    │ 손잡│
│콘│                                                    │─────│
│ 48│                                                   │ ▶ 마│
│px│                                                    │ 감/ │
│  │                                                    │ 조명│
│  │                                                    │─────│
│«│                                                     │ ▶ BO│
│  │                                                    │ M미리│
├──┴────────────────────────────────────────────────────┴──────┤
│ BottomBar h:32  📤 보내기 📥 가져오기 | ⓘ 14 modules · 자동저장 │
└──────────────────────────────────────────────────────────────┘
```

## PR 시리즈 (W8-5-1 ~ W8-5-4)

### W8-5-1 — HTML mockup 작성 (사용자 확인 step)
**파일**: `tmp/layout-mockup.html` (정적 HTML+CSS+vanilla JS, ~340 LOC, 외부 의존 0)

기능:
- TopBar: StepIndicator pill + W/H/D 입력 + viewMode 토글 + 좌/우 panel 토글 버튼
- 좌측 도구 (48px): 싱크/쿡탑/후드/냉장고/식세기/하부장/상부장/키큰장/멍장/필러 아이콘
- 메인 캔버스: grid 배경 placeholder ("메인 캔버스 (3D / 도면)")
- 우측 패널 (280px): 4 collapsible sections (가구정보 / 도어·손잡이 / 마감·조명 / BOM 미리보기)
- BottomBar: SketchUp 보내기/가져오기 + status text
- 키보드 단축키: L (좌측 토글), R (우측 토글)

사용자가 브라우저로 확인 → OK 시 W8-5-2 진행.

### W8-5-2 — 컴포넌트 추출 (회귀 0)
**신규 파일**:
- `planner-vite/src/components/LeftToolbar.tsx` (~220 LOC)
  - 가구 카테고리 아이콘 (싱크/벽장/...) + incrementCategory 콜백
  - `collapsed: boolean` prop
- `planner-vite/src/components/RightPanel.tsx` (~320 LOC)
  - 4 collapsible sections
  - `collapsed: boolean` prop
- App.tsx 에 import 만 + placeholder 렌더 (기존 layout 유지)

### W8-5-3 — App.tsx return JSX 3-column shell 로 재구성
- TopBar h:56 → 40, BottomBar h:56 → 32
- 좌측 LeftToolbar (default 노출, 48px)
- 우측 RightPanel (default 노출, 280px)
- 메인 캔버스 flex:1
- 기존 viewMode/StepIndicator/W/H/D/SketchUp 버튼 모두 새 shell 의 적절한 슬롯

### W8-5-4 — 토글 + state 통합 + 단축키
- L/R 키보드 단축키 (input focus 시 무시)
- 우측 패널 4 sections 내부에 기존 ModuleDetailPanel / Hardware 기능 이관
- collapsed 상태 localStorage persist
- detaildesign.html 의 `.app-container` step2 padding 제거

## Critical Files

| 파일 | 변경 | LOC |
|------|------|-----|
| `tmp/layout-mockup.html` | 신규 (W8-5-1) | +340 |
| `planner-vite/src/components/LeftToolbar.tsx` | 신규 (W8-5-2) | +220 |
| `planner-vite/src/components/RightPanel.tsx` | 신규 (W8-5-2) | +320 |
| `planner-vite/src/App.tsx` | edit (W8-5-3) | +180 / -60 |
| `planner-vite/src/components/StepIndicator.tsx` | edit (W8-5-3) | +20 / -10 (compact prop) |
| `css/detaildesign/base.css` | edit (W8-5-4) | +30 / -20 |

## 검증

- **W8-5-1**: 사용자 브라우저로 mockup 열어 (a) 캔버스 면적 (b) 우측 4 sections 순서/내용 (c) 좌측 카테고리 목록 (d) 색상 톤 OK
- **W8-5-2/3**: vitest 88/88 통과 + Playwright data-testid 보존 (`step-indicator`, `dim-width/height/depth`, `view-mode-2d/3d`)
- **W8-5-4**: 단축키 input focus 가드 + localStorage persist
- **회귀**: Step 1 (detaildesign categoryGrid) 영향 0, Step 2 만 변경

## 즉시 시작 — W8-5-1

`tmp/layout-mockup.html` 작성:
- CSS 변수 (--brand-deep #6a4b2a / --brand-mid #b8956c / --bg-canvas #f4efe7 / ...)
- shell flex column h:100vh
- TopBar h:40 + step-pill + dim-group + view-toggle + panel-toggle
- mid flex (left-tools w:48 collapsible + canvas-wrap flex:1 + right-panel w:280 collapsible)
- BottomBar h:32 actions + status text
- JS: toggle 로직 + L/R 키보드 단축키 + 좌측 아이콘 클릭 badge 증가 데모

ExitPlanMode 후 즉시 작성 + 자동 브라우저 열기.

## 후속 cycle (Out of W8-5 scope)

- 모바일/태블릿 layout (좌측 bottom toolbar, 우측 bottom sheet)
- 단축키 확장 (1/2/3 step jump, Space = panel 모두 토글)
- AI 채팅 패널 통합 (5번째 section)
- App.tsx 분할 (ModuleBox/UtilityMesh/DimLabel → components/meshes/*)
