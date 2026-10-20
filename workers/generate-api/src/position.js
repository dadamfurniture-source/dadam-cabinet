/**
 * 기본안 위치 검사 — 기록 전용 (2026-10-20, 사장님 결정 "기본안 검사에 위치 검사(기록 전용)를 상시로").
 * 설계: docs/02-design/features/position-qc.md · 오프라인 근거(회사 이미지·건별 값)는 리포 밖 D:/ohouse/gen-eval3.
 *
 * 싱크대·아일랜드 기본안 1장에서 싱크·쿡탑·후드·하부장 줄 끝이 지시한 자리에 그려졌는지 mm 로 잰다.
 *   ① Flash(gemini-3.8-flash, thinking low, media HIGH, 응답 스키마) 전체 이미지 1회 → 점 (prompts.js buildPositionPrompt)
 *   ② ①의 점으로 상판~상부장 띠를 잘라 키워 같은 질의 1회 — 전체 1회만 쓰면 벽 방향 소실점(vh)이 폭주한다(재생 실측)
 *   ③ VLM 점만으로 깊이 소실점 vz·vh → 상판 뒷선 위 교차비로 벽 %·런 % → 경로별 정답과 mm 비교 → σ·보류·경계
 * 기록만 한다. 다시 그리지 않고, 상태·단계 라벨·진행률·크레딧·완료 시각을 건드리지 않는다. 실패·시간 초과는 코드만 남긴다.
 * 이 파일의 함수는 던지지 않는다 — runPositionCheck 는 늘 기록 또는 null 로 풀린다.
 */

import decodeJpeg from 'jpeg-js/lib/decoder.js';
import { callGemini, geminiOverloadAt, imageDimensions } from './gemini.js';
import { b64ToBytes, bytesToB64, encodeJpeg, encodePng } from './guide.js';
import { massingFocal } from './kitchen.js';
import { KITCHEN_CATEGORIES, POSITION_SCHEMA, buildPositionPrompt, parsePositionLandmarks, plannerPositionFrame } from './prompts.js';

/**
 * 기록 형식·질의·기하·문턱의 판. 하나라도 바뀌면 올린다 — 집계는 판별로 나눈다.
 *   2 (2026-10-20 검토 반영): 후드 세로 소실점 투영 · vz 지평선 검사 · vh 위치 검사 · 직선 2개 σ_u · 도면 덩어리 앵커·런 틀 ·
 *     덩어리 칠 자리(클램프 없음) · 깊이 비율 범위 · 과부하 건너뛰기 · 재실행 기록
 *   3 (2026-10-20): 도면 덩어리 경로 항목 run_right_place — 칠한 하부 덩어리 끝(ck.place.ref) 대 그린 줄 끝을 같은 화면 틀에서
 *     직접 비교 (뒤·앞 모서리 둘 다, 보수적인 쪽). 판정되면 run_right_wall 은 place_frame 기록만 · ok 의 자유 끝으로 인정 ·
 *     measured.place · img 에 CFL·CFR
 */
export const POSITION_VERSION = 3;
/** 정확도 근거가 이 모델에만 있다 — GEMINI_TEXT_MODEL 을 따라가지 않는다 (env.POSITION_MODEL 로만 바꾼다) */
export const POSITION_MODEL_DEFAULT = 'gemini-3.8-flash';
/**
 * 경보를 내는 경로 (env.POSITION_ALARM_ROUTES 로 바꾼다). 나머지 경로는 측정만(ok:null) — 오프라인 재생에서 경로별로
 * 검증된 것만 켠다: 덩어리(재생 2장)·도면 덩어리(0장)·ㄱ자(오경보 3/6)는 운영 집계를 본 뒤 넓힌다.
 */
export const POSITION_ALARM_ROUTES_DEFAULT = ['text_pct', 'planner'];
/**
 * 시간 (ms). 호출당 30초 · 전체 75초 · 과부하(429·5xx) 재시도는 5초 뒤 1회, 남은 예산이 35초 이상일 때만.
 * overloadSkip: 같은 모델(Flash — QC·분석과 같은 키·할당량)이 이 isolate 에서 최근 이만큼 안에 429·5xx 를 받았으면
 *   새 호출을 보내지 않는다 (시작 전이면 error 'skipped_overload', 띠 전이면 nz 'overload') — 손님 쪽 호출의 재시도를 늘리지 않는다
 */
export const POSITION_TIMING = { total: 75_000, call: 30_000, retryWait: 5_000, minLeft: 35_000, hardExtra: 5_000, overloadSkip: 120_000 };
/**
 * 띠 확대. 2배(긴 변 3072 상한) JPEG q92 — 오프라인 검증 조건(2배 lanczos·q92)에 가장 가깝다. 6 MP 넘는 기본안은 띠 생략.
 * 운영 CPU 여유가 적으면 env.POSITION_ZOOM_MAX_EDGE(예: 2048)로 띠 크기만 줄인다 — 검증 조건에서 멀어지므로 재생으로 다시 본다.
 */
export const POSITION_ZOOM = { scale: 2, maxEdge: 3072, quality: 92, maxDecodePx: 6_000_000, minCropFrac: 0.05 };
const RECORD_MAX = 2048;
const T_UP = 350 / 650; // 상부장 앞면(후드 앞선) 깊이 / 상판 앞선 깊이 — 플래너 도면이 깊이를 주면 그 비율
/**
 * 도면 깊이 비율(upper.depthMm / lower.depthMm)의 범위. 도면 depthMm 은 몸통 깊이라 상판 앞선 깊이(정본: 배치 공간 깊이 =
 * 물끊기 + 도어 자리 + 몸통 + 뒤 여유, docs/design-rules/corner.md)와 다르다 — 분모가 작아 비율이 커지고, 상부가 하부 이상이면
 * 1 을 넘어 투영이 발산한다. 수치 범위만 막는다(상판 깊이를 지어내지 않는다) — 남는 차는 σ_t 가 덮는다.
 */
const T_RANGE = [0.3, 0.9];
/** vz 지평선 검사: 벽 방향 vh 가 유한하고 vz 와의 세로 차가 이보다 크면(이미지 높이 %) vz 를 버린다 — R1 원응답 15/15 가 틀린 vz */
const VZ_HORIZON_PP = 8;
/**
 * vz 정면 검사: vh 가 무한원(정면 벽)인데 vz 가 이미지 가운데 세로줄에서 이보다 멀면(폭 %) 버린다. 지평선 검사가 못 보는 쪽.
 * R1 원응답(vh 무한원 43회): vz 오차 > 30 pp 3회(가운데에서 37·57·88 pp)를 모두 거르고, 맞는 vz(가운데에서 ≤ 16.6 pp)는 거르지 않는다
 */
const VZ_FRONTAL_PP = 25;
/** vh 위치 검사: vh 가 상판 뒷선 구간 [CBL, CBR] ± 이만큼(이미지 폭 %) 안이면 교차비 분모가 0 을 지난다 — 그 장의 벽·런 항목 보류 'vh' */
const VH_RUN_MARGIN_PP = 5;
/** 직선이 2개뿐일 때 σ_u: 둘째 직선(앞선·상부장 아랫선) 끝점 y 를 이만큼(이미지 높이 %) 흔든다. y 오차 자료가 없어 점 σ(x)의 대표값 — R3 */
const LINE_Y_SD_PP = 0.3;
const FLAGS = ['visible', 'clipped', 'occluded', 'absent'];

/**
 * 항목: 문턱(mm)·기본 σ0(mm, 오프라인 재생 오차 — 중앙 |오차|/0.674, 꼬리가 두꺼운 줄 끝은 p90/1.645)·틀.
 * 덩어리(mask)는 정합 차 1~2 %W 를 σ0 에 더했다 (√(점 σ² + 75²)).
 */
export const POSITION_ITEMS = {
  sink_wall: { thr: 300, s0: 100, frame: 'wall' },
  cook_wall: { thr: 300, s0: 30, frame: 'wall' },
  hood_wall: { thr: 300, s0: 25, frame: 'wall' },
  run_left_wall: { thr: 300, s0: 20, frame: 'wall' },
  run_right_wall: { thr: 300, s0: 70, frame: 'wall' },
  // 도면 덩어리(planner_place)만: 칠한 하부 덩어리 끝(ref) 대 그린 줄 끝 — 같은 화면 틀이라 벽 % 원근 가정이 없다.
  //   σ0 55 = 오프라인 6장(SIFT 정합) 점 0.47 + 틀 0.45 + 모서리 정의 0.30 pp ≈ 0.72 pp × 73~76 mm/pp (place_validate/judge.json design_b)
  run_right_place: { thr: 300, s0: 55, frame: 'place' },
  sink_run: { thr: 300, s0: 90, frame: 'run' },
  cook_run: { thr: 300, s0: 40, frame: 'run' },
  hood_run: { thr: 300, s0: 30, frame: 'run' },
  sink_mask: { thr: 300, s0: 115, frame: 'mask' },
  cook_mask: { thr: 300, s0: 85, frame: 'mask' },
  run_left_mask: { thr: 300, s0: 75, frame: 'mask' },
  run_right_mask: { thr: 300, s0: 75, frame: 'mask' },
  hood_cook: { thr: 150, s0: 40, frame: 'rel' },
};
const ITEM_KEYS = Object.keys(POSITION_ITEMS);
/**
 * 점 하나의 x 오차 σ (이미지 폭 %, VLM 합의 대 블라인드의 |차| 중앙/0.674 — 꼬리는 항목 σ0 와 벽 끝 문이 맡는다).
 * 그 자리의 mm 로는 교차비 미분으로 바뀐다(점을 σ 만큼 옮겨 다시 잰다) — 원근이 강한 벽의 먼 쪽에서 σ 가 커진다.
 */
export const POINT_SD_PP = { WL: 0.21, WR: 0.34, CBL: 0.15, CBR: 0.47, SINK_B: 0.53, K_BL: 0.42, K_BR: 0.42, HL: 0.25, HR: 0.37 };
/**
 * 덩어리 끝 대조(run_right_place)의 점 σ (pp). 앞선 끝(CFL·CFR)은 블라인드 대조 자료가 없어 같은 쪽 뒷선 끝의 값을 쓴다.
 * POINT_SD_PP 에 넣지 않는다 — 거기 넣으면 앞선 끝점 흔들기가 다른 항목(vh 적합·후드 투영)의 σ 까지 바꾼다.
 */
const PLACE_POINT_SD_PP = { CBL: 0.15, CBR: 0.47, CFL: 0.15, CFR: 0.47 };
/** 덩어리 끝 대조의 틀 σ (pp) — 방 사진 → 기본안 '가로 맞춤' 가정의 x 오차 (오프라인 6장 SIFT 정합 −0.43~+0.24 pp) */
const PLACE_FRAME_SD_PP = 0.45;
/** 틀 판정: 기본안과 칠한 캔버스의 가로세로비 차가 이 안이면 같은 틀 */
const PLACE_ASPECT_TOL = 0.01;
/** 항목이 기대는 점 (bad_points 판정) */
const ITEM_POINTS = {
  sink: ['SINK_B'], cook: ['K_BL', 'K_BR'], hood: ['HL', 'HR'], run_left: ['CBL'], run_right: ['CBR'],
};
const objOf = (k) => (k.startsWith('sink') ? 'sink' : k.startsWith('cook') ? 'cook' : k.startsWith('hood') ? 'hood' : k.startsWith('run_left') ? 'run_left' : 'run_right');

// ─────────────────────────────── 경로·정답 ───────────────────────────────

/**
 * 경로. 대상이 아니면 null (주방 품목만).
 * @param {object} input runPositionCheck 입력
 * @returns {null|'planner'|'planner_place'|'planner_walls'|'planner_unfolded'|'mock_kitchen'|'spec_text'|'text_pct'}
 */
