/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect, process */
/**
 * CAD 베타 PR7 — 조립 검사 (js/detaildesign/assembly-check.js).
 *
 * 완료 기준 (docs/01-plan/planner-cad.plan.md PR7):
 *   1. #832 이전 경로 전체 (측판 사이 배치 + 옛 크기 (W−2T)×(H−T)) 를 심으면 검사가 실패한다.
 *      크기만 되돌리면 겹침이 아니라 틈이 생기므로 덮개·접촉 검사도 함께 잡는다 (개정 #5).
 *   2. 골든 9종에서 error 0 (사장님 미결 질문은 test-utils/assembly-allowlist.json 에서 warning 으로).
 *   3. 싱크 한 세트 50ms 이하.
 */
global.dlog = global.dlog || (() => {});
const Asm = require('../js/detaildesign/bom-assembly.js');
const Check = require('../js/detaildesign/assembly-check.js');
const BoxOverlap = require('../test-utils/box-overlap.js');
const BomPreflight = require('../js/detaildesign/bom-preflight.js');
const ALLOW = require('../test-utils/assembly-allowlist.json');

// 골든 픽스처 → 명세 (CAD 검산기 덤프와 같은 입력)
const { NAMES, specOf } = require('../test-utils/assembly-fixtures.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const modOf = (spec, id) => spec.items[0].modules.find((m) => m.moduleId === id);
const codesOf = (r) => r.issues.filter((x) => x.level === 'error').map((x) => x.code);

/** 부재의 frame·cut 을 바꾸고 box 를 다시 잰다. */
function move(part, frame, cut) {
  part.frame = Object.assign({}, part.frame, frame);
  if (cut) part.cut = Object.assign({}, part.cut, cut);
  part.box = Asm.boxOfFrame(part.frame, part.cut.w, part.cut.h, part.t);
}

/**
 * #832 이전 뒷판 — 측판 사이, 장 뒤끝, 옛 크기 (W−2T)×(H−T), 지판 위에서 천판 끝까지.
 * (PR #832 가 고친 경로: 뒷판이 측판 사이에 들어가 천판·지판과 부딪혔다)
 */
function seedPre832(m) {
  const { W, H, D, T } = m.box;
  const back = m.parts.find((p) => p.part === '뒷판');
  move(back, { o: [-W / 2 + T, T, -D / 2] }, { w: W - 2 * T, h: H - T });
  return back;
}

describe('겹침 판정 핵심은 운영 파일로 옮겼다 — test-utils/box-overlap.js 는 같은 함수', () => {
  test.each(['findOverlaps', 'pieceOverlap', 'boxPairOverlap', 'penetrationDepth', 'intersectionVolume', 'rectilinearRects', 'worldAabbOf'])('%s', (k) => {
    expect(BoxOverlap[k]).toBe(Check[k]);
  });
  test('기준 그대로 — 부피 > 1mm³ 이고 깊이 > 0.1mm', () => {
    expect(Check.DEFAULT_LIMITS).toEqual({ minVolume: 1, minDepth: 0.1 });
  });
});

describe.each(NAMES)('골든 %s', (name) => {
  const { spec } = specOf(name);
  const r = Check.check(spec);

  test('error 0 — 허용 목록(사장님 미결)만 남는다', () => {
    const allowed = new Set(ALLOW.entries.filter((e) => e.id.indexOf(name + '|') === 0).map((e) => e.id));
    const errs = r.issues.filter((x) => x.level === 'error');
    const ids = errs.map((x) => `${name}|${x.partId}×${x.other}`);
    expect(ids.filter((id) => !allowed.has(id))).toEqual([]);
    // 허용 항목이 없어졌으면 목록에서 지운다 (고친 겹침이 목록에 남지 않게)
    expect([...allowed].filter((id) => ids.indexOf(id) < 0)).toEqual([]);
  });

  test('자리 못 정한 행은 모듈마다 warning 한 줄', () => {
    const un = r.issues.filter((x) => x.code === 'assembly-unplaced');
    un.forEach((x) => expect(x.level).toBe('warning'));
    expect(new Set(un.map((x) => x.moduleKey || ''))).toEqual(new Set(spec.unplaced.map((u) => u.moduleKey || '')));
    const total = un.reduce((s, x) => s + Number(/행 (\d+)개/.exec(x.message)[1]), 0);
    expect(total).toBe(spec.unplaced.length);
  });
});

describe('#832 회귀를 잡는다', () => {
  const { spec } = specOf('sink15');

  test('지금 명세는 깨끗하다 (l3 하부장 · u1 상부장)', () => {
    expect(codesOf(Check.check(spec))).toEqual([]);
  });

  test.each([['l3', '하부장 — 뒤에 덮는 뒷판'], ['u1', '상부장 — 사쿠리 홈 뒷판']])('%s %s: #832 이전 경로 전체를 심으면 실패', (id) => {
    const s = clone(spec);
    const m = modOf(s, id);
    const back = seedPre832(m);
    const r = Check.check(s);
    expect(r.ok).toBe(false);
    const errs = r.issues.filter((x) => x.level === 'error' && x.moduleKey === m.moduleKey);
    expect(errs.map((x) => x.code)).toEqual(expect.arrayContaining(['part-overlap', 'back-cover', 'back-contact']));
    expect(errs.filter((x) => x.code === 'part-overlap').every((x) => x.partId === back.id || x.other === back.id)).toBe(true);
  });

  test('크기만 되돌리면 (자리는 지금 그대로) 겹침은 없어도 덮개 검사가 잡는다', () => {
    const s = clone(spec);
    const m = modOf(s, 'l3');
    const { W, H, T } = m.box;
    const back = m.parts.find((p) => p.part === '뒷판');
    move(back, { o: [-(W - 2 * T) / 2, (H - (H - T)) / 2, back.frame.o[2]] }, { w: W - 2 * T, h: H - T });
    const r = Check.check(s);
    expect(codesOf(r)).toEqual(['back-cover']);
    expect(r.issues[0]).toMatchObject({ level: 'error', code: 'back-cover', partId: back.id, moduleKey: m.moduleKey });
  });

  test('뒷판이 측판 뒤끝에서 떨어지면 접촉 검사가 잡는다', () => {
    const s = clone(spec);
    const back = modOf(s, 'l3').parts.find((p) => p.part === '뒷판');
    move(back, { o: [back.frame.o[0], back.frame.o[1], back.frame.o[2] - 5] });
    expect(codesOf(Check.check(s)).sort()).toEqual(['back-contact', 'part-detached']);
  });

  test('홈에 끼운 사쿠리 뒷판은 겹침이 아니다 — 홈 밖으로 나가면 겹침', () => {
    const s = clone(spec);
    const back = modOf(s, 'u1').parts.find((p) => p.part === '뒷판');
    move(back, { o: [back.frame.o[0], back.frame.o[1], back.frame.o[2] + 10] });
    const codes = codesOf(Check.check(s));
    expect(codes).toContain('part-overlap');
    expect(codes).toContain('back-contact');
  });

  test('떠 있는 판재', () => {
    const s = clone(spec);
    const shelf = modOf(s, 'l3').parts.find((p) => p.part === '선반');
    move(shelf, { o: [shelf.frame.o[0] + 5000, shelf.frame.o[1], shelf.frame.o[2]] });
    const r = Check.check(s);
    expect(codesOf(r)).toEqual(['part-detached']);
    expect(r.issues[0].partId).toBe(shelf.id);
  });

  test('겹침 이슈 모양 — partId · other · moduleKey · volumeMm3 · depthMm', () => {
    const { spec: s18 } = specOf('sink18');
    const x = Check.check(s18).issues.find((i) => i.code === 'part-overlap');
    expect(x).toMatchObject({ level: 'error', moduleKey: '0-u1', depthMm: 2, volumeMm3: 2520 });
    expect(x.partId).toMatch(/^0-u1-/);
    expect(x.other).toMatch(/^0-u1-/);
  });
});

describe('붙박이장 — 몸통이 여럿이면 뒷판 검사도 몸통마다', () => {
  const { spec } = specOf('wardrobe');

  test('지금 명세는 깨끗하다 (2단 · 외부 서랍 몸통)', () => {
    expect(codesOf(Check.check(spec))).toEqual([]);
  });

  test('상부장 뒷판을 홈 밖으로 빼면 그 몸통만 걸린다 — 하부장(뒤에 덮음) 측판 뒤끝과 섞어 보지 않는다', () => {
    const s = clone(spec);
    const m = modOf(s, 'w1');
    const back = m.parts.find((p) => p.rowPartId === '0-w1-back-0');
    move(back, { o: [back.frame.o[0], back.frame.o[1], back.frame.o[2] - 15] });
    const errs = Check.check(s).issues.filter((x) => x.level === 'error');
    expect(errs.filter((x) => x.code === 'back-contact').map((x) => x.partId)).toEqual([back.id]);
  });

  test('하부장 뒷판이 측판 뒤끝에서 떨어지면 접촉 검사가 잡는다', () => {
    const s = clone(spec);
    const back = modOf(s, 'w1').parts.find((p) => p.rowPartId === '0-w1-back-1');
    move(back, { o: [back.frame.o[0], back.frame.o[1], back.frame.o[2] - 5] });
    expect(codesOf(Check.check(s)).sort()).toEqual(['back-contact', 'part-detached']);
  });
});

describe('사전 검사(bom-preflight)에 붙는다', () => {
  const { materials, spec } = specOf('sink18');

  test('opts.assembly 를 넘기면 조립 검사 이슈가 더해진다 (오류는 동결 확인창으로)', () => {
    const base = BomPreflight.check(materials, [], {});
    const withAsm = BomPreflight.check(materials, [], { assembly: spec });
    expect(base.issues.some((x) => x.code === 'part-overlap')).toBe(false);
    expect(withAsm.issues.filter((x) => x.code === 'part-overlap')).toHaveLength(4);
    expect(withAsm.ok).toBe(false);
    expect(withAsm.counts.error).toBe(base.counts.error + 4);
  });
});

describe('속도', () => {
  test('싱크 한 세트 50ms 이하', () => {
    const { spec } = specOf('sink15');
    Check.check(spec);
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const t0 = process.hrtime.bigint();
      Check.check(spec);
      runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    runs.sort((a, b) => a - b);
    expect(runs[2]).toBeLessThan(50);
  });
});

describe('홈 깊이 (2026-10-25 D5) — 뒷판이 홈보다 깊이 들면 겹침', () => {
  const pick = () => {
    for (const name of NAMES) {
      const spec = clone(specOf(name).spec);
      for (const it of spec.items) for (const m of (it.modules || [])) {
        const back = m.parts.find((p) => p.tags && p.tags.mount === 'groove' && !('box' in p.tags));
        const side = m.parts.find((p) => (p.features || []).some((f) => f.type === 'groove' && f.src === 'sakuri'));
        if (back && side) return { spec, m, side };
      }
    }
    return null;
  };
  test('명세 그대로면 끼운 것 (15T 뒷판 5 가 홈 6 안)', () => {
    const { spec, m } = pick();
    expect(Check.check(spec).issues.filter((x) => x.level === 'error' && x.code === 'part-overlap' && x.moduleKey === m.moduleKey)).toEqual([]);
  });
  test('홈을 4 로 얕게 하면 part-overlap', () => {
    const { spec, m } = pick();
    m.parts.forEach((p) => (p.features || []).forEach((f) => { if (f.type === 'groove' && f.src === 'sakuri') f.depth = 4; }));
    expect(Check.check(spec).issues.some((x) => x.level === 'error' && x.code === 'part-overlap' && x.moduleKey === m.moduleKey)).toBe(true);
  });
});
