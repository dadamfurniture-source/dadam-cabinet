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

  /** 원판을 나누는 부재 구분 — ai-design-report.js getPartType 과 같은 규칙 (본체/도어/뒷판 원판 분리). */
  function partClassOf(partName) {
    const s = String(partName || '');
    if (/도어/.test(s)) return '도어';
    if (/뒷판|서랍밑판/.test(s)) return '뒷판';
    if (/몰딩|걸레받이|목찬넬|마감/.test(s)) return '도어';
    return '본체';
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
   *   partClass   fn(partName)     원판 그룹을 가르는 부재 구분 (기본 partClassOf)
   * @returns cutPlan — bom-protocol.md §7-3
   */
  function plan(materials, opts) {
    opts = opts || {};
    const g = globalDefaults();
    const dfltSheet = opts.sheetSize ? { w: num(opts.sheetSize.w) || g.w, h: num(opts.sheetSize.h) || g.h } : { w: g.w, h: g.h };
    const kerf = Number.isFinite(opts.kerf) ? opts.kerf : g.kerf;
    const trim = Number.isFinite(opts.trim) ? Math.max(0, opts.trim) : DEFAULT_TRIM;
    const noRotate = Array.isArray(opts.noRotateMaterials) ? opts.noRotateMaterials : NO_ROTATE_MATERIALS;
    const classOf = typeof opts.partClass === 'function' ? opts.partClass : partClassOf;

    // 1. 행 정규화 + 정렬 (결정성의 뿌리: 입력 순서에 의존하지 않는다)
    const rows = [];
    (Array.isArray(materials) ? materials : []).forEach((m, i) => {
      if (!m || typeof m !== 'object') return;
      const w = num(m.w), h = num(m.h), qty = Math.round(num(m.qty));
      if (w <= 0 || h <= 0 || qty <= 0) return;
      const rotatable = rotatableOf(m, noRotate);
      rows.push({
        partId: m.partId != null && m.partId !== '' ? String(m.partId) : `row-${i}`,
        part: String(m.part || ''),
        material: String(m.material || ''),
        thickness: num(m.thickness),
        partClass: classOf(m.part),
        w, h, qty,
        edge: typeof m.edge === 'string' ? m.edge : '',
        itemLabel: typeof m.itemLabel === 'string' ? m.itemLabel : '',
        rotatable,
        grain: grainOf(m, rotatable),
      });
    });
    rows.sort((a, b) =>
      compareStr(a.material, b.material) || a.thickness - b.thickness || compareStr(a.partClass, b.partClass) ||
      b.h - a.h || b.w - a.w || compareStr(a.partId, b.partId));

    // 2. 소부품 분리 (≤70) — 원판 배치 대상이 아니다
    const smallParts = [];
    const bigRows = [];
    rows.forEach((r) => {
      if (r.w <= SMALL_LIMIT || r.h <= SMALL_LIMIT) {
        smallParts.push({ partId: r.partId, part: r.part, material: r.material, thickness: r.thickness, partClass: r.partClass, w: r.w, h: r.h, qty: r.qty, itemLabel: r.itemLabel });
      } else {
        bigRows.push(r);
      }
    });

    // 3. 그룹(자재|두께|부재 구분) — 정렬돼 있으므로 등장 순서가 곧 결정적 순서
    const groupMap = new Map();
    const groupKeyOf = (r) => `${r.material}|${r.thickness}|${r.partClass}`;
    bigRows.forEach((r) => {
      const key = groupKeyOf(r);
      if (!groupMap.has(key)) groupMap.set(key, { key, material: r.material, thickness: r.thickness, partClass: r.partClass, rows: [] });
      groupMap.get(key).rows.push(r);
    });
    const smallByGroup = new Map();
    smallParts.forEach((s) => {
      const key = `${s.material}|${s.thickness}|${s.partClass}`;
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
      const { panels, needs: solved, unallocated: left } = layoutGroup(needs, PW, PH, kerf, smallByGroup.get(grp.key) || []);
      // layoutGroup 은 needs 를 복사·재정렬한다 — 큐는 원본 need 객체가 가지고 있으므로 idx→원본을 잇는다
      const queueOf = (idx) => solved[idx].queue;

      let groupPlaced = 0;
      const firstSheetNo = sheetNo + 1;
      panels.forEach((panel) => {
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
          sheets.push({
            no: sheetNo,
            material: grp.material,
            thickness: grp.thickness,
            partClass: grp.partClass,
            size: { w: size.w, h: size.h },
            trim,
            layout: { no: panel.id, stack: panel.stack, index: s + 1, dir: panel.dir, rotated: panel.rotated },
            strips: stripsOut,
            parts,
            usedArea,
            yield: round4(usedArea / sheetArea),
          });
        }
      });

      left.forEach((n) => {
        unallocated.push({
          material: grp.material, thickness: grp.thickness, partClass: grp.partClass,
          w: n.w, h: n.h, qty: n.remain,
          parts: n.queue.map((q) => q.part).filter((v, i, a) => a.indexOf(v) === i),
          partIds: n.queue.map((q) => q.partId),
        });
      });

      partsPlaced += groupPlaced;
      const matKey = `${grp.material}_${grp.thickness}`;
      const groupSheets = sheetNo - firstSheetNo + 1;
      sheetsByMaterial[matKey] = (sheetsByMaterial[matKey] || 0) + groupSheets;
      groups.push({
        key: grp.key,
        material: grp.material,
        thickness: grp.thickness,
        partClass: grp.partClass,
        sheetSize: { w: size.w, h: size.h },
        sheetCount: groupSheets,
        firstSheetNo: groupSheets > 0 ? firstSheetNo : null,
        needed: groupNeeded,
        placed: groupPlaced,
      });
    });

    return {
      version: 1,
      sheetSize: dfltSheet,
      kerf,
      trim,
      sheets,
      offcuts,
      groups,
      smallParts,
      unallocated,
      summary: {
        sheetsByMaterial,
        sheetCount: sheets.length,
        totalYield: sheetAreaSum > 0 ? round4(usedAreaSum / sheetAreaSum) : 0,
        partsTotal,
        partsPlaced,
        smallCount: smallParts.reduce((s, p) => s + p.qty, 0),
        unallocatedCount: unallocated.reduce((s, u) => s + u.qty, 0),
      },
    };
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
    partClassOf,
    basePartId,
    rotatableOf: (m, list) => rotatableOf(m || {}, list || NO_ROTATE_MATERIALS),
    DEFAULTS: Object.freeze({
      SHEET_W: DEFAULT_SHEET_W, SHEET_H: DEFAULT_SHEET_H, KERF: DEFAULT_KERF, TRIM: DEFAULT_TRIM,
      SMALL_LIMIT, MAX_STACK, THIN_MIN, THIN_MAX,
    }),
    NO_ROTATE_MATERIALS: NO_ROTATE_MATERIALS.slice(),
  };

  if (typeof window !== 'undefined') window.NestingEngine = NestingEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = NestingEngine;
})();
