/**
 * P2: 사진 모드의 그림자 · 빛 · 톤 (계획 §5 P2 — `agent/photo-shadow-light`).
 *
 * **jsdom 에는 WebGL 이 없다 — 픽셀은 여기서 볼 수 없고, 보려 하지도 않는다** (계획 §7).
 * 그래서 이 파일이 보는 것은 딱 둘이다:
 *   ① **순수 셈** — 방위각·고도 → 조명 자리, 색온도 → 조명 색, 사진 표본 → 톤 제안.
 *      three 도 DOM 도 없이 정확한 값으로 못 박는다.
 *   ② **씬 그래프와 값 주머니** — 받개가 씬에 붙었는가, 그림자 카메라 숫자가 조여졌는가,
 *      나올 때 **전부** 되돌아왔는가. 그려진 그림이 아니라 **씬에 적힌 값**을 본다.
 *
 * 왜 이 파일이 따로 있는가: `photo-mode.test.js` 는 모드의 골격(레터박스·별도 카메라·사각형)을 지킨다.
 * 여기는 P2 가 더한 것 — 그림자 받개(G5 의 이름표)와 **조명 저장·복원(G6)** 만 본다.
 */
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const M = require('../js/planner/photo-mode');
const BG = require('../js/planner/photo-bg');
const CAP = require('../js/planner/planner-capture');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor, canonical } = require('../test-utils/planner-golden');

const ROOT = path.join(__dirname, '..');
const norm = (t) => t.split('\r\n').join('\n');
const HTML = norm(fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8'));
const DETAIL = norm(fs.readFileSync(path.join(ROOT, 'js/planner/planner-detail.js'), 'utf8'));

// ══════════════════════════════════════════════════════════
// ① 순수 셈
// ══════════════════════════════════════════════════════════

describe('빛 방향 — 방위각·고도가 반구 위의 한 점이다', () => {
  const C = [1000, 0, -500];

  test('방위 0° 는 +Z, 90° 는 +X — 고도 0° 는 지평선', () => {
    expect(M.plannerPhotoModeLightPos(0, 0, [0, 0, 0], 100)).toEqual([0, 0, 100]);
    const east = M.plannerPhotoModeLightPos(90, 0, [0, 0, 0], 100);
    expect(east[0]).toBeCloseTo(100, 9);
    expect(east[1]).toBeCloseTo(0, 9);
    expect(east[2]).toBeCloseTo(0, 9);
    const west = M.plannerPhotoModeLightPos(270, 0, [0, 0, 0], 100);
    expect(west[0]).toBeCloseTo(-100, 9);
    const back = M.plannerPhotoModeLightPos(180, 0, [0, 0, 0], 100);
    expect(back[2]).toBeCloseTo(-100, 9);
  });

  test('고도 90° 는 바로 위 — 방위와 무관하다', () => {
    [0, 45, 123, 300].forEach((a) => {
      const p = M.plannerPhotoModeLightPos(a, 90, [0, 0, 0], 2000);
      expect(p[0]).toBeCloseTo(0, 6);
      expect(p[1]).toBeCloseTo(2000, 9);
      expect(p[2]).toBeCloseTo(0, 6);
    });
  });

  test('중심을 옮기면 통째로 따라간다 · 반지름만큼 떨어져 있다', () => {
    const p = M.plannerPhotoModeLightPos(45, 48, C, 5000);
    expect(Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2])).toBeCloseTo(5000, 6);
    // 45°/48° = 페이지 init3D 의 주광 (5000, 8000, 5000) 과 같은 쪽 — 들어가도 그림자가 홱 돌지 않는다
    expect(p[0] - C[0]).toBeCloseTo(p[2] - C[2], 6);            // +X·+Z 사이
    expect(p[1]).toBeGreaterThan(0);
    const ref = Math.atan2(8000, Math.hypot(5000, 5000)) * 180 / Math.PI;   // 48.5°
    expect(Math.abs(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.elevationDeg.def - ref)).toBeLessThan(1);
    expect(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.azimuthDeg.def).toBe(45);
  });

  test('고도는 늘 바닥 위 — 기본 범위(5~85°)에서 y 가 양수다', () => {
    const lim = BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.elevationDeg;
    [lim.min, lim.def, lim.max].forEach((e) => {
      expect(M.plannerPhotoModeLightPos(37, e, [0, 0, 0], 3000)[1]).toBeGreaterThan(0);
    });
  });
});

describe('색온도 · 틴트 — 조명 색으로 얹는다 (후처리 합성기를 들이지 않는다)', () => {
  test('0 이면 흰색 그대로', () => {
    expect(M.plannerPhotoModeTintColor(0, 0)).toEqual({ r: 1, g: 1, b: 1 });
  });

  test('+ 는 따뜻하게(빨강 > 파랑) · − 는 차갑게', () => {
    const warm = M.plannerPhotoModeTintColor(100, 0);
    expect(warm.r).toBeGreaterThan(warm.b);
    const cool = M.plannerPhotoModeTintColor(-100, 0);
    expect(cool.b).toBeGreaterThan(cool.r);
    // 가장 큰 칸은 늘 1 — 밝기는 세기 슬라이더 하나만 맡는다
    [warm, cool].forEach((c) => expect(Math.max(c.r, c.g, c.b)).toBeCloseTo(1, 9));
  });

  test('틴트 + 는 자홍(초록을 내린다) · − 는 초록', () => {
    const mag = M.plannerPhotoModeTintColor(0, 100);
    expect(mag.g).toBeLessThan(mag.r);
    expect(mag.g).toBeLessThan(mag.b);
    const grn = M.plannerPhotoModeTintColor(0, -100);
    expect(grn.g).toBeGreaterThanOrEqual(grn.r);
  });

  test('범위 밖 값은 잘린다 — 색이 음수로 가지 않는다', () => {
    const c = M.plannerPhotoModeTintColor(9999, -9999);
    [c.r, c.g, c.b].forEach((v) => { expect(v).toBeGreaterThan(0); expect(v).toBeLessThanOrEqual(1); });
  });
});

