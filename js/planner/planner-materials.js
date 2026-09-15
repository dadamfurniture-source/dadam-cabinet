// ============================================================
// D2: 코드별 PBR 재질 — planner-materials.js (구조 페이지 · 디테일 모드 전용)
//
// D0 는 부재의 material.color 만 카탈로그 hex 로 덮었다 (단색). 그래서 PET 광택과
// 도장 무광이 같은 색이면 3D 에서 구분되지 않았다 (계획 §4.4 R1 "오크·PET 광택·도장 무광이
// 구분되어 보인다" 가 완료 기준).
//
// 이 파일은 카탈로그 항목 하나 → three.js MeshPhysicalMaterial 하나를 만들고 **코드별로 캐시**한다.
// 사용자 결정(2026-09-15): **색 + 광택만, 텍스처 없음.** 재질은 color_hex 와 tone 으로 정한다.
//
//   색       color.setStyle(hex) — ColorManagement 가 켜져 있으면 sRGB → linear 변환을 three 가 한다.
//   tone     matte: roughness 0.75 · clearcoat 0        (single·null 도 matte 로 본다)
//            gloss: roughness 0.25 · clearcoat 0.6 · clearcoatRoughness 0.15
//   행 값    materials.roughness / metalness / clearcoat 가 있으면 tone 기본값보다 우선한다.
//   sheen 0  (천 재질 아님)
//
// 텍스처 훅: texture_url + tile_mm + grain. **시드가 없어 지금은 전부 null** — null 이면
//   forMesh 가 공유 재질을 그대로 돌려주고 로더를 만지지 않는다. url 이 생기면
//   TextureLoader 로 한 번 읽어(캐시) sRGB·RepeatWrapping 으로 두고, 부재 크기(mm)/tile_mm 로
//   repeat 를 정하며, 결이 세로(grain:'v')인 가로 부재는 90° 돌린다 (plannerMaterialsRepeatFor).
//   그 경우 재질은 mesh 마다 사본이다(repeat 가 텍스처에 붙으므로).
//
// 색공간·톤매핑·환경광은 이 파일이 아니라 planner-detail.js 의 모드 진입(applyScene)이 켜고 끈다 —
//   구조 모드는 바이트 하나 달라지면 안 되기 때문이다 (I2).
//
// ⚠ 클래식 스크립트 — 최상위 이름은 전부 PLANNER_MATERIALS_ / plannerMaterials / PlannerMaterials 접두.
//   three 는 전역 window.THREE (importmap 모듈이 올린다). 없으면 get() 이 null 을 돌려준다.
// ============================================================

/** tone → PBR 기본값. materials-catalog-v2.sql 의 주석("matte r=0.75 … gloss r=0.25 cc=0.6")과 같은 값. */
const PLANNER_MATERIALS_TONE = {
  matte: { roughness: 0.75, metalness: 0, clearcoat: 0, clearcoatRoughness: 0 },
  gloss: { roughness: 0.25, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.15 },
};

/** single(단톤 자재)·null·모르는 값은 무광으로 본다. */
function plannerMaterialsToneOf(tone) {
  return tone === 'gloss' ? 'gloss' : 'matte';
}

function plannerMaterialsClamp01(v, dflt) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return dflt;
  return Math.min(1, Math.max(0, n));
}

/**
 * 카탈로그 항목 → 재질 파라미터. 순수 함수 — three 없이도 시험한다.
 * @returns {{code, hex, tone, roughness, metalness, clearcoat, clearcoatRoughness, sheen}}
 */
