// ═══════════════════════════════════════════════════════════════
// bom-finish-color.js — W7-1 도어 마감재 × 색상 → 자재 코드 매트릭스
//
// W6-5 ModuleDetailPanel 의 doorFinish (7) × doorColor (7) = 49 조합
// 을 BOM 산출 시 실제 자재 코드로 변환.
//
// 명명 규칙: {FINISH_CODE}-{COLOR_CODE}-{TONE_SUFFIX}
//   예: pet-matte + oak → PET-OAK-M (PET 매트 + 오크)
//       mfb + white     → MFB-WHT (MFB 멜라민 + 화이트, 단톤)
//
// 사용처:
//   - extractors.js: 도어 추출 시 모듈의 doorFinish/doorColor → 자재 코드
//   - mcp-server bom-rules: 단가 매트릭스 (W7-4)
//
// ModuleDetailPanel.tsx 의 인라인 옵션은 UI 표시용 (단일 책임).
// 본 파일은 BOM 산출용 단일 소스 — 두 곳의 코드 동기화는 W7-2 에서 자동 매핑.
//
// C0 (마감 카탈로그 정본, 계획서 §4.3): 코드의 정본은 materials.code
//   (database/materials-catalog-v2.sql). 이 파일은 그 위의 얇은 해석기 + 오프라인 폴백이다.
//   - window.FurnitureOptionCatalog 가 로드돼 있으면 code 로 행을 찾아 라벨·hex·PBR·price_key 를 읽고,
//     아니면 아래 내장 표를 쓴다. getFinishColorCode() 출력은 어느 쪽이든 같다 (49 코드 불변 시험).
//   - 한글 사양값('화이트', '무광') 도 resolveDoorMaterial 이 받는다 (LEGACY_*_MAP).
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // DOOR_FINISH_CATALOG — ModuleDetailPanel.tsx DOOR_FINISH_OPTIONS 와 value 일치
  // tone: 'matte' | 'gloss' | 'single' (광택 vs 무광 vs 단톤)
  // priceHint: 0-100 (상대적, 100=최고가)
  // ─────────────────────────────────────────────────────────────

  const DOOR_FINISH_CATALOG = [
    { value: 'pet-matte',   code: 'PET', tone: 'matte',  label: 'PET 매트',     priceHint: 60 },
    { value: 'pet-gloss',   code: 'PET', tone: 'gloss',  label: 'PET 광택',     priceHint: 65 },
    { value: 'mfb',         code: 'MFB', tone: 'single', label: 'MFB 멜라민',   priceHint: 35 },
    { value: 'lpm',         code: 'LPM', tone: 'single', label: 'LPM 라미네이트', priceHint: 40 },
    { value: 'paint-matte', code: 'PNT', tone: 'matte',  label: '도장 무광',    priceHint: 80 },
    { value: 'paint-gloss', code: 'PNT', tone: 'gloss',  label: '도장 유광',    priceHint: 85 },
    { value: 'veneer',      code: 'VNR', tone: 'single', label: '무늬목',       priceHint: 95 },
  ];

  // ─────────────────────────────────────────────────────────────
  // DOOR_COLOR_CATALOG — ModuleDetailPanel.tsx DOOR_COLOR_OPTIONS 와 value 일치
  // ─────────────────────────────────────────────────────────────

  const DOOR_COLOR_CATALOG = [
    { value: 'cream',    code: 'CRM', label: '크림',     hex: '#f1ede3' },
    { value: 'oak',      code: 'OAK', label: '오크',     hex: '#d1b089' },
    { value: 'walnut',   code: 'WNT', label: '월넛',     hex: '#8b6447' },
    { value: 'graphite', code: 'GRP', label: '그라파이트', hex: '#696a6b' },
    { value: 'white',    code: 'WHT', label: '화이트',   hex: '#ffffff' },
    { value: 'black',    code: 'BLK', label: '블랙',     hex: '#1a1a1a' },
    { value: 'sage',     code: 'SAG', label: '세이지',   hex: '#b2bba5' },
    // C0: FurnitureOptionCatalog 폴백(config-constants.js)에만 있던 3색 — 더하기만 (I6).
    //     위 7색의 코드·순서는 바꾸지 않는다 (기존 49 코드 불변, bom-finish-color-catalog.test.js).
    { value: 'gray',     code: 'GRY', label: '그레이',   hex: '#9e9e9e' },
    { value: 'beige',    code: 'BGE', label: '베이지',   hex: '#d4c4b0' },
    { value: 'navy',     code: 'NVY', label: '네이비',   hex: '#1a237e' },
  ];

  // ─────────────────────────────────────────────────────────────
  // C0: 기존 한글 사양값 해석 (specs.doorColorUpper='화이트', doorFinishUpper='무광')
  //
  // LEGACY_COLOR_MAP  : 한글 색 이름 / 색 코드(WHT) → DOOR_COLOR_CATALOG.value
  // LEGACY_FINISH_MAP : 한글 마감 이름 → 톤만. 기판(PET/MFB/LPM/도장/무늬목)은 알 수 없으므로
  //                     finish value 는 null 로 둔다 — 짐작해서 코드를 만들지 않는다.
  //                     [확인 필요] 실제 판매 라인이 정해지면(계획서 §9-3/4) '무광' → 'pet-matte' 같은
  //                     기본 기판을 여기 한 줄로 더한다. 그 전까지 '무광'+'화이트' 는 code null → MDF 기본값.
  // ─────────────────────────────────────────────────────────────

  const LEGACY_COLOR_MAP = {
    '크림': 'cream', '오크': 'oak', '월넛': 'walnut', '그라파이트': 'graphite',
    '화이트': 'white', '블랙': 'black', '세이지': 'sage',
    '그레이': 'gray', '베이지': 'beige', '네이비': 'navy',
  };

  const LEGACY_FINISH_MAP = {
    '무광': { tone: 'matte', finish: null },
    '유광': { tone: 'gloss', finish: null },
    '엠보': { tone: null,    finish: null },   // 엠보는 톤 체계(matte/gloss/single)에 없다
  };

  // 색 입력 → 카탈로그 value. 이미 value 면 그대로, 한글·색 코드(WHT)도 받는다. 모르면 null
  function normalizeColorValue(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (DOOR_COLOR_CATALOG.some(c => c.value === s)) return s;
    if (LEGACY_COLOR_MAP[s]) return LEGACY_COLOR_MAP[s];
    const byCode = DOOR_COLOR_CATALOG.find(c => c.code === s.toUpperCase());
    return byCode ? byCode.value : null;
  }

  // 마감 입력 → 카탈로그 value. 이미 value 면 그대로. 한글 값은 기판을 모르므로 null (톤은 resolveLegacyTone)
  function normalizeFinishValue(input) {
    if (!input) return null;
    const s = String(input).trim();
    if (DOOR_FINISH_CATALOG.some(f => f.value === s)) return s;
    const legacy = LEGACY_FINISH_MAP[s];
    return legacy ? legacy.finish : null;
  }

  // 마감 입력 → 톤 ('matte' | 'gloss' | 'single' | null)
  function resolveLegacyTone(input) {
    if (!input) return null;
    const s = String(input).trim();
    const f = DOOR_FINISH_CATALOG.find(x => x.value === s);
    if (f) return f.tone;
    const legacy = LEGACY_FINISH_MAP[s];
    return legacy ? legacy.tone : null;
  }

  // 자재 코드 → { finishValue, colorValue, tone }. 형식이 아니거나 모르는 조각이면 null
  function parseFinishColorCode(code) {
    if (!code || typeof code !== 'string') return null;
    const parts = code.trim().toUpperCase().split('-');
    if (parts.length < 2 || parts.length > 3) return null;
    const [finishCode, colorCode, suffix] = parts;
    const tone = parts.length === 3
      ? (suffix === 'M' ? 'matte' : suffix === 'G' ? 'gloss' : null)
      : 'single';
    if (!tone) return null;
    const finish = DOOR_FINISH_CATALOG.find(f => f.code === finishCode && f.tone === tone);
    const color = DOOR_COLOR_CATALOG.find(c => c.code === colorCode);
    if (!finish || !color) return null;
    return { finishValue: finish.value, colorValue: color.value, tone };
  }

  // ─────────────────────────────────────────────────────────────
  // C0: 카탈로그 우선 — window.FurnitureOptionCatalog(config-constants.js) 가 로드돼 있으면
  //     materials.code 로 행을 찾아 라벨·hex·PBR·price_key 를 그 행에서 읽는다.
  //     없거나 실패하면 내장 표(위) 로 폴백. code 자체는 항상 내장 규칙과 같다.
  // ─────────────────────────────────────────────────────────────

  function catalogRowByCode(code) {
    if (!code) return null;
    try {
      const cat = typeof window !== 'undefined' ? window.FurnitureOptionCatalog : null;
      if (!cat || !cat.loaded || typeof cat.byCode !== 'function') return null;
      return cat.byCode(code) || null;
    } catch (e) {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 톤 접미사 (matte=M, gloss=G, single=없음)
  // ─────────────────────────────────────────────────────────────

  const TONE_SUFFIX = {
    matte: 'M',
    gloss: 'G',
    single: '',
  };

  // ─────────────────────────────────────────────────────────────
  // 매트릭스 — finishValue + colorValue → 자재 코드
  // 예: pet-matte + oak → 'PET-OAK-M'
  // ─────────────────────────────────────────────────────────────

  function getFinishColorCode(finishValue, colorValue) {
    if (!finishValue || !colorValue) return null;
    const finish = DOOR_FINISH_CATALOG.find(f => f.value === finishValue);
    const color = DOOR_COLOR_CATALOG.find(c => c.value === colorValue);
    if (!finish || !color) return null;
    const suffix = TONE_SUFFIX[finish.tone] || '';
    return suffix ? `${finish.code}-${color.code}-${suffix}` : `${finish.code}-${color.code}`;
  }

  // ─────────────────────────────────────────────────────────────
  // 자재 명 — BOM 라벨용 (사람이 읽는 표현)
  // 예: 'PET 매트 · 오크'
  // ─────────────────────────────────────────────────────────────

  function getFinishColorLabel(finishValue, colorValue) {
    if (!finishValue || !colorValue) return null;
    const finish = DOOR_FINISH_CATALOG.find(f => f.value === finishValue);
    const color = DOOR_COLOR_CATALOG.find(c => c.value === colorValue);
    if (!finish || !color) return null;
    return `${finish.label} · ${color.label}`;
  }

  // ─────────────────────────────────────────────────────────────
  // 전체 49 조합 매트릭스 (디버깅/테스트 용)
  // ─────────────────────────────────────────────────────────────

  function buildFullMatrix() {
    const matrix = {};
    for (const f of DOOR_FINISH_CATALOG) {
      for (const c of DOOR_COLOR_CATALOG) {
        const code = getFinishColorCode(f.value, c.value);
        matrix[`${f.value}+${c.value}`] = {
          code,
          label: getFinishColorLabel(f.value, c.value),
          priceHint: f.priceHint,
        };
      }
    }
    return matrix;
  }

  // ─────────────────────────────────────────────────────────────
  // 기본값 (모듈에 doorFinish/doorColor 없을 때)
  // 기존 extractors.js 가 사용하던 'MDF, 18mm, 4면' 과 호환
  // ─────────────────────────────────────────────────────────────

  const DEFAULT_DOOR_MATERIAL = 'MDF';
  const DEFAULT_DOOR_CODE = 'MDF-DEFAULT';
  const DEFAULT_DOOR_LABEL = 'MDF 도어 (기본)';

  // ─────────────────────────────────────────────────────────────
  // 도어 자재 정보 — 모듈에서 finish/color 추출 → BOM 자재 인자
  // 반환: { material, code, label, priceHint }
  // ─────────────────────────────────────────────────────────────

  //
  // C0 확장 (기존 필드 material/code/label/priceHint 는 그대로, 아래는 더하기만):
  //   - doorFinish/doorColor 에 한글 사양값('무광', '화이트')·색 코드('WHT') 도 받는다
  //   - doorMaterialCode('PET-OAK-M') 가 있으면 그것을 우선 해석한다
  //   - 기판을 모르는 한글 마감('무광')은 code 를 만들지 않고 MDF 기본값으로 돌아가되,
  //     tone/colorCode/colorHex 는 채워 준다 (렌더·라벨용)
  //   - 카탈로그 행이 있으면 label/hex/priceKey/pbr 를 그 행에서 (source:'catalog'), 아니면 내장 (source:'embedded')
  // ─────────────────────────────────────────────────────────────

  function _defaultDoorMaterial(extra) {
    return Object.assign(
      { material: DEFAULT_DOOR_MATERIAL, code: DEFAULT_DOOR_CODE, label: DEFAULT_DOOR_LABEL, priceHint: 30 },
      extra || {}
    );
  }

  function resolveDoorMaterial(modOrEntry) {
    if (!modOrEntry) return _defaultDoorMaterial();

    let finish = normalizeFinishValue(modOrEntry.doorFinish);
    let color = normalizeColorValue(modOrEntry.doorColor);
    const parsed = parseFinishColorCode(modOrEntry.doorMaterialCode);
    if (parsed) { finish = parsed.finishValue; color = parsed.colorValue; }

    const code = getFinishColorCode(finish, color);
    if (!code) {
      // 기판 미정(한글 '무광' 등) 또는 색 미정 — 코드는 짐작하지 않는다
      const colorObj = color ? DOOR_COLOR_CATALOG.find(c => c.value === color) : null;
      return _defaultDoorMaterial({
        tone: resolveLegacyTone(modOrEntry.doorFinish),
        colorValue: color,
        colorCode: colorObj ? colorObj.code : null,
        colorHex: colorObj ? colorObj.hex : null,
      });
    }

    const finishObj = DOOR_FINISH_CATALOG.find(f => f.value === finish);
    const colorObj = DOOR_COLOR_CATALOG.find(c => c.value === color);
    const row = catalogRowByCode(code);
    return {
      material: finishObj.code,
      code,
      label: (row && row.name_ko) || getFinishColorLabel(finish, color),
      priceHint: finishObj.priceHint,
      // C0 추가 필드
      tone: finishObj.tone,
      finishValue: finish,
      colorValue: color,
      colorCode: colorObj.code,
      colorHex: (row && row.color_hex) || colorObj.hex,
      priceKey: (row && row.price_key) || finishBaseKey(code),
      pbr: row && row.roughness != null
        ? { roughness: row.roughness, metalness: row.metalness != null ? row.metalness : 0, clearcoat: row.clearcoat != null ? row.clearcoat : 0 }
        : DEFAULT_PBR[finishObj.tone],
      textureUrl: (row && row.texture_url) || null,
      source: row ? 'catalog' : 'embedded',
    };
  }

  // 톤별 PBR 기본값 (materials-catalog-v2.sql 시드와 같은 값)
  const DEFAULT_PBR = {
    matte:  { roughness: 0.75, metalness: 0, clearcoat: 0 },
    gloss:  { roughness: 0.25, metalness: 0, clearcoat: 0.6 },
    single: { roughness: 0.6,  metalness: 0, clearcoat: 0 },
  };

  // 'PET-OAK-M' → 'PET-M', 'MFB-WHT' → 'MFB' (FINISH_BASE_PRICE / materials.price_key 키)
  function finishBaseKey(code) {
    if (!code) return null;
    const parts = code.split('-');
    if (parts.length === 3) return parts[0] + '-' + parts[2];
    if (parts.length === 2) return parts[0];
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // W7-4: 도어 자재 단가 매트릭스 (mcp-server bom-rules.defaults 와 mirror)
  // base finish price × color multiplier (Math.round)
  // ─────────────────────────────────────────────────────────────

  const FINISH_BASE_PRICE = {
    'PET-M': 24000, 'PET-G': 26000,
    'MFB':   14000, 'LPM':   16000,
    'PNT-M': 32000, 'PNT-G': 34000,
    'VNR':   38000,
  };

  const COLOR_PRICE_MULTIPLIER = {
    CRM: 1.00, OAK: 1.00, WNT: 1.05, GRP: 1.05,
    WHT: 0.95, BLK: 0.95, SAG: 1.10,
    // C0 추가 3색 — 배수는 미정이라 1.00 (getDoorFinishPrice 의 미등록 기본값과 같다) [확인 필요]
    GRY: 1.00, BGE: 1.00, NVY: 1.00,
  };

  function getDoorFinishPrice(finishCode) {
    if (!finishCode || finishCode === 'MDF-DEFAULT') return null;
    const parts = finishCode.split('-');
    if (parts.length < 2) return null;
    let baseKey, colorCode;
    if (parts.length === 3) {
      baseKey = parts[0] + '-' + parts[2];
      colorCode = parts[1];
    } else {
      baseKey = parts[0];
      colorCode = parts[1];
    }
    const base = FINISH_BASE_PRICE[baseKey];
    if (base == null) return null;
    const mult = COLOR_PRICE_MULTIPLIER[colorCode] != null ? COLOR_PRICE_MULTIPLIER[colorCode] : 1.00;
    return Math.round(base * mult);
  }

  // ─────────────────────────────────────────────────────────────
  // 전역 노출 (CommonJS / ES module / 브라우저 모두 호환)
  // ─────────────────────────────────────────────────────────────

  const api = {
    DOOR_FINISH_CATALOG,
    DOOR_COLOR_CATALOG,
    TONE_SUFFIX,
    DEFAULT_DOOR_MATERIAL,
    DEFAULT_DOOR_CODE,
    DEFAULT_DOOR_LABEL,
    FINISH_BASE_PRICE,
    COLOR_PRICE_MULTIPLIER,
    getFinishColorCode,
    getFinishColorLabel,
    buildFullMatrix,
    resolveDoorMaterial,
    getDoorFinishPrice,
    // C0
    LEGACY_COLOR_MAP,
    LEGACY_FINISH_MAP,
    DEFAULT_PBR,
    normalizeColorValue,
    normalizeFinishValue,
    resolveLegacyTone,
    parseFinishColorCode,
    finishBaseKey,
    catalogRowByCode,
  };

  if (typeof window !== 'undefined') {
    window.DadamBomFinishColor = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
