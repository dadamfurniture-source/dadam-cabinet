/**
 * C0 마감 카탈로그 정본 — bom-finish-color.js 호환 시험.
 *
 *   1. 기존 7×7 = 49 코드는 글자 단위로 불변 (I6: 과거 문서·가격에 박힌 코드)
 *   2. 추가 3색(GRY/BGE/NVY)은 같은 규칙으로 더해지기만 한다
 *   3. 한글 사양값('화이트', '무광') 해석 — 기판을 모르는 마감은 코드를 짐작하지 않는다
 *   4. window.FurnitureOptionCatalog 가 로드돼 있으면 그 행을 우선 읽고, 아니면 내장 표
 */
const FC = require('../js/detaildesign/bom-finish-color.js');

// 변경 전 bom-finish-color.js 가 만들던 49 코드 — 손으로 박아 둔 골든. 규칙을 바꿔도 이 목록은 바뀌면 안 된다.
const GOLDEN_49 = {
  'pet-matte':   ['PET-CRM-M', 'PET-OAK-M', 'PET-WNT-M', 'PET-GRP-M', 'PET-WHT-M', 'PET-BLK-M', 'PET-SAG-M'],
  'pet-gloss':   ['PET-CRM-G', 'PET-OAK-G', 'PET-WNT-G', 'PET-GRP-G', 'PET-WHT-G', 'PET-BLK-G', 'PET-SAG-G'],
  'mfb':         ['MFB-CRM', 'MFB-OAK', 'MFB-WNT', 'MFB-GRP', 'MFB-WHT', 'MFB-BLK', 'MFB-SAG'],
  'lpm':         ['LPM-CRM', 'LPM-OAK', 'LPM-WNT', 'LPM-GRP', 'LPM-WHT', 'LPM-BLK', 'LPM-SAG'],
  'paint-matte': ['PNT-CRM-M', 'PNT-OAK-M', 'PNT-WNT-M', 'PNT-GRP-M', 'PNT-WHT-M', 'PNT-BLK-M', 'PNT-SAG-M'],
  'paint-gloss': ['PNT-CRM-G', 'PNT-OAK-G', 'PNT-WNT-G', 'PNT-GRP-G', 'PNT-WHT-G', 'PNT-BLK-G', 'PNT-SAG-G'],
  'veneer':      ['VNR-CRM', 'VNR-OAK', 'VNR-WNT', 'VNR-GRP', 'VNR-WHT', 'VNR-BLK', 'VNR-SAG'],
};
const BASE_COLORS = ['cream', 'oak', 'walnut', 'graphite', 'white', 'black', 'sage'];

afterEach(() => { delete window.FurnitureOptionCatalog; });

describe('기존 49 코드 불변', () => {
  test('getFinishColorCode 출력이 골든과 글자 단위로 같다', () => {
    for (const [finish, codes] of Object.entries(GOLDEN_49)) {
      BASE_COLORS.forEach((color, i) => {
        expect(FC.getFinishColorCode(finish, color)).toBe(codes[i]);
      });
    }
  });

  test('내장 7 마감의 순서·code·tone 은 그대로', () => {
    expect(FC.DOOR_FINISH_CATALOG.map(f => [f.value, f.code, f.tone])).toEqual([
      ['pet-matte', 'PET', 'matte'], ['pet-gloss', 'PET', 'gloss'], ['mfb', 'MFB', 'single'], ['lpm', 'LPM', 'single'],
      ['paint-matte', 'PNT', 'matte'], ['paint-gloss', 'PNT', 'gloss'], ['veneer', 'VNR', 'single'],
    ]);
  });

  test('원래 7색은 앞 7 자리에 그대로, 그 뒤에 3색이 더해졌다', () => {
    expect(FC.DOOR_COLOR_CATALOG.slice(0, 7).map(c => [c.value, c.code, c.hex])).toEqual([
      ['cream', 'CRM', '#f1ede3'], ['oak', 'OAK', '#d1b089'], ['walnut', 'WNT', '#8b6447'], ['graphite', 'GRP', '#696a6b'],
      ['white', 'WHT', '#ffffff'], ['black', 'BLK', '#1a1a1a'], ['sage', 'SAG', '#b2bba5'],
    ]);
    expect(FC.DOOR_COLOR_CATALOG.slice(7).map(c => [c.value, c.code, c.hex])).toEqual([
      ['gray', 'GRY', '#9e9e9e'], ['beige', 'BGE', '#d4c4b0'], ['navy', 'NVY', '#1a237e'],
    ]);
  });

  test('buildFullMatrix 는 기존 49 키를 그대로 담고 있다 (총 70)', () => {
    const m = FC.buildFullMatrix();
    for (const [finish, codes] of Object.entries(GOLDEN_49)) {
      BASE_COLORS.forEach((color, i) => expect(m[`${finish}+${color}`].code).toBe(codes[i]));
    }
    expect(Object.keys(m)).toHaveLength(70);
  });

  test('기존 단가는 그대로 (PET-OAK-M 24000, PET-SAG-G 28600, MFB-WHT 13300)', () => {
    expect(FC.getDoorFinishPrice('PET-OAK-M')).toBe(24000);
    expect(FC.getDoorFinishPrice('PET-SAG-G')).toBe(28600);
    expect(FC.getDoorFinishPrice('MFB-WHT')).toBe(13300);
    expect(FC.getDoorFinishPrice('MDF-DEFAULT')).toBeNull();
  });

  test('resolveDoorMaterial 의 기존 4 필드는 그대로', () => {
    const r = FC.resolveDoorMaterial({ doorFinish: 'pet-matte', doorColor: 'oak' });
    expect(r).toMatchObject({ material: 'PET', code: 'PET-OAK-M', label: 'PET 매트 · 오크', priceHint: 60 });
    expect(FC.resolveDoorMaterial(null)).toEqual({ material: 'MDF', code: 'MDF-DEFAULT', label: 'MDF 도어 (기본)', priceHint: 30 });
    expect(FC.resolveDoorMaterial({})).toMatchObject({ material: 'MDF', code: 'MDF-DEFAULT', label: 'MDF 도어 (기본)', priceHint: 30 });
  });
});

