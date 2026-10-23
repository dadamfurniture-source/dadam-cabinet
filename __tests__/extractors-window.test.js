/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 2026-10-23: extractors.js 는 브라우저에서 추출기를 window 에 올린다.
 *   `class` 선언은 고전 스크립트 최상위여도 window 속성이 되지 않는다 — 플래너 iframe(planner-export.js
 *   plannerExportCadSpec: CAD GLB · 조립 검사 배지 · 명세 3D)과 브라우저 조립 명세(bom-assembly.js root.MaterialExtractor)가
 *   부모 창 추출기를 window 로 찾는다.
 * 브라우저처럼 고전 스크립트로 돌린다 (vm, module 없음).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('extractors.js — 브라우저 전역', () => {
  test('MaterialExtractor · HardwareExtractor 가 window 에 있고, 그 추출기로 BOM 이 나온다', () => {
    // detaildesign.html 이 extractors.js 앞에 싣는 규칙 파일들 (상수 · 규칙표) — 같은 순서
    const html = fs.readFileSync(path.join(__dirname, '..', 'detaildesign.html'), 'utf8');
    const srcs = [...html.matchAll(/src="(js\/detaildesign\/[^"?]+)/g)].map((m) => m[1]);
    const upto = srcs.slice(0, srcs.indexOf('js/detaildesign/extractors.js') + 1)
      .filter((f) => /data-constants|config-constants|bom-|assembly-rules|extractors/.test(f));
    const window = { console: { log() {}, warn() {}, error() {} } };
    window.window = window;
    const ctx = vm.createContext(Object.assign(window, { dlog: () => {} }));
    upto.forEach((f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f }));
    expect(typeof window.MaterialExtractor).toBe('function');
    expect(typeof window.HardwareExtractor).toBe('function');
    const { FIXTURES } = require('../test-utils/bom-golden/fixtures.js');
    const design = JSON.parse(JSON.stringify({ items: [FIXTURES.sink15] }));
    expect(new window.MaterialExtractor().extract(design).materials.length).toBeGreaterThan(20);
    expect(new window.HardwareExtractor().extract(design).hardware.length).toBeGreaterThan(0);
  });

  test('detaildesign.html 이 싣는다 — 조립 명세(bom-assembly.js)보다 먼저', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'detaildesign.html'), 'utf8');
    const at = (f) => html.indexOf(`src="js/detaildesign/${f}?v=`);
    expect(at('extractors.js')).toBeGreaterThan(0);
    expect(at('extractors.js')).toBeLessThan(at('bom-assembly.js'));
  });
});
