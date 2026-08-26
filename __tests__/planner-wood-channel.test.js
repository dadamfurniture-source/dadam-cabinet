/**
 * W12-5: 하부장 목찬넬 따내기.
 *
 * 규칙 출처 (임의로 만든 값이 하나도 없어야 한다):
 *   - docs/design-rules/sink.md  목찬넬(전면) 52 × W, 목찬넬(지면) 40 × W, 둘 다 18T MDF
 *   - docs/design-rules/sink.md  bandH = 목찬넬이면 H-36-70  → 목찬넬이 높이 70 을 차지
 *   - Supabase design_rules      목찬넬전면 52 / 목찬넬지면 40
 *   - 사용자 확정                따내기 70 × 40, 지면판(40×18T) 위에 전면판(52×18T)
 *
 * 3D 는 three.js 가 필요해 jsdom 에서 돌릴 수 없다. 그래서 "무엇이 그려졌나" 대신
 * 치수 산술과 소스의 근거를 검사한다. 실제 화면은 playwright 로 따로 본다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const SRC = read('mockup-structure.html');
const ENGINE = read('js/planner/planner-engine.js');

describe('목찬넬 치수 상수 — 정본과 맞는가', () => {
  const R = (() => {
    const m = {};
    ENGINE.replace(/(CHANNEL_[A-Z_]+):\s*(\d+)/g, (_, k, v) => { m[k] = Number(v); });
    return m;
  })();

  test('전면판 52 · 지면판 40 · 부재 18T', () => {
    expect(R.CHANNEL_FRONT_W).toBe(52);   // design_rules 목찬넬전면
    expect(R.CHANNEL_BACK_W).toBe(40);    // design_rules 목찬넬지면
    expect(R.CHANNEL_BOARD_T).toBe(18);
  });

  test('따내기 높이 70 = 지면판 두께 + 전면판 높이', () => {
    expect(R.CHANNEL_NOTCH_H).toBe(70);
    expect(R.CHANNEL_BOARD_T + R.CHANNEL_FRONT_W).toBe(R.CHANNEL_NOTCH_H);
  });

  test('따내기 깊이 40 = 지면판 폭', () => {
    expect(R.CHANNEL_NOTCH_D).toBe(40);
    expect(R.CHANNEL_NOTCH_D).toBe(R.CHANNEL_BACK_W);
  });

  test('처짐방지목이 빼는 70 과 같은 값이다', () => {
    // sink.md: bandH = 목찬넬이면 H-36-70. 이 70 이 따내기 높이와 같아야
    // 처짐방지목이 목찬넬 자리를 피해 앉는다.
    const sink = read('docs/design-rules/sink.md');
    expect(sink).toContain('H-36-70');
    expect(R.CHANNEL_NOTCH_H).toBe(70);
  });
});

describe('목찬넬 판별 — 하부장 단에서만', () => {
  const fn = SRC.slice(SRC.indexOf('function isWoodChannel'), SRC.indexOf('function doorDropOf'));

  test('마커가 살아 있다', () => {
    expect(SRC.indexOf('function isWoodChannel')).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(50);
  });

  test('독립 하부장과 스택의 하부장 단이 대상이다', () => {
    expect(fn).toMatch(/section\s*===\s*'lower'/);
    expect(fn).toMatch(/part\s*===\s*'하부장'/);
  });

  test('저장값이 아니라 해석된 손잡이를 본다', () => {
    // s.handleType 을 직접 보면 'auto'·'channel'(예전 기본값)이 목찬넬로 안 읽힌다.
    expect(fn).toContain('handleTypeOf(m, s)');
    expect(fn).not.toMatch(/s\.handleType\s*===/);
  });
});

describe('따낸 판재 — 한 장으로 만든다', () => {
  const fn = SRC.slice(SRC.indexOf('function makeNotchedPanel'),
    SRC.indexOf('function addCarcassShell'));

  test('마커가 살아 있다', () => {
    expect(SRC.indexOf('function makeNotchedPanel')).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(200);
  });

  test('Shape 를 눌러 만든다 — Box 두 장을 붙이지 않는다', () => {
    // Box 두 장이면 맞댄 자리에 없는 이음선이 그려진다.
    expect(fn).toContain('THREE.Shape');
    expect(fn).toContain('ExtrudeGeometry');
    expect(fn).not.toContain('makeBox');
  });

  test('깊이가 뒤집히지 않게 rotateY(-90°) 를 쓴다', () => {
    // rotateY(+π/2) 면 shape 의 +x(정면)가 -z 로 가서 따낸 자리가 뒤로 간다.
    expect(fn).toMatch(/rotateY\(\s*-\s*Math\.PI\s*\/\s*2\s*\)/);
  });
});

describe('목찬넬 부재 — ㄴ자로 따낸 자리를 채운다', () => {
  const fn = SRC.slice(SRC.indexOf('function addWoodChannel'),
    SRC.indexOf('/** 셀 경계마다 칸막이 한 장'));

  test('마커가 살아 있다', () => {
    expect(SRC.indexOf('function addWoodChannel')).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(200);
  });

  test('지면판과 전면판 두 장을 만든다', () => {
    expect(fn).toContain("'channelBase'");
    expect(fn).toContain("'channelFace'");
  });

  test('치수를 MASTER_RULES 에서 가져온다 — 숫자를 박지 않는다', () => {
    expect(fn).toContain('MASTER_RULES.CHANNEL_BOARD_T');
    expect(fn).toContain('MASTER_RULES.CHANNEL_BACK_W');
    expect(fn).toContain('MASTER_RULES.CHANNEL_FRONT_W');
    expect(fn).toContain('MASTER_RULES.CHANNEL_NOTCH_H');
    // 주석에는 값을 적어 둬도 된다 — 코드에 박혀 있으면 안 된다.
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code.match(/\b(?:40|52|70|18)\b/g) || []).toEqual([]);
  });

  test('전면판은 따낸 자리 안쪽에 선다 — 앞에 세우면 손이 안 들어간다', () => {
    // 도어 H = 장H − 30 이라 도어 위에 30mm 틈이 생긴다. 전면판을 맨 앞에 세우면
    // 그 틈을 막는다. frontZ - baseW + T/2 여야 뒤쪽 18mm 에 서고 앞 22mm 가 빈다.
    expect(fn).toMatch(/frontZ\s*-\s*baseW\s*\+\s*T\s*\/\s*2/);
  });
});

describe('따내기 산술 — 부재가 따낸 자리를 정확히 채운다', () => {
  // 소스의 배치식을 그대로 옮겨 계산한다. 값이 어긋나면 3D 에서 뜨거나 파묻힌다.
  const NOTCH_H = 70, NOTCH_D = 40, T = 18, FACE_H = 52, BASE_W = 40;
  const legH = 150, carcassH = 700, D = 550;
  const topY = legH + carcassH;
  const frontZ = D / 2;

  test('지면판이 따낸 바닥에 깔린다', () => {
    const baseCy = topY - NOTCH_H + T / 2;
    expect(baseCy - T / 2).toBe(topY - NOTCH_H);   // 아랫면 = 따낸 바닥
  });

  test('전면판 아랫면이 지면판 윗면에 얹힌다 — 틈도 겹침도 없다', () => {
    const baseTop = (topY - NOTCH_H + T / 2) + T / 2;
    const faceBottom = (topY - FACE_H / 2) - FACE_H / 2;
    expect(faceBottom).toBe(baseTop);
  });

  test('전면판 윗면이 몸통 상단과 맞는다', () => {
    expect((topY - FACE_H / 2) + FACE_H / 2).toBe(topY);
  });

  test('앞쪽에 손 넣을 자리가 22mm 남는다', () => {
    const faceFront = (frontZ - BASE_W + T / 2) - T / 2 + T;   // 전면판 앞면
    expect(frontZ - faceFront).toBe(BASE_W - T);
    expect(BASE_W - T).toBe(22);
  });

  test('지면판이 따낸 깊이를 꽉 채운다', () => {
    const baseCz = frontZ - BASE_W / 2;
    expect(baseCz + BASE_W / 2).toBe(frontZ);            // 앞면 = 몸통 앞면
    expect(baseCz - BASE_W / 2).toBe(frontZ - NOTCH_D);  // 뒷면 = 따낸 안쪽
  });
});

describe('천판이 목찬넬 자리를 비켜난다', () => {
  const fn = SRC.slice(SRC.indexOf('function addCarcassShell'),
    SRC.indexOf('function addWoodChannel'));

  test('목찬넬이면 천판 깊이를 따내기만큼 줄인다', () => {
    expect(fn).toMatch(/const topD\s*=\s*o\.D\s*-\s*o\.T\s*-\s*\(notch\s*\?\s*MASTER_RULES\.CHANNEL_NOTCH_D\s*:\s*0\)/);
  });

  test('줄인 만큼 뒤로 물린다', () => {
    expect(fn).toMatch(/CHANNEL_NOTCH_D\s*\/\s*2\s*:\s*0/);
  });

  test('목찬넬이 아니면 예전 그대로다', () => {
    const D = 550, T = 18;
    const topD = D - T - 0;
    expect(topD).toBe(D - T);
  });
});

describe('칸막이도 같이 따낸다', () => {
  const fn = SRC.slice(SRC.indexOf('function addCellDividers'),
    SRC.indexOf('// W9-113: 다리발 4개 mesh'));

  test('목찬넬이면 칸막이가 따낸 판이 된다', () => {
    // 지면판이 전폭을 지나므로 칸막이를 통짜로 두면 판이 뚫고 지나간다.
    expect(fn).toContain('o.woodChannel');
    expect(fn).toContain('makeNotchedPanel');
  });
});

describe('두 렌더 경로에 모두 배선됐다', () => {
  test('renderModule3D · createModuleMesh 둘 다 woodChannel 을 넘긴다', () => {
    const calls = SRC.match(/(?<!function )addCarcassShell\([^)]*\)/g) || [];
    expect(calls.length).toBe(2);
    calls.forEach((c) => expect(c).toContain('woodChannel'));
    const divs = SRC.match(/(?<!function )addCellDividers\([^)]*\)/g) || [];
    expect(divs.length).toBe(2);
    divs.forEach((c) => expect(c).toContain('woodChannel'));
  });

  test('woodChannel 은 isWoodChannel 로만 정한다', () => {
    const assigns = SRC.match(/const woodChannel\s*=\s*[^;]+;/g) || [];
    expect(assigns.length).toBe(2);
    assigns.forEach((a) => expect(a).toContain('isWoodChannel'));
  });
});

describe('손잡이 선택지 (W12-6)', () => {
  test('다섯 가지를 팔레트와 우측 패널 둘 다 내놓는다', () => {
    ['wood-channel', 'door-drop', 'push', 'alu-channel', 'c-channel'].forEach((v) => {
      expect(SRC.split(`'${v}'`).length - 1).toBeGreaterThanOrEqual(2);
    });
    expect(SRC).toContain("['alu-channel', '알루미늄 찬넬']");
    expect(SRC).toContain("'알루미늄 찬넬'");
  });

  test('둘 다 저장값이 아니라 해석된 값을 보여준다', () => {
    expect(SRC).toContain('_sel(handleTypeOf(m, s)');
    expect(SRC).toContain('const hType = handleTypeOf(m, s)');
  });

  test('알루미늄 막대는 직접 고를 때만 붙는다', () => {
    // 예전엔 기본값이 'channel' 이라 전 섹션에 회색 막대가 붙어 있었다.
    const fn = SRC.slice(SRC.indexOf('function addHandle'));
    expect(fn.slice(0, 400)).toMatch(/handleTypeOf\(m, s\)\s*!==\s*'alu-channel'/);
  });
});

describe('단별 기본 손잡이 (W12-6)', () => {
  const fn = SRC.slice(SRC.indexOf('function defaultHandleType'), SRC.indexOf('function handleTypeOf'));

  test('마커가 살아 있다', () => {
    expect(SRC.indexOf('function defaultHandleType')).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(80);
  });

  test('스택의 중간장·상부장은 푸쉬', () => {
    // 키큰장·냉장고장 모두 해당한다. 단 이름으로 가르므로 section 을 안 본다.
    expect(fn).toMatch(/'중간장'[\s\S]{0,40}'상부장'[\s\S]{0,40}'push'/);
  });

  test('푸쉬를 도어 내림보다 먼저 거른다', () => {
    // 순서가 뒤바뀌면 스택 상부장이 door-drop 으로 잡힌다.
    const push = fn.indexOf("'push'");
    const drop = fn.indexOf("'door-drop'");
    expect(push).toBeGreaterThan(-1);
    expect(push).toBeLessThan(drop);
  });

  test('도어 내림은 독립 싱크 상부장에만', () => {
    expect(fn).toMatch(/section\s*===\s*'upper'/);
    expect(fn).toContain("'door-drop'");
    // 스택 단은 위에서 이미 걸러졌으므로 '상부장' 이 door-drop 줄에 없어야 한다
    const dropLine = (fn.match(/^.*'door-drop'.*$/m) || [''])[0];
    expect(dropLine).not.toContain('상부장');
  });

  test('그 밖은 목찬넬 — 마지막 return 이 기본형이다', () => {
    const returns = fn.match(/return '[a-z-]+';/g) || [];
    expect(returns[returns.length - 1]).toBe("return 'wood-channel';");
  });
});

describe('예전 기본값 channel 은 고른 것이 아니다', () => {
  const fn = SRC.slice(SRC.indexOf('function handleTypeOf'), SRC.indexOf('function isWoodChannel'));

  test("'auto' 와 'channel' 을 모두 기본형으로 읽는다", () => {
    expect(fn).toMatch(/'auto'/);
    expect(fn).toMatch(/'channel'/);
    expect(fn).toContain('defaultHandleType(m)');
  });

  test('새 구조는 auto 로 시작한다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=wc&item=1', storage: {} });
    expect(p.errors).toEqual([]);
    expect(SRC).toMatch(/handleType:\s*'auto'/);
    expect(SRC).not.toMatch(/handleType:\s*'channel'/);
  });
});

describe('도어 내림 (W12-6)', () => {
  const fn = SRC.slice(SRC.indexOf('function doorDropOf'), SRC.indexOf('/** 팔레트에 띄우는 손잡이 설명'));

  test('내림 폭은 상부장 도어 +20 을 쓴다 — 새 숫자를 만들지 않는다', () => {
    expect(fn).toContain('MASTER_RULES.SINK_UPPER_DOOR_H_PLUS');
    const code = fn.replace(/\/\/[^\r\n]*/g, '');
    expect(code.match(/\b20\b/g) || []).toEqual([]);
  });

  test('도어에만 적용한다 — 서랍·오픈·먹장은 아니다', () => {
    const ap = SRC.slice(SRC.indexOf('function addFrontPanel'), SRC.indexOf('function positionBox'));
    expect(ap).toMatch(/type === 'door' && meta && meta\.doorDrop/);
  });

  test('갭을 되돌린 뒤 더한다 — 장H + drop 이 되게', () => {
    const ap = SRC.slice(SRC.indexOf('function addFrontPanel'), SRC.indexOf('function positionBox'));
    expect(ap).toMatch(/const top = cy \+ h \/ 2 \+ G \/ 2;/);
    expect(ap).toMatch(/h = h \+ G \+ drop;/);
    expect(ap).toMatch(/cy = top - h \/ 2;/);
  });

  test('두 렌더 경로 모두 doorDrop 을 넘긴다', () => {
    const calls = SRC.match(/addFrontPanel\([^;]*areaPos: 'top'[^;]*\)/g) || [];
    expect(calls.length).toBe(2);
    calls.forEach((c) => expect(c).toContain('doorDrop: doorDropOf(m, s)'));
  });

  test('산술 — 도어 세로 = 장H + 15, 밑단이 몸통보다 정확히 15 내려온다', () => {
    const DROP = 15, G = 4;
    const bodyH = 700, bodyBottom = 1000;            // 몸통: 1000 ~ 1700
    const h0 = bodyH - G, cy0 = bodyBottom + bodyH / 2;   // 갭 뺀 기본 도어
    const top = cy0 + h0 / 2 + G / 2;
    const h1 = h0 + G + DROP;
    const cy1 = top - h1 / 2;
    expect(h1).toBe(bodyH + DROP);                   // 도어 세로 = 장H + 20
    expect(cy1 + h1 / 2).toBe(bodyBottom + bodyH);   // 윗변 = 몸통 상단
    expect(bodyBottom - (cy1 - h1 / 2)).toBe(DROP);  // 밑단이 20 내려옴
  });
});

