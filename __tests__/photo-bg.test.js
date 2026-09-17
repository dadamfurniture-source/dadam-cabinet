/**
 * P1: 방 사진 배경 — 상태·사진 들이기·화각 자동 맞춤 (js/planner/photo-bg.js).
 *
 * 전부 순수하거나 순수에 가깝다 (jsdom 의 localStorage · 문서 스타일만 쓴다). GPU 도 실제 디코더도 없다 —
 * 픽셀은 여기서 볼 수 없고, 보려 하지도 않는다 (계획 §7 "픽셀: jsdom 에 WebGL 이 없어 불가").
 *
 *   · EXIF 방향 1~8 을 진짜 JPEG 바이트에서 읽어낸다 (APP1 → TIFF → IFD0 → 0x0112)
 *   · 방향값 → 캔버스 변환 행렬 — 여덟 가지 전부, 귀퉁이가 어디로 가는지로 확인
 *   · **두 번 돌리기 방지** — 브라우저가 이미 돌려 디코딩했으면 우리는 손대지 않는다
 *   · 축소 셈 — 긴 변 4096, 작은 사진은 키우지 않는다
 *   · `quadDefault` 는 photo-solve 의 정본 순서(시계 방향)로 놓인다
 *   · `rectFromArea` 가 **골든 픽스처의 배치 공간**에서 renderAreas3D 와 같은 값을 낸다
 *   · `fitFov` 가 알려진 화각을 되찾는다 (틀린 화각은 재투영 오차로 드러난다 — P0 측정)
 *   · `quadHealth` 의 세 등급과 **물리 검사 네 가지**가 각각 실제로 발동한다
 *   · 상태가 localStorage(스코프 키)를 왕복한다
 */
const B = require('../js/planner/photo-bg');
const P = require('../js/planner/photo-solve');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const D2R = Math.PI / 180;
const IMG_W = 4032, IMG_H = 3024;

// ── 시험이 직접 갖는 전방 투영 (photo-solve.test.js 와 같은 이유 — 순환 금지) ──

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };

function testCamera(position, aim, fovHDeg) {
  const forward = unit(sub(aim, position));
  const right = unit(cross3(forward, [0, 1, 0]));
  const up = cross3(right, forward);
  const fovV = 2 * Math.atan(Math.tan(fovHDeg / 2 * D2R) * IMG_H / IMG_W) / D2R;
  return { position, target: aim, up, fovV, aspect: IMG_W / IMG_H };
}

function testProject(cam, Pw) {
  const z = unit(sub(cam.position, cam.target));
  const x = unit(cross3(cam.up, z));
  const y = cross3(z, x);
  const v = sub(Pw, cam.position);
  const depth = -dot3(v, z);
  if (depth <= 0) return null;
  const tanV = Math.tan(cam.fovV / 2 * D2R);
  return [
    (dot3(v, x) / (depth * tanV * cam.aspect) + 1) / 2 * IMG_W,
    (1 - dot3(v, y) / (depth * tanV)) / 2 * IMG_H,
  ];
}

function testCorners(rect) {
  const th = -(rect.rotationDeg || 0) * D2R;
  const c = Math.cos(th), s = Math.sin(th);
  const hw = rect.w / 2, hd = rect.d / 2;
  const at = (u, v) => [rect.originMm.x + u * c + v * s, 0, rect.originMm.z - u * s + v * c];
  return [at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)];
}

/** 사각형을 찍는 카메라를 세우고, 그 사진 위 정규 좌표 네 점을 만든다 */
function shoot(rect, opt) {
  const o = opt || {};
  const fovH = o.fovHDeg || 60;
  const az = (o.azDeg == null ? -30 : o.azDeg) * D2R;
  const R = o.dist || 3200;
  const pos = [
    rect.originMm.x + Math.sin(az) * R,
    o.height == null ? 1600 : o.height,
    rect.originMm.z + Math.cos(az) * R,
  ];
  const cam = testCamera(pos, [rect.originMm.x, 0, rect.originMm.z], fovH);
  const px = testCorners(rect).map((c) => testProject(cam, c));
  if (px.some((p) => !p)) throw new Error('시험 배치가 카메라 뒤에 있습니다');
  return { cam, quad: px.map((p) => [p[0] / IMG_W, p[1] / IMG_H]) };
}

const RECT = { w: 2400, d: 1500, originMm: { x: 1000, z: 500 }, rotationDeg: 0 };

// ── EXIF ────────────────────────────────────────────────

