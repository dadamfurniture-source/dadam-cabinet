/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeAll, process, __dirname, console */
/**
 * T1 (PR1): 지금 플래너 3D 장면의 판재 겹침 — 판끼리 파고드는 곳을 숫자로 찾는다.
 * (docs/01-plan/planner-cad.plan.md 단계 0 · PR1, 개정 #5·#7·#8)
 *
 * 운영 코드는 건드리지 않는다. 플래너를 jsdom 에서 3D 로 부팅해(scene-parts.js) 메시마다 상자를 뽑고
 * (따낸 판은 단면을 직사각형으로 쪼갠다) box-overlap.js 로 모든 쌍을 잰다.
 *
 *   겹침 = 부피 > 1mm³ **이고** 파고든 깊이 > 0.1mm. 면 접촉(부피 0)은 겹침이 아니다.
 *
 * 찾은 겹침은 test-utils/overlap-allowlist.json 과 **정확히** 같아야 한다 (원장 시험과 같은 방식):
 *   · 목록 밖의 새 겹침 → 실패        새로 파고드는 판은 조용히 들어올 수 없다
 *   · 목록에 있는데 사라짐 → 실패      고쳤으면 항목을 지운다
 *   · 부피·깊이가 바뀜 → 실패          같은 쌍의 다른 겹침은 다른 겹침이다
 *   · 항목마다 cause · reason 이 있어야 한다
 *
 * 갱신:  UPDATE_OVERLAP_ALLOWLIST=1 npx jest __tests__/scene-overlap.test.js
 *   기존 cause·reason 은 id 로 이어받고, 새 항목은 빈 이유로 들어와 다음 실행이 실패한다 — 사람이 적는다.
 *
 * 픽스처 (개정 #8 — 골든 3벌만으로는 서랍장 처짐방지목 충돌을 못 찾는다):
 *   straight · lShape · oblique  planner-golden.js 그대로
 *   drawer      straight 의 하부장 전부를 "도어 + 서랍 3단" 서랍장으로 (목찬넬 — 중간 따내기·서랍 박스가 선다)
 *   drawer18    drawer 에 서랍 자재 18T · 볼레일 · 서랍 사쿠리. **몸통 18T 는 플래너 3D 에 없다**
 *               (mockup-structure.html BODY_T = 15 상수) — 서랍 쪽 18T 만 여기서 볼 수 있다
 *   multiCell   straight 의 하부 1000 · 상부 900 을 3칸으로 (칸막이가 선다)
 *   wardrobe    붙박이장 2400 — 샘플 프리셋(짧은옷 2단 · 긴옷+서랍 · 반반)
 *   wardrobeExt wardrobe 의 서랍 통을 외부 서랍(별도 몸통)으로
 *
 * drawerBox 는 서랍 한 개의 **외피 한 덩어리**다 (속이 빈 상자를 꽉 찬 상자로 그린다). 서랍이 드나드는
 * 자리이므로 그 외피를 파고드는 판은 실제로도 서랍과 부딪힌다 — 그래서 꽉 찬 상자로 잰다.
 * 대신 표에서 kind 'envelope' 로 따로 보이게 한다.
 */
const fs = require('fs');
const path = require('path');
const { FIXTURES } = require('../test-utils/planner-golden');
const { bootPlanner3D, collectScenePieces } = require('../test-utils/scene-parts');
const {
  findOverlaps, boxPairOverlap, pieceOverlap, isOverlap, rectilinearRects, DEFAULT_LIMITS,
} = require('../test-utils/box-overlap');
const finish = require('../js/planner/planner-finish.js');

const ALLOWLIST_PATH = path.join(__dirname, '..', 'test-utils', 'overlap-allowlist.json');

// ── 합성 쌍 ──────────────────────────────────────────────────────

/** 열 우선 행렬 — z 축 회전 후 이동 */
function rotZ(deg, t = [0, 0, 0]) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1];
}
const box = (min, max, m) => ({ min, max, m: m || undefined });

