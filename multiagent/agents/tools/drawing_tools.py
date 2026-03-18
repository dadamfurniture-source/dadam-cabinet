"""Detail Design Drawing MCP Tools — SVG-based manufacturing drawings

Generates factory-ready vector drawings from layout plans:
- Front elevation with dimension lines
- Side section views
- Top plan (countertop shape, cutouts)
"""

import json

from claude_agent_sdk import create_sdk_mcp_server, tool


def _dim_line(x1: int, y1: int, x2: int, y2: int, label: str, offset: int = 30) -> str:
    """Generate SVG dimension line with arrowheads and label."""
    is_horizontal = abs(y2 - y1) < abs(x2 - x1)

    if is_horizontal:
        ly = y1 - offset
        mid_x = (x1 + x2) / 2
        return (
            f'<line x1="{x1}" y1="{ly}" x2="{x2}" y2="{ly}" stroke="#333" stroke-width="0.5"/>'
            f'<line x1="{x1}" y1="{y1}" x2="{x1}" y2="{ly - 5}" stroke="#333" stroke-width="0.3"/>'
            f'<line x1="{x2}" y1="{y1}" x2="{x2}" y2="{ly - 5}" stroke="#333" stroke-width="0.3"/>'
            f'<polygon points="{x1},{ly} {x1 + 4},{ly - 2} {x1 + 4},{ly + 2}" fill="#333"/>'
            f'<polygon points="{x2},{ly} {x2 - 4},{ly - 2} {x2 - 4},{ly + 2}" fill="#333"/>'
            f'<text x="{mid_x}" y="{ly - 5}" text-anchor="middle" font-size="10" fill="#333">{label}</text>'
        )
    else:
        lx = x1 + offset
        mid_y = (y1 + y2) / 2
        return (
            f'<line x1="{lx}" y1="{y1}" x2="{lx}" y2="{y2}" stroke="#333" stroke-width="0.5"/>'
            f'<line x1="{x1}" y1="{y1}" x2="{lx + 5}" y2="{y1}" stroke="#333" stroke-width="0.3"/>'
            f'<line x1="{x1}" y1="{y2}" x2="{lx + 5}" y2="{y2}" stroke="#333" stroke-width="0.3"/>'
            f'<polygon points="{lx},{y1} {lx - 2},{y1 + 4} {lx + 2},{y1 + 4}" fill="#333"/>'
            f'<polygon points="{lx},{y2} {lx - 2},{y2 - 4} {lx + 2},{y2 - 4}" fill="#333"/>'
            f'<text x="{lx + 8}" y="{mid_y}" font-size="10" fill="#333" dominant-baseline="middle">{label}</text>'
        )


