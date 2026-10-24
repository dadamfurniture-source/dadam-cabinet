"""CAD oracle (Dadam CAD beta PR8, docs/01-plan/planner-cad.plan.md section PR8).

Reads only the JSON written by tools/cad/dump-assembly.js (schema dadam.cad-oracle/1),
builds every panel as an OCC solid with build123d, and cross-checks the JS assembly checker:

  1. solid count per module == part count (a notch must not split a panel)
  2. panel volume == JS volume (sum of boxes after through-notches) within tolerance.volumeRel
  3. overlapping pairs (volume > limits.minVolume and depth > limits.minDepth) == JS pairs,
     and each pair's overlap volume within tolerance.volumeRel

No rule numbers live here: axes, limits and tolerance come from the JSON. Source is ASCII only
(cadgen reads sources as cp949 on Windows). The literal-free rule is guarded by
__tests__/cad-oracle-source.test.js.

  uv run --no-project --python 3.13 --with build123d==0.11.1 --with cadquery-ocp-novtk==7.9.3.1.1 \
    python tools/cad/build_from_spec.py <dumpDir> --out <outDir> [--strict] [--no-export]

Writes <outDir>/report.json, <outDir>/<fixture>.step and .glb. Exit code is non-zero only on
a crash, or on a mismatch with --strict (the CI job runs with --strict since 2026-10-24).
"""

import argparse
import glob
import json
import os
import sys

from build123d import Align, Box, Compound, Pos, export_gltf, export_step

AXIS = range(len("xyz"))
ALIGN_MIN = tuple(Align.MIN for _ in AXIS)


def world(frame, axes, u, v, n):
    """Panel-local (u, v, n) -> module-local point, frame axes are signed unit vectors."""
    o, uu, vv, nn = frame["o"], axes[frame["u"]], axes[frame["v"]], axes[frame["n"]]
    return [o[k] + uu[k] * u + vv[k] * v + nn[k] * n for k in AXIS]


def box_between(p, q):
    lo = [min(p[k], q[k]) for k in AXIS]
    size = [abs(q[k] - p[k]) for k in AXIS]
    return Pos(*lo) * Box(*size, align=ALIGN_MIN)


def panel_solid(part, axes):
    frame, t = part["frame"], part["t"]
    w, h = part["cut"]["w"], part["cut"]["h"]
    shape = box_between(world(frame, axes, 0, 0, 0), world(frame, axes, w, h, t))
    for f in part["notches"]:
        cut = box_between(world(frame, axes, f["u0"], f["v0"], 0), world(frame, axes, f["u1"], f["v1"], t))
        shape = shape - cut
    return shape


def bbox_of(shape):
    bb = shape.bounding_box()
    return [bb.min.X, bb.min.Y, bb.min.Z], [bb.max.X, bb.max.Y, bb.max.Z]


def boxes_apart(a, b):
    (alo, ahi), (blo, bhi) = a, b
    return any(blo[k] >= ahi[k] or alo[k] >= bhi[k] for k in AXIS)


def overlap_of(sa, sb):
    """(volume, depth) of the intersection. depth = thinnest side of the intersection box."""
    inter = sa & sb
    solids = inter.solids() if inter is not None else []
    volume = sum(s.volume for s in solids)
    if not solids or volume <= 0:
        return 0, 0
    lo, hi = bbox_of(Compound(solids))
    return volume, min(hi[k] - lo[k] for k in AXIS)


def rel_ok(got, want, rel):
    return abs(got - want) <= rel * max(abs(want), abs(got))