export function positionRoute(input) {
  if (!input || !KITCHEN_CATEGORIES.includes(input.category)) return null;
  const opts = input.options || {};
  const spec = opts.design_spec || null;
  if (opts.mode === 'planner') {
    // 도면 덩어리(planner-place.js)를 칠해 IMAGE A 로 줬으면 칠한 자리가 먼저다 — 일자, 그리고 PLANNER_PLACE_CORNERS 면 ㄱ자·ㄷ자도
    //   (꺾인 벽을 칠했으면 주벽 줄은 앵커 쪽 벽 면에 붙는다 — positionExpected planner_place)
    if (input.place && input.place.cam && input.placeBlocks) return 'planner_place';
    const F = plannerPositionFrame(spec, input.category, input.wall);
    if (F.multi) return 'planner_walls';
    if (F.shape === 'corner' || F.shape === 'u') return 'planner_unfolded';
    return 'planner';
  }
  if (input.mockVolume && input.guide && input.guide.kind === 'kitchen') return 'mock_kitchen';
  if (spec) return 'spec_text'; // 옛 '도면 요약' 경로 — "photo wins — scale the run" 이라 정답이 모호하다
  return 'text_pct';
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/** ck.place.ref 가 쓸 만한 꼴인가 — 하부 뒷선·앞선 양 끝 {x, y, X}, 벽 모서리 {x, y}, 캔버스 크기 (vx 는 null 허용) */
function placeRefOk(ref) {
  if (!ref || typeof ref !== 'object') return false;
  const pt = (p, mm) => !!p && isNum(p.x) && isNum(p.y) && (!mm || isNum(p.X));
  return (
    isNum(ref.w) && ref.w > 0 && isNum(ref.h) && ref.h > 0 &&
    pt(ref.bl, true) && pt(ref.br, true) && pt(ref.fl, true) && pt(ref.fr, true) && pt(ref.wl) && pt(ref.wr) &&
    (ref.vx == null || isNum(ref.vx)) && ref.br.x !== ref.bl.x && ref.fr.x !== ref.fl.x
  );
}

/** 경로별 정답 (mm) · 정답 단계 보류 · 틀. 측정과 무관하다. */
export function positionExpected(route, input) {
  const wall = (input && input.wall) || {};
  const opts = (input && input.options) || {};
  const wallW = Number(wall.wallW) || 0;
  const wallKnown = wallW > 0 && !(wall.confidence == null && wall.wallW === 3000 && wall.wallH === 2400);
  // 세로 소실점의 가정 초점거리 — 덩어리 합성과 같은 값 (kitchen.js massingFocal: EXIF → 렌즈 판정 ck.lens(광각 13·표준 24) → 24)
  const focal = massingFocal(opts.room_focal35, input && input.lens);
  const E = { route, wallW, wallKnown, frameW: null, mm: {}, hold: {}, src: {}, alt: {}, sw: {}, t: T_UP, straight: true, f35: focal.focalMm, focalBasis: focal.basis };
  const holdAll = (keys, why) => keys.forEach((k) => { if (!E.hold[k]) E.hold[k] = why; });

  if (route === 'text_pct') {
    // 설치 문장 "sink about N% of the way from the left" — 볼 반폭 400·쿡탑 반폭 300 으로 벽 안에 클램프 (덩어리 칠과 같은 폭)
    const W = wallW || 3000;
    E.frameW = W;
    const cl = (p, half) => clamp(p, (half / W) * 100, 100 - (half / W) * 100);
    const sp = isNum(wall.waterPct) ? cl(wall.waterPct, 400) : null;
    const cp = isNum(wall.exhaustPct) ? cl(wall.exhaustPct, 300) : null;
    E.pct = { sink: sp, cook: cp };
    if (sp != null) E.mm.sink_wall = (sp * W) / 100;
    if (cp != null) E.mm.cook_wall = (cp * W) / 100;
    E.mm.hood_cook = 0;
    // 싱크·쿡탑이 한 줄에 함께 놓일 수 없을 만큼 가까우면(중심 거리 < 400 + 300) 지시끼리 부딪힌다 — 판정 보류
    if (sp != null && cp != null && (Math.abs(sp - cp) * W) / 100 < 700) holdAll(['sink_wall', 'cook_wall'], 'conflict');
    return E;
  }

  if (route.startsWith('planner')) {
    const F = plannerPositionFrame(opts.design_spec, input.category, wall);
    E.planner = F;
    E.anchor = F.anchor;
    E.run = F.run;
    E.straight = !F.shape || F.shape === 'straight';
    if (F.depthRatio) E.t = clamp(F.depthRatio, T_RANGE[0], T_RANGE[1]);
    const runKeys = ['sink_run', 'cook_run', 'hood_run'];
    const wallKeys = ['sink_wall', 'cook_wall', 'hood_wall', 'run_left_wall', 'run_right_wall'];
    const obj = { sink: F.sink, cook: F.cooktop, hood: F.hood };
    E.src = { sink: F.sink ? F.sink.src : null, cook: F.cooktop ? F.cooktop.src : null, hood: F.hood ? F.hood.src : null };
    // 런 틀 — 상판 뒷선 끝 [R0, R1] (도면 mm)
    for (const o of ['sink', 'cook', 'hood']) {
      const a = obj[o];
      if (!a) continue;
      E.mm[`${o}_run`] = a.x;
      if (isNum(a.alt) && Math.abs(a.alt - a.x) > 0) E.alt[o] = Math.abs(a.alt - a.x) / 2; // 가전 중심 ↔ 걸린 모듈 중심
    }
    if (F.sink || F.cooktop || F.hood) {
      if (F.hood && F.cooktop) E.mm.hood_cook = 0;
    }
    if (!F.run) holdAll(runKeys, F.runHold || 'no_run_frame');

    if (route === 'planner_place') {
      // 칠한 자리 (planner-place.js plannerPlaceFaces): s = min(1, span/runMm). 주벽 줄은 앵커 쪽 벽 면에 붙는다 —
      //   anchor 'right'(오른쪽만 꺾이고 corner 'main') 면 X = xR − (rightMm − x)·s, 그 밖(일자·왼쪽 꺾임)은 X = xL + x·s.
      //   벽 % 의 틀은 카메라 span 이다 (분석 wallW 아님). 아래 mm 는 xL 기준.
      const cam = input.place.cam;
      const pb = input.placeBlocks;
      const span = cam.xR - cam.xL;
      const s = pb.runMm > span ? span / pb.runMm : 1;
      const right = pb.anchor === 'right' && isNum(pb.rightMm);
      const Xp = (x) => (right ? span - (pb.rightMm - x) * s : x * s);
      const corners = Array.isArray(pb.returns) && pb.returns.length > 0;
      E.frameW = span;
      E.anchor = right ? 'right' : 'left';
      E.place = { span, s, ...(corners ? { returns: pb.returns.length } : {}) };
      for (const o of ['sink', 'cook', 'hood']) if (obj[o]) E.mm[`${o}_wall`] = Xp(obj[o].x);
      // 줄 끝 = 상판 뒷선 끝 (측정 CBL·CBR) — 런 틀(F.run: 끝 냉장고 칸은 상판 밖, ㄱ자 모서리 규칙)을 칠 좌표로 옮긴다.
      //   런 틀을 못 만들면 칠한 하부 덩어리 끝을 정답으로 적되 판정은 보류 (그 사유)
      if (F.run) {
        E.mm.run_left_wall = Xp(F.run[0]);
        E.mm.run_right_wall = Xp(F.run[1]);
      } else {
        const lowerB = pb.blocks.find((b) => b.key === 'lower');
        if (lowerB) {
          E.mm.run_left_wall = Xp(lowerB.x0);
          E.mm.run_right_wall = Xp(lowerB.x1);
        }
        holdAll(['run_left_wall', 'run_right_wall'], F.runHold || 'no_run_frame');
      }
      // 프롬프트(분석 wallW 기준 줄 길이 문장)와 칠(span 기준)이 갈리면 무엇이 지시인지 모른다 — 벽 기준 보류
      const paintShort = pb.runMm < span;
      let conflict = F.runShort !== paintShort || Math.abs(s - 1) > 0.03;
      if (!conflict && F.runShort && wallW > 0) {
        const promptEnd = (pb.runMm / wallW) * span; // 프롬프트의 벽 % 를 칠 틀로 (줄 길이)
        if (Math.abs(promptEnd - pb.runMm * s) > 150) conflict = true;
      }
      if (conflict) holdAll(wallKeys, 'place_conflict');
      // ㄱ자·ㄷ자를 칠한 장: 측정 질의가 꺾인 다리 쪽 벽 끝·상판 끝을 어떻게 잡는지 재생 근거가 없다(재생 0장) — 벽 기준은 기록만
      if (corners) holdAll(wallKeys, 'place_corner');
      // 덩어리 끝 대조 run_right_place (v3): 정답 = 칠한 하부 덩어리의 자유 끝 도면 mm (ck.place.ref — planner-place.js plannerPlaceRef,
      //   X 는 앵커 기준·배율 s 적용 전). 오른쪽 앵커면 자유 끝은 왼쪽(bl). ref 가 없으면(옛 행·하부 줄 없음) 항목은 두되 no_ref 로 기록만.
      //   place_conflict·place_corner 는 벽 % 틀의 사유라 이 항목에는 쓰지 않는다 (같은 화면 틀 직접 비교).
      E.placeSide = right ? 'left' : 'right';
      const ref = placeRefOk(input.place.ref) ? input.place.ref : null;
      const lowerB = pb.blocks.find((b) => b.key === 'lower');
      if (ref) {
        E.ref = ref;
        E.mm.run_right_place = right ? ref.bl.X : ref.br.X;
      } else if (lowerB) {
        E.mm.run_right_place = right ? lowerB.x0 : lowerB.x1;
        E.hold.run_right_place = 'no_ref';
      }
      return E;
    }

    E.frameW = wallW || null;
    const X = (x) => (F.anchor === 'right' ? wallW - F.runMm + x : x);
    for (const o of ['sink', 'cook', 'hood']) if (obj[o]) E.mm[`${o}_wall`] = X(obj[o].x);
    if (F.run) {
      E.mm.run_left_wall = X(F.run[0]);
      E.mm.run_right_wall = X(F.run[1]);
    }
    const why = !F.wallKnown ? 'wall_unknown' : !F.anchor ? 'no_anchor' : !F.runShort ? 'scale_free' : null;
    if (why) holdAll(wallKeys, why);
    // 분석 wallW 흔들림(같은 사진 ±150 mm): 생성기가 벽 % 로 그리면 앵커에서 D 인 점이 D·Δw/w 만큼 갈린다
    if (wallW > 0) {
      for (const k of wallKeys) {
        if (!isNum(E.mm[k])) continue;
        const D = F.anchor === 'right' ? wallW - E.mm[k] : E.mm[k];
        E.sw[k] = (Math.abs(D) * 150) / wallW;
      }
    }
    return E;
  }

  if (route === 'mock_kitchen') {
    const g = input.guide || {};
    const cam = g.cam || {};
    const span = isNum(cam.xR) && isNum(cam.xL) ? cam.xR - cam.xL : null;
    E.frameW = span;
    E.span = span;
    const keys = ['sink_mask', 'cook_mask', 'run_left_mask', 'run_right_mask'];
    const mask = Array.isArray(g.mask) ? g.mask : null;
    // 칠한 면 순서 (kitchen.js kitchenFaces → renderFacesMassing, 문짝 틈 제외): 끝에서 cooktop · sink · counter-edge · counter-top
    const poly = (i) => {
      const p = mask && mask.length >= 6 ? mask[mask.length + i] : null;
      return Array.isArray(p) && p.length === 4 && p.every((q) => q && isNum(q.x) && isNum(q.y)) ? p : null;
    };
    const ct = poly(-4);
    if (!span || !(span > 0) || !ct || !poly(-2) || !poly(-1)) {
      holdAll(keys, 'no_mask');
      return E;
    }
    const P = (q) => [q.x * 100, q.y * 100];
    const vh = inter(line(P(ct[0]), P(ct[1])), line(P(ct[3]), P(ct[2])));
    E.mask = { L: ct[0].x * 100, R: ct[1].x * 100, u: uOfVh(vh, 100) };
    // 칠한 자리 그대로 (kitchen.js kitchenFaces: X = xL + span·pct/100, 모르면 30·70 %, 클램프 없음 — 볼 ±400·쿡탑 ±300 을 칠한다)
    const sinkX = (span * (isNum(wall.waterPct) ? wall.waterPct : 30)) / 100;
    const cookX = (span * (isNum(wall.exhaustPct) ? wall.exhaustPct : 70)) / 100;
    E.mm = { sink_mask: sinkX, cook_mask: cookX, run_left_mask: 0, run_right_mask: span, hood_cook: 0 };
    // 덩어리는 싱크·쿡탑을 분석 % 로 칠하고 글(FURNITURE)은 도면 요약의 자리를 말한다 — 둘이 다르면 지시를 모른다
    if (opts.design_spec) holdAll(['sink_mask', 'cook_mask'], 'spec_conflict');
    // 칠한 볼·쿡탑이 상판 끝을 넘었다 — 생성기가 어디로 옮길지 정본이 없다(안으로 당긴다고 가정하지 않는다)
    if (sinkX - 400 < 0 || sinkX + 400 > span) holdAll(['sink_mask'], 'mask_edge');
    if (cookX - 300 < 0 || cookX + 300 > span) holdAll(['cook_mask'], 'mask_edge');
    // 칠한 줄이 사진 가장자리까지면(벽 끝을 못 찾음) 줄 끝 대응이 성립하지 않는다
    if (ct[0].x <= 0.01) holdAll(['run_left_mask'], 'mask_edge');
    if (ct[1].x >= 0.99) holdAll(['run_right_mask'], 'mask_edge');
    return E;
  }

  // spec_text · planner_unfolded 밖 — 정답 없음 (측정만)
  return E;
}

// ─────────────────────────────── 응답 → 점 ───────────────────────────────

function rawOk(pt, flag) {
  if (!Array.isArray(pt) || pt.length < 2 || !isNum(pt[0]) || !isNum(pt[1])) return false;
  // 0~1000 정규 좌표. clipped·occluded 는 조금 밖일 수 있다(질의가 허용) — 터무니없는 값만 버린다
  const lo = flag === 'visible' ? -10 : -250;
  const hi = flag === 'visible' ? 1010 : 1250;
  return pt[0] >= lo && pt[0] <= hi && pt[1] >= lo && pt[1] <= hi;
}

/** [y, x] 0~1000 → 원본 이미지 % (띠면 crop 픽셀로 되돌린다) */
export function toPct(pt, fr) {
  if (!Array.isArray(pt) || pt.length < 2 || !isNum(pt[0]) || !isNum(pt[1])) return null;
  let xo = pt[1] / 1000;
  let yo = pt[0] / 1000;
  if (fr && fr.crop) {
    xo = (fr.crop.x0 + xo * fr.crop.w) / fr.W;
    yo = (fr.crop.y0 + yo * fr.crop.h) / fr.H;
  }
  return { x: xo * 100, y: yo * 100 };
}

/**
 * Flash 응답 객체 → 점 {x, y(원본 %), flag, type, bad?}. 객체가 아니면 null.
 * 범위 밖·숫자 아님·순서가 뒤집힌 짝(WL ≥ WR, CBL ≥ CBR)은 bad — 그 점에 기대는 항목은 bad_points 로 보류된다.
 */
export function toLandmarks(parsed, fr) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const L = {};
  const put = (name, pt, flag, type) => {
    const f = FLAGS.includes(flag) ? flag : null;
    const e = { x: null, y: null, flag: f, type: typeof type === 'string' ? type : null };
    if (f !== 'absent' && pt != null) {
      const p = rawOk(pt, f) ? toPct(pt, fr) : null;
      if (!p || p.x < -25 || p.x > 125 || p.y < -25 || p.y > 125) e.bad = true;
      else {
        e.x = p.x;
        e.y = p.y;
      }
    }
    L[name] = e;
  };
  const o = (k) => (parsed[k] && typeof parsed[k] === 'object' && !Array.isArray(parsed[k]) ? parsed[k] : null);
  for (const k of ['WL', 'WR']) if (o(k)) put(k, o(k).p, o(k).flag, o(k).wall_type);
  for (const k of ['CBL', 'CBR', 'CFL', 'CFR', 'U1', 'U2']) if (o(k)) put(k, o(k).p, o(k).flag);
  if (o('F')) put('F', o('F').p, o('F').flag, o('F').mount);
  if (o('SINK')) put('SINK_B', o('SINK').back_mid, o('SINK').flag);
  if (o('K')) for (const c of ['BL', 'BR', 'FR', 'FL']) put(`K_${c}`, o('K')[c], o('K').flag, o('K').kind);
  if (o('HOOD')) {
    put('HL', o('HOOD').HL, o('HOOD').flag, o('HOOD').hood_type);
    put('HR', o('HOOD').HR, o('HOOD').flag, o('HOOD').hood_type);
  }
  for (const [a, b] of [['WL', 'WR'], ['CBL', 'CBR']]) {
    if (L[a] && L[b] && L[a].x != null && L[b].x != null && L[a].x >= L[b].x) {
      for (const k of [a, b]) Object.assign(L[k], { x: null, y: null, bad: true });
    }
  }
  L._kitchen = typeof parsed.kitchen_installed === 'boolean' ? parsed.kitchen_installed : null;
  L._layout = typeof parsed.layout === 'string' ? parsed.layout : null;
  return L;
}

