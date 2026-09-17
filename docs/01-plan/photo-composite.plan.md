# 배경 사진 합성 렌더 계획 (울트라플랜)

> 작성: 2026-09-16 / 기준 커밋: `origin/main` (5d8126a 이후)
>
> 표기: **[확인]** 코드 근거 있음 (`파일:줄` 병기) · **[결정]** 이 계획이 정하는 것 ·
> **[확인 필요]** 사용자·현장만 답할 수 있는 것. 지어내지 않는다.

---

## 0. 한 문단 요약

디테일 단계에서 **방 사진을 올리고**, 사진 위 **바닥에 사각형을 맞추면**, 그 사각형과 배치 공간의
실제 치수로 **카메라를 역산**해 가구를 같은 원근으로 렌더링하고 사진 위에 합성한다.

핵심은 AI 가 아니라 **기하**다. 사각형 네 점 ↔ 실제 직사각형 네 점의 대응에서 호모그래피를 풀고,
거기서 초점거리와 카메라 자세를 얻는다. 그 카메라로 D3 의 오프스크린 캡처를 그대로 돌리면
투명 배경 PNG 가 나오고, 사진 위에 얹으면 끝이다. 여기에 **그림자 받개**를 깔면 가구가 바닥에
그림자를 드리워 합성 티가 크게 준다.

AI 는 마지막 선택 단계로만 쓴다 — 기하가 맞은 합성본의 **빛과 색만** 다듬는 용도다.
기존 연출컷 경로(`buildInstallPrompt`)는 **자리를 지정하는 입력이 없어** 모델이 위치를 정한다
(`workers/generate-api/src/prompts.js:207-242`) [확인]. 그래서 이 기능은 그 경로를 고치는 것이
아니라 새로 만드는 쪽이 맞다.

---

## 1. 현재 상태 [확인]

### 1.1 그대로 쓸 수 있는 것

| 자산 | 내용 | 근거 |
|---|---|---|
| 오프스크린 캡처 | 화면 카메라·컨트롤을 건드리지 않고 **별도 카메라**로 렌더타깃에 그려 PNG 를 만든다 | `js/planner/planner-capture.js:442-513` (`capturePixels`), 카메라 생성 `:469-474` |
| 렌더러 알파 | `WebGLRenderer({ alpha: true })` 로 이미 만들어져 있다 | `mockup-structure.html:5949` |
| 프레이밍 수학 | `plannerCaptureFrame(kind, bounds, aspect)` → `{fov, aspect, position, target, up, near, far}` — **합성 카메라도 같은 모양으로 내면 그 뒤 배관이 전부 재사용된다** | `planner-capture.js:229-274` |
| 저장 배관 | 비공개 버킷 업로드 → 행 삽입 → 실패 시 객체 롤백, 서명 URL 목록 | `planner-store.js:500-560`, `database/design-renders.sql` |
| 비공개 버킷 정책 | `renders` 는 경로 첫 칸 = `designs.id`, 소유자 RLS + 관리자 조회 | `design-renders.sql:95-150` |
| 실시간 재질 | 예림 자재 텍스처·광택 (D2) | `planner-materials.js:156-200` |
| 우측 패널 규약 | `data-sec` 섹션 + `PANEL_SEC_TITLE` + 디테일 모드 CSS 예외 | `mockup-structure.html:506-513`, `:3019-3024`, `planner-detail.js:94-95` |
| 상태 복원 규율 | `applyScene(on)` 이 바꾼 것만 저장·복원, `pushLook/popLook` | `planner-detail.js:406-453`, `:1029-1053` |
| 개인정보 동의·삭제 | `generations.consent_training`, 방 사진은 이미 `license:'user-uploaded'` + `needs_review` 로 학습 차단 | `dataset-schema.sql:31-32`, `workers/dataset-api/src/adapters.js:142-159` |

### 1.2 없는 것 — 전부 새로 만든다 [확인]

`homography` · `vanish` · `solvePnP` · `unproject` · `EXIF` · `createImageBitmap` · 가림(occlusion) —
저장소 전체에서 **0건**. `applyMatrix4` 한 곳(`planner-capture.js:311`, Box3 변환)이 전부다.

