// 레이아웃 제약조건 — 개수대/쿡탑 위치 고정 + 투톤 컬러

const SINK_WIDTH = 900;
const COOKTOP_WIDTH = 600;

export interface WallAnalysis {
  wall: { width: number; height: number };
  plumbing: {
    sinkCenter: number | null;
    cooktopCenter: number | null;
    waterPct: number;
    exhaustPct: number;
  };
}

export function describeLayoutConstraints(
  analysis: WallAnalysis,
  category: string,
  upperColor: string,
  lowerColor: string,
  countertopDesc: string,
): string {
  if (category !== 'sink' && category !== 'Sink') {
    return `Wall ${analysis.wall.width}x${analysis.wall.height}mm.`;
  }

  const parts: string[] = [];

  // 위치 고정 (좌/우 방향)
  const sinkSide = analysis.plumbing.waterPct <= 50 ? 'LEFT' : 'RIGHT';
  const cooktopSide = analysis.plumbing.exhaustPct <= 50 ? 'LEFT' : 'RIGHT';
  parts.push(`Sink on ${sinkSide} side (water pipes).`);
  parts.push(`Flush cooktop on ${cooktopSide} side (exhaust).`);

  return parts.join(' ');
}

export function alignLayoutConstraints(
  analysis: WallAnalysis,
  layoutConstraints?: any,
): any {
  if (!analysis?.plumbing || !layoutConstraints?.fixed_appliances) {
    return layoutConstraints;
  }

  const totalWidth = layoutConstraints.total_width_mm || analysis.wall.width;
  const waterPct = analysis.plumbing.waterPct || 30;
  const exhaustPct = analysis.plumbing.exhaustPct || 70;

  const sinkCenter = Math.round(totalWidth * waterPct / 100);
  const cooktopCenter = Math.round(totalWidth * exhaustPct / 100);
  const sinkX = Math.max(0, sinkCenter - SINK_WIDTH / 2);
  const cooktopX = Math.max(0, cooktopCenter - COOKTOP_WIDTH / 2);

  return {
    ...layoutConstraints,
    fixed_appliances: {
      sink: { x_mm: sinkX, width_mm: SINK_WIDTH, center_mm: sinkCenter },
      cooktop: { x_mm: cooktopX, width_mm: COOKTOP_WIDTH, center_mm: cooktopCenter },
      hood: { x_mm: cooktopX, width_mm: COOKTOP_WIDTH, center_mm: cooktopCenter, align_to: 'cooktop_center' },
    },
  };
}
