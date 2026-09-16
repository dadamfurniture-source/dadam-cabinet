/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, global, __dirname */
/**
 * 2026-09-15: 서랍장·목찬넬·레일 규칙 (js/detaildesign/bom-drawer-rules.js) 와 BOM 적용 (extractors.js).
 *
 * 기대값은 도면 "서랍장 목찬넬 구조 도면" (몸통 758, 균등 배분) 과 같다 — 도면과 코드가 같은 숫자를 낸다.
 *   · 중간 따내기 90×40 = 전면판 72 + 지면판 18, 위 전면 20 내려옴, 슬롯 30
 *   · 목찬넬 최소 수: 상단 1 + 중간 (2단 1 · 3단 1 · 4단 2)
 *   · 박스 소 60 · 중 120 · 대 180, 레일 여유 언더 +40 (30/10) · 볼 +20 (10/10)
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { DRAWER_RULES, layoutDrawerModule, layoutByGrades, distributeFronts, frontAreaOf, channelCountFor,
  assignChannels, pickBox, railLengthFor, drawerBoxDims } = require(path.join(ROOT, 'js/detaildesign/bom-drawer-rules.js'));

const drawers = (n) => Array.from({ length: n }, () => ({ kind: 'drawer' }));
const lay = (n, rail = 'under', H = 758) => layoutDrawerModule({ H, T: 15, fronts: drawers(n), rail });

describe('목찬넬 최소 배치', () => {
  test('상단은 항상, 중간은 아래에서 위로 짝지어 최소 수', () => {
    expect(assignChannels(1)).toEqual([]);
    expect(assignChannels(2)).toEqual([true]);
    expect(assignChannels(3)).toEqual([false, true]);
    expect(assignChannels(4)).toEqual([true, false, true]);
  });

  test('단수별 목찬넬 수 1 · 2 · 2 · 3 (상단 포함)', () => {
    expect([1, 2, 3, 4].map((n) => lay(n).channels.length)).toEqual([1, 2, 2, 3]);
  });

  test('중간 따내기는 90×40, 전면판 72 · 상단은 70×40, 전면판 52', () => {
    const L = lay(2);
    expect(L.channels[0]).toMatchObject({ kind: 'top', y: 0, notchH: 70, notchD: 40, faceH: 52, baseW: 40 });
    expect(L.channels[1]).toMatchObject({ kind: 'mid', notchH: 90, notchD: 40, faceH: 72, baseW: 40 });
    expect(DRAWER_RULES.CHANNEL_MID_NOTCH_H).toBe(DRAWER_RULES.CHANNEL_MID_FACE_H + DRAWER_RULES.CHANNEL_T);
    expect(DRAWER_RULES.CHANNEL_TOP_NOTCH_H).toBe(DRAWER_RULES.CHANNEL_TOP_FACE_H + DRAWER_RULES.CHANNEL_T);
  });

  test('위 전면은 중간 따내기 윗선보다 20 내려오고, 아래 전면은 그 30 아래에서 시작한다', () => {
    const L = lay(2);
    const mid = L.channels[1];
    expect(L.fronts[0].y1).toBe(mid.y + DRAWER_RULES.UPPER_DROP);
    expect(L.fronts[1].y0).toBe(mid.y + DRAWER_RULES.UPPER_DROP + DRAWER_RULES.MID_SLOT);
  });
});

describe('전면 높이 · 존 · 박스 (도면과 같은 숫자)', () => {
  test('균등 배분 전면: 728 · 349/349 · 231/231/232 · 166×4, 합이 몸통을 닫는다', () => {
    const fronts = (n) => lay(n).fronts.map((f) => f.h);
    expect(fronts(1)).toEqual([728]);
    expect(fronts(2)).toEqual([349, 349]);
    expect(fronts(3)).toEqual([231, 231, 232]);
    expect(fronts(4)).toEqual([166, 166, 166, 166]);
    [1, 2, 3, 4].forEach((n) => {
      const L = lay(n);
      const last = L.fronts[L.fronts.length - 1];
      expect(last.y1).toBe(758);
    });
  });

  test('존 높이: 673 · 289/294 · 193/213/177 · 106/128/148/111', () => {
    const zones = (n) => lay(n).fronts.map((f) => f.zone.h);
    expect(zones(1)).toEqual([673]);
    expect(zones(2)).toEqual([289, 294]);
    expect(zones(3)).toEqual([193, 213, 177]);
    expect(zones(4)).toEqual([106, 128, 148, 111]);
  });

  test('언더레일(+40) 박스: 대 · 대대 · 중중중 · 소소소소', () => {
    const boxes = (n) => lay(n, 'under').boxes.map((b) => b.h);
    expect(boxes(1)).toEqual([180]);
    expect(boxes(2)).toEqual([180, 180]);
    expect(boxes(3)).toEqual([120, 120, 120]);
    expect(boxes(4)).toEqual([60, 60, 60, 60]);
  });

  test('볼레일(+20) 박스: 3단 가운데가 대, 4단 셋째가 중', () => {
    expect(lay(3, 'ball').boxes.map((b) => b.h)).toEqual([120, 180, 120]);
    expect(lay(4, 'ball').boxes.map((b) => b.h)).toEqual([60, 60, 120, 60]);
  });

  test('pickBox 는 존에 박스+여유가 들어가는 가장 큰 것, 없으면 소 + fits:false', () => {
    expect(pickBox(220, 'under')).toMatchObject({ size: 'large', fits: true });
    expect(pickBox(219, 'under')).toMatchObject({ size: 'medium', fits: true });
    expect(pickBox(200, 'ball')).toMatchObject({ size: 'large', fits: true });
    expect(pickBox(99, 'under')).toMatchObject({ size: 'small', fits: false });
    expect(pickBox(100, 'under')).toMatchObject({ size: 'small', fits: true });
  });

  test('모르는 레일 값은 기본(언더레일)', () => {
    expect(layoutDrawerModule({ H: 758, T: 15, fronts: drawers(1), rail: 'x' }).rail).toBe('under');
  });
});

describe('도어 + 하부 서랍 (플래너 doorTopDrawerBottom 기본형)', () => {
  test('도어가 남는 높이를 갖고, 도어–서랍 사이에 중간 목찬넬 하나', () => {
    const L = layoutDrawerModule({ H: 758, T: 15, fronts: [{ kind: 'door' }, { kind: 'drawer', h: 200 }], rail: 'under' });
    expect(L.fronts.map((f) => [f.kind, f.h])).toEqual([['door', 498], ['drawer', 200]]);
    expect(L.midCount).toBe(1);
    // 존 = 중간 따내기 바닥(S+90) ~ 지판 윗면(743): S = 528−20 = 508 → 598..743 = 145 → 언더 소 / 볼 중
    expect(L.fronts[1].zone).toEqual({ top: 598, bottom: 743, h: 145 });
    expect(L.boxes[0]).toMatchObject({ size: 'small', h: 60, fits: true });
    const B = layoutDrawerModule({ H: 758, T: 15, fronts: [{ kind: 'door' }, { kind: 'drawer', h: 200 }], rail: 'ball' });
    expect(B.boxes[0]).toMatchObject({ size: 'medium', h: 120 });
  });

  test('서랍이 4단을 넘으면 4단으로 자르고 경고한다', () => {
    const L = lay(6);
    expect(L.fronts).toHaveLength(4);
    expect(L.warnings.some((w) => /최대 4단/.test(w))).toBe(true);
  });

  test('고정 전면이 몸통을 넘치면 경고한다', () => {
    const L = layoutDrawerModule({ H: 758, T: 15, fronts: [{ kind: 'door' }, ...Array.from({ length: 4 }, () => ({ kind: 'drawer', h: 200 }))] });
    expect(L.warnings.some((w) => /부족/.test(w))).toBe(true);
  });
});

describe('전면 배분식 (2026-09-16 확정) — 배치 높이를 버줌으로 나눈다', () => {
  // 전면 영역 = (배치 H − 상판) − 받침보정 − 30 × 목찬넬 개수
  // 각 전면   = 영역 × 버줌 ÷ Σ버줌          버줌 소 1 · 중 2 · 대 2
  const SINK = { areaH: 870, topT: 12, legH: 150, T: 15, rail: 'under' };
  const dr = (...g) => g.map((x) => ({ kind: 'drawer', grade: x }));

  test('버줌은 소 1 · 중 2 · 대 2 — 중과 대는 전면 높이가 같다', () => {
    expect(DRAWER_RULES.FRONT_WEIGHT).toEqual({ small: 1, medium: 2, large: 2 });
    const L = layoutByGrades(Object.assign({}, SINK, { fronts: dr('medium', 'large') }));
    const [a, b] = L.fronts.map((f) => f.h);
    expect(a).toBe(b);
  });

  test('목찬넬 개수는 전면 수가 정한다 — 상단 1 + 중간 최소 수', () => {
    expect([1, 2, 3, 4].map(channelCountFor)).toEqual([1, 2, 2, 3]);
  });

  test('영역 = (배치 870 − 상판 12) − 다리발 150 − 30×목찬넬', () => {
    expect(frontAreaOf({ areaH: 870, topT: 12, legH: 150, channelCount: 2 })).toMatchObject({ base: 858, support: 150, area: 648 });
    expect(frontAreaOf({ areaH: 870, topT: 12, legH: 150, channelCount: 3 }).area).toBe(618);
  });

  test('좌대가 있으면 받침보정 20 — 도어가 다리발·좌대를 40 덮는다', () => {
    const a = frontAreaOf({ areaH: 2300, topT: 0, legH: 60, pedestalH: 60, channelCount: 2 });
    expect(a).toMatchObject({ support: 20, base: 2300, area: 2220 });
  });

  test('사장님 예시 1:1:2 — 소·소·중 은 162 · 162 · 324, 합이 영역과 같다', () => {
    const L = layoutByGrades(Object.assign({}, SINK, { fronts: dr('small', 'small', 'medium') }));
    expect(L.front.area).toBe(648);
    expect(L.fronts.map((f) => f.h)).toEqual([162, 162, 324]);
    expect(L.fronts.reduce((s, f) => s + f.h, 0)).toBe(648);
  });

  test('도어도 배분에 끼는 전면이다 — 기본 대(2)', () => {
    expect(DRAWER_RULES.DOOR_GRADE_DEFAULT).toBe('large');
    const L = layoutByGrades(Object.assign({}, SINK, { fronts: [{ kind: 'door' }, ...dr('small', 'small')] }));
    expect(L.fronts.map((f) => [f.kind, f.h])).toEqual([['door', 324], ['drawer', 162], ['drawer', 162]]);
  });

  test('등급을 안 주면 기본 중 — 모두 같으면 균등 분배', () => {
    const L = layoutByGrades(Object.assign({}, SINK, { fronts: [{ kind: 'drawer' }, { kind: 'drawer' }, { kind: 'drawer' }] }));
    expect(L.fronts.map((f) => f.grade)).toEqual(['medium', 'medium', 'medium']);
    expect(L.fronts.map((f) => f.h)).toEqual([216, 216, 216]);
  });

  test('distributeFronts 는 배치·상판·받침·버줌만 보고 전면 높이를 낸다 (위치 계산 없이)', () => {
    const d = distributeFronts(Object.assign({}, SINK, { fronts: dr('small', 'small', 'medium') }));
    expect(d).toMatchObject({ areaH: 870, base: 858, support: 150, channelCount: 2, area: 648 });
    expect(d.fronts.map((f) => [f.grade, f.weight, f.h])).toEqual([['small', 1, 162], ['small', 1, 162], ['medium', 2, 324]]);
  });

  test('나머지 mm 는 마지막 전면이 먹는다 — 합이 영역과 어긋나지 않는다', () => {
    const L = layoutByGrades(Object.assign({}, SINK, { fronts: dr('small', 'small', 'small') }));
    expect(L.fronts.reduce((s, f) => s + f.h, 0)).toBe(L.front.area);
    expect(L.fronts.map((f) => f.h)).toEqual([216, 216, 216]);
  });

  test('배분식 경로는 목찬넬 없는 경계의 갭을 0 으로 둔다 — 식이 30×목찬넬만 뺀다', () => {
    const L = layoutByGrades(Object.assign({}, SINK, { fronts: dr('small', 'small', 'medium') }));
    // 전면 1 아래는 목찬넬이 없다 (assignChannels(3) = [false, true]) — 전면 2 가 바로 붙는다
    expect(L.fronts[0].channelBelow).toBeNull();
    expect(L.fronts[1].y0).toBe(L.fronts[0].y1);
    // 마지막 전면 밑단이 사용 높이(= 영역 + 슬롯)와 맞는다
    expect(L.fronts[L.fronts.length - 1].y1).toBe(858 - 150);
  });

  test('배치 높이가 모듈 높이보다 크면 배치 기준이다 — 한 런의 도어가 줄을 맞춘다', () => {
    const tall = layoutByGrades(Object.assign({}, SINK, { areaH: 900, fronts: dr('small', 'small') }));
    const low = layoutByGrades(Object.assign({}, SINK, { areaH: 870, fronts: dr('small', 'small') }));
    expect(tall.front.area - low.front.area).toBe(30);
  });

  test('배치 높이가 너무 낮으면 경고한다', () => {
    const L = layoutByGrades({ areaH: 100, topT: 12, legH: 150, T: 15, fronts: dr('small', 'small') });
    expect(L.warnings.some((w) => /전면 영역이/.test(w))).toBe(true);
  });
});

describe('최소 전면 높이 50 — 만들 수 없는 전면은 내지 않는다', () => {
  test('서랍 전면을 크게 주면 남는 도어가 쪼그라든다 — 경고한다', () => {
    // 몸통 708 에 서랍 200 × 3: 708 − 상단 30 − 중간 30×2 − 갭 4 − 600 = 도어 14
    const L = layoutDrawerModule({ H: 708, T: 15, fronts: [{ kind: 'door' }, ...Array.from({ length: 3 }, () => ({ kind: 'drawer', h: 200 }))] });
    expect(L.fronts[0].h).toBe(14);
    expect(L.warnings.some((w) => /최소 50 미만/.test(w))).toBe(true);
    expect(DRAWER_RULES.MIN_FRONT_H).toBe(50);
  });

  test('50 이상이면 최소 전면 경고가 없다 (박스 여유 경고는 별개다)', () => {
    const L = layoutDrawerModule({ H: 708, T: 15, fronts: [{ kind: 'door' }, ...Array.from({ length: 3 }, () => ({ kind: 'drawer', h: 150 }))] });
    expect(L.fronts[0].h).toBe(164);
    expect(L.warnings.some((w) => /최소 50 미만/.test(w))).toBe(false);
  });
});

describe('서랍 박스 치수 — 레일 종류·깊이·자재 두께·사쿠리 (2026-09-15 철물 규격)', () => {
  test('레일 길이 = 규격 중 깊이 − 50 이하의 최대', () => {
    expect(railLengthFor(550)).toBe(500);
    expect(railLengthFor(549)).toBe(450);
    expect(railLengthFor(500)).toBe(450);
    expect(railLengthFor(450)).toBe(400);
    expect(railLengthFor(350)).toBe(300);
    expect(railLengthFor(300)).toBe(250);
    expect(railLengthFor(299)).toBeNull();
  });

  test('언더레일 W800·D550·15T: 앞뒷판 728, 측판 490, 우라 757×489', () => {
    const d = drawerBoxDims({ W: 800, D: 550, bodyT: 15, rail: 'under', boxH: 120 });
    expect(d).toMatchObject({ railLength: 500, fbW: 800 - 30 - 30 - 12, fbH: 120, sideL: 490, sideH: 120, outerW: 758, bottomW: 757, bottomD: 489, brace: true });
  });

  test('볼레일 W800·D550·15T: 앞뒷판 712 (레일 두께 14×2), 측판 500, 우라 741×499', () => {
    const d = drawerBoxDims({ W: 800, D: 550, bodyT: 15, rail: 'ball', boxH: 120 });
    expect(d).toMatchObject({ railLength: 500, fbW: 800 - 30 - 28 - 30, sideL: 500, outerW: 742, bottomW: 741, bottomD: 499, brace: true });
  });

  test('서랍 자재 18T 는 앞뒷판에서 36 을 뺀다 (몸통 15T 그대로)', () => {
    const d = drawerBoxDims({ W: 600, D: 550, bodyT: 15, drawerT: 18, rail: 'under', boxH: 60 });
    expect(d.fbW).toBe(600 - 30 - 36 - 12);
    expect(d.outerW).toBe(d.fbW + 36);
    expect(d.brace).toBe(false);
  });

  test('사쿠리: 앞뒷판 높이 −18, 우라 가로 = 앞뒷판 + 20, 세로 = 측판 − 1', () => {
    const d = drawerBoxDims({ W: 600, D: 550, bodyT: 15, rail: 'under', boxH: 120, sakuri: true });
    expect(d.fbH).toBe(102);
    expect(d.sideH).toBe(120);
    expect(d.bottomW).toBe(d.fbW + 20);
    expect(d.bottomD).toBe(d.sideL - 1);
  });

  test('깊이가 너무 얕으면 가장 짧은 레일에 경고', () => {
    const d = drawerBoxDims({ W: 600, D: 280, bodyT: 15, rail: 'ball', boxH: 60 });
    expect(d.railLength).toBe(250);
    expect(d.warnings.length).toBe(1);
  });
});

describe('BOM 적용 (extractors.js)', () => {
  global.dlog = () => {};
  const { MaterialExtractor, HardwareExtractor, BOM_PART_DEFS } = require(path.join(ROOT, 'js/detaildesign/extractors.js'));
  const specs = {
    layoutShape: 'I', bodyThickness: 15, lowerH: 870, upperH: 720, sinkLegHeight: 150, topThickness: 12, moldingH: 60,
    upperDoorOverlap: 15, handle: '찬넬 (목찬넬)', topSizes: [{ w: '2400', d: '650' }],
  };
  const itemOf = (modules) => ({ uniqueId: 1, categoryId: 'sink', name: '싱크대', w: 2400, h: 2310, d: 650, specs, modules });
  const rowsOf = (modules, label) => new MaterialExtractor().extract({ items: [itemOf(modules)] }).materials.filter((m) => m.module === label);

  test('도어 1 + 서랍 2단 (W800·H708): 전면 3장, 박스 중·소, 중간 목찬넬 1, 하단보강', () => {
    const rows = rowsOf([{ id: 'l2', type: 'storage', name: '서랍장', pos: 'lower', w: 800, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 2 }], '하부장-서랍장');
    const pick = (part) => rows.filter((r) => r.part === part).map((r) => [r.w, r.h, r.qty]);
    // 전면: 도어 244 (708 − 30 − 200 − 30 − 200 − 4), 서랍도어 200 × 2 → 합 = 몸통
    expect(pick('도어')).toEqual([[796, 244, 1]]);
    expect(pick('서랍도어')).toEqual([[796, 200, 2]]); // 같은 높이는 한 행
    expect(30 + 244 + 4 + 200 + 30 + 200).toBe(708);
    // 박스: 서랍 1 은 존 (경계~중간 따내기 윗선) 중 120, 서랍 2 는 존 (따내기 바닥~지판) 소 60
    // 언더레일 D550: 레일 500 → 측판 490, 앞뒷판 W − 30 − 30 − 12 = 728, 우라 757 × 489, 하단보강 (728 > 600)
    expect(pick('서랍전후판')).toEqual([[728, 120, 2], [728, 60, 2]]);
    expect(pick('서랍측판')).toEqual([[490, 120, 2], [490, 60, 2]]);
    expect(pick('서랍밑판')).toEqual([[757, 489, 2]]);
    expect(pick('서랍 하단보강')).toEqual([[490, 60, 2]]);
    expect(rows.find((r) => r.part === '서랍측판').note).toMatch(/댐핑 언더레일 500/);
    // 중간 목찬넬 (서랍 1–2 사이) — 전면판 72 · 지면판 40, 모듈 폭
    expect(pick('목찬넬(중간 전면)')).toEqual([[72, 800, 1]]);
    expect(pick('목찬넬(중간 지면)')).toEqual([[40, 800, 1]]);
    expect(rows.some((r) => r.part === '목찬넬')).toBe(false);
    // 측판 비고에 따내기 가공
    expect(rows.find((r) => r.part === '측판').note).toBe('목찬넬 따내기 상단 70×40 + 중간 90×40 ×1');
  });

  test('서랍만 4단 (doorCount 0): 서랍도어 4, 중간 목찬넬 2, 소 박스 8장', () => {
    const rows = rowsOf([{ id: 'l3', type: 'storage', name: '서랍장4', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 0, isDrawer: true, drawerCount: 4 }], '하부장-서랍장4');
    expect(rows.filter((r) => r.part === '서랍도어').reduce((n, r) => n + r.qty, 0)).toBe(4);
    expect(rows.some((r) => r.part === '도어')).toBe(false);
    expect(rows.find((r) => r.part === '목찬넬(중간 전면)').qty).toBe(2);
    expect(rows.find((r) => r.part === '서랍전후판')).toMatchObject({ h: 60, qty: 8 });
    expect(rows.find((r) => r.part === '측판').note).toMatch(/중간 90×40 ×2/);
  });

  test('볼레일 + 사쿠리 + 서랍 18T: 앞뒷판 가로·높이, 측판 500, 우라가 규격대로', () => {
    const rows = rowsOf([{ id: 'l5', type: 'storage', name: '서랍장B', pos: 'lower', w: 600, h: 758, d: 550, doorCount: 0, isDrawer: true, drawerCount: 2,
      drawerRail: 'ball', drawerBoxT: 18, drawerSakuri: true, drawerFronts: [241, 483] }], '하부장-서랍장B');
    const pick = (part) => rows.filter((r) => r.part === part).map((r) => [r.w, r.h, r.qty, r.thickness]);
    // 윗칸 존 = 상단 따내기 바닥 70 ~ 중간 따내기 윗선 251 = 181 → 볼레일 +20: 중 120 ; 아랫칸 존 294 → 대 180
    expect(pick('서랍측판')).toEqual([[500, 120, 2, 18], [500, 180, 2, 18]]);
    expect(pick('서랍전후판')).toEqual([[600 - 30 - 28 - 36, 102, 2, 18], [600 - 30 - 28 - 36, 162, 2, 18]]);
    expect(pick('서랍밑판')).toEqual([[600 - 30 - 28 - 36 + 20, 499, 2, 2.7]]);
  });

  test('50 미만 도어는 부재로 내지 않는다 (옛 규칙 hingeDoorH > 50)', () => {
    const rows = rowsOf([{ id: 'l7', type: 'storage', name: '서랍장T', pos: 'lower', w: 1200, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 3, drawerHeight: 200 }], '하부장-서랍장T');
    expect(rows.filter((r) => r.part === '도어')).toEqual([]);            // 도어 14 는 나가지 않는다
    expect(rows.filter((r) => r.part === '서랍도어')[0]).toMatchObject({ h: 200, qty: 3 });
    // 서랍 전면을 줄이면 도어가 살아난다
    const ok = rowsOf([{ id: 'l8', type: 'storage', name: '서랍장U', pos: 'lower', w: 1200, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 2, drawerHeight: 200 }], '하부장-서랍장U');
    expect(ok.find((r) => r.part === '도어')).toMatchObject({ h: 244, qty: 1 });
  });

  test('배치 높이를 알면 배분식으로 전면을 낸다 (areaH·heightParts·drawer.grades)', () => {
    const mod = {
      id: 'lg', type: 'storage', name: '배분', pos: 'lower', w: 1200, h: 708, d: 550,
      doorCount: 0, isDrawer: true, drawerCount: 3,
      areaH: 870, totalH: 870, heightParts: { legH: 150, topT: 12 },
      drawer: { grades: ['small', 'small', 'medium'] },
    };
    const rows = rowsOf([mod], '하부장-배분').filter((r) => r.part === '서랍도어');
    expect(rows.map((r) => [r.h, r.qty])).toEqual([[162, 2], [324, 1]]);
  });

  test('도어 + 서랍이면 도어도 배분에 낀다 (기본 대)', () => {
    const mod = {
      id: 'lh', type: 'storage', name: '배분도어', pos: 'lower', w: 1200, h: 708, d: 550,
      doorCount: 1, isDrawer: true, drawerCount: 2,
      areaH: 870, totalH: 870, heightParts: { legH: 150, topT: 12 },
      drawer: { grades: ['small', 'small'] },
    };
    const rows = rowsOf([mod], '하부장-배분도어');
    expect(rows.find((r) => r.part === '도어')).toMatchObject({ h: 324, qty: 1 });
    expect(rows.find((r) => r.part === '서랍도어')).toMatchObject({ h: 162, qty: 2 });
  });

  test('배치·모듈 높이를 모르면 옛 경로 그대로 (골든 픽스처가 이 경우다)', () => {
    const rows = rowsOf([{ id: 'li', type: 'storage', name: '옛경로', pos: 'lower', w: 800, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 2 }], '하부장-옛경로');
    expect(rows.find((r) => r.part === '도어')).toMatchObject({ h: 244, qty: 1 });
    expect(rows.find((r) => r.part === '서랍도어')).toMatchObject({ h: 200, qty: 2 });
  });

  test('mod.drawer 블록(레일·사쿠리·boxT)이 평면 필드보다 먼저다 — 브리지가 넘기는 모양', () => {
    const rows = rowsOf([{ id: 'l6', type: 'storage', name: '서랍장D', pos: 'lower', w: 600, h: 758, d: 550, doorCount: 0, isDrawer: true, drawerCount: 2,
      drawer: { rail: 'ball', sakuri: true, boxT: 18 }, drawerRail: 'under', drawerFronts: [241, 483] }], '하부장-서랍장D');
    const side = rows.filter((r) => r.part === '서랍측판');
    expect(side.map((r) => [r.w, r.thickness])).toEqual([[500, 18], [500, 18]]);   // 볼레일 500, 서랍 18T
    expect(rows.find((r) => r.part === '서랍전후판').h).toBe(120 - 18);               // 사쿠리 −18
    const hw = new HardwareExtractor().extract({ items: [itemOf([{ id: 'l6', type: 'storage', name: 'D', pos: 'lower', w: 600, h: 758, d: 550, isDrawer: true, drawerCount: 2, drawer: { rail: 'ball' } }])] })
      .hardware.filter((h) => h.category === '레일');
    expect(hw[0].item).toBe('댐핑 볼레일');
  });

  test('drawerFronts 로 전면 높이를 지정하면 그대로 쓴다', () => {
    const rows = rowsOf([{ id: 'l4', type: 'storage', name: '서랍장F', pos: 'lower', w: 600, h: 758, d: 550, doorCount: 0, isDrawer: true, drawerCount: 2, drawerFronts: [241, 483] }], '하부장-서랍장F');
    expect(rows.filter((r) => r.part === '서랍도어').map((r) => r.h)).toEqual([241, 483]);
  });

  test('중간 목찬넬 부재는 손잡이 슬롯으로 식별된다', () => {
    expect(BOM_PART_DEFS['목찬넬(중간 전면)']).toEqual({ key: 'channel:mid-front', slot: 'handle' });
    expect(BOM_PART_DEFS['목찬넬(중간 지면)']).toEqual({ key: 'channel:mid-back', slot: 'handle' });
  });

  test('레일: 단수만큼, 종류는 drawerRail (기본 댐핑 언더레일 · ball → 댐핑 볼레일), 길이는 깊이별', () => {
    const hw = new HardwareExtractor().extract({ items: [itemOf([
      { id: 'a', type: 'storage', name: 'A', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 3 },
      { id: 'b', type: 'storage', name: 'B', pos: 'lower', w: 600, h: 708, d: 450, doorCount: 0, isDrawer: true, drawerCount: 2, drawerRail: 'ball' },
      { id: 'c', type: 'storage', name: 'C', pos: 'lower', w: 600, h: 708, d: 550, doorCount: 1, isDrawer: true, drawerCount: 7 },
    ])] }).hardware.filter((h) => h.category === '레일');
    // 길이 = 규격 중 깊이 − 50 이하 최대: D550 → 500, D450 → 400
    expect(hw.map((h) => [h.item, h.spec, h.qty, h.note])).toEqual([
      ['댐핑 언더레일', '500mm', 3, 'A'],
      ['댐핑 볼레일', '400mm', 2, 'B · 두께 14'],
      ['댐핑 언더레일', '500mm', 4, 'C'],
    ]);
  });
});
