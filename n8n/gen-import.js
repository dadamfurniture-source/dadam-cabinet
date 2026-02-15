const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'Dadam Interior v8 (Claude Analysis) - updated.json');
const DST = path.join(__dirname, 'v8-import.json');

// Load API keys from n8n/.env file
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ n8n/.env file not found. Create it with ANTHROPIC_API_KEY and GEMINI_API_KEY');
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
for (const line of envContent.split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.+)$/);
  if (match) envVars[match[1].trim()] = match[2].trim();
}

const ANTHROPIC_KEY = envVars.ANTHROPIC_API_KEY;
const GEMINI_KEY = envVars.GEMINI_API_KEY;

if (!ANTHROPIC_KEY || !GEMINI_KEY) {
  console.error('❌ Missing ANTHROPIC_API_KEY or GEMINI_API_KEY in n8n/.env');
  process.exit(1);
}

const workflow = JSON.parse(fs.readFileSync(SRC, 'utf8'));

// 1. Change name
workflow.name = 'Dadam Interior v8 (Claude Analysis) - Import';

// 2. Patch HTTP Request nodes
let patchedCount = 0;
for (const node of workflow.nodes) {
  if (node.type !== 'n8n-nodes-base.httpRequest') continue;

  const url = node.parameters?.url || '';

  // Anthropic API nodes: replace x-api-key header value
  if (url.includes('api.anthropic.com')) {
    const params = node.parameters?.headerParameters?.parameters;
    if (params) {
      for (const hdr of params) {
        if (hdr.name === 'x-api-key') {
          console.log(`  [Anthropic] ${node.name}: x-api-key patched`);
          hdr.value = ANTHROPIC_KEY;
          patchedCount++;
        }
      }
    }
  }

  // Gemini API nodes: replace key= query parameter in URL
  if (url.includes('generativelanguage.googleapis.com')) {
    node.parameters.url = url.replace(
      /key=[^&}]*(}})?/,
      `key=${GEMINI_KEY}`
    );
    console.log(`  [Gemini] ${node.name}: URL key patched`);
    patchedCount++;
  }
}

fs.writeFileSync(DST, JSON.stringify(workflow, null, 2), 'utf8');
console.log(`\nDone. Patched ${patchedCount} nodes. Written to ${DST}`);
