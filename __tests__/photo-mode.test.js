/**
 * P1: 사진 모드 (js/planner/photo-mode.js + mockup-structure.html 배선).
 *
 * **jsdom 에는 WebGL 이 없다 — 픽셀은 여기서 볼 수 없고, 보려 하지도 않는다** (계획 §7).
 * 대신 `planner-capture.test.js` 가 세운 방식을 그대로 쓴다: 페이지를 진짜로 부팅하고(bootPlanner),
 * three 는 CJS 빌드로, renderer 만 **값을 적는 주머니**로 갈아 끼워 호출 순서와 상태를 본다.
 *
 *   · 들어가면 — scene.background 가 null, 바닥판·그리드·원점 마커·도어 테두리가 숨고, 궤도가 꺼지고,
 *     **화면 카메라가 아닌 별도 카메라**로 레터박스 안에만 그린다
 *   · 나오면 — 위의 **전부**가 들어가기 전 값으로 (스냅샷 대조. 이것이 I2 의 알맹이다)
 *     P2 부터는 조명(위치·타깃·색·세기·그림자 설정)·노출·그림자 지도 종류·받개까지 그 스냅샷에 든다.
 *     그림자·빛·톤 자체의 시험은 `photo-light.test.js` 가 맡는다.
 *   · 사각형 편집기 — 이름표 붙은 네 귀퉁이, 끌면 즉시 다시 풀리고 상태 한 줄이 바뀐다
 *   · 골든 페이로드(buildPlannerPayload)는 사진 모드를 거쳐도 바이트 동일 (I1)
 *   · 레터박스 셈 (순수)
 */
const fs = require('fs');
const path = require('path');
const THREE = require('three');
const M = require('../js/planner/photo-mode');
const BG = require('../js/planner/photo-bg');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor, canonical } = require('../test-utils/planner-golden');

