/**
 * 최상위 선언만 정확히 뽑는다.
 *
 * 왜 정규식으로는 안 되는가:
 *   `/^ {0,4}(const|let|var|function)\s+(\w+)/m` 같은 들여쓰기 휴리스틱은
 *   파일이 어느 열에서 시작하느냐에 따라 결과가 달라진다. 들여쓰기 0 으로 쓴
 *   모듈에서는 함수 **본문**(들여쓰기 2)까지 최상위로 잡혀
 *   `z` `w` `sz` 같은 지역 변수가 전역 이름으로 둔갑한다.
 *   식별자 충돌 가드가 그걸 믿으면 멀쩡한 코드를 흰 화면이라고 신고한다.
 *
 * 그래서 문자열·주석·정규식·템플릿 리터럴을 공백으로 지운 사본을 만들고,
 * 괄호 깊이를 세어 **깊이 0** 에서의 선언만 인정한다.
 */

/**
 * 문자열/주석/정규식 리터럴을 같은 길이의 공백으로 바꾼다.
 * 길이를 보존해야 위치 기반 후속 처리가 어긋나지 않는다.
 */
/**
 * `src[start]` 가 여는 백틱일 때, 짝이 되는 닫는 백틱 **다음** 위치를 돌려준다.
 * `${ }` 안의 중첩 템플릿·문자열·중괄호를 따라간다.
 */
function skipTemplate(src, start) {
  const n = src.length;
  let i = start + 1;
  while (i < n) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i + 1;
    if (c === '$' && src[i + 1] === '{') {
      // 치환부 — 중괄호 짝을 세며 건너뛴다
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '`') { i = skipTemplate(src, i); continue; }
        if (d === '"' || d === "'") {
          i++;
          while (i < n && src[i] !== d && src[i] !== '\n') { i += src[i] === '\\' ? 2 : 1; }
          i++; continue;
        }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return n;
}

function maskLiterals(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  let prevMeaningful = '';

  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
      blank(i, Math.min(j + 2, n)); i = j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c || src[j] === '\n') break;
        j++;
      }
      blank(i + 1, j); i = j + 1; prevMeaningful = 'x'; continue;
    }
    if (c === '`') {
      // 템플릿 리터럴은 **통째로** 지운다.
      // `${ }` 안에도 코드가 들어가지만, 그건 언제나 식(expression) 내부라
      // 최상위 선언일 수 없다. 안을 코드로 되살려 파싱하면 함수 본문의 `}` 와
      // `${ }` 를 닫는 `}` 를 구분해야 해서 복잡해지기만 한다.
      const end = skipTemplate(src, i);
      blank(i + 1, end - 1);
      i = end; prevMeaningful = 'x'; continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%~^<>]|^$/.test(prevMeaningful)) {
      // 정규식 리터럴 (나눗셈이 아닌 경우)
      let j = i + 1, cls = false, ok = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; break; }
        j++;
      }
      if (ok) { blank(i + 1, j); i = j + 1; prevMeaningful = 'x'; continue; }
    }
    if (!/\s/.test(c)) prevMeaningful = c;
    i++;
  }
  return out.join('');
}

/**
 * 깊이 0 에서 선언된 이름을 돌려준다.
 * @param {string} src 클래식 스크립트 본문
 * @returns {Set<string>}
 */
function topLevelDeclarations(src) {
  const masked = maskLiterals(src);
  const names = new Set();
  let depth = 0;

  const re = /\b(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  // 선언 위치를 먼저 모아두고, 각 위치의 깊이를 계산해 거른다
  const decls = [];
  let m;
  while ((m = re.exec(masked))) decls.push({ at: m.index, name: m[2] });

  let di = 0;
  for (let i = 0; i < masked.length && di < decls.length; i++) {
    while (di < decls.length && decls[di].at === i) {
      if (depth === 0) names.add(decls[di].name);
      di++;
    }
    const c = masked[i];
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
  }
  return names;
}

module.exports = { maskLiterals, topLevelDeclarations };
