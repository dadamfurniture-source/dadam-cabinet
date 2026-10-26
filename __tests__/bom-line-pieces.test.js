/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, global, describe, test, expect */
/**
 * 상몰딩 · 걸레받이 · 목찬넬 EP 조각 — 2026-10-26 사장님 확정.
 *   "상몰딩, 걸레받이, 목찬넬은 자동으로 최대 2400, 최소 1000 이상, 최대 길이로 하되 최소 길이 조건은 맞추어야함."
 *   "자르는 건 모듈길이별로 잘라야해, 예) 600장 +500 이라면 1100으로 잘라서 넣어야함. 그리고 최소 길이는 800이상으로 변경해줘."
 *   "800 보다 짧으면 그 길이 그대로 내는게 아니라 최소 800이상의 길이가 되어야한다는 거지"
 *   깊이가 다른 키큰장 사이 · 신발장 · 수납장 — "상몰딩, 걸레받이, 목찬넬 조건 적용".
 * 자리(벽마다 · 실제로 붙는 길이) → 단위(모듈 · 후드 · 이은 빈 자리 · 이은 키큰장) → 조각(모듈 경계, 800~2400, 장 수 최소 · 앞 조각 최대).
 * 정본: js/detaildesign/assembly-rules.js linePiecesOf · extractors.js bomLinePlacesOf / bomSinkMoldingPlanOf / linePlanOf · bom-assembly.js runsOf.
 */
global.dlog = global.dlog || (() => {});
const Rules = require('../js/detaildesign/assembly-rules.js');
const Asm = require('../js/detaildesign/bom-assembly.js');
const {
  MaterialExtractor, HardwareExtractor, BOM_LINE_PIECE_SITE_NOTE, BOM_LINE_PIECE_CHECK_NOTE,
} = require('../js/detaildesign/extractors.js');

const SPLIT = '2400 넘으면 모듈 경계에서 나눔 (조각 800~2400)';
const SITE = BOM_LINE_PIECE_SITE_NOTE;
const CHECK = BOM_LINE_PIECE_CHECK_NOTE;

/** 조각 요약 — 붙는 길이, 800 보다 짧아 800 으로 내면 '600→800', 모듈 안에서 자르면 '!' */
const piecesOf = (units) => Rules.linePiecesOf(units).pieces.map((p) => `${p.len}${p.site ? `→${p.order}` : ''}${p.inside ? '!' : ''}`);

describe('조각 나누기 (assembly-rules.js linePiecesOf)', () => {
  test('사장님 예: 600 · 600 · 600 · 600 · 500 → 1800 + 1100 (2400 + 500 이 아니다)', () => {
    expect(piecesOf([600, 600, 600, 600, 500])).toEqual(['1800', '1100']);
  });
  test('600 × 4 + 900 → 2400 + 900 (앞 조각이 가장 길게)', () => {
    expect(piecesOf([600, 600, 600, 600, 900])).toEqual(['2400', '900']);
  });
  test('2400 이하는 한 장 — 800 이면 그대로, 800 보다 짧으면 800 으로 낸다 (붙는 길이는 그대로)', () => {
    expect(piecesOf([800])).toEqual(['800']);
    expect(piecesOf([1200, 1200])).toEqual(['2400']);
    expect(piecesOf([600])).toEqual(['600→800']);
    const p = Rules.linePiecesOf([600]).pieces[0];
    expect(p).toMatchObject({ len: 600, order: 800, from: 0, to: 600, site: true, inside: false });
  });
  test('모듈 경계로 800~2400 을 못 맞추면 2400 이하 최소 장수 — 남는 짧은 조각은 800 으로 (2400 + 500 → 2400 + 800)', () => {
    expect(piecesOf([2400, 500])).toEqual(['2400', '500→800']);
    expect(Rules.linePiecesOf([2400, 500]).fallback).toBe(true);
  });
  test('2400 을 넘는 단위는 그 안에서 2400 마다 자른다 — inside (BOM 비고 [확인 필요])', () => {
    expect(piecesOf([2600, 900])).toEqual(['2400!', '1100!']);
    expect(piecesOf([900, 2600, 900])).toEqual(['900', '2400!', '1100!']);
    expect(piecesOf([4080])).toEqual(['2400!', '1680!']);
  });
  test('붙는 길이 합 = 자리 길이 (누적 경계를 한 번 반올림)', () => {
    const r = Rules.linePiecesOf([832.5, 832.5, 416, 900]);
    expect(r.total).toBe(2981);
    expect(r.pieces.reduce((s, p) => s + p.len, 0)).toBe(2981);
  });
});

