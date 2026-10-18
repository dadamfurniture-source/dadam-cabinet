"""Export the sink set with plain build123d (cadgen's model runner fails here) and check overlaps."""
import itertools
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cadgen import build123d as bd  # noqa: E402
import sink_set as m  # noqa: E402

(HERE / "out").mkdir(exist_ok=True)
shape = bd.Compound(children=m.sink_parts(), label="sink_set_4100")
bd.export_step(shape, str(HERE / "out" / "sink_set.step"))
bd.export_gltf(shape, str(HERE / "out" / "sink_set.glb"), binary=True)
bb = shape.bounding_box()
print("bbox", [round(v, 1) for v in (bb.min.X, bb.min.Y, bb.min.Z, bb.max.X, bb.max.Y, bb.max.Z)])
def leaves(c, path=""):
    kids = list(getattr(c, "children", []) or [])
    if not kids:
        yield (path + "/" + (c.label or "?"), c)
        return
    for k in kids:
        yield from leaves(k, path + "/" + (c.label or ""))


named = list(leaves(shape))
solids = [s for _, s in named]
names = [n for n, _ in named]
print("solids", len(solids))
overlaps = []
for a, b in itertools.combinations(range(len(solids)), 2):
    if not solids[a].bounding_box().overlaps(solids[b].bounding_box()):
        continue
    v = solids[a].intersect(solids[b])
    vol = sum(x.volume for x in v.solids()) if v is not None else 0
    if vol > 1e-3:
        overlaps.append((names[a], names[b], round(vol)))
print("overlaps", len(overlaps))
for o in overlaps[:30]:
    print(" ", o)
