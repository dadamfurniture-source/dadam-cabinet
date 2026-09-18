// ============================================================
// P0: 사진 속 사각형에서 카메라 역산 — photo-solve.js (순수 수학)
//
// 방 사진 위에 **바닥 사각형** 네 귀퉁이를 찍으면, 그 사각형의 실제 치수(배치 공간에서 자동으로 온다)와
// 짝지어 카메라를 푼다. 계획 `docs/01-plan/photo-composite.plan.md` §4.1~4.2 · §5 P0.
//
//   네 점 대응 → 호모그래피 H → (소실점 직교 조건) 초점거리 f → (평면 자세 분해) R·t → three 카메라
//
// AI 가 아니라 기하다. 네 쌍의 대응이면 H 가 유일하게 정해지고, H 하나에서 초점거리와 자세가 모두 나온다.
// 그래서 **GPU 없이 단위 시험으로 정확도를 증명할 수 있다** — 이 파일이 존재하는 이유다
// (`__tests__/photo-solve.test.js` 의 왕복 시험).
//
// ── 좌표계 세 가지를 섞는다. 헷갈리면 여기를 본다 ──────────────
//
//   ① 사진 정규 좌표  quad 의 단위. 좌상단 (0,0), 우하단 (1,1). 사진을 줄이거나 키워도 안 깨진다.
//   ② 사진 픽셀       (0,0) 좌상단, y 아래로 증가. imgW·imgH 를 곱해서 얻는다.
//   ③ 플래너 세계     Y-up, **밀리미터**, 배율 없음. 바닥은 y = 0 (mockup-structure.html:5887-5902).
//
//   카메라 내부 계산은 컴퓨터 비전 관례(OpenCV)를 쓴다 — X 오른쪽, **Y 아래**, Z 앞. three 는
//   X 오른쪽, Y 위, **−Z 앞**이다. 그래서 마지막에 y·z 의 부호를 뒤집어 넘긴다.
//
// ── 화각 두 가지를 섞는다. 이것도 헷갈리면 여기를 본다 ─────────
//
//   three 의 `PerspectiveCamera(fov, …)` 는 **세로** 화각이다 (planner-capture.js:469).
//   반면 이 풀이가 자연스럽게 내는 것 — 그리고 사람이 "화각 60도" 라고 말할 때의 것 — 은 **가로** 화각이다.
//   그래서 결과는 둘 다 담는다:
//     `fov`     세로 화각 (도). three 에 그대로 넣는 값. = 2·atan(imgH / 2f)
//     `fovDeg`  가로 화각 (도). 슬라이더·`opt.assumedFovDeg` 가 말하는 값. = 2·atan(imgW / 2f)
//
// ── 돌려주는 모양 ──────────────────────────────────────────
//
//   `plannerPhotoCamera` 는 `plannerCaptureFrame` (planner-capture.js:229-274) 과 **같은 모양**을 낸다.
//   { kind, fov, aspect, position[3], target[3], up[3], near, far, dist }
//   그래야 `PlannerCapture.capturePixels` 의 카메라 조립(:469-474)과 저장 배관이 통째로 재사용된다.
//   여기에 { f, fovDeg, method, reprojectionPx, reprojectionMaxPx, flipped, quadOrder } 를 더 얹는다.
//
//   ⚠ `aspect` 는 `plannerCaptureClampAspect` (0.5~3) 로 **자르지 않는다**. 사진의 종횡비를 자르면
//     원근이 어긋나 합성이 통째로 틀어진다. 보통 사진(4:3=1.33 · 16:9=1.78 · 9:16=0.56)은 어차피
//     그 범위 안이지만, 범위를 벗어나더라도 진짜 값을 그대로 쓴다.
//
// ── 퇴화(degenerate) — 숨기지 않는다 ───────────────────────
//
//   사각형의 한 쌍의 변이 사진에서 거의 평행하면(정면에서 찍은 사진) 그쪽 소실점이 무한대로 날아가
//   초점거리가 **정해지지 않는다**. 이때 `method:'assumed'` 로 떨어지고 기본 가로 화각 60° 를 쓴다.
//   UI 는 그때 화각 슬라이더를 열어야 한다 (계획 §8). 절대 조용히 넘어가지 않는다.
//
// ⚠ 이 수학이 못 잡는 것 — **시작 귀퉁이**
//   감기(시계/반시계)는 여기서 정규화하지만, 사용자가 어느 귀퉁이에서 시작했는지는 알 방법이 없다.
//   직사각형은 180° 회전에 대해 자기 자신이라, 대각선 반대 귀퉁이에서 시작하면 **재투영 오차가 정확히 0 인,
//   방 반대편에서 본 카메라**가 나온다 (높이까지 같다). 숫자로는 막을 수 없다 — UI 가 귀퉁이에 이름표를 붙여
//   찍는 순서를 강제해야 한다. 자세한 수치는 docs/02-design/features/photo-solve.md.
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 plannerPhoto / PLANNER_PHOTO_ 접두.
//   DOM·three·npm 의존 없음. 순수 함수만. 나쁜 입력에 **던지지 않는다** — null 또는 {ok:false, reason}.
//
// 2026-09-17 결정: 사각형은 늘 **바닥**이고, 실제 치수는 **배치 공간에서 자동**으로 온다 (계획 §9).
// ============================================================

