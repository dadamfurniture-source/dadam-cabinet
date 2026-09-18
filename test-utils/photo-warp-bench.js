// 벽 평면 호모그래피가 카메라 역산보다 얼마나 잘 조건화되는지 재는 하네스 (2026-09-19).
//   결론: 어긋남이 네 점 오차와 1:1 이다 (역산은 25배). 40배 좋다.
//   docs/01-plan/photo-composite-research.plan.md §4.2 의 표가 이 스크립트의 출력이다.
//   실행:  node test-utils/photo-warp-bench.js
// 카메라를 풀지 않고 **벽 평면 호모그래피만** 쓰면 어떤가.
//   정면 입면(도면 그대로)을 벽 네 귀퉁이로 워프한다. 초점거리도 자세도 안 푼다.
//   장의 앞면은 벽과 같은 평면이라 이 워프가 원리적으로 정확하다 (깊이만 잃는다).
// 재는 것: 벽 네 점에 잡음을 주었을 때 **벽면 위의 점이 화면에서 몇 px 어긋나는가.**
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const P = require(path.join(ROOT, 'js/planner/photo-solve.js'));

const D2R = Math.PI / 180;
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0]/n, a[1]/n, a[2]/n]; };

const IMG_W = 1600, IMG_H = 1200;

function cameraFrom(position, aim, fovHDeg) {
  const forward = unit(sub(aim, position));
  const right0 = unit(cross3(forward, [0, 1, 0]));
  const up = unit(cross3(right0, forward));
  const fovV = 2 * Math.atan(Math.tan(fovHDeg / 2 * D2R) * IMG_H / IMG_W) / D2R;
  return { position, target: aim, up, fovV, aspect: IMG_W / IMG_H };
}
function project(cam, Pw) {
  const z = unit(sub(cam.position, cam.target));
  const x = unit(cross3(cam.up, z));
  const y = cross3(z, x);
  const v = sub(Pw, cam.position);
  const depth = -dot3(v, z);
  if (depth <= 0) return null;
  const tanV = Math.tan(cam.fovV / 2 * D2R);
  return [((dot3(v, x) / (depth * tanV * cam.aspect)) + 1) / 2 * IMG_W,
          (1 - (dot3(v, y) / (depth * tanV))) / 2 * IMG_H];
}
function seeded(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const quantile = (arr, p) => {
  if (!arr.length) return NaN;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
};

/** 벽은 z = 0 평면. 가로 W, 세로 H. 벽면 좌표 (u, v) → 세계 */
const wallPoint = (u, v) => [u, v, 0];

function run(W, H, ampFrac, seed) {
  const rnd = seeded(seed);
  const ampPx = ampFrac * IMG_W;
  const jit = () => (rnd() * 2 - 1) * ampPx;
  const out = [];
  for (let i = 0; i < 600; i++) {
    const fovH = [35, 50, 65, 80][i % 4];
    const camH = [1200, 1700, 2500][i % 3];
    const az = [-40, -25, -12, 12, 25, 40][i % 6];
    const R = 1.5 * W / (2 * Math.tan(fovH / 2 * D2R)) + 800;
    const a = az * D2R;
    // 벽 중심을 바라본다. 벽은 z=0, 카메라는 z>0 쪽
    const aim = [W / 2, H / 2, 0];
    const cam = cameraFrom([W/2 + Math.sin(a)*R, camH, Math.cos(a)*R], aim, fovH);

    // 벽 네 귀퉁이 (좌상 좌하 우하 우상)
    const corners = [wallPoint(0, H), wallPoint(0, 0), wallPoint(W, 0), wallPoint(W, H)];
    const px = corners.map((c) => project(cam, c));
    if (px.some((p) => !p)) continue;
    const noisy = px.map((p) => [p[0] + jit(), p[1] + jit()]);

    // 벽면 좌표(정규) → 사진 픽셀 호모그래피. 초점거리도 자세도 안 푼다.
    const src = [[0, 0], [0, 1], [1, 1], [1, 0]];        // (u/W, 1-v/H) 순서 맞춤
    const Hm = P.plannerPhotoHomography(src, noisy);
    if (!Hm) continue;

    // 벽면 위 격자점들이 어디에 떨어지는지 — 참값 대비
    let worst = 0; let ok = true;
    for (let gu = 0; gu <= 4; gu++) {
      for (let gv = 0; gv <= 4; gv++) {
        const u = gu / 4, v = gv / 4;
        const truth = project(cam, wallPoint(u * W, (1 - v) * H));
        if (!truth) { ok = false; break; }
        const w = P.plannerPhotoMat3Apply(Hm, [u, v, 1]);
        if (!w || !w[2]) { ok = false; break; }
        const got = [w[0] / w[2], w[1] / w[2]];
        worst = Math.max(worst, Math.hypot(truth[0] - got[0], truth[1] - got[1]));
      }
      if (!ok) break;
    }
    if (ok) out.push(worst);
  }
  return out;
}

const CASES = [
  ['벽 3600×2400', 3600, 2400],
  ['벽 4400×2400', 4400, 2400],
  ['벽 2400×2400', 2400, 2400],
];
const NOISE = [0.001, 0.003, 0.006, 0.012, 0.025];

console.log('벽 평면 호모그래피만 — 카메라 역산 없음');
console.log('| 벽 | 잡음 | ±px | 벽면 어긋남 중앙 | 90% |');
console.log('|---|---|---|---|---|');
for (const [label, W, H] of CASES) {
  for (const amp of NOISE) {
    const r = run(W, H, amp, 4242);
    console.log(`| ${label} | ${(amp*100).toFixed(1)}% | ±${(amp*IMG_W).toFixed(0)} | **${quantile(r,0.5).toFixed(0)}px** | ${quantile(r,0.9).toFixed(0)}px |`);
  }
}
