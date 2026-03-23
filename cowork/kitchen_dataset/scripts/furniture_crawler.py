"""
다담가구 가구 카테고리별 통합 이미지 크롤러
=============================================
8개 가구 카테고리별로 Google/Naver/Daum에서 이미지를 수집합니다.

카테고리:
  1. 붙박이장 (wardrobe)
  2. 신발장 (shoe_cabinet)
  3. 화장대 (vanity)
  4. 냉장고장 (fridge_cabinet)
  5. ㄱ자 싱크대 (l_shaped_sink)
  6. 대면형 싱크대 (peninsula_sink)
  7. 아일랜드 (island_kitchen)
  8. 수납장 (storage_cabinet)

사용법:
    python furniture_crawler.py                    # 전체 카테고리 크롤링
    python furniture_crawler.py --category wardrobe # 특정 카테고리만
    python furniture_crawler.py --engine google     # 특정 검색엔진만
    python furniture_crawler.py --max-images 300    # 카테고리당 최대 수량 변경
"""

from playwright.sync_api import sync_playwright
import requests
import json
import time
import random
import argparse
import sys
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse, quote, unquote


# ══════════════════════════════════════════════════════════
# 카테고리 정의 (키워드 + 메타데이터)
# ══════════════════════════════════════════════════════════
CATEGORIES = {
    "wardrobe": {
        "name_kr": "붙박이장",
        "keywords_google": [
            "붙박이장 인테리어 디자인",
            "붙박이장 내부 구조",
            "드레스룸 붙박이장",
            "아파트 붙박이장 시공",
            "모던 붙박이장 디자인",
            "슬라이딩 붙박이장",
            "맞춤 붙박이장 사례",
            "built-in wardrobe closet design korea",
        ],
        "keywords_naver": [
            "붙박이장 인테리어",
            "붙박이장 시공 사례",
            "드레스룸 붙박이장 구조",
            "맞춤 붙박이장 디자인",
            "아파트 붙박이장 리모델링",
            "슬라이딩 도어 붙박이장",
        ],
        "keywords_daum": [
            "붙박이장 디자인",
            "붙박이장 인테리어 사례",
            "드레스룸 붙박이장",
            "맞춤형 붙박이장",
            "모던 붙박이장",
            "아파트 붙박이장",
        ],
    },
    "shoe_cabinet": {
        "name_kr": "신발장",
        "keywords_google": [
            "현관 신발장 디자인",
            "아파트 신발장 인테리어",
            "맞춤 신발장 시공",
            "모던 신발장 디자인",
            "대형 신발장 수납",
            "현관 수납장 신발장",
            "슬라이딩 신발장",
            "shoe cabinet entrance korean apartment",
        ],
        "keywords_naver": [
            "현관 신발장 인테리어",
            "신발장 디자인 사례",
            "아파트 신발장 시공",
            "맞춤 신발장 제작",
            "모던 현관 신발장",
            "대용량 신발장",
        ],
        "keywords_daum": [
            "신발장 디자인",
            "현관 신발장 인테리어",
            "아파트 신발장",
            "맞춤 신발장",
            "모던 신발장",
            "수납형 신발장",
        ],
    },
    "vanity": {
        "name_kr": "화장대",
        "keywords_google": [
            "화장대 디자인 인테리어",
            "드레스룸 화장대",
            "빌트인 화장대 시공",
            "모던 화장대 디자인",
            "맞춤 화장대 제작",
            "럭셔리 화장대 인테리어",
            "수납형 화장대 디자인",
            "vanity table dressing table design korea",
        ],
        "keywords_naver": [
            "화장대 인테리어",
            "화장대 디자인 사례",
            "드레스룸 화장대 시공",
            "빌트인 화장대",
            "맞춤 화장대",
            "모던 화장대 인테리어",
        ],
        "keywords_daum": [
            "화장대 디자인",
            "화장대 인테리어 사례",
            "드레스룸 화장대",
            "빌트인 화장대",
            "럭셔리 화장대",
            "맞춤형 화장대",
        ],
    },
    "fridge_cabinet": {
        "name_kr": "냉장고장",
        "keywords_google": [
            "냉장고장 인테리어 디자인",
            "빌트인 냉장고장 시공",
            "키큰장 냉장고장",
            "냉장고장 수납 구조",
            "주방 냉장고장 사례",
            "맞춤 냉장고장 제작",
            "모던 냉장고장 디자인",
            "built-in refrigerator cabinet korean kitchen",
        ],
        "keywords_naver": [
            "냉장고장 인테리어",
            "빌트인 냉장고장",
            "키큰장 냉장고장 시공",
            "주방 냉장고장 디자인",
            "맞춤 냉장고장",
            "냉장고장 수납",
        ],
        "keywords_daum": [
            "냉장고장 디자인",
            "빌트인 냉장고장",
            "키큰장 냉장고장",
            "주방 냉장고장 사례",
            "맞춤 냉장고장",
            "냉장고장 인테리어",
        ],
    },
    "l_shaped_sink": {
        "name_kr": "ㄱ자 싱크대",
        "keywords_google": [
            "ㄱ자 싱크대 디자인",
            "ㄱ자 주방 인테리어",
            "L자형 주방 싱크대",
            "ㄱ자 주방 리모델링",
            "코너형 주방 싱크대",
            "ㄱ자 주방 배치",
            "아파트 ㄱ자 주방 시공",
            "L-shaped kitchen cabinet korean",
        ],
        "keywords_naver": [
            "ㄱ자 싱크대 인테리어",
            "ㄱ자 주방 디자인",
            "L자형 주방 리모델링",
            "코너형 주방 시공",
            "ㄱ자 주방 배치 사례",
            "아파트 ㄱ자 주방",
        ],
        "keywords_daum": [
            "ㄱ자 싱크대",
            "ㄱ자 주방 디자인",
            "L자형 주방 인테리어",
            "코너 주방 시공",
            "ㄱ자 주방 사례",
            "아파트 ㄱ자 주방",
        ],
    },
    "peninsula_sink": {
        "name_kr": "대면형 싱크대",
        "keywords_google": [
            "대면형 주방 인테리어",
            "대면형 싱크대 디자인",
            "반도형 주방 시공",
            "대면형 주방 리모델링",
            "오픈형 주방 대면형",
            "대면 아일랜드 주방",
            "아파트 대면형 주방 사례",
            "peninsula kitchen design korean apartment",
        ],
        "keywords_naver": [
            "대면형 주방 인테리어",
            "대면형 싱크대 시공",
            "반도형 주방 디자인",
            "오픈 주방 대면형",
            "아파트 대면형 주방",
            "대면형 주방 리모델링",
        ],
        "keywords_daum": [
            "대면형 싱크대",
            "대면형 주방 디자인",
            "반도형 주방 인테리어",
            "오픈형 대면 주방",
            "대면형 주방 사례",
            "아파트 대면형 주방",
        ],
    },
    "island_kitchen": {
        "name_kr": "아일랜드",
        "keywords_google": [
            "아일랜드 주방 인테리어",
            "아일랜드 식탁 주방",
            "아일랜드 싱크대 디자인",
            "아일랜드 주방 시공 사례",
            "모던 아일랜드 주방",
            "럭셔리 아일랜드 주방",
            "아파트 아일랜드 주방",
            "island kitchen design korean modern",
        ],
        "keywords_naver": [
            "아일랜드 주방 인테리어",
            "아일랜드 식탁 디자인",
            "아일랜드 싱크대 시공",
            "모던 아일랜드 주방",
            "럭셔리 아일랜드 주방",
            "아파트 아일랜드 주방 사례",
        ],
        "keywords_daum": [
            "아일랜드 주방 디자인",
            "아일랜드 식탁 인테리어",
            "아일랜드 싱크대",
            "모던 아일랜드 주방",
            "럭셔리 아일랜드",
            "아파트 아일랜드 주방",
        ],
    },
    "storage_cabinet": {
        "name_kr": "수납장",
        "keywords_google": [
            "수납장 인테리어 디자인",
            "거실 수납장 시공",
            "맞춤 수납장 제작",
            "모던 수납장 디자인",
            "빌트인 수납장",
            "주방 수납장 정리",
            "벽면 수납장 인테리어",
            "storage cabinet built-in korean interior",
        ],
        "keywords_naver": [
            "수납장 인테리어",
            "맞춤 수납장 디자인",
            "거실 수납장 시공",
            "빌트인 수납장",
            "벽면 수납장",
            "주방 수납장 정리",
        ],
        "keywords_daum": [
            "수납장 디자인",
            "수납장 인테리어 사례",
            "맞춤형 수납장",
            "거실 수납장",
            "빌트인 수납장",
            "벽면 수납장",
        ],
    },
}