export const present = (e) => !!e && e.flag !== 'absent' && e.x != null && e.y != null;

/** 띠 값이 있고 absent·clipped 가 아니면 띠 값, 아니면 전체 값 (오프라인 flashFinal 과 같은 규칙) */
export function mergeZoom(F, Z) {
  const out = { ...F };
  for (const [k, z] of Object.entries(Z || {})) {
    if (k.startsWith('_')) continue;
    if (z && z.x != null && z.flag !== 'absent' && z.flag !== 'clipped' && !z.bad) out[k] = z;
  }
  return out;
}

/** 1차 점 → 띠 범위 (원본 % → 픽셀). 오프라인 zoomCrop 규칙에서 도면 질의 키(LR·UR·TALL)를 뺐다. */
export function zoomCropRect(A, W, H) {
  const ok = (k) => A[k] && A[k].flag !== 'absent' && A[k].x != null;
  const xs = ['WL', 'WR', 'CBL', 'CBR', 'CFL', 'CFR', 'U1', 'U2', 'HL', 'HR', 'F', 'K_BL', 'K_FR'].filter(ok).map((k) => clamp(A[k].x, 0, 100));
  const yTop = ['U1', 'U2', 'HL', 'HR'].filter(ok).map((k) => A[k].y);
  const yBot = ['CFL', 'CFR', 'K_FL', 'K_FR', 'CBL', 'CBR', 'WL', 'WR'].filter(ok).map((k) => A[k].y);
  let x0 = xs.length ? Math.min(...xs) - 4 : 0;
  let x1 = xs.length ? Math.max(...xs) + 4 : 100;
  let yA = yTop.length ? Math.min(...yTop) : null;
  let yB = yBot.length ? Math.max(...yBot) : null;
  if (yA == null && yB != null) yA = yB - 18;
  if (yB == null && yA != null) yB = yA + 18;
  if (yA == null) {
    yA = 35;
    yB = 65;
  }
  const span = Math.max(8, yB - yA);
  let y0 = yA - Math.max(3, span * 0.25);
  let y1 = yB + Math.max(3, span * 0.25);
  x0 = Math.max(0, x0);
  x1 = Math.min(100, x1);
  y0 = Math.max(0, y0);
  y1 = Math.min(100, y1);
  const crop = { x0: Math.round((x0 / 100) * W), y0: Math.round((y0 / 100) * H) };
  crop.w = Math.round((x1 / 100) * W) - crop.x0;
  crop.h = Math.round((y1 / 100) * H) - crop.y0;
  return crop.w > 0 && crop.h > 0 ? crop : null;
}

// ─────────────────────────────── 기하 (VLM 점만) ───────────────────────────────

export function line(p, q) {
  const a = q[1] - p[1];
  const b = p[0] - q[0];
  return [a, b, -(a * p[0] + b * p[1])];
}
export function inter(l1, l2) {
  const d = l1[0] * l2[1] - l2[0] * l1[1];
  if (Math.abs(d) < 1e-12) return null;
  return [(l1[1] * l2[2] - l2[1] * l1[2]) / d, (l2[0] * l1[2] - l1[0] * l2[2]) / d];
}
/** 여러 직선의 정규화 최소제곱 교점 */
export function lsqPoint(lines) {
  let A00 = 0, A01 = 0, A11 = 0, B0 = 0, B1 = 0;
  for (const [a, b, c] of lines) {
    const n = Math.hypot(a, b);
    if (!(n > 1e-12)) continue;
    const u = a / n, v = b / n, w = c / n;
    A00 += u * u; A01 += u * v; A11 += v * v; B0 -= u * w; B1 -= v * w;
  }
  const det = A00 * A11 - A01 * A01;
  if (Math.abs(det) < 1e-12) return null;
  return [(B0 * A11 - A01 * B1) / det, (A00 * B1 - A01 * B0) / det];
}
/** 선분 방향과 (선분 중점 → v) 방향의 각도 차 (도, 0~90) */
export function angRes(s, v) {
  const mx = (s[0][0] + s[1][0]) / 2, my = (s[0][1] + s[1][1]) / 2;
  const d1 = Math.atan2(s[1][1] - s[0][1], s[1][0] - s[0][0]);
  const d2 = Math.atan2(v[1] - my, v[0] - mx);
  let d = Math.abs(d1 - d2) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return (d * 180) / Math.PI;
}
/** 깊이 방향 선분들의 교점 — 잔차 2.5° 넘는 선분을 하나씩 뺀다(2개 남을 때까지) */
export function fitVz(segs) {
  const use = segs.slice();
  for (let i = 0; i < 30; i++) {
    if (use.length < 2) return null;
    const v = lsqPoint(use.map((s) => line(s[0], s[1])));
    if (!v) return null;
    const res = use.map((s) => angRes(s, v));
    let wi = 0;
    for (let j = 1; j < res.length; j++) if (res[j] > res[wi]) wi = j;
    if (res[wi] <= 2.5 || use.length <= 2) return { v, n: use.length };
    use.splice(wi, 1);
  }
  return null;
}
/** 교차비 % — x·L·R 은 이미지 x%, u = 100/(vh_x% − 50), 0 = 선형 (오프라인 s_cr 과 같은 식) */
export function sCr(x, L, R, u) {
  if (x == null || L == null || R == null || R === L) return null;
  const den = u * (x - 50) - 100;
  if (Math.abs(den) < 1e-9) return null;
  return (100 * (x - L) / (R - L) * (u * (R - 50) - 100)) / den;
}
/** 소실점 → u. 이미지 폭의 5배 밖이면 무한원(선형), |u| < 0.029 면 선형 (교차비 보정 < 0.5 pp) */
export function uOfVh(vh, W) {
  if (!vh || !(Math.abs(vh[0] - W / 2) < 5 * W)) return 0;
  const den = (vh[0] / W) * 100 - 50;
  if (Math.abs(den) < 1e-9) return 0;
  const u = 100 / den;
  return Math.abs(u) < 0.029 ? 0 : u;
}

/** 동차 좌표 외적 — 두 점을 잇는 직선, 두 직선의 교점 */
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * 점(원본 %) → 상판 뒷선 위 x% (깊이 투영) · 소실점.
 * @param {object} L 합친 점 (toLandmarks · mergeZoom)
 * @param {number} W @param {number} H 원본 픽셀
 * @param {{u?:number, vzPx?:number[]|null, vvH?:number[]|null, t?:number, shift?:boolean, f35?:number|null}} [o]
 *   u·vzPx·vvH: 고정(점 σ 를 잴 때 소실점은 그대로 둔다. vvH null = 이미지 세로 — 옛 계산) · t: 후드 앞선 깊이 비율 ·
 *   shift: vz 가 없을 때 깊이 어긋남만큼 옮긴 값(σ_z) · f35: 세로 소실점의 가정 초점거리(35mm 환산, 없으면 24 — job.js 덩어리와 같은 값)
 */
