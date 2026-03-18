"""Upper (wall) cabinet geometry generator.

Standard Korean kitchen upper cabinet:
- Height: 720mm
- Depth: 350mm
- Mounted flush with ceiling (molding 60mm)
- Backsplash gap: 500mm above countertop
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


# Standard dimensions (mm)
UPPER_HEIGHT = 720
UPPER_DEPTH = 350
MOLDING = 60
WALL_HEIGHT = 2400  # default ceiling height


def create_upper_cabinet(
    width,
    depth=UPPER_DEPTH,
    height=UPPER_HEIGHT,
    is_2door=True,
    door_state="closed",
    position_x=0,
    position_y=0,
    wall_height=WALL_HEIGHT,
    molding=MOLDING,
):
    """Create an upper (wall-mounted) cabinet.

    Positioned flush with ceiling minus molding.
    Bottom edge = wall_height - molding - height.

    Args:
        width: Cabinet width in mm
        depth: Cabinet depth (default 350mm)
        height: Cabinet height (default 720mm)
        is_2door: 2-door or 1-door
        door_state: "closed" or "open"
        position_x: X position from origin (mm)
        position_y: Y position (depth direction) (mm)
        wall_height: Ceiling height (mm)
        molding: Crown molding gap (mm)

    Returns:
        Parent empty object
    """
    inset = 2
    door_thickness = 18
    panel_thickness = 18

    # Bottom edge of upper cabinet
    bottom_z = wall_height - molding - height

    # Parent empty
    bpy.ops.object.empty_add(
        type="PLAIN_AXES",
        location=(position_x + width / 2, -position_y - depth / 2, bottom_z + height / 2),
    )
    parent = bpy.context.active_object
    parent.name = f"UpperCabinet_{position_x}"

    # Body
    body = _add_box(
        f"UBody_{position_x}",
        width - panel_thickness * 2,
        depth - panel_thickness,
        height,
        location=(position_x + width / 2, -position_y - depth / 2, bottom_z + height / 2),
    )
    body.parent = parent

    # Side panels
    for side, sx in [
        ("L", position_x + panel_thickness / 2),
        ("R", position_x + width - panel_thickness / 2),
    ]:
        panel = _add_box(
            f"USidePanel_{side}_{position_x}",
            panel_thickness,
            depth,
            height,
            location=(sx, -position_y - depth / 2, bottom_z + height / 2),
        )
        panel.parent = parent

    # Doors
    if is_2door:
        door_width = (width - inset * 3) / 2
        door_positions = [
            (position_x + inset + door_width / 2, "L"),
            (position_x + width - inset - door_width / 2, "R"),
        ]
    else:
        door_width = width - inset * 2
        door_positions = [(position_x + width / 2, "C")]

    for dx, hinge_side in door_positions:
        door = _add_box(
            f"UDoor_{hinge_side}_{position_x}",
            door_width,
            door_thickness,
            height - inset * 2,
            location=(
                dx,
                -position_y - door_thickness / 2,
                bottom_z + inset + (height - inset * 2) / 2,
            ),
        )
        door.parent = parent

        if door_state == "open":
            if hinge_side == "L":
                pivot_x = position_x + inset
                door.rotation_euler.z = math.radians(90)
            elif hinge_side == "R":
                pivot_x = position_x + width - inset
                door.rotation_euler.z = math.radians(-90)
            else:
                pivot_x = position_x + inset
                door.rotation_euler.z = math.radians(90)

            offset_x = pivot_x - dx
            door.location.x = pivot_x
            door.data.transform(__import__("mathutils").Matrix.Translation((-offset_x, 0, 0)))

    # Shelves (visible when open)
    if door_state == "open":
        for i, ratio in enumerate([0.35, 0.65]):
            shelf = _add_box(
                f"UShelf_{i}_{position_x}",
                width - panel_thickness * 2 - 4,
                depth - panel_thickness - 10,
                panel_thickness,
                location=(
                    position_x + width / 2,
                    -position_y - depth / 2,
                    bottom_z + height * ratio,
                ),
            )
            shelf.parent = parent

    return parent