def check_module(mod, axes, limits, rel):
    problems = []
    built = []
    for part in mod["parts"]:
        shape = panel_solid(part, axes)
        solids = shape.solids()
        built.append((part, shape, bbox_of(shape)))
        if len(solids) != 1:
            problems.append({"code": "solid-count", "part": part["id"], "solids": len(solids)})
        if not rel_ok(shape.volume, part["volume"], rel):
            problems.append({"code": "volume", "part": part["id"], "occ": shape.volume, "js": part["volume"]})

    found = {}
    for i, (pa, sa, ba) in enumerate(built):
        for pb, sb, bb in built[i + 1:]:
            if boxes_apart(ba, bb):
                continue
            volume, depth = overlap_of(sa, sb)
            if volume > limits["minVolume"] and depth > limits["minDepth"]:
                key = tuple(sorted((pa["id"], pb["id"])))
                found[key] = {"volume": volume, "depth": depth}

    js = {tuple(sorted((o["a"], o["b"]))): o for o in mod["overlaps"]}
    for key in sorted(set(found) - set(js)):
        problems.append({"code": "overlap-occ-only", "pair": list(key), "occ": found[key]})
    for key in sorted(set(js) - set(found)):
        problems.append({"code": "overlap-js-only", "pair": list(key), "js": js[key]["volume"]})
    for key in sorted(set(js) & set(found)):
        if not rel_ok(found[key]["volume"], js[key]["volume"], rel):
            problems.append({"code": "overlap-volume", "pair": list(key), "occ": found[key]["volume"], "js": js[key]["volume"]})

    shapes = []
    for part, shape, _ in built:
        shape.label = "%s %s" % (part["id"], part["part"])
        shapes.append(shape)
    return {
        "moduleKey": mod["moduleKey"],
        "parts": len(mod["parts"]),
        "overlaps": len(found),
        "problems": problems,
    }, shapes


def layout(groups):
    """Modules are in their own local frames: lay them side by side along x for the exported file."""
    placed = []
    cursor = None
    for shapes in groups:
        if not shapes:
            continue
        lo, hi = bbox_of(Compound(shapes))
        shift = 0 if cursor is None else cursor - lo[0]
        placed.extend(Pos(shift, 0, 0) * s for s in shapes)
        cursor = hi[0] + shift
    return placed


def run_fixture(path, out_dir, export):
    with open(path, encoding="utf-8") as fh:
        dump = json.load(fh)
    if dump.get("schema") != "dadam.cad-oracle/1":
        raise SystemExit("%s: unknown schema %r" % (path, dump.get("schema")))
    axes, limits, rel = dump["axes"], dump["limits"], dump["tolerance"]["volumeRel"]
    modules, groups = [], []
    for mod in dump["modules"]:
        res, shapes = check_module(mod, axes, limits, rel)
        modules.append(res)
        groups.append(shapes)
    name = dump["fixture"]
    if export:
        placed = layout(groups)
        if placed:
            comp = Compound(placed)
            comp.label = name
            export_step(comp, os.path.join(out_dir, name + ".step"))
            export_gltf(comp, os.path.join(out_dir, name + ".glb"), binary=True)
    return {
        "fixture": name,
        "rulesVersion": dump.get("rulesVersion"),
        "modules": len(modules),
        "parts": sum(m["parts"] for m in modules),
        "overlaps": sum(m["overlaps"] for m in modules),
        "problems": [dict(p, moduleKey=m["moduleKey"]) for m in modules for p in m["problems"]],
    }


def summary_md(results):
    lines = ["## CAD oracle (build123d / OCC vs JS assembly check)", "",
             "| fixture | modules | parts | overlaps | mismatches |", "|---|---|---|---|---|"]
    for r in results:
        lines.append("| %s | %d | %d | %d | %d |" % (r["fixture"], r["modules"], r["parts"], r["overlaps"], len(r["problems"])))
    bad = [(r["fixture"], p) for r in results for p in r["problems"]]
    if bad:
        lines += ["", "### mismatches", ""]
        lines += ["- %s %s %s" % (f, p["code"], json.dumps(p, ensure_ascii=False)) for f, p in bad]
    return "\n".join(lines) + "\n"


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("dump_dir")
    ap.add_argument("--out", required=True)
    ap.add_argument("--strict", action="store_true", help="exit non-zero on any mismatch")
    ap.add_argument("--no-export", action="store_true", help="skip STEP/GLB files")
    args = ap.parse_args(argv)

    paths = sorted(glob.glob(os.path.join(args.dump_dir, "*.json")))
    if not paths:
        raise SystemExit("no dump json in %s" % args.dump_dir)
    os.makedirs(args.out, exist_ok=True)
    results = [run_fixture(p, args.out, not args.no_export) for p in paths]

    with open(os.path.join(args.out, "report.json"), "w", encoding="utf-8") as fh:
        json.dump({"schema": "dadam.cad-oracle-report/1", "results": results}, fh, ensure_ascii=False, indent=1)
    md = summary_md(results)
    sys.stdout.write(md)
    step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if step_summary:
        with open(step_summary, "a", encoding="utf-8") as fh:
            fh.write(md)
    mismatches = sum(len(r["problems"]) for r in results)
    return int(bool(args.strict and mismatches))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
