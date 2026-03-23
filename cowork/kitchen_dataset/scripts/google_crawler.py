"""
Google 이미지 검색 주방 이미지 크롤러
======================================
Google 이미지 검색에서 한국형 주방 인테리어 이미지를 수집합니다.

기능:
- Playwright로 Google 이미지 검색 스크롤 수집
- 썸네일이 아닌 원본 이미지 URL 추출
- 체크포인트 기반 재개(resume)
- 수집 간격 2~3초 유지
- 메타데이터 JSON 자동 기록

사용법:
    pip install playwright requests
    playwright install chromium
    python google_crawler.py
"""

from playwright.sync_api import sync_playwright
import requests
import json
import time
import random
import re
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse, quote, unquote

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "raw"
METADATA_DIR = BASE_DIR / "metadata"
META_FILE = METADATA_DIR / "google_meta.json"

# 검색 키워드 (한국어 + 영어 혼합)
SEARCH_KEYWORDS = [
    "한국 주방 인테리어 사진",
    "아파트 주방 리모델링 사례",
    "신축 아파트 주방 디자인",
    "모던 주방 인테리어 한국",
    "북유럽 주방 인테리어",
    "럭셔리 주방 디자인 한국",
    "화이트 주방 인테리어 사진",
    "내추럴 주방 디자인",
    "클래식 주방 인테리어",
    "korean kitchen interior design",
    "korean apartment kitchen modern",
    "luxury kitchen design korea",
]

# 크롤링 설정
MAX_SCROLL_COUNT = 20
SCROLL_DELAY_MIN = 2.0
SCROLL_DELAY_MAX = 3.5
DOWNLOAD_DELAY_MIN = 1.0
DOWNLOAD_DELAY_MAX = 2.5
MAX_IMAGES = 500
IMAGE_MIN_SIZE = 10000       # 10KB 이상만 (Google 썸네일 제외)
REQUEST_TIMEOUT = 20
MAX_DOWNLOAD_RETRIES = 3


