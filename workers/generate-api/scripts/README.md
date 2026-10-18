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
  `ANTHROPIC_MODEL` (기본 `claude-opus-5`, 워커 `wrangler.toml` 과 같게)
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
new  ok=true score=4/4 elevation=labeled shape=straight (8123ms, claude-opus-5)
     floor doors 5+0dr / upper doors 4  (plan 5+0 / 4)
  L1   plan cabinet/2d+0dr  read cabinet/2d+0dr
  ...
     - extra: wall unit not in plan (above the refrigerator), 2 doors + 0 drawers
old  ok=false score=2.6/3 floor doors 4+0dr / upper 6
```

`--out` 파일에는 새 판독 layout 전체(`units` · `extraUnits` · `shape` · `verify`)와, `--old` 면
옛 layout 이 들어간다.
