/**
 * P0: 사진 속 사각형에서 카메라 역산 (js/planner/photo-solve.js).
 *
 * 이 파일이 P0 의 **진짜 산출물**이다. 화면이 아직 없는 단계에서 정확도를 먼저 증명한다 (계획 §5 P0).
 * three 도 GPU 도 쓰지 않는다 — 전부 순수 수학이다.
 *
 *   · 알맹이: 가우스 소거(부분 피벗팅) · 외적·정규화·3×3 곱 — 손으로 푼 값과 대조
 *   · 호모그래피: 모델 mm → 사진 px 를 네 점에서 정확히 재현, 특이·퇴화 입력은 null
 *   · **왕복 시험**: 알려진 카메라로 바닥 사각형 네 귀퉁이를 사진에 투영하고(이 파일이 직접 쓴
 *     전방 투영 — 모듈 것을 쓰면 순환이라 안 쓴다), 그 네 점만으로 카메라를 되풀어 원래와 맞춰 본다.
 *     화각 20/35/50/65/80° × 높이 1200/1700/2500mm × 방위각 6 × 거리 2 × 롤 2 × 사각형 5 × 회전 2
 *   · 재투영 오차: 정확한 입력이면 0, 귀퉁이를 N px 밀면 N 에 비례해 자란다
 *   · 퇴화: 정면(변이 평행) → method:'assumed', NaN 없음, 자리가 말이 된다
 *   · 기형 사각형: 오목·꼬임·넓이 0·중복점·사진 밖 → 이유와 함께 거절, 카메라는 null (던지지 않는다)
 *   · 감기: 시계·반시계 어느 쪽으로 찍어도 같은 카메라, flipped 만 다르다
 *   · 잡음: ±1px·±3px 을 넣고 중앙값이 얼마나 나빠지는지 — 실측값은 아래 표에 적어 둔다
 *
 * ── 측정한 정확도 (2026-09-17, 이 파일이 실제로 돌려 나온 값) ─────────────────
 *
 *   정확한 입력, 3576가지 배치 (아래 훑기 그대로):
 *     위치 오차   최대 2.8e-8 mm        시선 각도 최대 1.7e-6°
 *     세로 화각   최대 3.0e-11°         재투영 RMS 최대 8.9e-10 px
 *     전부 method:'vanishing' — 가정 화각으로 떨어진 경우 0건
 *
 *   손떨림(정규 좌표에 ±N px 균등 잡음, 4032×3024 사진, 각 600회):
 *     사각형              잡음   위치(중앙/90%/최대)      시선(중앙/최대)   가로화각(중앙/최대)  재투영(중앙)
 *     3600×700 (얕다)     ±1px   77 / 387 / 1292 mm       0.25° / 2.08°     0.70° / 5.32°       3.7 px
 *     3600×700 (얕다)     ±3px   262 / 1233 / 4997 mm     0.81° / 8.69°     2.24° / 26.98°      12.4 px
 *     2400×1500 (깊다)    ±1px   20 / 74 / 197 mm         0.09° / 0.64°     0.21° / 1.51°       1.3 px
 *     2400×1500 (깊다)    ±3px   62 / 231 / 611 mm        0.29° / 2.66°     0.68° / 4.94°       3.9 px
 *
 *   → **깊은 사각형이 압도적으로 강하다.** 깊이 700 조리대 바닥만 잡으면 소실점 하나가 멀어져
 *     초점거리가 손떨림에 휘둘린다. P1 의 UI 는 "되도록 정사각형에 가까운 바닥"을 잡게 안내해야 한다.
 */
const fs = require('fs');
const path = require('path');
const P = require('../js/planner/photo-solve');

const ROOT = path.join(__dirname, '..');
const D2R = Math.PI / 180;

// ── 이 파일이 직접 쓰는 전방 투영 (모듈과 독립) ───────────────
// 왕복 시험이 순환하지 않으려면 "가는 길"을 시험이 직접 갖고 있어야 한다.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };
const angleBetween = (a, b) => Math.acos(Math.min(1, Math.max(-1, dot3(unit(a), unit(b))))) * 180 / Math.PI;

/** 위치·바라볼 점·롤·가로 화각 → 시험용 카메라 (three 관례: y 위, −z 앞) */
function testCamera(position, aim, rollDeg, fovHDeg, imgW, imgH) {
  const forward = unit(sub(aim, position));
  const r = rollDeg * D2R;
  const right0 = unit(cross3(forward, [0, 1, 0]));       // 롤 0 일 때의 오른쪽
  const up0 = cross3(right0, forward);
  const up = unit(up0.map((v, i) => v * Math.cos(r) + right0[i] * Math.sin(r)));
  const fovV = 2 * Math.atan(Math.tan(fovHDeg / 2 * D2R) * imgH / imgW) / D2R;
  return { position, target: aim, up, forward, fovV, fovH: fovHDeg, aspect: imgW / imgH, imgW, imgH };
}

/** 세계 mm → 사진 px. 카메라 뒤면 null */
function testProject(cam, Pw) {
  const z = unit(sub(cam.position, cam.target));
  const x = unit(cross3(cam.up, z));
  const y = cross3(z, x);
  const v = sub(Pw, cam.position);
  const depth = -dot3(v, z);
  if (depth <= 0) return null;
  const tanV = Math.tan(cam.fovV / 2 * D2R);
  const ndcX = dot3(v, x) / (depth * tanV * cam.aspect);
  const ndcY = dot3(v, y) / (depth * tanV);
  return [(ndcX + 1) / 2 * cam.imgW, (1 - ndcY) / 2 * cam.imgH];
}

