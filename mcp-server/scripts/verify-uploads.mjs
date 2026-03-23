#!/usr/bin/env node
/**
 * Supabase 업로드 검증 스크립트
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}` };

const categories = ['wardrobe','shoe_cabinet','vanity','fridge_cabinet','l_shaped_sink','peninsula_sink','island_kitchen','storage_cabinet'];

// Helper: count query
async function countWhere(filter = '') {
  const q = filter ? `?${filter}&select=id` : '?select=id';
  const r = await fetch(`${URL}/rest/v1/furniture_images${q}`, {
    headers: { ...h, 'Prefer': 'count=exact', 'Range': '0-0' }
  });
  return parseInt(r.headers.get('content-range').split('/')[1]);
}

console.log('=== Furniture Images 검증 ===\n');

// 1. 카테고리별 행 수
console.log('1. 카테고리별 DB 행 수');
let dbTotal = 0;
for (const cat of categories) {
  const cnt = await countWhere(`category=eq.${cat}`);
  dbTotal += cnt;
  console.log(`   ${cat.padEnd(18)} ${cnt}`);
}
console.log(`   ${'TOTAL'.padEnd(18)} ${dbTotal}`);

// 2. 스타일별 분포
console.log('\n2. 스타일 분포');
for (const style of ['modern','luxury','nordic','natural','classic','industrial']) {
  const cnt = await countWhere(`style=eq.${style}`);
  console.log(`   ${style.padEnd(14)} ${cnt} (${(cnt/dbTotal*100).toFixed(1)}%)`);
}

// 3. is_training 플래그
console.log('\n3. is_training 플래그');
const trainTrue = await countWhere('is_training=eq.true');
const trainFalse = await countWhere('is_training=eq.false');
console.log(`   true:  ${trainTrue}`);
console.log(`   false: ${trainFalse}`);
console.log(`   ${trainTrue === dbTotal ? '✓ 모두 training=true' : '✗ 불일치!'}`);

// 4. 필수 필드 NULL 체크
console.log('\n4. 필수 필드 NULL 체크');
for (const field of ['style', 'image_url', 'storage_path', 'description']) {
  const cnt = await countWhere(`${field}=is.null`);
  console.log(`   ${field.padEnd(16)} NULL: ${cnt} ${cnt === 0 ? '✓' : '✗'}`);
}

// 5. 이미지 URL 접근성 테스트 (카테고리별 3개 랜덤 샘플)
console.log('\n5. 이미지 URL 접근성 테스트 (카테고리별 3개)');
let okCount = 0, failCount = 0;
for (const cat of categories) {
  const r = await fetch(`${URL}/rest/v1/furniture_images?category=eq.${cat}&select=image_url,style&limit=3&order=id`, { headers: h });
  const rows = await r.json();
  const results = [];
  for (const row of rows) {
    try {
      const imgRes = await fetch(row.image_url, { method: 'HEAD' });
      const kb = imgRes.headers.get('content-length')
        ? (parseInt(imgRes.headers.get('content-length')) / 1024).toFixed(0) + 'KB'
        : '?';
      if (imgRes.ok) { results.push(`✓ ${row.style}(${kb})`); okCount++; }
      else { results.push(`✗ ${imgRes.status}`); failCount++; }
    } catch (e) { results.push(`✗ ${e.message.slice(0,30)}`); failCount++; }
  }
  console.log(`   ${cat.padEnd(18)} ${results.join(' | ')}`);
}
console.log(`   접근성: ${okCount}/${okCount + failCount} OK`);

// 6. 중복 체크 (같은 storage_path)
console.log('\n6. 중복 storage_path 체크');
const allPaths = await fetch(`${URL}/rest/v1/furniture_images?select=storage_path&limit=5000`, { headers: h });
const pathData = await allPaths.json();
const pathSet = new Set();
let dupes = 0;
for (const row of pathData) {
  if (pathSet.has(row.storage_path)) dupes++;
  pathSet.add(row.storage_path);
}
console.log(`   고유 경로: ${pathSet.size}, 중복: ${dupes} ${dupes === 0 ? '✓' : '✗'}`);

// 7. 카테고리×스타일 매트릭스
console.log('\n7. 카테고리 × 스타일 매트릭스');
const styles = ['modern','luxury','nordic','natural','classic','industrial'];
console.log(`   ${''.padEnd(18)} ${styles.map(s => s.slice(0,6).padStart(7)).join('')}`);
console.log(`   ${'─'.repeat(18)}${'─'.repeat(7 * styles.length)}`);
for (const cat of categories) {
  const cells = [];
  for (const style of styles) {
    const cnt = await countWhere(`category=eq.${cat}&style=eq.${style}`);
    cells.push(String(cnt).padStart(7));
  }
  console.log(`   ${cat.padEnd(18)}${cells.join('')}`);
}

console.log('\n=== 검증 완료 ===');
