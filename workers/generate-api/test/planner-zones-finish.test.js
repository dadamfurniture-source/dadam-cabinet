/**
 * 2026-10-19: 빈 구역(EMPTY ZONES)에서 마감재 폭 틈을 빼다 (C-2).
 *
 * 실측 프롬프트: EP 20 끝판(마감재 섹션 ep·molding·filler·gap — 모듈 목록에는 안 들어가고 런 폭에만 든다) 때문에
 * "at wall-unit height, between U2 and the right end of the run (20 mm) — no wall unit" 같은 줄이 줄마다 생겨
 * 빈 구역 수(자체 점검)를 부풀렸다. 50 mm 이하 틈은 빈 구역으로 세지 않는다. 그보다 넓은 틈·층 전체가 빈 것은 그대로.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlannerPrompt, normalizeDesignSpec } from '../src/prompts.js';

const two = (w) => ({ widthMm: w, kind: 'door', doorCount: 2 });
function raw({ pad = 20, upperFrom = 20 } = {}) {
  return {
    category: 'sink',
    wallRunMm: 2400 + pad * 2,
    sections: {
      lower: { widthMm: 2400, heightMm: 870, fromLeftMm: pad, modules: [two(800), two(800), two(800)], fromFloorMm: 0 },
      upper: { widthMm: 2400 - (upperFrom - pad), heightMm: 780, fromLeftMm: upperFrom, modules: [two(1200 - (upperFrom - pad)), two(1200)], fromFloorMm: 1520 },
    },
    ceilingMm: 2300,
    layout: { shape: 'straight', walls: 1 },
  };
}
const prompt = (o) => buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(raw(o), 'sink'), wallW: 3600, wallH: 2400, confidence: 'high' });
const zonesOf = (p) => (p.split('\n\n').find((x) => x.startsWith('EMPTY ZONES')) || '').split('\n').slice(1);

test('EP 20 양 끝 — 20 mm 틈은 빈 구역이 아니다 (층마다 두 줄씩 사라진다)', () => {
  const p = prompt();
  assert.doesNotMatch(p, /\(20 mm\) — no/);
  assert.deepEqual(zonesOf(p), [
    '  1. between the top of the base row (870 mm) and the bottom of the wall row (1520 mm) — 650 mm of open wall',
    '  2. the main wall right of the run, floor to ceiling',
  ]);
  assert.match(p, /; 2 empty zones left empty;/);
});

test('50 mm 까지는 빼고, 그보다 넓은 틈은 빈 구역 그대로', () => {
  assert.doesNotMatch(prompt({ pad: 50, upperFrom: 50 }), /\(50 mm\) — no/);
  const p = prompt({ pad: 20, upperFrom: 80 });   // 상부가 하부보다 60 mm 늦게 시작
  assert.match(p, /at wall-unit height above L1, between the left end of the run and U1 \(80 mm\) — no wall unit/);
});

test('층 전체가 빈 것(상부장 없음)은 틈 폭과 상관없이 그대로', () => {
  const r = raw();
  delete r.sections.upper;
  const p = buildPlannerPrompt({ category: 'sink', designSpec: normalizeDesignSpec(r, 'sink'), wallW: 3600, wallH: 2400, confidence: 'high' });
  assert.match(p, /at wall-unit height above L1–L3 across the whole run — no wall units/);
});
