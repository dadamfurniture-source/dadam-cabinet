# 냉장고장 이미지 생성 — 삼성·LG 레퍼런스

> `js/detaildesign/data-constants.js`의 `FRIDGE.brands.*` ID와 매칭되는, 이미지 생성용 시각적 특징·프롬프트 조각 정리.
>
> 조회 경로: `detaildesign.html` → 냉장고장 설계 → 브랜드/라인 선택 시 해당 ID의 프롬프트 조각을 주입.

---

## 조합 공식 (냉장고장 전용)

```
[앵글] + [현장 마감] + [주변 캐비넷 외관] + [냉장고 시각 기술]  +  [설치 간격] + [조명] + [네거티브]
```

`[냉장고 시각 기술]` = 아래 표의 `prompt_en` 조각.
`[설치 간격]`은 `FRIDGE.DEFAULT_GAPS`의 `side`/`between` 값을 mm 단위로 주입.

공통 네거티브:
```
no freestanding refrigerator unless line=freestanding,
no oversized gaps around fridge body,
no random branding or logos,
no chrome bar handles on cabinet doors (handleless system only)
```

---

## 삼성 (Samsung)

### 1. BESPOKE 키친핏 냉장고 (`ss_bespoke_1d` / `ss_bespoke_2d` / `ss_bespoke_4d`)

- 치수: 595×1853×688 (1·2도어), 912×1853×688 (4도어)
- 설치 간격: 측면 12mm, 유닛간 10mm
- 패널 마감 5종: Shimmer Glass · Satin Glass · Glam Glass · Cotta Metal · Vibe Metal
- 기본 팔레트 (이미지 생성 시 기본값):
  - Glam White `#F4F1EC`, Glam Pink `#F2D7D3`, Glam Vanilla `#F0E7D4`, Glam Peach `#E8C8B2`
  - Cotta White `#E9E3D8`, Cotta Charcoal `#3A3A3C`, Cotta Morning Blue `#A9BCC7`
  - Shimmer Violet `#9C8FB2`, Shimmer Charcoal `#414046`
  - Vibe Brownie Silver `#897866`, Vibe Dark Gray `#4E4E50`

```prompt_en
Samsung Bespoke Kitchen Fit built-in refrigerator, completely flat door
with no protruding handle, recessed groove handle integrated into door
top edge, glass or matte metal front panel ({{door_color_name}}),
uniform body sitting flush with surrounding cabinetry, 688mm depth
matches kitchen cabinet depth (kitchen-fit, no protrusion), 12mm gap
at sides and 10mm between units. No ice/water dispenser on front.
```

### 2. BESPOKE 김치플러스 키친핏 (`ss_kimchi_1d` / `ss_kimchi_3d` / `ss_kimchi_4d`)

- 치수: 595×1853×688 (1도어), 695×1853×688 (3도어), 912×1853×688 (4도어)
- 외관은 비스포크 냉장고와 동일 패널·색상 체계 공유
- 하단 서랍형(상냉장X, 전체 김치 전용)의 드로어 분할이 보이는 평면 도어

```prompt_en
Samsung Bespoke Kimchi Plus kitchen-fit refrigerator, full-height
drawer-style front divided horizontally (top short drawer + large
bottom drawer for 3-door / or 4 equal drawers for 4-door),
recessed handle grooves at top of each drawer, flat glass panel in
{{door_color_name}}, seamless with surrounding cabinet surround.
```

### 3. BESPOKE 키친핏 세트 / Max (`ss_kf_2d1d` ~ `ss_kf_max`)

- 냉장고·김치·냉동 조합형. 폭 1200~2410mm
- 유닛별 폭 표기는 `js/detaildesign/data-constants.js:563~` 세트 정의 참조
- 이미지 생성 시: 세트 내 유닛 사이 10mm 공간을 유지, 상단 라인 정렬
- Max 라인(`ss_kf_max`, 1834mm)은 키친핏 맥스 디자인 (9형 터치스크린 옵션)

```prompt_en
Samsung Bespoke Kitchen Fit SET arrangement: {{unit_list}} aligned in
a single row with 10mm reveals between units, identical door height
(1853mm) and identical panel finish across units for a single
continuous appliance wall. Flat face, recessed top-edge handles.
```

Max 전용 (9형 스크린):
```prompt_en
... include a discreet 9-inch black touchscreen recessed into the
upper-right door of the 4-door unit; screen off (black glass) unless
stated otherwise.
```

