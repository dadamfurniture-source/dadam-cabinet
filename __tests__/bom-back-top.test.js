/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global, __dirname */
/**
 * 2026-10-18 사장님 결정
 *   몸통 뒷판  우라 MDF 3T (예전 2.7T) — 거래명세서의 뒷판용 판은 3T 우라
 *   상판      두께 12 · 50T (인조대리석) · 깊이 = 도면 그대로 · 이음은 상판 업체 판단
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
global.dlog = global.dlog || (() => {});
const X = require('../js/detaildesign/extractors.js');
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');

const mats = (name) => new X.MaterialExtractor().extract(designOf(FIXTURES[name])).materials;

/** data-constants.js 는 클래식 스크립트 — 최상위 이름을 vm 으로 꺼낸다. */
function loadConstants() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'data-constants.js'), 'utf8');
  const ctx = { console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(`${src}\n;this.__c = { TOP_THICKNESS_OPTIONS, topThicknessOptionsHtml, BACK_PANEL_THICKNESS, TOP_MATERIALS, topMaterialOf, topMaterialOptionsHtml, topToggleOptionsHtml, topSideOptionsHtml };`, ctx);
  return ctx.__c;
}

describe('몸통 뒷판 — 우라 3T', () => {
  test.each(['sink15', 'sink18', 'sinkCorner', 'wardrobe', 'fridge', 'shoerack', 'vanity', 'storage', 'warehouse'])('%s', (name) => {
    const backs = mats(name).filter((r) => r.part === '뒷판');
    expect(backs.length).toBeGreaterThan(0);
    backs.forEach((r) => {
      if (/홈카페장/.test(r.module)) expect(r.thickness).toBe(18);   // 홈카페장은 18T 통판 (오픈장 규칙)
      else expect(r.thickness).toBe(3);
    });
  });

  test('상수도 3 — data-constants BACK_PANEL_THICKNESS', () => {
    expect(loadConstants().BACK_PANEL_THICKNESS).toBe(3);
  });
});

describe('상판 — 12 · 50T, 깊이는 도면, 이음은 업체', () => {
  test('화면 선택지와 BOM 이 같은 두께 목록', () => {
    const C = loadConstants();
    expect(Array.from(C.TOP_THICKNESS_OPTIONS)).toEqual([12, 50]);
    const html = C.topThicknessOptionsHtml(12);
    expect(html).toMatch(/<option value="12" selected>12T<\/option>/);
    expect(html).toMatch(/<option value="50" >50T<\/option>/);
    expect(html).not.toMatch(/18/);
  });

  test('옛 값 18 은 지우지 않고 "옛 값"으로 보인다', () => {
    expect(loadConstants().topThicknessOptionsHtml(18)).toMatch(/<option value="18" selected>18T \(옛 값\)<\/option>/);
  });

  test('BOM 상판 깊이 = 품목(도면) 깊이 · 비고에 이음은 업체 판단', () => {
    const d = designOf(FIXTURES.sink15);
    d.items[0].d = 700;
    const top = new X.MaterialExtractor().extract(d).materials.find((r) => r.part === '상판');
    expect(top).toMatchObject({ material: '인조대리석', thickness: 12, h: 700 });
    expect(top.note).toMatch(/이음은 상판 업체 판단/);
  });
});

describe('상판 재질 3종 — 2026-10-18 사장님 Q8 (상판 발주 요청서)', () => {
  const topOf = (specs) => {
    const d = designOf(FIXTURES.sink15);
    Object.assign(d.items[0].specs, specs);
    return new X.MaterialExtractor().extract(d).materials.find((r) => r.part === '상판');
  };

  test('재질마다 두께 목록 — 화면과 BOM 이 같다', () => {
    const C = loadConstants();
    expect(JSON.parse(JSON.stringify(C.TOP_MATERIALS))).toEqual({ '인조대리석': [12, 50], '엔지니어드 스톤': [12, 20], '세라믹': [12] });
    expect(C.topThicknessOptionsHtml(20, '엔지니어드 스톤')).toMatch(/<option value="20" selected>20T<\/option>/);
    expect(C.topThicknessOptionsHtml(50, '세라믹')).toMatch(/50T \(옛 값\)/);
    expect(C.topMaterialOf({})).toBe('인조대리석');
    expect(C.topMaterialOf({ topMaterial: '대리석?' })).toBe('인조대리석');
    expect(C.topMaterialOptionsHtml('세라믹')).toMatch(/<option value="세라믹" selected>세라믹<\/option>/);
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'extractors.js'), 'utf8');
    expect(src).toContain("const BOM_TOP_MATERIALS = { '인조대리석': [12, 50], '엔지니어드 스톤': [12, 20], '세라믹': [12] };");
  });

  test('BOM 상판 행 재질 · 두께가 사양을 따른다', () => {
    expect(topOf({ topMaterial: '엔지니어드 스톤', topThickness: 20 })).toMatchObject({ material: '엔지니어드 스톤', thickness: 20 });
    expect(topOf({ topMaterial: '세라믹', topThickness: 12 })).toMatchObject({ material: '세라믹', thickness: 12 });
    expect(topOf({ topMaterial: '세라믹', topThickness: 12 }).note).not.toMatch(/확인 필요/);
  });

  test('재질에 없는 두께는 그대로 내되 [확인 필요] · 모르는 재질은 인조대리석', () => {
    expect(topOf({ topMaterial: '엔지니어드 스톤', topThickness: 50 }).note).toMatch(/\[확인 필요\] 엔지니어드 스톤 상판 두께는 12 · 20T — 지정 값 50/);
    expect(topOf({ topMaterial: 'xx' }).material).toBe('인조대리석');
  });

  test('뒷턱 · 앞턱 · 물끊기 · 옆면 — 비우면 기본값(생산 설정), 있음/없음으로 덮어쓴다', () => {
    const C = loadConstants();
    expect(C.topToggleOptionsHtml(undefined, '있음')).toMatch(/<option value="" selected>기본 \(있음\)<\/option>/);
    expect(C.topToggleOptionsHtml('off', '있음')).toMatch(/<option value="off" selected>없음<\/option>/);
    expect(C.topSideOptionsHtml('wall')).toMatch(/<option value="wall" selected>/);
    const ws = fs.readFileSync(path.join(__dirname, '..', 'js', 'detaildesign', 'ui-workspace.js'), 'utf8');
    for (const f of ['topBacksplash', 'topBacksplashH', 'topFrontLip', 'topFrontLipH', 'topDrip', 'topSideLeft', 'topSideRight']) expect(ws).toContain(`'${f}'`);
    expect(ws).toMatch(/function updateTopMaterial\(/);
  });
});
