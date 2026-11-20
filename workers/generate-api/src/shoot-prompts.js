/**
 * 홍보용 「촬영 연출」 프롬프트 (2026-11-20, 대표님 "다양한 구조로 실제 사진 작가가 찍은 것처럼").
 *
 * 연출컷(prompts.js)은 고객이 올린 방 사진을 고친다. 이쪽은 사진 없이 한국 아파트의 한 장면을 새로 찍는다 —
 * SNS · 블로그에 올릴 「같은 주방, 다른 색」 시리즈의 바탕 사진이다.
 *
 * 한 장 = 품목 × 구조 × 평형 × 촬영(렌즈 · 자리) × 빛 × 소품 × 색 조합 × 자재(상판 · 바닥 · 식탁).
 *   - 자재 축은 2026-11-20 대표님 "식탁의 재질, 자재 종류도 다양하게". 가구 문 색은 색 조합이 정하고, 그 밖의 재질만 돌린다.
 *   - 색 조합은 prompts.js 의 TWO_TONES 여덟 그대로이되, 색마다 예림 LUX 도어 자재 하나를 잇는다 (SHOOT_YERIM →
 *     SHOOT_TONES, 2026-11-20 대표님 "색상 이름을 예림에서 쓰는 자재와 같은 이름으로"). 사진에 찍는 이름이 자재 이름이고,
 *     프롬프트에는 그 자재의 색값을 적는다. 그림 속 색은 빛에 따라 달라지므로 실제 자재와 꼭 같지는 않다.
 *   - 손잡이는 CLAUDE.md 규칙 그대로 매립형. 문장은 prompts.js 의 HANDLES_LINE 과 같아야 한다 (시험이 본다).
 *   - 사람 · 글자 · 상표는 넣지 않는다. 「AI 연출」 표시는 올리기 전에 따로 찍는다 (그림 속 글자는 모델이 틀리게 쓴다).
 *
 * planShoots 는 시드가 같으면 같은 목록을 낸다 — 어떤 사진을 어떤 조건으로 찍었는지 되짚을 수 있다.
 */

import { TWO_TONES } from './prompts.js';

/**
 * 색 조합의 색 말 → 예림 LUX 도어 자재. 코드 · 이름 · 색값은 database/seed/yerim-lux.json 과 같아야 한다
 * (test/shoot-prompts.test.js 가 맞춰 본다). text 는 프롬프트에 적는 말 — 자재 이름 · 상표는 그림에 넣지 않는다.
 * 고른 기준: 도어 자재(door_material) 가운데 색값이 가장 가까운 것.
 */
export const SHOOT_YERIM = {
  'cream white matte': {
    code: 'SM-16',
    name: '매트 아이보리',
    hex: '#f5eddc',
    text: 'ivory cream matte',
  },
  'walnut woodgrain': {
    code: 'PW-23',
    name: '카카오월넛',
    hex: '#544135',
    text: 'cocoa-brown walnut woodgrain with a vertical grain',
  },
  'matte black': { code: 'SM-08', name: '매트 블랙', hex: '#272727', text: 'matte black' },
  'natural oak woodgrain': {
    code: 'YPW-04',
    name: '세이오크',
    hex: '#cea875',
    text: 'light honey oak woodgrain with a vertical grain',
  },
  'sage green matte': {
    code: 'SM-15',
    name: '매트 미스트그린',
    hex: '#a5afa0',
    text: 'pale misty grey-green matte, light and desaturated',
  },
  'navy blue matte': {
    code: 'SM-12',
    name: '매트 인디고',
    hex: '#2e2f3f',
    text: 'very dark indigo navy matte',
  },
  'warm beige matte': {
    code: 'YPA-03',
    name: '아크 샌드듄',
    hex: '#cdc2b4',
    text: 'sand beige matte',
  },
  'warm white matte': {
    code: 'SM-02',
    name: '매트 밀크화이트',
    hex: '#fffef8',
    text: 'milk white matte',
  },
  'smoked oak woodgrain': {
    code: 'HW1064',
    name: '오크딥',
    hex: '#604b39',
    text: 'deep brown oak woodgrain with a vertical grain',
  },
  'terracotta matte': {
    code: 'YPA-09',
    name: '아크 마멀레이드',
    hex: '#d4612a',
    text: 'burnt orange matte',
  },
  'soft grey matte': {
    code: 'SM-20',
    name: '매트 라이트그레이',
    hex: '#bababa',
    text: 'light neutral grey matte',
  },
  'pure white matte': {
    code: 'SM-01',
    name: '매트 화이트',
    hex: '#fbfbfb',
    text: 'pure white matte',
  },
  'greige matte': {
    code: 'SM-21',
    name: '매트 샌드그레이',
    hex: '#d4cfc8',
    text: 'pale sand-grey matte',
  },
};

