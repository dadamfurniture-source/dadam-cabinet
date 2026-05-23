// ═══════════════════════════════════════════════════════════════
// StepIndicator.test.ts — W6-6 progress bar 메타 검증
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { WORKFLOW_STEPS } from '../StepIndicator';

describe('WORKFLOW_STEPS 메타', () => {
  it('3단계 정의 (layout / structure / detail)', () => {
    expect(WORKFLOW_STEPS).toHaveLength(3);
    expect(WORKFLOW_STEPS.map((s) => s.key)).toEqual(['layout', 'structure', 'detail']);
  });

  it('각 step 에 label/icon 정의', () => {
    for (const s of WORKFLOW_STEPS) {
      expect(s.label).toBeTruthy();
      expect(s.icon).toBeTruthy();
    }
  });

  it('step key 는 PlannerState.step 타입과 호환', () => {
    const validSteps: readonly string[] = ['layout', 'structure', 'detail'];
    for (const s of WORKFLOW_STEPS) {
      expect(validSteps).toContain(s.key);
    }
  });
});