# ──────────────────────────────────────────────
# 메타데이터 관리
# ──────────────────────────────────────────────
def load_metadata() -> dict:
    if META_FILE.exists():
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"created_at": datetime.now().isoformat(), "source": "google", "images": {}}


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
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
            }
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True, allow_redirects=True)
            response.raise_for_status()

            content_type = response.headers.get("Content-Type", "")
            if "image" not in content_type and "octet-stream" not in content_type:
                return False

            with open(save_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            file_size = save_path.stat().st_size
            if file_size < IMAGE_MIN_SIZE:
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
def crawl_google():
    print("=" * 60)
    print("  Google 이미지 검색 주방 크롤러")
    print("=" * 60)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    meta = load_metadata()
    collected_urls = set(info.get("source_url", "") for info in meta.get("images", {}).values())
    current_count = len(meta.get("images", {}))

    print(f"\n📊 현황: 기존 {current_count}장 / 목표 {MAX_IMAGES}장")

    if current_count >= MAX_IMAGES:
        print("✅ 이미 목표 수량 도달")
        return

    all_image_data = []  # (url, keyword) 리스트
    seen_urls = set()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="ko-KR",
        )
        page = context.new_page()

        for keyword in SEARCH_KEYWORDS:
            if current_count + len(all_image_data) >= MAX_IMAGES:
                break

            encoded_kw = quote(keyword)
            # Google 이미지 검색 (큰 이미지 필터 적용)
            search_url = f"https://www.google.com/search?q={encoded_kw}&tbm=isch&tbs=isz:l"

            print(f"\n🔍 검색: '{keyword}'")

            try:
                page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
                time.sleep(3)
            except Exception as e:
                print(f"   ❌ 페이지 로딩 실패: {e}")
                continue

            prev_height = 0
            no_change_count = 0
            keyword_start = len(all_image_data)

            for scroll_idx in range(MAX_SCROLL_COUNT):
                try:
                    # JavaScript로 원본 이미지 URL 추출
                    urls_from_page = page.evaluate("""() => {
                        const urls = [];

                        // 방법 1: 이미지 썸네일 클릭 시 나오는 원본 URL 추출
                        // Google은 data-src에 원본 URL을 저장
                        document.querySelectorAll('img').forEach(img => {
                            const candidates = [
                                img.getAttribute('data-src'),
                                img.getAttribute('data-iurl'),
                                img.src
                            ];

                            candidates.forEach(url => {
                                if (!url) return;
                                // base64 이미지 건너뛰기
                                if (url.startsWith('data:')) return;
                                // Google 내부 URL 건너뛰기
                                if (url.includes('gstatic.com/images') ||
                                    url.includes('google.com/images') ||
                                    url.includes('googleusercontent.com/fakeurl')) return;
                                // 작은 아이콘 건너뛰기
                                if (url.includes('=s32') || url.includes('=s44') ||
                                    url.includes('=s64') || url.includes('=s96')) return;

                                if (url.startsWith('http')) {
                                    urls.push(url);
                                }
                            });
                        });

                        // 방법 2: a 태그에서 원본 이미지 URL 추출
                        document.querySelectorAll('a[href*="imgurl="]').forEach(a => {
                            const href = a.getAttribute('href') || '';
                            const match = href.match(/imgurl=([^&]+)/);
                            if (match) {
                                try {
                                    urls.push(decodeURIComponent(match[1]));
                                } catch(e) {}
                            }
                        });

                        // 방법 3: JSON-LD 또는 스크립트 태그에서 추출
                        document.querySelectorAll('script').forEach(script => {
                            const text = script.textContent || '';
                            const matches = text.matchAll(/"ou":"(https?:[^"]+)"/g);
                            for (const m of matches) {
                                try {
                                    urls.push(m[1].replace(/\\\\u003d/g, '=').replace(/\\\\/g, ''));
                                } catch(e) {}
                            }
                        });

                        return urls;
                    }""")

                    for src in urls_from_page:
                        # 중복 및 필터링
                        base_url = src.split("?")[0] if "gstatic" not in src else src
                        if base_url in seen_urls or src in collected_urls:
                            continue
                        if any(skip in src.lower() for skip in [
                            "logo", "icon", "favicon", "sprite", "1x1",
                            "pixel", "blank", "transparent", "avatar",
                            "badge", "emoji", "arrow", "btn_",
                        ]):
                            continue
                        # 고해상도 이미지 호스팅 도메인 허용
                        seen_urls.add(base_url)
                        all_image_data.append((src, keyword))

                except Exception as e:
                    print(f"      ⚠️ 수집 오류: {e}")

                # 스크롤
                page.evaluate("window.scrollBy(0, 1500)")
                time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

                # "결과 더보기" 버튼 클릭
                try:
                    more_btn = page.query_selector("input[value='결과 더보기'], input.mye4qd, #smb")
                    if more_btn and more_btn.is_visible():
                        more_btn.click()
                        time.sleep(3)
                        print(f"      📄 '결과 더보기' 클릭")
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
                    keyword_count = len(all_image_data) - keyword_start
                    print(f"      스크롤 {scroll_idx + 1}회 / 이 키워드: {keyword_count}개")

            keyword_count = len(all_image_data) - keyword_start
            print(f"   📸 '{keyword}' 수집: {keyword_count}개")

        browser.close()

    # ─── 다운로드 ───
    new_items = [(url, kw) for url, kw in all_image_data if url not in collected_urls]
    print(f"\n📥 다운로드 대상: {len(new_items)}개")

    downloaded = 0
    failed = 0
    for idx, (img_url, keyword) in enumerate(new_items, 1):
        if current_count + downloaded >= MAX_IMAGES:
            print(f"\n✅ 목표 수량({MAX_IMAGES}장) 도달")
            break

        seq_num = current_count + downloaded + 1
        ext = get_image_extension(img_url)
        filename = f"google_{seq_num:04d}{ext}"
        save_path = RAW_DIR / filename

        print(f"[{idx}/{len(new_items)}] {filename} 다운로드 중...")

        if download_image(img_url, save_path):
            downloaded += 1
            meta["images"][filename] = {
                "source_url": img_url,
                "source_site": "google",
                "search_keyword": keyword,
                "downloaded_at": datetime.now().isoformat(),
                "file_size_bytes": save_path.stat().st_size,
            }
            save_metadata(meta)
            print(f"   ✅ 저장 ({save_path.stat().st_size / 1024:.1f}KB)")
        else:
            failed += 1
            if failed > 20 and downloaded == 0:
                print(f"\n⚠️ 연속 실패가 많습니다. 네트워크를 확인해주세요.")
                break

        time.sleep(random.uniform(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX))

    # 최종 요약
    print("\n" + "=" * 60)
    print("  📋 Google 이미지 수집 결과")
    print("=" * 60)
    print(f"   새로 다운로드: {downloaded}장")
    print(f"   다운로드 실패: {failed}장")
    print(f"   총 수집:       {current_count + downloaded}장")
    print(f"   저장 위치:     {RAW_DIR}")
    print(f"   메타데이터:    {META_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    crawl_google()