/**
 * 촬영에 쓰는 색 조합 — TWO_TONES 와 같은 여덟(key 도 같다)에 예림 자재를 이은 것.
 * upper · lower 는 프롬프트 말(색값 포함), tone 은 사진에 찍는 이름, plain 은 예전 이름(「크림 · 월넛」).
 */
export const SHOOT_TONES = TWO_TONES.map((t) => {
  const u = SHOOT_YERIM[t.upper];
  const l = SHOOT_YERIM[t.lower];
  return {
    key: t.key,
    upper: `${u.text} (colour ${u.hex})`,
    lower: `${l.text} (colour ${l.hex})`,
    tone: `${u.name} · ${l.name}`,
    plain: t.tone,
    materials: [u.code, l.code],
  };
});

/** 예전 이름(「크림 · 월넛」)이나 key 로 촬영용 색 조합을 찾는다. 없으면 undefined. */
export function shootTone(keyOrPlain) {
  return SHOOT_TONES.find(
    (t) => t.key === keyOrPlain || t.plain === keyOrPlain || t.tone === keyOrPlain
  );
}

/** prompts.js 의 HANDLES_LINE 과 같은 문장 (그쪽은 내보내지 않아 옮겨 적었다 — test/shoot-prompts.test.js 가 맞춰 본다). */
export const SHOOT_HANDLES_LINE =
  'HANDLES: none. Every door and drawer is a flat handleless front; lower doors open by reaching behind the door edge. No bar handles, knobs, chrome hardware or push-to-open buttons.';

/**
 * 품목 → 구조. scene 은 가구 배치, split 은 두 색을 어디에 나눠 칠하는지.
 * 품목 차례는 대표님 주력 순서: 주방 → 붙박이장 · 드레스룸 → 냉장고장 · 홈카페장 · 수납장.
 */
