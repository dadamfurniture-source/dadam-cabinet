#!/usr/bin/env node
/**
 * LoRA 학습 이미지 큐레이션
 *
 * 네이버웍스 디자인 시안(design_draft)을 이상적 기준 이미지로 사용하여
 * 크롤링 이미지를 Claude Vision으로 검증, 카테고리당 최대 50장 선별
 *
 * 프로세스:
 *   1. 카테고리별 메타데이터 기반 사전 필터 (confidence, style, size)
 *   2. design_draft 기준 이미지 선정
 *   3. Claude Vision으로 후보 이미지 검증 (배치 5장씩)
 *   4. 점수 상위 50장만 is_training=true, 나머지 false
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_PER_CATEGORY = 50;
const BATCH_SIZE = 5;
const CHECKPOINT_DIR = resolve(__dirname, '../tmp/curation');

// 카테고리별 주력 스타일 (이 스타일만 후보에 포함)
const PRIMARY_STYLES = {
  wardrobe:        ['modern'],
  shoe_cabinet:    ['modern', 'luxury'],
  vanity:          ['luxury', 'modern'],
  fridge_cabinet:  null,  // 수량 적으므로 전부
  l_shaped_sink:   ['modern'],
  peninsula_sink:  ['modern', 'luxury'],
  island_kitchen:  ['modern', 'luxury'],
  storage_cabinet: ['modern'],
};

const CATEGORIES = Object.keys(PRIMARY_STYLES);

// ─── Checkpoint ───
mkdirSync(CHECKPOINT_DIR, { recursive: true });
function cpPath(cat) { return resolve(CHECKPOINT_DIR, `${cat}.json`); }
function loadCp(cat) {
  if (existsSync(cpPath(cat))) return JSON.parse(readFileSync(cpPath(cat), 'utf-8'));
  return null;
}
function saveCp(cat, data) { writeFileSync(cpPath(cat), JSON.stringify(data, null, 2)); }

// ─── DB 조회 ───
async function queryImages(category, source = null) {
  let url = `${SUPABASE_URL}/rest/v1/furniture_images?category=eq.${category}&select=id,style,description,image_url,file_size_bytes,source,tags&order=id&limit=1000`;
  if (source) url += `&source=eq.${source}`;
  const res = await fetch(url, { headers: h });
  return res.json();
}

// ─── is_training 업데이트 ───
async function updateTraining(ids, value) {
  // 100개씩 배치
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const idFilter = batch.map(id => `"${id}"`).join(',');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/furniture_images?id=in.(${idFilter})`, {
      method: 'PATCH',
      headers: { ...h, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ is_training: value }),
    });
    if (!res.ok) console.error(`  Update error: ${res.status}`);
  }
}

// ─── Claude Vision 배치 검증 ───
async function verifyBatch(referenceUrl, candidateImages, category) {
  const content = [];

  // 기준 이미지
  content.push({ type: 'text', text: `[기준 이미지] 다담가구 ${category} 실제 시공 사진:` });
  content.push({ type: 'image', source: { type: 'url', url: referenceUrl } });

  // 후보 이미지들
  content.push({ type: 'text', text: `\n아래 ${candidateImages.length}장의 후보 이미지를 기준 이미지와 비교하여 LoRA 학습 적합도를 1~10점으로 평가하세요.\n평가 기준:\n- 스타일 일관성 (기준 이미지와 유사한 한국 빌트인 가구 스타일인가)\n- 이미지 품질 (해상도, 선명도)\n- 구도 적합성 (가구가 주인공인 인테리어 사진인가)\n- 학습 적합성 (워터마크/텍스트/사람 없이 깨끗한가)\n\nJSON 배열로 답하세요: [{"idx":0,"score":8,"reason":"..."}, ...]` });

  for (let i = 0; i < candidateImages.length; i++) {
    content.push({ type: 'text', text: `\n[후보 ${i}]` });
    content.push({ type: 'image', source: { type: 'url', url: candidateImages[i].image_url } });
  }

  for (let retry = 0; retry < 3; retry++) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
        messages: [{ role: 'user', content }],
      });

      const text = response.content[0].text;
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const scores = JSON.parse(match[0]);
        return scores;
      }
    } catch (e) {
      console.warn(`    Vision retry ${retry}: ${e.message.slice(0, 60)}`);
      await new Promise(r => setTimeout(r, 3000 * (retry + 1)));
    }
  }

  // 실패 시 기본 점수
  return candidateImages.map((_, i) => ({ idx: i, score: 5, reason: 'verification failed' }));
}

// ─── 카테고리 처리 ───
async function processCategory(category) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[${category}]`);

  // 이미 처리됐으면 skip
  const existing = loadCp(category);
  if (existing?.completed) {
    console.log(`  SKIP (이미 완료, ${existing.selected.length}장 선별됨)`);
    return existing;
  }

  // 1. 기준 이미지 (design_draft에서 1장)
  const drafts = await queryImages(category, 'design_draft');
  if (drafts.length === 0) {
    console.log(`  WARNING: design_draft 없음, 메타데이터 기반으로만 선별`);
  }
  const referenceImage = drafts.length > 0 ? drafts[0] : null;
  console.log(`  기준 이미지: ${referenceImage ? '있음 (' + drafts.length + '장 시안)' : '없음'}`);

  // 2. 전체 이미지 조회
  const allImages = await queryImages(category);
  console.log(`  전체: ${allImages.length}장`);

  // 3. 사전 필터
  const primaryStyles = PRIMARY_STYLES[category];
  const preFiltered = allImages.filter(img => {
    if (img.file_size_bytes && img.file_size_bytes < 15000) return false;  // < 15KB
    if (primaryStyles && !primaryStyles.includes(img.style)) return false;
    return true;
  });
  console.log(`  사전 필터 후: ${preFiltered.length}장 (style: ${primaryStyles?.join(',')||'전부'}, size>=15KB)`);

  // 4. design_draft 우선 + confidence 순 정렬
  // description에 confidence가 없으므로 tags에서 추출하거나 source로 우선순위
  preFiltered.sort((a, b) => {
    // design_draft 우선
    if (a.source === 'design_draft' && b.source !== 'design_draft') return -1;
    if (b.source === 'design_draft' && a.source !== 'design_draft') return 1;
    // 파일 크기가 큰 것 우선 (보통 고해상도)
    return (b.file_size_bytes || 0) - (a.file_size_bytes || 0);
  });

  // 후보를 최대 80장으로 제한 (검증 비용 절약)
  const candidates = preFiltered.slice(0, 80);
  console.log(`  검증 대상: ${candidates.length}장`);

  // 5. Vision 검증 (기준 이미지가 있을 때만)
  let scored;
  if (referenceImage && candidates.length > MAX_PER_CATEGORY) {
    console.log(`  Claude Vision 검증 시작...`);
    scored = [];
    const batches = [];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      batches.push(candidates.slice(i, i + BATCH_SIZE));
    }

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const scores = await verifyBatch(referenceImage.image_url, batch, category);

      for (let j = 0; j < batch.length; j++) {
        const s = scores.find(s => s.idx === j) || { score: 5, reason: 'not scored' };
        scored.push({
          ...batch[j],
          visionScore: s.score,
          visionReason: s.reason,
        });
      }

      process.stdout.write(`    배치 ${b + 1}/${batches.length} 완료 (${scored.length}장)\r`);
      await new Promise(r => setTimeout(r, 1500));
    }
    console.log();

    // 점수순 정렬
    scored.sort((a, b) => b.visionScore - a.visionScore);
  } else {
    // 기준 이미지 없거나 후보가 50 이하면 그대로 사용
    scored = candidates.map(c => ({ ...c, visionScore: 7, visionReason: 'no vision check' }));
  }

  // 6. 상위 50장 선별
  const selected = scored.slice(0, MAX_PER_CATEGORY);
  const excluded = scored.slice(MAX_PER_CATEGORY);

  // 사전필터에서 탈락한 이미지도 제외 대상
  const preExcluded = allImages.filter(img => !preFiltered.includes(img));

  console.log(`  선별: ${selected.length}장 (점수 ${selected[selected.length-1]?.visionScore || '?'}~${selected[0]?.visionScore || '?'})`);

  // 점수 분포
  const scoreDistro = {};
  scored.forEach(s => { const k = s.visionScore; scoreDistro[k] = (scoreDistro[k] || 0) + 1; });
  console.log(`  점수 분포: ${Object.entries(scoreDistro).sort((a,b) => b[0]-a[0]).map(([k,v]) => `${k}점:${v}`).join(', ')}`);

  // 7. DB 업데이트
  const selectedIds = selected.map(s => s.id);
  const excludeIds = [
    ...excluded.map(e => e.id),
    ...preExcluded.map(e => e.id),
  ];

  if (excludeIds.length > 0) {
    await updateTraining(excludeIds, false);
    console.log(`  DB 업데이트: ${excludeIds.length}장 is_training=false`);
  }

  // 선별된 건 확실히 true
  if (selectedIds.length > 0) {
    await updateTraining(selectedIds, true);
  }

  // 8. 체크포인트 저장
  const result = {
    completed: true,
    total: allImages.length,
    preFiltered: preFiltered.length,
    verified: scored.length,
    selected: selectedIds,
    selectedCount: selected.length,
    excludedCount: excludeIds.length,
    topScores: selected.slice(0, 5).map(s => ({ score: s.visionScore, reason: s.visionReason?.slice(0, 50) })),
  };
  saveCp(category, result);

  return result;
}

// ─── Main ───
console.log('=== LoRA 학습 이미지 큐레이션 ===');
console.log(`기준: 네이버웍스 디자인 시안 (source=design_draft)`);
console.log(`목표: 카테고리당 최대 ${MAX_PER_CATEGORY}장\n`);

const summary = [];
for (const cat of CATEGORIES) {
  const result = await processCategory(cat);
  summary.push({ category: cat, ...result });
}

console.log(`\n${'═'.repeat(60)}`);
console.log('=== 큐레이션 완료 ===\n');
console.log('Category         | Total | Filter | Verify | Select | Exclude');
console.log('─────────────────|───────|────────|────────|────────|────────');
for (const s of summary) {
  console.log(`${s.category.padEnd(17)}| ${String(s.total).padStart(5)} | ${String(s.preFiltered).padStart(6)} | ${String(s.verified).padStart(6)} | ${String(s.selectedCount).padStart(6)} | ${String(s.excludedCount).padStart(6)}`);
}
const totalSelected = summary.reduce((a, s) => a + s.selectedCount, 0);
const totalExcluded = summary.reduce((a, s) => a + s.excludedCount, 0);
console.log(`${'TOTAL'.padEnd(17)}| ${String(totalSelected + totalExcluded).padStart(5)} |        |        | ${String(totalSelected).padStart(6)} | ${String(totalExcluded).padStart(6)}`);
console.log(`\n학습 대상: ${totalSelected}장 (is_training=true)`);