/**
 * 시험용 JPEG 를 바이트로 짓는다 — SOI + (APP1/EXIF) + SOF0 + SOS.
 * 진짜 파서를 시험하려면 진짜 바이트가 있어야 한다. 라이브러리는 쓰지 않는다 (모듈도 안 쓴다).
 */
function jpegWith(orientation, w, h, opt) {
  const o = opt || {};
  const out = [0xFF, 0xD8];
  if (orientation) {
    const le = !o.bigEndian;
    const u16 = (v) => (le ? [v & 0xFF, (v >> 8) & 0xFF] : [(v >> 8) & 0xFF, v & 0xFF]);
    const u32 = (v) => (le
      ? [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF]
      : [(v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF]);
    const tiff = []
      .concat(le ? [0x49, 0x49] : [0x4D, 0x4D])
      .concat(u16(0x002A))
      .concat(u32(8))                                   // IFD0 은 TIFF 머리 바로 뒤
      .concat(u16(1))                                   // 항목 1개
      .concat(u16(0x0112), u16(3), u32(1), u16(orientation), [0, 0])
      .concat(u32(0));                                  // 다음 IFD 없음
    const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00].concat(tiff);
    const size = app1.length + 2;
    out.push(0xFF, 0xE1, (size >> 8) & 0xFF, size & 0xFF);
    app1.forEach((b) => out.push(b));
  }
  // SOF0 — 저장된 크기
  out.push(0xFF, 0xC0, 0x00, 0x11, 0x08, (h >> 8) & 0xFF, h & 0xFF, (w >> 8) & 0xFF, w & 0xFF);
  for (let i = 0; i < 8; i++) out.push(0);
  out.push(0xFF, 0xDA, 0x00, 0x02);
  return Uint8Array.from(out);
}

describe('EXIF 방향 — 진짜 JPEG 바이트에서 읽는다', () => {
  test('1~8 을 전부 읽어낸다 (리틀엔디언·빅엔디언 둘 다)', () => {
    for (let o = 1; o <= 8; o++) {
      expect(B.plannerPhotoBgExifOrientation(jpegWith(o, 4000, 3000))).toBe(o);
      expect(B.plannerPhotoBgExifOrientation(jpegWith(o, 4000, 3000, { bigEndian: true }))).toBe(o);
    }
  });

  test('EXIF 가 없거나 JPEG 가 아니면 0 — 던지지 않는다', () => {
    expect(B.plannerPhotoBgExifOrientation(jpegWith(0, 100, 80))).toBe(0);
    expect(B.plannerPhotoBgExifOrientation(Uint8Array.from([0x89, 0x50, 0x4E, 0x47]))).toBe(0);   // PNG
    expect(B.plannerPhotoBgExifOrientation(null)).toBe(0);
    expect(B.plannerPhotoBgExifOrientation(Uint8Array.from([0xFF, 0xD8]))).toBe(0);
    expect(B.plannerPhotoBgExifOrientation(jpegWith(9, 10, 10))).toBe(0);                          // 범위 밖
  });

  test('저장된 크기(SOF)를 읽는다 — 브라우저가 이미 돌렸는지 가르는 데 쓴다', () => {
    expect(B.plannerPhotoBgJpegSize(jpegWith(6, 4000, 3000))).toEqual({ width: 4000, height: 3000 });
    expect(B.plannerPhotoBgJpegSize(Uint8Array.from([0xFF, 0xD8, 0xFF, 0xD9]))).toBeNull();
  });

  test('ArrayBuffer 로 줘도 같다', () => {
    const u8 = jpegWith(6, 4000, 3000);
    expect(B.plannerPhotoBgExifOrientation(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength))).toBe(6);
  });
});

