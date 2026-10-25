// ============================================================
// 설계 유전체 — planner-genome.js (연구용 코어, 2026-10-25)
//
// 사용자가 예전에 고친 방식대로 다음 설계의 구조를 미리 채우는 자동완성 연구의 계산 코어다.
// 유전형 임퓨테이션(genotype imputation)과 같은 틀로 본다:
//
//   좌위(locus)      = 자동계산이 정한 모듈 자리 (배치 공간 안 x 순서)
//   대립유전자(allele) = 그 자리의 구조 선택값 (도어 1/2 · 경첩 · 서랍 비율 · 오픈 · 키큰장 단 조합)
//   하플로타입        = 한 배치 공간(라인)의 모듈 열
//   참조 패널         = 본인 과거 설계 (가중치 λ) + 다른 사용자 설계 (1−λ)
//
// 들어 있는 것 — 모두 순수 함수 (DOM 없음):
//   1. 변이 호출   plannerGenomeAlleleOf(m, s) · plannerGenomeTallAlleleOf(tiers) — 플래너 구조 → 대립유전자
//                 plannerGenomeChoiceAllele(choice) — 모듈 라이브러리 choice → 같은 대립유전자 (라이브러리 id = rsID)
//   2. 유전체     plannerGenomeOf(design) — {modules, structures} → 라인별 좌위 열 + 앵커 + 전역 설정
//   3. 대칭       plannerGenomeMirrorLine · plannerGenomeCanonicalLine (좌우 미러 = Z₂ 군 작용) · plannerGenomeHingeRel
//   4. 통계       plannerGenomeLD (D · D′ · r²) · plannerGenomeShrink (Balding–Nichols 축소)
//   5. 임퓨테이션 plannerGenomeModel → plannerGenomeForward(model, semiring) — Li–Stephens HMM 을 반환(semiring)만
//                 바꿔 돌린다: sum = 사후확률 · max = 최적 점수 · count = 경로 수 · kbest(k) = 상위 k 완성
//                 plannerGenomeImpute — 결측 자리의 제안 분포 · 확신도 · 상위 k 완성
//                 plannerGenomeSuggestAttrs (속성 완성) · plannerGenomeSuggestGlobals (손잡이·다리 등 기본값)
//
// 규칙을 새로 두지 않는다 (CLAUDE.md "설계 규칙 임의 생성 금지"):
//   제안은 패널에서 **관측된 대립유전자만** 다시 낸다. 치수·폭은 바꾸지 않는다 (폭은 자동계산 몫).
//   엔진 금지 조합을 걸러야 하면 부르는 쪽이 opts.allow 로 넘긴다 — 여기서 고치거나 대신 정하지 않는다.
//
// 아직 어떤 html 에도 싣지 않는다. 연구 도구는 tools/genome/*, 시험은 __tests__/planner-genome*.test.js.
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_GENOME_ / plannerGenome 접두.
// ============================================================

const PLANNER_GENOME_VERSION = 1;

/** 가전 자리 표시 섹션 — 장이 아니라 앵커다 (planner-sections.js PLANNER_MARKER_SECTIONS 와 같은 뜻). */
const PLANNER_GENOME_MARKERS = ['sink', 'hood', 'dishwasher', 'refrigerator'];

/**
 * 자리 표시가 앵커가 되는 라인 — 브리지가 분배기 X 범위로 하부 셀을 '개수대', 후드 X 범위로
 * 상부 셀을 '후드장' 으로 고르는 것과 같은 짝이다. 하부 개수대 장 위 상부장은 개수대 앵커가 아니다.
 */
const PLANNER_GENOME_MARKER_LINES = { sink: ['lower'], dishwasher: ['lower'], hood: ['upper'], refrigerator: ['tall', 'fridge'] };

/** 마감재 섹션 — 좌위가 아니다 (planner-sections.js FINISHING_SECTIONS). */
const PLANNER_GENOME_FINISHING = ['ep', 'molding', 'filler', 'gap'];

/** 단을 쌓는 섹션 — 같은 x·W 의 단들이 좌위 하나다. */
const PLANNER_GENOME_STACKED = ['tall', 'fridge'];

/** 경첩 글자. 대립유전자 서명 끝의 `/L` · `/R` · `/U`. */
const PLANNER_GENOME_HINGE = { left: 'L', right: 'R', up: 'U' };

/** 전역 설정으로 모으는 구조 키 (과제 C). 단마다 다른 값이면 가장 흔한 값을 쓴다. */
const PLANNER_GENOME_GLOBAL_KEYS = ['handleType', 'legH', 'moldingH'];

// ─────────────────────────────────────────────────────────────
// 1. 변이 호출 — 구조 → 대립유전자
// ─────────────────────────────────────────────────────────────

/** 서명 = 종류 + (경첩이 있으면 '/L' 등). */
function plannerGenomeSig(type, hinge) {
  const h = hinge ? PLANNER_GENOME_HINGE[hinge] : '';
  return h ? `${type}/${h}` : type;
}

/**
 * 서랍 전면 등급 → 비율 문자열. bom-drawer-rules.js ratioOf 와 같은 셈이다 (소 1, 나머지 2).
 * grades 가 drawerCount 보다 짧으면 모자란 칸은 기본 등급(중 = 2)이다.
 */
