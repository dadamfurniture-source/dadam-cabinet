/**
 * 붙박이장 통 나누기 (2026-10-19 사장님 "반 통도 연출컷에 — 추천대로").
 * D1 반 통은 오른쪽 끝 · D2 반 통 내부는 자리 순서대로 기본형 · D3 벽 전체 폭 · D4 문 수 틀리면 다시 그림 · D5 반 통 문은 왼쪽 경첩.
 * 정본은 플래너 js/planner/planner-engine.js 의 distributeModules + spreadGapEqually — 워커는 옮겨 적었으므로
 * 1000~6000 mm 전부에서 같은지 본다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  WARDROBE_DOOR_RULES,
  WARDROBE_QC_FIXES,
  ALL_QC_ISSUE_CODES,
  buildInstallPrompt,
  buildInteriorRecommendPrompt,
  buildQcPrompt,
  buildWardrobeInteriorPrompt,
  distributeWardrobeDoors,
  interiorSplitFolds,
  normalizeDesignSpec,
  INTERIOR_RULES,
  qcNeedsRetry,
  wardrobeDoorPhrase,
  wardrobeDoors,
  wardrobeInteriorPlan,
  wardrobeModules,
} from '../src/prompts.js';

const require = createRequire(import.meta.url);
const P = require('../../../js/planner/planner-engine.js');
const W = require('../../../js/detaildesign/bom-wardrobe-rules.js');

test('정본 상수가 같다 (도어 350·450·600, 잔여 10, 조립 여유 1mm/통, 최소 칸 200)', () => {
  for (const k of ['DOOR_W_MIN', 'DOOR_W_MAX', 'DOOR_W_TARGET', 'MAX_REMAINDER', 'JOINT_SLACK_PER_MODULE']) {
    assert.equal(WARDROBE_DOOR_RULES[k], P.MASTER_RULES[k], k);
  }
  assert.equal(INTERIOR_RULES.MIN_CELL_W, W.WARDROBE_RULES.MIN_CELL_W);
});

test('통 나누기: 1000~6000 mm 전부 플래너 distributeModules + spreadGapEqually 와 같다', () => {
  for (let w = 1000; w <= 6000; w++) {
    const d = P.distributeModules(w);
    const mine = distributeWardrobeDoors(w);
    assert.deepEqual(
      { doorCount: mine.doorCount, doorWidth: mine.doorWidth, gap: mine.gap, modules: mine.modules },
      { doorCount: d.doorCount, doorWidth: d.doorWidth, gap: d.gap, modules: d.modules.map((m) => ({ w: m.w, doors: m.doors })) },
      String(w)
    );
    const s = P.spreadGapEqually(d.gap, d.modules.map((m) => m.doors));
    assert.deepEqual(wardrobeModules(w).modules.map((m) => m.w), d.modules.map((m, i) => m.w + s.add[i]), `${w} 폭`);
    // 반 통은 많아야 하나, 늘 맨 오른쪽 (D1)
    const singles = mine.modules.map((m, i) => (m.doors === 1 ? i : -1)).filter((i) => i >= 0);
    assert.ok(singles.length === 0 || (singles.length === 1 && singles[0] === mine.modules.length - 1), `${w} 반 통 위치`);
  }
});

test('계획서 표와 같다: 3200 → 914×3 + 457, 2450 → 980×2 + 490, 3600 → 900×4, 5000 → 908×5 + 454', () => {
  const ws = (w) => wardrobeModules(w).modules.map((m) => `${m.w}/${m.doors}`).join(' ');
  assert.equal(ws(3200), '914/2 914/2 914/2 457/1');
  assert.equal(ws(2450), '980/2 980/2 490/1');
  assert.equal(ws(3600), '900/2 900/2 900/2 900/2');
  assert.equal(ws(5000), '908/2 908/2 908/2 908/2 908/2 454/1');
  assert.equal(wardrobeDoors(3000), 7);
  assert.equal(wardrobeDoors(3600), 8);
});

test('설치 문장: 2짝 통뿐이면 예전 문장 그대로, 반 통이 있으면 오른쪽 끝 1짝 통이라고 쓴다', () => {
  assert.equal(wardrobeDoorPhrase(3600), '8 equal full-height flat doors arranged in mirrored pairs');
  assert.equal(
    wardrobeDoorPhrase(3200),
    '7 equal full-height flat doors: 3 two-door units in mirrored pairs, then one single-door unit at the right end, hinged on its left side'
  );
  const p = buildInstallPrompt({ category: 'wardrobe', wallW: 3200, wallH: 2400, refCount: 0 });
  assert.match(p, /7 equal full-height flat doors: 3 two-door units in mirrored pairs, then one single-door unit at the right end/);
  assert.doesNotMatch(p, /7 equal full-height flat doors arranged in mirrored pairs/);
});

test('반 통 내부: 자리 순서대로 기본형(D2), 445 mm 미만이면 정본처럼 분할을 접고, 문은 1짝 왼쪽 경첩(D5)', () => {
  // 정본 접힘과 같다
  for (const mw of [420, 428, 444, 445, 457, 900]) {
    const r = W.layoutWardrobeModule({ preset: 'halfSplit', W: mw, D: 620, totalH: 2310 });
    assert.equal(interiorSplitFolds(mw), r.cells.length === 1, String(mw));
  }
  assert.deepEqual(wardrobeInteriorPlan(3000), ['short2', 'longDrawer', 'halfSplit', 'rodTopSplitBottom']);
  assert.deepEqual(wardrobeInteriorPlan(2450), ['short2', 'longDrawer', 'halfSplit']);
  const p3000 = buildWardrobeInteriorPrompt(3000, null, { wallH: 2310 }).prompt;
  assert.match(p3000, /The wardrobe has 4 sections, from left to right\. Sections 1 to 3 are each behind a pair of doors; section 4, the narrow one at the right end, is behind a single door hinged on its left side:/);
  assert.match(p3000, /4\. one clothes rail across the full width in the upper half; three shelves across the full width in the lower half \(too narrow to divide\)/, '428 은 접힌다');
  const p3200 = buildWardrobeInteriorPrompt(3200, null, { wallH: 2310 }).prompt;
  assert.match(p3200, /4\. one clothes rail across the full width in the upper half; the lower half split side by side/, '457 은 접히지 않는다');
  const p2450 = buildWardrobeInteriorPrompt(2450, null, { wallH: 2310 }).prompt;
  assert.match(p2450, /Sections 1 to 2 are each behind a pair of doors; section 3/);
  assert.match(buildWardrobeInteriorPrompt(3600).prompt, /The wardrobe has 4 pairs of doors\. Behind each pair is one section/, '짝수면 예전 문장');
  // 좁은 벽: 3짝(2짝 통 + 반 통) · 2짝(통 하나)
  assert.deepEqual(wardrobeModules(1100).modules.map((m) => m.doors), [2, 1]);
  assert.match(buildWardrobeInteriorPrompt(1100).prompt, /The wardrobe has 2 sections, from left to right\. Section 1 is behind a pair of doors; section 2, the narrow one/);
  assert.deepEqual(wardrobeModules(1000).modules.map((m) => m.doors), [2]);
  assert.match(buildWardrobeInteriorPrompt(1000).prompt, /The wardrobe has one pair of doors with one section behind it:\n1\. /);
  assert.match(buildInteriorRecommendPrompt({ sections: 1, wallW: 1000, wallH: 2310, canonical: wardrobeInteriorPlan(1000) }), /It has one section of about 1000 mm behind a pair of doors\./);
});

test('추천 요청 글: 통마다 폭·문 수를 싣고, 좁은 반 통에서는 분할 프리셋이 접힌다고 알려 준다', () => {
  const p = buildInteriorRecommendPrompt({ sections: 4, wallW: 3000, wallH: 2310, canonical: wardrobeInteriorPlan(3000) });
  assert.match(p, /1\) 856 mm behind a pair of doors; 2\) 856 mm behind a pair of doors; 3\) 856 mm behind a pair of doors; 4\) 428 mm behind a single door \(too narrow to divide side by side/);
  assert.match(buildInteriorRecommendPrompt({ sections: 4, wallW: 3600, wallH: 2310, canonical: wardrobeInteriorPlan(3600) }), /4 sections of about 900 mm, each behind a pair of doors/);
});

test('검사: 붙박이장만 door_count 코드가 있고(문 수·반 통), 걸리면 다시 그린다(D4)', () => {
  const q = buildQcPrompt({ category: 'wardrobe', wallW: 3200, wallH: 2400, refCount: 0 });
  assert.match(q, /- door_count: the wardrobe does not show exactly 7 equal doors, 3 pairs then one single door at the right end/);
  assert.match(buildQcPrompt({ category: 'wardrobe', wallW: 3600, wallH: 2400, refCount: 0 }), /- door_count: the wardrobe does not show exactly 8 equal doors \(/);
  assert.doesNotMatch(buildQcPrompt({ category: 'storage', wallW: 3200, wallH: 2400, refCount: 0 }), /door_count/);
  assert.doesNotMatch(buildQcPrompt({ category: 'wardrobe', wallW: 3200, wallH: 2400, refCount: 0, planner: true }), /door_count/);
  // 도면 요약 블록이 FURNITURE 를 대신하면 문 수를 말하지 않았으니 검사도 없다 (모듈 없는 단 하나·가전만이어도)
  for (const designSpec of [
    normalizeDesignSpec({ category: 'wardrobe', wallRunMm: 3000, sections: { tall: { widthMm: 3000, heightMm: 2400, depthMm: 620 } } }, 'wardrobe'),
    normalizeDesignSpec({ category: 'wardrobe', appliances: [{ kind: 'fridge' }] }, 'wardrobe'),
  ]) {
    const ctx = { category: 'wardrobe', wallW: 3000, wallH: 2400, refCount: 0, designSpec };
    assert.doesNotMatch(buildInstallPrompt(ctx), /equal full-height flat doors/);
    assert.doesNotMatch(buildQcPrompt(ctx), /door_count/);
  }
  assert.ok(ALL_QC_ISSUE_CODES.includes('door_count'));
  assert.equal(qcNeedsRetry({ ok: false, issues: ['door_count'] }), true);
  const fix = buildInstallPrompt({ category: 'wardrobe', wallW: 3200, wallH: 2400, refCount: 0 }, { fix: ['door_count'] });
  assert.ok(fix.includes(WARDROBE_QC_FIXES.door_count));
});
