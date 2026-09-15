/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, afterAll, window, global, __dirname */
/**
 * B1: 부재 식별자 · 마감 코드 · 엣지 길이 (docs/01-plan/detail-bom-deepening.plan.md §5 B1).
 *
 * `MaterialExtractor.add()` 가 내는 모든 자재 행에 **더해진** 필드를 본다 (불변조건 I4 — 기존 필드는 그대로):
 *   partId · slot · finishCode(디테일 모델 해석) · edges · edgeLen · edgeT · edgeCode, 요약 edgeBanding.
 * 값이 옳은지는 규칙 시험(bom-body-thickness, extractors-*)이, 바뀌었는지는 골든(bom-golden-*)이 본다.
 */
global.dlog = () => {};

const {
  MaterialExtractor, HardwareExtractor, DrawingVisualizer, BOM_PART_DEFS, bomPartDefOf,
} = require('../js/detaildesign/extractors.js');
const { FIXTURES } = require('../test-utils/bom-golden/fixtures');

const clone = (o) => JSON.parse(JSON.stringify(o));
/** 싱크(15T) + 붙박이 + 냉장고 + ㄱ자 멍장 — 네 품목 한 설계. 카테고리 중복(싱크 2)도 건다. */
function fullDesign() {
  return { items: [clone(FIXTURES.sink15), clone(FIXTURES.wardrobe), clone(FIXTURES.fridge), clone(FIXTURES.sinkCorner)] };
}
const extractRows = (design, me = new MaterialExtractor()) => me.extract(design).materials;
const rowsOf = (rows, module, part) => rows.filter((m) => m.module === module && m.part === part);
const oneRow = (rows, module, part) => {
  const r = rowsOf(rows, module, part);
  expect(r).toHaveLength(1);
  return r[0];
};

