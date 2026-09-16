# 철물·체결구 규칙 입력 양식 (B2)

> 상태: **양식 작성 중 — 공장 값 미확정** (작성 2026-09-16, 계획 `docs/01-plan/detail-bom-deepening.plan.md` §5 B2 · §9 항목 8–9).
> 이 문서의 「공장 값」칸은 전부 비어 있다. 값은 **공장이 채운다** — 여기서 추측해 적지 않는다.
> 「현재 코드 값」은 `origin/main` (57d0b3e) 의 `js/detaildesign/extractors.js` `HardwareExtractor`·`MaterialExtractor` 가
> **지금 내는 값**을 그대로 옮긴 것이고, 규칙 문서(`ACTIVE_RULES.md` §9 · `bom-protocol.md` §4~§6 · `sink.md` §5·§9 ·
> `wardrobe.md` §7·§10·§11 · `fridge.md` §3·§7·§11 · `common.md` §8)와 어긋나는 곳은 비고에 적었다.
> 코드에 없는 항목은 「현재 코드 값」이 `없음` 이고 — `extractOthers` 가 빈 함수라 체결구는 한 줄도 안 나온다 (`extractors.js:1667`).

## 작성 방법

- **채우는 칸은 「공장 값」하나다.** 나머지 열은 읽기용이다. 조건이 표와 다르게 갈라지면(예: 도어 폭 구간을 더 나눠야 한다) 비고에 적고 행을 더한다.
- 모르는 값·정해지지 않은 값은 `[확인 필요]` 로 둔다. 빈칸과 `[확인 필요]` 는 같은 뜻(미확정)이다 — 임의의 값을 넣지 않는다.
- **조건 열의 도어 H 는 재단 도어 높이**다 — 몸통 H 가 아니다 (`bom-protocol.md` §4-1). 상부장 = 몸통 H + 내림 15, 하부장 = 몸통 H − 30(목찬넬 틈),
  키큰장 단 = 목찬넬 단 H − 30 / 푸쉬 단 H − 4, 붙박이·냉장고장 = 몸통 H (`extractors.js:1502-1508`, `bomTallTierDoorH` 148).
- 단위 열의 약속: `EA` 개, `SET` 좌우 한 벌, `mm`, `EA/m` 길이 1m 당 개수, `g/m²` 도포량.
- **키 표기**: 절 제목의 `` `key` `` 는 `mcp-server/config/bom-rules.json` 의 `hardware.<key>`, 행 항목의 `` `sub_key` `` 는 `hardware.<key>.<sub_key>` 다.
  시험 `__tests__/bom-rules-hardware-form.test.js` 가 이 문서의 절·행과 JSON 키를 맞춰 보고, 「공장 값」이 비어 있으면 JSON 도 `null` 이어야 한다 —
  양식과 설정이 따로 놀 수 없다. 행을 더하거나 이름을 바꾸면 JSON 도 같이 바꾼다.
- 공장에서 표를 돌려주면 「공장 값」을 이 문서에 옮겨 적고 `bom-rules.json` 의 `null` 을 그 값으로 바꾼다 (아래 적용 절차).
- `bom-rules.json` `hardware` 에 원래 있던 `hinges_per_door: 2` · `hinge_type` · `slide_type` 은 MCP 프로토타입(`bom.service.ts:281-298`) 값이다 —
  프론트 정본이 아니며 이 양식과 무관하다. 그대로 둔다.

