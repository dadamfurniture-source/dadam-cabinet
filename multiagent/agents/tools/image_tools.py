"""Image Generation MCP Tools — Mask-based Inpainting + Gemini

Pipeline: Mask → Inpaint(Replicate) → Open(Gemini)
Mask-based inpainting preserves original walls/tiles pixel-perfectly.
"""

import asyncio
import base64
import io
import json
import logging

import httpx
from claude_agent_sdk import create_sdk_mcp_server, tool
from PIL import Image, ImageDraw

from shared.config import settings
from shared.constants import LORA_MODELS

logger = logging.getLogger(__name__)

GOOGLE_API_KEY = settings.google_api_key
REPLICATE_API_TOKEN = settings.replicate_api_token

# Production-verified Gemini model for image generation
GEMINI_MODEL = "gemini-2.5-flash-image"


async def _call_gemini_image(
    prompt: str,
    reference_image_b64: str | None = None,
    extra_images: list[str] | None = None,
) -> str:
    """Call Gemini Image API. Returns base64-encoded image.

    Args:
        prompt: Text prompt (max 1500 chars recommended)
        reference_image_b64: Primary reference image (base64)
        extra_images: Additional reference images (base64 list, e.g. style references)

    Gemini 2.5 Flash supports ~1,920 chars (480 tokens) for image generation.
    """
    if len(prompt) > 1500:
        prompt = prompt[:1497] + "..."

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

    parts = []
    if reference_image_b64:
        parts.append(
            {
                "inlineData": {
                    "mimeType": "image/png",
                    "data": reference_image_b64,
                }
            }
        )
    # 참고 이미지 추가 (스타일 레퍼런스 등)
    if extra_images:
        for img_b64 in extra_images[:2]:  # 최대 2장
            parts.append(
                {
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": img_b64,
                    }
                }
            )
    parts.append({"text": prompt})

    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
        },
    }

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            url,
            params={"key": GOOGLE_API_KEY},
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    # Extract image from response
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "inlineData" in part:
                return part["inlineData"]["data"]

    # Check for safety/error blocks
    block_reason = data.get("promptFeedback", {}).get("blockReason")
    if block_reason:
        raise ValueError(f"Gemini blocked: {block_reason}")

    raise ValueError("No image in Gemini response")


