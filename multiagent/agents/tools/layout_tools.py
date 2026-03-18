"""Layout Planning MCP Tools — module distribution and space planning"""

import json

from claude_agent_sdk import create_sdk_mcp_server, tool

from agents.layout_engine import (
    OPEN_DOOR_CONTENTS,
    plan_layout,
)


@tool(
    "plan_furniture_layout",
    "Plan furniture module layout for a wall space. Returns optimized module positions, door widths, and counts.",
    {
        "type": "object",
        "properties": {
            "wall_width": {
                "type": "integer",
                "description": "Total wall width in mm",
            },
            "category": {
                "type": "string",
                "description": "Furniture category (sink, island, closet, fridge_cabinet, shoe_cabinet, vanity, storage, utility_closet)",
            },
            "finish_left": {
                "type": "integer",
                "description": "Left side finish panel width in mm (default 0)",
            },
            "finish_right": {
                "type": "integer",
                "description": "Right side finish panel width in mm (default 0)",
            },
            "sink_position": {
                "type": "integer",
                "description": "X position of water supply pipes (from space analysis). Sink bowl will be placed here.",
            },
            "cooktop_position": {
                "type": "integer",
                "description": "X position of exhaust duct (from space analysis). Cooktop will be placed here.",
            },
            "prefer_exact": {
                "type": "boolean",
                "description": "If true, prefer exact fit (0mm gap) for molding finish. Default false (4-10mm gap for expansion).",
            },
        },
        "required": ["wall_width", "category"],
    },
)
async def plan_furniture_layout(args: dict) -> dict:
    result = plan_layout(
        wall_width=args["wall_width"],
        category=args["category"],
        finish_left=args.get("finish_left", 0),
        finish_right=args.get("finish_right", 0),
        sink_position=args.get("sink_position"),
        cooktop_position=args.get("cooktop_position"),
        prefer_exact=args.get("prefer_exact", False),
    )

    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(result, ensure_ascii=False),
            }
        ]
    }


@tool(
    "get_open_door_contents",
    "Get recommended open-door interior contents description for a furniture category.",
    {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "Furniture category",
            },
        },
        "required": ["category"],
    },
)
async def get_open_door_contents(args: dict) -> dict:
    category = args["category"]
    contents = OPEN_DOOR_CONTENTS.get(category, "items neatly arranged on shelves")
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps({"category": category, "contents": contents}),
            }
        ]
    }


# MCP Server
layout_server = create_sdk_mcp_server(
    name="layout",
    version="1.0.0",
    tools=[plan_furniture_layout, get_open_door_contents],
)
