"""
한국형 주방 이미지 스타일 자동 분류기
=====================================
raw/ 폴더의 이미지를 Claude Vision API로 분석하여
6가지 스타일로 classified/ 하위 폴더에 자동 분류합니다.

스타일: modern, nordic, classic, natural, industrial, luxury

기능:
- 체크포인트 기반 재개(resume): 인터넷 끊김 후 이어서 처리
- API 호출 실패 시 자동 재시도 (최대 3회, 지수 백오프)
- 분류 결과 및 신뢰도를 metadata/classification_result.json에 기록
"""

import anthropic
import base64
import json
import shutil
import time
import sys
from pathlib import Path
from datetime import datetime

# ──────────────────────────────────────────────
# 설정
# ──────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "raw"
CLASSIFIED_DIR = BASE_DIR / "classified"
METADATA_DIR = BASE_DIR / "metadata"
RESULT_FILE = METADATA_DIR / "classification_result.json"

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}

STYLES = ["modern", "nordic", "classic", "natural", "industrial", "luxury"]

MAX_RETRIES = 3          # API 호출 최대 재시도 횟수
RETRY_BASE_DELAY = 2     # 재시도 기본 대기 시간(초)
API_CALL_INTERVAL = 1.5  # API 호출 간격(초) - 속도 제한 방지

# ──────────────────────────────────────────────
# 스타일 분류 기준 (프롬프트에 주입)
# ──────────────────────────────────────────────
STYLE_GUIDE = """
아래 6가지 한국형 주방 인테리어 스타일 중 하나로 분류하세요.

1. modern (모던): 직선적 디자인, 광택 마감, 미니멀한 구성. 화이트/블랙/그레이 색상. 하이그로시, 유리, 스테인리스 소재.
2. nordic (북유럽): 원목 느낌, 따뜻하고 심플한 구성. 베이지/화이트/오크톤. 원목, 린넨, 세라믹 소재.
3. classic (클래식): 몰딩, 장식적 요소, 대칭 구성. 아이보리/골드/다크브라운. 원목, 대리석, 황동 소재.
4. natural (내추럴): 자연소재 중심, 따뜻한 텍스처. 테라코타/그린/베이지. 원목, 등나무, 돌 소재.
5. industrial (인더스트리얼): 노출 구조, 금속 요소, 빈티지 감성. 블랙/다크그레이/브라운. 철제, 고재, 콘크리트 소재.
6. luxury (럭셔리): 고급 소재, 넓은 공간감, 프리미엄 마감. 대리석 상판, 골드/로즈골드 하드웨어, 고광택 마감, 빌트인 고급 가전, 넓은 아일랜드.
""".strip()

CLASSIFICATION_PROMPT = f"""이 주방 이미지의 인테리어 스타일을 분류해주세요.

{STYLE_GUIDE}

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 포함하지 마세요.
{{"style": "modern|nordic|classic|natural|industrial|luxury 중 하나", "confidence": 0.0~1.0, "reason": "분류 근거 간단 설명"}}
"""


# ──────────────────────────────────────────────
# 유틸리티 함수
# ──────────────────────────────────────────────
def load_results() -> dict:
    """기존 분류 결과 로드 (체크포인트 역할)"""
    if RESULT_FILE.exists():
        with open(RESULT_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"created_at": datetime.now().isoformat(), "images": {}}


def save_results(results: dict):
    """분류 결과 저장"""
    results["updated_at"] = datetime.now().isoformat()
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(RESULT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


def encode_image(image_path: Path) -> tuple[str, str]:
    """이미지를 base64로 인코딩하고 미디어 타입 반환"""
    ext = image_path.suffix.lower()
    media_type_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
    }
    media_type = media_type_map.get(ext, "image/jpeg")
    with open(image_path, "rb") as f:
        data = base64.standard_b64encode(f.read()).decode("utf-8")
    return data, media_type


