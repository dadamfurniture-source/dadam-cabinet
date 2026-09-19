/**
 * 역판독 자동 검증 (2026-09-19, 계획서 docs/01-plan/photo-composite-research.plan.md §4.1 · R4c)
 *
 * 생성된 기본안을 layout.js 가 Claude 비전으로 읽어 낸 **구성**(세그먼트 순서·도어/서랍 수·가전 위치)을,
 * 우리가 보낸 도면 요약(design_spec)과 대조한다. 닫힌 고리:
 *
 *   design_spec → [생성] → 이미지 → [layout.js 역판독] → 읽힌 구성
 *              └──────────────── 이 파일이 대조 ────────────────┘
 *
 * layout.js 의 규율을 그대로 잇는다 — **mm 는 재지 않는다.** 순서와 개수만 잰다.
 * 세그먼트는 읽는 쪽이 같은 종류를 하나로 합쳐 읽기 쉬우므로(서랍장 3칸 → 'lower' 하나, doors 합산),
 * 모듈 개수가 아니라 (1) 종류 순서, (2) 도어·서랍 총수, (3) 상부장 도어 수, (4) 가전 순서, (5) 가전 위치를 본다.
 *
 * 이 파일은 import 가 없어야 한다 — 시험이 export 만 떼어 평가한다 (layout.js 와 같은 규칙).
 */

export const VERIFY_VERSION = 1;

/** design_spec 의 sections.<slot>.modules 가 바닥 세그먼트로 읽힐 때의 kind. */
const FLOOR_SECTIONS = ['lower', 'tall'];

/** 가전 kind — design_spec 쪽 이름 → layout.js 쪽 이름. */
const APPLIANCE_TO_LAYOUT = {
  fridge: 'refrigerator',
  refrigerator: 'refrigerator',
  dishwasher: 'dishwasher',
  sink: 'sink',
  hood: 'hood',
  cooktop: 'cooktop',
};

/** 이미지에서 실제로 읽히는 가전만 대조한다 — 싱크·후드·쿡탑은 layout.js 가 조사값(wall_analysis)으로 덮어쓴다. */
const APPLIANCES_FROM_IMAGE = ['refrigerator', 'dishwasher'];

/** 가전 모듈의 라벨로 종류를 고른다 (ai-photo.js 가 '냉장고' / '식기세척기' 로 보낸다). */
function applianceKindOfModule(m) {
  const label = String((m && m.label) || '').toLowerCase();
  if (/냉장|fridge|refrig/.test(label)) return 'refrigerator';
  if (/식기|dish/.test(label)) return 'dishwasher';
  return 'open';
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 연속된 같은 값을 하나로 — 읽는 쪽이 같은 종류를 합쳐 읽는 것과 같은 눈높이로 맞춘다. */
export function collapseRuns(seq) {
  const out = [];
  for (const k of seq) if (!out.length || out[out.length - 1] !== k) out.push(k);
  return out;
}

/** 편집 거리 (Levenshtein). */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * design_spec → 기대 구성.
 * @returns {{floorKinds:string[], floorDoors:number, floorDrawers:number, upperDoors:number|null,
 *            appliances:{kind:string, centerPct:number|null}[], wallRunMm:number}}
 */
export function expectedFromSpec(spec, category) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const sections = s.sections && typeof s.sections === 'object' ? s.sections : {};
  const wallRunMm = num(s.wallRunMm) || null;
  const floorKinds = [];
  let floorDoors = 0, floorDrawers = 0;

  if (category === 'wardrobe') {
    // 붙박이장은 벽 전체가 한 세그먼트 — layout.js 가 그렇게 합친다
    let doors = 0;
    Object.values(sections).forEach((sec) => {
      (sec && Array.isArray(sec.modules) ? sec.modules : []).forEach((m) => { doors += num(m.doorCount); });
    });
    return { floorKinds: ['wardrobe'], floorDoors: doors, floorDrawers: 0, upperDoors: null, appliances: [], wallRunMm };
  }

  // 바닥 구간을 왼쪽 끝 기준으로 정렬해 이어 붙인다 (하부장 → 키큰장 순서가 아니라 실제 위치 순서)
  const floorSecs = FLOOR_SECTIONS
    .map((slot) => [slot, sections[slot]])
    .filter(([, sec]) => sec && Array.isArray(sec.modules) && sec.modules.length)
    .sort((a, b) => num(a[1].fromLeftMm) - num(b[1].fromLeftMm));
  for (const [slot, sec] of floorSecs) {
    for (const m of sec.modules) {
      if (m.kind === 'appliance') { floorKinds.push(applianceKindOfModule(m)); continue; }
      if (m.kind === 'open') { floorKinds.push('open'); continue; }
      floorKinds.push(slot === 'tall' ? 'tall' : 'lower');
      floorDoors += num(m.doorCount);
      floorDrawers += num(m.drawerCount);
    }
  }

  let upperDoors = null;
  const up = sections.upper;
  if (up && Array.isArray(up.modules) && up.modules.length) {
    upperDoors = up.modules.reduce((n, m) => n + num(m.doorCount), 0);
  }

  const appliances = (Array.isArray(s.appliances) ? s.appliances : [])
    .map((a) => {
      const kind = APPLIANCE_TO_LAYOUT[String((a && a.kind) || '').toLowerCase()];
      if (!kind) return null;
      const centerPct = wallRunMm && Number.isFinite(Number(a.fromLeftMm))
        ? clamp01((num(a.fromLeftMm) + num(a.widthMm) / 2) / wallRunMm) * 100
        : null;
      return { kind, centerPct };
    })
    .filter(Boolean)
    .sort((a, b) => (a.centerPct == null ? 0 : a.centerPct) - (b.centerPct == null ? 0 : b.centerPct));

  return { floorKinds, floorDoors, floorDrawers, upperDoors, appliances, wallRunMm };
}