const ROOT = path.join(__dirname, '..');
const norm = (t) => t.split('\r\n').join('\n');
const HTML = norm(fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8'));
const DETAIL = norm(fs.readFileSync(path.join(ROOT, 'js/planner/planner-detail.js'), 'utf8'));

// ── 레터박스 (순수) ──────────────────────────────────────

describe('레터박스 — 사진과 렌더와 편집기가 **같은 사각형**을 쓴다', () => {
  test('넓은 사진은 가로가 꽉 차고 위아래가 남는다', () => {
    const b = M.plannerPhotoModeBox(1200, 800, 16 / 9);
    expect(b.width).toBe(1200);
    expect(b.height).toBeCloseTo(675, 6);
    expect(b.x).toBe(0);
    expect(b.y).toBeCloseTo(62.5, 6);
  });

  test('세로 사진은 세로가 꽉 차고 좌우가 남는다', () => {
    const b = M.plannerPhotoModeBox(1200, 800, 9 / 16);
    expect(b.height).toBe(800);
    expect(b.width).toBeCloseTo(450, 6);
    expect(b.y).toBe(0);
    expect(b.x).toBeCloseTo(375, 6);
  });

  test('종횡비가 같으면 꽉 찬다 · 나쁜 값은 캔버스 종횡비로 떨어진다', () => {
    expect(M.plannerPhotoModeBox(1200, 800, 1.5)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    expect(M.plannerPhotoModeBox(1200, 800, 0)).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
    expect(M.plannerPhotoModeBox(0, 0, 1.5).width).toBeGreaterThan(0);
  });

  test('three 뷰포트는 y 를 아래에서 센다', () => {
    const b = M.plannerPhotoModeBox(1200, 800, 16 / 9);
    const v = M.plannerPhotoModeViewport(b, 800);
    expect(v.y).toBeCloseTo(62.5, 6);          // 위아래가 같으니 같은 값이다
    expect(v.width).toBe(1200);
    const b2 = M.plannerPhotoModeBox(1200, 800, 3);   // 더 납작 → 위쪽 여백이 크다
    expect(M.plannerPhotoModeViewport(b2, 800).y).toBeCloseTo(b2.y, 6);
  });

  test('정규 좌표 ↔ 상자 픽셀 왕복', () => {
    const b = M.plannerPhotoModeBox(1200, 800, 16 / 9);
    const px = M.plannerPhotoModeToBox([0.25, 0.75], b);
    expect(M.plannerPhotoModeFromBox(px[0], px[1], b)[0]).toBeCloseTo(0.25, 9);
    expect(M.plannerPhotoModeFromBox(px[0], px[1], b)[1]).toBeCloseTo(0.75, 9);
    // 상자 밖은 0~1 로 자른다 — 사각형은 사진 안에 있어야 한다 (photo-solve 가 거절한다)
    expect(M.plannerPhotoModeFromBox(-500, -500, b)).toEqual([0, 0]);
    expect(M.plannerPhotoModeFromBox(99999, 99999, b)).toEqual([1, 1]);
  });
});

// ── 페이지 부팅 + 값 주머니 renderer ───────────────────────

/** 캡처 시험과 같은 꼴 — 부른 것을 적기만 한다. 실제로 그리지 않는다 (WebGL 이 없다). */
function fakeRenderer() {
  const calls = [];
  return {
    calls,
    capabilities: { maxTextureSize: 8192 },
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    _vp: new THREE.Vector4(0, 0, 1200, 800),
    _sc: new THREE.Vector4(0, 0, 1200, 800),
    _scTest: false,
    getSize(v) { return v.set(1200, 800); },
    getViewport(v) { return v.copy(this._vp); },
    setViewport(x, y, w, h) {
      if (x && typeof x === 'object') this._vp.copy(x); else this._vp.set(x, y, w, h);
      calls.push(['viewport', this._vp.x, this._vp.y, this._vp.z, this._vp.w]);
    },
    getScissor(v) { return v.copy(this._sc); },
    setScissor(x, y, w, h) {
      if (x && typeof x === 'object') this._sc.copy(x); else this._sc.set(x, y, w, h);
      calls.push(['scissor', this._sc.x, this._sc.y, this._sc.z, this._sc.w]);
    },
    getScissorTest() { return this._scTest; },
    setScissorTest(on) { this._scTest = !!on; calls.push(['scissorTest', !!on]); },
    // P2: 페이지의 init3D 와 같은 값으로 시작한다 — 사진 모드가 이것도 되돌려야 한다
    shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
    render(scene, cam) { calls.push(['render', cam, cam.fov, cam.aspect]); },
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    setRenderTarget() {},
    getRenderTarget() { return null; },
  };
}

function boot(opt = {}) {
  const seed = Object.assign({}, seedFor(FIXTURES.straight), opt.storage || {});
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

/**
 * init3D 가 만든 것과 같은 모양의 씬 — 조명·바닥판·그리드·모듈·원점 마커·도어 테두리.
 * 실제 init3D 는 WebGL 이 필요해 jsdom 에서 건너뛴다. **이름표(entityKind)는 페이지와 같은 값을 쓴다** —
 * 그 값이 어긋나면 사진 모드가 아무것도 못 숨긴다.
 */
function fakeThree(p) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4efe7);
  // 조명도 init3D 와 같은 모양으로 — P2 가 위치·색·그림자까지 바꾸므로 시험에도 있어야 한다
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(amb);
  const d1 = new THREE.DirectionalLight(0xffffff, 1.8);
  d1.position.set(5000, 8000, 5000);
  d1.castShadow = true;
  d1.shadow.mapSize.set(1024, 1024);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.6);
  d2.position.set(-3000, 4000, -3000);
  scene.add(d2);
  const grid = new THREE.GridHelper(6000, 30);
  grid.userData = { entityKind: 'grid' };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial());
  ground.userData = { entityKind: 'ground' };
  scene.add(grid, ground);
  const moduleGroup = new THREE.Group();
  scene.add(moduleGroup);
  const door = new THREE.Mesh(new THREE.BoxGeometry(600, 720, 18), new THREE.MeshStandardMaterial());
  door.userData = { entityKind: 'carcass', side: 'front', areaType: 'door' };
  moduleGroup.add(door);
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  edge.userData = { entityKind: 'doorEdge', axis: 'left', baseW: 600, baseH: 720, cx: 0, cy: 360, z: 10 };
  moduleGroup.add(edge);
  const origin = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  origin.userData = { entityKind: 'origin' };
  moduleGroup.add(origin);
  const renderer = fakeRenderer();
  const camera = new THREE.PerspectiveCamera(45, 1.5, 10, 50000);
  camera.position.set(2000, 1200, 3000);
  const controls = { enabled: true, target: new THREE.Vector3(), update: jest.fn() };
  const t = { renderer, scene, camera, controls, moduleGroup };
  p.window.THREE = THREE;
  p.PM._o.three = () => t;
  return { t, renderer, scene, moduleGroup, grid, ground, door, edge, origin, camera, controls, amb, d1, d2 };
}