describe('합성 쌍 — 판정기가 눈뜬장님이 아닌지 먼저 본다', () => {
  test('겹침: 10mm 씩 겹친 두 상자 → 부피 1000, 깊이 10', () => {
    const r = boxPairOverlap(box([0, 0, 0], [20, 20, 20]), box([10, 10, 10], [30, 30, 30]));
    expect(r.volume).toBeCloseTo(1000, 6);
    expect(r.depth).toBeCloseTo(10, 6);
    expect(isOverlap(r)).toBe(true);
  });

  test('얇게 파고든 판: 18T 측판에 15T 판이 3mm 들어감 → 깊이 3', () => {
    const side = box([0, 0, 0], [18, 700, 550]);
    const shelf = box([15, 300, 0], [500, 315, 530]);
    const r = boxPairOverlap(side, shelf);
    expect(r.depth).toBeCloseTo(3, 6);
    expect(r.volume).toBeCloseTo(3 * 15 * 530, 3);
    expect(isOverlap(r)).toBe(true);
  });

  test('면 접촉(맞대기)은 겹침이 아니다 — 부피 0', () => {
    const r = boxPairOverlap(box([0, 0, 0], [15, 700, 550]), box([15, 0, 0], [800, 15, 550]));
    expect(r.volume).toBe(0);
    expect(isOverlap(r)).toBe(false);
  });

  test('모서리만 닿거나 떨어져 있으면 겹침이 아니다', () => {
    expect(isOverlap(boxPairOverlap(box([0, 0, 0], [10, 10, 10]), box([10, 10, 0], [20, 20, 10])))).toBe(false);
    expect(isOverlap(boxPairOverlap(box([0, 0, 0], [10, 10, 10]), box([10.5, 0, 0], [20, 10, 10])))).toBe(false);
  });

  test('문턱: 깊이 0.1 이하 또는 부피 1mm³ 이하는 겹침이 아니다', () => {
    // 0.05mm 파고든 넓은 판 — 부피는 크지만 깊이가 문턱 밑 (반올림 잡음)
    const shallow = boxPairOverlap(box([0, 0, 0], [15, 700, 550]), box([14.95, 0, 0], [800, 15, 550]));
    expect(shallow.volume).toBeGreaterThan(DEFAULT_LIMITS.minVolume);
    expect(isOverlap(shallow)).toBe(false);
    // 1mm 정육면체보다 작은 겹침 — 깊이는 넘지만 부피가 문턱 밑
    const tiny = boxPairOverlap(box([0, 0, 0], [10, 10, 10]), box([9.5, 9.5, 9.5], [20, 20, 20]));
    expect(tiny.depth).toBeGreaterThan(DEFAULT_LIMITS.minDepth);
    expect(isOverlap(tiny)).toBe(false);
  });

  test('기울어진 판(사선 135°)도 부피가 정확하다 — 45° 돌린 정사각기둥끼리 = 정팔각기둥', () => {
    const a = box([-50, -50, 0], [50, 50, 100]);
    const b = box([-50, -50, 0], [50, 50, 100], rotZ(45));
    const octagon = 8 * (Math.SQRT2 - 1) * 50 * 50;   // 내접원 반지름 50 인 정팔각형 넓이
    expect(boxPairOverlap(a, b).volume).toBeCloseTo(octagon * 100, 3);
    // 90° 돌리면 같은 상자 — 전부 겹친다
    expect(boxPairOverlap(a, box([-50, -50, 0], [50, 50, 100], rotZ(90))).volume).toBeCloseTo(1e6, 3);
    // 45° 돌린 판이 대각선으로 떨어져 있으면 축 상자(AABB)는 겹쳐도 실제로는 안 겹친다
    const far = box([-50, -50, 0], [50, 50, 100], rotZ(45, [125, 125, 0]));
    expect(isOverlap(boxPairOverlap(a, far))).toBe(false);
  });

  test('따내기 안쪽: 목찬넬 지면판이 측판 따낸 자리에 앉으면 겹침이 아니다, 따낸 선을 넘으면 겹침', () => {
    // makeNotchedPanel 과 같은 단면 — x = 깊이(앞 = +), y = 높이, 위 앞 모서리를 40×70 따냄
    const D = 550, H = 708, T = 15;
    const ring = [[-D / 2, -H / 2], [D / 2, -H / 2], [D / 2, H / 2 - 70], [D / 2 - 40, H / 2 - 70],
      [D / 2 - 40, H / 2], [-D / 2, H / 2]];
    const rects = rectilinearRects(ring);
    expect(rects).toHaveLength(2);
    const area = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    expect(area).toBeCloseTo(D * H - 40 * 70, 6);
    const side = { id: 'side', solids: rects.map((r) => box([r.x0, r.y0, 0], [r.x1, r.y1, T])) };
    // 따낸 바닥에 깔린 지면판 (18 × 40) — 따낸 자리 안
    const inNotch = { id: 'base', solids: [box([D / 2 - 40, H / 2 - 70, 0], [D / 2, H / 2 - 52, T])] };
    expect(isOverlap(pieceOverlap(side, inNotch))).toBe(false);
    // 통짜 측판이었다면 겹쳤을 것 — 윤곽을 쓰는 의미가 있다
    const plain = { id: 'plain', solids: [box([-D / 2, -H / 2, 0], [D / 2, H / 2, T])] };
    expect(isOverlap(pieceOverlap(plain, inNotch))).toBe(true);
    // 따낸 선 뒤로 5 더 들어가면 겹침 (깊이 5)
    const deep = { id: 'deep', solids: [box([D / 2 - 45, H / 2 - 70, 0], [D / 2, H / 2 - 52, T])] };
    const r = pieceOverlap(side, deep);
    expect(isOverlap(r)).toBe(true);
    expect(r.depth).toBeCloseTo(5, 6);
    expect(r.volume).toBeCloseTo(5 * 18 * T, 6);
  });

  test('중간 따내기가 여럿인 판도 쪼갠다 (서랍장 측판 — 상단 + 중간 2)', () => {
    const ring = [[-275, -354], [275, -354], [275, 0], [235, 0], [235, 90], [275, 90], [275, 284],
      [235, 284], [235, 354], [-275, 354]];
    const rects = rectilinearRects(ring);
    const area = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
    expect(area).toBeCloseTo(550 * 708 - 40 * 90 - 40 * 70, 6);
  });
});

