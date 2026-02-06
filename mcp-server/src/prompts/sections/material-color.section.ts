// ═══════════════════════════════════════════════════════════════
// Material Color Section Builder (Single Source of Truth)
// 기존: http-server.ts 591~644줄
// ═══════════════════════════════════════════════════════════════

import type { DesignRule } from '../../types/index.js';

export function buildMaterialColorSection(materials: DesignRule[], materialKeywords: DesignRule[]): string {
  if (materials.length === 0 && materialKeywords.length === 0) {
    return '';
  }

  let section = `
═══════════════════════════════════════════════════════════════
[MATERIAL COLOR SPECIFICATION - RAG 자재 코드]
═══════════════════════════════════════════════════════════════`;

  if (materials.length > 0) {
    section += `\n\n>> 지정된 자재:\n`;

    for (const mat of materials) {
      const code = mat.triggers ? mat.triggers[0] : mat.id;
      section += `\n[${code}]\n`;

      const colorMatch = mat.content.match(/Color:\s*([^\n]+)/);
      const renderMatch = mat.content.match(/Render:\s*([^\n]+)/);
      const finishMatch = mat.content.match(/Finish:\s*([^\n]+)/);

      if (colorMatch) section += `  Color: ${colorMatch[1].trim()}\n`;
      if (finishMatch) section += `  Finish: ${finishMatch[1].trim()}\n`;
      if (renderMatch) section += `  Render: ${renderMatch[1].trim()}\n`;

      const metadata = mat.metadata as Record<string, unknown> | undefined;
      if (metadata?.hex) {
        section += `  HEX: ${metadata.hex}\n`;
      }
    }
  }

  if (materialKeywords.length > 0) {
    section += `\n\n>> 추천 옵션:\n`;
    for (const kw of materialKeywords) {
      const lines = kw.content.split('\n').slice(0, 10).join('\n');
      section += `${lines}\n`;
    }
  }

  section += `
═══════════════════════════════════════════════════════════════
[CRITICAL - COLOR RENDERING RULES]
- ALL cabinet doors MUST use the EXACT specified color
- Apply correct finish: matte (무광) / glossy (유광) / pearl (펄)
- Maintain CONSISTENT color across ALL doors
- Match HEX code precisely if provided
- Wood grain direction: VERTICAL for doors (세로 결)
═══════════════════════════════════════════════════════════════`;

  return section;
}