describe('방향값 → 캔버스 변환', () => {
  const W = 400, H = 300;
  /** 행렬을 점에 먹인다 — ctx.setTransform(a,b,c,d,e,f) 과 같은 규약 */
  const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  test('여덟 가지 전부 — 출력 크기와 네 귀퉁이가 캔버스 안에 정확히 들어간다', () => {
    for (let o = 1; o <= 8; o++) {
      const T = B.plannerPhotoBgOrientTransform(o, W, H);
      expect(T.swap).toBe(o >= 5);
      expect(T.width).toBe(o >= 5 ? H : W);
      expect(T.height).toBe(o >= 5 ? W : H);
      const pts = [[0, 0], [W, 0], [W, H], [0, H]].map((p) => ap(T.matrix, p[0], p[1]));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      expect(Math.min(...xs)).toBeCloseTo(0, 9);
      expect(Math.min(...ys)).toBeCloseTo(0, 9);
      expect(Math.max(...xs)).toBeCloseTo(T.width, 9);
      expect(Math.max(...ys)).toBeCloseTo(T.height, 9);
    }
  });

  test('방향 6(시계 90°)은 원본 좌상단을 오른쪽 위로 보낸다', () => {
    const T = B.plannerPhotoBgOrientTransform(6, W, H);
    expect(ap(T.matrix, 0, 0)).toEqual([H, 0]);
    expect(T.rotateDeg).toBe(90);
    expect(T.flip).toBe(false);
  });

  test('방향 8(반시계 90°)은 좌상단을 왼쪽 아래로', () => {
    const T = B.plannerPhotoBgOrientTransform(8, W, H);
    expect(ap(T.matrix, 0, 0)).toEqual([0, W]);
    expect(T.rotateDeg).toBe(270);
  });

  test('방향 2 는 좌우 뒤집기만 (크기 그대로)', () => {
    const T = B.plannerPhotoBgOrientTransform(2, W, H);
    expect(ap(T.matrix, 0, 0)).toEqual([W, 0]);
    expect(T.flip).toBe(true);
    expect(T.width).toBe(W);
  });

  test('모르는 값은 1 로 본다', () => {
    expect(B.plannerPhotoBgOrientTransform(0, W, H).matrix).toEqual([1, 0, 0, 1, 0, 0]);
    expect(B.plannerPhotoBgOrientTransform(99, W, H).width).toBe(W);
  });
});

describe('두 번 돌리기 방지', () => {
  const stored = { width: 4000, height: 3000 };

  test('브라우저가 이미 돌렸으면(크기가 맞바뀌어 왔다) 우리는 손대지 않는다', () => {
    expect(B.plannerPhotoBgNeedsRotate(6, stored, { width: 3000, height: 4000 })).toBe(false);
    expect(B.plannerPhotoBgNeedsRotate(8, stored, { width: 3000, height: 4000 })).toBe(false);
  });

  test('저장된 그대로 왔으면(크기가 안 바뀌었다) 우리가 돌린다 — 크기 비교가 이기는 신호다', () => {
    expect(B.plannerPhotoBgNeedsRotate(6, stored, { width: 4000, height: 3000 }, { browserOrients: true })).toBe(true);
    expect(B.plannerPhotoBgNeedsRotate(5, stored, { width: 4000, height: 3000 })).toBe(true);
  });

  test('방향 1·0 은 언제나 할 일이 없다', () => {
    expect(B.plannerPhotoBgNeedsRotate(1, stored, { width: 4000, height: 3000 })).toBe(false);
    expect(B.plannerPhotoBgNeedsRotate(0, stored, { width: 4000, height: 3000 })).toBe(false);
  });

  test('2·3·4 는 크기가 안 바뀌어 비교로 못 가른다 — 브라우저 신호를 따른다', () => {
    for (const o of [2, 3, 4]) {
      expect(B.plannerPhotoBgNeedsRotate(o, stored, stored, { browserOrients: true })).toBe(false);
      expect(B.plannerPhotoBgNeedsRotate(o, stored, stored, { browserOrients: false })).toBe(true);
    }
  });

  test('정사각형 사진은 크기로 못 가른다 — 브라우저 신호로 떨어진다', () => {
    const sq = { width: 2000, height: 2000 };
    expect(B.plannerPhotoBgNeedsRotate(6, sq, sq, { browserOrients: true })).toBe(false);
    expect(B.plannerPhotoBgNeedsRotate(6, sq, sq, { browserOrients: false })).toBe(true);
  });
});