/** 기본 가로 화각 (도) — 소실점으로 초점거리를 못 구할 때 (method:'assumed') */
const PLANNER_PHOTO_ASSUMED_FOV_DEG = 60;
/** 카메라 near — planner-capture.js 의 캡처 기본값과 같다 */
const PLANNER_PHOTO_NEAR = 10;
/** far 여유 — plannerCaptureFrame 과 같은 셈 (dist·4 + 대각 + 여유) */
const PLANNER_PHOTO_FAR_PAD = 20000;
/**
 * 소실점이 "무한대" 인지 보는 한계. 주점에서 사진 대각선의 이 배수보다 멀면 변이 사실상 평행하다.
 * 200 대각선 ≈ 변이 0.3° 안쪽으로 평행 — 이 정도면 f 가 잡음에 통째로 휘둘린다.
 */
const PLANNER_PHOTO_VP_MAX_DIAG = 200;
/** 풀린 가로 화각이 이 범위를 벗어나면 못 믿는다 (도). 실제 렌즈: 초광각 ~120°, 표준 ~65°, 망원 ~25° */
const PLANNER_PHOTO_FOV_MIN_DEG = 5;
const PLANNER_PHOTO_FOV_MAX_DEG = 150;
/**
 * 사각형 최소 넓이 (정규 좌표 기준) — 사진의 0.2%. 4032×3024 사진에서 약 24,000 px² (예: 500×50 px).
 * 이보다 작으면 사람이 손으로 정확히 찍을 수가 없다. 이 위라도 아주 납작한 사각형(낮은 눈높이에서 본
 * 깊이 700 조리대 바닥)은 풀리기는 하되 잡음에 약하다 — 거절이 아니라 `reprojectionPx` 로 알린다.
 */
const PLANNER_PHOTO_MIN_AREA = 0.002;
/** 두 점이 같다고 볼 거리 (정규 좌표) */
const PLANNER_PHOTO_MIN_GAP = 1e-4;
/** 정규 좌표가 0~1 을 벗어나도 봐 주는 여유 */
const PLANNER_PHOTO_UV_EPS = 1e-6;
/** 세 점이 한 직선 위인지 보는 한계 (정규 좌표 외적) */
const PLANNER_PHOTO_COLLINEAR = 1e-9;

const PLANNER_PHOTO_D2R = Math.PI / 180;
const PLANNER_PHOTO_R2D = 180 / Math.PI;

// ── 선형대수 알맹이 ───────────────────────────────────────
// 의존성을 하나도 들이지 않는다 (planner-capture.js 가 sha-256 을 직접 쓴 것과 같은 이유 — :134).
// 작고 쓰이는 곳이 한 군데라 남의 행렬 라이브러리를 데려올 값이 없다.

/** 숫자인가 (NaN·Infinity 는 아니다) */
function plannerPhotoNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** [x,y] 또는 {x,y} → [x,y]. 아니면 null */
function plannerPhotoPoint2(p) {
  if (Array.isArray(p) && plannerPhotoNum(p[0]) && plannerPhotoNum(p[1])) return [p[0], p[1]];
  if (p && typeof p === 'object' && plannerPhotoNum(p.x) && plannerPhotoNum(p.y)) return [p.x, p.y];
  return null;
}

/** 세 성분 벡터 외적 */
function plannerPhotoCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** 내적 */
function plannerPhotoDot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 길이 */
function plannerPhotoLen(a) {
  return Math.sqrt(plannerPhotoDot(a, a));
}

/** 단위 벡터. 길이가 0 이면 null */
function plannerPhotoNormalize(a) {
  const n = plannerPhotoLen(a);
  if (!plannerPhotoNum(n) || n <= 0) return null;
  return a.map((v) => v / n);
}

/** 3×3 곱 (둘 다 행 우선 9칸) */
function plannerPhotoMat3Mul(A, B) {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return out;
}

/** 3×3 전치 */
function plannerPhotoMat3T(A) {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
}

/** 3×3 × 벡터3 */
function plannerPhotoMat3Apply(A, v) {
  return [
    A[0] * v[0] + A[1] * v[1] + A[2] * v[2],
    A[3] * v[0] + A[4] * v[1] + A[5] * v[2],
    A[6] * v[0] + A[7] * v[1] + A[8] * v[2],
  ];
}

/**
 * n원 일차연립방정식 A·x = b — 부분 피벗팅 가우스 소거.
 * @param {number[][]} A n×n (행의 배열). **원본을 건드리지 않는다**
 * @param {number[]} b n칸
 * @returns {number[]|null} 특이(singular)하거나 값이 터지면 null
 */