## 1. 경첩 (`hinge`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `count_by_door_h` 도어 높이별 개수 | 도어 H ≤ 900 / 901~1600 / 1601 이상 | 2 / 3 / 4 (`extractors.js:1474-1478`, 예전 표 `hingeRules` 1429 는 미사용) |  | EA/도어 | 문턱값(900·1600)이 맞는지, 구간을 더 나눌지(예: 2000 이상 5구) |
| `width_condition` 도어 폭 조건 | 도어 W (넓은 도어·좁은 도어) | 없음 — 폭 무관, 높이만 본다 (`extractors.js:1489-1523`) |  | EA/도어 | 폭이 넓으면(예: 600 초과) 개수를 더하는 규칙이 있는가 `[확인 필요]` |
| `boring_positions` 보링 위치 | 2구 / 3구 / 4구 | [110, H−110] / [110, H/2, H−110] / [110, H/3, 2H/3, H−110] (`extractors.js:1481-1486`) |  | mm (도어 상단 기준) | 끝 110 이 맞는지, 컵 Φ35·깊이·측판 쪽 플레이트 위치 `[확인 필요]` |
| `door_h_basis` 도어 높이 산정 | 상부 / 하부 / 키큰장 단 / 붙박이·냉장 | 몸통 H+15 / H−30 / H−30 또는 H−4 / H (`extractors.js:1502-1508`, `bomTallTierDoorH` 148) |  | mm | 자재 행과 같은 함수 — 여기서 바꾸면 자재 행도 같이 바뀐다 |
| `default_type` 기본 품목 | 전 카테고리 | 문주 110° 약압 경첩, 제조사 문주 (`extractors.js:1514-1516`) |  | 품명 | 실제 발주 품번 `[확인 필요]` |
| `overlay_inset` 오버레이/인셋 구분 | 오버레이(덮방) / 반덮방 / 인셋 | 없음 — 전부 같은 품목 하나로 낸다 |  | 품명 | 카테고리·손잡이(목찬넬·푸쉬)별로 경첩 종류가 갈리는가 `[확인 필요]` |
| `damper` 도어 댐퍼 | 도어당 | 없음 — "도어 댐퍼 미사용 (사내 규정)" (`extractors.js:1667-1669`) |  | EA/도어 | 규칙 문서는 **도어당 2** (`ACTIVE_RULES.md` §9.4 · `bom-protocol.md` §4-3 · `common.md` §8) — 코드와 불일치. 약압 경첩이면 댐퍼 없음이 맞는지 확정 |
| `el_lift_up` EL 리프트업 | 냉장고장 EL 모듈 `doorType:'lift'` (`fridge.md` §7) | 없음 — 여닫이와 같은 경첩 규칙을 탄다, 리프트업 철물 행 없음 |  | SET/도어 | 리프트업 힌지 품목·도어 폭/무게 구간 `[확인 필요]` |
| `sliding_door` 슬라이딩 도어 | 냉장고장 EL 모듈 `doorType:'slide'` | 없음 — 경첩 규칙을 그대로 탄다 (과다) |  | SET/모듈 | 슬라이딩 레일 품목·길이 `[확인 필요]` |

## 2. 레일 (`rail`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `type` 레일 종류 | 언더(댐핑 언더레일) / 사이드(볼레일) / 풀익스텐션 | 싱크·냉장: "소프트클로즈 서랍레일, 블룸" (`extractors.js:1557-1558`) · 붙박이: "문주 언더레일" (`1536-1537`) |  | 품명 | 카테고리별 기본 종류. `origin/agent/bom-drawer-channel` (96393c0) 은 `mod.drawerRail` `under`(기본)/`ball` 로 가른다 — main 미반영 |
| `length_by_depth` 깊이별 길이 | 캐비닛 D ≤ 350 / ≤ 450 / 그 밖 | 350 / 450 / 500 (`extractors.js:1549-1553`) · 붙박이는 D 무관 450 고정 (`1538`) |  | mm | 500 초과 깊이(550·620) 에 550 레일을 쓰는지 `[확인 필요]` |
| `qty_per_drawer` 수량 | 서랍 단마다 | 붙박이: `drawerCount` SET (`extractors.js:1533-1543`) · 싱크·냉장: **모듈당 1 SET** (`1561`, `drawerCount` 무시 — 과소) |  | SET/단 | 계획 B2 "즉시 수정" 항목. 96393c0 은 단수만큼 낸다 |
| `box_clearance_by_rail` 박스 상하 여유 | 언더 / 볼 | main 없음 · 96393c0: 언더 아래 30 + 위 10 = +40, 볼 아래 10 + 위 10 = +20 (`bom-drawer-rules.js`, 2026-09-15 사장님 확정) |  | mm | 확정값이면 그대로 옮겨 적는다 |
| `drawer_width_clearance` 서랍 폭 여유 | 언더 / 볼 | 붙박이 서랍 전후판 W−30−42 (`wardrobe.md` §7) · 96393c0 서랍 전후판 W−72 |  | mm (몸통 내폭 − 박스 외폭) | 레일 종류별 좌우 여유(볼레일 12.7×2 등) `[확인 필요]` |
| `box_depth` 박스 깊이 | 레일 길이별 | 붙박이 서랍 측판 440 · 밑판 449 (`wardrobe.md` §7, D 무관 고정) |  | mm | 레일 350/500 일 때 박스 깊이 `[확인 필요]` |
| `inner_drawer` 내부 서랍 | 붙박이 `isExternalDrawer=false` | 문주 언더레일 450, 1 × 서랍수 (`wardrobe.md` §7 내부 서랍) — `HardwareExtractor` 는 내·외부를 구분하지 않는다 (`extractors.js:1531-1544`) |  | SET/단 | 내부서랍 레일이 외부와 다른가 (길이·종류) `[확인 필요]` |