### 4. BESPOKE Infinite Line (참고, `line='infinite'`)

- 프리미엄 빌트인. 알루미늄 / 세라믹 / 스테인리스 등 천연 소재
- 색상 5종: Timeless Greige, Timeless Charcoal, Cera Black, Cera White, Lux Metal
- 도어-본체 사이 프레임(베젤) 디자인이 키친핏과의 가장 큰 시각 차이점

```prompt_en
Samsung Bespoke Infinite Line built-in refrigerator, flush-fit with
cabinetry but with a slim metal frame / bezel outlining each door
(visible seam between door and carcass), matte aluminum / ceramic
front panel in {{door_color_name}}, auto-open door (no handle visible,
surface completely uninterrupted).
```

### 5. 삼성 프리스탠딩 (`line='freestanding'`)

- 측면 50mm / 유닛간 0mm. 상단·측면 돌출, 힌지가 보이는 전형적 독립형 외관
- 냉장고장 가구는 좌우 기둥 + 상부 장 구성으로 냉장고 본체와 분리된 형상 유지

```prompt_en
Freestanding Samsung refrigerator sitting inside a tall three-sided
cabinet surround (pantry columns on both sides + bridge cabinet
above). 50mm side clearance visible, no clearance above (bridge
cabinet sits directly on top of fridge). Fridge body has visible
hinges and standard protruding depth (~750mm) — extends forward of
cabinet line by ~60mm.
```

---

## LG

### 1. 디오스 오브제컬렉션 빌트인 (`lg_builtin_fridge_1d` / `lg_builtin_kimchi_1d` / `lg_builtin_fridge_kimchi` / `lg_builtin_mood`)

- 치수: 냉장고 897mm, 김치/1도어 649mm, 높이 1860mm, 깊이 698mm
- 설치 간격: 측면 22mm, 유닛간 11mm
- 설치 공간 요구: 높이 1880mm 이상, 깊이 885mm 이상 (음성인식 1886mm)
- 색상 팔레트 (Mist Glass):
  - 베이지 `#D8CDB9`, 실버 `#BFC3C6`, 민트 `#BEDBD1`, 핑크 `#E6CCCB`
  - 스테인리스 스틸: 실버 `#9AA0A6`, 블랙 `#2E2E30`, 그린 `#4E6A5A`

```prompt_en
LG DIOS Objet Collection built-in refrigerator with a completely flat
door (zero-clearance hinge), pastel Mist Glass front in
{{door_color_name}}, no visible handle on the face (thin recessed pull
along the top edge), uniform 1860mm door height, sitting inside a
kitchen cabinet recess with 22mm side reveal and 11mm gap between
units. Smooth glass surface, soft matte reflection.
```

### 2. 디오스 무드업 빌트인 (`lg_builtin_mood`, 무드냉장+무드김치)

- 상단 도어 22색 / 하단 도어 19색 LED 색상 가변 글라스
- 노크온 기능: 두 번 두드리면 내부 LED가 켜져 내용물이 비침

```prompt_en
LG DIOS Objet Collection MoodUP built-in refrigerator, two door
panels with color-changing LED glass surfaces showing a calm {{upper_color}}
tone on the upper door and {{lower_color}} on the lower door, edge-to-edge
glass with soft diffused glow (not neon, gentle ambient color),
otherwise identical silhouette to Objet built-in. Knock-on not
active (interior not visible).
```

### 3. 핏 앤 맥스 / 모던엣지 (`lg_modern_1d1d`, `line='fitmax'`)

- 치수: 595mm 폭, 1850mm 높이, 680mm 깊이 (모던엣지)
- 설치 간격: **측면 4mm (500원 동전 2장 두께), 유닛간 8mm**
- 2축 제로 클리어런스 힌지 — 벽에 붙여도 문이 걸리지 않음
- 전면 방열 → 후면 공간 거의 불필요
- 색상: Almond, Taupe, Essence White

```prompt_en
LG DIOS Fit & Max / Modern Edge built-in refrigerator with a truly
flush-fit zero-clearance install — only 4mm reveal at the sides and
8mm between adjacent units, no visible back gap. Completely flat
door in Objet Collection {{color: Almond / Taupe / Essence White}},
minimal top-edge pull, front heat-dissipation grille barely visible
as a thin slot along the very bottom of the plinth.
```

### 4. LG 프리스탠딩 (`lg_free_600_side` / `lg_free_800_side` / `lg_free_800_topbot`)

