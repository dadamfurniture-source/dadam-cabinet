/**
 * FloorplanScene — M2 Top View 평면 에디터 컴포넌트
 *
 * 입력: ItemV2 (lib/floorplan-types.ts 기준 v2 데이터)
 * 출력: 변경 이벤트(onSpaceChange/onSpaceSelect) — 부모가 받아 PlannerBridge로 부모 페이지에 송신
 *
 * 시각:
 *   - Top View XZ 평면에 각 Space를 박스(높이 짧음 + 색상 카테고리)로 렌더
 *   - 트리밍 outline은 연한 점선
 *   - 선택된 Space는 강조 색
 *   - 그리드 (100mm/500mm)
 *
 * 인터랙션 (M2 1차):
 *   - 클릭: Space 선택
 *   - 우클릭: 선택된 Space 90° 시계 회전 (M0 결정 J)
 *   - 좌드래그: Space 이동 (50mm 스냅)
 *   - (M2 2차) 코너 핸들 리사이즈 — 별도 PR
 *
 * 좌표계 매핑:
 *   - Floorplan 좌표 (x, y, mm)는 평면. y는 깊이축.
 *   - Three.js Top View에서는 X→X, Floorplan.y → Z (+Z는 화면 아래쪽)
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { Edges } from '@react-three/drei';
import type { Floorplan, Space, TrimmedSpace } from '@floorplan/floorplan-types';
import { recomputeFloorplan } from '@floorplan/floorplan-trim';

// ============================================================
// Props
// ============================================================

export interface FloorplanSceneProps {
  floorplan: Floorplan;
  selectedSpaceId: string | null;
  onSelect: (spaceId: string | null) => void;
  onChange: (next: Floorplan, trigger: 'drag' | 'rotate' | 'resize') => void;
  /** 편집 가능 여부. false면 view-only. */
  editable?: boolean;
}

// ============================================================
// 시각 상수
// ============================================================

const SPACE_COLOR_BY_CATEGORY: Record<string, string> = {
  sink: '#cfe2ff',
  island: '#fef3c7',
  wardrobe: '#dcfce7',
  fridge: '#e0f2fe',
  shoerack: '#f3e8ff',
  vanity: '#fce7f3',
  storage: '#f0f0f0',
  warehouse: '#fef9c3',
  door: '#e5e7eb',
  custom: '#f5f5f5',
};

const SELECTED_OUTLINE = '#2563eb';
const NORMAL_OUTLINE = '#94a3b8';
const TRIMMED_OUTLINE = '#dc2626';
const BOX_HEIGHT = 50; // Top View에서 살짝 두께감 주려고 50mm

// 90° 스냅 회전 (시계방향 — 화면 기준)
function rotateClockwise90(rad: number): number {
  return rad - Math.PI / 2;
}

// 좌표 50mm 스냅
function snap(value: number, step = 50): number {
  return Math.round(value / step) * step;
}

// ============================================================
// 단일 Space 렌더 컴포넌트
// ============================================================

interface SpaceMeshProps {
  space: Space;
  trimmed?: TrimmedSpace;
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
  onContextMenu: () => void;
  onDragStart: () => void;
  onDragMove: (deltaX: number, deltaZ: number) => void;
  onDragEnd: () => void;
}

function SpaceMesh({
  space, trimmed, selected, editable,
  onSelect, onContextMenu, onDragStart, onDragMove, onDragEnd,
}: SpaceMeshProps) {
  const fill = SPACE_COLOR_BY_CATEGORY[space.category] ?? '#f5f5f5';

  // Three.js Top View: x→x, floorplan.y → z
  // Space 회전을 Y축 회전(rotation)으로 적용
  const position: [number, number, number] = [space.x, BOX_HEIGHT / 2, space.y];
  const rotationY = -space.rotation; // Three.js Y축은 반시계 양수

  // 드래그 상태 (raw client X/Z를 기록)
  const [dragOrigin, setDragOrigin] = useState<{ x: number; z: number } | null>(null);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!editable) {
      onSelect();
      return;
    }
    if (e.button === 2) {
      // 우클릭 — 컨텍스트 처리는 onContextMenu에서. preventDefault는 브라우저 메뉴 차단용.
      e.nativeEvent.preventDefault?.();
      return;
    }
    onSelect();
    setDragOrigin({ x: e.point.x, z: e.point.z });
    onDragStart();
    (e.target as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  }, [editable, onSelect, onDragStart]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragOrigin) return;
    onDragMove(e.point.x - dragOrigin.x, e.point.z - dragOrigin.z);
  }, [dragOrigin, onDragMove]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragOrigin) return;
    setDragOrigin(null);
    onDragEnd();
    (e.target as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(e.pointerId);
  }, [dragOrigin, onDragEnd]);

  const handleContextMenu = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    e.nativeEvent.preventDefault?.();
    onContextMenu();
  }, [onContextMenu]);

  // 트리밍 발생 시 outline 색을 빨강으로 (점선 line 렌더는 M3에서 정밀화)
  const isTrimmed = trimmed && trimmed.trimmedEdges.length > 0;
  const edgeColor = selected ? SELECTED_OUTLINE : (isTrimmed ? TRIMMED_OUTLINE : NORMAL_OUTLINE);

  return (
    <group>
      <mesh
        position={position}
        rotation={[0, rotationY, 0]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
      >
        <boxGeometry args={[space.w, BOX_HEIGHT, space.h]} />
        <meshStandardMaterial color={fill} transparent opacity={0.85} />
        <Edges color={edgeColor} threshold={1} />
      </mesh>
    </group>
  );
}

