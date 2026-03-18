"""Countertop (continuous slab) geometry.

Creates a single continuous countertop slab spanning the entire wall width.
Includes cutout for sink basin.
"""

import bpy


def create_countertop(
    total_width,
    depth=580,
    thickness=12,
    countertop_z=870,
    position_x=0,
    position_y=0,
    sink_position_x=None,
    sink_width=800,
):
    """Create a continuous countertop slab.

    Args:
        total_width: Full wall width coverage (mm)
        depth: Countertop depth (default 580mm)
        thickness: Slab thickness (default 12mm)
        countertop_z: Top surface height (= base cabinet height)
        position_x: X origin (mm)
        position_y: Y origin (mm)
        sink_position_x: X position of sink module center (for cutout), or None
        sink_width: Sink module width (for cutout size)

    Returns:
        Countertop mesh object
    """
    center_x = position_x + total_width / 2
    center_y = -position_y - depth / 2
    top_z = countertop_z + thickness / 2

    bpy.ops.mesh.primitive_cube_add(size=1, location=(center_x, center_y, top_z))
    countertop = bpy.context.active_object
    countertop.name = "Countertop"
    countertop.scale = (total_width / 2, depth / 2, thickness / 2)
    bpy.ops.object.transform_apply(scale=True)

    # Sink cutout using boolean modifier
    if sink_position_x is not None:
        cutout_width = sink_width * 0.65
        cutout_depth = depth * 0.5
        cutout_center_x = sink_position_x + sink_width / 2

        bpy.ops.mesh.primitive_cube_add(
            size=1,
            location=(
                cutout_center_x,
                center_y,
                top_z,
            ),
        )
        cutout = bpy.context.active_object
        cutout.name = "SinkCutout"
        cutout.scale = (cutout_width / 2, cutout_depth / 2, thickness)
        bpy.ops.object.transform_apply(scale=True)

        # Boolean difference
        mod = countertop.modifiers.new(name="SinkCutout", type="BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cutout
        bpy.context.view_layer.objects.active = countertop
        bpy.ops.object.modifier_apply(modifier="SinkCutout")

        # Hide cutout helper
        bpy.data.objects.remove(cutout, do_unlink=True)

    return countertop