/** 바닥 사각형 네 귀퉁이 (뒤-왼, 뒤-오른, 앞-오른, 앞-왼) — 모듈과 따로 쓴 것 */
function testCorners(rect) {
  const th = -(rect.rotationDeg || 0) * D2R;
  const c = Math.cos(th), s = Math.sin(th);
  const hw = rect.w / 2, hd = rect.d / 2;
  const ox = rect.originMm.x, oz = rect.originMm.z;
  const at = (u, v) => [ox + u * c + v * s, 0, oz - u * s + v * c];
  return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
}

/** 씨앗 난수 (mulberry32) — 잡음 시험이 매번 같은 값을 내야 한다 */
function seeded(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const quantile = (arr, p) => {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

const IMG_W = 4032, IMG_H = 3024;
const CTR = [1000, 0, 500];
const rectAt = (w, d, rotationDeg) => ({ w, d, originMm: { x: CTR[0], z: CTR[2] }, rotationDeg: rotationDeg || 0 });

/** 사각형 중심을 바라보는 카메라를 방위각·높이·거리로 세운다 */
function placeCamera(rect, azDeg, height, distK, rollDeg, fovHDeg) {
  const span = Math.max(rect.w, rect.d);
  const R = distK * span / (2 * Math.tan(fovHDeg / 2 * D2R)) + 800;
  const a = azDeg * D2R;
  const pos = [CTR[0] + Math.sin(a) * R, height, CTR[2] + Math.cos(a) * R];
  return testCamera(pos, CTR, rollDeg, fovHDeg, IMG_W, IMG_H);
}

/** 카메라 + 사각형 → 정규 좌표 quad. 프레임 밖이거나 뒤면 null */
function quadFor(cam, rect, jitter) {
  const px = testCorners(rect).map((c) => testProject(cam, c));
  if (px.some((p) => !p)) return null;
  return px.map((p) => [
    (p[0] + (jitter ? jitter() : 0)) / IMG_W,
    (p[1] + (jitter ? jitter() : 0)) / IMG_H,
  ]);
}

// ── 알맹이 ───────────────────────────────────────────────

describe('선형대수 알맹이', () => {
  test('가우스 소거 — 손으로 푼 해와 같다', () => {
    const x = P.plannerPhotoSolveLinear([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
    expect(x[0]).toBeCloseTo(2, 10);
    expect(x[1]).toBeCloseTo(3, 10);
    expect(x[2]).toBeCloseTo(-1, 10);
  });

  test('가우스 소거 — 특이행렬·크기 불일치·NaN 은 null (던지지 않는다)', () => {
    expect(P.plannerPhotoSolveLinear([[1, 2], [2, 4]], [1, 2])).toBeNull();     // 두 행이 비례
    expect(P.plannerPhotoSolveLinear([[1, 2]], [1, 2])).toBeNull();             // n×n 이 아니다
    expect(P.plannerPhotoSolveLinear([[1, 0], [0, NaN]], [1, 1])).toBeNull();
    expect(P.plannerPhotoSolveLinear(null, null)).toBeNull();
  });

  test('부분 피벗팅 — 첫 피벗이 0 이어도 푼다', () => {
    const x = P.plannerPhotoSolveLinear([[0, 1], [1, 0]], [3, 5]);
    expect(x).toEqual([5, 3]);
  });

  test('규모가 제각각인 계 (mm 와 px 가 섞인 8×8 과 같은 상황) 도 푼다', () => {
    // 행마다 크기가 백만 배 차이 나도 행 기준 피벗팅이라 무너지지 않는다
    const A = [[1e6, 1], [1, 1e-3]];
    const x = P.plannerPhotoSolveLinear(A, [1e6 + 2, 1 + 2e-3]);
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBeCloseTo(2, 3);
    // 1e6·1e-6 − 1 = 0 — 규모가 커도 특이하면 null 이다
    expect(P.plannerPhotoSolveLinear([[1e6, 1], [1, 1e-6]], [1, 1])).toBeNull();
  });

  test('외적·길이·정규화·3×3', () => {
    expect(P.plannerPhotoCross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(P.plannerPhotoLen([3, 4, 0])).toBe(5);
    expect(P.plannerPhotoNormalize([0, 0, 0])).toBeNull();
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const A = [1, 2, 3, 4, 5, 6, 7, 8, 10];
    expect(P.plannerPhotoMat3Mul(A, I)).toEqual(A);
    expect(P.plannerPhotoMat3T(A)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 10]);
    expect(P.plannerPhotoMat3Apply(A, [1, 0, 0])).toEqual([1, 4, 7]);
  });
});

// ── 호모그래피 ───────────────────────────────────────────

describe('호모그래피', () => {
  const cam = placeCamera(rectAt(3600, 700), -30, 1700, 1.5, 0, 55);
  const rect = rectAt(3600, 700);

  test('네 점 대응을 정확히 재현한다 (모델 mm → 사진 px)', () => {
    const corners = testCorners(rect);
    const px = corners.map((c) => testProject(cam, c));
    const model = [[-1800, -350], [1800, -350], [1800, 350], [-1800, 350]];
    const H = P.plannerPhotoHomography(model, px);
    expect(H).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const w = H[6] * model[i][0] + H[7] * model[i][1] + H[8];
      const x = (H[0] * model[i][0] + H[1] * model[i][1] + H[2]) / w;
      const y = (H[3] * model[i][0] + H[4] * model[i][1] + H[5]) / w;
      expect(x).toBeCloseTo(px[i][0], 6);
      expect(y).toBeCloseTo(px[i][1], 6);
    }
  });

  test('세 점이 한 직선 위이거나 점이 모자라면 null', () => {
    const line = [[0, 0], [1, 1], [2, 2], [3, 3]];
    expect(P.plannerPhotoHomography(line, [[0, 0], [1, 0], [2, 0], [3, 0]])).toBeNull();
    expect(P.plannerPhotoHomography([[0, 0]], [[0, 0]])).toBeNull();
    expect(P.plannerPhotoHomography(null, null)).toBeNull();
    const same = [[5, 5], [5, 5], [5, 5], [5, 5]];
    expect(P.plannerPhotoHomography(same, [[0, 0], [1, 0], [1, 1], [0, 1]])).toBeNull();
  });

  test('{x,y} 객체 점도 받는다', () => {
    const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const dst = [[10, 10], [20, 10], [20, 20], [10, 20]];
    const H = P.plannerPhotoHomography(src, dst);
    expect(H).not.toBeNull();
    expect(H[2]).toBeCloseTo(10, 9);
  });
});

// ── 사각형 검사 ──────────────────────────────────────────

describe('사각형 검사 (plannerPhotoQuadSane)', () => {
  const OK = [[0.2, 0.3], [0.8, 0.35], [0.9, 0.8], [0.1, 0.75]];

  test('정상 — 시계 방향(정본)은 winding 1, 반시계는 −1. 둘 다 통과', () => {
    const cw = P.plannerPhotoQuadSane(OK);
    expect(cw).toMatchObject({ ok: true, reason: null, winding: 1 });
    expect(cw.area).toBeGreaterThan(0);
    const ccw = P.plannerPhotoQuadSane([OK[0], OK[3], OK[2], OK[1]]);
    expect(ccw).toMatchObject({ ok: true, winding: -1 });
  });

  test.each([
    ['네 점이 아니다', [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9]], '네 점이 필요합니다'],
    ['숫자가 아니다', [[0.1, 0.1], [0.9, 'a'], [0.9, 0.9], [0.1, 0.9]], '좌표에 숫자가 아닌 값이 있습니다'],
    ['NaN', [[0.1, 0.1], [0.9, NaN], [0.9, 0.9], [0.1, 0.9]], '좌표에 숫자가 아닌 값이 있습니다'],
    ['사진 밖', [[0.1, 0.1], [1.4, 0.1], [0.9, 0.9], [0.1, 0.9]], '좌표가 사진 밖입니다 (0~1 이어야 합니다)'],
    ['음수', [[-0.2, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], '좌표가 사진 밖입니다 (0~1 이어야 합니다)'],
    ['중복점', [[0.1, 0.1], [0.1, 0.1], [0.9, 0.9], [0.1, 0.9]], '같은 점이 두 번 찍혔습니다'],
    ['한 직선 (넓이 0)', [[0.1, 0.1], [0.3, 0.3], [0.6, 0.6], [0.9, 0.9]], '세 점이 한 직선 위에 있습니다'],
    ['오목', [[0.1, 0.1], [0.9, 0.1], [0.45, 0.45], [0.1, 0.9]], '사각형이 오목합니다 (귀퉁이 하나가 안으로 들어갔습니다)'],
    ['꼬임 (나비넥타이)', [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]], '사각형이 꼬였습니다 (변끼리 교차합니다)'],
    ['너무 작다', [[0.50, 0.50], [0.53, 0.50], [0.53, 0.51], [0.50, 0.51]], '사각형이 너무 작습니다'],
  ])('거절: %s → 한국어 이유', (_label, quad, reason) => {
    const r = P.plannerPhotoQuadSane(quad);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(reason);
  });

  test('아무 쓰레기를 넣어도 던지지 않는다', () => {
    for (const junk of [null, undefined, 0, 'abc', {}, [], [1, 2, 3, 4], [[], [], [], []]]) {
      expect(() => P.plannerPhotoQuadSane(junk)).not.toThrow();
      expect(P.plannerPhotoQuadSane(junk).ok).toBe(false);
    }
  });
});

// ── 바닥 사각형 ──────────────────────────────────────────

describe('배치 공간의 바닥 사각형', () => {
  test('귀퉁이 순서와 회전이 3D 배치 규약(rotation.y = −rotation)과 같다', () => {
    const rect = rectAt(3600, 700, 0);
    expect(P.plannerPhotoRectCorners(rect)).toEqual(testCorners(rect));
    for (const deg of [0, 30, 90, 180, 270, -45]) {
      const r = rectAt(2400, 1500, deg);
      const mine = testCorners(r), theirs = P.plannerPhotoRectCorners(r);
      for (let i = 0; i < 4; i++) {
        for (let k = 0; k < 3; k++) expect(theirs[i][k]).toBeCloseTo(mine[i][k], 9);
      }
    }
  });

  test('0 회전에서 0번은 뒤-왼(−X,−Z), 2번은 앞-오른(+X,+Z), 전부 바닥(y=0)', () => {
    const c = P.plannerPhotoRectCorners(rectAt(3600, 700, 0));
    expect(c[0]).toEqual([1000 - 1800, 0, 500 - 350]);
    expect(c[2]).toEqual([1000 + 1800, 0, 500 + 350]);
    expect(c.every((p) => p[1] === 0)).toBe(true);
  });

  test('나쁜 rect 는 null', () => {
    expect(P.plannerPhotoRectCorners(null)).toBeNull();
    expect(P.plannerPhotoRectCorners({ w: 0, d: 700 })).toBeNull();
    expect(P.plannerPhotoRectCorners({ w: 3600, d: -1 })).toBeNull();
    expect(P.plannerPhotoRectCorners({ w: 'a', d: 700 })).toBeNull();
  });
});

// ── 왕복 시험 (이 파일의 핵심) ─────────────────────────────

describe('왕복 시험 — 알려진 카메라 → 네 점 → 역산 → 같은 카메라', () => {
  const FOVS = [20, 35, 50, 65, 80];
  const HEIGHTS = [1200, 1700, 2500];
  const AZS = [-55, -32, -14, 14, 32, 55];
  const DISTS = [1.2, 2.2];
  const ROLLS = [0, 5];
  const RECTS = [[600, 600], [1800, 600], [3600, 700], [4200, 700], [2400, 1500]];
  const ROTS = [0, 30];

  test('훑기 — 위치 1mm · 시선 0.01° · 화각 0.01° 안', () => {
    let n = 0, skipped = 0, assumed = 0;
    const worst = { pos: 0, dir: 0, up: 0, fov: 0, rep: 0, at: null };
    for (const fovH of FOVS) {
      for (const height of HEIGHTS) {
        for (const az of AZS) {
          for (const distK of DISTS) {
            for (const roll of ROLLS) {
              for (const [w, d] of RECTS) {
                for (const rot of ROTS) {
                  const rect = rectAt(w, d, rot);
                  const cam = placeCamera(rect, az, height, distK, roll, fovH);
                  const quad = quadFor(cam, rect);
                  // 사각형이 프레임 밖으로 나가거나 손으로 찍기엔 너무 납작한 배치는 건너뛴다
                  if (!quad || !P.plannerPhotoQuadSane(quad).ok) { skipped++; continue; }
                  const got = P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H);
                  expect(got).not.toBeNull();
                  if (got.method !== 'vanishing') assumed++;
                  n++;

                  const ePos = Math.hypot(...sub(got.position, cam.position));
                  const eDir = angleBetween(sub(got.target, got.position), cam.forward);
                  const eUp = angleBetween(got.up, cam.up);
                  const eFov = Math.abs(got.fov - cam.fovV);
                  if (ePos > worst.pos) { worst.pos = ePos; worst.at = { fovH, height, az, distK, roll, w, d, rot }; }
                  worst.dir = Math.max(worst.dir, eDir);
                  worst.up = Math.max(worst.up, eUp);
                  worst.fov = Math.max(worst.fov, eFov);
                  worst.rep = Math.max(worst.rep, got.reprojectionPx);
                }
              }
            }
          }
        }
      }
    }
    // 실측 (2026-09-17): n=3576 · 건너뜀 24 · 가정화각 0 ·
    //   위치 2.8e-8mm · 시선 1.7e-6° · up 1.9e-6° · 화각 3.0e-11° · 재투영 8.9e-10px
    expect(n).toBeGreaterThan(3000);
    expect(assumed).toBe(0);                      // 비스듬히 본 배치는 전부 소실점으로 풀린다
    expect(worst.pos).toBeLessThan(1);            // 1 mm
    expect(worst.dir).toBeLessThan(0.01);         // 0.01°
    expect(worst.up).toBeLessThan(0.01);
    expect(worst.fov).toBeLessThan(0.01);
    expect(worst.rep).toBeLessThan(1e-6);
    expect(skipped).toBeLessThan(n / 10);
  });

  test('한 배치를 자세히 — 돌려주는 모양이 plannerCaptureFrame 과 같다', () => {
    const rect = rectAt(3600, 700, 0);
    const cam = placeCamera(rect, -32, 1700, 1.4, 0, 65);
    const got = P.plannerPhotoCamera(quadFor(cam, rect), rect, IMG_W, IMG_H);
    for (const k of ['kind', 'fov', 'aspect', 'position', 'target', 'up', 'near', 'far', 'dist']) {
      expect(got[k]).toBeDefined();
    }
    expect(got.kind).toBe('photo');
    expect(got.position).toHaveLength(3);
    expect(got.target).toHaveLength(3);
    expect(got.up).toHaveLength(3);
    expect(got.near).toBe(10);                                   // 캡처 기본값과 같다
    expect(got.far).toBeGreaterThan(got.dist * 4);
    expect(got.aspect).toBeCloseTo(IMG_W / IMG_H, 12);           // 사진 종횡비를 자르지 않는다
    expect(got.method).toBe('vanishing');
    expect(got.flipped).toBe(false);
    expect(got.quadOrder).toEqual([0, 1, 2, 3]);
    expect(got.dist).toBeCloseTo(Math.hypot(...sub(cam.position, CTR)), 6);
    // 가로 화각과 세로 화각은 사진 종횡비만큼 다르다 (three 는 세로를 받는다)
    expect(got.fovDeg).toBeCloseTo(65, 6);
    expect(2 * Math.atan(Math.tan(got.fovDeg / 2 * D2R) * IMG_H / IMG_W) / D2R).toBeCloseTo(got.fov, 9);
    expect(got.up[1]).toBeGreaterThan(0);                        // 하늘 쪽
    expect(got.position[1]).toBeCloseTo(1700, 6);                // 카메라 높이
  });

  test('배치 공간이 원점에서 떨어져 회전해 있어도 맞는다', () => {
    const rect = { w: 2400, d: 1500, originMm: { x: -5200, z: 8300 }, rotationDeg: 115 };
    const corners = testCorners(rect);
    const ctr = [rect.originMm.x, 0, rect.originMm.z];
    const cam = testCamera([ctr[0] + 2600, 1850, ctr[2] + 3100], ctr, -3, 58, IMG_W, IMG_H);
    const quad = corners.map((c) => testProject(cam, c)).map((p) => [p[0] / IMG_W, p[1] / IMG_H]);
    const got = P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H);
    expect(Math.hypot(...sub(got.position, cam.position))).toBeLessThan(1);
    expect(angleBetween(sub(got.target, got.position), cam.forward)).toBeLessThan(0.01);
    expect(Math.abs(got.fov - cam.fovV)).toBeLessThan(0.01);
  });

  test('세로 사진(9:16)도 된다 — 종횡비를 0.5~3 으로 자르지 않는다', () => {
    const W = 1080, H = 1920;
    const rect = rectAt(2400, 1500, 0);
    const span = 2400;
    const R = 1.6 * span / (2 * Math.tan(70 / 2 * D2R)) + 800;
    const cam = testCamera([CTR[0] + Math.sin(-25 * D2R) * R, 1700, CTR[2] + Math.cos(-25 * D2R) * R], CTR, 0, 70, W, H);
    const quad = testCorners(rect).map((c) => testProject(cam, c)).map((p) => [p[0] / W, p[1] / H]);
    const got = P.plannerPhotoCamera(quad, rect, W, H);
    expect(got.aspect).toBeCloseTo(W / H, 12);
    expect(got.aspect).toBeLessThan(0.6);                        // 캡처의 하한(0.5) 근처 — 자르지 않았다
    expect(Math.hypot(...sub(got.position, cam.position))).toBeLessThan(1);
    expect(Math.abs(got.fov - cam.fovV)).toBeLessThan(0.01);
  });
});

