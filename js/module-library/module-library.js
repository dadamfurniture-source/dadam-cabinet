/**
 * 모듈 라이브러리 — 미리 만들어 둔 싱크대 **개별 모듈** (docs/01-plan/module-library.plan.md).
 *
 * 크기는 사장님이 고정한 기본 폭(APPROVED_WIDTHS)이고, 내부 구조만 다르다 (도어 수 · 경첩 방향 · 서랍 비율 · 레일 · 오픈 …).
 * 모듈 정의는 **선택값만** 담는다 — 판재 치수는 언제나 기존 규칙(extractors.js · bom-*-rules.js · assembly-rules.js)이 낸다.
 * 높이·깊이는 플래너 배치 공간이 주고(addModuleToArea), 이 파일은 플래너 구조 레코드(mockup-structure.html
 * defaultStructure)에 덮어쓸 몫만 만든다.
 *
 * 검증(게이트 9개)은 test-utils/module-library/* — 실제 브리지 `_convertPlannerModules` → BOM → 조립 명세 → 조립 검사
 * → Text-to-CAD(tools/cad/build_from_spec.py) 를 모듈마다 통과해야 status 'verified' 가 된다.
 *
 * 순수 데이터 + 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamModuleLibrary`, Node(Jest)는 module.exports.
 */
