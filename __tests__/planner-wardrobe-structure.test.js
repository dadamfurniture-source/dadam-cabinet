/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, beforeEach */
/**
 * 붙박이장 통 내부 구조 — 플래너 개별 모듈 패널 (docs/design-rules/wardrobe.md §1.3).
 *
 * 지키는 계약:
 *   1) 붙박이장 통을 고르면 "붙박이장 구조" 섹션이 뜨고, 선반 mm·서랍 단수 섹션은 **꺼진다**
 *      (두 규칙이 같은 칸을 놓고 다투지 않게)
 *   2) 고르지 않았으면 **기본형**이 기본값이다 — 통 번호가 프리셋을 정한다 (사진을 기본형으로)
 *   3) 프리셋 변경은 초안에만 닿는다 — 적용해야 플래너에 들어가고 새로고침을 견딘다
 *   4) 미리보기가 칸막이·선반·옷봉을 그린다 — 3D 와 같은 레이아웃 함수를 쓴다
 *   5) 붙박이장이 아닌 모듈은 예전 그대로다
 */
const fs = require('fs');
const path = require('path');
const { bootPlanner } = require('../test-utils/planner-harness');
const { PLANNER_SECTIONS } = require('../js/planner/planner-sections');
const WR = require('../js/detaildesign/bom-wardrobe-rules.js');

const ROOT = path.join(__dirname, '..');
const SCOPE = '::w1:3';
const SAVED_AT = '2026-09-17T00:00:00.000Z';
const TOKEN = 'dadam_gen_autocalc_v1' + SCOPE;

function wardrobeLayout(w) {
  const s = PLANNER_SECTIONS.wardrobe;
  return {
    version: 1, savedAt: SAVED_AT, person: { cx: 1800, cy: 1500 },
    modules: [{ section: 'wardrobe', x: 0, y: 0, w: w || s.w, h: s.h, moduleH: s.moduleH, rotation: 0, finishings: [] }],
  };
}

/** 붙박이장 4통이 선 구조 단계. 자동계산 토큰으로 통을 세운다 (3600 → 900 네 통). */
function boot(extraStorage) {
  const p = bootPlanner('mockup-structure.html', {
    search: '?design=w1&item=3',
    storage: Object.assign({ ['dadam_layout_v1' + SCOPE]: JSON.stringify(wardrobeLayout()) }, extraStorage || {}),
    session: { [TOKEN]: '1' },
  });
  if (p.errors.length) throw new Error('부팅 실패: ' + p.errors.map((e) => e.message).join(' | '));
  return p;
}

const wardrobeModules = (p) => p.g('modules')
  .filter((m) => m.section === 'wardrobe')
  .sort((a, b) => (Number(a.x) || 0) - (Number(b.x) || 0));

function pick(p, idx) {
  const m = wardrobeModules(p)[idx || 0];
  p.g('setActiveModule')(m.id);
  p.g('renderRightPanel')();
  return { m, s: p.g('getStructure')(m.id) };
}

const secOff = (p, k) => p.document.querySelector(`#modulePanel .section[data-mp="${k}"]`).classList.contains('off');
const sel = (p, q) => p.document.querySelector(q);
/** 붙박이장이 아닌 모듈 — 통 구조가 붙지 않아야 하는 쪽 (planner-mid-notch 와 같은 방식). */
const LOWER = { id: 'lower-0', section: 'lower', W: 600, H: 870, D: 550 };
/**
 * 패널이 편집하는 초안 구조. 실제 구조(getStructure)는 '적용' 전까지 손대지 않는다.
 * moduleDraftFor 는 더럽혀진 초안을 그대로 돌려준다 — 새로 만들지 않는다.
 */
const draft = (p, m) => p.g('moduleDraftFor')(m).s;

describe('통 나누기', () => {
  test('3600 은 900 네 통으로 선다 — 기본형과 같은 분할', () => {
    const p = boot();
    const ws = wardrobeModules(p);
    expect(ws).toHaveLength(4);
    ws.forEach((m) => expect(m.W).toBe(900));
    expect(ws.reduce((sum, m) => sum + m.W, 0)).toBe(3600);
  });
});