export function derive(L, W, H, o = {}) {
  const P = (k) => (present(L[k]) ? [(L[k].x / 100) * W, (L[k].y / 100) * H] : null);
  const wl = P('WL'), wr = P('WR'), cbl = P('CBL'), cbr = P('CBR');
  const bl = cbl || wl;
  const br = cbr || wr;
  if (!bl || !br || br[0] - bl[0] < 0.01 * W) return { fail: 'no_back' };
  const back = line(bl, br);
  const cfl = P('CFL'), cfr = P('CFR');
  const front = cfl && cfr && Math.abs(cfr[0] - cfl[0]) > 0.01 * W ? line(cfl, cfr) : null;

  // ① 벽 방향 소실점 vh — 상판 뒷선·앞선·상부장 아랫선의 최소제곱 교점
  const par = [back];
  const seconds = []; // 뒷선 밖의 직선 끝점 (직선 2개일 때 σ_u 를 흔들 재료)
  if (front) {
    par.push(front);
    seconds.push([cfl, cfr]);
  }
  const u1 = P('U1'), u2 = P('U2');
  if (u1 && u2 && Math.hypot(u2[0] - u1[0], u2[1] - u1[1]) > 1e-6) {
    par.push(line(u1, u2));
    seconds.push([u1, u2]);
  }
  const vh = par.length >= 2 ? lsqPoint(par) : null;
  const vhFin = vh && Math.abs(vh[0] - W / 2) < 5 * W ? vh : null; // uOfVh 와 같은 '유한' 범위
  const uFit = uOfVh(vh, W);
  const uPairs = par.length === 3 ? [[0, 1], [0, 2], [1, 2]].map(([i, j]) => uOfVh(inter(par[i], par[j]), W)) : [];
  // 직선이 2개뿐이면 쌍 퍼짐이 없다 — 둘째 직선 끝점 y 를 ±LINE_Y_SD_PP 흔들어 u 의 퍼짐을 잰다
  const uAlts = [];
  if (par.length === 2) {
    const dy = (LINE_Y_SD_PP / 100) * H;
    const [a, b] = seconds[0];
    for (const [p, q] of [[a, b], [b, a]]) {
      for (const sg of [-1, 1]) uAlts.push(uOfVh(inter(back, line([p[0], p[1] + sg * dy], q)), W));
    }
  }
  const u = o.u !== undefined ? o.u : uFit;
  // vh 가 상판 뒷선 구간 [CBL, CBR] 안·근처 — 직선 위 점들은 소실점 한쪽에만 맺힌다(사이에 있으면 카메라 뒤).
  //   점 하나만 잘못 찍혀도 선들이 이미지 안에서 만나고, 그러면 교차비 분모가 0 을 지나 엉뚱한 % 가 나온다 → 그 장 벽·런 보류
  const margin = (VH_RUN_MARGIN_PP / 100) * W;
  const vhBad = !!vhFin && vhFin[0] > Math.min(bl[0], br[0]) - margin && vhFin[0] < Math.max(bl[0], br[0]) + margin;

  // ② 깊이 소실점 vz — 쿡탑 옆변 우선, 상판 끝 선분은 그 vz 와 4° 안일 때만 (ㄱ자 안쪽 모서리·가림이면 깊이 선이 아니다)
  let vz = null;
  let vzN = 0;
  let vzDrop = null;
  if (o.vzPx !== undefined) vz = o.vzPx;
  else {
    const seg = (a, b, lst) => {
      if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.01 * W) lst.push([a, b]);
    };
    const yback = Math.min(bl[1], br[1]);
    const okV = (v) => !!v && v[1] < yback - 0.01 * H && v[0] > -0.5 * W && v[0] < 1.5 * W;
    const kseg = [];
    seg(P('K_BL'), P('K_FL'), kseg);
    seg(P('K_BR'), P('K_FR'), kseg);
    const vk = kseg.length === 2 ? inter(line(...kseg[0]), line(...kseg[1])) : null;
    const ends = [];
    seg(cbl, cfl, ends);
    seg(cbr, cfr, ends);
    const segs = okV(vk) ? kseg.concat(ends.filter((e) => angRes(e, vk) <= 4)) : ends;
    const fv = segs.length >= 2 ? fitVz(segs) : null;
    if (fv && okV(fv.v)) {
      vz = fv.v;
      vzN = fv.n;
    }
    // 지평선 검사 — vz·vh 는 둘 다 수평 방향의 소실점이라 한 지평선 위에 있다. vh 가 유한한데 세로로 VZ_HORIZON_PP 넘게
    //   갈리면 vz 가 틀렸다 (R1 원응답: 걸린 15회 모두 틀린 vz, 맞는 vz 를 거른 것 0) → vz 없이(Δ 이동 + σ_z) 잰다
    if (vz && vhFin && (Math.abs(vz[1] - vhFin[1]) / H) * 100 > VZ_HORIZON_PP) {
      vz = null;
      vzN = 0;
      vzDrop = 'horizon';
    }
    // 정면 검사 — vh 가 무한원(벽이 카메라와 나란하다)이면 깊이 방향은 광축과 거의 같아 vz 는 주점 세로줄 가까이 있다
    //   (직교: (vh−c)·(vz−c) = −f², vh 가 폭 5배 밖이면 |vz.x − c.x| ≤ f²/5W ≈ 폭의 10~17 %). 폭 VZ_FRONTAL_PP 밖이면 틀린 vz
    if (vz && !vhFin && Math.abs((vz[0] / W) * 100 - 50) > VZ_FRONTAL_PP) {
      vz = null;
      vzN = 0;
      vzDrop = 'frontal';
    }
  }

  // ③ 세로 소실점 vv — 후드 앞선 점(상판보다 높다)을 상판 높이로 내릴 세로선. 지평선의 법선 n, 주점 c 에서 지평선까지 부호 거리
  //   s 이면 vv = c + (f²/s)·n (직교 세 소실점의 수심 = 주점). 지평선은 vz 를 지나는 **수평선**(roll 0)으로 둔다 — vz–vh 를 이으면
  //   먼 vh 의 y 오차가 기울기(roll)가 되어 vv 가 옆으로 크게 흔들렸다(R1 원응답 재생: 후드−쿡탑 rms 가 오히려 늘었다).
  //   f 는 vh·vz 직교로 푼다(kitchen.js solveKitchenCamera 와 같은 범위 검사) — 안 되면 가정 초점거리. pitch 0 이면 s = 0 → 세로선.
  let vvH = o.vvH !== undefined ? o.vvH : null;
  let fSrc = null;
  if (o.vvH === undefined && vz) {
    const cx = W / 2, cy = H / 2;
    const fDef = (((o.f35 > 0 ? o.f35 : 24) / 43.27) * Math.hypot(W, H));
    let f = fDef;
    fSrc = 'default';
    if (vhFin) {
      const ax = vhFin[0] - cx, ay = vhFin[1] - cy, bx = vz[0] - cx, by = vz[1] - cy;
      const f2 = -(ax * bx + ay * by);
      if (f2 > 0 && Math.hypot(ax, ay) < 2.5 * Math.hypot(W, H)) {
        const fv = Math.sqrt(f2);
        if (fv > 0.5 * fDef && fv < 2.2 * fDef) {
          f = fv;
          fSrc = 'vp';
        }
      }
    }
    const s = cy - vz[1]; // 지평선 y = vz.y, n = (0, 1)
    vvH = [s * cx, s * cy + f * f, s];
  }

  // ④ 상판 위·앞면 점 → 뒷선
  const delta = (x) => {
    // 상판 끝 쌍의 앞뒤 어긋남 Δ(x) = CF.x − CB.x 를 x 로 선형 보간 (px) — vz 가 없을 때의 깊이 오차 크기
    if (!(cbl && cbr && cfl && cfr) || cbr[0] === cbl[0]) return null;
    const dl = cfl[0] - cbl[0];
    const dr = cfr[0] - cbr[0];
    return dl + ((dr - dl) * (x - cbl[0])) / (cbr[0] - cbl[0]);
  };
  const yOnBack = (x) => (Math.abs(back[1]) > 1e-9 ? -(back[0] * x + back[2]) / back[1] : null);
  const shifted = (p, frac) => {
    const d = delta(p[0]);
    return d == null ? p[0] : p[0] - frac * d;
  };
  const footC = (p, zMm) => {
    if (!p) return null;
    if (!vz) return o.shift ? shifted(p, zMm / 650) : p[0];
    const yb = yOnBack(p[0]);
    if (yb != null && p[1] < yb - 0.002 * H) return p[0]; // 뒷선보다 뒤(위)에 찍힌 점 — 투영 방향이 뒤집힌다
    const q = inter(back, line(vz, p));
    return q ? q[0] : p[0];
  };
  const t = isNum(o.t) ? o.t : T_UP;
  // 뒷선 점 b 와 같은 깊이 선 위, 앞선까지의 t 지점 (깊이 선 위 1/거리 는 깊이에 대해 선형 — 역수 보간)
  const depthPt = (b) => {
    const q = inter(front, line(vz, b));
    if (!q) return null;
    const rb = Math.hypot(b[0] - vz[0], b[1] - vz[1]);
    const rq = Math.hypot(q[0] - vz[0], q[1] - vz[1]);
    if (rb < 1e-6 || rq <= rb) return null;
    const rt = 1 / (1 / rb + t * (1 / rq - 1 / rb));
    return [vz[0] + (rt * (b[0] - vz[0])) / rb, vz[1] + (rt * (b[1] - vz[1])) / rb];
  };
  let lineT; // 상판 위 깊이 t 의 직선 (벽과 나란히 — vh 를 지난다)
  const footF = (p) => {
    if (!p) return null;
    if (!vz || !front) return o.shift ? shifted(p, t) : p[0];
    if (lineT === undefined) {
      const q1 = depthPt(bl), q2 = depthPt(br);
      lineT = q1 && q2 && Math.hypot(q2[0] - q1[0], q2[1] - q1[1]) > 1e-6 ? line(q1, q2) : null;
    }
    if (!lineT) return p[0];
    // p 를 지나는 세로선(vv 쪽, 모르면 이미지 세로) ∩ 깊이 t 직선 = 상판 높이로 내린 점 → vz 쪽으로 뒷선에
    const lv = vvH ? cross3([p[0], p[1], 1], vvH) : [1, 0, -p[0]];
    const ft = inter(lv, lineT);
    if (!ft) return p[0];
    const q = inter(back, line(vz, ft));
    return q ? q[0] : p[0];
  };
  const ahead = (p) => {
    // 상판 앞선보다 앞(아래)에 찍힌 점 — 아일랜드 위 싱크·쿡탑
    if (!p || !front || !(Math.abs(front[1]) > 1e-9)) return false;
    return p[1] > -(front[0] * p[0] + front[2]) / front[1] + 0.005 * H;
  };
  const pct = (x) => (x == null ? null : (x / W) * 100);
  const kbl = P('K_BL'), kbr = P('K_BR');
  return {
    u,
    uFit,
    uPairs,
    uAlts,
    vhBad,
    vzPx: vz,
    vz: vz ? [pct(vz[0]), (vz[1] / H) * 100] : null,
    vzN,
    vzDrop,
    vvH,
    fSrc,
    hasFront: !!front,
    deltaOk: delta((bl[0] + br[0]) / 2) != null,
    img: {
      WL: wl ? pct(wl[0]) : null,
      WR: wr ? pct(wr[0]) : null,
      CBL: pct(bl[0]),
      CBR: pct(br[0]),
      sink: pct(footC(P('SINK_B'), 200)),
      cookL: pct(footC(kbl, 80)),
      cookR: pct(footC(kbr, 80)),
      cookM: kbl && kbr ? pct(footC([(kbl[0] + kbr[0]) / 2, (kbl[1] + kbr[1]) / 2], 80)) : null, // 재생 대조용(옛 정의)
      hoodL: pct(footF(P('HL'))),
      hoodR: pct(footF(P('HR'))),
    },
    ahead: { sink: ahead(P('SINK_B')), cook: ahead(kbl) || ahead(kbr) },
  };
}

/**
 * 벽 끝 문 — 벽 기준 항목을 쓸지. 벽 끝 오인(타일 끝·상부장 앞면 끝·키큰장 옆면)이 측정 오류의 최대 원인이다.
 * ① 띠 안에서 본 WL·WR(아니면 전체 응답)의 유형이 corner·free_end 이고 flag visible ② 띠 값이 전체 값과 1.5 pp 안
 * ③ 도면의 키큰장 쪽 벽 끝이 상판 뒷선 끝에서 1 pp 안이면(키큰장 옆면을 벽 끝으로 잡음) 실패.
 */
