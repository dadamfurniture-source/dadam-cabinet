"""Supabase MCP 도구 - DB/Storage 연동"""

import json

from claude_agent_sdk import create_sdk_mcp_server, tool

from shared.supabase_client import get_service_client as _get_client


@tool(
    "read_project",
    "프로젝트 정보를 조회합니다. 프로젝트 ID로 공간 분석, 배치, 견적 등 전체 데이터를 가져옵니다.",
    {
        "type": "object",
        "properties": {
            "project_id": {"type": "string", "description": "프로젝트 UUID"},
            "include": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": ["space_analysis", "layout", "images", "quote", "design"],
                },
                "description": "포함할 관련 데이터",
            },
        },
        "required": ["project_id"],
    },
)
async def read_project(args: dict) -> dict:
    client = _get_client()
    project_id = args["project_id"]
    include = args.get("include", [])

    project = client.table("projects").select("*").eq("id", project_id).single().execute()
    result = {"project": project.data}

    if "space_analysis" in include:
        sa = (
            client.table("space_analyses")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        result["space_analysis"] = sa.data[0] if sa.data else None

    if "layout" in include:
        layout = (
            client.table("layouts")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        result["layout"] = layout.data[0] if layout.data else None

    if "images" in include:
        images = client.table("generated_images").select("*").eq("project_id", project_id).execute()
        result["images"] = images.data

    if "quote" in include:
        quote = (
            client.table("quotes")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        result["quote"] = quote.data[0] if quote.data else None

    if "design" in include:
        design = (
            client.table("detail_designs")
            .select("*")
            .eq("project_id", project_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        result["design"] = design.data[0] if design.data else None

    return {"content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]}


@tool(
    "update_project",
    "프로젝트 상태를 업데이트합니다.",
    {
        "type": "object",
        "properties": {
            "project_id": {"type": "string"},
            "status": {
                "type": "string",
                "enum": ["analyzing", "designing", "generating", "quoting", "completed", "failed"],
            },
            "metadata": {"type": "object", "description": "추가 메타데이터"},
        },
        "required": ["project_id", "status"],
    },
)
async def update_project(args: dict) -> dict:
    client = _get_client()
    update_data = {"status": args["status"]}
    if args.get("metadata"):
        update_data["metadata"] = args["metadata"]

    client.table("projects").update(update_data).eq("id", args["project_id"]).execute()
    return {"content": [{"type": "text", "text": f"프로젝트 상태 업데이트: {args['status']}"}]}


@tool(
    "save_quote",
    "견적 데이터를 저장합니다.",
    {
        "type": "object",
        "properties": {
            "project_id": {"type": "string"},
            "layout_id": {"type": "string"},
            "items": {"type": "array", "description": "견적 항목 리스트"},
            "total_price": {"type": "number"},
            "margin_rate": {"type": "number", "description": "마진율 (0.0~1.0)"},
        },
        "required": ["project_id", "items", "total_price"],
    },
)
async def save_quote(args: dict) -> dict:
    client = _get_client()
    (
        client.table("quotes")
        .insert(
            {
                "project_id": args["project_id"],
                "layout_id": args.get("layout_id"),
                "items_json": args["items"],
                "total_price": args["total_price"],
                "margin_rate": args.get("margin_rate", 0.3),
            }
        )
        .execute()
    )
    return {"content": [{"type": "text", "text": f"견적 저장 완료: {args['total_price']:,.0f}원"}]}


@tool(
    "upload_image",
    "생성된 이미지를 Supabase Storage에 업로드하고 URL을 반환합니다.",
    {
        "type": "object",
        "properties": {
            "project_id": {"type": "string"},
            "image_base64": {"type": "string", "description": "Base64 인코딩된 이미지"},
            "image_type": {
                "type": "string",
                "enum": ["cleanup", "furniture", "correction", "open", "detail_design"],
            },
            "filename": {"type": "string"},
        },
        "required": ["project_id", "image_base64", "image_type"],
    },
)
async def upload_image(args: dict) -> dict:
    import base64

    client = _get_client()
    project_id = args["project_id"]
    image_type = args["image_type"]
    filename = args.get("filename", f"{image_type}.png")

    image_data = base64.b64decode(args["image_base64"])
    path = f"projects/{project_id}/{filename}"

    client.storage.from_("generated-images").upload(path, image_data, {"content-type": "image/png"})
    public_url = client.storage.from_("generated-images").get_public_url(path)

    # DB에도 기록
    client.table("generated_images").insert(
        {
            "project_id": project_id,
            "image_url": public_url,
            "type": image_type,
        }
    ).execute()

    return {"content": [{"type": "text", "text": f"이미지 업로드 완료: {public_url}"}]}


@tool(
    "save_design",
    "상세 설계 데이터를 저장합니다. (Pro+)",
    {
        "type": "object",
        "properties": {
            "project_id": {"type": "string"},
            "layout_id": {"type": "string"},
            "design_json": {"type": "object", "description": "설계도 데이터 (SVG 포함)"},
        },
        "required": ["project_id", "design_json"],
    },
)
async def save_design(args: dict) -> dict:
    client = _get_client()
    (
        client.table("detail_designs")
        .insert(
            {
                "project_id": args["project_id"],
                "layout_id": args.get("layout_id"),
                "design_json": args["design_json"],
            }
        )
        .execute()
    )
    return {"content": [{"type": "text", "text": "상세 설계 저장 완료"}]}


# MCP 서버 생성
supabase_server = create_sdk_mcp_server(
    name="supabase",
    version="1.0.0",
    tools=[read_project, update_project, save_quote, upload_image, save_design],
)