# ══════════════════════════════════════════════════════════
# 크롤링 설정
# ══════════════════════════════════════════════════════════
MAX_SCROLL_COUNT = 25
SCROLL_DELAY_MIN = 2.0
SCROLL_DELAY_MAX = 3.5
DOWNLOAD_DELAY_MIN = 1.0
DOWNLOAD_DELAY_MAX = 2.5
DEFAULT_MAX_IMAGES = 200   # 카테고리당 기본 수량
IMAGE_MIN_SIZE = 8000      # 8KB 이상만
REQUEST_TIMEOUT = 20
MAX_DOWNLOAD_RETRIES = 3

# URL 필터링 공통 블랙리스트
URL_BLACKLIST = [
    "logo", "icon", "favicon", "sprite", "blank",
    "transparent", "avatar", "badge", "emoji", "arrow",
    "btn_", "pixel", "1x1", "ad_img", "banner",
]


# ══════════════════════════════════════════════════════════
# 유틸리티 함수
# ══════════════════════════════════════════════════════════
def get_category_dirs(base_dir: Path, category_id: str) -> dict:
    """카테고리별 디렉토리 경로 반환"""
    cat_dir = base_dir / category_id
    return {
        "root": cat_dir,
        "raw": cat_dir / "raw",
        "metadata": cat_dir / "metadata",
    }


