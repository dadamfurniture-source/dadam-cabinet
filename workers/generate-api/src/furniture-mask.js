/**
 * 기본안에서 가구 자리 찾기 (2026-10-19).
 *
 * 추천안 되붙이기는 "가구 안은 추천안, 밖은 기본안" 이다. 처음에는 덩어리 합성 때 칠한 자리(방 사진 기준)를
 * 썼는데, GPT 가 기본안을 그리며 장을 위로·옆으로 옮겼다 (10/19 싱크대: 상부장이 덩어리보다 4% 위, 하부장이
 * 좌우로 더 넓게). 그 결과 상부장 윗단·오른쪽 서랍은 기본안 흰색으로 남아 한 문짝이 두 색으로 잘렸다.
 * 그래서 다 그려진 기본안을 Haiku 에게 보여 주고 가구 덩어리마다 바깥 윤곽을 받는다 — 되붙이기는 그 윤곽을 쓴다.
 * 실패하면 null — 호출하는 쪽은 덩어리 합성 자리로 되돌아간다.
 */

/**
 * @param {'kitchen'|'wardrobe'} kind 덩어리 합성의 종류 (ck.guide.kind)
 * @param {{width:number, height:number}} size 보내는 그림의 픽셀 크기
 */
export function buildFurnitureMaskPrompt(kind, size) {
  const kitchen = kind === 'kitchen';
  const what = kitchen ? 'a fitted kitchen (base cabinets with worktop, wall cabinets above)' : 'a built-in wardrobe';
  const blocks =
    !kitchen
      ? 'The wardrobe is usually one block from floor to ceiling.'
      : 'Give the wall-cabinet run and the base-cabinet run (worktop and plinth included) as separate blocks; a tall unit is its own block.';
  return `This render shows ${what} newly installed in a room. Return JSON only, no prose.
The image is ${size.width} x ${size.height} pixels. Every point is [x, y] in those pixels, with [0, 0] at the top-left corner.
{"blocks":[{"name":string,"outline":[[x,y],...]}]}
Each block is one run of furniture. outline = 4 to 8 corner points, in order around it, tracing the outer silhouette of that block exactly: every door and drawer front, the visible end panels, the underside if visible, fillers, the plinth and, for base cabinets, the worktop edge. ${blocks}
Do not include walls, backsplash tiles, the floor, the ceiling, lights or free-standing appliances.`;
}

const XY = { type: 'array', items: { type: 'number' } };
export const FURNITURE_MASK_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, outline: { type: 'array', items: XY } },
        required: ['name', 'outline'],
        additionalProperties: false,
      },
    },
  },
  required: ['blocks'],
  additionalProperties: false,
};

/** 볼록 껍질 (monotone chain). 점 순서가 엉켜 와도 되붙이기의 볼록 다각형 판정이 맞게 한다. */
export function convexHull(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cr(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cr(upper.at(-2), upper.at(-1), q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function areaOf(P) {
  let a = 0;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * 모델 응답 → 볼록 다각형 목록 (0~1). 쓸 만한 덩어리가 없으면 null.
 * 너무 작은(0.3% 미만) 것은 버리고, 사진 대부분(75% 넘게)을 덮는 것은 잘못 읽은 것으로 보고 전부 버린다.
 */
export function parseFurnitureMask(input, size) {
  let j = input && typeof input === 'object' ? input : null;
  if (!j) {
    const m = typeof input === 'string' && input.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      j = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(j.blocks) || !size) return null;
  const polys = [];
  for (const b of j.blocks) {
    if (!b || !Array.isArray(b.outline)) continue;
    const pts = b.outline
      .filter((v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n))))
      .map(([x, y]) => ({ x: Math.min(1, Math.max(0, Number(x) / size.width)), y: Math.min(1, Math.max(0, Number(y) / size.height)) }));
    if (pts.length < 3) continue;
    const hull = convexHull(pts);
    const a = hull.length >= 3 ? areaOf(hull) : 0;
    if (a > 0.75) return null;
    if (a >= 0.003) polys.push(hull);
  }
  return polys.length ? polys : null;
}
