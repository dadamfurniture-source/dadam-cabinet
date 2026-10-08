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

// ── 2026-10-08: massing 프리셋 · clean 캡처 (계획서 planner-render-realize §5 · P1) ──────────

describe('massing 프리셋 (순수)', () => {
  const M = C.PLANNER_CAPTURE_MARGIN;
  const P = C.PLANNER_CAPTURE_MASSING;

  test('눈높이 1500 · 경계 중심을 향해 앞(+Z)에서 오른쪽으로 30° · 가로 화각 40° · 16:9', () => {
    const f = C.plannerCaptureFrame('massing', B, 1.5);
    expect(f.kind).toBe('massing');
    expect(P).toEqual({ eyeY: 1500, yawDeg: 30, hfov: 40, aspect: 16 / 9 });
    expect(f.position[1]).toBe(1500);
    expect(f.target).toEqual([1800, 1150, 300]);
    expect(f.up).toEqual([0, 1, 0]);
    // 수평 방위각 30°
    const yaw = Math.atan2(f.position[0] - 1800, f.position[2] - 300) * 180 / Math.PI;
    expect(yaw).toBeCloseTo(30, 9);
    // 종횡비는 넘긴 값과 무관하게 16:9, fov 는 세로 — 가로로 되돌리면 40°
    expect(f.aspect).toBeCloseTo(16 / 9, 12);
    const hfov = 2 * Math.atan(Math.tan((f.fov / 2) * Math.PI / 180) * f.aspect) * 180 / Math.PI;
    expect(hfov).toBeCloseTo(40, 9);
    expect(f.fov).toBeCloseTo(23.14, 2);
    expect(C.PLANNER_CAPTURE_FOV.massing).toBe(f.fov);
    expect(C.plannerCaptureFrame('massing', B, 0.5).position).toEqual(f.position);
    expect(C.plannerCaptureAspectFor('massing', B, 1.2)).toBeCloseTo(16 / 9, 12);
    expect(C.plannerCaptureParseKind('massing')).toEqual({ kind: 'massing', moduleId: null });
    expect(C.plannerCaptureFileName('massing', null, new Date(2026, 9, 8, 9, 0, 0))).toBe('massing-20261008090000.png');
  });

  test('가구 전체가 여백 8% 안에 들어오는 가장 가까운 거리 — 3% 더 다가가면 넘친다', () => {
    for (const bounds of [B, { min: { x: -1200, y: 0, z: -325 }, max: { x: 1200, y: 870, z: 325 } }, { min: { x: 0, y: 0, z: 0 }, max: { x: 600, y: 2300, z: 650 } }]) {
      const f = C.plannerCaptureFrame('massing', bounds, 16 / 9);
      const corners = C.plannerCaptureCorners(bounds);
      expect(corners).toHaveLength(8);
      expect(C.plannerCaptureFits(f.position, f.target, f.up, f.fov, f.aspect, corners, M, 10)).toBe(true);
      const c = f.target, d = f.dist * 0.97, yaw = 30 * Math.PI / 180;
      const closer = [c[0] + Math.sin(yaw) * d, 1500, c[2] + Math.cos(yaw) * d];
      expect(C.plannerCaptureFits(closer, f.target, f.up, f.fov, f.aspect, corners, M, 10)).toBe(false);
      expect(f.far).toBeGreaterThan(f.dist * 2);
    }
  });

  test('plannerCaptureFits 는 three 카메라 투영과 같은 판정이다', () => {
    const f = C.plannerCaptureFrame('massing', B, 16 / 9);
    const cam = new THREE.PerspectiveCamera(f.fov, f.aspect, 10, f.far);
    cam.position.set(...f.position);
    cam.up.set(...f.up);
    cam.lookAt(...f.target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    C.plannerCaptureCorners(B).forEach((p) => {
      const v = new THREE.Vector3(...p).project(cam);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(1 / C.PLANNER_CAPTURE_MARGIN + 1e-9);
      expect(Math.abs(v.y)).toBeLessThanOrEqual(1 / C.PLANNER_CAPTURE_MARGIN + 1e-9);
    });
  });

  test('camera JSON — fov 는 소수 둘째 자리, clean 이면 clean:true', () => {
    const f = C.plannerCaptureFrame('massing', B, 16 / 9);
    const j = C.plannerCaptureCameraJson(f, 1024, null, true);
    expect(j).toMatchObject({ kind: 'massing', fov: 23.14, aspect: 1.778, position: [Math.round(f.position[0]), 1500, Math.round(f.position[2])], clean: true, longEdge: 1024 });
    expect(C.plannerCaptureCameraJson(f, 1024, null)).not.toHaveProperty('clean');
  });
});

describe('clean 캡처 — 순수 판정', () => {
  test('그림자 프러스텀 — 조명 축에 투영한 꼭짓점(+ 바닥까지 민 점)이 다 들어온다 · three 그림자 카메라와 같은 축', () => {
    const light = [5000, 8000, 5000], target = [0, 0, 0];
    const fr = C.plannerCaptureShadowFrustum(light, target, B, 50, 0);
    // 기본값(±5 · 0.5~500)과 비교도 안 되게 넓고, 깊이는 조명~가구 거리(약 7~12m)를 덮는다
    expect(fr.right - fr.left).toBeGreaterThan(2000);
    expect(fr.near).toBeGreaterThan(500);
    expect(fr.far).toBeGreaterThan(fr.near);
    // three 의 직교 카메라를 같은 자리에 세워 꼭짓점을 투영해 본다
    const cam = new THREE.OrthographicCamera(fr.left, fr.right, fr.top, fr.bottom, fr.near, fr.far);
    cam.position.set(...light);
    cam.lookAt(...target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    const dir = new THREE.Vector3(...target).sub(new THREE.Vector3(...light)).normalize();
    C.plannerCaptureCorners(B).forEach((p) => {
      const v = new THREE.Vector3(...p).project(cam);
      [v.x, v.y, v.z].forEach((x) => { expect(x).toBeGreaterThanOrEqual(-1); expect(x).toBeLessThanOrEqual(1); });
      // 바닥에 떨어지는 그림자 점도 깊이 안에 든다
      const t = (0 - p[1]) / dir.y;
      const q = new THREE.Vector3(...p).addScaledVector(dir, t).project(cam);
      expect(q.z).toBeLessThanOrEqual(1);
    });
    // 여유는 pad 만큼만 — 너무 넓으면 흐려진다
    const tight = C.plannerCaptureShadowFrustum(light, target, B, 0, 0);
    expect(fr.left).toBeCloseTo(tight.left - 50, 6);
    expect(fr.top).toBeCloseTo(tight.top + 50, 6);
    expect(C.plannerCaptureShadowFrustum(light, target, null)).toBeNull();
    // 바로 위에서 비추는 빛도 축을 만든다 (three lookAt 의 틀기 규칙)
    const down = C.plannerCaptureShadowFrustum([1800, 9000, 300], [1800, 0, 300], B, 0, 0);
    expect(down.right - down.left).toBeGreaterThan(0);
    expect(down.near).toBeCloseTo(9000 - 2300, 0);   // 축을 0.0001 틀어서 0.03mm 어긋난다
  });

  test('cleanTargets — 그리드·바닥 판·배치 상자·그 윤곽선·선택 테두리·원점 마커·가전 마커는 숨김, 조명·부재·부재 테두리는 둔다', () => {
    const s = cleanScene();
    const sel = C.plannerCaptureCleanTargets(s.scene, s.mg);
    const hidden = new Set(sel.hide);
    [s.grid, s.ground, s.area, s.areaEdge, s.pick, s.origin, s.sinkBox, s.sinkEdge, s.hoodBox].forEach((o) => expect(hidden.has(o)).toBe(true));
    [s.amb, s.d1, s.d2, s.mg, s.lower, s.body, s.counter, s.bodyEdge, s.upper, s.sink, s.hood].forEach((o) => expect(hidden.has(o)).toBe(false));
    expect(sel.markers.map((m) => [m.section, m.moduleId, m.group])).toEqual([['sink', 'sink-0', s.sink], ['hood', 'hood-0', s.hood]]);
    // 이미 숨은 것은 고르지 않는다 (되돌릴 때 켜 버리면 안 된다)
    s.grid.visible = false;
    expect(C.plannerCaptureCleanTargets(s.scene, s.mg).hide).not.toContain(s.grid);
    expect(C.plannerCaptureCleanTargets(null, null)).toEqual({ hide: [], markers: [] });
  });

  test('가전 대역 — 싱크는 상판 위 볼·수전, 후드·냉장고·식세기는 자리 그대로 불투명 상자, 모르는 섹션은 없음', () => {
    const sink = C.plannerCaptureStandInSpec('sink', { W: 700, H: 500, D: 400, baseY: 0 }, { top: 870, zMin: -225, zMax: 425 });
    expect(sink.map((x) => x.part)).toEqual(['bowl', 'faucet', 'spout']);
    const [bowl, faucet, spout] = sink;
    expect(bowl.pos[1] - bowl.size[1] / 2).toBe(870);             // 상판 윗면에 앉는다
    expect(bowl.pos[2]).toBe(100);                                 // 상판 앞뒤 가운데
    expect(bowl.size[0]).toBe(620);
    expect(bowl.pos[2] - bowl.size[2] / 2).toBeGreaterThan(-225);  // 상판 안
    expect(bowl.pos[2] + bowl.size[2] / 2).toBeLessThan(425);
    expect(faucet.pos[1] - faucet.size[1] / 2).toBe(870);
    expect(faucet.pos[2]).toBeLessThan(bowl.pos[2] - bowl.size[2] / 2);   // 볼 뒤
    expect(spout.pos[2]).toBeGreaterThan(faucet.pos[2]);                  // 앞으로 나온다
    expect(bowl.color).toBe(C.PLANNER_CAPTURE_STANDIN_COLOR.bowl);
    // 상판을 못 찾으면 870 − 마커 그룹 높이
    expect(C.plannerCaptureStandInSpec('sink', { W: 700, H: 500, D: 400, baseY: 100 }, null)[0].pos[1]).toBe(870 - 100 + 3);
    expect(C.plannerCaptureStandInSpec('hood', { W: 900, H: 300, D: 350 }, null)).toEqual([expect.objectContaining({ part: 'hood', size: [900, 300, 350], pos: [0, 150, 0] })]);
    expect(C.plannerCaptureStandInSpec('refrigerator', { W: 720, H: 1870, D: 700 }, null)[0]).toMatchObject({ size: [720, 1870, 700], pos: [0, 935, 0] });
    expect(C.plannerCaptureStandInSpec('dishwasher', { W: 600, H: 820, D: 650 }, null)[0]).toMatchObject({ part: 'dishwasher', size: [600, 820, 650] });
    expect(C.plannerCaptureStandInSpec('cooktop', { W: 700, H: 10, D: 600 }, { top: 870, zMin: -300, zMax: 300 })[0]).toMatchObject({ part: 'cooktop', pos: [0, 874, 0] });
    expect(C.plannerCaptureStandInSpec('lower', { W: 600, H: 870, D: 650 }, null)).toEqual([]);
    expect(C.plannerCaptureStandInSpec('sink', null, null)).toEqual([]);
  });

  test('흰 배경 얹기 — 알파 0 은 흰색, 255 는 그대로, 중간은 rgb + (1−a)·255 · 끝나면 알파 255', () => {
    const px = new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 255, 50, 50, 50, 128, 0, 0, 0, 56]);
    C.plannerCaptureOverWhite(px);
    expect(Array.from(px)).toEqual([255, 255, 255, 255, 10, 20, 30, 255, 177, 177, 177, 255, 199, 199, 199, 255]);
    const raw = new Uint8Array([1, 1, 1, 7, 2, 2, 2, 9]);
    expect(Array.from(C.plannerCaptureFlipRows(raw, 1, 2, true))).toEqual([2, 2, 2, 9, 1, 1, 1, 7]);
  });
});

