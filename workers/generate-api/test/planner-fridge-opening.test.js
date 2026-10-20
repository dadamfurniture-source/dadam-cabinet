/**
 * 2026-10-20: 냉장고장 냉장고 자리 — 냉장고를 보여 준다 (사장님 결정 2026-10-20).
 *   "냉장고가 특정되면 해당 냉장고 사진을 넣어서 보여주고, 아니라면 가능한 중립 냉장고로 보여줘."
 *   (1단계: 사진 없이 — 모델 이름·치수·문 형태를 글로, 없으면 중립 냉장고)
 *
 * 실측 (mm 측정 세션, GPT 키큰장+냉장고장 도면 2장 63351e9d·396d3ce3):
 *   - 옛 T2 줄 "a free-standing refrigerator may stand there — keep the one IMAGE A shows, do not invent a built-in one"
 *     → 사진에 냉장고가 없어도 2/2 장이 독립형 냉장고를 그렸고, qc 는 2/2 장 모두 appliances_visible 로 잡았다 (이제 거짓 경보).
 *   - 비율 줄 "T1 : T2 = 1 : 1" — 도면 600:680 = 1:1.13 인데 0.5 단위 반올림으로 1:1. 냉장고장을 도면보다 넓게 그렸다.
 *
 * 고정하는 것:
 *   1) normalizeDesignSpec — appliances[].model (fridge 만, 이름이나 코드가 있어야, 자르기·400)
 *   2) FIXED GEOMETRY 냉장고 자리 — 사진 냉장고 유지 · 없으면 모델(이름·치수·문 형태) 또는 중립 냉장고
 *   3) 비율 줄 — 소수 둘째 자리 (1 : 1.13)
 *   4) 검사 appliances_visible — 플래너 모드 + 냉장고 자리가 도면에 있을 때만 예외 문장
 *   5) 비 planner 설치 프롬프트·검사는 그대로
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DesignSpecError,
  buildDesignSpecBlock,
  buildPlannerPrompt,
  buildQcPrompt,
  normalizeDesignSpec,
} from '../src/prompts.js';

/** planner-tiers.test.js 의 사이트 도면 — 키큰장 600 + 냉장고장 680 (냉장고 자리 1885 + 위 2도어 415) */
function siteRaw(fridgeApp = {}) {
  return {
    category: 'fridge',
    wallRunMm: 3120,
    sections: {
      lower: {
        widthMm: 1800, heightMm: 870, depthMm: 650, fromLeftMm: 0,
        modules: [
          { widthMm: 900, kind: 'drawer', doorCount: 0, drawerCount: 3, label: '서랍 3단' },
          { widthMm: 900, kind: 'door', doorCount: 2, drawerCount: 0, label: '양문' },
        ],
      },
      tall: {
        widthMm: 1300, heightMm: 2300, depthMm: 700, fromLeftMm: 1800,
        modules: [
          {
            widthMm: 600, kind: 'door', doorCount: 3, drawerCount: 0, label: '키큰장 3단',
            tiers: [
              { heightMm: 861, kind: 'door', doorCount: 1, drawerCount: 0, label: '하부장' },
              { heightMm: 979, kind: 'door', doorCount: 1, drawerCount: 0, label: '중간장' },
              { heightMm: 460, kind: 'door', doorCount: 1, drawerCount: 0, label: '상부장' },
            ],
          },
          {
            widthMm: 680, kind: 'appliance', doorCount: 2, drawerCount: 0, label: '냉장고장',
            tiers: [
              { heightMm: 1885, kind: 'appliance', doorCount: 0, drawerCount: 0, label: '냉장고' },
              { heightMm: 415, kind: 'door', doorCount: 2, drawerCount: 0, label: '상부장' },
            ],
          },
        ],
      },
    },
    appliances: [
      { kind: 'sink', fromLeftMm: 900, widthMm: 700 },
      { kind: 'fridge', fromLeftMm: 2420, widthMm: 680, ...fridgeApp },
    ],
  };
}

const MODEL = {
  brand: '삼성',
  name: 'BESPOKE 1도어 키친핏 409L',
  code: 'RR40C7805AP',
  widthMm: 595,
  heightMm: 1853,
  depthMm: 700,
  subtype: 'one_door',
};

const ctx = (spec, extra = {}) => ({
  category: 'fridge',
  wallW: 3600,
  wallH: 2300,
  confidence: 'medium',
  designSpec: spec,
  aspect: '16:9',
  ...extra,
});

const t2Line = (p) => p.split('\n').find((l) => l.startsWith('    T2 '));

// ─── 1) 계약 ───

