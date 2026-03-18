"""Async subprocess wrapper for Blender headless rendering.

Serializes scene config to JSON, invokes Blender with scene_builder.py,
and returns the rendered PNG as base64 (RGBA, transparent background).
"""

import asyncio
import base64
import json
import logging
import os
import tempfile
import uuid

logger = logging.getLogger(__name__)

# Path to the scene builder script (runs inside Blender's Python)
SCENE_BUILDER_SCRIPT = os.path.join(os.path.dirname(__file__), "scene_builder.py")


async def render_cabinet_scene(
    layout_data: dict,
    camera_params: dict,
    style: str,
    category: str,
    door_state: str,
    resolution: tuple = (1024, 768),
    timeout: int = 30,
) -> str:
    """Render a cabinet scene via Blender headless.

    Args:
        layout_data: Layout Engine result (modules, wall_width, etc.)
        camera_params: Camera parameters from Vision analysis
        style: Style name (modern/nordic/classic/natural/industrial/luxury)
        category: Furniture category (sink/island/closet/etc.)
        door_state: "closed" or "open"
        resolution: Output image resolution (width, height)
        timeout: Max seconds to wait for Blender process

    Returns:
        Base64-encoded PNG with RGBA (transparent background)

    Raises:
        TimeoutError: If Blender process exceeds timeout
        RuntimeError: If Blender process fails
    """
    run_id = uuid.uuid4().hex[:8]
    input_path = os.path.join(tempfile.gettempdir(), f"scene_input_{run_id}.json")
    output_path = os.path.join(tempfile.gettempdir(), f"scene_output_{run_id}.png")

    # Build scene config
    scene_config = {
        "modules": layout_data.get("modules", []),
        "wall_width": layout_data.get("wall_width", 3000),
        "category": category,
        "style": style,
        "door_state": door_state,
        "camera_params": camera_params,
        "resolution": list(resolution),
        "output_path": output_path,
    }

    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(scene_config, f, ensure_ascii=False)

    logger.info(
        "Blender render: %s state=%s modules=%d [%s]",
        category,
        door_state,
        len(scene_config["modules"]),
        run_id,
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            "blender",
            "--background",
            "--factory-startup",
            "--python",
            SCENE_BUILDER_SCRIPT,
            "--",
            input_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        if proc.returncode != 0:
            err_msg = stderr.decode(errors="replace")[-500:]
            logger.error("Blender failed (rc=%d): %s", proc.returncode, err_msg)
            raise RuntimeError(f"Blender process failed (rc={proc.returncode}): {err_msg}")

        if not os.path.exists(output_path):
            raise RuntimeError("Blender produced no output image")

        with open(output_path, "rb") as f:
            png_bytes = f.read()

        b64 = base64.b64encode(png_bytes).decode()
        logger.info("Blender render complete: %d bytes [%s]", len(png_bytes), run_id)
        return b64

    except asyncio.TimeoutError:
        logger.error("Blender timed out after %ds [%s]", timeout, run_id)
        if proc.returncode is None:
            proc.kill()
        raise TimeoutError(f"Blender render timed out ({timeout}s)")

    finally:
        # Cleanup temp files
        for path in (input_path, output_path):
            try:
                os.unlink(path)
            except OSError:
                pass