function plannerPhotoSolveLinear(A, b) {
  if (!Array.isArray(A) || !Array.isArray(b) || A.length !== b.length || !A.length) return null;
  const n = A.length;
  const M = [];
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(A[i]) || A[i].length !== n) return null;
    const row = new Array(n + 1);
    for (let j = 0; j < n; j++) {
      if (!plannerPhotoNum(A[i][j])) return null;
      row[j] = A[i][j];
    }
    if (!plannerPhotoNum(b[i])) return null;
    row[n] = b[i];
    M.push(row);
  }
  // 행별 최대 절댓값 — 피벗이 "이 행 기준으로" 얼마나 작은지 재는 데 쓴다 (규모가 제각각인 계에서 안전)
  const scale = M.map((row) => {
    let m = 0;
    for (let j = 0; j < n; j++) m = Math.max(m, Math.abs(row[j]));
    return m;
  });
  for (let k = 0; k < n; k++) {
    let piv = -1, best = 0;
    for (let i = k; i < n; i++) {
      if (scale[i] <= 0) continue;
      const v = Math.abs(M[i][k]) / scale[i];
      if (v > best) { best = v; piv = i; }
    }
    if (piv < 0 || best < 1e-12) return null;       // 특이 — 못 푼다
    if (piv !== k) {
      const t = M[piv]; M[piv] = M[k]; M[k] = t;
      const s = scale[piv]; scale[piv] = scale[k]; scale[k] = s;
    }
    const p = M[k][k];
    for (let i = k + 1; i < n; i++) {
      const factor = M[i][k] / p;
      if (factor === 0) continue;
      for (let j = k; j <= n; j++) M[i][j] -= factor * M[k][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
    if (!plannerPhotoNum(x[i])) return null;
  }
  return x;
}

/**
 * 점 무리를 중심 0 · 평균 거리 √2 로 옮기는 상사변환 (Hartley 정규화).
 * 이게 없으면 mm(수천)와 px(수천)를 같은 8×8 에 섞을 때 조건수가 나빠져 왕복 오차가 눈에 보인다.
 * @returns {{T:number[], pts:number[][]}|null} T 는 행 우선 3×3
 */
function plannerPhotoNormalizePts(pts) {
  const n = pts.length;
  if (!n) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let md = 0;
  for (const p of pts) md += Math.hypot(p[0] - mx, p[1] - my);
  md /= n;
  if (!plannerPhotoNum(md) || md <= 0) return null;   // 전부 같은 점
  const s = Math.SQRT2 / md;
  return {
    T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1],
    pts: pts.map((p) => [(p[0] - mx) * s, (p[1] - my) * s]),
  };
}

// ── ① 호모그래피 ─────────────────────────────────────────

/**
 * 네 쌍의 점 대응 → 3×3 호모그래피 H (행 우선 9칸). `dst ≈ H · [src;1]` (동차, 마지막으로 나눈다).
 *
 * 8개 미지수(h8 = 1 로 고정)에 대응 하나가 식 두 개를 준다 → 8×8. 가우스 소거로 직접 푼다.
 *   [u v 1 0 0 0 −xu −xv]·h = x
 *   [0 0 0 u v 1 −yu −yv]·h = y
 * 양쪽 점 무리를 Hartley 정규화한 뒤 풀고 되돌린다: H = T_dst⁻¹ · H' · T_src.
 *
 * @param {Array} src 4점 ([x,y] 또는 {x,y})
 * @param {Array} dst 4점
 * @returns {number[]|null} 특이·퇴화면 null
 */
function plannerPhotoHomography(src, dst) {
  if (!Array.isArray(src) || !Array.isArray(dst) || src.length !== 4 || dst.length !== 4) return null;
  const S = [], D = [];
  for (let i = 0; i < 4; i++) {
    const a = plannerPhotoPoint2(src[i]);
    const b = plannerPhotoPoint2(dst[i]);
    if (!a || !b) return null;
    S.push(a); D.push(b);
  }
  const ns = plannerPhotoNormalizePts(S);
  const nd = plannerPhotoNormalizePts(D);
  if (!ns || !nd) return null;

  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const u = ns.pts[i][0], v = ns.pts[i][1];
    const x = nd.pts[i][0], y = nd.pts[i][1];
    A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -y * u, -y * v]); b.push(y);
  }
  const h = plannerPhotoSolveLinear(A, b);
  if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];

  // 되돌리기 — T_dst⁻¹ (상사변환이라 손으로 뒤집는다)
  const sd = nd.T[0];
  if (!plannerPhotoNum(sd) || sd === 0) return null;
  const Tdi = [1 / sd, 0, -nd.T[2] / sd, 0, 1 / sd, -nd.T[5] / sd, 0, 0, 1];
  let H = plannerPhotoMat3Mul(Tdi, plannerPhotoMat3Mul(Hn, ns.T));
  if (!H.every(plannerPhotoNum)) return null;
  // 배율은 자유다 — H[8] = 1 로 맞춰 둔다 (뒤의 식들이 읽기 쉬워진다)
  if (Math.abs(H[8]) > 1e-12) H = H.map((v) => v / H[8]);
  if (!H.every(plannerPhotoNum)) return null;
  return H;
}

// ── ② 초점거리 ───────────────────────────────────────────

