/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, describe, test, expect, __dirname */
/**
 * 사이트 첫 화면(index.html) → SEGAN 앱 첫 화면(segan/)으로 한 번에 넘어가야 한다.
 * 보통은 호스팅이 / · /index.html 을 앱으로 301 넘긴다(_redirects) — 이 파일이 열리는 때에도 같은 곳으로.
 * /segan/index.html 은 호스팅이 /segan/ 으로 308 넘기므로 폴더 주소로 보낸다.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('index.html — SEGAN 앱 segan/ 으로 바로', () => {
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

  test('옛 화면(ai-design)으로 보내는 곳이 남아 있지 않다 (HTML 주석 빼고)', () => {
    expect(HTML.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/ai-design/);
  });
});
