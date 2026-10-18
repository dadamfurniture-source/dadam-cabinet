"""Dadam 2-door lower cabinet sample (one box).

Part sizes copied from the sink golden BOM (sink15) module "lower 2D":
  side 550x708 x2, bottom 870x550, band 70x870 x2, back MDF 3T 899x707 (no sakuri, fixed behind the sides),
  sag brace 70x608, shelf 870x535, door MDF 18T 446x678 x2. Body PB 15T.

Axes: origin = front-left-bottom corner of the body. X width, Y depth (front 0 -> back +), Z up. mm.

Placement (planner 3D mockup-structure.html + owner 2026-10-19):
  - wood channel (handleless grip): each side panel is notched 70 high x 40 deep at the top front.
    An L of MDF 18T fills it: base board 40 x W on the notch floor, face board 52 x W standing at the
    BACK of the notch, leaving a 22 mm slot in front for the fingers. Door = H - 30, so the hand goes
    over the door top into that slot. (BOM lists the channel under EP at line width; here W = 900.)
  - sag brace: centred in width, flush with the side panels' front edge (owner 2026-10-19), standing on
    the bottom up to the front band: H - 2T - 70 = 608.
  - front band lies flat directly UNDER the channel base board (assembled at the bottom of the L), full
    depth 70 from the body front; the brace top meets it. Rear band lies flat at the top, flush with the sides' rear edge.
  - back is fixed BEHIND the side panels' rear edge (owner 2026-10-19), so it takes none of the 550.
    No sakuri -> (W - 1) x (H - 1) = 899 x 707 (BOM bomBackPanelSize, PR #832), centred on the body.
  - shelf = side depth - 15 = 535: from behind the brace (15) to the sides' rear edge (550).
  - doors start at the body bottom; 2 mm gaps left, centre and right. Legs, countertop, hinges omitted.
Source is ASCII only: cadgen reads it with the Windows code page, so Korean labels are escaped.
"""
from __future__ import annotations

from cadgen import build123d as bd
from cadgen import glb, srgb, step

T = 15.0  # PB
BACK_T = 3.0  # MDF back
DOOR_T = 18.0  # MDF door
W, D, H = 900.0, 550.0, 708.0  # body outside (side panel 550 x 708)
INNER = W - 2 * T  # 870
BAND = 70.0
NOTCH_H, NOTCH_D = 70.0, 40.0  # wood channel notch in the side panels
CH_T, CH_FACE_H = 18.0, 52.0  # channel boards MDF 18T: base 40 deep, face 52 high
BRACE_GAP = 0.0  # brace flush with the body front
BRACE_L = 608.0
SHELF_D = 535.0
DOOR_W, DOOR_H = 446.0, 678.0


def K(*codes: int) -> str:
    """Korean label from code points (keeps this file ASCII)."""
    return "".join(map(chr, codes))


PB = "#D9D4C7"
BACK = "#C9C2B2"
DOOR = "#F2F0EA"
CHANNEL = "#8A8F98"


def panel(label: str, x: float, y: float, z: float, dx: float, dy: float, dz: float, hex_: str) -> bd.Solid:
    """A board with its minimum corner at (x, y, z)."""
    box = bd.Box(dx, dy, dz, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    part = bd.Pos(x, y, z) * box
    part.label = label
    part.color = srgb(hex_)
    return part


def side_panel(label: str, x: float) -> bd.Solid:
    """Side panel with the wood channel notch cut out of its top front corner."""
    body = bd.Pos(x, 0, 0) * bd.Box(T, D, H, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    notch = bd.Pos(x - 1, -1, H - NOTCH_H) * bd.Box(T + 2, NOTCH_D + 1, NOTCH_H + 1, align=(bd.Align.MIN, bd.Align.MIN, bd.Align.MIN))
    part = body - notch
    part.label = label
    part.color = srgb(PB)
    return part


def cabinet_parts() -> list:
    shelf_z = H / 2 - T / 2
    gap = (W - 2 * DOOR_W) / 3
    return [
        side_panel(K(0xce21, 0xd310) + '_' + K(0xc88c), 0),  # side L
        side_panel(K(0xce21, 0xd310) + '_' + K(0xc6b0), W - T),  # side R
        panel(K(0xc9c0, 0xd310), T, 0, 0, INNER, D, T, PB),  # bottom
        panel(K(0xbc34, 0xb4dc) + '_' + K(0xc55e), T, 0, H - NOTCH_H - T, INNER, BAND, T, PB),  # band front
        panel(K(0xbc34, 0xb4dc) + '_' + K(0xb4a4), T, D - BAND, H - T, INNER, BAND, T, PB),  # band rear
        panel(K(0xb4b7, 0xd310), 0.5, D, 0.5, W - 1, BACK_T, H - 1, BACK),  # back
        panel(K(0xcc98, 0xc9d0, 0xbc29, 0xc9c0, 0xbaa9), W / 2 - BAND / 2, BRACE_GAP, T, BAND, T, BRACE_L, PB),  # sag brace
        panel(K(0xc120, 0xbc18), T, D - SHELF_D, shelf_z, INNER, SHELF_D, T, PB),  # shelf
        panel(K(0xb3c4, 0xc5b4) + '_' + K(0xc88c), gap, -DOOR_T, 0, DOOR_W, DOOR_T, DOOR_H, DOOR),  # door L
        panel(K(0xb3c4, 0xc5b4) + '_' + K(0xc6b0), 2 * gap + DOOR_W, -DOOR_T, 0, DOOR_W, DOOR_T, DOOR_H, DOOR),  # door R
        # wood channel (MOK-CHANNEL): base board on the notch floor, face board at the back of the notch
        panel(K(0xbaa9, 0xcc2c, 0xb12c) + '_' + K(0xc9c0, 0xba74), 0, 0, H - NOTCH_H, W, NOTCH_D, CH_T, CHANNEL),
        panel(K(0xbaa9, 0xcc2c, 0xb12c) + '_' + K(0xc804, 0xba74), 0, NOTCH_D - CH_T, H - NOTCH_H + CH_T, W, CH_T, CH_FACE_H, CHANNEL),
    ]


@glb(out="../GLB/lower_cabinet_2d.glb")
@step(out="../STEP/lower_cabinet_2d.step")
def lower_cabinet_2d():
    return bd.Compound(children=cabinet_parts(), label=K(0xd558, 0xbd80, 0xc7a5) + '_2D_900')


if __name__ == "__main__":
    lower_cabinet_2d()