describe('받는 파일 · 축소 셈', () => {
  test('JPEG·PNG 만, 20MB 까지 — 거절 이유는 한국어 그대로', () => {
    expect(B.plannerPhotoBgAccept({ type: 'image/jpeg', size: 1000, name: 'a.jpg' }).ok).toBe(true);
    expect(B.plannerPhotoBgAccept({ type: 'image/png', size: 1000, name: 'a.png' }).ok).toBe(true);
    expect(B.plannerPhotoBgAccept({ type: '', size: 10, name: 'a.JPEG' }).ok).toBe(true);
    expect(B.plannerPhotoBgAccept({ type: 'image/heic', size: 10, name: 'a.heic' }))
      .toEqual({ ok: false, message: 'JPEG 또는 PNG 사진만 올릴 수 있습니다' });
    const big = B.plannerPhotoBgAccept({ type: 'image/jpeg', size: 25 * 1024 * 1024, name: 'a.jpg' });
    expect(big.ok).toBe(false);
    expect(big.message).toContain('20MB');
    expect(B.plannerPhotoBgAccept(null).ok).toBe(false);
  });

  test('긴 변 4096 으로 줄이고, 작은 사진은 키우지 않는다', () => {
    expect(B.plannerPhotoBgFitSize(8000, 6000, 4096)).toEqual({ width: 4096, height: 3072, scale: 4096 / 8000 });
    expect(B.plannerPhotoBgFitSize(3000, 6000, 4096)).toEqual({ width: 2048, height: 4096, scale: 4096 / 6000 });
    expect(B.plannerPhotoBgFitSize(1200, 800, 4096)).toEqual({ width: 1200, height: 800, scale: 1 });
    expect(B.plannerPhotoBgFitSize(4096, 4096, 4096).scale).toBe(1);
    // 종횡비가 유지된다 (원근이 어긋나면 합성이 통째로 틀어진다)
    const f = B.plannerPhotoBgFitSize(4032, 3024, 4096);
    expect(f.width / f.height).toBeCloseTo(4032 / 3024, 6);
  });
});

// ── 사각형 ──────────────────────────────────────────────

describe('처음 까는 사각형 (quadDefault)', () => {
  test('photo-solve 가 받아들이는 정본 순서 — 시계 방향, 사진 안, 넉넉한 넓이', () => {
    const q = B.plannerPhotoBgQuadDefault(IMG_W, IMG_H);
    expect(q).toHaveLength(4);
    const sane = P.plannerPhotoQuadSane(q);
    expect(sane.ok).toBe(true);
    expect(sane.winding).toBe(1);            // 뒤-왼 → 뒤-오른 → 앞-오른 → 앞-왼 = 시계 방향
    q.forEach(([x, y]) => { expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1); expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(1); });
  });

  test('아래쪽 한가운데다 — 뒤 두 점이 위, 앞 두 점이 아래, 앞이 더 넓다 (사다리꼴)', () => {
    const q = B.plannerPhotoBgQuadDefault(IMG_W, IMG_H);
    expect(q[0][1]).toBeLessThan(q[3][1]);                       // 뒤가 위
    expect(q[1][1]).toBeLessThan(q[2][1]);
    expect(q[2][0] - q[3][0]).toBeGreaterThan(q[1][0] - q[0][0]); // 앞이 더 넓다 = 원근
    expect(q.reduce((s, p) => s + p[1], 0) / 4).toBeGreaterThan(0.5);
  });

  test('돌려준 배열을 고쳐도 정본은 안 바뀐다', () => {
    const q = B.plannerPhotoBgQuadDefault(1, 1);
    q[0][0] = 99;
    expect(B.plannerPhotoBgQuadDefault(1, 1)[0][0]).toBe(0.30);
  });
});

describe('배치 공간 → 실제 바닥 사각형 (rectFromArea)', () => {
  function boot(fixture) {
    const seed = Object.assign({}, seedFor(fixture));
    const search = seed._search;
    delete seed._search;
    const p = bootPlanner('mockup-structure.html', { search, storage: seed });
    if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
    p.g('loadModules')();
    return p;
  }

  test('골든 픽스처(직선)의 배치 공간에서 renderAreas3D 와 **같은 값**을 낸다', () => {
    const p = boot(FIXTURES.straight);
    const areas = p.g('areas');
    const origin = p.g('originPos2D');
    const planeBoxOf = p.g('planeBoxOf');
    expect(areas.length).toBeGreaterThan(0);
    areas.forEach((a) => {
      const rect = B.plannerPhotoBgRectFromArea(a, origin);
      const Bx = planeBoxOf(a);                        // 3D 가 상자를 놓는 바로 그 셈
      expect(rect.originMm.x).toBeCloseTo(Bx.cx - origin.x, 9);
      expect(rect.originMm.z).toBeCloseTo(Bx.cy - origin.y, 9);
      expect(rect.w).toBe(a.W);                        // 맞바꾸기 전 원값 — 90/270 은 회전이 대신한다
      expect(rect.d).toBe(a.D);
      expect(rect.rotationDeg).toBe(((a.rotation || 0) % 360 + 360) % 360);
      expect(rect.areaId).toBe(a.id);
    });
  });

  test('회전 90 인 배치(ㄱ자)도 같다 — 폭·깊이를 맞바꾸지 않는다', () => {
    const p = boot(FIXTURES.lShape);
    const origin = p.g('originPos2D');
    const rot = p.g('areas').filter((a) => ((a.rotation || 0) % 360 + 360) % 360 === 90);
    expect(rot.length).toBeGreaterThan(0);
    rot.forEach((a) => {
      const rect = B.plannerPhotoBgRectFromArea(a, origin);
      expect(rect.w).toBe(a.W);
      expect(rect.d).toBe(a.D);
      expect(rect.rotationDeg).toBe(90);
      // 네 귀퉁이가 실제로 90° 돌아 있다 (photo-solve 의 정본 귀퉁이로 확인)
      const corners = P.plannerPhotoRectCorners(rect);
      const backLeft = corners[0], backRight = corners[1];
      expect(Math.abs(backRight[2] - backLeft[2])).toBeCloseTo(a.W, 6);   // 폭이 Z 축으로 갔다
      expect(Math.abs(backRight[0] - backLeft[0])).toBeCloseTo(0, 6);
    });
  });

  test('나쁜 입력은 null (던지지 않는다)', () => {
    expect(B.plannerPhotoBgRectFromArea(null, { x: 0, y: 0 })).toBeNull();
    expect(B.plannerPhotoBgRectFromArea({ W: 0, D: 600 }, { x: 0, y: 0 })).toBeNull();
    expect(B.plannerPhotoBgRectFromArea({ W: 600, D: 'x' }, { x: 0, y: 0 })).toBeNull();
    // 원점을 안 줘도 0 으로 본다
    expect(B.plannerPhotoBgRectFromArea({ W: 600, D: 600, x: 100, y: 200 }, null).originMm)
      .toEqual({ x: 400, z: 500 });
  });
});

