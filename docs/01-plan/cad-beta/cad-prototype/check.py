"""Checks on the saved STEP: part sizes against the BOM and pairwise overlaps."""
import itertools
from pathlib import Path

from cadgen import build123d as bd

HERE = Path(__file__).resolve().parent
shape = bd.import_step(str(HERE / "out" / "lower_cabinet_2d.step"))
parts = [s for s in shape.solids()]
print("solids", len(parts))
for s in parts:
    bb = s.bounding_box()
    dims = sorted([round(bb.size.X, 1), round(bb.size.Y, 1), round(bb.size.Z, 1)])
    print("size", dims)
overlaps = []
for a, b in itertools.combinations(range(len(parts)), 2):
    v = parts[a].intersect(parts[b])
    vol = sum(x.volume for x in v.solids()) if v is not None else 0
    if vol > 1e-3:
        overlaps.append((a, b, round(vol, 1)))
print("overlaps", overlaps)
