/**
 * D2: 코드별 PBR 재질 (js/planner/planner-materials.js).
 *
 *   · tone → roughness/clearcoat (matte 0.75/0 · gloss 0.25/0.6 · single·null → matte), 행 값이 있으면 우선
 *   · 같은 코드는 같은 MeshPhysicalMaterial (캐시), dispose 로 비운다
 *   · 색은 sRGB hex 로 들어가 linear 로 저장된다 (ColorManagement)
 *   · 텍스처: textureUrl 이 없으면 로더를 만들지도 않고 공유 재질 그대로 (no-op) · repeat 계산은 순수
 *   · 텍스처가 있으면 sRGB·RepeatWrapping 으로 한 번 읽고 mesh 마다 사본에 repeat/rotation, dispose 가 사본까지 놓는다
 *
 * three 는 node 빌드(three.cjs)를 그대로 쓴다 — MeshPhysicalMaterial·Color 는 WebGL 없이 만들어진다.
 */
const THREE = require('three');
const M = require('../js/planner/planner-materials');
const { PlannerMaterials } = M;

const OAK_M = { code: 'YR-SM-02', hex: '#d1b089', tone: 'matte' };
const OAK_G = { code: 'YR-SG-02', hex: '#d1b089', tone: 'gloss' };

beforeEach(() => { PlannerMaterials.dispose(); });

describe('params (순수)', () => {
  test('tone 기본값 — matte / gloss / single·null 은 matte', () => {
    expect(M.plannerMaterialsParams(OAK_M)).toMatchObject({ tone: 'matte', roughness: 0.75, metalness: 0, clearcoat: 0, clearcoatRoughness: 0, sheen: 0, hex: '#d1b089' });
    expect(M.plannerMaterialsParams(OAK_G)).toMatchObject({ tone: 'gloss', roughness: 0.25, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 });
    expect(M.plannerMaterialsParams({ code: 'x', hex: '#000000', tone: 'single' }).tone).toBe('matte');
    expect(M.plannerMaterialsParams({ code: 'x', hex: '#000000' }).tone).toBe('matte');
    expect(M.plannerMaterialsToneOf(undefined)).toBe('matte');
  });
  test('행의 roughness/metalness/clearcoat 가 있으면 tone 기본값보다 우선, 0~1 로 자른다', () => {
    const p = M.plannerMaterialsParams({ code: 'x', hex: '#ffffff', tone: 'matte', roughness: 0.6, metalness: '0.2', clearcoat: 0.3 });
    expect(p).toMatchObject({ roughness: 0.6, metalness: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.15 });
    expect(M.plannerMaterialsParams({ code: 'x', hex: '#ffffff', tone: 'gloss', roughness: 7, clearcoat: -1 })).toMatchObject({ roughness: 1, clearcoat: 0, clearcoatRoughness: 0 });
    expect(M.plannerMaterialsParams({ code: 'x', hex: '#ffffff', roughness: null, clearcoat: 'abc' })).toMatchObject({ roughness: 0.75, clearcoat: 0 });
  });
  test('hex 가 아니면 회색', () => {
    expect(M.plannerMaterialsParams({ code: 'x', hex: 'oops' }).hex).toBe('#cccccc');
    expect(M.plannerMaterialsParams({ code: 'x', hex: '#ABCDEF' }).hex).toBe('#abcdef');
  });
});

describe('get — MeshPhysicalMaterial 캐시', () => {
  test('코드별 재질, 같은 코드는 같은 객체, 색은 sRGB → linear', () => {
    const a = PlannerMaterials.get(OAK_M, THREE);
    expect(a).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(a.roughness).toBe(0.75);
    expect(a.clearcoat).toBe(0);
    expect(a.sheen).toBe(0);
    expect(a.name).toBe('finish:YR-SM-02');
    expect(a.userData).toEqual({ code: 'YR-SM-02', tone: 'matte', hex: '#d1b089' });
    expect(THREE.ColorManagement.enabled).toBe(true);
    // 저장은 linear — 다시 sRGB 로 읽으면 원래 hex
    expect('#' + a.color.getHexString(THREE.SRGBColorSpace)).toBe('#d1b089');
    expect(a.color.r).toBeLessThan(0.82);   // linear 값은 sRGB(0xd1/255=0.82) 보다 작다
    expect(PlannerMaterials.get(OAK_M, THREE)).toBe(a);
    const g = PlannerMaterials.get(OAK_G, THREE);
    expect(g).not.toBe(a);
    expect(g.roughness).toBe(0.25);
    expect(g.clearcoat).toBe(0.6);
    expect(g.clearcoatRoughness).toBe(0.15);
    expect(PlannerMaterials.size()).toBe(2);
  });
  test('three 가 없거나 항목이 없으면 null', () => {
    const had = window.THREE;
    window.THREE = undefined;
    try {
      expect(PlannerMaterials.get(OAK_M)).toBeNull();
      expect(PlannerMaterials.get(null, THREE)).toBeNull();
      expect(PlannerMaterials.get({ hex: '#fff' }, THREE)).toBeNull();
    } finally { window.THREE = had; }
  });
  test('window.THREE 를 기본으로 쓴다', () => {
    window.THREE = THREE;
    try { expect(PlannerMaterials.get(OAK_M)).toBeInstanceOf(THREE.MeshPhysicalMaterial); }
    finally { window.THREE = undefined; }
  });
  test('dispose 는 캐시를 비우고 재질을 놓는다', () => {
    const a = PlannerMaterials.get(OAK_M, THREE);
    const spy = jest.spyOn(a, 'dispose');
    PlannerMaterials.dispose();
    expect(spy).toHaveBeenCalled();
    expect(PlannerMaterials.size()).toBe(0);
    expect(PlannerMaterials.get(OAK_M, THREE)).not.toBe(a);
  });
});

