/**
 * @jest-environment node
 *
 * 생성 워커 계약 테스트 (workers/generate-api/src/prompts.js, quote.js, share.js).
 *
 * 프롬프트는 문장이라 조용히 되돌아가기 쉽다. 고정하는 것:
 *   1) 손잡이 규칙 — 매립형, 바 손잡이·push-to-open 금지 (CLAUDE.md). FIX 재시도 프롬프트도 같다
 *   2) 설치·변형 프롬프트 모두 "문 닫힘"
 *   3) 화면 KINDS 의 8개 키가 전부 워커 CATEGORIES 에 있다 (없으면 수납장으로 조용히 떨어진다)
 *   4) 견적 단가가 이전 카테고리별 함수의 값과 같다, 화면은 unit_price/total 을 읽는다
 *   5) QC 판정·브리프 파싱이 깨진 입력에 관대하다 (검사 때문에 생성을 막지 않는다)
 *   6) 공유 토큰은 43자 base64url, 해시는 pepper 에 따라 달라진다
 *
 * ESM 모듈을 jest(CJS) 에서 읽기 위해 export 를 떼고 평가한다. 세 파일은 import 가 없다.
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
  'QC_FIXES',
  'QC_ISSUE_CODES',
  'wardrobeDoors',
  'resolveCategory',
  'buildAnalysisPrompt',
  'parseAnalysis',
  'buildInstallPrompt',
  'buildQcPrompt',
  'parseQc',
  'pickFinishes',
  'buildVariantPrompt',
  'buildThemePalettePrompt',
  'parseThemePalette',
  'KITCHEN_CATEGORIES',
  'TWO_TONES',
  'pickTwoTone',
  'buildTwoToneVariantPrompt',
]);
const Q = loadEsm('workers/generate-api/src/quote.js', ['buildQuote']);
const S = loadEsm('workers/generate-api/src/share.js', [
  'pepperedHash',
  'generateShareToken',
  'hashShareToken',
  'buildShareUrl',
  'shareExpiryIso',
  'checkShareAccessible',
]);

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

const HANDLE_RULES = [
  /HANDLES: none/,
  /reaching behind the door/,
  /No bar handles, knobs, chrome hardware or push-to-open/,
  /All doors and drawers closed/,
];

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
      for (const rule of HANDLE_RULES) expect(p).toMatch(rule);
      expect(p).toContain(`(${key})`);
      expect(p.length).toBeLessThan(2500);
    }
  });

  test('싱크대는 급수·후드 위치를, 아일랜드는 그 위에 아일랜드를 더한다', () => {
    const sink = P.buildInstallPrompt(ctx);
    expect(sink).toMatch(/sink about 30%/);
    expect(sink).toMatch(/cooktop about 70%/);
    expect(sink).toMatch(/mixer faucet .* the faucet is mandatory/);
    expect(P.buildInstallPrompt({ ...ctx, category: 'wardrobe' })).not.toMatch(/faucet/);
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

  test('참고 이미지가 있으면 마감만 빌리고 레이아웃은 베끼지 말라고 말한다', () => {
    expect(P.buildInstallPrompt(ctx)).not.toContain('style reference');
    const p = P.buildInstallPrompt({ ...ctx, refCount: 2 });
    expect(p).toContain('images are style reference');
    expect(p).toMatch(/Never copy the reference layout/);
  });

  test('브리프·기존 가구가 있으면 ROOM·REMOVE FIRST 줄이 붙는다', () => {
    const p = P.buildInstallPrompt({
      ...ctx,
      brief: 'oak floor, warm light from the left',
      existing: 'dark glossy cabinets',
    });
    expect(p).toContain('ROOM: oak floor, warm light from the left');
    expect(p).toContain('REMOVE FIRST: dark glossy cabinets');
    expect(P.buildInstallPrompt(ctx)).not.toContain('ROOM:');
  });

  test('공사 현장이면 SITE 줄, 타일은 밝은 무채색이면 유지·아니면 교체', () => {
    const site = P.buildInstallPrompt({
      ...ctx,
      site: 'construction',
      siteNotes: 'bare cement, debris',
    });
    expect(site).toContain(
      'SITE: the photo shows an unfinished construction site (bare cement, debris)'
    );
    expect(site).toMatch(/remove debris, tools, boxes, dust and protective film/);
    expect(P.buildInstallPrompt(ctx)).not.toContain('SITE:');

    const keep = P.buildInstallPrompt({
      ...ctx,
      tile: { present: true, lightNeutral: true, description: 'white matte' },
    });
    expect(keep).toContain('WALL TILE: keep the existing light tiles');
    const swap = P.buildInstallPrompt({
      ...ctx,
      tile: { present: true, lightNeutral: false, description: 'dark brown glossy' },
    });
    expect(swap).toContain('(dark brown glossy) are not light neutral');
    expect(swap).toMatch(/matte off-white or light grey/);
    expect(
      P.buildInstallPrompt({ ...ctx, tile: { present: false, lightNeutral: false } })
    ).not.toContain('WALL TILE');
  });

  test('FIX 재시도 프롬프트도 손잡이 규칙을 지키고 문제별 문장을 붙인다', () => {
    const p = P.buildInstallPrompt(ctx, { fix: ['handles', 'room_changed', 'nope'] });
    for (const rule of HANDLE_RULES) expect(p).toMatch(rule);
    expect(p).toContain('FIX (the previous attempt failed these checks)');
    expect(p).toContain(P.QC_FIXES.handles);
    expect(p).toContain(P.QC_FIXES.room_changed);
    expect(P.buildInstallPrompt(ctx)).not.toContain('FIX (');
  });

  test('모르는 스타일은 기본 스타일로', () => {
    expect(P.buildInstallPrompt({ ...ctx, style: 'nope' })).toContain(P.STYLES['modern-minimal']);
  });
});

describe('품질 검사', () => {
  test('검사 프롬프트는 모든 문제 코드를 설명하고 JSON 만 요구한다', () => {
    const p = P.buildQcPrompt(ctx);
    for (const code of P.QC_ISSUE_CODES) expect(p).toContain(`- ${code}:`);
    expect(p).toMatch(/Answer JSON only/);
    expect(p).toContain('싱크대');
  });

  test('판정 파싱 — 알려진 코드만 남기고, 깨진 입력은 통과로', () => {
    expect(P.parseQc('{"ok":false,"issues":["handles","weird"],"note":"x"}')).toEqual({
      ok: false,
      issues: ['handles'],
      note: 'x',
    });
    expect(P.parseQc('{"ok":true,"issues":[]}').ok).toBe(true);
    expect(P.parseQc('garbage').ok).toBe(true);
    expect(P.parseQc(null).ok).toBe(true);
  });
});

describe('투톤 추천안', () => {
  test('싱크가 있는 품목만 수전 검사를 받는다', () => {
    expect(P.KITCHEN_CATEGORIES).toEqual(['sink', 'island']);
    expect(P.buildQcPrompt(ctx)).toContain('- faucet_missing:');
    expect(P.buildQcPrompt({ ...ctx, category: 'wardrobe' })).not.toContain('faucet_missing');
  });

  test('투톤은 상·하부를 다르게, 결정적으로 고른다', () => {
    const a = P.pickTwoTone(3000);
    expect(a).toBe(P.pickTwoTone(3000));
    expect(P.TWO_TONES.length).toBe(8);
    for (const t of P.TWO_TONES) expect(t.upper).not.toBe(t.lower);
    const p = P.buildTwoToneVariantPrompt(a);
    expect(p).toContain('Upper (wall) cabinets: ' + a.upper);
    expect(p).toContain('Lower (base) cabinets, drawers and any island: ' + a.lower);
    expect(p).toMatch(/faucet/);
    expect(p).toMatch(/All doors stay closed/);
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

describe('테마 색감', () => {
  test('추출 프롬프트는 JSON 만 요구하고 흰색·검정을 막는다', () => {
    const p = P.buildThemePalettePrompt();
    expect(p).toMatch(/Answer JSON only/);
    expect(p).toMatch(/never white or black/);
  });

  test('파싱 결과는 FINISHES 항목과 같은 모양이라 변형 프롬프트에 바로 들어간다', () => {
    const f = P.parseThemePalette(
      '{"body":"muted sage green matte","accent":"natural oak woodgrain","tone":"세이지 그린"}'
    );
    expect(f).toEqual({
      key: 'theme',
      body: 'muted sage green matte',
      accent: 'natural oak woodgrain',
      tone: '세이지 그린',
    });
    expect(P.buildVariantPrompt(f)).toContain('muted sage green matte');
  });

  test('body 가 없거나 깨진 JSON 은 null — 그러면 기본 팔레트로 간다', () => {
    expect(P.parseThemePalette('{"accent":"oak"}')).toBeNull();
    expect(P.parseThemePalette('nope')).toBeNull();
    expect(P.parseThemePalette(null)).toBeNull();
    expect(P.parseThemePalette('{"body":"warm sand beige matte"}').accent).toBe(
      'natural oak woodgrain'
    );
  });
});

describe('분석 JSON 파싱', () => {
  test('mm 값·위치 퍼센트·브리프', () => {
    const w = P.parseAnalysis(
      'ok {"wall_width_mm":3200,"wall_height_mm":2400,"water_supply_from_left_mm":960,"exhaust_from_left_mm":2240,"confidence":"high","room_brief":" oak floor ","existing_furniture":"old cabinets"}'
    );
    expect(w).toMatchObject({
      wallW: 3200,
      wallH: 2400,
      waterPct: 30,
      exhaustPct: 70,
      confidence: 'high',
      brief: 'oak floor',
      existing: 'old cabinets',
    });
  });

  test('현장 상태·벽 타일 필드', () => {
    const w = P.parseAnalysis(
      '{"wall_width_mm":3000,"site_condition":"construction","site_notes":"bare cement","wall_tile":{"present":true,"light_neutral":false,"description":"dark brown glossy"}}'
    );
    expect(w.site).toBe('construction');
    expect(w.siteNotes).toBe('bare cement');
    expect(w.tile).toEqual({
      present: true,
      lightNeutral: false,
      description: 'dark brown glossy',
    });
    const f = P.parseAnalysis('{"wall_width_mm":3000,"site_condition":"weird","wall_tile":"no"}');
    expect(f.site).toBe('finished');
    expect(f.tile).toBeNull();
  });

  test('미터 단위·범위 밖·깨진 JSON 은 보호한다', () => {
    expect(P.parseAnalysis('{"wall_width_mm":3.2,"wall_height_mm":2.4}')).toMatchObject({
      wallW: 3200,
      wallH: 2400,
      brief: null,
    });
    expect(P.parseAnalysis('{"wall_width_mm":9000}').wallW).toBe(6000);
    expect(P.parseAnalysis('nothing').wallW).toBe(3000);
    expect(P.parseAnalysis(null).wallW).toBe(3000);
  });

  test('분석 프롬프트는 JSON 만 요구하고 브리프 키를 설명한다', () => {
    const p = P.buildAnalysisPrompt();
    expect(p).toMatch(/Return JSON only/);
    expect(p).toContain('room_brief');
    expect(p).toContain('existing_furniture');
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

  test('전 품목이 견적을 내고, 항목은 unit_price/total 을 가진다', () => {
    for (const key of Object.keys(P.CATEGORIES)) {
      const q = Q.buildQuote(key, 2400);
      expect(q.total).toBeGreaterThan(0);
      expect(q.items.some((i) => i.name === '시공비')).toBe(true);
      for (const it of q.items) {
        expect(typeof it.unit_price).toBe('number');
        expect(typeof it.total).toBe('number');
      }
    }
  });

  test('화면 견적 표는 total 을 읽는다 (항목이 0원으로 뜨던 버그)', () => {
    expect(HTML).toMatch(/it\.total/);
  });
});

describe('공유 토큰', () => {
  test('토큰은 43자 base64url', () => {
    const t = S.generateShareToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(S.generateShareToken()).not.toBe(t);
  });

  test('해시는 pepper 와 토큰에 따라 다르고 결정적이다', async () => {
    const a = await S.hashShareToken({ SHARE_TOKEN_PEPPER: 'p1' }, 'tok');
    const b = await S.hashShareToken({ SHARE_TOKEN_PEPPER: 'p1' }, 'tok');
    const c = await S.hashShareToken({ SHARE_TOKEN_PEPPER: 'p2' }, 'tok');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test('공유 URL 은 fragment 에 토큰을 싣고, 만료·회수·미완료를 구분한다', () => {
    expect(S.buildShareUrl({ PUBLIC_BASE_URL: 'https://x.com/' }, 'abc')).toBe(
      'https://x.com/design-share.html#t=abc'
    );
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(S.checkShareAccessible(null).status).toBe(404);
    expect(S.checkShareAccessible({ status: 'done', share_expires_at: past }).reason).toBe(
      'share_expired'
    );
    expect(
      S.checkShareAccessible({ status: 'done', share_expires_at: future, share_revoked_at: past })
        .reason
    ).toBe('share_revoked');
    expect(S.checkShareAccessible({ status: 'variants', share_expires_at: future }).status).toBe(
      409
    );
    expect(S.checkShareAccessible({ status: 'done', share_expires_at: future }).ok).toBe(true);
  });

  test('만료일 기본 30일, 최대 365일', () => {
    const d = new Date(S.shareExpiryIso({}, null));
    const days = Math.round((d - Date.now()) / 86400000);
    expect(days).toBe(30);
    const d2 = new Date(S.shareExpiryIso({}, 9999));
    expect(Math.round((d2 - Date.now()) / 86400000)).toBe(365);
  });
});
