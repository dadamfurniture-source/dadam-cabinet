# 예림 LUX 자재 텍스처 — 스와치에서 타일까지

> 2026-09-16. 사용자 질문: *"색상에 무늬는 표현이 안되는 건가? 색상이 예림의 자재 색상과는 너무 차이 나는데?"*
> 3D Planner 도메인. 관련 문서: `planner-detail-mode.md` D2 절.

## 무엇이 문제였나

2026-09-15 예림 LUX 시드(#636)는 자재 하나에 **평균색 하나**만 넣었다 (`materials.color_hex`, 스와치 사진 중앙
60% 의 sRGB 평균). 그래서:

1. **무늬가 사라진다.** 나뭇결·석재 무늬가 한 덩어리 탁한 색으로 뭉갠다. 윈체스터월넛도, 오크도, 밋밋한 갈색 판이 된다.
2. **sRGB 평균은 어두운 쪽으로 치우친다.** sRGB 는 감마가 실린 값이라 그대로 더하면 실제 밝기보다 어둡게 나온다
   (검정·흰색 반반이면 sRGB 평균 `#808080`, 선형광 평균 `#bcbcbc`).

`planner-materials.js` 에는 텍스처 훅이 이미 있었지만 `texture_url` 이 전부 null 이라 한 번도 돌지 않았다.

## 파이프라인

`scripts/fetch-yerim-textures.mjs` 한 장이 네 단계를 한다. 정본 입력은 `database/seed/yerim-lux.json` 의 `image_url` 144개.

| 단계 | 하는 일 |
|---|---|
| 1. 내려받기 | `curl` 로 순차 + 120ms 지연, 실패하면 1.5초 쉬고 한 번 재시도. 예림 서버가 `User-Agent`·`Referer` 없는 요청을 거절하므로 둘 다 붙인다. 받은 원본은 `tmp/yerim-swatches/<code>.jpg` 에 캐시한다(`tmp/` 는 `.gitignore`) — 다시 돌려도 다시 받지 않는다(`--force` 로 강제). |
| 2. 테두리 잘라내기 | 예림 스와치는 510×510 안에 약 38px 흰 테두리가 있다. 네 변에서 안쪽으로 훑어 **한 줄의 평균 색차가 1.5 를 넘는** 첫 줄부터를 내용으로 본다. 테두리는 완전한 흰색이라 평균 색차가 정확히 0 이고, 자재가 거의 흰색(화이트엠보 `#fbf7f9`)이어도 4~5 는 나온다 — 그래서 최대값이 아니라 **평균**을 본다(최대값으로 보면 흰 자재에서 테두리와 구분이 안 됐다). 못 찾으면 고정 9% 안쪽. 찾은 뒤에도 JPEG 링잉을 피해 1% 더 밀고, 가운데 정사각형으로 맞춘다. |
| 3. 타일 | 잘라낸 정사각형을 **512×512, JPEG 품질 82** 로 `assets/materials/yerim/<code>.jpg` 에 쓴다. 144장 합계 **3.60 MB** (평균 26 KB, 최대 84 KB). |
| 4. 색 다시 계산 | 잘라낸 타일 전체를 **선형광(linear-light)** 으로 평균해 sRGB hex 로 돌린다 → `color_hex`. 이제 이 값은 **텍스처를 못 읽었을 때의 대체색**이다. |

`--write-seed` 를 주면 `database/seed/yerim-lux.json` 의 `color_hex`·`texture_url`·`tile_mm` 을 갱신한다
(한 장이라도 실패하면 갱신하지 않는다). 그 다음 `scripts/build-yerim-sql.mjs` 가 SQL 두 장을 만든다.

### 의존성

이미지 디코딩·인코딩은 **`jimp`** 로 한다 — `package.json` 의 **devDependencies 에만** 있다. 앱은 정적 HTML + 바닐라 JS 라
런타임 의존성이 없고, `jimp` 는 순수 JS(네이티브 빌드 없음)라 어느 OS 에서도 `npm ci` 한 번이면 이 스크립트가 돈다.

## `tile_mm` — 타일 한 장이 덮는 실제 크기

타입 하나에 값 하나다.

| 타입 | `tile_mm` | 왜 |
|---|---|---|
| PP · PVC · MFB · MFC (우드 계열) | **600** | 예림 원판 폭이 1220mm 이고 도어 한 짝이 보통 400~600mm 다. 600 이면 도어 한 짝에 결 한 폭이 들어가 실제 랩핑과 같은 크기로 읽힌다. 더 작으면 결이 잘게 반복돼 프린트처럼, 더 크면 한 면에 결이 한 줄만 지나가 밋밋해진다. |
| Acryl · Glass · PET · PET Matt · PET Glossy · UV (무지) | **300** | 무늬가 없고 미세한 엠보·질감뿐이라 타일 이음이 보이지 않는다. 작게 깔아야 질감 알갱이가 실제 크기에 가깝고 큰 면에서도 흐려지지 않는다. |

`grain` 은 시드 그대로다(우드 24종이 `'v'`, 나머지 `'none'`) — 이름으로 추정한 값이라 여전히 **[확인 필요]**.
`planner-materials.js` 가 `grain:'v'` 인 자재를 누운 부재(선반·상판)에 쓸 때 90° 돌린다.

## 색 before/after (대표 14)

`before` = 2026-09-15 시드(중앙 60% sRGB 평균), `after` = 잘라낸 타일 전체의 선형광 평균. Δ 는 채널 최대 차(0~255).