// ── 재투영 오차 ──────────────────────────────────────────

describe('재투영 오차', () => {
  const rect = rectAt(3600, 700, 0);
  const cam = placeCamera(rect, -30, 1700, 1.5, 0, 60);
  const basePx = testCorners(rect).map((c) => testProject(cam, c));

  test('정확한 입력이면 0 이다', () => {
    const got = P.plannerPhotoCamera(basePx.map((p) => [p[0] / IMG_W, p[1] / IMG_H]), rect, IMG_W, IMG_H);
    expect(got.reprojectionPx).toBeLessThan(1e-6);
    expect(got.reprojectionMaxPx).toBeLessThan(1e-6);
  });

  test('귀퉁이 하나를 N px 밀면 오차가 N 에 비례해 자란다', () => {
    const seen = [];
    for (const N of [0, 1, 5, 20, 50]) {
      const px = basePx.map((p, i) => (i === 2 ? [p[0] + N, p[1]] : p));
      const got = P.plannerPhotoCamera(px.map((p) => [p[0] / IMG_W, p[1] / IMG_H]), rect, IMG_W, IMG_H);
      expect(got).not.toBeNull();
      seen.push(got.reprojectionPx);
      expect(got.reprojectionMaxPx).toBeGreaterThanOrEqual(got.reprojectionPx - 1e-9);
    }
    // 실측: 0 · 2.83 · 14.15 · 56.96 · 145.22 px — 단조 증가, 대략 선형
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    expect(seen[2] / seen[1]).toBeGreaterThan(2);
    expect(seen[2] / seen[1]).toBeLessThan(8);
    expect(seen[1]).toBeLessThan(10);
  });

  test('plannerPhotoReproject — 이 파일의 전방 투영과 같은 점을 낸다', () => {
    const got = P.plannerPhotoCamera(basePx.map((p) => [p[0] / IMG_W, p[1] / IMG_H]), rect, IMG_W, IMG_H);
    const back = P.plannerPhotoReproject(got, rect, IMG_W, IMG_H);
    // 이 파일의 전방 투영은 fovV(세로) 를 그 이름으로 받는다 — 모듈은 three 규약대로 fov 가 곧 세로다
    const shim = { ...got, fovV: got.fov, imgW: IMG_W, imgH: IMG_H };
    const mine = testCorners(rect).map((c) => testProject(shim, c));
    for (let i = 0; i < 4; i++) {
      expect(back[i][0]).toBeCloseTo(mine[i][0], 6);
      expect(back[i][1]).toBeCloseTo(mine[i][1], 6);
      expect(back[i][0]).toBeCloseTo(basePx[i][0], 6);
    }
  });

  test('plannerPhotoReproject — 나쁜 입력은 null, 카메라 뒤 점은 그 칸만 null', () => {
    expect(P.plannerPhotoReproject(null, rect, IMG_W, IMG_H)).toBeNull();
    expect(P.plannerPhotoReproject({ fov: 60, aspect: 1.33 }, rect, IMG_W, IMG_H)).toBeNull();
    const ok = P.plannerPhotoCamera(basePx.map((p) => [p[0] / IMG_W, p[1] / IMG_H]), rect, IMG_W, IMG_H);
    expect(P.plannerPhotoReproject(ok, { w: 0, d: 0 }, IMG_W, IMG_H)).toBeNull();
    expect(P.plannerPhotoReproject(ok, rect, 0, IMG_H)).toBeNull();
    // 사각형을 카메라 뒤로 옮기면 네 칸이 다 null
    const behind = { w: 3600, d: 700, originMm: { x: CTR[0], z: CTR[2] + 20000 }, rotationDeg: 0 };
    expect(P.plannerPhotoReproject(ok, behind, IMG_W, IMG_H).every((p) => p === null)).toBe(true);
  });
});

