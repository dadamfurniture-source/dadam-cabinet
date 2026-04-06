// ═══════════════════════════════════════════════════════════════
// Sink HITL Random Generator (Option B — 유틸리티 기반 배치)
//
// 원칙:
//   ✓ cook  는 환풍구(vent) 중심에 배치  — 정답
//   ✓ hood  는 환풍구 중심에 배치        — 정답
//   ✓ sink  는 분전반(distributor) 포함  — 정답
//   ✓ LT    는 cook 바로 옆, 벽 먼 쪽    — 정답
//   ✓ 좌→우 논리 순서                    — 정답
//
// 학습을 위한 의도적 랜덤(=수정 유도):
//   • cook/sink/LT 의 width (후보 중 랜덤)
//   • cook/extra 모듈의 kind (door vs drawer)
//   • storage/drawer 모듈의 폭·개수·kind
//   • doorCount 휴리스틱
// ═══════════════════════════════════════════════════════════════

import type { SinkEnv, SinkDesign, SinkModule, LayoutType } from '../schemas/sink-hitl.schemas.js';

// ─── seed-able RNG ───
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}
function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ─── 후보 값 (학습 신호용 랜덤) ───
const LT_WIDTH_CANDIDATES = [150, 200, 250, 300] as const;
const SINK_WIDTH_CANDIDATES = [900, 950, 1000, 1050, 1100] as const;
const COOK_WIDTH_CANDIDATES = [580, 600, 620] as const;
const HOOD_WIDTH_CANDIDATES = [600, 800, 900] as const;
const STORAGE_WIDTH_CANDIDATES = [400, 450, 500, 550, 600, 700, 800] as const;

type ModKind = 'door' | 'drawer' | 'open';
type ModType = 'sink' | 'cook' | 'hood' | 'lt' | 'storage' | 'drawer' | 'blank';

interface ProtoModule {
  type: ModType;
  width: number;
  kind: ModKind;
  /** 절대 X 위치 (inner coord, 좌측 마감재 이후) — 정렬·배치용 임시 */
  start?: number;
  /** normal=주선(X축), secondary=좌측 차선(Z축), tertiary=우측 차차선(Z축) */
  orientation?: 'normal' | 'secondary' | 'tertiary';
  /** 차선 모듈이 연결되는 주선 모듈 인덱스 */
  blindAnchorIdx?: number;
}

// ─── ㄱ자/ㄷ자 차선(secondary) 모듈 생성 ───
const SECONDARY_WIDTH_CANDIDATES = [400, 450, 500, 550, 600] as const;

function layoutSecondary(
  wallLength: number,           // 보조벽 길이 (mm, depth 포함)
  depth: number,                // 싱크대 깊이
  fillerW: number,              // 자유단 마감재
  rng: () => number,
): ProtoModule[] {
  // 실제 사용 가능 길이: 보조벽 - 주선 깊이(코너 겹침) - 자유단 마감재
  const usableW = wallLength - depth - fillerW;
  if (usableW < 300) return []; // 공간 부족 → 차선 없음

  const out: ProtoModule[] = [];
  let remaining = usableW;

  while (remaining >= 300) {
    const candidate = Math.min(pick(rng, SECONDARY_WIDTH_CANDIDATES), remaining);
    if (candidate < 300) break;
    const isDrawer = rng() < 0.25;
    out.push({
      type: isDrawer ? 'drawer' : 'storage',
      width: candidate,
      kind: isDrawer ? 'drawer' : 'door',
      orientation: 'secondary',
    });
    remaining -= candidate;
  }
  // 잔여 흡수
  if (remaining > 0 && out.length > 0) {
    out[out.length - 1].width += remaining;
  }

  return out;
}

// ─── 좌표 변환 ───
// blindLeftW/blindRightW: 멍장 폭 (L/U자 코너)을 inner 좌표에서 제외
function toInner(xWall: number, env: SinkEnv, blindLeftW = 0, blindRightW = 0): number {
  // measurementBase 'left' 기준: 벽 좌측으로부터 xWall mm → inner coord (finishLeftW + 멍장 차감)
  // 'right' 기준: 벽 우측으로부터 xWall mm → inner coord
  if (env.measurementBase === 'left') {
    return xWall - env.finishLeftW - blindLeftW;
  }
  // right base: innerW - (xWall - finishRightW - blindRightW)
  const innerW = env.width - env.finishLeftW - env.finishRightW - blindLeftW - blindRightW;
  return innerW - (xWall - env.finishRightW - blindRightW);
}