// ── 실제 장면 ────────────────────────────────────────────────────

const wardrobeLayout = {
  version: 1,
  savedAt: '2026-01-01T00:00:00.000Z',
  person: null,
  modules: [{ section: 'wardrobe', x: 0, y: 0, w: 2400, h: 620, moduleH: 2310, rotation: 0, finishings: [] }],
};

/** 모듈 구조를 바꾸고 3D 를 다시 그린다. */
function restructure(p, pick, edit) {
  p.g('modules').filter(pick).forEach((m) => edit(p.g('getStructure')(m.id), m));
  p.g('renderAll3D')({ fit: false });
  return p;
}
const toDrawer = (s) => {
  s.horizontalLayout = 'doorTopDrawerBottom';
  s.bottomType = 'drawer';
  s.drawerCount = 3;
};
const isLower = (m) => m.section === 'lower';

const SCENES = {
  straight: () => bootPlanner3D(FIXTURES.straight, { design: 'ovl', item: 'straight' }),
  lShape: () => bootPlanner3D(FIXTURES.lShape, { design: 'ovl', item: 'lShape' }),
  oblique: () => bootPlanner3D(FIXTURES.oblique, { design: 'ovl', item: 'oblique' }),
  drawer: () => restructure(bootPlanner3D(FIXTURES.straight, { design: 'ovl', item: 'drawer' }), isLower, toDrawer),
  drawer18: () => restructure(bootPlanner3D(FIXTURES.straight, { design: 'ovl', item: 'drawer18' }), isLower, (s) => {
    toDrawer(s);
    s.drawer = { rail: 'ball', sakuri: true, boxT: 18 };
  }),
  multiCell: () => restructure(bootPlanner3D(FIXTURES.straight, { design: 'ovl', item: 'multiCell' }),
    (m) => m.id === 'lower-2' || m.id === 'upper-0', (s) => {
      s.verticalCount = 3;
      s.areaWidths = null;
      s.areaTypes = ['door', 'door', 'door'];
    }),
  wardrobe: () => bootPlanner3D(wardrobeLayout, { design: 'ovl', item: 'wardrobe' }),
  wardrobeExt: () => restructure(bootPlanner3D(wardrobeLayout, { design: 'ovl', item: 'wardrobeExt' }),
    (m) => m.id === 'wardrobe-1', (s) => { s.wardrobe = Object.assign({}, s.wardrobe, { preset: 'longDrawer', externalDrawer: true }); }),
};

const round1 = (x) => Math.round(x * 10) / 10;

/** 같은 모듈 안 쌍이면 두 모듈 로컬 AABB 의 겹친 자리 (보고·그림용). 다른 모듈끼리는 축이 달라 null. */
function regionOf(a, b) {
  if (a.moduleId !== b.moduleId) return null;
  const min = [0, 1, 2].map((k) => Math.max(a.moduleAabb.min[k], b.moduleAabb.min[k]));
  const max = [0, 1, 2].map((k) => Math.min(a.moduleAabb.max[k], b.moduleAabb.max[k]));
  return { min: min.map(round1), max: max.map(round1) };
}

