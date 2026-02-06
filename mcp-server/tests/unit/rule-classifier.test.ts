// ═══════════════════════════════════════════════════════════════
// Rule Classifier - Unit Tests
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { classifyRules } from '../../src/mappers/rule-classifier.js';
import type { DesignRule } from '../../src/types/index.js';

describe('classifyRules', () => {
  it('should classify background rules', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'background', content: 'Clean white walls' },
    ];

    const result = classifyRules(rules);

    expect(result.background).toHaveLength(1);
    expect(result.background[0]).toBe('- Clean white walls');
  });

  it('should classify module rules with trigger prefix', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'module', content: 'Standard height 720mm', triggers: ['상부장'] },
    ];

    const result = classifyRules(rules);

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]).toContain('상부장');
  });

  it('should classify door rules', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'door', content: 'Flat panel with concealed hinges', triggers: ['도어규격'] },
    ];

    const result = classifyRules(rules);

    expect(result.doors).toHaveLength(1);
    expect(result.doors[0]).toContain('도어규격');
  });

  it('should classify material rules', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'material', content: 'Color: White Oak\nFinish: Matte', triggers: ['WO-001'] },
    ];

    const result = classifyRules(rules);

    expect(result.materials).toHaveLength(1);
    expect(result.materials[0].content).toContain('White Oak');
  });

  it('should classify material_keyword rules', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'material_keyword', content: '화이트 무광 계열 추천' },
    ];

    const result = classifyRules(rules);

    expect(result.materialKeywords).toHaveLength(1);
  });

  it('should default to module type when rule_type is missing', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'module' as any, content: 'Some rule' },
    ];

    const result = classifyRules(rules);

    expect(result.modules).toHaveLength(1);
  });

  it('should use chunk_type as fallback', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'background' as any, chunk_type: 'background', content: 'Background rule' },
    ];

    const result = classifyRules(rules);

    expect(result.background).toHaveLength(1);
  });

  it('should add default background when no background rules found', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'module', content: 'Module only' },
    ];

    const result = classifyRules(rules);

    expect(result.background.length).toBeGreaterThan(0);
    expect(result.background[0]).toContain('Clean');
  });

  it('should handle empty rules array', () => {
    const result = classifyRules([]);

    expect(result.modules).toHaveLength(0);
    expect(result.doors).toHaveLength(0);
    expect(result.materials).toHaveLength(0);
    expect(result.materialKeywords).toHaveLength(0);
    expect(result.background.length).toBeGreaterThan(0); // defaults
  });

  it('should handle mixed rule types', () => {
    const rules: DesignRule[] = [
      { id: '1', rule_type: 'background', content: 'Bright room' },
      { id: '2', rule_type: 'module', content: 'Upper cabinet 720mm', triggers: ['상부장'] },
      { id: '3', rule_type: 'door', content: 'Push open', triggers: ['도어규격'] },
      { id: '4', rule_type: 'material', content: 'Color: Gray', triggers: ['GR-001'] },
      { id: '5', rule_type: 'material_keyword', content: '그레이 추천' },
    ];

    const result = classifyRules(rules);

    expect(result.background).toHaveLength(1);
    expect(result.modules).toHaveLength(1);
    expect(result.doors).toHaveLength(1);
    expect(result.materials).toHaveLength(1);
    expect(result.materialKeywords).toHaveLength(1);
  });
});
