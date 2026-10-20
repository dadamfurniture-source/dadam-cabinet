/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 가전 모델 제품 사진 — 치수 검증된 모델만 (2026-10-20 사장님 결정).
 *   관리 화면 admin/appliances.html 의 순수 함수 photoActionHtml(r):
 *     - 검증(verified = true) + 원본 주소 → 「사진 가져오기」(이미 가져왔으면 「사진 다시」) 버튼
 *     - 미검증 + 원본 주소 → 버튼 없이 짧은 안내 (구매처 설치 도면 가이드로 검증 뒤)
 *     - 원본 주소 없음 → 아무것도 없음
 *   워커 쪽 관문은 workers/generate-api/test/appliance-image.test.js (model_unverified).
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

describe('admin/appliances.html — photoActionHtml: 검증된 모델만 「사진 가져오기」', () => {
  const photoActionHtml = loadPhotoActionHtml();

  test('검증 + 원본 주소 → 사진 가져오기 버튼 (data-id), 이미 가져왔으면 「사진 다시」', () => {
    const html = photoActionHtml({ id: ID, verified: true, image_source_url: SRC });
    expect(html).toContain('class="photo-copy"');
    expect(html).toContain(`data-id="${ID}"`);
    expect(html).toContain('사진 가져오기');
    expect(html).not.toContain('치수 미검증');
    const again = photoActionHtml({ id: ID, verified: true, image_source_url: SRC, image_path: `${ID}/photo.png` });
    expect(again).toContain('사진 다시');
  });

  test('미검증(false · null · 없음 · 문자열) + 원본 주소 → 버튼 없이 안내만', () => {
    for (const verified of [false, null, undefined, 'true']) {
      const html = photoActionHtml({ id: ID, verified, image_source_url: SRC });
      expect(html).not.toContain('photo-copy');
      expect(html).not.toContain('<button');
      expect(html).toContain('치수 미검증');
      expect(html).toContain('구매처에 설치 도면 가이드를 요청해 검증한 뒤 가져올 수 있습니다');
    }
  });

  test('원본 주소가 없으면 검증 여부와 관계없이 아무것도 없다', () => {
    expect(photoActionHtml({ id: ID, verified: true })).toBe('');
    expect(photoActionHtml({ id: ID, verified: false, image_source_url: null })).toBe('');
  });

  test('행 렌더가 그 함수를 쓰고, 일괄 가져오기도 검증된 행만 고른다', () => {
    expect(AP).toContain('${canEdit ? `${photoActionHtml(r)}');
    expect(AP).toMatch(/const todo = currentRows\.filter\(\(r\) => [^\n]*r\.verified === true/);
  });

  test('서버가 model_unverified 로 거절하면 그 메시지를 그대로 보인다 — 워커 메시지를 바꿔 쓰지 않는다', () => {
    expect(AP).toContain('throw new Error(out.error || `HTTP ${res.status}`)');
    expect(AP).toContain('alert(`사진 가져오기 실패 — ${row.brand} ${row.model_name}\\n${err.message}`)');
  });
});
