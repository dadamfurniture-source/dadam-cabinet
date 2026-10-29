/**
 * 오픈장 규칙 (2026-09-19 사장님 확정).
 *
 * 도어가 없는 상자 하나다. 몸통 전체가 **18T MDF** 다 — PB 가 아니다.
 * 모듈 타입으로 고르며, 카테고리(싱크대·붙박이장·수납장…)와 무관하게 규칙이 같다.
 *
 * 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamOpenCabinetRules`, Node(Jest)는 module.exports.
 * BOM(extractors.js)과 플래너(mockup-structure)가 **같은 이 파일**을 읽는다.
 *
 * ── 부재 (몸통 외경 W × H × D, mm) ──────────────────────────────
 *   측판   = D × H                2장
 *   천지판 = (W − 2×18) × (D − 20) 2장   (천판·지판이 같은 치수라 한 줄로 낸다)
 *   뒷판   = (W − 2×18) × H        1장   ← 2.7T 가림판이 아니라 **18T 통판**이다
 *
 * 천지판이 깊이에서 20 짧은 자리에 18T 뒷판이 선다 (18 + 여유 2).
 * 측판은 깊이 전체를 덮으므로 뒷판은 측판 **사이**에 들어간다 — 그래서 가로가 W − 2×18 이다.
 *
 * 예 (W500 × H450 × D570):
 *   측판 570×450 2장 · 천지판 464×550 2장 · 뒷판 464×450 1장
 *   사장님 표기는 "측판 450×570 · 천지판 464×550 · 뒷판 450×464" 로 **세로를 먼저** 적은 것이고,
 *   이 파일과 BOM 은 저장소 관례대로 **가로×세로**로 적는다 — 같은 판이다.
 *
 * ── 홈카페장(extractors extractFridge)과 다른 점 ────────────────
 * 냉장고장 안의 홈카페장도 주석에 "오픈장 규칙" 이라 적혀 있지만 치수가 다르다
 * (측판 D+20, 천지판 깊이 D). 그쪽은 도어가 달리는 냉장고장 전용 모듈이라 그대로 두고,
 * 여기 오픈장과 섞지 않는다. 둘을 합치려면 사장님 확인이 필요하다.
 *
 * ── 빌트인 오븐장 (2026-10-30 사장님) ───────────────────────────
 * "완전 빌트인 오븐은 제조사 규칙을 따라야하고, 오픈장을 15T로 만들어야함" — 같은 상자를 **PB 15T** (몸통과 같은 판)로 짓는다.
 * 빌트인 = 제조사 설치 공간(니치 W · H, 가전 DB niche_min_w/h_mm)이 적힌 오븐 (같은 날 「제조사 설치 공간(니치)이 있는 오븐」).
 *   측판   = D × H                2장
 *   천지판 = (W − 2×15) × (D − 17) 2장   (15T 뒷판 + 여유 2 — 위 18T 상자와 같은 짜임)
 *   뒷판   = (W − 2×15) × ⌊H/2⌋    1장   ← "15T 통판(측판 사이)으로 하고, 높이는 절반만 해서 반은 뚫려있게"
 * 뒷판을 아래 · 위 어느 절반에 둘지는 말씀에 없어 **아래 절반**으로 둔다 — [확인 필요] BUILTIN_OVEN.BACK_AT 한 곳만 고치면 된다.
 * 칸 높이는 니치에 맞춘다 (applianceBoxOf). 니치 깊이는 가전 DB 에 없어 깊이는 검사하지 않는다.
 *
 * ── 가전 칸 높이 (2026-10-30 사장님 「가전에 맞춰 단 높이」) ─────
 * 키큰장 가운데 단(가전 칸)을 고른 가전에 맞춘다 — applianceBoxOf:
 *   전자레인지 · 니치 없는 오븐  내경 높이 = 가전 H + 위 여유(제조사 값, 없으면 APPLIANCE_CLEARANCE 20) → 상자 H = 내경 + 18 × 2
 *   빌트인 오븐                  내경 높이 = 니치 H                                                 → 상자 H = 내경 + 15 × 2
 * 밥솥 칸은 밥솥장 규칙 파일(cookerBoxOf)이 낸다. 폭은 키큰장 폭 그대로 — 모자라면 applianceWarningsOf 가 경고한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamOpenCabinetRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const OPEN_CABINET_RULES = Object.freeze({
    KIND: 'open',                 // 구조(structures)에 저장되는 모듈 타입 값
    LABEL: '오픈장',
    MATERIAL: 'MDF',
    T: 18,                        // 몸통 두께 — 18T MDF 전체
    BACK_GAP: 20,                 // 천지판이 깊이에서 물러나는 값 (18T 뒷판 + 여유 2)
    // 엣지는 냉장고장 홈카페장(= 같은 "오픈장 규칙")과 같은 면을 쓴다. 오픈장은 앞이 트여 있어
    // 확정이 필요하면 여기만 고치면 BOM·도면이 함께 따라온다.
    EDGE: Object.freeze({ side: '3면', topBottom: '2면(가로)', back: '2면(가로)' }),
    // 2026-10-25 사장님: 가전 칸(전자레인지) — DB 에 저장된 가전 외경 + 20 이 오픈장 내경의 최솟값이면 된다. 그 이상은 크게 관계없다.
    //   같은 날 검토 페이지 답 "제조사가 적은 여유가 있으면 그 값" — 모델에 설치 여유(위 · 옆 · 뒤)가 있으면 그 치수는 그 값 (applianceWarningsOf)
    APPLIANCE_CLEARANCE: 20,
    // 2026-10-30 사장님: 빌트인 오븐장 — 같은 상자를 PB 15T 로 (위 머리 주석). 구조 s.builtinOven · BOM 모듈 mod.builtinOven 이 참이면 이 값.
    BUILTIN_OVEN: Object.freeze({
      FLAG: 'builtinOven',
      LABEL: '빌트인 오븐장',
      MATERIAL: 'PB',
      T: 15,                      // 몸통과 같은 판 15T
      BACK_GAP: 17,               // 천지판이 깊이에서 물러나는 값 (15T 뒷판 + 여유 2 — 18T 상자의 18 + 2 와 같은 짜임)
      BACK_H_RATIO: 0.5,          // 뒷판 높이 = 몸통 H 의 절반 (내림) — 반은 뚫려 있다
      BACK_AT: 'bottom',          // [확인 필요] 뒷판을 둘 절반 — 말씀에 없어 아래 절반 ('top' 이면 위 절반)
      CATEGORY: 'oven',           // 가전 DB 품목 — 니치(niche_min_w/h_mm)가 적힌 오븐만 빌트인
    }),
  });

  const R = OPEN_CABINET_RULES;
  const BI = R.BUILTIN_OVEN;

  /** 숫자로 읽되 음수·NaN 은 0 으로 (치수를 아직 안 정한 모듈이 들어와도 터지지 않게) */
  function dim(v) {
    const n = Math.round(Number(v) || 0);
    return n > 0 ? n : 0;
  }

  /** 이 모듈이 오픈장인가 — 플래너 구조(s.moduleKind)와 BOM 모듈(mod.moduleKind) 둘 다 같은 값을 쓴다. */
  function isOpenCabinet(o) {
    return !!o && String(o.moduleKind || '') === R.KIND;
  }

  /** 빌트인 오븐장인가 — 구조(s.builtinOven)와 BOM 모듈(mod.builtinOven) 둘 다 같은 이름을 쓴다. */
  function isBuiltinOven(o) {
    return !!o && o[BI.FLAG] === true;
  }

  /** 상자 판 — 빌트인 오븐장이면 PB 15T, 아니면 18T MDF */
  function specOf(o) {
    return isBuiltinOven(o)
      ? { label: BI.LABEL, material: BI.MATERIAL, T: BI.T, backGap: BI.BACK_GAP }
      : { label: R.LABEL, material: R.MATERIAL, T: R.T, backGap: R.BACK_GAP };
  }

  /**
   * 내경 — 천지판·뒷판이 서는 자리. 플래너 3D·정면도가 이걸로 그린다.
   * 뒷판 높이 · 밑단(backH · backY): 18T 상자는 몸통 높이 전체, 빌트인 오븐장은 절반 (BUILTIN_OVEN.BACK_AT 쪽).
   * @param o {W,H,D, builtinOven?}
   */
  function innerOf(o) {
    const W = dim(o && o.W), H = dim(o && o.H), D = dim(o && o.D);
    const s = specOf(o);
    const backH = isBuiltinOven(o) ? Math.floor(H * BI.BACK_H_RATIO) : H;
    return {
      W, H, D,
      T: s.T,
      innerW: Math.max(0, W - 2 * s.T),          // 측판 사이
      innerH: Math.max(0, H - 2 * s.T),          // 천판·지판 사이
      innerD: Math.max(0, D - s.backGap),        // 천지판 깊이 (뒷판 앞까지)
      backT: s.T,
      backH,
      backY: isBuiltinOven(o) && BI.BACK_AT === 'top' ? H - backH : 0,
    };
  }

  /**
   * 부재 목록. BOM(extractors)과 플래너가 같은 이 함수를 쓴다.
   * 가로(w) × 세로(h) — 저장소 자재표 관례.
   *
   * @param o {W,H,D, builtinOven?}
   * @returns {Array<{part,material,t,w,h,qty,edge,note?}>} 치수가 안 잡히면 빈 배열
   */
  function partsOf(o) {
    const g = innerOf(o);
    const s = specOf(o);
    if (!g.W || !g.H || !g.D || !g.innerW || !g.innerD || !g.backH) return [];
    const back = { part: '뒷판', material: s.material, t: s.T, w: g.innerW, h: g.backH, qty: 1, edge: R.EDGE.back };
    if (isBuiltinOven(o)) back.note = `${BI.LABEL} — 높이 절반 (${BI.BACK_AT === 'top' ? '위' : '아래'}), 반은 뚫림`;
    return [
      { part: '측판',   material: s.material, t: s.T, w: g.D,      h: g.H,      qty: 2, edge: R.EDGE.side },
      { part: '천지판', material: s.material, t: s.T, w: g.innerW, h: g.innerD, qty: 2, edge: R.EDGE.topBottom },
      back,
    ];
  }

  /**
   * 치수가 규칙을 못 채우면 경고 문구 (플래너가 화면에, BOM 이 경고 목록에 쓴다).
   * @returns {string[]}
   */
  function warningsOf(o) {
    const g = innerOf(o);
    const s = specOf(o);
    const out = [];
    if (!g.W || !g.H || !g.D) {
      out.push(`${s.label} 치수(W·H·D)가 아직 정해지지 않았습니다`);
      return out;
    }
    if (g.innerW <= 0) out.push(`${s.label} 폭 ${g.W} 는 측판 두께(${2 * s.T})보다 좁아 칸이 남지 않습니다`);
    if (g.innerD <= 0) out.push(`${s.label} 깊이 ${g.D} 는 뒷판 자리(${s.backGap})보다 얕아 천지판이 남지 않습니다`);
    if (g.innerH <= 0) out.push(`${s.label} 높이 ${g.H} 는 천지판 두께(${2 * s.T})보다 낮아 칸이 남지 않습니다`);
    return out;
  }

  /**
   * 2026-10-25 사장님: 가전 칸 — 오픈장 내경(폭 · 높이 · 깊이)이 가전 외경 + 여유 이상인가. 모자라는 치수마다 경고 한 줄.
   *   여유 = 제조사가 적은 설치 여유가 있으면 그 값, 없으면 + 20 (같은 날 검토 페이지 답 "제조사가 적은 여유가 있으면 그 값"):
   *     폭   옆 여유(sideGap)가 있으면 + 옆 × 2 (양옆 — LG '측면/뒷면은 벽과 10cm 이상 띄움'), 없으면 + 20
   *     높이 위 여유(topGap)가 있으면 + 위, 없으면 + 20
   *     깊이 뒤 여유(backGap)가 있으면 + 뒤, 없으면 + 20
   *   가전 외경 · 여유는 가전 DB(appliance_models — width/height/depth_mm · side/top/back_gap_mm).
   * 빌트인 오븐장(o.builtinOven)은 제조사 규칙 — 내경 폭 · 높이가 니치(nicheW · nicheH) 이상인가만 본다 (2026-10-30 사장님).
   * @param o      {W,H,D, builtinOven?} 오픈장 몸통 외경
   * @param outer  {W,H,D, sideGap?, topGap?, backGap?, nicheW?, nicheH?} 가전 외경과 제조사 설치 여유 · 설치 공간
   * @param label  가전 이름 (경고 문구, 기본 '가전')
   * @returns {string[]}
   */
  function applianceWarningsOf(o, outer, label) {
    const g = innerOf(o);
    const s = specOf(o);
    const c = R.APPLIANCE_CLEARANCE;
    const name = label || '가전';
    const out = [];
    if (isBuiltinOven(o)) {
      [['innerW', 'nicheW', '폭'], ['innerH', 'nicheH', '높이']].forEach(([ik, nk, word]) => {
        const need = dim(outer && outer[nk]);
        if (need > 0 && g[ik] < need) out.push(`${s.label} 내경 ${word} ${g[ik]} 가 ${name} 설치 공간 ${word} ${need} 보다 작습니다`);
      });
      return out;
    }
    const gap = (k) => (outer && outer[k] != null && Number.isFinite(Number(outer[k])) && Number(outer[k]) >= 0 ? Number(outer[k]) : null);
    [['innerW', 'W', '폭', 'sideGap', 2, '옆 여유'], ['innerH', 'H', '높이', 'topGap', 1, '위 여유'], ['innerD', 'D', '깊이', 'backGap', 1, '뒤 여유']]
      .forEach(([ik, ok, word, gk, times, gword]) => {
        const need = dim(outer && outer[ok]);
        if (!(need > 0)) return;
        const mg = gap(gk);
        const add = mg == null ? c : mg * times;
        const how = mg == null ? `${c}` : `${gword} ${mg}${times > 1 ? ` × ${times}` : ''}`;
        if (g[ik] < need + add) out.push(`${s.label} 내경 ${word} ${g[ik]} 가 ${name} ${word} ${need} + ${how} = ${need + add} 보다 작습니다`);
      });
    return out;
  }

  /**
   * 빌트인 오븐 모델인가 — 가전 DB 오븐(category 'oven') 중 제조사 설치 공간(니치 W · H)이 적힌 것 (2026-10-30 사장님).
   * @param app {category, nicheW?, nicheH?}
   */
  function isBuiltinOvenModel(app) {
    return !!app && app.category === BI.CATEGORY && dim(app.nicheW) > 0 && dim(app.nicheH) > 0;
  }

  /**
   * 가전 칸 상자 — 고른 가전에 맞춘 높이 (2026-10-30 사장님 「가전에 맞춰 단 높이」, 위 머리 주석).
   *   빌트인 오븐                  PB 15T, 내경 높이 = 니치 H
   *   전자레인지 · 니치 없는 오븐  18T MDF, 내경 높이 = 가전 H + 위 여유 (제조사 값, 없으면 APPLIANCE_CLEARANCE)
   *   상자 H = 내경 높이 + 천지판 2장. 폭 · 깊이는 모듈이 정한다 (applianceWarningsOf 로 본다).
   * @param app {category, h, topGap?, nicheW?, nicheH?} 가전 DB 한 줄 (height_mm · top_gap_mm · niche_min_w/h_mm)
   * @returns {{ builtinOven: boolean, T: number, innerH: number, H: number } | null} 가전 높이를 모르면 null
   */
  function applianceBoxOf(app) {
    if (isBuiltinOvenModel(app)) {
      const innerH = dim(app.nicheH);
      return { builtinOven: true, T: BI.T, innerH, H: innerH + 2 * BI.T };
    }
    const h = dim(app && app.h);
    if (!(h > 0)) return null;
    const tg = app.topGap != null && Number.isFinite(Number(app.topGap)) && Number(app.topGap) >= 0 ? Math.round(Number(app.topGap)) : R.APPLIANCE_CLEARANCE;
    const innerH = h + tg;
    return { builtinOven: false, T: R.T, innerH, H: innerH + 2 * R.T };
  }

  return { RULES: OPEN_CABINET_RULES, isOpenCabinet, isBuiltinOven, innerOf, partsOf, warningsOf, applianceWarningsOf,
    isBuiltinOvenModel, applianceBoxOf };
});
