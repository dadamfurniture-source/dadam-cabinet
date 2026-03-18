"""Blender Python scene builder — runs inside Blender's Python interpreter.

Usage:
    blender --background --factory-startup --python scene_builder.py -- input.json

Reads scene config from input JSON, builds 3D cabinet scene, renders to PNG.
"""

import json
import os
import sys

# Blender modules (available when running inside Blender)
import bpy

# Add project root to path so we can import our modules
# When run via `blender --python`, the CWD is the Blender binary dir
# The script path tells us where the project is
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(script_dir))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from agents.blender.camera import setup_camera
from agents.blender.geometry.base_cabinet import create_base_cabinet
from agents.blender.geometry.cooktop import create_cooktop_module, create_drawer_cabinet
from agents.blender.geometry.countertop import create_countertop
from agents.blender.geometry.handles import HANDLE_STYLES, create_handle
from agents.blender.geometry.sink import create_sink_module
from agents.blender.geometry.toe_kick import create_toe_kick
from agents.blender.geometry.upper_cabinet import create_upper_cabinet
from agents.blender.materials import apply_style_materials

# Standard dimensions (mm)
BASE_HEIGHT = 870
BASE_DEPTH = 580
TOE_KICK = 150
UPPER_HEIGHT = 720
UPPER_DEPTH = 350
COUNTERTOP_THICKNESS = 12
MOLDING = 60
WALL_HEIGHT = 2400


def build_scene(config):
    """Build the complete 3D cabinet scene from config.

    Args:
        config: dict with keys:
            - modules: list of module dicts from Layout Engine
            - wall_width: total wall width (mm)
            - category: furniture category
            - style: style name
            - door_state: "closed" or "open"
            - camera_params: camera parameters dict
            - resolution: [width, height]
            - output_path: where to save rendered PNG
    """
    # Start with empty scene
    bpy.ops.wm.read_factory_settings(use_empty=True)

    modules = config.get("modules", [])
    wall_width = config.get("wall_width", 3000)
    door_state = config.get("door_state", "closed")
    style = config.get("style", "modern")
    config.get("category", "sink")

    # Track sink position for countertop cutout
    sink_position_x = None

    # ── 1. Place base (lower) modules ──
    for module in modules:
        mod_type = module.get("type", "cabinet")
        mod_width = module.get("width", 450)
        mod_x = module.get("position_x", 0)
        is_2door = module.get("is_2door", False)

        if mod_type == "sink_bowl":
            # Sink module: basin + faucet (no door on the sink itself,
            # but the cabinet below has doors)
            create_sink_module(
                width=mod_width,
                depth=BASE_DEPTH,
                position_x=mod_x,
                countertop_z=BASE_HEIGHT,
            )
            # Base cabinet under sink
            create_base_cabinet(
                width=mod_width,
                depth=BASE_DEPTH,
                height=BASE_HEIGHT,
                toe_kick=TOE_KICK,
                is_2door=True,
                door_state=door_state,
                position_x=mod_x,
            )
            sink_position_x = mod_x

        elif mod_type == "cooktop":
            # Cooktop surface
            create_cooktop_module(
                width=mod_width,
                depth=BASE_DEPTH,
                position_x=mod_x,
                countertop_z=BASE_HEIGHT,
            )
            # Drawer cabinet under cooktop (NOT doors)
            create_drawer_cabinet(
                width=mod_width,
                depth=BASE_DEPTH,
                height=BASE_HEIGHT,
                toe_kick=TOE_KICK,
                num_drawers=2,
                door_state=door_state,
                position_x=mod_x,
            )

        else:
            # Standard cabinet
            create_base_cabinet(
                width=mod_width,
                depth=BASE_DEPTH,
                height=BASE_HEIGHT,
                toe_kick=TOE_KICK,
                is_2door=is_2door,
                door_state=door_state,
                position_x=mod_x,
            )

        # Toe kick for every base module
        create_toe_kick(
            width=mod_width,
            height=TOE_KICK,
            depth=BASE_DEPTH,
            position_x=mod_x,
        )

    # ── 2. Place upper cabinets ──
    # Upper cabinets mirror base modules, EXCEPT at cooktop position
    # (range hood goes there instead — simplified as a box)
    for module in modules:
        mod_type = module.get("type", "cabinet")
        mod_width = module.get("width", 450)
        mod_x = module.get("position_x", 0)
        is_2door = module.get("is_2door", False)

        if mod_type == "cooktop":
            # Range hood area — simplified box representing concealed hood
            _create_range_hood(mod_width, mod_x)
        else:
            create_upper_cabinet(
                width=mod_width,
                depth=UPPER_DEPTH,
                height=UPPER_HEIGHT,
                is_2door=is_2door,
                door_state=door_state,
                position_x=mod_x,
                wall_height=WALL_HEIGHT,
                molding=MOLDING,
            )

    # ── 3. Continuous countertop ──
    if modules:
        leftmost = min(m.get("position_x", 0) for m in modules)
        rightmost = max(m.get("position_x", 0) + m.get("width", 0) for m in modules)
        counter_width = rightmost - leftmost

        create_countertop(
            total_width=counter_width,
            depth=BASE_DEPTH,
            thickness=COUNTERTOP_THICKNESS,
            countertop_z=BASE_HEIGHT,
            position_x=leftmost,
            sink_position_x=sink_position_x,
            sink_width=1000 if sink_position_x is not None else 0,
        )

    # ── 4. Handles ──
    handle_style = style
    if handle_style not in HANDLE_STYLES:
        handle_style = "modern"

    for obj in list(bpy.data.objects):
        name = obj.name.lower()
        if "door_" in name or "udoor_" in name:
            # Place handle at center of door
            loc = obj.location.copy()
            handle_z = loc.z
            handle_x = loc.x
            handle_y = loc.y - 20  # in front of door
            create_handle(
                style=handle_style,
                position=(handle_x, handle_y, handle_z),
                vertical=True,
            )
        elif "drawerfront_" in name:
            loc = obj.location.copy()
            create_handle(
                style=handle_style,
                position=(loc.x, loc.y - 20, loc.z),
                vertical=False,
            )

    # ── 5. Apply materials ──
    apply_style_materials(style)

    # ── 6. Camera ──
    camera_params = config.get("camera_params", {})
    setup_camera(camera_params, wall_width=wall_width, wall_height=WALL_HEIGHT)

    # ── 7. Lighting (simple 3-point for Workbench) ──
    _setup_lighting(wall_width)

    # ── 8. Render settings ──
    scene = bpy.context.scene
    resolution = config.get("resolution", [1024, 768])
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100

    # Workbench engine (GPU-free, fast)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "studio.sl"
    scene.display.shading.color_type = "MATERIAL"

    # Transparent background (RGBA output)
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    # Output path
    output_path = config.get("output_path", "/tmp/render_output.png")
    scene.render.filepath = output_path

    # Render
    bpy.ops.render.render(write_still=True)


