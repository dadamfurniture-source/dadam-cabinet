# 기본안 벽 채움 검사 (기록 전용)

- 만든 날: 2026-11-21
- 요청: 대표님 「위치 검사를 모든 품목에 적용하도록」
- 대표님 답:
  - 범위는 AI 연출컷만이고, 앱 플래너 연출은 넣지 않는다.
  - 품목 10개 모두에서 가구 양 끝과 위아래가 벽 · 천장 · 바닥에 닿았는지만 잰다.
  - 결과는 기록만 남긴다.
- 코드
  - 검사: `workers/generate-api/src/fill-check.js`
  - 질의 · 표: `src/prompts.js` 끝(`FILL_WANT` · `buildFillPrompt` · `FILL_SCHEMA`)
  - 시험: `test/fill-check.test.js`

## 왜 따로 두나
주방 위치 검사(`position.js`, [position-qc.md](position-qc.md))는 싱크 · 쿡탑 · 후드 · 상판 끝 점을 찾아 지시한 자리와 몇 mm 어긋났는지 잰다. 다른 품목에는 이 점들이 없다. 그 질의는 오프라인 검증본과 해시로 묶여 있어 고치지 않는다. 그래서 같은 꼴(기다리지 않고 시작, 기록 전용, 던지지 않음)의 새 검사를 옆에 둔다.

## 한 번에 하는 일
1. `job.js` 가 검사(QC)와 다시 그리기를 정한 뒤, 기본안을 올리기 전에 위치 검사와 함께 시작한다. 결과를 기다리지 않는다.
2. Flash(`gemini-3.8-flash`, thinking low, 응답 스키마)를 한 번 부른다. 보내는 그림은 [방 사진, 기본안] 두 장이다.
   - 받는 값: 가구 바깥 상자, 뒷벽 왼 · 오른 끝, 천장선 · 바닥선(0~1000)
   - 네 변의 판정: `touch` · `gap` · `unsure`
3. mm 는 정면 가정 비례로 낸다: 틈 비율 × 벽 폭(좌우) 또는 벽 높이(위아래). 10 mm 단위로 끊고, 0보다 작으면 0이다. 참고값일 뿐이며 판정에는 쓰지 않는다.
4. 결과는 `generations.images` 기본안 칸의 `fill` 에 남는다. 추천안 단계 동안 끝나면 다음 images 패치에 함께 실린다. done 뒤에 끝나면 위치 검사와 같은 늦은 패치(잡 마감 20초 전까지)에 실린다.

## 기록 `images[base].fill`
```json
{ "v": 1, "ok": false, "want": ["left","right","top","bottom"],
  "sides": { "left": {"s":"touch","mm":0}, "right": {"s":"gap","mm":180}, "top": {"s":"touch","mm":0}, "bottom": {"s":"touch","mm":0} },
  "note": "…", "model": "gemini-3.8-flash", "calls": 1, "ms": 6400, "provider": "openai" }
```
- `ok`: want 변 중 하나라도 gap 이면 false, 모두 touch 이면 true, 그 밖(unsure 가 섞였거나 want 가 없음)은 null.
- `error`(있을 때만):
  - 응답 · 입력 문제: `parse` · `no_furniture` · `no_image` · `no_room`
  - 호출 문제: `skipped_overload` · `timeout` · `budget` · `http_429` · `http_5xx` · `http_4xx` · `net`
  - 재실행: `rerun` (다시 재지 않는다)
- 앱 플래너 연출 · 게이트 꺼짐 행에는 `fill` 키가 없다.

## 판정하는 변 `FILL_WANT`
연출컷 지시문 `CATEGORIES[].spec` 이 이미 「닿는다」고 말한 변만 넣었다. 새 규칙은 없다.

| 품목 | 지시문 | want |
|---|---|---|
| 붙박이장 | full wall width · No gap to the ceiling or the side walls | 좌 · 우 · 위 · 아래 |
| 수납장 | Floor-to-ceiling … covering the wall | 좌 · 우 · 위 · 아래 |
| 냉장고장 | covering the full wall width, built up to the ceiling | 좌 · 우 · 위 · 아래 |
| 서재 | floor-to-ceiling built-in bookcase covering the wall | 좌 · 우 · 위 · 아래 |
| 싱크대 · 아일랜드 | Upper cabinets flush to the ceiling | 위 |
| 침실 | bridge cabinets … up to the ceiling | 위 |
| 사무실 | a desk spanning the wall | 좌 · 우 |
| 화장대 · 신발장 | 자리 지시 없음 | 없음 (재기만 한다) |

## 지키는 것
- 다시 그리지 않는다. 상태 · 단계 라벨 · 진행률 · 크레딧 · 완료 시각을 건드리지 않는다.
- 같은 모델이 최근 2분 안에 과부하를 받았으면 보내지 않는다. 과부하 재시도는 5초 뒤 1회이고, 시간은 호출 30초 · 전체 45초다.
- 연출컷 한 장마다 Flash 호출이 +1회(재시도까지 최대 2회) 늘어난다.

## 끄기 · 바꾸기
- `wrangler.toml` 에서 `FILL_QC = "off"` 로 끈다. 모델은 `FILL_MODEL` 로 바꾼다.

## 한계 · 다음
- 오프라인 검증을 하지 않았다. 몇 주 모은 기록을 사람 눈 판정과 비교한 뒤 쓰임을 다시 정한다(다시 그리기 · 화면 표시 등). 쓰임을 바꾸면 `FILL_VERSION` 을 올린다.
- mm 는 원근이 강한 사진에서 거칠다. 판정은 상태로만 한다.
