/**
 * 플래너 모드(mode:'planner') 설치 프롬프트 v2 · 검사 코드.
 * 정본 계획: docs/01-plan/planner-render-realize.plan.md §4.2 (프롬프트 초안) · §6.2 · §11.
 *
 * 고정하는 것:
 *   1) 세 장의 이름과 역할 — IMAGE C 가 없으면 C 문장이 통째로 빠진다
 *   2) FIXED GEOMETRY — 모듈 번호(L/U/T/W), 폭 mm, 런 대비 %, 줄 끝 합계, COUNT CHECK
 *   3) 남는 벽 — 분석이 성공했을 때만 "% of the wall" 문장, 실패면 빼고 "not part of this design"
 *   4) 마감·손잡이·금지 목록(첫 실측 실패를 이름으로)·OUTPUT 비율
 *   5) 옛 설치·검사 프롬프트는 바이트 그대로 (fixture 스냅샷)
 *   6) 검사 코드 existing_left · pasted_reference 는 플래너 모드에서만
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL_QC_ISSUE_CODES,
  CATEGORIES,
  PLANNER_ASPECTS,
  PLANNER_QC_FIXES,
  QC_ISSUE_CODES,
  buildInstallPrompt,
  buildPlannerPrompt,
  buildQcPrompt,
  normalizeDesignSpec,
  parseQc,
  resolvePlannerAspect,
} from '../src/prompts.js';

const baseline = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/install-prompt-baseline.json', import.meta.url)),
    'utf8'
  )
);

/** 계획서 §4.2 의 D1 도면 — 첫 실측과 같은 도면. 하부 800·400·1000 (2·1·2도어), 상부 900·900 (2·2도어). */
function d1Spec(extra = {}) {
  return normalizeDesignSpec(
    {
      category: 'sink',
      wallRunMm: 2200,
      sections: {
        lower: {
          widthMm: 2200, heightMm: 870, depthMm: 600, fromLeftMm: 0,
          modules: [
            { widthMm: 800, kind: 'door', doorCount: 2 },
            { widthMm: 400, kind: 'door', doorCount: 1 },
            { widthMm: 1000, kind: 'door', doorCount: 2 },
          ],
        },
        upper: {
          widthMm: 1800, heightMm: 780, depthMm: 350, fromLeftMm: 0,
          modules: [
            { widthMm: 900, kind: 'door', doorCount: 2 },
            { widthMm: 900, kind: 'door', doorCount: 2 },
          ],
        },
      },
      appliances: [{ kind: 'sink', fromLeftMm: 1350, widthMm: 700 }],
      finishes: {
        door: { name: '예림 LUX 아크 플랫 화이트', nameEn: 'Arc Flat White', colorHex: '#f4f4f0', tone: 'matte' },
        body: { nameEn: 'Arc Flat White' },
        top: { nameEn: '12 mm Calacatta engineered stone' },
      },
      ...extra,
    },
    'sink'
  );
}

/** 분석이 성공한 방 (벽 3600, 기존 주방 있음) */
function d1Ctx(extra = {}) {
  return {
    category: 'sink',
    wallW: 3600,
    wallH: 2400,
    confidence: 'medium',
    existing: 'dark glossy kitchen cabinets',
    designSpec: d1Spec(),
    massing: true,
    aspect: '16:9',
    doorColor: 'white',
    doorFinish: 'matte',
    ...extra,
  };
}

// ─── 1. 세 장의 역할 ───

test('세 장에 이름과 역할을 붙이고, 렌더는 붙이지 말라고 한다', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.match(p, /^You receive three images\.\n/);
  assert.ok(p.includes("IMAGE A — ROOM PHOTO: the customer's real room. Edit this photo."));
  assert.ok(p.includes('IMAGE B — FRONT ELEVATION from our planner: the exact cabinet design to build, seen straight on.'));
  assert.ok(p.includes('IMAGE C — 3/4 VIEW of the same design: shows depth, side panels and the countertop edge.'));
  assert.ok(p.includes('IMAGE B and IMAGE C are design references. Do not paste them into the photo'));
  assert.ok(p.includes('TASK: install this built-in kitchen on the main wall of IMAGE A as a real, finished installation.'));
});

