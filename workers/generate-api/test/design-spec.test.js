/**
 * design_spec 검증 — normalizeDesignSpec()
 *
 * 계약 문서: docs/02-design/features/design-spec-prompt.md
 * 플래너가 보내는 값이라 방어적이어야 한다. 고정하는 것:
 *   1) 없으면 null (옛 경로 그대로)
 *   2) 품목이 어긋나면 400 bad_design_spec
 *   3) 유한하지 않은 숫자는 400, 말이 안 되는 크기는 잘라서 통과
 *   4) 배열은 길이를 막고, 모르는 가전·모듈 종류는 조용히 보정한다
 *   5) 빈 껍데기는 400 — 프롬프트에 실을 게 없으면 받지 않는다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DesignSpecError, normalizeDesignSpec } from '../src/prompts.js';

/** 문서의 예시와 같은 정상 입력. */
function goodSpec() {
  return {
    category: 'sink',
    wallRunMm: 3600,
    sections: {
      lower: {
        widthMm: 3600,
        heightMm: 870,
        depthMm: 600,
        fromLeftMm: 0,
        modules: [
          { widthMm: 900, kind: 'drawer', drawerCount: 3, label: '서랍 3단' },
          { widthMm: 700, kind: 'appliance', label: '싱크볼' },
          { widthMm: 600, kind: 'door', doorCount: 1 },
        ],
      },
      upper: {
        widthMm: 2700,
        heightMm: 900,
        depthMm: 350,
        fromLeftMm: 0,
        modules: [{ widthMm: 900, kind: 'door', doorCount: 2 }],
      },
    },
    appliances: [
      { kind: 'sink', fromLeftMm: 900, widthMm: 700 },
      { kind: 'cooktop', fromLeftMm: 2200, widthMm: 600 },
    ],
    finishes: {
      door: {
        name: '예림 LUX Supreme PET Matt 매트 화이트',
        nameEn: 'matte white PET laminate',
        colorHex: '#F2F0EC',
        tone: 'matte',
        vendorCode: 'SM-01',
      },
      body: { nameEn: 'warm beige melamine board', colorHex: '#e4dccd' },
    },
    notes: '좌측 900 서랍장은 세탁기 옆이라 폭 고정',
  };
}

function throws(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

test('없으면 null — 옛 경로가 그대로 산다', () => {
  assert.equal(normalizeDesignSpec(undefined, 'sink'), null);
  assert.equal(normalizeDesignSpec(null, 'sink'), null);
});

test('정상 입력은 버전·품목이 붙은 채 그대로 통과한다', () => {
  const spec = normalizeDesignSpec(goodSpec(), 'sink');
  assert.equal(spec.version, 1);
  assert.equal(spec.category, 'sink');
  assert.equal(spec.wallRunMm, 3600);
  assert.equal(spec.sections.lower.modules.length, 3);
  assert.deepEqual(spec.sections.lower.modules[0], {
    kind: 'drawer',
    widthMm: 900,
    drawerCount: 3,
    label: '서랍 3단',
  });
  assert.equal(spec.appliances.length, 2);
  assert.equal(spec.finishes.door.colorHex, '#f2f0ec'); // 소문자로 정규화
  assert.equal(spec.finishes.door.vendorCode, 'SM-01');
  assert.equal(spec.notes, '좌측 900 서랍장은 세탁기 옆이라 폭 고정');
});

test('category 는 생략해도 되고, 어긋나면 400 bad_design_spec', () => {
  const noCat = goodSpec();
  delete noCat.category;
  assert.equal(normalizeDesignSpec(noCat, 'sink').category, 'sink');

  const e = throws(() => normalizeDesignSpec(goodSpec(), 'wardrobe'));
  assert.ok(e instanceof DesignSpecError);
  assert.equal(e.statusCode, 400);
  assert.equal(e.code, 'bad_design_spec');
  assert.match(e.message, /does not match category \(wardrobe\)/);

  // 모르는 키는 품목 불일치로 본다 (resolveCategory 의 storage 낙하로 조용히 통과하지 않게)
  const junk = goodSpec();
  junk.category = 'kitchen';
  assert.ok(throws(() => normalizeDesignSpec(junk, 'storage')) instanceof DesignSpecError);
});

test('요청 품목이 모르는 키면 storage 로 떨어지고, 요약도 storage 여야 한다', () => {
  const s = goodSpec();
  s.category = 'storage';
  assert.equal(normalizeDesignSpec(s, 'nonsense').category, 'storage');
});

test('object 가 아니면 400', () => {
  for (const bad of ['{}', 42, true, [], [{ kind: 'door' }]]) {
    assert.ok(
      throws(() => normalizeDesignSpec(bad, 'sink')) instanceof DesignSpecError,
      String(bad)
    );
  }
});

test('유한하지 않은 숫자는 400 — 조용히 0 으로 떨어뜨리지 않는다', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'abc', {}]) {
    const s = goodSpec();
    s.wallRunMm = bad;
    const e = throws(() => normalizeDesignSpec(s, 'sink'));
    assert.ok(e instanceof DesignSpecError, `wallRunMm=${String(bad)}`);
    assert.match(e.message, /wallRunMm/);
  }
  const deep = goodSpec();
  deep.sections.lower.modules[0].widthMm = NaN;
  assert.match(throws(() => normalizeDesignSpec(deep, 'sink')).message, /modules\[\]\.widthMm/);
});

