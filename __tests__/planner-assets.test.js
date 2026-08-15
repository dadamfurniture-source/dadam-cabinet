/**
 * P1: 플래너 공통 모듈이 안전하게 실려 있는지 정적으로 검사한다.
 *
 * 막으려는 사고 두 가지:
 *
 * 1) **흰 화면** — 클래식 스크립트는 전역 렉시컬 스코프를 공유한다.
 *    `js/planner/planner-view.js` 가 `const view` 를 선언했는데 HTML 인라인도
 *    `const view` 를 선언하면 SyntaxError 가 나고 **그 인라인 스크립트 전체**가
 *    실행되지 않는다. 플래너가 통째로 죽는데 콘솔에는 한 줄만 남는다.
 *    "추출과 원본 삭제를 같은 커밋에" 라는 규칙을 기계가 강제하게 한다.
 *
 * 2) **반쪽 배포** — 두 HTML 이 서로 다른 `?v=` 를 쓰면 Cloudflare 가
 *    한쪽만 새로 받아 배치와 구조가 다른 정본을 보게 된다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML_FILES = ['mockup-shell.html', 'mockup-structure.html'];
const norm = (t) => t.split('\r\n').join('\n');

const read = (rel) => norm(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** `<script src="...">` 를 문서 순서대로 뽑는다 */
function scriptSrcs(html) {
  const out = [];
  const re = /<script([^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*)>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[2]);
  return out;
}

/** 인라인 클래식 스크립트 본문 */
function inlineBodies(html) {
  const out = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\ssrc\s*=/.test(attrs)) continue;
    if (/type\s*=\s*["'](module|importmap)["']/.test(attrs)) continue;
    out.push(m[2]);
  }
  return out;
}

// 최상위 선언 추출 — 들여쓰기 휴리스틱이 아니라 실제 괄호 깊이로 판단한다.
// 이유는 test-utils/js-scan.js 주석 참고 (지역변수 z·w·sz 를 전역으로 오인했었다).
const { topLevelDeclarations: topLevelNames } = require('../test-utils/js-scan');

// 공통 모듈 — 배치·구조 두 단계가 **같은 정본**을 봐야 하는 것들 (P1)
const SHARED = [
  'js/planner/planner-scope.js',
  'js/planner/planner-view.js',
  'js/planner/planner-sections.js',
];

// 구조 단계 전용 (P2). 배치 단계는 계산 엔진을 쓰지 않는다 — 실측 0건이라
// 공통으로 싣지 않는다. 이 구분이 없으면 shell 에 안 쓰는 코드가 계속 딸려간다.
const STRUCTURE_ONLY = ['js/planner/planner-engine.js'];

/** 해당 HTML 이 로드해야 하는 모듈 전체 */
const modulesFor = (file) =>
  file === 'mockup-structure.html' ? [...SHARED, ...STRUCTURE_ONLY] : SHARED;

describe('플래너 모듈이 실려 있다', () => {
  test.each(HTML_FILES)('%s 가 필요한 모듈을 모두 로드한다', (file) => {
    const srcs = scriptSrcs(read(file)).map((s) => s.split('?')[0]);
    for (const want of modulesFor(file)) expect(srcs).toContain(want);
  });

  test('mockup-shell.html 은 구조 전용 모듈을 싣지 않는다', () => {
    const srcs = scriptSrcs(read('mockup-shell.html')).map((s) => s.split('?')[0]);
    for (const notWant of STRUCTURE_ONLY) expect(srcs).not.toContain(notWant);
  });

  test.each([...SHARED, ...STRUCTURE_ONLY])('%s 파일이 실제로 존재한다', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });

  test.each(HTML_FILES)('%s 에서 모듈이 인라인보다 먼저 온다', (file) => {
    const html = read(file);
    const lastExternal = Math.max(
      ...modulesFor(file).map((rel) => html.indexOf(rel))
    );
    // 공통 이름을 처음 쓰는 인라인 스크립트의 위치
    const firstInline = html.indexOf('<script>', html.indexOf('js/planner/planner-scope.js'));
    expect(lastExternal).toBeGreaterThan(-1);
    expect(firstInline).toBeGreaterThan(lastExternal);
  });
});

