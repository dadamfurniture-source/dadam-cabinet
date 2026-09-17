/**
 * 설치·검사 프롬프트 스냅샷.
 *
 * 핵심은 첫 블록이다: **design_spec 이 없으면 프롬프트가 한 글자도 달라지지 않는다.**
 * fixtures/install-prompt-baseline.json 은 design_spec 을 들이기 직전(origin/main a94afc0)
 * 의 출력 전문이다. 독립형 ai-design.html 경로는 이 파일이 지킨다.
 * 프롬프트를 일부러 고칠 때만 fixture 를 다시 뜬다.
 *
 * 둘째 블록은 design_spec 이 있을 때 실제로 무엇이 실리는지를 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL_QC_ISSUE_CODES,
  CATEGORIES,
  DESIGN_SPEC_QC_FIXES,
  QC_ISSUE_CODES,
  buildInstallPrompt,
  buildQcPrompt,
  normalizeDesignSpec,
  parseQc,
} from '../src/prompts.js';

const baseline = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/install-prompt-baseline.json', import.meta.url)),
    'utf8'
  )
);

const BASE = {
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

/** fixture 를 뜰 때 쓴 것과 같은 조합. 바꾸면 fixture 도 같이 다시 뜬다. */
const VARIANTS = {
  brief: {
    category: 'sink',
    brief: 'oak floor, warm light from the left',
    existing: 'dark glossy cabinets',
  },
  site: { category: 'sink', site: 'construction', siteNotes: 'bare cement, debris' },
  tileKeep: {
    category: 'wardrobe',
    tile: { present: true, lightNeutral: true, description: 'white matte' },
  },
  tileSwap: {
    category: 'storage',
    tile: { present: true, lightNeutral: false, description: 'dark brown glossy' },
  },
  refs: { category: 'island', refCount: 2 },
  fridge: { category: 'fridge', fridgeBrand: 'LG', fridgePosition: 'right' },
  wideWardrobe: { category: 'wardrobe', wallW: 3600 },
};

// ─── 1. design_spec 이 없을 때 = 옛 경로 불변 ───

test('품목 8개의 설치 프롬프트가 옛 출력과 한 글자도 다르지 않다', () => {
  assert.deepEqual(Object.keys(baseline.install).sort(), Object.keys(CATEGORIES).sort());
  for (const category of Object.keys(baseline.install)) {
    assert.equal(
      buildInstallPrompt({ ...BASE, category }),
      baseline.install[category],
      `install(${category})`
    );
  }
});

test('품목 8개의 검사 프롬프트가 옛 출력과 한 글자도 다르지 않다', () => {
  for (const category of Object.keys(baseline.qc)) {
    assert.equal(buildQcPrompt({ ...BASE, category }), baseline.qc[category], `qc(${category})`);
  }
});

test('브리프·공사현장·타일·참고이미지·FIX 조합도 옛 출력 그대로다', () => {
  for (const [name, patch] of Object.entries(VARIANTS)) {
    assert.equal(
      buildInstallPrompt({ ...BASE, ...patch }),
      baseline.installVariants[name],
      `installVariants(${name})`
    );
  }
  assert.equal(
    buildInstallPrompt({ ...BASE, category: 'sink' }, { fix: ['handles', 'doors_open', 'nope'] }),
    baseline.installFix
  );
});

test('design_spec: null 은 없는 것과 같다', () => {
  assert.equal(
    buildInstallPrompt({ ...BASE, category: 'sink', designSpec: null }),
    baseline.install.sink
  );
  // 망가진 값이 options 에 남아 있어도 범용 문단으로 되돌아갈 뿐 터지지 않는다
  assert.equal(
    buildInstallPrompt({ ...BASE, category: 'sink', designSpec: { version: 1, category: 'sink' } }),
    baseline.install.sink
  );
  assert.equal(
    buildInstallPrompt({ ...BASE, category: 'sink', designSpec: 'garbage' }),
    baseline.install.sink
  );
});

