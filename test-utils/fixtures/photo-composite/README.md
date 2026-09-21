# 사진 합성 실험 표본 (2026-09-22)

`test-utils/photo-composite-bench.html` 로 만든 첫 실측용 입력 두 장. 실사화·ControlNet 경로를 실제로 돌릴 때 패널에 넣는다.

| 파일 | 내용 |
|---|---|
| `composite-room.jpg` | 회사 포트폴리오 정면 주방 사진(왼쪽 판, 835×508) 위에 데모 도면(하부장 800·400·1000, 상부장 900·900, 런 2200)의 디테일 정면 입면을 벽 호모그래피로 얹고 음영·색을 맞춘 합성본. `room_image` 로 보낸다. |
| `control-edges.png` | 같은 화소 크기의 구조 조건 이미지 — 워프된 도면의 윤곽선(흰 선/검은 바탕). `control_image` 로 보낸다 (ControlNet 경로). |

벽 사각형 [[160,100],[492,100],[492,448],[160,448]]. 계획서 `docs/01-plan/photo-composite-research.plan.md` §4.6.
