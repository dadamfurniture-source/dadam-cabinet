"""Parametric 3D geometry generators for cabinet components.

Each module creates Blender mesh objects with correct dimensions (mm scale).
"""

from agents.blender.geometry.base_cabinet import create_base_cabinet
from agents.blender.geometry.cooktop import create_cooktop_module
from agents.blender.geometry.countertop import create_countertop
from agents.blender.geometry.handles import HANDLE_STYLES, create_handle
from agents.blender.geometry.sink import create_sink_module
from agents.blender.geometry.toe_kick import create_toe_kick
from agents.blender.geometry.upper_cabinet import create_upper_cabinet

__all__ = [
    "create_base_cabinet",
    "create_upper_cabinet",
    "create_sink_module",
    "create_cooktop_module",
    "create_countertop",
    "create_handle",
    "create_toe_kick",
    "HANDLE_STYLES",
]