describe('추가 3색 (GRY/BGE/NVY)', () => {
  test('같은 규칙으로 코드가 만들어진다', () => {
    expect(FC.getFinishColorCode('pet-matte', 'gray')).toBe('PET-GRY-M');
    expect(FC.getFinishColorCode('pet-gloss', 'beige')).toBe('PET-BGE-G');
    expect(FC.getFinishColorCode('mfb', 'navy')).toBe('MFB-NVY');
    expect(FC.getFinishColorCode('veneer', 'gray')).toBe('VNR-GRY');
  });

  test('단가 배수는 1.00 (미정)', () => {
    expect(FC.getDoorFinishPrice('PET-GRY-M')).toBe(24000);
    expect(FC.getDoorFinishPrice('PNT-NVY-G')).toBe(34000);
  });
});

describe('한글 사양값 해석', () => {
  test('normalizeColorValue — 한글·색 코드·value 모두 받고, 모르면 null', () => {
    expect(FC.normalizeColorValue('화이트')).toBe('white');
    expect(FC.normalizeColorValue('그레이')).toBe('gray');
    expect(FC.normalizeColorValue('오크')).toBe('oak');
    expect(FC.normalizeColorValue('네이비')).toBe('navy');
    expect(FC.normalizeColorValue('WHT')).toBe('white');
    expect(FC.normalizeColorValue('wnt')).toBe('walnut');
    expect(FC.normalizeColorValue('sage')).toBe('sage');
    expect(FC.normalizeColorValue('핑크')).toBeNull();
    expect(FC.normalizeColorValue('')).toBeNull();
    expect(FC.normalizeColorValue(undefined)).toBeNull();
  });

  test('normalizeFinishValue — 한글 마감은 기판을 모르므로 null, value 는 그대로', () => {
    expect(FC.normalizeFinishValue('pet-matte')).toBe('pet-matte');
    expect(FC.normalizeFinishValue('무광')).toBeNull();
    expect(FC.normalizeFinishValue('유광')).toBeNull();
    expect(FC.normalizeFinishValue('엠보')).toBeNull();
    expect(FC.normalizeFinishValue('뭔가')).toBeNull();
  });

  test('resolveLegacyTone — 톤만 해석', () => {
    expect(FC.resolveLegacyTone('무광')).toBe('matte');
    expect(FC.resolveLegacyTone('유광')).toBe('gloss');
    expect(FC.resolveLegacyTone('엠보')).toBeNull();
    expect(FC.resolveLegacyTone('mfb')).toBe('single');
    expect(FC.resolveLegacyTone('paint-gloss')).toBe('gloss');
  });

  test("'무광'+'화이트' 는 코드를 짐작하지 않고 MDF 기본값 + 톤/색 정보만", () => {
    const r = FC.resolveDoorMaterial({ doorFinish: '무광', doorColor: '화이트' });
    expect(r).toMatchObject({ material: 'MDF', code: 'MDF-DEFAULT', label: 'MDF 도어 (기본)', priceHint: 30 });
    expect(r.tone).toBe('matte');
    expect(r.colorValue).toBe('white');
    expect(r.colorCode).toBe('WHT');
    expect(r.colorHex).toBe('#ffffff');
  });

  test('한글 색 + 카탈로그 마감 value 는 코드를 만든다', () => {
    const r = FC.resolveDoorMaterial({ doorFinish: 'pet-matte', doorColor: '그레이' });
    expect(r.code).toBe('PET-GRY-M');
    expect(r.label).toBe('PET 매트 · 그레이');
    expect(r.material).toBe('PET');
  });

  test('parseFinishColorCode / doorMaterialCode 우선', () => {
    expect(FC.parseFinishColorCode('PET-OAK-M')).toEqual({ finishValue: 'pet-matte', colorValue: 'oak', tone: 'matte' });
    expect(FC.parseFinishColorCode('mfb-wht')).toEqual({ finishValue: 'mfb', colorValue: 'white', tone: 'single' });
    expect(FC.parseFinishColorCode('PNT-NVY-G')).toEqual({ finishValue: 'paint-gloss', colorValue: 'navy', tone: 'gloss' });
    expect(FC.parseFinishColorCode('PET-OAK')).toBeNull();   // PET 는 단톤 없음
    expect(FC.parseFinishColorCode('MFB-OAK-M')).toBeNull(); // MFB 는 M 없음
    expect(FC.parseFinishColorCode('MDF-DEFAULT')).toBeNull();
    expect(FC.parseFinishColorCode('')).toBeNull();
    const r = FC.resolveDoorMaterial({ doorFinish: '무광', doorColor: '화이트', doorMaterialCode: 'VNR-WNT' });
    expect(r.code).toBe('VNR-WNT');
    expect(r.material).toBe('VNR');
  });

  test('finishBaseKey — price_key 와 같은 형식', () => {
    expect(FC.finishBaseKey('PET-OAK-M')).toBe('PET-M');
    expect(FC.finishBaseKey('MFB-WHT')).toBe('MFB');
    expect(FC.finishBaseKey('X')).toBeNull();
  });
});

