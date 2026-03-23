#!/usr/bin/env node
// Deploy v5: Wall-preserving cleanup prompt + Build S3 template consistency
// Changes: Parse S3 + Build Bodies uses dynamic S1-based cleanup (walls immutable)
//          Build S3 Request TMPL_CLEANUP updated for consistency
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const WF_ID = '4Nw23tbPb3Gg18gV';
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

async function main() {
  // Read local vars JSON as source of truth
  const varsPath = resolve(__dirname, '../../n8n/v8-claude-analysis-vars.json');
  const localWf = JSON.parse(readFileSync(varsPath, 'utf8'));

  const localParseS3 = localWf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  const localBuildS3 = localWf.nodes.find(n => n.name === 'Build S3 Request');

  if (!localParseS3 || !localBuildS3) {
    console.error('ERROR: Could not find target nodes in local vars JSON');
    process.exit(1);
  }

  // Verify v5.x markers - wall preservation without old FILL for walls
  const noOldFill = !localParseS3.parameters.jsCode.includes('walls with smooth paint finish');
  const hasWallPreserve = localParseS3.parameters.jsCode.includes('wall surfaces');
  console.log('Local verification:');
  console.log('  No old wall-painting FILL:', noOldFill);
  console.log('  Has wall-preserve language:', hasWallPreserve);

  if (!noOldFill) {
    console.error('ERROR: Local vars JSON still has old wall-painting FILL');
    process.exit(1);
  }

  // Fetch current deployed workflow
  console.log('\nFetching deployed workflow...');
  const res = await fetch(`${BASE}/workflows/${WF_ID}`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  if (!res.ok) {
    console.error('Fetch failed:', res.status, await res.text());
    process.exit(1);
  }
  const wf = await res.json();

  // Update Parse S3 + Build Bodies
  const deployParseS3 = wf.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  console.log('\nParse S3 + Build Bodies:');
  console.log('  BEFORE:', deployParseS3.parameters.jsCode.length, 'chars');
  deployParseS3.parameters.jsCode = localParseS3.parameters.jsCode;
  console.log('  AFTER:', deployParseS3.parameters.jsCode.length, 'chars');

  // Update Build S3 Request
  const deployBuildS3 = wf.nodes.find(n => n.name === 'Build S3 Request');
  console.log('\nBuild S3 Request:');
  console.log('  BEFORE:', deployBuildS3.parameters.jsCode.length, 'chars');
  deployBuildS3.parameters.jsCode = localBuildS3.parameters.jsCode;
  console.log('  AFTER:', deployBuildS3.parameters.jsCode.length, 'chars');

  // Deploy
  console.log('\nDeploying to n8n Cloud...');
  const updateRes = await fetch(`${BASE}/workflows/${WF_ID}`, {
    method: 'PUT',
    headers: { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: wf.name,
      nodes: wf.nodes,
      connections: wf.connections,
      settings: wf.settings,
    }),
  });

  if (!updateRes.ok) {
    const err = await updateRes.text();
    console.error('DEPLOY FAILED:', updateRes.status, err.substring(0, 500));
    process.exit(1);
  }

  const updated = await updateRes.json();
  console.log('Deployed! active=' + updated.active);

  // Post-deploy verification
  const verifyParseS3 = updated.nodes.find(n => n.name === 'Parse S3 + Build Bodies');
  console.log('\nPost-deploy verification:');
  console.log('  Has wall-preserve:', verifyParseS3.parameters.jsCode.includes('DO NOT MODIFY WALLS IN ANY WAY'));
  console.log('  Has dynamic S1 wall:', verifyParseS3.parameters.jsCode.includes('wallStructure'));
  console.log('  No old FILL prompt:', !verifyParseS3.parameters.jsCode.includes('smooth paint finish'));
  console.log('\nSUCCESS: v5 wall-preserving cleanup deployed');
}

main().catch(err => { console.error(err); process.exit(1); });
