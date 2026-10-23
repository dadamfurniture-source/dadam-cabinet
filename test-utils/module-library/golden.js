/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, module, __dirname, process, expect */
/**
 * 모듈 라이브러리 BOM 골든 — 모듈마다 `golden/<id>.golden.json` (계획 §3 게이트 4).
 *
 * 내용은 BOM 골든과 같은 스냅샷이다 (test-utils/bom-golden/golden.js snapshotOf — 자재·요약·엣지·철물·내보내기 첫 줄).
 * 골든은 추출기 **현재 출력**을 굳힌 것이지 손으로 적은 정답이 아니다. 규칙이 의도적으로 바뀌는 PR 은 이 골든도 같이 갱신한다.
 *
 * 갱신:  UPDATE_MODLIB_GOLDEN=1 npx jest __tests__/module-library
 *        (PowerShell: $env:UPDATE_MODLIB_GOLDEN=1; npx jest __tests__/module-library)
 * 골든이 없고 갱신 모드도 아니면 생성 방법을 담은 오류로 실패한다 — 새 모듈은 조용히 통과하지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { snapshotOf } = require('../bom-golden/golden');

const GOLDEN_DIR = path.join(__dirname, 'golden');

function goldenPath(id) {
  return path.join(GOLDEN_DIR, `${id}.golden.json`);
}

function shouldUpdate() {
  return process.env.UPDATE_MODLIB_GOLDEN === '1';
}

/** 골든 파일 목록 (확장자 뺀 모듈 id). */
function goldenIds() {
  if (!fs.existsSync(GOLDEN_DIR)) return [];
  return fs.readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.golden.json')).map((f) => f.replace(/\.golden\.json$/, '')).sort();
}

function expectModuleGolden(id, design) {
  const actual = snapshotOf(design);
  const file = goldenPath(id);
  if (shouldUpdate()) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`, 'utf8');
    return;
  }
  if (!fs.existsSync(file)) {
    throw new Error(
      `모듈 골든 파일이 없습니다: ${path.relative(process.cwd(), file)}\n` +
      '  생성:  UPDATE_MODLIB_GOLDEN=1 npx jest __tests__/module-library\n' +
      '  (PowerShell: $env:UPDATE_MODLIB_GOLDEN=1; npx jest __tests__/module-library)\n' +
      '  생성 뒤 diff 를 눈으로 확인한다 — 새 모듈 파일만 생겨야 한다.',
    );
  }
  expect(actual).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { GOLDEN_DIR, goldenPath, goldenIds, shouldUpdate, expectModuleGolden };
