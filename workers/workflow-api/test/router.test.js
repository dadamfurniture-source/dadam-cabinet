import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router.js';

const noop = () => {};

const router = createRouter([
  { method: 'GET', path: '/health', handler: noop },
  { method: 'POST', path: '/designs/:designId/snapshots', handler: noop },
  { method: 'GET', path: '/designs/:designId/snapshots', handler: noop },
  { method: 'GET', path: '/snapshots/:snapshotId', handler: noop },
]);

test('정적 경로 매치', () => {
  const r = router.resolve('GET', '/health');
  assert.deepEqual(r.params, {});
});

test('경로 파라미터 추출', () => {
  const r = router.resolve('POST', '/designs/abc-123/snapshots');
  assert.deepEqual(r.params, { designId: 'abc-123' });
});

test('같은 경로의 서로 다른 메서드를 구분한다', () => {
  assert.ok(router.resolve('GET', '/designs/x/snapshots'));
  assert.ok(router.resolve('POST', '/designs/x/snapshots'));
});

test('트레일링 슬래시를 허용한다', () => {
  const r = router.resolve('GET', '/health/');
  assert.ok(r && r.params);
});

test('경로는 맞고 메서드가 다르면 method_mismatch', () => {
  assert.equal(router.resolve('DELETE', '/health'), 'method_mismatch');
});

test('없는 경로는 null', () => {
  assert.equal(router.resolve('GET', '/nope'), null);
});

test('세그먼트 수가 다르면 매치되지 않는다', () => {
  assert.equal(router.resolve('GET', '/designs/x/snapshots/extra'), null);
  assert.equal(router.resolve('GET', '/designs'), null);
});

test('URL 인코딩된 파라미터를 디코딩한다', () => {
  const r = router.resolve('GET', '/snapshots/a%2Fb');
  assert.deepEqual(r.params, { snapshotId: 'a/b' });
});

test('빈 파라미터는 매치되지 않는다', () => {
  // '/designs//snapshots' → 빈 세그먼트가 제거되어 길이가 달라진다
  assert.equal(router.resolve('POST', '/designs//snapshots'), null);
});