export function wallGate(Df, Dz, Lz, Lf, tallSide) {
  const why = [];
  for (const k of ['WL', 'WR']) {
    const z = (Lz && Lz[k]) || {};
    const zin = z.x != null && z.flag !== 'absent' && z.flag !== 'clipped' && !z.bad;
    const f = (Lf && Lf[k]) || {};
    const typ = zin ? z.type : f.type;
    const flg = zin ? z.flag : f.flag;
    if (!(typ === 'corner' || typ === 'free_end') || flg !== 'visible') why.push(`${k}_type`);
    if (zin) {
      const a = Df && Df.img ? Df.img[k] : null;
      const b = Dz && Dz.img ? Dz.img[k] : null;
      if (a == null || b == null || Math.abs(a - b) > 1.5) why.push(`${k}_diff`);
    }
  }
  const im = (Dz && Dz.img) || {};
  if (tallSide === 'right' && im.WR != null && im.CBR != null && Math.abs(im.WR - im.CBR) < 1) why.push('tall_R');
  if (tallSide === 'left' && im.WL != null && im.CBL != null && Math.abs(im.WL - im.CBL) < 1) why.push('tall_L');
  return { ok: !why.length, why };
}

// ─────────────────────────────── 측정 → mm · 채점 ───────────────────────────────

/** 상판 뒷선 위 x% 들 → 벽 %·런 %·항목 mm (경로의 틀로) */
export function positionMeasure(D, E) {
  const im = D.img;
  const wallF = (x) => (im.WL != null && im.WR != null ? sCr(x, im.WL, im.WR, D.u) : null);
  const runF = (x) => sCr(x, im.CBL, im.CBR, D.u);
  const avg2 = (f, a, b) => {
    const p = f(a), q = f(b);
    return p == null || q == null ? null : (p + q) / 2; // 양 끝을 먼저 % 로 바꾼 뒤 평균 (이미지 중점은 사선에서 치우친다)
  };
  const wall = {
    runL: wallF(im.CBL),
    runR: wallF(im.CBR),
    sink: wallF(im.sink),
    cook: avg2(wallF, im.cookL, im.cookR),
    hood: avg2(wallF, im.hoodL, im.hoodR),
  };
  const run = { sink: runF(im.sink), cook: avg2(runF, im.cookL, im.cookR), hood: avg2(runF, im.hoodL, im.hoodR) };
  const mm = {};
  const W = E.frameW;
  const r = E.route;
  const put = (k, v) => {
    if (isNum(v)) mm[k] = v;
  };
  if (r === 'text_pct') {
    if (W) {
      put('sink_wall', wall.sink == null ? null : (wall.sink * W) / 100);
      put('cook_wall', wall.cook == null ? null : (wall.cook * W) / 100);
      if (wall.hood != null && wall.cook != null) put('hood_cook', ((wall.hood - wall.cook) * W) / 100);
    }
  } else if (r.startsWith('planner')) {
    if (E.run) {
      const [R0, R1] = E.run;
      const m = (p) => (p == null ? null : R0 + ((R1 - R0) * p) / 100);
      put('sink_run', m(run.sink));
      put('cook_run', m(run.cook));
      put('hood_run', m(run.hood));
      if (run.hood != null && run.cook != null) put('hood_cook', ((run.hood - run.cook) * (R1 - R0)) / 100);
    } else if (W && wall.hood != null && wall.cook != null) put('hood_cook', ((wall.hood - wall.cook) * W) / 100);
    if (W) {
      for (const [k, v] of [['sink_wall', wall.sink], ['cook_wall', wall.cook], ['hood_wall', wall.hood], ['run_left_wall', wall.runL], ['run_right_wall', wall.runR]]) {
        put(k, v == null ? null : (v * W) / 100);
      }
    }
  } else if (r === 'mock_kitchen' && E.mask && E.span) {
    // 칠한 상판 뒷선(마스크) 위 교차비로 카메라 X(mm, xL 기준) — 기본안과 방 사진이 같은 카메라라는 가정(정합 차는 σ0 에)
    const Xm = (x) => {
      const s = x == null ? null : sCr(x, E.mask.L, E.mask.R, E.mask.u);
      return s == null ? null : (E.span * s) / 100;
    };
    const avgX = (a, b) => {
      const p = Xm(a), q = Xm(b);
      return p == null || q == null ? null : (p + q) / 2;
    };
    put('sink_mask', Xm(im.sink));
    put('cook_mask', avgX(im.cookL, im.cookR));
    put('run_left_mask', Xm(im.CBL));
    put('run_right_mask', Xm(im.CBR));
    const hood = avgX(im.hoodL, im.hoodR);
    const cook = avgX(im.cookL, im.cookR);
    if (hood != null && cook != null) put('hood_cook', hood - cook);
  }
  return { wall, run, mm };
}

/**
 * 덩어리 끝 대조 (run_right_place, v3) — 칠한 하부 덩어리의 자유 끝(ck.place.ref) 대 기본안에 그린 상판 끝(CBR·CFR, 오른쪽 앵커면 CBL·CFL)
 * 을 **같은 화면 틀**에서 x % 로 직접 견준다. 기본안은 칠한 사진(IMAGE A)을 편집한 그림이라 벽 방향 소실점을 기본안에서 다시 풀 필요가 없다.
 *   틀: 기본안(W×H)과 칠한 캔버스(ref.w×h)의 가로세로비 차 ≤ 1 % 면 same, 기본안이 세로로 더 길면 fit_width(x % 그대로 — 오프라인 6장 SIFT
 *       정합 배율 0.986~1.005), 가로로 더 넓으면 frame 보류(가로를 자르는지 늘이는지 표본 0). 판정은 검증된 조합(provider openai)에서만.
 *   mm: 칠 카메라의 벽 방향 소실점 vx 로 뒷선·앞선 각각 1차원 사영(sCr) — X(x) = X_l + (X_r − X_l)·sCr(x, l.x, r.x, u)/100.
 *   값: 뒤·앞 둘 다 있고 부호가 같으면 |d| 가 작은 쪽(보수적). 부호가 다르면 front_back 보류. 한쪽이 없으면 기존 줄 끝 보류 사유.
 *   σ² = max(σ0, σ_p)² + σ_frame² + σ_def²  (σ_p 점 흔들기 → mm, σ_frame 0.45 pp → mm, σ_def |d_front − d_back|/2)
 * @returns {{m:number|null, e:number, d?:number, sd:number, hold:string|null, place:object}|null} 항목 + 기록(measured.place)
 */
export function placeItem(E, L, D, W, H, c) {
  const ref = E.ref;
  const side = E.placeSide || 'right';
  const e = E.mm.run_right_place;
  if (!isNum(e)) return null;
  const it = { m: null, e, sd: POSITION_ITEMS.run_right_place.s0, hold: null, place: { side } };
  if (!ref) {
    it.hold = E.hold.run_right_place || 'no_ref';
    return it;
  }
  const bk = side === 'right' ? 'CBR' : 'CBL';
  const fk = side === 'right' ? 'CFR' : 'CFL';
  const rb = side === 'right' ? ref.br : ref.bl;
  const rf = side === 'right' ? ref.fr : ref.fl;
  // 틀
  const arB = W / H, arR = ref.w / ref.h;
  const fm = Math.abs(arB / arR - 1) <= PLACE_ASPECT_TOL ? 'same' : arB < arR ? 'fit_width' : 'frame';
  const P = it.place;
  P.fm = fm;
  if (D && D.img && isNum(D.img.WL)) P.wl_d = D.img.WL - ref.wl.x;
  // 1차원 사영 (뒷선·앞선 각각 — 둘 다 벽 방향이라 소실점은 같다)
  const u = ref.vx == null ? 0 : uOfVh([ref.vx, 0], 100);
  const Xof = (x, l, r) => {
    const s = sCr(x, l.x, r.x, u);
    return s == null ? null : l.X + ((r.X - l.X) * s) / 100;
  };
  const Xb = (x) => Xof(x, ref.bl, ref.br);
  const Xf = (x) => Xof(x, ref.fl, ref.fr);
  const B = L[bk], F = L[fk];
  let dB = null, dF = null;
  if (present(B)) {
    P.d_back_pp = B.x - rb.x;
    const X = Xb(B.x);
    if (X != null) dB = X - rb.X;
  }
  if (present(F)) {
    P.d_front_pp = F.x - rf.x;
    const X = Xf(F.x);
    if (X != null) dF = X - rf.X;
  }
  if (dB != null) P.d_back = dB;
  if (dF != null) P.d_front = dF;
  // 보류 — 틀 먼저, 그다음 끝점(기존 줄 끝 규칙), 그다음 뒤·앞 부호
  const runEnd = (k) => {
    const p = L[k];
    if (!present(p)) return p && p.bad ? 'bad_points' : 'run_end_missing';
    if (p.flag === 'clipped' || p.x <= 1 || p.x >= 99) return 'run_end_clipped';
    return null;
  };
  let hold = null;
  if (!c.zoom) hold = 'no_zoom';
  else if (E.hold.run_right_place) hold = E.hold.run_right_place;
  else if (fm === 'frame' || c.provider !== 'openai') hold = 'frame';
  else hold = runEnd(bk) || runEnd(fk);
  // 뒤·앞 부호 — σ0 안의 값은 부호 없음(잡음)으로 본다. 제자리 장은 뒤 +20·앞 −30 처럼 0 근처에서 갈리는데 그것은 어긋남이 아니다
  const s0 = POSITION_ITEMS.run_right_place.s0;
  const sgn = (v) => (v == null || Math.abs(v) < s0 ? 0 : Math.sign(v));
  const both = dB != null && dF != null;
  const sameSign = both && sgn(dB) * sgn(dF) >= 0;
  if (!hold && !both) hold = 'front_back';
  if (!hold && !sameSign) hold = 'front_back';
  // 값 — 보류여도 둘 다 있고 부호가 같으면 기록용 m·d 를 남긴다
  if (sameSign) {
    const useBack = Math.abs(dB) <= Math.abs(dF);
    const d = useBack ? dB : dF;
    it.m = e + d;
    it.d = d;
    // σ: 고른 쪽 점을 σ 만큼 흔든 mm, 틀 가정 0.45 pp 의 mm, 뒤·앞 정의 차의 절반
    const pk = useBack ? bk : fk;
    const px = useBack ? B.x : F.x;
    const Xk = useBack ? Xb : Xf;
    const at = (x) => Xk(x);
    const dxOf = (dpp) => {
      const a = at(px), b = at(px + dpp);
      return a == null || b == null ? null : Math.abs(b - a);
    };
    const sp = dxOf(PLACE_POINT_SD_PP[pk]) ?? 0;
    const sf = dxOf(PLACE_FRAME_SD_PP) ?? 0;
    const sdef = Math.abs(dF - dB) / 2;
    it.sd = Math.sqrt(Math.max(POSITION_ITEMS.run_right_place.s0, sp) ** 2 + sf ** 2 + sdef ** 2);
    if (!hold && it.sd > POSITION_ITEMS.run_right_place.thr / 2) hold = 'sd';
  }
  it.hold = hold;
  return it;
}

/**
 * 채점. 정답이 있는 항목마다 d = 측정 − 정답, σ, 보류 사유, 경보·경계.
 * @param {object} c {E, L, Lf, Lz, D, Df, W, H, zoom, nz, gate, qc, category, alarmsOn}
 * @returns {{items:object, alerts:object[], shadow:string[], ok:boolean|null, M:object}}
 */