// ── 플래너 브리지처럼 자리(_place)를 단 모듈 ────────────────────────────────
//   벽 A = 앞면 [0, 1] (x 로 뻗는다), 벽 B = 앞면 [−1, 0] (y 로 뻗는다). x = 벽 위 왼쪽 끝 (진행 방향 mm)
const SPECS = {
  layoutShape: 'I', topThickness: 12, bodyThickness: 15, lowerH: 870, upperH: 720, moldingH: 60, sinkLegHeight: 150,
  handle: '찬넬 (목찬넬)', upperDoorOverlap: 15,
};
const place = (m, wall, x, z0, h) => {
  const c = x + m.w / 2;
  const d = Number(m.d) || 0;
  m._place = Object.assign(wall === 'B' ? { cx: -d / 2, cy: c, run: [0, 1], front: [-1, 0] } : { cx: c, cy: d / 2, run: [1, 0], front: [0, 1] },
    { w: m.w, d, z0, h });
  return m;
};
const upper = (id, w, x, wall) => place({ id, type: 'storage', name: '상부장', pos: 'upper', w, h: 720, d: 295, doorCount: w > 600 ? 2 : 1, shelfCount: 2 }, wall || 'A', x, 1530, 780);
const hood = (id, w, x) => place({ id, type: 'hood', name: '후드', pos: 'upper', w, h: 720, d: 295 }, 'A', x, 1530, 780);
const lower = (id, w, x, wall) => place({ id, type: 'storage', name: '하부장', pos: 'lower', w, h: 708, d: 550, doorCount: w > 600 ? 2 : 1, shelfCount: 1 }, wall || 'A', x, 0, 870);
/** 단 정보가 없는 통짜 키큰장 (좌대 · 상몰딩 모두 — sink.md §5.1). d 가 상부장(295)과 다르면 상몰딩을 잇지 않는다 */
const tall = (id, w, x, d) => place({ id, type: 'tall', name: '키큰장', pos: 'lower', w, h: 2190, d: d || 550, doorCount: 2, shelfCount: 4 }, 'A', x, 0, 2310);
const sinkItem = (modules, specs) => ({ categoryId: 'sink', w: 4200, h: 2310, d: 650, specs: Object.assign({}, SPECS, specs || {}), modules });

const extract = (item) => new MaterialExtractor().extract({ items: [item] }).materials;
/** ep 행 [길이, 수량, 비고] — 상몰딩 · 목찬넬은 h 가 길이, 걸레받이는 w */
const epRows = (rows, part) => rows.filter((r) => r.part === part && /^0-ep-/.test(r.partId))
  .map((r) => [part === '걸레받이' ? r.w : r.h, r.qty, r.note]);

