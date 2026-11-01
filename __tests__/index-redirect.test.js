/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 사이트 첫 화면(index.html) → SEGAN 앱 「만들기」(segan/) 로 한 번에 넘어가야 한다.
 * 호스팅이 /segan/index.html 을 /segan/ 으로 308 넘기므로, index.html 로 보내면 한 번 더 돈다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('index.html — segan/ 으로 바로', () => {
  test('스크립트: 검색어·해시를 붙여 replace', () => {
    expect(HTML).toMatch(/location\.replace\('segan\/' \+ location\.search \+ location\.hash\)/);
  });

  test('스크립트가 꺼졌을 때: meta refresh · 바로 가기 링크', () => {
    expect(HTML).toMatch(/<meta http-equiv="refresh" content="0; url=segan\/" \/>/);
    expect(HTML).toMatch(/<a href="segan\/">바로 가기<\/a>/);
  });

  test('canonical 도 넘어간 뒤의 주소', () => {
    expect(HTML).toMatch(/<link rel="canonical" href="https:\/\/dadamfurniture\.com\/segan\/" \/>/);
  });

  test('옛 메인(ai-design) 이나 segan/index.html 로 보내는 곳이 남아 있지 않다 (HTML 주석 빼고)', () => {
    const code = HTML.replace(/<!--[\s\S]*?-->/g, '');
    expect(code).not.toMatch(/ai-design/);
    expect(code).not.toMatch(/segan\/index\.html/);
  });
});