describe('전역 식별자가 충돌하지 않는다 (흰 화면 방지)', () => {
  /** 해당 HTML 에 실제로 실리는 모듈들의 최상위 이름 → 정본 파일 */
  const namesFor = (file) => {
    const map = new Map();
    for (const rel of modulesFor(file)) {
      for (const n of topLevelNames(read(rel))) {
        if (!map.has(n)) map.set(n, rel);
      }
    }
    return map;
  };

  test('모듈끼리 서로 재선언하지 않는다', () => {
    // 구조 단계는 공통 3 + 엔진 을 한 전역 스코프에 올린다 — 넷을 같이 본다.
    const seen = new Map();
    const dup = [];
    for (const rel of [...SHARED, ...STRUCTURE_ONLY]) {
      for (const n of topLevelNames(read(rel))) {
        if (seen.has(n)) dup.push(`${n}: ${seen.get(n)} ↔ ${rel}`);
        else seen.set(n, rel);
      }
    }
    expect(dup).toEqual([]);
  });

  test.each(HTML_FILES)('%s 인라인이 모듈의 이름을 재선언하지 않는다', (file) => {
    const moduleNames = namesFor(file);
    const clashes = [];
    for (const body of inlineBodies(read(file))) {
      for (const n of topLevelNames(body)) {
        if (moduleNames.has(n)) clashes.push(`${n} (정본: ${moduleNames.get(n)})`);
      }
    }
    if (clashes.length) {
      throw new Error(
        `${file} 의 인라인 스크립트가 공통 모듈의 최상위 선언을 다시 선언합니다.\n` +
          '클래식 스크립트는 전역 렉시컬 스코프를 공유하므로 SyntaxError 가 나고\n' +
          '해당 인라인 스크립트 전체가 실행되지 않습니다 (= 흰 화면).\n  ' +
          clashes.join('\n  ')
      );
    }
    expect(clashes).toEqual([]);
  });
});

describe('실제 파서로 확인한다 (정적 검사가 놓치는 것)', () => {
  // 위의 식별자 비교는 우리가 만든 스캐너에 의존한다. 스캐너가 틀리면 가드도 틀린다.
  // 브라우저의 "전역 렉시컬 스코프 공유"는 스크립트들을 하나로 이어붙인 것과
  // 같은 재선언 규칙을 따르므로, 실제로 이어붙여 **엔진에게 파싱시켜** 확인한다.
  // (new Function 은 컴파일만 하고 실행하지 않는다.)
  const { collectScripts } = require('../test-utils/planner-harness');

  test.each(HTML_FILES)('%s 의 전체 스크립트가 하나로 파싱된다', (file) => {
    const joined = collectScripts(read(file)).map((s) => s.code).join('\n;\n');
    expect(() => new Function(joined)).not.toThrow(); // eslint-disable-line no-new-func
  });
});

describe('캐시 버전이 어긋나지 않는다 (반쪽 배포 방지)', () => {
  test('두 HTML 이 같은 ?v= 를 쓴다', () => {
    const versions = new Set();
    for (const file of HTML_FILES) {
      for (const s of scriptSrcs(read(file))) {
        const m = s.match(/[?&]v=([^&]+)/);
        if (s.includes('js/planner/')) {
          expect(m).not.toBeNull();       // 버전 없는 로드는 CDN 이 영원히 캐시한다
          versions.add(m[1]);
        }
      }
    }
    expect([...versions]).toHaveLength(1);
  });
});

describe('원본이 같은 커밋에서 지워졌다 (deprecated 마킹 금지)', () => {
  // 계획 불변식 4. 옮기고 남겨두면 어느 쪽이 정본인지 알 수 없게 된다.
  const MOVED = [
    // P1
    { name: 'PLANNER_SCOPE 정의', re: /const PLANNER_SCOPE = \(function/ },
    { name: 'scopedKey 정의', re: /function scopedKey\s*\(/ },
    { name: 'view 상태 정의', re: /const view = \{\s*panX/ },
    { name: 'SECTION_CONFIG 리터럴', re: /const SECTION_CONFIG = \{/ },
    // P2 — 계산 엔진 (js/planner/planner-engine.js 가 정본)
    { name: 'MASTER_RULES 리터럴', re: /const MASTER_RULES = \{/ },
    { name: 'getMoldingH 정의', re: /function getMoldingH\s*\(/ },
    { name: 'calcDoorCount 정의', re: /function calcDoorCount\s*\(/ },
    { name: 'distributeModules 정의', re: /function distributeModules\s*\(/ },
    { name: 'calcDefaultShelves 정의', re: /function calcDefaultShelves\s*\(/ },
    { name: 'collectXRanges 정의', re: /function collectXRanges\s*\(/ },
    { name: 'splitModuleByAppliance 정의', re: /function splitModuleByAppliance\s*\(/ },
    { name: 'autoCalcModule 정의', re: /function autoCalcModule\s*\(/ },
  ];

  test.each(HTML_FILES)('%s 에 옮겨간 원본이 남아 있지 않다', (file) => {
    const html = read(file);
    const left = MOVED.filter((m) => m.re.test(html)).map((m) => m.name);
    expect(left).toEqual([]);
  });
});
