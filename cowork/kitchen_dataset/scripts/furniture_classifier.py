"""
가구 카테고리별 스타일 자동 분류기
====================================
furniture_dataset/{category}/raw/ 이미지를 Claude Vision API로
6가지 스타일(modern, nordic, classic, natural, industrial, luxury)로 분류합니다.

8개 카테고리 전 품목을 순차 처리하며, 카테고리별 체크포인트로 중단 후 재개 가능합니다.

사용법:
    python furniture_classifier.py                          # 전 품목 분류
    python furniture_classifier.py --category wardrobe      # 특정 품목만
    python furniture_classifier.py --model claude-haiku-4-5-20251001  # 모델 변경
"""

import anthropic
import base64
import json
import time
import sys
import os
import argparse
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv

# Windows cp949 인코딩 문제 방지
if sys.platform == "win32":
    os.environ["PYTHONIOENCODING"] = "utf-8"
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# .env 파일에서 API 키 로드 (mcp-server/.env)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
ENV_FILE = PROJECT_ROOT / "mcp-server" / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
else:
    # 로컬 cowork 기준 경로도 시도
    for candidate in [
        Path("C:/Users/hchan/dadamagent/mcp-server/.env"),
        Path(__file__).resolve().parent.parent.parent / "mcp-server" / ".env",
    ]:
        if candidate.exists():
            load_dotenv(candidate)
            break

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
FURNITURE_DIR = BASE_DIR / "furniture_dataset"

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
STYLES = ["modern", "nordic", "classic", "natural", "industrial", "luxury"]

CATEGORIES = [
    "wardrobe", "shoe_cabinet", "vanity", "fridge_cabinet",
    "l_shaped_sink", "peninsula_sink", "island_kitchen", "storage_cabinet",
]

CATEGORY_NAMES_KR = {
    "wardrobe": "붙박이장",
    "shoe_cabinet": "신발장",
    "vanity": "화장대",
    "fridge_cabinet": "냉장고장",
    "l_shaped_sink": "ㄱ자 싱크대",
    "peninsula_sink": "대면형 싱크대",
    "island_kitchen": "아일랜드 주방",
    "storage_cabinet": "수납장",
}

DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2
API_CALL_INTERVAL = 1.5

# ──────────────────────────────────────────────
# 스타일 분류 프롬프트
# ──────────────────────────────────────────────
STYLE_GUIDE = """
아래 6가지 한국형 빌트인 가구 인테리어 스타일 중 하나로 분류하세요.

1. modern (모던): 직선적 디자인, 광택/무광 마감, 미니멀 구성. 화이트/블랙/그레이. 하이그로시, 유리, 메탈 소재.
2. nordic (북유럽): 원목 느낌, 따뜻하고 심플한 구성. 베이지/화이트/오크톤. 원목, 린넨, 세라믹.
3. classic (클래식): 몰딩, 장식적 요소, 대칭 구성. 아이보리/골드/다크브라운. 원목, 대리석, 황동.
4. natural (내추럴): 자연소재 중심, 따뜻한 텍스처. 테라코타/그린/베이지. 원목, 등나무, 돌.
5. industrial (인더스트리얼): 노출 구조, 금속 요소, 빈티지 감성. 블랙/다크그레이/브라운. 철제, 고재, 콘크리트.
6. luxury (럭셔리): 고급 소재, 프리미엄 마감. 대리석, 골드/로즈골드 하드웨어, 고광택, 빌트인 조명.
""".strip()


def make_prompt(category: str) -> str:
    kr_name = CATEGORY_NAMES_KR.get(category, category)
    return f"""이 {kr_name} 이미지의 인테리어 스타일을 분류해주세요.

{STYLE_GUIDE}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.
{{"style": "modern|nordic|classic|natural|industrial|luxury 중 하나", "confidence": 0.0~1.0, "reason": "분류 근거 간단 설명"}}"""


# ──────────────────────────────────────────────
# 유틸리티
# ──────────────────────────────────────────────
def get_result_file(category: str) -> Path:
    return FURNITURE_DIR / category / "metadata" / "classification_result.json"


def load_results(category: str) -> dict:
    result_file = get_result_file(category)
    if result_file.exists():
        with open(result_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"category": category, "created_at": datetime.now().isoformat(), "images": {}}