// ── 퇴화 ─────────────────────────────────────────────────

describe('퇴화 — 변이 거의 평행하면 초점거리가 정해지지 않는다', () => {
  const rect = rectAt(3600, 700, 0);

  const frontal = (trueFovH, azDeg) => {
    const R = 1.6 * 3600 / (2 * Math.tan(trueFovH / 2 * D2R)) + 800;
    const a = (azDeg || 0) * D2R;
    const pos = [CTR[0] + Math.sin(a) * R, 1700, CTR[2] + Math.cos(a) * R];
    return testCamera(pos, CTR, 0, trueFovH, IMG_W, IMG_H);
  };

  test('정확히 정면 → plannerPhotoFocal 은 null', () => {
    const cam = frontal(60, 0);
    const px = testCorners(rect).map((c) => testProject(cam, c));
    const H = P.plannerPhotoHomography([[-1800, -350], [1800, -350], [1800, 350], [-1800, 350]], px);
    expect(P.plannerPhotoFocal(H, IMG_W / 2, IMG_H / 2)).toBeNull();
  });

  test('거의 정면(0.02°) → method:"assumed", 기본 가로 화각 60°, NaN 없음', () => {
    for (const az of [0, 0.02, -0.02]) {
      const cam = frontal(60, az);
      const quad = quadFor(cam, rect);
      const got = P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H);
      expect(got).not.toBeNull();
      expect(got.method).toBe('assumed');
      expect(got.fovDeg).toBeCloseTo(60, 6);
      const all = [got.fov, got.aspect, got.near, got.far, got.dist, got.f, got.reprojectionPx]
        .concat(got.position, got.target, got.up);
      expect(all.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  test('가정 화각이 진짜와 같으면 자세까지 정확하다', () => {
    const cam = frontal(60, 0);
    const got = P.plannerPhotoCamera(quadFor(cam, rect), rect, IMG_W, IMG_H);
    expect(Math.hypot(...sub(got.position, cam.position))).toBeLessThan(1);
    expect(got.reprojectionPx).toBeLessThan(1e-6);
  });

  test('가정 화각이 틀리면 자리는 어긋나지만 여전히 말이 되는 카메라다 — 그리고 재투영 오차가 그걸 알려 준다', () => {
    // 실측: 진짜 45° → 재투영 158.8px · 위치오차 1413mm · 높이 1944mm(진짜 1700)
    //       진짜 75° → 재투영 133.2px · 위치오차  930mm · 높이 1536mm
    for (const trueFov of [45, 75]) {
      const cam = frontal(trueFov, 0);
      const got = P.plannerPhotoCamera(quadFor(cam, rect), rect, IMG_W, IMG_H);
      expect(got.method).toBe('assumed');
      expect(got.position.every(Number.isFinite)).toBe(true);
      expect(got.position[1]).toBeGreaterThan(500);              // 바닥 위 사람 눈높이쯤
      expect(got.position[1]).toBeLessThan(4000);
      expect(got.dist).toBeGreaterThan(1000);
      // 사각형은 여전히 화면 안에 들어온다
      const back = P.plannerPhotoReproject(got, rect, IMG_W, IMG_H);
      expect(back.every((p) => p && p[0] > -IMG_W && p[0] < 2 * IMG_W)).toBe(true);
      // 틀린 화각은 재투영 오차로 드러난다 — P1 의 화각 슬라이더가 이 숫자를 줄이면 된다
      expect(got.reprojectionPx).toBeGreaterThan(20);
    }
  });

  test('opt.assumedFovDeg · opt.fovDeg · opt.near/far 가 먹는다', () => {
    const cam = frontal(60, 0);
    const quad = quadFor(cam, rect);
    const a = P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H, { assumedFovDeg: 90 });
    expect(a.method).toBe('assumed');
    expect(a.fovDeg).toBeCloseTo(90, 6);
    // 비스듬한 사진이라도 fovDeg 를 주면 그걸 따른다 (P1 슬라이더)
    const slant = placeCamera(rect, -30, 1700, 1.5, 0, 60);
    const b = P.plannerPhotoCamera(quadFor(slant, rect), rect, IMG_W, IMG_H, { fovDeg: 40, near: 5, far: 123456 });
    expect(b.method).toBe('assumed');
    expect(b.fovDeg).toBeCloseTo(40, 6);
    expect(b.near).toBe(5);
    expect(b.far).toBe(123456);
  });

  test('plannerPhotoFocal — 말이 안 되는 입력은 null', () => {
    expect(P.plannerPhotoFocal(null, 100, 100)).toBeNull();
    expect(P.plannerPhotoFocal([1, 2, 3], 100, 100)).toBeNull();
    expect(P.plannerPhotoFocal([1, 0, 0, 0, 1, 0, 0, 0, 1], 100, 100)).toBeNull();   // 소실점이 무한대
    expect(P.plannerPhotoFocal([1, 0, 0, 0, 1, 0, 0, 0, 1], NaN, 100)).toBeNull();
  });

  test('plannerPhotoPose — 말이 안 되는 입력은 null', () => {
    expect(P.plannerPhotoPose(null, 1000, 0, 0)).toBeNull();
    expect(P.plannerPhotoPose([1, 0, 0, 0, 1, 0, 0, 0, 1], 0, 0, 0)).toBeNull();     // f ≤ 0
    expect(P.plannerPhotoPose([1, 0, 0, 0, 1, 0, 0, 0, 1], -5, 0, 0)).toBeNull();
    expect(P.plannerPhotoPose([0, 0, 0, 0, 0, 0, 0, 0, 1], 1000, 0, 0)).toBeNull();  // 회전열이 0
  });

  test('평면이 카메라 앞에 온다 — t_z > 0, R 은 진짜 회전행렬', () => {
    const cam = placeCamera(rect, -30, 1700, 1.5, 0, 60);
    const px = testCorners(rect).map((c) => testProject(cam, c));
    const H = P.plannerPhotoHomography([[-1800, -350], [1800, -350], [1800, 350], [-1800, 350]], px);
    const f = P.plannerPhotoFocal(H, IMG_W / 2, IMG_H / 2);
    const pose = P.plannerPhotoPose(H, f, IMG_W / 2, IMG_H / 2);
    expect(pose.t[2]).toBeGreaterThan(0);
    const R = pose.R;
    const col = (i) => [R[i], R[3 + i], R[6 + i]];
    for (let i = 0; i < 3; i++) expect(P.plannerPhotoLen(col(i))).toBeCloseTo(1, 12);
    expect(P.plannerPhotoDot(col(0), col(1))).toBeCloseTo(0, 12);
    expect(P.plannerPhotoDot(col(1), col(2))).toBeCloseTo(0, 12);
    const det = P.plannerPhotoDot(col(0), P.plannerPhotoCross(col(1), col(2)));
    expect(det).toBeCloseTo(1, 12);                              // 오른손계 (거울이 아니다)
  });
});

// ── 감기 ─────────────────────────────────────────────────

describe('감기 — 반대로 찍어도 같은 카메라', () => {
  test('시계·반시계가 같은 카메라를 내고 flipped 만 다르다', () => {
    const rect = rectAt(2400, 1500, 20);
    const cam = placeCamera(rect, 35, 1700, 1.4, 0, 62);
    const cw = quadFor(cam, rect);
    const ccw = [cw[0], cw[3], cw[2], cw[1]];
    const a = P.plannerPhotoCamera(cw, rect, IMG_W, IMG_H);
    const b = P.plannerPhotoCamera(ccw, rect, IMG_W, IMG_H);
    expect(a.flipped).toBe(false);
    expect(b.flipped).toBe(true);
    expect(a.quadOrder).toEqual([0, 1, 2, 3]);
    expect(b.quadOrder).toEqual([0, 3, 2, 1]);
    for (let i = 0; i < 3; i++) {
      expect(b.position[i]).toBeCloseTo(a.position[i], 6);
      expect(b.up[i]).toBeCloseTo(a.up[i], 9);
    }
    expect(b.fov).toBeCloseTo(a.fov, 9);
    expect(b.f).toBeCloseTo(a.f, 6);
    expect(angleBetween(sub(b.target, b.position), sub(a.target, a.position))).toBeLessThan(1e-4);
  });

  test('시작 귀퉁이가 어긋나면 — 90° 는 재투영 오차가 잡지만 180° 는 못 잡는다 (P1 의 숙제)', () => {
    // 직사각형은 180° 회전에 대해 자기 자신이라, 대각선 반대 귀퉁이에서 시작하면
    // **재투영 오차가 정확히 0 인, 방 반대편에서 본 카메라**가 나온다. 숫자로는 막을 수 없다 —
    // P1 의 UI 가 귀퉁이 이름표로 순서를 강제해야 한다. 이 시험은 그 사실을 못 박아 둔다.
    const rect = rectAt(2400, 1500, 0);
    const cam = placeCamera(rect, -30, 1700, 1.5, 0, 60);
    const base = quadFor(cam, rect);
    const shifted = (s) => [0, 1, 2, 3].map((i) => base[(i + s) % 4]);

    const s1 = P.plannerPhotoCamera(shifted(1), rect, IMG_W, IMG_H);
    expect(Math.hypot(...sub(s1.position, cam.position))).toBeGreaterThan(1000);
    expect(s1.reprojectionPx).toBeGreaterThan(100);              // 실측 443.5 px — 잡힌다

    const s2 = P.plannerPhotoCamera(shifted(2), rect, IMG_W, IMG_H);
    expect(Math.hypot(...sub(s2.position, cam.position))).toBeGreaterThan(5000);   // 실측 7835 mm
    expect(s2.reprojectionPx).toBeLessThan(1e-6);                // 그런데 오차는 0 이다
    expect(s2.position[1]).toBeCloseTo(cam.position[1], 6);      // 높이마저 같다 — 후처리 경고도 못 만든다
  });
});

// ── 잡음 ─────────────────────────────────────────────────

describe('잡음 — 손으로 찍은 점이 흔들릴 때', () => {
  // 실측 (씨앗 고정, 각 600회). 머리말의 표와 같은 값이다.
  //   3600×700  ±1px  위치 중앙 77mm/90% 387mm  시선 0.25°  화각 0.70°  재투영 3.7px
  //   3600×700  ±3px  위치 중앙 262mm/90% 1233mm 시선 0.81°  화각 2.24°  재투영 12.4px
  //   2400×1500 ±1px  위치 중앙 20mm/90% 74mm    시선 0.09°  화각 0.21°  재투영 1.3px
  //   2400×1500 ±3px  위치 중앙 62mm/90% 231mm   시선 0.29°  화각 0.68°  재투영 3.9px
  const run = (w, d, amp, seed) => {
    const rnd = seeded(seed);
    const jitter = () => (rnd() * 2 - 1) * amp;
    const rect = rectAt(w, d, 0);
    const pos = [], dir = [], fov = [], rep = [];
    let nulls = 0, nan = 0;
    for (let i = 0; i < 600; i++) {
      const fovH = [35, 50, 65, 80][i % 4];
      const height = [1200, 1700, 2500][i % 3];
      const az = [-45, -25, -12, 12, 25, 45][i % 6];
      const cam = placeCamera(rect, az, height, 1.5, 0, fovH);
      const quad = quadFor(cam, rect, jitter);
      if (!quad) continue;
      const got = P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H);
      if (!got) { nulls++; continue; }
      const nums = [got.fov, got.f, got.dist, got.reprojectionPx].concat(got.position, got.target, got.up);
      if (!nums.every(Number.isFinite)) nan++;
      pos.push(Math.hypot(...sub(got.position, cam.position)));
      dir.push(angleBetween(sub(got.target, got.position), cam.forward));
      fov.push(Math.abs(got.fovDeg - fovH));
      rep.push(got.reprojectionPx);
    }
    return { n: pos.length, nulls, nan, pos, dir, fov, rep };
  };

  test.each([
    // [w, d, 잡음px, 씨앗, 위치중앙값 한계mm, 시선중앙값 한계°, 화각중앙값 한계°]
    [3600, 700, 1, 9002, 150, 0.5, 1.5],
    [3600, 700, 3, 9004, 500, 1.6, 4.5],
    [2400, 1500, 1, 9002, 60, 0.2, 0.5],
    [2400, 1500, 3, 9004, 150, 0.6, 1.5],
  ])('%i×%i, ±%ipx — 중앙값이 한계 안, NaN 0, 예외 없음', (w, d, amp, seed, limPos, limDir, limFov) => {
    const r = run(w, d, amp, seed);
    expect(r.n).toBeGreaterThan(500);
    expect(r.nan).toBe(0);
    expect(r.nulls).toBe(0);
    expect(quantile(r.pos, 0.5)).toBeLessThan(limPos);
    expect(quantile(r.dir, 0.5)).toBeLessThan(limDir);
    expect(quantile(r.fov, 0.5)).toBeLessThan(limFov);
    // 재투영 오차가 실제 오차와 같이 움직인다 — 사용자에게 보여 줄 값으로 쓸 만하다
    expect(quantile(r.rep, 0.5)).toBeGreaterThan(0);
    expect(quantile(r.rep, 0.5)).toBeLessThan(amp * 8);
  });

  test('깊은 사각형이 얕은 것보다 확실히 강하다 (P1 안내 문구의 근거)', () => {
    const shallow = run(3600, 700, 1, 9002);
    const deep = run(2400, 1500, 1, 9002);
    expect(quantile(deep.pos, 0.5)).toBeLessThan(quantile(shallow.pos, 0.5) / 2);
    expect(quantile(deep.fov, 0.5)).toBeLessThan(quantile(shallow.fov, 0.5) / 2);
  });
});

// ── 방어 ─────────────────────────────────────────────────

describe('나쁜 입력에 던지지 않는다', () => {
  const rect = rectAt(3600, 700, 0);
  const good = quadFor(placeCamera(rect, -30, 1700, 1.5, 0, 60), rect);

  test.each([
    ['오목', [[0.1, 0.1], [0.9, 0.1], [0.45, 0.45], [0.1, 0.9]]],
    ['꼬임', [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]],
    ['넓이 0', [[0.1, 0.1], [0.3, 0.3], [0.6, 0.6], [0.9, 0.9]]],
    ['중복점', [[0.2, 0.2], [0.2, 0.2], [0.8, 0.8], [0.2, 0.8]]],
    ['사진 밖', [[-0.3, 0.2], [1.4, 0.2], [1.4, 0.8], [-0.3, 0.8]]],
    ['점 3개', [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8]]],
    ['null', null],
    ['문자열', 'quad'],
  ])('기형 사각형: %s → null', (_label, quad) => {
    expect(() => P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H)).not.toThrow();
    expect(P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H)).toBeNull();
  });

  test.each([
    ['rect 없음', null],
    ['폭 0', { w: 0, d: 700, originMm: { x: 0, z: 0 } }],
    ['깊이 음수', { w: 3600, d: -700, originMm: { x: 0, z: 0 } }],
    ['숫자가 아니다', { w: '가', d: 700 }],
  ])('나쁜 rect: %s → null', (_label, bad) => {
    expect(() => P.plannerPhotoCamera(good, bad, IMG_W, IMG_H)).not.toThrow();
    expect(P.plannerPhotoCamera(good, bad, IMG_W, IMG_H)).toBeNull();
  });

  test('나쁜 사진 크기 → null', () => {
    for (const [w, h] of [[0, 100], [100, 0], [-4, 3], [NaN, 3], ['4032', 3024]]) {
      expect(P.plannerPhotoCamera(good, rect, w, h)).toBeNull();
    }
  });

  test('rect 의 기본값 — originMm·rotationDeg 가 없으면 0 으로 본다', () => {
    const r = P.plannerPhotoRect({ w: 100, d: 200 });
    expect(r).toEqual({ w: 100, d: 200, originMm: { x: 0, z: 0 }, rotationDeg: 0 });
  });
});

