/**
 * 현장 재단 막대 규칙 — 목찬넬 · 걸레받이 · 상몰딩 (2026-11-21 사장님 확정).
 *
 *   사장님: 「재단에서 목찬넬은 40+52+여유로 100으로 재단되어야해. 60이하는 엣지바르기가 너무 어려워. 100으로 엣지를 바른 후
 *            재단 해야되니까. 100으로 해줘. 그리고 목찬넬, 걸레받이, 상몰딩은 현장에서 재단 해야하니까. 미리 재단하지 않았으면 좋겠음.」
 *   질문 창: 100 막대는 「공장에서 켬」(엣지 뒤 52 · 40 으로) · 중간 목찬넬 「120」(40 + 72) · 범위 「모두 막대」(줄 부재도 모듈 안 것도).
 *
 * BOM 추출기(extractors.js)는 지금처럼 **조각 행**을 낸다 — 조립 명세 · 3D · 현장 재단표가 조각(붙는 자리 · 길이)을 쓴다.
 * 재단 · 발주 · 엣지 · 금액에 쓰는 BOM 은 설계 한 벌을 모은 뒤 이 파일 siteBarsOf 로 조각을 막대로 바꾼다:
 *
 *   막대                 원래 조각 행                         막대 폭               길이 쪽
 *   목찬넬 막대          목찬넬(전면) 52 + 목찬넬(지면) 40    100 (CHANNEL_BAR_W.top)  h
 *   중간 목찬넬 막대     목찬넬(중간 전면) 72 + (중간 지면) 40 120 (CHANNEL_BAR_W.mid)  h
 *   걸레받이             걸레받이 (조각 길이 × 다리발 − 5)     행 h                  w
 *   좌대 걸레받이        좌대 걸레받이 (좌대 H × 폭)           행 w                  h
 *   상몰딩               상몰딩 (몰딩 H × 조각 길이)           행 w                  h
 *
 *   막대 = MDF 18T × 막대 폭 × 2440, 엣지 2면(장) (긴 두 변 — 양끝은 현장에서 자른다).
 *   목찬넬 막대는 엣지를 바른 뒤 공장에서 전면 · 지면으로 켠다 — 전면 · 지면 행은 한 쌍이라 전면 조각만 센다 (지면 행은 같이 사라진다).
 *   막대 수 = 조각 길이를 2440 에 큰 것부터 채워 넣은 수 (조각 사이 톱날 KERF — 재단 엔진 nesting-engine.js DEFAULT_KERF 와 같은 값).
 *   조각 길이 = 행 길이(발주 길이) × 수량 — 800 보다 짧은 조각은 800 (assembly-rules LINE_PIECE_MIN, 2026-10-26 사장님 "최소 800").
 *   같은 막대: 종류 · 자재 · 두께 · 막대 폭 · 마감 코드 · 색이 같은 것.
 *
 * 순수 함수만 있다 — DOM·전역 상태 없음. 브라우저는 전역 `DadamSiteBarRules`, Node(Jest)는 module.exports.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DadamSiteBarRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DR = (root.DadamDrawerRules || (typeof require === 'function' ? require('./bom-drawer-rules.js') : null)).DRAWER_RULES;

  const SITE_BAR_RULES = Object.freeze({
    LEN: 2440,
    KERF: 4,
    EDGE: '2면(장)',
    MODULE: '현장 재단 막대',
    KINDS: Object.freeze([
      Object.freeze({ key: 'channel', lead: '목찬넬(전면)', pair: '목찬넬(지면)', part: '목찬넬 막대', barW: DR.CHANNEL_BAR_W.top, lenAxis: 'h',
        note: `엣지 뒤 공장에서 전면 ${DR.CHANNEL_TOP_FACE_H} · 지면 ${DR.CHANNEL_BASE_W} 으로 켬 · 길이는 현장 재단` }),
      Object.freeze({ key: 'channel-mid', lead: '목찬넬(중간 전면)', pair: '목찬넬(중간 지면)', part: '중간 목찬넬 막대', barW: DR.CHANNEL_BAR_W.mid, lenAxis: 'h',
        note: `엣지 뒤 공장에서 전면 ${DR.CHANNEL_MID_FACE_H} · 지면 ${DR.CHANNEL_BASE_W} 으로 켬 · 길이는 현장 재단` }),
      Object.freeze({ key: 'kick', lead: '걸레받이', part: '걸레받이', barW: null, lenAxis: 'w', note: '길이는 현장 재단' }),
      Object.freeze({ key: 'pedestal-kick', lead: '좌대 걸레받이', part: '좌대 걸레받이', barW: null, lenAxis: 'h', note: '길이는 현장 재단' }),
      Object.freeze({ key: 'molding', lead: '상몰딩', part: '상몰딩', barW: null, lenAxis: 'h', note: '길이는 현장 재단' }),
    ]),
  });

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const isMdf18 = (r) => String(r.material || '') === 'MDF' && num(r.thickness != null ? r.thickness : r.t) === 18;

  /** 행이 어느 막대 종류인지 — {kind, role:'lead'|'pair'} 또는 null */
  function kindOfRow(r) {
    if (!r || !isMdf18(r)) return null;
    for (const k of SITE_BAR_RULES.KINDS) {
      if (r.part === k.lead) return { kind: k, role: 'lead' };
      if (k.pair && r.part === k.pair) return { kind: k, role: 'pair' };
    }
    return null;
  }

  /** 조각 길이들 — 행 길이 × 수량 */
  function lensOfRow(r, k) {
    const qty = Math.max(0, Math.round(num(r.qty)));
    const len = num(k.lenAxis === 'w' ? r.w : r.h);
    return Array.from({ length: qty }, () => len);
  }

  /** 막대 폭 — 목찬넬은 규칙 값, 나머지는 행의 폭 쪽 */
  function barWOf(r, k) {
    return k.barW != null ? k.barW : num(k.lenAxis === 'w' ? r.h : r.w);
  }

  /**
   * 조각 길이를 막대에 큰 것부터 채운다 (First Fit Decreasing, 조각 사이 톱날 kerf).
   * @returns {{bars:number[][], over:number[]}}  bars = 막대마다 조각 길이, over = 막대보다 긴 조각
   */
  function packBars(lens, barLen, kerf) {
    const L = barLen != null ? barLen : SITE_BAR_RULES.LEN;
    const K = kerf != null ? kerf : SITE_BAR_RULES.KERF;
    const bars = [];
    const used = [];
    const over = [];
    lens.slice().sort((a, b) => b - a).forEach((len) => {
      if (len > L) { over.push(len); return; }
      let i = used.findIndex((u) => u + K + len <= L);
      if (i < 0) { bars.push([]); used.push(-K); i = bars.length - 1; }
      bars[i].push(len);
      used[i] += K + len;
    });
    return { bars, over };
  }

  /**
   * 조각 행을 막대 행으로 — 설계 한 벌의 BOM 행 전부를 받는다.
   * @param {object[]} rows  BOM 행 (part · material · thickness(또는 t) · w · h · qty · finishCode · color · partId · edgeT · slot …)
   * @param {{kerf?:number, colorOf?:(r:object)=>string}} [opts]
   * @returns {{rows:object[], pieces:object[], bars:object[]}}
   *   rows = 막대로 바꾼 BOM (막대 행은 그 종류의 첫 조각 행 자리에), pieces = 막대로 들어간 원래 조각 행, bars = 막대 행
   *   막대 행: part · material 'MDF' · thickness 18 · w 막대 폭 · h 2440 · qty 막대 수 · edge 2면(장) · note ·
   *            siteBar {kind, barLen, kerf, pieces:[{len, partId, module}], layout:[[len…]…], over:[len…]}
   */
  function siteBarsOf(rows, opts) {
    const o = opts || {};
    const kerf = o.kerf != null ? Number(o.kerf) : SITE_BAR_RULES.KERF;
    const colorOf = typeof o.colorOf === 'function' ? o.colorOf : (r) => String(r.color || '');
    const groups = new Map();
    const pieces = [];
    const out = [];
    (rows || []).forEach((r) => {
      const hit = kindOfRow(r);
      if (!hit) { out.push(r); return; }
      pieces.push(r);
      if (hit.role === 'pair') return;   // 목찬넬 지면 — 전면과 한 막대에서 켠다
      const k = hit.kind;
      const barW = barWOf(r, k);
      const key = [k.key, r.material, 18, barW, r.finishCode || '', colorOf(r)].join('|');
      if (!groups.has(key)) {
        const g = { kind: k, barW, first: r, list: [] };
        groups.set(key, g);
        out.push(g);   // 자리 표시 — 아래에서 막대 행으로 바뀐다
      }
      const g = groups.get(key);
      lensOfRow(r, k).forEach((len) => g.list.push({ len, partId: r.partId || r.pid || '', module: r.module || '' }));
    });
    const bars = [];
    let seq = 0;
    const result = out.map((x) => {
      if (!x || !x.kind || !x.list) return x;
      const k = x.kind;
      const pk = packBars(x.list.map((p) => p.len), SITE_BAR_RULES.LEN, kerf);
      const qty = pk.bars.length + pk.over.length;
      const total = x.list.reduce((s, p) => s + p.len, 0);
      const note = [k.note, `조각 ${x.list.length}개 · 길이 합 ${Math.round(total)}`,
        pk.over.length ? `[확인 필요] ${SITE_BAR_RULES.LEN} 보다 긴 조각 ${pk.over.join(' · ')}` : ''].filter(Boolean).join(' · ');
      const f = x.first;
      const row = Object.assign({}, f, {
        module: SITE_BAR_RULES.MODULE,
        part: k.part,
        material: 'MDF',
        w: x.barW,
        h: SITE_BAR_RULES.LEN,
        qty,
        edge: SITE_BAR_RULES.EDGE,
        edges: { L: true, R: true, T: false, B: false },
        edgeLen: 2 * SITE_BAR_RULES.LEN,
        note,
        partId: `bar-${k.key}-${seq++}`,
        siteBar: { kind: k.key, barLen: SITE_BAR_RULES.LEN, kerf, pieces: x.list, layout: pk.bars, over: pk.over },
      });
      if ('thickness' in f) row.thickness = 18;
      if ('t' in f) row.t = 18;
      if ('pid' in f) row.pid = row.partId;
      bars.push(row);
      return row;
    });
    return { rows: result, pieces, bars };
  }

  return { SITE_BAR_RULES, kindOfRow, packBars, siteBarsOf };
});
