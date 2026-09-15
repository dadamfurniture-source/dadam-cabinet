/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 2026-09-15: 플래너 3D 중간 따내기 — 서랍장(도어 + 하부 서랍)의 목찬넬을 규칙 파일로 그린다.
 *
 * 규칙 출처: js/detaildesign/bom-drawer-rules.js (BOM 과 같은 파일, 도면 "서랍장 목찬넬 구조 도면").
 *   · 중간 따내기 90×40 = 전면판 72 + 지면판 18, 위 전면 20 내려옴, 슬롯 30
 *   · 목찬넬은 전면과 1:1 이 아니다 — 상단 1 + 최소 수
 *   · 박스 소 60 · 중 120 · 대 180, 레일 여유 언더 +40 · 볼 +20
 *
 * 3D 는 three.js 가 필요해 jsdom 에서 돌릴 수 없다. 레이아웃 함수는 하네스로 실제로 부르고,
 * 그리는 쪽은 소스 근거를 검사한다 (planner-wood-channel.test.js 와 같은 방식).
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const SRC = read('mockup-structure.html');
const RULES = require(path.join(ROOT, 'js/detaildesign/bom-drawer-rules.js'));

describe('규칙 파일을 싣는다', () => {
  test('bom-drawer-rules.js 가 planner-engine 뒤, 인라인 앞에 있다', () => {
    const i1 = SRC.indexOf('js/planner/planner-engine.js');
    const i2 = SRC.indexOf('js/detaildesign/bom-drawer-rules.js');
    const i3 = SRC.indexOf('<script>\n');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });

  test('부팅하면 DadamDrawerRules 전역이 있고 오류가 없다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=mn&item=1', storage: {} });
    expect(p.errors).toEqual([]);
    expect(typeof p.window.DadamDrawerRules.layoutDrawerModule).toBe('function');
  });
});

describe('drawerLayoutFor — 목찬넬 하부장의 도어 + 하부 서랍만', () => {
  const p = bootPlanner('mockup-structure.html', { search: '?design=mn2&item=1', storage: {} });
  const fn = p.g('drawerLayoutFor');
  const m = { id: 'lower-0', section: 'lower', W: 600, H: 870, D: 550 };
  const base = () => Object.assign(p.g('defaultStructure')(), {
    horizontalLayout: 'doorTopDrawerBottom', bottomType: 'drawer', drawerHeight: 200, drawerCount: 2,
  });

  test('함수가 노출된다', () => {
    expect(typeof fn).toBe('function');
    expect(p.errors).toEqual([]);
  });

  test('하부장 기본(auto → 목찬넬) + 도어/서랍 → 레이아웃, 도어가 남는 높이', () => {
    const L = fn(m, base());
    expect(L).not.toBeNull();
    const bodyH = p.g('bodyHeightOf')(m, base());
    expect(L.fronts.map((f) => f.kind)).toEqual(['door', 'drawer', 'drawer']);
    expect(L.fronts[1].h).toBe(200);
    expect(L.fronts[2].h).toBe(200);
    // 도어 = 몸통 − 상단 슬롯 30 − 갭 4 − 서랍 200 − 중간 슬롯 30 − 서랍 200
    expect(L.fronts[0].h).toBe(bodyH - 30 - 4 - 200 - 30 - 200);
    expect(L.fronts[L.fronts.length - 1].y1).toBe(bodyH);
  });

  test('중간 목찬넬은 서랍 1–2 사이 하나 (도어–서랍 사이는 갭 4)', () => {
    const L = fn(m, base());
    expect(L.midCount).toBe(1);
    expect(L.fronts[0].channelBelow).toBeNull();
    expect(L.fronts[1].channelBelow).toBe('mid');
    const mid = L.channels.find((c) => c.kind === 'mid');
    expect(mid).toMatchObject({ notchH: 90, notchD: 40, faceH: 72, baseW: 40 });
    expect(mid.y).toBe(L.fronts[1].y1 - RULES.DRAWER_RULES.UPPER_DROP);
  });

  test('서랍 단수는 4 로 잘린다', () => {
    const s = base(); s.drawerCount = 9;
    const L = fn(m, s);
    expect(L.fronts.filter((f) => f.kind === 'drawer')).toHaveLength(4);
  });

  test('레일 종류가 박스 크기를 바꾼다 (언더 +40 / 볼 +20)', () => {
    const under = fn(m, Object.assign(base(), { drawerRail: 'under' }));
    const ball = fn(m, Object.assign(base(), { drawerRail: 'ball' }));
    expect(under.rail).toBe('under');
    expect(ball.rail).toBe('ball');
    // 마지막 서랍 존 = 중간 따내기 바닥 ~ 지판 윗면 = (200 − 20 − 90) + ... → 규칙 파일과 같은 답
    const RL = RULES.layoutDrawerModule({ H: p.g('bodyHeightOf')(m, base()), T: 15, fronts: [{ kind: 'door' }, { kind: 'drawer', h: 200 }, { kind: 'drawer', h: 200 }], rail: 'ball' });
    expect(ball.boxes.map((b) => b.h)).toEqual(RL.boxes.map((b) => b.h));
    expect(under.boxes.every((b) => b.h <= 120)).toBe(true);
  });

  test('푸쉬·도어만·오픈 하부·서랍 0 이면 null — 예전 그대로 그린다', () => {
    expect(fn(m, Object.assign(base(), { handleType: 'push' }))).toBeNull();
    expect(fn(m, Object.assign(base(), { horizontalLayout: 'doorOnly' }))).toBeNull();
    expect(fn(m, Object.assign(base(), { bottomType: 'open' }))).toBeNull();
    expect(fn(m, Object.assign(base(), { drawerHeight: 0 }))).toBeNull();
    // 상부장은 목찬넬이 아니다 (도어 내림)
    expect(fn({ id: 'upper-0', section: 'upper', W: 600, H: 780, D: 320 }, base())).toBeNull();
  });

  test('손잡이 설명에 중간 따내기와 박스가 적힌다', () => {
    const note = p.g('handleNoteFor')(m, base());
    expect(note).toContain('중간 목찬넬 1곳');
    expect(note).toContain('90×40');
    expect(note).toContain('전면판 72');
    expect(note).toMatch(/박스: [소중대]\d+·[소중대]\d+/);
  });
});