// ── 미세조정 ────────────────────────────────────────────

describe('미세조정은 사각형에 **반대로** 얹는다', () => {
  test('가구를 +x 로 밀면 사각형(=카메라)이 −x 로 간다', () => {
    const r = B.plannerPhotoBgSolveRect(RECT, { x: 120, z: -40, rotationDeg: 5 });
    expect(r.originMm.x).toBe(RECT.originMm.x - 120);
    expect(r.originMm.z).toBe(RECT.originMm.z + 40);
    expect(r.rotationDeg).toBe(-5);
    expect(r.w).toBe(RECT.w);
  });

  test('실제로 카메라가 그만큼 옮겨 풀린다 — 가구는 세계에 고정이니 사진에서 반대로 움직여 보인다', () => {
    const s = shoot(RECT);
    const base = P.plannerPhotoCamera(s.quad, RECT, IMG_W, IMG_H);
    const moved = P.plannerPhotoCamera(s.quad, B.plannerPhotoBgSolveRect(RECT, { x: 200, z: 0 }), IMG_W, IMG_H);
    expect(moved.position[0]).toBeCloseTo(base.position[0] - 200, 3);
    expect(moved.position[2]).toBeCloseTo(base.position[2], 3);
    expect(moved.position[1]).toBeCloseTo(base.position[1], 3);   // 눈높이는 그대로
  });

  test('조정이 없으면 원본 그대로', () => {
    expect(B.plannerPhotoBgSolveRect(RECT, null).originMm).toEqual(RECT.originMm);
    expect(B.plannerPhotoBgSolveRect(null, { x: 1 })).toBeNull();
  });
});

// ── 화각 자동 맞춤 ──────────────────────────────────────

describe('화각 자동 맞춤 (fitFov)', () => {
  test('알려진 화각을 되찾는다 — 45·60·75·95°', () => {
    for (const fov of [45, 60, 75, 95]) {
      const s = shoot(RECT, { fovHDeg: fov });
      const fit = B.plannerPhotoBgFitFov(s.quad, RECT, IMG_W, IMG_H);
      expect(fit).not.toBeNull();
      expect(fit.fovDeg).toBeCloseTo(fov, 0);
      expect(fit.reprojectionPx).toBeLessThan(1);
    }
  });

  test('P0 의 근거 그대로 — 틀린 화각은 재투영 오차가 크다 (그래서 훑기가 먹힌다)', () => {
    const s = shoot(RECT, { fovHDeg: 60 });
    const right = P.plannerPhotoCamera(s.quad, RECT, IMG_W, IMG_H, { fovDeg: 60 });
    const wrong = P.plannerPhotoCamera(s.quad, RECT, IMG_W, IMG_H, { fovDeg: 40 });
    expect(right.reprojectionPx).toBeLessThan(1);
    expect(wrong.reprojectionPx).toBeGreaterThan(right.reprojectionPx + 10);
  });

  test('찾은 화각의 카메라가 같이 온다 — 다시 풀 필요가 없다', () => {
    const s = shoot(RECT, { fovHDeg: 70 });
    const fit = B.plannerPhotoBgFitFov(s.quad, RECT, IMG_W, IMG_H);
    expect(fit.camera.kind).toBe('photo');
    expect(fit.camera.method).toBe('assumed');           // 화각을 고정해 풀었으니 'assumed'
    expect(fit.camera.fovDeg).toBeCloseTo(fit.fovDeg, 9);
    expect(fit.camera.position[1]).toBeCloseTo(1600, 0); // 시험이 세운 눈높이
  });

  test('못 푸는 사각형이면 null (던지지 않는다)', () => {
    expect(B.plannerPhotoBgFitFov([[0, 0], [0, 0], [0, 0], [0, 0]], RECT, IMG_W, IMG_H)).toBeNull();
    expect(B.plannerPhotoBgFitFov(null, RECT, IMG_W, IMG_H)).toBeNull();
  });
});