/** 사진을 올린 것처럼 — 실제 디코딩·캔버스 없이 크기만 준다 */
function withPhoto(p, w = 4032, h = 3024) {
  p.PB.setImage({ url: 'blob:test-photo', width: w, height: h, name: 'room.jpg', blob: {} });
  return p.PB.image;
}

/** 들어가기 전 값을 통째로 적는다 — 나온 뒤와 이것을 대조하는 것이 이 파일의 핵심이다 */
function snapshot(f) {
  return {
    background: f.scene.background,
    controls: f.controls.enabled,
    grid: f.grid.visible,
    ground: f.ground.visible,
    origin: f.origin.visible,
    edge: f.edge.visible,
    door: f.door.visible,
    scissorTest: f.renderer.getScissorTest(),
    viewport: f.renderer.getViewport(new THREE.Vector4()).toArray(),
    cameraFov: f.camera.fov,
    cameraPos: f.camera.position.toArray(),
    cameraAspect: f.camera.aspect,
    // ── P2 (G6): 조명·그림자·톤. `planner-detail.js` 는 **세기만** 적으므로 사진 모드가
    //    직접 적고 되돌린다. 하나라도 빠지면 구조 모드가 사진 모드의 빛을 물려받는다.
    exposure: f.renderer.toneMappingExposure,
    shadowEnabled: f.renderer.shadowMap.enabled,
    shadowType: f.renderer.shadowMap.type,
    lights: [f.d1, f.d2, f.amb].map((L) => ({
      intensity: L.intensity,
      color: L.color.getHex(),
      position: L.position.toArray(),
      castShadow: L.castShadow,
      targetPos: L.target ? L.target.position.toArray() : null,
      targetParent: L.target ? (L.target.parent ? L.target.parent.uuid : null) : null,
      mapSize: L.shadow ? [L.shadow.mapSize.x, L.shadow.mapSize.y] : null,
      radius: L.shadow ? L.shadow.radius : null,
      bias: L.shadow ? L.shadow.bias : null,
      cam: L.shadow && L.shadow.camera
        ? [L.shadow.camera.left, L.shadow.camera.right, L.shadow.camera.top,
          L.shadow.camera.bottom, L.shadow.camera.near, L.shadow.camera.far]
        : null,
    })),
    // 받개는 사진 모드에 있는 동안만 씬에 있다
    catchers: f.scene.children.filter((c) => c.userData && c.userData.entityKind === 'shadow-catcher').length,
  };
}

describe('사진 모드 — 들어가기', () => {
  afterEach(() => { window.THREE = undefined; });

  test('scene.background 가 null 이 된다 — 알파 버퍼로 사진이 비친다 (G1)', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    expect(f.scene.background).not.toBeNull();
    expect(p.PM.enter()).toBe(true);
    expect(f.scene.background).toBeNull();
    expect(p.PM.isActive()).toBe(true);
  });

  test('바닥판·그리드·원점 마커·도어 테두리를 숨긴다 — 부재(도어)는 그대로 보인다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    expect(f.ground.visible).toBe(false);
    expect(f.grid.visible).toBe(false);
    expect(f.origin.visible).toBe(false);
    expect(f.edge.visible).toBe(false);         // G7: 사진 위의 검은 테두리는 만화처럼 읽힌다
    expect(f.door.visible).toBe(true);
  });

  test('궤도·줌을 끈다 — 카메라는 사진의 것이지 사용자의 것이 아니다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    expect(f.controls.enabled).toBe(false);
  });

  test('renderAll3D 가 씬을 다시 만들어도 다시 숨긴다 (매 프레임 확인)', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    // 새 도어 테두리가 생긴 것처럼
    const fresh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    fresh.userData = { entityKind: 'doorEdge' };
    f.moduleGroup.add(fresh);
    expect(fresh.visible).toBe(true);
    p.PM.renderFrame(f.t);
    expect(fresh.visible).toBe(false);
    p.PM.exit();
    expect(fresh.visible).toBe(true);           // 나중에 생긴 것도 되돌린다
  });
});

