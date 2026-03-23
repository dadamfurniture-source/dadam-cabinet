#!/usr/bin/env node
// Deep check: Gemini Background Cleanup node raw response from latest execution
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const WF_ID = '4Nw23tbPb3Gg18gV';

async function main() {
  // Get latest 3 executions
  const listRes = await fetch(`${BASE}/executions?workflowId=${WF_ID}&limit=3`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const list = await listRes.json();

  for (const ex of list.data) {
    console.log(`\n=== Execution ${ex.id} (${ex.status}) ===`);

    const detailRes = await fetch(`${BASE}/executions/${ex.id}?includeData=true`, {
      headers: { 'X-N8N-API-KEY': N8N_KEY },
    });
    const detail = await detailRes.json();
    const runData = detail.data?.resultData?.runData || {};

    // Check Parse S3 + Build Bodies - cleanupPrompt
    const parseS3 = runData['Parse S3 + Build Bodies']?.[0]?.data?.main?.[0]?.[0]?.json;
    if (parseS3) {
      console.log('\nCleanup prompt (' + parseS3.cleanupPromptLength + ' chars):');
      console.log(parseS3.cleanupPrompt);
    }

    // Check Gemini Background Cleanup - full response
    const geminiNode = runData['Gemini Background Cleanup']?.[0];
    if (geminiNode) {
      if (geminiNode.error) {
        console.log('\nGemini ERROR:', JSON.stringify(geminiNode.error, null, 2));
      }
      const geminiResp = geminiNode.data?.main?.[0]?.[0]?.json;
      if (geminiResp) {
        console.log('\nGemini response keys:', Object.keys(geminiResp));
        console.log('candidates count:', geminiResp.candidates?.length);
        const c = geminiResp.candidates?.[0];
        console.log('finishReason:', c?.finishReason);
        console.log('safetyRatings:', JSON.stringify(c?.safetyRatings, null, 2));
        console.log('promptFeedback:', JSON.stringify(geminiResp.promptFeedback, null, 2));
        // Check if there's an error field
        if (geminiResp.error) {
          console.log('error:', JSON.stringify(geminiResp.error, null, 2));
        }
      }
    } else {
      console.log('\nGemini Background Cleanup: node not found in execution');
    }

    // Check Parse BG Result - did retries run?
    const parseBG = runData['Parse BG Result']?.[0];
    if (parseBG) {
      const bgData = parseBG.data?.main?.[0]?.[0]?.json;
      console.log('\nParse BG Result - hasCleanedBackground:', bgData?.hasCleanedBackground);
    }
  }
}

main().catch(console.error);
