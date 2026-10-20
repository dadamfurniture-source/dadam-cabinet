/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * TV장(tvcabinet) 품목 골격 — 2026-10-20.
 *
 * 정본 규칙이 없어 수납장(storage) 규칙을 그대로 빌린다 (깊이 400 · 선반 칸 간격 300~450) [확인 필요].
 * 그래서 같은 설계를 수납장으로 뽑은 BOM 과 품목 라벨만 다르고 부재·치수·철물은 같아야 한다.
 * 사장님 결정(구성·깊이·높이)이 오면 이 시험의 "수납장과 같다" 부분이 바뀐다.
 */
const fs = require('fs');
const path = require('path');
const { designOf } = require('../test-utils/bom-golden/fixtures');
const { snapshotOf } = require('../test-utils/bom-golden/golden');
const X = require('../js/detaildesign/extractors.js');

/** 낮은 거실장 한 줄 — 모듈 깊이(d)를 비워 품목 기본 깊이 폴백을 탄다. */
function tvDesign(categoryId) {
  return {
    categoryId,
    w: 2400,
    h: 2310,
    specs: {
      layoutShape: 'I',
      bodyThickness: 15,
      lowerH: 870,
      upperH: 720,
      sinkLegHeight: 150,
      topThickness: 12,
      moldingH: 60,
      upperDoorOverlap: 15,
      handle: '찬넬 (목찬넬)',
      finishLeftType: 'Filler',
      finishLeftWidth: 60,
      finishRightType: 'Filler',
      finishRightWidth: 60,
      doorColorUpper: '화이트',
      doorFinishUpper: '무광',
      doorColorLower: '화이트',
      doorFinishLower: '무광',
    },
    modules: [
      {
        id: 'l1',
        type: 'storage',
        name: '하부장',
        pos: 'lower',
        w: 900,
        h: 708,
        isDrawer: false,
        isEL: false,
        isFixed: false,
      },
      {
        id: 'l2',
        type: 'storage',
        name: '서랍장',
        pos: 'lower',
        w: 600,
        h: 708,
        isDrawer: true,
        drawerCount: 2,
        isEL: false,
        isFixed: false,
      },
      {
        id: 'l3',
        type: 'storage',
        name: '오픈선반',
        pos: 'lower',
        w: 780,
        h: 708,
        doorCount: 0,
        isOpen: true,
        isDrawer: false,
        isEL: false,
      },
    ],
  };
}

const strip = (rows) =>
  rows.map((r) => {
    const o = Object.assign({}, r);
    delete o.itemLabel;
    return o;
  });

describe('TV장 품목 등록', () => {
  test('data-constants CATEGORIES 와 플래너 품목 드롭다운에 같은 id·이름으로 있다', () => {
    const dc = fs.readFileSync(
      path.join(__dirname, '../js/detaildesign/data-constants.js'),
      'utf8'
    );
    expect(dc).toMatch(/\{ id: 'tvcabinet', name: 'TV장', defaultD: 400, defaultH: 2310 \}/);
    const picker = fs.readFileSync(
      path.join(__dirname, '../js/planner/planner-category-picker.js'),
      'utf8'
    );
    expect(picker).toMatch(/\{ id: 'tvcabinet', name: 'TV장', icon: '📺' \}/);
  });

  test('BOM 규칙표에 있고 수납장 규칙을 그대로 빌린다', () => {
    const tv = X.BOM_SIMPLE_CATEGORY_RULES.tvcabinet;
    const st = X.BOM_SIMPLE_CATEGORY_RULES.storage;
    expect(tv.label).toBe('TV장');
    expect(tv.defaultD).toBe(st.defaultD);
    expect(tv.upperD).toBe(st.upperD);
    expect(tv.shelfSpace).toEqual(st.shelfSpace);
  });
});

describe('TV장 BOM — 수납장과 라벨만 다르다', () => {
  const tv = snapshotOf(designOf(tvDesign('tvcabinet')));
  const st = snapshotOf(designOf(tvDesign('storage')));

  test('자재 행이 나오고 품목 라벨은 TV장이다', () => {
    expect(tv.materials.length).toBeGreaterThan(0);
    tv.materials.forEach((m) => expect(m.itemLabel).toBe('TV장'));
    tv.hardware.forEach((h) => expect(h.itemLabel).toBe('TV장'));
  });

  test('부재·치수·수량·철물이 수납장으로 뽑은 것과 같다', () => {
    expect(strip(tv.materials)).toEqual(strip(st.materials));
    expect(strip(tv.hardware)).toEqual(strip(st.hardware));
  });

  test('깊이를 비운 모듈은 기본 깊이 400 으로 잰다 (측판 깊이에 400 대 값)', () => {
    const side = tv.materials.find(
      (m) => m.module && /하부장/.test(m.module) && /측판/.test(m.part)
    );
    expect(side).toBeTruthy();
    const dims = [side.w, side.h, side.d].map(Number);
    expect(dims.some((v) => v >= 350 && v <= 400)).toBe(true);
  });
});