describe('상몰딩 — 자리마다 모듈 경계 조각 (싱크)', () => {
  test('상부 600 · 600 · 600 · 600 · 500 한 줄 → 1800 + 1100', () => {
    const rows = extract(sinkItem([upper('u1', 600, 0), upper('u2', 600, 600), upper('u3', 600, 1200), upper('u4', 600, 1800), upper('u5', 500, 2400)]));
    expect(epRows(rows, '상몰딩')).toEqual([[1800, 1, SPLIT], [1100, 1, SPLIT]]);
  });

  test('상부 600 × 4 + 900 → 2400 + 900', () => {
    const rows = extract(sinkItem([upper('u1', 600, 0), upper('u2', 600, 600), upper('u3', 600, 1200), upper('u4', 600, 1800), upper('u5', 900, 2400)]));
    expect(epRows(rows, '상몰딩')).toEqual([[2400, 1, SPLIT], [900, 1, SPLIT]]);
  });

  test('800 보다 짧은 자리 — 상부장 600 하나는 800 한 장으로 내고 현장에서 자른다 (800 하나는 그대로 800)', () => {
    expect(epRows(extract(sinkItem([upper('u1', 600, 0)])), '상몰딩')).toEqual([[800, 1, SITE]]);
    expect(epRows(extract(sinkItem([upper('u1', 800, 0)])), '상몰딩')).toEqual([[800, 1, '']]);
  });

  test('후드 · 빈 자리는 단위 — 900 · 후드 800 · 빈 자리 500 · 900 (3100) → 2200 (빈 자리 끝까지) + 900', () => {
    const rows = extract(sinkItem([upper('u1', 900, 0), hood('h1', 800, 900), upper('u2', 900, 2200)]));
    expect(epRows(rows, '상몰딩')).toEqual([[2200, 1, SPLIT], [900, 1, SPLIT]]);
  });

  test('깊이가 다른 키큰장(550)이 상부장 사이에 서면 양옆이 다른 자리 — 1200 · 1200 → 1200 두 장 (예전 2400 한 행)', () => {
    const rows = extract(sinkItem([upper('u1', 1200, 0), tall('t1', 600, 1200), upper('u2', 1200, 1800)]));
    expect(epRows(rows, '상몰딩')).toEqual([[1200, 2, '자리 2곳 · 자리마다 한 장']]);
    expect(rows.filter((r) => r.part === '상몰딩' && r.moduleKey === '0-t1').map((r) => [r.w, r.h])).toEqual([[60, 600]]);   // 키큰장 제 상몰딩
  });

  test('깊이가 다른 키큰장 양옆이 600 · 1200 → 800 (현장에서 자름) + 1200', () => {
    const rows = extract(sinkItem([upper('u1', 600, 0), tall('t1', 600, 600), upper('u2', 1200, 1200)]));
    expect(epRows(rows, '상몰딩')).toEqual([[1200, 1, '자리 2곳 · 자리마다 한 장'], [800, 1, `자리 2곳 · 자리마다 한 장 · ${SITE}`]]);
  });

  test('ㄱ자 상부 두 벽 — 벽마다 자리 (벽 A 1500, 벽 B 600 · 1200 · 900 = 2700 → 1800 + 900)', () => {
    const rows = extract(sinkItem([upper('a1', 900, 0), upper('a2', 600, 900),
      upper('b1', 600, 0, 'B'), upper('b2', 1200, 600, 'B'), upper('b3', 900, 1800, 'B')]));
    expect(epRows(rows, '상몰딩')).toEqual([[1800, 1, `벽 2개 · ${SPLIT}`], [1500, 1, `벽 2개 · ${SPLIT}`], [900, 1, `벽 2개 · ${SPLIT}`]]);
  });
});

