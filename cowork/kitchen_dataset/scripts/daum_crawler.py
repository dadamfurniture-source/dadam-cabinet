"""
다음(Daum) 이미지 검색 주방 이미지 크롤러
==========================================
다음 이미지 검색에서 한국형 주방 인테리어 이미지를 수집합니다.

기능:
- Playwright로 다음 이미지 검색 스크롤 수집
- 체크포인트 기반 재개(resume)
- 수집 간격 2~3초 유지
- 메타데이터 JSON 자동 기록

사용법:
    pip install playwright requests
    playwright install chromium
    python daum_crawler.py
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
META_FILE = METADATA_DIR / "daum_meta.json"

# 검색 키워드
SEARCH_KEYWORDS = [
    "한국 주방 인테리어",
    "아파트 주방 리모델링",
    "신축 아파트 주방 디자인",
    "모던 주방 인테리어",
    "북유럽 주방 디자인",
    "럭셔리 주방 인테리어",
    "화이트 주방 인테리어",
    "내추럴 주방 디자인",
    "클래식 주방 인테리어",
    "주방 싱크대 디자인",
    "주방 아일랜드 디자인",
    "인더스트리얼 주방",
]

# 크롤링 설정
MAX_SCROLL_COUNT = 25
SCROLL_DELAY_MIN = 2.0
SCROLL_DELAY_MAX = 3.5
DOWNLOAD_DELAY_MIN = 1.0
DOWNLOAD_DELAY_MAX = 2.5
MAX_IMAGES = 500
IMAGE_MIN_SIZE = 8000
REQUEST_TIMEOUT = 20
MAX_DOWNLOAD_RETRIES = 3


# ──────────────────────────────────────────────
# 메타데이터 관리
# ──────────────────────────────────────────────
def load_metadata() -> dict:
    if META_FILE.exists():
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"created_at": datetime.now().isoformat(), "source": "daum", "images": {}}


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
                "Referer": "https://search.daum.net/",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            }
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
def crawl_daum():
    print("=" * 60)
    print("  다음(Daum) 주방 이미지 크롤러")
    print("=" * 60)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    meta = load_metadata()
    collected_urls = set(info.get("source_url", "") for info in meta.get("images", {}).values())
    current_count = len(meta.get("images", {}))

    print(f"\n📊 현황: 기존 {current_count}장 / 목표 {MAX_IMAGES}장")

    if current_count >= MAX_IMAGES:
        print("✅ 이미 목표 수량 도달")
        return

    all_image_data = []
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
            # 다음 이미지 검색 URL (큰 이미지 필터)
            search_url = f"https://search.daum.net/search?w=img&q={encoded_kw}&DA=IIM&nil_search=btn&enc=utf8"

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
                    urls_from_page = page.evaluate("""() => {
                        const urls = [];

                        // 방법 1: img 태그에서 다양한 속성으로 URL 추출
                        document.querySelectorAll('img').forEach(img => {
                            const candidates = [
                                img.getAttribute('data-original-src'),
                                img.getAttribute('data-source'),
                                img.getAttribute('data-lazy-src'),
                                img.getAttribute('data-original'),
                                img.getAttribute('data-src'),
                                img.src
                            ];

                            candidates.forEach(url => {
                                if (!url) return;
                                if (url.startsWith('data:')) return;
                                // 다음 내부 UI 이미지 제외
                                if (url.includes('t1.daumcdn.net/search') ||
                                    url.includes('t1.daumcdn.net/icon') ||
                                    url.includes('t1.daumcdn.net/tistory_admin') ||
                                    url.includes('ssl.daumcdn.net')) return;
                                if (url.startsWith('http')) {
                                    urls.push(url);
                                }
                            });

                            // srcset 파싱
                            const srcset = img.getAttribute('srcset');
                            if (srcset) {
                                srcset.split(',').forEach(part => {
                                    const u = part.trim().split(' ')[0];
                                    if (u && u.startsWith('http')) urls.push(u);
                                });
                            }
                        });

                        // 방법 2: 다음 이미지 검색 결과 링크에서 원본 URL 추출
                        document.querySelectorAll('a[href*="fname="], a[data-image-url]').forEach(a => {
                            const href = a.getAttribute('href') || '';
                            const dataUrl = a.getAttribute('data-image-url') || '';

                            // fname 파라미터에서 원본 URL 추출
                            [href, dataUrl].forEach(u => {
                                const match = u.match(/fname=([^&]+)/);
                                if (match) {
                                    try { urls.push(decodeURIComponent(match[1])); } catch(e) {}
                                }
                            });

                            if (dataUrl && dataUrl.startsWith('http')) {
                                urls.push(dataUrl);
                            }
                        });

                        // 방법 3: 다음 이미지 뷰어의 원본 URL
                        document.querySelectorAll('[data-original-url], [data-image]').forEach(el => {
                            const url = el.getAttribute('data-original-url') ||
                                        el.getAttribute('data-image') || '';
                            if (url && url.startsWith('http')) urls.push(url);
                        });

                        // 방법 4: background-image
                        document.querySelectorAll('[style*="background-image"]').forEach(el => {
                            const style = el.getAttribute('style') || '';
                            const match = style.match(/url\\(['"]?(https?[^'"\\)]+)/);
                            if (match) urls.push(match[1]);
                        });

                        return urls;
                    }""")

                    for src in urls_from_page:
                        base_url = src.split("?")[0] if "daumcdn" not in src else src
                        if base_url in seen_urls or src in collected_urls:
                            continue
                        if any(skip in src.lower() for skip in [
                            "logo", "icon", "favicon", "sprite", "blank",
                            "1x1", "pixel", "transparent", "avatar",
                            "badge", "btn_", "arrow", "emoji",
                            "banner", "ad_img",
                        ]):
                            continue
                        seen_urls.add(base_url)
                        all_image_data.append((src, keyword))

                except Exception as e:
                    print(f"      ⚠️ 수집 오류: {e}")

                # 스크롤
                page.evaluate("window.scrollBy(0, 1500)")
                time.sleep(random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX))

                # "더보기" 버튼 클릭
                try:
                    more_btn = page.query_selector("a.btn_more, button.btn_more, #moreBtn, [class*='more']")
                    if more_btn and more_btn.is_visible():
                        more_btn.click()
                        time.sleep(2)
                        print(f"      📄 '더보기' 클릭")
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
        filename = f"daum_{seq_num:04d}{ext}"
        save_path = RAW_DIR / filename

        print(f"[{idx}/{len(new_items)}] {filename} 다운로드 중...")

        if download_image(img_url, save_path):
            downloaded += 1
            meta["images"][filename] = {
                "source_url": img_url,
                "source_site": "daum",
                "search_keyword": keyword,
                "downloaded_at": datetime.now().isoformat(),
                "file_size_bytes": save_path.stat().st_size,
            }
            save_metadata(meta)
            print(f"   ✅ 저장 ({save_path.stat().st_size / 1024:.1f}KB)")
        else:
            failed += 1
            if failed > 30 and downloaded == 0:
                print(f"\n⚠️ 연속 실패가 많습니다. 네트워크를 확인해주세요.")
                break

        time.sleep(random.uniform(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX))

    # 최종 요약
    print("\n" + "=" * 60)
    print("  📋 다음(Daum) 이미지 수집 결과")
    print("=" * 60)
    print(f"   새로 다운로드: {downloaded}장")
    print(f"   다운로드 실패: {failed}장")
    print(f"   총 수집:       {current_count + downloaded}장")
    print(f"   저장 위치:     {RAW_DIR}")
    print(f"   메타데이터:    {META_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    crawl_daum()