describe('카탈로그 우선 (window.FurnitureOptionCatalog)', () => {
  const stub = (rows, loaded = true) => {
    window.FurnitureOptionCatalog = {
      loaded,
      byCode: (code) => rows.find(r => r.code === String(code).toUpperCase()) || null,
    };
  };

  test('카탈로그 없으면 내장 표 (source embedded, 톤별 PBR 기본값)', () => {
    const r = FC.resolveDoorMaterial({ doorFinish: 'pet-gloss', doorColor: 'oak' });
    expect(r.source).toBe('embedded');
    expect(r.colorHex).toBe('#d1b089');
    expect(r.priceKey).toBe('PET-G');
    expect(r.pbr).toEqual({ roughness: 0.25, metalness: 0, clearcoat: 0.6 });
    expect(r.textureUrl).toBeNull();
    expect(FC.catalogRowByCode('PET-OAK-G')).toBeNull();
  });

  test('카탈로그 행이 있으면 라벨·hex·price_key·PBR·텍스처를 그 행에서, code 는 불변', () => {
    stub([{ code: 'PET-OAK-G', name_ko: 'PET 광택 · 오크(카탈로그)', color_hex: '#d2b18a', price_key: 'PET-G',
      roughness: 0.2, metalness: 0.05, clearcoat: 0.7, texture_url: 'https://x/oak.jpg' }]);
    const r = FC.resolveDoorMaterial({ doorFinish: 'pet-gloss', doorColor: 'oak' });
    expect(r.code).toBe('PET-OAK-G');
    expect(r.material).toBe('PET');
    expect(r.source).toBe('catalog');
    expect(r.label).toBe('PET 광택 · 오크(카탈로그)');
    expect(r.colorHex).toBe('#d2b18a');
    expect(r.pbr).toEqual({ roughness: 0.2, metalness: 0.05, clearcoat: 0.7 });
    expect(r.textureUrl).toBe('https://x/oak.jpg');
    // getFinishColorCode 는 카탈로그와 무관하게 같다
    expect(FC.getFinishColorCode('pet-gloss', 'oak')).toBe('PET-OAK-G');
  });

  test('카탈로그에 그 코드가 없으면 내장 표로 폴백', () => {
    stub([{ code: 'TOP-SNW', name_ko: '스노우' }]);
    const r = FC.resolveDoorMaterial({ doorFinish: 'mfb', doorColor: 'white' });
    expect(r.source).toBe('embedded');
    expect(r.label).toBe('MFB 멜라민 · 화이트');
  });

  test('loaded=false 거나 byCode 가 없거나 던지면 내장 표', () => {
    stub([{ code: 'MFB-WHT', name_ko: 'X' }], false);
    expect(FC.resolveDoorMaterial({ doorFinish: 'mfb', doorColor: 'white' }).label).toBe('MFB 멜라민 · 화이트');
    window.FurnitureOptionCatalog = { loaded: true };
    expect(FC.resolveDoorMaterial({ doorFinish: 'mfb', doorColor: 'white' }).source).toBe('embedded');
    window.FurnitureOptionCatalog = { loaded: true, byCode: () => { throw new Error('boom'); } };
    expect(FC.resolveDoorMaterial({ doorFinish: 'mfb', doorColor: 'white' }).source).toBe('embedded');
  });

  test('카탈로그 행에 PBR 이 없으면(v2 SQL 적용 전 행) 톤 기본값', () => {
    stub([{ code: 'LPM-BLK', name_ko: 'LPM 라미네이트 · 블랙' }]);
    const r = FC.resolveDoorMaterial({ doorFinish: 'lpm', doorColor: 'black' });
    expect(r.source).toBe('catalog');
    expect(r.pbr).toEqual({ roughness: 0.6, metalness: 0, clearcoat: 0 });
    expect(r.colorHex).toBe('#1a1a1a');
  });
});