test('normalizeDesignSpec — fridge 의 model 을 받는다 (이름·코드·치수·문 형태)', () => {
  const s = normalizeDesignSpec(siteRaw({ model: MODEL }), 'fridge');
  assert.deepEqual(s.appliances[1], {
    kind: 'fridge',
    fromLeftMm: 2420,
    widthMm: 680,
    model: {
      brand: '삼성', name: 'BESPOKE 1도어 키친핏 409L', code: 'RR40C7805AP',
      widthMm: 595, heightMm: 1853, depthMm: 700, subtype: 'one_door',
    },
  });
});

test('model — fridge 가 아니면 버리고, 이름·코드가 둘 다 없거나 객체가 아니면 키 없음, 모르는 subtype 은 버림, 자른다', () => {
  const raw = siteRaw({ model: { brand: 'LG', widthMm: 900 } });
  raw.appliances[0].model = MODEL; // 싱크에 붙은 model
  raw.appliances.push({ kind: 'refrigerator', fromLeftMm: 0, widthMm: 600, model: 'RR40' });
  raw.appliances.push({
    kind: 'fridge', fromLeftMm: 0, widthMm: 600,
    model: { name: 'x'.repeat(200), code: ' A\nB ', subtype: 'rocket', widthMm: 99999, heightMm: 10, depthMm: 5000 },
  });
  const s = normalizeDesignSpec(raw, 'fridge');
  assert.equal('model' in s.appliances[0], false);
  assert.equal('model' in s.appliances[1], false);
  assert.equal('model' in s.appliances[2], false);
  assert.deepEqual(s.appliances[3].model, {
    name: 'x'.repeat(80), code: 'A B', widthMm: 4000, heightMm: 100, depthMm: 1200,
  });
});

test('model 의 치수가 숫자가 아니면 400 — 필드 이름이 메시지에', () => {
  assert.throws(
    () => normalizeDesignSpec(siteRaw({ model: { name: 'X', heightMm: 'tall' } }), 'fridge'),
    (e) => e instanceof DesignSpecError && /appliances\[\]\.model\.heightMm/.test(e.message)
  );
});

// ─── 2) FIXED GEOMETRY 냉장고 자리 ───

const NEUTRAL =
  'a neutral free-standing two-door refrigerator, plain matte white or, if the fronts are dark, brushed stainless, ' +
  'with no logo or display, sized to fill the opening';

test('모델이 없으면 — 사진 냉장고는 유지, 없으면 중립 냉장고를 그린다 (지시)', () => {
  const p = buildPlannerPrompt(ctx(normalizeDesignSpec(siteRaw(), 'fridge')));
  assert.equal(
    t2Line(p),
    '    T2   680 mm  refrigerator opening (open from the floor up to 1885 mm, with no cabinet, shelf or panel inside; ' +
      'a refrigerator stands in it: if IMAGE A shows a refrigerator in this spot, keep that one, otherwise draw ' +
      NEUTRAL +
      ') with a 2-door cabinet above (415 mm high)'
  );
  assert.ok(!p.includes('may stand there'));
  assert.ok(!p.includes('do not invent a built-in one'));
});

test('모델이 있으면 — 브랜드(영문)·라틴 이름·코드·치수·문 형태로', () => {
  const p = buildPlannerPrompt(ctx(normalizeDesignSpec(siteRaw({ model: MODEL }), 'fridge')));
  assert.equal(
    t2Line(p),
    '    T2   680 mm  refrigerator opening (open from the floor up to 1885 mm, with no cabinet, shelf or panel inside; ' +
      'a refrigerator stands in it: if IMAGE A shows a refrigerator in this spot, keep that one, otherwise draw ' +
      'this refrigerator: Samsung BESPOKE 409L, model RR40C7805AP, 595 × 1853 × 700 mm (W × H × D), single-door type' +
      ') with a 2-door cabinet above (415 mm high)'
  );
});

test('모델 — 코드가 이름에 이미 있으면 한 번만, 치수 일부·문 형태 모름·한글 브랜드 모름', () => {
  const p = buildPlannerPrompt(ctx(normalizeDesignSpec(
    siteRaw({ model: { brand: '하이얼', name: 'Bespoke RM70F64', code: 'RM70F64', widthMm: 912, subtype: 'built_in' } }),
    'fridge'
  )));
  assert.ok(t2Line(p).includes('otherwise draw this refrigerator: Bespoke RM70F64, 912 mm wide) with a 2-door cabinet above'), t2Line(p));
  const p2 = buildPlannerPrompt(ctx(normalizeDesignSpec(
    siteRaw({ model: { brand: 'LG', name: '오브제컬렉션 양문형', code: 'T875MEE111', widthMm: 914, heightMm: 1787, depthMm: 918, subtype: 'side_by_side' } }),
    'fridge'
  )));
  assert.ok(
    t2Line(p2).includes('otherwise draw this refrigerator: LG, model T875MEE111, 914 × 1787 × 918 mm (W × H × D), side-by-side two-door type)'),
    t2Line(p2)
  );
});