## 3. 미니픽스·목다보 (`minifix_dowel`)

체결 규칙은 코드에 없다 — `extractOthers` 빈 함수 (`extractors.js:1667-1669`). 접합마다 미니픽스(캠+볼트)와 목다보 개수를 적는다.

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `side_x_top` 측판 × 천판 | 접합 1곳 (천판 있는 몸통 — 상부장·붙박이·냉장) | 없음 |  | EA/접합 (미니픽스 · 목다보) | 접합 폭(D)별로 다르면 구간을 비고에 |
| `side_x_bottom` 측판 × 지판 | 접합 1곳 | 없음 |  | EA/접합 (미니픽스 · 목다보) | |
| `side_x_shelf_fixed` 측판 × 고정 선반 | 고정 선반 1장 | 없음 |  | EA/접합 (미니픽스 · 목다보) | 가동 선반은 §5 선반핀 |
| `side_x_divider` 측판·천판·지판 × 칸막이 | 칸막이 1장 | 없음 |  | EA/접합 (미니픽스 · 목다보) | |
| `band_x_side` 밴드(보강목) × 측판 | 밴드 1장 (상하 2장) | 없음 |  | EA/접합 | 처짐방지 70 밴드도 같은가 |
| `back_panel_fix` 뒷판 고정 | 2.7T 뒷판 / 18T 뒷판(홈카페장 `fridge.md` §11) | 없음 |  | 방식 (홈 / 타카 / 스크류) | 타카면 §4 에 개수 |
| `dowel_spec` 목다보 규격 | 15T 몸통 / 18T 몸통 | 없음 |  | Φ × 길이 mm | 몸통 두께(`bodyThickness` 15/18)별 |

## 4. 스크류·타카핀·본드 (`screw_nail_glue`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `screw_body` 몸통 조립 스크류 | 접합 1곳 (미니픽스 대신 쓰는 경우) | 없음 |  | EA/접합 · 규격 | 미니픽스와 병용인지 택일인지 |
| `screw_hinge_plate` 경첩 플레이트 스크류 | 경첩 1개 | 없음 |  | EA/경첩 · 규격 | |
| `screw_rail` 레일 스크류 | 레일 1 SET | 없음 |  | EA/SET · 규격 | 언더/볼 별 |
| `nail_back_panel` 뒷판 타카핀 | 뒷판 둘레 길이 | 없음 |  | EA/m | 핀 규격(예: F30) 도 |
| `nail_kick_channel` 걸레받이·목찬넬·몰딩 타카핀 | 부재 길이 | 없음 |  | EA/m | 부재 종류별로 다르면 행 추가 |
| `glue_edge` 엣지 접착 | 엣지 길이 (`edgeLen`, B1) | 없음 — 엣지 길이는 자재 행에 있다 (`bom-part-id`) |  | g/m | 엣지 두께 0.6/1.0 별 |
| `glue_back_panel` 뒷판·목찬넬 본드 | 부재 길이 또는 면적 | 없음 |  | g/m 또는 g/m² | |