describe('자동 제안 — 사진의 평균 밝기·색에서 노출·색온도를 **제안만** 한다', () => {
  // 합성 표본 둘. 진짜 사진을 읽는 길(plannerPhotoModeSamplePhoto)은 아래에서 따로 본다.
  const BRIGHT_WARM = { r: 0.82, g: 0.74, b: 0.58, luma: 0.75 };
  const DARK_COOL = { r: 0.14, g: 0.17, b: 0.24, luma: 0.17 };

  test('밝고 따뜻한 사진 → 노출 ↑ · 색온도 +', () => {
    const s = M.plannerPhotoModeSuggestGrade(BRIGHT_WARM);
    expect(s.exposure).toBeGreaterThan(1);
    expect(s.temperature).toBeGreaterThan(0);
  });

  test('어둡고 차가운 사진 → 노출 ↓ · 색온도 −', () => {
    const s = M.plannerPhotoModeSuggestGrade(DARK_COOL);
    expect(s.exposure).toBeLessThan(1);
    expect(s.temperature).toBeLessThan(0);
  });

  test('기준 밝기와 같으면 노출 1 근처 — 이유 없이 밀지 않는다', () => {
    const s = M.plannerPhotoModeSuggestGrade({ r: 0.45, g: 0.45, b: 0.45, luma: M.PLANNER_PHOTO_MODE_RENDER_LUMA });
    expect(s.exposure).toBeCloseTo(1, 1);
    expect(s.temperature).toBeCloseTo(0, 9);
    expect(s.tint).toBeCloseTo(0, 9);
  });

  test('제안은 늘 허용 범위 안이다 — 새카만 사진·새하얀 사진에서도', () => {
    const lim = BG.PLANNER_PHOTO_BG_GRADE_LIMITS;
    [{ r: 0, g: 0, b: 0, luma: 0 }, { r: 1, g: 1, b: 1, luma: 1 }, { r: 1, g: 0, b: 0, luma: 0.21 }].forEach((s) => {
      const g = M.plannerPhotoModeSuggestGrade(s);
      expect(g.exposure).toBeGreaterThanOrEqual(lim.exposure.min);
      expect(g.exposure).toBeLessThanOrEqual(lim.exposure.max);
      expect(Math.abs(g.temperature)).toBeLessThanOrEqual(100);
      expect(Math.abs(g.tint)).toBeLessThanOrEqual(100);
    });
  });

  test('luma 를 안 주면 RGB 에서 낸다 · 표본이 없으면 null', () => {
    expect(M.plannerPhotoModeSuggestGrade(null)).toBeNull();
    const s = M.plannerPhotoModeSuggestGrade({ r: 0.8, g: 0.8, b: 0.8 });
    expect(s.luma).toBeCloseTo(0.8, 2);
  });

  test('형광등처럼 초록이 뜬 사진은 자홍(−) 쪽으로 민다', () => {
    expect(M.plannerPhotoModeSuggestGrade({ r: 0.4, g: 0.55, b: 0.4, luma: 0.5 }).tint).toBeLessThan(0);
  });
});

