"""Cooktop/induction module geometry.

Creates an induction cooktop surface with burner rings.
The cabinet below a cooktop MUST have drawers (not doors) — this is
enforced in scene_builder.py by using create_drawer_cabinet() for cooktop modules.
"""

import bpy


def create_cooktop_module(
    width=600,
    depth=580,
    position_x=0,
    position_y=0,
    countertop_z=870,
):
    """Create a cooktop/induction surface on the countertop.

    Args:
        width: Module width (default 600mm)
        depth: Module depth (default 580mm)
        position_x: X position from origin (mm)
        position_y: Y position (mm)
        countertop_z: Countertop surface height (mm)

    Returns:
        Parent empty object
    """
    center_x = position_x + width / 2
    center_y = -position_y - depth / 2

    bpy.ops.object.empty_add(
        type="PLAIN_AXES",
        location=(center_x, center_y, countertop_z),
    )
    parent = bpy.context.active_object
    parent.name = f"CooktopModule_{position_x}"

    # Glass surface (dark glass panel inset into countertop)
    glass_width = width * 0.85
    glass_depth = depth * 0.65
    glass_height = 5  # flush with countertop, slight raise

    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(
            center_x,
            center_y,
            countertop_z + glass_height / 2,
        ),
    )
    glass = bpy.context.active_object
    glass.name = f"CooktopGlass_{position_x}"
    glass.scale = (glass_width / 2, glass_depth / 2, glass_height / 2)
    bpy.ops.object.transform_apply(scale=True)
    glass.parent = parent

    # Burner rings (2 or 4 depending on width)
    num_burners = 4 if width >= 600 else 2
    ring_radius_large = min(width, depth) * 0.15
    ring_radius_small = ring_radius_large * 0.7

    if num_burners == 4:
        # 2x2 grid
        offsets = [
            (-glass_width * 0.22, -glass_depth * 0.22, ring_radius_large),
            (glass_width * 0.22, -glass_depth * 0.22, ring_radius_small),
            (-glass_width * 0.22, glass_depth * 0.22, ring_radius_small),
            (glass_width * 0.22, glass_depth * 0.22, ring_radius_large),
        ]
    else:
        offsets = [
            (-glass_width * 0.2, 0, ring_radius_large),
            (glass_width * 0.2, 0, ring_radius_small),
        ]

    for i, (ox, oy, radius) in enumerate(offsets):
        bpy.ops.mesh.primitive_torus_add(
            major_radius=radius,
            minor_radius=3,
            location=(center_x + ox, center_y + oy, countertop_z + glass_height + 1),
        )
        ring = bpy.context.active_object
        ring.name = f"Burner_{i}_{position_x}"
        ring.parent = parent

    return parent


def create_drawer_cabinet(
    width,
    depth=580,
    height=870,
    toe_kick=150,
    num_drawers=2,
    door_state="closed",
    position_x=0,
    position_y=0,
):
    """Create a cabinet with drawers (for under cooktop/induction).

    This ensures the rule: "cabinets under cooktop must be DRAWERS, not doors."

    Args:
        width: Cabinet width (mm)
        depth: Depth (mm)
        height: Total height including toe kick (mm)
        toe_kick: Toe kick height (mm)
        num_drawers: Number of drawer tiers (default 2)
        door_state: "closed" or "open" (drawers pulled out)
        position_x: X position (mm)
        position_y: Y position (mm)

    Returns:
        Parent empty object
    """
    cabinet_height = height - toe_kick
    drawer_height = cabinet_height / num_drawers
    panel_thickness = 18
    drawer_front_thickness = 18
    inset = 2

    bpy.ops.object.empty_add(
        type="PLAIN_AXES",
        location=(position_x + width / 2, -position_y - depth / 2, height / 2),
    )
    parent = bpy.context.active_object
    parent.name = f"DrawerCabinet_{position_x}"

    # Side panels
    for side, sx in [
        ("L", position_x + panel_thickness / 2),
        ("R", position_x + width - panel_thickness / 2),
    ]:
        bpy.ops.mesh.primitive_cube_add(
            size=1,
            location=(
                sx,
                -position_y - depth / 2,
                toe_kick + cabinet_height / 2,
            ),
        )
        panel = bpy.context.active_object
        panel.name = f"DrawerSide_{side}_{position_x}"
        panel.scale = (panel_thickness / 2, depth / 2, cabinet_height / 2)
        bpy.ops.object.transform_apply(scale=True)
        panel.parent = parent

    # Drawers
    for i in range(num_drawers):
        dz = toe_kick + i * drawer_height + drawer_height / 2

        # Drawer front panel
        front_width = width - inset * 2
        pull_out = depth * 0.6 if door_state == "open" else 0

        bpy.ops.mesh.primitive_cube_add(
            size=1,
            location=(
                position_x + width / 2,
                -position_y - drawer_front_thickness / 2 + pull_out,
                dz,
            ),
        )
        front = bpy.context.active_object
        front.name = f"DrawerFront_{i}_{position_x}"
        front.scale = (front_width / 2, drawer_front_thickness / 2, (drawer_height - inset) / 2)
        bpy.ops.object.transform_apply(scale=True)
        front.parent = parent

        # Drawer box (visible when open)
        if door_state == "open":
            box_width = width - panel_thickness * 2 - 10
            box_depth = depth * 0.8
            box_height = drawer_height - 30

            bpy.ops.mesh.primitive_cube_add(
                size=1,
                location=(
                    position_x + width / 2,
                    -position_y - depth / 2 + pull_out,
                    dz,
                ),
            )
            box = bpy.context.active_object
            box.name = f"DrawerBox_{i}_{position_x}"
            box.scale = (box_width / 2, box_depth / 2, box_height / 2)
            bpy.ops.object.transform_apply(scale=True)
            box.parent = parent

    return parent
