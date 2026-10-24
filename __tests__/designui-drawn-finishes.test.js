/**
 * 2026-10-24 사장님 D9 — 좌·우 마감재는 도면이 정본. 브리지(ui-step1.js _convertPlannerModules)가
 *   플래너 payload 의 마감재를 specs.drawnFinishes 로 적는다 (BOM 이 그것으로 발주한다). 합성 데이터만.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'ui-step1.js'), 'utf8');
function sliceBetween(a, b) {
  const s = SRC.indexOf(a);
  const e = SRC.indexOf(b, s + 1);
  if (s < 0 || e < 0) throw new Error('블록을 찾지 못했습니다');
  return SRC.slice(s, e);
}
// eslint-disable-next-line no-new-func
const convert = new Function(`${sliceBetween('const PLANNER_CABINET_SECTIONS', 'function _applyPlannerResult')}; return { _convertPlannerModules };`)()._convertPlannerModules;

const lower = (id, x, finishings) => ({ id, section: 'lower', W: 1000, H: 870, D: 650, x, y: 0, finishings: finishings || [] });
const STRUCT = { areaTypes: ['door'], areaWidths: [1000], areaIs2D: [false], shelves: [] };

describe('specs.drawnFinishes (D9)', () => {
  test('payload 마감재를 x 순서로 그대로 적는다 — 쪽 · 끝 · 영역 · 폭 · 부재 폭 · 높이 · 바닥', () => {
    const specs = {};
    convert({
      modules: [
        lower('lower-1', 1020, [{ section: 'filler', W: 60, H: 678, D: 650, x: 2020, y: 0, side: 'right', edge: 'right', baseY: 150, area: 'lower', partW: 60 }]),
        lower('lower-0', 20, [{ section: 'ep', W: 20, H: 858, D: 650, x: 0, y: 0, side: 'left', edge: 'left', baseY: 0, area: 'lower', partW: 18 }]),
      ],
      structures: { 'lower-0': STRUCT, 'lower-1': STRUCT },
      hasStructures: true,
    }, specs);
    expect(specs.drawnFinishes).toEqual([
      { section: 'ep', side: 'left', edge: 'left', area: 'lower', W: 20, partW: 18, H: 858, D: 650, baseY: 0, x: 0 },
      { section: 'filler', side: 'right', edge: 'right', area: 'lower', W: 60, partW: 60, H: 678, D: 650, baseY: 150, x: 2020 },
    ]);
  });

  test('마감재가 없으면 빈 목록 (BOM 은 발주하지 않고 확인창에 알린다)', () => {
    const specs = { finishLeftType: 'Filler', finishLeftWidth: 60 };
    convert({ modules: [lower('lower-0', 0)], structures: { 'lower-0': STRUCT }, hasStructures: true }, specs);
    expect(specs.drawnFinishes).toEqual([]);
  });

  test('옛 payload(메타 없음)는 그 값이 null — 지어내지 않는다', () => {
    const specs = {};
    convert({ modules: [lower('lower-0', 60, [{ section: 'molding', W: 60, H: 700, D: 650, x: 0, y: 0 }])], structures: { 'lower-0': STRUCT }, hasStructures: true }, specs);
    expect(specs.drawnFinishes).toEqual([{ section: 'molding', side: null, edge: null, area: null, W: 60, partW: null, H: 700, D: 650, baseY: null, x: 0 }]);
  });
});