describe('따낸 판재 — 따내기 여럿을 한 장에', () => {
  const fn = SRC.slice(SRC.indexOf('function makeNotchedPanel'), SRC.indexOf('function notchesOf'));

  test('notches 배열을 받고 아래에서 위로 판다', () => {
    expect(fn).toMatch(/function makeNotchedPanel\(T, h, d, notches, color\)/);
    expect(fn).toContain('.sort((a, b) => b.top - a.top)');
    expect(fn).toContain('THREE.Shape');
    expect(fn).not.toContain('makeBox');
  });

  test('상단 따내기는 윗선이 판 윗면이라 되돌아오지 않는다', () => {
    expect(fn).toMatch(/if \(n\.top <= 0\) reachedTop = true;/);
    expect(fn).toMatch(/if \(!reachedTop\) shape\.lineTo\(x1, y1\);/);
  });
});

describe('notchesOf — 상단은 MASTER_RULES, 중간은 레이아웃', () => {
  const fn = SRC.slice(SRC.indexOf('function notchesOf'), SRC.indexOf('function addCarcassShell'));

  test('상단 70×40 은 목찬넬일 때, 중간은 drawerLayout 의 mid 채널마다', () => {
    expect(fn).toContain('MASTER_RULES.CHANNEL_NOTCH_H');
    expect(fn).toContain('MASTER_RULES.CHANNEL_NOTCH_D');
    expect(fn).toContain("c.kind === 'mid'");
    expect(fn).toContain('top: c.y, h: c.notchH, d: c.notchD');
  });

  test('측판·칸막이가 같은 notchesOf 를 쓴다', () => {
    const shell = SRC.slice(SRC.indexOf('function addCarcassShell'), SRC.indexOf('function addWoodChannel'));
    expect(shell).toContain('const notches = notchesOf(o);');
    expect(shell).toContain('makeNotchedPanel(o.T, o.carcassH, o.D, notches, o.color)');
    const div = SRC.slice(SRC.indexOf('function addCellDividers'), SRC.indexOf('function addMidChannels'));
    expect(div).toContain('(o.woodChannel || o.drawerLayout)');
    expect(div).toContain('notchesOf(o)');
  });
});

