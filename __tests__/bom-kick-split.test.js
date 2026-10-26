/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 2026-10-20 사장님 카드 「ㄱ자·ㄷ자 싱크대 걸레받이를 BOM 에서 어떻게 나눌까요?」 → 「꺾임에서 나누기」.
 *   벽마다 걸레받이 한 장 (ㄱ자면 최소 2장). 걸레받이카바 개수는 그대로 — 전체 길이로 센다.
 *   벽 안의 조각은 2026-10-26 사장님 확정으로 바뀌었다 — 예전 원판 긴 변 2440 단위 대신 모듈 경계에서 800~2400
 *   ("자르는 건 모듈길이별로 잘라야해"). 조각 규칙 시험은 bom-line-pieces.test.js.
 * 예전엔 라인 폭 합을 한 장으로 냈다 — 플래너 ㄱ자 빠른 배치가 MDF 18T 4161×145 한 장(원판에 안 들어감).
 * 벽 = 하부 라인 모듈의 앞면 방향(_place.front, ui-step1 _plannerPlaceOf).
 */
const { loadExtractors } = require('../test-utils/bom-golden/golden');

const SPECS = {
  layoutShape: 'L', topThickness: 12, bodyThickness: 15,
  lowerH: 870, upperH: 720, moldingH: 60, sinkLegHeight: 150,
  handle: '찬넬 (목찬넬)',
};
/** 하부장 한 칸 — front 는 앞면 방향 (0° 줄 [0,1], 90° 옆 줄 [-1,0], 270° 옆 줄 [1,0]) */
const lower = (id, w, front) => ({
  id, type: 'storage', name: '하부장', pos: 'lower', w, h: 708, d: 550, doorCount: 2, shelfCount: 1,
  _place: { cx: 0, cy: 0, w, d: 550, run: [front[1], -front[0]], front, z0: 0, h: 870 },
});
const sinkItem = (modules) => ({ categoryId: 'sink', w: 4200, h: 2310, d: 650, specs: Object.assign({}, SPECS), modules });

function extract(item) {
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const design = { appVersion: 'kick-test', items: [item] };
  const materials = new MaterialExtractor().extract(design).materials;
  const hardware = new HardwareExtractor().extract(design).hardware || [];
  return { materials, hardware };
}
const kicks = (rows) => rows.filter((r) => r.part === '걸레받이').map((r) => [r.w, r.h, r.qty]);
const coverQty = (hw) => (hw.find((h) => h.category === '걸레받이카바') || {}).qty;

describe('걸레받이 — 꺾임에서 나누기', () => {
  test('ㄱ자(본 줄 2400 + 옆 줄 1761) → 벽마다 한 장, 4161 한 장이 아니다', () => {
    const { materials, hardware } = extract(sinkItem([
      lower('a', 900, [0, 1]), lower('b', 900, [0, 1]), lower('c', 600, [0, 1]),
      lower('d', 900, [-1, 0]), lower('e', 861, [-1, 0]),
    ]));
    expect(kicks(materials)).toEqual([[2400, 145, 1], [1761, 145, 1]]);
    expect(coverQty(hardware)).toBe(Math.ceil(4161 / 2400));
  });

  test('2400 을 넘는 벽은 모듈 경계에서 더 나눈다 (2026-10-26) — 본 줄 1000 × 3 + 옆 줄 1200 → 2000 · 1200 · 1000 (예전 2440 · 1200 · 560)', () => {
    const { materials, hardware } = extract(sinkItem([
      lower('a', 1000, [0, 1]), lower('b', 1000, [0, 1]), lower('c', 1000, [0, 1]),
      lower('d', 1200, [-1, 0]),
    ]));
    expect(kicks(materials)).toEqual([[2000, 145, 1], [1200, 145, 1], [1000, 145, 1]]);
    expect(coverQty(hardware)).toBe(Math.ceil(4200 / 2400)); // 카바는 전체 길이로 — 나눠도 그대로
  });

  test('ㄷ자 — 같은 길이의 두 옆 줄은 한 행에 수량 2', () => {
    const { materials } = extract(sinkItem([
      lower('a', 900, [0, 1]), lower('b', 900, [0, 1]),
      lower('l', 900, [1, 0]), lower('r', 900, [-1, 0]),
    ]));
    expect(kicks(materials)).toEqual([[1800, 145, 1], [900, 145, 2]]);
  });

  test('일자 2440 이하는 예전처럼 한 장, 비고 없음', () => {
    const { materials } = extract(sinkItem([lower('a', 900, [0, 1]), lower('b', 900, [0, 1])]));
    const rows = materials.filter((r) => r.part === '걸레받이');
    expect(rows.map((r) => [r.w, r.qty, r.note])).toEqual([[1800, 1, '']]);
  });

  test('예전 도우미(원판 2440 단위 bomKickPiecesOf)는 없다 — 조각은 assembly-rules.js linePiecesOf 한 곳', () => {
    const E = require('../js/detaildesign/extractors');
    expect(E.bomKickPiecesOf).toBeUndefined();
    expect(E.bomKickWallLensOf).toBeUndefined();
  });
});
