"""Style-based material definitions for Blender Workbench renderer.

Workbench uses viewport display colors (no shader nodes needed).
AI harmonization adds photorealistic textures in post-processing.
"""

import bpy

# Style material definitions
# Each style maps component names to (R, G, B) tuples and roughness
STYLE_MATERIALS = {
    "modern": {
        "door": (0.95, 0.95, 0.95),  # white
        "body": (0.90, 0.90, 0.88),  # off-white
        "countertop": (0.85, 0.85, 0.85),  # light gray
        "handle": (0.15, 0.15, 0.15),  # dark nickel
        "toe_kick": (0.12, 0.12, 0.12),  # near black
        "sink_basin": (0.75, 0.77, 0.78),  # stainless steel
        "faucet": (0.78, 0.80, 0.82),  # chrome
        "cooktop_glass": (0.05, 0.05, 0.05),  # black glass
        "burner_ring": (0.3, 0.3, 0.3),  # dark gray
        "roughness": 0.3,
    },
    "nordic": {
        "door": (0.85, 0.78, 0.65),  # light oak
        "body": (0.80, 0.73, 0.60),
        "countertop": (0.90, 0.88, 0.85),  # light marble
        "handle": (0.70, 0.70, 0.72),  # brushed silver
        "toe_kick": (0.15, 0.15, 0.15),
        "sink_basin": (0.75, 0.77, 0.78),
        "faucet": (0.78, 0.80, 0.82),
        "cooktop_glass": (0.05, 0.05, 0.05),
        "burner_ring": (0.3, 0.3, 0.3),
        "roughness": 0.6,
    },
    "classic": {
        "door": (0.55, 0.38, 0.22),  # warm brown
        "body": (0.50, 0.35, 0.20),
        "countertop": (0.82, 0.75, 0.68),  # warm marble
        "handle": (0.72, 0.53, 0.04),  # brass
        "toe_kick": (0.20, 0.14, 0.08),
        "sink_basin": (0.75, 0.77, 0.78),
        "faucet": (0.72, 0.53, 0.04),  # brass faucet
        "cooktop_glass": (0.05, 0.05, 0.05),
        "burner_ring": (0.3, 0.3, 0.3),
        "roughness": 0.5,
    },
    "natural": {
        "door": (0.70, 0.58, 0.42),  # natural wood
        "body": (0.65, 0.54, 0.38),
        "countertop": (0.60, 0.55, 0.48),  # butcher block
        "handle": (0.40, 0.35, 0.30),  # dark bronze
        "toe_kick": (0.18, 0.15, 0.12),
        "sink_basin": (0.75, 0.77, 0.78),
        "faucet": (0.40, 0.38, 0.35),
        "cooktop_glass": (0.05, 0.05, 0.05),
        "burner_ring": (0.3, 0.3, 0.3),
        "roughness": 0.7,
    },
    "industrial": {
        "door": (0.18, 0.18, 0.18),  # charcoal
        "body": (0.20, 0.20, 0.20),
        "countertop": (0.30, 0.30, 0.30),  # dark concrete
        "handle": (0.10, 0.10, 0.10),  # matte black
        "toe_kick": (0.08, 0.08, 0.08),
        "sink_basin": (0.70, 0.72, 0.73),
        "faucet": (0.10, 0.10, 0.10),  # matte black
        "cooktop_glass": (0.03, 0.03, 0.03),
        "burner_ring": (0.25, 0.25, 0.25),
        "roughness": 0.8,
    },
    "luxury": {
        "door": (0.95, 0.93, 0.88),  # pearl white / champagne
        "body": (0.90, 0.88, 0.83),
        "countertop": (0.92, 0.90, 0.88),  # calacatta marble
        "handle": (0.83, 0.69, 0.22),  # gold
        "toe_kick": (0.15, 0.13, 0.10),
        "sink_basin": (0.80, 0.82, 0.83),
        "faucet": (0.83, 0.69, 0.22),  # gold faucet
        "cooktop_glass": (0.05, 0.05, 0.05),
        "burner_ring": (0.3, 0.3, 0.3),
        "roughness": 0.15,  # high gloss
    },
}


def _get_or_create_material(name, color, roughness=0.5):
    """Get existing material or create a new one with viewport display color."""
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name=name)

    mat.diffuse_color = (*color, 1.0)  # RGBA
    mat.roughness = roughness
    # Workbench uses viewport display settings
    return mat


def _classify_object(obj_name):
    """Classify an object by its name prefix to determine which material to apply."""
    name_lower = obj_name.lower()

    if "door_" in name_lower or "udoor_" in name_lower or "drawerfront" in name_lower:
        return "door"
    if "body_" in name_lower or "ubody_" in name_lower:
        return "body"
    if "sidepanel" in name_lower or "usidepanel" in name_lower or "drawerside" in name_lower:
        return "body"
    if "countertop" in name_lower:
        return "countertop"
    if "handle" in name_lower:
        return "handle"
    if "toekick" in name_lower:
        return "toe_kick"
    if "sinkbasin" in name_lower or "sinkrim" in name_lower or "drain" in name_lower:
        return "sink_basin"
    if "faucet" in name_lower:
        return "faucet"
    if "cooktopglass" in name_lower:
        return "cooktop_glass"
    if "burner" in name_lower:
        return "burner_ring"
    if "shelf" in name_lower or "ushelf" in name_lower or "drawerbox" in name_lower:
        return "body"

    return "body"  # default


def apply_style_materials(style="modern"):
    """Apply style-specific materials to all objects in the scene.

    Iterates over all mesh objects, classifies them by name,
    and assigns the corresponding material from STYLE_MATERIALS.

    Args:
        style: Style name (must be a key in STYLE_MATERIALS)
    """
    palette = STYLE_MATERIALS.get(style, STYLE_MATERIALS["modern"])
    roughness = palette.get("roughness", 0.5)

    # Create all materials for this style
    materials = {}
    for component_name, color in palette.items():
        if component_name == "roughness":
            continue
        mat_name = f"{style}_{component_name}"
        materials[component_name] = _get_or_create_material(mat_name, color, roughness)

    # Apply to all mesh objects
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue

        component = _classify_object(obj.name)
        mat = materials.get(component, materials.get("body"))
        if mat is None:
            continue

        # Clear existing materials and assign
        obj.data.materials.clear()
        obj.data.materials.append(mat)
