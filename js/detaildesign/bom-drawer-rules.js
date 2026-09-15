/**
 * 서랍장 · 목찬넬 · 레일 규칙 (2026-09-15 사장님 확정, 도면 "서랍장 목찬넬 구조 도면").
 *
 * 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamDrawerRules`, Node(Jest)는 module.exports.
 * BOM(extractors.js)이 서랍장 모듈의 전면·목찬넬·박스·레일을 이 파일로 계산한다.
 * 플래너(mockup-structure)가 같은 그림을 그리려면 이 파일을 실으면 된다 — 규칙을 두 군데 적지 않는다.
 *
 * 규칙 (몸통 높이 H 기준, mm):
 *   · 상단 목찬넬: 측판 상단 전면 70×40 따내기 = 지면판 18 + 전면판 52. 도어는 전면판 상단보다 30 아래에서 시작 (sink.md 도어 H−30).
 *   · 중간 목찬넬: 90×40 따내기 = 지면판 18 + 전면판 72. 위 전면이 따내기 윗선보다 20 내려와 전면판 위 20 을 가리고,
 *     그 아래 30 이 슬롯, 나머지 22 는 아래 전면 뒤. 한 슬롯에서 위 전면 밑단·아래 전면 윗단을 모두 잡는다.
 *   · 목찬넬 수: 전면과 1:1 이 아니다. 중간 목찬넬 하나가 위·아래 두 전면을 연다. 상단 목찬넬은 항상 있고(연속 EP),
 *     나머지는 "모든 전면이 슬롯 하나에 닿는 최소 수" — 아래에서 위로 짝지어 놓는다 (2단 1 · 3단 1 · 4단 2).
 *   · 목찬넬 없는 전면 사이는 도어 갭 4.
 *   · 서랍 최대 4단. 서랍 박스 높이 소 60 · 중 120 · 대 180.
 *   · 레일 여유: 댐핑 볼레일 = 박스 + 20 (아래 10 · 위 10), 댐핑 언더레일 = 박스 + 40 (아래 30 · 위 10).
 *   · 존(박스 자리): 위 따내기 바닥(또는 전면 경계) ~ 아래 따내기 윗선(또는 전면 경계, 마지막은 지판 윗면).
 *     존 안에 박스 + 여유가 들어가는 가장 큰 박스를 고른다.
 *   · 박스 치수 (2026-09-15 철물 규격, drawerBoxDims):
 *       레일 길이 = 250·300·350·400·450·500 중 모듈 깊이 − 50 이하의 최대.
 *       댐핑 볼레일  앞뒷판 가로 = W − 2×몸통T − 2×레일 두께 14 − 2×서랍T, 측판 길이 = 레일 길이
 *       댐핑 언더레일 앞뒷판 가로 = W − 2×몸통T − 2×서랍T − 12,          측판 길이 = 레일 길이 − 10
 *       측판 사쿠리면 앞뒷판 높이 = 측판 높이 − 18
 *       우라(밑판) = 서랍 외경 (가로 − 1) × (세로 − 1); 사쿠리면 가로 = 앞뒷판 + 20, 세로 = 측판 − 1
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamDrawerRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DRAWER_RULES = Object.freeze({
    MAX_COUNT: 4,
    BOX_H: Object.freeze({ small: 60, medium: 120, large: 180 }),
    BOX_LABEL: Object.freeze({ small: '소', medium: '중', large: '대' }),
    BOX_BRACE_OVER_W: 600,        // 전후판 가로가 이보다 크면 하단보강 (측판 길이 × 60)
    BOX_BRACE_H: 60,
    BOX_T_DEFAULT: 15,            // 서랍 자재 두께 (15 or 18) — 모듈이 정하지 않으면 몸통 두께를 따른다
    BOX_SAKURI_FB_MINUS: 18,      // 측판 사쿠리면 앞뒷판 높이 = 측판 높이 − 18
    BOTTOM_TRIM: 1,               // 우라 = (가로 − 1) × (세로 − 1)
    BOTTOM_SAKURI_PLUS_W: 20,     // 사쿠리면 우라 가로 = 앞뒷판 + 20 (양쪽 홈 10)
    RAIL_LENGTHS: Object.freeze([250, 300, 350, 400, 450, 500]),
    RAIL_DEPTH_MARGIN: 50,        // 레일 길이 ≤ 모듈 깊이 − 50
    RAIL_CLEARANCE: Object.freeze({
      //   below/above 박스 상하 여유 · thickness 레일 한쪽 두께(가로에서 뺀다) · fbMinus 앞뒷판 가로 추가 감산 · sideMinus 측판 길이 = 레일 − sideMinus
      under: Object.freeze({ below: 30, above: 10, name: '댐핑 언더레일', thickness: 0,  fbMinus: 12, sideMinus: 10 }),
      ball:  Object.freeze({ below: 10, above: 10, name: '댐핑 볼레일',   thickness: 14, fbMinus: 0,  sideMinus: 0 }),
    }),
    RAIL_DEFAULT: 'under',
    FRONT_DEFAULT_H: 200,         // 도어 + 하부 서랍 하부장의 서랍 전면 (플래너 drawerHeight 기본값과 같다)
    TOP_SLOT: 30,                 // 상단 슬롯 (도어 H−30)
    MID_SLOT: 30,                 // 중간 슬롯
    UPPER_DROP: 20,               // 위 전면이 중간 따내기 윗선 아래로 내려오는 길이
    FRONT_GAP: 4,                 // 목찬넬 없는 전면 사이 갭
    MIN_FRONT_H: 50,              // 이보다 낮은 전면은 부재로 내지 않는다 (옛 규칙 `hingeDoorH > 50` 과 같은 값)
    CHANNEL_T: 18,                // 목찬넬 부재 MDF 두께
    CHANNEL_BASE_W: 40,           // 지면판 폭 = 따내기 깊이
    CHANNEL_TOP_FACE_H: 52,       // 상단 전면판
    CHANNEL_TOP_NOTCH_H: 70,      // 18 + 52
    CHANNEL_MID_FACE_H: 72,       // 중간 전면판 = 20 + 30 + 22
    CHANNEL_MID_NOTCH_H: 90,      // 18 + 72
  });

  const BOX_ORDER = ['large', 'medium', 'small'];

  /** 레일 여유 (미지정·모르는 값은 기본 레일). */
  function railOf(rail) {
    return DRAWER_RULES.RAIL_CLEARANCE[rail] || DRAWER_RULES.RAIL_CLEARANCE[DRAWER_RULES.RAIL_DEFAULT];
  }
  function railKeyOf(rail) {
    return DRAWER_RULES.RAIL_CLEARANCE[rail] ? rail : DRAWER_RULES.RAIL_DEFAULT;
  }

  /**
   * 목찬넬 최소 배치. fronts 는 위→아래 순서. 돌려주는 값은 각 전면 사이(i, i+1)에 중간 목찬넬이 있는지.
   *   상단(0번 전면 위)은 항상 있다. 아래에서 위로 올라오며 아직 슬롯이 없는 전면 i 를 만나면 (i−1, i) 사이에 놓는다 —
   *   그 하나가 i−1 의 밑단과 i 의 윗단을 함께 연다.
   */
  function assignChannels(n) {
    const midBelow = new Array(Math.max(0, n - 1)).fill(false); // midBelow[i] = 전면 i 와 i+1 사이
    const served = new Array(n).fill(false);
    if (n > 0) served[0] = true;
    for (let i = n - 1; i >= 1; i--) {
      if (served[i]) continue;
      midBelow[i - 1] = true;
      served[i - 1] = true;
      served[i] = true;
    }
    return midBelow;
  }

  /** 존 높이 안에 들어가는 가장 큰 박스. 없으면 소 + fits:false. */
  function pickBox(zoneH, rail) {
    const c = railOf(rail);
    for (const size of BOX_ORDER) {
      const h = DRAWER_RULES.BOX_H[size];
      if (h + c.below + c.above <= zoneH) return { size, h, fits: true };
    }
    return { size: 'small', h: DRAWER_RULES.BOX_H.small, fits: false };
  }

  /**
   * 서랍장 한 모듈의 전면·목찬넬·존·박스를 계산한다.
   *
   * @param {object} o
   *   H        몸통 높이 (측판 세로)
   *   T        몸통 두께 (지판 두께 — 마지막 존의 바닥)
   *   fronts   [{kind:'door'|'drawer', h?}] 위→아래. h 없는 전면은 남는 높이를 균등 배분.
   *   rail     'under' | 'ball'
   * @returns {{fronts, channels, midCount, boxes, warnings}}
   *   fronts[i]   {kind, h, y0, y1, channelAbove:'top'|'mid'|null, channelBelow:'mid'|null, zone?, box?}
   *   channels    [{kind:'top'|'mid', y, notchH, notchD, faceH, baseW}]
   *   boxes       서랍 전면 순서대로 {frontIndex, size, h, fits, zoneH, rail}
   */
  function layoutDrawerModule(o) {
    const R = DRAWER_RULES;
    const H = Number(o.H) || 0;
    const T = Number(o.T) || 15;
    const rail = railKeyOf(o.rail);
    const warnings = [];
    let fronts = (o.fronts || []).map((f) => ({ kind: f.kind === 'door' ? 'door' : 'drawer', h: Number(f.h) > 0 ? Number(f.h) : null }));

    // 서랍 최대 4단 — 넘치면 아래쪽부터 자른다
    const drawerIdx = fronts.map((f, i) => (f.kind === 'drawer' ? i : -1)).filter((i) => i >= 0);
    if (drawerIdx.length > R.MAX_COUNT) {
      warnings.push(`서랍 ${drawerIdx.length}단 → 최대 ${R.MAX_COUNT}단으로 줄임`);
      const drop = new Set(drawerIdx.slice(R.MAX_COUNT));
      fronts = fronts.filter((_, i) => !drop.has(i));
    }
    const n = fronts.length;
    if (n === 0) return { fronts: [], channels: [], midCount: 0, boxes: [], warnings };

    const midBelow = assignChannels(n);
    const midCount = midBelow.filter(Boolean).length;
    const gapCount = n - 1 - midCount;

    // 높이 배분
    const fixed = fronts.reduce((s, f) => s + (f.h || 0), 0);
    const flexible = fronts.filter((f) => f.h === null);
    const avail = H - R.TOP_SLOT - R.MID_SLOT * midCount - R.FRONT_GAP * gapCount - fixed;
    if (flexible.length > 0) {
      if (avail <= 0) warnings.push(`전면 높이가 부족하다 (남는 높이 ${avail})`);
      const each = Math.max(0, Math.floor(avail / flexible.length));
      let rem = Math.max(0, avail - each * flexible.length);
      flexible.forEach((f, k) => { f.h = each + (k === flexible.length - 1 ? rem : 0); });
    } else if (avail !== 0) {
      warnings.push(`전면 높이 합이 몸통과 ${avail > 0 ? '모자란다' : '넘친다'} (${Math.abs(avail)})`);
    }

    // 2026-09-15: 너무 낮은 전면은 만들 수 없다 — 경고하고, 부재·그림에서 뺀다 (MIN_FRONT_H).
    //   서랍 전면 높이를 크게 주면 남는 도어가 한 자리 mm 로 쪼그라든다 (708 몸통에 서랍 200×3 → 도어 14).
    fronts.forEach((f, i) => {
      if (f.h > 0 && f.h < R.MIN_FRONT_H) {
        warnings.push(`전면 ${i + 1}(${f.kind === 'door' ? '도어' : '서랍'}) 높이 ${f.h} 가 최소 ${R.MIN_FRONT_H} 미만 — 부재로 내지 않는다`);
      }
    });

    // 위치
    const channels = [{ kind: 'top', y: 0, notchH: R.CHANNEL_TOP_NOTCH_H, notchD: R.CHANNEL_BASE_W, faceH: R.CHANNEL_TOP_FACE_H, baseW: R.CHANNEL_BASE_W }];
    let y = R.TOP_SLOT;
    fronts.forEach((f, i) => {
      f.y0 = y;
      f.y1 = y + f.h;
      f.channelAbove = i === 0 ? 'top' : (midBelow[i - 1] ? 'mid' : null);
      f.channelBelow = i < n - 1 && midBelow[i] ? 'mid' : null;
      if (f.channelBelow === 'mid') {
        const S = f.y1 - R.UPPER_DROP;
        channels.push({ kind: 'mid', y: S, notchH: R.CHANNEL_MID_NOTCH_H, notchD: R.CHANNEL_BASE_W, faceH: R.CHANNEL_MID_FACE_H, baseW: R.CHANNEL_BASE_W });
        y = S + R.UPPER_DROP + R.MID_SLOT;
      } else {
        y = f.y1 + R.FRONT_GAP;
      }
    });

    // 존 · 박스 (서랍 전면만)
    const boxes = [];
    fronts.forEach((f, i) => {
      if (f.kind !== 'drawer') return;
      let top;
      if (f.channelAbove === 'top') top = R.CHANNEL_TOP_NOTCH_H;
      else if (f.channelAbove === 'mid') top = (f.y0 - R.MID_SLOT - R.UPPER_DROP) + R.CHANNEL_MID_NOTCH_H;
      else top = f.y0 - R.FRONT_GAP / 2;
      let bottom;
      if (f.channelBelow === 'mid') bottom = f.y1 - R.UPPER_DROP;
      else if (i < n - 1) bottom = f.y1 + R.FRONT_GAP / 2;
      else bottom = H - T;
      const zoneH = bottom - top;
      const box = pickBox(zoneH, rail);
      f.zone = { top, bottom, h: zoneH };
      f.box = box;
      if (!box.fits) warnings.push(`전면 ${i + 1}: 존 ${zoneH} 에 소 박스(${box.h}+${railOf(rail).below + railOf(rail).above})도 안 들어간다`);
      boxes.push({ frontIndex: i, size: box.size, h: box.h, fits: box.fits, zoneH, rail });
    });

    return { fronts, channels, midCount, boxes, warnings, rail };
  }

  /** 레일 길이 — 규격 중 모듈 깊이 − 50 이하의 최대. 가장 짧은 규격도 안 들어가면 null. */
  function railLengthFor(D) {
    const R = DRAWER_RULES;
    const max = (Number(D) || 0) - R.RAIL_DEPTH_MARGIN;
    let best = null;
    R.RAIL_LENGTHS.forEach((L) => { if (L <= max) best = L; });
    return best;
  }

  /**
   * 서랍 박스 치수 — 레일 종류·모듈 폭/깊이·자재 두께·사쿠리로 정한다.
   * @param {object} o  W 모듈 외경 · D 모듈 깊이 · bodyT 몸통 두께 · drawerT 서랍 자재 두께(없으면 bodyT) ·
   *                    rail 'under'|'ball' · boxH 박스(측판) 높이 · sakuri 측판 사쿠리 여부
   * @returns {{railLength, fbW, fbH, sideL, sideH, outerW, bottomW, bottomD, brace, warnings}}
   */
  function drawerBoxDims(o) {
    const R = DRAWER_RULES;
    const rail = railOf(o.rail);
    const W = Number(o.W) || 0;
    const D = Number(o.D) || 0;
    const bodyT = Number(o.bodyT) || R.BOX_T_DEFAULT;
    const drawerT = Number(o.drawerT) || bodyT;
    const boxH = Number(o.boxH) || 0;
    const sakuri = !!o.sakuri;
    const warnings = [];
    let railLength = railLengthFor(D);
    if (railLength === null) {
      railLength = R.RAIL_LENGTHS[0];
      warnings.push(`모듈 깊이 ${D} 에는 가장 짧은 레일 ${railLength} 도 안 들어간다 (깊이 − ${R.RAIL_DEPTH_MARGIN} 기준)`);
    }
    const fbW = W - 2 * bodyT - 2 * rail.thickness - 2 * drawerT - rail.fbMinus;
    const sideL = railLength - rail.sideMinus;
    const sideH = boxH;
    const fbH = sakuri ? boxH - R.BOX_SAKURI_FB_MINUS : boxH;
    const outerW = fbW + 2 * drawerT;
    const bottomW = sakuri ? fbW + R.BOTTOM_SAKURI_PLUS_W : outerW - R.BOTTOM_TRIM;
    const bottomD = sideL - R.BOTTOM_TRIM;
    return {
      railLength, fbW, fbH, sideL, sideH, outerW, bottomW, bottomD,
      brace: fbW > R.BOX_BRACE_OVER_W, drawerT, bodyT, sakuri, rail: railKeyOf(o.rail), warnings,
    };
  }

  /** 측판 따내기 설명 — BOM 비고용. */
  function notchNote(layout) {
    const R = DRAWER_RULES;
    const mids = layout && layout.midCount ? layout.midCount : 0;
    let s = `목찬넬 따내기 상단 ${R.CHANNEL_TOP_NOTCH_H}×${R.CHANNEL_BASE_W}`;
    if (mids > 0) s += ` + 중간 ${R.CHANNEL_MID_NOTCH_H}×${R.CHANNEL_BASE_W} ×${mids}`;
    return s;
  }

  return { DRAWER_RULES, layoutDrawerModule, assignChannels, pickBox, railOf, railKeyOf, notchNote, railLengthFor, drawerBoxDims };
});