describe('사진 모드 — 별도 카메라로 레터박스 안에만 그린다', () => {
  afterEach(() => { window.THREE = undefined; });

  test('화면 카메라(OrbitControls 의 것)를 쓰지 않는다 — 건드리지도 않는다 (G3·G4)', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = snapshot(f);
    p.PM.enter();
    expect(p.PM.frame).not.toBeNull();
    expect(p.PM.renderFrame(f.t)).toBe(true);
    const drew = f.renderer.calls.filter((c) => c[0] === 'render');
    expect(drew).toHaveLength(1);
    expect(drew[0][1]).not.toBe(f.camera);                 // **별도** 카메라
    expect(drew[0][1].isPerspectiveCamera).toBe(true);
    expect(drew[0][2]).toBeCloseTo(p.PM.frame.fov, 9);     // 푼 세로 화각 그대로
    // 화면 카메라는 한 톨도 안 바뀌었다
    expect(f.camera.fov).toBe(before.cameraFov);
    expect(f.camera.aspect).toBe(before.cameraAspect);
    expect(f.camera.position.toArray()).toEqual(before.cameraPos);
    expect(f.controls.update).not.toHaveBeenCalled();
  });

  test('뷰포트·잘라내기가 사진 종횡비의 상자다 — 사진·렌더·편집기가 같은 사각형', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p, 4032, 3024);                               // 4:3
    p.PM.enter();
    p.PM.renderFrame(f.t);
    const vp = f.renderer.calls.filter((c) => c[0] === 'viewport').pop();
    const box = M.plannerPhotoModeBox(1200, 800, 4032 / 3024);
    expect(vp.slice(1)).toEqual([box.x, 800 - box.y - box.height, box.width, box.height]);
    expect(f.renderer.getScissorTest()).toBe(true);
    // 그린 카메라의 종횡비 = 상자의 종횡비 (늘어나면 원근이 통째로 어긋난다)
    const drew = f.renderer.calls.filter((c) => c[0] === 'render').pop();
    expect(drew[3]).toBeCloseTo(box.width / box.height, 6);
    // 사진 레이어와 편집기도 같은 자리
    const img = p.document.getElementById('photoBgLayer');
    const svg = p.document.getElementById('photoQuadEditor');
    expect(img.style.width).toBe(Math.round(box.width * 100) / 100 + 'px');
    expect(svg.style.width).toBe(img.style.width);
    expect(svg.style.top).toBe(img.style.top);
    expect(img.getAttribute('src')).toBe('blob:test-photo');
  });

  test('사진 레이어는 캔버스보다 **앞에** 놓인다 (DOM 순서 = 뒤에 깔린다)', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const wrap = p.document.getElementById('canvasWrap');
    const kids = Array.from(wrap.children);
    expect(kids.indexOf(p.document.getElementById('photoBgLayer')))
      .toBeLessThan(kids.indexOf(p.document.getElementById('canvas3d')));
    // 편집기는 맨 뒤 = 맨 위
    expect(kids[kids.length - 1].id).toBe('photoQuadEditor');
  });

  test('아직 못 푼 프레임에서는 false — 페이지가 평소대로 그린다', () => {
    const p = boot();
    const f = fakeThree(p);
    p.PM.enter();                       // 사진 없이
    expect(p.PM.frame).toBeNull();
    expect(p.PM.renderFrame(f.t)).toBe(false);
    expect(f.renderer.calls.filter((c) => c[0] === 'render')).toHaveLength(0);
    expect(f.renderer.getScissorTest()).toBe(false);
  });

  test('HTML 의 animate 가 사진 모드를 먼저 본다', () => {
    const at = HTML.indexOf('function animate()');
    expect(at).toBeGreaterThan(-1);
    const body = HTML.slice(at, at + 600);
    expect(body).toContain('PlannerPhotoMode.renderFrame(three)');
    // 사진 모드가 그렸으면 controls.update·keepDoorEdgesVisible 로 가지 않는다
    expect(body.indexOf('PlannerPhotoMode.renderFrame')).toBeLessThan(body.indexOf('keepDoorEdgesVisible()'));
  });
});

