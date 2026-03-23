#!/usr/bin/env node
// Sync deployed n8n workflow to local JSON file
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

async function main() {
  console.log('Fetching deployed workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const wf = await res.json();

  // Extract only the workflow structure (no meta fields like createdAt, updatedAt)
  const exported = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings: wf.settings,
  };

  const outPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');
  writeFileSync(outPath, JSON.stringify(exported, null, 2), 'utf8');
  console.log('Saved to:', outPath);
  console.log('Nodes:', exported.nodes.length);
  console.log('Build S3 Request has TMPL_CLEANUP:', exported.nodes.find(n => n.name === 'Build S3 Request')?.parameters.jsCode.includes('TMPL_CLEANUP'));
  console.log('Parse S3 has KEEP pattern:', exported.nodes.find(n => n.name === 'Parse S3 + Build Bodies')?.parameters.jsCode.includes('KEEP: wall structure'));
}

main().catch(console.error);
