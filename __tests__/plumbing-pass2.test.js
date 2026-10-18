/**
 * @jest-environment node
 *
 * 배관 2차 질문 — 1차가 놓친 싱크·후드만 다시 묻는다.
 *
 * 근거: 시공 전 주방 121장 실측(2026-10)에서 1차 분석은 급수 56% · 배기 48% 만 읽었다.
 * 놓친 53장에 **배관만 묻는 좁은 질문**을 다시 던지니 싱크 27 · 후드 30 을 더 찾았다.
 * 학습이 아니라 질문을 바꾼 것이다. 대조군 18장에서 두 프롬프트 차이는 중앙 6p, 25p 초과 0건.
 *
 * 고정하는 것:
 *   1) 주방이고, 1차가 놓쳤을 때만 부른다 (돈이 드는 호출이다)
 *   2) 이미 읽은 쪽은 덮어쓰지 않는다
 *   3) 실패해도 조용히 넘어간다 — 기본값이 남는다
 *   4) 사람이 넣은 값은 2차보다 뒤에 적용된다 (사람이 이긴다)
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
const P = loadEsm('workers/generate-api/src/prompts.js', [
  'buildPlumbingPrompt',
  'parsePlumbing',
  'parseAnalysis',
]);
const JOB = fs.readFileSync(path.join(__dirname, '..', 'workers/generate-api/src/job.js'), 'utf8');

describe('좁은 질문', () => {
  test('벽 폭을 알려 주고 비율로 답하게 한다', () => {
    const p = P.buildPlumbingPrompt(3400);
    expect(p).toContain('3400 mm');
    expect(p).toMatch(/percentage from the LEFT edge/);
  });

  test('두 가지만 묻는다 — 1차의 11가지와 달리', () => {
    const p = P.buildPlumbingPrompt(3000);
    expect(p).toMatch(/sink_pct/);
    expect(p).toMatch(/hood_pct/);
    expect(p).not.toMatch(/room_brief|wall_tile|site_condition|camera_side/);
  });

  test('없을 때만 null 이라고 못박고, 증거를 받는다', () => {
    const p = P.buildPlumbingPrompt(3000);
    expect(p).toMatch(/null ONLY when/);
    expect(p).toMatch(/evidence/);
  });
});

describe('응답 읽기', () => {
  test('비율과 증거를 꺼낸다', () => {
    const r = P.parsePlumbing('{"sink_pct":47,"hood_pct":72,"sink_evidence":"faucet and sink bowl","hood_evidence":"hood above cooktop"}');
    expect(r).toEqual({ water: 47, exhaust: 72, waterWhy: 'faucet and sink bowl', exhaustWhy: 'hood above cooktop' });
  });

  test('null 은 null 로 둔다 — 기본값을 지어내지 않는다', () => {
    expect(P.parsePlumbing('{"sink_pct":null,"hood_pct":null}')).toEqual({
      water: null, exhaust: null, waterWhy: null, exhaustWhy: null,
    });
  });

  test('5~95 로 자른다 — 벽 끝에 붙은 싱크는 없다', () => {
    expect(P.parsePlumbing('{"sink_pct":0,"hood_pct":100}')).toMatchObject({ water: 5, exhaust: 95 });
  });

  test('범위 밖·글자·JSON 아님은 전부 null', () => {
    expect(P.parsePlumbing('{"sink_pct":140}').water).toBeNull();
    expect(P.parsePlumbing('{"sink_pct":"왼쪽"}').water).toBeNull();
    expect(P.parsePlumbing('모델이 말로 답했다').water).toBeNull();
    expect(P.parsePlumbing('{깨진 json').water).toBeNull();
  });

  test('못 읽은 쪽의 증거는 버린다 — 위치 없는 설명은 쓸 데가 없다', () => {
    const r = P.parsePlumbing('{"sink_pct":null,"sink_evidence":"아마 왼쪽쯤"}');
    expect(r.waterWhy).toBeNull();
  });
});

describe('언제 부르나', () => {
  test('주방이고 1차가 놓쳤을 때만', () => {
    expect(JOB).toMatch(
      /KITCHEN_CATEGORIES\.includes\(category\) && wall\.read && \(!wall\.read\.water \|\| !wall\.read\.exhaust\)/
    );
  });

  test('벽 폭 보정 뒤 · 사람 입력 앞', () => {
    const w = JOB.indexOf('wall.wallW = clampWall(manualW)');
    const p2 = JOB.indexOf('await askPlumbing(');
    const man = JOB.indexOf('applyManualPlumbing(wall, opts)');
    expect(w).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(w);     // 2차 질문이 벽 폭을 기준으로 묻는다
    expect(man).toBeGreaterThan(p2);   // 사람이 넣은 값이 마지막에 이긴다
  });

  test('이미 읽은 쪽은 덮어쓰지 않는다', () => {
    const fn = JOB.slice(JOB.indexOf('async function askPlumbing'), JOB.indexOf('async function askPlumbing') + 1400);
    expect(fn).toMatch(/if \(!wall\.read\.water && p\.water != null\)/);
    expect(fn).toMatch(/if \(!wall\.read\.exhaust && p\.exhaust != null\)/);
  });

  test('실패해도 생성은 계속된다', () => {
    const fn = JOB.slice(JOB.indexOf('async function askPlumbing'), JOB.indexOf('async function askPlumbing') + 1600);
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch \(e\) \{/);
    expect(fn).not.toMatch(/throw/);
  });

  test('2차로 무엇을 건졌는지 남긴다 — 효과를 세려면 표시가 있어야 한다', () => {
    expect(JOB).toMatch(/wall\.plumbingPass2 = \{/);
  });
});

describe('기본값은 실측에서 왔다', () => {
  test('급수 48% — 옛 30% 는 근거 없는 값이었다', () => {
    expect(P.parseAnalysis('{}').waterPct).toBe(48);
  });

  test('배기 70% 는 그대로 — 어떤 상수를 써도 비슷하게 틀린다', () => {
    expect(P.parseAnalysis('{}').exhaustPct).toBe(70);
  });

  test('job.js 의 초기 기본값도 같다', () => {
    expect(JOB).toMatch(/waterPct: 48,/);
  });
});
