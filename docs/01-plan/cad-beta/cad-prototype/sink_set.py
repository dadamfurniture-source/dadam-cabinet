"""Dadam sink set (I-shape 4100) built from the sink golden BOM (test-utils/bom-golden/sink15).

Axes: X along the wall (left filler starts at 0), Y depth (cabinet body front = 0, wall = +553),
Z up from the floor. mm. Source is ASCII only (cadgen reads it with the Windows code page);
Korean labels come from code points through K().

Rules used (BOM extractors.js, owner decisions 2026-10-19):
  lower body: sides 550 x 708 notched 70 x 40 top-front for the wood channel, bottom (W-30) x 550,
    front band flat under the channel base, rear band flat at the top, back 3T (W-1) x (H-1) fixed
    BEHIND the sides (no sakuri), sag brace 70 x 608 at the centre flush with the front (W >= 800),
    shelf (W-30) x 535 only on plain storage, doors H - 30 = 678 (handleless, grip over the door top).
  upper body: sides 295 x 720 with sakuri, top/bottom (W-30) x 277, back (W-20) x 719 in the groove
    15 from the rear, bracing bands 70, sag brace 70 x 690 (W >= 700), 2 shelves (W-30) x 261,
    doors H + 15 = 735 hanging 15 below the body.
  line parts: legs 150, kick board 18T x 145, wood channel L (base 40 + face 52, MDF 18T) across the
    lower line, countertop 12T, left filler 30, crown molding 60 over the uppers (not the hood).
Simplified: the drawer bank fronts are stacked approximately and drawer boxes are not modelled;
the cooktop bay (600) and the hood bay (800) are left empty; hinges and rails are omitted.
"""
from __future__ import annotations

from cadgen import build123d as bd
from cadgen import glb, srgb, step


def K(*codes: int) -> str:
    """Korean text from code points (keeps this file ASCII)."""
    return "".join(map(chr, codes))


# ---- names -------------------------------------------------------------
N_SIDE = K(0xce21, 0xd310)
N_BOTTOM = K(0xc9c0, 0xd310)
N_TOP = K(0xcc9c, 0xd310)
N_BAND = K(0xbc34, 0xb4dc)
N_BACK = K(0xb4b7, 0xd310)
N_BRACE = K(0xcc98, 0xc9d0, 0xbc29, 0xc9c0, 0xbaa9)
N_SHELF = K(0xc120, 0xbc18)
N_DOOR = K(0xb3c4, 0xc5b4)
N_DRAWER = K(0xc11c, 0xb78d)
N_LEG = K(0xb2e4, 0xb9ac, 0xbc1c)
N_KICK = K(0xac78, 0xb808, 0xbc1b, 0xc774)
N_CHANNEL = K(0xbaa9, 0xcc2c, 0xb12c)
N_COUNTER = K(0xc0c1, 0xd310)
N_FILLER = K(0xd720, 0xb77c)
N_MOLD = K(0xc0c1, 0xbab0, 0xb529)
N_SINK = K(0xac1c, 0xc218, 0xb300)
N_DRAWERS = K(0xc11c, 0xb78d, 0xc7a5)
N_LOWER2D = K(0xd558, 0xbd80, 0xc7a5) + "(2D)"
N_UPPER = K(0xc0c1, 0xbd80, 0xc7a5)
N_OPEN = K(0xc624, 0xd508, 0xc7a5)
N_FRONT, N_REAR, N_L, N_R = K(0xc55e), K(0xb4a4), K(0xc88c), K(0xc6b0)

# ---- dimensions (sink15 golden) ----------------------------------------
T = 15.0
BACK_T = 3.0
MDF = 18.0
LEG_H = 150.0
LOW_H, LOW_D = 708.0, 550.0
UP_H, UP_D = 720.0, 295.0
TOP_T = 12.0
TOP_D = 600.0  # countertop depth (the test design says 650; 600 is the usual Dadam top)
MOLD_H = 60.0
TOTAL_H = 2310.0
FILLER_W = 30.0
NOTCH_H, NOTCH_D = 70.0, 40.0
CH_FACE_H = 52.0
BAND = 70.0
KICK_H = LEG_H - 5
KICK_SETBACK = 50.0  # kick board front face behind the body front
WALL_Y = LOW_D + BACK_T  # 553

# (name, width, kind) left to right, starting after the filler
LOWERS = [
    (N_SINK, 1000.0, "sink"),
    (N_DRAWERS, 800.0, "drawers"),
    (N_LOWER2D, 900.0, "storage"),
    ("EL", 400.0, "el"),
    (N_OPEN, 400.0, "open"),
    ("COOK", 600.0, "cook"),
]
UPPERS = [
    (N_UPPER + "(2D)", 900.0, 2),
    (N_UPPER + "(1D)", 600.0, 1),
    ("HOOD", 800.0, 0),
    (N_UPPER + "(2D)", 1200.0, 2),
]