function plannerGenomeRatioOf(s) {
  const d = (s && s.drawer) || {};
  const w = (g) => (g === 'small' ? 1 : 2);
  const n = Math.max((d.grades || []).length, s.drawerCount || 0);
  const drawers = [];
  for (let i = 0; i < n; i++) drawers.push(w((d.grades || [])[i]));
  return (d.topDrawer ? drawers : [w(d.doorGrade || 'large')].concat(drawers)).join(':');
}

/** 서랍 몫 꼬리 — 레일 · 서랍 자재 · 사쿠리. */
function plannerGenomeDrawerTail(d) {
  const o = d || {};
  return `${o.rail === 'ball' ? 'ball' : 'under'}|${o.boxT === 18 ? 18 : 0}|${o.sakuri ? 'sk' : 'nosk'}`;
}

/**
 * 장 하나(키큰장 단 아님)의 대립유전자.
 * @param {object} m 플래너 모듈 (section, W …)
 * @param {object} s structures[m.id]
 * @returns {{type:string, hinge:(string|null), sig:string}}
 */
function plannerGenomeAlleleOf(m, s) {
  const st = s || {};
  const kind = st.moduleKind || 'normal';
  if (kind === 'open') return plannerGenomeAllele('OPEN', null);
  if (kind === 'rice') return plannerGenomeAllele(`RICE:${(st.rice && st.rice.door) || 'none'}`, null);
  if (kind !== 'normal') return plannerGenomeAllele(kind.toUpperCase(), null);
  const n = st.verticalCount || 1;
  if (n > 1) {
    // 칸이 여럿 — 칸마다 종류·방향·양문을 이어 하나의 대립유전자로 둔다 (드문 경우)
    const cells = [];
    for (let i = 0; i < n; i++) {
      const t = (st.areaTypes || [])[i] || 'door';
      const dir = (st.areaDirections || [])[i] || 'left';
      const two = !!(st.areaIs2D || [])[i];
      cells.push(t === 'door' ? (two ? 'D2' : `D1${PLANNER_GENOME_HINGE[dir] || ''}`) : t.charAt(0).toUpperCase());
    }
    return plannerGenomeAllele(`C:${cells.join(',')}`, null);
  }
  const d = st.drawer || {};
  if (st.horizontalLayout === 'doorTopDrawerBottom' && st.bottomType === 'drawer') {
    const head = d.topDrawer ? 'DR' : 'DD';
    const type = `${head}:${plannerGenomeRatioOf(st)}|${plannerGenomeDrawerTail(d)}`;
    // 도어 위 + 서랍 아래(DD)는 위 도어의 경첩을 갖는다. 서랍장(DR)은 경첩이 없다.
    return plannerGenomeAllele(type, d.topDrawer ? null : plannerGenomeHingeOfCell(st, 0));
  }
  const t0 = (st.areaTypes || [])[0] || 'door';
  if (t0 !== 'door') return plannerGenomeAllele(`CELL:${t0}`, null);
  if ((st.areaIs2D || [])[0]) return plannerGenomeAllele('D2', null);
  return plannerGenomeAllele('D1', plannerGenomeHingeOfCell(st, 0));
}

function plannerGenomeHingeOfCell(s, i) {
  const dir = ((s && s.areaDirections) || [])[i] || 'left';
  return PLANNER_GENOME_HINGE[dir] ? dir : 'left';
}

function plannerGenomeAllele(type, hinge) {
  return { type, hinge: hinge || null, sig: plannerGenomeSig(type, hinge) };
}

/** 키큰장 단 하나의 글자 — S 서랍 · R 밥솥장 · O 오픈 · F 플랩 · D 도어. */
function plannerGenomeTierLetter(s) {
  const st = s || {};
  if (st.moduleKind === 'rice') return 'R';
  if (st.moduleKind === 'open') return 'O';
  if (st.horizontalLayout === 'doorTopDrawerBottom' && st.bottomType === 'drawer') return 'S';
  if (((st.areaDirections || [])[0]) === 'up') return 'F';
  return 'D';
}

/**
 * 키큰장 통(단 여럿)의 대립유전자. 라이브러리 id `TL-<하·가·상>-600[-SW|-LF][-L|-R]` 과 같은 정보다.
 * 경첩은 여닫이 도어 단(D, 밥솥장 여닫이)의 방향 — 단마다 다르면 종류 끝에 '~mix' 를 붙인다.
 * @param {object[]} tierStructures 아래 단부터
 */
function plannerGenomeTallAlleleOf(tierStructures) {
  const tiers = tierStructures || [];
  const letters = tiers.map(plannerGenomeTierLetter).join('');
  let suffix = '';
  const swingDirs = [];
  tiers.forEach((s) => {
    const L = plannerGenomeTierLetter(s);
    if (L === 'R') {
      const door = (s.rice && s.rice.door) || 'none';
      if (door === 'swing') suffix = '-SW';
      else if (door === 'liftup') suffix = '-LF';
      if (door === 'swing') swingDirs.push(plannerGenomeHingeOfCell(s, 0));
    }
    if (L === 'D') swingDirs.push(plannerGenomeHingeOfCell(s, 0));
  });
  const mixed = swingDirs.some((d) => d !== swingDirs[0]);
  return plannerGenomeAllele(`T:${letters}${suffix}${mixed ? '~mix' : ''}`, swingDirs.length ? swingDirs[0] : null);
}