describe('사진 읽기 — 못 읽으면 조용히 null (SecurityError 포함)', () => {
  test('크기가 없거나 캔버스가 없으면 null', () => {
    expect(M.plannerPhotoModeSamplePhoto(null, document)).toBeNull();
    expect(M.plannerPhotoModeSamplePhoto({ naturalWidth: 0, naturalHeight: 0 }, document)).toBeNull();
  });

  test('getImageData 가 SecurityError 를 던져도 던지지 않는다 — 패널이 살아 있어야 한다', () => {
    const doc = {
      createElement: () => ({
        getContext: () => ({
          drawImage() {},
          getImageData() { const e = new Error('Tainted canvases may not be exported.'); e.name = 'SecurityError'; throw e; },
        }),
      }),
    };
    expect(() => M.plannerPhotoModeSamplePhoto({ naturalWidth: 100, naturalHeight: 80 }, doc)).not.toThrow();
    expect(M.plannerPhotoModeSamplePhoto({ naturalWidth: 100, naturalHeight: 80 }, doc)).toBeNull();
  });

  test('화소를 읽으면 평균을 돌려준다 — 투명 화소는 세지 않는다', () => {
    const n = 32;                       // plannerPhotoModeSamplePhoto 가 줄이는 크기
    const px = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < px.length; i += 4) {
      const opaque = i < px.length / 2;
      px[i] = 255; px[i + 1] = 128; px[i + 2] = 0; px[i + 3] = opaque ? 255 : 0;
    }
    const doc = {
      createElement: () => ({
        getContext: () => ({ drawImage() {}, getImageData: () => ({ data: px }) }),
      }),
    };
    const s = M.plannerPhotoModeSamplePhoto({ naturalWidth: 100, naturalHeight: 80 }, doc);
    expect(s.r).toBeCloseTo(1, 6);
    expect(s.b).toBeCloseTo(0, 6);
    expect(s.luma).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════
// ② 상태 — 옛 저장본이 그대로 열린다
// ══════════════════════════════════════════════════════════

describe('상태 — light·grade 는 계획 §4.4 의 컬럼 모양 그대로', () => {
  test('기본 상태에 두 칸이 다 있다 (P3 가 이대로 행에 넣는다)', () => {
    const st = BG.plannerPhotoBgDefaultState();
    expect(Object.keys(st.light).sort())
      .toEqual(['ambient', 'azimuthDeg', 'elevationDeg', 'intensity', 'shadowOpacity', 'shadowSoftness']);
    expect(Object.keys(st.grade).sort()).toEqual(['exposure', 'temperature', 'tint']);
  });

  test('**P1 때 저장된 옛 상태**(light·grade 없음)도 그대로 열린다 — 빠진 칸은 기본값', () => {
    const old = { quad: [[0, 0], [1, 0], [1, 1], [0, 1]], fovDeg: 70, nudge: { x: 10, z: 20, rotationDeg: 3 }, locked: true };
    const st = BG.plannerPhotoBgNormalize(old);
    expect(st.fovDeg).toBe(70);                       // 옛 값은 살아 있고
    expect(st.nudge).toEqual({ x: 10, z: 20, rotationDeg: 3 });
    expect(st.locked).toBe(true);
    expect(st.light).toEqual(BG.plannerPhotoBgDefaultState().light);   // 새 칸은 기본값
    expect(st.grade).toEqual(BG.plannerPhotoBgDefaultState().grade);
  });

  test('반쯤만 든 묶음도 든 칸만 쓴다 — 나머지는 기본값', () => {
    const st = BG.plannerPhotoBgNormalize({ light: { azimuthDeg: 200 }, grade: { exposure: 1.4 } });
    expect(st.light.azimuthDeg).toBe(200);
    expect(st.light.elevationDeg).toBe(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.elevationDeg.def);
    expect(st.grade.exposure).toBe(1.4);
    expect(st.grade.temperature).toBe(0);
  });

  test('범위 밖은 잘리고, 방위각만 **감긴다** (다이얼을 계속 돌릴 수 있게)', () => {
    const st = BG.plannerPhotoBgNormalize({
      light: { azimuthDeg: 400, elevationDeg: 200, intensity: -5, shadowOpacity: 9 },
      grade: { exposure: 99, temperature: -999 },
    });
    expect(st.light.azimuthDeg).toBeCloseTo(40, 9);                   // 400 → 40
    expect(st.light.elevationDeg).toBe(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.elevationDeg.max);
    expect(st.light.intensity).toBe(0);
    expect(st.light.shadowOpacity).toBe(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.shadowOpacity.max);
    expect(st.grade.exposure).toBe(BG.PLANNER_PHOTO_BG_GRADE_LIMITS.exposure.max);
    expect(st.grade.temperature).toBe(-100);
  });

  test('숫자가 아닌 값은 기본값으로 떨어진다 (던지지 않는다)', () => {
    const st = BG.plannerPhotoBgNormalize({ light: 'nope', grade: { exposure: 'x', tint: NaN } });
    expect(st.light).toEqual(BG.plannerPhotoBgDefaultState().light);
    expect(st.grade.exposure).toBe(1);
    expect(st.grade.tint).toBe(0);
  });

  test('기본 세기는 **디테일 모드가 남긴 밝기** 다 — 들어가도 밝기가 튀지 않는다', () => {
    // init3D 의 1.8·0.6 을 planner-detail.applyScene 이 절반으로 낮춘다 (환경광이 채운다)
    expect(HTML).toContain('new THREE.DirectionalLight(0xffffff, 1.8)');
    expect(HTML).toContain('new THREE.AmbientLight(0xffffff, 0.6)');
    expect(DETAIL).toContain('L.intensity * 0.5');
    expect(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.intensity.def).toBeCloseTo(1.8 * 0.5, 9);
    expect(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.ambient.def).toBeCloseTo(0.6 * 0.5, 9);
  });
});

// ══════════════════════════════════════════════════════════
// ③ 씬 — 받개 · 조명 저장·복원
// ══════════════════════════════════════════════════════════

/** 값을 적기만 하는 renderer (photo-mode.test.js 와 같은 꼴). WebGL 이 없으니 이것이 전부다. */
function fakeRenderer() {
  return {
    capabilities: { maxTextureSize: 8192 },
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
    _vp: new THREE.Vector4(0, 0, 1200, 800),
    _sc: new THREE.Vector4(0, 0, 1200, 800),
    _scTest: false,
    getSize(v) { return v.set(1200, 800); },
    getViewport(v) { return v.copy(this._vp); },
    setViewport(x, y, w, h) { if (x && typeof x === 'object') this._vp.copy(x); else this._vp.set(x, y, w, h); },
    getScissor(v) { return v.copy(this._sc); },
    setScissor(x, y, w, h) { if (x && typeof x === 'object') this._sc.copy(x); else this._sc.set(x, y, w, h); },
    getScissorTest() { return this._scTest; },
    setScissorTest(on) { this._scTest = !!on; },
    render() {},
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    setRenderTarget() {},
    getRenderTarget() { return null; },
  };
}

function boot() {
  const seed = seedFor(FIXTURES.straight);
  let search = seed._search;
  delete seed._search;
  search += '&stage=detail';
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  p.PM = p.window.PlannerPhotoMode;
  p.PB = p.window.PlannerPhotoBg;
  p.PD = p.window.PlannerDetail;
  return p;
}

/** init3D 와 같은 모양의 씬 — 조명 셋, 바닥판·그리드, 가구 한 덩이 */
function fakeThree(p) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4efe7);
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  const d1 = new THREE.DirectionalLight(0xffffff, 1.8);
  d1.position.set(5000, 8000, 5000);
  d1.castShadow = true;
  d1.shadow.mapSize.set(1024, 1024);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.6);
  d2.position.set(-3000, 4000, -3000);
  scene.add(amb, d1, d2);
  const grid = new THREE.GridHelper(6000, 30);
  grid.userData = { entityKind: 'grid' };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial());
  ground.userData = { entityKind: 'ground' };
  scene.add(grid, ground);
  const moduleGroup = new THREE.Group();
  scene.add(moduleGroup);
  // 가구 한 덩이 — 3600 × 600 × 900 을 원점 앞쪽에
  const body = new THREE.Mesh(new THREE.BoxGeometry(3600, 900, 600), new THREE.MeshStandardMaterial());
  body.position.set(0, 450, 0);
  body.userData = { entityKind: 'carcass', moduleId: 'm1' };
  moduleGroup.add(body);
  const renderer = fakeRenderer();
  const camera = new THREE.PerspectiveCamera(45, 1.5, 10, 50000);
  camera.position.set(2000, 1200, 3000);
  const controls = { enabled: true, target: new THREE.Vector3(), update: jest.fn() };
  const t = { renderer, scene, camera, controls, moduleGroup };
  p.window.THREE = THREE;
  p.PM._o.three = () => t;
  return { t, renderer, scene, moduleGroup, body, ground, grid, camera, controls, amb, d1, d2 };
}

