/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 2026-10-20 플래너 점검 — 구조 단계 첫 화면.
 * 배치만 하고 구조 단계로 넘어오면 빈 배치 상자만 보였고, 할 일(⚡ 전체 자동계산)을 알려 주는 곳이 없었다.
 * 그대로 「BOM 산출」을 누르면 "1.배치 화면에서 하부장·상부장을 먼저 놓아 주세요" 가 떠 이미 놓은 사용자가 막혔다.
 * three.js 가 늦게 오면 첫 화면 맞춤이 지나가 배치 상자 한쪽 끝만 크게 보였다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const ROOT = path.join(__dirname, '..');
const STRUCT = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
const STEP1 = fs.readFileSync(path.join(ROOT, 'js/detaildesign/ui-step1.js'), 'utf8');

function boot(seed) {
  const s = Object.assign({}, seed);
  const search = s._search;
  delete s._search;
  const p = bootPlanner('mockup-structure.html', { search, storage: s });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}
const hintOf = (p) => p.document.getElementById('autoCalcHint');

describe('배치는 있는데 모듈이 없을 때 — 위쪽 안내 띠', () => {
  test('띠가 보이고 배치 수(마감재 제외)를 알려 준다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('syncCanvasEmpty')();
    expect(hintOf(p).style.display).toBe('flex');
    const n = p.g('areas').filter((a) => !a.isFinishing).length;
    expect(p.document.getElementById('autoCalcHintN').textContent).toBe(String(n));
    // 화면을 가리는 큰 안내는 여전히 띄우지 않는다
    expect(p.document.getElementById('canvasEmpty').style.display).toBe('none');
  });

  test('띠의 버튼 = 「⚡ 전체 자동계산」 — 모듈이 생기고 띠가 사라진다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    p.g('syncCanvasEmpty')();
    p.document.getElementById('autoCalcHintBtn').click();
    expect(p.g('modules').length).toBeGreaterThan(0);
    expect(hintOf(p).style.display).toBe('none');
  });

  test('모듈이 있는 설계로 열면 띠가 없다', () => {
    const p = boot(seedFor(FIXTURES.straight));
    p.g('syncCanvasEmpty')();
    expect(p.g('modules').length).toBeGreaterThan(0);
    expect(hintOf(p).style.display).toBe('none');
  });

  test('왼쪽 목록 안내도 자동계산을 가리킨다', () => {
    expect(STRUCT).not.toMatch(/도면의 영역을 클릭해 모듈을 추가하세요/);
    expect(STRUCT).toMatch(/위쪽 「⚡ 전체 자동계산」을 누르면 배치마다 모듈이 생깁니다/);
  });
});

describe('모듈 0개로 「BOM 산출」', () => {
  test('payload 에 배치 수가 실린다', () => {
    const p = boot(seedFor(FIXTURES.straight, { modules: false }));
    const payload = p.g('buildPlannerPayload')('test');
    expect(payload.modules).toHaveLength(0);
    expect(payload.areaCount).toBe(p.g('areas').filter((a) => !a.isFinishing).length);
  });

  test('배치가 있으면 "자동계산을 누르라", 없을 때만 "배치부터"', () => {
    const i = STEP1.indexOf('const areaCount = Number(payload.areaCount) || 0;');
    expect(i).toBeGreaterThan(0);
    const block = STEP1.slice(i, STEP1.indexOf('제외).`', i));
    expect(block).toMatch(/placed === 0 && areaCount > 0\s*\?[^:]*「⚡ 전체 자동계산」/);
    expect(block.indexOf('「⚡ 전체 자동계산」')).toBeLessThan(block.indexOf('1.배치 화면에서 하부장·상부장을 먼저 놓아 주세요.'));
  });
});

describe('three.js 가 늦게 와도 첫 3D 화면을 맞춘다', () => {
  test('init3D 의 첫 그림은 fit', () => {
    const i = STRUCT.indexOf('function init3D(');
    const body = STRUCT.slice(i, STRUCT.indexOf('\n  }\n', STRUCT.indexOf('animate();', i)));
    expect(body).toMatch(/renderAll3D\(\{ fit: true \}\)/);
    expect(body).not.toMatch(/renderAll3D\(\{ fit: false \}\)/);
  });
});