test('공통 QC 코드는 요약이 없어도 전부 설명된다', () => {
  const p = buildQcPrompt({ ...BASE, category: 'sink' });
  for (const code of QC_ISSUE_CODES) assert.ok(p.includes(`- ${code}:`), code);
  // 도면 요약 전용 코드는 근거(LAYOUT 줄)가 없으면 나오지 않는다
  for (const code of Object.keys(DESIGN_SPEC_QC_FIXES)) assert.ok(!p.includes(`- ${code}:`), code);
});

// ─── 2. design_spec 이 있을 때 ───

function spec() {
  return normalizeDesignSpec(
    {
      category: 'sink',
      wallRunMm: 3600,
      sections: {
        lower: {
          widthMm: 3600,
          heightMm: 870,
          depthMm: 600,
          fromLeftMm: 0,
          modules: [
            { widthMm: 900, kind: 'drawer', drawerCount: 3, label: '서랍 3단' },
            { widthMm: 700, kind: 'appliance', label: '싱크볼' },
            { widthMm: 600, kind: 'door', doorCount: 1 },
            { widthMm: 800, kind: 'drawer', drawerCount: 2 },
            { widthMm: 600, kind: 'open' },
          ],
        },
        upper: {
          widthMm: 2700,
          heightMm: 900,
          depthMm: 350,
          fromLeftMm: 0,
          modules: [{ widthMm: 900, kind: 'door', doorCount: 2 }],
        },
      },
      appliances: [
        { kind: 'sink', fromLeftMm: 900, widthMm: 700 },
        { kind: 'cooktop', fromLeftMm: 2200, widthMm: 600 },
      ],
      finishes: {
        door: {
          name: '예림 LUX Supreme PET Matt 매트 화이트',
          nameEn: 'matte white PET laminate',
          colorHex: '#F2F0EC',
          tone: 'matte',
          vendorCode: 'SM-01',
        },
        body: { nameEn: 'warm beige melamine board', colorHex: '#e4dccd', tone: 'matte' },
        top: { nameEn: 'light grey engineered stone' },
      },
      notes: '좌측 900 서랍장은 세탁기 옆이라 폭 고정',
    },
    'sink'
  );
}

const withSpec = () => buildInstallPrompt({ ...BASE, category: 'sink', designSpec: spec() });

test('범용 문단이 사라지고 실제 모듈·치수가 들어온다', () => {
  const p = withSpec();
  assert.ok(!p.includes('Lower cabinets in 600 mm modules'));
  assert.ok(!p.includes('sink about 30%'));
  assert.ok(p.includes("FURNITURE: this is the customer's own planner drawing"));
  assert.ok(p.includes('The whole run is 3600 mm wide.'));
  assert.ok(
    p.includes(
      '- Lower (base) run — 3600 mm wide, 870 mm high, 600 mm deep, starting 0 mm from the left end of the run.'
    )
  );
  assert.ok(
    p.includes(
      'Left to right: 900 mm 3-drawer stack [서랍 3단]; 700 mm appliance opening [싱크볼]; 600 mm single-door cabinet; 800 mm 2-drawer stack; 600 mm open shelving with no door.'
    )
  );
  assert.ok(p.includes('- Upper (wall) run — 2700 mm wide, 900 mm high, 350 mm deep'));
});

test('가전은 왼쪽에서 잰 위치와 폭으로 들어간다', () => {
  const p = withSpec();
  assert.ok(
    p.includes(
      'APPLIANCES: an undermount sink with a single-lever mixer faucet (matte black or brushed steel) on the countertop behind it — the faucet is mandatory (left edge 900 mm from the left end of the run, 700 mm wide); a flush induction cooktop (left edge 2200 mm from the left end of the run, 600 mm wide).'
    )
  );
});

test('치수가 어긋나면 사진이 이긴다고 못박는다', () => {
  const p = withSpec();
  assert.match(p, /the millimetres are guidance/);
  assert.match(
    p,
    /the photo wins — scale the run to fit the real wall and keep the order and the counts/
  );
});

