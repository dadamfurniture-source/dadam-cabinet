"""
오늘의집 주방 이미지 크롤러
============================
Playwright를 사용하여 오늘의집 인테리어 카테고리에서
주방 이미지를 자동 스크롤하며 수집합니다.

기능:
- 자동 스크롤 + 이미지 URL 수집
- 중복 제거 (URL 기반)
- 체크포인트 기반 재개(resume): 인터넷 끊김 후 이어서 처리
- 수집 간격 2~3초 유지 (서버 부하 방지)
- 메타데이터 JSON 자동 기록

사용법:
    pip install playwright requests
    playwright install chromium
    python ohouse_crawler.py
"""

from playwright.sync_api import sync_playwright
import requests
import json
import time
import os
import random
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse, urljoin

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "raw"
METADATA_DIR = BASE_DIR / "metadata"
META_FILE = METADATA_DIR / "ohouse_meta.json"

# 수집 대상 URL (오늘의집 주방 카테고리)
TARGET_URLS = [
    "https://ohou.se/projects?category=kitchen",
    "https://ohou.se/projects?keyword=%EC%A3%BC%EB%B0%A9",
]

# 크롤링 설정
MAX_SCROLL_COUNT = 50        # 최대 스크롤 횟수
SCROLL_DELAY_MIN = 2.0       # 스크롤 간 최소 대기(초)
SCROLL_DELAY_MAX = 3.5       # 스크롤 간 최대 대기(초)
DOWNLOAD_DELAY_MIN = 1.0     # 다운로드 간 최소 대기(초)
DOWNLOAD_DELAY_MAX = 2.0     # 다운로드 간 최대 대기(초)
MAX_IMAGES = 1000            # 최대 수집 이미지 수
IMAGE_MIN_WIDTH = 400        # 최소 이미지 너비 (썸네일 제외)
REQUEST_TIMEOUT = 15         # 다운로드 타임아웃(초)
MAX_DOWNLOAD_RETRIES = 3     # 다운로드 재시도 횟수


# ──────────────────────────────────────────────
# 메타데이터 관리
# ──────────────────────────────────────────────
def load_metadata() -> dict:
    """기존 메타데이터 로드 (체크포인트 역할)"""
    if META_FILE.exists():
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "created_at": datetime.now().isoformat(),
        "source": "ohouse",
        "images": {}
    }


def save_metadata(meta: dict):
    """메타데이터 저장"""
    meta["updated_at"] = datetime.now().isoformat()
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