// ─── 하부 레이아웃: 유틸리티 기반 고정 + 빈 공간 랜덤 채움 ───
function layoutLower(env: SinkEnv, rng: () => number, blindLeftW = 0, blindRightW = 0): ProtoModule[] {
  const innerW = env.width - env.finishLeftW - env.finishRightW - blindLeftW - blindRightW;

  // 환풍구 중심 (inner coord — 멍장 오프셋 반영)
  const ventCenter =
    env.ventStart != null && env.ventEnd != null
      ? (toInner(env.ventStart, env, blindLeftW, blindRightW) + toInner(env.ventEnd, env, blindLeftW, blindRightW)) / 2
      : null;

  // 분배기 범위 (inner coord — 멍장 오프셋 반영)
  const distStart = env.distributorStart != null ? toInner(env.distributorStart, env, blindLeftW, blindRightW) : null;
  const distEnd = env.distributorEnd != null ? toInner(env.distributorEnd, env, blindLeftW, blindRightW) : null;
  const distCenter = distStart != null && distEnd != null ? (distStart + distEnd) / 2 : null;

  const cookW = pick(rng, COOK_WIDTH_CANDIDATES);
  const cookKind: ModKind = rng() < 0.5 ? 'drawer' : 'door'; // 정답 drawer, 학습용 노이즈
  const sinkW = pick(rng, SINK_WIDTH_CANDIDATES);
  const ltW = pick(rng, LT_WIDTH_CANDIDATES);

  // cook 중심 → 환풍구 중심 (없으면 우측 70%)
  const cookTargetCenter = ventCenter ?? innerW * 0.7;
  let cookStart = Math.max(0, Math.min(innerW - cookW, cookTargetCenter - cookW / 2));

  // sink 쪽: 분배기 위치 기준으로 cook 반대편
  const sinkOnLeft =
    distCenter != null ? distCenter < cookStart + cookW / 2 : cookStart + cookW / 2 > innerW / 2;

  // sink 위치 결정 — 분배기 포함 제약 우선
  let sinkStart: number;
  if (distStart != null && distEnd != null) {
    // 분배기 중심에 맞추되, 양끝 안전 범위로 clamp 후 분배기 전체 포함되도록 조정
    let sc = distCenter! - sinkW / 2;
    if (sc + sinkW < distEnd) sc = distEnd - sinkW; // 우측 보정
    if (sc > distStart) sc = distStart;             // 좌측 보정
    sinkStart = Math.max(0, Math.min(innerW - sinkW, sc));
  } else {
    // 분배기 없음 → cook 반대편 벽 가까이
    sinkStart = sinkOnLeft ? 0 : innerW - sinkW;
  }

  // sink-cook 충돌 방지: 최소 간격 확보 (필요 시 cook 재조정)
  const MIN_GAP = 0;
  if (sinkOnLeft && sinkStart + sinkW > cookStart - MIN_GAP) {
    cookStart = Math.min(innerW - cookW, sinkStart + sinkW + MIN_GAP);
  } else if (!sinkOnLeft && cookStart + cookW > sinkStart - MIN_GAP) {
    sinkStart = Math.min(innerW - sinkW, cookStart + cookW + MIN_GAP);
  }

  // LT: cook 옆, sink 반대쪽 (벽에 가까운 쪽)
  // sinkOnLeft → LT는 cook의 오른쪽, 그 반대는 왼쪽
  let ltStart: number | null;
  if (sinkOnLeft) {
    ltStart = cookStart + cookW;
    if (ltStart + ltW > innerW) ltStart = null; // 공간 부족 → LT 생략
  } else {
    ltStart = cookStart - ltW;
    if (ltStart < 0) ltStart = null;
  }
  // LT가 sink와 충돌하면 생략
  if (ltStart != null) {
    const ltEnd = ltStart + ltW;
    if (ltStart < sinkStart + sinkW && ltEnd > sinkStart) ltStart = null;
  }

  // 고정 모듈 리스트 (start 기준 정렬)
  const fixed: ProtoModule[] = [
    { type: 'sink', width: sinkW, kind: 'door', start: sinkStart },
    { type: 'cook', width: cookW, kind: cookKind, start: cookStart },
  ];
  if (ltStart != null) fixed.push({ type: 'lt', width: ltW, kind: 'door', start: ltStart });
  fixed.sort((a, b) => (a.start! - b.start!));

  // 고정 모듈 사이 gap을 storage/drawer로 채움 + 좌우 끝 filler
  const out: ProtoModule[] = [];
  let cursor = 0;

  const fillGap = (gapW: number) => {
    while (gapW >= 300) {
      const candidate = Math.min(pick(rng, STORAGE_WIDTH_CANDIDATES), gapW);
      if (candidate < 300) break;
      const isDrawer = rng() < 0.3;
      out.push({
        type: isDrawer ? 'drawer' : 'storage',
        width: candidate,
        kind: isDrawer ? 'drawer' : 'door',
      });
      gapW -= candidate;
    }
    // 잔여는 직전 모듈에 흡수
    if (gapW > 0 && out.length > 0) out[out.length - 1].width += gapW;
  };

  for (const m of fixed) {
    const gap = m.start! - cursor;
    if (gap >= 300) {
      fillGap(gap);
    } else if (gap > 0) {
      // 300mm 미만 — 고정 모듈 위치 유지를 위해 직전 모듈 확장
      if (out.length > 0) {
        out[out.length - 1].width += gap;
      } else {
        // 첫 모듈이면 어쩔 수 없이 왼쪽으로 당김
        m.start = cursor;
        m.width += gap;
      }
    } else if (gap < 0) {
      // 충돌 — 고정 모듈 축소 (안전장치)
      m.width = Math.max(300, m.width + gap);
      m.start = cursor;
    }
    out.push({ type: m.type, width: m.width, kind: m.kind });
    cursor = (m.start! > cursor ? m.start! : cursor) + m.width;
  }
  // 우측 끝 filler
  let rightGap = innerW - cursor;
  if (rightGap >= 300) {
    fillGap(rightGap);
  } else if (rightGap > 0 && out.length > 0) {
    out[out.length - 1].width += rightGap;
  }

  return out;
}

