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
 * ── 통 하나는 몸통 여럿이다 (2026-09-17 사장님 확정) ────────────
 * 통(bay) 하나가 캐비닛 하나인 것이 **아니다.** 2단 구조(위·아래 짧은옷)는 상부장·하부장이
 * **각각 독립 캐비닛**이고 둘을 결합해 세운다 — 사이에 칸막이 한 장이 아니라 하부 천판 + 상부 지판 두 장이다.
 * 외부 서랍이 들어가면 **서랍 몸통도 따로** 만들어 아래에 붙인다 (§7 "서랍 모듈을 별도 제작").
 * 기존 BOM(extractWardrobe 의 isDivided 갈래)이 이미 그렇게 내고 있었다 — 규칙을 그쪽에 맞췄다.
 *
 *   통 = [서랍 몸통?] + 캐비닛 몸통 1~2   (아래에서 위로, 높이 합 = 몸통높이)
 *
 * ── 좌표 ─────────────────────────────────────────────────────────
 * 칸은 **내경 좌표**다. x 는 좌측 측판 안쪽 면에서 오른쪽으로, y 는 **위로**.
 * 칸·칸막이·선반·옷봉의 y 는 통 전체에서 **몸통 바닥(좌대 위)** 기준이고, 몸통마다 그 몸통의 지판 윗면에서 시작한다.
 *   내경 폭   Wi = W − 2×T
 *   몸통 내경 높이 = 그 몸통 높이 − 2×T     (몸통높이 합 = 전체높이 − 좌대 − 상몰딩, wardrobe.md §2)
 *
 * ── 부재 치수 관례 ───────────────────────────────────────────────
 * extractors.add(…, 두께, 가로, 세로, …) 의 가로·세로는 **판을 켜는 방향**이다. 기존 코드를 따른다:
 *   측판   가로 = 깊이 D,        세로 = 높이   → 세로 칸막이도 같다 (가로 D, 세로 칸 높이)
 *   천지판 가로 = W − 2×T,       세로 = D − 18 → 수평 칸막이도 같다 (문서 §11 중간칸막이 행)
 *   선반   가로 = 칸 폭,         세로 = D − 18 − 70 (§6 선반 깊이)
 *
 * ── 내부 서랍 (2026-09-19 사장님 확정) ───────────────────────────
 * 서랍 자체(박스·레일)는 **서랍 규칙**(bom-drawer-rules.js)을 그대로 쓴다 — 규칙을 두 벌 만들지 않는다.
 * 붙박이장에만 다른 것은 네 가지다:
 *   · 전면(도어)  15PB, **몸통 재질과 같다**. 가로·세로 모두 **모듈 외경 − 4**
 *                 (2026-09-22 사장님 확정: 세로도 외경 기준. 예전에는 세로만 내경 기준이라 기준이 갈렸다)
 *   · 좌우 몰딩   각 **60** (15PB, 몸통 재질). 문을 열 때 경첩에 걸리지 않게 모듈을 그만큼 안으로 넣는다
 *   · 앞선        붙박이장 앞선에서 **70 안쪽** — 경첩 자리
 *   · 손잡이      목찬넬이 아니라 **도어를 30 낮춰** 빈 공간을 만든다.
 *                 빈 공간 하나가 **위·아래 두 전면을 함께 연다** — 그래서 모든 전면이 빈 공간
 *                 하나에 닿아야 한다. 닿지 않는 전면은 열 수 없다.
 *                 수는 그 조건을 채우는 **최소**다: 아래에서 위로 짝을 지어 경계마다 하나씩 놓고,
 *                 짝이 없는 맨 위 전면만 상단을 쓴다 → **ceil(단수/2)** (1단 1 · 2단 1 · 3단 2 · 4단 2).
 *                 상단 빈 공간은 **필수가 아니다** (2026-09-19 사장님 확정) — 하부장 목찬넬은
 *                 연속 EP 때문에 상단이 늘 있지만, 여기는 목찬넬이 아니라 빈 공간이라 그럴 이유가 없다.
 *                 그래서 갯수가 목찬넬 규칙과 갈린다 (2단·4단이 하나 적다).
 *
 * ── 내부 서랍장은 "따로 만드는 모듈" 이다 (2026-09-19 사장님 확정) ──
 * 붙박이장 통 안에 서랍을 넣는 것이 아니라, **작은 모듈을 하나 더 만들어** 통 안에 앉힌다.
 * 만드는 방식은 일반 모듈과 같고 (측판·천판·지판·뒷판·밴드), 치수 기준만 다르다:
 *   모듈 W(외경) = 붙박이장 내경 − 120  (경첩 몰딩 60 + 60)
 *   모듈 H(외경) = 서랍 단수 × 350       (구역 높이)
 *   모듈 D       = 통 깊이 − 70          (앞선에서 물러선 만큼)
 *   도어 W       = 모듈 W − 4
 *   몸통 구성    = **하부장과 같다** — 천판이 없고 **밴드**가 상단 앞·뒤에 서고, 그 **위에 상판**이
 *                  올라간다 (2026-09-22 사장님 확정). 상판 깊이는 붙박이장 선반과 같다 (`shelfDepthOf`).
 *   모듈 외경 H  = 서랍 단수 × 350          (350 은 **모듈 전체 높이**다 — 2026-09-22 사장님 확정)
 *   상판         = 그 **위에 얹힌다** — 모듈이 차지하는 높이는 350×단수 + 상판 15.
 *                  상판은 **좌우 몰딩까지 덮는다** (2026-09-22 사장님 확정) → 가로 = 통 내경.
 *                  깊이도 선반과 같으니 결국 **분할 없는 칸의 선반과 같은 판**이다 (870 × 532).
 *   지판 깊이    = 모듈 D − 18 (사쿠리)
 * 서랍 박스(전후판·측판·우라)는 이 모듈 치수를 **서랍 규칙**(drawerBoxDims)에 넣어서 낸다 —
 * 붙박이장에만 있는 박스 규칙을 따로 두지 않는다.
 *
 * ── 문서에 없어 규칙을 세운 것 ───────────────────────────────────
 * 옷봉은 지금까지 **도면에만** 있었다 (자재·철물 어디에도 없어 발주에서 빠졌다). 여기서 철물로 낸다.
 * 규격은 2026-09-17 사장님 확정 — **크롬 25파이 파이프 + 원형소켓 2EA**, 길이는 **칸 내경 폭 − 5**.
 * 세로 칸막이도 문서 §11 에 없다 (§11 중간칸막이는 짧은옷의 **수평** 판이다). 측판과 같은 판으로 본다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamWardrobeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * 서랍 규칙(bom-drawer-rules.js) — 내부 서랍의 손잡이 빈 공간 수가 그 파일의 목찬넬 갯수 규칙과 같다.
   * 브라우저는 전역, Node 는 require. 없으면 null 이고 그때는 빈 공간을 1개로 본다 (상단 하나).
   */
  function drawerRules() {
    if (typeof DadamDrawerRules !== 'undefined') return DadamDrawerRules;
    if (typeof window !== 'undefined' && window.DadamDrawerRules) return window.DadamDrawerRules;
    if (typeof require === 'function') {
      try { return require('./bom-drawer-rules.js'); } catch (e) { return null; }
    }
    return null;
  }

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
    // 상몰딩 부재 — 2026-09-17 사장님 확정: 상몰딩 20 자리는 **60 × 18T MDF 마감재**로 설치할 수 있다.
    //   그때까지 §11 은 60 미만을 "무몰딩" 으로만 보아 부재가 하나도 나오지 않았다.
    MOLDING_FINISH_W: 60,
    MOLDING_FINISH_T: 18,
    EP_LENGTH: 2440,              // 몰딩 EP 세로 고정 (§11) — 가로가 이보다 길면 2장
    DEFAULT_D: 620,               // 2026-09-16: 600 → 620 (data-constants CATEGORIES.wardrobe.defaultD)
    DEFAULT_H: 2310,
    SAMPLE_CELL_W: 900,           // 기본형 통 폭 (§1.1) — 유효폭 3600 이면 자동계산도 이 값이 나온다
    MIN_CELL_W: 200,              // 이보다 좁은 칸은 만들 수 없다 — 경고하고 분할을 접는다
    // 옷봉 — 2026-09-17 사장님 확정. 파이프는 칸 내경 폭보다 5 짧게 자른다 (양쪽 소켓 자리).
    ROD_SOCKETS_PER_ROD: 2,
    ROD_LENGTH_MINUS: 5,
    ROD_DIAMETER: 25,
    ROD_SPEC: '크롬 25파이',
    ROD_SOCKET_NAME: '원형소켓',
    // 내부 서랍 — 2026-09-19 사장님 확정. 전면·몰딩은 15PB 몸통 재질.
    INNER_DRAWER: Object.freeze({
      SIDE_MOLDING_W: 60,   // 좌우 각 60 — 문이 경첩에 걸리지 않게 모듈을 안으로 넣는다
      FRONT_SETBACK: 70,    // 붙박이장 앞선에서 안쪽으로 (경첩 자리)
      FRONT_TRIM: 4,        // 전면 가로·세로 각 −4
      HANDLE_SLOT: 30,      // 목찬넬 대신 전면을 30 낮춘다 — 그 빈 공간이 손잡이다
      MIN_FRONT_H: 50,      // 이보다 낮은 전면은 만들 수 없다 (서랍 규칙 MIN_FRONT_H 와 같은 값)
      // 내부 서랍장 몸통 — 하부장과 같은 방식으로 만든다 (천판 없음)
      BAND_H: 70,           // 밴드 폭 — 천판 대신 상단 앞·뒤에 선다 (하부장과 같다)
      BACK_T: 2.7,          // 뒷판 MDF
      BACK_W_MINUS: 20,     // 뒷판 가로 = 모듈 외경 − 20
      BACK_H_MINUS: 1,      // 뒷판 세로 = 모듈 높이 − 1
    }),
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
   * 몸통 스택 높이 나누기 — 몫(share)대로 나누고 **맨 위가 나머지를 먹는다.**
   * 높이는 선반·옷봉 치수를 바꾸지 않으므로(그것들은 칸 폭으로 켠다) 1mm 를 남기지 않고 채운다.
   */
  function splitStack(total, shares) {
    const sum = shares.reduce((a, b) => a + b, 0) || 1;
    const out = shares.map((sh) => Math.floor((total * sh) / sum));
    out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
    return out;
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

  // 몸통(stack)은 **아래에서 위로** 적는다. cells(ctx) 는 그 몸통의 내경 {Wi, Hi, T} 를 받아
  // 그 몸통 안의 칸을 낸다 — y 는 그 몸통 지판 윗면에서 위로다.
  const PRESETS = Object.freeze([
    {
      key: 'short2',
      label: '짧은옷 2단',
      note: '기본형 1번 통 — 상·하 각 옷봉 1. 몸통 2개가 결합된다',
      moduleType: 'short',
      stack: [
        { key: 'lower', label: '하부장', share: 1,
          cells: ({ Wi, Hi }) => [{ x0: 0, w: Wi, y0: 0, h: Hi, kind: 'rod', rods: 1, shelves: 0, label: '하부 옷봉' }] },
        { key: 'upper', label: '상부장', share: 1,
          cells: ({ Wi, Hi }) => [{ x0: 0, w: Wi, y0: 0, h: Hi, kind: 'rod', rods: 1, shelves: 0, label: '상부 옷봉' }] },
      ],
    },
    {
      key: 'longDrawer',
      label: '긴옷 + 하부 서랍',
      note: '기본형 2번 통 — 상단 선반 1 + 옷봉 1. 서랍은 기본이 내부(몸통 안)다',
      moduleType: 'long',
      // 2026-09-17 사장님 확정: 긴옷 서랍은 **2단이 기본값**(기본형 사진 그대로)이고 0 도 된다.
      //   최소 제한은 걸지 않는다 — 패널에서 0 으로 내릴 수 있다.
      drawers: 2,
      // 2026-09-18 사장님 확정: 긴옷의 기본 서랍은 **내부 서랍**이다 (몸통 높이를 그대로 두고
      //   맨 아래 칸 안에 서랍모듈을 넣는다). 패널에서 외부로 바꿀 수 있다.
      external: false,
      stack: [
        { key: 'body', label: '긴옷장', share: 1,
          cells: ({ Wi, Hi }) => [{ x0: 0, w: Wi, y0: 0, h: Hi, kind: 'rod', rods: 1, shelves: 1, label: '긴옷' }] },
      ],
    },
    {
      key: 'halfSplit',
      label: '반 분할 (중간 칸막이)',
      note: '기본형 3번 통 — 세로 칸막이로 반, 각 칸 선반 1 + 옷봉 1. 몸통은 하나다',
      moduleType: 'long',
      stack: [
        { key: 'body', label: '통장', share: 1,
          cells: ({ Wi, Hi, T }) => halfCols(Wi, T).map((c, i) => ({
            x0: c.x0, w: c.w, y0: 0, h: Hi, kind: 'rod', rods: 1, shelves: 1,
            label: i === 0 ? '좌' : '우',
          })) },
      ],
    },
    {
      key: 'rodTopSplitBottom',
      label: '상단 옷봉 + 하부 옆 분할',
      note: '기본형 4번 통 — 위는 통째 옷봉, 아래는 선반 3단 | 짧은 옷봉. 몸통 2개',
      moduleType: 'short',
      stack: [
        { key: 'lower', label: '하부장', share: 1,
          cells: ({ Wi, Hi, T }) => {
            const cols = halfCols(Wi, T);
            return [
              { x0: cols[0].x0, w: cols[0].w, y0: 0, h: Hi, kind: 'shelf', shelves: 3, rods: 0, label: '하부 선반' },
              { x0: cols[1].x0, w: cols[1].w, y0: 0, h: Hi, kind: 'rod', shelves: 0, rods: 1, label: '하부 짧은옷' },
            ];
          } },
        { key: 'upper', label: '상부장', share: 1,
          cells: ({ Wi, Hi }) => [{ x0: 0, w: Wi, y0: 0, h: Hi, kind: 'rod', rods: 1, shelves: 0, label: '상부 옷봉' }] },
      ],
    },
    {
      key: 'shelf22',
      label: '선반형 (상 2 · 하 2)',
      note: '기존 선반형 기본값 (§4 shelf). 몸통 2개',
      moduleType: 'shelf',
      stack: [
        { key: 'lower', label: '하부장', share: 1,
          cells: ({ Wi, Hi }) => [{ x0: 0, w: Wi, y0: 0, h: Hi, kind: 'shelf', shelves: 2, rods: 0, label: '하부 선반' }] },
        { key: 'upper', label: '상부장', share: 1,
          cells: ({ Wi, Hi }) => [{ x0: 0, w: Wi, y0: 0, h: Hi, kind: 'shelf', shelves: 2, rods: 0, label: '상부 선반' }] },
      ],
    },
    {
      key: 'custom',
      label: '사용자',
      note: '칸을 직접 편집한 상태 — 프리셋이 다시 덮어쓰지 않는다',
      moduleType: null,
      stack: [{ key: 'body', label: '통장', share: 1, cells: () => [] }],
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
      // null·undefined 는 **미지정**이다 — 0 으로 접으면 프리셋 기본 서랍 단수를 덮어쓴다
      // (Number(null) 이 0 이고 Number.isFinite(0) 이 true 라 그렇게 새던 자리다).
      drawers: b.drawers == null || b.drawers === '' ? null : drawers,
      // 서랍 종류 — true 외부(별도 몸통) · false 내부(몸통 안). 미지정이면 규칙 기본값(외부).
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

  /**
   * 칸 안 옷봉 위치 (칸 바닥에서 봉 중심까지).
   *
   * 2026-09-17 사장님 확정: **선반이 있으면 최상단 선반 바로 아래**다. 옛 화면도 그렇게 적어 뒀다
   * ("옷봉 1개 자동 설치 (상단 고정선반 아래)"). 그때까지 칸 상단 기준으로 75 를 재서 옷봉이
   * 첫 선반(상단에서 315) **위**에 걸렸다 — 옷이 걸릴 수 없는 자리였다.
   * 선반이 없는 칸(짧은옷)은 칸 상단에서 75 그대로다 (§5 ROD_OFFSET).
   *
   * @param {number[]} [shelfYs] 그 칸의 선반 **밑면** y 목록 (shelfPositions 결과)
   */
  function rodPositions(cell, shelfYs) {
    const n = int0(cell.rods, 1);
    if (n <= 0) return [];
    const top = (Array.isArray(shelfYs) && shelfYs.length) ? Math.max(...shelfYs) : cell.h;
    const y = top - R.ROD_OFFSET;
    return y > 0 ? [Math.round(y)] : [];
  }

  /**
   * 상몰딩 부재 한 줄. 없으면 null.
   *
   *   moldingH >= 60      → 몰딩 폭 그대로 EP (§11 기존 규칙)
   *   0 < moldingH < 60   → `finish` 가 켜지면 **60 × 18T MDF 마감재**로 낸다 (2026-09-17 확정)
   *   그 외                → null (무몰딩)
   *
   * 붙박이장 기본 상몰딩은 20 이라 여태 아무 부재도 나오지 않았다. 20 자리를 막는 방법이
   * 60 짜리 마감재이고, **설치는 선택**이라 스위치를 둔다 (specs.wardrobeMoldingFinish).
   */
  function moldingPartFor(o) {
    const opt = o || {};
    const moldingH = Number(opt.moldingH) || 0;
    const totalW = Number(opt.totalW) || 0;
    if (moldingH <= 0 || totalW <= 0) return null;
    const qty = totalW > R.EP_LENGTH ? 2 : 1;
    if (moldingH >= R.MOLDING_FINISH_W) {
      return { part: '상몰딩', material: 'MDF', t: 18, w: moldingH, h: R.EP_LENGTH, qty, edge: '2면(장)', note: '' };
    }
    if (!opt.finish) return null;
    return {
      part: '상몰딩', material: 'MDF', t: R.MOLDING_FINISH_T, w: R.MOLDING_FINISH_W, h: R.EP_LENGTH, qty,
      edge: '2면(장)',
      note: `상몰딩 ${moldingH} — ${R.MOLDING_FINISH_W}×${R.MOLDING_FINISH_T}T MDF 마감재로 설치`,
    };
  }

  /** specs.wardrobeMoldingFinish 를 켜짐/꺼짐으로 — '1'·true·'ep60' 은 켜짐, 'none'·0·빈값은 꺼짐. */
  function moldingFinishOn(v) {
    if (v == null || v === '' || v === 0 || v === '0' || v === false) return false;
    return String(v) !== 'none';
  }

  /**
   * 손잡이 빈 공간의 **최소 배치** (2026-09-19 사장님 확정).
   *
   * 빈 공간이 경계에 있으면 위·아래 두 전면을 함께 열고, 상단(맨 위 전면 위)에 있으면 한 장만 연다.
   * 그래서 아래에서 위로 짝을 지어 경계마다 하나씩 놓고, 짝이 없는 맨 위 전면만 상단을 쓴다.
   * 결과는 `ceil(n/2)` 로 최소이며, 단수가 **짝수면 상단 빈 공간이 없다**.
   *
   * @returns {{midBelow:boolean[], top:boolean, slots:number}} midBelow[i] = 전면 i·i+1 사이 (아래→위)
   */
  function innerSlotPlan(n) {
    const midBelow = new Array(Math.max(0, n - 1)).fill(false);
    let top = false;
    for (let i = 0; i < n; i += 2) {
      if (i + 1 < n) midBelow[i] = true;   // 이 경계 하나가 전면 i 와 i+1 을 함께 연다
      else top = true;                     // 짝이 없는 맨 위 한 장 — 상단을 쓴다
    }
    return { midBelow, top, slots: midBelow.filter(Boolean).length + (top ? 1 : 0) };
  }

  /**
   * 내부 서랍 구역의 배치 — 좌우 몰딩 · 모듈 · 전면.
   *
   * 전면 수는 서랍 단수와 같고, **빈 공간(30) 수는 최소**다 (`innerSlotPlan`: ceil(n/2)).
   * 하나가 위·아래 두 전면을 열기 때문에 전면과 1:1 이 아니다.
   *
   *   모듈 내경 폭   = 통 내경 − 2 × 60
   *   모듈 내경 높이 = 구역 높이 − 2 × T        (모듈 상판·지판)
   *   전면 가로       = 모듈 내경 폭 − 4
   *   전면 높이 합    = (모듈 내경 높이 − 4) − 30 × 빈 공간 수
   *
   * @param o { Wi, zoneH, drawers, T, D, rail }
   * @returns null 이면 그릴 것이 없다 (서랍 0 또는 자리가 안 나온다)
   */
  function innerDrawerLayout(o) {
    const opt = o || {};
    const I = R.INNER_DRAWER;
    const T = thicknessOf(opt);
    const Wi = Number(opt.Wi) || 0;
    const zoneH = Number(opt.zoneH) || 0;
    const n = int0(opt.drawers, R.MAX_DRAWER_COUNT);
    if (n <= 0 || Wi <= 0 || zoneH <= 0) return null;

    const warnings = [];
    // 서랍장은 **따로 만드는 모듈**이다 — W·H 는 그 모듈의 외경이고 도어가 그보다 4 작다.
    //   2026-09-22: 몸통은 하부장과 같다 — 천판이 없고 밴드가 상단에 선다. 그 **위에 상판**이
    //   얹힌다. 350 은 **모듈 전체 높이**이므로 상판은 그 위에 더해진다 (사장님 확정) —
    //   모듈이 차지하는 높이는 350×단수 + 상판 15 다.
    const moduleW = Wi - 2 * I.SIDE_MOLDING_W;
    const topT = T;                                        // 상판도 15PB 몸통 재질
    const moduleH = zoneH;                                 // 몸통 외경 높이 = 350 × 단수 (도어 세로의 기준)
    const totalH = moduleH + topT;                         // 모듈 + 상판이 차지하는 높이
    const moduleHi = Math.max(0, moduleH - T);             // 참고용 (지판만 빠진다 — 천판이 없다)
    const moduleD = Math.max(0, depthOf(opt) - I.FRONT_SETBACK);
    const base = {
      drawers: n, moldingW: I.SIDE_MOLDING_W, moldingT: T, moldingH: zoneH,
      setback: I.FRONT_SETBACK, moduleW, moduleH, moduleHi, moduleD, zoneH, topT, totalH,
      // 지판 깊이 — 사쿠리 반영. 플래너도 이 값을 그린다 (숫자를 두 군데 적지 않는다).
      panelD: Math.max(0, moduleD - R.TOP_BOTTOM_D_MINUS),
      // 상판 — 모듈 위에 올라가고 **좌우 몰딩까지 덮는다** (2026-09-22 사장님 확정).
      //   그래서 가로는 모듈 외경(750)이 아니라 **통 내경**이고, 깊이는 선반과 같다
      //   → 분할 없는 칸의 **선반과 같은 판**이 된다 (통 900 이면 870 × 532).
      topPanelW: Wi,
      // 전면은 몸통 **외경 면**을 덮는다 — 아래·위에 트림 절반(2)씩 남는다.
      //   그림 쪽이 이 값을 써야 한다 (예전에는 지판 위에서 시작하는 줄 알고 T 만큼 띄웠다).
      frontY0: I.FRONT_TRIM / 2,
      slack: 0,
      topPanelD: Math.max(0, shelfDepthOf(opt)),
      frontT: T, fronts: [], boxes: [], slots: 0, warnings,
    };
    if (moduleW <= 0 || moduleH <= 0) {
      warnings.push(`내부 서랍 자리가 좁다 — 모듈 ${moduleW}×${moduleH} (통 내경 ${Wi} · 구역 ${zoneH})`);
      return base;
    }

    const DR = drawerRules();
    const plan = innerSlotPlan(n);
    const mids = plan.midBelow;
    const slots = plan.slots;

    // 가로·세로 모두 **외경 − 4** 다 (2026-09-22 사장님 확정).
    const frontW = moduleW - I.FRONT_TRIM;
    const area = (moduleH - I.FRONT_TRIM) - slots * I.HANDLE_SLOT;
    if (area < n * I.MIN_FRONT_H) {
      warnings.push(`서랍 ${n}단에 전면 자리가 ${area} 밖에 없다 — 한 장이 최소 ${I.MIN_FRONT_H} 은 되어야 한다`);
      return Object.assign(base, { slots, frontW });
    }

    // 아래에서 위로 쌓는다. 전면은 **모두 같은 높이**고, 나누어떨어지지 않는 1~2mm 는
    //   맨 위 여유로 흘린다 (2026-09-22 사장님 확정).
    //   예전에는 나머지를 맨 위 전면이 먹어서 2단 325·326 처럼 1mm 씩 갈렸다 —
    //   붙박이장 도어는 사람이 정면에서 보는 면이라 높이를 맞추는 쪽을 택했다.
    //   (몸통 스택 `splitStack` 은 여전히 나머지를 맨 위가 먹는다 — 그쪽은 안 보이는 판이다.)
    const each = Math.floor(area / n);
    const slack = area - each * n;
    const fronts = [];
    let y = 0;
    for (let i = 0; i < n; i++) {
      const h = each;
      // slotAbove: 이 전면 **위**에 빈 공간이 있는가 (맨 위는 상단 빈 공간이 있을 때만)
      const slotAbove = i === n - 1 ? plan.top : !!mids[i];
      fronts.push({ idx: i, y0: y, h, w: frontW, slotAbove, slotBelow: i > 0 && !!mids[i - 1] });
      y += h;
      if (i < n - 1 && mids[i]) y += I.HANDLE_SLOT;   // 그 경계의 빈 공간 (위·아래를 함께 연다)
    }
    // 빈 공간 하나가 위·아래 두 전면을 연다 — 어느 전면도 빠지면 안 된다.
    const orphan = fronts.filter((f) => !f.slotAbove && !f.slotBelow);
    if (orphan.length) {
      warnings.push(`내부 서랍 ${orphan.map((f) => f.idx + 1).join('·')}단이 손잡이 빈 공간에 닿지 않는다 — 열 수 없다`);
    }

    // 서랍 박스 — 붙박이장용 규칙을 따로 두지 않고 **서랍 규칙**에 모듈 치수를 넣는다.
    const boxes = fronts.map((f) => innerDrawerBoxOf(DR, {
      W: moduleW, D: moduleD, T, zoneH: f.h, rail: opt.rail, idx: f.idx,
    })).filter(Boolean);
    boxes.forEach((b) => {
      if (b.warnings) warnings.push(...b.warnings);
      // 전면이 낮으면 그 뒤에 박스가 안 들어간다 — 조용히 가장 작은 박스를 내지 않는다.
      if (!b.fits) warnings.push(`내부 서랍 ${b.idx + 1}단: 전면 뒤 자리에 가장 작은 박스(${b.sideH})도 안 들어간다`);
    });

    // topSlot: 맨 위 전면 위의 빈 공간 — 단수가 짝수면 없다 (짝이 다 맞아 경계로 해결된다)
    return Object.assign(base, { slots, frontW, fronts, boxes, slack,
      topSlot: plan.top ? I.HANDLE_SLOT : 0, hasTopSlot: plan.top });
  }

  /** 전면 한 장 뒤의 서랍 박스 — 서랍 규칙(pickBox·drawerBoxDims)이 정한다. */
  function innerDrawerBoxOf(DR, o) {
    if (!DR || !DR.pickBox || !DR.drawerBoxDims) return null;
    const box = DR.pickBox(o.zoneH, o.rail);
    const dims = DR.drawerBoxDims({
      W: o.W, D: o.D, bodyT: o.T, drawerT: o.T, rail: o.rail, boxH: box.h, sakuri: false,
    });
    const rail = DR.DRAWER_RULES.RAIL_CLEARANCE[dims.rail];
    return Object.assign({ idx: o.idx, size: box.size, fits: box.fits,
      label: DR.DRAWER_RULES.BOX_LABEL[box.size], railName: rail ? rail.name : dims.rail }, dims);
  }

  /** 내부 서랍에서 나오는 부재 — 전면과 좌우 몰딩. 둘 다 15PB 몸통 재질이다. */
  function innerDrawerPartsOf(L) {
    if (!L || !L.fronts || !L.fronts.length) return [];
    const rows = [];
    const byH = new Map();
    L.fronts.forEach((f) => byH.set(f.h, (byH.get(f.h) || 0) + 1));
    [...byH.keys()].sort((a, b) => a - b).forEach((h) => {
      rows.push({
        part: '내부서랍 전면판', material: 'PB', t: L.frontT, w: L.frontW, h, qty: byH.get(h),
        edge: '4면', note: `손잡이 빈 공간 ${R.INNER_DRAWER.HANDLE_SLOT} × ${L.slots}`,
      });
    });
    rows.push({
      part: '내부서랍 좌우몰딩', material: 'PB', t: L.moldingT, w: L.moldingH, h: L.moldingW, qty: 2,
      edge: '2면(장)', note: `앞선에서 ${L.setback} 안쪽 — 경첩 자리`,
    });
    return rows;
  }

  /**
   * 내부 서랍장 **모듈**에서 나오는 부재 — 일반 모듈과 같은 구성(측판·천판·지판·뒷판·밴드)에
   * 서랍 규칙이 낸 박스(전후판·측판·우라·하단보강)를 더한다. 통이 아니라 이 모듈 이름으로 붙는다.
   */
  function innerDrawerModulePartsOf(L) {
    if (!L || !L.fronts || !L.fronts.length) return [];
    const I = R.INNER_DRAWER;
    const T = L.frontT;
    const W = L.moduleW;
    const H = L.moduleH;
    const D = L.moduleD;
    const inner = W - 2 * T;
    // 2026-09-22: 몸통은 **하부장과 같다** — 천판이 없다. 밴드가 상단 앞·뒤에 서고
    //   그 위에 상판이 올라간다.
    const rows = [
      { part: '측판', material: 'PB', t: T, w: D, h: H, qty: 2, edge: '3면', note: 'sakuri(15→3mm)' },
      { part: '지판', material: 'PB', t: T, w: inner, h: L.panelD, qty: 1, edge: '1면(전)' },
      { part: '밴드', material: 'PB', t: T, w: inner, h: I.BAND_H, qty: 2, edge: '2면(장)',
        note: '천판 대신 상단 앞·뒤 (하부장과 같다)' },
      { part: '뒷판', material: 'MDF', t: I.BACK_T, w: W - I.BACK_W_MINUS, h: H - I.BACK_H_MINUS, qty: 1, edge: '-' },
      { part: '상판', material: 'PB', t: L.topT, w: L.topPanelW, h: L.topPanelD, qty: 1, edge: '1면(전)',
        note: '모듈 + 좌우 몰딩을 덮는다 — 분할 없는 칸의 선반과 같은 판' },
    ];

    // 박스는 크기가 같은 것끼리 묶는다 (단수가 달라도 보통 한 종류다).
    const byKey = new Map();
    (L.boxes || []).forEach((b) => {
      const k = `${b.size}|${b.fbW}|${b.fbH}|${b.sideL}|${b.sideH}`;
      if (!byKey.has(k)) byKey.set(k, { b, n: 0 });
      byKey.get(k).n += 1;
    });
    byKey.forEach(({ b, n }) => {
      const note = `${b.railName} ${b.railLength} · 박스 ${b.label}`;
      rows.push({ part: '서랍전후판', material: 'PB', t: T, w: b.fbW, h: b.fbH, qty: n * 2, edge: '1면(장)', note });
      rows.push({ part: '서랍측판', material: 'PB', t: T, w: b.sideL, h: b.sideH, qty: n * 2, edge: '1면(장)', note });
      rows.push({ part: '서랍밑판', material: 'MDF', t: I.BACK_T, w: b.bottomW, h: b.bottomD, qty: n, edge: '-', note });
      if (b.brace) {
        rows.push({ part: '서랍 하단보강', material: 'PB', t: T, w: b.sideL,
          h: drawerRules() ? drawerRules().DRAWER_RULES.BOX_BRACE_H : 60, qty: n, edge: '2면(장)',
          note: `전후판 가로 ${b.fbW} > 600` });
      }
    });
    return rows;
  }

  /** 옷봉 파이프 길이 — 칸 내경 폭보다 5 짧다 (양쪽 소켓 자리, 2026-09-17 확정). */
  function rodLengthFor(clearW) {
    return Math.max(0, Math.round(Number(clearW) || 0) - R.ROD_LENGTH_MINUS);
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
    const Wi = W - 2 * T;
    const warnings = [];
    const key = presetKeyOf(opt.preset);
    const preset = presetOf(key);

    // 미지정(null·undefined)이면 프리셋 기본값. 0 은 "서랍 없음" 이라는 **지정**이다.
    //   다만 긴옷(minDrawers)은 0 을 받지 않는다 — 서랍이 최소 1단 들어간다.
    let drawers = opt.drawers == null || opt.drawers === ''
      ? int0(preset.drawers, R.MAX_DRAWER_COUNT)
      : int0(opt.drawers, R.MAX_DRAWER_COUNT);
    const drawerModH = drawers * R.DRAWER_MOD_H;
    // 2026-09-17 사장님 확정: 서랍은 **내부·외부 두 가지**다 (§7).
    //   외부 = 통 아래에 몸통을 따로 세운다 → 캐비닛 높이가 그만큼 준다
    //   내부 = 몸통 높이를 유지하고 **맨 아래 캐비닛 안**에 서랍모듈을 넣는다 → 그 칸이 그만큼 준다
    // 미지정이면 **프리셋 기본값**, 프리셋도 안 정했으면 외부다.
    //   2026-09-18: 긴옷(longDrawer)은 내부가 기본이다 (preset.external === false).
    const external = opt.externalDrawer == null
      ? (preset.external !== false)
      : !!opt.externalDrawer;

    const fullBodyH = bodyHeightOf(opt);
    const cabinetH = external ? fullBodyH - drawerModH : fullBodyH;

    const empty = {
      preset: key, label: preset.label, moduleType: preset.moduleType,
      carcasses: [], cells: [], dividers: [], shelves: [], rods: [],
      drawers, drawerModH, external, cabinetH, bodyH: cabinetH, fullBodyH, Wi, T, W,
      shelfDepth: shelfDepthOf(opt), innerDepth: innerDepthOf(opt), warnings,
    };
    if (cabinetH <= 2 * T) {
      warnings.push(`서랍 ${drawers}단(${drawerModH})을 빼면 몸통 높이가 ${cabinetH} 로 남지 않는다`);
      return empty;
    }

    // 직접 편집한 칸을 주면 캐비닛 몸통 **하나**로 본다 — 칸 좌표가 어느 몸통 것인지 알 수 없으므로.
    const given = Array.isArray(opt.cells) ? opt.cells.map(cleanCell).filter(Boolean) : [];
    const plan = given.length
      ? [{ key: 'body', label: '통장', share: 1, cells: () => given }]
      : preset.stack;

    const carcasses = [];
    let y = 0;
    if (drawers > 0 && external) {
      // §7 외부 서랍 — 통 아래에 **별도 제작** 몸통으로 선다.
      carcasses.push({ key: 'drawer', label: '서랍모듈', kind: 'drawer', y0: 0, h: drawerModH, drawers,
        cells: [], dividers: [], shelves: [], rods: [] });
      y = drawerModH;
    }
    const heights = splitStack(cabinetH, plan.map((st) => Math.max(1, Number(st.share) || 1)));
    plan.forEach((st, i) => {
      carcasses.push({ key: st.key, label: st.label, kind: 'cabinet', y0: y, h: heights[i],
        planIdx: i, cells: [], dividers: [], shelves: [], rods: [] });
      y += heights[i];
    });

    const cells = [];
    const dividers = [];
    const shelves = [];
    const rods = [];

    const firstCabinet = carcasses.findIndex((c) => c.kind === 'cabinet');
    carcasses.forEach((car, carIdx) => {
      if (car.kind !== 'cabinet') return;
      // §7 내부 서랍 — 몸통 높이는 그대로 두고 **맨 아래 캐비닛 안**에서 자리를 뺀다.
      const zoneH = (!external && drawers > 0 && carIdx === firstCabinet) ? drawerModH : 0;
      if (zoneH > 0) {
        // 내부 서랍 — 전면·몰딩 배치까지 같이 낸다 (플래너·BOM 이 같은 숫자를 쓴다).
        const inner = innerDrawerLayout({ Wi, zoneH, drawers, T, D: depthOf(opt), rail: opt.rail });
        car.drawerZone = Object.assign({ y0: car.y0 + T, h: zoneH, drawers }, inner || {});
        if (inner && inner.warnings.length) warnings.push(...inner.warnings);
      }
      const Hi = car.h - 2 * T - zoneH;
      if (Hi <= 0) {
        warnings.push(`${car.label} 높이 ${car.h} 에서 판 두께(${2 * T})${zoneH ? ` · 내부 서랍(${zoneH})` : ''}을 빼면 칸이 남지 않는다`);
        return;
      }
      const st = plan[car.planIdx];
      let own = (st.cells({ Wi, Hi, T, drawers }) || []).map(cleanCell).filter(Boolean);

      // 너무 좁은 칸이 나오면 세로 분할을 접는다 — 만들 수 없는 판을 BOM 으로 내지 않는다.
      const narrow = own.filter((c) => c.w < R.MIN_CELL_W);
      if (narrow.length) {
        warnings.push(`${car.label} 칸 폭 ${narrow.map((c) => c.w).join('·')} 가 최소 ${R.MIN_CELL_W} 미만 — 세로 분할을 접는다`);
        const rows = new Map();
        own.forEach((c) => {
          const k = `${c.y0}:${c.h}`;
          const cur = rows.get(k);
          if (!cur || c.x0 < cur.x0) rows.set(k, Object.assign({}, c, { x0: 0, w: Wi }));
        });
        own = [...rows.values()];
      }
      own.sort((x, z) => (x.y0 - z.y0) || (x.x0 - z.x0));

      // 몸통 안 좌표 → 통 좌표. 그 몸통 지판 윗면이 y0 + T 이고, 내부 서랍이 있으면 그 위부터다.
      const base = car.y0 + T + zoneH;
      const ownDividers = dividersOf(own, opt).map((d) => Object.assign({}, d, {
        carcass: carIdx,
        y0: d.axis === 'v' ? d.y0 + base : d.y0,
        y: d.axis === 'h' ? d.y + base : d.y,
      }));
      car.dividers = ownDividers;
      dividers.push(...ownDividers);

      own.forEach((c) => {
        const cell = Object.assign({}, c, { carcass: carIdx, y0: c.y0 + base });
        const idx = cells.length;
        cells.push(cell);
        car.cells.push(cell);
        const shelfYs = shelfPositions(c, opt);
        shelfYs.forEach((sy) => {
          const row = { cell: idx, carcass: carIdx, x0: c.x0, y: sy + cell.y0,
            w: c.w, cutW: c.w, cutH: shelfDepthOf(opt), t: T, part: '선반' };
          shelves.push(row); car.shelves.push(row);
        });
        // 옷봉은 최상단 선반 **아래**에 걸린다 — 선반 위치를 넘겨야 그 자리가 잡힌다.
        rodPositions(c, shelfYs).forEach((ry) => {
          // clearW = 칸 내경 폭(그림에서 칸이 차지하는 폭), length = 실제 파이프 재단 길이
          const row = { cell: idx, carcass: carIdx, x0: c.x0, y: ry + cell.y0,
            clearW: c.w, length: rodLengthFor(c.w), sockets: R.ROD_SOCKETS_PER_ROD, part: '옷봉' };
          rods.push(row); car.rods.push(row);
        });
        if (c.shelves > 0 && c.rods > 0 && c.h <= R.LONG_FIRST_SHELF) {
          warnings.push(`${car.label} 칸 높이 ${c.h} 는 긴옷 첫 선반 ${R.LONG_FIRST_SHELF} 보다 낮아 선반이 빠졌다`);
        }
      });
    });

    return Object.assign(empty, { carcasses, cells, dividers, shelves, rods });
  }

  /** 캐비닛 몸통만 (서랍 몸통 제외) — 옛 upperH·lowerH 로 옮길 때 쓴다. */
  function cabinetsOf(layout) {
    return (layout.carcasses || []).filter((c) => c.kind === 'cabinet');
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

  /** 옷봉 철물 — 크롬 25파이 파이프와 원형소켓. 길이가 다르면 줄을 나눈다. */
  function rodHardwareOf(layout) {
    return rodHardwareFor((layout.rods || []).map((r) => r.length));
  }

  /**
   * 옷봉 길이 목록에서 철물 줄을 만든다. 칸 구조가 없는 옛 설계(rodCountUpper/Lower)도
   * 길이만 넘기면 같은 줄이 나온다 — 규격을 두 군데 적지 않는다.
   */
  function rodHardwareFor(lengths) {
    const list = (lengths || []).map((v) => Math.round(Number(v) || 0)).filter((v) => v > 0);
    if (!list.length) return [];
    const byLen = new Map();
    list.forEach((len) => byLen.set(len, (byLen.get(len) || 0) + 1));
    const out = [];
    [...byLen.keys()].sort((a, b) => a - b).forEach((length) => {
      out.push({ name: '옷봉', spec: `${R.ROD_SPEC} ${length}mm`, qty: byLen.get(length), unit: 'EA', note: '' });
    });
    out.push({
      name: `옷봉 ${R.ROD_SOCKET_NAME}`, spec: R.ROD_SPEC,
      qty: list.length * R.ROD_SOCKETS_PER_ROD, unit: 'EA',
      note: `옷봉 1개당 ${R.ROD_SOCKETS_PER_ROD}EA`,
    });
    return out;
  }

  return {
    WARDROBE_RULES, PRESETS, PRESET_KEYS, PRESET_DEFAULT, SAMPLE_PRESETS, CELL_KINDS,
    layoutWardrobeModule, normalizeBlock, dividersOf, shelfPositions, rodPositions,
    partsOf, rodHardwareOf, rodHardwareFor, rodLengthFor, bodyHeightOf, shelfDepthOf, innerDepthOf,
    cabinetsOf, splitStack, moldingPartFor, moldingFinishOn,
    innerDrawerLayout, innerDrawerPartsOf, innerDrawerModulePartsOf, innerSlotPlan,
    presetOf, presetKeyOf, presetLabel, moduleTypeOf, samplePresetFor,
  };
});
