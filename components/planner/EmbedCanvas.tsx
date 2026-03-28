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
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.5, 0]}>
        <planeGeometry args={[10000, 10000]} />
        <shadowMaterial opacity={0.16} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
      </mesh>
      <Grid
        args={[10000, 10000]}
        position={[0, 0.5, 0]}
        cellSize={100}
        cellThickness={0.8}
        sectionSize={500}
        sectionThickness={1.2}
        cellColor="#d5cab8"
        sectionColor="#bcae98"
        fadeDistance={8000}
        fadeStrength={1}
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

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
      <Canvas shadows dpr={[1, 1.5]} style={{ width: '100%', height: '100%' }}>
        <SceneContent parts={derived.parts} palette={palette} cameraView={cameraView} />
      </Canvas>
    </div>
  );
}