def load_metadata(meta_file: Path) -> dict:
    if meta_file.exists():
        with open(meta_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"created_at": datetime.now().isoformat(), "images": {}}


def save_metadata(meta: dict, meta_file: Path):
    meta["updated_at"] = datetime.now().isoformat()
    meta_file.parent.mkdir(parents=True, exist_ok=True)
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def download_image(url: str, save_path: Path, referer: str = "") -> bool:
    """이미지 다운로드 (재시도 포함)"""
    for attempt in range(1, MAX_DOWNLOAD_RETRIES + 1):
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
            }
            if referer:
                headers["Referer"] = referer

            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True, allow_redirects=True)
            response.raise_for_status()

            content_type = response.headers.get("Content-Type", "")
            if "image" not in content_type and "octet-stream" not in content_type:
                return False

            with open(save_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            if save_path.stat().st_size < IMAGE_MIN_SIZE:
                save_path.unlink()
                return False

            return True

        except requests.exceptions.RequestException as e:
            if attempt < MAX_DOWNLOAD_RETRIES:
                time.sleep(2 * attempt)
            else:
                return False
    return False


def get_image_extension(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        if ext in path:
            return ext
    return ".jpg"


def is_valid_image_url(url: str) -> bool:
    """블랙리스트 기반 URL 필터링"""
    url_lower = url.lower()
    return not any(skip in url_lower for skip in URL_BLACKLIST)


# ══════════════════════════════════════════════════════════
# Google 이미지 검색 크롤러
# ══════════════════════════════════════════════════════════
def crawl_google(page, keywords: list, collected_urls: set, max_target: int) -> list:
    """Google 이미지 검색에서 URL 수집"""
    results = []
    seen = set()

    for keyword in keywords:
        if len(results) >= max_target:
            break

        encoded_kw = quote(keyword)
        search_url = f"https://www.google.com/search?q={encoded_kw}&tbm=isch&tbs=isz:l"
        print(f"\n   🔍 [Google] '{keyword}'")

        try:
            page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)
        except Exception as e:
            print(f"      ❌ 페이지 로딩 실패: {e}")
            continue

        prev_height = 0
        no_change = 0

        for scroll_idx in range(MAX_SCROLL_COUNT):
            try:
                urls = page.evaluate("""() => {
                    const urls = [];
                    document.querySelectorAll('img').forEach(img => {
                        [img.getAttribute('data-src'), img.getAttribute('data-iurl'), img.src].forEach(url => {
                            if (!url || url.startsWith('data:')) return;
                            if (url.includes('gstatic.com/images') || url.includes('google.com/images')) return;
                            if (url.includes('=s32') || url.includes('=s44') || url.includes('=s64') || url.includes('=s96')) return;
                            if (url.startsWith('http')) urls.push(url);
                        });
                    });
                    document.querySelectorAll('a[href*="imgurl="]').forEach(a => {
                        const match = (a.getAttribute('href') || '').match(/imgurl=([^&]+)/);
                        if (match) { try { urls.push(decodeURIComponent(match[1])); } catch(e) {} }
                    });
                    document.querySelectorAll('script').forEach(script => {
                        const matches = (script.textContent || '').matchAll(/"ou":"(https?:[^"]+)"/g);
                        for (const m of matches) { try { urls.push(m[1].replace(/\\\\u003d/g, '=').replace(/\\\\/g, '')); } catch(e) {} }
                    });
                    return urls;
                }""")

                for src in urls:
                    base = src.split("?")[0]
                    if base not in seen and src not in collected_urls and is_valid_image_url(src):
                        seen.add(base)
                        results.append(("google", src, keyword))
            except Exception:
                pass

            page.evaluate("window.scrollBy(0, 1500)")
            time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

            try:
                more_btn = page.query_selector("input[value='결과 더보기'], input.mye4qd, #smb")
                if more_btn and more_btn.is_visible():
                    more_btn.click()
                    time.sleep(3)
            except Exception:
                pass

            new_height = page.evaluate("document.body.scrollHeight")
            if new_height == prev_height:
                no_change += 1
                if no_change >= 3:
                    break
            else:
                no_change = 0
            prev_height = new_height

        print(f"      📸 수집: {len(results)}개")

    return results


# ══════════════════════════════════════════════════════════
# Naver 이미지 검색 크롤러
# ══════════════════════════════════════════════════════════
def crawl_naver(page, keywords: list, collected_urls: set, max_target: int) -> list:
    """Naver 이미지 검색에서 URL 수집"""
    results = []
    seen = set()

    for keyword in keywords:
        if len(results) >= max_target:
            break

        encoded_kw = quote(keyword)
        search_url = f"https://search.naver.com/search.naver?where=image&sm=tab_jum&query={encoded_kw}"
        print(f"\n   🔍 [Naver] '{keyword}'")

        try:
            page.goto(search_url, wait_until="networkidle", timeout=30000)
            time.sleep(3)
        except Exception as e:
            print(f"      ❌ 페이지 로딩 실패: {e}")
            continue

        prev_height = 0
        no_change = 0

        for scroll_idx in range(MAX_SCROLL_COUNT):
            try:
                urls = page.evaluate("""() => {
                    const urls = new Set();
                    document.querySelectorAll('img').forEach(img => {
                        [img.getAttribute('data-source'), img.getAttribute('data-lazy-src'),
                         img.getAttribute('data-original'), img.src].forEach(url => {
                            if (url && url.startsWith('http') &&
                                (url.includes('.jpg') || url.includes('.jpeg') ||
                                 url.includes('.png') || url.includes('.webp')))
                                urls.add(url);
                        });
                        const srcset = img.getAttribute('srcset');
                        if (srcset) srcset.split(',').forEach(p => {
                            const u = p.trim().split(' ')[0];
                            if (u && u.startsWith('http')) urls.add(u);
                        });
                    });
                    document.querySelectorAll('[style*="background-image"]').forEach(el => {
                        const match = (el.getAttribute('style') || '').match(/url\\(['"]?(https?[^'"\\)]+)/);
                        if (match) urls.add(match[1]);
                    });
                    return Array.from(urls);
                }""")

                for src in urls:
                    if src not in seen and src not in collected_urls and is_valid_image_url(src):
                        if "static.naver" not in src and "ssl.pstatic.net/imgmedia" not in src:
                            seen.add(src)
                            results.append(("naver", src, keyword))
            except Exception:
                pass

            page.evaluate("window.scrollBy(0, 1200)")
            time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

            try:
                more_btn = page.query_selector("a.btn_more, button._more_btn, [class*='more']")
                if more_btn and more_btn.is_visible():
                    more_btn.click()
                    time.sleep(2)
            except Exception:
                pass

            new_height = page.evaluate("document.body.scrollHeight")
            if new_height == prev_height:
                no_change += 1
                if no_change >= 3:
                    break
            else:
                no_change = 0
            prev_height = new_height

        print(f"      📸 수집: {len(results)}개")

    return results


# ══════════════════════════════════════════════════════════
# Daum 이미지 검색 크롤러
# ══════════════════════════════════════════════════════════
def crawl_daum(page, keywords: list, collected_urls: set, max_target: int) -> list:
    """Daum 이미지 검색에서 URL 수집"""
    results = []
    seen = set()

    for keyword in keywords:
        if len(results) >= max_target:
            break

        encoded_kw = quote(keyword)
        search_url = f"https://search.daum.net/search?w=img&q={encoded_kw}"
        print(f"\n   🔍 [Daum] '{keyword}'")

        try:
            page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)
        except Exception as e:
            print(f"      ❌ 페이지 로딩 실패: {e}")
            continue

        prev_height = 0
        no_change = 0

        for scroll_idx in range(MAX_SCROLL_COUNT):
            try:
                urls = page.evaluate("""() => {
                    const urls = new Set();
                    document.querySelectorAll('img').forEach(img => {
                        [img.getAttribute('data-original-url'), img.getAttribute('data-source'),
                         img.getAttribute('data-lazy-src'), img.src].forEach(url => {
                            if (url && url.startsWith('http') && !url.includes('icon') && !url.includes('logo'))
                                urls.add(url);
                        });
                    });
                    document.querySelectorAll('a[href*="fname="]').forEach(a => {
                        const match = (a.getAttribute('href') || '').match(/fname=([^&]+)/);
                        if (match) { try { urls.add(decodeURIComponent(match[1])); } catch(e) {} }
                    });
                    document.querySelectorAll('[style*="background-image"]').forEach(el => {
                        const match = (el.getAttribute('style') || '').match(/url\\(['"]?(https?[^'"\\)]+)/);
                        if (match) urls.add(match[1]);
                    });
                    return Array.from(urls);
                }""")

                for src in urls:
                    if src not in seen and src not in collected_urls and is_valid_image_url(src):
                        seen.add(src)
                        results.append(("daum", src, keyword))
            except Exception:
                pass

            page.evaluate("window.scrollBy(0, 1200)")
            time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

            try:
                more_btn = page.query_selector("#moreBtn, .btn_more, [class*='more']")
                if more_btn and more_btn.is_visible():
                    more_btn.click()
                    time.sleep(2)
            except Exception:
                pass

            new_height = page.evaluate("document.body.scrollHeight")
            if new_height == prev_height:
                no_change += 1
                if no_change >= 3:
                    break
            else:
                no_change = 0
            prev_height = new_height

        print(f"      📸 수집: {len(results)}개")

    return results


