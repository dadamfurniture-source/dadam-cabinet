# 다담 캐비넷 이미지 생성 — 필수 프롬프트 v3

> Supabase 연동 동적 변수 치환 구조

---

## 조합 공식

```
[앵글] + [현장 마감] + [캐비넷 외관] + [조명] + [네거티브]
```

---

## 1. 앵글 — 원본 사진 매칭 (항상 포함)

```
Maintain the exact same camera angle, height, distance, focal length,
and perspective as the original reference photo.
Match the original composition — same framing, same field of view,
same vanishing points. Do not alter the viewpoint.
```

---

## 2. 현장 마감 (항상 포함)

```
Keep the cabinet exactly as-is.
Any unfinished construction (exposed concrete, primer-only walls,
bare floors, protection paper, debris) should be naturally completed
to a clean, move-in ready residential finish that matches
the overall space context.
Already finished surfaces should remain unchanged.
```

---

## 3. 캐비넷 외관 (Supabase 동적 변수)

### detaildesign 페이지 — 사용자 선택 기반

```
Cabinet doors in {{door_finish}} {{door_color_name}} ({{door_color_hex}}),
{{door_texture_description}},
countertop in {{countertop_color_name}} ({{countertop_texture_description}}),
handles: {{handle_description}},
body panels in {{body_color_name}} with matching edge banding
```

**변수 출처:** `materials` 테이블 → 사용자가 선택한 항목의 컬럼값

| 변수 | Supabase 컬럼 | 예시값 |
|------|--------------|--------|
| `{{door_finish}}` | `materials.finish` | `matte` / `high-gloss` |
| `{{door_color_name}}` | `materials.color_name` | `네이비` |
| `{{door_color_hex}}` | `materials.color_hex` | `#1e3a5f` |
| `{{door_texture_description}}` | `materials.texture_prompt` | `deep navy blue, smooth flat surface with zero wood grain, dead matte finish with no reflection` |
| `{{countertop_color_name}}` | `materials.color_name` (상판) | `스노우` |
| `{{countertop_texture_description}}` | `materials.texture_prompt` (상판) | `pure white engineered stone with subtle quartz flecks, polished surface` |
| `{{handle_description}}` | `materials.texture_prompt` (손잡이) | `routed wooden channel handle at door top edge, 52mm front × 40mm underside, shadow gap underneath` |
| `{{body_color_name}}` | `materials.color_name` (몸통) | `화이트` |

---

### ai-design 페이지 — 스타일 기반

```
{{style_name}} style kitchen cabinet,
{{style_mood_description}},
door color: {{style_door_color}} ({{style_door_hex}}), {{style_door_finish}},
countertop: {{style_countertop_description}},
handles: {{style_handle_description}},
accent details: {{style_accent_description}}
```

**변수 출처:** `styles` 테이블 → 사용자가 선택한 스타일의 컬럼값

| 변수 | Supabase 컬럼 | 예시값 |
|------|--------------|--------|
| `{{style_name}}` | `styles.name` | `모던 스칸디나비안` |
| `{{style_mood_description}}` | `styles.mood_prompt` | `warm minimalist Scandinavian aesthetic, clean lines, natural materials, cozy but uncluttered` |
| `{{style_door_color}}` | `styles.door_color_name` | `화이트` |
| `{{style_door_hex}}` | `styles.door_color_hex` | `#f8fafc` |
| `{{style_door_finish}}` | `styles.door_finish` | `matte` |
| `{{style_countertop_description}}` | `styles.countertop_prompt` | `light oak butcher block countertop, visible natural wood grain, matte oiled finish` |
| `{{style_handle_description}}` | `styles.handle_prompt` | `handleless push-to-open, flat surface, 3mm shadow gap between doors only` |
| `{{style_accent_description}}` | `styles.accent_prompt` | `matte black faucet, white subway tile backsplash, open shelf with ceramic pots` |

---

## 4. 조명 (항상 포함)

```
Match the original photo's lighting direction but enhance to
soft natural daylight, reduce harsh shadows, add gentle ceiling bounce fill
```

---

## 5. 네거티브 (항상 포함)

```
Avoid: warped doors, visible screws on faces, uneven gaps over 5mm,
exposed raw PB edges without banding, Western raised-panel style,
oversaturated HDR, fish-eye distortion, cluttered countertops
```

---

## 완성 프롬프트 조립 예시

### detaildesign — 네이비 무광 + 목찬넬 선택 시

