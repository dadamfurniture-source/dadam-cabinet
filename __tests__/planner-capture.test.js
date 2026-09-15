/**
 * D3: 렌더 스냅샷 (js/planner/planner-capture.js + planner-store.js saveRender/listRenders + mockup-structure.html 배선).
 *
 *   · 프리셋 프레이밍(순수): 경계 → 카메라 위치·타깃·fov — front(−Z, 경계가 화면에 꽉 차는 거리) · plan(−Y, up −Z) · iso(fitCameraToBounds 비율) · module
 *   · 경로: {design}/{item}/{kind}-{yyyymmddHHMMss}.png · module-{id}-… · 스코프 없으면 null
 *   · detail_hash: 키 순서와 무관하게 같은 sha-256 (node crypto 와 대조)
 *   · 파이프라인(three.cjs + 값 주머니 renderer): rtA → OutputPass → rtB → readRenderTargetPixels → 뒤집기·알파 255 ·
 *     OutputPass 가 없으면 단일 패스 + CPU sRGB · 렌더타깃 복원·dispose · area/pick 은 경계에서 제외
 *   · 상태 복원(페이지 부팅 + fakeThree): 구조 모드 — 찍는 순간엔 디테일 룩, 끝나면 renderer·조명·환경맵·재질 전부 원래 값,
 *     setSize/setPixelRatio 는 부르지 않는다. 디테일 모드 — 찍은 뒤에도 룩이 남고 exit 가 되돌린다
 *   · saveAll: 스코프 없음 → 다운로드 3장 · 스코프 있음 → saveRender 3번(경로·해시·카메라) · 버킷 없음 → 다운로드 + 안내 · busy 가드
 *   · PlannerStore.saveRender / listRenders 의 호출 모양 (가짜 클라이언트)
 *   · 최근 렌더 띠, HTML 배선
 *
 * 실제 브라우저에서 PNG 가 비어 있지 않은지는 여기서 볼 수 없다 (jsdom 에 WebGL 이 없다) — 파이프라인의 호출 순서와
 * 상태 복원을 대신 본다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const THREE = require('three');
const C = require('../js/planner/planner-capture');
const S = require('../js/planner/planner-store');
const { bootPlanner } = require('../test-utils/planner-harness');
const { FIXTURES, seedFor } = require('../test-utils/planner-golden');

const ROOT = path.join(__dirname, '..');
const norm = (t) => t.split('\r\n').join('\n');
const HTML = norm(fs.readFileSync(path.join(ROOT, 'mockup-structure.html'), 'utf8'));
const SQL = fs.readFileSync(path.join(ROOT, 'database/design-renders.sql'), 'utf8');

const B = { min: { x: 0, y: 0, z: 0 }, max: { x: 3600, y: 2300, z: 600 } };
const tanHalf = (fov) => Math.tan((fov / 2) * Math.PI / 180);

// ── 순수 ────────────────────────────────────────────────

describe('프리셋 프레이밍 (순수)', () => {
  test('front — 경계 중심을 −Z 로 본다. 세로(H)·가로(W/aspect) 중 큰 쪽이 여백 8% 를 두고 꽉 찬다', () => {
    const f = C.plannerCaptureFrame('front', B, 1.5);
    expect(f.kind).toBe('front');
    expect(f.fov).toBe(12);
    expect(f.target).toEqual([1800, 1150, 300]);
    expect(f.position[0]).toBe(1800);
    expect(f.position[1]).toBe(1150);
    expect(f.position[2]).toBeGreaterThan(B.max.z);
    expect(f.up).toEqual([0, 1, 0]);
    // 앞면(max.z)에서의 거리 d = position.z − max.z. 그 거리에서 보이는 반높이 = d·tan(fov/2), 반너비 = 그것 × aspect.
    const d = f.position[2] - B.max.z;
    const halfH = d * tanHalf(12), halfW = halfH * 1.5;
    const M = C.PLANNER_CAPTURE_MARGIN;
    expect(halfH).toBeGreaterThanOrEqual(2300 * M / 2 - 1e-6);
    expect(halfW).toBeGreaterThanOrEqual(3600 * M / 2 - 1e-6);
    // 둘 중 하나는 딱 맞는다 (경계가 화면에 꽉 찬다)
    expect(Math.min(Math.abs(halfH - 2300 * M / 2), Math.abs(halfW - 3600 * M / 2))).toBeLessThan(1e-6);
    expect(f.far).toBeGreaterThan(f.dist * 2);
    expect(f.near).toBe(10);
  });

  test('front — 종횡비가 넓으면 세로가, 좁으면 가로가 묶는다', () => {
    const wide = C.plannerCaptureFrame('front', B, 3);      // W/H = 1.57 < 3 → 세로가 묶는다
    const narrow = C.plannerCaptureFrame('front', B, 0.5);  // → 가로가 묶는다
    const dW = wide.position[2] - B.max.z, dN = narrow.position[2] - B.max.z;
    expect(dW * tanHalf(12)).toBeCloseTo(2300 * C.PLANNER_CAPTURE_MARGIN / 2, 6);
    expect(dN * tanHalf(12) * 0.5).toBeCloseTo(3600 * C.PLANNER_CAPTURE_MARGIN / 2, 6);
  });

  test('plan — 위(+Y)에서 내려다본다, up 은 −Z (뒷벽이 위), 깊이(D)·가로가 꽉 찬다', () => {
    const f = C.plannerCaptureFrame('plan', B, 3600 / 600);
    expect(f.kind).toBe('plan');
    expect(f.position[0]).toBe(1800);
    expect(f.position[2]).toBe(300);
    expect(f.position[1]).toBeGreaterThan(B.max.y);
    expect(f.up).toEqual([0, 0, -1]);
    const d = f.position[1] - B.max.y;
    const M = C.PLANNER_CAPTURE_MARGIN;
    expect(d * tanHalf(12)).toBeGreaterThanOrEqual(600 * M / 2 - 1e-6);
    expect(d * tanHalf(12) * (3600 / 600)).toBeGreaterThanOrEqual(3600 * M / 2 - 1e-6);
  });

  test('iso · module — fitCameraToBounds 와 같은 비율 (0.7, 0.5, 1) × size×1.4, fov 45', () => {
    const f = C.plannerCaptureFrame('iso', B, 1.5);
    const dist = 3600 * 1.4;
    expect(f.fov).toBe(45);
    expect(f.position).toEqual([1800 + dist * 0.7, 1150 + dist * 0.5, 300 + dist]);
    expect(f.target).toEqual([1800, 1150, 300]);
    expect(C.plannerCaptureFrame('module:lower-0', B, 1.5)).toMatchObject({ kind: 'module', fov: 45, position: f.position });
  });

  test('종횡비 — front 는 W/H, plan 은 W/D, iso 는 화면. 0.5~3 으로 자른다. 경계가 없으면 null', () => {
    expect(C.plannerCaptureAspectFor('front', B, 1.5)).toBeCloseTo(3600 / 2300);
    expect(C.plannerCaptureAspectFor('plan', B, 1.5)).toBe(3);        // 6 → 3
    expect(C.plannerCaptureAspectFor('iso', B, 1.7)).toBe(1.7);
    expect(C.plannerCaptureAspectFor('iso', B, NaN)).toBe(1.5);
    expect(C.plannerCaptureAspectFor('front', null, 1.2)).toBe(1.2);
    expect(C.plannerCaptureFrame('front', null, 1)).toBeNull();
    expect(C.plannerCaptureFrame('front', B, 100).aspect).toBe(3);
  });

  test('크기 — 긴 변이 longEdge, 다른 변은 종횡비로', () => {
    expect(C.plannerCaptureSizeFor(2048, 1.5)).toEqual({ width: 2048, height: 1365 });
    expect(C.plannerCaptureSizeFor(2048, 0.5)).toEqual({ width: 1024, height: 2048 });
    expect(C.plannerCaptureSizeFor(4096, 1)).toEqual({ width: 4096, height: 4096 });
    expect(C.plannerCaptureSizeFor('x', 1.5)).toEqual({ width: 2048, height: 1365 });
  });

  test('camera JSON — 정수 mm, aspect 3자리, moduleId 는 module 일 때만', () => {
    const f = C.plannerCaptureFrame('front', { min: { x: 0.4, y: 0, z: 0 }, max: { x: 3600.4, y: 2300, z: 600 } }, 1.5);
    const j = C.plannerCaptureCameraJson(f, 2048, null);
    expect(j).toEqual({ kind: 'front', fov: 12, aspect: 1.5, position: [1800, 1150, Math.round(f.position[2])], target: [1800, 1150, 300], up: [0, 1, 0], longEdge: 2048 });
    expect(C.plannerCaptureCameraJson(f, 2048, 'lower-0').moduleId).toBe('lower-0');
    expect(C.plannerCaptureCameraJson(null, 2048)).toBeNull();
  });
});

describe('경로·파일명·해시 (순수)', () => {
  const at = new Date(2026, 8, 15, 9, 5, 7);
  test('yyyymmddHHMMss · {design}/{item}/{kind}-{stamp}.png · module-{id}-{stamp}.png', () => {
    expect(C.plannerCaptureStamp(at)).toBe('20260915090507');
    expect(C.plannerCaptureFileName('front', null, at)).toBe('front-20260915090507.png');
    expect(C.plannerCaptureFileName('module', 'lower-0', at)).toBe('module-lower-0-20260915090507.png');
    expect(C.plannerCaptureFileName('module:upper 1/2', null, at)).toBe('module-upper_1_2-20260915090507.png');
    expect(C.plannerCapturePath({ designId: 'd1', itemId: 5 }, 'iso', null, at)).toBe('d1/5/iso-20260915090507.png');
    expect(C.plannerCapturePath({ designId: 'd1', itemId: 1757550000000 }, 'plan', null, at)).toBe('d1/1757550000000/plan-20260915090507.png');
    // 스코프 없음 → 올릴 곳이 없다
    expect(C.plannerCapturePath({ designId: null, itemId: 5 }, 'front', null, at)).toBeNull();
    expect(C.plannerCapturePath(S.plannerScopeIds('?design=local&item=5'), 'front', null, at)).toBeNull();
    // 첫 폴더 = design_id — Storage 정책(storage.foldername(name)[1]) 이 그걸로 소유자를 판정한다
    expect(C.plannerCapturePath(S.plannerScopeIds('?design=abc-1&item=7.9'), 'front', null, at).split('/')[0]).toBe('abc-1');
    expect(C.plannerCaptureParseKind('module:x')).toEqual({ kind: 'module', moduleId: 'x' });
    expect(C.plannerCaptureParseKind('nope')).toEqual({ kind: 'iso', moduleId: null });
  });

  test('버킷 이름은 capture · store · SQL 이 같다', () => {
    expect(C.PLANNER_CAPTURE_BUCKET).toBe('renders');
    expect(S.PLANNER_RENDERS_BUCKET).toBe('renders');
    expect(SQL).toMatch(/VALUES \('renders', 'renders', FALSE\)/);
  });

  test('sha-256 은 node crypto 와 같다 (ASCII · 한글 · 빈 문자열 · 긴 입력)', () => {
    const ref = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
    for (const t of ['', 'abc', '한글 마감 PET-OAK-M', 'x'.repeat(1000), '{"a":1}']) expect(C.plannerCaptureSha256(t)).toBe(ref(t));
  });

  test('detail_hash — 키 순서·undefined 와 무관하게 같고, 값이 다르면 다르다. 모델이 없어도 값이 있다', () => {
    const a = { version: 1, item: { door: { code: 'PET-OAK-M' } }, sections: { upper: {}, lower: {} }, modules: {}, parts: {} };
    const b = { parts: {}, modules: {}, sections: { lower: {}, upper: {} }, item: { door: { code: 'PET-OAK-M' } }, version: 1, extra: undefined };
    expect(C.plannerCaptureDetailHash(a)).toBe(C.plannerCaptureDetailHash(b));
    expect(C.plannerCaptureDetailHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(C.plannerCaptureDetailHash(Object.assign({}, a, { item: { door: { code: 'PET-WHT-G' } } }))).not.toBe(C.plannerCaptureDetailHash(a));
    expect(C.plannerCaptureDetailHash(null)).toBe(C.plannerCaptureSha256('null'));
    expect(C.plannerCaptureStableJson({ b: [1, { z: 1, y: 2 }], a: null })).toBe('{"a":null,"b":[1,{"y":2,"z":1}]}');
  });

  test('flipRows — 아래→위를 위→아래로, 알파는 255', () => {
    const src = new Uint8Array([1, 1, 1, 0, 2, 2, 2, 0, /* row1 */ 3, 3, 3, 9, 4, 4, 4, 9]);
    expect(Array.from(C.plannerCaptureFlipRows(src, 2, 2))).toEqual([3, 3, 3, 255, 4, 4, 4, 255, 1, 1, 1, 255, 2, 2, 2, 255]);
    const px = new Uint8ClampedArray([0, 128, 255, 255]);
    C.plannerCaptureApplySrgb(px);
    expect(Array.from(px)).toEqual([0, 188, 255, 255]);   // linear 0.5 → sRGB 0.735
  });
});