export function positionScore(c) {
  const { E, L, D, W, H } = c;
  const M = positionMeasure(D, E);
  const evalMM = (Lm, over) => {
    const d = derive(Lm, W, H, { t: E.t, f35: E.f35, ...over });
    return d.fail ? {} : positionMeasure(d, E).mm;
  };
  // σ 재료 — 소실점 쌍(직선 2개면 끝점 흔들기), 깊이 비율, vz 없을 때 깊이 어긋남, 세로 소실점 보정, 점 하나씩 흔들기(소실점 고정)
  const sdU = {}, sdT = {}, sdZ = {}, sdP = {}, sdV = {};
  const spread = (target, list) => {
    for (const k of ITEM_KEYS) {
      const vs = [M.mm[k], ...list.map((x) => x[k])].filter(isNum);
      if (vs.length > 1) target[k] = (Math.max(...vs) - Math.min(...vs)) / 2;
    }
  };
  const fixed = { vzPx: D.vzPx, vvH: D.vvH };
  if (D.uPairs.length) spread(sdU, D.uPairs.map((u) => evalMM(L, { u, ...fixed })));
  else if (D.uAlts && D.uAlts.length) spread(sdU, [...new Set(D.uAlts)].map((u) => evalMM(L, { u, ...fixed })));
  const hoodType = (L.HL && L.HL.type) || (L.HR && L.HR.type) || null;
  if (D.vzPx && D.hasFront) {
    const hi = hoodType === 'chimney' || hoodType === 'separate_box' ? 0.85 : 0.61;
    spread(sdT, [evalMM(L, { t: 0.47, u: D.u, ...fixed }), evalMM(L, { t: hi, u: D.u, ...fixed })]);
    // 세로 소실점 보정(후드)은 vz 의 세로 위치와 초점거리에 기댄다 — 보정량의 절반을 σ 로 (보정 없는 옛 값까지 반쯤 열어 둔다)
    if (D.vvH) {
      const flat = evalMM(L, { u: D.u, vzPx: D.vzPx, vvH: null });
      for (const k of ITEM_KEYS) if (isNum(M.mm[k]) && isNum(flat[k])) sdV[k] = Math.abs(M.mm[k] - flat[k]) / 2;
    }
  }
  if (!D.vzPx) {
    const sh = evalMM(L, { shift: true, u: D.u, vzPx: null });
    for (const k of ITEM_KEYS) if (isNum(M.mm[k]) && isNum(sh[k])) sdZ[k] = Math.abs(sh[k] - M.mm[k]);
  }
  const acc = {};
  for (const [pk, sd] of Object.entries(POINT_SD_PP)) {
    if (!present(L[pk])) continue;
    const Lm = { ...L, [pk]: { ...L[pk], x: L[pk].x + sd } };
    const v = evalMM(Lm, { u: D.u, ...fixed });
    for (const k of ITEM_KEYS) if (isNum(M.mm[k]) && isNum(v[k])) acc[k] = (acc[k] || 0) + (v[k] - M.mm[k]) ** 2;
  }
  for (const k of Object.keys(acc)) sdP[k] = Math.sqrt(acc[k]);

  // 틀 단위 보류
  const runEnd = (k) => {
    const e = c.L[k];
    if (!present(e)) return e && e.bad ? 'bad_points' : 'run_end_missing';
    if (e.flag === 'clipped' || e.x <= 1 || e.x >= 99) return 'run_end_clipped';
    return null;
  };
  const runHold = runEnd('CBL') || runEnd('CBR');
  const roomChanged = !!(c.qc && Array.isArray(c.qc.issues) && c.qc.issues.includes('room_changed') && !c.qc.retried);
  const folded = E.straight && (L._layout === 'L_shape' || L._layout === 'U_shape');
  const aspect = c.aspectDiff != null && c.aspectDiff > 0.01;

  const items = {};
  for (const k of ITEM_KEYS) {
    if (!isNum(E.mm[k])) continue;
    const spec = POSITION_ITEMS[k];
    if (spec.frame === 'place') {
      // 덩어리 끝 대조 — 벽 틀을 쓰지 않으므로 room_changed·place_corner·vh·wall_end 보류는 해당 없음 (placeItem)
      const pi = placeItem(E, L, D, W, H, c);
      if (pi) items[k] = pi;
      continue;
    }
    const ob = objOf(k);
    const it = { m: isNum(M.mm[k]) ? M.mm[k] : null, e: E.mm[k] };
    items[k] = it;
    let hold = null;
    const pts = k === 'hood_cook' ? ['HL', 'HR', 'K_BL', 'K_BR'] : ITEM_POINTS[ob] || [];
    if (!c.zoom) hold = 'no_zoom';
    else if (E.hold[k]) hold = E.hold[k];
    else if (it.m == null) hold = pts.some((p) => L[p] && L[p].bad) ? 'bad_points' : 'absent';
    else if (pts.some((p) => L[p] && L[p].bad)) hold = 'bad_points';
    else if (spec.frame === 'wall' && !c.gate.ok) hold = 'wall_end';
    else if ((spec.frame === 'wall' || spec.frame === 'mask') && roomChanged) hold = 'room_changed';
    else if (spec.frame === 'mask' && aspect) hold = 'aspect';
    else if ((spec.frame === 'run' || (k === 'hood_cook' && E.route.startsWith('planner') && E.run)) && runHold) hold = runHold;
    else if (k === 'run_left_wall' || k === 'run_left_mask') hold = runEnd('CBL');
    else if (k === 'run_right_wall' || k === 'run_right_mask') hold = runEnd('CBR');
    if (!hold && (spec.frame === 'run' || (k === 'hood_cook' && E.route.startsWith('planner') && E.run)) && folded) hold = 'layout';
    if (!hold && c.category === 'island' && ((ob === 'sink' && D.ahead.sink) || ((ob === 'cook' || k === 'hood_cook') && D.ahead.cook))) hold = 'on_island';
    // 깊이 투영도 그 크기 어림(Δ)도 못 하면 상판 위·앞면 점은 판정하지 않는다 (후드는 앞선까지 있어야 투영한다)
    const depthOk = ob === 'hood' || k === 'hood_cook' ? (!!D.vzPx && D.hasFront) || D.deltaOk : !!D.vzPx || D.deltaOk;
    if (!hold && (ob === 'sink' || ob === 'cook' || ob === 'hood') && !depthOk) hold = 'no_depth';
    // vh 가 상판 뒷선 구간 안 — 교차비(벽 %·런 %)가 성립하지 않는다. 마스크 대조는 칠한 마스크의 u 를 쓰므로 그대로
    if (!hold && D.vhBad && (spec.frame === 'wall' || spec.frame === 'run' || (k === 'hood_cook' && E.route !== 'mock_kitchen'))) hold = 'vh';
    // σ
    let s0 = spec.s0;
    // 벽 끝이 불확실하면 축척이 흔들린다 (approx) — 글 %, 그리고 런 틀 없이 벽 % × 벽 폭으로 재는 플래너 후드−쿡탑
    if (k === 'hood_cook' && !c.gate.ok && (E.route === 'text_pct' || (E.route.startsWith('planner') && !E.run))) s0 *= 1.5;
    const alt = k === 'hood_cook' ? 0 : E.alt[ob] || 0;
    const sw = E.sw[k] || 0;
    const sp = sdP[k] || 0;
    const sd = Math.sqrt(Math.max(s0, sp) ** 2 + (sdU[k] || 0) ** 2 + (sdZ[k] || 0) ** 2 + (sdT[k] || 0) ** 2 + (sdV[k] || 0) ** 2 + sw ** 2 + alt ** 2);
    it.sd = sd;
    if (it.m != null) it.d = it.m - it.e;
    if (!hold && sd > spec.thr / 2) hold = 'sd';
    // 같은 물체를 벽 틀이 판정했으면 런 값은 기록만 — 줄 끝을 늘린 장에서 같은 위반을 두 번 세고 원인을 거꾸로 짚는다.
    //   (ITEM_KEYS 순서상 벽 항목이 먼저 끝난다. 벽 항목이 보류면 런 틀이 판정한다 — 경보에 frame:'run')
    const w = spec.frame === 'run' ? items[`${ob}_wall`] : null;
    if (!hold && w && !w.hold && w.d != null) hold = 'wall_frame';
    it.hold = hold;
  }
  // 2026-10-20 사장님 결정: 플래너 계열은 도면 반대쪽 자유 끝(줄 끝)이 판정됐을 때만 ok 를 낸다 (아래 freeEndKey).
  //   v3: 덩어리 끝 대조(run_right_place)가 판정되면 같은 끝의 벽 % 항목은 기록만(place_frame) — 같은 위반을 두 번 세지 않는다
  const freeEndKey = E.route.startsWith('planner')
    ? E.anchor === 'right' ? 'run_left_wall' : 'run_right_wall'
    : null;
  const judgedItem = (it) => !!(it && !it.hold && it.d != null);
  const placeJudged = E.route === 'planner_place' && judgedItem(items.run_right_place);
  if (placeJudged && freeEndKey && items[freeEndKey] && !items[freeEndKey].hold) items[freeEndKey].hold = 'place_frame';

  // 글 % 경로 — 지시 "N % from the left" 는 벽인지 런인지 말하지 않는다: 런(CBL~CBR) 틀로도 넘을 때만 경보
  if (E.route === 'text_pct' && !runHold) {
    const runLen = M.wall.runL != null && M.wall.runR != null ? ((M.wall.runR - M.wall.runL) * E.frameW) / 100 : E.frameW;
    for (const [k, ob] of [['sink_wall', 'sink'], ['cook_wall', 'cook']]) {
      const it = items[k];
      if (!it || it.hold || it.d == null || M.run[ob] == null || E.pct[ob] == null) continue;
      it.dRun = ((M.run[ob] - E.pct[ob]) * runLen) / 100;
      if (Math.abs(it.d) > POSITION_ITEMS[k].thr && Math.abs(it.dRun) <= POSITION_ITEMS[k].thr) it.hold = 'frames';
    }
  }

  const alerts = [];
  const shadow = [];
  let judged = 0;
  const endD = ['run_left_wall', 'run_right_wall']
    .map((k) => items[k] && items[k].d)
    .filter(isNum)
    .sort((a, b) => Math.abs(b) - Math.abs(a))[0];
  for (const k of ITEM_KEYS) {
    const it = items[k];
    if (!it || it.hold || it.d == null) continue;
    judged++;
    const thr = POSITION_ITEMS[k].thr;
    if (Math.abs(it.d) <= thr) continue;
    const a = { k, d: Math.round(it.d), thr, sd: Math.round(it.sd), edge: Math.abs(it.d) - thr < it.sd };
    if (POSITION_ITEMS[k].frame === 'run') {
      a.frame = 'run';
      // 줄 끝이 늘면 벽 위 제자리인 물체가 런 틀에서는 반대쪽으로 옮겨진 것처럼 보인다
      if (isNum(endD) && Math.abs(endD) >= 150 && Math.sign(endD) !== Math.sign(it.d)) a.cause = 'run_end';
    }
    if (E.route === 'text_pct') a.pp = Math.round(((it.d / E.frameW) * 100) * 10) / 10;
    if (c.alarmsOn) alerts.push(a);
    else shadow.push(k);
  }
  //   줄 끝이 보류(벽 끝 불확실·room_changed·σ…)인데 줄 왼끝·줄 안 싱크만 맞아 ok:true 가 찍히면 — 줄을 600 mm 늘린 장도
  //   '통과'로 집계된다(planner_place 재생 cf5b2f3f·00de889d). 앵커 쪽 끝(CBL = WL)은 거의 늘 맞으므로 판정 수에서 뺀다.
  //   경보가 하나라도 있으면 ok:false 는 그대로(위반은 위반이다). '통과(true)'만 자유 끝 판정을 요구한다.
  //   v3: planner_place 에서 덩어리 끝 대조가 판정됐으면 그것이 자유 끝이다 (벽 % 항목은 place_frame 으로 기록만).
  const freeEnd = placeJudged ? 'run_right_place' : freeEndKey;
  const freeEndJudged = !freeEnd || judgedItem(items[freeEnd]);
  const ok = !c.alarmsOn || !judged ? null : alerts.length ? false : freeEndJudged ? true : null;
  return { items, alerts, shadow, ok, M, ...(freeEnd ? { freeEnd } : {}) };
}

// ─────────────────────────────── 기록 ───────────────────────────────

const r1 = (v) => (isNum(v) ? Math.round(v * 10) / 10 : null);
const r0 = (v) => (isNum(v) ? Math.round(v) : null);
const compact = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v != null) out[k] = v;
  return out;
};

/**
 * 기록 2 KB 이하 — 넘으면 이 순서로 뺀다 (σ → 벽·런 % → 점 → 덩어리 끝 대조(v3) → 유형 → 정답 출처 → 문 사유 → 크기 →
 * 경보는 {k, d, edge} → 측정은 판정 값(mm·hold)과 띠·문만 → 정답은 mm 만 → 측정은 띠·문만 → 경보는 {k, d} →
 * 정답 → 측정·shadow·토큰). 마지막 단계까지 가면 항목 14개의 경보 {k, d} 와 머리 필드만 남아 늘 2 KB 안이다.
 */
