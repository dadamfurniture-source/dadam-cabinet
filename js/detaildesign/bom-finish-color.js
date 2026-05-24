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
  ];

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

  function resolveDoorMaterial(modOrEntry) {
    if (!modOrEntry) return { material: DEFAULT_DOOR_MATERIAL, code: DEFAULT_DOOR_CODE, label: DEFAULT_DOOR_LABEL, priceHint: 30 };
    const finish = modOrEntry.doorFinish;
    const color = modOrEntry.doorColor;
    const code = getFinishColorCode(finish, color);
    if (!code) return { material: DEFAULT_DOOR_MATERIAL, code: DEFAULT_DOOR_CODE, label: DEFAULT_DOOR_LABEL, priceHint: 30 };
    const finishObj = DOOR_FINISH_CATALOG.find(f => f.value === finish);
    return {
      material: finishObj.code,
      code,
      label: getFinishColorLabel(finish, color),
      priceHint: finishObj.priceHint,
    };
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
  };

  if (typeof window !== 'undefined') {
    window.DadamBomFinishColor = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
