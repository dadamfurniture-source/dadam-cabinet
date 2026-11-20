/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 가전 모델 제품 사진 — 치수 검증과 상관없이 (2026-10-20 「검증된 모델만」 → 2026-11-20 대표님 「미검증도 사진은 가져오기」).
 *   관리 화면 admin/appliances.html 의 순수 함수 photoActionHtml(r):
 *     - 원본 주소 → 「사진 가져오기」(이미 가져왔으면 「사진 다시」) 버튼 — 검증 · 미검증 같다
 *     - 원본 주소 없음 → 아무것도 없음
 *   워커 쪽은 workers/generate-api/test/appliance-image.test.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').split('\r\n').join('\n');
const AP = read('admin/appliances.html');

/** HTML 안의 function photoActionHtml(r) { … } 을 그대로 꺼내 실행한다 — 다른 전역에 기대지 않는 순수 함수여야 한다 */
function loadPhotoActionHtml() {
  const m = AP.match(/\n {6}function photoActionHtml\(r\) \{\n[\s\S]*?\n {6}\}\n/);
  if (!m) throw new Error('photoActionHtml 을 admin/appliances.html 에서 찾지 못했다');
  return new Function(`${m[0]}; return photoActionHtml;`)();
}

const ID = '33333333-3333-4333-8333-333333333333';
const SRC = 'https://images.samsung.com/kdp/goods/a.png';

describe('admin/appliances.html — photoActionHtml: 원본 주소가 있으면 「사진 가져오기」', () => {
  const photoActionHtml = loadPhotoActionHtml();

  test('원본 주소 → 사진 가져오기 버튼 (data-id), 검증 · 미검증 같다, 이미 가져왔으면 「사진 다시」', () => {
    for (const verified of [true, false, null, undefined]) {
      const html = photoActionHtml({ id: ID, verified, image_source_url: SRC });
      expect(html).toContain('class="photo-copy"');
      expect(html).toContain(`data-id="${ID}"`);
      expect(html).toContain('사진 가져오기');
      expect(html).not.toContain('치수 미검증');
    }
    const again = photoActionHtml({ id: ID, verified: false, image_source_url: SRC, image_path: `${ID}/photo.png` });
    expect(again).toContain('사진 다시');
  });

  test('원본 주소가 없으면 검증 여부와 관계없이 아무것도 없다', () => {
    expect(photoActionHtml({ id: ID, verified: true })).toBe('');
    expect(photoActionHtml({ id: ID, verified: false, image_source_url: null })).toBe('');
  });

  test('행 렌더가 그 함수를 쓰고, 일괄 가져오기는 검증으로 거르지 않는다', () => {
    expect(AP).toContain('${canEdit ? `${photoActionHtml(r)}');
    expect(AP).toMatch(/const todo = currentRows\.filter\(\(r\) => shown\.has\(r\.id\) && r\.image_source_url && !r\.image_path\);/);
  });
});
