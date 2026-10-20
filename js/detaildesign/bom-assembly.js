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
 *   서랍장   전면(도어·서랍도어) · 중간 목찬넬 ㄴ자 · 측판 중간 따내기 — 서랍 레이아웃 (drawerLayoutOf, 플래너 frontSpanOf · addMidChannels)
 *   선반     측판 사이. 깊이가 "측판 깊이 − T (처짐방지목 몫)" 이라 처짐방지목 **뒤**에 놓인다 — 뒤로 붙인다
 *            (사쿠리면 홈 앞, 아니면 측판 뒤끝). 높이는 부르는 쪽이 넘긴 선반 중심 높이(opts.shelfY)를 쓴다
 *
 * 미정 (지금 BOM 동작을 그대로 두고 결과에 적는다):
 *   하부장·키큰장 단 밴드 2장 — 자리 미정, 사장님 확인 대기 → unplaced 'band-position-pending'
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
  const C = AsmRules.CARCASS;
  const DR = DrawerRules.DRAWER_RULES;

  const SCHEMA = 'dadam.assembly/1';

  /** 이번 단계에서 자리를 정하는 모듈 — 상세설계 모듈 pos. */
  const SHELL_POS = ['upper', 'lower'];

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
  function drawerLayoutOf(mod, H, T, opts) {
    const ME = (opts && opts.MaterialExtractor) || root.MaterialExtractor
      || (typeof require === 'function' ? require('./extractors.js').MaterialExtractor : null);
    return ME ? new ME().drawerLayoutOf(mod, H, T) : null;
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
   * 한 모듈의 몸통. 지원하지 못하면 null (행은 모두 unplaced 로).
   * @returns {{module:object, unplaced:Array}|null}
   */
  function shellOf(mk, mod, rows, opts) {
    const keyed = rows.map((r) => ({ row: r, key: keyOfRow(r) }));
    const one = (fam) => keyed.filter((x) => x.key && x.key.family === fam);
    const sides = one('body:side'), bottoms = one('body:bottom');
    if (sides.length !== 1 || sides[0].row.qty !== 2 || bottoms.length !== 1) return null;

    const side = sides[0].row, bottom = bottoms[0].row;
    const T = side.thickness;
    const D = side.w, H = side.h;
    const W = bottom.w + 2 * T;
    const sakuri = /sakuri/.test(String(side.note || ''));
    const zBack = -D / 2, zFront = D / 2;
    const panelZ0 = sakuri ? zBack + C.SAKURI_PANEL_D_MINUS : zBack;   // 천지판 뒤끝 (앞선 맞춤)
    const shelfZ0 = sakuri ? zBack + C.SAKURI_PANEL_D_MINUS : zBack;   // 선반은 뒤로 붙인다
    const parts = [], unplaced = [], pending = [];
    const layout = mod.isDrawer ? drawerLayoutOf(mod, H, T, opts) : null;
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
          // 2026-10-20 사장님: 상부장 보강목 2장은 사쿠리 홈 뒤 — 장의 맨 뒤, 판이 서서 뒤를 본다.
          //   아래 1장은 지판 바로 위, 위 1장은 천판 바로 아래. 하부장 밴드 자리는 아직 미정.
          if (row.part !== '밴드(보강목)' || !sakuri || row.qty !== 2) { skip(row, 'band-position-pending'); return; }
          //   판은 몸통과 상관없이 15T (2026-10-20 사장님 "15T 고정") — 홈 뒤 15 자리에 맞는다.
          [T, H - T - row.h].forEach((y0, k) => {
            parts.push(makePart(row, k, { o: [-W / 2 + T, y0, zBack], u: '+x', v: '+y', n: '+z' }, [], 'interior', { mount: 'behind-groove' }));
          });
          return;
        }
        case 'door': {
          // 여닫이 도어 — 플래너 addFrontPanel 과 같은 자리 (mockup-structure.html, 3D 장면과 대조 시험).
          //   앞뒤: 측판 앞선에 붙어 밖으로 (z = D/2 … D/2 + 두께). 서랍장 도어는 서랍 레이아웃 몫 (PR9 다음).
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
        default:
          skip(row, 'not-yet');
      }
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
        place: (opts.place && opts.place[mk]) || null,
        parts,
        pending,
      },
      unplaced,
    };
  }

  /**
   * 조립 명세를 만든다.
   * @param {{items:Array}} design   MaterialExtractor 에 넣는 것과 같은 설계
   * @param {object} [opts]
   *   materials   이미 뽑은 BOM 행 (없으면 MaterialExtractor 로 뽑는다)
   *   shelfY      { [moduleKey]: number[] } 선반 중심 높이 (몸통 바닥에서, mm)
   *   place       { [moduleKey]: {...} } 모듈을 세우는 자리 — 그대로 싣는다
   */
  function of(design, opts) {
    const o = opts || {};
    let materials = o.materials;
    if (!materials) {
      const ME = root.MaterialExtractor
        || (typeof require === 'function' ? require('./extractors.js').MaterialExtractor : null);
      materials = new ME().extract(design).materials;
    }
    const items = (design && design.items) || [];
    const byModule = new Map();
    materials.forEach((r) => {
      const mk = String(r.moduleKey || '');
      if (!byModule.has(mk)) byModule.set(mk, []);
      byModule.get(mk).push(r);
    });

    const outItems = items.map((item, itemIdx) => ({ itemIdx, label: (materials.find((r) => String(r.moduleKey || '').indexOf(itemIdx + '-') === 0) || {}).itemLabel || '', modules: [] }));
    const unplaced = [];
    byModule.forEach((rows, mk) => {
      const m = mk.match(/^(\d+)-(.*)$/);
      const itemIdx = m ? Number(m[1]) : -1;
      const item = items[itemIdx];
      const mod = item && (item.modules || []).find((x) => String(x.id) === m[2]);
      const blind = mod && String(mod.id).indexOf('corner-blind-') === 0;
      const res = (mod && SHELL_POS.indexOf(mod.pos) >= 0 && !blind) ? shellOf(mk, mod, rows, o) : null;
      if (!res) {
        const reason = !mod ? (m && m[2] === 'ep' ? 'run-part' : 'no-module') : blind ? 'blind-pending' : 'module-not-yet';
        rows.forEach((r) => unplaced.push({ rowPartId: r.partId, moduleKey: mk, part: r.part, qty: r.qty, reason }));
        return;
      }
      outItems[itemIdx].modules.push(res.module);
      res.unplaced.forEach((u) => unplaced.push(u));
    });

    return {
      schema: SCHEMA,
      rulesVersion: AsmRules.RULES_VERSION,
      units: 'mm',
      items: outItems,
      unplaced,
    };
  }

  return { SCHEMA, of, solidsOf, boxOfFrame, keyOfRow };
});
