"""Fallback exporter: run the model's geometry with plain build123d and write STEP/GLB.

cadgen's model runner fails in this environment (its import hook treats cadgen's own
modules as model code), so this calls build123d's exporters directly.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cadgen import build123d as bd  # noqa: E402
import lower_cabinet_2d as m  # noqa: E402

shape = bd.Compound(children=m.cabinet_parts(), label=m.K(0xd558, 0xbd80, 0xc7a5) + "_2D_900")
(HERE / "out").mkdir(exist_ok=True)
bd.export_step(shape, str(HERE / "out" / "lower_cabinet_2d.step"))
bd.export_gltf(shape, str(HERE / "out" / "lower_cabinet_2d.glb"), binary=True)
bb = shape.bounding_box()
print("bbox", round(bb.min.X, 1), round(bb.min.Y, 1), round(bb.min.Z, 1), "->", round(bb.max.X, 1), round(bb.max.Y, 1), round(bb.max.Z, 1))
print("parts", len(shape.children))