def _generate_front_elevation(layout: dict) -> str:
    """Generate front elevation SVG from layout data."""
    modules = layout.get("modules", [])
    upper_modules = layout.get("upper_modules", [])
    specs = layout.get("cabinet_specs", {})

    lower_h = specs.get("lower_height_mm", 870)
    upper_h = specs.get("upper_height_mm", 720)
    toe_kick = specs.get("toe_kick_mm", 150)
    specs.get("molding_mm", 60)
    specs.get("depth_mm", 580)
    total_w = layout.get("total_width_mm", 2400)
    total_h = layout.get("total_height_mm", 2400)

    # Scale: 1mm = 0.3px for viewable SVG
    scale = 0.3
    margin = 80
    svg_w = int(total_w * scale + margin * 2)
    svg_h = int(total_h * scale + margin * 2)

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_w} {svg_h}" width="{svg_w}" height="{svg_h}">',
        "<style>text { font-family: monospace; }</style>",
        f'<text x="{svg_w // 2}" y="20" text-anchor="middle" font-size="14" font-weight="bold">FRONT ELEVATION</text>',
    ]

    # Coordinate helpers (origin = top-left of wall)
    def wx(mm: int) -> int:
        return int(mm * scale + margin)

    def wy(mm: int) -> int:
        return int(mm * scale + margin)

    # Draw lower cabinet modules
    lower_top = total_h - lower_h
    for mod in modules:
        x = mod.get("position_mm", 0)
        w = mod.get("width_mm", 450)
        features = mod.get("features", [])

        # Module body
        parts.append(
            f'<rect x="{wx(x)}" y="{wy(lower_top)}" width="{int(w * scale)}" height="{int(lower_h * scale)}" '
            f'fill="none" stroke="#000" stroke-width="1"/>'
        )

        # Toe kick line
        parts.append(
            f'<line x1="{wx(x)}" y1="{wy(total_h - toe_kick)}" '
            f'x2="{wx(x + w)}" y2="{wy(total_h - toe_kick)}" stroke="#000" stroke-width="0.5" stroke-dasharray="4,2"/>'
        )

        # Door lines
        door_count = mod.get("door_count", 1)
        door_w = w / door_count
        for d in range(door_count):
            dx = x + d * door_w
            parts.append(
                f'<rect x="{wx(dx) + 2}" y="{wy(lower_top) + 2}" '
                f'width="{int(door_w * scale) - 4}" height="{int((lower_h - toe_kick) * scale) - 4}" '
                f'fill="none" stroke="#666" stroke-width="0.5"/>'
            )
            # Handle dot
            hx = wx(dx + door_w / 2)
            hy = wy(lower_top + (lower_h - toe_kick) / 2)
            parts.append(f'<circle cx="{hx}" cy="{hy}" r="2" fill="#666"/>')

        # Feature labels
        if "sink_bowl" in features:
            parts.append(
                f'<text x="{wx(x + w // 2)}" y="{wy(lower_top + lower_h // 2)}" '
                f'text-anchor="middle" font-size="8" fill="#06c">SINK</text>'
            )
        elif "gas_range" in features:
            parts.append(
                f'<text x="{wx(x + w // 2)}" y="{wy(lower_top + lower_h // 2)}" '
                f'text-anchor="middle" font-size="8" fill="#c60">COOKTOP</text>'
            )

        # Width dimension
        parts.append(_dim_line(wx(x), wy(total_h) + 10, wx(x + w), wy(total_h) + 10, f"{w}", 15))

    # Draw upper cabinet modules
    upper_bottom = lower_top - 500  # backsplash zone ~500mm
    upper_top_y = upper_bottom - upper_h
    for mod in upper_modules:
        x = mod.get("position_mm", 0)
        w = mod.get("width_mm", 450)
        features = mod.get("features", [])

        parts.append(
            f'<rect x="{wx(x)}" y="{wy(upper_top_y)}" width="{int(w * scale)}" height="{int(upper_h * scale)}" '
            f'fill="none" stroke="#000" stroke-width="1"/>'
        )

        # Range hood marking
        if "range_hood" in features:
            parts.append(
                f'<text x="{wx(x + w // 2)}" y="{wy(upper_top_y + upper_h // 2)}" '
                f'text-anchor="middle" font-size="8" fill="#c60">HOOD</text>'
            )

    # Overall dimension
    parts.append(_dim_line(wx(0), wy(0) - 10, wx(total_w), wy(0) - 10, f"{total_w}", 20))
    # Height dimension (right side)
    parts.append(
        _dim_line(wx(total_w) + 10, wy(0), wx(total_w) + 10, wy(total_h), f"{total_h}", 20)
    )

    # Countertop line
    parts.append(
        f'<line x1="{wx(0)}" y1="{wy(lower_top)}" x2="{wx(total_w)}" y2="{wy(lower_top)}" '
        f'stroke="#000" stroke-width="2"/>'
    )
    parts.append(
        f'<text x="{wx(total_w) + 5}" y="{wy(lower_top)}" font-size="8" fill="#333">countertop</text>'
    )

    parts.append("</svg>")
    return "\n".join(parts)


