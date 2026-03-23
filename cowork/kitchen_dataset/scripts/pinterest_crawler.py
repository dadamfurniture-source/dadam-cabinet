"""
핀터레스트 한국 주방 이미지 크롤러
====================================
핀터레스트에서 한국형 주방 관련 이미지를 검색어 기반으로 수집합니다.

기능:
- 핀터레스트 검색 + 무한 스크롤 수집
- 고해상도 이미지 우선 추출 (srcset 파싱)
- 체크포인트 기반 재개(resume)
- 수집 간격 2~3초 유지
- 메타데이터 JSON 자동 기록

사용법:
    pip install playwright requests
    playwright install chromium
    python pinterest_crawler.py
"""

from playwright.sync_api import sync_playwright
import requests
import json
import time
import random
import re
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse, quote

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "raw"
METADATA_DIR = BASE_DIR / "metadata"
META_FILE = METADATA_DIR / "pinterest_meta.json"

# 검색 키워드
SEARCH_KEYWORDS = [
    "korean kitchen interior",
    "한국 주방 인테리어",
    "korean apartment kitchen",
    "modern korean kitchen design",
    "scandinavian korean kitchen",
    "luxury kitchen design korea",
    "아파트 주방 디자인",
    "주방 리모델링 한국",
]

# 크롤링 설정
MAX_SCROLL_COUNT = 40
SCROLL_DELAY_MIN = 2.5
SCROLL_DELAY_MAX = 4.0
DOWNLOAD_DELAY_MIN = 1.5
DOWNLOAD_DELAY_MAX = 2.5
MAX_IMAGES = 500
IMAGE_MIN_SIZE = 5000
REQUEST_TIMEOUT = 15
MAX_DOWNLOAD_RETRIES = 3


# ──────────────────────────────────────────────
# 메타데이터 관리
# ──────────────────────────────────────────────
def load_metadata() -> dict:
    if META_FILE.exists():
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"created_at": datetime.now().isoformat(), "source": "pinterest", "images": {}}


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
                "Referer": "https://www.pinterest.com/",
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


def get_high_res_url(url: str) -> str:
    """핀터레스트 이미지 URL을 고해상도로 변환"""
    # Pinterest URL 패턴: /236x/ → /originals/ 또는 /736x/
    if "pinimg.com" in url:
        url = re.sub(r"/\d+x\d*/", "/736x/", url)
    return url


def get_image_extension(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        if ext in path:
            return ext
    return ".jpg"


# ──────────────────────────────────────────────
# 메인 크롤러
# ──────────────────────────────────────────────
def crawl_pinterest():
    print("=" * 60)
    print("  핀터레스트 주방 이미지 크롤러")
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
            search_url = f"https://www.pinterest.com/search/pins/?q={encoded_kw}"

            print(f"\n🔍 검색: '{keyword}'")

            try:
                page.goto(search_url, wait_until="networkidle", timeout=30000)
                time.sleep(4)  # 핀터레스트는 로딩이 느림
            except Exception as e:
                print(f"   ❌ 페이지 로딩 실패: {e}")
                continue

            prev_count = len(all_image_urls)
            prev_height = 0

            for scroll_idx in range(MAX_SCROLL_COUNT):
                try:
                    # 핀터레스트 이미지 수집
                    img_elements = page.query_selector_all("img[src*='pinimg.com']")

                    if len(img_elements) < 5:
                        img_elements = page.query_selector_all("img")

                    for img in img_elements:
                        src = img.get_attribute("src") or ""
                        srcset = img.get_attribute("srcset") or ""

                        # srcset에서 가장 큰 이미지 추출
                        if srcset:
                            parts = srcset.split(",")
                            best_url = ""
                            best_width = 0
                            for part in parts:
                                tokens = part.strip().split()
                                if len(tokens) >= 2:
                                    w_match = re.search(r"(\d+)w", tokens[-1])
                                    if w_match:
                                        w = int(w_match.group(1))
                                        if w > best_width:
                                            best_width = w
                                            best_url = tokens[0]
                            if best_url:
                                src = best_url

                        if src and "pinimg.com" in src:
                            high_res = get_high_res_url(src)
                            all_image_urls.add(high_res)
                        elif src and src.startswith("http"):
                            # 핀터레스트 외부 이미지도 포함
                            if not any(skip in src for skip in ["logo", "icon", "avatar", "badge"]):
                                all_image_urls.add(src)

                except Exception as e:
                    print(f"      ⚠️ 수집 오류: {e}")

                page.evaluate("window.scrollBy(0, 1500)")
                time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

                new_height = page.evaluate("document.body.scrollHeight")
                if new_height == prev_height:
                    break
                prev_height = new_height

            keyword_new = len(all_image_urls) - prev_count
            print(f"   📸 '{keyword}' 새 URL: {keyword_new}개")

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
        filename = f"pinterest_{seq_num:04d}{ext}"
        save_path = RAW_DIR / filename

        print(f"[{idx}/{len(new_urls)}] {filename} 다운로드 중...")

        if download_image(img_url, save_path):
            downloaded += 1
            meta["images"][filename] = {
                "source_url": img_url,
                "source_site": "pinterest",
                "downloaded_at": datetime.now().isoformat(),
                "file_size_bytes": save_path.stat().st_size,
            }
            save_metadata(meta)
            print(f"   ✅ 저장 ({save_path.stat().st_size / 1024:.1f}KB)")
        else:
            print(f"   ⏭️ 건너뜀")

        time.sleep(random.uniform(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX))

    print(f"\n📋 핀터레스트 수집 완료: 새 {downloaded}장 / 총 {current_count + downloaded}장")


if __name__ == "__main__":
    crawl_pinterest()
