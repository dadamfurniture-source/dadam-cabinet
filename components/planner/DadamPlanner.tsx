'use client';

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import {
  MATERIALS,
  type CabinetCategory,
  createPlannerState,
  deriveCabinet,
  formatMillimeters,
  getPresetById,
  type MaterialTone,
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

const summaryCards = [
  { key: 'footprintAreaM2', label: '설치 면적' },
  { key: 'facadeAreaM2', label: '정면 면적' },
  { key: 'estimatedBoardAreaM2', label: '보드 면적' },
] as const;

export interface DadamPlannerProps {
  initialPreset?: CabinetCategory;
  initialWidth?: number;
  initialHeight?: number;
  initialDepth?: number;
  initialMaterial?: MaterialTone;
  initialLowerCount?: number;
  initialUpperCount?: number;
}

export default function DadamPlanner(props: DadamPlannerProps) {
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
  const [cameraView, setCameraView] = useState<CameraView>('perspective');
  const [exportMessage, setExportMessage] = useState('');

  const derived = useMemo(() => deriveCabinet(planner), [planner]);
  const palette = MATERIALS[planner.material];
  const preset = derived.preset;

  // postMessage 수신: 외부에서 데이터 업데이트
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'UPDATE_PLANNER') {
        setPlanner((prev) => ({ ...prev, ...e.data.payload }));
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // postMessage 송신: 부모 프레임에 상태 전달
  useEffect(() => {
    window.parent?.postMessage(
      { type: 'PLANNER_STATE', payload: { planner, derived } },
      '*'
    );
  }, [planner, derived]);

  useEffect(() => {
    if (!exportMessage) return;
    const timer = window.setTimeout(() => setExportMessage(''), 2200);
    return () => window.clearTimeout(timer);
  }, [exportMessage]);

  const updateNumber = (key: keyof PlannerState, value: number) => {
    setPlanner((current: PlannerState) => ({ ...current, [key]: value }));
  };

  const exportJson = async () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      planner,
      preset: getPresetById(planner.presetId),
      derived,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dadam-${planner.presetId}-plan.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExportMessage('JSON 저장 완료');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f5ede0_0%,#f8f7f4_45%,#ece4d8_100%)] text-dadam-charcoal">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 py-4 lg:px-6 lg:py-6">
        {/* 상단 바: 제목 + 저장/제출 */}
        <div className="flex flex-col gap-3 rounded-[26px] border border-[#d9ccb8] bg-[#fffaf2]/90 p-4 shadow-[0_18px_60px_rgba(88,67,42,0.08)] lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[#9b7b55]">Detail Design Style</p>
            <h1 className="mt-2 font-serif text-3xl">{preset.name} — 3D 도면</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-xl bg-[#f7f1e8] px-3 py-2 text-sm">
              W {formatMillimeters(planner.width)} / H {formatMillimeters(planner.height)} / D {formatMillimeters(planner.depth)}
            </span>
            <button
              type="button"
              onClick={exportJson}
              className="rounded-full border border-[#d6c9b3] bg-white px-4 py-2 text-sm font-medium"
            >
              JSON 저장
            </button>
            <button type="button" className="rounded-full bg-[#2d2a26] px-4 py-2 text-sm font-semibold text-white">
              제출 준비
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(540px,1fr)_auto]">
          {/* 중앙 3D 도면 */}
          <main className="relative overflow-hidden rounded-[28px] border border-[#d9ccb8] bg-[#efe5d7] shadow-[0_24px_80px_rgba(55,39,18,0.08)]">
            <div className="absolute right-4 top-4 z-10 flex gap-2">
              {(['perspective', 'front', 'top'] as CameraView[]).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setCameraView(view)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold ${
                    cameraView === view ? 'bg-[#2d2a26] text-white' : 'bg-white/85 text-dadam-charcoal'
                  }`}
                >
                  {view === 'perspective' ? '원근' : view === 'front' ? '정면' : '평면'}
                </button>
              ))}
            </div>

            <Canvas shadows dpr={[1, 1.5]}>
              <SceneContent parts={derived.parts} palette={palette} cameraView={cameraView} />
            </Canvas>
          </main>

          {/* 우측 옵션: 모듈 수 + 재질 톤 */}
          <aside className="rounded-[24px] border border-[#d9ccb8] bg-white p-4 shadow-[0_16px_40px_rgba(88,67,42,0.07)]">
            <p className="text-xs uppercase tracking-[0.24em] text-[#9b7f5c]">옵션</p>
            <h2 className="mt-2 text-xl font-semibold">{preset.name}</h2>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm">
                <span>하부 모듈 수</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={planner.lowerCount}
                  onChange={(event) => updateNumber('lowerCount', Number(event.target.value))}
                  className="rounded-xl border border-[#d7c8b3] px-3 py-2"
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span>상부 모듈 수</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={planner.upperCount}
                  onChange={(event) => updateNumber('upperCount', Number(event.target.value))}
                  className="rounded-xl border border-[#d7c8b3] px-3 py-2"
                  disabled={preset.fullHeight}
                />
              </label>

              <div className="grid gap-2">
                <span className="text-sm">재질 톤</span>
                {(
                  Object.entries(MATERIALS) as [
                    PlannerState['material'],
                    (typeof MATERIALS)[PlannerState['material']],
                  ][]
                ).map(([key, material]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPlanner((current: PlannerState) => ({ ...current, material: key }))}
                    className={`flex items-center justify-between rounded-2xl border px-3 py-3 text-left ${
                      planner.material === key ? 'border-[#8d6b45] bg-[#f8efe2]' : 'border-[#ddd0bd]'
                    }`}
                  >
                    <span className="text-sm font-medium">{material.name}</span>
                    <span className="flex gap-1">
                      <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: material.body }} />
                      <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: material.accent }} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* 하단 요약 */}
          <section className="rounded-[24px] border border-[#d9ccb8] bg-white p-4 shadow-[0_16px_40px_rgba(88,67,42,0.07)] lg:col-span-2">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#9b7f5c]">하단 요약</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {summaryCards.map((card) => (
                    <div key={card.key} className="rounded-2xl bg-[#f7f1e8] px-4 py-3">
                      <p className="text-xs text-dadam-gray">{card.label}</p>
                      <p className="mt-1 text-xl font-semibold">{derived[card.key].toLocaleString('ko-KR')} m&sup2;</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-[#9b7f5c]">모듈 리스트</p>
                <div className="mt-3 grid max-h-[180px] gap-2 overflow-y-auto">
                  {derived.modules.map((module) => (
                    <div key={module.id} className="grid grid-cols-[1fr_auto_auto] rounded-xl bg-[#f7f1e8] px-3 py-2 text-sm">
                      <span className="font-medium">{module.id.toUpperCase()}</span>
                      <span>{formatMillimeters(module.width)}</span>
                      <span className="text-dadam-gray">{module.section}</span>
                    </div>
                  ))}
                </div>
                {exportMessage ? <p className="mt-3 text-sm text-[#7a5c33]">{exportMessage}</p> : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