test('IMAGE C 가 없으면 C 문장이 하나도 없다', () => {
  const p = buildPlannerPrompt(d1Ctx({ massing: false }));
  assert.match(p, /^You receive two images\.\n/);
  assert.doesNotMatch(p, /IMAGE C/);
  assert.ok(p.includes('IMAGE B is a design reference. Do not paste it into the photo'));
  assert.ok(p.includes('paste IMAGE B into the photo;'));
});

// ─── 2. FIXED GEOMETRY ───

test('모듈마다 번호·폭·런 대비 %·종류, 줄 끝 합계', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(p.includes('FIXED GEOMETRY — left to right, exactly as IMAGE B shows:'));
  assert.ok(p.includes('  BASE ROW (870 mm high, 2200 mm long — 61 % of the wall, starts at the left corner):'));
  assert.match(p, /\n {4}L1 {3}800 mm \(36 % of the run\) +2-door cabinet\n/);
  assert.match(p, /\n {4}L2 {3}400 mm \(18 %\) +single-door cabinet\n/);
  // 싱크는 그 자리 모듈(L3)에 붙는다 — 수전 필수
  assert.match(p, /\n {4}L3 {2}1000 mm \(45 %\) +2-door cabinet, sink bowl with a single-lever mixer faucet .* the faucet is mandatory\n/);
  assert.ok(p.includes('    → 3 base units, 5 doors, 0 drawers.'));
  assert.ok(p.includes('  WALL ROW (780 mm high, 1800 mm long — 50 % of the wall, starts at the left corner):'));
  assert.match(p, /\n {4}U1 {3}900 mm \(41 % of the run\) +2-door cabinet\n/);
  assert.match(p, /\n {4}U2 {3}900 mm \(41 %\) +2-door cabinet\n/);
  assert.ok(p.includes('    → 2 wall units, 4 doors.'));
});

test('COUNT CHECK 가 합계를 한 번 더 말한다', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      'COUNT CHECK: exactly 3 base units with 5 doors and 2 wall units with 4 doors — the same numbers IMAGE B shows.'
    )
  );
  // 순서·개수는 구속, mm·% 는 참고 — 사진이 이긴다 (design-spec-prompt.md 와 같은 규칙)
  assert.match(p, /The order and the counts are binding\. The millimetres and percentages are guidance/);
});

test('서랍·오픈·키큰장·가전 칸 — 종류 구절과 합계', () => {
  const spec = normalizeDesignSpec(
    {
      category: 'sink',
      wallRunMm: 3600,
      sections: {
        lower: {
          widthMm: 2700, heightMm: 870, fromLeftMm: 0,
          modules: [
            { widthMm: 900, kind: 'drawer', drawerCount: 3 },
            { widthMm: 600, kind: 'appliance', label: '식기세척기' },
            { widthMm: 600, kind: 'open' },
            { widthMm: 600, kind: 'drawer', doorCount: 1, drawerCount: 1 },
          ],
        },
        tall: {
          widthMm: 900, heightMm: 2300, fromLeftMm: 2700,
          modules: [{ widthMm: 900, kind: 'appliance', label: '냉장고' }],
        },
      },
      appliances: [
        { kind: 'dishwasher', fromLeftMm: 900, widthMm: 600 },
        { kind: 'fridge', fromLeftMm: 2700, widthMm: 900 },
        { kind: 'hood', fromLeftMm: 1500, widthMm: 600 },
      ],
    },
    'sink'
  );
  const p = buildPlannerPrompt(d1Ctx({ designSpec: spec }));
  assert.match(p, /L1 {3}900 mm \(25 % of the run\) +3-drawer stack\n/);
  assert.match(p, /L2 {3}600 mm \(17 %\) +fully integrated dishwasher behind a matching front\n/);
  assert.match(p, /L3 {3}600 mm \(17 %\) +open shelving, no door\n/);
  assert.match(p, /L4 {3}600 mm \(17 %\) +single-door cabinet over 1 drawer\n/);
  assert.ok(p.includes('    → 3 base units and 1 appliance opening, 1 door, 4 drawers.'));
  assert.ok(p.includes('  TALL ROW (2300 mm high, 900 mm long — 25 % of the wall, starts 2700 mm from the left end of the run):'));
  assert.match(p, /T1 {3}900 mm \(25 % of the run\) +opening with a built-in refrigerator, its front flush with the doors\n/);
  assert.ok(p.includes('    → 1 appliance opening, 0 doors, 0 drawers.'));
  assert.doesNotMatch(p, /0 tall units/);
  // 상부장이 없으니 후드는 APPLIANCES 줄로 — 런 대비 위치
  assert.ok(p.includes('  APPLIANCES: a slim concealed hood, centred at about 50 % of the run.'));
  assert.ok(
    p.includes(
      'COUNT CHECK: exactly 3 base units (plus 1 appliance opening) with 1 door and 4 drawers and 1 appliance opening in the tall row — the same numbers IMAGE B shows.'
    )
  );
  // 도면에 있는 가전은 금지 목록에서 빠진다 — 없는 것만 이름으로
  assert.ok(p.includes('; add an oven or cooktop that is not listed;'));
});

