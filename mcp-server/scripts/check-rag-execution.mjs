#!/usr/bin/env node
// Check v10 workflow execution - verify RAG node
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const WF_ID = 'KUuawjm7m3nS0qHH';

async function main() {
  // Get latest executions
  const listRes = await fetch(`${BASE}/executions?workflowId=${WF_ID}&limit=5`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const list = await listRes.json();
  if (!list.data || list.data.length === 0) {
    console.log('No executions found. Triggering test...');
    return;
  }
  console.log('Recent executions:');
  for (const ex of list.data) {
    console.log(`  ID: ${ex.id} | status: ${ex.status} | started: ${ex.startedAt}`);
  }

  const execId = list.data[0].id;
  console.log(`\nChecking execution: ${execId}`);
  const res = await fetch(`${BASE}/executions/${execId}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const ex = await res.json();
  const runData = ex.data?.resultData?.runData || {};
  const nodeNames = Object.keys(runData);
  console.log('Executed nodes:', nodeNames.join(', '));

  // Check RAG node
  if (runData['Supabase RAG Search']) {
    const ragResult = runData['Supabase RAG Search'][0];
    if (ragResult.error) {
      console.log('\n❌ RAG Search ERROR:', ragResult.error.message);
      return;
    }
    const ragOutput = ragResult.data?.main?.[0]?.[0]?.json;
    console.log('\n✅ Supabase RAG Search:');
    console.log('  ragRuleCount:', ragOutput?.ragRuleCount);
    console.log('  ragTriggers:', JSON.stringify(ragOutput?.ragTriggers));
    if (ragOutput?.ragRules) {
      console.log('  background rules:', ragOutput.ragRules.background?.length);
      console.log('  module rules:', ragOutput.ragRules.modules?.length);
      console.log('  door rules:', ragOutput.ragRules.doors?.length);
      console.log('  material rules:', ragOutput.ragRules.materials?.length);
      if (ragOutput.ragRules.modules?.length > 0) {
        console.log('\n  Sample module rules:');
        ragOutput.ragRules.modules.slice(0, 3).forEach(r => console.log('    ', r));
      }
      if (ragOutput.ragRules.background?.length > 0) {
        console.log('\n  Sample background rules:');
        ragOutput.ragRules.background.slice(0, 3).forEach(r => console.log('    ', r));
      }
    }
  } else {
    console.log('\n⚠ RAG node not in execution (pre-deploy run)');
  }

  // Check Build All Prompts for RAG usage
  if (runData['Build All Prompts']) {
    const buildResult = runData['Build All Prompts'][0];
    if (buildResult.error) {
      console.log('\n❌ Build All Prompts ERROR:', buildResult.error.message);
      return;
    }
    const output = buildResult.data?.main?.[0]?.[0]?.json;
    console.log('\n✅ Build All Prompts:');
    console.log('  renderingMode:', output?.renderingMode);
    console.log('  hasBlueprint:', output?.hasBlueprint);
    const prompt = output?.furniturePrompt || '';
    console.log('  furniturePrompt length:', prompt.length);
    console.log('  has RAG sections:', prompt.includes('[BACKGROUND RULES]') || prompt.includes('[MODULE RULES]'));
    if (prompt.includes('[MODULE RULES]')) {
      const moduleMatch = prompt.match(/\[MODULE RULES\]([\s\S]*?)(?:\[|★)/);
      if (moduleMatch) console.log('  MODULE RULES preview:', moduleMatch[1].trim().substring(0, 200));
    }
  }

  // Check errors
  for (const [name, results] of Object.entries(runData)) {
    if (results[0]?.error) {
      console.log(`\n❌ ${name}: ${results[0].error.message}`);
    }
  }
}

main().catch(e => console.error('Fatal:', e));