PB_C = "#D9D4C7"
BACK_C = "#C9C2B2"
DOOR_C = "#F2F0EA"
CH_C = "#8A8F98"
TOP_C = "#E9E6E1"
LEG_C = "#3A3A3A"
KICK_C = "#B9B4AA"


def box(label: str, x: float, y: float, z: float, dx: float, dy: float, dz: float, hex_: str) -> bd.Solid:
    part = bd.Pos(x, y, z) * bd.Box(dx, dy, dz, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    part.label = label
    part.color = srgb(hex_)
    return part


def notched_side(label: str, x: float, z0: float) -> bd.Solid:
    body = bd.Pos(x, 0, z0) * bd.Box(T, LOW_D, LOW_H, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    cut = bd.Pos(x - 1, -1, z0 + LOW_H - NOTCH_H) * bd.Box(T + 2, NOTCH_D + 1, NOTCH_H + 1, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    part = body - cut
    part.label = label
    part.color = srgb(PB_C)
    return part


def lower_cabinet(name: str, x0: float, W: float, kind: str) -> bd.Compound:
    z0 = LEG_H
    inner = W - 2 * T
    parts = [
        notched_side(N_SIDE + "_" + N_L, x0, z0),
        notched_side(N_SIDE + "_" + N_R, x0 + W - T, z0),
        box(N_BOTTOM, x0 + T, 0, z0, inner, LOW_D, T, PB_C),
        box(N_BAND + "_" + N_FRONT, x0 + T, 0, z0 + LOW_H - NOTCH_H - T, inner, BAND, T, PB_C),
        box(N_BAND + "_" + N_REAR, x0 + T, LOW_D - BAND, z0 + LOW_H - T, inner, BAND, T, PB_C),
        box(N_BACK, x0 + 0.5, LOW_D, z0 + 0.5, W - 1, BACK_T, LOW_H - 1, BACK_C),
    ]
    if W >= 800:
        # brace flush with the front behind the doors; on the drawer bank the drawers need the front,
        # so it stands against the back there (position to be confirmed by the owner)
        by = LOW_D - T if kind == "drawers" else 0
        parts.append(box(N_BRACE, x0 + W / 2 - BAND / 2, by, z0 + T, BAND, T, LOW_H - 2 * T - NOTCH_H, PB_C))
    if kind == "storage":
        parts.append(box(N_SHELF, x0 + T, LOW_D - (LOW_D - T), z0 + LOW_H / 2 - T / 2, inner, LOW_D - T, T, PB_C))
    door_h = LOW_H - 30
    if kind in ("sink", "storage"):
        dw = W / 2 - 4
        gap = (W - 2 * dw) / 3
        parts.append(box(N_DOOR + "_" + N_L, x0 + gap, -MDF, z0, dw, MDF, door_h, DOOR_C))
        parts.append(box(N_DOOR + "_" + N_R, x0 + 2 * gap + dw, -MDF, z0, dw, MDF, door_h, DOOR_C))
    elif kind == "el":
        parts.append(box(N_DOOR, x0 + 2, -MDF, z0, W - 4, MDF, door_h, DOOR_C))
    elif kind == "drawers":
        # BOM: door 796 x 244 on top, two drawer fronts 796 x 200 below, a mid wood channel (90 x 40 notch)
        fw = W - 4
        parts.append(box(N_DRAWER + "1", x0 + 2, -MDF, z0, fw, MDF, 200, DOOR_C))
        parts.append(box(N_DRAWER + "2", x0 + 2, -MDF, z0 + 202, fw, MDF, 200, DOOR_C))
        parts.append(box(N_DOOR, x0 + 2, -MDF, z0 + door_h - 244, fw, MDF, 244, DOOR_C))
        mid_z = z0 + 402
        parts.append(box(N_CHANNEL + "_mid_base", x0 + T, 0, mid_z, inner, NOTCH_D, MDF, CH_C))
        parts.append(box(N_CHANNEL + "_mid_face", x0 + T, NOTCH_D - MDF, mid_z + MDF, inner, MDF, 72, CH_C))
    return bd.Compound(children=parts, label=name)


def legs_for(x0: float, W: float) -> list:
    out = []
    xs = [x0 + 60, x0 + W - 60] + ([x0 + W / 2] if W >= 800 else [])
    for i, x in enumerate(xs):
        for j, y in enumerate((110.0, LOW_D - 60)):  # front legs behind the kick board
            leg = bd.Pos(x, y, 0) * bd.Cylinder(20, LEG_H, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
            leg.label = N_LEG + str(i * 2 + j + 1)
            leg.color = srgb(LEG_C)
            out.append(leg)
    return out


def grooved_side(label: str, x: float, y0: float, z0: float, groove_dx: float) -> bd.Solid:
    """Upper side panel with the sakuri groove (3 wide, 5 deep, 15 from the rear) for the back."""
    body = bd.Pos(x, y0, z0) * bd.Box(T, UP_D, UP_H, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    groove = bd.Pos(groove_dx, WALL_Y - 15 - BACK_T, z0 - 1) * bd.Box(5, BACK_T, UP_H + 2, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    part = body - groove
    part.label = label
    part.color = srgb(PB_C)
    return part


def upper_cabinet(name: str, x0: float, W: float, doors: int) -> bd.Compound:
    z0 = TOTAL_H - MOLD_H - UP_H  # 1530
    y0 = WALL_Y - UP_D  # body front
    inner = W - 2 * T
    panel_d = UP_D - 18
    parts = [
        grooved_side(N_SIDE + "_" + N_L, x0, y0, z0, x0 + T - 5),
        grooved_side(N_SIDE + "_" + N_R, x0 + W - T, y0, z0, x0 + W - T),
        box(N_TOP, x0 + T, y0, z0 + UP_H - T, inner, panel_d, T, PB_C),
        box(N_BOTTOM, x0 + T, y0, z0, inner, panel_d, T, PB_C),
        box(N_BACK, x0 + 10, WALL_Y - 15 - BACK_T, z0 + 0.5, W - 20, BACK_T, UP_H - 1, BACK_C),
        box(N_BAND + "_" + N_REAR + "_top", x0 + T, WALL_Y - 15 - BACK_T - T, z0 + UP_H - T - BAND, inner, T, BAND, PB_C),
        box(N_BAND + "_" + N_REAR + "_bottom", x0 + T, WALL_Y - 15 - BACK_T - T, z0 + T, inner, T, BAND, PB_C),
    ]
    if W >= 700:
        parts.append(box(N_BRACE, x0 + W / 2 - BAND / 2, y0, z0 + T, BAND, T, UP_H - 2 * T, PB_C))
    for k, sz in enumerate((z0 + UP_H / 3, z0 + 2 * UP_H / 3)):
        parts.append(box(N_SHELF + str(k + 1), x0 + T, y0 + (T if W >= 700 else 0), sz, inner, 261, T, PB_C))
    door_h = UP_H + 15
    dw = W / doors - 4 if doors else 0
    for k in range(doors):
        parts.append(box(N_DOOR + str(k + 1), x0 + 2 + k * (dw + 4), y0 - MDF, z0 - 15, dw, MDF, door_h, DOOR_C))
    return bd.Compound(children=parts, label=name)


def sink_parts() -> list:
    items = []
    x = FILLER_W
    line_x0 = x
    cab_w = 0.0
    for name, W, kind in LOWERS:
        if kind != "cook":
            items.append(lower_cabinet(name, x, W, kind))
            items.extend(legs_for(x, W))
            cab_w = x + W - line_x0
        x += W
    line_end = x
    # wood channel L and kick board across the cabinet run (BOM: 3500, the cooktop bay excluded)
    ch_z = LEG_H + LOW_H - NOTCH_H
    items.append(box(N_CHANNEL + "_base", line_x0, 0, ch_z, cab_w, NOTCH_D, MDF, CH_C))
    items.append(box(N_CHANNEL + "_face", line_x0, NOTCH_D - MDF, ch_z + MDF, cab_w, MDF, CH_FACE_H, CH_C))
    items.append(box(N_KICK, line_x0, KICK_SETBACK, 0, cab_w, MDF, KICK_H, KICK_C))
    # countertop: whole line incl. filler, front overhang past the doors
    items.append(box(N_COUNTER, 0, WALL_Y - TOP_D, LEG_H + LOW_H, line_end, TOP_D, TOP_T, TOP_C))
    # left filler from the kick to the ceiling line, flush with the door faces
    items.append(box(N_FILLER, 0, -MDF, LEG_H, FILLER_W, MDF, LOW_H, DOOR_C))
    items.append(box(N_FILLER + "_up", 0, WALL_Y - UP_D - MDF, TOTAL_H - MOLD_H - UP_H - 15, FILLER_W, MDF, UP_H + 15 + MOLD_H, DOOR_C))
    # uppers + crown molding (not over the hood bay)
    x = FILLER_W
    for name, W, doors in UPPERS:
        if doors:
            items.append(upper_cabinet(name, x, W, doors))
            items.append(box(N_MOLD, x, WALL_Y - UP_D - MDF, TOTAL_H - MOLD_H, W, MDF, MOLD_H, DOOR_C))
        x += W
    return items


@glb(out="../GLB/sink_set.glb")
@step(out="../STEP/sink_set.step")
def sink_set():
    return bd.Compound(children=sink_parts(), label=K(0xc2f1, 0xd06c, 0xb300) + "_4100")


if __name__ == "__main__":
    sink_set()
