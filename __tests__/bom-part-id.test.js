/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, afterAll, window */
/**
 * B1: 부재 식별자 · 마감 코드 · 엣지 길이 (docs/01-plan/detail-bom-deepening.plan.md §5 B1).
 *
 * `MaterialExtractor.add()` 가 내는 모든 자재 행에 **더해진** 필드를 본다 (불변조건 I4 — 기존 필드는 그대로):
 *   partId · slot · finishCode(디테일 모델 해석) · edges · edgeLen · edgeT · edgeCode, 요약 edgeBanding.
 * 값이 옳은지는 규칙 시험(bom-body-thickness, extractors-*)이, 바뀌었는지는 골든(bom-golden-*)이 본다.
 */
global.dlog = () => {};

const { MaterialExtractor, HardwareExtractor, DrawingVisualizer } = require('../js/detaildesign/extractors.js');

describe('CommonJS 이중 노출 — 세 클래스 모두', () => {
  test('MaterialExtractor 외에 HardwareExtractor·DrawingVisualizer 도 require 로 얻는다', () => {
    expect(typeof MaterialExtractor).toBe('function');
    expect(typeof HardwareExtractor).toBe('function');
    expect(typeof DrawingVisualizer).toBe('function');
    expect(new DrawingVisualizer().KERF).toBe(4);
  });
});

describe('toCNC — 3면 가지 (측판)', () => {
  const me = new MaterialExtractor();
  const row = (edge, w = 295, h = 720) => ({ part: '측판', material: 'PB', thickness: 15, w, h, qty: 2, edge });
  const cncOf = (edge, w, h) => me.toCNC([row(edge, w, h)]).split('\n')[1].split(',').slice(-4).map(Number);

  test("'3면' 은 L·T·B (앞 + 위·아래, 뒤 없음) — 예전엔 가지가 없어 0,0,0,0 이었다", () => {
    expect(cncOf('3면')).toEqual([1, 0, 1, 1]);
  });
  test('다른 가지는 그대로다 (4면 전부, 1면 L, - 없음)', () => {
    expect(cncOf('4면')).toEqual([1, 1, 1, 1]);
    expect(cncOf('1면(전)')).toEqual([1, 0, 0, 0]);
    expect(cncOf('-')).toEqual([0, 0, 0, 0]);
  });
});
