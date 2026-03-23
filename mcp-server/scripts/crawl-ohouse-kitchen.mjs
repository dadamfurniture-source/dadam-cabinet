#!/usr/bin/env node
/**
 * 오늘의집 주방 이미지 크롤링
 *
 * 1자형(일자형) 주방 이미지를 오늘의집 API에서 수집
 *
 * Usage:
 *   node scripts/crawl-ohouse-kitchen.mjs                    # 기본: 100장 수집
 *   node scripts/crawl-ohouse-kitchen.mjs --count 200        # 200장 수집
 *   node scripts/crawl-ohouse-kitchen.mjs --layout i_type    # 1자형만
 *   node scripts/crawl-ohouse-kitchen.mjs --dry-run          # 다운로드 없이 URL만 확인
 *
 * 출력: G:/내 드라이브/kitchen_dataset/furniture_dataset/sink/
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 설정 ───
const GDRIVE_BASE = 'G:/내 드라이브/kitchen_dataset/furniture_dataset';
const OHOUSE_API = 'https://ohou.se/cards/feed.json';
const OHOUSE_SEARCH_API = 'https://ohou.se/cards/feed.json';

// 검색 키워드
const SEARCH_KEYWORDS = {
  i_type: ['일자형 주방', '1자 주방', '일자 싱크대', '원룸 주방', '직선형 주방'],
  l_type: ['ㄱ자 주방', 'L자 주방', 'ㄱ자형 싱크대'],
  u_type: ['ㄷ자 주방', 'U자 주방', 'ㄷ자형 주방'],
  peninsula: ['대면형 주방', '반도형 주방', '아일랜드 주방'],
};

// ─── Args ───
function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1] : null;
}
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_COUNT = parseInt(getArg('count') || '100');
const LAYOUT_TYPE = getArg('layout') || 'i_type';
const keywords = SEARCH_KEYWORDS[LAYOUT_TYPE] || SEARCH_KEYWORDS.i_type;

// 카테고리 매핑
const LAYOUT_TO_CATEGORY = {
  i_type: 'sink',
  l_type: 'l_shaped_sink',
  u_type: 'u_type_sink',
  peninsula: 'peninsula_sink',
};
const category = LAYOUT_TO_CATEGORY[LAYOUT_TYPE] || 'sink';

// 출력 디렉토리
const OUTPUT_DIR = resolve(GDRIVE_BASE, category);

// ─── 오늘의집 API 호출 ───
async function searchOhouse(keyword, page = 1) {
  const params = new URLSearchParams({
    query: keyword,
    per: '20',
    page: String(page),
    category: 'kitchen',  // 주방 카테고리
  });

  const url = `https://ohou.se/cards/feed.json?${params}`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://ohou.se/',
      },
    });

    if (!res.ok) {
      console.warn(`  API ${res.status} for "${keyword}" page ${page}`);
      return [];
    }

    const data = await res.json();
    return data.cards || data.items || data || [];
  } catch (e) {
    console.warn(`  API error for "${keyword}": ${e.message}`);
    return [];
  }
}

// 오늘의집 사진 검색 (별도 API)
async function searchOhousePhotos(keyword, page = 1) {
  const url = `https://ohou.se/productions/feed.json?query=${encodeURIComponent(keyword)}&per=20&page=${page}&order=popular`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://ohou.se/',
      },
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.productions || data.items || [];
  } catch (e) {
    return [];
  }
}

// ─── 이미지 URL 추출 ───
function extractImageUrls(items) {
  const urls = [];

  for (const item of items) {
    // 다양한 오늘의집 API 응답 포맷 처리
    const imageUrl =
      item.image_url ||
      item.cover_image_url ||
      item.thumbnail_url ||
      item.image?.url ||
      item.cover?.url;

    if (imageUrl && imageUrl.startsWith('http')) {
      // 충분한 해상도인지 확인 (썸네일 제외)
      const fullUrl = imageUrl
        .replace(/\/w_\d+/, '/w_1200')  // 오늘의집 이미지 리사이즈 파라미터
        .replace(/\/h_\d+/, '/h_900')
        .replace(/c_fill/, 'c_limit');

      urls.push({
        url: fullUrl,
        title: item.title || item.description || '',
        source_id: item.id || '',
      });
    }
  }

  return urls;
}

// ─── 이미지 다운로드 ───
async function downloadImage(url, filepath) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ohou.se/',
      },
    });

    if (!res.ok) return false;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) return false;

    const buffer = Buffer.from(await res.arrayBuffer());

    // 최소 크기 확인 (10KB 이상)
    if (buffer.length < 10240) return false;

    writeFileSync(filepath, buffer);
    return true;
  } catch (e) {
    return false;
  }
}

// ─── 메인 ───
async function main() {
  console.log('╔═════════════════════════════════════════════╗');
  console.log('║  오늘의집 주방 이미지 크롤링                    ║');
  console.log('╚═════════════════════════════════════════════╝');
  console.log(`레이아웃: ${LAYOUT_TYPE} (${keywords.join(', ')})`);
  console.log(`카테고리: ${category}`);
  console.log(`목표:     ${TARGET_COUNT}장`);
  console.log(`출력:     ${OUTPUT_DIR}`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log();

  if (!DRY_RUN) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
    mkdirSync(resolve(OUTPUT_DIR, 'modern'), { recursive: true });
  }

  // 모든 키워드로 검색
  const allImages = [];
  const seenUrls = new Set();

  for (const keyword of keywords) {
    console.log(`\n검색: "${keyword}"`);

    for (let page = 1; page <= 10; page++) {
      // cards API
      const cards = await searchOhouse(keyword, page);
      const cardUrls = extractImageUrls(cards);

      // productions API
      const photos = await searchOhousePhotos(keyword, page);
      const photoUrls = extractImageUrls(photos);

      const combined = [...cardUrls, ...photoUrls];

      if (combined.length === 0) {
        console.log(`  page ${page}: 결과 없음, 다음 키워드로`);
        break;
      }

      let added = 0;
      for (const img of combined) {
        if (!seenUrls.has(img.url)) {
          seenUrls.add(img.url);
          allImages.push(img);
          added++;
        }
      }

      console.log(`  page ${page}: ${combined.length}개 발견, ${added}개 신규 (총 ${allImages.length})`);

      if (allImages.length >= TARGET_COUNT * 2) break;  // 여유분 2배

      // 요청 간격
      await new Promise(r => setTimeout(r, 1000));
    }

    if (allImages.length >= TARGET_COUNT * 2) break;
  }

  console.log(`\n총 ${allImages.length}개 이미지 URL 수집`);

  // 메타데이터 저장
  const metaPath = resolve(OUTPUT_DIR, 'crawl_metadata.json');
  if (!DRY_RUN) {
    writeFileSync(metaPath, JSON.stringify({
      layout_type: LAYOUT_TYPE,
      category,
      keywords,
      crawled_at: new Date().toISOString(),
      total_found: allImages.length,
      images: allImages,
    }, null, 2));
    console.log(`메타데이터 저장: ${metaPath}`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 샘플 URL:');
    allImages.slice(0, 5).forEach((img, i) => {
      console.log(`  ${i + 1}. ${img.url.substring(0, 80)}...`);
    });
    return;
  }

  // 다운로드
  console.log(`\n다운로드 시작 (최대 ${TARGET_COUNT}장)...`);
  let downloaded = 0;
  let failed = 0;

  for (let i = 0; i < allImages.length && downloaded < TARGET_COUNT; i++) {
    const img = allImages[i];
    const filename = `${category}_${String(downloaded + 1).padStart(4, '0')}.jpg`;
    const filepath = resolve(OUTPUT_DIR, 'modern', filename);

    if (existsSync(filepath)) {
      downloaded++;
      continue;
    }

    const success = await downloadImage(img.url, filepath);

    if (success) {
      downloaded++;
      if (downloaded % 10 === 0) console.log(`  ${downloaded}/${TARGET_COUNT} 다운로드 완료`);
    } else {
      failed++;
    }

    // 요청 간격
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`다운로드 완료: ${downloaded}장 성공, ${failed}장 실패`);
  console.log(`저장 위치: ${OUTPUT_DIR}/modern/`);
  console.log(`\n다음 단계:`);
  console.log(`  1. 이미지 확인: ${OUTPUT_DIR}/modern/ 열어서 품질 검수`);
  console.log(`  2. Supabase 업로드: node scripts/upload-furniture-images.mjs --category ${category}`);
  console.log(`  3. Claude 큐레이션: node scripts/curate-training-images.mjs --category ${category}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
