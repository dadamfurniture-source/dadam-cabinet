"""피드백 루프 자동화 워커 — 주기적 실행 태스크

Cron Schedule (권장):
- embed_completed_projects: 매 시간 (0 * * * *)
- calibrate_prices: 매일 03:00 (0 3 * * *)
- analyze_as_patterns: 매주 월 06:00 (0 6 * * 1)
- check_lora_trigger: 매일 04:00 (0 4 * * *)
- cleanup_old_training: 매월 1일 (0 0 1 * *)

실행: python -m workers.feedback_cron <task_name>
"""

import asyncio
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent.parent))

from shared.config import settings
from shared.supabase_client import get_service_client

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

OPENAI_API_KEY = settings.openai_api_key
REPLICATE_API_TOKEN = settings.replicate_api_token


async def _get_embedding(text: str) -> list[float] | None:
    """OpenAI embedding (None on failure)"""
    if not OPENAI_API_KEY:
        return None
    try:
        async with httpx.AsyncClient() as c:
            resp = await c.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={"model": "text-embedding-3-small", "input": text},
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]
    except Exception as e:
        logger.warning(f"Embedding failed: {e}")
        return None


# ===== Task 1: RAG 임베딩 자동 생성 =====


async def embed_completed_projects():
    """완료된 프로젝트 중 임베딩 없는 사례를 자동 임베딩.

    Trigger: 매 시간 or 프로젝트 완료 이벤트
    """
    client = get_service_client()

    # 임베딩 없는 사례 조회
    cases = (
        client.table("case_embeddings")
        .select("id, category, style, space_summary, layout_summary")
        .is_("embedding", "null")
        .limit(50)
        .execute()
    )

    if not cases.data:
        logger.info("No cases need embedding")
        return {"processed": 0}

    processed = 0
    for case in cases.data:
        text = (
            f"Category: {case['category']}\n"
            f"Style: {case.get('style', 'unknown')}\n"
            f"Space: {case['space_summary']}\n"
            f"Layout: {case.get('layout_summary', '')}"
        )
        embedding = await _get_embedding(text)
        if embedding:
            client.table("case_embeddings").update(
                {
                    "embedding": embedding,
                }
            ).eq("id", case["id"]).execute()
            processed += 1

    logger.info(f"Embedded {processed}/{len(cases.data)} cases")
    return {"processed": processed, "total": len(cases.data)}


# ===== Task 2: 가격 보정 자동 실행 =====


async def calibrate_prices():
    """견적 정확도 뷰 기반 보정 계수 재계산.

    Trigger: 매일 03:00 or 누적 거래 50건마다
    """
    client = get_service_client()

    accuracy_data = client.table("quote_accuracy").select("*").execute()

    if not accuracy_data.data or len(accuracy_data.data) < 10:
        logger.info(f"Not enough data for calibration: {len(accuracy_data.data or [])} records")
        return {"calibrated": 0, "reason": "insufficient_data"}

    from collections import defaultdict

    by_category = defaultdict(list)
    for row in accuracy_data.data:
        by_category[row["category"]].append(row["error_rate_pct"])

    calibrated = 0
    for cat, errors in by_category.items():
        if len(errors) < 5:
            continue

        avg_error = sum(errors) / len(errors)
        std_error = (sum((e - avg_error) ** 2 for e in errors) / len(errors)) ** 0.5
        correction = round(1 + (avg_error / 100), 4)

        # Clamp to reasonable range
        correction = max(0.7, min(1.5, correction))

        existing = (
            client.table("price_calibrations")
            .select("id, calibration_history")
            .eq("category", cat)
            .eq("region", "default")
            .is_("module_type", "null")
            .execute()
        )

        history_entry = {
            "date": datetime.now(timezone.utc).isoformat(),
            "factor": correction,
            "samples": len(errors),
            "avg_error": round(avg_error, 2),
        }

        if existing.data:
            old_history = existing.data[0].get("calibration_history") or []
            old_history.append(history_entry)
            # Keep last 24 entries
            old_history = old_history[-24:]
            client.table("price_calibrations").update(
                {
                    "correction_factor": correction,
                    "sample_count": len(errors),
                    "avg_error_rate": round(avg_error, 4),
                    "std_error_rate": round(std_error, 4),
                    "last_calibrated_at": datetime.now(timezone.utc).isoformat(),
                    "calibration_history": old_history,
                }
            ).eq("id", existing.data[0]["id"]).execute()
        else:
            client.table("price_calibrations").insert(
                {
                    "category": cat,
                    "region": "default",
                    "correction_factor": correction,
                    "sample_count": len(errors),
                    "avg_error_rate": round(avg_error, 4),
                    "std_error_rate": round(std_error, 4),
                    "calibration_history": [history_entry],
                }
            ).execute()

        calibrated += 1
        logger.info(
            f"  {cat}: correction={correction}, avg_error={avg_error:.2f}%, samples={len(errors)}"
        )

    logger.info(f"Calibrated {calibrated} categories")
    return {"calibrated": calibrated}


