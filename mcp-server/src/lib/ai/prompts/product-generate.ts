// 가구 이미지 생성 프롬프트 (300자 이내 최적화)

export function getProductGeneratePrompt(
  category: string,
  style: { name: string; doorColor: string; doorFinish: string; countertopColor: string; countertopMaterial: string },
  layoutConstraints: string,
  upperColor?: string,
  lowerColor?: string,
): string {
  const isTwoTone = upperColor && lowerColor && upperColor !== lowerColor;
  const colorPart = isTwoTone
    ? `UPPER cabinets=${upperColor}, LOWER cabinets=${lowerColor}. Two-tone: upper and lower MUST be different colors.`
    : `All cabinets ${style.doorColor} ${style.doorFinish}.`;

  if (category === 'Sink' || category === 'sink') {
    return `Edit photo: install handleless flat-panel kitchen cabinets. ${colorPart} Keep wall tiles, camera, background identical. ${layoutConstraints} ${style.countertopColor} ${style.countertopMaterial} countertop. Below cooktop MUST have exactly 2 stacked horizontal drawers. No clutter. 2nd image=layout guide.`;
  }

  if (category === 'wardrobe') {
    return `Edit photo: install ${style.doorColor} ${style.doorFinish} floor-to-ceiling built-in wardrobe. Keep wall, floor, camera identical. Handleless doors. Clean room.`;
  }

  return `Edit photo: install ${style.doorColor} ${style.doorFinish} ${category} cabinet. Keep wall, floor, camera identical. Handleless doors. Clean room.`;
}

export function getStyleAltPrompt(
  category: string,
  altStyle: { name: string; doorColor: string; doorFinish: string },
  layoutConstraints: string,
  upperColor: string,
  lowerColor: string,
): string {
  return `Edit photo: change UPPER cabinets to ${upperColor} ${altStyle.doorFinish}. Change LOWER cabinets to ${lowerColor} ${altStyle.doorFinish}. Two-tone: upper and lower MUST be different colors. Keep wall tiles, camera, background, sink, cooktop positions identical. Below cooktop=2 drawers. 2nd image=layout guide.`;
}
