// ═══════════════════════════════════════════════════════════════
// MCP Tools Integration Test
// ═══════════════════════════════════════════════════════════════

import { searchRagRules } from '../src/utils/api-client.js';

async function testSupabaseRag() {
  console.log('\n=== Testing Supabase RAG Search ===\n');

  try {
    const results = await searchRagRules({
      query_triggers: ['상부장', '하부장', '도어규격'],
      filter_category: 'sink',
      limit_count: 5,
    });

    console.log('✅ RAG Search successful');
    console.log(`   Found ${results.length} rules`);

    if (results.length > 0) {
      console.log('\n   Sample rule:');
      console.log(`   - Type: ${results[0].rule_type || results[0].chunk_type}`);
      console.log(`   - Content: ${results[0].content?.substring(0, 100)}...`);
    }

    return true;
  } catch (error) {
    console.log('❌ RAG Search failed');
    console.log(`   Error: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function testGeminiConnection() {
  console.log('\n=== Testing Gemini API Connection ===\n');

  const config = {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
    },
  };

  if (!config.gemini.apiKey) {
    console.log('❌ GEMINI_API_KEY not set');
    return false;
  }

  try {
    // Simple text generation test
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.gemini.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say "Hello" in Korean' }] }],
        }),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('✅ Gemini API connection successful');
      console.log(`   Response: ${text.substring(0, 50)}`);
      return true;
    } else {
      console.log('❌ Gemini API error:', response.status);
      return false;
    }
  } catch (error) {
    console.log('❌ Gemini connection failed');
    console.log(`   Error: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║        다담AI MCP Server - Integration Test              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // Load environment variables
  const dotenv = await import('dotenv');
  dotenv.config();

  const results = {
    supabase: await testSupabaseRag(),
    gemini: await testGeminiConnection(),
  };

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Test Summary:');
  console.log(`  Supabase RAG: ${results.supabase ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Gemini API:   ${results.gemini ? '✅ PASS' : '❌ FAIL'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(results.supabase && results.gemini ? 0 : 1);
}

main();