### 1.3 좌표계 [확인]

- **Y-up, 단위 mm, 배율 없음.** 바닥은 `y = 0`.
- 평면 좌표 `(x, plan y)` → 3D `(x − originPos2D.x, height, plan y − originPos2D.y)`
  (`mockup-structure.html:5887-5902`, `renderAll3D` `:7318-7334`).
- 배치 공간의 바닥 사각형 = `planeBoxOf(area)` 에서 원점 오프셋을 뺀 것, 정면 방향은 `−rotation.y`
  (`renderAreas3D` `:7243-7266`, `planeBoxOf` `:1741-1749`).
  **이것이 사진 속 사각형과 짝지을 실제 직사각형이다.**

### 1.4 합성을 방해하는 것 — 반드시 처리 [확인]

| # | 걸림돌 | 근거 | 처리 |
|---|---|---|---|
| G1 | `scene.background` 가 불투명 베이지 | `:5956` | 합성 렌더 동안만 `null` (push/pop) |
| G2 | 픽셀 읽기가 **알파를 255 로 덮는다** | `planner-capture.js:343` | 투명 배경 옵션을 인자로 분기 |
| G3 | 카메라를 OrbitControls 가 소유, 매 프레임 `controls.update()` | `:5983`, `:6029` | 화면 카메라를 건드리지 않고 **별도 카메라**로만 렌더 (캡처 선례 `:469`) |
| G4 | 리사이즈·뷰 전환이 `camera.aspect` 를 덮어쓴다 | `:6022`, `:7048` | 같은 이유로 별도 카메라 |
| G5 | 바닥판·그리드가 scene 자식 | `:5972-5980` | 합성 중 숨김. 그림자 받개는 `entityKind:'shadow-catcher'` 로 표시해 바운즈에서 제외 |
| G6 | `applyScene` 은 조명 **세기만** 저장, 위치는 안 저장 | `planner-detail.js:423` | 빛 방향을 바꾸려면 저장 목록을 넓히거나 자체 save/restore |
| G7 | `keepDoorEdgesVisible` 가 매 프레임 화면 기준으로 도어 테두리 크기를 바꾼다 | `:6839-6854` | 합성 렌더에서는 테두리를 끈다 (사진 위 검은 선은 만화처럼 보인다) |

---

## 2. 목표와 완료 정의

1. 방 사진을 올리고 바닥 사각형을 맞추면 **가구가 그 자리에 원근이 맞게** 보인다.
2. 가구가 바닥에 **그림자**를 드리운다.
3. 합성컷을 **계정에 저장**하고 내 설계·작업지시서·고객확인서에서 볼 수 있다.
4. 앞에 놓인 물건(아일랜드·기둥)에 **가려지게** 할 수 있다.

**완료**: 실제 주방 사진 3장으로 합성했을 때, 가구 밑선이 바닥선과 어긋나 보이지 않고,
재투영 오차(아래 §4.2)가 사진 긴 변의 1% 안에 든다.

---

## 3. 이 계획이 하지 않는 것

- 사진에서 벽·바닥을 **자동으로** 찾지 않는다. 사각형은 사람이 맞춘다 (1단계 기준).
- 렌즈 왜곡 보정, 여러 장 합성(파노라마), 동영상.
- 기존 연출컷(`ai-design.html`) 경로 변경. 그쪽은 그대로 둔다.

---

## 4. 핵심 설계 [결정]

### 4.1 왜 호모그래피인가

사용자가 사진 위에 찍는 네 점은 **바닥 위 직사각형**의 네 귀퉁이다. 그 직사각형의 실제 크기는
배치 공간에서 이미 안다(`planeBoxOf(area)`). 평면 ↔ 평면 대응 네 쌍이면 호모그래피 `H` 가 유일하게
정해지고, `H` 하나에서 **초점거리와 카메라 자세가 모두** 나온다. 별도 측정도, 기계학습도 필요 없다.

### 4.2 `js/planner/photo-solve.js` (신규, 순수 함수) — 이 기능의 심장

