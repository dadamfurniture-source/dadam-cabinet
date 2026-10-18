/**
 * @jest-environment node
 *
 * 급수·배기를 사람이 알려줄 수 있다 (water/exhaust_from_left_override).
 *
 * 왜: 시공 전 사진 828장 실측(2026-10)에서 주방 급수는 56%, 배기는 48% 만 읽혔다.
 * 못 읽으면 싱크 30% · 쿡탑 70% 로 **추측해서 배치**된다. 현장에서 잰 값이 있으면 그게 이겨야 한다.
 *
 * 고정하는 것:
 *   1) mm 를 벽 폭 기준 %로 바꾸고, read 플래그를 세운다 (추측이 아니라는 표시)
 *   2) 벽 밖이거나 숫자가 아니면 **무시한다** — 잘못 친 값으로 가구를 옮기지 않는다
 *   3) 주방 품목에서만 받는다 (KITCHEN_CATEGORIES)
 */

const fs = require('fs');
const path = require('path');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^import .*?;\n/gms, '')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}
const J = loadEsm('workers/generate-api/src/job.js', ['applyManualPlumbing']);
const P = loadEsm('workers/generate-api/src/prompts.js', ['KITCHEN_CATEGORIES']);
const WORKER = fs.readFileSync(path.join(__dirname, '..', 'workers/generate-api/src/worker.js'), 'utf8');
const JOB = fs.readFileSync(path.join(__dirname, '..', 'workers/generate-api/src/job.js'), 'utf8');
const MY = fs.readFileSync(path.join(__dirname, '..', 'my-designs.html'), 'utf8');

const fresh = () => ({
  wallW: 3000,
  waterPct: 30,
  exhaustPct: 70,
  confidence: 'medium',
  read: { width: true, height: true, water: false, exhaust: false },
});

describe('mm → %', () => {
  test('벽 3000 에서 급수 900mm 는 30%, 배기 2100mm 는 70%', () => {
    const w = fresh();
    J.applyManualPlumbing(w, { water_from_left_override: 900, exhaust_from_left_override: 2100 });
    expect(w.waterPct).toBe(30);
    expect(w.exhaustPct).toBe(70);
  });

  test('값이 같아도 read 가 서는 것이 핵심이다 — 추측 30% 와 구분된다', () => {
    const w = fresh();
    J.applyManualPlumbing(w, { water_from_left_override: 900 });
    expect(w.read.water).toBe(true);
    expect(w.read.exhaust).toBe(false);
    expect(w.confidence).toBe('user');
  });

  test('벽 폭이 다르면 % 도 다르다', () => {
    const w = { ...fresh(), wallW: 4000 };
    J.applyManualPlumbing(w, { water_from_left_override: 1000 });
    expect(w.waterPct).toBe(25);
  });

  test('벽 끝에 붙여도 5~95 안으로 자른다', () => {
    const a = fresh();
    J.applyManualPlumbing(a, { water_from_left_override: 30 });
    expect(a.waterPct).toBe(5);
    const b = fresh();
    J.applyManualPlumbing(b, { exhaust_from_left_override: 2990 });
    expect(b.exhaustPct).toBe(95);
  });
});

describe('잘못된 값은 무시한다', () => {
  test.each([
    ['벽 밖', { water_from_left_override: 5000 }],
    ['0', { water_from_left_override: 0 }],
    ['음수', { water_from_left_override: -100 }],
    ['빈 문자열', { water_from_left_override: '' }],
    ['글자', { water_from_left_override: '몰라요' }],
    ['없음', {}],
  ])('%s → 그대로 둔다', (_, opts) => {
    const w = fresh();
    const r = J.applyManualPlumbing(w, opts);
    expect(r.water).toBe(false);
    expect(w.waterPct).toBe(30);
    expect(w.read.water).toBe(false);
    expect(w.confidence).toBe('medium');   // 사람이 안 넣었으면 신뢰도도 그대로
  });

  test('read 가 없는 옛 구조에서도 터지지 않는다', () => {
    const w = { wallW: 3000, waterPct: 30, exhaustPct: 70 };
    expect(() => J.applyManualPlumbing(w, { water_from_left_override: 1500 })).not.toThrow();
    expect(w.waterPct).toBe(50);
  });
});

describe('워커가 받아서 옵션에 싣는다', () => {
  test('본문에서 두 값을 꺼낸다', () => {
    expect(WORKER).toMatch(/water_from_left_override,/);
    expect(WORKER).toMatch(/exhaust_from_left_override,/);
  });

  test('신규 생성과 재생성 양쪽 모두', () => {
    expect((WORKER.match(/water_from_left_override: KITCHEN_CATEGORIES/g) || []).length).toBe(2);
  });

  test('주방 품목에서만 싣는다 — 붙박이장 요청에 실려 와도 버린다', () => {
    expect(P.KITCHEN_CATEGORIES).toEqual(['sink', 'island']);
    expect(WORKER).toMatch(/KITCHEN_CATEGORIES,/);   // import 되어 있어야 한다
  });

  test('벽 폭 보정 뒤에 적용한다 — % 는 벽 폭을 나눠 쓴다', () => {
    const i = JOB.indexOf('wall.wallW = clampWall(manualW)');
    const j = JOB.indexOf('applyManualPlumbing(wall, opts)');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
});

describe('내 연출컷의 안내도 같은 집합', () => {
  test('냉장고장에는 싱크·후드 이야기를 띄우지 않는다', () => {
    const fn = MY.slice(MY.indexOf('function renderWall'), MY.indexOf('function closeDetail'));
    expect(fn).toMatch(/\['sink', 'island'\]/);
    expect(fn).not.toMatch(/'fridge'/);
  });
});
