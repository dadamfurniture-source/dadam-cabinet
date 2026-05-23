# 다담 SketchUp 자동 마킹 도구 (dadam-mark)

> SketchUp 에서 작업한 가구를 dadamfurniture.com 의 planner UI 로 자동 가져오기 위한 outliner 마킹 도구.

## 무엇을 해결하는가

dadamfurniture 의 planner UI 에서 만든 가구는 SketchUp 으로 자동 빌드 + 자동 마킹돼서 다시 planner 로 가져올 수 있습니다 (Phase 1 옵션 1). 그러나:

- 디자이너가 **SketchUp 에서 직접 모델링**한 가구
- 또는 **외부 협업업체 SketchUp 파일** 이전

은 dadam.* outliner name 마킹이 없어 import 가 안 됐습니다.

본 plugin 은 SketchUp 메뉴를 통해 **수동 마킹** 또는 **template 기반 작업**을 지원합니다.

## 설치

### Windows
```
C:\Users\<이름>\AppData\Roaming\SketchUp\SketchUp 2026\SketchUp\Plugins\dadam_mark.rb
```

### macOS
```
~/Library/Application Support/SketchUp 2026/SketchUp/Plugins/dadam_mark.rb
```

복사 후 SketchUp 재시작.

## 사용

### 새 가구 (Template 사용)

1. 메뉴: **Extensions > 다담 자동 마킹 > 다담 Template 생성**
2. 6 preset Group 자동 생성 (각 카테고리 라벨 + 색상)
3. 메뉴: **현재 카테고리 설정** — 작업할 카테고리 지정 (예: sink)
4. 해당 Group 안으로 들어가 (더블 클릭) 가구 모델링
5. 작업한 Group/Component 들을 모두 선택
6. 메뉴: **선택 entity 마킹 (자동)** — dadam.{cat}.imported_TIMESTAMP_N 자동 설정
7. planner UI 에서 **"📥 SketchUp 에서 가져오기"** 클릭

### 외부 자료 이전 (cut-paste)

1. 기존 SketchUp 파일 열기
2. Template 의 적절한 Group (예: dadam.sink.template_placeholder) 안에 entity 들을 paste
3. 동일한 Group 안에서 정리/분류
4. 메뉴: **선택 entity 마킹 (자동)** 으로 일괄 마킹
5. planner UI 에서 가져오기

### 정밀 마킹 (partId 지정)

특정 part 의 의미를 명시하려면:

1. Entity 1개 선택
2. 메뉴: **선택 entity 마킹 (지정 partId)**
3. partId 입력 (예: `body-1`, `lower-door-3`, `toekick`, `molding-top`)
4. 결과: `dadam.{category}.{partId}` 로 outliner name 설정

다담 시스템이 인식하는 특별 partId:
- `toekick` — 걸레받이
- `molding-top` — 상몰딩
- `finish-left-lower` / `finish-right-lower` — 좌/우 하부 마감재
- `finish-left-upper` / `finish-right-upper` — 좌/우 상부 마감재
- `countertop` — 상판
- `utility-distributor` — 분배기
- `utility-vent` — 환풍구

위 partId 외에는 자동으로 모듈 본체로 분류됩니다.

## 메뉴 항목

| 메뉴 | 기능 |
|------|------|
| 다담 Template 생성 | 6 preset Group + 라벨 박스 생성 |
| 현재 카테고리 설정 | 다음 마킹 작업의 기본 카테고리 지정 |
| 선택 entity 마킹 (자동) | 선택된 모든 Group 에 timestamp 기반 partId 자동 설정 |
| 선택 entity 마킹 (지정 partId) | 1 Group 에 사용자 입력 partId 적용 |
| 현재 마킹 상태 확인 | dadam.* 마킹된 entity 수 확인 |
| 도움말 / 사용법 | 본 안내 메시지 |

## 검증

마킹 후 planner UI 에서 `📥 SketchUp 에서 가져오기` 클릭 → **신뢰도 ≥ 80%** 면 자동 가져오기 가능.

## 카테고리 목록

| ID | 용도 |
|----|------|
| sink | 싱크대 (주방) |
| wardrobe | 붙박이장 (침실) |
| vanity | 화장대 |
| shoe | 신발장 (현관) |
| fridge | 냉장고장 (주방) |
| storage | 범용 수납장 |

## 문제 해결

### plugin 메뉴가 안 보임
- 설치 경로 확인 (위)
- SketchUp 재시작
- 메뉴: Window > Extension Manager 에서 활성화 상태 확인

### "선택된 항목 중 Group/Component 가 없습니다"
- 면(Face) 또는 모서리(Edge) 만 선택된 상태. 먼저 entity 들을 Group 또는 Component 로 묶고 그 Group 을 선택하세요.

### 마킹 후 planner 가 가져오기 못함
- 신뢰도가 낮으면 미리보기 모달에 경고 표시. 카테고리/partId 가 일관적인지 확인.
- 정밀 마킹 (`지정 partId`) 으로 toekick/molding-top/finish-* 같은 구조물 명시.

## 버전

v1.0.0 (2026-05-23)