```
plannerPhotoHomography(src[4], dst[4])        // 8×8 선형계. 의존성 없이 직접 푼다
plannerPhotoFocal(H)                          // 두 소실점의 직교 조건 → f. 못 구하면 null
plannerPhotoPose(H, f, cx, cy)                // → { R, t } (평면 자세 분해, r3 = r1×r2, 스케일·부호 정규화)
plannerPhotoCamera(quad, rectMm, imgW, imgH, opt)
      // → plannerCaptureFrame 과 **같은 모양** { fov, aspect, position, target, up, near, far }
      //   + { f, method: 'vanishing'|'assumed', reprojectionPx, flipped }
plannerPhotoReproject(camera, rectMm, imgW, imgH)   // 실제 사각형을 다시 사진에 투영 → 오차 px
plannerPhotoQuadSane(quad)                    // 볼록·시계방향·최소 넓이 검사
```

- **초점거리**: 사각형 두 쌍의 변에서 소실점 둘을 구하고 직교 조건으로 `f` 를 얻는다.
  변이 거의 평행하면(소실점이 무한대) 수치가 터지므로 **`method:'assumed'` 로 떨어지고**
  기본 화각(수평 60°)을 쓴다. 이때 UI 는 화각 슬라이더를 연다. 숨기지 않는다.
- **검증 가능성**: 알려진 카메라로 사각형을 투영해 네 점을 만들고, 그 네 점만으로 다시 풀어
  원래 카메라가 나오는지 본다. **GPU 없이 완전히 단위 시험이 된다** — 이 계획에서 가장 중요한 성질이다.
- 재투영 오차 `reprojectionPx` 를 항상 화면에 보여 준다. 사용자가 "맞았는지" 를 숫자로 안다.

### 4.3 합성 파이프라인

```
사진(원본)  ─┐
             ├─ 같은 카메라 ─→ 가구 + 그림자 렌더(투명 배경 PNG 한 장) ─→ 2D 캔버스 합성 → PNG
바닥 사각형 ─┘
```

**2026-09-17 정정 (P2 구현에서).** 이 절은 원래 "가구와 그림자를 **따로** 뽑는다" 였다.
이유는 "다시 렌더하지 않고 슬라이더로 그림자 세기를 바꾸려고" 였는데, **P2 가 그것을 실시간
슬라이더로 해결했다** — `ShadowMaterial.opacity` 를 바꾸면 다음 프레임에 바로 반영된다.
그러므로 **한 번만 그린다**:

- 렌더러가 `alpha:true` 이고(`mockup-structure.html:5949`) 합성 중에는 `scene.background = null`
  이므로, 투명 배경 한 장에 **가구와 그림자가 알파까지 맞게 함께** 담긴다. 두 장을 뽑아 겹치는
  경로는 코드도 두 벌이고 알파 합성 순서가 한 군데 더 늘 뿐이다.
- 그림자 받개: `y=0` 평면 + `ShadowMaterial`. `entityKind:'shadow-catcher'` 로 표시해
  `plannerCaptureBoundsOf`(`:299-318`)의 바운즈 계산과 디테일 칠하기에서 빠지게 한다.
- 합성 캔버스 크기 = 사진 원본 크기(긴 변 4096 상한). 렌더도 같은 크기·같은 종횡비.

### 4.4 데이터 모델 [결정]

**새 표** `design_backgrounds` — 사진 한 장 + 그 사진에서 푼 모든 것.

| 컬럼 | 뜻 |
|---|---|
| `id`, `design_id`(→designs, cascade), `item_unique_id` | 스코프. `design_renders` 와 같은 규약 |
| `path`, `width`, `height` | 비공개 버킷 `backgrounds` 안의 원본 사진 |
| `quad jsonb` | 사진 위 네 점 (0~1 정규화 — 사진을 줄여도 안 깨진다) |
| `plane jsonb` | `{ kind:'floor', areaId, rectMm:{w,d}, originMm:{x,z}, rotation }` — 어느 배치 공간의 바닥인가. **바닥 고정** (2026-09-17 결정) |
| `camera jsonb` | 푼 결과. `plannerCaptureCameraJson` 과 같은 모양 + `f, method, reprojectionPx` |
| `light jsonb` | `{ azimuthDeg, elevationDeg, intensity, ambient, shadowOpacity, shadowSoftness }` |
| `grade jsonb` | `{ exposure, temperature, tint }` — 렌더를 사진 톤에 맞추는 값 |
| `occluders jsonb` | 가림 다각형 배열 (정규화 좌표) |
| `created_at`, `updated_at` | |

