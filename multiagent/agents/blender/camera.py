"""Camera setup for cabinet layout reference renders.

Since the render is used as a REFERENCE IMAGE (not pixel-aligned composite),
we use a simple front-facing orthographic-like view that clearly shows
the full cabinet layout from wall edge to wall edge.
"""

import bpy

# Default camera parameters
DEFAULT_CAMERA = {
    "camera_height_mm": 1300,
    "camera_distance_mm": 3000,
    "camera_tilt_deg": -2,
    "focal_length_mm": 28,
}


def setup_camera(camera_params, wall_width=3000, wall_height=2400):
    """Set up camera for a clean front-facing view of the full cabinet layout.

    Uses orthographic camera to show exact proportions without perspective
    distortion. This makes it easier for Gemini to understand the layout.

    Args:
        camera_params: Dict (currently unused, kept for API compat)
        wall_width: Total wall width (mm)
        wall_height: Wall height (mm)

    Returns:
        Blender camera object
    """
    cam_data = bpy.data.cameras.new("SceneCamera")

    # Use orthographic for clean reference render
    cam_data.type = "ORTHO"
    # Scale to fit the wall width with some padding
    padding = 100  # mm on each side
    cam_data.ortho_scale = max(wall_width + padding * 2, wall_height + padding * 2)

    cam_obj = bpy.data.objects.new("SceneCamera", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)

    # Position: centered on wall, looking straight at it
    cam_obj.location = (
        wall_width / 2,   # centered horizontally
        5000,             # far enough in front
        wall_height / 2,  # centered vertically
    )

    # Point straight at the wall (rotate to face -Y direction)
    import math

    cam_obj.rotation_euler = (math.radians(90), 0, 0)

    bpy.context.scene.camera = cam_obj
    return cam_obj