function withPhoto(p, w = 4032, h = 3024) {
  p.PB.setImage({ url: 'blob:test-photo', width: w, height: h, name: 'room.jpg', blob: {} });
  return p.PB.image;
}

/** 씬에서 받개를 찾는다 (없으면 null) */
function catcherIn(scene) {
  return (scene.children || []).find((c) => c && c.userData && c.userData.entityKind === M.PLANNER_PHOTO_MODE_CATCHER_KIND) || null;
}

/** 조명·렌더러의 **빛에 관한 모든 값**. 나온 뒤 이것과 대조하는 것이 G6 의 알맹이다. */
function lightSnapshot(f) {
  const one = (L) => ({
    intensity: L.intensity,
    color: L.color.getHex(),
    position: L.position.toArray(),
    castShadow: L.castShadow,
    targetPos: L.target ? L.target.position.toArray() : null,
    targetParent: L.target ? (L.target.parent ? L.target.parent.uuid : null) : null,
    mapSize: L.shadow ? [L.shadow.mapSize.x, L.shadow.mapSize.y] : null,
    radius: L.shadow ? L.shadow.radius : null,
    bias: L.shadow ? L.shadow.bias : null,
    normalBias: L.shadow ? L.shadow.normalBias : null,
    cam: L.shadow && L.shadow.camera
      ? [L.shadow.camera.left, L.shadow.camera.right, L.shadow.camera.top,
        L.shadow.camera.bottom, L.shadow.camera.near, L.shadow.camera.far] : null,
  });
  return {
    d1: one(f.d1),
    d2: one(f.d2),
    amb: one(f.amb),
    exposure: f.renderer.toneMappingExposure,
    shadowType: f.renderer.shadowMap.type,
    shadowEnabled: f.renderer.shadowMap.enabled,
    catcher: !!catcherIn(f.scene),
  };
}