test('null·빈 문자열은 "없음" 으로 본다', () => {
  const s = goodSpec();
  s.sections.lower.depthMm = null;
  s.sections.lower.modules[2].doorCount = '';
  const spec = normalizeDesignSpec(s, 'sink');
  assert.equal(spec.sections.lower.depthMm, undefined);
  assert.equal(spec.sections.lower.modules[2].doorCount, undefined);
});

test('말이 안 되는 크기는 자른다 (거부가 아니라 clamp)', () => {
  const s = goodSpec();
  s.wallRunMm = 999999;
  s.sections.lower.heightMm = -50;
  s.sections.lower.depthMm = 9999;
  s.sections.lower.modules[0].widthMm = 0.2;
  s.sections.lower.modules[0].drawerCount = 400;
  s.appliances[0].fromLeftMm = -10;
  const spec = normalizeDesignSpec(s, 'sink');
  assert.equal(spec.wallRunMm, 12000);
  assert.equal(spec.sections.lower.heightMm, 100);
  assert.equal(spec.sections.lower.depthMm, 1200);
  assert.equal(spec.sections.lower.modules[0].widthMm, 50);
  assert.equal(spec.sections.lower.modules[0].drawerCount, 12);
  assert.equal(spec.appliances[0].fromLeftMm, 0);
});

test('배열은 길이를 막는다 — 모듈 40, 가전 12', () => {
  const s = goodSpec();
  s.sections.lower.modules = Array.from({ length: 200 }, () => ({ widthMm: 600, kind: 'door' }));
  s.appliances = Array.from({ length: 50 }, () => ({ kind: 'sink', fromLeftMm: 100 }));
  const spec = normalizeDesignSpec(s, 'sink');
  assert.equal(spec.sections.lower.modules.length, 40);
  assert.equal(spec.appliances.length, 12);
});

test('모르는 모듈 종류는 door 로, 모르는 가전은 버린다. refrigerator 는 fridge 로', () => {
  const s = goodSpec();
  s.sections.lower.modules = [{ widthMm: 600, kind: 'sideboard' }, { widthMm: 600 }];
  s.appliances = [
    { kind: 'refrigerator', fromLeftMm: 0, widthMm: 720 },
    { kind: 'espresso-machine', fromLeftMm: 100 },
    { kind: 'HOB', fromLeftMm: 800 },
  ];
  const spec = normalizeDesignSpec(s, 'sink');
  assert.deepEqual(
    spec.sections.lower.modules.map((m) => m.kind),
    ['door', 'door']
  );
  assert.deepEqual(
    spec.appliances.map((a) => a.kind),
    ['fridge', 'cooktop']
  );
});

test('모르는 구간·모르는 마감 칸은 무시한다', () => {
  const s = goodSpec();
  s.sections.island = { widthMm: 2000, modules: [{ widthMm: 1000, kind: 'door' }] };
  s.finishes.handle = { name: '없는 칸' };
  const spec = normalizeDesignSpec(s, 'sink');
  assert.deepEqual(Object.keys(spec.sections), ['lower', 'upper']);
  assert.deepEqual(Object.keys(spec.finishes), ['door', 'body']);
});

test('망가진 마감 값은 조용히 떨어진다', () => {
  const s = goodSpec();
  s.finishes.door.colorHex = 'not-a-colour';
  s.finishes.door.tone = 'sparkly';
  const spec = normalizeDesignSpec(s, 'sink');
  assert.equal(spec.finishes.door.colorHex, undefined);
  assert.equal(spec.finishes.door.tone, undefined);
  assert.equal(spec.finishes.door.nameEn, 'matte white PET laminate');

  // 3자리 hex 는 6자리로 편다
  const short = goodSpec();
  short.finishes.door.colorHex = 'F0E';
  assert.equal(normalizeDesignSpec(short, 'sink').finishes.door.colorHex, '#ff00ee');
});

test('긴 문자열은 자르고 줄바꿈은 편다', () => {
  const s = goodSpec();
  s.notes = 'a\nb'.padEnd(900, 'x');
  s.sections.lower.modules[0].label = 'L'.repeat(200);
  const spec = normalizeDesignSpec(s, 'sink');
  assert.equal(spec.notes.length, 300);
  assert.ok(!spec.notes.includes('\n'));
  assert.equal(spec.sections.lower.modules[0].label.length, 40);
});

test('빈 껍데기는 400 — 프롬프트에 실을 게 없다', () => {
  assert.ok(throws(() => normalizeDesignSpec({}, 'sink')) instanceof DesignSpecError);
  assert.ok(
    throws(() => normalizeDesignSpec({ category: 'sink', sections: {} }, 'sink')) instanceof
      DesignSpecError
  );
  // 마감만 있어도 통과한다 (FINISH 줄은 쓸 수 있다)
  const onlyFinish = normalizeDesignSpec({ finishes: { door: { nameEn: 'matte white' } } }, 'sink');
  assert.equal(onlyFinish.finishes.door.nameEn, 'matte white');
});

test('너무 큰 요약은 400', () => {
  const s = goodSpec();
  s.notes = 'x'; // notes 는 잘리므로 크기는 모듈로 불린다
  s.sections.lower.modules = Array.from({ length: 40 }, () => ({
    widthMm: 600,
    kind: 'door',
    doorCount: 1,
    label: 'ㄱ'.repeat(40),
    junk: 'y'.repeat(600),
  }));
  const e = throws(() => normalizeDesignSpec(s, 'sink'));
  assert.ok(e instanceof DesignSpecError);
  assert.match(e.message, /too large/);
});
