/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, __dirname, process, global, expect */
/**
 * BOM 골든 비교 도우미.
 *
 * `__tests__/bom-golden-*.test.js` 가 쓴다. 픽스처(`./fixtures.js`)를 추출기에 넣은 결과를
 * `<name>.golden.json` 과 깊은 비교한다. 골든은 추출기 **현재 출력**을 그대로 저장한 것이지
 * 손으로 적은 정답이 아니다 — 값이 맞는지는 `__tests__/bom-body-thickness.test.js`,
 * `extractors-*.test.js` 같은 규칙 시험이 본다. 여기는 "바뀌었는가" 만 본다.
 *
 * 갱신:   UPDATE_GOLDEN=1 npx jest __tests__/bom-golden-*.test.js
 *         (PowerShell: $env:UPDATE_GOLDEN=1; npx jest __tests__/bom-golden-*.test.js)
 * 골든이 없으면 위 명령을 안내하는 오류로 실패한다 — 조용히 통과하지 않는다.
 *
 * 추출기 로드: extractors.js 의 CommonJS 이중 노출은 `MaterialExtractor` 만 내보내서
 * `HardwareExtractor`·`DrawingVisualizer` 를 얻을 수 없다. 그래서 planner-to-bom.test.js 가
 * ui-step1.js 에 쓰는 방식 그대로 — 소스를 읽어 Function 으로 평가해 세 클래스를 꺼낸다.
 * 파일 끝의 `window.DadamAgent` / `module.exports` 분기는 둘 다 가드가 있어 그냥 지나간다.
 */
const fs = require('fs');
const path = require('path');

const EXTRACTORS_PATH = path.join(__dirname, '../../js/detaildesign/extractors.js');
const GOLDEN_DIR = __dirname;

let cached = null;
/** extractors.js 를 한 번만 평가해 세 클래스를 돌려준다. `dlog` 는 파일이 전역으로 기대한다. */
function loadExtractors() {
  if (cached) return cached;
  if (typeof global.dlog !== 'function') global.dlog = () => {};
  const src = fs.readFileSync(EXTRACTORS_PATH, 'utf8');
  cached = new Function(`${src}\n; return { MaterialExtractor, HardwareExtractor, DrawingVisualizer };`)();
  return cached;
}

/** `s` 의 첫 n 줄 — CSV/CNC 는 머리글 + 첫 두 행이면 열 구성·엣지 매핑이 드러난다. */
function headLines(s, n = 3) {
  return s.split('\n').slice(0, n);
}

/**
 * 한 픽스처의 동결 대상 전부.
 *   materials / summary        MaterialExtractor.extract() (extractDate 는 뺀다 — 비결정)
 *   hardware / hardwareSummary HardwareExtractor.extract()
 *   csvHead / cncHead / hardwareCsvHead  내보내기 첫 3줄
 */
function snapshotOf(design) {
  const { MaterialExtractor, HardwareExtractor } = loadExtractors();
  const me = new MaterialExtractor();
  const he = new HardwareExtractor();
  const mat = me.extract(design);
  const hw = he.extract(design);
  // JSON 왕복으로 undefined 필드를 떨어뜨려 골든 파일과 같은 모양으로 맞춘다.
  return JSON.parse(JSON.stringify({
    materials: mat.materials,
    summary: mat.summary,
    hardware: hw.hardware,
    hardwareSummary: hw.summary,
    csvHead: headLines(me.toCSV(mat.materials)),
    cncHead: headLines(me.toCNC(mat.materials)),
    hardwareCsvHead: headLines(he.toCSV(hw.hardware)),
  }));
}

function goldenPath(name) {
  return path.join(GOLDEN_DIR, `${name}.golden.json`);
}

function shouldUpdate() {
  return process.env.UPDATE_GOLDEN === '1';
}

/**
 * 실제 출력을 골든과 비교한다. UPDATE_GOLDEN=1 이면 골든을 다시 쓰고 통과한다.
 * 골든이 없고 갱신 모드도 아니면 생성 방법을 담은 오류를 던진다.
 */
function expectGolden(name, actual) {
  const file = goldenPath(name);
  if (shouldUpdate()) {
    fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(
      `BOM 골든 파일이 없습니다: ${path.relative(process.cwd(), file)}\n` +
      '  생성:  UPDATE_GOLDEN=1 npx jest __tests__/bom-golden-*.test.js\n' +
      '  (PowerShell: $env:UPDATE_GOLDEN=1; npx jest __tests__/bom-golden-*.test.js)\n' +
      '  골든은 추출기 현재 출력을 동결한 것이다 — 생성 뒤 diff 를 눈으로 확인하고 별도 커밋으로 넣는다.',
    );
  }
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(actual).toEqual(golden);
}

/** 자재 행의 필드 집합 — I4 "필드 추가만" 을 지키는지 보는 기준 (계획 §3). */
const MATERIAL_ROW_KEYS = ['module', 'part', 'material', 'thickness', 'w', 'h', 'qty', 'edge', 'note', 'finishCode', 'itemLabel'];
const HARDWARE_ROW_KEYS = ['category', 'item', 'manufacturer', 'spec', 'qty', 'unit', 'note', 'itemLabel'];

module.exports = {
  loadExtractors,
  snapshotOf,
  expectGolden,
  goldenPath,
  shouldUpdate,
  MATERIAL_ROW_KEYS,
  HARDWARE_ROW_KEYS,
};