// ── 파이프라인 (three.cjs + 값 주머니 renderer) ─────────────

function fakeRenderer(opt = {}) {
  const calls = [];
  const r = {
    calls,
    capabilities: { maxTextureSize: opt.maxTextureSize || 8192 },
    outputColorSpace: THREE.LinearSRGBColorSpace,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    _rt: null,
    getRenderTarget() { return this._rt; },
    setRenderTarget(rt) { this._rt = rt; calls.push(['setRT', rt ? rt.width + 'x' + rt.height : null]); },
    render(scene, cam) { calls.push(['render', cam.fov, this._rt ? this._rt.width : null, this.toneMapping]); if (opt.onRender) opt.onRender(scene, cam, this); },
    readRenderTargetPixels(rt, x, y, w, h, buf) {
      calls.push(['read', w, h, rt.texture.type]);
      for (let i = 0; i < buf.length; i += 4) { buf[i] = 128; buf[i + 1] = 64; buf[i + 2] = 32; buf[i + 3] = 0; }
      buf[0] = 255;   // 아래 왼쪽 첫 픽셀 — 뒤집힘 확인용
    },
    setSize: jest.fn(),
    setPixelRatio: jest.fn(),
    getPixelRatio: () => 1.5,
    getSize(v) { return v.set(1200, 800); },
  };
  return r;
}