- 치수: 폭 913mm, 높이 1790~1820mm, 깊이 738mm
- 측면 50mm, 유닛간 0mm
- 양문형 600/800 / 상냉장-하냉동 800 3종

```prompt_en
Freestanding LG refrigerator ({{variant: side-by-side 600 / side-by-side
800 / top-freezer 800}}) inside a tall cabinet surround. 50mm side
clearance, 738mm body depth extending ~60mm forward of the cabinet
line. Stainless or matte finish, standard exterior hinges visible.
```

---

## 공통 프롬프트 규칙

1. **손잡이**: 모든 주변 캐비넷(양옆 키큰장 + 상부 브릿지장)은 **매립형 / 홈 손잡이 (handleless, recessed top-edge groove)**. 크롬 바 핸들 · 푸쉬투오픈 금지. 냉장고 본체도 같은 규칙.
2. **상단 간격**: 냉장고 상단과 브릿지장 사이에 `FRIDGE.TOP_GAP = 15mm` 시각적 그림자 라인 유지.
3. **다리**: `leg_type`이 `pedestal`이면 연속된 좌대(스커트), `leg`이면 검정 원통형 다리발 4개가 보이도록.
4. **색상 일치**: 주변 캐비넷 색상은 사용자 선택값. 냉장고 색상은 **별도 변수** — 삼성/LG 팔레트 중 사용자 선택 또는 브랜드 기본 색(비스포크=Glam White, 오브제=베이지).
5. **브랜드 로고 금지**: 전면 로고·텍스트는 렌더링하지 않음 ("no brand logos or text on fridge doors").

---

## 변수 매핑 요약 (workers/generate-api/src/worker.js 확장 제안)

현재 `FRIDGE_LINE_DESC`는 한 줄 라벨뿐. 이 파일의 `prompt_en` 블록을 `FRIDGE_LINE_VISUAL` 맵으로 추가 주입하면 더 정확한 이미지 생성 가능.

```js
// 예시 확장 (worker.js:168 근처)
const FRIDGE_LINE_VISUAL = {
  bespoke:     'flat glass/metal panel, recessed top-edge handle, kitchen-fit depth 688mm, 12mm side / 10mm between gaps',
  infinite:    'premium aluminum/ceramic panel with slim metal bezel around each door, auto-open (no handle), 5mm side / 10mm between gaps',
  builtin:     'LG Objet Mist Glass flat door, thin top-edge pull, 22mm side / 11mm between gaps',
  fitmax:      'LG Fit & Max zero-clearance install with only 4mm side / 8mm between gaps, bottom front heat grille',
  standing:    'freestanding body extending 60mm forward of cabinet line, 50mm side gaps, visible hinges',
  freestanding:'freestanding body extending 60mm forward of cabinet line, 50mm side gaps, visible hinges',
};
```

---

## 참고 링크

- [삼성 BESPOKE AI 패밀리허브 2026년형 (삼성 뉴스룸)](https://news.samsung.com/kr/%EC%82%BC%EC%84%B1%EC%A0%84%EC%9E%90-ai-%EC%8B%9D%EC%9E%AC%EB%A3%8C-%EA%B4%80%EB%A6%AC-%EA%B0%95%ED%99%94%ED%95%9C-2026%EB%85%84%ED%98%95-%EB%B9%84%EC%8A%A4%ED%8F%AC%ED%81%AC-ai-%ED%8C%A8%EB%B0%80)
- [삼성 BESPOKE 냉장고 라인업 (나무위키)](https://namu.wiki/w/%EC%82%BC%EC%84%B1%20BESPOKE%20%EB%83%89%EC%9E%A5%EA%B3%A0)
- [삼성 비스포크 인피니트 라인 (한국경제)](https://www.hankyung.com/article/2022060856041)
- [LG 오브제컬렉션 무드업 M624GNN3A2](https://www.lge.co.kr/refrigerators/m624gnn3a2)
- [LG 디오스 핏 앤 맥스 (LG전자 뉴스룸)](https://live.lge.co.kr/2503-lg-fitandmax/)
- [LG 디오스 오브제컬렉션 설치 가이드](https://www.lge.co.kr/story/user-guide/objetcollection-refrigerator-install-guide)
- [LG MoodUP (Engadget)](https://www.engadget.com/lg-mood-up-refrigerator-uses-led-panels-to-color-shift-your-kitchen-093402450.html)
- [Samsung Bespoke panel colors/finishes (Samsung US)](https://www.samsung.com/us/home-appliances/bespoke/refrigerators/)
