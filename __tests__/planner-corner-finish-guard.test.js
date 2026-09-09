/**
 * W12-64: 코너 끝에 마감재를 붙여도 멍장이 부품보다 작아지지 않는다.
 *
 * 예전엔 `setModuleFinish` 가 호스트(코너 끝 = 멍장)에서 60 을 뺏고 균등 분배가
 * 코너 예약을 몰라, 카카스 1162 → 1102 인데 멍 + 도어는 1162 그대로였다. 원장은
 * 그 60 을 옆 마감재가 가져가 0 을 보였고, 변환기 셀합 검사는 멍장을 건너뛰어
 * **경고 없이** 상자에 안 들어가는 자재가 발주됐다.
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const D = 700, LEFT = 2800, RIGHT = 2200, RT = RIGHT - D;
const L = (mods) => ({ version:1, savedAt:'2026-09-09T00:00:00.000Z', person:null, modules:mods });
const horiz = (rot) => ({ section:'lower', x:0, y:0, w:LEFT, h:D, moduleH:870, rotation:rot, finishings:[] });
const vertTrim = () => ({ section:'lower', x:D/2-RT/2, y:D+RT/2-D/2, w:RT, h:D, moduleH:870, rotation:270, finishings:[] });
const vertOver = () => ({ section:'lower', x:D/2-RIGHT/2, y:RIGHT/2-D/2, w:RIGHT, h:D, moduleH:870, rotation:270, finishings:[] });

function boot(mods) {
  const p = bootPlanner('mockup-structure.html', {
    search:'?design=d1&item=1', storage:{ 'dadam_layout_v1::d1:1': JSON.stringify(L(mods)) } });
  if (p.errors.length) throw new Error(p.errors.map((e) => e.message).join(' | '));
  p.g('autoCalcAllAreas')();
  return p;
}
const blind = (p) => (p.g('modules') || []).find((m) => m.blind);
const partsW = (m) => m.blind.zoneW + m.blind.doorW;
/** 멍장이 선 끝 — 셀 순서로 되읽는다 */
const cornerSide = (p, m) => (p.g('structures')[m.id].areaTypes[0] !== 'door') ? 'left' : 'right';
/** 배치 공간 안 모듈끼리 겹치는 곳 */
function intraOverlaps(p, areaId) {
  const ms = p.g('modules').filter((m) => m.areaId === areaId).sort((a, b) => a.x - b.x);
  const hits = [];
  for (let i = 1; i < ms.length; i++) {
    if (ms[i].x < ms[i - 1].x + ms[i - 1].W - 1) hits.push([ms[i - 1].id, ms[i].id]);
  }
  return hits;
}

