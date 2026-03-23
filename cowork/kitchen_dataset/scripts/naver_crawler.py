"""
네이버 인테리어 주방 이미지 크롤러
====================================
네이버 블로그/이미지 검색에서 한국형 주방 이미지를 수집합니다.

기능:
- 네이버 이미지 검색 API 또는 Playwright 스크롤 수집
- 중복 제거 (URL 기반)
- 체크포인트 기반 재개(resume)
- 수집 간격 2~3초 유지
- 메타데이터 JSON 자동 기록

사용법:
    pip install playwright requests
    playwright install chromium
    python naver_crawler.py
"""

from playwright.sync_api import sync_playwright
import requests
import json
import time
import random
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse, quote

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "raw"
METADATA_DIR = BASE_DIR / "metadata"
META_FILE = METADATA_DIR / "naver_meta.json"

# 검색 키워드 목록
SEARCH_KEYWORDS = [
    "한국 주방 인테리어",
    "아파트 주방 리모델링",
    "신축 아파트 주방",
    "주방 싱크대 디자인",
    "모던 주방 인테리어",
    "북유럽 주방 디자인",
    "럭셔리 주방 인테리어",
    "화이트 주방 인테리어",
]

# 크롤링 설정
MAX_SCROLL_COUNT = 30
SCROLL_DELAY_MIN = 2.0
SCROLL_DELAY_MAX = 3.5
DOWNLOAD_DELAY_MIN = 1.0
DOWNLOAD_DELAY_MAX = 2.0
MAX_IMAGES = 500
IMAGE_MIN_SIZE = 5000        # 최소 파일 크기 (bytes)
REQUEST_TIMEOUT = 15
MAX_DOWNLOAD_RETRIES = 3


# ──────────────────────────────────────────────
# 메타데이터 관리
# ──────────────────────────────────────────────
def load_metadata() -> dict:
    if META_FILE.exists():
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"created_at": datetime.now().isoformat(), "source": "naver", "images": {}}


def save_metadata(meta: dict):
    meta["updated_at"] = datetime.now().isoformat()
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


# ──────────────────────────────────────────────
# 이미지 다운로드
# ──────────────────────────────────────────────
def download_image(url: str, save_path: Path) -> bool:
    for attempt in range(1, MAX_DOWNLOAD_RETRIES + 1):
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://search.naver.com/",
            }
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True)
            response.raise_for_status()

            content_type = response.headers.get("Content-Type", "")
            if "image" not in content_type:
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
                print(f"      ❌ 다운로드 실패: {e}")
                return False
    return False


