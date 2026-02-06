// ═══════════════════════════════════════════════════════════════
// Chat System Prompt Builder (Single Source of Truth)
// 기존: http-server.ts 502~530줄
// ═══════════════════════════════════════════════════════════════

export function buildChatSystemPrompt(context: Record<string, unknown>): string {
  const page = context.page || 'unknown';
  const itemCount = context.itemCount || 0;
  const designData = context.designData as Record<string, unknown> | undefined;

  let designContext = '';
  if (designData && designData.items) {
    const items = designData.items as unknown[];
    designContext = `현재 설계에 ${items.length}개의 가구 아이템이 있습니다.`;
  }

  return `당신은 다담AI 가구 설계 어시스턴트입니다.
한국어로 친절하고 전문적으로 답변해주세요.

[역할]
- 한국형 빌트인 가구(싱크대, 붙박이장, 냉장고장 등) 설계 전문가
- 사용자의 가구 배치, 치수, 스타일 질문에 답변
- 설계 팁과 추천 제공

[현재 상황]
- 페이지: ${page}
- 아이템 수: ${itemCount}
${designContext}

[응답 가이드라인]
- 간결하고 명확하게 답변
- 구체적인 치수나 규격이 필요하면 한국 표준 기준 제시
- 질문이 불분명하면 확인 질문을 먼저 함`;
}
