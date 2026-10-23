/**
 * 작업지시서 묶음 HTML 골든 (CAD 베타 PR17 — "묶음 HTML 골든이 통과").
 *   조립 명세가 없는 옛 스냅샷(fixtures/work-order-v2.js)은 판재 도면 · 모듈 단면이 붙기 전과 **바이트 그대로**여야 한다.
 *   갱신: UPDATE_GOLDEN=1 node --test test/work-order-golden.test.js  (의도한 변경일 때만 — 별도 커밋으로)
 *   줄바꿈은 LF 로 맞춰 비교한다 (Windows CRLF 체크아웃에서도 같게).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as fx from './fixtures/work-order-v2.js';
import { renderWorkOrder } from '../src/templates/work-order.js';

const PACKS = ['all', 'cut', 'cut-vendor', 'assembly', 'door', 'labels'];
const lf = (s) => s.split('\r\n').join('\n');

for (const pack of PACKS) {
  test(`옛 스냅샷(명세 없음) ${pack} 묶음 = 골든`, () => {
    const url = new URL(`./fixtures/work-order-${pack}.golden.html`, import.meta.url);
    const html = renderWorkOrder(fx.doc(), fx.snapshot(), { toolbar: false, pack });
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(url)) {
      writeFileSync(url, html, 'utf8');
      return;
    }
    assert.equal(lf(html), lf(readFileSync(url, 'utf8')));
  });
}
