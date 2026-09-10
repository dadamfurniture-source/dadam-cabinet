/**
 * W12-55: 겹친 배치 공간을 구조 단계로 넘기기 전에 알린다.
 *
 * 구조 단계는 배치 공간 하나를 **라인 하나**로 본다. 두 배치 공간이 겹쳐 있으면
 * 같은 자리를 둘이 주장하는 셈이라 모듈이 서로를 파고들고, 코너가 있으면
 * 멍장 치수까지 어긋난다 — 겹친 자리를 누가 갖는지 정할 방법이 없기 때문이다.
 *
 * 고치는 도구는 이미 있다 (좌측 ✂ 트리밍). 이 테스트가 지키는 계약:
 *
 *   1) 겹친 쌍을 찾는다 — 판정은 트리밍과 **같은 상자**를 쓴다
 *   2) 맞닿은 것은 겹친 것이 아니다 (트리밍 결과가 다시 걸리면 안 된다)
 *   3) 상부장이 하부장 위에 얹힌 것은 겹침이 아니다
 *   4) 넘어가기 전에 확인을 받고, 취소하면 이동하지 않는다
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'mockup-shell.html'), 'utf8');

const D = 650;

/** 배치 단계를 띄우고 저장된 배치를 복원시킨다 (fromStructure 토큰으로 자동 복원) */
function boot(modules) {
  const layout = { version: 1, savedAt: '2026-09-01T00:00:00.000Z', person: null, modules };
  const p = bootPlanner('mockup-shell.html', {
    search: '?design=d1&item=1',
    storage: { 'dadam_layout_v1::d1:1': JSON.stringify(layout) },
    session: { fromStructure: '1' },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

const rect = (over) => Object.assign(
  { section: 'lower', x: 0, y: 0, w: 1800, h: D, moduleH: 870, rotation: 0, finishings: [] }, over);

describe('겹친 배치 공간을 찾아낸다', () => {
  test('겹쳐 그린 ㄱ자는 한 쌍이 잡힌다', () => {
    // 트리밍하지 않은 ㄱ자 — 코너 사각형을 둘이 나눠 갖는다
    const legW = 1970;
    const p = boot([
      rect({ w: 3600 }),
      rect({ x: D / 2 - legW / 2, y: legW / 2 - D / 2, w: legW, rotation: 90 }),
    ]);
    const pairs = p.g('overlappingRectPairs')();
    expect(pairs.length).toBe(1);
    // 코너 사각형만큼 겹친다
    expect(pairs[0].ox).toBe(D);
    expect(pairs[0].oy).toBe(D);
  });

  test('맞닿은 것은 겹친 것이 아니다 — 트리밍 결과가 다시 걸리면 안 된다', () => {
    const legW = 1970 - D;
    const p = boot([
      rect({ w: 3600 }),
      // 가로 사각형 깊이만큼 잘라 낸 자리에서 시작한다 (trimAgainst 결과)
      rect({ x: D / 2 - legW / 2, y: D + legW / 2 - D / 2, w: legW, rotation: 90 }),
    ]);
    expect(p.g('overlappingRectPairs')()).toEqual([]);
  });

  test('나란히 붙은 두 배치 공간도 겹침이 아니다', () => {
    const p = boot([rect({ x: 0, w: 1800 }), rect({ x: 1800, w: 1200 })]);
    expect(p.g('overlappingRectPairs')()).toEqual([]);
  });

  test('상부장이 하부장 위에 얹힌 것은 겹침이 아니다', () => {
    // 단이 다르면 평면에서 같은 자리를 쓰는 것이 정상이다
    const p = boot([
      rect({ section: 'lower', w: 1800, h: D }),
      rect({ section: 'upper', w: 1800, h: 320, moduleH: 800 }),
    ]);
    expect(p.g('overlappingRectPairs')()).toEqual([]);
  });

  test('같은 단끼리는 여전히 잡는다 (단 구분이 검사를 무디게 하지 않았다)', () => {
    const p = boot([
      rect({ section: 'upper', w: 1800, h: 320, moduleH: 800 }),
      rect({ section: 'upper', x: 900, w: 1800, h: 320, moduleH: 800 }),
    ]);
    expect(p.g('overlappingRectPairs')().length).toBe(1);
  });

  test('겹친 사각형에 표시가 붙는다 — 어디를 트리밍할지 보이게', () => {
    const p = boot([rect({ w: 1800 }), rect({ x: 900, w: 1800 })]);
    const pairs = p.g('overlappingRectPairs')();
    p.g('markOverlaps')(pairs);
    expect(p.document.querySelectorAll('g.sect-rect.overlap-warn').length).toBe(2);
    // 다시 부르면 옛 표시는 지워진다
    p.g('markOverlaps')([]);
    expect(p.document.querySelectorAll('g.sect-rect.overlap-warn').length).toBe(0);
  });
});

describe('겹쳐 있으면 구조 단계로 넘어가지 않는다', () => {
  /**
   * W12-75: 예전엔 confirm 으로 "그래도 넘어갈까요?" 를 물었다. 확인을 누르면
   *   그대로 진행됐는데, 확인은 "봤다" 는 뜻이지 "겹쳐도 좋다" 는 뜻이 아니었다.
   *   이제 alert 로 알리고 **그 자리에 선다.**
   */
  function pressNext(p) {
    const told = [];
    p.window.alert = (msg) => { told.push(msg); };
    p.window.confirm = () => { throw new Error('confirm 을 쓰면 안 된다 — 물어보지 않는다'); };
    p.document.getElementById('nextStepBtn').onclick();
    return told;
  }

  test('겹쳐 있으면 알리고 넘어가지 않는다', () => {
    const p = boot([rect({ w: 1800 }), rect({ x: 900, w: 1800 })]);
    const told = pressNext(p);
    expect(told.length).toBe(1);
    expect(told[0]).toMatch(/겹쳐 있습니다/);
    expect(told[0]).toMatch(/트리밍/);          // 고치는 도구를 알려준다
    expect(told[0]).not.toMatch(/넘어갈까요/);   // 물어보지 않는다
    expect(p.location.href).not.toMatch(/mockup-structure/);
  });

  test('겹친 채로는 다시 저장하지도 않는다 — 그 자리에 선다', () => {
    // 씨앗 배치는 이미 저장소에 있다. 넘어가기가 다시 쓰지 않았음을 savedAt 으로 본다.
    const p = boot([rect({ w: 1800 }), rect({ x: 900, w: 1800 })]);
    const before = JSON.parse(p.storage.getItem('dadam_layout_v1::d1:1')).savedAt;
    pressNext(p);
    expect(JSON.parse(p.storage.getItem('dadam_layout_v1::d1:1')).savedAt).toBe(before);
  });

  test('겹치지 않으면 아무것도 알리지 않고 넘어간다', () => {
    const p = boot([rect({ x: 0, w: 1800 }), rect({ x: 1800, w: 1200 })]);
    const before = JSON.parse(p.storage.getItem('dadam_layout_v1::d1:1')).savedAt;
    expect(pressNext(p)).toEqual([]);
    expect(JSON.parse(p.storage.getItem('dadam_layout_v1::d1:1')).savedAt).not.toBe(before);
  });

  test('겹친 곳에 표시가 남는다 — 어디를 트리밍할지 보이게', () => {
    const p = boot([rect({ w: 1800 }), rect({ x: 900, w: 1800 })]);
    pressNext(p);
    expect(p.document.querySelectorAll('g.sect-rect.overlap-warn').length).toBe(2);
  });
});

describe('소스 규약', () => {
  test('판정이 트리밍과 같은 상자를 쓴다', () => {
    // 고치는 도구가 트리밍이므로, 트리밍이 겹쳤다고 보는 것만 겹쳤다고 해야 한다.
    const fn = SHELL.slice(SHELL.indexOf('function overlappingRectPairs'),
                           SHELL.indexOf('function markOverlaps'));
    expect(fn).toContain('getVisualBBox');
  });

  test('마감재는 배치 공간이 아니다 — 검사에서 뺀다', () => {
    const fn = SHELL.slice(SHELL.indexOf('function overlappingRectPairs'),
                           SHELL.indexOf('function markOverlaps'));
    expect(fn).toContain("classList.contains('finishing')");
  });

  test('겹침 표시 스타일이 있다', () => {
    expect(SHELL).toMatch(/\.sect-rect\.overlap-warn rect:not\(\.resize-handle\)\{[^}]*stroke:/);
  });
});