# ══════════════════════════════════════════════════════════
# 메인 처리
# ══════════════════════════════════════════════════════════
def process_category(category_id: str, base_dir: Path, engines: list, max_images: int):
    """단일 카테고리 크롤링 처리"""
    cat_info = CATEGORIES[category_id]
    dirs = get_category_dirs(base_dir, category_id)

    print("\n" + "=" * 60)
    print(f"  📦 [{cat_info['name_kr']}] 크롤링 시작")
    print("=" * 60)

    # 폴더 생성
    dirs["raw"].mkdir(parents=True, exist_ok=True)
    dirs["metadata"].mkdir(parents=True, exist_ok=True)

    # 메타데이터 로드
    meta_file = dirs["metadata"] / f"{category_id}_meta.json"
    meta = load_metadata(meta_file)
    meta["category"] = category_id
    meta["category_kr"] = cat_info["name_kr"]

    collected_urls = set(info.get("source_url", "") for info in meta.get("images", {}).values())
    current_count = len(meta.get("images", {}))

    print(f"\n   📊 현황: 기존 {current_count}장 / 목표 {max_images}장")

    if current_count >= max_images:
        print("   ✅ 이미 목표 수량 도달")
        return current_count

    # 검색엔진별 크롤링
    all_results = []
    remaining = max_images - current_count

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="ko-KR",
        )
        page = context.new_page()

        engine_map = {
            "google": (crawl_google, cat_info.get("keywords_google", [])),
            "naver": (crawl_naver, cat_info.get("keywords_naver", [])),
            "daum": (crawl_daum, cat_info.get("keywords_daum", [])),
        }

        for engine_name in engines:
            if engine_name not in engine_map:
                continue
            if len(all_results) >= remaining:
                break

            crawl_func, keywords = engine_map[engine_name]
            per_engine_target = remaining - len(all_results)
            results = crawl_func(page, keywords, collected_urls, per_engine_target)
            all_results.extend(results)
            print(f"\n   📊 [{engine_name}] 누적: {len(all_results)}개 URL")

        browser.close()

    # 다운로드
    new_items = [(engine, url, kw) for engine, url, kw in all_results if url not in collected_urls]
    print(f"\n   📥 다운로드 대상: {len(new_items)}개")

    downloaded = 0
    failed = 0
    consecutive_fails = 0

    for idx, (engine, img_url, keyword) in enumerate(new_items, 1):
        if current_count + downloaded >= max_images:
            print(f"\n   ✅ 목표 수량({max_images}장) 도달")
            break

        seq_num = current_count + downloaded + 1
        ext = get_image_extension(img_url)
        prefix = category_id[:4]
        filename = f"{prefix}_{engine[:3]}_{seq_num:04d}{ext}"
        save_path = dirs["raw"] / filename

        if download_image(img_url, save_path, referer=f"https://www.{engine}.com/"):
            downloaded += 1
            consecutive_fails = 0
            meta["images"][filename] = {
                "source_url": img_url,
                "source_engine": engine,
                "search_keyword": keyword,
                "category": category_id,
                "downloaded_at": datetime.now().isoformat(),
                "file_size_bytes": save_path.stat().st_size,
            }
            save_metadata(meta, meta_file)

            if downloaded % 10 == 0:
                print(f"   ✅ {downloaded}장 다운로드 완료...")
        else:
            failed += 1
            consecutive_fails += 1
            if consecutive_fails > 15:
                print(f"   ⚠️ 연속 실패 {consecutive_fails}회, 다음으로 넘어갑니다.")
                break

        time.sleep(random.uniform(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX))

    total = current_count + downloaded
    print(f"\n   📋 [{cat_info['name_kr']}] 완료: 새 {downloaded}장 / 실패 {failed}장 / 총 {total}장")
    return total


