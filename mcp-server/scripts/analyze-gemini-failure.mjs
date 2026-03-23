#!/usr/bin/env node
// Gemini Background Cleanup 실패 원인 분석
// 에러 실행 vs 성공 실행의 Gemini 입출력 비교
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

function getNodeOutput(ex, nodeName) {
  const runs = ex.data?.resultData?.runData?.[nodeName];
  if (!runs || !runs[0]) return null;
  const run = runs[0];
  if (run.error) return { error: run.error.message };
  const items = run.data?.main?.[0] || [];
  return items.map(item => {
    const json = item.json || {};
    // Truncate base64 fields for readability
    const cleaned = {};
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === 'string' && v.length > 500) {
        cleaned[k] = v.substring(0, 100) + `...[${v.length} chars]`;
      } else if (typeof v === 'object' && v !== null) {
        cleaned[k] = truncateObj(v);
      } else {
        cleaned[k] = v;
      }
    }
    return cleaned;
  });
}

function truncateObj(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(truncateObj).slice(0, 3);
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length > 200) {
      result[k] = v.substring(0, 80) + `...[${v.length}]`;
    } else if (typeof v === 'object' && v !== null) {
      result[k] = truncateObj(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

async function analyze(errorId, successId) {
  console.log(`\n=== Comparing Error #${errorId} vs Success #${successId} ===\n`);

  const [errEx, okEx] = await Promise.all([getExecution(errorId), getExecution(successId)]);

  // Nodes to inspect
  const nodes = [
    'Gemini Background Cleanup',
    'Parse BG Result',
    'Has Cleaned BG?',
  ];

  for (const nodeName of nodes) {
    console.log(`\n--- ${nodeName} ---`);

    const errOutput = getNodeOutput(errEx, nodeName);
    const okOutput = getNodeOutput(okEx, nodeName);

    console.log(`  [ERROR #${errorId}]:`, JSON.stringify(errOutput, null, 2)?.substring(0, 1500));
    console.log(`  [SUCCESS #${successId}]:`, JSON.stringify(okOutput, null, 2)?.substring(0, 1500));
  }

  // Also check Gemini HTTP response details
  console.log('\n--- Gemini Cleanup HTTP Details ---');
  const errGemini = errEx.data?.resultData?.runData?.['Gemini Background Cleanup']?.[0];
  const okGemini = okEx.data?.resultData?.runData?.['Gemini Background Cleanup']?.[0];

  if (errGemini) {
    const json = errGemini.data?.main?.[0]?.[0]?.json || {};
    console.log('  [ERROR] candidates:', json.candidates?.length || 0);
    if (json.candidates?.[0]) {
      const parts = json.candidates[0].content?.parts || [];
      console.log('  [ERROR] parts:', parts.map(p => {
        if (p.text) return { text: p.text.substring(0, 200) };
        if (p.inlineData || p.inline_data) return { image: true, mime: (p.inlineData || p.inline_data).mimeType || 'unknown' };
        return { unknown: Object.keys(p) };
      }));
    }
    if (json.promptFeedback) console.log('  [ERROR] promptFeedback:', JSON.stringify(json.promptFeedback));
    if (json.error) console.log('  [ERROR] api_error:', JSON.stringify(json.error).substring(0, 500));
    // Check for blocked/safety
    if (json.candidates?.[0]?.finishReason) console.log('  [ERROR] finishReason:', json.candidates[0].finishReason);
    if (json.candidates?.[0]?.safetyRatings) console.log('  [ERROR] safetyRatings:', JSON.stringify(json.candidates[0].safetyRatings));
  }

  if (okGemini) {
    const json = okGemini.data?.main?.[0]?.[0]?.json || {};
    console.log('  [SUCCESS] candidates:', json.candidates?.length || 0);
    if (json.candidates?.[0]) {
      const parts = json.candidates[0].content?.parts || [];
      console.log('  [SUCCESS] parts:', parts.map(p => {
        if (p.text) return { text: p.text.substring(0, 200) };
        if (p.inlineData || p.inline_data) return { image: true, mime: (p.inlineData || p.inline_data).mimeType || 'unknown' };
        return { unknown: Object.keys(p) };
      }));
    }
    if (json.candidates?.[0]?.finishReason) console.log('  [SUCCESS] finishReason:', json.candidates[0].finishReason);
  }
}

// Compare most recent error vs most recent success
analyze(702, 700).catch(err => console.error(err));