/**
 * 모듈 라이브러리 choice → 대립유전자. 라이브러리 `structureOf` 를 거쳐 plannerGenomeAlleleOf 로 읽은 것과
 * 같아야 한다 (dadam-module-library G10 역매핑 시험).
 */
function plannerGenomeChoiceAllele(choice) {
  const c = choice || {};
  if (c.tall) {
    const t = c.tall;
    const tiers = { lower: t.lower || 'door', middle: t.middle || 'door', upper: t.upper || 'door' };
    const letter = { door: 'D', drawer: 'S', open: 'O', rice: 'R', flap: 'F' };
    let suffix = '';
    if (tiers.middle === 'rice' && t.riceDoor === 'swing') suffix = '-SW';
    if (tiers.middle === 'rice' && t.riceDoor === 'liftup') suffix = '-LF';
    const swing = ['lower', 'middle', 'upper'].some((k) => tiers[k] === 'door')
      || (tiers.middle === 'rice' && t.riceDoor === 'swing');
    const type = `T:${letter[tiers.lower]}${letter[tiers.middle]}${letter[tiers.upper]}${suffix}`;
    return plannerGenomeAllele(type, swing ? (t.hinge === 'right' ? 'right' : 'left') : null);
  }
  if (c.drawer) {
    const d = c.drawer;
    return plannerGenomeAllele(`DR:${d.ratio}|${plannerGenomeDrawerTail(d)}`, null);
  }
  if (c.kind === 'open') return plannerGenomeAllele('OPEN', null);
  if (c.doors === 2) return plannerGenomeAllele('D2', null);
  return plannerGenomeAllele('D1', c.hinge === 'right' || c.hinge === 'up' ? c.hinge : 'left');
}

/** 라이브러리 목록 → `section|W|sig` → id (rsID 주석용). */
function plannerGenomeLibraryIndex(entries) {
  const idx = new Map();
  (entries || []).forEach((e) => {
    idx.set(`${e.section}|${e.W}|${plannerGenomeChoiceAllele(e.choice).sig}`, e.id);
  });
  return idx;
}

// ─────────────────────────────────────────────────────────────
// 2. 유전체 — 설계 한 건 → 라인별 좌위 열
// ─────────────────────────────────────────────────────────────

function plannerGenomeRot(m) {
  return (((m && m.rotation) || 0) % 360 + 360) % 360;
}

/** 두 x 구간이 겹치는가 (같은 회전일 때만 — 브리지가 x 범위로 개수대·후드장을 고르는 것과 같은 비교). */
function plannerGenomeOverlaps(a, b) {
  if (plannerGenomeRot(a) !== plannerGenomeRot(b)) return false;
  const a0 = a.x || 0, a1 = a0 + (a.W || 0), b0 = b.x || 0, b1 = b0 + (b.W || 0);
  return Math.min(a1, b1) - Math.max(a0, b0) > 0;
}

/**
 * 설계 한 건의 유전체.
 * @param {{modules:object[], structures:object, user?:string, id?:string, weight?:number}} design
 * @returns {{version:number, user:(string|null), id:(string|null), weight:number,
 *   lines:{key:string, section:string, loci:object[]}[], globals:object}}
 */
function plannerGenomeOf(design) {
  const d = design || {};
  const mods = (d.modules || []).filter(Boolean);
  const structs = d.structures || {};
  const markers = mods.filter((m) => PLANNER_GENOME_MARKERS.indexOf(m.section) >= 0);
  const byArea = new Map();
  mods.forEach((m) => {
    if (PLANNER_GENOME_MARKERS.indexOf(m.section) >= 0) return;
    if (m.isFinishing || PLANNER_GENOME_FINISHING.indexOf(m.section) >= 0) return;
    const key = m.areaId || `${m.section}@${plannerGenomeRot(m)}`;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(m);
  });
  const lines = [];
  byArea.forEach((list, key) => {
    const section = list[0].section;
    const loci = PLANNER_GENOME_STACKED.indexOf(section) >= 0
      ? plannerGenomeStackLoci(list, structs, markers)
      : list.map((m) => ({
        x: m.x || 0, W: m.W || 0, ids: [m.id],
        allele: plannerGenomeAlleleOf(m, structs[m.id]),
        fixed: !!(m.isFixed || m.blind || m.fridgeNiche),
        anchors: markers.filter((k) => (PLANNER_GENOME_MARKER_LINES[k.section] || []).indexOf(m.section) >= 0
          && plannerGenomeOverlaps(m, k)).map((k) => k.section).sort(),
        rot: plannerGenomeRot(m),
      }));
    loci.sort((a, b) => a.x - b.x);
    const sinkAt = loci.findIndex((l) => l.anchors.indexOf('sink') >= 0);
    loci.forEach((l, i) => {
      l.i = i;
      l.n = loci.length;
      l.fromSink = sinkAt >= 0 ? i - sinkAt : null;
      delete l.rot;
    });
    lines.push({ key, section, loci });
  });
  lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    version: PLANNER_GENOME_VERSION,
    user: d.user == null ? null : String(d.user),
    id: d.id == null ? null : String(d.id),
    weight: d.weight == null ? 1 : d.weight,
    lines,
    globals: plannerGenomeGlobalsOf(mods, structs),
  };
}

