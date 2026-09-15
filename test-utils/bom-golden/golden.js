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
 * 추출기 로드: B1 부터 extractors.js 의 CommonJS 이중 노출이 세 클래스를 다 내보낸다 — require 로 받는다.
 * (B0 땐 `MaterialExtractor` 만 나와 소스를 Function 으로 평가하는 우회를 썼다.)
 *
 * B1 add-only 증명 (`__tests__/bom-golden-addonly.test.js`): B0 골든에서 새 키를 뺀 모양의 다이제스트를
 * `base-b0.digest.json` 에 굳혀 두었다. 현재 골든에서 B1 이 더한 키(NEW_ROW_KEYS_B1)·edgeBanding·cncHead 를
 * 떼어 낸 다이제스트가 그것과 같으면 옛 키·값이 하나도 안 바뀐 것이다. 값이 **의도적으로** 바뀌는 단계(B2…)는
 * 그 PR 에서 `UPDATE_BASE_DIGEST=1` 로 기준을 다시 굳히고 커밋 메시지에 이유를 적는다.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GOLDEN_DIR = __dirname;
const BASE_DIGEST_PATH = path.join(GOLDEN_DIR, 'base-b0.digest.json');

let cached = null;
/** extractors.js 를 한 번만 읽어 세 클래스를 돌려준다. `dlog` 는 파일이 전역으로 기대한다. */
function loadExtractors() {
  if (cached) return cached;
  if (typeof global.dlog !== 'function') global.dlog = () => {};
  const { MaterialExtractor, HardwareExtractor, DrawingVisualizer } = require('../../js/detaildesign/extractors.js');
  cached = { MaterialExtractor, HardwareExtractor, DrawingVisualizer };
  return cached;
}

/** `s` 의 첫 n 줄 — CSV/CNC 는 머리글 + 첫 두 행이면 열 구성·엣지 매핑이 드러난다. */
function headLines(s, n = 3) {
  return s.split('\n').slice(0, n);
}

/**
 * 한 픽스처의 동결 대상 전부.
 *   materials / summary        MaterialExtractor.extract() (extractDate 는 뺀다 — 비결정)
 *   edgeBanding                B1: 두께별 엣지밴딩 총길이 (summary 의 형제 키)
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
    edgeBanding: mat.edgeBanding,
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
const MATERIAL_ROW_KEYS_B0 = ['module', 'part', 'material', 'thickness', 'w', 'h', 'qty', 'edge', 'note', 'finishCode', 'itemLabel'];
/** B1 이 더한 키 (bom-protocol.md §7-1·§7-2). 새 단계가 키를 더하면 여기에 잇는다. */
const NEW_ROW_KEYS_B1 = ['partId', 'slot', 'edges', 'edgeLen', 'edgeT', 'edgeCode'];
const MATERIAL_ROW_KEYS = [
  'module', 'part', 'material', 'thickness', 'w', 'h', 'qty', 'edge', 'note', 'finishCode',
  ...NEW_ROW_KEYS_B1,
  'itemLabel',
];
const HARDWARE_ROW_KEYS = ['category', 'item', 'manufacturer', 'spec', 'qty', 'unit', 'note', 'itemLabel'];

/** 키를 정렬한 결정적 JSON — 다이제스트용. 키 순서가 달라도 같은 값이면 같은 다이제스트다. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * 스냅샷을 B0 모양으로 깎는다: 자재 행에서 B1 키를 빼고, edgeBanding 과 cncHead 를 뗀다.
 * cncHead 는 toCNC 의 '3면' 가지 수정(B1 첫 커밋)으로 2행이 바뀌므로 기준 비교에서 뺀다 —
 * 그 변화는 bom-part-id.test.js 가 따로 잠근다.
 */
function stripToBase(snapshot) {
  const out = JSON.parse(JSON.stringify(snapshot));
  out.materials = (out.materials || []).map((row) => {
    const r = {};
    Object.keys(row).forEach((k) => { if (NEW_ROW_KEYS_B1.indexOf(k) < 0) r[k] = row[k]; });
    return r;
  });
  delete out.edgeBanding;
  delete out.cncHead;
  return out;
}

function digestOf(obj) {
  return crypto.createHash('sha256').update(canonical(obj), 'utf8').digest('hex');
}

function readBaseDigest() {
  if (!fs.existsSync(BASE_DIGEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASE_DIGEST_PATH, 'utf8'));
}

/** UPDATE_BASE_DIGEST=1 — 현재 골든 파일들에서 기준 다이제스트를 다시 굳힌다. */
function writeBaseDigest(names, note) {
  const digests = {};
  names.forEach((name) => {
    const golden = JSON.parse(fs.readFileSync(goldenPath(name), 'utf8'));
    digests[name] = digestOf(stripToBase(golden));
  });
  const doc = {
    note: note || 'B0 골든(#633)에서 B1 새 키·edgeBanding·cncHead 를 뺀 모양의 sha256. 갱신: UPDATE_BASE_DIGEST=1 npx jest __tests__/bom-golden-addonly.test.js',
    baseRowKeys: MATERIAL_ROW_KEYS_B0,
    strippedKeys: NEW_ROW_KEYS_B1,
    digests,
  };
  fs.writeFileSync(BASE_DIGEST_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return doc;
}

module.exports = {
  loadExtractors,
  snapshotOf,
  expectGolden,
  goldenPath,
  shouldUpdate,
  MATERIAL_ROW_KEYS,
  MATERIAL_ROW_KEYS_B0,
  NEW_ROW_KEYS_B1,
  HARDWARE_ROW_KEYS,
  BASE_DIGEST_PATH,
  canonical,
  stripToBase,
  digestOf,
  readBaseDigest,
  writeBaseDigest,
};
