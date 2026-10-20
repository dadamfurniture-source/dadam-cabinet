/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 2026-10-20 플래너 점검 — 구조 단계 자동계산 뒤 3D 화면.
 * 예전엔 시작 카메라(원점 = 줄 왼쪽 끝을 바라봄)가 그대로라 3000 하부장의 오른쪽 절반이 화면 밖이었고,
 * 맞춤(fit)도 카메라만 빼고 바라보는 점은 원점에 두었다.
 *   1. camera3DFitOf — 상자의 가운데를 본다
 *   2. 처음 모듈이 생기는 「⚡ 전체 자동계산」은 카메라를 맞춘다 (이미 모듈이 있으면 시점을 지킨다)
 */
const fs = require('fs');
const path = require('path');
const { camera3DFitOf } = require('../js/planner/planner-view');

const STRUCT = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8');
const fnBody = (name) => {
  const i = STRUCT.indexOf(`function ${name}(`);
  return STRUCT.slice(i, STRUCT.indexOf('\n  }\n', i));
};

describe('camera3DFitOf — 상자 가운데를 본다', () => {
  test('원점에서 오른쪽으로 3000 뻗은 줄 → 가운데 1500 을 본다', () => {
    const f = camera3DFitOf({ minX: 0, maxX: 3000, minZ: 0, maxZ: 650 }, 2310);
    expect(f.target).toEqual({ x: 1500, y: 1155, z: 325 });
    expect(f.size).toBe(3000);
  });

  test('높이가 가장 크면 size = 높이', () => {
    expect(camera3DFitOf({ minX: 0, maxX: 600, minZ: 0, maxZ: 350 }, 2310).size).toBe(2310);
  });
});

describe('구조 단계 3D 맞춤', () => {
  test('맞춤은 바라보는 점(controls.target)도 상자 가운데로 옮긴다', () => {
    for (const name of ['renderAll3D', 'fitCameraToAreas']) {
      const body = fnBody(name);
      expect(body).toMatch(/camera3DFitOf\(/);
      expect(body).toMatch(/controls\.target\.set\(fit\.target\.x, fit\.target\.y, fit\.target\.z\)/);
      expect(body).not.toMatch(/controls\.target\.set\(0,/);
    }
  });

  test('「⚡ 전체 자동계산」 — 처음 모듈이 생길 때만 카메라를 맞춘다', () => {
    const body = fnBody('fillAllAreaGaps');
    expect(body).toMatch(/const firstFill = !modules\.length;/);
    expect(body).toMatch(/renderAll3D\(\{ fit: firstFill && made > 0 \}\)/);
  });
});
