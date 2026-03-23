#!/usr/bin/env node
// Fix "Format Response (Error)" node: reserved key 'error' → 'error_detail' + {json: } wrapper
import { config } from 'dotenv';
config({ path: '../n8n/.env' });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

async function main() {
  // 1. Get current workflow
  console.log('Fetching workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const wf = await res.json();

  // 2. Fix the error node
  const errorNode = wf.nodes.find(n => n.name === 'Format Response (Error)');
  if (!errorNode) {
    console.log('ERROR: Node not found');
    process.exit(1);
  }

  console.log('BEFORE:', errorNode.parameters.jsCode);

  errorNode.parameters.jsCode = `const input = $('Parse S3 + Build Bodies').first().json;
return [{json: {
  success: false,
  message: 'Background cleanup failed',
  error_detail: 'Background cleanup failed - Gemini could not generate cleaned image',
  category: input.category
}}];`;

  console.log('AFTER:', errorNode.parameters.jsCode);

  // 3. Update workflow
  console.log('\nUpdating workflow...');
  const updateRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: {
      'X-N8N-API-KEY': N8N_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
    }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    console.log('UPDATE FAILED:', updateRes.status, err.substring(0, 500));
    process.exit(1);
  }

  const updated = await updateRes.json();
  console.log('Updated! active=' + updated.active);

  // 4. Verify
  const verifyNode = updated.nodes.find(n => n.name === 'Format Response (Error)');
  console.log('VERIFY:', verifyNode.parameters.jsCode);
}

main().catch(err => { console.error(err); process.exit(1); });
