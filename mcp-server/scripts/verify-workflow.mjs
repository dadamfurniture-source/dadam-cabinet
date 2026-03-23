import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wf = JSON.parse(readFileSync(resolve(__dirname, '../../n8n/v8-grok-analysis.json'), 'utf-8'));

console.log('=== Workflow Verification ===');
console.log(`Name: ${wf.name}`);
console.log(`Nodes: ${wf.nodes.length}`);
console.log(`Connections: ${Object.keys(wf.connections).length}`);

// Check $vars.XAI_API_KEY
let total = 0;
console.log('\n$vars.XAI_API_KEY references:');
for (const node of wf.nodes) {
  const code = node.parameters && node.parameters.jsCode;
  if (!code) continue;
  const matches = code.match(/\$vars\.XAI_API_KEY/g);
  if (matches) {
    console.log(`  ${node.name}: ${matches.length} ref(s)`);
    total += matches.length;
  }
}
console.log(`  Total: ${total}`);

// Verify no removed nodes referenced
const nodeNames = wf.nodes.map(n => n.name);
const removedNodes = ['Supabase RAG Search', 'Build S3 Request', 'Claude S3 Prompt Gen', 'Build S4 Request', 'Claude S4 QA', 'Format Response + QA'];

console.log('\nRemoved nodes check:');
for (const rn of removedNodes) {
  if (nodeNames.includes(rn)) {
    console.log(`  ERROR: ${rn} still exists!`);
  }
}

// Check code references to removed nodes
console.log('\nDangling references check:');
for (const node of wf.nodes) {
  const code = node.parameters && node.parameters.jsCode;
  if (!code) continue;
  for (const rn of removedNodes) {
    if (code.includes(rn)) {
      console.log(`  WARNING: ${node.name} references removed node "${rn}"`);
    }
  }
}

// Check connection targets exist
console.log('\nConnection target validation:');
for (const [source, conn] of Object.entries(wf.connections)) {
  if (!nodeNames.includes(source)) {
    console.log(`  ERROR: Connection source "${source}" not found in nodes!`);
  }
  for (const outputs of conn.main) {
    for (const target of outputs) {
      if (!nodeNames.includes(target.node)) {
        console.log(`  ERROR: Target "${target.node}" from "${source}" not found!`);
      }
    }
  }
}

// Check all RAG references removed from code
console.log('\nRAG reference check:');
for (const node of wf.nodes) {
  const code = node.parameters && node.parameters.jsCode;
  if (!code) continue;
  const ragRefs = ['ragBg', 'ragModules', 'ragDoors', 'ragMaterials', 'ragDims', 'ragResults', 'triggers', 'materialCodes', 'colorKeywords'];
  for (const ref of ragRefs) {
    if (code.includes(ref)) {
      console.log(`  INFO: ${node.name} has "${ref}" reference`);
    }
  }
}

console.log('\n=== Verification Complete ===');
