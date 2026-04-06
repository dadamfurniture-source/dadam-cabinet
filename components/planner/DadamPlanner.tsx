'use client';

import { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import {
  MATERIALS,
  PRESETS,
  type CabinetCategory,
  createPlannerState,
  deriveCabinet,
  formatMillimeters,
  getPresetById,
  type MaterialTone,
  type PlannerState,
} from '../../lib/planner';

type CameraView = 'perspective' | 'front' | 'top';
type TabId = 'category' | 'dimensions' | 'materials';

/* ── 3D Scene ── */

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
      <color attach="background" args={['#f0ede8']} />
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

/* ── Category Icons (SVG) ── */

const CATEGORY_ICONS: Record<CabinetCategory, string> = {
  sink: 'M4 8h16v8H4z M8 8V6a4 4 0 018 0v2',
  wardrobe: 'M5 3h14v18H5z M12 3v18 M9 12h1 M14 12h1',
  vanity: 'M6 6h12v12H6z M9 2v4 M15 2v4 M6 18v2 M18 18v2',
  shoe: 'M4 8h16v10H4z M4 12h16 M4 16h16',
  fridge: 'M6 2h12v20H6z M6 10h12 M15 6v1 M15 14v2',
  storage: 'M5 4h14v16H5z M5 8h14 M5 12h14 M5 16h14',
};

function CategoryIcon({ category, active }: { category: CabinetCategory; active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#b8956c' : '#999'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={CATEGORY_ICONS[category]} />
    </svg>
  );
}

/* ── Control Panel (Glass Overlay) ── */

function ControlPanel({
  planner,
  setPlanner,
  derived,
  preset,
  cameraView,
  setCameraView,
  onExport,
  exportMessage,
}: {
  planner: PlannerState;
  setPlanner: React.Dispatch<React.SetStateAction<PlannerState>>;
  derived: ReturnType<typeof deriveCabinet>;
  preset: ReturnType<typeof getPresetById>;
  cameraView: CameraView;
  setCameraView: (v: CameraView) => void;
  onExport: () => void;
  exportMessage: string;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('dimensions');

  const updateNumber = (key: keyof PlannerState, value: number) => {
    setPlanner((prev) => ({ ...prev, [key]: value }));
  };

  const tabs: { id: TabId; label: string }[] = [
    { id: 'category', label: '카테고리' },
    { id: 'dimensions', label: '치수' },
    { id: 'materials', label: '재질' },
  ];

  const materials = Object.entries(MATERIALS) as [MaterialTone, (typeof MATERIALS)[MaterialTone]][];

  return (
    <div className="absolute left-4 top-4 bottom-4 w-80 bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/30 flex flex-col overflow-hidden z-10">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-black/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#b8956c]/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b8956c" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-[#2d2a26]">{preset.name}</h1>
            <p className="text-[10px] text-black/40 uppercase tracking-widest font-semibold">
              {derived.modules.length} modules / {formatMillimeters(planner.width)}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-5 gap-4 border-b border-black/5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`py-3 text-sm font-medium transition-all relative ${
              activeTab === tab.id ? 'text-[#b8956c]' : 'text-black/40 hover:text-black/60'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#b8956c] rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content (scrollable) */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Category Tab */}
        {activeTab === 'category' && (
          <div className="grid grid-cols-2 gap-3">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  const state = createPlannerState(p.id);
                  state.material = planner.material;
                  setPlanner(state);
                }}
                className={`p-3 rounded-2xl border-2 transition-all text-center space-y-2 ${
                  planner.presetId === p.id
                    ? 'border-[#b8956c] bg-[#b8956c]/5'
                    : 'border-black/5 bg-black/[0.02] hover:bg-black/[0.05]'
                }`}
              >
                <CategoryIcon category={p.id} active={planner.presetId === p.id} />
                <span className="text-[10px] font-bold block uppercase tracking-wider">{p.name}</span>
                <span className="text-[9px] text-black/40 block">{p.summary}</span>
              </button>
            ))}
          </div>
        )}

        {/* Dimensions Tab */}
        {activeTab === 'dimensions' && (
          <div className="space-y-5">
            {/* W / H / D Sliders */}
            {([
              { key: 'width' as const, label: '너비 (W)', min: 600, max: 5000, step: 50 },
              { key: 'height' as const, label: '높이 (H)', min: 600, max: 2700, step: 50 },
              { key: 'depth' as const, label: '깊이 (D)', min: 300, max: 700, step: 10 },
            ]).map((dim) => (
              <div key={dim.key} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold uppercase text-black/40 tracking-wider">{dim.label}</span>
                  <span className="text-[10px] font-mono bg-black/5 px-2 py-0.5 rounded text-black/60">
                    {formatMillimeters(planner[dim.key])}
                  </span>
                </div>
                <input
                  type="range"
                  min={dim.min}
                  max={dim.max}
                  step={dim.step}
                  value={planner[dim.key]}
                  onChange={(e) => updateNumber(dim.key, Number(e.target.value))}
                  className="w-full h-1.5 bg-black/5 rounded-lg appearance-none cursor-pointer accent-[#b8956c]"
                />
              </div>
            ))}

            {/* Module counts */}
            <div className="border-t border-black/5 pt-4 space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold uppercase text-black/40 tracking-wider">하부 모듈</span>
                  <span className="text-[10px] font-mono bg-black/5 px-2 py-0.5 rounded text-black/60">
                    {planner.lowerCount}
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={planner.lowerCount}
                  onChange={(e) => updateNumber('lowerCount', Number(e.target.value))}
                  className="w-full h-1.5 bg-black/5 rounded-lg appearance-none cursor-pointer accent-[#b8956c]"
                />
              </div>

              {!preset.fullHeight && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-bold uppercase text-black/40 tracking-wider">상부 모듈</span>
                    <span className="text-[10px] font-mono bg-black/5 px-2 py-0.5 rounded text-black/60">
                      {planner.upperCount}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={planner.upperCount}
                    onChange={(e) => updateNumber('upperCount', Number(e.target.value))}
                    className="w-full h-1.5 bg-black/5 rounded-lg appearance-none cursor-pointer accent-[#b8956c]"
                  />
                </div>
              )}
            </div>

            {/* Area Summary */}
            <div className="border-t border-black/5 pt-4 space-y-2">
              <span className="text-[10px] font-bold uppercase text-black/40 tracking-wider">면적 요약</span>
              <div className="grid gap-2">
                {[
                  { label: '설치 면적', value: derived.footprintAreaM2 },
                  { label: '정면 면적', value: derived.facadeAreaM2 },
                  { label: '보드 면적', value: derived.estimatedBoardAreaM2 },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-center rounded-xl bg-black/[0.03] px-3 py-2">
                    <span className="text-xs text-black/50">{item.label}</span>
                    <span className="text-xs font-semibold">{item.value.toLocaleString('ko-KR')} m&sup2;</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Materials Tab */}
        {activeTab === 'materials' && (
          <div className="grid grid-cols-2 gap-3">
            {materials.map(([key, material]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPlanner((prev) => ({ ...prev, material: key }))}
                className={`p-4 rounded-2xl border-2 transition-all text-left space-y-3 ${
                  planner.material === key
                    ? 'border-[#b8956c] bg-[#b8956c]/5'
                    : 'border-black/5 bg-black/[0.02] hover:bg-black/[0.05]'
                }`}
              >
                <div className="flex gap-1.5">
                  <span className="w-8 h-8 rounded-full shadow-inner border border-black/10" style={{ backgroundColor: material.body }} />
                  <span className="w-8 h-8 rounded-full shadow-inner border border-black/10" style={{ backgroundColor: material.accent }} />
                </div>
                <span className="text-[11px] font-bold block">{material.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-4 space-y-3 bg-black/[0.03] border-t border-black/5">
        {/* Camera View Buttons */}
        <div className="flex gap-2">
          {(['perspective', 'front', 'top'] as CameraView[]).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setCameraView(view)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all ${
                cameraView === view
                  ? 'bg-[#2d2a26] text-white'
                  : 'bg-white/80 text-black/50 hover:bg-white hover:text-black/70'
              }`}
            >
              {view === 'perspective' ? '원근' : view === 'front' ? '정면' : '평면'}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExport}
            className="flex-1 py-2.5 bg-white rounded-xl text-xs font-bold border border-black/10 hover:bg-black/5 transition-colors"
          >
            {exportMessage || 'JSON 저장'}
          </button>
          <button
            type="button"
            className="flex-1 py-2.5 bg-[#2d2a26] text-white rounded-xl text-xs font-bold hover:bg-[#1a1918] transition-colors"
          >
            제출 준비
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ── */

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
    <div className="w-full h-screen overflow-hidden relative" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' }}>
      {/* Fullscreen 3D Canvas */}
      <div className="absolute inset-0">
        <Canvas shadows dpr={[1, 1.5]}>
          <SceneContent parts={derived.parts} palette={palette} cameraView={cameraView} />
        </Canvas>
      </div>

      {/* Overlay: Control Panel (Left) */}
      <ControlPanel
        planner={planner}
        setPlanner={setPlanner}
        derived={derived}
        preset={preset}
        cameraView={cameraView}
        setCameraView={setCameraView}
        onExport={exportJson}
        exportMessage={exportMessage}
      />

      {/* Overlay: Info Card (Right Top) */}
      <div className="absolute right-4 top-4 flex flex-col gap-3 z-10">
        <div className="bg-white/80 backdrop-blur-md px-4 py-3 rounded-2xl shadow-lg border border-white/30 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#b8956c]/10 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b8956c" strokeWidth="2"><path d="M4 4h16v16H4z M4 8h16 M4 12h16 M4 16h16" /></svg>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-black/40 tracking-wider">모듈</p>
            <p className="text-sm font-bold text-[#2d2a26]">{derived.modules.length}개</p>
          </div>
        </div>
        <div className="bg-white/80 backdrop-blur-md px-4 py-3 rounded-2xl shadow-lg border border-white/30">
          <p className="text-[10px] font-bold uppercase text-black/40 tracking-wider">치수</p>
          <p className="text-xs font-semibold text-[#2d2a26] mt-1">
            {formatMillimeters(planner.width)} x {formatMillimeters(planner.height)}
          </p>
        </div>
      </div>

      {/* Overlay: Branding (Bottom Right) */}
      <div className="absolute bottom-4 right-4 z-10">
        <p className="text-[10px] font-bold uppercase text-black/20 tracking-[0.2em]">Dadam 3D Planner</p>
      </div>
    </div>
  );
}