describe('그림자 받개', () => {
  afterEach(() => { window.THREE = undefined; });

  test('들어가면 씬에 생기고 나가면 사라진다 — 이름표는 `shadow-catcher`', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    expect(catcherIn(f.scene)).toBeNull();
    p.PM.enter();
    const c = catcherIn(f.scene);
    expect(c).not.toBeNull();
    expect(c.userData.entityKind).toBe('shadow-catcher');
    expect(c.receiveShadow).toBe(true);
    expect(c.castShadow).toBe(false);
    expect(c.material.isShadowMaterial).toBe(true);
    expect(c.material.transparent).toBe(true);
    expect(c.position.y).toBe(0);                         // 바닥은 y = 0 (계획 §1.3)
    expect(c.rotation.x).toBeCloseTo(-Math.PI / 2, 9);    // XZ 평면으로 눕힌다
    p.PM.exit();
    expect(catcherIn(f.scene)).toBeNull();
    expect(p.PM._catcher).toBeNull();
  });

  test('가구 발자국을 덮고 여백이 붙는다 — 기울어진 빛의 긴 그림자를 받아야 한다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const c = catcherIn(f.scene);
    c.geometry.computeBoundingBox();
    const bb = c.geometry.boundingBox;
    // PlaneGeometry(w, d) 는 눕히기 전이라 로컬 x = 가로, y = 깊이다
    expect(bb.max.x - bb.min.x).toBeGreaterThan(3600);
    expect(bb.max.y - bb.min.y).toBeGreaterThan(600);
  });

  test('그림자 세기 슬라이더가 받개의 불투명도다 — 0 이면 아예 안 보인다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PB.patchLight({ shadowOpacity: 0.7 });
    expect(catcherIn(f.scene).material.opacity).toBeCloseTo(0.7, 9);
    expect(catcherIn(f.scene).visible).toBe(true);
    p.PB.patchLight({ shadowOpacity: 0 });
    expect(catcherIn(f.scene).visible).toBe(false);
  });

  test('**캡처 바운즈에서 빠진다** — 안 빼면 프레이밍이 통째로 어긋난다 (G5)', () => {
    expect(CAP.plannerCaptureBoundsOf).toBeInstanceOf(Function);
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1000, 1000, 1000), new THREE.MeshBasicMaterial());
    box.userData = { entityKind: 'carcass' };
    g.add(box);
    const before = CAP.plannerCaptureBoundsOf(g, THREE);
    // 가구보다 훨씬 넓은 받개를 더해도 경계가 **한 톨도** 안 움직여야 한다
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshBasicMaterial());
    catcher.rotation.x = -Math.PI / 2;
    catcher.userData = { entityKind: M.PLANNER_PHOTO_MODE_CATCHER_KIND };
    g.add(catcher);
    expect(CAP.plannerCaptureBoundsOf(g, THREE)).toEqual(before);
    // 이름표가 어긋나면 위 시험이 조용히 무의미해진다 — 문자열이 같은지 직접 본다
    const src = norm(fs.readFileSync(path.join(ROOT, 'js/planner/planner-capture.js'), 'utf8'));
    expect(src).toContain("'shadow-catcher': true");
  });

  test('디테일 모드가 **칠하지 않는다** — 받개에 자재 재질이 얹히면 그림자가 아니라 판이 된다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const c = catcherIn(f.scene);
    const mat = c.material;
    // ① 씬의 자식이라 moduleGroup 순회에는 애초에 안 걸린다
    expect(c.parent).toBe(f.scene);
    expect(f.moduleGroup.children.indexOf(c)).toBe(-1);
    // ② 설령 그룹 안에 있더라도 moduleId 가 없어 칠해지지 않는다
    f.moduleGroup.add(c);
    p.PD.paintScene(f.moduleGroup, { force: true });
    expect(c.material).toBe(mat);
    expect(c.userData._origMaterial).toBeUndefined();
    f.scene.add(c);
  });

  test('화면 클릭 레이캐스트에도 안 걸린다 — 빈 바닥을 눌렀는데 뭔가 잡히면 안 된다', () => {
    // 페이지는 moduleGroup 의 자식만 쏜다. 받개는 씬의 자식이라 목록 밖이다.
    expect(HTML).toContain('raycaster.intersectObjects(moduleGroup.children, true)');
  });
});