**합성 결과**는 새 표를 또 만들지 않는다. `design_renders` 에
`kind='composite'` 를 더하고 `background_id uuid` 컬럼을 추가한다 — 목록·서명 URL·작업지시서 배관이
그대로 따라온다 (`design-renders.sql:29-53`, `planner-store.js:540-560`).

**새 버킷** `backgrounds` (비공개). 정책은 `renders` 를 그대로 베낀다 — 경로 첫 칸이 `designs.id`,
소유자 select/insert/delete + 관리자 select (`design-renders.sql:105-150`).

### 4.5 개인정보 [결정]

방 사진은 개인정보다. 새로 만들지 않고 **이미 있는 길**을 쓴다.

- 버킷은 **비공개**. 읽기는 서명 URL 만 (`planner-store.js:555-556`).
- 학습 사용은 기본 **불가**. `license:'user-uploaded'` + `needs_review` 로 이미 막혀 있고
  (`workers/dataset-api/src/adapters.js:142-159`), 동의는 `consent_training` 한 곳으로 모은다.
- 삭제: 설계를 지우면 `ON DELETE CASCADE` 로 행이 지워지고, **Storage 객체도 같이 지우는 경로를
  이 계획에서 만든다** — 지금 계정 삭제는 객체를 쓸지 않아 파일이 고아로 남는다 [확인].
- 공유 링크(`design-share.html`)에는 **합성컷을 기본으로 넣지 않는다.** 방 사진이 공개 버킷을 통해
  퍼지는 일이 없어야 한다 [결정].

### 4.6 AI 마무리는 선택이고 마지막이다 [결정]

기하 합성이 끝난 뒤에만, 사용자가 원할 때. 합성본을 첫 이미지로 넣고 "기하를 바꾸지 말고
빛과 그림자만 맞춰라" 로 지시한다. 새 잡 종류 `composite-polish` 를 `generate-api` 에 더한다.

- **위험**: 모델이 가구 모양·치수를 바꿀 수 있다. → 합성본과 결과를 **나란히** 보여 주고
  사용자가 고르게 한다. 자동 교체 금지.
- **비용**: `consume_credit` 은 모르는 action 을 만나면 **조용히 `generate` 값(20)으로 떨어진다**
  (`database/credit-amounts.sql:61-62`) [확인]. 그러므로 `credit_costs` 에 행을 반드시 **먼저** 넣는다.
  기하 합성 자체는 브라우저에서 끝나므로 **0 크레딧**이다.

---

## 5. 단계별 로드맵

각 항목: 목표 → 파일 → 시험 → 완료 기준 → 브랜치. 크기는 PR 기준(S ≤ 300줄, M ≤ 800, L 그 이상).

### P0. 카메라 역산 수학 (M) `agent/photo-solve-core`
- `js/planner/photo-solve.js` — §4.2 함수들. DOM·three 의존 없음.
- 시험 `__tests__/photo-solve.test.js`: **왕복 시험**(알려진 카메라 → 네 점 → 역산 → 같은 카메라,
  위치 오차 1mm·각도 0.01° 이내), 화각 20~90° · 높이 1.2~2.5m · 각도 여러 조합,
  평행 변(퇴화) → `method:'assumed'`, 오목·뒤집힌 사각형 거부, 재투영 오차 계산 정확도.
- 완료: GPU 없이 전부 통과. **UI 는 아직 없다.**

### ~~P1. 배경 올리기 · 사각형 맞추기~~ (L) `agent/photo-background-ui` — **완료 (2026-09-17)**

