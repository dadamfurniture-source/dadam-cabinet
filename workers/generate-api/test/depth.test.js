/**
 * 가구 깊이 (2026-10-08).
 * 빈 벽 사진에서 가구를 벽에 붙인 그림처럼 그렸다 — 프롬프트에 깊이 이야기가 없었다.
 *   - 품목마다 기본 깊이(mm) + 사진에서 깊이가 보이는 단서 → DEPTH 줄
 *   - 분석이 camera_side 를 읽어 어느 쪽 측면이 보일지 말한다
 *   - 검사에 no_depth
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  QC_FIXES,
  buildInstallPrompt,
  buildQcPrompt,
  depthPhrase,
  parseAnalysis,
  resolveCategory,
} from '../src/prompts.js';

const CTX = {
  wallW: 3000,
  wallH: 2400,
  waterPct: 30,
  exhaustPct: 70,
  style: 'modern-minimal',
  doorColor: 'white',
  doorFinish: 'matte',
  refCount: 0,
  fridgeBrand: 'Samsung',
  fridgePosition: 'left',
};

test('모든 품목이 mm 깊이를 갖고, 설치 프롬프트에 DEPTH 줄로 실린다', () => {
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    assert.match(cat.depth, /\d{3} mm deep/, key);
    const p = buildInstallPrompt({ ...CTX, category: key });
    assert.ok(p.includes(`DEPTH: ${cat.depth} `), key);
    assert.match(p, cat.wallToWallMm ? /Never render it as doors painted flat/ : /never a flat picture on it/);
  }
  // 사장님 지시값 (data-constants.js 와 같은 수)
  assert.match(CATEGORIES.wardrobe.depth, /620 mm/);
  assert.match(CATEGORIES.fridge.depth, /700 mm/);
});

test('서재·침실이 품목으로 있다', () => {
  assert.equal(resolveCategory('study'), 'study');
  assert.equal(resolveCategory('bedroom'), 'bedroom');
  assert.equal(CATEGORIES.study.label, '서재');
  assert.equal(CATEGORIES.bedroom.label, '침실');
  assert.match(buildInstallPrompt({ ...CTX, category: 'study' }), /bookcase/);
  assert.match(buildInstallPrompt({ ...CTX, category: 'bedroom' }), /headboard/);
});

test('카메라 위치에 따라 보일 측면을 말한다', () => {
  assert.match(depthPhrase({ ...CTX, category: 'sink', cameraSide: 'left' }), /left end of the furniture/);
  assert.match(depthPhrase({ ...CTX, category: 'sink', cameraSide: 'right' }), /right end of the furniture/);
  assert.match(depthPhrase({ ...CTX, category: 'sink', cameraSide: 'center' }), /head-on/);
  assert.doesNotMatch(depthPhrase({ ...CTX, category: 'sink' }), /camera stands|head-on/);
});

test('도면 요약이 구간 깊이를 주면 품목 기본 깊이는 빠진다', () => {
  const spec = { sections: { lower: { depthMm: 580, modules: [] } } };
  const p = depthPhrase({ ...CTX, category: 'sink', designSpec: spec });
  assert.ok(!p.includes(CATEGORIES.sink.depth));
  assert.match(p, /^DEPTH: The furniture is a solid volume/);
});

test('분석의 camera_side 를 읽고, 이상한 값은 버린다', () => {
  assert.equal(parseAnalysis('{"camera_side":"left"}').cameraSide, 'left');
  assert.equal(parseAnalysis('{"camera_side":"center"}').cameraSide, 'center');
  assert.equal(parseAnalysis('{"camera_side":"up"}').cameraSide, null);
  assert.equal(parseAnalysis('nope').cameraSide, null);
});

test('검사에 no_depth 가 있고 FIX 로 돌아온다', () => {
  assert.match(buildQcPrompt({ ...CTX, category: 'wardrobe' }), /- no_depth:/);
  const retry = buildInstallPrompt({ ...CTX, category: 'wardrobe' }, { fix: ['no_depth'] });
  assert.ok(retry.includes(QC_FIXES.no_depth));
});

// 2026-10-13: 붙박이장 연출컷에 깊이가 없었다 — 벽 끝에서 끝·바닥에서 천장인 장은 윗면·측판이 안 보인다.
test('벽 전체 장(붙박이장·수납장)은 방과 만나는 이음매로 깊이를 말한다', () => {
  for (const key of ['wardrobe', 'storage']) {
    const mm = CATEGORIES[key].wallToWallMm;
    const p = depthPhrase({ ...CTX, category: key });
    assert.ok(p.includes(`${mm} mm in front of the original wall`), key);
    assert.match(p, /side wall, of the ceiling and of the floor is covered/);
    assert.match(p, /recessed plinth/);
    assert.doesNotMatch(p, /top surfaces|exposed end panel/); // 이 장에 없는 단서는 말하지 않는다
  }
  assert.match(depthPhrase({ ...CTX, category: 'wardrobe', cameraSide: 'right' }), /on the right side the covered strip/);
});

test('벽 전체 장의 no_depth 검사는 측판이 없다는 이유로 실패시키지 않는다', () => {
  const q = buildQcPrompt({ ...CTX, category: 'wardrobe' });
  assert.match(q, /- no_depth: the fronts look painted flat onto the wall/);
  assert.match(q, /shows no side panels; that alone is fine/);
  assert.match(buildQcPrompt({ ...CTX, category: 'sink' }), /no side or edge thickness/);
});
