/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 사이트 첫 화면(index.html) → AI 스튜디오는 한 번에 넘어가야 한다.
 * 호스팅이 /ai-design.html 을 /ai-design 으로 308 넘기므로, .html 로 보내면 한 번 더 돈다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('index.html — 확장자 없는 /ai-design 으로 바로', () => {
  test('스크립트: 검색어·해시를 붙여 replace', () => {
    expect(HTML).toMatch(/location\.replace\('ai-design' \+ location\.search \+ location\.hash\)/);
  });

  test('스크립트가 꺼졌을 때: meta refresh · 바로 가기 링크', () => {
    expect(HTML).toMatch(/<meta http-equiv="refresh" content="0; url=ai-design" \/>/);
    expect(HTML).toMatch(/<a href="ai-design">바로 가기<\/a>/);
  });

  test('canonical 도 넘어간 뒤의 주소', () => {
    expect(HTML).toMatch(
      /<link rel="canonical" href="https:\/\/dadamfurniture\.com\/ai-design" \/>/
    );
  });

  test('ai-design.html 로 보내는 곳이 남아 있지 않다 (HTML 주석 빼고)', () => {
    expect(HTML.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/ai-design\.html/);
  });
});