## 5. 선반핀 (`shelf_pin`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `pins_per_shelf` 선반당 개수 | 가동 선반 1장 | 4 — "선반 브라켓 (핀타입) Φ5mm" (`extractors.js:1645-1664`) |  | EA/선반 | |
| `pin_spec` 핀 규격 | 15T / 18T 몸통 | Φ5 (`extractors.js:1656`) |  | Φ × 길이 mm | |
| `shelf_count_basis` 선반 수 산정 | 상부장 / 하부장 | 상부장 모듈당 2 (후드 제외) · 하부장 1 (서랍·싱크·쿡탑 제외) (`extractors.js:1647-1652`) — 자재 행의 `mod.shelfCount` 와 **따로** 센다 |  | EA/모듈 | 자재 행 선반 수(`shelfCount`)에 맞추는 게 맞는지 `[확인 필요]` |
| `wardrobe_fridge_shelves` 붙박이·냉장고장 선반 | `pos` 없는 모듈 | 브라켓 행 없음 — `pos` 가 없어 위 조건에 안 걸린다 (`extractors.js:1647-1652`) |  | EA/선반 | 붙박이(`shelf_per_section` 1)·키큰장 선반 3 (`fridge.md` §11)도 핀 4 인지 |

## 6. 걸레받이 클립·다리발 (`kick_clip_leg`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `leg_count_by_w` 모듈 폭별 다리발 수 | W ≤ 600 / ≤ 900 / 그 밖 | 4 / 6 / 8 (`extractors.js:1625-1628`) |  | EA/모듈 | `bom-protocol.md` §4-3 은 ≤1200 → 6 — 문서끼리 불일치. 코드·`ACTIVE_RULES.md` §9.3 은 900 |
| `leg_height` 다리발 높이 | 싱크대 / 냉장고장 `leg` | `sinkLegHeight` 기본 150 (`extractors.js:1619`) · 냉장고장 `LEG_H` 60 (`fridge.md` §3) |  | mm | 조절 범위(예: 150 ±20) `[확인 필요]` |
| `leg_scope` 적용 범위 | 카테고리·모듈 | 싱크대 `pos:'lower'` 만 (`extractors.js:1617-1623`) — 키큰장 단·냉장고장 `leg` 타입·붙박이는 없음 |  | — | 냉장고장 다리 타입(`fridge.md` §3)에도 다리발이 나가야 하는가 |
| `adjuster_leg` 조절다리 | 캐비닛 수 | 없음 — `bom-protocol.md` §6 "(캐비닛 수 + 1) × 2" 는 코드에 없다 |  | EA | 다리발과 별개 품목인지 같은 것인지 `[확인 필요]` |
| `kick_clip_count` 걸레받이 클립 | 걸레받이 길이 또는 다리발 수 | 없음 — 걸레받이 부재만 낸다 (`extractors.js:917`) |  | EA/m 또는 EA/다리발 | 클립 품목·다리발 대응 규칙 `[확인 필요]` |
| `kick_height` 걸레받이 높이 | 다리발 높이 기준 | `legH − 5` (`extractors.js:917`, `sink.md` §9 EP) · 좌대 걸레받이 = `pedestalH` (`734`, `1221`) |  | mm | 5 여유가 맞는지 |

