"""Sink module geometry — sink bowl depression + faucet.

Creates a countertop-level sink basin with a faucet centered above.
This is the key piece that solves the "sink position accuracy" problem:
the 3D model guarantees exact placement at the layout-specified position.
"""

import math

import bpy


def create_sink_module(
    width=800,
    depth=580,
    position_x=0,
    position_y=0,
    countertop_z=870,
):
    """Create a sink module with basin and faucet.

    Args:
        width: Module width (default 800mm)
        depth: Module depth (default 580mm)
        position_x: X position from origin (mm)
        position_y: Y position (mm)
        countertop_z: Countertop surface height (mm)

    Returns:
        Parent empty object containing sink parts
    """
    center_x = position_x + width / 2
    center_y = -position_y - depth / 2

    bpy.ops.object.empty_add(
        type="PLAIN_AXES",
        location=(center_x, center_y, countertop_z),
    )
    parent = bpy.context.active_object
    parent.name = f"SinkModule_{position_x}"

    # --- Sink basin (rectangular depression) ---
    basin_width = width * 0.7  # 70% of module width
    basin_depth = depth * 0.55  # 55% of module depth
    basin_height = 180  # 180mm deep

    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(
            center_x,
            center_y,
            countertop_z - basin_height / 2,
        ),
    )
    basin = bpy.context.active_object
    basin.name = f"SinkBasin_{position_x}"
    basin.scale = (basin_width / 2, basin_depth / 2, basin_height / 2)
    bpy.ops.object.transform_apply(scale=True)
    basin.parent = parent

    # Basin rim (slightly wider, thin lip)
    rim_width = basin_width + 20
    rim_depth = basin_depth + 20
    rim_height = 8

    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(
            center_x,
            center_y,
            countertop_z + rim_height / 2,
        ),
    )
    rim = bpy.context.active_object
    rim.name = f"SinkRim_{position_x}"
    rim.scale = (rim_width / 2, rim_depth / 2, rim_height / 2)
    bpy.ops.object.transform_apply(scale=True)
    rim.parent = parent

    # --- Faucet (centered above sink basin) ---
    # Faucet base (cylinder at back of sink)
    faucet_base_x = center_x
    faucet_base_y = center_y + basin_depth / 2 + 30  # behind basin
    faucet_height = 350

    bpy.ops.mesh.primitive_cylinder_add(
        radius=15,
        depth=faucet_height,
        location=(faucet_base_x, faucet_base_y, countertop_z + faucet_height / 2),
    )
    faucet_stem = bpy.context.active_object
    faucet_stem.name = f"FaucetStem_{position_x}"
    faucet_stem.parent = parent

    # Faucet spout (horizontal arm curving forward over basin center)
    spout_length = abs(faucet_base_y - center_y) + 30
    bpy.ops.mesh.primitive_cylinder_add(
        radius=10,
        depth=spout_length,
        location=(
            center_x,
            faucet_base_y - spout_length / 2,
            countertop_z + faucet_height - 15,
        ),
    )
    spout = bpy.context.active_object
    spout.name = f"FaucetSpout_{position_x}"
    spout.rotation_euler.x = math.radians(90)
    spout.parent = parent

    # Faucet handle (small lever on top)
    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(
            center_x,
            faucet_base_y,
            countertop_z + faucet_height + 20,
        ),
    )
    handle = bpy.context.active_object
    handle.name = f"FaucetHandle_{position_x}"
    handle.scale = (30 / 2, 10 / 2, 40 / 2)
    bpy.ops.object.transform_apply(scale=True)
    handle.parent = parent

    # Drain (small cylinder at bottom of basin)
    bpy.ops.mesh.primitive_cylinder_add(
        radius=25,
        depth=5,
        location=(center_x, center_y, countertop_z - basin_height + 5),
    )
    drain = bpy.context.active_object
    drain.name = f"Drain_{position_x}"
    drain.parent = parent

    return parent