/**
 * 소실점 두 개의 **직교 조건** 으로 초점거리 f (픽셀) 를 구한다.
 *
 * 유도 — 바닥 사각형의 두 변 방향은 실제로 서로 직교한다. 그 두 방향의 소실점 v₁·v₂ 는 H 의 1·2 열이다
 * (평면 좌표 (1,0,0)·(0,1,0) 의 상). 소실점은 "그 방향의 무한 원점" 이므로 카메라 중심에서 소실점으로
 * 가는 광선 K⁻¹v 가 곧 그 방향이다. 따라서 (K⁻¹v₁)·(K⁻¹v₂) = 0 이고, 정사각 화소·주점 (cx,cy) 인
 * K = [[f,0,cx],[0,f,cy],[0,0,1]] 을 넣어 f² 로 정리하면
 *
 *     (v₁x − cx)(v₂x − cx) + (v₁y − cy)(v₂y − cy) + f² = 0   →   f = √( −[ … ] )
 *
 * 대괄호 안이 음수여야 f 가 실수다. 두 소실점이 주점에서 볼 때 둔각이라는 뜻 — 그게 아니면 그 네 점은
 * 정사각 화소 카메라가 직사각형을 찍어 만들 수 없는 모양이라 못 푼다.
 *
 * @param {number[]} H 행 우선 3×3 (평면 → 픽셀)
 * @param {number} cx 주점 x (픽셀). 보통 imgW/2
 * @param {number} cy 주점 y (픽셀). 보통 imgH/2
 * @returns {number|null} 퇴화(변이 거의 평행 · 근호 안이 음수 · 말이 안 되는 화각)면 null
 */
function plannerPhotoFocal(H, cx, cy) {
  if (!Array.isArray(H) || H.length !== 9 || !H.every(plannerPhotoNum)) return null;
  if (!plannerPhotoNum(cx) || !plannerPhotoNum(cy)) return null;
  // 사진 대각선 대용 — 주점이 한가운데라는 전제에서 2·√(cx²+cy²)
  const diag = 2 * Math.hypot(cx, cy);
  if (!(diag > 0)) return null;
  const limit = diag * PLANNER_PHOTO_VP_MAX_DIAG;

  const vp = (c0, c1, c2) => {
    if (!plannerPhotoNum(c2) || c2 === 0) return null;
    const x = c0 / c2, y = c1 / c2;
    if (!plannerPhotoNum(x) || !plannerPhotoNum(y)) return null;
    if (Math.hypot(x - cx, y - cy) > limit) return null;   // 사실상 무한대 = 변이 평행
    return [x, y];
  };
  const v1 = vp(H[0], H[3], H[6]);   // 1열 — 평면 u 방향의 소실점
  const v2 = vp(H[1], H[4], H[7]);   // 2열 — 평면 v 방향의 소실점
  if (!v1 || !v2) return null;

  const d = (v1[0] - cx) * (v2[0] - cx) + (v1[1] - cy) * (v2[1] - cy);
  if (!plannerPhotoNum(d) || !(d < 0)) return null;        // 근호 안이 음수 → 실수 해가 없다
  const f = Math.sqrt(-d);
  if (!plannerPhotoNum(f) || !(f > 0)) return null;
  // 가로 화각이 말이 되는가 — cx 가 사진 반폭이다
  const fovH = 2 * Math.atan(cx / f) * PLANNER_PHOTO_R2D;
  if (!(fovH >= PLANNER_PHOTO_FOV_MIN_DEG && fovH <= PLANNER_PHOTO_FOV_MAX_DEG)) return null;
  return f;
}

// ── ③ 평면 자세 분해 ─────────────────────────────────────

/**
 * H 와 f 에서 카메라 자세를 뽑는다 (평면 자세 분해).
 *
 * K⁻¹H = λ·[r₁ r₂ t] 다 (평면의 세 번째 축은 0 이라 3열이 아니라 t 가 온다). 배율 λ 는 회전열의 길이가
 * 1 이어야 한다는 것으로 정한다 — |r₁|·|r₂| 의 기하평균을 쓴다 (한쪽만 쓰면 잡음에 치우친다).
 * 그다음 직교화: r₁ 을 단위로, r₃ = r₁×r₂ 를 단위로, 다시 r₂ = r₃×r₁. 이러면 R 이 정확히 회전행렬이 된다.
 * 부호는 **평면이 카메라 앞** 이어야 한다는 것으로 고른다 (t_z > 0). H 와 −H 는 같은 사영이라 두 해가 있다.
 *
 * @returns {{R:number[], t:number[]}|null} R 은 행 우선 3×3 (모델 → 카메라), t 는 mm. 카메라 관례는 OpenCV
 *   (X 오른쪽 · Y 아래 · Z 앞).
 */
function plannerPhotoPose(H, f, cx, cy) {
  if (!Array.isArray(H) || H.length !== 9 || !H.every(plannerPhotoNum)) return null;
  if (!plannerPhotoNum(f) || !(f > 0)) return null;
  if (!plannerPhotoNum(cx) || !plannerPhotoNum(cy)) return null;

  const Ki = [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1];
  const A = plannerPhotoMat3Mul(Ki, H);
  if (!A.every(plannerPhotoNum)) return null;

  let r1 = [A[0], A[3], A[6]];
  let r2 = [A[1], A[4], A[7]];
  let t = [A[2], A[5], A[8]];
  const n1 = plannerPhotoLen(r1), n2 = plannerPhotoLen(r2);
  if (!(n1 > 0) || !(n2 > 0)) return null;
  const lambda = 1 / Math.sqrt(n1 * n2);
  if (!plannerPhotoNum(lambda) || !(lambda > 0)) return null;
  r1 = r1.map((v) => v * lambda);
  r2 = r2.map((v) => v * lambda);
  t = t.map((v) => v * lambda);
  // 평면이 뒤에 있으면 H ↔ −H 의 다른 해를 고른다. r₁·r₂ 를 같이 뒤집으므로 r₃ 는 그대로다.
  if (t[2] < 0) {
    r1 = r1.map((v) => -v);
    r2 = r2.map((v) => -v);
    t = t.map((v) => -v);
  }
  if (!(t[2] > 0)) return null;                      // 평면이 카메라 평면 위에 있다 — 못 쓴다

  const e1 = plannerPhotoNormalize(r1);
  if (!e1) return null;
  const e3 = plannerPhotoNormalize(plannerPhotoCross(e1, r2));
  if (!e3) return null;                              // r₁ ∥ r₂ — 퇴화
  const e2 = plannerPhotoCross(e3, e1);

  const R = [
    e1[0], e2[0], e3[0],
    e1[1], e2[1], e3[1],
    e1[2], e2[2], e3[2],
  ];
  if (!R.every(plannerPhotoNum) || !t.every(plannerPhotoNum)) return null;
  return { R, t };
}

