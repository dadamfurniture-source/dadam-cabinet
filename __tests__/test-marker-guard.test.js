/**
 * P0: 소스-슬라이스 테스트의 "거짓 통과" 감시.
 *
 * 문제:
 *   여러 테스트가 소스를 문자열로 잘라 검사한다.
 *     const fn = SRC.slice(SRC.indexOf('function heightPartsOf'), SRC.indexOf('function bodyHeightOf'));
 *     expect(fn).not.toMatch(/Date\(/);
 *   함수를 다른 파일로 옮기면 `indexOf` 가 **-1** 을 반환하고 `slice(-1, N)` 이
 *   **빈 문자열**이 되어 `not.toMatch` 가 **초록으로 통과**한다.
 *   즉 리팩터링하면 테스트가 깨지는 게 아니라 조용히 거짓말을 시작한다.
 *
 *   엔진을 `js/planner/` 로 분리하는 것이 이 계획의 P1~P2 다. 그 전에
 *   "마커가 사라지면 큰 소리로 실패하는" 장치가 있어야 한다.
 *
 * 이 테스트가 하는 일:
 *   테스트 파일들이 `indexOf('...')` 로 찾는 마커 문자열을 전부 수집해,
 *   그 마커가 **어느 소스 파일에도 존재하지 않으면** 실패시킨다.
 *
 * 마커를 잃은 테스트를 발견하면:
 *   그 테스트를 하네스 기반(`test-utils/planner-harness.js`)으로 이관하라.
 *   마커를 되살리는 것은 임시방편이다.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 슬라이스 검사가 대상으로 삼는 소스들 */
const SOURCES = [
  'mockup-shell.html',
  'mockup-structure.html',
  'confirm.html',
  'erp.html',
  'detaildesign.html',
  'js/detaildesign/ui-step1.js',
  'js/detaildesign/ui-workspace.js',
  'js/detaildesign/workflow-client.js',
  'js/detaildesign/data-constants.js',
  'js/detaildesign/extractors.js',
  'js/detaildesign/corner-engine.js',
  'database/cd4-install-domain.sql',
  'database/cd5-erp.sql',
  // W12-23: 접근 게이트 — 관리자 판정과 상세설계 승인 조회가 여기 산다.
  'js/admin-access.js',
  'js/detaildesign-access.js',
];

/** 여기 아래는 통째로 훑는다 — 파일이 늘어도 가드가 따라간다 */
const SOURCE_DIRS = [
  'js/planner',            // P1 에서 생김
  'js/detaildesign',
  'workers/workflow-api/src',
  'workers/workflow-api/src/templates',
  'workers/generate-api/src',
  'workers/generate-api/src/prompts',
];

/** CRLF 를 정규화한다 — 올바른 테스트도 이렇게 읽어야 마커가 맞는다 */
const norm = (t) => t.split('\r\n').join('\n');

function readAll() {
  const out = {};
  for (const rel of SOURCES) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) out[rel] = norm(fs.readFileSync(abs, 'utf8'));
  }
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      const fp = path.join(abs, f);
      if (fs.statSync(fp).isFile() && /\.(js|mjs|sql)$/.test(f)) {
        out[dir + '/' + f] = norm(fs.readFileSync(fp, 'utf8'));
      }
    }
  }
  return out;
}

/** 테스트 파일에서 indexOf('...') / indexOf("...") 의 인자를 뽑는다 */
function markersOf(src) {
  const out = new Set();
  const re = /\.indexOf\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    // 테스트 소스의 `\n` 은 런타임에 실제 개행이다 — 풀어야 소스와 대조된다
    const lit = m[2]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\(['"\\])/g, '$1');
    // 'function foo' / 'const BAR =' 처럼 소스에 실제로 있어야 하는 것만 본다.
    // 짧은 조각(예: '{')은 어디에나 있으므로 의미가 없다.
    if (lit.length >= 8) out.add(lit);
  }
  return [...out];
}

describe('소스 슬라이스 마커가 살아 있다', () => {
  const sources = readAll();
  const testFiles = fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith('.test.js') && f !== 'test-marker-guard.test.js');

  const findings = [];
  for (const tf of testFiles) {
    const src = fs.readFileSync(path.join(__dirname, tf), 'utf8');
    for (const marker of markersOf(src)) {
      const found = Object.entries(sources).some(([, body]) => body.includes(marker));
      if (!found) findings.push({ test: tf, marker });
    }
  }

  test('모든 마커가 어떤 소스에든 존재한다', () => {
    if (findings.length) {
      const lines = findings.map((f) => `  ${f.test}  →  ${JSON.stringify(f.marker)}`).join('\n');
      throw new Error(
        '슬라이스 마커가 소스에서 사라졌습니다. 해당 테스트는 빈 문자열을 검사하며\n' +
          '**거짓으로 통과**합니다. 하네스 기반으로 이관하세요.\n' + lines
      );
    }
    expect(findings).toEqual([]);
  });

  test('감시 대상 테스트가 실제로 존재한다 (가드가 무의미해지지 않게)', () => {
    // 슬라이스 방식을 전부 이관하면 이 테스트를 삭제해도 된다.
    const usingSlices = testFiles.filter((tf) =>
      markersOf(fs.readFileSync(path.join(__dirname, tf), 'utf8')).length > 0
    );
    expect(usingSlices.length).toBeGreaterThan(0);
  });
});

describe('가드가 실제로 동작하는지 (자기 검증)', () => {
  test('사라진 마커를 잡아낸다', () => {
    const sources = { 'fake.js': 'function bodyHeightOf(){}' };
    const fakeTest = "const fn = S.slice(S.indexOf('function heightPartsOf'), S.indexOf('function bodyHeightOf'));";
    const missing = markersOf(fakeTest).filter(
      (mk) => !Object.values(sources).some((b) => b.includes(mk))
    );
    expect(missing).toEqual(['function heightPartsOf']);
  });

  test('슬라이스가 -1 이면 빈 문자열이 되어 not.toMatch 가 통과한다는 사실', () => {
    const moved = 'function bodyHeightOf(){}';
    const slice = moved.slice(moved.indexOf('function heightPartsOf'), moved.indexOf('function bodyHeightOf'));
    expect(slice).toBe('');
    // 이것이 바로 위험의 실체 — 빈 문자열은 어떤 not.toMatch 도 통과시킨다
    expect(slice).not.toMatch(/Date\(|toISOString/);
  });
});