/** normalizeLayout 결과 → 읽힌 구성 (같은 모양). */
export function readFromLayout(layout) {
  const l = layout && typeof layout === 'object' ? layout : {};
  const segs = Array.isArray(l.segments) ? l.segments : [];
  const floorKinds = segs.map((s) => String((s && s.kind) || 'open'));
  const floorDoors = segs.reduce((n, s) => n + num(s && s.doors), 0);
  const floorDrawers = segs.reduce((n, s) => n + num(s && s.drawers), 0);
  const uppers = Array.isArray(l.uppers) ? l.uppers : [];
  const upperDoors = uppers.length ? uppers.reduce((n, u) => n + num(u && u.doors), 0) : null;
  const ap = l.appliances && typeof l.appliances === 'object' ? l.appliances : {};
  const appliances = Object.keys(ap)
    .filter((k) => ap[k] && Number.isFinite(Number(ap[k].centerPct)))
    .map((k) => ({ kind: k, centerPct: num(ap[k].centerPct), source: ap[k].source || null }))
    .sort((a, b) => a.centerPct - b.centerPct);
  return { floorKinds, floorDoors, floorDrawers, upperDoors, appliances };
}

/**
 * 대조. 점수는 계획서 §4.1 의 다섯 항목, 각 0~1. 총점 `score` 는 있는 항목의 합(최대 5), `max` 는 항목 수.
 * `ok` 는 순서·개수가 구속이라는 계약(design-spec-prompt.md)을 그대로 옮긴 것이다:
 *   순서가 맞고(≥ 0.99), 도어·서랍 총수가 3/4 이상 맞고, 가전 종류·순서가 맞으면 ok.
 */
export function compareLayoutToSpec(layout, spec, category) {
  const want = expectedFromSpec(spec, category);
  const got = readFromLayout(layout);
  const parts = {};
  const issues = [];

  // 1) 종류 순서 — 'open' 은 양쪽에서 뺀다 (읽는 쪽이 틈을 open 으로 메우기도, 안 메우기도 한다)
  const wantSeq = collapseRuns(want.floorKinds.filter((k) => k !== 'open'));
  const gotSeq = collapseRuns(got.floorKinds.filter((k) => k !== 'open'));
  if (wantSeq.length) {
    const d = editDistance(wantSeq, gotSeq);
    parts.order = clamp01(1 - d / Math.max(wantSeq.length, gotSeq.length, 1));
    if (d > 0) issues.push(`order: expected ${wantSeq.join('>')}, read ${gotSeq.join('>') || '(none)'}`);
  }

  // 2) 도어·서랍 총수
  const wantN = want.floorDoors + want.floorDrawers;
  if (wantN > 0) {
    const diff = Math.abs(want.floorDoors - got.floorDoors) + Math.abs(want.floorDrawers - got.floorDrawers);
    parts.counts = clamp01(1 - diff / wantN);
    if (diff > 0) {
      issues.push(`counts: expected ${want.floorDoors} doors + ${want.floorDrawers} drawers, read ${got.floorDoors} + ${got.floorDrawers}`);
    }
  }

  // 3) 상부장 도어 수 (도면에 상부장이 있을 때만)
  if (want.upperDoors != null) {
    if (got.upperDoors == null) { parts.uppers = 0; issues.push(`uppers: expected ${want.upperDoors} doors, none read`); }
    else {
      const diff = Math.abs(want.upperDoors - got.upperDoors);
      parts.uppers = clamp01(1 - diff / Math.max(want.upperDoors, 1));
      if (diff > 0) issues.push(`uppers: expected ${want.upperDoors} doors, read ${got.upperDoors}`);
    }
  }

  // 4) 가전 종류·순서 — 이미지에서 읽히는 것만 (싱크·후드·쿡탑은 조사값이라 뺀다)
  const wantAp = want.appliances.filter((a) => APPLIANCES_FROM_IMAGE.includes(a.kind));
  const gotAp = got.appliances.filter((a) => APPLIANCES_FROM_IMAGE.includes(a.kind));
  if (wantAp.length) {
    const d = editDistance(wantAp.map((a) => a.kind), gotAp.map((a) => a.kind));
    parts.appliances = clamp01(1 - d / Math.max(wantAp.length, gotAp.length, 1));
    if (d > 0) issues.push(`appliances: expected ${wantAp.map((a) => a.kind).join('>')}, read ${gotAp.map((a) => a.kind).join('>') || '(none)'}`);

    // 5) 가전 위치 — 양쪽에 있는 것만, ±10%p 안이면 만점, 30%p 에서 0
    const pos = [];
    for (const w of wantAp) {
      if (w.centerPct == null) continue;
      const g = gotAp.find((x) => x.kind === w.kind);
      if (!g) continue;
      const dp = Math.abs(w.centerPct - g.centerPct);
      pos.push(clamp01(1 - Math.max(0, dp - 10) / 20));
      if (dp > 10) issues.push(`position: ${w.kind} expected at ${w.centerPct.toFixed(0)} %, read at ${g.centerPct.toFixed(0)} %`);
    }
    if (pos.length) parts.positions = pos.reduce((a, b) => a + b, 0) / pos.length;
  }

  const keys = Object.keys(parts);
  const score = keys.reduce((a, k) => a + parts[k], 0);
  const ok = keys.length > 0
    && (parts.order == null || parts.order >= 0.99)
    && (parts.counts == null || parts.counts >= 0.75)
    && (parts.appliances == null || parts.appliances >= 0.99);

  return {
    version: VERIFY_VERSION,
    ok,
    score: Math.round(score * 100) / 100,
    max: keys.length,
    parts,
    issues,
    expected: want,
    read: got,
  };
}