describe('걸레받이 · 목찬넬 — 하부 라인 자리 (키큰장 · 빈 자리에서 따로)', () => {
  test('하부 라인 사이에 키큰장이 서면 양옆이 다른 자리 — 1200 | 키큰장 | 900 → 1200 · 900 (예전 2100 한 장)', () => {
    const rows = extract(sinkItem([lower('l1', 600, 0), lower('l2', 600, 600), tall('t1', 600, 1200), lower('l3', 900, 1800)]));
    const NOTE = '자리 2곳 · 자리마다 한 장';
    expect(epRows(rows, '걸레받이')).toEqual([[1200, 1, NOTE], [900, 1, NOTE]]);
    expect(epRows(rows, '목찬넬(전면)')).toEqual([[1200, 1, NOTE], [900, 1, NOTE]]);
    expect(epRows(rows, '목찬넬(지면)')).toEqual([[1200, 1, NOTE], [900, 1, NOTE]]);
    // 키큰장 단의 좌대 걸레받이 · 목찬넬은 그대로 (모듈 행)
    expect(rows.filter((r) => r.moduleKey === '0-t1' && /걸레받이|목찬넬/.test(r.part)).map((r) => [r.part, r.w, r.h])).toEqual([
      ['목찬넬(전면)', 52, 600], ['목찬넬(지면)', 40, 600], ['좌대 걸레받이', 60, 600]]);
  });

  test('하부장 사이가 비면(300) 다른 자리 — 1200 · 빈 자리 · 1000 → 1200 · 1000', () => {
    const rows = extract(sinkItem([lower('l1', 600, 0), lower('l2', 600, 600), lower('l3', 1000, 1500)]));
    const NOTE = '자리 2곳 · 자리마다 한 장';
    expect(epRows(rows, '걸레받이')).toEqual([[1200, 1, NOTE], [1000, 1, NOTE]]);
    expect(epRows(rows, '목찬넬(전면)')).toEqual([[1200, 1, NOTE], [1000, 1, NOTE]]);
  });

  test('한쪽 자리가 800 보다 짧으면 800 으로 낸다 — 1200 | 키큰장 | 600 → 1200 + 800 (현장에서 자름)', () => {
    const rows = extract(sinkItem([lower('l1', 1200, 0), tall('t1', 600, 1200), lower('l2', 600, 1800)]));
    expect(epRows(rows, '걸레받이')).toEqual([[1200, 1, '자리 2곳 · 자리마다 한 장'], [800, 1, `자리 2곳 · 자리마다 한 장 · ${SITE}`]]);
  });

  test('ㄱ자 두 벽 — 벽 A 900 × 3 (2700 → 1800 + 900), 벽 B 1000 · 500 (1500)', () => {
    const rows = extract(sinkItem([lower('a1', 900, 0), lower('a2', 900, 900), lower('a3', 900, 1800),
      lower('b1', 1000, 0, 'B'), lower('b2', 500, 1000, 'B')]));
    const NOTE = `벽 2개 · ${SPLIT}`;
    expect(epRows(rows, '걸레받이')).toEqual([[1800, 1, NOTE], [1500, 1, NOTE], [900, 1, NOTE]]);
    expect(epRows(rows, '목찬넬(전면)')).toEqual([[1800, 1, NOTE], [1500, 1, NOTE], [900, 1, NOTE]]);
  });

  test('모듈 경계로 못 맞추는 자리 (2400 + 500) → 2400 + 800 (남는 조각은 800 으로, [확인 필요] 없음)', () => {
    const rows = extract(sinkItem([lower('l1', 2400, 0), lower('l2', 500, 2400)]));
    expect(epRows(rows, '걸레받이')).toEqual([[2400, 1, SPLIT], [800, 1, `${SPLIT} · ${SITE}`]]);
  });

  test('2400 을 넘는 단위는 모듈 안에서 자른다 — [확인 필요] (2600 · 900 → 2400 + 1100)', () => {
    const rows = extract(sinkItem([lower('l1', 2600, 0), lower('l2', 900, 2600)]));
    expect(epRows(rows, '걸레받이')).toEqual([[2400, 1, `${SPLIT} · ${CHECK}`], [1100, 1, `${SPLIT} · ${CHECK}`]]);
  });

  test('걸레받이카바 개수는 그대로 — 자재 행 전체 길이 ÷ 2400 올림', () => {
    const item = sinkItem([lower('l1', 600, 0), lower('l2', 600, 600), lower('l3', 600, 1200), lower('l4', 600, 1800), lower('l5', 500, 2400)]);
    const rows = extract(item);
    expect(epRows(rows, '걸레받이').map((r) => r.slice(0, 2))).toEqual([[1800, 1], [1100, 1]]);
    const hw = new HardwareExtractor().extract({ items: [item] }).hardware;
    expect(hw.find((h) => h.category === '걸레받이카바').qty).toBe(Math.ceil(2900 / 2400));
  });
});

