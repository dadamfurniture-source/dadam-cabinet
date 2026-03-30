// 벽면 분석 프롬프트 (Gemini Vision용, 300자 이내)

export function getWallAnalysisPrompt(category: string): string {
  return `Analyze this Korean apartment photo. Return JSON only:
{"wall":{"width":number,"height":number},"plumbing":{"sinkCenter":number|null,"cooktopCenter":number|null,"waterPct":number,"exhaustPct":number},"confidence":"high"|"medium"|"low"}
Measure wall width using tile count (Korean 300x600mm tiles). sinkCenter/cooktopCenter in mm from left. waterPct/exhaustPct as % from left.`;
}
