/**
 * 2026-11-20: 홍보용 캐러셀 장의 HTML · 게시 글 (scripts/carousel-html.mjs).
 *
 * 고정하는 것:
 *   1) 사진 장마다 「AI 연출 이미지」와 색 이름 · 주소가 들어간다 — 시공 사례처럼 보이지 않게
 *   2) 제목은 첫 장에만 붙는다
 *   3) 마지막 장과 게시 글에도 AI 연출 고지가 있다
 *   4) 게시 글의 링크에 유입 꼬리표(utm_source · utm_medium · utm_campaign)가 붙는다
 *   5) 색 이름 · 제목에 든 꺾쇠 · 따옴표는 그대로 HTML 이 되지 않는다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CAROUSEL_SIZE,
  slideHtml,
  ctaHtml,
  buildCaption,
  toneParts,
  esc,
} from '../scripts/carousel-html.mjs';

const TONES = [
  '그레이 · 월넛',
  '세이지 · 크림',
  '블랙 · 오크',
  '테라코타 · 크림',
  '화이트 · 그레이지',
];

test('크기는 인스타그램 4:5', () => {
  assert.deepEqual(CAROUSEL_SIZE, { width: 1080, height: 1350 });
});

test('사진 장에는 AI 연출 표시 · 색 이름 · 주소가 들어간다', () => {
  const h = slideHtml({ src: 'file:///a.jpg', tone: TONES[1], index: 2, total: 5 });
  assert.match(h, /AI 연출 이미지/);
  assert.ok(h.includes('세이지 · 크림'));
  assert.ok(h.includes('상부장 세이지 · 하부장 크림'));
  assert.ok(h.includes('dadamfurniture.com/segan'));
  assert.ok(h.includes('2 / 5'));
  assert.doesNotMatch(h, /class="title"/, '둘째 장에는 제목이 없다');
});

test('제목은 첫 장에만', () => {
  const h = slideHtml({
    src: 'file:///a.jpg',
    tone: TONES[0],
    index: 1,
    total: 5,
    title: '같은 주방, 다른 색',
  });
  assert.match(h, /class="title">같은 주방, 다른 색</);
});

test('붙박이장은 도어 · 포인트로 적는다', () => {
  assert.equal(toneParts('네이비 · 베이지', 'wardrobe'), '도어 네이비 · 포인트 베이지');
  assert.equal(toneParts('한 낱말'), '');
});

test('마지막 장: 색 다섯 줄과 AI 연출 고지', () => {
  const h = ctaHtml({ tones: TONES });
  for (const t of TONES) assert.ok(h.includes(t));
  assert.match(h, /AI 로 연출한 이미지이며 실제 시공 사진이 아닙니다/);
  assert.ok(h.includes('dadamfurniture.com/segan'));
});

test('게시 글: 번호 · 고지 · 꼬리표 붙은 링크', () => {
  const c = buildCaption({
    title: '같은 주방, 다른 색',
    tones: TONES,
    campaign: 'kitchen-tones_2026-11',
  });
  assert.ok(c.includes('① 그레이 · 월넛'));
  assert.ok(c.includes('⑤ 화이트 · 그레이지'));
  assert.match(c, /AI 로 연출한 이미지입니다\. 실제 시공 사진이 아닙니다/);
  assert.ok(
    c.includes(
      'https://dadamfurniture.com/segan/?utm_source=instagram&utm_medium=social&utm_campaign=kitchen-tones_2026-11'
    )
  );
  assert.match(c, /#주방인테리어/);
});

test('게시 글 링크의 utm_source — 채널마다 (캐러셀 스크립트가 spec.source · --source 를 넘긴다)', () => {
  const c = buildCaption({
    title: '같은 주방, 다른 색',
    tones: TONES,
    source: 'threads',
    campaign: 'tones',
  });
  assert.ok(
    c.includes(
      'https://dadamfurniture.com/segan/?utm_source=threads&utm_medium=social&utm_campaign=tones'
    )
  );
  const script = readFileSync(new URL('../scripts/carousel.mjs', import.meta.url), 'utf8');
  assert.match(
    script,
    /source: (typeof a.source === 'string' && a.source) || spec.source || undefined,/
  );
});

test('꺾쇠 · 따옴표는 HTML 이 되지 않는다', () => {
  assert.equal(esc('<b>"x"&'), '&lt;b&gt;&quot;x&quot;&amp;');
  const h = slideHtml({ src: 'file:///a.jpg', tone: '<script>x</script> · y', index: 1, total: 1 });
  assert.doesNotMatch(h, /<script>x/);
});

test('붙박이장 · 수납장은 주방 말이 나오지 않는다', () => {
  const tones = ['블랙 · 오크', '크림 · 월넛'];
  const w = buildCaption({ title: '같은 붙박이장, 다른 색', tones, subject: 'wardrobe' });
  assert.match(w, /내 방 사진으로도/);
  assert.match(w, /#붙박이장 /);
  assert.doesNotMatch(w, /주방/);
  const s = buildCaption({ title: '같은 수납장, 다른 색', tones, subject: 'storage' });
  assert.match(s, /내 집 사진으로도/);
  assert.match(s, /#수납장 /);
  assert.doesNotMatch(s, /주방/);
  assert.match(
    ctaHtml({ tones, subject: 'wardrobe' }),
    /class="head">내 방 사진으로\n색을 바꿔 보세요</
  );
  assert.match(ctaHtml({ tones }), /내 주방 사진으로/);
  assert.match(
    ctaHtml({ tones, subject: 'wardrobe', headline: '직접 적은 글' }),
    /class="head">직접 적은 글</
  );
  // 모르는 품목은 주방 말, 직접 적은 해시태그는 그대로
  assert.match(buildCaption({ title: 't', tones, subject: 'nope' }), /내 주방 사진으로도/);
  assert.match(
    buildCaption({ title: 't', tones, subject: 'wardrobe', tags: ['하나'] }),
    /\n#하나$/
  );
});

test('자재 이름처럼 긴 색 이름은 작은 글씨 · 게시 글은 한 줄에 하나', () => {
  const tones = ['매트 라이트그레이 · 카카오월넛', '매트 미스트그린 · 매트 아이보리'];
  const h = slideHtml({ src: 'a.jpg', tone: tones[0], index: 1, total: 2 });
  assert.match(h, /class="tone long">매트 라이트그레이 · 카카오월넛</);
  assert.match(h, /상부장 매트 라이트그레이 · 하부장 카카오월넛/);
  assert.match(
    slideHtml({ src: 'a.jpg', tone: '크림 · 월넛', index: 1, total: 2 }),
    /class="tone">크림/
  );
  const c = buildCaption({ title: 't', tones });
  assert.ok(c.includes('① 매트 라이트그레이 · 카카오월넛\n② 매트 미스트그린 · 매트 아이보리'));
  assert.match(c, /색은 실제 자재와 다를 수 있습니다/);
});