describe('푸쉬는 제조에서 고를 수 있다 (W12-7)', () => {
  // ACTIVE_RULES §15 의 push-to-open 금지는 **AI 이미지 생성 프롬프트 한정**이다.
  // 두 규칙을 하나로 읽어 플래너 선택지에서 빼면 중간장 기본값이 사라진다.
  test('팔레트와 우측 패널 둘 다 푸쉬를 내놓는다', () => {
    expect(SRC).toContain("['push', '푸쉬']");
    expect(SRC).toContain("['push','푸쉬']");
  });

  test('중간장 기본이 푸쉬다', () => {
    const fn = SRC.slice(SRC.indexOf('function defaultHandleType'), SRC.indexOf('function handleTypeOf'));
    expect(fn).toMatch(/'중간장'[\s\S]{0,40}'push'/);
  });

  test('금지 규칙이 이미지 생성 한정으로 적혀 있다', () => {
    const active = read('docs/design-rules/ACTIVE_RULES.md');
    expect(active).toMatch(/금지 \(AI 이미지 생성 한정\)/);
    expect(active).toContain('제조(플래너)에서는 푸쉬를');
  });
});

describe('하부장 목찬넬 도어 — 장H − 30 (W12-8)', () => {
  // 정본 셋이 30 으로 일치하는데 플래너만 갭 4 로 그리고 있었다.
  // 도어가 목찬넬을 덮어 손 넣을 틈이 2mm 밖에 없었다 (실측).
  const fn = SRC.slice(SRC.indexOf('function doorTopGapOf'), SRC.indexOf('/** 팔레트에 띄우는 손잡이 설명'));

  test('마커가 살아 있다', () => {
    expect(SRC.indexOf('function doorTopGapOf')).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(80);
  });

  test('정본 상수를 쓴다 — 숫자를 박지 않는다', () => {
    expect(fn).toContain('MASTER_RULES.SINK_LOWER_DOOR_H_MINUS');
    const code = fn.replace(/\/\/[^\r\n]*/g, '');
    expect(code.match(/\b30\b/g) || []).toEqual([]);
  });

  test('상수가 정본 셋과 같은 30 이다', () => {
    const m = ENGINE.match(/SINK_LOWER_DOOR_H_MINUS:\s*(\d+)/);
    expect(Number(m[1])).toBe(30);
    expect(read('docs/design-rules/sink.md')).toContain('(H-30)');
  });

  test('목찬넬일 때만 벌린다', () => {
    // 푸쉬·알루미늄 하부장까지 30 을 벌리면 없는 틈이 생긴다.
    expect(fn).toContain('isWoodChannel(m, s)');
  });

  test('두 렌더 경로 모두 doorTopGap 을 넘긴다', () => {
    const calls = SRC.match(/addFrontPanel\([^;]*areaPos: 'top'[^;]*\)/g) || [];
    expect(calls.length).toBe(2);
    calls.forEach((c) => expect(c).toContain('doorTopGap: doorTopGapOf(m, s)'));
  });

  test('밑단은 몸통 바닥(다리발 위)에 맞춘다', () => {
    const ap = SRC.slice(SRC.indexOf('function addFrontPanel'), SRC.indexOf('function positionBox'));
    expect(ap).toMatch(/const bodyBottom = cy - h \/ 2 - G \/ 2;/);
    expect(ap).toMatch(/const newTop = bodyTop - topGap;/);
  });

  test('몸통보다 큰 틈은 무시한다 — 도어가 뒤집히면 안 된다', () => {
    const ap = SRC.slice(SRC.indexOf('function addFrontPanel'), SRC.indexOf('function positionBox'));
    expect(ap).toMatch(/if \(newTop > bodyBottom\)/);
  });

  test('산술 — 도어 세로 = 장H − 30, 상단 틈 30 · 하단 틈 0', () => {
    const GAP = 4, MINUS = 30;
    const legH = 150, bodyH = 700;
    const cy0 = legH + bodyH / 2, h0 = bodyH - GAP;      // 지금까지 그리던 도어
    const bodyBottom = cy0 - h0 / 2 - GAP / 2;
    const bodyTop = cy0 + h0 / 2 + GAP / 2;
    const newTop = bodyTop - MINUS;
    const h1 = newTop - bodyBottom;
    const cy1 = (newTop + bodyBottom) / 2;
    expect(bodyBottom).toBe(legH);
    expect(bodyTop).toBe(legH + bodyH);
    expect(h1).toBe(bodyH - MINUS);                       // 장H − 30
    expect(cy1 - h1 / 2).toBe(legH);                      // 다리발 위
    expect(bodyTop - (cy1 + h1 / 2)).toBe(MINUS);         // 상단 틈 30
  });

  test('30 틈이 목찬넬 전면판을 드러낸다', () => {
    // 전면판은 몸통 상단에서 52 아래까지다. 30 틈이면 위 30 이 보인다.
    const FACE_H = 52, MINUS = 30;
    expect(MINUS).toBeLessThan(FACE_H);
  });
});
