# generate-api 스크립트

## rescore-planner.mjs — 플래너 모드 재채점 (2026-10-19)

이미 만든 플래너 모드 결과를 **새 역판독**으로 다시 읽어 점수를 낸다. 워커 잡과 같은 함수를
부른다 (`layout.js` `buildPlannerReadPrompt` · `normalizePlannerRead`, `verify.js`
`compareLayoutToSpec`).

새 역판독은 Claude 에게 **[결과 사진, 정면 입면]** 과 도면 목록(줄 · 번호 L1·U1… · 폭 ·
도어/서랍 수)을 주고, 모듈마다 사진에 보이는 도어·서랍 수를 세게 한다. 덤으로 도면 밖 유닛
(`extra_units`)과 배치 모양(`layout_shape`)을 받는다.

### 준비

- `workers/generate-api` 에서 `npm ci` (SDK 가 필요하다)
- 키는 환경 변수로만: `ANTHROPIC_API_KEY` (저장소·명령 기록에 남기지 않는다). 모델은
  `ANTHROPIC_MODEL` (기본 `claude-fable-5-2`, 워커 `wrangler.toml` 과 같게)
- design_spec JSON 파일: `generations.options.design_spec` 를 그대로 저장하거나, generations
  행을 통째로 저장해도 된다 (`options.design_spec` · `category` · `wall_analysis` 를 꺼낸다)

### 실행

```bash
cd workers/generate-api
# 결과 폴더 — base.jpg 와 render-elevation_labeled.png (없으면 render-elevation.png)
node scripts/rescore-planner.mjs --spec d1.json \
  --folder https://<project>.supabase.co/storage/v1/object/public/generations/<user-id>/<generation-id> \
  --old --out rescore-<generation-id>.json

# URL 을 따로 줄 때 (번호 입면이면 --labeled)
node scripts/rescore-planner.mjs --spec d1.json --photo <결과 URL> --elevation <입면 URL> --labeled
```

- `--old` 는 옛 판독(사진 한 장, 벽 % 세그먼트)도 같이 돌려 나란히 찍는다. 옛 판독의 벽 치수는
  행의 `wall_analysis` 나 `--wall 3600x2400`
- `--category` 생략 시 행/spec 의 category, 없으면 `sink`

### 출력 (형식 예시 — 실제 결과 아님)

```
new  ok=true score=4/4 elevation=labeled shape=straight (8123ms, claude-fable-5-2)
     floor doors 5+0dr / upper doors 4  (plan 5+0 / 4)
  L1   plan cabinet/2d+0dr  read cabinet/2d+0dr
  ...
     - extra: wall unit not in plan (above the refrigerator), 2 doors + 0 drawers
old  ok=false score=2.6/3 floor doors 4+0dr / upper 6
```

`--out` 파일에는 새 판독 layout 전체(`units` · `extraUnits` · `shape` · `verify`)와, `--old` 면
옛 layout 이 들어간다.

## shoot.mjs — 홍보용 「촬영 연출」 사진 (2026-11-20)

SNS · 블로그에 올릴 「같은 주방, 다른 색」 사진을 찍는다. 고객 방 사진을 고치는
연출컷과 달리 사진 입력 없이 한국 아파트의 한 장면을 새로 찍는다. 프롬프트는
`src/shoot-prompts.js` (대표님 "다양한 구조로 실제 사진 작가가 찍은 것처럼").

한 장 = 품목 × 구조 × 평형 × 촬영(렌즈 · 자리) × 빛 × 소품 × 색 조합 × 자재.

| 축          | 값                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| 품목 · 구조 | 주방 5 (일자 · ㄱ자 · ㄷ자 · 대면 · 아일랜드), 붙박이장 · 드레스룸 4, 냉장고장 · 홈카페장 · 수납장 3 |
| 평형        | 24평 · 34평 · 40평대                                                                                 |
| 촬영        | 정면 광각 · 모서리에서 비스듬히 · 문틀 너머 · 가구 너머 · 한쪽 끝 반 장면 · 두 색이 만나는 곳        |
| 빛          | 흐린 낮 · 아침 해 · 늦은 오후 · 해 질 녘                                                             |
| 색 조합     | `prompts.js` 의 `TWO_TONES` 여덟 (연출컷 투톤 추천안과 같다)                                         |
| 상판 | 엔지니어드 스톤 · 세라믹 · 인조대리석 · 스테인리스 · 다크 스톤 · 테라조 (주방 · 수납장) |
| 바닥 | 오크 마루 · 포세린 타일 · 헤링본 마루 · 월넛 톤 마루 |
| 식탁 | 세라믹 · 트래버틴 · 오크 원형 · 월넛 · 테라조 · 유리와 스테인리스. 붙박이장 장면은 곁가구 재질 넷 |

목록은 시드가 같으면 같다. 주방이 절반이고, 구조 · 촬영 · 빛 · 색이 고르게 돈다.

### 실행

```bash
cd workers/generate-api
# 목록과 프롬프트만 (찍지 않는다)
node scripts/shoot.mjs --out shoots/2026-11-20 --count 12 --seed 20261120 --dry
# 찍기 — 키는 환경 변수 GEMINI_API_KEY (한 장마다 구글 요금). 바탕마다 색만 바꾼 장 2장 더
node scripts/shoot.mjs --out shoots/2026-11-20 --count 6 --seed 20261120 --recolour 2
```

`--only 1,3` 은 목록의 그 번호만, `--subjects kitchen` 은 품목을 좁힌다,
`--ratio 9:16` 은 쇼츠용. 결과 폴더의 `manifest.json` 에 장마다 조건과
프롬프트가 남는다.

### 규칙

- 손잡이는 매립형 (CLAUDE.md). 문장은 `prompts.js` 의 `HANDLES_LINE` 과 같아야
  한다 — 시험이 본다.
- 사람 · 글자 · 상표는 넣지 않는다. 「AI 연출」 표시는 올리는 단계에서 사진에
  찍는다.
- 실제 시공 사진처럼 소개하지 않는다 (표시광고법). 게시물에도 AI 연출이라고
  적는다.

## carousel.mjs — 캐러셀 장 만들기 (2026-11-20)

찍어 둔 색 조합 사진에 색 이름 · 「AI 연출 이미지」 · 주소를 찍고, 마지막에 사이트로 부르는 장을 붙여
1080 × 1350 JPEG 묶음과 게시 글(`caption.txt`)을 낸다. HTML 은 `carousel-html.mjs`.

```bash
cd workers/generate-api
node scripts/carousel.mjs --spec shoots/set-a.json --out out/set-a
```

`spec.json` 은 `{ title, subject, campaign, slides: [{ file, tone }] }` — `file` 은 spec 파일 기준 경로,
`tone` 은 「세이지 · 크림」 같은 색 조합 이름이다.

- 필요한 것은 크롬(또는 엣지)뿐이다 (`CHROME_PATH` 로 바꿀 수 있다). 화면 없이 띄워 개발자 도구 통로로 찍는다.
- 사진 장마다 「AI 연출 이미지」를 사진 안에 찍고, 마지막 장과 게시 글에도 한 번 더 적는다.
- 게시 글의 링크에는 유입 꼬리표가 붙는다 (`utm_source=instagram&utm_medium=social&utm_campaign=…`).
