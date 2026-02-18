#!/usr/bin/env node
/**
 * Sanitize: Replace hardcoded xAI API key with $vars.XAI_API_KEY in local JSON
 * This makes the JSON safe for git commits.
 * Use deploy-grok.mjs to inject actual key and deploy to n8n.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wfPath = resolve(__dirname, '../../n8n/v8-grok-analysis.json');
const wf = JSON.parse(readFileSync(wfPath, 'utf-8'));

// Find the hardcoded key by pattern (starts with xai-, ~80 chars)
const keyPattern = /xai-[A-Za-z0-9]{70,90}/g;

let count = 0;
for (const node of wf.nodes) {
  if (!node.parameters?.jsCode) continue;
  const code = node.parameters.jsCode;
  const matches = code.match(keyPattern);
  if (matches) {
    // Replace 'xai-...' (quoted) with $vars.XAI_API_KEY (unquoted)
    let newCode = code.replace(new RegExp("'" + matches[0] + "'", 'g'), '$vars.XAI_API_KEY');
    // Replace "Bearer xai-..." (in grokAuth) with "Bearer " + $vars.XAI_API_KEY
    newCode = newCode.replace('"Bearer ' + matches[0] + '"', '"Bearer " + $vars.XAI_API_KEY');
    if (newCode !== code) {
      node.parameters.jsCode = newCode;
      count++;
      console.log('Sanitized:', node.name);
    }
  }
}

// Verify
const allCode = wf.nodes.filter(n => n.parameters?.jsCode).map(n => n.parameters.jsCode).join('\n');
const remaining = allCode.match(keyPattern);
const varsRefs = (allCode.match(/\$vars\.XAI_API_KEY/g) || []).length;
console.log(`\nNodes sanitized: ${count}`);
console.log(`Hardcoded keys remaining: ${remaining ? remaining.length : 0}`);
console.log(`$vars.XAI_API_KEY refs: ${varsRefs}`);

if (remaining) {
  console.error('ERROR: Hardcoded keys still present!');
  process.exit(1);
}

writeFileSync(wfPath, JSON.stringify(wf, null, 2), 'utf-8');
console.log('Saved:', wfPath);