// ── 배치 공간의 바닥 사각형 ───────────────────────────────

/**
 * rect 를 읽어 정리한다. `{ w, d, originMm:{x,z}, rotationDeg }`.
 * w·d 는 배치 공간의 W·D (`planeBoxOf` 전의 원값 — 90/270 맞바꾸기는 회전이 대신한다),
 * originMm 은 그 공간 바닥 중심의 세계 좌표(원점 오프셋을 이미 뺀 값),
 * rotationDeg 은 평면도 회전각. 3D 는 `rotation.y = −rotationDeg` 로 돈다 (mockup-structure.html:7256).
 */
function plannerPhotoRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const w = Number(rect.w), d = Number(rect.d);
  if (!plannerPhotoNum(w) || !plannerPhotoNum(d) || !(w > 0) || !(d > 0)) return null;
  const o = rect.originMm || {};
  const ox = plannerPhotoNum(Number(o.x)) ? Number(o.x) : 0;
  const oz = plannerPhotoNum(Number(o.z)) ? Number(o.z) : 0;
  const rot = plannerPhotoNum(Number(rect.rotationDeg)) ? Number(rect.rotationDeg) : 0;
  return { w, d, originMm: { x: ox, z: oz }, rotationDeg: rot };
}

/**
 * 바닥 사각형의 네 귀퉁이 — 세계 좌표 mm, y = 0. **이 순서가 quad 의 정본 순서다**:
 *
 *   0 뒤-왼 · 1 뒤-오른 · 2 앞-오른 · 3 앞-왼
 *
 * "뒤" 는 평면도에서 위쪽(벽 쪽, 지역 −Z), "앞" 은 아래쪽(보는 사람 쪽, 지역 +Z).
 * 보통 사진에서 뒤 두 점이 위에, 앞 두 점이 아래에 온다 — 사진 좌표(y 아래)로는 **시계 방향**이다.
 */
function plannerPhotoRectCorners(rect) {
  const r = plannerPhotoRect(rect);
  if (!r) return null;
  const th = -r.rotationDeg * PLANNER_PHOTO_D2R;     // 3D 의 rotation.y
  const c = Math.cos(th), s = Math.sin(th);
  const hw = r.w / 2, hd = r.d / 2;
  //  지역 (u,0,v) → 세계 (u·c + v·s, 0, −u·s + v·c) + 원점
  const at = (u, v) => [r.originMm.x + u * c + v * s, 0, r.originMm.z - u * s + v * c];
  return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
}

/** 모델 평면 좌표 (u,v) — `plannerPhotoRectCorners` 와 같은 순서 */
function plannerPhotoRectModel(rect) {
  const r = plannerPhotoRect(rect);
  if (!r) return null;
  const hw = r.w / 2, hd = r.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
}

// ── 사각형 검사 ──────────────────────────────────────────

/**
 * 사용자가 찍은 네 점이 쓸 만한가. 볼록 · 꼬이지 않음 · 감기 일관 · 최소 넓이 · 사진 안.
 * 감기가 반대인 것은 **거절하지 않는다** — `plannerPhotoCamera` 가 순서를 뒤집어 받아들이고
 * `flipped:true` 로 알려 준다.
 *
 * @param {Array} quad 정규 좌표 4점 (0~1, 좌상단 원점)
 * @returns {{ok:boolean, reason:string|null, area:number, winding:number}}
 *   `winding` > 0 이면 사진 좌표에서 시계 방향 (정본 순서), < 0 이면 반시계.
 */
