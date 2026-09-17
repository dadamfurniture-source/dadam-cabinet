/**
 * 붙박이장 통 내부 구조 규칙 (2026-09-16 사장님 확정 기본 구조 샘플 — docs/design-rules/wardrobe.md §1.1).
 *
 * 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamWardrobeRules`, Node(Jest)는 module.exports.
 * bom-drawer-rules.js 와 같은 자리다: 여기가 정본이고 BOM(extractors.js)·플래너(mockup-structure)가 이 파일을 읽는다.
 *
 * ── 왜 새 표현이 필요했나 ────────────────────────────────────────
 * 기존 모델은 통 하나에 `moduleType(짧은옷·긴옷·선반형)` + 선반수·서랍수를 **평면 필드**로 달았다.
 * 그 그릇에는 사장님 기본형의 두 가지가 들어가지 않는다:
 *   · 3번 통 — 중간 칸막이로 **좌우** 반 분할 (450 + 450)
 *   · 4번 통 — 상단은 통째, **하부만 옆으로** 분할 (선반 3단 | 짧은 옷봉)
 * 그래서 통 내부를 **칸 사각형 목록**으로 잡는다. 칸막이는 저장하지 않고 칸 경계에서 도출한다 —
 * 칸과 칸막이를 따로 저장하면 둘이 어긋난 상태가 저장될 수 있다.
 *
 * ── 좌표 ─────────────────────────────────────────────────────────
 * 칸은 **내경 좌표**다. x 는 좌측 측판 안쪽 면에서 오른쪽으로, y 는 **지판 윗면에서 위로** (플래너 shelves 와 같은 방향).
 *   내경 폭   Wi = W − 2×T
 *   내경 높이 Hi = 몸통높이 − 2×T          (몸통높이 = 전체높이 − 좌대 − 상몰딩, wardrobe.md §2)
 * 외부 서랍은 통 **아래에 별도 캐비닛**으로 서므로(§7) 그 높이만큼 몸통이 줄고, 칸은 줄어든 내경 안에 든다.
 *
 * ── 부재 치수 관례 ───────────────────────────────────────────────
 * extractors.add(…, 두께, 가로, 세로, …) 의 가로·세로는 **판을 켜는 방향**이다. 기존 코드를 따른다:
 *   측판   가로 = 깊이 D,        세로 = 높이   → 세로 칸막이도 같다 (가로 D, 세로 칸 높이)
 *   천지판 가로 = W − 2×T,       세로 = D − 18 → 수평 칸막이도 같다 (문서 §11 중간칸막이 행)
 *   선반   가로 = 칸 폭,         세로 = D − 18 − 70 (§6 선반 깊이)
 *
 * ── 문서에 없어 규칙을 세운 것 ───────────────────────────────────
 * 옷봉은 지금까지 **도면에만** 있었다 (자재·철물 어디에도 없어 발주에서 빠졌다). 여기서 파이프 + 소켓 2EA 로 낸다.
 * 파이프 길이는 칸 내경 폭 그대로다 — 절단 여유·지름·품명은 확인이 필요하므로 행 비고에 남긴다(ROD_NOTE).
 * 세로 칸막이도 문서 §11 에 없다 (§11 중간칸막이는 짧은옷의 **수평** 판이다). 측판과 같은 판으로 본다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamWardrobeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WARDROBE_RULES = Object.freeze({
    PANEL_T: 15,                  // 천판·지판·선반·칸막이 두께 (§5 PANEL_THICKNESS)
    ROD_OFFSET: 75,               // 옷봉 — 칸 상단에서 아래로 (§5)
    LONG_FIRST_SHELF: 315,        // 긴옷 첫 선반 — 칸 상단에서 아래로 (§5)
    DRAWER_MOD_H: 350,            // 외부 서랍 한 단 (§7)
    MAX_DRAWER_COUNT: 5,          // §7 서랍 0~5
    TOP_BOTTOM_D_MINUS: 18,       // 천저판 깊이 = D − 18 (사쿠리, §6)
    SHELF_D_MINUS: 70,            // 선반은 천저판보다 70 짧다 (§6)
    PEDESTAL_H: 60,               // 좌대 (§1)
    MOLDING_H: 20,                // 상몰딩 (§1 · DEFAULT_SPECS.wardrobeMoldingH)
    DEFAULT_D: 620,               // 2026-09-16: 600 → 620 (data-constants CATEGORIES.wardrobe.defaultD)
    DEFAULT_H: 2310,
    SAMPLE_CELL_W: 900,           // 기본형 통 폭 (§1.1) — 유효폭 3600 이면 자동계산도 이 값이 나온다
    MIN_CELL_W: 200,              // 이보다 좁은 칸은 만들 수 없다 — 경고하고 분할을 접는다
    ROD_SOCKETS_PER_ROD: 2,
    ROD_NOTE: '[확인 필요] 옷봉 파이프 지름·품명·절단 여유 미확정 — 길이는 칸 내경 폭',
  });

  const R = WARDROBE_RULES;

  // ── 값 다듬기 ────────────────────────────────────────────────
  const num = (v, dflt) => (Number.isFinite(Number(v)) && Number(v) !== 0 ? Number(v) : dflt);
  const int0 = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const near = (a, b) => Math.abs(a - b) < 0.5;
  const overlaps = (a0, a1, b0, b1) => a0 < b1 - 0.5 && b0 < a1 - 0.5;

  /** 칸 종류 — 무엇이 들어가는 칸인가. 도어·서랍 전면과는 다른 축이다 (칸은 통 **안**이다). */
  const CELL_KINDS = Object.freeze(['rod', 'shelf', 'open']);

  function cleanCell(c) {
    if (!c || typeof c !== 'object') return null;
    const w = Number(c.w) || 0;
    const h = Number(c.h) || 0;
    if (w <= 0 || h <= 0) return null;
    return {
      x0: Math.max(0, Number(c.x0) || 0),
      y0: Math.max(0, Number(c.y0) || 0),
      w, h,
      kind: CELL_KINDS.includes(c.kind) ? c.kind : 'open',
      shelves: int0(c.shelves, 12),
      rods: int0(c.rods, 1),
      label: typeof c.label === 'string' ? c.label : '',
    };
  }

  // ── 프리셋 ───────────────────────────────────────────────────
  //
  // 앞 네 개가 사장님 기본형의 1~4번 통이다 (§1.1). 다섯째는 기존 선반형, 여섯째는 직접 편집.
  // build(o) 는 내경 {Wi, Hi, T, drawers} 를 받아 칸 목록을 낸다. 나눌 자리가 없으면 분할을 접고 경고한다.

  /**
   * 수평 2단 — 아래·위 칸 높이. 분리형 기본값과 같다 (§2 halfH).
   * 홀수로 안 나뉘면 **위 칸이 나머지를 먹는다.** 높이는 부재 치수를 바꾸지 않으므로(선반·옷봉은 칸 폭으로 켠다)
   * 1mm 를 남겨 두는 것보다 채우는 편이 낫다.
   */
  function halfRows(Hi, T) {
    const h = Math.floor((Hi - T) / 2);
    return [{ y0: 0, h }, { y0: h + T, h: Hi - h - T }];
  }

  /**
   * 세로 2칸 — 왼쪽·오른쪽 칸 폭. **두 칸을 같은 폭으로** 맞추고 남는 1mm 는 조립 여유로 둔다.
   * 나머지를 한쪽에 몰면 427·428 처럼 갈려 선반·옷봉이 두 가지 치수가 되고 통이 비뚤어 보인다
   * (플래너도 모듈당 1mm 는 조립 여유로 그냥 둔다 — planner-engine distributeModules W12-73).
   */
  function halfCols(Wi, T) {
    const w = Math.floor((Wi - T) / 2);
    return [{ x0: 0, w }, { x0: w + T, w }];
  }

  const PRESETS = Object.freeze([
    {
      key: 'short2',
      label: '짧은옷 2단',
      note: '기본형 1번 통 — 상·하 각 옷봉 1',
      moduleType: 'short',
      build: ({ Wi, Hi, T }) => halfRows(Hi, T).map((r, i) => ({
        x0: 0, w: Wi, y0: r.y0, h: r.h, kind: 'rod', rods: 1, shelves: 0,
        label: i === 0 ? '하부 옷봉' : '상부 옷봉',
      })),
    },
    {
      key: 'longDrawer',
      label: '긴옷 + 하부 서랍',
      note: '기본형 2번 통 — 상단 선반 1 + 옷봉 1, 아래 외부 서랍',
      moduleType: 'long',
      drawers: 2,
      build: ({ Wi, Hi }) => [
        { x0: 0, w: Wi, y0: 0, h: Hi, kind: 'rod', rods: 1, shelves: 1, label: '긴옷' },
      ],
    },
    {
      key: 'halfSplit',
      label: '반 분할 (중간 칸막이)',
      note: '기본형 3번 통 — 세로 칸막이로 반, 각 칸 선반 1 + 옷봉 1',
      moduleType: 'long',
      build: ({ Wi, Hi, T }) => halfCols(Wi, T).map((c, i) => ({
        x0: c.x0, w: c.w, y0: 0, h: Hi, kind: 'rod', rods: 1, shelves: 1,
        label: i === 0 ? '좌' : '우',
      })),
    },
    {
      key: 'rodTopSplitBottom',
      label: '상단 옷봉 + 하부 옆 분할',
      note: '기본형 4번 통 — 위는 통째 옷봉, 아래는 선반 3단 | 짧은 옷봉',
      moduleType: 'short',
      build: ({ Wi, Hi, T }) => {
        const [lower, upper] = halfRows(Hi, T);
        const cols = halfCols(Wi, T);
        return [
          { x0: cols[0].x0, w: cols[0].w, y0: lower.y0, h: lower.h, kind: 'shelf', shelves: 3, rods: 0, label: '하부 선반' },
          { x0: cols[1].x0, w: cols[1].w, y0: lower.y0, h: lower.h, kind: 'rod', shelves: 0, rods: 1, label: '하부 짧은옷' },
          { x0: 0, w: Wi, y0: upper.y0, h: upper.h, kind: 'rod', shelves: 0, rods: 1, label: '상부 옷봉' },
        ];
      },
    },
    {
      key: 'shelf22',
      label: '선반형 (상 2 · 하 2)',
      note: '기존 선반형 기본값 (§4 shelf)',
      moduleType: 'shelf',
      build: ({ Wi, Hi, T }) => halfRows(Hi, T).map((r, i) => ({
        x0: 0, w: Wi, y0: r.y0, h: r.h, kind: 'shelf', shelves: 2, rods: 0,
        label: i === 0 ? '하부 선반' : '상부 선반',
      })),
    },
    {
      key: 'custom',
      label: '사용자',
      note: '칸을 직접 편집한 상태 — 프리셋이 다시 덮어쓰지 않는다',
      moduleType: null,
      build: () => [],
    },
  ]);

  const PRESET_KEYS = Object.freeze(PRESETS.map((p) => p.key));
  const PRESET_DEFAULT = 'short2';
  /** 기본형 4통 배치 (§1.1) — 통 수가 다르면 앞에서부터 쓰고 마지막을 되쓴다. */
  const SAMPLE_PRESETS = Object.freeze(['short2', 'longDrawer', 'halfSplit', 'rodTopSplitBottom']);

  const presetOf = (key) => PRESETS.find((p) => p.key === key) || null;
  const presetKeyOf = (key) => (presetOf(key) ? key : PRESET_DEFAULT);
  const presetLabel = (key) => (presetOf(key) || {}).label || '';
  /** 프리셋을 옛 moduleType 으로 — 옛 경로(extractWardrobe 분리형/통장)를 그대로 쓸 수 있는지 판정용. */
  const moduleTypeOf = (key) => ((presetOf(key) || {}).moduleType || null);

  /** 통 번호(0부터)에 기본형 프리셋을 배정한다. */
  function samplePresetFor(idx, count) {
    const n = Number(count) > 0 ? Number(count) : SAMPLE_PRESETS.length;
    const i = Math.max(0, Math.round(Number(idx) || 0));
    if (n <= SAMPLE_PRESETS.length) return SAMPLE_PRESETS[Math.min(i, n - 1)];
    return SAMPLE_PRESETS[Math.min(i, SAMPLE_PRESETS.length - 1)];
  }

  /** 모듈에 붙는 붙박이장 구조 블록을 다듬는다. 모르는 값은 버린다 (브리지·저장이 이 모양으로 주고받는다). */
  function normalizeBlock(raw) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const preset = PRESET_KEYS.includes(b.preset) ? b.preset : null;
    const cells = Array.isArray(b.cells) ? b.cells.map(cleanCell).filter(Boolean) : [];
    const drawers = int0(b.drawers, R.MAX_DRAWER_COUNT);
    return {
      preset,
      cells: cells.length ? cells : null,
      drawers: Number.isFinite(Number(b.drawers)) ? drawers : null,
      externalDrawer: b.externalDrawer == null ? null : !!b.externalDrawer,
    };
  }

  // ── 몸통 치수 ────────────────────────────────────────────────

  /** 몸통 높이 = 전체높이 − 좌대 − 상몰딩 (§2). bodyH 를 직접 주면 그대로 쓴다. */
  function bodyHeightOf(o) {
    if (Number(o.bodyH) > 0) return Number(o.bodyH);
    const totalH = num(o.totalH, R.DEFAULT_H);
    const pedestalH = Number.isFinite(Number(o.pedestalH)) ? Number(o.pedestalH) : R.PEDESTAL_H;
    const moldingH = Number.isFinite(Number(o.moldingH)) ? Number(o.moldingH) : R.MOLDING_H;
    return totalH - pedestalH - moldingH;
  }

  const thicknessOf = (o) => num(o && o.T, R.PANEL_T);
  const depthOf = (o) => num(o && o.D, R.DEFAULT_D);
  /** 천저판 깊이 — 사쿠리 반영 (§6). 칸막이·선반이 이 깊이를 기준으로 잡힌다. */
  const innerDepthOf = (o) => depthOf(o) - R.TOP_BOTTOM_D_MINUS;
  const shelfDepthOf = (o) => innerDepthOf(o) - R.SHELF_D_MINUS;

  // ── 칸 → 칸막이 ──────────────────────────────────────────────

  /**
   * 칸 경계에서 칸막이를 도출한다. 두 칸이 두께 T 만큼 떨어져 마주 보면 그 사이에 판이 하나 선다.
   * 같은 자리에 여러 쌍이 걸리면 span 을 합친다 — 4번 통 하부처럼 칸이 여럿이어도 판은 한 장이다.
   */
  function dividersOf(cells, o) {
    const T = thicknessOf(o);
    const d = innerDepthOf(o);
    const vert = new Map();
    const horiz = new Map();
    for (let i = 0; i < cells.length; i++) {
      for (let j = 0; j < cells.length; j++) {
        if (i === j) continue;
        const a = cells[i];
        const b = cells[j];
        const aRight = a.x0 + a.w;
        const aTop = a.y0 + a.h;
        if (near(aRight + T, b.x0) && overlaps(a.y0, aTop, b.y0, b.y0 + b.h)) {
          const cur = vert.get(aRight) || { y0: Infinity, y1: -Infinity };
          vert.set(aRight, {
            y0: Math.min(cur.y0, a.y0, b.y0),
            y1: Math.max(cur.y1, aTop, b.y0 + b.h),
          });
        }
        if (near(aTop + T, b.y0) && overlaps(a.x0, aRight, b.x0, b.x0 + b.w)) {
          const cur = horiz.get(aTop) || { x0: Infinity, x1: -Infinity };
          horiz.set(aTop, {
            x0: Math.min(cur.x0, a.x0, b.x0),
            x1: Math.max(cur.x1, aRight, b.x0 + b.w),
          });
        }
      }
    }
    const out = [];
    [...vert.keys()].sort((p, q) => p - q).forEach((x) => {
      const s = vert.get(x);
      // 측판 관례 — 가로 = 깊이, 세로 = 높이
      out.push({ axis: 'v', part: '세로칸막이', x, y0: s.y0, h: s.y1 - s.y0, t: T, w: d, cutW: d, cutH: s.y1 - s.y0 });
    });
    [...horiz.keys()].sort((p, q) => p - q).forEach((y) => {
      const s = horiz.get(y);
      // 천지판 관례 — 가로 = 폭, 세로 = 깊이
      out.push({ axis: 'h', part: '중간칸막이', y, x0: s.x0, w: s.x1 - s.x0, t: T, cutW: s.x1 - s.x0, cutH: d });
    });
    return out;
  }

  // ── 칸 안 — 선반·옷봉 위치 ──────────────────────────────────

  /**
   * 칸 안 선반 위치 (칸 바닥에서 선반 **밑면**까지, §6).
   * 옷봉이 있는 칸은 긴옷 규칙 — 첫 선반이 칸 상단에서 315 아래에 고정되고 나머지는 그 아래 균등.
   * 옷봉이 없으면 일반 규칙 — 판 두께를 뺀 나머지를 균등 분배.
   */
  function shelfPositions(cell, o) {
    const T = thicknessOf(o);
    const n = int0(cell.shelves, 12);
    if (n <= 0) return [];
    const out = [];
    if (cell.rods > 0) {
      const first = cell.h - R.LONG_FIRST_SHELF;
      if (first <= 0) return [];
      out.push(first);
      if (n > 1) {
        const usable = first - (n - 1) * T;
        const gap = usable / n;
        for (let i = 1; i < n; i++) out.push(Math.round(first - i * (gap + T)));
      }
      return out.filter((y) => y > 0).map((y) => Math.round(y));
    }
    const usable = cell.h - n * T;
    const gap = usable / (n + 1);
    for (let i = 0; i < n; i++) out.push(Math.round((i + 1) * gap + i * T));
    return out;
  }

  /** 칸 안 옷봉 위치 (칸 바닥에서 봉 중심까지) — 칸 상단에서 75 아래 (§5). */
  function rodPositions(cell) {
    const n = int0(cell.rods, 1);
    if (n <= 0) return [];
    const y = cell.h - R.ROD_OFFSET;
    return y > 0 ? [Math.round(y)] : [];
  }

  // ── 통 하나의 배치 ───────────────────────────────────────────

  /**
   * 통 하나의 내부 배치.
   *
   * @param {object} o
   *   W               통 외경 폭
   *   totalH|bodyH    전체높이(좌대·상몰딩 포함) 또는 몸통높이
   *   D               깊이 (기본 620)
   *   T               판 두께 (기본 15)
   *   pedestalH·moldingH  기본 60 · 20
   *   preset          프리셋 키. 'custom' 이거나 cells 를 주면 그 칸을 쓴다
   *   cells           직접 편집한 칸 목록
   *   drawers         외부 서랍 단수 (없으면 프리셋 기본값)
   * @returns {{preset, cells, dividers, rods, shelves, drawerModH, bodyH, Wi, Hi, warnings}}
   */
  function layoutWardrobeModule(o) {
    const opt = o || {};
    const T = thicknessOf(opt);
    const W = num(opt.W, R.SAMPLE_CELL_W);
    const warnings = [];
    const key = presetKeyOf(opt.preset);
    const preset = presetOf(key);

    const drawers = Number.isFinite(Number(opt.drawers))
      ? int0(opt.drawers, R.MAX_DRAWER_COUNT)
      : int0(preset.drawers, R.MAX_DRAWER_COUNT);
    const drawerModH = drawers * R.DRAWER_MOD_H;

    const fullBodyH = bodyHeightOf(opt);
    const bodyH = fullBodyH - drawerModH;      // 외부 서랍은 아래에 따로 선다 (§7)
    const Wi = W - 2 * T;
    const Hi = bodyH - 2 * T;
    if (Hi <= 0) {
      warnings.push(`서랍 ${drawers}단(${drawerModH})을 빼면 몸통 높이가 ${bodyH} 로 남지 않는다`);
      return { preset: key, cells: [], dividers: [], rods: [], shelves: [], drawerModH, drawers, bodyH, fullBodyH, Wi, Hi, T, warnings };
    }

    let cells = Array.isArray(opt.cells) ? opt.cells.map(cleanCell).filter(Boolean) : [];
    if (!cells.length) cells = preset.build({ Wi, Hi, T, drawers }).map(cleanCell).filter(Boolean);

    // 너무 좁은 칸이 나오면 분할을 접는다 — 만들 수 없는 판을 BOM 으로 내지 않는다.
    const narrow = cells.filter((c) => c.w < R.MIN_CELL_W);
    if (narrow.length) {
      warnings.push(`칸 폭 ${narrow.map((c) => c.w).join('·')} 가 최소 ${R.MIN_CELL_W} 미만 — 세로 분할을 접는다`);
      const rows = new Map();
      cells.forEach((c) => {
        const k = `${c.y0}:${c.h}`;
        const cur = rows.get(k);
        if (!cur || c.x0 < cur.x0) rows.set(k, Object.assign({}, c, { x0: 0, w: Wi }));
      });
      cells = [...rows.values()];
    }

    cells.sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
    const dividers = dividersOf(cells, opt);

    const shelves = [];
    const rods = [];
    cells.forEach((c, idx) => {
      shelfPositions(c, opt).forEach((y) => shelves.push({
        cell: idx, x0: c.x0, y: y + c.y0, w: c.w, cutW: c.w, cutH: shelfDepthOf(opt), t: T, part: '선반',
      }));
      rodPositions(c).forEach((y) => rods.push({
        cell: idx, x0: c.x0, y: y + c.y0, length: c.w, sockets: R.ROD_SOCKETS_PER_ROD, part: '옷봉',
      }));
      if (c.shelves > 0 && c.rods > 0 && c.h <= R.LONG_FIRST_SHELF) {
        warnings.push(`칸 ${idx + 1} 높이 ${c.h} 는 긴옷 첫 선반 ${R.LONG_FIRST_SHELF} 보다 낮아 선반이 빠졌다`);
      }
    });

    return {
      preset: key, label: preset.label, moduleType: preset.moduleType,
      cells, dividers, shelves, rods,
      drawers, drawerModH, bodyH, fullBodyH, Wi, Hi, T, W,
      shelfDepth: shelfDepthOf(opt), innerDepth: innerDepthOf(opt),
      warnings,
    };
  }

  /**
   * 배치에서 **새로 생기는** 부재만 낸다 — 칸막이·선반·옷봉.
   * 몸통(측판·천지판·뒷판)·도어·서랍은 기존 extractWardrobe 가 이미 낸다. 여기서 또 내면 두 벌이 된다.
   */
  function partsOf(layout) {
    const rows = [];
    (layout.dividers || []).forEach((d) => rows.push({
      part: d.part, material: 'PB', t: d.t, w: d.cutW, h: d.cutH, qty: 1, edge: '1면(전)',
      note: d.axis === 'v' ? '세로 칸막이 — 천판~지판 전체' : '수평 칸막이',
    }));
    const byShelf = new Map();
    (layout.shelves || []).forEach((s) => {
      const k = `${s.cutW}x${s.cutH}`;
      byShelf.set(k, (byShelf.get(k) || 0) + 1);
    });
    byShelf.forEach((qty, k) => {
      const [w, h] = k.split('x').map(Number);
      rows.push({ part: '선반', material: 'PB', t: layout.T, w, h, qty, edge: '1면(전)', note: '' });
    });
    return rows;
  }

  /** 옷봉 철물 — 파이프와 소켓. 규격이 미확정이라 비고에 [확인 필요] 를 붙인다. */
  function rodHardwareOf(layout) {
    const rods = layout.rods || [];
    if (!rods.length) return [];
    const byLen = new Map();
    rods.forEach((r) => byLen.set(r.length, (byLen.get(r.length) || 0) + 1));
    const out = [];
    byLen.forEach((qty, length) => {
      out.push({ name: '옷봉', spec: `${length}mm`, qty, unit: 'EA', note: R.ROD_NOTE });
    });
    out.push({
      name: '옷봉 소켓', spec: '-', qty: rods.length * R.ROD_SOCKETS_PER_ROD, unit: 'EA',
      note: `[확인 필요] 품명 미확정 — 옷봉 1개당 ${R.ROD_SOCKETS_PER_ROD}EA`,
    });
    return out;
  }

  return {
    WARDROBE_RULES, PRESETS, PRESET_KEYS, PRESET_DEFAULT, SAMPLE_PRESETS, CELL_KINDS,
    layoutWardrobeModule, normalizeBlock, dividersOf, shelfPositions, rodPositions,
    partsOf, rodHardwareOf, bodyHeightOf, shelfDepthOf, innerDepthOf,
    presetOf, presetKeyOf, presetLabel, moduleTypeOf, samplePresetFor,
  };
});