export const SHOOT_SUBJECTS = {
  kitchen: {
    label: '주방',
    split: (p) =>
      `Wall cabinets and any tall units: ${p.upper}. Base cabinets, drawers and any island or peninsula: ${p.lower}.`,
    layouts: [
      {
        key: 'one-wall',
        label: '일자형',
        scene:
          'A single-wall kitchen: one straight run about 3.6 m long with base cabinets under a countertop, wall cabinets above that reach the ceiling, an undermount sink with a matte tap and a flush induction hob under a slim concealed hood. A dining table for four with chairs stands parallel to the run.',
      },
      {
        key: 'l-shape',
        label: 'ㄱ자형',
        scene:
          'An L-shaped kitchen wrapping one corner: the long leg carries the hob and wall cabinets to the ceiling, the short leg carries the sink under a small frosted window that opens to the utility balcony. A tall unit with a built-in oven closes one end. A dining table with chairs stands on the open floor in front of the kitchen.',
      },
      {
        key: 'u-shape',
        label: 'ㄷ자형',
        scene:
          'A U-shaped kitchen on three sides of the cook: base cabinets and countertop run along all three walls, wall cabinets to the ceiling on two of them, the third side kept open above the countertop toward the dining area, where a dining table with chairs stands.',
      },
      {
        key: 'peninsula',
        label: '대면형',
        scene:
          'A kitchen facing the living room: a back wall of wall and base cabinets with the hob, and in front of it a peninsula with the sink and a breakfast overhang with two stools, so the cook looks toward the living room.',
      },
      {
        key: 'island',
        label: '아일랜드형',
        scene:
          'A wall of full-height tall cabinets with a built-in oven and an integrated refrigerator behind matching fronts, and in front of it a freestanding island whose countertop folds down one end as a waterfall, an induction hob and three stools. Two small pendants hang over the island.',
      },
    ],
  },
  wardrobe: {
    label: '붙박이장 · 드레스룸',
    split: (p) =>
      `Door fronts: ${p.upper}. Open-shelf niches, visible side panels and the drawer fronts: ${p.lower}.`,
    layouts: [
      {
        key: 'bedroom-wall',
        label: '안방 한 벽 붙박이장',
        scene:
          'A built-in wardrobe filling one whole wall of the main bedroom, floor to ceiling, with tall hinged doors and one open niche bay of shelves at one end. A low bed with linen bedding and a bedside table stand in front, off to one side.',
      },
      {
        key: 'dress-l',
        label: '드레스룸 ㄱ자',
        scene:
          'A walk-in dressing room in an L shape: full-height wardrobes on two walls, part with closed doors and part open with a hanging rail of clothes in muted tones, a bank of drawers at waist height and soft LED strips recessed under the shelves.',
      },
      {
        key: 'dress-parallel',
        label: '드레스룸 11자',
        scene:
          'A dressing room with two full-height wardrobe runs facing each other across a narrow aisle, a tall narrow window at the far end, an open hanging section on one side and closed doors on the other, and a small bench in the aisle.',
      },
      {
        key: 'desk-niche',
        label: '작은방 붙박이장 + 책상',
        scene:
          'A small bedroom wall of built-in wardrobes to the ceiling with a desk niche in the middle: a floating desktop, two open shelves above it with a recessed light, and a simple chair.',
      },
    ],
  },
  storage: {
    label: '냉장고장 · 홈카페장 · 수납장',
    split: (p) =>
      `Tall door fronts: ${p.upper}. The back and sides of open niches, the drawer fronts and any low units: ${p.lower}.`,
    layouts: [
      {
        key: 'fridge-wall',
        label: '냉장고장',
        scene:
          'A wall of full-height cabinets built around a refrigerator: the refrigerator sits flush between tall pantry cabinets with a bridging cabinet above it, so the whole wall reads as one flat plane to the ceiling.',
      },
      {
        key: 'home-cafe',
        label: '홈카페장',
        scene:
          'A home-café station built into a wall of tall cabinets: a recessed open niche at counter height with a ledge holding an espresso machine, a kettle and a short row of cups, a shelf above it lit by a concealed LED strip, and deep drawers below.',
      },
      {
        key: 'dining-storage',
        label: '다이닝 수납장',
        scene:
          'A dining room storage wall: tall cabinets at both ends and a long low sideboard between them with an open display niche above, beside a dining table with four chairs.',
      },
    ],
  },
};

/** 평형 — 한국 아파트의 방 크기 · 천장 높이 단서. */
export const SHOOT_HOMES = [
  { key: '59', label: '24평', room: 'a compact 59 m² Korean apartment with a 2.3 m ceiling' },
  {
    key: '84',
    label: '34평',
    room: 'an 84 m² Korean apartment with a 2.3 m ceiling',
  },
  { key: '114', label: '40평대', room: 'a spacious 114 m² Korean apartment with a 2.4 m ceiling' },
];

/** 촬영 — 렌즈와 서는 자리. 작가가 한 집에서 찍는 컷 종류를 그대로. */
export const SHOOT_SHOTS = [
  {
    key: 'wide-straight',
    label: '정면 광각',
    camera:
      'One-point architectural view with the camera square to the main run of furniture. 24 mm tilt-shift lens on a full-frame camera, on a tripod at 1.25 m, f/8. Every vertical line is perfectly straight.',
  },
  {
    key: 'three-quarter',
    label: '모서리에서 비스듬히',
    camera:
      'Two-point view from a corner of the room so the furniture recedes in depth. 28 mm lens on a full-frame camera, on a tripod at 1.3 m, f/8, verticals kept straight.',
  },
  {
    key: 'doorway',
    label: '문틀 너머',
    camera:
      'Seen from the next room through an open doorway: one door jamb, softly out of focus, frames a side of the picture. 35 mm lens, f/4, camera at 1.35 m.',
  },
  {
    key: 'across-table',
    label: '가구 너머',
    camera:
      'Seen across a piece of furniture: a table edge or chair back sits soft and dark in the lower foreground and the built-in furniture is sharp behind it. 35 mm lens, f/5.6, camera at 1.2 m.',
  },
  {
    key: 'vignette',
    label: '한쪽 끝 반 장면',
    camera:
      'A half-scene of one end of the furniture at eye level, composed off-centre with empty wall on one side. 50 mm lens, f/4.',
  },
  {
    key: 'detail',
    label: '두 색이 만나는 곳',
    camera:
      'A close detail where the two finishes meet, with both colours clearly in frame and one styled object nearby. 85 mm lens at f/2.8, shallow depth of field, the rest of the room melting into blur.',
  },
];