/**
 * mockup-structure.html init3D · renderAll3D 가 만드는 모양을 줄인 것.
 * 하부장(상판 윗면 870, 깊이 650) 위에 분배기 마커(바닥~500), 천장 아래 후드 마커, 상부장, 배치 상자·윤곽선·선택 테두리·원점 마커.
 */
function cleanScene() {
  const box = (w, h, d, ud) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial()); m.userData = ud || {}; return m; };
  const line = (geo, ud) => { const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial()); if (ud) l.userData = ud; return l; };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4efe7);
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  const d1 = new THREE.DirectionalLight(0xffffff, 1.8);
  d1.position.set(5000, 8000, 5000); d1.castShadow = true; d1.shadow.mapSize.set(1024, 1024);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.6);
  d2.position.set(-3000, 4000, -3000);
  scene.add(amb, d1, d2);
  const grid = new THREE.GridHelper(6000, 30, 0xb8956c, 0xe5e0d4);
  scene.add(grid);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial());
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5;
  scene.add(ground);
  const mg = new THREE.Group();
  scene.add(mg);
  const area = box(4000, 870, 650, { entityKind: 'area', areaId: 'a' });
  area.position.set(600, 435, 0);
  mg.add(area);
  const areaEdge = line(new THREE.EdgesGeometry(area.geometry), { entityKind: 'edge' });
  mg.add(areaEdge);
  // 하부장 — x 0~1200, 상판 윗면 870
  const lower = new THREE.Group();
  lower.userData = { entityKind: 'module', moduleId: 'lower-0' };
  lower.position.set(600, 0, 0);
  mg.add(lower);
  const body = box(1200, 858, 650, { entityKind: 'carcass', moduleId: 'lower-0' });
  body.position.y = 429;
  lower.add(body);
  const counter = box(1200, 12, 650, { entityKind: 'top-panel', moduleId: 'lower-0' });
  counter.position.y = 864;
  lower.add(counter);
  const bodyEdge = line(new THREE.EdgesGeometry(body.geometry), { entityKind: 'edge' });
  bodyEdge.position.copy(body.position);
  lower.add(bodyEdge);
  // 상부장 — 1500~2220
  const upper = new THREE.Group();
  upper.userData = { entityKind: 'module', moduleId: 'upper-0' };
  upper.position.set(600, 1500, -160);
  mg.add(upper);
  const ubody = box(1200, 720, 330, { entityKind: 'carcass', moduleId: 'upper-0' });
  ubody.position.y = 360;
  upper.add(ubody);
  // 분배기(싱크) 마커 — buildMarkerMesh 처럼 그룹 로컬 (0, H/2, 0), 바닥부터 500
  const sink = new THREE.Group();
  sink.userData = { entityKind: 'module', moduleId: 'sink-0' };
  sink.position.set(600, 0, -100);
  mg.add(sink);
  const sinkBox = box(700, 500, 400, { entityKind: 'marker', moduleId: 'sink-0', section: 'sink' });
  sinkBox.material.transparent = true; sinkBox.material.opacity = 0.35;
  sinkBox.position.y = 250;
  sink.add(sinkBox);
  const sinkEdge = line(new THREE.EdgesGeometry(sinkBox.geometry), { entityKind: 'edge' });
  sinkEdge.position.copy(sinkBox.position);
  sink.add(sinkEdge);
  // 후드 마커 — 천장(2300) 아래 300
  const hood = new THREE.Group();
  hood.userData = { entityKind: 'module', moduleId: 'hood-0' };
  hood.position.set(600, 2000, -150);
  mg.add(hood);
  const hoodBox = box(600, 300, 300, { entityKind: 'marker', moduleId: 'hood-0', section: 'hood' });
  hoodBox.position.y = 150;
  hood.add(hoodBox);
  const pick = line(new THREE.EdgesGeometry(new THREE.BoxGeometry(1206, 876, 656)), { entityKind: 'pick', moduleId: 'lower-0' });
  mg.add(pick);
  const origin = line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200, 0, 0), new THREE.Vector3(200, 0, 0)]));
  mg.add(origin);
  return { scene, mg, amb, d1, d2, grid, ground, area, areaEdge, lower, body, counter, bodyEdge, upper, sink, sinkBox, sinkEdge, hood, hoodBox, pick, origin };
}