설계 문서: `docs/02-design/features/photo-mode.md`. 파일: `js/planner/photo-bg.js`(상태·사진·계산) ·
`js/planner/photo-mode.js`(화면). `mockup-structure.html` 은 연결만 한다.

**2026-09-17 결정이 이 단계의 모양을 정했다** — 바닥 사각형은 가구가 설 **대략적인 위치**만 표시한다.
가구의 치수는 언제나 배치 공간에서 온다 (§9-2). 그러므로 사용자에게 정밀하게 찍으라고 요구하지 않고,
**합성을 즉시 보여 주고 밀어서 맞추게** 만드는 것이 P1 의 일이었다. 근거는 P0 의 측정이다:
±3px 손떨림 = 3600×700 에서 262mm 어긋남, 2400×1500 에서 62mm (`photo-solve.md`).

- 우측 패널 새 섹션 `data-sec="photo"` (§1.1 규약대로 3곳 수정) + `.pd-only` 도구막대 버튼.
- 사진 올리기: 드래그·파일 선택. **EXIF 방향 정규화** — APP1 블록을 직접 읽고, 브라우저가 이미
  돌려 디코딩했으면 손대지 않는다(저장 크기 ↔ 디코딩 크기 비교). 긴 변 4096 축소 + JPEG 0.9 재인코딩.
- 3D 캔버스 **뒤에** 사진 `<img>`, `scene.background = null` 로 알파 버퍼에 비친다 (G1).
- 카메라는 화면 카메라를 쓰지 않는다 — **별도 카메라**로 사진 종횡비의 레터박스 안에만 그린다 (G3·G4).
  궤도·줌은 끈다. 바닥판·그리드·원점 마커·도어 테두리는 숨기고 나갈 때 되돌린다 (G5·G7).
- 사각형 편집기: **이름표 붙은** 네 귀퉁이(뒤-좌 → 뒤-우 → 앞-우 → 앞-좌) + 원근 격자, 끌면 실시간 재해석.
  이름표는 필수다 — 180° 어긋난 순서는 재투영 오차가 정확히 0 이라 숫자로 못 잡는다. 물리 검사
  (바닥 아래·30m 밖·사각형 뒤·말도 안 되는 눈높이)를 함께 둔다.
- 미세조정(X·Z·회전)은 씬이 아니라 **사각형에 반대로** 얹는다 — 모듈 mesh 를 건드리지 않아 I1 이 안전하다.
- 화각: 퇴화(`assumed`)면 **자동으로 훑어** 재투영 오차가 가장 작은 값을 고른다(「자동 맞춤」 버튼도 같은 길).
  상태 한 줄에 등급과 재투영 오차를 항상 보여 준다.
- 완료: 사진 위에서 가구가 원근이 맞게 **화면에** 보인다. 저장은 아직 없다 (P3).
- 시험: `__tests__/photo-bg.test.js`(48) · `__tests__/photo-mode.test.js`(35) — 복원 스냅샷 대조 포함.

### ~~P2. 그림자 · 빛 · 톤~~ (M) `agent/photo-shadow-light` — **완료 (2026-09-17)**

설계 문서: `docs/02-design/features/photo-mode.md` 의 "P2" 절. 파일: `js/planner/photo-mode.js`(받개·빛·톤·패널) ·
`js/planner/photo-bg.js`(`light`·`grade` 상태). `planner-capture.js` 는 제외 이름표 한 줄만 늘었다.

- 그림자 받개 평면 + `ShadowMaterial`, 세기(불투명도)·부드럽기(`shadow.radius`) 슬라이더.
- 빛 방향(방위각 0~360° · 고도 5~85°) · 세기 · 채움. **조명 위치·타깃·그림자 설정 save/restore 를
  자체적으로** 한다 (G6) — `planner-detail.js` 의 저장 목록은 넓히지 않았다 (다른 도메인의 규율).
- 노출(`toneMappingExposure`)·색온도·틴트. 색온도는 렌더러 설정이 아니라 **조명 색**으로 얹는다.
  사진의 평균 밝기·색을 읽어 노출·색온도를 **제안**하고, 「사진에 맞추기」를 눌러야 들어간다.
