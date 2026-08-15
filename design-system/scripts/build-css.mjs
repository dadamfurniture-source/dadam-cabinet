// 다담 디자인 시스템 배포 스타일시트 생성기.
//
// css/ 아래 원본 CSS 를 복사해 두지 않고 빌드 때마다 이어붙인다 —
// 원본이 단일 정본이고, 이 파일은 산출물이라 따로 관리할 게 없다.
//
// 출력: design-system/dist/dadam-ds.css  (cfg.cssEntry 가 가리키는 파일)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const REPO = join(PKG, '..');

// 각 페이지가 <link> 로 불러오는 웹폰트 — collection.html 기준 정본.
const FONT_IMPORT =
  '@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600' +
  '&family=Noto+Serif+KR:wght@400;500' +
  '&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400' +
  '&family=Pretendard:wght@300;400;500;600;700&display=swap");';

/**
 * 최상위 규칙 단위로 CSS 를 훑으면서 selector 를 판정한다.
 * @media 같은 중첩 at-rule 은 본문으로 재귀한다.
 */
function filterRules(css, keepSelector) {
  let out = '';
  let i = 0;

  while (i < css.length) {
    // 주석은 그대로 통과
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }

    const braceAt = css.indexOf('{', i);
    if (braceAt === -1) {
      out += css.slice(i);
      break;
    }

    const prelude = css.slice(i, braceAt);
    const semiAt = css.indexOf(';', i);
    // @import / @charset 처럼 본문 없는 at-rule
    if (semiAt !== -1 && semiAt < braceAt) {
      out += css.slice(i, semiAt + 1);
      i = semiAt + 1;
      continue;
    }

    // 짝이 맞는 닫는 중괄호 찾기
    let depth = 0;
    let j = braceAt;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = css.slice(braceAt + 1, j);
    const sel = prelude.trim();

    if (/^@(media|supports|layer|container)/i.test(sel)) {
      const inner = filterRules(body, keepSelector);
      if (inner.trim()) out += `\n${sel} {${inner}}\n`;
    } else if (/^@/.test(sel)) {
      // @keyframes / @font-face 등은 selector 판정 대상이 아니다
      out += `\n${sel} {${body}}\n`;
    } else if (keepSelector(sel)) {
      out += `\n${sel} {${body}}\n`;
    }

    i = j + 1;
  }

  return out;
}

/**
 * detaildesign CSS 용 판정: 클래스/아이디로 한정되지 않은 규칙은 버린다.
 *
 * `* { font-family: -apple-system }` 이나 `label { … }` 같은 규칙이 살아 있으면
 * 이 디자인 시스템으로 만든 **모든** 화면의 폰트와 폼 컨트롤이 조용히 뒤집힌다.
 * `:root` 토큰 블록만 예외로 남긴다 — detaildesign 클래스들이 참조하고,
 * 이름이 --d-* 와 겹치지 않는다.
 */
function isScopedSelector(selectorList) {
  return selectorList.split(',').every((part) => {
    const s = part.trim();
    if (s === ':root') return true;
    return /[.#]/.test(s);
  });
}

// 각 페이지가 인라인 <style> 로 중복 선언해 온 링크 기준선.
// 공유 CSS 어디에도 없지만 실제로는 모든 페이지에 존재한다 —
// 이게 빠지면 .login-btn 처럼 color 를 직접 지정하지 않는 링크가
// 브라우저 기본 파란색으로 렌더된다(border: 1px solid currentColor 이므로 테두리까지).
const LINK_BASELINE = `
/* ── 링크 기준선 (collection/consultation/material/partner-recommendation.html 인라인 정본) ── */
a { text-decoration: none; color: inherit; }
`;

const chunks = [
  FONT_IMPORT,
  '\n/* ── Tailwind (app/globals.css 컴파일 결과, preflight 제외) ── */',
  readFileSync(join(PKG, '.css-build', 'tailwind.css'), 'utf8'),
  LINK_BASELINE,
  '\n/* ── css/dadam-system.css (원본 그대로) ── */',
  readFileSync(join(REPO, 'css', 'dadam-system.css'), 'utf8'),
  '\n/* ── css/nav.css (원본 그대로) ── */',
  readFileSync(join(REPO, 'css', 'nav.css'), 'utf8'),
  '\n/* ── css/detaildesign/*.css (전역 요소 규칙 제거, 클래스 규칙만) ── */',
];

for (const f of ['base.css', 'chrome.css', 'components.css']) {
  const raw = readFileSync(join(REPO, 'css', 'detaildesign', f), 'utf8');
  chunks.push(`\n/* --- detaildesign/${f} --- */`);
  chunks.push(filterRules(raw, isScopedSelector));
}

const outPath = join(PKG, 'dist', 'dadam-ds.css');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, chunks.join('\n') + '\n');

const kb = (readFileSync(outPath).length / 1024).toFixed(0);
console.error(`build-css: dist/dadam-ds.css (${kb} KB)`);