def get_image_extension(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        if ext in path:
            return ext
    return ".jpg"


# ──────────────────────────────────────────────
# 메인 크롤러
# ──────────────────────────────────────────────
def crawl_naver():
    print("=" * 60)
    print("  네이버 주방 이미지 크롤러")
    print("=" * 60)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    meta = load_metadata()
    collected_urls = set(info.get("source_url", "") for info in meta.get("images", {}).values())
    current_count = len(meta.get("images", {}))

    print(f"\n📊 현황: 기존 {current_count}장 / 목표 {MAX_IMAGES}장")

    if current_count >= MAX_IMAGES:
        print("✅ 이미 목표 수량 도달")
        return

    all_image_urls = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        page = context.new_page()

        for keyword in SEARCH_KEYWORDS:
            if current_count + len(all_image_urls) >= MAX_IMAGES:
                break

            encoded_kw = quote(keyword)
            search_url = f"https://search.naver.com/search.naver?where=image&sm=tab_jum&query={encoded_kw}"

            print(f"\n🔍 검색: '{keyword}'")

            try:
                page.goto(search_url, wait_until="networkidle", timeout=30000)
                time.sleep(3)
            except Exception as e:
                print(f"   ❌ 페이지 로딩 실패: {e}")
                continue

            prev_height = 0
            no_change_count = 0

            for scroll_idx in range(MAX_SCROLL_COUNT):
                try:
                    # 네이버 이미지 검색: JavaScript로 모든 이미지 URL 추출
                    # 네이버는 DOM 구조가 자주 바뀌므로, JS로 직접 추출
                    urls_from_page = page.evaluate("""() => {
                        const urls = new Set();

                        // 방법 1: 모든 img 태그에서 src, data-source, data-lazy-src 추출
                        document.querySelectorAll('img').forEach(img => {
                            const candidates = [
                                img.getAttribute('data-source'),
                                img.getAttribute('data-lazy-src'),
                                img.getAttribute('data-original'),
                                img.src
                            ];
                            candidates.forEach(url => {
                                if (url && url.startsWith('http') &&
                                    (url.includes('.jpg') || url.includes('.jpeg') ||
                                     url.includes('.png') || url.includes('.webp'))) {
                                    urls.add(url);
                                }
                            });

                            // srcset 파싱
                            const srcset = img.getAttribute('srcset');
                            if (srcset) {
                                srcset.split(',').forEach(part => {
                                    const u = part.trim().split(' ')[0];
                                    if (u && u.startsWith('http')) urls.add(u);
                                });
                            }
                        });

                        // 방법 2: a 태그 내 thumbnail에서 원본 URL 추출
                        document.querySelectorAll('a[href*="imgurl="], a[data-url]').forEach(a => {
                            const href = a.getAttribute('href') || '';
                            const dataUrl = a.getAttribute('data-url') || '';
                            [href, dataUrl].forEach(u => {
                                const match = u.match(/imgurl=([^&]+)/);
                                if (match) {
                                    try { urls.add(decodeURIComponent(match[1])); } catch(e) {}
                                }
                            });
                        });

                        // 방법 3: background-image에서 추출
                        document.querySelectorAll('[style*="background-image"]').forEach(el => {
                            const style = el.getAttribute('style');
                            const match = style.match(/url\\(['"]?(https?[^'"\\)]+)/);
                            if (match) urls.add(match[1]);
                        });

                        return Array.from(urls);
                    }""")

                    for src in urls_from_page:
                        # 로고, 아이콘, 매우 작은 이미지 제외
                        if any(skip in src.lower() for skip in [
                            "logo", "icon", "button", "sprite", "blank",
                            "favicon", "banner", "ad_img", "static.naver",
                            "ssl.pstatic.net/imgmedia",  # 네이버 UI 이미지
                            "1x1", "pixel"
                        ]):
                            continue
                        # 네이버 이미지 호스팅 도메인은 허용
                        all_image_urls.add(src)

                except Exception as e:
                    print(f"      ⚠️ 수집 오류: {e}")

                # 스크롤
                page.evaluate("window.scrollBy(0, 1200)")
                time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

                # "더보기" 버튼 자동 클릭
                try:
                    more_btn = page.query_selector("a.btn_more, button._more_btn, [class*='more']")
                    if more_btn and more_btn.is_visible():
                        more_btn.click()
                        time.sleep(2)
                except Exception:
                    pass

                new_height = page.evaluate("document.body.scrollHeight")
                if new_height == prev_height:
                    no_change_count += 1
                    if no_change_count >= 3:
                        break
                else:
                    no_change_count = 0
                prev_height = new_height

                if (scroll_idx + 1) % 5 == 0:
                    print(f"      스크롤 {scroll_idx + 1}회 / URL: {len(all_image_urls)}개")

            keyword_new = len(all_image_urls) - len(collected_urls)
            print(f"   📸 '{keyword}' 수집 URL: {keyword_new}개")

        browser.close()

    # 다운로드
    new_urls = [url for url in all_image_urls if url not in collected_urls]
    print(f"\n📥 다운로드 대상: {len(new_urls)}개")

    downloaded = 0
    for idx, img_url in enumerate(new_urls, 1):
        if current_count + downloaded >= MAX_IMAGES:
            print(f"\n✅ 목표 수량({MAX_IMAGES}장) 도달")
            break

        seq_num = current_count + downloaded + 1
        ext = get_image_extension(img_url)
        filename = f"naver_{seq_num:04d}{ext}"
        save_path = RAW_DIR / filename

        print(f"[{idx}/{len(new_urls)}] {filename} 다운로드 중...")

        if download_image(img_url, save_path):
            downloaded += 1
            meta["images"][filename] = {
                "source_url": img_url,
                "source_site": "naver",
                "downloaded_at": datetime.now().isoformat(),
                "file_size_bytes": save_path.stat().st_size,
            }
            save_metadata(meta)
            print(f"   ✅ 저장 ({save_path.stat().st_size / 1024:.1f}KB)")
        else:
            print(f"   ⏭️ 건너뜀")

        time.sleep(random.uniform(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX))

    print(f"\n📋 네이버 수집 완료: 새 {downloaded}장 / 총 {current_count + downloaded}장")


if __name__ == "__main__":
    crawl_naver()
