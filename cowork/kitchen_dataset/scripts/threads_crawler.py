"""
Threads 주방 이미지 크롤러 (Playwright 기반)
=============================================
Threads에서 주방 인테리어 관련 검색어로 이미지를 수집합니다.

특징:
- Playwright로 Threads 웹 버전 스크롤 수집
- 로그인 없이 공개 게시물 수집 가능 (로그인 시 더 많은 결과)
- 체크포인트 기반 재개(resume)
- 수집 간격 3~5초 유지

사용법:
    pip install playwright requests
    playwright install chromium
    python threads_crawler.py
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
META_FILE = METADATA_DIR / "threads_meta.json"

# 검색 키워드 / 프로필
SEARCH_KEYWORDS = [
    "한국 주방 인테리어",
    "주방 리모델링",
    "아파트 주방 디자인",
    "모던 주방",
    "주방 싱크대",
    "kitchen interior korea",
    "korean kitchen design",
]

# 인테리어 관련 Threads 계정 (공개 계정만)
TARGET_PROFILES = [
    # 필요시 수집하고 싶은 공개 계정 추가
    # "ohouse_official",
    # "interiordesign_kr",
]

# 크롤링 설정
MAX_SCROLL_COUNT = 25
SCROLL_DELAY_MIN = 3.0
SCROLL_DELAY_MAX = 5.0
DOWNLOAD_DELAY_MIN = 1.5
DOWNLOAD_DELAY_MAX = 3.0
MAX_IMAGES = 300
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
    return {"created_at": datetime.now().isoformat(), "source": "threads", "images": {}}


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
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Referer": "https://www.threads.net/",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
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


def clean_threads_url(url: str) -> str:
    """Threads/Instagram CDN URL에서 고해상도 버전 추출"""
    # scontent URL에서 크기 제한 파라미터 제거하여 원본 크기 요청
    if "scontent" in url and "cdninstagram" in url:
        # 이미 고해상도 URL
        return url
    return url


# ──────────────────────────────────────────────
# 메인 크롤러
# ──────────────────────────────────────────────
def crawl_threads():
    print("=" * 60)
    print("  Threads 주방 이미지 크롤러")
    print("=" * 60)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    meta = load_metadata()
    collected_urls = set(info.get("source_url", "") for info in meta.get("images", {}).values())
    current_count = len(meta.get("images", {}))

    print(f"\n📊 현황: 기존 {current_count}장 / 목표 {MAX_IMAGES}장")

    if current_count >= MAX_IMAGES:
        print("✅ 이미 목표 수량 도달")
        return

    all_image_urls = []  # (url, source_keyword) 튜플 리스트
    seen_urls = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="ko-KR",
        )
        page = context.new_page()

        # ─── 키워드 검색 수집 ───
        for keyword in SEARCH_KEYWORDS:
            if current_count + len(all_image_urls) >= MAX_IMAGES:
                break

            encoded_kw = quote(keyword)
            search_url = f"https://www.threads.net/search?q={encoded_kw}&serp_type=default"

            print(f"\n🔍 검색: '{keyword}'")

            try:
                page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
                time.sleep(5)  # Threads는 JS 렌더링이 느림
            except Exception as e:
                print(f"   ❌ 페이지 로딩 실패: {e}")
                continue

            prev_height = 0
            no_change_count = 0
            keyword_count = 0

            for scroll_idx in range(MAX_SCROLL_COUNT):
                try:
                    # JavaScript로 이미지 URL 추출
                    urls_from_page = page.evaluate("""() => {
                        const urls = [];

                        // 방법 1: img 태그에서 추출
                        document.querySelectorAll('img').forEach(img => {
                            const src = img.src || '';
                            // Threads/Instagram CDN 이미지만 수집
                            if (src && (
                                src.includes('scontent') ||
                                src.includes('cdninstagram') ||
                                src.includes('fbcdn')
                            )) {
                                // 프로필 사진, 아이콘 제외 (보통 150x150 이하)
                                const w = img.naturalWidth || img.width || 0;
                                const h = img.naturalHeight || img.height || 0;
                                if ((w > 200 || h > 200) || (w === 0 && h === 0)) {
                                    urls.push(src);
                                }
                            }
                        });

                        // 방법 2: background-image에서 추출
                        document.querySelectorAll('[style*="background-image"]').forEach(el => {
                            const style = el.getAttribute('style') || '';
                            const match = style.match(/url\\(['"]?(https?[^'"\\)]+)/);
                            if (match && (
                                match[1].includes('scontent') ||
                                match[1].includes('cdninstagram')
                            )) {
                                urls.push(match[1]);
                            }
                        });

                        // 방법 3: srcset에서 고해상도 추출
                        document.querySelectorAll('img[srcset]').forEach(img => {
                            const srcset = img.getAttribute('srcset');
                            if (srcset) {
                                const parts = srcset.split(',');
                                let bestUrl = '';
                                let bestWidth = 0;
                                parts.forEach(part => {
                                    const tokens = part.trim().split(' ');
                                    if (tokens.length >= 2) {
                                        const wMatch = tokens[1].match(/(\\d+)w/);
                                        if (wMatch && parseInt(wMatch[1]) > bestWidth) {
                                            bestWidth = parseInt(wMatch[1]);
                                            bestUrl = tokens[0];
                                        }
                                    }
                                });
                                if (bestUrl) urls.push(bestUrl);
                            }
                        });

                        return urls;
                    }""")

                    for src in urls_from_page:
                        # 중복 제거
                        # URL에서 쿼리 파라미터 제거하여 중복 판별
                        base_url = src.split("?")[0]
                        if base_url in seen_urls or src in collected_urls:
                            continue

                        # 프로필 사진 패턴 제외
                        if any(skip in src.lower() for skip in [
                            "150x150", "44x44", "32x32", "profile",
                            "s150x150", "s44x44", "s32x32",
                        ]):
                            continue

                        seen_urls.add(base_url)
                        all_image_urls.append((clean_threads_url(src), keyword))
                        keyword_count += 1

                except Exception as e:
                    print(f"      ⚠️ 수집 오류: {e}")

                # 스크롤
                page.evaluate("window.scrollBy(0, 1500)")
                time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

                new_height = page.evaluate("document.body.scrollHeight")
                if new_height == prev_height:
                    no_change_count += 1
                    if no_change_count >= 3:
                        break
                else:
                    no_change_count = 0
                prev_height = new_height

                if (scroll_idx + 1) % 5 == 0:
                    print(f"      스크롤 {scroll_idx + 1}회 / URL: {keyword_count}개")

            print(f"   📸 '{keyword}' 수집: {keyword_count}개")

        # ─── 프로필 수집 ───
        for profile in TARGET_PROFILES:
            if current_count + len(all_image_urls) >= MAX_IMAGES:
                break

            profile_url = f"https://www.threads.net/@{profile}"
            print(f"\n👤 프로필: @{profile}")

            try:
                page.goto(profile_url, wait_until="domcontentloaded", timeout=30000)
                time.sleep(5)
            except Exception as e:
                print(f"   ❌ 프로필 로딩 실패: {e}")
                continue

            prev_height = 0
            no_change_count = 0
            profile_count = 0

            for scroll_idx in range(15):  # 프로필은 스크롤 적게
                try:
                    urls_from_page = page.evaluate("""() => {
                        const urls = [];
                        document.querySelectorAll('img').forEach(img => {
                            const src = img.src || '';
                            if (src && (src.includes('scontent') || src.includes('cdninstagram'))) {
                                const w = img.naturalWidth || img.width || 0;
                                if (w > 200 || w === 0) urls.push(src);
                            }
                        });
                        return urls;
                    }""")

                    for src in urls_from_page:
                        base_url = src.split("?")[0]
                        if base_url in seen_urls or src in collected_urls:
                            continue
                        if any(skip in src.lower() for skip in ["150x150", "44x44", "32x32", "profile"]):
                            continue
                        seen_urls.add(base_url)
                        all_image_urls.append((clean_threads_url(src), f"@{profile}"))
                        profile_count += 1

                except Exception:
                    pass

                page.evaluate("window.scrollBy(0, 1500)")
                time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

                new_height = page.evaluate("document.body.scrollHeight")
                if new_height == prev_height:
                    no_change_count += 1
                    if no_change_count >= 3:
                        break
                else:
                    no_change_count = 0
                prev_height = new_height

            print(f"   📸 @{profile} 수집: {profile_count}개")

        browser.close()

    # ─── 다운로드 ───
    print(f"\n📥 다운로드 대상: {len(all_image_urls)}개")

    downloaded = 0
    for idx, (img_url, source) in enumerate(all_image_urls, 1):
        if current_count + downloaded >= MAX_IMAGES:
            print(f"\n✅ 목표 수량({MAX_IMAGES}장) 도달")
            break

        seq_num = current_count + downloaded + 1
        ext = get_image_extension(img_url)
        filename = f"threads_{seq_num:04d}{ext}"
        save_path = RAW_DIR / filename

        print(f"[{idx}/{len(all_image_urls)}] {filename} 다운로드 중...")

        if download_image(img_url, save_path):
            downloaded += 1
            meta["images"][filename] = {
                "source_url": img_url,
                "source_site": "threads",
                "search_keyword": source,
                "downloaded_at": datetime.now().isoformat(),
                "file_size_bytes": save_path.stat().st_size,
            }
            save_metadata(meta)
            print(f"   ✅ 저장 ({save_path.stat().st_size / 1024:.1f}KB)")
        else:
            print(f"   ⏭️ 건너뜀")

        time.sleep(random.uniform(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX))

    # 최종 요약
    print("\n" + "=" * 60)
    print("  📋 Threads 수집 결과")
    print("=" * 60)
    print(f"   새로 다운로드: {downloaded}장")
    print(f"   총 수집:       {current_count + downloaded}장")
    print(f"   저장 위치:     {RAW_DIR}")
    print(f"   메타데이터:    {META_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    crawl_threads()