## 7. 손잡이·목찬넬 최소 수 (`handle_channel`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `handle_qty_basis` 손잡이 수량 기준 | 푸쉬 / 스마트바 / 라운드 / 찬넬·목찬넬 | 붙박이: 푸쉬 도어당 1 · 스마트바·라운드 **모듈당** 1 (`extractors.js:1581-1594`) · 그 밖: 스마트바 모듈당 1, 나머지 도어당 1 (`1597-1610`) |  | EA | 서랍 전면 손잡이(붙박이 "중앙 30 바 핸들", `wardrobe.md` §7)는 코드에 없다 |
| `smartbar_width` 스마트바 폭 | 모듈당 | 30 (`extractors.js:1590`, `wardrobe.md` §5 `SMARTBAR_WIDTH`) |  | mm | |
| `channel_ep_size` 목찬넬 EP 단면 | 상단 전면 / 지면 | 전면 52 × effectiveW · 지면 40 × effectiveW, MDF 18T (`extractors.js:922-923`, 키큰장 단 `720-721`) |  | mm | 따내기 70×40 = 52+18 (`autocalc-rules.md` §9) |
| `channel_min_count` 서랍장 목찬넬 최소 수 | 서랍 2단 / 3단 / 4단 | main 없음 (목찬넬 1장 + 220 피치 옛 규칙) · 96393c0: 상단 1 + 중간 1 / 1 / 2 — "모든 전면이 슬롯 하나에 닿는 최소 수" (2026-09-15 사장님 확정) |  | EA/모듈 | 확정값이면 그대로 옮겨 적는다 |
| `mid_notch` 중간 목찬넬 따내기 | 전면 사이 목찬넬 | main 없음 · 96393c0: 90×40 = 전면판 72 + 지면판 18, 슬롯 30 |  | mm | |
| `top_notch` 상단 목찬넬 따내기 | 하부장 측판 상단 | 70×40 = 52 + 18 (`autocalc-rules.md` §9 `CHANNEL_NOTCH_H/D`) — BOM 은 측판 비고로만 |  | mm | |
| `drawer_front_max` 서랍 최대 단수 | 모듈당 | 붙박이 5 (`wardrobe.md` §7) · 96393c0 싱크 4 |  | 단 | 카테고리별 최대 단수 확정 |

## 8. 상판 (`countertop`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `thickness` 두께 | 선택지 | `specs.topThickness` 기본 12 (`extractors.js:939`) — 문서 선택지 12 / 18 / 50 (`bom-protocol.md` §2) · MCP `materials.countertop.thickness` 30 은 프로토타입 |  | mm | 실제 취급 두께 목록 `[확인 필요]` |
| `material_by_thickness` 두께별 재질 | 12·50 / 18 | 인조대리석 / MDF(도어자재) (`extractors.js:943`) |  | 재질 | PT(포스트폼)·석영석 등 다른 재질이 있는가 |
| `width` 폭 | 하부 라인 | 하부 모듈 폭 합(쿡탑장 포함, 키큰장 단 제외) + 좌·우 마감 폭 (`extractors.js:933-942`) |  | mm | |
| `depth` 깊이 | 품목 | `item.d` 기본 650 (`extractors.js:940`) |  | mm | 몸통 D 550 + 앞 오버행 + 뒤 여유 로 셈하는 규칙 `[확인 필요]` |
| `overhang` 앞 오버행 | 도어 위 | 없음 (`extractors.js:930`) |  | mm | |
| `drip_edge` 물끊기 | 상판 앞·옆 | 없음 — `corner.md` §3.3 의 10 은 **배치 깊이** 규칙이지 상판 가공 규칙이 아니다 |  | mm · 방식 | 홈 가공인지 별도 몰딩인지 |
| `sink_cutout` 개수대 타공 | 싱크볼 종류·폭 (`bom-protocol.md` §5) | 없음 |  | mm (W × D, 모서리 R) | 볼 모델별 표가 있으면 첨부 |
| `cooktop_cutout` 쿡탑 타공 | 쿡탑 폭 (`bom-protocol.md` §5, D 520) | 없음 |  | mm (W × D) | |
| `joint` 이음 | ㄱ·ㄷ자, 장폭 | 품목당 **한 장** — 사용자 결정 2026-09-15 (`extractors.js:931-932`, `sink.md` §9) |  | 최대 길이 mm · 이음 위치 | 원판 길이를 넘을 때 이음 위치 규칙 `[확인 필요]` |
| `backsplash` 백스플래시 | 벽 쪽 | 없음 |  | 높이 mm · 재질 | |