```
Maintain the exact same camera angle, height, distance, focal length,
and perspective as the original reference photo.

Keep the cabinet exactly as-is.
Any unfinished construction (exposed concrete, primer-only walls,
bare floors, protection paper, debris) should be naturally completed
to a clean, move-in ready residential finish that matches
the overall space context.
Already finished surfaces should remain unchanged.

Cabinet doors in matte 네이비 (#1e3a5f),
deep navy blue, smooth flat surface with zero wood grain, dead matte finish with no reflection,
countertop in 스노우 (pure white engineered stone with subtle quartz flecks, polished surface),
handles: routed wooden channel handle at door top edge, 52mm front × 40mm underside, shadow gap underneath,
body panels in 화이트 with matching edge banding.

Match the original photo's lighting direction but enhance to
soft natural daylight, reduce harsh shadows, add gentle ceiling bounce fill.

Avoid: warped doors, visible screws on faces, uneven gaps over 5mm,
exposed raw PB edges without banding, Western raised-panel style,
oversaturated HDR, fish-eye distortion, cluttered countertops
```

### ai-design — 모던 스칸디나비안 스타일 선택 시

```
Maintain the exact same camera angle, height, distance, focal length,
and perspective as the original reference photo.

Keep the cabinet exactly as-is.
Any unfinished construction (exposed concrete, primer-only walls,
bare floors, protection paper, debris) should be naturally completed
to a clean, move-in ready residential finish that matches
the overall space context.
Already finished surfaces should remain unchanged.

모던 스칸디나비안 style kitchen cabinet,
warm minimalist Scandinavian aesthetic, clean lines, natural materials, cozy but uncluttered,
door color: 화이트 (#f8fafc), matte,
countertop: light oak butcher block countertop, visible natural wood grain, matte oiled finish,
handles: handleless push-to-open, flat surface, 3mm shadow gap between doors only,
accent details: matte black faucet, white subway tile backsplash, open shelf with ceramic pots.

Match the original photo's lighting direction but enhance to
soft natural daylight, reduce harsh shadows, add gentle ceiling bounce fill.

Avoid: warped doors, visible screws on faces, uneven gaps over 5mm,
exposed raw PB edges without banding, Western raised-panel style,
oversaturated HDR, fish-eye distortion, cluttered countertops
```

---

## Supabase 테이블 구조 (권장)

### `materials` 테이블
```sql
id              UUID PRIMARY KEY
category        TEXT    -- 'door' / 'countertop' / 'handle' / 'body'
color_name      TEXT    -- '화이트', '네이비', '스노우' 등
color_hex       TEXT    -- '#f8fafc'
finish          TEXT    -- 'matte' / 'high-gloss'
texture_prompt  TEXT    -- AI에게 전달할 질감 묘사 영문 프롬프트
thumbnail_url   TEXT    -- UI 미리보기용 이미지
sort_order      INT
is_active       BOOL DEFAULT true
```

### `styles` 테이블
```sql
id                      UUID PRIMARY KEY
name                    TEXT    -- '모던 스칸디나비안', '인더스트리얼' 등
mood_prompt             TEXT    -- 스타일 분위기 영문 프롬프트
door_color_name         TEXT    -- 추천 도어 색상명
door_color_hex          TEXT
door_finish             TEXT
countertop_prompt       TEXT    -- 상판 질감 영문 프롬프트
handle_prompt           TEXT    -- 손잡이 영문 프롬프트
accent_prompt           TEXT    -- 악센트 소품 영문 프롬프트
thumbnail_url           TEXT
sort_order              INT
is_active               BOOL DEFAULT true
```

### 프롬프트 조립 (프론트 JS 의사코드)
```javascript
// detaildesign 페이지
const door = await supabase.from('materials').select('*').eq('id', selectedDoorId);
const countertop = await supabase.from('materials').select('*').eq('id', selectedCountertopId);
const handle = await supabase.from('materials').select('*').eq('id', selectedHandleId);

const prompt = `
${ANGLE_PROMPT}
${FINISHING_PROMPT}
Cabinet doors in ${door.finish} ${door.color_name} (${door.color_hex}),
${door.texture_prompt},
countertop in ${countertop.color_name} (${countertop.texture_prompt}),
handles: ${handle.texture_prompt},
body panels in ${body.color_name} with matching edge banding.
${LIGHTING_PROMPT}
${NEGATIVE_PROMPT}
`;

// ai-design 페이지
const style = await supabase.from('styles').select('*').eq('id', selectedStyleId);

const prompt = `
${ANGLE_PROMPT}
${FINISHING_PROMPT}
${style.name} style kitchen cabinet,
${style.mood_prompt},
door color: ${style.door_color_name} (${style.door_color_hex}), ${style.door_finish},
countertop: ${style.countertop_prompt},
handles: ${style.handle_prompt},
accent details: ${style.accent_prompt}.
${LIGHTING_PROMPT}
${NEGATIVE_PROMPT}
`;
```