# ===== Task 3: A/S 패턴 분석 + 제약조건 제안 =====


async def analyze_as_patterns():
    """A/S 반복 패턴을 감지하고 제약조건을 자동 제안.

    Trigger: 매주 월요일 06:00
    """
    client = get_service_client()

    patterns = client.table("as_pattern_analysis").select("*").execute()

    if not patterns.data:
        logger.info("No A/S patterns detected")
        return {"proposed": 0}

    # 기존 제약조건 확인
    existing = (
        client.table("learned_constraints")
        .select("rule_text")
        .in_("status", ["proposed", "approved", "applied"])
        .execute()
    )
    existing_texts = {c["rule_text"] for c in existing.data}

    proposed = 0
    for pattern in patterns.data:
        if pattern["occurrence_count"] < 3:
            continue

        # 규칙 텍스트 생성 (간단 템플릿)
        rule_text = (
            f"{pattern['category']} 카테고리에서 '{pattern['as_type']}' 유형 A/S가 "
            f"{pattern['occurrence_count']}건 반복 발생. 설계 시 주의 필요."
        )

        if rule_text in existing_texts:
            continue

        confidence = min(0.9, pattern["occurrence_count"] / 10)

        client.table("learned_constraints").insert(
            {
                "category": pattern["category"],
                "rule_text": rule_text,
                "rule_json": {
                    "as_type": pattern["as_type"],
                    "count": pattern["occurrence_count"],
                    "auto_generated": True,
                },
                "severity": "warning" if pattern["occurrence_count"] < 5 else "error",
                "source_type": "as_pattern",
                "source_tickets": pattern["ticket_ids"][:10],
                "source_count": pattern["occurrence_count"],
                "confidence": confidence,
                "status": "proposed",
            }
        ).execute()

        proposed += 1
        logger.info(f"  Proposed: {rule_text[:60]}... (confidence={confidence:.2f})")

    logger.info(f"Proposed {proposed} new constraints")
    return {"proposed": proposed}


# ===== Task 4: LoRA 재학습 트리거 =====


async def check_lora_trigger():
    """카테고리별 학습 대기열이 50장 이상이면 재학습 트리거.

    Trigger: 매일 04:00
    """
    client = get_service_client()

    from shared.constants import CATEGORIES, LORA_MODELS

    triggered = []
    for category in CATEGORIES:
        pending = (
            client.table("training_queue")
            .select("id, image_url", count="exact")
            .eq("category", category)
            .eq("status", "pending")
            .gte("quality_grade", "normal")
            .execute()
        )

        count = pending.count or 0
        if count < 50:
            continue

        # 현재 활성 모델 조회
        active = (
            client.table("lora_model_versions")
            .select("version")
            .eq("category", category)
            .eq("is_active", True)
            .execute()
        )
        next_version = (active.data[0]["version"] + 1) if active.data else 1

        # 학습 이미지 URL 수집 (상위 50장)
        images = (
            client.table("training_queue")
            .select("id, image_url")
            .eq("category", category)
            .eq("status", "pending")
            .order("quality_grade", desc=True)
            .order("customer_rating", desc=True)
            .limit(50)
            .execute()
        )

        image_urls = [img["image_url"] for img in images.data]
        image_ids = [img["id"] for img in images.data]

        # 상태 일괄 업데이트
        client.table("training_queue").update(
            {
                "status": "training",
            }
        ).in_("id", image_ids).execute()

        # 새 모델 버전 레코드
        lora_key = LORA_MODELS.get(category, category)
        trigger_word = f"DADAM_{lora_key.upper()}"

        client.table("lora_model_versions").insert(
            {
                "category": category,
                "version": next_version,
                "replicate_model_id": f"dadamfurniture-source/{lora_key}:v{next_version}",
                "trigger_word": trigger_word,
                "training_images_count": len(image_urls),
                "is_active": False,
                "notes": f"Auto-triggered: {count} images pending",
            }
        ).execute()

        # TODO: Replicate API 호출로 실제 학습 시작
        # training = replicate.trainings.create(...)

        triggered.append(
            {
                "category": category,
                "version": next_version,
                "images": len(image_urls),
                "trigger_word": trigger_word,
            }
        )
        logger.info(
            f"  Triggered LoRA training: {category} v{next_version} ({len(image_urls)} images)"
        )

    logger.info(f"Triggered {len(triggered)} LoRA trainings")
    return {"triggered": triggered}


# ===== Task 5: 오래된 학습 데이터 정리 =====


