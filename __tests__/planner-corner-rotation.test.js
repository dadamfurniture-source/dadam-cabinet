/**
 * W12-36: ㄱ자 — 배치 단계의 회전 좌표를 구조 단계가 그대로 읽는다.
 *
 * 배치 단계는 사각형을 **자기 중심으로** 돌린다
 * (`mockup-shell.html` 의 `getRotatedCorners`: 축이 `x + w/2, y + h/2`).
 * 구조 단계는 다섯 곳에서 `(x, y)` 를 그대로 좌상단으로 쓰고 폭·깊이만
 * 맞바꿔 왔다 — 어긋난 양이 정확히 `(W − D)/2` 다.
 *
 * 실측(트리밍한 ㄱ자):
 *   배치가 X[2400, 2525] 에 그린 세로 다리를 구조는 X[1750, 2400] 에 그렸다.
 *
 * 모듈의 회전축도 자기 중심이 아니라 **속한 영역의 중심**이다. 영역이 통째로
 * 도는 것이라, 제 중심으로 돌리면 영역 밖으로 흩어진다
 * (§10 "90° 회전 영역 — 모듈이 영역 밖으로 나간다" 가 이것이다).
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'mockup-structure.html'), 'utf8')
  .split('\r\n').join('\n');
const SHELL = fs.readFileSync(path.join(__dirname, '..', 'mockup-shell.html'), 'utf8')
  .split('\r\n').join('\n');

/** 배치 단계의 진실 — getRotatedCorners 와 같은 식을 여기 다시 적는다 */
function layoutVisualBox(x, y, w, h, rot) {
  const a = ((rot % 360) + 360) % 360;
  const cos = a === 0 ? 1 : a === 90 ? 0 : a === 180 ? -1 : 0;
  const sin = a === 0 ? 0 : a === 90 ? 1 : a === 180 ? 0 : -1;
  const cx = x + w / 2, cy = y + h / 2;
  const cs = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    .map(([px, py]) => [cx + (px - cx) * cos - (py - cy) * sin,
                        cy + (px - cx) * sin + (py - cy) * cos]);
  const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs),
           minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** 트리밍한 ㄱ자 — 실제 배치 단계가 저장한 값 (playwright 실측) */
const CORNER = [
  { section: 'lower', x: 0,      y: 0,     w: 2400, h: 650, moduleH: 870, rotation: 0,  finishings: [] },
  { section: 'lower', x: 1562.5, y: 837.5, w: 1800, h: 125, moduleH: 870, rotation: 90, finishings: [] },
];

function boot(mods) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=cor&item=1',
    storage: {
      'dadam_layout_v1::cor:1': JSON.stringify({
        version: 1, savedAt: '2026-01-01T00:00:00.000Z', person: { cx: 900, cy: 1500 },
        modules: mods || CORNER,
      }),
    },
  });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

const boxOf = (p, a) => {
  const B = p.g('planeBoxOf')(a);
  return { minX: B.x, maxX: B.x + B.w, minY: B.y, maxY: B.y + B.d };
};

describe('회전 영역이 배치와 같은 자리에 온다', () => {
  test('가로 다리 — 회전이 없으면 예전과 같다', () => {
    const p = boot();
    const a = p.g('areas')[0];
    expect(boxOf(p, a)).toEqual(layoutVisualBox(0, 0, 2400, 650, 0));
  });

  test('세로 다리 — 트리밍된 회전 다리가 제자리에 온다', () => {
    const p = boot();
    const a = p.g('areas')[1];
    const truth = layoutVisualBox(1562.5, 837.5, 1800, 125, 90);
    expect(boxOf(p, a)).toEqual(truth);
    // 실측값 — 두 다리가 X 2400 에서 맞닿는다
    expect(truth).toEqual({ minX: 2400, maxX: 2525, minY: 0, maxY: 1800 });
  });

  test('예전 규약이었다면 (W−D)/2 만큼 어긋난다', () => {
    // 회귀가 나면 이 값으로 되돌아간다 — 무엇이 틀렸었는지 남겨 둔다.
    const a = { x: 1562.5, y: 837.5, W: 1800, D: 125, rotation: 90 };
    const old = { minX: a.x, maxX: a.x + a.D, minY: a.y, maxY: a.y + a.W };
    expect(old.minX).toBe(1562.5);
    expect(2400 - old.minX).toBe((a.W - a.D) / 2);
  });

  test('90 배수는 정확값이라 부동소수 오차가 없다', () => {
    const p = boot();
    const B = p.g('planeBoxOf')({ x: 0, y: 0, W: 1000, D: 300, rotation: 90 });
    expect(B.x).toBe(350);
    expect(B.y).toBe(-350);
    expect(B.w).toBe(300);
    expect(B.d).toBe(1000);
  });
});

