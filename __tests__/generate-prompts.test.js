/**
 * 생성 워커 프롬프트·견적 계약 테스트 (workers/generate-api/src/prompts.js, quote.js).
 *
 * 프롬프트는 문장이라 조용히 되돌아가기 쉽다. 고정하는 것:
 *   1) 손잡이 규칙 — 매립형, 바 손잡이·push-to-open 금지 (CLAUDE.md)
 *   2) 설치·변형 프롬프트 모두 "문 닫힘"
 *   3) 화면 KINDS 의 8개 키가 전부 워커 CATEGORIES 에 있다 (없으면 수납장으로 조용히 떨어진다)
 *   4) 견적 단가가 이전 카테고리별 함수의 값과 같다
 *
 * ESM 모듈을 jest(CJS) 에서 읽기 위해 export 를 떼고 평가한다. 두 파일은 import 가 없다.
 */

const fs = require('fs');
const path = require('path');

function loadEsm(rel, names) {
  const src = fs
    .readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^export /gm, '');
  return new Function(src + `\nreturn { ${names.join(', ')} };`)();
}

const P = loadEsm('workers/generate-api/src/prompts.js', [
  'STYLES',
  'CATEGORIES',
  'FINISHES',
  'wardrobeDoors',
  'resolveCategory',
  'buildAnalysisPrompt',
  'parseAnalysis',
  'buildInstallPrompt',
  'pickFinishes',
  'buildVariantPrompt',
]);
const Q = loadEsm('workers/generate-api/src/quote.js', ['buildQuote']);

const HTML = fs.readFileSync(path.join(__dirname, '../ai-design.html'), 'utf8');

const ctx = {
  category: 'sink',
  wallW: 3000,
  wallH: 2400,
  waterPct: 30,
  exhaustPct: 70,
  style: 'modern-minimal',
  doorColor: 'white',
  doorFinish: 'matte',
  refCount: 0,
  fridgeBrand: 'Samsung',
  fridgePosition: 'left',
};

describe('화면 품목 ↔ 워커 카테고리', () => {
  const kinds = [...HTML.matchAll(/key: '([a-z]+)',\s*label: '[^']+',\s*gallery/g)].map(
    (m) => m[1]
  );

  test('ai-design.html 의 KINDS 8개가 전부 워커에 있다', () => {
    expect(kinds.length).toBe(8);
    for (const k of kinds) expect(P.resolveCategory(k)).toBe(k);
  });

  test('모르는 키는 수납장으로 간다', () => {
    expect(P.resolveCategory('kitchen')).toBe('storage');
  });
});

describe('설치 프롬프트', () => {
  test('모든 품목이 손잡이 규칙과 문 닫힘을 담는다', () => {
    for (const key of Object.keys(P.CATEGORIES)) {
      const p = P.buildInstallPrompt({ ...ctx, category: key });
      expect(p).toMatch(/HANDLES: none/);
      expect(p).toMatch(/reaching behind the door/);
      expect(p).toMatch(/No bar handles, knobs, chrome hardware or push-to-open/);
      expect(p).toMatch(/All doors and drawers closed/);
      expect(p).toContain(`(${key})`);
      expect(p.length).toBeLessThan(2000);
    }
  });

  test('싱크대는 급수·후드 위치를, 아일랜드는 그 위에 아일랜드를 더한다', () => {
    const sink = P.buildInstallPrompt(ctx);
    expect(sink).toMatch(/sink about 30%/);
    expect(sink).toMatch(/cooktop about 70%/);
    const island = P.buildInstallPrompt({ ...ctx, category: 'island' });
    expect(island).toContain('freestanding island');
    expect(island).toMatch(/sink about 30%/);
  });

  test('붙박이장 도어 수는 짝수 4/6/8', () => {
    expect(P.wardrobeDoors(2000)).toBe(4);
    expect(P.wardrobeDoors(3000)).toBe(6);
    expect(P.wardrobeDoors(3600)).toBe(8);
    expect(P.buildInstallPrompt({ ...ctx, category: 'wardrobe', wallW: 3600 })).toContain(
      '8 equal'
    );
  });

  test('냉장고장은 브랜드·위치를 담는다', () => {
    const p = P.buildInstallPrompt({
      ...ctx,
      category: 'fridge',
      fridgeBrand: 'LG',
      fridgePosition: 'right',
    });
    expect(p).toContain('LG french-door refrigerator on the right side');
  });

  test('참고 이미지가 있으면 스타일만 빌리라고 말한다', () => {
    expect(P.buildInstallPrompt(ctx)).not.toContain('style reference');
    expect(P.buildInstallPrompt({ ...ctx, refCount: 2 })).toContain('images are style reference');
  });

  test('모르는 스타일은 기본 스타일로', () => {
    expect(P.buildInstallPrompt({ ...ctx, style: 'nope' })).toContain(P.STYLES['modern-minimal']);
  });
});

