/* global module */
/**
 * C1a: 도면(3D) ↔ BOM 원장 대조 — 순수 함수.
 *
 * 입력은 `scene-parts.js` / `bom-parts.js` 가 낸 정규화 행이고, 둘 다 `{ moduleId, family, a, b, t, qty }` 를 갖는다.
 * 대조 단위는 **(플래너 모듈, 부재 종류 family)** 다. 그 단위 안에서 판 치수 다중집합을 맞춰 본다.
 *
 * 차이 네 종류:
 *   only3d     3D 에는 있는데 BOM 에 없는 종류 — 3D 만 그리는 것(먹장·상판·좌대)이거나 BOM 누락
 *   onlyBom    BOM 에는 있는데 3D 에 없는 종류 — 3D 가 안 그리는 것(밴드·좌우 마감)이거나 3D 누락
 *   dims       종류는 같은데 치수/수량 다중집합이 ±1mm 안에서 안 맞는다 (w/h 는 순서 없는 쌍)
 *   thickness  치수·수량은 맞는데 두께가 다르다 (예: 뒷판 3D 15 · BOM 2.7)
 *
 * 차이 하나의 id 는 `${fixture}|${moduleId}|${family}|${kind}` — 허용 목록(`ledger-allowlist.json`)의 열쇠다.
 */

const TOLERANCE_MM = 1;

/**
 * 두 목록에 나올 수 있는 family 전부. 여기 없는 이름이 나오면 새 부재 종류가 생긴 것이니 시험이 멈춘다
 * (3D 는 planner-finish.js plannerFinishPartKeyOf, BOM 은 extractors.js BOM_PART_DEFS 가 정본).
 */
const KNOWN_FAMILIES = [
  // 몸통
  'body:side', 'body:top', 'body:bottom', 'back', 'shelf', 'body:band', 'body:brace', 'body:divider',
  'body:batten-front', 'body:batten-side', 'body:panel',
  // 전면
  'door', 'drawer', 'blank', 'blind', 'blindfin',
  // 서랍 상자
  'drawerbox:fb', 'drawerbox:side', 'drawerbox:bottom', 'drawerbox:brace',
  // 손잡이 자리
  'channel:front', 'channel:back', 'handle',
  // 마감재 · 상판 · 바닥
  'molding', 'molding:left', 'molding:right', 'filler:left', 'filler:right', 'ep:left', 'ep:right',
  'finishing', 'finish', 'top', 'kick', 'pedestal', 'pedestal:fb', 'pedestal:side', 'pedestal:brace',
];

function fmtItems(items) {
  return items
    .slice()
    .sort((p, q) => q.a - p.a || q.b - p.b || q.t - p.t)
    .map((i) => `${i.a}×${i.b}×${i.t} ×${i.qty}`)
    .join(', ');
}

function groupBy(rows) {
  const g = new Map();
  rows.forEach((r) => {
    const k = `${r.moduleId}|${r.family}`;
    if (!g.has(k)) g.set(k, { moduleId: r.moduleId, family: r.family, items: [] });
    g.get(k).items.push({ a: r.a, b: r.b, t: r.t, qty: r.qty });
  });
  return g;
}

/** qty 로 접힌 항목을 낱장으로 편다 — 다중집합 짝짓기용. */
function expand(items) {
  const out = [];
  items.forEach((i) => { for (let k = 0; k < i.qty; k++) out.push({ a: i.a, b: i.b, t: i.t }); });
  return out;
}

const near = (x, y, tol) => Math.abs(x - y) <= tol;

/**
 * 한 픽스처의 3D 행과 BOM 행을 대조한다.
 * @returns {Array<{id, kind, fixture, moduleId, family, scene, bom, note}>}
 */