/** fakeRenderer + 지우기 색·그림자 지도. 읽는 픽셀은 짝수 칸이 불투명 회색(100), 홀수 칸이 알파 0. */
function cleanRenderer(opt = {}) {
  const r = fakeRenderer(opt);
  r._clear = new THREE.Color(0x123456);
  r._clearAlpha = 0.5;
  r.getClearColor = (c) => c.copy(r._clear);
  r.getClearAlpha = () => r._clearAlpha;
  r.setClearColor = (c, a) => { r._clear = new THREE.Color(c); if (a !== undefined) r._clearAlpha = a; };
  r.shadowMap = { enabled: false, needsUpdate: false, type: THREE.PCFShadowMap };
  r.readRenderTargetPixels = (rt, x, y, w, h, buf) => {
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (i % 2 === 0) { buf[o] = 100; buf[o + 1] = 100; buf[o + 2] = 100; buf[o + 3] = 255; } else { buf[o] = 0; buf[o + 1] = 0; buf[o + 2] = 0; buf[o + 3] = 0; }
    }
  };
  return r;
}

/** 작업 화면 상태 — visible(uuid 별)·자식 수·배경·지우기 색·그림자 카메라·bias·shadowMap */
function workState(s, r) {
  const vis = [];
  s.scene.traverse((o) => vis.push([o.uuid, o.visible]));
  const c = s.d1.shadow.camera;
  return {
    vis,
    bg: s.scene.background,
    bgHex: s.scene.background ? s.scene.background.getHex() : null,
    clear: [r._clear.getHex(), r._clearAlpha],
    cam: [c.left, c.right, c.top, c.bottom, c.near, c.far],
    proj: Array.from(c.projectionMatrix.elements),
    bias: [s.d1.shadow.bias, s.d1.shadow.normalBias],
    shadowMap: [r.shadowMap.enabled, r.shadowMap.needsUpdate],
    mats: [s.sinkBox.material, s.body.material],
  };
}

