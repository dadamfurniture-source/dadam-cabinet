/* global module */
/**
 * 모듈 라이브러리 시험 견본 — 라이브러리 ENTRIES 가 아니다.
 * 모듈이 하나도 없어도 검증 사슬·하네스·CAD 덤프가 끝까지 도는지 본다.
 * 도어장 · 서랍장 · 상부장 하나씩 (docs/01-plan/module-library.plan.md §6 시제품에서 통과한 구성).
 */
const SAMPLES = Object.freeze([
  { id: 'LB-D1-450-L', rev: 1, group: 'lower-door', section: 'lower', W: 450, name: '견본 하부 1도어',
    choice: { doors: 1, hinge: 'left' }, ruleRefs: ['extractors.js extractSink'], status: 'verified' },
  { id: 'LB-DR3-600', rev: 1, group: 'lower-drawer', section: 'lower', W: 600, name: '견본 서랍 3단',
    choice: { drawer: { ratio: '2:2:2' } }, ruleRefs: ['bom-drawer-rules.js gradesFromRatio'], status: 'verified' },
  { id: 'UB-D2-900', rev: 1, group: 'upper-door', section: 'upper', W: 900, name: '견본 상부 2도어',
    choice: { doors: 2 }, ruleRefs: ['extractors.js extractSink'], status: 'verified' },
]);

module.exports = { SAMPLES };
