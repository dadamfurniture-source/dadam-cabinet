/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, SHEET_W, SHEET_H, CUT_KERF */
/**
 * 네스팅 엔진 — 재단 배치의 단일 정본 (B4).
 *
 * ai-design-report.js 의 `calcCuttingPlan`(스트립 길로틴 + H/V × 정방향/회전 4방향, 겹침 재단)을
 * 여기로 옮겨 순수 함수로 만들었다. 화면(CNC 탭·XLSX)과 저장(스냅샷 `cut_plan_payload`)이
 * 같은 결과를 본다. DOM·전역 상태를 건드리지 않고, 같은 입력이면 항상 같은 JSON 을 낸다.
 *
 * 알고리즘 (calcCuttingPlan 그대로):
 *   1. 자재·두께·부재 구분(본체/도어/뒷판)으로 그룹을 나눈다 — 원판을 섞지 않는다.
 *   2. 그룹 안에서 같은 치수(+회전 가능 여부)를 한 "need" 로 묶고 수량 많은 순 → 면적 큰 순으로 본다.
 *   3. 같은 부재만으로 원판을 채울 수 있으면(2장 이상) 그 배치를 먼저 겹침(최대 5장)으로 뺀다.
 *   4. 나머지는 혼합 배치 — 가로→세로(H)·세로→가로(V) × 정방향/회전 네 후보를 만들고
 *      실제 생산량 → 배치 수 → 잔재에서 뽑는 소부품 수 → 60~70 자투리 길이 → 활용 면적 → 스트립 수로 고른다.
 *   5. 스트립: 첫 부재 치수로 높이(H) 또는 너비(V)를 정하고, 같은 치수를 먼저 채운 뒤(1차) 남는 자리에
 *      더 작은 부재를 넣는다(2차, `fromRemainder`). 부재 사이에는 커프를 둔다.
 *
 * B4 에서 더한 것:
 *   - 결(grain): `grain` 이 'none' 이 아니거나 자재 이름이 회전 금지 목록(무늬목·우드·결 PET)에 들면 회전하지 않는다.
 *     회전 후보에서도 그런 부재는 제자리 치수를 유지한다.
 *   - 자재별 원판 크기: `opts.sheetSizes['PB_15']` 또는 `opts.sheetSizes['PB']`.
 *   - 가장자리 트림: `opts.trim`(기본 10mm, 네 변). 배치 좌표는 원판 좌상단 기준 절대값이라 트림만큼 밀려 있다.
 *   - 커프: `opts.kerf` > 전역 `CUT_KERF`(data-constants.js) > 4.
 *   - 수량 전개: 자재 행 `qty` 를 `partId#k` (k = 0..qty-1) 로 낱개 전개해 시트마다 어느 부재가 놓였는지 적는다.
 *
 * 재단 방식 (2026-11-17 사장님) — `opts.strategy` 를 주면 묶음마다 후보 배치를 여럿 만들어 그 가운데서 고른다 (아래 「재단 방식」):
 *   - standard (표준): 첫 톱질이 원판 긴 변(2440)과 나란하다 — 폭을 긴 띠로 켠 뒤 띠를 돌려 토막 낸다. 그 차례에서 원판 수가 가장 적은 배치.
 *   - material (부재 최적화): 자르는 횟수와 상관없이 원판이 가장 많이 남는 배치.
 *   - cuts (최소 재단): 묶음마다 표준보다 한 장까지 더 쓰는 안에서 자르는 횟수가 가장 적은 배치.
 *   기본 조건 (2026-11-19 사장님 「원장 한 장에서 나오는 자투리 자재가 최대한 적게」 · 「톱질 방향은 그대로 · 앞 장부터 꽉」):
 *     원판 수가 같으면 앞 원판부터 꽉 채운 배치를 고른다 — 남는 넓이는 마지막 원판에 모인다 (표준의 첫 톱질 방향은 그대로).
 *   `opts.colorOf(row)` 를 주면 색이 다른 판을 한 원판에 섞지 않는다 (묶음 키에 색이 붙는다).
 *   둘 다 주지 않으면 위 알고리즘 그대로다 — 결과 JSON 이 한 글자도 바뀌지 않는다 (앱 CNC 탭 · 스냅샷이 그렇게 부른다).
 *
 * 출력(cutPlan)은 docs/design-rules/bom-protocol.md §7-3 이 정본이다.
 *
 * 전역 스크립트(detaildesign.html) + CommonJS 이중 노출(Jest). extractors.js 와 같은 방식.
 */
