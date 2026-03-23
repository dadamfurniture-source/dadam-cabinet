#!/usr/bin/env node
// Check older executions to see if IMAGE_OTHER was happening before v5
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const WF_ID = '4Nw23tbPb3Gg18gV';

async function main() {
  // Get more executions
  const listRes = await fetch(`${BASE}/executions?workflowId=${WF_ID}&limit=10`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const list = await listRes.json();

  for (const ex of list.data) {
    const detailRes = await fetch(`${BASE}/executions/${ex.id}?includeData=true`, {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
    });
    const detail = await detailRes.json();
    const runData = detail.data?.resultData?.runData || {};

    const parseS3 = runData['Parse S3 + Build Bodies']?.[0]?.data?.main?.[0]?.[0]?.json;
    const geminiResp = runData['Gemini Background Cleanup']?.[0]?.data?.main?.[0]?.[0]?.json;
    const parseBG = runData['Parse BG Result']?.[0]?.data?.main?.[0]?.[0]?.json;
    const finishReason = geminiResp?.candidates?.[0]?.finishReason || 'N/A';
    const hasBg = parseBG?.hasCleanedBackground || false;
    const promptLen = parseS3?.cleanupPromptLength || 'N/A';
    const promptStart = parseS3?.cleanupPrompt?.substring(0, 60) || 'N/A';
    const startedAt = detail.startedAt ? new Date(detail.startedAt).toLocaleString() : 'N/A';

    console.log(`Exec ${ex.id} | ${startedAt} | ${ex.status} | Gemini: ${finishReason} | hasBg: ${hasBg} | prompt: ${promptLen} chars | "${promptStart}..."`);
  }
}

main().catch(console.error);