- 도어 테두리 끄기 (G7) — P1 의 `animate` 분기와 `_hideProps` 가 이미 했다. 시험으로 못 박았다.
- **P2 에서 드러난 것**: three 의 `DirectionalLightShadow` 기본 프러스텀은 `(-5, 5, 5, -5, 0.5, 500)`
  이다. 이 씬의 단위는 mm 이므로 10mm 짜리 상자 — `castShadow` 를 켜 두었어도 **가구가 하나도 안
  들어가 그림자가 아예 안 나왔다.** 사진 모드는 그 프러스텀을 가구 바운즈에 맞춘다. (구조·디테일
  모드는 그대로 둔다 — 그쪽은 다른 PR 에서 정한다. §9-7 참고)
- 완료: 가구가 바닥에 붙어 보인다. 시험 `__tests__/photo-light.test.js`(50) + `photo-mode.test.js`(37).

### P3. 합성 저장 (M) `agent/photo-composite-save`
- `database/design-backgrounds.sql` — 새 표 + `backgrounds` 버킷 정책 + `design_renders.kind`
  CHECK 에 `'composite'` 추가 + `background_id` 컬럼. 멱등, 파괴 문장 없음, SQL 시험 동반.
- 투명 배경 캡처 (G2 분기), 2D 캔버스 합성, 업로드, 행 삽입.
- 우측 패널 "합성컷" 목록(서명 URL 썸네일).
- 완료: 저장 → 새로고침 → 같은 합성본이 다시 보인다.

### P4. 가림 영역 (M) `agent/photo-occluders`
- 사진 위 다각형 그리기 → 합성 때 그 영역에서 가구를 지운다(캔버스 `destination-out`).
- 완료: 앞에 놓인 아일랜드 뒤로 가구가 들어간다.

### P5. 문서·목록에 싣기 (M) `agent/photo-in-documents` — 워커 도메인
- 작업지시서 표지의 정면 렌더 옆에 합성컷 (`work-order.js:159-171`, 서명 URL 단계 `documents.js:320-327`
  가 **버킷 인자를 하나 더** 받아야 한다 [확인]).
- 고객확인서에 합성컷 — 그 템플릿에는 **이미지 표시가 아예 없다** [확인], 새로 만든다.
- `my-designs.html` 목록. 공유 링크는 제외 (§4.5).

### P6. AI 마무리 (선택, M) `agent/imggen-composite-polish`
- `credit_costs` 행 **먼저**. `generate-api` 새 잡 종류, 합성본을 첫 이미지로, 기하 유지 지시.
- 결과를 원본 합성본과 나란히 보여 주고 사용자가 고른다.

---

## 6. 순서와 병렬성

```
P0 ─ P1 ─ P2 ─ P3 ─┬─ P4
                   ├─ P5 (워커 도메인 — P3 의 표가 있어야 시작)
                   └─ P6 (선택)
```
P0~P4 는 같은 플래너 도메인이라 **순차**. P5 는 P3 이후 병렬 가능.
대략 P0 1 PR, P1 2~3, P2 1~2, P3 1~2, P4 1, P5 1~2, P6 1.

---

## 7. 시험 전략

| 층 | 무엇 | 도구 |
|---|---|---|
| 수학 | 카메라 역산 왕복, 퇴화, 재투영 오차 | jest, 순수 함수 (GPU 불필요) |
| 상태 | 사진 모드 진입·이탈이 씬을 **완전히** 되돌린다 (배경·조명·바닥·테두리·렌더타깃) | `bootPlanner3D` + 값 기록 가짜 렌더러 (`planner-capture.test.js` 방식) |
| 배관 | 경로·메타·업로드 롤백·서명 URL | 스텁 supabase |
| SQL | 멱등·파괴 문장 없음·정책 | `dataset-schema.test.js` 방식 |
| 불변 | 골든 페이로드 바이트 동일, 구조 모드 화면 불변, 원장 허용 목록 불변 | 기존 시험 |
| 픽셀 | **jsdom 에 WebGL 이 없어 불가** — 브라우저에서 사람이 확인 | 실사진 3장 기준 |