function plannerPhotoQuadSane(quad) {
  const bad = (reason) => ({ ok: false, reason, area: 0, winding: 0 });
  if (!Array.isArray(quad) || quad.length !== 4) return bad('네 점이 필요합니다');
  const p = [];
  for (let i = 0; i < 4; i++) {
    const q = plannerPhotoPoint2(quad[i]);
    if (!q) return bad('좌표에 숫자가 아닌 값이 있습니다');
    if (q[0] < -PLANNER_PHOTO_UV_EPS || q[0] > 1 + PLANNER_PHOTO_UV_EPS ||
        q[1] < -PLANNER_PHOTO_UV_EPS || q[1] > 1 + PLANNER_PHOTO_UV_EPS) {
      return bad('좌표가 사진 밖입니다 (0~1 이어야 합니다)');
    }
    p.push(q);
  }
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(p[i][0] - p[j][0], p[i][1] - p[j][1]) < PLANNER_PHOTO_MIN_GAP) {
        return bad('같은 점이 두 번 찍혔습니다');
      }
    }
  }
  // 신발끈 — 사진 좌표(y 아래)에서 양수면 시계 방향
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  const area = area2 / 2;

  // 이웃한 두 변의 외적 부호가 넷 다 같아야 볼록하다
  const cz = [];
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
    cz.push((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
  }
  if (cz.some((v) => Math.abs(v) < PLANNER_PHOTO_COLLINEAR)) {
    return bad('세 점이 한 직선 위에 있습니다');
  }
  const pos = cz.filter((v) => v > 0).length;
  if (pos !== 0 && pos !== 4) {
    // 오목인지 꼬였는지 — **마주 보는 변**이 실제로 교차하면 꼬인 것(나비넥타이)이고,
    // 아니면 단순하지만 오목한 것이다. (대각선 교차로는 못 가른다 — 둘 다 교차하지 않는다.)
    const crossed = plannerPhotoSegsCross(p[0], p[1], p[2], p[3]) ||
                    plannerPhotoSegsCross(p[1], p[2], p[3], p[0]);
    return bad(crossed
      ? '사각형이 꼬였습니다 (변끼리 교차합니다)'
      : '사각형이 오목합니다 (귀퉁이 하나가 안으로 들어갔습니다)');
  }
  if (Math.abs(area) < PLANNER_PHOTO_MIN_AREA) {
    return bad('사각형이 너무 작습니다');
  }
  return { ok: true, reason: null, area: Math.abs(area), winding: area > 0 ? 1 : -1 };
}