// ── 건강 상태 ───────────────────────────────────────────

describe('사각형 건강 상태 (quadHealth)', () => {
  test('정확히 맞춘 사각형 → 맞음, 재투영 오차가 한 자리', () => {
    const s = shoot(RECT);
    const h = B.plannerPhotoBgQuadHealth(s.quad, RECT, IMG_W, IMG_H);
    expect(h.level).toBe('good');
    expect(h.reprojectionPx).toBeLessThan(1);
    expect(h.reason).toContain('맞음');
    expect(h.camera).not.toBeNull();
    expect(h.shallow).toBe(false);
    expect(h.hint).toBeNull();
  });

  test('귀퉁이를 조금 밀면 → 대충 맞음, 많이 밀면 → 틀림', () => {
    const s = shoot(RECT);
    const nudge = (px) => {
      const q = s.quad.map((p) => [p[0], p[1]]);
      q[2] = [q[2][0] + px / IMG_W, q[2][1] + px / IMG_H];
      return B.plannerPhotoBgQuadHealth(q, RECT, IMG_W, IMG_H);
    };
    const rough = nudge(12);
    expect(rough.level).toBe('rough');
    expect(rough.reason).toContain('넓게');
    const bad = nudge(90);
    expect(bad.level).toBe('bad');
    expect(bad.reprojectionPx).toBeGreaterThan(rough.reprojectionPx);
  });

  test('얇은 띠는 등급과 별개로 **안내**가 붙는다 (P0 측정: 너른 사각형이 약 4배 정확)', () => {
    const thin = { w: 3600, d: 700, originMm: { x: 1000, z: 500 }, rotationDeg: 0 };
    const s = shoot(thin, { height: 1700 });
    const h = B.plannerPhotoBgQuadHealth(s.quad, thin, IMG_W, IMG_H);
    expect(h.shallow).toBe(true);
    expect(h.hint).toContain('너른 사각형');
    expect(h.level).toBe('good');        // 정확히 찍었으면 등급 자체는 맞음이다
  });

  test('기형 사각형은 photo-solve 의 이유를 그대로 전한다', () => {
    const concave = [[0.2, 0.5], [0.8, 0.5], [0.5, 0.6], [0.2, 0.9]];
    const h = B.plannerPhotoBgQuadHealth(concave, RECT, IMG_W, IMG_H);
    expect(h.level).toBe('bad');
    expect(h.reason).toContain('오목');
    expect(h.camera).toBeNull();
  });

  test('배치 공간을 안 골랐으면 그렇게 말한다', () => {
    const h = B.plannerPhotoBgQuadHealth(B.plannerPhotoBgQuadDefault(IMG_W, IMG_H), null, IMG_W, IMG_H);
    expect(h.level).toBe('bad');
    expect(h.reason).toContain('배치 공간');
  });

  describe('물리 검사 — 재투영 오차로는 못 잡는 것 (귀퉁이 순서)', () => {
    test('180° 어긋난 순서는 재투영 오차가 **0 인데도** 물리 검사가 잡는다', () => {
      const s = shoot(RECT);
      const rot = [s.quad[2], s.quad[3], s.quad[0], s.quad[1]];   // 대각선 반대에서 시작
      const cam = P.plannerPhotoCamera(rot, RECT, IMG_W, IMG_H);
      expect(cam.reprojectionPx).toBeLessThan(1);                 // 숫자로는 완벽해 보인다
      const h = B.plannerPhotoBgQuadHealth(rot, RECT, IMG_W, IMG_H);
      expect(h.level).toBe('bad');
      expect(h.reason).toContain('귀퉁이');
    });

    test('바닥 아래 카메라', () => {
      const cam = { position: [0, -100, 1000], dist: 1000 };
      expect(B.plannerPhotoBgCameraBehind(cam, RECT)).toBe(false);
      // 물리 검사 순서상 높이가 먼저 걸린다 — quadHealth 는 아래 두 시험이 경로 전체로 확인한다
      expect(B.PLANNER_PHOTO_BG_EYE_MIN_MM).toBe(300);
    });

    test('사각형 **뒤**(벽 쪽)에 선 카메라를 가른다', () => {
      // rect 는 rotation 0 · 원점 (1000, 500). 지역 +Z 가 앞(보는 사람 쪽)이다.
      expect(B.plannerPhotoBgCameraBehind({ position: [1000, 1600, 3000] }, RECT)).toBe(false);
      expect(B.plannerPhotoBgCameraBehind({ position: [1000, 1600, -2000] }, RECT)).toBe(true);
      // 90° 돌린 배치에서는 앞(지역 +Z)이 **−X** 쪽이다 — 3D 가 rotation.y = −90° 로 돌리기 때문이다
      // (renderAreas3D · plannerPhotoRectCorners 와 같은 규약). 이 부호를 틀리면 정상 사진을 틀렸다고 신고한다.
      const r90 = { w: 2400, d: 1500, originMm: { x: 0, z: 0 }, rotationDeg: 90 };
      expect(B.plannerPhotoBgCameraBehind({ position: [-3000, 1600, 0] }, r90)).toBe(false);
      expect(B.plannerPhotoBgCameraBehind({ position: [3000, 1600, 0] }, r90)).toBe(true);
    });

    test('눈높이가 말이 안 되면 틀림 — 4m 위·30cm 아래', () => {
      // 아주 먼 데서 좁은 화각으로 잡은 것처럼 화각을 강제하면 눈높이가 터진다
      const s = shoot(RECT, { height: 1600 });
      const tooHigh = B.plannerPhotoBgQuadHealth(s.quad, RECT, IMG_W, IMG_H, { fovDeg: 20 });
      const tooLow = B.plannerPhotoBgQuadHealth(s.quad, RECT, IMG_W, IMG_H, { fovDeg: 120 });
      const bads = [tooHigh, tooLow].filter((h) => h.level === 'bad');
      expect(bads.length).toBeGreaterThan(0);
      bads.forEach((h) => expect(h.reason).toMatch(/눈높이|밖으로|바닥 아래|재투영/));
    });

    test('30m 밖 카메라는 틀림', () => {
      expect(B.PLANNER_PHOTO_BG_DIST_MAX_MM).toBe(30000);
      const far = { w: 3600, d: 2400, originMm: { x: 0, z: 0 }, rotationDeg: 0 };
      const s = shoot(far, { dist: 35000, height: 1600, fovHDeg: 10 });
      const h = B.plannerPhotoBgQuadHealth(s.quad, far, IMG_W, IMG_H);
      expect(h.level).toBe('bad');
      expect(h.reason).toContain('m 밖');
    });
  });

  test('미세조정을 건네면 그 사각형으로 푼다', () => {
    const s = shoot(RECT);
    const plain = B.plannerPhotoBgQuadHealth(s.quad, RECT, IMG_W, IMG_H);
    const moved = B.plannerPhotoBgQuadHealth(s.quad, RECT, IMG_W, IMG_H, { nudge: { x: 300, z: 0 } });
    expect(moved.camera.position[0]).toBeCloseTo(plain.camera.position[0] - 300, 3);
    expect(moved.level).toBe('good');     // 미는 것은 정확도를 해치지 않는다
  });
});