---

## 8. 리스크

| 리스크 | 대응 |
|---|---|
| 초점거리 추정이 평행 변에서 터진다 | `method:'assumed'` 로 떨어지고 화각 슬라이더를 연다. 재투영 오차를 항상 보여 준다 |
| 휴대폰 렌즈 왜곡으로 직선이 휜다 | 1단계에서는 한계로 문서화. 벽 끝처럼 왜곡이 큰 자리를 피해 사각형을 잡으라고 안내 |
| 사용자가 사각형을 대충 맞춘다 | 격자 겹쳐 그리기 + 오차 숫자 + "다시 맞추기" |
| 방 사진 유출 | 비공개 버킷, 서명 URL, 공유 링크 제외, 삭제 경로 (§4.5) |
| AI 가 가구를 바꿔 놓는다 | 자동 교체 금지, 나란히 보여 주고 사용자가 고른다 |
| 크레딧이 조용히 20 빠진다 | `credit_costs` 행을 먼저 넣는다 (§4.6) |
| `mockup-structure.html` 이 더 커진다 | 로직은 `js/planner/photo-*.js` 로, HTML 은 연결만. 전역 이름은 `PlannerPhoto*` 접두 |
| 다른 세션과 같은 파일 충돌 | 플래너 도메인 한 세션만 (CLAUDE.md) |

---

## 9. 사용자 결정 필요 [확인 필요]

1. ~~사각형을 어디에 맞추나~~ → **바닥** (2026-09-17 결정). 벽면 기준은 만들지 않는다.
   하부장이 바닥 앞 귀퉁이를 가리는 경우는 P1 에서 "가구 앞쪽 바닥" 대신 **가구가 설 자리 전체**를
   잡게 안내하고, 그래도 안 보이면 벽·바닥 경계선을 따라 뒤쪽 두 점을 먼저 찍게 한다.
2. ~~실제 치수의 출처~~ → **배치 공간에서 자동** (2026-09-17 결정). 손으로 넣는 칸은 두지 않는다.
3. **사진 보관 기간** — 합성이 끝나도 사진을 계속 두나, 며칠 뒤 지우나.
4. **공유 링크 노출** — 합성컷을 고객 공유 링크에 넣을지 (기본은 제외로 잡았다).
5. **AI 마무리 필요 여부와 가격** — 크레딧을 얼마로 매길지.
6. **기대 화질** — 화면 확인용(1K)인가, 인쇄·제안서용(4K)인가.
7. **구조·디테일 모드에도 그림자를 켤 것인가** (2026-09-17, P2 에서 발견). 지금 그 두 모드는
   그림자 카메라가 three 기본값(±5mm)이라 `castShadow` 를 켜 두고도 그림자가 없다. 사진 모드만
   고쳤다 — 평소 화면에도 그림자가 생기면 보기가 달라지므로 사장님이 볼 일이다.

---

## 10. 첫 주 실행 항목

§9 의 1·2 는 2026-09-17 에 정해졌다 (바닥 기준 · 치수는 배치 공간에서 자동). 나머지는 진행 중 받는다.

1. ~~`agent/photo-solve-core` (P0)~~ — 완료 (2026-09-17, `docs/02-design/features/photo-solve.md`).
2. 실제 주방 사진 3장을 기준 자료로 확보한다 (각도·밝기가 다른 것으로). **아직** — P1 까지는 GPU 없이
   시험으로 증명했지만, "가구 밑선이 바닥선과 어긋나 보이지 않는다"(§2 완료 기준)는 사람이 봐야 한다.
3. ~~`agent/photo-background-ui` (P1)~~ — 완료 (2026-09-17, `docs/02-design/features/photo-mode.md`).
4. ~~`agent/photo-shadow-light` (P2)~~ — 완료 (2026-09-17). 그림자 받개·빛·톤. §9-7 이 여기서 나왔다.
5. 다음은 `agent/photo-composite-save` (P3) — 저장. 지금은 새로고침하면 사진을 다시 올려야 한다.
