#!/usr/bin/env node
// S3 프롬프트 비교: 에러 vs 성공
import { config } from 'dotenv';
config({ path: '../n8n/.env' });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';

async function getExecution(id) {
  const res = await fetch(`${BASE}/executions/${id}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  return res.json();
}

async function main() {
  const [errEx, okEx] = await Promise.all([getExecution(702), getExecution(700)]);

  // Extract cleanup prompt from "Parse S3 + Build Bodies" output
  for (const [label, ex] of [['ERROR #702', errEx], ['SUCCESS #700', okEx]]) {
    const runs = ex.data?.resultData?.runData?.['Parse S3 + Build Bodies'];
    if (!runs?.[0]?.data?.main?.[0]?.[0]) { console.log(label, ': no data'); continue; }

    const json = runs[0].data.main[0][0].json;

    // The Gemini cleanup body contains the prompt
    let prompt = '';
    try {
      const body = JSON.parse(json.geminiCleanupBody);
      prompt = body.contents[0].parts[0].text;
    } catch(e) {
      prompt = 'PARSE_FAILED';
    }

    console.log(`\n=== ${label} - Cleanup Prompt ===`);
    console.log(`Length: ${prompt.length} chars`);
    console.log(prompt.substring(0, 2000));
    console.log('---');
  }

  // Also check the Gemini response finishMessage
  for (const [label, ex] of [['ERROR #702', errEx], ['SUCCESS #700', okEx]]) {
    const runs = ex.data?.resultData?.runData?.['Gemini Background Cleanup'];
    if (!runs?.[0]?.data?.main?.[0]?.[0]) continue;
    const json = runs[0].data.main[0][0].json;
    const candidate = json.candidates?.[0];
    if (candidate) {
      console.log(`\n=== ${label} - Gemini Response ===`);
      console.log('finishReason:', candidate.finishReason);
      if (candidate.finishMessage) console.log('finishMessage:', candidate.finishMessage);
      console.log('promptTokens:', json.usageMetadata?.promptTokenCount);
      console.log('candidateTokens:', json.usageMetadata?.candidatesTokenCount);
    }
  }
}

main().catch(console.error);
