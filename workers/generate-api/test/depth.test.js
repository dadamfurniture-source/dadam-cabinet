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
    assert.match(p, cat.wallToWallMm ? /front plane \d+ mm in front of the original wall/ : /stand forward of the wall as a solid volume/);
    assert.doesNotMatch(p, /\b(never|not)\b/i, `${key}: 깊이 문장은 긍정형`);
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
  assert.match(depthPhrase({ ...CTX, category: 'sink', cameraSide: 'left' }), /the left end shows the full depth/);
  assert.match(depthPhrase({ ...CTX, category: 'sink', cameraSide: 'right' }), /the right end shows the full depth/);
  assert.match(depthPhrase({ ...CTX, category: 'sink', cameraSide: 'center' }), /head-on/);
  assert.doesNotMatch(depthPhrase({ ...CTX, category: 'sink' }), /camera stands|head-on/);
});

test('도면 요약이 구간 깊이를 주면 품목 기본 깊이는 빠진다', () => {
  const spec = { sections: { lower: { depthMm: 580, modules: [] } } };
  const p = depthPhrase({ ...CTX, category: 'sink', designSpec: spec });
  assert.ok(!p.includes(CATEGORIES.sink.depth));
  assert.match(p, /^DEPTH: The cabinets stand forward of the wall/);
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
    assert.ok(p.includes(`front plane ${mm} mm in front of the original wall`), key);
    assert.match(p, /covers a \d+ mm strip of each side wall, of the ceiling and of the floor/);
    assert.match(p, /recessed plinth/);
    assert.doesNotMatch(p, /top surfaces|exposed end panel/); // 이 장에 없는 단서는 말하지 않는다
  }
  assert.match(depthPhrase({ ...CTX, category: 'wardrobe', cameraSide: 'right' }), /covered strip of the right side wall/);
});

test('벽 전체 장의 no_depth 검사는 측판이 없다는 이유로 실패시키지 않는다', () => {
  const q = buildQcPrompt({ ...CTX, category: 'wardrobe' });
  assert.match(q, /- no_depth: compared with the original photo, the fronts sit on the original wall plane/);
  assert.match(q, /shows no side panels; that alone is fine/);
  assert.match(buildQcPrompt({ ...CTX, category: 'sink' }), /no side or edge thickness/);
});

// 2026-10-14 (깊이 조사 보고서 1순위): '그 자리 바꾸기' 대신 '벽 앞 공간을 차지하는 가구 추가', 잠글 대상 나열
test('설치 문장은 벽 앞 공간을 차지하는 추가형이고, 잠글 대상을 하나씩 적는다', () => {
  const p = buildInstallPrompt({ ...CTX, category: 'storage' });
  assert.match(p, /^Edit the first photo: add a built-in .+ that occupies the space in front of the main wall, placed in the photo's own perspective\./);
  assert.match(p, /Keep these as photographed: camera position and lens, perspective, walls, ceiling, floor, windows, lighting/);
  assert.doesNotMatch(p, /Keep the room exactly as photographed/);
});

test('검사는 원본 사진과 비교해 깊이를 판정한다', () => {
  const q = buildQcPrompt({ ...CTX, category: 'sink' });
  assert.match(q, /The first image is the original room photo before editing; the second is the result to check\./);
  assert.match(q, /- no_depth: compared with the original photo, the furniture does not stand forward of the wall/);
});