/** 단을 쌓는 배치 공간 — 같은 x·W 의 단들을 한 통(좌위)으로 묶는다 (mockup-structure buildStackColumn). */
function plannerGenomeStackLoci(list, structs, markers) {
  const cols = new Map();
  list.forEach((m) => {
    const k = `${Math.round(m.x || 0)}|${Math.round(m.W || 0)}`;
    if (!cols.has(k)) cols.set(k, []);
    cols.get(k).push(m);
  });
  const out = [];
  cols.forEach((tiers) => {
    tiers.sort((a, b) => (a.baseY || 0) - (b.baseY || 0));
    const m0 = tiers[0];
    out.push({
      x: m0.x || 0, W: m0.W || 0, ids: tiers.map((m) => m.id),
      allele: plannerGenomeTallAlleleOf(tiers.map((m) => structs[m.id] || {})),
      fixed: tiers.some((m) => m.isFixed || m.blind || m.fridgeNiche),
      anchors: (markers || []).filter((k) => (PLANNER_GENOME_MARKER_LINES[k.section] || []).indexOf(m0.section) >= 0
        && plannerGenomeOverlaps(m0, k)).map((k) => k.section).sort(),
      rot: plannerGenomeRot(m0),
    });
  });
  return out;
}

/** 전역 설정 — 장 구조에서 가장 흔한 값 (과제 C). 값이 없으면 키를 두지 않는다. */
function plannerGenomeGlobalsOf(mods, structs) {
  const out = {};
  PLANNER_GENOME_GLOBAL_KEYS.forEach((k) => {
    const counts = new Map();
    mods.forEach((m) => {
      const s = structs[m.id];
      if (!s || s[k] == null) return;
      counts.set(s[k], (counts.get(s[k]) || 0) + 1);
    });
    let best = null, bestN = 0;
    counts.forEach((n, v) => { if (n > bestN) { best = v; bestN = n; } });
    if (best != null) out[k] = best;
  });
  return out;
}

// ─────────────────────────────────────────────────────────────
// 3. 대칭 — 좌우 미러 (Z₂)
// ─────────────────────────────────────────────────────────────

/** 서명의 경첩 L↔R. 위(U)·경첩 없음은 그대로. */
function plannerGenomeMirrorSig(sig) {
  if (/\/L$/.test(sig)) return sig.replace(/\/L$/, '/R');
  if (/\/R$/.test(sig)) return sig.replace(/\/R$/, '/L');
  return sig;
}

/** 라인의 미러 — 순서를 뒤집고 경첩을 바꾼다. σ∘σ = 항등. */
function plannerGenomeMirrorLine(line) {
  const n = line.loci.length;
  const loci = line.loci.slice().reverse().map((l, i) => {
    const sig = l.allele ? plannerGenomeMirrorSig(l.allele.sig) : null;
    const allele = l.allele ? Object.assign({}, l.allele, {
      sig,
      hinge: l.allele.hinge === 'left' ? 'right' : l.allele.hinge === 'right' ? 'left' : l.allele.hinge,
    }) : null;
    return Object.assign({}, l, { allele, i, fromSink: l.fromSink == null ? null : -l.fromSink });
  });
  return Object.assign({}, line, { loci, n });
}

/** 궤도 대표 — 라인과 그 미러 중 서명 열이 사전순으로 앞선 쪽. */
function plannerGenomeCanonicalLine(line) {
  const key = (ln) => ln.loci.map((l) => (l.allele ? l.allele.sig : '?')).join(' ');
  const mir = plannerGenomeMirrorLine(line);
  return key(mir) < key(line) ? { line: mir, mirrored: true } : { line, mirrored: false };
}

/**
 * 경첩을 미러에 변하지 않는 값으로 — 가까운 라인 끝(벽) 쪽인가, 개수대 쪽인가.
 * 'L' 경첩은 시작 쪽(로컬 x 작은 쪽), 'R' 은 끝 쪽에 붙는다.
 * @returns {{wall:('wall'|'room'|null), sink:('toward'|'away'|null)}}
 */
function plannerGenomeHingeRel(locus) {
  const h = locus && locus.allele && locus.allele.hinge;
  if (h !== 'left' && h !== 'right') return { wall: null, sink: null };
  const toStart = h === 'left';
  const nearStart = locus.i < (locus.n - 1) / 2;
  const middle = locus.i === (locus.n - 1) / 2;
  const wall = middle ? null : (toStart === nearStart ? 'wall' : 'room');
  let sink = null;
  if (locus.fromSink != null && locus.fromSink !== 0) sink = (locus.fromSink > 0) === toStart ? 'toward' : 'away';
  return { wall, sink };
}

// ─────────────────────────────────────────────────────────────
// 4. 통계 — LD · 축소
// ─────────────────────────────────────────────────────────────

/**
 * 2×2 개수표 → LD. D 는 확률표의 2×2 소행렬식 p11·p22 − p12·p21 과 같다.
 * @returns {{n:number, D:number, Dprime:number, r2:number}}
 */