test('냉장고 자리에 냉장고가 요약에 없으면 빈 자리로 둔다', () => {
  const spec = normalizeDesignSpec(
    {
      category: 'fridge',
      sections: { tall: { fromLeftMm: 0, modules: [{ widthMm: 900, kind: 'appliance', label: '냉장고' }, { widthMm: 600, kind: 'door', doorCount: 1 }] } },
    },
    'fridge'
  );
  const p = buildPlannerPrompt(d1Ctx({ category: 'fridge', designSpec: spec }));
  assert.ok(p.includes('TASK: install this built-in refrigerator surround'));
  assert.match(p, /T1 {3}900 mm \(60 % of the run\) +empty opening for a refrigerator — leave it empty\n/);
});

test('붙박이장은 한 줄 — W 번호로 구간을 이어 붙인다', () => {
  const spec = normalizeDesignSpec(
    {
      category: 'wardrobe',
      wallRunMm: 3600,
      sections: {
        tall: {
          widthMm: 3600, heightMm: 2310, fromLeftMm: 0,
          modules: [
            { widthMm: 900, kind: 'door', doorCount: 2 },
            { widthMm: 900, kind: 'drawer', doorCount: 2, drawerCount: 2 },
            { widthMm: 900, kind: 'door', doorCount: 2 },
            { widthMm: 900, kind: 'door', doorCount: 2 },
          ],
        },
      },
    },
    'wardrobe'
  );
  const p = buildPlannerPrompt(d1Ctx({ category: 'wardrobe', designSpec: spec, wallW: 3600, existing: null }));
  assert.ok(p.includes('TASK: install this built-in wardrobe on the main wall'));
  assert.ok(p.includes('  WARDROBE ROW (2310 mm high, 3600 mm long — 100 % of the wall, starts at the left corner):'));
  assert.match(p, /W1 {3}900 mm \(25 % of the run\) +2-door wardrobe unit\n/);
  assert.match(p, /W2 {3}900 mm \(25 %\) +2-door wardrobe unit over 2 drawers\n/);
  assert.match(p, /W4 {3}900 mm \(25 %\) +2-door wardrobe unit\n/);
  assert.ok(p.includes('    → 4 wardrobe units, 8 doors, 2 drawers.'));
  assert.ok(p.includes('COUNT CHECK: exactly 4 wardrobe units with 8 doors and 2 drawers — the same numbers IMAGE B shows.'));
  assert.doesNotMatch(p, /BASE ROW|TALL ROW|WALL ROW/);
  // 상판 앞코는 주방에만
  assert.ok(p.includes('IMAGE C — 3/4 VIEW of the same design: shows depth, side panels.'));
  // 주방이 아니면 가전 이름을 늘어놓지 않는다
  assert.ok(p.includes('add any appliance, sink or hood;'));
  // 벽을 다 채우면 "% of the wall" 남는 벽 문장 대신 벽 전체의 기존 가구를 지운다
  assert.ok(p.includes('REST OF THE WALL: the cabinets fill the main wall.'));
});