describe('partId — 모든 자재 행에, 설계 안에서 유일, 두 번 돌려도 같다', () => {
  const rows = extractRows(fullDesign());

  test('형식 `${itemIdx}-${moduleId}-${partKey}-${n}` 이고 빠진 행이 없다', () => {
    expect(rows.length).toBeGreaterThan(150);
    rows.forEach((m) => {
      expect(typeof m.partId).toBe('string');
      expect(m.partId).toMatch(/^\d+-.+-[a-z]+(:[a-z0-9-]+)?(#\d+)?-\d+$/);
    });
  });

  test('네 품목 200여 행이 전부 서로 다르다', () => {
    const ids = rows.map((m) => m.partId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('같은 설계를 두 번 추출해도 partId 열이 같다 (결정성)', () => {
    const again = extractRows(fullDesign()).map((m) => m.partId);
    expect(again).toEqual(rows.map((m) => m.partId));
    // 새 추출기 인스턴스로도 같다 — 카운터가 인스턴스에 남지 않는다
    expect(extractRows(fullDesign(), new MaterialExtractor()).map((m) => m.partId)).toEqual(again);
  });

  test('itemIdx 는 design.items 순번, moduleId 는 mod.id', () => {
    expect(oneRow(rows, '#1 상부장-상부장(1D)', '도어').partId).toBe('0-u2-door#0-0');
    expect(oneRow(rows, '긴옷-서랍모듈', '서랍도어').partId).toBe('1-w2-drawer#0-0');
    expect(oneRow(rows, '키큰장', '측판').partId).toBe('2-r2-body:side-0');
    expect(oneRow(rows, '#2 하부장-LT망장', '휠라(멍판)').partId).toBe('3-corner-blind-lower-blindfin#0-0');
  });

  test('품목 단위 마감재(EP) 행은 moduleId "ep", 모듈에 딸린 EP 목찬넬은 그 모듈 id', () => {
    expect(oneRow(rows, '#1 EP', '걸레받이').partId).toBe('0-ep-kick-0');
    expect(rowsOf(rows, 'EP', '목찬넬')[0].partId).toBe('1-w2-channel:front-0');
    expect(oneRow(rows, '긴옷-좌대', '좌대 전후').partId).toBe('1-w2-pedestal:fb-0');
  });

  test('같은 모듈 id 아래 상·하부장이 갈리면(붙박이 short/shelf) n 이 구분한다', () => {
    expect(oneRow(rows, '짧은옷(2단)-상부장', '측판').partId).toBe('1-w1-body:side-0');
    expect(oneRow(rows, '짧은옷(2단)-하부장', '측판').partId).toBe('1-w1-body:side-1');
  });

  test('mod.id 가 없으면 `${pos}-${idx}` 로 떨어진다 (옛 저장 설계)', () => {
    const item = clone(FIXTURES.sink15);
    item.modules.forEach((m) => { delete m.id; });
    const r = extractRows({ items: [item] });
    expect(oneRow(r, '상부장-상부장(1D)', '도어').partId).toBe('0-upper-1-door#0-0');
    expect(oneRow(r, '하부장-서랍장', '서랍도어').partId).toBe('0-lower-1-drawer#0-0');
  });
});

describe('slot — planner-finish 7 슬롯 + back', () => {
  const rows = extractRows(fullDesign());
  const slotOf = (module, part) => oneRow(rows, module, part).slot;

  test('추출기가 내는 부재 이름은 전부 표(BOM_PART_DEFS)에 있다 — 폴백 `part:` 키가 없다', () => {
    rows.forEach((m) => {
      expect(bomPartDefOf(m.part).fallback).toBeUndefined();
      expect(m.slot).toBeTruthy();
    });
    expect(bomPartDefOf('없는부재 이름')).toEqual({ key: 'part:없는부재_이름', slot: null, fallback: true });
  });

  test('표의 모든 슬롯은 planner-finish 슬롯 7 + back 안에 있다', () => {
    const allowed = ['door', 'drawerFront', 'body', 'top', 'handle', 'finishing', 'kick', 'back'];
    Object.values(BOM_PART_DEFS).forEach((d) => expect(allowed).toContain(d.slot));
  });

  test('전면 → door/drawerFront, 몸통 → body, 2.7T 판 → back, 목찬넬 → handle, EP → finishing, 바닥 → kick', () => {
    expect(slotOf('#1 하부장-서랍장', '도어')).toBe('door');
    expect(slotOf('#1 하부장-서랍장', '서랍도어')).toBe('drawerFront');
    expect(slotOf('#1 하부장-서랍장', '측판')).toBe('body');
    expect(slotOf('#1 하부장-서랍장', '뒷판')).toBe('back');
    expect(slotOf('#1 하부장-서랍장', '서랍밑판')).toBe('back');
    // 2026-09-15: 서랍장 모듈 목찬넬은 중간 목찬넬(전면·지면) 두 부재 — 둘 다 손잡이 슬롯
    expect(slotOf('#1 하부장-서랍장', '목찬넬(중간 전면)')).toBe('handle');
    expect(slotOf('#1 하부장-서랍장', '목찬넬(중간 지면)')).toBe('handle');
    expect(slotOf('#1 EP', '상몰딩')).toBe('finishing');
    expect(slotOf('#1 EP', '휠라(좌)')).toBe('finishing');
    expect(slotOf('#1 EP', '걸레받이')).toBe('kick');
    expect(slotOf('긴옷-좌대', '좌대 측')).toBe('kick');
    expect(slotOf('#2 하부장-LT망장', '멍가림판')).toBe('finishing');
    expect(slotOf('#2 하부장-LT망장', '경첩목대(앞다리)')).toBe('body');
    expect(slotOf('선반형', '내부서랍 전면판')).toBe('body'); // PB 내부 서랍 — 도어 뒤에 숨는다
  });
});

const F = require('../js/planner/planner-finish'); // jsdom: window.plannerFinishResolve 도 세운다
const {
  BOM_PART_KEY_ALIASES, bomFinishResolveEmbedded, bomFinishCandidates, bomDetailOf,
} = require('../js/detaildesign/extractors.js');

/** 디테일 모델 하나 — 4단계 전부 + 별칭·양문·플래너 셀 키 */
function detailFixture() {
  const d = F.plannerFinishEmpty();
  F.plannerFinishSet(d, 'item', 'door', 'PET-OAK-M');
  F.plannerFinishSet(d, 'item', 'body', 'MFB-WHT');
  F.plannerFinishSet(d, 'item', 'kick', 'PNT-BLK-M');
  F.plannerFinishSet(d, 'section', 'door', 'PNT-WHT-M', { section: 'upper' });
  F.plannerFinishSet(d, 'module', 'door', 'VNR-WNT', { moduleId: 'l3' });
  F.plannerFinishSet(d, 'module', 'body', 'LPM-GRP', { moduleId: 'l3' });
  F.plannerFinishSet(d, 'part', 'door', 'PET-BLK-G', { moduleId: 'l2', partKey: 'door#0' });
  F.plannerFinishSet(d, 'part', 'door', 'PET-SAG-M', { moduleId: 'l1', partKey: 'door#0-1' });   // 양문 오른쪽만
  F.plannerFinishSet(d, 'part', 'body', 'PET-CRM-M', { moduleId: 'l4', partKey: 'body:left' });   // 노출 측판
  F.plannerFinishSet(d, 'module', 'door', 'MFB-BLK', { moduleId: 'X' });                          // 플래너 모듈 X
  F.plannerFinishSet(d, 'part', 'door', 'PNT-SAG-G', { moduleId: 'X', partKey: 'door#2' });       // X 의 칸 2 도어
  return d;
}

describe('내장 해석기 = planner-finish.js plannerFinishResolve (같은 답)', () => {
  const d = detailFixture();
  const cases = [];
  ['door', 'drawerFront', 'body', 'top', 'handle', 'finishing', 'kick'].forEach((slot) => {
    [null, 'l1', 'l2', 'l3', 'l4', 'X', 'u1', 'zz'].forEach((mid) => {
      [null, 'upper', 'lower', 'hood', 'wardrobe', 'tall'].forEach((sec) => {
        [null, 'door#0', 'door#0-1', 'door#2', 'body:left', 'body:side', 'kick'].forEach((pk) => {
          cases.push([slot, mid, sec, pk]);
        });
      });
    });
  });
  test(`${cases.length} 조합에서 결과가 같다`, () => {
    cases.forEach(([slot, mid, sec, pk]) => {
      expect(bomFinishResolveEmbedded(d, slot, mid, sec, pk)).toEqual(F.plannerFinishResolve(d, slot, mid, sec, pk));
    });
    // 빈 값·문자열 코드·빈 코드도 같은 취급
    const raw = { item: { door: 'PET-OAK-M', body: { code: '  ' } }, sections: { upper: { door: '' } }, modules: { m: { door: { code: 'MFB-WHT' } } } };
    ['door', 'body'].forEach((slot) => {
      expect(bomFinishResolveEmbedded(raw, slot, 'm', 'upper', null)).toEqual(F.plannerFinishResolve(raw, slot, 'm', 'upper', null));
    });
    expect(bomFinishResolveEmbedded(null, 'door')).toBeNull();
    expect(bomFinishResolveEmbedded(d, null, 'l3')).toBeNull();
  });
});

describe('행 후보 (bomFinishCandidates) — 묶음 행이 부재 지정에 닿는다', () => {
  const d = detailFixture();
  test('측판 body:side ← body:left / body:right', () => {
    expect(BOM_PART_KEY_ALIASES['body:side']).toEqual(['body:left', 'body:right']);
    expect(bomFinishCandidates(d, 'l4', 'body:side')).toEqual([
      { moduleId: 'l4', partKey: 'body:side' }, { moduleId: 'l4', partKey: 'body:left' }, { moduleId: 'l4', partKey: 'body:right' },
    ]);
  });
  test('door#0 ← 양문 door#0-1 (모델에 있는 접미 키만)', () => {
    expect(bomFinishCandidates(d, 'l1', 'door#0')).toEqual([{ moduleId: 'l1', partKey: 'door#0' }, { moduleId: 'l1', partKey: 'door#0-1' }]);
    expect(bomFinishCandidates(d, 'l2', 'door#0')).toEqual([{ moduleId: 'l2', partKey: 'door#0' }]);
  });
  test('플래너 셀 모듈 planner-X-2 의 door#0 ← X 의 door#2, drawer#0 ← X 의 drawer#2·drawer#b2', () => {
    expect(bomFinishCandidates(d, 'planner-X-2', 'door#0')).toEqual([
      { moduleId: 'planner-X-2', partKey: 'door#0' }, { moduleId: 'X', partKey: 'door#2' },
    ]);
    expect(bomFinishCandidates(d, 'planner-X-2', 'drawer#0').map((c) => c.moduleId + '/' + c.partKey))
      .toEqual(['planner-X-2/drawer#0', 'X/drawer#2', 'X/drawer#b2']);
    expect(bomFinishCandidates(d, 'planner-X-2', 'body:side').map((c) => c.moduleId + '/' + c.partKey))
      .toEqual(['planner-X-2/body:side', 'planner-X-2/body:left', 'planner-X-2/body:right', 'X/body:side', 'X/body:left', 'X/body:right']);
  });
});

describe('finishCode — 디테일 모델(부재 > 모듈 > 섹션 > 품목) > 모듈 doorFinish > 품목 사양', () => {
  function sinkWith(detail, mutate) {
    const item = clone(FIXTURES.sink15);
    item.detail = detail;
    if (mutate) mutate(item);
    return { items: [item] };
  }
  const rows = extractRows(sinkWith(detailFixture()));
  const code = (module, part) => oneRow(rows, module, part).finishCode;

  test('품목 door → 모든 도어·서랍도어 행 (지정 없는 모듈)', () => {
    expect(rowsOf(rows, '상부장-상부장(2D)', '도어').map((m) => m.finishCode)).toEqual(['PNT-WHT-M', 'PNT-WHT-M']); // 섹션 upper 가 품목을 덮는다
    expect(code('하부장-EL장', '도어')).toBe('PET-OAK-M');
    expect(code('하부장-서랍장', '서랍도어')).toBe('');            // drawerFront 슬롯엔 지정이 없다 — door 를 빌려 쓰지 않는다
  });
  test('모듈 door 는 섹션·품목보다, 부재 door#0 은 모듈보다 세다 — 그 행에만', () => {
    expect(code('하부장-하부장(2D)', '도어')).toBe('VNR-WNT');    // l3 모듈
    expect(code('하부장-서랍장', '도어')).toBe('PET-BLK-G');      // l2 부재 door#0
    expect(code('하부장-개수대', '도어')).toBe('PET-SAG-M');      // l1 양문 오른쪽(door#0-1) 지정이 그 행에 닿는다
  });
  test('몸통은 디테일이 정한 때만 코드, 자재·비고는 그대로. 뒷판·서랍밑판(back)은 언제나 빈 값', () => {
    expect(code('하부장-하부장(2D)', '측판')).toBe('LPM-GRP');    // l3 모듈 body
    expect(code('하부장-EL장', '측판')).toBe('PET-CRM-M');        // l4 부재 body:left → 측판 행(별칭)
    expect(code('하부장-EL장', '지판')).toBe('MFB-WHT');          // 품목 body (부재 별칭은 측판 행에만)
    expect(oneRow(rows, '하부장-EL장', '측판').material).toBe('PB');
    expect(code('하부장-EL장', '뒷판')).toBe('');
    expect(code('하부장-서랍장', '서랍밑판')).toBe('');
    expect(code('EP', '걸레받이')).toBe('PNT-BLK-M');             // 품목 kick
    expect(code('EP', '상몰딩')).toBe('');                        // finishing 지정 없음
  });
  test('플래너 셀 모듈(planner-X-2)은 X 의 모듈·부재 지정을 받는다', () => {
    const r = extractRows(sinkWith(detailFixture(), (item) => {
      item.modules.find((m) => m.id === 'l3').id = 'planner-X-2';
      item.modules.find((m) => m.id === 'l4').id = 'planner-X-1';
    }));
    expect(oneRow(r, '하부장-하부장(2D)', '도어').finishCode).toBe('PNT-SAG-G'); // X 의 door#2 (부재)
    expect(oneRow(r, '하부장-EL장', '도어').finishCode).toBe('MFB-BLK');        // X 의 모듈 door
    expect(oneRow(r, '하부장-하부장(2D)', '도어').partId).toBe('0-planner-X-2-door#0-0');
  });
  test('detail 이 JSON 문자열이어도, 없어도 된다', () => {
    const s = extractRows(sinkWith(JSON.stringify(detailFixture())));
    expect(oneRow(s, '하부장-하부장(2D)', '도어').finishCode).toBe('VNR-WNT');
    const none = extractRows(sinkWith(undefined));
    none.forEach((m) => expect(m.finishCode).toBe(''));
    expect(bomDetailOf('{bad json')).toBeNull();
    expect(bomDetailOf(null)).toBeNull();
  });
  test('planner-finish.js 가 없는 환경(내장 해석기)에서도 같은 코드가 나온다', () => {
    const saved = window.plannerFinishResolve;
    const savedN = window.plannerFinishNormalize;
    delete window.plannerFinishResolve;
    delete window.plannerFinishNormalize;
    try {
      const r = extractRows(sinkWith(detailFixture()));
      expect(r.map((m) => m.finishCode)).toEqual(rows.map((m) => m.finishCode));
    } finally {
      window.plannerFinishResolve = saved;
      window.plannerFinishNormalize = savedN;
    }
  });

  describe('카탈로그(bom-finish-color.js)가 실린 브라우저 경로', () => {
    let BOMFC;
    beforeAll(() => { BOMFC = require('../js/detaildesign/bom-finish-color'); window.DadamBomFinishColor = BOMFC; });
    afterAll(() => { delete window.DadamBomFinishColor; });

    test('디테일 코드는 자재(PET/MFB…)·비고(라벨)도 카탈로그에서 채운다', () => {
      const r = extractRows(sinkWith(detailFixture()));
      const door = oneRow(r, '하부장-하부장(2D)', '도어');
      expect(door.finishCode).toBe('VNR-WNT');
      expect(door.material).toBe('VNR');
      expect(door.note).toBe(BOMFC.resolveDoorMaterial({ doorMaterialCode: 'VNR-WNT' }).label);
      // 몸통은 코드만 — 자재는 PB 그대로
      expect(oneRow(r, '하부장-하부장(2D)', '측판').material).toBe('PB');
    });
    test('디테일 > 모듈 doorFinish/doorColor > 품목 사양(doorFinishUpper/Lower)', () => {
      const r = extractRows(sinkWith(null, (item) => {
        item.specs.doorFinishUpper = 'pet-matte'; item.specs.doorColorUpper = 'oak';    // 카탈로그 값 → PET-OAK-M
        item.specs.doorFinishLower = '무광';      item.specs.doorColorLower = '화이트'; // 기판 미정 → 코드 없음
        item.modules.find((m) => m.id === 'u2').doorFinish = 'mfb'; item.modules.find((m) => m.id === 'u2').doorColor = 'black';
      }));
      expect(oneRow(r, '상부장-상부장(1D)', '도어').finishCode).toBe('MFB-BLK');   // 모듈 > 사양
      expect(oneRow(r, '상부장-상부장(1D)', '도어').material).toBe('MFB');
      expect(rowsOf(r, '상부장-상부장(2D)', '도어').map((m) => m.finishCode)).toEqual(['PET-OAK-M', 'PET-OAK-M']); // 사양 Upper
      expect(oneRow(r, '하부장-EL장', '도어').finishCode).toBe('');               // 한글 사양은 코드를 짐작하지 않는다
      expect(oneRow(r, '하부장-EL장', '도어').material).toBe('MDF');
      // 디테일이 있으면 모듈·사양보다 세다
      const d = F.plannerFinishEmpty();
      F.plannerFinishSet(d, 'item', 'door', 'PNT-GRP-G');
      const r2 = extractRows(sinkWith(d, (item) => {
        item.specs.doorFinishUpper = 'pet-matte'; item.specs.doorColorUpper = 'oak';
        item.modules.find((m) => m.id === 'u2').doorFinish = 'mfb'; item.modules.find((m) => m.id === 'u2').doorColor = 'black';
      }));
      r2.filter((m) => m.slot === 'door').forEach((m) => expect(m.finishCode).toBe('PNT-GRP-G'));
      expect(oneRow(r2, '하부장-서랍장', '서랍도어').finishCode).toBe('');   // drawerFront 는 door 지정을 빌리지 않는다
    });
    test('골든 픽스처(한글 사양)는 카탈로그가 있어도 코드가 비어 있다 — 골든 add-only 의 근거', () => {
      const r = extractRows(fullDesign());
      r.forEach((m) => expect(m.finishCode).toBe(''));
    });
  });
});

describe('detaildesign.html — planner-finish.js 를 extractors.js 앞에 싣고 전역 이름이 부딪히지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(ROOT, 'detaildesign.html'), 'utf8');
  const srcs = [];
  const re = /<script([^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*)>/g;
  let m;
  while ((m = re.exec(html))) srcs.push(m[2]);
  const bare = srcs.map((s) => s.split('?')[0]);

  test('순서: bom-finish-color → planner-finish → extractors, ?v= 붙어 있다', () => {
    const i1 = bare.indexOf('js/detaildesign/bom-finish-color.js');
    const i2 = bare.indexOf('js/planner/planner-finish.js');
    const i3 = bare.indexOf('js/detaildesign/extractors.js');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(srcs[i2]).toMatch(/\?v=\d+\.\d+/);
  });

  test('planner-finish.js 의 최상위 이름을 상세설계 스크립트(외부·인라인)가 다시 선언하지 않는다', () => {
    const { topLevelDeclarations } = require('../test-utils/js-scan');
    const finishNames = new Set(topLevelDeclarations(fs.readFileSync(path.join(ROOT, 'js/planner/planner-finish.js'), 'utf8')));
    expect(finishNames.size).toBeGreaterThan(10);
    const clashes = [];
    bare.filter((s) => !/^https?:/.test(s) && s !== 'js/planner/planner-finish.js').forEach((rel) => {
      const p = path.join(ROOT, rel);
      if (!fs.existsSync(p)) return;
      topLevelDeclarations(fs.readFileSync(p, 'utf8')).forEach((n) => { if (finishNames.has(n)) clashes.push(`${n} (${rel})`); });
    });
    const inlineRe = /<script([^>]*)>([\s\S]*?)<\/script>/g;
    let im;
    while ((im = inlineRe.exec(html))) {
      if (/\ssrc\s*=/.test(im[1] || '') || /type\s*=\s*["']module["']/.test(im[1] || '')) continue;
      topLevelDeclarations(im[2]).forEach((n) => { if (finishNames.has(n)) clashes.push(`${n} (inline)`); });
    }
    expect(clashes).toEqual([]);
  });
});

describe('엣지밴딩 — edges/edgeLen/edgeT/edgeCode + 요약 edgeBanding', () => {
  const { bomEdgeSidesOf, bomEdgeLenOf, bomEdgeThicknessOf } = require('../js/detaildesign/extractors.js');
  const sides = (L, R, T, B) => ({ L, R, T, B });

  test('엣지 문자열 → 변 (L/R 은 세로 h 변, T/B 는 가로 w 변)', () => {
    expect(bomEdgeSidesOf('4면', 446, 735)).toEqual(sides(true, true, true, true));
    expect(bomEdgeSidesOf('3면', 295, 720)).toEqual(sides(true, false, true, true));   // 측판: 앞 + 위·아래
    expect(bomEdgeSidesOf('3면', 720, 295)).toEqual(sides(true, true, true, false));   // 눕히면 긴 변 T + 짧은 변 L·R
    expect(bomEdgeSidesOf('2면(장)', 70, 870)).toEqual(sides(true, true, false, false)); // 밴드: 긴 변 둘 = 870×2
    expect(bomEdgeSidesOf('2면(장)', 870, 70)).toEqual(sides(false, false, true, true));
    expect(bomEdgeSidesOf('2면(가로)', 864, 700)).toEqual(sides(false, false, true, true));
    expect(bomEdgeSidesOf('1면(전)', 870, 277)).toEqual(sides(false, false, false, true)); // 천판: 앞 긴 변
    expect(bomEdgeSidesOf('1면(장)', 440, 180)).toEqual(sides(false, false, false, true));
    expect(bomEdgeSidesOf('1면(전)', 70, 700)).toEqual(sides(true, false, false, false));
    expect(bomEdgeSidesOf('-', 880, 719)).toEqual(sides(false, false, false, false));
    expect(bomEdgeSidesOf(undefined, 1, 1)).toEqual(sides(false, false, false, false));
  });

  test('길이 = Σ 붙이는 변 치수, 두께 = 전면 1.0 / 나머지 0.6', () => {
    expect(bomEdgeLenOf(sides(true, false, true, true), 295, 720)).toBe(720 + 295 * 2);
    expect(bomEdgeLenOf(sides(true, true, false, false), 70, 870)).toBe(1740);
    expect(bomEdgeThicknessOf('door')).toBe(1.0);
    expect(bomEdgeThicknessOf('drawerFront')).toBe(1.0);
    ['body', 'back', 'top', 'handle', 'finishing', 'kick', null].forEach((s) => expect(bomEdgeThicknessOf(s)).toBe(0.6));
  });

  test('행 필드: 측판·밴드·천판·도어·뒷판', () => {
    const rows = extractRows({ items: [clone(FIXTURES.sink15)] });
    const side = oneRow(rows, '상부장-상부장(1D)', '측판');       // 295×720 3면
    expect(side.edge).toBe('3면');
    expect(side.edges).toEqual(sides(true, false, true, true));
    expect(side.edgeLen).toBe(720 + 295 + 295);
    expect(side.edgeT).toBe(0.6);
    expect(side.edgeCode).toBeNull();
    const band = oneRow(rows, '상부장-상부장(1D)', '밴드(보강목)'); // 570×70 2면(장)
    expect(band.edges).toEqual(sides(false, false, true, true));
    expect(band.edgeLen).toBe(570 * 2);
    const top = oneRow(rows, '상부장-상부장(1D)', '천판');        // 570×277 1면(전)
    expect(top.edges).toEqual(sides(false, false, false, true));
    expect(top.edgeLen).toBe(570);
    const door = oneRow(rows, '상부장-상부장(1D)', '도어');       // 596×735 4면
    expect(door.edges).toEqual(sides(true, true, true, true));
    expect(door.edgeLen).toBe((596 + 735) * 2);
    expect(door.edgeT).toBe(1);
    expect(door.edgeCode).toBeNull();                            // finishCode 가 비면 null
    const back = oneRow(rows, '상부장-상부장(1D)', '뒷판');
    expect(back.edges).toEqual(sides(false, false, false, false));
    expect(back.edgeLen).toBe(0);
  });

  test('edgeCode — 전면·마감재는 면 마감을 따르고, 몸통·바닥·손잡이는 null', () => {
    const d = F.plannerFinishEmpty();
    F.plannerFinishSet(d, 'item', 'door', 'PET-OAK-M');
    F.plannerFinishSet(d, 'item', 'drawerFront', 'PET-OAK-G');
    F.plannerFinishSet(d, 'item', 'body', 'MFB-WHT');
    F.plannerFinishSet(d, 'item', 'finishing', 'PNT-WHT-M');
    F.plannerFinishSet(d, 'item', 'kick', 'PNT-BLK-M');
    F.plannerFinishSet(d, 'item', 'handle', 'VNR-WNT');
    const item = clone(FIXTURES.sink15);
    item.detail = d;
    const rows = extractRows({ items: [item] });
    expect(oneRow(rows, '하부장-서랍장', '도어').edgeCode).toBe('PET-OAK-M');
    expect(oneRow(rows, '하부장-서랍장', '서랍도어').edgeCode).toBe('PET-OAK-G');
    expect(oneRow(rows, 'EP', '휠라(좌)').edgeCode).toBe('PNT-WHT-M');
    expect(oneRow(rows, '하부장-서랍장', '측판').finishCode).toBe('MFB-WHT');
    expect(oneRow(rows, '하부장-서랍장', '측판').edgeCode).toBeNull();
    expect(oneRow(rows, 'EP', '걸레받이').edgeCode).toBeNull();
    expect(oneRow(rows, '하부장-서랍장', '목찬넬(중간 전면)').edgeCode).toBeNull();
  });

  test('요약 edgeBanding = 두께별 Σ edgeLen × qty, summary 옆(형제 키)에 둔다', () => {
    const me = new MaterialExtractor();
    const result = me.extract(fullDesign());
    const expected = {};
    result.materials.forEach((m) => {
      const k = String(m.edgeT);
      expected[k] = (expected[k] || 0) + m.edgeLen * m.qty;
    });
    expect(result.edgeBanding).toEqual(expected);
    expect(Object.keys(result.edgeBanding).sort()).toEqual(['0.6', '1']);
    expect(result.edgeBanding['1']).toBeGreaterThan(0);
    expect(result.edgeBanding['0.6']).toBeGreaterThan(result.edgeBanding['1']);
    // summary 는 자재_두께 그룹만 — ai-design-report.js 가 값을 전부 표로 그린다
    Object.entries(result.summary).forEach(([key, s]) => {
      expect(key).toBe(`${s.material}_${s.thickness}`);
      expect(Object.keys(s).sort()).toEqual(['material', 'panelCount', 'thickness', 'totalArea']);
    });
    expect(me.calculateEdgeBanding([])).toEqual({});
  });
});

describe('CommonJS 이중 노출 — 세 클래스 모두', () => {
  test('MaterialExtractor 외에 HardwareExtractor·DrawingVisualizer 도 require 로 얻는다', () => {
    expect(typeof MaterialExtractor).toBe('function');
    expect(typeof HardwareExtractor).toBe('function');
    expect(typeof DrawingVisualizer).toBe('function');
    expect(new DrawingVisualizer().KERF).toBe(4);
  });
});

describe('toCNC — 3면 가지 (측판)', () => {
  const me = new MaterialExtractor();
  const row = (edge, w = 295, h = 720) => ({ part: '측판', material: 'PB', thickness: 15, w, h, qty: 2, edge });
  const cncOf = (edge, w, h) => me.toCNC([row(edge, w, h)]).split('\n')[1].split(',').slice(-4).map(Number);

  test("'3면' 은 L·T·B (앞 + 위·아래, 뒤 없음) — 예전엔 가지가 없어 0,0,0,0 이었다", () => {
    expect(cncOf('3면')).toEqual([1, 0, 1, 1]);
  });
  test('다른 가지는 그대로다 (4면 전부, 1면 L, - 없음)', () => {
    expect(cncOf('4면')).toEqual([1, 1, 1, 1]);
    expect(cncOf('1면(전)')).toEqual([1, 0, 0, 0]);
    expect(cncOf('-')).toEqual([0, 0, 0, 0]);
  });
});
