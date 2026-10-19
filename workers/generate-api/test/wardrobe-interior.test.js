/**
 * 붙박이장 내부 보기 (2026-10-19 사장님 "4장 중 2장은 내부 사진" → "문이 전체 다 열린 이미지로"
 * → "정본 구조 이외에 추천 구조를 알아서 만들어 나머지 1장에").
 * 기본안(문 닫힘) + 색 추천안 1장 + 내부 보기 2장(문을 전부 연다):
 *   첫 장 = 정본 기본형 + 기본안 색, 둘째 장 = 추천 구조(정본 프리셋 조합) + 색 추천안 색.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  INTERIOR_MAX_DRAWERS,
  INTERIOR_PRESET_KEYS,
  INTERIOR_RECOMMEND_SCHEMA,
  INTERIOR_RULES,
  INTERIOR_SAMPLE_PRESETS,
  longHangDrop,
  buildInteriorRecommendPrompt,
  buildWardrobeInteriorPrompt,
  interiorPlanKo,
  parseInteriorRecommendation,
  wardrobeInteriorPlan,
} from '../src/prompts.js';
import { GenerateJob } from '../src/job.js';

const require = createRequire(import.meta.url);
const W = require('../../../js/detaildesign/bom-wardrobe-rules.js');

test('통 구성: 정본 기본형(SAMPLE_PRESETS·samplePresetFor)과 같다 — 반 통도 자리 순서대로', () => {
  assert.deepEqual(INTERIOR_SAMPLE_PRESETS, [...W.SAMPLE_PRESETS]);
  for (const wallW of [2400, 3000, 3600]) {
    const plan = wardrobeInteriorPlan(wallW);
    assert.deepEqual(plan, plan.map((_, i) => W.samplePresetFor(i, plan.length)), String(wallW));
  }
  assert.deepEqual(wardrobeInteriorPlan(3600), ['short2', 'longDrawer', 'halfSplit', 'rodTopSplitBottom']);
  assert.equal(wardrobeInteriorPlan(2400).length, 3, '2400 = 960 + 960 + 반 통 480');
});

test('추천 재료: 정본 PRESET_KEYS(custom 제외)·이름·서랍 상한·긴옷 기본 서랍과 같다', () => {
  assert.deepEqual(INTERIOR_PRESET_KEYS, W.PRESET_KEYS.filter((k) => k !== 'custom'));
  assert.equal(INTERIOR_MAX_DRAWERS, W.WARDROBE_RULES.MAX_DRAWER_COUNT);
  for (const k of INTERIOR_PRESET_KEYS.filter((k) => k !== 'longDrawer')) {
    assert.equal(interiorPlanKo([k]), W.presetLabel(k), k);
  }
  assert.equal(interiorPlanKo(['longDrawer']), `긴옷 + 서랍 ${W.presetOf('longDrawer').drawers}`);
  assert.deepEqual(INTERIOR_RECOMMEND_SCHEMA.properties.sections.items.properties.preset.enum, INTERIOR_PRESET_KEYS);
  for (const k of Object.keys(INTERIOR_RULES)) assert.equal(INTERIOR_RULES[k], W.WARDROBE_RULES[k], k);
});

test('긴옷 옷걸이 길이: 정본 layoutWardrobeModule 의 옷봉 높이 − 칸 바닥과 같고, 정본이 선반·옷봉을 빼는 높이면 null', () => {
  for (const H of [2000, 2200, 2310, 2400, 2600, 3000]) {
    for (let n = 0; n <= INTERIOR_MAX_DRAWERS; n++) {
      const r = W.layoutWardrobeModule({ preset: 'longDrawer', drawers: n, W: 900, D: 620, totalH: H });
      const cell = r.cells.find((c) => c.kind === 'rod');
      const drop = longHangDrop(H, n);
      if (drop == null) {
        // 정본이 경고하며 선반을 빼거나(칸 ≤ 315), 옷봉을 빼다(칸 ≤ 390)
        assert.ok(r.warnings.length > 0 || r.rods.length === 0, `${H}/${n}`);
      } else {
        assert.equal(drop, r.rods[0].y - cell.y0, `${H}/${n}`);
        assert.equal(r.warnings.length, 0, `${H}/${n}`);
      }
    }
  }
  assert.equal(longHangDrop(2310, 2), 1110);
  assert.equal(longHangDrop(2000, 5), null);
});

test('프롬프트: 문을 전부 연다 — 정본 기본형은 색만 바뀌어도 칸 줄이 같다', () => {
  const A = buildWardrobeInteriorPrompt(3600, null, { tag: '기본 구조' });
  const B = buildWardrobeInteriorPrompt(3600, { body: 'deep navy matte', tone: '네이비' });
  for (const p of [A.prompt, B.prompt]) {
    assert.match(p, /^Open every door of the built-in wardrobe/);
    assert.match(p, /The wardrobe has 4 pairs of doors/);
    assert.match(p, /1\. two short-hanging tiers[\s\S]*2\. long hanging[\s\S]*two internal drawers[\s\S]*3\. split into left and right halves[\s\S]*4\. one clothes rail across the full width/);
    assert.match(p, /all sections are visible at once/);
    assert.match(p, /Handleless doors stay handleless/);
    assert.doesNotMatch(p, /stay closed/);
  }
  assert.match(A.prompt, /its door colour/);
  assert.doesNotMatch(A.prompt, /Also change the colour/);
  assert.match(B.prompt, /Also change the colour of every door[\s\S]*deep navy matte/);
  assert.equal(A.label, '내부 보기 · 기본 구조');
  assert.equal(B.label, '내부 보기 · 네이비');
  const sections = (p) => p.split('\n').filter((l) => /^\d\. /.test(l)).join('\n');
  assert.equal(sections(A.prompt), sections(B.prompt));
});

test('프롬프트: 추천 구조를 주면 그 칸 줄 — 선반형·서랍 수가 글에 들어간다', () => {
  const plan = [
    { preset: 'longDrawer', drawers: 3 },
    { preset: 'shelf22', drawers: 0 },
    { preset: 'longDrawer', drawers: 0 },
    { preset: 'short2', drawers: 0 },
  ];
  const R = buildWardrobeInteriorPrompt(3600, { body: 'walnut woodgrain', tone: '월넛' }, { plan, tag: '추천 구조', wallH: 2310 });
  assert.match(R.prompt, /1\. long hanging[^\n]*about 760 mm of clear hanging space under the rail, then three internal drawers \(350 mm tall each\) at the bottom/);
  assert.match(R.prompt, /2\. shelving only, no clothes rail/);
  assert.match(R.prompt, /3\. long hanging: a shelf at the top and one clothes rail below it, about 1810 mm of clear hanging space under the rail\n/);
  assert.match(R.prompt, /4\. two short-hanging tiers/);
  assert.match(R.prompt, /Internal drawer fronts are flat and handleless/);
  const none = buildWardrobeInteriorPrompt(3600, null, { plan: ['short2', 'shelf22', 'halfSplit', 'short2'] });
  assert.doesNotMatch(none.prompt, /Internal drawer fronts/, '서랍이 없으면 서랍 문장도 없다');
  assert.equal(R.label, '내부 보기 · 추천 구조 · 월넛');
  assert.equal(interiorPlanKo(plan), '긴옷 + 서랍 3 · 선반형 (상 2 · 하 2) · 긴옷 + 서랍 0 · 짧은옷 2단');
});

test('추천 요청 글: 재료·통 수·정본 기본형·손님 요청을 싣는다', () => {
  const canonical = wardrobeInteriorPlan(3600);
  const p = buildInteriorRecommendPrompt({ sections: 4, wallW: 3600, wallH: 2400, brief: 'oak floor, bright bedroom', customerRequest: '서랍 많이', canonical });
  for (const k of INTERIOR_PRESET_KEYS) assert.match(p, new RegExp(`- ${k}: `));
  assert.match(p, /4 sections of about 900 mm/);
  assert.match(p, /2\. longDrawer \(drawers 2\)/);
  assert.match(p, /"서랍 많이"/);
  assert.match(p, /oak floor, bright bedroom/);
  assert.match(p, /exactly 4 items/);
  assert.match(p, /longDrawer may have 0 to 5 internal drawers[\s\S]*0 → 1900 mm, 1 → 1550 mm[\s\S]*5 → 150 mm/, '높이 2400: 서랍 수별 옷걸이 길이');
  const low = buildInteriorRecommendPrompt({ sections: 4, wallW: 3600, wallH: 2000, canonical });
  assert.match(low, /longDrawer may have 0 to 4 internal drawers/, '높이 2000 이면 5단은 정본이 접는다');
  assert.doesNotMatch(low, /5 → /);
  assert.doesNotMatch(buildInteriorRecommendPrompt({ sections: 4, wallW: 3600, wallH: 2400, canonical }), /customer wrote/);
});

test('추천 답 풀기: 통 수·정본 키·서랍 범위를 지키고, 정본과 똑같으면 버린다', () => {
  const canonical = wardrobeInteriorPlan(3600);
  const ok = parseInteriorRecommendation({
    sections: [
      { preset: 'longDrawer', drawers: 3 },
      { preset: 'short2', drawers: 2 }, // 긴옷이 아닌 칸의 서랍은 0 으로
      { preset: 'shelf22', drawers: 0 },
      { preset: 'halfSplit', drawers: 0 },
    ],
    concept_ko: '  수납\n중심 ',
    reason_ko: '드레스룸에 맞게 서랍과 선반을 늘렸다',
  }, { sections: 4, canonical });
  assert.deepEqual(ok.plan, [
    { preset: 'longDrawer', drawers: 3 },
    { preset: 'short2', drawers: 0 },
    { preset: 'shelf22', drawers: 0 },
    { preset: 'halfSplit', drawers: 0 },
  ]);
  assert.equal(ok.concept, '수납 중심');
  const same = { sections: canonical.map((k) => ({ preset: k, drawers: k === 'longDrawer' ? 2 : 0 })), concept_ko: 'x', reason_ko: 'y' };
  assert.equal(parseInteriorRecommendation(same, { sections: 4, canonical }), null, '정본과 같으면 추천이 아니다');
  assert.equal(parseInteriorRecommendation({ ...same, sections: same.sections.slice(1) }, { sections: 4, canonical }), null, '통 수');
  const bad = (s) => parseInteriorRecommendation({ ...same, sections: [s, ...same.sections.slice(1)] }, { sections: 4, canonical });
  assert.equal(bad({ preset: 'custom', drawers: 0 }), null, '정본 재료가 아니다');
  assert.equal(bad({ preset: 'longDrawer', drawers: 6 }), null, '서랍 상한');
  assert.equal(bad({ preset: 'longDrawer', drawers: 1.5 }), null, '서랍은 정수');
  assert.equal(bad({ preset: 'longDrawer', drawers: '3' }), null, '서랍은 숫자');
  assert.equal(parseInteriorRecommendation(null, { sections: 4, canonical }), null);
  const five = { ...same, sections: [{ preset: 'longDrawer', drawers: 5 }, ...same.sections.slice(1)] };
  assert.ok(parseInteriorRecommendation(five, { sections: 4, canonical, wallH: 2310 }), '2310 이면 5단도 정본이 받는다');
  assert.equal(parseInteriorRecommendation(five, { sections: 4, canonical, wallH: 2000 }), null, '2000 이면 정본이 선반을 접는다');
});

// ─── 잡 흐름 ───

const ROW_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENV = {
  GEMINI_API_KEY: 'k', GEMINI_RETRY_DELAYS_MS: '0',
  SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service', GENERATIONS_BUCKET: 'generations',
};
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let realFetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });
function fakeState() {
  const m = new Map();
  return { storage: {
    get: async (k) => m.get(k), put: async (k, v) => void m.set(k, structuredClone(v)),
    setAlarm: async () => {}, deleteAll: async () => m.clear(), deleteAlarm: async () => {},
  } };
}

/** @param {object} [o] o.claude: Claude 가 돌려줄 추천 JSON (주면 ANTHROPIC_API_KEY 를 켠다) */
async function runJob(category, o = {}) {
  const prompts = [];
  const patched = [];
  const claude = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(init.body);
      claude.push(body);
      if (o.hang) return new Promise(() => {}); // 답이 오지 않는 업스트림
      return jsonRes({ id: 'm', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(o.claude) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    if (u.includes('/storage/v1/object/')) {
      if ((init.method || 'GET') === 'POST') return jsonRes({ Key: 'ok' });
      return new Response(Buffer.from('ROOM'), { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (u.includes('/rest/v1/generations')) {
      if ((init.method || 'GET') === 'GET') return jsonRes([{ id: ROW_ID, options: {} }]);
      patched.push(JSON.parse(init.body));
      return jsonRes([{ id: ROW_ID }]);
    }
    const body = JSON.parse(init.body);
    const prompt = body.contents[0].parts.at(-1).text;
    if (body.generationConfig.responseModalities.length === 1) {
      const text = prompt.startsWith('Measure and describe')
        ? JSON.stringify({ wall_width_mm: o.wallW || 3600, wall_height_mm: 2400, confidence: 'medium', site_condition: 'finished', room_brief: 'bright bedroom' })
        : JSON.stringify({ ok: true, issues: [], note: 'n' });
      return jsonRes({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    prompts.push(prompt);
    return jsonRes({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('OUT').toString('base64') } }] } }] });
  };
  const env = { ...ENV, ...(o.claude ? { ANTHROPIC_API_KEY: 'sk-ant', ANTHROPIC_MODEL: 'claude-opus-5' } : {}), ...(o.env || {}) };
  const job = new GenerateJob(fakeState(), env);
  await job.fetch(new Request('https://generate-job/start', { method: 'POST', body: JSON.stringify({
    id: ROW_ID, userId: USER_ID, creditRef: 'c', category, options: o.options || {},
    inputs: { room: { path: `${USER_ID}/${ROW_ID}/room.jpg`, url: 'u', mime: 'image/jpeg' }, refs: [] }, startedAt: Date.now(),
  }) }));
  await job.alarm();
  return { prompts, last: patched.at(-1), claude };
}

const REC = {
  sections: [
    { preset: 'longDrawer', drawers: 3 },
    { preset: 'shelf22', drawers: 0 },
    { preset: 'short2', drawers: 0 },
    { preset: 'short2', drawers: 0 },
  ],
  concept_ko: '수납 중심',
  reason_ko: '침실이라 접는 옷과 서랍을 늘렸다',
};

const REC4 = { ...REC, sections: [REC.sections[0], REC.sections[1], REC.sections[2], { preset: 'shelf22', drawers: 0 }] };

test('잡(붙박이장): 내부 보기 둘째 장은 Claude 가 고른 추천 구조 + 색 추천안 색', async () => {
  const { prompts, last, claude } = await runJob('wardrobe', { claude: REC, options: { customer_request: '서랍이 많았으면 좋겠어요' } });
  assert.equal(prompts.length, 4);
  assert.equal(claude.length, 1, '추천은 한 번만 고른다');
  const ask = claude[0];
  assert.equal(ask.model, 'claude-opus-5');
  assert.deepEqual(ask.fallbacks, 'default', 'Opus 는 거절 대체를 켠다');
  assert.equal(ask.messages[0].content[0].type, 'image', '기본안 사진을 같이 본다');
  assert.match(ask.messages[0].content.at(-1).text, /서랍이 많았으면 좋겠어요/);
  assert.match(ask.messages[0].content.at(-1).text, /bright bedroom/);

  const recolour = prompts.filter((p) => p.startsWith('Recolour'));
  const inside = prompts.filter((p) => p.startsWith('Open every door'));
  assert.equal(recolour.length, 1);
  assert.equal(inside.length, 2);
  const body = recolour[0].match(/plinth and trim: (.+), one continuous colour/)[1];
  const std = inside.find((p) => !p.includes('Also change the colour'));
  const rec = inside.find((p) => p.includes(`to ${body}, one continuous colour`));
  assert.ok(std && rec);
  assert.match(std, /1\. two short-hanging tiers[\s\S]*2\. long hanging[^\n]*two internal drawers/, '첫 장은 정본 기본형');
  assert.match(rec, /1\. long hanging[^\n]*three internal drawers[\s\S]*2\. shelving only/, '둘째 장은 추천 구조');

  const v = Object.fromEntries(last.images.map((i) => [i.slot, i]));
  assert.equal(v.v2.finish_key, 'interior');
  assert.equal(v.v2.label, '내부 보기 · 기본 구조');
  assert.deepEqual(v.v2.structure, { kind: 'standard', plan: '짧은옷 2단 · 긴옷 + 서랍 2 · 반 분할 (중간 칸막이) · 상단 옷봉 + 하부 옆 분할' });
  assert.equal(v.v3.finish_key, `interior:${v.v1.finish_key}`);
  assert.match(v.v3.label, /^내부 보기 · 추천 구조 · /);
  assert.equal(v.v3.structure.kind, 'recommended');
  assert.equal(v.v3.structure.plan, '긴옷 + 서랍 3 · 선반형 (상 2 · 하 2) · 짧은옷 2단 · 짧은옷 2단');
  assert.equal(v.v3.structure.concept, '수납 중심');
  assert.equal(last.status, 'done');
  assert.equal(last.step_label, '완료');
});

test('잡(붙박이장): Haiku 로 고르게 하면 거절 대체를 끈다', async () => {
  const { claude } = await runJob('wardrobe', { claude: REC, env: { INTERIOR_MODEL: 'claude-haiku-5-5' } });
  assert.equal(claude[0].model, 'claude-haiku-5-5');
  assert.equal(claude[0].fallbacks, undefined);
});

test('잡(붙박이장): 추천이 정본과 같거나 키가 없으면 둘째 장은 정본 기본형 + 추천 색', async () => {
  const same = { sections: wardrobeInteriorPlan(3600).map((k) => ({ preset: k, drawers: k === 'longDrawer' ? 2 : 0 })), concept_ko: 'x', reason_ko: 'y' };
  for (const o of [{ claude: same }, {}]) {
    const { prompts, last } = await runJob('wardrobe', o);
    const inside = prompts.filter((p) => p.startsWith('Open every door'));
    assert.equal(inside.length, 2);
    const sections = (p) => p.split('\n').filter((l) => /^\d\. /.test(l)).join('\n');
    assert.equal(sections(inside[0]), sections(inside[1]));
    const v3 = last.images.find((i) => i.slot === 'v3');
    assert.equal(v3.structure.kind, 'standard');
    assert.equal(v3.structure.fallback, true);
    assert.doesNotMatch(v3.label, /추천 구조/);
  }
});

test('잡(붙박이장): 추천 고르기가 멈추면 시간 제한 뒤 정본 기본형 + 추천 색으로 그린다', async () => {
  const { prompts, last } = await runJob('wardrobe', { claude: REC, hang: true, env: { INTERIOR_REC_TIMEOUT_MS: '50' } });
  assert.equal(prompts.filter((p) => p.startsWith('Open every door')).length, 2);
  const v3 = last.images.find((i) => i.slot === 'v3');
  assert.equal(v3.structure.fallback, true);
  assert.equal(last.status, 'done');
});

test('잡(붙박이장, 벽 3000 = 7짝): 설치는 반 통을 이름 붙여 쓰고, 내부 보기 두 장 모두 오른쪽 끝 1짝 통', async () => {
  const { prompts, last } = await runJob('wardrobe', { claude: REC4, wallW: 3000 });
  const install = prompts.find((p) => !p.startsWith('Recolour') && !p.startsWith('Open every door'));
  assert.match(install, /7 equal full-height flat doors: 3 two-door units in mirrored pairs, then one single-door unit at the right end/);
  const inside = prompts.filter((p) => p.startsWith('Open every door'));
  assert.equal(inside.length, 2);
  for (const p of inside) assert.match(p, /section 4, the narrow one at the right end, is behind a single door hinged on its left side/);
  const v3 = last.images.find((i) => i.slot === 'v3');
  assert.equal(v3.structure.kind, 'recommended');
});

test('잡(다른 품목): 색 추천안 3장 그대로', async () => {
  const { prompts, claude } = await runJob('storage', { claude: REC });
  assert.equal(prompts.filter((p) => p.startsWith('Recolour')).length, 3);
  assert.equal(prompts.filter((p) => p.startsWith('Open every door')).length, 0);
  assert.equal(claude.length, 0);
});