async def cleanup_old_training():
    """6개월 이상 된 rejected/trained 이미지 정리.

    Trigger: 매월 1일
    """
    client = get_service_client()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=180)).isoformat()

    # trained 상태 이미지 → 참조만 유지, URL은 비움 (storage 정리)
    trained = (
        client.table("training_queue")
        .select("id", count="exact")
        .eq("status", "trained")
        .lt("created_at", cutoff)
        .execute()
    )

    # rejected는 삭제
    rejected = (
        client.table("training_queue")
        .select("id", count="exact")
        .eq("status", "rejected")
        .lt("created_at", cutoff)
        .execute()
    )

    if rejected.data:
        rejected_ids = [r["id"] for r in rejected.data]
        client.table("training_queue").delete().in_("id", rejected_ids).execute()

    logger.info(
        f"Cleanup: {rejected.count or 0} rejected deleted, {trained.count or 0} old trained records"
    )
    return {"deleted_rejected": rejected.count or 0, "old_trained": trained.count or 0}


# ===== Task 6: 프로젝트 완료 시 자동 사례 등록 =====


async def auto_register_completed_cases():
    """완료된 프로젝트 중 사례 DB에 없는 것을 자동 등록.

    Trigger: 매 시간 (embed_completed_projects와 함께)
    """
    client = get_service_client()

    # completed 상태이면서 case_embeddings에 없는 프로젝트
    completed = (
        client.table("projects")
        .select("id, category, style, user_id")
        .eq("status", "completed")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )

    if not completed.data:
        return {"registered": 0}

    project_ids = [p["id"] for p in completed.data]

    existing_cases = (
        client.table("case_embeddings")
        .select("project_id")
        .in_("project_id", project_ids)
        .execute()
    )
    existing_ids = {c["project_id"] for c in existing_cases.data}

    registered = 0
    for project in completed.data:
        if project["id"] in existing_ids:
            continue

        # 공간 분석 + 레이아웃 조회
        analysis = (
            client.table("space_analyses")
            .select("analysis_json")
            .eq("project_id", project["id"])
            .limit(1)
            .execute()
        )
        layout = (
            client.table("layouts")
            .select("layout_json")
            .eq("project_id", project["id"])
            .limit(1)
            .execute()
        )

        analysis_json = analysis.data[0].get("analysis_json") if analysis.data else None
        layout_json = layout.data[0].get("layout_json") if layout.data else None

        space_summary = "N/A"
        if analysis_json:
            if isinstance(analysis_json, str):
                analysis_json = json.loads(analysis_json)
            dims = analysis_json.get("dimensions", {})
            space_summary = (
                f"{dims.get('width', '?')}mm x {dims.get('depth', '?')}mm {project['category']}"
            )

        layout_summary = ""
        if layout_json:
            if isinstance(layout_json, str):
                layout_json = json.loads(layout_json)
            modules = layout_json.get("modules", [])
            layout_summary = ", ".join(
                f"{m.get('width_mm', '?')}mm {m.get('type', 'module')}" for m in modules[:5]
            )

        client.table("case_embeddings").insert(
            {
                "project_id": project["id"],
                "category": project["category"],
                "style": project.get("style"),
                "space_summary": space_summary,
                "layout_summary": layout_summary,
                "is_installed": False,
                "space_analysis_json": analysis_json,
                "layout_json": layout_json,
            }
        ).execute()
        registered += 1

    logger.info(f"Registered {registered} new cases")
    return {"registered": registered}


# ===== CLI Runner =====


TASKS = {
    "embed": embed_completed_projects,
    "calibrate": calibrate_prices,
    "as_patterns": analyze_as_patterns,
    "lora_trigger": check_lora_trigger,
    "cleanup": cleanup_old_training,
    "register_cases": auto_register_completed_cases,
    "all_hourly": None,  # special: runs hourly tasks
    "all_daily": None,  # special: runs daily tasks
}


async def run_hourly():
    """매 시간 실행 태스크"""
    results = {}
    results["register_cases"] = await auto_register_completed_cases()
    results["embed"] = await embed_completed_projects()
    return results


async def run_daily():
    """매일 실행 태스크"""
    results = {}
    results["calibrate"] = await calibrate_prices()
    results["lora_trigger"] = await check_lora_trigger()
    return results


async def main():
    if len(sys.argv) < 2:
        print("Usage: python -m workers.feedback_cron <task>")
        print(f"Tasks: {', '.join(TASKS.keys())}")
        sys.exit(1)

    task_name = sys.argv[1]

    if task_name == "all_hourly":
        result = await run_hourly()
    elif task_name == "all_daily":
        result = await run_daily()
    elif task_name in TASKS:
        result = await TASKS[task_name]()
    else:
        print(f"Unknown task: {task_name}")
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