function plannerGenomeLD(n11, n12, n21, n22) {
  const n = n11 + n12 + n21 + n22;
  if (!n) return { n: 0, D: 0, Dprime: 0, r2: 0 };
  const p11 = n11 / n, p12 = n12 / n, p21 = n21 / n, p22 = n22 / n;
  const pA = p11 + p12, pB = p11 + p21;
  const D = p11 * p22 - p12 * p21;
  const Dmax = D >= 0 ? Math.min(pA * (1 - pB), (1 - pA) * pB) : Math.min(pA * pB, (1 - pA) * (1 - pB));
  const den = pA * (1 - pA) * pB * (1 - pB);
  return { n, D, Dprime: Dmax > 0 ? D / Dmax : 0, r2: den > 0 ? (D * D) / den : 0 };
}

/**
 * Balding–Nichols 축소 — 사용자 빈도를 전체 빈도로 당긴다.
 *   p̂_u(a) = (n_u(a) + α·p(a)) / (n_u + α),  α = (1−F)/F
 * @param {Map<string,number>} own    본인 개수 (가중 가능)
 * @param {Map<string,number>} global 전체 개수
 * @param {number} F  사용자–전체 분화 (0<F<1). 작을수록 전체를 따른다.
 * @returns {Map<string,number>} 합 1
 */
function plannerGenomeShrink(own, global, F) {
  const f = Math.min(0.999, Math.max(0.001, F == null ? 0.2 : F));
  const alpha = (1 - f) / f;
  const keys = new Set([...(own || new Map()).keys(), ...(global || new Map()).keys()]);
  const gTot = [...(global || new Map()).values()].reduce((a, b) => a + b, 0);
  const oTot = [...(own || new Map()).values()].reduce((a, b) => a + b, 0);
  const out = new Map();
  if (!keys.size) return out;
  keys.forEach((k) => {
    const pg = gTot > 0 ? ((global.get(k) || 0) / gTot) : 1 / keys.size;
    out.set(k, ((own && own.get(k)) || 0) / (oTot + alpha) + (alpha * pg) / (oTot + alpha));
  });
  // 전체 개수가 없는 키가 섞이면 합이 1 이 안 될 수 있다 — 다시 나눈다
  const sum = [...out.values()].reduce((a, b) => a + b, 0);
  out.forEach((v, k) => out.set(k, v / sum));
  return out;
}

function plannerGenomeCount(map, key, w) {
  map.set(key, (map.get(key) || 0) + (w == null ? 1 : w));
}

// ─────────────────────────────────────────────────────────────
// 5. 임퓨테이션 — Li–Stephens HMM, 반환(semiring)을 바꿔 끼운다
// ─────────────────────────────────────────────────────────────

const PLANNER_GENOME_DEFAULTS = Object.freeze({
  lambda: 0.7,       // 본인 설계 몫 (나머지는 다른 사용자). 'auto' = n/(n+κ)
  kappa: 2,          // λ 'auto' 의 κ — 본인 설계가 κ 건이면 λ = 0.5
  rho: 0.15,         // 재조합 — 다른 참조로 갈아탈 확률
  delta: 0.05,       // 삽입·결실 — 참조에서 한 칸 건너뛰거나 제자리
  theta: 0.05,       // 돌연변이 — 따라 그리는 참조와 다른 값을 낼 확률
  sigmaW: 150,       // 폭 차이 척도 (mm)
  anchorMiss: 0.2,   // 앵커(개수대·후드…)가 다를 때 곱하는 값
  sigmaPos: 0.35,    // 상대 위치 차이 척도 (0~1)
  F: 0.2,            // 배경 분포 축소 강도
  tau: 0.5,          // 제안 문턱 (확신도)
  k: 3,              // 상위 완성 수
});

