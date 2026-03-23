"""
인스타그램 주방 이미지 크롤러 (Instaloader 기반)
==================================================
해시태그 기반으로 한국형 주방 인테리어 이미지를 수집합니다.

주의사항:
- 인스타그램 계정 로그인 필요
- 대량 수집 시 계정 일시 차단 위험 → 소량(200~300장) 수집 권장
- 수집 간격을 충분히 두어야 함 (3~5초)
- 비공개 계정 게시물은 수집 불가

사용법:
    pip install instaloader
    python instagram_crawler.py
    (실행 시 인스타그램 아이디/비밀번호 입력 요청)
"""

import instaloader
import json
import time
import shutil
import random
import getpass
from pathlib import Path
from datetime import datetime

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "raw"
METADATA_DIR = BASE_DIR / "metadata"
META_FILE = METADATA_DIR / "instagram_meta.json"
TEMP_DIR = BASE_DIR / "scripts" / "_insta_temp"

# 검색 해시태그
HASHTAGS = [
    "한국주방인테리어",
    "주방인테리어",
    "주방리모델링",
    "아파트주방",
    "모던주방",
    "북유럽주방",
    "주방디자인",
    "싱크대인테리어",
    "주방수납",
    "화이트주방",
]

# 크롤링 설정
MAX_POSTS_PER_HASHTAG = 30   # 해시태그당 최대 게시물 수
MAX_IMAGES = 300              # 총 최대 이미지 수
DELAY_MIN = 3.0               # 게시물 간 최소 대기(초)
DELAY_MAX = 6.0               # 게시물 간 최대 대기(초)


# ──────────────────────────────────────────────
# 메타데이터 관리
# ──────────────────────────────────────────────
def load_metadata() -> dict:
    if META_FILE.exists():
        with open(META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"created_at": datetime.now().isoformat(), "source": "instagram", "images": {}}


def save_metadata(meta: dict):
    meta["updated_at"] = datetime.now().isoformat()
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


# ──────────────────────────────────────────────
# 메인 크롤러
# ──────────────────────────────────────────────
def crawl_instagram():
    print("=" * 60)
    print("  인스타그램 주방 이미지 크롤러")
    print("=" * 60)

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    meta = load_metadata()
    collected_shortcodes = set(
        info.get("shortcode", "") for info in meta.get("images", {}).values()
    )
    current_count = len(meta.get("images", {}))

    print(f"\n📊 현황: 기존 {current_count}장 / 목표 {MAX_IMAGES}장")

    if current_count >= MAX_IMAGES:
        print("✅ 이미 목표 수량 도달")
        return

    # Instaloader 초기화
    L = instaloader.Instaloader(
        download_pictures=True,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        post_metadata_txt_pattern="",
        max_connection_attempts=3,
        request_timeout=30,
        quiet=True,
    )

    # 로그인
    print("\n🔐 인스타그램 로그인")
    print("   (계정 차단 방지를 위해 실제 계정 사용 권장)")
    username = input("   아이디: ").strip()
    password = getpass.getpass("   비밀번호: ")

    try:
        L.login(username, password)
        print("   ✅ 로그인 성공")
    except instaloader.exceptions.BadCredentialsException:
        print("   ❌ 아이디 또는 비밀번호가 틀렸습니다.")
        return
    except instaloader.exceptions.TwoFactorAuthRequiredException:
        print("   ⚠️ 2단계 인증이 필요합니다.")
        code = input("   인증 코드 입력: ").strip()
        try:
            L.two_factor_login(code)
            print("   ✅ 2단계 인증 로그인 성공")
        except Exception as e:
            print(f"   ❌ 2단계 인증 실패: {e}")
            return
    except Exception as e:
        print(f"   ❌ 로그인 실패: {e}")
        return

    # 해시태그별 수집
    downloaded = 0
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    for hashtag in HASHTAGS:
        if current_count + downloaded >= MAX_IMAGES:
            break

        print(f"\n🔍 #{hashtag} 수집 중...")
        posts_collected = 0

        try:
            hashtag_obj = instaloader.Hashtag.from_name(L.context, hashtag)
            posts = hashtag_obj.get_posts()

            for post in posts:
                if current_count + downloaded >= MAX_IMAGES:
                    break
                if posts_collected >= MAX_POSTS_PER_HASHTAG:
                    break

                # 이미 수집한 게시물 건너뛰기
                if post.shortcode in collected_shortcodes:
                    continue

                # 이미지가 아닌 게시물 건너뛰기
                if post.is_video:
                    continue

                try:
                    # 임시 폴더에 다운로드
                    L.download_post(post, target=TEMP_DIR)

                    # 다운로드된 이미지 파일 찾기
                    for img_file in TEMP_DIR.glob("*.jpg"):
                        if img_file.stat().st_size < 5000:
                            img_file.unlink()
                            continue

                        seq_num = current_count + downloaded + 1
                        filename = f"instagram_{seq_num:04d}.jpg"
                        dest_path = RAW_DIR / filename

                        shutil.move(str(img_file), str(dest_path))
                        downloaded += 1
                        posts_collected += 1

                        # 메타데이터 기록
                        meta["images"][filename] = {
                            "source_url": f"https://www.instagram.com/p/{post.shortcode}/",
                            "shortcode": post.shortcode,
                            "source_site": "instagram",
                            "hashtag": hashtag,
                            "likes": post.likes,
                            "caption": (post.caption[:200] if post.caption else ""),
                            "downloaded_at": datetime.now().isoformat(),
                            "file_size_bytes": dest_path.stat().st_size,
                        }
                        save_metadata(meta)

                        print(f"   ✅ [{downloaded}] {filename} (♥ {post.likes})")
                        break  # 첫 번째 이미지만

                    # 임시 파일 정리
                    for f in TEMP_DIR.iterdir():
                        if f.is_file():
                            f.unlink()

                except instaloader.exceptions.ConnectionException as e:
                    if "429" in str(e) or "rate" in str(e).lower():
                        print(f"   ⚠️ 속도 제한 감지 — 60초 대기...")
                        time.sleep(60)
                    else:
                        print(f"   ⚠️ 연결 오류: {e}")
                        time.sleep(10)

                except Exception as e:
                    print(f"   ⚠️ 게시물 처리 오류: {e}")

                # 요청 간격
                time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))

        except instaloader.exceptions.QueryReturnedNotFoundException:
            print(f"   ⚠️ #{hashtag} 해시태그를 찾을 수 없음")
        except instaloader.exceptions.ConnectionException as e:
            print(f"   ⚠️ 연결 오류: {e}")
            print(f"      30초 대기 후 다음 해시태그로...")
            time.sleep(30)
        except Exception as e:
            print(f"   ❌ #{hashtag} 수집 실패: {e}")

        print(f"   📸 #{hashtag} 수집: {posts_collected}장")

    # 임시 폴더 정리
    if TEMP_DIR.exists():
        shutil.rmtree(TEMP_DIR, ignore_errors=True)

    # 최종 요약
    print("\n" + "=" * 60)
    print("  📋 인스타그램 수집 결과")
    print("=" * 60)
    print(f"   새로 다운로드: {downloaded}장")
    print(f"   총 수집:       {current_count + downloaded}장")
    print(f"   저장 위치:     {RAW_DIR}")
    print(f"   메타데이터:    {META_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    crawl_instagram()