function diffLedger(fixture, sceneRows, bomRows, opts = {}) {
  const tol = opts.tolerance == null ? TOLERANCE_MM : opts.tolerance;
  const S = groupBy(sceneRows);
  const B = groupBy(bomRows);
  const keys = [...new Set([...S.keys(), ...B.keys()])].sort(naturalCompare);
  const out = [];
  const push = (g, kind, note) => out.push({
    id: `${fixture}|${g.moduleId}|${g.family}|${kind}`,
    kind, fixture, moduleId: g.moduleId, family: g.family,
    scene: S.has(`${g.moduleId}|${g.family}`) ? fmtItems(S.get(`${g.moduleId}|${g.family}`).items) : '',
    bom: B.has(`${g.moduleId}|${g.family}`) ? fmtItems(B.get(`${g.moduleId}|${g.family}`).items) : '',
    note: note || '',
  });

  keys.forEach((k) => {
    const s = S.get(k), b = B.get(k);
    if (s && !b) { push(s, 'only3d'); return; }
    if (!s && b) { push(b, 'onlyBom'); return; }
    const sx = expand(s.items), bx = expand(b.items);
    const usedB = new Array(bx.length).fill(false);
    const leftS = [];
    let tMismatch = 0;
    sx.forEach((si) => {
      // 같은 치수(±tol)면 두께가 같은 쪽을 먼저 짝짓는다
      let pick = -1;
      for (let j = 0; j < bx.length; j++) {
        if (usedB[j]) continue;
        if (near(si.a, bx[j].a, tol) && near(si.b, bx[j].b, tol)) {
          if (near(si.t, bx[j].t, 0.5)) { pick = j; break; }
          if (pick < 0) pick = j;
        }
      }
      if (pick < 0) { leftS.push(si); return; }
      usedB[pick] = true;
      if (!near(si.t, bx[pick].t, 0.5)) tMismatch++;
    });
    const leftB = bx.filter((_, j) => !usedB[j]);
    if (leftS.length || leftB.length) {
      push(s, 'dims', `짝 안 맞음 — 3D ${leftS.length}장 · BOM ${leftB.length}장`);
      return;
    }
    if (tMismatch) push(s, 'thickness', `두께만 다른 판 ${tMismatch}장`);
  });
  return out;
}

/** `lower-2` 와 `lower-10` 이 숫자순으로 서게. */
function naturalCompare(x, y) {
  return String(x).localeCompare(String(y), 'en', { numeric: true });
}

function sortEntries(entries) {
  return entries.slice().sort((p, q) =>
    naturalCompare(p.fixture, q.fixture) || naturalCompare(p.moduleId, q.moduleId)
    || naturalCompare(p.family, q.family) || naturalCompare(p.kind, q.kind));
}

/** 실패 메시지용 표. */
function formatTable(rows, cols) {
  const C = cols || [
    ['kind', '종류'], ['fixture', '픽스처'], ['moduleId', '모듈'], ['family', '부재'],
    ['scene', '3D (a×b×t ×수량)'], ['bom', 'BOM (a×b×t ×수량)'], ['reason', '이유'],
  ];
  const cell = (r, k) => (r[k] == null ? '' : String(r[k]));
  const widths = C.map(([k, label]) => Math.max(label.length, ...rows.map((r) => cell(r, k).length)));
  const line = (vals) => vals.map((v, i) => v.padEnd(widths[i])).join('  ');
  return [line(C.map(([, l]) => l)), line(widths.map((w) => '-'.repeat(w)))]
    .concat(rows.map((r) => line(C.map(([k]) => cell(r, k)))))
    .join('\n');
}

/** 원인(cause)별 개수 — 보고서용. */
function countBy(entries, field) {
  const m = new Map();
  entries.forEach((e) => { const k = e[field] || '(없음)'; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((p, q) => q[1] - p[1] || naturalCompare(p[0], q[0]));
}

module.exports = {
  TOLERANCE_MM,
  KNOWN_FAMILIES,
  diffLedger,
  sortEntries,
  formatTable,
  countBy,
  naturalCompare,
  fmtItems,
};