def _create_range_hood(width, position_x):
    """Create a simplified range hood box (concealed inside upper cabinet)."""
    hood_height = UPPER_HEIGHT
    hood_depth = UPPER_DEPTH
    bottom_z = WALL_HEIGHT - MOLDING - hood_height

    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(
            position_x + width / 2,
            -hood_depth / 2,
            bottom_z + hood_height / 2,
        ),
    )
    hood = bpy.context.active_object
    hood.name = f"RangeHood_{position_x}"
    hood.scale = (width / 2, hood_depth / 2, hood_height / 2)
    bpy.ops.object.transform_apply(scale=True)
    return hood


def _setup_lighting(wall_width):
    """Set up basic studio lighting for the scene."""
    # Key light (main illumination from camera direction)
    bpy.ops.object.light_add(
        type="AREA",
        location=(wall_width / 2, 2000, 2000),
    )
    key = bpy.context.active_object
    key.name = "KeyLight"
    key.data.energy = 500
    key.data.size = 2000
    key.rotation_euler = (1.0, 0, 0)

    # Fill light (softer, from the side)
    bpy.ops.object.light_add(
        type="AREA",
        location=(-500, 1500, 1500),
    )
    fill = bpy.context.active_object
    fill.name = "FillLight"
    fill.data.energy = 200
    fill.data.size = 1500


# ── Main entry point (when run from Blender CLI) ──
if __name__ == "__main__":
    # Parse arguments after "--"
    argv = sys.argv
    if "--" in argv:
        args = argv[argv.index("--") + 1 :]
    else:
        args = []

    if not args:
        print("Usage: blender --background --python scene_builder.py -- input.json")
        sys.exit(1)

    input_path = args[0]

    with open(input_path, "r", encoding="utf-8") as f:
        config = json.load(f)

    build_scene(config)
    print(f"Render complete: {config.get('output_path', 'unknown')}")
