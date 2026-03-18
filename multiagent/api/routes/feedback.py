"""피드백 API — 고객 평가 수집 + 피드백 루프 대시보드"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.middleware.auth import CurrentUser, get_current_user, require_pro
from api.schemas.common import APIResponse
from shared.supabase_client import get_service_client

router = APIRouter(prefix="/feedback", tags=["Feedback"])


class FeedbackCreate(BaseModel):
    project_id: str | None = None
    order_id: str | None = None
    overall_rating: int  # 1~5
    design_rating: int | None = None
    image_rating: int | None = None
    quote_rating: int | None = None
    install_rating: int | None = None
    selected_style: str | None = None
    comment: str | None = None
    installation_photos: list[str] = []
    feedback_type: str = "simulation"


@router.post("", response_model=APIResponse)
async def submit_feedback(
    body: FeedbackCreate,
    user: CurrentUser = Depends(get_current_user),
):
    """고객 피드백 제출 — 4개 피드백 루프에 데이터 공급"""

    if not 1 <= body.overall_rating <= 5:
        raise HTTPException(400, "만족도는 1~5 사이여야 합니다.")

    client = get_service_client()

    # 1. 피드백 저장
    feedback = (
        client.table("customer_feedback")
        .insert(
            {
                "project_id": body.project_id,
                "order_id": body.order_id,
                "user_id": user.id,
                "overall_rating": body.overall_rating,
                "design_rating": body.design_rating,
                "image_rating": body.image_rating,
                "quote_rating": body.quote_rating,
                "install_rating": body.install_rating,
                "selected_style": body.selected_style,
                "comment": body.comment,
                "installation_photos": body.installation_photos,
                "feedback_type": body.feedback_type,
            }
        )
        .execute()
    )

    # 2. 사례 DB에 평점 업데이트 (RAG 루프 ①)
    if body.project_id:
        existing_case = (
            client.table("case_embeddings").select("id").eq("project_id", body.project_id).execute()
        )
        if existing_case.data:
            client.table("case_embeddings").update(
                {
                    "rating": body.overall_rating,
                }
            ).eq("project_id", body.project_id).execute()

    # 3. 시공 사진을 LoRA 학습 대기열에 등록 (루프 ②)
    if body.installation_photos and body.project_id:
        project = (
            client.table("projects")
            .select("category, style")
            .eq("id", body.project_id)
            .single()
            .execute()
        )
        if project.data:
            grade = (
                "excellent"
                if body.overall_rating >= 5
                else "high"
                if body.overall_rating >= 4
                else "normal"
            )
            for photo_url in body.installation_photos:
                client.table("training_queue").insert(
                    {
                        "image_url": photo_url,
                        "category": project.data["category"],
                        "style": project.data.get("style"),
                        "quality_grade": grade,
                        "source": "installation_photo",
                        "project_id": body.project_id,
                        "customer_rating": body.overall_rating,
                        "status": "pending",
                    }
                ).execute()

    return APIResponse(
        message="피드백이 등록되었습니다. 감사합니다!",
        data={"feedback_id": feedback.data[0]["id"] if feedback.data else None},
    )


@router.get("/stats", response_model=APIResponse)
async def get_feedback_stats(
    user: CurrentUser = Depends(get_current_user),
):
    """피드백 루프 현황 대시보드 (Pro+)"""
    require_pro(user)

    client = get_service_client()

    # RAG 사례 수
    cases = client.table("case_embeddings").select("id", count="exact").execute()

    # LoRA 학습 대기열
    training_pending = (
        client.table("training_queue")
        .select("category", count="exact")
        .eq("status", "pending")
        .execute()
    )

    # 활성 모델 수
    active_models = (
        client.table("lora_model_versions")
        .select("category, version")
        .eq("is_active", True)
        .execute()
    )

    # 가격 보정 현황
    calibrations = client.table("price_calibrations").select("*").execute()

    # 학습된 제약조건
    constraints = (
        client.table("learned_constraints").select("category, status", count="exact").execute()
    )
    applied_constraints = [c for c in constraints.data if c["status"] == "applied"]
    proposed_constraints = [c for c in constraints.data if c["status"] == "proposed"]

    # 평균 만족도
    feedbacks = client.table("customer_feedback").select("overall_rating").execute()
    avg_rating = (
        sum(f["overall_rating"] for f in feedbacks.data) / len(feedbacks.data)
        if feedbacks.data
        else 0
    )

    return APIResponse(
        data={
            "rag_loop": {
                "total_cases": cases.count or 0,
                "description": "유사 사례 검색용 벡터 DB",
            },
            "lora_loop": {
                "training_queue_pending": training_pending.count or 0,
                "active_models": len(active_models.data),
                "models": active_models.data,
                "description": "시공 사진 → LoRA 재학습",
            },
            "price_loop": {
                "calibrated_categories": len(calibrations.data),
                "calibrations": [
                    {
                        "category": c["category"],
                        "factor": c["correction_factor"],
                        "samples": c["sample_count"],
                    }
                    for c in calibrations.data
                ],
                "description": "실거래 기반 가격 보정",
            },
            "constraint_loop": {
                "applied": len(applied_constraints),
                "proposed": len(proposed_constraints),
                "total": constraints.count or 0,
                "description": "A/S 패턴 → 설계 제약조건",
            },
            "overall": {
                "avg_customer_rating": round(avg_rating, 2),
                "total_feedbacks": len(feedbacks.data),
            },
        }
    )