export function capRecord(rec, max = RECORD_MAX) {
  const gateOk = (m) => (m && m.gate ? { ok: m.gate.ok } : null);
  const drops = [
    (r) => r.measured && delete r.measured.sd,
    (r) => r.measured && (delete r.measured.wall_pct, delete r.measured.run_pct),
    (r) => r.measured && delete r.measured.img,
    (r) => r.measured && delete r.measured.place,
    (r) => r.measured && delete r.measured.types,
    (r) => r.expected && delete r.expected.src,
    (r) => r.measured && r.measured.gate && delete r.measured.gate.why,
    (r) => delete r.size,
    (r) => Array.isArray(r.alerts) && (r.alerts = r.alerts.map((a) => compact({ k: a.k, d: a.d, edge: a.edge }))),
    (r) => r.measured && (r.measured = compact({ zoom: r.measured.zoom, nz: r.measured.nz, gate: gateOk(r.measured), mm: r.measured.mm, hold: r.measured.hold })),
    (r) => r.expected && (r.expected = compact({ mm: r.expected.mm })),
    (r) => r.measured && (r.measured = compact({ zoom: r.measured.zoom, nz: r.measured.nz, gate: gateOk(r.measured) })),
    (r) => Array.isArray(r.alerts) && (r.alerts = r.alerts.map((a) => ({ k: a.k, d: a.d }))),
    (r) => delete r.expected,
    (r) => (delete r.measured, delete r.shadow, delete r.tokens),
  ];
  let i = 0;
  while (JSON.stringify(rec).length > max && i < drops.length) {
    drops[i++](rec);
    rec.cut = i;
  }
  return rec;
}

function recordOf(st, extra) {
  return capRecord({
    v: POSITION_VERSION,
    route: st.route,
    ok: null,
    alerts: [],
    ...extra,
    model: st.model,
    calls: st.calls,
    ms: st.now() - st.t0,
    ...(st.msDecode != null ? { ms_decode: st.msDecode } : {}),
    ...(st.zoomPx ? { zoom_px: st.zoomPx } : {}),
    tokens: { in: st.tin, out: st.tout },
    ...(st.size ? { size: st.size } : {}),
    ...(st.provider ? { provider: st.provider } : {}),
    ...(st.error ? { error: st.error } : {}),
  });
}

// ─────────────────────────────── 이미지 (띠) ───────────────────────────────

const isJpegBytes = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** RGBA 원본에서 crop 을 쌍선형으로 scale 배 → RGBA */
export function cropScale(src, SW, crop, scale) {
  const ow = Math.max(1, Math.round(crop.w * scale));
  const oh = Math.max(1, Math.round(crop.h * scale));
  const out = new Uint8Array(ow * oh * 4);
  const cw = crop.w, ch = crop.h, x0 = crop.x0, y0 = crop.y0;
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(ch - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const ya = Math.floor(sy);
    const yb = Math.min(ch - 1, ya + 1);
    const fy = sy - ya;
    const ra = (y0 + ya) * SW;
    const rb = (y0 + yb) * SW;
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(cw - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const xa = Math.floor(sx);
      const xb = Math.min(cw - 1, xa + 1);
      const fx = sx - xa;
      const p00 = (ra + x0 + xa) * 4, p01 = (ra + x0 + xb) * 4, p10 = (rb + x0 + xa) * 4, p11 = (rb + x0 + xb) * 4;
      const o = (y * ow + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = src[p00 + k] + (src[p01 + k] - src[p00 + k]) * fx;
        const bot = src[p10 + k] + (src[p11 + k] - src[p10 + k]) * fx;
        out[o + k] = Math.round(top + (bot - top) * fy);
      }
      out[o + 3] = 255;
    }
  }
  return { width: ow, height: oh, data: out };
}

// JPEG 인코드는 guide.js encodeJpeg (#927 — 워커에 없는 Buffer 를 인코드하는 동안만 대신한다) 를 같이 쓴다.

async function bandImage(base, rect, Z, format) {
  const bytes = b64ToBytes(base.base64);
  let dec = decodeJpeg(bytes, { useTArray: true, formatAsRGBA: true });
  const W = dec.width;
  const H = dec.height;
  let scale = Z.scale;
  if (Math.max(rect.w, rect.h) * scale > Z.maxEdge) scale = Z.maxEdge / Math.max(rect.w, rect.h);
  const band = cropScale(dec.data, W, rect, scale);
  dec = null; // 원본 RGBA(2K 약 16 MB)는 띠를 만든 즉시 놓는다
  let out;
  let mimeType;
  if (format === 'png') {
    const rgb = new Uint8Array(band.width * band.height * 3);
    for (let i = 0, j = 0; i < band.data.length; i += 4, j += 3) {
      rgb[j] = band.data[i];
      rgb[j + 1] = band.data[i + 1];
      rgb[j + 2] = band.data[i + 2];
    }
    out = await encodePng({ width: band.width, height: band.height, rgb });
    mimeType = 'image/png';
  } else {
    out = encodeJpeg(band, Z.quality);
    mimeType = 'image/jpeg';
  }
  return { image: { base64: bytesToB64(out), mimeType }, W, H, scale, px: [band.width, band.height] };
}

// ─────────────────────────────── 실행 ───────────────────────────────

function codeOf(e, n) {
  if (e && e.code) return e.code;
  const name = e && e.name;
  const msg = String((e && e.message) || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(msg)) return `timeout_${n}`;
  const s = e && e.status;
  if (s === 429) return 'http_429';
  if (s >= 500) return 'http_5xx';
  if (s >= 400) return 'http_4xx';
  return `net_${n}`;
}
const codeErr = (code) => Object.assign(new Error(code), { code });

