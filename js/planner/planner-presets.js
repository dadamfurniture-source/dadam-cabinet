/**
 * 배치 프리셋 — 일자 · ㄱ자 · ㄷ자 를 한 번에 놓는다 (2026-10-20 플래너 점검, 카드 "배치 프리셋 만들기").
 *
 * 왜: 품목을 고르면 빈 캔버스만 떴다. ㄱ자 하나를 만들려면 하부장을 두 번 놓고, 하나를 우클릭으로
 *   돌리고, 모서리에 맞춰 끌어야 했다. 첫 사각형은 세로(270°)로 놓여 화면 밖으로 반쯤 나가기도 했다.
 *
 * 숫자는 여기서 만들지 않는다:
 *   깊이   = SECTION_CONFIG (planner-sections.js 정본 + 품목 깊이)
 *   본 줄 길이 = 품목 폭(URL w), 없으면 섹션 기본 폭
 *   옆 줄 길이 = 섹션 기본 폭 — 놓은 뒤 치수 칸에서 고친다
 * 좌표 규약은 저장 배치(serializeLayout)와 같다: x·y·w·h 는 회전 전 사각형, 회전은 중심 기준.
 *   회전 0 = 앞(W 변)이 아래(+y), 90 = 앞이 왼쪽, 270 = 앞이 오른쪽 (mockup-shell alignToPerson).
 * ㄱ자는 본 줄 오른쪽 끝 아래로, ㄷ자는 양 끝 아래로 옆 줄이 붙는다 — 구조 단계가 ㄱ자로 읽는 모양이다
 *   (본 줄이 모서리를 품고, 옆 줄은 본 줄 깊이 아래에서 시작한다).
 * 상부장은 본 줄에만 놓는다. 모서리 상부장은 사용자가 더한다.
 */

/** 품목별로 쓸 수 있는 프리셋과 놓을 섹션. 냉장고장은 플래너 밖(기존 화면)이라 없다. */
function plannerPresetPlanOf(categoryId) {
  switch (categoryId) {
    case 'fridge':
      return null;
    case 'wardrobe':
      return { kinds: ['I'], sections: ['wardrobe'] };
    // 신발장·창고장: 품목 폭 그대로 키큰장 한 줄 — 구조 단계가 폭을 나눠 모듈을 세운다 (2026-10-20 사장님 카드 「키큰장 한 줄」).
    //   하부장 + 상부장 줄은 쓰지 않는다. 키큰장 ㄱ자·ㄷ자 모양은 정해진 적이 없어 일자만 둔다.
    case 'shoerack':
    case 'warehouse':
      return { kinds: ['I'], sections: ['tall'] };
    // TV장: 기본 구성은 거실장(하부 한 줄)만 (2026-10-20 결정). 아일랜드: 하부 한 줄 (sink.md 상부장 없음).
    case 'tvcabinet':
    case 'island':
      return { kinds: ['I'], sections: ['lower'] };
    default:
      return { kinds: ['I', 'L', 'U'], sections: ['lower', 'upper'] };
  }
}

/**
 * @param {'I'|'L'|'U'} kind
 * @param {{config: object, categoryId?: string, itemW?: number|string}} opts
 * @returns {{version:1, modules:object[], person:{cx:number, cy:number}} | null}
 */
function plannerPresetLayout(kind, opts) {
  const o = opts || {};
  const cfg = o.config || {};
  const plan = plannerPresetPlanOf(o.categoryId || null);
  if (!plan || plan.kinds.indexOf(kind) < 0) return null;
  const base = plan.sections[0];
  const bc = cfg[base];
  if (!bc) return null;
  const itemW = Number(o.itemW);
  const W = Number.isFinite(itemW) && itemW > 0 ? itemW : bc.w;
  const D = bc.h;
  const S = bc.w;
  const mod = (section, x, y, w, h, rotation) => ({
    section, x, y, w, h, moduleH: cfg[section].moduleH, rotation, finishings: [],
  });
  const modules = [mod(base, 0, 0, W, D, 0)];
  // 옆 줄 — 중심 (cx, cy) 에서 회전 전 사각형으로 되돌린다
  const side = (cx, rotation) => mod(base, cx - S / 2, D + S / 2 - D / 2, S, D, rotation);
  if (kind === 'L' || kind === 'U') modules.push(side(W - D / 2, 90));
  if (kind === 'U') modules.push(side(D / 2, 270));
  if (plan.sections.indexOf('upper') >= 0 && cfg.upper) modules.push(mod('upper', 0, 0, W, cfg.upper.h, 0));
  return { version: 1, modules, person: { cx: W / 2, cy: D + Math.min(900, S / 2) } };
}

if (typeof window !== 'undefined') {
  window.plannerPresetPlanOf = plannerPresetPlanOf;
  window.plannerPresetLayout = plannerPresetLayout;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { plannerPresetPlanOf, plannerPresetLayout };
}