# ──────────────────────────────────────────────
# 이미지 다운로드
# ──────────────────────────────────────────────
def download_image(url: str, save_path: Path) -> bool:
    """
    이미지 다운로드 (재시도 로직 포함)
    Returns True if successful, False otherwise
    """
    for attempt in range(1, MAX_DOWNLOAD_RETRIES + 1):
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://ohou.se/",
            }
            response = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT, stream=True)
            response.raise_for_status()

            # Content-Type 확인
            content_type = response.headers.get("Content-Type", "")
            if "image" not in content_type:
                print(f"      ⚠️ 이미지가 아닌 응답: {content_type}")
                return False

            # 파일 저장
            with open(save_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            # 파일 크기 검증 (최소 5KB)
            if save_path.stat().st_size < 5000:
                save_path.unlink()
                print(f"      ⚠️ 너무 작은 파일 (썸네일 가능성) → 건너뜀")
                return False

            return True

        except requests.exceptions.RequestException as e:
            if attempt < MAX_DOWNLOAD_RETRIES:
                delay = 2 * attempt
                print(f"      ⚠️ 다운로드 실패 (시도 {attempt}/{MAX_DOWNLOAD_RETRIES}): {e}")
                print(f"         {delay}초 후 재시도...")
                time.sleep(delay)
            else:
                print(f"      ❌ 다운로드 최종 실패: {e}")
                return False

    return False


def get_image_extension(url: str) -> str:
    """URL에서 이미지 확장자 추출"""
    parsed = urlparse(url)
    path = parsed.path.lower()
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        if ext in path:
            return ext
    return ".jpg"  # 기본값


# ──────────────────────────────────────────────
# 메인 크롤러
# ──────────────────────────────────────────────
def crawl_ohouse():
    print("=" * 60)
    print("  오늘의집 주방 이미지 크롤러")
    print("=" * 60)

    # 폴더 생성
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # 메타데이터 로드 (체크포인트)
    meta = load_metadata()
    collected_urls = set(
        info.get("source_url", "") for info in meta.get("images", {}).values()
    )
    current_count = len(meta.get("images", {}))

    print(f"\n📊 현황:")
    print(f"   기존 수집: {current_count}장")
    print(f"   목표:      {MAX_IMAGES}장")

    if current_count >= MAX_IMAGES:
        print("\n✅ 이미 목표 수량에 도달했습니다.")
        return

    with sync_playwright() as p:
        # 브라우저 실행 (headless=False로 하면 브라우저 창 확인 가능)
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        page = context.new_page()

        all_image_urls = set()

        for target_url in TARGET_URLS:
            if current_count >= MAX_IMAGES:
                break

            print(f"\n🌐 접속 중: {target_url}")

            try:
                page.goto(target_url, wait_until="networkidle", timeout=30000)
                time.sleep(3)  # 페이지 로딩 대기
            except Exception as e:
                print(f"   ❌ 페이지 로딩 실패: {e}")
                continue

            # 스크롤하며 이미지 URL 수집
            print(f"   📜 스크롤 시작 (최대 {MAX_SCROLL_COUNT}회)...")
            prev_height = 0

            for scroll_idx in range(MAX_SCROLL_COUNT):
                if current_count + len(all_image_urls) - len(collected_urls) >= MAX_IMAGES:
                    print(f"   ✅ 목표 수량 도달")
                    break

                # 이미지 URL 수집 (다양한 셀렉터 시도)
                try:
                    img_elements = page.query_selector_all("img")
                    for img in img_elements:
                        src = img.get_attribute("src") or img.get_attribute("data-src") or ""
                        srcset = img.get_attribute("srcset") or ""

                        # srcset에서 가장 큰 이미지 추출
                        if srcset:
                            parts = srcset.split(",")
                            for part in parts:
                                tokens = part.strip().split()
                                if tokens:
                                    src_candidate = tokens[0]
                                    if src_candidate.startswith("http"):
                                        all_image_urls.add(src_candidate)

                        if src and src.startswith("http"):
                            # 작은 아이콘/로고 제외
                            width = img.get_attribute("width")
                            if width and width.isdigit() and int(width) < IMAGE_MIN_WIDTH:
                                continue
                            all_image_urls.add(src)

                except Exception as e:
                    print(f"      ⚠️ 이미지 요소 수집 오류: {e}")

                # 스크롤
                page.evaluate("window.scrollBy(0, 1200)")
                delay = random.uniform(SCROLL_DELAY_MIN, SCROLL_DELAY_MAX)
                time.sleep(delay)

                # 스크롤 끝 감지
                new_height = page.evaluate("document.body.scrollHeight")
                if new_height == prev_height:
                    print(f"   📜 스크롤 완료 (더 이상 콘텐츠 없음, {scroll_idx + 1}회)")
                    break
                prev_height = new_height

                if (scroll_idx + 1) % 10 == 0:
                    new_urls = len(all_image_urls) - len(collected_urls)
                    print(f"      스크롤 {scroll_idx + 1}회 / 새 이미지 URL: {new_urls}개")

        browser.close()

    # 기존에 수집된 URL 제외
    new_urls = [url for url in all_image_urls if url not in collected_urls]
    print(f"\n📥 다운로드 대상: {len(new_urls)}개 (기존 {len(collected_urls)}개 제외)")

    # 이미지 다운로드
    downloaded = 0
    for idx, img_url in enumerate(new_urls, 1):
        if current_count + downloaded >= MAX_IMAGES:
            print(f"\n✅ 목표 수량({MAX_IMAGES}장) 도달")
            break

        seq_num = current_count + downloaded + 1
        ext = get_image_extension(img_url)
        filename = f"ohouse_{seq_num:04d}{ext}"
        save_path = RAW_DIR / filename

        print(f"[{idx}/{len(new_urls)}] {filename} 다운로드 중...")

        if download_image(img_url, save_path):
            downloaded += 1

            # 메타데이터 기록 (매 이미지마다 = 체크포인트)
            meta["images"][filename] = {
                "source_url": img_url,
                "source_site": "ohouse",
                "downloaded_at": datetime.now().isoformat(),
                "file_size_bytes": save_path.stat().st_size,
            }
            save_metadata(meta)

            print(f"   ✅ 저장 완료 ({save_path.stat().st_size / 1024:.1f}KB)")
        else:
            print(f"   ⏭️ 건너뜀")

        # 다운로드 간격 유지
        delay = random.uniform(DOWNLOAD_DELAY_MIN, DOWNLOAD_DELAY_MAX)
        time.sleep(delay)

    # 최종 요약
    print("\n" + "=" * 60)
    print("  📋 수집 결과 요약")
    print("=" * 60)
    print(f"   새로 다운로드: {downloaded}장")
    print(f"   총 수집 완료:  {current_count + downloaded}장")
    print(f"   저장 위치:     {RAW_DIR}")
    print(f"   메타데이터:    {META_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    crawl_ohouse()
