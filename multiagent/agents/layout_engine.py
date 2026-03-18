"""Layout Engine — Python port of distributeModules algorithm from dadamagent

Converts raw space dimensions into optimized module configurations:
- Door width targeting ~450mm (min 350, max 600)
- Preferred remainder: 4-10mm for thermal expansion
- 2-door modules preferred over 1-door for structural efficiency
"""

from dataclasses import dataclass, field

# Layout constants (mm)
DOOR_TARGET_WIDTH = 450
DOOR_MAX_WIDTH = 600
DOOR_MIN_WIDTH = 350
MIN_REMAINDER = 4  # minimum gap for thermal expansion
MAX_REMAINDER = 10  # maximum acceptable gap

# Category-specific fixed modules (mm widths)
FIXED_MODULE_DEFAULTS: dict[str, dict] = {
    "sink": {"sink_bowl": 1000, "cooktop": 600},
    "island": {"sink_bowl": 1000},
    "vanity": {"sink_bowl": 600},
}

# Open-door content descriptions per category (for image generation)
OPEN_DOOR_CONTENTS: dict[str, str] = {
    "sink": (
        "Lower cabinets: 1 shelf inside each, dishes and pots. "
        "Sink cabinet open showing underside of stainless steel sink bowl and white PVC drain pipe visible. "
        "Upper cabinets: 2 shelves inside each, cups and bowls. "
        "Cooktop drawers pulled out. "
        "Range hood cabinet open showing aluminum flexible exhaust duct connected to wall vent"
    ),
    "island": "Lower: 1 shelf, wine glasses. Upper: 2 shelves, mugs and small appliances",
    "closet": "hanging clothes on rail, folded items on shelves, drawers with accessories",
    "fridge_cabinet": "refrigerator visible in center, pantry shelves on sides",
    "shoe_cabinet": "shoes neatly arranged on angled shelves, boot compartment",
    "vanity": "Lower: 1 shelf, hair tools. Upper: 2 shelves, cosmetics and mirrors",
    "storage": "Lower: 1 shelf, baskets. Upper: 2 shelves, books and decorative boxes",
    "utility_closet": "Lower: 1 shelf, cleaning tools. Upper: 2 shelves, laundry supplies",
}


@dataclass
class Module:
    """A single furniture module"""

    width: int  # mm
    is_2door: bool = False
    module_type: str = "cabinet"  # cabinet, sink_bowl, cooktop, drawer
    position_x: int = 0  # mm from origin


@dataclass
class LayoutResult:
    """Result of module distribution"""

    modules: list[Module] = field(default_factory=list)
    door_width: int = 0
    door_count: int = 0
    total_width: int = 0
    remainder: int = 0  # gap between modules and wall


@dataclass
class SpaceSegment:
    """A free segment of wall space between fixed elements"""

    start_x: int
    width: int


