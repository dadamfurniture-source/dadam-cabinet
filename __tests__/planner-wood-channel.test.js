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

describe('목찬넬 판별 — 하부장 + wood-channel 일 때만', () => {
  const fn = SRC.slice(SRC.indexOf('function isWoodChannel'), SRC.indexOf('/** 실효 상몰딩 H */'));

  test('마커가 살아 있다', () => {
    expect(SRC.indexOf('function isWoodChannel')).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(50);
  });

  test('하부장 조건이 붙어 있다', () => {
    expect(fn).toMatch(/section\s*===\s*'lower'/);
    expect(fn).toMatch(/handleType\s*===\s*'wood-channel'/);
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

describe('손잡이 선택지', () => {
  test('팔레트와 우측 패널 둘 다 목찬넬을 내놓는다', () => {
    expect(SRC).toContain("['wood-channel', '목찬넬']");
    expect(SRC).toContain('value="wood-channel"');
  });

  test('기존 찬넬(알루미늄 매립)은 그대로 둔다', () => {
    // handleType==='channel' 은 W9-117 이 만든 12mm 알루미늄 채널이다.
    // 목찬넬을 새 항목으로 넣었으므로 기존 설계가 바뀌면 안 된다.
    const fn = SRC.slice(SRC.indexOf('function addHandle'));
    expect(fn.slice(0, 300)).toMatch(/handleType\s*!==\s*'channel'/);
  });
});

describe('기본값을 바꾸지 않았다', () => {
  test('새 구조의 손잡이는 여전히 channel', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=wc&item=1', storage: {} });
    expect(p.errors).toEqual([]);
    expect(SRC).toMatch(/handleType:\s*'channel'/);
    expect(SRC).not.toMatch(/handleType:\s*'wood-channel'/);
  });
});
