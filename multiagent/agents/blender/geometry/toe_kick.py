"""Toe kick (kick plate) geometry.

The recessed panel at the bottom of base cabinets.
Standard: 150mm height, set back ~50mm from door face.
"""

import bpy


def create_toe_kick(
    width,
    height=150,
    depth=580,
    setback=50,
    position_x=0,
    position_y=0,
):
    """Create a toe kick panel.

    Args:
        width: Width matching the cabinet above (mm)
        height: Kick plate height (default 150mm)
        depth: Cabinet depth (mm)
        setback: How far back from door face (mm)
        position_x: X position (mm)
        position_y: Y position (mm)

    Returns:
        Toe kick mesh object
    """
    kick_depth = depth - setback
    thickness = 12

    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(
            position_x + width / 2,
            -position_y - setback - kick_depth / 2,
            height / 2,
        ),
    )
    kick = bpy.context.active_object
    kick.name = f"ToeKick_{position_x}"
    kick.scale = (width / 2, thickness / 2, height / 2)
    bpy.ops.object.transform_apply(scale=True)

    return kick