def find_best_door_width(
    total_space: int, door_count: int, prefer_exact: bool = False
) -> int | None:
    """Find optimal door width for given space and door count.

    Args:
        total_space: Available space in mm
        door_count: Number of doors to fit
        prefer_exact: If True, prefer 0mm remainder (molding finish)

    Returns:
        Optimal door width in mm, or None if no valid width exists
    """
    raw_width = total_space / door_count

    if raw_width > DOOR_MAX_WIDTH or raw_width < DOOR_MIN_WIDTH:
        return None

    primary_candidates: list[dict] = []
    secondary_candidates: list[dict] = []

    # Generate candidates: multiples of 10 and even numbers
    ten_floor = int(raw_width // 10) * 10
    ten_ceil = ten_floor + 10 if raw_width % 10 != 0 else ten_floor
    even_floor = int(raw_width // 2) * 2
    even_ceil = even_floor + 2 if raw_width % 2 != 0 else even_floor

    all_candidates = [
        {"width": ten_floor, "priority": 1},
        {"width": ten_ceil, "priority": 1},
        {"width": even_floor, "priority": 2},
        {"width": even_ceil, "priority": 2},
    ]

    for cand in all_candidates:
        w = cand["width"]
        if w < DOOR_MIN_WIDTH or w > DOOR_MAX_WIDTH:
            continue
        gap = total_space - w * door_count
        if gap < 0:
            continue

        if prefer_exact:
            # Molding finish: prefer 0mm remainder
            if 0 <= gap < MIN_REMAINDER:
                primary_candidates.append({**cand, "gap": gap})
            elif MIN_REMAINDER <= gap <= MAX_REMAINDER:
                secondary_candidates.append({**cand, "gap": gap})
        else:
            # No molding: prefer 4-10mm remainder for expansion
            if MIN_REMAINDER <= gap <= MAX_REMAINDER:
                primary_candidates.append({**cand, "gap": gap})
            elif 0 <= gap < MIN_REMAINDER:
                secondary_candidates.append({**cand, "gap": gap})

    def sort_key(c: dict) -> tuple:
        return (c["priority"], c["gap"])

    if primary_candidates:
        primary_candidates.sort(key=sort_key)
        return primary_candidates[0]["width"]

    if secondary_candidates:
        secondary_candidates.sort(key=sort_key)
        return secondary_candidates[0]["width"]

    return None


def distribute_modules(total_space: int, prefer_exact: bool = False) -> LayoutResult:
    """Distribute modules evenly across available space.

    Algorithm:
    1. Calculate valid door count range based on min/max door widths
    2. For each count, find best door width using find_best_door_width
    3. Score combinations: prefer 4-10mm remainder, then closeness to 450mm target
    4. Group doors into 2-door modules (structural preference) + remainder 1-door

    Args:
        total_space: Available wall space in mm
        prefer_exact: If True, prefer exact fit (molding finish)

    Returns:
        LayoutResult with optimized module list
    """
    if total_space < 100:
        return LayoutResult()

    # Door count range
    min_count = max(1, -(-total_space // DOOR_MAX_WIDTH))  # ceil division
    max_door_count = total_space // DOOR_MIN_WIDTH
    base_count = round(total_space / DOOR_TARGET_WIDTH)
    max_count = min(max_door_count, max(base_count + 3, min_count + 5))

    # Collect all valid combinations
    all_results: list[dict] = []

    for count in range(min_count, max_count + 1):
        width = find_best_door_width(total_space, count, prefer_exact)
        if width is not None:
            gap = total_space - width * count
            target_diff = abs(width - DOOR_TARGET_WIDTH)
            is_primary = (
                (0 <= gap < MIN_REMAINDER)
                if prefer_exact
                else (MIN_REMAINDER <= gap <= MAX_REMAINDER)
            )
            all_results.append(
                {
                    "door_count": count,
                    "door_width": width,
                    "gap": gap,
                    "target_diff": target_diff,
                    "is_primary": is_primary,
                }
            )

    # Sort: is_primary first → closest to target → smallest gap
    all_results.sort(key=lambda r: (not r["is_primary"], r["target_diff"], r["gap"]))

    best = all_results[0] if all_results else None

    # Fallback: force calculation
    if not best:
        ideal_count = round(total_space / DOOR_TARGET_WIDTH)
        count = max(min_count, min(max_door_count, ideal_count))
        width = (total_space // count // 2) * 2
        width = max(DOOR_MIN_WIDTH, min(DOOR_MAX_WIDTH, width))
        best = {
            "door_count": count,
            "door_width": width,
            "gap": total_space - width * count,
        }

    door_count = best["door_count"]
    door_width = best["door_width"]
    quotient = door_count // 2
    remainder_doors = door_count % 2

    modules: list[Module] = []
    x = 0

    # 2-door modules
    for _ in range(quotient):
        modules.append(
            Module(
                width=door_width * 2,
                is_2door=True,
                position_x=x,
            )
        )
        x += door_width * 2

    # 1-door module (if odd count)
    if remainder_doors > 0:
        modules.append(
            Module(
                width=door_width,
                is_2door=False,
                position_x=x,
            )
        )
        x += door_width

    return LayoutResult(
        modules=modules,
        door_width=door_width,
        door_count=door_count,
        total_width=door_width * door_count,
        remainder=best["gap"],
    )


def plan_layout(
    wall_width: int,
    category: str,
    finish_left: int = 0,
    finish_right: int = 0,
    sink_position: int | None = None,
    cooktop_position: int | None = None,
    prefer_exact: bool = False,
) -> dict:
    """High-level layout planning — places fixed modules then fills gaps.

    Args:
        wall_width: Total wall width in mm
        category: Furniture category (sink, island, closet, etc.)
        finish_left: Left side finish panel width in mm
        finish_right: Right side finish panel width in mm
        sink_position: X position of sink bowl center (from utility detection)
        cooktop_position: X position of cooktop center (from exhaust duct)
        prefer_exact: If True, prefer exact fit (molding finish)

    Returns:
        Layout dict with modules, dimensions, and metadata
    """
    effective_space = wall_width - finish_left - finish_right
    if effective_space < 100:
        return {"error": "Insufficient space", "effective_space": effective_space}

    fixed_modules: list[Module] = []
    defaults = FIXED_MODULE_DEFAULTS.get(category, {})

    # Place fixed modules (sink bowl, cooktop) at detected positions
    if "sink_bowl" in defaults:
        sink_w = defaults["sink_bowl"]
        if sink_position is not None:
            sx = max(finish_left, sink_position - sink_w // 2)
        else:
            # Default: left side for sink category
            sx = finish_left
        fixed_modules.append(Module(width=sink_w, module_type="sink_bowl", position_x=sx))

    if "cooktop" in defaults:
        cooktop_w = defaults["cooktop"]
        if cooktop_position is not None:
            cx = max(finish_left, cooktop_position - cooktop_w // 2)
        else:
            # Default: right side
            cx = wall_width - finish_right - cooktop_w
        fixed_modules.append(Module(width=cooktop_w, module_type="cooktop", position_x=cx))

    # Sort fixed modules by position
    fixed_modules.sort(key=lambda m: m.position_x)

    # Clamp fixed modules within effective bounds
    left_bound = finish_left
    right_bound = wall_width - finish_right
    for mod in fixed_modules:
        mod.position_x = max(left_bound, mod.position_x)
        if mod.position_x + mod.width > right_bound:
            mod.width = max(0, right_bound - mod.position_x)

    # Find free segments between fixed modules
    segments: list[SpaceSegment] = []
    cursor = left_bound

    for mod in fixed_modules:
        if mod.position_x > cursor:
            segments.append(SpaceSegment(start_x=cursor, width=mod.position_x - cursor))
        cursor = mod.position_x + mod.width

    if cursor < right_bound:
        segments.append(SpaceSegment(start_x=cursor, width=right_bound - cursor))

    # If no fixed modules, entire space is one segment
    if not fixed_modules and not segments:
        segments = [SpaceSegment(start_x=left_bound, width=effective_space)]

    # Distribute cabinet modules in each free segment
    all_modules: list[Module] = []
    segment_idx = 0

    for i, fixed in enumerate(fixed_modules):
        # Add cabinets for segment before this fixed module
        if segment_idx < len(segments) and segments[segment_idx].start_x < fixed.position_x:
            seg = segments[segment_idx]
            if seg.width >= DOOR_MIN_WIDTH:
                result = distribute_modules(seg.width, prefer_exact)
                for mod in result.modules:
                    mod.position_x += seg.start_x
                    all_modules.append(mod)
            segment_idx += 1

        # Add the fixed module itself
        all_modules.append(fixed)

    # Add cabinets for remaining segments after last fixed module
    while segment_idx < len(segments):
        seg = segments[segment_idx]
        if seg.width >= DOOR_MIN_WIDTH:
            result = distribute_modules(seg.width, prefer_exact)
            for mod in result.modules:
                mod.position_x += seg.start_x
                all_modules.append(mod)
        segment_idx += 1

    # Sort all modules by position
    all_modules.sort(key=lambda m: m.position_x)

    # Build response
    total_module_width = sum(m.width for m in all_modules)
    total_remainder = effective_space - total_module_width

    return {
        "category": category,
        "wall_width": wall_width,
        "effective_space": effective_space,
        "finish_left": finish_left,
        "finish_right": finish_right,
        "total_module_width": total_module_width,
        "remainder_mm": total_remainder,
        "module_count": len(all_modules),
        "door_count": sum(
            2 if m.is_2door else 1 for m in all_modules if m.module_type == "cabinet"
        ),
        "modules": [
            {
                "type": m.module_type,
                "width": m.width,
                "is_2door": m.is_2door,
                "position_x": m.position_x,
                "door_width": m.width // 2 if m.is_2door else m.width,
            }
            for m in all_modules
        ],
        "open_door_contents": OPEN_DOOR_CONTENTS.get(category, "items on shelves"),
    }
