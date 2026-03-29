'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Html, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import {
  MATERIALS,
  MODULE_DEFAULT_W,
  genModuleId,
  type CabinetCategory,
  type CabinetModule,
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

/* ── 클릭 가능한 모듈 mesh ── */
function ClickableModule({ part, color, wireframe, onSelect }: { part: { id: string; x: number; y: number; z: number; width: number; height: number; depth: number }; color: string; wireframe?: boolean; onSelect: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const isClickable = !part.id.includes('-face') && !part.id.startsWith('finish') && !part.id.startsWith('molding') && !part.id.startsWith('toekick') && !part.id.startsWith('countertop') && !part.id.startsWith('install') && !part.id.startsWith('fridge-cavity') && !part.id.startsWith('mirror') && part.id.startsWith('mod-');

  return (
    <mesh
      position={[part.x, part.y, part.z]}
      castShadow receiveShadow
      onClick={isClickable ? (e) => { e.stopPropagation(); onSelect(part.id); } : undefined}
      onPointerOver={isClickable ? () => setHovered(true) : undefined}
      onPointerOut={isClickable ? () => setHovered(false) : undefined}
    >
      <boxGeometry args={[part.width, part.height, part.depth]} />
      <meshStandardMaterial
        color={hovered && isClickable ? '#c9a87c' : color}
        metalness={wireframe ? 0.1 : 0.2}
        roughness={wireframe ? 0.5 : 0.75}
        wireframe={wireframe}
        emissive={hovered && isClickable ? '#3a2a1a' : '#000000'}
        emissiveIntensity={hovered && isClickable ? 0.15 : 0}
      />
    </mesh>
  );
}

function SceneContent({
  parts, palette, cameraView, preset, planner, derived, onAddLower, onAddUpper, onSelectModule,
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
}) {
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
        {parts.map((part) => (
          <ClickableModule key={part.id} part={part} color={palette[part.colorKey]} wireframe={part.wireframe} onSelect={onSelectModule} />
        ))}

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
      <OrbitControls enablePan minDistance={700} maxDistance={7000} target={[0, 900, 0]} minPolarAngle={cameraView === 'top' ? 0.01 : 0.25} maxPolarAngle={cameraView === 'top' ? 0.01 : Math.PI / 2} />
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

      {/* 삭제 */}
      <button onClick={() => { onDelete(module.id); onClose(); }}
        style={{ width: '100%', padding: '10px', border: '1px solid #fca5a5', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>
        🗑 모듈 삭제
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

  const selectedModule = selectedModuleId
    ? [...(planner.lowerModules ?? []), ...(planner.upperModules ?? [])].find((m) => m.id === selectedModuleId)
    : null;

  const selectedSection: 'lower' | 'upper' = selectedModuleId
    ? (planner.upperModules ?? []).some((m) => m.id === selectedModuleId) ? 'upper' : 'lower'
    : 'lower';

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', position: 'relative' }}
      onClick={() => setSelectedModuleId(null)}>
      <Canvas shadows dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
        <SceneContent
          parts={derived.parts} palette={palette} cameraView={cameraView}
          preset={preset} planner={planner} derived={derived}
          onAddLower={addLower} onAddUpper={addUpper}
          onSelectModule={setSelectedModuleId}
        />
      </Canvas>

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
    </div>
  );
}