function sceneWith() {
  const scene = new THREE.Scene();
  const mg = new THREE.Group();
  scene.add(mg);
  const g = new THREE.Group();
  g.userData = { entityKind: 'module', moduleId: 'lower-0' };
  g.position.set(1000, 0, 0);
  mg.add(g);
  const door = new THREE.Mesh(new THREE.BoxGeometry(600, 720, 560), new THREE.MeshStandardMaterial());
  door.position.y = 360;
  door.userData = { entityKind: 'carcass', side: 'front', areaType: 'door', moduleId: 'lower-0', areaIdx: 0 };
  g.add(door);
  const g2 = new THREE.Group();
  g2.userData = { entityKind: 'module', moduleId: 'upper-0' };
  g2.position.set(1000, 1500, 0);
  mg.add(g2);
  const top = new THREE.Mesh(new THREE.BoxGeometry(600, 700, 350), new THREE.MeshStandardMaterial());
  top.position.y = 350;
  top.userData = { entityKind: 'top-panel' };
  g2.add(top);
  // 부재가 아닌 것 — 경계에서 빠져야 한다
  const area = new THREE.Mesh(new THREE.BoxGeometry(9000, 9000, 9000), new THREE.MeshStandardMaterial());
  area.userData = { entityKind: 'area', areaId: 'a' };
  mg.add(area);
  const pick = new THREE.Mesh(new THREE.BoxGeometry(5000, 5000, 5000), new THREE.MeshStandardMaterial());
  pick.userData = { entityKind: 'pick' };
  mg.add(pick);
  const marker = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200, 0, 0), new THREE.Vector3(200, 0, 0)]), new THREE.LineBasicMaterial());
  mg.add(marker);
  return { scene, moduleGroup: mg, door, top };
}

