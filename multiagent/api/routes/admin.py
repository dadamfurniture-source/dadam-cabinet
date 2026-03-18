"""관리자 API — 피드백 루프 관리 + 제약조건 승인 + 수동 트리거"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth import CurrentUser, get_current_user, require_admin
from api.schemas.common import APIResponse
from shared.supabase_client import get_service_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["Admin"])


# ===== 제약조건 관리 =====


class ConstraintAction(BaseModel):
    action: str  # approve, reject, apply, deprecate
    reason: str | None = None


@router.get("/constraints", response_model=APIResponse)
async def list_constraints(
    status: str | None = None,
    category: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    """학습된 제약조건 목록 (Pro+)"""
    require_admin(user)
    client = get_service_client()

    query = client.table("learned_constraints").select("*").order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    if category:
        query = query.eq("category", category)

    result = query.execute()
    return APIResponse(data={"items": result.data, "total": len(result.data)})


@router.put("/constraints/{constraint_id}", response_model=APIResponse)
async def update_constraint(
    constraint_id: str,
    body: ConstraintAction,
    user: CurrentUser = Depends(get_current_user),
):
    """제약조건 승인/거부/적용/폐기 (Pro+)"""
    require_admin(user)
    client = get_service_client()

    constraint = (
        client.table("learned_constraints").select("*").eq("id", constraint_id).single().execute()
    )
    if not constraint.data:
        raise HTTPException(404, "제약조건을 찾을 수 없습니다.")

    valid_actions = {
        "approve": {"from": ["proposed"], "to": "approved"},
        "reject": {"from": ["proposed", "approved"], "to": "rejected"},
        "apply": {"from": ["approved"], "to": "applied"},
        "deprecate": {"from": ["applied"], "to": "deprecated"},
    }

    if body.action not in valid_actions:
        raise HTTPException(400, f"유효하지 않은 액션: {body.action}")

    rule = valid_actions[body.action]
    if constraint.data["status"] not in rule["from"]:
        raise HTTPException(
            400,
            f"'{constraint.data['status']}' 상태에서 '{body.action}'할 수 없습니다.",
        )

    update_data = {"status": rule["to"]}
    if body.action == "approve":
        update_data["approved_by"] = user.id
        update_data["approved_at"] = datetime.now(timezone.utc).isoformat()
    elif body.action == "apply":
        update_data["applied_at"] = datetime.now(timezone.utc).isoformat()
    elif body.action == "reject":
        update_data["rejected_reason"] = body.reason

    client.table("learned_constraints").update(update_data).eq("id", constraint_id).execute()

    return APIResponse(
        message=f"제약조건이 '{rule['to']}' 상태로 변경되었습니다.",
        data={"id": constraint_id, "new_status": rule["to"]},
    )


# ===== LoRA 모델 관리 =====


@router.get("/lora-models", response_model=APIResponse)
async def list_lora_models(
    category: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    """LoRA 모델 버전 목록 (Pro+)"""
    require_admin(user)
    client = get_service_client()

    query = (
        client.table("lora_model_versions")
        .select("*")
        .order("category")
        .order("version", desc=True)
    )
    if category:
        query = query.eq("category", category)

    result = query.execute()
    return APIResponse(data={"models": result.data})


@router.post("/lora-models/{model_id}/activate", response_model=APIResponse)
async def activate_lora_model(
    model_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """LoRA 모델 활성화 (기존 활성 모델 비활성화) (Pro+)"""
    require_admin(user)
    client = get_service_client()

    model = client.table("lora_model_versions").select("*").eq("id", model_id).single().execute()
    if not model.data:
        raise HTTPException(404, "모델을 찾을 수 없습니다.")

    category = model.data["category"]

    # 기존 활성 모델 비활성화
    client.table("lora_model_versions").update(
        {
            "is_active": False,
        }
    ).eq("category", category).eq("is_active", True).execute()

    # 새 모델 활성화
    client.table("lora_model_versions").update(
        {
            "is_active": True,
            "activated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", model_id).execute()

    return APIResponse(
        message=f"{category} v{model.data['version']} 모델이 활성화되었습니다.",
        data={"category": category, "version": model.data["version"]},
    )


# ===== 학습 대기열 관리 =====


@router.get("/training-queue", response_model=APIResponse)
async def get_training_queue(
    category: str | None = None,
    status: str = "pending",
    user: CurrentUser = Depends(get_current_user),
):
    """LoRA 학습 대기열 조회 (Pro+)"""
    require_admin(user)
    client = get_service_client()

    query = (
        client.table("training_queue")
        .select("*", count="exact")
        .eq("status", status)
        .order("created_at", desc=True)
        .limit(50)
    )
    if category:
        query = query.eq("category", category)

    result = query.execute()

    # 카테고리별 카운트
    all_pending = (
        client.table("training_queue")
        .select("category", count="exact")
        .eq("status", "pending")
        .execute()
    )
    by_category = {}
    for item in all_pending.data:
        cat = item["category"]
        by_category[cat] = by_category.get(cat, 0) + 1

    return APIResponse(
        data={
            "items": result.data,
            "total": result.count or 0,
            "by_category": by_category,
            "trigger_threshold": 50,
        }
    )


# ===== 수동 트리거 =====


class TriggerRequest(BaseModel):
    task: str  # embed, calibrate, as_patterns, lora_trigger


@router.post("/trigger", response_model=APIResponse)
async def manual_trigger(
    body: TriggerRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """피드백 루프 태스크 수동 트리거 (Pro+)"""
    require_admin(user)

    from workers.feedback_cron import (
        analyze_as_patterns,
        auto_register_completed_cases,
        calibrate_prices,
        check_lora_trigger,
        embed_completed_projects,
    )

    task_map = {
        "embed": embed_completed_projects,
        "calibrate": calibrate_prices,
        "as_patterns": analyze_as_patterns,
        "lora_trigger": check_lora_trigger,
        "register_cases": auto_register_completed_cases,
    }

    if body.task not in task_map:
        raise HTTPException(
            400, f"유효하지 않은 태스크: {body.task}. 가능: {list(task_map.keys())}"
        )

    try:
        result = await task_map[body.task]()
    except Exception as e:
        logger.error(f"Manual trigger failed: {body.task} / {e}")
        raise HTTPException(500, f"태스크 실행 실패: {body.task}")

    return APIResponse(
        message=f"태스크 '{body.task}'가 실행되었습니다.",
        data=result,
    )


# ===== 가격 보정 현황 =====


@router.get("/calibrations", response_model=APIResponse)
async def list_calibrations(
    user: CurrentUser = Depends(get_current_user),
):
    """가격 보정 계수 현황 (Pro+)"""
    require_admin(user)
    client = get_service_client()

    result = client.table("price_calibrations").select("*").order("category").execute()

    return APIResponse(data={"calibrations": result.data})