def save_results(category: str, results: dict):
    result_file = get_result_file(category)
    results["updated_at"] = datetime.now().isoformat()
    result_file.parent.mkdir(parents=True, exist_ok=True)
    with open(result_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


def detect_media_type(raw_bytes: bytes, ext: str) -> str:
    """파일 매직바이트로 실제 이미지 포맷 감지 (확장자 불일치 대응)"""
    if raw_bytes[:4] == b"RIFF" and raw_bytes[8:12] == b"WEBP":
        return "image/webp"
    if raw_bytes[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw_bytes[:2] == b"\xff\xd8":
        return "image/jpeg"
    if raw_bytes[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if raw_bytes[:2] in (b"BM",):
        return "image/bmp"
    # 매직바이트로 판별 불가 시 확장자 폴백
    ext_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
    }
    return ext_map.get(ext, "image/jpeg")


def encode_image(image_path: Path) -> tuple:
    ext = image_path.suffix.lower()
    with open(image_path, "rb") as f:
        raw_bytes = f.read()
    media_type = detect_media_type(raw_bytes, ext)

    # Claude API에서 지원하지 않는 포맷이면 Pillow로 PNG 변환
    supported = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if media_type not in supported:
        raw_bytes, media_type = convert_to_png(raw_bytes)

    data = base64.standard_b64encode(raw_bytes).decode("utf-8")
    return data, media_type


def convert_to_png(raw_bytes: bytes) -> tuple:
    """Pillow로 이미지를 PNG로 변환"""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(raw_bytes))
        img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue(), "image/png"
    except Exception:
        return raw_bytes, "image/jpeg"  # 변환 실패 시 원본 반환


def call_claude_vision(client: anthropic.Anthropic, image_path: Path, category: str, model: str) -> dict:
    image_data, media_type = encode_image(image_path)
    prompt = make_prompt(category)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=300,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_data}},
                        {"type": "text", "text": prompt},
                    ],
                }],
            )

            raw_text = response.content[0].text.strip()
            if "```" in raw_text:
                raw_text = raw_text.split("```")[1]
                if raw_text.startswith("json"):
                    raw_text = raw_text[4:]
                raw_text = raw_text.strip()

            result = json.loads(raw_text)

            if result.get("style") not in STYLES:
                print(f"  ⚠️  알 수 없는 스타일 '{result.get('style')}' → 재시도")
                continue

            return result

        except (anthropic.APIConnectionError, anthropic.RateLimitError) as e:
            delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
            print(f"  ⚠️  네트워크/속도제한 (시도 {attempt}/{MAX_RETRIES}): {e}")
            print(f"      {delay}초 후 재시도...")
            time.sleep(delay)

        except (json.JSONDecodeError, KeyError, IndexError) as e:
            print(f"  ⚠️  응답 파싱 오류 (시도 {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BASE_DELAY)

        except anthropic.BadRequestError as e:
            err_msg = str(e)
            # 이미지 포맷 문제 → Pillow로 PNG 변환 후 재시도
            if "Image format" in err_msg or "media type" in err_msg:
                if attempt == 1:
                    print(f"\n  ⚠️  이미지 포맷 오류 → PNG 변환 시도...")
                    try:
                        with open(image_path, "rb") as f:
                            raw_bytes = f.read()
                        converted, _ = convert_to_png(raw_bytes)
                        image_data = base64.standard_b64encode(converted).decode("utf-8")
                        media_type = "image/png"
                        continue  # 변환된 이미지로 재시도
                    except Exception:
                        pass
            print(f"  ❌ API 오류 (시도 {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BASE_DELAY)

        except Exception as e:
            print(f"  ❌ 예상치 못한 오류 (시도 {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BASE_DELAY)

    return {"style": "unknown", "confidence": 0.0, "reason": f"분류 실패 ({MAX_RETRIES}회 재시도 후)"}


# ──────────────────────────────────────────────
# 카테고리별 분류
# ──────────────────────────────────────────────
def classify_category(client: anthropic.Anthropic, category: str, model: str) -> dict:
    kr_name = CATEGORY_NAMES_KR.get(category, category)
    raw_dir = FURNITURE_DIR / category / "raw"

    print(f"\n{'='*60}")
    print(f"  📂 {kr_name} ({category})")
    print(f"{'='*60}")

    if not raw_dir.exists():
        print(f"  ❌ raw 폴더 없음: {raw_dir}")
        return {}

    images = sorted([
        p for p in raw_dir.iterdir()
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    ])

    if not images:
        print(f"  ❌ 이미지 없음")
        return {}

    results = load_results(category)
    already_done = set(results.get("images", {}).keys())
    pending = [img for img in images if img.name not in already_done]

    print(f"  📊 전체: {len(images)}장 | 완료: {len(already_done)}장 | 미처리: {len(pending)}장")

    if not pending:
        print(f"  ✅ 이미 모두 분류 완료")
        return results

    print(f"  🚀 분류 시작...\n")

    for idx, img_path in enumerate(pending, 1):
        print(f"  [{idx}/{len(pending)}] {img_path.name} ...", end=" ", flush=True)

        result = call_claude_vision(client, img_path, category, model)
        style = result.get("style", "unknown")
        confidence = result.get("confidence", 0.0)
        reason = result.get("reason", "")

        if style in STYLES:
            print(f"→ {style} ({confidence:.0%}) — {reason}")
        else:
            print(f"→ ⚠️ 분류 실패 — {reason}")

        results["images"][img_path.name] = {
            "style": style,
            "confidence": confidence,
            "reason": reason,
            "classified_at": datetime.now().isoformat(),
        }
        save_results(category, results)

        if idx < len(pending):
            time.sleep(API_CALL_INTERVAL)

    return results


# ──────────────────────────────────────────────
# 요약
# ──────────────────────────────────────────────
def print_category_summary(category: str, results: dict):
    kr_name = CATEGORY_NAMES_KR.get(category, category)
    images = results.get("images", {})
    if not images:
        return

    style_counts = {}
    for info in images.values():
        s = info.get("style", "unknown")
        style_counts[s] = style_counts.get(s, 0) + 1

    parts = [f"{s}:{c}" for s, c in sorted(style_counts.items(), key=lambda x: -x[1]) if c > 0]
    print(f"  {kr_name:10s} ({len(images):4d}장) → {', '.join(parts)}")


def print_grand_summary(all_results: dict):
    print(f"\n\n{'='*60}")
    print(f"  📋 전 품목 분류 결과 요약")
    print(f"{'='*60}\n")

    grand_total = 0
    grand_styles = {}

    for category in CATEGORIES:
        results = all_results.get(category, {})
        print_category_summary(category, results)

        for info in results.get("images", {}).values():
            s = info.get("style", "unknown")
            grand_styles[s] = grand_styles.get(s, 0) + 1
            grand_total += 1

    print(f"\n  {'─'*50}")
    print(f"  총 분류: {grand_total}장")

    for s in STYLES + ["unknown"]:
        c = grand_styles.get(s, 0)
        if c > 0:
            print(f"    {s:15s}: {c:4d}장 ({c/max(grand_total,1):.1%})")

    print(f"{'='*60}")


# ──────────────────────────────────────────────
# 메인
# ──────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="가구 카테고리별 스타일 분류기")
    parser.add_argument("--category", type=str, help="특정 카테고리만 처리")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Claude 모델 ID")
    args = parser.parse_args()

    categories = [args.category] if args.category else CATEGORIES

    # 유효성 검증
    for cat in categories:
        if cat not in CATEGORIES:
            print(f"❌ 알 수 없는 카테고리: {cat}")
            print(f"   사용 가능: {', '.join(CATEGORIES)}")
            sys.exit(1)

    start_time = time.time()

    print("=" * 60)
    print("  🪑 가구 카테고리별 스타일 분류기")
    print(f"  ⏰ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  🤖 모델: {args.model}")
    print(f"  📂 대상: {len(categories)}개 카테고리")
    print("=" * 60)

    client = anthropic.Anthropic()
    all_results = {}

    for cat in categories:
        all_results[cat] = classify_category(client, cat, args.model)

    # 최종 요약
    print_grand_summary(all_results)

    elapsed = time.time() - start_time
    hours = int(elapsed // 3600)
    minutes = int((elapsed % 3600) // 60)
    print(f"\n  총 소요시간: {hours}시간 {minutes}분")


if __name__ == "__main__":
    main()