describe('사진 모드 — 나가면 **전부** 되돌아온다 (I2)', () => {
  afterEach(() => { window.THREE = undefined; });

  test('들어가기 전 스냅샷과 나온 뒤가 같다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = snapshot(f);
    p.PM.enter();
    p.PM.renderFrame(f.t);
    // 정말 바뀌었는지 먼저 확인한다 (아무것도 안 바뀌었으면 복원 시험은 거짓말이다)
    expect(snapshot(f)).not.toEqual(before);
    expect(p.PM.exit()).toBe(true);
    expect(snapshot(f)).toEqual(before);
    expect(p.PM.isActive()).toBe(false);
    expect(p.PM._saved).toBeNull();
    expect(f.renderer.setSize).not.toHaveBeenCalled();
    expect(f.renderer.setPixelRatio).not.toHaveBeenCalled();
    // 사진 레이어·편집기는 숨는다
    expect(p.document.getElementById('photoBgLayer').hidden).toBe(true);
    expect(p.document.getElementById('photoQuadEditor').hidden).toBe(true);
    expect(p.document.body.classList.contains('photo-mode')).toBe(false);
  });

  test('두 번 들락거려도 같다 · 두 번 나가도 무해', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = snapshot(f);
    for (let i = 0; i < 3; i++) { p.PM.enter(); p.PM.renderFrame(f.t); p.PM.exit(); }
    expect(snapshot(f)).toEqual(before);
    expect(p.PM.exit()).toBe(false);
    expect(snapshot(f)).toEqual(before);
  });

  test('디테일 모드를 나가면 사진 모드도 같이 나간다 — 구조 모드가 사진 씬을 물려받지 않는다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = snapshot(f);
    p.PM.enter();
    expect(p.PM.isActive()).toBe(true);
    p.PD.exit();
    expect(p.PM.isActive()).toBe(false);
    expect(f.scene.background).toBe(before.background);
    expect(f.ground.visible).toBe(true);
    expect(f.grid.visible).toBe(true);
    expect(f.edge.visible).toBe(true);
    expect(f.controls.enabled).toBe(true);
  });

  test('planner-detail.js 가 그 순서를 지킨다 (배경 복원이 디테일 룩 복원보다 먼저)', () => {
    const at = DETAIL.indexOf('  exit() {');
    const body = DETAIL.slice(at, at + 1400);
    expect(body).toContain('PlannerPhotoMode.exit()');
    expect(body.indexOf('PlannerPhotoMode.exit()')).toBeLessThan(body.indexOf('this.applyScene(false)'));
  });

  test('골든 페이로드는 사진 모드를 거쳐도 바이트 동일 (I1)', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    const before = canonical(p.g('buildPlannerPayload')('PLANNER_STATE'));
    p.PM.enter();
    p.PM.renderFrame(f.t);
    p.PM.dragTo(2, 900, 700);
    p.PM.nudge('x:1');
    p.PM.exit();
    expect(canonical(p.g('buildPlannerPayload')('PLANNER_STATE'))).toBe(before);
  });
});