describe('패널 섹션', () => {
  test('2단 구조는 몸통 둘 — 모듈 두 개가 결합된다', () => {
    const p = boot();
    const { m, s } = pick(p, 0);
    const L = p.g('wardrobeLayoutFor')(m, s);
    expect(L.carcasses.map((c) => c.key)).toEqual(['lower', 'upper']);
    expect(L.carcasses.reduce((sum, c) => sum + c.h, 0)).toBe(p.g('bodyHeightOf')(m, s));
    expect(sel(p, '#wardrobeBody').textContent).toMatch(/몸통 2/);
  });

  test('붙박이장 통은 구조 섹션이 뜨고 선반·서랍 섹션이 꺼진다', () => {
    const p = boot();
    pick(p, 0);
    expect(p.document.getElementById('modulePanel').style.display).not.toBe('none');
    expect(secOff(p, 'wardrobe')).toBe(false);
    expect(secOff(p, 'shelves')).toBe(true);
    expect(secOff(p, 'drawer')).toBe(true);
    expect(sel(p, '#selWardrobePreset')).not.toBeNull();
  });

  test('붙박이장이 아닌 모듈은 구조 섹션이 꺼진다', () => {
    const p = boot();
    pick(p, 0);
    expect(secOff(p, 'wardrobe')).toBe(false);
    // 같은 페이지에서 하부장을 주면 꺼진다 — 섹션 표시는 section 하나로 갈린다
    p.g('syncModulePanelSections')(p.g('defaultStructure')(), LOWER);
    expect(secOff(p, 'wardrobe')).toBe(true);
    expect(secOff(p, 'shelves')).toBe(false);   // 하부장은 예전 그대로 선반을 만진다
  });
});

describe('기본형이 기본값이다', () => {
  test('통 번호가 프리셋을 정한다 — 1~4번이 사진 그대로', () => {
    const p = boot();
    [0, 1, 2, 3].forEach((i) => {
      const { m, s } = pick(p, i);
      expect(p.g('wardrobeRulesOf')(m, s).preset).toBe(WR.SAMPLE_PRESETS[i]);
      expect(sel(p, '#selWardrobePreset').value).toBe(WR.SAMPLE_PRESETS[i]);
    });
  });

  test('구조를 고르지 않아도 배치가 나온다 — 저장된 값이 없을 때도', () => {
    const p = boot();
    const { m, s } = pick(p, 2);                  // 3번 통 = 반 분할
    const L = p.g('wardrobeLayoutFor')(m, s);
    expect(L.preset).toBe('halfSplit');
    expect(L.cells).toHaveLength(2);
    expect(L.dividers.filter((d) => d.axis === 'v')).toHaveLength(1);
  });

  test('몸통 높이는 플래너 높이 모델을 쓴다 — 좌대 60 + 상몰딩 20', () => {
    const p = boot();
    const { m, s } = pick(p, 0);
    const L = p.g('wardrobeLayoutFor')(m, s);
    expect(L.fullBodyH).toBe(p.g('bodyHeightOf')(m, s));
    expect(L.fullBodyH).toBe(2310 - 60 - 20);
  });
});

describe('프리셋 바꾸기', () => {
  test('초안만 바뀐다 — 적용해야 플래너에 들어간다', () => {
    const p = boot();
    const { m, s } = pick(p, 0);
    const el = sel(p, '#selWardrobePreset');
    el.value = 'halfSplit';
    el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    expect((p.g('getStructure')(m.id).wardrobe || {}).preset).toBeUndefined();   // 실제는 그대로
    p.g('applyModuleDraft')();
    expect(p.g('getStructure')(m.id).wardrobe.preset).toBe('halfSplit');
  });

  test('프리셋을 바꾸면 직접 편집한 칸은 버린다 — 둘이 섞이면 정본이 없다', () => {
    const p = boot();
    const { m, s } = pick(p, 0);
    s.wardrobe = { preset: 'custom', cells: [{ x0: 0, y0: 0, w: 870, h: 2200, kind: 'open' }] };
    p.g('setWardrobePreset')(s, 'shelf22');
    expect(s.wardrobe.preset).toBe('shelf22');
    expect(s.wardrobe.cells).toBeNull();
  });

  test('모르는 프리셋은 기본값으로 떨어진다', () => {
    const p = boot();
    const { s } = pick(p, 0);
    p.g('setWardrobePreset')(s, '없는것');
    expect(s.wardrobe.preset).toBe(WR.PRESET_DEFAULT);
  });

  test('적용한 프리셋은 새로고침을 견딘다', () => {
    const p = boot();
    const { m } = pick(p, 1);
    const el = sel(p, '#selWardrobePreset');
    el.value = 'rodTopSplitBottom';
    el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    p.g('applyModuleDraft')();
    const keep = ['dadam_layout_v1', 'dadam_struct_modules_v1', 'dadam_structure_v1'];
    const storage = {};
    keep.forEach((k) => { storage[k + SCOPE] = p.storage.getItem(k + SCOPE); });
    const p2 = bootPlanner('mockup-structure.html', { search: '?design=w1&item=3', storage });
    expect(p2.g('getStructure')(m.id).wardrobe.preset).toBe('rodTopSplitBottom');
  });
});