function timeoutRace(p, ms) {
  let timer = null;
  return Promise.race([
    p,
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error('position call timeout'), { name: 'TimeoutError' })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * 위치 검사 한 번. 늘 기록(객체) 또는 null(대상 아님)로 풀린다 — 던지지 않는다.
 * @param {object} env  POSITION_MODEL · POSITION_ALARM_ROUTES · POSITION_ZOOM_FORMAT('jpeg'|'png') · POSITION_ZOOM_SCALE ·
 *                      POSITION_ZOOM_MAX_EDGE
 * @param {object} input
 * @param {string} input.category        resolveCategory 결과 (sink·island 만 잰다)
 * @param {{base64:string, mimeType:string}} input.base   최종 기본안
 * @param {{base64:string}} [input.room]  원본 방 사진 (머리글만 읽어 크기 비교 — 덩어리 대조의 가로세로비)
 * @param {object} input.wall             wall_analysis (ck.wall)
 * @param {object} input.options          잡 options (mode · design_spec)
 * @param {object} [input.guide]          ck.guide (싱크대 덩어리 {kind:'kitchen', cam, mask})
 * @param {boolean} [input.mockVolume]    덩어리 합성으로 그렸나 (ctx.mockVolume)
 * @param {object} [input.place]          플래너 도면 덩어리를 칠해 그렸으면 ck.place ({cam})
 * @param {object} [input.placeBlocks]    plannerPlaceBlocks(design_spec)
 * @param {object} [input.qc]             기본안 qc ({issues, retried}) — room_changed 면 벽 기준 보류
 * @param {string} [input.provider]       누가 그렸나 (기록용)
 * @param {string} [input.jobId]          로그에만 (기록에는 넣지 않는다)
 * @param {string|null} [input.lens]      ck.lens — 렌즈 판정(ultra_wide·standard). 세로 소실점 가정 초점거리 (massingFocal)
 * @param {object} [deps] 시험·재생용 — {callGemini, now, sleep, timing, zoom, overloadAt(model) → ms epoch}
 */
export async function runPositionCheck(env, input, deps = {}) {
  const now = deps.now || Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const call = deps.callGemini || callGemini;
  const T = { ...POSITION_TIMING, ...(deps.timing || {}) };
  const overloadAt = deps.overloadAt || geminiOverloadAt;
  // 같은 모델이 이 isolate 에서 최근 과부하(429·5xx)를 받았나 — 손님 쪽 호출(QC·분석)과 같은 할당량이다
  const overloaded = (model) => {
    const at = Number(overloadAt(model)) || 0;
    return at > 0 && Date.now() - at < T.overloadSkip;
  };
  const t0 = now();
  let route = null;
  try {
    route = positionRoute(input);
  } catch {
    route = null;
  }
  if (!route) return null;
  const e = env || {};
  const st = {
    route, t0, now, calls: 0, tin: 0, tout: 0, msDecode: null, size: null, error: null,
    model: e.POSITION_MODEL || POSITION_MODEL_DEFAULT,
    provider: input.provider || null,
  };
  try {
    const base = input.base;
    if (!base || typeof base.base64 !== 'string' || !base.base64) {
      st.error = 'no_image';
      return recordOf(st, {});
    }
    const dims = imageDimensions(base.base64);
    if (!dims || !(dims.width > 0) || !(dims.height > 0)) {
      st.error = 'decode';
      return recordOf(st, {});
    }
    const W = dims.width;
    const H = dims.height;
    const roomDims = input.room && input.room.base64 ? imageDimensions(input.room.base64) : null;
    st.size = { b: [W, H], ...(roomDims ? { r: [roomDims.width, roomDims.height] } : {}) };
    const deadline = t0 + T.total;
    const E = positionExpected(route, input);

    const ask = async (img, zoom, n) => {
      for (let attempt = 0; ; attempt++) {
        const left = deadline - now();
        if (left < 1000) throw codeErr('budget');
        const ms = Math.min(T.call, left);
        st.calls++;
        try {
          const r = await timeoutRace(
            Promise.resolve().then(() => call(e, {
              prompt: buildPositionPrompt({ zoom }),
              images: [img],
              want: 'text',
              model: st.model,
              retryDelaysMs: [], // 과부하 재시도는 여기서 1회만 (Retry-After 60초를 따르지 않는다)
              noTemperature: true, // 오프라인 검증 조건 — 모델 기본값
              extraConfig: {
                responseMimeType: 'application/json',
                responseSchema: POSITION_SCHEMA,
                mediaResolution: 'MEDIA_RESOLUTION_HIGH',
                thinkingConfig: { thinkingLevel: 'low' }, // 기본값보다 정확·빠름 (기본값은 벽 끝을 틀리고 70초)
                maxOutputTokens: 8192,
              },
              signal: AbortSignal.timeout(ms), // 경로(gateway → direct → proxy)가 바뀌어도 이 신호 하나로 끊는다
              withMeta: true,
            })),
            ms + 250
          );
          const u = (r && r.meta && r.meta.usage) || {};
          st.tin += Number(u.promptTokenCount) || 0;
          st.tout += (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0);
          return r && typeof r.text === 'string' ? r.text : '';
        } catch (err) {
          const retryable = !!(err && (err.retryable || [429, 500, 503].includes(err.status)));
          if (attempt === 0 && retryable && deadline - now() - T.retryWait >= T.minLeft) {
            await sleep(T.retryWait);
            continue;
          }
          throw codeErr(codeOf(err, n));
        }
      }
    };

    // ① 전체 이미지 — 과부하 중이면 보내지 않는다 (손님 쪽 재시도를 늘리지 않는다)
    if (overloaded(st.model)) {
      st.error = 'skipped_overload';
      return recordOf(st, { expected: expectedRecord(E) });
    }
    let text1;
    try {
      text1 = await ask({ base64: base.base64, mimeType: base.mimeType || 'image/jpeg' }, false, 1);
    } catch (err) {
      st.error = err.code || 'internal';
      return recordOf(st, { expected: expectedRecord(E) });
    }
    const Lf = toLandmarks(parsePositionLandmarks(text1), { W, H });
    if (!Lf) {
      st.error = 'parse_1';
      return recordOf(st, { expected: expectedRecord(E) });
    }

    // ② 띠 확대
    let Lz = null;
    let nz = null;
    const Z = { ...POSITION_ZOOM, ...(deps.zoom || {}) };
    if (isNum(Number(e.POSITION_ZOOM_SCALE)) && Number(e.POSITION_ZOOM_SCALE) > 0) Z.scale = Number(e.POSITION_ZOOM_SCALE);
    if (isNum(Number(e.POSITION_ZOOM_MAX_EDGE)) && Number(e.POSITION_ZOOM_MAX_EDGE) >= 512) Z.maxEdge = Number(e.POSITION_ZOOM_MAX_EDGE);
    const format = e.POSITION_ZOOM_FORMAT === 'png' ? 'png' : 'jpeg';
    const noKitchen = Lf._kitchen === false || Lf._layout === 'island_only' || Lf._layout === 'none';
    if (noKitchen) nz = 'no_run';
    else if (!isJpegBytes(b64ToBytes(base.base64.slice(0, 8)))) nz = 'not_jpeg'; // PNG 디코더가 없다 — 측정만
    else if (W * H > Z.maxDecodePx) nz = 'big'; // CPU·메모리 — 큰 기본안은 띠를 생략한다
    else if (deadline - now() < T.minLeft) nz = 'budget';
    else if (overloaded(st.model)) nz = 'overload'; // 1차 사이에 과부하가 났다 — 띠는 보내지 않고 1차 값만 (측정만)
    if (!nz) {
      const rect = zoomCropRect(Lf, W, H);
      if (!rect || rect.w < Z.minCropFrac * W || rect.h < 4) nz = 'crop';
      else {
        let band = null;
        const td = now();
        try {
          band = await bandImage(base, rect, Z, format);
        } catch {
          nz = 'decode';
          st.error = 'decode';
        }
        // 워커는 CPU 가 도는 동안 시계가 멈춘다(I/O 에서만 흐름) — ms_decode 는 Node 재생용, 운영 CPU 는 띠 크기(zoom_px)로 본다
        st.msDecode = now() - td;
        if (band) {
          st.zoomPx = band.px;
          try {
            const text2 = await ask(band.image, true, 2);
            Lz = toLandmarks(parsePositionLandmarks(text2), { W: band.W, H: band.H, crop: rect });
            if (!Lz) {
              nz = 'parse_2';
              st.error = 'parse_2';
            }
          } catch (err) {
            nz = err.code || 'internal';
            st.error = nz;
          }
        }
      }
    }
    return recordOf(st, positionResult({ route, E, Lf, Lz, nz, W, H, roomDims, input, env: e }));
  } catch (err) {
    st.error = 'internal';
    return recordOf(st, {});
  }
}

function alarmRoutes(env) {
  const v = env && env.POSITION_ALARM_ROUTES;
  if (v == null || v === '') return POSITION_ALARM_ROUTES_DEFAULT;
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

function expectedRecord(E) {
  const out = { wallW: E.wallW || null, wall_known: E.wallKnown };
  if (E.anchor !== undefined) out.anchor = E.anchor;
  if (E.run) out.run = E.run.map(r0);
  if (E.planner && !E.run && E.planner.runHold) out.run_hold = E.planner.runHold;
  if (E.span) out.span = r0(E.span);
  if (E.place) Object.assign(out, { span: r0(E.place.span), s: Math.round(E.place.s * 1000) / 1000, ...(E.place.returns ? { returns: E.place.returns } : {}) });
  if (E.mask) out.mask_u = Math.round(E.mask.u * 1e4) / 1e4;
  const mm = {};
  for (const k of ITEM_KEYS) if (isNum(E.mm[k])) mm[k] = r0(E.mm[k]);
  out.mm = mm;
  const src = compact(E.src || {});
  if (Object.keys(src).length) out.src = src;
  return out;
}

/**
 * 응답(전체·띠) → 기록 본문 (measured · expected · ok · alerts). 순수 — 오프라인 재생(API 0)이 같은 함수를 부른다.
 * @param {object} p {route, E?, Lf, Lz, nz, W, H, roomDims?, input, env?}
 */
export function positionResult(p) {
  const { route, Lf, Lz, W, H, input } = p;
  const E = p.E || positionExpected(route, input);
  const env = p.env || {};
  let nz = p.nz || null;
  const L = Lz ? mergeZoom(Lf, Lz) : Lf;
  const zoom = !!Lz && !nz;
  const D = derive(L, W, H, { t: E.t, f35: E.f35 });
  const noKitchen = Lf._kitchen === false || Lf._layout === 'island_only' || Lf._layout === 'none';
  const measuredBase = { kitchen: Lf._kitchen, layout: Lf._layout, zoom };
  const types = compact({ WL: L.WL && L.WL.type, WR: L.WR && L.WR.type, hood: (L.HL && L.HL.type) || (L.HR && L.HR.type) || null });
  const img = compact({
    WL: r1(L.WL && L.WL.x), WR: r1(L.WR && L.WR.x), CBL: r1(L.CBL && L.CBL.x), CBR: r1(L.CBR && L.CBR.x),
    CFL: r1(L.CFL && L.CFL.x), CFR: r1(L.CFR && L.CFR.x), // v3: 앞선 끝 — 덩어리 끝 대조(run_right_place)의 앞 모서리
    sink: r1(L.SINK_B && L.SINK_B.x), kl: r1(L.K_BL && L.K_BL.x), kr: r1(L.K_BR && L.K_BR.x), HL: r1(L.HL && L.HL.x), HR: r1(L.HR && L.HR.x),
    // 수전 밑동 (투영 전) — 싱크 측정점(볼 뒷변 중점) 결정을 위한 기록만 (R2: 사선에서 볼 중점 −1.0 pp 치우침, 수전 0.0)
    F: L.F && L.F.flag !== 'absent' ? r1(L.F.x) : null,
  });
  if (noKitchen || D.fail) {
    // 주방이 없거나(풍경 사진 등) 상판 뒷선이 없다 — 오경보 0 이 정답. 측정만 남긴다
    return { measured: { ...measuredBase, nz: nz || 'no_run', img, types }, expected: expectedRecord(E) };
  }
  const Df = Lz ? derive(Lf, W, H, { t: E.t, f35: E.f35 }) : D;
  const F = E.planner || null;
  const gate = wallGate(Df, D, Lz, Lf, F ? F.tallSide : null);
  const aspectDiff = p.roomDims && p.roomDims.width && p.roomDims.height
    ? Math.abs(W / H - p.roomDims.width / p.roomDims.height) / (p.roomDims.width / p.roomDims.height)
    : null;
  const S = positionScore({
    E, L, D, W, H, zoom, nz, gate, qc: input.qc, category: input.category,
    alarmsOn: alarmRoutes(env).includes(route), aspectDiff, provider: input.provider || null,
  });
  const mm = {}, sd = {}, hold = {};
  for (const [k, it] of Object.entries(S.items)) {
    if (it.m != null) mm[k] = r0(it.m);
    sd[k] = r0(it.sd);
    if (it.hold) hold[k] = it.hold;
  }
  const measured = {
    ...measuredBase,
    ...(nz ? { nz } : {}),
    img,
    types,
    u: Math.round(D.u * 1e4) / 1e4,
    vz: D.vz ? D.vz.map(r1) : null,
    ...(D.vzDrop ? { vz_drop: D.vzDrop } : {}),
    gate: { ok: gate.ok, ...(gate.why.length ? { why: gate.why } : {}) },
    wall_pct: compact({ runL: r1(S.M.wall.runL), runR: r1(S.M.wall.runR), sink: r1(S.M.wall.sink), cook: r1(S.M.wall.cook), hood: r1(S.M.wall.hood) }),
    run_pct: compact({ sink: r1(S.M.run.sink), cook: r1(S.M.run.cook), hood: r1(S.M.run.hood) }),
    mm,
    sd,
    hold,
  };
  if (route === 'mock_kitchen' && E.mask) {
    // 칠한 상판 뒷선 끝(벽 끝) 대비 기본안 벽 끝 — 생성기가 벽 모서리를 옮겼나 (기록만, pp)
    const dl = isNum(D.img.WL) ? D.img.WL - E.mask.L : null;
    const dr = isNum(D.img.WR) ? D.img.WR - E.mask.R : null;
    if (dl != null || dr != null) measured.mask_wall = [r1(dl), r1(dr)];
  }
  if (route === 'planner_place' && S.items.run_right_place && S.items.run_right_place.place) {
    // v3 덩어리 끝 대조 기록 — 틀·쪽·벽 왼 모서리 차(pp, 기록만)·뒤/앞 모서리 차 (pp · mm)
    const P = S.items.run_right_place.place;
    measured.place = compact({ fm: P.fm, side: P.side, wl_d: r1(P.wl_d), d_back_pp: r1(P.d_back_pp), d_front_pp: r1(P.d_front_pp), d_back: r0(P.d_back), d_front: r0(P.d_front) });
  }
  return {
    ok: S.ok,
    alerts: S.alerts,
    ...(S.shadow.length ? { shadow: S.shadow } : {}),
    measured,
    expected: expectedRecord(E),
    ...(aspectDiff != null && route === 'mock_kitchen' ? { aspect: Math.round(aspectDiff * 1000) / 1000 } : {}),
  };
}

/**
 * job.js 용 — 기다리지 않고 시작한다. 게이트(env.POSITION_QC === 'on')가 꺼졌거나 주방이 아니면 null.
 *   attachTo(slot): 끝나는 순간 slot.position 에 기록을 단다(이미 끝났으면 지금). 이후 모든 images 패치에 저절로 실린다.
 *   wait(ms): 끝날 때까지(최대 ms) 기다린다 → 끝났으면 true. 절대 reject 하지 않는다.
 *   done: 기록이 달렸나(동기 값).
 * 안전장치: 내부 예산(75초)이 어떤 이유로 안 지켜져도 예산 + 5초에 'timeout' 기록으로 풀린다.
 */
export function startPositionCheck(env, input, deps = {}) {
  if (!env || env.POSITION_QC !== 'on') return null;
  let route = null;
  try {
    route = positionRoute(input);
  } catch {
    route = null;
  }
  if (!route) return null;
  const T = { ...POSITION_TIMING, ...(deps.timing || {}) };
  let target = null;
  let result = null;
  let done = false;
  let timer = null;
  const t0 = Date.now();
  const hard = new Promise((res) => {
    timer = setTimeout(
      () => res({ v: POSITION_VERSION, route, ok: null, alerts: [], model: env.POSITION_MODEL || POSITION_MODEL_DEFAULT, calls: null, ms: Date.now() - t0, error: 'timeout' }),
      T.total + T.hardExtra
    );
  });
  const promise = Promise.race([runPositionCheck(env, input, deps).catch(() => null), hard])
    .then((rec) => {
      clearTimeout(timer);
      result = rec || null;
      if (target && result) target.position = result;
      done = true;
      if (result) {
        const a = result.alerts && result.alerts.length ? ` alerts ${result.alerts.map((x) => `${x.k}${x.d > 0 ? '+' : ''}${x.d}`).join(',')}` : '';
        // '[Job id]' 줄과 묶이게 같은 머리 (잡 id 는 로그에만 — 기록에는 넣지 않는다)
        const tag = input && input.jobId ? `[Job ${input.jobId}] position` : '[position]';
        console.log(`${tag} ${route} ok=${result.ok}${a}${result.error ? ` error=${result.error}` : ''} calls=${result.calls} ${result.ms}ms`);
      }
      return result;
    })
    .catch(() => {
      clearTimeout(timer);
      done = true;
      return null;
    });
  return {
    get done() {
      return done;
    },
    get result() {
      return result;
    },
    attachTo(slot) {
      target = slot || null;
      if (done && result && target) target.position = result;
    },
    wait(ms) {
      if (done) return Promise.resolve(true);
      if (!(ms > 0)) return Promise.resolve(false);
      return new Promise((res) => {
        const t = setTimeout(() => res(false), ms);
        promise.then(() => {
          clearTimeout(t);
          res(true);
        });
      });
    },
    promise,
  };
}

/**
 * job.js 알람 재실행용 — 기본안이 이미 있고 위치 기록이 없을 때 **다시 재지 않고** 그 사실만 남긴다 (장당 호출 수를 지킨다:
 * 전체 1 + 띠 1, 과부하 재시도까지 최대 4회). 게이트 꺼짐·주방 아님이면 null (기록 키 없음).
 */
export function positionSkipped(env, input, code) {
  if (!env || env.POSITION_QC !== 'on') return null;
  let route = null;
  try {
    route = positionRoute(input);
  } catch {
    route = null;
  }
  if (!route) return null;
  return { v: POSITION_VERSION, route, ok: null, alerts: [], model: env.POSITION_MODEL || POSITION_MODEL_DEFAULT, calls: 0, ms: 0, error: code };
}