describe('파이프라인 — 오프스크린 렌더타깃', () => {
  const PC = C.PlannerCapture;
  beforeEach(() => {
    window.THREE = THREE;
    PC._encode = (px, w, h) => ({ type: 'image/png', w, h, size: px.length, px });
    PC._outputPass = null;
    delete window.OutputPass;
  });
  afterEach(() => { window.THREE = undefined; PC._encode = null; PC._outputPass = null; delete window.OutputPass; PC.mount(null); });

  test('경계는 mesh 만 — area·pick·선 제외, 모듈 하나만 재기', () => {
    const s = sceneWith();
    expect(C.plannerCaptureBoundsOf(s.moduleGroup, THREE)).toEqual({ min: { x: 700, y: 0, z: -280 }, max: { x: 1300, y: 2200, z: 280 } });
    expect(C.plannerCaptureBoundsOf(C.plannerCaptureModuleObject(s.moduleGroup, 'upper-0'), THREE)).toEqual({ min: { x: 700, y: 1500, z: -175 }, max: { x: 1300, y: 2200, z: 175 } });
    expect(C.plannerCaptureModuleObject(s.moduleGroup, 'nope')).toBeNull();
    expect(C.plannerCaptureBoundsOf(new THREE.Group(), THREE)).toBeNull();
  });

  test('OutputPass 가 있으면 두 패스: 씬 → rtA(HalfFloat) → OutputPass(rtA→rtB, UnsignedByte) → rtB 읽기 → 렌더타깃 복원·dispose', () => {
    const s = sceneWith();
    const r = fakeRenderer();
    const passCalls = [];
    window.OutputPass = class {
      render(renderer, write, read) { passCalls.push([read.width, write.width, read.texture.type, write.texture.type]); renderer.setRenderTarget(write); }
    };
    PC.mount({ three: () => ({ renderer: r, scene: s.scene, moduleGroup: s.moduleGroup }) });
    const disposed = [];
    const origDispose = THREE.WebGLRenderTarget.prototype.dispose;
    THREE.WebGLRenderTarget.prototype.dispose = function () { disposed.push(this.width); return origDispose.call(this); };
    try {
      const shot = PC.capturePixels({ kind: 'front', longEdge: 64 });
      expect(shot.ok).toBe(true);
      expect(shot.toneMapped).toBe(true);
      expect(shot.width).toBe(32);    // W/H = 600/2200 → 0.5 로 잘림, 긴 변이 세로
      expect(shot.height).toBe(64);
    } finally { THREE.WebGLRenderTarget.prototype.dispose = origDispose; }
    expect(disposed.length).toBe(2);
    expect(passCalls).toHaveLength(1);
    expect(passCalls[0][2]).toBe(THREE.HalfFloatType);
    expect(passCalls[0][3]).toBe(THREE.UnsignedByteType);
    const kinds = r.calls.map((c) => c[0]);
    expect(kinds).toEqual(['setRT', 'render', 'setRT', 'read', 'setRT']);
    expect(r.calls[3][3]).toBe(THREE.UnsignedByteType);   // 읽는 것은 rtB
    expect(r.calls[4]).toEqual(['setRT', null]);            // 화면으로 복원
    expect(r._rt).toBeNull();
    expect(r.setSize).not.toHaveBeenCalled();
    expect(r.setPixelRatio).not.toHaveBeenCalled();
  });

  test('크기 — front 는 경계 W/H(0.5 로 잘림), 긴 변이 세로 · maxTextureSize 로 자른다 · 픽셀은 뒤집혀 알파 255', () => {
    const s = sceneWith();
    const r = fakeRenderer({ maxTextureSize: 1000 });
    PC.mount({ three: () => ({ renderer: r, scene: s.scene, moduleGroup: s.moduleGroup }) });
    const shot = PC.capturePixels({ kind: 'front', longEdge: 4096 });
    expect(shot.ok).toBe(true);
    expect(shot.height).toBe(1000);          // 4096 → 1000
    expect(shot.width).toBe(500);            // aspect 0.5
    expect(shot.camera).toMatchObject({ kind: 'front', fov: 12, aspect: 0.5, target: [1000, 1100, 0], longEdge: 1000 });
    expect(shot.pixels.length).toBe(500 * 1000 * 4);
    // 원본 첫 픽셀(아래 왼쪽 255) 이 마지막 줄 첫 픽셀로 (그 뒤 sRGB 폴백이 255 는 255 로 둔다)
    const last = (1000 - 1) * 500 * 4;
    expect(shot.pixels[last]).toBe(255);
    expect(shot.pixels[last + 3]).toBe(255);
    expect(shot.pixels[3]).toBe(255);
    expect(shot.toneMapped).toBe(false);     // OutputPass 없음 → 폴백
    expect(r.calls.map((c) => c[0])).toEqual(['setRT', 'render', 'read', 'setRT']);
    expect(r.calls[2][3]).toBe(THREE.UnsignedByteType);   // 단일 패스는 UnsignedByte 로 찍는다
    // 폴백은 sRGB 곡선 — linear 128 → 188
    expect(shot.pixels[0]).toBe(188);
  });

  test('module:<id> 는 그 모듈 경계로 iso · 없는 모듈·빈 씬·three 없음은 이유를 돌려준다 (렌더타깃은 그래도 복원)', () => {
    const s = sceneWith();
    const r = fakeRenderer();
    PC.mount({ three: () => ({ renderer: r, scene: s.scene, moduleGroup: s.moduleGroup }) });
    const shot = PC.capturePixels({ kind: 'module:upper-0', longEdge: 64 });
    expect(shot.ok).toBe(true);
    expect(shot.kind).toBe('module');
    expect(shot.moduleId).toBe('upper-0');
    expect(shot.camera).toMatchObject({ kind: 'module', fov: 45, target: [1000, 1850, 0], moduleId: 'upper-0' });
    expect(shot.width).toBe(64);
    expect(shot.height).toBe(43);            // 화면 1200×800
    expect(PC.capturePixels({ kind: 'module:nope' })).toEqual({ ok: false, reason: 'empty', message: '그 모듈이 3D 에 없습니다' });
    expect(r._rt).toBeNull();
    PC.mount({ three: () => ({ renderer: r, scene: new THREE.Scene(), moduleGroup: new THREE.Group() }) });
    expect(PC.capturePixels({ kind: 'front' }).reason).toBe('empty');
    PC.mount({ three: () => null });
    expect(PC.capturePixels({ kind: 'front' }).reason).toBe('no-three');
    // 렌더가 던져도 이유로 돌아오고 렌더타깃은 복원된다
    const bad = fakeRenderer({ onRender() { throw new Error('gl lost'); } });
    PC.mount({ three: () => ({ renderer: bad, scene: s.scene, moduleGroup: s.moduleGroup }) });
    expect(PC.capturePixels({ kind: 'iso' })).toEqual({ ok: false, reason: 'error', message: 'gl lost' });
    expect(bad._rt).toBeNull();
  });

  test('capture → PNG(인코더 주입) · captureAll 은 front/iso/plan + 모듈, 같은 date 로 파일명', async () => {
    const s = sceneWith();
    const r = fakeRenderer();
    PC.mount({ three: () => ({ renderer: r, scene: s.scene, moduleGroup: s.moduleGroup }) });
    const at = new Date(2026, 8, 15, 9, 5, 7);
    const one = await PC.capture({ kind: 'plan', longEdge: 32, date: at });
    expect(one.ok).toBe(true);
    expect(one.blob).toMatchObject({ type: 'image/png', w: 32, h: 30 });   // plan 종횡비 W/D = 600/560
    expect(one.fileName).toBe('plan-20260915090507.png');
    const progress = [];
    const all = await PC.captureAll({ longEdge: 32, date: at, modules: ['lower-0', 'nope'], onProgress: (i, n, k) => progress.push(`${i}/${n}:${k}`) });
    expect(all.shots.map((x) => x.fileName)).toEqual(['front-20260915090507.png', 'iso-20260915090507.png', 'plan-20260915090507.png', 'module-lower-0-20260915090507.png']);
    expect(all.failed).toEqual([{ kind: 'module', moduleId: 'nope', ok: false, reason: 'empty', message: '그 모듈이 3D 에 없습니다' }]);
    expect(progress).toEqual(['0/5:front', '1/5:iso', '2/5:plan', '3/5:module', '4/5:module']);
    // 인코더가 던지면 이유로
    PC._encode = () => { throw new Error('no canvas'); };
    expect(await PC.capture({ kind: 'iso' })).toEqual({ ok: false, reason: 'encode', message: 'no canvas' });
  });
});

// ── 상태 복원 (페이지 부팅 + fakeThree) ─────────────────────

function boot(opts = {}) {
  const seed = Object.assign({}, seedFor(FIXTURES.straight), opts.storage || {});
  let search = seed._search;
  delete seed._search;
  if (opts.detail) search += '&stage=detail';
  const p = bootPlanner('mockup-structure.html', { search, storage: seed });
  if (p.errors.length) throw new Error('부팅 오류: ' + p.errors.map((e) => e.message).join(' | '));
  p.g('loadModules')();
  p.PD = p.window.PlannerDetail;
  p.PC = p.window.PlannerCapture;
  return p;
}

