// ═══════════════════════════════════════════════════════════════
// SVG Demo Script - DrawingData → SVG 파일 출력
// 실행: npx tsx scripts/render-svg-demo.ts
// ═══════════════════════════════════════════════════════════════

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { generateDrawingData } from '../src/services/drawing.service.js';
import { generateBom } from '../src/services/bom.service.js';
import { renderDrawingToSvg } from '../src/services/svg-renderer.service.js';
import type { StructuredDesignData } from '../src/types/index.js';

// ─── 테스트 데이터: 주방 3캐비닛 ───
const kitchenDesign: StructuredDesignData = {
  category: 'sink',
  style: 'modern',
  wall: { width_mm: 3600, height_mm: 2400, tile_type: 'subway', confidence: 'high' },
  utilities: {
    water_supply: { detected: true, position_mm: 900 },
    exhaust_duct: { detected: true, position_mm: 2700 },
    gas_pipe: { detected: true, position_mm: 2700 },
  },
  layout: { direction: 'sink_left_cooktop_right', total_width_mm: 3600, depth_mm: 600 },
  cabinets: {
    upper: [
      { position_mm: 0, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
      { position_mm: 900, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
      { position_mm: 1800, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
    ],
    lower: [
      { position_mm: 0, width_mm: 800, type: 'sink', door_count: 2, is_drawer: false, has_sink: true },
      { position_mm: 800, width_mm: 600, type: 'drawer', door_count: 3, is_drawer: true },
      { position_mm: 1400, width_mm: 900, type: 'standard', door_count: 2, is_drawer: false },
      { position_mm: 2300, width_mm: 800, type: 'cooktop', door_count: 1, is_drawer: false, has_cooktop: true },
    ],
    upper_height_mm: 720,
    lower_height_mm: 870,
    leg_height_mm: 150,
    molding_height_mm: 60,
  },
  equipment: {
    sink: { position_mm: 400, width_mm: 800, type: 'undermount' },
    cooktop: { position_mm: 2700, width_mm: 600, type: '3-burner', burner_count: 3 },
    hood: { position_mm: 2700, width_mm: 600, type: 'slim' },
    faucet: { type: 'single_lever' },
  },
  materials: {
    door_color: 'white',
    door_finish: 'matte',
    countertop: 'white_marble',
    material_codes: ['WM-01'],
    handle_type: 'line',
  },
  rag_rules_applied: { background: [], modules: [], doors: [], material_codes: [] },
};

// ─── 실행 ───
const outDir = join(import.meta.dirname!, '..', 'output-svg');
mkdirSync(outDir, { recursive: true });

console.log('1. BOM 생성...');
const bom = generateBom(kitchenDesign);
console.log(`   부품 ${bom.items.length}개, 원판 ${bom.summary.sheet_estimate}장`);

console.log('2. DrawingData 좌표 생성...');
const drawing = generateDrawingData(kitchenDesign, bom);
console.log(`   캐비닛 ${drawing.common.front_view.cabinets.length}개, 도어 ${drawing.common.front_view.doors.length}개`);

console.log('3. SVG 렌더링...');
const svg = renderDrawingToSvg(drawing, { scale: 0.5 });

const files = [
  ['front-view.svg', svg.front_view],
  ['side-view.svg', svg.side_view],
  ['plan-view.svg', svg.plan_view],
  ['manufacturing.svg', svg.manufacturing],
  ['installation.svg', svg.installation],
] as const;

for (const [name, content] of files) {
  const path = join(outDir, name);
  writeFileSync(path, content, 'utf-8');
  console.log(`   -> ${name} (${(content.length / 1024).toFixed(1)} KB)`);
}

console.log(`\n출력 폴더: ${outDir}`);
console.log('브라우저에서 SVG 파일을 열어 확인하세요.');
