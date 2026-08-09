/**
 * P0: 하네스 자체가 동작하는지 확인한다.
 *
 * 이 파일이 통과해야 이후 모든 단계(엔진 분리 · 도구 체계 · 런 도입)가 가능하다.
 * 실패하면 계획의 전제(jsdom 부팅 가능)가 틀린 것이므로 접근을 다시 잡아야 한다.
 */
const { bootPlanner } = require('../test-utils/planner-harness');

describe('배치 페이지(mockup-shell)가 jsdom 에서 부팅된다', () => {
  test('인라인 스크립트가 오류 없이 실행된다', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    if (p.errors.length) {
      // 실패 시 원인을 바로 보이게 한다
      throw new Error('부팅 오류 ' + p.errors.length + '건: ' + p.errors.map((e) => e.message).join(' | '));
    }
    expect(p.errors).toHaveLength(0);
  });

  test('핵심 전역 함수가 노출된다', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    for (const fn of ['addSectionRect', 'serializeLayout', 'findMagnetSnap', 'applyView']) {
      expect(typeof p.g(fn)).toBe('function');
    }
  });

  test('스코프 키가 URL 파라미터를 따른다', () => {
    const a = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    const b = bootPlanner('mockup-shell.html', { search: '?design=d1&item=200' });
    expect(a.g('scopedKey')('dadam_layout_v1')).not.toBe(b.g('scopedKey')('dadam_layout_v1'));
  });

  test('모듈을 추가하면 도면에 나타나고 직렬화된다', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    p.g('addSectionRect')('lower');
    p.g('addSectionRect')('upper');

    const rects = p.document.querySelectorAll('g.sect-rect');
    expect(rects.length).toBeGreaterThanOrEqual(2);

    const layout = p.g('serializeLayout')();
    expect(layout).toBeTruthy();
    expect(layout.modules.length).toBeGreaterThanOrEqual(2);
    expect(layout.modules.map((m) => m.section)).toEqual(expect.arrayContaining(['lower', 'upper']));
  });

  test('저장한 배치가 스코프 키로 localStorage 에 들어간다', () => {
    const p = bootPlanner('mockup-shell.html', { search: '?design=d1&item=100' });
    p.g('addSectionRect')('lower');
    const key = p.g('scopedKey')('dadam_layout_v1');
    p.storage.setItem(key, JSON.stringify(p.g('serializeLayout')()));
    expect(JSON.parse(p.storage.getItem(key)).modules).toHaveLength(1);
  });
});

describe('구조 페이지(mockup-structure)가 jsdom 에서 부팅된다', () => {
  test('three.js 없이도 오류 없이 실행된다 (스스로 skip)', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=d1&item=100' });
    if (p.errors.length) {
      throw new Error('부팅 오류 ' + p.errors.length + '건: ' + p.errors.map((e) => e.message).join(' | '));
    }
    expect(p.errors).toHaveLength(0);
  });

  test('브리지 계약 함수가 노출된다', () => {
    const p = bootPlanner('mockup-structure.html', { search: '?design=d1&item=100' });
    for (const fn of ['buildPlannerPayload', 'loadModules', 'autoCalcForSet', 'distributeModules']) {
      expect(typeof p.g(fn)).toBe('function');
    }
  });
});