describe('clean 캡처 — 찍는 순간만 바뀌고, 끝나면(던져도) 작업 화면 그대로', () => {
  const PC = C.PlannerCapture;
  beforeEach(() => {
    window.THREE = THREE;
    PC._encode = (px, w, h) => ({ type: 'image/png', w, h, px });
    PC._outputPass = null;
    // 톤매핑 패스는 렌더타깃만 바꾼다 — 픽셀 값을 그대로 보게 (sRGB 폴백 곡선을 피한다)
    window.OutputPass = class { render(renderer, write) { renderer.setRenderTarget(write); } };
  });
  afterEach(() => { window.THREE = undefined; PC._encode = null; PC._outputPass = null; delete window.OutputPass; PC.mount(null); jest.restoreAllMocks(); });

  function mountClean(opt = {}) {
    const s = cleanScene();
    const seen = [];
    const r = cleanRenderer({
      onRender(scene, cam, rr) {
        const standins = [];
        scene.traverse((o) => { if (o.userData && o.userData.entityKind === 'standin' && o.isMesh) standins.push(o); });
        const sc = s.d1.shadow.camera;
        seen.push({
          bg: scene.background, clearAlpha: rr._clearAlpha, shadowMap: rr.shadowMap.enabled,
          visible: { grid: s.grid.visible, ground: s.ground.visible, area: s.area.visible, areaEdge: s.areaEdge.visible, pick: s.pick.visible, origin: s.origin.visible, sinkBox: s.sinkBox.visible, sinkEdge: s.sinkEdge.visible, hoodBox: s.hoodBox.visible, body: s.body.visible, bodyEdge: s.bodyEdge.visible, upper: s.upper.visible },
          standins: standins.map((m) => { m.updateWorldMatrix(true, false); const b = new THREE.Box3().setFromObject(m); return { part: m.userData.part, min: b.min.clone(), max: b.max.clone(), opaque: !m.material.transparent, shadowMat: !!m.material.isShadowMaterial }; }),
          shadowCam: [sc.left, sc.right, sc.top, sc.bottom, sc.near, sc.far],
          d2Cast: s.d2.castShadow,
          fov: cam.fov,
        });
        if (opt.onRender) opt.onRender(scene, cam, rr);
      },
    });
    PC.mount({ three: () => ({ renderer: r, scene: s.scene, moduleGroup: s.mg }) });
    return { s, r, seen };
  }

  test('massing + clean: 흰 배경 · 숨김 · 가전 대역 · 그림자 프러스텀, 돌아오면 visible·배경·지우기 색·그림자 전부 같다', () => {
    const { s, r, seen } = mountClean();
    const before = workState(s, r);
    const shot = PC.capturePixels({ kind: 'massing', longEdge: 64, clean: true });
    expect(shot.ok).toBe(true);
    expect(shot.clean).toBe(true);
    expect(shot.kind).toBe('massing');
    expect([shot.width, shot.height]).toEqual([64, 36]);   // 16:9
    expect(shot.camera).toMatchObject({ kind: 'massing', clean: true, fov: 23.14 });
    expect(shot.camera.position[1]).toBe(1500);
    // 찍는 순간
    expect(seen).toHaveLength(1);
    const w = seen[0];
    expect(w.bg).toBeNull();
    expect(w.clearAlpha).toBe(0);
    expect(w.shadowMap).toBe(true);
    expect(w.visible).toEqual({ grid: false, ground: false, area: false, areaEdge: false, pick: false, origin: false, sinkBox: false, sinkEdge: false, hoodBox: false, body: true, bodyEdge: true, upper: true });
    const part = (p) => w.standins.find((x) => x.part === p);
    expect(w.standins.map((x) => x.part).sort()).toEqual(['bowl', 'faucet', 'hood', 'shadow-catcher', 'spout']);
    // 싱크 볼은 하부장 상판(870) 위, 상판 앞뒤 가운데 (세계 z 0) — 마커 상자(바닥~500)가 아니다
    expect(part('bowl').min.y).toBeCloseTo(870, 6);
    expect((part('bowl').min.z + part('bowl').max.z) / 2).toBeCloseTo(0, 6);
    expect(part('faucet').max.y).toBeCloseTo(1170, 6);
    // 후드는 마커 자리 그대로 (2000~2300), 불투명
    expect([part('hood').min.y, part('hood').max.y]).toEqual([2000, 2300]);
    expect(part('hood').opaque).toBe(true);
    // 바닥 그림자 받이 — y 0, 그림자만 받는 재질
    expect(part('shadow-catcher').shadowMat).toBe(true);
    expect(part('shadow-catcher').min.y).toBeCloseTo(0, 6);
    // 그림자 카메라가 mm 경계에 맞았다 (기본은 ±5 · 0.5~500)
    expect(w.shadowCam[1] - w.shadowCam[0]).toBeGreaterThan(1000);
    expect(w.shadowCam[5]).toBeGreaterThan(5000);
    expect(w.d2Cast).toBe(false);   // 그림자 없는 보조광은 건드리지 않는다
    // 픽셀 — 알파 0 칸은 흰색, 불투명 칸은 그대로, 알파는 전부 255
    expect(Array.from(shot.pixels.slice(0, 8))).toEqual([100, 100, 100, 255, 255, 255, 255, 255]);
    expect(shot.pixels.every((v, i) => i % 4 !== 3 || v === 255)).toBe(true);
    // 돌아온 뒤 — 전부 원래 값
    expect(workState(s, r)).toEqual(before);
    expect(s.scene.background).toBe(before.bg);
    expect(s.sink.children).toEqual([s.sinkBox, s.sinkEdge]);
    expect(s.hood.children).toEqual([s.hoodBox]);
    expect(s.scene.children.length).toBe(6);
    expect(r._rt).toBeNull();
  });

  test('clean 이 아니면 아무것도 숨기지 않는다 — 배경·그리드·마커·그림자 카메라 그대로 찍는다 (기존 렌더 저장 불변)', () => {
    const { s, r, seen } = mountClean();
    const before = workState(s, r);
    const shot = PC.capturePixels({ kind: 'iso', longEdge: 64 });
    expect(shot.ok).toBe(true);
    expect(shot.clean).toBe(false);
    expect(shot.camera).not.toHaveProperty('clean');
    expect(seen[0].bg).toBe(before.bg);
    expect(seen[0].clearAlpha).toBe(0.5);
    expect(Object.values(seen[0].visible).every(Boolean)).toBe(true);
    expect(seen[0].standins).toEqual([]);
    expect(seen[0].shadowCam).toEqual(before.cam);
    expect(Array.from(shot.pixels.slice(0, 8))).toEqual([100, 100, 100, 255, 0, 0, 0, 255]);   // 알파만 255
    expect(workState(s, r)).toEqual(before);
  });

  test('렌더가 던져도 · 그림자 맞춤이 던져도 · 경계가 비어도 되돌린다', () => {
    const boom = mountClean({ onRender() { throw new Error('gl lost'); } });
    const b1 = workState(boom.s, boom.r);
    expect(PC.capturePixels({ kind: 'massing', longEdge: 64, clean: true })).toEqual({ ok: false, reason: 'error', message: 'gl lost' });
    expect(boom.seen).toHaveLength(1);   // 바뀐 상태로 렌더까지 갔다
    expect(workState(boom.s, boom.r)).toEqual(b1);
    expect(boom.r._rt).toBeNull();

    // 그림자 카메라의 투영 갱신이 던진다 — 값은 바꾼 뒤라 되돌려야 한다
    const half = mountClean();
    const b2 = workState(half.s, half.r);
    let calls = 0;
    const orig = half.s.d1.shadow.camera.updateProjectionMatrix.bind(half.s.d1.shadow.camera);
    half.s.d1.shadow.camera.updateProjectionMatrix = () => { calls++; if (calls === 1) throw new Error('proj'); return orig(); };
    expect(PC.capturePixels({ kind: 'front', longEdge: 64, clean: true })).toMatchObject({ ok: false, reason: 'error', message: 'proj' });
    expect(half.seen).toHaveLength(0);
    delete half.s.d1.shadow.camera.updateProjectionMatrix;
    expect(workState(half.s, half.r)).toEqual(b2);

    // 숨기고 나니 찍을 것이 없다 (마커뿐인 모듈) — empty 로 돌아오고 되돌린다
    const only = mountClean();
    const b3 = workState(only.s, only.r);
    only.s.mg.remove(only.s.lower, only.s.upper, only.s.sink, only.s.hood);
    const b3b = workState(only.s, only.r);
    expect(PC.capturePixels({ kind: 'front', longEdge: 64, clean: true })).toMatchObject({ ok: false, reason: 'empty' });
    expect(workState(only.s, only.r)).toEqual(b3b);
    expect(b3.vis.length).toBeGreaterThan(b3b.vis.length);
  });

  test('capture({clean}) → PNG 결과에 clean · 모듈 하나(module:<id>)도 clean 으로 찍힌다', async () => {
    const { s, r } = mountClean();
    const before = workState(s, r);
    const one = await PC.capture({ kind: 'massing', longEdge: 32, clean: true, date: new Date(2026, 9, 8, 9, 0, 0) });
    expect(one).toMatchObject({ ok: true, kind: 'massing', clean: true, fileName: 'massing-20261008090000.png', width: 32, height: 18 });
    expect(one.camera.clean).toBe(true);
    const mod = PC.capturePixels({ kind: 'module:sink-0', longEdge: 32, clean: true });
    expect(mod.ok).toBe(true);   // 마커 모듈 하나 — 대역으로 경계를 잰다
    expect(mod.camera.target[1]).toBeGreaterThan(870);
    expect(workState(s, r)).toEqual(before);
  });
});

