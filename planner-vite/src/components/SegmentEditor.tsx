// ═══════════════════════════════════════════════════════════════
// SegmentEditor.tsx — W6-3 Step 1 Top View 인터랙티브 가구 segment 편집기
//
// 기능:
//   - SVG 2D 캔버스 (mm 좌표, +x 우측 +y 후방)
//   - segment 추가/드래그/회전(90° snap)/삭제/리사이즈
//   - 인접 edge auto-snap (10mm threshold)
//   - 우측 패널: segment 목록 + 컨트롤 + "구조 배치로 →" 버튼
//
// Props:
//   - segments: 현재 segment 배열
//   - onChange: segment 변경 콜백
//   - onNext: 다음 단계 (Step 2 구조) 진입 콜백
//   - defaultWidth/Depth: 새 segment 기본 치수
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useMemo, useCallback } from 'react';
import type { CabinetSegment, Rotation90 } from '../lib/planner';

// ─────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────

const SVG_W = 720;
const SVG_H = 560;
const SNAP_GRID = 50;     // 50mm snap (드래그 + 신규 segment 위치)
const SNAP_EDGE = 10;     // 10mm 이내 인접 edge auto-snap
const ROTATE_STEPS: readonly Rotation90[] = [0, 90, 180, 270];
const NEW_SEGMENT_DEFAULT_W = 1500;
const NEW_SEGMENT_DEFAULT_D = 600;

let segmentIdCounter = 0;
const genSegmentId = (): string => {
  segmentIdCounter += 1;
  return `seg-${Date.now().toString(36)}-${segmentIdCounter}`;
};

// ─────────────────────────────────────────────────────────────
// 좌표/회전 헬퍼
// ─────────────────────────────────────────────────────────────

