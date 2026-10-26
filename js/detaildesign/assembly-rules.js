/**
 * 조립 규칙 한 표 (다담 CAD 베타 PR3 — docs/01-plan/planner-cad.plan.md §6 단계 1).
 *
 * 몸통(카카스) 판재의 크기·자리를 정하는 숫자를 한 곳에 둔다. BOM(extractors.js)이 지금 이 표로 재단 치수를 내고,
 * 다음 단계의 조립 명세(bom-assembly.js, `dadam.assembly/1`)가 같은 표로 판재마다 위치를 정한다.
 * 숫자는 모두 이미 있던 BOM 값이다 — 이 파일은 옮겨 모은 것이지 새 규칙이 아니다. 출처는 항목마다 적었다.
 *
 * 순수 데이터 + 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamAssemblyRules`
 * (detaildesign.html 이 extractors.js 보다 먼저 싣는다), Node(Jest)는 module.exports.
 *
 * 다른 규칙 파일과 나눈 몫 (같은 숫자를 두 군데 적지 않는다):
 *   서랍장 · 목찬넬 · 레일   js/detaildesign/bom-drawer-rules.js
 *   붙박이장 통 내부          js/detaildesign/bom-wardrobe-rules.js
 *   오픈장 18T 상자           js/detaildesign/bom-open-cabinet-rules.js
 *   품목 기본 스펙(상판 12 · 다리발 150 · 하부 870 · 상부 720 · 몸통 15T)   js/detaildesign/data-constants.js
 *
 * 아직 정하지 않은 것 (사장님 결정 대기 — 지금 BOM 동작을 그대로 둔다):
 *   D12  하부 선반 "D − 15" 가 상수인가 몸통 T 인가 — 지금 BOM 은 D − T (15T 에서 −15, 18T 에서 −18)
 *   D5   경첩 컵 자리(2026-10-23 추천값 — HINGE_CUP_EDGE·HINGE_CUP_DEPTH) · 사쿠리 홈 깊이(2026-10-25 — sakuriGrooveDepth)는
 *        정했다. 둘 다 실측이 오면 숫자만 고친다
 *   D2   서랍장에서 처짐방지목 위치
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamAssemblyRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** 규칙 판 — 이 표의 숫자가 바뀌면 올린다. 조립 명세·동결 스냅샷에 실려 어느 규칙으로 계산했는지 남긴다. */
  const RULES_VERSION = 'asm-2026.10.4';

  const CARCASS = Object.freeze({
    // 뒷판 — 2026-10-18 사장님: 우라 MDF 3T. 2026-10-19 (PR #832): 크기는 측판 사쿠리가 정한다.
    //   사쿠리 있음  측판 홈에 끼운다          (W − 20) × (H − 1)
    //   사쿠리 없음  측판 뒤끝에 덮어 붙인다   (W − 1) × (H − 1) — 측판 깊이를 먹지 않는다
    BACK_PANEL_T: 3,
    BACK_SAKURI_W_MINUS: 20,
    BACK_FLAT_W_MINUS: 1,
    BACK_H_MINUS: 1,
    // 사쿠리 홈 — 측판 뒤끝에서 15 들어와 폭 3 (BOM 측판 비고 'sakuri(15→3mm)'). 폭 = 뒷판 두께.
    SAKURI_FROM_BACK: 15,
    SAKURI_W: 3,
    // 사쿠리 홈 깊이 — 2026-10-25 사장님 D5 (A 추천대로): 뒷판이 홈에 드는 만큼 + 여유 1.
    //   뒷판 W − 20 · 측판 사이 W − 2T 라 한쪽에 T − 10 이 든다 → 15T 6 · 18T 9 (sakuriGrooveDepth). 실측이 오면 여유만 고친다
    SAKURI_DEPTH_CLEARANCE: 1,
    // 사쿠리 측판 사이의 천판·지판 깊이 D − 18 (= 홈 앞까지 15 + 3)
    SAKURI_PANEL_D_MINUS: 18,
    // 상부장·키큰장(사쿠리) 선반 D − 34
    SAKURI_SHELF_D_MINUS: 34,
    // 붙박이장 통·외부 서랍모듈 선반 D − 18 − 70 = D − 88
    WARDROBE_SHELF_D_MINUS: 88,
    // 밴드 — 천판 대신 하부장 위 2장 폭
    BAND_W: 70,
    // 상부장 보강목 2장 폭 — 2026-10-20 사장님: 70 이 아니라 60 (W − 2T × 60). 자리는 사쿠리 홈 뒤, 장의 맨 뒤.
    UPPER_BAND_W: 60,
    // 상부장 보강목 판 두께 — 2026-10-20 사장님 "15T 고정": 몸통이 18T 여도 15T (홈 뒤 15 자리에 맞는다). 길이 W − 2T 는 몸통 T.
    UPPER_BAND_T: 15,
    // 처짐방지목 — 2026-09-19 사장님: 폭이 문턱 이상인 모듈에만 1장, 모듈 폭 중앙, 측판 앞선에 맞대어 도어 바로 뒤.
    //   폭 70 × 길이 (H − 2T), 목찬넬 하부장이면 − 70 (bom-drawer-rules.js CHANNEL_TOP_NOTCH_H).
    BRACE_W: 70,
    BRACE_W_MIN_UPPER: 700,
    BRACE_W_MIN_LOWER: 800,   // 하부장 · 키큰장 단
    // 모듈 깊이 폴백 — 모듈에 d 가 없을 때 (싱크대 extractSink)
    // 도어 갭 — 도어 가로 = 칸 폭 − 4 (extractors.js floor(W/n) − 4 · 플래너 MASTER_RULES.DOOR_GAP). 좌우 2 씩, 양문 가운데 4.
    DOOR_GAP: 4,
    // 멍장 (corner.md §3.3·§3.5) — data-constants.js CORNER_* 와 같은 값 (drift 금지).
    //   멍가림판 MDF 3T (2026-10-26 사장님, 예전 2.7T) 는 멍 W − 목대 15, 마감재(휠라·몰딩) 150 은 멍판 위에 겹쳐 붙는다 (자리 60 + 겹침 90).
    //   ㄱ자 기둥 15T: 앞판 = 처짐방지 밴드 60 (멍판 바로 뒤), 그 뒤에 경첩목대 깊이 60 이 멍·도어 경계에서 도어 쪽으로 15 — 앞선에서 75.
    //   멍장에는 모듈 가운데 처짐방지 밴드가 따로 없다 — 이 기둥이 처짐방지 밴드다 (2026-10-26 사장님).
    BLIND_COVER_T: 3,
    BLIND_BATTEN_T: 15,
    BLIND_BATTEN_LEG: 60,
    BLIND_FINISH_W: 150,
    UPPER_D_DEFAULT: 295,
    LOWER_D_DEFAULT: 550,
    // 하부장 걸레받이 MDF 18T (sink.md 자재표: 자리 길이 × (다리발 − 5), 조각은 아래 LINE_PIECE_*) — 바닥에 붙여 세운다. 높이의 −5 는 위에
    //   (몸통 밑단과의 틈, 2026-10-22 사장님 "바닥에서 5 띄울 필요 없음, 틈은 캐쳐(걸레받이 홀더)로"). 플래너 3D(mockup-structure.html addToeKick)도 이 표를 읽어 같은 그림 (2026-10-25 사장님 확정).
    //   앞면 = 몸통 앞선 − 32 (2026-10-22 사장님 카드 "몸통 앞선에서 32 안쪽" — 좌대 걸레받이가 앞 50 들어간 상자 앞면에 붙어 32 남는 것과 같다)
    KICK_T: 18,
    KICK_H_MINUS: 5,
    KICK_SETBACK: 32,
    // 상몰딩 · 걸레받이 · 목찬넬 EP 조각 길이 (linePiecesOf) — 2026-10-26 사장님 확정:
    //   "상몰딩, 걸레받이, 목찬넬은 자동으로 최대 2400, 최소 1000 이상, 최대 길이로 하되 최소 길이 조건은 맞추어야함."
    //   "자르는 건 모듈길이별로 잘라야해, 예) 600장 +500 이라면 1100으로 잘라서 넣어야함. 그리고 최소 길이는 800이상으로 변경해줘."
    //   "800 보다 짧으면 그 길이 그대로 내는게 아니라 최소 800이상의 길이가 되어야한다는 거지" — 짧은 조각은 800 으로 내고 현장에서 자른다.
    //   예전 걸레받이 원판 긴 변 2440 단위 나누기(KICK_CUT_UNIT, 2026-10-20 카드 「꺾임에서 나누기」)를 대신한다.
    LINE_PIECE_MIN: 800,
    LINE_PIECE_MAX: 2400,
    // 다리발 — 플래너 MASTER_RULES.LEG_SIZE·LEG_INSET (js/planner/planner-engine.js, OBJ 실측) 과 같은 값 (drift 금지).
    //   4 코너, 모듈 외곽에서 25 안쪽, 앞줄은 걸레받이 뒤 (3D addLegs). 6·8개면 앞줄·뒷줄마다 두 코너 사이를 균등 분할 (2026-10-23 사장님 4-1 B).
    LEG_SIZE: 42,
    LEG_INSET: 25,
    // 경첩 컵 지름 (hardware.md §1, H052W).
    HINGE_CUP_D: 35,
    // 경첩 컵 자리 — 2026-10-23 사장님 4-1 A (추천대로): 도어 변에서 컵 가장자리까지 4 → 컵 중심 4 + 35/2 = 21.5, 컵 깊이 12.5.
    //   결정 D5 의 경첩 부분. 실측 값이 오면 이 두 숫자만 고친다.
    HINGE_CUP_EDGE: 4,
    HINGE_CUP_DEPTH: 12.5,
  });

  /** 뒷판 재단 크기 — 사쿠리 여부로 (모든 모듈 공통). */
  function backPanelSize(W, H, sakuri) {
    const C = CARCASS;
    return { w: W - (sakuri ? C.BACK_SAKURI_W_MINUS : C.BACK_FLAT_W_MINUS), h: H - C.BACK_H_MINUS };
  }

  /** 몸통 측판 사쿠리 홈 깊이 (mm) — 뒷판이 한쪽에 드는 만큼 (W−20 − (W−2T)) / 2 = T − 10, 더하기 여유 (2026-10-25 D5). */
  function sakuriGrooveDepth(T) {
    const C = CARCASS;
    return (2 * (parseFloat(T) || 0) - C.BACK_SAKURI_W_MINUS) / 2 + C.SAKURI_DEPTH_CLEARANCE;
  }

  /** 처짐방지목 장수 — 문턱 이상이면 1, 아니면 0. pos 'upper' 는 상부장 문턱, 그 밖은 하부장 문턱. */
  function braceQtyOf(W, pos) {
    const min = pos === 'upper' ? CARCASS.BRACE_W_MIN_UPPER : CARCASS.BRACE_W_MIN_LOWER;
    return (parseFloat(W) || 0) >= min ? 1 : 0;
  }

  /**
   * 자리 하나의 조각 — 상몰딩 · 걸레받이 · 목찬넬 EP (2026-10-26 사장님 확정, CARCASS.LINE_PIECE_*).
   *   자리 = 그 부재가 곧게 붙는 구간 (벽마다 · 실제로 붙는 길이), units = 자리를 이루는 단위 폭을 진행 순서대로
   *   (모듈 · 후드 자리 · 상몰딩이 건너는 빈 자리 · 이은 키큰장 — 단위 하나가 한 칸). 자르는 곳은 단위 경계뿐이다 ("모듈길이별로").
   *   1) 자리 전체가 최대(2400) 이하면 한 장.
   *   2) 넘으면 단위 경계에서 모든 조각이 800~2400 이 되게, **장 수가 가장 적게**, 그중 **앞 조각이 가장 길게** 나눈다.
   *      예) 600 · 600 · 600 · 600 · 500 → 1800 + 1100 (2400 + 500 이 아니다), 600 × 4 + 900 → 2400 + 900.
   *   3) 그렇게 못 나누면(2400 + 500 처럼 경계가 모자라거나 2400 을 넘는 단위가 있으면, fallback) 2400 이하로 장 수가 가장 적게 ·
   *      짧은 조각(800 미만)이 가장 적게 · 앞 조각이 가장 길게. 2400 을 넘는 단위는 그 안에서 앞부터 2400 마다 자른다
   *      (그 경계에 닿은 조각은 inside — 정한 규칙이 없어 BOM 행 비고 [확인 필요]).
   *   4) 800 보다 짧은 조각(자리 전체가 짧거나 3) 의 남는 조각)은 **800 으로 낸다** — 2026-10-26 사장님 "800 보다 짧으면 그 길이 그대로
   *      내는게 아니라 최소 800이상의 길이가 되어야한다는 거지". 현장에서 붙는 길이로 자른다 (site, order = 800 · len = 붙는 길이).
   *      단, 깊이가 달라 따로 선 자리(opts.keepShort — 이웃과 깊이 · 앞면이 다른 모듈의 자리)는 짧아도 붙는 길이 그대로 낸다 —
   *      같은 날 사장님 "800보다 작지만 깊이가 구분되는 모듈이라면 800이하도 가능." (자리 전체가 짧을 때만 — 3) 의 남는 조각은 800).
   *   len 은 붙는 길이(3D · 조립 명세), order 는 발주 길이(BOM 행). 길이는 누적 경계를 반올림한 정수 mm 다 — len 합 = 자리 길이.
   * @param {number[]} units  단위 폭 (진행 순서)
   * @param {{keepShort?: boolean}} [opts]
   * @returns {{ total:number, offsets:number[], fallback:boolean,
   *   pieces:Array<{len:number, order:number, from:number, to:number, site:boolean, inside:boolean}> }}
   *   offsets = 단위 경계 (자리 시작에서 mm, 길이 units + 1), pieces 의 from · to 도 자리 시작에서 mm
   */
  function linePiecesOf(units, opts) {
    const MIN = CARCASS.LINE_PIECE_MIN, MAX = CARCASS.LINE_PIECE_MAX;
    const offsets = [0];
    let acc = 0;
    (units || []).forEach((u) => {
      const w = Number(u);
      acc += Number.isFinite(w) && w > 0 ? w : 0;
      offsets.push(Math.round(acc));
    });
    const total = offsets[offsets.length - 1];
    const insideAt = new Set();
    const piece = (from, to) => ({
      len: to - from, order: Math.max(to - from, MIN), from, to,
      site: to - from < MIN, inside: insideAt.has(from) || insideAt.has(to),
    });
    const out = (cuts, fallback) => ({ total, offsets, fallback, pieces: cuts.map(([from, to]) => piece(from, to)) });
    if (!(total > 0)) return out([], false);
    if (total <= MAX) {
      const one = out([[0, total]], false);
      if (opts && opts.keepShort) Object.assign(one.pieces[0], { order: total, site: false });
      return one;
    }
    /**
     * 경계 pos 에서 앞에서부터 나눈다. cost(len) = null 이면 쓸 수 없는 조각, 아니면 벌점 (짧은 조각 수).
     * 뒤에서부터 [장 수, 벌점] 최소를 구하고, 앞에서부터 그 최소를 지키는 가장 긴 조각을 고른다.
     */
    const split = (pos, cost) => {
      const n = pos.length - 1;
      const best = new Array(n + 1).fill(null);
      best[n] = [0, 0];
      const better = (a, b) => !b || a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = i + 1; j <= n; j++) {
          const len = pos[j] - pos[i];
          if (len > MAX) break;
          const c = cost(len);
          if (c === null || !best[j]) continue;
          const cand = [best[j][0] + 1, best[j][1] + c];
          if (better(cand, best[i])) best[i] = cand;
        }
      }
      if (!best[0]) return null;
      const cuts = [];
      for (let i = 0; i < n;) {
        let pick = -1;
        for (let j = i + 1; j <= n && pos[j] - pos[i] <= MAX; j++) {
          const c = cost(pos[j] - pos[i]);
          if (c !== null && best[j] && best[j][0] + 1 === best[i][0] && best[j][1] + c === best[i][1]) pick = j;
        }
        cuts.push([pos[i], pos[pick]]);
        i = pick;
      }
      return cuts;
    };
    const exact = split(offsets, (len) => (len >= MIN ? 0 : null));
    if (exact) return out(exact, false);
    // 정한 길이로 못 나눈다 — 2400 을 넘는 단위만 안에서 2400 마다 자른 경계를 더한다
    const pos = [0];
    for (let k = 1; k < offsets.length; k++) {
      for (let x = offsets[k - 1]; offsets[k] - x > MAX;) { x += MAX; pos.push(x); insideAt.add(x); }
      if (offsets[k] > pos[pos.length - 1]) pos.push(offsets[k]);
    }
    return out(split(pos, (len) => (len < MIN ? 1 : 0)), true);
  }

  return { RULES_VERSION, CARCASS, backPanelSize, braceQtyOf, sakuriGrooveDepth, linePiecesOf };
});
