#!/usr/bin/env node
/**
 * Deploy: v5를 프로덕션으로 전환
 *
 * 1. v5 Webhook → dadam-interior-v4 (v9와 동일)
 * 2. Gemini 모델 업그레이드: gemini-2.0-flash-exp-image-generation → gemini-2.5-flash-image
 * 3. API Key 교체: 기존 키 → 현재 유효 키
 * 4. v9 비활성화 → v5 활성화
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
const V9_ID = 'GAheS1PcPkzwVpYP';
const NEW_GEMINI_KEY = process.env.GEMINI_API_KEY; // AIzaSyAa26bl...
const OLD_V5_KEY = 'AIzaSyDqrzcEJJROw9PwdEFx87QxiYyfbW3awfU';
const PRODUCTION_WEBHOOK = 'dadam-interior-v4';

// Models
const OLD_IMAGE_MODEL = 'gemini-2.0-flash-exp-image-generation';
const NEW_IMAGE_MODEL = 'gemini-2.5-flash-image';

async function n8nFetch(path, opts = {}) {
  const url = `${N8N_BASE_URL}${path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: {
          'X-N8N-API-KEY': N8N_API_KEY,
          'Content-Type': 'application/json',
          ...opts.headers,
        },
        signal: AbortSignal.timeout(30000),
      });
      return res;
    } catch (e) {
      if (attempt === 3) throw e;
      console.log(`   Retry ${attempt}/3: ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  v5 → Production Deploy');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE DEPLOY'}\n`);

  // 0. Fetch both workflows
  console.log('0. Fetching workflows...');
  const [v5Res, v9Res] = await Promise.all([
    n8nFetch(`/workflows/${V5_ID}`),
    n8nFetch(`/workflows/${V9_ID}`),
  ]);
  const v5 = await v5Res.json();
  const v9 = await v9Res.json();
  console.log(`   v5: "${v5.name}" (${v5.nodes.length} nodes, active=${v5.active})`);
  console.log(`   v9: "${v9.name}" (${v9.nodes.length} nodes, active=${v9.active})`);

  // 1. Backup both
  const v5Backup = resolve(__dirname, '../tmp/pre-v5-production-backup.json');
  const v9Backup = resolve(__dirname, '../tmp/pre-v9-deactivate-backup.json');
  writeFileSync(v5Backup, JSON.stringify(v5, null, 2));
  writeFileSync(v9Backup, JSON.stringify(v9, null, 2));
  console.log(`\n1. Backups saved`);
  console.log(`   v5: ${v5Backup}`);
  console.log(`   v9: ${v9Backup}`);

  // 2. Update v5 Webhook path
  const webhookNode = v5.nodes.find(n => n.type.includes('webhook'));
  const oldWebhookPath = webhookNode.parameters.path;
  webhookNode.parameters.path = PRODUCTION_WEBHOOK;
  console.log(`\n2. Webhook: ${oldWebhookPath} → ${PRODUCTION_WEBHOOK}`);

  // 3. Update Gemini models in HTTP Request URLs
  console.log(`\n3. Model upgrades:`);
  let modelUpdates = 0;
  for (const n of v5.nodes) {
    if (n.parameters?.url && n.parameters.url.includes(OLD_IMAGE_MODEL)) {
      const oldUrl = n.parameters.url;
      n.parameters.url = oldUrl.replace(OLD_IMAGE_MODEL, NEW_IMAGE_MODEL);
      modelUpdates++;
      console.log(`   ${n.name}: ${OLD_IMAGE_MODEL} → ${NEW_IMAGE_MODEL}`);
    }
  }
  console.log(`   Total: ${modelUpdates} nodes updated`);

  // 4. Replace API keys globally
  console.log(`\n4. API Key replacement:`);
  let keyUpdates = 0;
  for (const n of v5.nodes) {
    const params = JSON.stringify(n.parameters || {});
    if (params.includes(OLD_V5_KEY)) {
      const updated = JSON.parse(params.replace(new RegExp(OLD_V5_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), NEW_GEMINI_KEY));
      n.parameters = updated;
      keyUpdates++;
      console.log(`   ${n.name}: key replaced`);
    }
  }
  console.log(`   Total: ${keyUpdates} nodes updated`);

  // ── Validation ──
  console.log('\n── Validation ──');
  const allParams = v5.nodes.map(n => JSON.stringify(n.parameters || {})).join('');

  const hasOldModel = allParams.includes(OLD_IMAGE_MODEL);
  const hasOldKey = allParams.includes(OLD_V5_KEY);
  const hasNewModel = allParams.includes(NEW_IMAGE_MODEL);
  const hasNewKey = allParams.includes(NEW_GEMINI_KEY);
  const hasProductionWebhook = webhookNode.parameters.path === PRODUCTION_WEBHOOK;

  console.log(`   ✓ Old model removed: ${!hasOldModel}`);
  console.log(`   ✓ Old key removed: ${!hasOldKey}`);
  console.log(`   ✓ New model present: ${hasNewModel}`);
  console.log(`   ✓ New key present: ${hasNewKey}`);
  console.log(`   ✓ Production webhook: ${hasProductionWebhook}`);

  const issues = [];
  if (hasOldModel) issues.push('old model still present');
  if (hasOldKey) issues.push('old API key still present');
  if (!hasNewModel) issues.push('new model missing');
  if (!hasNewKey) issues.push('new API key missing');
  if (!hasProductionWebhook) issues.push('webhook not updated');
  console.log(`   Issues: ${issues.length ? issues.join(', ') : 'NONE ✓'}`);

  if (issues.length) {
    console.error('\nValidation failed! Aborting.');
    process.exit(1);
  }

  // Show final node summary
  console.log('\n── v5 Final Pipeline ──');
  for (const n of v5.nodes) {
    const url = n.parameters?.url || '';
    if (url.includes('generativelanguage')) {
      const model = url.match(/models\/([^:]+)/)?.[1] || '?';
      console.log(`   ${n.name}: ${model}`);
    } else if (n.type.includes('webhook')) {
      console.log(`   ${n.name}: /${webhookNode.parameters.path}`);
    }
  }

  if (DRY_RUN) {
    const previewPath = resolve(__dirname, '../tmp/v5-production-preview.json');
    writeFileSync(previewPath, JSON.stringify(v5, null, 2));
    console.log(`\nDry run saved: ${previewPath}`);
    console.log(`Deploy with: node scripts/deploy-v5-production.mjs`);
    return;
  }

  // ── Deploy ──
  console.log('\n── Deploying ──');

  // A. Deactivate v9
  console.log('A. Deactivating v9...');
  const deactRes = await n8nFetch(`/workflows/${V9_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  console.log(`   v9 deactivate: ${deactRes.status}`);

  // B. Update v5
  console.log('B. Updating v5...');
  const payload = { nodes: v5.nodes, connections: v5.connections, name: v5.name, settings: v5.settings };
  const updateRes = await n8nFetch(`/workflows/${V5_ID}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  console.log(`   v5 update: ${updateRes.status} ${updateRes.statusText}`);

  if (updateRes.status !== 200) {
    const errBody = await updateRes.text();
    console.error('   Error:', errBody.substring(0, 300));
    console.error('\nRolling back: reactivating v9...');
    await n8nFetch(`/workflows/${V9_ID}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
    process.exit(1);
  }

  // C. Activate v5
  console.log('C. Activating v5...');
  const actRes = await n8nFetch(`/workflows/${V5_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({ active: true }),
  });
  console.log(`   v5 activate: ${actRes.status}`);

  // D. Verify
  console.log('D. Verifying...');
  const [v5Check, v9Check] = await Promise.all([
    n8nFetch(`/workflows/${V5_ID}`).then(r => r.json()),
    n8nFetch(`/workflows/${V9_ID}`).then(r => r.json()),
  ]);
  console.log(`   v5 active: ${v5Check.active}`);
  console.log(`   v9 active: ${v9Check.active}`);
  const v5Wh = v5Check.nodes.find(n => n.type.includes('webhook'));
  console.log(`   v5 webhook: ${v5Wh.parameters.path}`);

  console.log('\n════════════════════════════════════════════════════════');
  console.log('V5 PRODUCTION DEPLOY COMPLETE');
  console.log('════════════════════════════════════════════════════════');
  console.log(`v5 (${V5_ID}): ACTIVE — webhook: /webhook/${PRODUCTION_WEBHOOK}`);
  console.log(`v9 (${V9_ID}): INACTIVE`);
  console.log('\nRollback steps:');
  console.log('  1. Deactivate v5, restore v5 from tmp/pre-v5-production-backup.json');
  console.log('  2. Reactivate v9');
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