async def _call_gemini_vision(
    image_b64: str,
    prompt: str,
    media_type: str = "image/jpeg",
) -> dict:
    """Gemini Vision API — 이미지 분석 후 JSON 반환 (Claude Vision 대체).

    텍스트만 반환하도록 설정하여 이미지 생성 비용 없이 분석만 수행.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent"

    parts = [
        {
            "inlineData": {
                "mimeType": media_type,
                "data": image_b64,
            }
        },
        {"text": prompt},
    ]

    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT"],
        },
    }

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            url,
            params={"key": GOOGLE_API_KEY},
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()

    text_content = ""
    for candidate in data.get("candidates", []):
        for part in candidate.get("content", {}).get("parts", []):
            if "text" in part:
                text_content += part["text"]

    text_content = text_content.strip()
    if text_content.startswith("```"):
        lines = text_content.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        text_content = "\n".join(lines)

    return json.loads(text_content)


async def _call_flux_lora(category: str, prompt: str) -> str:
    """Call Replicate Flux LoRA for furniture image generation. Returns base64."""
    lora_name = LORA_MODELS.get(category, category)
    model_owner = "dadamfurniture-source"
    trigger_word = f"DADAM_{lora_name.upper()}"

    full_prompt = f"{trigger_word} {prompt}"

    headers = {"Authorization": f"Bearer {REPLICATE_API_TOKEN}"}

    async with httpx.AsyncClient(timeout=180) as client:
        # Create prediction
        resp = await client.post(
            "https://api.replicate.com/v1/predictions",
            headers=headers,
            json={
                "model": f"{model_owner}/{lora_name}",
                "input": {
                    "prompt": full_prompt,
                    "num_outputs": 1,
                    "guidance_scale": 3.5,
                    "num_inference_steps": 28,
                    "output_format": "png",
                },
            },
        )
        resp.raise_for_status()
        prediction = resp.json()

        # Poll for completion (max 3 minutes)
        prediction_url = prediction["urls"]["get"]
        for _ in range(60):
            await asyncio.sleep(3)
            status_resp = await client.get(prediction_url, headers=headers)
            status_data = status_resp.json()

            if status_data["status"] == "succeeded":
                image_url = status_data["output"][0]
                img_resp = await client.get(image_url)
                return base64.b64encode(img_resp.content).decode()

            if status_data["status"] == "failed":
                raise ValueError(f"Flux LoRA failed: {status_data.get('error')}")

    raise TimeoutError("Flux LoRA prediction timed out (3min)")


# =============================================================================
# FLUX Canny-Pro — 구조 강제 이미지 생성
# =============================================================================


async def _call_flux_canny_pro(
    prompt: str,
    control_image_b64: str,
    guidance: float = 30,
    steps: int = 28,
    max_retries: int = 2,
) -> str:
    """FLUX Canny-Pro: Blender 3D 렌더의 엣지를 구조로 강제하여 이미지 생성.

    Args:
        prompt: 생성 프롬프트
        control_image_b64: 구조 제어 이미지 (Blender 렌더) base64
        guidance: 프롬프트 준수 강도 (높을수록 프롬프트에 충실)
        steps: 디퓨전 스텝 수
        max_retries: 실패 시 재시도 횟수

    Returns:
        base64 인코딩된 생성 이미지
    """
    headers = {"Authorization": f"Bearer {REPLICATE_API_TOKEN}"}
    control_uri = _image_b64_to_data_uri(control_image_b64)

    input_data = {
        "prompt": prompt,
        "control_image": control_uri,
        "guidance": guidance,
        "num_inference_steps": steps,
        "output_format": "png",
    }

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(
                    "https://api.replicate.com/v1/models/black-forest-labs/flux-canny-pro/predictions",
                    headers=headers,
                    json={"input": input_data},
                )
                resp.raise_for_status()
                prediction = resp.json()

                prediction_url = prediction["urls"]["get"]
                for _ in range(100):
                    await asyncio.sleep(3)
                    status_resp = await client.get(prediction_url, headers=headers)
                    status_data = status_resp.json()

                    if status_data["status"] == "succeeded":
                        output = status_data["output"]
                        image_url = output[0] if isinstance(output, list) else output
                        img_resp = await client.get(image_url)
                        return base64.b64encode(img_resp.content).decode()

                    if status_data["status"] == "failed":
                        raise ValueError(f"FLUX Canny-Pro failed: {status_data.get('error')}")

                raise TimeoutError("FLUX Canny-Pro timed out (5min)")

        except (httpx.HTTPStatusError, ValueError, TimeoutError) as e:
            last_error = e
            if attempt < max_retries:
                logger.warning("FLUX Canny-Pro attempt %d failed: %s, retrying...", attempt + 1, e)
                await asyncio.sleep(2)
            else:
                raise ValueError(f"FLUX Canny-Pro failed after {max_retries + 1} attempts: {last_error}")


async def cleanup_photo(image_b64: str) -> str:
    """원본 사진에서 사람/잡동사니/공구를 제거하여 깨끗한 빈 공간 생성.

    FLUX 합성의 base 이미지로 사용 — 마스크 밖 영역이 깨끗해야 함.
    """
    cleanup_prompt = (
        "Remove ALL people, workers, clothes hanging on walls, tools, "
        "construction debris, plastic bags, and ALL objects from this photo. "
        "Show ONLY the clean empty room. "
        "PRESERVE wall tiles, tile color, tile pattern, ceiling, lighting fixtures, "
        "floor surface EXACTLY as-is. Photorealistic."
    )
    return await _call_gemini_image(cleanup_prompt, image_b64)


# =============================================================================
# Mask-based Inpainting — 원본 벽/바닥 100% 보존
# =============================================================================


def _create_furniture_mask(
    image_b64: str,
    category: str,
    space_analysis: dict | None = None,
) -> str:
    """Create a binary mask for furniture placement area.

    White (255) = area to inpaint (furniture zone)
    Black (0) = area to preserve (walls, ceiling, floor edges)

    Uses space analysis data (wall_layout, dimensions) for precise mask.
    - straight: 정면 벽 하단만 마스킹 (좌우 여백 넉넉히)
    - L-shape: 정면 + 측면 벽 포함
    - U-shape: 3면 포함

    Returns: base64-encoded PNG mask image.
    """
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(img_bytes))
    width, height = img.size

    mask = Image.new("L", (width, height), 0)  # All black (preserve)
    draw = ImageDraw.Draw(mask)

    wall_layout = "straight"
    if space_analysis:
        wall_layout = space_analysis.get("wall_layout", "straight")

    # Category + wall_layout에 따른 마스크 영역 설정
    # sink: 정면 벽 전체를 마스킹 (천장 아래~바닥 위, 옷걸이/잡동사니 포함)
    if category in ("sink", "island"):
        if wall_layout == "straight":
            # 1자: 좌우 15% 여백, 상하는 천장(5%)~바닥(95%)까지 넓게
            mask_region = (0.15, 0.05, 0.85, 0.95)
        elif wall_layout == "L-shape":
            mask_region = (0.05, 0.05, 0.95, 0.95)
        else:
            mask_region = (0.03, 0.05, 0.97, 0.95)
    elif category in ("closet", "fridge_cabinet", "utility_closet"):
        if wall_layout == "straight":
            mask_region = (0.10, 0.05, 0.90, 0.92)
        else:
            mask_region = (0.05, 0.05, 0.95, 0.92)
    elif category == "shoe_cabinet":
        mask_region = (0.10, 0.30, 0.90, 0.92)
    elif category == "vanity":
        mask_region = (0.15, 0.25, 0.85, 0.88)
    else:
        mask_region = (0.10, 0.30, 0.90, 0.92)

    # Space analysis로 높이 정밀 조정
    if space_analysis:
        wall_dims = space_analysis.get("wall_dimensions_mm", {})
        wall_h = wall_dims.get("height", 2400)

        if category in ("sink", "island"):
            # 전체 벽면 커버 (상부장+하부장+옷걸이 등 잡동사니 포함)
            # space analysis 기반 미세 조정은 하지 않음 — 넓은 마스크가 더 나은 결과
            pass
        elif category in ("closet", "fridge_cabinet"):
            furniture_h_mm = 2200
            top_ratio = 1.0 - (furniture_h_mm / wall_h)
            mask_region = (mask_region[0], max(0.03, top_ratio), mask_region[2], mask_region[3])

    x1 = int(width * mask_region[0])
    y1 = int(height * mask_region[1])
    x2 = int(width * mask_region[2])
    y2 = int(height * mask_region[3])

    draw.rectangle([x1, y1, x2, y2], fill=255)

    logger.info(
        "Mask region: layout=%s, rect=(%d,%d,%d,%d) on %dx%d",
        wall_layout,
        x1,
        y1,
        x2,
        y2,
        width,
        height,
    )

    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _composite_inpaint_result(
    original_b64: str,
    inpainted_b64: str,
    mask_b64: str,
) -> str:
    """Composite inpainted result onto original image using mask.

    Takes ONLY the furniture region (white mask area) from the inpainted image
    and pastes it onto the original. Non-masked areas are original pixels EXACTLY.

    This guarantees pixel-perfect wall/floor/ceiling preservation regardless
    of how the inpainting model handles non-masked regions.
    """
    original = Image.open(io.BytesIO(base64.b64decode(original_b64))).convert("RGBA")
    inpainted = Image.open(io.BytesIO(base64.b64decode(inpainted_b64))).convert("RGBA")
    mask = Image.open(io.BytesIO(base64.b64decode(mask_b64))).convert("L")

    # Resize inpainted/mask to match original if needed
    if inpainted.size != original.size:
        inpainted = inpainted.resize(original.size, Image.LANCZOS)
    if mask.size != original.size:
        mask = mask.resize(original.size, Image.LANCZOS)

    # Feather the mask edges for natural blending (5px gaussian blur)
    from PIL import ImageFilter

    mask_feathered = mask.filter(ImageFilter.GaussianBlur(radius=5))

    # Composite: original where mask=0 (black), inpainted where mask=255 (white)
    result = Image.composite(inpainted, original, mask_feathered)

    # Convert back to RGB PNG base64
    result_rgb = result.convert("RGB")
    buf = io.BytesIO()
    result_rgb.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _image_b64_to_data_uri(image_b64: str) -> str:
    """Convert base64 image to data URI for Replicate API."""
    return f"data:image/png;base64,{image_b64}"


async def _call_replicate_inpaint(
    image_b64: str,
    mask_b64: str,
    prompt: str,
    negative_prompt: str = "",
    model: str = "stability-ai/stable-diffusion-inpainting",
) -> str:
    """Call Replicate inpainting model, then composite onto original.

    Returns base64-encoded image with:
    - Furniture region: AI-generated content
    - Everything else: EXACT original pixels (via compositing)
    """
    headers = {"Authorization": f"Bearer {REPLICATE_API_TOKEN}"}

    # Replicate accepts data URIs for image inputs
    image_uri = _image_b64_to_data_uri(image_b64)
    mask_uri = _image_b64_to_data_uri(mask_b64)

    neg = negative_prompt or "L-shaped, corner cabinet, wraparound, distorted walls"

    input_data = {
        "image": image_uri,
        "mask": mask_uri,
        "prompt": prompt,
        "negative_prompt": neg,
        "num_inference_steps": 50,
        "guidance_scale": 7.5,
    }

    # Models with their version hashes and input formats
    models_to_try = [
        {
            "name": "black-forest-labs/flux-fill-pro",
            "version": "2d4197724d8ed13cc78191e794ebbe6aeedcfe4c5b36f464794732d5ccb9735f",
            "input": {
                "image": image_uri,
                "mask": mask_uri,
                "prompt": prompt,
                "steps": 50,
                "guidance": 30,
                "output_format": "png",
            },
        },
        {
            "name": "stability-ai/stable-diffusion-inpainting",
            "version": "95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3",
            "input": input_data,
        },
    ]

    last_error = None
    for model_cfg in models_to_try:
        model_name = model_cfg["name"]
        try:
            logger.info("Trying inpaint model: %s", model_name)
            async with httpx.AsyncClient(timeout=300) as client:
                resp = await client.post(
                    "https://api.replicate.com/v1/predictions",
                    headers=headers,
                    json={
                        "version": model_cfg["version"],
                        "input": model_cfg["input"],
                    },
                )
                # If model not found, try next
                if resp.status_code in (404, 422):
                    logger.warning("Model %s not available: %s", model_name, resp.status_code)
                    continue
                resp.raise_for_status()
                prediction = resp.json()

                # Poll for completion (max 5 minutes for inpainting)
                prediction_url = prediction["urls"]["get"]
                for _ in range(100):
                    await asyncio.sleep(3)
                    status_resp = await client.get(prediction_url, headers=headers)
                    status_data = status_resp.json()

                    if status_data["status"] == "succeeded":
                        output = status_data["output"]
                        # Output can be string URL or list
                        image_url = output[0] if isinstance(output, list) else output
                        img_resp = await client.get(image_url)
                        raw_result_b64 = base64.b64encode(img_resp.content).decode()

                        # 합성: 원본 위에 가구 영역만 붙여넣기
                        # 마스크 외 영역은 원본 픽셀 그대로
                        composited = _composite_inpaint_result(image_b64, raw_result_b64, mask_b64)
                        logger.info("Composited inpaint result onto original")
                        return composited

                    if status_data["status"] == "failed":
                        raise ValueError(f"Inpainting failed: {status_data.get('error')}")

                raise TimeoutError(f"Inpainting timed out (5min) with {model_name}")

        except (httpx.HTTPStatusError, ValueError, TimeoutError) as e:
            last_error = e
            logger.warning("Inpaint model %s failed: %s", model_name, e)
            continue

    raise ValueError(f"All inpainting models failed. Last error: {last_error}")


# =============================================================================
# MCP Tools — All descriptions in English for agent consumption
# =============================================================================


@tool(
    "generate_cleanup",
    "Remove existing furniture/clutter from original photo, producing a clean empty space image.",
    {
        "type": "object",
        "properties": {
            "original_image_b64": {
                "type": "string",
                "description": "Original site photo as base64",
            },
            "space_description": {
                "type": "string",
                "description": "Brief space description (e.g. 'Korean apartment kitchen with tile backsplash')",
            },
        },
        "required": ["original_image_b64"],
    },
)
async def generate_cleanup(args: dict) -> dict:
    desc = args.get("space_description", "Korean apartment kitchen")
    prompt = (
        f"Remove all existing furniture, appliances and objects from this photo. "
        f"Show only the clean empty {desc} with bare walls and floor. "
        f"Preserve original lighting, wall color and perspective exactly."
    )

    result_b64 = await _call_gemini_image(prompt, args["original_image_b64"])
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps({"image_base64": result_b64, "stage": "cleanup"}),
            }
        ]
    }


@tool(
    "generate_furniture",
    "Generate furniture installation image using Flux LoRA model for the given category.",
    {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "Furniture category (sink, island, closet, etc.)",
            },
            "style": {
                "type": "string",
                "description": "Design style (modern, nordic, classic, natural, industrial, luxury)",
            },
            "layout_description": {
                "type": "string",
                "description": "Compressed layout description in English (<500 chars). Include dimensions, module count, finish type.",
            },
            "cleanup_image_b64": {
                "type": "string",
                "description": "Cleanup image base64 (for reference context)",
            },
        },
        "required": ["category", "layout_description"],
    },
)
async def generate_furniture(args: dict) -> dict:
    style = args.get("style", "modern")
    prompt = (
        f"{style} style Korean built-in furniture, {args['layout_description']}, "
        f"photorealistic interior photography, natural lighting"
    )

    result_b64 = await _call_flux_lora(args["category"], prompt)
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps({"image_base64": result_b64, "stage": "furniture"}),
            }
        ]
    }


@tool(
    "generate_correction",
    "Correct furniture image to match original space — fix color temperature, lighting, perspective alignment.",
    {
        "type": "object",
        "properties": {
            "furniture_image_b64": {
                "type": "string",
                "description": "Generated furniture image as base64",
            },
            "original_image_b64": {
                "type": "string",
                "description": "Original site photo for color/lighting reference",
            },
            "correction_prompt": {
                "type": "string",
                "description": "Correction instructions in English (<500 chars)",
            },
        },
        "required": ["furniture_image_b64", "correction_prompt"],
    },
)
async def generate_correction(args: dict) -> dict:
    prompt = args["correction_prompt"]
    result_b64 = await _call_gemini_image(prompt, args["furniture_image_b64"])
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps({"image_base64": result_b64, "stage": "correction"}),
            }
        ]
    }


@tool(
    "generate_open",
    "Generate open-door view showing interior storage configuration of the furniture.",
    {
        "type": "object",
        "properties": {
            "furniture_image_b64": {
                "type": "string",
                "description": "Corrected furniture image as base64",
            },
            "category": {
                "type": "string",
                "description": "Furniture category (for appropriate interior contents)",
            },
            "open_prompt": {
                "type": "string",
                "description": "Open-door view instructions in English (<500 chars)",
            },
        },
        "required": ["furniture_image_b64", "open_prompt"],
    },
)
async def generate_open(args: dict) -> dict:
    result_b64 = await _call_gemini_image(args["open_prompt"], args["furniture_image_b64"])
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps({"image_base64": result_b64, "stage": "open"}),
            }
        ]
    }


# MCP Server
image_server = create_sdk_mcp_server(
    name="image",
    version="1.0.0",
    tools=[generate_cleanup, generate_furniture, generate_correction, generate_open],
)