## 9. 좌대 (`pedestal`)

| 항목 | 조건 | 현재 코드 값 | 공장 값 | 단위 | 비고 |
|------|------|------|------|------|------|
| `height` 높이 | 붙박이 / 냉장고장 / 싱크 키큰장 | 60 (`wardrobe.md` §1 · `fridge.md` §3 `PEDESTAL_H` · `sink.md` §5) |  | mm | |
| `box_parts` 상자 구성 | 모듈 W·D | 전후 PB T (W−2T)×60 ×2 · 측 (D−2T−5)×60 ×2 · W ≥ 700 중간보강 1 (`extractors.js:729-732`, 붙박이 `1248-1251` 은 W−30 · D−35) |  | 부재 · 수량 | 15T·18T 몸통에서 식이 다르다 — 정본 식 확정 |
| `kick_board` 좌대 걸레받이 | 라인 폭 | MDF 18T, `pedestalH` × 2440, `totalW > 2440` → 2장 (`extractors.js:1221`, `wardrobe.md` §11) · 키큰장 단은 모듈 W (`734`) |  | mm · 장 | |
| `sink_tall_pedestal` 싱크 키큰장 좌대 | 하부단·통짜 | `wardrobe.md` 규칙 차용 — `sink.md` §5.1 **[확인 필요]** 표시 그대로 |  | 부재 · 수량 | 싱크 키큰장 좌대가 붙박이와 같은 구성인지 |
| `fridge_pedestal` 냉장고장 좌대 | `legType:'pedestal'` | 부재 없음 — fridge 분기가 좌대·EP 를 생략한다 (계획 B2 "냉장고장 좌대·마감재·EP") |  | 부재 · 수량 | |
| `fastening` 좌대 체결 | 좌대 ↔ 몸통 지판 | 없음 |  | 방식 · EA | 스크류/브라켓 종류·개수 |

## 적용 절차

1. **값 확정** — 공장이 「공장 값」을 채워 돌려주면 이 문서에 그대로 옮겨 적는다. 남는 미확정은 `[확인 필요]` 로 남긴다.
   불일치 행(댐퍼·다리발 1200·조절다리·선반 수)은 어느 쪽이 맞는지 답을 받아 규칙 문서(`ACTIVE_RULES.md` §9 · `bom-protocol.md` §4~§6 · `common.md` §8)도 같이 고친다.
2. **`bom-rules.json` 갱신** — `hardware.<key>.<sub_key>` 의 `null` 을 확정값으로 바꾸고 `hardware._asOf` 에 확정일을 적는다.
   시험 `__tests__/bom-rules-hardware-form.test.js` 가 「공장 값이 있는 행 ⇔ JSON 이 null 이 아님」을 본다 — 한쪽만 고치면 실패한다.
3. **extractors 반영 PR** — `HardwareExtractor` 가 `extractOthers` 에 체결구 행을 내고, 경첩·레일·다리발이 확정값을 쓰도록 고친다 (BOM 도메인,
   `agent/bom-missing-*`, 항목마다 독립 PR). 값 출처는 `bom-rules.json` 이 아니라 프론트 상수여도 되지만 **두 곳의 값이 같아야 한다** — 시험으로 잠근다.
4. **골든 재생성** — 값이 바뀌므로 `UPDATE_GOLDEN=1 npx jest __tests__/bom-golden-*.test.js` 로 골든을 다시 굳히고, `UPDATE_BASE_DIGEST=1` 로
   add-only 기준(`test-utils/bom-golden/base-b0.digest.json`)을 갱신하며 커밋 메시지에 바뀐 값의 이유를 적는다 (`test-utils/bom-golden/golden.js` 머리말).
