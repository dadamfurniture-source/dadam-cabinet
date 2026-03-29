'use client';

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
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

function SceneContent({
  parts,
  palette,
  cameraView,
}: {
  parts: ReturnType<typeof deriveCabinet>['parts'];
  palette: (typeof MATERIALS)[keyof typeof MATERIALS];
  cameraView: CameraView;
}) {
  const cameraPosition =
    cameraView === 'top' ? [0, 2400, 0.01] : cameraView === 'front' ? [0, 900, 2800] : [2300, 1500, 2300];

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
      </group>
      <Grid
        args={[10000, 10000]}
        position={[0, 0, 0]}
        cellSize={500}
        cellThickness={0.4}
        sectionSize={500}
        sectionThickness={0.4}
        cellColor="#3a3a3a"
        sectionColor="#3a3a3a"
        fadeDistance={5000}
        fadeStrength={2}
        infiniteGrid
      />
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
  const totalModules = planner.lowerCount + planner.upperCount;
  const isEmpty = totalModules === 0;

  const addLower = () => setPlanner((prev) => ({ ...prev, lowerCount: Math.min(prev.lowerCount + 1, 10) }));
  const removeLower = () => setPlanner((prev) => ({ ...prev, lowerCount: Math.max(prev.lowerCount - 1, 0) }));
  const addUpper = () => setPlanner((prev) => ({ ...prev, upperCount: Math.min(prev.upperCount + 1, 10) }));
  const removeUpper = () => setPlanner((prev) => ({ ...prev, upperCount: Math.max(prev.upperCount - 1, 0) }));

  const btnBase: React.CSSProperties = {
    border: 'none',
    cursor: 'pointer',
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    transition: 'opacity 0.15s',
  };

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', position: 'relative' }}>
      <Canvas shadows dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
        <SceneContent parts={derived.parts} palette={palette} cameraView={cameraView} />
      </Canvas>

      {/* Empty state — center prompt */}
      {isEmpty && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <button
            onClick={addLower}
            style={{
              ...btnBase,
              pointerEvents: 'auto',
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#b8956c',
              color: '#fff',
              fontSize: 32,
              fontWeight: 300,
              boxShadow: '0 4px 20px rgba(184,149,108,0.4)',
            }}
          >
            +
          </button>
          <span
            style={{
              marginTop: 14,
              color: '#8b8680',
              fontSize: 14,
              fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
              pointerEvents: 'none',
            }}
          >
            {preset.fullHeight ? '모듈 추가' : '하부장 추가'}
          </span>
        </div>
      )}

      {/* Non-empty state — floating controls */}
      {!isEmpty && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Lower / Full modules */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#666', fontSize: 11, minWidth: 42 }}>
              {preset.fullHeight ? '모듈' : '하부장'}
            </span>
            <button
              onClick={removeLower}
              disabled={planner.lowerCount <= 0}
              style={{
                ...btnBase,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: planner.lowerCount > 0 ? '#e0d6c8' : '#eee',
                color: planner.lowerCount > 0 ? '#4a3f35' : '#bbb',
                fontSize: 18,
              }}
            >
              -
            </button>
            <span style={{ fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center', color: '#2d2a26' }}>
              {planner.lowerCount}
            </span>
            <button
              onClick={addLower}
              disabled={planner.lowerCount >= 10}
              style={{
                ...btnBase,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: planner.lowerCount < 10 ? '#b8956c' : '#eee',
                color: planner.lowerCount < 10 ? '#fff' : '#bbb',
                fontSize: 18,
              }}
            >
              +
            </button>
          </div>

          {/* Upper modules (only for non-fullHeight presets) */}
          {!preset.fullHeight && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#666', fontSize: 11, minWidth: 42 }}>상부장</span>
              <button
                onClick={removeUpper}
                disabled={planner.upperCount <= 0}
                style={{
                  ...btnBase,
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: planner.upperCount > 0 ? '#e0d6c8' : '#eee',
                  color: planner.upperCount > 0 ? '#4a3f35' : '#bbb',
                  fontSize: 18,
                }}
              >
                -
              </button>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center', color: '#2d2a26' }}>
                {planner.upperCount}
              </span>
              <button
                onClick={addUpper}
                disabled={planner.upperCount >= 10}
                style={{
                  ...btnBase,
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: planner.upperCount < 10 ? '#b8956c' : '#eee',
                  color: planner.upperCount < 10 ? '#fff' : '#bbb',
                  fontSize: 18,
                }}
              >
                +
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
