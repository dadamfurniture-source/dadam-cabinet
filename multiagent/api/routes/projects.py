"""프로젝트 API — AI 시뮬레이션 요청/조회"""

import asyncio
import json as json_mod
import logging
import uuid
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import StreamingResponse

from api.middleware.auth import CurrentUser, get_current_user
from api.schemas.common import APIResponse
from shared.constants import CATEGORIES, PLANS, STYLES
from shared.supabase_client import get_service_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["Projects"])

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("", response_model=APIResponse)
async def create_project(
    image: UploadFile = File(...),
    category: str = Form(...),
    style: str | None = Form(None),
    budget: int | None = Form(None),
    notes: str | None = Form(None),
    user: CurrentUser = Depends(get_current_user),
):
    """새 프로젝트 생성 + AI 파이프라인 시작"""

    # 카테고리 검증
    if category not in CATEGORIES:
        raise HTTPException(
            400, f"지원하지 않는 카테고리: {category}. 가능: {list(CATEGORIES.keys())}"
        )

    if style and style not in STYLES:
        raise HTTPException(400, f"지원하지 않는 스타일: {style}. 가능: {STYLES}")

    # 사용량 확인 (Free 플랜: 월 3회)
    plan_config = PLANS.get(user.plan, PLANS["free"])
    limit = plan_config["simulations_per_month"]

    if limit > 0:
        client = get_service_client()
        month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0).isoformat()
        count_result = (
            client.table("projects")
            .select("id", count="exact")
            .eq("user_id", user.id)
            .gte("created_at", month_start)
            .execute()
        )
        if (count_result.count or 0) >= limit:
            raise HTTPException(
                429,
                f"월 {limit}회 시뮬레이션 한도에 도달했습니다. 플랜을 업그레이드하세요.",
            )

    # 이미지 업로드 (10MB 제한)
    client = get_service_client()
    project_id = str(uuid.uuid4())
    image_content = await image.read()
    if len(image_content) > MAX_UPLOAD_SIZE:
        raise HTTPException(
            413, f"이미지 크기가 {MAX_UPLOAD_SIZE // (1024 * 1024)}MB를 초과합니다."
        )
    ext = (image.filename or "upload.jpg").rsplit(".", 1)[-1]
    image_path = f"{user.id}/{project_id}/original.{ext}"

    client.storage.from_("originals").upload(
        image_path,
        image_content,
        {"content-type": image.content_type or "image/jpeg"},
    )
    image_url = client.storage.from_("originals").get_public_url(image_path)

    # 프로젝트 레코드 생성
    (
        client.table("projects")
        .insert(
            {
                "id": project_id,
                "user_id": user.id,
                "name": f"{CATEGORIES[category]} 시뮬레이션",
                "status": "created",
                "category": category,
                "style": style,
                "budget": budget,
                "notes": notes,
            }
        )
        .execute()
    )

    # 원본 이미지 기록
    client.table("generated_images").insert(
        {
            "project_id": project_id,
            "image_url": image_url,
            "type": "original",
        }
    ).execute()

    return APIResponse(
        message="프로젝트가 생성되었습니다.",
        data={"project_id": project_id, "status": "created"},
    )