/** 빛 — 시간대. */
export const SHOOT_LIGHTS = [
  {
    key: 'overcast',
    label: '흐린 낮',
    light:
      'Soft overcast daylight from the window, no direct sun: even, gentle falloff into the room and soft-edged shadows under the wall cabinets and objects.',
  },
  {
    key: 'morning',
    label: '아침 해',
    light:
      'Low morning sun enters from one side through sheer curtains and lays a warm patch of light with soft window-frame shadows across the floor and the lower fronts, while the far side of the room stays naturally darker.',
  },
  {
    key: 'afternoon',
    label: '늦은 오후',
    light:
      'Late-afternoon side light, warm and slightly golden, with long soft shadows and a gentle gradient across the door fronts.',
  },
  {
    key: 'dusk',
    label: '해 질 녘',
    light:
      'Blue hour: the window shows deep blue evening sky, a concealed LED strip and one pendant or lamp are on, making warm pools of light. The mix of cool window light and warm lamps is left natural.',
  },
];

/** 소품 — 스타일리스트가 놓은 듯 조금만. 품목마다 다르다. */
export const SHOOT_PROPS = {
  kitchen: [
    'a ceramic bowl of lemons, a wooden cutting board leaning on the wall and a folded linen towel',
    'a matte kettle, two stoneware cups and a small glass vase with one green branch',
    'a cast-iron pot on the hob, a jar of wooden spoons and an open cookbook',
    'a loaf of bread on a board, a pepper mill and a small potted herb',
  ],
  wardrobe: [
    'a woven basket, two folded knit sweaters and a small ceramic tray',
    'a linen shirt on a wooden hanger, a leather bag and a stack of three books',
    'a round mirror leaning on the floor, a wool throw and a pair of slippers',
  ],
  storage: [
    'a small tray of cups, a jar of coffee beans and a linen napkin',
    'a ceramic vase with dried branches, two stacked plates and a candle',
    'a glass carafe, a wooden tray and a small framed print leaning on the shelf',
  ],
};

/**
 * 상판 · 벽 자재 (주방 · 수납장). 조리대와 그 위 벽, 니치 선반까지 같은 계열로.
 */
export const SHOOT_SURFACES = [
  {
    key: 'quartz-white',
    label: '엔지니어드 스톤 · 화이트',
    text: 'white engineered-stone countertop with fine grey veining and a 20 mm square edge; the backsplash is the same slab',
  },
  {
    key: 'ceramic-beige',
    label: '세라믹 · 베이지',
    text: 'warm beige sintered-ceramic countertop with a thin 12 mm edge and a matte, slightly textured face; the backsplash is the same slab',
  },
  {
    key: 'solid-surface',
    label: '인조대리석 · 무광 화이트',
    text: 'seamless matte white solid-surface countertop with an integrated moulded sink; the backsplash is small glazed off-white square tiles with fine grout lines',
  },
  {
    key: 'stainless',
    label: '스테인리스 · 헤어라인',
    text: 'brushed stainless-steel countertop with a welded sink and fine hairline scratches that catch the light; the backsplash is plain painted wall with a low stainless upstand',
  },
  {
    key: 'dark-stone',
    label: '다크 스톤 · 혼드',
    text: 'honed charcoal-grey stone countertop with soft white veining; the backsplash is the same stone',
  },
  {
    key: 'terrazzo',
    label: '테라조',
    text: 'pale terrazzo countertop with small cream, grey and ochre chips; the backsplash is smooth hand-trowelled plaster in off-white',
  },
];

/** 바닥재. */
export const SHOOT_FLOORS = [
  {
    key: 'oak-plank',
    label: '오크 마루',
    text: 'pale oak wide-plank flooring with a matte finish',
  },
  {
    key: 'porcelain',
    label: '포세린 타일',
    text: 'large-format 600 × 1200 mm matte beige-grey porcelain floor tiles with thin grout lines',
  },
  { key: 'herringbone', label: '헤링본 마루', text: 'natural oak herringbone parquet flooring' },
  {
    key: 'walnut-plank',
    label: '월넛 톤 마루',
    text: 'medium-brown walnut-tone plank flooring with a low sheen',
  },
];