(function () {
  'use strict';

  const DEFAULT_SHEET_W = 1220;
  const DEFAULT_SHEET_H = 2440;
  const DEFAULT_KERF = 4;
  const DEFAULT_TRIM = 10;
  /** 이하(≤)면 소부품 — 원판에 배치하지 않고 잔재에서 뽑는다 (보강목·덧대·밴드). */
  const SMALL_LIMIT = 70;
  /** 겹침 재단 최대 장수 */
  const MAX_STACK = 5;
  /** 60~70mm 는 "자투리"(밴드·보강재), 70 초과는 "잔재"(재활용·소부품 추출) */
  const THIN_MIN = 60;
  const THIN_MAX = 70;
  /** 혼합 배치 루프 상한 (calcCuttingPlan 의 safety 와 같다) */
  const MAX_MIXED_ROUNDS = 30;

  /** 자재 이름만으로 회전을 막는 목록 — 결이 있는 표면재. PET 는 결 무늬(우드)일 때만. */
  const NO_ROTATE_MATERIALS = [/무늬목/, /우드/i, /wood/i, /결\s*PET/i, /PET.*(우드|결)/i];

  /** 「뒷판」 원판 묶음은 이 두께 미만만 — 얇은 뒷판 · 서랍밑판(MDF 3T). 생산 부하(workers/workflow-api production/workload.js)의 뒷판 기준과 같다. */
  const THIN_BACK_LIMIT = 5;

  /**
   * 원판을 나누는 부재 구분 — ai-design-report.js getPartType 과 같은 규칙 (본체/도어/뒷판 원판 분리).
   *   두께를 알면 5T 이상 뒷판(오픈 상자 · 밥솥장 · 홈카페장 18T 뒷판)은 같은 두께 몸통 판과 한 원장 —
   *   2026-11-05 사장님 「MDF 18T 뒷판은 18T 몸통 판과 같은 원장」 (작업지시서 손보기 F). 두께를 모르면 예전처럼 이름만 본다.
   */
  function partClassOf(partName, thickness) {
    const s = String(partName || '');
    if (/도어/.test(s)) return '도어';
    if (/뒷판|서랍밑판/.test(s)) {
      const t = num(thickness);
      return t >= THIN_BACK_LIMIT ? '본체' : '뒷판';
    }
    if (/몰딩|걸레받이|목찬넬|마감/.test(s)) return '도어';
    return '본체';
  }

  /**
   * 재단 배치에서 빼는 상판 — 상판 업체에 발주하는 석재 (2026-10-18 사장님: 상판 발주 요청서 대상, data-constants.js TOP_MATERIALS).
   *   2026-11-05 사장님 「석재 상판은 사내 재단 원장에서 뺀다 · MDF · PB 상판은 그대로 재단」 (작업지시서 손보기 5).
   */
  const OUTSOURCED_TOP_MATERIALS = ['인조대리석', '엔지니어드 스톤', '세라믹'];

  /** 석재 상판 행인가 — 상판 칸(slot top) 또는 부품 이름 「상판」 이고 자재가 석재 */
  function isOutsourcedTop(m) {
    if (!m) return false;
    const isTop = m.slot === 'top' || String(m.part || '') === '상판';
    return isTop && OUTSOURCED_TOP_MATERIALS.indexOf(String(m.material || '').trim()) >= 0;
  }

  function num(v) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function round4(x) {
    return Math.round(x * 10000) / 10000;
  }

  /** 전역 상수(data-constants.js)가 있으면 그 값을, 없으면(Node) 기본값을 쓴다. */
  function globalDefaults() {
    return {
      w: typeof SHEET_W === 'number' ? SHEET_W : DEFAULT_SHEET_W,
      h: typeof SHEET_H === 'number' ? SHEET_H : DEFAULT_SHEET_H,
      kerf: typeof CUT_KERF === 'number' ? CUT_KERF : DEFAULT_KERF,
    };
  }

  function matchesNoRotate(material, list) {
    const name = String(material || '');
    return list.some((p) => (p instanceof RegExp ? p.test(name) : String(p) === name));
  }

  /** 이 자재 행이 회전해도 되는가 — 결이 있으면 안 된다. */
  function rotatableOf(m, noRotateList) {
    if (m.rotatable === false) return false;
    const grain = m.grain;
    if (grain !== undefined && grain !== null && grain !== '' && grain !== 'none' && grain !== false) return false;
    return !matchesNoRotate(m.material, noRotateList);
  }

  function grainOf(m, rotatable) {
    if (typeof m.grain === 'string' && m.grain) return m.grain;
    return rotatable ? 'none' : 'fixed';
  }

  function sheetSizeFor(material, thickness, opts, dflt) {
    const sizes = opts.sheetSizes || {};
    const s = sizes[`${material}_${thickness}`] || sizes[material] || opts.sheetSize || dflt;
    return { w: num(s.w) || dflt.w, h: num(s.h) || dflt.h };
  }

  // ── calcCuttingPlan 이식 (좌표계: 트림 안쪽 usable 영역, 원점 0) ─────────────────

  function designLayoutH(needs, PW, PH, kerf) {
    const pieceCounts = new Map();
    let usedArea = 0;
    const strips = [];
    let availH = PH;
    const sorted = [...needs].sort((a, b) => b.h - a.h || b.w - a.w);

    while (availH > SMALL_LIMIT) {
      let stripH = 0;
      for (const n of sorted) {
        const avail = n.remain - (pieceCounts.get(n.idx) || 0);
        if (avail > 0 && n.h <= availH) { stripH = n.h; break; }
      }
      if (stripH === 0) break;

      const strip = { height: stripH, pieces: [], usedW: 0 };

      // 1차: 같은 높이만 (재단 횟수 최소화)
      // 이미 놓인 조각이 있으면 그 뒤에 커프 하나(gap)를 둔다 — 옛 calcCuttingPlan 은 이 커프를 빠뜨려
      // 너비가 다른 두 부재를 이어 붙일 때 원판을 최대 4mm 넘칠 수 있었다 (SVG clipPath 가 가렸다).
      for (const n of sorted) {
        const placed = pieceCounts.get(n.idx) || 0;
        const avail = n.remain - placed;
        const gap = strip.usedW > 0 ? kerf : 0;
        const spaceLeft = PW - strip.usedW - gap;
        if (avail <= 0 || n.h !== stripH || n.w > spaceLeft) continue;
        const fitCount = Math.min(avail, Math.floor((spaceLeft + kerf) / (n.w + kerf)));
        if (fitCount <= 0) continue;
        strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, count: fitCount });
        strip.usedW += gap + (n.w + kerf) * fitCount - kerf;
        pieceCounts.set(n.idx, placed + fitCount);
        usedArea += n.w * n.h * fitCount;
      }

      // 2차: 남는 자리에 더 낮은 부재
      if (PW - strip.usedW > SMALL_LIMIT) {
        for (const n of sorted) {
          const placed = pieceCounts.get(n.idx) || 0;
          const avail = n.remain - placed;
          const gap = strip.usedW > 0 ? kerf : 0;
          const spaceLeft = PW - strip.usedW - gap;
          if (avail <= 0 || n.h > stripH || n.h === stripH || n.w > spaceLeft) continue;
          const fitCount = Math.min(avail, Math.floor((spaceLeft + kerf) / (n.w + kerf)));
          if (fitCount <= 0) continue;
          strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, count: fitCount, fromRemainder: true });
          strip.usedW += gap + (n.w + kerf) * fitCount - kerf;
          pieceCounts.set(n.idx, placed + fitCount);
          usedArea += n.w * n.h * fitCount;
        }
      }

      if (strip.pieces.length === 0) break;

      strip.pieces.sort((a, b) => b.w - a.w || b.count - a.count);
      strip.remainW = PW - strip.usedW;
      strips.push(strip);
      availH -= stripH + kerf;
    }

    let totalPieces = 0;
    pieceCounts.forEach((c) => { totalPieces += c; });
    let thinLen = 0;
    for (const s of strips) if (s.remainW >= THIN_MIN && s.remainW <= THIN_MAX) thinLen += s.height;
    if (availH >= THIN_MIN && availH <= THIN_MAX) thinLen += PW;

    return { dir: 'H', strips, pieceCounts, usedArea, remainH: availH, totalPieces, thinLen };
  }

  function designLayoutV(needs, PW, PH, kerf) {
    const pieceCounts = new Map();
    let usedArea = 0;
    const strips = [];
    let availW = PW;
    const sorted = [...needs].sort((a, b) => b.w - a.w || b.h - a.h);

    while (availW > SMALL_LIMIT) {
      let stripW = 0;
      for (const n of sorted) {
        const avail = n.remain - (pieceCounts.get(n.idx) || 0);
        if (avail > 0 && n.w <= availW) { stripW = n.w; break; }
      }
      if (stripW === 0) break;

      const strip = { width: stripW, pieces: [], usedH: 0 };

      for (const n of sorted) {
        const placed = pieceCounts.get(n.idx) || 0;
        const avail = n.remain - placed;
        const gap = strip.usedH > 0 ? kerf : 0;
        const spaceLeft = PH - strip.usedH - gap;
        if (avail <= 0 || n.w !== stripW || n.h > spaceLeft) continue;
        const fitCount = Math.min(avail, Math.floor((spaceLeft + kerf) / (n.h + kerf)));
        if (fitCount <= 0) continue;
        strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, count: fitCount });
        strip.usedH += gap + (n.h + kerf) * fitCount - kerf;
        pieceCounts.set(n.idx, placed + fitCount);
        usedArea += n.w * n.h * fitCount;
      }

      if (PH - strip.usedH > SMALL_LIMIT) {
        for (const n of sorted) {
          const placed = pieceCounts.get(n.idx) || 0;
          const avail = n.remain - placed;
          const gap = strip.usedH > 0 ? kerf : 0;
          const spaceLeft = PH - strip.usedH - gap;
          if (avail <= 0 || n.w > stripW || n.w === stripW || n.h > spaceLeft) continue;
          const fitCount = Math.min(avail, Math.floor((spaceLeft + kerf) / (n.h + kerf)));
          if (fitCount <= 0) continue;
          strip.pieces.push({ idx: n.idx, w: n.w, h: n.h, count: fitCount, fromRemainder: true });
          strip.usedH += gap + (n.h + kerf) * fitCount - kerf;
          pieceCounts.set(n.idx, placed + fitCount);
          usedArea += n.w * n.h * fitCount;
        }
      }

      if (strip.pieces.length === 0) break;

      strip.pieces.sort((a, b) => b.h - a.h || b.count - a.count);
      strip.remainH = PH - strip.usedH;
      strips.push(strip);
      availW -= stripW + kerf;
    }

    let totalPieces = 0;
    pieceCounts.forEach((c) => { totalPieces += c; });
    let thinLen = 0;
    for (const s of strips) if (s.remainH >= THIN_MIN && s.remainH <= THIN_MAX) thinLen += s.width;
    if (availW >= THIN_MIN && availW <= THIN_MAX) thinLen += PH;

    return { dir: 'V', strips, pieceCounts, usedArea, remainW: availW, totalPieces, thinLen };
  }

  /** 이 배치의 잔재(>70)에서 소부품을 몇 개 뽑을 수 있는지 — 방향 선택의 보조 기준. */
  function calcSmallYield(layout, PW, PH, smalls) {
    if (!smalls || smalls.length === 0) return 0;
    const rems = [];
    if (layout.dir === 'H') {
      layout.strips.forEach((s) => { if (s.remainW > THIN_MAX) rems.push({ w: s.remainW, h: s.height }); });
      if (layout.remainH > THIN_MAX) rems.push({ w: PW, h: layout.remainH });
    } else {
      layout.strips.forEach((s) => { if (s.remainH > THIN_MAX) rems.push({ w: s.width, h: s.remainH }); });
      if (layout.remainW > THIN_MAX) rems.push({ w: layout.remainW, h: PH });
    }
    if (rems.length === 0) return 0;

    const needs = smalls.map((s) => ({ w: s.w, h: s.h, tmpRemain: s.qty }));
    let total = 0;
    for (const rem of rems) {
      for (const sp of needs) {
        if (sp.tmpRemain <= 0) continue;
        const cntA = Math.floor(rem.w / sp.w) * Math.floor(rem.h / sp.h);
        const cntB = Math.floor(rem.w / sp.h) * Math.floor(rem.h / sp.w);
        const use = Math.min(Math.max(cntA, cntB), sp.tmpRemain);
        if (use > 0) { total += use; sp.tmpRemain -= use; }
      }
    }
    return total;
  }

  /**
   * H/V × 정방향/회전 네 후보 중 최적.
   * 회전 후보에서도 `rotatable === false` 인 need 는 치수를 바꾸지 않는다 (결 유지).
   */
  function chooseCutDirection(needs, PW, PH, kerf, smalls) {
    const h = designLayoutH(needs, PW, PH, kerf);
    const v = designLayoutV(needs, PW, PH, kerf);
    h.rotated = false; v.rotated = false;

    const rotNeeds = needs.map((n) => (n.rotatable ? { ...n, w: n.h, h: n.w, rot: true } : { ...n, rot: false }));
    const hr = designLayoutH(rotNeeds, PW, PH, kerf);
    const vr = designLayoutV(rotNeeds, PW, PH, kerf);
    hr.rotated = true; vr.rotated = true;

    const candidates = [h, v, hr, vr];
    candidates.forEach((c) => {
      c.smallYield = calcSmallYield(c, PW, PH, smalls);
      let estStack = MAX_STACK;
      const src = c.rotated ? rotNeeds : needs;
      const byIdx = new Map(src.map((n) => [n.idx, n]));
      c.pieceCounts.forEach((count, idx) => {
        const n = byIdx.get(idx);
        if (n) estStack = Math.min(estStack, Math.floor(n.remain / count));
      });
      c.estStack = Math.max(1, estStack);
      c.effectivePieces = c.totalPieces * c.estStack;
      // 회전 배치의 조각에 "이 조각이 회전됐는가" 를 적어 둔다 (결 부재는 false)
      if (c.rotated) {
        c.strips.forEach((s) => s.pieces.forEach((p) => { const n = byIdx.get(p.idx); p.rot = Boolean(n && n.rot); }));
      } else {
        c.strips.forEach((s) => s.pieces.forEach((p) => { p.rot = false; }));
      }
    });

    candidates.sort((a, b) => {
      if (b.effectivePieces !== a.effectivePieces) return b.effectivePieces - a.effectivePieces;
      if (b.totalPieces !== a.totalPieces) return b.totalPieces - a.totalPieces;
      if (b.smallYield !== a.smallYield) return b.smallYield - a.smallYield;
      if (b.thinLen !== a.thinLen) return b.thinLen - a.thinLen;
      if (b.usedArea !== a.usedArea) return b.usedArea - a.usedArea;
      return a.strips.length - b.strips.length;
    });
    return candidates[0];
  }

  function panelOf(id, stack, layout) {
    return {
      id,
      stack,
      dir: layout.dir,
      rotated: layout.rotated || false,
      strips: layout.strips,
      usedArea: layout.usedArea,
      panelRemain: layout.dir === 'H' ? layout.remainH : layout.remainW,
      smallYield: layout.smallYield || 0,
    };
  }

  /**
   * 한 그룹(자재·두께·부재 구분)의 원판 배치 — calcCuttingPlan 본체.
   * needs: [{ idx, w, h, remain, rotatable }] (호출자가 정렬해 둔 순서를 지킨다)
   */
  function layoutGroup(needsIn, PW, PH, kerf, smalls) {
    const needs = needsIn.map((n, i) => ({ ...n, idx: i }));
    // 수량 많은 순 → 면적 큰 순 (스택 극대화). 안정 정렬이라 나머지는 입력 순서.
    needs.sort((a, b) => b.remain - a.remain || (b.w * b.h) - (a.w * a.h));
    needs.forEach((n, i) => { n.idx = i; });

    const panels = [];

    // 동일 치수 단독 원판 (겹침 극대화)
    needs.forEach((n) => {
      if (n.remain < 2) return;
      const solo = chooseCutDirection([n], PW, PH, kerf, smalls);
      if (solo.totalPieces === 0) return;
      const fullStacks = Math.floor(n.remain / solo.totalPieces);
      if (fullStacks < 2) return;
      const useStacks = Math.min(fullStacks, MAX_STACK);
      n.remain -= solo.totalPieces * useStacks;
      panels.push(panelOf(panels.length + 1, useStacks, solo));
    });

    // 혼합 배치
    let safety = 0;
    while (needs.some((n) => n.remain > 0) && safety++ < MAX_MIXED_ROUNDS) {
      const layout = chooseCutDirection(needs, PW, PH, kerf, smalls);
      if (layout.totalPieces === 0) break;
      let stack = MAX_STACK;
      layout.pieceCounts.forEach((count, idx) => { stack = Math.min(stack, Math.floor(needs[idx].remain / count)); });
      stack = Math.max(1, stack);
      layout.pieceCounts.forEach((count, idx) => { needs[idx].remain -= count * stack; });
      panels.push(panelOf(panels.length + 1, stack, layout));
    }

    return { panels, needs, unallocated: needs.filter((n) => n.remain > 0) };
  }

  // ── 재단 방식 (2026-11-17 사장님 「재단은 총 3가지 중 선택」) ─────────────────────
  //   위 layoutGroup 은 원판마다 그때 가장 많이 놓이는 배치를 고르는 한 가지 방식이다. 여기서는 묶음(자재 · 두께 · 구분 · 색) 하나를
  //   여러 방식으로 끝까지 놓아 보고(후보) 원판 수 · 자르는 횟수 · 남는 넓이를 세어, 고른 재단 방식에 맞는 후보를 낸다.
  //   후보는 모두 띠 재단이다 (끝에서 끝까지 직선으로 켜는 톱) — 첫 톱질 방향 × 부재 돌리기 × 띠 폭 고르기 × 좁은 부재 같이 놓기 × 되풀이 방식.
  //   후보 수는 개수로만 줄인다 (시간으로 끊지 않는다 — 같은 입력이면 늘 같은 결과).
  //   「가장 적은」은 만들어 본 후보 가운데서다 — 증명된 최소가 아니다 (화면 · 문서에 「최소 보장」이라 적지 않는다).

  const STRATEGIES = Object.freeze([
    Object.freeze({ id: 'standard', label: '표준' }),
    Object.freeze({ id: 'material', label: '부재 최적화' }),
    Object.freeze({ id: 'cuts', label: '최소 재단' }),
  ]);
  /** 다시 쓸 수 있는 자투리 크기 — 재고 자투리 화면의 「쓸 수 있는 것」(workers/workflow-api stock-needs.js CANDIDATE_MIN)과 같다 */
  const REUSE_LONG = 600;
  const REUSE_SHORT = 400;
  /** 최소 재단이 표준보다 더 써도 되는 원판 수 — 묶음마다 (2026-11-17 사장님 「한 장까지는 더 써도 됨」) */
  const CUTS_EXTRA_SHEETS = 1;
  /** 후보 수 한도 — 묶음이 크면(치수 종류 × 조각 수) 줄인다. 아무리 커도 앞의 VARIANT_MIN 개는 만든다 */
  const SEARCH_WORK = 400000;
  const VARIANT_MIN = 14;
  /** 「원판 한 장을 가장 넓게」 후보(fill)가 띠 하나 · 원판 한 장을 짤 때 보는 가지 수 — 셈 한도다 (개수로만 끊는다 — 같은 입력이면 같은 결과) */
  const FILL_STRIP_NODES = 200;
  const FILL_SHEET_NODES = 300;

  /**
   * 후보 방식 — 차례가 곧 우선순위다 (한도로 줄일 때 앞에서부터, 점수가 같으면 앞의 것).
   *   dir       첫 톱질: long = 원판 긴 변과 나란히 (1220 × 2440 이면 2440 길이로 켠다 — 표준) · short = 짧은 변과 나란히 · best = 원판마다 더 넓게 쓰는 쪽
   *   orient    부재 돌리기: free = 부재마다 · asis = 그린 대로 · rot = 돌릴 수 있는 것은 모두 돌려서 (결 부재는 어느 쪽이든 그대로)
   *   pick      다음 띠 폭: widest = 들어가는 가장 넓은 것 · dense = 띠를 가장 꽉 채우는 것 · area = 가장 넓게 쓰는 것 · fit = 원판을 가장 넓게 쓰는 띠 폭 조합 (fill 만)
   *   remainder 띠에 남는 길이에 더 좁은 부재를 놓는다 (한 번 더 켠다 — 2026-11-17 사장님 「허락」)
   *   mode      repeat = 같은 배치를 겹칠 수 있는 만큼 겹친다 · plain = 원판마다 새로 · solo = 같은 부재로 꽉 차는 원판 먼저 · ffd = 띠를 다 만든 뒤 넓은 것부터 원판에
   *             fill = 원판 한 장을 가장 넓게 쓰는 배치로 짜고(띠 폭 조합 × 띠마다 길이 조합) 남은 부재로 다음 장 — 앞 장부터 꽉 찬다 (2026-11-19). 긴 변 먼저만
   */
  const VARIANTS = (function () {
    const out = [];
    const seen = new Set();
    const push = (dir, orient, pick, remainder, mode) => {
      if (mode === 'ffd' && dir === 'best') return;
      const key = [dir, orient, pick, remainder ? 1 : 0, mode].join('|');
      if (seen.has(key)) return;
      seen.add(key);
      out.push(Object.freeze({ dir, orient, pick, remainder, mode }));
    };
    // 맨 앞 둘 — 앞 장부터 꽉 채우는 후보 (한도가 하나여도 표준이 고를 것이 있다)
    push('long', 'free', 'fit', true, 'fill');
    push('long', 'free', 'fit', false, 'fill');
    // 다음 12개 — 한도가 가장 작을 때도 세 방식이 모두 고를 것이 있게 (긴 변 먼저 여덟 + 그 밖 넷)
    [
      ['long', 'free', 'widest', true, 'repeat'], ['long', 'free', 'dense', true, 'repeat'],
      ['long', 'asis', 'widest', true, 'repeat'], ['long', 'rot', 'widest', true, 'repeat'],
      ['long', 'free', 'dense', true, 'plain'], ['long', 'free', 'widest', true, 'solo'],
      ['long', 'free', 'area', true, 'ffd'], ['long', 'free', 'dense', false, 'repeat'],
      ['best', 'free', 'dense', true, 'repeat'], ['best', 'free', 'widest', true, 'solo'],
      ['short', 'free', 'dense', true, 'repeat'], ['best', 'free', 'dense', false, 'plain'],
    ].forEach((c) => push(c[0], c[1], c[2], c[3], c[4]));
    ['asis', 'rot'].forEach((orient) => [true, false].forEach((remainder) => push('long', orient, 'fit', remainder, 'fill')));
    ['long', 'short', 'best'].forEach((dir) => ['free', 'asis', 'rot'].forEach((orient) => ['widest', 'dense', 'area'].forEach((pick) =>
      [true, false].forEach((remainder) => ['repeat', 'plain', 'solo', 'ffd'].forEach((mode) => push(dir, orient, pick, remainder, mode))))));
    return Object.freeze(out);
  })();

  /** need 마다 이 방향에서 놓을 수 있는 꼴 — a = 띠 폭 쪽 치수 · l = 띠 길이 쪽 치수. 원판에 안 들어가는 꼴은 뺀다. 넓은 것 → 긴 것 차례 */
  function optionsOf(work, dir, orient, CA, CL) {
    const out = [];
    work.forEach((n) => {
      const a0 = dir === 'V' ? n.w : n.h;
      const l0 = dir === 'V' ? n.h : n.w;
      const canRot = n.rotatable && n.w !== n.h;
      const add = (a, l, rot) => { if (a <= CA && l <= CL) out.push({ n, a, l, rot }); };
      if (orient !== 'rot' || !canRot) add(a0, l0, false);
      if (canRot && orient !== 'asis') add(l0, a0, true);
    });
    out.sort((x, y) => y.a - x.a || y.l - x.l || x.n.idx - y.n.idx || (x.rot ? 1 : 0) - (y.rot ? 1 : 0));
    return out;
  }

  /** 띠 하나를 채워 본다 (수량은 건드리지 않는다). 1차: 띠 폭과 같은 부재를 긴 것부터, 2차(remainder): 남는 길이에 더 좁은 부재 */
  function buildStrip(S, options, CL, kerf, remainder) {
    const pieces = [];
    const taken = new Map();
    let used = 0;
    let area = 0;
    const put = (o, fromRemainder) => {
      const avail = o.n.avail - (taken.get(o.n) || 0);
      if (avail <= 0) return;
      const gap = used > 0 ? kerf : 0;
      const space = CL - used - gap;
      if (o.l > space) return;
      const fit = Math.min(avail, Math.floor((space + kerf) / (o.l + kerf)));
      if (fit <= 0) return;
      pieces.push({ o, count: fit, fromRemainder });
      used += gap + (o.l + kerf) * fit - kerf;
      area += o.a * o.l * fit;
      taken.set(o.n, (taken.get(o.n) || 0) + fit);
    };
    options.forEach((o) => { if (o.a === S) put(o, false); });
    if (remainder && CL - used > SMALL_LIMIT) options.forEach((o) => { if (o.a < S) put(o, true); });
    return { S, pieces, used, area, taken };
  }

  /**
   * 띠 하나를 가장 넓게 채운다 (fill) — 길이 조합을 찾는다: 띠 폭과 같은 부재 + (remainder 면) 더 좁은 부재 가운데, 띠 길이에 들어가며 쓴 넓이가 가장 큰 수량 조합.
   *   띠 폭과 같은 부재가 하나는 있어야 한다. 좁은 부재는 buildStrip 과 같이 띠 길이 쪽으로 한 줄. 처음 보는 조합이 buildStrip 의 긴 것부터 채우기와 같다 — 한도에 걸려도 그보다 나빠지지 않는다.
   *   돌려주는 모양은 buildStrip 과 같다. 놓을 것이 없으면 null
   */
  function buildStripFill(S, options, CL, kerf, remainder) {
    const items = [];
    options.forEach((o) => { if (o.n.avail > 0 && (o.a === S || (remainder && o.a < S))) items.push(o); });
    const counts = new Array(items.length).fill(0);
    const takenN = new Map();
    const cap = CL + kerf;
    let best = null;
    let nodes = 0;
    const rec = (i, usedK, area, full) => {
      if (i === items.length || nodes >= FILL_STRIP_NODES) {
        if (full > 0 && (!best || area > best.area)) best = { area, counts: counts.slice(), usedK };
        return;
      }
      nodes += 1;
      const o = items[i];
      // 남은 길이를 지금 폭(남은 것 가운데 가장 넓다)으로 다 채워도 못 이기면 그만
      if (best && area + (cap - usedK) * o.a <= best.area) return;
      const avail = o.n.avail - (takenN.get(o.n) || 0);
      const max = Math.max(0, Math.min(avail, Math.floor((cap - usedK) / (o.l + kerf))));
      for (let c = max; c >= 0; c--) {
        counts[i] = c;
        if (c) takenN.set(o.n, (takenN.get(o.n) || 0) + c);
        rec(i + 1, usedK + c * (o.l + kerf), area + c * o.a * o.l, full + (o.a === S ? c : 0));
        if (c) takenN.set(o.n, takenN.get(o.n) - c);
      }
      counts[i] = 0;
    };
    rec(0, 0, 0, 0);
    if (!best) return null;
    const pieces = [];
    const taken = new Map();
    items.forEach((o, i) => {
      const c = best.counts[i];
      if (!c) return;
      pieces.push({ o, count: c, fromRemainder: o.a < S });
      taken.set(o.n, (taken.get(o.n) || 0) + c);
    });
    return { S, pieces, used: best.usedK - kerf, area: best.area, taken };
  }

  /** 다음 띠 — 남은 폭(availA)에 들어가는 띠 폭 후보를 채워 보고 고른다. 놓을 것이 없으면 null */
  function pickStrip(options, availA, CL, kerf, v) {
    const sizes = [];
    options.forEach((o) => { if (o.n.avail > 0 && o.a <= availA && sizes.indexOf(o.a) < 0) sizes.push(o.a); });
    let best = null;
    for (let i = 0; i < sizes.length; i++) {
      const st = buildStrip(sizes[i], options, CL, kerf, v.remainder);
      if (!st.pieces.length) continue;
      if (v.pick === 'widest') return st;
      if (!best) { best = st; continue; }
      // 나눗셈 없이 견준다 — dense: 쓴 넓이 ÷ 띠 폭, area: 쓴 넓이. 같으면 먼저 본(더 넓은) 띠
      const better = v.pick === 'dense'
        ? st.area * best.S > best.area * st.S || (st.area * best.S === best.area * st.S && st.area > best.area)
        : st.area > best.area;
      if (better) best = st;
    }
    return best;
  }

  /** 띠 묶음 → layoutGroup 과 같은 모양의 배치 (panelOf 가 받는다). 띠는 넓은 것부터 적는다 — 같은 배치는 같은 글(sig)이 된다 */
  function layoutOf(dir, stripsIn, remainA, CL) {
    const sigOf = (st) => `${st.S}[${st.pieces.map((p) => `${p.o.n.idx}x${p.count}${p.o.rot ? 'r' : ''}${p.fromRemainder ? '~' : ''}`).join(',')}]`;
    const list = stripsIn.map((st) => ({ st, sig: sigOf(st) }));
    list.sort((x, y) => y.st.S - x.st.S || y.st.used - x.st.used || compareStr(x.sig, y.sig));
    const pieceCounts = new Map();
    let usedArea = 0;
    let totalPieces = 0;
    let rotated = false;
    const strips = list.map(({ st }) => {
      const pieces = st.pieces.map((p) => {
        // w · h 는 원판 위 발자국 (layoutGroup 의 조각과 같다 — rot 이면 plan 이 BOM 치수로 되돌린다)
        const piece = dir === 'V'
          ? { idx: p.o.n.idx, w: p.o.a, h: p.o.l, count: p.count, rot: p.o.rot }
          : { idx: p.o.n.idx, w: p.o.l, h: p.o.a, count: p.count, rot: p.o.rot };
        if (p.fromRemainder) piece.fromRemainder = true;
        if (p.o.rot) rotated = true;
        pieceCounts.set(piece.idx, (pieceCounts.get(piece.idx) || 0) + p.count);
        totalPieces += p.count;
        return piece;
      });
      usedArea += st.area;
      return dir === 'V'
        ? { width: st.S, pieces, usedH: st.used, remainH: CL - st.used }
        : { height: st.S, pieces, usedW: st.used, remainW: CL - st.used };
    });
    const layout = { dir, rotated, strips, pieceCounts, usedArea, totalPieces, sig: `${dir}:${list.map((x) => x.sig).join('/')}` };
    if (dir === 'V') layout.remainW = remainA; else layout.remainH = remainA;
    return layout;
  }

  /** 원판 한 장 — 띠를 더 못 놓을 때까지. options 의 need.avail 을 줄인다. 놓은 것이 없으면 null */
  function designSheet(options, dir, CA, CL, kerf, v) {
    const strips = [];
    let availA = CA;
    while (availA > SMALL_LIMIT) {
      const st = pickStrip(options, availA, CL, kerf, v);
      if (!st) break;
      st.taken.forEach((c, n) => { n.avail -= c; });
      strips.push(st);
      availA -= st.S + kerf;
    }
    return strips.length ? layoutOf(dir, strips, availA, CL) : null;
  }

  /**
   * 원판 한 장을 가장 넓게 (fill) — 띠 폭 조합을 넓은 것부터 찾는다 (같은 조합을 두 번 보지 않게 폭이 줄어드는 차례로만).
   *   띠마다 buildStripFill. 더 놓을 띠가 없는 조합 가운데 쓴 넓이가 가장 큰 것. options 의 need.avail 을 줄인다 (designSheet 와 같다). 놓은 것이 없으면 null
   */
  function designSheetFill(options, dir, CA, CL, kerf, v) {
    const sizes = [];
    options.forEach((o) => { if (sizes.indexOf(o.a) < 0) sizes.push(o.a); });
    const cur = [];
    let best = null;
    let nodes = 0;
    const rec = (start, availA, area) => {
      let extended = false;
      if (availA > SMALL_LIMIT) {
        for (let i = start; i < sizes.length; i++) {
          const S = sizes[i];
          if (S > availA) continue;
          if (nodes >= FILL_SHEET_NODES) break;
          // 남은 폭을 다 써도 못 이기면 그만
          if (best && area + availA * CL <= best.area) break;
          if (!options.some((o) => o.a === S && o.n.avail > 0)) continue;
          nodes += 1;
          const st = buildStripFill(S, options, CL, kerf, v.remainder);
          if (!st) continue;
          st.taken.forEach((c, n) => { n.avail -= c; });
          cur.push(st);
          extended = true;
          rec(i, availA - S - kerf, area + st.area);
          cur.pop();
          st.taken.forEach((c, n) => { n.avail += c; });
        }
      }
      if (!extended && cur.length && (!best || area > best.area)) best = { area, strips: cur.slice(), remainA: availA };
    };
    rec(0, CA, 0);
    if (!best) return null;
    best.strips.forEach((st) => st.taken.forEach((c, n) => { n.avail -= c; }));
    return layoutOf(dir, best.strips, best.remainA, CL);
  }

  /** 배치가 같은 원판을 겹침으로 묶는다 (MAX_STACK 장씩) — 처음 나온 차례 */
  function stackPanels(layouts) {
    const order = [];
    const bySig = new Map();
    layouts.forEach((lay) => {
      let g = bySig.get(lay.sig);
      if (!g) { g = { layout: lay, n: 0 }; bySig.set(lay.sig, g); order.push(g); }
      g.n += 1;
    });
    const out = [];
    order.forEach((g) => {
      for (let left = g.n; left > 0; left -= MAX_STACK) out.push({ layout: g.layout, stack: Math.min(left, MAX_STACK) });
    });
    return out;
  }

  /** 묶음 하나를 한 가지 방식으로 끝까지 놓는다 → { panels, remains } (remains[i] = needs[i] 가운데 못 놓은 수) */
  function runVariant(needs, PW, PH, kerf, v) {
    const work = needs.map((n, i) => ({ idx: i, w: n.w, h: n.h, rotatable: n.rotatable, remain: n.remain, avail: 0 }));
    const longDir = PH >= PW ? 'V' : 'H';
    const shortDir = longDir === 'V' ? 'H' : 'V';
    const dirs = v.dir === 'long' ? [longDir] : v.dir === 'short' ? [shortDir] : [longDir, shortDir];
    const capOf = (d) => (d === 'V' ? { CA: PW, CL: PH } : { CA: PH, CL: PW });
    const optionsBy = {};
    dirs.forEach((d) => { const c = capOf(d); optionsBy[d] = optionsOf(work, d, v.orient, c.CA, c.CL); });
    /** 남은 부재로 원판 한 장 (only 를 주면 그 부재만). 방향이 둘이면 더 넓게 쓰는 쪽 — 같으면 긴 변 먼저 */
    const design = (only) => {
      let best = null;
      dirs.forEach((d) => {
        const c = capOf(d);
        work.forEach((n) => { n.avail = !only || only === n ? n.remain : 0; });
        const lay = (v.mode === 'fill' ? designSheetFill : designSheet)(optionsBy[d], d, c.CA, c.CL, kerf, v);
        if (lay && (!best || lay.usedArea > best.usedArea)) best = lay;
      });
      return best;
    };
    const take = (lay, stack) => { lay.pieceCounts.forEach((c, idx) => { work[idx].remain -= c * stack; }); };
    const panels = [];
    const push = (lay, stack) => { panels.push(panelOf(panels.length + 1, stack, lay)); };

    if (v.mode === 'ffd') {
      // 띠를 먼저 다 만들고 (원판 폭 전체를 쓸 수 있다고 보고) 넓은 띠부터 들어가는 첫 원판에 넣는다
      const d = dirs[0];
      const c = capOf(d);
      work.forEach((n) => { n.avail = n.remain; });
      const all = [];
      for (;;) {
        const st = pickStrip(optionsBy[d], c.CA, c.CL, kerf, v);
        if (!st) break;
        st.taken.forEach((cnt, n) => { n.avail -= cnt; n.remain -= cnt; });
        all.push(st);
      }
      const bins = [];
      all.map((st, i) => ({ st, i })).sort((x, y) => y.st.S - x.st.S || x.i - y.i).forEach(({ st }) => {
        let bin = null;
        for (let i = 0; i < bins.length && !bin; i++) if (bins[i].used + kerf + st.S <= c.CA) bin = bins[i];
        if (!bin) { bin = { strips: [], used: -kerf }; bins.push(bin); }
        bin.used += kerf + st.S;
        bin.strips.push(st);
      });
      // 남는 폭은 designSheet 와 같은 셈 — 마지막 띠 뒤 톱날까지 뺀다
      stackPanels(bins.map((b) => layoutOf(d, b.strips, c.CA - b.used - kerf, c.CL))).forEach((p) => push(p.layout, p.stack));
      return { panels, remains: work.map((n) => n.remain) };
    }

    if (v.mode === 'solo') {
      // 같은 부재만으로 원판을 채울 수 있으면(2장 이상) 먼저 겹쳐서 뺀다 — layoutGroup 의 앞 단계와 같다
      work.slice().sort((a, b) => b.remain - a.remain || b.w * b.h - a.w * a.h || a.idx - b.idx).forEach((n) => {
        if (n.remain < 2) return;
        const solo = design(n);
        if (!solo) return;
        const full = Math.floor(n.remain / solo.totalPieces);
        if (full < 2) return;
        const stack = Math.min(full, MAX_STACK);
        take(solo, stack);
        push(solo, stack);
      });
    }
    if (v.mode === 'plain') {
      const singles = [];
      for (;;) {
        const lay = design(null);
        if (!lay) break;
        take(lay, 1);
        singles.push(lay);
      }
      stackPanels(singles).forEach((p) => push(p.layout, p.stack));
    } else {
      for (;;) {
        const lay = design(null);
        if (!lay) break;
        let stack = MAX_STACK;
        lay.pieceCounts.forEach((c, idx) => { stack = Math.min(stack, Math.floor(work[idx].remain / c)); });
        stack = Math.max(1, stack);
        take(lay, stack);
        push(lay, stack);
      }
    }
    return { panels, remains: work.map((n) => n.remain) };
  }

  /**
   * 배치 하나를 자르는 횟수 (2026-11-17 사장님 「겹쳐 자르면 한 번, 여백 재단은 빼고」) —
   *   띠 수 + 띠마다 (조각 수 − 1) + 더 좁은 부재를 한 번 더 켜는 수 (띠마다 좁은 폭 하나에 한 번).
   *   앞 두 항은 앱 CNC 탭 셈(ai-design-report.js sheetCutCount)과 같다. 겹친 원판은 배치 하나로 한 번, 가장자리 여백 재단은 세지 않는다.
   */
  function layoutCuts(panel) {
    let cuts = panel.strips.length;
    panel.strips.forEach((s) => {
      let n = 0;
      const narrow = new Set();
      s.pieces.forEach((p) => {
        n += p.count;
        if (p.fromRemainder) narrow.add(panel.dir === 'V' ? p.w : p.h);
      });
      cuts += Math.max(0, n - 1) + narrow.size;
    });
    return cuts;
  }

  /**
   * 「앞 장부터 꽉」 (2026-11-19 사장님) — 원판마다 놓인 넓이를 큰 것부터 세워, 앞에서 k 장까지 쓴 넓이를 k = 1..n 에 대해 모두 더한 값. 클수록 앞 장이 꽉 차 있다.
   *   같은 묶음 · 같은 장수면 「남는 넓이 × 꽉 찬 차례 번호」의 합이 작은 것과 같다 — 남는 넓이가 뒤 장에 몰릴수록 크다.
   *   넓이는 정수(mm²)로 맞춰 더한다 (소수 치수의 더하는 차례로 같은 배치가 갈리지 않게). 겹친 배치는 장수만큼 센다. 한 장이면 늘 같은 값이다.
   */
  function frontOf(panels) {
    const used = [];
    panels.forEach((p) => {
      const a = Math.round(p.usedArea);
      for (let i = 0; i < p.stack; i++) used.push(a);
    });
    used.sort((x, y) => y - x);
    let acc = 0;
    let total = 0;
    for (let i = 0; i < used.length; i++) { acc += used[i]; total += acc; }
    return total;
  }

  /** 후보 하나의 점수 — 못 놓은 수 · 원판 수 · 앞 장부터 꽉(front) · 자르는 횟수 · 다시 쓸 수 있는 자투리 넓이 · 가장 큰 자투리 */
  function scoreOf(panels, remains, PW, PH) {
    let sheets = 0;
    let cuts = 0;
    let reuse = 0;
    let largest = 0;
    panels.forEach((p) => {
      sheets += p.stack;
      cuts += layoutCuts(p);
      const CL = p.dir === 'V' ? PH : PW;
      const rects = p.strips.map((s) => (p.dir === 'V' ? [s.width, s.remainH] : [s.height, s.remainW]));
      rects.push([p.panelRemain, CL]);
      rects.forEach((r) => {
        if (r[0] <= 0 || r[1] <= 0) return;
        const area = r[0] * r[1];
        if (area > largest) largest = area;
        if (Math.max(r[0], r[1]) >= REUSE_LONG && Math.min(r[0], r[1]) >= REUSE_SHORT) reuse += area * p.stack;
      });
    });
    return { unplaced: remains.reduce((s, r) => s + r, 0), sheets, front: frontOf(panels), cuts, reuse, largest };
  }

  /** 묶음 하나의 후보 모음 — 0번은 지금 방식(layoutGroup) 그대로, 그 뒤 VARIANTS 를 한도까지 */
  function candidatePool(needs, PW, PH, kerf, smalls, budget) {
    const longDir = PH >= PW ? 'V' : 'H';
    const pieces = needs.reduce((s, n) => s + n.remain, 0);
    const auto = Math.max(VARIANT_MIN, Math.floor(SEARCH_WORK / Math.max(1, needs.length * pieces)));
    const limit = Math.min(VARIANTS.length, Number.isFinite(budget) && budget >= 1 ? Math.floor(budget) : auto);
    const candidate = (index, longFirst, panels, order, remains) => ({ index, longFirst, panels, order, remains, score: scoreOf(panels, remains, PW, PH) });
    const pool = [];
    // 지금 방식 — 부재 최적화 · 최소 재단이 지금보다 나빠지지 않게. 모든 원판이 긴 변 먼저면 표준 후보이기도 하다.
    //   layoutGroup 은 needs 를 복사해 차례를 바꾼다 — src 로 원래 자리를 잇는다 (order[조각 idx] = needs 의 자리)
    const legacy = layoutGroup(needs.map((n, i) => ({ w: n.w, h: n.h, rotatable: n.rotatable, remain: n.remain, src: i })), PW, PH, kerf, smalls);
    pool.push(candidate(-1, legacy.panels.every((p) => p.dir === longDir), legacy.panels, legacy.needs.map((c) => c.src), legacy.needs.map((c) => c.remain)));
    const same = needs.map((n, i) => i);
    for (let i = 0; i < limit; i++) {
      const r = runVariant(needs, PW, PH, kerf, VARIANTS[i]);
      pool.push(candidate(i, VARIANTS[i].dir === 'long', r.panels, same, r.remains));
    }
    return pool;
  }

  // 기본 조건 「앞 장부터 꽉」(front)은 원판 수 바로 다음이다 — 원판 수가 같으면 앞 장을 꽉 채운 후보 (2026-11-19 사장님)
  const byStandard = (a, b) => a.score.unplaced - b.score.unplaced || a.score.sheets - b.score.sheets || b.score.front - a.score.front || a.score.cuts - b.score.cuts || b.score.reuse - a.score.reuse || a.index - b.index;
  const byMaterial = (a, b) => a.score.unplaced - b.score.unplaced || a.score.sheets - b.score.sheets || b.score.front - a.score.front || b.score.reuse - a.score.reuse || b.score.largest - a.score.largest || a.score.cuts - b.score.cuts || a.index - b.index;
  const byCuts = (a, b) => a.score.cuts - b.score.cuts || a.score.sheets - b.score.sheets || b.score.front - a.score.front || b.score.reuse - a.score.reuse || a.index - b.index;

  /**
   * 묶음 하나를 재단 방식대로 — layoutGroup 과 같은 모양 { panels, needs, unallocated } + 표준 결과 · 본 후보 수.
   *   standard  긴 변 먼저인 후보 가운데: 못 놓은 수 → 원판 수 → 앞 장부터 꽉 → 자르는 횟수 → 다시 쓸 자투리
   *   material  모든 후보 가운데: 못 놓은 수 → 원판 수 → 앞 장부터 꽉 → 다시 쓸 자투리 넓이 → 가장 큰 자투리 → 자르는 횟수
   *   cuts      원판 수가 표준 + CUTS_EXTRA_SHEETS 안인 후보 가운데: 자르는 횟수 → 원판 수 → 앞 장부터 꽉 → 다시 쓸 자투리
   *   표준으로 고른 후보는 다른 두 모음에도 들어 있다 — 그래서 묶음마다 부재 최적화 원판 ≤ 표준, 최소 재단 횟수 ≤ 표준 이다.
   *   고른 후보의 원판은 꽉 찬 것부터 낸다 (겹친 원판은 붙어 있다) — 원판 번호 · 배치 번호가 그 차례다.
   */
  function solveGroup(needs, PW, PH, kerf, smalls, strategy, budget, cache, cacheKey) {
    let pool = cache ? cache.get(cacheKey) : null;
    if (!pool) {
      pool = candidatePool(needs, PW, PH, kerf, smalls, budget);
      if (cache) cache.set(cacheKey, pool);
    }
    const standard = pool.filter((c) => c.longFirst).sort(byStandard)[0];
    let chosen = standard;
    if (strategy === 'material') {
      chosen = pool.slice().sort(byMaterial)[0];
    } else if (strategy === 'cuts') {
      const least = pool.reduce((m, c) => Math.min(m, c.score.unplaced), Infinity);
      chosen = pool.filter((c) => c.score.unplaced === least && c.score.sheets <= standard.score.sheets + CUTS_EXTRA_SHEETS).sort(byCuts)[0] || standard;
    }
    const solved = chosen.order.map((i) => needs[i]);
    const unallocated = [];
    chosen.remains.forEach((r, k) => { if (r > 0) unallocated.push(Object.assign({}, solved[k], { remain: r })); });
    // 꽉 찬 원판부터 — 후보의 원판은 세 방식이 같이 쓰므로(cache) 건드리지 않고 사본에 번호를 다시 매긴다
    const panels = chosen.panels
      .map((p, i) => ({ p, i }))
      .sort((x, y) => Math.round(y.p.usedArea) - Math.round(x.p.usedArea) || x.i - y.i)
      .map((x, i) => Object.assign({}, x.p, { id: i + 1 }));
    return {
      panels,
      needs: solved,
      unallocated,
      standard: { sheetCount: standard.score.sheets, cutCount: standard.score.cuts },
      searched: pool.length,
    };
  }

  // ── 자재 행 → cutPlan ──────────────────────────────────────────────

  function compareStr(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /**
   * 자재 행 목록을 원판 배치로.
   *
   * @param {Array} materials  bom.materials 행 (`{partId, part, material, thickness, w, h, qty, edge, itemLabel, grain?}`)
   * @param {Object} [opts]
   *   sheetSize   {w,h}            기본 원판 (전역 SHEET_W/H → 1220×2440)
   *   sheetSizes  {'PB_15':{w,h}}  자재(_두께)별 원판 크기
   *   kerf        number           톱날 (전역 CUT_KERF → 4)
   *   trim        number           가장자리 트림, 네 변 각각 (기본 10)
   *   noRotateMaterials [RegExp|string]  회전 금지 자재 (기본 무늬목·우드·결 PET)
   *   partClass   fn(partName, thickness)  원판 그룹을 가르는 부재 구분 (기본 partClassOf)
   *   strategy    'standard' | 'material' | 'cuts'  재단 방식 (STRATEGIES). 없으면 지금 방식 그대로 — 결과가 바뀌지 않는다
   *   colorOf     fn(row) → 색 이름  색이 다른 판을 한 원판에 섞지 않는다 (묶음 키에 색). 없으면 색을 보지 않는다
   *   searchBudget number          묶음마다 만들어 볼 후보 수 (strategy 가 있을 때만 — 기본은 묶음 크기에 따라 14 ~ 전부)
   * @returns cutPlan — bom-protocol.md §7-3. 석재 상판(isOutsourcedTop)은 배치하지 않고 skipped 로 돌려준다
   */
  function plan(materials, opts) {
    return planWith(materials, opts, null);
  }

  /** plan 본체 — cache 는 compare 가 세 방식에 같이 쓰는 후보 모음 (묶음 키 → 후보) */
  function planWith(materials, opts, cache) {
    opts = opts || {};
    const g = globalDefaults();
    const dfltSheet = opts.sheetSize ? { w: num(opts.sheetSize.w) || g.w, h: num(opts.sheetSize.h) || g.h } : { w: g.w, h: g.h };
    const kerf = Number.isFinite(opts.kerf) ? opts.kerf : g.kerf;
    const trim = Number.isFinite(opts.trim) ? Math.max(0, opts.trim) : DEFAULT_TRIM;
    const noRotate = Array.isArray(opts.noRotateMaterials) ? opts.noRotateMaterials : NO_ROTATE_MATERIALS;
    const classOf = typeof opts.partClass === 'function' ? opts.partClass : partClassOf;
    const strategy = opts.strategy == null || opts.strategy === '' ? null : String(opts.strategy);
    if (strategy && !STRATEGIES.some((s) => s.id === strategy)) throw new RangeError(`알 수 없는 재단 방식: ${strategy}`);
    const colorOf = typeof opts.colorOf === 'function' ? opts.colorOf : null;
    const colorText = (m) => { const c = colorOf(m); return c == null ? '' : String(c).trim(); };

    // 1. 행 정규화 + 정렬 (결정성의 뿌리: 입력 순서에 의존하지 않는다)
    const rows = [];
    const skipped = [];
    (Array.isArray(materials) ? materials : []).forEach((m, i) => {
      if (!m || typeof m !== 'object') return;
      const w = num(m.w), h = num(m.h), qty = Math.round(num(m.qty));
      if (w <= 0 || h <= 0 || qty <= 0) return;
      const partId = m.partId != null && m.partId !== '' ? String(m.partId) : `row-${i}`;
      if (isOutsourcedTop(m)) {
        skipped.push({ partId, part: String(m.part || ''), material: String(m.material || ''), thickness: num(m.thickness), w, h, qty, reason: 'outsourced-top' });
        return;
      }
      const rotatable = rotatableOf(m, noRotate);
      const row = {
        partId,
        part: String(m.part || ''),
        material: String(m.material || ''),
        thickness: num(m.thickness),
        partClass: classOf(m.part, num(m.thickness)),
        w, h, qty,
        edge: typeof m.edge === 'string' ? m.edge : '',
        itemLabel: typeof m.itemLabel === 'string' ? m.itemLabel : '',
        rotatable,
        grain: grainOf(m, rotatable),
      };
      if (colorOf) row.color = colorText(m);
      rows.push(row);
    });
    rows.sort((a, b) =>
      compareStr(a.material, b.material) || a.thickness - b.thickness || compareStr(a.partClass, b.partClass) ||
      (colorOf ? compareStr(a.color, b.color) : 0) ||
      b.h - a.h || b.w - a.w || compareStr(a.partId, b.partId));

    // 2. 소부품 분리 (≤70) — 원판 배치 대상이 아니다
    const smallParts = [];
    const bigRows = [];
    rows.forEach((r) => {
      if (r.w <= SMALL_LIMIT || r.h <= SMALL_LIMIT) {
        const small = { partId: r.partId, part: r.part, material: r.material, thickness: r.thickness, partClass: r.partClass, w: r.w, h: r.h, qty: r.qty, itemLabel: r.itemLabel };
        if (colorOf) small.color = r.color;
        smallParts.push(small);
      } else {
        bigRows.push(r);
      }
    });

    // 3. 그룹(자재|두께|부재 구분 — colorOf 가 있으면 |색) — 정렬돼 있으므로 등장 순서가 곧 결정적 순서
    const groupMap = new Map();
    const groupKeyOf = (r) => (colorOf ? `${r.material}|${r.thickness}|${r.partClass}|${r.color}` : `${r.material}|${r.thickness}|${r.partClass}`);
    bigRows.forEach((r) => {
      const key = groupKeyOf(r);
      if (!groupMap.has(key)) {
        const grp = { key, material: r.material, thickness: r.thickness, partClass: r.partClass, rows: [] };
        if (colorOf) grp.color = r.color;
        groupMap.set(key, grp);
      }
      groupMap.get(key).rows.push(r);
    });
    const smallByGroup = new Map();
    smallParts.forEach((s) => {
      const key = groupKeyOf(s);
      if (!smallByGroup.has(key)) smallByGroup.set(key, []);
      const list = smallByGroup.get(key);
      const ex = list.find((x) => x.part === s.part && x.w === s.w && x.h === s.h);
      if (ex) ex.qty += s.qty; else list.push({ part: s.part, w: s.w, h: s.h, qty: s.qty });
    });

    const sheets = [];
    const offcuts = [];
    const groups = [];
    const unallocated = [];
    const sheetsByMaterial = {};
    let sheetNo = 0;
    let sheetAreaSum = 0;
    let usedAreaSum = 0;
    let partsTotal = 0;
    let partsPlaced = 0;
    let cutSum = 0;
    let layoutSum = 0;
    let unusedSum = 0;
    // 색으로 나뉜 묶음이 자재 · 두께 · 구분이 같으면 배치 번호(layout.no)를 이어 매긴다 — 겹침을 그 셋 + 번호로 묶는 곳이 색을 섞지 않게
    const layoutBase = new Map();
    const colorSheets = new Map();

    groupMap.forEach((grp) => {
      const size = sheetSizeFor(grp.material, grp.thickness, opts, dfltSheet);
      const PW = size.w - trim * 2;
      const PH = size.h - trim * 2;

      // 같은 치수(+회전 가능)끼리 need 로 묶는다. 행은 이미 정렬돼 있다.
      const needMap = new Map();
      grp.rows.forEach((r) => {
        const key = `${r.w}|${r.h}|${r.rotatable ? 'r' : 'f'}`;
        if (!needMap.has(key)) needMap.set(key, { w: r.w, h: r.h, rotatable: r.rotatable, remain: 0, members: [] });
        const n = needMap.get(key);
        n.remain += r.qty;
        n.members.push(r);
      });
      const needs = [...needMap.values()];
      needs.forEach((n) => {
        // 낱개 큐 — partId#k. 시트 순서대로 앞에서 꺼내 쓴다.
        n.queue = [];
        n.members.forEach((r) => {
          for (let k = 0; k < r.qty; k++) n.queue.push({ partId: `${r.partId}#${k}`, part: r.part, edge: r.edge, itemLabel: r.itemLabel, grain: r.grain });
        });
        partsTotal += n.remain;
      });

      const groupNeeded = needs.reduce((s, n) => s + n.remain, 0);
      const smalls = smallByGroup.get(grp.key) || [];
      const result = strategy
        ? solveGroup(needs, PW, PH, kerf, smalls, strategy, opts.searchBudget, cache, `${grp.key}#${PW}x${PH}#${kerf}`)
        : layoutGroup(needs, PW, PH, kerf, smalls);
      const { panels, needs: solved, unallocated: left } = result;
      // layoutGroup 은 needs 를 복사·재정렬한다 — 큐는 원본 need 객체가 가지고 있으므로 idx→원본을 잇는다
      const queueOf = (idx) => solved[idx].queue;
      const tripleKey = `${grp.material}|${grp.thickness}|${grp.partClass}`;
      const noBase = colorOf ? layoutBase.get(tripleKey) || 0 : 0;
      if (colorOf) layoutBase.set(tripleKey, noBase + panels.length);
      let groupCuts = 0;
      let groupUnused = 0;

      let groupPlaced = 0;
      const firstSheetNo = sheetNo + 1;
      panels.forEach((panel) => {
        const panelCuts = strategy ? layoutCuts(panel) : 0;
        groupCuts += panelCuts;
        for (let s = 0; s < panel.stack; s++) {
          sheetNo += 1;
          const parts = [];
          const stripsOut = [];
          let cursor = 0; // 스트립 누적 위치 (H: y, V: x)
          let usedArea = 0;

          panel.strips.forEach((strip, si) => {
            const stripSize = panel.dir === 'H' ? strip.height : strip.width;
            const stripUsed = panel.dir === 'H' ? strip.usedW : strip.usedH;
            const stripRemain = panel.dir === 'H' ? strip.remainW : strip.remainH;
            stripsOut.push({ no: si + 1, offset: trim + cursor, size: stripSize, used: stripUsed, remain: stripRemain });

            let along = 0; // 스트립 안 누적 위치 (H: x, V: y)
            strip.pieces.forEach((p) => {
              for (let c = 0; c < p.count; c++) {
                const inst = queueOf(p.idx).shift();
                if (!inst) continue; // 큐가 비면(있을 수 없음) 건너뛴다 — 수량 보존 시험이 잡는다
                const x = trim + (panel.dir === 'H' ? along : cursor);
                const y = trim + (panel.dir === 'H' ? cursor : along);
                const rot = Boolean(p.rot);
                // w/h 는 부재 자체 치수(BOM 행 그대로). rot 이면 원판 위 발자국은 h×w.
                const w = rot ? p.h : p.w;
                const h = rot ? p.w : p.h;
                const part = { partId: inst.partId, part: inst.part, w, h, x, y, rot, grain: inst.grain, strip: si + 1 };
                if (inst.edge) part.edge = inst.edge;
                if (inst.itemLabel) part.itemLabel = inst.itemLabel;
                if (p.fromRemainder) part.fromRemainder = true;
                parts.push(part);
                usedArea += w * h;
                along += (panel.dir === 'H' ? p.w : p.h) + kerf;
              }
            });

            // 스트립 잔여 (자투리 60~70 · 잔재 >70). 60 미만은 톱밥 취급 — 옛 CNC 탭과 같다.
            if (stripRemain >= THIN_MIN) {
              offcuts.push(panel.dir === 'H'
                ? { sheetNo, kind: 'strip', x: trim + stripUsed, y: trim + cursor, w: stripRemain, h: stripSize, free: stripRemain }
                : { sheetNo, kind: 'strip', x: trim + cursor, y: trim + stripUsed, w: stripSize, h: stripRemain, free: stripRemain });
            }
            cursor += stripSize + kerf;
          });

          if (panel.panelRemain >= THIN_MIN) {
            offcuts.push(panel.dir === 'H'
              ? { sheetNo, kind: 'sheet', x: trim, y: trim + cursor, w: PW, h: panel.panelRemain, free: panel.panelRemain }
              : { sheetNo, kind: 'sheet', x: trim + cursor, y: trim, w: panel.panelRemain, h: PH, free: panel.panelRemain });
          }

          const sheetArea = size.w * size.h;
          sheetAreaSum += sheetArea;
          usedAreaSum += usedArea;
          groupPlaced += parts.length;
          const sheet = {
            no: sheetNo,
            material: grp.material,
            thickness: grp.thickness,
            partClass: grp.partClass,
            size: { w: size.w, h: size.h },
            trim,
            layout: { no: noBase + panel.id, stack: panel.stack, index: s + 1, dir: panel.dir, rotated: panel.rotated },
            strips: stripsOut,
            parts,
            usedArea,
            yield: round4(usedArea / sheetArea),
          };
          if (colorOf) sheet.color = grp.color;
          if (strategy) {
            sheet.cuts = panelCuts;   // 이 원판 배치를 자르는 횟수 — 겹친 원판은 같은 값 (한 번에 자른다)
            sheet.unusedArea = Math.round(sheetArea - usedArea);   // 이 원판에서 부재가 놓이지 않은 넓이 (mm² — 가장자리 여백 · 톱날 몫까지, 수율의 나머지)
            groupUnused += sheet.unusedArea;
          }
          sheets.push(sheet);
        }
      });

      left.forEach((n) => {
        const un = {
          material: grp.material, thickness: grp.thickness, partClass: grp.partClass,
          w: n.w, h: n.h, qty: n.remain,
          parts: n.queue.map((q) => q.part).filter((v, i, a) => a.indexOf(v) === i),
          partIds: n.queue.map((q) => q.partId),
        };
        if (colorOf) un.color = grp.color;
        unallocated.push(un);
      });

      partsPlaced += groupPlaced;
      const matKey = `${grp.material}_${grp.thickness}`;
      const groupSheets = sheetNo - firstSheetNo + 1;
      sheetsByMaterial[matKey] = (sheetsByMaterial[matKey] || 0) + groupSheets;
      const group = {
        key: grp.key,
        material: grp.material,
        thickness: grp.thickness,
        partClass: grp.partClass,
        sheetSize: { w: size.w, h: size.h },
        sheetCount: groupSheets,
        firstSheetNo: groupSheets > 0 ? firstSheetNo : null,
        needed: groupNeeded,
        placed: groupPlaced,
      };
      if (colorOf) {
        group.color = grp.color;
        const ck = `${grp.material}|${grp.thickness}|${grp.color}`;
        if (!colorSheets.has(ck)) colorSheets.set(ck, { material: grp.material, thickness: grp.thickness, color: grp.color, sheetCount: 0 });
        colorSheets.get(ck).sheetCount += groupSheets;
      }
      if (strategy) {
        group.cutCount = groupCuts;
        group.layoutCount = panels.length;
        group.standard = result.standard;   // 이 묶음을 표준으로 놓았을 때의 원판 수 · 자르는 횟수
        group.searched = result.searched;   // 만들어 본 후보 수
        group.unusedArea = groupUnused;      // 이 묶음 원판들의 unusedArea 합
        cutSum += groupCuts;
        layoutSum += panels.length;
        unusedSum += groupUnused;
      }
      groups.push(group);
    });

    const out = {
      version: 1,
      sheetSize: dfltSheet,
      kerf,
      trim,
      sheets,
      offcuts,
      groups,
      smallParts,
      unallocated,
      skipped,
      summary: {
        sheetsByMaterial,
        sheetCount: sheets.length,
        totalYield: sheetAreaSum > 0 ? round4(usedAreaSum / sheetAreaSum) : 0,
        partsTotal,
        partsPlaced,
        smallCount: smallParts.reduce((s, p) => s + p.qty, 0),
        unallocatedCount: unallocated.reduce((s, u) => s + u.qty, 0),
        skippedCount: skipped.reduce((s, p) => s + p.qty, 0),
      },
    };
    // 재단 방식 · 색 — 옵션을 줬을 때만 붙는다 (없으면 위 모양 그대로). summary.sheetsByMaterial 키(`자재_두께`)는 색이 있어도 그대로다 — 재고 · 견적이 그 키로 읽는다
    if (colorOf) out.summary.sheetsByColor = [...colorSheets.values()];
    if (strategy) {
      out.strategy = strategy;
      out.summary.strategy = strategy;
      out.summary.cutCount = cutSum;       // 겹친 원판은 배치 하나로 한 번
      out.summary.layoutCount = layoutSum;
      out.summary.unusedArea = unusedSum;
    }
    return out;
  }

  /**
   * 낸 원판 한 장을 자르는 횟수 — layoutCuts 와 같은 셈을 출력(strips · parts)에서 다시 센다. 재단 방식 없이 낸 원판에도 쓸 수 있다.
   */
  function cutCount(sheet) {
    if (!sheet || !Array.isArray(sheet.strips) || !Array.isArray(sheet.parts)) return 0;
    const dir = sheet.layout && sheet.layout.dir;
    let cuts = sheet.strips.length;
    sheet.strips.forEach((st) => {
      let n = 0;
      const narrow = new Set();
      sheet.parts.forEach((p) => {
        if (p.strip !== st.no) return;
        n += 1;
        if (p.fromRemainder) narrow.add(dir === 'V' ? (p.rot ? p.h : p.w) : (p.rot ? p.w : p.h));
      });
      cuts += Math.max(0, n - 1) + narrow.size;
    });
    return cuts;
  }

  /**
   * 세 재단 방식을 한 번에 — 후보 모음을 같이 써서 plan 을 세 번 부르는 것보다 빠르고, 결과는 그 세 번과 같다.
   * @returns {{plans:{standard:object, material:object, cuts:object}, rows:{strategy:string, label:string, sheetCount:number, cutCount:number, totalYield:number, unallocatedCount:number, sheetsByColor?:object[]}[]}}
   */
  function compare(materials, opts) {
    const cache = new Map();
    const plans = {};
    const rows = STRATEGIES.map((s) => {
      const p = planWith(materials, Object.assign({}, opts, { strategy: s.id }), cache);
      plans[s.id] = p;
      const row = { strategy: s.id, label: s.label, sheetCount: p.summary.sheetCount, cutCount: p.summary.cutCount, totalYield: p.summary.totalYield, unallocatedCount: p.summary.unallocatedCount };
      if (p.summary.sheetsByColor) row.sheetsByColor = p.summary.sheetsByColor;
      return row;
    });
    return { plans, rows };
  }

  /** `partId#k` → 자재 행 partId (마지막 `#` 뒤가 숫자일 때만 떼어 낸다). */
  function basePartId(instanceId) {
    const s = String(instanceId || '');
    const i = s.lastIndexOf('#');
    if (i < 0) return s;
    return /^\d+$/.test(s.slice(i + 1)) ? s.slice(0, i) : s;
  }

  const NestingEngine = {
    plan,
    compare,
    cutCount,
    STRATEGIES,
    partClassOf,
    isOutsourcedTop,
    basePartId,
    rotatableOf: (m, list) => rotatableOf(m || {}, list || NO_ROTATE_MATERIALS),
    DEFAULTS: Object.freeze({
      SHEET_W: DEFAULT_SHEET_W, SHEET_H: DEFAULT_SHEET_H, KERF: DEFAULT_KERF, TRIM: DEFAULT_TRIM,
      SMALL_LIMIT, MAX_STACK, THIN_MIN, THIN_MAX, THIN_BACK_LIMIT,
    }),
    NO_ROTATE_MATERIALS: NO_ROTATE_MATERIALS.slice(),
    OUTSOURCED_TOP_MATERIALS: OUTSOURCED_TOP_MATERIALS.slice(),
  };

  if (typeof window !== 'undefined') window.NestingEngine = NestingEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = NestingEngine;
})();
