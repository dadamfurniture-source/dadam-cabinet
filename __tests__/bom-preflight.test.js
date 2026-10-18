/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect */
/**
 * 사전 오류 검사 — js/detaildesign/bom-preflight.js (ArchiWood REA 1번, 2026-10-18).
 *
 * 1) 표준 픽스처 9종을 추출기에 그대로 넣은 결과는 오류·경고가 0 이다 (검사가 정상 설계를 막지 않는다).
 * 2) 행 하나를 일부러 망가뜨리면 그 검사가 정확히 그 code 로 잡는다.
 */
const { FIXTURES, designOf } = require('../test-utils/bom-golden/fixtures');
const { snapshotOf } = require('../test-utils/bom-golden/golden');
const BomPreflight = require('../js/detaildesign/bom-preflight.js');
const { BOM_HINGE_MIN_GAP } = require('../js/detaildesign/extractors.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const codes = (r, level) => r.issues.filter((i) => !level || i.level === level).map((i) => i.code);
const snap = (name) => snapshotOf(designOf(FIXTURES[name]));

describe('정상 설계는 통과한다', () => {
  test.each(Object.keys(FIXTURES))('%s — 오류·경고 0', (name) => {
    const s = snap(name);
    const r = BomPreflight.check(s.materials, s.hardware);
    expect(r.issues.filter((i) => i.level !== 'info')).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('서랍장(마이다) 도어는 경첩이 없어도 경고하지 않는다', () => {
    const s = snap('sink15');
    // 전제: 픽스처의 서랍장에 여닫이 도어 행이 있고 경첩은 없다 — 이 가지를 실제로 건다
    expect(s.materials.some((m) => m.moduleKey === '0-l2' && m.slot === 'door')).toBe(true);
    expect(s.hardware.some((h) => h.moduleKey === '0-l2' && h.category === '경첩')).toBe(false);
    expect(codes(BomPreflight.check(s.materials, s.hardware))).not.toContain('door-no-hinge');
  });

  test('원판보다 긴 상판·걸레받이는 오류가 아니라 안내다', () => {
    const s = snap('sink15');
    const r = BomPreflight.check(s.materials, s.hardware);
    expect(codes(r, 'info')).toContain('long-part');
    expect(codes(r)).not.toContain('oversize');
  });

  test('같은 입력이면 같은 출력 · HardwareExtractor 결과 객체도 받는다', () => {
    const s = snap('wardrobe');
    const a = BomPreflight.check(s.materials, s.hardware);
    const b = BomPreflight.check(clone(s.materials), { hardware: clone(s.hardware) });
    expect(b).toEqual(a);
  });
});

describe('망가뜨린 행을 잡는다', () => {
  const base = snap('sink15');
  const run = (mutate) => {
    const mats = clone(base.materials);
    const hw = clone(base.hardware);
    mutate(mats, hw);
    return BomPreflight.check(mats, hw);
  };
  const firstIdx = (mats, pred) => {
    const i = mats.findIndex(pred);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  };

  test('dim-invalid — 가로 0', () => {
    const r = run((m) => {
      m[0].w = 0;
    });
    expect(codes(r, 'error')).toContain('dim-invalid');
    expect(r.ok).toBe(false);
  });

  test('dup-partid — 같은 partId 두 행', () => {
    const r = run((m) => {
      m.push(clone(m[0]));
    });
    expect(codes(r, 'error')).toContain('dup-partid');
  });

  test('oversize — 원판보다 큰 측판', () => {
    const r = run((m) => {
      m[firstIdx(m, (x) => x.partId && x.partId.indexOf('body:side') >= 0)].h = 3000;
    });
    expect(codes(r, 'error')).toContain('oversize');
  });

  test('hinge-no-door — 경첩은 있는데 도어 행이 없다', () => {
    const r = run((m) => {
      m.splice(0, m.length, ...m.filter((x) => !(x.moduleKey === '0-u1' && x.slot === 'door')));
    });
    const hit = r.issues.find((i) => i.code === 'hinge-no-door');
    expect(hit && hit.moduleKey).toBe('0-u1');
    expect(hit.level).toBe('error');
  });

  test('hinge-out-of-door — 보링이 도어 높이를 넘는다', () => {
    const r = run((m, h) => {
      h.find((x) => x.moduleKey === '0-u1' && x.category === '경첩').boring = [110, 800];
    });
    expect(codes(r, 'error')).toContain('hinge-out-of-door');
  });

  test('hinge-gap — 컵 간격이 extractors 문턱보다 가깝다', () => {
    expect(BOM_HINGE_MIN_GAP).toBeGreaterThan(0);
    const r = run((m, h) => {
      h.find((x) => x.moduleKey === '0-u1').boring = [110, 110 + BOM_HINGE_MIN_GAP - 1];
    });
    expect(codes(r, 'warning')).toContain('hinge-gap');
    // 문턱과 같으면 경고하지 않는다 (extractors 와 같은 `<`)
    const ok = run((m, h) => {
      h.find((x) => x.moduleKey === '0-u1').boring = [110, 110 + BOM_HINGE_MIN_GAP];
    });
    expect(codes(ok)).not.toContain('hinge-gap');
  });

  test('door-no-hinge — 여닫이 도어 모듈의 경첩 행이 빠졌다', () => {
    const r = run((m, h) => {
      h.splice(0, h.length, ...h.filter((x) => x.moduleKey !== '0-l1'));
    });
    const hit = r.issues.find((i) => i.code === 'door-no-hinge');
    expect(hit && hit.moduleKey).toBe('0-l1');
  });

  test('body-incomplete — 뒷판이 빠졌다', () => {
    const r = run((m) => {
      m.splice(0, m.length, ...m.filter((x) => !(x.moduleKey === '0-u1' && x.slot === 'back')));
    });
    const hit = r.issues.find((i) => i.code === 'body-incomplete');
    expect(hit && hit.moduleKey).toBe('0-u1');
    expect(hit.message).toContain('뒷판');
  });

  test('door-edge — 도어 엣지 한 변이 빠졌다', () => {
    const r = run((m) => {
      m[firstIdx(m, (x) => x.slot === 'door')].edges.L = false;
    });
    expect(codes(r, 'warning')).toContain('door-edge');
  });

  test('unkeyed — moduleKey 없는 옛 철물이면 도어·경첩 대조를 건너뛴다', () => {
    const r = run((m, h) => {
      h.forEach((x) => {
        delete x.moduleKey;
      });
      h.splice(0, h.length, ...h.filter((x) => x.module !== '개수대'));
    });
    expect(codes(r)).not.toContain('door-no-hinge');
    expect(codes(r, 'info')).toContain('unkeyed');
  });

  test('오류가 경고·안내보다 먼저 온다', () => {
    const r = run((m) => {
      m[0].w = 0;
    });
    const levels = r.issues.map((i) => i.level);
    expect(levels.indexOf('error')).toBe(0);
    expect(BomPreflight.summaryOf(r)).toMatch(/오류 1/);
  });
});