def call_claude_vision(client: anthropic.Anthropic, image_path: Path) -> dict:
    """
    Claude Vision API를 호출하여 이미지 스타일 분류.
    최대 MAX_RETRIES회 재시도 (지수 백오프).
    """
    image_data, media_type = encode_image(image_path)

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=300,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": CLASSIFICATION_PROMPT,
                            },
                        ],
                    }
                ],
            )

            # JSON 파싱
            raw_text = response.content[0].text.strip()
            # JSON 블록만 추출 (```json ... ``` 감싸기 대응)
            if "```" in raw_text:
                raw_text = raw_text.split("```")[1]
                if raw_text.startswith("json"):
                    raw_text = raw_text[4:]
                raw_text = raw_text.strip()

            result = json.loads(raw_text)

            # 유효성 검증
            if result.get("style") not in STYLES:
                print(f"  ⚠️  알 수 없는 스타일 '{result.get('style')}' → 재시도")
                continue

            return result

        except (anthropic.APIConnectionError, anthropic.RateLimitError) as e:
            delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
            print(f"  ⚠️  네트워크/속도제한 오류 (시도 {attempt}/{MAX_RETRIES}): {e}")
            print(f"      {delay}초 후 재시도...")
            time.sleep(delay)

        except (json.JSONDecodeError, KeyError, IndexError) as e:
            print(f"  ⚠️  응답 파싱 오류 (시도 {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BASE_DELAY)

        except Exception as e:
            print(f"  ❌ 예상치 못한 오류 (시도 {attempt}/{MAX_RETRIES}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BASE_DELAY)

    # 모든 재시도 실패
    return {"style": "unknown", "confidence": 0.0, "reason": f"분류 실패 ({MAX_RETRIES}회 재시도 후)"}


# ──────────────────────────────────────────────
# 메인 실행
# ──────────────────────────────────────────────
def main():
    print("=" * 60)
    print("  한국형 주방 이미지 스타일 자동 분류기")
    print("=" * 60)

    # 1) 이미지 목록 수집
    images = sorted([
        p for p in RAW_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    ])

    if not images:
        print(f"\n❌ raw/ 폴더에 이미지가 없습니다: {RAW_DIR}")
        print("   주방 이미지를 raw/ 폴더에 넣은 후 다시 실행하세요.")
        sys.exit(0)

    # 2) 기존 결과 로드 (체크포인트)
    results = load_results()
    already_done = set(results.get("images", {}).keys())

    # 미처리 이미지 필터링
    pending = [img for img in images if img.name not in already_done]

    print(f"\n📊 현황:")
    print(f"   전체 이미지: {len(images)}장")
    print(f"   처리 완료:   {len(already_done)}장")
    print(f"   미처리:      {len(pending)}장")

    if not pending:
        print("\n✅ 모든 이미지가 이미 분류되었습니다.")
        print_summary(results)
        return

    # 3) Claude API 클라이언트 초기화
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용

    # 4) 분류 실행
    print(f"\n🚀 분류 시작 ({len(pending)}장)...\n")

    for idx, img_path in enumerate(pending, 1):
        print(f"[{idx}/{len(pending)}] {img_path.name} 분류 중...")

        result = call_claude_vision(client, img_path)
        style = result.get("style", "unknown")
        confidence = result.get("confidence", 0.0)
        reason = result.get("reason", "")

        # 분류 폴더로 복사
        if style in STYLES:
            dest_dir = CLASSIFIED_DIR / style
            dest_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(img_path, dest_dir / img_path.name)
            print(f"   ✅ {style} (신뢰도: {confidence:.1%}) — {reason}")
        else:
            print(f"   ⚠️  분류 실패 — {reason}")

        # 메타데이터 기록 (매 이미지마다 저장 = 체크포인트)
        results["images"][img_path.name] = {
            "style": style,
            "confidence": confidence,
            "reason": reason,
            "source_path": str(img_path),
            "classified_at": datetime.now().isoformat(),
        }
        save_results(results)

        # API 속도 제한 방지
        if idx < len(pending):
            time.sleep(API_CALL_INTERVAL)

    # 5) 최종 요약
    print_summary(results)


def print_summary(results: dict):
    """스타일별 분류 결과 요약 출력"""
    print("\n" + "=" * 60)
    print("  📋 분류 결과 요약")
    print("=" * 60)

    style_counts = {}
    style_confidences = {}
    low_confidence = []

    for name, info in results.get("images", {}).items():
        style = info.get("style", "unknown")
        conf = info.get("confidence", 0.0)

        style_counts[style] = style_counts.get(style, 0) + 1
        style_confidences.setdefault(style, []).append(conf)

        if conf < 0.6:
            low_confidence.append((name, style, conf))

    for style in STYLES + ["unknown"]:
        count = style_counts.get(style, 0)
        if count > 0:
            avg_conf = sum(style_confidences[style]) / len(style_confidences[style])
            print(f"   {style:15s}: {count:4d}장  (평균 신뢰도: {avg_conf:.1%})")

    total = sum(style_counts.values())
    print(f"   {'합계':15s}: {total:4d}장")

    if low_confidence:
        print(f"\n   ⚠️  낮은 신뢰도 (0.6 미만): {len(low_confidence)}장")
        for name, style, conf in low_confidence[:10]:
            print(f"      - {name} → {style} ({conf:.1%})")
        if len(low_confidence) > 10:
            print(f"      ... 외 {len(low_confidence) - 10}장")

    print(f"\n   결과 파일: {RESULT_FILE}")
    print("=" * 60)


if __name__ == "__main__":
    main()