/** 선분 a1a2 와 b1b2 가 (끝점 제외) 교차하는가 */
function plannerPhotoSegsCross(a1, a2, b1, b2) {
  const d = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const d1 = d(b1, b2, a1), d2 = d(b1, b2, a2), d3 = d(a1, a2, b1), d4 = d(a1, a2, b2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

// ── 투영 (검산용) ────────────────────────────────────────

/**
 * 카메라의 세 축을 three 의 `lookAt` 과 **똑같이** 세운다.
 *   z = normalize(position − target)  (뒤쪽) · x = normalize(up × z) · y = z × x
 * @returns {{x:number[], y:number[], z:number[]}|null}
 */
function plannerPhotoCameraBasis(camera) {
  if (!camera || !Array.isArray(camera.position) || !Array.isArray(camera.target) || !Array.isArray(camera.up)) return null;
  const P = camera.position, T = camera.target, U = camera.up;
  if (!P.every(plannerPhotoNum) || !T.every(plannerPhotoNum) || !U.every(plannerPhotoNum)) return null;
  const z = plannerPhotoNormalize([P[0] - T[0], P[1] - T[1], P[2] - T[2]]);
  if (!z) return null;
  const x = plannerPhotoNormalize(plannerPhotoCross(U, z));
  if (!x) return null;                                // up 이 시선과 평행 — three 도 여기서 무너진다
  const y = plannerPhotoCross(z, x);
  return { x, y, z };
}

/**
 * 세계 좌표 한 점 → 사진 픽셀. 카메라 뒤(또는 평면 위)면 null.
 * `camera.fov` 는 **세로** 화각(three 관례), `camera.aspect` 는 가로/세로.
 */
function plannerPhotoProjectPoint(camera, basis, imgW, imgH, P) {
  const tanV = Math.tan((camera.fov / 2) * PLANNER_PHOTO_D2R);
  if (!plannerPhotoNum(tanV) || !(tanV > 0)) return null;
  const v = [P[0] - camera.position[0], P[1] - camera.position[1], P[2] - camera.position[2]];
  const xv = plannerPhotoDot(v, basis.x);
  const yv = plannerPhotoDot(v, basis.y);
  const depth = -plannerPhotoDot(v, basis.z);         // three 는 −z 가 앞이다
  if (!plannerPhotoNum(depth) || depth <= 1e-9) return null;
  const ndcX = xv / (depth * tanV * camera.aspect);
  const ndcY = yv / (depth * tanV);
  const px = (ndcX + 1) / 2 * imgW;
  const py = (1 - ndcY) / 2 * imgH;
  if (!plannerPhotoNum(px) || !plannerPhotoNum(py)) return null;
  return [px, py];
}

/**
 * 실제 바닥 사각형의 네 귀퉁이를 그 카메라로 다시 사진에 투영한다 — 재투영 오차를 재는 데 쓴다.
 * @returns {Array<number[]|null>|null} 네 칸의 [px, py]. 카메라 뒤면 그 칸은 null. 입력이 나쁘면 통째로 null
 */
function plannerPhotoReproject(camera, rect, imgW, imgH) {
  if (!camera || !plannerPhotoNum(camera.fov) || !plannerPhotoNum(camera.aspect)) return null;
  if (!plannerPhotoNum(imgW) || !plannerPhotoNum(imgH) || !(imgW > 0) || !(imgH > 0)) return null;
  const corners = plannerPhotoRectCorners(rect);
  if (!corners) return null;
  const basis = plannerPhotoCameraBasis(camera);
  if (!basis) return null;
  return corners.map((P) => plannerPhotoProjectPoint(camera, basis, imgW, imgH, P));
}

// ── ④ 한 방에 — 호출자가 쓰는 함수 ────────────────────────

/**
 * 사진 위 사각형 + 실제 바닥 사각형 → three 카메라.
 *
 * @param {Array} quad 사진 정규 좌표 4점 (0~1, 좌상단 원점). 순서는 `plannerPhotoRectCorners` 의
 *   뒤-왼 → 뒤-오른 → 앞-오른 → 앞-왼. **반대로 돌아도 받아 준다** (flipped:true).
 * @param {{w:number, d:number, originMm:{x:number,z:number}, rotationDeg:number}} rect
 *   배치 공간의 바닥 사각형 (플래너 세계 mm). 사람이 재서 넣지 않는다 — 도면에서 온다 (계획 §9-2).
 * @param {number} imgW 사진 가로 픽셀
 * @param {number} imgH 사진 세로 픽셀
 * @param {object} [opt] `{ assumedFovDeg=60 (가로), fovDeg (주면 그 값으로 고정 → method:'assumed'),
 *   near=10, far }`
 * @returns {object|null} `plannerCaptureFrame` 과 같은 모양
 *   `{ kind:'photo', fov(세로), aspect, position[3], target[3], up[3], near, far, dist }`
 *   + `{ f, fovDeg(가로), method:'vanishing'|'assumed', reprojectionPx(RMS), reprojectionMaxPx,
 *        flipped, quadOrder }`.
 *   나쁜 입력·퇴화로 못 풀면 **null** (던지지 않는다).
 */
function plannerPhotoCamera(quad, rect, imgW, imgH, opt) {
  opt = opt || {};
  const r = plannerPhotoRect(rect);
  if (!r) return null;
  if (!plannerPhotoNum(imgW) || !plannerPhotoNum(imgH) || !(imgW > 0) || !(imgH > 0)) return null;
  const sane = plannerPhotoQuadSane(quad);
  if (!sane.ok) return null;

  // 감기 정규화 — 첫 점(뒤-왼)은 그대로 두고 나머지를 거꾸로 돌린다
  const quadOrder = sane.winding > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
  const flipped = sane.winding < 0;
  const px = quadOrder.map((i) => {
    const q = plannerPhotoPoint2(quad[i]);
    return [q[0] * imgW, q[1] * imgH];
  });

  const model = plannerPhotoRectModel(r);
  const H = plannerPhotoHomography(model, px);
  if (!H) return null;

  const cx = imgW / 2, cy = imgH / 2;
  const fFromFov = (deg) => {
    const d = Number(deg);
    if (!plannerPhotoNum(d) || !(d > 0) || !(d < 180)) return null;
    const t = Math.tan((d / 2) * PLANNER_PHOTO_D2R);
    return t > 0 ? imgW / (2 * t) : null;
  };
  let method = 'vanishing';
  let f = null;
  if (opt.fovDeg != null) {                      // 사용자가 슬라이더로 고정한 화각 (P1)
    f = fFromFov(opt.fovDeg);
    method = 'assumed';
  } else {
    f = plannerPhotoFocal(H, cx, cy);
    if (f == null) {                             // 변이 거의 평행 — 초점거리가 정해지지 않는다
      f = fFromFov(opt.assumedFovDeg != null ? opt.assumedFovDeg : PLANNER_PHOTO_ASSUMED_FOV_DEG);
      method = 'assumed';
    }
  }
  if (f == null) f = fFromFov(PLANNER_PHOTO_ASSUMED_FOV_DEG);
  if (f == null || !(f > 0)) return null;

  const pose = plannerPhotoPose(H, f, cx, cy);
  if (!pose) return null;
  const R = pose.R, t = pose.t;

  // 모델 평면 (u, v) → 세계. 열이 [Ex, Ez, En] 인 회전행렬 M (En = Ex×Ez = 아래쪽, 오른손계다)
  const th = -r.rotationDeg * PLANNER_PHOTO_D2R;
  const c = Math.cos(th), s = Math.sin(th);
  const M = [
    c, s, 0,
    0, 0, -1,
    -s, c, 0,
  ];
  const O = [r.originMm.x, 0, r.originMm.z];

  // 세계 → 카메라 회전. X_cam = R·(Mᵀ(X_world − O)) + t
  const Rw = plannerPhotoMat3Mul(R, plannerPhotoMat3T(M));
  // 카메라 중심 — 모델 좌표로 −Rᵀt, 그걸 세계로
  const Cm = plannerPhotoMat3Apply(plannerPhotoMat3T(R), t).map((v) => -v);
  const Cw = plannerPhotoMat3Apply(M, Cm);
  const position = [Cw[0] + O[0], Cw[1] + O[1], Cw[2] + O[2]];

  // Rw 의 행이 곧 카메라 축(세계 좌표)이다. 0행 x(오른쪽) · 1행 y(**아래**) · 2행 z(앞).
  // three 는 y 가 위 · −z 가 앞이므로 up 은 1행을 뒤집은 것, 시선은 2행 그대로.
  const forward = [Rw[6], Rw[7], Rw[8]];
  const up = [-Rw[3], -Rw[4], -Rw[5]];
  const dist = plannerPhotoLen(t);
  if (!plannerPhotoNum(dist) || !(dist > 0)) return null;
  // 타깃은 사각형 중심이 아니라 **시선 위의 점**이어야 한다 — 그래야 three 의 lookAt 이 이 자세를 그대로 만든다
  // (사각형 중심이 화면 한가운데 있으리라는 보장이 없다). 깊이는 t_z 를 쓴다.
  const target = [
    position[0] + forward[0] * t[2],
    position[1] + forward[1] * t[2],
    position[2] + forward[2] * t[2],
  ];

  const fovV = 2 * Math.atan(imgH / (2 * f)) * PLANNER_PHOTO_R2D;
  const fovH = 2 * Math.atan(imgW / (2 * f)) * PLANNER_PHOTO_R2D;
  const diag = Math.sqrt(r.w * r.w + r.d * r.d);
  const near = plannerPhotoNum(Number(opt.near)) ? Number(opt.near) : PLANNER_PHOTO_NEAR;
  const far = plannerPhotoNum(Number(opt.far))
    ? Number(opt.far)
    : Math.ceil(dist * 4 + diag + PLANNER_PHOTO_FAR_PAD);

  const camera = {
    kind: 'photo',
    fov: fovV,                    // three 에 넣는 값 — **세로** 화각
    aspect: imgW / imgH,          // 사진 그대로. plannerCaptureClampAspect 로 자르지 않는다 (머리말 참고)
    position,
    target,
    up,
    near,
    far,
    dist,
  };
  const nums = [camera.fov, camera.aspect, camera.near, camera.far, camera.dist]
    .concat(position, target, up);
  if (!nums.every(plannerPhotoNum)) return null;
  if (!(camera.fov > 0) || !(camera.fov < 180)) return null;

  // 재투영 오차 — 사용자가 "맞았는지" 를 숫자로 안다 (계획 §4.2)
  let rms = null, worst = null;
  const back = plannerPhotoReproject(camera, r, imgW, imgH);
  if (back) {
    let sum = 0, mx = 0, ok = true;
    for (let i = 0; i < 4; i++) {
      if (!back[i]) { ok = false; break; }
      const dx = back[i][0] - px[i][0], dy = back[i][1] - px[i][1];
      const e = Math.hypot(dx, dy);
      sum += e * e;
      if (e > mx) mx = e;
    }
    if (ok) { rms = Math.sqrt(sum / 4); worst = mx; }
  }

  camera.f = f;
  camera.fovDeg = fovH;           // 사람이 말하는 **가로** 화각
  camera.method = method;
  camera.reprojectionPx = rms;
  camera.reprojectionMaxPx = worst;
  camera.flipped = flipped;
  camera.quadOrder = quadOrder;
  return camera;
}

// ── 내보내기 ─────────────────────────────────────────────

const PlannerPhotoSolve = {
  homography: plannerPhotoHomography,
  focal: plannerPhotoFocal,
  pose: plannerPhotoPose,
  camera: plannerPhotoCamera,
  reproject: plannerPhotoReproject,
  quadSane: plannerPhotoQuadSane,
  rectCorners: plannerPhotoRectCorners,
  // P1: 사각형 편집기가 **원근 격자**를 그리려면 세계 점 하나를 사진 픽셀로 보낼 수 있어야 한다.
  //   맨이름(plannerPhotoProjectPoint)은 브라우저에서만 전역이라 시험 환경에서 끊긴다 — 객체에 올려 둔다.
  basis: plannerPhotoCameraBasis,
  project: plannerPhotoProjectPoint,
  rect: plannerPhotoRect,
  rectModel: plannerPhotoRectModel,
};

if (typeof window !== 'undefined') {
  window.PlannerPhotoSolve = PlannerPhotoSolve;
  window.plannerPhotoCamera = plannerPhotoCamera;
  window.plannerPhotoQuadSane = plannerPhotoQuadSane;
  window.plannerPhotoReproject = plannerPhotoReproject;
  window.plannerPhotoRectCorners = plannerPhotoRectCorners;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_PHOTO_ASSUMED_FOV_DEG,
    PLANNER_PHOTO_NEAR,
    PLANNER_PHOTO_FAR_PAD,
    PLANNER_PHOTO_VP_MAX_DIAG,
    PLANNER_PHOTO_FOV_MIN_DEG,
    PLANNER_PHOTO_FOV_MAX_DEG,
    PLANNER_PHOTO_MIN_AREA,
    PLANNER_PHOTO_MIN_GAP,
    plannerPhotoNum,
    plannerPhotoPoint2,
    plannerPhotoCross,
    plannerPhotoDot,
    plannerPhotoLen,
    plannerPhotoNormalize,
    plannerPhotoMat3Mul,
    plannerPhotoMat3T,
    plannerPhotoMat3Apply,
    plannerPhotoSolveLinear,
    plannerPhotoNormalizePts,
    plannerPhotoHomography,
    plannerPhotoFocal,
    plannerPhotoPose,
    plannerPhotoRect,
    plannerPhotoRectCorners,
    plannerPhotoRectModel,
    plannerPhotoQuadSane,
    plannerPhotoSegsCross,
    plannerPhotoCameraBasis,
    plannerPhotoProjectPoint,
    plannerPhotoReproject,
    plannerPhotoCamera,
    PlannerPhotoSolve,
  };
}