describe('사각형 편집기', () => {
  afterEach(() => { window.THREE = undefined; });

  test('이름표 붙은 네 귀퉁이 — 순서가 곧 정본 순서다 (숫자로는 180° 어긋남을 못 막는다)', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const svg = p.document.getElementById('photoQuadEditor');
    const handles = svg.querySelectorAll('.pq-handle');
    expect(handles).toHaveLength(4);
    expect(Array.from(handles).map((h) => h.getAttribute('data-corner'))).toEqual(['0', '1', '2', '3']);
    const tags = Array.from(svg.querySelectorAll('.pq-tag')).map((t) => t.textContent);
    expect(tags).toEqual(['뒤-좌', '뒤-우', '앞-우', '앞-좌']);
    expect(tags).toEqual(p.PB.CORNER_LABEL);
    // 변과 원근 격자도 그렸다 — 평면이 진짜 바닥에 앉았는지 눈으로 보는 장치다
    expect(svg.querySelectorAll('.pq-edge')).toHaveLength(1);
    expect(svg.querySelectorAll('.pq-grid').length).toBeGreaterThan(0);
  });

  test('귀퉁이를 끌면 즉시 다시 풀리고 상태 한 줄이 바뀐다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PM.renderFrame(f.t);
    const before = { pos: p.PM.frame.position.slice(), quad: p.PB.state.quad.map((q) => q.slice()) };
    const line = () => p.document.querySelector('#photoHealth .pb-health').textContent;
    const beforeLine = line();
    p.PM.dragTo(2, 1000, 760);
    expect(p.PB.state.quad[2]).not.toEqual(before.quad[2]);
    expect(p.PB.state.quad[0]).toEqual(before.quad[0]);       // 나머지는 그대로
    expect(p.PM.frame.position).not.toEqual(before.pos);       // 카메라가 다시 풀렸다
    expect(line()).not.toBe(beforeLine);                       // 상태 한 줄도 따라왔다
    // 손잡이가 새 자리로 갔다
    const h = p.document.querySelector('.pq-handle[data-corner="2"]');
    expect(Number(h.getAttribute('cx'))).toBeCloseTo(1000 - p.PM._box.x, 0);
  });

  test('사진 밖으로는 못 끈다 — 0~1 로 자른다', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PM.dragTo(0, -9999, -9999);
    expect(p.PB.state.quad[0]).toEqual([0, 0]);
  });

  test('잠그면 끌리지 않는다', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    p.PB.patch({ locked: true });
    const svg = p.document.getElementById('photoQuadEditor');
    expect(svg.classList.contains('pq-locked')).toBe(true);
    const before = p.PB.state.quad.map((q) => q.slice());
    const h = svg.querySelector('.pq-handle[data-corner="1"]');
    h.onpointerdown({ preventDefault() {}, stopPropagation() {}, pointerId: 1 });
    expect(p.PM._drag).toBeNull();
    expect(p.PB.state.quad).toEqual(before);
  });
});