describe('외부 서랍 단수', () => {
  test('어느 구조에서든 서랍을 더할 수 있다 — 입력이 항상 있다', () => {
    const p = boot();
    pick(p, 1);                                   // longDrawer — 기본 2단
    expect(sel(p, '#inpWardrobeDrawers').value).toBe('2');
    expect(sel(p, '#inpWardrobeDrawers').min).toBe('1');   // 긴옷은 최소 1단
    pick(p, 0);                                   // short2 — 기본 없음, 그래도 더할 수 있다
    expect(sel(p, '#inpWardrobeDrawers')).not.toBeNull();
    expect(sel(p, '#inpWardrobeDrawers').value).toBe('0');
    expect(sel(p, '#inpWardrobeDrawers').min).toBe('0');
  });

  test('짧은옷 2단에 서랍을 더하면 서랍 몸통이 생긴다', () => {
    const p = boot();
    const { m } = pick(p, 0);
    const el = sel(p, '#inpWardrobeDrawers');
    el.value = '2';
    el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    const L = p.g('wardrobeLayoutFor')(m, draft(p, m));
    expect(L.carcasses.map((c) => c.kind)).toEqual(['drawer', 'cabinet', 'cabinet']);
    expect(L.carcasses[0].h).toBe(2 * WR.WARDROBE_RULES.DRAWER_MOD_H);
  });

  test('단수를 바꾸면 통 높이가 따라 줄어든다', () => {
    const p = boot();
    const { m, s } = pick(p, 1);
    const before = p.g('wardrobeLayoutFor')(m, s).bodyH;
    const el = sel(p, '#inpWardrobeDrawers');
    el.value = '3';
    el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    // 패널은 **초안**을 고친다 — 실제 구조는 적용 전까지 그대로다
    const after = p.g('wardrobeLayoutFor')(m, draft(p, m)).bodyH;
    expect(after).toBe(before - WR.WARDROBE_RULES.DRAWER_MOD_H);
    expect(p.g('wardrobeLayoutFor')(m, s).bodyH).toBe(before);
  });

  test('범위를 벗어난 값은 잘린다', () => {
    const p = boot();
    const { m } = pick(p, 1);
    const el = sel(p, '#inpWardrobeDrawers');
    el.value = '99';
    el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    expect(draft(p, m).wardrobe.drawers).toBe(WR.WARDROBE_RULES.MAX_DRAWER_COUNT);
    expect(sel(p, '#inpWardrobeDrawers').value).toBe(String(WR.WARDROBE_RULES.MAX_DRAWER_COUNT));
  });
});

describe('미리보기', () => {
  const previewRects = (p) => [...p.document.querySelectorAll('#mpPreviewG rect')];

  test('칸막이·선반·옷봉을 그린다 — 3D 와 같은 레이아웃', () => {
    const p = boot();
    const { m, s } = pick(p, 2);                  // 반 분할 — 칸막이 1 · 선반 2 · 옷봉 2
    const L = p.g('wardrobeLayoutFor')(m, s);
    // 옷봉은 규칙의 25파이 굵기로 그린다 — 그 수가 레이아웃의 옷봉 수와 같다
    const dia = String(WR.WARDROBE_RULES.ROD_DIAMETER);
    expect(previewRects(p).filter((r) => r.getAttribute('height') === dia)).toHaveLength(L.rods.length);
    // 칸은 점선으로 두른다
    expect(previewRects(p).filter((r) => r.getAttribute('stroke-dasharray'))).toHaveLength(L.cells.length);
    // 몸통은 굵은 선으로 — 제작 단위가 눈에 보여야 한다
    expect(previewRects(p).filter((r) => r.getAttribute('stroke-width') === '5')).toHaveLength(L.carcasses.length);
    expect(p.errors).toEqual([]);
  });

  test('프리셋을 바꾸면 미리보기가 바로 따라간다', () => {
    const p = boot();
    pick(p, 0);                                   // 짧은옷 2단 — 칸 2
    const dashed = () => previewRects(p).filter((r) => r.getAttribute('stroke-dasharray')).length;
    expect(dashed()).toBe(2);
    const el = sel(p, '#selWardrobePreset');
    el.value = 'rodTopSplitBottom';               // 칸 3
    el.dispatchEvent(new p.window.Event('change', { bubbles: true }));
    expect(dashed()).toBe(3);
  });

  test('붙박이장이 아니면 아무것도 덧그리지 않는다', () => {
    const p = boot();
    const g = p.document.getElementById('mpPreviewG');
    g.innerHTML = '';
    p.g('drawWardrobeInterior2D')(g, LOWER, p.g('defaultStructure')(), 0, 0);
    expect(g.querySelectorAll('rect')).toHaveLength(0);
  });
});

describe('정본을 베끼지 않는다', () => {
  test('플래너는 규칙 파일을 읽는다 — 프리셋·상수를 페이지에 적지 않는다', () => {
    const src = fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8');
    expect(src).toContain('bom-wardrobe-rules.js');
    expect(src).toContain('DadamWardrobeRules');
    // 프리셋 키·옷봉 위치 같은 값은 규칙 파일에만 있어야 한다
    expect(src).not.toContain("'rodTopSplitBottom'");
    expect(src).not.toContain('ROD_OFFSET');
  });
});
