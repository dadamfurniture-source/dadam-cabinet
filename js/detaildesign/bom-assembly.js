/**
 * 조립 명세 `dadam.assembly/1` — 몸통 판재마다 위치 (다담 CAD 베타 PR6, docs/01-plan/planner-cad.plan.md §4-2 · §6).
 *
 * BOM 행(MaterialExtractor 출력)을 받아, 한 행이 대표하는 판재 조각 하나하나에 모듈 로컬 위치를 붙인다.
 * 재단 치수(w·h·t)는 BOM 행 그대로다 — 이 파일은 크기를 새로 셈하지 않고 **자리만** 정한다.
 * 자리를 정하는 숫자는 assembly-rules.js(몸통)와 bom-drawer-rules.js(목찬넬 따내기) 에서만 읽는다.
 *
 * 좌표 (모듈 로컬, mm) — 플래너 createModuleMesh 와 같은 축:
 *   x 오른쪽 · y 위 · z 앞 (+z 가 정면). 원점은 **몸통 바닥 가운데** (x = 0, y = 0, z = 0 이 몸통 깊이 가운데).
 *   다리발·좌대 높이는 여기 넣지 않는다 — 모듈을 세우는 자리(place)는 부르는 쪽(플래너)이 넘긴다.
 *   (붙박이장 좌대 상자는 BOM 행이 모듈에 있어 몸통 아래 y < 0 에 놓는다)
 *
 * 판재 하나 (Part):
 *   id         `${rowPartId}#${k}` — k 는 0부터, 왼→오 · 아래→위 · 앞→뒤 (네스팅 조각 번호와 같은 규약)
 *   rowPartId  BOM 행 partId
 *   cut        { w, h } — BOM 행 w·h 그대로
 *   t          두께
 *   frame      { o:[x,y,z], u, v, n } — 재단면 꼭짓점 o 에서 u 축으로 cut.w, v 축으로 cut.h, n 축으로 t.
 *              u·v·n 은 부호 있는 축 ('+x' '-z' …). 회전은 없다.
 *   box        { min, max } — frame 이 덮는 상자 (조회용)
 *   features   따내기·홈. notch 는 관통(u0..u1 × v0..v1), groove 는 깊이 미정(D5) 이라 depth null
 *
 * 이 단계(PR6)에서 자리를 정하는 부재 — 싱크 라인(상부장 · 하부장 · 키큰장 단)의 몸통:
 *   측판 · 지판 · 천판 · 뒷판 · 선반 · 처짐방지목 · 상부장 보강목 · 여닫이 도어 · 서랍장 전면 · 중간 목찬넬. 나머지 행은 `unplaced` 에 이유와 함께 남는다 (조용히 빠지지 않는다).
 *
 * 자리의 근거 (확정 사실 — 프로젝트 지침, PR #832, 플래너 addCarcassShell · addBraces):
 *   측판     모듈 양 끝. 사쿠리 측판에는 뒤끝에서 15 들어온 폭 3 홈 (깊이는 D5 미정)
 *   지판·천판 측판 사이. 사쿠리면 홈 앞까지 (D − 18, 앞선 맞춤), 아니면 측판 깊이 그대로
 *   뒷판     사쿠리면 홈 속 (뒤끝에서 15~18), 아니면 측판 뒤끝에 덮어 붙임 (측판 깊이 밖 3T). 높이 H − 1 은 가운데
 *   처짐방지목 모듈 폭 가운데, 측판 앞선에 맞대어 도어 바로 뒤, 지판 위에서 시작
 *   도어     측판 앞선에 붙어 밖으로. 가로·세로는 플래너 addFrontPanel 과 같은 칸 규칙 (doorXsOf · doorYOf)
 *   서랍장   전면(도어·서랍도어) · 중간 목찬넬 ㄴ자 · 측판 중간 따내기 — 서랍 레이아웃 (drawerOf, 플래너 frontSpanOf · addMidChannels)
 *            서랍 박스 판 — 플래너 addDrawerBoxes 외경 + 사장님 2026-10-20 짜임 (drawerBoxesOf)
 *   선반     측판 사이. 깊이가 "측판 깊이 − T (처짐방지목 몫)" 이라 처짐방지목 **뒤**에 놓인다 — 뒤로 붙인다
 *            (사쿠리면 홈 앞, 아니면 측판 뒤끝). 높이는 부르는 쪽이 넘긴 선반 중심 높이(opts.shelfY)를 쓴다
 *   붙박이장 통 — 몸통 여럿을 아래→위로 쌓는다 (외부 서랍 몸통 · 하부장 · 통 · 상부장, 규칙 파일 layoutWardrobeModule).
 *            몸통마다 위 짜임. 선반 높이는 규칙 파일 배치 또는 wardrobe.md §6 (wardrobeOf)
 *   오픈장·밥솥장 — 18T MDF 상자 (bom-open-cabinet-rules.js, 플래너 buildOpenCabinetMesh): 측판 양 끝 깊이 전체,
 *            천지판 측판 사이 앞선 맞춤 (뒤에 뒷판 자리 20), 18T 뒷판 측판 사이 뒤끝 맞춤 몸통 높이 전체.
 *            밥솥장 도어 (W − 4) × (H − 4) 는 측판 앞선에 붙어 가운데 (openBoxOf)
 *   라인 부재 (품목 단위 행 `<품목>-ep`, 2026-10-22) — items[].runs[] 에 호스트 모듈(라인 첫 모듈) 좌표로 낸다 (runsOf).
 *            부르는 쪽이 벽(배치 공간)마다 모듈의 x 를 넘긴다 (opts.lines) — 없으면 전부 unplaced 'run-part'.
 *            상판   하부 라인(키큰장 단 뺀 하부장 + 좌우 마감 폭) 위 한 장, 뒤 = 벽, 깊이 = 행 h (2026-10-18 사장님: 배치 깊이, 오버행 없음).
 *                   벽은 호스트 몸통 뒷면에서 lines 의 back 만큼 뒤 (2026-10-24 사장님 D3: 몸통 뒤를 벽에서 띄워 설치 — 배관 자리)
 *            상몰딩 상부 라인(후드 뺀 상부장) 위 띠 — 키큰장 상몰딩과 같은 자리 (2026-10-20 카드 "도어 앞면 맞춤")
 *            목찬넬 EP (전면 52 · 지면 40 × 라인 폭) — 하부 라인 측판 따내기 70×40 자리의 ㄴ자, 키큰장 단 ㄴ자와 같은 자리
 *            걸레받이 (벽 길이 × 다리발−5) — 벽마다 하부 라인 폭 한 장, 바닥에 붙여 (틈 5 는 위, 캐쳐), 앞면 = 몸통 앞선 − 32 (2026-10-22 카드 "몸통 앞선에서 32 안쪽").
 *                   2440 넘는 벽은 2440 조각을 왼쪽부터, 남는 조각은 오른쪽 끝 (카드 "1")
 *            좌우 마감재 (휠라·몰딩·EP, 폭 × 품목H−다리발) — 하부 라인 양 끝 밖 세로, 밑단 = 하부 몸통 바닥, 앞면 = 도어 앞면 (2026-10-22 카드)
 *   철물 (modules[].hardware[], 2026-10-22, hardwareOf) — 다리발 4 코너(플래너 3D 자리) + 가운데 균등 분할 · 레일(언더레일 박스 밑 여유 30,
 *            볼레일 측판 밑단) · 경첩 컵 자리(변에서 21.5, 깊이 12.5)를 놓는다 (2026-10-23 4-1 A~D). 외짝 경첩 방향이 설계에 없으면 pending.
 *
 * 미정 (지금 BOM 동작을 그대로 두고 결과에 적는다):
 *   하부장·키큰장 단·붙박이장 서랍모듈·내부 서랍장 밴드 2장 — 2026-10-20 사장님 "뒤 눕힘": 천판 대신 상단 앞·뒤에
 *     눕는다 (윗면 = 몸통 상단). 목찬넬이면 앞 밴드는 ㄴ자 지면판 바로 아래. 판 두께는 몸통 T.
 *     행이 이 짜임(2장 · 70 × W−2T · T)과 다르면 unplaced 'band-position-pending'
 *   상부장 보강목 2장 — 2026-10-20 사장님: 사쿠리 홈 뒤 장의 맨 뒤, 지판 바로 위 · 천판 바로 아래.
 *     판은 몸통이 18T 여도 15T (assembly-rules UPPER_BAND_T).
 *   D2 서랍장 처짐방지목 자리 → unplaced 'pending-owner D2'
 *   D1 다칸 모듈 — BOM 대로 칸마다 통 (BOM 행이 칸마다 있으면 칸마다 명세)
 *   D12 하부 선반 −15 = T — BOM 대로
 *   D5 사쿠리 홈 깊이 — groove.depth null
 *
 * 브라우저는 전역 `DadamAssembly`, Node(Jest)는 module.exports. DOM 없음.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamAssembly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  /* global require */
  const AsmRules = root.DadamAssemblyRules
    || (typeof require === 'function' ? require('./assembly-rules.js') : null);
  const DrawerRules = root.DadamDrawerRules
    || (typeof require === 'function' ? require('./bom-drawer-rules.js') : null);
  const WardrobeRules = root.DadamWardrobeRules
    || (typeof require === 'function' ? require('./bom-wardrobe-rules.js') : null);
  const OpenRules = root.DadamOpenCabinetRules
    || (typeof require === 'function' ? require('./bom-open-cabinet-rules.js') : null);
  const RiceRules = root.DadamRiceCabinetRules
    || (typeof require === 'function' ? require('./bom-rice-cabinet-rules.js') : null);
  const HomecafeRules = root.DadamHomecafeRules
    || (typeof require === 'function' ? require('./bom-homecafe-rules.js') : null);
  const C = AsmRules.CARCASS;
  const DR = DrawerRules.DRAWER_RULES;

  const SCHEMA = 'dadam.assembly/1';

  /** 이번 단계에서 자리를 정하는 모듈 — 상세설계 모듈 pos. */
  const SHELL_POS = ['upper', 'lower'];
  // 옛 냉장고장 화면 모듈(type, pos 없음 — extractFridge)을 몸통 짜임으로 읽는 자리. 2026-10-22 사장님: 냉장고상부장은 15T 사쿠리
  //   + 보강목(싱크 상부장과 같다), 도어 H+20 은 아래로 20(윗변 = 몸통 상단). 키큰장·EL장도 사쿠리 몸통에 천판 — 상부장 짜임,
  //   냉장고하부장은 뒤 덮음 뒷판 + 천판, 도어 H−30 은 밑단 = 몸통 바닥 — 하부장 짜임. 홈카페장은 18T 상자(openBoxOf).
  const FRIDGE_TYPE_POS = { upper: 'upper', tall: 'upper', el: 'upper', lower: 'lower' };

  const AXES = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };

  /** frame 이 덮는 상자. */
  function boxOfFrame(frame, w, h, t) {
    const p = [frame.o.slice(), frame.o.slice()];
    const corners = [];
    [0, w].forEach((a) => [0, h].forEach((b) => [0, t].forEach((c) => {
      const u = AXES[frame.u], v = AXES[frame.v], n = AXES[frame.n];
      corners.push([0, 1, 2].map((i) => frame.o[i] + u[i] * a + v[i] * b + n[i] * c));
    })));
    p[0] = [0, 1, 2].map((i) => Math.min(...corners.map((q) => q[i])));
    p[1] = [0, 1, 2].map((i) => Math.max(...corners.map((q) => q[i])));
    return { min: p[0], max: p[1] };
  }

  /** 재단면 좌표 (u, v, n) → 모듈 로컬 점. */
  function pointOf(frame, u, v, n) {
    const U = AXES[frame.u], V = AXES[frame.v], N = AXES[frame.n];
    return [0, 1, 2].map((i) => frame.o[i] + U[i] * u + V[i] * v + N[i] * n);
  }

  /**
   * 판재를 서로 겹치지 않는 상자 여럿으로 — 관통 따내기(notch)를 뺀다. 홈(groove)은 깊이 미정이라 빼지 않는다.
   * @returns {Array<{min:number[], max:number[]}>} 모듈 로컬
   */
  function solidsOf(part) {
    const w = part.cut.w, h = part.cut.h, t = part.t;
    const notches = (part.features || []).filter((f) => f.type === 'notch');
    // u 경계마다 띠를 나누고, 띠 안에서 v 구간을 따내기로 뺀다
    const us = [...new Set([0, w].concat(...notches.map((f) => [f.u0, f.u1])))].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i + 1 < us.length; i++) {
      const u0 = us[i], u1 = us[i + 1], um = (u0 + u1) / 2;
      const cuts = notches.filter((f) => f.u0 < um && um < f.u1).map((f) => [f.v0, f.v1]).sort((a, b) => a[0] - b[0]);
      let v = 0;
      const spans = [];
      cuts.forEach(([a, b]) => { if (a > v) spans.push([v, a]); v = Math.max(v, b); });
      if (v < h) spans.push([v, h]);
      spans.forEach(([v0, v1]) => {
        const a = pointOf(part.frame, u0, v0, 0), b = pointOf(part.frame, u1, v1, t);
        out.push({ min: [0, 1, 2].map((k) => Math.min(a[k], b[k])), max: [0, 1, 2].map((k) => Math.max(a[k], b[k])) });
      });
    }
    return out;
  }

  /** BOM 행 → { partKey, family, n }. partId = `${moduleKey}-${partKey}-${n}`. */
  function keyOfRow(row) {
    const pid = String(row.partId || ''), mk = String(row.moduleKey || '');
    if (!mk || pid.indexOf(mk + '-') !== 0) return null;
    const rest = pid.slice(mk.length + 1);
    const m = rest.match(/^(.*)-(\d+)$/);
    if (!m) return null;
    return { partKey: m[1], family: m[1].split('#')[0], n: Number(m[2]) };
  }

  function makePart(row, k, frame, features, vis, tags) {
    const cut = { w: row.w, h: row.h };
    return {
      id: `${row.partId}#${k}`,
      rowPartId: row.partId,
      part: row.part,
      material: row.material,
      t: row.thickness,
      finishCode: row.finishCode || '',
      cut,
      frame,
      box: boxOfFrame(frame, cut.w, cut.h, row.thickness),
      features: features || [],
      vis: vis || 'interior',
      tags: tags || {},
    };
  }

  /**
   * 서랍장 레이아웃 — BOM 과 같은 답 (MaterialExtractor.drawerLayoutOf, 규칙은 bom-drawer-rules.js).
   * 플래너 iframe 은 추출기가 부모 창에 있으므로 opts.MaterialExtractor 로 받는다. 없으면 null (서랍장 전면은 놓지 않는다).
   */
  function drawerOf(mod, H, T, opts) {
    const ME = (opts && opts.MaterialExtractor) || root.MaterialExtractor
      || (typeof require === 'function' ? require('./extractors.js').MaterialExtractor : null);
    if (!ME) return { layout: null, rules: null };
    const me = new ME();
    return {
      layout: me.drawerLayoutOf(mod, H, T),
      rules: typeof me.drawerRulesOf === 'function' ? me.drawerRulesOf(mod, T) : null,
    };
  }

  /**
   * 서랍 박스 판 — 박스 외경은 플래너 addDrawerBoxes 와 같은 자리 (가로 가운데, 앞면 = 몸통 앞선, 바닥 = 존 바닥 + 레일 아래 여유).
   * 판 짜임 (2026-10-20 사장님 "박스 아래 덮음"): 측판이 외경 양 끝에 박스 길이 전체, 앞뒷판은 측판 사이 앞·뒤 끝,
   * 밑판(우라)은 측판·앞뒷판 밑면에 덮어 붙이고 (외경 −1 × 측판 −1, 가운데), 하단보강은 밑판 아래 폭 가운데에 앞뒤로 눕힌다.
   * @returns {Array<{dims, x0, y0, z0, zf}>|null} 레이아웃 박스 순서 (서랍 전면 위→아래)
   */
  function drawerBoxesOf(layout, rules, W, D, H, T) {
    if (!layout || !rules) return null;
    const rail = DR.RAIL_CLEARANCE[layout.rail] || DR.RAIL_CLEARANCE[DR.RAIL_DEFAULT];
    return layout.boxes.map((b) => {
      const f = layout.fronts[b.frontIndex];
      const dims = DrawerRules.drawerBoxDims({ W, D, bodyT: T, drawerT: rules.boxT, rail: layout.rail, boxH: b.h, sakuri: rules.sakuri });
      const zf = D / 2;
      return { size: b.size, dims, x0: -dims.outerW / 2, y0: H - f.zone.bottom + rail.below, zf, z0: zf - dims.sideL };
    });
  }

  /**
   * 서랍 박스 판 한 행을 박스 자리에 놓는다 (싱크 서랍장 · 붙박이장 외부 서랍 같은 짜임).
   *   boxes [{size, dims, x0, y0, zf, z0}] — y0 = 측판 밑단, zf = 박스 앞끝, z0 = 뒤끝. 치수가 맞지 않으면 false.
   */
  function placeBoxRow(parts, row, key, boxes, sakuri, rows) {
    // 사쿠리 서랍 — 우라가 측판 홈(바닥에서 BOX_SAKURI_GROOVE_Y)에 끼고, 앞뒷판은 그 위에 서서 측판 윗단에 맞춘다
    const bottomT = (rows.find((r) => keyOfRow(r) && keyOfRow(r).family === 'drawerbox:bottom') || {}).thickness || 0;
    // 행 → 박스: 전후판·측판은 같은 크기 묶음(행 번호 = 크기 등장 순), 밑판·하단보강은 박스 전부
    const sizes = [];
    boxes.forEach((b) => { if (sizes.indexOf(b.size) < 0) sizes.push(b.size); });
    const mine = (key.family === 'drawerbox:fb' || key.family === 'drawerbox:side') ? boxes.filter((b) => b.size === sizes[key.n]) : boxes;
    const per = (key.family === 'drawerbox:fb' || key.family === 'drawerbox:side') ? 2 : 1;
    const dimOk = mine.length * per === row.qty && mine.every((b) => {
      const d = b.dims;
      if (key.family === 'drawerbox:fb') return row.w === d.fbW && row.h === d.fbH;
      if (key.family === 'drawerbox:side') return row.w === d.sideL && row.h === d.sideH;
      if (key.family === 'drawerbox:bottom') return row.w === d.bottomW && row.h === d.bottomD;
      return d.brace && row.w === d.sideL;
    });
    if (!dimOk) return false;
    let k = 0;
    mine.forEach((b) => {
      const d = b.dims, t = row.thickness;
      const tag = { box: boxes.indexOf(b) };
      // 우라 밑면 높이 — 일반은 박스 바닥 바로 아래, 사쿠리는 측판 홈 속
      const yBottom = sakuri ? b.y0 + DR.BOX_SAKURI_GROOVE_Y : b.y0 - bottomT;
      if (key.family === 'drawerbox:side') {
        // 왼 · 오 — 서서 앞뒤로 (u = 뒤→앞). 사쿠리면 안쪽 면에 우라 홈 (깊이 미정)
        const feats = sakuri ? [{ type: 'groove', face: 'inner', u0: 0, u1: d.sideL, v0: DR.BOX_SAKURI_GROOVE_Y, v1: DR.BOX_SAKURI_GROOVE_Y + bottomT, depth: null, src: 'drawer-sakuri' }] : [];
        parts.push(makePart(row, k++, { o: [b.x0, b.y0, b.z0], u: '+z', v: '+y', n: '+x' }, feats, 'interior', Object.assign({ side: 'left' }, tag)));
        parts.push(makePart(row, k++, { o: [-b.x0, b.y0, b.z0], u: '+z', v: '+y', n: '-x' }, feats, 'interior', Object.assign({ side: 'right' }, tag)));
      } else if (key.family === 'drawerbox:fb') {
        // 앞 · 뒤 — 측판 사이, 윗단은 측판 윗단 (사쿠리면 측판 − 18 높이라 우라 위에 선다)
        const yfb = b.y0 + d.sideH - d.fbH;
        parts.push(makePart(row, k++, { o: [-d.fbW / 2, yfb, b.zf - t], u: '+x', v: '+y', n: '+z' }, [], 'interior', Object.assign({ end: 'front' }, tag)));
        parts.push(makePart(row, k++, { o: [-d.fbW / 2, yfb, b.z0], u: '+x', v: '+y', n: '+z' }, [], 'interior', Object.assign({ end: 'back' }, tag)));
      } else if (key.family === 'drawerbox:bottom') {
        // 가운데. 일반은 밑면에 덮어 붙이고, 사쿠리는 양쪽 측판 홈에 끼운다
        parts.push(makePart(row, k++, { o: [-row.w / 2, yBottom, (b.z0 + b.zf) / 2 - row.h / 2], u: '+x', v: '+z', n: '+y' }, [], 'interior',
          Object.assign(sakuri ? { mount: 'groove' } : {}, tag)));
      } else {
        // 하단보강 — 밑판 아래 폭 가운데, 앞뒤로 눕힘 (u = 앞뒤 길이, v = 폭 60)
        parts.push(makePart(row, k++, { o: [-row.h / 2, yBottom - t, b.z0], u: '+z', v: '+x', n: '+y' }, [], 'interior', tag));
      }
    });
    return true;
  }

  /**
   * 도어 가로 자리 (왼쪽 끝 x, 장마다). 플래너: 칸 폭 − 갭 4 를 칸 가운데에 (좌우 2 씩), 양문은 가운데 갭 4.
   * 1장 = W − 4, 2장 = W/2 − 4 (BOM floor(W/n) − 4) 일 때만 — 그 밖의 장수·폭은 자리를 모른다 (null).
   */
  function doorXsOf(W, row) {
    const G = C.DOOR_GAP;
    if (row.qty === 1 && row.w === W - G) return [-W / 2 + G / 2];
    if (row.qty === 2 && row.w === Math.floor(W / 2) - G) return [-W / 4 - row.w / 2, W / 4 - row.w / 2];
    return null;
  }

  /**
   * 도어 세로 자리 (밑단 y). 플래너 addFrontPanel:
   *   상부장 — 도어 내림: 윗변 = 몸통 상단, 밑단이 (도어 H − 장H) 만큼 아래로 (BOM 장H + 내림)
   *   하부장 — 목찬넬 상단 틈: 밑단 = 몸통 바닥, 윗변이 몸통 상단보다 내려옴 (BOM 장H − 30)
   *   갭만 둔 도어 (장H − 4) — 위아래 2 씩
   * 그 밖은 null.
   */
  function doorYOf(pos, H, h) {
    const G = C.DOOR_GAP;
    if (h === H - G) return G / 2;
    if (pos === 'upper' && h > H) return H - h;
    if (pos === 'lower' && h < H) return 0;
    return null;
  }

  /**
   * 멍장 정면 자리 (corner.md §3.3·§3.5·§3.5.1). 벽(코너) 쪽 0 → 도어 쪽으로 u 를 잰다:
   *   [멍가림판 0 … 멍W−15][도어 자리 멍W−15 … 멍W+doorW] — 목대 15 는 도어 자리 안쪽 구조재라 도어가 덮는다.
   *   멍장이 라인의 어느 끝인지는 specs.secondaryStartSide (corner-engine seedCornerModules: 'left' 면 멍장이 맨 앞 =
   *   벽이 왼쪽, 도어가 오른쪽). 멍 W + doorW 가 몸통 W 와 다르면 null (놓지 않는다).
   * @returns {{zoneW:number, doorW:number, doorRight:boolean, coverEnd:number, xOf:function}|null} xOf(u0,u1) = 그 구간의 왼쪽 x
   */
  function blindGeomOf(mod, W, item) {
    const zoneW = Number(mod.blindZoneW) || 0, doorW = Number(mod.doorW) || 0;
    if (!(zoneW > 0) || !(doorW > 0) || zoneW + doorW !== W) return null;
    const startSide = (item && item.specs && item.specs.secondaryStartSide) || 'left';
    const doorRight = startSide !== 'right';
    const xw = doorRight ? -W / 2 : W / 2, s = doorRight ? 1 : -1;
    return {
      zoneW, doorW, doorRight,
      coverEnd: zoneW - C.BLIND_BATTEN_T,
      xOf: (u0, u1) => Math.min(xw + s * u0, xw + s * u1),
    };
  }

  /**
   * 좌대 상자 — 몸통 아래 (y −h … 0). 2026-10-20 사장님 카드 "뒤 맞춤" (붙박이장·키큰장 좌대 상자):
   *   상자 뒷면 = 몸통 뒷면, 앞이 50 들어간다 (그 자리에 걸레받이 18T, 32 남음). 측판은 전후판 사이, 중간보강은 폭 가운데.
   *   tags.side 를 쓰지 않는다 — 검사가 몸통 측판(side)으로 읽는다.
   * @param {Array} ped keyed 행 (pedestal:fb · pedestal:side · pedestal:brace)
   * @returns {{h:number, zFront:number}|null} 놓았으면 좌대 높이와 상자 앞면 z, 행이 이 짜임과 다르면 null (놓지 않는다)
   */
  function placePedestal(parts, ped, W, D) {
    const pfam = (f) => ped.filter((x) => x.key.family === f).map((x) => x.row);
    const fbs = pfam('pedestal:fb'), psides = pfam('pedestal:side'), braces = pfam('pedestal:brace');
    const fb = fbs[0], ps = psides[0], br = braces[0];
    const ok = fbs.length === 1 && psides.length === 1 && braces.length <= 1 && ped.length === 2 + braces.length
      && fb.qty === 2 && fb.w === W && ps.qty === 2 && ps.h === fb.h && ps.thickness === fb.thickness
      && ps.w + 2 * fb.thickness <= D && (!br || (br.qty === 1 && br.w === ps.w && br.h === fb.h));
    if (!ok) return null;
    const t = fb.thickness, h = fb.h, zb = -D / 2;
    const tag = (o) => Object.assign({ pedestal: true }, o);
    parts.push(makePart(fb, 0, { o: [-W / 2, -h, zb + t + ps.w], u: '+x', v: '+y', n: '+z' }, [], 'interior', tag({ end: 'front' })));
    parts.push(makePart(fb, 1, { o: [-W / 2, -h, zb], u: '+x', v: '+y', n: '+z' }, [], 'interior', tag({ end: 'back' })));
    parts.push(makePart(ps, 0, { o: [-W / 2, -h, zb + t], u: '+z', v: '+y', n: '+x' }, [], 'interior', tag({ end: 'left' })));
    parts.push(makePart(ps, 1, { o: [W / 2, -h, zb + t], u: '+z', v: '+y', n: '-x' }, [], 'interior', tag({ end: 'right' })));
    if (br) parts.push(makePart(br, 0, { o: [-br.thickness / 2, -h, zb + t], u: '+z', v: '+y', n: '+x' }, [], 'interior', tag()));
    return { h, zFront: zb + t + ps.w + t };
  }

  /**
   * 한 모듈의 몸통. 지원하지 못하면 null (행은 모두 unplaced 로).
   * @returns {{module:object, unplaced:Array}|null}
   */
  function shellOf(mk, mod, rows, opts, item) {
    const keyed = rows.map((r) => ({ row: r, key: keyOfRow(r) }));
    const one = (fam) => keyed.filter((x) => x.key && x.key.family === fam);
    const sides = one('body:side'), bottoms = one('body:bottom');
    if (sides.length !== 1 || sides[0].row.qty !== 2 || bottoms.length !== 1) return null;

    const side = sides[0].row, bottom = bottoms[0].row;
    const T = side.thickness;
    const D = side.w, H = side.h;
    const W = bottom.w + 2 * T;
    const sakuri = /sakuri/.test(String(side.note || ''));
    const chanTop = /목찬넬 따내기 상단/.test(String(side.note || ''));   // 측판 앞 위 70×40 따내기 (목찬넬 손잡이)
    const zBack = -D / 2, zFront = D / 2;
    const blind = String(mod.id).indexOf('corner-blind-') === 0;   // 멍장 — 정면은 멍가림판·마감재·도어, 안쪽에 ㄱ자 목대
    const bl = blind ? blindGeomOf(mod, W, item) : null;
    const panelZ0 = sakuri ? zBack + C.SAKURI_PANEL_D_MINUS : zBack;   // 천지판 뒤끝 (앞선 맞춤)
    const shelfZ0 = sakuri ? zBack + C.SAKURI_PANEL_D_MINUS : zBack;   // 선반은 뒤로 붙인다
    const parts = [], unplaced = [], pending = [];
    const drawer = mod.isDrawer ? drawerOf(mod, H, T, opts) : { layout: null, rules: null };
    const layout = drawer.layout;
    const boxes = drawerBoxesOf(layout, drawer.rules, W, D, H, T);
    const frontsOf = (kind) => (layout ? layout.fronts.filter((f) => f.kind === kind && f.h >= DR.MIN_FRONT_H) : []);
    const skip = (row, reason) => unplaced.push({ rowPartId: row.partId, moduleKey: mk, part: row.part, qty: row.qty, reason });

    keyed.forEach(({ row, key }) => {
      if (!key) { skip(row, 'no-part-key'); return; }
      switch (key.family) {
        case 'body:side': {
          const feats = [];
          if (sakuri) feats.push({ type: 'groove', face: 'inner', u0: C.SAKURI_FROM_BACK, u1: C.SAKURI_FROM_BACK + C.SAKURI_W, v0: 0, v1: H, depth: null, src: 'sakuri' });
          if (/목찬넬 따내기 상단/.test(String(row.note || ''))) {
            feats.push({ type: 'notch', u0: D - DR.CHANNEL_BASE_W, u1: D, v0: H - DR.CHANNEL_TOP_NOTCH_H, v1: H, src: 'channel-top' });
          }
          if (/중간/.test(String(row.note || ''))) {
            // 서랍장 중간 따내기 — 서랍 레이아웃의 중간 목찬넬 자리 (y 는 몸통 상단에서 아래로, 플래너 notchesOf)
            const mids = layout ? layout.channels.filter((c) => c.kind === 'mid') : [];
            if (mids.length) mids.forEach((c) => feats.push({ type: 'notch', u0: D - c.notchD, u1: D, v0: H - c.y - c.notchH, v1: H - c.y, src: 'channel-mid' }));
            else pending.push('channel-mid-notch');
          }
          // u 는 뒤→앞 (BOM 측판 L = 앞)
          parts.push(makePart(row, 0, { o: [-W / 2, 0, zBack], u: '+z', v: '+y', n: '+x' }, feats, 'exterior', { side: 'left' }));
          parts.push(makePart(row, 1, { o: [W / 2, 0, zBack], u: '+z', v: '+y', n: '-x' }, feats, 'exterior', { side: 'right' }));
          return;
        }
        case 'body:bottom':
          parts.push(makePart(row, 0, { o: [-W / 2 + T, 0, panelZ0], u: '+x', v: '+z', n: '+y' }));
          return;
        case 'body:top':
          parts.push(makePart(row, 0, { o: [-W / 2 + T, H - T, panelZ0], u: '+x', v: '+z', n: '+y' }));
          return;
        case 'back': {
          const y0 = (H - row.h) / 2;
          const z0 = sakuri ? zBack + C.SAKURI_FROM_BACK : zBack - row.thickness;
          parts.push(makePart(row, 0, { o: [-row.w / 2, y0, z0], u: '+x', v: '+y', n: '+z' }, [], 'interior', { mount: sakuri ? 'groove' : 'behind-sides' }));
          return;
        }
        case 'body:brace': {
          if (mod.isDrawer) { skip(row, 'pending-owner D2'); return; }
          for (let k = 0; k < row.qty; k++) {
            // 폭 가운데, 앞면 = 측판 앞선, 지판 위
            parts.push(makePart(row, k, { o: [-row.w / 2, T, zFront - row.thickness], u: '+x', v: '+y', n: '+z' }));
          }
          return;
        }
        case 'shelf':
          return;   // 아래에서 모듈 선반을 한꺼번에 높이 순으로
        case 'body:band': {
          if (row.part === '밴드(보강목)') {
            // 2026-10-20 사장님: 상부장 보강목 2장은 사쿠리 홈 뒤 — 장의 맨 뒤, 판이 서서 뒤를 본다.
            //   아래 1장은 지판 바로 위, 위 1장은 천판 바로 아래.
            if (!sakuri || row.qty !== 2) { skip(row, 'band-position-pending'); return; }
            //   판은 몸통과 상관없이 15T (2026-10-20 사장님 "15T 고정") — 홈 뒤 15 자리에 맞는다.
            [T, H - T - row.h].forEach((y0, k) => {
              parts.push(makePart(row, k, { o: [-W / 2 + T, y0, zBack], u: '+x', v: '+y', n: '+z' }, [], 'interior', { mount: 'behind-groove' }));
            });
            return;
          }
          // 하부장·키큰장 단 밴드 2장 (70 × W−2T, 몸통 T) — 2026-10-20 사장님 "뒤 눕힘, 두께는 몸통과 같게":
          //   천판 대신 상단 앞·뒤에 눕는다 (70 이 앞뒤 방향, 측판 사이). 앞 밴드는 목찬넬 ㄴ자 지면판 바로 아래
          //   (프로젝트 지침 — 처짐방지목 윗끝이 앞 밴드 아랫면에 닿는다, BOM bandH = H − 2T − 70), 목찬넬이 없으면
          //   윗면 = 몸통 상단 (bandH = H − 2T). 뒤 밴드는 윗면 = 몸통 상단, 뒤끝 — 사쿠리면 천지판처럼 홈 앞(panelZ0).
          if (row.part !== '밴드' || row.qty !== 2 || row.w !== C.BAND_W || row.h !== W - 2 * T || row.thickness !== T) { skip(row, 'band-position-pending'); return; }
          const yFront = H - (chanTop ? DR.CHANNEL_TOP_NOTCH_H : 0) - T;
          parts.push(makePart(row, 0, { o: [-W / 2 + T, yFront, zFront - row.w], u: '+z', v: '+x', n: '+y' }, [], 'interior', { end: 'front' }));
          parts.push(makePart(row, 1, { o: [-W / 2 + T, H - T, panelZ0], u: '+z', v: '+x', n: '+y' }, [], 'interior', { end: 'back' }));
          return;
        }
        case 'door': {
          // 여닫이 도어 — 플래너 addFrontPanel 과 같은 자리 (mockup-structure.html, 3D 장면과 대조 시험).
          //   앞뒤: 측판 앞선에 붙어 밖으로 (z = D/2 … D/2 + 두께). 서랍장 도어는 서랍 레이아웃 몫 (PR9 다음).
          if (blind) {
            // 멍장 도어 — 목대를 덮는다 (corner.md §3.5.2): 자리 = doorW + 15, 재단 = 자리 − 4, 갭 좌우 2. 높이는 보통 도어와 같다.
            const yb = doorYOf(mod.pos, H, row.h);
            if (!bl || row.qty !== 1 || row.w !== bl.doorW + C.BLIND_BATTEN_T - C.DOOR_GAP || yb == null) { skip(row, 'blind-layout-unknown'); return; }
            const u0 = bl.coverEnd + C.DOOR_GAP / 2;
            parts.push(makePart(row, 0, { o: [bl.xOf(u0, u0 + row.w), yb, zFront], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { doorIdx: 0, blind: 'door' }));
            return;
          }
          const xs = doorXsOf(W, row);
          let y0 = doorYOf(mod.pos, H, row.h);
          if (mod.isDrawer) {
            // 서랍장 도어 — 레이아웃 전면 (플래너 frontSpanOf: 몸통 상단에서 아래로 잰 y0..y1 을 뒤집는다)
            const f = frontsOf('door');
            y0 = f.length === 1 && f[0].h === row.h ? H - f[0].y1 : null;
          }
          if (!xs || y0 == null) { skip(row, 'door-layout-unknown'); return; }
          xs.forEach((x0, k) => parts.push(makePart(row, k, { o: [x0, y0, zFront], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { doorIdx: k })));
          return;
        }
        case 'drawer': {
          // 서랍 전면 — 레이아웃 전면 중 같은 높이의 것을 위에서부터 (BOM 은 같은 높이끼리 한 행). 가로 W − 4 가운데.
          const fs = frontsOf('drawer').filter((f) => f.h === row.h);
          if (!layout || row.w !== W - C.DOOR_GAP || fs.length !== row.qty) { skip(row, 'drawer-layout-unknown'); return; }
          fs.forEach((f, k) => parts.push(makePart(row, k, { o: [-W / 2 + C.DOOR_GAP / 2, H - f.y1, zFront], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { drawerIdx: layout.fronts.indexOf(f) })));
          return;
        }
        case 'channel:mid-front':
        case 'channel:mid-back': {
          // 서랍장 중간 목찬넬 ㄴ자 — 따낸 자리 바닥에 지면판, 그 위 따낸 자리 안쪽 끝에 전면판 (플래너 addMidChannels)
          const mids = layout ? layout.channels.filter((c) => c.kind === 'mid') : [];
          if (mids.length !== row.qty || row.h !== W) { skip(row, 'drawer-layout-unknown'); return; }
          // 측판에 중간 따내기 비고가 없으면(찬넬·손잡이 등 목찬넬이 아닌 서랍장) ㄴ자를 놓을 자리가 없다 — 측판에 파고든다.
          if (!/중간/.test(String(side.note || ''))) { skip(row, 'channel-layout-unknown'); return; }
          const face = key.family === 'channel:mid-front';
          mids.forEach((c, k) => {
            const yb = H - c.y - c.notchH;   // 따낸 자리 바닥
            const z0 = zFront - c.notchD;
            parts.push(makePart(row, k, face
              ? { o: [-W / 2, yb + row.thickness, z0], u: '+y', v: '+x', n: '+z' }
              : { o: [-W / 2, yb, z0], u: '+z', v: '+x', n: '+y' }, [], 'exterior', { channel: 'mid', mid: k }));
          });
          return;
        }
        case 'drawerbox:fb':
        case 'drawerbox:side':
        case 'drawerbox:bottom':
        case 'drawerbox:brace': {
          if (!boxes || !placeBoxRow(parts, row, key, boxes, !!drawer.rules.sakuri, rows)) skip(row, 'drawer-layout-unknown');
          return;
        }
        case 'channel:front':
        case 'channel:back': {
          // 키큰장 단의 상단 목찬넬 ㄴ자 — 그 단의 모듈 폭 (sink.md §5.1). 싱크 하부장의 목찬넬은 품목 행(run-part)이라 여기 오지 않는다.
          //   측판 따내기(70×40) 바닥에 지면판 40, 그 위 따낸 자리 안쪽 끝에 전면판 52 (붙박이장 서랍모듈 상단 ㄴ자와 같다).
          const face = key.family === 'channel:front';
          if (!chanTop || row.qty !== 1 || row.h !== W || row.w !== (face ? DR.CHANNEL_TOP_FACE_H : DR.CHANNEL_BASE_W) || row.thickness !== DR.CHANNEL_T) { skip(row, 'channel-layout-unknown'); return; }
          const yb = H - DR.CHANNEL_TOP_NOTCH_H, z0 = zFront - DR.CHANNEL_BASE_W;
          parts.push(makePart(row, 0, face
            ? { o: [-W / 2, yb + row.thickness, z0], u: '+y', v: '+x', n: '+z' }
            : { o: [-W / 2, yb, z0], u: '+z', v: '+x', n: '+y' }, [], 'exterior', { channel: 'top' }));
          return;
        }
        case 'pedestal:fb':
        case 'pedestal:side':
        case 'pedestal:brace':
        case 'kick':
          return;   // 아래에서 좌대 상자를 한꺼번에
        case 'blind': {
          // 멍가림판 MDF 2.7T — 멍 W − 목대 15 × 몸통 H, 벽 쪽 끝부터 앞선에 붙어 밖으로 (z D/2 … D/2 + 2.7)
          if (!bl || row.qty !== 1 || row.w !== bl.coverEnd || row.h !== H) { skip(row, 'blind-layout-unknown'); return; }
          parts.push(makePart(row, 0, { o: [bl.xOf(0, bl.coverEnd), 0, zFront], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { blind: 'cover' }));
          return;
        }
        case 'blindfin': {
          // 멍판 마감재 (휠라·몰딩) 150 × H × 18 — 멍가림판 위에 겹쳐 붙는다, 도어 쪽 끝 맞춤 (자리 60 + 겹침 90, §3.3.1·§3.5.1)
          if (!bl || row.qty !== 1 || row.w !== C.BLIND_FINISH_W || row.h !== H) { skip(row, 'blind-layout-unknown'); return; }
          parts.push(makePart(row, 0, { o: [bl.xOf(bl.coverEnd - row.w, bl.coverEnd), 0, zFront + C.BLIND_COVER_T], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { blind: 'finish' }));
          return;
        }
        case 'body:batten-front':
        case 'body:batten-side': {
          // ㄱ자 경첩목대 (corner.md §3.5.0) — 2026-10-22 사장님 "천판과 지판 사이에 들어감 … 목찬넬이면 따내기 70 + 밴드 = 상단에서
          //   빠진 높이": 지판 윗면(y T)에서 천판 밑(H−T), 목찬넬 몸통은 따내기 아래 앞 밴드 밑(H−T−70)까지 — 높이 = 밴드와 같다.
          //   앞다리 60×15T 는 멍판 바로 뒤(z D/2−15…D/2) 정면과 나란히, 도어 쪽 끝이 옆다리 바깥면(u coverEnd+15) 에서 멍 쪽으로 60.
          //   옆다리 60×15T 는 도어 쪽 끝(u coverEnd…coverEnd+15) 깊이 방향, 앞다리 뒤(z D/2−75…D/2−15). 앞선에서 75 (§3.5.0).
          const legH = H - 2 * T - (chanTop ? DR.CHANNEL_TOP_NOTCH_H : 0);
          if (!bl || row.qty !== 1 || row.w !== C.BLIND_BATTEN_LEG || row.thickness !== C.BLIND_BATTEN_T || row.h !== legH) { skip(row, 'blind-layout-unknown'); return; }
          const uEnd = bl.coverEnd + C.BLIND_BATTEN_T;
          if (key.family === 'body:batten-front') {
            parts.push(makePart(row, 0, { o: [bl.xOf(uEnd - row.w, uEnd), T, zFront - row.thickness], u: '+x', v: '+y', n: '+z' }, [], 'interior', { blind: 'batten-front' }));
          } else {
            parts.push(makePart(row, 0, { o: [bl.xOf(bl.coverEnd, uEnd), T, zFront - row.thickness - row.w], u: '+z', v: '+y', n: '+x' }, [], 'interior', { blind: 'batten-side' }));
          }
          return;
        }
        case 'molding': {
          // 키큰장 상부단 상몰딩 띠 (MDF 18T, 몰딩H × W) — 2026-10-20 카드 "도어 앞면 맞춤":
          //   몸통 위에 올라서고(y H…H+몰딩H), 띠 앞면 = 도어 앞면(z D/2+18), 띠 뒷면 = 몸통 앞선(z D/2).
          //   도어 두께 = 띠 두께 18 이라 도어 바로 위에 같은 면으로 선다. 3D(addCrownMolding)가 D+18 통판으로 그리는 것은
          //   BOM 과 다른 그림이고 자재 근거가 아니다.
          if (row.qty !== 1 || row.h !== W) { skip(row, 'molding-layout-unknown'); return; }
          parts.push(makePart(row, 0, { o: [-W / 2, H, zFront], u: '+y', v: '+x', n: '+z' }, [], 'exterior', { molding: true }));
          return;
        }
        default:
          skip(row, 'not-yet');
      }
    });

    // 좌대 상자 + 걸레받이 — 키큰장 바닥 단 (sink.md §5.1, 상자 구성은 붙박이장과 같다). 자리는 2026-10-20 사장님 카드
    //   "뒤 맞춤" (붙박이장·키큰장): 상자 뒷면 = 몸통 뒷면, 앞이 50 들어가고 그 자리에 걸레받이 MDF 18T (상자 앞면에 붙어 선다, 앞에 32 남음).
    const ped = keyed.filter((x) => x.key && /^pedestal:/.test(x.key.family));
    const kicks = keyed.filter((x) => x.key && x.key.family === 'kick');
    const pd = ped.length ? placePedestal(parts, ped, W, D) : null;
    if (ped.length && !pd) ped.forEach((x) => skip(x.row, 'pedestal-layout-unknown'));
    kicks.forEach(({ row }) => {
      if (!pd || row.qty !== 1 || row.h !== W || row.w !== pd.h) { skip(row, 'pedestal-layout-unknown'); return; }
      parts.push(makePart(row, 0, { o: [-W / 2, -pd.h, pd.zFront], u: '+y', v: '+x', n: '+z' }, [], 'exterior', { pedestal: true, kick: true }));
    });

    // 선반 — 높이는 부르는 쪽(플래너 구조 s.shelves)이 넘긴다. 개수가 BOM 과 다르면 놓지 않는다.
    const shelfRows = one('shelf').map((x) => x.row);
    const shelfQty = shelfRows.reduce((s, r) => s + r.qty, 0);
    if (shelfQty > 0) {
      const ys = opts.shelfY && opts.shelfY[mk];
      if (!Array.isArray(ys) || ys.length !== shelfQty) {
        shelfRows.forEach((r) => skip(r, 'shelf-height-unknown'));
      } else {
        const sorted = ys.slice().sort((a, b) => a - b);
        let i = 0;
        shelfRows.forEach((r) => {
          for (let k = 0; k < r.qty; k++, i++) {
            const yc = sorted[i];
            parts.push(makePart(r, k, { o: [-W / 2 + T, yc - r.thickness / 2, shelfZ0], u: '+x', v: '+z', n: '+y' }, [], 'interior', { shelfIdx: i }));
          }
        });
      }
    }

    const kind = mod.type === 'tall' ? 'tall' : mod.pos;
    return {
      module: {
        moduleKey: mk,
        moduleId: String(mod.id),
        kind,
        box: { W, H, D, T },
        sakuri,
        blind: bl ? { zoneW: bl.zoneW, doorW: bl.doorW, doorRight: bl.doorRight } : null,
        place: (opts.place && opts.place[mk]) || null,
        parts,
        // 서랍 박스 자리 (레일 철물이 쓴다) — x0 = 박스 왼쪽 끝, y0 = 측판 밑단, zf·z0 = 앞·뒤끝
        drawerBoxes: boxes ? boxes.map((b) => ({ x0: b.x0, y0: b.y0, zf: b.zf, z0: b.z0, outerW: b.dims.outerW, railLength: b.dims.railLength, rail: layout.rail })) : [],
        pending,
      },
      unplaced,
    };
  }

  /** 붙박이장 통의 몸통 묶음 — BOM 행의 module 이름 끝 (extractWardrobe: `${name}-상부장` · `-하부장` · `-서랍모듈`, 긴옷 통은 이름 그대로). */
  const WARDROBE_GROUP_RE = /-(상부장|하부장|서랍모듈|내부서랍모듈|좌대)$/;
  /** 아래→위 쌓는 순서 — 규칙 파일 layoutWardrobeModule: 외부 서랍 몸통이 맨 아래(y0 = 0), 그 위에 캐비닛 (cabinetsOf 0 = 하부장). */
  const WARDROBE_STACK = ['서랍모듈', '하부장', '', '상부장'];

  /**
   * 붙박이장 통 하나 — 몸통이 여럿이다 (2단 = 하부장 + 상부장, 외부 서랍 = 서랍모듈 몸통이 맨 아래).
   * 몸통마다 측판·천판·지판·뒷판은 싱크 몸통과 같은 짜임 (사쿠리면 홈 · 천지판 D − 18, 아니면 뒤에 덮음 · 측판 깊이).
   * 선반 높이 — 통 구조 블록(mod.wardrobe)이 있으면 규칙 파일 배치(layoutWardrobeModule)의 선반 자리,
   *   없는 옛 설계는 wardrobe.md §6 (shelfPositions: 긴옷은 상단 315 아래 첫 선반, 그 밖은 균등).
   * 선반은 싱크와 같이 천지판 뒤끝에 맞춘다 (§6 "천저판보다 70 짧게 — 전면 여유").
   * 도어는 좌대를 덮고 바닥에서 20, 외부 서랍 통은 서랍 몸통 위부터 (2026-10-20 카드). 서랍도어는 1~3단 (목찬넬 틈 30, 그 밖 전면 사이 4).
   *   외부 서랍 몸통은 천판이 없고 (카드 "천판 빼기") 측판 따내기 자리에 목찬넬 ㄴ자 (EP) 를 놓는다.
   *   외부 서랍 박스는 싱크 서랍 박스 짜임 (카드 "싱크 규칙"). 내부 서랍장은 도어 앞면 = 앞선 − 70 (카드 "도어 앞선−70").
   *   내부 서랍장 박스는 서랍 자리 바닥 + 30 (카드 "싱크 규칙 바닥+30").
   *   아직 자리를 정하지 않은 행: 서랍모듈 밴드, 규칙 블록이 없는 옛 내부 서랍. 좌대는 뒤 맞춤 (2026-10-20 카드). 칸막이는 규칙 파일 배치가 있을 때만 (없으면 'divider-layout-unknown').
   * @returns {{module:object, unplaced:Array}|null}
   */
  function wardrobeOf(mk, mod, rows, opts, item) {
    const keyed = rows.map((r) => ({ row: r, key: keyOfRow(r) }));
    const groupOf = (r) => { const m = String(r.module || '').match(WARDROBE_GROUP_RE); return m ? m[1] : ''; };
    const parts = [], unplaced = [], pending = [];
    const skip = (row, reason) => unplaced.push({ rowPartId: row.partId, moduleKey: mk, part: row.part, qty: row.qty, reason });

    // 몸통 — 측판 행이 있는 묶음
    const cars = [];
    for (const g of WARDROBE_STACK) {
      const mine = keyed.filter((x) => x.key && groupOf(x.row) === g);
      const fam = (f) => mine.filter((x) => x.key.family === f).map((x) => x.row);
      const sides = fam('body:side');
      if (!sides.length) continue;
      const tops = fam('body:top'), bottoms = fam('body:bottom'), backs = fam('back');
      // 서랍모듈은 천판이 없다 (2026-10-20 사장님 카드 "천판 빼기" — 싱크처럼 밴드만, 앞 위는 상단 목찬넬 ㄴ자)
      const topCount = g === '서랍모듈' ? 0 : 1;
      if (sides.length !== 1 || sides[0].qty !== 2 || tops.length !== topCount || bottoms.length !== 1 || backs.length !== 1) return null;
      const side = sides[0];
      const sakuri = /sakuri/.test(String(side.note || ''));
      const T = side.thickness, D = side.w;
      const top = tops[0] || null;
      if ((top && (top.w !== bottoms[0].w || top.h !== bottoms[0].h)) || bottoms[0].h !== D - (sakuri ? C.SAKURI_PANEL_D_MINUS : 0)) return null;
      cars.push({ group: g, rows: mine, side, top, bottom: bottoms[0], back: backs[0], sakuri, T, D, H: side.h, W: bottoms[0].w + 2 * T });
    }
    if (!cars.length || cars.some((c) => c.W !== cars[0].W || c.D !== cars[0].D || c.T !== cars[0].T)) return null;
    const { W, D, T } = cars[0];
    let y = 0;
    cars.forEach((c) => { c.y0 = y; y += c.H; });

    const ped = keyed.filter((x) => x.key && groupOf(x.row) === '좌대');
    const pedH = ped.length ? ped[0].row.h : 0;
    const drawerCar = cars.find((c) => c.group === '서랍모듈');

    // 외부 서랍 전면 자리 — 좌대를 덮고 바닥에서 20 위부터 쌓는다. 목찬넬 틈 30 자리 (2026-10-20 사장님):
    //   2단은 서랍마다 위에 하나씩, 그 밖은 목찬넬 손잡이 규칙 그대로 (서랍 규칙 assignChannels: 상단 1 + 중간 최소).
    //   목찬넬 없는 전면 사이는 싱크 규칙대로 4 (2026-10-20 카드 "4 띄움", 3단 342 × 3).
    //   BOM 은 단수 3 까지 단수만큼 전면을 낸다. 전면을 내림한 나머지가 있으면 맨 위 틈에 남는다.
    //   ys 아래→위, midBelow[i] — 위→아래 전면 i 와 i+1 사이에 틈. 측판 따내기가 같은 자리를 쓴다.
    const extFronts = (() => {
      const hit = keyed.filter((x) => x.key && x.key.family === 'drawer' && groupOf(x.row) === '서랍모듈');
      if (hit.length !== 1) return null;
      const row = hit[0].row, n = row.qty;
      if (!drawerCar || !pedH || n < 1 || n > 3 || row.w !== W - C.DOOR_GAP) return null;
      const midBelow = n === 2 ? [true] : DrawerRules.assignChannels(n);
      const slots = 1 + midBelow.filter(Boolean).length;
      const top = drawerCar.y0 + drawerCar.H;
      let yy = DR.SUPPORT_PEDESTAL_GAP - pedH;
      const ys = [];
      for (let i = n - 1; i >= 0; i--) {
        ys.push(yy);
        yy += row.h + (i > 0 ? (midBelow[i - 1] ? DR.SLOT : DR.FRONT_GAP) : 0);
      }
      const gaps = n - slots;   // 목찬넬 없는 전면 사이 — 싱크 규칙 FRONT_GAP 4 (2026-10-20 카드 "4 띄움")
      const rest = top - DR.SLOT - yy;   // 맨 위 틈 위로 남는 자리
      if (rest < 0 || rest >= n || slots * DR.SLOT + gaps * DR.FRONT_GAP + n * row.h + DR.SUPPORT_PEDESTAL_GAP + rest !== top - (-pedH)) return null;
      return { row, ys, midBelow };
    })();

    // 통 구조 블록이 있으면 BOM 과 같은 배치 (extractWardrobe 와 같은 입력)
    const WR = WardrobeRules;
    const R = WR.WARDROBE_RULES;
    const specs = (item && item.specs) || {};
    const block = mod.wardrobe ? WR.normalizeBlock(mod.wardrobe) : null;
    const layout = block && (block.preset || block.cells) ? WR.layoutWardrobeModule({
      W: parseFloat(mod.w) || R.SAMPLE_CELL_W,
      D: parseFloat(mod.d) || parseFloat(item && item.d) || R.DEFAULT_D,
      T,
      bodyH: (parseFloat(item && item.h) || R.DEFAULT_H) - (parseFloat(specs.wardrobePedestal) || R.PEDESTAL_H) - (parseFloat(specs.wardrobeMoldingH) || R.MOLDING_H),
      preset: block.preset, cells: block.cells, drawers: block.drawers, externalDrawer: block.externalDrawer,
    }) : null;
    const cabs = layout ? WR.cabinetsOf(layout) : null;
    const ourCabs = cars.filter((c) => c.group !== '서랍모듈');
    const layoutOk = !!cabs && cabs.length === ourCabs.length && cabs.every((cb, i) => cb.y0 === ourCabs[i].y0 && cb.h === ourCabs[i].H);

    cars.forEach((c, ci) => {
      const zBack = -D / 2;
      const panelZ0 = c.sakuri ? zBack + C.SAKURI_PANEL_D_MINUS : zBack;
      const tag = (t) => Object.assign({ carcass: ci }, t || {});
      const feats = c.sakuri ? [{ type: 'groove', face: 'inner', u0: C.SAKURI_FROM_BACK, u1: C.SAKURI_FROM_BACK + C.SAKURI_W, v0: 0, v1: c.H, depth: null, src: 'sakuri' }] : [];
      if (c === drawerCar && /목찬넬 따내기 상단/.test(String(c.side.note || ''))) {
        // 2026-10-20 사장님 카드 "싱크처럼 따냄": 측판 앞선 따내기 — 싱크 서랍장과 같은 짜임.
        //   상단 70×40 은 몸통 상단에서, 중간 90×40 은 위 전면 아랫단에서 20 위가 따내기 윗선 (UPPER_DROP).
        feats.push({ type: 'notch', u0: D - DR.CHANNEL_BASE_W, u1: D, v0: c.H - DR.CHANNEL_TOP_NOTCH_H, v1: c.H, src: 'channel-top' });
        if (/중간/.test(String(c.side.note || ''))) {
          if (!extFronts) pending.push('channel-mid-notch');
          else {
            const { ys, midBelow } = extFronts;
            midBelow.forEach((on, i) => {
              if (!on) return;
              const yUp = ys[ys.length - 1 - i];   // 위→아래 i 번째 전면의 아랫단
              const v1 = yUp + DR.UPPER_DROP - c.y0;
              feats.push({ type: 'notch', u0: D - DR.CHANNEL_BASE_W, u1: D, v0: v1 - DR.CHANNEL_MID_NOTCH_H, v1, src: 'channel-mid' });
            });
          }
        }
      }
      parts.push(makePart(c.side, 0, { o: [-W / 2, c.y0, zBack], u: '+z', v: '+y', n: '+x' }, feats, 'exterior', tag({ side: 'left' })));
      parts.push(makePart(c.side, 1, { o: [W / 2, c.y0, zBack], u: '+z', v: '+y', n: '-x' }, feats, 'exterior', tag({ side: 'right' })));
      parts.push(makePart(c.bottom, 0, { o: [-W / 2 + T, c.y0, panelZ0], u: '+x', v: '+z', n: '+y' }, [], 'interior', tag()));
      if (c.top) parts.push(makePart(c.top, 0, { o: [-W / 2 + T, c.y0 + c.H - T, panelZ0], u: '+x', v: '+z', n: '+y' }, [], 'interior', tag()));
      const b = c.back;
      parts.push(makePart(b, 0, { o: [-b.w / 2, c.y0 + (c.H - b.h) / 2, c.sakuri ? zBack + C.SAKURI_FROM_BACK : zBack - b.thickness], u: '+x', v: '+y', n: '+z' },
        [], 'interior', tag({ mount: c.sakuri ? 'groove' : 'behind-sides' })));

      // 선반 — 몸통 안 선반 밑면 높이 (통 좌표)
      const shelfRows = c.rows.filter((x) => x.key.family === 'shelf').map((x) => x.row);
      if (shelfRows.length) {
        const cab = c.group === '서랍모듈' ? null : cabs && cabs[ourCabs.indexOf(c)];
        let spots = null;   // [{x0, y}] 행 순서대로
        if (layout) {
          if (layoutOk && cab) {
            const pool = cab.shelves.slice();
            spots = [];
            shelfRows.forEach((r) => {
              for (let k = 0; k < r.qty; k++) {
                const i = pool.findIndex((s) => s.cutW === r.w && s.cutH === r.h);
                if (i < 0) { spots = null; return; }
                spots && spots.push({ x0: pool[i].x0, y: pool[i].y });
                pool.splice(i, 1);
              }
            });
            if (spots && pool.length) spots = null;
          }
        } else {
          const n = shelfRows.reduce((s, r) => s + r.qty, 0);
          const long = c.group === '' && (mod.moduleType || 'long') === 'long';
          const ys = WR.shelfPositions({ h: c.H - 2 * T, shelves: n, rods: long ? 1 : 0 }, { T });
          if (ys.length === n) spots = ys.slice().sort((p, q) => p - q).map((v) => ({ x0: 0, y: c.y0 + T + v }));
        }
        if (!spots || shelfRows.some((r) => r.w > W - 2 * T)) {
          shelfRows.forEach((r) => skip(r, 'shelf-height-unknown'));
        } else {
          let i = 0;
          shelfRows.forEach((r) => {
            for (let k = 0; k < r.qty; k++, i++) {
              parts.push(makePart(r, k, { o: [-W / 2 + T + spots[i].x0, spots[i].y, panelZ0], u: '+x', v: '+z', n: '+y' }, [], 'interior', tag({ shelfIdx: i })));
            }
          });
        }
      }
    });

    // 칸막이 — 규칙 파일 배치의 자리 (세로 = 지판 위~천판 아래, 수평 = 칸 사이). 깊이는 천지판과 같아 천지판 뒤끝에 맞춘다.
    const divRows = new Set();
    cars.forEach((c, ci) => {
      const rowsHere = c.rows.filter((x) => x.key.family === 'divider:v' || x.key.family === 'divider:h').map((x) => x.row);
      if (!rowsHere.length) return;
      const cab = c.group === '서랍모듈' || !layoutOk ? null : cabs[ourCabs.indexOf(c)];
      const pool = cab ? cab.dividers.slice() : [];
      const picks = rowsHere.map((r) => {
        const axis = r.partId.indexOf('divider:v') >= 0 ? 'v' : 'h';
        const i = pool.findIndex((d) => d.axis === axis && d.cutW === r.w && d.cutH === r.h);
        return i < 0 || r.qty !== 1 ? null : pool.splice(i, 1)[0];
      });
      if (!cab || picks.some((d) => !d) || pool.length) { rowsHere.forEach((r) => { divRows.add(r); skip(r, 'divider-layout-unknown'); }); return; }
      const panelZ0 = c.sakuri ? -D / 2 + C.SAKURI_PANEL_D_MINUS : -D / 2;
      rowsHere.forEach((r, i) => {
        const d = picks[i];
        divRows.add(r);
        parts.push(makePart(r, 0, d.axis === 'v'
          ? { o: [-W / 2 + T + d.x, d.y0, panelZ0], u: '+z', v: '+y', n: '+x' }
          : { o: [-W / 2 + T + d.x0, d.y, panelZ0], u: '+x', v: '+z', n: '+y' }, [], 'interior', { carcass: ci, divider: d.axis }));
      });
    });

    // 좌대 상자 — 몸통 아래 (y −h … 0). 2026-10-20 사장님 카드 "뒤 맞춤": 상자 뒷면 = 몸통 뒷면, 앞이 50 들어간다
    //   (그 자리에 걸레받이 18T). 측판은 전후판 사이, 중간보강은 폭 가운데.
    //   tags.side 를 쓰지 않는다 — 검사가 몸통 측판(side)으로 읽는다.
    const pedRows = new Set();
    if (ped.length && placePedestal(parts, ped, W, D)) ped.forEach((x) => pedRows.add(x.row));

    // 도어 — 2026-10-20 사장님 카드 "바닥 20 띄움": 좌대를 덮고 바닥에서 20 뜬다, 윗변 = 몸통 상단 (BOM 좌대H + 몸통 − 20).
    //   좌대 높이는 좌대 행 높이. 외부 서랍 몸통이 있으면 도어는 그 몸통 상단부터 (카드 "도어 1580" — 좌대 덮기는 서랍 전면 몫).
    //   높이가 그 식과 다르면 자리를 모른다.
    const doorRows = new Set();
    keyed.filter((x) => x.key && x.key.family === 'door' && groupOf(x.row) === '').forEach(({ row }) => {
      const xs = doorXsOf(W, row);
      const y0 = drawerCar ? drawerCar.y0 + drawerCar.H : DR.SUPPORT_PEDESTAL_GAP - pedH;   // 서랍 규칙: 좌대가 있으면 바닥에서 20
      if (!xs || (!pedH && !drawerCar) || row.h !== y - y0) return;
      xs.forEach((x0, k) => parts.push(makePart(row, k, { o: [x0, y0, D / 2], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { doorIdx: k })));
      doorRows.add(row);
    });

    // 외부 서랍 전면 — 위에서 푼 자리 (extFronts)
    if (extFronts) {
      const { row, ys } = extFronts;
      ys.forEach((y0, k) => parts.push(makePart(row, k, { o: [-W / 2 + C.DOOR_GAP / 2, y0, D / 2], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { drawerIdx: ys.length - 1 - k })));
      doorRows.add(row);
    }

    // 목찬넬 ㄴ자 (EP, 모듈 폭) — 서랍모듈 측판 따낸 자리 바닥에 지면판 40, 그 위 따낸 자리 안쪽 끝에 전면판 (싱크 서랍장 중간 목찬넬과 같은 짜임).
    //   상단은 서랍모듈 상단 70 따낸 자리 (2026-10-20 카드 "천판 빼기" — 천판 자리를 ㄴ 이 차지), 중간은 위 전면 아랫단 + 20 이 따낸 윗선.
    const chanRows = new Set();
    if (extFronts && drawerCar) {
      const { ys, midBelow } = extFronts;
      const top = drawerCar.y0 + drawerCar.H;
      const mids = [];
      midBelow.forEach((on, i) => { if (on) mids.push(ys[ys.length - 1 - i] + DR.UPPER_DROP - DR.CHANNEL_MID_NOTCH_H); });
      const z0 = D / 2 - DR.CHANNEL_BASE_W;
      const place = (fam, bottoms, faceH, label) => {
        const hit = keyed.filter((x) => x.key && x.key.family === fam && groupOf(x.row) === '');
        if (hit.length !== 1 || hit[0].row.qty !== bottoms.length || hit[0].row.h !== W) return;
        const row = hit[0].row;
        const face = /front$/.test(fam);
        if ((face ? row.w !== faceH : row.w !== DR.CHANNEL_BASE_W) || row.thickness !== DR.CHANNEL_T) return;
        bottoms.forEach((yb, k) => parts.push(makePart(row, k, face
          ? { o: [-W / 2, yb + row.thickness, z0], u: '+y', v: '+x', n: '+z' }
          : { o: [-W / 2, yb, z0], u: '+z', v: '+x', n: '+y' }, [], 'exterior', label === 'top' ? { channel: 'top' } : { channel: 'mid', mid: k })));
        chanRows.add(row);
      };
      if (!drawerCar.top) {
        place('channel:front', [top - DR.CHANNEL_TOP_NOTCH_H], DR.CHANNEL_TOP_FACE_H, 'top');
        place('channel:back', [top - DR.CHANNEL_TOP_NOTCH_H], DR.CHANNEL_TOP_FACE_H, 'top');
      }
      if (mids.length) {
        place('channel:mid-front', mids, DR.CHANNEL_MID_FACE_H, 'mid');
        place('channel:mid-back', mids, DR.CHANNEL_MID_FACE_H, 'mid');
      }
    }

    // 서랍모듈 밴드 2장 (W−2T × 70, 몸통 T) — 2026-10-20 사장님 "뒤 눕힘" (하부장과 같다): 천판 대신 상단 앞·뒤에 눕는다.
    //   앞 밴드는 상단 목찬넬 ㄴ자 지면판 바로 아래 (따내기 70 아래), 뒤 밴드는 윗면 = 몸통 상단, 뒤끝 — 사쿠리면 천지판처럼 홈 앞.
    const bandRows = new Set();
    if (drawerCar && !drawerCar.top) {
      const hit = drawerCar.rows.filter((x) => x.key.family === 'body:band');
      const row = hit.length === 1 ? hit[0].row : null;
      if (row && row.qty === 2 && row.w === W - 2 * T && row.h === C.BAND_W && row.thickness === T) {
        const ci = cars.indexOf(drawerCar);
        const top = drawerCar.y0 + drawerCar.H;
        const chanTop = /목찬넬 따내기 상단/.test(String(drawerCar.side.note || ''));
        const panelZ0 = drawerCar.sakuri ? -D / 2 + C.SAKURI_PANEL_D_MINUS : -D / 2;
        parts.push(makePart(row, 0, { o: [-W / 2 + T, top - (chanTop ? DR.CHANNEL_TOP_NOTCH_H : 0) - T, D / 2 - row.h], u: '+x', v: '+z', n: '+y' }, [], 'interior', { carcass: ci, end: 'front' }));
        parts.push(makePart(row, 1, { o: [-W / 2 + T, top - T, panelZ0], u: '+x', v: '+z', n: '+y' }, [], 'interior', { carcass: ci, end: 'back' }));
        bandRows.add(row);
      }
    }

    // 외부 서랍 박스 — 2026-10-20 사장님 카드 "싱크 규칙": 싱크 서랍 박스와 같은 짜임·자리 (언더레일).
    //   서랍 자리(존)는 싱크 layoutDrawerModule 과 같은 식: 위는 상단 따낸 밑선 · 중간 따낸 밑선 · 전면 사이 틈 가운데,
    //   아래는 중간 따낸 윗선 · 전면 사이 틈 가운데 · 지판 윗면. 박스 측판 밑단 = 존 바닥 + 레일 아래 여유, 가로 가운데, 앞끝 = 몸통 앞선.
    //   박스가 존에 들어가지 않으면 놓지 않는다.
    const boxRows = new Set();
    const drawerBoxes = [];   // 레일 철물 자리(hardwareOf) — 박스 외경 밑단·앞끝 (외부 서랍 + 내부 서랍장)
    if (extFronts && drawerCar) {
      const { row: frontRow, ys, midBelow } = extFronts;
      const n = ys.length;
      const top = drawerCar.y0 + drawerCar.H;
      const rail = DR.RAIL_CLEARANCE.under;
      const mineBox = drawerCar.rows.filter((x) => /^drawerbox:/.test(x.key.family));
      const sideRow = mineBox.find((x) => x.key.family === 'drawerbox:side');
      const boxes = [];
      for (let i = 0; i < n && sideRow; i++) {   // 위→아래
        const yb = ys[n - 1 - i], yt = yb + frontRow.h;
        const zoneTop = i === 0 ? top - DR.CHANNEL_TOP_NOTCH_H
          : midBelow[i - 1] ? ys[n - i] + DR.UPPER_DROP - DR.CHANNEL_MID_NOTCH_H : yt + DR.FRONT_GAP / 2;
        const zoneBottom = i < n - 1 && midBelow[i] ? yb + DR.UPPER_DROP
          : i < n - 1 ? yb - DR.FRONT_GAP / 2 : drawerCar.y0 + T;
        const dims = DrawerRules.drawerBoxDims({ W, D, bodyT: T, drawerT: sideRow.row.thickness, rail: 'under', boxH: sideRow.row.h, sakuri: false });
        const y0 = zoneBottom + rail.below;
        if (y0 + dims.sideH + rail.above > zoneTop) { boxes.length = 0; break; }
        boxes.push({ size: 'large', dims, x0: -dims.outerW / 2, y0, zf: D / 2, z0: D / 2 - dims.sideL });
      }
      const boxRowsOf = mineBox.map((x) => x.row);
      mineBox.forEach(({ row, key }) => {
        if (boxes.length && placeBoxRow(parts, row, key, boxes, false, boxRowsOf)) boxRows.add(row);
      });
      if (boxRows.size) boxes.forEach((b) => drawerBoxes.push({ x0: b.x0, y0: b.y0, zf: b.zf, z0: b.z0, outerW: b.dims.outerW, railLength: b.dims.railLength, rail: 'under' }));
    }

    // 내부 서랍장 — 규칙 파일 배치(innerDrawerLayout)의 모듈. 2026-10-20 사장님 카드 "도어 앞선−70":
    //   서랍 도어 앞면 = 통 앞선 − 70 (경첩 자리), 모듈은 그 뒤 (모듈 앞선 = 앞선 − 70 − 도어 두께), 뒤는 남는 만큼 빈다.
    //   좌우몰딩은 앞을 보고 서서 앞면 = 앞선 − 70, 상판 앞선도 앞선 − 70.
    //   높이는 규칙 그대로 — 통 지판 위(zone.y0)에 모듈, 그 위 상판, 도어는 모듈 외경 면에서 아래 2 (frontY0).
    //   가로는 통 내경 가운데, 좌우 몰딩 60. 몸통은 하부장과 같다 — 천판 없이 밴드 2장이 상단 앞·뒤에 눕는다
    //   (2026-10-20 사장님 "뒤 눕힘": 70 이 앞뒤 방향, 윗면 = 모듈 상단, 그 위에 상판).
    const innerRows = new Set();
    const zoneCab = layoutOk && cabs ? cabs.find((cb) => cb.drawerZone && cb.drawerZone.fronts && cb.drawerZone.fronts.length) : null;
    const innerHit = keyed.filter((x) => x.key && (groupOf(x.row) === '내부서랍모듈' || /^innerdrawer:/.test(x.key.family)));
    if (zoneCab && innerHit.length) {
      const z = zoneCab.drawerZone;
      const I = WR.WARDROBE_RULES.INNER_DRAWER;
      const one = (fam, g) => { const h = innerHit.filter((x) => x.key.family === fam && (g == null || groupOf(x.row) === g)); return h.length === 1 ? h[0].row : null; };
      const side = one('body:side', '내부서랍모듈'), bottom = one('body:bottom', '내부서랍모듈'), band = one('body:band', '내부서랍모듈');
      const back = one('back', '내부서랍모듈'), topP = one('top', '내부서랍모듈'), molding = one('innerdrawer:molding');
      const fronts = innerHit.filter((x) => x.key.family === 'innerdrawer:front').map((x) => x.row);
      const t = z.frontT;
      const zFace = D / 2 - I.FRONT_SETBACK;            // 도어·몰딩 앞면, 상판 앞선
      const zMod = zFace - t;                          // 모듈 앞선
      const mW = z.moduleW, mH = z.moduleH, mD = z.moduleD, y0 = z.y0;
      const frontHs = z.fronts.map((f) => f.h).sort((a, b) => a - b);
      const rowHs = [].concat(...fronts.map((r) => new Array(r.qty).fill(r.h))).sort((a, b) => a - b);
      const ok = side && side.qty === 2 && side.w === mD && side.h === mH && side.thickness === t
        && bottom && bottom.w === mW - 2 * t && bottom.h === z.panelD
        && band && band.qty === 2 && band.w === mW - 2 * t && band.h === I.BAND_H
        && back && back.w === mW - I.BACK_FLAT_W_MINUS && back.h === mH - I.BACK_H_MINUS && !I.SIDE_SAKURI
        && topP && topP.w === z.topPanelW && topP.h === z.topPanelD
        && molding && molding.qty === 2 && molding.w === z.moldingH && molding.h === z.moldingW
        && fronts.every((r) => r.w === z.frontW) && rowHs.join() === frontHs.join()
        && z.topPanelW <= W - 2 * T && zMod - mD >= -D / 2;
      if (ok) {
        // 검사는 몸통마다 측판·뒷판을 본다 — 내부 서랍장은 따로 만드는 몸통이라 carcass 'inner'
        const tag = (o) => Object.assign({ innerDrawer: true, carcass: 'inner' }, o || {});
        parts.push(makePart(side, 0, { o: [-mW / 2, y0, zMod - mD], u: '+z', v: '+y', n: '+x' }, [], 'interior', tag({ side: 'left' })));
        parts.push(makePart(side, 1, { o: [mW / 2, y0, zMod - mD], u: '+z', v: '+y', n: '-x' }, [], 'interior', tag({ side: 'right' })));
        parts.push(makePart(bottom, 0, { o: [-mW / 2 + t, y0, zMod - z.panelD], u: '+x', v: '+z', n: '+y' }, [], 'interior', tag()));
        parts.push(makePart(band, 0, { o: [-band.w / 2, y0 + mH - t, zMod - band.h], u: '+x', v: '+z', n: '+y' }, [], 'interior', tag({ end: 'front' })));
        parts.push(makePart(band, 1, { o: [-band.w / 2, y0 + mH - t, zMod - mD], u: '+x', v: '+z', n: '+y' }, [], 'interior', tag({ end: 'back' })));
        // 뒷판 — 측판 뒤 덮음 (사쿠리 없음), 위아래 가운데
        parts.push(makePart(back, 0, { o: [-back.w / 2, y0 + (mH - back.h) / 2, zMod - mD - back.thickness], u: '+x', v: '+y', n: '+z' }, [], 'interior', tag({ mount: 'behind-sides' })));
        // 상판 — 모듈 위, 통 내경 폭으로 좌우 몰딩까지 덮는다. 앞선 = 앞선 − 70, 뒤로 뻗는다
        parts.push(makePart(topP, 0, { o: [-topP.w / 2, y0 + mH, zFace - topP.h], u: '+x', v: '+z', n: '+y' }, [], 'interior', tag({ panel: 'top' })));
        // 좌우몰딩 — 모듈 옆 60 자리에 앞을 보고 선다 (u = 높이, v = 폭 60)
        [-mW / 2 - z.moldingW, mW / 2].forEach((x0, k) => parts.push(makePart(molding, k, { o: [x0, y0, zMod], u: '+y', v: '+x', n: '+z' }, [], 'exterior', tag({ end: k ? 'right' : 'left' }))));
        // 서랍 도어 — 아래에서 위로 (f.y0 는 frontY0 위), 가로 가운데
        const pool = fronts.map((r) => ({ r, k: 0 }));
        z.fronts.forEach((f) => {
          const slot = pool.find((p) => p.r.h === f.h && p.k < p.r.qty);
          parts.push(makePart(slot.r, slot.k++, { o: [-z.frontW / 2, y0 + z.frontY0 + f.y0, zMod], u: '+x', v: '+y', n: '+z' }, [], 'exterior', tag({ drawerIdx: f.idx })));
        });
        [side, bottom, band, back, topP, molding].concat(fronts).forEach((r) => innerRows.add(r));

        // 박스 — 2026-10-20 사장님 카드 "싱크 규칙 바닥+30": 서랍 자리 = 자기 도어 높이 구간 (맨 아래는 지판 윗면부터),
        //   측판 밑단 = 그 바닥 + 레일 아래 여유, 가로 가운데, 앞끝 = 모듈 앞선. 치수는 규칙 파일 박스 (innerDrawerBoxOf).
        const ys = z.fronts.map((f) => y0 + z.frontY0 + f.y0);
        const boxes = [];
        z.fronts.forEach((f, i) => {
          const b = z.boxes[i];
          if (!b || b.idx !== f.idx) return;
          const rail = DR.RAIL_CLEARANCE[b.rail];
          const bottomY = i === 0 ? y0 + t : ys[i];
          const topY = i < z.fronts.length - 1 ? ys[i + 1] : y0 + mH - t;   // 맨 위는 눕힌 밴드 아랫면
          const by = bottomY + rail.below;
          if (by + b.sideH + rail.above > topY) return;
          boxes.push({ size: b.size, dims: b, x0: -b.outerW / 2, y0: by, zf: zMod, z0: zMod - b.sideL });
        });
        if (boxes.length === z.fronts.length) {
          const boxHit = innerHit.filter((x) => groupOf(x.row) === '내부서랍모듈' && /^drawerbox:/.test(x.key.family));
          const boxRowsOf = boxHit.map((x) => x.row);
          const placedBox = boxHit.filter(({ row, key }) => {
            const n0 = parts.length;
            if (!placeBoxRow(parts, row, key, boxes, false, boxRowsOf)) return false;
            for (let k = n0; k < parts.length; k++) Object.assign(parts[k].tags, { innerDrawer: true });
            return true;
          });
          placedBox.forEach((x) => innerRows.add(x.row));
          if (placedBox.length) boxes.forEach((b) => drawerBoxes.push({ x0: b.x0, y0: b.y0, zf: b.zf, z0: b.z0, outerW: b.dims.outerW, railLength: b.dims.railLength, rail: b.dims.rail, innerDrawer: true }));
        }
      }
    }

    const placed = new Set([...divRows, ...pedRows, ...doorRows, ...chanRows, ...bandRows, ...boxRows, ...innerRows]);
    cars.forEach((c) => [c.side, c.top, c.bottom, c.back].filter(Boolean).concat(c.rows.filter((x) => x.key.family === 'shelf').map((x) => x.row)).forEach((r) => placed.add(r)));
    keyed.forEach(({ row, key }) => {
      if (placed.has(row)) return;
      if (!key) { skip(row, 'no-part-key'); return; }
      if (key.family === 'door') skip(row, 'door-layout-unknown');
      else if (key.family === 'drawer') skip(row, 'drawer-layout-unknown');
      else if (key.family === 'body:band') skip(row, 'band-position-pending');
      else skip(row, 'not-yet');
    });

    return {
      module: {
        moduleKey: mk,
        moduleId: String(mod.id),
        kind: 'wardrobe',
        box: { W, H: y, D, T },
        sakuri: cars.some((c) => c.sakuri),
        carcasses: cars.map((c, ci) => ({ carcass: ci, group: c.group || '통', y0: c.y0, h: c.H, sakuri: c.sakuri })),
        place: (opts.place && opts.place[mk]) || null,
        parts,
        pending,
        drawerBoxes,
      },
      unplaced,
    };
  }

  /**
   * 오픈장·밥솥장 상자 — 판 다섯 장 (+ 밥솥장 도어 한 장). 행 치수가 규칙 파일 모양이 아니면 null.
   */
  function openBoxOf(mk, mod, rows, opts) {
    const keyed = rows.map((r) => ({ row: r, key: keyOfRow(r) }));
    const fam = (f) => keyed.filter((x) => x.key && x.key.family === f).map((x) => x.row);
    const sides = fam('body:side'), tbs = fam('part:천지판'), backs = fam('back');
    // 홈카페장(fridge.md §11)은 천판·지판이 따로 한 장씩 — 같은 치수면 천지판 2장과 같은 상자 (측판 D+20 · 천지판 D · 18T 뒷판 측판 사이)
    const tops = fam('body:top'), bottoms = fam('body:bottom');
    const homecafe = !!(HomecafeRules && HomecafeRules.isHomecafe(mod));
    const split = tbs.length === 0 && tops.length === 1 && bottoms.length === 1 && tops[0].qty === 1 && bottoms[0].qty === 1
      && tops[0].w === bottoms[0].w && tops[0].h === bottoms[0].h && tops[0].thickness === bottoms[0].thickness;
    if (sides.length !== 1 || backs.length !== 1 || !(tbs.length === 1 || split)) return null;
    const side = sides[0], tb = split ? bottoms[0] : tbs[0], top = split ? tops[0] : tb, back = backs[0];
    const T = side.thickness, D = side.w, H = side.h, W = tb.w + 2 * T;
    if (side.qty !== 2 || (!split && tb.qty !== 2) || tb.thickness !== T || tb.h >= D
      || back.qty !== 1 || back.thickness !== T || back.w !== tb.w || back.h !== H) return null;
    const zBack = -D / 2, zFront = D / 2;
    const parts = [], unplaced = [];
    const skip = (row, reason) => unplaced.push({ rowPartId: row.partId, moduleKey: mk, part: row.part, qty: row.qty, reason });
    parts.push(makePart(side, 0, { o: [-W / 2, 0, zBack], u: '+z', v: '+y', n: '+x' }, [], 'exterior', { side: 'left' }));
    parts.push(makePart(side, 1, { o: [W / 2, 0, zBack], u: '+z', v: '+y', n: '-x' }, [], 'exterior', { side: 'right' }));
    // 천판·지판 — 측판 사이, 앞선 맞춤 (뒤에 뒷판 자리)
    parts.push(makePart(tb, 0, { o: [-W / 2 + T, 0, zFront - tb.h], u: '+x', v: '+z', n: '+y' }, [], 'interior', { panel: 'bottom' }));
    parts.push(makePart(top, split ? 0 : 1, { o: [-W / 2 + T, H - T, zFront - tb.h], u: '+x', v: '+z', n: '+y' }, [], 'interior', { panel: 'top' }));
    // 뒷판 — 18T 통판, 측판 사이 뒤끝 맞춤, 몸통 높이 전체
    parts.push(makePart(back, 0, { o: [-W / 2 + T, 0, zBack], u: '+x', v: '+y', n: '+z' }, [], 'interior', { mount: 'between-sides' }));
    keyed.forEach(({ row, key }) => {
      if (row === side || row === tb || row === top || row === back) return;
      if (!key) { skip(row, 'no-part-key'); return; }
      if (key.family === 'door') {
        const xs = doorXsOf(W, row);
        if (homecafe) {
          // 홈카페장 도어 (W−4)/n × (H+20) — 2026-10-22 사장님 카드 "아래로 20": 윗변 = 몸통 상단, 밑단이 20 아래
          const y0 = row.h > H ? H - row.h : null;
          if (!xs || y0 == null) { skip(row, 'door-layout-unknown'); return; }
          xs.forEach((x0, k) => parts.push(makePart(row, k, { o: [x0, y0, zFront], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { doorIdx: k })));
          return;
        }
        const y0 = doorYOf(mod.pos, H, row.h);
        if (!xs || xs.length !== 1 || y0 == null || row.h !== H - C.DOOR_GAP) { skip(row, 'door-layout-unknown'); return; }
        parts.push(makePart(row, 0, { o: [xs[0], y0, zFront], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { doorIdx: 0 }));
        return;
      }
      if (key.family === 'shelf') { skip(row, 'shelf-height-unknown'); return; }
      skip(row, 'not-yet');
    });
    return {
      module: {
        moduleKey: mk,
        moduleId: String(mod.id),
        kind: homecafe ? 'homecafe' : 'open',
        box: { W, H, D, T },
        sakuri: false,
        place: (opts.place && opts.place[mk]) || null,
        parts,
        pending: [],
      },
      unplaced,
    };
  }

  /**
   * 라인 부재 — 품목 단위 행(moduleKey `<품목>-ep`)을 호스트 모듈 좌표로 놓는다.
   *   lines = [{ key, D, modules: [{ moduleKey, x0, back? }] }] — 벽(배치 공간)마다, x0 = 모듈 왼쪽 끝 (벽 시작 기준 mm).
   *     back = 모듈 몸통 뒷면에서 벽까지 (mm, 배치가 정한 뒤 여유). 없으면 0 — 몸통 뒷면이 벽.
   *   구간(span) = 그 행이 세는 모듈들 — 라인 안에서 붙어 있어야 하고(사이에 안 세는 모듈이 없음), 높이가 같아야 한다.
   *   행 치수가 구간과 다르면 'run-layout-unknown' (ㄱ·ㄷ자 한 장 상판, 후드가 가운데인 상몰딩 등).
   * @returns {{runs:Array, unplaced:Array}}
   */
  function runsOf(itemIdx, rows, lines, specMods, item) {
    const mk = `${itemIdx}-ep`;
    const runs = [], unplaced = [];
    const skip = (row, reason) => unplaced.push({ rowPartId: row.partId, moduleKey: mk, part: row.part, qty: row.qty, reason });
    const specs = (item && item.specs) || {};
    const byKey = new Map(specMods.map((m) => [m.moduleKey, m]));
    const rawOf = (moduleKey) => {
      const m = String(moduleKey).match(/^\d+-(.*)$/);
      return m && item ? (item.modules || []).find((x) => String(x.id) === m[1]) : null;
    };
    const isTallTier = (mod) => !!mod && (mod.type === 'tall' || mod.blindKind === 'tall');
    const lineList = (Array.isArray(lines) ? lines : []).map((ln) => ({
      key: ln.key, D: Number(ln.D) || 0,
      // 명세 모듈이 없는 모듈(쿡탑장처럼 BOM 행이 없는 것)도 폭은 센다 — 상판이 그 위를 지난다. 호스트는 될 수 없다
      entries: (ln.modules || []).map((e) => ({ mk: String(e.moduleKey), x0: Number(e.x0) || 0, back: Math.max(0, Number(e.back) || 0), spec: byKey.get(String(e.moduleKey)) || null, mod: rawOf(e.moduleKey) }))
        .filter((e) => e.mod).map((e) => Object.assign(e, { W: e.spec ? e.spec.box.W : (Number(e.mod.w) || 0) })).sort((a, b) => a.x0 - b.x0),
    }));
    /** 한 라인에서 pred 가 세는 모듈 구간. 라인에 세는 모듈이 없으면 null. 같은 pos(하부/상부) 줄 안에서 사이에 안 세는 모듈이 있거나
     *  모듈 사이가 떨어져 있거나(빈 자리) 높이가 다르거나 첫 모듈에 명세가 없으면 { bad } — 한 장이 지나갈 수 없다 */
    const spanOf = (ln, pred) => {
      const counted = ln.entries.filter((e) => pred(e.mod));
      if (!counted.length) return null;
      const host = counted[0], last = counted[counted.length - 1];
      const lane = ln.entries.filter((e) => e.mod.pos === host.mod.pos);
      const i0 = lane.indexOf(host), i1 = lane.indexOf(last);
      const contiguous = i1 - i0 === counted.length - 1 && lane.slice(i0, i1 + 1).every((e) => pred(e.mod));
      const touching = counted.every((e, k) => k === 0 || Math.abs(counted[k - 1].x0 + counted[k - 1].W - e.x0) <= 1);
      const sameH = !!host.spec && counted.every((e) => !e.spec || e.spec.box.H === host.spec.box.H);
      return { bad: !contiguous || !touching || !sameH, host, x0: host.x0, x1: last.x0 + last.W, line: ln };
    };
    /** 품목에서 pred 구간이 꼭 한 라인에만 있어야 한다 (행이 한 장이다) */
    const onlySpan = (pred) => {
      const spans = lineList.map((ln) => spanOf(ln, pred)).filter(Boolean);
      return spans.length === 1 && !spans[0].bad ? spans[0] : null;
    };
    // 2026-10-24 D9: 하부 배치 공간 끝의 도면 마감재(비움 포함) 폭 — 상판이 그 위를 지나간다 (BOM 상판 폭과 같은 값)
    const drawnEdgeW = (edge) => (Array.isArray(specs.drawnFinishes) ? specs.drawnFinishes : [])
      .filter((f) => f && f.area === 'lower' && f.edge === edge).reduce((s, f) => s + (Number(f.W) > 0 ? Number(f.W) : 0), 0);
    const put = (row, span, frame, vis, tags) => runs.push({
      key: row.partId, lineKey: span.line.key, hostModuleKey: span.host.mk,
      parts: [makePart(row, 0, frame, [], vis, tags)],
    });
    const xOf = (span, x) => x - (span.host.x0 + span.host.spec.box.W / 2);   // 벽 x → 호스트 모듈 로컬 x
    const lowerLine = (mod) => mod.pos === 'lower' && !isTallTier(mod);
    const hasTopNotch = (e) => !!e.spec && e.spec.parts.some((p) => p.part === '측판' && (p.features || []).some((f) => f.src === 'channel-top'));

    rows.forEach((row) => {
      const key = keyOfRow(row);
      if (!key) { skip(row, 'no-part-key'); return; }
      if (!lineList.length) { skip(row, 'run-part'); return; }
      switch (key.family) {
        case 'top': {
          // 상판 — 하부 라인(쿡탑장 포함, 키큰장 단 제외) 폭 합 + 좌·우 끝 도면 마감재 폭 한 장, 뒤 = 벽, 깊이 = 행 h, 몸통 위.
          //   벽 = 호스트 몸통 뒷면 − back (2026-10-24 D3: 몸통은 벽에서 뒤 여유만큼 떠 있다, 상판은 벽까지)
          const span = onlySpan(lowerLine);
          const finL = drawnEdgeW('left'), finR = drawnEdgeW('right');
          if (!span || row.qty !== 1 || row.w !== span.x1 - span.x0 + finL + finR) { skip(row, 'run-layout-unknown'); return; }
          const b = span.host.spec.box;
          put(row, span, { o: [xOf(span, span.x0 - finL), b.H, -b.D / 2 - span.host.back], u: '+x', v: '+z', n: '+y' }, 'exterior', { run: 'top' });
          return;
        }
        case 'molding': {
          // 상몰딩 — 상부 라인(후드 제외) 위 띠, 앞면 = 도어 앞면 (키큰장 상몰딩과 같다). 2440 재단 장수 행(qty > 1)은 설치 길이가 아니다
          if (row.qty !== 1) { skip(row, 'run-cut-blank'); return; }
          const span = onlySpan((mod) => mod.pos === 'upper' && mod.type !== 'hood');
          if (!span || row.h !== span.x1 - span.x0) { skip(row, 'run-layout-unknown'); return; }
          const b = span.host.spec.box;
          put(row, span, { o: [xOf(span, span.x0), b.H, b.D / 2], u: '+y', v: '+x', n: '+z' }, 'exterior', { run: 'molding' });
          return;
        }
        case 'channel:front':
        case 'channel:back': {
          // 목찬넬 EP ㄴ자 — 하부 라인(쿡탑장·키큰장 단 제외) 측판 따내기 70×40 자리, 키큰장 단 ㄴ자와 같다
          const face = key.family === 'channel:front';
          const span = onlySpan((mod) => lowerLine(mod) && mod.type !== 'cook');
          if (!span || row.qty !== 1 || row.h !== span.x1 - span.x0 || row.w !== (face ? DR.CHANNEL_TOP_FACE_H : DR.CHANNEL_BASE_W)
            || row.thickness !== DR.CHANNEL_T || !span.line.entries.filter((e) => lowerLine(e.mod) && e.mod.type !== 'cook').every(hasTopNotch)) {
            skip(row, 'run-layout-unknown'); return;
          }
          const b = span.host.spec.box;
          const yb = b.H - DR.CHANNEL_TOP_NOTCH_H, z0 = b.D / 2 - DR.CHANNEL_BASE_W, xL = xOf(span, span.x0);
          put(row, span, face
            ? { o: [xL, yb + row.thickness, z0], u: '+y', v: '+x', n: '+z' }
            : { o: [xL, yb, z0], u: '+z', v: '+x', n: '+y' }, 'exterior', { run: 'channel', channel: 'top' });
          return;
        }
        case 'kick': {
          // 하부장 걸레받이 — 벽마다 하부 라인(쿡탑장·키큰장 단 제외) 폭 한 장, 바닥에 붙여 세운다 (행 h = 다리발 − 5, 바닥 = 몸통 바닥 − 다리발
          //   → 밑단 y = −(h + 5), 윗단 −5; 몸통 밑단과의 틈 5 는 캐쳐로 — 2026-10-22 사장님 "바닥에서 5 띄울 필요 없음"), 앞면 = 몸통 앞선 − 32 (2026-10-22 사장님 카드 "몸통 앞선에서 32 안쪽" —
          //   좌대 걸레받이와 같은 자리). 2440 을 넘는 벽은 2440 단위 조각 (extractors.js bomKickPiecesOf) — 왼쪽부터 2440, 남는 조각은
          //   오른쪽 끝 (2026-10-22 사장님 카드 "1"). BOM 행은 길이별 수량이라, 모든 벽의 조각 중 행 길이와 같은 것이 행 수량만큼이어야 한다.
          if (row.part !== '걸레받이' || row.thickness !== C.KICK_T) { skip(row, 'run-cut-blank'); return; }
          const pieces = [];
          lineList.forEach((ln) => {
            const span = spanOf(ln, (mod) => lowerLine(mod) && mod.type !== 'cook');   // BOM 벽 길이는 쿡탑장을 뺀다 (extractSink lowerModules)
            if (!span || span.bad) return;
            let x = span.x0, rest = span.x1 - span.x0;
            while (rest > C.KICK_CUT_UNIT) { pieces.push({ span, x, len: C.KICK_CUT_UNIT }); x += C.KICK_CUT_UNIT; rest -= C.KICK_CUT_UNIT; }
            if (rest > 0) pieces.push({ span, x, len: rest });
          });
          const mine = pieces.filter((pc) => pc.len === row.w);
          if (mine.length !== row.qty) { skip(row, 'run-layout-unknown'); return; }
          mine.forEach((pc, k) => {
            const b = pc.span.host.spec.box;
            runs.push({
              key: row.partId, lineKey: pc.span.line.key, hostModuleKey: pc.span.host.mk,
              parts: [makePart(row, k, { o: [xOf(pc.span, pc.x), -(row.h + C.KICK_H_MINUS), b.D / 2 - C.KICK_SETBACK - row.thickness], u: '+x', v: '+y', n: '+z' }, [], 'exterior', { run: 'kick' })],
            });
          });
          return;
        }
        case 'filler:left':
        case 'filler:right':
        case 'molding:left':
        case 'molding:right':
        case 'ep:left':
        case 'ep:right':
          // 라인 좌·우 마감재 (휠라·몰딩·EP) — 2026-10-24 사장님 D9 부터 도면(플래너에 놓은 마감재)이 정본이고 자리도 플래너가 안다.
          //   플래너 3D 는 도면 마감재를 그대로 그린다. 명세 자리(lines 에 마감재 x 를 싣는 것)는 다음 단계 — 그때까지 자리 미정.
          skip(row, 'finish-drawn-pending');
          return;
        default:
          // 코너 마감재(휠라·몰딩 코너1·2)는 꺾임 자리가 정해지지 않았다
          skip(row, /:corner\d$/.test(key.family) ? 'finish-position-pending' : 'run-part');
      }
    });
    return { runs, unplaced };
  }

  /**
   * 철물 자리 — 철물 행(HardwareExtractor)을 모듈마다 hardware[] 로 놓는다. 자리를 정할 근거가 없는 것은 at: null 에 pending 이유.
   *   다리발  하부 모듈마다 폭으로 4·6·8 (extractLegs 와 같은 셈). 4 코너 = 플래너 3D addLegs 자리 (외곽에서 25 안쪽, 42 각, 앞줄은 걸레받이 뒤),
   *           밑면 = 바닥 (y −다리발). 6·8개면 가운데 다리를 앞줄·뒷줄마다 두 코너 사이 균등 분할 (2026-10-23 4-1 B, tags.side midFront·midBack).
   *   경첩    도어마다 (행 boring[] = 도어 상단에서 컵 중심까지, hardware.md §1 끝 110). 경첩 변 — 양문은 왼 도어 왼쪽·오른 도어 오른쪽,
   *           멍장 도어는 목대 쪽, 플랩은 윗변, 외짝 여닫이는 설계 mod.hingeSide 'left'|'right' (2026-10-23 4-1 C) — 없으면 'hinge-side-unknown'.
   *           변이 정해지면 컵마다 한 항목: at = 컵 중심 (도어 뒷면), 변에서 backset 21.5 (가장자리 4), 깊이 12.5 (2026-10-23 4-1 A).
   *   레일    서랍 박스마다 2개 (왼·오). 언더레일은 박스 측판 밑 여유 30 (bom-drawer-rules RAIL_CLEARANCE.under.below) 에, 앞끝 = 박스 앞끝,
   *           길이 = 규격. 볼레일은 측판 옆 두께 14, 밑단 = 박스 측판 밑단 (2026-10-23 4-1 D). 박스를 못 놓아 자리가 없는 몸통 → 'rail-box-unknown'.
   *   수량이 모듈·도어·박스 수와 맞지 않는 행은 전부 'hardware-count-mismatch'.
   */
  function hardwareOf(itemIdx, item, hwRows, modules, label) {
    const byKey = new Map(modules.map((m) => [m.moduleKey, m]));
    modules.forEach((m) => { m.hardware = m.hardware || []; });
    const specs = (item && item.specs) || {};
    const legH = parseFloat(specs.sinkLegHeight) || 150;
    const rawOf = (moduleKey) => { const mm = String(moduleKey).match(/^\d+-(.*)$/); return mm ? (item.modules || []).find((x) => String(x.id) === mm[1]) : null; };
    const isTallTier = (mod) => !!mod && (mod.type === 'tall' || mod.blindKind === 'tall');
    // 2026-10-24 사장님 (모듈 라이브러리 Q2 "BOM 먼저"): 하부 섹션에 바닥 다리발로 서는 상자 모듈(오픈장 · 홈카페)도
    //   일반 하부장과 같은 4모서리 다리발. 브리지가 하부 섹션 모듈에만 heightParts.legH 를 준다 — 키큰장 단의 상자는 좌대가 받친다.
    const boxOnLegs = (m, mod) => (m.kind === 'open' || m.kind === 'homecafe')
      && !!(mod && mod.heightParts && Number(mod.heightParts.legH) > 0);
    hwRows.forEach((row, hwIdx) => {
      const base = { hwIdx, category: row.category, item: row.item, spec: row.spec };
      const push = (m, e) => m.hardware.push(Object.assign({}, base, e));
      if (row.category === '다리발') {
        // 품목 단위 행 — 라벨로 품목을 찾는다 (extractLegs: pos lower, 키큰장 단 제외 — 좌대가 받친다, sink.md §5)
        //   2026-10-24: 싱크도 키큰장 단을 세지 않는다 (예전엔 단순 카테고리만 뺐다)
        if (row.moduleKey || (row.itemLabel && label && row.itemLabel !== label)) return;
        const lowers = (item.modules || []).filter((mod) => mod.pos === 'lower' && !isTallTier(mod));
        const countOf = (mod) => { const w = parseFloat(mod.w) || 600; return w <= 600 ? 4 : w <= 900 ? 6 : 8; };
        const total = lowers.reduce((a, mod) => a + countOf(mod), 0);
        lowers.forEach((mod) => {
          const m = byKey.get(`${itemIdx}-${mod.id}`);
          if (!m) return;
          const n = countOf(mod);
          if (total !== row.qty) { push(m, { kind: 'leg', qty: n, at: null, pending: 'hardware-count-mismatch' }); return; }
          if (isTallTier(mod) || (m.kind !== 'lower' && !boxOnLegs(m, mod))) { push(m, { kind: 'leg', qty: n, at: null, pending: 'leg-tall-tier' }); return; }
          const b = m.box, half = C.LEG_SIZE / 2;
          const xs = [-b.W / 2 + C.LEG_INSET + half, b.W / 2 - C.LEG_INSET - half];
          const zFront = b.D / 2 - C.KICK_SETBACK - C.KICK_T - half, zBack = -b.D / 2 + C.LEG_INSET + half;
          const leg = (x, z, tags) => push(m, { kind: 'leg', at: [x, -legH, z], size: [C.LEG_SIZE, legH, C.LEG_SIZE], tags });
          [[xs[0], zFront, 'leftFront'], [xs[0], zBack, 'leftBack'], [xs[1], zFront, 'rightFront'], [xs[1], zBack, 'rightBack']]
            .forEach(([x, z, side]) => leg(x, z, { side }));
          // 가운데 다리발 (6·8개) — 앞줄·뒷줄마다 두 코너 다리 중심 사이를 균등 분할 (2026-10-23 사장님 4-1 B)
          const perRow = n / 2;
          for (let i = 1; i < perRow - 1; i++) {
            const x = xs[0] + ((xs[1] - xs[0]) * i) / (perRow - 1);
            leg(x, zFront, { side: 'midFront', mid: i });
            leg(x, zBack, { side: 'midBack', mid: i });
          }
        });
        return;
      }
      const m = row.moduleKey ? byKey.get(String(row.moduleKey)) : null;
      if (!m) return;
      if (row.category === '경첩') {
        const doors = m.parts.filter((p) => p.tags && p.tags.doorIdx !== undefined && /도어$/.test(p.part));
        const cups = Array.isArray(row.boring) ? row.boring.slice() : [];
        if (!doors.length || !cups.length || doors.length * cups.length !== row.qty) { push(m, { kind: 'hinge', qty: row.qty, at: null, pending: 'hardware-count-mismatch' }); return; }
        const mod = rawOf(m.moduleKey);
        const hingeSide = mod && ['left', 'right'].includes(mod.hingeSide) ? mod.hingeSide : null;
        const backset = C.HINGE_CUP_EDGE + C.HINGE_CUP_D / 2;
        doors.forEach((d, k) => {
          let edge = null;
          if (row.boringSide === 'top') edge = 'top';
          else if (doors.length === 2) edge = k === 0 ? 'left' : 'right';
          else if (d.tags.blind && m.blind) edge = m.blind.doorRight ? 'left' : 'right';
          else if (doors.length === 1) edge = hingeSide;   // 외짝 — 설계의 좌개/우개 (2026-10-23 사장님 4-1 C)
          const hinge = { kind: 'hinge', partId: d.id, doorIdx: d.tags.doorIdx, edge, cupD: C.HINGE_CUP_D };
          if (!edge) { push(m, Object.assign(hinge, { qty: cups.length, cups, at: null, pending: 'hinge-side-unknown' })); return; }
          // 컵마다 한 항목 — at = 컵 중심, 도어 뒷면 위 (컵은 거기서 앞으로 depth 만큼 판다). 컵 중심은 경첩 변에서 backset (2026-10-23 4-1 A).
          //   cup = 행 boring 값 — 옆 변이면 도어 상단에서, 윗변(플랩)이면 도어 왼쪽 끝에서.
          const bx = d.box;
          cups.forEach((c, ci) => {
            const at = edge === 'top' ? [bx.min[0] + c, bx.max[1] - backset, bx.min[2]]
              : [edge === 'left' ? bx.min[0] + backset : bx.max[0] - backset, bx.max[1] - c, bx.min[2]];
            push(m, Object.assign({}, hinge, { cupIdx: ci, cup: c, backset, depth: C.HINGE_CUP_DEPTH, at }));
          });
        });
        return;
      }
      if (row.category === '레일') {
        const boxes = m.drawerBoxes || [];
        const len = parseFloat(row.spec);
        if (!boxes.length) { push(m, { kind: 'rail', qty: row.qty, at: null, pending: 'rail-box-unknown' }); return; }   // 박스를 못 놓은 몸통 — 박스 자리가 없다
        if (boxes.length !== row.qty || !boxes.every((b) => b.railLength === len)) { push(m, { kind: 'rail', qty: row.qty, at: null, pending: 'hardware-count-mismatch' }); return; }
        boxes.forEach((b, bi) => {
          if (b.rail === 'ball') {
            // 볼레일 — 박스 측판 바깥 옆에 두께 14, 밑단 = 박스 측판 밑단 (2026-10-23 사장님 4-1 D). at x = 측판 바깥면 (레일은 거기서 밖으로 thickness)
            const t = DR.RAIL_CLEARANCE.ball.thickness;
            push(m, { kind: 'rail', at: [-b.outerW / 2, b.y0, b.zf - len], len, thickness: t, tags: { box: bi, side: 'left', rail: 'ball' } });
            push(m, { kind: 'rail', at: [b.outerW / 2, b.y0, b.zf - len], len, thickness: t, tags: { box: bi, side: 'right', rail: 'ball' } });
            return;
          }
          const y = b.y0 - DR.RAIL_CLEARANCE.under.below;
          push(m, { kind: 'rail', at: [-b.outerW / 2, y, b.zf - len], len, tags: { box: bi, side: 'left' } });
          push(m, { kind: 'rail', at: [b.outerW / 2, y, b.zf - len], len, tags: { box: bi, side: 'right' } });
        });
      }
    });
  }

  /**
   * 조립 명세를 만든다.
   * @param {{items:Array}} design   MaterialExtractor 에 넣는 것과 같은 설계
   * @param {object} [opts]
   *   materials   이미 뽑은 BOM 행 (없으면 MaterialExtractor 로 뽑는다)
   *   shelfY      { [moduleKey]: number[] } 선반 중심 높이 (몸통 바닥에서, mm)
   *   place       { [moduleKey]: {...} } 모듈을 세우는 자리 — 그대로 싣는다
   *   lines       { [itemIdx]: [{ key, D, modules: [{ moduleKey, x0, back? }] }] } 벽(배치 공간)마다 모듈 왼쪽 끝 x0 · 몸통 뒤 여유 back — 라인 부재(runsOf) 자리
   *   hardware    이미 뽑은 철물 행 (없으면 HardwareExtractor 로 뽑는다; 추출기가 없으면 hardware[] 는 빈다)
   */
  function of(design, opts) {
    const o = opts || {};
    let materials = o.materials;
    if (!materials) {
      const ME = root.MaterialExtractor
        || (typeof require === 'function' ? require('./extractors.js').MaterialExtractor : null);
      materials = new ME().extract(design).materials;
    }
    let hardware = o.hardware;
    if (!hardware) {
      const HE = o.HardwareExtractor || root.HardwareExtractor
        || (typeof require === 'function' ? require('./extractors.js').HardwareExtractor : null);
      hardware = HE ? new HE().extract(design).hardware : [];
    }
    const items = (design && design.items) || [];
    const byModule = new Map();
    materials.forEach((r) => {
      const mk = String(r.moduleKey || '');
      if (!byModule.has(mk)) byModule.set(mk, []);
      byModule.get(mk).push(r);
    });

    const outItems = items.map((item, itemIdx) => ({ itemIdx, label: (materials.find((r) => String(r.moduleKey || '').indexOf(itemIdx + '-') === 0) || {}).itemLabel || '', modules: [], runs: [] }));
    const unplaced = [];
    const epRows = new Map();   // itemIdx → 품목 단위 행 — 모듈이 다 선 뒤 runsOf
    byModule.forEach((rows, mk) => {
      const m = mk.match(/^(\d+)-(.*)$/);
      const itemIdx = m ? Number(m[1]) : -1;
      const item = items[itemIdx];
      if (m && m[2] === 'ep' && item) { epRows.set(itemIdx, rows); return; }
      const mod = item && (item.modules || []).find((x) => String(x.id) === m[2]);
      const blind = mod && String(mod.id).indexOf('corner-blind-') === 0;
      const wardrobe = mod && (item.categoryId || item.category) === 'wardrobe' && (mod.pos === 'wardrobe' || mod.pos === 'tall');
      const openBox = mod && ((OpenRules && OpenRules.isOpenCabinet(mod)) || (RiceRules && RiceRules.isRiceCabinet(mod))
        || (HomecafeRules && HomecafeRules.isHomecafe(mod)));
      // 옛 냉장고장 화면 모듈(pos 없음, type) — 짜임 자리를 FRIDGE_TYPE_POS 로 읽는다 (상부장·하부장 짜임). 플래너 냉장고장은 pos 가 있다.
      const fridgePos = mod && !mod.pos && (item.categoryId || item.category) === 'fridge' ? FRIDGE_TYPE_POS[String(mod.type || '')] : null;
      const shellMod = fridgePos ? Object.assign({}, mod, { pos: fridgePos }) : mod;
      const res = openBox ? openBoxOf(mk, mod, rows, o)
        : wardrobe ? wardrobeOf(mk, mod, rows, o, item)
        : (shellMod && SHELL_POS.indexOf(shellMod.pos) >= 0) ? shellOf(mk, shellMod, rows, o, item) : null;
      if (!res) {
        const reason = !mod ? (m && m[2] === 'ep' ? 'run-part' : 'no-module') : blind ? 'blind-layout-unknown' : 'module-not-yet';
        rows.forEach((r) => unplaced.push({ rowPartId: r.partId, moduleKey: mk, part: r.part, qty: r.qty, reason }));
        return;
      }
      outItems[itemIdx].modules.push(res.module);
      res.unplaced.forEach((u) => unplaced.push(u));
    });
    epRows.forEach((rows, itemIdx) => {
      const r = runsOf(itemIdx, rows, o.lines && o.lines[itemIdx], outItems[itemIdx].modules, items[itemIdx]);
      outItems[itemIdx].runs = r.runs;
      r.unplaced.forEach((u) => unplaced.push(u));
    });
    outItems.forEach((it) => {
      const mine = (hardware || []).filter((h) => (h.moduleKey ? String(h.moduleKey).indexOf(it.itemIdx + '-') === 0 : h.itemLabel === it.label));
      hardwareOf(it.itemIdx, items[it.itemIdx], mine, it.modules, it.label);
    });

    return {
      schema: SCHEMA,
      rulesVersion: AsmRules.RULES_VERSION,
      units: 'mm',
      items: outItems,
      unplaced,
    };
  }

  return { SCHEMA, AXES, of, solidsOf, boxOfFrame, keyOfRow };
});
