/**
 * 한 장에 두 장 (2026-10-08).
 * 참고 이미지가 두 장을 이어 붙인 사진이면 결과도 두 장짜리로 나왔다.
 *   - 결과 비율은 방 사진을 따른다 (aspectRatioOf)
 *   - 참고가 있으면 설치 문장이 "결과는 한 장" 을 말하고, 검사에 split_frame 이 붙는다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aspectRatioOf, imageDimensions } from '../src/gemini.js';
import {
  ALL_QC_ISSUE_CODES,
  REFS_QC_FIXES,
  buildInstallPrompt,
  buildQcPrompt,
  parseQc,
} from '../src/prompts.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

/** APP0 하나 + SOF0 를 가진 최소 JPEG 머리 */
function jpeg(width, height) {
  return b64([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

function png(width, height) {
  const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
  const be = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return b64([...head, ...be(width), ...be(height), 8, 2, 0, 0, 0]);
}

test('JPEG·PNG 머리에서 가로·세로를 읽는다', () => {
  assert.deepEqual(imageDimensions(jpeg(1600, 1200)), { width: 1600, height: 1200 });
  assert.deepEqual(imageDimensions(png(900, 1600)), { width: 900, height: 1600 });
  assert.equal(imageDimensions('bm90IGFuIGltYWdl'), null);
  assert.equal(imageDimensions(''), null);
});

test('방 사진과 가장 가까운 생성 비율을 고른다', () => {
  assert.equal(aspectRatioOf({ base64: jpeg(1600, 1200) }), '4:3');
  assert.equal(aspectRatioOf({ base64: jpeg(1200, 1600) }), '3:4'); // 폰 세로
  assert.equal(aspectRatioOf({ base64: jpeg(1600, 900) }), '16:9');
  assert.equal(aspectRatioOf({ base64: png(1000, 1000) }), '1:1');
  assert.equal(aspectRatioOf({ base64: 'garbage' }), undefined); // 못 읽으면 모델에 맡긴다
  assert.equal(aspectRatioOf(null), undefined);
});

const CTX = {
  category: 'sink',
  wallW: 3000,
  wallH: 2400,
  waterPct: 30,
  exhaustPct: 70,
  style: 'modern-minimal',
  doorColor: 'white',
  doorFinish: 'matte',
  fridgeBrand: 'Samsung',
  fridgePosition: 'left',
};

test('참고 이미지가 있으면 설치 문장이 "결과는 한 장" 을 말한다', () => {
  assert.match(buildInstallPrompt({ ...CTX, refCount: 1 }), /one single photo, never two panels/);
  assert.doesNotMatch(buildInstallPrompt({ ...CTX, refCount: 0 }), /two panels/);
});

test('split_frame 검사는 참고 이미지가 있을 때만 붙고, 걸리면 FIX 로 돌아온다', () => {
  assert.match(buildQcPrompt({ ...CTX, refCount: 2 }), /- split_frame:/);
  assert.doesNotMatch(buildQcPrompt({ ...CTX, refCount: 0 }), /split_frame/);
  assert.ok(ALL_QC_ISSUE_CODES.includes('split_frame'));
  assert.deepEqual(parseQc('{"ok":false,"issues":["split_frame"],"note":"x"}').issues, ['split_frame']);
  const retry = buildInstallPrompt({ ...CTX, refCount: 1 }, { fix: ['split_frame'] });
  assert.ok(retry.includes(REFS_QC_FIXES.split_frame));
});