// ============================================================
// FloorplanScene 본체
// ============================================================

export function FloorplanScene({
  floorplan, selectedSpaceId, onSelect, onChange, editable = true,
}: FloorplanSceneProps) {
  const trimmedById = useMemo(() => {
    const m = new Map<string, TrimmedSpace>();
    for (const ts of floorplan.trimmedSpaces) m.set(ts.spaceId, ts);
    return m;
  }, [floorplan.trimmedSpaces]);

  const handleRotate = useCallback((spaceId: string) => {
    const idx = floorplan.spaces.findIndex((s) => s.id === spaceId);
    if (idx < 0) return;
    const next = floorplan.spaces.slice();
    next[idx] = { ...next[idx], rotation: rotateClockwise90(next[idx].rotation) };
    const result = recomputeFloorplan({ ...floorplan, spaces: next });
    onChange(result, 'rotate');
  }, [floorplan, onChange]);

  // mutable ref — 드래그 시작 시점의 baseX/baseY를 보존. useRef가 useMemo([])보다 안전.
  const dragRef = useRef({ baseX: 0, baseY: 0, spaceId: '' });

  const handleDragStart = useCallback((spaceId: string) => {
    const s = floorplan.spaces.find((sp) => sp.id === spaceId);
    if (!s) return;
    dragRef.current.baseX = s.x;
    dragRef.current.baseY = s.y;
    dragRef.current.spaceId = spaceId;
  }, [floorplan]);

  const handleDragMove = useCallback((spaceId: string, dx: number, dz: number) => {
    if (dragRef.current.spaceId !== spaceId) return;
    const idx = floorplan.spaces.findIndex((s) => s.id === spaceId);
    if (idx < 0) return;
    const next = floorplan.spaces.slice();
    next[idx] = {
      ...next[idx],
      x: snap(dragRef.current.baseX + dx),
      y: snap(dragRef.current.baseY + dz),
    };
    const result = recomputeFloorplan({ ...floorplan, spaces: next });
    onChange(result, 'drag');
  }, [floorplan, onChange]);

  const handleDragEnd = useCallback(() => {
    dragRef.current.spaceId = '';
  }, []);

  return (
    <group>
      {/* 평면도 그리드 */}
      <gridHelper args={[10000, 100, '#cbd5e1', '#e2e8f0']} position={[0, 0, 0]} />

      {floorplan.spaces.map((space) => (
        <SpaceMesh
          key={space.id}
          space={space}
          trimmed={trimmedById.get(space.id)}
          selected={selectedSpaceId === space.id}
          editable={editable}
          onSelect={() => onSelect(space.id)}
          onContextMenu={() => editable && handleRotate(space.id)}
          onDragStart={() => handleDragStart(space.id)}
          onDragMove={(dx, dz) => handleDragMove(space.id, dx, dz)}
          onDragEnd={handleDragEnd}
        />
      ))}

      {/*
        빈 곳 클릭 → 선택 해제.
        부모 group이 [-PI/2,0,0]으로 회전되어 있어 floorplan XY 평면이 world XZ로 매핑됨.
        plane은 group 내부에서 기본 XY 방향을 그대로 두고 살짝 -Z로 옮겨 SpaceMesh 뒤에 위치.
      */}
      <mesh
        position={[0, 0, -0.1]}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          onSelect(null);
        }}
      >
        <planeGeometry args={[20000, 20000]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}