/** init3D 가 만든 것과 같은 모양 + 캡처가 부르는 renderer 메서드. 조명·부재 mesh 포함. */
function fakeThree(p, opt = {}) {
  const scene = new THREE.Scene();
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  const d1 = new THREE.DirectionalLight(0xffffff, 1.8);
  scene.add(amb, d1);
  const moduleGroup = new THREE.Group();
  scene.add(moduleGroup);
  const m = p.g('modules')[0];
  const modG = new THREE.Group();
  modG.userData = { entityKind: 'module', moduleId: m.id };
  moduleGroup.add(modG);
  const door = new THREE.Mesh(new THREE.BoxGeometry(600, 720, 18), new THREE.MeshStandardMaterial({ color: 0xb8956c }));
  door.userData = { entityKind: 'carcass', side: 'front', areaType: 'door', moduleId: m.id, areaIdx: 0, areaPos: 'top' };
  door.position.set(300, 360, 280);
  modG.add(door);
  const seen = [];
  const renderer = Object.assign(fakeRenderer({
    onRender(s, cam, r) {
      seen.push({ tone: r.toneMapping, cs: r.outputColorSpace, env: s.environment, amb: amb.intensity, doorMat: door.material.constructor.name, fov: cam.fov });
      if (opt.onRender) opt.onRender(s, cam, r);
    },
  }));
  const t = { renderer, scene, moduleGroup, camera: new THREE.PerspectiveCamera(45, 1.5, 10, 50000), controls: { target: new THREE.Vector3() } };
  p.window.THREE = THREE;
  p.PD._o.three = () => t;
  p.PC._o.three = () => t;
  const target = { texture: new THREE.Texture(), dispose: jest.fn() };
  p.PD._makeEnv = () => ({ texture: target.texture, target });
  p.PC._encode = (px, w, h) => ({ type: 'image/png', w, h, size: px.length });
  return { t, renderer, scene, moduleGroup, door, lights: { amb, d1 }, seen, target, moduleId: m.id };
}