// ── 파일 규약 ────────────────────────────────────────────

describe('모듈 규약', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/planner/photo-solve.js'), 'utf8');

  test('클래식 스크립트 — window 와 module.exports 둘 다 내보낸다 (planner-capture.js 와 같은 꼴)', () => {
    expect(src).toContain('window.PlannerPhotoSolve = PlannerPhotoSolve;');
    expect(src).toContain('if (typeof module !== \'undefined\' && module.exports)');
    expect(P.PlannerPhotoSolve.camera).toBe(P.plannerPhotoCamera);
    expect(P.PlannerPhotoSolve.quadSane).toBe(P.plannerPhotoQuadSane);
  });

  test('DOM·three·npm 에 기대지 않는다', () => {
    const { topLevelDeclarations } = require('../test-utils/js-scan');
    expect(src).not.toMatch(/\brequire\s*\(/);
    expect(src).not.toMatch(/\bTHREE\b/);
    expect(src).not.toMatch(/\bdocument\./);
    // 최상위 이름은 전부 접두사를 단다 — 클래식 스크립트라 전역 렉시컬 스코프를 공유한다
    for (const n of topLevelDeclarations(src)) {
      expect(n).toMatch(/^(plannerPhoto|PLANNER_PHOTO_|PlannerPhotoSolve$)/);
    }
  });

  test('아직 어느 페이지도 싣지 않는다 — P1 에서 붙인다 (계획 §5)', () => {
    for (const f of ['mockup-structure.html', 'mockup-shell.html']) {
      expect(fs.readFileSync(path.join(ROOT, f), 'utf8')).not.toContain('photo-solve.js');
    }
  });
});
