#!/usr/bin/env node
/**
 * Update Build Fixed Prompts node with revised prompts v2.
 * Changes:
 * 1. Cleanup: simplified (removed FILL/Output lines)
 * 2. Furniture: 4 mandatory items (added cooktop+hood), section 2 revised, section 3 removed, output simplified
 * 3. Open: largely same
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wfPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const wf = JSON.parse(readFileSync(wfPath, 'utf-8'));

const node = wf.nodes.find(n => n.name === 'Build Fixed Prompts');
if (!node) { console.error('Build Fixed Prompts not found'); process.exit(1); }

console.log('=== Update Build Fixed Prompts v2 ===');

// Build the complete new jsCode
const newCode = `// Build Fixed Prompts v2 - 3 fixed prompts for Grok image generation
const input = $input.first().json;
const category = input.category || 'sink';
const style = input.style || 'modern';
const analysis = input.analysisResult;
const cf = input.coordinateFrame;
const wb = cf ? cf.wall_boundaries : { width_mm: 3000, height_mm: 2400 };
const modules = input.modules;
const cabinetSpecs = input.cabinetSpecs || {};

// RAG data from Supabase search
const ragResults = input.ragResults || [];
const ragBg = input.ragBg || [];
const ragModules = input.ragModules || [];
const ragDoors = input.ragDoors || [];
const ragMaterials = input.ragMaterials || [];
const ragDims = input.ragDims || {};

// Build RAG context string for prompts
let ragContext = '';
if (ragBg.length > 0) ragContext += '\\n[RAG - Background Rules]\\n' + ragBg.join('\\n') + '\\n';
if (ragModules.length > 0) ragContext += '\\n[RAG - Module Rules]\\n' + ragModules.join('\\n') + '\\n';
if (ragDoors.length > 0) ragContext += '\\n[RAG - Door Rules]\\n' + ragDoors.join('\\n') + '\\n';

// Apply RAG dimensions if available
const upperH = ragDims.UPPER_H || 720;
const lowerH = ragDims.LOWER_H || 870;
const molding = ragDims.MOLDING || 60;
const toeKick = ragDims.TOE_KICK || 150;

// \\u2550\\u2550\\u2550 1. Cleanup Prompt (v5.5 simplified) \\u2550\\u2550\\u2550
const cleanupPrompt =
  '\\uC774 \\uACF5\\uC0AC\\uD604\\uC7A5 \\uC0AC\\uC9C4\\uC744 \\uC644\\uC131\\uB41C \\uBE48 \\uBC29\\uC73C\\uB85C \\uBCC0\\uD658\\uD558\\uC138\\uC694.\\n' +
  '\\uC720\\uC9C0: \\uCE74\\uBA54\\uB77C \\uC575\\uAE00, \\uC6D0\\uADFC\\uAC10, \\uC2DC\\uC810, \\uBCBD \\uAD6C\\uC870, \\uC6D0\\uB798 \\uBCBD\\uACFC \\uD0C0\\uC77C \\uC0C9\\uC0C1, \\uCC3D\\uD2C0\\n' +
  '\\uC81C\\uAC70: \\uBC14\\uB2E5\\uACFC \\uD45C\\uBA74\\uC758 \\uBAA8\\uB4E0 \\uACF5\\uC0AC \\uC794\\uD574, \\uB3C4\\uAD6C, \\uC790\\uC7AC, \\uBD09\\uD22C, \\uC0AC\\uB78C';

// \\u2550\\u2550\\u2550 2. Furniture Prompt (v2 - 4 mandatory items) \\u2550\\u2550\\u2550
const waterMm = Math.round((analysis.water_supply_percent / 100) * (wb.width_mm || 3000));
const exhaustMm = Math.round((analysis.exhaust_duct_percent / 100) * (wb.width_mm || 3000));

let utilitySection = '';
if (waterMm || exhaustMm) {
  utilitySection = '\\n' + SEP + '\\n[SECTION 2: \\uBC30\\uAD00 \\uC704\\uCE58 \\uAE30\\uBC18 \\uC124\\uBE44 \\uBC30\\uCE58]\\n' + SEP;
  if (waterMm) utilitySection += '\\n\\uC218\\uB3C4 \\uBC30\\uAD00 \\uAC10\\uC9C0\\uB428 (\\uAE30\\uC900\\uC810\\uC5D0\\uC11C \\uC57D ' + waterMm + 'mm):\\n\\u2192 \\uAC1C\\uC218\\uB300 \\uC124\\uCE58 (\\uB300\\uB7B5 1000mm \\uC0AC\\uC774\\uC988 = \\uBC1B\\uC740 \\uC88C\\uD45C \\uC815\\uBCF4\\uC758 \\uBE44\\uC728 \\uBCF4\\uC815)\\n\\u2192 \\uC2F1\\uD06C\\uBCFC \\uC911\\uC2EC\\uC744 \\uC774 \\uC704\\uCE58\\uC5D0 \\uB9DE\\uCDB0 \\uC124\\uCE58\\n\\u2192 \\uC218\\uC804(Faucet)\\uC744 \\uC2F1\\uD06C\\uBCFC \\uC704\\uC5D0 \\uC124\\uCE58';
  if (exhaustMm) utilitySection += '\\n\\uD6C4\\uB4DC \\uBC30\\uAE30\\uAD6C\\uBA4D \\uAC10\\uC9C0\\uB428 (\\uAE30\\uC900\\uC810\\uC5D0\\uC11C \\uC57D ' + exhaustMm + 'mm):\\n\\u2192 \\uAC00\\uC2A4\\uB300 \\uC124\\uCE58 (3\\uB2E8 \\uC11C\\uB78D\\uC7A5), (600mm \\uC0AC\\uC774\\uC988 = \\uBC1B\\uC740 \\uC88C\\uD45C \\uC815\\uBCF4\\uC758 \\uBE44\\uC728 \\uBCF4\\uC815)\\n\\u2192 \\uB808\\uC778\\uC9C0\\uD6C4\\uB4DC\\uB97C \\uC774 \\uC704\\uCE58 \\uC544\\uB798\\uC5D0 \\uC124\\uCE58\\n\\u2192 \\uCFE1\\uD0D1/\\uAC00\\uC2A4\\uB808\\uC778\\uC9C0\\uB97C \\uD6C4\\uB4DC \\uBC14\\uB85C \\uC544\\uB798\\uC5D0 \\uC124\\uCE58';
} else {
  utilitySection = '\\n' + SEP + '\\n[SECTION 2: \\uC124\\uBE44 \\uBC30\\uCE58 - AI \\uC790\\uB3D9 \\uACB0\\uC815]\\n' + SEP + '\\n\\uBC30\\uAD00 \\uC704\\uCE58\\uAC00 \\uBA85\\uD655\\uD788 \\uAC10\\uC9C0\\uB418\\uC9C0 \\uC54A\\uC558\\uC2B5\\uB2C8\\uB2E4.\\n\\uC774\\uBBF8\\uC9C0\\uB97C \\uBD84\\uC11D\\uD558\\uC5EC \\uC801\\uC808\\uD55C \\uC704\\uCE58\\uC5D0 \\uC124\\uBE44\\uB97C \\uBC30\\uCE58\\uD558\\uC138\\uC694.';
}

const upperCount = modules && modules.upper ? modules.upper.length : 0;
const lowerCount = modules && modules.lower ? modules.lower.length : 0;
let upperLayout = '';
let lowerLayout = '';
if (modules && modules.upper && Array.isArray(modules.upper) && modules.upper.length > 0) {
  upperLayout = modules.upper.map(function(m) {
    const w = m.width_mm || m.w || 600;
    const name = m.name || m.type || 'cabinet';
    return name + '(' + w + 'mm)';
  }).join(' \\u2192 ');
}
if (modules && modules.lower && Array.isArray(modules.lower) && modules.lower.length > 0) {
  lowerLayout = modules.lower.map(function(m) {
    const w = m.width_mm || m.w || 600;
    const name = m.name || m.type || 'cabinet';
    return name + '(' + w + 'mm)';
  }).join(' \\u2192 ');
}

// Style/Material section (3-way branch)
const styleMoodPrompt = input.styleMoodPrompt || '';
const styleDoorColor = input.styleDoorColor || '';
const styleDoorHex = input.styleDoorHex || '';
const styleDoorFinish = input.styleDoorFinish || '';
const styleCountertopPrompt = input.styleCountertopPrompt || '';
const styleHandlePrompt = input.styleHandlePrompt || '';
const styleAccentPrompt = input.styleAccentPrompt || '';
const matDescs = input.materialDescriptions || {};
const clientPrompt = input.clientPrompt || '';

const doorColor = cabinetSpecs.door_color_upper || cabinetSpecs.door_color_lower || '\\uD654\\uC774\\uD2B8';
const doorFinish = cabinetSpecs.door_finish_upper || cabinetSpecs.door_finish_lower || '\\uBB34\\uAD11';
const countertop = cabinetSpecs.countertop_color || '\\uC2A4\\uB178\\uC6B0 \\uD654\\uC774\\uD2B8';
const handleType = cabinetSpecs.handle_type || '\\uD478\\uC2DC\\uC624\\uD508';

let styleSection = '';
let colorSection = '';
let additionalSection = '';

if (styleMoodPrompt) {
  styleSection = '[STYLE: ' + style + ']\\n' + styleMoodPrompt + '\\n';
  colorSection = '[DOOR COLOR - \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD]\\n- \\uB3C4\\uC5B4 \\uC0C9\\uC0C1: ' + (styleDoorColor || doorColor) + '\\n- \\uB9C8\\uAC10: ' + (styleDoorFinish || doorFinish) + '\\n';
  if (styleDoorHex) colorSection += '- \\uC0C9\\uC0C1 \\uCF54\\uB4DC: ' + styleDoorHex + '\\n';
  additionalSection = '- Countertop: ' + (styleCountertopPrompt || countertop) + '\\n- Handle: ' + (styleHandlePrompt || handleType) + '\\n';
  if (styleAccentPrompt) additionalSection += '- Accent: ' + styleAccentPrompt + '\\n';
} else if (clientPrompt || (typeof matDescs === 'object' && !Array.isArray(matDescs) && Object.keys(matDescs).length > 0) || (Array.isArray(matDescs) && matDescs.length > 0)) {
  const ud = matDescs.upper_door_color || doorColor;
  const uf = matDescs.upper_door_finish || doorFinish;
  const ld = matDescs.lower_door_color || doorColor;
  const lf = matDescs.lower_door_finish || doorFinish;
  styleSection = '[STYLE: ' + style + ']\\nModern Korean minimalist kitchen with clean seamless door panels.\\n';
  colorSection = '[DOOR COLOR - \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD]\\n- \\uC0C1\\uBD80\\uC7A5 \\uB3C4\\uC5B4: ' + ud + ' ' + uf + '\\n- \\uD558\\uBD80\\uC7A5 \\uB3C4\\uC5B4: ' + ld + ' ' + lf + '\\n';
  const ct = matDescs.countertop || countertop;
  const hd = matDescs.handle || handleType;
  additionalSection = '- Countertop: ' + ct + '\\n- Handle: ' + hd + '\\n';
  if (clientPrompt) additionalSection += '- Custom: ' + clientPrompt + '\\n';
} else {
  styleSection = '[STYLE: ' + style + ']\\nModern Korean minimalist kitchen with clean seamless door panels.\\n';
  colorSection = '[DOOR COLOR - \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD]\\n- \\uB3C4\\uC5B4 \\uC0C9\\uC0C1: ' + doorColor + '\\n- \\uB9C8\\uAC10: ' + doorFinish + '\\n';
  additionalSection = '- Countertop: ' + countertop + '\\n- Handle: ' + handleType + '\\n';
}

const SEP = '\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550';

const furniturePrompt =
  '[\\uAC00\\uC7A5 \\uC911\\uC694 - \\uBA3C\\uC800 \\uC77D\\uC73C\\uC138\\uC694]\\n' +
  '\\uC774\\uAC83\\uC740 \\uC0AC\\uC9C4 \\uC0DD\\uC131 \\uC791\\uC5C5\\uC774\\uC9C0, \\uAE30\\uC220 \\uB3C4\\uBA74\\uC774 \\uC544\\uB2D9\\uB2C8\\uB2E4.\\n' +
  '\\uC774\\uBBF8\\uC9C0\\uC5D0 \\uD14D\\uC2A4\\uD2B8, \\uC22B\\uC790, \\uCE58\\uC218, \\uB77C\\uBCA8\\uC744 \\uC808\\uB300 \\uCD94\\uAC00\\uD558\\uC9C0 \\uB9C8\\uC138\\uC694.\\n' +
  '\\uCD9C\\uB825\\uC740 \\uC5B4\\uB5A4 \\uC8FC\\uC11D\\uB3C4 \\uC5C6\\uB294 \\uAE68\\uB057\\uD55C \\uC0AC\\uC9C4\\uC774\\uC5B4\\uC57C \\uD569\\uB2C8\\uB2E4.\\n\\n' +
  '\\u2605\\u2605\\u2605 \\uC808\\uB300 \\uB204\\uB77D \\uAE08\\uC9C0 \\u2605\\u2605\\u2605\\n' +
  '\\uC2F1\\uD06C\\uB300(SINK CABINET)\\uC5D0\\uB294 \\uBC18\\uB4DC\\uC2DC \\uB2E4\\uC74C\\uC774 \\uD3EC\\uD568\\uB418\\uC5B4\\uC57C \\uD569\\uB2C8\\uB2E4:\\n' +
  '1. \\uC2F1\\uD06C\\uBCFC (SINK BOWL) - \\uC2A4\\uD14C\\uC778\\uB9AC\\uC2A4 \\uB610\\uB294 \\uD654\\uAC15\\uC11D \\uC2F1\\uD06C\\uBCFC\\n' +
  '2. \\uC218\\uC804 (FAUCET) - \\uC2F1\\uD06C\\uBCFC \\uC911\\uC559 \\uB4A4\\uCABD\\uC5D0 \\uC124\\uCE58\\uB41C \\uC218\\uB3C4\\uAF2D\\uC9C0\\n' +
  '3. \\uCFE1\\uD0D1 (COOKTOP) - \\uC778\\uB355\\uC158, \\uAC00\\uC2A4\\uB808\\uC778\\uC9C0 \\uBB34\\uC870\\uAC74 \\uC124\\uCE58 \\uB418\\uC5B4\\uC57C\\uD569\\uB2C8\\uB2E4.\\n' +
  '4. \\uD6C4\\uB4DC (HOOD) - (\\uAE30\\uBCF8\\uD615) \\uB9E4\\uB9BD\\uD615 \\uD6C4\\uB4DC \\uC124\\uCE58\\n' +
  '\\uC774 4\\uAC00\\uC9C0\\uAC00 \\uC5C6\\uC73C\\uBA74 \\uC2F1\\uD06C\\uB300\\uAC00 \\uC544\\uB2D9\\uB2C8\\uB2E4. \\uC808\\uB300 \\uB204\\uB77D\\uD558\\uC9C0 \\uB9C8\\uC138\\uC694!\\n\\n' +
  '[TASK: \\uD55C\\uAD6D\\uC2DD \\uBE4C\\uD2B8\\uC778 \\uC8FC\\uBC29(\\uC2F1\\uD06C\\uB300) - \\uD3EC\\uD1A0\\uB9AC\\uC5BC\\uB9AC\\uC2A4\\uD2F1 \\uC0AC\\uC9C4]\\n\\n' +
  SEP + '\\n[SECTION 1: \\uACF5\\uAC04 \\uAD6C\\uC870 \\uC720\\uC9C0 + \\uB9C8\\uAC10 \\uBCF4\\uC815]\\n' + SEP + '\\n' +
  'PRESERVE (\\uBC18\\uB4DC\\uC2DC \\uC720\\uC9C0):\\n' +
  '- \\uCE74\\uBA54\\uB77C \\uC575\\uAE00\\uACFC \\uC2DC\\uC810 - \\uC6D0\\uBCF8\\uC0AC\\uC9C4\\uACFC \\uB3D9\\uC77C\\uD55C \\uC575\\uAE00\\uACFC \\uC2DC\\uC810\\n' +
  '- \\uBC29\\uC758 \\uC804\\uCCB4\\uC801\\uC778 \\uAD6C\\uC870\\uC640 \\uB808\\uC774\\uC544\\uC6C3\\n' +
  '- \\uCC3D\\uBB38, \\uBB38, \\uCC9C\\uC7A5\\uC758 \\uC704\\uCE58\\n\\n' +
  'FINISH & CLEAN UP (\\uBBF8\\uC644\\uC131 \\uBD80\\uBD84 \\uC790\\uC5F0\\uC2A4\\uB7FD\\uAC8C \\uB9C8\\uAC10):\\n' +
  '- \\uB178\\uCD9C\\uB41C \\uC804\\uC120 \\u2192 \\uC81C\\uAC70\\uD558\\uACE0 \\uAE54\\uB054\\uD558\\uAC8C \\uB9C8\\uAC10\\n' +
  '- \\uC2DC\\uBA58\\uD2B8 \\uBCBD, \\uBBF8\\uC7A5 \\uC548 \\uB41C \\uBCBD \\u2192 \\uAE54\\uB054\\uD55C \\uBCBD\\uC9C0/\\uD398\\uC778\\uD2B8\\uB85C \\uB9C8\\uAC10\\n' +
  '- \\uCC22\\uC5B4\\uC9C4 \\uBCBD\\uC9C0, \\uACF0\\uD321\\uC774, \\uB54C \\u2192 \\uC0C8 \\uBCBD\\uC9C0\\uB85C \\uAE68\\uB057\\uD558\\uAC8C \\uB9C8\\uAC10\\n' +
  '- \\uACF5\\uC0AC \\uC790\\uC7AC, \\uBA3C\\uC9C0, \\uC7A1\\uB3D9\\uC0AC\\uB2C8 \\u2192 \\uC81C\\uAC70\\uD558\\uC5EC \\uAE54\\uB054\\uD55C \\uC0C1\\uD0DC\\uB85C\\n' +
  '- \\uBC14\\uB2E5 \\uBCF4\\uD638 \\uBE44\\uB2D0, \\uD14C\\uC774\\uD504 \\u2192 \\uC81C\\uAC70\\uD558\\uACE0 \\uC644\\uC131\\uB41C \\uBC14\\uB2E5\\uC7AC\\uB85C \\uB9C8\\uAC10\\n' +
  '- \\uBBF8\\uC644\\uC131 \\uCC9C\\uC7A5, \\uBAB0\\uB529 \\u2192 \\uC790\\uC5F0\\uC2A4\\uB7FD\\uAC8C \\uB9C8\\uAC10 \\uCC98\\uB9AC\\n' +
  '- \\uCC3D\\uD2C0, \\uBB38\\uD2C0 \\uBBF8\\uC644\\uC131 \\uBD80\\uBD84 \\u2192 \\uAE54\\uB054\\uD558\\uAC8C \\uB9C8\\uAC10\\n' +
  utilitySection + '\\n\\n' +
  SEP + '\\n[SECTION 4: \\uCE90\\uBE44\\uB2DB \\uB514\\uC790\\uC778]\\n' + SEP + '\\n' +
  'Upper cabinets: ' + upperCount + ' units\\n' +
  'Lower cabinets: ' + lowerCount + ' units\\n' +
  (upperLayout ? 'Upper layout: ' + upperLayout + '\\n' : '') +
  (lowerLayout ? 'Lower layout: ' + lowerLayout + '\\n' : '') +
  '\\n\\uB3C4\\uC5B4 \\uD0C0\\uC785 \\uAD6C\\uBD84:\\n' +
  '- \\uC5EC\\uB2EB\\uC774 \\uB3C4\\uC5B4 (Swing door): \\uD78C\\uC9C0\\uB85C \\uC5EC\\uB294 \\uC77C\\uBC18 \\uB3C4\\uC5B4\\n' +
  '- \\uC11C\\uB78D \\uB3C4\\uC5B4 (Drawer): \\uC55E\\uC73C\\uB85C \\uB2F9\\uAE30\\uB294 \\uC11C\\uB78D\\n\\n' +
  SEP + '\\n[SECTION 5: \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD \\uD14C\\uB9C8/\\uCEEC\\uB7EC \\uC801\\uC6A9] \\u2605 \\uC911\\uC694\\n' + SEP + '\\n' +
  styleSection + colorSection +
  '\\u203B \\uBC18\\uB4DC\\uC2DC \\uC704 \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD \\uCEEC\\uB7EC\\uB85C \\uBAA8\\uB4E0 \\uCE90\\uBE44\\uB2DB \\uB3C4\\uC5B4\\uB97C \\uB80C\\uB354\\uB9C1\\uD560 \\uAC83\\n\\n' +
  SEP + '\\n[SECTION 6: \\uCD94\\uAC00 \\uB9C8\\uAC10\\uC7AC]\\n' + SEP + '\\n' +
  additionalSection + '\\n' +
  (ragContext ? SEP + '\\n[RAG DESIGN RULES - \\uBC18\\uB4DC\\uC2DC \\uC900\\uC218]\\n' + SEP + '\\n' + ragContext + '\\n' : '') +
  SEP + '\\n[STRICTLY FORBIDDEN]\\n' + SEP + '\\n' +
  '\\u274C \\uCE58\\uC218 \\uB77C\\uBCA8\\uC774\\uB098 \\uCE21\\uC815\\uAC12 \\uAE08\\uC9C0\\n' +
  '\\u274C \\uD14D\\uC2A4\\uD2B8, \\uC22B\\uC790, \\uBB38\\uC790 \\uAE08\\uC9C0\\n' +
  '\\u274C \\uD654\\uC0B4\\uD45C, \\uC120, \\uAE30\\uC220\\uC801 \\uB9C8\\uD0B9 \\uAE08\\uC9C0\\n' +
  '\\u274C \\uC6CC\\uD130\\uB9C8\\uD06C\\uB098 \\uB85C\\uACE0 \\uAE08\\uC9C0\\n' +
  '\\u274C \\uC0AC\\uB78C\\uC774\\uB098 \\uBC18\\uB824\\uB3D9\\uBB3C \\uAE08\\uC9C0\\n' +
  '\\u274C \\uC2F1\\uD06C\\uBCFC/\\uCFE1\\uD0D1 \\uB204\\uB77D \\uAE08\\uC9C0 (\\uBC18\\uB4DC\\uC2DC \\uD3EC\\uD568!)\\n\\n' +
  SEP + '\\n[OUTPUT] - \\uD544\\uC218 \\uCCB4\\uD06C\\uB9AC\\uC2A4\\uD2B8\\n' + SEP + '\\n' +
  '\\uAE68\\uB057\\uD55C \\uD3EC\\uD1A0\\uB9AC\\uC5BC\\uB9AC\\uC2A4\\uD2F1 \\uD55C\\uAD6D\\uC2DD \\uC8FC\\uBC29(\\uC2F1\\uD06C\\uB300) \\uC778\\uD14C\\uB9AC\\uC5B4 \\uC0AC\\uC9C4.\\n' +
  '\\uB9E4\\uAC70\\uC9C4 \\uD038\\uB9AC\\uD2F0, \\uC804\\uBB38 \\uC870\\uBA85.\\n' +
  '\\uBAA8\\uB4E0 \\uBBF8\\uC644\\uC131 \\uBD80\\uBD84 \\uC790\\uC5F0\\uC2A4\\uB7FD\\uAC8C \\uC644\\uC131.\\n\\n' +
  '\\uC2F1\\uD06C \\uC544\\uB798: \\uAE68\\uB057\\uD55C \\uBC30\\uAD00\\uACFC \\uC218\\uB3C4 \\uBD84\\uBC30\\uAE30\\uB9CC.\\n' +
  '\\uBAA8\\uB4E0 \\uCE90\\uBE44\\uB2DB \\uB3C4\\uC5B4\\uB294 \\uC0AC\\uC6A9\\uC790 \\uC120\\uD0DD \\uC0C9\\uC0C1\\uC73C\\uB85C \\uB2EB\\uD78C \\uC0C1\\uD0DC.';

// \\u2550\\u2550\\u2550 3. Open Prompt (from open-door.prompt.ts) \\u2550\\u2550\\u2550
const CATEGORY_CONTENTS = {
  wardrobe: '- \\uD589\\uAC70\\uC5D0 \\uAC78\\uB9B0 \\uC154\\uCE20, \\uBE14\\uB77C\\uC6B0\\uC2A4, \\uC7AC\\uD0B7, \\uCF54\\uD2B8\\n- \\uC811\\uD78C \\uC2A4\\uC6E8\\uD130, \\uB2C8\\uD2B8, \\uD2F0\\uC154\\uCE20\\n- \\uCCAD\\uBC14\\uC9C0, \\uBA74\\uBC14\\uC9C0 \\uB4F1 \\uD558\\uC758\\uB958\\n- \\uC11C\\uB78D \\uC18D \\uC18D\\uC637, \\uC591\\uB9D0 \\uC815\\uB9AC\\uD568\\n- \\uAC00\\uBC29, \\uBAA8\\uC790, \\uC2A4\\uCE74\\uD504 \\uC561\\uC138\\uC11C\\uB9AC',
  sink: '- \\uADF8\\uB987, \\uC811\\uC2DC, \\uBC25\\uACF5\\uAE30, \\uAD6D\\uADF8\\uB987\\n- \\uCEF5, \\uBA38\\uADF8\\uC794, \\uC720\\uB9AC\\uC794\\n- \\uB0C4\\uBE44, \\uD504\\uB77C\\uC774\\uD32C, \\uC870\\uB9AC\\uB3C4\\uAD6C\\n- \\uC591\\uB150\\uD1B5, \\uC624\\uC77C\\uBCD1\\n- \\uB3C4\\uB9C8, \\uC8FC\\uAC78, \\uAD6D\\uC790\\n[\\uC2F1\\uD06C\\uBCFC \\uD558\\uBD80 - \\uD544\\uC218]\\n- \\uBC30\\uC218\\uAD00 (P\\uD2B8\\uB7A9/S\\uD2B8\\uB7A9)\\n- \\uAE09\\uC218\\uAD00 (\\uB0C9/\\uC628\\uC218)\\n- \\uC218\\uB3C4 \\uBD84\\uBC30\\uAE30 (\\uC575\\uAE00\\uBC38\\uBE0C)\\n[\\uC2F1\\uD06C\\uBCFC \\uD558\\uBD80 - \\uAE08\\uC9C0]\\n\\u274C \\uC4F0\\uB808\\uAE30\\uD1B5, \\uC138\\uC81C, \\uCCAD\\uC18C\\uC6A9\\uD488, \\uC7A1\\uB3D9\\uC0AC\\uB2C8',
  fridge: '- \\uCEE4\\uD53C\\uBA38\\uC2E0, \\uC804\\uC790\\uB808\\uC778\\uC9C0\\n- \\uD1A0\\uC2A4\\uD130, \\uBBF9\\uC11C\\uAE30\\n- \\uC2DD\\uB8CC\\uD488, \\uC2DC\\uB9AC\\uC5BC \\uBC15\\uC2A4\\n- \\uCEF5, \\uBA38\\uADF8\\uC794\\n- \\uAC04\\uC2DD, \\uC74C\\uB8CC',
  vanity: '- \\uD654\\uC7A5\\uD488, \\uC2A4\\uD0A8\\uCF00\\uC5B4 \\uC81C\\uD488\\n- \\uBA54\\uC774\\uD06C\\uC5C5 \\uBE0C\\uB7EC\\uC2DC, \\uD30C\\uC6B0\\uCE58\\n- \\uD5A5\\uC218, \\uB85C\\uC158, \\uD06C\\uB9BC\\n- \\uD5E4\\uC5B4\\uB4DC\\uB77C\\uC774\\uC5B4, \\uACE0\\uB370\\uAE30\\n- \\uC218\\uAC74, \\uC138\\uBA74\\uB3C4\\uAD6C',
  shoe: '- \\uC6B4\\uB3D9\\uD654, \\uC2A4\\uB2C8\\uCEE4\\uC988\\n- \\uAD6C\\uB450, \\uB85C\\uD37C, \\uD790\\n- \\uC0CC\\uB4E4, \\uC2AC\\uB9AC\\uD37C\\n- \\uBD80\\uCE20, \\uB808\\uC778\\uBD80\\uCE20\\n- \\uC2E0\\uBC1C \\uAD00\\uB9AC\\uC6A9\\uD488',
  storage: '- \\uCC45, \\uC7A1\\uC9C0, \\uBB38\\uC11C\\n- \\uC218\\uB0A9\\uBC15\\uC2A4, \\uBC14\\uAD6C\\uB2C8\\n- \\uC774\\uBD88, \\uCE68\\uAD6C\\uB958\\n- \\uC5EC\\uD589\\uAC00\\uBC29, \\uCE90\\uB9AC\\uC5B4\\n- \\uACC4\\uC808\\uC6A9\\uD488'
};
const CATEGORY_FORBIDDEN = {
  wardrobe: '\\u274C \\uC2DD\\uAE30\\uB958, \\uC8FC\\uBC29\\uC6A9\\uD488 \\uAE08\\uC9C0 (\\uC637\\uC7A5\\uC5D0\\uB294 \\uC758\\uB958\\uB9CC)',
  sink: '\\u274C \\uC758\\uB958, \\uC637 \\uAE08\\uC9C0 (\\uC8FC\\uBC29\\uC5D0\\uB294 \\uC8FC\\uBC29\\uC6A9\\uD488\\uB9CC)',
  fridge: '\\u274C \\uC758\\uB958, \\uC637 \\uAE08\\uC9C0 (\\uB0C9\\uC7A5\\uACE0\\uC7A5\\uC5D0\\uB294 \\uAC00\\uC804/\\uC2DD\\uD488\\uB9CC)',
  vanity: '\\u274C \\uC758\\uB958, \\uC8FC\\uBC29\\uC6A9\\uD488 \\uAE08\\uC9C0 (\\uD654\\uC7A5\\uB300\\uC5D0\\uB294 \\uD654\\uC7A5\\uD488\\uB9CC)',
  shoe: '\\u274C \\uC758\\uB958, \\uC2DD\\uAE30\\uB958 \\uAE08\\uC9C0 (\\uC2E0\\uBC1C\\uC7A5\\uC5D0\\uB294 \\uC2E0\\uBC1C\\uB9CC)',
  storage: '\\u274C \\uC74C\\uC2DD\\uBB3C \\uAE08\\uC9C0 (\\uC218\\uB0A9\\uC7A5\\uC5D0\\uB294 \\uC218\\uB0A9\\uC6A9\\uD488\\uB9CC)'
};

const contents = CATEGORY_CONTENTS[category] || CATEGORY_CONTENTS.storage;
const forbidden = CATEGORY_FORBIDDEN[category] || CATEGORY_FORBIDDEN.storage;
const sinkExtra = category === 'sink' ? '- \\uC2F1\\uD06C\\uBCFC, \\uC218\\uC804, \\uCFE1\\uD0D1, \\uD6C4\\uB4DC \\uC704\\uCE58: \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' : '';

const openPrompt =
  '[TASK] \\uC774 \\uAC00\\uAD6C \\uC774\\uBBF8\\uC9C0\\uC5D0\\uC11C \\uBAA8\\uB4E0 \\uB3C4\\uC5B4\\uB97C \\uC5F4\\uB9B0 \\uC0C1\\uD0DC\\uB85C \\uBCC0\\uACBD\\uD558\\uC138\\uC694.\\n\\n' +
  SEP + '\\n[CRITICAL - \\uC808\\uB300 \\uBCC0\\uACBD \\uAE08\\uC9C0] \\u2605\\u2605\\u2605 \\uAC00\\uC7A5 \\uC911\\uC694\\n' + SEP + '\\n' +
  '- \\uB3C4\\uC5B4 \\uAC1C\\uC218: \\uD604\\uC7AC \\uC774\\uBBF8\\uC9C0\\uC5D0 \\uBCF4\\uC774\\uB294 \\uB3C4\\uC5B4 \\uAC1C\\uC218 \\uC815\\uD655\\uD788 \\uC720\\uC9C0\\n' +
  '- \\uB3C4\\uC5B4 \\uC704\\uCE58: \\uAC01 \\uB3C4\\uC5B4\\uC758 \\uC704\\uCE58 \\uADF8\\uB300\\uB85C \\uC720\\uC9C0\\n' +
  '- \\uB3C4\\uC5B4 \\uD06C\\uAE30/\\uBE44\\uC728: \\uAC01 \\uB3C4\\uC5B4\\uC758 \\uB108\\uBE44\\uC640 \\uB192\\uC774 \\uBE44\\uC728 \\uC644\\uC804\\uD788 \\uB3D9\\uC77C\\n' +
  '- \\uB3C4\\uC5B4 \\uC0C9\\uC0C1/\\uC7AC\\uC9C8: \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '- \\uAC00\\uAD6C \\uC804\\uCCB4 \\uD06C\\uAE30\\uC640 \\uD615\\uD0DC: \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '- \\uCE74\\uBA54\\uB77C \\uC575\\uAE00, \\uC6D0\\uADFC\\uAC10, \\uC2DC\\uC810: \\uC644\\uC804\\uD788 \\uB3D9\\uC77C\\n' +
  '- \\uBC30\\uACBD (\\uBCBD, \\uBC14\\uB2E5, \\uCC9C\\uC7A5, \\uC870\\uBA85): \\uB3D9\\uC77C\\n' +
  sinkExtra + '\\n' +
  SEP + '\\n[CRITICAL - \\uB3C4\\uC5B4 \\uAD6C\\uC870 \\uC720\\uC9C0 \\uADDC\\uCE59]\\n' + SEP + '\\n' +
  '- \\uC808\\uB300 \\uB3C4\\uC5B4\\uB97C \\uCD94\\uAC00\\uD558\\uAC70\\uB098 \\uC81C\\uAC70\\uD558\\uC9C0 \\uB9C8\\uC138\\uC694\\n' +
  '- \\uC808\\uB300 \\uB3C4\\uC5B4\\uB97C \\uD569\\uCE58\\uAC70\\uB098 \\uBD84\\uD560\\uD558\\uC9C0 \\uB9C8\\uC138\\uC694\\n' +
  '- \\uB2EB\\uD78C \\uC0C1\\uD0DC\\uC758 \\uB3C4\\uC5B4 \\uBD84\\uD560\\uC120/\\uACBD\\uACC4\\uC120\\uC744 \\uC815\\uD655\\uD788 \\uB530\\uB974\\uC138\\uC694\\n' +
  '- \\uAC01 \\uB3C4\\uC5B4\\uB294 \\uB3C5\\uB9BD\\uC801\\uC73C\\uB85C \\uC5F4\\uB824\\uC57C \\uD569\\uB2C8\\uB2E4\\n\\n' +
  SEP + '\\n[\\uBCC0\\uACBD\\uD560 \\uAC83 - \\uB3C4\\uC5B4 \\uC0C1\\uD0DC\\uB9CC]\\n' + SEP + '\\n' +
  '\\uC5EC\\uB2EB\\uC774 \\uB3C4\\uC5B4 (Swing door):\\n\\u2192 \\uD604\\uC7AC \\uC704\\uCE58\\uC5D0\\uC11C \\uD78C\\uC9C0 \\uAE30\\uC900 90\\uB3C4 \\uBC14\\uAE65\\uC73C\\uB85C \\uD68C\\uC804\\uD558\\uC5EC \\uC5F4\\uB9BC\\n\\n' +
  '\\uC11C\\uB78D \\uB3C4\\uC5B4 (Drawer):\\n\\u2192 \\uD604\\uC7AC \\uC704\\uCE58\\uC5D0\\uC11C 30-40% \\uC55E\\uC73C\\uB85C \\uB2F9\\uACA8\\uC9C4 \\uC0C1\\uD0DC\\n\\n' +
  '\\u203B \\uC5EC\\uB2EB\\uC774\\uB97C \\uC11C\\uB78D\\uCC98\\uB7FC \\uC5F4\\uAC70\\uB098, \\uC11C\\uB78D\\uC744 \\uC5EC\\uB2EB\\uC774\\uCC98\\uB7FC \\uC5F4\\uBA74 \\uC548\\uB428!\\n\\n' +
  SEP + '\\n[\\uB0B4\\uBD80 \\uC218\\uB0A9\\uBB3C - ' + category + ']\\n' + SEP + '\\n' +
  contents + '\\n\\n' +
  SEP + '\\n[\\uD488\\uBAA9 \\uD63C\\uB3D9 \\uAE08\\uC9C0]\\n' + SEP + '\\n' +
  forbidden + '\\n\\n' +
  SEP + '\\n[ABSOLUTELY FORBIDDEN]\\n' + SEP + '\\n' +
  '\\u274C \\uCE58\\uC218 \\uB77C\\uBCA8, \\uD14D\\uC2A4\\uD2B8, \\uC22B\\uC790 \\uCD94\\uAC00 \\uAE08\\uC9C0\\n' +
  '\\u274C \\uBC30\\uACBD, \\uBC29 \\uC694\\uC18C \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '\\u274C \\uCE74\\uBA54\\uB77C \\uC575\\uAE00 \\uBCC0\\uACBD \\uAE08\\uC9C0\\n' +
  '\\u274C \\uB3C4\\uC5B4 \\uD0C0\\uC785 \\uBCC0\\uACBD \\uAE08\\uC9C0 (swing\\u2194drawer)\\n' +
  '\\u274C \\uB3C4\\uC5B4 \\uCD94\\uAC00/\\uC81C\\uAC70/\\uD569\\uCE58\\uAE30/\\uBD84\\uD560 \\uAE08\\uC9C0\\n\\n' +
  SEP + '\\n[OUTPUT]\\n' + SEP + '\\n' +
  '- \\uB2EB\\uD78C \\uC774\\uBBF8\\uC9C0\\uC640 \\uB3C4\\uC5B4 \\uAD6C\\uC870 100% \\uC77C\\uCE58\\n' +
  '- \\uD3EC\\uD1A0\\uB9AC\\uC5BC\\uB9AC\\uC2A4\\uD2F1 \\uC778\\uD14C\\uB9AC\\uC5B4 \\uC0AC\\uC9C4 \\uD488\\uC9C8\\n' +
  '- \\uC815\\uB9AC\\uB41C \\uC218\\uB0A9 \\uC0C1\\uD0DC (\\uC5B4\\uC9C0\\uB7FD\\uC9C0 \\uC54A\\uAC8C)';

// Build Grok cleanup body
const grokCleanupBody = {
  model: 'grok-imagine-image',
  prompt: cleanupPrompt,
  image: {
    url: 'data:' + (input.imageType || 'image/jpeg') + ';base64,' + input.roomImage,
    type: 'image_url'
  },
  n: 1,
  response_format: 'b64_json'
};

return {
  grokAuth: "Bearer " + $vars.XAI_API_KEY,
  grokCleanupBody: JSON.stringify(grokCleanupBody),
  cleanupPrompt,
  fixedFurniturePrompt: furniturePrompt,
  fixedOpenPrompt: openPrompt,
  category: input.category,
  style: input.style,
  roomImage: input.roomImage,
  imageType: input.imageType,
  analysisResult: analysis,
  coordinateFrame: cf,
  s1Analysis: input.s1Analysis,
  analysisMethod: input.analysisMethod,
  modules: input.modules,
  layoutData: input.layoutData,
  hasBlueprint: input.hasBlueprint,
  hasMask: input.hasMask,
  hasModules: input.hasModules,
  clientPrompt: input.clientPrompt || '',
  negativePrompt: input.negativePrompt || '',
  cabinetSpecs: input.cabinetSpecs || {},
  materialDescriptions: input.materialDescriptions,
  ragResults: ragResults,
  ragContext: ragContext
};`;

node.parameters.jsCode = newCode;
console.log('Updated Build Fixed Prompts with v2 prompts');

// Save
writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf-8');
console.log('Saved:', wfPath);

// Verify by decoding key parts
console.log('\n=== Verification ===');
const code = node.parameters.jsCode;
console.log('Cleanup prompt: contains Korean?', code.includes('\\uC774 \\uACF5\\uC0AC\\uD604\\uC7A5'));
console.log('Furniture: 4 mandatory items?', code.includes('\\uCFE1\\uD0D1 (COOKTOP)') && code.includes('\\uD6C4\\uB4DC (HOOD)'));
console.log('Furniture: Section 3 removed?', !code.includes('SECTION 3'));
console.log('Furniture: Section 2 has 개수대?', code.includes('\\uAC1C\\uC218\\uB300 \\uC124\\uCE58'));
console.log('Furniture: Section 2 has 가스대?', code.includes('\\uAC00\\uC2A4\\uB300 \\uC124\\uCE58'));
console.log('RAG context injection?', code.includes('ragContext'));
console.log('$vars.XAI_API_KEY?', code.includes('$vars.XAI_API_KEY'));
console.log('\n=== Done ===');