describe('텍스처 훅', () => {
  test('textureUrl 이 없으면 로더를 만들지 않고 공유 재질 그대로 (no-op)', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(600, 720, 18), new THREE.MeshStandardMaterial());
    const shared = PlannerMaterials.get(OAK_M, THREE);
    expect(PlannerMaterials.forMesh(OAK_M, mesh, THREE)).toBe(shared);
    expect(PlannerMaterials.forMesh(Object.assign({ textureUrl: null, tileMm: 300, grain: 'v' }, OAK_M), mesh, THREE)).toBe(shared);
    expect(PlannerMaterials._loader).toBeNull();
    expect(shared.map).toBeNull();
    expect(PlannerMaterials.texture(null, THREE)).toBeNull();
  });
  test('textureUrl 이 있으면 한 번만 읽고(sRGB·Repeat) mesh 마다 사본에 repeat 를 건다', () => {
    const fakeTex = () => { const t = new THREE.Texture(); return t; };
    const loads = [];
    PlannerMaterials._loader = { load(url) { loads.push(url); return fakeTex(); } };
    const entry = Object.assign({}, OAK_M, { code: 'YR-TEX', textureUrl: 'https://x/oak.jpg', tileMm: 300, grain: 'v' });
    const door = new THREE.Mesh(new THREE.BoxGeometry(600, 900, 18), new THREE.MeshStandardMaterial());   // 세로 부재
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(600, 18, 300), new THREE.MeshStandardMaterial()); // 누운 부재
    const m1 = PlannerMaterials.forMesh(entry, door, THREE);
    const m2 = PlannerMaterials.forMesh(entry, shelf, THREE);
    expect(loads).toEqual(['https://x/oak.jpg']);
    const tex = PlannerMaterials._textures['https://x/oak.jpg'];
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(m1).not.toBe(PlannerMaterials.get(entry, THREE));   // 사본
    expect(m1).not.toBe(m2);
    expect(m1.map.repeat.x).toBeCloseTo(2);   // 600/300
    expect(m1.map.repeat.y).toBeCloseTo(3);   // 900/300
    expect(m1.map.rotation).toBe(0);
    // 누운 부재 + 세로 결 → 90° 돌리고 축을 바꾼다 (600×300 → x 1, y 2)
    expect(m2.map.rotation).toBeCloseTo(Math.PI / 2);
    expect(m2.map.repeat.x).toBeCloseTo(1);
    expect(m2.map.repeat.y).toBeCloseTo(2);
    expect(m1.userData.perMesh).toBe(true);
    PlannerMaterials.dispose();
    expect(PlannerMaterials._textures).toEqual({});
    PlannerMaterials._loader = null;
  });
  test('씌운 map 은 sRGB·Repeat 를 그대로 물려받는다 (색공간이 틀리면 나무가 바래 보인다)', () => {
    PlannerMaterials._loader = { load() { return new THREE.Texture(); } };
    const entry = { code: 'YR-MFB-303', hex: '#a56c43', tone: 'matte', textureUrl: 'assets/materials/yerim/YR-MFB-303.jpg', tileMm: 600, grain: 'v' };
    const door = new THREE.Mesh(new THREE.BoxGeometry(600, 720, 18));
    const mat = PlannerMaterials.forMesh(entry, door, THREE);
    expect(mat.map).not.toBeNull();
    expect(mat.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mat.map.wrapS).toBe(THREE.RepeatWrapping);
    expect(mat.map.wrapT).toBe(THREE.RepeatWrapping);
    expect(mat.map.center.x).toBe(0.5);
    expect(mat.map.center.y).toBe(0.5);
    expect(mat.map.version).toBeGreaterThan(0);   // needsUpdate = true 가 올린 판번호
    // 도어 600×720 / 타일 600mm → 가로 1번, 세로 1.2번
    expect(mat.map.repeat.x).toBeCloseTo(1);
    expect(mat.map.repeat.y).toBeCloseTo(1.2);
    // 사본이어도 색·거칠기는 공유 재질과 같다 (텍스처를 못 읽으면 이 색이 대체색)
    expect(mat.roughness).toBe(0.75);
    expect('#' + mat.color.getHexString(THREE.SRGBColorSpace)).toBe('#a56c43');
    PlannerMaterials.dispose();
    PlannerMaterials._loader = null;
  });
  test('무지 자재(grain none)는 돌리지 않고 tileMm 대로만 깐다', () => {
    PlannerMaterials._loader = { load() { return new THREE.Texture(); } };
    const entry = { code: 'YR-SM-01', hex: '#fbfbfb', tone: 'matte', textureUrl: 'assets/materials/yerim/YR-SM-01.jpg', tileMm: 300, grain: 'none' };
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(900, 18, 600));
    const mat = PlannerMaterials.forMesh(entry, shelf, THREE);
    expect(mat.map.rotation).toBe(0);
    expect(mat.map.repeat.x).toBeCloseTo(3);   // 900/300
    expect(mat.map.repeat.y).toBeCloseTo(2);   // 600/300
    PlannerMaterials.dispose();
    PlannerMaterials._loader = null;
  });
  test('dispose 는 mesh 사본과 그 map 까지 놓는다 (카탈로그를 다시 읽을 때 GPU 에 남으면 안 된다)', () => {
    PlannerMaterials._loader = { load() { return new THREE.Texture(); } };
    const entry = { code: 'YR-TEX2', hex: '#d1b089', tone: 'matte', textureUrl: 'x.jpg', tileMm: 300, grain: 'none' };
    const a = PlannerMaterials.forMesh(entry, new THREE.Mesh(new THREE.BoxGeometry(600, 900, 18)), THREE);
    const b = PlannerMaterials.forMesh(entry, new THREE.Mesh(new THREE.BoxGeometry(400, 700, 18)), THREE);
    expect(PlannerMaterials._perMesh).toHaveLength(2);
    const spies = [a, b].flatMap((m) => [jest.spyOn(m, 'dispose'), jest.spyOn(m.map, 'dispose')]);
    PlannerMaterials.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
    expect(PlannerMaterials._perMesh).toEqual([]);
    PlannerMaterials._loader = null;
  });
  test('로더가 텍스처를 못 만들면 공유 재질로 물러선다 (3D 가 비지 않는다)', () => {
    PlannerMaterials._loader = { load() { throw new Error('404'); } };
    const entry = { code: 'YR-BAD', hex: '#112233', tone: 'matte', textureUrl: 'nope.jpg', tileMm: 300, grain: 'none' };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(600, 900, 18));
    const mat = PlannerMaterials.forMesh(entry, mesh, THREE);
    expect(mat).toBe(PlannerMaterials.get(entry, THREE));
    expect(mat.map).toBeNull();
    expect(PlannerMaterials._perMesh).toEqual([]);
    PlannerMaterials._loader = null;
  });
  test('repeatFor (순수) — tile 없으면 1, 결 v + 누움이면 축 교환', () => {
    expect(M.plannerMaterialsRepeatFor({ w: 600, h: 900 }, null, 'v', false)).toEqual({ x: 1, y: 1, rotation: 0 });
    expect(M.plannerMaterialsRepeatFor({ w: 600, h: 900 }, 300, 'none', true)).toEqual({ x: 2, y: 3, rotation: 0 });
    expect(M.plannerMaterialsRepeatFor({ w: 600, h: 900 }, 300, 'v', true)).toEqual({ x: 3, y: 2, rotation: Math.PI / 2 });
    expect(M.plannerMaterialsRepeatFor({ w: 600, h: 900 }, 300, 'v', false)).toEqual({ x: 2, y: 3, rotation: 0 });
    expect(M.plannerMaterialsRepeatFor(null, 300, 'h', false)).toEqual({ x: 1, y: 1, rotation: 0 });
  });
  test('faceOf — 선 부재는 가로×높이, 누운 부재(높이가 가장 얇다)는 가로×깊이', () => {
    const door = new THREE.Mesh(new THREE.BoxGeometry(600, 900, 18));
    const side = new THREE.Mesh(new THREE.BoxGeometry(18, 720, 560));
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(600, 18, 300));
    expect(M.plannerMaterialsFaceOf(door)).toEqual({ w: 600, h: 900, horizontal: false });
    expect(M.plannerMaterialsFaceOf(side)).toEqual({ w: 560, h: 720, horizontal: false });
    expect(M.plannerMaterialsFaceOf(shelf)).toEqual({ w: 600, h: 300, horizontal: true });
    expect(M.plannerMaterialsFaceOf({})).toEqual({ w: 0, h: 0, horizontal: false });
  });
});