// ─── 상부 레이아웃: hood를 환풍구 중심에 + 나머지 storage ───
function layoutUpper(env: SinkEnv, rng: () => number, blindLeftW = 0, blindRightW = 0): ProtoModule[] {
  const innerW = env.width - env.finishLeftW - env.finishRightW - blindLeftW - blindRightW;
  const ventCenter =
    env.ventStart != null && env.ventEnd != null
      ? (toInner(env.ventStart, env, blindLeftW, blindRightW) + toInner(env.ventEnd, env, blindLeftW, blindRightW)) / 2
      : null;

  const hoodW = pick(rng, HOOD_WIDTH_CANDIDATES);
  const hoodCenter = ventCenter ?? innerW * 0.7;
  const hoodStart = Math.max(0, Math.min(innerW - hoodW, hoodCenter - hoodW / 2));

  const out: ProtoModule[] = [];
  let cursor = 0;

  const fillGap = (gapW: number) => {
    while (gapW >= 300) {
      const candidate = Math.min(pick(rng, STORAGE_WIDTH_CANDIDATES), gapW);
      if (candidate < 300) break;
      out.push({ type: 'storage', width: candidate, kind: 'door' });
      gapW -= candidate;
    }
    if (gapW > 0 && out.length > 0) out[out.length - 1].width += gapW;
  };

  let effHoodStart = hoodStart;
  let effHoodW = hoodW;
  if (hoodStart >= 300) {
    fillGap(hoodStart);
  } else if (hoodStart > 0) {
    // 300 미만 좌측 gap → hood를 왼쪽으로 확장
    effHoodStart = 0;
    effHoodW = hoodW + hoodStart;
  }
  out.push({ type: 'hood', width: effHoodW, kind: 'open' });
  cursor = effHoodStart + effHoodW;
  let rightGap = innerW - cursor;
  if (rightGap >= 300) {
    fillGap(rightGap);
  } else if (rightGap > 0 && out.length > 0) {
    out[out.length - 1].width += rightGap;
  }

  return out;
}