describe('우측 패널', () => {
  afterEach(() => { window.THREE = undefined; });

  test('사진이 없으면 올리는 자리만 보여 준다', () => {
    const p = boot();
    fakeThree(p);
    p.PM.renderPanel();
    const host = p.document.getElementById('photoBgBody');
    expect(host.querySelector('#photoDrop')).not.toBeNull();
    expect(host.querySelector('#photoFile')).not.toBeNull();
    expect(host.querySelector('#photoArea')).toBeNull();
  });

  test('사진이 있으면 배치 공간·화각·미세조정·상태가 선다 — 치수 입력 칸은 **없다**', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const host = p.document.getElementById('photoBgBody');
    const sel = host.querySelector('#photoArea');
    expect(sel).not.toBeNull();
    expect(sel.querySelectorAll('option').length).toBe(p.g('areas').length);
    expect(host.querySelector('#photoFov')).not.toBeNull();
    expect(host.querySelector('[data-photo="autofov"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-nudge]').length).toBeGreaterThan(4);
    expect(host.querySelector('[data-photo="reset"]')).not.toBeNull();
    // 2026-09-17 결정: 사람이 치수를 넣는 칸은 두지 않는다
    expect(host.querySelectorAll('input[type=number]')).toHaveLength(0);
    expect(host.textContent).toContain('배치 공간에서 자동으로');
    // P0 측정 근거를 그대로 안내한다
    expect(host.textContent).toContain('너른 사각형');
    expect(host.textContent).toContain('대략적인 위치');
    expect(host.textContent).toContain('뒤-좌 → 뒤-우 → 앞-우 → 앞-좌');
    // 궤도가 꺼진다는 것을 말해 준다
    expect(host.textContent).toContain('줌이 꺼집니다');
    // P2 가 「그림자·빛」 묶음을 더해도 P1 의 묶음은 그대로다
    expect(host.querySelector('.pb-group .pb-title').textContent).toContain('그림자');
    expect(host.querySelectorAll('[data-look]').length).toBe(9);
  });

  test('배치 공간을 바꾸면 그 공간의 **실제 치수**로 다시 푼다', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const areas = p.g('areas');
    const other = areas.find((a) => a.id !== p.PM.areaId());
    expect(other).toBeTruthy();
    const before = p.PM.rect();
    p.PM.setArea(other.id);
    const after = p.PM.rect();
    expect(after.areaId).toBe(other.id);
    expect(after.w).toBe(other.W);
    expect(after.d).toBe(other.D);
    expect(after).not.toEqual(before);
    expect(p.PB.state.plane.areaId).toBe(other.id);
  });

  test('미세조정은 사각형에 반대로 얹혀 카메라를 옮긴다 — 씬은 손대지 않는다', () => {
    const p = boot();
    const f = fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const pos0 = p.PM.frame.position.slice();
    const kids = f.moduleGroup.children.length;
    p.PM.nudge('x:1');
    expect(p.PB.state.nudge.x).toBe(M.PLANNER_PHOTO_MODE_STEP_MM);
    expect(p.PM.frame.position[0]).toBeCloseTo(pos0[0] - M.PLANNER_PHOTO_MODE_STEP_MM, 3);
    p.PM.nudge('x:1', true);                                   // Shift = 큰 걸음
    expect(p.PB.state.nudge.x).toBe(M.PLANNER_PHOTO_MODE_STEP_MM + M.PLANNER_PHOTO_MODE_STEP_BIG_MM);
    p.PM.nudge('reset');
    expect(p.PB.state.nudge).toEqual({ x: 0, z: 0, rotationDeg: 0 });
    expect(p.PM.frame.position[0]).toBeCloseTo(pos0[0], 3);
    expect(f.moduleGroup.children.length).toBe(kids);           // 모듈 mesh 는 그대로 (I1 의 근거)
  });

  test('「화각 자동 맞춤」은 오차가 가장 작은 화각을 슬라이더에 박는다', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    expect(p.PB.state.fovDeg).toBeNull();
    const got = p.PM.autoFov();
    expect(got).toBeGreaterThan(B_FOV_MIN());
    expect(p.PB.state.fovDeg).toBeCloseTo(Math.round(got * 10) / 10, 6);
    const slider = p.document.getElementById('photoFov');
    expect(Number(slider.value)).toBeCloseTo(p.PB.state.fovDeg, 6);
  });

  test('상태 한 줄은 등급을 색으로 말한다', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const el = p.document.querySelector('#photoHealth .pb-health');
    expect(['good', 'rough', 'bad']).toContain(el.getAttribute('data-level'));
    expect(el.textContent.length).toBeGreaterThan(3);
  });

  function B_FOV_MIN() { return BG.PLANNER_PHOTO_BG_FOV_MIN; }
});

