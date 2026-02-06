// ═══════════════════════════════════════════════════════════════
// Rule Classifier - RAG 규칙 분류 (Single Source of Truth)
// 기존: http-server.ts 561~585줄, supabase-rag.ts 120~161줄
// ═══════════════════════════════════════════════════════════════

import type { DesignRule, RuleType } from '../types/index.js';

export interface ClassifiedRules {
  background: string[];
  modules: string[];
  doors: string[];
  materials: DesignRule[];
  materialKeywords: DesignRule[];
}

const DEFAULT_BACKGROUND = [
  '- Clean, bright walls with smooth finished surface',
  '- Natural light coming into the space',
  '- Modern minimal interior design',
];

export function classifyRules(rules: DesignRule[]): ClassifiedRules {
  const result: ClassifiedRules = {
    background: [],
    modules: [],
    doors: [],
    materials: [],
    materialKeywords: [],
  };

  for (const rule of rules) {
    const type = (rule.rule_type || rule.chunk_type || 'module') as RuleType;

    switch (type) {
      case 'background':
        result.background.push(`- ${rule.content}`);
        break;
      case 'module':
        result.modules.push(`- ${rule.triggers?.[0] || ''}: ${rule.content}`);
        break;
      case 'door':
        result.doors.push(`- ${rule.triggers?.[0] || ''}: ${rule.content}`);
        break;
      case 'material':
        result.materials.push(rule);
        break;
      case 'material_keyword':
        result.materialKeywords.push(rule);
        break;
    }
  }

  if (result.background.length === 0) {
    result.background = [...DEFAULT_BACKGROUND];
  }

  return result;
}