@router.get("", response_model=APIResponse)
async def list_projects(
    page: int = 1,
    per_page: int = 20,
    status: str | None = None,
    category: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    """내 프로젝트 목록 조회"""
    per_page = min(per_page, 100)
    client = get_service_client()
    query = (
        client.table("projects")
        .select("*, generated_images(image_url, type)", count="exact")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .range((page - 1) * per_page, page * per_page - 1)
    )

    if status:
        query = query.eq("status", status)
    if category:
        query = query.eq("category", category)

    result = query.execute()

    return APIResponse(
        data={
            "items": result.data,
            "total": result.count or 0,
            "page": page,
            "per_page": per_page,
        }
    )


@router.get("/{project_id}", response_model=APIResponse)
async def get_project(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """프로젝트 상세 조회 (분석결과, 배치, 이미지, 견적 포함)"""
    client = get_service_client()

    project = (
        client.table("projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", user.id)
        .single()
        .execute()
    )

    if not project.data:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    # 관련 데이터 병렬 조회
    images = client.table("generated_images").select("*").eq("project_id", project_id).execute()
    layouts = (
        client.table("layouts")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    quotes = (
        client.table("quotes")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    analyses = (
        client.table("space_analyses")
        .select("*")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    # originals 버킷(private)의 이미지는 signed URL로 변환
    images_data = images.data or []
    for img in images_data:
        url = img.get("image_url", "")
        if "/object/public/originals/" in url or "/object/originals/" in url:
            try:
                path_part = url.split("/object/")[1]
                if path_part.startswith("public/"):
                    path_part = path_part[7:]
                parts = path_part.split("/", 1)
                if len(parts) == 2:
                    file_path = parts[1].rstrip("?")
                    signed = client.storage.from_("originals").create_signed_url(file_path, 3600)
                    img["image_url"] = signed.get("signedURL", signed.get("signedUrl", url))
            except Exception as e:
                logger.warning("Failed to sign original image URL: %s", e)

    data = {
        "project": project.data,
        "images": images_data,
        "layout": layouts.data[0] if layouts.data else None,
        "quote": quotes.data[0] if quotes.data else None,
        "space_analysis": analyses.data[0] if analyses.data else None,
    }

    # Pro+ 에서만 상세설계 포함
    if user.plan in ("pro", "enterprise"):
        designs = (
            client.table("detail_designs")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        data["detail_design"] = designs.data[0] if designs.data else None

    return APIResponse(data=data)


async def _run_pipeline_async(
    project_id: str,
    user_id: str,
    user_plan: str,
    category: str,
    style: str | None,
    budget: int | None,
    image_url: str,
    notes: str | None,
):
    """백그라운드에서 AI 파이프라인을 비동기 실행"""
    from agents.orchestrator import ProjectRequest, process_project

    client = get_service_client()
    request = ProjectRequest(
        project_id=project_id,
        user_id=user_id,
        user_plan=user_plan,
        category=category,
        style=style,
        budget=budget,
        image_url=image_url,
        notes=notes,
    )

    try:
        async for event in process_project(request):
            # 진행 상황을 pipeline_stage 필드에 기록
            if event.get("type") == "progress":
                content = event.get("content", "")
                stage = "processing"
                if "analyz" in content or "space" in content:
                    stage = "space_analysis"
                elif "layout" in content or "design" in content:
                    stage = "design"
                elif "image" in content or "generat" in content:
                    stage = "image_gen"
                elif "quote" in content or "price" in content:
                    stage = "quote"
                client.table("projects").update(
                    {
                        "pipeline_stage": stage,
                    }
                ).eq("id", project_id).execute()

        client.table("projects").update(
            {
                "status": "completed",
                "pipeline_stage": "completed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }
        ).eq("id", project_id).execute()

    except Exception as e:
        logger.error("Project %s pipeline failed: %s", project_id, e, exc_info=True)
        client.table("projects").update(
            {
                "status": "failed",
                "pipeline_stage": "failed",
            }
        ).eq("id", project_id).execute()


@router.post("/{project_id}/run", response_model=APIResponse)
async def run_project(
    project_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """AI 파이프라인 실행 시작 — asyncio.create_task로 비동기 실행, SSE로 상태 폴링"""
    client = get_service_client()

    project = (
        client.table("projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", user.id)
        .single()
        .execute()
    )

    if not project.data:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    if project.data["status"] not in ("created", "failed"):
        raise HTTPException(400, f"현재 상태({project.data['status']})에서는 실행할 수 없습니다.")

    # 상태 업데이트
    client.table("projects").update(
        {
            "status": "processing",
            "pipeline_stage": "started",
        }
    ).eq("id", project_id).execute()

    # 원본 이미지 URL 조회
    p = project.data
    original_img = (
        client.table("generated_images")
        .select("image_url")
        .eq("project_id", project_id)
        .eq("type", "original")
        .limit(1)
        .execute()
    )
    image_url = original_img.data[0]["image_url"] if original_img.data else ""

    # asyncio.create_task로 백그라운드 실행 (이벤트 루프 공유)
    asyncio.create_task(
        _run_pipeline_async(
            project_id=project_id,
            user_id=p["user_id"],
            user_plan=user.plan,
            category=p["category"],
            style=p.get("style"),
            budget=p.get("budget"),
            image_url=image_url,
            notes=p.get("notes"),
        )
    )

    return APIResponse(
        message="AI 파이프라인이 시작되었습니다.",
        data={
            "project_id": project_id,
            "status": "processing",
            "stream_url": f"/api/v1/projects/{project_id}/stream",
        },
    )


@router.get("/{project_id}/stream")
async def stream_project(
    project_id: str,
    token: str | None = Query(None),
):
    """프로젝트 처리 SSE 스트림 — DB 폴링으로 백그라운드 파이프라인 진행 상황 전달

    EventSource는 Authorization 헤더를 지원하지 않으므로
    ?token=xxx 쿼리 파라미터로 인증.
    """
    if not token:
        logger.warning("SSE stream: no token provided")
        raise HTTPException(401, "인증이 필요합니다.")

    # 토큰으로 사용자 확인
    try:
        client_auth = get_service_client()
        user_response = client_auth.auth.get_user(token)
        if not user_response or not user_response.user:
            logger.warning("SSE stream: get_user returned empty (token=%s...)", token[:20])
            raise HTTPException(401, "유효하지 않은 토큰입니다.")
        user_id = user_response.user.id
        logger.info("SSE stream: authenticated user %s", user_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(
            "SSE stream: auth exception: %s (token=%s...)", e, token[:20] if token else "None"
        )
        raise HTTPException(401, "인증 실패")

    client = get_service_client()

    project = (
        client.table("projects")
        .select("*")
        .eq("id", project_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not project.data:
        raise HTTPException(404, "프로젝트를 찾을 수 없습니다.")

    async def event_generator():
        last_stage = ""
        max_polls = 300  # 최대 5분 (1초 간격)

        for _ in range(max_polls):
            result = (
                client.table("projects")
                .select("status, pipeline_stage")
                .eq("id", project_id)
                .single()
                .execute()
            )
            if not result.data:
                break

            status = result.data.get("status", "")
            stage = result.data.get("pipeline_stage", "")

            # 새 스테이지면 이벤트 전송
            if stage and stage != last_stage:
                last_stage = stage
                yield f"data: {json_mod.dumps({'type': 'status', 'stage': stage})}\n\n"

                if stage == "completed":
                    break
                if stage == "failed":
                    yield f"data: {json_mod.dumps({'type': 'error', 'error': '시뮬레이션 처리 중 오류가 발생했습니다.'})}\n\n"
                    break

            if status in ("completed", "failed"):
                break

            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
