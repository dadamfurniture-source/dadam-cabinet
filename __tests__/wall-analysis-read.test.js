/**
 * @jest-environment node
 *
 * 벽면 분석 — **무엇을 실제로 읽었나**를 기록한다 (parseAnalysis.read).
 *
 * 왜 필요한가: waterPct 는 늘 숫자다(못 읽어도 기본값이 남는다). 값만 봐서는 "사진에서 48% 로
 * 읽음" 과 "못 읽어서 기본값 48%" 를 가릴 수 없고, 그래서 고객에게 추측이라는 사실을 알릴 방법이 없었다.
 *
 * 시공 전 사진 828장 실측(2026-10): 벽 치수는 100% 읽지만 주방 급수는 56%, 배기는 48% 만 읽는다.
 * 즉 주방 연출컷의 절반가량이 기본 위치로 그려진다.
 */

const fs = require('fs');
const path = require('path');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}
const P = loadEsm('workers/generate-api/src/prompts.js', ['parseAnalysis']);
const MY = fs.readFileSync(path.join(__dirname, '..', 'my-designs.html'), 'utf8');
const JOB = fs.readFileSync(path.join(__dirname, '..', 'workers/generate-api/src/job.js'), 'utf8');

const full = JSON.stringify({
  wall_width_mm: 3200,
  wall_height_mm: 2350,
  water_supply_from_left_mm: 900,
  exhaust_from_left_mm: 2100,
  confidence: 'high',
});

describe('읽은 것과 기본값을 가린다', () => {
  test('다 읽으면 넷 다 true', () => {
    expect(P.parseAnalysis(full).read).toEqual({ width: true, height: true, water: true, exhaust: true });
  });

  test('배관이 null 이면 그 둘만 false — 값은 기본값이 남는다', () => {
    const w = P.parseAnalysis(
      '{"wall_width_mm":3200,"wall_height_mm":2350,"water_supply_from_left_mm":null,"exhaust_from_left_mm":null}'
    );
    expect(w.read).toEqual({ width: true, height: true, water: false, exhaust: false });
    expect(w.waterPct).toBe(48); // 기본값(실측 중앙값)은 그대로 — 쓰는 쪽이 깨지지 않아야 한다
    expect(w.exhaustPct).toBe(70);
  });

  test('JSON 자체가 없으면 넷 다 false', () => {
    expect(P.parseAnalysis('모델이 말로 답했다').read).toEqual({
      width: false, height: false, water: false, exhaust: false,
    });
  });

  test('0 과 음수는 읽은 것으로 치지 않는다', () => {
    const w = P.parseAnalysis('{"wall_width_mm":0,"water_supply_from_left_mm":-5}');
    expect(w.read.width).toBe(false);
    expect(w.read.water).toBe(false);
  });

  test('기존 필드는 그대로다 — 더하기만 했다', () => {
    expect(P.parseAnalysis(full)).toMatchObject({ wallW: 3200, wallH: 2350, confidence: 'high' });
  });
});

describe('사람이 넣은 벽 폭은 추측이 아니다', () => {
  test('wall_width_override 가 들어오면 read.width 를 세운다', () => {
    expect(JOB).toMatch(/wall\.confidence = 'user';/);
    expect(JOB).toMatch(/if \(wall\.read\) wall\.read\.width = true;/);
  });
});

describe('내 연출컷이 추측을 알린다', () => {
  test('wall_analysis 를 받아온다', () => {
    expect(MY).toMatch(/quote,images,wall_analysis/);
  });

  test('상세 모달에서 벽면 분석을 그린다', () => {
    expect(MY).toMatch(/function renderWall/);
    expect(MY).toMatch(/renderWall\(r\);/);
  });

  test('주방 품목에서만 배관을 말한다', () => {
    const fn = MY.slice(MY.indexOf('function renderWall'), MY.indexOf('function closeDetail'));
    // prompts.js 의 KITCHEN_CATEGORIES 와 같은 집합 (냉장고장에는 싱크·후드가 없다)
    expect(fn).toMatch(/\['sink', 'island'\]/);
    expect(fn).toMatch(/read\.water === false/);
    expect(fn).toMatch(/read\.exhaust === false/);
  });

  test('읽었는지 모르는 옛 기록은 경고하지 않는다 — undefined 는 false 가 아니다', () => {
    const fn = MY.slice(MY.indexOf('function renderWall'), MY.indexOf('function closeDetail'));
    // === false 로 비교해야 read 가 없던 시절 기록에 "기본값" 딱지가 붙지 않는다
    expect(fn).not.toMatch(/!read\.water/);
    expect(fn).not.toMatch(/!read\.width/);
  });
});