test('마감은 실제 제품명 + 색으로 쓴다', () => {
  const p = withSpec();
  assert.ok(
    p.includes(
      'FINISH: matte white PET laminate (예림 LUX Supreme PET Matt 매트 화이트, SM-01, colour #f2f0ec) flat-panel fronts, modern minimal style, consistent on every panel.'
    )
  );
  assert.ok(p.includes('Carcass and visible side panels: matte warm beige melamine board'));
  assert.ok(p.includes('Countertop and worktop surfaces: light grey engineered stone.'));
  assert.ok(!p.includes('white matte flat-panel fronts')); // 옛 door_color/door_finish 는 밀려났다
});

test('마감이 없으면 door_color/door_finish 로 돌아간다', () => {
  const s = spec();
  delete s.finishes;
  const p = buildInstallPrompt({ ...BASE, category: 'sink', designSpec: s });
  assert.ok(p.includes('FINISH: white matte flat-panel fronts, modern minimal style'));
});

test('마감만 있는 요약은 FINISH 만 바꾸고 FURNITURE 는 범용 그대로', () => {
  const s = normalizeDesignSpec({ finishes: { door: { nameEn: 'walnut woodgrain' } } }, 'sink');
  const p = buildInstallPrompt({ ...BASE, category: 'sink', designSpec: s });
  assert.ok(p.includes('FURNITURE: Straight kitchen run along the wall.'));
  assert.ok(p.includes('FINISH: walnut woodgrain flat-panel fronts'));
});

test('요약이 있어도 손잡이·문 닫힘·REMOVE·SITE·타일·FIX 규칙은 그대로다', () => {
  const p = buildInstallPrompt(
    {
      ...BASE,
      category: 'sink',
      designSpec: spec(),
      existing: 'dark glossy cabinets',
      site: 'construction',
      siteNotes: 'bare cement',
      tile: { present: true, lightNeutral: false, description: 'dark brown glossy' },
      refCount: 2,
    },
    { fix: ['handles', 'layout_mismatch'] }
  );
  assert.match(p, /HANDLES: none/);
  assert.match(p, /reaching behind the door/);
  assert.match(p, /No bar handles, knobs, chrome hardware or push-to-open/);
  assert.match(p, /All doors and drawers closed/);
  assert.match(p, /No text, labels or watermarks/);
  assert.ok(p.includes('REMOVE FIRST: dark glossy cabinets'));
  assert.ok(p.includes('SITE: the photo shows an unfinished construction site (bare cement)'));
  assert.ok(
    p.includes('WALL TILE: the existing wall tiles (dark brown glossy) are not light neutral')
  );
  assert.ok(p.includes('images are style reference'));
  assert.ok(p.includes('FIX (the previous attempt failed these checks)'));
  assert.ok(p.includes(DESIGN_SPEC_QC_FIXES.layout_mismatch));
  assert.ok(p.includes('PLANNER NOTES: 좌측 900 서랍장은 세탁기 옆이라 폭 고정'));
});

test('QC 는 요약이 있을 때만 LAYOUT 줄과 layout_mismatch 를 낸다', () => {
  const p = buildQcPrompt({ ...BASE, category: 'sink', designSpec: spec() });
  assert.ok(
    p.includes(
      'LAYOUT the render must match, left to right — lower = 900 mm 3-drawer stack; 700 mm appliance opening; 600 mm single-door cabinet; 800 mm 2-drawer stack; 600 mm open shelving with no door | upper = 900 mm 2-door cabinet'
    )
  );
  assert.ok(p.includes('- layout_mismatch:'));
  for (const code of QC_ISSUE_CODES) assert.ok(p.includes(`- ${code}:`), code);
});

test('parseQc 는 layout_mismatch 를 알아듣는다', () => {
  assert.deepEqual(parseQc('{"ok":false,"issues":["layout_mismatch","nope"],"note":"x"}'), {
    ok: false,
    issues: ['layout_mismatch'],
    note: 'x',
  });
  assert.ok(ALL_QC_ISSUE_CODES.includes('layout_mismatch'));
  assert.ok(!QC_ISSUE_CODES.includes('layout_mismatch'));
});