describe('모듈은 영역과 같은 축으로 돈다', () => {
  test('회전 다리에 넣은 모듈이 영역 안에 들어간다', () => {
    const p = boot();
    const areas = p.g('areas');
    areas.forEach((a) => { if (!a.isFinishing) p.g('autoCalcArea')(a.id); });
    const outside = [];
    p.g('modules').filter((m) => !m.isFinishing).forEach((m) => {
      const a = areas.find((x) => x.id === m.areaId);
      const MB = p.g('modulePlaneBox')(m);
      const AB = p.g('planeBoxOf')(a);
      const ok = MB.x >= AB.x - 1 && MB.x + MB.w <= AB.x + AB.w + 1
              && MB.y >= AB.y - 1 && MB.y + MB.d <= AB.y + AB.d + 1;
      if (!ok) outside.push({ id: m.id, mod: [MB.x, MB.x + MB.w], area: [AB.x, AB.x + AB.w] });
    });
    expect(outside).toEqual([]);
  });

  test('회전 다리에도 모듈이 실제로 만들어진다', () => {
    const p = boot();
    const rotArea = p.g('areas')[1];
    p.g('autoCalcArea')(rotArea.id);
    const mods = p.g('modules').filter((m) => m.areaId === rotArea.id && !m.isFinishing);
    expect(mods.length).toBeGreaterThan(0);
    mods.forEach((m) => expect(((m.rotation || 0) % 360 + 360) % 360).toBe(90));
  });

  test('회전축은 영역 중심이다 — 제 중심이 아니다', () => {
    const p = boot();
    const rotArea = p.g('areas')[1];
    p.g('autoCalcArea')(rotArea.id);
    const m = p.g('modules').find((x) => x.areaId === rotArea.id && !x.isFinishing);
    const withArea = p.g('modulePlaneBox')(m);
    const ownPivot = p.g('planeBoxOf')(m);           // pivot 없이 = 제 중심
    expect(withArea.cx).not.toBe(ownPivot.cx);       // 두 축이 다른 자리를 낸다
  });
});

describe('정면도도 같은 자리를 쓴다', () => {
  test('영역 사각형이 평면 자리에서 나온다', () => {
    const p = boot();
    p.g('renderFrontView')();
    const rects = [...p.document.querySelectorAll('#contentG [data-area-id]')];
    expect(rects.length).toBeGreaterThan(0);
  });

  test('두 다리가 정면도에서 겹치지 않는다', () => {
    // 예전엔 회전 다리가 (W−D)/2 만큼 왼쪽으로 밀려 가로 다리와 겹쳐 보였다.
    const p = boot();
    const [a0, a1] = p.g('areas');
    const r0 = p.g('areaFrontRect')(a0);
    const r1 = p.g('areaFrontRect')(a1);
    const gap = Math.max(r0.x, r1.x) - Math.min(r0.x + r0.w, r1.x + r1.w);
    expect(gap).toBeGreaterThanOrEqual(0);           // 벌어지거나 맞닿는다
  });
});

describe('소스 규약', () => {
  test('배치 단계는 자기 중심으로 돈다 — 이 규약이 정본이다', () => {
    const fn = SHELL.slice(SHELL.indexOf('function getRotatedCorners'),
                           SHELL.indexOf('function getVisualBBox'));
    expect(fn).toContain('const cx = x + w / 2, cy = y + h / 2;');
  });

  test('구조 단계의 회전 계산이 한 곳이다', () => {
    // 예전엔 다섯 곳이 저마다 폭·깊이를 맞바꿨다.
    expect(SRC).toContain('function planeBoxOf(o, pivot)');
    expect(SRC).toContain('function modulePlaneBox(m)');
    // 맞바꾸기가 planeBoxOf 밖에 남아 있으면 안 된다.
    const outside = SRC.split('function planeBoxOf')[0]
      + SRC.split('function areaPivotOf')[1];
    expect(outside).not.toMatch(/rot === 90 \|\| rot === 270/);
  });

  test('영역 상자도 모듈과 같이 회전한다', () => {
    const fn = SRC.slice(SRC.indexOf('function renderAreas3D'), SRC.indexOf('function fitCameraToAreas'));
    expect(fn).toContain('planeBoxOf(a)');
    expect(fn).toContain('box.rotation.y = -(a.rotation || 0) * Math.PI / 180;');
    expect(fn).toContain('makeBox(a.W, a.H, a.D');
  });

  test('3D 모듈은 영역 축으로 돈다', () => {
    const fn = SRC.slice(SRC.indexOf('moduleMesh.position.x'), SRC.indexOf('moduleMesh.position.x') + 400);
    expect(fn).toContain('B.cx - ox');
    expect(fn).toContain('B.cy - oy');
  });
});