describe('HTML 배선', () => {
  test('우측 패널 섹션 3곳 규약 — 마크업 · PANEL_SEC_TITLE · 디테일 모드 CSS 예외', () => {
    expect(HTML).toContain('data-sec="photo"');
    expect(HTML).toContain('id="photoBgBody"');
    expect(HTML).toMatch(/photo: '사진 합성'/);
    expect(DETAIL).toContain(':not([data-sec="photo"])');
    expect(DETAIL).toContain('.section[data-sec="photo"]{display:block!important}');
  });

  test('도구막대 버튼은 디테일 모드에서만 보인다 (.pd-only)', () => {
    const at = HTML.indexOf('id="photoModeBtn"');
    expect(at).toBeGreaterThan(-1);
    expect(HTML.slice(at - 200, at)).toContain('pd-only');
  });

  test('바닥판·그리드·원점 마커에 이름표가 붙어 있다 — 사진 모드가 그걸로 찾는다', () => {
    expect(HTML).toContain("grid.userData = { entityKind: 'grid' }");
    expect(HTML).toContain("ground.userData = { entityKind: 'ground' }");
    expect(HTML).toContain("lines.userData = { entityKind: 'origin' }");
    expect(Object.keys(M.PLANNER_PHOTO_MODE_HIDE_KINDS).sort()).toEqual(['grid', 'ground', 'origin']);
  });

  test('mount 가 배치 공간·원점을 넘긴다 — 치수의 출처가 하나다', () => {
    const at = HTML.indexOf('PlannerPhotoMode.mount(');
    expect(at).toBeGreaterThan(-1);
    const body = HTML.slice(at, at + 500);
    expect(body).toContain('areas: () => areas');
    expect(body).toContain('origin: () => originPos2D');
    expect(body).toContain('activeAreaId: () => activeAreaId');
  });
});

describe('모듈 규약', () => {
  const src = norm(fs.readFileSync(path.join(ROOT, 'js/planner/photo-mode.js'), 'utf8'));

  test('클래식 스크립트 — window 와 module.exports 둘 다', () => {
    expect(src).toContain('window.PlannerPhotoMode = PlannerPhotoMode;');
    expect(src).toContain("if (typeof module !== 'undefined' && module.exports)");
  });

  test('최상위 이름이 photo-solve·photo-bg 와 겹치지 않는다', () => {
    const { topLevelDeclarations } = require('../test-utils/js-scan');
    const mine = topLevelDeclarations(src);
    for (const n of mine) expect(n).toMatch(/^(plannerPhotoMode|PLANNER_PHOTO_MODE_|PlannerPhotoMode$)/);
    ['photo-solve.js', 'photo-bg.js'].forEach((f) => {
      const other = topLevelDeclarations(norm(fs.readFileSync(path.join(ROOT, 'js/planner', f), 'utf8')));
      for (const n of mine) expect(other.has(n)).toBe(false);
    });
  });
});

// 2026-09-17 브라우저 확인에서 나온 것 — 사진 모드에서 나와도 사각형 손잡이와
// 노란 선이 화면에 그대로 남았다. `el.hidden = true` 로는 둘 다 안 숨는다:
//   · #photoBgLayer 는 이 파일 CSS 가 display:block 을 박아 [hidden] 을 이긴다
//   · #photoQuadEditor 는 SVGElement 라 hidden 프로퍼티가 내용 속성으로 반영된다는
//     보장이 없다 — 속성이 안 붙으면 [hidden] 규칙 자체가 안 걸린다
// jsdom 은 UA 스타일시트를 그대로 흉내 내지 않으므로 **인라인 display** 를 본다.
describe('사진 모드에서 나오면 겹친 레이어가 실제로 사라진다', () => {
  // 한 번만 부팅한다 — 이 파일에서 한 시험이 두 번 부팅하면 jsdom 이 WebGL 컨텍스트를
  // 못 만들어 터진다(하네스의 기존 제약). 나가기와 다시 들어가기를 이어서 본다.
  test('나가면 style.display:none, 다시 들어가면 CSS 값으로 돌아온다', () => {
    const p = boot();
    fakeThree(p);
    withPhoto(p);
    p.PM.enter();
    const img = p.document.getElementById('photoBgLayer');
    const svg = p.document.getElementById('photoQuadEditor');
    expect(img).not.toBeNull();
    expect(svg).not.toBeNull();
    expect(img.style.display).not.toBe('none');
    expect(svg.style.display).not.toBe('none');

    p.PM.exit();
    // 화면에서 사라져야 한다 — hidden 속성만으로는 부족하다 (2026-09-17 브라우저 확인)
    expect(img.style.display).toBe('none');
    expect(svg.style.display).toBe('none');

    p.PM.enter();
    // 인라인 display 를 남기지 않는다 — CSS 가 정한 값을 그대로 쓴다
    expect(img.style.display).toBe('');
    expect(svg.style.display).toBe('');
  });
});