// ── 상태 ────────────────────────────────────────────────

describe('상태 — 계획 §4.4 design_backgrounds 의 모양', () => {
  const PB = B.PlannerPhotoBg;
  const store = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      _dump: () => Object.fromEntries(map),
    };
  };
  let saved;
  beforeEach(() => {
    saved = global.localStorage;
    global.localStorage = store();
    PB.state = B.plannerPhotoBgDefaultState();
    PB.image = null;
    PB.onChange = null;
  });
  afterEach(() => { global.localStorage = saved; });

  test('기본 상태 — 바닥 고정, 사각형은 기본 사다리꼴, 화각은 아직 모른다', () => {
    const s = B.plannerPhotoBgDefaultState();
    expect(s.plane.kind).toBe('floor');
    expect(s.plane.areaId).toBeNull();
    expect(s.fovDeg).toBeNull();
    expect(s.nudge).toEqual({ x: 0, z: 0, rotationDeg: 0 });
    expect(s.quad).toEqual(B.plannerPhotoBgQuadDefault(0, 0));
    expect(s.locked).toBe(false);
  });

  test('localStorage 왕복 — 스코프 키로 저장하고 그대로 되읽는다', () => {
    const rect = { w: 3600, d: 700, originMm: { x: 120, z: -40 }, rotationDeg: 90, areaId: 'lower-a' };
    PB.patch({
      quad: [[0.1, 0.5], [0.9, 0.5], [0.95, 0.9], [0.05, 0.9]],
      plane: B.plannerPhotoBgPlaneFromRect(rect),
      fovDeg: 63.5,
      nudge: { x: 10, z: -20, rotationDeg: 2 },
      locked: true,
    });
    expect(PB.key()).toContain('dadam_photo_bg_v1');
    const raw = global.localStorage.getItem(PB.key());
    expect(raw).toBeTruthy();
    PB.state = B.plannerPhotoBgDefaultState();
    const back = PB.load();
    expect(back.quad[1]).toEqual([0.9, 0.5]);
    expect(back.fovDeg).toBe(63.5);
    expect(back.locked).toBe(true);
    expect(back.nudge).toEqual({ x: 10, z: -20, rotationDeg: 2 });
    expect(B.plannerPhotoBgRectFromPlane(back.plane)).toEqual({
      w: 3600, d: 700, originMm: { x: 120, z: -40 }, rotationDeg: 90, areaId: 'lower-a',
    });
  });

  test('깨진 저장본·나쁜 값은 기본값으로 떨어진다 (던지지 않는다)', () => {
    global.localStorage.setItem(PB.key(), '{ 이건 JSON 이 아니다');
    expect(PB.load().quad).toEqual(B.plannerPhotoBgQuadDefault(0, 0));
    expect(B.plannerPhotoBgNormalize({ quad: [[0, 0], [1, 'x'], [1, 1], [0, 1]] }).quad)
      .toEqual(B.plannerPhotoBgQuadDefault(0, 0));
    expect(B.plannerPhotoBgNormalize({ fovDeg: 999 }).fovDeg).toBeNull();
    expect(B.plannerPhotoBgNormalize(null).plane.kind).toBe('floor');
    // 정규 좌표는 0~1 로 자른다
    expect(B.plannerPhotoBgNormalize({ quad: [[-3, 0.5], [2, 0.5], [1, 1], [0, 1]] }).quad[0]).toEqual([0, 0.5]);
  });

  test('사진 자체는 저장하지 않는다 — 비공개 버킷은 P3 (계획 §4.5)', () => {
    PB.setImage({ url: 'blob:x', width: 100, height: 80, blob: {} });
    PB.patch({ fovDeg: 60 });
    expect(global.localStorage.getItem(PB.key())).not.toContain('blob:');
  });

  test('patch 는 저장하고 알린다 — "바뀌었는데 안 그려졌다" 가 생기지 않게', () => {
    const seen = [];
    PB.onChange = (s) => seen.push(s.fovDeg);
    PB.patch({ fovDeg: 70 });
    PB.resetQuad();
    expect(seen).toEqual([70, 70]);
    expect(PB.state.quad).toEqual(B.plannerPhotoBgQuadDefault(0, 0));
  });
});

// ── 파일 규약 ───────────────────────────────────────────

describe('모듈 규약', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/planner/photo-bg.js'), 'utf8');

  test('클래식 스크립트 — window 와 module.exports 둘 다', () => {
    expect(src).toContain('window.PlannerPhotoBg = PlannerPhotoBg;');
    expect(src).toContain("if (typeof module !== 'undefined' && module.exports)");
  });

  test('최상위 이름이 photo-solve 와 겹치지 않는다 (전역 렉시컬 스코프를 공유한다)', () => {
    const { topLevelDeclarations } = require('../test-utils/js-scan');
    const mine = topLevelDeclarations(src);
    for (const n of mine) expect(n).toMatch(/^(plannerPhotoBg|PLANNER_PHOTO_BG_|PlannerPhotoBg$)/);
    const solve = topLevelDeclarations(fs.readFileSync(path.join(__dirname, '..', 'js/planner/photo-solve.js'), 'utf8'));
    for (const n of mine) expect(solve.has(n)).toBe(false);
  });

  test('three 에 기대지 않는다 — 사진 준비는 3D 와 무관하다', () => {
    expect(src).not.toMatch(/\bTHREE\b/);
  });
});