/** segment 의 회전 반영 AABB (월드 좌표 min/max). 회전 pivot = (x, y) 코너. */
export const segmentBounds = (seg: CabinetSegment) => {
  const corners = [
    { lx: 0, ly: 0 },
    { lx: seg.width, ly: 0 },
    { lx: seg.width, ly: seg.depth },
    { lx: 0, ly: seg.depth },
  ];
  const rad = (seg.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const worldX = corners.map((c) => seg.x + c.lx * cos - c.ly * sin);
  const worldY = corners.map((c) => seg.y + c.lx * sin + c.ly * cos);
  return {
    minX: Math.min(...worldX),
    maxX: Math.max(...worldX),
    minY: Math.min(...worldY),
    maxY: Math.max(...worldY),
  };
};

/** 모든 segment 의 AABB 합 (view fit 용) */
const computeViewport = (segs: CabinetSegment[]) => {
  if (segs.length === 0) return { minX: -500, maxX: 4500, minY: -500, maxY: 2500 };
  const bounds = segs.map(segmentBounds);
  const minX = Math.min(...bounds.map((b) => b.minX));
  const maxX = Math.max(...bounds.map((b) => b.maxX));
  const minY = Math.min(...bounds.map((b) => b.minY));
  const maxY = Math.max(...bounds.map((b) => b.maxY));
  // padding 500mm
  return { minX: minX - 500, maxX: maxX + 500, minY: minY - 500, maxY: maxY + 500 };
};

export const snap = (v: number, grid = SNAP_GRID): number => Math.round(v / grid) * grid;

/** 인접 segment edge 와 10mm 이내면 정확히 일치시킴 (auto-snap). */
export const snapToAdjacent = (
  candidate: CabinetSegment,
  others: CabinetSegment[]
): CabinetSegment => {
  const candB = segmentBounds(candidate);
  let dx = 0;
  let dy = 0;
  for (const other of others) {
    const ob = segmentBounds(other);
    // X-축 edge snap
    for (const [a, b] of [[candB.minX, ob.maxX], [candB.maxX, ob.minX], [candB.minX, ob.minX], [candB.maxX, ob.maxX]]) {
      const diff = b - a;
      if (Math.abs(diff) <= SNAP_EDGE && Math.abs(diff) < Math.abs(dx === 0 ? Infinity : dx)) {
        dx = diff;
      }
    }
    // Y-축 edge snap
    for (const [a, b] of [[candB.minY, ob.maxY], [candB.maxY, ob.minY], [candB.minY, ob.minY], [candB.maxY, ob.maxY]]) {
      const diff = b - a;
      if (Math.abs(diff) <= SNAP_EDGE && Math.abs(diff) < Math.abs(dy === 0 ? Infinity : dy)) {
        dy = diff;
      }
    }
  }
  return { ...candidate, x: candidate.x + dx, y: candidate.y + dy };
};

// ─────────────────────────────────────────────────────────────
// 컴포넌트 Props
// ─────────────────────────────────────────────────────────────

export interface SegmentEditorProps {
  segments: CabinetSegment[];
  onChange: (segments: CabinetSegment[]) => void;
  onNext?: () => void;
  defaultWidth?: number;
  defaultDepth?: number;
}

export function SegmentEditor({
  segments,
  onChange,
  onNext,
  defaultWidth = NEW_SEGMENT_DEFAULT_W,
  defaultDepth = NEW_SEGMENT_DEFAULT_D,
}: SegmentEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    segments.length > 0 ? segments[0].id : null
  );
  const dragRef = useRef<{ id: string; mmStartX: number; mmStartY: number; origX: number; origY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // ── viewBox (mm 좌표, padding 포함) ─────────────────────────
  const viewport = useMemo(() => computeViewport(segments), [segments]);
  const viewportW = viewport.maxX - viewport.minX;
  const viewportH = viewport.maxY - viewport.minY;
  // SVG 의 Y 축은 아래로 +. mm 의 +y 가 후방 (위쪽) 로 보이도록 SVG transform 으로 뒤집음.
  const viewBox = `${viewport.minX} ${-viewport.maxY} ${viewportW} ${viewportH}`;

  // ── 좌표 변환 (마우스 px → mm) ─────────────────────────────
  const pxToMm = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { mmX: 0, mmY: 0 };
    const rect = svg.getBoundingClientRect();
    const ratioX = (clientX - rect.left) / rect.width;
    const ratioY = (clientY - rect.top) / rect.height;
    const mmX = viewport.minX + ratioX * viewportW;
    // SVG 의 Y 는 위→아래, mm 의 Y 는 아래→위 → 반전
    const mmY = viewport.maxY - ratioY * viewportH;
    return { mmX, mmY };
  }, [viewport, viewportW, viewportH]);

  const selected = segments.find((s) => s.id === selectedId) ?? null;

  // ── 액션 ────────────────────────────────────────────────────
  const updateSegment = useCallback((id: string, patch: Partial<CabinetSegment>) => {
    const next = segments.map((s) => (s.id === id ? { ...s, ...patch } : s));
    onChange(next);
  }, [segments, onChange]);

  const addSegment = useCallback(() => {
    const last = segments[segments.length - 1];
    const startX = last ? segmentBounds(last).maxX + 100 : 0;
    const startY = last ? segmentBounds(last).minY : 0;
    const newSeg: CabinetSegment = {
      id: genSegmentId(),
      x: snap(startX),
      y: snap(startY),
      width: defaultWidth,
      depth: defaultDepth,
      rotationDeg: 0,
      label: `Segment ${segments.length + 1}`,
    };
    onChange([...segments, newSeg]);
    setSelectedId(newSeg.id);
  }, [segments, onChange, defaultWidth, defaultDepth]);

  const deleteSegment = useCallback((id: string) => {
    onChange(segments.filter((s) => s.id !== id));
    if (selectedId === id) {
      setSelectedId(segments.find((s) => s.id !== id)?.id ?? null);
    }
  }, [segments, onChange, selectedId]);

  const rotateSegment = useCallback((id: string) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    const idx = ROTATE_STEPS.indexOf(seg.rotationDeg);
    const next = ROTATE_STEPS[(idx + 1) % ROTATE_STEPS.length];
    updateSegment(id, { rotationDeg: next });
  }, [segments, updateSegment]);

  // ── 드래그 ─────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<SVGRectElement>, id: string) => {
    const seg = segments.find((s) => s.id === id);
    if (!seg) return;
    const { mmX, mmY } = pxToMm(e.clientX, e.clientY);
    dragRef.current = { id, mmStartX: mmX, mmStartY: mmY, origX: seg.x, origY: seg.y };
    setSelectedId(id);
    (e.target as SVGRectElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGRectElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { mmX, mmY } = pxToMm(e.clientX, e.clientY);
    const dx = snap(mmX - drag.mmStartX);
    const dy = snap(mmY - drag.mmStartY);
    const newX = drag.origX + dx;
    const newY = drag.origY + dy;
    // auto-snap to adjacent edges
    const others = segments.filter((s) => s.id !== drag.id);
    const candidate: CabinetSegment = { ...segments.find((s) => s.id === drag.id)!, x: newX, y: newY };
    const snapped = snapToAdjacent(candidate, others);
    updateSegment(drag.id, { x: snapped.x, y: snapped.y });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  // ── 렌더링 ─────────────────────────────────────────────────
  return (
    <div data-testid="segment-editor" style={styles.root}>
      <div style={styles.canvasArea}>
        <svg
          ref={svgRef}
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
          style={styles.svg}
        >
          {/* mm Y 반전: viewport 안에서 g transform 으로 Y 축 뒤집기 */}
          <g transform="scale(1, -1)">
            {/* grid */}
            <Grid viewport={viewport} />

            {/* segments */}
            {segments.map((seg) => (
              <SegmentRect
                key={seg.id}
                segment={seg}
                selected={seg.id === selectedId}
                onPointerDown={(e) => handlePointerDown(e, seg.id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
            ))}
          </g>
        </svg>
      </div>

      <aside style={styles.panel}>
        <header style={styles.panelHeader}>
          <h3 style={styles.panelTitle}>Step 1 · 가구 배치</h3>
          <p style={styles.panelHint}>
            Top view 에서 segment 를 추가/이동/회전. ㄱ자/ㄷ자 자유 구성.
          </p>
        </header>

        <button type="button" onClick={addSegment} style={styles.addBtn} data-testid="add-segment">
          + Segment 추가
        </button>

        <ul style={styles.segmentList}>
          {segments.map((seg) => (
            <li key={seg.id} style={styles.segmentItem}>
              <button
                type="button"
                onClick={() => setSelectedId(seg.id)}
                style={{
                  ...styles.segmentItemBtn,
                  ...(seg.id === selectedId ? styles.segmentItemBtnSelected : {}),
                }}
                data-testid={`segment-item-${seg.id}`}
              >
                <strong>{seg.label ?? seg.id}</strong>
                <span style={styles.segmentItemMeta}>
                  {seg.width}×{seg.depth}mm · {seg.rotationDeg}°
                </span>
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <div style={styles.selectedPanel}>
            <h4 style={styles.selectedTitle}>{selected.label ?? selected.id}</h4>

            <label style={styles.field}>
              <span>가로 (mm)</span>
              <input
                type="number"
                value={selected.width}
                step={SNAP_GRID}
                min={300}
                max={6000}
                onChange={(e) => updateSegment(selected.id, { width: Number(e.target.value) || 0 })}
                style={styles.input}
                data-testid="input-width"
              />
            </label>

            <label style={styles.field}>
              <span>깊이 (mm)</span>
              <input
                type="number"
                value={selected.depth}
                step={SNAP_GRID}
                min={200}
                max={1200}
                onChange={(e) => updateSegment(selected.id, { depth: Number(e.target.value) || 0 })}
                style={styles.input}
                data-testid="input-depth"
              />
            </label>

            <div style={styles.actionRow}>
              <button
                type="button"
                onClick={() => rotateSegment(selected.id)}
                style={styles.actionBtn}
                data-testid="rotate-btn"
              >
                ⟳ 90° 회전 ({selected.rotationDeg}°)
              </button>
              <button
                type="button"
                onClick={() => deleteSegment(selected.id)}
                style={{ ...styles.actionBtn, ...styles.deleteBtn }}
                data-testid="delete-btn"
              >
                🗑 삭제
              </button>
            </div>
          </div>
        )}

        {onNext && (
          <button
            type="button"
            onClick={onNext}
            style={styles.nextBtn}
            disabled={segments.length === 0}
            data-testid="next-step"
          >
            구조 배치로 →
          </button>
        )}
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 하위 컴포넌트
// ─────────────────────────────────────────────────────────────

function Grid({ viewport }: { viewport: { minX: number; maxX: number; minY: number; maxY: number } }) {
  const gridSize = 200; // 200mm grid
  const lines: React.ReactElement[] = [];
  const startX = Math.floor(viewport.minX / gridSize) * gridSize;
  const startY = Math.floor(viewport.minY / gridSize) * gridSize;
  for (let x = startX; x <= viewport.maxX; x += gridSize) {
    lines.push(
      <line
        key={`gx-${x}`}
        x1={x} y1={viewport.minY} x2={x} y2={viewport.maxY}
        stroke={x === 0 ? '#999' : '#e5e0d4'}
        strokeWidth={x === 0 ? 3 : 1}
      />
    );
  }
  for (let y = startY; y <= viewport.maxY; y += gridSize) {
    lines.push(
      <line
        key={`gy-${y}`}
        x1={viewport.minX} y1={y} x2={viewport.maxX} y2={y}
        stroke={y === 0 ? '#999' : '#e5e0d4'}
        strokeWidth={y === 0 ? 3 : 1}
      />
    );
  }
  return <g>{lines}</g>;
}

function SegmentRect({
  segment,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  segment: CabinetSegment;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<SVGRectElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGRectElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGRectElement>) => void;
}) {
  // 회전 group: (segment.x, segment.y) 코너 pivot, 시계반대 (CCW) 회전.
  // SVG transform 순서: translate → rotate (corner pivot).
  return (
    <g transform={`translate(${segment.x}, ${segment.y}) rotate(${segment.rotationDeg})`}>
      <rect
        x={0}
        y={0}
        width={segment.width}
        height={segment.depth}
        fill={selected ? '#b8956c' : '#e8dfd0'}
        fillOpacity={selected ? 0.85 : 0.7}
        stroke={selected ? '#6a4b2a' : '#a89c84'}
        strokeWidth={selected ? 25 : 15}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: 'grab' }}
        data-testid={`segment-rect-${segment.id}`}
      />
      {/* 라벨 — 회전 그룹 안이므로 텍스트도 같이 돌아감. 가독성 위해 다시 -rotation. */}
      <text
        x={segment.width / 2}
        y={segment.depth / 2}
        fill={selected ? '#fff' : '#3a3530'}
        fontSize={Math.min(segment.width, segment.depth) * 0.15}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`scale(1, -1) rotate(${-segment.rotationDeg}, ${segment.width / 2}, ${-segment.depth / 2})`}
        pointerEvents="none"
      >
        {segment.label ?? segment.id}
      </text>
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// 인라인 스타일
// ─────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    background: '#fbfaf6',
    height: '100%',
    width: '100%',
    boxSizing: 'border-box',
  },
  canvasArea: {
    flex: '1 1 auto',
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
    borderRadius: 4,
    border: '1px solid #e5e0d4',
    overflow: 'hidden',
  },
  svg: {
    width: '100%',
    height: '100%',
  },
  panel: {
    flex: '0 0 240px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    minWidth: 0,
  },
  panelHeader: { marginBottom: 4 },
  panelTitle: { margin: 0, fontSize: 16, color: '#6a4b2a' },
  panelHint: { margin: '4px 0 0', fontSize: 12, color: '#7a7062' },
  addBtn: {
    padding: '10px 14px',
    background: '#6a4b2a',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
  segmentList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    maxHeight: 200,
    overflowY: 'auto',
  },
  segmentItem: {},
  segmentItemBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    width: '100%',
    padding: '8px 10px',
    background: '#fff',
    border: '1px solid #e5e0d4',
    borderRadius: 6,
    cursor: 'pointer',
    textAlign: 'left',
  },
  segmentItemBtnSelected: {
    background: '#f3ead9',
    borderColor: '#b8956c',
  },
  segmentItemMeta: {
    fontSize: 11,
    color: '#7a7062',
    marginTop: 2,
  },
  selectedPanel: {
    background: '#fff',
    padding: 12,
    borderRadius: 6,
    border: '1px solid #e5e0d4',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  selectedTitle: { margin: 0, fontSize: 13, color: '#6a4b2a' },
  field: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: '#3a3530',
    gap: 8,
  },
  input: {
    flex: '0 0 90px',
    padding: '4px 6px',
    border: '1px solid #d9d2bf',
    borderRadius: 4,
    fontSize: 12,
    textAlign: 'right',
  },
  actionRow: {
    display: 'flex',
    gap: 6,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    padding: '6px 8px',
    background: '#fff',
    border: '1px solid #b8956c',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    color: '#6a4b2a',
  },
  deleteBtn: {
    borderColor: '#c95d5d',
    color: '#c95d5d',
  },
  nextBtn: {
    marginTop: 'auto',
    padding: '12px 16px',
    background: '#4a7c4f',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
  },
};
