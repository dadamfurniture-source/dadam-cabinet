// 디자인 시스템 배포용 Tailwind 설정.
//
// 루트 tailwind.config.js 를 그대로 쓰되 두 가지만 바꾼다:
//  1. preflight(전역 리셋)를 끈다 — dadam-system.css 가 이미 자체 리셋과
//     body 기준선을 갖고 있어서 두 리셋이 겹치면 브랜드 배경/폰트가 뒤집힌다.
//  2. content 글롭을 저장소 루트 기준 절대경로로 바꾼다 — 그래야 어느
//     디렉터리에서 실행하든(npm --prefix 포함) 같은 결과가 나온다.
const path = require('path');
const base = require('../tailwind.config.js');

const REPO = path.join(__dirname, '..');
const abs = (p) => path.join(REPO, p.replace(/^\.\//, '')).split(path.sep).join('/');

module.exports = {
  ...base,
  content: base.content.map(abs),
  corePlugins: { ...(base.corePlugins || {}), preflight: false },
};