describe('변형 프롬프트', () => {
  test('마감만 바꾸고 문은 닫힌 채', () => {
    const p = P.buildVariantPrompt(P.FINISHES[0]);
    expect(p).toContain(P.FINISHES[0].body);
    expect(p).toMatch(/All doors stay closed/);
    expect(p).toMatch(/Handleless fronts stay handleless/);
  });

  test('한 요청 안의 마감 3개는 서로 다르고 결정적이다', () => {
    const a = P.pickFinishes(3, 12345).map((f) => f.key);
    const b = P.pickFinishes(3, 12345).map((f) => f.key);
    expect(new Set(a).size).toBe(3);
    expect(a).toEqual(b);
  });
});

describe('분석 JSON 파싱', () => {
  test('mm 값과 위치를 퍼센트로', () => {
    const w = P.parseAnalysis(
      'ok {"wall_width_mm":3200,"wall_height_mm":2400,"water_supply_from_left_mm":960,"exhaust_from_left_mm":2240,"confidence":"high"}'
    );
    expect(w).toMatchObject({
      wallW: 3200,
      wallH: 2400,
      waterPct: 30,
      exhaustPct: 70,
      confidence: 'high',
    });
  });

  test('미터 단위·범위 밖·깨진 JSON 은 보호한다', () => {
    expect(P.parseAnalysis('{"wall_width_mm":3.2,"wall_height_mm":2.4}')).toMatchObject({
      wallW: 3200,
      wallH: 2400,
    });
    expect(P.parseAnalysis('{"wall_width_mm":9000}').wallW).toBe(6000);
    expect(P.parseAnalysis('nothing').wallW).toBe(3000);
    expect(P.parseAnalysis(null).wallW).toBe(3000);
  });

  test('분석 프롬프트는 JSON 만 요구한다', () => {
    expect(P.buildAnalysisPrompt()).toMatch(/Return JSON only/);
  });
});

describe('견적', () => {
  test('싱크대 3000mm — 이전 buildSinkQuote 와 같은 합계', () => {
    const q = Q.buildQuote('sink', 3000);
    // 하부 480,000 + 상부(70%) 294,000 + 상판 450,000 + 수전 40,000 + 싱크볼 80,000 + 후드 65,000 + 시공 200,000 + 철거 90,000
    expect(q.subtotal).toBe(1699000);
    expect(q.total).toBe(1699000 + 169900);
    expect(q.range.min).toBe(Math.round(q.total * 0.95));
  });

  test('붙박이장은 300mm 단위 올림', () => {
    const q = Q.buildQuote('wardrobe', 3100);
    expect(q.items[0].total).toBe(11 * 140000);
    expect(q.items[0].quantity).toBe('3100mm (11자)');
  });

  test('전 품목이 견적을 낸다', () => {
    for (const key of Object.keys(P.CATEGORIES)) {
      const q = Q.buildQuote(key, 2400);
      expect(q.total).toBeGreaterThan(0);
      expect(q.items.some((i) => i.name === '시공비')).toBe(true);
    }
  });
});
