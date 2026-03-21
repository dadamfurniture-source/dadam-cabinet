// ═══ ControlNet Furniture (Code Node) ═══
// 도면 기반 ControlNet 이미지 생성 (MCP 서버 호출)
// gemini-furniture.js 대체용 — renderingMode === 'blueprint' 시 사용
// 동일 입출력 형태 유지 (drop-in replacement)
const input = $input.first().json;
const MCP_SERVER_URL = '%%MCP_SERVER_URL%%'; // e.g. https://mcp.dadamfurniture.com

const imgData = input.cleanedBackground || '';
const category = input.category || 'sink';
const style = input.style || 'modern';
const kitchenLayout = input.kitchenLayout || input.kitchen_layout || 'i_type';

let closedImage = null;
let debugInfo = 'pipeline:controlnet; ';

// ── 설계 데이터 구성 ──
// Build All Prompts에서 전달된 layoutData/modules/cabinetSpecs 사용
const designData = {
  category: category,
  wall_width_mm: input.wallData?.wall_width_mm || 3000,
  wall_height_mm: input.wallData?.wall_height_mm || 2400,
  upper_height_mm: input.cabinetSpecs?.upperHeight || 720,
  lower_height_mm: input.cabinetSpecs?.lowerHeight || 830,
  leg_height_mm: input.cabinetSpecs?.legHeight || 100,
  molding_height_mm: input.cabinetSpecs?.moldingHeight || 50,
  countertop_thickness_mm: input.cabinetSpecs?.countertopThickness || 30,
  upper_door_overlap_mm: 0,
  upper: (input.modules?.upper || []).map(m => ({
    position_mm: m.position_mm || 0,
    width_mm: m.width_mm || 600,
    type: m.type || 'door',
    door_count: m.doorCount || m.door_count || 1,
    is_drawer: false,
  })),
  lower: (input.modules?.lower || []).map(m => ({
    position_mm: m.position_mm || 0,
    width_mm: m.width_mm || 600,
    type: m.type || 'door',
    door_count: m.doorCount || m.door_count || 1,
    is_drawer: m.type === 'drawer',
    has_sink: m.hasSink || m.has_sink || false,
    has_cooktop: m.hasCooktop || m.has_cooktop || false,
  })),
};

debugInfo += 'upperMods:' + designData.upper.length + '; lowerMods:' + designData.lower.length + '; ';

try {
  const requestBody = {
    design_data: designData,
    category: category,
    style: style,
    kitchen_layout: kitchenLayout,
    background_image: imgData || undefined,
    prompt_strength: 0.75,
    controlnet_type: 'lineart',
    controlnet_strength: 0.75,
    controlnet_end: 0.8,
    width: 1024,
    height: 1024,
    enable_verification: false, // 프로덕션에서는 검증 비활성화 (속도 우선)
  };

  debugInfo += 'calling MCP; ';

  const res = await this.helpers.request({
    method: 'POST',
    uri: MCP_SERVER_URL + '/webhook/controlnet-image',
    body: requestBody,
    json: true,
    timeout: 180000, // 3분 (ControlNet은 Gemini보다 시간 소요)
  });

  if (res?.success && res?.generated_image?.base64) {
    closedImage = res.generated_image.base64;
    debugInfo += 'image:' + (closedImage.length / 1024 | 0) + 'KB; ';
    debugInfo += 'prompt:' + (res.prompt || '').substring(0, 60) + '; ';

    if (res.verification) {
      debugInfo += 'score:' + res.verification.score + '; ';
      debugInfo += 'passed:' + res.verification.passed + '; ';
    }
    if (res.metadata?.retryCount) {
      debugInfo += 'retries:' + res.metadata.retryCount + '; ';
    }
  } else {
    debugInfo += 'noImage; ';
    if (res?.error) debugInfo += 'err:' + JSON.stringify(res.error).substring(0, 100) + '; ';
  }
} catch (e) {
  debugInfo += 'error:' + e.message.substring(0, 200) + '; ';
}

// 동일 출력 형태 (gemini-furniture.js와 호환)
return [{
  closedImage,
  hasClosedImage: !!closedImage,
  debugInfo,
  cleanedBackground: input.cleanedBackground,
  category: input.category,
  style: input.style,
  imageType: input.imageType,
  wallData: input.wallData,
  furniturePlacement: input.furniturePlacement,
  openPrompt: input.openPrompt,
  hasBlueprint: input.hasBlueprint || false,
  renderingMode: 'controlnet'
}];