describe('빛 맞추기 — 씬에 실제로 얹힌다', () => {
  afterEach(() => { window.THREE = undefined; });

  test('방위각·고도가 주광을 반구 위로 옮긴다 (순수 셈과 **같은 값**)', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PB.patchLight({ azimuthDeg: 90, elevationDeg: 30 });
    const centre = [f.d1.target.position.x, 0, f.d1.target.position.z];
    const R = Math.hypot(f.d1.position.x - centre[0], f.d1.position.y, f.d1.position.z - centre[2]);
    expect(f.d1.position.toArray()).toEqual(M.plannerPhotoModeLightPos(90, 30, centre, R));
    // 방위 90° = +X 쪽
    expect(f.d1.position.x - centre[0]).toBeGreaterThan(0);
    expect(Math.abs(f.d1.position.z - centre[2])).toBeLessThan(1e-6);
  });

  test('타깃을 씬에 붙인다 — 안 붙이면 three 가 matrixWorld 를 갱신하지 않아 방향이 안 먹는다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    expect(f.d1.target.parent).toBeNull();
    p.PM.enter();
    expect(f.d1.target.parent).toBe(f.scene);
    p.PM.exit();
    expect(f.d1.target.parent).toBeNull();               // 씬에 고아를 남기지 않는다
  });

  test('세기·채움 슬라이더가 주광·주변광에 그대로 간다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PB.patchLight({ intensity: 2.5, ambient: 0.1 });
    expect(f.d1.intensity).toBeCloseTo(2.5, 9);
    expect(f.amb.intensity).toBeCloseTo(0.1, 9);
    expect(f.d2.intensity).toBeLessThan(f.d1.intensity);   // 채움 직사광은 주광보다 약하다
  });

  /**
   * **이 시험이 P2 에서 가장 중요하다.** three 의 `DirectionalLightShadow` 기본 프러스텀은
   * `OrthographicCamera(-5, 5, 5, -5, 0.5, 500)` 이고, 이 씬의 단위는 mm 다 — 10mm 짜리 상자.
   * 페이지는 `castShadow` 와 `shadowMap.enabled` 를 켜 두었지만 가구는 그 상자 밖에 있어
   * **지금껏 그림자가 아예 안 나왔다.** 사진 모드는 그 프러스텀을 가구에 맞춘다.
   */
  test('그림자 카메라를 가구에 맞춘다 — three 기본값(±5mm)에는 가구가 하나도 안 들어간다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    // 근거를 먼저 못 박는다: 페이지는 이 값을 건드리지 않으므로 three 의 기본값 그대로다
    expect(f.d1.shadow.camera.right).toBe(5);
    expect(f.d1.shadow.camera.far).toBe(500);
    expect(HTML).not.toContain('shadow.camera');
    const src = fs.readFileSync(path.join(ROOT, 'node_modules/three/src/lights/DirectionalLightShadow.js'), 'utf8');
    expect(src).toContain('OrthographicCamera( - 5, 5, 5, - 5, 0.5, 500 )');

    p.PM.enter();
    const half = f.d1.shadow.camera.right;
    expect(f.d1.shadow.camera.left).toBeCloseTo(-half, 9);
    expect(f.d1.shadow.camera.top).toBeCloseTo(half, 9);
    expect(f.d1.shadow.camera.bottom).toBeCloseTo(-half, 9);
    // 가구(3600 × 600 × 900)를 담고도 남아야 한다 — 안 그러면 그림자가 잘린다
    expect(half).toBeGreaterThan(3600 / 2);
    // 그런데 씬 전체(±8000 바닥판)를 겨누지는 않는다 — 텍셀을 낭비할 이유가 없다
    expect(half).toBeLessThan(8000);
    // 깊이도 빛 ↔ 가구 거리를 담는다
    expect(f.d1.shadow.camera.near).toBeGreaterThan(0);
    const dist = f.d1.position.distanceTo(f.d1.target.position);
    expect(f.d1.shadow.camera.near).toBeLessThan(dist);
    expect(f.d1.shadow.camera.far).toBeGreaterThan(dist);
    // 지도도 한 단계 키운다 (텍셀 = 프러스텀 폭 / mapSize)
    expect(f.d1.shadow.mapSize.x).toBe(M.PLANNER_PHOTO_MODE_SHADOW_MAP);
    expect(f.d1.shadow.mapSize.x).toBeGreaterThan(1024);
  });

  test('부드럽기는 `shadow.radius` 이고, 그러려면 그림자 지도가 **PCF** 여야 한다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    // radius 를 읽는 셰이더는 PCF·VSM 뿐이다 (WebGLProgram.js 의 shadowMapTypeDefines).
    // VSM 은 "모든 그림자 받개가 그림자를 드리운다" 라 받개 평면이 사진을 통째로 덮는다 — 쓰지 않는다.
    expect(f.renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(f.renderer.shadowMap.type).not.toBe(THREE.VSMShadowMap);
    p.PB.patchLight({ shadowSoftness: 6 });
    expect(f.d1.shadow.radius).toBe(6);
    p.PB.patchLight({ shadowSoftness: 0 });
    expect(f.d1.shadow.radius).toBe(0);
  });

  test('three r0.183 이 `PCFSoftShadowMap` 을 폐기했다 — 그래서 명시한다', () => {
    // 근거를 시험으로 박아 둔다. 판이 올라가 이 문장이 사라지면 여기서 먼저 걸린다.
    const src = fs.readFileSync(path.join(ROOT, 'node_modules/three/src/renderers/webgl/WebGLShadowMap.js'), 'utf8');
    expect(src).toContain('PCFSoftShadowMap has been deprecated');
    const prog = fs.readFileSync(path.join(ROOT, 'node_modules/three/src/renderers/webgl/WebGLProgram.js'), 'utf8');
    expect(prog).toContain('SHADOWMAP_TYPE_PCF');
    // 페이지는 아직 옛 상수를 쓴다 (다른 모드가 주인이다) — 사진 모드만 제 값으로 바꾸고 되돌린다
    expect(HTML).toContain('renderer.shadowMap.type = THREE.PCFSoftShadowMap');
  });

  test('톤 — 노출은 렌더러, 색온도는 조명 **색**', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PB.patchGrade({ exposure: 1.6, temperature: 80 });
    expect(f.renderer.toneMappingExposure).toBeCloseTo(1.6, 9);
    expect(f.d1.color.r).toBeGreaterThan(f.d1.color.b);
    p.PB.patchGrade({ temperature: -80 });
    expect(f.d1.color.b).toBeGreaterThan(f.d1.color.r);
    expect(f.amb.color.b).toBeGreaterThan(f.amb.color.r);   // 주변광도 같이 간다
  });
});

