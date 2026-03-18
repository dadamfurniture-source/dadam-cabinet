"""Blender 3D rendering pipeline for cabinet scenes.

Public API:
    render_cabinet_scene() — async function that renders a cabinet layout
    to a transparent-background PNG via Blender headless.
"""

from agents.blender.renderer import render_cabinet_scene

__all__ = ["render_cabinet_scene"]
