#!/usr/bin/env node
/**
 * Fix: v5 Closed Door 프롬프트에서 배관 가시성 언급 제거
 *
 * 문제: categoryRules.sink에 "SINK CABINET INTERIOR - PLUMBING VISIBLE" 섹션이
 *       closed door 프롬프트에 포함되어 Gemini가 개수대 문을 열어버림
 *
 * 수정: 해당 섹션 제거 + 개수대 문 닫힘 강조 추가
 */
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env') });

const DRY_RUN = process.argv.includes('--dry-run');
const N8N_API_KEY = process.env.N8N_API_KEY;
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://dadam.app.n8n.cloud/api/v1';
const V5_ID = 'KUuawjm7m3nS0qHH';

async function n8nFetch(path, opts = {}) {
  const url = `${N8N_BASE_URL}${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(url, {
        ...opts,
        headers: { 'X-N8N-API-KEY': N8N_API_KEY, 'Content-Type': 'application/json', ...opts.headers },
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`   Retry ${attempt}/3: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Fix: Closed Door Prompt - Remove Plumbing Section');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE DEPLOY'}\n`);

  const res = await n8nFetch(`/workflows/${V5_ID}`);
  const wf = await res.json();
  console.log(`Workflow: "${wf.name}" (${wf.nodes.length} nodes)`);

  // Backup
  const backupPath = resolve(__dirname, '../tmp/pre-v5-closedfix-backup.json');
  writeFileSync(backupPath, JSON.stringify(wf, null, 2));
  console.log(`Backup: ${backupPath}\n`);

  const node = wf.nodes.find(n => n.name === 'Build Prompts');
  if (!node) { console.error('Build Prompts not found!'); process.exit(1); }

  let code = node.parameters.jsCode;
  const origLen = code.length;

  // 1. Remove "SINK CABINET INTERIOR - PLUMBING VISIBLE" from categoryRules.sink
  const plumbingSection = `[SINK CABINET INTERIOR - PLUMBING VISIBLE]
- Water supply pipes and drain pipes inside sink cabinet
- P-trap (curved drain pipe) under sink bowl
- Hot and cold water supply valves
- These pipes MUST be visible when door is opened`;

  if (code.includes(plumbingSection)) {
    code = code.replace(plumbingSection, `[SINK CABINET - ALL DOORS MUST BE FULLY CLOSED]
- The sink cabinet door below the sink bowl MUST be completely closed
- NO plumbing, pipes, or interior should be visible in the closed state
- The area under the sink must show a solid closed door panel`);
    console.log('1. Replaced plumbing-visible section with doors-closed emphasis ✓');
  } else {
    console.log('1. Plumbing section not found (already modified?)');
  }

  // 2. Add explicit sink door closed rule to the closedPrompt section
  const oldSinkForbidden = `❌ Sink placed away from water supply pipe location - FORBIDDEN
❌ Hood/Cooktop placed away from exhaust duct location - FORBIDDEN
❌ Missing sink bowl, faucet, cooktop, or hood (for kitchen) - FORBIDDEN`;

  const newSinkForbidden = `❌ Sink placed away from water supply pipe location - FORBIDDEN
❌ Hood/Cooktop placed away from exhaust duct location - FORBIDDEN
❌ Missing sink bowl, faucet, cooktop, or hood (for kitchen) - FORBIDDEN
❌ Sink cabinet door open or ajar - FORBIDDEN
❌ Any pipes or plumbing visible through open cabinet doors - FORBIDDEN`;

  if (code.includes(oldSinkForbidden)) {
    code = code.replace(oldSinkForbidden, newSinkForbidden);
    console.log('2. Added sink door closed rules to FORBIDDEN list ✓');
  } else {
    console.log('2. FORBIDDEN list not found or already modified');
  }

  // 3. Strengthen the final verification for sink
  const oldVerify = `5. (For Kitchen) Is hood/cooktop placed at calculated exhaust position (\${furniturePlacement.hood_center_mm}mm)? If not, REJECT.
6. (For Kitchen) Are sink bowl, faucet, cooktop, and range hood ALL present? If any missing, REJECT.`;

  const newVerify = `5. (For Kitchen) Is hood/cooktop placed at calculated exhaust position (\${furniturePlacement.hood_center_mm}mm)? If not, REJECT.
6. (For Kitchen) Are sink bowl, faucet, cooktop, and range hood ALL present? If any missing, REJECT.
7. (For Kitchen) Is the sink cabinet door FULLY CLOSED with no pipes visible? If open or ajar, REJECT.`;

  if (code.includes(oldVerify)) {
    code = code.replace(oldVerify, newVerify);
    console.log('3. Added sink door closed check to final verification ✓');
  } else {
    console.log('3. Verification section not found or already modified');
  }

  node.parameters.jsCode = code;
  console.log(`\nCode: ${origLen} → ${code.length} chars`);

  // Validation
  console.log('\n── Validation ──');
  const hasNoPlumbingVisible = !code.includes('pipes MUST be visible when door is opened');
  const hasSinkDoorClosed = code.includes('sink cabinet door below the sink bowl MUST be completely closed');
  const hasForbiddenSinkOpen = code.includes('Sink cabinet door open or ajar - FORBIDDEN');
  console.log(`   ✓ Plumbing-visible removed: ${hasNoPlumbingVisible}`);
  console.log(`   ✓ Sink door closed emphasis: ${hasSinkDoorClosed}`);
  console.log(`   ✓ Sink open forbidden: ${hasForbiddenSinkOpen}`);

  if (!hasNoPlumbingVisible || !hasSinkDoorClosed) {
    console.error('Validation failed!'); process.exit(1);
  }

  if (DRY_RUN) {
    const preview = resolve(__dirname, '../tmp/v5-closedfix-preview.json');
    writeFileSync(preview, JSON.stringify(wf, null, 2));
    console.log(`\nDry run saved: ${preview}`);
    return;
  }

  console.log('\n── Deploying ──');
  await n8nFetch(`/workflows/${V5_ID}`, { method: 'PATCH', body: JSON.stringify({ active: false }) });

  const payload = { nodes: wf.nodes, connections: wf.connections, name: wf.name, settings: wf.settings };
  const upRes = await n8nFetch(`/workflows/${V5_ID}`, { method: 'PUT', body: JSON.stringify(payload) });
  console.log(`Update: ${upRes.status} ${upRes.statusText}`);

  await fetch(`${N8N_BASE_URL}/workflows/${V5_ID}/activate`, { method: 'POST', headers: { 'X-N8N-API-KEY': N8N_API_KEY }, signal: AbortSignal.timeout(15000) });

  const verify = await n8nFetch(`/workflows/${V5_ID}`).then(r => r.json());
  console.log(`Active: ${verify.active}`);
  const vNode = verify.nodes.find(n => n.name === 'Build Prompts');
  console.log(`Build Prompts: ${vNode.parameters.jsCode.length} chars`);
  console.log(`Has sink-closed rule: ${vNode.parameters.jsCode.includes('sink cabinet door below the sink bowl MUST be completely closed')}`);

  console.log('\n════════════════════════════════════════════════════════');
  console.log('CLOSED DOOR PROMPT FIX COMPLETE');
  console.log('════════════════════════════════════════════════════════');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