describe('나가면 빛도 **전부** 되돌아온다 (G6 · I2)', () => {
  afterEach(() => { window.THREE = undefined; });

  test('들어가기 전 조명 스냅샷과 나온 뒤가 같다 — 정말 바뀌었다가 돌아온다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = lightSnapshot(f);
    p.PM.enter();
    p.PB.patchLight({ azimuthDeg: 210, elevationDeg: 20, intensity: 3, ambient: 1.2, shadowSoftness: 7 });
    p.PB.patchGrade({ exposure: 2.2, temperature: 90, tint: -60 });
    p.PM.renderFrame(f.t);
    const during = lightSnapshot(f);
    // ① 정말 바뀌었는가 (안 바뀌면 복원 시험이 거짓말이 된다)
    expect(during).not.toEqual(before);
    expect(during.d1.position).not.toEqual(before.d1.position);
    expect(during.d1.mapSize).not.toEqual(before.d1.mapSize);
    expect(during.d1.cam).not.toEqual(before.d1.cam);
    expect(during.d1.color).not.toEqual(before.d1.color);
    expect(during.exposure).not.toEqual(before.exposure);
    expect(during.shadowType).not.toEqual(before.shadowType);
    expect(during.catcher).toBe(true);
    // ② 나오면 한 톨도 남지 않는다
    expect(p.PM.exit()).toBe(true);
    expect(lightSnapshot(f)).toEqual(before);
    expect(p.PM._savedLight).toBeNull();
  });

  test('두 번 들락거려도 같다 · 디테일 모드를 나가도 같다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = lightSnapshot(f);
    for (let i = 0; i < 3; i++) {
      p.PM.enter();
      p.PB.patchLight({ azimuthDeg: 10 + i * 60 });
      p.PM.renderFrame(f.t);
      p.PM.exit();
    }
    expect(lightSnapshot(f)).toEqual(before);
    p.PM.enter();
    p.PD.exit();                       // 디테일 모드가 사진 모드를 **먼저** 내보낸다
    expect(p.PM.isActive()).toBe(false);
    expect(lightSnapshot(f)).toEqual(before);
  });

  test('`planner-detail.js` 의 저장 목록은 넓히지 않았다 — 세기뿐이다 (다른 도메인의 규율)', () => {
    const at = DETAIL.indexOf('  applyScene(on) {');
    const body = DETAIL.slice(at, at + 1600);
    expect(body).toContain('saved.lights.push({ light: ch, intensity: ch.intensity })');
    // 위치·그림자·색을 적는 줄이 그 파일에 **없어야** 한다 (있으면 소유권이 흐려진 것이다)
    expect(body).not.toMatch(/saved\.lights\.push\([^)]*position/);
    expect(body).not.toMatch(/saved\.lights\.push\([^)]*shadow/);
    // 대신 사진 모드가 제 몫을 적는다
    const MODE = norm(fs.readFileSync(path.join(ROOT, 'js/planner/photo-mode.js'), 'utf8'));
    expect(MODE).toContain('_savedLight');
    expect(MODE).toContain('G6');
  });

  test('골든 페이로드는 빛을 만져도 바이트 동일 (I1) — 모듈 mesh 를 안 건드리기 때문', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = canonical(p.g('buildPlannerPayload')('PLANNER_STATE'));
    const kids = f.moduleGroup.children.length;
    p.PM.enter();
    p.PB.patchLight({ azimuthDeg: 120, shadowOpacity: 0.8 });
    p.PB.patchGrade({ exposure: 2 });
    p.PM.renderFrame(f.t);
    expect(f.moduleGroup.children.length).toBe(kids);
    p.PM.exit();
    expect(canonical(p.g('buildPlannerPayload')('PLANNER_STATE'))).toBe(before);
  });
});

describe('도어 테두리는 사진 모드에서 꺼져 있다 (G7)', () => {
  test('사진 모드가 그리면 `keepDoorEdgesVisible` 로 가지 않는다 — animate 가 먼저 돌아선다', () => {
    const at = HTML.indexOf('function animate()');
    const body = HTML.slice(at, at + 600);
    const early = body.indexOf('if (photo && PlannerPhotoMode.renderFrame(three)) return;');
    expect(early).toBeGreaterThan(-1);
    expect(early).toBeLessThan(body.indexOf('keepDoorEdgesVisible()'));
  });

  test('테두리 막대 자체도 숨는다 — 씬에 남아 있으면 검은 선이 그대로 보인다', () => {
    const MODE = norm(fs.readFileSync(path.join(ROOT, 'js/planner/photo-mode.js'), 'utf8'));
    expect(MODE).toContain("kind === 'doorEdge'");
    // 실제로 숨는지는 photo-mode.test.js 의 '바닥판·그리드·원점 마커·도어 테두리를 숨긴다' 가 본다
  });
});

describe('자동 제안은 **누르기 전에는** 아무것도 바꾸지 않는다', () => {
  afterEach(() => { window.THREE = undefined; });

  test('사진을 읽어 제안을 적어 두되 톤은 그대로 · 버튼을 누르면 들어간다', () => {
    const p = boot();
    const f = fakeThree(p);
    // 밝고 따뜻한 사진인 척 (jsdom 캔버스에는 진짜 픽셀이 없다 — 표본만 갈아 끼운다)
    p.PM._sample = () => ({ r: 0.85, g: 0.76, b: 0.58, luma: 0.77 });
    withPhoto(p);
    const before = Object.assign({}, p.PB.state.grade);
    p.PM.enter();
    // ① 제안은 생겼다
    expect(p.PM.proposal).not.toBeNull();
    expect(p.PM.proposal.exposure).toBeGreaterThan(1);
    expect(p.PM.proposal.temperature).toBeGreaterThan(0);
    // ② 그런데 상태도 씬도 안 바뀌었다
    expect(p.PB.state.grade).toEqual(before);
    expect(f.renderer.toneMappingExposure).toBeCloseTo(before.exposure, 9);
    // ③ 패널에 버튼이 서 있다
    const btn = p.document.querySelector('[data-photo="suggest"]');
    expect(btn).not.toBeNull();
    expect(p.document.getElementById('photoBgBody').textContent).toContain('제안합니다');
    // ④ 누르면 그제서야 들어간다
    btn.onclick();
    expect(p.PB.state.grade.exposure).toBe(p.PM.proposal.exposure);
    expect(p.PB.state.grade.temperature).toBe(p.PM.proposal.temperature);
    expect(f.renderer.toneMappingExposure).toBeCloseTo(p.PM.proposal.exposure, 9);
    delete p.PM._sample;
  });

  test('사진을 못 읽으면 제안도 버튼도 없다 — 조용히 넘어간다', () => {
    const p = boot();
    fakeThree(p);
    p.PM._sample = () => null;
    withPhoto(p);
    p.PM.enter();
    expect(p.PM.proposal).toBeNull();
    expect(p.document.querySelector('[data-photo="suggest"]')).toBeNull();
    expect(p.PM.applyProposal()).toBeNull();
    delete p.PM._sample;
  });
});

