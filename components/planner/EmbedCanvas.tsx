'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Html, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import {
  MATERIALS,
  type CabinetCategory,
  type MaterialTone,
  createPlannerState,
  deriveCabinet,
  getPresetById,
  type PlannerState,
} from '../../lib/planner';

type CameraView = 'perspective' | 'front' | 'top';

/* ── 3D 공간 내 초기 + 버튼 (빈 상태) ── */
function AddButtonCenter({
  position,
  label,
  onClick,
}: {
  position: [number, number, number];
  label: string;
  onClick: () => void;
}) {
  return (
    <Html position={position} center style={{ pointerEvents: 'auto' }}>
      <button
        onClick={onClick}
        style={{
          width: 48, height: 48, borderRadius: '50%',
          border: '2px solid #b8956c', background: 'rgba(255,255,255,0.9)',
          color: '#b8956c', fontSize: 24, fontWeight: 300, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        }}
      >+</button>
      <div style={{ marginTop: 4, fontSize: 11, color: '#666', textAlign: 'center', whiteSpace: 'nowrap',
        fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' }}>{label}</div>
    </Html>
  );
}

/* ── 측판 일체형 + 패널 (3D mesh) ── */
function AddPanelSide({
  position,
  moduleHeight,
  moduleDepth,
  color,
  onClick,
}: {
  position: [number, number, number];
  moduleHeight: number;
  moduleDepth: number;
  color: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const panelW = 18; // 측판 두께와 동일
  return (
    <group position={position}>
      <mesh
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[panelW, moduleHeight, moduleDepth]} />
        <meshStandardMaterial
          color={hovered ? '#b8956c' : color}
          metalness={0.15}
          roughness={0.7}
          opacity={hovered ? 1 : 0.6}
          transparent
        />
      </mesh>
      {/* + 텍스트 */}
      <Html center style={{ pointerEvents: 'none' }}>
        <div style={{
          color: hovered ? '#fff' : '#b8956c',
          fontSize: 20, fontWeight: 600, userSelect: 'none',
          textShadow: '0 1px 2px rgba(0,0,0,0.3)',
          fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
        }}>+</div>
      </Html>
    </group>
  );
}

function SceneContent({
  parts,
  palette,
  cameraView,
  preset,
  planner,
  derived,
  onAddLower,
  onAddUpper,
}: {
  parts: ReturnType<typeof deriveCabinet>['parts'];
  palette: (typeof MATERIALS)[keyof typeof MATERIALS];
  cameraView: CameraView;
  preset: ReturnType<typeof getPresetById>;
  planner: PlannerState;
  derived: ReturnType<typeof deriveCabinet>;
  onAddLower: () => void;
  onAddUpper: () => void;
}) {
  const cameraPosition =
    cameraView === 'top' ? [0, 2400, 0.01] : cameraView === 'front' ? [0, 900, 2800] : [2300, 1500, 2300];

  const toeKickH = planner.toeKickH ?? 0;
  const moldingH = planner.moldingH ?? 0;
  const height = planner.height;
  const depth = planner.depth;
  const upperDepth = preset.fullHeight ? depth : preset.upperDepth;
  const upperZOffset = preset.fullHeight ? 0 : -(depth - upperDepth) / 2;

  const lowerBodyH = preset.fullHeight
    ? Math.max(0, height - moldingH - toeKickH)
    : Math.min(preset.lowerHeight - toeKickH, height - toeKickH);
  const lowerCenterY = toeKickH + lowerBodyH / 2;

  const upperHeight = preset.fullHeight
    ? 0
    : Math.min(preset.upperHeight, Math.max(0, height - moldingH - (toeKickH + lowerBodyH) - (preset.hasCountertop ? preset.counterThickness : 0)));
  const upperCenterY = height - moldingH - upperHeight / 2;

  const { lowerLayout, upperLayout } = derived;
  const hasLower = planner.lowerCount > 0;
  const hasUpper = planner.upperCount > 0;
  const canAddLower = planner.lowerCount < 10;
  const canAddUpper = planner.upperCount < 10;

  return (
    <>
      <color attach="background" args={['#f4efe7']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[1800, 2200, 1200]} intensity={2.1} castShadow />
      <directionalLight position={[-1200, 1000, -900]} intensity={0.8} />
      <group rotation={cameraView === 'top' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
        {parts.map((part) => (
          <mesh key={part.id} position={[part.x, part.y, part.z]} castShadow receiveShadow>
            <boxGeometry args={[part.width, part.height, part.depth]} />
            <meshStandardMaterial
              color={palette[part.colorKey]}
              metalness={part.wireframe ? 0.1 : 0.2}
              roughness={part.wireframe ? 0.5 : 0.75}
              wireframe={part.wireframe}
            />
          </mesh>
        ))}

        {/* ── 하부장 버튼 ── */}
        {!preset.fullHeight && canAddLower && (
          hasLower && lowerLayout ? (
            <>
              <AddPanelSide
                position={[lowerLayout.startX - 9, lowerLayout.centerY, 0]}
                moduleHeight={lowerBodyH}
                moduleDepth={depth}
                color={palette.body}
                onClick={onAddLower}
              />
              <AddPanelSide
                position={[lowerLayout.endX + 9, lowerLayout.centerY, 0]}
                moduleHeight={lowerBodyH}
                moduleDepth={depth}
                color={palette.body}
                onClick={onAddLower}
              />
            </>
          ) : (
            <AddButtonCenter
              position={[0, lowerCenterY, depth / 2 + 50]}
              label="하부장 추가"
              onClick={onAddLower}
            />
          )
        )}

        {/* ── 상부장 버튼 ── */}
        {!preset.fullHeight && upperHeight > 0 && canAddUpper && (
          hasUpper && upperLayout ? (
            <>
              <AddPanelSide
                position={[upperLayout.startX - 9, upperLayout.centerY, upperLayout.z]}
                moduleHeight={upperHeight}
                moduleDepth={upperDepth}
                color={palette.accent}
                onClick={onAddUpper}
              />
              <AddPanelSide
                position={[upperLayout.endX + 9, upperLayout.centerY, upperLayout.z]}
                moduleHeight={upperHeight}
                moduleDepth={upperDepth}
                color={palette.accent}
                onClick={onAddUpper}
              />
            </>
          ) : (
            <AddButtonCenter
              position={[0, upperCenterY, upperDepth / 2 + upperZOffset + 50]}
              label="상부장 추가"
              onClick={onAddUpper}
            />
          )
        )}

        {/* ── fullHeight 프리셋 ── */}
        {preset.fullHeight && canAddLower && (
          hasLower && lowerLayout ? (
            <>
              <AddPanelSide
                position={[lowerLayout.startX - 9, lowerLayout.centerY, 0]}
                moduleHeight={lowerBodyH}
                moduleDepth={depth}
                color={palette.body}
                onClick={onAddLower}
              />
              <AddPanelSide
                position={[lowerLayout.endX + 9, lowerLayout.centerY, 0]}
                moduleHeight={lowerBodyH}
                moduleDepth={depth}
                color={palette.body}
                onClick={onAddLower}
              />
            </>
          ) : (
            <AddButtonCenter
              position={[0, toeKickH + lowerBodyH / 2, depth / 2 + 50]}
              label="모듈 추가"
              onClick={onAddLower}
            />
          )
        )}
      </group>
      <primitive object={new THREE.GridHelper(6000, 12, '#3a3a3a', '#3a3a3a')} position={[0, 0, 0]} />
      <OrbitControls
        enablePan
        minDistance={700}
        maxDistance={7000}
        target={[0, 900, 0]}
        minPolarAngle={cameraView === 'top' ? 0.01 : 0.25}
        maxPolarAngle={cameraView === 'top' ? 0.01 : Math.PI / 2}
      />
      <Environment preset="apartment" />
      <primitive object={new THREE.AxesHelper(900)} position={[-2600, 20, -2600]} />
      <PerspectiveCamera
        makeDefault
        position={cameraPosition as [number, number, number]}
        fov={38}
        near={1}
        far={20000}
      />
    </>
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
    if (props.initialLowerCount) state.lowerCount = props.initialLowerCount;
    if (props.initialUpperCount) state.upperCount = props.initialUpperCount;
    if (props.initialMoldingH != null) state.moldingH = props.initialMoldingH;
    if (props.initialToeKickH != null) state.toeKickH = props.initialToeKickH;
    if (props.initialFinishLeftW != null) state.finishLeftW = props.initialFinishLeftW;
    if (props.initialFinishRightW != null) state.finishRightW = props.initialFinishRightW;
    return state;
  });
  const [cameraView, setCameraView] = useState<CameraView>(props.initialView || 'perspective');

  const derived = useMemo(() => deriveCabinet(planner), [planner]);
  const palette = MATERIALS[planner.material];

  // postMessage로 외부에서 데이터/카메라뷰 업데이트
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'UPDATE_PLANNER') {
        setPlanner((prev) => ({ ...prev, ...e.data.payload }));
      }
      if (e.data?.type === 'SET_CAMERA_VIEW') {
        setCameraView(e.data.view);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // 부모에게 상태 전달
  useEffect(() => {
    window.parent?.postMessage(
      { type: 'PLANNER_STATE', payload: { planner, derived } },
      '*'
    );
  }, [planner, derived]);

  const preset = getPresetById(planner.presetId);

  const addLower = useCallback(() => setPlanner((prev) => ({ ...prev, lowerCount: Math.min(prev.lowerCount + 1, 10) })), []);
  const addUpper = useCallback(() => setPlanner((prev) => ({ ...prev, upperCount: Math.min(prev.upperCount + 1, 10) })), []);

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', position: 'relative' }}>
      <Canvas shadows dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
        <SceneContent
          parts={derived.parts}
          palette={palette}
          cameraView={cameraView}
          preset={preset}
          planner={planner}
          derived={derived}
          onAddLower={addLower}
          onAddUpper={addUpper}
        />
      </Canvas>
    </div>
  );
}