def main():
    parser = argparse.ArgumentParser(description="다담가구 가구 카테고리별 통합 이미지 크롤러")
    parser.add_argument("--category", "-c", type=str, default="all",
                        help="크롤링할 카테고리 (all 또는 카테고리ID, 쉼표 구분)")
    parser.add_argument("--engine", "-e", type=str, default="google,naver,daum",
                        help="검색엔진 (google,naver,daum 중 선택, 쉼표 구분)")
    parser.add_argument("--max-images", "-m", type=int, default=DEFAULT_MAX_IMAGES,
                        help=f"카테고리당 최대 이미지 수 (기본: {DEFAULT_MAX_IMAGES})")
    parser.add_argument("--base-dir", "-d", type=str, default=None,
                        help="데이터 저장 기본 디렉토리 (기본: scripts 상위/furniture_dataset)")
    args = parser.parse_args()

    # 기본 디렉토리
    if args.base_dir:
        base_dir = Path(args.base_dir)
    else:
        base_dir = Path(__file__).resolve().parent.parent / "furniture_dataset"

    base_dir.mkdir(parents=True, exist_ok=True)

    # 카테고리 파싱
    if args.category == "all":
        categories = list(CATEGORIES.keys())
    else:
        categories = [c.strip() for c in args.category.split(",")]
        for cat in categories:
            if cat not in CATEGORIES:
                print(f"❌ 알 수 없는 카테고리: '{cat}'")
                print(f"   사용 가능: {', '.join(CATEGORIES.keys())}")
                sys.exit(1)

    # 엔진 파싱
    engines = [e.strip() for e in args.engine.split(",")]

    # 실행
    print("╔" + "═" * 58 + "╗")
    print("║  다담가구 가구 카테고리별 통합 이미지 크롤러          ║")
    print("╠" + "═" * 58 + "╣")
    print(f"║  카테고리: {len(categories)}개                                      ║")
    print(f"║  검색엔진: {', '.join(engines):<43}║")
    print(f"║  카테고리당 최대: {args.max_images}장                               ║")
    print(f"║  저장 위치: {str(base_dir)[:42]:<42}║")
    print("╚" + "═" * 58 + "╝")

    results_summary = {}
    start_time = time.time()

    for cat_id in categories:
        try:
            total = process_category(cat_id, base_dir, engines, args.max_images)
            results_summary[cat_id] = total
        except Exception as e:
            print(f"\n   ❌ [{cat_id}] 오류 발생: {e}")
            results_summary[cat_id] = f"오류: {e}"

    # 최종 요약
    elapsed = time.time() - start_time
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)

    print("\n\n" + "═" * 60)
    print("  📊 전체 크롤링 결과 요약")
    print("═" * 60)
    total_images = 0
    for cat_id, result in results_summary.items():
        name_kr = CATEGORIES[cat_id]["name_kr"]
        if isinstance(result, int):
            total_images += result
            print(f"   {name_kr:<12} : {result}장")
        else:
            print(f"   {name_kr:<12} : {result}")
    print(f"\n   총 수집량     : {total_images}장")
    print(f"   소요 시간     : {hours}시간 {minutes}분")
    print(f"   저장 위치     : {base_dir}")
    print("═" * 60)

    # 전체 요약 JSON 저장
    summary = {
        "completed_at": datetime.now().isoformat(),
        "elapsed_seconds": round(elapsed),
        "categories": results_summary,
        "total_images": total_images,
        "engines_used": engines,
        "max_per_category": args.max_images,
    }
    summary_file = base_dir / "crawl_summary.json"
    with open(summary_file, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print(f"\n   📄 요약 파일: {summary_file}")


if __name__ == "__main__":
    main()