function entryOf(fixture, o) {
  const envelope = o.a.entityKind === 'drawerBox' || o.b.entityKind === 'drawerBox';
  return {
    id: `${fixture}|${o.a.id}×${o.b.id}`,
    fixture,
    kind: envelope ? 'envelope' : 'solid',
    a: o.a.id,
    b: o.b.id,
    volume: Math.round(o.volume),
    depth: round1(o.depth),
    region: regionOf(o.a, o.b),
  };
}

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { entries: [] };
  return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function writeAllowlist(entries, prev) {
  const prevById = new Map((prev.entries || []).map((e) => [e.id, e]));
  const doc = {
    _doc: [
      'T1 (PR1) 3D 장면 판재 겹침 허용 목록 — 지금 플래너 3D 가 그리는 판끼리 파고드는 곳 전부. __tests__/scene-overlap.test.js 가 지킨다.',
      'id = fixture|부재A×부재B (부재 = moduleId|partKey). 겹침 = 부피 > 1mm³ 이고 파고든 깊이 > 0.1mm. volume mm³ · depth mm · region 모듈 로컬 겹친 자리.',
      'kind: solid(판끼리) · envelope(서랍 박스 외피 — 서랍이 드나드는 자리). cause 는 원인 묶음, reason 은 한 줄 설명. pending-owner Dn 은 사장님 결정 대기.',
      '항목을 지우는 길은 코드를 고쳐 겹침을 없애는 것뿐이다. 갱신: UPDATE_OVERLAP_ALLOWLIST=1 npx jest __tests__/scene-overlap.test.js',
    ],
    limits: DEFAULT_LIMITS,
    entries: entries.map((e) => {
      const old = prevById.get(e.id) || {};
      return Object.assign({}, e, { cause: old.cause || '', reason: old.reason || '' });
    }),
  };
  fs.writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

const fmt = (list) => list.map((e) => `  ${e.id}  V=${e.volume} d=${e.depth}${e.reason ? '  — ' + e.reason : ''}`).join('\n');

const scenes = {};
let found = [];

beforeAll(() => {
  Object.keys(SCENES).forEach((name) => {
    const p = SCENES[name]();
    scenes[name] = { planner: p, pieces: collectScenePieces(p) };
  });
  found = Object.keys(scenes)
    .flatMap((name) => findOverlaps(scenes[name].pieces).map((o) => entryOf(name, o)))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
});

describe('장면이 실제로 만들어진다', () => {
  test.each(Object.keys(SCENES))('%s — 부재가 있고 모두 모듈 id 가 붙어 있으며 화면용 메시는 없다', (name) => {
    const { planner, pieces } = scenes[name];
    expect(pieces.length).toBeGreaterThan(0);
    const ids = new Set((planner.g('modules') || []).map((m) => String(m.id)));
    pieces.forEach((r) => expect(ids.has(r.moduleId)).toBe(true));
    const skip = finish.PLANNER_FINISH_PAINT_SKIP;
    expect(pieces.filter((r) => skip.indexOf(r.entityKind) >= 0)).toEqual([]);
    expect(new Set(pieces.map((r) => r.id)).size).toBe(pieces.length);
  });

  test('픽스처가 의도한 부재를 그린다 — 따낸 판 · 서랍 박스 · 칸막이 · 붙박이장 내부 · 외부 서랍', () => {
    const has = (name, f) => scenes[name].pieces.some(f);
    expect(has('straight', (r) => r.outline && r.side === 'left')).toBe(true);        // 목찬넬 따낸 측판
    expect(has('drawer', (r) => r.entityKind === 'drawerBox')).toBe(true);
    expect(has('drawer', (r) => r.outline && r.outline.length > 6)).toBe(true);        // 중간 따내기
    expect(has('drawer18', (r) => r.entityKind === 'drawerBox')).toBe(true);
    expect(has('multiCell', (r) => r.side === 'divider' && r.moduleId === 'lower-2')).toBe(true);
    expect(has('multiCell', (r) => r.side === 'divider' && r.moduleId === 'upper-0')).toBe(true);
    expect(has('wardrobe', (r) => r.entityKind === 'wardrobeInnerModule')).toBe(true);
    expect(has('wardrobeExt', (r) => r.entityKind === 'wardrobeDrawerFront' && r.ud.external)).toBe(true);
    // 사선 픽스처의 135° 모듈 — 기울어진 행렬이 실제로 들어온다
    const tilted = scenes.oblique.pieces.some((r) => Math.abs(r.matrixWorld[0]) > 0.01 && Math.abs(r.matrixWorld[0]) < 0.99);
    expect(tilted).toBe(true);
  });

  test('18T 서랍 자재가 서랍 박스를 바꾼다 — 같은 서랍이 drawer 와 다른 치수', () => {
    const w = (name) => scenes[name].pieces.find((r) => r.id === 'lower-0|drawerBox#drawer1');
    expect(w('drawer')).toBeTruthy();
    expect(w('drawer18')).toBeTruthy();
    expect(w('drawer18').moduleAabb).not.toEqual(w('drawer').moduleAabb);
  });

  test('모듈 로컬 AABB 가 모듈 크기 안에 든다 (목찬넬 지면판이 측판 앞선을 넘지 않는다)', () => {
    const { planner, pieces } = scenes.straight;
    const m = planner.g('modules').find((x) => x.id === 'lower-0');
    const base = pieces.find((r) => r.id === 'lower-0|channel:channelBase');
    const left = pieces.find((r) => r.id === 'lower-0|body:left');
    expect(base.moduleAabb.max[2]).toBeCloseTo(left.moduleAabb.max[2], 3);
    expect(left.moduleAabb.max[2] - left.moduleAabb.min[2]).toBeCloseTo(m.D, 3);
    expect(left.moduleAabb.max[0] - left.moduleAabb.min[0]).toBeCloseTo(15, 3);
  });
});

describe('3D 장면 겹침 — 허용 목록과 정확히 같아야 한다', () => {
  test('허용 목록 밖의 겹침 없음 · 낡은 항목 없음 · 부피·깊이 동일', () => {
    const prev = readAllowlist();
    if (process.env.UPDATE_OVERLAP_ALLOWLIST === '1') {
      const doc = writeAllowlist(found, prev);
      const blank = doc.entries.filter((e) => !e.reason || !e.cause);
      console.log(`겹침 허용 목록 갱신: ${doc.entries.length}건 (이유 비어 있음 ${blank.length}건)\n${fmt(doc.entries)}`);
      return;
    }
    const allowed = new Map((prev.entries || []).map((e) => [e.id, e]));
    const actual = new Map(found.map((e) => [e.id, e]));
    const extra = found.filter((e) => !allowed.has(e.id));
    const stale = [...allowed.values()].filter((e) => !actual.has(e.id));
    const changed = found.filter((e) => allowed.has(e.id))
      .filter((e) => allowed.get(e.id).volume !== e.volume || allowed.get(e.id).depth !== e.depth)
      .map((e) => Object.assign({}, e, { reason: `기록: V=${allowed.get(e.id).volume} d=${allowed.get(e.id).depth}` }));
    const msg = [];
    if (extra.length) msg.push(`■ 허용 목록에 없는 새 겹침 ${extra.length}건 — 고치거나 test-utils/overlap-allowlist.json 에 이유를 적으세요\n${fmt(extra)}`);
    if (stale.length) msg.push(`■ 더 이상 나지 않는 겹침 ${stale.length}건 — 허용 목록에서 지우세요\n${fmt(stale)}`);
    if (changed.length) msg.push(`■ 부피·깊이가 바뀐 겹침 ${changed.length}건 — 허용 목록을 갱신하고 이유를 다시 확인하세요\n${fmt(changed)}`);
    if (msg.length) {
      throw new Error(`3D 장면 겹침 불일치\n\n${msg.join('\n\n')}\n\n갱신: UPDATE_OVERLAP_ALLOWLIST=1 npx jest __tests__/scene-overlap.test.js`);
    }
    expect(extra).toEqual([]);
    expect(stale).toEqual([]);
    expect(changed).toEqual([]);
  });

  test('허용 목록의 모든 항목에 원인(cause)과 이유(reason)가 있다', () => {
    const prev = readAllowlist();
    const blank = (prev.entries || []).filter((e) => !e.reason || !e.reason.trim() || !e.cause || !e.cause.trim());
    if (blank.length) throw new Error(`이유가 빈 허용 항목 ${blank.length}건\n${fmt(blank)}`);
    expect(blank).toEqual([]);
  });

  test('허용 목록의 문턱이 판정기의 문턱과 같다', () => {
    const prev = readAllowlist();
    expect(prev.limits).toEqual(DEFAULT_LIMITS);
  });

  test('서랍장 처짐방지목 ↔ 서랍은 D2 결정 대기로만 허용된다', () => {
    const prev = readAllowlist();
    const braceDrawer = (prev.entries || []).filter((e) => /\|brace#/.test(e.a + '|' + e.b) && e.kind === 'envelope');
    expect(braceDrawer.length).toBeGreaterThan(0);
    braceDrawer.forEach((e) => expect(e.cause).toBe('pending-owner D2'));
  });
});
