/**
 * @jest-environment node
 *
 * 내부 확인용 (generations.options.internal_only) — 계획서 docs/01-plan/planner-render-realize.plan.md §6.3.
 *
 * 왜 테스트하나: 도면과 어긋난 플래너 결과는 고객 화면에 나가면 안 된다. 그런데 거르는 쿼리를
 * `.not('options->>internal_only','eq','true')` 로 쓰면 키가 없는 행(거의 전부)이 NULL 이라
 * NOT (NULL = 'true') = NULL → **목록이 통째로 빈다**. 에러도 안 난다. 그 두 실패를 여기서 막는다.
 */

const fs = require('fs');
const path = require('path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const DESIGNS = read('my-designs.html');
const SHARE = read('design-share.html');

describe('내 연출컷 (my-designs.html)', () => {
  const from = DESIGNS.indexOf(".from('generations')");
  const to = DESIGNS.indexOf('.limit(200)');
  const query = DESIGNS.slice(from, to);

  test('쿼리 조각을 찾았다 — 빈 문자열로 거짓 통과하지 않게', () => {
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
  });

  test('목록 쿼리가 internal_only 를 거른다 — NULL 은 남기고 true 만 뺀다', () => {
    expect(query).toMatch(
      /\.or\('options->>internal_only\.is\.null,options->>internal_only\.neq\.true'\)/
    );
  });

  test('NULL 까지 빼는 .not(eq.true) 는 쓰지 않는다', () => {
    expect(DESIGNS).not.toMatch(/\.not\(\s*'options->>internal_only'/);
  });

  test('여전히 본인 행만 읽는다', () => {
    expect(query).toMatch(/\.eq\('user_id', user\.id\)/);
  });
});

describe('공유 열람 (design-share.html)', () => {
  test('internal_only 사유에 제목이 있다', () => {
    expect(SHARE).toMatch(/internal_only: '공유할 수 없는 결과입니다'/);
  });
});
