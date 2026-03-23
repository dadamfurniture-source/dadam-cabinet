"""
전체 파이프라인 실행 스크립트
==============================
1단계: 크롤링 (오늘의집 → 네이버 → 핀터레스트)
2단계: AI 스타일 분류 (classifier.py)

각 단계는 독립적으로 실행 가능하며, 중단 후 재실행 시
체크포인트 기반으로 이어서 진행됩니다.

사용법:
    python run_all.py              # 전체 파이프라인
    python run_all.py --crawl-only # 크롤링만
    python run_all.py --classify-only # 분류만
"""

import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime

SCRIPTS_DIR = Path(__file__).resolve().parent


def run_script(script_name: str) -> bool:
    """하위 스크립트 실행"""
    script_path = SCRIPTS_DIR / script_name

    if not script_path.exists():
        print(f"❌ 스크립트를 찾을 수 없습니다: {script_path}")
        return False

    print(f"\n{'='*60}")
    print(f"  🚀 실행: {script_name}")
    print(f"  ⏰ 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            cwd=str(SCRIPTS_DIR),
            timeout=7200,  # 2시간 타임아웃
        )

        if result.returncode == 0:
            print(f"\n✅ {script_name} 완료")
            return True
        else:
            print(f"\n⚠️ {script_name} 종료 (코드: {result.returncode})")
            return False

    except subprocess.TimeoutExpired:
        print(f"\n⏰ {script_name} 타임아웃 (2시간 초과)")
        return False
    except KeyboardInterrupt:
        print(f"\n🛑 사용자에 의해 중단됨")
        return False
    except Exception as e:
        print(f"\n❌ {script_name} 실행 오류: {e}")
        return False


def check_dependencies():
    """의존성 확인"""
    print("🔍 의존성 확인 중...\n")

    missing = []

    # Python 패키지 확인
    packages = {
        "playwright": "playwright",
        "requests": "requests",
        "anthropic": "anthropic",
    }

    for import_name, pip_name in packages.items():
        try:
            __import__(import_name)
            print(f"   ✅ {pip_name}")
        except ImportError:
            print(f"   ❌ {pip_name} — 설치 필요")
            missing.append(pip_name)

    # Playwright 브라우저 확인
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            browser.close()
        print(f"   ✅ chromium 브라우저")
    except Exception:
        print(f"   ❌ chromium 브라우저 — 'playwright install chromium' 실행 필요")
        missing.append("playwright-chromium")

    if missing:
        print(f"\n❌ 누락된 의존성이 있습니다:")
        for m in missing:
            if m == "playwright-chromium":
                print(f"   playwright install chromium")
            else:
                print(f"   pip install {m}")

        answer = input("\n자동으로 설치할까요? (y/n): ").strip().lower()
        if answer == "y":
            for m in missing:
                if m == "playwright-chromium":
                    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"])
                else:
                    subprocess.run([sys.executable, "-m", "pip", "install", m])
            print("\n✅ 의존성 설치 완료")
        else:
            print("\n수동 설치 후 다시 실행해주세요.")
            sys.exit(1)
    else:
        print("\n✅ 모든 의존성 확인 완료")


def main():
    start_time = time.time()

    print("=" * 60)
    print("  🏠 한국형 주방 이미지 수집 & 분류 파이프라인")
    print(f"  ⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # 실행 모드 결정
    crawl_only = "--crawl-only" in sys.argv
    classify_only = "--classify-only" in sys.argv

    # 의존성 확인
    check_dependencies()

    results = {}

    # ─── 1단계: 크롤링 ───
    if not classify_only:
        print("\n\n" + "=" * 60)
        print("  📦 1단계: 이미지 크롤링")
        print("=" * 60)

        crawlers = [
            ("ohouse_crawler.py", "오늘의집"),
            ("naver_crawler.py", "네이버"),
            ("pinterest_crawler.py", "핀터레스트"),
        ]

        for script, name in crawlers:
            results[name] = run_script(script)
            time.sleep(3)  # 크롤러 간 쿨다운

    # ─── 2단계: AI 분류 ───
    if not crawl_only:
        print("\n\n" + "=" * 60)
        print("  🤖 2단계: AI 스타일 분류")
        print("=" * 60)

        results["AI 분류"] = run_script("classifier.py")

    # ─── 최종 요약 ───
    elapsed = time.time() - start_time
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)

    print("\n\n" + "=" * 60)
    print("  📋 파이프라인 실행 결과")
    print("=" * 60)

    for name, success in results.items():
        status = "✅ 성공" if success else "⚠️ 실패/부분완료"
        print(f"   {name:15s}: {status}")

    print(f"\n   총 소요시간: {hours}시간 {minutes}분")
    print(f"   결과 위치:   {SCRIPTS_DIR.parent}")
    print("=" * 60)


if __name__ == "__main__":
    main()