describe.each([
  ['트리밍된 ㄱ자', [horiz(180), vertTrim()]],
  ['겹친 ㄱ자',   [horiz(0),   vertOver()]],
])('%s — 코너 끝 마감재', (_tag, mods) => {
  test('멍장 카카스가 멍 + 도어와 같다', () => {
    const p = boot(mods);
    const m0 = blind(p); const own = m0.areaId;
    // 멍장 객체는 재계산 때 제자리에서 갱신된다 — 값을 숫자로 먼저 담아 둔다
    const W0 = m0.W, door0 = m0.blind.doorW;
    p.g('setAreaFinish')(own, cornerSide(p, m0), 'molding');
    const m = blind(p);
    expect(Math.round(m.W)).toBe(partsW(m));
    // 마감재 60 이 도어 몫에서 빠져 멍장은 **정당하게** 조금 좁아진다 — 부품과 함께
    expect(m.W).toBeLessThan(W0);
    expect(m.blind.doorW).toBeLessThan(door0);
  });

  test('양쪽 다 붙여도 같다', () => {
    const p = boot(mods);
    const own = blind(p).areaId;
    p.g('setAreaFinish')(own, 'left', 'filler');
    p.g('setAreaFinish')(own, 'right', 'molding');
    const m = blind(p);
    expect(Math.round(m.W)).toBe(partsW(m));
  });

  test('마감재가 멍장 안에 겹쳐 서지 않는다 — [멍장][마감재][여유 50] 순', () => {
    const p = boot(mods);
    const m0 = blind(p); const own = m0.areaId; const side = cornerSide(p, m0);
    p.g('setAreaFinish')(own, side, 'molding');
    const area = p.g('areaById')(own);
    const m = blind(p);
    const f = p.g('areaFinishOn')(own, side);
    expect(intraOverlaps(p, own)).toEqual([]);
    const G = 50;
    if (side === 'right') {
      expect(Math.round(f.x + f.W)).toBe(Math.round(area.x + area.W - G));   // 마감재 바깥에 여유 50
      expect(Math.round(m.x + m.W)).toBe(Math.round(f.x));                    // 멍장은 마감재에 붙는다
    } else {
      expect(Math.round(f.x)).toBe(Math.round(area.x + G));
      expect(Math.round(m.x)).toBe(Math.round(f.x + f.W));
    }
  });

  test('원장이 맞고 배치 공간끼리도 안 겹친다', () => {
    const p = boot(mods);
    const own = blind(p).areaId;
    const adj = p.g('cornerPairs')()[0].adj.id;
    p.g('setAreaFinish')(own, 'left', 'molding');
    p.g('setAreaFinish')(own, 'right', 'molding');
    p.g('setAreaFinish')(adj, 'left', 'filler');
    [own, adj].forEach((id) => {
      const Lg = p.g('cornerLedger')(id);
      expect(Math.abs(Lg.diff)).toBeLessThanOrEqual(1);
      expect(Lg.missing).toBe(0);
    });
    expect(p.g('crossAreaOverlaps')()).toEqual([]);
  });

  test('떼면 원래 폭으로 돌아온다', () => {
    const p = boot(mods);
    const m0 = blind(p); const own = m0.areaId; const side = cornerSide(p, m0);
    const W0 = m0.W;
    p.g('setAreaFinish')(own, side, 'molding');
    p.g('setAreaFinish')(own, side, '');
    const m = blind(p);
    expect(Math.round(m.W)).toBe(Math.round(W0));
    expect(p.g('areaFinishOn')(own, side)).toBeNull();
  });
});

describe('마감재 종류마다 같다', () => {
  ['ep', 'molding', 'filler'].forEach((sec) => {
    test(sec, () => {
      const p = boot([horiz(180), vertTrim()]);
      const m0 = blind(p);
      p.g('setAreaFinish')(m0.areaId, cornerSide(p, m0), sec);
      const m = blind(p);
      expect(Math.round(m.W)).toBe(partsW(m));
    });
  });
});

describe('고정 모듈은 폭을 내놓지 않는다 (setModuleFinish)', () => {
  test('멍장을 호스트로 붙여도 멍장 W 는 그 자리에서 변하지 않는다', () => {
    const p = boot([horiz(180), vertTrim()]);
    const m0 = blind(p); const W0 = m0.W;
    // 영역 경로가 아닌 직접 호출 — 재계산이 이어지지 않는 상태를 본다
    const f = p.g('setModuleFinish')(m0.id, cornerSide(p, m0), 'molding', { evenAfter: true });
    expect(f).toBeTruthy();
    expect(blind(p).W).toBe(W0);
  });
});

describe('변환기 그물 — 멍장 폭이 부품과 다르면 경고한다', () => {
  const SRC = fs.readFileSync(path.join(__dirname, '../js/detaildesign/ui-step1.js'), 'utf8');
  const block = SRC.slice(SRC.indexOf('const PLANNER_CABINET_SECTIONS'), SRC.indexOf('function _applyPlannerResult'));
  const conv = new Function(`${block}; return { _convertPlannerModules };`)(); // eslint-disable-line no-new-func
  const payload = (W) => ({ modules: [{ id:'lower-0', section:'lower', W, H:870, D:550, x:0, y:0,
    blind:{ zoneW:765, doorW:385, adjAreaId:'a' }, isFixed:true }], structures:{} });

  test('맞으면 조용하다', () => {
    const { warnings } = conv._convertPlannerModules(payload(1150), {});
    expect(warnings.filter((w) => w.includes('멍장 폭'))).toEqual([]);
  });
  test('60 어긋나면 "자동계산을 다시 실행" 을 말한다', () => {
    const { warnings } = conv._convertPlannerModules(payload(1090), {});
    const w = warnings.find((x) => x.includes('멍장 폭'));
    expect(w).toBeTruthy();
    expect(w).toContain('1150');
    expect(w).toContain('자동계산을 다시 실행');
  });
});
