'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Environment, Html, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import {
  MATERIALS,
  MODULE_DEFAULT_W,
  autoCalculateModules,
  genModuleId,
  type CabinetCategory,
  type CabinetModule,
  type DoorOpenDirection,
  type DoorType,
  type MaterialTone,
  type ModuleEntry,
  type ModuleKind,
  createPlannerState,
  deriveCabinet,
  getPresetById,
  type PlannerState,
} from '../../lib/planner';

type CameraView = 'perspective' | 'front' | 'top';

const FONT = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';

/* ── 빈 상태 중앙 + 버튼 ── */
function AddButtonCenter({ position, label, onClick }: { position: [number, number, number]; label: string; onClick: () => void }) {
  return (
    <Html position={position} center style={{ pointerEvents: 'auto' }}>
      <button onClick={onClick} style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid #b8956c', background: 'rgba(255,255,255,0.9)', color: '#b8956c', fontSize: 24, fontWeight: 300, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontFamily: FONT }}>+</button>
      <div style={{ marginTop: 4, fontSize: 11, color: '#666', textAlign: 'center', whiteSpace: 'nowrap', fontFamily: FONT }}>{label}</div>
    </Html>
  );
}

/* ── 측판 일체형 + 패널 ── */
function AddPanelSide({ position, moduleHeight, moduleDepth, color, onClick }: { position: [number, number, number]; moduleHeight: number; moduleDepth: number; color: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <group position={position}>
      <mesh onClick={(e) => { e.stopPropagation(); onClick(); }} onPointerOver={() => setHovered(true)} onPointerOut={() => setHovered(false)}>
        <boxGeometry args={[18, moduleHeight, moduleDepth]} />
        <meshStandardMaterial color={hovered ? '#b8956c' : color} metalness={0.15} roughness={0.7} opacity={hovered ? 1 : 0.6} transparent />
      </mesh>
      <Html center style={{ pointerEvents: 'none' }}>
        <div style={{ color: hovered ? '#fff' : '#b8956c', fontSize: 20, fontWeight: 600, userSelect: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.3)', fontFamily: FONT }}>+</div>
      </Html>
    </group>
  );
}

/* ── 필수장 타입별 색상 ── */
const MODULE_TYPE_COLORS: Record<string, { body: string; face: string; outline: string; emissive: string }> = {
  sink: { body: '#b3d4e8', face: '#8ab8d4', outline: '#0284c7', emissive: '#0369a1' },
  cook: { body: '#e8b3b3', face: '#d48a8a', outline: '#dc2626', emissive: '#b91c1c' },
  hood: { body: '#c9b3e8', face: '#a88ad4', outline: '#7c3aed', emissive: '#6d28d9' },
};

/* ── 드래그+클릭 가능한 모듈 mesh ── */
function ClickableModule({ part, color, wireframe, onSelect, halfW, controlsRef, onDragModule, onDragMove, shiftDir }: {
  part: { id: string; x: number; y: number; z: number; width: number; height: number; depth: number; essential?: boolean; moduleType?: string; isDoor?: boolean; parentModuleId?: string; openDirection?: 'left' | 'right' };
  color: string; wireframe?: boolean;
  onSelect: (id: string) => void;
  halfW?: number;
  controlsRef?: React.RefObject<OrbitControlsImpl | null>;
  onDragModule?: (id: string, newX: number) => void;
  onDragMove?: (id: string | null, x: number | null) => void;
  shiftDir?: 'left' | 'right' | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const didDragRef = useRef(false);
  const dragOffsetRef = useRef(0);

  const isMod = part.id.startsWith('mod-');
  const isFace = part.id.endsWith('-face');
  const isDoorPanel = !!(part as any).isDoor;
  const isUtility = part.id.startsWith('utility-');
  const isClickable = isMod || isUtility || isDoorPanel;
  const isDraggable = isMod && !isFace && !isDoorPanel && !!onDragModule && halfW != null;
  const isEssential = !!(part as any).essential;
  const parentModuleId = (part as any).parentModuleId as string | undefined;
  const moduleId = isDoorPanel && parentModuleId ? parentModuleId : (isMod ? part.id.replace(/-face$/, '') : part.id);

  // 타입별 색상 결정
  const mType = (part as any).moduleType as string | undefined;
  const typeColor = mType && MODULE_TYPE_COLORS[mType];
  let baseColor = color;
  let emissiveColor = '#000000';
  let emissiveInt = 0;
  let outlineColor = '#b8956c';

  if (isDoorPanel) {
    // 도어 패널: 약간 밝은 톤 + 미세한 emissive
    baseColor = typeColor ? typeColor.face : color;
    emissiveColor = typeColor ? typeColor.emissive : '#2a2010';
    emissiveInt = 0.05;
    outlineColor = typeColor ? typeColor.outline : '#a08060';
  } else if (typeColor && !isUtility) {
    baseColor = isFace ? typeColor.face : typeColor.body;
    emissiveColor = typeColor.emissive;
    emissiveInt = 0.1;
    outlineColor = typeColor.outline;
  } else if (isEssential) {
    emissiveColor = '#b8956c';
    emissiveInt = 0.08;
  }

  const getPlaneX = (e: { ray: THREE.Ray }) => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -part.z);
    const target = new THREE.Vector3();
    e.ray.intersectPlane(plane, target);
    return target.x;
  };

  const displayX = dragX != null ? dragX : part.x;

  return (
    <group position={[displayX, part.y, part.z]}>
      <mesh
        castShadow receiveShadow
        onPointerDown={isDraggable ? (e) => {
          e.stopPropagation();
          draggingRef.current = true;
          didDragRef.current = false;
          dragOffsetRef.current = getPlaneX(e) - part.x;
          (e.target as any).setPointerCapture(e.pointerId);
          if (controlsRef?.current) controlsRef.current.enabled = false;
        } : undefined}
        onPointerUp={isDraggable ? (e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          (e.target as any).releasePointerCapture(e.pointerId);
          if (controlsRef?.current) controlsRef.current.enabled = true;
          onDragMove?.(null, null);
          if (didDragRef.current) {
            onDragModule!(moduleId, dragX ?? part.x);
            setDragX(null);
          } else {
            e.stopPropagation();
            onSelect(moduleId);
          }
        } : undefined}
        onPointerMove={isDraggable ? (e) => {
          if (!draggingRef.current) return;
          didDragRef.current = true;
          const newX = Math.max(-halfW!, Math.min(halfW!, getPlaneX(e) - dragOffsetRef.current));
          setDragX(newX);
          onDragMove?.(moduleId, newX);
        } : undefined}
        onClick={!isDraggable && isClickable ? (e) => { e.stopPropagation(); onSelect(moduleId); } : undefined}
        onPointerOver={isClickable ? () => setHovered(true) : undefined}
        onPointerOut={isClickable ? () => {
          setHovered(false);
          if (draggingRef.current) {
            draggingRef.current = false;
            if (controlsRef?.current) controlsRef.current.enabled = true;
            onDragMove?.(null, null);
            if (didDragRef.current && onDragModule) { onDragModule(moduleId, dragX ?? part.x); }
            setDragX(null);
          }
        } : undefined}
      >
        <boxGeometry args={[part.width, part.height, part.depth]} />
        <meshStandardMaterial
          color={isUtility ? (hovered ? '#64b5f6' : (part.id.includes('distributor') ? '#2196f3' : '#78909c'))
            : (draggingRef.current ? '#e8d5b8' : (hovered && isClickable ? '#c9a87c' : baseColor))}
          metalness={isDoorPanel ? 0.12 : (wireframe ? 0.1 : 0.2)}
          roughness={isDoorPanel ? 0.65 : (wireframe ? 0.5 : 0.75)}
          wireframe={wireframe}
          opacity={isUtility ? 0.7 : (draggingRef.current ? 0.85 : 1)}
          transparent={isUtility || draggingRef.current}
          emissive={hovered && isClickable ? (isUtility ? '#1565c0' : '#3a2a1a') : emissiveColor}
          emissiveIntensity={hovered && isClickable ? 0.2 : emissiveInt}
        />
      </mesh>
      {/* 필수장 윤곽선 */}
      {isEssential && !wireframe && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(part.width, part.height, part.depth)]} />
          <lineBasicMaterial color={outlineColor} linewidth={1} />
        </lineSegments>
      )}
      {/* 도어 패널 엣지 라인 */}
      {isDoorPanel && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(part.width, part.height, part.depth)]} />
          <lineBasicMaterial color={outlineColor} linewidth={1} />
        </lineSegments>
      )}
      {/* 이동 방향 인디케이터: 밀리는 방향에 굵은 선 */}
      {shiftDir && !isFace && (
        <mesh position={[shiftDir === 'left' ? -part.width / 2 - 2 : part.width / 2 + 2, 0, part.depth / 2 + 1]}>
          <boxGeometry args={[4, part.height, 4]} />
          <meshBasicMaterial color="#f59e0b" />
        </mesh>
      )}
    </group>
  );
}