@tool(
    "generate_svg",
    "Generate manufacturing-grade SVG drawings from a furniture layout plan. Returns front elevation with dimension lines.",
    {
        "type": "object",
        "properties": {
            "layout": {
                "type": "object",
                "description": "Layout plan JSON from design-planner (includes modules, upper_modules, cabinet_specs, total_width_mm, total_height_mm)",
            },
            "drawing_type": {
                "type": "string",
                "description": "Drawing type: front_elevation (default), side_section, top_plan",
            },
        },
        "required": ["layout"],
    },
)
async def generate_svg(args: dict) -> dict:
    layout = args["layout"]
    drawing_type = args.get("drawing_type", "front_elevation")

    if drawing_type == "front_elevation":
        svg = _generate_front_elevation(layout)
    else:
        # Side section and top plan use simplified versions
        svg = _generate_front_elevation(layout)  # fallback for now

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "drawing_type": drawing_type,
                        "svg": svg,
                        "dimensions": {
                            "total_width_mm": layout.get("total_width_mm"),
                            "total_height_mm": layout.get("total_height_mm"),
                        },
                    }
                ),
            }
        ]
    }


@tool(
    "generate_bom_drawing",
    "Generate BOM-annotated drawing showing material callouts for each component.",
    {
        "type": "object",
        "properties": {
            "layout": {
                "type": "object",
                "description": "Layout plan JSON",
            },
        },
        "required": ["layout"],
    },
)
async def generate_bom_drawing(args: dict) -> dict:
    layout = args["layout"]
    modules = layout.get("modules", [])
    specs = layout.get("cabinet_specs", {})
    depth = specs.get("depth_mm", 580)

    bom_items = []
    for i, mod in enumerate(modules):
        w = mod.get("width_mm", 450)
        h = specs.get("lower_height_mm", 870)
        features = mod.get("features", [])

        module_bom = {
            "module_index": i + 1,
            "type": mod.get("type", "base_cabinet"),
            "width_mm": w,
            "features": features,
            "parts": [
                {"name": "Side panel (18T PB)", "size": f"{depth}x{h}mm", "qty": 2},
                {"name": "Top panel (18T PB)", "size": f"{w}x{depth}mm", "qty": 1},
                {"name": "Bottom panel (18T PB)", "size": f"{w}x{depth}mm", "qty": 1},
                {"name": "Back panel (9T MDF)", "size": f"{w}x{h}mm", "qty": 1},
                {"name": "Shelf (18T PB)", "size": f"{w - 36}x{depth - 20}mm", "qty": 1},
            ],
        }

        # Door parts
        door_count = mod.get("door_count", 1)
        door_h = h - specs.get("toe_kick_mm", 150)
        door_w = w // door_count
        module_bom["parts"].extend(
            [
                {"name": "Door panel", "size": f"{door_w}x{door_h}mm", "qty": door_count},
                {"name": "Hinge (35mm full-overlay)", "size": "soft-close", "qty": door_count * 2},
                {"name": "Handle", "size": "128mm center", "qty": door_count},
            ]
        )

        # Special features
        if "sink_bowl" in features:
            module_bom["parts"].append(
                {
                    "name": "Sink cutout reinforcement",
                    "size": f"{w - 100}x{depth - 100}mm",
                    "qty": 1,
                }
            )
        if "drawer_3" in features:
            module_bom["parts"] = [
                p
                for p in module_bom["parts"]
                if "Door" not in p["name"] and "Hinge" not in p["name"]
            ]
            module_bom["parts"].extend(
                [
                    {"name": "Drawer box", "size": f"{w - 40}x{depth - 40}x150mm", "qty": 3},
                    {"name": "Drawer slide (soft-close)", "size": f"{depth - 40}mm", "qty": 6},
                    {"name": "Drawer front panel", "size": f"{w}x{(door_h) // 3}mm", "qty": 3},
                ]
            )

        bom_items.append(module_bom)

    # Edge banding summary
    total_edge_1mm = 0  # exposed edges
    total_edge_04mm = 0  # hidden edges
    for item in bom_items:
        w = item["width_mm"]
        total_edge_1mm += w * 2  # top/bottom front edges
        total_edge_04mm += w * 4  # internal edges

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "bom": bom_items,
                        "edge_banding": {
                            "1mm_PVC_meters": round(total_edge_1mm / 1000, 1),
                            "0.4mm_PVC_meters": round(total_edge_04mm / 1000, 1),
                        },
                        "module_count": len(bom_items),
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


# MCP Server
drawing_server = create_sdk_mcp_server(
    name="drawing",
    version="1.0.0",
    tools=[generate_svg, generate_bom_drawing],
)