/** 식탁 · 의자 재질 (주방 · 수납장 장면의 식탁, 스툴, 의자). */
export const SHOOT_TABLES = [
  {
    key: 'ceramic',
    label: '세라믹 식탁',
    text: 'a matte sintered-ceramic top in warm white on slim black steel legs, with chairs upholstered in oatmeal bouclé',
  },
  {
    key: 'travertine',
    label: '트래버틴 식탁',
    text: 'an unfilled travertine top on a solid travertine plinth base, with dark-stained oak chairs',
  },
  {
    key: 'oak-round',
    label: '오크 원목 원형 식탁',
    text: 'solid white oak with a round top on a single pedestal, with oak chairs with woven paper-cord seats',
  },
  {
    key: 'walnut',
    label: '월넛 원목 식탁',
    text: 'solid walnut with visible grain and softly rounded edges, with black leather sling chairs',
  },
  {
    key: 'terrazzo',
    label: '테라조 식탁',
    text: 'a terrazzo top with cream and grey chips on a powder-coated sand-coloured steel frame, with moulded plywood chairs',
  },
  {
    key: 'glass-steel',
    label: '유리 · 스테인리스 식탁',
    text: 'a smoked glass top on a brushed stainless-steel trestle base, with tubular steel cantilever chairs with cane seats',
  },
];

/** 곁가구 재질 (붙박이장 · 드레스룸 장면의 침대, 벤치, 의자, 협탁). */
export const SHOOT_SOFT = [
  { key: 'oak-linen', label: '오크 · 리넨', text: 'pale oak with natural linen upholstery' },
  { key: 'walnut-leather', label: '월넛 · 가죽', text: 'walnut with tan leather upholstery' },
  {
    key: 'rattan-boucle',
    label: '라탄 · 부클레',
    text: 'rattan cane with cream bouclé upholstery',
  },
  {
    key: 'steel-wool',
    label: '블랙 스틸 · 울',
    text: 'slim black steel with grey wool felt upholstery',
  },
];

/** 「그림이 아니라 사진」 — 모델이 3D 렌더처럼 그리는 버릇을 막는 줄들. */
const PHOTO_LINES = [
  'This is a real photograph taken on location by a professional interior photographer for a design magazine. It must not look like a 3D render or an illustration.',
  'Exposure is natural: highlights roll off gently at the window, shadows keep real depth, nothing glows. No HDR look, no over-sharpening, no oversaturated colour.',
  'Materials behave like real ones: matte fronts show a faint soft sheen and 2-3 mm reveals between doors, woodgrain runs vertically with natural variation and never repeats, the countertop reflects the room softly as its real material would, and there are small imperfections such as a slightly uneven curtain fold.',
  'The lens leaves its trace: true perspective for the stated focal length, a faint vignette and fine sensor grain.',
  'The room is lived-in but tidy, styled by a person: objects sit off-centre and nothing is perfectly symmetrical.',
  'Colour is graded neutral with white balance true to the light.',
];

const ROOM_LINE =
  'The room is finished like a recent Korean apartment: plain off-white walls, a flat white ceiling with a few small recessed downlights and an aluminium sliding window with sheer curtains through which neighbouring apartment towers are only faintly visible.';

const CLEAN_LINE =
  'All doors and drawers are closed. No people, no pets, no text, no logos, no watermark and no brand names on appliances.';