| 코드 | 이름 | 타입/결 | before | after | Δ |
|---|---|---|---|---|---|
| YR-YPA-01 | 아크 플랫화이트 | Acryl/none | `#ffffff` | `#ffffff` | 0 |
| YR-SM-01 | 매트 화이트 | PET Matt/none | `#fbfbfb` | `#fbfbfb` | 0 |
| YR-YPA-02 | 아크 퓨어코튼 | Acryl/none | `#f6efe7` | `#f5eee7` | 1 |
| YR-YPA-05 | 아크 런던그레이 | Acryl/none | `#c7c8ca` | `#c6c8c9` | 1 |
| YR-MFB-302 | 코임브라 | MFB/v | `#e9caa1` | `#eacca4` | 3 |
| YR-MFB-303 | 윈체스터월넛 | MFB/v | `#a56c41` | `#a56c43` | 2 |
| YR-MFB-304 | 소프트월넛 | MFB/v | `#4f3f29` | `#504029` | 1 |
| YR-MFB-504 | 밤부 | MFB/v | `#c8b6a5` | `#cab8a9` | 4 |
| YR-W03 | 아메리칸 스모키드 월넛 | MFC/v | `#413226` | `#413126` | 1 |
| YR-YPW-02 | 카타니아 오크 | PP/v | `#433028` | `#433027` | 1 |
| YR-MFB-500 | 사하라 누아르 | MFB/none | `#322f30` | `#383434` | **6** |
| YR-PM-61 | 메탈 바이브레이션 브라운 | PET/none | `#7a6960` | `#7d6d64` | 4 |
| YR-AM-50 | 메탈 헤어라인 | PET/none | `#838383` | `#808081` | 3 |
| YR-S815 | 베이직 S815 | MFC/none | `#d9d2c7` | `#d7d0c4` | 3 |

144종 중 111종의 hex 가 바뀌었지만 **폭은 작다** (채널 최대 차 평균 0.97, 최대 6). 예림 스와치 사진 자체가
명암 폭이 좁아서(윈체스터월넛도 휘도 표준편차 17 정도) 선형 평균과 sRGB 평균이 크게 갈리지 않는다.
**사용자가 본 "너무 다르다" 의 큰 몫은 평균색의 값이 아니라 무늬가 통째로 사라졌다는 것**이고, 그건 텍스처가 고친다.
색 보정은 대체색을 제자리에 돌려놓는 작은 몫이다.

## 예림이 제품을 바꿨을 때 다시 만들기

1. 목록을 다시 긁어 `database/seed/yerim-lux.json` 의 `image_url`(과 새 품목)을 고친다.
2. `node scripts/fetch-yerim-textures.mjs --force --write-seed`
   (`--force` 없이 돌리면 `tmp/yerim-swatches/` 캐시를 쓴다. 한 품목만: `--only YR-MFB-303`.)
3. `node scripts/build-yerim-sql.mjs` — `materials-yerim-lux-seed.sql` 과 `materials-yerim-textures.sql` 두 장을 다시 만든다.
   **두 SQL 은 손으로 고치지 않는다.** 정본은 JSON 이다.
4. `npx jest __tests__/materials-yerim-seed.test.js __tests__/materials-yerim-textures-sql.test.js`
   — 144 코드 1:1, 멱등성, 타일 파일 존재를 본다.
5. Supabase SQL Editor 에서 `database/materials-yerim-textures.sql` 실행 (아래).
6. main 푸시 → GitHub Pages 배포 → 필요하면 Cloudflare **Purge Everything**.

## DB 에 반영하기 — 왜 UPDATE 파일이 따로 있나

`database/materials-yerim-lux-seed.sql` 의 INSERT 는 `WHERE NOT EXISTS (code)` 로 보호되어 있다 (I6: 카탈로그는 더하기만).
그래서 2026-09-15 시드를 **이미 실행한 DB** 는 시드를 다시 돌려도 기존 144행이 그대로다.
새 값이 그 DB 에 닿는 길은 `database/materials-yerim-textures.sql` 뿐이다 — 코드 한 건씩 UPDATE 144줄.
멱등(몇 번 돌려도 같다)이고 `DROP`·`DELETE`·`TRUNCATE` 가 없으며 다른 vendor 행을 건드리지 않는다.

```sql
-- 확인
SELECT count(*) FROM materials WHERE vendor = 'yerim' AND texture_url IS NOT NULL;  -- 144
```

## 저작권 — 확인 필요

타일은 **예림 제품 사진을 잘라 이 저장소에 다시 올린 것**이다. 저장소가 PUBLIC 이고 GitHub Pages 로 그대로 서비스된다.
설계 도구 안에서 자재를 보여 주려는 용도지만, **공개 운영 전에 예림에 사용 동의를 받아야 한다.** 판단은 사람 몫이다.

빼는 것은 두 줄이다:

```
rm -r assets/materials/yerim/
```
```sql
UPDATE materials SET texture_url = NULL WHERE vendor = 'yerim';
```

`planner-materials.js` 는 `textureUrl` 이 null 이면 다시 대체색(단색)으로 돌아간다 — 3D 가 비지 않는다.

## 남은 것

- 타일이 **이음매 없는(seamless)** 타일은 아니다. 스와치 사진을 그대로 잘랐으므로 `repeat` 가 2 를 크게 넘는 면에서는
  이음이 보일 수 있다. 자연스러운 우드라면 거울 반복(`MirroredRepeatWrapping`)이나 가장자리 블렌딩이 다음 수다.
- 노멀맵·거칠기맵은 없다. 엠보 질감은 컬러맵의 명암으로만 읽힌다.
- `grain` 은 이름 추정값 **[확인 필요]** — 예림 카탈로그로 확인하면 가로결 자재(`'h'`)도 갈릴 수 있다.
- 스와치 원본 해상도가 510px 라 512 타일은 거의 등배다. 더 큰 원본이 있으면 1024 타일이 가능하다.
