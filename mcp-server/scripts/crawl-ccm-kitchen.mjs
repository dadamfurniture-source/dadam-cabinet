#!/usr/bin/env node
/**
 * CCM가구 싱크대 시공사례 이미지 크롤링
 *
 * 레이아웃별 필터: 대면형, ㄱ자, ㄷ자, ㅡ자
 * URL: http://www.ccmgagu.co.kr/shop/list.php?ca_id=101010
 *
 * Usage:
 *   node scripts/crawl-ccm-kitchen.mjs                    # 전체 레이아웃
 *   node scripts/crawl-ccm-kitchen.mjs --layout i_type    # ㅡ자만
 *   node scripts/crawl-ccm-kitchen.mjs --dry-run          # URL만 확인
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GDRIVE_BASE = 'G:/내 드라이브/kitchen_dataset/furniture_dataset/sink';
const CCM_BASE = 'http://www.ccmgagu.co.kr';

// ─── 레이아웃 → CCM 필터 매핑 ───
// CCM 사이트 필터: 대면형, ㄱ자, ㄷ자, ㅡ자
const LAYOUT_FILTERS = {
  i_type:    { name: 'ㅡ자', filterText: 'ㅡ자' },
  l_type:    { name: 'ㄱ자', filterText: 'ㄱ자' },
  u_type:    { name: 'ㄷ자', filterText: 'ㄷ자' },
  peninsula: { name: '대면형', filterText: '대면형' },
};

const LAYOUT_NAMES = {
  i_type: '1자형(ㅡ자)',
  l_type: 'ㄱ자형',
  u_type: 'ㄷ자형',
  peninsula: '대면형',
};

// ─── Args ───
function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1] : null;
}
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_LAYOUT = getArg('layout');
const MAX_PAGES = parseInt(getArg('pages') || '7');
const layouts = TARGET_LAYOUT ? [TARGET_LAYOUT] : Object.keys(LAYOUT_FILTERS);

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Referer': 'http://www.ccmgagu.co.kr/',
};

// ─── 목록 페이지에서 상품 상세 링크 추출 ───
async function getItemLinks(page = 1, caId = '101010') {
  const url = `${CCM_BASE}/shop/list.php?ca_id=${caId}&page=${page}`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const html = await res.text();

    // item.php 링크 추출
    const pattern = /href=["']([^"']*item\.php\?it_id=\d+)["']/gi;
    const links = [];
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const href = match[1].startsWith('http') ? match[1] : CCM_BASE + match[1];
      if (!links.includes(href)) links.push(href);
    }

    // 썸네일 이미지도 직접 추출
    const thumbPattern = /src=["'](\/data\/item\/\d+\/thumb-[^"']+)["']/gi;
    const thumbs = [];
    while ((match = thumbPattern.exec(html)) !== null) {
      thumbs.push(CCM_BASE + match[1]);
    }

    return { links, thumbs };
  } catch (e) {
    console.warn(`  Page ${page} error: ${e.message}`);
    return { links: [], thumbs: [] };
  }
}

// ─── 상품 상세 페이지에서 고해상도 이미지 추출 ───
async function getItemImages(itemUrl) {
  try {
    const res = await fetch(itemUrl, { headers: HEADERS });
    if (!res.ok) return [];
    const html = await res.text();

    // 상세 이미지 추출 (data/item/ 경로)
    const imgPattern = /src=["']((?:\/|http:\/\/www\.ccmgagu\.co\.kr\/)data\/item\/\d+\/[^"']+\.(?:jpg|jpeg|png|webp))["']/gi;
    const images = [];
    let match;
    while ((match = imgPattern.exec(html)) !== null) {
      let url = match[1];
      if (url.startsWith('/')) url = CCM_BASE + url;
      // 썸네일 아닌 원본만
      if (!url.includes('thumb-')) {
        images.push(url);
      }
    }

    // 썸네일도 원본으로 변환하여 추가
    const thumbPattern2 = /src=["']((?:\/|http:\/\/www\.ccmgagu\.co\.kr\/)data\/item\/\d+\/thumb-[^"']+)["']/gi;
    while ((match = thumbPattern2.exec(html)) !== null) {
      let url = match[1];
      if (url.startsWith('/')) url = CCM_BASE + url;
      // 원본 URL로 변환 (thumb- 제거, 사이즈 제거)
      const origUrl = url.replace(/thumb-/, '').replace(/_\d+x\d+/, '');
      if (!images.includes(origUrl)) images.push(origUrl);
    }

    return [...new Set(images)];
  } catch (e) {
    return [];
  }
}

// ─── 이미지 다운로드 ───
async function downloadImage(url, filepath) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      // 원본 실패 시 썸네일로 폴백
      return false;
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) return false;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 10000) return false; // 10KB 미만 스킵

    writeFileSync(filepath, buffer);
    return true;
  } catch {
    return false;
  }
}

// ─── 목록 페이지에서 레이아웃 타입 판별 (상품명 기반) ───
function detectLayout(html, filterText) {
  // CCM 사이트는 필터로 레이아웃 구분
  // 각 필터 페이지에서 모든 이미지를 해당 레이아웃으로 분류
  return true;
}

// ─── 메인 ───
async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  CCM가구 싱크대 시공사례 크롤링                  ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`레이아웃: ${layouts.map(l => LAYOUT_NAMES[l]).join(', ')}`);
  console.log(`최대 페이지: ${MAX_PAGES}`);
  console.log(`출력: ${GDRIVE_BASE}/{layout}/`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log();

  // 전체 이미지 목록 먼저 수집 (전체 탭)
  console.log('Step 1: 전체 상품 목록 수집...');
  const allItems = new Set();
  const allThumbs = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { links, thumbs } = await getItemLinks(page);
    links.forEach(l => allItems.add(l));
    thumbs.forEach(t => allThumbs.push(t));
    console.log(`  page ${page}: ${links.length}개 상품, ${thumbs.length}개 썸네일`);

    if (links.length === 0 && thumbs.length === 0) break;
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n총 ${allItems.size}개 상품, ${allThumbs.length}개 썸네일\n`);

  // 상품 상세 페이지에서 고해상도 이미지 수집
  console.log('Step 2: 상세 페이지에서 고해상도 이미지 수집...');
  const allImageUrls = [];

  let idx = 0;
  for (const itemUrl of allItems) {
    idx++;
    const images = await getItemImages(itemUrl);
    allImageUrls.push(...images.map(url => ({ url, itemUrl })));

    if (idx % 10 === 0) console.log(`  ${idx}/${allItems.size} 상품 처리 (총 ${allImageUrls.length}개 이미지)`);
    await new Promise(r => setTimeout(r, 300));
  }

  // 중복 제거
  const uniqueUrls = [...new Map(allImageUrls.map(i => [i.url, i])).values()];
  console.log(`\n총 ${uniqueUrls.length}개 고유 이미지 URL\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] 샘플:');
    uniqueUrls.slice(0, 5).forEach((img, i) => console.log(`  ${i + 1}. ${img.url}`));
    console.log(`\n다음 단계: --dry-run 제거하고 실행 → Claude Vision으로 레이아웃 분류`);
    return;
  }

  // 다운로드 (분류 전 ccm_raw 폴더에 일괄 저장)
  const rawDir = resolve(GDRIVE_BASE, 'ccm_raw');
  mkdirSync(rawDir, { recursive: true });

  console.log(`Step 3: 다운로드 (${rawDir})...`);
  let downloaded = 0, failed = 0;

  for (let i = 0; i < uniqueUrls.length; i++) {
    const { url } = uniqueUrls[i];
    const filename = `ccm_${String(i + 1).padStart(4, '0')}.jpg`;
    const filepath = resolve(rawDir, filename);

    if (existsSync(filepath)) { downloaded++; continue; }

    const ok = await downloadImage(url, filepath);
    if (ok) {
      downloaded++;
      if (downloaded % 20 === 0) console.log(`    ${downloaded} 다운로드 완료`);
    } else {
      failed++;
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`다운로드 완료: ${downloaded}장 성공, ${failed}장 실패`);
  console.log(`저장 위치: ${rawDir}`);
  console.log(`\n다음 단계:`);
  console.log(`  1. 이미지 확인: ${rawDir} 폴더에서 품질 검수`);
  console.log(`  2. Claude Vision 레이아웃 분류:`);
  console.log(`     node scripts/classify-kitchen-layout.mjs --source sink/ccm_raw`);

  // 메타데이터 저장
  writeFileSync(resolve(rawDir, 'crawl_metadata.json'), JSON.stringify({
    source: 'ccmgagu.co.kr',
    crawled_at: new Date().toISOString(),
    total_items: allItems.size,
    total_images: uniqueUrls.length,
    downloaded,
    failed,
  }, null, 2));
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
