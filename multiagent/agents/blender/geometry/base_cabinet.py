"""Base (lower) cabinet geometry generator.

Standard Korean kitchen base cabinet:
- Height: 870mm (including toe kick 150mm)
- Depth: 580mm
- Door inset: 2mm per side
- Toe kick setback: 50mm
"""

import math

import bpy


def _add_box(name, width, height, depth, location=(0, 0, 0)):
    """Create a box mesh and return the object."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (width / 2, depth / 2, height / 2)
    bpy.ops.object.transform_apply(scale=True)
    return obj


def create_base_cabinet(
    width,
    depth=580,
    height=870,
    toe_kick=150,
    is_2door=True,
    door_state="closed",
    position_x=0,
    position_y=0,
):
    """Create a base cabinet with doors or drawers.

    Args:
        width: Cabinet width in mm
        depth: Cabinet depth in mm (default 580)
        height: Total height in mm (default 870, includes toe kick)
        toe_kick: Toe kick height in mm (default 150)
        is_2door: True for 2-door, False for 1-door
        door_state: "closed" or "open"
        position_x: X position from origin in mm
        position_y: Y position (depth direction) in mm

    Returns:
        Parent empty object containing all cabinet parts
    """
    # Scale factor: mm to Blender units (1 BU = 1mm)
    cabinet_height = height - toe_kick
    inset = 2  # door inset per side
    door_thickness = 18
    panel_thickness = 18

    # Parent empty
    bpy.ops.object.empty_add(
        type="PLAIN_AXES", location=(position_x + width / 2, -position_y - depth / 2, height / 2)
    )
    parent = bpy.context.active_object
    parent.name = f"BaseCabinet_{position_x}"

    # Cabinet box (body)
    body = _add_box(
        f"Body_{position_x}",
        width - panel_thickness * 2,  # inner width
        depth - panel_thickness,
        cabinet_height,
        location=(
            position_x + width / 2,
            -position_y - depth / 2,
            toe_kick + cabinet_height / 2,
        ),
    )
    body.parent = parent

    # Side panels
    for side, sx in [
        ("L", position_x + panel_thickness / 2),
        ("R", position_x + width - panel_thickness / 2),
    ]:
        panel = _add_box(
            f"SidePanel_{side}_{position_x}",
            panel_thickness,
            depth,
            cabinet_height,
            location=(sx, -position_y - depth / 2, toe_kick + cabinet_height / 2),
        )
        panel.parent = parent

    # Doors
    if is_2door:
        door_width = (width - inset * 3) / 2  # 3 gaps: left, center, right
        door_positions = [
            (position_x + inset + door_width / 2, "L"),
            (position_x + width - inset - door_width / 2, "R"),
        ]
    else:
        door_width = width - inset * 2
        door_positions = [(position_x + width / 2, "C")]

    for dx, hinge_side in door_positions:
        door = _add_box(
            f"Door_{hinge_side}_{position_x}",
            door_width,
            door_thickness,
            cabinet_height - inset * 2,
            location=(
                dx,
                -position_y - door_thickness / 2,
                toe_kick + inset + (cabinet_height - inset * 2) / 2,
            ),
        )
        door.parent = parent

        # Open state: rotate door around hinge edge
        if door_state == "open":
            # Set origin to hinge edge
            if hinge_side == "L":
                # Left hinge: pivot at left edge
                pivot_x = position_x + inset
                door.rotation_euler.z = math.radians(90)
            elif hinge_side == "R":
                # Right hinge: pivot at right edge
                pivot_x = position_x + width - inset
                door.rotation_euler.z = math.radians(-90)
            else:
                # Single door: left hinge by default
                pivot_x = position_x + inset
                door.rotation_euler.z = math.radians(90)

            # Move origin to pivot point
            offset_x = pivot_x - dx
            door.location.x = pivot_x
            # Adjust mesh offset via origin shift
            door.data.transform(__import__("mathutils").Matrix.Translation((-offset_x, 0, 0)))

    # Shelf (visible when door is open)
    if door_state == "open":
        shelf_y = cabinet_height * 0.5
        shelf = _add_box(
            f"Shelf_{position_x}",
            width - panel_thickness * 2 - 4,
            depth - panel_thickness - 20,
            panel_thickness,
            location=(
                position_x + width / 2,
                -position_y - depth / 2 - 10,
                toe_kick + shelf_y,
            ),
        )
        shelf.parent = parent

    return parent