describe('패널 — 그림자·빛 묶음', () => {
  afterEach(() => { window.THREE = undefined; });

  test('슬라이더 아홉 칸이 상태의 칸 이름과 **글자 그대로** 짝이다', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const names = Array.from(p.document.querySelectorAll('[data-look]')).map((el) => el.getAttribute('data-look'));
    expect(names.sort()).toEqual([
      'grade:exposure', 'grade:temperature', 'grade:tint',
      'light:ambient', 'light:azimuthDeg', 'light:elevationDeg',
      'light:intensity', 'light:shadowOpacity', 'light:shadowSoftness',
    ]);
    // 슬라이더 범위가 한계표와 같다 — 두 군데 적히면 언젠가 어긋난다
    const el = p.document.querySelector('[data-look="light:elevationDeg"]');
    expect(Number(el.min)).toBe(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.elevationDeg.min);
    expect(Number(el.max)).toBe(BG.PLANNER_PHOTO_BG_LIGHT_LIMITS.elevationDeg.max);
  });

  test('슬라이더를 움직이면 상태·씬이 따라오고 이름표 글자가 바뀐다 (패널은 안 다시 그린다)', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const el = p.document.querySelector('[data-look="light:azimuthDeg"]');
    const label = el.parentElement.querySelector('label');
    const before = f.d1.position.toArray();
    el.value = '200';
    el.oninput();
    expect(p.PB.state.light.azimuthDeg).toBe(200);
    expect(f.d1.position.toArray()).not.toEqual(before);
    expect(label.textContent).toContain('200');
    // 끄는 동안 패널을 다시 그리지 않았으므로 **같은 원소**가 그대로 있다
    expect(p.document.querySelector('[data-look="light:azimuthDeg"]')).toBe(el);
  });

  test('「빛 되돌리기」는 두 묶음을 기본값으로', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PB.patchLight({ azimuthDeg: 300, intensity: 3.2 });
    p.PB.patchGrade({ exposure: 2.4 });
    p.document.querySelector('[data-photo="resetlook"]').onclick();
    const def = BG.plannerPhotoBgDefaultState();
    expect(p.PB.state.light).toEqual(def.light);
    expect(p.PB.state.grade).toEqual(def.grade);
  });

  test('저장·복원 — 새로고침해도 빛 값이 남는다 (사진만 다시 올리면 된다)', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PB.patchLight({ azimuthDeg: 137, shadowOpacity: 0.62 });
    p.PB.patchGrade({ tint: 25 });
    const raw = p.window.localStorage.getItem(p.PB.key());
    expect(raw).toBeTruthy();
    const back = BG.plannerPhotoBgNormalize(JSON.parse(raw));
    expect(back.light.azimuthDeg).toBe(137);
    expect(back.light.shadowOpacity).toBeCloseTo(0.62, 9);
    expect(back.grade.tint).toBe(25);
  });
});

describe('모듈 규약', () => {
  const src = norm(fs.readFileSync(path.join(ROOT, 'js/planner/photo-mode.js'), 'utf8'));
  const bgSrc = norm(fs.readFileSync(path.join(ROOT, 'js/planner/photo-bg.js'), 'utf8'));

  test('P2 가 더한 최상위 이름도 접두 규약을 지킨다', () => {
    const { topLevelDeclarations } = require('../test-utils/js-scan');
    for (const n of topLevelDeclarations(src)) {
      expect(n).toMatch(/^(plannerPhotoMode|PLANNER_PHOTO_MODE_|PlannerPhotoMode$)/);
    }
    for (const n of topLevelDeclarations(bgSrc)) {
      expect(n).toMatch(/^(plannerPhotoBg|PLANNER_PHOTO_BG_|PlannerPhotoBg$)/);
    }
  });

  test('photo-mode 가 쓰는 photo-bg 의 새 이름이 window 로 건너간다 (하네스는 맨이름을 안 준다)', () => {
    expect(bgSrc).toContain('window.PLANNER_PHOTO_BG_LIGHT_LIMITS = PLANNER_PHOTO_BG_LIGHT_LIMITS;');
    expect(bgSrc).toContain('window.PLANNER_PHOTO_BG_GRADE_LIMITS = PLANNER_PHOTO_BG_GRADE_LIMITS;');
  });
});