describe('clean 캡처 — 페이지 부팅(디테일 룩과 함께)', () => {
  afterEach(() => { window.THREE = undefined; });

  test('구조 모드에서 clean 으로 찍어도 룩·배경·그리드·조명·재질이 다 원래대로', () => {
    const p = boot();
    const f = fakeThree(p);
    p.PD.detail.parts[f.moduleId] = { 'door#0': { code: 'PET-OAK-M' } };
    f.scene.background = new THREE.Color(0xf4efe7);
    const grid = new THREE.GridHelper(6000, 30);
    f.scene.add(grid);
    f.lights.d1.position.set(5000, 8000, 5000);
    f.lights.d1.castShadow = true;
    const cam0 = [f.lights.d1.shadow.camera.left, f.lights.d1.shadow.camera.far];
    const before = { bg: f.scene.background, tone: f.renderer.toneMapping, env: f.scene.environment, amb: f.lights.amb.intensity, d1: f.lights.d1.intensity, doorMat: f.door.material };
    const during = [];
    f.renderer.render = function (scene) {
      during.push({ bg: scene.background, grid: grid.visible, tone: this.toneMapping, doorMat: f.door.material.constructor.name, far: f.lights.d1.shadow.camera.far });
    };
    const shot = p.PC.capturePixels({ kind: 'massing', longEdge: 64, clean: true });
    expect(shot.ok).toBe(true);
    expect(during[0]).toMatchObject({ bg: null, grid: false, tone: THREE.ACESFilmicToneMapping, doorMat: 'MeshPhysicalMaterial' });
    expect(during[0].far).toBeGreaterThan(5000);
    expect(f.scene.background).toBe(before.bg);
    expect(grid.visible).toBe(true);
    expect(f.renderer.toneMapping).toBe(before.tone);
    expect(f.scene.environment).toBe(before.env);
    expect(f.lights.amb.intensity).toBe(before.amb);
    expect(f.lights.d1.intensity).toBe(before.d1);
    expect(f.door.material).toBe(before.doorMat);
    expect([f.lights.d1.shadow.camera.left, f.lights.d1.shadow.camera.far]).toEqual(cam0);
    expect(f.scene.children.filter((o) => o.userData && o.userData.entityKind === 'standin')).toEqual([]);
    expect(p.PD._sceneSaved).toBeNull();
  });
});
