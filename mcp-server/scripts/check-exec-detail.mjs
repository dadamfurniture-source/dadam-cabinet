import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

// Get latest execution if no ID provided
let execId = process.argv[2];
if (!execId) {
  const listRes = await fetch(`${BASE}/executions?limit=1`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const listJson = await listRes.json();
  const execs = listJson.data || listJson;
  execId = execs[0]?.id;
  if (!execId) { console.error('No executions found'); process.exit(1); }
}

const res = await fetch(`${BASE}/executions/${execId}?includeData=true`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});
const detail = await res.json();
const rd = detail.data?.resultData;

console.log(`=== Execution ${execId} ===`);
console.log('Status:', detail.status);
console.log('Last node:', rd?.lastNodeExecuted);

if (rd?.error) {
  console.log('\n=== WORKFLOW ERROR ===');
  console.log(JSON.stringify(rd.error, null, 2).substring(0, 1000));
}

const runs = rd?.runData || {};
const nodeNames = Object.keys(runs);
console.log('\nExecuted nodes:', nodeNames.join(' → '));

for (const [node, data] of Object.entries(runs)) {
  const exec = data[0];
  console.log(`\n--- ${node} ---`);

  if (exec?.error) {
    console.log('ERROR:', exec.error.message);
    if (exec.error.description) console.log('Desc:', exec.error.description.substring(0, 300));
    continue;
  }

  const items = exec?.data?.main?.[0] || [];
  console.log('Output items:', items.length);
  if (items.length > 0 && items[0]?.json) {
    const j = items[0].json;
    const keys = Object.keys(j);
    console.log('Keys:', keys.slice(0, 15).join(', ') + (keys.length > 15 ? '...' : ''));
  }
}
