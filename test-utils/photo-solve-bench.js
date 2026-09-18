// 카메라 역산이 합성에 쓸 만한지 재는 하네스 (2026-09-19).
//   결론은 "쓸 수 없다" 였다 — 네 점 오차가 화면 어긋남으로 약 25배 증폭된다.
//   docs/01-plan/photo-composite-research.plan.md §4.1 의 표가 이 스크립트의 출력이다.
//   실행:  node test-utils/photo-solve-bench.js
// 합성에서 실제로 중요한 것은 카메라 위치 오차(mm)가 아니라
// **가구가 사진의 어디에 찍히는가** 다. 카메라가 좀 엉뚱한 데 있어도 화각이 같이 보정되면
// 그림은 거의 같은 자리에 나온다. 그래서 가구 상자 여덟 꼭짓점을
// 참 카메라와 역산 카메라로 각각 투영해 **화면에서 몇 px 어긋나는지** 잰다.
const path = require('path');
const ROOT = process.argv[2] || path.join(__dirname, '..');
const P = require(path.join(ROOT, 'js/planner/photo-solve.js'));

const D2R = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0]/n, a[1]/n, a[2]/n]; };

const IMG_W = 1600, IMG_H = 1200;
const CTR = [1000, 0, 500];

function cameraFrom(position, aim, fovHDeg) {
  const forward = unit(sub(aim, position));
  const right0 = unit(cross3(forward, [0, 1, 0]));
  const up = unit(cross3(right0, forward));
  const fovV = 2 * Math.atan(Math.tan(fovHDeg / 2 * D2R) * IMG_H / IMG_W) / D2R;
  return { position, target: aim, up, fovV, aspect: IMG_W / IMG_H };
}
/** 역산 결과(frame)를 같은 모양으로 — fov 는 세로각이다 */
const asCam = (f) => ({ position: f.position, target: f.target, up: f.up, fovV: f.fov, aspect: f.aspect });

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
function floorCorners(w, d) {
  const hw = w / 2, hd = d / 2, ox = CTR[0], oz = CTR[2];
  return [[ox-hw,0,oz-hd],[ox+hw,0,oz-hd],[ox+hw,0,oz+hd],[ox-hw,0,oz+hd]];
}
/** 가구 상자 여덟 꼭짓점 — 바닥 사각형 위에 높이 H 로 세운다 */
function boxCorners(w, d, H) {
  return floorCorners(w, d).flatMap((c) => [c, [c[0], H, c[2]]]);
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

function run(w, d, H, ampFrac, seed, knownFov) {
  const rnd = seeded(seed);
  const ampPx = ampFrac * IMG_W;
  const jitter = () => (rnd() * 2 - 1) * ampPx;
  const rect = { w, d, originMm: { x: CTR[0], z: CTR[2] }, rotationDeg: 0 };
  const silh = [], rep = [];
  for (let i = 0; i < 600; i++) {
    const fovH = [35, 50, 65, 80][i % 4];
    const height = [1200, 1700, 2500][i % 3];
    const az = [-45, -25, -12, 12, 25, 45][i % 6];
    const span = Math.max(w, d);
    const R = 1.5 * span / (2 * Math.tan(fovH / 2 * D2R)) + 800;
    const a = az * D2R;
    const cam = cameraFrom([CTR[0] + Math.sin(a)*R, height, CTR[2] + Math.cos(a)*R], CTR, fovH);

    const px = floorCorners(w, d).map((c) => project(cam, c));
    if (px.some((p) => !p)) continue;
    const quad = px.map((p) => [(p[0]+jitter())/IMG_W, (p[1]+jitter())/IMG_H]);
    const got = P.plannerPhotoCamera(quad, rect, IMG_W, IMG_H, knownFov ? { fovDeg: fovH } : undefined);
    if (!got) continue;
    const solved = asCam(got);

    // 가구 상자를 두 카메라로 투영해 화면 어긋남을 잰다
    let worst = 0, ok = true;
    for (const c of boxCorners(w, d, H)) {
      const a1 = project(cam, c), a2 = project(solved, c);
      if (!a1 || !a2) { ok = false; break; }
      worst = Math.max(worst, Math.hypot(a1[0]-a2[0], a1[1]-a2[1]));
    }
    if (!ok) continue;
    silh.push(worst);
    rep.push(got.reprojectionPx);
  }
  return { silh, rep, n: silh.length };
}

const CASES = [
  ['싱크대 3600×700×H2300', 3600, 700, 2300],
  ['붙박이장 3600×620×H2310', 3600, 620, 2310],
  ['방바닥 3600×2400 기준', 3600, 2400, 2300],
];
const NOISE = [0.001, 0.003, 0.006, 0.012, 0.025];

for (const knownFov of [false, true]) {
  console.log(knownFov ? '\n== 초점거리를 안다(EXIF) ==' : '== 초점거리도 푼다 ==');
  console.log('| 경우 | 잡음 | ±px | 실루엣 어긋남 중앙 | 90% | 재투영 중앙 |');
  console.log('|---|---|---|---|---|---|');
  for (const [label, w, d, H] of CASES) {
    for (const amp of NOISE) {
      const r = run(w, d, H, amp, 4242, knownFov);
      console.log(`| ${label} | ${(amp*100).toFixed(1)}% | ±${(amp*IMG_W).toFixed(0)} | **${quantile(r.silh,0.5).toFixed(0)}px** | ${quantile(r.silh,0.9).toFixed(0)}px | ${quantile(r.rep,0.5).toFixed(1)}px |`);
    }
  }
}

// 재투영 게이트로 거르면 실루엣이 얼마나 좋아지나
console.log('\n== 재투영 게이트의 값어치 (싱크대 3600×700, 초점거리 푼다) ==');
for (const amp of NOISE) {
  const r = run(3600, 700, 2300, amp, 4242, false);
  const pairs = r.rep.map((v, i) => [v, r.silh[i]]).sort((a, b) => a[0] - b[0]);
  const keep = (frac) => pairs.slice(0, Math.floor(pairs.length * frac)).map((x) => x[1]);
  console.log(`  잡음 ${(amp*100).toFixed(1)}% — 전체 중앙 ${quantile(pairs.map(x=>x[1]),0.5).toFixed(0)}px · 재투영 상위 30% 버리면 ${quantile(keep(0.7),0.5).toFixed(0)}px · 상위 70% 버리면 ${quantile(keep(0.3),0.5).toFixed(0)}px`);
}
