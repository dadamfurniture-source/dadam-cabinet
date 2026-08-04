/**
 * 싱크대 AI 이미지 프롬프트 계약 테스트.
 *
 * 프롬프트는 문장이라 조용히 되돌아가기 쉽다. 두 가지를 고정한다:
 *   1) 손잡이는 매립 groove 만 (ACTIVE_RULES §15 handleless 매립형)
 *   2) 쿡탑 아래는 정확히 2단 서랍
 *
 * 두 프롬프트(Step2 닫힌도어 / Step3 리컬러)가 서로 어긋나면
 * 리컬러 단계에서 groove 가 사라지거나 서랍이 3단으로 늘어난다.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '../workers/generate-api/src/prompts/sink-prompt.js'),
  'utf8'
);

/** 템플릿 리터럴을 그대로 평가하지 않고, 두 프롬프트 본문만 텍스트로 뽑는다. */
function promptBodies() {
  const closed = SRC.slice(SRC.indexOf('[WALL]'), SRC.indexOf('export function buildSinkAltSpec'));
  const alt = SRC.slice(SRC.indexOf('Recolor this kitchen photo'), SRC.indexOf('return {\n    inputKey'));
  expect(closed.length).toBeGreaterThan(200);
  expect(alt.length).toBeGreaterThan(200);
  return { closed, alt, both: closed + '\n' + alt };
}

describe('손잡이 — 매립 groove 만', () => {
  test('Step2 프롬프트가 groove 를 유일한 손잡이로 못박는다', () => {
    const { closed } = promptBodies();
    expect(closed).toMatch(/GROOVE HANDLE ONLY/);
    expect(closed).toMatch(/30mm horizontal channel groove/);
    // 하부는 윗변, 상부는 아랫변 (미러)
    expect(closed).toMatch(/TOP edge/);
    expect(closed).toMatch(/BOTTOM edge/);
  });

  test('금지 하드웨어가 빠짐없이 명시된다', () => {
    const { closed } = promptBodies();
    // ACTIVE_RULES §15 금지: Chrome bar handle, push-to-open, 외부 노출 손잡이
    for (const banned of ['knobs', 'pulls', 'bar handles', 'D-handles', 'chrome', 'push-to-open']) {
      expect(closed.toLowerCase()).toContain(banned.toLowerCase());
    }
  });

  test('리컬러(Step3) 에서도 groove 를 유지시킨다', () => {
    const { alt } = promptBodies();
    expect(alt).toMatch(/recessed groove handle style/);
    expect(alt).toMatch(/30mm horizontal groove/);
    expect(alt).toMatch(/NO knobs, pulls, bar\/D-handles/);
  });

  test('"J-pull" 같은 특정 프로파일 명칭을 쓰지 않는다', () => {
    // 모델이 J 자 모양 당김손잡이를 그려버리는 원인이었다
    expect(SRC).not.toMatch(/J-pull/);
  });

  test('"handleless" 단독 표현으로 홈이 사라지지 않게 한다', () => {
    // handleless 만 있으면 홈 자체를 생략하는 경우가 있어
    // 반드시 groove 서술과 함께 나와야 한다
    const idx = SRC.indexOf('[HANDLES]');
    const block = SRC.slice(idx, idx + 1200);
    if (/handleless/i.test(block)) {
      expect(block).toMatch(/groove/i);
    }
  });
});

describe('쿡탑 하부 — 정확히 2단 서랍', () => {
  test('Step2 프롬프트가 EXACTLY 2 를 지정한다', () => {
    const { closed } = promptBodies();
    expect(closed).toMatch(/EXACTLY 2 horizontal drawer fronts/);
    expect(closed).toMatch(/TWO-TIER drawer bank/);
    expect(closed).toMatch(/NO third drawer/);
  });

  test('리컬러(Step3) 에서도 2단을 유지시킨다', () => {
    const { alt } = promptBodies();
    expect(alt).toMatch(/EXACTLY 2 horizontal drawer fronts/);
    expect(alt).toMatch(/two-tier/i);
    expect(alt).toMatch(/NO third drawer/);
  });

  test('개수를 열어두는 표현("2 or 3", "2-3")이 없다', () => {
    expect(SRC).not.toMatch(/2 or 3/);
    expect(SRC).not.toMatch(/2-3 horizontal/);
  });

  test('가전 공동(cavity)은 계속 금지된다', () => {
    const { both } = promptBodies();
    for (const banned of ['oven', 'microwave', 'dishwasher']) {
      expect(both.toLowerCase()).toContain(banned);
    }
    expect(both).toMatch(/NO empty appliance slot/);
  });
});

describe('기존 규칙이 함께 유지된다', () => {
  test('전자기기 배제 · 인덕션 · 도어 닫힘', () => {
    const { closed } = promptBodies();
    expect(closed).toMatch(/Flush induction cooktop/);
    expect(closed).toMatch(/NO gas burners/);
    expect(closed).toMatch(/All doors CLOSED/);
  });

  test('배경 보존 지시가 살아 있다', () => {
    const { closed } = promptBodies();
    expect(closed).toMatch(/PRESERVE original room background EXACTLY/);
  });
});