(function (root, factory) {
  const drawerRules = root.DadamDrawerRules
    || (typeof require === 'function' ? require('../detaildesign/bom-drawer-rules.js') : null);
  const api = factory(drawerRules);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamModuleLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DrawerRules) {
  'use strict';

  const SCHEMA = 'dadam.module-lib/1';

  /**
   * 기본 폭 — 2026-10-23 사장님 결정 (계획 §1). 모듈 정의의 W 는 이 표에서만 고른다.
   *   door1   여닫이 1도어 (하부·상부·플랩)       450 = 도어 목표 폭 (planner-engine MASTER_RULES.DOOR_W_TARGET)
   *   door2   여닫이 2도어 (한 통에 도어 2)        900
   *   drawer  서랍장 (위 칸 + 서랍)                600 — W ≥ 800 서랍장 처짐방지목(D2 미정)을 피한다
   *   open    오픈장 · 오픈 칸                     450
   *   tall · el · homecafe                        600
   *   rice    밥솥장                               450 (bom-rice-cabinet-rules DEFAULT_OUTER 와 같다)
   */
  const APPROVED_WIDTHS = Object.freeze({
    door1: 450, door2: 900, drawer: 600, open: 450, tall: 600, el: 600, homecafe: 600, rice: 450,
  });

  /** 섹션 — 이번 범위는 싱크대 하부·상부 (키큰장 단은 4회차, 계획 §6). */
  const SECTIONS = Object.freeze(['lower', 'upper']);
  /** 경첩 방향 = 플래너 칸 열림 방향 (areaDirections) — 좌 ◀ · 우 ▶ · 위(플랩, 상부만). */
  const HINGES = Object.freeze(['left', 'right', 'up']);
  const STATUSES = Object.freeze(['verified']);
  const NEEDS_RULE_RE = /^needs-rule:\S+$/;

  /**
   * 모듈 정의. 회차마다 에이전트가 더한다 (계획 §6 백로그). 필드:
   *   id        `{LB|UB}-{D1|D2|FLAP|DR<n>|OPEN}-{W}[-변형]`
   *   rev       정의가 바뀌면 올린다
   *   group     보고서·목록 묶음 이름
   *   section   'lower' | 'upper'
   *   W         APPROVED_WIDTHS 의 값
   *   name      사장님 용어 (서랍 "N단" = 전면 장수)
   *   choice    { doors: 1|2, hinge } | { drawer: { ratio, rail?, sakuri? } } | { kind: 'open' } | { cell: 'open' }
   *   ruleRefs  선택값이 기대는 정본 (규칙 파일 · 함수)
   *   status    'verified' | 'needs-rule:<사유>'
   */
  const DOOR_REFS = Object.freeze([
    'extractors.js extractSink (몸통·도어 재단)',
    'assembly-rules.js CARCASS (뒷판·밴드·처짐방지목 자리)',
    'planner-engine.js distributeModules (도어 폭 350~600)',
  ]);
  const UPPER_REFS = Object.freeze(DOOR_REFS.concat(['assembly-rules.js 상부장 사쿠리 · 보강목 2장 · 선반 2 (D−34)']));
  const HINGE_REF = 'bom-assembly.js 외짝 경첩 방향 hingeSide = 칸 열림 방향 (2026-10-23 4-1 C)';

  const ENTRIES = Object.freeze([
    // ── 1회차: 도어장 (2026-10-24) ──────────────────────────────
    {
      id: 'LB-D1-450-L', rev: 1, group: 'lower-door', section: 'lower', W: 450,
      name: '여닫이 1도어 하부장 (좌경첩)',
      choice: { doors: 1, hinge: 'left' },
      ruleRefs: DOOR_REFS.concat([HINGE_REF]), status: 'verified',
    },
    {
      id: 'LB-D1-450-R', rev: 1, group: 'lower-door', section: 'lower', W: 450,
      name: '여닫이 1도어 하부장 (우경첩)',
      choice: { doors: 1, hinge: 'right' },
      ruleRefs: DOOR_REFS.concat([HINGE_REF]), status: 'verified',
    },
    {
      id: 'LB-D2-900', rev: 1, group: 'lower-door', section: 'lower', W: 900,
      name: '여닫이 2도어 하부장',
      choice: { doors: 2 },
      ruleRefs: DOOR_REFS.concat(['assembly-rules.js 처짐방지목 하부 W ≥ 800 1장']), status: 'verified',
    },
    {
      id: 'UB-D1-450-L', rev: 1, group: 'upper-door', section: 'upper', W: 450,
      name: '여닫이 1도어 상부장 (좌경첩)',
      choice: { doors: 1, hinge: 'left' },
      ruleRefs: UPPER_REFS.concat([HINGE_REF]), status: 'verified',
    },
    {
      id: 'UB-D1-450-R', rev: 1, group: 'upper-door', section: 'upper', W: 450,
      name: '여닫이 1도어 상부장 (우경첩)',
      choice: { doors: 1, hinge: 'right' },
      ruleRefs: UPPER_REFS.concat([HINGE_REF]), status: 'verified',
    },
    {
      id: 'UB-D2-900', rev: 1, group: 'upper-door', section: 'upper', W: 900,
      name: '여닫이 2도어 상부장',
      choice: { doors: 2 },
      ruleRefs: UPPER_REFS.concat(['assembly-rules.js 처짐방지목 상부 W ≥ 700 1장']), status: 'verified',
    },
    {
      id: 'UB-FLAP-450', rev: 1, group: 'upper-door', section: 'upper', W: 450,
      name: '플랩 상부장 (위로 열림)',
      choice: { doors: 1, hinge: 'up' },
      ruleRefs: UPPER_REFS.concat(['mockup-structure.html 칸 열림 방향 up → 브리지 doorOpen up (윗변 경첩 · 가스쇼바)']), status: 'verified',
    },
  ]);

  /** 모듈 정의가 쓰는 기본 폭 이름 (APPROVED_WIDTHS 의 키). */
  function widthKeyOf(entry) {
    const c = (entry && entry.choice) || {};
    if (c.drawer) return 'drawer';
    if (c.kind === 'open' || c.cell === 'open') return 'open';
    return c.doors === 2 ? 'door2' : 'door1';
  }

  /** 도어 수 — 플래너 distributeModules 와 맞춰 보는 값 (서랍장·오픈 칸도 칸 하나 = 도어 폭 하나). */
  function doorsOf(entry) {
    const c = (entry && entry.choice) || {};
    return c.doors === 2 ? 2 : 1;
  }

  /**
   * 형식 검사 — 선택값만 있는지, 폭이 승인된 값인지. 규칙·BOM 검증은 test-utils/module-library/validate.js.
   * @returns {string[]} 문제 목록 (비면 통과)
   */
  function problemsOf(entry) {
    const out = [];
    const e = entry || {};
    if (!/^(LB|UB)-[A-Z0-9]+-\d+(-[A-Z0-9]+)*$/.test(String(e.id || ''))) out.push(`id 형식: ${e.id}`);
    if (!Number.isInteger(e.rev) || e.rev < 1) out.push('rev 는 1 이상 정수');
    if (SECTIONS.indexOf(e.section) < 0) out.push(`section: ${e.section}`);
    if (!e.name || !e.group) out.push('name · group 이 있어야 한다');
    if (!Array.isArray(e.ruleRefs) || !e.ruleRefs.length) out.push('ruleRefs 가 있어야 한다');
    if (STATUSES.indexOf(e.status) < 0 && !NEEDS_RULE_RE.test(String(e.status || ''))) out.push(`status: ${e.status}`);
    const c = e.choice;
    if (!c || typeof c !== 'object') { out.push('choice 가 없다'); return out; }
    const known = ['doors', 'hinge', 'drawer', 'kind', 'cell'];
    Object.keys(c).forEach((k) => { if (known.indexOf(k) < 0) out.push(`choice.${k} 는 모르는 선택값`); });
    if (e.W !== APPROVED_WIDTHS[widthKeyOf(e)]) out.push(`W ${e.W} ≠ 승인된 ${widthKeyOf(e)} 폭 ${APPROVED_WIDTHS[widthKeyOf(e)]}`);
    if (c.drawer) {
      if (e.section !== 'lower') out.push('서랍장은 하부만');
      const d = c.drawer;
      Object.keys(d).forEach((k) => { if (['ratio', 'rail', 'sakuri'].indexOf(k) < 0) out.push(`choice.drawer.${k} 는 모르는 선택값`); });
      if (d.rail != null && d.rail !== 'under' && d.rail !== 'ball') out.push(`rail: ${d.rail}`);
      if (DrawerRules) {
        const r = DrawerRules.gradesFromRatio(d.ratio);
        if (r.error) out.push(`ratio: ${r.error}`);
      }
    } else if (c.kind === 'open') {
      if (e.section !== 'lower') out.push('오픈장(moduleKind open)은 하부만 — 상부는 오픈 칸(cell open)');
    } else if (c.cell === 'open') {
      if (c.doors != null || c.hinge != null) out.push('오픈 칸에는 도어·경첩이 없다');
    } else {
      if (c.doors !== 1 && c.doors !== 2) out.push(`doors: ${c.doors}`);
      if (c.doors === 1 && HINGES.indexOf(c.hinge) < 0) out.push(`hinge: ${c.hinge}`);
      if (c.doors === 2 && c.hinge != null) out.push('2도어는 경첩 방향을 고르지 않는다');
      if (c.hinge === 'up' && e.section !== 'upper') out.push('플랩(위로 열림)은 상부만');
    }
    return out;
  }

  /**
   * 플래너 구조 레코드에 덮어쓸 몫 (mockup-structure.html defaultStructure 의 키 + drawerCount).
   * 플래너 화면이 같은 선택을 할 때 쓰는 값과 같다:
   *   서랍장   칸 타입 '서랍' → areaTypes ['door'] · horizontalLayout 'doorTopDrawerBottom' · bottomType 'drawer'
   *            전면 비율 입력 → DadamDrawerRules.gradesFromRatio → drawerCount · drawer.{doorGrade, grades}
   *   열림 방향 → areaDirections · 양문 → areaIs2D · 칸 폭 → areaWidths [W] (자동계산이 한 칸에 주는 값)
   * 선반(shelves)·다리발(legH)·손잡이 위치는 덮지 않는다 — addModuleToArea 가 섹션·몸통 높이로 정한다.
   */
  function structureOf(entry) {
    const c = entry.choice || {};
    const s = {
      moduleKind: c.kind === 'open' ? 'open' : 'normal',
      verticalCount: 1,
      horizontalLayout: 'doorOnly',
      areaTypes: [c.cell === 'open' ? 'open' : 'door'],
      areaDirections: [c.hinge === 'right' || c.hinge === 'up' ? c.hinge : 'left'],
      areaWidths: [entry.W],
      areaIs2D: [c.doors === 2],
    };
    if (c.drawer) {
      const r = DrawerRules.gradesFromRatio(c.drawer.ratio);
      if (r.error) throw new Error(`${entry.id}: ${r.error}`);
      s.horizontalLayout = 'doorTopDrawerBottom';
      s.bottomType = 'drawer';
      s.drawerCount = r.drawerCount;
      s.drawer = {
        rail: c.drawer.rail === 'ball' ? 'ball' : 'under',
        sakuri: !!c.drawer.sakuri,
        boxT: 0,
        grades: r.grades,
        doorGrade: r.doorGrade,
      };
    }
    return s;
  }

  function byId(id) {
    return ENTRIES.find((e) => e.id === id) || null;
  }

  /** @param {{section?: string, status?: string}} [q] */
  function list(q) {
    const o = q || {};
    return ENTRIES.filter((e) => (!o.section || e.section === o.section) && (!o.status || e.status === o.status));
  }

  return {
    SCHEMA, APPROVED_WIDTHS, SECTIONS, HINGES, ENTRIES,
    widthKeyOf, doorsOf, problemsOf, structureOf, byId, list,
  };
});
