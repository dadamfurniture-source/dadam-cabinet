#!/usr/bin/env node
// Check latest n8n execution - extract S3 prompts and Gemini results
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { writeFileSync, mkdirSync } from 'fs';
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../n8n/.env') });

const N8N_KEY = process.env.N8N_API_KEY;
const BASE = 'https://dadam.app.n8n.cloud/api/v1';
const WF_ID = '4Nw23tbPb3Gg18gV';

async function main() {
  // Get latest executions
  const listRes = await fetch(`${BASE}/executions?workflowId=${WF_ID}&limit=3&status=success`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const list = await listRes.json();
  const execId = list.data[0].id;
  console.log('Latest execution:', execId);

  const res = await fetch(`${BASE}/executions/${execId}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': N8N_KEY },
  });
  const ex = await res.json();
  const runData = ex.data?.resultData?.runData || {};

  // 1. Check Build S3 Request output (S3_PROMPT sent to Claude)
  console.log('\n=== Build S3 Request → Claude S3 Body ===');
  const buildS3 = runData['Build S3 Request']?.[0]?.data?.main?.[0]?.[0]?.json;
  if (buildS3?.claudeS3Body) {
    const body = JSON.parse(buildS3.claudeS3Body);
    const prompt = body.messages[0].content;
    console.log('S3 Prompt length:', prompt.length, 'chars');
    console.log('Has TMPL_CLEANUP:', prompt.includes('TMPL') || prompt.includes('BACKGROUND CLEANUP'));
    console.log('Has KEEP pattern:', prompt.includes('KEEP'));
    console.log('Has MAX chars rule:', prompt.includes('MAX 1000'));
    console.log('\n--- Full S3 Prompt ---');
    console.log(prompt);
  }

  // 2. Check Claude S3 response (generated prompts)
  console.log('\n\n=== Claude S3 Prompt Gen → Response ===');
  const s3Resp = runData['Claude S3 Prompt Gen']?.[0]?.data?.main?.[0]?.[0]?.json;
  if (s3Resp?.content) {
    const text = s3Resp.content.find(b => b.type === 'text')?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const prompts = JSON.parse(jsonMatch[0]);
      console.log('\n--- cleanup_prompt ---');
      console.log('Length:', prompts.cleanup_prompt?.length, 'chars');
      console.log(prompts.cleanup_prompt);
      console.log('\n--- furniture_prompt ---');
      console.log('Length:', prompts.furniture_prompt?.length, 'chars');
      console.log(prompts.furniture_prompt);
      console.log('\n--- open_prompt ---');
      console.log('Length:', prompts.open_prompt?.length, 'chars');
      console.log(prompts.open_prompt);
    }
  }

  // 3. Check Parse S3 + Build Bodies output
  console.log('\n\n=== Parse S3 + Build Bodies ===');
  const parseS3 = runData['Parse S3 + Build Bodies']?.[0]?.data?.main?.[0]?.[0]?.json;
  if (parseS3) {
    console.log('s3Success:', parseS3.s3Success);
    console.log('cleanupPromptLength:', parseS3.cleanupPromptLength);
  }

  // 4. Check Gemini responses
  for (const nodeName of ['Gemini Background Cleanup', 'Gemini Furniture', 'Gemini Open Door']) {
    const gemini = runData[nodeName]?.[0];
    if (!gemini) { console.log(`\n${nodeName}: NOT FOUND`); continue; }
    if (gemini.error) { console.log(`\n${nodeName}: ERROR -`, gemini.error.message); continue; }
    const json = gemini.data?.main?.[0]?.[0]?.json || {};
    const candidate = json.candidates?.[0];
    console.log(`\n=== ${nodeName} ===`);
    console.log('finishReason:', candidate?.finishReason);
    console.log('promptTokens:', json.usageMetadata?.promptTokenCount);
    const parts = candidate?.content?.parts || [];
    const hasImage = parts.some(p => p.inlineData || p.inline_data);
    const textPart = parts.find(p => p.text);
    console.log('hasImage:', hasImage);
    if (textPart) console.log('text:', textPart.text.substring(0, 300));
  }

  // 5. Save generated images for visual inspection
  const outDir = resolve(__dirname, '../../tmp/latest-gen');
  mkdirSync(outDir, { recursive: true });

  // Extract images from Gemini responses
  for (const [nodeName, filename] of [
    ['Gemini Background Cleanup', 'background.png'],
    ['Gemini Furniture', 'closed.png'],
    ['Gemini Open Door', 'open.png'],
  ]) {
    const gemini = runData[nodeName]?.[0]?.data?.main?.[0]?.[0]?.json;
    const parts = gemini?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find(p => p.inlineData || p.inline_data);
    if (imgPart) {
      const data = (imgPart.inlineData || imgPart.inline_data).data;
      writeFileSync(resolve(outDir, filename), Buffer.from(data, 'base64'));
      console.log(`\nSaved: ${filename} (${(data.length / 1024).toFixed(0)}KB base64)`);
    }
  }
  console.log('\nImages saved to:', outDir);
}

main().catch(console.error);