describe('신발장 · 수납장 (extractSimpleBox) — "상몰딩, 걸레받이, 목찬넬 조건 적용"', () => {
  const simple = (categoryId, modules) => ({ categoryId, w: 3000, h: 2310, d: 350, specs: Object.assign({}, SPECS, { upperH: 720 }), modules });
  test('신발장 상부 600 · 600 · 600 · 600 · 500 → 1800 + 1100, 하부 1200 | 빈 자리 | 600 → 1200 + 800 (현장에서 자름)', () => {
    const rows = extract(simple('shoerack', [
      upper('u1', 600, 0), upper('u2', 600, 600), upper('u3', 600, 1200), upper('u4', 600, 1800), upper('u5', 500, 2400),
      lower('l1', 600, 0), lower('l2', 600, 600), lower('l3', 600, 1500)]));
    expect(epRows(rows, '상몰딩')).toEqual([[1800, 1, SPLIT], [1100, 1, SPLIT]]);
    const NOTE = '자리 2곳 · 자리마다 한 장';
    expect(epRows(rows, '걸레받이')).toEqual([[1200, 1, NOTE], [800, 1, `${NOTE} · ${SITE}`]]);
    expect(epRows(rows, '목찬넬(전면)')).toEqual([[1200, 1, NOTE], [800, 1, `${NOTE} · ${SITE}`]]);
  });

  test('수납장 — 자리가 없는 옛 설계(상세설계 화면)는 배열 순서 한 자리, 키큰장 단이 사이에 서면 나눈다', () => {
    const strip = (m) => { delete m._place; return m; };
    const rows = extract(simple('storage', [
      strip(lower('l1', 900, 0)), strip(lower('l2', 900, 900)), strip(tall('t1', 600, 1800, 400)), strip(lower('l3', 900, 2400)),
      strip(upper('u1', 900, 0)), strip(upper('u2', 900, 900)), strip(upper('u3', 900, 1800))]));
    expect(epRows(rows, '상몰딩')).toEqual([[1800, 1, SPLIT], [900, 1, SPLIT]]);
    expect(epRows(rows, '걸레받이')).toEqual([[1800, 1, '자리 2곳 · 자리마다 한 장'], [900, 1, '자리 2곳 · 자리마다 한 장']]);
  });
});

