/**
 * 골든 픽스처 — 브리지 계약(`buildPlannerPayload`)을 잠그는 기준점.
 *
 * 계획의 불변식 1: "payload 가 골든 3종에 대해 바이트 동일". 엔진 분리·모델 전환·런 도입 등
 * 모든 리팩터 단계가 이 비교를 통과해야 한다. 의도적으로 바꾸는 단계만 골든을 갱신하고,
 * 그 갱신은 **별도 커밋**으로 분리해 diff 가 리뷰에 드러나게 한다.
 *
 * 픽스처는 `dadam_layout_v1` 에 들어가는 배치 JSON 그대로다(= 배치 단계의 출력).
 */

/** 직선 싱크대 — 하부 3 · 상부 2 (가장 흔한 형태) */
const straight = {
  version: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  person: { cx: 1800, cy: 1400 },
  modules: [
    { section: 'lower', x: 0,    y: 0, w: 1200, h: 650, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'lower', x: 1200, y: 0, w: 1000, h: 650, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'lower', x: 2200, y: 0, w: 1400, h: 650, moduleH: 870, rotation: 0, finishings: [] },
    { section: 'upper', x: 0,    y: 0, w: 1800, h: 320, moduleH: 780, rotation: 0, finishings: [] },
    { section: 'upper', x: 2400, y: 0, w: 1200, h: 320, moduleH: 780, rotation: 0, finishings: [] },
    { section: 'sink',  x: 1300, y: 0, w: 700,  h: 400, moduleH: 500, rotation: 0, finishings: [] },
    { section: 'hood',  x: 2600, y: 0, w: 300,  h: 300, moduleH: 300, rotation: 0, finishings: [] },
  ],
};

/** ㄱ자 — 회전 0 과 90 이 섞인다. buildSets 가 회전각을 세트 키로 쓰는 것이 여기서 드러난다. */
const lShape = {
  version: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  person: { cx: 1500, cy: 1500 },
  modules: [
    { section: 'lower', x: 0,    y: 0,    w: 1800, h: 650, moduleH: 870, rotation: 0,  finishings: [] },
    { section: 'lower', x: 1800, y: 0,    w: 900,  h: 650, moduleH: 870, rotation: 0,  finishings: [] },
    { section: 'lower', x: 2700, y: 650,  w: 1500, h: 650, moduleH: 870, rotation: 90, finishings: [] },
    { section: 'upper', x: 0,    y: 0,    w: 1800, h: 320, moduleH: 780, rotation: 0,  finishings: [] },
    { section: 'tall',  x: 2700, y: 2150, w: 600,  h: 650, moduleH: 2300, rotation: 90, finishings: [] },
    { section: 'sink',  x: 600,  y: 0,    w: 700,  h: 400, moduleH: 500, rotation: 0,  finishings: [] },
  ],
};

/**
 * 135° 사선 — **지금은 처리되지 않는다.**
 * P7(런 도입)·P9(사선 개방) 의 목표를 미리 못박는 실패 픽스처.
 * 현재 구조에서 무엇이 어떻게 깨지는지 문서화하는 용도이기도 하다.
 */
const oblique = {
  version: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  person: { cx: 1500, cy: 1500 },
  modules: [
    { section: 'lower', x: 0,    y: 0,   w: 1800, h: 650, moduleH: 870, rotation: 0,   finishings: [] },
    { section: 'lower', x: 1800, y: 300, w: 1200, h: 650, moduleH: 870, rotation: 135, finishings: [] },
    { section: 'upper', x: 0,    y: 0,   w: 1800, h: 320, moduleH: 780, rotation: 0,   finishings: [] },
  ],
};

const FIXTURES = { straight, lShape, oblique };

/** 픽스처를 배치 페이지가 읽는 형태로 — 스코프 키에 맞춰 storage seed 를 만든다 */
function seedFor(fixture, { design = 'gold', item = '1' } = {}) {
  const scope = `::${design}:${item}`;
  return { [`dadam_layout_v1${scope}`]: JSON.stringify(fixture), _search: `?design=${design}&item=${item}` };
}

/**
 * 비교용으로 payload 를 정규화한다.
 * 모듈 id 는 `${section}-${index}` 라 안정적이지만, 키 순서와 부동소수 오차는 흔들릴 수 있다.
 */
function canonical(payload) {
  return JSON.stringify(payload, function (k, v) {
    if (typeof v === 'number') return Math.round(v * 1e6) / 1e6;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {});
    }
    return v;
  }, 2);
}

module.exports = { FIXTURES, straight, lShape, oblique, seedFor, canonical };