test('냉장고 자리에 걸린 가전이 없으면(단 라벨로만 안다) 중립 냉장고', () => {
  const raw = siteRaw();
  raw.appliances = [];
  const p = buildPlannerPrompt(ctx(normalizeDesignSpec(raw, 'fridge')));
  assert.ok(t2Line(p).includes(`otherwise draw ${NEUTRAL})`));
});

// ─── 3) 비율 ───

test('비율 줄 — 소수 둘째 자리: 600 : 680 = 1 : 1.13 (예전 반올림 1 : 1)', () => {
  const p = buildPlannerPrompt(ctx(normalizeDesignSpec(siteRaw(), 'fridge')));
  assert.ok(p.includes('    → widths T1 : T2 = 1 : 1.13\n'));
  assert.ok(p.includes('    → widths L1 : L2 = 1 : 1\n'));
});

test('비율 줄 — 정수·0.5 는 예전 모양 그대로, 그 밖은 둘째 자리 (끝 0 없음)', () => {
  const spec = normalizeDesignSpec(
    {
      sections: {
        lower: {
          fromLeftMm: 0,
          modules: [600, 900, 1200, 450, 640, 619].map((w) => ({ widthMm: w, kind: 'door', doorCount: 1 })),
        },
      },
    },
    'sink'
  );
  const p = buildPlannerPrompt({ category: 'sink', designSpec: spec, wallW: 0, wallH: 0 });
  assert.ok(p.includes('    → widths L1 : L2 : L3 : L4 : L5 : L6 = 1.33 : 2 : 2.67 : 1 : 1.42 : 1.38\n'), p);
});

// ─── 4) 검사 ───

const APPL = '- appliances_visible: free-standing appliances (microwave, kettle, standalone fridge) on show';
const EXPECTED = '; a refrigerator standing in the refrigerator opening of the design is expected — do not report it';

test('검사 — 플래너 모드 + 냉장고 자리가 있으면 appliances_visible 에 예외', () => {
  const q = buildQcPrompt({ category: 'fridge', designSpec: normalizeDesignSpec(siteRaw(), 'fridge'), planner: true });
  assert.ok(q.includes(`${APPL}${EXPECTED}\n`), q);
});

test('검사 — 냉장고 자리가 없거나 플래너 모드가 아니면 예전 그대로', () => {
  const raw = siteRaw();
  raw.sections.tall.modules.pop();
  raw.appliances = raw.appliances.filter((a) => a.kind !== 'fridge');
  const noFridge = buildQcPrompt({ category: 'sink', designSpec: normalizeDesignSpec({ ...raw, category: 'sink' }, 'sink'), planner: true });
  assert.ok(noFridge.includes(`${APPL}\n`));
  assert.ok(!noFridge.includes('refrigerator opening of the design'));
  const install = buildQcPrompt({ category: 'fridge', designSpec: normalizeDesignSpec(siteRaw(), 'fridge') });
  assert.ok(install.includes(`${APPL}\n`));
  assert.ok(!install.includes('refrigerator opening of the design'));
});

test('검사 — 꺾인 벽(walls[])의 냉장고장도 냉장고 자리다', () => {
  const raw = siteRaw();
  const tall = raw.sections.tall;
  delete raw.sections.tall;
  raw.appliances = [{ kind: 'sink', fromLeftMm: 900, widthMm: 700 }];
  raw.layout = { shape: 'corner', walls: 2 };
  raw.walls = [{ side: 'left', corner: 'main', sections: { tall: { ...tall, fromCornerMm: 700, fromLeftMm: undefined } } }];
  const q = buildQcPrompt({ category: 'fridge', designSpec: normalizeDesignSpec(raw, 'fridge'), planner: true });
  assert.ok(q.includes(`${APPL}${EXPECTED}\n`));
});

// ─── 5) 설치 프롬프트(비 planner)는 model 을 읽지 않는다 ───

test('설치 프롬프트 FURNITURE 는 model 이 있어도 같다', () => {
  const a = buildDesignSpecBlock(normalizeDesignSpec(siteRaw(), 'fridge'));
  const b = buildDesignSpecBlock(normalizeDesignSpec(siteRaw({ model: MODEL }), 'fridge'));
  assert.equal(a, b);
});