/** 시드로 목록을 섞는다 (prompts.js pickFinishes 와 같은 선형 합동). */
function shuffled(list, seed) {
  const pool = list.slice();
  const out = [];
  let s = seed >>> 0 || 1;
  while (pool.length) {
    s = (s * 1103515245 + 12345) >>> 0;
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}

/** 품목 차례 — 주방을 가장 자주 (대표님 주력 순서). 넷 가운데 둘이 주방. */
const SUBJECT_CYCLE = ['kitchen', 'wardrobe', 'kitchen', 'storage'];

/**
 * 찍을 목록을 짠다. 축마다 시드로 섞은 차례를 돌려 쓰므로 구조 · 촬영 · 빛 · 색이 고르게 나오고 바로 되풀이되지 않는다.
 * @param {object} [o]
 * @param {number} [o.count=6]
 * @param {number} [o.seed=1]
 * @param {string[]} [o.subjects]  품목을 좁힐 때 (예: ['kitchen'])
 * @returns {{id:string, subject:string, layout:object, home:object, shot:object, light:object, props:string, tone:object, surface:object|null, floor:object, table:object}[]}
 */
export function planShoots({ count = 6, seed = 1, subjects } = {}) {
  const cycle =
    subjects && subjects.length ? SUBJECT_CYCLE.filter((s) => subjects.includes(s)) : SUBJECT_CYCLE;
  const order = cycle.length ? cycle : SUBJECT_CYCLE;
  const layouts = {};
  const props = {};
  const used = {};
  Object.keys(SHOOT_SUBJECTS).forEach((k, i) => {
    layouts[k] = shuffled(SHOOT_SUBJECTS[k].layouts, seed + 11 * (i + 1));
    props[k] = shuffled(SHOOT_PROPS[k], seed + 17 * (i + 1));
    used[k] = 0;
  });
  const shots = shuffled(SHOOT_SHOTS, seed + 3);
  const lights = shuffled(SHOOT_LIGHTS, seed + 5);
  const homes = shuffled(SHOOT_HOMES, seed + 7);
  const tones = shuffled(SHOOT_TONES, seed + 9);
  const surfaces = shuffled(SHOOT_SURFACES, seed + 13);
  const floors = shuffled(SHOOT_FLOORS, seed + 19);
  const tables = shuffled(SHOOT_TABLES, seed + 23);
  const softs = shuffled(SHOOT_SOFT, seed + 29);
  let dining = 0; // 주방 · 수납장 장면을 센다 — 상판과 식탁이 이 차례로 돈다
  let rooms = 0; // 붙박이장 · 드레스룸 장면
  const out = [];
  for (let i = 0; i < count; i++) {
    const subject = order[i % order.length];
    const n = used[subject]++;
    const layout = layouts[subject][n % layouts[subject].length];
    const tone = tones[i % tones.length];
    const isRoom = subject === 'wardrobe';
    const d = isRoom ? rooms++ : dining++;
    out.push({
      id: `${String(i + 1).padStart(2, '0')}-${subject}-${layout.key}-${tone.key}`,
      subject,
      layout,
      home: homes[i % homes.length],
      shot: shots[i % shots.length],
      light: lights[i % lights.length],
      props: props[subject][n % props[subject].length],
      tone,
      surface: isRoom ? null : surfaces[d % surfaces.length],
      floor: floors[i % floors.length],
      table: isRoom ? softs[d % softs.length] : tables[d % tables.length],
    });
  }
  return out;
}

/** 한 장의 프롬프트 (사진 입력 없이 새로 찍는다). */
export function buildShootPrompt(s) {
  const subj = SHOOT_SUBJECTS[s.subject];
  return [
    `An interior photograph of built-in furniture in ${s.home.room}.`,
    `SCENE: ${s.layout.scene}`,
    `FINISH: ${subj.split(s.tone)} Fronts are flat slab doors, matte.`,
    ...(s.surface
      ? [`SURFACES: ${s.surface.text}. Every countertop and ledge in the picture is this material.`]
      : []),
    s.subject === 'wardrobe'
      ? `LOOSE FURNITURE: any bed frame, bench, chair or side table in the picture is ${s.table.text}.`
      : `LOOSE FURNITURE: any dining table, stools and chairs in the picture: ${s.table.text}. Stools follow the same materials.`,
    SHOOT_HANDLES_LINE,
    `CAMERA: ${s.shot.camera}`,
    `LIGHT: ${s.light.light}`,
    `STYLING: only a few everyday objects — ${s.props}.`,
    `ROOM: ${ROOM_LINE} FLOOR: ${s.floor.text}.`,
    ...PHOTO_LINES,
    CLEAN_LINE,
  ].join('\n');
}

/**
 * 시리즈용 — 찍은 사진의 가구 색만 다른 조합으로 바꾼다 (「같은 주방, 다른 색」의 둘째 장부터).
 * 첫 이미지가 바꿀 사진이다.
 */
export function buildShootRecolourPrompt(s, tone) {
  const subj = SHOOT_SUBJECTS[s.subject];
  return [
    'Recolour only the built-in furniture in this photograph.',
    `FINISH: ${subj.split(tone)}`,
    'Keep everything else exactly as photographed: camera position and lens, framing, light and every shadow, the countertop, walls, ceiling, floor, window, appliances and each styled object. The door divisions, reveals and proportions of the furniture stay the same.',
    SHOOT_HANDLES_LINE,
    'The result is the same real photograph with different furniture finishes: natural exposure, real material grain, no render look.',
    CLEAN_LINE,
  ].join('\n');
}