// ─── 3. 남는 벽 ───

test('분석이 성공했고 런이 벽보다 짧으면 끝나는 % 와 빈 벽, 기존 가구 설명', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      'REST OF THE WALL: the cabinets end at 61 % of the wall. Remove all existing furniture on the rest of the wall (dark glossy kitchen cabinets) and leave it as a smooth finished empty wall, with no demolition marks or ghost outlines.'
    )
  );
  // 기존 가구 설명이 없으면 괄호도 없다
  const q = buildPlannerPrompt(d1Ctx({ existing: null }));
  assert.ok(q.includes('Remove all existing furniture on the rest of the wall and leave it as a smooth finished empty wall'));
});

test('분석이 실패하면(3000×2400, confidence null) % 문장을 다 뺀다', () => {
  const p = buildPlannerPrompt(d1Ctx({ wallW: 3000, wallH: 2400, confidence: null, existing: null }));
  assert.doesNotMatch(p, /% of the wall/);
  assert.ok(p.includes('  BASE ROW (870 mm high, 2200 mm long, starts at the left corner):'));
  assert.ok(
    p.includes(
      'REST OF THE WALL: remove existing furniture that is not part of this design, with no demolition marks or ghost outlines.'
    )
  );
  // 순서·개수는 그대로 남는다
  assert.ok(p.includes('COUNT CHECK: exactly 3 base units with 5 doors and 2 wall units with 4 doors'));
  // 런 대비 % 는 도면만으로 정해지므로 남는다
  assert.match(p, /L1 {3}800 mm \(36 % of the run\)/);
});

test('사용자가 벽 폭을 직접 넣었으면(confidence user) 분석 실패로 보지 않는다', () => {
  const p = buildPlannerPrompt(d1Ctx({ wallW: 3000, wallH: 2400, confidence: 'user', existing: null }));
  assert.ok(p.includes('the cabinets end at 73 % of the wall.'));
});

// ─── 4. 마감·손잡이·금지·출력 ───

test('마감은 design_spec.finishes 로, 없으면 door_color/door_finish 로', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      'MATERIALS: fronts matte Arc Flat White (예림 LUX 아크 플랫 화이트, colour #f4f4f0), the same on every door and drawer; carcass and visible sides Arc Flat White; countertop 12 mm Calacatta engineered stone.'
    )
  );
  const spec = d1Spec();
  delete spec.finishes;
  const q = buildPlannerPrompt(d1Ctx({ designSpec: spec, doorColor: 'oak', doorFinish: 'satin' }));
  assert.ok(q.includes('MATERIALS: fronts oak satin, the same on every door and drawer.'));
});

test('손잡이 규칙은 지금 문장 그대로, SITE·WALL TILE 은 설치 프롬프트와 같은 문단', () => {
  const ctx = d1Ctx({
    site: 'construction',
    siteNotes: 'bare cement, debris',
    tile: { present: true, lightNeutral: false, description: 'dark brown glossy' },
  });
  const p = buildPlannerPrompt(ctx);
  assert.ok(
    p.includes(
      'HANDLES: none. Every door and drawer is a flat handleless front; lower doors open by reaching behind the door edge. No bar handles, knobs, chrome hardware or push-to-open buttons.'
    )
  );
  const install = buildInstallPrompt({ ...ctx, style: 'modern-minimal', refCount: 0, waterPct: 30, exhaustPct: 70 });
  const site = install.match(/\nSITE: [^\n]*/)[0];
  const tile = install.match(/\nWALL TILE: [^\n]*/)[0];
  assert.ok(p.includes(site), 'SITE 문단이 같다');
  assert.ok(p.includes(tile), 'WALL TILE 문단이 같다');
});

test('DO NOT — 첫 실측 실패(없는 가전, 도어 수 변경, 남은 기존 장)를 이름으로 막는다', () => {
  const p = buildPlannerPrompt(d1Ctx());
  assert.ok(
    p.includes(
      'DO NOT: add or remove any cabinet, door or drawer, or change how many doors any unit has; add a dishwasher, refrigerator, oven, cooktop or hood that is not listed; keep any existing cabinet or any part of the old furniture; add handles or knobs; open any door or drawer; change the camera; paste IMAGE B or IMAGE C into the photo; add text, labels or watermarks.'
    )
  );
});

