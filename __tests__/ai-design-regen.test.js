/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * ai-design.html 「다시 생성」 (?g=<id>&regen=1, my-designs.html 에서 들어온다).
 *
 * 워커(workers/generate-api)는 design_style · door_color 를 원본 행에서 잇지 않고 요청 값(없으면 기본값)을 쓴다.
 * 그래서 화면이 원본을 먼저 읽고, 원본의 스타일·문짝 색으로 다시 생성을 보낸다.
 * openGeneration 을 화면 코드 그대로 돌리고 fetch · submit 은 가짜로 받는다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs
  .readFileSync(path.join(__dirname, '..', 'ai-design.html'), 'utf8')
  .replace(/\r\n/g, '\n');
const SEG = HTML.slice(
  HTML.indexOf('/** 저장된 결과 열기 (?g=<id>).'),
  HTML.indexOf('// ═', HTML.indexOf('async function openGeneration('))
);

function boot({
  generation,
  ok = true,
  select = { style: 'modern-minimal', doorColor: 'white' },
} = {}) {
  const log = [];
  const els = {
    style: { value: select.style },
    doorColor: { value: select.doorColor },
    resultState: { textContent: '' },
  };
  const S = { phase: 'idle', progressLabel: '' };
  const fetchFake = async (url, init) => {
    log.push(['fetch', url, init && init.method ? init.method : 'GET', init && init.headers]);
    return {
      ok,
      status: ok ? 200 : 404,
      json: async () =>
        ok
          ? { success: true, generation }
          : { success: false, error: '생성 결과를 찾을 수 없습니다' },
    };
  };
  const openGeneration = new Function(
    'S',
    '$',
    'fetch',
    'API_BASE',
    'authHeaders',
    'submit',
    'applyGeneration',
    'renderKinds',
    'pollGeneration',
    'renderRun',
    'renderResults',
    'console',
    SEG + '\nreturn openGeneration;'
  )(
    S,
    (id) => els[id],
    fetchFake,
    'https://gen.example',
    async () => ({ Authorization: 'Bearer t' }),
    async (body) => log.push(['submit', body]),
    (g) => log.push(['apply', g.id]),
    () => log.push(['renderKinds']),
    async (id) => log.push(['poll', id]),
    () => {},
    () => {},
    { warn: () => {} }
  );
  return { openGeneration, log, S, els };
}

const GEN = {
  id: 'g1',
  status: 'done',
  category: 'wardrobe',
  options: { design_style: 'scandinavian', door_color: 'walnut woodgrain', door_finish: 'matte' },
};

describe('ai-design.html — 다시 생성은 원본의 스타일·문짝 색을 쓴다', () => {
  test('구간을 찾는다', () => {
    expect(SEG).toMatch(/async function openGeneration\(id, regen\)/);
  });

  test('원본을 먼저 읽고(GET), 원본 options 의 design_style · door_color 로 보낸다', async () => {
    const { openGeneration, log } = boot({ generation: GEN });
    await openGeneration('g1', true);
    expect(log[0]).toEqual([
      'fetch',
      'https://gen.example/api/generate/g1',
      'GET',
      { Authorization: 'Bearer t' },
    ]);
    expect(log[1]).toEqual([
      'submit',
      { parent_id: 'g1', design_style: 'scandinavian', door_color: 'walnut woodgrain' },
    ]);
    expect(log).toHaveLength(2); // 다시 생성 때는 원본을 화면에 펼치지 않는다 (예전과 같다)
  });

  test('막 연 페이지의 선택 칸 값(기본값)은 원본 값을 덮지 않는다', async () => {
    const { openGeneration, log } = boot({
      generation: GEN,
      select: { style: 'modern-minimal', doorColor: 'white' },
    });
    await openGeneration('g1', true);
    const body = log.find((l) => l[0] === 'submit')[1];
    expect(body.design_style).toBe('scandinavian');
    expect(body.door_color).toBe('walnut woodgrain');
  });

  test('원본 행에 값이 없으면 예전처럼 선택 칸 값을 보낸다', async () => {
    const { openGeneration, log } = boot({
      generation: { ...GEN, options: {} },
      select: { style: 'classic', doorColor: 'cream' },
    });
    await openGeneration('g1', true);
    expect(log.find((l) => l[0] === 'submit')[1]).toEqual({
      parent_id: 'g1',
      design_style: 'classic',
      door_color: 'cream',
    });
  });

  test('원본을 못 읽으면 보내지 않고 이유를 적는다', async () => {
    const { openGeneration, log, S, els } = boot({ ok: false });
    await openGeneration('g1', true);
    expect(log.some((l) => l[0] === 'submit')).toBe(false);
    expect(S.phase).toBe('done');
    expect(els.resultState.textContent).toBe('생성 결과를 찾을 수 없습니다');
  });

  test('다시 생성이 아니면 예전 그대로 — 읽어서 펼치고, 보내지 않는다', async () => {
    const { openGeneration, log, S } = boot({ generation: GEN });
    await openGeneration('g1', false);
    expect(log.map((l) => l[0])).toEqual(['fetch', 'apply', 'renderKinds']);
    expect(S.phase).toBe('done');
  });

  test('my-designs.html 의 다시 생성 링크가 이 경로로 들어온다', () => {
    const my = fs.readFileSync(path.join(__dirname, '..', 'my-designs.html'), 'utf8');
    expect(my).toContain(
      "location.href = 'ai-design.html?g=' + encodeURIComponent(r.id) + '&regen=1'"
    );
    expect(HTML).toContain("openGeneration(qs.get('g'), qs.get('regen') === '1')");
  });
});
