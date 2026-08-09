/**
 * 최상위 선언 스캐너 자체의 검증.
 *
 * 이 스캐너가 틀리면 두 방향 모두로 조용히 망가진다:
 *   · 과탐 — 함수 안의 `const z` 를 전역으로 보고 멀쩡한 코드를 흰 화면이라 신고
 *   · 미탐 — 진짜 충돌을 놓쳐 배포 후에야 흰 화면을 발견
 * 그래서 가드를 믿기 전에 가드를 먼저 검사한다.
 */
const { topLevelDeclarations } = require('../test-utils/js-scan');

const names = (src) => [...topLevelDeclarations(src)].sort();

describe('최상위 선언만 골라낸다', () => {
  test('함수 본문의 지역 변수는 제외한다', () => {
    // 실제로 겪은 오탐: planner-view.js 의 `const z = s.zoom || 1;`
    expect(names('function toScene(sx, sy, v) {\n  const s = v || view;\n  const z = s.zoom || 1;\n}\nconst view = {};')).toEqual(['toScene', 'view']);
  });

  test('IIFE 안은 최상위가 아니다', () => {
    expect(names('const A = (function () {\n  const hidden = 1;\n  return hidden;\n})();')).toEqual(['A']);
  });

  test('블록 스코프 안의 let 은 제외한다', () => {
    expect(names('{ let blk = 1; }\nconst e = 5;')).toEqual(['e']);
  });

  test('class 선언도 잡는다 (const 와 마찬가지로 전역 렉시컬)', () => {
    expect(names('class K { m() { const q = 1; } }\nconst f = 6;')).toEqual(['K', 'f']);
  });
});

describe('리터럴 안의 코드를 선언으로 착각하지 않는다', () => {
  test('문자열', () => {
    expect(names('const a = "const fake = 1";\nconst b = 2;')).toEqual(['a', 'b']);
  });

  test('주석', () => {
    expect(names('// const fake = 1\n/* const fake2 = 2 */\nconst c = 3;')).toEqual(['c']);
  });

  test('정규식 리터럴 안의 중괄호가 깊이를 망가뜨리지 않는다', () => {
    expect(names('const re = /[{}]{2,}/g;\nconst d = 4;')).toEqual(['d', 're']);
  });

  test('나눗셈을 정규식으로 오인하지 않는다', () => {
    expect(names('const a = 1;\nconst b = a / 2;\nconst c = b / 2;\nconst d = 3;')).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('템플릿 리터럴', () => {
  test('치환부 안의 함수 본문 중괄호에 속지 않는다', () => {
    // `${ }` 를 닫는 } 와 함수 본문의 } 를 혼동하면 이후 선언을 전부 놓친다
    expect(names('const s = `x${(function(){const inner=1;return inner;})()}y`;\nconst after = 2;')).toEqual(['after', 's']);
  });

  test('중첩 템플릿', () => {
    expect(names('const s = `a${`b${1}c`}d`;\nconst after = 2;')).toEqual(['after', 's']);
  });

  test('치환부 문자열 안의 백틱', () => {
    expect(names('const s = `a${"`"}b`;\nconst after = 2;')).toEqual(['after', 's']);
  });
});
