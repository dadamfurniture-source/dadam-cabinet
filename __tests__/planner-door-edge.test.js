/**
 * W12-17: 도어 경계선이 줌과 무관하게 보이게 한다.
 *
 * 도어 사이 갭은 4mm 다. 1800mm 짜리 장을 화면에 담으면 그 4mm 가 1~2px 이 되고,
 * 안티에일리어싱까지 먹으면 선이 사라진다. 실측으로 경계 픽셀이 rgb(7,6,5)
 * — **색이 옅은 게 아니라 굵기가 없던 것**이었다.
 *
 * 3D 는 jsdom 에서 못 돌리므로 소스와 산술을 검사한다. 실제 화면은 playwright.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');

describe('도어 테두리를 두른다', () => {
  const fn = SRC.slice(SRC.indexOf('function addDoorEdgeFrame'), SRC.indexOf('function mmPerPixel'));

  test('마커가 살아 있다', () => {
    expect(SRC.indexOf('function addDoorEdgeFrame')).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(120);
  });

  test('네 변을 만든다 — 면을 덮지 않는다', () => {
    expect(fn).toContain("['left', 'right', 'top', 'bottom']");
    // 도어 크기 그대로의 판을 앞에 깔면 도어 면이 가려진다
    expect(fn).not.toMatch(/makeBox\(w, h,/);
  });

  test('두께를 다시 잡을 수 있게 원래 크기를 남긴다', () => {
    ['baseW', 'baseH', 'axis'].forEach((k) => expect(fn).toContain(k));
  });

  test('도어 앞쪽에 둔다 — 도어(중심 frontZ+9, 두께 18) 보다 앞', () => {
    const call = SRC.slice(SRC.indexOf('function addDoorReveal'), SRC.indexOf('function addDoorEdgeFrame'));
    expect(call).toMatch(/addDoorEdgeFrame\(parent, cx, cy, w, h, frontZ \+ 19,/);
  });
});

describe('줌에 따라 두께를 유지한다', () => {
  const fn = SRC.slice(SRC.indexOf('function keepDoorEdgesVisible'), SRC.indexOf('function addFrontPanel'));

  test('매 프레임 부른다', () => {
    const loop = SRC.slice(SRC.indexOf('requestAnimationFrame(animate)'), SRC.indexOf('requestAnimationFrame(animate)') + 220);
    expect(loop).toContain('keepDoorEdgesVisible()');
  });

  test('실제 갭보다 얇아지지 않는다', () => {
    expect(fn).toMatch(/Math\.max\(MASTER_RULES\.DOOR_GAP \/ 2, DOOR_EDGE_MIN_PX \* mmPerPixel\(\)\)/);
  });

  test('doorEdge 만 건드린다', () => {
    expect(fn).toMatch(/entityKind !== 'doorEdge'/);
  });

  test('mmPerPixel 이 three 없이도 죽지 않는다', () => {
    const mp = SRC.slice(SRC.indexOf('function mmPerPixel'), SRC.indexOf('const DOOR_EDGE_MIN_PX'));
    expect(mp).toMatch(/if \(!three \|\| !three\.camera \|\| !three\.renderer \|\| !three\.controls\) return 1;/);
  });

  test('산술 — 멀어지면 두꺼워지고 가까우면 갭 그대로다', () => {
    const GAP = 4, MIN_PX = 1.6;
    const t = (mmPerPx) => Math.max(GAP / 2, MIN_PX * mmPerPx);
    expect(t(0.5)).toBe(2);        // 가까이 — 갭 절반(2mm) 유지
    expect(t(4.35)).toBeCloseTo(6.96, 2);   // 멀리 — 약 7mm
    expect(t(10)).toBe(16);
  });
});

describe('그림자 색', () => {
  test('상수 하나가 정한다', () => {
    expect(SRC).toMatch(/const DOOR_REVEAL_DARKEN = 0\.9;/);
    const reveal = SRC.slice(SRC.indexOf('function addDoorReveal'), SRC.indexOf('function addDoorEdgeFrame'));
    expect((reveal.match(/DOOR_REVEAL_DARKEN/g) || []).length).toBe(2);   // 뒷판 + 테두리
    expect(reveal).not.toMatch(/darken3\(cfg\.fill, 0\.\d+\)/);           // 숫자 직접 박지 않는다
  });
});
