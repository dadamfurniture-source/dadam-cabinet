"""참고 이미지 API — 스타일별 레퍼런스 이미지 업로드/조회"""

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.middleware.auth import CurrentUser, get_current_user, require_admin
from api.schemas.common import APIResponse
from shared.constants import CATEGORIES, STYLES
from shared.supabase_client import get_service_client

router = APIRouter(prefix="/references", tags=["References"])

MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10MB


@router.post("", response_model=APIResponse)
async def upload_reference(
    image: UploadFile = File(...),
    category: str = Form(...),
    style: str = Form(...),
    description: str | None = Form(None),
    user: CurrentUser = Depends(get_current_user),
):
    """참고 이미지 업로드 (관리자 전용)"""
    require_admin(user)

    if category not in CATEGORIES:
        raise HTTPException(400, f"지원하지 않는 카테고리: {category}")
    if style not in STYLES:
        raise HTTPException(400, f"지원하지 않는 스타일: {style}")

    image_content = await image.read()
    if len(image_content) > MAX_UPLOAD_SIZE:
        raise HTTPException(413, "이미지 크기가 10MB를 초과합니다.")

    client = get_service_client()
    ref_id = str(uuid.uuid4())
    ext = (image.filename or "ref.jpg").rsplit(".", 1)[-1]
    path = f"{category}/{style}/{ref_id}.{ext}"

    client.storage.from_("references").upload(
        path,
        image_content,
        {"content-type": image.content_type or "image/jpeg"},
    )
    image_url = client.storage.from_("references").get_public_url(path).rstrip("?")

    client.table("style_references").insert(
        {
            "id": ref_id,
            "category": category,
            "style": style,
            "image_url": image_url,
            "description": description,
            "created_by": user.id,
        }
    ).execute()

    return APIResponse(
        message="참고 이미지가 등록되었습니다.",
        data={"id": ref_id, "image_url": image_url},
    )


@router.get("", response_model=APIResponse)
async def list_references(
    category: str | None = None,
    style: str | None = None,
    user: CurrentUser = Depends(get_current_user),
):
    """참고 이미지 목록 조회"""
    client = get_service_client()
    query = (
        client.table("style_references")
        .select("*")
        .eq("is_active", True)
        .order("created_at", desc=True)
    )

    if category:
        query = query.eq("category", category)
    if style:
        query = query.eq("style", style)

    result = query.execute()
    return APIResponse(data={"items": result.data})


@router.delete("/{ref_id}", response_model=APIResponse)
async def delete_reference(
    ref_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """참고 이미지 삭제 (비활성화)"""
    require_admin(user)

    client = get_service_client()
    client.table("style_references").update(
        {
            "is_active": False,
        }
    ).eq("id", ref_id).execute()

    return APIResponse(message="참고 이미지가 삭제되었습니다.")