function plannerMaterialsParams(entry) {
  const e = entry || {};
  const tone = plannerMaterialsToneOf(e.tone);
  const base = PLANNER_MATERIALS_TONE[tone];
  const clearcoat = plannerMaterialsClamp01(e.clearcoat, base.clearcoat);
  return {
    code: e.code || null,
    hex: (typeof e.hex === 'string' && /^#[0-9a-f]{6}$/i.test(e.hex)) ? e.hex.toLowerCase() : '#cccccc',
    tone,
    roughness: plannerMaterialsClamp01(e.roughness, base.roughness),
    metalness: plannerMaterialsClamp01(e.metalness, base.metalness),
    clearcoat,
    // 행이 clearcoat 를 주더라도 그 거칠기는 tone 이 정한다 (열이 없다). 0 이면 의미 없으니 0.
    clearcoatRoughness: clearcoat > 0 ? (base.clearcoatRoughness || 0.15) : 0,
    sheen: 0,
  };
}

/**
 * 텍스처 반복 — 부재 면(mm) / 타일(mm). 결이 세로인 자재를 가로로 누인 부재(상판·선반)는 90° 돌린다.
 * tileMm 이 없거나 0 이면 반복 1.
 * @param {{w:number,h:number}} sizeMm 면의 가로·세로 (mm)
 * @param {number|null} tileMm
 * @param {'none'|'h'|'v'} grain
 * @param {boolean} horizontal 부재가 누워 있는가 (상판·선반·지판)
 */
function plannerMaterialsRepeatFor(sizeMm, tileMm, grain, horizontal) {
  const t = (typeof tileMm === 'number' && tileMm > 0) ? tileMm : 0;
  const w = (sizeMm && sizeMm.w > 0) ? sizeMm.w : 0;
  const h = (sizeMm && sizeMm.h > 0) ? sizeMm.h : 0;
  const rotate = grain === 'v' && !!horizontal;
  const x = t && w ? w / t : 1;
  const y = t && h ? h / t : 1;
  return { x: rotate ? y : x, y: rotate ? x : y, rotation: rotate ? Math.PI / 2 : 0 };
}

/**
 * BoxGeometry 의 치수에서 "보이는 면" 크기를 짚는다. 가장 얇은 변이 두께다.
 *   누운 부재(높이가 가장 얇다: 선반·상판·지판) → 면 = 가로(width) × 깊이(depth)
 *   선 부재(도어·측판·뒤판)                    → 면 = 가로 방향의 큰 변(width 또는 depth) × 높이(height)
 * w 가 텍스처 U(가로), h 가 V(세로)다.
 */
function plannerMaterialsFaceOf(mesh) {
  const p = mesh && mesh.geometry && mesh.geometry.parameters;
  if (!p) return { w: 0, h: 0, horizontal: false };
  const w = p.width || 0, h = p.height || 0, d = p.depth || 0;
  const horizontal = h > 0 && h <= Math.min(w, d);
  if (horizontal) return { w, h: d, horizontal: true };
  return { w: Math.max(w, d), h, horizontal: false };
}

const PlannerMaterials = {
  TONE: PLANNER_MATERIALS_TONE,
  params: plannerMaterialsParams,
  repeatFor: plannerMaterialsRepeatFor,
  faceOf: plannerMaterialsFaceOf,
  _cache: {},
  _textures: {},
  _loader: null,
  _cmEnabled: false,

  three(T) {
    if (T) return T;
    return (typeof window !== 'undefined' && window.THREE) ? window.THREE : null;
  },

  /** 색 관리 한 번만 켠다 — setStyle(hex) 이 sRGB 로 해석되어 linear 로 들어간다. */
  ensureColorManagement(T) {
    if (this._cmEnabled || !T || !T.ColorManagement) return;
    try { T.ColorManagement.enabled = true; } catch (e) { /* 읽기 전용이면 그대로 */ }
    this._cmEnabled = true;
  },

  /**
   * 코드별 공유 재질. 같은 코드는 같은 객체다 (캐시). three 가 없으면 null.
   * @param {object} entry 카탈로그 항목 (code·hex·tone·roughness·metalness·clearcoat)
   * @param {object} [T] three 네임스페이스 (시험 주입용, 기본 window.THREE)
   */
  get(entry, T) {
    const THREE_ = this.three(T);
    if (!THREE_ || !entry || !entry.code) return null;
    const hit = this._cache[entry.code];
    if (hit) return hit;
    this.ensureColorManagement(THREE_);
    const p = plannerMaterialsParams(entry);
    const mat = new THREE_.MeshPhysicalMaterial({
      roughness: p.roughness,
      metalness: p.metalness,
      clearcoat: p.clearcoat,
      clearcoatRoughness: p.clearcoatRoughness,
      sheen: p.sheen,
    });
    mat.color.setStyle(p.hex);
    mat.name = 'finish:' + entry.code;
    mat.userData = { code: entry.code, tone: p.tone, hex: p.hex };
    this._cache[entry.code] = mat;
    return mat;
  },

  /**
   * 텍스처 훅 — url 이 있을 때만 한 번 읽어 캐시한다. 없으면 null (no-op).
   * 로더는 처음 필요할 때 만든다 — 시드가 없는 지금은 만들어지지 않는다.
   */
  texture(url, T) {
    const THREE_ = this.three(T);
    if (!THREE_ || !url) return null;
    if (this._textures[url]) return this._textures[url];
    if (!this._loader) {
      if (!THREE_.TextureLoader) return null;
      this._loader = new THREE_.TextureLoader();
    }
    let tex = null;
    try {
      tex = this._loader.load(url);
      tex.colorSpace = THREE_.SRGBColorSpace;
      tex.wrapS = THREE_.RepeatWrapping;
      tex.wrapT = THREE_.RepeatWrapping;
    } catch (e) { tex = null; }
    if (tex) this._textures[url] = tex;
    return tex;
  },

  /**
   * mesh 에 씌울 재질. 텍스처가 없는 항목(지금은 전부)은 공유 재질 그대로 —
   * 텍스처가 있으면 사본을 만들어 부재 크기에 맞춘 repeat 를 건다.
   */
  forMesh(entry, mesh, T) {
    const base = this.get(entry, T);
    if (!base) return null;
    if (!entry.textureUrl) return base;
    const tex = this.texture(entry.textureUrl, T);
    if (!tex) return base;
    const face = plannerMaterialsFaceOf(mesh);
    const rep = plannerMaterialsRepeatFor(face, entry.tileMm, entry.grain, face.horizontal);
    const mat = base.clone();
    const map = tex.clone();
    map.needsUpdate = true;
    map.repeat.set(rep.x, rep.y);
    map.rotation = rep.rotation;
    map.center.set(0.5, 0.5);
    mat.map = map;
    mat.userData = Object.assign({}, base.userData, { perMesh: true });
    return mat;
  },

  /** 캐시 크기 — 시험·디버그. */
  size() { return Object.keys(this._cache).length; },

  /** 캐시를 비우고 GPU 자원을 놓는다 — 카탈로그를 다시 읽었을 때. */
  dispose() {
    Object.keys(this._cache).forEach((k) => { try { this._cache[k].dispose(); } catch (e) { /* 무해 */ } });
    Object.keys(this._textures).forEach((k) => { try { this._textures[k].dispose(); } catch (e) { /* 무해 */ } });
    this._cache = {};
    this._textures = {};
  },
};

if (typeof window !== 'undefined') {
  window.PlannerMaterials = PlannerMaterials;
  window.plannerMaterialsParams = plannerMaterialsParams;
  window.plannerMaterialsRepeatFor = plannerMaterialsRepeatFor;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PLANNER_MATERIALS_TONE,
    plannerMaterialsToneOf,
    plannerMaterialsParams,
    plannerMaterialsRepeatFor,
    plannerMaterialsFaceOf,
    PlannerMaterials,
  };
}