// ─── ProtoModule → SinkModule 변환 ───
function protoToModule(p: ProtoModule, idx: number, rng: () => number): SinkModule {
  const m: SinkModule = {
    idx,
    width: p.width,
    kind: p.kind,
    type: p.type,
    orientation: p.orientation ?? 'normal',
  };
  if (p.blindAnchorIdx != null) m.blindAnchorIdx = p.blindAnchorIdx;
  if (p.kind === 'door') m.doorCount = p.width >= 600 ? 2 : 1;
  if (p.kind === 'drawer') m.drawerCount = randInt(rng, 2, 4);
  return m;
}

// ─── 메인 엔트리 ───
export function generateRandomSinkDesign(
  env: SinkEnv,
  seed: number = Date.now() & 0xffffffff,
): SinkDesign {
  const rng = mulberry32(seed);
  const layoutType: LayoutType = env.layoutType ?? 'I';
  const depth = env.depth ?? 600;
  const fillerW = env.secondaryFillerW ?? 60;

  // 2) ㄱ자/ㄷ자: 멍장(blind corner panel) + 차선(secondary)
  //    멍장: 코너 접합부에 depth 폭의 blank 모듈 → 차선이 앵커로 연결
  //    좌측 차선: 주선의 첫 번째 모듈(멍장, idx=0)에 앵커
  //    우측 차선: 주선의 마지막 모듈(멍장)에 앵커
  const hasLeft  = (layoutType === 'L' || layoutType === 'U') && (env.secondaryLeftW ?? 0) > 0;
  const hasRight = layoutType === 'U' && (env.secondaryRightW ?? 0) > 0;

  const blindLeftW  = hasLeft  ? depth : 0;
  const blindRightW = hasRight ? depth : 0;

  // 1) 주선(primary) 레이아웃 — 멍장 폭 제외
  const lowerProto = layoutLower(env, rng, blindLeftW, blindRightW);
  const upperProto = layoutUpper(env, rng, blindLeftW, blindRightW);

  // 멍장 삽입: 좌측은 맨 앞, 우측은 맨 뒤
  if (hasLeft) {
    lowerProto.unshift({ type: 'blank', width: blindLeftW, kind: 'door' });
    upperProto.unshift({ type: 'blank', width: blindLeftW, kind: 'door' });
  }
  if (hasRight) {
    lowerProto.push({ type: 'blank', width: blindRightW, kind: 'door' });
    upperProto.push({ type: 'blank', width: blindRightW, kind: 'door' });
  }

  // 차선 모듈 생성 + 멍장에 앵커 연결
  if (hasLeft) {
    const secLower = layoutSecondary(env.secondaryLeftW!, depth, fillerW, rng);
    secLower.forEach(m => { m.blindAnchorIdx = 0; }); // 좌측 멍장(idx=0)에 앵커
    lowerProto.push(...secLower);

    const secUpper = layoutSecondary(env.secondaryLeftW!, depth, fillerW, rng);
    secUpper.forEach(m => { m.blindAnchorIdx = 0; });
    upperProto.push(...secUpper);
  }

  if (hasRight) {
    const primaryLastLowerIdx = lowerProto.filter(m => (m.orientation ?? 'normal') === 'normal').length - 1;
    const primaryLastUpperIdx = upperProto.filter(m => (m.orientation ?? 'normal') === 'normal').length - 1;

    const terLower = layoutSecondary(env.secondaryRightW!, depth, fillerW, rng);
    terLower.forEach(m => { m.orientation = 'tertiary'; m.blindAnchorIdx = primaryLastLowerIdx; });
    lowerProto.push(...terLower);

    const terUpper = layoutSecondary(env.secondaryRightW!, depth, fillerW, rng);
    terUpper.forEach(m => { m.orientation = 'tertiary'; m.blindAnchorIdx = primaryLastUpperIdx; });
    upperProto.push(...terUpper);
  }

  // 3) 최종 idx 재번호 + 변환
  const lower: SinkModule[] = lowerProto.map((p, idx) => protoToModule(p, idx, rng));
  const upper: SinkModule[] = upperProto.map((p, idx) => protoToModule(p, idx, rng));

  return {
    id: `sink-${Date.now().toString(36)}-${seed.toString(36)}`,
    timestamp: new Date().toISOString(),
    version: 'v1',
    env,
    lower,
    upper,
    meta: {
      generated_by: 'random',
      seed,
    },
  };
}