describe('조립 명세 runsOf — BOM 과 같은 조각 · 같은 모듈 경계 이음매', () => {
  /** 벽 하나에 모듈 x (벽 시작 기준) — 자리(_place) 진행 방향과 같은 쪽 */
  const lineOf = (item) => [{ key: 'wall', D: 650, modules: item.modules.map((m) => ({ moduleKey: `0-${m.id}`, x0: m._place.cx - m.w / 2 })) }];
  const specOf = (item, lines) => {
    const design = { items: [item] };
    const materials = new MaterialExtractor().extract(design).materials;
    return { materials, s: Asm.of(design, { materials, lines: { 0: lines || lineOf(item) } }) };
  };
  const runsAt = (s, part) => s.items[0].runs.filter((r) => r.parts[0].part === part)
    .map((r) => [r.parts[0].id, r.hostModuleKey, r.parts[0].cut.w, r.parts[0].cut.h, r.parts[0].box.min[0], r.parts[0].box.max[0]]);
  const epUnplaced = (s) => s.unplaced.filter((u) => /-ep$/.test(u.moduleKey) && /상몰딩|걸레받이|목찬넬/.test(u.part));

  test('상몰딩 1800 + 1100 — 이음매는 u3 · u4 경계 (벽 x 1800), 두 조각 모두 호스트 u1', () => {
    const { s } = specOf(sinkItem([upper('u1', 600, 0), upper('u2', 600, 600), upper('u3', 600, 1200), upper('u4', 600, 1800), upper('u5', 500, 2400)]));
    expect(runsAt(s, '상몰딩')).toEqual([['0-ep-molding-0#0', '0-u1', 60, 1800, -300, 1500], ['0-ep-molding-1#0', '0-u1', 60, 1100, 1500, 2600]]);
    // 하부 모듈이 없는 품목이라 걸레받이 · 목찬넬은 옛 설계처럼 품목 폭 − 120 한 단위 (모듈이 없어 명세 자리 미정) — 여기서는 상몰딩만 본다
    expect(epUnplaced(s).filter((u) => u.part === '상몰딩')).toEqual([]);
  });

  test('깊이가 다른 키큰장 양옆 — 두 자리를 따로 놓는다 (1200 #0 · #1, 키큰장 자리는 건너지 않는다)', () => {
    const { s } = specOf(sinkItem([upper('u1', 1200, 0), tall('t1', 600, 1200), upper('u2', 1200, 1800)]));
    expect(runsAt(s, '상몰딩')).toEqual([['0-ep-molding-0#0', '0-u1', 60, 1200, -600, 600], ['0-ep-molding-0#1', '0-u2', 60, 1200, -600, 600]]);
  });

  test('걸레받이 · 목찬넬 — 하부 라인이 키큰장에서 나뉘면 자리마다 그 자리 첫 하부장이 호스트', () => {
    const { s } = specOf(sinkItem([lower('l1', 600, 0), lower('l2', 600, 600), tall('t1', 600, 1200), lower('l3', 900, 1800)]));
    expect(runsAt(s, '걸레받이')).toEqual([['0-ep-kick-0#0', '0-l1', 1200, 145, -300, 900], ['0-ep-kick-1#0', '0-l3', 900, 145, -450, 450]]);
    expect(runsAt(s, '목찬넬(전면)').map((r) => r.slice(0, 2))).toEqual([['0-ep-channel:front-0#0', '0-l1'], ['0-ep-channel:front-1#0', '0-l3']]);
    expect(epUnplaced(s)).toEqual([]);
  });

  test('현장에서 자르는 조각은 붙는 길이로 놓는다 — BOM 800 발주, 명세 재단 600 + tags.siteCut { order: 800 } (3D 는 600 을 그린다)', () => {
    const { materials, s } = specOf(sinkItem([lower('l1', 1200, 0), tall('t1', 600, 1200), lower('l2', 600, 1800)]));
    expect(materials.filter((r) => r.part === '걸레받이' && /^0-ep-/.test(r.partId)).map((r) => [r.partId, r.w, r.qty])).toEqual([['0-ep-kick-0', 1200, 1], ['0-ep-kick-1', 800, 1]]);
    const kick = s.items[0].runs.find((r) => r.parts[0].id === '0-ep-kick-1#0').parts[0];
    expect(kick.cut).toEqual({ w: 600, h: 145 });
    expect(kick.tags).toEqual({ run: 'kick', siteCut: { order: 800 } });
    expect([kick.box.min[0], kick.box.max[0]]).toEqual([-300, 300]);   // 호스트 l2 600 가운데 — 붙는 자리 그대로
    const ch = s.items[0].runs.find((r) => r.parts[0].id === '0-ep-channel:front-1#0').parts[0];
    expect(ch.cut).toEqual({ w: 52, h: 600 });
    expect(ch.tags.siteCut).toEqual({ order: 800 });
    expect(epUnplaced(s)).toEqual([]);
  });

  test('자리가 라인 자리와 어긋나면 놓지 않는다 (run-layout-unknown) — 계획 단위의 모듈 경계가 라인 x 와 ±1 안이어야 한다', () => {
    const item = sinkItem([upper('u1', 600, 0), upper('u2', 600, 600), upper('u3', 600, 1200), upper('u4', 600, 1800), upper('u5', 500, 2400)]);
    const lines = lineOf(item);
    lines[0].modules.find((e) => e.moduleKey === '0-u4').x0 += 50;
    const { s } = specOf(item, lines);
    expect(epUnplaced(s).filter((u) => u.part === '상몰딩').map((u) => [u.part, u.reason])).toEqual([['상몰딩', 'run-layout-unknown'], ['상몰딩', 'run-layout-unknown']]);
  });
});