describe('상태 복원 — 구조 모드에서 찍어도 디테일 룩, 끝나면 전부 원래 값', () => {
  afterEach(() => { window.THREE = undefined; });

  test('구조 모드: 찍는 순간엔 ACES·sRGB·환경맵·조명 절반·PBR 재질, 돌아오면 renderer·조명·환경맵·재질·_sceneSaved 전부 원래대로', () => {
    const p = boot();
    const f = fakeThree(p);
    p.PD.detail.parts[f.moduleId] = { 'door#0': { code: 'PET-OAK-M' } };
    const before = {
      tone: f.renderer.toneMapping, cs: f.renderer.outputColorSpace, ex: f.renderer.toneMappingExposure,
      env: f.scene.environment, amb: f.lights.amb.intensity, d1: f.lights.d1.intensity, doorMat: f.door.material,
    };
    expect(p.PD.isActive()).toBe(false);
    const shot = p.PC.capturePixels({ kind: 'front', longEdge: 64 });
    expect(shot.ok).toBe(true);
    // 찍는 순간
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0]).toMatchObject({ tone: THREE.ACESFilmicToneMapping, cs: THREE.SRGBColorSpace, env: f.target.texture, amb: 0.3, doorMat: 'MeshPhysicalMaterial', fov: 12 });
    // 돌아온 뒤
    expect(f.renderer.toneMapping).toBe(before.tone);
    expect(f.renderer.outputColorSpace).toBe(before.cs);
    expect(f.renderer.toneMappingExposure).toBe(before.ex);
    expect(f.scene.environment).toBe(before.env);
    expect(f.lights.amb.intensity).toBe(before.amb);
    expect(f.lights.d1.intensity).toBe(before.d1);
    expect(f.door.material).toBe(before.doorMat);
    expect(f.door.userData._origMaterial).toBeUndefined();
    expect(f.target.dispose).toHaveBeenCalledTimes(1);
    expect(p.PD._sceneSaved).toBeNull();
    expect(p.PD.isActive()).toBe(false);
    expect(p.document.body.classList.contains('detail-mode')).toBe(false);
    expect(f.renderer._rt).toBeNull();
    expect(f.renderer.setSize).not.toHaveBeenCalled();
    expect(f.renderer.setPixelRatio).not.toHaveBeenCalled();
    // 화면 카메라·컨트롤은 손대지 않았다
    expect(f.t.camera.fov).toBe(45);
    // 두 번 찍어도 같다
    p.PC.capturePixels({ kind: 'plan', longEdge: 64 });
    expect(f.door.material).toBe(before.doorMat);
    expect(f.scene.environment).toBe(before.env);
    expect(p.PD._sceneSaved).toBeNull();
  });

  test('디테일 모드: 찍은 뒤에도 룩이 남는다(모드가 주인) — exit 가 되돌린다', () => {
    const p = boot({ detail: true });
    const f = fakeThree(p);
    p.PD.detail.parts[f.moduleId] = { 'door#0': { code: 'PET-OAK-M' } };
    const orig = f.door.material;
    p.PD.paintScene(f.moduleGroup);   // renderAll3D 뒤의 후처리를 흉내
    expect(f.door.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const pbr = f.door.material;
    expect(p.PD._sceneSaved).not.toBeNull();
    const shot = p.PC.capturePixels({ kind: 'iso', longEdge: 64 });
    expect(shot.ok).toBe(true);
    expect(f.seen[0]).toMatchObject({ tone: THREE.ACESFilmicToneMapping, doorMat: 'MeshPhysicalMaterial', fov: 45 });
    // 모드가 켠 것은 그대로
    expect(f.door.material).toBe(pbr);
    expect(f.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(f.scene.environment).toBe(f.target.texture);
    expect(p.PD._sceneSaved).not.toBeNull();
    expect(f.target.dispose).not.toHaveBeenCalled();
    expect(p.PD.isActive()).toBe(true);
    p.PD.exit();
    expect(f.door.material).toBe(orig);
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(f.scene.environment).toBeNull();
    expect(p.PD._sceneSaved).toBeNull();
  });

  test('pushLook/popLook 은 enter/exit 와 같은 길 — 두 번 pop 해도 무해, 구조 모드 paintScene 은 여전히 0', () => {
    const p = boot();
    const f = fakeThree(p);
    p.PD.detail.parts[f.moduleId] = { 'door#0': { code: 'PET-OAK-M' } };
    expect(p.PD.paintScene(f.moduleGroup)).toBe(0);   // I2: 모드 밖 기본 동작 불변
    const tok = p.PD.pushLook();
    expect(tok).toMatchObject({ scene: true, paint: true });
    expect(f.door.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(f.renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(p.PD.popLook(tok)).toBe(true);
    expect(f.door.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(p.PD.popLook(tok)).toBe(true);
    expect(p.PD.popLook(null)).toBe(false);
    expect(f.renderer.toneMapping).toBe(THREE.NoToneMapping);
  });
});

// ── saveAll — 업로드 / 다운로드 / 버킷 없음 ────────────────

describe('saveAll', () => {
  afterEach(() => { window.THREE = undefined; jest.restoreAllMocks(); });

  test('스코프 없음(design=local) → 3장 내려받기, saveRender 는 부르지 않는다', async () => {
    const p = boot();
    const f = fakeThree(p);
    const store = p.window.PlannerStore;
    jest.spyOn(store, 'ready').mockResolvedValue({ ok: false, reason: 'no-scope', ids: { designId: null, itemId: 1 } });
    const save = jest.spyOn(store, 'saveRender').mockResolvedValue({ ok: true });
    const dl = jest.spyOn(p.PC, 'download').mockReturnValue(true);
    const toasts = [];
    p.PC._o.toast = (t) => toasts.push(t);
    const r = await p.PC.saveAll({ longEdge: 64 });
    expect(r).toMatchObject({ ok: true, mode: 'download', saved: 3, total: 3, reason: 'no-scope' });
    expect(save).not.toHaveBeenCalled();
    expect(dl.mock.calls.map((c) => c[1])).toEqual([expect.stringMatching(/^front-\d{14}\.png$/), expect.stringMatching(/^iso-\d{14}\.png$/), expect.stringMatching(/^plan-\d{14}\.png$/)]);
    expect(dl.mock.calls[0][0]).toMatchObject({ type: 'image/png' });
    expect(toasts[0]).toMatch(/렌더 3장 — 설계를 아직 저장하지 않아/);
    expect(f.renderer._rt).toBeNull();
    expect(p.PC.busy).toBe(false);
  });

  test('스코프 있음 → saveRender 3번: 같은 시각 경로 · detail_hash = 지금 마감 모델 · camera · 크기, 토스트에 장수', async () => {
    const p = boot({ detail: true });
    fakeThree(p);
    p.PD.detail.item.door = { code: 'PET-OAK-M' };
    const store = p.window.PlannerStore;
    const ids = { designId: 'gold', itemId: 1 };
    jest.spyOn(store, 'ready').mockResolvedValue({ ok: true, ids, client: {} });
    const save = jest.spyOn(store, 'saveRender').mockImplementation(async (o) => ({ ok: true, id: 'r-' + o.kind, path: o.path }));
    const dl = jest.spyOn(p.PC, 'download').mockReturnValue(true);
    const strip = jest.spyOn(p.PC, 'refreshStrip').mockResolvedValue({ ok: true, rows: [] });
    const toasts = [];
    p.PC._o.toast = (t) => toasts.push(t);
    const btn = p.document.getElementById('renderSaveBtn');
    const r = await p.PC.saveAll({ longEdge: 64 });
    expect(r).toMatchObject({ ok: true, mode: 'upload', saved: 3, total: 3, failed: [] });
    expect(dl).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(3);
    const rows = save.mock.calls.map((c) => c[0]);
    expect(rows.map((x) => x.kind)).toEqual(['front', 'iso', 'plan']);
    const stamp = rows[0].path.match(/^gold\/1\/front-(\d{14})\.png$/)[1];
    expect(rows[1].path).toBe(`gold/1/iso-${stamp}.png`);
    expect(rows[2].path).toBe(`gold/1/plan-${stamp}.png`);
    const hash = C.plannerCaptureDetailHash(p.PD.detail);
    rows.forEach((x) => {
      expect(x.ids).toBe(ids);
      expect(x.detailHash).toBe(hash);
      expect(x.moduleId).toBeNull();
      expect(x.blob).toMatchObject({ type: 'image/png' });
      expect(x.width).toBeGreaterThan(0);
      expect(x.height).toBeGreaterThan(0);
      expect(x.camera).toMatchObject({ kind: x.kind, longEdge: 64 });
    });
    expect(rows[2].camera.up).toEqual([0, 0, -1]);
    expect(toasts.pop()).toMatch(/렌더 3장을 계정에 저장했습니다 \(64px · 톤매핑 없음\)/);
    expect(strip).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('📷 렌더 저장');
  });

  test('"이 모듈" 은 module 한 장 — module_id 와 module-{id} 경로', async () => {
    const p = boot();
    const f = fakeThree(p);
    const store = p.window.PlannerStore;
    jest.spyOn(store, 'ready').mockResolvedValue({ ok: true, ids: { designId: 'gold', itemId: 1 }, client: {} });
    const save = jest.spyOn(store, 'saveRender').mockResolvedValue({ ok: true });
    jest.spyOn(p.PC, 'refreshStrip').mockResolvedValue({ ok: true, rows: [] });
    const r = await p.PC.saveAll({ longEdge: 64, kinds: [], modules: [f.moduleId] });
    expect(r.saved).toBe(1);
    expect(save.mock.calls[0][0]).toMatchObject({ kind: 'module', moduleId: f.moduleId });
    expect(save.mock.calls[0][0].path).toMatch(new RegExp(`^gold/1/module-${f.moduleId.replace(/[^A-Za-z0-9_-]+/g, '_')}-\\d{14}\\.png$`));
  });

  test('버킷 없음 → 첫 실패에서 멈추고 전부 내려받게 한 뒤 SQL 안내 · busy 가드 · 실패만 있으면 이유', async () => {
    const p = boot();
    fakeThree(p);
    const store = p.window.PlannerStore;
    jest.spyOn(store, 'ready').mockResolvedValue({ ok: true, ids: { designId: 'gold', itemId: 1 }, client: {} });
    const save = jest.spyOn(store, 'saveRender').mockResolvedValue({ ok: false, reason: 'no-bucket', message: 'Bucket not found' });
    const dl = jest.spyOn(p.PC, 'download').mockReturnValue(true);
    const toasts = [];
    p.PC._o.toast = (t) => toasts.push(t);
    const r = await p.PC.saveAll({ longEdge: 64 });
    expect(r).toMatchObject({ ok: false, mode: 'upload', saved: 0, total: 3, reason: 'no-bucket' });
    expect(save).toHaveBeenCalledTimes(1);      // 나머지도 같은 이유 — 더 시도하지 않는다
    expect(dl).toHaveBeenCalledTimes(3);
    expect(toasts.pop()).toMatch(/버킷 renders 가 없습니다 — .*design-renders\.sql/);
    // busy
    p.PC.busy = true;
    expect(await p.PC.saveAll()).toMatchObject({ ok: false, reason: 'busy' });
    p.PC.busy = false;
    // 3D 가 없으면
    p.PC._o.three = () => null;
    expect(await p.PC.saveAll({ longEdge: 64 })).toMatchObject({ ok: false, reason: 'no-three', saved: 0 });
    expect(toasts.pop()).toMatch(/렌더 실패: 3D 가 아직/);
  });

  test('📷▾ 메뉴 — 기본·4096·이 모듈(활성 모듈 없으면 비활성) · 버튼은 saveAll(2048)', async () => {
    const p = boot({ detail: true });
    fakeThree(p);
    const calls = [];
    jest.spyOn(p.PC, 'saveAll').mockImplementation(async (o) => { calls.push(o); return { ok: true }; });
    const menuBtn = p.document.getElementById('renderMenuBtn');
    const menu = p.document.getElementById('renderMenu');
    expect(menu.hidden).toBe(true);
    menuBtn.onclick({ stopPropagation() {} });
    expect(menu.hidden).toBe(false);
    const rows = menu.querySelectorAll('[data-render]');
    expect(rows).toHaveLength(3);
    expect(rows[2].disabled).toBe(true);     // 활성 모듈 없음
    rows[1].onclick({ stopPropagation() {} });
    expect(calls.pop()).toEqual({ longEdge: 4096 });
    expect(menu.hidden).toBe(true);
    p.document.getElementById('renderSaveBtn').onclick();
    expect(calls.pop()).toEqual({ longEdge: 2048 });
    // 활성 모듈이 있으면 "이 모듈"
    const m = p.g('modules')[0];
    p.PC._o.activeModuleId = () => m.id;
    menuBtn.onclick({ stopPropagation() {} });
    const row = menu.querySelector('[data-render="module"]');
    expect(row.disabled).toBe(false);
    row.onclick({ stopPropagation() {} });
    expect(calls.pop()).toEqual({ longEdge: 2048, kinds: [], modules: [m.id] });
  });
});

// ── PlannerStore.saveRender / listRenders (가짜 클라이언트) ──────

describe('PlannerStore — 렌더 저장·목록', () => {
  const ids = { designId: 'd1', itemId: 5 };
  function fakeClient(o = {}) {
    const calls = [];
    const q = {
      _eq: [],
      insert(row) { calls.push(['insert', row]); return q; },
      select(c) { calls.push(['select', c]); return q; },
      single: async () => o.insertError ? { data: null, error: { message: o.insertError } } : { data: { id: 'r1', created_at: '2026-09-15T00:00:00Z' }, error: null },
      eq(k, v) { q._eq.push([k, v]); return q; },
      order(k, d) { calls.push(['order', k, d]); return q; },
      limit: async (n) => { calls.push(['limit', n, q._eq.slice()]); return { data: o.rows || [], error: null }; },
    };
    const client = {
      auth: { getSession: async () => ({ data: { session: {} } }) },
      from(t) { calls.push(['from', t]); return q; },
      storage: {
        from(b) {
          calls.push(['bucket', b]);
          return {
            upload: async (p, blob, opt) => { calls.push(['upload', p, opt]); return o.uploadError ? { data: null, error: { statusCode: '404', message: o.uploadError } } : { data: { path: p }, error: null }; },
            remove: async (ps) => { calls.push(['remove', ps]); return { data: [], error: null }; },
            createSignedUrls: async (ps, ttl) => { calls.push(['signed', ps, ttl]); return { data: ps.map((p) => (p === 'd1/5/broken.png' ? { path: p, signedUrl: null, error: 'x' } : { path: p, signedUrl: 'https://s/' + p })), error: null }; },
          };
        },
      },
    };
    return { client, calls };
  }
  afterEach(() => { S.PlannerStore._client = null; });

  test('saveRender — upload(upsert:false, image/png) 뒤 design_renders insert 의 행 모양', async () => {
    const { client, calls } = fakeClient();
    S.PlannerStore._client = client;
    const r = await S.PlannerStore.saveRender({ ids, blob: { size: 9 }, path: 'd1/5/front-20260915090507.png', kind: 'front', width: 2048, height: 1365, camera: { kind: 'front' }, detailHash: 'h' });
    expect(r).toMatchObject({ ok: true, id: 'r1', path: 'd1/5/front-20260915090507.png' });
    expect(calls[0]).toEqual(['bucket', 'renders']);
    expect(calls[1]).toEqual(['upload', 'd1/5/front-20260915090507.png', { contentType: 'image/png', upsert: false, cacheControl: '3600' }]);
    expect(calls[2]).toEqual(['from', 'design_renders']);
    expect(calls[3]).toEqual(['insert', {
      design_id: 'd1', item_unique_id: 5, kind: 'front', module_id: null, path: 'd1/5/front-20260915090507.png',
      width: 2048, height: 1365, camera: { kind: 'front' }, detail_hash: 'h',
    }]);
    expect(calls[4]).toEqual(['select', 'id, created_at']);
    // 모듈 렌더는 module_id 문자열
    await S.PlannerStore.saveRender({ ids, blob: {}, path: 'd1/5/module-x-1.png', kind: 'module', moduleId: 'x' });
    expect(calls.find((c) => c[0] === 'insert' && c[1].kind === 'module')[1]).toMatchObject({ module_id: 'x', width: null, height: null, camera: null, detail_hash: null });
  });

  test('saveRender — 스코프 없음·빈 입력·버킷 없음·행 거절(파일 정리)', async () => {
    S.PlannerStore._client = fakeClient().client;
    expect(await S.PlannerStore.saveRender({ ids: { designId: null, itemId: 5 }, blob: {}, path: 'p', kind: 'front' })).toMatchObject({ ok: false, reason: 'no-scope' });
    expect(await S.PlannerStore.saveRender({ ids, blob: null, path: 'p', kind: 'front' })).toEqual({ ok: false, reason: 'empty' });
    S.PlannerStore._client = fakeClient({ uploadError: 'Bucket not found' }).client;
    expect(await S.PlannerStore.saveRender({ ids, blob: {}, path: 'p', kind: 'front' })).toEqual({ ok: false, reason: 'no-bucket', message: 'Bucket not found' });
    const bad = fakeClient({ insertError: 'new row violates row-level security policy' });
    S.PlannerStore._client = bad.client;
    expect(await S.PlannerStore.saveRender({ ids, blob: {}, path: 'd1/5/p.png', kind: 'front' })).toMatchObject({ ok: false, reason: 'error', message: /row-level security/ });
    expect(bad.calls.find((c) => c[0] === 'remove')).toEqual(['remove', ['d1/5/p.png']]);   // 고아 파일 정리
  });

  test('listRenders — 이 품목 최근 순 + 서명 URL(1시간), kind 필터, 실패한 URL 은 null', async () => {
    const rows = [{ id: 'a', kind: 'front', path: 'd1/5/front-1.png', created_at: 'x' }, { id: 'b', kind: 'iso', path: 'd1/5/broken.png', created_at: 'y' }];
    const { client, calls } = fakeClient({ rows });
    S.PlannerStore._client = client;
    const r = await S.PlannerStore.listRenders(ids, { kind: 'front', limit: 1 });
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.url)).toEqual(['https://s/d1/5/front-1.png', null]);
    expect(calls.find((c) => c[0] === 'select')[1]).toBe('id, kind, module_id, path, width, height, camera, detail_hash, created_at');
    expect(calls.find((c) => c[0] === 'order')).toEqual(['order', 'created_at', { ascending: false }]);
    expect(calls.find((c) => c[0] === 'limit')).toEqual(['limit', 1, [['design_id', 'd1'], ['item_unique_id', 5], ['kind', 'front']]]);
    expect(calls.find((c) => c[0] === 'signed')).toEqual(['signed', ['d1/5/front-1.png', 'd1/5/broken.png'], 3600]);
    // 기본 12장, 서명 끄기
    const c2 = fakeClient({ rows });
    S.PlannerStore._client = c2.client;
    const r2 = await S.PlannerStore.listRenders(ids, { signed: false });
    expect(c2.calls.find((c) => c[0] === 'limit')[1]).toBe(12);
    expect(c2.calls.find((c) => c[0] === 'signed')).toBeUndefined();
    expect(r2.rows[0].url).toBeNull();
    expect(await S.PlannerStore.listRenders({ designId: null, itemId: 1 })).toMatchObject({ ok: false, reason: 'no-scope', rows: [] });
  });
});

// ── 최근 렌더 띠 · HTML 배선 ─────────────────────────────

describe('최근 렌더 띠', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('디테일 모드에 들어가면 listRenders 로 채운다 — 썸네일은 서명 URL, 스코프 없으면 이유 한 줄', async () => {
    const p = boot();
    const store = p.window.PlannerStore;
    const list = jest.spyOn(store, 'listRenders').mockResolvedValue({ ok: true, rows: [
      { id: 'a', kind: 'front', path: 'gold/1/front-1.png', width: 2048, height: 1365, created_at: new Date().toISOString(), url: 'https://s/front' },
      { id: 'b', kind: 'module', module_id: 'lower-0', path: 'gold/1/m.png', created_at: new Date().toISOString(), url: null },
    ] });
    p.document.getElementById('detailStageBtn').onclick();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(list).toHaveBeenCalledWith({ designId: 'gold', itemId: 1 }, { limit: 12 });
    const host = p.document.getElementById('detailRendersBody');
    const thumbs = host.querySelectorAll('.pc-thumb');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].tagName).toBe('A');
    expect(thumbs[0].getAttribute('href')).toBe('https://s/front');
    expect(thumbs[0].querySelector('img').getAttribute('src')).toBe('https://s/front');
    expect(thumbs[0].textContent).toMatch(/정면 · 오늘/);
    expect(thumbs[1].tagName).toBe('DIV');
    expect(thumbs[1].textContent).toMatch(/모듈 lower-0/);
    expect(p.document.getElementById('planner-capture-css')).not.toBeNull();
    // 섹션은 디테일 모드에서 보이는 목록에 든다
    const css = p.window.PlannerDetail && require('../js/planner/planner-detail').PLANNER_DETAIL_CSS;
    expect(css).toContain(':not([data-sec="detail-renders"])');
    // 이유 한 줄
    list.mockResolvedValue({ ok: false, reason: 'no-scope', rows: [] });
    await p.PC.refreshStrip();
    expect(host.textContent).toMatch(/설계를 저장하면/);
    list.mockResolvedValue({ ok: true, rows: [] });
    await p.PC.refreshStrip();
    expect(host.textContent).toMatch(/아직 없음/);
    host.querySelector('.pc-refresh').onclick();
    expect(list).toHaveBeenCalledTimes(4);
  });

  test('HTML 배선 — 버튼·메뉴·섹션·OutputPass·mount', () => {
    expect(HTML).toContain('id="renderSaveBtn"');
    expect(HTML).toContain('id="renderMenuBtn"');
    expect(HTML).toContain('id="renderMenu"');
    expect(HTML).toContain('data-sec="detail-renders"');
    expect(HTML).toContain('id="detailRendersBody"');
    expect(HTML).toContain("import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';");
    expect(HTML).toContain('window.OutputPass = OutputPass;');
    expect(HTML).toContain('PlannerCapture.mount({');
    expect(HTML).toContain('PlannerCapture.mountMenu({');
    // 렌더 버튼은 디테일 모드에서만 (pd-only) — 구조 모드 화면은 그대로 (I2)
    expect(HTML).toMatch(/class="pdm-btn pd-only" id="renderSaveBtn"/);
    // 화면 renderer 옵션은 그대로 — preserveDrawingBuffer 를 켜지 않는다
    expect(HTML).toContain('new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })');
    expect(HTML).not.toContain('preserveDrawingBuffer');
  });
});
