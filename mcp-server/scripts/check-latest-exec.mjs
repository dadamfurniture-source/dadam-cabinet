import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

const res = await fetch(`${BASE}/executions?limit=5`, {
  headers: { 'X-N8N-API-KEY': N8N_KEY }
});

const json = await res.json();
const execs = json.data || json;

for (const e of execs) {
  console.log(`ID: ${e.id} | Status: ${e.status} | WF: ${e.workflowId} | Stopped: ${e.stoppedAt}`);
}

// Get the most recent one with includeData
if (execs.length > 0) {
  const latest = execs[0];
  console.log(`\n=== Latest Execution: ${latest.id} (${latest.status}) ===`);

  const detailRes = await fetch(`${BASE}/executions/${latest.id}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY }
  });
  const detail = await detailRes.json();

  const rd = detail.data?.resultData;
  if (rd) {
    console.log('Last node:', rd.lastNodeExecuted);
    if (rd.error) {
      console.log('Error:', JSON.stringify(rd.error).substring(0, 500));
    }
    // Check each node
    const runs = rd.runData || {};
    for (const [node, data] of Object.entries(runs)) {
      const exec = data[0];
      if (exec?.error) {
        console.log(`\nNode ERROR [${node}]:`, exec.error.message || JSON.stringify(exec.error).substring(0, 300));
      } else if (exec?.data?.main?.[0]?.[0]?.json) {
        const j = exec.data.main[0][0].json;
        // Just show key fields, not huge base64
        const summary = {};
        for (const [k, v] of Object.entries(j)) {
          if (typeof v === 'string' && v.length > 200) {
            summary[k] = v.substring(0, 50) + '... (' + v.length + ' chars)';
          } else if (typeof v === 'object' && v !== null) {
            summary[k] = '[object]';
          } else {
            summary[k] = v;
          }
        }
        console.log(`\nNode [${node}]:`, JSON.stringify(summary, null, 2).substring(0, 300));
      }
    }
  }
}