/* ── 드래그 가능한 유틸리티 mesh ── */
function DraggableUtility({ part, halfW, controlsRef, onDrag, onSelect }: {
  part: { id: string; x: number; y: number; z: number; width: number; height: number; depth: number };
  halfW: number;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  onDrag: (id: string, newX: number) => void;
  onSelect: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const draggingRef = useRef(false);
  const isDist = part.id.includes('distributor');
  const didDrag = useRef(false);
  const dragOffsetRef = useRef(0);

  // ray와 Y평면의 교차점에서 안정적인 X좌표 추출
  const getPlaneX = (e: { ray: THREE.Ray }) => {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -part.z);
    const target = new THREE.Vector3();
    e.ray.intersectPlane(plane, target);
    return target.x;
  };

  return (
    <group>
      <mesh
        position={[part.x, part.y, part.z]}
        onPointerDown={(e) => {
          e.stopPropagation();
          draggingRef.current = true;
          didDrag.current = false;
          dragOffsetRef.current = getPlaneX(e) - part.x;
          (e.target as any).setPointerCapture(e.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = false;
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          (e.target as any).releasePointerCapture(e.pointerId);
          if (controlsRef.current) controlsRef.current.enabled = true;
          if (!didDrag.current) { e.stopPropagation(); onSelect(part.id); }
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          didDrag.current = true;
          const planeX = getPlaneX(e);
          const newX = Math.max(-halfW, Math.min(halfW, planeX - dragOffsetRef.current));
          onDrag(part.id, newX);
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => {
          setHovered(false);
          if (draggingRef.current) { draggingRef.current = false; if (controlsRef.current) controlsRef.current.enabled = true; }
        }}
      >
        <boxGeometry args={[part.width, part.height, part.depth]} />
        <meshStandardMaterial
          color={hovered ? '#64b5f6' : (isDist ? '#2196f3' : '#78909c')}
          opacity={0.7} transparent
          emissive={hovered ? '#1565c0' : '#000'} emissiveIntensity={hovered ? 0.2 : 0}
        />
      </mesh>
      {/* 라벨 */}
      <Html position={[part.x, part.y + part.height / 2 + 20, part.z]} center style={{ pointerEvents: 'none' }}>
        <div style={{ fontSize: 10, color: isDist ? '#1565c0' : '#546e7a', whiteSpace: 'nowrap', fontFamily: FONT, fontWeight: 600, textShadow: '0 0 4px #fff' }}>
          {isDist ? '💧 분배기' : '🌀 환풍구'}
        </div>
      </Html>
    </group>
  );
}

/* ── 치수 라벨 (3D 공간에 mm 표시) ── */
function DimensionLabel({ position, text, color = '#666' }: { position: [number, number, number]; text: string; color?: string }) {
  return (
    <Html position={position} center style={{ pointerEvents: 'none' }}>
      <div style={{ fontSize: 10, color, fontFamily: FONT, fontWeight: 600, background: 'rgba(255,255,255,0.8)', padding: '1px 4px', borderRadius: 3, whiteSpace: 'nowrap', border: `1px solid ${color}33` }}>
        {text}
      </div>
    </Html>
  );
}

function SceneContent({
  parts, palette, cameraView, preset, planner, derived, onAddLower, onAddUpper, onSelectModule, onDragUtility, onDragModule,
}: {
  parts: ReturnType<typeof deriveCabinet>['parts'];
  palette: (typeof MATERIALS)[keyof typeof MATERIALS];
  cameraView: CameraView;
  preset: ReturnType<typeof getPresetById>;
  planner: PlannerState;
  derived: ReturnType<typeof deriveCabinet>;
  onAddLower: () => void;
  onAddUpper: () => void;
  onSelectModule: (id: string) => void;
  onDragUtility: (id: string, newX: number) => void;
  onDragModule: (id: string, newX: number) => void;
}) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // 드래그 중인 모듈 추적 (삽입 위치 인디케이터용)
  const [dragState, setDragState] = useState<{ id: string; x: number } | null>(null);

  // 드래그 중인 모듈의 삽입 위치 기반 shiftDir 계산
  const shiftMap = useMemo<Record<string, 'left' | 'right'>>(() => {
    if (!dragState) return {};
    const halfW = planner.width / 2;
    const targetMm = Math.max(0, Math.min(planner.width, dragState.x + halfW));
    const isUpper = (planner.upperModules ?? []).some(m => m.id === dragState.id);
    const list = isUpper ? (planner.upperModules ?? []) : (planner.lowerModules ?? []);

    const draggedIdx = list.findIndex(m => m.id === dragState.id);
    if (draggedIdx < 0) return {};

    // 각 모듈의 현재 중심 X 계산
    const fL = planner.finishLeftW ?? 0;
    let cursor = fL;
    const centers: { id: string; cx: number }[] = [];
    list.forEach(m => {
      centers.push({ id: m.id, cx: cursor + m.width / 2 });
      cursor += m.width;
    });

    // 삽입될 위치 결정
    const withoutDragged = centers.filter(c => c.id !== dragState.id);
    let insertIdx = withoutDragged.length;
    for (let i = 0; i < withoutDragged.length; i++) {
      if (targetMm < withoutDragged[i].cx) { insertIdx = i; break; }
    }

    // 원래 위치와 비교하여 밀리는 방향 결정
    const origIdx = withoutDragged.length; // draggedIdx in withoutDragged 기준
    const result: Record<string, 'left' | 'right'> = {};
    const origOrder = list.filter(m => m.id !== dragState.id);
    const origDragPos = draggedIdx;

    // insertIdx > origDragPos: 드래그가 오른쪽으로 → 사이 모듈은 왼쪽으로 밀림
    // insertIdx < origDragPos: 드래그가 왼쪽으로 → 사이 모듈은 오른쪽으로 밀림
    const adjustedOrigIdx = draggedIdx; // 원래 list에서의 index
    // withoutDragged에서의 삽입 위치 vs 원래 위치
    const origPosInFiltered = list.slice(0, draggedIdx).filter(m => m.id !== dragState.id).length;

    if (insertIdx < origPosInFiltered) {
      // 왼쪽으로 이동 → insertIdx ~ origPosInFiltered-1 모듈이 오른쪽으로 밀림
      for (let i = insertIdx; i < origPosInFiltered; i++) {
        result[`mod-${withoutDragged[i].id}`] = 'right';
      }
    } else if (insertIdx > origPosInFiltered) {
      // 오른쪽으로 이동 → origPosInFiltered ~ insertIdx-1 모듈이 왼쪽으로 밀림
      for (let i = origPosInFiltered; i < insertIdx; i++) {
        result[`mod-${withoutDragged[i].id}`] = 'left';
      }
    }
    return result;
  }, [dragState, planner]);

  const handleDragMove = useCallback((id: string | null, x: number | null) => {
    setDragState(id && x != null ? { id, x } : null);
  }, []);
  const cameraPosition = cameraView === 'top' ? [0, 2400, 0.01] : cameraView === 'front' ? [0, 900, 2800] : [2300, 1500, 2300];

  const toeKickH = planner.toeKickH ?? 0;
  const moldingH = planner.moldingH ?? 0;
  const height = planner.height;
  const depth = planner.depth;
  const upperDepth = preset.fullHeight ? depth : preset.upperDepth;
  const upperZOffset = preset.fullHeight ? 0 : -(depth - upperDepth) / 2;
  const lowerBodyH = preset.fullHeight ? Math.max(0, height - moldingH - toeKickH) : Math.min(preset.lowerHeight - toeKickH, height - toeKickH);
  const lowerCenterY = toeKickH + lowerBodyH / 2;
  const upperHeight = preset.fullHeight ? 0 : Math.min(preset.upperHeight, Math.max(0, height - moldingH - (toeKickH + lowerBodyH) - (preset.hasCountertop ? preset.counterThickness : 0)));
  const upperCenterY = height - moldingH - upperHeight / 2;

  const { lowerLayout, upperLayout } = derived;
  const hasLower = (planner.lowerModules ?? []).length > 0;
  const hasUpper = (planner.upperModules ?? []).length > 0;
  const canAddLower = (planner.lowerModules ?? []).length < 10;
  const canAddUpper = (planner.upperModules ?? []).length < 10;

  return (
    <>
      <color attach="background" args={['#f4efe7']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[1800, 2200, 1200]} intensity={2.1} castShadow />
      <directionalLight position={[-1200, 1000, -900]} intensity={0.8} />
      <group rotation={cameraView === 'top' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
        {/* 일반 파츠 */}
        {parts.filter(p => !p.id.startsWith('utility-')).map((part) => (
          <ClickableModule key={part.id} part={part} color={palette[part.colorKey]} wireframe={part.wireframe} onSelect={onSelectModule} halfW={planner.width / 2} controlsRef={controlsRef} onDragModule={onDragModule} onDragMove={handleDragMove} shiftDir={shiftMap[part.id] || null} />
        ))}
        {/* 유틸리티 파츠 (드래그 가능) */}
        {parts.filter(p => p.id.startsWith('utility-')).map((part) => (
          <DraggableUtility key={part.id} part={part} halfW={planner.width / 2} controlsRef={controlsRef} onDrag={onDragUtility} onSelect={onSelectModule} />
        ))}

        {/* 치수 라벨 */}
        {derived.modules.length > 0 && (
          <>
            {/* 전체 폭 */}
            <DimensionLabel position={[0, -30, depth / 2 + 80]} text={`${planner.width}mm`} color="#333" />
            {/* 전체 높이 */}
            <DimensionLabel position={[-planner.width / 2 - 60, height / 2, 0]} text={`${height}mm`} color="#333" />
            {/* 모듈별 폭 */}
            {derived.modules.map((mod) => {
              const modPart = parts.find(p => p.id === mod.id);
              return modPart ? (
                <DimensionLabel key={`dim-${mod.id}`} position={[modPart.x, modPart.y - modPart.height / 2 - 20, modPart.z + modPart.depth / 2 + 30]} text={`${mod.width}`} color={mod.section === 'upper' ? '#6366f1' : '#b8956c'} />
              ) : null;
            })}
          </>
        )}

        {/* 하부장 + 버튼 */}
        {!preset.fullHeight && canAddLower && (
          hasLower && lowerLayout ? (
            <>
              <AddPanelSide position={[lowerLayout.startX - 9, lowerLayout.centerY, 0]} moduleHeight={lowerBodyH} moduleDepth={depth} color={palette.body} onClick={onAddLower} />
              <AddPanelSide position={[lowerLayout.endX + 9, lowerLayout.centerY, 0]} moduleHeight={lowerBodyH} moduleDepth={depth} color={palette.body} onClick={onAddLower} />
            </>
          ) : (
            <AddButtonCenter position={[0, lowerCenterY, depth / 2 + 50]} label="하부장 추가" onClick={onAddLower} />
          )
        )}

        {/* 상부장 + 버튼 */}
        {!preset.fullHeight && upperHeight > 0 && canAddUpper && (
          hasUpper && upperLayout ? (
            <>
              <AddPanelSide position={[upperLayout.startX - 9, upperLayout.centerY, upperLayout.z]} moduleHeight={upperHeight} moduleDepth={upperDepth} color={palette.accent} onClick={onAddUpper} />
              <AddPanelSide position={[upperLayout.endX + 9, upperLayout.centerY, upperLayout.z]} moduleHeight={upperHeight} moduleDepth={upperDepth} color={palette.accent} onClick={onAddUpper} />
            </>
          ) : (
            <AddButtonCenter position={[0, upperCenterY, upperDepth / 2 + upperZOffset + 50]} label="상부장 추가" onClick={onAddUpper} />
          )
        )}

        {/* fullHeight */}
        {preset.fullHeight && canAddLower && (
          hasLower && lowerLayout ? (
            <>
              <AddPanelSide position={[lowerLayout.startX - 9, lowerLayout.centerY, 0]} moduleHeight={lowerBodyH} moduleDepth={depth} color={palette.body} onClick={onAddLower} />
              <AddPanelSide position={[lowerLayout.endX + 9, lowerLayout.centerY, 0]} moduleHeight={lowerBodyH} moduleDepth={depth} color={palette.body} onClick={onAddLower} />
            </>
          ) : (
            <AddButtonCenter position={[0, toeKickH + lowerBodyH / 2, depth / 2 + 50]} label="모듈 추가" onClick={onAddLower} />
          )
        )}
      </group>
      <primitive object={new THREE.GridHelper(6000, 12, '#3a3a3a', '#3a3a3a')} position={[0, 0, 0]} />
      <OrbitControls ref={controlsRef} enablePan minDistance={700} maxDistance={7000} target={[0, 900, 0]} minPolarAngle={cameraView === 'top' ? 0.01 : 0.25} maxPolarAngle={cameraView === 'top' ? 0.01 : Math.PI / 2} />
      <Environment preset="apartment" />
      <PerspectiveCamera makeDefault position={cameraPosition as [number, number, number]} fov={38} near={1} far={20000} />
    </>
  );
}

/* ── 모듈 편집 팝업 ── */
function ModulePopup({
  module, section, onUpdate, onDelete, onClose,
}: {
  module: ModuleEntry;
  section: 'lower' | 'upper';
  onUpdate: (id: string, changes: Partial<ModuleEntry>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const kinds: { value: ModuleKind; label: string; icon: string }[] = [
    { value: 'door', label: '도어', icon: '🚪' },
    { value: 'drawer', label: '서랍', icon: '🗄️' },
    { value: 'open', label: '오픈', icon: '📦' },
  ];

  const sectionLabel = section === 'upper' ? '상부장' : '하부장';
  const sectionColor = section === 'upper' ? '#6366f1' : '#b8956c';

  return (
    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#fff', borderRadius: 14, padding: '20px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', zIndex: 100, minWidth: 260, fontFamily: FONT }}
      onClick={(e) => e.stopPropagation()}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: sectionColor, color: '#fff', fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{sectionLabel}</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#2d2a26' }}>{module.width}mm</span>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#999', padding: '0 4px' }}>✕</button>
      </div>

      {/* 타입 선택 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>타입</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {kinds.map((k) => (
            <button key={k.value} onClick={() => onUpdate(module.id, { kind: k.value })}
              style={{ flex: 1, padding: '8px 0', border: module.kind === k.value ? `2px solid ${sectionColor}` : '1px solid #ddd', borderRadius: 8, background: module.kind === k.value ? `${sectionColor}11` : '#fafafa', cursor: 'pointer', fontSize: 12, fontFamily: FONT, color: '#333' }}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
      </div>

      {/* 너비 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>너비 (mm)</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => onUpdate(module.id, { width: Math.max(350, module.width - 50) })}
            style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 16, fontFamily: FONT }}>-</button>
          <input type="number" value={module.width} step={50} min={350} max={1200}
            onChange={(e) => { const v = Math.min(1200, Math.max(350, Math.round(Number(e.target.value) / 50) * 50)); onUpdate(module.id, { width: v }); }}
            style={{ flex: 1, textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: '6px', fontSize: 14, fontWeight: 600, fontFamily: FONT }} />
          <button onClick={() => onUpdate(module.id, { width: Math.min(1200, module.width + 50) })}
            style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid #ddd', background: '#f5f5f5', cursor: 'pointer', fontSize: 16, fontFamily: FONT }}>+</button>
        </div>
      </div>

      {/* 도어 설정 (kind='door' 일 때만) */}
      {module.kind === 'door' && (
        <div style={{ marginBottom: 16, paddingTop: 12, borderTop: '1px solid #eee' }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 600 }}>도어 설정</div>

          {/* 도어 수 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>도어 수</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 2].map((n) => {
                const currentCount = module.doorCount ?? (module.width <= 600 ? 1 : 2);
                return (
                  <button key={n} onClick={() => onUpdate(module.id, { doorCount: n })}
                    style={{ flex: 1, padding: '6px 0', border: currentCount === n ? `2px solid ${sectionColor}` : '1px solid #ddd', borderRadius: 6, background: currentCount === n ? `${sectionColor}11` : '#fafafa', cursor: 'pointer', fontSize: 12, fontFamily: FONT, color: '#333' }}>
                    {n}도어
                  </button>
                );
              })}
            </div>
          </div>

          {/* 열림 방향 */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>열림 방향</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {(() => {
                const currentCount = module.doorCount ?? (module.width <= 600 ? 1 : 2);
                const directions: { value: DoorOpenDirection; label: string }[] = currentCount >= 2
                  ? [{ value: 'both', label: '↔ 양쪽' }]
                  : [{ value: 'left', label: '← 좌' }, { value: 'right', label: '→ 우' }];
                const currentDir = module.openDirection ?? (currentCount >= 2 ? 'both' : 'left');
                return directions.map((d) => (
                  <button key={d.value} onClick={() => onUpdate(module.id, { openDirection: d.value })}
                    style={{ flex: 1, padding: '6px 0', border: currentDir === d.value ? `2px solid ${sectionColor}` : '1px solid #ddd', borderRadius: 6, background: currentDir === d.value ? `${sectionColor}11` : '#fafafa', cursor: 'pointer', fontSize: 11, fontFamily: FONT, color: '#333' }}>
                    {d.label}
                  </button>
                ));
              })()}
            </div>
          </div>

          {/* 도어 타입 */}
          <div>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>도어 타입</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([
                { value: 'swing' as DoorType, label: '여닫이' },
                { value: 'sliding' as DoorType, label: '슬라이딩' },
                ...(section === 'upper' ? [{ value: 'liftup' as DoorType, label: '리프트업' }] : []),
              ]).map((dt) => {
                const currentType = module.doorType ?? 'swing';
                return (
                  <button key={dt.value} onClick={() => onUpdate(module.id, { doorType: dt.value })}
                    style={{ flex: 1, padding: '6px 0', border: currentType === dt.value ? `2px solid ${sectionColor}` : '1px solid #ddd', borderRadius: 6, background: currentType === dt.value ? `${sectionColor}11` : '#fafafa', cursor: 'pointer', fontSize: 11, fontFamily: FONT, color: '#333' }}>
                    {dt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 삭제 */}
      <button onClick={() => { onDelete(module.id); onClose(); }}
        style={{ width: '100%', padding: '10px', border: '1px solid #fca5a5', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
        🗑 모듈 삭제
      </button>
    </div>
  );
}

/* ── 유틸리티 편집 팝업 ── */
function UtilityPopup({
  type, planner, onUpdate, onDelete, onClose,
}: {
  type: 'distributor' | 'vent';
  planner: PlannerState;
  onUpdate: (changes: Partial<PlannerState>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isDist = type === 'distributor';
  const label = isDist ? '💧 분배기 위치' : '🌀 환풍구';
  const color = isDist ? '#2196f3' : '#78909c';

  const startVal = isDist ? (planner.distributorStart ?? Math.round(planner.width * 0.15)) : (planner.ventStart ?? Math.round(planner.width * 0.7));
  const endVal = isDist ? (planner.distributorEnd ?? Math.round(planner.width * 0.15 + 700)) : 0;

  return (
    <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#fff', borderRadius: 14, padding: '20px 24px', boxShadow: '0 8px 32px rgba(0,0,0,0.18)', zIndex: 100, minWidth: 280, fontFamily: FONT }}
      onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color }}>{label}</span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#999', padding: '0 4px' }}>✕</button>
      </div>

      {/* 위치 입력 */}
      {isDist ? (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>시작 (mm)</div>
            <input type="number" value={startVal} step={10} min={0} max={planner.width}
              onChange={(e) => onUpdate({ distributorStart: Math.max(0, Number(e.target.value)) })}
              style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: '6px', fontSize: 13, fontFamily: FONT }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>끝 (mm)</div>
            <input type="number" value={endVal} step={10} min={0} max={planner.width}
              onChange={(e) => onUpdate({ distributorEnd: Math.max(0, Number(e.target.value)) })}
              style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: '6px', fontSize: 13, fontFamily: FONT }} />
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>위치 (mm, 좌측 기준)</div>
          <input type="number" value={startVal} step={10} min={0} max={planner.width}
            onChange={(e) => onUpdate({ ventStart: Math.max(0, Number(e.target.value)) })}
            style={{ width: '100%', textAlign: 'center', border: '1px solid #ddd', borderRadius: 8, padding: '6px', fontSize: 13, fontFamily: FONT }} />
        </div>
      )}

      {/* 삭제 (숨김) */}
      <button onClick={() => { onDelete(); onClose(); }}
        style={{ width: '100%', padding: '10px', border: '1px solid #fca5a5', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
        🗑 삭제 (숨김)
      </button>
    </div>
  );
}

export interface EmbedCanvasProps {
  initialPreset?: CabinetCategory;
  initialWidth?: number;
  initialHeight?: number;
  initialDepth?: number;
  initialMaterial?: MaterialTone;
  initialLowerCount?: number;
  initialUpperCount?: number;
  initialView?: CameraView;
  initialMoldingH?: number;
  initialToeKickH?: number;
  initialFinishLeftW?: number;
  initialFinishRightW?: number;
}

export default function EmbedCanvas(props: EmbedCanvasProps) {
  const [planner, setPlanner] = useState<PlannerState>(() => {
    const state = createPlannerState(props.initialPreset || 'sink');
    if (props.initialWidth) state.width = props.initialWidth;
    if (props.initialHeight) state.height = props.initialHeight;
    if (props.initialDepth) state.depth = props.initialDepth;
    if (props.initialMaterial) state.material = props.initialMaterial;
    if (props.initialMoldingH != null) state.moldingH = props.initialMoldingH;
    if (props.initialToeKickH != null) state.toeKickH = props.initialToeKickH;
    if (props.initialFinishLeftW != null) state.finishLeftW = props.initialFinishLeftW;
    if (props.initialFinishRightW != null) state.finishRightW = props.initialFinishRightW;
    return state;
  });
  const [cameraView, setCameraView] = useState<CameraView>(props.initialView || 'perspective');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

  const derived = useMemo(() => deriveCabinet(planner), [planner]);
  const palette = MATERIALS[planner.material];
  const preset = getPresetById(planner.presetId);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'UPDATE_PLANNER') setPlanner((prev) => ({ ...prev, ...e.data.payload }));
      if (e.data?.type === 'SET_CAMERA_VIEW') setCameraView(e.data.view);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    window.parent?.postMessage({ type: 'PLANNER_STATE', payload: { planner, derived } }, '*');
  }, [planner, derived]);

  const defaultLowerKind: ModuleKind = preset.fullHeight ? 'door' : 'drawer';

  const addLower = useCallback(() => {
    setPlanner((prev) => ({
      ...prev,
      lowerModules: [...(prev.lowerModules ?? []), { id: genModuleId(), kind: defaultLowerKind, width: MODULE_DEFAULT_W }],
      lowerCount: (prev.lowerModules ?? []).length + 1,
    }));
  }, [defaultLowerKind]);

  const addUpper = useCallback(() => {
    setPlanner((prev) => ({
      ...prev,
      upperModules: [...(prev.upperModules ?? []), { id: genModuleId(), kind: 'door', width: MODULE_DEFAULT_W }],
      upperCount: (prev.upperModules ?? []).length + 1,
    }));
  }, []);

  const updateModule = useCallback((id: string, changes: Partial<ModuleEntry>) => {
    setPlanner((prev) => {
      const updateList = (list: ModuleEntry[]) => list.map((m) => m.id === id ? { ...m, ...changes } : m);
      return { ...prev, lowerModules: updateList(prev.lowerModules ?? []), upperModules: updateList(prev.upperModules ?? []) };
    });
  }, []);

  const deleteModule = useCallback((id: string) => {
    setPlanner((prev) => {
      const newLower = (prev.lowerModules ?? []).filter((m) => m.id !== id);
      const newUpper = (prev.upperModules ?? []).filter((m) => m.id !== id);
      return { ...prev, lowerModules: newLower, upperModules: newUpper, lowerCount: newLower.length, upperCount: newUpper.length };
    });
    setSelectedModuleId(null);
  }, []);

  // 모듈 드래그 완료: X좌표 기준으로 모듈 순서 재정렬
  const dragModule = useCallback((id: string, newX: number) => {
    setPlanner((prev) => {
      const halfW = prev.width / 2;
      const isUpper = (prev.upperModules ?? []).some(m => m.id === id);
      const listKey = isUpper ? 'upperModules' : 'lowerModules';
      const list = [...(prev[listKey] ?? [])];

      // 드래그된 모듈의 목표 절대 X (mm from left)
      const targetMm = Math.max(0, Math.min(prev.width, newX + halfW));

      // 각 모듈의 현재 절대 중심 X 계산
      const fL = prev.finishLeftW ?? 0;
      let cursor = fL;
      const positions = list.map((m) => {
        const cx = cursor + m.width / 2;
        cursor += m.width;
        return { id: m.id, centerX: cx };
      });

      // 드래그된 모듈을 목표 위치에 맞게 순서 변경
      const draggedIdx = list.findIndex(m => m.id === id);
      if (draggedIdx < 0) return prev;
      const [dragged] = list.splice(draggedIdx, 1);

      // 삽입 위치 결정: 목표 X보다 중심이 큰 첫 모듈 앞에 삽입
      let insertIdx = list.length;
      cursor = fL;
      for (let i = 0; i < list.length; i++) {
        const cx = cursor + list[i].width / 2;
        if (targetMm < cx) { insertIdx = i; break; }
        cursor += list[i].width;
      }
      list.splice(insertIdx, 0, dragged);

      return { ...prev, [listKey]: list };
    });
  }, []);

  const dragUtility = useCallback((id: string, newX: number) => {
    const halfW = planner.width / 2;
    const mmFromLeft = Math.round(Math.max(0, Math.min(planner.width, newX + halfW)));
    setPlanner((prev) => {
      if (id === 'utility-distributor') {
        const oldStart = prev.distributorStart ?? Math.round(prev.width * 0.15);
        const oldEnd = prev.distributorEnd ?? Math.round(prev.width * 0.15 + 700);
        const dw = oldEnd - oldStart;
        const center = mmFromLeft;
        return { ...prev, distributorStart: Math.max(0, center - dw / 2), distributorEnd: Math.min(prev.width, center + dw / 2) };
      }
      if (id === 'utility-vent') {
        return { ...prev, ventStart: mmFromLeft };
      }
      return prev;
    });
  }, [planner.width]);

  const selectedModule = selectedModuleId
    ? [...(planner.lowerModules ?? []), ...(planner.upperModules ?? [])].find((m) => m.id === selectedModuleId)
    : null;

  const selectedSection: 'lower' | 'upper' = selectedModuleId
    ? (planner.upperModules ?? []).some((m) => m.id === selectedModuleId) ? 'upper' : 'lower'
    : 'lower';

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', position: 'relative' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) setSelectedModuleId(null); }}>
      <Canvas shadows dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
        <SceneContent
          parts={derived.parts} palette={palette} cameraView={cameraView}
          preset={preset} planner={planner} derived={derived}
          onAddLower={addLower} onAddUpper={addUpper}
          onSelectModule={setSelectedModuleId}
          onDragUtility={dragUtility}
          onDragModule={dragModule}
        />
      </Canvas>

      {/* 팝업 배경 (클릭 시 닫기) */}
      {selectedModuleId && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 90 }}
          onClick={() => setSelectedModuleId(null)} />
      )}

      {/* 모듈 편집 팝업 */}
      {selectedModule && (
        <ModulePopup
          module={selectedModule}
          section={selectedSection}
          onUpdate={updateModule}
          onDelete={deleteModule}
          onClose={() => setSelectedModuleId(null)}
        />
      )}

      {/* 유틸리티 편집 팝업 */}
      {selectedModuleId === 'utility-distributor' && (
        <UtilityPopup
          type="distributor"
          planner={planner}
          onUpdate={(changes) => setPlanner((prev) => ({ ...prev, ...changes }))}
          onDelete={() => setPlanner((prev) => ({ ...prev, distributorStart: 0, distributorEnd: 0 }))}
          onClose={() => setSelectedModuleId(null)}
        />
      )}
      {selectedModuleId === 'utility-vent' && (
        <UtilityPopup
          type="vent"
          planner={planner}
          onUpdate={(changes) => setPlanner((prev) => ({ ...prev, ...changes }))}
          onDelete={() => setPlanner((prev) => ({ ...prev, ventStart: 0 }))}
          onClose={() => setSelectedModuleId(null)}
        />
      )}

      {/* 좌상단 컨트롤: 자동계산 + 유틸리티 토글 */}
      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 6, fontFamily: FONT }}>
        <button
          onClick={() => {
            const result = autoCalculateModules(planner);
            setPlanner((prev) => ({
              ...prev,
              lowerModules: result.lower,
              upperModules: result.upper,
              lowerCount: result.lower.length,
              upperCount: result.upper.length,
            }));
            setSelectedModuleId(null);
          }}
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #b8956c', background: 'linear-gradient(135deg,#b8956c,#d4b896)', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600, fontFamily: FONT, boxShadow: '0 2px 6px rgba(184,149,108,0.3)' }}>
          ⚡ 자동계산
        </button>
        <button
          onClick={() => setPlanner((prev) => ({ ...prev, distributorStart: prev.distributorStart === 0 ? null : 0, distributorEnd: prev.distributorEnd === 0 ? null : 0 }))}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #90caf9', background: (planner.distributorStart !== 0) ? '#e3f2fd' : '#f5f5f5', color: (planner.distributorStart !== 0) ? '#1565c0' : '#999', fontSize: 11, cursor: 'pointer', fontFamily: FONT }}>
          💧 {planner.distributorStart !== 0 ? '분배기' : '분배기 (숨김)'}
        </button>
        {!preset.fullHeight && (
          <button
            onClick={() => setPlanner((prev) => ({ ...prev, ventStart: prev.ventStart === 0 ? null : 0 }))}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #b0bec5', background: (planner.ventStart !== 0) ? '#eceff1' : '#f5f5f5', color: (planner.ventStart !== 0) ? '#546e7a' : '#999', fontSize: 11, cursor: 'pointer', fontFamily: FONT }}>
            🌀 {planner.ventStart !== 0 ? '환풍구' : '환풍구 (숨김)'}
          </button>
        )}
      </div>
    </div>
  );
}
