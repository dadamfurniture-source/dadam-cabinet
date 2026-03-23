#!/usr/bin/env node
/**
 * 네이버 블로그 주방 인테리어 이미지 크롤링
 *
 * 4가지 레이아웃 타입별 검색:
 *   i_type    — "1자형 주방 인테리어"
 *   l_type    — "ㄱ자형 주방 인테리어"
 *   u_type    — "ㄷ자형 주방 인테리어"
 *   peninsula — "대면형 주방 인테리어", "11자형 주방 인테리어"
 *
 * Usage:
 *   node scripts/crawl-naver-kitchen.mjs                          # 전체 레이아웃
 *   node scripts/crawl-naver-kitchen.mjs --layout i_type          # 1자형만
 *   node scripts/crawl-naver-kitchen.mjs --count 60               # 레이아웃당 60장
 *   node scripts/crawl-naver-kitchen.mjs --dry-run                # URL만 확인
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GDRIVE_BASE = 'G:/내 드라이브/kitchen_dataset/furniture_dataset/sink';

// ─── 레이아웃별 검색 키워드 ───
const LAYOUT_KEYWORDS = {
  i_type: [
    '1자형 주방 인테리어',
    '일자형 주방 인테리어',
    '일자 싱크대 인테리어',
    '직선형 주방 인테리어',
  ],
  l_type: [
    'ㄱ자형 주방 인테리어',
    'ㄱ자 주방 인테리어',
    'L자형 주방 인테리어',
    'L자 주방 시공',
  ],
  u_type: [
    'ㄷ자형 주방 인테리어',
    'ㄷ자 주방 인테리어',
    'U자형 주방 인테리어',
    'U자 주방 시공',
  ],
  peninsula: [
    '대면형 주방 인테리어',
    '11자형 주방 인테리어',
    '반도형 주방 인테리어',
    '아일랜드 주방 인테리어',
    '대면형 싱크대 인테리어',
  ],
};

const LAYOUT_NAMES = {
  i_type: '1자형',
  l_type: 'ㄱ자형',
  u_type: 'ㄷ자형',
  peninsula: '대면형(11자형)',
};

// ─── Args ───
function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1] : null;
}
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_COUNT = parseInt(getArg('count') || '60');
const TARGET_LAYOUT = getArg('layout');
const layouts = TARGET_LAYOUT ? [TARGET_LAYOUT] : Object.keys(LAYOUT_KEYWORDS);

// ─── 네이버 이미지 검색 API (비로그인) ───
async function searchNaverImages(query, start = 1) {
  const params = new URLSearchParams({
    query,
    start: String(start),
    display: '30',
    sort: 'sim',
  });

  // 네이버 비로그인 이미지 검색 (모바일 API)
  const url = `https://m.search.naver.com/p/blog/search.naver?where=blog.image&query=${encodeURIComponent(query)}&start=${start}&display=30`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://m.search.naver.com/',
      },
    });

    if (!res.ok) return [];
    const html = await res.text();

    // 이미지 URL 추출 (blog thumbnail/original)
    const urls = [];
    // blogthumb 패턴
    const thumbPattern = /https?:\/\/blogthumb\d*\.naver\.net\/[^\s"'<>]+\.(?:jpg|jpeg|png)/gi;
    // postfiles 패턴 (원본)
    const postPattern = /https?:\/\/postfiles\.pstatic\.net\/[^\s"'<>]+\.(?:jpg|jpeg|png)/gi;
    // mblogthumb 패턴
    const mblogPattern = /https?:\/\/mblogthumb-phinf\.pstatic\.net\/[^\s"'<>]+\.(?:jpg|jpeg|png)/gi;

    for (const pattern of [postPattern, mblogPattern, thumbPattern]) {
      const matches = html.match(pattern) || [];
      urls.push(...matches);
    }

    return [...new Set(urls)];
  } catch (e) {
    return [];
  }
}

// 네이버 통합검색 이미지 탭
async function searchNaverImageTab(query, start = 1) {
  const url = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(query)}&start=${start}&display=50`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://search.naver.com/',
      },
    });

    if (!res.ok) return [];
    const html = await res.text();

    // 다양한 네이버 이미지 URL 패턴 추출
    const urls = [];
    const patterns = [
      /https?:\/\/search\.pstatic\.net\/common\/\?src=[^"'\s&]+/gi,
      /https?:\/\/blogthumb\d*\.naver\.net\/[^\s"'<>)]+/gi,
      /https?:\/\/postfiles\.pstatic\.net\/[^\s"'<>)]+/gi,
      /https?:\/\/mblogthumb-phinf\.pstatic\.net\/[^\s"'<>)]+/gi,
      /https?:\/\/dthumb-phinf\.pstatic\.net\/[^\s"'<>)]+/gi,
    ];

    for (const p of patterns) {
      const matches = html.match(p) || [];
      urls.push(...matches);
    }

    // src= 파라미터에서 원본 URL 추출
    const cleaned = urls.map(u => {
      const srcMatch = u.match(/src=([^&]+)/);
      if (srcMatch) {
        try { return decodeURIComponent(srcMatch[1]); } catch { return u; }
      }
      return u;
    });

    return [...new Set(cleaned)].filter(u => u.includes('.jpg') || u.includes('.jpeg') || u.includes('.png'));
  } catch (e) {
    return [];
  }
}

// ─── 이미지 다운로드 ───
async function downloadImage(url, filepath) {
  try {
    // 네이버 이미지 URL 정리
    let cleanUrl = url.split('?type=')[0]; // 리사이즈 파라미터 제거
    if (cleanUrl.includes('?src=')) {
      const src = cleanUrl.match(/\?src=([^&]+)/);
      if (src) cleanUrl = decodeURIComponent(src[1]);
    }

    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://search.naver.com/',
      },
    });

    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) return false;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 15000) return false; // 15KB 미만 스킵

    writeFileSync(filepath, buffer);
    return true;
  } catch {
    return false;
  }
}

// ─── 메인 ───
async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║  네이버 블로그 주방 인테리어 이미지 크롤링        ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`레이아웃: ${layouts.map(l => LAYOUT_NAMES[l]).join(', ')}`);
  console.log(`목표:     레이아웃당 ${TARGET_COUNT}장`);
  console.log(`출력:     ${GDRIVE_BASE}/{layout}/`);
  console.log(`Dry run:  ${DRY_RUN}`);
  console.log();

  for (const layout of layouts) {
    const keywords = LAYOUT_KEYWORDS[layout];
    const layoutDir = resolve(GDRIVE_BASE, layout);
    const layoutName = LAYOUT_NAMES[layout];

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`${layoutName} (${layout})`);
    console.log(`${'═'.repeat(50)}`);

    if (!DRY_RUN) mkdirSync(layoutDir, { recursive: true });

    // 기존 이미지 수 확인
    const existingCount = existsSync(layoutDir)
      ? readdirSync(layoutDir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length
      : 0;
    console.log(`  기존: ${existingCount}장`);

    const seenUrls = new Set();
    const allUrls = [];

    // 키워드별 검색
    for (const keyword of keywords) {
      console.log(`\n  검색: "${keyword}"`);

      for (let start = 1; start <= 150; start += 30) {
        // 블로그 이미지 + 이미지 탭 양쪽 검색
        const blogUrls = await searchNaverImages(keyword, start);
        const imageUrls = await searchNaverImageTab(keyword, start);
        const combined = [...blogUrls, ...imageUrls];

        let added = 0;
        for (const url of combined) {
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            allUrls.push(url);
            added++;
          }
        }

        console.log(`    start=${start}: ${combined.length}개 → ${added}개 신규 (총 ${allUrls.length})`);

        if (allUrls.length >= TARGET_COUNT * 2) break;
        await new Promise(r => setTimeout(r, 800));
      }

      if (allUrls.length >= TARGET_COUNT * 2) break;
    }

    console.log(`\n  총 ${allUrls.length}개 URL 수집`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] 샘플:`);
      allUrls.slice(0, 3).forEach((u, i) => console.log(`    ${i + 1}. ${u.substring(0, 90)}`));
      continue;
    }

    // 다운로드
    console.log(`  다운로드 (최대 ${TARGET_COUNT}장)...`);
    let downloaded = 0, failed = 0;

    for (let i = 0; i < allUrls.length && downloaded < TARGET_COUNT; i++) {
      const idx = existingCount + downloaded + 1;
      const filename = `${layout}_${String(idx).padStart(4, '0')}.jpg`;
      const filepath = resolve(layoutDir, filename);

      if (existsSync(filepath)) { downloaded++; continue; }

      const ok = await downloadImage(allUrls[i], filepath);
      if (ok) {
        downloaded++;
        if (downloaded % 10 === 0) console.log(`    ${downloaded}/${TARGET_COUNT} 완료`);
      } else {
        failed++;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`  ✓ ${downloaded}장 다운로드, ${failed}장 실패`);
  }

  // 최종 요약
  console.log(`\n\n${'═'.repeat(50)}`);
  console.log('최종 요약');
  console.log(`${'═'.repeat(50)}`);
  for (const layout of layouts) {
    const dir = resolve(GDRIVE_BASE, layout);
    const count = existsSync(dir) ? readdirSync(dir).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length : 0;
    console.log(`  ${LAYOUT_NAMES[layout].padEnd(15)} ${dir} → ${count}장`);
  }

  console.log(`\n다음 단계:`);
  console.log(`  1. 각 폴더 이미지 품질 확인`);
  console.log(`  2. 기존 modern/ 폴더 이미지도 레이아웃별로 분류:`);
  console.log(`     node scripts/classify-kitchen-layout.mjs --source sink`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