function plannerGenomeLogSumExp(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

/**
 * 반환 — 원소는 로그 가중을 받는다 (weight). times 는 곱(로그에서는 합), plus 는 경로 합치기.
 *   sum   : (logsumexp, +)  → 전체 우도 · 사후확률
 *   max   : (max, +)        → 열대 반환, 최적 경로 점수 (Viterbi)
 *   count : (+, ×)          → 확률이 0 이 아닌 경로 수
 */
const PLANNER_GENOME_SEMIRING = Object.freeze({
  sum: Object.freeze({
    zero: -Infinity, one: 0,
    weight: (lw) => lw, plus: plannerGenomeLogSumExp, times: (a, b) => a + b,
  }),
  max: Object.freeze({
    zero: -Infinity, one: 0,
    weight: (lw) => lw, plus: (a, b) => Math.max(a, b), times: (a, b) => a + b,
  }),
  count: Object.freeze({
    zero: 0, one: 1,
    weight: (lw) => (lw === -Infinity ? 0 : 1), plus: (a, b) => a + b, times: (a, b) => a * b,
  }),
});

/**
 * k-best 반환 — 원소 = 점수 내림차순 [{s, path}] (길이 ≤ k). tag 가 경로에 상태를 붙인다.
 * k = 1 이면 max 반환에 경로를 더한 것이다.
 */
function plannerGenomeKBest(k) {
  const K = Math.max(1, k | 0);
  const merge = (A, B) => {
    const out = [];
    let i = 0, j = 0;
    while (out.length < K && (i < A.length || j < B.length)) {
      if (j >= B.length || (i < A.length && A[i].s >= B[j].s)) out.push(A[i++]);
      else out.push(B[j++]);
    }
    return out;
  };
  return {
    zero: [], one: [{ s: 0, path: [] }],
    weight: (lw) => (lw === -Infinity ? [] : [{ s: lw, path: [] }]),
    plus: merge,
    // 한쪽은 언제나 가중치(경로 없음) — 경로를 이어 붙인다
    times: (A, B) => {
      const out = [];
      A.forEach((a) => B.forEach((b) => out.push({ s: a.s + b.s, path: a.path.concat(b.path) })));
      out.sort((x, y) => y.s - x.s);
      return out.slice(0, K);
    },
    tag: (A, state) => A.map((a) => ({ s: a.s, path: a.path.concat([state]) })),
  };
}

/** 대립유전자 서명의 종류 앞부분 — 'DR:2:1:1|…' → 'DR'. 속성 완성의 부분 일치에 쓴다. */
function plannerGenomeHead(sig) {
  return String(sig).split(/[:/]/)[0];
}

/**
 * HMM 모형을 짓는다.
 * @param {{section:string, loci:object[]}} query  결측 자리는 allele = null
 * @param {{line:object, weight?:number, own?:boolean}[]} panel 참조 라인들 (같은 섹션만 쓴다)
 * @param {object} [opts] PLANNER_GENOME_DEFAULTS 를 덮는다
 */
function plannerGenomeModel(query, panel, opts) {
  const o = Object.assign({}, PLANNER_GENOME_DEFAULTS, opts || {});
  const refs = (panel || []).filter((p) => p && p.line && p.line.section === query.section && p.line.loci.length);
  const ownW = refs.filter((p) => p.own).reduce((a, p) => a + (p.weight == null ? 1 : p.weight), 0);
  const otherW = refs.filter((p) => !p.own).reduce((a, p) => a + (p.weight == null ? 1 : p.weight), 0);
  // λ = 'auto' 이면 본인 설계 수 n 으로 정한다: λ = n / (n + κ) — 설계가 적은 사용자는 집단을 더 따른다
  //   (경험적 베이즈. Balding–Nichols 축소와 같은 모양이다)
  const ownN = new Set(refs.filter((p) => p.own).map((p) => p.design == null ? p : p.design)).size;
  const lamOwn = o.lambda === 'auto' ? ownN / (ownN + o.kappa) : o.lambda;
  const lam = ownW > 0 && otherW > 0 ? lamOwn : ownW > 0 ? 1 : 0;
  const refW = refs.map((p) => {
    const w = p.weight == null ? 1 : p.weight;
    return p.own ? (lam * w) / ownW : ((1 - lam) * w) / otherW;
  });
  // 상태 = (참조 r, 자리 j)
  const states = [];
  const startOf = [];
  refs.forEach((p, r) => {
    startOf.push(states.length);
    p.line.loci.forEach((l, j) => states.push({ r, j, m: p.line.loci.length, locus: l }));
  });
  // 배경 분포 — 본인/전체 개수를 축소 (돌연변이가 낼 값)
  const own = new Map(), all = new Map();
  refs.forEach((p, r) => p.line.loci.forEach((l) => {
    if (!l.allele) return;
    plannerGenomeCount(all, l.allele.sig, refW[r]);
    if (p.own) plannerGenomeCount(own, l.allele.sig, refW[r]);
  }));
  const bg = plannerGenomeShrink(own, all, o.F);
  const alleles = [...bg.keys()].sort();
  const n = query.loci.length;
  const relPos = (i, m) => (m > 1 ? i / (m - 1) : 0.5);
  // 갈아타기 분포 σ_i(s) ∝ w_r · exp(−|u−v|/σpos)
  const switchLog = [];
  for (let i = 0; i < n; i++) {
    const u = relPos(i, n);
    const raw = states.map((st) => refW[st.r] * Math.exp(-Math.abs(u - relPos(st.j, st.m)) / o.sigmaPos));
    const z = raw.reduce((a, b) => a + b, 0) || 1;
    switchLog.push(raw.map((v) => (v > 0 ? Math.log(v / z) : -Infinity)));
  }
  const logA = Math.log((1 - o.rho) * (1 - 2 * o.delta));
  const logD = o.delta > 0 ? Math.log((1 - o.rho) * o.delta) : -Infinity;
  const logRho = Math.log(o.rho);
  const sameAnchors = (a, b) => a.join(',') === b.join(',');
  const logE = (i, s) => {
    const q = query.loci[i], st = states[s], l = st.locus;
    let lw = -Math.abs((q.W || 0) - (l.W || 0)) / o.sigmaW;
    if (!sameAnchors(q.anchors || [], l.anchors || [])) lw += Math.log(o.anchorMiss);
    if (q.allele) {
      const same = l.allele && l.allele.sig === q.allele.sig;
      const pBg = bg.get(q.allele.sig) || 1e-6;
      lw += Math.log(same ? (1 - o.theta) + o.theta * pBg : o.theta * pBg);
    }
    return lw;
  };
  /**
   * 조밀한 전이를 **사건별 성분**으로 — [갈아타기, 한 칸 전진, 두 칸 전진, 제자리] 중 가능한 것.
   * 전방 계산은 이 성분 위에서 분배법칙을 쓴다. 그래서 max · count 반환에서도 전수 탐색
   * (경로마다 단계별 ⊕성분 을 ⊗) 과 같은 값이 나온다. sum 이면 logsumexp(성분) = 전이 확률.
   */
  const logTParts = (i, s0, s1) => {
    const a = states[s0], b = states[s1];
    const parts = [logRho + switchLog[i][s1]];
    if (a.r === b.r) {
      if (b.j === a.j + 1) parts.push(logA);
      if (b.j === a.j + 2) parts.push(logD);
      if (b.j === a.j) parts.push(logD);
    }
    return parts;
  };
  return { o, n, states, startOf, refs, refW, bg, alleles, query, switchLog, logA, logD, logRho, logE, logTParts, logInit: (s) => switchLog[0][s] };
}

/**
 * 전방 계산 — 구조화된 전이로 O(n·S). sr 의 plus/times/weight 만 쓴다.
 *   α₀(s) = π(s) ⊗ E₀(s)
 *   α_i(s) = E_i(s) ⊗ [ A⊗α(r,j−1) ⊕ D⊗α(r,j−2) ⊕ D⊗α(r,j) ⊕ ρ⊗σ_i(s)⊗(⊕_{s'} α(s')) ]
 * @returns {{alpha:Array[], total:*}} total = ⊕_s α_{n−1}(s)
 */
function plannerGenomeForward(model, sr) {
  const { n, states } = model;
  const S = states.length;
  const alpha = [];
  if (!n || !S) return { alpha, total: sr.zero };
  const tag = sr.tag || ((x) => x);
  let prev = states.map((_, s) => tag(sr.times(sr.weight(model.logInit(s)), sr.weight(model.logE(0, s))), s));
  alpha.push(prev);
  for (let i = 1; i < n; i++) {
    let all = sr.zero;
    prev.forEach((a) => { all = sr.plus(all, a); });
    const swAll = sr.times(sr.weight(model.logRho), all);
    const cur = new Array(S);
    for (let s = 0; s < S; s++) {
      const st = states[s];
      let acc = sr.times(sr.weight(model.switchLog[i][s]), swAll);
      if (st.j >= 1) acc = sr.plus(acc, sr.times(sr.weight(model.logA), prev[s - 1]));
      if (st.j >= 2) acc = sr.plus(acc, sr.times(sr.weight(model.logD), prev[s - 2]));
      acc = sr.plus(acc, sr.times(sr.weight(model.logD), prev[s]));
      cur[s] = tag(sr.times(acc, sr.weight(model.logE(i, s))), s);
    }
    alpha.push(cur);
    prev = cur;
  }
  let total = sr.zero;
  prev.forEach((a) => { total = sr.plus(total, a); });
  return { alpha, total };
}

/** 후방 계산 (sum 반환, 로그) — 사후확률용. */
function plannerGenomeBackward(model) {
  const { n, states } = model;
  const S = states.length;
  const beta = new Array(n);
  if (!n) return beta;
  beta[n - 1] = new Array(S).fill(0);
  for (let i = n - 2; i >= 0; i--) {
    const eb = states.map((_, s) => model.logE(i + 1, s) + beta[i + 1][s]);
    let sw = -Infinity;
    for (let s = 0; s < S; s++) sw = plannerGenomeLogSumExp(sw, model.switchLog[i + 1][s] + eb[s]);
    const cur = new Array(S);
    for (let s = 0; s < S; s++) {
      const st = states[s];
      let v = model.logRho + sw;
      if (st.j + 1 < st.m) v = plannerGenomeLogSumExp(v, model.logA + eb[s + 1]);
      if (st.j + 2 < st.m) v = plannerGenomeLogSumExp(v, model.logD + eb[s + 2]);
      v = plannerGenomeLogSumExp(v, model.logD + eb[s]);
      cur[s] = v;
    }
    beta[i] = cur;
  }
  return beta;
}

/**
 * 결측 자리 채우기.
 * @param {object} query 결측 자리는 allele = null. fixed 자리는 관측으로 둔다.
 * @param {object[]} panel
 * @param {object} [opts] lambda · rho · theta · tau · k · allow(locus, sig) → boolean …
 * @returns {{loci:object[], completions:object[], logZ:number}}
 *   loci[i] = {i, observed, dist:[{sig,p}], best, confidence, suggest}
 */
function plannerGenomeImpute(query, panel, opts) {
  const model = plannerGenomeModel(query, panel, opts);
  const o = model.o;
  const allow = typeof o.allow === 'function' ? o.allow : null;
  const n = model.n;
  if (!model.states.length) {
    return { loci: query.loci.map((l, i) => ({ i, observed: l.allele ? l.allele.sig : null, dist: [], best: null, confidence: 0, suggest: false })), completions: [], logZ: -Infinity };
  }
  const fw = plannerGenomeForward(model, PLANNER_GENOME_SEMIRING.sum);
  const beta = plannerGenomeBackward(model);
  const logZ = fw.total;
  const loci = query.loci.map((q, i) => {
    if (q.allele) return { i, observed: q.allele.sig, dist: [{ sig: q.allele.sig, p: 1 }], best: q.allele.sig, confidence: 1, suggest: false };
    const mass = new Map();
    model.states.forEach((st, s) => {
      const post = Math.exp(fw.alpha[i][s] + beta[i][s] - logZ);
      if (!(post > 0) || !st.locus.allele) return;
      plannerGenomeCount(mass, st.locus.allele.sig, post * (1 - o.theta));
    });
    model.bg.forEach((p, sig) => plannerGenomeCount(mass, sig, p * o.theta));
    let dist = [...mass.entries()].filter(([sig]) => !allow || allow(q, sig)).map(([sig, p]) => ({ sig, p }));
    const z = dist.reduce((a, d) => a + d.p, 0);
    dist = z > 0 ? dist.map((d) => ({ sig: d.sig, p: d.p / z })) : [];
    dist.sort((a, b) => b.p - a.p || (a.sig < b.sig ? -1 : 1));
    const best = dist.length ? dist[0].sig : null;
    const confidence = dist.length ? dist[0].p : 0;
    return { i, observed: null, dist, best, confidence, suggest: confidence >= o.tau };
  });
  // 상위 k 완성 — 복사 경로(k-best)를 대립유전자 열로 바꾸고 같은 열은 하나로 (k = 0 이면 건너뛴다)
  const completions = [];
  if (!(o.k > 0)) return { loci, completions, logZ, n };
  const kb = plannerGenomeForward(model, plannerGenomeKBest(o.k * 4));
  const seen = new Set();
  kb.total.forEach((c) => {
    if (completions.length >= o.k) return;
    const sigs = c.path.map((s, i) => (query.loci[i].allele ? query.loci[i].allele.sig : (model.states[s].locus.allele || {}).sig || null));
    if (allow && sigs.some((sig, i) => !query.loci[i].allele && sig && !allow(query.loci[i], sig))) return;
    const key = sigs.join(' ');
    if (seen.has(key)) return;
    seen.add(key);
    completions.push({ sigs, logScore: c.s, sources: c.path.map((s) => ({ ref: model.states[s].r, j: model.states[s].j })) });
  });
  return { loci, completions, logZ, n };
}

/**
 * 속성 완성 (과제 B) — 머리(예 'DR', 'T')가 정해진 자리의 나머지 속성.
 * @param {string} head 대립유전자 종류 앞부분
 * @param {Map<string,number>} own 본인 개수 (같은 섹션)
 * @param {Map<string,number>} global 전체 개수
 * @param {number} [F]
 * @returns {{sig:string, p:number}[]}
 */
function plannerGenomeSuggestAttrs(head, own, global, F) {
  const pick = (m) => new Map([...(m || new Map()).entries()].filter(([sig]) => plannerGenomeHead(sig) === head));
  const sh = plannerGenomeShrink(pick(own), pick(global), F);
  return [...sh.entries()].map(([sig, p]) => ({ sig, p })).sort((a, b) => b.p - a.p || (a.sig < b.sig ? -1 : 1));
}

/**
 * 전역 기본값 (과제 C) — 키마다 축소된 분포와 그 최빈값.
 * @param {object[]} ownGenomes  본인 유전체들
 * @param {object[]} allGenomes  전체 유전체들 (본인 포함 가능)
 */
function plannerGenomeSuggestGlobals(ownGenomes, allGenomes, F) {
  const out = {};
  PLANNER_GENOME_GLOBAL_KEYS.forEach((k) => {
    const own = new Map(), all = new Map();
    (ownGenomes || []).forEach((g) => { if (g.globals[k] != null) plannerGenomeCount(own, String(g.globals[k]), g.weight); });
    (allGenomes || []).forEach((g) => { if (g.globals[k] != null) plannerGenomeCount(all, String(g.globals[k]), g.weight); });
    if (!own.size && !all.size) return;
    const dist = [...plannerGenomeShrink(own, all, F).entries()].map(([v, p]) => ({ v, p })).sort((a, b) => b.p - a.p);
    out[k] = { best: dist[0].v, p: dist[0].p, dist };
  });
  return out;
}

// 구조 페이지에서는 planner-seed.js 가 맨이름으로 쓴다. 시험 하네스(test-utils/planner-harness.js)는
//   스크립트마다 함수 스코프로 돌리므로 window 노출이 있어야 다음 스크립트가 찾는다.
if (typeof window !== 'undefined') {
  window.PLANNER_GENOME_VERSION = PLANNER_GENOME_VERSION;
  window.plannerGenomeOf = plannerGenomeOf;
  window.plannerGenomeImpute = plannerGenomeImpute;
  window.PlannerGenome = {
    VERSION: PLANNER_GENOME_VERSION,
    of: plannerGenomeOf,
    alleleOf: plannerGenomeAlleleOf,
    impute: plannerGenomeImpute,
    suggestAttrs: plannerGenomeSuggestAttrs,
    suggestGlobals: plannerGenomeSuggestGlobals,
  };
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_GENOME_VERSION,
    PLANNER_GENOME_DEFAULTS,
    PLANNER_GENOME_SEMIRING,
    plannerGenomeSig,
    plannerGenomeRatioOf,
    plannerGenomeAlleleOf,
    plannerGenomeTallAlleleOf,
    plannerGenomeChoiceAllele,
    plannerGenomeLibraryIndex,
    plannerGenomeOf,
    plannerGenomeMirrorSig,
    plannerGenomeMirrorLine,
    plannerGenomeCanonicalLine,
    plannerGenomeHingeRel,
    plannerGenomeLD,
    plannerGenomeShrink,
    plannerGenomeKBest,
    plannerGenomeHead,
    plannerGenomeModel,
    plannerGenomeForward,
    plannerGenomeBackward,
    plannerGenomeImpute,
    plannerGenomeSuggestAttrs,
    plannerGenomeSuggestGlobals,
  };
}