test('OUTPUT 에 비율이 들어가고, 허용값 밖이면 16:9', () => {
  assert.match(buildPlannerPrompt(d1Ctx()), /\n\nOUTPUT: one photorealistic photograph of the finished room, 16:9\.$/);
  assert.match(buildPlannerPrompt(d1Ctx({ aspect: '4:3' })), /finished room, 4:3\.$/);
  assert.match(buildPlannerPrompt(d1Ctx({ aspect: '21:9' })), /finished room, 16:9\.$/);
  assert.deepEqual(PLANNER_ASPECTS, ['16:9', '4:3', '3:4', '1:1', '9:16']);
  assert.equal(resolvePlannerAspect(undefined), '16:9');
  assert.equal(resolvePlannerAspect('9:16'), '9:16');
});

test('구간이 없는 요약도 터지지 않는다 — IMAGE B 를 그대로 따르라고만', () => {
  const spec = normalizeDesignSpec({ finishes: { door: { nameEn: 'walnut woodgrain' } } }, 'sink');
  const p = buildPlannerPrompt(d1Ctx({ designSpec: spec }));
  assert.ok(p.includes('FIXED GEOMETRY: build exactly the cabinets IMAGE B shows'));
  assert.doesNotMatch(p, /COUNT CHECK/);
  assert.ok(p.includes('MATERIALS: fronts walnut woodgrain'));
});

// ─── 5. 옛 경로 불변 ───

test('옛 설치·검사 프롬프트는 fixture 와 바이트 그대로다 (플래너 코드가 새지 않는다)', () => {
  const BASE = {
    wallW: 3000, wallH: 2400, waterPct: 30, exhaustPct: 70, style: 'modern-minimal',
    doorColor: 'white', doorFinish: 'matte', refCount: 0, fridgeBrand: 'Samsung', fridgePosition: 'left',
  };
  for (const category of Object.keys(CATEGORIES)) {
    assert.equal(buildInstallPrompt({ ...BASE, category }), baseline.install[category], `install(${category})`);
    const qc = buildQcPrompt({ ...BASE, category });
    assert.equal(qc, baseline.qc[category], `qc(${category})`);
    assert.doesNotMatch(qc, /existing_left|pasted_reference/);
  }
});

// ─── 6. 검사 코드 ───

test('플래너 모드 검사는 existing_left·pasted_reference 를 더하고, 공통·layout 코드는 그대로', () => {
  const p = buildQcPrompt({ ...d1Ctx(), planner: true });
  assert.match(p, /\n- existing_left: old furniture that is not part of the new design/);
  assert.match(p, /\n- pasted_reference: part of the image looks like a flat design render pasted onto the photo/);
  for (const code of QC_ISSUE_CODES) assert.ok(p.includes(`- ${code}:`), code);
  assert.ok(p.includes('- layout_mismatch:'));
  assert.doesNotMatch(p, /flat_mockup/);
  // planner 가 아니면 같은 ctx 에서도 안 나온다
  assert.doesNotMatch(buildQcPrompt(d1Ctx()), /existing_left|pasted_reference/);
});

test('parseQc 는 existing_left·pasted_reference 를 알아듣는다', () => {
  assert.deepEqual(parseQc('{"ok":false,"issues":["existing_left","pasted_reference","nope"],"note":"old hood left"}'), {
    ok: false,
    issues: ['existing_left', 'pasted_reference'],
    note: 'old hood left',
  });
  assert.ok(ALL_QC_ISSUE_CODES.includes('existing_left'));
  assert.ok(ALL_QC_ISSUE_CODES.includes('pasted_reference'));
  // 공통 코드 목록(QC_ISSUE_CODES)은 늘지 않는다 — 옛 검사 프롬프트가 그대로인 이유
  assert.ok(!QC_ISSUE_CODES.includes('existing_left'));
  assert.ok(PLANNER_QC_FIXES.existing_left.length > 40 && PLANNER_QC_FIXES.pasted_reference.length > 40);
});