describe('중간 목찬넬 부재 — ㄴ자 두 장, 규칙 파일 치수', () => {
  const fn = SRC.slice(SRC.indexOf('function addMidChannels'), SRC.indexOf('function addDrawerBoxes'));

  test('지면판·전면판을 상단과 같은 side 로 만든다', () => {
    expect(fn).toContain("'channelBase'");
    expect(fn).toContain("'channelFace'");
    expect(fn).toContain('CHANNEL_COLOR');
  });

  test('치수를 DadamDrawerRules 에서 가져온다 — 숫자를 박지 않는다', () => {
    expect(fn).toContain('R.CHANNEL_T');
    expect(fn).toContain('R.CHANNEL_BASE_W');
    expect(fn).toContain('R.CHANNEL_MID_FACE_H');
    const code = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code.match(/\b(?:40|72|90|18|20|30)\b/g) || []).toEqual([]);
  });

  test('전면판은 따낸 자리 안쪽에 선다 (앞 22 가 손 자리)', () => {
    expect(fn).toMatch(/frontZ\s*-\s*baseW\s*\+\s*T\s*\/\s*2/);
  });

  test('산술 — 부재가 따낸 자리를 꽉 채운다', () => {
    const R = RULES.DRAWER_RULES;
    const legH = 150, carcassH = 708, topY = legH + carcassH;
    const c = { y: 300, notchH: R.CHANNEL_MID_NOTCH_H };   // 따내기 윗선이 몸통 상단에서 300 아래
    const notchBottom = topY - c.y - c.notchH;
    const baseCy = notchBottom + R.CHANNEL_T / 2;
    const faceCy = notchBottom + R.CHANNEL_T + R.CHANNEL_MID_FACE_H / 2;
    expect(baseCy - R.CHANNEL_T / 2).toBe(notchBottom);                                   // 지면판 아랫면 = 따낸 바닥
    expect(faceCy - R.CHANNEL_MID_FACE_H / 2).toBe(baseCy + R.CHANNEL_T / 2);              // 전면판이 지면판 위에
    expect(faceCy + R.CHANNEL_MID_FACE_H / 2).toBe(topY - c.y);                             // 전면판 윗면 = 따내기 윗선
    expect(R.CHANNEL_T + R.CHANNEL_MID_FACE_H).toBe(R.CHANNEL_MID_NOTCH_H);                 // 18 + 72 = 90
  });
});

describe('서랍 박스 — 존에 레일 여유를 빼고', () => {
  const fn = SRC.slice(SRC.indexOf('function addDrawerBoxes'), SRC.indexOf('// W9-113: 다리발 4개 mesh'));

  test('레일 여유 아래(below)만큼 띄워 앉히고, 크기는 f.box 를 그대로 쓴다', () => {
    expect(fn).toContain('R.RAIL_CLEARANCE[L.rail]');
    expect(fn).toContain('topY - f.zone.bottom + rail.below');
    expect(fn).toContain('f.box.h');
    expect(fn).toContain("entityKind: 'drawerBox'");
  });
});

describe('렌더 경로 — 전면 배치를 레이아웃이 정한다', () => {
  const fn = SRC.slice(SRC.indexOf('function createModuleMesh'), SRC.indexOf('// W9-113: 다리발 4개 (하부장만)'));

  test('createModuleMesh 가 drawerLayout 을 몸통·칸막이에 넘긴다', () => {
    const assigns = SRC.match(/const drawerLayout = drawerLayoutFor\(m, s\);/g) || [];
    expect(assigns.length).toBe(1);
    expect(fn).toMatch(/addCarcassShell\([^)]*drawerLayout/);
    expect(fn).toMatch(/addCellDividers\([^)]*drawerLayout/);
  });

  test('도어는 레이아웃 세로를 쓰고 doorTopGap 을 다시 빼지 않는다', () => {
    expect(fn).toContain('Object.assign(frontSpanOf(drawerLayout, 0, legH, carcassH), { topGap: 0 })');
    expect(fn).toContain('doorTopGap: doorSpan.topGap');
  });

  test('서랍 전면은 단마다 한 장, 레이아웃이 없으면 예전 경로', () => {
    expect(fn).toContain("if (f.kind !== 'drawer') return;");
    expect(fn).toContain("drawerIdx: k - 1");
    expect(fn).toContain('} else if (drawerH > 0) {');
  });

  test('frontSpanOf — 몸통 상단에서 아래로 잰 y 를 모듈 로컬로 뒤집는다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=mn3&item=1', storage: {} });
    const L = { fronts: [{ y0: 30, y1: 274 }, { y0: 278, y1: 478 }] };
    const sp = p.g('frontSpanOf')(L, 0, 150, 708);
    expect(sp.h).toBe(244);
    expect(sp.cy + sp.h / 2).toBe(150 + 708 - 30);   // 윗변 = 몸통 상단 − 슬롯 30
  });
});

describe('우측 패널 — 서랍 레일 선택, 최대 4단', () => {
  test('레일 select 가 있고 저장·재렌더로 이어진다', () => {
    expect(SRC).toContain('id="selDrawerRail"');
    expect(SRC).toMatch(/s\.drawerRail = e\.target\.value === 'ball' \? 'ball' : 'under';/);
    expect(SRC).toContain("panelCommit('#selDrawerRail')");
  });

  test('서랍 단수 입력이 4 까지다', () => {
    expect(SRC).toMatch(/id="inpDrawerCount"/);
    expect(SRC).toMatch(/max="4" step="1" id="inpDrawerCount"/);
    expect(SRC).toMatch(/Math\.min\(4, parseInt\(e\.target\.value\) \|\| 1\)/);
  });

  test('새 구조는 언더레일로 시작한다', () => {
    expect(SRC).toMatch(/drawerRail:\s*'under'/);
  });
});
