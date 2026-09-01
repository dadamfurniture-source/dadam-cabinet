// ============================================================
// recolor-prompt.js — 추천 색상안 (전 카테고리 공용)
//
// 왜 필요한가:
//   Step 3 의 카테고리별 alt 는 대부분 '문 열린 내부 구조' 한 장뿐이라
//   같은 프롬프트를 여러 번 돌려도 같은 그림이 나온다. 추천 디자인을 4개로
//   늘리려면 **실제로 갈리는** 변형이 필요하다.
//   싱크대는 이미 ALT_TWO_TONES 로 그렇게 하고 있었다 (sink-prompt.js).
//   그 방식을 전 카테고리가 쓸 수 있게 일반화한 것이 이 파일이다.
//
// 원칙: 색·마감만 바꾸고 **구조·카메라·배경은 픽셀 동일**하게 둔다.
//       레이아웃까지 흔들리면 같은 집의 대안이 아니라 다른 집이 된다.
// ============================================================

/**
 * 마감 조합. 다담이 실제로 쓰는 톤에서 고른다.
 * 한 요청 안에서 **서로 겹치지 않게** 뽑는다 — 겹치면 4장이 2장처럼 보인다.
 */
export const RECOLOR_FINISHES = [
  { key: 'warm-oak', body: 'warm oak woodgrain', accent: 'matte cream', tone: '웜 오크' },
  { key: 'matte-white', body: 'matte pure white', accent: 'light oak', tone: '무광 화이트' },
  {
    key: 'greige',
    body: 'matte greige (warm grey)',
    accent: 'brushed champagne',
    tone: '그레이지',
  },
  { key: 'deep-navy', body: 'deep navy matte', accent: 'warm oak', tone: '딥 네이비' },
  { key: 'clay', body: 'muted clay beige matte', accent: 'soft white', tone: '클레이 베이지' },
  {
    key: 'charcoal',
    body: 'charcoal grey matte',
    accent: 'pale ash woodgrain',
    tone: '차콜 그레이',
  },
  { key: 'sage', body: 'muted sage green matte', accent: 'natural oak', tone: '세이지 그린' },
  { key: 'walnut', body: 'walnut woodgrain', accent: 'matte off-white', tone: '월넛' },
];

/**
 * 시드에서 겹치지 않는 n개를 뽑는다.
 * Math.random 을 쓰지 않는 이유: 같은 요청의 변형들이 서로 다른 것만 보장하면 되고,
 * 재현 가능해야 로그를 보고 무엇이 나왔는지 되짚을 수 있다.
 */
export function pickFinishes(n, seed) {
  const pool = RECOLOR_FINISHES.slice();
  const out = [];
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n && pool.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0; // LCG — 외부 의존 없이 결정적
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}

/**
 * 닫힌문 결과를 입력으로 받아 **색·마감만** 바꾼 또 다른 닫힌문 이미지.
 * 카테고리를 가리지 않는다 — 구조를 건드리지 않기 때문이다.
 *
 * @param {{finish: object, styleName?: string}} p
 */
export function buildRecolorAltSpec(p) {
  const f = p.finish;
  const style = p.styleName ? `${p.styleName} style. ` : '';
  return {
    inputKey: 'closed',
    prompt: `Recolor this built-in furniture photo to an AI-recommended alternate finish:
- Main cabinet bodies and door fronts: ${f.body}
- Secondary / accent panels and open shelving: ${f.accent}
- ${style}Keep the finish consistent across every panel in the image.

KEEP EVERYTHING ELSE PIXEL-IDENTICAL: camera angle, framing, room background, wall and floor,
cabinet layout and proportions, every door and drawer division line, handle style and position,
appliance positions, countertop shape, lighting direction and shadows.
ALL DOORS AND DRAWERS MUST STAY CLOSED — do not open anything, do not show interior contents.
This is a closed-door alternate colour rendering of the SAME furniture in the SAME room.
Photorealistic. No text, no labels, no watermarks.`,
    metadata: {
      alt_style: { name: `AI 추천 · ${f.tone}`, key: f.key, body: f.body, accent: f.accent },
    },
  };
}
