"""Cabinet handle geometry — wood channel (목찬넬) handles.

All styles use wood channel handles: a routed groove along the top edge
of the door/drawer front. No metal handles or knobs.
"""

import bpy

# All styles use wood channel — color matches cabinet body
HANDLE_STYLES = {
    "modern": {"color": (0.9, 0.9, 0.9)},      # white
    "nordic": {"color": (0.75, 0.65, 0.5)},     # light wood
    "classic": {"color": (0.5, 0.35, 0.2)},     # brown wood
    "natural": {"color": (0.6, 0.5, 0.35)},     # natural wood
    "industrial": {"color": (0.15, 0.15, 0.15)}, # dark charcoal
    "luxury": {"color": (0.95, 0.95, 0.95)},    # pearl white
}


def create_handle(
    style="modern",
    position=(0, 0, 0),
    vertical=True,
):
    """Create a wood channel handle (routed groove along top edge).

    The channel is a thin rectangular groove cut into the top edge of the
    door/drawer front, allowing fingers to grip and pull open.

    Args:
        style: Style name (determines groove color)
        position: (x, y, z) center of the door/drawer front
        vertical: True for door (groove at top), False for drawer (groove at top)

    Returns:
        Channel groove mesh object
    """
    config = HANDLE_STYLES.get(style, HANDLE_STYLES["modern"])

    x, y, z = position

    # Wood channel: thin groove along the top edge of door/drawer
    # Groove dimensions
    groove_width = 200 if vertical else 300  # wider for drawers
    groove_height = 20   # thin slot
    groove_depth = 15    # how deep the groove is cut

    # Position groove at the TOP edge of the door
    groove_z = z + 30 if vertical else z + 15

    bpy.ops.mesh.primitive_cube_add(
        size=1,
        location=(x, y - groove_depth / 2, groove_z),
    )
    groove = bpy.context.active_object
    groove.name = f"WoodChannel_{x:.0f}_{z:.0f}"
    groove.scale = (groove_width / 2, groove_depth / 2, groove_height / 2)
    bpy.ops.object.transform_apply(scale=True)

    # Apply dark shadow color to suggest depth
    mat = bpy.data.materials.new(name=f"ChannelShadow_{x:.0f}")
    r, g, b = config["color"]
    # Darken slightly for groove shadow effect
    mat.diffuse_color = (r * 0.4, g * 0.4, b * 0.4, 1.0)
    groove.data.materials.append(mat)

    return groove
